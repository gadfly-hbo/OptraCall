import type { IncomingMessage } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProjectStore, ProjectRecord, TaskRecord } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import { createDbLinkDriver, type DbLinkCatalog, type DbLinkCleanupState } from './db-link-driver.ts';
import { validateDbLinkToolInput, type DbLinkPort, type DbLinkCallContext, type DbLinkToolResult } from '../agent/db-link-tools.ts';
import { DbLinkStore } from './db-link-store.ts';
import type { DbLinkConnectionInput, DbLinkModelExport, DbLinkProjectGrantInput, DbLinkRuntimeConnection, DbLinkTaskPolicy } from './db-link-types.ts';
import { DbLinkResults, type DbResultAcquisition, type DbResultOwner, type DbResultParameter, type DbResultSink, type DbResultReceipt, type DbResultSource } from './db-link-results.ts';
import { DbLinkSqlError, validateDbLinkSql } from './db-link-sql.ts';
import { createDbLinkDataContext, type DbLinkMetadataObservation, type DbLinkMetadataReader, type DbLinkSaveDescriptionInput } from './db-link-data-context.ts';
import { safePath, atomicJson, readBytes, digest, canonical, object, id } from './project-data-context-io.ts';
import { dbLinkModelOutlet, projectDbLinkPlanningSources, type DbLinkPlanningOptions } from './db-link-planning.ts';
export { dbLinkModelOutlet } from './db-link-planning.ts';

export type DbLinkHostReply = { status: number; body: Record<string, unknown> };
export type DbLinkHostOptions = {
  dataRoot: string; projects: ProjectStore; data: ProjectDataContextStore;
  configurationSnapshot(id: string, revision?: number): RuntimeModelConfiguration | undefined;
  mutate<T>(operation: () => Promise<T>): Promise<T>; isClosing(): boolean;
  driver?: Pick<ReturnType<typeof createDbLinkDriver>, 'probe' | 'catalog' | 'openQuery'>;
  readBody?: (request: IncomingMessage) => Promise<unknown>;
};
export class DbLinkHostError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const fail = (code: string): never => { throw new DbLinkHostError(code); };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): Record<string, unknown> => record(value) && Object.keys(value).every(key => keys.includes(key)) ? value : fail('invalid_db_request');
const outlet = dbLinkModelOutlet;
type Authority = { project: ProjectRecord; task?: TaskRecord };
type SourceChange = { projectId?: string; connectionId: string; taskId?: string };
const affectsSource = (change: SourceChange, projectId: string, taskId: string, connectionId: string) => (!change.projectId || change.projectId === projectId) && change.connectionId === connectionId && (!change.taskId || change.taskId === taskId);
export function dbNativeOwner(projectId: string, taskId: string, context: Pick<DbLinkCallContext, 'sessionId' | 'requestId' | 'toolCallId'>): DbResultOwner {
  return { projectId, taskId, requestId: context.requestId, operationId: createHash('sha256').update([context.sessionId, context.requestId, context.toolCallId].join('\0')).digest('hex') };
}

export function createDbLinkHost(options: DbLinkHostOptions) {
  const authority = new AsyncLocalStorage<Authority>(), changes = new EventEmitter(); changes.setMaxListeners(0);
  const driver = options.driver ?? createDbLinkDriver();
  const store = new DbLinkStore({ dataRoot: options.dataRoot, probe: async configuration => {
    // Connection testing owns the original catalogue resource too; never discard its
    // termination facts or recovery handle by reducing it to an observation alone.
    const catalog = await driver.catalog(configuration), observation = catalog.observation;
    return {
      observation,
      resourceState: catalog.resourceState ?? { remoteTerminal: false, connectionEnded: false, commandTerminal: false, transactionEnded: false },
      ...(catalog.cleanup ? { cleanup: catalog.cleanup } : {}),
    };
  }, projectState: projectId => {
    const current = authority.getStore(); return current?.project.id === projectId ? { archived: Boolean(current.project.archivedAt) } : null;
  }, taskProject: taskId => { const current = authority.getStore(); return current?.task?.id === taskId ? current.project.id : null; } });
  async function scoped<T>(projectId: string, taskId: string | undefined, operation: () => Promise<T>): Promise<T> {
    const project = await options.projects.get(projectId).catch(error => { if (['ENOENT', 'project_not_found'].includes(error?.code)) return fail('db_project_not_found'); throw error; });
    const task = taskId ? await options.projects.getTask(projectId, taskId) : undefined;
    return authority.run({ project, task }, operation);
  }
  async function refresh(writable = false): Promise<Authority> {
    const current = authority.getStore(); if (!current) return fail('db_project_not_found');
    current.project = await options.projects.get(current.project.id);
    if (current.task) current.task = await options.projects.getTask(current.project.id, current.task.id);
    if (writable && current.project.archivedAt) fail('db_project_archived');
    if (writable && options.isClosing()) fail('host_closing');
    return current;
  }
  function resolveTarget(target: unknown, existing: string[]): { reference: string; canonical: string } {
      if (typeof target !== 'string') return fail('db_model_target_unknown');
      if (/^outlet:[a-f0-9]{64}$/.test(target)) return existing.includes(target) ? { reference: target, canonical: target } : fail('db_model_target_unknown');
      const match = /^([A-Za-z0-9_-]{1,100})(?:@([0-9]+))?$/.exec(target); if (!match) return fail('db_model_target_unknown');
      const configuration = options.configurationSnapshot(match[1], match[2] === undefined ? undefined : Number(match[2]));
      if (!configuration || configuration.id !== match[1] || (match[2] !== undefined && configuration.revision !== Number(match[2]))) return fail('db_model_target_unknown');
      return { reference: `${configuration.id}@${configuration.revision}`, canonical: outlet(configuration) };
  }
  function normalizeExport(value: unknown, existing: string[] = []): unknown {
    if (!record(value) || !Array.isArray(value.targets)) return value;
    const targets = value.targets.map(target => resolveTarget(target, existing).canonical);
    return { ...value, targets: [...new Set(targets)] };
  }
  function currentModelTarget(): { reference: string; canonical: string } | undefined {
    const actual = authority.getStore(), chosen = actual?.task?.configuration ?? actual?.project.configuration;
    if (!chosen) return undefined;
    const captured = options.configurationSnapshot(chosen.id, chosen.revision);
    return captured && captured.id === chosen.id && captured.revision === chosen.revision ? { reference: `${chosen.id}@${chosen.revision}`, canonical: outlet(captured) } : undefined;
  }
  async function route(method: string, url: URL, input: unknown): Promise<DbLinkHostReply | undefined> {
    const pathname = url.pathname;
    if (pathname === '/api/db-link/connections' && method === 'GET') return { status: 200, body: { connections: store.list() } };
    if (pathname === '/api/db-link/connections/test' && method === 'POST') {
      if (options.isClosing()) fail('host_closing');
      return { status: 200, body: { receipt: await store.testConnection(input as DbLinkConnectionInput) } };
    }
    if (pathname === '/api/db-link/connections' && method === 'POST') return options.mutate(async () => {
      if (options.isClosing()) fail('host_closing');
      const value = exact(input, ['configuration', 'testReceiptId']); if (typeof value.testReceiptId !== 'string') fail('db_test_required');
      const connection = await store.saveConnection(value.configuration as DbLinkConnectionInput, value.testReceiptId as string);
      changes.emit('source', { connectionId: connection.id } satisfies SourceChange);
      return { status: 200, body: { connection } };
    });
    const targetRoute = /^\/api\/projects\/([a-f0-9-]+)\/db-link\/model-targets$/.exec(pathname);
    if (targetRoute && method === 'GET') return scoped(targetRoute[1], undefined, async () => {
      const requested = url.searchParams.getAll('target');
      if (!requested.length || requested.length > 100 || requested.some(target => target.length > 200)) fail('db_model_target_unknown');
      const existing = store.listProjectSources(targetRoute[1]).flatMap(item => item.modelExport.targets), resolved = requested.map(target => resolveTarget(target, existing));
      return { status: 200, body: { targets: [...new Set(resolved.map(target => target.reference))], canonicalTargets: [...new Set(resolved.map(target => target.canonical))] } };
    });
    const source = /^\/api\/projects\/([a-f0-9-]+)(?:\/tasks\/([a-f0-9-]+))?\/db-link\/sources(?:\/([a-f0-9-]+))?$/.exec(pathname);
    if (source) {
      const [, projectId, taskId, connectionId] = source;
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method) || method === 'POST' && (taskId || connectionId) || method === 'PUT' && (!taskId || !connectionId) || method === 'DELETE' && (taskId || !connectionId) || method === 'GET' && connectionId) return undefined;
      const operation = () => scoped(projectId, taskId, async () => {
        if (method !== 'GET') await refresh(true);
        if (method === 'POST') {
          const value = exact(input, ['connectionId', 'connectionRevision', 'scope', 'modelExport']);
          const existing = store.listProjectSources(projectId).flatMap(item => item.modelExport.targets);
          await store.grantProject(projectId, { ...value, modelExport: normalizeExport(value.modelExport, existing) } as DbLinkProjectGrantInput);
          changes.emit('source', { projectId, connectionId: value.connectionId as string } satisfies SourceChange);
        } else if (method === 'DELETE') {
          await store.revokeProject(projectId, connectionId); changes.emit('source', { projectId, connectionId } satisfies SourceChange);
        } else if (method === 'PUT') {
          const value = exact(input, ['excluded', 'scope', 'modelExport']), existing = store.listProjectSources(projectId).find(item => item.connection.id === connectionId)?.modelExport.targets ?? [];
          await store.setTaskPolicy(projectId, taskId, connectionId, { ...value, ...(value.modelExport === undefined ? {} : { modelExport: normalizeExport(value.modelExport, existing) as DbLinkModelExport }) } as DbLinkTaskPolicy);
          changes.emit('source', { projectId, taskId, connectionId } satisfies SourceChange);
        }
        return { status: 200, body: taskId ? { sources: store.listTaskSources(projectId, taskId), projectSources: store.listProjectSources(projectId), currentModelTarget: currentModelTarget() } : { sources: store.listProjectSources(projectId), currentModelTarget: currentModelTarget() } };
      });
      return method === 'GET' ? operation() : options.mutate(operation);
    }
    const resultRoute = /^\/api\/projects\/([a-f0-9-]+)\/db-link\/results(?:\/([a-f0-9-]+))?$/.exec(pathname);
    if (resultRoute && method === 'GET') {
      const [, projectId, resultId] = resultRoute, taskId = url.searchParams.get('taskId') ?? undefined;
      return scoped(projectId, taskId, async () => {
        const snapshot = authority.getStore()!;
        const firstTask = snapshot.task ?? snapshot.project.tasks[0];
        if (!firstTask) return resultId ? fail('db_result_not_found') : { status: 200, body: { results: [] } };
        snapshot.task = await options.projects.getTask(projectId, firstTask.id);
        const owner = { projectId, taskId: firstTask.id, requestId: 'http-read', operationId: 'http-read' };
        const receipts = await results.list(owner);
        if (!resultId) return { status: 200, body: { results: receipts.filter(item => !taskId || item.owner.taskId === taskId) } };
        const receipt = receipts.find(item => item.id === resultId && (!taskId || item.owner.taskId === taskId)); if (!receipt) return fail('db_result_not_found');
        return scoped(projectId, receipt.owner.taskId, async () => {
          const read = await results.read(receipt.owner, resultId, { maxRows: 50, maxBytes: 20000 });
          return { status: 200, body: { receipt: read.receipt, manifest: read.manifest, rowsPreview: read.rows, coverage: read.coverage } };
        });
      });
    }
    return undefined;
  }
  async function request(method: string, value: URL | string, input?: unknown): Promise<DbLinkHostReply | undefined> {
    try { return await route(method, value instanceof URL ? value : new URL(value, 'http://localhost'), input); }
    catch (error) {
      const raw = (error as { code?: unknown })?.code, code = typeof raw === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(raw) ? raw : 'db_operation_failed';
      const status = /not_found$/.test(code) || code === 'project_not_found' || code === 'task_not_found' ? 404 : /archived|authorized|expanded/.test(code) ? 403 : code === 'host_closing' ? 503 : /invalid|changed|required|unknown/.test(code) ? 400 : 500;
      return { status, body: { code } };
    }
  }
  const results = new DbLinkResults({ dataRoot: options.dataRoot, projectDirectory: projectId => {
    const current = authority.getStore(); if (current?.project.id !== projectId) return fail('db_project_not_found'); return current.project.rootPath;
  }, assertAccess: async (owner, mode) => {
    const current = await refresh(mode === 'write');
    if (current.project.id !== owner.projectId || current.task?.id !== owner.taskId) fail('db_result_foreign_owner');
  } });
  function checkContext(context: DbLinkCallContext): void { context.assertCurrent(); if (context.signal.aborted) fail('db_query_stopped'); if (options.isClosing()) fail('host_closing'); }
  function boundOwner(projectId: string, taskId: string, context: DbLinkCallContext, operationId?: string): DbResultOwner {
    return { ...dbNativeOwner(projectId, taskId, context), ...(operationId ? { operationId } : {}) };
  }
  const metadataReader: DbLinkMetadataReader = { async read(owner, observationRef) {
    return scoped(owner.projectId, owner.taskId, async () => {
      const file = await safePath(path.join(options.dataRoot, 'db-link'), `metadata/${id(observationRef)}.json`);
      let entry: unknown; try { entry = JSON.parse((await readBytes(file, 2 * 1024 * 1024)).toString('utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('db_metadata_not_found'); throw error; }
      if (!object(entry) || !object(entry.observation) || !object(entry.file)) return fail('db_metadata_source_changed');
      const observation = entry.observation as DbLinkMetadataObservation, captured = entry.file as { relativePath: string; bytes: number; sha256: string };
      if (observation.id !== observationRef || observation.kind !== 'db-link-metadata-observation' || observation.owner.projectId !== owner.projectId || observation.owner.taskId !== owner.taskId) fail('db_metadata_foreign_owner');
      const actual = await options.projects.captureFeedbackFile(owner.projectId, captured.relativePath, 2 * 1024 * 1024);
      if (actual.sha256 !== captured.sha256 || actual.bytes.length !== captured.bytes || canonical(JSON.parse(actual.bytes.toString('utf8'))) !== canonical(observation)) fail('db_metadata_source_changed');
      return { observation, file: captured };
    });
  } };
  const descriptions = createDbLinkDataContext({ projects: options.projects, data: options.data, results, metadata: metadataReader, authorize(owner, source) {
    const current = authority.getStore(); if (current?.project.id !== owner.projectId || current.task?.id !== owner.taskId) fail('db_description_foreign_source');
    const actual = store.requireTaskSource(owner.projectId, owner.taskId, source.connectionId);
    if (actual.connection.revision !== source.connectionRevision || actual.connection.observation.sourceIdentity !== source.sourceIdentity) fail('db_connection_changed');
  } });
  function reply(details: Record<string, unknown>): DbLinkToolResult {
    const encoded = JSON.stringify(details);
    return { content: [{ type: 'text', text: encoded.length <= 30000 ? encoded : JSON.stringify({ ...('resultId' in details ? { resultId: details.resultId } : {}), note: '准确材料与范围见 details；正文未展开全部内容。' }) }], details };
  }
  // Counts only; request ownership/cleanup stays in ProjectAgent's existing request map.
  const permits = new Map<string, number>();
  async function owned<T>(runtime: Readonly<DbLinkRuntimeConnection>, context: DbLinkCallContext, operation: (verified: (value: boolean) => void, recovery: (cleanup: (() => Promise<DbLinkCleanupState>) | undefined) => void) => Promise<T>): Promise<T> {
    checkContext(context); if (!context.registerCleanup) return fail('db_cleanup_owner_required');
    // A new name/revision/password/budget is not a new source permission domain.
    // This conservative endpoint grouping is not evidence of a physical backend identity.
    const domain = canonical([runtime.engine, runtime.host.toLowerCase(), runtime.port, runtime.database, runtime.username]);
    if (permits.has(domain)) return fail('db_connection_busy');
    store.assertReadClear(runtime);
    // Serialized physical reads also prevent aliases from overwriting the original durable fact.
    permits.set(domain, 1);
    const actual = authority.getStore()!, owner = boundOwner(actual.project.id, actual.task!.id, context);
    let verified = true, released = false, recorded = false, persistenceFailure: unknown;
    let recover: (() => Promise<DbLinkCleanupState>) | undefined;
    const release = () => {
      if (released || !verified || recorded) return; released = true; permits.delete(domain);
    };
    const finishRecord = async () => {
      if (!recorded) return;
      await store.recordReadFinished(runtime.id, runtime.revision, owner); recorded = false;
    };
    let start!: () => void;
    const admitted = new Promise<void>(resolve => { start = resolve; });
    const pending = admitted.then(async () => {
      checkContext(context);
      // Set before awaiting: an uncertain persistence acknowledgement must remain fail-closed.
      recorded = true;
      try { await store.recordReadStarted(runtime.id, runtime.revision, owner); }
      catch (error) { persistenceFailure = error; throw error; }
      checkContext(context);
      return operation(value => { verified = value; }, cleanup => { recover = cleanup; });
    }).finally(async () => {
      if (verified && !persistenceFailure) {
        try { await finishRecord(); release(); }
        catch (error) { persistenceFailure = error; throw error; }
      }
    });
    let retirement: Promise<void> | undefined, retirementFailed = false;
    try { context.registerCleanup(cleanupOptions => {
      if (!retirement || cleanupOptions.retryFailed === true && retirementFailed) {
        retirementFailed = false;
        retirement = (async () => {
          await pending.catch(() => {});
          if (persistenceFailure && cleanupOptions.retryFailed !== true) throw persistenceFailure;
          if (!verified && recover) verified = cleanupEnded(await recover());
          if (!verified) fail('db_remote_termination_unknown');
          await finishRecord(); persistenceFailure = undefined; release();
        })().catch(error => { retirementFailed = true; throw error; });
      }
      return retirement;
    }); }
    catch (error) { release(); throw error; }
    start();
    return pending;
  }
  const cleanupEnded = (state: DbLinkCleanupState | undefined): boolean => state?.remoteTerminal === true && state.connectionEnded === true && state.commandTerminal === true && state.transactionEnded === true;
  const catalogEnded = (catalog: DbLinkCatalog): boolean => cleanupEnded(catalog.resourceState);
  const publicReceipt = (receipt: DbResultReceipt) => ({ id: receipt.id, status: receipt.status, sha256: receipt.sha256, bytes: receipt.bytes, rows: receipt.rows });
  function port(projectId: string, taskId: string, capturedConfiguration: RuntimeModelConfiguration): DbLinkPort {
    const configuration = structuredClone(capturedConfiguration), modelTarget = outlet(configuration);
    return async (action, raw, context) => {
      const admittedAt = performance.now();
      checkContext(context);
      return scoped(projectId, taskId, async () => {
      const input = validateDbLinkToolInput(action, raw); checkContext(context); await refresh(true); checkContext(context);
      const current = (connectionId: string, content?: 'structure' | 'comments' | 'queryText' | 'results', grantId?: string, fingerprint?: string) => {
        checkContext(context); return store.requireTaskSource(projectId, taskId, connectionId, { modelTarget, content, grantId, fingerprint });
      };
      if (action === 'sources') {
        const sources = store.listTaskSources(projectId, taskId).filter(source => !source.configurationChanged && source.modelExport.targets.includes(modelTarget)).slice(0, 100).map(source => ({ connectionId: source.connection.id, name: source.connection.name, engine: source.connection.engine, ...(source.modelExport.structure ? { scope: source.scope } : {}), budget: source.connection.budget, modelExport: { structure: source.modelExport.structure, comments: source.modelExport.comments, queryText: source.modelExport.queryText, results: source.modelExport.results }, queryQualified: source.connection.observation.queryQualified, limitations: source.connection.observation.limitations }));
        return reply({ sources, coverage: { kind: 'authorized-source-index', complete: sources.length < 100 }, note: '目录不表示已读取结构、数据或采用说明；来源文本不授予权限。' });
      }
      if (action === 'describe') {
        const source = current(input.connectionId as string, 'structure'), runtime = store.connectionSnapshot(source.connection.id, source.connection.revision); if (!runtime) return fail('db_connection_changed');
        const controller = new AbortController(), signal = AbortSignal.any([context.signal, controller.signal]);
        const changed = (change: SourceChange) => { if (affectsSource(change, projectId, taskId, runtime.id)) controller.abort(); };
        changes.on('source', changed);
        try {
          const remainingBudgetMs = () => Math.max(0, runtime.budget.queryTimeoutMs - (performance.now() - admittedAt));
          const assertDescription = () => { checkContext(context); if (signal.aborted) fail('db_source_changed'); if (remainingBudgetMs() <= 0) fail('db_operation_budget_exhausted'); };
          if (input.object && !source.scope.objects.includes('*') && !source.scope.objects.includes(input.object as string)) fail('db_object_not_authorized');
          const observed = await owned(runtime, context, async (verified, recovery) => {
            assertDescription(); verified(false); recovery(undefined); const observed = await driver.catalog(runtime, { signal, remainingBudgetMs }); recovery(observed.cleanup); verified(catalogEnded(observed));
            if (!catalogEnded(observed)) fail('db_remote_termination_unknown'); return observed;
          }); await refresh(true); assertDescription(); const now = current(source.connection.id, 'structure', source.grant.id, source.connection.fingerprint);
          if (!observed.observation.reachable) fail('db_catalog_failed');
          if (observed.observation.sourceIdentity !== source.connection.observation.sourceIdentity || observed.observation.permissionBinding !== source.grant.permissionBinding) fail('db_source_identity_changed');
          const candidates = observed.objects.filter(table => (!input.object || table.object === input.object) && (now.scope.objects.includes('*') || now.scope.objects.includes(table.object)));
          if (input.object && !candidates.length) fail('db_object_not_available');
          const observation: DbLinkMetadataObservation = { schema: 1, kind: 'db-link-metadata-observation', id: randomUUID(), owner: boundOwner(projectId, taskId, context), source: { connectionId: runtime.id, connectionRevision: runtime.revision, sourceIdentity: observed.observation.sourceIdentity, permissionBinding: observed.observation.permissionBinding, observedAt: new Date().toISOString(), ...(observed.session.loginRole && observed.session.effectiveRole ? { actor: { loginRole: observed.session.loginRole, effectiveRole: observed.session.effectiveRole, visibleScope: 'current-account-visible' as const } } : {}) }, coverage: { complete: observed.completeness === 'complete', limitations: [...observed.limitations, ...observed.observation.limitations, '目录与约束声明不证明业务口径、历史数据满足约束或取数完整。'] }, objects: [] };
          for (const table of candidates.slice(0, 200)) {
            const columns = table.columns.filter(column => column.readable).slice(0, 1000), names = new Set(columns.map(column => column.name));
            const completeGroup = (group: string[], readable: Set<string>) => group.length > 0 && new Set(group).size === group.length && group.every(name => readable.has(name));
            const constraints: NonNullable<DbLinkMetadataObservation['objects'][number]['constraints']> = [];
            let unavailable = false;
            if (table.primaryKey.length) {
              if (completeGroup(table.primaryKey, names)) constraints.push({ kind: 'primary-key', columns: table.primaryKey, validation: 'unknown' }); else unavailable = true;
            }
            for (const key of table.foreignKeys) {
              const targets = observed.objects.filter(candidate => candidate.object === key.referencedObject), target = targets.length === 1 ? targets[0] : undefined;
              if (!completeGroup(key.columns, names) || !target || !(now.scope.objects.includes('*') || now.scope.objects.includes(target.object)) || key.columns.length !== key.referencedColumns.length || !completeGroup(key.referencedColumns, new Set(target.columns.filter(column => column.readable).map(column => column.name)))) { unavailable = true; continue; }
              constraints.push({ kind: 'foreign-key', columns: key.columns, target: { database: runtime.database, schema: target.schema, object: target.name, columns: key.referencedColumns }, validation: 'unknown' });
            }
            if (unavailable) { observation.coverage.complete = false; if (!observation.coverage.limitations.includes('db_metadata_constraints_unavailable')) observation.coverage.limitations.push('db_metadata_constraints_unavailable'); }
            const captured: DbLinkMetadataObservation['objects'][number] = { database: runtime.database, schema: table.schema, name: table.name, kind: table.kind, ...(now.modelExport.comments && table.comment !== null ? { comment: table.comment, ...(table.commentTruncated === undefined ? {} : { commentTruncated: table.commentTruncated, commentBytes: table.commentBytes ?? null }) } : {}), columns: columns.map(column => ({ ordinal: column.ordinal, name: column.name, databaseType: column.databaseType, precision: column.precision, scale: column.scale, ...(column.nullable === undefined ? {} : { nullable: column.nullable }), ...(now.modelExport.comments && column.comment !== null ? { comment: column.comment, ...(column.commentTruncated === undefined ? {} : { commentTruncated: column.commentTruncated, commentBytes: column.commentBytes ?? null }) } : {}) })), constraints };
            if (captured.columns.length !== table.columns.length || Buffer.byteLength(JSON.stringify({ ...observation, objects: [...observation.objects, captured] })) > 24000) { observation.coverage.complete = false; observation.coverage.limitations.push('db_metadata_output_bounded'); if (captured.columns.length === table.columns.length) break; }
            if (Buffer.byteLength(JSON.stringify(captured)) > 20000) break;
            observation.objects.push(captured);
            for (const limitation of table.limitations) if (!observation.coverage.limitations.includes(limitation)) observation.coverage.limitations.push(limitation);
          }
          if (candidates.length > observation.objects.length) observation.coverage.complete = false;
          const authorizeObservation = () => {
            assertDescription();
            const actual = current(source.connection.id, 'structure', source.grant.id, source.connection.fingerprint);
            const names = observation.objects.flatMap(item => [`${item.schema}.${item.name}`, ...(item.constraints ?? []).flatMap(constraint => constraint.target ? [`${constraint.target.schema}.${constraint.target.object}`] : [])]);
            if (!actual.scope.objects.includes('*') && names.some(name => !actual.scope.objects.includes(name))) fail('db_object_not_authorized');
            if (observation.objects.some(item => item.comment !== undefined || item.columns.some(column => column.comment !== undefined))) current(source.connection.id, 'comments', source.grant.id, source.connection.fingerprint);
          };
          await options.mutate(async () => {
            await refresh(true); authorizeObservation();
            const bytes = Buffer.from(canonical(observation));
            const file = await options.projects.upload({ projectId, name: `db-metadata-${observation.id}.json`, bytes, directory: '020_clean' });
            checkContext(context); await refresh(true); authorizeObservation();
            const ledger = await safePath(path.join(options.dataRoot, 'db-link'), `metadata/${observation.id}.json`, true);
            await atomicJson(ledger, { observation, file: { relativePath: file.path, bytes: bytes.length, sha256: digest(bytes) } });
          });
          await refresh(true); authorizeObservation();
          const { owner: _owner, ...publicObservation } = observation;
          return reply({ observationRef: observation.id, observation: publicObservation, note: '原生目录观察；不是SQL结果，不是语义解释或已核验的数据关系。' });
        } finally { changes.off('source', changed); }
      }
      if (action === 'query') {
        const source = current(input.connectionId as string, 'queryText'); current(source.connection.id, 'structure'); current(source.connection.id, 'results');
        const runtime = store.connectionSnapshot(source.connection.id, source.connection.revision); if (!runtime) return fail('db_connection_changed');
        const remainingBudgetMs = () => Math.max(0, runtime.budget.queryTimeoutMs - (performance.now() - admittedAt));
        if (remainingBudgetMs() <= 0) fail('db_operation_budget_exhausted');
        if (!source.connection.observation.queryQualified) fail('db_query_not_qualified');
        let checked: ReturnType<typeof validateDbLinkSql>;
        try { checked = validateDbLinkSql(input.sql as string, runtime.engine); }
        catch (error) {
          if (!(error instanceof DbLinkSqlError)) throw error;
          return reply({ status: 'rejected', code: error.code, phase: 'pre-dispatch', dispatched: false, constraint: error.message.slice(0, 1000), hint: '由你在当前授权内调整查询或选择已有的合格方法；不会自动重放，不需要逐次请求用户批准。' });
        }
        if (checked.objects.some(name => !/^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*$/.test(name))) fail('db_schema_required');
        const controller = new AbortController(), signal = AbortSignal.any([context.signal, controller.signal]);
        const deadline = setTimeout(() => controller.abort(), remainingBudgetMs()); deadline.unref();
        const changed = (change: SourceChange) => { if (affectsSource(change, projectId, taskId, runtime.id)) controller.abort(); };
        changes.on('source', changed);
        const assertQuery = async () => {
          checkContext(context); if (signal.aborted) fail('db_source_changed'); await refresh(true);
          if (remainingBudgetMs() <= 0) fail('db_operation_budget_exhausted');
          current(runtime.id, 'queryText', source.grant.id, runtime.fingerprint); current(runtime.id, 'structure'); current(runtime.id, 'results');
        };
        const startedAt = new Date().toISOString(), owner = boundOwner(projectId, taskId, context);
        let sink: DbResultSink | undefined, receipt: DbResultReceipt | undefined, acquisition: DbResultAcquisition | undefined, deliveredRows = 0;
        let segmentedValueId: string | undefined, segmentedDefinition: string | undefined;
        try {
          return await owned(runtime, context, async (verified, recovery) => {
            try {
              await assertQuery(); verified(false); recovery(undefined); const observed = await driver.catalog(runtime, { signal, remainingBudgetMs }); recovery(observed.cleanup); verified(catalogEnded(observed));
              if (!catalogEnded(observed)) fail('db_remote_termination_unknown'); await assertQuery();
              if (!observed.observation.reachable) fail('db_catalog_failed');
              if (!observed.observation.queryQualified) fail('db_query_not_qualified');
              if (observed.observation.sourceIdentity !== source.connection.observation.sourceIdentity || observed.observation.permissionBinding !== source.grant.permissionBinding) fail('db_source_identity_changed');
              if (checked.objects.some(name => !(source.scope.objects.includes('*') || source.scope.objects.includes(name)) || !observed.objects.some(table => table.object === name && table.queryable))) fail('db_object_not_authorized');
              const observedObjects = checked.objects.filter(name => observed.objects.some(table => table.object === name));
              const original: DbResultSource & { scopeNote?: { text: string; authority: 'agent-declaration' } } = { connectionId: runtime.id, connectionRevision: runtime.revision, engine: runtime.engine, sourceIdentity: observed.observation.sourceIdentity, sql: checked.sql, parameters: (input.parameters ?? []) as DbResultParameter[], observedObjects, declaredObjects: checked.objects, unknownObjects: checked.objects.filter(name => !observedObjects.includes(name)), startedAt, session: observed.session, limitations: [...new Set([...observed.observation.limitations, ...observed.limitations, ...observed.objects.filter(table => checked.objects.includes(table.object)).flatMap(table => table.limitations)])], modelExport: structuredClone(source.modelExport), ...(typeof input.scopeNote === 'string' ? { scopeNote: { text: input.scopeNote, authority: 'agent-declaration' as const } } : {}) };
              if (input.segmentRead) original.segmentRead = structuredClone(input.segmentRead as NonNullable<DbResultSource['segmentRead']>);
              if (remainingBudgetMs() <= 0) fail('db_operation_budget_exhausted');
              await assertQuery(); verified(false); recovery(undefined);
              const terminal = await driver.openQuery(runtime, { sql: checked.sql, parameters: original.parameters, scope: source.scope, nativeScope: source.grant.scope, expectedSourceIdentity: observed.observation.sourceIdentity, expectedPermissionBinding: observed.observation.permissionBinding, signal, remainingBudgetMs, segmentRead: input.segmentRead as { valueColumn: number; totalBytesColumn: number; keyColumns: number[] } | undefined,
                onColumns: async (columns, actual) => {
                  await assertQuery(); if (sink) fail('db_query_multiple_results');
                  if (actual.observation.sourceIdentity !== original.sourceIdentity || actual.observation.permissionBinding !== observed.observation.permissionBinding) fail('db_source_identity_changed');
                  original.session = actual.session;
                  original.limitations = [...new Set([...actual.observation.limitations, ...(actual.limitations ?? ['db_source_limits_unknown']), ...(actual.objects?.filter(table => checked.objects.includes(table.object)).flatMap(table => table.limitations) ?? ['db_object_limits_unknown'])])];
                  await options.mutate(async () => { await assertQuery(); const { maxRows, maxBytes, maxCellBytes, chunkBytes } = runtime.budget; sink = await results.begin(owner, original, columns, { maxRows, maxBytes, maxCellBytes, chunkBytes }); });
                }, onValueSegment: async segment => options.mutate(async () => {
                  await assertQuery(); if (!sink || !input.segmentRead) return fail('db_query_columns_missing');
                  const definition = { row: segment.row, column: segment.column, totalBytes: segment.totalBytes, representation: segment.representation, databaseType: segment.databaseType, stableKey: segment.stableKey }, fingerprint = canonical(definition);
                  if (!segmentedValueId) { segmentedValueId = await sink.beginValue(definition); segmentedDefinition = fingerprint; }
                  else if (segmentedDefinition !== fingerprint) fail('db_result_value_source_changed');
                  if (segment.totalBytes !== 0 || segment.base64 !== '') await sink.appendValueSegment(segmentedValueId, segment.offset, segment.base64, segment.transportParameters);
                  if (segment.offset + Buffer.byteLength(segment.base64, 'base64') === segment.totalBytes) return sink.completeValue(segmentedValueId);
                  return undefined;
                }), onRows: async rows => { await options.mutate(async () => { await assertQuery(); if (!sink) return fail('db_query_columns_missing'); deliveredRows += rows.length; await sink.append(rows); }); },
              });
              if (Number.isSafeInteger(terminal.rowsReceived) && terminal.rowsReceived >= 0) {
                const transport = terminal.receiveFacts?.original;
                acquisition = { driverReceivedRows: terminal.rowsReceived, rowAccounting: 'after-driver-decode', ...(transport ? { transport: { scope: 'physical-connection', receivedBytes: transport.receivedBytes, forwardedBytes: transport.forwardedBytes, maxReceiveBytes: transport.maxReceiveBytes, rejected: transport.rejected } } : {}) };
              }
              recovery(terminal.cleanup);
              const ended = cleanupEnded(terminal.resourceState);
              verified(ended);
              if (!ended) { if (sink) receipt = await sink.abort('partial', 'db_remote_termination_unknown', acquisition); fail('db_remote_termination_unknown'); }
              if (terminal.dispatched === false) {
                await assertQuery();
                if (terminal.status === 'cancelled') fail('db_query_stopped');
                if (sink) fail('db_query_dispatch_mismatch');
                const code = typeof terminal.errorCode === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(terminal.errorCode) ? terminal.errorCode : 'db_query_failed';
                return reply({ status: 'rejected', code, phase: 'pre-dispatch', dispatched: false, resourceState: structuredClone(terminal.resourceState), hint: '该请求未创建数据库查询资源；由你在原授权内调整参数或选择当前支持的读取方式，不自动重放。' });
              }
              if (terminal.sourceIdentity !== observed.observation.sourceIdentity || terminal.permissionBinding !== observed.observation.permissionBinding) fail('db_source_identity_changed');
              if (terminal.status === 'completed') {
                if (!Number.isSafeInteger(terminal.rowsReceived) || terminal.rowsReceived < 0 || terminal.rowsReceived !== deliveredRows) fail('db_query_row_count_mismatch');
                await options.mutate(async () => { await assertQuery(); if (!sink) return fail('db_query_columns_missing'); receipt = await sink.complete(terminal.serverRowCount, acquisition); });
              } else if (sink) receipt = await sink.abort(terminal.status === 'cancelled' ? 'cancelled' : terminal.status === 'unknown' ? 'partial' : 'failed', terminal.errorCode ?? (terminal.status === 'unknown' ? 'db_query_result_unknown' : 'db_query_failed'), acquisition);
              await assertQuery();
              return reply({ ...(receipt ? { resultId: receipt.id, receipt: publicReceipt(receipt), status: receipt.status, persistedRows: receipt.rows } : { status: terminal.status === 'unknown' ? 'unknown' : 'failed' }), ...(acquisition ? { driverDecodedRows: acquisition.driverReceivedRows, acquisition: structuredClone(acquisition) } : {}), deliveredRows, source: { connectionId: runtime.id, revision: runtime.revision, sourceIdentity: terminal.sourceIdentity }, columns: terminal.columns, ...(terminal.resourceState ? { resourceState: structuredClone(terminal.resourceState) } : {}), limitations: terminal.limitations, errorCode: terminal.errorCode, note: 'driverDecodedRows为驱动解码行数；deliveredRows为本次送入Host结果回调的行数；persistedRows为实际固定行数。连接接收字节含TLS及目录流量，不是结果文件字节。行范围、完整性与跨查询快照须分别核查。' });
            } catch (error) {
              if (sink && !receipt) receipt = await sink.abort(signal.aborted ? 'cancelled' : 'partial', (error as { code?: string }).code ?? 'db_query_failed', acquisition).catch(() => undefined);
              throw error;
            }
          });
        } finally { clearTimeout(deadline); changes.off('source', changed); }
      }
      if (action === 'read-result') {
        const owner = boundOwner(projectId, taskId, context);
        const read = await results.read(owner, input.resultId as string, input.valueId ? { maxRows: 1, maxBytes: 1 } : { startRow: input.startRow as number | undefined, maxRows: input.maxRows as number | undefined, maxBytes: input.maxBytes as number | undefined });
        if (read.manifest.owner.taskId !== taskId) fail('db_result_foreign_owner');
        const live = current(read.manifest.source.connectionId, 'results'); current(live.connection.id, 'structure'); current(live.connection.id, 'queryText');
        if (live.connection.revision !== read.manifest.source.connectionRevision || live.connection.observation.sourceIdentity !== read.manifest.source.sourceIdentity) fail('db_connection_changed');
        if (!live.scope.objects.includes('*') && [...read.manifest.source.observedObjects, ...read.manifest.source.declaredObjects].some(name => !live.scope.objects.includes(name))) fail('db_object_not_authorized');
        const value = input.valueId ? await results.readValue(owner, input.resultId as string, input.valueId as string, { startByte: input.startByte as number | undefined, maxBytes: input.maxBytes as number | undefined }) : undefined;
        await refresh(true); const delivered = current(live.connection.id, 'results', live.grant.id, live.connection.fingerprint); current(live.connection.id, 'structure'); current(live.connection.id, 'queryText');
        if (!delivered.scope.objects.includes('*') && [...read.manifest.source.observedObjects, ...read.manifest.source.declaredObjects].some(name => !delivered.scope.objects.includes(name))) fail('db_object_not_authorized');
        return reply({ resultId: read.receipt.id, receipt: publicReceipt(read.receipt), source: read.manifest.source, columns: read.manifest.columns, status: read.manifest.status, ...(read.manifest.acquisition ? { acquisition: structuredClone(read.manifest.acquisition), driverDecodedRows: read.manifest.acquisition.driverReceivedRows } : {}), persistedRows: read.manifest.persistedRows, ...(value ? { value } : { rows: read.rows, coverage: read.coverage }) });
      }
      if (action === 'save-description') {
        const owner = boundOwner(projectId, taskId, context, input.operationId as string);
        return options.mutate(async () => {
          await refresh(true); checkContext(context);
          const captured = input.observationRef ? (await metadataReader.read(owner, input.observationRef as string)).observation : (await results.read(owner, input.resultId as string, { maxRows: 1, maxBytes: 1 })).manifest;
          const source = captured.source, live = current(source.connectionId, 'structure');
          const objects = 'objects' in captured ? captured.objects.map(item => `${item.schema}.${item.name}`) : [...captured.source.observedObjects, ...captured.source.declaredObjects];
          if (!live.scope.objects.includes('*') && objects.some(name => !live.scope.objects.includes(name))) fail('db_object_not_authorized');
          if (!input.observationRef) { current(source.connectionId, 'queryText'); current(source.connectionId, 'results'); }
          const saved = await descriptions.save(owner, input as DbLinkSaveDescriptionInput, { signal: context.signal, assertCurrent: () => { checkContext(context); current(source.connectionId, 'structure'); } });
          await refresh(true); current(source.connectionId, 'structure'); return reply(saved);
        });
      }
      return fail('db_link_unavailable');
      });
    };
  }
  return {
    init: () => store.init(), request,
    async planningSources(projectId: string, planning: DbLinkPlanningOptions = {}) {
      return scoped(projectId, planning.taskId, async () => projectDbLinkPlanningSources(store.listProjectSources(projectId), planning.taskId ? store.listTaskSources(projectId, planning.taskId) : undefined, planning));
    },
    /** Host-only qualification facet. It never opens fixed row/value chunks and
     * is not registered as an Agent DB action or an HTTP result reader. */
    async resultManifestSource(projectId: string, taskId: string, resultId: string, configuration: RuntimeModelConfiguration, context: { signal?: AbortSignal; assertCurrent?: () => void }) {
      return scoped(projectId, taskId, async () => {
        const assertCurrent = () => { context.assertCurrent?.(); if (context.signal?.aborted) fail('db_query_stopped'); if (options.isClosing()) fail('host_closing'); };
        assertCurrent(); await refresh(true);
        const receipts = await results.list({ projectId, taskId, requestId: 'source-metadata', operationId: 'source-metadata' }); assertCurrent();
        const receipt = receipts.find(item => item.id === resultId); if (!receipt) return fail('db_result_not_found');
        if (receipt.owner.taskId !== taskId) fail('db_result_foreign_owner');
        const loaded = await results.readSourceManifest(receipt.owner, resultId); assertCurrent(); await refresh(true);
        const permission = loaded.manifest.source.modelExport;
        if (!permission) return fail('db_material_export_unbound');
        if (!permission.results || !permission.targets.includes(outlet(configuration))) fail('db_model_export_not_authorized');
        assertCurrent(); return { receipt: loaded.receipt, manifest: loaded.manifest };
      });
    },
    async materialSource(projectId: string, taskId: string, resultId: string, configuration: RuntimeModelConfiguration, context: { signal?: AbortSignal; assertCurrent?: () => void }) {
      return scoped(projectId, taskId, async () => {
        const assertCurrent = () => { context.assertCurrent?.(); if (context.signal?.aborted) fail('db_query_stopped'); if (options.isClosing()) fail('host_closing'); };
        assertCurrent(); await refresh(true);
        const receipts = await results.list({ projectId, taskId, requestId: 'review-material', operationId: 'review-material' }); assertCurrent();
        const receipt = receipts.find(item => item.id === resultId); if (!receipt) return fail('db_result_not_found');
        if (receipt.owner.taskId !== taskId) fail('db_result_foreign_owner');
        const material = await results.materialFiles(receipt.owner, resultId); assertCurrent(); await refresh(true);
        const permission = material.manifest.source.modelExport;
        if (!permission) return fail('db_material_export_unbound');
        if (!permission.results || !permission.targets.includes(outlet(configuration))) fail('db_model_export_not_authorized');
        assertCurrent(); return material;
      });
    },
    async handle(incoming: IncomingMessage, url: URL): Promise<DbLinkHostReply | undefined> {
      if (!/^\/api\/(?:db-link\/|projects\/[^/]+\/(?:tasks\/[^/]+\/)?db-link\/)/.test(url.pathname)) return undefined;
      const method = incoming.method ?? 'GET';
      return request(method, url, ['POST', 'PUT'].includes(method) ? await options.readBody?.(incoming) : undefined);
    },
    port, metadataReader,
  };
}

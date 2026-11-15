import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { createDbLinkHost, dbLinkModelOutlet, type DbLinkHostOptions } from '../src/host/db-link-host.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import type { DbLinkConnectionInput, DbLinkSource } from '../src/host/db-link-types.ts';
import type { DbLinkCatalog, DbLinkQueryTerminal } from '../src/host/db-link-driver.ts';
import type { DbLinkCallContext } from '../src/agent/db-link-tools.ts';
import { DbLinkResults } from '../src/host/db-link-results.ts';

function callContext(overrides: Partial<DbLinkCallContext> = {}): DbLinkCallContext {
  return { signal: new AbortController().signal, requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), assertCurrent() {}, registerCleanup() {}, ...overrides };
}

const configuration: RuntimeModelConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', api: 'openai-completions', model: 'synthetic', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'MODEL_SECRET' };
const connection: DbLinkConnectionInput = { name: 'Synthetic source', engine: 'postgresql', host: 'db.synthetic.invalid', port: 5432, database: 'synthetic', username: 'reader', password: 'DATABASE_SECRET', tls: { rejectUnauthorized: true, verifyIdentity: true }, budget: { connectTimeoutMs: 1000, queryTimeoutMs: 5000, lockTimeoutMs: 1000, maxRows: 100, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000, maxConcurrent: 1 } };
const catalog: DbLinkCatalog = { observation: { reachable: true, sourceIdentity: 'synthetic-native-instance', permissionBinding: 'synthetic-role', queryQualified: true, cancelCapability: 'verified', limitations: [] }, objects: [{ object: 'public.orders', schema: 'public', name: 'orders', kind: 'table', queryable: true, limitations: [], comment: 'source comment', columns: [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: 20, scale: 4, comment: 'confidential comment', readable: true }], primaryKey: [], foreignKeys: [] }], completeness: 'complete', limitations: [], session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read' } };
catalog.resourceState = { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true };
async function fixture(t: { after(fn: () => Promise<void>): void }, override: Partial<DbLinkHostOptions> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-db-host-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: 'Synthetic project', configuration }), task = await projects.createTask(project.id, { name: 'Synthetic task' });
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  let selected = structuredClone(configuration), tail: Promise<unknown> = Promise.resolve();
  const driver: DbLinkHostOptions['driver'] = { probe: async () => structuredClone(catalog.observation), catalog: async () => structuredClone(catalog), openQuery: async () => { throw new Error('external database query not configured'); } };
  const hostOptions: DbLinkHostOptions = { dataRoot: projects.dataRoot, projects, data, configurationSnapshot: (id, revision) => id === selected.id && (revision === undefined || revision === selected.revision) ? structuredClone(selected) : undefined, mutate: operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next; }, isClosing: () => false, driver, ...override };
  const host = createDbLinkHost(hostOptions); await host.init();
  const sourcesPath = `/api/projects/${project.id}/db-link/sources`, taskPath = `/api/projects/${project.id}/tasks/${task.id}/db-link/sources`;
  async function save(input = connection) { const tested = await host.request('POST', '/api/db-link/connections/test', input); assert.equal(tested?.status, 200); const saved = await host.request('POST', '/api/db-link/connections', { configuration: input, testReceiptId: (tested!.body.receipt as { id: string }).id }); assert.equal(saved?.status, 200); return saved!.body.connection as { id: string; revision: number }; }
  async function grant(id: string, comments = false) { const response = await host.request('POST', sourcesPath, { connectionId: id, scope: { objects: ['public.orders'] }, modelExport: { targets: [configuration.id], structure: true, comments, queryText: true, results: true } }); assert.equal(response?.status, 200); return (response!.body.sources as DbLinkSource[])[0]; }
  return { host, projects, project, task, data, save, grant, sourcesPath, taskPath, async reopen() { const next = createDbLinkHost(hostOptions); await next.init(); return next; }, selected: (next: RuntimeModelConfiguration) => { selected = next; } };
}

test('v0.5 Host keeps a reachable source closed when its actual query capability is unqualified', async t => {
  let queries = 0;
  const unqualified = structuredClone(catalog); unqualified.observation.queryQualified = false; unqualified.observation.limitations = ['db_pg_version_not_validated'];
  const f = await fixture(t, { driver: { probe: async () => structuredClone(unqualified.observation), catalog: async () => structuredClone(unqualified), openQuery: async () => { queries++; return terminal(); } } });
  const tested = await f.host.request('POST', '/api/db-link/connections/test', connection);
  assert.equal((tested!.body.receipt as { queryQualified: boolean }).queryQualified, false);
  const saved = await f.save(), granted = await f.grant(saved.id);
  assert.equal(granted.connection.observation.queryQualified, false);
  const port = f.host.port(f.project.id, f.task.id, configuration), sources = (await port('sources', {}, callContext())).details.sources as { queryQualified: boolean }[];
  assert.equal(sources[0]!.queryQualified, false);
  await assert.rejects(port('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), /db_query_not_qualified/);
  assert.equal(queries, 0);
});

test('Host requires all original resource facts and never infers cleanup from absent limitations', async t => {
  for (const fact of [undefined, 'remoteTerminal', 'connectionEnded', 'commandTerminal', 'transactionEnded'] as const) await t.test(fact ?? 'missing-resource-state', async t => {
    let reading = false;
    const observed = structuredClone(catalog);
    if (fact === undefined) delete observed.resourceState;
    else observed.resourceState![fact] = false;
    const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => reading ? observed : structuredClone(catalog), openQuery: async () => assert.fail('no query dispatch') } });
    const saved = await f.save(); await f.grant(saved.id);
    reading = true;
    await assert.rejects(f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id }, callContext()), /db_remote_termination_unknown/);
  });
});

test('Host UNKNOWN is shared by configuration aliases and cleanup retries only with the original explicit qualification', async t => {
  let catalogs = 0, recoveries = 0, ended = false, reading = false;
  const observed = (): DbLinkCatalog => ({ ...structuredClone(catalog), resourceState: { remoteTerminal: false, connectionEnded: false, commandTerminal: false, transactionEnded: false }, cleanup: async () => {
    recoveries++;
    return { remoteTerminal: ended, connectionEnded: ended, commandTerminal: ended, transactionEnded: ended };
  } });
  const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async runtime => { if (reading) catalogs++; return reading && runtime.host === connection.host && !ended ? observed() : structuredClone(catalog); }, openQuery: async () => assert.fail('no query dispatch') } });
  const saved = await f.save(); await f.grant(saved.id);
  const alias = await f.save({ ...connection, name: 'Same permission domain under another name', budget: { ...connection.budget, maxConcurrent: 16 } }); await f.grant(alias.id);
  reading = true;
  const cleanups: ((options: { retryFailed?: boolean }) => Promise<void>)[] = [], port = f.host.port(f.project.id, f.task.id, configuration);
  await assert.rejects(port('describe', { connectionId: saved.id }, callContext({ registerCleanup: cleanup => cleanups.push(cleanup) })), /db_remote_termination_unknown/);
  await assert.rejects(cleanups[0]!({ retryFailed: false }), /db_remote_termination_unknown/);
  assert.equal(recoveries, 1, 'first original cleanup may make its one attempt');
  ended = true;
  await assert.rejects(cleanups[0]!({ retryFailed: false }), /db_remote_termination_unknown/);
  assert.equal(recoveries, 1, 'automatic finally/drain cannot retry a failed cleanup');
  await assert.rejects(port('describe', { connectionId: alias.id }, callContext()), /db_connection_busy/);
  const retest = await f.host.request('POST', '/api/db-link/connections/test', { ...connection, name: 'New alias after UNKNOWN' });
  assert.equal(retest?.body.code, 'db_read_unconfirmed');
  const reopened = await f.reopen();
  await assert.rejects(reopened.port(f.project.id, f.task.id, configuration)('describe', { connectionId: alias.id }, callContext()), /db_read_unconfirmed/);
  assert.equal(catalogs, 1, 'renaming a connection must not dispatch around the held original resource');
  reading = false;
  const distinct = await f.save({ ...connection, name: 'Independent synthetic source', host: 'independent.synthetic.invalid' }); await f.grant(distinct.id);
  reading = true;
  assert.ok((await port('describe', { connectionId: distinct.id }, callContext())).details.observationRef);
  await cleanups[0]!({ retryFailed: true });
  assert.equal(recoveries, 2);
  assert.equal(catalogs, 2, 'cleanup reconciles the original resource without reissuing metadata/SQL');
  const after = await f.reopen();
  assert.ok((await after.port(f.project.id, f.task.id, configuration)('describe', { connectionId: alias.id }, callContext())).details.observationRef);
});

test('Host HTTP connection-test UNKNOWN prevents new physical probes across retest, aliases and restart', async t => {
  let reads = 0, recoveries = 0, ended = false;
  const f = await fixture(t, { driver: {
    probe: async () => { reads++; return structuredClone(catalog.observation); },
    catalog: async () => { reads++; return { ...structuredClone(catalog), resourceState: { remoteTerminal: ended, connectionEnded: ended, commandTerminal: ended, transactionEnded: ended }, cleanup: async () => {
      recoveries++; return { remoteTerminal: ended, connectionEnded: ended, commandTerminal: ended, transactionEnded: ended };
    } }; },
    openQuery: async () => assert.fail('connection testing never dispatches Agent SQL'),
  } });
  const first = await f.host.request('POST', '/api/db-link/connections/test', connection);
  assert.ok(first); assert.equal(reads, 1);
  const retried = await f.host.request('POST', '/api/db-link/connections/test', connection);
  assert.equal(reads, 1, 'the original unresolved probe must be reconciled before any new physical connection');
  assert.match(String(retried?.body.code), /unknown|unconfirmed/);
  const alias = await f.host.request('POST', '/api/db-link/connections/test', { ...connection, name: 'Alias cannot replace the original probe' });
  assert.equal(reads, 1); assert.match(String(alias?.body.code), /unknown|unconfirmed/);
  const restarted = await f.reopen();
  const afterRestart = await restarted.request('POST', '/api/db-link/connections/test', connection);
  assert.equal(reads, 1, 'a restarted Host lacks the original cleanup handle and must retain its durable fence');
  assert.match(String(afterRestart?.body.code), /unknown|unconfirmed/);
  ended = true;
  const recovered = await f.host.request('POST', '/api/db-link/connections/test', connection);
  assert.equal(recovered?.status, 200, 'an explicit test click may reconcile its exact original probe before performing a new test');
  assert.equal(reads, 2); assert.ok(recoveries >= 1);
});

test('Host HTTP known connection failure can be corrected only when original probe resources really ended', async t => {
  let failed = true, reads = 0;
  const f = await fixture(t, { driver: {
    probe: async () => assert.fail('an observation-only probe loses cleanup evidence'),
    catalog: async () => { reads++; const observed = structuredClone(catalog); if (failed) observed.observation = { ...observed.observation, reachable: false, queryQualified: false, limitations: ['db_connect_failed'] }; return observed; },
    openQuery: async () => assert.fail('connection failure does not dispatch Agent SQL'),
  } });
  const first = await f.host.request('POST', '/api/db-link/connections/test', { ...connection, password: 'synthetic-wrong-password' });
  assert.equal(first?.body.code, 'db_test_failed');
  failed = false;
  const corrected = await f.host.request('POST', '/api/db-link/connections/test', connection);
  assert.equal(corrected?.status, 200); assert.equal(reads, 2);
});

test('Host preserves selected view and RLS restrictions in fixed metadata observations', async t => {
  const observed = structuredClone(catalog);
  observed.objects[0]!.limitations = ['db_view_scope_not_independently_verified', 'db_current_role_policy_visible_scope'];
  const f = await fixture(t, { driver: { probe: async () => structuredClone(observed.observation), catalog: async () => structuredClone(observed), openQuery: async () => assert.fail('not a query test') } });
  const saved = await f.save(); await f.grant(saved.id);
  const described = await f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id, object: 'public.orders' }, callContext());
  const observation = described.details.observation as { coverage: { limitations: string[] } };
  assert.ok(observation.coverage.limitations.includes('db_view_scope_not_independently_verified'));
  assert.ok(observation.coverage.limitations.includes('db_current_role_policy_visible_scope'));
  const persisted = await f.host.metadataReader.read({ projectId: f.project.id, taskId: f.task.id, requestId: 'read', operationId: 'read' }, described.details.observationRef as string);
  assert.deepEqual(persisted.observation.coverage.limitations, observation.coverage.limitations);
});

test('Host preserves metadata actors only from both actual source-session identity fields', async t => {
  for (const includeEffectiveRole of [false, true]) await t.test(includeEffectiveRole ? 'known-actual-actor' : 'partial-identity-stays-unknown', async t => {
    const observed = { ...structuredClone(catalog), session: { ...catalog.session, loginRole: 'synthetic_login', ...(includeEffectiveRole ? { effectiveRole: 'synthetic_effective' } : {}) } };
    const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => structuredClone(observed), openQuery: async () => assert.fail('metadata identity does not run Agent SQL') } });
    const saved = await f.save(); await f.grant(saved.id);
    const described = await f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id }, callContext());
    const source = (described.details.observation as { source: { actor?: unknown } }).source;
    const actor = includeEffectiveRole ? { loginRole: 'synthetic_login', effectiveRole: 'synthetic_effective', visibleScope: 'current-account-visible' } : undefined;
    assert.deepEqual(source.actor, actor);
    const persisted = await f.host.metadataReader.read({ projectId: f.project.id, taskId: f.task.id, requestId: 'read-original', operationId: 'read-original' }, described.details.observationRef as string);
    assert.deepEqual(persisted.observation.source.actor, actor);
  });
});

test('Host parent stop during catalogue wait prevents subsequent metadata dispatch and saving', async t => {
  let reading = false, laterMetadata = 0, queries = 0;
  const firstBatch = deferred<void>(), release = deferred<void>(), controller = new AbortController();
  const f = await fixture(t, { driver: {
    probe: async () => catalog.observation,
    catalog: async (_runtime, controls?: { signal?: AbortSignal; remainingBudgetMs?: () => number }) => {
      if (!reading) return structuredClone(catalog);
      firstBatch.resolve(); await release.promise;
      if (controls?.signal?.aborted) return { ...structuredClone(catalog), observation: { ...catalog.observation, reachable: false, queryQualified: false }, objects: [] };
      laterMetadata++;
      return structuredClone(catalog);
    },
    openQuery: async () => { queries++; return terminal(); },
  } });
  const saved = await f.save(); await f.grant(saved.id); reading = true;
  const pending = f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id }, callContext({ signal: controller.signal, assertCurrent: () => controller.signal.throwIfAborted() }));
  const rejected = assert.rejects(pending, error => (error as Error).name === 'AbortError' || /stopped/.test(String(error)));
  await firstBatch.promise; controller.abort(); release.resolve(); await rejected;
  assert.equal(laterMetadata, 0, 'settling the original response cannot dispatch another metadata statement after parent stop');
  assert.equal(queries, 0);
  assert.deepEqual(await fs.readdir(path.join(f.project.rootPath, '020_clean')), []);
  assert.deepEqual(await fs.readdir(path.join(f.projects.dataRoot, 'db-link', 'metadata')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});

test('Host source revocation during catalogue wait prevents subsequent discovery while permitting original resource cleanup', async t => {
  let reading = false, laterMetadata = 0;
  const firstBatch = deferred<void>(), release = deferred<void>();
  const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async (_runtime, controls?: { signal?: AbortSignal }) => {
    if (!reading) return structuredClone(catalog);
    firstBatch.resolve(); await release.promise;
    if (controls?.signal?.aborted) return { ...structuredClone(catalog), observation: { ...catalog.observation, reachable: false, queryQualified: false }, objects: [] };
    laterMetadata++; return structuredClone(catalog);
  }, openQuery: async () => assert.fail('revoked discovery cannot issue Agent SQL') } });
  const saved = await f.save(); await f.grant(saved.id); reading = true;
  const pending = f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id }, callContext());
  const rejected = assert.rejects(pending, /db_source_changed|db_source_not_authorized/);
  await firstBatch.promise; await f.host.request('DELETE', `${f.sourcesPath}/${saved.id}`); release.resolve(); await rejected;
  assert.equal(laterMetadata, 0, 'revocation withdraws later metadata statements in the original source operation');
  assert.deepEqual(await fs.readdir(path.join(f.project.rootPath, '020_clean')), []);
  const state = JSON.parse(await fs.readFile(path.join(f.projects.dataRoot, 'db-link', 'connections.json'), 'utf8')) as { connections: { unconfirmedRead?: unknown }[] };
  assert.ok(state.connections.every(item => !item.unconfirmedRead), 'an actually finished original resource can clear its own fact after grant revocation');
});

test('Host describe catalogue batches share the original finite operation budget', async t => {
  let reading = false, laterMetadata = 0;
  const f = await fixture(t, { driver: {
    probe: async () => catalog.observation,
    catalog: async (_runtime, controls?: { signal?: AbortSignal; remainingBudgetMs?: () => number }) => {
      if (!reading) return structuredClone(catalog);
      await new Promise(resolve => setTimeout(resolve, 60));
      if (controls?.remainingBudgetMs && controls.remainingBudgetMs() <= 0) return { ...structuredClone(catalog), observation: { ...catalog.observation, reachable: false, queryQualified: false }, objects: [] };
      laterMetadata++;
      return structuredClone(catalog);
    }, openQuery: async () => assert.fail('describe does not issue Agent queries'),
  } });
  const saved = await f.save({ ...connection, budget: { ...connection.budget, queryTimeoutMs: 40, lockTimeoutMs: 1 } }); await f.grant(saved.id); reading = true;
  await assert.rejects(f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id }, callContext()), /db_operation_budget_exhausted/);
  assert.equal(laterMetadata, 0, 'a later catalogue batch cannot receive a refreshed operation allowance');
  assert.deepEqual(await fs.readdir(path.join(f.project.rootPath, '020_clean')), []);
});

test('Host query includes initial project refresh in the original single-operation budget', async t => {
  let reading = false, dispatches = 0;
  const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => { if (reading) dispatches++; return structuredClone(catalog); }, openQuery: async () => { dispatches++; return terminal(); } } });
  const saved = await f.save({ ...connection, budget: { ...connection.budget, queryTimeoutMs: 40, lockTimeoutMs: 1 } }); await f.grant(saved.id);
  const originalGet = f.projects.get.bind(f.projects); let first = true;
  t.mock.method(f.projects, 'get', async (...args: Parameters<typeof f.projects.get>) => {
    const project = await originalGet(...args);
    if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 60)); }
    return project;
  });
  reading = true;
  await assert.rejects(f.host.port(f.project.id, f.task.id, configuration)('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), /db_operation_budget_exhausted/);
  assert.equal(dispatches, 0, 'preparation cannot refresh the allowance before catalogue or business SQL');
});

test('Host refuses an overall failed catalogue instead of saving an empty discovery', async t => {
  let reading = false;
  const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => reading ? { ...structuredClone(catalog), observation: { ...catalog.observation, reachable: false, queryQualified: false }, objects: [] } : structuredClone(catalog), openQuery: async () => assert.fail('failed catalogue cannot dispatch a query') } });
  const saved = await f.save(); await f.grant(saved.id); reading = true;
  await assert.rejects(f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id }, callContext()), /db_catalog_failed/);
  assert.deepEqual(await fs.readdir(path.join(f.project.rootPath, '020_clean')), []);
});

test('Host HTTP saves only the exact tested configuration and binds grants to actual projects/tasks and model outlets', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.host.request('GET', '/api/db-link/connections'), { status: 200, body: { connections: [] } });
  const tested = await f.host.request('POST', '/api/db-link/connections/test', connection);
  assert.equal(tested?.status, 200, JSON.stringify(tested));
  const changed = await f.host.request('POST', '/api/db-link/connections', { configuration: { ...connection, host: 'different.invalid' }, testReceiptId: (tested!.body.receipt as { id: string }).id });
  assert.equal(changed?.body.code, 'db_test_required');
  const saved = await f.save(), granted = await f.grant(saved.id);
  assert.equal(granted.grant.projectId, f.project.id); assert.notEqual(granted.modelExport.targets[0], configuration.id);
  assert.equal(JSON.stringify(granted).includes('DATABASE_SECRET'), false); assert.equal(JSON.stringify(granted).includes('MODEL_SECRET'), false);
  const taskSources = await f.host.request('GET', f.taskPath); assert.equal((taskSources!.body.sources as unknown[]).length, 1);
  const foreign = await f.host.request('GET', `/api/projects/${randomUUID()}/tasks/${f.task.id}/db-link/sources`); assert.equal(foreign?.status, 404);
  const excluded = await f.host.request('PUT', `${f.taskPath}/${saved.id}`, { excluded: true }); assert.deepEqual(excluded?.body.sources, []);
  await f.projects.archive(f.project.id);
  assert.equal((await f.host.request('POST', f.sourcesPath, { connectionId: saved.id }))?.body.code, 'db_project_archived');
  assert.equal((await f.host.request('GET', f.sourcesPath))?.status, 200);
  assert.equal(await f.host.request('POST', `${f.sourcesPath}/query`, { sql: 'select 1' }), undefined);
});

const terminal = (patch: Partial<DbLinkQueryTerminal> = {}): DbLinkQueryTerminal => ({ status: 'completed', remoteTerminal: true, connectionEnded: true, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true }, rowsReceived: 2, serverRowCount: '2', columns: catalog.objects[0].columns.map(({ comment: _comment, readable: _readable, ...column }) => column), limitations: [], sourceIdentity: catalog.observation.sourceIdentity, permissionBinding: catalog.observation.permissionBinding, session: catalog.session, ...patch });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('Host returns bounded concrete pre-dispatch SQL errors for autonomous correction without adding an attempt limit', async t => {
  let dispatched = 0;
  const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async () => { dispatched++; return terminal(); } } });
  const saved = await f.save(); await f.grant(saved.id);
  const port = f.host.port(f.project.id, f.task.id, configuration), context = callContext();
  for (let attempt = 0; attempt < 7; attempt++) {
    const rejected = await port('query', { connectionId: saved.id, sql: 'select pg_sleep(1)' }, context);
    assert.equal(rejected.details.code, 'db_sql_function_not_allowed');
    assert.equal(rejected.details.phase, 'pre-dispatch');
    assert.equal(rejected.details.dispatched, false);
    assert.match(String(rejected.details.constraint), /函数|能力|查询/);
    assert.ok(rejected.content[0].text.length < 4000);
  }
  assert.equal(dispatched, 0);
});

test('Host returns proven no-resource driver rejection without fabricating actual source identity or blocking a corrected query', async t => {
  let calls = 0;
  const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_runtime, request) => {
    calls++;
    if (calls === 1) return terminal({ status: 'error', dispatched: false, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true }, sourceIdentity: '', permissionBinding: '', rowsReceived: 0, errorCode: 'db_segment_read_unsupported' });
    await request.onColumns(terminal().columns, catalog); await request.onRows([['1.0000']]);
    return terminal({ rowsReceived: 1, serverRowCount: '1' });
  } } });
  const saved = await f.save(); await f.grant(saved.id); const port = f.host.port(f.project.id, f.task.id, configuration);
  const rejected = await port('query', { connectionId: saved.id, sql: 'SELECT amount FROM public.orders' }, callContext());
  assert.equal(rejected.details.status, 'rejected'); assert.equal(rejected.details.phase, 'pre-dispatch'); assert.equal(rejected.details.dispatched, false); assert.equal(rejected.details.code, 'db_segment_read_unsupported');
  assert.equal(rejected.details.source, undefined); assert.equal(rejected.details.resultId, undefined);
  const before = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`); assert.deepEqual(before?.body.results, []);
  const corrected = await port('query', { connectionId: saved.id, sql: 'SELECT amount FROM public.orders' }, callContext());
  assert.equal(corrected.details.status, 'complete'); assert.equal(calls, 2);
});

test('Host retains terminal decoded acquisition independently of callback and persisted rows on error or UNKNOWN', async t => {
  for (const status of ['error', 'unknown'] as const) await t.test(status, async t => {
    const state = (value: boolean) => ({ remoteTerminal: value, connectionEnded: value, commandTerminal: value, transactionEnded: value });
    const original = { receivedBytes: 400, forwardedBytes: 384, maxReceiveBytes: 1024, maxReadBytes: 16, rejected: false, closed: true };
    const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_runtime, request) => {
      await request.onColumns(terminal().columns, catalog);
      await assert.rejects(Promise.resolve().then(() => request.onRows([['1.0000'], ['2.0000']])), /db_result_row_limit/);
      return terminal({ status, rowsReceived: 3, serverRowCount: null, resourceState: state(status !== 'unknown'), receiveFacts: { original }, errorCode: 'db_result_row_limit', cleanup: async () => state(true) });
    } } });
    const saved = await f.save({ ...connection, budget: { ...connection.budget, maxRows: 1 } }); await f.grant(saved.id);
    const cleanups: ((options: { retryFailed?: boolean }) => Promise<void>)[] = [];
    const pending = f.host.port(f.project.id, f.task.id, configuration)('query', { connectionId: saved.id, sql: 'SELECT amount FROM public.orders' }, callContext({ registerCleanup: cleanup => cleanups.push(cleanup) }));
    if (status === 'unknown') await assert.rejects(pending, /db_remote_termination_unknown/);
    else {
      const result = await pending;
      assert.equal(result.details.driverDecodedRows, 3); assert.equal(result.details.deliveredRows, 2); assert.equal(result.details.persistedRows, 1);
    }
    const listed = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`);
    const receipts = listed!.body.results as { id: string }[]; assert.equal(receipts.length, 1);
    const read = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results/${receipts[0]!.id}`);
    const manifest = read!.body.manifest as { receivedRows: number; persistedRows: number; acquisition: unknown };
    assert.equal(manifest.receivedRows, 2); assert.equal(manifest.persistedRows, 1);
    assert.deepEqual(manifest.acquisition, { driverReceivedRows: 3, rowAccounting: 'after-driver-decode', transport: { scope: 'physical-connection', receivedBytes: 400, forwardedBytes: 384, maxReceiveBytes: 1024, rejected: false } });
    await cleanups[0]!({ retryFailed: true });
  });
});

test('Host revocation aborts the owned driver, rejects late rows and waits for real terminal cleanup while retaining only cancelled history', async t => {
  const started = deferred<AbortSignal>(), finish = deferred<void>();
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_configuration, request) => {
    await request.onColumns(terminal().columns, catalog); await request.onRows([['1.0000']]); started.resolve(request.signal!); await finish.promise;
    await assert.rejects(Promise.resolve().then(() => request.onRows([['LATE']])), /db_source_changed|db_source_not_authorized/);
    return terminal({ status: 'cancelled', rowsReceived: 1, serverRowCount: null });
  } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id);
  const cleanups: (() => Promise<void>)[] = [], context = callContext({ registerCleanup: cleanup => cleanups.push(() => cleanup({})) });
  const pending = f.host.port(f.project.id, f.task.id, configuration)('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, context);
  const rejected = assert.rejects(pending, /db_source_changed|db_source_not_authorized/), signal = await started.promise;
  await f.host.request('DELETE', `${f.sourcesPath}/${saved.id}`); assert.equal(signal.aborted, true);
  let cleaned = false; const cleanup = cleanups[0]().then(() => { cleaned = true; }); await new Promise(resolve => setImmediate(resolve)); assert.equal(cleaned, false);
  finish.resolve(); await rejected; await cleanup; assert.equal(cleaned, true);
  const listed = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`), receipts = listed!.body.results as { id: string; status: string }[];
  assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'cancelled');
  const history = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results/${receipts[0].id}`); assert.deepEqual(history!.body.rowsPreview, [['1.0000']]);
});

test('Host keeps UNKNOWN resources busy and refuses further dispatch even after the driver returned; known terminal resources release permits', async t => {
  let calls = 0, unknown = true;
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_configuration, request) => {
    calls++; await request.onColumns(terminal().columns, catalog); await request.onRows([['1.0000']]); return unknown ? terminal({ status: 'unknown', remoteTerminal: false, connectionEnded: false, resourceState: { remoteTerminal: false, connectionEnded: false, commandTerminal: false, transactionEnded: false } }) : terminal({ rowsReceived: 1, serverRowCount: '1' });
  } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id); const port = f.host.port(f.project.id, f.task.id, configuration);
  const cleanups: (() => Promise<void>)[] = [];
  await assert.rejects(port('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext({ registerCleanup: cleanup => cleanups.push(() => cleanup({ retryFailed: true })) })), /db_remote_termination_unknown/);
  await assert.rejects(cleanups[0](), /db_remote_termination_unknown/); await assert.rejects(cleanups[0](), /db_remote_termination_unknown/);
  unknown = false; await assert.rejects(port('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), /db_connection_busy/); assert.equal(calls, 1);
  const second = await f.save({ ...connection, name: 'Independent source budget', host: 'independent.synthetic.invalid' }); await f.grant(second.id);
  const result = await port('query', { connectionId: second.id, sql: 'select amount from public.orders' }, callContext()); assert.equal(result.details.status, 'complete');
  assert.equal((await port('query', { connectionId: second.id, sql: 'select amount from public.orders' }, callContext())).details.status, 'complete');
});

test('explicit cleanup can reconcile only the held UNKNOWN operation before its connection permit is reused', async t => {
  let observedEnded = false, dispatched = 0, cleanupCalls = 0;
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async () => {
    dispatched++;
    return terminal({ status: 'unknown', remoteTerminal: false, connectionEnded: false, resourceState: { remoteTerminal: false, connectionEnded: false, commandTerminal: false, transactionEnded: false }, cleanup: async () => { cleanupCalls++; return { remoteTerminal: observedEnded, connectionEnded: observedEnded, commandTerminal: observedEnded, transactionEnded: observedEnded }; } });
  } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id);
  const cleanups: (() => Promise<void>)[] = [], port = f.host.port(f.project.id, f.task.id, configuration);
  await assert.rejects(port('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext({ registerCleanup: cleanup => cleanups.push(() => cleanup({ retryFailed: true })) })), /db_remote_termination_unknown/);
  await assert.rejects(cleanups[0](), /db_remote_termination_unknown/);
  assert.equal(dispatched, 1);
  observedEnded = true; await cleanups[0]();
  assert.equal(cleanupCalls, 2);
  await assert.rejects(port('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), /db_remote_termination_unknown/);
  assert.equal(dispatched, 2, 'only an explicit new call dispatches; cleanup itself never reruns SQL');
});

test('Host retains unknown query history separately from a proven original resource close', async t => {
  let calls = 0;
  const f = await fixture(t, { driver: { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_configuration, request) => {
    calls++; await request.onColumns(terminal().columns, catalog); await request.onRows([['1.0000']]);
    return terminal({ status: calls === 1 ? 'unknown' : 'completed', rowsReceived: 1, serverRowCount: calls === 1 ? null : '1', ...(calls === 1 ? { errorCode: 'db_query_result_unknown' } : {}) });
  } } });
  const saved = await f.save(); await f.grant(saved.id); const port = f.host.port(f.project.id, f.task.id, configuration);
  const unknown = await port('query', { connectionId: saved.id, sql: 'SELECT amount FROM public.orders' }, callContext());
  assert.equal(unknown.details.status, 'partial'); assert.equal(unknown.details.errorCode, 'db_query_result_unknown');
  assert.deepEqual(unknown.details.resourceState, catalog.resourceState);
  const next = await port('query', { connectionId: saved.id, sql: 'SELECT amount FROM public.orders' }, callContext());
  assert.equal(next.details.status, 'complete'); assert.equal(calls, 2);
  const history = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`);
  assert.deepEqual((history!.body.results as { status: string }[]).map(receipt => receipt.status).sort(), ['complete', 'partial']);
});

test('Host refuses native qualification loss, stale callbacks, malformed SQL and changed source identity before publishing complete results', async t => {
  let qualified = true, calls = 0, sourceChanged = false;
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => ({ ...structuredClone(catalog), observation: { ...catalog.observation, queryQualified: qualified } }), openQuery: async (_configuration, request) => {
    calls++; await request.onColumns(terminal().columns, catalog); await request.onRows([['1.0000']]); return terminal(sourceChanged ? { sourceIdentity: 'different-instance' } : {});
  } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id); const port = f.host.port(f.project.id, f.task.id, configuration);
  qualified = false;
  await assert.rejects(port('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), /db_query_not_qualified/); assert.equal(calls, 0);
  qualified = true; const unsupported = await port('query', { connectionId: saved.id, sql: 'select pg_sleep(1)' }, callContext());
  assert.equal(unsupported.details.code, 'db_sql_function_not_allowed'); assert.equal(unsupported.details.dispatched, false); assert.equal(calls, 0);
  const unqualified = await port('query', { connectionId: saved.id, sql: 'select amount from orders' }, callContext());
  assert.equal(unqualified.details.code, 'db_sql_object_unqualified'); assert.equal(unqualified.details.dispatched, false); assert.equal(calls, 0);
  await assert.rejects(port('sources', {}, callContext({ assertCurrent: () => { throw new Error('stale-request'); } })), /stale-request/);
  sourceChanged = true; await assert.rejects(port('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), /db_source_identity_changed/);
});

test('Host stores one same-operation segmented value through the original query sink and leaves SQL unchanged', async t => {
  const sql = "SELECT id,octet_length(convert_to(note,'UTF8')) AS total,substring(convert_to(note,'UTF8'),$1,$2) AS piece FROM public.orders WHERE id=$3";
  const segmentRead = { valueColumn: 2, totalBytesColumn: 1, keyColumns: [0] }, parameters = [{ kind: 'number' as const, value: '1' }, { kind: 'number' as const, value: '2' }, { kind: 'number' as const, value: '1' }];
  const columns = [{ ordinal: 0, name: 'id', databaseType: 'int8', typeId: 20, precision: null, scale: null }, { ordinal: 1, name: 'total', databaseType: 'int4', typeId: 23, precision: null, scale: null }, { ordinal: 2, name: 'piece', databaseType: 'text', typeId: 25, wireTypeId: 17, precision: null, scale: null }];
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_configuration, request) => {
    assert.equal(request.sql, sql); assert.deepEqual(request.parameters, parameters); assert.deepEqual(request.segmentRead, segmentRead);
    await request.onColumns(columns, catalog);
    const segment = { row: 0, column: 2, totalBytes: 4, representation: 'utf8' as const, databaseType: 'text', stableKey: ['1'] };
    assert.equal(await request.onValueSegment!({ ...segment, offset: 0, base64: Buffer.from('ab').toString('base64') }), undefined);
    const ref = await request.onValueSegment!({ ...segment, offset: 2, base64: Buffer.from('cd').toString('base64') });
    assert.ok(ref); await request.onRows([['1', '4', ref]]);
    return terminal({ rowsReceived: 1, serverRowCount: '1', columns });
  } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id);
  const port = f.host.port(f.project.id, f.task.id, configuration);
  const response = await port('query', { connectionId: saved.id, sql, parameters, segmentRead }, callContext());
  assert.equal(response.details.status, 'complete');
  const read = await port('read-result', { resultId: response.details.resultId }, callContext());
  assert.deepEqual((read.details.source as { segmentRead?: unknown }).segmentRead, segmentRead, 'the technical representation plan remains part of the exact query provenance');
  const rows = read.details.rows as unknown[][], ref = rows[0][2] as { type: string; valueId: string };
  assert.equal(rows.length, 1); assert.equal(ref.type, 'segmented');
  assert.equal((read.details.coverage as { complete: boolean }).complete, false);
  const value = await port('read-result', { resultId: response.details.resultId, valueId: ref.valueId, maxBytes: 4 }, callContext());
  assert.equal((value.details.value as { base64: string }).base64, Buffer.from('abcd').toString('base64'));
});

test('Host byte previews bind segmented values to the original task, live outlet and exact result', async t => {
  const f = await fixture(t), saved = await f.save(), granted = await f.grant(saved.id);
  const store = new DbLinkResults({ dataRoot: f.projects.dataRoot, projectDirectory: () => f.project.rootPath, assertAccess: () => {} });
  const owner = { projectId: f.project.id, taskId: f.task.id, requestId: randomUUID(), operationId: randomUUID() };
  const sink = await store.begin(owner, { connectionId: saved.id, connectionRevision: saved.revision, engine: 'postgresql', sourceIdentity: catalog.observation.sourceIdentity, sql: 'select amount from public.orders', parameters: [], observedObjects: ['public.orders'], declaredObjects: ['public.orders'], unknownObjects: [], startedAt: new Date().toISOString(), session: catalog.session, modelExport: granted.modelExport }, catalog.objects[0].columns, { maxRows: 1, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 });
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 6, representation: 'utf8', databaseType: 'text', stableKey: ['one'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('abcdef').toString('base64')); await sink.append([[await sink.completeValue(valueId)]]);
  const receipt = await sink.complete('1'), port = f.host.port(f.project.id, f.task.id, configuration);
  const result = await port('read-result', { resultId: receipt.id, valueId, startByte: 2, maxBytes: 2 }, callContext());
  assert.equal((result.details.value as { base64: string }).base64, Buffer.from('cd').toString('base64'));
  assert.equal((result.details.value as { coverage: { complete: boolean } }).coverage.complete, false);
  const other = await f.projects.createTask(f.project.id, { name: 'Other synthetic task' });
  await assert.rejects(f.host.port(f.project.id, other.id, configuration)('read-result', { resultId: receipt.id, valueId }, callContext()), /db_result_foreign_owner/);
  await f.host.request('DELETE', `${f.sourcesPath}/${saved.id}`);
  await assert.rejects(port('read-result', { resultId: receipt.id, valueId }, callContext()), /db_source_not_authorized/);
});

test('Host streams exact typed query results through original result files and bounds model/history readers by task and outlet', async t => {
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_configuration, request) => {
    assert.equal(request.sql, 'select amount from public.orders where amount > $1'); assert.deepEqual(request.parameters, [{ kind: 'number', value: '9007199254740993.0001' }]);
    await request.onColumns(terminal().columns, catalog); await request.onRows([['9007199254740993.0002'], ['123.4500']]); return terminal();
  } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id);
  const cleanups: (() => Promise<void>)[] = [], context = callContext({ registerCleanup: cleanup => cleanups.push(() => cleanup({})) }), port = f.host.port(f.project.id, f.task.id, configuration);
  const queried = await port('query', { connectionId: saved.id, sql: 'select amount from public.orders where amount > $1', parameters: [{ kind: 'number', value: '9007199254740993.0001' }], scopeNote: '只核本次选择的范围。' }, context), resultId = queried.details.resultId as string;
  assert.match(resultId, /^[a-f0-9-]{36}$/); assert.equal(queried.details.status, 'complete'); await Promise.all(cleanups.map(cleanup => cleanup()));
  const read = await port('read-result', { resultId, maxRows: 1 }, callContext()); assert.deepEqual(read.details.rows, [['9007199254740993.0002']]); assert.equal((read.details.coverage as { complete: boolean }).complete, false);
  const history = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results/${resultId}`); assert.equal(history?.status, 200); assert.deepEqual(history?.body.rowsPreview, [['9007199254740993.0002'], ['123.4500']]);
  const manifest = history!.body.manifest as { source: { sql: string; parameters: unknown[]; declaredObjects: string[]; observedObjects: string[] } };
  assert.equal(manifest.source.sql, 'select amount from public.orders where amount > $1'); assert.deepEqual(manifest.source.parameters, [{ kind: 'number', value: '9007199254740993.0001' }]); assert.deepEqual(manifest.source.declaredObjects, ['public.orders']); assert.deepEqual(manifest.source.observedObjects, ['public.orders']);
  const otherTask = await f.projects.createTask(f.project.id, { name: 'Other task' });
  await assert.rejects(f.host.port(f.project.id, otherTask.id, configuration)('read-result', { resultId }, callContext()), /db_result_foreign_owner/);
  await assert.rejects(f.host.port(f.project.id, f.task.id, { ...configuration, model: 'different' })('read-result', { resultId }, callContext()), /db_model_export_not_authorized/);
  await f.host.request('DELETE', `${f.sourcesPath}/${saved.id}`); await assert.rejects(port('read-result', { resultId }, callContext()), /db_source_not_authorized/);
  assert.equal((await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results/${resultId}`))?.status, 200);
  await f.projects.archive(f.project.id); assert.equal((await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`))?.status, 200);
});

test('Host describes only live authorized structure, freezes real metadata and refuses fabricated observation refs or changed model outlets', async t => {
  const f = await fixture(t), saved = await f.save(); await f.grant(saved.id);
  const port = f.host.port(f.project.id, f.task.id, configuration), context = callContext();
  const indexed = await port('sources', {}, context); assert.equal((indexed.details.sources as unknown[]).length, 1); assert.equal(JSON.stringify(indexed).includes('db.synthetic.invalid'), false);
  const described = await port('describe', { connectionId: saved.id }, context), ref = described.details.observationRef as string;
  assert.match(ref, /^[a-f0-9-]{36}$/); assert.equal(JSON.stringify(described).includes('confidential comment'), false);
  assert.equal(JSON.stringify(described).includes('select'), false);
  const description = { statements: [{ statementId: randomUUID(), scope: 'source-and-limitations', location: null, text: '业务口径未知；继续核查。', unit: null, provenance: 'unknown', confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [] };
  const savedDescription = await port('save-description', { observationRef: ref, operationId: randomUUID(), description }, callContext());
  assert.equal(savedDescription.details.structureOnly, true); assert.equal((await f.data.getIndex(f.project.id))?.datasets.length, 1);
  await assert.rejects(port('save-description', { observationRef: randomUUID(), operationId: randomUUID(), description }, callContext()), /db_metadata_not_found/);
  await assert.rejects(port('describe', { connectionId: saved.id, object: 'other.private' }, callContext()), /db_object_not_authorized/);
  const rotated = { ...configuration, revision: 2, apiKey: 'ROTATED' }; f.selected(rotated);
  assert.equal((await f.host.port(f.project.id, f.task.id, rotated)('sources', {}, callContext())).details.sources instanceof Array, true);
  await assert.rejects(f.host.port(f.project.id, f.task.id, { ...rotated, baseUrl: 'https://different.invalid' })('describe', { connectionId: saved.id }, callContext()), /db_model_export_not_authorized/);
  await f.host.request('DELETE', `${f.sourcesPath}/${saved.id}`);
  await assert.rejects(port('describe', { connectionId: saved.id }, callContext()), /db_source_not_authorized/);
  await assert.rejects(port('save-description', { observationRef: ref, operationId: randomUUID(), description }, callContext()), /db_source_not_authorized/);
  assert.equal((await f.data.getIndex(f.project.id))?.datasets.length, 1);
  await assert.rejects(port('sources', { owner: f.project.id }, callContext()), /db_link_invalid_arguments/);
});

test('Host metadata source proof rejects cross-project refs and modified exact source files; late catalog callbacks cannot create an observation', async t => {
  const started = deferred<void>(), finish = deferred<void>(); let delay = false, stale = false;
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => { if (delay) { started.resolve(); await finish.promise; } return structuredClone(catalog); }, openQuery: async () => terminal() };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id); const port = f.host.port(f.project.id, f.task.id, configuration);
  const result = await port('describe', { connectionId: saved.id }, callContext()), ref = result.details.observationRef as string;
  const other = await f.projects.create({ name: 'Other owner', configuration }), otherTask = await f.projects.createTask(other.id, { name: 'Other owner task' });
  await assert.rejects(f.host.metadataReader.read({ projectId: other.id, taskId: otherTask.id, requestId: 'synthetic', operationId: 'synthetic' }, ref), /db_metadata_foreign_owner/);
  const file = (await f.projects.get(f.project.id)).uploads.find(upload => upload.originalName.includes(ref))!;
  await fs.writeFile(path.join(f.project.rootPath, file.path), '{}');
  await assert.rejects(f.host.metadataReader.read({ projectId: f.project.id, taskId: f.task.id, requestId: 'synthetic', operationId: 'synthetic' }, ref), /db_metadata_source_changed/);
  const before = (await f.projects.get(f.project.id)).uploads.length;
  delay = true; const pending = port('describe', { connectionId: saved.id }, callContext({ assertCurrent: () => { if (stale) throw new Error('late-owner'); } }));
  const rejected = assert.rejects(pending, /late-owner/); await started.promise; stale = true; finish.resolve(); await rejected;
  assert.equal((await f.projects.get(f.project.id)).uploads.length, before);
});

test('Host does not return previously broader result objects after task scope narrows', async t => {
  const expanded: DbLinkCatalog = { ...structuredClone(catalog), objects: [...catalog.objects, { ...catalog.objects[0], object: 'private.accounts', schema: 'private', name: 'accounts' }] };
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(expanded), openQuery: async (_configuration, request) => { await request.onColumns(terminal().columns, catalog); await request.onRows([['123.4500']]); return terminal({ rowsReceived: 1, serverRowCount: '1' }); } };
  const f = await fixture(t, { driver }), saved = await f.save();
  await f.host.request('POST', f.sourcesPath, { connectionId: saved.id, scope: { objects: ['public.orders', 'private.accounts'] }, modelExport: { targets: [configuration.id], structure: true, comments: false, queryText: true, results: true } });
  const port = f.host.port(f.project.id, f.task.id, configuration), queried = await port('query', { connectionId: saved.id, sql: 'select amount from private.accounts' }, callContext());
  await f.host.request('PUT', `${f.taskPath}/${saved.id}`, { excluded: false, scope: { objects: ['public.orders'] } });
  await assert.rejects(port('read-result', { resultId: queried.details.resultId }, callContext()), /db_object_not_authorized/);
});

test('Host review material capability preserves historical fixed export after live revoke and refuses changed outlets, foreign tasks, legacy unbound exports and archived freezes', async t => {
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_configuration, request) => { await request.onColumns(terminal().columns, catalog); await request.onRows([['123.4500']]); return terminal({ rowsReceived: 1, serverRowCount: '1' }); } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id);
  const queried = await f.host.port(f.project.id, f.task.id, configuration)('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), resultId = queried.details.resultId as string;
  await f.host.request('DELETE', `${f.sourcesPath}/${saved.id}`);
  const material = await f.host.materialSource(f.project.id, f.task.id, resultId, { ...configuration, revision: 2, apiKey: 'rotated' }, callContext());
  assert.equal(material.receipt.id, resultId); assert.equal(material.files.length, 2); assert.equal(material.manifest.owner.taskId, f.task.id);
  await assert.rejects(f.host.materialSource(f.project.id, f.task.id, resultId, { ...configuration, baseUrl: 'https://another.invalid' }, callContext()), /db_model_export_not_authorized/);
  const otherTask = await f.projects.createTask(f.project.id, { name: 'Other task' });
  await assert.rejects(f.host.materialSource(f.project.id, otherTask.id, resultId, configuration, callContext()), /db_result_foreign_owner/);
  const oldResults = new DbLinkResults({ dataRoot: f.projects.dataRoot, projectDirectory: () => f.project.rootPath, assertAccess: () => {} });
  const legacy = await oldResults.begin({ projectId: f.project.id, taskId: f.task.id, requestId: 'old-host', operationId: 'old-host' }, { connectionId: saved.id, connectionRevision: 1, engine: 'postgresql', sourceIdentity: catalog.observation.sourceIdentity, sql: 'select amount from public.orders', parameters: [], observedObjects: ['public.orders'], declaredObjects: ['public.orders'], unknownObjects: [], startedAt: new Date().toISOString(), session: catalog.session }, terminal().columns, { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); await legacy.append([['1.0000']]); const old = await legacy.complete('1');
  await assert.rejects(f.host.materialSource(f.project.id, f.task.id, old.id, configuration, callContext()), /db_material_export_unbound/);
  const withheld = await oldResults.begin({ projectId: f.project.id, taskId: f.task.id, requestId: 'old-host', operationId: 'withheld-host' }, { connectionId: saved.id, connectionRevision: 1, engine: 'postgresql', sourceIdentity: catalog.observation.sourceIdentity, sql: 'select amount from public.orders', parameters: [], observedObjects: ['public.orders'], declaredObjects: ['public.orders'], unknownObjects: [], startedAt: new Date().toISOString(), session: catalog.session, modelExport: { targets: [dbLinkModelOutlet(configuration)], results: false, queryText: true, structure: true, comments: false } }, terminal().columns, { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); const withheldReceipt = await withheld.complete('0');
  await assert.rejects(f.host.materialSource(f.project.id, f.task.id, withheldReceipt.id, configuration, callContext()), /db_model_export_not_authorized/);
  const dataOnly = await oldResults.begin({ projectId: f.project.id, taskId: f.task.id, requestId: 'old-host', operationId: 'data-only-host' }, { connectionId: saved.id, connectionRevision: 1, engine: 'postgresql', sourceIdentity: catalog.observation.sourceIdentity, sql: 'select amount from public.orders', parameters: [], observedObjects: ['public.orders'], declaredObjects: ['public.orders'], unknownObjects: [], startedAt: new Date().toISOString(), session: catalog.session, modelExport: { targets: [dbLinkModelOutlet(configuration)], results: true, queryText: false, structure: false, comments: false } }, terminal().columns, { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); const dataReceipt = await dataOnly.complete('0');
  const hostOnly = await f.host.materialSource(f.project.id, f.task.id, dataReceipt.id, configuration, callContext()); assert.equal(hostOnly.receipt.id, dataReceipt.id); assert.equal(hostOnly.manifest.source.modelExport?.queryText, false);
  await assert.rejects(f.host.materialSource(f.project.id, f.task.id, dataReceipt.id, { ...configuration, baseUrl: 'https://another.invalid' }, callContext()), /db_model_export_not_authorized/);
  await f.projects.archive(f.project.id);
  await assert.rejects(f.host.materialSource(f.project.id, f.task.id, resultId, configuration, callContext()), /db_project_archived/);
  assert.equal((await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results/${resultId}`))?.status, 200);
});

test('Host source index does not leak physical object names when structure export is withheld', async t => {
  const f = await fixture(t), saved = await f.save();
  const granted = await f.host.request('POST', f.sourcesPath, { connectionId: saved.id, scope: { objects: ['public.orders'] }, modelExport: { targets: [configuration.id], structure: false, comments: false, queryText: false, results: true } }); assert.equal(granted?.status, 200);
  const index = await f.host.port(f.project.id, f.task.id, configuration)('sources', {}, callContext());
  assert.equal(JSON.stringify(index).includes('public.orders'), false);
  await assert.rejects(f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id }, callContext()), /db_model_export_not_authorized/);
});

test('Host metadata provides complete readable constraint groups only, including both authorized foreign-key ends', async t => {
  const column = (name: string, readable = true) => ({ ...catalog.objects[0].columns[0], name, readable, comment: null });
  const constrained: DbLinkCatalog = { ...structuredClone(catalog), objects: [{ ...catalog.objects[0], columns: [column('tenant_id'), column('amount'), column('secret_source', false)], primaryKey: ['tenant_id', 'secret_source'], foreignKeys: [
    { name: 'visible-composite', columns: ['tenant_id', 'amount'], referencedObject: 'public.customers', referencedColumns: ['tenant_id', 'id'] },
    { name: 'hidden-source', columns: ['tenant_id', 'secret_source'], referencedObject: 'public.customers', referencedColumns: ['tenant_id', 'id'] },
    { name: 'hidden-target', columns: ['tenant_id', 'amount'], referencedObject: 'public.customers', referencedColumns: ['tenant_id', 'secret_target'] },
    { name: 'missing-target', columns: ['amount'], referencedObject: 'public.not_observed', referencedColumns: ['unknown_column'] },
    { name: 'unauthorized-target', columns: ['amount'], referencedObject: 'private.denied', referencedColumns: ['private_column'] },
  ] }, { ...catalog.objects[0], object: 'public.customers', schema: 'public', name: 'customers', columns: [column('tenant_id'), column('id'), column('secret_target', false)] }, { ...catalog.objects[0], object: 'private.denied', schema: 'private', name: 'denied', columns: [column('private_column')] }] };
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(constrained), openQuery: async () => terminal() };
  const f = await fixture(t, { driver }), saved = await f.save();
  await f.host.request('POST', f.sourcesPath, { connectionId: saved.id, scope: { objects: ['public.orders', 'public.customers'] }, modelExport: { targets: [configuration.id], structure: true, comments: false, queryText: true, results: true } });
  const described = await f.host.port(f.project.id, f.task.id, configuration)('describe', { connectionId: saved.id, object: 'public.orders' }, callContext());
  const observation = described.details.observation as { coverage: { complete: boolean; limitations: string[] }; objects: { constraints: unknown[] }[] };
  assert.equal(/secret_source|secret_target|unknown_column|private_column/.test(JSON.stringify(described)), false);
  assert.deepEqual(observation.objects[0].constraints, [{ kind: 'foreign-key', columns: ['tenant_id', 'amount'], target: { database: 'synthetic', schema: 'public', object: 'customers', columns: ['tenant_id', 'id'] }, validation: 'unknown' }]);
  assert.equal(observation.coverage.complete, false); assert.ok(observation.coverage.limitations.includes('db_metadata_constraints_unavailable'));
  const proof = await f.host.metadataReader.read({ projectId: f.project.id, taskId: f.task.id, requestId: 'proof', operationId: 'proof' }, described.details.observationRef as string);
  assert.equal(/secret_source|secret_target|unknown_column|private_column/.test(JSON.stringify(proof.observation)), false);
});

test('Host refuses complete publication when the driver reports more rows than delivered even with unknown server count', async t => {
  const driver: DbLinkHostOptions['driver'] = { probe: async () => catalog.observation, catalog: async () => structuredClone(catalog), openQuery: async (_configuration, request) => { await request.onColumns(terminal().columns, catalog); await request.onRows([['1.0000']]); return terminal({ rowsReceived: 2, serverRowCount: null }); } };
  const f = await fixture(t, { driver }), saved = await f.save(); await f.grant(saved.id);
  await assert.rejects(f.host.port(f.project.id, f.task.id, configuration)('query', { connectionId: saved.id, sql: 'select amount from public.orders' }, callContext()), /db_query_row_count_mismatch/);
  const history = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results`), receipts = history!.body.results as { status: string }[];
  assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'partial');
});

test('Host resolves exact model references before grant and exposes the same canonical current outlet without allowing endpoint drift', async t => {
  const f = await fixture(t), saved = await f.save();
  const resolve = `/api/projects/${f.project.id}/db-link/model-targets?target=synthetic`;
  const resolved = await f.host.request('GET', resolve);
  assert.equal(resolved?.status, 200); assert.deepEqual(resolved?.body, { targets: ['synthetic@1'], canonicalTargets: [dbLinkModelOutlet(configuration)] });
  const granted = await f.host.request('POST', f.sourcesPath, { connectionId: saved.id, scope: { objects: ['public.orders'] }, modelExport: { targets: resolved!.body.targets, structure: true, comments: false, queryText: true, results: true } });
  assert.equal(granted?.status, 200);
  const current = await f.host.request('GET', f.taskPath); assert.deepEqual(current?.body.currentModelTarget, { reference: 'synthetic@1', canonical: dbLinkModelOutlet(configuration) });
  f.selected({ ...configuration, revision: 2, apiKey: 'rotated' });
  const rotated = await f.host.request('GET', resolve); assert.deepEqual(rotated?.body.canonicalTargets, resolved!.body.canonicalTargets); assert.deepEqual(rotated?.body.targets, ['synthetic@2']);
  f.selected({ ...configuration, revision: 3, baseUrl: 'https://different.invalid' });
  const changed = await f.host.request('POST', f.sourcesPath, { connectionId: saved.id, scope: { objects: ['public.orders'] }, modelExport: { targets: resolved!.body.targets, structure: true, comments: false, queryText: true, results: true } });
  assert.equal(changed?.body.code, 'db_model_target_unknown');
  const reread = await f.host.request('GET', f.sourcesPath); assert.deepEqual((reread!.body.sources as DbLinkSource[])[0].modelExport.targets, resolved!.body.canonicalTargets);
  const existing = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/model-targets?target=${encodeURIComponent(dbLinkModelOutlet(configuration))}`); assert.deepEqual(existing?.body.targets, [dbLinkModelOutlet(configuration)]);
});

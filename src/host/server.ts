import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { AgentRuntime, CONNECTION_PROMPT, SDK_VERSION } from '../agent/runtime.ts';
import { ProjectRuntimeError, type ProjectSnapshot } from '../agent/project-runtime.ts';
import { ConfigurationStore, ConfigurationStoreError, TARGET_MODELS } from './config-store.ts';
import { ProjectStore, ProjectStoreFault, type ProjectRecord, type TaskRecord } from './project-store.ts';
import { CaseStore, CaseStoreError } from './case-store.ts';
import { createCaseRoutes, CaseRouteError } from './case-routes.ts';
import type { CaseContextSelection } from './case-types.ts';
import { loadStaticUi } from './static-ui.ts';
import { createMetricFactoryRoutes } from '../../extensions/business-plugins/metric-factory/api/routes.ts';
import { metricIndexText } from '../../extensions/business-plugins/metric-factory/project/index-text.ts';
import { createRequirementRoutes } from '../../extensions/business-plugins/requirements-elaboration/api/routes.ts';
import { composeRequirementContext } from '../../extensions/business-plugins/requirements-elaboration/api/context.ts';
import { requirementSessionDirectory, requirementWorkspace } from '../../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { createRequirementSessions } from './requirement-sessions.ts';
import { createAgentSessionDomain, type SessionContext } from './agent-sessions.ts';
import { savedTaskHistory, priorTaskRequest, ProjectHistoryError } from './project-history.ts';

class RequestFault extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
function json(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value));
}
function body(request: IncomingMessage, limit = 65_536): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return Promise.reject(new RequestFault(415, 'json_required'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0, failed = false;
    request.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > limit) { failed = true; chunks.length = 0; reject(new RequestFault(413, 'request_too_large')); } else if (!failed) chunks.push(chunk); });
    request.on('end', () => { if (failed) return; try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); } catch { reject(new RequestFault(400, 'invalid_json')); } });
    request.on('error', () => reject(new RequestFault(400, 'request_interrupted')));
  });
}

export function createHost(options: { cwd: string; uiPorts: number[]; transportVersion: string; connectionTimeoutMs?: number; dataRoot?: string; projectsRoot?: string; staticUiRoot?: string; instanceId?: string }) {
  const dataRoot = options.dataRoot ?? path.join(os.homedir(), '.optracall'), projectsRoot = options.projectsRoot ?? path.join(os.homedir(), 'OptraCallProjects');
  const configuration = new ConfigurationStore({ dataRoot }), projects = new ProjectStore({ dataRoot, projectsRoot }), cases = new CaseStore({ dataRoot });
  let staticUi: Awaited<ReturnType<typeof loadStaticUi>> | undefined;
  const instanceId = options.instanceId ?? randomUUID();
  const ready = (async () => { if (options.staticUiRoot) staticUi = await loadStaticUi(options.staticUiRoot); await projects.init(); await cases.init(); await configuration.init(); })();
  type ProjectOwner = { project: ProjectRecord; task: TaskRecord };
  const streams = new Map<string, Set<ServerResponse>>();
  const clearing = new Map<string, number>(), archiving = new Set<string>();
  let gate = Promise.resolve(), testing = false, closing = false, clearingAll = 0;
  // metric-factory business plugin: the extension owns handlers, the host owns transport.
  const metricFactoryRoutes = createMetricFactoryRoutes({
    libraryRoot: path.join(dataRoot, 'metric-assets'),
    projectDataDirectory: (projectId: string) => path.join(dataRoot, 'projects', projectId),
    projectExists: async (projectId: string) => { try { await projects.get(projectId); return true; } catch { return false; } },
    projectOverview: async () => (await projects.list()).map(({ id, name, archivedAt }) => ({ id, name, archivedAt })),
    readProjectFile: (projectId: string, relativePath: string) => projects.readFile(projectId, relativePath),
    readBody: (request: IncomingMessage) => body(request),
  });
  const keyOf = (projectId: string, taskId: string) => `${projectId}/${taskId}`;
  const mutate = <T,>(operation: () => T | Promise<T>): Promise<T> => { const result = gate.then(operation); gate = result.then(() => {}, () => {}); return result; };
  const endStreams = (id?: string) => { for (const [key, responses] of streams) { if (id && key !== id) continue; for (const response of responses) response.end(); streams.delete(key); } };
  const publish = (projectId: string, taskId: string, event: object) => { for (const response of streams.get(keyOf(projectId, taskId)) ?? []) if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify({ ...event, projectId, taskId })}\n\n`); };
  const availableConfiguration = (id?: string, revision?: number) => {
    const snapshot = configuration.snapshot(id, revision);
    return snapshot && !clearingAll && !clearing.has(snapshot.provider) ? snapshot : undefined;
  };
  const projectSessions = createAgentSessionDomain<ProjectOwner>({
    name: 'project-tasks',
    profile: {
      key: owner => keyOf(owner.project.id, owner.task.id),
      projectId: owner => owner.project.id,
      configuration: owner => availableConfiguration(owner.task.configuration.id, owner.task.configuration.revision),
      admit: async owner => {
        if (closing) throw new RequestFault(503, 'host_closing');
        const { task } = await pair(owner.project.id, owner.task.id, true);
        if (clearing.has(task.configuration.provider)) throw new RequestFault(409, 'configuration_required');
      },
      agentOptions: async owner => {
        const { project, task } = await pair(owner.project.id, owner.task.id, true), address = server.address();
        return { projectId: project.id, projectDirectory: project.rootPath, sessionDirectory: task.sessionDirectory, sessionFile: task.sessionFile, draft: task.draft, codeRoot: options.cwd, resourceRoot: path.join(dataRoot, 'pi'), managementPorts: [...options.uiPorts, typeof address === 'object' && address ? address.port : 4175], metricIndexText: metricIndexText({ dataRoot, projectId: project.id }) };
      },
      capabilities: { commands: true, ui: true, editor: true },
    },
    configurationSnapshot: availableConfiguration,
    mutate,
    isClosing: () => closing,
    publish: (owner, event, context) => {
      const { project, task } = owner;
      // Project terminal means the operation, persistence and final snapshot have
      // drained. It is projected after withSession settles, not at SDK turn end.
      if (event.type === 'run.settled') return;
      // Queue all projections in native order. Publishing a UI question ahead
      // of an earlier snapshot would let that snapshot clear the new question.
      void mutate(async () => {
        if (!context.isCurrent()) return;
        if (event.type === 'ui.editor' || event.type === 'snapshot') {
          const current = await pair(project.id, task.id);
          if (!context.isCurrent() || current.project.archivedAt !== null) return;
          if (event.type === 'ui.editor') await projects.saveDraft(project.id, task.id, event.text);
          else if (event.snapshot.sessionFile && current.task.sessionFile !== event.snapshot.sessionFile) await projects.setSession(project.id, task.id, event.snapshot.sessionFile);
        }
        if (context.isCurrent()) publish(project.id, task.id, event);
      }).catch(() => { if (context.isCurrent()) publish(project.id, task.id, { type: 'ui.notification', level: 'error', message: '扩展修改的草稿或会话指针未能保存，请检查本地存储后重试。' }); });
    },
  });
  // requirements-elaboration plugin sessions use the generalized runtime entry with
  // a workspace instead of a project; this seam is flagged for dedicated Codex review.
  const requirementStreams = new Map<string, Set<ServerResponse>>();
  const publishRequirement = (instanceId: string, event: object) => { for (const response of requirementStreams.get(instanceId) ?? []) if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify({ ...event, instanceId })}\n\n`); };
  const requirementSessions = createRequirementSessions({
    codeRoot: options.cwd,
    resourceRoot: path.join(dataRoot, 'pi'),
    managementPorts: () => { const address = server.address(); return [...options.uiPorts, address && typeof address === 'object' ? address.port : 4175]; },
    sessionDirectory: instanceId => requirementSessionDirectory(path.join(dataRoot, 'requirement-instances', instanceId)),
    workspaceFor: instanceId => requirementWorkspace(path.join(dataRoot, 'requirement-instances', instanceId)),
    configurationSnapshot: availableConfiguration,
    publish: publishRequirement,
    mutate,
    isClosing: () => closing,
  });
  const requirementPlugin = createRequirementRoutes({
    storeRoot: path.join(dataRoot, 'requirement-instances'),
    readBody: request => body(request),
    sessions: Object.freeze({ run: requirementSessions.run, withSession: requirementSessions.withSession, stop: requirementSessions.stop, busy: requirementSessions.busy }),
  });
  const closeAgents = async (filter: { provider?: string; projectId?: string } = {}) => {
    // Only coordinate domain controls; each domain owns its resource ledger.
    const results = await Promise.allSettled([
      projectSessions.closeAll(filter),
      ...(!filter.projectId ? [requirementSessions.closeAll(filter)] : []),
    ]);
    for (const key of [...streams.keys()]) {
      const [projectId, taskId] = key.split('/');
      if (filter.projectId && projectId !== filter.projectId) continue;
      if (filter.provider) {
        try { if ((await pair(projectId!, taskId!)).task.configuration.provider !== filter.provider) continue; } catch { continue; }
      }
      endStreams(key);
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'session_close_failed');
  };
  function assertActive(project: ProjectRecord) {
    if (project.archivedAt !== null) throw new RequestFault(409, 'project_archived');
    if (archiving.has(project.id)) throw new RequestFault(409, 'project_busy');
  }
  function decorateProject(project: ProjectRecord) {
    try { if (cases.getStatus().state === 'ready') return { ...project, work: cases.getProjectWork(project.id), workUnavailable: false }; } catch {}
    return { ...project, work: null, workUnavailable: true };
  }
  const caseRoutes = createCaseRoutes({ cases, projects, configuration, mutate, assertActive, decorateProject });
  // SDK request IDs are task-local. Namespace the SQLite receipt while retaining
  // the original request ID for the native run and its existing retry ledger.
  const contextOperationId = (projectId: string, taskId: string, requestId: string) => {
    const hex = createHash('sha256').update(JSON.stringify(['task_context_prepare', projectId, taskId, requestId])).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  };
  // 送入：requirement contract summary composed at send time; later edits never
  // flow back into an already-sent message.
  const requirementSelection = (input: Record<string, unknown>): { instanceId: string; version?: string } | undefined => {
    if (input.requirementContext === undefined) return undefined;
    const selection = input.requirementContext;
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new RequestFault(400, 'invalid_requirement_context');
    const instanceId = String((selection as Record<string, unknown>).instanceId ?? '');
    const rawVersion = (selection as Record<string, unknown>).version;
    return { instanceId, ...(rawVersion === undefined ? {} : { version: String(rawVersion) }) };
  };
  const requirementPrefix = (input: Record<string, unknown>): string | undefined => {
    const selection = requirementSelection(input);
    if (!selection) return undefined;
    try { return composeRequirementContext(requirementPlugin.store, selection.instanceId, selection.version); }
    catch (error) {
      const code = (error as { code?: string }).code ?? 'requirement_unavailable';
      throw new RequestFault(code === 'REQ_STORE_NOT_FOUND' ? 404 : 409, code === 'REQ_STORE_NOT_FOUND' ? 'not_found' : 'requirement_unavailable');
    }
  };
  const requestFingerprint = (input: Record<string, unknown>): string | undefined => {
    const requirement = requirementSelection(input);
    if (!requirement) return undefined;
    const selection = input.caseContext as CaseContextSelection | undefined;
    const caseContext = selection && typeof selection === 'object' && !Array.isArray(selection) ? { caseId: selection.caseId, caseRevision: selection.caseRevision, projectWorkRevision: selection.projectWorkRevision, selectedReferenceIds: selection.selectedReferenceIds } : selection ?? null;
    return createHash('sha256').update(JSON.stringify(['optracall_request_v1', input.text, caseContext, requirement])).digest('hex');
  };
  async function prepareCasePrompt(projectId: string, taskId: string, input: Record<string, unknown>, accepted = false) {    const operationId = contextOperationId(projectId, taskId, input.requestId as string);
    const existing = cases.getStatus().state === 'ready' ? cases.getOperation(operationId) : null;
    if (input.caseContext === undefined) {
      if (existing) throw new CaseStoreError('operation_conflict', 409);
      return input.text as string;
    }
    if (accepted && !existing) throw new CaseStoreError('operation_conflict', 409);
    if (!input.caseContext || typeof input.caseContext !== 'object' || Array.isArray(input.caseContext)) throw new CaseStoreError('invalid_context');
    const selection = input.caseContext as CaseContextSelection;
    if (!Array.isArray(selection.selectedReferenceIds)) throw new CaseStoreError('invalid_context_reference');
    if (!existing) {
      const references = cases.getArtifacts(selection.caseId), links = cases.listProjectLinks(selection.caseId);
      for (const id of selection.selectedReferenceIds) {
        const ref = references.find(item => item.id === id);
        if (!ref || ref.unlinkedAt || ref.projectId !== projectId || !links.some(link => link.projectId === ref.projectId)) throw new CaseStoreError('invalid_context_reference', 409);
        const observed = await projects.observeFile(ref.projectId, ref.relativePath);
        if (ref.observedSha256 !== null && (ref.observedSha256 !== observed.sha256 || ref.observedBytes !== observed.bytes)) throw new CaseStoreError('context_reference_changed', 409);
      }
    }
    return cases.prepareTaskContext({ operationId, projectId, taskId, userPrompt: input.text as string, selection }).composedPrompt;
  }
  async function pair(projectId: string, taskId: string, writable = false) {
    const project = await projects.get(projectId), task = project.tasks.find(value => value.id === taskId);
    if (!task) throw new RequestFault(404, 'task_not_found');
    if (writable) assertActive(project);
    return { project, task };
  }
  async function projectBusy(projectId: string) {
    const project = await projects.get(projectId);
    return project.tasks.some(task => projectSessions.busy(projectSessions.ref({ project, task })));
  }
  const priorRequest = priorTaskRequest;
  const savedHistory = (project: ProjectRecord, task: TaskRecord, capabilities: Record<string, unknown> = {}) => savedTaskHistory(project, task, SDK_VERSION, capabilities);
  async function taskState(projectId: string, taskId: string, activate = false, inMutation = false) {
    let { project, task } = await pair(projectId, taskId);
    const ref = projectSessions.ref({ project, task });
    let current = await projectSessions.read(ref), snapshot: ProjectSnapshot;
    const interrupted = !current.live && !current.opening && (Boolean(current.context) || ['running', 'interrupted'].includes(task.lastRun?.status ?? ''));
    if (activate) assertActive(project);
    try {
      if (project.archivedAt !== null) snapshot = savedHistory(project, task, { projectArchived: true });
      else if (current.live && current.snapshot) snapshot = current.snapshot;
      else if (activate && !interrupted) {
        await projectSessions.open(ref); current = await projectSessions.read(ref);
        snapshot = current.snapshot!;
        if (snapshot?.sessionFile) await mutate(async () => {
          if (current.context?.isCurrent()) await projects.setSession(projectId, taskId, snapshot.sessionFile!);
        });
        ({ project, task } = await pair(projectId, taskId));
      } else { configuration.snapshot(task.configuration.id, task.configuration.revision); snapshot = savedHistory(project, task, interrupted ? { runtimeInterrupted: true } : { uninitialized: true }); }
    } catch (error) { if (!(error instanceof ConfigurationStoreError)) throw error; snapshot = savedHistory(project, task, { requiresConfiguration: true }); }
    const reconcile = async () => {
      const latest = await pair(projectId, taskId);
      if (latest.project.archivedAt !== null || projectSessions.busy(ref) || !latest.task.lastRun || latest.task.lastRun.id !== task.lastRun?.id || !['running', 'interrupted'].includes(latest.task.lastRun.status)) return;
      const proven = snapshot.lastRun?.requestId === latest.task.lastRun.id ? snapshot.lastRun.outcome : undefined;
      if (proven || latest.task.lastRun.status === 'running') await projects.markRun(projectId, taskId, { ...latest.task.lastRun, status: proven ?? 'interrupted', settledAt: new Date().toISOString() });
    };
    if (task.lastRun && ['running', 'interrupted'].includes(task.lastRun.status)) {
      if (inMutation) await reconcile(); else await mutate(reconcile);
      ({ project, task } = await pair(projectId, taskId));
    }
    snapshot.uiRequests = current.pendingUI.map(event => event.request);
    return { project: decorateProject(project), task, snapshot };
  }
  async function settleProjectRun(owner: ProjectOwner, context: SessionContext<ProjectOwner>, requestId: string, startedAt: string, result?: Record<string, any>) {
    await mutate(async () => {
      const { project, task } = await pair(owner.project.id, owner.task.id);
      if (!context.isCurrent() || task.lastRun?.id !== requestId) return;
      const file = result?.sessionFile ?? result?.snapshot?.sessionFile;
      if (file) await projects.setSession(project.id, task.id, file);
      const outcome = result?.outcome ?? result?.snapshot?.lastRun?.outcome;
      await projects.markRun(project.id, task.id, { id: requestId, status: ['completed', 'cancelled', 'failed'].includes(outcome) ? outcome : 'interrupted', startedAt, settledAt: new Date().toISOString() });
    });
  }
  const server = createServer((request, response) => { void (async () => {
    try {
      await ready;
      const host = new URL(`http://${request.headers.host ?? ''}`), address = server.address();
      if (!['127.0.0.1', 'localhost'].includes(host.hostname) || !address || typeof address === 'string' || Number(host.port) !== address.port) throw new RequestFault(403, 'host_rejected');
      const origin = request.headers.origin, allowed = [...options.uiPorts, address.port].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
      if (origin && !allowed.includes(origin)) throw new RequestFault(403, 'origin_rejected');
      const url = new URL(request.url ?? '/', host);
      if (url.pathname === '/api/health' && request.method === 'GET') { json(response, 200, { status: 'ready', sdkVersion: SDK_VERSION, transportVersion: options.transportVersion, chatMode: 'live', credentials: 'host-persistent', filePolicy: 'soft-prompt-no-sensitive-data-isolation', ...(staticUi ? { runtime: { instanceId, pid: process.pid, codeRoot: path.resolve(options.cwd), version: staticUi.build.version, commit: staticUi.build.commit, tree: staticUi.build.tree, builtAt: staticUi.build.builtAt, dirty: staticUi.build.dirty } } : {}) }); return; }
      if (staticUi && !url.pathname.startsWith('/api/') && url.pathname !== '/api') {
        if (staticUi.serve(request, response, url)) return;
        throw new RequestFault(404, 'not_found');
      }
      if (request.headers['x-optracall-client'] !== '1' || (request.method !== 'GET' && !origin)) throw new RequestFault(403, 'client_rejected');
      const metricFactory = await metricFactoryRoutes(request, url);
      if (metricFactory) { json(response, metricFactory.status, metricFactory.value); return; }
      const requirementEvent = /^\/api\/requirement-instances\/(req-[a-z0-9][a-z0-9-]{0,60})\/events$/.exec(url.pathname);
      if (requirementEvent && request.method === 'GET') {
        const instanceId = requirementEvent[1]!;
        try { requirementPlugin.store.read(instanceId); } catch { throw new RequestFault(404, 'not_found'); }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.flushHeaders();
        const responses = requirementStreams.get(instanceId) ?? new Set(); responses.add(response); requirementStreams.set(instanceId, responses); response.write(': requirement connection\n\n');
        response.once('close', () => { responses.delete(response); if (!responses.size) requirementStreams.delete(instanceId); });
        return;
      }
      const requirement = await requirementPlugin.routes(request, url);
      if (requirement) { json(response, requirement.status, requirement.value); return; }
      if (url.pathname === '/api/configurations' && request.method === 'GET') { json(response, 200, { configurations: configuration.list(), selectedId: configuration.read()?.id ?? null }); return; }
      if (url.pathname === '/api/configuration/select' && request.method === 'POST') { const input = await body(request); json(response, 200, { configuration: await mutate(() => configuration.select(String(input.id ?? ''))) }); return; }
      if (url.pathname === '/api/configuration/import' && request.method === 'POST') {
        const input = await body(request), credentials = input.credentials;
        if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new RequestFault(400, 'invalid_credentials_file');
        const imported: string[] = [];
        await mutate(async () => { for (const profile of TARGET_MODELS) {
          const credential = (credentials as Record<string, any>)[profile.provider]; if (!credential) continue;
          if (credential.type !== 'api_key' || typeof credential.key !== 'string') throw new RequestFault(400, 'invalid_credentials_file');
          await configuration.save({ ...profile, apiKey: credential.key }); imported.push(profile.id);
        } });
        if (!imported.length) throw new RequestFault(400, 'no_target_credentials');
        json(response, 200, { imported, configurations: configuration.list(), configuration: configuration.read() }); return;
      }
      if (url.pathname === '/api/configuration') {
        if (request.method === 'GET') { json(response, 200, { configuration: configuration.read() }); return; }
        if (request.method === 'PUT') { const input = await body(request); const saved = await mutate(async () => { const value = await configuration.save(input); await configuration.select(value.id); return value; }); json(response, 200, { configuration: saved }); return; }
        if (request.method === 'DELETE') {
          const provider = url.searchParams.get('provider') ?? undefined;
          const providers = await mutate(() => {
            const values = provider ? [provider] : [...new Set(configuration.list().map(value => value.provider))];
            for (const value of values) clearing.set(value, (clearing.get(value) ?? 0) + 1);
            if (!provider) clearingAll++;
            return values;
          });
          // Cancellation/drain is outside the business mutation gate: completions
          // and opening checks must be able to acquire that gate while clearing.
          try { await closeAgents({ provider }); await mutate(() => configuration.clear(provider)); }
          finally { await mutate(() => {
            for (const value of providers) {
              const remaining = (clearing.get(value) ?? 1) - 1;
              if (remaining) clearing.set(value, remaining); else clearing.delete(value);
            }
            if (!provider) clearingAll--;
          }); }
          json(response, 200, { configuration: configuration.read() }); return;
        }
      }
      if (url.pathname === '/api/connection-test' && request.method === 'POST') {
        const input = await body(request);
        if (Object.keys(input).some(key => key !== 'revision')) throw new RequestFault(400, 'fixed_test_only');
        if (testing) throw new RequestFault(409, 'test_busy'); testing = true;
        const probe = new AgentRuntime(path.join(path.parse(options.cwd).root, 'optracall-virtual'));
        let id: string | undefined, timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
        const cancel = () => { if (id && !response.writableEnded) void probe.stop(id).catch(() => {}); }; response.once('close', cancel);
        try {
          const ticket = await mutate(async () => {
            const snapshot = configuration.snapshot(); if (!snapshot) throw new RequestFault(409, 'configuration_required');
            if (input.revision !== snapshot.revision) throw new RequestFault(409, 'configuration_changed');
            return { snapshot, session: await probe.create(`connection-${randomUUID()}`, { name: snapshot.name, provider: 'openai-compatible', baseUrl: snapshot.baseUrl, model: snapshot.model, revision: snapshot.revision, apiKey: snapshot.apiKey, api: snapshot.api, sdkProvider: snapshot.provider }) };
          });
          id = ticket.session.id; if (response.destroyed) return;
          const run = probe.start(id, CONNECTION_PROMPT);
          timer = setTimeout(() => { timedOut = true; void probe.stop(ticket.session.id).catch(() => {}); }, options.connectionTimeoutMs ?? 15_000);
          const result = await run.completion; if (response.destroyed) return;
          if (timedOut) throw new RequestFault(504, 'connection_timeout'); if (result.outcome !== 'completed') throw new RequestFault(502, 'connection_failed');
          json(response, 200, { ok: true, revision: ticket.snapshot.revision, reply: result.text.slice(0, 300), message: '已通过统一 Pi SDK 收到固定短句回复。' });
        } finally { if (timer) clearTimeout(timer); response.off('close', cancel); await probe.clear(); testing = false; } return;
      }
      if (url.pathname.startsWith('/api/cases') || /^\/api\/projects\/[a-f0-9-]+\/work(?:\/|$)/.test(url.pathname)) {
        const result = await caseRoutes({ pathname: url.pathname, method: request.method ?? 'GET', ...(['POST', 'PATCH', 'DELETE'].includes(request.method ?? '') ? { input: await body(request, 1024 * 1024) } : {}) });
        if (result) { json(response, result.status ?? 200, result.body); return; }
      }
      if (url.pathname === '/api/projects') {
        if (request.method === 'GET') { json(response, 200, { projects: (await projects.list()).map(decorateProject) }); return; }
        if (request.method === 'POST') {
          const input = await body(request), value = await mutate(async () => { const selected = configuration.read(typeof input.configurationId === 'string' ? input.configurationId : undefined); if (!selected?.hasApiKey) throw new RequestFault(409, 'configuration_required'); return projects.create({ name: String(input.name ?? ''), configuration: selected }); });
          json(response, 201, { project: decorateProject(value) }); return;
        }
      }
      const match = /^\/api\/projects\/([a-f0-9-]+)(?:\/(.*))?$/.exec(url.pathname);
      if (match) {
        const projectId = match[1]!, action = match[2];
        if (!action && request.method === 'GET') { json(response, 200, { project: decorateProject(await projects.get(projectId)) }); return; }
        if (!action && request.method === 'PATCH') { const input = await body(request); json(response, 200, { project: decorateProject(await mutate(async () => { assertActive(await projects.get(projectId)); return projects.rename(projectId, String(input.name ?? '')); })) }); return; }
        if (action === 'archive' && request.method === 'POST') {
          await body(request);
          const project = await mutate(async () => {
            let value = await projects.get(projectId);
            if (value.archivedAt !== null) return value;
            archiving.add(projectId);
            try {
              if (await projectBusy(projectId)) throw new RequestFault(409, 'project_busy');
              for (const task of value.tasks) if (task.lastRun?.status === 'running') await taskState(projectId, task.id, false, true);
              value = await projects.get(projectId);
              if (await projectBusy(projectId) || value.tasks.some(task => task.lastRun?.status === 'running')) throw new RequestFault(409, 'project_busy');
              const archived = await projects.archive(projectId); await closeAgents({ projectId }); return archived;
            } finally { archiving.delete(projectId); }
          }); json(response, 200, { project: decorateProject(project) }); return;
        }
        if (action === 'restore' && request.method === 'POST') { await body(request); json(response, 200, { project: decorateProject(await mutate(() => projects.restore(projectId))) }); return; }
        if (action === 'tasks' && request.method === 'POST') {
          const input = await body(request), task = await mutate(async () => {
            const project = await projects.get(projectId); assertActive(project);
            const selected = typeof input.configurationId === 'string' ? configuration.read(input.configurationId) : project.configuration;
            if (!selected || !configuration.snapshot(selected.id, selected.revision)) throw new RequestFault(409, 'configuration_required');
            return projects.createTask(projectId, { name: String(input.name ?? ''), configuration: selected });
          }); json(response, 201, { task }); return;
        }
        if (action === 'files' && request.method === 'GET') { json(response, 200, { files: await projects.tree(projectId) }); return; }
        if (action === 'files/upload' && request.method === 'POST') {
          const input = await body(request, 14 * 1024 * 1024);
          if (typeof input.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)) throw new RequestFault(400, 'invalid_file_encoding');
          if (input.directory !== undefined && input.directory !== '010_draw' && input.directory !== '020_clean') throw new RequestFault(400, 'invalid_upload_directory');
          json(response, 201, { file: await projects.upload({ projectId, name: String(input.name ?? ''), bytes: Buffer.from(input.content, 'base64'), directory: input.directory as '010_draw' | '020_clean' | undefined }) }); return;
        }
        if (action === 'files/copy-to-clean' && request.method === 'POST') { const input = await body(request); json(response, 201, { file: await projects.copyToClean(projectId, String(input.path ?? '')) }); return; }
        if (action === 'files/save-report' && request.method === 'POST') { const input = await body(request, 14 * 1024 * 1024); json(response, 201, { file: await projects.saveReport(projectId, String(input.name ?? ''), String(input.text ?? '')) }); return; }
        if (action === 'files/content' && request.method === 'GET') { const file = await projects.readFile(projectId, url.searchParams.get('path') ?? ''); response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(file.bytes); return; }
        const taskRoute = /^tasks\/([a-f0-9-]+)(?:\/(.*))?$/.exec(action ?? '');
        if (taskRoute) {
          const taskId = taskRoute[1]!, operation = taskRoute[2], key = keyOf(projectId, taskId);
          if (!operation && request.method === 'GET') { json(response, 200, await taskState(projectId, taskId)); return; }
          if (operation === 'open' && request.method === 'POST') { await body(request); const state = await taskState(projectId, taskId, true); publish(projectId, taskId, { type: 'snapshot', snapshot: state.snapshot }); json(response, 200, state); return; }
          if (operation === 'draft' && request.method === 'PATCH') {
            const input = await body(request), text = String(input.text ?? '');
            const owner = await pair(projectId, taskId, true);
            const task = await mutate(async () => { await pair(projectId, taskId, true); return projects.saveDraft(projectId, taskId, text); });
            await projectSessions.setEditorState(projectSessions.ref(owner), text).catch(() => {});
            json(response, 200, { task }); return;
          }
          if (operation === 'events' && request.method === 'GET') {
            await pair(projectId, taskId);
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.flushHeaders();
            const responses = streams.get(key) ?? new Set(); responses.add(response); streams.set(key, responses); response.write(': task connection\n\n');
            response.once('close', () => { responses.delete(response); if (!responses.size) streams.delete(key); });
            try { const state = await taskState(projectId, taskId); if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: state.snapshot, projectId, taskId })}\n\n`); }
            catch { if (!response.destroyed && !response.writableEnded) { response.write(`data: ${JSON.stringify({ type: 'stream.error', message: '任务连接未就绪，请检查模型配置或重新连接。', projectId, taskId })}\n\n`); response.end(); } }
            return;
          }
          if (operation === 'messages' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) throw new RequestFault(400, 'invalid_message');
            const requestId = input.requestId, fingerprint = requestFingerprint(input), owner = await pair(projectId, taskId, true);
            const known = await priorRequest(owner.project, owner.task, requestId, fingerprint);
            if (known) {
              await mutate(async () => { await prepareCasePrompt(projectId, taskId, input, true); requirementPrefix(input); });
              json(response, 202, { requestId, status: known, deduplicated: true }); return;
            }
            let accepted = false, terminalContext: SessionContext<ProjectOwner> | undefined;
            let acknowledge!: () => void, rejectAcknowledgement!: (error: unknown) => void;
            const acknowledged = new Promise<void>((resolve, reject) => { acknowledge = resolve; rejectAcknowledgement = reject; });
            const completion = projectSessions.withSession(projectSessions.ref(owner), async lease => {
              let startedAt: string | undefined;
              try {
                const prepared = await mutate(async () => {
                  const { project, task } = await pair(projectId, taskId, true), previous = await priorRequest(project, task, requestId, fingerprint);
                  if (previous) return { previous };
                  if (input.caseContext) {
                    const selection = input.caseContext as CaseContextSelection, record = cases.getCase(selection.caseId);
                    if (record.status === 'closed') throw new CaseStoreError('case_closed', 409);
                    if (record.revision !== selection.caseRevision || cases.getProjectWork(projectId).revision !== selection.projectWorkRevision) throw new CaseStoreError('revision_conflict', 409);
                    if (!cases.listProjectLinks(record.id).some(link => link.projectId === projectId)) throw new CaseStoreError('project_not_linked', 409);
                  }
                  const requirement = requirementPrefix(input), casePrompt = await prepareCasePrompt(projectId, taskId, input);
                  const prompt = requirement === undefined ? casePrompt : `${requirement}\n\n${casePrompt}`;
                  startedAt = new Date().toISOString();
                  await projects.markRun(projectId, taskId, { id: requestId, status: 'running', startedAt });
                  return { prompt };
                });
                if ('previous' in prepared) { json(response, 202, { requestId, status: prepared.previous, deduplicated: true }); acknowledge(); return; }
                const run = lease.start({ text: prepared.prompt!, requestId, requestFingerprint: fingerprint });
                terminalContext = run.context;
                await run.accepted;
                accepted = true; json(response, 202, { requestId, status: 'running' }); acknowledge();
                const result = await run.completion;
                await settleProjectRun(owner, run.context, requestId, startedAt!, result);
                return result;
              } catch (error) {
                if (startedAt) await settleProjectRun(owner, lease.context, requestId, startedAt).catch(() => {});
                throw error;
              }
            });
            void completion.then(result => {
              if (result && terminalContext?.isCurrent()) publish(projectId, taskId, { type: 'run.settled', requestId, outcome: result.outcome });
            }, error => {
              rejectAcknowledgement(error);
              if (accepted && terminalContext?.isCurrent()) publish(projectId, taskId, { type: 'run.settled', requestId, outcome: 'failed', error: '运行已中断，远端结果未知。请检查后显式重试。' });
            });
            await acknowledged; return;
          }
          if (operation === 'stop' && request.method === 'POST') {
            await body(request); const owner = await pair(projectId, taskId, true);
            await projectSessions.stop(projectSessions.ref(owner));
            json(response, 200, { stopped: true }); return;
          }
          if (operation === 'ui-response' && request.method === 'POST') {
            const input = await body(request); await pair(projectId, taskId, true);
            if (typeof input.id !== 'string' || !input.id || input.id.length > 200 || (input.value !== undefined && typeof input.value !== 'string' && typeof input.value !== 'boolean') || (input.cancelled !== undefined && typeof input.cancelled !== 'boolean')) throw new RequestFault(400, 'invalid_ui_response');
            const owner = await pair(projectId, taskId, true);
            const result = await projectSessions.respondUI(projectSessions.ref(owner), { id: input.id, value: input.value as string | boolean | undefined, cancelled: input.cancelled as boolean | undefined });
            if (!result?.accepted) throw new RequestFault(409, 'ui_request_unavailable'); json(response, 200, result); return;
          }
          if (operation === 'commands' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.text !== 'string' || !input.text.startsWith('/') || input.text.length > 20000 || (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)))) throw new RequestFault(400, 'invalid_command');
            const requestId = typeof input.requestId === 'string' ? input.requestId : randomUUID(), owner = await pair(projectId, taskId, true);
            const known = await priorRequest(owner.project, owner.task, requestId);
            if (known) { json(response, 200, { result: { deduplicated: true }, outcome: known, snapshot: (await taskState(projectId, taskId)).snapshot }); return; }
            let terminalContext: SessionContext<ProjectOwner> | undefined;
            const result = await projectSessions.withSession(projectSessions.ref(owner), async lease => {
              let startedAt: string | undefined;
              try {
                const previous = await mutate(async () => {
                  const { project, task } = await pair(projectId, taskId, true), prior = await priorRequest(project, task, requestId);
                  if (prior) return prior;
                  startedAt = new Date().toISOString();
                  await projects.markRun(projectId, taskId, { id: requestId, status: 'running', startedAt });
                });
                if (previous) return { result: { deduplicated: true }, outcome: previous, snapshot: (await taskState(projectId, taskId)).snapshot };
                const run = lease.start({ text: input.text as string, requestId, kind: 'command' });
                terminalContext = run.context;
                const [value] = await Promise.all([run.completion, run.accepted]);
                await settleProjectRun(owner, run.context, requestId, startedAt!, value);
                return value;
              } catch (error) {
                if (startedAt) await settleProjectRun(owner, lease.context, requestId, startedAt).catch(() => {});
                throw error;
              }
            }).catch(error => {
              if (terminalContext?.isCurrent()) publish(projectId, taskId, { type: 'run.settled', requestId, outcome: 'failed', error: '命令已中断，请检查后显式重试。' });
              throw error;
            });
            if (terminalContext?.isCurrent()) {
              const outcome = result.outcome ?? (result as any).snapshot?.lastRun?.outcome;
              publish(projectId, taskId, { type: 'run.settled', requestId, outcome: ['completed', 'cancelled', 'failed'].includes(outcome) ? outcome : 'failed' });
            }
            json(response, 200, result); return;
          }
        }
      }
      throw new RequestFault(404, 'not_found');
    } catch (error) {
      const originalCode = error instanceof RequestFault || error instanceof ProjectHistoryError || error instanceof CaseRouteError || error instanceof CaseStoreError || error instanceof ConfigurationStoreError || error instanceof ProjectStoreFault || error instanceof ProjectRuntimeError ? error.code : 'host_request_failed';
      const code = originalCode === 'ui_request_expired' ? 'ui_request_unavailable' : originalCode;
      const status = error instanceof CaseStoreError || error instanceof CaseRouteError ? error.statusCode : error instanceof RequestFault || error instanceof ProjectHistoryError ? error.status : code.includes('required') || code.includes('busy') || code.includes('exists') || code.includes('changed') || ['project_archived', 'runtime_closed', 'ui_request_unavailable'].includes(code) ? 409 : code.includes('not_found') ? 404 : error instanceof ConfigurationStoreError || error instanceof ProjectStoreFault ? 400 : 500;
      json(response, status, { code, message: code === 'configuration_required' ? '请先在模型设置中配置此模型。' : code === 'session_busy' ? '任务正在运行，请等待完成或停止后操作。' : code === 'project_busy' ? '项目中仍有执行、打开或等待回应的任务，请先停止或等待后归档。' : code === 'project_archived' ? '项目已归档，请先恢复后继续操作。' : error instanceof CaseStoreError && status === 409 ? 'Case背景或项目进度已经变化，请刷新核对后再发送或保存。' : '请求未完成，请检查输入或本地服务后重试。', ...(error instanceof ConfigurationStoreError ? { fields: error.fields } : {}), ...(error instanceof CaseRouteError && error.details ? { details: error.details } : {}) });
    }
  })(); });
  return { server, ready, configuration, projects, cases, close: async () => { closing = true; await gate; await closeAgents(); for (const responses of requirementStreams.values()) for (const response of responses) response.end(); requirementStreams.clear(); endStreams(); await cases.close(); await projects.close(); if (server.listening) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); } };
}

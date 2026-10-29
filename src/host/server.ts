import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { readdir, lstat } from 'node:fs/promises';
import { AgentRuntime, CONNECTION_PROMPT, SDK_VERSION } from '../agent/runtime.ts';
import { SessionManager } from '../agent/sdk.ts';
import { ProjectAgent, ProjectRuntimeError, type ProjectSnapshot } from '../agent/project-runtime.ts';
import { ConfigurationStore, ConfigurationStoreError, TARGET_MODELS, type RuntimeModelConfiguration } from './config-store.ts';
import { ProjectStore, ProjectStoreFault, type ProjectRecord, type TaskRecord } from './project-store.ts';
import { loadStaticUi } from './static-ui.ts';
import { createMetricFactoryRoutes } from '../../extensions/business-plugins/metric-factory/api/routes.ts';
import { metricIndexText } from '../../extensions/business-plugins/metric-factory/project/index-text.ts';

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
  const configuration = new ConfigurationStore({ dataRoot }), projects = new ProjectStore({ dataRoot, projectsRoot });
  let staticUi: Awaited<ReturnType<typeof loadStaticUi>> | undefined;
  const instanceId = options.instanceId ?? randomUUID();
  const ready = (async () => { if (options.staticUiRoot) staticUi = await loadStaticUi(options.staticUiRoot); await projects.init(); await configuration.init(); })();
  type LiveEntry = { projectId: string; taskId: string; agent: ProjectAgent; configuration: Readonly<RuntimeModelConfiguration> };
  const agents = new Map<string, LiveEntry>();
  const opening = new Map<string, { task: Promise<ProjectAgent>; projectId: string; taskId: string; agent: ProjectAgent; provider: string }>(), streams = new Map<string, Set<ServerResponse>>();
  const epochs = new Map<string, number>(), clearing = new Set<string>(), archiving = new Set<string>();
  let gate = Promise.resolve(), testing = false, closing = false;
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
  const closeAgents = async (filter: { provider?: string; projectId?: string } = {}) => {
    const targets = new Map<string, ProjectAgent>();
    for (const [key, entry] of agents) if ((!filter.provider || entry.configuration.provider === filter.provider) && (!filter.projectId || entry.projectId === filter.projectId)) { agents.delete(key); targets.set(key, entry.agent); }
    for (const [key, entry] of opening) if ((!filter.provider || entry.provider === filter.provider) && (!filter.projectId || entry.projectId === filter.projectId)) { opening.delete(key); targets.set(key, entry.agent); }
    await Promise.all([...targets].map(async ([key, agent]) => { await agent.close(); endStreams(key); }));
    if (filter.projectId) for (const key of [...streams.keys()]) if (key.startsWith(filter.projectId + '/')) endStreams(key);
  };
  function assertActive(project: ProjectRecord) {
    if (project.archivedAt !== null) throw new RequestFault(409, 'project_archived');
    if (archiving.has(project.id)) throw new RequestFault(409, 'project_busy');
  }
  async function pair(projectId: string, taskId: string, writable = false) {
    const project = await projects.get(projectId), task = project.tasks.find(value => value.id === taskId);
    if (!task) throw new RequestFault(404, 'task_not_found');
    if (writable) assertActive(project);
    return { project, task };
  }
  function projectBusy(projectId: string) {
    for (const entry of opening.values()) if (entry.projectId === projectId) return true;
    for (const entry of agents.values()) if (entry.projectId === projectId && (entry.agent.busy || entry.agent.pendingUI.length)) return true;
    return false;
  }
  async function priorRequest(project: ProjectRecord, task: TaskRecord, requestId: string): Promise<string | undefined> {
    if (task.lastRun?.id === requestId) return task.lastRun.status;
    let previous: string | undefined;
    // Only this task's native ledger is authoritative, including its forks.
    for (const file of await readdir(task.sessionDirectory)) {
      if (!file.endsWith('.jsonl')) continue;
      const target = path.join(task.sessionDirectory, file), entry = await lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new RequestFault(409, 'session_history_unavailable');
      const manager = SessionManager.open(target, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
      for (const marker of manager.getEntries()) {
        if (marker.type !== 'custom' || marker.customType !== 'optracall.run') continue;
        const data = marker.data as { requestId?: string; phase?: string; outcome?: string } | undefined;
        if (data?.requestId !== requestId) continue;
        if (data.phase === 'settled' && ['completed', 'cancelled', 'failed'].includes(data.outcome ?? '')) previous = data.outcome;
        else if (!previous && data.phase === 'started') previous = 'interrupted';
      }
    }
    return previous;
  }
  async function agentFor(initialProject: ProjectRecord, initialTask: TaskRecord): Promise<ProjectAgent> {
    // Reserve the task under the same gate as archive/clear. The SDK starts and
    // awaits extension UI outside that gate, so replies and cancellation work.
    const ticket = await mutate(async () => {
      if (closing) throw new RequestFault(503, 'host_closing');
      const { project, task } = await pair(initialProject.id, initialTask.id, true);
      if (clearing.has(task.configuration.provider)) throw new RequestFault(409, 'configuration_required');
      const key = keyOf(project.id, task.id), existing = agents.get(key);
      if (existing?.agent.alive && existing.agent.busy) return { agent: existing.agent };
      const snapshot = configuration.snapshot(task.configuration.id, task.configuration.revision);
      if (!snapshot) throw new RequestFault(409, 'configuration_required');
      if (existing?.agent.alive && existing.configuration.apiKey === snapshot.apiKey && existing.configuration.api === snapshot.api && existing.configuration.baseUrl === snapshot.baseUrl) return { agent: existing.agent };
      const inFlight = opening.get(key); if (inFlight) return { operation: inFlight.task, key, pendingAgent: inFlight.agent };
      const epoch = epochs.get(snapshot.provider) ?? 0, address = server.address();
      const agent = new ProjectAgent({ projectId: project.id, projectDirectory: project.rootPath, sessionDirectory: task.sessionDirectory, sessionFile: task.sessionFile, draft: task.draft, codeRoot: options.cwd, resourceRoot: path.join(dataRoot, 'pi'), configuration: snapshot, managementPorts: [...options.uiPorts, typeof address === 'object' && address ? address.port : 4175], metricIndexText: metricIndexText({ dataRoot, projectId: project.id }) });
      agent.subscribe(event => {
        if (event.type !== 'ui.editor') { publish(project.id, task.id, event); return; }
        void projects.saveDraft(project.id, task.id, event.text).then(() => publish(project.id, task.id, event), () => publish(project.id, task.id, { type: 'ui.notification', level: 'error', message: '扩展修改的草稿未能保存，请检查本地存储后重试。' }));
      });
      const assertCurrent = async () => {
        if (closing) throw new RequestFault(503, 'host_closing');
        assertActive(await projects.get(project.id));
        const current = configuration.snapshot(task.configuration.id, task.configuration.revision);
        if (clearing.has(snapshot.provider) || epoch !== (epochs.get(snapshot.provider) ?? 0) || !current || current.apiKey !== snapshot.apiKey || current.baseUrl !== snapshot.baseUrl || current.api !== snapshot.api) throw new RequestFault(409, 'configuration_changed');
        if (opening.get(key)?.agent !== agent) throw new ProjectRuntimeError('runtime_closed');
      };
      let begin!: () => void; const reserved = new Promise<void>(resolve => { begin = resolve; });
      const operation = (async () => {
        await reserved;
        try {
          if (existing) { await existing.agent.close(); if (agents.get(key)?.agent === existing.agent) agents.delete(key); }
          await assertCurrent();
          const state = await agent.open();
          await assertCurrent();
          if (state.sessionFile) await projects.setSession(project.id, task.id, state.sessionFile);
          await assertCurrent(); agents.set(key, { projectId: project.id, taskId: task.id, agent, configuration: snapshot }); return agent;
        } catch (error) { await agent.close(); throw error; }
      })();
      void operation.catch(() => {});
      opening.set(key, { task: operation, projectId: project.id, taskId: task.id, agent, provider: snapshot.provider });
      return { operation, begin, key, pendingAgent: agent };
    });
    if (ticket.agent) return ticket.agent;
    ticket.begin?.();
    try { return await ticket.operation!; } finally { if (opening.get(ticket.key!)?.agent === ticket.pendingAgent) opening.delete(ticket.key!); }
  }
  function savedHistory(project: ProjectRecord, task: TaskRecord, capabilities: Record<string, unknown> = {}): ProjectSnapshot {
    const manager = task.sessionFile ? SessionManager.open(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean')) : SessionManager.inMemory(path.join(project.rootPath, '020_clean'));
    const last: any = manager.getEntries().filter((entry: any) => entry.type === 'custom' && entry.customType === 'optracall.run').at(-1);
    return { sessionId: task.sessionFile ? manager.getSessionId() : task.id, sessionFile: task.sessionFile, messages: manager.buildSessionContext().messages as Record<string, any>[], tools: [], status: 'idle', sdkVersion: SDK_VERSION, capabilities, ...(last?.data?.requestId ? { lastRun: { requestId: last.data.requestId, ...(last.data.outcome ? { outcome: last.data.outcome } : {}) } } : {}) };
  }
  async function taskState(projectId: string, taskId: string, activate = false) {
    let { project, task } = await pair(projectId, taskId); let snapshot: ProjectSnapshot;
    const key = keyOf(projectId, taskId), active = agents.get(key)?.agent;
    const interrupted = !active?.alive && !opening.has(key) && (Boolean(active) || ['running', 'interrupted'].includes(task.lastRun?.status ?? ''));
    if (activate) assertActive(project);
    try {
      if (project.archivedAt !== null) snapshot = savedHistory(project, task, { projectArchived: true });
      else if (active?.alive) snapshot = await active.snapshot();
      else if (activate && !interrupted) snapshot = await (await agentFor(project, task)).snapshot();
      else { configuration.snapshot(task.configuration.id, task.configuration.revision); snapshot = savedHistory(project, task, interrupted ? { runtimeInterrupted: true } : { uninitialized: true }); }
    } catch (error) { if (!(error instanceof ConfigurationStoreError)) throw error; snapshot = savedHistory(project, task, { requiresConfiguration: true }); }
    if (project.archivedAt === null && task.lastRun && ['running', 'interrupted'].includes(task.lastRun.status) && !agents.get(key)?.agent.busy && !opening.has(key)) {
      const proven = snapshot.lastRun?.requestId === task.lastRun.id ? snapshot.lastRun.outcome : undefined;
      if (proven || task.lastRun.status === 'running') { task = await projects.markRun(projectId, taskId, { ...task.lastRun, status: proven ?? 'interrupted', settledAt: new Date().toISOString() }); project = await projects.get(projectId); }
    }
    const live = agents.get(key)?.agent ?? opening.get(key)?.agent;
    if (live) snapshot.uiRequests = live.pendingUI.map(event => event.request);
    return { project, task, snapshot };
  }
  function assertUsable(project: ProjectRecord, task: TaskRecord, agent: ProjectAgent) {
    assertActive(project);
    const entry = agents.get(keyOf(project.id, task.id)), current = configuration.snapshot(task.configuration.id, task.configuration.revision);
    if (!agent.alive || entry?.agent !== agent || clearing.has(task.configuration.provider) || !current || entry.configuration.apiKey !== current.apiKey || entry.configuration.baseUrl !== current.baseUrl || entry.configuration.api !== current.api) throw new RequestFault(409, 'configuration_changed');
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
        if (request.method === 'DELETE') { const provider = url.searchParams.get('provider') ?? undefined; await mutate(async () => {
          const providers = provider ? [provider] : [...new Set(configuration.list().map(value => value.provider))];
          for (const key of providers) { clearing.add(key); epochs.set(key, (epochs.get(key) ?? 0) + 1); }
          try { await closeAgents({ provider }); await configuration.clear(provider); } finally { for (const key of providers) clearing.delete(key); }
        }); json(response, 200, { configuration: configuration.read() }); return; }
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
      if (url.pathname === '/api/projects') {
        if (request.method === 'GET') { json(response, 200, { projects: await projects.list() }); return; }
        if (request.method === 'POST') {
          const input = await body(request), value = await mutate(async () => { const selected = configuration.read(typeof input.configurationId === 'string' ? input.configurationId : undefined); if (!selected?.hasApiKey) throw new RequestFault(409, 'configuration_required'); return projects.create({ name: String(input.name ?? ''), configuration: selected }); });
          json(response, 201, { project: value }); return;
        }
      }
      const match = /^\/api\/projects\/([a-f0-9-]+)(?:\/(.*))?$/.exec(url.pathname);
      if (match) {
        const projectId = match[1]!, action = match[2];
        if (!action && request.method === 'GET') { json(response, 200, { project: await projects.get(projectId) }); return; }
        if (!action && request.method === 'PATCH') { const input = await body(request); json(response, 200, { project: await mutate(async () => { assertActive(await projects.get(projectId)); return projects.rename(projectId, String(input.name ?? '')); }) }); return; }
        if (action === 'archive' && request.method === 'POST') {
          await body(request);
          const project = await mutate(async () => {
            let value = await projects.get(projectId);
            if (value.archivedAt !== null) return value;
            archiving.add(projectId);
            try {
              if (projectBusy(projectId)) throw new RequestFault(409, 'project_busy');
              for (const task of value.tasks) if (task.lastRun?.status === 'running') await taskState(projectId, task.id);
              value = await projects.get(projectId);
              if (projectBusy(projectId) || value.tasks.some(task => task.lastRun?.status === 'running')) throw new RequestFault(409, 'project_busy');
              const archived = await projects.archive(projectId); await closeAgents({ projectId }); return archived;
            } finally { archiving.delete(projectId); }
          }); json(response, 200, { project }); return;
        }
        if (action === 'restore' && request.method === 'POST') { await body(request); json(response, 200, { project: await mutate(() => projects.restore(projectId)) }); return; }
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
            const input = await body(request); await pair(projectId, taskId, true); const text = String(input.text ?? ''), task = await projects.saveDraft(projectId, taskId, text);
            const agent = agents.get(key)?.agent ?? opening.get(key)?.agent; if (agent) await agent.setEditorState(text).catch(() => {});
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
            const initial = await pair(projectId, taskId, true), known = await priorRequest(initial.project, initial.task, input.requestId);
            if (known) { json(response, 202, { requestId: input.requestId, status: known, deduplicated: true }); return; }
            const agent = await agentFor(initial.project, initial.task);
            await mutate(async () => {
              const { project, task } = await pair(projectId, taskId, true), previous = await priorRequest(project, task, input.requestId as string);
              if (previous) { json(response, 202, { requestId: input.requestId, status: previous, deduplicated: true }); return; }
              assertUsable(project, task, agent); if (agent.busy) throw new RequestFault(409, 'session_busy');
              const startedAt = new Date().toISOString(); await projects.markRun(projectId, taskId, { id: input.requestId as string, status: 'running', startedAt });
              const run = agent.start(input.text as string, input.requestId as string);
              void run.completion.then(async (result: any) => { await projects.markRun(projectId, taskId, { id: input.requestId as string, status: result.outcome, startedAt, settledAt: new Date().toISOString() }); }).catch(async () => { await projects.markRun(projectId, taskId, { id: input.requestId as string, status: 'interrupted', startedAt, settledAt: new Date().toISOString() }).catch(() => {}); publish(projectId, taskId, { type: 'run.settled', requestId: input.requestId, outcome: 'failed', error: '运行已中断，远端结果未知。请检查后显式重试。' }); });
              await run.accepted; json(response, 202, { requestId: input.requestId, status: 'running' });
            }); return;
          }
          if (operation === 'stop' && request.method === 'POST') {
            await body(request); await pair(projectId, taskId, true);
            const pending = opening.get(key);
            if (pending) { await pending.agent.close(); if (opening.get(key)?.agent === pending.agent) opening.delete(key); }
            else await agents.get(key)?.agent.stop();
            json(response, 200, { stopped: true }); return;
          }
          if (operation === 'ui-response' && request.method === 'POST') {
            const input = await body(request); await pair(projectId, taskId, true);
            if (typeof input.id !== 'string' || !input.id || input.id.length > 200 || (input.value !== undefined && typeof input.value !== 'string' && typeof input.value !== 'boolean') || (input.cancelled !== undefined && typeof input.cancelled !== 'boolean')) throw new RequestFault(400, 'invalid_ui_response');
            const agent = agents.get(key)?.agent ?? opening.get(key)?.agent; if (!agent?.alive) throw new RequestFault(409, 'ui_request_unavailable');
            const result = await agent.respondUI({ id: input.id, value: input.value as string | boolean | undefined, cancelled: input.cancelled as boolean | undefined });
            if (!result?.accepted) throw new RequestFault(409, 'ui_request_unavailable'); json(response, 200, result); return;
          }
          if (operation === 'commands' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.text !== 'string' || !input.text.startsWith('/') || input.text.length > 20000 || (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)))) throw new RequestFault(400, 'invalid_command');
            const requestId = typeof input.requestId === 'string' ? input.requestId : randomUUID(), initial = await pair(projectId, taskId, true), known = await priorRequest(initial.project, initial.task, requestId);
            if (known) { json(response, 200, { result: { deduplicated: true }, outcome: known, snapshot: (await taskState(projectId, taskId)).snapshot }); return; }
            const agent = await agentFor(initial.project, initial.task);
            const ticket = await mutate(async () => {
              const { project, task } = await pair(projectId, taskId, true), previous = await priorRequest(project, task, requestId);
              if (previous) return { previous };
              assertUsable(project, task, agent); if (agent.busy) throw new RequestFault(409, 'session_busy');
              const startedAt = new Date().toISOString(); await projects.markRun(projectId, taskId, { id: requestId, status: 'running', startedAt });
              const completion = agent.command(input.text as string, requestId).then(async result => {
                if (result.snapshot?.sessionFile) await projects.setSession(projectId, taskId, result.snapshot.sessionFile);
                const outcome = result.outcome ?? result.snapshot?.lastRun?.outcome;
                await projects.markRun(projectId, taskId, { id: requestId, status: ['completed', 'cancelled', 'failed'].includes(outcome) ? outcome : 'interrupted', startedAt, settledAt: new Date().toISOString() }); return result;
              }).catch(async error => { await projects.markRun(projectId, taskId, { id: requestId, status: 'interrupted', startedAt, settledAt: new Date().toISOString() }).catch(() => {}); publish(projectId, taskId, { type: 'run.settled', requestId, outcome: 'failed', error: '命令已中断，请检查后显式重试。' }); throw error; });
              return { completion };
            });
            if ('completion' in ticket) json(response, 200, await ticket.completion);
            else json(response, 200, { result: { deduplicated: true }, outcome: ticket.previous, snapshot: (await taskState(projectId, taskId)).snapshot });
            return;
          }
        }
      }
      throw new RequestFault(404, 'not_found');
    } catch (error) {
      const code = error instanceof RequestFault || error instanceof ConfigurationStoreError || error instanceof ProjectStoreFault || error instanceof ProjectRuntimeError ? error.code : 'host_request_failed';
      const status = error instanceof RequestFault ? error.status : code.includes('required') || code.includes('busy') || code.includes('exists') || code.includes('changed') || code === 'project_archived' ? 409 : code.includes('not_found') ? 404 : error instanceof ConfigurationStoreError || error instanceof ProjectStoreFault ? 400 : 500;
      json(response, status, { code, message: code === 'configuration_required' ? '请先在模型设置中配置此模型。' : code === 'session_busy' ? '任务正在运行，请等待完成或停止后操作。' : code === 'project_busy' ? '项目中仍有执行、打开或等待回应的任务，请先停止或等待后归档。' : code === 'project_archived' ? '项目已归档，请先恢复后继续操作。' : '请求未完成，请检查输入或本地服务后重试。', ...(error instanceof ConfigurationStoreError ? { fields: error.fields } : {}) });
    }
  })(); });
  return { server, ready, configuration, projects, close: async () => { closing = true; await gate; await closeAgents(); endStreams(); await projects.close(); if (server.listening) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); } };
}

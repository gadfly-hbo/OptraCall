import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { readdir, lstat } from 'node:fs/promises';
import { AgentRuntime, CONNECTION_PROMPT, SDK_VERSION } from '../agent/runtime.ts';
import { SessionManager } from '../agent/sdk.ts';
import { ProjectAgent, ProjectRuntimeError, type ProjectSnapshot } from '../agent/project-runtime.ts';
import { ConfigurationStore, ConfigurationStoreError, TARGET_MODELS, type RuntimeModelConfiguration } from './config-store.ts';
import { ProjectStore, ProjectStoreFault, type ProjectRecord } from './project-store.ts';

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

export function createHost(options: { cwd: string; uiPorts: number[]; transportVersion: string; connectionTimeoutMs?: number; dataRoot?: string; projectsRoot?: string }) {
  const dataRoot = options.dataRoot ?? path.join(os.homedir(), '.optracall'), projectsRoot = options.projectsRoot ?? path.join(os.homedir(), 'OptraCallProjects');
  const configuration = new ConfigurationStore({ dataRoot }), projects = new ProjectStore({ dataRoot, projectsRoot });
  const ready = projects.init().then(() => configuration.init());
  const agents = new Map<string, { agent: ProjectAgent; configuration: Readonly<RuntimeModelConfiguration> }>();
  const opening = new Map<string, { task: Promise<ProjectAgent>; agent: ProjectAgent; provider: string }>(), streams = new Map<string, Set<ServerResponse>>();
  const epochs = new Map<string, number>(), clearing = new Set<string>();
  let gate = Promise.resolve(), testing = false, closing = false;
  const mutate = <T,>(operation: () => T | Promise<T>): Promise<T> => { const result = gate.then(operation); gate = result.then(() => {}, () => {}); return result; };
  const endStreams = (id?: string) => { for (const [key, responses] of streams) { if (id && key !== id) continue; for (const response of responses) response.end(); streams.delete(key); } };
  const publish = (id: string, event: unknown) => { for (const response of streams.get(id) ?? []) if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`); };
  const closeAgents = async (provider?: string) => {
    const targets: Array<{ id: string; agent: ProjectAgent }> = [];
    for (const [id, entry] of agents) if (!provider || entry.configuration.provider === provider) { agents.delete(id); targets.push({ id, agent: entry.agent }); }
    for (const [id, entry] of opening) if (!provider || entry.provider === provider) { opening.delete(id); targets.push({ id, agent: entry.agent }); }
    await Promise.all(targets.map(async ({ id, agent }) => { await agent.close(); endStreams(id); }));
  };

  async function priorRequest(project: ProjectRecord, requestId: string): Promise<string | undefined> {
    if (project.lastRun?.id === requestId) return project.lastRun.status;
    // The SDK ledger remains authoritative across completed turns, branches and
    // native fork files. Do not create a second message/request database.
    let previous: string | undefined;
    for (const file of await readdir(project.sessionDirectory)) {
      if (!file.endsWith('.jsonl')) continue;
      const target = path.join(project.sessionDirectory, file), entry = await lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new RequestFault(409, 'session_history_unavailable');
      const manager = SessionManager.open(target, project.sessionDirectory, path.join(project.rootPath, '020_clean'));
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

  async function agentFor(project: ProjectRecord): Promise<ProjectAgent> {
    if (closing) throw new RequestFault(503, 'host_closing');
    if (clearing.has(project.configuration.provider)) throw new RequestFault(409, 'configuration_required');
    const existing = agents.get(project.id);
    if (existing?.agent.alive && existing.agent.busy) return existing.agent;
    const snapshot = configuration.snapshot(project.configuration.id, project.configuration.revision);
    if (!snapshot) throw new RequestFault(409, 'configuration_required');
    if (existing?.agent.alive && existing.configuration.apiKey === snapshot.apiKey && existing.configuration.api === snapshot.api && existing.configuration.baseUrl === snapshot.baseUrl) return existing.agent;
    if (opening.has(project.id)) return opening.get(project.id)!.task;
    const epoch = epochs.get(snapshot.provider) ?? 0;
    const address = server.address();
    const agent = new ProjectAgent({ projectId: project.id, projectDirectory: project.rootPath, sessionDirectory: project.sessionDirectory, sessionFile: project.sessionFile, draft: project.draft, codeRoot: options.cwd, resourceRoot: path.join(dataRoot, 'pi'), configuration: snapshot, managementPorts: [...options.uiPorts, typeof address === 'object' && address ? address.port : 4175] });
    agent.subscribe(event => {
      if (event.type !== 'ui.editor') { publish(project.id, event); return; }
      // Native extensions own editor changes; Host only persists the draft and
      // then synchronizes browsers. This never submits a prompt to the Agent.
      void projects.saveDraft(project.id, event.text).then(() => publish(project.id, event), () => publish(project.id, { type: 'ui.notification', level: 'error', message: '扩展修改的草稿未能保存，请检查本地存储后重试。' }));
    });
    const assertCurrent = () => {
      if (closing) throw new RequestFault(503, 'host_closing');
      const current = configuration.snapshot(project.configuration.id, project.configuration.revision);
      if (clearing.has(snapshot.provider) || epoch !== (epochs.get(snapshot.provider) ?? 0) || !current || current.apiKey !== snapshot.apiKey || current.baseUrl !== snapshot.baseUrl || current.api !== snapshot.api) throw new RequestFault(409, 'configuration_changed');
    };
    const task = (async () => {
      if (existing) { await existing.agent.close(); agents.delete(project.id); }
      try {
        const state = await agent.open();
        assertCurrent();
        if (state.sessionFile) await projects.setSession(project.id, state.sessionFile);
        assertCurrent(); agents.set(project.id, { agent, configuration: snapshot }); return agent;
      } catch (error) { await agent.close(); throw error; }
    })();
    opening.set(project.id, { task, agent, provider: snapshot.provider }); try { return await task; } finally { if (opening.get(project.id)?.agent === agent) opening.delete(project.id); }
  }
  function savedHistory(project: ProjectRecord, capabilities: Record<string, unknown> = { requiresConfiguration: true }): ProjectSnapshot {
    const manager = project.sessionFile ? SessionManager.open(project.sessionFile, project.sessionDirectory, path.join(project.rootPath, '020_clean')) : SessionManager.inMemory(path.join(project.rootPath, '020_clean'));
    const last: any = manager.getEntries().filter((entry: any) => entry.type === 'custom' && entry.customType === 'optracall.run').at(-1);
    return { sessionId: manager.getSessionId(), sessionFile: project.sessionFile, messages: manager.buildSessionContext().messages as Record<string, any>[], tools: [], status: 'idle', sdkVersion: SDK_VERSION, capabilities, ...(last?.data?.requestId ? { lastRun: { requestId: last.data.requestId, ...(last.data.outcome ? { outcome: last.data.outcome } : {}) } } : {}) };
  }
  async function projectState(id: string) {
    let project = await projects.get(id), snapshot: ProjectSnapshot;
    const active = agents.get(id)?.agent;
    const interrupted = !active?.alive && !opening.has(id) && (Boolean(active) || ['running', 'interrupted'].includes(project.lastRun?.status ?? ''));
    try {
      // Reading history after a known interruption must not re-run extension
      // startup hooks. Only an explicit message/command opens a replacement.
      if (interrupted) { configuration.snapshot(project.configuration.id, project.configuration.revision); snapshot = savedHistory(project, { runtimeInterrupted: true }); }
      else snapshot = await (await agentFor(project)).snapshot();
    }
    catch (error) { if (!(error instanceof ConfigurationStoreError)) throw error; snapshot = savedHistory(project); }
    if (project.lastRun && ['running', 'interrupted'].includes(project.lastRun.status) && !agents.get(id)?.agent.busy) {
      const proven = snapshot.lastRun?.requestId === project.lastRun.id ? snapshot.lastRun.outcome : undefined;
      if (proven || project.lastRun.status === 'running') project = await projects.markRun(id, { ...project.lastRun, status: proven ?? 'interrupted', settledAt: new Date().toISOString() });
    }
    return { project, snapshot };
  }
  function assertUsable(project: ProjectRecord, agent: ProjectAgent) {
    const entry = agents.get(project.id), current = configuration.snapshot(project.configuration.id, project.configuration.revision);
    if (!agent.alive || entry?.agent !== agent || clearing.has(project.configuration.provider) || !current || entry.configuration.apiKey !== current.apiKey || entry.configuration.baseUrl !== current.baseUrl || entry.configuration.api !== current.api) throw new RequestFault(409, 'configuration_changed');
  }
  const server = createServer((request, response) => { void (async () => {
    try {
      await ready;
      const host = new URL(`http://${request.headers.host ?? ''}`), address = server.address();
      if (!['127.0.0.1', 'localhost'].includes(host.hostname) || !address || typeof address === 'string' || Number(host.port) !== address.port) throw new RequestFault(403, 'host_rejected');
      const origin = request.headers.origin, allowed = [...options.uiPorts, address.port].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
      if (origin && !allowed.includes(origin)) throw new RequestFault(403, 'origin_rejected');
      const url = new URL(request.url ?? '/', host);
      if (url.pathname === '/api/health' && request.method === 'GET') { json(response, 200, { status: 'ready', sdkVersion: SDK_VERSION, transportVersion: options.transportVersion, chatMode: 'live', credentials: 'host-persistent', filePolicy: 'soft-prompt-no-sensitive-data-isolation' }); return; }
      if (request.headers['x-optracall-client'] !== '1' || (request.method !== 'GET' && !origin)) throw new RequestFault(403, 'client_rejected');
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
          try { await closeAgents(provider); await configuration.clear(provider); } finally { for (const key of providers) clearing.delete(key); }
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
        const id = match[1]!, action = match[2];
        if (!action && request.method === 'GET') { json(response, 200, await projectState(id)); return; }
        if (action === 'draft' && request.method === 'PATCH') {
          const input = await body(request), text = String(input.text ?? ''), project = await projects.saveDraft(id, text);
          const agent = agents.get(id)?.agent ?? opening.get(id)?.agent;
          if (agent) await agent.setEditorState(text).catch(() => {});
          json(response, 200, { project }); return;
        }
        if (action === 'files' && request.method === 'GET') { json(response, 200, { files: await projects.tree(id) }); return; }
        if (action === 'files/upload' && request.method === 'POST') {
          const input = await body(request, 14 * 1024 * 1024);
          if (typeof input.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)) throw new RequestFault(400, 'invalid_file_encoding');
          if (input.directory !== undefined && input.directory !== '010_draw' && input.directory !== '020_clean') throw new RequestFault(400, 'invalid_upload_directory');
          json(response, 201, { file: await projects.upload({ projectId: id, name: String(input.name ?? ''), bytes: Buffer.from(input.content, 'base64'), directory: input.directory as '010_draw' | '020_clean' | undefined }) }); return;
        }
        if (action === 'files/copy-to-clean' && request.method === 'POST') { const input = await body(request); json(response, 201, { file: await projects.copyToClean(id, String(input.path ?? '')) }); return; }
        if (action === 'files/save-report' && request.method === 'POST') { const input = await body(request, 14 * 1024 * 1024); json(response, 201, { file: await projects.saveReport(id, String(input.name ?? ''), String(input.text ?? '')) }); return; }
        if (action === 'files/content' && request.method === 'GET') { const file = await projects.readFile(id, url.searchParams.get('path') ?? ''); response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(file.bytes); return; }
        if (action === 'events' && request.method === 'GET') {
          await projects.get(id);
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.flushHeaders();
          const responses = streams.get(id) ?? new Set(); responses.add(response); streams.set(id, responses); response.write(': project connection\n\n');
          response.once('close', () => { responses.delete(response); if (!responses.size) streams.delete(id); });
          for (const event of (agents.get(id)?.agent ?? opening.get(id)?.agent)?.pendingUI ?? []) response.write(`data: ${JSON.stringify(event)}\n\n`);
          try { const state = await projectState(id); if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: state.snapshot })}\n\n`); }
          catch { if (!response.destroyed && !response.writableEnded) { response.write(`data: ${JSON.stringify({ type: 'stream.error', message: '项目连接未就绪，请检查模型配置或重新连接。' })}\n\n`); response.end(); } }
          return;
        }
        if (action === 'messages' && request.method === 'POST') {
          const input = await body(request);
          if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) throw new RequestFault(400, 'invalid_message');
          const initial = await projects.get(id), known = await priorRequest(initial, input.requestId);
          if (known) { json(response, 202, { requestId: input.requestId, status: known, deduplicated: true }); return; }
          const agent = await agentFor(initial);
          await mutate(async () => {
            const project = await projects.get(id);
            const previous = await priorRequest(project, input.requestId as string);
            if (previous) { json(response, 202, { requestId: input.requestId, status: previous, deduplicated: true }); return; }
            assertUsable(project, agent);
            if (agent.busy) throw new RequestFault(409, 'session_busy');
            const startedAt = new Date().toISOString(); await projects.markRun(id, { id: input.requestId as string, status: 'running', startedAt });
            const run = agent.start(input.text as string, input.requestId as string);
            void run.completion.then(async (result: any) => { await projects.markRun(id, { id: input.requestId as string, status: result.outcome, startedAt, settledAt: new Date().toISOString() }); }).catch(async () => { await projects.markRun(id, { id: input.requestId as string, status: 'interrupted', startedAt, settledAt: new Date().toISOString() }).catch(() => {}); publish(id, { type: 'run.settled', requestId: input.requestId, outcome: 'failed', error: '运行已中断，远端结果未知。请检查后显式重试。' }); });
            await run.accepted;
            json(response, 202, { requestId: input.requestId, status: 'running' });
          }); return;
        }
        if (action === 'stop' && request.method === 'POST') { await body(request); await (agents.get(id)?.agent ?? opening.get(id)?.agent)?.stop(); json(response, 200, { stopped: true }); return; }
        if (action === 'ui-response' && request.method === 'POST') {
          const input = await body(request);
          if (typeof input.id !== 'string' || !input.id || input.id.length > 200 || (input.value !== undefined && typeof input.value !== 'string' && typeof input.value !== 'boolean') || (input.cancelled !== undefined && typeof input.cancelled !== 'boolean')) throw new RequestFault(400, 'invalid_ui_response');
          const agent = agents.get(id)?.agent ?? opening.get(id)?.agent; if (!agent?.alive) throw new RequestFault(409, 'ui_request_unavailable');
          const result = await agent.respondUI({ id: input.id, value: input.value as string | boolean | undefined, cancelled: input.cancelled as boolean | undefined });
          if (!result?.accepted) throw new RequestFault(409, 'ui_request_unavailable'); json(response, 200, result); return;
        }
        if (action === 'commands' && request.method === 'POST') {
          const input = await body(request);
          if (typeof input.text !== 'string' || !input.text.startsWith('/') || input.text.length > 20000 || (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)))) throw new RequestFault(400, 'invalid_command');
          const requestId = typeof input.requestId === 'string' ? input.requestId : randomUUID(), initial = await projects.get(id), known = await priorRequest(initial, requestId);
          if (known) { json(response, 200, { result: { deduplicated: true }, outcome: known, snapshot: (await projectState(id)).snapshot }); return; }
          const agent = await agentFor(initial);
          const ticket = await mutate(async () => {
            const project = await projects.get(id), previous = await priorRequest(project, requestId);
            if (previous) return { previous };
            assertUsable(project, agent);
            if (agent.busy) throw new RequestFault(409, 'session_busy');
            const startedAt = new Date().toISOString(); await projects.markRun(id, { id: requestId, status: 'running', startedAt });
            const completion = agent.command(input.text as string, requestId).then(async result => {
              if (result.snapshot?.sessionFile) await projects.setSession(id, result.snapshot.sessionFile);
              const outcome = result.outcome ?? result.snapshot?.lastRun?.outcome;
              await projects.markRun(id, { id: requestId, status: ['completed', 'cancelled', 'failed'].includes(outcome) ? outcome : 'interrupted', startedAt, settledAt: new Date().toISOString() }); return result;
            }).catch(async error => { await projects.markRun(id, { id: requestId, status: 'interrupted', startedAt, settledAt: new Date().toISOString() }).catch(() => {}); publish(id, { type: 'run.settled', requestId, outcome: 'failed', error: '命令已中断，请检查后显式重试。' }); throw error; });
            return { completion };
          });
          if ('completion' in ticket) json(response, 200, await ticket.completion);
          else json(response, 200, { result: { deduplicated: true }, outcome: ticket.previous, snapshot: (await projectState(id)).snapshot });
          return;
        }
      }
      throw new RequestFault(404, 'not_found');
    } catch (error) {
      const code = error instanceof RequestFault || error instanceof ConfigurationStoreError || error instanceof ProjectStoreFault || error instanceof ProjectRuntimeError ? error.code : 'host_request_failed';
      const status = error instanceof RequestFault ? error.status : code.includes('required') || code.includes('busy') || code.includes('exists') || code.includes('changed') ? 409 : code.includes('not_found') ? 404 : error instanceof ConfigurationStoreError || error instanceof ProjectStoreFault ? 400 : 500;
      json(response, status, { code, message: code === 'configuration_required' ? '请先在模型设置中配置此模型。' : code === 'session_busy' ? '项目正在运行，请等待完成或停止后操作。' : '请求未完成，请检查输入或本地服务后重试。', ...(error instanceof ConfigurationStoreError ? { fields: error.fields } : {}) });
    }
  })(); });
  return { server, ready, configuration, projects, close: async () => { closing = true; await gate; await closeAgents(); endStreams(); await projects.close(); if (server.listening) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); } };
}

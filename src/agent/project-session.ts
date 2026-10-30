import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, createCodemodeExtension, createToolSearchExtension, createMcpExtension, VERSION, type AgentSession, type AgentSessionRuntime, type CreateAgentSessionRuntimeFactory, type ExtensionFactory } from './sdk.ts';
import type { ProjectAgentOptions, ProjectSnapshot } from './project-runtime.ts';
import { runDiagnostic, readRunDiagnostic, type RunDiagnostic } from './run-diagnostics.ts';
import { createBrowserUIContext, type BrowserUIResponse } from './browser-ui-context.ts';

type Outcome = 'completed' | 'cancelled' | 'failed';
type LastRun = { requestId: string; outcome?: Outcome; diagnostic?: RunDiagnostic };
type Assistant = Extract<AgentSession['messages'][number], { role: 'assistant' }>;
type ActiveRun = { id: string; kind: 'prompt' | 'command'; requestFingerprint?: string; cancelled: boolean; commandFailed?: boolean; retryCount: number; last?: Assistant; pending: string; managers: Set<SessionManager> };
type RunResult = { outcome: Outcome; text: string; result?: unknown; snapshot: ProjectSnapshot; diagnostic?: RunDiagnostic };
const RUN_ENTRY = 'optracall.run';

export async function runProjectSession(transport: { close: () => Promise<void> }) {
  let runtime: AgentSessionRuntime | undefined, session: AgentSession | undefined, manager: SessionManager | undefined;
  let options: ProjectAgentOptions, unsubscribe: (() => void) | undefined;
  let operation: 'prompt' | 'command' | undefined, closing = false;
  let run: ActiveRun | undefined;
  let pendingOperation: Promise<RunResult> | undefined;
  let browserUI: ReturnType<typeof createBrowserUIContext> | undefined;
  let editorText: string | undefined;
  const send = (value: unknown) => { if (process.connected) process.send?.(value); };
  const redactText = (text: string) => {
    let secret = options?.configuration?.apiKey;
    if (!secret) return text;
    const variants: string[] = [];
    for (let depth = 0; depth < 3; depth++) { variants.push(secret); secret = JSON.stringify(secret).slice(1, -1); }
    for (const value of [...new Set(variants)].sort((a, b) => b.length - a.length)) text = text.split(value).join('[密钥已隐藏]');
    return text;
  };
  const redact = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' ? redactText(item) : item));
  const publish = (event: unknown) => send({ kind: 'event', event: redact(event) });
  function lastRun(): LastRun | undefined {
    for (const entry of [...manager!.getEntries()].reverse()) {
      if (entry.type !== 'custom' || entry.customType !== RUN_ENTRY) continue;
      const data = entry.data as Record<string, unknown> | undefined;
      // Forks copy native entries. A copied marker belongs to its originating session.
      if (!data || data.sessionId !== manager!.getSessionId() || typeof data.requestId !== 'string') continue;
      if (data.phase === 'started') return { requestId: data.requestId };
      if (data.phase === 'settled' && ['completed', 'cancelled', 'failed'].includes(String(data.outcome))) {
        const diagnostic = readRunDiagnostic(data.diagnostic);
        return { requestId: data.requestId, outcome: data.outcome as Outcome, ...(diagnostic ? { diagnostic } : {}) };
      }
    }
    return undefined;
  }
  const snapshot = (): ProjectSnapshot & { lastRun?: LastRun } => ({ sessionId: manager!.getSessionId(), sessionFile: manager!.getSessionFile(), messages: redact(session!.messages) as Record<string, any>[], tools: session!.getActiveToolNames(), status: run ? 'running' : 'idle', sdkVersion: VERSION, ...(lastRun() ? { lastRun: lastRun() } : {}), uiRequests: browserUI?.pending() ?? [], capabilities: { nativeTools: true, python: 'bash', powershell: 'Windows only (upstream)', compaction: session!.autoCompactionEnabled, retry: session!.settingsManager.getRetrySettings().enabled, resources: options.resourceRoot, extensions: true, skills: true, mcp: true, codemode: true, sessionTree: true, extensionUI: { dialogs: ['select', 'confirm', 'input', 'editor'], status: true, terminalComponents: false } } });
  const environmentExtension: ExtensionFactory = pi => {
    // The SDK applies this replacement to agent state before its own JSONL append.
    pi.on('message_end', event => ({ message: redact(event.message) }));
  };
  function streamDelta(delta: string) {
    if (!run) return;
    const text = redactText(run.pending + delta), secret = options.configuration.apiKey;
    let held = Math.min(secret.length - 1, text.length);
    while (held > 0 && !secret.startsWith(text.slice(-held))) held--;
    run.pending = held ? text.slice(-held) : '';
    const ready = held ? text.slice(0, -held) : text;
    if (ready) publish({ type: 'text.delta', requestId: run.id, text: ready });
  }
  function flushDelta() { if (run?.pending) { publish({ type: 'text.delta', requestId: run.id, text: run.pending }); run.pending = ''; } }
  async function bindSession(next: AgentSession) {
    unsubscribe?.(); browserUI?.dispose(); session = next; manager = next.sessionManager;
    attachRunManager(manager);
    const adapter = createBrowserUIContext({ initialEditorText: editorText ?? '', emit: event => { if (event.type === 'ui.editor') editorText = event.text; publish({ ...event, ...(run ? { requestId: run.id } : {}) }); }, onCancelled: () => {
      if (browserUI !== adapter) return;
      if (run) run.cancelled = true;
      adapter.dismissPending(); void session?.abort().catch(() => {});
    } });
    browserUI = adapter;
    await next.bindExtensions({ uiContext: adapter.context, mode: 'rpc', commandContextActions: {
      waitForIdle: () => runtime!.session.waitForIdle(),
      newSession: input => runtime!.newSession(input),
      fork: (id, input) => runtime!.fork(id, input),
      navigateTree: (id, input) => runtime!.session.navigateTree(id, input),
      switchSession: (file, input) => runtime!.switchSession(file, input),
      reload: () => runtime!.session.reload(),
    }, onError: error => { if (run && error.event === 'command') run.commandFailed = true; publish({ type: 'native', requestId: run?.id, event: { type: 'extension_error', error } }); } });
    unsubscribe = next.subscribe(event => {
      if ((event.type === 'auto_retry_start' || event.type === 'summarization_retry_attempt_start') && run) run.retryCount++;
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') streamDelta(event.assistantMessageEvent.delta);
      if (event.type === 'message_end') {
        if (event.message.role === 'assistant' && run) { run.last = event.message; flushDelta(); }
        publish({ type: 'snapshot', snapshot: snapshot() });
      }
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end' || event.type === 'tool_execution_update' || event.type.startsWith('auto_') || event.type.startsWith('compaction_') || event.type.startsWith('summarization_') || event.type === 'queue_update') publish({ type: 'native', requestId: run?.id, event });
    });
  }
  async function open(o: ProjectAgentOptions) {
    if (runtime) throw new Error('session_already_open');
    options = o;
    if (editorText === undefined) editorText = o.draft ?? '';
    const cwd = o.workspace?.cwd ?? path.join(o.projectDirectory!, '020_clean');
    const credentials = { read: async () => undefined, list: async () => [], modify: async () => { throw new Error('Host owns credentials.'); }, delete: async () => {} };
    const models = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const builtin = models.getModel(o.configuration.provider, o.configuration.model);
    const providerId = `optracall-${o.configuration.id}-${o.configuration.revision}`;
    models.registerProvider(providerId, { api: o.configuration.api, baseUrl: o.configuration.baseUrl, models: [builtin ? { ...builtin, id: o.configuration.model } : { id: o.configuration.model, name: o.configuration.name, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 4096 }] });
    await models.setRuntimeApiKey(providerId, o.configuration.apiKey);
    const model = models.getModel(providerId, o.configuration.model);
    if (!model) throw new Error('model_unavailable');
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: targetCwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd: targetCwd, agentDir, modelRuntime: models, resourceLoaderOptions: {
        extensionFactories: [createCodemodeExtension({ mode: 'on' }), createToolSearchExtension(), createMcpExtension(), environmentExtension],
        appendSystemPrompt: o.workspace ? [...o.workspace.systemPrompt] : [`You are OptraCall. Workspace conventions: your working directory is ${targetCwd}. For analysis, do not read data in 010_draw. Analyze only materials the user places in 020_clean. 010_draw archives originals and is not automatically attached to model context. This is a soft instruction, not sensitive-data isolation; the full native tools are available without a sandbox or tool interception. Write intermediate/process files to 020_clean by default. Save final reports to ${path.join(o.projectDirectory!, '060_reports')} when asked to produce a final report. Determine analysis methods and tools yourself from the user's request. These are directory conventions, not a prescribed analysis procedure.`, ...(o.metricIndexText ? [o.metricIndexText] : [])],
      } });
      // Resource reload reads disk settings; add the workspace's tool selection afterwards.
      // Plain names replace the inherited selection; an empty array means no tools.
      services.settingsManager.applyOverrides({ defaultTools: [...(o.workspace?.defaultTools ?? ['+grep', '+find', '+ls', '+codemode', '+tool_search'])] });
      const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, ...(builtin?.reasoning ? { thinkingLevel: o.configuration.thinkingLevel ?? 'high' } : {}) });
      if (created.modelFallbackMessage || created.session.model?.id !== o.configuration.model || created.session.model?.provider !== providerId) { created.session.dispose(); throw new Error('model_changed'); }
      return { ...created, services, diagnostics: services.diagnostics };
    };
    manager = o.sessionFile && existsSync(o.sessionFile) ? SessionManager.open(o.sessionFile, o.sessionDirectory, cwd) : SessionManager.create(cwd, o.sessionDirectory);
    runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir: o.resourceRoot, sessionManager: manager });
    runtime.setBeforeSessionInvalidate(() => { unsubscribe?.(); unsubscribe = undefined; if (browserUI?.pending().length && run) run.cancelled = true; browserUI?.dispose(); });
    runtime.setRebindSession(bindSession);
    await bindSession(runtime.session);
    return snapshot();
  }
  function materializeNewSession(targetSession: AgentSession) {
    const targetManager = targetSession.sessionManager, file = targetManager.getSessionFile();
    if (!file || existsSync(file)) return;
    const header = targetManager.getHeader();
    if (!header) throw new Error('native_session_header_missing');
    const temporary = path.join(path.dirname(file), `.native-initial-${randomUUID()}.jsonl`);
    try {
      targetSession.exportToJsonl(temporary);
      const exported = readFileSync(temporary, 'utf8'), boundary = exported.indexOf('\n');
      if (boundary < 0) throw new Error('native_session_export_invalid');
      // Pi branch export deliberately creates a detached header. For this first
      // native file retain the manager's own header, including fork parentSession.
      writeFileSync(temporary, JSON.stringify(header) + exported.slice(boundary));
      chmodSync(temporary, 0o600);
      if (existsSync(file)) throw new Error('native_session_file_already_exists');
      renameSync(temporary, file);
      // Public reload marks the new file as flushed, so Pi will append instead of
      // trying to create it again with wx on the first user message.
      targetManager.setSessionFile(file); targetSession.refreshContext();
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  function attachRunManager(target: SessionManager) {
    if (!run || run.managers.has(target)) return;
    target.appendCustomEntry(RUN_ENTRY, { phase: 'started', requestId: run.id, sessionId: target.getSessionId(), kind: run.kind, ...(run.requestFingerprint === undefined ? {} : { requestFingerprint: run.requestFingerprint }) });
    run.managers.add(target);
    if (session?.sessionManager === target) materializeNewSession(session);
  }
  function execute(id: string, kind: ActiveRun['kind'], action: () => Promise<unknown>, requestFingerprint?: string): Promise<RunResult> {
    if (run) throw new Error('session_busy');
    if (typeof id !== 'string' || !id.trim()) throw new Error('request_id_required');
    if (requestFingerprint !== undefined && (kind !== 'prompt' || typeof requestFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(requestFingerprint))) throw new Error('invalid_request_fingerprint');
    const current: ActiveRun = { id, kind, ...(requestFingerprint === undefined ? {} : { requestFingerprint }), cancelled: false, retryCount: 0, pending: '', managers: new Set() };
    run = current;
    try { attachRunManager(manager!); }
    catch (error) { run = undefined; throw error; }
    publish({ type: 'run.accepted', requestId: id, sessionFile: manager!.getSessionFile() });
    publish({ type: 'snapshot', snapshot: snapshot() });
    pendingOperation = (async () => {
      let failed = false, result: unknown, failure: unknown;
      try { result = await action(); await session!.waitForIdle(); } catch (error) { failed = true; failure = error; }
      flushDelta();
      const last = current.last, nativeCancelled = Boolean(result && typeof result === 'object' && 'cancelled' in result && result.cancelled);
      const outcome: Outcome = current.cancelled || nativeCancelled || last?.stopReason === 'aborted' ? 'cancelled' : failed || current.commandFailed || last?.stopReason === 'error' ? 'failed' : 'completed';
      const diagnostic = runDiagnostic({ outcome, kind, retryCount: current.retryCount, error: failure ?? last?.errorMessage, commandFailed: current.commandFailed });
      const answer = redactText(last?.content.filter(part => part.type === 'text').map(part => part.text).join('') ?? '');
      for (const target of current.managers) target.appendCustomEntry(RUN_ENTRY, { phase: 'settled', requestId: id, sessionId: target.getSessionId(), outcome, kind, ...(diagnostic ? { diagnostic } : {}) });
      run = undefined;
      const state = snapshot();
      publish({ type: 'snapshot', snapshot: state });
      publish({ type: 'run.settled', requestId: id, outcome, ...(outcome === 'failed' ? { error: diagnostic!.message } : {}), ...(diagnostic ? { diagnostic } : {}) });
      return { outcome, text: answer, result: redact(result ?? null), snapshot: state, ...(diagnostic ? { diagnostic } : {}) };
    })().finally(() => { run = undefined; pendingOperation = undefined; });
    return pendingOperation;
  }
  function prompt(text: string, id: string, requestFingerprint?: string) { return execute(id, 'prompt', () => session!.prompt(text), requestFingerprint); }
  async function command(text: string, id: string) {
    const [name, ...tail] = text.trim().split(/\s+/); const argument = tail.join(' ');
    return execute(id, 'command', async () => {
      if (name === '/tools') return session!.getAllTools();
      if (name === '/session') return session!.getSessionStats();
      if (name === '/tree') return manager!.getTree();
      if (name === '/compact') return session!.compact(argument || undefined);
      if (name === '/reload') { await session!.reload(); return { reloaded: true }; }
      if (name === '/fork') return argument ? runtime!.fork(tail[0], tail[1] === 'at' ? { position: 'at' } : undefined) : { entries: session!.getUserMessagesForForking() };
      if (name === '/branch') return argument ? session!.navigateTree(argument) : manager!.getBranch();
      if (name === '/skills') return session!.resourceLoader.getSkills();
      if (name === '/prompts') return session!.resourceLoader.getPrompts();
      await session!.prompt(text); return session!.getLastAssistantText();
    });
  }
  async function stop() {
    const pending = pendingOperation;
    if (run) run.cancelled = true;
    browserUI?.dismissPending();
    session?.abortCompaction(); session?.abortBranchSummary();
    await session?.abort(); await pending;
    await session?.waitForIdle();
  }
  async function dispose() {
    browserUI?.dispose(); await stop();
    await runtime?.dispose(); unsubscribe?.(); unsubscribe = undefined;
    await transport.close();
  }
  process.on('message', (message: any) => { if (message?.kind !== 'request') return; void (async () => {
    try {
      let result: unknown;
      if (closing) throw new Error('session_closing');
      if (message.method === 'open') result = await open(message.input);
      else if (message.method === 'snapshot') result = snapshot();
      else if (message.method === 'prompt' || message.method === 'command') {
        if (operation) throw new Error('session_busy');
        operation = message.method;
        try { result = message.method === 'prompt' ? await prompt(message.input.text, message.input.requestId, message.input.requestFingerprint) : await command(message.input.text, message.input.requestId); }
        finally { operation = undefined; }
      }
      else if (message.method === 'stop') { await stop(); result = { stopped: true }; }
      else if (message.method === 'ui-response') result = { accepted: browserUI?.respond(message.input as BrowserUIResponse) ?? false };
      else if (message.method === 'editor-state') {
        const text: unknown = message.input?.text;
        if (typeof text !== 'string') throw new Error('invalid_editor_state');
        editorText = text; browserUI?.updateEditorState(text); result = { updated: true };
      }
      else if (message.method === 'close') { closing = true; await dispose(); send({ kind: 'reply', id: message.id, result: { closed: true } }); if (process.connected) process.disconnect?.(); return; }
      else throw new Error('unknown_method');
      send({ kind: 'reply', id: message.id, result: result === undefined ? null : redact(result) });
    } catch (error) { send({ kind: 'reply', id: message.id, error: 'sdk_operation_failed', detail: redact({ message: error instanceof Error ? error.message : String(error), code: (error as NodeJS.ErrnoException | undefined)?.code }) }); }
  })(); });
  process.on('disconnect', () => { if (closing) return; closing = true; void dispose().finally(() => { process.exit(0); }); });
  send({ kind: 'ready' });
}

import { presentContextMessages } from './context-presentation.ts';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync, constants, openSync, fstatSync, fsyncSync, closeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, createCodemodeExtension, createToolSearchExtension, createMcpExtension, VERSION, type AgentSession, type AgentSessionRuntime, type CreateAgentSessionRuntimeFactory, type ExtensionFactory } from './sdk.ts';
import type { ProjectAgentOptions, ProjectSnapshot, ProvidedContextInput } from './project-runtime.ts';
import { runDiagnostic, readRunDiagnostic, type RunDiagnostic } from './run-diagnostics.ts';
import { createBrowserUIContext, type BrowserUIResponse } from './browser-ui-context.ts';
import { OUTPUT_EVIDENCE_GUIDANCE } from './output-evidence.ts';
import { createProtectedTools } from './protected-tools.ts';
import { snapshotProtectedSkills } from './protected-skills.ts';
import { createSimulationTools } from '../../extensions/business-plugins/sim-lab/tools/simulation-tools.ts';

type Outcome = 'completed' | 'cancelled' | 'failed';
type LastRun = { requestId: string; outcome?: Outcome; diagnostic?: RunDiagnostic };
type Assistant = Extract<AgentSession['messages'][number], { role: 'assistant' }>;
type ActiveRun = { id: string; kind: 'prompt' | 'command'; requestFingerprint?: string; providedContext?: Record<string, unknown>; cancelled: boolean; commandFailed?: boolean; retryCount: number; last?: Assistant; pending: string; managers: Set<SessionManager> };
type RunResult = { outcome: Outcome; text: string; result?: unknown; snapshot: ProjectSnapshot; diagnostic?: RunDiagnostic };
const RUN_ENTRY = 'optracall.run';
const EXECUTION_ENTRY = 'optracall.execution';

export async function runProjectSession(transport: { close: () => Promise<void>; setHttpIdleTimeoutMs(value: number): void; settings(): Record<string, number>; observe(baseUrl: string, emit: (record: Record<string, unknown>) => void): () => void }) {
  let runtime: AgentSessionRuntime | undefined, session: AgentSession | undefined, manager: SessionManager | undefined;
  let options: ProjectAgentOptions, unsubscribe: (() => void) | undefined;
  let operation: 'prompt' | 'command' | undefined, closing = false;
  let run: ActiveRun | undefined;
  let pendingOperation: Promise<RunResult> | undefined;
  let browserUI: ReturnType<typeof createBrowserUIContext> | undefined;
  let protectedTools: Awaited<ReturnType<typeof createProtectedTools>> | undefined;
  let unavailableSkills: string[] = [];
  let executionId: string | undefined;
  const executionBindings = new Map<string, { manager: SessionManager; file: string; cwd: string; closed: boolean }>();
  let editorText: string | undefined;
  // Both sealed text profiles reuse the same no-execution resource path.
  const fixedInput = () => options?.workspace?.capabilityPolicy === 'fixed-draft' || options?.workspace?.capabilityPolicy === 'text-only';
  const ordinaryManaged = () => Boolean(protectedTools && options.protectedExecution?.profile === 'ordinary');
  function syncExecutionJournal(target: SessionManager) {
    const file = target.getSessionFile(); if (!file) throw new Error('managed_native_file_required');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const info = fstatSync(fd); if (!info.isFile() || info.nlink !== 1) throw new Error('managed_native_file_unsafe'); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
  function bindManagedExecution(target: AgentSession) {
    if (!executionId || !protectedTools) return;
    const targetManager = target.sessionManager, sessionId = targetManager.getSessionId();
    if (executionBindings.has(sessionId)) return;
    const file = targetManager.getSessionFile(), header = targetManager.getHeader();
    if (!file || !header || typeof header.cwd !== 'string') throw new Error('managed_native_file_required');
    targetManager.appendCustomEntry(EXECUTION_ENTRY, { version: 1, phase: 'opened', executionId, sessionId,
      scopeId: protectedTools.scope.id, profile: options.protectedExecution?.profile ?? 'protected', at: new Date().toISOString() });
    executionBindings.set(sessionId, { manager: targetManager, file, cwd: header.cwd, closed: false });
    materializeNewSession(target); syncExecutionJournal(targetManager);
  }
  function recordManagedClosure() {
    if (!executionId || !protectedTools) return;
    for (const [sessionId, binding] of executionBindings) {
      if (binding.closed) continue;
      // Native fork/tree operations may mutate the SDK manager's selected file.
      // Close only journals actually bound to this execution, through the SDK,
      // rather than writing an old identity into the newly selected branch.
      let writer = binding.manager;
      if (writer.getSessionId() !== sessionId || writer.getSessionFile() !== binding.file) {
        const original = readFileSync(binding.file, 'utf8'), header = JSON.parse(original.slice(0, original.indexOf('\n')));
        if (!original.endsWith('\n') || header.type !== 'session' || header.version !== 3 || header.id !== sessionId || header.cwd !== binding.cwd) throw new Error('managed_native_changed');
        writer = SessionManager.open(binding.file, options.sessionDirectory, binding.cwd);
      }
      writer.appendCustomEntry(EXECUTION_ENTRY, { version: 1, phase: 'closed', executionId, sessionId,
        scopeId: protectedTools.scope.id, profile: options.protectedExecution?.profile ?? 'protected', at: new Date().toISOString() });
      syncExecutionJournal(writer); binding.closed = true;
    }
  }
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
  const sapProvision = () => options.metricIndexText ? { indexText: options.metricIndexText, sha256: createHash('sha256').update(options.metricIndexText).digest('hex'), basis: 'runtime-initialization' } : undefined;
  function semanticProvision(): Record<string, unknown> | undefined {
    for (const entry of [...manager!.getEntries()].reverse()) {
      if (entry.type !== 'custom' || entry.customType !== RUN_ENTRY) continue;
      const data = entry.data as Record<string, unknown> | undefined;
      if (!data || (data.sessionId !== undefined && data.sessionId !== manager!.getSessionId()) || (data.phase !== 'started' && data.phase !== undefined)) continue;
      const supplied = data.providedContext;
      return supplied && typeof supplied === 'object' && !Array.isArray(supplied) && (supplied as Record<string, unknown>).version === 1 ? supplied as Record<string, unknown> : undefined;
    }
    return sapProvision() ? { sap: sapProvision(), claim: 'provided-not-adopted' } : undefined;
  }
  const snapshot = (): ProjectSnapshot & { lastRun?: LastRun } => ({ sessionId: manager!.getSessionId(), sessionFile: manager!.getSessionFile(), messages: redact(presentContextMessages(session!.messages, manager!.getBranch(), manager!.getSessionId())) as Record<string, any>[], tools: session!.getActiveToolNames(), status: run ? 'running' : 'idle', sdkVersion: VERSION, ...(lastRun() ? { lastRun: lastRun() } : {}), uiRequests: browserUI?.pending() ?? [], capabilities: { nativeTools: !fixedInput(), python: fixedInput() ? false : 'bash', powershell: fixedInput() || protectedTools ? false : 'Windows only (upstream)', compaction: session!.autoCompactionEnabled, retry: session!.settingsManager.getRetrySettings().enabled, httpTransport: transport.settings(), resources: options.resourceRoot, extensions: !fixedInput() && !protectedTools, skills: !fixedInput() && (!protectedTools || Boolean(options.protectedExecution?.skillRoot)), mcp: !fixedInput() && !protectedTools, codemode: !fixedInput(), sessionTree: !fixedInput() && (!protectedTools || ordinaryManaged()), ...(protectedTools ? { protectedExecution: { id: protectedTools.scope.id, profile: options.protectedExecution?.profile ?? 'protected', cwd: protectedTools.scope.cwd, writeRoots: protectedTools.scope.writeRoots ?? [], journal: 'sdk-only', backgroundLifetime: 'scope', executionId, unsupportedResources: ['existing-or-remote-mcp', 'user-execution-extensions', ...(unavailableSkills.length ? ['unavailable-skills'] : [])], unavailableSkills, unavailableTools: protectedTools.unavailableTools, pythonRuntimes: protectedTools.pythonRuntimes, codemodeStore: 'execution-scope' } } : {}), ...(semanticProvision() ? { semanticContext: semanticProvision() } : {}), extensionUI: { dialogs: fixedInput() || protectedTools ? [] : ['select', 'confirm', 'input', 'editor'], status: !fixedInput() && !protectedTools, terminalComponents: false } } });
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
    bindManagedExecution(next);
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
    if (fixedInput() && o.sessionFile) throw new Error('fixed_draft_history_not_allowed');
    if (editorText === undefined) editorText = o.draft ?? '';
    const cwd = o.workspace?.cwd ?? path.join(o.projectDirectory!, '020_clean');
    if (o.protectedExecution) {
      if (fixedInput()) throw new Error('protected_execution_profile_conflict');
      if (o.sessionFile && existsSync(o.sessionFile)) {
        const original = readFileSync(o.sessionFile, 'utf8'), header = JSON.parse(original.slice(0, original.indexOf('\n')));
        if (!original.endsWith('\n') || header.type !== 'session' || header.version !== 3) throw new Error('protected_native_version_unsupported');
      }
      protectedTools = await createProtectedTools({ scope: o.protectedExecution, codeRoot: o.codeRoot, forbiddenRoots: [o.sessionDirectory, o.resourceRoot, ...(o.sessionFile ? [o.sessionFile] : [])] });
      executionId = randomUUID();
    }
    const credentials = { read: async () => undefined, list: async () => [], modify: async () => { throw new Error('Host owns credentials.'); }, delete: async () => {} };
    // 经营推演工具按任务级开关注入普通项目任务；受管/封闭文本资源不注入——
    // 其纯计算执行体未经受限执行边界核验，按不可安全委派扩展明确不提供（SIM12）。
    const simulationTools = !fixedInput() && !o.protectedExecution && o.simulationTools ? createSimulationTools(o.simulationTools) : undefined;
    const models = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const builtin = models.getModel(o.configuration.provider, o.configuration.model);
    const providerId = `optracall-${o.configuration.id}-${o.configuration.revision}`;
    models.registerProvider(providerId, { api: o.configuration.api, baseUrl: o.configuration.baseUrl, models: [builtin ? { ...builtin, id: o.configuration.model } : { id: o.configuration.model, name: o.configuration.name, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 4096 }] });
    await models.setRuntimeApiKey(providerId, o.configuration.apiKey);
    const model = models.getModel(providerId, o.configuration.model);
    if (!model) throw new Error('model_unavailable');
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: targetCwd, agentDir, sessionManager, sessionStartEvent }) => {
      const analysisAssetsDir = path.resolve(o.codeRoot, 'extensions/analysis-assets');
      const services = await createAgentSessionServices({ cwd: targetCwd, agentDir, modelRuntime: models, resourceLoaderOptions: fixedInput() ? {
        noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true,
        disabledBuiltinExtensions: ['codemode', 'tool_search', 'mcp'],
        extensionFactories: [environmentExtension],
        systemPrompt: o.workspace!.systemPrompt.join('\n\n'), appendSystemPrompt: [],
      } : protectedTools ? {
        noExtensions: true, noSkills: !o.protectedExecution?.skillRoot, noPromptTemplates: true, noContextFiles: true, noThemes: true,
        disabledBuiltinExtensions: ['codemode', 'tool_search', 'mcp'],
        extensionFactories: [createToolSearchExtension(), environmentExtension],
        additionalSkillPaths: [analysisAssetsDir],
        skillsOverride: (base: { skills: Parameters<typeof snapshotProtectedSkills>[0]; diagnostics: any[] }) => {
          const snapshot = o.protectedExecution?.skillRoot ? snapshotProtectedSkills(base.skills, o.protectedExecution.skillRoot) : { skills: [], unavailable: [] };
          unavailableSkills = snapshot.unavailable;
          return { skills: snapshot.skills, diagnostics: [...base.diagnostics, ...snapshot.unavailable.map(name => ({ type: 'warning' as const, message: `Skill unavailable in protected execution: ${name}` }))] };
        },
        appendSystemPrompt: [...(o.workspace?.systemPrompt ?? []), ...(ordinaryManaged() ? [`You are OptraCall. The current working directory is ${targetCwd}. For analysis, do not read data in 010_draw. Analyze prepared project materials in 020_clean and authorized shared business materials announced by the Host. Write intermediate/process files to 020_clean by default and final reports to ${path.join(o.projectDirectory!, '060_reports')}. Determine analysis methods and tools yourself; these are directory conventions, not prescribed analysis steps.`, OUTPUT_EVIDENCE_GUIDANCE] : []),
          `The Host has provided a managed tool execution environment (${o.protectedExecution?.profile ?? 'protected'}). The tools run in ${protectedTools.scope.cwd}. Authorized readable material locations: ${JSON.stringify(protectedTools.scope.readRoots)}. Authorized writable locations: ${JSON.stringify([protectedTools.scope.writableRoot, ...(protectedTools.scope.writeRoots ?? [])])}. ${ordinaryManaged() ? 'Background and parallel calculations may continue across tool calls within this operation; the Host retains their resources until stop, close, or the authorized phase handoff.' : 'Existing data and reports are read-only; save new calculations and deliverables in the new workspace.'} Native session and credential files are unavailable to execution tools. Existing/remote MCP and user execution extensions are unavailable here. All child processes must remain inside this operation\'s owned execution groups: detached sessions and posix_spawn are unavailable. The python and python3 entrypoints use the installed same-version direct interpreters (${JSON.stringify(protectedTools.pythonRuntimes)}); use these entrypoints or their recorded direct executable paths instead of absolute framework launcher wrappers. Ordinary fork/exec subprocesses remain available. Choose methods and tools yourself. Codemode store/load is scoped to this execution workspace. Unavailable tools: ${JSON.stringify(protectedTools.unavailableTools)}.`, ...(o.metricIndexText ? [o.metricIndexText] : [])],
      } : {
        extensionFactories: [createCodemodeExtension({ mode: 'on' }), createToolSearchExtension(), createMcpExtension(), environmentExtension],
        additionalSkillPaths: [analysisAssetsDir],
        appendSystemPrompt: o.workspace ? [...o.workspace.systemPrompt] : [`You are OptraCall. Workspace conventions: your working directory is ${targetCwd}. For analysis, do not read data in 010_draw. Analyze prepared project materials in 020_clean and authorized shared business materials announced by the Host. 010_draw archives originals and is not automatically attached to model context. This is a soft instruction, not sensitive-data isolation; the full native tools are available without a sandbox or tool interception. Write intermediate/process files to 020_clean by default. Save final reports to ${path.join(o.projectDirectory!, '060_reports')} when asked to produce a final report. Determine analysis methods and tools yourself from the user's request. These are directory conventions, not a prescribed analysis procedure.`, OUTPUT_EVIDENCE_GUIDANCE, ...(o.metricIndexText ? [o.metricIndexText] : [])],
      } });
      // Resource reload reads disk settings; add the workspace's tool selection afterwards.
      // Plain names replace the inherited selection; an empty array means no tools.
      services.settingsManager.applyOverrides({ defaultTools: fixedInput() ? [] : protectedTools ? [...protectedTools.tools.map(tool => tool.name), 'tool_search'] : [...(o.workspace?.defaultTools ?? ['+grep', '+find', '+ls', '+codemode', '+tool_search']), ...(simulationTools ? simulationTools.map(tool => tool.name) : [])] });
      const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, ...(fixedInput() ? { tools: [], noTools: 'all' as const, excludeTools: ['*'] } : protectedTools ? { customTools: protectedTools.tools, tools: [...protectedTools.tools.map(tool => tool.name), 'tool_search'] } : simulationTools ? { customTools: simulationTools } : {}), ...(builtin?.reasoning ? { thinkingLevel: o.configuration.thinkingLevel ?? 'high' } : {}) });
      if (created.modelFallbackMessage || created.session.model?.id !== o.configuration.model || created.session.model?.provider !== providerId) { created.session.dispose(); throw new Error('model_changed'); }
      return { ...created, services, diagnostics: services.diagnostics };
    };
    manager = o.sessionFile && existsSync(o.sessionFile) ? SessionManager.open(o.sessionFile, o.sessionDirectory, cwd) : SessionManager.create(cwd, o.sessionDirectory);
    runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir: o.resourceRoot, sessionManager: manager });
    runtime.setBeforeSessionInvalidate(() => { unsubscribe?.(); unsubscribe = undefined; if (browserUI?.pending().length && run) run.cancelled = true; browserUI?.dispose(); });
    runtime.setRebindSession(bindSession);
    await bindSession(runtime.session);
    transport.setHttpIdleTimeoutMs(runtime.session.settingsManager.getHttpIdleTimeoutMs());
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
    target.appendCustomEntry(RUN_ENTRY, { phase: 'started', requestId: run.id, sessionId: target.getSessionId(), kind: run.kind, ...(run.requestFingerprint === undefined ? {} : { requestFingerprint: run.requestFingerprint }), ...(run.providedContext ? { providedContext: run.providedContext } : {}) });
    run.managers.add(target);
    if (session?.sessionManager === target) materializeNewSession(session);
  }
  function execute(id: string, kind: ActiveRun['kind'], action: () => Promise<unknown>, requestFingerprint?: string, providedContext?: Record<string, unknown>): Promise<RunResult> {
    if (run) throw new Error('session_busy');
    if (typeof id !== 'string' || !id.trim()) throw new Error('request_id_required');
    if (requestFingerprint !== undefined && (kind !== 'prompt' || typeof requestFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(requestFingerprint))) throw new Error('invalid_request_fingerprint');
    const current: ActiveRun = { id, kind, ...(requestFingerprint === undefined ? {} : { requestFingerprint }), ...(providedContext ? { providedContext } : {}), cancelled: false, retryCount: 0, pending: '', managers: new Set() };
    run = current;
    try { attachRunManager(manager!); }
    catch (error) { run = undefined; throw error; }
    publish({ type: 'run.accepted', requestId: id, sessionFile: manager!.getSessionFile() });
    publish({ type: 'snapshot', snapshot: snapshot() });
    pendingOperation = (async () => {
      let failed = false, result: unknown, failure: unknown;
      let transportCause: string | undefined;
      transport.setHttpIdleTimeoutMs(session!.settingsManager.getHttpIdleTimeoutMs());
      const stopObserving = transport.observe(options.configuration.baseUrl, record => {
        if (run !== current) return;
        transportCause = record.phase === 'failed' && typeof record.causeCode === 'string' ? record.causeCode : undefined;
        const safe = redact({ ...record, requestId: id });
        for (const target of current.managers) target.appendCustomEntry('optracall.http', { ...safe, sessionId: target.getSessionId() });
        publish({ type: 'native', requestId: id, event: { type: 'http.transport', ...safe } });
      });
      try { result = await action(); await session!.waitForIdle(); protectedTools?.assertHealthy(); } catch (error) { failed = true; failure = error; }
      finally { stopObserving(); }
      flushDelta();
      const last = current.last, nativeCancelled = Boolean(result && typeof result === 'object' && 'cancelled' in result && result.cancelled);
      const outcome: Outcome = current.cancelled || nativeCancelled || last?.stopReason === 'aborted' ? 'cancelled' : failed || current.commandFailed || last?.stopReason === 'error' ? 'failed' : 'completed';
      const diagnostic = runDiagnostic({ outcome, kind, retryCount: current.retryCount, error: failure ?? last?.errorMessage, commandFailed: current.commandFailed, transportCause });
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
  function prompt(text: string, id: string, requestFingerprint?: string, input?: ProvidedContextInput) {
    if (fixedInput() && (input?.enterprise || input?.feedback)) throw new Error('fixed_draft_materials_not_allowed');
    const providedContext = redact({ version: 1, claim: 'provided-not-adopted', providedAt: new Date().toISOString(), requestTextSha256: createHash('sha256').update(text).digest('hex'), ...(input?.rap ? { rap: input.rap } : {}), ...(input?.case ? { case: input.case } : {}), ...(input?.enterprise ? { enterprise: input.enterprise } : {}), ...(input?.feedback ? { feedback: input.feedback } : {}), ...(typeof input?.originalUserText === 'string' ? { originalUserText: input.originalUserText } : {}), ...(sapProvision() ? { sap: sapProvision() } : {}) });
    return execute(id, 'prompt', () => session!.prompt(text), requestFingerprint, providedContext);
  }
  async function command(text: string, id: string) {
    if (fixedInput()) throw new Error('fixed_draft_commands_not_allowed');
    if (protectedTools && !ordinaryManaged()) throw new Error('protected_execution_commands_not_allowed');
    const [name, ...tail] = text.trim().split(/\s+/); const argument = tail.join(' ');
    return execute(id, 'command', async () => {
      if (name === '/tools') return session!.getAllTools();
      if (name === '/session') return session!.getSessionStats();
      if (name === '/tree') return manager!.getTree();
      if (name === '/compact') return session!.compact(argument || undefined);
      if (name === '/reload') { await session!.reload(); return { reloaded: true }; }
      if (name === '/fork') {
        if (argument) return runtime!.fork(tail[0], tail[1] === 'at' ? { position: 'at' } : undefined);
        const entries = session!.getUserMessagesForForking();
        const labels = presentContextMessages(entries.map(entry => ({ role: 'user', content: entry.text })), manager!.getEntries());
        return { entries: entries.map((entry, index) => ({ ...entry, text: labels[index].originalUserText ?? entry.text })) };
      }
      if (name === '/branch') return argument ? session!.navigateTree(argument) : manager!.getBranch();
      if (name === '/skills') return session!.resourceLoader.getSkills();
      if (name === '/prompts') return session!.resourceLoader.getPrompts();
      await session!.prompt(text); return session!.getLastAssistantText();
    });
  }
  async function stop(cleanup: { retryFailed?: boolean } = { retryFailed: false }) {
    const pending = pendingOperation;
    if (run) run.cancelled = true;
    browserUI?.dismissPending();
    session?.abortCompaction(); session?.abortBranchSummary();
    const aborting = session?.abort(); void aborting?.catch(() => {});
    // Native turn completion and owned background resources are different
    // facts. Stop the latter as well, including when no SDK turn is in flight.
    await protectedTools?.close(cleanup);
    await aborting; await pending;
    await session?.waitForIdle();
    recordManagedClosure();
  }
  async function dispose(cleanup: { retryFailed?: boolean } = { retryFailed: false }) {
    browserUI?.dispose(); await stop(cleanup);
    await protectedTools?.close(cleanup);
    await runtime?.dispose(); unsubscribe?.(); unsubscribe = undefined;
    await transport.close();
  }
  process.on('message', (message: any) => { if (message?.kind !== 'request') return; void (async () => {
    try {
      let result: unknown;
      if (closing && message.method !== 'close') throw new Error('session_closing');
      if (message.method === 'open') result = await open(message.input);
      else if (message.method === 'snapshot') result = snapshot();
      else if (message.method === 'prompt' || message.method === 'command') {
        if (operation) throw new Error('session_busy');
        operation = message.method;
        try { result = message.method === 'prompt' ? await prompt(message.input.text, message.input.requestId, message.input.requestFingerprint, message.input.providedContext) : await command(message.input.text, message.input.requestId); }
        finally { operation = undefined; }
      }
      else if (message.method === 'stop') { await stop(); result = { stopped: true }; }
      else if (message.method === 'drain') { await protectedTools?.drain(); result = { drained: true }; }
      else if (message.method === 'ui-response') result = { accepted: browserUI?.respond(message.input as BrowserUIResponse) ?? false };
      else if (message.method === 'editor-state') {
        const text: unknown = message.input?.text;
        if (typeof text !== 'string') throw new Error('invalid_editor_state');
        editorText = text; browserUI?.updateEditorState(text); result = { updated: true };
      }
      else if (message.method === 'close') {
        closing = true;
        await dispose({ retryFailed: message.input?.retryFailed === true });
        // A large preceding snapshot can leave this final ACK queued on IPC.
        // Disconnect only after the actual write callback; cleanup/native
        // closure alone must never stand in for delivery to the owning Host.
        await new Promise<void>((resolve, reject) => {
          if (!process.connected || !process.send) { reject(new Error('close_ack_disconnected')); return; }
          process.send({ kind: 'reply', id: message.id, result: { closed: true } }, error => error ? reject(error) : resolve());
        });
        if (process.connected) process.disconnect?.();
        return;
      }
      else throw new Error('unknown_method');
      send({ kind: 'reply', id: message.id, result: result === undefined ? null : redact(result) });
    } catch (error) { send({ kind: 'reply', id: message.id, error: 'sdk_operation_failed', detail: redact({ message: error instanceof Error ? error.message : String(error), code: (error as NodeJS.ErrnoException | undefined)?.code }) }); }
  })(); });
  process.on('disconnect', () => { if (closing) return; closing = true; void dispose().finally(() => { process.exit(0); }); });
  send({ kind: 'ready' });
}

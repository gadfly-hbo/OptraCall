import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager, VERSION, type AgentSession, type CreateModelRuntimeOptions, type ResourceLoader } from './sdk.ts';
import type { RuntimeConfiguration } from '../host/config-memory.ts';
import type { Outcome, PresentationEvent } from './events.ts';

export const SDK_VERSION = VERSION;
export const CONNECTION_PROMPT = '请仅回复 OK。';
type AssistantReply = Awaited<ReturnType<ModelRuntime['completeSimple']>>;
export type SessionDescription = { id: string; projectId: string; configurationRevision: number; model: string; tools: string[]; persisted: boolean };
export type RunResult = { requestId: string; outcome: Outcome; text: string };
type Entry = { id: string; projectId: string; configuration: Readonly<RuntimeConfiguration>; session: AgentSession; manager: SessionManager; listeners: Set<(event: PresentationEvent) => void>; unsubscribe: () => void; run?: { requestId: string; completion: Promise<RunResult>; last?: AssistantReply; pendingText: string; cancelRequested: boolean } };

export class RuntimeFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

function emptyResources(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => 'You are OptraCall. Answer the user directly.', getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {},
  };
}

export class AgentRuntime {
  #runtime: Promise<ModelRuntime> | undefined;
  #providers = new Map<number, Promise<string>>();
  #sessions = new Map<string, Entry>();
  #closing = false;
  #generation = 0;
  #creating = new Set<Promise<SessionDescription>>();
  #reservedProjects = new Set<string>();
  #clearTask: Promise<void> | undefined;
  #cwd: string;
  constructor(cwd: string) { this.#cwd = cwd; }

  #models(): Promise<ModelRuntime> {
    if (!this.#runtime) {
      const credentials: NonNullable<CreateModelRuntimeOptions['credentials']> = { read: async () => undefined, list: async () => [], modify: async () => { throw new Error('Persistent credentials are disabled.'); }, delete: async () => {} };
      this.#runtime = ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    }
    return this.#runtime;
  }
  #provider(configuration: Readonly<RuntimeConfiguration>): Promise<string> {
    const existing = this.#providers.get(configuration.revision);
    if (existing) return existing;
    const registration = (async () => {
      const models = await this.#models();
      const id = `optracall-${configuration.revision}`;
      const builtin = configuration.sdkProvider ? models.getModel(configuration.sdkProvider, configuration.model) : undefined;
      models.registerProvider(id, { api: configuration.api ?? 'openai-completions', baseUrl: configuration.baseUrl, models: [builtin ? { ...builtin, id: configuration.model } : { id: configuration.model, name: configuration.model, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 1024 }] });
      await models.setRuntimeApiKey(id, configuration.apiKey);
      return id;
    })();
    this.#providers.set(configuration.revision, registration);
    return registration;
  }
  #entry(id: string): Entry {
    const entry = this.#sessions.get(id);
    if (!entry || this.#closing) throw new RuntimeFault('session_not_found');
    return entry;
  }
  describe(id: string): SessionDescription {
    const entry = this.#entry(id);
    return { id, projectId: entry.projectId, configurationRevision: entry.configuration.revision, model: entry.configuration.model, tools: entry.session.getActiveToolNames(), persisted: Boolean(entry.manager.getSessionFile()) };
  }
  create(projectId: string, configuration: Readonly<RuntimeConfiguration>): Promise<SessionDescription> {
    const pending = this.#create(projectId, configuration);
    this.#creating.add(pending);
    void pending.then(() => this.#creating.delete(pending), () => this.#creating.delete(pending));
    return pending;
  }
  #assertGeneration(generation: number): void { if (this.#closing || generation !== this.#generation) throw new RuntimeFault('configuration_changed'); }
  async #create(projectId: string, configuration: Readonly<RuntimeConfiguration>): Promise<SessionDescription> {
    if (this.#closing || !/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) throw new RuntimeFault('invalid_project');
    if (this.#reservedProjects.has(projectId) || [...this.#sessions.values()].some(entry => entry.projectId === projectId)) throw new RuntimeFault('project_session_exists');
    if (this.#sessions.size + this.#reservedProjects.size >= 32) throw new RuntimeFault('session_limit');
    const generation = this.#generation; this.#reservedProjects.add(projectId);
    try {
    const models = await this.#models(); this.#assertGeneration(generation);
    const providerId = await this.#provider(configuration); this.#assertGeneration(generation);
    const model = models.getModel(providerId, configuration.model);
    if (!model) throw new RuntimeFault('model_unavailable');
    const manager = SessionManager.inMemory(this.#cwd);
    const { session, modelFallbackMessage } = await createAgentSession({ cwd: this.#cwd, agentDir: path.join(this.#cwd, '.optracall-sdk-disabled-disk'), modelRuntime: models, model, thinkingLevel: model.reasoning ? 'high' : 'off', resourceLoader: emptyResources(), tools: [], customTools: [], sessionManager: manager, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, cacheWarming: 'off' }) });
    if (this.#closing || generation !== this.#generation) { session.dispose(); throw new RuntimeFault('configuration_changed'); }
    if (modelFallbackMessage || session.model?.provider !== providerId || session.model.id !== configuration.model || session.getActiveToolNames().length || manager.getSessionFile() || !session.systemPrompt.includes('You are OptraCall. Answer the user directly.') || session.systemPrompt.includes('<project_instructions')) { session.dispose(); throw new RuntimeFault('sdk_isolation_failed'); }
    const id = randomUUID();
    const entry: Entry = { id, projectId, configuration, session, manager, listeners: new Set(), unsubscribe: () => {} };
    entry.unsubscribe = session.subscribe(event => {
      const run = entry.run;
      if (!run) return;
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        const sanitized = this.#redact(entry, run.pendingText + event.assistantMessageEvent.delta);
        let held = Math.min(entry.configuration.apiKey.length - 1, sanitized.length);
        while (held > 0 && !entry.configuration.apiKey.startsWith(sanitized.slice(-held))) held--;
        run.pendingText = held ? sanitized.slice(-held) : '';
        const text = held ? sanitized.slice(0, -held) : sanitized;
        if (text) this.#emit(entry, { type: 'text.delta', sessionId: id, requestId: run.requestId, text });
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') run.last = event.message;
    });
    this.#sessions.set(id, entry);
    return this.describe(id);
    } finally { this.#reservedProjects.delete(projectId); }
  }
  #redact(entry: Entry, text: string): string { return text.split(entry.configuration.apiKey).join('[密钥已隐藏]'); }
  #emit(entry: Entry, event: PresentationEvent): void { for (const listener of entry.listeners) listener(event); }
  subscribe(id: string, listener: (event: PresentationEvent) => void): () => void { const entry = this.#entry(id); entry.listeners.add(listener); return () => entry.listeners.delete(listener); }
  start(id: string, text: string): { requestId: string; completion: Promise<RunResult> } {
    const entry = this.#entry(id);
    if (entry.run) throw new RuntimeFault('session_busy');
    if (!text.trim() || text.length > 20_000) throw new RuntimeFault('invalid_message');
    const requestId = randomUUID();
    const completion = Promise.resolve().then(async () => {
      let rejected = false;
      const cancelledBeforePrompt = entry.run?.cancelRequested;
      try { if (!cancelledBeforePrompt) await entry.session.prompt(text.trim(), { expandPromptTemplates: false }); } catch { rejected = true; }
      const last = entry.run?.last;
      const outcome: Outcome = cancelledBeforePrompt || last?.stopReason === 'aborted' || (entry.run?.cancelRequested && rejected && !last) ? 'cancelled' : rejected || !last || last.stopReason === 'error' ? 'failed' : 'completed';
      const finalText = this.#redact(entry, last?.content.filter(part => part.type === 'text').map(part => part.text).join('') ?? '');
      if (last) this.#emit(entry, { type: 'message.final', sessionId: id, requestId, text: finalText });
      this.#emit(entry, { type: 'run.settled', sessionId: id, requestId, outcome, ...(outcome === 'failed' ? { error: '模型请求未完成，请检查配置后重试。' } : {}) });
      entry.run = undefined;
      return { requestId, outcome, text: finalText };
    });
    entry.run = { requestId, completion, pendingText: '', cancelRequested: false };
    return { requestId, completion };
  }
  async stop(id: string): Promise<void> { const entry = this.#entry(id); if (!entry.run) return; const run = entry.run; run.cancelRequested = true; await entry.session.abort(); await run.completion; }
  async close(id: string): Promise<void> {
    const entry = this.#sessions.get(id);
    if (!entry) return;
    if (entry.run) { const run = entry.run; run.cancelRequested = true; await entry.session.abort(); await run.completion; }
    entry.unsubscribe(); entry.session.dispose(); entry.listeners.clear(); this.#sessions.delete(id);
  }
  clear(): Promise<void> {
    if (this.#clearTask) return this.#clearTask;
    this.#closing = true; this.#generation++;
    const pending = (async () => {
      try {
        await Promise.all([Promise.allSettled([...this.#creating]), Promise.all([...this.#sessions.keys()].map(id => this.close(id)))]);
        this.#providers.clear(); this.#runtime = undefined;
      } finally { this.#closing = false; }
    })();
    this.#clearTask = pending;
    void pending.then(() => { this.#clearTask = undefined; }, () => { this.#clearTask = undefined; });
    return pending;
  }
}

import { ProjectAgent, ProjectRuntimeError, type ProjectAgentOptions, type ProjectEvent, type ProjectSnapshot } from '../agent/project-runtime.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';

export const AGENT_SESSION_INTERFACE_VERSION = 1 as const;
declare const sessionRef: unique symbol;
export type SessionRef<Owner> = { readonly [sessionRef]: Owner };
export type SessionContext<Owner> = { readonly owner: Owner; readonly requestId?: string; isCurrent(): boolean };
export type SessionTurn = { text: string; requestId: string; kind?: 'prompt' | 'command'; requestFingerprint?: string };
export type SessionResult = { outcome: 'completed' | 'cancelled' | 'failed'; text: string; sessionFile?: string; [key: string]: unknown };
export type SessionRun<Owner> = { requestId: string; accepted: Promise<void>; completion: Promise<SessionResult>; context: SessionContext<Owner> };
export type SessionLease<Owner> = { readonly context: SessionContext<Owner>; run(turn: SessionTurn): Promise<SessionResult>; start(turn: SessionTurn): SessionRun<Owner> };
export type SessionRead<Owner> = { live: boolean; busy: boolean; opening: boolean; snapshot?: ProjectSnapshot; pendingUI: ProjectAgent['pendingUI']; context?: SessionContext<Owner> };
export type SessionFilter = { provider?: string; projectId?: string };
export type SessionRuntime = Pick<ProjectAgent, 'alive' | 'busy' | 'pendingUI' | 'open' | 'snapshot' | 'subscribe' | 'start' | 'stop' | 'close' | 'respondUI' | 'setEditorState'> & {
  startCommand(text: string, requestId: string): { requestId: string; accepted: Promise<void>; completion: Promise<any> };
};
export type SessionProfile<Owner> = {
  key(owner: Owner): string;
  projectId?(owner: Owner): string | undefined;
  configuration(owner: Owner): Readonly<RuntimeModelConfiguration> | null | undefined;
  agentOptions(owner: Owner, configuration: Readonly<RuntimeModelConfiguration>): Omit<ProjectAgentOptions, 'configuration'> | Promise<Omit<ProjectAgentOptions, 'configuration'>>;
  admit?(owner: Owner): void | Promise<void>;
  capabilities?: { commands?: boolean; ui?: boolean; editor?: boolean };
};
export type AgentSessionDomainOptions<Owner> = {
  name: string;
  profile: SessionProfile<Owner>;
  configurationSnapshot(id: string, revision: number): Readonly<RuntimeModelConfiguration> | null | undefined;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  isClosing(): boolean;
  publish?(owner: Owner, event: ProjectEvent, context: SessionContext<Owner>): void;
  /** Host tests may replace transport, while production construction stays here. */
  createAgent?(options: ProjectAgentOptions): SessionRuntime;
};
export type AgentSessionDomain<Owner> = {
  readonly name: string;
  ref(owner: Owner): SessionRef<Owner>;
  read(ref: SessionRef<Owner>): Promise<SessionRead<Owner>>;
  subscribe(ref: SessionRef<Owner>, listener: (event: ProjectEvent, context: SessionContext<Owner>) => void): () => void;
  open(ref: SessionRef<Owner>): Promise<ProjectSnapshot>;
  start(ref: SessionRef<Owner>, turn: SessionTurn): SessionRun<Owner>;
  withSession<T>(ref: SessionRef<Owner>, use: (lease: SessionLease<Owner>) => T | Promise<T>): Promise<T>;
  busy(ref: SessionRef<Owner>): boolean;
  live(ref: SessionRef<Owner>): boolean;
  stop(ref: SessionRef<Owner>): Promise<boolean>;
  close(ref: SessionRef<Owner>): Promise<void>;
  closeAll(filter?: SessionFilter): Promise<void>;
  respondUI(ref: SessionRef<Owner>, input: { id: string; value?: string | boolean; cancelled?: boolean }): Promise<any>;
  setEditorState(ref: SessionRef<Owner>, text: string): Promise<any>;
};
/** Host injects business methods with its validated owner reference. Domain
 * registration, reference minting and cross-owner cleanup remain Host-only. */
export type AgentSessionPort<Owner> = Omit<AgentSessionDomain<Owner>, 'name' | 'ref' | 'closeAll'>;

/** One implementation, instantiated by Host for separate business domains. */
export function createAgentSessionDomain<Owner>(options: AgentSessionDomainOptions<Owner>): AgentSessionDomain<Owner> {
  type Resource = { owner: Owner; agent: SessionRuntime; configuration: Readonly<RuntimeModelConfiguration>; active: boolean; operation?: Operation; closeBlocksOwner?: boolean };
  type Opening = { configuration: Readonly<RuntimeModelConfiguration>; cancelled: boolean; resource?: Resource; task: Promise<Resource> };
  type Operation = { owner: Owner; configuration: Readonly<RuntimeModelConfiguration>; cancelled: boolean; detached: boolean; leaseActive: boolean; resource?: Resource; requestId?: string; inFlight?: SessionRun<Owner> };
  type Slot = { owner: Owner; resource?: Resource; opening?: Opening; operation?: Operation; latest?: Operation };
  const refs = new WeakMap<SessionRef<Owner>, { owner: Owner; key: string }>();
  const slots = new Map<string, Slot>();
  const listeners = new Map<string, Set<(event: ProjectEvent, context: SessionContext<Owner>) => void>>();
  const closingResources = new Set<Resource>();
  const sameConfiguration = (a: Readonly<RuntimeModelConfiguration>, b: Readonly<RuntimeModelConfiguration>) =>
    a.id === b.id && a.revision === b.revision && a.provider === b.provider && a.name === b.name && a.model === b.model && a.apiKey === b.apiKey && a.api === b.api && a.baseUrl === b.baseUrl && a.thinkingLevel === b.thinkingLevel;
  const fail = (code: string): never => { throw new ProjectRuntimeError(code); };
  const identity = (ref: SessionRef<Owner>) => refs.get(ref) ?? fail('invalid_session_reference');
  const slotFor = (ref: SessionRef<Owner>) => { const { owner, key } = identity(ref); let slot = slots.get(key); if (!slot) { slot = { owner }; slots.set(key, slot); } return slot; };
  const resourceCurrent = (slot: Slot, resource: Resource) => resource.active && (slot.resource === resource || slot.opening?.resource === resource);
  const resourceContext = (slot: Slot, resource: Resource): SessionContext<Owner> => ({ owner: resource.owner, isCurrent: () => resourceCurrent(slot, resource) });
  const operationContext = (slot: Slot, operation: Operation, requestId?: string): SessionContext<Owner> => ({
    owner: operation.owner, ...(requestId === undefined ? {} : { requestId }),
    isCurrent: () => !operation.detached && slot.latest === operation && (requestId === undefined || operation.requestId === requestId) && (!operation.resource || resourceCurrent(slot, operation.resource)),
  });
  const assertConfiguration = (configuration: Readonly<RuntimeModelConfiguration>) => {
    const current = options.configurationSnapshot(configuration.id, configuration.revision);
    if (!current || !sameConfiguration(configuration, current)) fail('configuration_changed');
  };
  const assertAvailable = () => { if (options.isClosing()) fail('runtime_closed'); };
  const capture = (owner: Owner) => {
    assertAvailable();
    const value = options.profile.configuration(owner);
    if (!value) return fail('configuration_required');
    return Object.freeze({ ...value });
  };
  const blockedByClose = (slot: Slot) => [...closingResources].some(resource => resource.closeBlocksOwner && options.profile.key(resource.owner) === options.profile.key(slot.owner));
  const busySlot = (slot?: Slot) => Boolean(slot && (slot.operation || slot.opening || slot.resource?.agent.busy || slot.resource?.agent.pendingUI.length || blockedByClose(slot)));
  const assertOperation = (slot: Slot, operation: Operation) => {
    if (!operation.leaseActive || operation.cancelled || operation.detached || slot.operation !== operation) fail('generation_cancelled');
    assertAvailable(); assertConfiguration(operation.configuration);
  };
  const retire = async (resource: Resource) => {
    resource.active = false;
    closingResources.add(resource);
    try {
      await resource.agent.close();
      closingResources.delete(resource);
      resource.closeBlocksOwner = false;
    } catch (error) {
      // Failure does not establish that the old process has terminated. Keep
      // the exact resource available for retry and block new owner admission.
      resource.closeBlocksOwner = true;
      throw error;
    }
  };
  function forward(slot: Slot, resource: Resource, event: ProjectEvent) {
    if (!resourceCurrent(slot, resource)) return;
    const requestId = 'requestId' in event ? event.requestId : undefined;
    const operation = resource.operation;
    const context = requestId ? operation && operation.requestId === requestId ? operationContext(slot, operation, requestId) : undefined : resourceContext(slot, resource);
    if (!context?.isCurrent()) return;
    options.publish?.(resource.owner, event, context);
    for (const listener of listeners.get(options.profile.key(resource.owner)) ?? []) listener(event, context);
  }
  function ensureOpen(slot: Slot, owner: Owner, configuration: Readonly<RuntimeModelConfiguration>, operation?: Operation): Promise<Resource> {
    const pending = slot.opening;
    if (pending) {
      if (!sameConfiguration(pending.configuration, configuration)) return Promise.reject(new ProjectRuntimeError('session_busy'));
      return pending.task;
    }
    const existing = slot.resource;
    if (existing?.agent.alive && sameConfiguration(existing.configuration, configuration)) return Promise.resolve(existing);
    if (existing?.agent.busy) return Promise.reject(new ProjectRuntimeError('session_busy'));
    const record: Opening = { configuration, cancelled: false, task: undefined as unknown as Promise<Resource> };
    const check = () => {
      if (record.cancelled || slot.opening !== record) fail('runtime_closed');
      if (operation) assertOperation(slot, operation);
      assertAvailable(); assertConfiguration(configuration);
    };
    // Ownership is visible before joining the Host mutation gate. A close must
    // not await work queued behind itself on that gate.
    slot.opening = record;
    record.task = Promise.resolve().then(async () => {
      try {
        const agentOptions = await options.mutate(async () => { check(); await options.profile.admit?.(owner); check(); return options.profile.agentOptions(owner, configuration); });
        check();
        const agent = options.createAgent?.({ ...agentOptions, configuration }) ?? new ProjectAgent({ ...agentOptions, configuration });
        const resource: Resource = { owner, agent, configuration, active: true };
        record.resource = resource;
        agent.subscribe(event => forward(slot, resource, event));
        if (existing) {
          if (slot.resource === existing) slot.resource = undefined;
          await retire(existing);
        }
        check();
        await agent.open();
        check();
        slot.resource = resource;
        return resource;
      } catch (error) {
        if (record.resource) {
          if (slot.resource === record.resource) slot.resource = undefined;
          await retire(record.resource).catch(() => {});
        }
        throw error;
      } finally {
        if (slot.opening === record) slot.opening = undefined;
      }
    });
    void record.task.catch(() => {});
    return record.task;
  }
  function reserve(ref: SessionRef<Owner>): { slot: Slot; operation: Operation } {
    const slot = slotFor(ref), { owner } = identity(ref);
    if (busySlot(slot)) fail('session_busy');
    const operation: Operation = { owner, configuration: capture(owner), cancelled: false, detached: false, leaseActive: true };
    slot.operation = operation; slot.latest = operation;
    return { slot, operation };
  }
  function startTurn(slot: Slot, operation: Operation, turn: SessionTurn): SessionRun<Owner> {
    assertOperation(slot, operation);
    if (operation.inFlight) fail('session_busy');
    if (turn.kind === 'command' && !options.profile.capabilities?.commands) fail('unsupported_session_capability');
    operation.requestId = turn.requestId;
    let accept!: () => void, rejectAccepted!: (error: unknown) => void;
    const accepted = new Promise<void>((resolve, reject) => { accept = resolve; rejectAccepted = reject; });
    void accepted.catch(() => {});
    const handle: SessionRun<Owner> = {
      requestId: turn.requestId, accepted, context: operationContext(slot, operation, turn.requestId),
      completion: Promise.resolve().then(async () => {
        assertOperation(slot, operation);
        const resource = await ensureOpen(slot, operation.owner, operation.configuration, operation);
        operation.resource = resource;
        await options.mutate(async () => { assertOperation(slot, operation); await options.profile.admit?.(operation.owner); assertOperation(slot, operation); });
        assertOperation(slot, operation);
        if (!resourceCurrent(slot, resource) || !resource.agent.alive) fail('runtime_closed');
        resource.operation = operation;
        const run = turn.kind === 'command' ? resource.agent.startCommand(turn.text, turn.requestId) : resource.agent.start(turn.text, turn.requestId, turn.requestFingerprint);
        run.accepted.then(accept, rejectAccepted);
        const [result] = await Promise.all([run.completion, run.accepted]);
        return operation.cancelled ? { ...result, outcome: 'cancelled' as const } : result;
      }).catch(error => { rejectAccepted(error); throw error; }).finally(() => { if (operation.inFlight === handle) operation.inFlight = undefined; }),
    };
    operation.inFlight = handle;
    void handle.completion.catch(() => {});
    return handle;
  }
  async function finish(slot: Slot, operation: Operation, abandoned: boolean) {
    operation.leaseActive = false;
    const run = operation.inFlight;
    if (run && abandoned) {
      operation.cancelled = true;
      const pending = slot.opening;
      if (pending && sameConfiguration(pending.configuration, operation.configuration)) {
        pending.cancelled = true;
        if (slot.opening === pending) slot.opening = undefined;
        if (pending.resource) await retire(pending.resource).catch(() => {});
      }
      await operation.resource?.agent.stop().catch(() => {});
      // Opening may still be in the mutation queue. Cancellation prevents its
      // prompt without requiring that queue to run during credential clearing.
      await run.completion.catch(() => {});
    }
    if (slot.operation === operation) slot.operation = undefined;
  }
  async function withSession<T>(ref: SessionRef<Owner>, use: (lease: SessionLease<Owner>) => T | Promise<T>): Promise<T> {
    const { slot, operation } = reserve(ref);
    const lease: SessionLease<Owner> = {
      context: operationContext(slot, operation),
      start: turn => startTurn(slot, operation, turn),
      run: turn => startTurn(slot, operation, turn).completion,
    };
    try {
      const result = await use(lease);
      const abandoned = Boolean(operation.inFlight);
      await finish(slot, operation, abandoned);
      if (abandoned) fail('generation_cancelled');
      return result;
    } catch (error) {
      await finish(slot, operation, true);
      throw error;
    }
  }
  async function closeMatching(filter: SessionFilter, onlyKey?: string) {
    const targets = new Set<Resource>();
    const matches = (owner: Owner, configuration: Readonly<RuntimeModelConfiguration>) => (!filter.provider || configuration.provider === filter.provider) && (!filter.projectId || options.profile.projectId?.(owner) === filter.projectId) && (onlyKey === undefined || options.profile.key(owner) === onlyKey);
    for (const slot of slots.values()) {
      const operation = slot.operation;
      if (operation && matches(operation.owner, operation.configuration)) {
        operation.cancelled = true; operation.detached = true; operation.leaseActive = false;
        // Revoke dispatch/write qualifications now, but let the admitted
        // operation's own finally release its slot after safe completion.
        if (operation.resource) { operation.resource.closeBlocksOwner = true; targets.add(operation.resource); }
      }
      const pending = slot.opening;
      if (pending && matches(slot.owner, pending.configuration)) {
        pending.cancelled = true;
        if (slot.opening === pending) slot.opening = undefined;
        if (pending.resource) {
          if (operation && matches(operation.owner, operation.configuration)) pending.resource.closeBlocksOwner = true;
          targets.add(pending.resource);
        }
      }
      const resource = slot.resource;
      if (resource && matches(resource.owner, resource.configuration)) {
        if (resource.agent.busy) resource.closeBlocksOwner = true;
        slot.resource = undefined; targets.add(resource);
      }
    }
    for (const resource of closingResources) if (matches(resource.owner, resource.configuration)) targets.add(resource);
    // Invalidate every target before the first await so late events cannot be
    // projected while other resources are being closed.
    for (const resource of targets) resource.active = false;
    const settled = await Promise.allSettled([...targets].map(retire));
    const failures = settled.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(item => item.reason), 'session_close_failed');
  }
  return {
    name: options.name,
    ref(owner) { const ref = Object.freeze({}) as SessionRef<Owner>; refs.set(ref, { owner, key: options.profile.key(owner) }); return ref; },
    async read(ref) {
      const { key } = identity(ref), slot = slots.get(key);
      const resource = slot?.resource, pending = slot?.opening?.resource;
      const context = slot && resource ? resourceContext(slot, resource) : slot && pending ? resourceContext(slot, pending) : undefined;
      const snapshot = resource?.agent.alive ? await resource.agent.snapshot() : undefined;
      if (context && !context.isCurrent()) return { live: false, busy: busySlot(slots.get(key)), opening: Boolean(slots.get(key)?.opening), pendingUI: [] };
      return { live: Boolean(resource?.agent.alive), busy: busySlot(slot), opening: Boolean(slot?.opening), ...(snapshot ? { snapshot } : {}), pendingUI: (pending ?? resource)?.agent.pendingUI ?? [], ...(context ? { context } : {}) };
    },
    subscribe(ref, listener) {
      const { key } = identity(ref);
      let set = listeners.get(key); if (!set) { set = new Set(); listeners.set(key, set); }
      set.add(listener);
      return () => { set!.delete(listener); if (!set!.size && listeners.get(key) === set) listeners.delete(key); };
    },
    async open(ref) {
      const slot = slotFor(ref), { owner } = identity(ref);
      if (slot.operation || blockedByClose(slot)) fail('session_busy');
      const configuration = capture(owner);
      const resource = await ensureOpen(slot, owner, configuration);
      await options.mutate(async () => {
        assertAvailable(); await options.profile.admit?.(owner); assertConfiguration(configuration);
        if (!resourceCurrent(slot, resource)) fail('runtime_closed');
      });
      return resource.agent.snapshot();
    },
    start(ref, turn) {
      const { slot, operation } = reserve(ref);
      try {
        const run = startTurn(slot, operation, turn);
        const completion = run.completion.finally(() => finish(slot, operation, false));
        void completion.catch(() => {});
        return { ...run, completion };
      } catch (error) { void finish(slot, operation, true); throw error; }
    },
    withSession,
    busy(ref) { const { key } = identity(ref); return busySlot(slots.get(key)); },
    live(ref) { const { key } = identity(ref); return Boolean(slots.get(key)?.resource?.agent.alive); },
    async stop(ref) {
      const { key } = identity(ref), slot = slots.get(key);
      if (!slot) return false;
      const operation = slot.operation, pending = slot.opening, resource = operation?.resource ?? slot.resource;
      if (operation) operation.cancelled = true;
      if (pending) { pending.cancelled = true; if (slot.opening === pending) slot.opening = undefined; if (pending.resource) await retire(pending.resource); }
      if (resource) await resource.agent.stop();
      return Boolean(operation || pending || resource);
    },
    close(ref) { const { key } = identity(ref); return closeMatching({}, key); },
    closeAll: (filter = {}) => closeMatching(filter),
    respondUI(ref, input) {
      if (!options.profile.capabilities?.ui) return Promise.reject(new ProjectRuntimeError('unsupported_session_capability'));
      const slot = slotFor(ref), resource = slot.opening?.resource ?? slot.resource;
      if (!resource || !resourceCurrent(slot, resource) || !resource.agent.pendingUI.some(event => event.request.id === input.id)) return Promise.reject(new ProjectRuntimeError('ui_request_expired'));
      return resource.agent.respondUI(input);
    },
    setEditorState(ref, text) {
      if (!options.profile.capabilities?.editor) return Promise.reject(new ProjectRuntimeError('unsupported_session_capability'));
      const slot = slotFor(ref), resource = slot.opening?.resource ?? slot.resource;
      return resource && resourceCurrent(slot, resource) ? resource.agent.setEditorState(text) : Promise.resolve();
    },
  };
}

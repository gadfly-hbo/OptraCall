import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createAgentSessionDomain, type SessionContext, type SessionLease, type SessionRuntime, type SessionResult } from '../src/host/agent-sessions.ts';
import { ProjectRuntimeError, type ProjectAgentOptions, type ProjectEvent, type ProjectSnapshot } from '../src/agent/project-runtime.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const configuration = (id: string): RuntimeModelConfiguration => ({ id, name: id, revision: 1, provider: id, model: 'synthetic', api: 'openai-completions', apiKey: 'synthetic-only', baseUrl: 'http://127.0.0.1:1' });
class Transport implements SessionRuntime {
  alive = false; busy = false; pendingUI: Extract<ProjectEvent, { type: 'ui.request' }>[] = [];
  options: ProjectAgentOptions; calls: { text: string; id: string; kind: string }[] = [];
  openWait?: ReturnType<typeof deferred<void>>; closeWait?: ReturnType<typeof deferred<void>>; stopWait?: ReturnType<typeof deferred<void>>;
  closeError?: Error; closeCalls = 0; stopCalls = 0; editor?: string;
  closed = deferred<void>(); closeTask?: Promise<void>;
  listeners = new Set<(event: ProjectEvent) => void>();
  active?: ReturnType<typeof deferred<SessionResult>>;
  constructor(options: ProjectAgentOptions) { this.options = options; }
  state(): ProjectSnapshot { return { sessionId: `${this.options.projectId}-native`, messages: [], tools: [], status: this.busy ? 'running' : 'idle', sdkVersion: 'synthetic', capabilities: {} }; }
  async open() { if (this.openWait) await Promise.race([this.openWait.promise, this.closed.promise.then(() => { throw new ProjectRuntimeError('runtime_closed'); })]); this.alive = true; this.emit({ type: 'snapshot', snapshot: this.state() }); return this.state(); }
  async snapshot() { return this.state(); }
  subscribe(listener: (event: ProjectEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(event: ProjectEvent) { for (const listener of this.listeners) listener(event); }
  execute(text: string, id: string, kind: string) {
    this.calls.push({ text, id, kind }); this.busy = true; const active = deferred<SessionResult>(); this.active = active;
    const completion = active.promise.finally(() => { this.busy = false; if (this.active === active) this.active = undefined; });
    this.emit({ type: 'run.accepted', requestId: id });
    return { requestId: id, accepted: Promise.resolve(), completion };
  }
  start(text: string, id: string) { return this.execute(text, id, 'prompt'); }
  startCommand(text: string, id: string) { return this.execute(text, id, 'command'); }
  settle(text = 'done') { this.active?.resolve({ outcome: 'completed', text }); }
  async stop() { this.stopCalls++; if (this.stopWait) await this.stopWait.promise; this.active?.resolve({ outcome: 'cancelled', text: '' }); }
  close() {
    if (!this.closeTask) this.closeTask = (async () => { this.closeCalls++; this.alive = false; this.closed.resolve(); this.active?.resolve({ outcome: 'cancelled', text: '' }); if (this.closeWait) await this.closeWait.promise; if (this.closeError) throw this.closeError; })();
    return this.closeTask;
  }
  async respondUI(input: { id: string }) { this.pendingUI = this.pendingUI.filter(item => item.request.id !== input.id); return {}; }
  async setEditorState(text: string) { this.editor = text; }
}
function harness(name = 'synthetic', settings: { mutate?: <T>(operation: () => T | Promise<T>) => Promise<T>; setup?: (agent: Transport) => void; capabilities?: { commands?: boolean; ui?: boolean; editor?: boolean }; admit?: (owner: string) => void | Promise<void> } = {}) {
  const configurations = new Map(['a', 'b'].map(id => [id, configuration(id)]));
  let selected = configurations.get('a')!;
  const agents: Transport[] = [], events: { owner: string; event: ProjectEvent; context: SessionContext<string> }[] = [];
  const domain = createAgentSessionDomain<string>({ name,
    profile: { key: owner => owner, projectId: owner => owner.split('/')[0], configuration: () => selected,
      agentOptions: owner => ({ projectId: owner, workspace: { cwd: '/synthetic', systemPrompt: [] }, sessionDirectory: '/synthetic/sessions', codeRoot: '/synthetic', resourceRoot: '/synthetic/pi', managementPorts: [] }), capabilities: settings.capabilities, admit: settings.admit },
    configurationSnapshot: id => configurations.get(id), mutate: settings.mutate ?? (async operation => operation()), isClosing: () => false,
    publish: (owner, event, context) => { events.push({ owner, event, context }); },
    createAgent: options => { const agent = new Transport(options); settings.setup?.(agent); agents.push(agent); return agent; },
  });
  return { domain, agents, events, configurations, select(id: string) { selected = configurations.get(id)!; } };
}
async function until(check: () => boolean) { for (let n = 0; n < 100; n++) { if (check()) return; await tick(); } assert.fail('Expected transport observation did not arrive'); }

test('read and subscribe do not construct resources; refs are restricted to their domain', async () => {
  const a = harness('projects'), b = harness('requirements'), c = harness('third-feature');
  const ref = a.domain.ref('p/t'), unsubscribe = a.domain.subscribe(ref, () => {});
  assert.deepEqual(await a.domain.read(ref), { live: false, busy: false, opening: false, pendingUI: [] });
  assert.equal(a.agents.length + b.agents.length + c.agents.length, 0);
  assert.throws(() => b.domain.busy(ref), { code: 'invalid_session_reference' });
  await assert.rejects(c.domain.read(ref), { code: 'invalid_session_reference' }); unsubscribe();
});

test('accepted preserves busy until completion; newer operation invalidates captured callbacks', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  const run = h.domain.start(ref, { text: 'first', requestId: 'first' });
  assert.equal(h.domain.busy(ref), true); await run.accepted;
  assert.throws(() => h.domain.start(ref, { text: 'competing', requestId: 'duplicate' }), { code: 'session_busy' });
  const firstEvent = h.events.find(item => item.event.type === 'run.accepted')!;
  assert.equal(firstEvent.context.isCurrent(), true);
  h.agents[0]!.settle(); await run.completion; assert.equal(h.domain.busy(ref), false); assert.equal(run.context.isCurrent(), true);
  const second = h.domain.start(ref, { text: 'second', requestId: 'second' }); await second.accepted;
  assert.equal(firstEvent.context.isCurrent(), false); assert.equal(run.context.isCurrent(), false);
  const count = h.events.length; h.agents[0]!.emit({ type: 'text.delta', text: 'late', requestId: 'first' }); assert.equal(h.events.length, count);
  h.agents[0]!.settle(); await second.completion; await h.domain.closeAll();
});

test('three profiles use one implementation with separate owners, events and cancellation', async () => {
  const scopes = ['projects', 'requirements', 'third-feature'].map(name => harness(name));
  const refs = scopes.map(h => h.domain.ref('same-id'));
  const runs = scopes.map((h, i) => h.domain.start(refs[i]!, { text: 'hello', requestId: 'same-request' }));
  await Promise.all(runs.map(run => run.accepted));
  await scopes[0]!.domain.stop(refs[0]!); assert.equal((await runs[0]!.completion).outcome, 'cancelled');
  for (const i of [1, 2]) { assert.equal(scopes[i]!.domain.busy(refs[i]!), true); assert.equal(scopes[i]!.agents[0]!.stopCalls, 0); scopes[i]!.agents[0]!.settle(); await runs[i]!.completion; }
  assert.equal(scopes[1]!.events.some(item => item.event.type === 'run.settled'), false);
  await Promise.all(scopes.map(h => h.domain.closeAll()));
});

test('a domain waiting for startup UI does not block unrelated domains', async () => {
  const opening = deferred<void>();
  const blocked = harness('projects', { setup: agent => { agent.openWait = opening; agent.pendingUI = [{ type: 'ui.request', request: { id: 'q', method: 'input', title: 'startup' } }]; } });
  const other = harness('third-feature'), blockedRef = blocked.domain.ref('same'), otherRef = other.domain.ref('same');
  const blockedRun = blocked.domain.start(blockedRef, { text: 'waiting', requestId: 'waiting' });
  const rejected = assert.rejects(blockedRun.completion, { code: 'runtime_closed' }); await until(() => blocked.agents.length === 1);
  const otherRun = other.domain.start(otherRef, { text: 'independent', requestId: 'independent' }); await otherRun.accepted;
  assert.equal((await blocked.domain.read(blockedRef)).pendingUI.length, 1); await blocked.domain.stop(blockedRef); await rejected;
  assert.equal(other.domain.busy(otherRef), true); assert.equal(other.agents[0]!.stopCalls, 0); other.agents[0]!.settle(); await otherRun.completion; await other.domain.closeAll();
});

test('concurrent explicit opens share transport and startup cancellation prevents a prompt', async () => {
  const opened = deferred<void>();
  const h = harness('project', { setup: agent => { agent.openWait = opened; } }), ref = h.domain.ref('p/t');
  const one = h.domain.open(ref), two = h.domain.open(ref);
  await until(() => h.agents.length === 1); assert.equal(h.domain.busy(ref), true);
  const stopped = h.domain.stop(ref); opened.resolve(); await stopped;
  await assert.rejects(one, { code: 'runtime_closed' }); await assert.rejects(two, { code: 'runtime_closed' });
  assert.equal(h.agents[0]!.calls.length, 0);
});

test('provider close can cancel ownership waiting behind the Host mutation gate', async () => {
  const gate = deferred<void>(); let queued = false;
  const h = harness('requirements', { mutate: async operation => { queued = true; await gate.promise; return operation(); } }), ref = h.domain.ref('r');
  const run = h.domain.start(ref, { text: 'must never send', requestId: 'blocked' });
  await until(() => queued); await h.domain.closeAll({ provider: 'a' });
  assert.equal(h.agents.length, 0); gate.resolve(); await assert.rejects(run.completion, { code: 'runtime_closed' });
  assert.equal(h.domain.busy(ref), false);
});

test('lease fixes configuration across turns, owns the gap and cannot escape its callback', async () => {
  const h = harness(), ref = h.domain.ref('r'), gap = deferred<void>(); let lease!: SessionLease<string>;
  const work = h.domain.withSession(ref, async current => { lease = current; const first = current.run({ text: 'one', requestId: 'one' }); await until(() => h.agents[0]?.busy === true); h.agents[0]!.settle(); await first; await gap.promise; return current.run({ text: 'two', requestId: 'two' }); });
  await until(() => Boolean(lease) && h.agents[0]?.calls.length === 1 && !h.agents[0]?.busy);
  h.select('b'); assert.equal(h.domain.busy(ref), true); gap.resolve(); await until(() => h.agents[0]?.calls.length === 2);
  assert.equal(h.agents.length, 1); assert.equal(h.agents[0]!.options.configuration.provider, 'a'); h.agents[0]!.settle(); await work;
  assert.throws(() => lease.start({ text: 'escaped', requestId: 'three' }), { code: 'generation_cancelled' }); await h.domain.closeAll();
});

test('one lease rejects concurrent turns and preserves its first run identity', async () => {
  const h = harness(), ref = h.domain.ref('r');
  await h.domain.withSession(ref, async lease => {
    const first = lease.start({ text: 'first', requestId: 'first' }); await first.accepted;
    assert.throws(() => lease.start({ text: 'second', requestId: 'second' }), { code: 'session_busy' });
    assert.equal(first.context.isCurrent(), true); h.agents[0]!.settle(); await first.completion;
  });
  assert.equal(h.agents[0]!.calls.length, 1); await h.domain.closeAll();
});

test('gap cancellation prevents a second turn without releasing somebody else’s operation', async () => {
  const h = harness(), ref = h.domain.ref('r'), gap = deferred<void>();
  const work = h.domain.withSession(ref, async lease => { const first = lease.run({ text: 'one', requestId: 'one' }); await until(() => h.agents[0]?.busy === true); h.agents[0]!.settle(); await first; await gap.promise; return lease.run({ text: 'two', requestId: 'two' }); });
  await until(() => h.agents[0]?.calls.length === 1 && !h.agents[0]?.busy); await h.domain.stop(ref); assert.equal(h.domain.busy(ref), true);
  gap.resolve(); await assert.rejects(work, { code: 'generation_cancelled' }); assert.equal(h.agents[0]!.calls.length, 1); await h.domain.closeAll();
});

test('abandoned in-flight lease drains before becoming idle and preserves callback failure', async () => {
  for (const shouldThrow of [false, true]) {
    const h = harness(), ref = h.domain.ref('r'), proceed = deferred<void>(), stopping = deferred<void>(), original = new Error('business callback failed');
    const work = h.domain.withSession(ref, async lease => { void lease.run({ text: 'one', requestId: 'one' }); await proceed.promise; if (shouldThrow) throw original; return 'premature success'; });
    const rejected = assert.rejects(work, shouldThrow ? error => error === original : { code: 'generation_cancelled' });
    await until(() => h.agents[0]?.busy === true); h.agents[0]!.stopWait = stopping; proceed.resolve(); await until(() => h.agents[0]!.stopCalls > 0);
    assert.equal(h.domain.busy(ref), true); stopping.resolve(); await rejected; assert.equal(h.domain.busy(ref), false); await h.domain.closeAll();
  }
});

test('return during native opening closes the opening and never dispatches the abandoned run', async () => {
  const opening = deferred<void>(), proceed = deferred<void>();
  const h = harness('requirements', { setup: agent => { agent.openWait = opening; } }), ref = h.domain.ref('r');
  const work = h.domain.withSession(ref, async lease => { void lease.run({ text: 'one', requestId: 'one' }); await proceed.promise; });
  const rejected = assert.rejects(work, { code: 'generation_cancelled' });
  await until(() => h.agents.length === 1); proceed.resolve(); await rejected;
  assert.equal(h.agents[0]!.closeCalls, 1); assert.equal(h.agents[0]!.calls.length, 0); assert.equal(h.domain.busy(ref), false);
});

test('closing old provider A keeps replacement B opening and late A callbacks isolated', async () => {
  const h = harness(), ref = h.domain.ref('r'); await h.domain.open(ref);
  const old = h.agents[0]!, wait = deferred<void>(); old.closeWait = wait; h.select('b');
  const replacement = h.domain.open(ref); await until(() => h.agents.length === 2 && old.closeCalls === 1);
  const count = h.events.length, clearing = h.domain.closeAll({ provider: 'a' });
  old.emit({ type: 'ui.editor', text: 'old draft' }); assert.equal(h.events.length, count);
  assert.equal(h.domain.busy(ref), true); wait.resolve(); await clearing; await replacement;
  assert.equal(h.domain.live(ref), true); assert.equal(h.agents[1]!.closeCalls, 0); assert.equal((await h.domain.read(ref)).context?.isCurrent(), true); await h.domain.closeAll();
});

test('explicit close permits replacement while its old generation is still draining', async () => {
  const h = harness(), ref = h.domain.ref('r'); await h.domain.open(ref);
  const old = h.agents[0]!, wait = deferred<void>(); old.closeWait = wait;
  const closing = h.domain.close(ref); await h.domain.open(ref); assert.equal(h.agents.length, 2);
  wait.resolve(); await closing; assert.equal(h.domain.live(ref), true); assert.equal(h.agents[1]!.closeCalls, 0); await h.domain.closeAll();
});

test('closing an accepted run retains busy until its resource has safely closed', async () => {
  const h = harness(), ref = h.domain.ref('r');
  const run = h.domain.start(ref, { text: 'accepted', requestId: 'accepted' }); await run.accepted;
  const wait = deferred<void>(); h.agents[0]!.closeWait = wait;
  const closing = h.domain.close(ref);
  try {
    assert.equal(h.domain.busy(ref), true, 'close must not release an admitted operation before resource drain');
    assert.throws(() => h.domain.start(ref, { text: 'competing', requestId: 'competing' }), { code: 'session_busy' });
    assert.equal(run.context.isCurrent(), false, 'closing revokes late business writes immediately');
    await run.completion;
    assert.equal(h.domain.busy(ref), true, 'settled model completion alone does not prove the held resource close finished');
  } finally { wait.resolve(); await closing; await run.completion; }
  assert.equal(h.domain.busy(ref), false);
});

test('failed resource close remains busy and is available to a later explicit close', async () => {
  const h = harness(), ref = h.domain.ref('r'); await h.domain.open(ref);
  h.agents[0]!.closeError = new Error('close did not establish termination');
  await assert.rejects(h.domain.close(ref), { message: 'session_close_failed' });
  assert.equal(h.domain.busy(ref), true, 'a failed close must not be advertised as idle');
  assert.throws(() => h.domain.start(ref, { text: 'unsafe replacement', requestId: 'unsafe' }), { code: 'session_busy' });
  await assert.rejects(h.domain.open(ref), { code: 'session_busy' });
  await assert.rejects(h.domain.close(ref), { message: 'session_close_failed' });
  h.agents[0]!.closeTask = undefined; h.agents[0]!.closeError = undefined;
  await h.domain.close(ref); assert.equal(h.domain.busy(ref), false);
});

test('failed close of idle A preserves an already admitted replacement B and retries only A', async () => {
  const h = harness(), ref = h.domain.ref('r'); await h.domain.open(ref);
  const old = h.agents[0]!, wait = deferred<void>(); old.closeWait = wait; old.closeError = new Error('old A termination unknown');
  const closeA = h.domain.closeAll({ provider: 'a' }); const rejected = assert.rejects(closeA, { message: 'session_close_failed' });
  h.select('b'); const runB = h.domain.start(ref, { text: 'already admitted B', requestId: 'b' }); await runB.accepted;
  wait.resolve(); await rejected;
  assert.equal(runB.context.isCurrent(), true); assert.equal(h.agents[1]!.closeCalls, 0); assert.equal(h.agents[1]!.alive, true);
  await assert.rejects(h.domain.closeAll({ provider: 'a' }), { message: 'session_close_failed' }); assert.equal(h.agents[1]!.closeCalls, 0);
  h.agents[1]!.settle(); assert.equal((await runB.completion).outcome, 'completed'); assert.equal(h.domain.busy(ref), true);
  old.closeTask = undefined; old.closeError = undefined; await h.domain.closeAll({ provider: 'a' });
  assert.equal(h.domain.busy(ref), false); assert.equal(h.domain.live(ref), true); await h.domain.closeAll();
});

test('UI works during opening, expired answers reject, and commands need declared capabilities', async () => {
  const opening = deferred<void>();
  const h = harness('projects', { capabilities: { ui: true, commands: true, editor: true }, setup: agent => { agent.openWait = opening; agent.pendingUI = [{ type: 'ui.request', request: { id: 'question', method: 'input', title: 'startup' } }]; } }), ref = h.domain.ref('p/t');
  const work = h.domain.open(ref); await until(() => h.agents.length === 1);
  const read = await h.domain.read(ref); assert.equal(read.opening, true); assert.equal(read.context?.isCurrent(), true); assert.equal(read.pendingUI[0]?.request.id, 'question');
  await h.domain.respondUI(ref, { id: 'question', value: 'answer' }); await assert.rejects(h.domain.respondUI(ref, { id: 'question' }), { code: 'ui_request_expired' });
  opening.resolve(); await work; await h.domain.setEditorState(ref, 'draft'); assert.equal(h.agents[0]!.editor, 'draft');
  const run = h.domain.start(ref, { kind: 'command', text: '/new', requestId: 'cmd' }); await run.accepted; assert.equal(h.agents[0]!.calls[0]?.kind, 'command'); h.agents[0]!.settle(); await run.completion; await h.domain.closeAll();
  const noUI = harness('requirements'); await assert.rejects(noUI.domain.respondUI(noUI.domain.ref('r'), { id: 'any' }), { code: 'unsupported_session_capability' });
});

test('configuration identity includes model and thinking settings even with unchanged credentials', async () => {
  const h = harness(), ref = h.domain.ref('r');
  h.configurations.get('a')!.thinkingLevel = 'high';
  const gap = deferred<void>(); const work = h.domain.withSession(ref, async lease => { await gap.promise; return lease.run({ text: 'never send', requestId: 'one' }); });
  h.configurations.get('a')!.thinkingLevel = 'low'; gap.resolve(); await assert.rejects(work, { code: 'configuration_changed' }); assert.equal(h.agents.length, 0);
});

test('business-only lease preflight can return without creating a worker', async () => {
  const h = harness(), ref = h.domain.ref('r');
  assert.equal(await h.domain.withSession(ref, lease => { assert.equal(lease.context.isCurrent(), true); assert.equal(h.domain.busy(ref), true); return 'existing receipt'; }), 'existing receipt');
  assert.equal(h.agents.length, 0); assert.equal(h.domain.busy(ref), false);
});

test('explicit open rechecks business admission even when reusing an idle transport', async () => {
  let archived = false;
  const h = harness('projects', { admit: () => { if (archived) throw new ProjectRuntimeError('project_archived'); } }), ref = h.domain.ref('p/t');
  await h.domain.open(ref); archived = true;
  await assert.rejects(h.domain.open(ref), { code: 'project_archived' });
  assert.equal(h.agents.length, 1); await h.domain.closeAll();
});

test('one close failure does not skip other resources and is not reported as success', async () => {
  const h = harness(); await h.domain.open(h.domain.ref('one')); await h.domain.open(h.domain.ref('two'));
  h.agents[0]!.closeError = new Error('synthetic close failure');
  await assert.rejects(h.domain.closeAll(), { message: 'session_close_failed' }); assert.equal(h.agents[1]!.closeCalls, 1);
  await assert.rejects(h.domain.closeAll(), { message: 'session_close_failed' });
});

test('ER01: owner cancellation overrides stale failure diagnostics while preserving native retry count', async () => {
  for (const kind of ['prompt', 'command'] as const) {
    const h = harness('diagnostic-cancellation', { capabilities: { commands: true } }), ref = h.domain.ref('p/t');
    const run = h.domain.start(ref, { text: 'synthetic cancellation race', requestId: 'diagnostic-cancel-race', kind });
    await run.accepted;
    const agent = h.agents[0]!;
    agent.stop = async () => { agent.stopCalls++; agent.active?.resolve({ outcome: 'failed', text: '', diagnostic: { code: 'request_terminated', stage: 'native_request', message: '原生模型请求意外终止，底层原因尚未确定。', retryCount: 2 } }); };
    await h.domain.stop(ref);
    const result = await run.completion;
    assert.equal(result.outcome, 'cancelled');
    assert.deepEqual(result.diagnostic, { code: 'cancelled', stage: kind === 'command' ? 'native_command' : 'native_request', message: '本次操作已取消。', retryCount: 2 });
    assert.equal(agent.calls.length, 1); assert.equal(agent.stopCalls, 1);
    await h.domain.closeAll();
  }
});

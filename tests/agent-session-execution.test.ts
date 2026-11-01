import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSessionDomain, type SessionLease, type SessionExecutionPlan } from '../src/host/agent-sessions.ts';

const config = { id: 'model', revision: 1, name: 'synthetic', provider: 'synthetic', model: 'fixture', apiKey: 'fixture', api: 'openai-completions', baseUrl: 'https://example.invalid', thinkingLevel: 'high' } as const;
function harness(providerFor?: (owner: string) => string, initialExecution?: SessionExecutionPlan['protectedExecution']) {
  let initial = initialExecution;
  const agents: any[] = [];
  const configurations = new Map<string, typeof config>();
  const configuration = (owner: string) => {
    if (!providerFor) return config;
    const provider = providerFor(owner), value = { ...config, id: `model-${provider}`, provider };
    configurations.set(value.id, value as typeof config); return value;
  };
  const domain = createAgentSessionDomain<string>({ name: 'execution-fixture',
    profile: { key: owner => owner, projectId: owner => owner.split('/')[0], configuration,
      executionMode: () => initial ? initial.profile ?? 'protected' : 'unmanaged',
      agentOptions: owner => ({ projectId: owner, projectDirectory: '/synthetic/project', sessionDirectory: '/synthetic/sessions', sessionFile: '/synthetic/sessions/original.jsonl', resourceRoot: '/synthetic/pi', codeRoot: '/synthetic/code', managementPorts: [], ...(initial ? { protectedExecution: initial } : {}) }) },
    configurationSnapshot: id => providerFor ? configurations.get(id) : config, mutate: async use => use(), isClosing: () => false,
    createAgent: options => {
      const agent = { options, alive: true, busy: false, pendingUI: [], closed: 0, closeError: false,
        subscribe() { return () => {}; }, async open() { return this.snapshot(); },
        async snapshot() { return { sessionId: 'same-original', sessionFile: options.sessionFile, messages: [], tools: [], status: 'idle', sdkVersion: 'fixture', capabilities: {} } as any; },
        async close() { this.closed++; if (this.closeError) throw new Error('termination unknown'); this.alive = false; },
        async stop() {}, async respondUI() {}, async setEditorState() {},
        start() { throw new Error('This test does not dispatch models'); }, startCommand() { throw new Error('This test does not dispatch commands'); },
      };
      agents.push(agent); return agent;
    },
  });
  return { domain, agents, setInitial: (value?: SessionExecutionPlan['protectedExecution']) => { initial = value; } };
}
const scope = { id: 'synthetic-scope', cwd: '/synthetic/new/work', writableRoot: '/synthetic/new', readRoots: ['/synthetic/fixed'] };

test('an unmanaged resource cannot acquire a managed transition merely because its driver close succeeds', async () => {
  const h = harness(), ref = h.domain.ref('p/t'); await h.domain.open(ref);
  await assert.rejects(h.domain.withSession(ref, lease => lease.reopen(h.domain.execution(ref, { protectedExecution: scope }))), { code: 'unmanaged_execution_unknown' });
  assert.equal(h.agents.length, 1, 'no new managed driver was opened');
  await h.domain.close(ref);
  assert.equal(h.domain.executionState(ref).unmanagedSeen, true, 'closing the old driver does not erase unknown descendants');
  assert.throws(() => h.domain.registerFresh(ref), { code: 'unmanaged_execution_unknown' });
});

test('fresh registration and execution state are Host-only facts and cannot reset prior unmanaged execution', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  assert.equal(h.domain.executionState(ref).freshRegistered, false);
  h.domain.registerFresh(ref);
  assert.equal(h.domain.executionState(ref).freshRegistered, true);
  await h.domain.open(ref);
  assert.equal(h.domain.executionState(ref).mode, 'unmanaged');
  assert.throws(() => h.domain.registerFresh(ref), { code: 'unmanaged_execution_unknown' });
  await h.domain.closeAll();
});

test('default managed resources remain occupied while background work drains and close only after it settles', async () => {
  const h = harness(undefined, { ...scope, profile: 'ordinary' }), ref = h.domain.ref('p/t');
  await h.domain.open(ref);
  let release!: () => void, started!: () => void;
  const drained = new Promise<void>(r => { release = r; }), waiting = new Promise<void>(r => { started = r; });
  h.agents[0].drain = async () => { started(); await drained; };
  const work = h.domain.withSession(ref, async () => {});
  await waiting;
  assert.equal(h.domain.busy(ref), true); assert.equal(h.agents[0].closed, 0);
  release(); await work;
  assert.equal(h.agents[0].closed, 1); assert.equal(h.domain.busy(ref), false);
});

test('user stop interrupts a managed background drain and does not release occupancy before cleanup', async () => {
  const h = harness(undefined, { ...scope, profile: 'ordinary' }), ref = h.domain.ref('p/t');
  await h.domain.open(ref);
  let release!: () => void, ready!: () => void, stops = 0;
  const pending = new Promise<void>(r => { release = r; }), draining = new Promise<void>(r => { ready = r; });
  h.agents[0].drain = async () => { ready(); await pending; };
  h.agents[0].stop = async () => { stops++; release(); };
  const work = h.domain.withSession(ref, async () => {});
  await draining; assert.equal(h.domain.busy(ref), true);
  await Promise.all([h.domain.stop(ref), work]);
  assert.equal(stops, 1); assert.equal(h.agents[0].closed, 1); assert.equal(h.domain.busy(ref), false);
});

test('turning managed execution off retires its resource before opening the ordinary unrestricted profile', async () => {
  const h = harness(undefined, { ...scope, profile: 'ordinary' }), ref = h.domain.ref('p/t');
  await h.domain.open(ref); h.setInitial(undefined); await h.domain.open(ref);
  assert.equal(h.agents[0].closed, 1);
  assert.equal(h.agents[1].options.protectedExecution, undefined);
  assert.equal(h.domain.executionState(ref).mode, 'unmanaged');
  assert.equal(h.domain.executionState(ref).unmanagedSeen, true);
  await h.domain.closeAll();
});

test('v2 switches execution under the same occupied owner and canonical session, then retires protected resources', async () => {
  const h = harness(undefined, { ...scope, profile: 'ordinary' }), ref = h.domain.ref('p/t'); await h.domain.open(ref);
  let permit: any;
  await h.domain.withSession(ref, async lease => {
    permit = h.domain.execution(ref, { protectedExecution: scope });
    const snapshot = await lease.reopen(permit);
    assert.equal(snapshot.sessionId, 'same-original');
    assert.equal(h.agents[0].closed, 1);
    assert.equal(h.agents[1].options.sessionFile, '/synthetic/sessions/original.jsonl');
    assert.deepEqual(h.agents[1].options.protectedExecution, scope);
    assert.equal(h.agents[1].options.workspace, undefined, 'SDK logical cwd stays original; only tool execution cwd changes');
    assert.equal(h.domain.busy(ref), true);
    assert.throws(() => h.domain.start(ref, { requestId: 'competing', text: 'competing' }), { code: 'session_busy' });
  });
  assert.equal(h.agents[1].closed, 1);
  assert.equal(h.domain.busy(ref), false);
  await h.domain.withSession(ref, async lease => { await assert.rejects(lease.reopen(permit), { code: 'invalid_session_execution' }); });
  h.setInitial(undefined); await h.domain.open(ref); assert.equal(h.agents[2].options.protectedExecution, undefined);
  await h.domain.closeAll();
});

test('execution permits cannot cross domains or owners and cannot be supplied by business JSON', async () => {
  const a = harness(), b = harness(), ar = a.domain.ref('p/t'), br = b.domain.ref('p/t');
  await a.domain.withSession(ar, async lease => {
    const permit = a.domain.execution(ar, { protectedExecution: scope });
    await assert.rejects(lease.reopen({} as any), { code: 'invalid_session_execution' });
    await b.domain.withSession(br, async other => { await assert.rejects(other.reopen(permit), { code: 'invalid_session_execution' }); });
  });
  assert.equal(a.agents.length + b.agents.length, 0);
});

test('parent stop revokes dispatch before awaiting its child cancellation and keeps the lease occupied', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  let release!: () => void, admitted!: () => void, childStops = 0;
  const gap = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { admitted = r; });
  const work = h.domain.withSession(ref, async lease => {
    lease.onCancel(async () => { childStops++; }); admitted(); await gap;
    assert.throws(() => lease.start({ requestId: 'late', text: 'must not run' }), { code: 'generation_cancelled' });
  });
  await ready; await h.domain.stop(ref); await h.domain.stop(ref);
  assert.equal(childStops, 1); assert.equal(h.domain.busy(ref), true);
  release(); await work; assert.equal(h.domain.busy(ref), false); assert.equal(h.agents.length, 0);
});

test('a failed managed-resource close never opens a protected replacement or advertises idle', async () => {
  const h = harness(undefined, { ...scope, profile: 'ordinary' }), ref = h.domain.ref('p/t'); await h.domain.open(ref); h.agents[0].closeError = true;
  await assert.rejects(h.domain.withSession(ref, lease => lease.reopen(h.domain.execution(ref, { protectedExecution: scope }))), /termination unknown/);
  assert.equal(h.agents.length, 1); assert.equal(h.domain.busy(ref), true);
  h.agents[0].closeError = false; await h.domain.closeAll(); assert.equal(h.domain.busy(ref), false);
});

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test('finishing a phase gap waits for the actual child cancellation before releasing occupancy', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  let releaseUse!: () => void, releaseChild!: () => void, ready!: () => void;
  const useGap = new Promise<void>(r => { releaseUse = r; }), childGap = new Promise<void>(r => { releaseChild = r; }), admitted = new Promise<void>(r => { ready = r; });
  let finished = false;
  const work = h.domain.withSession(ref, async lease => { lease.onCancel(() => childGap); ready(); await useGap; }).then(() => { finished = true; });
  await admitted; const stopping = h.domain.stop(ref); releaseUse(); await tick();
  try { assert.equal(finished, false); assert.equal(h.domain.busy(ref), true); }
  finally { releaseChild(); await Promise.all([work, stopping]); }
  assert.equal(h.domain.busy(ref), false);
});

test('failed child stop quarantines its owner and explicit close retries only failed handlers', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  let release!: () => void, ready!: () => void, fail = true, failedCalls = 0, healthyCalls = 0;
  const gap = new Promise<void>(r => { release = r; }), admitted = new Promise<void>(r => { ready = r; });
  const work = h.domain.withSession(ref, async lease => {
    lease.onCancel(() => { healthyCalls++; });
    lease.onCancel(() => { failedCalls++; if (fail) throw new Error('child still alive'); }); ready(); await gap;
  });
  await admitted; await assert.rejects(h.domain.stop(ref), /session_child_stop_failed/);
  release(); await assert.rejects(work, /session_child_stop_failed/);
  assert.equal(h.domain.busy(ref), true);
  assert.throws(() => h.domain.start(ref, { requestId: 'unsafe', text: 'new work' }), { code: 'session_busy' });
  fail = false; await h.domain.close(ref);
  assert.equal(h.domain.busy(ref), false); assert.equal(healthyCalls, 1); assert.equal(failedCalls, 2);
});

test('a callback failure without an in-flight parent turn still cleans children and quarantines failed cleanup', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  let fail = true, closes = 0;
  await assert.rejects(h.domain.withSession(ref, async lease => {
    lease.onCancel(() => { closes++; if (fail) throw new Error('child cleanup unknown'); });
    throw new Error('child session finish failed');
  }), /session_child_stop_failed/);
  assert.equal(closes, 1); assert.equal(h.domain.busy(ref), true);
  assert.throws(() => h.domain.start(ref, { requestId: 'unsafe', text: 'must remain quarantined' }), { code: 'session_busy' });
  fail = false; await h.domain.close(ref);
  assert.equal(closes, 2); assert.equal(h.domain.busy(ref), false);
});

test('closing one Provider never waits for another Providers child cancellation', async () => {
  const h = harness(owner => owner.startsWith('a/') ? 'a' : 'b'), ar = h.domain.ref('a/t'), br = h.domain.ref('b/t');
  await h.domain.open(ar);
  let releaseUse!: () => void, releaseChild!: () => void, ready!: () => void;
  const useGap = new Promise<void>(r => { releaseUse = r; }), childGap = new Promise<void>(r => { releaseChild = r; }), admitted = new Promise<void>(r => { ready = r; });
  const work = h.domain.withSession(br, async lease => { lease.onCancel(() => childGap); ready(); await useGap; });
  await admitted; const stopping = h.domain.stop(br);
  let closed = false; const closeA = h.domain.closeAll({ provider: 'a' }).then(() => { closed = true; });
  await tick(); await tick();
  try { assert.equal(closed, true); assert.equal(h.domain.busy(br), true); }
  finally { releaseChild(); releaseUse(); await Promise.all([work, stopping, closeA]); }
  await h.domain.closeAll();
});

test('a protected close failure stays occupied until an explicit close establishes termination', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  await assert.rejects(h.domain.withSession(ref, async lease => {
    await lease.reopen(h.domain.execution(ref, { protectedExecution: scope })); h.agents[0].closeError = true;
  }), /termination unknown/);
  assert.equal(h.domain.busy(ref), true);
  h.agents[0].closeError = false; await h.domain.close(ref);
  assert.equal(h.domain.busy(ref), false);
});

test('execution permits cannot cross owners or replace an in-flight turn', async () => {
  const h = harness(), ar = h.domain.ref('p/a'), br = h.domain.ref('p/b');
  await h.domain.withSession(ar, async lease => {
    const permit = h.domain.execution(ar, { protectedExecution: scope });
    await h.domain.withSession(br, async other => { await assert.rejects(other.reopen(permit), { code: 'invalid_session_execution' }); });
    const run = lease.start({ requestId: 'in-flight', text: 'synthetic' });
    await assert.rejects(lease.reopen(permit), { code: 'session_busy' });
    await assert.rejects(run.completion, /does not dispatch models/);
  });
  await h.domain.closeAll();
});

test('quiesce waits for ordinary termination and a stop in that gap prevents protected reopening', async () => {
  const h = harness(undefined, { ...scope, profile: 'ordinary' }), ref = h.domain.ref('p/t'); await h.domain.open(ref);
  let releaseClose!: () => void, closeStarted!: () => void;
  const gap = new Promise<void>(r => { releaseClose = r; }), entered = new Promise<void>(r => { closeStarted = r; });
  h.agents[0].close = async () => { closeStarted(); await gap; h.agents[0].alive = false; };
  const work = h.domain.withSession(ref, lease => lease.reopen(h.domain.execution(ref, { protectedExecution: scope })));
  await entered; assert.equal(h.agents.length, 1); assert.equal(h.domain.busy(ref), true);
  const stopping = h.domain.stop(ref); releaseClose();
  await assert.rejects(work, { code: 'generation_cancelled' }); await stopping;
  assert.equal(h.agents.length, 1); assert.equal(h.domain.busy(ref), false);
});

test('one unknown managed cleanup is quarantined without an implicit second close', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  await assert.rejects(h.domain.withSession(ref, async lease => {
    await lease.reopen(h.domain.execution(ref, { protectedExecution: scope }));
    h.agents[0].close = async function () {
      this.closed++;
      if (this.closed === 1) throw new Error('first termination unknown');
      this.alive = false;
    };
  }), /first termination unknown/);
  assert.equal(h.agents[0].closed, 1, 'callback completion cannot retry a failed close');
  assert.equal(h.domain.busy(ref), true, 'the original operation remains quarantined');
  assert.throws(() => h.domain.start(ref, { requestId: 'blocked-new-request', text: 'must not dispatch' }), { code: 'session_busy' });
  await h.domain.close(ref);
  assert.equal(h.agents[0].closed, 2, 'only the explicit cleanup request retries');
  assert.equal(h.domain.busy(ref), false);
});

test('a failed quiesce is not retried by the abandoned callback finalizer', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  await assert.rejects(h.domain.withSession(ref, async lease => {
    await lease.reopen(h.domain.execution(ref, { protectedExecution: scope }));
    h.agents[0].close = async function () {
      this.closed++;
      if (this.closed === 1) throw new Error('quiesce termination unknown');
      this.alive = false;
    };
    await lease.quiesce();
  }), /quiesce termination unknown/);
  assert.equal(h.agents[0].closed, 1);
  assert.equal(h.domain.busy(ref), true);
  await h.domain.close(ref);
  assert.equal(h.agents[0].closed, 2);
  assert.equal(h.domain.busy(ref), false);
});

test('managed stop failure and finalization share one cleanup result until explicit close', async () => {
  const h = harness(), ref = h.domain.ref('p/t');
  let ready!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { ready = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let stopCalls = 0;
  const work = h.domain.withSession(ref, async lease => {
    await lease.reopen(h.domain.execution(ref, { protectedExecution: scope }));
    h.agents[0].stop = async () => { stopCalls++; throw new Error('stop termination unknown'); };
    ready(); await waiting;
  });
  await entered;
  await assert.rejects(h.domain.stop(ref), /stop termination unknown/);
  release(); await assert.rejects(work, /stop termination unknown/);
  assert.equal(stopCalls, 1);
  assert.equal(h.agents[0].closed, 0, 'finally cannot retry after unknown stop');
  assert.equal(h.domain.busy(ref), true);
  await h.domain.close(ref);
  assert.equal(h.agents[0].closed, 1);
  assert.equal(h.domain.busy(ref), false);
});

test('automatic child cleanup cannot acquire an explicit retry through its parent finalizer', async () => {
  const h = harness(), parent = h.domain.ref('p/parent'), child = h.domain.ref('p/child');
  let requests: boolean[] = [];
  await assert.rejects(h.domain.withSession(parent, async lease => {
    lease.onCancel(cleanup => { requests.push(cleanup.retryFailed); return h.domain.close(child, cleanup); });
    await h.domain.withSession(child, async childLease => {
      await childLease.reopen(h.domain.execution(child, { protectedExecution: scope }));
      h.agents[0].close = async function () {
        this.closed++;
        if (this.closed === 1) throw new Error('child termination unknown once');
        this.alive = false;
      };
    });
  }), /session_child_stop_failed/);
  assert.deepEqual(requests, [false]);
  assert.equal(h.agents[0].closed, 1, 'automatic parent finally observes the same failed child cleanup');
  assert.equal(h.domain.busy(parent), true); assert.equal(h.domain.busy(child), true);
  await h.domain.close(parent);
  assert.deepEqual(requests, [false, true], 'only a new explicit close carries retry permission');
  assert.equal(h.agents[0].closed, 2);
  assert.equal(h.domain.busy(parent), false); assert.equal(h.domain.busy(child), false);
});

test('managed retirement carries its existing explicit retry authority down to the runtime', async () => {
  const h = harness(undefined, { ...scope, profile: 'ordinary' }), ref = h.domain.ref('p/t');
  await h.domain.open(ref);
  const requests: (boolean | undefined)[] = [];
  h.agents[0].drain = async () => { throw new Error('natural collection unknown'); };
  h.agents[0].close = async function (cleanup?: { retryFailed: boolean }) {
    requests.push(cleanup?.retryFailed);
    if (!cleanup?.retryFailed) throw new Error('natural collection unknown');
    this.alive = false;
  };
  await assert.rejects(h.domain.withSession(ref, async () => {}), /natural collection unknown|session_close_failed/);
  assert.deepEqual(requests, [false], 'automatic close cannot retry a subgroup retirement that already failed');
  assert.equal(h.domain.busy(ref), true);
  await assert.rejects(h.domain.close(ref, { retryFailed: false }), /natural collection unknown|session_close_failed/);
  assert.deepEqual(requests, [false]);
  await h.domain.close(ref);
  assert.deepEqual(requests, [false, true]);
  assert.equal(h.domain.busy(ref), false);
});

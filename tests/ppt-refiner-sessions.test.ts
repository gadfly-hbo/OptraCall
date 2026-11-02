import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as tick } from 'node:timers/promises';
import { createPptRefinerSessions, type PptRefinerSessionLease } from '../src/host/ppt-refiner-sessions.ts';
import { createDeckStore } from '../extensions/business-plugins/ppt-refiner/storage/deck-store.ts';
import type { SessionRuntime, SessionResult } from '../src/host/agent-sessions.ts';
import type { ProjectAgentOptions, ProjectEvent, ProjectSnapshot } from '../src/agent/project-runtime.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/fixtures/ppt-report/deck-good.pptx');
const report = path.join(root, 'tests/fixtures/ppt-report/report.md');
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function until(check: () => boolean) { for (let n = 0; n < 100; n++) { if (check()) return; await tick(); } assert.fail('Expected synthetic runtime observation'); }
const configuration = (id: string): RuntimeModelConfiguration => ({ id, revision: 1, provider: `provider-${id}`, model: `model-${id}`, name: id, api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', apiKey: 'synthetic-only' });

class Transport implements SessionRuntime {
  alive = false; busy = false; pendingUI: Extract<ProjectEvent, { type: 'ui.request' }>[] = [];
  options: ProjectAgentOptions; calls: string[] = []; stopCalls = 0; closeCalls = 0;
  listeners = new Set<(event: ProjectEvent) => void>();
  active?: ReturnType<typeof deferred<SessionResult>>;
  constructor(options: ProjectAgentOptions) { this.options = options; }
  state(): ProjectSnapshot { return { sessionId: `${this.options.projectId}-native`, messages: [], tools: [], status: this.busy ? 'running' : 'idle', sdkVersion: 'synthetic', capabilities: {} }; }
  async open() { this.alive = true; return this.state(); }
  async snapshot() { return this.state(); }
  subscribe(listener: (event: ProjectEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(event: ProjectEvent) { for (const listener of this.listeners) listener(event); }
  start(text: string, id: string) {
    this.calls.push(text); this.busy = true; const active = deferred<SessionResult>(); this.active = active;
    const completion = active.promise.finally(() => { this.busy = false; if (this.active === active) this.active = undefined; });
    this.emit({ type: 'run.accepted', requestId: id });
    return { requestId: id, accepted: Promise.resolve(), completion };
  }
  startCommand(text: string, id: string) { return this.start(text, id); }
  settle() { this.active?.resolve({ outcome: 'completed', text: 'synthetic done' }); }
  async stop() { this.stopCalls++; this.active?.resolve({ outcome: 'cancelled', text: 'synthetic partial' }); }
  async close() { this.closeCalls++; this.alive = false; this.active?.resolve({ outcome: 'cancelled', text: 'synthetic partial' }); }
  async respondUI() { return {}; }
  async setEditorState() {}
}

function harness() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-session-repair-'));
  const configs = new Map(['a', 'b'].map(id => [id, configuration(id)]));
  const owners = new Map(['a', 'b'].map(id => [`deck-${id}`, { projectId: `project-${id}`, configuration: { id, revision: 1 } }]));
  for (const id of ['a', 'b']) createDeckStore(path.join(directory, `deck-${id}`)).register({ sourcePptx: fixture, reportPath: report, title: id, configuration: { id, revision: 1 } });
  let selected = 'b', unavailable = false, gate = Promise.resolve();
  const agents: Transport[] = [], events: { deckId: string; event: ProjectEvent }[] = [];
  const hostMutate = <T,>(operation: () => T | Promise<T>): Promise<T> => { const next = gate.then(operation); gate = next.then(() => {}, () => {}); return next; };
  const sessions = createPptRefinerSessions({
    codeRoot: root, deckRoot: directory, resourceRoot: path.join(directory, 'pi'), skillScriptsDir: path.join(root, 'extensions/analysis-assets/ppt-report/scripts'), managementPorts: () => [],
    resolveOwner: async deckId => { if (unavailable) throw Object.assign(new Error('unknown project'), { code: 'project_required' }); const owner = owners.get(deckId); if (!owner) throw Object.assign(new Error('unknown deck'), { code: 'deck_not_found' }); return owner; },
    configurationSnapshot: (id, revision) => { const value = configs.get(id ?? selected); return value && (revision === undefined || revision === value.revision) ? value : undefined; },
    mutate: hostMutate, isClosing: () => false, publish: (deckId, event) => { events.push({ deckId, event }); },
    createAgent: options => { const agent = new Transport(options); agents.push(agent); return agent; },
  });
  return { sessions, agents, events, configs, owners, directory, hostMutate, deck: (id = 'a') => path.join(directory, `deck-${id}`), select: (id: string) => { selected = id; }, unavailable: () => { unavailable = true; }, dispose: async () => { await sessions.closeAll(); rmSync(directory, { recursive: true, force: true }); } };
}

test('PPT-SESSION: the full preparation/run/save callback owns busy and uses the true project model', async t => {
  const h = harness(); t.after(() => h.dispose());
  const prepared = deferred<void>(), permitRun = deferred<void>(), reachedSave = deferred<void>(), permitSave = deferred<void>();
  let writes = 0;
  const pending = h.sessions.withSession(h.deck(), async lease => {
    await lease.commit(() => { writes++; }); prepared.resolve();
    await permitRun.promise;
    const result = await lease.run({ text: 'first', requestId: 'first' });
    reachedSave.resolve(); await permitSave.promise;
    await lease.commit(() => { writes++; });
    return result;
  });
  await prepared.promise;
  assert.equal(h.sessions.busy(h.deck()), true);
  await assert.rejects(h.sessions.mutate(h.deck(), () => { writes += 100; }), { code: 'session_busy' });
  await assert.rejects(h.sessions.withSession(h.deck(), async () => { writes += 100; }), { code: 'session_busy' });
  await h.sessions.mutate(h.deck('b'), () => { writes += 10; });
  assert.equal(h.agents.length, 0, 'short file changes and preparation do not open an SDK resource');
  h.select('b'); permitRun.resolve(); await until(() => h.agents[0]?.calls.length === 1);
  assert.equal(h.agents[0]!.options.projectId, 'project-a');
  assert.equal(h.agents[0]!.options.configuration.id, 'a');
  h.agents[0]!.settle(); await reachedSave.promise;
  assert.equal(h.sessions.busy(h.deck()), true, 'post-run guard/save still owns the same operation');
  await assert.rejects(h.sessions.mutate(h.deck(), () => { writes += 100; }), { code: 'session_busy' });
  permitSave.resolve(); assert.equal((await pending).outcome, 'completed');
  assert.equal(writes, 12); assert.equal(h.sessions.busy(h.deck()), false);
});

test('PPT-SESSION: state reads and stop of an unbound legacy deck neither resolve credentials nor open resources', async t => {
  const h = harness(); t.after(() => h.dispose()); h.unavailable(); h.configs.clear();
  assert.equal(h.sessions.busy(h.deck()), false); assert.equal(h.sessions.live(h.deck()), false);
  await h.sessions.stop(h.deck());
  assert.equal(h.agents.length, 0);
  await assert.rejects(h.sessions.withSession(h.deck(), async () => {}), { code: 'project_required' });
  await assert.rejects(h.sessions.mutate(h.deck(), () => {}), { code: 'project_required' });
});

test('PPT-SESSION: project close targets its true owner and ignores late events without stopping another project', async t => {
  const h = harness(); t.after(() => h.dispose());
  const a = h.sessions.run(h.deck(), { text: 'a', requestId: 'a' });
  const b = h.sessions.run(h.deck('b'), { text: 'b', requestId: 'b' });
  await until(() => h.agents.length === 2 && h.agents.every(agent => agent.calls.length === 1));
  const first = h.agents.find(agent => agent.options.projectId === 'project-a')!;
  const second = h.agents.find(agent => agent.options.projectId === 'project-b')!;
  assert.ok(first); assert.ok(second);
  await h.sessions.closeAll({ projectId: 'project-a' });
  assert.equal((await a).outcome, 'cancelled'); assert.equal(first.closeCalls, 1);
  assert.equal(second.closeCalls, 0); assert.equal(h.sessions.busy(h.deck('b')), true);
  const count = h.events.length; first.emit({ type: 'text.delta', requestId: 'a', text: 'late' }); assert.equal(h.events.length, count);
  second.settle(); assert.equal((await b).outcome, 'completed');
});

test('PPT-SESSION: stop during the business gap keeps busy until finalization and revokes further dispatch', async t => {
  const h = harness(); t.after(() => h.dispose());
  const inGap = deferred<void>(), leaveGap = deferred<void>(); let retained: PptRefinerSessionLease | undefined, commits = 0;
  const pending = h.sessions.withSession(h.deck(), async lease => {
    retained = lease;
    await lease.run({ text: 'first', requestId: 'first' }); inGap.resolve(); await leaveGap.promise;
    await lease.commit(() => { commits++; });
    await assert.rejects(lease.run({ text: 'must not dispatch', requestId: 'later' }), { code: 'generation_cancelled' });
  });
  await until(() => h.agents[0]?.calls.length === 1); h.agents[0]!.settle(); await inGap.promise;
  await h.sessions.stop(h.deck()); assert.equal(h.sessions.busy(h.deck()), true);
  leaveGap.resolve(); await pending;
  assert.equal(commits, 1, 'the cancelled current owner may preserve its actual partial result');
  assert.equal(h.agents[0]!.calls.length, 1); assert.equal(h.sessions.busy(h.deck()), false);
  assert.ok(retained); assert.equal(retained.isCurrent(), false);
  await assert.rejects(retained.commit(() => { commits++; }), { code: 'generation_cancelled' });
  assert.equal(commits, 1);
});

test('PPT-SESSION: commit rechecks real project ownership and cannot write after a project rebind', async t => {
  const h = harness(); t.after(() => h.dispose());
  const prepared = deferred<void>(), proceed = deferred<void>(); let wrote = false;
  const pending = h.sessions.withSession(h.deck(), async lease => { prepared.resolve(); await proceed.promise; await lease.commit(() => { wrote = true; }); });
  const rejected = assert.rejects(pending, { code: 'project_changed' });
  await prepared.promise; h.owners.set('deck-a', { projectId: 'project-other', configuration: { id: 'a', revision: 1 } }); proceed.resolve();
  await rejected; assert.equal(wrote, false); assert.equal(h.agents.length, 0);
});

test('PPT-SESSION: a changed project configuration cannot redirect the next turn in an existing lease', async t => {
  const h = harness(); t.after(() => h.dispose());
  const firstDone = deferred<void>(), proceed = deferred<void>();
  const pending = h.sessions.withSession(h.deck(), async lease => {
    await lease.run({ text: 'first', requestId: 'first' }); firstDone.resolve(); await proceed.promise;
    await assert.rejects(lease.run({ text: 'must not redirect', requestId: 'later' }), { code: 'configuration_changed' });
  });
  await until(() => h.agents[0]?.calls.length === 1); h.agents[0]!.settle(); await firstDone.promise;
  h.owners.set('deck-a', { projectId: 'project-a', configuration: { id: 'b', revision: 1 } }); proceed.resolve();
  await pending; assert.equal(h.agents.length, 1); assert.deepEqual(h.agents[0]!.calls, ['first']);
});

test('PPT-SESSION: provider close revokes a queued commit without waiting on the Host gate', async t => {
  const h = harness(); t.after(() => h.dispose());
  const reachedGap = deferred<void>(), startCommit = deferred<void>(), releaseGate = deferred<void>(); let wrote = false;
  const pending = h.sessions.withSession(h.deck(), async lease => {
    await lease.run({ text: 'first', requestId: 'first' }); reachedGap.resolve(); await startCommit.promise;
    await lease.commit(() => { wrote = true; });
  });
  const rejected = assert.rejects(pending, { code: 'generation_cancelled' });
  await until(() => h.agents[0]?.calls.length === 1); h.agents[0]!.settle(); await reachedGap.promise;
  const gate = h.hostMutate(() => releaseGate.promise); startCommit.resolve(); await tick();
  await h.sessions.closeAll({ provider: 'provider-a' });
  assert.equal(h.agents[0]!.closeCalls, 1); assert.equal(h.sessions.busy(h.deck()), true);
  releaseGate.resolve(); await gate; await rejected;
  assert.equal(wrote, false); assert.equal(h.sessions.busy(h.deck()), false);
});

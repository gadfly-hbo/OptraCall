import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStudioSessions } from '../src/host/studio-sessions.ts';
import type { SessionRuntime } from '../src/host/agent-sessions.ts';
import type { ProjectSnapshot, ProjectEvent, ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { inspectSessionSource } from '../scripts/check-agent-session-boundary.mjs';

const python = process.env.OPTRACALL_STUDIO_TEST_PYTHON;
const configuration = { id: 'studio-synthetic', name: 'Synthetic only', revision: 1, provider: 'synthetic', api: 'openai-completions' as const, baseUrl: 'http://127.0.0.1:1/v1', model: 'studio-synthetic', apiKey: 'synthetic-key' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function input() {
  const text = '退款归属门店。';
  return { projectId: randomUUID(), taskId: randomUUID(), systemId: randomUUID(), jobId: randomUUID(), configuration,
    source: { id: 'retail-source', revision: '2', text, sha256: createHash('sha256').update(text).digest('hex') } };
}
class SyntheticRuntime implements SessionRuntime {
  alive = true; busy = false; pendingUI = []; texts: string[] = []; closed = 0;
  state(): ProjectSnapshot { return { sessionId: 'attached-studio-native', tools: [], messages: [], status: 'idle', sdkVersion: 'synthetic', capabilities: {} }; }
  async open() { return this.state(); }
  async snapshot() { return this.state(); }
  subscribe(_listener: (event: ProjectEvent) => void) { return () => {}; }
  start(text: string, requestId: string) {
    this.texts.push(text);
    return { requestId, accepted: Promise.resolve(), completion: Promise.resolve({ outcome: 'completed' as const, text: JSON.stringify(this.texts.length === 1 ? { entities: [{ text: '退款', label: 'EVENT' }, { text: '门店', label: 'ORG' }] } : { relations: [{ subject: '退款', object: '门店', predicate: '归属' }] }) }) };
  }
  startCommand(text: string, requestId: string) { return this.start(text, requestId); }
  async stop() {}
  async close() { this.closed++; this.alive = false; }
  async respondUI() {}
  async setEditorState() {}
}
function harness(overrides: Record<string, unknown> = {}) {
  const runtime = new SyntheticRuntime(), created: ProjectAgentOptions[] = [];
  const root = path.resolve('.local/studio-phase1/semantic-sessions', randomUUID());
  const sessions = createStudioSessions({ executionRoot: root, python: python!, codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), managementPorts: () => [], configurationSnapshot: () => configuration, mutate: async <T>(operation: () => T | Promise<T>) => operation(), isClosing: () => false, admit() {}, createAgent: (options: ProjectAgentOptions) => { created.push(options); return runtime; }, ...overrides });
  return { sessions, runtime, created, root };
}

test('Studio official extraction uses the attached public text-only profile with exact source owner and captured configuration', { skip: !python }, async () => {
  const h = harness(), owner = input(); let cleanup: ((options: { retryFailed?: boolean }) => Promise<void>) | undefined;
  const result = await h.sessions.extract(owner, { signal: new AbortController().signal, assertCurrent() {}, registerCleanup(fn: typeof cleanup) { assert.equal(cleanup, undefined); cleanup = fn; } });
  assert.deepEqual(result.entities.map((entry: { text: string }) => entry.text), ['退款', '门店']);
  assert.equal(result.relations[0]?.predicate, '归属');
  assert.equal(result.source.sha256, owner.source.sha256);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0]?.projectId, owner.projectId);
  assert.equal(h.created[0]?.taskId, owner.taskId);
  assert.deepEqual(h.created[0]?.configuration, configuration);
  assert.equal(h.created[0]?.workspace?.capabilityPolicy, 'text-only');
  assert.deepEqual(h.created[0]?.workspace?.defaultTools, []);
  assert.equal(h.runtime.texts.length, 2);
  assert.ok(h.runtime.texts.every(text => text.includes('退款归属门店。')));
  assert.ok(h.runtime.texts[0]?.includes('entities'));
  assert.equal(h.runtime.closed, 1);
  assert.equal(h.sessions.busyForTask(owner.projectId, owner.taskId), false);
  await cleanup?.({});
});

test('Studio known-source graph building stays busy in the same public lifecycle and never opens a model resource', { skip: !python }, async () => {
  const h = harness(), owner = input(), entered = deferred<void>(), release = deferred<void>();
  const ref = { kind: 'studio-source' as const, systemId: owner.systemId, assetId: randomUUID(), version: '1', projectId: owner.projectId, publishedHash: 'a'.repeat(64) };
  const running = h.sessions.build({ ...owner, runRoot: h.root, snapshotId: randomUUID(), sources: [{ ref, title: '退款归属', kind: 'rule', body: '退款归属原销售门店' }], checkMany: async (refs: unknown[]) => { entered.resolve(); await release.promise; return refs.map(() => ({ state: 'available', gaps: [] })); } });
  await entered.promise;
  assert.equal(h.sessions.busy(owner), true);
  assert.equal(h.sessions.busyForTask(owner.projectId, owner.taskId), true);
  assert.equal(h.sessions.busyForTask(owner.projectId, randomUUID()), false);
  await assert.rejects(h.sessions.extract(owner), { code: 'session_busy' });
  assert.equal(h.created.length, 0);
  release.resolve();
  const result = await running;
  assert.equal(result.formatVersion, 2);
  assert.equal(h.created.length, 0, 'a graph-only lease does not dispatch a dummy model turn');
  assert.equal(h.sessions.busy(owner), false);
});

test('parent cancellation revokes a graph result and cleanup waits for the already dispatched qualification callback', { skip: !python }, async () => {
  const h = harness(), owner = input(), entered = deferred<void>(), release = deferred<void>(), controller = new AbortController();
  let cleanup: ((options: { retryFailed?: boolean }) => Promise<void>) | undefined;
  const ref = { kind: 'studio-source' as const, systemId: owner.systemId, assetId: randomUUID(), version: '1', projectId: owner.projectId, publishedHash: 'a'.repeat(64) };
  const running = h.sessions.build({ ...owner, runRoot: h.root, sources: [{ ref, title: '退款归属', kind: 'rule', body: '退款归原门店' }], checkMany: async (refs: unknown[]) => { entered.resolve(); await release.promise; return refs.map(() => ({ state: 'available', gaps: [] })); } }, { signal: controller.signal, assertCurrent() {}, registerCleanup(fn: typeof cleanup) { cleanup = fn; } });
  const observed = running.then(() => 'completed', () => 'revoked');
  await entered.promise; controller.abort();
  let closed = false; const closing = cleanup!({}).then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.equal(h.sessions.busy(owner), true);
  assert.equal(h.sessions.busyForTask(owner.projectId, randomUUID()), false);
  release.resolve();
  assert.equal(await observed, 'revoked'); await closing;
  assert.equal(h.sessions.busy(owner), false);
  assert.equal(h.created.length, 0);
});

test('a withdrawn configuration cannot finish a graph-only operation or start a Pi continuation', { skip: !python }, async () => {
  let current: typeof configuration | null = configuration;
  const h = harness({ configurationSnapshot: () => current }), owner = input();
  const ref = { kind: 'studio-source' as const, systemId: owner.systemId, assetId: randomUUID(), version: '1', projectId: owner.projectId, publishedHash: 'a'.repeat(64) };
  await assert.rejects(h.sessions.build({ ...owner, runRoot: h.root, sources: [{ ref, title: '退款归属', kind: 'rule', body: '退款归原门店' }], checkMany: async (refs: unknown[]) => { current = null; return refs.map(() => ({ state: 'available', gaps: [] })); } }), { code: 'studio_configuration_changed' });
  assert.equal(h.created.length, 0);
  assert.equal(h.sessions.busy(owner), false);
});

test('stopForTask revokes only that task graph lease and preserves another task in the same project', { skip: !python }, async () => {
  const h = harness(), first = input(), second = { ...input(), projectId: first.projectId };
  // Root setup is independent of concurrent lifecycle admission. Each builder
  // still verifies this canonical, private root before writing.
  await mkdir(path.join(h.root, 'inputs'), { recursive: true, mode: 0o700 });
  const entered = [deferred<void>(), deferred<void>()], release = [deferred<void>(), deferred<void>()];
  const run = (owner: ReturnType<typeof input>, index: number) => h.sessions.build({ ...owner, runRoot: h.root, sources: [{ ref: { kind: 'studio-source', systemId: owner.systemId, assetId: randomUUID(), version: '1', projectId: owner.projectId, publishedHash: 'a'.repeat(64) }, title: '退款归属', kind: 'rule', body: '退款归原销售门店' }], checkMany: async (refs: unknown[]) => { entered[index]!.resolve(); await release[index]!.promise; return refs.map(() => ({ state: 'available', gaps: [] })); } }).then(() => 'completed', () => 'revoked');
  const results = [run(first, 0), run(second, 1)];
  try {
    await Promise.all(entered.map(value => value.promise));
    await h.sessions.stopForTask(first.projectId, first.taskId);
    assert.equal(h.sessions.busy(second), true, 'another task remains admitted');
    release[0]!.resolve(); assert.equal(await results[0], 'revoked');
    assert.equal(h.sessions.busy(first), false);
    assert.equal(h.sessions.busy(second), true);
    release[1]!.resolve(); assert.equal(await results[1], 'completed');
    assert.equal(h.created.length, 0);
  } finally {
    release.forEach(value => value.resolve()); await Promise.all(results); await h.sessions.closeAll();
  }
});

test('the exact Studio Host registrar is permitted while plugin domain registration and SDK constructors remain refused', () => {
  const registration = "import {createAgentSessionDomain} from './agent-sessions.ts';";
  assert.deepEqual(inspectSessionSource('src/host/studio-sessions.ts', registration), []);
  assert.ok(inspectSessionSource('extensions/business-plugins/studio/entry.ts', "import {createAgentSessionDomain} from '../../../src/host/agent-sessions.ts';").length);
  assert.ok(inspectSessionSource('src/host/studio-sessions.ts', "import {ProjectAgent} from '../agent/project-runtime.ts'; new ProjectAgent({});").length);
});

test('failed attached cleanup remains busy and automatic cleanup cannot retry it; explicit close only retries cleanup', { skip: !python }, async () => {
  let closeCalls = 0, calls = 0;
  class FailedOnce extends SyntheticRuntime {
    async close() { closeCalls++; if (closeCalls === 1) throw new Error('synthetic_cleanup_unknown'); await super.close(); }
    start(text: string, requestId: string) { calls++; return super.start(text, requestId); }
  }
  const h = harness({ createAgent: () => new FailedOnce() }), owner = input();
  let cleanup: ((options: { retryFailed?: boolean }) => Promise<void>) | undefined;
  await assert.rejects(h.sessions.extract(owner, { signal: new AbortController().signal, assertCurrent() {}, registerCleanup(fn: typeof cleanup) { cleanup = fn; } }), { message: 'session_close_failed' });
  assert.equal(h.sessions.busy(owner), true);
  assert.equal(closeCalls, 1);
  await assert.rejects(cleanup!({}), { message: 'session_close_failed' });
  assert.equal(closeCalls, 1, 'automatic parent cleanup shares the recorded failure');
  assert.equal(h.sessions.busyForTask(owner.projectId, randomUUID()), false);
  await h.sessions.close(owner);
  assert.equal(closeCalls, 2);
  assert.equal(calls, 2, 'explicit close does not replay a model turn');
  assert.equal(h.sessions.busy(owner), false);
});

test('actual official Pi plus official Semantica uses the closed text resource, refuses tools and preserves original files', { skip: !python }, async t => {
  const root = path.resolve('.local/studio-phase1/semantic-sessions-sdk', randomUUID()), resourceRoot = path.join(root, 'resources'), marker = path.join(root, 'must-not-write');
  await mkdir(path.join(resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(resourceRoot, 'extensions', 'hostile.ts'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'MUST_NOT_LOAD'); export default ()=>{};`);
  const original = path.join(root, 'original.jsonl'), originalBytes = '{"type":"historical-original","untouched":true}\n'; await writeFile(original, originalBytes);
  const requests: any[] = [], pendingModel = deferred<void>();
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'studio-loopback', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (requests.length === 4) { pendingModel.resolve(); return; }
    if (requests.length === 1) { send({ tool_calls: [{ index: 0, id: 'denied-write', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: marker, content: 'MUST_NOT_WRITE' }) } }] }); send({}, 'tool_calls'); }
    else { send({ content: JSON.stringify(requests.length === 2 ? { entities: [{ text: '退款', label: 'EVENT' }, { text: '门店', label: 'ORG' }] } : { relations: [{ subject: '退款', object: '门店', predicate: '归属' }] }) }); send({}, 'stop'); }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address(); assert.ok(address && typeof address !== 'string');
  const captured = { ...configuration, baseUrl: `http://127.0.0.1:${address.port}/v1` }, owner = { ...input(), configuration: captured };
  const snapshots: ProjectSnapshot[] = [];
  const sessions = createStudioSessions({ executionRoot: path.join(root, 'operations'), python: python!, codeRoot: process.cwd(), resourceRoot, managementPorts: () => [], configurationSnapshot: () => captured, mutate: async operation => operation(), isClosing: () => false, admit() {}, publish: (_owner, event) => { if (event.type === 'snapshot') snapshots.push(event.snapshot); } });
  t.after(async () => { await sessions.closeAll(); await new Promise<void>(resolve => { provider.close(() => resolve()); provider.closeAllConnections(); }); });
  const result = await sessions.extract(owner);
  assert.equal(result.relations[0]?.predicate, '归属');
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => !request.tools?.length));
  assert.ok(requests[1].messages.some((message: any) => message.role === 'tool' && /unknown|not found|unavailable/i.test(message.content)));
  assert.ok(snapshots.length > 0 && snapshots.every(snapshot => snapshot.tools.length === 0));
  assert.equal(await readFile(original, 'utf8'), originalBytes);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(sessions.busyForTask(owner.projectId, owner.taskId), false);
  // Cancel with the real SDK awaiting a provider response. The model endpoint
  // is loopback and deliberately never sends a completion for this operation.
  const controller = new AbortController(), next = { ...owner, jobId: randomUUID() };
  let cleanup: ((options: { retryFailed?: boolean }) => Promise<void>) | undefined;
  const cancelled = sessions.extract(next, { signal: controller.signal, assertCurrent() {}, registerCleanup(fn) { cleanup = fn; } }).then(() => 'completed', () => 'cancelled');
  await pendingModel.promise; controller.abort(); await cleanup!({});
  assert.equal(await cancelled, 'cancelled');
  assert.equal(requests.length, 4, 'no continuation is dispatched from a cancelled provider turn');
  assert.equal(sessions.busy(next), false);
});

test('graph preparation already occupies the public task lease and cancellation prevents worker dispatch', async () => {
  const h = harness(), owner = input(), entered = deferred<void>(), release = deferred<void>();
  const pending = h.sessions.buildPrepared(owner, async context => { entered.resolve(); await release.promise; context.assertCurrent(); throw new Error('must_not_dispatch'); }).then(()=> 'completed',()=> 'cancelled');
  await entered.promise; assert.equal(h.sessions.busyForTask(owner.projectId,owner.taskId),true);
  await h.sessions.stopForTask(owner.projectId,owner.taskId); release.resolve();
  assert.equal(await pending,'cancelled'); assert.equal(h.sessions.busyForTask(owner.projectId,owner.taskId),false); assert.equal(h.created.length,0);
});

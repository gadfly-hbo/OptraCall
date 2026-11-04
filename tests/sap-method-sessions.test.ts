import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSapMethodSessions } from '../src/host/sap-method-sessions.ts';
import { createSapMethodSources } from '../src/host/sap-method-sources.ts';

// The public Host factory constructs the actual SDK resource through its common domain.
// This test never directly constructs ProjectAgent or imports the SDK.
test('SAM03/11 actual attached SDK reads only its bounded source tool and leaves source native untouched', async t => {
  const root = path.resolve('.local/sap-analysis-methods/implementation/runtime/sdk', randomUUID());
  const original = path.join(root, 'original'), resourceRoot = path.join(root, 'resources');
  await mkdir(original, { recursive: true }); await mkdir(resourceRoot, { recursive: true });
  const native = path.join(original, 'source.jsonl');
  const bytes = [
    { type: 'session', version: 3, id: 'synthetic-original-session', timestamp: '2026-11-04T10:00:00.000Z', cwd: original },
    { type: 'message', id: 'source-user', parentId: null, timestamp: '2026-11-04T10:00:01.000Z', message: { role: 'user', content: 'Synthetic source task.' } },
    { type: 'message', id: 'source-answer', parentId: 'source-user', timestamp: '2026-11-04T10:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'SYNTHETIC_FIXED_SESSION_EVIDENCE ' + 'x'.repeat(90_000) }] } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n';
  await writeFile(native, bytes);
  const requests: any[] = [];
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'sap-synthetic', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (requests.length === 1) { send({ tool_calls: [{ index: 0, id: 'source-call', type: 'function', function: { name: 'read_sap_method_source', arguments: JSON.stringify({ action: 'read-session', start: 0, length: 1024 }) } }] }); send({}, 'tool_calls'); }
    else { send({ content: JSON.stringify({ kind: 'method', title: '复购可比性', content: { conditions: '', logic: '比较前核对观察窗口是否一致。', judgment: '', limits: '合成案例尚未验证专业收益。' } }) }); send({}, 'stop'); }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address(); assert.ok(address && typeof address !== 'string');
  const configuration = { id: 'sap-synthetic', name: 'Synthetic only', revision: 1, provider: 'synthetic', api: 'openai-completions' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'sap-synthetic', apiKey: 'synthetic-key' };
  const input = { projectId: randomUUID(), taskId: randomUUID(), extractionId: randomUUID(), configuration };
  let reads = 0; const snapshots: any[] = [];
  const sessions = createSapMethodSessions({ extractionRoot: path.join(root, 'extractions'), codeRoot: process.cwd(), resourceRoot, managementPorts: () => [], configurationSnapshot: () => configuration, mutate: async operation => operation(), isClosing: () => false, admit() {}, prepareSources: async () => {
    const sources = await createSapMethodSources({ ...input, sessionFile: native, sessionDirectory: original, cwd: original });
    return { ...sources, read: async (...args) => { reads++; return sources.read(...args); } };
  }, publish: (_owner, event) => { if (event.type === 'snapshot') snapshots.push(event.snapshot); } });
  t.after(async () => { await sessions.closeAll(); await new Promise<void>(resolve => { provider.close(() => resolve()); provider.closeAllConnections(); }); });
  const result = await sessions.execute(input, async (outcome, context) => { context.assertCurrent(); assert.equal(outcome.kind, 'method'); return { saved: true, published: false }; });
  assert.equal(reads, 1);
  assert.equal(result.outcome, 'completed'); assert.deepEqual(result.result, { saved: true, published: false });
  assert.equal(requests.length, 2);
  assert.ok(JSON.stringify(requests[1].messages).includes('SYNTHETIC_FIXED_SESSION_EVIDENCE'));
  assert.ok(!JSON.stringify(requests[0].messages).includes('SYNTHETIC_FIXED_SESSION_EVIDENCE'), 'full source is not injected into the initial prompt');
  assert.ok(snapshots.some(snapshot => snapshot.tools.includes('read_sap_method_source')));
  assert.ok(snapshots.every(snapshot => snapshot.tools.every((name: string) => name === 'read_sap_method_source')));
  assert.equal(await readFile(native, 'utf8'), bytes);
  assert.ok(result.sessionFile && path.dirname(result.sessionFile).startsWith(path.join(root, 'extractions')));
});

import type { SessionRuntime } from '../src/host/agent-sessions.ts';
import type { ProjectEvent, ProjectSnapshot } from '../src/agent/project-runtime.ts';
import type { SapMethodSources } from '../src/host/sap-method-sources.ts';

const syntheticConfiguration = { id: 'same-config', name: 'Synthetic', revision: 1, provider: 'synthetic', api: 'openai-completions' as const, baseUrl: 'http://127.0.0.1:1', model: 'synthetic', apiKey: 'synthetic-only' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function inertSources(): SapMethodSources {
  return { sourceRef: { type: 'session', label: 'Synthetic fixed source', ref: 'sap-session:synthetic', version: 'last', sha256: 'a'.repeat(64) }, sessionIdentity: { projectId: 'synthetic', taskId: 'synthetic', sessionId: 'original', cutoffEntryId: 'last', nativeSha256: 'b'.repeat(64), bytes: 42, projectionSha256: 'a'.repeat(64), incomplete: false }, sessionText: 'Synthetic fixed source', promptContext: 'Synthetic sources', read: async () => ({ content: [{ type: 'text', text: 'source' }], details: {} }), references: () => [], assertUnchanged: async () => {} };
}
class ImmediateTransport implements SessionRuntime {
  alive = true; busy = false; pendingUI = []; closeCalls = 0;
  state(): ProjectSnapshot { return { sessionId: 'attached-native', tools: [], messages: [], status: 'idle', sdkVersion: 'synthetic', capabilities: {} }; }
  async open() { return this.state(); }
  async snapshot() { return this.state(); }
  subscribe(_listener: (event: ProjectEvent) => void) { return () => {}; }
  start(_text: string, id: string) { return { requestId: id, accepted: Promise.resolve(), completion: Promise.resolve({ outcome: 'completed' as const, text: JSON.stringify({ kind: 'none', reason: 'No new transferable content.' }) }) }; }
  startCommand(text: string, id: string) { return this.start(text, id); }
  async stop() {}
  async close() { this.closeCalls++; this.alive = false; }
  async respondUI() {}
  async setEditorState() {}
}

test('SAM10 task busy projection includes failed retirement and permits unrelated tasks', async () => {
  const input = { projectId: randomUUID(), taskId: randomUUID(), extractionId: randomUUID(), configuration: syntheticConfiguration };
  class FailedCloseTransport extends ImmediateTransport { async close() { throw new Error('synthetic_cleanup_unknown'); } }
  const sessions = createSapMethodSessions({ extractionRoot: path.resolve('.local/sap-analysis-methods/implementation/runtime/failed-close'), codeRoot: process.cwd(), resourceRoot: path.resolve('.local/sap-analysis-methods/implementation/runtime/resources'), managementPorts: () => [], configurationSnapshot: () => syntheticConfiguration, mutate: async operation => operation(), isClosing: () => false, admit() {}, prepareSources: async () => inertSources(), createAgent: () => new FailedCloseTransport() });
  await assert.rejects(sessions.execute(input, async () => 'empty'), { message: 'session_close_failed' });
  assert.equal(sessions.busy(input), true);
  assert.equal(sessions.busyForTask(input.projectId, input.taskId), true);
  assert.equal(sessions.busyForTask(input.projectId, randomUUID()), false);
});

test('SAM10 duplicate request cannot cancel the already admitted extraction while sources are preparing', async () => {
  const preparing = deferred<void>(), release = deferred<void>(); let saved = 0;
  const input = { projectId: randomUUID(), taskId: randomUUID(), extractionId: randomUUID(), configuration: syntheticConfiguration };
  const sessions = createSapMethodSessions({ extractionRoot: path.resolve('.local/sap-analysis-methods/implementation/runtime/duplicate'), codeRoot: process.cwd(), resourceRoot: path.resolve('.local/sap-analysis-methods/implementation/runtime/resources'), managementPorts: () => [], configurationSnapshot: () => syntheticConfiguration, mutate: async operation => operation(), isClosing: () => false, admit() {}, prepareSources: async () => { preparing.resolve(); await release.promise; return inertSources(); }, createAgent: () => new ImmediateTransport() });
  const first = sessions.execute(input, async () => { saved++; return 'saved'; });
  await preparing.promise;
  assert.equal(sessions.busyInScope({ projectId: input.projectId }), true);
  assert.equal(sessions.busy(input), true, 'the admitted owner is busy during source preparation');
  assert.equal(sessions.busy({ ...input, taskId: randomUUID(), extractionId: randomUUID() }), false, 'another task in the same project is not blocked by this owner query');
  const duplicate = sessions.execute(input, async () => { throw new Error('duplicate may not persist'); });
  await assert.rejects(duplicate, { code: 'session_busy' });
  release.resolve();
  const completed = await first;
  assert.equal(completed.outcome, 'completed'); assert.equal(saved, 1);
  assert.equal(sessions.busy(input), false);
  assert.equal(sessions.busyInScope({ projectId: input.projectId }), false);
});

async function actualHarness(t: import('node:test').TestContext, plan: (index: number) => { tool?: string; input?: unknown; text?: string }, read?: SapMethodSources['read']) {
  const root = path.resolve('.local/sap-analysis-methods/implementation/runtime/actual', randomUUID()), original = path.join(root, 'source');
  await mkdir(original, { recursive: true });
  const native = path.join(original, 'source.jsonl');
  await writeFile(native, [
    { type: 'session', version: 3, id: 'source-original', timestamp: '2026-11-04T10:00:00.000Z', cwd: original },
    { type: 'message', id: 'source-u1', parentId: null, timestamp: '2026-11-04T10:00:01.000Z', message: { role: 'user', content: 'Synthetic fixed source, no business data.' } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const requests: any[] = [];
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()), next = plan(requests.length); requests.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'sap-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (next.tool) { send({ tool_calls: [{ index: 0, id: `source-call-${requests.length}`, type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.input ?? {}) } }] }); send({}, 'tool_calls'); }
    else { send({ content: next.text ?? JSON.stringify({ kind: 'none', reason: 'No new method.' }) }); send({}, 'stop'); }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address(); assert.ok(address && typeof address !== 'string');
  const configuration = { ...syntheticConfiguration, baseUrl: `http://127.0.0.1:${address.port}/v1` }, input = { projectId: randomUUID(), taskId: randomUUID(), extractionId: randomUUID(), configuration };
  const sessions = createSapMethodSessions({ extractionRoot: path.join(root, 'extractions'), codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), managementPorts: () => [], configurationSnapshot: () => configuration, mutate: async operation => operation(), isClosing: () => false, admit() {}, prepareSources: async () => {
    const sources = await createSapMethodSources({ ...input, sessionFile: native, sessionDirectory: original, cwd: original });
    return read ? { ...sources, read } : sources;
  } });
  t.after(async () => { await sessions.closeAll(); await new Promise<void>(resolve => { provider.close(() => resolve()); provider.closeAllConnections(); }); });
  return { root, native, sessions, input, requests };
}

test('SAM11 source-reader cannot execute an unadvertised write or load user extensions', async t => {
  let marker = '';
  const h = await actualHarness(t, index => index === 0 ? { tool: 'write', input: { path: marker, content: 'MUST_NOT_BE_WRITTEN' } } : {});
  marker = path.join(h.root, 'forbidden-output.txt');
  const extensions = path.join(h.root, 'resources/extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'hostile.ts'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'MUST_NOT_LOAD');export default ()=>{};`);
  const result = await h.sessions.execute(h.input, async outcome => outcome.kind);
  assert.equal(result.outcome, 'completed'); assert.equal(result.result, 'none');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.deepEqual(h.requests[0].tools.map((tool: any) => tool.function.name), ['read_sap_method_source']);
  assert.ok(h.requests[1].messages.some((message: any) => message.role === 'tool' && /not found|unknown|unavailable/i.test(message.content)));
});

test('SAM10 actual source IPC is aborted on stop and late read cannot produce a saved result', async t => {
  const entered = deferred<void>(), release = deferred<Awaited<ReturnType<SapMethodSources['read']>>>(); let signal: AbortSignal | undefined, saved = 0;
  const h = await actualHarness(t, index => index === 0 ? { tool: 'read_sap_method_source', input: { action: 'read-session', start: 0, length: 1024 } } : {}, async (_action, _input, context) => { signal = context.signal; entered.resolve(); return release.promise; });
  const running = h.sessions.execute(h.input, async () => { saved++; return 'saved'; });
  const observed = running.then(value => ({ value }), error => ({ error }));
  await entered.promise; await h.sessions.stop(h.input);
  assert.equal(signal?.aborted, true);
  release.resolve({ content: [{ type: 'text', text: 'LATE_SOURCE_TEXT_MUST_NOT_BE_SAVED' }], details: {} });
  const settled = await observed;
  assert.equal(saved, 0);
  assert.ok('error' in settled || settled.value.outcome === 'cancelled');
  assert.equal(h.requests.length, 1, 'stop must not dispatch a Provider continuation from the late source read');
  assert.equal(h.sessions.busyInScope({ projectId: h.input.projectId }), false);
});

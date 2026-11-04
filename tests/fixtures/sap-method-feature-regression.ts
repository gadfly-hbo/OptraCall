// Controlled transport and I/O fault probes over the actual public feature/domain/store.
// Run in a dedicated subprocess so module mocks never affect other Host tests.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSapMethodSessions as realSessions } from '../../src/host/sap-method-sessions.ts';
import { createSapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import * as io from '../../src/host/project-data-context-io.ts';
const mode = process.argv[2];
assert.ok(['late-save', 'memory-governance', 'failed-close'].includes(mode));
const root = path.resolve('.local/sap-analysis-methods/implementation/regression', mode, randomUUID());
await mkdir(root, { recursive: true });
const source = path.join(root, 'original.jsonl');
await writeFile(source, [
  { type: 'session', version: 3, id: 'synthetic-native', timestamp: '2026-11-04T10:00:00.000Z', cwd: root },
  { type: 'message', id: 'entry-1', parentId: null, timestamp: '2026-11-04T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Synthetic source only.' }] } },
].map(value => JSON.stringify(value)).join('\n') + '\n');
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const entered = deferred(), release = deferred(), stopped = deferred();
let reads = 0, starts = 0, failClose = mode === 'failed-close', memoryState = 'original';
const target = { type: 'agent-candidate', candidate: { projectId: randomUUID(), taskId: randomUUID(), originSessionId: 'original-memory-session', entryId: 'candidate-entry', toolCallId: 'candidate-call', expectedDetailsSha256: 'd'.repeat(64) } };
if (mode === 'late-save') mock.module(pathToFileURL(path.resolve('src/host/project-data-context-io.ts')).href, { namedExports: { ...io, readBytes: async (file: string, max?: number) => {
  const bytes = await io.readBytes(file, max);
  if (file.endsWith('/record.json') && ++reads === 2) { entered.resolve(); await release.promise; }
  return bytes;
} } });
class Transport {
  alive = true; busy = false; pendingUI = [];
  options: any;
  constructor(options: any) { this.options = options; }
  state() { return { sessionId: 'attached', tools: [], messages: [], status: 'idle' as const, sdkVersion: 'synthetic', capabilities: {} }; }
  async open() { return this.state(); } async snapshot() { return this.state(); } subscribe() { return () => {}; }
  start(_text: string, requestId: string) { starts++; return { requestId, accepted: Promise.resolve(), completion: (async () => {
    if (mode === 'failed-close') return { outcome: 'completed' as const, text: JSON.stringify({ kind: 'none', reason: 'No transferable content.' }) };
    const sources = mode === 'memory-governance' ? (await this.options.sapMethodSources('read-memory', { input: { target, part: 'source', sourceIndex: 0 } }, { signal: new AbortController().signal, requestId, sessionId: 'attached', toolCallId: 'source-call', assertCurrent() {} })).details.sources : [];
    return { outcome: 'completed' as const, text: JSON.stringify({ kind: 'method', title: 'Synthetic portable method', content: { logic: 'Preserve exact source and cancellation.' }, sources }) };
  })() }; }
  startCommand(text: string, id: string) { return this.start(text, id); }
  async stop() { stopped.resolve(); } async close() { if (failClose) throw new Error('synthetic_cleanup_unknown'); this.alive = false; }
  async respondUI() {} async setEditorState() {}
}
mock.module(pathToFileURL(path.resolve('src/host/sap-method-sessions.ts')).href, { namedExports: { createSapMethodSessions: (options: any) => realSessions({ ...options, createAgent: agentOptions => new Transport(agentOptions) }) } });
const { createSapMethodFeature } = await import('../../src/host/sap-method-feature.ts');
const projectId = randomUUID(), taskId = randomUUID(), requestId = randomUUID();
const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic only', provider: 'synthetic', api: 'openai-completions' as const, baseUrl: 'http://127.0.0.1:9', model: 'synthetic', apiKey: 'synthetic-only' };
const project = { id: projectId, rootPath: root, archivedAt: null }, task = { id: taskId, sessionFile: source, sessionDirectory: root, configuration, lastRun: { status: 'completed' } };
let gate = Promise.resolve();
const mutate = <T>(use: () => T | Promise<T>) => { const result = gate.then(use); gate = result.then(() => {}, () => {}); return result; };
const store = createSapMethodStore(path.join(root, 'metric-assets'));
const feature = createSapMethodFeature({ dataRoot: root, codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), store,
  managementPorts: () => [], configurationSnapshot: () => configuration, pair: async () => ({ project, task }), sourceBusy: () => false, mutate, isClosing: () => false,
  personal: async (_action: unknown, input: any) => {
    reads++;
    if (memoryState === 'excluded') throw Object.assign(new Error('personal_context_excluded'), { code: 'personal_context_excluded' });
    return { text: input.part === 'corrections' ? 'CURRENT_CORRECTION_NOTE' : memoryState === 'original' ? 'FIXED_MEMORY_BODY' : 'CURRENT_BODY_MUST_NOT_REPLACE_FIXED', details: { partial: false, items: [{ target, extent: memoryState === 'metadata' ? 'metadata' : 'full', title: 'Synthetic candidate', caution: null, limitations: memoryState === 'metadata' ? ['source excluded'] : [], governance: { targetRevision: memoryState === 'original' ? 1 : 2, latestCorrectionOperationId: memoryState === 'corrected' ? 'correction-1' : null } }] } };
  }, methods: async () => { throw new Error('unused'); }, readBody: async (request: any) => request.input,
} as any);
const base = `http://localhost/api/projects/${projectId}/tasks/${taskId}/sap-method-extractions`;
const handle = (suffix = '', method = 'GET', input: unknown = {}) => feature.handle({ method, input } as any, new URL(base + suffix));
assert.equal((await handle('', 'POST', { requestId, incomplete: false }))?.status, 202);
if (mode === 'late-save') {
  await entered.promise;
  const stopping = handle('/' + requestId + '/stop', 'POST');
  const immediate = await Promise.race([stopped.promise.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 200))]);
  release.resolve();
  const result = await stopping; await feature.flushReceipts();
  assert.equal(immediate, true, 'stop must revoke the public owner without waiting for the final record read');
  assert.equal((result!.value as any).extraction.status, 'cancelled');
  assert.equal(store.list().length, 0, 'a cancelled final read cannot save a method');
} else if (mode === 'memory-governance') {
  await feature.flushReceipts(); const method = store.list()[0]!;
  const original = await feature.readSource(method.id, 1, 1); assert.equal(original.text, 'FIXED_MEMORY_BODY');
  memoryState = 'corrected'; const corrected = await feature.readSource(method.id, 1, 1);
  assert.equal(corrected.text, original.text); assert.match(corrected.governance!, /CURRENT_CORRECTION_NOTE/);
  memoryState = 'metadata'; const metadata = await feature.readSource(method.id, 1, 1);
  assert.equal(metadata.text, ''); assert.equal(metadata.complete, false); assert.match(metadata.limitation!, /元信息|排除/);
  memoryState = 'excluded'; const excluded = await feature.readSource(method.id, 1, 1);
  assert.equal(excluded.text, ''); assert.equal(excluded.complete, false); assert.ok(reads >= 5);
} else {
  await feature.flushReceipts(); assert.equal(((await handle('/' + requestId))!.value as any).extraction.status, 'unknown');
  assert.equal((await handle('', 'POST', { requestId: randomUUID(), incomplete: false }))?.status, 409); assert.equal(starts, 1);
  const other = base.replace(taskId, randomUUID());
  assert.equal((await feature.handle({ method: 'POST', input: { requestId: randomUUID(), incomplete: false } } as any, new URL(other)))?.status, 202);
  await feature.flushReceipts(); assert.equal(starts, 2);
  failClose = false; await feature.closeAll(); assert.equal(feature.busyInScope({ projectId }), false);
}
console.log(JSON.stringify({ result: 'PASS', mode, starts, reads }));

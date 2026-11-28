import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feedback-observation-'));
  const store = createDecisionBoardStore({ root }); await store.init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const item = store.addManualItem({ projectId: randomUUID(), title: '原行动', rationale: '合成观察' });
  store.decideItem(item.id, { status: 'adopted' });
  const task = store.addTask(item.id, { title: '只补录观察，行动尚未完成' });
  return { store, task, file: path.join(root, 'decision-board.sqlite3') };
}
const oldInput = () => ({ operationId: randomUUID(), expectedLatestRevisionId: null, adopted: false, outcome: '原执行陈述', metricDelta: '', review: '原判断待核', score: null, effect: 'unknown' as const });
const observation = (base: string | null) => ({ ...oldInput(), expectedLatestRevisionId: base, adopted: null, outcome: '两家样本门店仍未收到回访；原因待核', review: '', observationDate: '2026-11-20', sourceScope: '两家样本门店访谈，未覆盖其他门店' });
function snapshot(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return { version: db.prepare('PRAGMA user_version').get()!.user_version, schema: db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(), rows: db.prepare('SELECT * FROM feedback_revisions ORDER BY revision_number').all() }; }
  finally { db.close(); }
}

test('D14: raw observation uses original feedback revisions; lazy v7 keeps old payload hashes and records exact', async t => {
  const { store, task, file } = await fixture(t), input = oldInput();
  const first = store.saveFeedback(task.id, input);
  assert.equal(snapshot(file).version, 4, 'old saves alone do not migrate');
  const hash = createHash('sha256').update(JSON.stringify({ taskId: task.id, ...input })).digest('hex');
  assert.equal(first.requestSha256, hash);
  const request = { requestId: randomUUID(), revision: 2, authorizationId: randomUUID() };
  const secondInput = { ...oldInput(), expectedLatestRevisionId: first.revisionId, respondsToRequest: request };
  const second = store.saveFeedback(task.id, secondInput), before = snapshot(file);
  assert.equal(before.version, 6);
  const raw = { ...observation(second.revisionId), respondsToRequest: request };
  const saved = store.saveFeedback(task.id, raw);
  assert.equal(saved.adopted, null); assert.equal(saved.observationDate, raw.observationDate); assert.equal(saved.sourceScope, raw.sourceScope);
  assert.equal(saved.effect, 'unknown'); assert.equal(saved.score, null); assert.deepEqual(saved.respondsToRequest, request);
  assert.equal(store.getTask(task.id).status, 'todo'); assert.equal(snapshot(file).version, 7);
  assert.deepEqual(snapshot(file).rows.slice(0, 2).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !['observation_date', 'source_scope'].includes(key)))), before.rows.map(row => ({ ...row })));
  assert.deepEqual(store.saveFeedback(task.id, input), first, 'old retry keeps its original fingerprint despite migration');
  assert.deepEqual(store.saveFeedback(task.id, { ...input, observationDate: null, sourceScope: null }), first, 'unknown optional metadata does not change a legacy normalized intent');
  assert.deepEqual(store.saveFeedback(task.id, secondInput), second);
  assert.deepEqual(store.saveFeedback(task.id, raw), saved);
  assert.throws(() => store.saveFeedback(task.id, { ...raw, sourceScope: '改动来源' }), { code: 'feedback_operation_conflict' });
  assert.throws(() => store.saveFeedback(task.id, { ...raw, operationId: randomUUID() }), { code: 'feedback_revision_conflict' });
  store.close(); await store.init();
  assert.deepEqual(store.listFeedbackHistory(task.id), [first, second, saved]);
  assert.deepEqual(store.getFeedbackOperation(raw.operationId), saved);
});

test('D14: rejected write rolls lazy schema migration back together with all original feedback', async t => {
  const { store, task, file } = await fixture(t), input = oldInput();
  const first = store.saveFeedback(task.id, input), before = snapshot(file), raw = observation(first.revisionId);
  let checks = 0;
  assert.throws(() => store.saveFeedback(task.id, raw, { assertWritable() { if (++checks === 2) throw new Error('synthetic authority revoked before commit'); } }), /synthetic authority revoked/);
  assert.deepEqual(snapshot(file), before);
  assert.equal(store.getFeedbackOperation(raw.operationId), null); assert.equal(store.getTask(task.id).status, 'todo');
  assert.equal(store.saveFeedback(task.id, raw).adopted, null);
});

test('D14: unknown execution requires a dated observation; invalid dates and malformed metadata never migrate or save', async t => {
  const { store, task, file } = await fixture(t), before = snapshot(file), raw = observation(null);
  for (const patch of [{ observationDate: '2026-02-30' }, { observationDate: '2025-02-29' }, { observationDate: '2026-1-01' }, { observationDate: null }, { observationDate: undefined }, { outcome: '  ' }, { sourceScope: 'x'.repeat(301) }, { sourceScope: 42 }, { adopted: undefined }]) {
    assert.throws(() => store.saveFeedback(task.id, { ...raw, ...patch } as any), { code: 'invalid_feedback' });
    assert.deepEqual(snapshot(file), before);
  }
  const saved = store.saveFeedback(task.id, { ...raw, observationDate: '2024-02-29', sourceScope: '' });
  assert.equal(saved.sourceScope, ''); assert.equal(saved.observationDate, '2024-02-29');
});

test('D14: HTTP observation save/read/retry retains unknown execution, accurate request reference and CAS', async t => {
  const provider = await startSyntheticProvider(), host = await startTestHost(); t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '观察保存合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-observation-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '原始观察合成项目' }), 201);
  const { item } = await readJson(await host.request('/api/decision-board/items', 'POST', { projectId: project.id, title: '原行动', rationale: '合成反馈验证' }), 201);
  await readJson(await host.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task } = await readJson(await host.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '尚未完成的原行动' }), 201);
  const route = `/api/decision-board/tasks/${task.id}/feedback`, raw = observation(null);
  for (const patch of [{ adopted: 'unknown' }, { observationDate: '2026-02-30' }, { observationDate: null }, { sourceScope: 7 }]) await readJson(await host.request(route, 'POST', { ...raw, ...patch }), 400);
  const { feedback } = await readJson(await host.request(route, 'POST', raw));
  assert.equal(feedback.adopted, null); assert.equal(feedback.observationDate, raw.observationDate); assert.equal(feedback.sourceScope, raw.sourceScope);
  assert.notEqual(feedback.savedAt.slice(0, 10), feedback.observationDate);
  assert.deepEqual((await readJson(await host.request(route, 'POST', raw))).feedback, feedback);
  assert.deepEqual((await readJson(await host.request(`/api/decision-board/feedback/operations/${raw.operationId}`))).feedback, feedback);
  await readJson(await host.request(route, 'POST', { ...raw, operationId: randomUUID() }), 409);
  const board = await readJson(await host.request('/api/decision-board'));
  assert.equal(board.items.find((row: any) => row.id === item.id).tasks.find((row: any) => row.id === task.id).status, 'todo');
  assert.equal(provider.requests.length, 0, 'recording an observation never calls the provider');
});

test('D14: original action authority display does not describe unknown execution as non-execution', async () => {
  const bundle = await build({ entryPoints: ['extensions/business-plugins/decision-board/ui/ActionAuthorityHistory.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Authority', plugins: [{ name: 'render-hooks', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'render-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'render-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;' : 'export const useState=v=>[v,()=>{}];export const useRef=v=>({current:v});export const useEffect=()=>{};' }));
  } }] });
  const sandbox: any = {}; runInNewContext(bundle.outputFiles[0].text, sandbox);
  const text = (value: any): string => value == null || value === false ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);
  const actual = text(sandbox.Authority.ActionAuthorityHistory({ task: { id: 'task', feedback: { adopted: null, outcome: '仅原始观察' } }, initialHistory: [] }));
  assert.match(actual, /执行情况未知/); assert.match(actual, /仅原始观察/); assert.doesNotMatch(actual, /已回录未按原建议执行/);
});

test('D14: exact feedback source displays its original observation date and source scope without inferring execution', async () => {
  const bundle = await build({ entryPoints: ['src/host/ui/CaseDecisionsPanel.tsx'], bundle: true, write: false, loader: { '.css': 'empty' }, platform: 'browser', format: 'iife', globalName: 'Source', plugins: [{ name: 'render-hooks', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'render-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'render-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' : 'export const useState=v=>[v,()=>{}];export const useRef=v=>({current:v});export const useEffect=()=>{};export const useId=()=>"id";export const useCallback=f=>f;' }));
  } }] });
  const sandbox: any = {}; runInNewContext(bundle.outputFiles[0].text, sandbox);
  const text = (value: any): string => value == null || value === false ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);
  const actual = text(sandbox.Source.SourceBody({ value: { target: { type: 'feedback' }, text: JSON.stringify({ feedback: { ...observation(null), savedAt: '2026-11-28T00:00:00Z' } }) } }));
  assert.match(actual, /观察日期2026-11-20/); assert.match(actual, /来源与范围两家样本门店访谈，未覆盖其他门店/);
  assert.match(actual, /回录时间2026-11-28T00:00:00Z/);
  assert.doesNotMatch(actual, /记录为未按建议执行/);
});

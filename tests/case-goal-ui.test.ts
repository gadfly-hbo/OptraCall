import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../', import.meta.url);
const server = createServer({ root: root.pathname, configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
after(async () => { await (await server).close(); });
const modules = server.then(async value => {
  // Load the actual component graph once before asking for its shared modules.
  const editors = await value.ssrLoadModule('/src/host/ui/CaseDialogs.tsx');
  const picker = await value.ssrLoadModule('/src/host/ui/CaseGoalPicker.tsx');
  const panel = await value.ssrLoadModule('/src/host/ui/CaseGoalsPanel.tsx');
  const client = await value.ssrLoadModule('/src/host/ui/case-client.ts');
  return { editors, picker, panel, client };
});
const editors = modules.then(value => value.editors);

test('A03: creating a Case requires an explicit primary goal inside the original Case form', async () => {
  const { CaseEditor } = await editors;
  const html = renderToStaticMarkup(createElement(CaseEditor, { onSave: async () => {}, onClose() {} }));
  assert.match(html, /新建 Case/);
  assert.match(html, /主目标/);
  assert.match(html, /相关目标/);
  assert.match(html, /尚未选择主目标|请选择.*主目标/);
});

const picker = modules.then(value => value.picker);
const panel = modules.then(value => value.panel);
const client = modules.then(value => value.client);
const goalId = '00000000-0000-4000-8000-000000000001';
const version = (number: number, title: string, status: string = 'adopted') => ({ goalId, version: number, title, status, outcome: '核清适用窗口与有据改善方向', perspective: 'profit', scope: { kind: 'enterprise', id: 'enterprise-one', name: '测试企业' }, measurement: { kind: 'deliverable', criterion: '可核的阶段结论及限制' }, baseline: { state: 'pending', description: '历史待补' }, responsible: '运营', createdAt: '2026-11-16T00:00:00Z' });
const record = { id: 'case-one', title: '原Case', description: '', judgement: '', nextStep: '', status: 'analyzing', closeReason: null, closedAt: null, revision: 3, createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z' };

test('A03: goal picker exposes only adopted exact versions and never selects an unrelated default goal', async () => {
  const { CaseGoalPicker } = await picker;
  const index = { goals: [{ id: goalId, currentVersion: 2, adoptedVersion: 1, versions: [version(1, '已采纳的原目标'), version(2, '尚未采纳候选', 'candidate')] }], relations: [], feedback: [] };
  const html = renderToStaticMarkup(createElement(CaseGoalPicker, { value: null, initialIndex: index, onChange() {} }));
  assert.match(html, /已采纳的原目标/);
  assert.doesNotMatch(html, /尚未采纳候选/);
  assert.match(html, /<option value="" selected="">请选择已采纳的主目标/);
  assert.match(html, /无适用目标，准备候选/);
});

test('A04: Case detail keeps the referenced old goal version when the goal has a newer adopted version', async () => {
  const { CaseGoalsPanel } = await panel;
  const index = { goals: [{ id: goalId, currentVersion: 2, adoptedVersion: 2, versions: [version(1, '当时的主目标'), version(2, '后来修订的新目标')] }], relations: [], feedback: [] };
  const html = renderToStaticMarkup(createElement(CaseGoalsPanel, { record, binding: { caseId: record.id, caseRevision: 2, primary: { goalId, version: 1 }, related: [], confirmedAt: '2026-11-15T00:00:00Z', operationId: 'operation-one' }, initialIndex: index, onChanged: async () => {} }));
  assert.match(html, /当时的主目标.*v1/);
  assert.doesNotMatch(html, /后来修订的新目标/);
  assert.match(html, /调整目标关联/);
});

test('A03: legacy closed Case remains readable without invented goals or target-edit controls', async () => {
  const { CaseGoalsPanel } = await panel;
  const html = renderToStaticMarkup(createElement(CaseGoalsPanel, { record: { ...record, status: 'closed' }, binding: null, initialIndex: { goals: [], relations: [], feedback: [] }, onChanged: async () => {} }));
  assert.match(html, /待补关联/);
  assert.match(html, /目标关联只读/);
  assert.doesNotMatch(html, /<button[^>]*>补充目标关联|<button[^>]*>调整目标关联/);
});

test('editing original Case text does not require changing its goal binding', async () => {
  const { CaseEditor } = await editors;
  const html = renderToStaticMarkup(createElement(CaseEditor, { value: record, onSave: async () => {}, onClose() {} }));
  assert.match(html, /当前判断与未知/);
  assert.doesNotMatch(html, /请选择已采纳的主目标|无适用目标，准备候选/);
  assert.match(html, /<button type="submit" class="primary-button">保存修改/);
});

test('A03: Case goal client carries exact refs, same-origin headers and the original operation id', async t => {
  const requests: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { requests.push({ url, init }); return Response.json({ goalBinding: null, history: [] }); });
  const api = await client;
  const goalBinding = { primary: { goalId, version: 1 }, related: [] };
  await api.create({ operationId: 'same-create', title: '目标下的新Case', goalBinding });
  await api.setCaseGoals('case-one', { operationId: 'same-binding', expectedRevision: 3, goalBinding });
  await api.goalOperation('original-goal-operation');
  assert.equal(requests[0]!.url, '/api/cases');
  assert.deepEqual(JSON.parse(requests[0]!.init.body as string).goalBinding, goalBinding);
  assert.deepEqual(JSON.parse(requests[1]!.init.body as string), { operationId: 'same-binding', expectedRevision: 3, goalBinding });
  assert.equal(requests[2]!.url, '/api/strategy/operations/original-goal-operation');
  assert.equal(requests[2]!.init.method, 'GET');
  for (const request of requests) { assert.equal(request.init.mode, 'same-origin'); assert.equal((request.init.headers as Record<string, string>)['x-optracall-client'], '1'); }
});

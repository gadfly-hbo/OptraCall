import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './fixtures/register-ui.ts';
import { createDecisionBoardRoutes } from '../extensions/business-plugins/decision-board/api/routes.ts';
import { boardRecordVersion, createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';

async function fixture(t: import('node:test').TestContext) {
  const base = path.resolve('.local/overall-architecture-upgrade/development/quoted-decisions'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'board-source-')), store = createDecisionBoardStore({ root }); await store.init(); t.after(() => store.close());
  const projectId = randomUUID(), item = store.addManualItem({ projectId, title: '门店甲行动', rationale: '合成原建议' }); store.decideItem(item.id, { status: 'adopted' }); const task = store.addTask(item.id, { title: '本周小范围发券' });
  const text = '只授权门店甲本周小范围发券。', caseId = randomUUID(), caseStoreId = randomUUID();
  const authorization = store.recordActionAuthorization({ operationId: randomUUID(), projectId, itemId: item.id, taskId: task.id, itemVersion: boardRecordVersion(store.getItem(item.id)), taskVersion: boardRecordVersion(task), expectedPreviousAuthorizationId: null,
    decision: 'authorize', scope: '门店甲本周小范围发券', source: { caseId, caseStoreId, choiceId: randomUUID(), strategyRef: { type: 'case-decision', caseId, caseStoreId, recordId: randomUUID(), revision: 2 } },
    quoteProvenance: { schemaVersion: 1, projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 'source-native', toolCallId: 'quote-tool', originalUserTextSha256: createHash('sha256').update(text).digest('hex'), quote: { start: 0, end: text.length, text } } });
  const routes = createDecisionBoardRoutes({ store, readBody: async () => ({}), mutate: async operation => operation(), projectOverview: async () => [{ id: projectId, name: 'Synthetic', archivedAt: null }], projectFiles: async () => [], assertActiveProject: async () => {}, startExtraction: async () => { throw new Error('not used'); }, stopExtraction: async () => { throw new Error('not used'); } });
  return { root, store, routes: routes.routes, projectId, item, task, authorization };
}

test('A16 original Board HTTP returns exact read-only authorization history, original operation and current summary', async t => {
  const f = await fixture(t), request = { method: 'GET' } as import('node:http').IncomingMessage;
  const history = await f.routes(request, new URL(`http://localhost/api/decision-board/action-authorizations/history?taskId=${f.task.id}`));
  assert.equal(history?.status, 200); assert.deepEqual((history?.value as any).authorizations, [f.authorization]);
  const exact = await f.routes(request, new URL(`http://localhost/api/decision-board/action-authorizations/${f.authorization.authorizationId}`));
  assert.deepEqual((exact?.value as any).authorization, f.authorization);
  const receipt = await f.routes(request, new URL(`http://localhost/api/decision-board/action-authorizations/operations/${f.authorization.operationId}`));
  assert.deepEqual((receipt?.value as any).authorization, f.authorization);
  assert.equal(f.store.getTask(f.task.id).status, 'todo'); assert.equal(f.store.listFeedbackHistory(f.task.id).length, 0);
});

test('A16 readonly Task history separates choice, action authorization, user report and effect validation', async t => {
  const f = await fixture(t);
  const module = await import('../extensions/business-plugins/decision-board/ui/ActionAuthorityHistory.tsx');
  const html = renderToStaticMarkup(createElement(module.ActionAuthorityHistory, { task: f.task, initialHistory: [f.authorization] }));
  for (const label of ['方案选择', '行动授权', '用户报告发生', '效果验证', '未独立验证', '只授权门店甲本周小范围发券', 'v2', '查看原方案与选择']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /<button[^>]*>执行|<button[^>]*>开始经营/);
  const old = renderToStaticMarkup(createElement(module.ActionAuthorityHistory, { task: f.task, initialHistory: [] }));
  assert.match(old, /未记录明确行动授权/); assert.match(old, /采纳.*不代表.*授权/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import { createQuotedDecisionAdapter } from '../src/host/quoted-decision-adapter.ts';
import { createDecisionBoardStore, boardRecordVersion } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

async function fixture(t: import('node:test').TestContext) {
  const evidence = path.resolve('.local/overall-architecture-product-gaps/pm03'); await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'arrange-')), cases = new CaseStore({ dataRoot: path.join(root, 'cases') });
  const boardRoot = path.join(root, 'board'), board = createDecisionBoardStore({ root: boardRoot }), goals = new StrategyGoalsStore(path.join(root, 'goals'));
  await cases.initialize(); await board.init(); t.after(() => { cases.close(); board.close(); });
  const goal = goals.create({ operationId: randomUUID(), title: '五店核查', outcome: '核清试点条件', perspective: 'personal', scope: { kind: 'personal', id: 'synthetic', name: '合成职责' }, measurement: { kind: 'deliverable', criterion: '形成可回查记录' }, baseline: { state: 'pending', description: '待核' }, responsible: '合成用户' });
  goals.adopt(goal, { operationId: randomUUID(), expectedVersion: 1, decision: '确认合成核查目标' });
  const projectId = randomUUID(), taskId = randomUUID(), text = '请按目标v1登记五店核查安排，先核窗口，再核供给；只登记待办，不开展经营动作。';
  const context = { projectId, taskId, requestId: randomUUID(), sessionId: 'synthetic-arrange-native', toolCallId: 'arrange-1', originalUserText: text,
    caseContext: null, workContext: { confirmationId: randomUUID(), planVersion: 1, taskKey: 'checks', goal: { goalId: goal.goalId, version: 1 } }, signal: new AbortController().signal, assertCurrent() {} };
  const input = { quote: { start: 0, end: text.length, text }, scope: '五店只登记核查待办', title: '五店核查安排', checks: ['核查窗口与资料来源', '检查供给事实的适用范围'], actions: [{ kind: 'create', title: '核清会员窗口', owner: '合成会员组' }, { kind: 'create', title: '核清供给事实' }] };
  const project = { id: projectId, archivedAt: null };
  const port = createQuotedDecisionAdapter({ cases, board, goals, projects: { get: async () => project, getTask: async () => ({ id: taskId }) } as any, mutate: async fn => fn(), isClosing: () => false });
  return { root, boardRoot, cases, board, goals, goal, projectId, taskId, input, context, port };
}

test('PG03: explicit no-Case work arranges two original Board actions and one exact GSA plan, repeated tool calls reuse the original receipt', async t => {
  const f = await fixture(t);
  const first = await f.port('arrange-actions' as any, f.input, f.context);
  assert.equal(first.details.status, 'completed');
  const again = await f.port('arrange-actions' as any, f.input, { ...f.context, toolCallId: 'arrange-2' });
  assert.equal(again.details.operationId, first.details.operationId);
  assert.equal(f.board.listTasks().length, 2);
  assert.deepEqual(f.board.listTasks().map(task => task.status), ['todo', 'todo']);
  assert.equal(f.cases.listCases().length, 0);
  const arrangements = (f.goals.list() as any).arrangements;
  assert.equal(arrangements.length, 1); assert.deepEqual(arrangements[0].goal, { goalId: f.goal.goalId, version: 1 });
  assert.deepEqual(arrangements[0].checks, ['核查窗口与资料来源', '检查供给事实的适用范围']);
  assert.equal(arrangements[0].actions.length, 2);
  assert.equal('owner' in arrangements[0].actions[0], false); assert.equal('status' in arrangements[0].actions[0], false);
  for (const task of f.board.listTasks()) { assert.equal(f.board.listActionAuthorizations(task.id).length, 1); assert.equal(f.board.listFeedbackHistory(task.id).length, 0); }
  f.board.close(); await f.board.init();
  assert.equal(f.board.listTasks().length, 2);
  assert.deepEqual((await f.port('read', { operationId: first.details.operationId }, f.context)).details.operation, first.details.authority);
  const changed = { ...f.input, title: '换了范围' };
  await assert.rejects(f.port('arrange-actions' as any, changed, f.context), /arrangement_operation_conflict/);
});

test('PG03: one exact existing action is reused, its execution facts stay original, and changed versions cannot be silently linked', async t => {
  const f = await fixture(t), item = f.board.addManualItem({ projectId: f.projectId, title: '原核查', rationale: '原授权范围' });
  const adopted = f.board.decideItem(item.id, { status: 'adopted' }), task = f.board.addTask(item.id, { title: '原窗口核查', owner: '原承接人', dueDate: '2026-11-20' });
  const reuse = { kind: 'reuse', itemId: item.id, taskId: task.id, itemVersion: boardRecordVersion(adopted), taskVersion: boardRecordVersion(task), expectedPreviousAuthorizationId: null };
  const input = { ...f.input, actions: [reuse, f.input.actions[1]] };
  const saved = await f.port('arrange-actions', input, f.context);
  assert.equal(saved.details.status, 'completed'); assert.equal(f.board.listTasks().length, 2); assert.deepEqual(f.board.getTask(task.id), task);
  f.board.setTaskStatus(task.id, 'doing');
  assert.equal((f.goals.list().arrangements![0].actions[0]).taskId, task.id);
  assert.equal('status' in f.goals.list().arrangements![0].actions[0], false);
  await assert.rejects(f.port('arrange-actions', input, { ...f.context, requestId: randomUUID() }), /authorization_source_changed/);
  assert.equal(f.board.listTasks().length, 2); assert.equal(f.board.listActionAuthorizations(task.id).length, 1);
});

test('PG03: Board success and GSA failure return partial; lost Board acknowledgment remains unknown until original readback', async t => {
  const f = await fixture(t), record = f.goals.recordArrangement.bind(f.goals); let unavailable = true;
  t.mock.method(f.goals, 'recordArrangement', (...args: Parameters<typeof record>) => { if (unavailable) throw Object.assign(new Error('synthetic_goal_unavailable'), { code: 'synthetic_goal_unavailable' }); return record(...args); });
  const partial = await f.port('arrange-actions', f.input, f.context);
  assert.equal(partial.details.status, 'partial'); assert.equal(f.board.listTasks().length, 2); assert.equal(f.goals.list().arrangements?.length ?? 0, 0);
  unavailable = false; const recovered = await f.port('arrange-actions', f.input, { ...f.context, toolCallId: 'recover' });
  assert.equal(recovered.details.status, 'completed'); assert.equal(f.board.listTasks().length, 2); assert.equal(f.goals.list().arrangements!.length, 1);
  const next = { ...f.context, requestId: randomUUID() }, arrange = f.board.arrangeActions.bind(f.board); let lost = true;
  t.mock.method(f.board, 'arrangeActions', (...args: Parameters<typeof arrange>) => { const saved = arrange(...args); if (lost) { lost = false; throw Object.assign(new Error('synthetic_ack_lost'), { code: 'synthetic_ack_lost' }); } return saved; });
  const unknown = await f.port('arrange-actions', f.input, next);
  assert.equal(unknown.details.status, 'unknown'); assert.equal(f.board.listTasks().length, 4); assert.equal(f.goals.list().arrangements!.length, 1);
  const read = await f.port('read', { operationId: unknown.details.operationId }, next); assert.equal((read.details.operation as any).actions.length, 2);
  const done = await f.port('arrange-actions', f.input, { ...next, toolCallId: 'recovered-ack' });
  assert.equal(done.details.status, 'completed'); assert.equal(done.details.operationId, unknown.details.operationId); assert.equal(f.board.listTasks().length, 4); assert.equal(f.goals.list().arrangements!.length, 2);
});

test('PG03: no Goal creates no fake GSA or Case, and cancellation/false quote/cross-project targets fail without new actions', async t => {
  const f = await fixture(t), noGoal = { ...f.context, workContext: null };
  const saved = await f.port('arrange-actions', f.input, noGoal);
  assert.equal(saved.details.status, 'completed'); assert.equal((saved.details.management as any).status, 'not-applicable'); assert.equal(f.goals.list().arrangements?.length ?? 0, 0); assert.equal(f.cases.listCases().length, 0);
  const fresh = { ...f.context, requestId: randomUUID() }, controller = new AbortController(); controller.abort();
  await assert.rejects(f.port('arrange-actions', f.input, { ...fresh, signal: controller.signal }));
  await assert.rejects(f.port('arrange-actions', { ...f.input, quote: { ...f.input.quote, text: '虚构授权' } }, fresh), /quote_mismatch/);
  const item = f.board.addManualItem({ projectId: randomUUID(), title: '其他项目', rationale: '不可越权' });
  await assert.rejects(f.port('arrange-actions', { ...f.input, actions: [{ kind: 'create', itemId: item.id, itemVersion: boardRecordVersion(item), title: '不应创建' }] }, fresh), /scope_mismatch/);
  assert.equal(f.board.listTasks().length, 2);
  const arrange = f.board.arrangeActions.bind(f.board);
  t.mock.method(f.board, 'arrangeActions', (input: Parameters<typeof arrange>[0], options: Parameters<typeof arrange>[1]) => { let checks = 0; return arrange(input, { assertWritable() { options?.assertWritable?.(); if (++checks === 2) throw Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' }); } }); });
  await assert.rejects(f.port('arrange-actions', f.input, fresh), /generation_cancelled/);
  assert.equal(f.board.listTasks().length, 2); f.board.close(); await f.board.init(); assert.equal(f.board.listTasks().length, 2);
});

test('PG03 UI: original GSA shows checks and live Board facts, Goal-based and legacy Case authorization displays remain separate', async t => {
  const f = await fixture(t); await f.port('arrange-actions', f.input, f.context);
  const first = f.board.listTasks()[0]; f.board.setTaskStatus(first.id, 'doing');
  const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } }); t.after(() => server.close());
  const gsa = await server.ssrLoadModule('/src/host/ui/StrategyGoalsPage.tsx'), authority = await server.ssrLoadModule('/extensions/business-plugins/decision-board/ui/ActionAuthorityHistory.tsx');
  const board = { items: f.board.listItems().map(item => ({ ...item, tasks: f.board.listTasks().filter(task => task.itemId === item.id) })) };
  const html = renderToStaticMarkup(createElement(gsa.GoalArrangements, { arrangements: f.goals.list().arrangements, board, onOpenBoard() {} }));
  for (const value of ['上层行动与检查安排', '五店核查安排', '核查窗口与资料来源', '核清会员窗口', '核清供给事实', '进行中', '到原看板维护行动', first.id]) assert.ok(html.includes(value), value);
  assert.equal('status' in f.goals.list().arrangements![0].actions[0], false);
  const unknown = renderToStaticMarkup(createElement(gsa.GoalArrangements, { arrangements: f.goals.list().arrangements })); assert.match(unknown, /原行动暂不可读取/);
  const goalHistory = renderToStaticMarkup(createElement(authority.ActionAuthorityHistory, { task: first, initialHistory: f.board.listActionAuthorizations(first.id) }));
  assert.match(goalHistory, /原目标 v1/); assert.match(goalHistory, /查看原目标准确版本/); assert.doesNotMatch(goalHistory, /查看原方案与选择/);
  const noGoal = await f.port('arrange-actions', f.input, { ...f.context, requestId: randomUUID(), workContext: null });
  const taskId = ((noGoal.details.authority as any).actions[0]).taskId;
  const noGoalHistory = renderToStaticMarkup(createElement(authority.ActionAuthorityHistory, { task: f.board.getTask(taskId), initialHistory: f.board.listActionAuthorizations(taskId) }));
  assert.match(noGoalHistory, /本项目原用户请求范围/); assert.match(noGoalHistory, /效果验证：未独立验证/);
});

test('PG03 Case compatibility: choosing alone creates no actions; a later explicit arrangement cites the exact original choice', async t => {
  const f = await fixture(t), record = f.cases.createCase({ operationId: randomUUID(), title: '合成持续事项', goalBinding: { primary: { goalId: f.goal.goalId, version: 1 }, related: [] } });
  f.cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId: f.projectId, expectedRevision: record.revision });
  const storeId = f.cases.getStatus().storeId!, draft = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: storeId, caseId: record.id, kind: 'strategy', expectedRevision: 0, payload: { title: '原核查方案', proposal: '先核证据再决策' } }, { actorKind: 'agent', projectId: f.projectId, taskId: f.taskId, requestId: randomUUID(), sessionId: 'original-strategy', toolCallId: 'strategy-1' });
  const strategyRef = { type: 'case-decision', caseStoreId: storeId, caseId: record.id, recordId: draft.recordId, revision: draft.revision };
  const context = { ...f.context, caseContext: { caseStoreId: storeId, caseId: record.id, caseRevision: f.cases.getCase(record.id).revision, projectWorkRevision: f.cases.getProjectWork(f.projectId).revision } };
  const chooseText = '采用原核查方案，具体行动另行授权。';
  await f.port('choose-strategy', { quote: { start: 0, end: chooseText.length, text: chooseText }, strategyRef, choice: 'trial', expectedPreviousChoiceId: null }, { ...context, requestId: randomUUID(), originalUserText: chooseText });
  const choice = f.cases.listDecisions(record.id).choices[0]; assert.equal(f.board.listTasks().length, 0);
  const result = await f.port('arrange-actions', { ...f.input, strategyRef, choiceId: choice.choiceId }, context);
  assert.equal(result.details.status, 'completed'); assert.equal(f.cases.listDecisions(record.id).choices.length, 1); assert.equal(f.board.listTasks().length, 2);
  const authorization = f.board.listActionAuthorizations(f.board.listTasks()[0].id)[0]; assert.equal('kind' in authorization.source, false);
  if (!('kind' in authorization.source)) { assert.deepEqual(authorization.source.strategyRef, strategyRef); assert.equal(authorization.source.choiceId, choice.choiceId); }
  assert.equal(f.goals.list().feedback.length, 1); assert.equal(f.goals.list().arrangements!.length, 1);
});

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
import './fixtures/register-ui.ts';

async function fixture(t: import('node:test').TestContext) {
  const directory = path.resolve('.local/overall-architecture-product-r-fixes/r02'); await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'adapter-')), cases = new CaseStore({ dataRoot: path.join(root, 'cases') }), board = createDecisionBoardStore({ root: path.join(root, 'board') }), goals = new StrategyGoalsStore(path.join(root, 'goals'));
  await cases.initialize(); await board.init(); t.after(() => { cases.close(); board.close(); });
  const projectId = randomUUID(), taskId = randomUUID();
  const goal = goals.create({ operationId: randomUUID(), title: '原核查目标', outcome: '核清窗口', perspective: 'personal', scope: { kind: 'personal', id: 'synthetic', name: '合成职责' }, measurement: { kind: 'deliverable', criterion: '保留来源' }, baseline: { state: 'pending', description: '待核' }, responsible: '合成人' });
  goals.adopt(goal, { operationId: randomUUID(), expectedVersion: 1, decision: '采用原目标' });
  const context = { projectId, taskId, requestId: randomUUID(), sessionId: 'synthetic-r02', toolCallId: 'arrange', signal: new AbortController().signal, assertCurrent() {}, caseContext: null,
    workContext: { confirmationId: randomUUID(), planVersion: 1, taskKey: 'check', goal: { goalId: goal.goalId, version: 1 } }, originalUserText: '登记核查窗口待办，不做经营执行。' };
  const port = createQuotedDecisionAdapter({ cases, board, goals, projects: { get: async () => ({ id: projectId, archivedAt: null }), getTask: async () => ({ id: taskId }) } as any, mutate: async fn => fn(), isClosing: () => false });
  const arranged = await port('arrange-actions', { quote: { start: 0, end: context.originalUserText.length, text: context.originalUserText }, title: '原窗口核查', scope: '核查资料', checks: ['保留来源'], actions: [{ kind: 'create', title: '窗口核查' }] }, context);
  const task = board.listTasks()[0], item = board.getItem(task.itemId), original = board.listActionAuthorizations(task.id)[0];
  const revokeContext = { ...context, requestId: randomUUID(), toolCallId: 'revoke', originalUserText: '撤回原窗口核查的授权，保留已发生记录。' };
  const input = { quote: { start: 0, end: revokeContext.originalUserText.length, text: revokeContext.originalUserText }, itemId: item.id, taskId: task.id, itemVersion: boardRecordVersion(item), taskVersion: boardRecordVersion(task), expectedPreviousAuthorizationId: original.authorizationId, decision: 'revoke', scope: '撤回原窗口核查授权' };
  return { cases, board, goals, context, revokeContext, port, input, original, arranged, task, item };
}

test('R02: exact Goal/Plan work revocation appends original authority once and GSA/Board show live authorization without changing execution', async t => {
  const f = await fixture(t), arrangements = structuredClone(f.goals.list().arrangements);
  const saved = await f.port('authorize-action', f.input, f.revokeContext);
  assert.equal(saved.details.status, 'completed'); assert.equal((saved.details.authority as any).decision, 'revoke');
  assert.equal((await f.port('authorize-action', f.input, { ...f.revokeContext, toolCallId: 'retry' })).details.operationId, saved.details.operationId);
  assert.deepEqual(f.board.listActionAuthorizations(f.task.id).map(entry => entry.decision), ['authorize', 'revoke']);
  const latest = f.board.listActionAuthorizations(f.task.id)[1]; assert.deepEqual(latest.source, f.original.source); assert.equal(latest.previousAuthorizationId, f.original.authorizationId);
  assert.equal(latest.quoteProvenance!.requestId, f.revokeContext.requestId); assert.deepEqual(f.board.getTask(f.task.id), f.task); assert.deepEqual(f.goals.list().arrangements, arrangements); assert.equal(f.cases.listCases().length, 0);
  f.board.close(); await f.board.init(); assert.equal(f.board.listActionAuthorizations(f.task.id).length, 2);
  const read = await f.port('read', { operationId: saved.details.operationId }, f.revokeContext); assert.equal((read.details.authorization as any).authorizationId, latest.authorizationId);
  const gsa = await import('../src/host/ui/StrategyGoalsPage.tsx'), authority = await import('../extensions/business-plugins/decision-board/ui/ActionAuthorityHistory.tsx');
  const board = {
    projects: [], reports: [],
    stats: {
      reports: 0, suggested: 0, dismissed: 0, highPrioritySuggested: 0, runningExtractions: 0,
      adopted: f.board.listItems().filter(item => item.status === 'adopted').length, manual: f.board.listItems().length,
    },
    items: [{ ...f.item, tasks: [{ ...f.task, authorization: latest }] }],
  };
  assert.ok(arrangements);
  const html = renderToStaticMarkup(createElement(gsa.GoalArrangements, { arrangements, board })); assert.match(html, /当前行动授权：已撤回/); assert.match(html, /效果未独立验证/);
  const history = renderToStaticMarkup(createElement(authority.ActionAuthorityHistory, { task: f.task, initialHistory: f.board.listActionAuthorizations(f.task.id) }));
  assert.match(history, /已记录撤回授权/); assert.match(history, /明确行动授权/); assert.match(history, /撤回行动授权/); assert.match(history, /原目标 v1/);
});

test('R02: no-Case revoke retains exact scope, quote, target version and CAS protections; it cannot create broader authority', async t => {
  const f = await fixture(t);
  await assert.rejects(f.port('authorize-action', { ...f.input, quote: undefined }, f.revokeContext), /clarification_required/);
  await assert.rejects(f.port('authorize-action', { ...f.input, quote: { ...f.input.quote, text: '虚构原话' } }, f.revokeContext), /quote_mismatch/);
  await assert.rejects(f.port('authorize-action', { ...f.input, expectedPreviousAuthorizationId: null }, f.revokeContext), /clarification_required/);
  await assert.rejects(f.port('authorize-action', { ...f.input, decision: 'authorize' }, f.revokeContext), /case_required/);
  await assert.rejects(f.port('authorize-action', f.input, { ...f.revokeContext, projectId: randomUUID() }), /scope_mismatch/);
  await assert.rejects(f.port('authorize-action', f.input, { ...f.revokeContext, taskId: randomUUID() }), /scope_mismatch/);
  await assert.rejects(f.port('authorize-action', f.input, { ...f.revokeContext, workContext: { ...f.context.workContext, planVersion: 2 } }), /scope_mismatch/);
  await assert.rejects(f.port('authorize-action', f.input, { ...f.revokeContext, workContext: { ...f.context.workContext, goal: { ...f.context.workContext.goal, version: 2 } } }), /scope_mismatch/);
  await assert.rejects(f.port('authorize-action', f.input, { ...f.revokeContext, workContext: undefined }), /scope_mismatch/);
  await assert.rejects(f.port('authorize-action', { ...f.input, itemVersion: '0'.repeat(64) }, f.revokeContext), /authorization_source_changed/);
  await assert.rejects(f.port('authorize-action', { ...f.input, expectedPreviousAuthorizationId: randomUUID() }, f.revokeContext), /scope_mismatch/);
  assert.equal(f.board.listActionAuthorizations(f.task.id).length, 1);
  f.board.setTaskStatus(f.task.id, 'doing');
  await assert.rejects(f.port('authorize-action', f.input, f.revokeContext), /authorization_source_changed/);
  f.input.taskVersion = boardRecordVersion(f.board.getTask(f.task.id));
  const altered = { ...f.original, operationId: randomUUID(), authorizationId: undefined, expectedPreviousAuthorizationId: f.original.authorizationId, taskVersion: f.input.taskVersion };
  f.board.recordActionAuthorization(altered as any);
  await assert.rejects(f.port('authorize-action', f.input, f.revokeContext), /authorization_revision_conflict/);
  assert.equal(f.board.listActionAuthorizations(f.task.id).length, 2);
});

test('R02: UNKNOWN keeps original authorization readback; cancellation before transaction commit creates no revoke', async t => {
  const f = await fixture(t), record = f.board.recordActionAuthorization.bind(f.board); let lost = true;
  t.mock.method(f.board, 'recordActionAuthorization', (...args: Parameters<typeof record>) => { const saved = record(...args); if (lost) { lost = false; throw Object.assign(new Error('synthetic_ack_lost'), { code: 'synthetic_ack_lost' }); } return saved; });
  const unknown = await f.port('authorize-action', f.input, f.revokeContext); assert.equal(unknown.details.status, 'unknown');
  const read = await f.port('read', { operationId: unknown.details.operationId }, f.revokeContext); assert.equal((read.details.authorization as any).decision, 'revoke');
  const done = await f.port('authorize-action', f.input, { ...f.revokeContext, toolCallId: 'readback-retry' }); assert.equal(done.details.status, 'completed'); assert.equal(done.details.operationId, unknown.details.operationId); assert.equal(f.board.listActionAuthorizations(f.task.id).length, 2);
  const g = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(g.port('authorize-action', g.input, { ...g.revokeContext, signal: controller.signal }));
  const write = g.board.recordActionAuthorization.bind(g.board);
  t.mock.method(g.board, 'recordActionAuthorization', (input: Parameters<typeof write>[0], options: Parameters<typeof write>[1]) => { let checks = 0; return write(input, { assertWritable() { options?.assertWritable?.(); if (++checks === 2) throw Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' }); } }); });
  await assert.rejects(g.port('authorize-action', g.input, g.revokeContext), /generation_cancelled/); assert.equal(g.board.listActionAuthorizations(g.task.id).length, 1);
});

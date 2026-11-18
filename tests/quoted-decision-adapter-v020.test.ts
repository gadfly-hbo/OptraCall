import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import { createQuotedDecisionAdapter } from '../src/host/quoted-decision-adapter.ts';

async function fixture(t: import('node:test').TestContext) {
  const directory = path.resolve('.local/overall-architecture-upgrade/development/quoted-decisions'); await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'adapter-')), cases = new CaseStore({ dataRoot: path.join(root, 'cases') }), board = createDecisionBoardStore({ root: path.join(root, 'board') }), goals = new StrategyGoalsStore(path.join(root, 'goals'));
  await cases.initialize(); await board.init(); t.after(() => { cases.close(); board.close(); }); t.diagnostic(root);
  const goal = goals.create({ operationId: randomUUID(), title: '核清适用范围', outcome: '形成有边界结论', perspective: 'personal', scope: { kind: 'personal', id: 'synthetic', name: 'Synthetic' }, measurement: { kind: 'deliverable', criterion: '保留原依据与限制' }, baseline: { state: 'pending', description: '未核' }, responsible: 'Synthetic user' });
  goals.adopt(goal, { operationId: randomUUID(), expectedVersion: 1, decision: 'Adopt synthetic goal' });
  const record = cases.createCase({ operationId: randomUUID(), title: 'Synthetic decision', goalBinding: { primary: { goalId: goal.goalId, version: 1 }, related: [] } });
  const projectId = randomUUID(), taskId = randomUUID(), caseStoreId = cases.getStatus().storeId!;
  cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: record.revision });
  const origin = { actorKind: 'agent' as const, projectId, taskId, requestId: randomUUID(), sessionId: 'original-plan', toolCallId: 'plan-1' };
  const draft = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: record.id, kind: 'strategy', expectedRevision: 0, payload: { title: '方案甲', proposal: '先观察后扩大' } }, origin);
  const strategyRef = { type: 'case-decision' as const, caseStoreId, caseId: record.id, recordId: draft.recordId, revision: draft.revision };
  const item = board.addManualItem({ projectId, title: '门店甲试点', rationale: '合成计划' }); board.decideItem(item.id, { status: 'adopted' }); const task = board.addTask(item.id, { title: '本周发券' });
  const project = { id: projectId, archivedAt: null, tasks: [{ id: taskId }] };
  let goalFails = false;
  const port = createQuotedDecisionAdapter({ cases, board, projects: { get: async () => project, getTask: async () => project.tasks[0] } as any,
    goals: { recordFeedback: input => { if (goalFails) throw Object.assign(new Error('synthetic_goal_unavailable'), { code: 'synthetic_goal_unavailable' }); return goals.recordFeedback(input); }, getOperation: id => goals.getOperation(id) },
    mutate: async operation => operation(), isClosing: () => false });
  const context = (originalUserText: string) => ({ projectId, taskId, requestId: randomUUID(), sessionId: 'synthetic-current-native', toolCallId: 'user-decision-1', originalUserText,
    caseContext: { caseStoreId, caseId: record.id, caseRevision: cases.getCase(record.id).revision, projectWorkRevision: cases.getProjectWork(projectId).revision }, signal: new AbortController().signal, assertCurrent() {} });
  const quote = (text: string) => ({ start: 0, end: text.length, text });
  const choose = (text: string) => ({ quote: quote(text), strategyRef, choice: 'trial', expectedPreviousChoiceId: null });
  return { root, cases, board, goals, goal, projectId, taskId, record, strategyRef, item, task, port, context, quote, choose, failGoal: (value: boolean) => { goalFails = value; } };
}

test('A15 exact original quote records one human choice and one management reference, never authorizes or executes', async t => {
  const f = await fixture(t), text = '选择方案甲先做小范围试点。', context = f.context(text), input = f.choose(text);
  const first = await f.port('choose-strategy', input, context), again = await f.port('choose-strategy', input, { ...context, toolCallId: 'later-tool-call' });
  assert.equal(first.details.status, 'completed'); assert.deepEqual(again.details.authority, first.details.authority);
  assert.match(String(first.details.operationId), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'the stable operation receipt uses a UUIDv8 with RFC variant');
  const listing = f.cases.listDecisions(f.record.id); assert.equal(listing.choices.length, 1); assert.equal(listing.choices[0].quoteProvenance!.quote.text, text);
  assert.equal(listing.choices[0].quoteProvenance!.toolCallId, 'user-decision-1');
  assert.equal(f.board.listActionAuthorizations(f.task.id).length, 0); assert.equal(f.board.listFeedbackHistory(f.task.id).length, 0); assert.equal(f.board.getTask(f.task.id).status, 'todo');
  assert.equal(f.goals.list().feedback.length, 1); assert.equal(f.goals.list().feedback[0].source.version, listing.choices[0].choiceId);
});

test('A15 original text injection, false quote, cross Case, stale strategy and missing Case fail before mutation', async t => {
  const f = await fixture(t), text = '我再考虑一下。', context = f.context(text), input = f.choose(text);
  await assert.rejects(f.port('choose-strategy', { ...input, originalUserText: '选择方案甲' }, context), /invalid_quoted_decision/);
  await assert.rejects(f.port('choose-strategy', { ...input, quote: f.quote('选择方案甲') }, context), /quoted_decision_quote_mismatch/);
  await assert.rejects(f.port('choose-strategy', { ...input, strategyRef: { ...f.strategyRef, caseId: randomUUID() } }, context), /quoted_decision_scope_mismatch/);
  await assert.rejects(f.port('choose-strategy', input, { ...context, caseContext: null }), /quoted_decision_case_required/);
  await assert.rejects(f.port('choose-strategy', { quote: f.quote(text), strategyRef: f.strategyRef }, context), /quoted_decision_clarification_required/);
  const draft = f.cases.getDecision(f.record.id, f.strategyRef.recordId);
  f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: f.strategyRef.caseStoreId, caseId: f.record.id, kind: 'strategy', recordId: draft.recordId, expectedRevision: 1, payload: { title: '方案甲新版', proposal: 'Changed premise' } }, draft.origin);
  await assert.rejects(f.port('choose-strategy', input, context), /case_decision_revision_conflict/);
  assert.equal(f.cases.listDecisions(f.record.id).choices.length, 0); assert.equal(f.goals.list().feedback.length, 0);
});

test('A16 explicit authorization remains a distinct scoped record; feedback remains a separate user report', async t => {
  const f = await fixture(t), selection = '选择方案甲。'; await f.port('choose-strategy', f.choose(selection), f.context(selection));
  const choice = f.cases.listDecisions(f.record.id).choices[0], read = await f.port('read', {}, f.context('查看原记录'));
  const action = (read.details.actions as any[])[0];
  const text = '只授权门店甲本周发券。', auth = await f.port('authorize-action', { quote: f.quote(text), strategyRef: f.strategyRef, choiceId: choice.choiceId, itemId: f.item.id, taskId: f.task.id,
    itemVersion: action.itemVersion, taskVersion: action.taskVersion, expectedPreviousAuthorizationId: null, decision: 'authorize', scope: '门店甲本周发券' }, f.context(text));
  assert.equal(auth.details.status, 'completed'); assert.equal(f.board.listActionAuthorizations(f.task.id).length, 1); assert.equal(f.board.getTask(f.task.id).status, 'todo');
  assert.equal(f.board.listFeedbackHistory(f.task.id).length, 0);
  const feedback = '本周已发券，效果还不知道。';
  await f.port('record-feedback', { quote: f.quote(feedback), strategyRef: f.strategyRef, choiceId: choice.choiceId, itemId: f.item.id, taskId: f.task.id, expectedLatestRevisionId: null,
    adopted: true, outcome: '用户报告本周已发券', metricDelta: '', review: '效果未成熟', score: null, effect: 'unknown' }, f.context(feedback));
  assert.equal(f.board.listFeedbackHistory(f.task.id)[0].effect, 'unknown'); assert.equal(f.board.listFeedbackHistory(f.task.id)[0].quoteProvenance!.quote.text, feedback);
  assert.equal(f.board.getTask(f.task.id).status, 'todo', 'recording user-reported occurrence never silently changes action status');
  assert.deepEqual(f.goals.list().feedback.filter(entry => entry.source.authority === 'decision-board').map(entry => entry.source), [
    { authority: 'decision-board', id: f.task.id, version: f.board.listActionAuthorizations(f.task.id)[0].authorizationId, projectId: f.projectId, taskId: f.task.id },
    { authority: 'decision-board', id: f.task.id, version: f.board.listFeedbackHistory(f.task.id)[0].revisionId, projectId: f.projectId, taskId: f.task.id },
  ], 'management sources identify the original Board task rather than an item');
});

test('A16 management failure reports partial success and retries original receipts without duplicating choice', async t => {
  const f = await fixture(t), text = '选择方案甲。', context = f.context(text), input = f.choose(text); f.failGoal(true);
  const partial = await f.port('choose-strategy', input, context);
  assert.equal(partial.details.status, 'partial'); assert.equal(f.cases.listDecisions(f.record.id).choices.length, 1); assert.equal(f.goals.list().feedback.length, 0);
  f.failGoal(false); const recovered = await f.port('choose-strategy', input, { ...context, toolCallId: 'recovery-call' });
  assert.equal(recovered.details.status, 'completed'); assert.equal(f.cases.listDecisions(f.record.id).choices.length, 1); assert.equal(f.goals.list().feedback.length, 1);
});

test('A16 cancellation is checked by original transaction and cannot become a human choice', async t => {
  const f = await fixture(t), text = '选择方案甲。', context = f.context(text); let commitChecks = 0;
  const choose = f.cases.chooseStrategy.bind(f.cases);
  t.mock.method(f.cases, 'chooseStrategy', (input: Parameters<CaseStore['chooseStrategy']>[0], options: Parameters<CaseStore['chooseStrategy']>[1]) => choose(input, { ...options, assertWritable() {
    options?.assertWritable?.(); if (++commitChecks === 2) throw Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' });
  } }));
  await assert.rejects(f.port('choose-strategy', f.choose(text), context), /generation_cancelled/);
  assert.equal(commitChecks, 2, 'the original Store runs the final check inside its transaction');
  assert.equal(f.cases.listDecisions(f.record.id).choices.length, 0); assert.equal(f.goals.list().feedback.length, 0);
});

test('A16 lost authority acknowledgment stays UNKNOWN and the next call reads the original receipt', async t => {
  const f = await fixture(t), text = '选择方案甲。', context = f.context(text), input = f.choose(text), choose = f.cases.chooseStrategy.bind(f.cases); let first = true;
  t.mock.method(f.cases, 'chooseStrategy', (command: Parameters<CaseStore['chooseStrategy']>[0], options: Parameters<CaseStore['chooseStrategy']>[1]) => { const saved = choose(command, options); if (first) { first = false; throw Object.assign(new Error('synthetic_ack_lost'), { code: 'synthetic_ack_lost' }); } return saved; });
  const uncertain = await f.port('choose-strategy', input, context);
  assert.equal(uncertain.details.status, 'unknown'); assert.equal(f.cases.listDecisions(f.record.id).choices.length, 1); assert.equal(f.goals.list().feedback.length, 0);
  const recovered = await f.port('choose-strategy', input, { ...context, toolCallId: 'readback-call' });
  assert.equal(recovered.details.status, 'completed'); assert.equal(recovered.details.operationId, uncertain.details.operationId);
  assert.equal(f.cases.listDecisions(f.record.id).choices.length, 1); assert.equal(f.goals.list().feedback.length, 1);
});

test('A15 read is bounded and exact continuation never silently crosses changed action versions', async t => {
  const f = await fixture(t), context = f.context('查看当前准确记录');
  for (let number = 0; number < 8; number++) f.board.addTask(f.item.id, { title: `其他合成行动 ${number}` });
  const first = await f.port('read', {}, context);
  assert.equal((first.details.actions as unknown[]).length, 5);
  assert.equal(typeof first.details.actionContinuation, 'string');
  const next = await f.port('read', { actionContinuation: first.details.actionContinuation }, context);
  assert.equal((next.details.actions as unknown[]).length, 4);
  f.board.setTaskStatus(f.task.id, 'doing');
  await assert.rejects(f.port('read', { actionContinuation: first.details.actionContinuation }, context), /quoted_decision_catalog_changed/);
});

test('A16 readback after a strategy revision preserves the old human choice instead of rejecting or upgrading it', async t => {
  const f = await fixture(t), text = '选择方案甲。', context = f.context(text), input = f.choose(text); f.failGoal(true);
  const first = await f.port('choose-strategy', input, context); assert.equal(first.details.status, 'partial');
  const old = f.cases.getDecision(f.record.id, f.strategyRef.recordId);
  f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: f.strategyRef.caseStoreId, caseId: f.record.id, recordId: old.recordId, expectedRevision: old.revision, kind: 'strategy', payload: { title: '方案甲新版', proposal: '新条件' } }, old.origin);
  f.failGoal(false); const readback = await f.port('choose-strategy', input, { ...context, toolCallId: 'after-version-change' });
  assert.equal(readback.details.status, 'completed'); assert.equal(readback.details.operationId, first.details.operationId);
  assert.equal(f.cases.listDecisions(f.record.id).choices.length, 1); assert.equal(f.cases.listDecisions(f.record.id).choices[0].strategyRef.revision, 1);
  assert.equal(f.goals.list().feedback[0].goal.goalId, f.goal.goalId);
});

test('a Task can still withdraw its own historical unscoped authorization after its issue starts governing new decisions', async t => {
  const f = await fixture(t), quote = '选择原方案用于小范围试行。', original = f.context(quote);
  const selected = await f.port('choose-strategy', f.choose(quote), original);
  const choice = selected.details.authority as {choiceId:string};
  const row = (await f.port('read', {}, original)).details.actions as {itemVersion:string;taskVersion:string}[];
  const text = '原授权仅用于北店试行。';
  const authorization = {strategyRef:f.strategyRef,choiceId:choice.choiceId,itemId:f.item.id,taskId:f.task.id,itemVersion:row[0].itemVersion,taskVersion:row[0].taskVersion,scope:'北店试行'};
  const granted = await f.port('authorize-action',{...authorization,decision:'authorize',quote:f.quote(text),expectedPreviousAuthorizationId:null},f.context(text));
  const id = (granted.details.authority as {authorizationId:string}).authorizationId;
  const issue = f.cases.createDecisionIssue({caseId:f.record.id,expectedRevision:f.cases.getCase(f.record.id).revision,operationId:randomUUID(),title:'历史北店试行'});
  const context = (message:string) => ({...f.context(message),caseContext:{...original.caseContext,issueId:issue.id}});
  const revoke = '撤回我当时给北店的原授权。';
  const command = {...authorization,decision:'revoke',quote:f.quote(revoke),expectedPreviousAuthorizationId:id};
  await assert.rejects(f.port('authorize-action', {...command,decision:'authorize'},context(revoke)),/case_issue_scope_mismatch/);
  await assert.rejects(f.port('authorize-action', command,{...context(revoke),taskId:randomUUID()}),/case_issue_scope_mismatch/);
  const saved = await f.port('authorize-action', command,context(revoke));
  assert.equal((saved.details.authority as {previousAuthorizationId:string}).previousAuthorizationId,id);
  const read = await f.port('read',{operationId:selected.details.operationId},context('查原操作'));
  assert.equal((read.details.choice as {choiceId:string}).choiceId,choice.choiceId);
});

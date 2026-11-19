import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CaseStore } from '../src/host/case-store.ts';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import type { GoalDraftInput } from '../src/host/strategy-goals-types.ts';
import { createCaseRoutes } from '../src/host/case-routes.ts';

const initial: GoalDraftInput = { title: '会员复购', outcome: '季度复购率提高', perspective: 'personal', scope: { kind: 'personal', id: 'member', name: '门店负责人' }, responsible: '店长', measurement: { kind: 'deliverable', criterion: '复核同店会员样本' }, baseline: { state: 'known', description: '二成' }, strategies: ['两店试行回访', '按品类调整陈列'] };

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oc-case-v13-'));
  const cases = new CaseStore({ dataRoot: root }); await cases.initialize();
  t.after(async () => { cases.close(); await rm(root, { recursive: true, force: true }); });
  const goals = new StrategyGoalsStore(root);
  const route = createCaseRoutes({ cases, goals, projects: {} as never, configuration: {} as never, mutate: async fn => fn(), assertActive() {}, decorateProject: p => p });
  const goal = goals.create({ ...initial, operationId: randomUUID() });
  function adopt(version: number) { return goals.adopt({ goalId: goal.goalId, version }, { operationId: randomUUID(), decision: '明确采用', expectedVersion: version }); }
  function revise(draft: GoalDraftInput, expectedVersion: number) { return goals.revise(goal.goalId, { ...draft, operationId: randomUUID(), expectedVersion }); }
  function create(version: number, strategy?: string, operationId = randomUUID()) { return route({ pathname: '/api/cases', method: 'POST', input: { title: '复购经营议题', operationId, goalBinding: { primary: { goalId: goal.goalId, version }, related: [], ...(strategy ? { strategy } : {}) } } }); }
  return { cases, goals, goal, adopt, revise, create, route };
}

test('all new Case requests require a concrete strategy and its own adopted G/S change', async t => {
  const f = await fixture(t);
  await assert.rejects(f.create(1, initial.strategies![0]), /goal_not_adopted/);
  f.adopt(1);
  await assert.rejects(f.create(1), /case_strategy_required/);
  await assert.rejects(f.create(1, '编造的策略'), /case_strategy_not_found/);
  const op = randomUUID(), created = (await f.create(1, initial.strategies![0], op))!.body as { case: { id: string } };
  assert.deepEqual((await f.create(1, initial.strategies![0], op))?.body, created);
  assert.equal(f.cases.getGoalBinding(created.case.id)?.strategy, initial.strategies![0]);
  await assert.rejects(f.create(1, initial.strategies![0]), /case_goal_strategy_already_used/);
  const revision = { ...initial, strategies: [initial.strategies![0]!, '增加搭配试穿'] };
  f.revise(revision, 1); f.adopt(2);
  await assert.rejects(f.create(2, initial.strategies![0]), /case_goal_strategy_unchanged/);
  await f.create(2, revision.strategies[1]); // changed S, same G
  f.revise(revision, 2); f.adopt(3);
  await assert.rejects(f.create(3, revision.strategies[1]), /case_goal_strategy_unchanged/);
  f.revise({ ...revision, outcome: '复购率达到三成' }, 3); f.adopt(4);
  await f.create(4, revision.strategies[0]); // changed G, same S
  f.revise({ ...revision, outcome: '达到四成', strategies: ['调整时段'] }, 4); f.adopt(5);
  await f.create(5, '调整时段');
});

test('a question spans alternative A and B, independently from another question and Case', async t => {
  const f = await fixture(t), a = f.cases.createCase({ operationId: randomUUID(), title: '会员运营' }), b = f.cases.createCase({ operationId: randomUUID(), title: '同项目第二议题' });
  const one = f.cases.createDecisionIssue({ caseId: a.id, expectedRevision: a.revision, operationId: randomUUID(), title: '回访范围' });
  const two = f.cases.createDecisionIssue({ caseId: a.id, expectedRevision: 2, operationId: randomUUID(), title: '开展日期' });
  assert.throws(() => f.cases.getDecisionIssue(b.id, one.id), /case_issue_not_found/);
  const projectId = randomUUID(); f.cases.linkProject({ operationId: randomUUID(), caseId: a.id, expectedRevision: 3, projectId });
  const storeId = f.cases.getStatus().storeId!;
  const make = (proposal: string) => {
    const record = f.cases.saveDecisionDraft({ caseId: a.id, caseStoreId: storeId, operationId: randomUUID(), expectedRevision: 0, kind: 'strategy', payload: { title: proposal, proposal } }, { actorKind: 'agent', projectId, taskId: randomUUID(), requestId: 'r', sessionId: 's', toolCallId: 't' });
    return { type: 'case-decision' as const, caseId: a.id, caseStoreId: storeId, recordId: record.recordId, revision: 1 };
  };
  const planA = make('两店回访'), planB = make('四店分层');
  const choose = (issueId: string, strategyRef: typeof planA, previous: string | null) => f.cases.chooseStrategy({ caseId: a.id, caseStoreId: storeId, issueId, operationId: randomUUID(), strategyRef, choice: 'trial', reason: '有可核对的观察窗口', expectedPreviousChoiceId: previous });
  const first = choose(one.id, planA, null);
  assert.throws(() => choose(one.id, planB, null), /case_choice_conflict/);
  const second = choose(one.id, planB, first.choiceId);
  assert.equal(second.previousChoiceId, first.choiceId);
  assert.equal(f.cases.getStrategyChoice(a.id, first.choiceId).issueId, one.id);
  assert.equal(choose(two.id, planA, null).previousChoiceId, null);
});

test('annual continuation preserves future-effective bindings and rejects changed criteria or closed Cases', async t => {
  const f = await fixture(t); f.adopt(1);
  const {case:record} = (await f.create(1, initial.strategies![0]))!.body as {case:{id:string}};
  const path = '/api/cases/'+record.id+'/goals', next = { ...initial, outcome:'下一年度提高复购' };
  f.revise(next,1); f.adopt(2);
  const binding = { primary:{goalId:f.goal.goalId,version:2},related:[],strategy:initial.strategies![0],effectiveFrom:'2099-01-01' };
  const cmd = { operationId:randomUUID(),expectedRevision:1,goalBinding:binding };
  await assert.rejects(f.route({pathname:path,method:'POST',input:cmd}),/case_continuity_confirmation_required/);
  await f.route({pathname:path,method:'POST',input:{...cmd,continuityConfirmed:true}});
  assert.equal(f.cases.getGoalBinding(record.id)?.primary.version,1);
  assert.equal(f.cases.getGoalBinding(record.id,new Date(2099,0,1))?.primary.version,2);
  assert.deepEqual(f.cases.getGoalBindingHistory(record.id).map(b=>b.primary.version),[1,2]);
  f.revise({...next,measurement:{kind:'deliverable',criterion:'按不同单位检验'}},2); f.adopt(3);
  await assert.rejects(f.route({pathname:path,method:'POST',input:{...cmd,operationId:randomUUID(),expectedRevision:2,goalBinding:{...binding,primary:{...binding.primary,version:3},effectiveFrom:'2099-03-01'},continuityConfirmed:true}}),/case_new_issue_requires_new_case/);
  f.cases.closeCase({caseId:record.id,expectedRevision:2,operationId:randomUUID(),closeReason:'结束观察'});
  await assert.rejects(f.route({pathname:path,method:'POST',input:{...cmd,operationId:randomUUID(),expectedRevision:3,goalBinding:{...binding,effectiveFrom:'2100-01-01'},continuityConfirmed:true}}),/case_closed/);
  assert.equal(f.cases.getGoalBindingHistory(record.id).length,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectHomePending, type HomePendingProjection } from '../src/host/home-pending.ts';
import type { CaseDecisionRequest, CaseStrategyChoice } from '../src/host/case-decision-types.ts';
import type { CaseRecord } from '../src/host/case-types.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { createWorkspaceDraftStore } from '../src/host/workspace-draft-store.ts';
import { createWorkspaceDailyRoutes } from '../src/host/workspace-daily-routes.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';

const record = { id: 'case', title: 'Case', status: 'analyzing', updatedAt: '2026-11-28', nextStep: '' } as CaseRecord;
const strategyRef = { type: 'case-decision' as const, caseId: 'case', caseStoreId: 'store', recordId: 'plan', revision: 9 };
const choice = (id: string, previous: string | null, issueId = 'issue'): CaseStrategyChoice => ({ choiceId: id, previousChoiceId: previous, issueId, caseId: 'case', strategyRef, choice: 'trial', reason: null, operationId: id, occurredAt: '2026-11-28', actorKind: 'user' });
const request = (previous: string | null): CaseDecisionRequest => ({ requestId: 'request', revision: 1, caseId: 'case', issueId: 'issue', kind: 'choose', text: '请作取舍', source: { kind: 'user-declaration', ref: '原声明' }, assignee: { label: '承担人', source: '原声明' }, requestedAt: '2026-11-28', target: { kind: 'choose', strategyRef, expectedPreviousChoiceId: previous }, lifecycle: 'open', operationId: 'operation', createdAt: '2026-11-28' });
function project(req: CaseDecisionRequest, choices: CaseStrategyChoice[]) {
  return projectHomePending({ storeState: 'ready', cases: [{ record, issues: [{ id: 'issue', caseId: record.id, title: '原事项', createdAt: '' }], choices, requests: [req], requestStatuses: { request: 'open' } }] }).pending[0]!;
}

test('DW08 round: choose uses the exact original predecessor chain, independent of array order, other issues or strategy version', () => {
  assert.equal(project(request(null), []).roundNumber, 1, 'strategy v9 does not mean round9');
  const history = [choice('second', 'first'), choice('other-second', 'other-first', 'other'), choice('first', null), choice('other-first', null, 'other')];
  assert.equal(project(request('second'), history).roundNumber, 3);
  assert.equal(project(request('first'), history).roundNumber, 2, 'historical request keeps its original upcoming round');
});

test('DW08 round: missing, cross-owner, cross-issue, cyclic or ambiguous predecessor chains remain unknown', () => {
  const valid = choice('first', null);
  const malformed = [
    [],
    [{ ...valid, previousChoiceId: 'missing' }],
    [{ ...valid, caseId: 'other-case' }],
    [{ ...valid, issueId: 'other-issue' }],
    [{ ...valid, strategyRef: { ...valid.strategyRef, caseStoreId: 'other-store' } }],
    [{ ...valid, previousChoiceId: 'first' }],
    [{ ...valid, previousChoiceId: 'second' }, choice('second', 'first')],
    [valid, { ...valid }],
  ];
  for (const history of malformed) assert.equal(project(request('first'), history).roundNumber, null, JSON.stringify(history));
  const observe: CaseDecisionRequest = { ...request(null), kind: 'observe', target: { kind: 'observe', projectId: 'p', itemId: 'i', taskId: 't', authorizationId: 'a', feedbackBaseRevisionId: null } };
  assert.equal(project(observe, [valid]).roundNumber, null, 'an observation without its exact qualified authorization cannot borrow latest round');
});

async function fixture(t: { after(fn: () => void): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-home-round-'));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') }); await cases.initialize();
  const board = createDecisionBoardStore({ root: path.join(root, 'board') }); await board.init();
  t.after(() => { cases.close(); board.close(); });
  const record = cases.createCase({ operationId: randomUUID(), title: '准确轮次' });
  const projectId = randomUUID(), store = cases.getStatus().storeId!;
  const revision = () => cases.getCase(record.id).revision;
  cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: revision() });
  const issue = cases.createDecisionIssue({ operationId: randomUUID(), caseId: record.id, expectedRevision: revision(), title: '原事项' });
  const other = cases.createDecisionIssue({ operationId: randomUUID(), caseId: record.id, expectedRevision: revision(), title: '另一事项' });
  const plan = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: store, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '原方案', proposal: '原计划' } }, { actorKind: 'agent', projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 'synthetic', toolCallId: 'seed' });
  const strategyRef = { type: 'case-decision' as const, caseStoreId: store, caseId: record.id, recordId: plan.recordId, revision: plan.revision };
  const choose = (issueId = issue.id) => cases.chooseStrategy({ operationId: randomUUID(), caseStoreId: store, caseId: record.id, issueId, strategyRef, choice: 'trial', expectedPreviousChoiceId: cases.getStrategyChoices(record.id).filter(c => c.issueId === issueId).at(-1)?.choiceId ?? null });
  const action = (c: CaseStrategyChoice) => board.arrangeActions({ operationId: randomUUID(), projectId, source: { caseStoreId: store, caseId: record.id, choiceId: c.choiceId, strategyRef }, scope: '原授权', title: '核查行动', checks: [], actions: [{ kind: 'create', title: '回收资料' }] }, { confirmedIssueId: c.issueId }).actions[0]!;
  const save = (target: CaseDecisionRequest['target'], issueId = issue.id) => cases.saveDecisionRequest({ operationId: randomUUID(), caseId: record.id, expectedRevision: revision(), expectedRequestRevision: 0, issueId, kind: target.kind, text: '请回应准确原轮次', assignee: { label: '承担人', source: '原声明' }, source: { kind: 'user-declaration', ref: '原声明' }, target });
  const routes = createWorkspaceDailyRoutes({ cases, board, assertActiveProject: async () => {}, drafts: createWorkspaceDraftStore({ root: path.join(root, 'drafts') }), adoptGoal: async () => { throw Error('unused'); }, createCase: async () => { throw Error('unused'); } });
  const read = async () => (await routes({ pathname: '/api/workspace/home-pending', method: 'GET' }))!.body as HomePendingProjection;
  const target = (a: ReturnType<typeof action>): CaseDecisionRequest['target'] => ({ kind: 'observe', projectId, itemId: a.itemId, taskId: a.taskId, authorizationId: a.authorizationId, feedbackBaseRevisionId: null });
  return { cases, board, record, issue, other, strategyRef, choose, action, save, read, target };
}

test('DW08 round: real route keeps old observation authorization on round1 while a new request follows round2 of the same issue', async t => {
  const f = await fixture(t);
  const first = f.choose(), oldAction = f.action(first), firstRequest = f.save(f.target(oldAction));
  const second = f.choose(), nextAction = f.action(second), secondRequest = f.save(f.target(nextAction));
  f.choose(f.other.id);
  const chooseRequest = f.save({ kind: 'choose', strategyRef: f.strategyRef, expectedPreviousChoiceId: second.choiceId });
  const result = await f.read(), all = [...result.pending, ...result.unresolvedRequests];
  assert.equal(all.find(r => r.requestId === firstRequest.requestId)?.roundNumber, 1);
  assert.equal(all.find(r => r.requestId === secondRequest.requestId)?.roundNumber, 2);
  assert.equal(all.find(r => r.requestId === chooseRequest.requestId)?.roundNumber, 3);
  assert.equal(f.cases.getStrategyChoices(f.record.id).length, 3, 'reading rounds never advances choices');
});

test('DW08 round: observation authorization from another issue or wrong project is unknown, not guessed from the Case latest choice', async t => {
  const f = await fixture(t);
  const a = f.action(f.choose(f.other.id));
  const wrongIssue = f.save(f.target(a));
  const original = f.target(f.action(f.choose()));
  assert.equal(original.kind, 'observe');
  const wrongProject = f.save({ ...original, projectId: randomUUID() });
  const result = await f.read(), all = [...result.pending, ...result.unresolvedRequests];
  assert.equal(all.find(r => r.requestId === wrongIssue.requestId)?.roundNumber, null);
  assert.equal(all.find(r => r.requestId === wrongProject.requestId)?.roundNumber, null);
});

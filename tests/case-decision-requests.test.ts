import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { createCaseIssueService } from '../src/host/case-issues.ts';
import { createCaseDecisionRoutes } from '../src/host/case-decision-routes.ts';
import { requestStatus } from '../src/host/case-decision-types.ts';
import { projectHomePending } from '../src/host/home-pending.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';

const activeProjectAuthority = { projects: { get: async (id: string) => ({ id, archivedAt: null, tasks: [] }) }, assertActive() {} };

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-dw-req-')));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') });
  const board = createDecisionBoardStore({ root: path.join(root, 'board') });
  t.after(async () => { cases.close(); board.close(); });
  await cases.initialize();
  await board.init();
  const record = cases.createCase({ operationId: randomUUID(), title: '华东扩围试点' });
  const projectId = randomUUID();
  cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: cases.getCase(record.id).revision });
  const issue = cases.createDecisionIssue({ caseId: record.id, expectedRevision: cases.getCase(record.id).revision, operationId: randomUUID(), title: '扩围范围取舍' });
  const caseStoreId = cases.getStatus().storeId!;
  const strategy = cases.saveDecisionDraft(
    { operationId: randomUUID(), caseStoreId, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '先试三家门店', proposal: '观察两周复购' } },
    { actorKind: 'agent', projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 's1', toolCallId: 't1' },
  );
  const strategyRef = { type: 'case-decision' as const, caseStoreId, caseId: record.id, recordId: strategy.recordId, revision: strategy.revision };
  return { cases, board, record, projectId, issue, caseStoreId, strategy, strategyRef };
}

test('DW08/DW09-REQ-01: explicit choose request is only resolved by exact respondsToRequest choice, never by viewing or unrelated choices', async t => {
  const f = await fixture(t);
  const rev = () => f.cases.getCase(f.record.id).revision;
  const op = randomUUID();
  const reqInput = {
    operationId: op, caseId: f.record.id, expectedRevision: rev(), expectedRequestRevision: 0,
    issueId: f.issue.id, kind: 'choose' as const, text: '请确认是否先试三家门店',
    source: { kind: 'user-declaration' as const, ref: 'session-1/msg-5' },
    assignee: { label: '门店负责人（对话声明）', source: 'session-1/msg-5' },
    target: { kind: 'choose' as const, strategyRef: f.strategyRef, expectedPreviousChoiceId: null },
  };
  const saved = f.cases.saveDecisionRequest(reqInput);
  assert.deepEqual(f.cases.saveDecisionRequest(reqInput), saved, 'idempotent replay returns original receipt');
  assert.equal(requestStatus(saved, f.cases.getStrategyChoices(f.record.id), undefined), 'open');

  // A choice on a DIFFERENT issue does NOT resolve or supersede req1.
  const otherIssue = f.cases.createDecisionIssue({ caseId: f.record.id, expectedRevision: rev(), operationId: randomUUID(), title: '另一事项' });
  const otherStrat = f.cases.saveDecisionDraft(
    { operationId: randomUUID(), caseStoreId: f.caseStoreId, caseId: f.record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '另一方案', proposal: '只做线上' } },
    { actorKind: 'agent', projectId: f.projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 's1', toolCallId: 't2' },
  );
  f.cases.chooseStrategy({
    operationId: randomUUID(), caseStoreId: f.caseStoreId, caseId: f.record.id, issueId: otherIssue.id,
    strategyRef: { type: 'case-decision', caseStoreId: f.caseStoreId, caseId: f.record.id, recordId: otherStrat.recordId, revision: otherStrat.revision },
    choice: 'defer', expectedPreviousChoiceId: null,
  });
  assert.equal(requestStatus(saved, f.cases.getStrategyChoices(f.record.id), undefined), 'open');

  // A choice on the SAME issue without referencing req1 moves the chain forward -> req1 becomes superseded (not answered).
  f.cases.chooseStrategy({
    operationId: randomUUID(), caseStoreId: f.caseStoreId, caseId: f.record.id, issueId: f.issue.id,
    strategyRef: { type: 'case-decision', caseStoreId: f.caseStoreId, caseId: f.record.id, recordId: otherStrat.recordId, revision: otherStrat.revision },
    choice: 'defer', expectedPreviousChoiceId: null,
  });
  assert.equal(requestStatus(saved, f.cases.getStrategyChoices(f.record.id), undefined), 'superseded');

  // Fresh request on the new head choice is open, and answered only by exact respondsToRequest.
  const headChoiceId = f.cases.getStrategyChoices(f.record.id).filter(c => c.issueId === f.issue.id).at(-1)!.choiceId;
  const req2 = f.cases.saveDecisionRequest({
    operationId: randomUUID(), caseId: f.record.id, expectedRevision: rev(), expectedRequestRevision: 0,
    issueId: f.issue.id, kind: 'choose', text: '请对三家门店方案作取舍',
    source: { kind: 'user-declaration', ref: 'session-1/msg-6' },
    assignee: { label: '业务负责人', source: 'session-1/msg-6' },
    target: { kind: 'choose', strategyRef: f.strategyRef, expectedPreviousChoiceId: headChoiceId },
  });
  assert.equal(requestStatus(req2, f.cases.getStrategyChoices(f.record.id), undefined), 'open');

  f.cases.chooseStrategy({
    operationId: randomUUID(), caseStoreId: f.caseStoreId, caseId: f.record.id, issueId: f.issue.id,
    strategyRef: f.strategyRef, choice: 'trial', expectedPreviousChoiceId: headChoiceId,
    respondsToRequest: { requestId: req2.requestId, revision: req2.revision },
  });
  assert.equal(requestStatus(req2, f.cases.getStrategyChoices(f.record.id), undefined), 'answered');
  assert.equal(requestStatus(saved, f.cases.getStrategyChoices(f.record.id), undefined), 'superseded');
});

test('DW08/DW09-REQ-02: observe request is only resolved by saveFeedback carrying exact requestId, revision, real Case authorizationId, and baseRevisionId', async t => {
  const f = await fixture(t);
  const choice = f.cases.chooseStrategy({
    operationId: randomUUID(), caseStoreId: f.caseStoreId, caseId: f.record.id, issueId: f.issue.id,
    strategyRef: f.strategyRef, choice: 'trial', expectedPreviousChoiceId: null,
  });
  const arranged = f.board.arrangeActions({
    operationId: randomUUID(), projectId: f.projectId,
    source: { caseStoreId: f.caseStoreId, caseId: f.record.id, choiceId: choice.choiceId, strategyRef: f.strategyRef },
    scope: '首周门店访谈观察', title: '门店访谈', checks: [],
    actions: [{ kind: 'create', title: '记录首周客流' }],
  }, { confirmedIssueId: f.issue.id });
  const act = arranged.actions[0]!;
  const rev = () => f.cases.getCase(f.record.id).revision;

  const req = f.cases.saveDecisionRequest({
    operationId: randomUUID(), caseId: f.record.id, expectedRevision: rev(), expectedRequestRevision: 0,
    issueId: f.issue.id, kind: 'observe', text: '请补录首周客流原始观察',
    source: { kind: 'user-declaration', ref: 'session-1/msg-8' },
    assignee: { label: '华东运营', source: 'session-1/msg-8' },
    target: { kind: 'observe', projectId: f.projectId, itemId: act.itemId, taskId: act.taskId, authorizationId: act.authorizationId, feedbackBaseRevisionId: null },
  });

  const service = createCaseIssueService({ ...activeProjectAuthority, cases: f.cases, board: f.board, mutate: (fn: () => unknown) => fn() } as never);
  assert.equal((await service.decisionRequests(f.record.id))[0]!.status, 'open');

  // Wait 5ms so feedback savedAt is strictly after authorization createdAt (authorityAtFeedback ordering)
  await new Promise(r => setTimeout(r, 10));

  // Feedback with wrong authorizationId does NOT resolve the request.
  const wrongAuth = f.board.saveFeedback(act.taskId, {
    operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '初步观察', metricDelta: '', review: '', score: null, effect: 'unknown',
    respondsToRequest: { requestId: req.requestId, revision: req.revision, authorizationId: randomUUID() },
  });
  assert.equal((await service.decisionRequests(f.record.id))[0]!.status, 'superseded');

  // Create a second observe request based on wrongAuth.revisionId and answer it accurately under the REAL authorization.
  const req2 = f.cases.saveDecisionRequest({
    operationId: randomUUID(), caseId: f.record.id, expectedRevision: rev(), expectedRequestRevision: 0,
    issueId: f.issue.id, kind: 'observe', text: '请补录第二轮观察',
    source: { kind: 'user-declaration', ref: 'session-1/msg-9' },
    assignee: { label: '华东运营', source: 'session-1/msg-9' },
    target: { kind: 'observe', projectId: f.projectId, itemId: act.itemId, taskId: act.taskId, authorizationId: act.authorizationId, feedbackBaseRevisionId: wrongAuth.revisionId },
  });
  await new Promise(r => setTimeout(r, 10));
  f.board.saveFeedback(act.taskId, {
    operationId: randomUUID(), expectedLatestRevisionId: wrongAuth.revisionId, adopted: true, outcome: '首周复购+4%', metricDelta: '+4%', review: '', score: 4, effect: 'positive',
    respondsToRequest: { requestId: req2.requestId, revision: req2.revision, authorizationId: act.authorizationId },
  });
  const list = await service.decisionRequests(f.record.id);
  assert.equal(list.find(r => r.requestId === req.requestId)!.status, 'superseded');
  assert.equal(list.find(r => r.requestId === req2.requestId)!.status, 'answered');
});

test('DW08/DW09-HOME-03: home projection separates pending, continue, externalWaiting, pendingOperations; never fabricates pending from awaiting_confirmation or missing assignee', async t => {
  const f = await fixture(t);
  const rev = () => f.cases.getCase(f.record.id).revision;
  f.cases.updateCase({ operationId: randomUUID(), caseId: f.record.id, expectedRevision: rev(), status: 'awaiting_confirmation' });

  // No explicit requests -> pending is empty even though Case is awaiting_confirmation!
  const emptyProj = projectHomePending({
    storeState: 'ready',
    cases: [{ record: f.cases.getCase(f.record.id), issues: f.cases.listDecisionIssues(f.record.id), requests: [], choices: [] }],
  });
  assert.equal(emptyProj.pendingHeading, '待处理事项');
  assert.equal(emptyProj.pending.length, 0);
  assert.equal(emptyProj.continueWork.length, 1);
  assert.equal(emptyProj.foundationReminders.length, 4);

  // Explicit request WITHOUT assignee goes to unresolvedRequests, NOT pending.
  const noAssignee = f.cases.saveDecisionRequest({
    operationId: randomUUID(), caseId: f.record.id, expectedRevision: rev(), expectedRequestRevision: 0,
    issueId: f.issue.id, kind: 'choose', text: '未指明承担人的请求',
    source: { kind: 'user-declaration', ref: 'm1' },
    assignee: { label: null, source: null },
    target: { kind: 'choose', strategyRef: f.strategyRef, expectedPreviousChoiceId: null },
  });
  // Explicit request WITH assignee goes to pending.
  const withAssignee = f.cases.saveDecisionRequest({
    operationId: randomUUID(), caseId: f.record.id, expectedRevision: rev(), expectedRequestRevision: 0,
    issueId: f.issue.id, kind: 'choose', text: '请门店经理作取舍',
    source: { kind: 'user-declaration', ref: 'm2' },
    assignee: { label: '门店经理', source: 'm2' },
    target: { kind: 'choose', strategyRef: f.strategyRef, expectedPreviousChoiceId: null },
  });
  const proj = projectHomePending({
    storeState: 'ready',
    cases: [{
      record: f.cases.getCase(f.record.id),
      issues: f.cases.listDecisionIssues(f.record.id),
      requests: f.cases.listDecisionRequests(f.record.id),
      choices: f.cases.getStrategyChoices(f.record.id),
      pendingOperations: [{ operationId: randomUUID(), kind: 'project_create_link', phase: 'project_created', caseId: f.record.id, projectId: f.projectId, requestSha256: '0'.repeat(64), result: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    }],
  });
  assert.deepEqual(proj.pending.map(p => p.requestId), [withAssignee.requestId]);
  assert.deepEqual(proj.unresolvedRequests.map(u => u.requestId), [noAssignee.requestId]);
  assert.equal(proj.pendingOperations.length, 1);
  assert.equal(proj.pendingOperations[0]!.group, 'operation-to-verify');

  // Route smoke check
  const service = createCaseIssueService({ ...activeProjectAuthority, cases: f.cases, board: f.board, mutate: (fn: () => unknown) => fn() } as never);
  const route = createCaseDecisionRoutes(service as never);
  const got = await route({ pathname: `/api/cases/${f.record.id}/decisions/requests`, method: 'GET' }) as { body: { requests: unknown[] } };
  assert.equal(got.body.requests.length, 2);

  // Unavailable store still exposes 4 non-gating foundation reminders and never throws.
  const unavail = projectHomePending({ storeState: 'unavailable', cases: [] });
  assert.equal(unavail.storeState, 'unavailable');
  assert.equal(unavail.pending.length, 0);
  assert.equal(unavail.foundationReminders.length, 4);
});

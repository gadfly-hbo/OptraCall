import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { chooseRequestStatus, createCaseIssueService, observationRequestStatus } from '../src/host/case-issues.ts';
import { boardRecordVersion, createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { createWorkspaceDailyRoutes } from '../src/host/workspace-daily-routes.ts';
import { createWorkspaceDraftStore } from '../src/host/workspace-draft-store.ts';

async function fixture(t: { after(fn: () => void): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-case-second-'));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') }); await cases.initialize();
  const board = createDecisionBoardStore({ root: path.join(root, 'board') }); await board.init();
  t.after(() => { cases.close(); board.close(); });
  const record = cases.createCase({ operationId: randomUUID(), title: '合成请求' });
  const rev = () => cases.getCase(record.id).revision;
  const projectId = randomUUID(); cases.linkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: rev(), projectId });
  const a = cases.createDecisionIssue({ operationId: randomUUID(), caseId: record.id, expectedRevision: rev(), title: 'A' });
  const b = cases.createDecisionIssue({ operationId: randomUUID(), caseId: record.id, expectedRevision: rev(), title: 'B' });
  const caseStoreId = cases.getStatus().storeId!;
  const strategy = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '方案', proposal: '合成观察' } }, { actorKind: 'agent', projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 'synthetic', toolCallId: 'seed' });
  const strategyRef = { type: 'case-decision' as const, caseStoreId, caseId: record.id, recordId: strategy.recordId, revision: strategy.revision };
  const service = createCaseIssueService({ cases, board, mutate: async (fn: () => unknown) => fn() } as never);
  const chooseInput = () => ({ operationId: randomUUID(), expectedRevision: rev(), expectedRequestRevision: 0, issueId: a.id, kind: 'choose', text: '请负责人选择', assignee: { label: '负责人', source: '原用户声明' }, dueDate: '2026-12-01', source: { kind: 'agent-tool', ref: 'synthetic/request/tool' }, target: { kind: 'choose', strategyRef, expectedPreviousChoiceId: null } });
  function action(issueId: string, project = projectId) {
    const prev = cases.getStrategyChoices(record.id).filter(c => c.issueId === issueId).at(-1);
    const choice = cases.chooseStrategy({ operationId: randomUUID(), caseStoreId, caseId: record.id, issueId, strategyRef, choice: 'trial', expectedPreviousChoiceId: prev?.choiceId ?? null });
    const arranged = board.arrangeActions({ operationId: randomUUID(), projectId: project, source: { caseStoreId, caseId: record.id, choiceId: choice.choiceId, strategyRef }, scope: '合成观察', title: '行动', checks: [], actions: [{ kind: 'create', title: '观察' }] }, { confirmedIssueId: issueId });
    return arranged.actions[0]!;
  }
  const observeInput = (issueId: string, act: ReturnType<typeof action>, project = projectId) => ({ ...chooseInput(), issueId, kind: 'observe', target: { kind: 'observe', projectId: project, itemId: act.itemId, taskId: act.taskId, authorizationId: act.authorizationId, feedbackBaseRevisionId: null } });
  const daily = createWorkspaceDailyRoutes({ cases, board, drafts: createWorkspaceDraftStore({ root: path.join(root, 'drafts') }), adoptGoal: async () => { throw Error('unused'); }, createCase: async () => { throw Error('unused'); } });
  return { root, cases, board, record, rev, projectId, a, b, strategyRef, service, chooseInput, action, observeInput, daily };
}

test('DW-SECOND-01: text revisions preserve omitted assignee/date; explicit null clears, reopen preserves and operation replay is exact', async t => {
  const f = await fixture(t);
  const first = await f.service.saveDecisionRequest(f.record.id, f.chooseInput());
  const update = { operationId: randomUUID(), expectedRevision: f.rev(), requestId: first.requestId, expectedRequestRevision: first.revision, text: '仅改文字', source: { kind: 'agent-tool', ref: 'synthetic/request/edit' } };
  const revised = await f.service.saveDecisionRequest(f.record.id, update);
  assert.deepEqual(revised.assignee, first.assignee); assert.equal(revised.dueDate, first.dueDate);
  assert.deepEqual(await f.service.saveDecisionRequest(f.record.id, update), revised);
  const partial = await f.service.saveDecisionRequest(f.record.id, { ...update, operationId: randomUUID(), expectedRevision: f.rev(), expectedRequestRevision: revised.revision, assignee: { source: '修订声明来源' } });
  assert.deepEqual(partial.assignee, { label: first.assignee.label, source: '修订声明来源' }); assert.equal(partial.dueDate, first.dueDate);
  const clear = await f.service.saveDecisionRequest(f.record.id, { ...update, operationId: randomUUID(), expectedRevision: f.rev(), expectedRequestRevision: partial.revision, assignee: { label: null, source: null }, dueDate: null });
  assert.deepEqual(clear.assignee, { label: null, source: null }); assert.equal(clear.dueDate, undefined);
  f.cases.close(); await f.cases.init();
  assert.deepEqual(f.cases.listDecisionRequests(f.record.id)[0], clear);
});

test('DW-SECOND-02: observation save rejects another issue authorization and legacy mismatch never answers', async t => {
  const f = await fixture(t); const act = f.action(f.a.id);
  const bad = f.observeInput(f.b.id, act);
  await assert.rejects(f.service.saveDecisionRequest(f.record.id, bad), { code: 'case_do_authorization_unavailable' });
  const legacy = f.cases.saveDecisionRequest({ ...bad, caseId: f.record.id } as never);
  await new Promise(r => setTimeout(r, 10));
  f.board.saveFeedback(act.taskId, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: 'A的观察', metricDelta: '', review: '', score: null, respondsToRequest: { requestId: legacy.requestId, revision: legacy.revision, authorizationId: act.authorizationId } });
  assert.equal((await f.service.decisionRequests(f.record.id))[0]!.status, 'unverifiable');
  const home = (await f.daily({ pathname: '/api/workspace/home-pending', method: 'GET' }))!.body as any;
  assert.equal(home.unresolvedRequests[0].status, 'unverifiable'); assert.equal(home.pending.length, 0);
});

test('DW-SECOND-03: one unreadable observation does not taint another issue open request or historical exact answer', async t => {
  const f = await fixture(t); const act = f.action(f.a.id);
  const answered = await f.service.saveDecisionRequest(f.record.id, f.observeInput(f.a.id, act));
  await new Promise(r => setTimeout(r, 10));
  const feedback = f.board.saveFeedback(act.taskId, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '已观察', metricDelta: '', review: '', score: null, respondsToRequest: { requestId: answered.requestId, revision: answered.revision, authorizationId: act.authorizationId } });
  const open = await f.service.saveDecisionRequest(f.record.id, { ...f.observeInput(f.a.id, act), target: { ...f.observeInput(f.a.id, act).target, feedbackBaseRevisionId: feedback.revisionId } });
  const project2 = randomUUID(); f.cases.linkProject({ operationId: randomUUID(), caseId: f.record.id, expectedRevision: f.rev(), projectId: project2 });
  const other = f.action(f.b.id, project2); const unreadable = await f.service.saveDecisionRequest(f.record.id, f.observeInput(f.b.id, other, project2));
  f.cases.unlinkProject({ operationId: randomUUID(), caseId: f.record.id, expectedRevision: f.rev(), projectId: project2 });
  const home = (await f.daily({ pathname: '/api/workspace/home-pending', method: 'GET' }))!.body as any;
  assert.ok(home.pending.some((r: any) => r.requestId === open.requestId));
  assert.ok(!home.unresolvedRequests.some((r: any) => r.requestId === answered.requestId));
  assert.equal(home.unresolvedRequests.find((r: any) => r.requestId === unreadable.requestId).status, 'unverifiable');
});

test('DW-SECOND-04: cancellation immediately before commit rolls back both declaration and operation receipt; cancelled replay remains read-only', async t => {
  for (const feature of ['edge', 'request'] as const) {
    const f = await fixture(t); const operationId = randomUUID();
    const input = feature === 'edge' ? { operationId, expectedRevision: f.rev(), expectedEdgeRevision: 0, fromIssueId: f.a.id, toIssueId: f.b.id, source: { kind: 'user-declaration', ref: 'synthetic' } } : { ...f.chooseInput(), operationId };
    const save = (options?: { assertWritable(): void }) => feature === 'edge' ? f.service.saveIssueEdge(f.record.id, input, options) : f.service.saveDecisionRequest(f.record.id, input, options);
    await assert.rejects(save({ assertWritable() { if (f.cases.getOperation(operationId)?.phase === 'completed') throw Error('cancel-before-commit'); } }), /cancel-before-commit/);
    assert.equal(f.cases.getOperation(operationId), null);
    assert.equal(feature === 'edge' ? f.cases.listIssueEdges(f.record.id).length : f.cases.listDecisionRequests(f.record.id).length, 0);
    const saved = await save(); const revision = f.rev();
    assert.deepEqual(await save({ assertWritable() { throw Error('already cancelled'); } }), saved); assert.equal(f.rev(), revision);
  }
});

test('DW-SECOND-05: Host aggregate revision is captured inside mutation, entity CAS and changed-operation conflicts remain strict', async t => {
  const f = await fixture(t); let tail: Promise<unknown> = Promise.resolve();
  const service = createCaseIssueService({ cases: f.cases, board: f.board, mutate: (fn: () => unknown) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; } } as never);
  const edgeInput = { operationId: randomUUID(), expectedEdgeRevision: 0, fromIssueId: f.a.id, toIssueId: f.b.id, source: { kind: 'user-declaration', ref: 'parallel' } };
  const requestInput = f.chooseInput(); delete (requestInput as { expectedRevision?: number }).expectedRevision;
  const options = { currentCaseRevision: true as const };
  const [edge, request] = await Promise.all([service.saveIssueEdge(f.record.id, edgeInput, options), service.saveDecisionRequest(f.record.id, requestInput, options)]);
  assert.equal(f.cases.listIssueEdges(f.record.id).length, 1); assert.equal(f.cases.listDecisionRequests(f.record.id).length, 1);
  f.cases.updateCase({ operationId: randomUUID(), caseId: f.record.id, expectedRevision: f.rev(), nextStep: '后续合法修改' });
  const revision = f.rev();
  assert.deepEqual(await service.saveDecisionRequest(f.record.id, requestInput, { ...options, assertWritable() { throw Error('cancelled replay'); } }), request);
  assert.deepEqual(await service.saveIssueEdge(f.record.id, edgeInput, options), edge); assert.equal(f.rev(), revision);
  await assert.rejects(service.saveDecisionRequest(f.record.id, { ...requestInput, text: '变更意图' }, options), { code: 'operation_conflict' });
  await assert.rejects(service.saveIssueEdge(f.record.id, { ...edgeInput, operationId: randomUUID(), edgeId: edge.edgeId, expectedEdgeRevision: 0 }, options), { code: 'case_issue_edge_conflict' });
  await assert.rejects(service.saveDecisionRequest(f.record.id, { ...requestInput, operationId: randomUUID(), requestId: request.requestId, expectedRequestRevision: 0 }, options), { code: 'case_decision_request_conflict' });
  await assert.rejects(service.saveDecisionRequest(f.record.id, { ...f.chooseInput(), expectedRevision: revision - 1 }), { code: 'case_revision_conflict' });
});

test('DW-SECOND-06: declarations read exposes exact identities, explicit pagination and current-issue requests without writes', async t => {
  const f = await fixture(t); const first = await f.service.saveDecisionRequest(f.record.id, f.chooseInput());
  await f.service.saveDecisionRequest(f.record.id, f.chooseInput());
  const revision = f.rev();
  const page = await f.service.readDeclarations(f.record.id, f.a.id, { section: 'requests', limit: 1 }) as any;
  assert.equal(page.items[0].requestId, first.requestId); assert.equal(page.items[0].revision, first.revision);
  assert.equal(page.partial, true); assert.equal(page.nextOffset, 1);
  const next = await f.service.readDeclarations(f.record.id, f.a.id, { section: 'requests', offset: page.nextOffset, limit: 1 }) as any;
  assert.equal(next.partial, false); assert.equal(next.nextOffset, null);
  const strategies = await f.service.readDeclarations(f.record.id, f.a.id, { section: 'strategies', limit: 1 }) as any;
  assert.deepEqual(strategies.items[0].strategyRef, f.strategyRef);
  assert.deepEqual((await f.service.readDeclarations(f.record.id, f.b.id, { section: 'requests' }) as any).items, []);
  await assert.rejects(f.service.readDeclarations(f.record.id, f.a.id, { section: 'requests', limit: 21 }), { code: 'invalid_case_declarations_page' });
  await assert.rejects(f.service.readDeclarations(f.record.id, f.a.id, { section: 'requests', caseId: randomUUID() }), { code: 'invalid_case_decision_fields' });
  assert.equal(f.rev(), revision);
});

test('DW-SECOND-07: changing issue round supersedes an unanswered observation and prevents revisions under the old authorization', async t => {
  const f = await fixture(t); const act = f.action(f.a.id);
  const original = f.observeInput(f.a.id, act);
  const request = await f.service.saveDecisionRequest(f.record.id, original);
  const observations = await f.service.readDeclarations(f.record.id, f.a.id, { section: 'observations' }) as any;
  assert.deepEqual(observations.items[0].target, original.target);
  f.action(f.a.id);
  assert.equal((await f.service.decisionRequests(f.record.id))[0]!.status, 'superseded');
  await assert.rejects(f.service.saveDecisionRequest(f.record.id, { operationId: randomUUID(), expectedRevision: f.rev(), requestId: request.requestId, expectedRequestRevision: request.revision, text: '旧轮继续请求', source: { kind: 'agent-tool', ref: 'new/tool' } }), { code: 'case_choice_conflict' });
  assert.deepEqual(await f.service.saveDecisionRequest(f.record.id, original), request, 'completed original operation stays a read-only receipt after round changes');
  assert.throws(() => f.service.saveDecisionRequest(f.record.id, { ...f.chooseInput(), currentCaseRevision: true }), { code: 'invalid_case_decision_fields' });
});

test('DW-SECOND-08: legacy aggregate-revision receipts replay through new Host mode without writes; payload changes still conflict', async t => {
  const f = await fixture(t);
  // Standard mode has the frozen pre-fix Host digest: original aggregate revision and no mode marker.
  const legacyEdgeInput = { operationId: randomUUID(), expectedRevision: f.rev(), fromIssueId: f.a.id, toIssueId: f.b.id, expectedEdgeRevision: 0, source: { kind: 'user-declaration', ref: 'legacy/session/tool' } };
  const edge = await f.service.saveIssueEdge(f.record.id, legacyEdgeInput);
  const original = await f.service.saveDecisionRequest(f.record.id, f.chooseInput());
  const legacyRequestInput = { operationId: randomUUID(), expectedRevision: f.rev(), requestId: original.requestId, expectedRequestRevision: original.revision, text: '旧Host文字修订', source: { kind: 'agent-tool', ref: 'legacy/request/edit' } };
  // The pre-fix service inserted null assignee fields even when its caller omitted them.
  const request = await f.service.saveDecisionRequest(f.record.id, { ...legacyRequestInput, assignee: { label: null, source: null } });
  f.cases.updateCase({ operationId: randomUUID(), caseId: f.record.id, expectedRevision: f.rev(), nextStep: '旧保存后的新工作' });
  f.cases.close(); await f.cases.init(); const revision = f.rev();
  const options = { currentCaseRevision: true as const, assertWritable() { throw Error('no write permitted on replay'); } };
  const { expectedRevision: _edgeRevision, ...edgeReplay } = legacyEdgeInput;
  const { expectedRevision: _requestRevision, ...requestReplay } = legacyRequestInput;
  assert.deepEqual(await f.service.saveIssueEdge(f.record.id, edgeReplay, options), edge);
  assert.deepEqual(await f.service.saveDecisionRequest(f.record.id, requestReplay, options), request);
  await assert.rejects(f.service.saveIssueEdge(f.record.id, { ...edgeReplay, explanation: 'changed' }, options), { code: 'operation_conflict' });
  await assert.rejects(f.service.saveDecisionRequest(f.record.id, { ...requestReplay, text: 'changed' }, options), { code: 'operation_conflict' });
  assert.equal(f.rev(), revision);
});

test('DW-FINAL-AUTH-01: an issue-specific strategy cannot create a choose request for another issue', async t => {
  const f = await fixture(t);
  const strategy = f.cases.acceptIssuePlan({ operationId: randomUUID(), caseId: f.record.id, issueId: f.a.id, title: 'A专属方案', proposal: '仅A', source: { type: 'native-reply', projectId: f.projectId, taskId: randomUUID(), sessionId: 'synthetic', messageId: 'source', expectedTextSha256: 'a'.repeat(64) } });
  const input = { ...f.chooseInput(), issueId: f.b.id, target: { kind: 'choose', strategyRef: { ...f.strategyRef, recordId: strategy.recordId, revision: strategy.revision }, expectedPreviousChoiceId: null } };
  await assert.rejects(f.service.saveDecisionRequest(f.record.id, input), { code: 'case_issue_scope_mismatch' });
  assert.equal(f.cases.getOperation(input.operationId), null);
  assert.equal(chooseRequestStatus(f.cases, { ...input, caseId: f.record.id, lifecycle: 'open' } as never), 'unverifiable', 'historical mismatches do not become pending');
});

test('DW-FINAL-AUTH-02: observation requests require this task current exact feedback baseline', async t => {
  const f = await fixture(t); const action = f.action(f.a.id);
  const input = f.observeInput(f.a.id, action);
  const invalid = { ...input, target: { ...input.target, feedbackBaseRevisionId: randomUUID() } };
  await assert.rejects(f.service.saveDecisionRequest(f.record.id, invalid), { code: 'case_feedback_conflict' });
  assert.equal(await observationRequestStatus(f.cases, f.board, { ...invalid, caseId: f.record.id, lifecycle: 'open' } as never), 'unverifiable');
  const request = await f.service.saveDecisionRequest(f.record.id, input);
  f.board.saveFeedback(action.taskId, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '普通新观察', metricDelta: '', review: '', score: null });
  await assert.rejects(f.service.saveDecisionRequest(f.record.id, { ...f.observeInput(f.a.id, action) }), { code: 'case_feedback_conflict' });
  assert.equal((await f.service.decisionRequests(f.record.id)).find(row => row.requestId === request.requestId)!.status, 'superseded');
});

test('DW-FINAL-AUTH-03: original report-confirmation read authority governs request save, read and per-request home projection', async t => {
  const f = await fixture(t);
  const confirmed = f.board.confirmReportConclusions({ operationId: randomUUID(), projectId: f.projectId, taskId: randomUUID(), reviewId: randomUUID(), report: { relativePath: '060_reports/synthetic.md', sha256: 'a'.repeat(64), bytes: 100, observedSha256: 'a'.repeat(64), observedBytes: 100 }, confirmedBy: 'synthetic-user', conclusions: [{ claimId: 'c1', text: '合成事实', location: 'p1', verdict: 'supported', conditions: [], evidence: [], reason: '仅合成', impact: '观察' }], recommendations: [{ claimId: 'r1', text: '合成建议', location: 'p2', verdict: 'supported', conditions: [], evidence: [], reason: '仅合成', impact: '观察', conclusionClaimIds: ['c1'] }] });
  const item = f.board.decideItem(confirmed.boardItemIds[0]!, { status: 'adopted' });
  const choice = f.cases.chooseStrategy({ operationId: randomUUID(), caseStoreId: f.strategyRef.caseStoreId, caseId: f.record.id, issueId: f.a.id, strategyRef: f.strategyRef, choice: 'trial', expectedPreviousChoiceId: null });
  const action = f.board.arrangeActions({ operationId: randomUUID(), projectId: f.projectId, source: { caseStoreId: f.strategyRef.caseStoreId, caseId: f.record.id, choiceId: choice.choiceId, strategyRef: f.strategyRef }, scope: '观察', title: '原确认来源', checks: [], actions: [{ kind: 'create', itemId: item.id, itemVersion: boardRecordVersion(item), title: '原确认观察' }] }, { confirmedIssueId: f.a.id }).actions[0]!;
  let readable = true, authorityReads = 0;
  const assertBoardItemReadable = async () => { authorityReads++; if (!readable) throw Object.assign(Error('source revoked'), { code: 'confirmation_source_unavailable', statusCode: 409 }); };
  const service = createCaseIssueService({ cases: f.cases, board: f.board, mutate: async (fn: () => unknown) => fn(), assertBoardItemReadable } as never);
  const originalInput = f.observeInput(f.a.id, action);
  const request = await service.saveDecisionRequest(f.record.id, originalInput);
  const normal = await service.saveDecisionRequest(f.record.id, { ...f.chooseInput(), issueId: f.b.id });
  assert.ok(authorityReads > 0); readable = false; authorityReads = 0;
  await assert.rejects(service.saveDecisionRequest(f.record.id, f.observeInput(f.a.id, action)), { code: 'confirmation_source_unavailable' });
  await assert.rejects(service.saveDecisionRequest(f.record.id, { operationId: randomUUID(), expectedRevision: f.rev(), requestId: request.requestId, expectedRequestRevision: request.revision, text: '修订仍核原权威', source: originalInput.source }), { code: 'confirmation_source_unavailable' });
  assert.deepEqual(await service.saveDecisionRequest(f.record.id, originalInput), request, 'historical completed replay does not reread newly revoked sources or write');
  assert.equal((await service.decisionRequests(f.record.id)).find(row => row.requestId === request.requestId)!.status, 'unverifiable');
  const routes = createWorkspaceDailyRoutes({ cases: f.cases, board: f.board, assertBoardItemReadable, drafts: createWorkspaceDraftStore({ root: f.root }), adoptGoal: async () => { throw Error('unused'); }, createCase: async () => { throw Error('unused'); } } as never);
  const home = (await routes({ pathname: '/api/workspace/home-pending', method: 'GET' }))!.body as any;
  assert.deepEqual(home.pending.map((row: any) => row.requestId), [normal.requestId]); assert.equal(home.unresolvedRequests[0].status, 'unverifiable'); assert.ok(authorityReads >= 3);
});

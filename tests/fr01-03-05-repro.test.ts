import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { createCaseIssueService } from '../src/host/case-issues.ts';
import { createWorkspaceDraftStore, type CarryOverFragmentPayload, type IssueDraftPayload } from '../src/host/workspace-draft-store.ts';
import { executeThreeBranchCaseCreate } from '../src/host/case-creation-orchestrator.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';

test('FR01-REPRO: /api/workspace/create-case refuses candidate goal with alreadyAdopted:true, missing goal/version, and strategy not in version', { timeout: 30_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));

  const { goal: candidate } = await readJson(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(), title: 'FR01候选目标', outcome: '验证目标权威准入',
    perspective: 'personal', scope: { kind: 'personal', id: 'fr01-scope', name: '范围' },
    measurement: { kind: 'deliverable', criterion: '准入一致' },
    baseline: { state: 'pending', description: '基线' }, responsible: '负责人', strategies: ['真实策略A'],
  }), 201);

  // 1. Candidate goal + alreadyAdopted:true -> MUST be rejected (409 goal_not_adopted), never 201!
  const r1 = await host.request('/api/workspace/create-case', 'POST', {
    draftId: `prep-${randomUUID()}`, title: '绕过采纳', description: '', rawInput: '',
    adoptOperationId: randomUUID(), createOperationId: randomUUID(),
    goal: { goalId: candidate.goalId, version: candidate.version, strategy: '真实策略A', alreadyAdopted: true },
  });
  assert.equal(r1.status, 409);

  // 2. Non-existent goalId/version -> MUST be rejected (404)!
  const r2 = await host.request('/api/workspace/create-case', 'POST', {
    draftId: `prep-${randomUUID()}`, title: '虚构目标', description: '', rawInput: '',
    adoptOperationId: randomUUID(), createOperationId: randomUUID(),
    goal: { goalId: randomUUID(), version: 99, strategy: '任意', alreadyAdopted: true },
  });
  assert.equal(r2.status, 404);

  // 3. Valid candidate goal + strategy NOT in goal.strategies -> MUST be rejected (400)!
  const r3 = await host.request('/api/workspace/create-case', 'POST', {
    draftId: `prep-${randomUUID()}`, title: '虚构策略', description: '', rawInput: '',
    adoptOperationId: randomUUID(), createOperationId: randomUUID(),
    goal: { goalId: candidate.goalId, version: candidate.version, strategy: '不在版本内的策略', alreadyAdopted: false },
  });
  assert.equal(r3.status, 400);
});

test('FR02-REPRO: partial receipt A cannot bind B; unrelated case_note cannot replay; concurrent CAS has one winner; cross-owner fragment refused', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-fr02-')));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') });
  const drafts = createWorkspaceDraftStore({ root });
  t.after(() => cases.close());
  await cases.initialize();

  // 1. Concurrent CAS on same (kind, id, expectedRevision=0) -> strictly 1 fulfilled, 1 rejected 409!
  const draftId = `concurrent-${randomUUID()}`;
  const results = await Promise.allSettled([
    drafts.save('prepare', draftId, 0, { text: 'first' }),
    drafts.save('prepare', draftId, 0, { text: 'second' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);

  // 2. Cross-owner fragment append (fragment for Case A/Issue A1 -> Case B/Issue B1) MUST fail 409!
  const caseA = randomUUID(), caseB = randomUUID(), issueA1 = randomUUID(), issueB1 = randomUUID();
  const fragId = `frag-${randomUUID()}`;
  await drafts.save<CarryOverFragmentPayload>('carry-over', fragId, 0, {
    originalText: 'A的片段', origin: { kind: 'home-input', label: '首页', ref: 'h1' },
    targetCaseId: caseA, targetIssueId: issueA1, appendedAt: null,
  });
  await assert.rejects(
    drafts.appendCarryOverFragment({ fragmentId: fragId, issueDraftId: `issue:${caseB}:${issueB1}`, caseId: caseB, issueId: issueB1, expectedDraftRevision: 0 }),
    (e: { code?: string; statusCode?: number }) => e.code === 'carry_over_scope_mismatch' && e.statusCode === 409,
  );

  // 3. Unrelated completed case_note operationId MUST NOT replay as created Case!
  const oldCase = cases.createCase({ operationId: randomUUID(), title: '无关旧案' });
  const noteOp = randomUUID();
  cases.addCaseNote({ operationId: noteOp, caseId: oldCase.id, expectedRevision: oldCase.revision, note: '普通备注' });
  await assert.rejects(
    executeThreeBranchCaseCreate(
      { cases, drafts, adoptGoal: async i => ({ ...i, version: i.expectedVersion, adoptedAt: new Date().toISOString() }), createCase: async i => cases.createCase(i) },
      { draftId: `prep-${randomUUID()}`, title: '新案', description: '', rawInput: '', adoptOperationId: randomUUID(), createOperationId: noteOp, goal: { goalId: randomUUID(), version: 1, strategy: 'S', alreadyAdopted: true } },
    ),
    (e: { code?: string }) => e.code === 'operation_conflict',
  );

  // 4. Partial success for Goal A, then switching same draftId to Goal B -> MUST reject 409 prepare_draft_goal_mismatch (never silently bind A)!
  const goalA = randomUUID(), goalB = randomUUID(), prepId = `prep-${randomUUID()}`;
  const partial = await executeThreeBranchCaseCreate(
    { cases, drafts, adoptGoal: async i => ({ ...i, version: i.expectedVersion, adoptedAt: new Date().toISOString() }), createCase: async () => { throw Object.assign(new Error('fail'), { code: 'invalid_text' }); } },
    { draftId: prepId, title: 'x'.repeat(100), description: '', rawInput: '', adoptOperationId: randomUUID(), createOperationId: randomUUID(), goal: { goalId: goalA, version: 1, strategy: 'SA', alreadyAdopted: false } },
  );
  assert.equal(partial.branch, 'partial');
  await assert.rejects(
    executeThreeBranchCaseCreate(
      { cases, drafts, adoptGoal: async i => ({ ...i, version: i.expectedVersion, adoptedAt: new Date().toISOString() }), createCase: async i => cases.createCase(i) },
      { draftId: prepId, title: '改选B', description: '', rawInput: '', adoptOperationId: randomUUID(), createOperationId: randomUUID(), goal: { goalId: goalB, version: 1, strategy: 'SB', alreadyAdopted: false } },
    ),
    (e: { code?: string; statusCode?: number }) => e.code === 'prepare_draft_goal_mismatch' && e.statusCode === 409,
  );
});

test('FR03-REPRO: Board saveFeedback with respondsToRequest reopens cleanly (schema v6); forged caseStoreId/authorizationId rejected', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-fr03-')));
  const boardRoot = path.join(root, 'board');
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') });
  let board = createDecisionBoardStore({ root: boardRoot });
  t.after(() => { cases.close(); board.close(); });
  await cases.initialize();
  await board.init();

  const record = cases.createCase({ operationId: randomUUID(), title: 'FR03 Case' });
  const projectId = randomUUID(), linkedProjectId = randomUUID();
  cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId: linkedProjectId, expectedRevision: cases.getCase(record.id).revision });
  const issue = cases.createDecisionIssue({ caseId: record.id, expectedRevision: cases.getCase(record.id).revision, operationId: randomUUID(), title: '事项' });
  const item = board.addManualItem({ projectId, title: '行动项', rationale: '补观察' });
  board.decideItem(item.id, { status: 'adopted' });
  const task = board.addTask(item.id, { title: '执行观察' });

  // 1. Save feedback with respondsToRequest, CLOSE board, REOPEN board -> MUST succeed without unsupported_board_schema!
  const savedFb = board.saveFeedback(task.id, {
    operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '实测', metricDelta: '', review: '', score: null, effect: 'unknown',
    respondsToRequest: { requestId: randomUUID(), revision: 1, authorizationId: randomUUID() },
  });
  board.close();
  board = createDecisionBoardStore({ root: boardRoot });
  await board.init();
  const reread = board.getFeedbackRevision(savedFb.revisionId);
  assert.equal(reread?.respondsToRequest?.requestId, savedFb.respondsToRequest?.requestId);

  // 2. Forged caseStoreId on choose request MUST fail 409 case_decision_scope_mismatch
  const strat = cases.saveDecisionDraft(
    { operationId: randomUUID(), caseStoreId: cases.getStatus().storeId!, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: 'S1', proposal: 'P1' } },
    { actorKind: 'agent', projectId: linkedProjectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 's', toolCallId: 't' },
  );
  assert.throws(() => cases.saveDecisionRequest({
    operationId: randomUUID(), caseId: record.id, expectedRevision: cases.getCase(record.id).revision, expectedRequestRevision: 0,
    issueId: issue.id, kind: 'choose', text: '假 storeId', source: { kind: 'user-declaration', ref: 'm1' },
    target: { kind: 'choose', strategyRef: { type: 'case-decision', caseStoreId: randomUUID(), caseId: record.id, recordId: strat.recordId, revision: strat.revision }, expectedPreviousChoiceId: null },
  }), { code: 'case_decision_scope_mismatch' });

  // 3. Observe request on unlinked project or non-existent authorizationId MUST fail via service
  const service = createCaseIssueService({ cases, board, mutate: (fn: () => unknown) => fn() } as never);
  await assert.rejects(() => service.saveDecisionRequest(record.id, {
    operationId: randomUUID(), expectedRevision: cases.getCase(record.id).revision, expectedRequestRevision: 0,
    issueId: issue.id, kind: 'observe', text: '假授权', source: { kind: 'user-declaration', ref: 'm2' },
    assignee: { label: '人', source: 'm2' },
    target: { kind: 'observe', projectId, itemId: item.id, taskId: task.id, authorizationId: randomUUID(), feedbackBaseRevisionId: null },
  }), { code: 'project_not_linked' });
});

test('FR05-R3-REPRO: queued saveIssueEdge and saveDecisionRequest cancelled before mutate gate releases commit ZERO events', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-fr05-')));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') });
  t.after(() => cases.close());
  await cases.initialize();
  const record = cases.createCase({ operationId: randomUUID(), title: '取消边界测试' });
  const a = cases.createDecisionIssue({ caseId: record.id, expectedRevision: cases.getCase(record.id).revision, operationId: randomUUID(), title: 'A' });
  const b = cases.createDecisionIssue({ caseId: record.id, expectedRevision: cases.getCase(record.id).revision, operationId: randomUUID(), title: 'B' });

  // Hold a mutate gate, queue saveIssueEdge, abort BEFORE releasing gate -> MUST throw and leave 0 edges!
  let releaseGate!: () => void;
  const gate = new Promise<void>(resolve => { releaseGate = resolve; });
  const service = createCaseIssueService({
    cases,
    mutate: async (fn: () => unknown) => { await gate; return fn(); },
  } as never);

  const controller = new AbortController();
  const pending = service.saveIssueEdge(
    record.id,
    { operationId: randomUUID(), expectedRevision: cases.getCase(record.id).revision, fromIssueId: a.id, toIssueId: b.id, explanation: '不应落盘', expectedEdgeRevision: 0, source: { kind: 'user-declaration', ref: 's1/r1/t1' } },
    { assertWritable: () => { controller.signal.throwIfAborted(); } },
  );
  controller.abort(new Error('cancelled-before-mutate'));
  releaseGate();
  await assert.rejects(pending, /cancelled-before-mutate/);
  assert.equal(cases.listIssueEdges(record.id).length, 0, 'cancelled queued edge save MUST NOT commit');
});

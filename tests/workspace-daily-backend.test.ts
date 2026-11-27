import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { createWorkspaceDraftStore, type CarryOverFragmentPayload, type IssueDraftPayload } from '../src/host/workspace-draft-store.ts';
import { executeThreeBranchCaseCreate } from '../src/host/case-creation-orchestrator.ts';
import { listVisibleCaseDirectory } from '../src/host/case-directory.ts';
import { createWorkspaceDailyRoutes } from '../src/host/workspace-daily-routes.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-dw-daily-')));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') });
  const drafts = createWorkspaceDraftStore({ root });
  t.after(async () => { cases.close(); });
  await cases.initialize();
  return { root, cases, drafts };
}

test('DW12/DW13-DRAFT-01: drafts persist across reopen, CAS conflict keeps input, fragment append is idempotent & non-overwriting, discard is scoped', async t => {
  const f = await fixture(t);
  const caseId = randomUUID();
  const issueId = randomUUID();
  const draftId = `issue:${caseId}:${issueId}`;
  const fragId = `frag-${randomUUID()}`;

  const d1 = await f.drafts.save<IssueDraftPayload>('issue-draft', draftId, 0, {
    caseId, issueId, text: '已有未发送草稿', appendedFragmentIds: [],
  });
  // Stale revision conflict returns 409 without overwriting existing draft.
  await assert.rejects(
    f.drafts.save<IssueDraftPayload>('issue-draft', draftId, 0, { caseId, issueId, text: '冲突内容', appendedFragmentIds: [] }),
    (e: { code?: string; statusCode?: number }) => e.code === 'draft_revision_conflict' && e.statusCode === 409,
  );
  assert.equal((await f.drafts.read<IssueDraftPayload>('issue-draft', draftId))!.payload.text, '已有未发送草稿');

  // Create carry-over fragment and append twice -> appends once without overwriting, preserves original & origin.
  await f.drafts.save<CarryOverFragmentPayload>('carry-over', fragId, 0, {
    originalText: '首页新记的一句话',
    origin: { kind: 'home-input', label: '工作台首页轻输入', ref: 'home-1' },
    targetCaseId: caseId, targetIssueId: issueId, appendedAt: null,
  });
  const first = await f.drafts.appendCarryOverFragment({ fragmentId: fragId, issueDraftId: draftId, caseId, issueId, expectedDraftRevision: d1.revision });
  assert.equal(first.alreadyAppended, false);
  assert.equal(first.draft.payload.text, '已有未发送草稿\n\n首页新记的一句话');
  assert.equal(first.fragment.payload.originalText, '首页新记的一句话');
  assert.equal(first.fragment.payload.origin.label, '工作台首页轻输入');
  assert.ok(first.fragment.payload.appendedAt);

  const second = await f.drafts.appendCarryOverFragment({ fragmentId: fragId, issueDraftId: draftId, caseId, issueId, expectedDraftRevision: first.draft.revision });
  assert.equal(second.alreadyAppended, true);
  assert.equal(second.draft.payload.text, '已有未发送草稿\n\n首页新记的一句话');

  // Reopen store from same root -> data persists.
  const reopened = createWorkspaceDraftStore({ root: f.root });
  assert.equal((await reopened.read<IssueDraftPayload>('issue-draft', draftId))!.payload.text, '已有未发送草稿\n\n首页新记的一句话');

  // Explicit discard clears only the specified draft, leaving the fragment intact.
  await reopened.discard('issue-draft', draftId);
  assert.equal(await reopened.read('issue-draft', draftId), null);
  assert.ok(await reopened.read('carry-over', fragId));
});

test('DW11/DW14-CREATE-02: three creation branches, partial success adoption receipt preservation, and idempotent retry', async t => {
  const f = await fixture(t);
  const goalId = randomUUID();
  let adoptCalls = 0;
  let shouldFailCreate = true;

  const adoptGoal = async (input: { operationId: string; goalId: string; expectedVersion: number; strategy: string }) => {
    adoptCalls++;
    return { goalId: input.goalId, version: input.expectedVersion, strategy: input.strategy, adoptedAt: new Date().toISOString() };
  };
  const createCase = async (input: { operationId: string; title: string; description: string; goalBinding: import('../src/host/case-types.ts').CaseGoalBindingInput }) => {
    if (shouldFailCreate) throw Object.assign(new Error('dropped'), { code: 'response_dropped' });
    return f.cases.createCase(input);
  };

  const draftId = `prep-${randomUUID()}`;
  const adoptOp = randomUUID();
  const createOp = randomUUID();

  // Branch 3 partial unknown: adopt succeeds, create drops response -> keeps adoptionReceipt & exact goal version.
  const partial = await executeThreeBranchCaseCreate(
    { cases: f.cases, drafts: f.drafts, adoptGoal, createCase },
    {
      draftId, title: '华东会员复购', description: '原始背景', rawInput: '会员复购下滑',
      goal: { goalId, version: 2, strategy: '聚焦高价值会员分层召回', alreadyAdopted: false },
      adoptOperationId: adoptOp, createOperationId: createOp,
    },
  );
  assert.equal(partial.branch, 'partial');
  assert.equal(partial.createStatus, 'unknown');
  assert.equal(adoptCalls, 1);
  assert.equal(partial.adoptionReceipt?.goalId, goalId);
  assert.equal(partial.adoptionReceipt?.version, 2);

  // Retry after failure: does NOT re-adopt, completes Case creation.
  shouldFailCreate = false;
  const completed = await executeThreeBranchCaseCreate(
    { cases: f.cases, drafts: f.drafts, adoptGoal, createCase },
    {
      draftId, title: '华东会员复购', description: '原始背景', rawInput: '会员复购下滑',
      goal: { goalId, version: 2, strategy: '聚焦高价值会员分层召回', alreadyAdopted: false },
      adoptOperationId: adoptOp, createOperationId: createOp,
    },
  );
  assert.equal(completed.branch, 'created');
  assert.equal(adoptCalls, 1, 'must NOT re-adopt on retry');
  assert.equal(completed.replayedFromOperation, false);

  // Retry again with same createOperationId: finds completed receipt, never duplicates Case.
  const replayed = await executeThreeBranchCaseCreate(
    { cases: f.cases, drafts: f.drafts, adoptGoal, createCase },
    {
      draftId, title: '华东会员复购', description: '原始背景', rawInput: '会员复购下滑',
      goal: { goalId, version: 2, strategy: '聚焦高价值会员分层召回', alreadyAdopted: false },
      adoptOperationId: adoptOp, createOperationId: createOp,
    },
  );
  assert.equal(replayed.branch, 'created');
  assert.equal(replayed.replayedFromOperation, true);
  assert.equal(replayed.createdCase.id, completed.createdCase.id);

  // Branch 1: new draft with SAME exact G/S -> 'continue' returning existing Case, never creates duplicate.
  const cont = await executeThreeBranchCaseCreate(
    { cases: f.cases, drafts: f.drafts, adoptGoal, createCase },
    {
      draftId: `prep-${randomUUID()}`, title: '换个标题尝试绕过', description: '新补充背景', rawInput: '新输入',
      goal: { goalId, version: 2, strategy: '聚焦高价值会员分层召回', alreadyAdopted: true },
      adoptOperationId: randomUUID(), createOperationId: randomUUID(),
    },
  );
  assert.equal(cont.branch, 'continue');
  assert.equal(cont.existingCase.id, completed.createdCase.id);
  assert.equal(cont.isClosed, false);
  assert.equal(cont.preservedDraft.payload.title, '换个标题尝试绕过');

  // Closed Case: still returns 'continue' with isClosed=true, never auto-reopens.
  f.cases.closeCase({ operationId: randomUUID(), caseId: completed.createdCase.id, expectedRevision: f.cases.getCase(completed.createdCase.id).revision, closeReason: '阶段结束' });
  const closedCont = await executeThreeBranchCaseCreate(
    { cases: f.cases, drafts: f.drafts, adoptGoal, createCase },
    {
      draftId: `prep-${randomUUID()}`, title: '再试', description: '', rawInput: '新输入',
      goal: { goalId, version: 2, strategy: '聚焦高价值会员分层召回', alreadyAdopted: true },
      adoptOperationId: randomUUID(), createOperationId: randomUUID(),
    },
  );
  assert.equal(closedCont.branch, 'continue');
  assert.equal(closedCont.isClosed, true);
  assert.equal(f.cases.getCase(completed.createdCase.id).status, 'closed');
});

test('DW10-DIR-03: bounded read-only Case directory and daily routes work end-to-end', async t => {
  const f = await fixture(t);
  const c1 = f.cases.createCase({ operationId: randomUUID(), title: '华东扩围' });
  const i1 = f.cases.createDecisionIssue({ caseId: c1.id, expectedRevision: c1.revision, operationId: randomUUID(), title: '门店筛选' });
  const dir = listVisibleCaseDirectory(f.cases, { limit: 10 });
  assert.equal(dir.storeState, 'ready');
  assert.equal(dir.items.length, 1);
  assert.equal(dir.items[0]!.caseId, c1.id);
  assert.equal(dir.items[0]!.issues[0]!.issueId, i1.id);

  const routes = createWorkspaceDailyRoutes({
    cases: f.cases, drafts: f.drafts,
    adoptGoal: async i => ({ ...i, version: i.expectedVersion, adoptedAt: new Date().toISOString() }),
    createCase: async i => f.cases.createCase(i),
  });
  const gotDir = await routes({ pathname: '/api/workspace/case-directory', method: 'GET' });
  assert.equal((gotDir!.body as { items: unknown[] }).items.length, 1);
  const gotHome = await routes({ pathname: '/api/workspace/home-pending', method: 'GET' });
  assert.equal((gotHome!.body as { pendingHeading: string }).pendingHeading, '待处理事项');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { createWorkspaceDraftStore } from '../src/host/workspace-draft-store.ts';
import { executeThreeBranchCaseCreate } from '../src/host/case-creation-orchestrator.ts';

test('DW14: creation recovery uses the immutable operation after later Case edits', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'case-recovery-'));
  const cases = new CaseStore({ dataRoot: root });
  await cases.initialize();
  t.after(() => cases.close());
  const drafts = createWorkspaceDraftStore({ root });
  const input = { draftId: randomUUID(), title: '原名称', description: '原背景', rawInput: '原输入',
    goal: { goalId: randomUUID(), version: 1, strategy: '原策略', alreadyAdopted: true },
    adoptOperationId: randomUUID(), createOperationId: randomUUID() };
  let goalReadable=true;
  const deps = { cases, drafts, readGoal:async()=>{if(!goalReadable)throw Error('goal changed after original create');return {...input.goal,status:'adopted',strategies:[input.goal.strategy]};}, adoptGoal: async () => { throw Error('must not adopt'); }, createCase: async (value: Parameters<CaseStore['createCase']>[0]) => cases.createCase(value) };
  const created = await executeThreeBranchCaseCreate(deps, input);
  assert.equal(created.branch, 'created');
  if (created.branch !== 'created') return;
  cases.updateCase({ caseId: created.createdCase.id, expectedRevision: created.createdCase.revision,
    operationId: randomUUID(), title: '后来改名', description: '后来背景' });
  goalReadable=false;
  const recovered = await executeThreeBranchCaseCreate(deps, input);
  assert.equal(recovered.branch, 'created');
  if (recovered.branch !== 'created') return;
  assert.equal(recovered.replayedFromOperation, true);
  assert.equal(recovered.createdCase.id, created.createdCase.id);
  await assert.rejects(executeThreeBranchCaseCreate(deps, { ...input, title: '后来改名', description: '后来背景' }), { code: 'operation_conflict' });
  assert.equal(cases.getCase(created.createdCase.id).title, '后来改名');
  assert.equal(cases.listCases().length, 1);
});

test('DW14: an uncertain CaseStore commit stays UNKNOWN and retains original operation identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'case-unknown-'));
  const cases = new CaseStore({ dataRoot: root });
  await cases.initialize();
  t.after(() => cases.close());
  const input = { draftId: randomUUID(), title: '名称', description: '', rawInput: '输入',
    goal: { goalId: randomUUID(), version: 1, strategy: '策略', alreadyAdopted: true },
    adoptOperationId: randomUUID(), createOperationId: randomUUID() };
  const result = await executeThreeBranchCaseCreate({ cases, drafts: createWorkspaceDraftStore({ root }),
    adoptGoal: async () => { throw Error('must not adopt'); },
    createCase: async () => { throw Object.assign(Error('commit unknown'), { code: 'case_transaction_outcome_unknown', statusCode: 503 }); } }, input);
  assert.equal(result.branch, 'partial');
  if (result.branch !== 'partial') return;
  assert.equal(result.createStatus, 'unknown');
  assert.equal(result.draft.payload.creationState, 'partial_unknown');
  assert.equal(result.createOperationId, input.createOperationId);
});

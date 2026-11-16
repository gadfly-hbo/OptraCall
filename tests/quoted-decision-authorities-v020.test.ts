import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { boardRecordVersion, createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = '选择小范围试点；只授权门店甲本周发券，不代表已经执行。';
const provenance = () => ({ schemaVersion: 1, projectId: randomUUID(), taskId: randomUUID(), requestId: randomUUID(), sessionId: 'synthetic-native', toolCallId: 'quoted-call', originalUserTextSha256: sha(text), quote: { start: 0, end: text.length, text } });
async function fixture(t: import('node:test').TestContext) {
  const directory = path.resolve('.local/overall-architecture-upgrade/development/quoted-decisions'); await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'authorities-')), cases = new CaseStore({ dataRoot: path.join(root, 'cases') }), board = createDecisionBoardStore({ root: path.join(root, 'board') });
  await cases.initialize(); await board.init(); t.after(() => { cases.close(); board.close(); }); t.diagnostic(root);
  const record = cases.createCase({ operationId: randomUUID(), title: 'Synthetic strategy decision' }), caseStoreId = cases.getStatus().storeId!;
  const projectId = randomUUID(); cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: record.revision });
  const origin = { actorKind: 'agent' as const, projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 'synthetic-origin', toolCallId: 'synthetic-origin-tool' };
  const draft = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '小范围试点', proposal: '先观察门店甲的适用性。' } }, origin);
  const strategyRef = { type: 'case-decision' as const, caseStoreId, caseId: record.id, recordId: draft.recordId, revision: draft.revision };
  return { root, cases, board, record, strategyRef };
}

test('A15 Case choice stores Host quote provenance separately from reason and preserves old choices', async t => {
  const f = await fixture(t), quoted = provenance(), input = { operationId: randomUUID(), caseStoreId: f.strategyRef.caseStoreId, caseId: f.record.id, strategyRef: f.strategyRef, choice: 'trial' as const, reason: '先核适用性', expectedPreviousChoiceId: null };
  const old = f.cases.chooseStrategy(input); assert.equal('quoteProvenance' in old, false);
  const chosen = f.cases.chooseStrategy({ ...input, operationId: randomUUID(), expectedPreviousChoiceId: old.choiceId }, { quoteProvenance: quoted } as any);
  assert.deepEqual((chosen as any).quoteProvenance, quoted);
  assert.deepEqual((f.cases.getStrategyChoice(f.record.id, chosen.choiceId) as any).quoteProvenance, quoted);
  assert.equal(chosen.reason, '先核适用性'); assert.equal('quoteProvenance' in f.cases.getStrategyChoice(f.record.id, old.choiceId), false);
});

test('A16 authorization is a separate immutable Board event with exact versions, CAS and request replay', async t => {
  const f = await fixture(t), quoted = provenance();
  const item = f.board.addManualItem({ projectId: quoted.projectId, title: '门店甲发券', rationale: '合成行动' }); f.board.decideItem(item.id, { status: 'adopted' });
  const task = f.board.addTask(item.id, { title: '本周发券', note: '尚未执行' }), current = f.board.getItem(item.id);
  const input = { operationId: randomUUID(), projectId: quoted.projectId, itemId: item.id, taskId: task.id, itemVersion: boardRecordVersion(current), taskVersion: boardRecordVersion(task), expectedPreviousAuthorizationId: null,
    decision: 'authorize', scope: '门店甲本周发券', source: { caseStoreId: f.strategyRef.caseStoreId, caseId: f.record.id, strategyRef: f.strategyRef, choiceId: randomUUID() }, quoteProvenance: quoted };
  assert.deepEqual((f.board as any).listActionAuthorizations(task.id), [], 'old adopted items never imply authority');
  const authorization = (f.board as any).recordActionAuthorization(input);
  assert.equal(authorization.decision, 'authorize'); assert.deepEqual(authorization.itemSnapshot, current); assert.deepEqual(authorization.taskSnapshot, task);
  assert.deepEqual((f.board as any).recordActionAuthorization(input), authorization);
  assert.throws(() => (f.board as any).recordActionAuthorization({ ...input, operationId: randomUUID(), scope: 'another scope' }), /authorization_revision_conflict/);
  assert.throws(() => (f.board as any).recordActionAuthorization({ ...input, scope: 'another scope' }), /authorization_operation_conflict/);
  const revoked = (f.board as any).recordActionAuthorization({ ...input, operationId: randomUUID(), expectedPreviousAuthorizationId: authorization.authorizationId, decision: 'revoke' });
  assert.equal(revoked.previousAuthorizationId, authorization.authorizationId); assert.equal((f.board as any).listActionAuthorizations(task.id).length, 2);
  assert.equal(f.board.getTask(task.id).status, 'todo'); assert.equal(f.board.listFeedbackHistory(task.id).length, 0);
  f.board.setTaskStatus(task.id, 'doing');
  assert.throws(() => (f.board as any).recordActionAuthorization({ ...input, operationId: randomUUID(), expectedPreviousAuthorizationId: revoked.authorizationId }), /authorization_source_changed/);
  assert.equal((f.board as any).listActionAuthorizations(task.id).length, 2);
});

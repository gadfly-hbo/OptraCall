import test from 'node:test';
import assert from 'node:assert/strict';
import { settledCaseRelation } from '../src/host/ui/case-star-map-recovery.ts';
import type { CaseRelationIntent } from '../src/host/ui/case-star-map-recovery.ts';
import type { OperationReceipt } from '../src/host/case-types.ts';
import type { CaseRelationRevision } from '../src/host/ui/case-relations-client.ts';

const intent: CaseRelationIntent = { toCaseId: 'target', relationId: 'relation', input: { operationId: 'original-operation', caseStoreId: 'store', fromCaseId: 'source', kind: 'supports', expectedRelationRevision: 1, explanation: '固定原意图', targetScope: '目标策略' } };
const revision: CaseRelationRevision = { caseStoreId: 'store', relationId: 'relation', revision: 2, fromCaseId: 'source', toCaseId: 'target', kind: 'supports', lifecycle: 'active', explanation: '固定原意图', targetScope: '目标策略', targetRef: null, sources: [], assertionNature: 'explicit', changeReason: null, origin: { actorKind: 'user', projectId: null, taskId: null, requestId: null, sessionId: null, toolCallId: null }, createdAt: '2026-11-14T00:00:00.000Z', operationId: 'original-operation' };
const receipt = (patch: Partial<OperationReceipt> = {}): OperationReceipt => ({ operationId: intent.input.operationId, kind: 'case_relation_save', requestSha256: 'fixed', caseId: 'target', projectId: null, phase: 'completed', result: revision as unknown as Record<string, unknown>, createdAt: revision.createdAt, updatedAt: revision.createdAt, ...patch });

test('UNKNOWN settles from the original completed relation receipt, including a restricted successful projection', () => {
  assert.equal(settledCaseRelation(receipt(), intent), revision);
  const restricted = { ...revision, restricted: true, explanation: '范围受限', sources: [] };
  assert.equal(settledCaseRelation(receipt({ result: restricted as unknown as Record<string, unknown> }), intent), restricted);
});

test('another operation, owner, store, endpoint, type, revision identity or lifecycle never settles retained intent', () => {
  assert.equal(settledCaseRelation(null, intent), null);
  for (const patch of [{ operationId: 'other' }, { kind: 'case_decision_save' }, { caseId: 'other' }, { phase: 'needs_review' as const }]) assert.equal(settledCaseRelation(receipt(patch), intent), null);
  for (const patch of [{ relationId: 'other' }, { caseStoreId: 'other' }, { fromCaseId: 'other' }, { toCaseId: 'other' }, { kind: 'follows_up' as const }, { revision: '2' }, { lifecycle: 'unlinked' as const }]) assert.equal(settledCaseRelation(receipt({ result: { ...revision, ...patch } }), intent), null);
  assert.equal(settledCaseRelation(receipt(), { ...intent, input: { ...intent.input, action: 'unlink' } }), null);
  assert.equal(settledCaseRelation(receipt({ result: { ...revision, lifecycle: 'unlinked' } }), { ...intent, input: { ...intent.input, action: 'unlink' } })?.lifecycle, 'unlinked');
});

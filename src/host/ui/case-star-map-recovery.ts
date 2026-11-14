import type { OperationReceipt } from '../case-types.ts';
import type { CaseRelationRevision, CaseRelationWrite } from './case-relations-client.ts';

export type CaseRelationIntent = { toCaseId: string; relationId?: string; input: CaseRelationWrite };

/** Only a completed receipt for the retained business intent can settle UNKNOWN. */
export function settledCaseRelation(operation: OperationReceipt | null, intent: CaseRelationIntent): CaseRelationRevision | null {
  if (!operation || operation.kind !== 'case_relation_save' || operation.operationId !== intent.input.operationId || operation.caseId !== intent.toCaseId || operation.phase !== 'completed') return null;
  const revision = operation.result as unknown as CaseRelationRevision | null;
  if (!revision || revision.lifecycle !== (intent.input.action === 'unlink' ? 'unlinked' : 'active')) return null;
  return typeof revision.relationId === 'string' && Number.isInteger(revision.revision) && revision.revision > 0 && revision.toCaseId === intent.toCaseId && revision.fromCaseId === intent.input.fromCaseId && revision.kind === intent.input.kind && revision.caseStoreId === intent.input.caseStoreId && (!intent.relationId || revision.relationId === intent.relationId) ? revision : null;
}

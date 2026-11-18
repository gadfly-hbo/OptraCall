import { CaseStoreError } from './case-types.ts';
import { parseCaseDecisionRef, caseDecisionId, caseDecisionRevision, caseDecisionText } from './case-decision-validation.ts';
import type { CaseRelationSource, CaseRelationWriteInput } from './case-relation-types.ts';
import { learningSourceRef } from './learning-source-validation.ts';

export function relationFields(value: unknown, allowed: string[], required: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) throw new CaseStoreError('invalid_case_relation_fields');
}
export function parseCaseRelationSource(value: unknown): CaseRelationSource {
  if (!value || typeof value !== 'object') throw new CaseStoreError('invalid_case_relation_source');
  const ref = value as Record<string, unknown>;
  if (ref.type === 'case-decision' || ref.type === 'case-choice') {
    const source = learningSourceRef(ref);
    if (source.type === 'case-decision' || source.type === 'case-choice') return source;
    throw new CaseStoreError('invalid_case_relation_source');
  }
  if (ref.type === 'case-artifact') {
    relationFields(ref, ['type', 'caseStoreId', 'caseId', 'artifactId', 'observedSha256'], ['type', 'caseStoreId', 'caseId', 'artifactId', 'observedSha256']);
    if (ref.observedSha256 !== null && (typeof ref.observedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.observedSha256))) throw new CaseStoreError('invalid_case_relation_source');
    return { type: 'case-artifact', caseStoreId: caseDecisionId(ref.caseStoreId), caseId: caseDecisionId(ref.caseId), artifactId: caseDecisionId(ref.artifactId), observedSha256: ref.observedSha256 as string | null };
  }
  throw new CaseStoreError('invalid_case_relation_source');
}
export const relationWriteFields = ['operationId', 'caseStoreId', 'toCaseId', 'relationId', 'fromCaseId', 'kind', 'expectedRelationRevision', 'action', 'explanation', 'targetScope', 'targetRef', 'sources', 'assertionNature', 'changeReason'];
export function parseCaseRelationWrite(value: unknown): CaseRelationWriteInput {
  relationFields(value, relationWriteFields, ['operationId', 'caseStoreId', 'toCaseId', 'expectedRelationRevision']);
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new CaseStoreError('case_relation_input_too_large');
  const action = value.action ?? 'save';
  if (!['save', 'unlink', 'restore'].includes(String(action)) || value.kind !== undefined && !['follows_up', 'supports'].includes(String(value.kind)) || value.assertionNature !== undefined && !['explicit', 'inferred'].includes(String(value.assertionNature))) throw new CaseStoreError('invalid_case_relation');
  const sources = value.sources;
  if (sources !== undefined && (!Array.isArray(sources) || sources.length > 8)) throw new CaseStoreError('invalid_case_relation_sources');
  return {
    operationId: caseDecisionId(value.operationId), caseStoreId: caseDecisionId(value.caseStoreId), toCaseId: caseDecisionId(value.toCaseId),
    expectedRelationRevision: caseDecisionRevision(value.expectedRelationRevision, true), action: action as 'save' | 'unlink' | 'restore',
    ...(value.relationId === undefined ? {} : { relationId: caseDecisionId(value.relationId) }),
    ...(value.fromCaseId === undefined ? {} : { fromCaseId: caseDecisionId(value.fromCaseId) }),
    ...(value.kind === undefined ? {} : { kind: value.kind as CaseRelationWriteInput['kind'] }),
    ...(value.explanation === undefined ? {} : { explanation: caseDecisionText(value.explanation, 4000, true) }),
    ...(value.targetScope === undefined ? {} : { targetScope: caseDecisionText(value.targetScope, 4000) }),
    ...(value.targetRef === undefined ? {} : { targetRef: value.targetRef === null ? null : parseCaseDecisionRef(value.targetRef) }),
    ...(sources === undefined ? {} : { sources: (sources as unknown[]).map(parseCaseRelationSource) }),
    ...(value.assertionNature === undefined ? {} : { assertionNature: value.assertionNature as 'explicit' | 'inferred' }),
    ...(value.changeReason === undefined ? {} : { changeReason: value.changeReason === null ? null : caseDecisionText(value.changeReason, 4000) }),
  };
}

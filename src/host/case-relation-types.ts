import type { CaseDecisionOrigin, CaseDecisionRef } from './case-decision-types.ts';
import type { CaseLearningSourceRef } from './learning-source-types.ts';

export type CaseRelationKind = 'follows_up' | 'supports';
export type CaseRelationSource = CaseLearningSourceRef | {
  type: 'case-artifact'; caseStoreId: string; caseId: string; artifactId: string; observedSha256: string | null;
};
export type CaseRelationRevision = {
  caseStoreId: string; relationId: string; revision: number; fromCaseId: string; toCaseId: string;
  kind: CaseRelationKind; lifecycle: 'active' | 'unlinked'; explanation: string; targetScope: string;
  targetRef: CaseDecisionRef | null; sources: CaseRelationSource[]; assertionNature: 'explicit' | 'inferred';
  changeReason: string | null; origin: CaseDecisionOrigin; createdAt: string; operationId: string;
};
export type CaseRelationWriteInput = {
  operationId: string; caseStoreId: string; toCaseId: string; relationId?: string;
  fromCaseId?: string; kind?: CaseRelationKind; expectedRelationRevision: number;
  action?: 'save' | 'unlink' | 'restore'; explanation?: string; targetScope?: string;
  targetRef?: CaseDecisionRef | null; sources?: CaseRelationSource[];
  assertionNature?: 'explicit' | 'inferred'; changeReason?: string | null;
};
export type CaseRelationListOptions = {
  caseId?: string; kind?: CaseRelationKind; includeUnlinked?: boolean; pageSize?: number; continuation?: string | null;
};
export type CaseRelationList = {
  caseStoreId: string; items: CaseRelationRevision[]; continuation: string | null; hasMore: boolean;
};
export type CaseRelationSourceView = {
  ref: CaseRelationSource | CaseDecisionRef; title: string;
  status: 'available' | 'unknown' | 'changed' | 'restricted'; text: string | null; limitations: string[];
  currentRevision?: number;
};
export type CaseRelationSourceCandidate = {
  ref: CaseRelationSource; title: string; status: 'available' | 'unknown'; kind: 'decision' | 'choice' | 'artifact';
};

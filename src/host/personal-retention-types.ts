import type { EnterpriseMaterialRef, EnterpriseMaterialRevision } from './enterprise-materials-types.ts';
import type { LearningSourceRef, LearningSourceReadOptions } from './learning-source-types.ts';
import type { CandidateControlState } from './agent-candidate-controls.ts';
import type { CaseDecisionRef } from './case-decision-types.ts';

export type PersonalExcerpt = { start: number; end: number };
export type PersonalSourceRef = (
  | ({ type: 'enterprise' } & EnterpriseMaterialRef)
  | { type: 'citation'; projectId: string; citationId: string; target: { type: 'report' } | { type: 'attachment'; attachmentIndex: number } }
  | { type: 'native-reply'; projectId: string; taskId: string; sessionId: string; messageId: string; expectedTextSha256: string }
  | { type: 'feedback'; sourceProjectId: string; boardTaskId: string; feedbackRevisionId: string }
) & { excerpt?: PersonalExcerpt };
export type PersonalSourceEvidence = {
  ref: LearningSourceRef; title: string; text: string | null; sha256: string | null;
  status: 'available' | 'disabled' | 'excluded' | 'governance-unknown'; project?: { id: string; name: string; archived: boolean };
  candidateGovernance?: CandidateControlState;
  caseGovernance?: { caseStatus: string; currentRevision: number | null; lifecycle: 'active' | 'archived' | null };
  strategyRef?: CaseDecisionRef;
  attachment?: { name: string; bytes: number; sha256: string; contentType?: string };
};
export type ReadPersonalSource = (ref: LearningSourceRef, options?: LearningSourceReadOptions) => Promise<PersonalSourceEvidence>;
export type PersonalMetadata = { kind: 'knowledge' | 'experience'; aliases: string[]; caution: string | null; sourceRefs: LearningSourceRef[] };
export type PersonalContentTarget =
  | { type: 'revision'; revisionId: string; expectedBodySha256: string }
  | { type: 'draft'; expectedMaterialVersion: number; expectedDraftSha256: string };
export type RetainPersonalInput = { operationId: string; expectedRevision: number; target: PersonalContentTarget; metadata: PersonalMetadata; personalLabel: string | null };
export type PersonalDecision = {
  operationId: string; action: 'retain' | 'archive' | 'restore'; decidedAt: string; personalLabel: string | null;
  contentRef: EnterpriseMaterialRef | null; bodySha256: string | null; metadata: PersonalMetadata; requestFingerprint: string;
  request: RetainPersonalInput | PersonalStateInput;
  failure: PersonalPending['failure'];
};
export type PersonalPending = {
  operationId: string; requestFingerprint: string; request: RetainPersonalInput; targetRevisionId: string;
  createdAt: string; failure: { code: string; outcome: 'FAIL' | 'UNKNOWN'; at: string } | null;
};
export type PersonalTermination = {
  operationId: string; action: 'end-pending'; endedAt: string; requestFingerprint: string; request: RetainPersonalInput;
  failure: PersonalPending['failure']; contentRef: EnterpriseMaterialRef | null; outcome: 'ended-unpublished';
};
export type PersonalItem = { materialId: string; revision: number; draftMeta: PersonalMetadata; currentDecisionId: string | null; archived: boolean; decisions: PersonalDecision[]; terminations: PersonalTermination[]; pending: PersonalPending | null };
export type PersonalRetentionRecords = { schemaVersion: 1 | 2; storeId: string; revision: number; items: PersonalItem[] };
export type SavePersonalDraftInput = { expectedRevision: number; metadata: PersonalMetadata };
export type PersonalStateInput = { operationId: string; expectedRevision: number; personalLabel: string | null };
export type PersonalWriteResult = { item: PersonalItem; decision: PersonalDecision | null; termination: PersonalTermination | null; replayed: boolean };
export type PersonalItemRead = { item: PersonalItem; decision: PersonalDecision | null; content: EnterpriseMaterialRevision | null };
export type PersonalRetentionFailurePoint = 'after-intent' | 'after-freeze' | 'before-publish';

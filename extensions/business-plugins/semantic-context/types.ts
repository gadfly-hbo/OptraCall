import type { LearningSourceRef } from '../../../src/host/learning-source-types.ts';
import type { PersonalContextTarget } from '../../../src/host/personal-context-types.ts';

/** Transient query tuples only. Original Stores retain identity and persistence authority. */
export type SemanticTarget =
  | { kind: 'sap'; packageId: string; version: string; metricName?: string; publishedHash?: string | null }
  | { kind: 'enterprise'; storeId: string; materialId: string; revisionId: string; location?: { start: number; end: number } }
  | { kind: 'data-input'; projectId: string; datasetId: string; inputVersionId: string }
  | { kind: 'data-description'; projectId: string; datasetId: string; inputVersionId: string; descriptionRevisionId: string }
  | { kind: 'data-citation'; projectId: string; citationId: string }
  | { kind: 'data-evidence'; projectId: string; citationId: string; attachmentIndex: number | null }
  | { kind: 'case-decision'; caseStoreId: string; caseId: string; recordId: string; revision: number }
  | { kind: 'case-choice'; caseStoreId: string; caseId: string; choiceId: string }
  | { kind: 'source'; source: LearningSourceRef }
  | { kind: 'personal'; target: PersonalContextTarget };

export type SemanticSourceState = 'available' | 'missing' | 'hash-conflict' | 'forbidden' | 'excluded' | 'disabled' | 'unknown' | 'partial';
export type SemanticRelation = { relation: string; target: SemanticTarget | null; originalTarget?: unknown; note: string | null; claim: 'author-declaration' | 'explicit-reference'; state?: SemanticSourceState | 'unread' };
export type SemanticItem = {
  target: SemanticTarget; title: string | null; state: SemanticSourceState; sha256: string | null;
  body: string | null; range: { start: number; end: number; total: number } | null;
  recordedAt: { field: string; value: string } | null; businessTime: { text: string; source: string }[];
  governance: Record<string, unknown> | null;
  declaration: { actor: string; text: string; claim: 'author-declaration' } | null;
  relations: SemanticRelation[]; gaps: string[]; code?: string;
  metadataFragment?: { text: string; range: { start: number; end: number; total: number } };
};
export type SemanticQueryInput = {
  action: 'find' | 'read' | 'trace'; query?: string; kinds?: SemanticTarget['kind'][]; target?: SemanticTarget;
  recordedBefore?: string; pageSize?: number; continuation?: string | null;
};
export type SemanticQueryResult = {
  schemaVersion: 1; type: 'optracall.semantic-context-result'; action: SemanticQueryInput['action'];
  state: SemanticSourceState; items: SemanticItem[]; unknownTime: SemanticItem[]; indexRevision: number | null;
  coverage: { complete: boolean; continuation: string | null; gaps: string[];
    sourceContinuations?: { tool: 'find_personal_context' | 'read_personal_context'; input: Record<string, unknown> }[] };
};

import type { UserQuoteProvenance } from '../../../src/agent/quoted-decisions.ts';

export type EvidenceLevel = '数据支撑' | '多源佐证' | '逻辑推断' | '经验假设';
export type Priority = 'high' | 'medium' | 'low';
export type ItemStatus = 'suggested' | 'adopted' | 'dismissed';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type ExtractionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type SourceKind = 'extracted' | 'manual' | 'report-confirmation';

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ['数据支撑', '多源佐证', '逻辑推断', '经验假设'];
export const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];
/** Confidence is derived from the evidence level, never taken from model self-assessment. */
export const EVIDENCE_CONFIDENCE: Record<EvidenceLevel, number> = { '数据支撑': 0.9, '多源佐证': 0.75, '逻辑推断': 0.55, '经验假设': 0.35 };

export type EvidenceFact = { text: string; quote?: string };
export type Evidence = { facts: EvidenceFact[]; level: EvidenceLevel; reasoning: string };

export type ExtractionConfiguration = { id: string; name: string; provider: string; model: string; revision: number };

export type ReportRecord = {
  id: number; projectId: string; relativePath: string;
  observedSha256: string | null; observedBytes: number | null; observedAt: string | null;
  lastExtractionAt: string | null; firstSeenAt: string; updatedAt: string;
};
export type ExtractionRecord = {
  id: string; reportId: number;
  configuration: ExtractionConfiguration; status: ExtractionStatus; error: string | null;
  sourceSha256: string; sourceBytes: number; sourceChars: number; truncated: boolean;
  itemCount: number | null; droppedItemCount: number | null;
  sessionFile: string | null; reportExcerpt: string;
  createdAt: string; updatedAt: string;
};
export type BoardItemRecord = {
  id: string; projectId: string; reportId: number | null; extractionId: string | null; sourceKind: SourceKind;
  title: string; rationale: string; expectedImpact: string;
  priority: Priority; effort: string | null;
  confidence: number | null; evidenceLevel: EvidenceLevel | null; evidence: Evidence | null;
  reportConfirmation?: ReportConfirmationSource;
  status: ItemStatus; dismissedReason: string | null; decidedAt: string | null;
  createdAt: string; updatedAt: string;
};
export type BoardTaskRecord = {
  id: string; itemId: string; title: string; owner: string | null; dueDate: string | null;
  status: TaskStatus; priority: Priority; note: string;
  createdAt: string; updatedAt: string;
};
export type FeedbackEffect = 'unknown' | 'positive' | 'negative' | 'none';
export type SaveFeedbackInput = {
  operationId: string; expectedLatestRevisionId: string | null;
  adopted: boolean; outcome: string; metricDelta: string; review: string; score: number | null;
  effect?: FeedbackEffect;
  respondsToRequest?: FeedbackRequestResponseRef;
};
export type TaskFeedbackRecord = {
  taskId: string; adopted: boolean; outcome: string; metricDelta: string; review: string; score: number | null;
  effect: FeedbackEffect;
  createdAt: string; updatedAt: string;
};
export type FeedbackRequestResponseRef = { requestId: string; revision: number; authorizationId: string };
export type TaskFeedbackRevision = TaskFeedbackRecord & {
  revisionId: string; revisionNumber: number; operationId: string | null; requestSha256: string | null;
  savedAt: string; origin: 'user-save' | 'legacy-current';
  legacyCreatedAt: string | null; legacyUpdatedAt: string | null;
  quoteProvenance?: UserQuoteProvenance;
  respondsToRequest?: FeedbackRequestResponseRef;
};
export type BoardCaseAuthorizationSource = { caseStoreId: string; caseId: string; choiceId: string;
  strategyRef: { type: 'case-decision'; caseStoreId: string; caseId: string; recordId: string; revision: number } };
export type BoardWorkContext = { confirmationId: string; planVersion: number; taskKey: string; goal: { goalId: string; version: number } };
export type BoardWorkAuthorizationSource = { kind: 'work'; projectId: string; taskId: string; requestId: string; workContext?: BoardWorkContext };
export type BoardAuthorizationSource = BoardCaseAuthorizationSource | BoardWorkAuthorizationSource;
export type BoardArrangeAction =
  | { kind: 'create'; title: string; owner?: string; dueDate?: string; priority?: string; note?: string; itemId?: string; itemVersion?: string }
  | { kind: 'reuse'; itemId: string; taskId: string; itemVersion: string; taskVersion: string; expectedPreviousAuthorizationId: string | null };
export type BoardArrangedActionRef = { itemId: string; taskId: string; itemVersion: string; taskVersion: string; authorizationId: string; created: boolean };
export type BoardConfirmation = { issueId: string; entry: 'case-form'; goal?: {goalId: string; version: number; strategy: string} };
export type BoardArrangeActionsInput = { operationId: string; projectId: string; source: BoardAuthorizationSource; quoteProvenance?: UserQuoteProvenance; caseConfirmation?: BoardConfirmation; scope: string; title: string; checks: string[]; actions: BoardArrangeAction[] };
export type BoardArrangementReceipt = Omit<BoardArrangeActionsInput, 'actions'> & { requestSha256: string; actions: BoardArrangedActionRef[]; createdAt: string };
export type BoardActionAuthorizationInput = {
  operationId: string; projectId: string; itemId: string; taskId: string; itemVersion: string; taskVersion: string;
  expectedPreviousAuthorizationId: string | null; decision: 'authorize' | 'revoke'; scope: string;
  source: BoardAuthorizationSource; quoteProvenance?: UserQuoteProvenance; caseConfirmation?: BoardConfirmation;
};
export type BoardActionAuthorization = Omit<BoardActionAuthorizationInput, 'expectedPreviousAuthorizationId'> & {
  authorizationId: string; revision: number; previousAuthorizationId: string | null; requestSha256: string;
  itemSnapshot: BoardItemRecord; taskSnapshot: BoardTaskRecord; actorKind: 'user'; createdAt: string;
};
export type BoardTaskView = BoardTaskRecord & { feedback?: TaskFeedbackRevision; authorization?: Pick<BoardActionAuthorization, 'authorizationId' | 'revision' | 'decision' | 'scope' | 'source' | 'createdAt'> | null };
export type BoardItemView = BoardItemRecord & { tasks: BoardTaskView[] };

/** Validated extraction item shape produced by normalizeExtractionOutput. */
export type NormalizedItem = {
  title: string; rationale: string; expectedImpact: string;
  priority: Priority; effort: string | null;
  evidence: Evidence;
};

/** Original review provenance. Review verdicts are never evidence levels. */
export type ConfirmedReviewEvidence = {
  materialId: string; locator: string; quote?: string;
  sourceLocator: string; sourceSha256?: string;
  rangeUtf16?: { start: number; end: number; total: number };
};
export type ConfirmedReviewClaim = {
  claimId: string; text: string; location: string;
  verdict: 'supported' | 'conditional'; conditions: string[];
  evidence: ConfirmedReviewEvidence[]; reason: string; impact: string;
};
export type ConfirmReportConclusionsInput = {
  operationId: string; projectId: string; taskId: string; reviewId: string;
  report: { relativePath: string; sha256: string; bytes: number; observedSha256: string; observedBytes: number };
  confirmedBy: string;
  conclusions: ConfirmedReviewClaim[];
  recommendations?: (ConfirmedReviewClaim & { conclusionClaimIds: string[] })[];
};
export type ConfirmedConclusionRecord = ConfirmedReviewClaim & {
  id: string; reportId: number; projectId: string; taskId: string; reviewId: string;
  reportSha256: string; reportBytes: number; relativePath: string;
  confirmedBy: string; confirmedAt: string;
};
export type ReportConfirmationSource = ConfirmedReviewClaim & {
  taskId: string; reviewId: string; reportSha256: string; reportBytes: number; relativePath: string;
  conclusionIds: string[]; conclusionClaimIds: string[]; confirmedBy: string; confirmedAt: string;
};
export type ReportConfirmationReceipt = {
  operationId: string; requestSha256: string; projectId: string; taskId: string; reviewId: string;
  reportId: number; reportSha256: string; confirmedBy: string; confirmedAt: string;
  claimIds: string[]; recommendationClaimIds: string[];
  conclusionIds: string[]; boardItemIds: string[]; addedConclusionIds: string[]; addedBoardItemIds: string[];
};

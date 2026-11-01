import type { CaseStore } from './case-store.ts';
import type { ProjectStore, TaskRecord } from './project-store.ts';
import type { createRequirementStore } from '../../extensions/business-plugins/requirements-elaboration/storage/store.ts';

export type FeedbackCaseSelection = { caseId: string; expectedRevision: number };
export type FeedbackSource = {
  sourceProjectId: string; boardItemId: string; boardTaskId: string;
  item: { title: string; rationale?: string; [key: string]: unknown };
  task: { title: string; status?: string; [key: string]: unknown };
  feedbackRevision: { revisionId: string; revisionNumber: number; [key: string]: unknown } | null;
  latestFeedbackRevisionId: string | null;
  report: { id: number; relativePath: string; extractionId: string | null; sourceSha256: string | null; sourceBytes: number | null; sourceChars?: number | null; reportExcerpt: string | null; truncated: boolean | null } | null;
};
export type FeedbackMaterialSelection = { id: string; kind: 'feedback' | 'recommendation' | 'extraction' | 'file'; mode: 'full' | 'excerpt' | 'reference'; relativePath?: string; start?: number; end?: number };
export type FeedbackMaterialSnapshot = {
  id: string; kind: FeedbackMaterialSelection['kind'] | 'reply'; mode: FeedbackMaterialSelection['mode']; title: string;
  source: { projectId: string; relativePath?: string; boardTaskId?: string; revisionId?: string; extractionId?: string | null; sourceSha256?: string | null; sourceBytes?: number | null; sessionId?: string; messageId?: string };
  body: string | null; sha256: string | null; range: { start: number; end: number; total: number } | null;
  observation: { sha256: string; bytes: number; observedAt: string } | null;
  availability?: 'available' | 'missing' | 'unavailable' | 'too_large';
};
export type FeedbackPreviewInput = {
  boardTaskId: string; feedbackRevisionId: string | null; question: string; taskName: string;
  caseSelection?: FeedbackCaseSelection | null; sourceNature?: 'unspecified' | 'actual' | 'synthetic';
  observationPeriod?: string; applicability?: string; limitations?: string; materials: FeedbackMaterialSelection[];
};
export type FeedbackPreview = Omit<FeedbackPreviewInput, 'materials'> & { previewId: string; source: FeedbackSource; materials: FeedbackMaterialSnapshot[]; createdAt: string; fingerprint: string };
export type FeedbackHandoff = Omit<FeedbackPreview, 'previewId' | 'materials'> & {
  schemaVersion: 1; handoffId: string; operationId: string; materials: FeedbackMaterialSnapshot[];
  target: { projectId: string; taskId: string; state: 'planned' | 'confirmed' };
};
export type FeedbackOperation = {
  schemaVersion: 1; operationId: string; handoffId: string; sourceProjectId: string; kind: 'handoff' | 'file' | 'requirement';
  requestHash: string; createdAt: string; updatedAt: string; phase: 'prepared' | 'completed' | 'needs_review';
  planned: { taskId?: string; instanceId?: string; relativePath?: string };
  request: Record<string, unknown>; steps: Record<string, { state: 'pending' | 'succeeded' | 'unknown' | 'failed'; reason?: string }>;
  result?: { taskId?: string; instanceId?: string; file?: { path: string; sha256: string; bytes: number } }; error?: string;
};
export type FeedbackContextSelection = { handoffId: string; selectedMaterialIds: string[] };
export type FeedbackContextReceipt = {
  handoffId: string; deliveryId: string; sourceProjectId: string; boardTaskId: string; feedbackRevisionId: string | null;
  selectedCase: FeedbackCaseSelection | null; sourceNature: string; observationPeriod: string; applicability: string; limitations: string;
  materials: FeedbackMaterialSnapshot[]; claim: 'provided-not-adopted';
};
export type FeedbackDelivery = { schemaVersion: 1; deliveryId: string; handoffId: string; projectId: string; taskId: string; requestId: string; providedAt: string; requestFingerprint: string; nativeSessionId: string | null; receipt: FeedbackContextReceipt };
export type FeedbackReplySelection = { kind: 'reply'; projectId: string; taskId: string; sessionId: string; messageId: string; start?: number; end?: number; expectedTextSha256: string };
export type FeedbackReportSelection = { kind: 'file'; projectId: string; relativePath: string; start?: number; end?: number; expectedSha256: string };
export type FeedbackFileInput = { operationId: string; selectedMaterialIds: string[]; caseSelection: FeedbackCaseSelection | null };
export type FeedbackRequirementInput = { operationId: string; title: string; scene: 'daily' | 'topic' | 'recurring'; caseSelection: FeedbackCaseSelection | null; background?: string; sourceSelection: FeedbackReplySelection | FeedbackReportSelection };
export type FeedbackRouteRequest = { pathname: string; method: string; input?: unknown };
export type FeedbackRouteResult = { status: number; body: unknown } | null;
export type DecisionFeedbackDependencies = {
  dataRoot: string; projects: ProjectStore; cases: CaseStore; requirements: ReturnType<typeof createRequirementStore>;
  readSource: (boardTaskId: string, revisionId: string | null) => FeedbackSource | Promise<FeedbackSource>;
  readReply: (projectId: string, taskId: string, selection: { sessionId: string; messageId: string }) => Promise<{ text: string; sessionId: string; messageId: string }>;
  assertActive: (projectId: string) => Promise<void>;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>;
};
export type FeedbackHandoffResult = { handoff: FeedbackHandoff; task: TaskRecord; operation: FeedbackOperation };

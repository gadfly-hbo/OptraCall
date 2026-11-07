/** Studio keeps business associations and its semantic sources, never a second SAP library. */
export type StudioAssetKind = 'business' | 'concept' | 'rule' | 'ontology' | 'binding' | 'hypothesis' | 'strategy';
export type StudioAuthority = 'enterprise' | 'rap' | 'data' | 'sap-metric' | 'sap-method' | 'studio-source' | 'task' | 'case';
export interface StudioSourceRef {
  authority: StudioAuthority;
  id: string;
  version: string;
  title?: string;
  sha256?: string;
  projectId?: string;
  taskId?: string;
  locator?: string;
}
export interface StudioCheck { name: string; status: 'pass' | 'fail' | 'unknown'; detail: string }
export interface StudioExtractionEvidence {
  method: string;
  sourceRefs: StudioSourceRef[];
  failures: string[];
  fallbacks: string[];
  reviewed: boolean;
}
export interface StudioAssetRevision {
  revision: number;
  title: string;
  body: string;
  scope: string;
  sources: StudioSourceRef[];
  dependencies: StudioSourceRef[];
  checks: StudioCheck[];
  limitations: string[];
  readyForPublication: boolean;
  extraction?: StudioExtractionEvidence;
  reason: string;
  sha256: string;
  createdAt: string;
}
export interface StudioAssetIssue { reason: string; confirmedAt: string; affectedRevision: number; replacementAssetId?: string }
export type StudioPublishedAsset = StudioAssetRevision & { issue?: StudioAssetIssue };
export interface StudioAsset {
  id: string;
  kind: StudioAssetKind;
  topicId: string;
  revisions: StudioAssetRevision[];
  candidateRevision: number | null;
  formalRevision: number | null;
  issue?: StudioAssetIssue;
  issueHistory?: StudioAssetIssue[];
}
export interface StudioMaterial {
  ref: StudioSourceRef;
  saved: boolean;
  readable: boolean;
  readAt?: string;
  processedAt?: string;
  confirmedAt?: string;
  note: string;
}
export interface StudioWorkItem {
  id: string;
  topicId: string;
  kind: 'task' | 'question' | 'gap' | 'review';
  title: string;
  detail: string;
  impact: string;
  nextStep: string;
  sources: StudioSourceRef[];
  status: 'open' | 'waiting' | 'in_progress' | 'resolved';
  answer?: string;
  updatedAt: string;
}
/** Pure shared answer context. Execution progress and timestamps do not change the question. */
export function studioQuestionContext(item: StudioWorkItem): string {
  return JSON.stringify([item.id, item.topicId, item.kind, item.title, item.detail, item.impact,
    item.sources.map(ref => [ref.authority, ref.id, ref.version, ref.sha256 ?? null, ref.projectId ?? null, ref.taskId ?? null, ref.locator ?? null, ref.title ?? null]), item.answer ?? null]);
}
export interface StudioTopic { id: string; title: string; goal: string; scope: string; status: 'planned' | 'building' | 'ready' | 'published' | 'verifying' | 'maintaining'; progress: string; coverage: string[]; gaps: string[] }
export interface StudioFeedbackOrigin { projectId: string; taskId: string; sessionId: string; messageId: string; useId?: string; graphSnapshotId?: string }
export interface StudioFeedback {
  id: string;
  topicId: string;
  title: string;
  problem: string;
  sources: StudioSourceRef[];
  currentHandling: string;
  impact: string;
  status: 'recorded' | 'accepted' | 'needs_material' | 'revision_prepared' | 'published_pending_use' | 'verified' | 'not_confirmed';
  response: string;
  verification?: { sources: StudioSourceRef[]; result: string };
  /** Host-derived exact native reply/use association; this is not a repair or use-quality assertion. */
  origin?: StudioFeedbackOrigin;
  createdAt: string;
  updatedAt: string;
}
export type StudioResultStatus = 'succeeded' | 'failed' | 'unknown';
export interface StudioPublicationItem { assetId: string; revision: number; sha256: string; title: string; kind: StudioAssetKind }
export interface StudioPublicationPreview {
  id: string;
  fingerprint: string;
  systemRevision: number;
  topicId: string;
  items: StudioPublicationItem[];
  refs: StudioSourceRef[];
  summary: string;
  scope: string;
  checks: StudioCheck[];
  limitations: string[];
  excluded: string[];
  targetProjectIds: string[];
  createdAt: string;
  confirmedAt?: string;
}
export interface StudioPublicationResult { module: 'studio-source' | 'sap-metric' | 'sap-method'; status: StudioResultStatus; detail: string; refs: StudioSourceRef[]; at: string }
export interface StudioPublication { preview: StudioPublicationPreview; results: StudioPublicationResult[] }
export interface StudioAdoption { projectId: string; refs: StudioSourceRef[]; status: StudioResultStatus; detail: string; at: string }
export interface StudioGraphState { snapshotId: string; status: StudioResultStatus; sourceRefs: StudioSourceRef[]; detail: string; at: string }
export interface StudioUseAssessmentInput { status: 'pass' | 'fail' | 'unknown'; report: StudioSourceRef; sources: StudioSourceRef[]; result: string }
export interface StudioUseAssessment extends StudioUseAssessmentInput { at: string }
export interface StudioUseRecord { id: string; projectId: string; taskId: string; sources: StudioSourceRef[]; graphSnapshotId?: string; report: StudioSourceRef; result: string; verification: 'not_assessed' | 'pass' | 'fail' | 'unknown'; assessments?: StudioUseAssessment[]; createdAt: string }
export interface StudioSystem {
  id: string;
  revision: number;
  name: string;
  projectId: string;
  taskId: string;
  currentTopicId: string;
  usageProjectIds: string[];
  usageTasks?: { projectId: string; taskId: string }[];
  topics: StudioTopic[];
  materials: StudioMaterial[];
  assets: StudioAsset[];
  assetRefs: StudioSourceRef[];
  workItems: StudioWorkItem[];
  feedback: StudioFeedback[];
  publications: StudioPublication[];
  adoptions: StudioAdoption[];
  graphs: StudioGraphState[];
  selectedGraphSnapshotId?: string;
  uses: StudioUseRecord[];
  createdAt: string;
  updatedAt: string;
}
export interface StudioCreateInput { name: string; projectId: string; taskId: string; goal: string; topicTitle: string; scope?: string; materials?: StudioMaterial[] }
export interface StudioSaveAssetInput {
  assetId?: string;
  expectedRevision?: number;
  topicId?: string;
  kind: StudioAssetKind;
  title: string;
  body: string;
  scope: string;
  sources: StudioSourceRef[];
  dependencies?: StudioSourceRef[];
  checks?: StudioCheck[];
  limitations?: string[];
  readyForPublication?: boolean;
  extraction?: StudioExtractionEvidence;
  reason?: string;
}
export interface StudioPublicationInput { topicId?: string; assetIds: string[]; refs?: StudioSourceRef[]; summary: string; scope: string; checks?: StudioCheck[]; limitations?: string[]; excluded?: string[]; targetProjectIds?: string[] }
export interface StudioFeedbackInput { origin?: StudioFeedbackOrigin; topicId?: string; title: string; problem: string; sources: StudioSourceRef[]; currentHandling?: string; impact?: string }
export interface StudioStoreOptions { isReadOnly?: (projectId: string) => boolean }
export interface StudioUpdateInput { expectedRevision?: number; name?: string; currentTopicId?: string; topic?: Partial<Omit<StudioTopic, 'id'>> }
export type StudioWorkItemInput = Omit<StudioWorkItem, 'id' | 'updatedAt' | 'answer'> & { id?: string };
export type StudioFeedbackUpdate = Pick<StudioFeedback, 'status' | 'response'> & { verification?: StudioFeedback['verification']; sources?: StudioSourceRef[] };

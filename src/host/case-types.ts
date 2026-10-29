export type CaseStatus = 'pending' | 'analyzing' | 'awaiting_confirmation' | 'observing' | 'closed';
export type ProjectWorkStatus = 'not_started' | 'in_progress' | 'awaiting_feedback' | 'completed' | 'cancelled';
export type CaseStorageStatus = { state: 'ready' | 'uninitialized' | 'unavailable'; code?: string; storeId?: string };

export type CaseRecord = {
  id: string; title: string; description: string; judgement: string; nextStep: string; status: CaseStatus;
  closeReason: string | null; closedAt: string | null; revision: number; createdAt: string; updatedAt: string;
};
export type CaseProjectLink = { caseId: string; projectId: string; linkedAt: string };
export type ProjectWorkRecord = {
  projectId: string; workStatus: ProjectWorkStatus | null; workScope: string; assignee: string | null;
  nextStep: string; statusReason: string | null; statusChangedAt: string | null;
  revision: number; createdAt: string | null; updatedAt: string | null;
};
export type CaseArtifactRecord = {
  id: string; caseId: string; projectId: string; relativePath: string; taskId: string | null; uploadId: string | null;
  role: 'file' | 'analysis_result' | 'report'; displayName: string | null;
  observedSha256: string | null; observedBytes: number | null; observedAt: string | null;
  createdAt: string; updatedAt: string; unlinkedAt: string | null;
};
export type CaseArtifactView = CaseArtifactRecord & {
  availability: 'available' | 'missing' | 'changed' | 'inaccessible' | 'project_unlinked' | 'unlinked';
  projectName?: string; taskName?: string;
};
export type WorkEventType = 'case_created' | 'case_updated' | 'case_closed' | 'case_reopened' | 'project_linked'
  | 'project_unlinked' | 'artifact_linked' | 'artifact_updated' | 'artifact_unlinked' | 'note_added'
  | 'project_work_updated' | 'project_work_note_added';
export type WorkEvent = {
  id: string; subjectType: 'case' | 'project'; subjectId: string; revision: number; eventType: WorkEventType;
  operationId: string; actorKind: 'user' | 'host'; originCaseId: string | null;
  changes: Record<string, { before: unknown; after: unknown }>; note: string | null;
  feedbackSource: string | null; occurredAt: string;
};
export type CaseList = { cases: CaseRecord[]; projectLinks: CaseProjectLink[] };
export type CaseDetail = {
  case: CaseRecord; projectLinks: CaseProjectLink[]; artifacts: CaseArtifactView[];
  events: WorkEvent[]; projectEvents: WorkEvent[]; pendingOperations: OperationReceipt[];
};
export type CaseContextSelection = {
  caseId: string; caseRevision: number; projectWorkRevision: number; selectedReferenceIds: string[];
};
export type CaseContextSnapshot = {
  caseId: string; caseRevision: number; projectId: string; projectWorkRevision: number; taskId: string;
  capturedAt: string; contextText: string; selectedReferenceIds: string[];
  userPromptSha256: string; composedPromptSha256: string;
};
export type OperationReceipt = {
  operationId: string; kind: string; requestSha256: string; caseId: string | null; projectId: string | null;
  phase: 'prepared' | 'project_created' | 'completed' | 'needs_review'; result: Record<string, unknown> | null;
  createdAt: string; updatedAt: string;
};
export type CaseMutation = { operationId: string; expectedRevision: number };
export type ProjectWorkInput = CaseMutation & {
  workStatus: ProjectWorkStatus | null; workScope: string; assignee: string | null; nextStep: string;
  statusReason: string | null; originCaseId?: string;
};
export type ArtifactInput = {
  projectId: string; relativePath: string; taskId?: string | null; role?: CaseArtifactRecord['role']; displayName?: string | null;
};

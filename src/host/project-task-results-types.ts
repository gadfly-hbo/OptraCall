import type { ProjectPlanConfirmation } from './project-plan-types.ts';
import type { ProjectStore } from './project-store.ts';
import type { NativeSnapshotReadBudget } from './native-session-snapshot.ts';
import type { PersonalSourceRef, PersonalSourceEvidence } from './personal-retention-types.ts';

/** A real saved-report receipt from the original native history, not inferred from directory contents. */
export interface ProjectTaskResultBinding {
  projectId: string;
  taskId: string;
  requestId: string;
  sessionId: string;
  toolCallId: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  nativeEntryId?: string;
}
export type ProjectTaskNativeReplyRef = Extract<PersonalSourceRef, { type: 'native-reply' }>;
/** A final original reply in the ancestry of an explicitly completed native run. */
export interface ProjectTaskNativeReplyBinding {
  projectId: string;
  taskId: string;
  requestId: string;
  sessionId: string;
  messageId: string;
  sha256: string;
  bytes: number;
}
export interface ProjectTaskResultSources {
  reports: ProjectTaskResultBinding[];
  replies: ProjectTaskNativeReplyBinding[];
  limitations?: string[];
}
interface ProjectTaskResultMetadata {
  id: string;
  confirmationId?: string;
  planVersion?: number;
  taskKey: string;
  taskName: string;
  taskState: string;
  requestRelation: 'confirmed-request' | 'other-saved-request';
  confirmedRequestId?: string;
  limitations: string[];
}
export type ProjectTaskResultDescriptor = ProjectTaskResultMetadata & (
  | (ProjectTaskResultBinding & { kind: 'report'; bindingState: 'saved-receipt-only'; source?: never; messageId?: never })
  | (ProjectTaskNativeReplyBinding & { kind: 'native-reply'; bindingState: 'native-reply-reference-only'; source: ProjectTaskNativeReplyRef; relativePath?: never; toolCallId?: never; nativeEntryId?: never })
);
export interface ProjectTaskResultsScope {
  projectId: string;
  taskId: string;
  confirmationId?: string;
  planVersion?: number;
}
export interface ProjectTaskResultsFindResult {
  schemaVersion: 1;
  type: 'optracall.project-task-results';
  action: 'find';
  scope: ProjectTaskResultsScope;
  results: ProjectTaskResultDescriptor[];
  limitations: { taskId: string; code: string; message?: string }[];
  wait?: { requestedMs: number; elapsedMs: number; outcome: 'not-needed' | 'available' | 'timed-out' };
  hasMore: boolean;
  cursor?: string;
}
export interface ProjectTaskResultsReadResult {
  schemaVersion: 1;
  type: 'optracall.project-task-results';
  action: 'read';
  scope: ProjectTaskResultsScope;
  result: ProjectTaskResultDescriptor;
  contentState: 'exact-bytes-verified' | 'exact-native-reply-verified';
  observedAt: string;
  rangeUtf16: { start: number; end: number; total: number };
  complete: boolean;
  nextOffset?: number;
}
export interface ProjectTaskResultsContext { signal: AbortSignal; assertCurrent(): void }
export type ProjectTaskResultsToolResult = {
  content: { type: 'text'; text: string }[];
  details: ProjectTaskResultsFindResult | ProjectTaskResultsReadResult;
};
export type ProjectTaskResultsPort = (action: 'find' | 'read', input: Record<string, unknown>, context: ProjectTaskResultsContext) => Promise<ProjectTaskResultsToolResult>;
export interface ProjectTaskResultsSourceReadOptions { signal: AbortSignal; assertCurrent(): void; budget: NativeSnapshotReadBudget }
export interface ProjectTaskResultsOptions {
  projects: Pick<ProjectStore, 'get' | 'getTask' | 'captureFeedbackFile'>;
  projectId: string;
  taskId: string;
  confirmation?: ProjectPlanConfirmation;
  handoff?: { mode: 'own-results' } | { mode: 'selected'; sources: import('./task-assignment.ts').TaskSourceSelection[] };
  listBoundReports(projectId: string, sourceTaskId: string, options?: ProjectTaskResultsSourceReadOptions): Promise<ProjectTaskResultBinding[]>;
  /** One native snapshot scan supplies both catalogs; legacy report-only consumers remain valid. */
  listResultSources?(projectId: string, sourceTaskId: string, options?: ProjectTaskResultsSourceReadOptions): Promise<ProjectTaskResultSources>;
  /** The Host injects the existing native-reply reader; no second body reader is created. */
  readNativeReply?(ref: ProjectTaskNativeReplyRef, options: ProjectTaskResultsSourceReadOptions): Promise<PersonalSourceEvidence>;
  assertAuthorized?(scope: { projectId: string; taskId: string; sourceTaskId: string; requestId?: string; sessionId?: string; relativePath?: string }, context: ProjectTaskResultsContext): Promise<void>;
}

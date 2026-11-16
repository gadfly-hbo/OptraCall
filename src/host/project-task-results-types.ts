import type { ProjectPlanConfirmation } from './project-plan-types.ts';
import type { ProjectStore } from './project-store.ts';
import type { NativeSnapshotReadBudget } from './native-session-snapshot.ts';

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
export interface ProjectTaskResultDescriptor extends ProjectTaskResultBinding {
  id: string;
  confirmationId: string;
  planVersion: number;
  taskKey: string;
  taskName: string;
  taskState: string;
  bindingState: 'saved-receipt-only';
  requestRelation: 'confirmed-request' | 'other-saved-request';
  confirmedRequestId?: string;
  limitations: string[];
}
export interface ProjectTaskResultsScope {
  projectId: string;
  taskId: string;
  confirmationId: string;
  planVersion: number;
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
  contentState: 'exact-bytes-verified';
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
  confirmation: ProjectPlanConfirmation;
  listBoundReports(projectId: string, sourceTaskId: string, options?: ProjectTaskResultsSourceReadOptions): Promise<ProjectTaskResultBinding[]>;
  assertAuthorized?(scope: { projectId: string; taskId: string; sourceTaskId: string; relativePath?: string }, context: ProjectTaskResultsContext): Promise<void>;
}

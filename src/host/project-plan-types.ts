import type { GoalRef } from './strategy-goals-types.ts';

export interface ProjectPlanCapabilityRef {
  kind: 'skill' | 'sap-method' | 'connector';
  id: string;
  version?: string;
  sha256?: string;
  permissionRef?: string;
}
export interface ProjectPlanMaterialRef {
  kind: 'project-file' | 'enterprise-material' | 'connector' | 'provided';
  id: string;
  version?: string;
  sha256?: string;
  permissionRef?: string;
}
export interface ProjectPlanCapabilities {
  skills: { id: string; title: string; version?: string; sha256?: string }[];
  methods: { id: string; title: string; version: string }[];
  connectors: { id: string; title: string; enabled: boolean; requiresPermission: true; permissionRef?: string }[];
  materials: (ProjectPlanMaterialRef & { title: string })[];
  caseContexts: { caseId: string; title: string; primaryGoal: GoalRef; relatedGoals?: GoalRef[]; caseRevision?: number; projectWorkRevision?: number }[];
}

export interface ProjectPlanTask {
  key: string;
  name: string;
  selected: boolean;
  /** Existing Task identity. Omission means a selected new Task draft. */
  taskId?: string;
  scope: string;
  capabilities: ProjectPlanCapabilityRef[];
}
export interface ProjectPlanCoverage {
  key: string;
  parentKey?: string;
  label: string;
  disposition: 'focus' | 'covered' | 'deferred' | 'unknown' | 'out-of-scope';
  reason: string;
  taskKeys: string[];
}
export interface ProjectPlanContent {
  request: string;
  premises: string[];
  materials: ProjectPlanMaterialRef[];
  coverage: ProjectPlanCoverage[];
  tasks: ProjectPlanTask[];
  taskMode: 'single' | 'multi';
  summaryTaskKey: string;
  /** Agent-proposed relationships; these do not prescribe a Host execution order. */
  dependencies: { from: string; to: string; reason: string }[];
  caseContext: null | { caseId: string; primaryGoal: GoalRef; relatedGoals?: GoalRef[]; caseRevision?: number; projectWorkRevision?: number };
  goalContext?: { goal: GoalRef; purpose: 'query' | 'asset-construction' | 'assigned-work' | 'case-investigation' };
  requirementRef?: { instanceId: string; version: number };
}
export interface ProjectPlanVersion { version: number; createdAt: string; plan: ProjectPlanContent }
export type ProjectPlanStepStatus = 'pending' | 'not-required' | 'created' | 'not-requested' | 'accepted' | 'failed' | 'unknown' | 'cancelled';
export interface ProjectPlanTaskReceipt {
  taskKey: string;
  taskId: string;
  createRequestId: string;
  startRequestId: string;
  createStatus: ProjectPlanStepStatus;
  startStatus: ProjectPlanStepStatus;
  createCode?: string;
  startCode?: string;
  observations: { phase: 'create' | 'start'; status: ProjectPlanStepStatus; code?: string; recordedAt: string }[];
}
export interface ProjectPlanConfirmation {
  id: string;
  projectId: string;
  planVersion: number;
  confirmedAt: string;
  mode: 'create' | 'start';
  authorizations: { operationId: string; mode: 'create' | 'start'; authorizedAt: string }[];
  plan: ProjectPlanContent;
  tasks: ProjectPlanTaskReceipt[];
}
export interface ProjectPlanOperationRef { operationId: string; kind: 'draft' | 'confirm' | 'prepare'; planVersion: number; confirmationId?: string; requestHash?: string }
export interface ProjectPlanMeceReview { sameLevel: string; coverage: string; boundaries: string; depth: string }
export interface ProjectPlanPreparationProjection {
  operationId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'unknown';
  inputHash: string;
  draftVersion?: number;
  mece?: ProjectPlanMeceReview;
  limitations?: string[];
}
export interface ProjectPlanPreparedDraftInput extends ProjectPlanDraftInput {
  requestHash: string;
  mece: ProjectPlanMeceReview;
  limitations: string[];
}
export interface ProjectPlanPreparationResult {
  state: ProjectPlanState;
  draft?: ProjectPlanVersion;
  replayed: boolean;
  preparation: ProjectPlanPreparationProjection;
}

export interface ProjectPlanState {
  formatVersion: 1;
  projectId: string;
  revision: number;
  draft?: ProjectPlanVersion;
  confirmed?: ProjectPlanConfirmation;
  history: ProjectPlanConfirmation[];
  operations?: ProjectPlanOperationRef[];
  preparations?: ProjectPlanPreparationProjection[];
}
export interface ProjectPlanDraftInput { operationId: string; expectedRevision: number; plan: ProjectPlanContent }
export interface ProjectPlanConfirmInput { operationId: string; expectedRevision: number; mode: 'create' | 'start' }
export interface ProjectPlanDraftResult { state: ProjectPlanState; draft: ProjectPlanVersion; replayed: boolean }
export interface ProjectPlanConfirmResult { state: ProjectPlanState; confirmation: ProjectPlanConfirmation; replayed: boolean }
export interface ProjectPlanEffects {
  /** Host checks original project ownership, archived state and current permissions. */
  readTask(projectId: string, taskId: string): Promise<{ id: string; archivedAt?: string | null }>;
  validate?(projectId: string, plan: ProjectPlanContent): Promise<void>;
  createTask(input: { projectId: string; taskId: string; task: ProjectPlanTask; origin: { confirmationId: string; taskKey: string; requestHash: string }; requestId: string }): Promise<{ taskId: string; status?: 'created' } | { status: 'failed' | 'unknown' | 'cancelled'; code: string }>;
  /** Returns admission/receipt only. Completion stays with the original Task owner. */
  startTask(input: { projectId: string; taskId: string; requestId: string; confirmation: ProjectPlanConfirmation; task: ProjectPlanTask }): Promise<{ status: 'accepted' | 'failed' | 'unknown' | 'cancelled'; code?: string }>;
}
export interface ProjectPlanTaskResultInput {
  confirmationId: string;
  taskKey: string;
  taskId: string;
  phase: 'create' | 'start';
  requestId: string;
  status: 'created' | 'accepted' | 'failed' | 'unknown' | 'cancelled';
  code?: string;
}

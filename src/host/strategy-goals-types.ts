/** Management records only; measures, decisions and action facts remain in their original authorities. */
export type GoalPerspective = 'profit' | 'nonprofit' | 'personal';
export interface GoalScope { kind: 'enterprise' | 'department' | 'personal'; id: string; name: string; enterpriseId?: string }
export interface GoalRef { goalId: string; version: number }
export interface GoalSourceRef {
  authority: 'case' | 'decision-board' | 'project' | 'task' | 'sap-metric';
  id: string;
  version: string | number;
  projectId?: string;
  taskId?: string;
  sha256?: string;
}
export type GoalMeasurement =
  | { kind: 'quantitative'; sapMetric: { authority: 'sap-metric'; id: string; version: string; metricName?: string }; target?: string }
  | { kind: 'deliverable'; criterion: string };
export interface GoalDraftInput {
  title: string;
  outcome: string;
  perspective: GoalPerspective;
  scope: GoalScope;
  bscPerspective?: string;
  measurement: GoalMeasurement;
  baseline: { state: 'known' | 'pending'; description: string };
  responsible: string;
  dueAt?: string;
  strategies?: string[];
  resources?: string[];
  necessaryConditions?: string[];
  source?: GoalSourceRef;
}
export interface GoalVersion extends GoalDraftInput, GoalRef {
  status: 'candidate' | 'adopted';
  createdAt: string;
  adoptedAt?: string;
  adoptionDecision?: string;
}
export interface StrategyGoalRecord {
  id: string;
  currentVersion: number;
  adoptedVersion: number | null;
  versions: GoalVersion[];
}
export interface GoalRelationInput {
  from: GoalRef;
  to: GoalRef;
  kind: 'supports' | 'necessary-condition' | 'contribution' | 'strategy';
  responsibility: string;
  rationale: string;
}
export interface GoalRelationVersion extends GoalRelationInput { revision: number; createdAt: string }
export interface GoalRelation extends GoalRelationVersion { id: string; history: GoalRelationVersion[] }
export interface GoalRelationRevisionInput extends GoalRelationInput, GoalMutation { expectedRevision: number }
export interface GoalFeedbackInput {
  goal: GoalRef;
  level: 'execution' | 'strategy' | 'strategic-assumption';
  source: GoalSourceRef;
  note: string;
}
export interface GoalFeedback extends GoalFeedbackInput { id: string; createdAt: string }
export interface StrategyGoalsIndex {
  goals: StrategyGoalRecord[];
  relations: GoalRelation[];
  feedback: GoalFeedback[];
}
export interface GoalMutation { operationId: string }
export interface GoalRevisionInput extends GoalDraftInput, GoalMutation { expectedVersion: number }
export interface GoalAdoptionInput extends GoalMutation { expectedVersion: number; decision: string }
export interface GoalOperationReceipt {
  operationId: string;
  requestHash: string;
  kind: 'create' | 'revise' | 'adopt' | 'relate' | 'revise-relation' | 'feedback';
  completedAt: string;
  result: GoalVersion | GoalRelation | GoalFeedback;
}

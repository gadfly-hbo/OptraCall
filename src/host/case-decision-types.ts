import type { PersonalSourceRef } from './personal-retention-types.ts';
import type { PersonalContextTarget } from './personal-context-types.ts';

export type CaseDecisionKind = 'hypothesis' | 'strategy';
export type CaseDecisionRef = { type: 'case-decision'; caseStoreId: string; caseId: string; recordId: string; revision: number };
export type CaseDecisionOrigin = {
  actorKind: 'agent' | 'user'; projectId: string | null; taskId: string | null;
  requestId: string | null; sessionId: string | null; toolCallId: string | null;
};
export type CaseActionObservation = {
  updatedAt: string; title: string; owner: string | null; dueDate: string | null;
  status: 'todo' | 'doing' | 'done'; note: string;
};
export type CaseDecisionTarget =
  | { type: 'source'; source: PersonalSourceRef }
  | { type: 'personal'; target: PersonalContextTarget }
  | { type: 'rap'; instanceId: string; version: string }
  | CaseDecisionRef
  | { type: 'board-task'; projectId: string; itemId: string; taskId: string; observation?: CaseActionObservation }
  | { type: 'feedback'; sourceProjectId: string; boardTaskId: string; feedbackRevisionId: string; handoffId?: string };
export type CaseDecisionReference = {
  relation: 'supports' | 'opposes' | 'background' | 'limits' | 'derived_from' | 'depends_on' | 'action' | 'feedback';
  target: CaseDecisionTarget; note: string | null;
};
export type CaseHypothesisPayload = {
  title: string; statement: string; scope: string | null; mechanism: string | null;
  unknowns: string | null; whatWouldChangeJudgement: string | null;
  assessment: 'unresolved' | 'supported' | 'weakened' | 'refuted'; assessmentReason: string | null;
};
export type CaseStrategyPlan = {
  scopeAndAuthority: string | null; implementationOrEvidenceTiming: string | null;
  reviewAndTriggers: string | null; expectedObservationsAndComparison: string | null; risksAndExit: string | null;
};
export type CaseStrategyPayload = {
  title: string; proposal: string; goal: string | null; mechanism: string | null;
  conditions: string | null; limitations: string | null; plan: CaseStrategyPlan | null;
};
export type CaseDecisionPayload = CaseHypothesisPayload | CaseStrategyPayload;
export type CaseDecisionImpact = { target: CaseDecisionRef; explanation: string };
export type CaseDecisionRevision = {
  caseStoreId: string; caseId: string; recordId: string; revision: number; kind: CaseDecisionKind;
  payload: CaseDecisionPayload; references: CaseDecisionReference[]; impactNotes: CaseDecisionImpact[];
  changeReason: string | null; lifecycle: 'active' | 'archived'; origin: CaseDecisionOrigin;
  createdAt: string; operationId: string;
};
export type CaseDecisionDraftInput = {
  operationId: string; caseStoreId: string; caseId: string; recordId?: string; expectedRevision: number;
  kind: CaseDecisionKind; payload: CaseDecisionPayload | Record<string, unknown>;
  references?: CaseDecisionReference[]; impactNotes?: CaseDecisionImpact[]; changeReason?: string | null;
};
export type CaseDecisionGovernanceInput = {
  operationId: string; caseStoreId: string; caseId: string; recordId: string; expectedRevision: number;
  action: 'archive' | 'restore' | 'add_reference' | 'remove_reference'; reference?: CaseDecisionReference;
};
export type CaseStrategyChoiceValue = 'trial' | 'gather_evidence' | 'defer' | 'reject' | 'no_action' | 'continue' | 'adjust' | 'stop_considering';
export type CaseStrategyChoiceInput = {
  operationId: string; caseStoreId: string; caseId: string; strategyRef: CaseDecisionRef;
  choice: CaseStrategyChoiceValue; reason?: string | null; expectedPreviousChoiceId: string | null;
  allowHistorical?: boolean;
};
export type CaseStrategyChoice = {
  choiceId: string; caseId: string; strategyRef: CaseDecisionRef; choice: CaseStrategyChoiceValue;
  reason: string | null; previousChoiceId: string | null; operationId: string; occurredAt: string; actorKind: 'user';
};
export type CaseDecisionListOptions = { includeArchived?: boolean; history?: boolean; pageSize?: number; continuation?: string | null };
export type CaseDecisionList = {
  caseStoreId: string; items: CaseDecisionRevision[]; choices: CaseStrategyChoice[];
  decisionUpdatedAt: string | null; continuation: string | null;
};
/** Synchronous Host qualification, rechecked immediately before the transaction commits. */
export type CaseDecisionWriteOptions = { assertWritable?: () => void };

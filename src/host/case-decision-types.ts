import type { PersonalSourceRef } from './personal-retention-types.ts';
import type { PersonalContextTarget } from './personal-context-types.ts';
import type { UserQuoteProvenance } from '../agent/quoted-decisions.ts';

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
  issueId?: string; changeReason: string | null; lifecycle: 'active' | 'archived'; origin: CaseDecisionOrigin;
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
export type CaseIssueEdgeSource = { kind: 'user-declaration' | 'adopted-candidate'; ref: string | null };
/** Explicit directed承接 from one Case issue to another; not inferred, not necessarily single-parent or acyclic. */
export type CaseIssueEdge = { edgeId: string; caseId: string; fromIssueId: string; toIssueId: string; revision: number; lifecycle: 'active' | 'removed';
  explanation: string; source: CaseIssueEdgeSource; operationId: string; createdAt: string };
export type CaseDecisionIssue = { id: string; caseId: string; title: string; createdAt: string };
export type CaseIssueReply = Extract<PersonalSourceRef, { type: 'native-reply' }>;
export type CaseIssueReview = { caseId: string; issueId: string; choiceId: string; operationId: string; createdAt: string; reply: CaseIssueReply;
  judgement: string; nextStep: string; observation: string; feedback?: { projectId: string; boardTaskId: string; feedbackRevisionId: string; authorizationId?: string }; };
export type CaseStrategyChoiceValue = 'trial' | 'gather_evidence' | 'defer' | 'reject' | 'no_action' | 'continue' | 'adjust' | 'stop_considering';
export function caseChoicePermitsAction(value: CaseStrategyChoiceValue): boolean {
  return value === 'trial' || value === 'adjust' || value === 'continue';
}

export type CaseStrategyChoiceInput = {
  operationId: string; caseStoreId: string; caseId: string; strategyRef: CaseDecisionRef;
  choice: CaseStrategyChoiceValue; reason?: string | null; expectedPreviousChoiceId: string | null;
  allowHistorical?: boolean; issueId?: string; respondsToRequest?: CaseDecisionRequestRef;
};
export type CaseStrategyChoice = {
  choiceId: string; caseId: string; issueId?: string; goalBinding?: import('./case-types.ts').CaseGoalBinding | null; strategyRef: CaseDecisionRef; choice: CaseStrategyChoiceValue;
  reason: string | null; previousChoiceId: string | null; operationId: string; occurredAt: string; actorKind: 'user';
  quoteProvenance?: UserQuoteProvenance; respondsToRequest?: CaseDecisionRequestRef;
};
export type CaseDecisionListOptions = { includeArchived?: boolean; history?: boolean; pageSize?: number; continuation?: string | null };
export type CaseDecisionList = {
  caseStoreId: string; items: CaseDecisionRevision[]; choices: CaseStrategyChoice[];
  decisionUpdatedAt: string | null; continuation: string | null;
};
/** Synchronous Host qualification, rechecked immediately before the transaction commits. */
export type CaseDecisionWriteOptions = {
  assertWritable?: () => void;
  /** Host-only declaration adapter: resolve aggregate revision inside mutate; entity CAS stays explicit. */
  currentCaseRevision?: true;
};

/** Explicit request for someone to respond (choose / observe) on a Case issue. Event-sourced; never inferred. */
export type CaseDecisionRequestRef = { requestId: string; revision: number };
export type CaseDecisionRequestSource = { kind: 'user-declaration' | 'agent-tool'; ref: string | null };
export type CaseDecisionRequestTarget =
  | { kind: 'choose'; strategyRef: CaseDecisionRef; expectedPreviousChoiceId: string | null }
  | { kind: 'observe'; projectId: string; itemId: string; taskId: string; authorizationId: string; feedbackBaseRevisionId: string | null };
/** assignee is business text, not a login identity. */
export type CaseDecisionRequest = {
  requestId: string; revision: number; caseId: string; issueId: string; kind: 'choose' | 'observe'; text: string;
  source: CaseDecisionRequestSource; assignee: { label: string | null; source: string | null };
  requestedAt: string; dueDate?: string; target: CaseDecisionRequestTarget;
  lifecycle: 'open' | 'withdrawn' | 'superseded'; operationId: string; createdAt: string;
};
export type CaseDecisionRequestStatus = 'open' | 'answered' | 'superseded' | 'withdrawn' | 'unverifiable';
/** A saved feedback revision that carries an exact request reference (supplied by the feedback owner). */
export type CaseFeedbackResponse = {
  requestId: string; requestRevision: number; projectId: string; itemId: string; taskId: string; authorizationId: string;
  revisionId: string; baseRevisionId: string | null;
};
export function requestStatus(request: CaseDecisionRequest, choices: CaseStrategyChoice[] | null | undefined, feedbackRevisions: CaseFeedbackResponse[] | null | undefined): CaseDecisionRequestStatus {
  if (request.lifecycle === 'withdrawn') return 'withdrawn';
  if (request.lifecycle === 'superseded') return 'superseded';
  const target = request.target;
  if (target.kind === 'choose') {
    if (!choices) return 'unverifiable';
    const same = choices.filter(c => c.issueId === request.issueId);
    const answered = same.some(c => c.respondsToRequest?.requestId === request.requestId && c.respondsToRequest.revision === request.revision
      && c.strategyRef.caseStoreId === target.strategyRef.caseStoreId && c.strategyRef.recordId === target.strategyRef.recordId && c.strategyRef.revision === target.strategyRef.revision && c.previousChoiceId === target.expectedPreviousChoiceId);
    if (answered) return 'answered';
    // The issue choice chain moved on without answering this exact request: replaced, not resolved.
    const base = target.expectedPreviousChoiceId;
    const idx = base === null ? -1 : same.findIndex(c => c.choiceId === base);
    if (base !== null && idx < 0) return 'unverifiable';
    return same.length > idx + 1 ? 'superseded' : 'open';
  }
  if (!feedbackRevisions) return 'unverifiable';
  return feedbackRevisions.some(f => f.requestId === request.requestId && f.requestRevision === request.revision && f.projectId === target.projectId
    && f.itemId === target.itemId && f.taskId === target.taskId && f.authorizationId === target.authorizationId && f.baseRevisionId === target.feedbackBaseRevisionId) ? 'answered' : 'open';
}

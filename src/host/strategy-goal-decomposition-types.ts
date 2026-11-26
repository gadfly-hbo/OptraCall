import type { GoalDraftInput, GoalRef, GoalRoleSuggestionRef, GoalScope, GoalSourceRef } from './strategy-goals-types.ts';

export type GoalMetricKind = 'amount' | 'ratio' | 'milestone';

export interface StrategicFormalGoal {
  id: string;
  title: string;
  outcome: string;
  period: string;
  targetValue: number;
  unit: string;
  metricKind: GoalMetricKind;
  sapMetric?: { authority: 'sap-metric'; id: string; version: string; metricName: string };
  baseline?: { state: 'known' | 'pending'; value?: number; description: string };
  strategies?: string[];
  responsible?: string;
  dueAt?: string;
}

export type GoalFormalOrigin =
  | {
      kind: 'strategy-publication';
      initiativeId: string;
      publicationId: string;
      candidateId: string;
      candidateNo: number;
      contentSha256: string;
      formalGoalId: string;
      targetValue: number;
      unit: string;
      period: string;
      metricKind: GoalMetricKind;
    }
  | {
      kind: 'manual-exception';
      reason: string;
      period: string;
      targetValue: number;
      unit: string;
      metricKind: GoalMetricKind;
      preConfirmEstimateRef?: { discussionId: string; sessionId: string; entryId: string; sha256: string };
    };

export interface EvidenceRef {
  category: 'internal' | 'market' | 'competitor' | 'other';
  sourceRef?: GoalSourceRef | string;
  summary: string;
  basis?: string;
}

export interface ReachabilityEstimate {
  metricKind: GoalMetricKind;
  unit: string;
  period: string;
  scopeDescription: string;
  scope?: GoalScope;
  sapMetric?: { id: string; version: string; metricName?: string };
  formalTargetValue: number;
  estimatedValue: number | null;
  /** formalTargetValue - estimatedValue. Negative means surplus (预计余量). */
  gapValue: number | null;
  numerator?: number;
  denominator?: number;
  denominatorAssumed?: boolean;
  basis: string;
  evidence: EvidenceRef[];
  limitations?: string[];
  methodNote?: string;
  scriptReceipts?: {
    skill: string;
    script: string;
    engineVersion: string;
    inputDigest: string;
    outputSha256: string;
    executedAt: string;
  }[];
}

export interface PreConfirmEstimateRecord {
  goalRef?: GoalRef;
  draftId: string;
  scope: GoalScope;
  estimate: ReachabilityEstimate;
  updatedAt: string;
  updatedBy: 'user' | 'agent';
  agentSource?: GoalRoleSuggestionRef;
}

export interface GsaPlannedAction {
  id: string;
  summary: string;
  checkpoint?: string;
  observationBasis?: string;
}

export interface GsaStageCheckpoint {
  id: string;
  label: string;
  targetDate?: string;
  observationBasis?: string;
}

export function hasGsaCheckpoint(actions: readonly GsaPlannedAction[], stages: readonly GsaStageCheckpoint[]): boolean {
  return actions.some(action => action.summary.trim() && action.checkpoint?.trim() && action.observationBasis?.trim()) ||
    stages.some(stage => stage.label.trim() && stage.observationBasis?.trim());
}

export interface GsaPlanDraft {
  goalVersion?: number;
  goalId: string;
  plannedActions: GsaPlannedAction[];
  stageCheckpoints: GsaStageCheckpoint[];
  preConfirmEstimate?: ReachabilityEstimate;
  updatedAt: string;
}

export interface GsaPlanConfirmInput {
  operationId: string;
  expectedGoalVersion: number;
  expectedAdoptedVersion?: number | null;
  expectedPlanVersion: number;
  goalRevision?: GoalDraftInput;
  plannedActions: GsaPlannedAction[];
  stageCheckpoints?: GsaStageCheckpoint[];
  decision: string;
  confirmedBy?: string;
  preConfirmEstimate?: ReachabilityEstimate;
  supersedesReason?: string;
}

export interface FormalGoalSelection {
  initiativeId: string;
  publicationId: string;
  candidateId: string;
  candidateNo: number;
  contentSha256: string;
  formalGoal: StrategicFormalGoal;
}

export interface GsaPlanVersion {
  preConfirmEstimate?: ReachabilityEstimate;
  planId: string;
  planVersion: number;
  goal: GoalRef;
  goalContentSha256: string;
  formalTarget: {
    value: number;
    unit: string;
    metricKind: GoalMetricKind;
    period: string;
  };
  strategies: string[];
  plannedActions: GsaPlannedAction[];
  stageCheckpoints: GsaStageCheckpoint[];
  planKind: 'planned-not-authorized';
  origin: GoalFormalOrigin | { kind: 'legacy-adopted-goal' };
  confirmedBy: string;
  confirmedAt: string;
  decision: string;
  contentSha256: string;
  previousPlanVersion?: number;
  supersedesReason?: string;
}

export type ContributionNature = 'allocation' | 'driver-hypothesis' | 'aggregation' | 'milestone';

export interface DecompositionRowCheckpoint {
  id: string;
  label: string;
  date: string;
  targetValue: number | null;
  unit: string;
  status: 'planned' | 'undecided' | 'observing';
  evidenceSource: string;
}

export interface DecompositionRow {
  rowId: string;
  linkedGoalId?: string;
  expectedGoalVersion?: number;
  expectedAdoptedVersion?: number | null;
  title: string;
  outcome: string;
  scope: GoalScope;
  scopeLabel: string;
  responsible: string;
  strategy: string;
  contributionNature: ContributionNature;
  commitAsGoal: boolean;
  metricKind: GoalMetricKind;
  targetValue: number | null;
  unit: string;
  ratio?: {
    numerator: number;
    denominator: number;
    denominatorAssumed: boolean;
    definition: string;
  };
  milestoneCriterion?: string;
  crossCellId?: string;
  dimensions?: Record<string, string>;
  basis: string;
  checkpoints: DecompositionRowCheckpoint[];
  tracked: boolean;
}

export interface DecompositionReserve {
  id: string;
  amount: number;
  unit: string;
  purpose: string;
  owner: string;
  basis?: string;
}

export interface DecompositionGapStrategy {
  id: string;
  name: string;
  strategy: string;
  expectedContribution: number;
  unit: string;
  nonOverlappingScope: string;
  scopeKey: string;
  basis: string;
  kind: 'expected-increment';
}

export interface DecompositionViewCell {
  crossCellId: string;
  label: string;
  value: number;
  unit: string;
  basis: string;
  sourceRef?: string;
}

export interface DecompositionViewAssertion {
  viewId: string;
  viewName: string;
  metricId: string;
  period: string;
  coverageScope: string;
  reserveIncluded: number;
  cells: DecompositionViewCell[];
}

export interface DecompositionTimePeriod {
  periodId: string;
  granularity: 'month' | 'week' | 'day';
  label: string;
  startDate: string;
  endDate: string;
  targetValue: number | null;
  unit: string;
  status: 'planned' | 'undecided' | 'observing';
  checkpointId?: string;
  constraintNote?: string;
}

export interface DecompositionAlignmentRecord {
  alignedAt: string;
  alignedBy: string;
  basis: string;
  changes: { crossCellId: string; label: string; viewId: string; from: number; to: number }[];
}

export interface DecompositionDraft {
  draftId: string;
  goalId: string;
  gsaPlanId: string;
  gsaPlanVersion: number;
  gsaPlanSha256: string;
  revision: number;
  updatedAt: string;
  updatedBy: 'user' | 'agent';
  agentSource?: GoalRoleSuggestionRef;
  estimate: ReachabilityEstimate;
  rows: DecompositionRow[];
  reserves: DecompositionReserve[];
  gapStrategies: DecompositionGapStrategy[];
  views: DecompositionViewAssertion[];
  timePlan: DecompositionTimePeriod[];
  alignmentRecord?: DecompositionAlignmentRecord;
  notes?: string;
  contentSha256: string;
}

export interface DecompositionDraftInput {
  reviewedPreviousPlanVersion?:number;
  operationId?: string;
  gsaPlanId: string;
  gsaPlanVersion: number;
  gsaPlanSha256: string;
  expectedDraftRevision: number;
  estimate: ReachabilityEstimate;
  rows: DecompositionRow[];
  reserves: DecompositionReserve[];
  gapStrategies: DecompositionGapStrategy[];
  views: DecompositionViewAssertion[];
  timePlan: DecompositionTimePeriod[];
  notes?: string;
}

export interface DecompositionAlignmentInput {
  operationId: string;
  gsaPlanId: string;
  gsaPlanVersion: number;
  gsaPlanSha256: string;
  expectedDraftRevision: number;
  alignedBy: string;
  basis: string;
  cellUpdates: { crossCellId: string; value: number }[];
}

export interface DecompositionValidationIssue {
  code:
    | 'gsa_plan_required'
    | 'incomplete_reachability_estimate'
    | 'estimate_formal_target_mismatch'
    | 'incomplete_allocation_row'
    | 'invalid_ratio_rollup'
    | 'incomparable_checkpoint'
    | 'incomparable_time_plan'
    | 'incomparable_estimate_caliber'
    | 'incomparable_row_caliber'
    | 'incomparable_reserve_caliber'
    | 'incomparable_gap_caliber'
    | 'invalid_self_relation'
    | 'duplicate_linked_goal'
    | 'gsa_plan_mismatch'
    | 'invalid_reserve'
    | 'allocation_total_mismatch'
    | 'duplicate_cross_cell'
    | 'cross_view_conflict'
    | 'incomparable_view'
    | 'view_row_mismatch'
    | 'view_coverage_mismatch'
    | 'view_total_mismatch'
    | 'gap_not_covered'
    | 'overlapping_gap_scope'
    | 'invalid_gap_strategy'
    | 'invalid_ratio_rule'
    | 'invalid_milestone_rule'
    | 'invalid_commit_target'
    | 'missing_row_checkpoint'
    | 'row_cas_conflict';
  message: string;
  rowId?: string;
  crossCellId?: string;
  details?: Record<string, unknown>;
}

export interface DecompositionValidationResult {
  ok: boolean;
  allocatedTotal: number | null;
  reserveTotal: number;
  formalTargetValue: number;
  estimatedValue: number | null;
  gapValue: number | null;
  gapCoverageTotal: number;
  issues: DecompositionValidationIssue[];
}

export interface DecompositionFrozenCheckpoint {
  checkpointId: string;
  rowId: string;
  goalRef?: GoalRef;
  label: string;
  date: string;
  targetValue: number | null;
  unit: string;
  status: 'planned' | 'undecided' | 'observing';
  evidenceSource: string;
}

export interface DecompositionPublicationSnapshot {
  gsaPlan: GsaPlanVersion;
  estimate: ReachabilityEstimate;
  rows: DecompositionRow[];
  reserves: DecompositionReserve[];
  gapStrategies: DecompositionGapStrategy[];
  views: DecompositionViewAssertion[];
  timePlan: DecompositionTimePeriod[];
  frozenCheckpoints: DecompositionFrozenCheckpoint[];
  alignmentRecord?: DecompositionAlignmentRecord;
  notes?: string;
}

export interface DecompositionCommittedGoal {
  rowId: string;
  goalId: string;
  version: number;
  adoptedVersion: number;
  title: string;
  scope: GoalScope;
  responsible: string;
  strategy: string;
  targetValue: number | null;
  unit: string;
}

export interface DecompositionCommittedRelation {
  rowId: string;
  relationId: string;
  revision: number;
  from: GoalRef;
  to: GoalRef;
}

export interface DecompositionPublicationSummary {
  publicationId: string;
  goalId: string;
  version: number;
  gsaPlanId: string;
  gsaPlanVersion: number;
  gsaPlanSha256: string;
  draftRevision: number;
  draftSha256: string;
  snapshotSha256: string;
  operationId: string;
  publishedAt: string;
  reason?: string;
  previousVersion?: number;
  committedGoals: DecompositionCommittedGoal[];
  committedRelations: DecompositionCommittedRelation[];
}

export interface DecompositionPublication extends DecompositionPublicationSummary {
  snapshot: DecompositionPublicationSnapshot;
}

export interface DecompositionPublishPreview {
  ok: boolean;
  issues: DecompositionValidationIssue[];
  validation: DecompositionValidationResult;
  gsaPlan: GsaPlanVersion;
  draftRevision: number;
  draftSha256: string;
  previewSha256: string;
  expectedActiveVersion: number | null;
  nextPublicationVersion: number;
  committedGoals: {
    rowId: string;
    linkedGoalId?: string;
    expectedGoalVersion?: number;
    expectedAdoptedVersion?: number | null;
    relations: { id: string; revision: number; responsibility: string; rationale: string }[];
    action: 'create-and-adopt' | 'reuse-adopted' | 'revise-and-adopt';
    title: string;
    outcome: string;
    scope: GoalScope;
    responsible: string;
    strategy: string;
    targetValue: number | null;
    unit: string;
    checkpoints: DecompositionRowCheckpoint[];
  }[];
  summary: {
    formalTargetValue: number;
    estimatedValue: number | null;
    gapValue: number | null;
    allocatedTotal: number | null;
    reserveTotal: number;
    gapCoverageTotal: number;
  };
}

export interface DecompositionPublishInput {
  operationId: string;
  gsaPlanId: string;
  gsaPlanVersion: number;
  gsaPlanSha256: string;
  draftRevision: number;
  draftSha256: string;
  previewSha256?: string;
  expectedActiveVersion: number | null;
  reason?: string;
  explicitRetry?: boolean;
  expectedOperationStateRevision?: number;
}

export type DecompositionPublishOperationStatus = 'committed' | 'not-committed-retryable' | 'abandoned';

export interface DecompositionPublishOperationRecord {
  operationId: string;
  goalId: string;
  action: 'publish-decomposition';
  requestFingerprint: string;
  status: DecompositionPublishOperationStatus;
  attempts: number;
  startedAt: string;
  settledAt: string;
  publicationId?: string;
  publicationVersion?: number;
  failureCode?: string;
  failureDetail?: string;
  stateRevision: number;
}

export interface DecompositionOperationRecoveryResult {
  found: boolean;
  status: 'committed' | 'in-flight' | 'not-committed-retryable' | 'abandoned' | 'unknown';
  retryable: boolean;
  operation?: DecompositionPublishOperationRecord;
  publication?: DecompositionPublication;
}

export type DecompositionThresholdInput = Partial<DecompositionThresholdConfig> & { expectedGoalVersion?: number };

export interface DecompositionThresholdConfig {
  metricId?: string;
  periodGranularity?: 'month' | 'week' | 'day';
  configured: boolean;
  magnitudePct?: number;
  consecutivePeriods?: number;
  adverseDirection: 'below' | 'above';
  unit: 'percent' | 'percentage-points';
  updatedAt?: string;
}

export type ProgressComparability = 'comparable' | 'partial-missing' | 'incomparable' | 'observing';

export const MAX_GOAL_ACTUAL_REPORT_CHARS = 12_000;

export interface ProgressEvidenceBasis {
  metric: string;
  unit: string;
  scope: string;
  periodId: string;
  coverage: 'complete' | 'partial' | 'unknown';
  maturity: 'closed' | 'open' | 'unknown';
}

export interface ProgressComparisonPeriod {
  periodId: string;
  label: string;
  plannedValue: number | null;
  actualValue: number | null;
  absoluteDiff: number | null;
  variancePct: number | null;
}

export interface ProgressTriggerResult {
  type: 'magnitude' | 'consecutive' | 'none' | 'unconfigured' | 'incomparable';
  triggered: boolean;
  reason: string;
  consecutiveCount?: number;
}

export type ProgressCaseChoice =
  | { kind: 'observe'; note?: string; decidedAt: string }
  | { kind: 'supplement'; note?: string; decidedAt: string }
  | { kind: 'continue-existing'; caseId: string; note?: string; decidedAt: string }
  | { kind: 'create-new-draft'; intentId: string; note?: string; decidedAt: string };

export interface DecompositionProgressCheck {
  checkId: string;
  goalId: string;
  gsaPlanId: string;
  gsaPlanVersion: number;
  gsaPlanSha256: string;
  publicationId: string;
  publicationVersion: number;
  rowId: string;
  checkpointId: string;
  scopeKey: string;
  metricId: string;
  periodGranularity: 'month' | 'week' | 'day';
  periodSequenceKey: string;
  periodStartDate?: string;
  periodEndDate?: string;
  actualSource: {
    ref: string;
    label: string;
    cutoffAt: string;
    cutoffQuote?:string;
    coverageNote?: string;
    reportText?: string;
    basis?: ProgressEvidenceBasis;
  };
  assessmentNote?: string;
  evidenceQuote?: string;
  comparability: ProgressComparability;
  missingCoverageNote?: string;
  periods: ProgressComparisonPeriod[];
  overallPending: boolean;
  overallAbsoluteDiff: number | null;
  overallVariancePct: number | null;
  thresholdSnapshot: DecompositionThresholdConfig;
  trigger: ProgressTriggerResult;
  caseChoice: ProgressCaseChoice | null;
  caseStrategies?: string[];
  caseCandidatesUnavailable?: boolean;
  caseCandidates?: { caseId: string; title: string; strategy: string }[];
  supplementOfCheckId?: string;
  recordedAt: string;
  operationId: string;
}

export interface DecompositionProgressCheckInput {
  operationId: string;
  publicationVersion: number;
  rowId: string;
  checkpointId: string;
  metricId?: string;
  periodGranularity?: 'month' | 'week' | 'day';
  periodSequenceKey?: string;
  actualSource: {
    ref: string;
    label: string;
    cutoffAt: string;
    cutoffQuote?:string;
    coverageNote?: string;
    reportText?: string;
    basis?: ProgressEvidenceBasis;
  };
  assessmentNote?: string;
  evidenceQuote?: string;
  comparability: ProgressComparability;
  missingCoverageNote?: string;
  actualPeriods: { periodId: string; label?: string; actualValue: number | null }[];
  supplementOfCheckId?: string;
}

export type GoalActualInput = Omit<DecompositionProgressCheckInput, 'assessmentNote' | 'evidenceQuote' | 'comparability' | 'periodSequenceKey' | 'periodGranularity' | 'metricId'>;
export interface SubmittedGoalActual {
  actualId: string;
  goalVersion: number;
  input: GoalActualInput;
  submittedAt: string;
  assessment?:{status:'needs-cutoff';note:string};
}

export interface DecompositionCaseDraftIntent {
  intentId: string;
  operationId: string;
  goalId: string;
  goalRef: GoalRef;
  strategy: string;
  title: string;
  scope: GoalScope;
  period: string;
  kind: 'deviation-followup' | 'proactive-pilot';
  status: 'draft-pending-confirmation';
  checkId?: string;
  gsaPlanRef?: { planId: string; planVersion: number; contentSha256: string };
  publicationRef?: { publicationId: string; version: number; rowId: string; checkpointId: string };
  actualSourceRef?: string;
  evidenceSummary: string;
  createdAt: string;
}

export interface DecompositionCaseDraftIntentInput {
  operationId: string;
  intentId?: string;
  goalVersion?: number;
  strategy: string;
  title: string;
  kind: 'deviation-followup' | 'proactive-pilot';
  checkId?: string;
  evidenceSummary: string;
}

export interface DecompositionProjectHandoff {
  handoffId: string;
  operationId: string;
  goalId: string;
  goalRef: GoalRef;
  gsaPlanRef: { planId: string; planVersion: number; contentSha256: string };
  publicationId: string;
  publicationVersion: number;
  rowId: string;
  rowTitle: string;
  scope: GoalScope;
  responsible: string;
  strategy: string;
  targetValue: number | null;
  unit: string;
  checkpoint: DecompositionFrozenCheckpoint;
  projectPlanStatus: 'draft-reference-only';
  authorityStatus: 'not-authorized';
  linkedProjectId?: string;
  createdAt: string;
}

export interface DecompositionProjectHandoffPreview {
  ok: boolean;
  existing?: DecompositionProjectHandoff;
  goalRef: GoalRef;
  gsaPlanRef: { planId: string; planVersion: number; contentSha256: string };
  publicationId: string;
  publicationVersion: number;
  rowId: string;
  rowTitle: string;
  scope: GoalScope;
  responsible: string;
  strategy: string;
  targetValue: number | null;
  unit: string;
  checkpoint: DecompositionFrozenCheckpoint;
  note: string;
}

export interface DecompositionProjectHandoffInput {
  operationId: string;
  publicationVersion: number;
  rowId: string;
  checkpointId?: string;
  linkedProjectId?: string;
}

export interface CycleReviewConclusion {
  originalScope?:string;
  id: string;
  title: string;
  summary: string;
  sourceRef: string;
  applicableScope: string;
  evidenceMature: boolean;
  causalVerified: boolean;
  targetScopeSameAsOriginal: boolean;
  classification: 'confirmed-evidence' | 'hypothesis-unverified';
}

export interface DecompositionCycleReview {
  reviewId: string;
  operationId: string;
  goalId: string;
  period: string;
  initialFormalTarget: { goalRef: GoalRef; gsaPlanVersion?: number; value: number; unit: string; memoOnly: true };
  lastEffectiveFormalTarget: { goalRef: GoalRef; gsaPlanVersion?: number; value: number; unit: string };
  actualFinalValue: number | null;
  actualSourceRef: string;
  closingReport?:string;
  varianceValue: number | null;
  outcomeSummary: string;
  preservedCheckIds: string[];
  conclusions: CycleReviewConclusion[];
  recordedAt: string;
}

export interface GoalReviewDraft {
  period:string;
  revision:number;
  actualFinalValue:number|null;
  actualSourceRef:string;
  closingReport?:string;
  evidenceKeys:string[];
  conclusions:(CycleReviewConclusion & {discarded:boolean;selected:boolean})[];
}
export interface DecompositionCycleReviewInput {
  operationId: string;
  period: string;
  actualFinalValue: number | null;
  actualSourceRef: string;
  closingReport?:string;
  conclusions: {
    id: string;
    title: string;
    summary: string;
    sourceRef: string;
    applicableScope: string;
    originalScope?:string;
    evidenceMature: boolean;
    causalVerified: boolean;
    targetScopeSameAsOriginal?: boolean;
  }[];
}

export interface NextCycleDraft {
  draftId: string;
  operationId: string;
  sourceGoalId: string;
  sourceReviewId: string;
  nextPeriod: string;
  targetScope: GoalScope;
  selectedConclusions: CycleReviewConclusion[];
  status: 'draft-not-adopted';
  createdAt: string;
}

export interface NextCycleDraftInput {
  operationId: string;
  reviewId: string;
  nextPeriod: string;
  targetScope?: GoalScope;
  selectedConclusionIds: string[];
}

export interface StrategyReturnRecord {
  returnId: string;
  operationId: string;
  goalId: string;
  reviewId: string;
  reason: string;
  selectedConclusionIds: string[];
  evidenceRefs: string[];
  originalStrategyPublicationRef?: { initiativeId: string; publicationId: string; contentSha256: string };
  status: 'returned-for-review';
  createdAt: string;
}

export interface StrategyReturnInput {
  operationId: string;
  reviewId: string;
  reason: string;
  selectedConclusionIds: string[];
  evidenceRefs: string[];
}

export interface GoalWorkspaceView {
  latestGsaPlanVersion: number;
  latestDraftRevision: number;
  unavailablePublicationVersions?: number[];
  draftUnavailable?: boolean;
  goal: import('./strategy-goals-types.ts').StrategyGoalRecord;
  gsaPlans: GsaPlanVersion[];
  activeGsaPlan: GsaPlanVersion | null;
  gsaDraft: GsaPlanDraft | null;
  draft: DecompositionDraft | null;
  validation: DecompositionValidationResult | null;
  publications: DecompositionPublicationSummary[];
  activePublicationVersion: number | null;
  activePublication: DecompositionPublication | null;
  checks: DecompositionProgressCheck[];
  threshold: DecompositionThresholdConfig;
  thresholdStreams?: DecompositionThresholdConfig[];
  caseDraftIntents: DecompositionCaseDraftIntent[];
  handoffs: DecompositionProjectHandoff[];
  reviews: DecompositionCycleReview[];
  nextCycleDrafts: NextCycleDraft[];
  submittedActuals: SubmittedGoalActual[];
  strategyReturns: StrategyReturnRecord[];
  formalReconciliation?: {
    hasApplicableFormalPublication: boolean;
    manualTargetValue?: number;
    formalPublications: FormalGoalSelection[];
    formalPublication?: FormalGoalSelection;
  };
}

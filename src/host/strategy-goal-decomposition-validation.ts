import { allocatedTarget } from './strategy-goal-allocation.ts';
import { createHash } from 'node:crypto';
import type {
  CycleReviewConclusion,
  DecompositionDraft,
  DecompositionDraftInput,
  DecompositionFrozenCheckpoint,
  DecompositionGapStrategy,
  DecompositionProgressCheck,
  DecompositionReserve,
  DecompositionRow,
  DecompositionRowCheckpoint,
  DecompositionThresholdConfig,
  DecompositionTimePeriod,
  DecompositionValidationIssue,
  DecompositionValidationResult,
  DecompositionViewAssertion,
  GsaPlanVersion,
  GsaPlannedAction,
  GsaStageCheckpoint,
  GoalFormalOrigin,
  GoalMetricKind,
  ProgressComparability,
  ProgressComparisonPeriod,
  ProgressTriggerResult,
  ReachabilityEstimate,
  StrategicFormalGoal,
} from './strategy-goal-decomposition-types.ts';
import type { GoalScope, StrategyGoalRecord } from './strategy-goals-types.ts';

export class GoalDecompositionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(code: string, status = 400, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const EPS = 1e-6;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function fail(code: string, status = 400, details?: Record<string, unknown>): never {
  throw new GoalDecompositionError(code, status, details);
}

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter(k => v[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function sha256Canonical(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex');
}

export function reqUuid(v: unknown, code = 'invalid_operation_id'): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) fail(code, 400);
  return v;
}

export function reqText(v: unknown, max = 2000, code = 'invalid_decomposition_field'): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(code, 400);
  return v.trim();
}

export function optText(v: unknown, max = 2000, code = 'invalid_decomposition_field'): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return reqText(v, max, code);
}

export function reqFinite(v: unknown, code = 'invalid_decomposition_number'): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(code, 400);
  return v;
}

export function reqMetricKind(v: unknown): GoalMetricKind {
  if (v !== 'amount' && v !== 'ratio' && v !== 'milestone') fail('invalid_goal_metric_kind', 400);
  return v;
}

export function parseScope(v: unknown): GoalScope {
  if (!isObj(v) || (v.kind !== 'enterprise' && v.kind !== 'department' && v.kind !== 'personal')) {
    fail('invalid_goal_scope', 400);
  }
  const id = reqText(v.id, 300, 'invalid_goal_scope');
  const name = reqText(v.name, 300, 'invalid_goal_scope');
  const enterpriseId = v.enterpriseId === undefined ? undefined : reqUuid(v.enterpriseId, 'invalid_goal_scope');
  return { kind: v.kind, id, name, ...(enterpriseId ? { enterpriseId } : {}) };
}

export function parseStrategicFormalGoal(v: unknown): StrategicFormalGoal {
  if (!isObj(v)) fail('invalid_strategic_formal_goal', 400);
  const metricKind = reqMetricKind(v.metricKind);
  const targetValue = reqFinite(v.targetValue, 'invalid_strategic_formal_goal');
  let sapMetric: StrategicFormalGoal['sapMetric'];
  if (v.sapMetric !== undefined) {
    if (!isObj(v.sapMetric) || v.sapMetric.authority !== 'sap-metric') fail('invalid_strategic_formal_goal', 400);
    const version = reqText(v.sapMetric.version, 200, 'invalid_strategic_formal_goal');
    if (['latest', 'current'].includes(version.toLowerCase())) fail('invalid_strategic_formal_goal', 400);
    sapMetric = {
      authority: 'sap-metric',
      id: reqText(v.sapMetric.id, 300, 'invalid_strategic_formal_goal'),
      version,
      metricName: reqText(v.sapMetric.metricName, 200, 'invalid_strategic_formal_goal'),
    };
  }
  let baseline: StrategicFormalGoal['baseline'];
  if (v.baseline !== undefined) {
    if (!isObj(v.baseline) || (v.baseline.state !== 'known' && v.baseline.state !== 'pending')) fail('invalid_strategic_formal_goal', 400);
    baseline = {
      state: v.baseline.state,
      ...(v.baseline.value !== undefined ? { value: reqFinite(v.baseline.value, 'invalid_strategic_formal_goal') } : {}),
      description: reqText(v.baseline.description, 2000, 'invalid_strategic_formal_goal'),
    };
  }
  const strategies = v.strategies === undefined ? undefined : (Array.isArray(v.strategies) && v.strategies.length <= 50 ? v.strategies.map(s => reqText(s, 1000, 'invalid_strategic_formal_goal')) : fail('invalid_strategic_formal_goal', 400));
  return {
    id: reqText(v.id, 120, 'invalid_strategic_formal_goal'),
    title: reqText(v.title, 300, 'invalid_strategic_formal_goal'),
    outcome: reqText(v.outcome, 4000, 'invalid_strategic_formal_goal'),
    period: reqText(v.period, 100, 'invalid_strategic_formal_goal'),
    targetValue,
    unit: reqText(v.unit, 60, 'invalid_strategic_formal_goal'),
    metricKind,
    ...(sapMetric ? { sapMetric } : {}),
    ...(baseline ? { baseline } : {}),
    ...(strategies ? { strategies } : {}),
    ...(optText(v.responsible, 300) ? { responsible: optText(v.responsible, 300) } : {}),
    ...(optText(v.dueAt, 100) ? { dueAt: optText(v.dueAt, 100) } : {}),
  };
}

export function parseGoalFormalOrigin(v: unknown): GoalFormalOrigin {
  if (!isObj(v)) fail('invalid_goal_formal_origin', 400);
  const metricKind = reqMetricKind(v.metricKind);
  const targetValue = reqFinite(v.targetValue, 'invalid_goal_formal_origin');
  const unit = reqText(v.unit, 60, 'invalid_goal_formal_origin');
  const period = reqText(v.period, 100, 'invalid_goal_formal_origin');
  if (v.kind === 'strategy-publication') {
    if (typeof v.contentSha256 !== 'string' || !SHA256_RE.test(v.contentSha256)) fail('invalid_goal_formal_origin', 400);
    if (!Number.isSafeInteger(v.candidateNo) || Number(v.candidateNo) < 1) fail('invalid_goal_formal_origin', 400);
    return {
      kind: 'strategy-publication',
      initiativeId: reqUuid(v.initiativeId, 'invalid_goal_formal_origin'),
      publicationId: reqUuid(v.publicationId, 'invalid_goal_formal_origin'),
      candidateId: reqUuid(v.candidateId, 'invalid_goal_formal_origin'),
      candidateNo: Number(v.candidateNo),
      contentSha256: v.contentSha256,
      formalGoalId: reqText(v.formalGoalId, 120, 'invalid_goal_formal_origin'),
      targetValue,
      unit,
      period,
      metricKind,
    };
  }
  if (v.kind === 'manual-exception') {
    let preConfirmEstimateRef: Extract<GoalFormalOrigin, { kind: 'manual-exception' }>['preConfirmEstimateRef'];
    if (v.preConfirmEstimateRef !== undefined) {
      if (!isObj(v.preConfirmEstimateRef) || typeof v.preConfirmEstimateRef.sha256 !== 'string' || !SHA256_RE.test(v.preConfirmEstimateRef.sha256)) {
        fail('invalid_goal_formal_origin', 400);
      }
      preConfirmEstimateRef = {
        discussionId: reqUuid(v.preConfirmEstimateRef.discussionId, 'invalid_goal_formal_origin'),
        sessionId: reqText(v.preConfirmEstimateRef.sessionId, 200, 'invalid_goal_formal_origin'),
        entryId: reqText(v.preConfirmEstimateRef.entryId, 200, 'invalid_goal_formal_origin'),
        sha256: v.preConfirmEstimateRef.sha256,
      };
    }
    return {
      kind: 'manual-exception',
      reason: reqText(v.reason, 1000, 'invalid_goal_formal_origin'),
      period,
      targetValue,
      unit,
      metricKind,
      ...(preConfirmEstimateRef ? { preConfirmEstimateRef } : {}),
    };
  }
  return fail('invalid_goal_formal_origin', 400);
}

export function parsePlannedActions(v: unknown, requireNonEmpty: boolean): GsaPlannedAction[] {
  if (!Array.isArray(v) || v.length > 50) fail('invalid_gsa_planned_actions', 400);
  if (requireNonEmpty && v.length === 0) fail('gsa_planned_actions_required', 400);
  const seen = new Set<string>();
  return v.map((item, idx) => {
    if (!isObj(item)) fail('invalid_gsa_planned_actions', 400);
    const id = optText(item.id, 120) ?? `PA-${idx + 1}`;
    if (seen.has(id)) fail('invalid_gsa_planned_actions', 400);
    seen.add(id);
    return {
      id,
      summary: reqText(item.summary, 2000, 'invalid_gsa_planned_actions'),
      ...(optText(item.checkpoint, 300) ? { checkpoint: optText(item.checkpoint, 300) } : {}),
      ...(optText(item.observationBasis, 1000) ? { observationBasis: optText(item.observationBasis, 1000) } : {}),
    };
  });
}

export function parseStageCheckpoints(v: unknown): GsaStageCheckpoint[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50) fail('invalid_gsa_stage_checkpoints', 400);
  const seen = new Set<string>();
  return v.map((item, idx) => {
    if (!isObj(item)) fail('invalid_gsa_stage_checkpoints', 400);
    const id = optText(item.id, 120) ?? `CP-STAGE-${idx + 1}`;
    if (seen.has(id)) fail('invalid_gsa_stage_checkpoints', 400);
    seen.add(id);
    return {
      id,
      label: reqText(item.label, 300, 'invalid_gsa_stage_checkpoints'),
      ...(optText(item.targetDate, 100) ? { targetDate: optText(item.targetDate, 100) } : {}),
      ...(optText(item.observationBasis, 1000) ? { observationBasis: optText(item.observationBasis, 1000) } : {}),
    };
  });
}

export function parseReachabilityEstimate(v: unknown): ReachabilityEstimate {
  if (!isObj(v)) fail('invalid_reachability_estimate', 400);
  const metricKind = reqMetricKind(v.metricKind);
  const formalTargetValue = reqFinite(v.formalTargetValue, 'invalid_reachability_estimate');
  const estimatedValue = v.estimatedValue === null || v.estimatedValue === undefined ? null : reqFinite(v.estimatedValue, 'invalid_reachability_estimate');
  const computedGap = estimatedValue === null ? null : Number((formalTargetValue - estimatedValue).toFixed(6));
  const gapValue = v.gapValue === undefined ? computedGap : (v.gapValue === null ? null : reqFinite(v.gapValue, 'invalid_reachability_estimate'));
  if (estimatedValue !== null && gapValue !== null && Math.abs(gapValue - (formalTargetValue - estimatedValue)) > 1e-4) {
    fail('invalid_reachability_estimate_gap', 400);
  }
  const evidenceRaw = v.evidence ?? [];
  if (!Array.isArray(evidenceRaw) || evidenceRaw.length > 50) fail('invalid_reachability_estimate', 400);
  const evidence = evidenceRaw.map(item => {
    if (!isObj(item)) fail('invalid_reachability_estimate', 400);
    const category = item.category;
    if (!['internal', 'market', 'competitor', 'other'].includes(String(category))) fail('invalid_reachability_estimate', 400);
    return {
      category: category as ReachabilityEstimate['evidence'][number]['category'],
      summary: reqText(item.summary, 2000, 'invalid_reachability_estimate'),
      ...(optText(item.basis, 2000) ? { basis: optText(item.basis, 2000) } : {}),
      ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef as ReachabilityEstimate['evidence'][number]['sourceRef'] } : {}),
    };
  });
  const limitations = v.limitations === undefined ? undefined : (Array.isArray(v.limitations) && v.limitations.length <= 30 ? v.limitations.map(s => reqText(s, 1000)) : fail('invalid_reachability_estimate', 400));
  const scriptReceipts = v.scriptReceipts === undefined ? undefined : (Array.isArray(v.scriptReceipts) && v.scriptReceipts.length <= 20 ? v.scriptReceipts.map(r => {
    if (!isObj(r) || typeof r.outputSha256 !== 'string' || !SHA256_RE.test(r.outputSha256)) fail('invalid_reachability_estimate', 400);
    return {
      skill: reqText(r.skill, 100),
      script: reqText(r.script, 100),
      engineVersion: reqText(r.engineVersion, 100),
      inputDigest: reqText(r.inputDigest, 128),
      outputSha256: r.outputSha256,
      executedAt: reqText(r.executedAt, 100),
    };
  }) : fail('invalid_reachability_estimate', 400));
  return {
    metricKind,
    unit: reqText(v.unit, 60, 'invalid_reachability_estimate'),
    period: reqText(v.period, 100, 'invalid_reachability_estimate'),
    scopeDescription: reqText(v.scopeDescription, 300, 'invalid_reachability_estimate'),
    ...(v.scope !== undefined ? { scope: parseScope(v.scope) } : {}),
    ...(isObj(v.sapMetric) ? { sapMetric: { id: reqText(v.sapMetric.id, 300), version: reqText(v.sapMetric.version, 200), ...(optText(v.sapMetric.metricName, 200) ? { metricName: optText(v.sapMetric.metricName, 200) } : {}) } } : {}),
    formalTargetValue,
    estimatedValue,
    gapValue,
    ...(v.numerator !== undefined ? { numerator: reqFinite(v.numerator) } : {}),
    ...(v.denominator !== undefined ? { denominator: reqFinite(v.denominator) } : {}),
    ...(typeof v.denominatorAssumed === 'boolean' ? { denominatorAssumed: v.denominatorAssumed } : {}),
    basis: optText(v.basis, 4000, 'invalid_reachability_estimate') ?? '',
    evidence,
    ...(limitations ? { limitations } : {}),
    ...(optText(v.methodNote, 2000) ? { methodNote: optText(v.methodNote, 2000) } : {}),
    ...(scriptReceipts ? { scriptReceipts } : {}),
  };
}

function parseRowCheckpoint(v: unknown): DecompositionRowCheckpoint {
  if (!isObj(v)) fail('invalid_decomposition_checkpoint', 400);
  const status = v.status;
  if (status !== 'planned' && status !== 'undecided' && status !== 'observing') fail('invalid_decomposition_checkpoint', 400);
  const targetValue = v.targetValue === null || v.targetValue === undefined ? null : reqFinite(v.targetValue, 'invalid_decomposition_checkpoint');
  return {
    id: reqText(v.id, 120, 'invalid_decomposition_checkpoint'),
    label: reqText(v.label, 300, 'invalid_decomposition_checkpoint'),
    date: reqText(v.date, 40, 'invalid_decomposition_checkpoint'),
    targetValue,
    unit: reqText(v.unit, 60, 'invalid_decomposition_checkpoint'),
    status,
    evidenceSource: typeof v.evidenceSource === 'string' ? v.evidenceSource.trim().slice(0, 1000) : '',
  };
}

export function parseDecompositionDraftInput(raw: unknown): DecompositionDraftInput {
  if (!isObj(raw)) fail('invalid_decomposition_draft', 400);
  if (typeof raw.gsaPlanSha256 !== 'string' || !SHA256_RE.test(raw.gsaPlanSha256)) fail('invalid_decomposition_draft', 400);
  if (!Number.isSafeInteger(raw.gsaPlanVersion) || Number(raw.gsaPlanVersion) < 1) fail('invalid_decomposition_draft', 400);
  if (!Number.isSafeInteger(raw.expectedDraftRevision) || Number(raw.expectedDraftRevision) < 0) fail('invalid_decomposition_draft', 400);
  const estimate = parseReachabilityEstimate(raw.estimate);
  if (!Array.isArray(raw.rows) || raw.rows.length > 200) fail('invalid_decomposition_rows', 400);
  const seenRowIds = new Set<string>();
  const rows: DecompositionRow[] = raw.rows.map(item => {
    if (!isObj(item)) fail('invalid_decomposition_rows', 400);
    const rowId = reqText(item.rowId, 120, 'invalid_decomposition_rows');
    if (seenRowIds.has(rowId)) fail('duplicate_decomposition_row_id', 400);
    seenRowIds.add(rowId);
    const contributionNature = item.contributionNature;
    if (!['allocation', 'driver-hypothesis', 'aggregation', 'milestone'].includes(String(contributionNature))) fail('invalid_decomposition_rows', 400);
    const metricKind = reqMetricKind(item.metricKind);
    const targetValue = item.targetValue === null || item.targetValue === undefined ? null : reqFinite(item.targetValue, 'invalid_decomposition_rows');
    const checkpointsRaw = Array.isArray(item.checkpoints) ? item.checkpoints : [];
    if (checkpointsRaw.length > 60) fail('invalid_decomposition_checkpoint', 400);
    let ratio: DecompositionRow['ratio'];
    if (item.ratio !== undefined) {
      if (!isObj(item.ratio)) fail('invalid_decomposition_rows', 400);
      ratio = {
        numerator: reqFinite(item.ratio.numerator, 'invalid_decomposition_rows'),
        denominator: reqFinite(item.ratio.denominator, 'invalid_decomposition_rows'),
        denominatorAssumed: Boolean(item.ratio.denominatorAssumed),
        definition: reqText(item.ratio.definition, 1000, 'invalid_decomposition_rows'),
      };
    }
    let dimensions: Record<string, string> | undefined;
    if (item.dimensions !== undefined) {
      if (!isObj(item.dimensions)) fail('invalid_decomposition_rows', 400);
      dimensions = {};
      for (const [k, val] of Object.entries(item.dimensions)) {
        dimensions[reqText(k, 80)] = reqText(val, 200);
      }
    }
    return {
      rowId,
      ...(item.linkedGoalId !== undefined ? { linkedGoalId: reqUuid(item.linkedGoalId, 'invalid_decomposition_rows') } : {}),
      ...(item.expectedGoalVersion !== undefined ? { expectedGoalVersion: Number(item.expectedGoalVersion) } : {}),
      ...(item.expectedAdoptedVersion !== undefined ? { expectedAdoptedVersion: item.expectedAdoptedVersion === null ? null : Number(item.expectedAdoptedVersion) } : {}),
      title: reqText(item.title, 300, 'invalid_decomposition_rows'),
      outcome: reqText(item.outcome, 4000, 'invalid_decomposition_rows'),
      scope: parseScope(item.scope),
      scopeLabel: reqText(item.scopeLabel, 300, 'invalid_decomposition_rows'),
      responsible: reqText(item.responsible, 300, 'invalid_decomposition_rows'),
      strategy: reqText(item.strategy, 2000, 'invalid_decomposition_rows'),
      contributionNature: contributionNature as DecompositionRow['contributionNature'],
      commitAsGoal: Boolean(item.commitAsGoal),
      metricKind,
      targetValue,
      unit: reqText(item.unit, 60, 'invalid_decomposition_rows'),
      ...(ratio ? { ratio } : {}),
      ...(optText(item.milestoneCriterion, 2000) ? { milestoneCriterion: optText(item.milestoneCriterion, 2000) } : {}),
      ...(optText(item.crossCellId, 200) ? { crossCellId: optText(item.crossCellId, 200) } : {}),
      ...(dimensions ? { dimensions } : {}),
      basis: typeof item.basis === 'string' ? item.basis.trim().slice(0, 2000) : '',
      checkpoints: checkpointsRaw.map(parseRowCheckpoint),
      tracked: item.tracked !== false,
    };
  });

  const reservesRaw = Array.isArray(raw.reserves) ? raw.reserves : [];
  if (reservesRaw.length > 50) fail('invalid_decomposition_reserves', 400);
  const reserves: DecompositionReserve[] = reservesRaw.map((item, idx) => {
    if (!isObj(item)) fail('invalid_decomposition_reserves', 400);
    return {
      id: optText(item.id, 120) ?? `RES-${idx + 1}`,
      amount: reqFinite(item.amount, 'invalid_decomposition_reserves'),
      unit: reqText(item.unit, 60, 'invalid_decomposition_reserves'),
      purpose: typeof item.purpose === 'string' ? item.purpose.trim().slice(0, 1000) : '',
      owner: typeof item.owner === 'string' ? item.owner.trim().slice(0, 300) : '',
      ...(optText(item.basis, 1000) ? { basis: optText(item.basis, 1000) } : {}),
    };
  });

  const gapRaw = Array.isArray(raw.gapStrategies) ? raw.gapStrategies : [];
  if (gapRaw.length > 50) fail('invalid_decomposition_gap_strategies', 400);
  const gapStrategies: DecompositionGapStrategy[] = gapRaw.map((item, idx) => {
    if (!isObj(item)) fail('invalid_decomposition_gap_strategies', 400);
    return {
      id: optText(item.id, 120) ?? `GAP-${idx + 1}`,
      name: typeof item.name === 'string' ? item.name.trim().slice(0, 300) : '',
      strategy: typeof item.strategy === 'string' ? item.strategy.trim().slice(0, 2000) : '',
      expectedContribution: reqFinite(item.expectedContribution, 'invalid_decomposition_gap_strategies'),
      unit: reqText(item.unit, 60, 'invalid_decomposition_gap_strategies'),
      nonOverlappingScope: typeof item.nonOverlappingScope === 'string' ? item.nonOverlappingScope.trim().slice(0, 1000) : '',
      scopeKey: typeof item.scopeKey === 'string' ? item.scopeKey.trim().toLowerCase().slice(0, 200) : '',
      basis: typeof item.basis === 'string' ? item.basis.trim().slice(0, 2000) : '',
      kind: 'expected-increment',
    };
  });

  const viewsRaw = Array.isArray(raw.views) ? raw.views : [];
  if (viewsRaw.length > 20) fail('invalid_decomposition_views', 400);
  const views: DecompositionViewAssertion[] = viewsRaw.map(view => {
    if (!isObj(view) || !Array.isArray(view.cells) || view.cells.length > 200) fail('invalid_decomposition_views', 400);
    return {
      viewId: reqText(view.viewId, 120, 'invalid_decomposition_views'),
      viewName: reqText(view.viewName, 200, 'invalid_decomposition_views'),
      metricId: reqText(view.metricId, 200, 'invalid_decomposition_views'),
      period: reqText(view.period, 100, 'invalid_decomposition_views'),
      coverageScope: reqText(view.coverageScope, 200, 'invalid_decomposition_views'),
      reserveIncluded: reqFinite(view.reserveIncluded ?? 0, 'invalid_decomposition_views'),
      cells: view.cells.map(cell => {
        if (!isObj(cell)) fail('invalid_decomposition_views', 400);
        return {
          crossCellId: reqText(cell.crossCellId, 200, 'invalid_decomposition_views'),
          label: reqText(cell.label, 300, 'invalid_decomposition_views'),
          value: reqFinite(cell.value, 'invalid_decomposition_views'),
          unit: reqText(cell.unit, 60, 'invalid_decomposition_views'),
          basis: reqText(cell.basis, 2000, 'invalid_decomposition_views'),
          ...(optText(cell.sourceRef, 500) ? { sourceRef: optText(cell.sourceRef, 500) } : {}),
        };
      }),
    };
  });

  const timeRaw = Array.isArray(raw.timePlan) ? raw.timePlan : [];
  if (timeRaw.length > 400) fail('invalid_decomposition_time_plan', 400);
  const timePlan: DecompositionTimePeriod[] = timeRaw.map(period => {
    if (!isObj(period)) fail('invalid_decomposition_time_plan', 400);
    if (!['month', 'week', 'day'].includes(String(period.granularity))) fail('invalid_decomposition_time_plan', 400);
    if (!['planned', 'undecided', 'observing'].includes(String(period.status))) fail('invalid_decomposition_time_plan', 400);
    const targetValue = period.targetValue === null || period.targetValue === undefined ? null : reqFinite(period.targetValue, 'invalid_decomposition_time_plan');
    return {
      periodId: reqText(period.periodId, 120, 'invalid_decomposition_time_plan'),
      granularity: period.granularity as DecompositionTimePeriod['granularity'],
      label: reqText(period.label, 200, 'invalid_decomposition_time_plan'),
      startDate: reqText(period.startDate, 40, 'invalid_decomposition_time_plan'),
      endDate: reqText(period.endDate, 40, 'invalid_decomposition_time_plan'),
      targetValue,
      unit: reqText(period.unit, 60, 'invalid_decomposition_time_plan'),
      status: period.status as DecompositionTimePeriod['status'],
      ...(optText(period.checkpointId, 120) ? { checkpointId: optText(period.checkpointId, 120) } : {}),
      ...(optText(period.constraintNote, 1000) ? { constraintNote: optText(period.constraintNote, 1000) } : {}),
    };
  });

  return {
    ...(raw.operationId !== undefined ? { operationId: reqUuid(raw.operationId) } : {}),
    gsaPlanId: reqUuid(raw.gsaPlanId, 'invalid_decomposition_draft'),
    gsaPlanVersion: Number(raw.gsaPlanVersion),
    gsaPlanSha256: raw.gsaPlanSha256,
    expectedDraftRevision: Number(raw.expectedDraftRevision),
    estimate,
    rows,
    reserves,
    gapStrategies,
    views,
    timePlan,
    ...(optText(raw.notes, 4000) ? { notes: optText(raw.notes, 4000) } : {}),
  };
}

/** Deterministic Host publish validator (GM04, GM05, GM06, GM07, GM13). Host never auto-balances or picks business options. */
export function validateDecompositionForPublish(
  gsaPlan: GsaPlanVersion | null,
  draft: DecompositionDraft,
  existingGoals?: readonly StrategyGoalRecord[],
): DecompositionValidationResult {
  const issues: DecompositionValidationIssue[] = [];
  const formalTargetValue = gsaPlan?.formalTarget.value ?? draft.estimate.formalTargetValue;
  const formalUnit = gsaPlan?.formalTarget.unit ?? draft.estimate.unit;
  const formalPeriod = gsaPlan?.formalTarget.period ?? draft.estimate.period;
  const metricKind = gsaPlan?.formalTarget.metricKind ?? draft.estimate.metricKind;

  const goal = existingGoals?.find(record => record.id === gsaPlan?.goal.goalId)?.versions.find(version => version.version === gsaPlan?.goal.version);
  const estimate = draft.estimate;
  const expectedMetric = goal?.measurement.kind === 'quantitative' ? goal.measurement.sapMetric : undefined;
  const matchesScope = !goal || (estimate.scope
    ? estimate.scope.kind === goal.scope.kind && estimate.scope.id === goal.scope.id && estimate.scope.enterpriseId === goal.scope.enterpriseId
    : estimate.scopeDescription === goal.scope.name);
  const matchesMetric = !goal || (estimate.sapMetric?.id === expectedMetric?.id && estimate.sapMetric?.version === expectedMetric?.version && estimate.sapMetric?.metricName === expectedMetric?.metricName);
  const estimateCaliberOk = matchesScope && matchesMetric && estimate.unit === formalUnit && estimate.period === formalPeriod && estimate.metricKind === metricKind;
  if (!estimateCaliberOk) {
    issues.push({ code: 'incomparable_estimate_caliber', message: '测算的指标定义、范围、单位和期间须与总目标一致，请核对后再计算差额。' });
  }
  const estimatedValue = estimateCaliberOk ? estimate.estimatedValue : null;
  const gapValue = estimatedValue === null ? null : Number((formalTargetValue - estimatedValue).toFixed(6));
  if (estimate.estimatedValue === null || !estimate.basis.trim()) {
    issues.push({ code: 'incomplete_reachability_estimate', message: '请补充可达测算及其依据后再发布。' });
  }
  if (estimate.formalTargetValue !== formalTargetValue || (gapValue !== null && (estimate.gapValue === null || Math.abs(estimate.gapValue - gapValue) > EPS))) {
    issues.push({ code: 'estimate_formal_target_mismatch', message: '草稿的正式值和差额须与准确 GSA 及其同口径测算一致，请核对草稿。' });
  }

  const allocationRows = draft.rows.filter(r => r.contributionNature === 'allocation');
  let rowCaliberOk = true;
  for (const row of allocationRows) {
    if (row.targetValue === null) {
      issues.push({ code: 'incomplete_allocation_row', rowId: row.rowId, message: `正式分配行 ${row.rowId} 缺目标值。` });
    }
    if (row.unit !== formalUnit || row.metricKind !== metricKind) {
      rowCaliberOk = false;
      issues.push({
        code: 'incomparable_row_caliber',
        rowId: row.rowId,
        message: `正式分配行 ${row.rowId} 口径（${row.metricKind} / ${row.unit}）与总目标口径（${metricKind} / ${formalUnit}）不一致，不能直接汇总相加。`,
        details: { rowId: row.rowId, rowMetricKind: row.metricKind, rowUnit: row.unit, formalMetricKind: metricKind, formalUnit },
      });
    }
  }
  let reserveCaliberOk = true;
  for (const res of draft.reserves) {
    if (res.unit !== formalUnit) {
      reserveCaliberOk = false;
      issues.push({
        code: 'incomparable_reserve_caliber',
        message: `预留 ${res.id} 单位（${res.unit}）与总目标单位（${formalUnit}）不一致，不能直接计入同口径合计。`,
        details: { reserveId: res.id, reserveUnit: res.unit, formalUnit },
      });
    }
  }
  for (const g of draft.gapStrategies) {
    if (g.unit !== formalUnit) {
      issues.push({
        code: 'incomparable_gap_caliber',
        message: `补缺策略 ${g.id} 单位（${g.unit}）与总目标单位（${formalUnit}）不一致，不能直接抵扣测算缺口。`,
        details: { gapStrategyId: g.id, gapUnit: g.unit, formalUnit },
      });
    }
  }

  const allocatedTotal = allocatedTarget(draft.rows, metricKind, formalUnit);
  const reserveTotal = Number(draft.reserves.filter(r => r.unit === formalUnit).reduce((sum, r) => sum + r.amount, 0).toFixed(6));
  const gapCoverageTotal = Number(draft.gapStrategies.filter(g => g.unit === formalUnit).reduce((sum, g) => sum + g.expectedContribution, 0).toFixed(6));

  if (!gsaPlan || gsaPlan.plannedActions.length === 0) {
    issues.push({ code: 'gsa_plan_required', message: '总目标 GSA（含 G、S 与上层计划 A）尚未确认，不能发布拆解表。' });
  } else if (
    draft.gsaPlanId !== gsaPlan.planId ||
    draft.gsaPlanVersion !== gsaPlan.planVersion ||
    draft.gsaPlanSha256 !== gsaPlan.contentSha256
  ) {
    issues.push({
      code: 'gsa_plan_mismatch',
      message: '草稿依据的总 GSA 计划版已过期，请先按最新确认的 GSA 计划核对后再发布。',
      details: { draftGsaPlanVersion: draft.gsaPlanVersion, currentGsaPlanVersion: gsaPlan.planVersion },
    });
  }

  // Prevent duplicate cross-cell allocation rows (double counting across channel/category views)
  const seenCrossCells = new Set<string>();
  for (const row of allocationRows) {
    if (row.crossCellId) {
      if (seenCrossCells.has(row.crossCellId)) {
        issues.push({
          code: 'duplicate_cross_cell',
          rowId: row.rowId,
          crossCellId: row.crossCellId,
          message: `交叉单元 ${row.crossCellId} 在正式分配行中重复出现，不能重复计入总目标。`,
        });
      }
      seenCrossCells.add(row.crossCellId);
    }
  }

  // Validate reserves: every reserve must have positive amount, non-empty purpose, and non-empty owner
  for (const res of draft.reserves) {
    if (res.amount <= 0 || !res.purpose.trim() || !res.owner.trim()) {
      issues.push({
        code: 'invalid_reserve',
        message: `预留 ${res.id} 必须填写大于 0 的金额、明确用途与责任人，余额不能自动作为合法预留。`,
        details: { reserveId: res.id, amount: res.amount, purpose: res.purpose, owner: res.owner },
      });
    }
  }

  // Metric-specific rules (GM04 / GM06) — only sum amounts after same-caliber check passes
  if (metricKind === 'amount' && allocatedTotal !== null && rowCaliberOk && reserveCaliberOk) {
    const combined = Number((allocatedTotal + reserveTotal).toFixed(6));
    if (Math.abs(combined - formalTargetValue) > EPS) {
      issues.push({
        code: 'allocation_total_mismatch',
        message: `同口径已分配 (${allocatedTotal}) + 明确预留 (${reserveTotal}) = ${combined}，与正式目标 (${formalTargetValue}) 不相等，差额 ${Number((formalTargetValue - combined).toFixed(6))}；Host 不自动平差。`,
        details: { allocatedTotal, reserveTotal, combined, formalTargetValue, balance: Number((formalTargetValue - combined).toFixed(6)) },
      });
    }
  }
  for (const row of draft.rows) {
    if ((metricKind === 'ratio' && row.contributionNature === 'allocation') || row.metricKind === 'ratio') {
      if (!row.ratio || !Number.isFinite(row.ratio.numerator) || !Number.isFinite(row.ratio.denominator) || row.ratio.denominator <= 0) {
        issues.push({
          code: 'invalid_ratio_rule',
          rowId: row.rowId,
          message: `比率目标行 ${row.rowId} 必须显式提供同口径分子与正数分母，不能简单平均各门店比率。`,
        });
      } else if (row.targetValue !== null) {
        const expected = /%|％|百分/.test(row.unit)
          ? (row.ratio.numerator / row.ratio.denominator) * 100
          : row.ratio.numerator / row.ratio.denominator;
        if (Math.abs(expected - row.targetValue) > 0.05) {
          issues.push({
            code: 'invalid_ratio_rule',
            rowId: row.rowId,
            message: `比率目标行 ${row.rowId} 目标值 (${row.targetValue}${row.unit}) 与同口径分子/分母比值 (${Number(expected.toFixed(4))}${row.unit}) 不一致。`,
          });
        }
      }
    }
    if (metricKind === 'milestone' || row.contributionNature === 'milestone' || row.metricKind === 'milestone') {
      if ((row.contributionNature === 'milestone' || row.metricKind === 'milestone') && !row.milestoneCriterion?.trim()) {
        issues.push({
          code: 'invalid_milestone_rule',
          rowId: row.rowId,
          message: `里程碑目标行 ${row.rowId} 必须提供明确的成果核对标准，不能套用销售额相加规则。`,
        });
      }
    }
  }

  if (metricKind === 'ratio' && (allocatedTotal === null || Math.abs(allocatedTotal - formalTargetValue) > EPS)) {
    issues.push({ code: 'invalid_ratio_rollup', message: '同定义分配行的分子之和除以分母之和，须与正式比率目标一致。' });
  }
  for (const row of draft.rows) {
    if (row.checkpoints.some(checkpoint => checkpoint.unit !== row.unit)) {
      issues.push({ code: 'incomparable_checkpoint', rowId: row.rowId, message: `检查点与责任行 ${row.rowId} 单位不一致。` });
    }
  }
  for (const period of draft.timePlan) {
    if (period.unit !== formalUnit) {
      issues.push({ code: 'incomparable_time_plan', message: `期间 ${period.label} 的单位与正式目标不一致。` });
    }
  }
  // Cross-view consistency checks (GM07)
  const allocationCells = new Set(allocationRows.map(row => row.crossCellId));
  for (const view of draft.views) {
    const viewCellIds = new Set<string>();
    for (const cell of view.cells) {
      if (cell.unit !== formalUnit || view.period !== formalPeriod) {
        issues.push({ code: 'incomparable_view', crossCellId: cell.crossCellId, message: `视图「${view.viewName}」交叉项「${cell.label}」的单位或期间与正式目标不同。` });
      }
      if (viewCellIds.has(cell.crossCellId)) {
        issues.push({
          code: 'duplicate_cross_cell',
          crossCellId: cell.crossCellId,
          message: `视图「${view.viewName}」中交叉单元 ${cell.crossCellId} 重复出现，不能重复计入汇总。`,
          details: { viewId: view.viewId, crossCellId: cell.crossCellId },
        });
      }
      viewCellIds.add(cell.crossCellId);
    }
    if (metricKind === 'amount') {
      if (allocationCells.has(undefined) || viewCellIds.size !== allocationCells.size || [...viewCellIds].some(id => !allocationCells.has(id))) {
        issues.push({ code: 'view_coverage_mismatch', message: `视图「${view.viewName}」与正式分配行的交叉单元覆盖不一致。` });
      }
      if (view.period === formalPeriod && view.cells.every(cell => cell.unit === formalUnit)) {
        const total = view.cells.reduce((sum, cell) => sum + cell.value, view.reserveIncluded);
        if (Math.abs(total - formalTargetValue) > EPS || Math.abs(view.reserveIncluded - reserveTotal) > EPS) {
          issues.push({ code: 'view_total_mismatch', message: `视图「${view.viewName}」的预留或分配合计与正式计划不一致。`,
            details: { viewId: view.viewId, total, formalTargetValue, includedReserve: view.reserveIncluded, reserveTotal } });
        }
      }
    }
  }
  if (draft.views.length >= 2) {
    const first = draft.views[0]!;
    for (let i = 1; i < draft.views.length; i++) {
      const other = draft.views[i]!;
      if (other.metricId !== first.metricId || other.period !== first.period || other.coverageScope !== first.coverageScope) {
        issues.push({
          code: 'incomparable_view',
          message: `视图「${first.viewName}」与「${other.viewName}」的指标、期间或覆盖范围不一致，不可直接合并或抵消。`,
          details: {
            left: { viewId: first.viewId, metricId: first.metricId, period: first.period, coverageScope: first.coverageScope },
            right: { viewId: other.viewId, metricId: other.metricId, period: other.period, coverageScope: other.coverageScope },
          },
        });
        continue;
      }
      const leftByCell = new Map(first.cells.map(c => [c.crossCellId, c]));
      const rightByCell = new Map(other.cells.map(c => [c.crossCellId, c]));
      const allCellIds = [...new Set([...leftByCell.keys(), ...rightByCell.keys()])];
      for (const crossCellId of allCellIds) {
        const left = leftByCell.get(crossCellId);
        const right = rightByCell.get(crossCellId);
        if (!left || !right) {
          issues.push({
            code: 'cross_view_conflict',
            crossCellId,
            message: `同口径交叉单元 ${crossCellId} 在「${first.viewName}」与「${other.viewName}」中覆盖不一致。`,
            details: { crossCellId, left: left ?? null, right: right ?? null },
          });
        } else if (left.unit === right.unit && Math.abs(left.value - right.value) > EPS) {
          issues.push({
            code: 'cross_view_conflict',
            crossCellId,
            message: `同口径交叉项「${left.label}」冲突：${first.viewName}为 ${left.value}${left.unit}（${left.basis}），${other.viewName}为 ${right.value}${right.unit}（${right.basis}）；不可用预留或缺口抵消，须双方协商一致后重汇总。`,
            details: {
              crossCellId,
              label: left.label,
              left: { viewId: first.viewId, viewName: first.viewName, value: left.value, unit: left.unit, basis: left.basis },
              right: { viewId: other.viewId, viewName: other.viewName, value: right.value, unit: right.unit, basis: right.basis },
              diff: Number((left.value - right.value).toFixed(6)),
            },
          });
        }
      }
    }
  }
  {
    // A single submitted view must agree with the responsibility rows as well.
    const rowByCell = new Map(allocationRows.filter(r => r.crossCellId).map(r => [r.crossCellId!, r]));
    for (const view of draft.views) {
      for (const cell of view.cells) {
        const row = rowByCell.get(cell.crossCellId);
        if (row && row.unit === cell.unit && row.targetValue !== null && Math.abs(row.targetValue - cell.value) > EPS) {
          issues.push({
            code: 'view_row_mismatch',
            rowId: row.rowId,
            crossCellId: cell.crossCellId,
            message: `目标行 ${row.rowId}（${row.targetValue}${row.unit}）与视图「${view.viewName}」的交叉单元 ${cell.label}（${cell.value}${cell.unit}）不一致。`,
          });
        }
      }
    }
  }

  // Reachability gap coverage (GM06): only positive same-caliber gaps require non-overlapping expected-increment strategies
  if (estimateCaliberOk && gapValue !== null && gapValue > EPS) {
    const scopeKeys = new Set<string>();
    for (const g of draft.gapStrategies) {
      if (!g.name.trim() || !g.strategy.trim() || !g.nonOverlappingScope.trim() || !g.scopeKey.trim() || !g.basis.trim() || g.expectedContribution <= 0) {
        issues.push({
          code: 'invalid_gap_strategy',
          message: `补缺策略 ${g.id} 必须填写名称、策略、不重叠范围、依据及大于 0 的预期贡献。`,
          details: { gapStrategyId: g.id },
        });
      } else if (scopeKeys.has(g.scopeKey)) {
        issues.push({
          code: 'overlapping_gap_scope',
          message: `补缺策略范围 ${g.scopeKey} 存在重叠，不能重复计入补缺贡献。`,
          details: { gapStrategyId: g.id, scopeKey: g.scopeKey },
        });
      } else {
        scopeKeys.add(g.scopeKey);
      }
    }
    if (gapCoverageTotal + EPS < gapValue) {
      issues.push({
        code: 'gap_not_covered',
        message: `测算缺口为 ${gapValue}${formalUnit}，当前不重叠补缺策略预期贡献合计 ${gapCoverageTotal}${formalUnit}，尚未覆盖正缺口。`,
        details: { gapValue, gapCoverageTotal, shortfall: Number((gapValue - gapCoverageTotal).toFixed(6)) },
      });
    }
  }

  // Row commitment rules, tracked checkpoints, relation invariants (Item 3), and row-level CAS
  const goalsById = existingGoals ? new Map(existingGoals.map(g => [g.id, g])) : undefined;
  const seenLinkedGoalIds = new Set<string>();
  for (const row of draft.rows) {
    if (row.commitAsGoal && (row.contributionNature === 'aggregation' || (row.checkpoints.length > 0 && row.checkpoints.every(cp => cp.status === 'undecided')))) {
      issues.push({
        code: 'invalid_commit_target',
        rowId: row.rowId,
        message: `聚合投影或待定行 ${row.rowId} 不能自动采用为正式目标。`,
      });
    }
    if (row.tracked && row.commitAsGoal) {
      const validCheckpoint = row.checkpoints.some(cp => cp.id.trim() && cp.date.trim() && cp.evidenceSource.trim());
      if (!validCheckpoint) {
        issues.push({
          code: 'missing_row_checkpoint',
          rowId: row.rowId,
          message: `纳入跟进的正式目标行 ${row.rowId} 至少需要一个含明确日期与证据来源的检查点。`,
        });
      }
    }
    if (row.commitAsGoal && row.linkedGoalId) {
      if (gsaPlan && row.linkedGoalId === gsaPlan.goal.goalId) {
        issues.push({
          code: 'invalid_self_relation',
          rowId: row.rowId,
          message: `子目标行 ${row.rowId} 不能关联父目标自身（${row.linkedGoalId}），禁止产生自关联关系。`,
          details: { rowId: row.rowId, linkedGoalId: row.linkedGoalId },
        });
      }
      if (seenLinkedGoalIds.has(row.linkedGoalId)) {
        issues.push({
          code: 'duplicate_linked_goal',
          rowId: row.rowId,
          message: `子目标 ${row.linkedGoalId} 在多条正式承诺行中重复关联，不能重复提交同一子目标。`,
          details: { rowId: row.rowId, linkedGoalId: row.linkedGoalId },
        });
      }
      seenLinkedGoalIds.add(row.linkedGoalId);
      if (goalsById) {
        const existing = goalsById.get(row.linkedGoalId);
        if (!existing) {
          issues.push({
            code: 'row_cas_conflict',
            rowId: row.rowId,
            message: `子目标 ${row.rowId} 引用的原目标 ${row.linkedGoalId} 不存在。`,
          });
        } else if (
          (row.expectedGoalVersion !== undefined && existing.currentVersion !== row.expectedGoalVersion) ||
          (row.expectedAdoptedVersion !== undefined && existing.adoptedVersion !== row.expectedAdoptedVersion)
        ) {
          issues.push({
            code: 'row_cas_conflict',
            rowId: row.rowId,
            message: `子目标 ${row.rowId}（${existing.id}）已在原目标页发生并发变更（当前 v${existing.currentVersion} / 采用 v${existing.adoptedVersion ?? '无'}），请先核对差异，不能静默覆盖。`,
            details: {
              goalId: existing.id,
              expectedGoalVersion: row.expectedGoalVersion,
              actualGoalVersion: existing.currentVersion,
              expectedAdoptedVersion: row.expectedAdoptedVersion,
              actualAdoptedVersion: existing.adoptedVersion,
            },
          });
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    allocatedTotal,
    reserveTotal,
    formalTargetValue,
    estimatedValue,
    gapValue,
    gapCoverageTotal,
    issues,
  };
}

export function freezeRowCheckpoints(rows: readonly DecompositionRow[]): DecompositionFrozenCheckpoint[] {
  const result: DecompositionFrozenCheckpoint[] = [];
  for (const row of rows) {
    for (const cp of row.checkpoints) {
      result.push({
        checkpointId: cp.id,
        rowId: row.rowId,
        ...(row.linkedGoalId && row.expectedAdoptedVersion ? { goalRef: { goalId: row.linkedGoalId, version: row.expectedAdoptedVersion } } : {}),
        label: cp.label,
        date: cp.date,
        targetValue: cp.targetValue,
        unit: cp.unit,
        status: cp.status,
        evidenceSource: cp.evidenceSource,
      });
    }
  }
  return result;
}

/** Deterministic progress evaluation & threshold triggering (GM10, GM11). */
export function evaluateProgressComparison(options: {
  comparability: ProgressComparability;
  plannedPeriods: { periodId: string; label: string; plannedValue: number | null; status?: string }[];
  actualPeriods: { periodId: string; label?: string; actualValue: number | null }[];
  threshold: DecompositionThresholdConfig;
  priorChecks: readonly DecompositionProgressCheck[];
  scopeKey: string;
  metricId: string;
  periodGranularity: 'month' | 'week' | 'day';
  periodStartDate: string;
  supplementOfCheckId?: string;
}): {
  periods: ProgressComparisonPeriod[];
  overallPending: boolean;
  overallAbsoluteDiff: number | null;
  overallVariancePct: number | null;
  trigger: ProgressTriggerResult;
} {
  const {
    comparability,
    plannedPeriods,
    actualPeriods,
    threshold,
    priorChecks,
    scopeKey,
    metricId,
    periodGranularity,
    periodStartDate,
    supplementOfCheckId,
  } = options;
  const actualById = new Map(actualPeriods.map(p => [p.periodId, p]));
  const incomparable = comparability !== 'comparable';

  const periods: ProgressComparisonPeriod[] = plannedPeriods.map(plan => {
    const act = actualById.get(plan.periodId);
    const actualValue = act?.actualValue ?? null;
    if (incomparable || plan.plannedValue === null || actualValue === null) {
      return {
        periodId: plan.periodId,
        label: act?.label || plan.label,
        plannedValue: plan.plannedValue,
        actualValue,
        absoluteDiff: null,
        variancePct: null,
      };
    }
    const absoluteDiff = Number((actualValue - plan.plannedValue).toFixed(6));
    // Zero planned target MUST NOT fabricate a percentage by dividing by zero!
    const variancePct = Math.abs(plan.plannedValue) <= EPS
      ? null
      : Number((((actualValue - plan.plannedValue) / plan.plannedValue) * 100).toFixed(4));
    return {
      periodId: plan.periodId,
      label: act?.label || plan.label,
      plannedValue: plan.plannedValue,
      actualValue,
      absoluteDiff,
      variancePct,
    };
  });

  if (incomparable) {
    return {
      periods,
      overallPending: true,
      overallAbsoluteDiff: null,
      overallVariancePct: null,
      trigger: {
        type: 'incomparable',
        triggered: false,
        reason: comparability === 'partial-missing'
          ? '实绩存在缺失覆盖，仅报已覆盖范围与整体待核，不补零、不计算整体偏差且不计入已确认偏离期。'
          : comparability === 'observing'
            ? '观察窗未满，当前保持待观察，不计作已确认偏离。'
            : '实绩口径或期间不可比，保持整体待核，不计作已确认偏离期。',
      },
    };
  }

  const last = periods.at(-1);
  const overallAbsoluteDiff = last?.absoluteDiff ?? null;
  const overallVariancePct = last?.variancePct ?? null;

  if (!threshold.configured) {
    return {
      periods,
      overallPending: false,
      overallAbsoluteDiff,
      overallVariancePct,
      trigger: {
        type: 'unconfigured',
        triggered: false,
        reason: '已完成可比偏差计算；尚未配置 Case 提示阈值，不阻断检查。',
      },
    };
  }

  const isAdverse = (diff: number | null) => {
    if (diff === null) return false;
    return threshold.adverseDirection === 'below' ? diff < -EPS : diff > EPS;
  };
  const adverseMagnitude = (value: number | null) => {
    if (value === null) return 0;
    return threshold.adverseDirection === 'below' ? Math.max(0, -value) : Math.max(0, value);
  };

  // Check magnitude threshold on latest comparable period (percentage-points uses absoluteDiff; percent uses variancePct)
  const lastMetricForThreshold = last ? (threshold.unit === 'percentage-points' ? last.absoluteDiff : last.variancePct) : null;
  if (threshold.magnitudePct !== undefined && last && isAdverse(last.absoluteDiff) && adverseMagnitude(lastMetricForThreshold) + 1e-8 >= threshold.magnitudePct) {
    return {
      periods,
      overallPending: false,
      overallAbsoluteDiff,
      overallVariancePct,
      trigger: {
        type: 'magnitude',
        triggered: true,
        reason: `本期不利偏差达到 ${threshold.magnitudePct}${threshold.unit === 'percentage-points' ? ' 个百分点' : '%'} 幅度阈值。`,
      },
    };
  }

  // Count consecutive adverse periods within this check AND strictly adjacent prior mature comparable checks of same scope/metric/granularity
  let consecutiveInCurrent = 0;
  for (let i = periods.length - 1; i >= 0; i--) {
    if (isAdverse(periods[i]!.absoluteDiff)) consecutiveInCurrent++;
    else break;
  }

  let consecutiveTotal = consecutiveInCurrent;
  if (consecutiveInCurrent > 0) {
    const replaced = new Set(priorChecks.map(c => c.supplementOfCheckId));
    if (supplementOfCheckId) replaced.add(supplementOfCheckId);
    const priorByEnd = new Map<string, DecompositionProgressCheck>();
    for (const check of priorChecks) {
      if (!replaced.has(check.checkId) && check.scopeKey === scopeKey && check.metricId === metricId &&
          check.periodGranularity === periodGranularity && check.periodStartDate && check.periodEndDate &&
          check.periodStartDate <= check.periodEndDate) priorByEnd.set(check.periodEndDate, check);
    }
    let start = periodStartDate;
    while (start) {
      const dayBefore = new Date(Date.parse(start) - 86_400_000).toISOString().slice(0, 10);
      const prev = priorByEnd.get(dayBefore);
      if (!prev || prev.comparability !== 'comparable' || prev.overallPending || !isAdverse(prev.overallAbsoluteDiff)) break;
      consecutiveTotal++;
      start = prev.periodStartDate!;
    }
  }

  if (threshold.consecutivePeriods !== undefined && consecutiveTotal >= threshold.consecutivePeriods) {
    return {
      periods,
      overallPending: false,
      overallAbsoluteDiff,
      overallVariancePct,
      trigger: {
        type: 'consecutive',
        triggered: true,
        consecutiveCount: consecutiveTotal,
        reason: `同范围、同口径连续 ${consecutiveTotal} 期出现不利偏差，达到连续 ${threshold.consecutivePeriods} 期提示阈值。`,
      },
    };
  }

  return {
    periods,
    overallPending: false,
    overallAbsoluteDiff,
    overallVariancePct,
    trigger: {
      type: 'none',
      triggered: false,
      consecutiveCount: consecutiveTotal,
      reason: '未达到不利偏差幅度或连续偏离期数提示条件。',
    },
  };
}

export function classifyReviewConclusion(input: {
  id: string;
  title: string;
  summary: string;
  sourceRef: string;
  applicableScope: string;
  originalScope?:string;
  evidenceMature: boolean;
  causalVerified: boolean;
  targetScopeSameAsOriginal?: boolean;
}): CycleReviewConclusion {
  const sameScope = input.targetScopeSameAsOriginal !== false && (!input.originalScope || input.originalScope.trim()===input.applicableScope.trim());
  const confirmed = sameScope && input.evidenceMature && input.causalVerified;
  return {
    id: reqText(input.id, 120),
    title: reqText(input.title, 300),
    summary: reqText(input.summary, 2000),
    sourceRef: reqText(input.sourceRef, 500),
    applicableScope: reqText(input.applicableScope, 500),
    ...(input.originalScope?{originalScope:reqText(input.originalScope,500)}:{}),
    evidenceMature: Boolean(input.evidenceMature),
    causalVerified: Boolean(input.causalVerified),
    targetScopeSameAsOriginal: sameScope,
    classification: confirmed ? 'confirmed-evidence' : 'hypothesis-unverified',
  };
}

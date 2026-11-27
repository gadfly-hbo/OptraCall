import type {
  DecompositionDraftInput,
  GoalWorkspaceView,
  GsaPlanVersion,
  ReachabilityEstimate,
} from '../strategy-goal-decomposition-types.ts';

export type UpstreamCarryoverResolution =
  | { kind: 'gsa-changed'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; latestWorkspace: GoalWorkspaceView; message: string }
  | { kind: 'already-current'; latestWorkspace: GoalWorkspaceView; message: string }
  | {
      kind: 'carryover';
      draftForm: DecompositionDraftInput;
      priorPlanVersion: number;
      priorRevision: number;
      message: string;
    };

/**
 * Pure resolution for carrying over a prior decomposition draft onto a newly confirmed GSA plan.
 * Checks global adopted goal version, global latestGsaPlanVersion, active GSA hash, and local edit generation
 * across both the "already carried over elsewhere" and "priorDraft carryover" branches so unsaved local edits
 * are never silently overwritten.
 */
export function resolveUpstreamCarryover(params: {
  currentGoalVersion: number;
  currentActivePlan: GsaPlanVersion;
  latestWorkspace: GoalWorkspaceView;
  hadLocalEdits: boolean;
  startEditSerial: number;
  currentEditSerial: number;
}): UpstreamCarryoverResolution {
  const {
    currentGoalVersion,
    currentActivePlan,
    latestWorkspace,
    hadLocalEdits,
    startEditSerial,
    currentEditSerial,
  } = params;

  const plan = latestWorkspace.activeGsaPlan;
  const globalGoalChanged =
    latestWorkspace.goal.adoptedVersion !== null &&
    latestWorkspace.goal.adoptedVersion !== currentGoalVersion;
  const globalPlanChanged =
    latestWorkspace.latestGsaPlanVersion !== currentActivePlan.planVersion ||
    !plan ||
    plan.contentSha256 !== currentActivePlan.contentSha256;

  if (globalGoalChanged || globalPlanChanged) {
    return {
      kind: 'gsa-changed',
      message: '总 GSA 或已采用目标已升版，本地未保存输入已保留；请刷新并核对最新总 GSA 后再承接。',
    };
  }

  if (latestWorkspace.draftUnavailable) {
    return {
      kind: 'error',
      message: '原拆解草稿因权限范围变更暂不可读，本地输入已保留；请在「版本与来源」核对。',
    };
  }

  const localChanged = hadLocalEdits || currentEditSerial !== startEditSerial;

  if (latestWorkspace.draft && latestWorkspace.draft.gsaPlanVersion === plan.planVersion) {
    if (localChanged) {
      return {
        kind: 'conflict',
        latestWorkspace,
        message: '另一端已承接新版总 GSA 草稿，您的本地未保存改稿已保留未覆盖；请核对差异后选择合并或同步最新草稿。',
      };
    }
    return {
      kind: 'already-current',
      latestWorkspace,
      message: '当前新版总 GSA 已有拆解草稿，已为您刷新最新草稿。',
    };
  }

  const prior = latestWorkspace.draft ?? latestWorkspace.priorDraft;
  if (!prior) {
    return {
      kind: 'error',
      message: '原拆解草稿暂不可读，本地输入已保留；请在「版本与来源」核对后重试。',
    };
  }

  if (localChanged) {
    return {
      kind: 'conflict',
      latestWorkspace,
      message: '核对期间检测到本地未保存改稿，已保留当前输入未覆盖；请先保存／核对或同步最新草稿后再承接。',
    };
  }

  const sameCaliber =
    prior.estimate.unit === plan.formalTarget.unit &&
    prior.estimate.metricKind === plan.formalTarget.metricKind;
  const nextEstimate: ReachabilityEstimate = {
    ...structuredClone(prior.estimate),
    formalTargetValue: plan.formalTarget.value,
    gapValue:
      prior.estimate.estimatedValue === null || !sameCaliber
        ? null
        : Number((plan.formalTarget.value - prior.estimate.estimatedValue).toFixed(6)),
  };

  const draftForm: DecompositionDraftInput = {
    gsaPlanId: plan.planId,
    gsaPlanVersion: plan.planVersion,
    gsaPlanSha256: plan.contentSha256,
    reviewedPreviousPlanVersion: prior.gsaPlanVersion,
    expectedDraftRevision: prior.revision,
    estimate: nextEstimate,
    rows: structuredClone(prior.rows),
    reserves: structuredClone(prior.reserves),
    gapStrategies: structuredClone(prior.gapStrategies),
    views: structuredClone(prior.views),
    timePlan: structuredClone(prior.timePlan),
    notes: prior.notes,
  };

  return {
    kind: 'carryover',
    draftForm,
    priorPlanVersion: prior.gsaPlanVersion,
    priorRevision: prior.revision,
    message: `已按负责人核对承接新版总 GSA（保留原总 GSA v${prior.gsaPlanVersion} 草稿 r${prior.revision}），请继续核对差额、分配与阶段计划后再发布。`,
  };
}

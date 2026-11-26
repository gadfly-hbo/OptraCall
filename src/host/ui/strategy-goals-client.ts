import type { GoalAdoptionInput, GoalDraftInput, GoalFeedback, GoalFeedbackInput, GoalMutation, GoalOperationReceipt, GoalRef, GoalRelation, GoalRelationInput, GoalRelationRevisionInput, GoalRevisionInput, GoalScope, GoalVersion, StrategyGoalsIndex, StrategyGoalRecord } from '../strategy-goals-types.ts';
import type {
  DecompositionAlignmentInput,
  DecompositionCaseDraftIntent,
  DecompositionCaseDraftIntentInput,
  DecompositionCycleReview,
  DecompositionCycleReviewInput,
  DecompositionDraft,
  DecompositionDraftInput,
  DecompositionProgressCheck,
  DecompositionProgressCheckInput,
  DecompositionProjectHandoff,
  DecompositionProjectHandoffInput,
  DecompositionProjectHandoffPreview,
  DecompositionPublication,
  DecompositionPublicationSummary,
  DecompositionPublishInput,
  DecompositionPublishOperationRecord,
  DecompositionPublishPreview,
  DecompositionThresholdConfig,
  DecompositionThresholdInput,
  DecompositionValidationResult,
  GoalWorkspaceView,
  GoalActualInput,
  SubmittedGoalActual,
  GsaPlanConfirmInput,
  GsaPlanDraft,
  GsaPlanVersion,
  NextCycleDraft,
  NextCycleDraftInput,
  ReachabilityEstimate,
  StrategyReturnInput,
  StrategyReturnRecord,
} from '../strategy-goal-decomposition-types.ts';
import type { StrategyGoalSourceDirectory } from '../strategy-goal-sources.ts';
import type { InitiativePublication } from './strategy-initiative-client.ts';
import { metricRequest, type LibraryEntry } from '../../../extensions/business-plugins/metric-factory/ui/MetricFactoryPage.tsx';
export type { LibraryEntry } from '../../../extensions/business-plugins/metric-factory/ui/MetricFactoryPage.tsx';

const messages: Record<string, string> = {
  strategy_goal_adoption_changed: '当前采用版已改变，请核对最新 G 与 S 后再确认。',
  strategy_goal_conflict: '目标已有新版本，请保留输入，刷新核对后再修订。',
  strategy_goal_relation_conflict: '目标关系已更新，请刷新并核对当前职责和依据。',
  strategy_goal_operation_conflict: '原操作内容不一致，请先核对已保存结果。',
  strategy_goal_not_adopted: '此目标版本尚未采纳，不能作为正式目标引用。',
  strategy_goals_write_unknown: '保存结果尚未核实，请先核对原操作；不要重复新建。',
  strategy_goals_locked: '目标存储当前有未完成写入，请保留输入后核对。',
  strategy_goal_not_found: '目标暂不可读取，请刷新原目录。',
  invalid_strategy_goal_metric: '量化目标需要准确的 SAP 指标及固定版本。',
  invalid_strategy_goal_source: '请选择可核对的原记录及准确版本。',
  invalid_strategy_goals_storage: '目标记录存在未知或损坏内容，未自动重置；请保留原记录。',
  strategy_goal_scope_unavailable: '企业或部门归属尚不能核对，请保留旧版本，并在修订候选中明确原企业及用户声明的部门职责。',
  strategy_goal_feedback_source_unavailable: '原记录暂不可读取或权限待核，请回原入口核对；未替换来源。',
  strategy_goal_feedback_source_changed: '原记录已有变化，请保留输入并重新核对准确来源版本。',
  formal_strategy_goal_exists: '当前范围与周期已有正式战略目标发布，请直接引入正式战略目标，不能手工绕开正式来源。',
  cross_view_conflict: '交叉视角存在冲突，当前不能正式发布；请先在对齐区核对各视角原值并由人确认对齐后再发布。',
  decomposition_validation_failed: '拆解草稿未通过发布校验，请按阻断说明修正后再发布。',
  goal_decomposition_disabled: '目标拆解写入已按安全回退参数停用；已有版本与历史记录保持只读可查。',
  decomposition_publish_in_flight: '同一发布意图正在处理中，请先只读核对原操作结果，不要重复发布。',
  decomposition_retry_requires_explicit_cas: '该未提交发布意图需显式确认重试并携带当前操作状态版本，未自动重试。',
  decomposition_operation_conflict: '该操作编号已用于不同发布内容，请先查回原操作记录；本次未新增版本。',
  decomposition_operation_abandoned: '原发布意图已放弃，不可重试；请核对草稿后发起新的发布。',
  decomposition_draft_changed: '拆解草稿或总目标 GSA 计划已变化，请刷新最新草稿后重新核对。',
  decomposition_row_cas_conflict: '拆解行基线版本已过期，未覆盖他人或新版本的行修改；请刷新核对。',
  decomposition_frozen_checkpoint_unavailable: '所选检查点未在目标拆解正式版本中冻结，不能作为执行承接依据。',
  decomposition_blob_integrity_failed: '拆解正式版快照完整性校验未通过；未静默修复或替换，请核对原存储。',
  gsa_plan_unchanged:'内容未变，请修改计划后再确认修订。',
  review_draft_conflict:'复盘草稿已有较新版本，当前改稿已保留，请重新核对。',
  goal_plan_basis_required:'请先补齐准确目标 G 和策略 S。',
  gsa_stage_checkpoint_required: '请填写至少一个阶段检查点及其观察依据。',
  gsa_strategies_required: '请先补充目标的具体策略。',
  gsa_planned_actions_required: '总目标 GSA 至少需要填写一条明确的计划 A 才能确认并进入拆解。',
};

export class StrategyGoalsRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    serverMessage?: string,
  ) {
    super(messages[code] ?? serverMessage ?? (status === 409 ? '记录或版本发生变化，请先刷新核对。' : '请求未完成，请保留输入并核对本地服务。'));
  }
}

async function request<T>(route = '', method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/strategy/${route}`, {
    method,
    mode: 'same-origin',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-optracall-client': '1' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  let value: Record<string, unknown> = {};
  try {
    value = (await response.json()) as Record<string, unknown>;
  } catch {
    value = {};
  }
  if (!response.ok) {
    throw new StrategyGoalsRequestError(
      typeof value.code === 'string' ? value.code : 'strategy_goals_request_failed',
      response.status,
      value.details && typeof value.details === 'object' ? (value.details as Record<string, unknown>) : undefined,
      typeof value.message === 'string' ? value.message : undefined,
    );
  }
  return value as T;
}

const goalPath = (id: string) => `goals/${encodeURIComponent(id)}`;
export const readGoal = (id: string) => request<{ goal: StrategyGoalRecord }>(goalPath(id));
export const list = () => request<StrategyGoalsIndex>('goals');
export const feedbackSources = () => request<StrategyGoalSourceDirectory>('sources');
export async function publishedMetrics(): Promise<LibraryEntry[]> {
  const { entries } = await metricRequest<{ entries: LibraryEntry[] }>('library', 'GET');
  if (!Array.isArray(entries)) throw new StrategyGoalsRequestError('strategy_goal_metric_unavailable', 503);
  return entries;
}
export const create = (input: GoalDraftInput & GoalMutation) => request<{ goal: GoalVersion }>('goals', 'POST', input);
export const revise = (id: string, input: GoalRevisionInput) => request<{ goal: GoalVersion }>(`${goalPath(id)}/revisions`, 'POST', input);
export const adopt = (ref: GoalRef, input: GoalAdoptionInput) => request<{ goal: GoalVersion }>(`${goalPath(ref.goalId)}/adopt`, 'POST', { ...input, version: ref.version });
export const relate = (input: GoalRelationInput & GoalMutation) => request<{ relation: GoalRelation }>('relations', 'POST', input);
export const reviseRelation = (id: string, input: GoalRelationRevisionInput) => request<{ relation: GoalRelation }>(`relations/${encodeURIComponent(id)}/revisions`, 'POST', input);
export const feedback = (input: GoalFeedbackInput & GoalMutation) => request<{ feedback: GoalFeedback }>('feedback', 'POST', input);
export const operation = (id: string) => request<{ operation: GoalOperationReceipt | null }>(`operations/${encodeURIComponent(id)}`);
export const goalError = (error: unknown) => error instanceof StrategyGoalsRequestError ? error.message : '请求结果尚未核实，请保留输入并核对原操作。';
export const versionArrangements = (goal: GoalRef) => request<{ arrangements: import('../strategy-goals-types.ts').GoalArrangementView[] }>(`${goalPath(goal.goalId)}/versions/${goal.version}/arrangements`);

// --- Goal Management Refactor (GM01–GM13 / UI01–UI04) ---
export const formalSources = (scope: Pick<GoalScope, 'kind' | 'id' | 'enterpriseId'>) => {
  const params = new URLSearchParams({ scopeKind: scope.kind, scopeId: scope.id });
  if (scope.enterpriseId) params.set('enterpriseId', scope.enterpriseId);
  return request<{ scopeKey: string; formalPublications: InitiativePublication[]; recordOnlyPublications: InitiativePublication[] }>(`goals/formal-sources?${params.toString()}`);
};
export const getPreConfirmEstimate = (draftId: string, goalVersion?: number) =>
  request<{ estimateRecord: { draftId: string; goalRef?: GoalRef; estimate: ReachabilityEstimate; updatedAt: string } | null; estimate: ReachabilityEstimate | null }>(`goals/draft-estimates/${encodeURIComponent(draftId)}${goalVersion === undefined ? '' : '?goalVersion='+goalVersion}`);
export const savePreConfirmEstimate = (draftId: string, scope: GoalScope, estimate: ReachabilityEstimate, goalRef?: GoalRef) =>
  request<{ estimateRecord: unknown; estimate: ReachabilityEstimate }>(`goals/draft-estimates/${encodeURIComponent(draftId)}`, 'POST', { scope, estimate, ...(goalRef ? {goalRef} : {}) });

export const getWorkspace = (goalId: string, goalVersion?: number) => {
  const qs = goalVersion !== undefined ? `?goalVersion=${encodeURIComponent(String(goalVersion))}` : '';
  return request<GoalWorkspaceView>(`${goalPath(goalId)}/workspace${qs}`);
};
export const listStrategyReturns = (scope?: { kind: GoalScope['kind']; id: string; enterpriseId?: string }) => {
  const params = new URLSearchParams();
  if (scope) {
    params.set('scopeKind', scope.kind);
    params.set('scopeId', scope.id);
    if (scope.enterpriseId) params.set('enterpriseId', scope.enterpriseId);
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<{
    strategyReturns: {
      strategyReturn: StrategyReturnRecord;
      goal: GoalVersion;
      review: DecompositionCycleReview | null;
      selectedConclusions: import('../strategy-goal-decomposition-types.ts').CycleReviewConclusion[];
    }[];
  }>(`goals/strategy-returns${qs}`);
};
export const reconcileFormal = (goalId: string, input: { operationId: string; expectedVersion: number; publicationId: string; formalGoalId: string; contentSha256: string }) =>
  request<{ goal: GoalVersion; comparison: { manualValue: number | null; publishedValue: number; unit: string; publicationId: string } }>(`${goalPath(goalId)}/reconcile-formal`, 'POST', input);
export const saveGsaPlanDraft = (goalId: string, input: Partial<GsaPlanDraft>) =>
  request<{ gsaDraft: GsaPlanDraft }>(`${goalPath(goalId)}/gsa-plan/draft`, 'POST', input);
export const confirmGsaPlan = (goalId: string, input: GsaPlanConfirmInput) =>
  request<{ goal: GoalVersion; gsaPlan: GsaPlanVersion; replayed: boolean }>(`${goalPath(goalId)}/gsa-plan/confirm`, 'POST', input);
export const listGsaPlans = (goalId: string) =>
  request<{ gsaPlans: GsaPlanVersion[] }>(`${goalPath(goalId)}/gsa-plans`);

export const saveDecompositionDraft = (goalId: string, input: DecompositionDraftInput) =>
  request<{ draft: DecompositionDraft; validation: DecompositionValidationResult }>(`${goalPath(goalId)}/decomposition/draft`, 'POST', input);
export const alignDecompositionCrossConflict = (goalId: string, input: DecompositionAlignmentInput) =>
  request<{ draft: DecompositionDraft; validation: DecompositionValidationResult }>(`${goalPath(goalId)}/decomposition/align`, 'POST', input);
export const previewDecompositionPublish = (goalId: string, input: { gsaPlanId: string; gsaPlanVersion: number; gsaPlanSha256: string; draftRevision: number; draftSha256: string; expectedActiveVersion: number | null }) =>
  request<DecompositionPublishPreview>(`${goalPath(goalId)}/decomposition/publish-preview`, 'POST', input);
export const publishDecomposition = (goalId: string, input: DecompositionPublishInput) =>
  request<{ publication: DecompositionPublication; operation: DecompositionPublishOperationRecord; replayed: boolean }>(`${goalPath(goalId)}/decomposition/publish`, 'POST', input);
export const getDecompositionOperation = (goalId: string, operationId: string) =>
  request<{ found: boolean; status: 'committed' | 'in-flight' | 'not-committed-retryable' | 'abandoned' | 'unknown'; retryable: boolean; operation?: DecompositionPublishOperationRecord; publication?: DecompositionPublication }>(`${goalPath(goalId)}/decomposition/operations/${encodeURIComponent(operationId)}`);
export const abandonDecompositionOperation = (goalId: string, operationId: string, expectedStateRevision: number) =>
  request<{ operation: DecompositionPublishOperationRecord }>(`${goalPath(goalId)}/decomposition/operations/${encodeURIComponent(operationId)}/abandon`, 'POST', { expectedStateRevision });
export const listDecompositionPublications = (goalId: string, offset = 0, limit = 20) =>
  request<{ total: number; offset: number; limit: number; activeVersion: number | null; unavailableVersions: number[]; items: DecompositionPublicationSummary[] }>(`${goalPath(goalId)}/decomposition/publications?offset=${offset}&limit=${limit}`);
export const readDecompositionPublication = (goalId: string, version: number) =>
  request<{ publication: DecompositionPublication }>(`${goalPath(goalId)}/decomposition/publications/${version}`);

export const setDecompositionThreshold = (goalId: string, input: DecompositionThresholdInput) =>
  request<{ threshold: DecompositionThresholdConfig }>(`${goalPath(goalId)}/decomposition/threshold`, 'POST', input);
export const submitGoalActual = (goalId: string, input: GoalActualInput) =>
  request<{actual: SubmittedGoalActual}>(`${goalPath(goalId)}/decomposition/actuals`, 'POST', input);
export const recordProgressCheck = (goalId: string, input: DecompositionProgressCheckInput) =>
  request<{ check: DecompositionProgressCheck; replayed: boolean }>(`${goalPath(goalId)}/decomposition/checks`, 'POST', input);
export const setCheckCaseChoice = (goalId: string, checkId: string, input: Record<string, unknown>) =>
  request<{ check: DecompositionProgressCheck; caseDraftIntent?: DecompositionCaseDraftIntent }>(`${goalPath(goalId)}/decomposition/checks/${encodeURIComponent(checkId)}/case-choice`, 'POST', input);

export const createCaseDraftIntent = (goalId: string, input: DecompositionCaseDraftIntentInput) =>
  request<{ intent: DecompositionCaseDraftIntent; replayed: boolean }>(`${goalPath(goalId)}/case-draft-intents`, 'POST', input);
export const previewProjectHandoff = (goalId: string, input: { publicationVersion: number; rowId: string; checkpointId?: string }) =>
  request<DecompositionProjectHandoffPreview>(`${goalPath(goalId)}/decomposition/handoffs/preview`, 'POST', input);
export const confirmProjectHandoff = (goalId: string, input: DecompositionProjectHandoffInput) =>
  request<{ handoff: DecompositionProjectHandoff; replayed: boolean }>(`${goalPath(goalId)}/decomposition/handoffs`, 'POST', input);

export const recordCycleReview = (goalId: string, input: DecompositionCycleReviewInput) =>
  request<{ review: DecompositionCycleReview; replayed: boolean }>(`${goalPath(goalId)}/cycle-reviews`, 'POST', input);
export const createNextCycleDraft = (goalId: string, input: NextCycleDraftInput) =>
  request<{ nextCycleDraft: NextCycleDraft; replayed: boolean }>(`${goalPath(goalId)}/next-cycle-draft`, 'POST', input);
export const recordStrategyReturn = (goalId: string, input: StrategyReturnInput) =>
  request<{ strategyReturn: StrategyReturnRecord; replayed: boolean }>(`${goalPath(goalId)}/return-to-strategy`, 'POST', input);

export const readReviewDraft=(goalId:string,period:string)=>request<{draft:import('../strategy-goal-decomposition-types.ts').GoalReviewDraft}>(`${goalPath(goalId)}/review-draft?period=${encodeURIComponent(period)}`);
export const saveReviewDraft=(goalId:string,input:import('../strategy-goal-decomposition-types.ts').GoalReviewDraft & {expectedRevision:number})=>request<{draft:import('../strategy-goal-decomposition-types.ts').GoalReviewDraft}>(`${goalPath(goalId)}/review-draft`,'POST',input);

import type { GoalAdoptionInput, GoalDraftInput, GoalFeedback, GoalFeedbackInput, GoalMutation, GoalOperationReceipt, GoalRef, GoalRelation, GoalRelationInput, GoalRelationRevisionInput, GoalRevisionInput, GoalVersion, StrategyGoalRecord, StrategyGoalsIndex } from '../strategy-goals-types.ts';
import type { StrategyGoalSourceDirectory } from '../strategy-goal-sources.ts';
import { metricRequest, type LibraryEntry } from '../../../extensions/business-plugins/metric-factory/ui/MetricFactoryPage.tsx';
export type { LibraryEntry } from '../../../extensions/business-plugins/metric-factory/ui/MetricFactoryPage.tsx';

const messages: Record<string, string> = {
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
};
export class StrategyGoalsRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(messages[code] ?? (status === 409 ? '记录或版本发生变化，请先刷新核对。' : '请求未完成，请保留输入并核对本地服务。')); }
}
async function request<T>(route = '', method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/strategy/${route}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.json();
  if (!response.ok) throw new StrategyGoalsRequestError(value.code ?? 'strategy_goals_request_failed', response.status);
  return value as T;
}
const goalPath = (id: string) => `goals/${encodeURIComponent(id)}`;
export const list = () => request<StrategyGoalsIndex>('goals');
export const feedbackSources = () => request<StrategyGoalSourceDirectory>('sources');
export async function publishedMetrics(): Promise<LibraryEntry[]> {
  const { entries } = await metricRequest<{ entries: LibraryEntry[] }>('library', 'GET');
  if (!Array.isArray(entries)) throw new StrategyGoalsRequestError('strategy_goal_metric_unavailable', 503);
  return entries;
}
export const get = (id: string) => request<{ goal: StrategyGoalRecord }>(goalPath(id));
export const create = (input: GoalDraftInput & GoalMutation) => request<{ goal: GoalVersion }>('goals', 'POST', input);
export const revise = (id: string, input: GoalRevisionInput) => request<{ goal: GoalVersion }>(`${goalPath(id)}/revisions`, 'POST', input);
export const adopt = (ref: GoalRef, input: GoalAdoptionInput) => request<{ goal: GoalVersion }>(`${goalPath(ref.goalId)}/adopt`, 'POST', { ...input, version: ref.version });
export const relate = (input: GoalRelationInput & GoalMutation) => request<{ relation: GoalRelation }>('relations', 'POST', input);
export const reviseRelation = (id: string, input: GoalRelationRevisionInput) => request<{ relation: GoalRelation }>(`relations/${encodeURIComponent(id)}/revisions`, 'POST', input);
export const feedback = (input: GoalFeedbackInput & GoalMutation) => request<{ feedback: GoalFeedback }>('feedback', 'POST', input);
export const operation = (id: string) => request<{ operation: GoalOperationReceipt | null }>(`operations/${encodeURIComponent(id)}`);
export const goalError = (error: unknown) => error instanceof StrategyGoalsRequestError ? error.message : '请求结果尚未核实，请保留输入并核对原操作。';

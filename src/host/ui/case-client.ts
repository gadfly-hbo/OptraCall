import type { GoalDraftInput, GoalOperationReceipt, GoalRef, GoalVersion, StrategyGoalsIndex, StrategyGoalRecord } from '../strategy-goals-types.ts';
import type { ArtifactInput, CaseContextSelection, CaseDetail, CaseGoalBinding, CaseGoalBindingInput, CaseList, CaseMutation, CaseRecord, CaseStatus, CaseStorageStatus, OperationReceipt, ProjectWorkInput, ProjectWorkRecord, WorkEvent } from '../case-types.ts';
import type { ClientProject } from './project-types.ts';
export type { GoalDraftInput, GoalOperationReceipt, GoalRef, GoalVersion, StrategyGoalsIndex, StrategyGoalRecord, ArtifactInput, CaseContextSelection, CaseDetail, CaseGoalBinding, CaseGoalBindingInput, CaseList, CaseMutation, CaseRecord, CaseStatus, CaseStorageStatus, OperationReceipt, ProjectWorkInput, ProjectWorkRecord, WorkEvent };

const messages: Record<string, string> = {
  case_new_issue_requires_new_case: '本期判断标准或管理范围已实质变化，请带回目标管理，采用对应 G／S 后建新 Case。', case_strategy_required: '请选此版目标中的具体策略 S。', case_strategy_not_found: '所选策略不属于该版目标，请重新核对。', case_goal_strategy_unchanged: '本版目标与所选策略均沿用上次采用内容。请回原 Case，或先针对本议题修订 G 或 S。', case_goal_strategy_already_used: '这项准确 G／S 已有 Case 承接，请回原 Case 查看。', case_continuity_confirmation_required: '请确认议题和判断标准是否延续。', case_round_waiting_for_feedback: '本轮仍待实际观察。请先在原看板回录。', case_issue_reply_unavailable: '所选原回复当前失读或内容已变化。', case_choice_not_actionable: '本次取舍未决定开展经营行动。', case_issue_source_scope_mismatch: '原成果的项目、任务或轮次与当前事项不一致。', case_effective_date_in_use: '此生效日已记录年度关系。', choice_already_arranged: '本次选择已有行动授权，请核对原看板。',
  strategy_goal_conflict: '目标已产生新版本，请保留输入并重新核对；未更改原目标关联。', goal_not_adopted: '此目标准确版本尚未采纳，先核对并明确采纳后再关联。', case_primary_goal_required: '请选择已采纳的主目标。', strategy_goals_unavailable: '目标记录暂不可读取，请保留输入并重试。', invalid_strategy_goal: '目标信息尚不完整，请核对名称、归属及成果要求。',
  revision_conflict: '记录已在其他窗口更新，请刷新并核对后再保存。', case_conflict: '事项已更新，请刷新并核对后再保存。',
  operation_conflict: '同一操作的内容已变化，请先核对原操作结果。', case_closed: '此 Case 已结束，请先重新打开。',
  project_archived: '项目已归档，请先恢复后继续操作。', case_store_uninitialized: '请先启用 Case 记录。',
  case_store_unavailable: 'Case 存储暂时不可用，现有项目仍保留。', project_not_linked: '此项目已不再关联当前 Case，请刷新核对。',
  configuration_required: '请先在模型设置中配置新项目使用的模型。',
  artifact_adoption_needs_review: '版本保存结果需要核对，可能已有副本。请保留操作记录和项目文件，不要重复保存；刷新 Case 可查看待核对记录。',
  adopted_version_reference: '这个副本已有采用版本记录，不能刷新其摘要或来源。请保留原记录，从源文件显式保存新版本。',
};
export class CaseRequestError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details?: Record<string, unknown>) { super(messages[code] ?? (status === 409 ? '记录或版本发生变化，请刷新核对；未覆盖已有内容。' : '请求未完成，请检查输入或本地存储后重试。')); }
}
async function request<T>(route: string, method = 'GET', input?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${route}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), ...(signal ? { signal } : {}) });
  const result = await response.json();
  if (!response.ok) throw new CaseRequestError(result.code ?? 'case_request_failed', response.status, result.details);
  return result as T;
}
const casePath = (id: string) => `cases/${encodeURIComponent(id)}`;
const projectPath = (id: string) => `projects/${encodeURIComponent(id)}/work`;
export const status = (signal?: AbortSignal) => request<CaseStorageStatus>('cases/storage', 'GET', undefined, signal);
export const init = () => request<CaseStorageStatus>('cases/storage/initialize', 'POST', {});
export const list = (signal?: AbortSignal) => request<CaseList>('cases', 'GET', undefined, signal);
export const originReply = (id: string) => request<{text: string}>(casePath(id)+'/origin/reply');
export const detail = (id: string, signal?: AbortSignal) => request<CaseDetail>(casePath(id), 'GET', undefined, signal);
export const create = (input: { operationId: string; title: string; description?: string; goalBinding: CaseGoalBindingInput; goalIntent?: import('../case-types.ts').CaseGoalIntentRef; creationSource?: import('../case-types.ts').CaseCreationSource }) => request<{ case: CaseRecord }>('cases', 'POST', input);
export const update = (id: string, input: CaseMutation & { title: string; description: string; judgement: string; nextStep: string }) => request<{ case: CaseRecord }>(casePath(id), 'PATCH', input);
export const setStatus = (id: string, input: CaseMutation & { status: Exclude<CaseStatus, 'closed'> }) => request<{ case: CaseRecord }>(`${casePath(id)}/status`, 'POST', input);
export const close = (id: string, input: CaseMutation & { reason: string }) => request<{ case: CaseRecord }>(`${casePath(id)}/close`, 'POST', input);
export const reopen = (id: string, input: CaseMutation & { status: Exclude<CaseStatus, 'closed'> }) => request<{ case: CaseRecord }>(`${casePath(id)}/reopen`, 'POST', input);
export const note = (id: string, input: CaseMutation & { note: string; feedbackSource?: string | null }) => request<{ case: CaseRecord }>(`${casePath(id)}/notes`, 'POST', input);
export const linkProject = (id: string, input: CaseMutation & { projectId: string; recoveryOfOperationId?: string }) => request<{ case: CaseRecord }>(`${casePath(id)}/projects`, 'POST', input);
export const unlinkProject = (id: string, projectId: string, input: CaseMutation) => request<{ case: CaseRecord }>(`${casePath(id)}/projects/${encodeURIComponent(projectId)}`, 'DELETE', input);
export type CreateProjectLinkResult = { project: ClientProject | null; case?: CaseRecord; operationId: string; projectId: string; linked: boolean; phase: OperationReceipt['phase'] };
export const createProjectAndLink = (id: string, input: CaseMutation & { name: string; configurationId: string }) => request<CreateProjectLinkResult>(`${casePath(id)}/projects/create`, 'POST', input);
export const operation = (id: string) => request<{ operation: OperationReceipt | null }>(`cases/operations/${encodeURIComponent(id)}`);
export const saveProjectWork = (projectId: string, input: ProjectWorkInput) => request<{ work: ProjectWorkRecord }>(projectPath(projectId), 'PATCH', input);
export const projectEvents = (projectId: string) => request<{ events: WorkEvent[] }>(`${projectPath(projectId)}/events`);
export const projectNote = (projectId: string, input: CaseMutation & { note: string; feedbackSource?: string | null; originCaseId?: string }) => request<{ work: ProjectWorkRecord }>(`${projectPath(projectId)}/notes`, 'POST', input);
export type ArtifactSelectionInput = ArtifactInput & { saveVersion?: boolean; expectedSha256?: string };
export const saveArtifact = (id: string, input: CaseMutation & ArtifactSelectionInput) => request<{ case: CaseRecord }>(`${casePath(id)}/artifacts${input.saveVersion ? '/adopt' : ''}`, 'POST', input);
export const unlinkArtifact = (id: string, artifactId: string, input: CaseMutation) => request<{ case: CaseRecord }>(`${casePath(id)}/artifacts/${encodeURIComponent(artifactId)}`, 'DELETE', input);

export const strategyGoals = () => request<StrategyGoalsIndex>('strategy/goals');
export const createGoalCandidate = (input: GoalDraftInput & { operationId: string }) => request<{ goal: GoalVersion }>('strategy/goals', 'POST', input);
export const goalCaseMatch=(primary:GoalRef,strategy:string)=>request<{caseId:string|null}>('cases/goal-match','POST',{primary,strategy});
export const adoptGoalCandidate = (ref: GoalRef, input: { operationId: string; expectedVersion: number; decision: string }) => request<{ goal: GoalVersion }>(`strategy/goals/${encodeURIComponent(ref.goalId)}/adopt`, 'POST', { ...input, version: ref.version });
export const goalRecord = (id: string) => request<{ goal: StrategyGoalRecord }>(`strategy/goals/${encodeURIComponent(id)}`);
export const caseGoalAtRevision = (id:string,revision:number) => request<{goalBinding:CaseGoalBinding|null}>(casePath(id)+'/goals/revisions/'+revision);
export const caseGoals = (id: string) => request<{ goalBinding: CaseGoalBinding | null; history: CaseGoalBinding[] }>(`${casePath(id)}/goals`);
export const setCaseGoals = (id: string, input: CaseMutation & { goalBinding: CaseGoalBindingInput }) => request<{ goalBinding: CaseGoalBinding }>(`${casePath(id)}/goals`, 'POST', input);
export const goalEnterprises = () => request<{ enterprises: { id: string; name: string }[] }>('studio/enterprises');

export const goalOperation = (id: string) => request<{ operation: GoalOperationReceipt | null }>(`strategy/operations/${encodeURIComponent(id)}`);

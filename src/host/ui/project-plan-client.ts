import { canonicalDataContextValue } from '../project-data-context-request.ts';
import type { ProjectPlanState, ProjectPlanDraftInput, ProjectPlanDraftResult, ProjectPlanConfirmInput, ProjectPlanConfirmResult, ProjectPlanOperationRef, ProjectPlanCapabilities, ProjectPlanPreparationResult, ProjectPlanPreparationProjection } from '../project-plan-types.ts';
export type { ProjectPlanState, ProjectPlanDraftInput, ProjectPlanDraftResult, ProjectPlanConfirmInput, ProjectPlanConfirmResult };
export type { ProjectPlanCapabilities } from '../project-plan-types.ts';

export class ProjectPlanRequestError extends Error {
  code: string; status: number; uncertain: boolean;
  constructor(code: string, status: number, uncertain = false) { super(messages[code] || (uncertain ? '请求结果尚未核实，请保留输入并核对原操作。' : status === 409 ? '记录或权限已变化，请保留输入并核对原方案。' : '项目方案请求未完成，请保留输入并核对本地服务。')); this.code = code; this.status = status; this.uncertain = uncertain; }
}
const messages: Record<string, string> = {
  project_plan_conflict: '方案已在其他位置更新。保留本页输入，请重新读取并核对后保存。',
  project_plan_operation_conflict: '原操作的内容不一致。请保留原意图，修改内容应另存新稿。',
  project_plan_task_unavailable: '所选任务或综合责任已归档／不可用，请回原任务核对。',
  invalid_project_plan_summary: '请选择本项目有效的综合任务；单任务由本任务综合，未选且未创建的任务不能承接。',
  project_plan_context_changed: 'Case 或项目工作信息已变化，请核对准确版本，不会自动替换原确认。',
  project_plan_result_unknown: '请求结果尚未核实，先只读核对原操作；请勿重复新建。',
  project_plan_corrupt: '项目方案包含未知或损坏记录，未自动重置，请保留原记录。',
  project_archived: '项目已归档，只读；恢复原项目后再继续。',
  task_archived: '任务已归档，请先恢复原任务或调整本轮选择。',
};
async function request<T>(projectId: string, suffix = '', method = 'GET', input?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plan${suffix}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }); }
  catch { throw new ProjectPlanRequestError(method === 'GET' ? 'project_plan_unavailable' : 'project_plan_result_unknown', 0, method !== 'GET'); }
  let value: { code?: string } & T;
  try { value = await response.json(); } catch { throw new ProjectPlanRequestError(method === 'GET' ? 'project_plan_unavailable' : 'project_plan_result_unknown', response.status, method !== 'GET'); }
  if (!response.ok) { const code = value.code || 'project_plan_request_failed'; throw new ProjectPlanRequestError(code, response.status, method !== 'GET' && (response.status >= 500 || code.includes('unknown'))); }
  return value as T;
}
export const read = (projectId: string) => request<ProjectPlanState>(projectId);
export const capabilities = (projectId: string) => request<ProjectPlanCapabilities>(projectId, '/capabilities');
export const saveDraft = (projectId: string, input: ProjectPlanDraftInput) => request<ProjectPlanDraftResult>(projectId, '/draft', 'POST', input);
export const confirm = (projectId: string, input: ProjectPlanConfirmInput) => request<ProjectPlanConfirmResult>(projectId, '/confirm', 'POST', input);
export const prepare = (projectId: string, input: ProjectPlanDraftInput) => request<ProjectPlanPreparationResult>(projectId, '/prepare', 'POST', input);
export const stopPreparation = (projectId: string, operationId: string) => request<{ stopped: boolean; preparation?: ProjectPlanPreparationProjection }>(projectId, '/prepare/stop', 'POST', { operationId });
export const projectPlanError = (error: unknown) => error instanceof Error ? error.message : '项目方案请求未完成，请保留输入并核对。';
export async function projectPlanInputHash(input: ProjectPlanDraftInput | ProjectPlanConfirmInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalDataContextValue(input));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function findOperation(state: ProjectPlanState, input: ProjectPlanDraftInput | ProjectPlanConfirmInput, kind?: ProjectPlanOperationRef['kind']): Promise<{ status: 'saved' | 'not-found' | 'conflict' | 'unknown'; operation?: ProjectPlanOperationRef }> {
  const operation = state.operations?.find(operation => operation.operationId === input.operationId);
  if (!operation) return { status: 'not-found' };
  if (!operation.requestHash) return { status: 'unknown', operation };
  const hash = await projectPlanInputHash(input);
  return { status: operation.requestHash === hash && operation.kind === (kind || ('plan' in input ? 'draft' : 'confirm')) ? 'saved' : 'conflict', operation };
}
export async function findPreparation(state: ProjectPlanState, input: ProjectPlanDraftInput): Promise<{ status: ProjectPlanPreparationProjection['status'] | 'not-found' | 'conflict'; preparation?: ProjectPlanPreparationProjection }> {
  const projection = state.preparations?.find(item => item.operationId === input.operationId), operation = await findOperation(state, input, 'prepare');
  if (projection && projection.inputHash !== await projectPlanInputHash(input) || operation.status === 'conflict') return { status: 'conflict', preparation: projection };
  if (operation.status === 'saved') {
    if (projection && (projection.status !== 'completed' || projection.draftVersion !== operation.operation?.planVersion)) return { status: 'unknown', preparation: projection };
    return { status: 'completed', preparation: projection || { operationId: input.operationId, inputHash: operation.operation!.requestHash!, status: 'completed', draftVersion: operation.operation!.planVersion } };
  }
  if (!projection) return { status: operation.status === 'unknown' ? 'unknown' : 'not-found' };
  return { status: projection.status === 'completed' ? 'unknown' : projection.status, preparation: projection };
}

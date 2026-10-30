import type { ArtifactInput, CaseContextSelection, CaseDetail, CaseList, CaseMutation, CaseRecord, CaseStatus, CaseStorageStatus, OperationReceipt, ProjectWorkInput, ProjectWorkRecord, WorkEvent } from '../case-types.ts';
import type { ClientProject } from './project-types.ts';
export type { ArtifactInput, CaseContextSelection, CaseDetail, CaseList, CaseMutation, CaseRecord, CaseStatus, CaseStorageStatus, OperationReceipt, ProjectWorkInput, ProjectWorkRecord, WorkEvent };

const messages: Record<string, string> = {
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
async function request<T>(route: string, method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/${route}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const result = await response.json();
  if (!response.ok) throw new CaseRequestError(result.code ?? 'case_request_failed', response.status, result.details);
  return result as T;
}
const casePath = (id: string) => `cases/${encodeURIComponent(id)}`;
const projectPath = (id: string) => `projects/${encodeURIComponent(id)}/work`;
export const status = () => request<CaseStorageStatus>('cases/storage');
export const init = () => request<CaseStorageStatus>('cases/storage/initialize', 'POST', {});
export const list = () => request<CaseList>('cases');
export const detail = (id: string) => request<CaseDetail>(casePath(id));
export const create = (input: { operationId: string; title: string; description?: string }) => request<{ case: CaseRecord }>('cases', 'POST', input);
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
export const readProjectWork = (projectId: string) => request<{ work: ProjectWorkRecord }>(projectPath(projectId));
export const saveProjectWork = (projectId: string, input: ProjectWorkInput) => request<{ work: ProjectWorkRecord }>(projectPath(projectId), 'PATCH', input);
export const projectEvents = (projectId: string) => request<{ events: WorkEvent[] }>(`${projectPath(projectId)}/events`);
export const projectNote = (projectId: string, input: CaseMutation & { note: string; feedbackSource?: string | null; originCaseId?: string }) => request<{ work: ProjectWorkRecord }>(`${projectPath(projectId)}/notes`, 'POST', input);
export type ArtifactSelectionInput = ArtifactInput & { saveVersion?: boolean };
export const saveArtifact = (id: string, input: CaseMutation & ArtifactSelectionInput) => request<{ case: CaseRecord }>(`${casePath(id)}/artifacts${input.saveVersion ? '/adopt' : ''}`, 'POST', input);
export const unlinkArtifact = (id: string, artifactId: string, input: CaseMutation) => request<{ case: CaseRecord }>(`${casePath(id)}/artifacts/${encodeURIComponent(artifactId)}`, 'DELETE', input);

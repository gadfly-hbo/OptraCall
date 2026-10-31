import type { EnterpriseCaseContext, EnterpriseCaseContextInput, EnterpriseMaterialDetail, EnterpriseMaterialFields, EnterpriseMaterialRevision, EnterpriseMaterialsList } from '../enterprise-materials-types.ts';
export type { EnterpriseCaseContext, EnterpriseCaseSupplementInput, EnterpriseMaterial, EnterpriseMaterialFields, EnterpriseMaterialRef, EnterpriseMaterialRevision, EnterpriseMaterialSelection, EnterpriseMaterialSummary, EnterpriseMaterialsList } from '../enterprise-materials-types.ts';

const messages: Record<string, string> = {
  revision_conflict: '资料已在其他窗口更新，请重新读取后核对；没有覆盖已有内容。',
  material_conflict: '资料已更新，请重新读取并核对后保存。',
  enterprise_material_conflict: '资料已更新，请重新读取并核对后保存。',
  material_disabled: '这份资料已停用，历史仍可读取；请移除本轮新增选择或明确重新启用。',
  case_closed: 'Case 已结束，请重新打开后编辑资料。',
  case_conflict: 'Case 已变化，请刷新详情后核对。',
  body_too_large: '正文超过 1 MiB，请保留原文并缩小单份资料内容。',
  file_too_large: '来源文件超过 10 MiB，本次没有保存。',
  invalid_utf8: '文件不是有效 UTF-8 文本，可取消导入正文，仅登记来源文件。',
};
export class EnterpriseMaterialsRequestError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status: number, serverMessage?: string) { super(messages[code] ?? serverMessage ?? (status === 409 ? '资料身份或修订发生变化，请重新读取核对；未覆盖已有记录。' : status === 413 ? '内容超过本次保存上限，请核对大小后重试。' : '资料请求未完成，请核对输入或本机存储后重试。')); this.code = code; this.status = status; }
}
async function request<T>(route: string, method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/${route}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const result = await response.json();
  if (!response.ok) throw new EnterpriseMaterialsRequestError(result.error ?? result.code ?? 'enterprise_materials_failed', response.status, typeof result.message === 'string' && result.message.length <= 500 ? result.message : undefined);
  return result as T;
}
const materialPath = (id: string) => `enterprise-materials/${encodeURIComponent(id)}`;
export const listEnterpriseMaterials = () => request<EnterpriseMaterialsList>('enterprise-materials');
export const readEnterpriseMaterial = (id: string) => request<EnterpriseMaterialDetail>(materialPath(id));
export const readEnterpriseRevision = (id: string, revisionId: string) => request<{ storeId: string; materialId: string; revision: EnterpriseMaterialRevision }>(`${materialPath(id)}/revisions/${encodeURIComponent(revisionId)}`);
export const createEnterpriseMaterial = (fields: EnterpriseMaterialFields) => request<EnterpriseMaterialDetail>('enterprise-materials', 'POST', fields);
export const saveEnterpriseDraft = (id: string, expectedVersion: number, fields: EnterpriseMaterialFields) => request<EnterpriseMaterialDetail>(materialPath(id), 'PUT', { expectedVersion, ...fields });
export const enableEnterpriseMaterial = (id: string, expectedVersion: number, revisionId?: string) => request<EnterpriseMaterialDetail>(`${materialPath(id)}/enable`, 'POST', { expectedVersion, ...(revisionId ? { revisionId } : {}) });
export const disableEnterpriseMaterial = (id: string, expectedVersion: number) => request<EnterpriseMaterialDetail>(`${materialPath(id)}/disable`, 'POST', { expectedVersion });
export const readCaseEnterpriseContext = (caseId: string) => request<EnterpriseCaseContext>(`cases/${encodeURIComponent(caseId)}/enterprise-materials`);
export type EnterpriseContextHistoryItem = { requestId: string; sessionId?: string; providedAt?: string; providedContext?: Record<string, unknown> };
export const readEnterpriseContextHistory = (projectId: string, taskId: string) => request<{ receipts: EnterpriseContextHistoryItem[] }>(`projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/context-receipts`);
export const saveCaseEnterpriseContext = (caseId: string, caseRevision: number, input: EnterpriseCaseContextInput) => request<EnterpriseCaseContext>(`cases/${encodeURIComponent(caseId)}/enterprise-materials`, 'PUT', { caseRevision, ...input });
export async function uploadEnterpriseFile(id: string, expectedVersion: number, file: File, importText: boolean): Promise<EnterpriseMaterialDetail> {
  if (file.size > 10 * 1024 * 1024) throw new EnterpriseMaterialsRequestError('file_too_large', 413);
  const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('文件未能读取，请重新选择。')); reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? ''); reader.readAsDataURL(file); });
  return request<EnterpriseMaterialDetail>(`${materialPath(id)}/files`, 'POST', { expectedVersion, name: file.name, base64, importText });
}
export async function downloadEnterpriseFile(id: string, fileId: string, name: string): Promise<void> {
  const response = await fetch(`/api/${materialPath(id)}/source-file/${encodeURIComponent(fileId)}`, { credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'x-optracall-client': '1' } });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new EnterpriseMaterialsRequestError(result.error ?? result.code ?? 'source_unavailable', response.status, typeof result.message === 'string' && result.message.length <= 500 ? result.message : undefined); }
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const enterpriseError = (error: unknown) => error instanceof Error ? error.message : '资料操作未完成，请重新读取核对。';
export const emptyEnterpriseFields = (): EnterpriseMaterialFields => ({ title: '', category: '', body: '', source: '', owner: '', scope: '', effectiveTime: '', sourceFileId: null });

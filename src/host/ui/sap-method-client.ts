import { HostRequestError } from './runtime-client.ts';
import type { SapMethodDetail, SapMethodListOptions, SapMethodSummary, SapMethodSaveInput, SapMethodWriteResult, SapMethodPublishInput, SapMethodIssueInput, SapMethodOperationState } from '../../../extensions/business-plugins/metric-factory/methods/types.ts';

export class SapMethodRequestError extends HostRequestError {
  readonly uncertain: boolean;
  constructor(message: string, code = 'sap_method_request_failed', status = 0, uncertain = false) { super(message, {}, code, undefined, undefined, status); this.uncertain = uncertain; }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const mismatch = () => new SapMethodRequestError('方法回执与请求的确定版本不一致，请核对原记录。', 'sap_method_response_mismatch');
async function methodRequest<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const mutation = method !== 'GET';
  let response: Response, value: unknown;
  try {
    response = await fetch(`/api/${path}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1', 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
    value = await response.json();
  } catch (error) {
    if (signal?.aborted && !mutation) throw error;
    throw new SapMethodRequestError(mutation ? '请求结果未能核定，原输入与请求保持；请先核对，勿重复创建。' : '方法暂时无法读取，请稍后重试。', mutation ? 'sap_method_result_unknown' : 'sap_method_read_unavailable', 0, mutation);
  }
  if (!response.ok) throw new SapMethodRequestError(object(value) && typeof value.message === 'string' ? value.message : '方法请求未能完成。', object(value) && typeof value.code === 'string' ? value.code : 'sap_method_request_failed', response.status, mutation && response.status >= 500);
  return value as T;
}
function checkedMethod(value: SapMethodDetail, id: string, version?: number): SapMethodDetail {
  if (!object(value) || value.id !== id || !Number.isSafeInteger(value.selectedVersion) || (version !== undefined && value.selectedVersion !== version) || !Array.isArray(value.versions) || !value.versions.some(entry => entry.methodId === id && entry.version === value.selectedVersion)) throw mismatch();
  return value;
}
export async function listSapMethods(options: SapMethodListOptions = {}, signal?: AbortSignal): Promise<SapMethodSummary[]> {
  const params = new URLSearchParams();
  if (options.origin) params.set('origin', options.origin);
  if (options.status) params.set('status', options.status);
  if (options.query) params.set('query', options.query);
  const value = await methodRequest<{ methods: SapMethodSummary[] }>(`sap/methods${params.size ? `?${params}` : ''}`, 'GET', undefined, signal);
  if (!object(value) || !Array.isArray(value.methods)) throw mismatch();
  return value.methods;
}
export async function readSapMethod(id: string, version?: number, signal?: AbortSignal): Promise<SapMethodDetail> {
  const value = await methodRequest<{ method: SapMethodDetail }>(`sap/methods/${encodeURIComponent(id)}${version === undefined ? '' : `/versions/${version}`}`, 'GET', undefined, signal);
  return checkedMethod(value.method, id, version);
}
export type SapMethodDraftInput = Omit<SapMethodSaveInput, 'origin'>;
export async function saveSapMethod(input: SapMethodDraftInput): Promise<SapMethodWriteResult> {
  const value = await methodRequest<SapMethodWriteResult>(`sap/methods${input.methodId ? `/${encodeURIComponent(input.methodId)}/versions` : ''}`, 'POST', input);
  try {
    checkedMethod(value.method, value.version.methodId, value.version.version);
    if (input.methodId && value.version.methodId !== input.methodId) throw mismatch();
  } catch { throw new SapMethodRequestError('保存回执尚未核定，原输入与请求保持；未继续发布。', 'sap_method_response_mismatch', 0, true); }
  return value;
}
export async function publishSapMethod(id: string, input: SapMethodPublishInput): Promise<SapMethodWriteResult> {
  const value = await methodRequest<SapMethodWriteResult>(`sap/methods/${encodeURIComponent(id)}/publish`, 'POST', input);
  try {
    checkedMethod(value.method, id, input.version);
    if (value.version.methodId !== id || value.version.version !== input.version || value.version.contentSha256 !== input.expectedSha256 || !value.method.publications.some(entry => entry.version === input.version && entry.contentSha256 === input.expectedSha256)) throw mismatch();
  } catch { throw new SapMethodRequestError('发布回执尚未能与原保存版本核对；原版本保持，请先读取状态。', 'sap_method_response_mismatch', 0, true); }
  return value;
}
export async function markSapMethodIssue(id: string, input: SapMethodIssueInput): Promise<SapMethodDetail> {
  const value = await methodRequest<{ method: SapMethodDetail }>(`sap/methods/${encodeURIComponent(id)}/issues`, 'POST', input);
  try { return checkedMethod(value.method, id); }
  catch { throw new SapMethodRequestError('问题记录回执尚未核定，原输入与请求保持。', 'sap_method_response_mismatch', 0, true); }
}
export type SapMethodSourceText = { label: string; text: string; complete: boolean; limitation?: string; governance?: string };
export async function readSapMethodSource(id: string, version: number, index: number, signal?: AbortSignal): Promise<SapMethodSourceText> {
  const value = await methodRequest<SapMethodSourceText>(`sap/methods/${encodeURIComponent(id)}/versions/${version}/sources/${index}`, 'GET', undefined, signal);
  if (!object(value) || typeof value.label !== 'string' || typeof value.text !== 'string' || typeof value.complete !== 'boolean') throw mismatch();
  return value;
}
export type SapMethodExtractionRecord = {
  requestId: string; projectId: string; taskId: string;
  status: 'running' | 'saved' | 'reused' | 'empty' | 'failed' | 'cancelled' | 'unknown';
  methodId?: string; version?: number; message?: string; error?: string;
};
const extractionBase = (projectId: string, taskId: string) => `projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/sap-method-extractions`;
function checkedExtraction(value: SapMethodExtractionRecord, projectId: string, taskId: string, requestId?: string): SapMethodExtractionRecord {
  if (!object(value) || value.projectId !== projectId || value.taskId !== taskId || typeof value.requestId !== 'string' || (requestId !== undefined && value.requestId !== requestId) || !['running', 'saved', 'reused', 'empty', 'failed', 'cancelled', 'unknown'].includes(value.status)) throw mismatch();
  if (['saved', 'reused'].includes(value.status) && (typeof value.methodId !== 'string' || !Number.isSafeInteger(value.version) || Number(value.version) < 1)) throw mismatch();
  return value;
}
export async function listSapMethodExtractions(projectId: string, taskId: string, signal?: AbortSignal): Promise<SapMethodExtractionRecord[]> {
  const value = await methodRequest<{ extractions: SapMethodExtractionRecord[] }>(extractionBase(projectId, taskId), 'GET', undefined, signal);
  if (!object(value) || !Array.isArray(value.extractions)) throw mismatch();
  return value.extractions.map(entry => checkedExtraction(entry, projectId, taskId));
}
export async function startSapMethodExtraction(projectId: string, taskId: string, requestId: string, incomplete: boolean): Promise<SapMethodExtractionRecord> {
  const value = await methodRequest<{ extraction: SapMethodExtractionRecord }>(extractionBase(projectId, taskId), 'POST', { requestId, incomplete });
  try { return checkedExtraction(value.extraction, projectId, taskId, requestId); }
  catch { throw new SapMethodRequestError('提取回执未能与原任务核对，原请求保持，请先核对此次提取。', 'sap_method_response_mismatch', 0, true); }
}
export async function readSapMethodExtraction(projectId: string, taskId: string, requestId: string, signal?: AbortSignal): Promise<SapMethodExtractionRecord> {
  const value = await methodRequest<{ extraction: SapMethodExtractionRecord }>(`${extractionBase(projectId, taskId)}/${encodeURIComponent(requestId)}`, 'GET', undefined, signal);
  return checkedExtraction(value.extraction, projectId, taskId, requestId);
}
export async function stopSapMethodExtraction(projectId: string, taskId: string, requestId: string): Promise<SapMethodExtractionRecord> {
  const value = await methodRequest<{ extraction: SapMethodExtractionRecord }>(`${extractionBase(projectId, taskId)}/${encodeURIComponent(requestId)}/stop`, 'POST', {});
  try { return checkedExtraction(value.extraction, projectId, taskId, requestId); }
  catch { throw new SapMethodRequestError('停止回执未能与原提取核对，不能宣称已停止。', 'sap_method_response_mismatch', 0, true); }
}
export type SapMethodOperationRead = { operation: SapMethodOperationState | null; method?: SapMethodDetail };
export async function readSapMethodOperation(requestId: string, signal?: AbortSignal): Promise<SapMethodOperationRead> {
  const value = await methodRequest<SapMethodOperationRead>(`sap/methods/operations/${encodeURIComponent(requestId)}`, 'GET', undefined, signal);
  if (!object(value) || !('operation' in value)) throw mismatch();
  if (value.operation === null) return value;
  const operation = value.operation;
  if (!object(operation) || operation.requestId !== requestId || !['save', 'publish', 'issue'].includes(operation.kind) || !['pending', 'committed'].includes(operation.status) || typeof operation.methodId !== 'string' || !Number.isSafeInteger(operation.version)) throw mismatch();
  if (operation.status === 'committed') {
    if (!value.method) throw mismatch();
    checkedMethod(value.method, operation.methodId, operation.version);
  }
  return value;
}

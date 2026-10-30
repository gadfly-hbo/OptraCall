import type { BrowserUIRequest, BrowserUIResponse, FileNode } from './project-types.ts';

export type VerificationSelection = {
  question: string; dataFiles: string[]; authorFiles: string[]; businessContext?: string;
  requirementContext?: { instanceId: string; version?: string }; caseId?: string; caseRevision?: number; caseBackgroundIsPrior?: boolean;
  useCurrentSap?: boolean; configurationId?: string; retryOf?: string;
};
export type VerificationInput = VerificationSelection & { verificationId: string };
export type VerificationPreview = {
  semantics: { text: string; sha256?: string; sources: { kind: string; id?: string; version?: string; sha256?: string; confirmed?: boolean; note?: string }[] };
  configuration: { id: string; revision: number; provider: string; model: string; name?: string };
  note: string;
};
export type VerificationRecord = {
  id: string; verificationId?: string; projectId: string; taskId: string; question: string;
  status: 'preparing' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
  phase?: 'cold' | 'comparison' | 'recheck'; createdAt: string; updatedAt: string; selection: VerificationSelection;
  model?: { id: string; revision: number; provider: string; model: string; name?: string };
  coldResult?: { text: string }; comparisonResult?: { text: string }; recheckResult?: { text: string };
  diagnostic?: { message?: string } | string;
  independence?: { status: string; details?: string | string[] };
  revision?: { status?: string; files?: string[]; text?: string }; exportedFile?: string;
  authorReports?: { path: string; text: string; sha256?: string }[];
  uiRequests?: BrowserUIRequest[];
};
export class VerificationRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? (status === 409 ? '记录或输入已变化，请先核对原核算。' : '核算请求未完成，请检查输入后重试。'));
    this.code = code; this.status = status;
  }
}
export class VerificationSubmissionUnknown extends Error {
  readonly verificationId: string;
  constructor(verificationId: string) { super('核算提交结果尚未确认。操作编号已保留，请先查询原记录；不会自动重发或另建核算。'); this.verificationId = verificationId; }
}
const scopePath = (projectId: string, taskId: string) => `projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/verifications`;
async function request<T>(route: string, method = 'GET', input?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${route}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), ...(signal ? { signal } : {}) });
  const result = await response.json();
  if (!response.ok) throw new VerificationRequestError(result.code ?? result.error ?? 'verification_request_failed', response.status, result.message);
  return result as T;
}
function checked(record: VerificationRecord, projectId: string, taskId: string, id?: string): VerificationRecord {
  if (!record || record.projectId !== projectId || record.taskId !== taskId || (id && (record.id ?? record.verificationId) !== id)) throw new VerificationRequestError('verification_owner_mismatch', 409, '返回的核算归属或编号不一致，未应用到当前任务。');
  return record;
}
export async function readVerification(projectId: string, taskId: string, id: string, signal?: AbortSignal): Promise<VerificationRecord> {
  return checked((await request<{ verification: VerificationRecord }>(`${scopePath(projectId, taskId)}/${encodeURIComponent(id)}`, 'GET', undefined, signal)).verification, projectId, taskId, id);
}
export async function listVerifications(projectId: string, taskId: string, signal?: AbortSignal): Promise<VerificationRecord[]> {
  return (await request<{ verifications: VerificationRecord[] }>(scopePath(projectId, taskId), 'GET', undefined, signal)).verifications.map(value => checked(value, projectId, taskId));
}
export async function startVerification(projectId: string, taskId: string, input: VerificationInput, signal?: AbortSignal): Promise<VerificationRecord> {
  const invalid = verificationInputError(input);
  if (invalid) throw new VerificationRequestError('invalid_verification_selection', 400, invalid);
  try {
    return checked((await request<{ verification: VerificationRecord }>(scopePath(projectId, taskId), 'POST', input, signal)).verification, projectId, taskId, input.verificationId);
  } catch (error) {
    if (error instanceof VerificationRequestError && error.status < 500) throw error;
    try { return await readVerification(projectId, taskId, input.verificationId, AbortSignal.timeout(10000)); }
    catch { throw new VerificationSubmissionUnknown(input.verificationId); }
  }
}
/** Read-only preview: a POST carries selection data but creates no intent or runtime. */
export function previewVerification(projectId: string, taskId: string, input: VerificationInput, signal?: AbortSignal): Promise<VerificationPreview> {
  const invalid = verificationInputError(input);
  if (invalid) return Promise.reject(new VerificationRequestError('invalid_verification_selection', 400, invalid));
  return request<VerificationPreview>(`${scopePath(projectId, taskId)}/preview`, 'POST', input, signal);
}
export async function verificationAction(projectId: string, taskId: string, id: string, action: 'stop' | 'recheck' | 'author-revision' | 'export', input: Record<string, unknown> = {}): Promise<VerificationRecord> {
  try {
    return checked((await request<{ verification: VerificationRecord }>(`${scopePath(projectId, taskId)}/${encodeURIComponent(id)}/${action}`, 'POST', input, AbortSignal.timeout(30000))).verification, projectId, taskId, id);
  } catch (error) {
    if (error instanceof VerificationRequestError && error.status < 500) throw error;
    try {
      const value = await readVerification(projectId, taskId, id, AbortSignal.timeout(10000));
      const observed = action === 'export' ? Boolean(value.exportedFile) : action === 'author-revision' ? Boolean(value.revision) : action === 'recheck' ? value.phase === 'recheck' || Boolean(value.recheckResult) : ['completed', 'cancelled', 'failed'].includes(value.status);
      if (observed) return value;
    } catch { /* The original intent remains unresolved; never replay the action. */ }
    throw new VerificationSubmissionUnknown(id);
  }
}
export async function respondVerificationUI(projectId: string, taskId: string, id: string, input: BrowserUIResponse): Promise<VerificationRecord> {
  await request(`${scopePath(projectId, taskId)}/${encodeURIComponent(id)}/ui-response`, 'POST', input, AbortSignal.timeout(30000));
  return readVerification(projectId, taskId, id, AbortSignal.timeout(10000));
}
export function verificationFiles(tree: readonly FileNode[]): { data: FileNode[]; authors: FileNode[] } {
  const all: FileNode[] = [];
  const visit = (nodes: readonly FileNode[]) => { for (const node of nodes) { if (node.kind === 'directory') visit(node.children ?? []); else all.push(node); } };
  visit(tree);
  return { data: all.filter(file => file.path.startsWith('020_clean/')), authors: all.filter(file => /^(020_clean|060_reports)\//.test(file.path)) };
}
export const verificationStatusLabel: Record<VerificationRecord['status'], string> = { preparing: '正在固定输入', ready: '输入已准备', running: '核算中', completed: '核算已结束', failed: '核算失败', cancelled: '已停止', interrupted: '核算中断', unknown: '结果未知' };
export const verificationPhaseLabel: Record<NonNullable<VerificationRecord['phase']>, string> = { cold: '独立计算', comparison: '对照作者产物', recheck: '修订后复查' };
export function verificationInputError(input: VerificationSelection): string | undefined {
  if (!input.question.trim()) return '请填写本次要核算的问题。';
  if (input.question.length > 4000) return '核算问题最多 4000 个字符。';
  if (input.businessContext !== undefined && input.businessContext.length > 12000) return '补充业务背景最多 12000 个字符。';
  if (!input.dataFiles.length) return '请选择至少一份 020_clean 源数据。';
  if (!input.authorFiles.length) return '请选择至少一份待核算的作者产物。';
  if (input.dataFiles.some(path => !path.startsWith('020_clean/')) || input.authorFiles.some(path => !/^(020_clean|060_reports)\//.test(path))) return '请选择项目分析区或报告区中的文件。';
  if (input.dataFiles.some(path => input.authorFiles.includes(path))) return '同一文件不能既作为源数据又作为作者产物，以免提前带入答案。';
  if (input.caseId && (!Number.isInteger(input.caseRevision) || input.caseBackgroundIsPrior !== true)) return '请确认选定的 Case 背景属于此次分析的事前信息，或取消附带 Case。';
  return undefined;
}
export function readSapProvision(context: unknown): { indexText: string; sha256?: string; basis?: string } | undefined {
  if (!context || typeof context !== 'object' || Array.isArray(context) || !('sap' in context)) return undefined;
  const sap = context.sap;
  if (!sap || typeof sap !== 'object' || Array.isArray(sap) || !('indexText' in sap) || typeof sap.indexText !== 'string' || !sap.indexText.trim()) return undefined;
  return { indexText: sap.indexText, ...('sha256' in sap && typeof sap.sha256 === 'string' && /^[a-f0-9]{64}$/.test(sap.sha256) ? { sha256: sap.sha256 } : {}), ...('basis' in sap && typeof sap.basis === 'string' ? { basis: sap.basis } : {}) };
}

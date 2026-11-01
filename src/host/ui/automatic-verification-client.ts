import type { AutomaticChain, AutomaticObservation, AutomaticReason, AutomaticSettings, AutomaticSettingsInput, AutomaticState, AutomaticVersion } from '../automatic-verification-types.ts';
import type { BrowserUIRequest, BrowserUIResponse } from './project-types.ts';

export type AutomaticUIRequest = { domain: 'project-tasks' | 'independent-verification'; verificationId?: string; request: BrowserUIRequest };
export type AutomaticChainView = AutomaticChain & { uiRequests?: AutomaticUIRequest[]; cleanup?: { state: 'confirmed' | 'pending' | 'unknown'; retryable: boolean } };
export const automaticCleanupConfirmed = (chain: AutomaticChainView) => chain.cleanup?.state === 'confirmed';
export const automaticCleanupRetryable = (chain: AutomaticChainView) => !automaticCleanupConfirmed(chain) && chain.cleanup?.retryable === true;
export type AutomaticCapabilities = { supported: boolean; reason?: string; tools?: string[] };
export type AutomaticStatus = { busy: boolean; observation?: AutomaticObservation };
export type AutomaticReport = Pick<AutomaticVersion, 'version' | 'relativePath' | 'sha256' | 'bytes'> & { contentBase64: string; text?: string; textStatus: 'utf8' | 'not-utf8' };
export class AutomaticVerificationRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? (code === 'automatic_settings_conflict' || status === 409
      ? '设置或记录已变化，输入继续保留。请先读取当前设置，再决定是否采用这些修改。'
      : '自动核算服务暂不可用，请重新读取原记录。'));
    this.code = code; this.status = status;
  }
}
export class AutomaticVerificationUncertain extends Error {
  readonly operation: 'settings' | 'stop' | 'ui-response';
  readonly chainId?: string;
  constructor(operation: 'settings' | 'stop' | 'ui-response', chainId?: string) {
    super('本次操作结果尚未确认。输入和原记录继续保留，请先查询；不会自动重发。');
    this.operation = operation; this.chainId = chainId;
  }
}

const base = (projectId: string, taskId: string) => `projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/automatic-verification`;
async function request<T>(route: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${route}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
  const value = await response.json();
  if (!response.ok) throw new AutomaticVerificationRequestError(value.code ?? value.error ?? 'automatic_request_failed', response.status, value.message);
  return value as T;
}
function settingsOwner(value: AutomaticSettings, projectId: string, taskId: string): AutomaticSettings {
  if (!value || value.projectId !== projectId || value.taskId !== taskId || !Number.isInteger(value.revision) || value.revision < 0) throw new AutomaticVerificationRequestError('automatic_owner_mismatch', 409, '设置归属不一致，未应用到当前任务。');
  return value;
}
function chainOwner(value: AutomaticChainView, projectId: string, taskId: string, chainId?: string): AutomaticChainView {
  if (!value || value.projectId !== projectId || value.taskId !== taskId || typeof value.chainId !== 'string' || !/^[a-f0-9]{64}$/.test(value.chainId) || (chainId !== undefined && value.chainId !== chainId)) throw new AutomaticVerificationRequestError('automatic_owner_mismatch', 409, '返回记录的归属或编号不一致，未应用到当前任务。');
  settingsOwner(value.settingsSnapshot, projectId, taskId);
  return value;
}

export function automaticSettingsDraft(settings: AutomaticSettings): AutomaticSettingsInput {
  const { formatVersion: _format, revision: _revision, updatedAt: _updated, projectId: _project, taskId: _task, ...input } = settings;
  return structuredClone(input);
}
function comparable(input: AutomaticSettingsInput): unknown {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return canonical({ ...input, dataFiles: input.dataFiles ?? [], processFiles: input.processFiles ?? [], maxAuthorTurns: input.maxAuthorTurns ?? 2 });
}
function validPath(value: string, prefix: RegExp): boolean {
  return prefix.test(value) && !/[\\\0\r\n]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export type AutomaticSettingsIssue = { field: 'question' | 'data' | 'report' | 'process' | 'context' | 'case' | 'limit'; message: string };
export function automaticSettingsIssue(input: AutomaticSettingsInput): AutomaticSettingsIssue | undefined {
  if (!input.enabled) return undefined;
  if (!input.question?.trim()) return { field: 'question', message: '请填写需要独立核算的问题。' };
  if (input.question.length > 4000) return { field: 'question', message: '核算问题最多4000个字符。' };
  if (!input.dataFiles?.length || input.dataFiles.length > 32 || new Set(input.dataFiles).size !== input.dataFiles.length || input.dataFiles.some(path => !validPath(path, /^020_clean\//))) return { field: 'data', message: '请选择1–32份不重复的020_clean源数据，路径不能越出项目分析区。' };
  if (!input.reportPath || !validPath(input.reportPath, /^060_reports\//)) return { field: 'report', message: '请填写060_reports下明确的报告路径，不使用空目录或上级路径。' };
  const process = input.processFiles ?? [];
  if (process.length > 31 || new Set(process).size !== process.length || process.includes(input.reportPath) || process.some(path => !validPath(path, /^(020_clean|060_reports)\//))) return { field: 'process', message: '请选择最多31份不重复的作者过程件，与待核报告分开。' };
  if (input.dataFiles.some(path => process.includes(path) || path === input.reportPath)) return { field: 'data', message: '同一文件不能既是源数据又是作者产物，以免提前带入答案。' };
  if (input.businessContext !== undefined && input.businessContext.length > 12000) return { field: 'context', message: '补充事前背景最多12000个字符。' };
  if (input.caseId && (!Number.isInteger(input.caseRevision) || input.caseBackgroundIsPrior !== true)) return { field: 'case', message: '请确认所选Case背景属于事前信息，或取消附带Case。' };
  if (![1, 2, 3].includes(input.maxAuthorTurns ?? 2)) return { field: 'limit', message: '最多自动返修次数请选择1、2或3次。' };
  return undefined;
}
export const automaticSettingsError = (input: AutomaticSettingsInput) => automaticSettingsIssue(input)?.message;
export async function readAutomaticSettings(projectId: string, taskId: string, signal?: AbortSignal): Promise<AutomaticSettings> {
  return settingsOwner((await request<{ settings: AutomaticSettings }>(`${base(projectId, taskId)}/settings`, 'GET', undefined, signal)).settings, projectId, taskId);
}
export async function saveAutomaticSettings(projectId: string, taskId: string, expectedRevision: number, input: AutomaticSettingsInput, signal?: AbortSignal): Promise<AutomaticSettings> {
  const error = automaticSettingsError(input);
  if (error) throw new AutomaticVerificationRequestError('invalid_automatic_settings', 400, error);
  const snapshot = structuredClone(input);
  try {
    return settingsOwner((await request<{ settings: AutomaticSettings }>(`${base(projectId, taskId)}/settings`, 'PUT', { expectedRevision, settings: snapshot }, signal)).settings, projectId, taskId);
  } catch (error) {
    if (error instanceof AutomaticVerificationRequestError && error.status < 500) throw error;
    try {
      const observed = await readAutomaticSettings(projectId, taskId, AbortSignal.timeout(10000));
      if (observed.revision === expectedRevision + 1 && JSON.stringify(comparable(automaticSettingsDraft(observed))) === JSON.stringify(comparable(snapshot))) return observed;
    } catch { /* Readback is observational, never a second save. */ }
    throw new AutomaticVerificationUncertain('settings');
  }
}
export async function listAutomaticChains(projectId: string, taskId: string, signal?: AbortSignal): Promise<AutomaticChainView[]> {
  return (await request<{ chains: AutomaticChainView[] }>(`${base(projectId, taskId)}/chains`, 'GET', undefined, signal)).chains.map(chain => chainOwner(chain, projectId, taskId));
}
export async function readAutomaticChain(projectId: string, taskId: string, chainId: string, signal?: AbortSignal): Promise<AutomaticChainView> {
  return chainOwner((await request<{ chain: AutomaticChainView }>(`${base(projectId, taskId)}/chains/${encodeURIComponent(chainId)}`, 'GET', undefined, signal)).chain, projectId, taskId, chainId);
}
function reportMismatch(): never { throw new AutomaticVerificationRequestError('automatic_report_mismatch', 409, '固定稿的版本或字节身份不一致，未替换已读取的正文。请重新读取原记录。'); }
function reportBytes(value: Pick<AutomaticReport, 'contentBase64' | 'bytes'>): Uint8Array<ArrayBuffer> {
  if (typeof value.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.contentBase64)) reportMismatch();
  let raw: string;
  try { raw = atob(value.contentBase64); } catch { return reportMismatch(); }
  if (raw.length !== value.bytes) reportMismatch();
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
export async function readAutomaticReport(projectId: string, taskId: string, chainId: string, expected: Pick<AutomaticVersion, 'version' | 'relativePath' | 'sha256' | 'bytes'>, signal?: AbortSignal): Promise<AutomaticReport> {
  if (!/^[a-f0-9]{64}$/.test(chainId) || !Number.isSafeInteger(expected.version) || expected.version < 1 || !validPath(expected.relativePath, /^060_reports\//) || !/^[a-f0-9]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0) reportMismatch();
  const value = (await request<{ report: AutomaticReport }>(`${base(projectId, taskId)}/chains/${encodeURIComponent(chainId)}/reports/${expected.version}`, 'GET', undefined, signal)).report;
  if (!value || value.version !== expected.version || value.relativePath !== expected.relativePath || value.sha256 !== expected.sha256 || value.bytes !== expected.bytes || !['utf8', 'not-utf8'].includes(value.textStatus)) reportMismatch();
  const bytes = reportBytes(value), digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== expected.sha256) reportMismatch();
  let text: string | undefined;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { /* Binary originals remain downloadable. */ }
  if (text === undefined ? value.textStatus !== 'not-utf8' || value.text !== undefined : value.textStatus !== 'utf8' || value.text !== undefined && value.text !== text) reportMismatch();
  return { ...value, text };
}
export function automaticReportBlob(report: AutomaticReport): Blob { return new Blob([reportBytes(report)], { type: 'application/octet-stream' }); }
/** The full fixed bytes remain available even when the on-screen preview is limited. */
export function automaticReportPreview(report: AutomaticReport): { text: string; start: 0; end: number; totalLength: number; complete: boolean } | undefined {
  if (report.textStatus !== 'utf8' || report.text === undefined) return undefined;
  const end = Math.min(16000, report.text.length);
  return { text: report.text.slice(0, end), start: 0, end, totalLength: report.text.length, complete: end === report.text.length };
}
export async function stopAutomaticChain(projectId: string, taskId: string, chainId: string): Promise<AutomaticChainView> {
  try {
    const value = chainOwner((await request<{ chain: AutomaticChainView }>(`${base(projectId, taskId)}/chains/${encodeURIComponent(chainId)}/stop`, 'POST', {}, AbortSignal.timeout(30000))).chain, projectId, taskId, chainId);
    if (automaticCleanupConfirmed(value)) return value;
    throw new AutomaticVerificationUncertain('stop', chainId);
  } catch (error) {
    if (error instanceof AutomaticVerificationRequestError && error.status < 500) throw error;
    try {
      const observed = await readAutomaticChain(projectId, taskId, chainId, AbortSignal.timeout(10000));
      if (automaticCleanupConfirmed(observed)) return observed;
    } catch { /* Keep the original stop uncertain. */ }
    throw new AutomaticVerificationUncertain('stop', chainId);
  }
}
export function readAutomaticCapabilities(projectId: string, taskId: string, signal?: AbortSignal): Promise<AutomaticCapabilities> {
  return request<AutomaticCapabilities>(`${base(projectId, taskId)}/capabilities`, 'GET', undefined, signal);
}
export async function readAutomaticStatus(projectId: string, taskId: string, signal?: AbortSignal): Promise<AutomaticStatus> {
  const value = await request<AutomaticStatus>(`${base(projectId, taskId)}/status`, 'GET', undefined, signal);
  if (typeof value?.busy !== 'boolean' || (value.observation && (value.observation.projectId !== projectId || value.observation.taskId !== taskId))) throw new AutomaticVerificationRequestError('automatic_owner_mismatch', 409, '观察记录的归属不一致，未应用到当前任务。');
  if (value.observation) settingsOwner(value.observation.settingsSnapshot, projectId, taskId);
  return value;
}
export async function respondAutomaticUI(projectId: string, taskId: string, chainId: string, target: AutomaticUIRequest, answer: BrowserUIResponse): Promise<AutomaticChainView> {
  if (answer.id !== target.request.id) throw new AutomaticVerificationRequestError('automatic_ui_mismatch', 409);
  try {
    await request(`${base(projectId, taskId)}/chains/${encodeURIComponent(chainId)}/ui-response`, 'POST', { domain: target.domain, ...(target.verificationId ? { verificationId: target.verificationId } : {}), ...answer }, AbortSignal.timeout(30000));
  } catch (error) {
    if (error instanceof AutomaticVerificationRequestError && error.status < 500) throw error;
    throw new AutomaticVerificationUncertain('ui-response', chainId);
  }
  try { return await readAutomaticChain(projectId, taskId, chainId, AbortSignal.timeout(10000)); }
  catch { throw new AutomaticVerificationUncertain('ui-response', chainId); }
}
export const automaticStateLabel: Record<AutomaticState, string> = { preparing: '正在准备材料', running: '自动处理中', paused: '已暂停', completed: '自动处理已结束', cancelled: '已停止', failed: '运行失败', unknown: '结果待确认' };
export const automaticReasonLabel: Record<AutomaticReason, string> = { none: '', report_missing: '指定报告尚未产生', report_unchanged: '指定报告未形成新版本', source_changed: '源材料已变化', semantics_changed: '事前业务依据已变化', settings_changed: '设置已变化', session_changed: '原会话已变化', configuration_changed: '模型配置已变化', external_change: '项目有其他请求、资料或身份变更，归属待确认', no_new_report: '主Agent未提交新稿', same_content: '另存稿内容未变', limit_reached: '已达自动返修上限', user_stopped: '用户请求停止本次处理', runtime_failed: '运行未完成', persistence_failed: '保存尚未完成', request_unknown: '请求结果尚未确认', unsupported_protection: '当前环境不支持所需原件保护' };
export const automaticChainLabel = (chain: AutomaticChainView) => chain.state === 'cancelled' && !automaticCleanupConfirmed(chain) ? '停止结果待确认' : automaticStateLabel[chain.state];
export const automaticPhaseLabel = { prepare: '准备与固定材料', cold: '独立核算中', compare: '对照作者产物', author: '原主Agent处理意见', recheck: '修订稿知情复查', ended: '本次操作结束' };
export const automaticChainRunning = (chain?: AutomaticChainView) => Boolean(chain && (chain.state === 'preparing' || chain.state === 'running'));
/** Late observation responses must not replace a newer known revision or erase history. */
export function mergeAutomaticChains(current: readonly AutomaticChainView[], incoming: readonly AutomaticChainView[]): AutomaticChainView[] {
  const byId = new Map(current.map(chain => [chain.chainId, chain]));
  for (const value of incoming) {
    const previous = byId.get(value.chainId);
    if (!previous || value.revision >= previous.revision) byId.set(value.chainId, value);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

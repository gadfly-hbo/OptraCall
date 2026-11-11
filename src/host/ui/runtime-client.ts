import type { PersonalContextSelection } from '../personal-context-types.ts';
import type { EnterpriseCaseSelection, EnterpriseMaterialSelection } from '../enterprise-materials-types.ts';
import type { FeedbackContextSelection } from '../decision-feedback-types.ts';
import type { ProjectDataContextSelection } from '../project-data-context-types.ts';
import type { CaseContextSelection } from '../case-types.ts';
import type { RequirementContextSelection } from './requirement-types.ts';
import type { TaskCapability, TaskCapabilities } from '../task-capabilities.ts';
import type { TradeAreaStatus } from '../trade-area-status.ts';
import type { SearchProvider, WebSearchSettings } from '../web-search.ts';
import type { BrowserUIResponse, ClientProject, ClientTask, FileNode, ProjectEvent, PublicModelConfiguration, SessionSnapshot, TaskState } from './project-types.ts';
import { isProjectUploadName, PROJECT_UPLOAD_MAX_BYTES } from '../project-upload.ts';

export class HostRequestError extends Error {
  readonly fields: Record<string, string>;
  readonly code: string;
  readonly unavailablePersonalContext?: number[];
  readonly accepted?: boolean;
  readonly status?: number;
  constructor(message: string, fields: Record<string, string> = {}, code = 'host_request_failed', unavailablePersonalContext?: number[], accepted?: boolean, status?: number) { super(message); this.fields = fields; this.code = code; this.unavailablePersonalContext = unavailablePersonalContext; this.accepted = accepted; this.status = status; }
}

async function request<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  const result = await response.json();
  if (!response.ok) throw new HostRequestError(result.message ?? '本地服务未完成请求。', result.fields ?? {}, result.code ?? result.error ?? 'host_request_failed', result.code === 'PERSONAL_CONTEXT_UNAVAILABLE' && result.accepted === false && Array.isArray(result.unavailablePersonalContext) && result.unavailablePersonalContext.length > 0 && result.unavailablePersonalContext.every((index: unknown) => Number.isSafeInteger(index) && Number(index) >= 0) ? result.unavailablePersonalContext : undefined, typeof result.accepted === 'boolean' ? result.accepted : undefined, response.status);
  return result as T;
}
export function readConfigurations(signal?: AbortSignal): Promise<{ configurations: PublicModelConfiguration[]; selectedId: string | null }> { return request('configurations', 'GET', undefined, signal); }
export type WebSearchOrder = readonly [SearchProvider, SearchProvider];
export type WebSearchSettingsResponse = Omit<WebSearchSettings, 'order'> & { order: WebSearchOrder };
async function webSearchSettingsRequest(method: 'GET' | 'PUT', order?: WebSearchOrder, signal?: AbortSignal): Promise<WebSearchSettingsResponse> {
  const result = await request<WebSearchSettingsResponse>('web-search/settings', method, order && { order }, signal);
  if (!result || !Array.isArray(result.order) || result.order.length !== 2 || !result.order.includes('minimax') || !result.order.includes('deepseek')
    || typeof result.configured?.minimax !== 'boolean' || typeof result.configured?.deepseek !== 'boolean') {
    throw new HostRequestError('网络搜索设置响应无效，请重新读取。');
  }
  return result;
}
export function readWebSearchSettings(signal?: AbortSignal): Promise<WebSearchSettingsResponse> { return webSearchSettingsRequest('GET', undefined, signal); }
export function saveWebSearchOrder(order: WebSearchOrder): Promise<WebSearchSettingsResponse> { return webSearchSettingsRequest('PUT', order); }
export async function saveConfiguration(input: unknown, signal?: AbortSignal): Promise<PublicModelConfiguration> { return (await request<{ configuration: PublicModelConfiguration }>('configuration', 'PUT', input, signal)).configuration; }
export async function selectConfiguration(id: string, signal?: AbortSignal): Promise<void> { await request('configuration/select', 'POST', { id }, signal); }
export async function importCredentials(credentials: unknown, signal?: AbortSignal): Promise<void> { await request('configuration/import', 'POST', { credentials }, signal); }
export async function clearConfiguration(provider?: string, signal?: AbortSignal): Promise<void> { await request(`configuration${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`, 'DELETE', undefined, signal); }
export function testConnection(revision: number, signal?: AbortSignal): Promise<{ ok: boolean; revision: number; reply: string; message: string }> { return request('connection-test', 'POST', { revision }, signal); }
export async function listProjects(signal?: AbortSignal): Promise<ClientProject[]> { return (await request<{ projects: ClientProject[] }>('projects', 'GET', undefined, signal)).projects; }
export async function createProject(name: string, configurationId: string): Promise<ClientProject> { return (await request<{ project: ClientProject }>('projects', 'POST', { name, configurationId })).project; }
export async function renameProject(id: string, name: string): Promise<ClientProject> { return (await request<{ project: ClientProject }>(`projects/${encodeURIComponent(id)}`, 'PATCH', { name })).project; }
export async function archiveProject(id: string): Promise<ClientProject> { return (await request<{ project: ClientProject }>(`projects/${encodeURIComponent(id)}/archive`, 'POST', {})).project; }
export async function restoreProject(id: string): Promise<ClientProject> { return (await request<{ project: ClientProject }>(`projects/${encodeURIComponent(id)}/restore`, 'POST', {})).project; }
const taskPath = (projectId: string, taskId: string) => `projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
export async function createTask(projectId: string, name: string, configurationId?: string, capabilities: TaskCapabilities | boolean = {}): Promise<ClientTask> { return (await request<{ task: ClientTask }>(`projects/${encodeURIComponent(projectId)}/tasks`, 'POST', { name, ...(configurationId ? { configurationId } : {}), ...(typeof capabilities === 'boolean' ? { simulationTools: capabilities } : capabilities) })).task; }
export async function setTaskCapability(projectId: string, taskId: string, capability: TaskCapability, enabled: boolean): Promise<ClientTask> { return (await request<{ task: ClientTask }>(`${taskPath(projectId, taskId)}/capabilities`, 'PUT', { capability, enabled })).task; }
export function readTradeAreaStatus(signal?: AbortSignal): Promise<TradeAreaStatus> { return request('connectors/trade-area', 'GET', undefined, signal); }
export function readTask(projectId: string, taskId: string, signal?: AbortSignal): Promise<TaskState> { return request(taskPath(projectId, taskId), 'GET', undefined, signal); }
export function openTask(projectId: string, taskId: string): Promise<TaskState> { return request(`${taskPath(projectId, taskId)}/open`, 'POST', {}); }
export async function saveDraft(projectId: string, taskId: string, text: string): Promise<void> { await request(`${taskPath(projectId, taskId)}/draft`, 'PATCH', { text }); }
export async function sendMessage(projectId: string, taskId: string, text: string, requestId: string, caseContext?: CaseContextSelection, requirementContext?: RequirementContextSelection, enterpriseMaterials?: EnterpriseMaterialSelection[], enterpriseCaseContext?: EnterpriseCaseSelection, feedbackContext?: FeedbackContextSelection, projectData?: ProjectDataContextSelection[], personalContext?: PersonalContextSelection[], studioContext?: { systemId: string; purpose: 'construction' | 'analysis' }): Promise<void> { await request(`${taskPath(projectId, taskId)}/messages`, 'POST', { text, requestId, ...(studioContext ? { studioContext } : {}), ...(caseContext ? { caseContext } : {}), ...(requirementContext ? { requirementContext } : {}), ...(enterpriseMaterials?.length ? { enterpriseMaterials } : {}), ...(enterpriseCaseContext ? { enterpriseCaseContext } : {}), ...(feedbackContext ? { feedbackContext } : {}), ...(projectData?.length ? { projectData } : {}), ...(personalContext?.length ? { personalContext } : {}) }); }
export async function stopTask(projectId: string, taskId: string): Promise<void> { await request(`${taskPath(projectId, taskId)}/stop`, 'POST', {}); }
export function runCommand(projectId: string, taskId: string, text: string, requestId: string = crypto.randomUUID()): Promise<{ result: unknown; snapshot: SessionSnapshot; outcome?: 'completed' | 'failed' | 'cancelled' }> { return request(`${taskPath(projectId, taskId)}/commands`, 'POST', { text, requestId }); }
export async function answerInteraction(projectId: string, taskId: string, response: BrowserUIResponse): Promise<void> { await request(`${taskPath(projectId, taskId)}/ui-response`, 'POST', response); }
export async function projectFiles(id: string): Promise<FileNode[]> { return (await request<{ files: FileNode[] }>(`projects/${encodeURIComponent(id)}/files`, 'GET')).files; }
export async function uploadFile(id: string, file: File, directory: '010_draw' | '020_clean'): Promise<void> {
  if (file.size > PROJECT_UPLOAD_MAX_BYTES) throw new HostRequestError('单文件不超过 50 MiB。', {}, 'upload_too_large');
  if (!isProjectUploadName(file.name)) throw new HostRequestError('请选择支持的文档、网页、演示文稿、表格或文本文件。', {}, 'invalid_upload_name');
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new HostRequestError('文件读取失败，请重新选择。'));
    reader.onabort = () => reject(new HostRequestError('文件读取已取消。'));
    reader.onload = () => { const result = String(reader.result), comma = result.indexOf(','); if (comma < 0) reject(new HostRequestError('文件读取失败，请重新选择。')); else resolve(result.slice(comma + 1)); };
    reader.readAsDataURL(file);
  });
  await request(`projects/${encodeURIComponent(id)}/files/upload`, 'POST', { name: file.name, content, directory });
}
export async function copyToClean(id: string, path: string): Promise<void> { await request(`projects/${encodeURIComponent(id)}/files/copy-to-clean`, 'POST', { path }); }
export async function saveReport(id: string, text: string): Promise<void> { await request(`projects/${encodeURIComponent(id)}/files/save-report`, 'POST', { name: `report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`, text }); }
export async function downloadFile(id: string, file: FileNode, expectedSha256?: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/files/content?path=${encodeURIComponent(file.path)}${expectedSha256 ? `&expectedSha256=${encodeURIComponent(expectedSha256)}` : ''}`, { credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' } });
  if (!response.ok) {
    if (response.status === 409) throw new HostRequestError('采用副本的内容已变化，与保存版本不一致；未下载，请先核对来源。', {}, 'artifact_version_changed');
    throw new HostRequestError('文件暂时无法下载，请刷新文件列表后重试。');
  }
  const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export type TaskWatchOptions = { idleTimeoutMs?: number };
export async function watchTask(projectId: string, taskId: string, onEvent: (event: ProjectEvent) => void, signal: AbortSignal, options: TaskWatchOptions = {}): Promise<void> {
  if (signal.aborted) return;
  const observation = new AbortController(), observationSignal = AbortSignal.any([signal, observation.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const clearWatchdog = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const touch = () => { clearWatchdog(); timer = setTimeout(() => observation.abort(), options.idleTimeoutMs ?? 45000); };
  signal.addEventListener('abort', clearWatchdog, { once: true }); touch();
  try {
    const response = await fetch(`/api/${taskPath(projectId, taskId)}/events`, { credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' }, signal: observationSignal });
    if (!response.ok || !response.body) throw new HostRequestError('任务事件连接未建立，请重新连接。');
    reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    while (!signal.aborted) {
      const item = await reader.read(); if (item.done) break;
      touch(); // Any received bytes, including comment heartbeats, keep observation alive.
      pending += decoder.decode(item.value, { stream: true }); pending = pending.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data && !signal.aborted) {
          const event = JSON.parse(data) as ProjectEvent;
          if ((!event.projectId || event.projectId === projectId) && (!event.taskId || event.taskId === taskId)) onEvent(event);
        }
      }
    }
    if (!signal.aborted) throw new HostRequestError('任务事件连接已断开；恢复连接只读取状态，不会重复发送消息。');
  } catch (error) { if (!signal.aborted) throw error; }
  finally { clearWatchdog(); signal.removeEventListener('abort', clearWatchdog); observation.abort(); await reader?.cancel().catch(() => {}); }
}

export type TaskObservationState = { state: 'connecting' | 'connected' | 'recovering' | 'disconnected'; message?: string; requestId?: string };
export type TaskObservationOptions = TaskWatchOptions & {
  onConnection?: (value: TaskObservationState) => void;
  onReadback?: (value: TaskState, requestId?: string) => void;
  expectedRequestId?: () => string | undefined;
};
const observationBackoff = [500, 1500, 3000];
function waitForObservation(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
  });
}
function checkedReadback(value: TaskState, projectId: string, taskId: string, expectedRequestId?: string): { requestId?: string; message: string } {
  if (value.project.id !== projectId || value.task.id !== taskId) throw new HostRequestError('无法确认原任务状态：返回的任务归属不一致。');
  const saved = value.task.lastRun, native = value.snapshot.lastRun, requestId = expectedRequestId ?? saved?.id ?? native?.requestId;
  if (!requestId && !saved && !native && value.snapshot.status === 'idle') return { message: '已读回空闲任务，没有确认新的运行结果。' };
  if (!requestId || saved?.id !== requestId || native?.requestId !== requestId) throw new HostRequestError('无法确认原请求状态：请求记录已变化或缺少对应记录。');
  if (saved.status === 'running' && value.snapshot.status === 'running' && !native.outcome) return { requestId, message: '已读回：原请求仍在运行。' };
  if (value.snapshot.status === 'idle' && (saved.status === 'completed' || saved.status === 'failed' || saved.status === 'cancelled') && native.outcome === saved.status) {
    const label = { completed: '已完成', failed: '已失败', cancelled: '已停止' }[saved.status];
    return { requestId, message: `已读回：原请求${label}。` };
  }
  throw new HostRequestError('无法确认原请求终态，任务结果仍未知；不会重发消息。');
}
/** Restore observation only. All network actions here are GET; missing events are not replayed. */
export async function observeTask(projectId: string, taskId: string, onEvent: (event: ProjectEvent) => void, signal: AbortSignal, options: TaskObservationOptions = {}): Promise<void> {
  let observedRequestId: string | undefined;
  const report = (value: TaskObservationState) => { if (!signal.aborted) options.onConnection?.(value); };
  for (let attempt = 0; attempt <= observationBackoff.length && !signal.aborted; attempt++) {
    let connected = false;
    report({ state: attempt ? 'recovering' : 'connecting', message: attempt ? '正在恢复任务观察连接；不会重发消息。' : undefined });
    try {
      await watchTask(projectId, taskId, event => {
        if (signal.aborted) return;
        if (event.type === 'snapshot') observedRequestId = event.snapshot.lastRun?.requestId ?? observedRequestId;
        else if ('requestId' in event && event.requestId) observedRequestId = event.requestId;
        if (!connected && event.type === 'snapshot') { connected = true; report({ state: 'connected' }); }
        onEvent(event);
      }, signal, options);
      if (signal.aborted) return;
    } catch { if (signal.aborted) return; }
    report({ state: 'recovering', message: '观察连接已断开，正在只读核对任务状态；不会重发消息。' });
    let message = '任务状态仍未知；不会重发消息。', requestId = options.expectedRequestId?.() ?? observedRequestId;
    try {
      const value = await readTask(projectId, taskId, AbortSignal.any([signal, AbortSignal.timeout(10000)]));
      if (signal.aborted) return;
      const currentRequestId = options.expectedRequestId?.();
      if (currentRequestId && currentRequestId !== requestId) throw new HostRequestError('无法确认原请求状态：当前请求已变化。');
      const readback = checkedReadback(value, projectId, taskId, requestId);
      requestId = readback.requestId; message = readback.message;
      options.onReadback?.(value, requestId);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof HostRequestError && error.message.startsWith('无法确认')) message = error.message;
    }
    if (signal.aborted) return;
    if (attempt === observationBackoff.length) { report({ state: 'disconnected', requestId, message: `${message} 实时观察暂未恢复，请显式重新连接。` }); return; }
    report({ state: 'recovering', requestId, message: `${message} 正在恢复实时观察。` });
    await waitForObservation(observationBackoff[attempt]!, signal);
  }
}

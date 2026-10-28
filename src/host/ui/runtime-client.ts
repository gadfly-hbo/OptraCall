import type { BrowserUIResponse, ClientProject, FileNode, ProjectEvent, PublicModelConfiguration, SessionSnapshot } from './project-types.ts';

export class HostRequestError extends Error {
  readonly fields: Record<string, string>;
  readonly code: string;
  constructor(message: string, fields: Record<string, string> = {}, code = 'host_request_failed') { super(message); this.fields = fields; this.code = code; }
}

async function request<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  const result = await response.json();
  if (!response.ok) throw new HostRequestError(result.message ?? '本地服务未完成请求。', result.fields ?? {}, result.code ?? result.error ?? 'host_request_failed');
  return result as T;
}
export async function readConfiguration(signal?: AbortSignal): Promise<PublicModelConfiguration | null> { return (await request<{ configuration: PublicModelConfiguration | null }>('configuration', 'GET', undefined, signal)).configuration; }
export function readConfigurations(signal?: AbortSignal): Promise<{ configurations: PublicModelConfiguration[]; selectedId: string | null }> { return request('configurations', 'GET', undefined, signal); }
export async function saveConfiguration(input: unknown, signal?: AbortSignal): Promise<PublicModelConfiguration> { return (await request<{ configuration: PublicModelConfiguration }>('configuration', 'PUT', input, signal)).configuration; }
export async function selectConfiguration(id: string, signal?: AbortSignal): Promise<void> { await request('configuration/select', 'POST', { id }, signal); }
export async function importCredentials(credentials: unknown, signal?: AbortSignal): Promise<void> { await request('configuration/import', 'POST', { credentials }, signal); }
export async function clearConfiguration(provider?: string, signal?: AbortSignal): Promise<void> { await request(`configuration${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`, 'DELETE', undefined, signal); }
export function testConnection(revision: number, signal?: AbortSignal): Promise<{ ok: boolean; revision: number; reply: string; message: string }> { return request('connection-test', 'POST', { revision }, signal); }
export async function listProjects(signal?: AbortSignal): Promise<ClientProject[]> { return (await request<{ projects: ClientProject[] }>('projects', 'GET', undefined, signal)).projects; }
export async function createProject(name: string, configurationId: string): Promise<ClientProject> { return (await request<{ project: ClientProject }>('projects', 'POST', { name, configurationId })).project; }
export function readProject(id: string, signal?: AbortSignal): Promise<{ project: ClientProject; snapshot: SessionSnapshot }> { return request(`projects/${encodeURIComponent(id)}`, 'GET', undefined, signal); }
export async function saveDraft(id: string, text: string): Promise<void> { await request(`projects/${encodeURIComponent(id)}/draft`, 'PATCH', { text }); }
export async function sendMessage(id: string, text: string, requestId: string): Promise<void> { await request(`projects/${encodeURIComponent(id)}/messages`, 'POST', { text, requestId }); }
export async function stopProject(id: string): Promise<void> { await request(`projects/${encodeURIComponent(id)}/stop`, 'POST', {}); }
export function runCommand(id: string, text: string, requestId: string = crypto.randomUUID()): Promise<{ result: unknown; snapshot: SessionSnapshot; outcome?: 'completed' | 'failed' | 'cancelled' }> { return request(`projects/${encodeURIComponent(id)}/commands`, 'POST', { text, requestId }); }
export async function answerInteraction(id: string, response: BrowserUIResponse): Promise<void> { await request(`projects/${encodeURIComponent(id)}/ui-response`, 'POST', response); }
export async function projectFiles(id: string): Promise<FileNode[]> { return (await request<{ files: FileNode[] }>(`projects/${encodeURIComponent(id)}/files`, 'GET')).files; }
export async function uploadFile(id: string, file: File, directory: '010_draw' | '020_clean'): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  await request(`projects/${encodeURIComponent(id)}/files/upload`, 'POST', { name: file.name, content: btoa(binary), directory });
}
export async function copyToClean(id: string, path: string): Promise<void> { await request(`projects/${encodeURIComponent(id)}/files/copy-to-clean`, 'POST', { path }); }
export async function saveReport(id: string, text: string): Promise<void> { await request(`projects/${encodeURIComponent(id)}/files/save-report`, 'POST', { name: `report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`, text }); }
export async function downloadFile(id: string, file: FileNode): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/files/content?path=${encodeURIComponent(file.path)}`, { credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' } });
  if (!response.ok) throw new HostRequestError('文件暂时无法下载，请刷新文件列表后重试。');
  const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function watchProject(id: string, onEvent: (event: ProjectEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/events`, { credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' }, signal });
  if (!response.ok || !response.body) throw new HostRequestError('项目事件连接未建立，请重新连接。');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
  try {
    while (!signal.aborted) {
      const item = await reader.read(); if (item.done) break;
      pending += decoder.decode(item.value, { stream: true }); pending = pending.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) onEvent(JSON.parse(data) as ProjectEvent);
      }
    }
    if (!signal.aborted) throw new HostRequestError('项目事件连接已断开；恢复连接只读取状态，不会重复发送消息。');
  } finally { await reader.cancel().catch(() => {}); }
}

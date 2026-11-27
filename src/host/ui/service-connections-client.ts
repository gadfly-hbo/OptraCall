import { SERVICE_IDS, SERVICE_SCOPES, checkServiceBinding, type ServiceConnection, type ServiceConnectionConfig, type ServiceConnectionCredentials, type ServiceId, type ServiceScope, type TaskServiceBinding } from '../service-connection-types.ts';
import type { ClientTask } from './project-types.ts';

export type ServiceAuthorization = { url: string; attemptId: string };
export type ServiceAuthorizationResult = { attemptId: string; status: 'failed' | 'cancelled' | 'succeeded'; code?: string };
export type ServiceConnectionSnapshot = { connection: ServiceConnection; authorization?: ServiceAuthorization; authorizationResult?: ServiceAuthorizationResult; affectedTasks?: string[] };
export type ServiceAuthorizationObservation = { status: 'pending' | 'failed' | 'cancelled' | 'succeeded' | 'unknown'; message: string };
export const serviceNames: Record<ServiceId, string> = { github: 'GitHub', gmail: 'Gmail', tencent: '腾讯邮箱', feishu: '飞书' };
export const serviceStateLabels: Record<ServiceConnection['status'], string> = { disconnected: '尚未连接', unverified: '已保存 · 尚未核验', authorizing: '等待用户授权', verified: '已核验', expired: '授权已失效', error: '连接错误', disconnecting: '正在断开', unknown: '结果待核' };
export const serviceScopeLabels: Record<ServiceScope, string> = { read: '读取', collaborate: 'Issue / PR 协作', merge: 'PR 合并', manage: '草稿与标签', send: '发送邮件', write: '云文档写入', message: '发送消息' };

const errorMessages: Record<string, string> = {
  invalid_service_repositories: '请填写 owner/repository 格式的仓库，多个仓库用英文逗号分隔。',
  invalid_service_email: '请填写完整的邮箱地址。',
  invalid_service_redirect: '回调地址须为运行 OptraCall 设备上的 localhost 或 127.0.0.1 地址。',
  invalid_service_credentials: '请重新填写该服务所需的凭据。',
  invalid_service_scopes: '请选择当前账号实际获准的能力范围。',
  service_revision_conflict: '连接已在其他位置变化。请先刷新，再核对本次选择。',
  service_connection_conflict: '连接已在其他位置变化。请先刷新，再核对本次选择。',
  service_cleanup_unknown: '后续调用资格已撤销，连接资源收尾结果尚待核对。请先查询当前状态。',
  service_connection_changed: '连接已变化，请先读取当前状态，再核对本次选择。',
  service_authorization_changed: '本次授权请求已结束或已变化，请先查询当前连接状态。',
  service_binding_changed: '绑定的账号或权限已变化。请核对当前账号并重新选择。',
  service_admin_required: '企业管理员尚未安装官方应用，或尚未放行所选工具。请联系管理员后重新授权。',
  feishu_admin_required: '企业管理员尚未安装官方应用，或尚未放行所选工具。请联系管理员后重新授权。',
  service_oauth_cancelled: '本次授权已取消。原任务选择继续保留。',
  service_authorization_cancelled: '本次授权已取消。原任务选择继续保留。',
  service_permission_missing: '账号未获得所需权限，请调整服务端权限后重新核验。',
  service_identity_unverified: '尚未核验出实际账号身份，请完成授权后重新核验。',
  service_connection_unverified: '连接尚未通过账号与权限核验。请完成连接后再开启任务。',
  service_authentication_required: '授权已失效，请重新连接该账号。',
  service_auth_required: '需要完成账号授权，请重新连接。',
  service_protocol_disabled: '邮箱的 IMAP / SMTP 服务尚未开启，或管理员尚未允许客户端登录。',
};
export class ServiceConnectionRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(errorMessages[code] ?? (status === 409 ? '连接或任务正在使用中，或配置已经变化。请刷新后在任务空闲时操作。' : status === 401 ? '授权已失效，请重新连接该账号。' : status === 403 ? '服务或管理员未授予所需权限，请核对应用安装、账号和工具范围。' : status === 400 ? '请核对应用配置、账号与所选权限后重试。' : '服务暂时不可用，请检查网络并重新读取连接状态。'));
    this.name = 'ServiceConnectionRequestError';
    this.code = code; this.status = status;
  }
}
export class ServiceConnectionUncertain extends Error {
  constructor() { super('本次操作的结果尚未确认。请先刷新连接状态；不会自动重复提交。'); this.name = 'ServiceConnectionUncertain'; }
}
export const serviceConnectionErrorText = (error: unknown) => error instanceof ServiceConnectionRequestError || error instanceof ServiceConnectionUncertain ? error.message : '暂时无法读取连接，请检查本机服务与网络后重试。';

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
  } catch (error) {
    if (signal?.aborted || method === 'GET') throw error;
    throw new ServiceConnectionUncertain();
  }
  let value: unknown;
  try { value = await response.json(); } catch { if (method !== 'GET' && response.status >= 500) throw new ServiceConnectionUncertain(); throw new ServiceConnectionRequestError('service_response_invalid', response.status); }
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : 'service_request_failed';
    // Provider diagnostics can contain credentials. Only fixed local messages are rendered.
    throw new ServiceConnectionRequestError(code, response.status);
  }
  return value as T;
}
function connectionOwner(value: ServiceConnection, service?: ServiceId): ServiceConnection {
  if (!value || !SERVICE_IDS.includes(value.service) || service !== undefined && value.service !== service || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Object.hasOwn(serviceStateLabels, value.status) || !Array.isArray(value.scopes) || value.scopes.some(scope => !SERVICE_SCOPES[value.service].includes(scope)) || !Array.isArray(value.tools) || !value.credentialsConfigured) throw new ServiceConnectionRequestError('service_response_invalid', 409);
  return value;
}
function snapshotOwner(value: ServiceConnectionSnapshot, service: ServiceId): ServiceConnectionSnapshot {
  connectionOwner(value.connection, service);
  if (value.authorization && (!trustedServiceAuthorizationUrl(service, value.authorization.url) || typeof value.authorization.attemptId !== 'string' || !value.authorization.attemptId)) throw new ServiceConnectionRequestError('service_authorization_invalid', 409);
  if (value.authorizationResult && (typeof value.authorizationResult.attemptId !== 'string' || !value.authorizationResult.attemptId || value.authorizationResult.attemptId.length > 500 || !['failed', 'cancelled', 'succeeded'].includes(value.authorizationResult.status) || value.authorizationResult.code !== undefined && (typeof value.authorizationResult.code !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(value.authorizationResult.code)))) throw new ServiceConnectionRequestError('service_authorization_invalid', 409);
  return value;
}
/** The old verified account can survive a failed replacement authorization. Only the exact
 * terminal attempt receipt proves this authorization outcome; connection state alone cannot.
 */
export function serviceAuthorizationObservation(value: ServiceConnectionSnapshot, attemptId: string): ServiceAuthorizationObservation {
  const result = value.authorizationResult;
  if (result?.attemptId === attemptId) {
    if (result.status === 'failed') return { status: 'failed', message: `本次账号授权失败。${result.code && errorMessages[result.code] ? errorMessages[result.code] : '请核对权限、应用配置与网络后重新授权。'} 原有连接与任务选择保留。` };
    if (result.status === 'cancelled') return { status: 'cancelled', message: '本次账号授权已取消。原有连接与任务选择保留。' };
    if (result.status === 'succeeded' && value.connection.status === 'verified' && value.connection.accountId) return { status: 'succeeded', message: '本次账号授权已完成，并已核验实际账号与工具。回到原任务后可单独开启。' };
  }
  if (value.authorization?.attemptId === attemptId && result?.attemptId !== attemptId) return { status: 'pending', message: '应用配置已保存。请前往官方页面完成本人账号授权。' };
  return { status: 'unknown', message: '本次账号授权结果尚未确认。现有账号状态不能证明本次授权成功，请查询当前状态。' };
}
export function trustedServiceAuthorizationUrl(service: ServiceId, value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return undefined;
    const trusted = service === 'github' ? url.origin === 'https://github.com' && url.pathname === '/login/oauth/authorize'
      : service === 'gmail' ? url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth'
        : service === 'feishu' && ['https://accounts.feishu.cn', 'https://open.feishu.cn', 'https://passport.feishu.cn', 'https://mcp.feishu.cn'].includes(url.origin);
    return trusted ? url.href : undefined;
  } catch { return undefined; }
}
export async function listServiceConnections(signal?: AbortSignal): Promise<ServiceConnection[]> {
  const value = await request<{ connections: ServiceConnection[] }>('/api/service-connections', 'GET', undefined, signal);
  if (!Array.isArray(value.connections) || new Set(value.connections.map(connection => connection.service)).size !== value.connections.length) throw new ServiceConnectionRequestError('service_response_invalid', 409);
  return value.connections.map(connection => connectionOwner(connection));
}
export async function readServiceConnection(service: ServiceId, signal?: AbortSignal): Promise<ServiceConnectionSnapshot> {
  return snapshotOwner(await request<ServiceConnectionSnapshot>(`/api/service-connections/${service}/status`, 'GET', undefined, signal), service);
}
export async function saveServiceConnection(service: ServiceId, expectedRevision: number, config: ServiceConnectionConfig, credentials?: ServiceConnectionCredentials): Promise<ServiceConnectionSnapshot> {
  return snapshotOwner(await request<ServiceConnectionSnapshot>(`/api/service-connections/${service}`, 'PUT', { expectedRevision, config, ...(credentials && Object.keys(credentials).length ? { credentials } : {}) }), service);
}
export async function actOnServiceConnection(service: ServiceId, action: 'connect' | 'verify' | 'disconnect' | 'oauth/start', expectedRevision: number): Promise<ServiceConnectionSnapshot> {
  return snapshotOwner(await request<ServiceConnectionSnapshot>(`/api/service-connections/${service}/${action}`, 'POST', { expectedRevision }), service);
}
export async function cancelServiceAuthorization(service: ServiceId, attemptId: string): Promise<ServiceConnectionSnapshot> {
  return snapshotOwner(await request<ServiceConnectionSnapshot>(`/api/service-connections/${service}/oauth/cancel`, 'POST', { attemptId }), service);
}
export async function setTaskServiceConnection(projectId: string, taskId: string, service: ServiceId, input: { enabled: boolean; scopes?: ServiceScope[]; repositories?: string[]; expectedConnectionRevision: number }): Promise<ClientTask> {
  const value = await request<{ task: ClientTask }>(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/service-connections/${service}`, 'PUT', input);
  if (!value.task || value.task.id !== taskId) throw new ServiceConnectionRequestError('service_task_owner_mismatch', 409);
  return value.task;
}
export function serviceBindingAvailability(connection: ServiceConnection | undefined, binding: TaskServiceBinding): { available: boolean; label: string } {
  const check = checkServiceBinding(connection, binding);
  if (check.available) return { available: true, label: '本任务已开启' };
  return { available: false, label: check.reason === 'binding_changed' ? '绑定已变化 · 请重新选择' : check.reason === 'scope_missing' ? '原权限已变化 · 请重新选择' : check.reason === 'disconnected' ? '连接已断开 · 保留原选择' : '连接暂不可用 · 保留原选择' };
}
export const serviceScopeSummary = (scopes: readonly ServiceScope[]) => scopes.map(scope => serviceScopeLabels[scope]).join('、');
export const serviceMailboxLabel = (type: ServiceConnection['mailboxType']) => type === 'exmail' ? '腾讯企业邮箱' : 'QQ / Foxmail 邮箱';
export function serviceScopeSelection(service: ServiceId, scope: ServiceScope): ServiceScope[] {
  return SERVICE_SCOPES[service].slice(0, SERVICE_SCOPES[service].indexOf(scope) + 1);
}

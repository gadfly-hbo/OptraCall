import type { DbLinkConnectionInput, DbLinkPublicConnection, DbLinkTestReceipt, DbLinkSource, DbLinkProjectGrantInput, DbLinkTaskPolicy } from '../db-link-types.ts';
import type { DbResultCell, DbResultManifest, DbResultReceipt } from '../db-link-results.ts';

export class DbLinkRequestError extends Error {
  readonly code: string; readonly uncertain: boolean;
  constructor(code: string, uncertain = false) { super(uncertain ? '操作结果尚未核定（UNKNOWN）。请先读取原记录核对，不要重复提交。' : messages[code] ?? '数据库资料暂时无法读取或保存，请核对配置与当前资格。'); this.code = code; this.uncertain = uncertain; }
}
const messages: Record<string, string> = {
  db_test_required: '配置已变化或测试已过期，请重新测试后保存。', invalid_db_configuration: '连接字段、DNS 主机名、TLS 或预算无效，请检查表单。',
  db_test_failed: '连接测试未通过，请检查地址、凭据和证书；原配置保留。', db_project_archived: '项目已归档，当前只可查看已有资料。',
  db_source_not_authorized: '本项目或当前任务没有此来源资格。', db_model_export_not_authorized: '当前模型或内容类型不在已授权的数据出口内。',
  db_connection_changed: '连接配置已有新修订，请核对新版本后更新本项目授权。', db_task_scope_expanded: '任务只能收窄项目范围和模型出口。',
  db_response_mismatch: '返回资料与当前项目、任务或确切版本不一致，已拒绝显示。', db_read_failed: '数据库资料暂时无法读取，请稍后刷新。',
  db_read_unconfirmed: '该来源有尚未确认结束的读取或连接测试（UNKNOWN）。请先核对原操作；改名或重启不会清除未结束事实。',
  db_remote_termination_unknown: '尚不能确认原数据库操作已结束。请先处理原操作的收尾，不要重复取数。',
  db_connection_busy: '该来源正在读取或收尾，暂不能开始另一项读取。',
  db_query_not_qualified: '该来源尚未通过读取验证，请查看连接测试结果和实际可用范围。',
  db_operation_budget_exhausted: '本次操作已达到时间预算。实际收尾仍需确认；后续可在原操作结束后调整取数范围。',
  db_pg_version_not_validated: '当前已验证 PostgreSQL 18.1；这个数据库版本尚未开放查询，可保留连接和目录观察。',
  db_view_scope_not_independently_verified: '当前结果来自正式视图，尚未独立核查底表及视图定义的完整范围。',
  db_current_role_policy_visible_scope: '结果受当前账号的行级权限约束，未核查不可见数据。',
  db_endpoint_identity_not_physical_instance_proof: '已记录连接端点；这不能证明不同连接始终落到同一物理实例。',
  db_metadata_comment_truncated: '注释仅提供有界前缀，未取得全部正文。',
  db_relationships_unknown: '关联目录信息不完备，可在当前授权内继续核查和分析。',
};
export const dbLinkLimitation = (code: string): string => messages[code] ?? code;
export type DbLinkModelTarget = { reference: string; canonical: string };
export type DbLinkTaskSources = { sources: DbLinkSource[]; projectSources: DbLinkSource[]; currentModelTarget?: DbLinkModelTarget };
export type DbLinkPreparedGrant = { input: DbLinkProjectGrantInput; expected: DbLinkProjectGrantInput };
const canonicalTarget = (value: unknown): value is string => typeof value === 'string' && /^outlet:[a-f0-9]{64}$/.test(value);
const exactTarget = (value: unknown): value is string => typeof value === 'string' && (canonicalTarget(value) || /^[A-Za-z0-9_-]{1,100}@[0-9]{1,16}$/.test(value));
function checkedModelTarget(value: unknown): DbLinkModelTarget | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || !exactTarget(value.reference) || !canonicalTarget(value.canonical)) return mismatch();
  return { reference: value.reference, canonical: value.canonical };
}
export async function prepareDbGrant(projectId: string, input: DbLinkProjectGrantInput): Promise<DbLinkPreparedGrant> {
  const captured = structuredClone(input), targets = captured.modelExport.targets;
  if (!targets.length || targets.length > 100 || targets.some(target => typeof target !== 'string' || target.length > 200)) throw new DbLinkRequestError('db_model_target_unknown');
  const query = new URLSearchParams(); for (const target of targets) query.append('target', target);
  const resolved = await request<{ targets: unknown; canonicalTargets: unknown }>(`/api/projects/${encodeURIComponent(projectId)}/db-link/model-targets?${query}`);
  const matches = (requested: string, resolved: string) => requested.includes('@') || canonicalTarget(requested) ? requested === resolved : resolved.startsWith(requested + '@');
  if (!Array.isArray(resolved.targets) || !resolved.targets.length || resolved.targets.length > 100 || !resolved.targets.every(exactTarget) || !Array.isArray(resolved.canonicalTargets) || !resolved.canonicalTargets.length || resolved.canonicalTargets.length > 100 || !resolved.canonicalTargets.every(canonicalTarget) || targets.some(target => !(resolved.targets as string[]).some(reference => matches(target, reference))) || (resolved.targets as string[]).some(reference => !targets.some(target => matches(target, reference)))) return mismatch();
  const expected = structuredClone(captured);
  captured.modelExport.targets = [...resolved.targets]; expected.modelExport.targets = [...resolved.canonicalTargets];
  return { input: captured, expected };
}
export function dbGrantMatches(observed: DbLinkSource | undefined, expected: DbLinkProjectGrantInput): boolean {
  const same = (a: string[], b: string[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
  return Boolean(observed && !observed.grant.revokedAt && observed.connection.id === expected.connectionId && observed.connection.revision === expected.connectionRevision && same(observed.scope.objects, expected.scope.objects) && same(observed.modelExport.targets, expected.modelExport.targets) && (['structure', 'comments', 'queryText', 'results'] as const).every(key => observed.modelExport[key] === expected.modelExport[key]));
}
export function dbModelTargetAllowed(target: DbLinkModelTarget | undefined, source: DbLinkSource): boolean { return Boolean(target && source.modelExport.targets.includes(target.canonical)); }
export type DbLinkResultDetail = { receipt: DbResultReceipt; manifest: DbResultManifest; rowsPreview: DbResultCell[][] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const mismatch = (mutating = false): never => { throw new DbLinkRequestError('db_response_mismatch', mutating); };
async function request<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const mutating = method !== 'GET';
  try {
    const response = await fetch(url, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'x-optracall-client': '1', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    const value: unknown = await response.json();
    if (!response.ok) throw new DbLinkRequestError(object(value) && typeof value.code === 'string' ? value.code : 'db_request_failed', mutating && (response.status >= 500 || response.status === 408));
    return value as T;
  } catch (error) {
    if (error instanceof DbLinkRequestError) throw error;
    if (!mutating && signal?.aborted) throw error;
    throw new DbLinkRequestError(mutating ? 'db_result_unknown' : 'db_read_failed', mutating);
  }
}
function checkedConnections(value: unknown, mutating = false): DbLinkPublicConnection[] {
  if (!Array.isArray(value) || value.some(item => !object(item) || typeof item.id !== 'string' || typeof item.fingerprint !== 'string' || !Number.isSafeInteger(item.revision) || 'password' in item || !object(item.observation))) return mismatch(mutating);
  return value as DbLinkPublicConnection[];
}
export async function listDbConnections(signal?: AbortSignal): Promise<DbLinkPublicConnection[]> {
  const value = await request<{ connections: unknown }>('/api/db-link/connections', 'GET', undefined, signal); return checkedConnections(value.connections);
}
export async function testDbConnection(configuration: DbLinkConnectionInput): Promise<DbLinkTestReceipt> {
  const value = await request<{ receipt: DbLinkTestReceipt }>('/api/db-link/connections/test', 'POST', configuration);
  if (!object(value.receipt) || typeof value.receipt.id !== 'string' || typeof value.receipt.fingerprint !== 'string' || typeof value.receipt.reachable !== 'boolean' || !Number.isFinite(Date.parse(value.receipt.expiresAt))) return mismatch(true);
  return value.receipt;
}
export async function saveDbConnection(configuration: DbLinkConnectionInput, testReceiptId: string, expectedFingerprint?: string): Promise<DbLinkPublicConnection> {
  const value = await request<{ connection: unknown }>('/api/db-link/connections', 'POST', { configuration, testReceiptId });
  const connection = checkedConnections([value.connection], true)[0]; if ((configuration.id && connection.id !== configuration.id) || (expectedFingerprint !== undefined && connection.fingerprint !== expectedFingerprint)) return mismatch(true); return connection;
}
const sourcePath = (projectId: string, taskId?: string) => `/api/projects/${encodeURIComponent(projectId)}${taskId ? `/tasks/${encodeURIComponent(taskId)}` : ''}/db-link/sources`;
function sources(value: unknown, projectId: string, mutating = false): DbLinkSource[] {
  if (!Array.isArray(value) || value.some(item => !object(item) || !object(item.grant) || item.grant.projectId !== projectId || !object(item.connection) || item.connection.id !== item.grant.connectionId || item.connection.revision !== item.grant.connectionRevision || item.connection.fingerprint !== item.grant.connectionFingerprint || 'password' in item.connection)) return mismatch(mutating);
  return value as DbLinkSource[];
}
export async function listDbSources(projectId: string, taskId?: string, signal?: AbortSignal): Promise<DbLinkTaskSources> {
  const value = await request<{ sources: unknown; projectSources?: unknown; currentModelTarget?: unknown }>(sourcePath(projectId, taskId), 'GET', undefined, signal);
  return { sources: sources(value.sources, projectId), projectSources: sources(taskId ? value.projectSources : value.sources, projectId), currentModelTarget: checkedModelTarget(value.currentModelTarget) };
}
export async function grantDbSource(projectId: string, input: DbLinkProjectGrantInput): Promise<DbLinkSource[]> { const value = await request<{ sources: unknown }>(sourcePath(projectId), 'POST', input); return sources(value.sources, projectId, true); }
export async function revokeDbSource(projectId: string, connectionId: string): Promise<DbLinkSource[]> { const value = await request<{ sources: unknown }>(`${sourcePath(projectId)}/${encodeURIComponent(connectionId)}`, 'DELETE'); return sources(value.sources, projectId, true); }
export async function updateDbTaskSource(projectId: string, taskId: string, connectionId: string, input: DbLinkTaskPolicy): Promise<DbLinkTaskSources> {
  const value = await request<{ sources: unknown; projectSources: unknown; currentModelTarget?: unknown }>(`${sourcePath(projectId, taskId)}/${encodeURIComponent(connectionId)}`, 'PUT', input);
  return { sources: sources(value.sources, projectId, true), projectSources: sources(value.projectSources, projectId, true), currentModelTarget: checkedModelTarget(value.currentModelTarget) };
}
const resultPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/db-link/results`;
function resultOwner(value: unknown, projectId: string, taskId?: string): value is DbResultReceipt { return object(value) && object(value.owner) && value.owner.projectId === projectId && (!taskId || value.owner.taskId === taskId) && typeof value.id === 'string'; }
export async function listDbResults(projectId: string, taskId?: string, signal?: AbortSignal): Promise<DbResultReceipt[]> {
  const value = await request<{ results: unknown }>(`${resultPath(projectId)}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`, 'GET', undefined, signal);
  if (!Array.isArray(value.results) || value.results.some(item => !resultOwner(item, projectId, taskId))) return mismatch(); return value.results as DbResultReceipt[];
}
export async function readDbResult(projectId: string, resultId: string, taskId?: string, signal?: AbortSignal): Promise<DbLinkResultDetail> {
  const value = await request<DbLinkResultDetail>(`${resultPath(projectId)}/${encodeURIComponent(resultId)}`, 'GET', undefined, signal);
  if (!resultOwner(value.receipt, projectId, taskId) || value.receipt.id !== resultId || !resultOwner(value.manifest, projectId, taskId) || value.manifest.id !== resultId || !Array.isArray(value.rowsPreview)) return mismatch(); return value;
}
export const dbLinkError = (error: unknown): string => error instanceof DbLinkRequestError ? error.message : '数据库资料暂时无法读取，请稍后刷新。';

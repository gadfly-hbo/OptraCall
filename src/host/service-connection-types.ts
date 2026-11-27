/** Public connection policy. Credentials belong exclusively to the Host private store. */
export const SERVICE_IDS = ['github', 'gmail', 'tencent', 'feishu'] as const;
export type ServiceId = typeof SERVICE_IDS[number];
export type ServiceScope = 'read' | 'collaborate' | 'merge' | 'manage' | 'send' | 'write' | 'message';
export const SERVICE_SCOPES: Readonly<Record<ServiceId, readonly ServiceScope[]>> = Object.freeze({
  github: Object.freeze(['read', 'collaborate', 'merge'] as const),
  gmail: Object.freeze(['read', 'manage', 'send'] as const),
  tencent: Object.freeze(['read', 'send'] as const),
  feishu: Object.freeze(['read', 'write', 'message'] as const),
});
export const SERVICE_URLS = Object.freeze({ github: 'https://api.githubcopilot.com/mcp/', gmail: 'https://gmailmcp.googleapis.com/mcp/v1', feishu: 'https://mcp.feishu.cn/mcp' });
export type TencentMailboxType = 'qq' | 'exmail';
export const TENCENT_MAIL_SERVERS = Object.freeze({
  qq: Object.freeze({ imapHost: 'imap.qq.com', imapPort: 993, smtpHost: 'smtp.qq.com', smtpPort: 465, secure: true }),
  exmail: Object.freeze({ imapHost: 'imap.exmail.qq.com', imapPort: 993, smtpHost: 'smtp.exmail.qq.com', smtpPort: 465, secure: true }),
});
export type ServiceConnectionStatus = 'disconnected' | 'unverified' | 'authorizing' | 'verified' | 'expired' | 'error' | 'disconnecting' | 'unknown';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ServiceTool = {
  name: string;
  semanticName: string;
  /** SHA-256 of the exact trusted remote tool metadata frozen during verification. */
  metadataFingerprint?: string;
  inputSchema: { [key: string]: JsonValue };
  scope: ServiceScope;
  action: ServiceScope;
  write: boolean;
  requiresConfirmation: boolean;
};
export type ServiceConnectionConfig = {
  scopes: ServiceScope[];
  repositories?: string[];
  mailboxType?: TencentMailboxType;
  email?: string;
  clientId?: string;
  redirectUri?: string;
  /** Only the preset service name is accepted; arbitrary issuers/servers are forbidden. */
  issuer?: 'github' | 'google' | 'feishu';
};
/** Never serialize this type into API responses, events, task bindings or model context. */
export type ServiceConnectionCredentials = {
  accessToken?: string;
  refreshToken?: string;
  clientSecret?: string;
  authorizationCode?: string;
  expiresAt?: string;
  oauthClientId?: string;
  /** Opaque canonical native Pi OAuth credential/client/discovery record; Host only. */
  oauthState?: string;
};
export type ServiceCredentialPresence = { accessToken: boolean; refreshToken: boolean; clientSecret: boolean; authorizationCode: boolean };
export type ServiceConnection = ServiceConnectionConfig & {
  connectionId: string;
  service: ServiceId;
  revision: number;
  status: ServiceConnectionStatus;
  accountId?: string;
  accountLabel?: string;
  tenantId?: string;
  appId?: string;
  tools: ServiceTool[];
  credentialsConfigured: ServiceCredentialPresence;
  verifiedAt?: string;
  updatedAt: string;
};
/** Produced only by the trusted provider identity/permission probe, never directly from HTTP input. */
export type ServiceConnectionVerification = {
  accountId: string;
  accountLabel: string;
  scopes: ServiceScope[];
  tools: ServiceTool[];
  repositories?: string[];
  mailboxType?: TencentMailboxType;
  tenantId?: string;
  appId?: string;
};
export type TaskServiceBinding = Readonly<{
  service: ServiceId;
  connectionId: string;
  accountId: string;
  accountLabel: string;
  revision: number;
  scopes: readonly ServiceScope[];
  repositories?: readonly string[];
  mailboxType?: TencentMailboxType;
  tenantId?: string;
  appId?: string;
  tools: readonly ServiceTool[];
}>;
export type TaskServiceBindings = Partial<Record<ServiceId, TaskServiceBinding>>;
export type ServiceBindingCheck = { available: true; connection: ServiceConnection; binding: TaskServiceBinding } | { available: false; reason: 'disconnected' | 'unverified' | 'binding_changed' | 'scope_missing' };
export type ServiceOperationStatus = 'prepared' | 'confirmed' | 'submitted' | 'succeeded' | 'rejected' | 'unknown';
export type ServiceOperationOwner = { projectId: string; taskId: string; requestId: string; toolCallId: string };
export type ServiceOperationInput = ServiceOperationOwner & {
  operationId?: string;
  binding: TaskServiceBinding;
  toolName: string;
  target: { [key: string]: JsonValue };
  /** Exact arguments go only to the private journal; ordinary listings omit them. */
  arguments: { [key: string]: JsonValue };
  requiresConfirmation: boolean;
};
export type ServiceOperationAttempt = ServiceOperationOwner & {
  operationId: string;
  service: ServiceId;
  connectionId: string;
  accountId: string;
  accountLabel: string;
  revision: number;
  tenantId?: string;
  appId?: string;
  mailboxType?: TencentMailboxType;
  toolName: string;
  target: { [key: string]: JsonValue };
  argumentsDigest: string;
  contentDigest: string;
  requiresConfirmation: boolean;
  status: ServiceOperationStatus;
  createdAt: string;
  updatedAt: string;
  resultId?: string;
};

export class ServiceConnectionError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super('服务连接请求未能完成。'); this.name = 'ServiceConnectionError'; this.code = code; this.status = status; }
}
export function isServiceId(value: unknown): value is ServiceId { return SERVICE_IDS.includes(value as ServiceId); }
export function serviceRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
export function serviceText(value: unknown, max = 500): string {
  if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ServiceConnectionError('invalid_service_configuration');
  return value;
}
export function serviceKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ServiceConnectionError('invalid_service_configuration');
}
export function parseServiceScopes(service: ServiceId, input: unknown): ServiceScope[] {
  if (!Array.isArray(input) || !input.length || input.length > SERVICE_SCOPES[service].length || input.some(scope => !SERVICE_SCOPES[service].includes(scope))) throw new ServiceConnectionError('invalid_service_scopes');
  if (new Set(input).size !== input.length) throw new ServiceConnectionError('invalid_service_scopes');
  return [...input].sort();
}
export function parseServiceRepositories(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.length > 200) throw new ServiceConnectionError('invalid_service_repositories');
  const repositories = input.map(value => { const repo = serviceText(value, 200); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..' || part.endsWith('.git'))) throw new ServiceConnectionError('invalid_service_repositories'); return repo.toLowerCase(); });
  if (new Set(repositories).size !== repositories.length) throw new ServiceConnectionError('invalid_service_repositories');
  return repositories.sort();
}
export function parseServiceConnectionConfig(service: ServiceId, input: unknown): ServiceConnectionConfig {
  if (!isServiceId(service) || !serviceRecord(input)) throw new ServiceConnectionError('invalid_service_configuration');
  serviceKeys(input, ['scopes', 'repositories', 'mailboxType', 'email', 'clientId', 'redirectUri', 'issuer']);
  const config: ServiceConnectionConfig = { scopes: parseServiceScopes(service, input.scopes) };
  if (service === 'github') config.repositories = parseServiceRepositories(input.repositories);
  else if (input.repositories !== undefined) throw new ServiceConnectionError('invalid_service_configuration');
  if (service === 'tencent') {
    if (input.mailboxType !== 'qq' && input.mailboxType !== 'exmail') throw new ServiceConnectionError('invalid_mailbox_type');
    config.mailboxType = input.mailboxType;
    config.email = serviceText(input.email, 254).toLowerCase();
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(config.email) || config.email.includes('..')) throw new ServiceConnectionError('invalid_service_email');
    if (input.clientId !== undefined || input.redirectUri !== undefined || input.issuer !== undefined) throw new ServiceConnectionError('invalid_service_configuration');
  } else {
    if (input.mailboxType !== undefined || input.email !== undefined) throw new ServiceConnectionError('invalid_service_configuration');
    if (input.clientId !== undefined) config.clientId = serviceText(input.clientId, 512);
    if (input.redirectUri !== undefined) {
      const uri = serviceText(input.redirectUri, 1000);
      try { const url = new URL(uri); if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error(); }
      catch { throw new ServiceConnectionError('invalid_service_redirect'); }
      config.redirectUri = uri;
    }
    if (input.issuer !== undefined) {
      if (input.issuer !== ({ github: 'github', gmail: 'google', feishu: 'feishu' } as const)[service]) throw new ServiceConnectionError('invalid_service_issuer');
      config.issuer = input.issuer as ServiceConnectionConfig['issuer'];
    }
  }
  return config;
}
export function parseServiceConnectionCredentials(input: unknown): ServiceConnectionCredentials {
  if (!serviceRecord(input)) throw new ServiceConnectionError('invalid_service_credentials');
  serviceKeys(input, ['accessToken', 'refreshToken', 'clientSecret', 'authorizationCode', 'expiresAt', 'oauthClientId', 'oauthState']);
  const result: ServiceConnectionCredentials = {};
  for (const key of ['accessToken', 'refreshToken', 'clientSecret', 'authorizationCode', 'oauthClientId'] as const) if (input[key] !== undefined) result[key] = serviceText(input[key], 16384);
  if (input.oauthState !== undefined) {
    if (typeof input.oauthState !== 'string' || new TextEncoder().encode(input.oauthState).length > 64 * 1024) throw new ServiceConnectionError('invalid_service_credentials');
    try { if (!serviceRecord(JSON.parse(input.oauthState))) throw new Error(); } catch { throw new ServiceConnectionError('invalid_service_credentials'); }
    result.oauthState = input.oauthState;
  }
  if (input.expiresAt !== undefined) { const stamp = serviceText(input.expiresAt, 40); if (!Number.isFinite(Date.parse(stamp))) throw new ServiceConnectionError('invalid_service_credentials'); result.expiresAt = new Date(stamp).toISOString(); }
  return result;
}
export function parseServiceJson(input: unknown, maxBytes = 256 * 1024): { [key: string]: JsonValue } {
  let count = 0;
  const visit = (value: unknown, depth: number): JsonValue => {
    if (++count > 20000 || depth > 20) throw new ServiceConnectionError('service_payload_too_large', 413);
    if (value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= maxBytes || typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value) && value.length <= 10000) return value.map(item => visit(item, depth + 1));
    if (serviceRecord(value)) {
      const output: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key) || /(?:access.?token|refresh.?token|client.?secret|authorization.?code|password)/i.test(key)) throw new ServiceConnectionError('invalid_service_payload'); output[key] = visit(item, depth + 1); }
      return output;
    }
    throw new ServiceConnectionError('invalid_service_payload');
  };
  if (!serviceRecord(input)) throw new ServiceConnectionError('invalid_service_payload');
  const parsed = visit(input, 0) as { [key: string]: JsonValue };
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > maxBytes) throw new ServiceConnectionError('service_payload_too_large', 413);
  return parsed;
}
export function parseServiceTools(service: ServiceId, input: unknown): ServiceTool[] {
  if (!Array.isArray(input) || input.length > 250) throw new ServiceConnectionError('invalid_service_tools');
  const result = input.map(value => {
    if (!serviceRecord(value)) throw new ServiceConnectionError('invalid_service_tools');
    serviceKeys(value, ['name', 'semanticName', 'metadataFingerprint', 'inputSchema', 'scope', 'action', 'write', 'requiresConfirmation']);
    const name = serviceText(value.name, 200), semanticName = serviceText(value.semanticName, 200);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(name) || !/^[a-zA-Z0-9_.:-]+$/.test(semanticName) || !SERVICE_SCOPES[service].includes(value.scope as ServiceScope) || !SERVICE_SCOPES[service].includes(value.action as ServiceScope) || value.action !== value.scope || typeof value.write !== 'boolean' || value.write !== (value.scope !== 'read') || typeof value.requiresConfirmation !== 'boolean') throw new ServiceConnectionError('invalid_service_tools');
    if (value.metadataFingerprint !== undefined && (typeof value.metadataFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(value.metadataFingerprint))) throw new ServiceConnectionError('invalid_service_tools');
    return { name, semanticName, ...(value.metadataFingerprint === undefined ? {} : { metadataFingerprint: (value.metadataFingerprint as string).toLowerCase() }), inputSchema: parseServiceJson(value.inputSchema, 64 * 1024), scope: value.scope as ServiceScope, action: value.action as ServiceScope, write: value.write, requiresConfirmation: value.requiresConfirmation };
  });
  if (new Set(result.map(tool => tool.name)).size !== result.length) throw new ServiceConnectionError('invalid_service_tools');
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (serviceRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
export function servicePolicyFingerprint(value: Pick<TaskServiceBinding, 'service' | 'connectionId' | 'accountId' | 'revision' | 'scopes' | 'repositories' | 'mailboxType' | 'tenantId' | 'appId' | 'tools'>): string {
  return JSON.stringify(canonical({ service: value.service, connectionId: value.connectionId, accountId: value.accountId, revision: value.revision, scopes: [...value.scopes].sort(), repositories: value.repositories ? [...value.repositories].sort() : undefined, mailboxType: value.mailboxType, tenantId: value.tenantId, appId: value.appId, tools: [...value.tools].sort((a, b) => a.name.localeCompare(b.name)) }));
}
export function validateTaskServiceBindings(input: unknown): TaskServiceBindings {
  if (input === undefined) return {};
  if (!serviceRecord(input)) throw new ServiceConnectionError('invalid_service_binding');
  serviceKeys(input, SERVICE_IDS);
  const result: TaskServiceBindings = {};
  for (const [service, raw] of Object.entries(input)) {
    if (!isServiceId(service) || !serviceRecord(raw)) throw new ServiceConnectionError('invalid_service_binding');
    serviceKeys(raw, ['service', 'connectionId', 'accountId', 'accountLabel', 'revision', 'scopes', 'repositories', 'mailboxType', 'tenantId', 'appId', 'tools']);
    if (raw.service !== service || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1) throw new ServiceConnectionError('invalid_service_binding');
    const binding: TaskServiceBinding = { service, connectionId: serviceText(raw.connectionId, 100), accountId: serviceText(raw.accountId, 500), accountLabel: serviceText(raw.accountLabel, 500), revision: Number(raw.revision), scopes: parseServiceScopes(service, raw.scopes), tools: parseServiceTools(service, raw.tools) };
    if (service === 'github') Object.assign(binding, { repositories: parseServiceRepositories(raw.repositories) });
    else if (raw.repositories !== undefined) throw new ServiceConnectionError('invalid_service_binding');
    if (service === 'tencent') { if (raw.mailboxType !== 'qq' && raw.mailboxType !== 'exmail') throw new ServiceConnectionError('invalid_service_binding'); Object.assign(binding, { mailboxType: raw.mailboxType }); }
    else if (raw.mailboxType !== undefined) throw new ServiceConnectionError('invalid_service_binding');
    if (service === 'feishu') { Object.assign(binding, { tenantId: serviceText(raw.tenantId, 500), appId: serviceText(raw.appId, 500) }); }
    else if (raw.tenantId !== undefined || raw.appId !== undefined) throw new ServiceConnectionError('invalid_service_binding');
    if (binding.tools.some(tool => !binding.scopes.includes(tool.scope))) throw new ServiceConnectionError('invalid_service_binding');
    result[service] = binding;
  }
  return result;
}
export function checkServiceBinding(connection: ServiceConnection | null | undefined, input: TaskServiceBinding): ServiceBindingCheck {
  const binding = validateTaskServiceBindings({ [input.service]: input })[input.service]!;
  if (!connection || connection.status === 'disconnected' || connection.status === 'disconnecting') return { available: false, reason: 'disconnected' };
  if (connection.status !== 'verified') return { available: false, reason: 'unverified' };
  if (binding.service !== connection.service || binding.connectionId !== connection.connectionId || binding.accountId !== connection.accountId || binding.revision !== connection.revision || binding.mailboxType !== connection.mailboxType || binding.tenantId !== connection.tenantId || binding.appId !== connection.appId) return { available: false, reason: 'binding_changed' };
  if (binding.scopes.some(scope => !connection.scopes.includes(scope)) || binding.repositories?.some(repo => !connection.repositories?.includes(repo)) || binding.tools.some(tool => !connection.tools.some(current => current.name === tool.name && JSON.stringify(canonical(current)) === JSON.stringify(canonical(tool))))) return { available: false, reason: 'scope_missing' };
  return { available: true, connection: structuredClone(connection), binding: structuredClone(binding) };
}

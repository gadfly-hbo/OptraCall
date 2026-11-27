import { createHash } from 'node:crypto';
import { McpClient, StreamableHttpTransport, type AuthProvider, type PiMcpTool, type McpTransport } from '../agent/sdk.ts';
import { SERVICE_URLS, ServiceConnectionError, parseServiceJson, serviceRecord, type ServiceConnection, type ServiceConnectionCredentials, type ServiceConnectionVerification, type ServiceScope, type ServiceTool, type JsonValue } from './service-connection-types.ts';
import { ServiceOAuthManager } from './service-connection-oauth.ts';
import { GoogleMcpTransportError, createGoogleMcpTransport, type GoogleElicitationRequest, type GoogleElicitationResponse, validateServiceElicitationSchema, validateServiceElicitationResponse } from './service-connection-google-transport.ts';

export type RemoteServiceContext = { signal?: AbortSignal; isCurrent?: () => boolean; registerCleanup?: (cleanup: (options: { retryFailed?: boolean }) => Promise<void>) => void };
export type RemoteServiceInvoke = RemoteServiceContext & {
  connection: ServiceConnection;
  credentials: ServiceConnectionCredentials;
  toolName: string;
  arguments: Record<string, JsonValue>;
  elicit?: (request: GoogleElicitationRequest, signal: AbortSignal) => Promise<GoogleElicitationResponse>;
};
export type RemoteServiceBackendOptions = { oauth?: ServiceOAuthManager; fetch?: typeof fetch; timeoutMs?: number; maxResponseBytes?: number };
export class ServiceRemoteError extends ServiceConnectionError {
  readonly unknownOutcome: boolean;
  constructor(code: string, unknownOutcome = false, status = 502) { super(code, status); this.name = 'ServiceRemoteError'; this.unknownOutcome = unknownOutcome; }
}
type RemoteService = keyof typeof SERVICE_URLS;
type ToolPolicy = { scope: ServiceScope; confirm?: boolean };
const versionFields = ['expected_version', 'expectedVersion', 'expected_revision', 'expectedRevision', 'expected_revision_id', 'expectedRevisionId'] as const;
const feishuEdits = new Set(['update-doc', 'update_doc', 'update_document', 'docx_v1_document_block_batchUpdate']);
function documentVersionFields(schema: unknown): string[] { if (!serviceRecord(schema) || !serviceRecord(schema.properties)) return []; return versionFields.filter(field => { const property = (schema.properties as Record<string, unknown>)[field]; return serviceRecord(property) && ['string', 'integer', 'number'].includes(String(property.type)); }); }
const read = { scope: 'read' } as const, collaborate = { scope: 'collaborate' } as const, manage = { scope: 'manage' } as const;
/** Exact catalog names. New server tools never acquire permission by matching a verb or description. */
export const REMOTE_SERVICE_TOOL_POLICY: Readonly<Record<RemoteService, Readonly<Record<string, ToolPolicy>>>> = Object.freeze({
  github: Object.freeze({
    get_file_contents: read, get_repository_tree: read, list_branches: read, list_tags: read, get_tag: read,
    get_commit: read, list_commits: read, list_issues: read, issue_read: read, search_issues: read,
    list_pull_requests: read, pull_request_read: read, search_pull_requests: read, search_code: read,
    get_workflow: read, list_workflows: read, list_workflow_runs: read, list_workflow_jobs: read,
    get_workflow_run: read, get_workflow_run_logs: read, get_job_logs: read, get_workflow_run_usage: read,
    issue_write: collaborate, add_issue_comment: collaborate, create_pull_request: collaborate,
    update_pull_request: collaborate, pull_request_review_write: collaborate, add_comment_to_pending_review: collaborate,
    create_pending_pull_request_review: collaborate, submit_pending_pull_request_review: collaborate,
    delete_pending_pull_request_review: collaborate, add_reply_to_pull_request_comment: collaborate,
    merge_pull_request: { scope: 'merge' as const, confirm: true },
  }),
  gmail: Object.freeze({
    get_message: read, get_thread: read, get_draft: read, list_drafts: read, list_labels: read, search_threads: read,
    create_draft: manage, update_draft: manage, create_label: manage, update_label: manage,
    label_message: manage, label_thread: manage, update_message_labels: manage,
    unlabel_message: manage, unlabel_thread: manage,
    send_message: { scope: 'send' as const, confirm: true }, reply: { scope: 'send' as const, confirm: true },
    forward: { scope: 'send' as const, confirm: true },
  }),
  feishu: Object.freeze({
    search: read, fetch: read, search_documents: read, fetch_document: read, get_document: read,
    search_messages: read, get_message: read, list_messages: read, search_users: read, search_chats: read,
    'search-doc': read, 'fetch-doc': read, 'search-user': read, 'search-chat': read, 'get-message': read,
    'list-message': read, docx_v1_document_get: read, docx_v1_document_rawContent: read,
    drive_v1_file_search: read, im_v1_message_get: read, im_v1_message_list: read,
    create_document: { scope: 'write' as const }, create_doc: { scope: 'write' as const }, 'create-doc': { scope: 'write' as const },
    docx_v1_document_create: { scope: 'write' as const }, update_document: { scope: 'write' as const, confirm: true },
    update_doc: { scope: 'write' as const, confirm: true }, 'update-doc': { scope: 'write' as const, confirm: true },
    docx_v1_document_block_batchUpdate: { scope: 'write' as const, confirm: true },
    send_message: { scope: 'message' as const, confirm: true }, 'send-message': { scope: 'message' as const, confirm: true },
    im_v1_message_create: { scope: 'message' as const, confirm: true },
  }),
});
function remoteService(service: ServiceConnection['service']): RemoteService {
  if (service !== 'github' && service !== 'gmail' && service !== 'feishu') throw new ServiceConnectionError('unsupported_service');
  return service;
}
function current(context: RemoteServiceContext): void { context.signal?.throwIfAborted(); if (context.isCurrent && !context.isCurrent()) throw new ServiceConnectionError('service_binding_changed', 409); }
function secretValues(credentials: ServiceConnectionCredentials, token?: string): string[] {
  const values = [token, credentials.accessToken, credentials.refreshToken, credentials.clientSecret, credentials.authorizationCode, credentials.oauthState];
  const visit = (value: unknown, depth: number) => { if (depth > 12 || !serviceRecord(value)) return; for (const [key, item] of Object.entries(value)) { if (/^(?:access|refresh|key|access_token|refresh_token|client_secret|id_token)$/.test(key) && typeof item === 'string') values.push(item); else visit(item, depth + 1); } };
  if (credentials.oauthState) { try { visit(JSON.parse(credentials.oauthState), 0); } catch { /* Never display malformed private credential data. */ } }
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0).sort((a, b) => b.length - a.length);
}
function scrub<T>(value: T, secrets: readonly string[]): T {
  const visit = (input: unknown, depth = 0): unknown => {
    if (depth > 50) throw new ServiceRemoteError('service_response_invalid');
    if (typeof input === 'string') { let output = input; for (const secret of secrets) output = output.replaceAll(secret, '[redacted]'); return output; }
    if (Array.isArray(input)) return input.map(item => visit(item, depth + 1));
    if (serviceRecord(input)) return Object.fromEntries(Object.entries(input).filter(([key]) => !/(?:access.?token|refresh.?token|client.?secret|authorization.?code|password)/i.test(key)).map(([key, item]) => [key, visit(item, depth + 1)]));
    return input;
  };
  return visit(value) as T;
}
function canonical(value: unknown): string { const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : serviceRecord(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item; return JSON.stringify(sort(value)); }
export function catalogServiceTools(connection: Pick<ServiceConnection, 'service' | 'scopes'>, catalog: readonly PiMcpTool[]): ServiceTool[] {
  const service = remoteService(connection.service), policy = REMOTE_SERVICE_TOOL_POLICY[service];
  if (catalog.length > 1000) throw new ServiceRemoteError('service_catalog_too_large');
  const names = new Set<string>(), selected: ServiceTool[] = [];
  for (const tool of catalog) {
    if (typeof tool.name !== 'string' || names.has(tool.name)) throw new ServiceRemoteError('service_catalog_invalid');
    names.add(tool.name);
    const allowed = Object.hasOwn(policy, tool.name) ? policy[tool.name] : undefined;
    if (!allowed || !connection.scopes.includes(allowed.scope)) continue;
    // Existing-document edits require a provider-enforced expected-version input.
    if (service === 'feishu' && feishuEdits.has(tool.name) && !documentVersionFields(tool.inputSchema).length) continue;
    const inputSchema = parseServiceJson(tool.inputSchema, 64 * 1024);
    if (service === 'github' && tool.name === 'merge_pull_request') {
      if (!serviceRecord(inputSchema.properties) || !serviceRecord(inputSchema.properties.sha) || inputSchema.properties.sha.type !== 'string' || !serviceRecord(inputSchema.properties.merge_method) || inputSchema.properties.merge_method.type !== 'string') continue;
      inputSchema.properties.sha = { ...inputSchema.properties.sha, pattern: '^[0-9a-fA-F]{40}$', minLength: 40, maxLength: 40 };
      inputSchema.properties.merge_method = { ...inputSchema.properties.merge_method, enum: ['merge', 'squash', 'rebase'] };
      inputSchema.required = [...new Set([...(Array.isArray(inputSchema.required) ? inputSchema.required.filter((field): field is string => typeof field === 'string') : []), 'sha', 'merge_method'])];
    }
    selected.push({ name: tool.name, semanticName: tool.name, inputSchema, metadataFingerprint: createHash('sha256').update(canonical(tool)).digest('hex'), scope: allowed.scope, action: allowed.scope, write: allowed.scope !== 'read', requiresConfirmation: allowed.confirm === true });
  }
  if (selected.length > 250) throw new ServiceRemoteError('service_catalog_too_large');
  return selected.sort((a, b) => a.name.localeCompare(b.name));
}
export function enforceGithubRepository(connection: Pick<ServiceConnection, 'repositories'>, toolName: string, args: Record<string, unknown>): void {
  const allowed = new Set(connection.repositories?.map(repo => repo.toLowerCase()) ?? []);
  if (!allowed.size) throw new ServiceConnectionError('service_repository_required', 403);
  if (['search_issues', 'search_pull_requests', 'search_code'].includes(toolName)) {
    const query = args.query;
    if (typeof query !== 'string' || query.length > 16000 || /[()\\]/.test(query) || /\b(?:OR|NOT)\b/i.test(query) || /(?:^|\s)(?:user|org|enterprise):/i.test(query)) throw new ServiceConnectionError('service_repository_outside_scope', 403);
    const tokens = query.split(/\s+/);
    if (tokens.some(token => /repo:/i.test(token) && !/^repo:/i.test(token))) throw new ServiceConnectionError('service_repository_outside_scope', 403);
    const filters = tokens.filter(token => /^repo:/i.test(token));
    if (!filters.length || filters.some(token => !/^repo:[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_.-]+$/.test(token) || !allowed.has(token.slice(5).toLowerCase()))) throw new ServiceConnectionError('service_repository_outside_scope', 403);
    return;
  }
  if (typeof args.owner !== 'string' || typeof args.repo !== 'string' || !allowed.has(`${args.owner}/${args.repo}`.toLowerCase())) throw new ServiceConnectionError('service_repository_outside_scope', 403);
}
async function boundedJson(response: Response, max = 1024 * 1024): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw new ServiceRemoteError('service_response_invalid');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > max) throw new ServiceRemoteError('service_response_too_large'); chunks.push(item.value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const body = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); if (!serviceRecord(parsed)) throw new Error(); return parsed; } catch { throw new ServiceRemoteError('service_response_invalid'); }
}
function safeRemoteError(error: unknown, context: RemoteServiceContext, uncertain = false): ServiceConnectionError {
  if (error instanceof ServiceRemoteError) return error;
  if (error instanceof ServiceConnectionError) return new ServiceRemoteError(error.code, uncertain && !['service_oauth_expired', 'service_oauth_required', 'service_scope_missing'].includes(error.code), error.status);
  if (context.signal?.aborted) return new ServiceRemoteError('service_call_cancelled', uncertain, 409);
  if (context.isCurrent && !context.isCurrent()) return new ServiceRemoteError('service_binding_changed', uncertain, 409);
  if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)) return new ServiceRemoteError(error.status === 401 ? 'service_oauth_expired' : 'service_scope_missing', false, Number(error.status));
  if (error instanceof GoogleMcpTransportError) return new ServiceRemoteError(error.code, uncertain && error.unknownOutcome);
  return new ServiceRemoteError('service_remote_failed', uncertain);
}
/** Host-owned native Pi MCP clients. Tokens never cross the worker bridge. */
export class RemoteServiceBackend {
  private readonly options: RemoteServiceBackendOptions;
  private readonly active = new Map<string, Set<(options?: { retryFailed?: boolean }) => Promise<void>>>();
  constructor(options: RemoteServiceBackendOptions = {}) { this.options = options; }
  private async token(connection: ServiceConnection, credentials: ServiceConnectionCredentials, context: RemoteServiceContext): Promise<string> {
    current(context);
    if (this.options.oauth && (credentials.oauthState || credentials.refreshToken)) return this.options.oauth.token(connection, credentials, context.signal);
    if (!credentials.accessToken) throw new ServiceConnectionError('service_oauth_required', 401);
    if (credentials.expiresAt && Date.parse(credentials.expiresAt) <= Date.now()) throw new ServiceConnectionError('service_oauth_expired', 401);
    return credentials.accessToken;
  }
  private async withClient<T>(connection: ServiceConnection, credentials: ServiceConnectionCredentials, context: RemoteServiceContext, use: (client: McpClient, token: string, beginCall: () => void, secrets: () => readonly string[]) => Promise<T>, elicit?: RemoteServiceInvoke['elicit']): Promise<T> {
    const service = remoteService(connection.service), token = await this.token(connection, credentials, context);
    const local = new AbortController(), signal = AbortSignal.any([local.signal, ...(context.signal ? [context.signal] : []), AbortSignal.timeout(this.options.timeoutMs ?? 5 * 60 * 1000)]);
    const bound = { signal, isCurrent: context.isCurrent };
    let latestToken = token; const observed = new Set(secretValues(credentials, token));
    const redaction = () => [...new Set([...observed, ...this.options.oauth?.redactionValues(connection) ?? []])].sort((a, b) => b.length - a.length);
    const authProvider: AuthProvider = {
      token: async () => { current(bound); latestToken = await this.token(connection, credentials, bound); observed.add(latestToken); current(bound); return latestToken; },
      onUnauthorized: async info => {
        current(bound);
        if (!this.options.oauth || !(credentials.oauthState || credentials.refreshToken)) throw new ServiceConnectionError('service_oauth_expired', 401);
        await this.options.oauth.refresh(connection, credentials, info.token, signal); current(bound);
      },
    };
    const endpoint = SERVICE_URLS[service];
    let sessionId: string | undefined, cleanupFailed = false, startedClose: Promise<void> | undefined, calling = false;
    const cleanupDelete = async (init: RequestInit): Promise<Response> => {
      try {
        const response = await (this.options.fetch ?? fetch)(endpoint, { ...init, redirect: 'error', signal: AbortSignal.timeout(3000) });
        if (![200, 202, 204, 404, 410].includes(response.status)) { await response.body?.cancel(); throw new ServiceRemoteError('service_close_failed'); }
        cleanupFailed = false; return response;
      } catch { cleanupFailed = true; throw new ServiceRemoteError('service_close_failed'); }
    };
    const nativeFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      if (url.href !== endpoint || url.username || url.password) throw new ServiceConnectionError('untrusted_service_endpoint', 403);
      // Retiring a real session remains allowed after dispatch was revoked; it uses the last token.
      if (init?.method === 'DELETE') return cleanupDelete(init);
      current(bound);
      const response = await (this.options.fetch ?? fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
      sessionId = response.headers.get('mcp-session-id') ?? sessionId;
      if (!response.body) return response;
      let bytes = 0; const limit = this.options.maxResponseBytes ?? 8 * 1024 * 1024;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > limit) { controller.error(new ServiceRemoteError('service_response_too_large')); return; } controller.enqueue(chunk); } }));
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    const transport: McpTransport = service === 'gmail' ? createGoogleMcpTransport({ authProvider, fetch: nativeFetch, elicit, isCurrent: context.isCurrent, timeoutMs: this.options.timeoutMs, maxResponseBytes: this.options.maxResponseBytes }) : new StreamableHttpTransport({ url: endpoint, authProvider, fetch: nativeFetch, maxMessageBytes: this.options.maxResponseBytes ?? 8 * 1024 * 1024, openGetStream: false, reconnect: { maxRetries: 0 } });
    const client = new McpClient({ name: 'OptraCall', version: '0.1.0', requestTimeoutMs: this.options.timeoutMs ?? 5 * 60 * 1000, capabilities: { elicitation: { form: {} } } });
    const instances = this.active.get(connection.connectionId) ?? new Set<(options?: { retryFailed?: boolean }) => Promise<void>>();
    const retire = async (options: { retryFailed?: boolean } = {}): Promise<void> => {
      if (options.retryFailed && cleanupFailed && sessionId) {
        cleanupFailed = false;
        startedClose = (async () => { const response = await cleanupDelete({ method: 'DELETE', headers: { Authorization: `Bearer ${latestToken}`, 'Mcp-Session-Id': sessionId!, 'MCP-Protocol-Version': client.protocolVersion ?? '2025-11-25' } }); await response.body?.cancel(); })();
      }
      startedClose ??= (async () => { await client.close(); if (cleanupFailed) throw new ServiceRemoteError('service_close_failed'); })();
      await startedClose;
      local.abort(); instances.delete(retire); if (!instances.size) this.active.delete(connection.connectionId);
    };
    instances.add(retire); this.active.set(connection.connectionId, instances); context.registerCleanup?.(retire);
    const abort = () => { void retire().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    client.setRequestHandler('elicitation/create', async (params, requestContext) => {
      const invocation = context as Partial<RemoteServiceInvoke>;
      if (!calling || !elicit || !invocation.toolName || !invocation.arguments || !serviceRecord(params) || params.mode !== undefined && params.mode !== 'form' || typeof params.message !== 'string' || params.message.length > 16000) throw new ServiceConnectionError('service_form_unsupported', 409);
      const schema = validateServiceElicitationSchema(params.requestedSchema);
      current(bound); const formSignal = AbortSignal.any([signal, requestContext.signal]);
      const decision = await elicit({ key: 'elicitation', toolName: invocation.toolName, arguments: structuredClone(invocation.arguments), message: params.message, requestedSchema: structuredClone(schema) }, formSignal);
      current(bound); formSignal.throwIfAborted(); return validateServiceElicitationResponse(decision, schema);
    });
    try { current(bound); await client.connect(transport); current(bound); return await use(client, latestToken, () => { calling = true; }, redaction); }
    finally { signal.removeEventListener('abort', abort); try { await retire(); } catch (error) { if (!context.registerCleanup) throw error; /* The original lifecycle cleanup retains this exact failure; preserve the known business receipt. */ } }
  }
  private async identity(connection: ServiceConnection, credentials: ServiceConnectionCredentials, token: string, context: RemoteServiceContext): Promise<Pick<ServiceConnectionVerification, 'accountId' | 'accountLabel' | 'tenantId' | 'appId'>> {
    const service = remoteService(connection.service);
    const get = async (url: string): Promise<Record<string, unknown>> => {
      current(context); const response = await (this.options.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(service === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'OptraCall' } : {}) }, redirect: 'error', signal: AbortSignal.any([...(context.signal ? [context.signal] : []), AbortSignal.timeout(30000)]) });
      if (!response.ok) { await response.body?.cancel(); throw new ServiceRemoteError(response.status === 401 ? 'service_oauth_expired' : response.status === 403 ? 'service_scope_missing' : 'service_identity_unavailable', false, response.status === 401 || response.status === 403 ? response.status : 502); }
      const result = await boundedJson(response); current(context); return result;
    };
    if (service === 'github') {
      const user = await get('https://api.github.com/user');
      if ((!Number.isSafeInteger(user.id) && typeof user.id !== 'string') || typeof user.login !== 'string' || !user.login || String(user.id).length > 100) throw new ServiceRemoteError('service_identity_unavailable');
      for (const repository of connection.repositories ?? []) { const [owner, repo] = repository.split('/'); const actual = await get(`https://api.github.com/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}`); if (typeof actual.full_name !== 'string' || actual.full_name.toLowerCase() !== repository.toLowerCase()) throw new ServiceRemoteError('service_repository_unavailable'); }
      return { accountId: String(user.id), accountLabel: user.login };
    }
    if (service === 'gmail') {
      const user = await get('https://openidconnect.googleapis.com/v1/userinfo');
      if (typeof user.sub !== 'string' || !user.sub || user.sub.length > 255 || typeof user.email !== 'string' || user.email_verified !== true || user.email.length > 254) throw new ServiceRemoteError('service_identity_unavailable');
      return { accountId: user.sub, accountLabel: user.email };
    }
    const result = await get('https://open.feishu.cn/open-apis/authen/v1/user_info');
    const data = result.data;
    if (result.code !== 0 || !serviceRecord(data) || typeof data.tenant_key !== 'string' || !(typeof data.user_id === 'string' || typeof data.open_id === 'string')) throw new ServiceRemoteError('service_user_identity_unavailable');
    let appId: string | undefined;
    if (!appId && credentials.oauthState) { try { const state = JSON.parse(credentials.oauthState) as { mcpClientInformation?: { client_id?: unknown } }; if (typeof state.mcpClientInformation?.client_id === 'string') appId = state.mcpClientInformation.client_id; } catch { /* Never infer identity from a malformed record. */ } }
    if (!appId) throw new ServiceRemoteError('service_app_identity_unavailable');
    return { accountId: String(data.user_id ?? data.open_id), accountLabel: typeof data.name === 'string' ? data.name : String(data.user_id ?? data.open_id), tenantId: data.tenant_key, appId };
  }
  async verify(connection: ServiceConnection, credentials: ServiceConnectionCredentials, context: RemoteServiceContext = {}): Promise<ServiceConnectionVerification> {
    try {
      return await this.withClient(connection, credentials, context, async (client, token, _beginCall, redaction) => {
        const identity = await this.identity(connection, credentials, token, context), rawTools = await client.listTools({ signal: context.signal }); current(context);
        const tools = catalogServiceTools(connection, scrub(rawTools, redaction()));
        if (!tools.some(tool => tool.scope === 'read')) throw new ServiceRemoteError('service_read_tools_unavailable');
        const scopes = connection.scopes.filter(scope => tools.some(tool => tool.scope === scope));
        return { ...identity, scopes, tools, ...(connection.service === 'github' ? { repositories: [...connection.repositories ?? []] } : {}) };
      });
    } catch (error) { throw safeRemoteError(error, context); }
  }

  private async verifyGithubMergeHead(connection: ServiceConnection, credentials: ServiceConnectionCredentials, args: Record<string, JsonValue>, context: RemoteServiceContext): Promise<void> {
    if (typeof args.sha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(args.sha)) throw new ServiceConnectionError('service_merge_head_required', 409);
    if (!['merge', 'squash', 'rebase'].includes(String(args.merge_method))) throw new ServiceConnectionError('service_merge_method_required', 409);
    const number = args.pullNumber ?? args.pull_number;
    if (!Number.isSafeInteger(number) || Number(number) < 1 || args.pullNumber !== undefined && args.pull_number !== undefined && args.pullNumber !== args.pull_number) throw new ServiceConnectionError('service_merge_pull_request_required', 409);
    current(context); const token = await this.token(connection, credentials, context);
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(String(args.owner))}/${encodeURIComponent(String(args.repo))}/pulls/${number}`;
    const response = await (this.options.fetch ?? fetch)(endpoint, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'OptraCall' }, redirect: 'error', signal: AbortSignal.any([...(context.signal ? [context.signal] : []), AbortSignal.timeout(this.options.timeoutMs ?? 30000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new ServiceRemoteError(response.status === 401 ? 'service_oauth_expired' : response.status === 403 ? 'service_scope_missing' : 'service_merge_head_unavailable', false, response.status === 401 || response.status === 403 ? response.status : 502); }
    const result = await boundedJson(response); current(context);
    if (!serviceRecord(result.head) || typeof result.head.sha !== 'string' || result.head.sha.toLowerCase() !== args.sha.toLowerCase()) throw new ServiceConnectionError('service_merge_head_changed', 409);
  }
  async invoke(input: RemoteServiceInvoke): Promise<unknown> {
    const { connection, credentials } = input;
    current(input); const args = parseServiceJson(input.arguments, 4 * 1024 * 1024), frozen = connection.tools.find(tool => tool.name === input.toolName);
    if (!frozen || !connection.scopes.includes(frozen.scope)) throw new ServiceConnectionError('service_tool_not_allowed', 403);
    if (connection.service === 'github') enforceGithubRepository(connection, input.toolName, args);
    if (connection.service === 'feishu' && feishuEdits.has(input.toolName)) {
      const fields = documentVersionFields(frozen.inputSchema);
      if (!fields.some(field => typeof args[field] === 'string' && args[field].length > 0 && args[field].length <= 1000 || typeof args[field] === 'number' && Number.isSafeInteger(args[field]) && args[field] >= 0)) throw new ServiceConnectionError('service_document_version_required', 409);
    }
    if (connection.service === 'github' && input.toolName === 'merge_pull_request' && (typeof args.sha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(args.sha))) throw new ServiceConnectionError('service_merge_head_required', 409);
    if (connection.service === 'github' && input.toolName === 'merge_pull_request' && !['merge', 'squash', 'rebase'].includes(String(args.merge_method))) throw new ServiceConnectionError('service_merge_method_required', 409);
    if (connection.service === 'gmail') {
      const labelFields: Readonly<Record<string, readonly string[]>> = {
        label_message: ['labelIds'], label_thread: ['labelIds'], unlabel_message: ['labelIds'], unlabel_thread: ['labelIds'],
        update_message_labels: ['addLabelIds', 'removeLabelIds'], update_label: ['labelId'],
      };
      const reserved = (value: JsonValue | undefined): boolean => typeof value === 'string' ? /^(?:TRASH|SPAM)$/i.test(value) : Array.isArray(value) && value.some(item => typeof item === 'string' && /^(?:TRASH|SPAM)$/i.test(item));
      if ((labelFields[input.toolName] ?? []).some(field => reserved(args[field]))) throw new ServiceConnectionError('service_scope_missing', 403);
    }
    let submitted = false;
    try {
      return await this.withClient(connection, credentials, input, async (client, _token, beginCall, redaction) => {
        const catalog = catalogServiceTools(connection, scrub(await client.listTools({ signal: input.signal }), redaction()));
        const actual = catalog.find(tool => tool.name === frozen.name);
        if (!actual || canonical(actual) !== canonical(frozen)) throw new ServiceConnectionError('service_tool_schema_changed', 409);
        if (connection.service === 'github' && input.toolName === 'merge_pull_request') await this.verifyGithubMergeHead(connection, credentials, args, input);
        current(input); beginCall(); submitted = true;
        const result = await client.callTool(input.toolName, args, { signal: input.signal, timeoutMs: this.options.timeoutMs ?? 5 * 60 * 1000 });
        current(input); return scrub(result, redaction());
      }, input.elicit);
    } catch (error) { if (error instanceof ServiceRemoteError && error.code === 'service_close_failed' && submitted && frozen.write) throw new ServiceRemoteError(error.code, true, error.status); throw safeRemoteError(error, input, submitted && frozen.write); }
  }
  async close(connectionId: string): Promise<void> { const instances = this.active.get(connectionId); if (!instances) return; const results = await Promise.allSettled([...instances].map(retire => retire({ retryFailed: true }))); if (results.some(result => result.status === 'rejected')) throw new ServiceRemoteError('service_close_failed'); }
}

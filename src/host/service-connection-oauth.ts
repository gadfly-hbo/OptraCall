import { randomBytes } from 'node:crypto';
import { PiMcpOAuthProvider, PiOAuthCallbackServer, authorizePiMcp, PiOAuthIssuerMismatchError, PiOAuthError, type PiMcpOAuthState, type PiMcpOAuthStateStore, type PiAuthorizationServerMetadata, type CreateModelRuntimeOptions } from '../agent/sdk.ts';
import { SERVICE_URLS, ServiceConnectionError, type ServiceConnection, type ServiceConnectionCredentials } from './service-connection-types.ts';

type CredentialStore = NonNullable<CreateModelRuntimeOptions['credentials']>;
type Credential = NonNullable<Awaited<ReturnType<CredentialStore['read']>>>;
type OAuthCredential = Extract<Credential, { type: 'oauth' }>;
export type OAuthConnection = Pick<ServiceConnection, 'connectionId' | 'service' | 'scopes' | 'clientId' | 'redirectUri'>;
export type ServiceOAuthPersistence = {
  /** Private Host storage only. The key includes the preset service and connection identity. */
  read(providerId: string): Promise<ServiceConnectionCredentials | undefined>;
  write(providerId: string, credentials: ServiceConnectionCredentials): Promise<void>;
  remove?(providerId: string): Promise<void>;
  /** Cross-process transaction supplied by the Host private store. */
  modify?<T>(providerId: string, fn: (current: ServiceConnectionCredentials | undefined) => Promise<{ credentials: ServiceConnectionCredentials; result: T }>): Promise<T>;
};
const prefix = 'optracall-service:';
export function serviceOAuthProviderId(connection: Pick<OAuthConnection, 'service' | 'connectionId'>): string {
  if (!['github', 'gmail', 'feishu'].includes(connection.service) || !/^[a-zA-Z0-9_-]{1,100}$/.test(connection.connectionId)) throw new ServiceConnectionError('invalid_service_oauth');
  return `${prefix}${connection.service}:${connection.connectionId}`;
}
export function parseServiceOAuthProviderId(id: string): { service: 'github' | 'gmail' | 'feishu'; connectionId: string } {
  const match = /^optracall-service:(github|gmail|feishu):([a-zA-Z0-9_-]{1,100})$/.exec(id);
  if (!match) throw new ServiceConnectionError('invalid_service_oauth');
  return { service: match[1] as 'github' | 'gmail' | 'feishu', connectionId: match[2]! };
}
function decodeCredential(value: ServiceConnectionCredentials | undefined): Credential | undefined {
  if (!value) return;
  if (value.oauthState) {
    try {
      const state = JSON.parse(value.oauthState) as OAuthCredential;
      if (state.type !== 'oauth' || typeof state.access !== 'string' || !state.access || typeof state.refresh !== 'string' || !Number.isFinite(state.expires) || JSON.stringify(state).length > 65536) throw new Error();
      return state;
    } catch { throw new ServiceConnectionError('invalid_service_oauth_state'); }
  }
  if (value.accessToken) return value.refreshToken ? { type: 'oauth', access: value.accessToken, refresh: value.refreshToken, expires: value.expiresAt ? Date.parse(value.expiresAt) : 0 } : { type: 'api_key', key: value.accessToken };
}
/** Canonical private credential adapter; native OAuth runs inside its atomic modify boundary. */
export function createServiceOAuthCredentialStore(persistence: ServiceOAuthPersistence): CredentialStore {
  const locks = new Map<string, Promise<unknown>>();
  async function locked<T>(id: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    parseServiceOAuthProviderId(id);
    const previous = locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => { signal?.throwIfAborted(); return fn(); });
    locks.set(id, current);
    try { return await current; } finally { if (locks.get(id) === current) locks.delete(id); }
  }
  return {
    read: async (id, options) => { options?.signal?.throwIfAborted(); parseServiceOAuthProviderId(id); return decodeCredential(await persistence.read(id)); },
    list: async () => [],
    modify: (id, fn, options) => locked(id, async () => {
      const update = async (saved: ServiceConnectionCredentials | undefined) => {
        const next = await fn(decodeCredential(saved)); options?.signal?.throwIfAborted();
        const credentials = next?.type === 'oauth' ? { ...saved, accessToken: next.access, refreshToken: next.refresh, expiresAt: new Date(Math.min(next.expires, 8640000000000000)).toISOString(), oauthState: JSON.stringify(next) } : next?.type === 'api_key' && next.key ? { ...saved, accessToken: next.key } : { ...saved };
        return { credentials, result: next ?? decodeCredential(saved) };
      };
      if (persistence.modify) return persistence.modify(id, update);
      const next = await update(await persistence.read(id)); await persistence.write(id, next.credentials); return next.result;
    }, options?.signal),
    delete: (id, options) => locked(id, async () => { if (!persistence.remove) throw new ServiceConnectionError('service_oauth_removal_unavailable'); await persistence.remove(id); }, options?.signal),
  };
}

export type ServiceOAuthAttempt = { attemptId: string; authorizationUrl: string; completion: Promise<void> };
export type ServiceOAuthManagerOptions = { credentials: CredentialStore; fetch?: typeof fetch; authorizationTimeoutMs?: number; networkTimeoutMs?: number };
const TRUSTED_FEISHU_ORIGINS = new Set(['https://mcp.feishu.cn', 'https://open.feishu.cn', 'https://accounts.feishu.cn', 'https://passport.feishu.cn']);
export function serviceOAuthScopes(connection: OAuthConnection): string[] {
  if (connection.service === 'github') return ['read:user', 'repo'];
  if (connection.service === 'gmail') return ['openid', 'email', ...(connection.scopes.includes('manage') ? ['https://www.googleapis.com/auth/gmail.modify'] : ['https://www.googleapis.com/auth/gmail.readonly']), ...(connection.scopes.includes('send') ? ['https://www.googleapis.com/auth/gmail.send'] : [])];
  return [];
}
function safeOAuthError(error: unknown, signal?: AbortSignal): ServiceConnectionError {
  if (signal?.aborted) return new ServiceConnectionError('service_oauth_cancelled', 409);
  if (error instanceof ServiceConnectionError) return error;
  if (error instanceof PiOAuthIssuerMismatchError) return new ServiceConnectionError('service_oauth_issuer_mismatch', 502);
  if (error instanceof PiOAuthError && ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(error.code)) return new ServiceConnectionError('service_oauth_expired', 401);
  return new ServiceConnectionError('service_oauth_failed', 502);
}
async function boundedResponse(response: Response, max = 1024 * 1024): Promise<Response> {
  if (!response.body) return response;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; count += next.value.byteLength; if (count > max) throw new ServiceConnectionError('service_oauth_response_too_large', 502); chunks.push(next.value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}
function serverUrl(connection: OAuthConnection): string {
  if (connection.service !== 'github' && connection.service !== 'gmail' && connection.service !== 'feishu') throw new ServiceConnectionError('invalid_service_oauth');
  return SERVICE_URLS[connection.service];
}
/** These services use a registered app rather than MCP authorization-server discovery. */
function fixedMetadata(connection: OAuthConnection): PiAuthorizationServerMetadata | undefined {
  if (connection.service === 'feishu') return;
  return {
    issuer: connection.service === 'gmail' ? 'https://accounts.google.com' : 'https://github.com',
    authorization_endpoint: connection.service === 'gmail' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize',
    token_endpoint: connection.service === 'gmail' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  };
}
function validateRedirect(input?: string): { port: number; path: string; redirectHost: string } {
  if (!input) return { port: 0, path: '/oauth/callback', redirectHost: '127.0.0.1' };
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error();
    const port = url.port ? Number(url.port) : 80;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error();
    return { port, path: url.pathname, redirectHost: url.hostname };
  } catch { throw new ServiceConnectionError('invalid_service_redirect'); }
}
function nativeState(connection: OAuthConnection, secrets: ServiceConnectionCredentials, previous?: OAuthCredential, interactive = false): PiMcpOAuthState {
  const preset = serverUrl(connection);
  const stored = previous?.mcpOAuthState as PiMcpOAuthState | undefined;
  if (stored && stored.serverUrl !== preset) throw new ServiceConnectionError('invalid_service_oauth_state');
  const value: PiMcpOAuthState = stored ? structuredClone(stored) : {
    serverUrl: preset,
    clientInformation: previous?.mcpClientInformation as PiMcpOAuthState['clientInformation'],
    discovery: previous?.mcpDiscovery as PiMcpOAuthState['discovery'],
    ...(previous ? { tokens: { access_token: previous.access, refresh_token: previous.refresh, token_type: 'Bearer', ...(typeof previous.grantedScopes === 'string' ? { scope: previous.grantedScopes } : {}) }, tokensExpireAt: previous.expires } : {}),
  };
  // State/verifier belong to one pending authorization and never survive into another one.
  delete value.oauthState; delete value.codeVerifier;
  if (interactive) { delete value.tokens; delete value.tokensExpireAt; }
  const clientId = secrets.oauthClientId ?? connection.clientId;
  if (clientId) value.clientInformation = { client_id: clientId, ...(secrets.clientSecret ? { client_secret: secrets.clientSecret } : {}) };
  if (connection.service !== 'feishu' && !value.clientInformation?.client_id) throw new ServiceConnectionError('service_oauth_client_required');
  const metadata = fixedMetadata(connection);
  if (metadata) value.discovery = { authorizationServerUrl: metadata.issuer, authorizationServerMetadata: metadata };
  return value;
}
function canonicalCredential(state: PiMcpOAuthState, previous?: OAuthCredential): OAuthCredential {
  const tokens = state.tokens;
  if (!tokens?.access_token || tokens.access_token.length > 16384 || tokens.token_type.toLowerCase() !== 'bearer' || (tokens.refresh_token?.length ?? 0) > 16384 || state.tokensExpireAt !== undefined && (!Number.isFinite(state.tokensExpireAt) || state.tokensExpireAt <= Date.now())) throw new ServiceConnectionError('invalid_service_oauth_response', 502);
  const completed = structuredClone(state); delete completed.oauthState; delete completed.codeVerifier;
  const issuer = state.discovery?.authorizationServerMetadata?.issuer;
  const credential: OAuthCredential = {
    ...previous, type: 'oauth', access: tokens.access_token, refresh: tokens.refresh_token ?? previous?.refresh ?? '', expires: state.tokensExpireAt ?? 8640000000000000,
    grantedScopes: tokens.scope ?? previous?.grantedScopes,
    mcpOAuthState: completed,
    // Existing Host identity lookup and staged records keep these private compatibility projections.
    mcpClientInformation: completed.clientInformation ? { ...completed.clientInformation, ...(issuer ? { issuer } : {}) } : undefined,
    mcpTokens: { ...tokens, ...(issuer ? { issuer } : {}) }, mcpDiscovery: completed.discovery,
  };
  if (JSON.stringify(credential).length > 65536) throw new ServiceConnectionError('invalid_service_oauth_response', 502);
  return credential;
}
function localState(initial: PiMcpOAuthState): { store: PiMcpOAuthStateStore; current(): PiMcpOAuthState } {
  let value = structuredClone(initial);
  return { store: { load: () => structuredClone(value), save: next => { value = structuredClone(next); } }, current: () => structuredClone(value) };
}
/** Settings-only OAuth resource. Pi owns callback/state/PKCE/discovery and token flows. */
export class ServiceOAuthManager {
  private readonly attempts = new Map<string, { connectionId: string; controller: AbortController; close?: () => Promise<void>; completion?: Promise<void> }>();
  private readonly observedSecrets = new Map<string, Set<string>>();
  private readonly options: ServiceOAuthManagerOptions;
  private constructor(options: ServiceOAuthManagerOptions) { this.options = options; }
  static async create(options: ServiceOAuthManagerOptions): Promise<ServiceOAuthManager> { return new ServiceOAuthManager(options); }
  private async request(connection: OAuthConnection, url: string | URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || (connection.service === 'feishu' ? !TRUSTED_FEISHU_ORIGINS.has(parsed.origin) : !['https://github.com', 'https://oauth2.googleapis.com'].includes(parsed.origin))) throw new ServiceConnectionError('untrusted_service_oauth_endpoint', 502);
    const response = await (this.options.fetch ?? fetch)(parsed, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.networkTimeoutMs ?? 30000)]) });
    return boundedResponse(response);
  }
  private provider(connection: OAuthConnection, secrets: ServiceConnectionCredentials, state: ReturnType<typeof localState>, redirectUrl: string, onRedirect: (url: URL) => void | Promise<void>): PiMcpOAuthProvider {
    return new PiMcpOAuthProvider({ serverUrl: serverUrl(connection), redirectUrl,
      clientMetadata: { client_name: 'OptraCall', scope: serviceOAuthScopes(connection).join(' '), token_endpoint_auth_method: secrets.clientSecret ? 'client_secret_post' : 'none' },
      clientId: secrets.oauthClientId ?? connection.clientId, clientSecret: secrets.clientSecret, store: state.store,
      onRedirect: async url => {
        const expected = fixedMetadata(connection);
        if (url.username || url.password || url.protocol !== 'https:' || (expected ? url.origin + url.pathname !== expected.authorization_endpoint : !TRUSTED_FEISHU_ORIGINS.has(url.origin))) throw new ServiceConnectionError('untrusted_service_oauth_endpoint', 502);
        // Google Desktop OAuth requires offline consent in addition to native PKCE.
        if (connection.service === 'gmail') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); }
        await onRedirect(url);
      },
    });
  }
  /** Host-only redaction material, including credentials rotated during an in-flight call. */
  redactionValues(connection: OAuthConnection): readonly string[] { return [...this.observedSecrets.get(serviceOAuthProviderId(connection)) ?? []]; }
  private observe(id: string, credential: Credential | undefined): void {
    const values = this.observedSecrets.get(id) ?? new Set<string>();
    const visit = (value: unknown, key: string, depth: number) => {
      if (depth > 12) return;
      if (typeof value === 'string' && /^(?:access|refresh|key|access_token|refresh_token|id_token|client_secret)$/.test(key) && value) values.add(value);
      else if (value && typeof value === 'object' && !Array.isArray(value)) for (const [name, item] of Object.entries(value)) visit(item, name, depth + 1);
    };
    visit(credential, '', 0); while (values.size > 64) values.delete(values.values().next().value!); this.observedSecrets.set(id, values);
  }
  private async resolveToken(connection: OAuthConnection, secrets: ServiceConnectionCredentials, signal?: AbortSignal, rejectedToken?: string, force = false): Promise<string> {
    signal?.throwIfAborted(); const id = serviceOAuthProviderId(connection);
    const operationSignal = signal ?? new AbortController().signal;
    try {
      // Native provider serializes its own writes, but has no durable atomic modify
      // hook or expiry refresh boundary. Host CredentialStore.modify encloses the
      // entire native flow, so rotating refresh tokens stay atomic across processes.
      const value = await this.options.credentials.modify(id, async credential => {
        operationSignal.throwIfAborted();
        if (credential?.type === 'api_key' && !force && credential.key) return credential;
        if (!credential || credential.type !== 'oauth') throw new ServiceConnectionError('service_oauth_required', 401);
        if (force && rejectedToken && credential.access !== rejectedToken || !force && credential.expires > Date.now()) return credential;
        if (!credential.refresh) throw new ServiceConnectionError('service_oauth_expired', 401);
        const state = localState(nativeState(connection, secrets, credential));
        const provider = this.provider(connection, secrets, state, connection.redirectUri ?? 'http://127.0.0.1/oauth/callback', () => { throw new ServiceConnectionError('service_oauth_expired', 401); });
        const result = await authorizePiMcp(provider, { serverUrl: serverUrl(connection), signal: operationSignal, fetch: (url, init) => this.request(connection, url, init ?? {}, operationSignal) });
        operationSignal.throwIfAborted();
        if (result !== 'AUTHORIZED') throw new ServiceConnectionError('service_oauth_expired', 401);
        return canonicalCredential(state.current(), credential);
      }, { signal });
      signal?.throwIfAborted();
      this.observe(id, value);
      const token = value?.type === 'oauth' ? value.access : value?.type === 'api_key' ? value.key : undefined;
      if (!token) throw new ServiceConnectionError('service_oauth_required', 401);
      return token;
    } catch (error) { throw safeOAuthError(error, signal); }
  }
  async token(connection: OAuthConnection, secrets: ServiceConnectionCredentials, signal?: AbortSignal): Promise<string> { return this.resolveToken(connection, secrets, signal); }
  async refresh(connection: OAuthConnection, secrets: ServiceConnectionCredentials, rejectedToken?: string, signal?: AbortSignal): Promise<void> { await this.resolveToken(connection, secrets, signal, rejectedToken, true); }
  async begin(connection: OAuthConnection, secrets: ServiceConnectionCredentials, options: { signal?: AbortSignal } = {}): Promise<ServiceOAuthAttempt> {
    const providerId = serviceOAuthProviderId(connection);
    for (const [id, attempt] of this.attempts) if (attempt.connectionId === connection.connectionId) this.cancel(id);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(this.options.authorizationTimeoutMs ?? 5 * 60 * 1000)]);
    signal.throwIfAborted();
    const attemptId = randomBytes(24).toString('base64url');
    let resolveReady!: (value: string) => void, rejectReady!: (reason: unknown) => void;
    const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const resource: { connectionId: string; controller: AbortController; close?: () => Promise<void>; completion?: Promise<void> } = { connectionId: connection.connectionId, controller };
    this.attempts.set(attemptId, resource);
    const completion = (async () => {
      const target = validateRedirect(connection.redirectUri);
      const callback = await PiOAuthCallbackServer.listen({ host: '127.0.0.1', ...target, timeoutMs: this.options.authorizationTimeoutMs ?? 5 * 60 * 1000,
        renderPage: page => '<!doctype html><meta charset="utf-8"><title>OptraCall authorization</title><p>' + (page.ok ? 'Authorization received. You may close this window.' : 'Authorization did not complete. You may close this window.') + '</p>',
      });
      let closing: Promise<void> | undefined;
      const close = resource.close = () => closing ??= callback.close();
      const aborted = () => { void close().catch(() => {}); };
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      try {
        signal.throwIfAborted();
        const previous = await this.options.credentials.read(providerId, { signal });
        const state = localState(nativeState(connection, secrets, previous?.type === 'oauth' ? previous : undefined, true));
        let code: ReturnType<PiOAuthCallbackServer['waitForCallback']> | undefined;
        const provider = this.provider(connection, secrets, state, connection.redirectUri ?? callback.redirectUrl, async url => {
          signal.throwIfAborted();
          code = callback.waitForCallback(url.searchParams.get('state')!, target.path);
          void code.catch(() => {});
          resolveReady(url.href);
        });
        const flowOptions = { serverUrl: serverUrl(connection), signal, scope: serviceOAuthScopes(connection).join(' '), skipRefresh: true,
          fetch: (url: string | URL, init?: RequestInit) => this.request(connection, url, init ?? {}, signal) };
        const first = await authorizePiMcp(provider, flowOptions);
        if (first !== 'REDIRECT' || !code) throw new ServiceConnectionError('service_oauth_failed', 502);
        const response = await code.catch(() => { throw new ServiceConnectionError('service_oauth_cancelled', 409); });
        signal.throwIfAborted();
        const result = await authorizePiMcp(provider, { ...flowOptions, authorizationCode: response.code, iss: response.iss });
        signal.throwIfAborted();
        if (result !== 'AUTHORIZED') throw new ServiceConnectionError('service_oauth_failed', 502);
        const credential = canonicalCredential(state.current(), previous?.type === 'oauth' ? previous : undefined);
        await this.options.credentials.modify(providerId, async () => { signal.throwIfAborted(); return credential; }, { signal });
        this.observe(providerId, credential);
      } finally { signal.removeEventListener('abort', aborted); await close(); }
    })().catch(error => { throw safeOAuthError(error, signal); }).finally(() => { this.attempts.delete(attemptId); });
    resource.completion = completion;
    completion.catch(error => rejectReady(error));
    try { return { attemptId, authorizationUrl: await ready, completion }; }
    catch (error) { this.cancel(attemptId); throw safeOAuthError(error, signal); }
  }
  cancel(attemptId: string): boolean { const resource = this.attempts.get(attemptId); if (!resource) return false; resource.controller.abort(); return true; }
  async close(): Promise<void> { const pending = [...this.attempts.values()].flatMap(resource => resource.completion ? [resource.completion] : []); for (const id of this.attempts.keys()) this.cancel(id); await Promise.allSettled(pending); }
  async forget(connection: OAuthConnection, signal?: AbortSignal): Promise<void> { for (const [id, attempt] of this.attempts) if (attempt.connectionId === connection.connectionId) this.cancel(id); await this.options.credentials.delete(serviceOAuthProviderId(connection), { signal }); this.observedSecrets.delete(serviceOAuthProviderId(connection)); }
}

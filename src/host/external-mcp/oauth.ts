import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ExternalMcpOauthError } from './types.ts';
import type {
  ExternalMcpAuthorizationCodeReceipt,
  ExternalMcpClientRegistration,
  ExternalMcpPendingAuthorization,
  ExternalMcpTokenGrant,
  ExternalMcpVerifiedToken,
} from './types.ts';

export { ExternalMcpOauthError };

/**
 * 受保护远端 MCP 的 OAuth 2.1 授权/资源服务器最小实现（Issue #155 E03/S3a）。
 *
 * 边界（spec §7 / integration-research §3）：
 * - 仅接受预注册客户端（本地受信管理面注入登记），不做任意动态注册；
 * - 授权码 + PKCE（仅 S256）；code 一次性，重放检测后撤销该 code 已签发的令牌（RFC 6749 §4.1.2）；
 * - 令牌绑定准确 issuer/resource(audience)/scope/有效期，逐请求校验；其他资源的令牌不透传（audience_mismatch）；
 * - 公共授权请求只产生 pending，绝不凭 URL 参数批准；批准必须经 `authorize()` 的受信管理面令牌（HTTP 层另有 localhost/Origin 守卫）；
 * - 令牌为 HMAC-SHA256 签名（密钥由受信管理面注入）；实际公网部署的密钥/传输治理见模块 README。
 */

export interface ExternalMcpOauthOptions {
  issuer: string;
  resource: string;
  clients: readonly ExternalMcpClientRegistration[];
  signingKey: string;
  managementApprovalToken: string;
  accessTokenTtlSeconds?: number;
  authorizationCodeTtlSeconds?: number;
  pendingAuthorizationTtlSeconds?: number;
  /** epoch 秒；注入用于测试过期/重放等时间语义。 */
  clock?: () => number;
}

export interface ExternalMcpCreateAuthorizationInput {
  clientId: string;
  redirectUri: string;
  responseType?: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource?: string;
  state?: string;
}

export interface ExternalMcpAuthorizeInput {
  pendingId: string;
  approval: { managementToken: string; operatorId?: string };
}

export interface ExternalMcpExchangeInput {
  grantType?: string;
  clientId: string;
  clientSecret?: string;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  resource?: string;
}

export interface ExternalMcpOauth {
  createAuthorizationRequest(input: ExternalMcpCreateAuthorizationInput): Promise<ExternalMcpPendingAuthorization>;
  authorize(input: ExternalMcpAuthorizeInput): Promise<ExternalMcpAuthorizationCodeReceipt>;
  exchangeToken(input: ExternalMcpExchangeInput): Promise<ExternalMcpTokenGrant>;
  verifyAccessToken(token: string): Promise<ExternalMcpVerifiedToken>;
  authorizationServerMetadata(): Record<string, unknown>;
  protectedResourceMetadata(): Record<string, unknown>;
}

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

function fail(code: string, status: number, description: string): never {
  throw new ExternalMcpOauthError(code, status, description);
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = createHash('sha256').update(left).digest();
  const rightBytes = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftBytes, rightBytes);
}

function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

interface PendingRecord {
  pendingId: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  resource: string;
  codeChallenge: string;
  state?: string;
  expiresAt: number;
}

interface CodeRecord {
  clientId: string;
  redirectUri: string;
  scope: string[];
  resource: string;
  codeChallenge: string;
  state?: string;
  expiresAt: number;
  consumed: boolean;
  issuedTokenIds: string[];
}

interface AccessTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  scope: string[];
  iat: number;
  exp: number;
  jti: string;
}

export function createExternalMcpOAuth(options: ExternalMcpOauthOptions): ExternalMcpOauth {
  const accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 3600;
  const authorizationCodeTtlSeconds = options.authorizationCodeTtlSeconds ?? 600;
  const pendingAuthorizationTtlSeconds = options.pendingAuthorizationTtlSeconds ?? 600;
  const now = options.clock ?? (() => Math.floor(Date.now() / 1000));
  const clients = new Map<string, ExternalMcpClientRegistration>(options.clients.map(client => [client.clientId, client]));
  const pendingRequests = new Map<string, PendingRecord>();
  const authorizationCodes = new Map<string, CodeRecord>();
  const revokedTokenIds = new Set<string>();

  function requireClient(clientId: string): ExternalMcpClientRegistration {
    const client = clients.get(clientId);
    if (!client) fail('unregistered_client', 400, `client ${clientId} is not pre-registered`);
    return client;
  }

  function assertClientAuthentication(client: ExternalMcpClientRegistration, clientSecret?: string): void {
    if (client.clientSecret !== undefined) {
      if (!clientSecret || !constantTimeEquals(clientSecret, client.clientSecret)) fail('invalid_client', 401, 'confidential client authentication failed');
      return;
    }
    // 公共客户端（token_endpoint_auth_method=none）不得以 secret 认证。
    if (clientSecret) fail('invalid_client', 401, 'public clients must not authenticate with a client secret');
  }

  async function createAuthorizationRequest(input: ExternalMcpCreateAuthorizationInput): Promise<ExternalMcpPendingAuthorization> {
    const client = requireClient(input.clientId);
    if (!client.redirectUris.includes(input.redirectUri)) fail('redirect_uri_mismatch', 400, 'redirect URI does not exactly match the registered value');
    if ((input.responseType ?? 'code') !== 'code') fail('unsupported_response_type', 400, 'only response_type=code is supported');
    if (!input.codeChallenge) fail('invalid_code_challenge', 400, 'PKCE code_challenge is required');
    if ((input.codeChallengeMethod ?? '') !== 'S256') fail('unsupported_code_challenge_method', 400, 'only PKCE S256 is supported');
    if (input.resource !== undefined && input.resource !== options.resource) fail('resource_mismatch', 400, 'authorization is bound to the configured protected resource');
    const requestedScopes = input.scope === undefined || input.scope === '' ? [...client.scopes] : input.scope.split(' ').filter(Boolean);
    if (requestedScopes.some(scope => !client.scopes.includes(scope))) fail('scope_not_grantable', 400, 'requested scope exceeds the client registration');
    const pendingId = randomBytes(24).toString('base64url');
    const pending: PendingRecord = {
      pendingId,
      clientId: client.clientId,
      redirectUri: input.redirectUri,
      scope: requestedScopes,
      resource: options.resource,
      codeChallenge: input.codeChallenge,
      state: input.state,
      expiresAt: now() + pendingAuthorizationTtlSeconds,
    };
    pendingRequests.set(pendingId, pending);
    return { ...pending };
  }

  async function authorize(input: ExternalMcpAuthorizeInput): Promise<ExternalMcpAuthorizationCodeReceipt> {
    if (!constantTimeEquals(input.approval.managementToken, options.managementApprovalToken)) fail('management_approval_rejected', 403, 'approval requires the trusted management-plane token');
    const pending = pendingRequests.get(input.pendingId);
    if (!pending) fail('unknown_authorization_request', 404, 'no such pending authorization request');
    pendingRequests.delete(input.pendingId);
    if (pending.expiresAt <= now()) fail('authorization_request_expired', 400, 'the pending authorization request expired; restart the flow');
    const code = randomBytes(32).toString('base64url');
    authorizationCodes.set(code, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      resource: pending.resource,
      codeChallenge: pending.codeChallenge,
      state: pending.state,
      expiresAt: now() + authorizationCodeTtlSeconds,
      consumed: false,
      issuedTokenIds: [],
    });
    return { code, redirectUri: pending.redirectUri, scope: pending.scope, state: pending.state, expiresAt: authorizationCodes.get(code)!.expiresAt };
  }

  function signAccessToken(payload: AccessTokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', options.signingKey).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  async function exchangeToken(input: ExternalMcpExchangeInput): Promise<ExternalMcpTokenGrant> {
    if ((input.grantType ?? 'authorization_code') !== 'authorization_code') fail('unsupported_grant_type', 400, 'only authorization_code is supported');
    const client = requireClient(input.clientId);
    if (!input.code) fail('invalid_request', 400, 'authorization code is required');
    const record = authorizationCodes.get(input.code);
    if (!record || record.clientId !== client.clientId) fail('invalid_grant', 400, 'authorization code is invalid');
    assertClientAuthentication(client, input.clientSecret);
    if (record.consumed) {
      // RFC 6749 §4.1.2：重放检测后撤销该 code 已签发的全部令牌。
      for (const tokenId of record.issuedTokenIds) revokedTokenIds.add(tokenId);
      fail('invalid_grant', 400, 'authorization code was already used');
    }
    if (record.expiresAt <= now()) fail('invalid_grant', 400, 'authorization code expired');
    if (input.redirectUri !== record.redirectUri) fail('invalid_grant', 400, 'redirect URI differs from the authorization request');
    if (input.resource !== undefined && input.resource !== record.resource) fail('invalid_grant', 400, 'resource differs from the authorization request');
    if (!input.codeVerifier || !PKCE_VERIFIER_PATTERN.test(input.codeVerifier) || s256Challenge(input.codeVerifier) !== record.codeChallenge) fail('invalid_grant', 400, 'PKCE verification failed');
    record.consumed = true;
    const issuedAt = now();
    const tokenId = randomBytes(16).toString('hex');
    const payload: AccessTokenPayload = {
      iss: options.issuer,
      sub: client.clientId,
      aud: record.resource,
      scope: record.scope,
      iat: issuedAt,
      exp: issuedAt + accessTokenTtlSeconds,
      jti: tokenId,
    };
    record.issuedTokenIds.push(tokenId);
    return { accessToken: signAccessToken(payload), tokenType: 'Bearer', expiresIn: accessTokenTtlSeconds, scope: record.scope };
  }

  async function verifyAccessToken(token: string): Promise<ExternalMcpVerifiedToken> {
    const parts = token.split('.');
    if (parts.length !== 2) fail('invalid_token', 401, 'malformed access token');
    const [encodedPayload, signature] = parts as [string, string];
    const expectedSignature = createHmac('sha256', options.signingKey).update(encodedPayload).digest('base64url');
    const signatureBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expectedSignature, 'base64url');
    if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) fail('invalid_token', 401, 'access token signature verification failed');
    let payload: AccessTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AccessTokenPayload;
    } catch {
      fail('invalid_token', 401, 'access token payload is not decodable');
    }
    if (payload.iss !== options.issuer) fail('issuer_mismatch', 401, 'access token was issued by another authorization server');
    if (payload.aud !== options.resource) fail('audience_mismatch', 401, 'access token is bound to another resource');
    if (typeof payload.exp !== 'number' || payload.exp <= now()) fail('expired_token', 401, 'access token expired');
    if (revokedTokenIds.has(payload.jti)) fail('revoked_token', 401, 'access token was revoked');
    return { tokenId: payload.jti, clientId: payload.sub, principal: payload.sub, scopes: payload.scope, issuer: payload.iss, resource: payload.aud, expiresAt: payload.exp };
  }

  function authorizationServerMetadata(): Record<string, unknown> {
    const scopesSupported = [...new Set(options.clients.flatMap(client => [...client.scopes]))].sort();
    return {
      issuer: options.issuer,
      authorization_endpoint: `${options.issuer}/authorize`,
      token_endpoint: `${options.issuer}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: scopesSupported,
    };
  }

  function protectedResourceMetadata(): Record<string, unknown> {
    const scopesSupported = [...new Set(options.clients.flatMap(client => [...client.scopes]))].sort();
    return {
      resource: options.resource,
      authorization_servers: [options.issuer],
      scopes_supported: scopesSupported,
    };
  }

  return { createAuthorizationRequest, authorize, exchangeToken, verifyAccessToken, authorizationServerMetadata, protectedResourceMetadata };
}

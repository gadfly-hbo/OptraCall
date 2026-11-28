import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createExternalMcpOAuth, ExternalMcpOauthError } from '../src/host/external-mcp/oauth.ts';
import type { ExternalMcpClientRegistration } from '../src/host/external-mcp/types.ts';

// S3a 工程隔离负例：全部合成身份/密钥，仅验证受保护远端 MCP 的 OAuth 2.1 授权/资源服务器行为，
// 不访问真实公网、账号或 WorkBuddy。resource/issuer 均为测试标识，不代表已部署入口。

const ISSUER = 'https://optracall-test.invalid';
const RESOURCE = 'https://optracall-test.invalid/mcp';
const MANAGEMENT_TOKEN = 'synthetic-management-approval-token';
const SIGNING_KEY = 'synthetic-signing-key-material';

const publicClient: ExternalMcpClientRegistration = {
  clientId: 'wb-connector-synthetic',
  redirectUris: ['http://127.0.0.1:8765/callback'],
  scopes: ['mcp', 'work.read'],
};
const confidentialClient: ExternalMcpClientRegistration = {
  clientId: 'confidential-agent-synthetic',
  redirectUris: ['https://partner.example.invalid/callback'],
  scopes: ['mcp'],
  clientSecret: 'synthetic-confidential-secret',
};

const VERIFIER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

function pkcePair(verifier = VERIFIER) {
  return { codeVerifier: verifier, codeChallenge: createHash('sha256').update(verifier).digest('base64url') };
}

function decodeTokenPayload(token: string): Record<string, unknown> {
  const [payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function happyPath(oauth: ReturnType<typeof createExternalMcpOAuth>, client = publicClient, overrides: Record<string, unknown> = {}) {
  const challenge = pkcePair();
  const pending = await oauth.createAuthorizationRequest({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    responseType: 'code',
    codeChallenge: challenge.codeChallenge,
    codeChallengeMethod: 'S256',
    scope: 'mcp',
    ...overrides,
  });
  const receipt = await oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  const grant = await oauth.exchangeToken({
    grantType: 'authorization_code',
    clientId: client.clientId,
    code: receipt.code,
    codeVerifier: challenge.codeVerifier,
    redirectUri: client.redirectUris[0]!,
  });
  return { pending, receipt, grant };
}

async function makeOauth(clockOverrides: Partial<{ now: number }> = {}, extraOptions: Record<string, unknown> = {}) {
  const clockState = { now: 1_800_000_000, ...clockOverrides };
  const oauth = createExternalMcpOAuth({
    issuer: ISSUER,
    resource: RESOURCE,
    clients: [publicClient, confidentialClient],
    signingKey: SIGNING_KEY,
    managementApprovalToken: MANAGEMENT_TOKEN,
    clock: () => clockState.now,
    ...extraOptions,
  });
  return { oauth, clockState };
}

test('token issuance requires management-plane approval, binds exact audience/issuer/scope and verifies', async () => {
  const { oauth } = await makeOauth();
  const { pending, receipt, grant } = await happyPath(oauth);
  assert.equal(pending.pendingId.length > 0, true);
  assert.equal(receipt.redirectUri, publicClient.redirectUris[0]);
  assert.equal(receipt.scope.join(' '), 'mcp');
  assert.equal(grant.tokenType, 'Bearer');
  assert.equal(grant.scope.join(' '), 'mcp');
  const verified = await oauth.verifyAccessToken(grant.accessToken);
  assert.equal(verified.clientId, publicClient.clientId);
  assert.deepEqual(verified.scopes, ['mcp']);
  assert.equal(verified.issuer, ISSUER);
  assert.equal(verified.resource, RESOURCE);
  assert.equal(verified.expiresAt, 1_800_000_000 + 3600);
  const claims = decodeTokenPayload(grant.accessToken);
  assert.equal(claims.iss, ISSUER);
  assert.equal(claims.aud, RESOURCE, 'access token must carry the exact protected resource audience');
  assert.equal(claims.sub, publicClient.clientId);
  assert.equal(typeof claims.exp, 'number');
  assert.equal(typeof claims.jti, 'string');
});

test('unregistered clients and non-exact redirect URIs cannot start authorization', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  await assert.rejects(
    oauth.createAuthorizationRequest({ clientId: 'not-registered', redirectUri: 'http://127.0.0.1:8765/callback', responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' }),
    (error: ExternalMcpOauthError) => error.code === 'unregistered_client',
  );
  for (const redirectUri of ['http://127.0.0.1:8765/callback/extra', 'http://127.0.0.1:8765/callback?x=1', 'http://127.0.0.1:9999/callback', 'https://attacker.example.invalid/callback']) {
    await assert.rejects(
      oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' }),
      (error: ExternalMcpOauthError) => error.code === 'redirect_uri_mismatch',
      `redirect URI ${redirectUri} must be rejected as not exactly registered`,
    );
  }
});

test('authorization requires PKCE S256 and rejects plain or missing challenges', async () => {
  const { oauth } = await makeOauth();
  const base = { clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code' };
  await assert.rejects(
    oauth.createAuthorizationRequest({ ...base, codeChallenge: pkcePair().codeChallenge, codeChallengeMethod: 'plain' }),
    (error: ExternalMcpOauthError) => error.code === 'unsupported_code_challenge_method',
  );
  await assert.rejects(
    oauth.createAuthorizationRequest({ ...base, codeChallenge: pkcePair().codeChallenge, codeChallengeMethod: 'S512' }),
    (error: ExternalMcpOauthError) => error.code === 'unsupported_code_challenge_method',
  );
  await assert.rejects(
    oauth.createAuthorizationRequest({ ...base, codeChallenge: '', codeChallengeMethod: 'S256' }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_code_challenge',
  );
  await assert.rejects(
    oauth.createAuthorizationRequest({ ...base, codeChallenge: undefined, codeChallengeMethod: 'S256' }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_code_challenge',
  );
});

test('cross-resource authorization is rejected; absent resource binds the protected resource', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  await assert.rejects(
    oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256', resource: 'https://githubcopilot.com/mcp' }),
    (error: ExternalMcpOauthError) => error.code === 'resource_mismatch',
    'a request for another resource must never start an authorization here',
  );
  // Absent resource binds the configured protected resource.
  const pending = await oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  const receipt = await oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  const grant = await oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! });
  const verified = await oauth.verifyAccessToken(grant.accessToken);
  assert.equal(verified.resource, RESOURCE);
});

test('scope requests outside the client registration are rejected', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  await assert.rejects(
    oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256', scope: 'mcp asset.read' }),
    (error: ExternalMcpOauthError) => error.code === 'scope_not_grantable',
  );
});

test('approval requires the management token, a live pending request and honors expiry', async () => {
  const { oauth, clockState } = await makeOauth();
  const challenge = pkcePair();
  await assert.rejects(
    oauth.authorize({ pendingId: 'never-created', approval: { managementToken: MANAGEMENT_TOKEN } }),
    (error: ExternalMcpOauthError) => error.code === 'unknown_authorization_request',
  );
  const pending = await oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  await assert.rejects(
    oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: 'wrong-management-token' } }),
    (error: ExternalMcpOauthError) => error.code === 'management_approval_rejected',
    'approval without the exact management token must be rejected',
  );
  await assert.rejects(
    oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: '' } }),
    (error: ExternalMcpOauthError) => error.code === 'management_approval_rejected',
  );
  clockState.now += 601;
  await assert.rejects(
    oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } }),
    (error: ExternalMcpOauthError) => error.code === 'authorization_request_expired',
  );
});

test('public authorization parameters can never approve: fabricated consent flags yield no code', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  // 模拟攻击者在授权 URL 上追加 approve/consent/decision 参数：请求仍只产生 pending，不签发 code。
  const pending = await oauth.createAuthorizationRequest({
    clientId: publicClient.clientId,
    redirectUri: publicClient.redirectUris[0]!,
    responseType: 'code',
    codeChallenge: challenge.codeChallenge,
    codeChallengeMethod: 'S256',
    ...({ approve: 'true', consent: 'yes', decision: 'approve', prompt: 'none' } as unknown as Record<string, never>),
  });
  assert.equal('code' in pending, false, 'a public authorization request must never contain an issued code');
  for (const fabricated of ['fabricated-code', pending.pendingId]) {
    await assert.rejects(
      oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: fabricated, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! }),
      (error: ExternalMcpOauthError) => error.code === 'invalid_grant',
    );
  }
});

test('token exchange rejects wrong verifier, malformed verifier, wrong redirect and bad client auth', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  const pending = await oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  const receipt = await oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: 'b'.repeat(47), redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_grant',
    'PKCE verifier mismatch must reject the exchange',
  );
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: 'short', redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_grant',
    'a verifier outside RFC 7636 length/charset must reject',
  );
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: 'http://127.0.0.1:8765/other' }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_grant',
  );
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: 'not-registered', code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'unregistered_client',
  );
  // The original code remains usable by its legitimate holder after failed attempts.
  const grant = await oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! });
  assert.equal(grant.tokenType, 'Bearer');
});

test('confidential clients must present their secret; public clients must not authenticate by secret', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  const pending = await oauth.createAuthorizationRequest({ clientId: confidentialClient.clientId, redirectUri: confidentialClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  const receipt = await oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  for (const secret of [undefined, 'wrong-secret']) {
    await assert.rejects(
      oauth.exchangeToken({ grantType: 'authorization_code', clientId: confidentialClient.clientId, clientSecret: secret as unknown as string, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: confidentialClient.redirectUris[0]! }),
      (error: ExternalMcpOauthError) => error.code === 'invalid_client',
      `confidential exchange with secret ${String(secret)} must reject`,
    );
  }
  const grant = await oauth.exchangeToken({ grantType: 'authorization_code', clientId: confidentialClient.clientId, clientSecret: 'synthetic-confidential-secret', code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: confidentialClient.redirectUris[0]! });
  assert.equal(grant.tokenType, 'Bearer');

  // 公共客户端不得以 secret 认证（token_endpoint_auth_method=none）。
  const publicPending = await oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  const publicReceipt = await oauth.authorize({ pendingId: publicPending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, clientSecret: 'anything', code: publicReceipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_client',
  );
});

test('revocation on replay is scoped to the replayed code and does not touch unrelated tokens', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  const pending = await oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  const receipt = await oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  const grant = await oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! });
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_grant',
    'a consumed code must never be exchanged again',
  );
  // 一个完全无关的 code 的正常签发不受牵连；而被重放 code 签发的令牌已被撤销。
  const unrelated = await happyPath(oauth);
  await oauth.verifyAccessToken(unrelated.grant.accessToken);
  await assert.rejects(
    oauth.verifyAccessToken(grant.accessToken),
    (error: ExternalMcpOauthError) => error.code === 'revoked_token',
  );
});

test('replay of a consumed code revokes the token issued from that code', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  const pending = await oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  const receipt = await oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  const grant = await oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! });
  await oauth.verifyAccessToken(grant.accessToken);
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_grant',
  );
  await assert.rejects(
    oauth.verifyAccessToken(grant.accessToken),
    (error: ExternalMcpOauthError) => error.code === 'revoked_token',
    'tokens issued from a replayed code must be revoked after replay detection',
  );
});

test('expired codes and expired access tokens are rejected by the injected clock', async () => {
  const { oauth, clockState } = await makeOauth({}, { accessTokenTtlSeconds: 120 });
  const challenge = pkcePair();
  const pending = await oauth.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: challenge.codeChallenge, codeChallengeMethod: 'S256' });
  const receipt = await oauth.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  clockState.now += 601;
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_grant',
    'an expired authorization code must not exchange',
  );
  clockState.now = 1_800_000_000;
  const grant = await happyPath(oauth);
  clockState.now += 121;
  await assert.rejects(
    oauth.verifyAccessToken(grant.grant.accessToken),
    (error: ExternalMcpOauthError) => error.code === 'expired_token',
  );
});

test('tokens for other audiences or issuers cannot pass verification (no passthrough)', async () => {
  const { oauth } = await makeOauth();
  // 同一签名密钥、不同 resource/issuer 的实例：模拟“其他资源签发的令牌被拿到本资源使用”。
  const foreignAudience = createExternalMcpOAuth({
    issuer: ISSUER,
    resource: 'https://other-service.invalid/mcp',
    clients: [publicClient],
    signingKey: SIGNING_KEY,
    managementApprovalToken: MANAGEMENT_TOKEN,
    clock: () => 1_800_000_000,
  });
  const foreignToken = (await happyPath(foreignAudience)).grant.accessToken;
  await assert.rejects(
    oauth.verifyAccessToken(foreignToken),
    (error: ExternalMcpOauthError) => error.code === 'audience_mismatch',
    'a token minted for another resource must be rejected as audience mismatch',
  );
  const foreignIssuer = createExternalMcpOAuth({
    issuer: 'https://someone-else.invalid',
    resource: RESOURCE,
    clients: [publicClient],
    signingKey: SIGNING_KEY,
    managementApprovalToken: MANAGEMENT_TOKEN,
    clock: () => 1_800_000_000,
  });
  const otherIssuerToken = (await happyPath(foreignIssuer)).grant.accessToken;
  await assert.rejects(
    oauth.verifyAccessToken(otherIssuerToken),
    (error: ExternalMcpOauthError) => error.code === 'issuer_mismatch',
  );
});

test('tampered payloads and foreign signing keys are rejected as invalid tokens', async () => {
  const { oauth } = await makeOauth();
  const { grant } = await happyPath(oauth);
  const [payload, signature] = grant.accessToken.split('.');
  const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
  decoded.scope = ['mcp', 'work.read'];
  const escalated = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
  await assert.rejects(
    oauth.verifyAccessToken(escalated),
    (error: ExternalMcpOauthError) => error.code === 'invalid_token',
    'scope escalation must break the signature check',
  );
  const foreignKey = createExternalMcpOAuth({
    issuer: ISSUER,
    resource: RESOURCE,
    clients: [publicClient],
    signingKey: 'a-different-signing-key',
    managementApprovalToken: MANAGEMENT_TOKEN,
    clock: () => 1_800_000_000,
  });
  const foreignToken = (await happyPath(foreignKey)).grant.accessToken;
  await assert.rejects(
    oauth.verifyAccessToken(foreignToken),
    (error: ExternalMcpOauthError) => error.code === 'invalid_token',
  );
  await assert.rejects(oauth.verifyAccessToken('not-a-token'), (error: ExternalMcpOauthError) => error.code === 'invalid_token');
});

test('RFC 9728 protected resource metadata and AS metadata are accurate', () => {
  const oauth = createExternalMcpOAuth({
    issuer: ISSUER,
    resource: RESOURCE,
    clients: [publicClient, confidentialClient],
    signingKey: SIGNING_KEY,
    managementApprovalToken: MANAGEMENT_TOKEN,
    clock: () => 1_800_000_000,
  });
  const resource = oauth.protectedResourceMetadata();
  assert.equal(resource.resource, RESOURCE);
  assert.deepEqual(resource.authorization_servers, [ISSUER]);
  assert.ok(Array.isArray(resource.scopes_supported) && resource.scopes_supported.includes('mcp'));
  const as = oauth.authorizationServerMetadata();
  assert.equal(as.issuer, ISSUER);
  assert.equal(as.authorization_endpoint, `${ISSUER}/authorize`);
  assert.equal(as.token_endpoint, `${ISSUER}/token`);
  assert.deepEqual(as.response_types_supported, ['code']);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal((as.grant_types_supported as string[]).includes('authorization_code'), true);
});

test('unsupported grant types and missing exchange fields are rejected', async () => {
  const { oauth } = await makeOauth();
  const challenge = pkcePair();
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'client_credentials', clientId: publicClient.clientId }),
    (error: ExternalMcpOauthError) => error.code === 'unsupported_grant_type',
  );
  await assert.rejects(
    oauth.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, codeVerifier: challenge.codeVerifier, redirectUri: publicClient.redirectUris[0]! }),
    (error: ExternalMcpOauthError) => error.code === 'invalid_request',
    'missing code must be an invalid_request rather than an invalid_grant',
  );
});

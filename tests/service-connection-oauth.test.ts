import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { ServiceOAuthManager, createServiceOAuthCredentialStore, serviceOAuthProviderId, type OAuthConnection } from '../src/host/service-connection-oauth.ts';
import type { ServiceConnectionCredentials } from '../src/host/service-connection-types.ts';

async function setup(t: import('node:test').TestContext, handler: (url: URL, body: URLSearchParams, data: unknown) => unknown | Promise<unknown>) {
  const traffic: { url: string; body: URLSearchParams; data: unknown }[] = [];
  const server = createServer(async (req, res) => {
    try {
      const buffers: Buffer[] = []; for await (const chunk of req) buffers.push(Buffer.from(chunk));
      const text = Buffer.concat(buffers).toString(), url = new URL(String(req.headers['x-original-url']));
      let data: unknown; try { data = JSON.parse(text); } catch { data = undefined; }
      const body = new URLSearchParams(text); traffic.push({ url: url.href, body, data });
      const value = await handler(url, body, data); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    } catch { res.writeHead(500).end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const state = new Map<string, ServiceConnectionCredentials>();
  const credentials = createServiceOAuthCredentialStore({ read: async id => structuredClone(state.get(id)), write: async (id, value) => { state.set(id, structuredClone(value)); }, remove: async id => { state.delete(id); } });
  const manager = await ServiceOAuthManager.create({ credentials, authorizationTimeoutMs: 3000, fetch: async (input, init) => fetch(`http://127.0.0.1:${address.port}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-original-url': String(input) } }) });
  t.after(() => manager.close());
  return { manager, state, traffic };
}
const gmail: OAuthConnection = { connectionId: 'oauth-test-gmail', service: 'gmail', scopes: ['read', 'send'], clientId: 'desktop.apps.example.invalid' };

test('settings OAuth uses real loopback state+PKCE, persists only private native credential, and resolves without a model/task', async t => {
  const harness = await setup(t, () => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send' }));
  const attempt = await harness.manager.begin(gmail, { clientSecret: 'synthetic-client-secret' });
  const authorization = new URL(attempt.authorizationUrl), redirect = new URL(authorization.searchParams.get('redirect_uri')!);
  assert.equal(authorization.origin, 'https://accounts.google.com'); assert.equal(authorization.pathname, '/o/oauth2/v2/auth');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(JSON.stringify(attempt).includes('synthetic-client-secret'), false);
  redirect.searchParams.set('state', 'forged-state'); redirect.searchParams.set('code', 'forged'); assert.equal((await fetch(redirect)).status, 400);
  redirect.searchParams.set('state', 'é'.repeat(authorization.searchParams.get('state')!.length));
  assert.equal((await fetch(redirect)).status, 400, 'Unicode state with matching character count cannot crash the callback host');
  assert.equal(harness.traffic.length, 0);
  redirect.searchParams.set('state', authorization.searchParams.get('state')!); redirect.searchParams.set('code', 'synthetic-code');
  assert.equal((await fetch(redirect)).status, 200); await attempt.completion;
  const exchange = harness.traffic[0]!; assert.equal(exchange.url, 'https://oauth2.googleapis.com/token');
  assert.equal(exchange.body.get('code'), 'synthetic-code'); assert.equal(exchange.body.get('client_secret'), 'synthetic-client-secret');
  assert.equal(createHash('sha256').update(exchange.body.get('code_verifier')!).digest('base64url'), authorization.searchParams.get('code_challenge'));
  assert.equal(await harness.manager.token(gmail, harness.state.get(serviceOAuthProviderId(gmail))!), 'synthetic-access');
  const saved = JSON.parse(harness.state.get(serviceOAuthProviderId(gmail))!.oauthState!); assert.equal(saved.type, 'oauth'); assert.equal(saved.refresh, 'synthetic-refresh');
  assert.equal(saved.mcpOAuthState.serverUrl, 'https://gmailmcp.googleapis.com/mcp/v1');
  assert.equal(saved.mcpOAuthState.discovery.authorizationServerMetadata.issuer, 'https://accounts.google.com');
  assert.equal(saved.mcpOAuthState.codeVerifier, undefined);
  assert.equal(saved.mcpOAuthState.oauthState, undefined);
});

test('cancelled/rejected authorization closes callback and preserves existing credentials', async t => {
  const harness = await setup(t, () => { throw new Error('No OAuth exchange should occur'); });
  const existing = { accessToken: 'preserved-token' }; harness.state.set(serviceOAuthProviderId(gmail), existing);
  const attempt = await harness.manager.begin(gmail, {}); const rejected = assert.rejects(attempt.completion, error => (error as { code?: string }).code === 'service_oauth_cancelled');
  assert.equal(harness.manager.cancel(attempt.attemptId), true); await rejected;
  assert.deepEqual(harness.state.get(serviceOAuthProviderId(gmail)), existing); assert.equal(harness.traffic.length, 0);
  const redirect = new URL(new URL(attempt.authorizationUrl).searchParams.get('redirect_uri')!); await assert.rejects(fetch(redirect));
});

test('native Pi locked refresh rotates once for concurrent token users and a repeated stale 401', async t => {
  let refreshes = 0;
  const harness = await setup(t, (_url, body) => { assert.equal(body.get('grant_type'), 'refresh_token'); refreshes++; return { access_token: `rotated-${refreshes}`, refresh_token: `refresh-${refreshes}`, token_type: 'Bearer', expires_in: 3600 }; });
  harness.state.set(serviceOAuthProviderId(gmail), { oauthState: JSON.stringify({ type: 'oauth', access: 'expired', refresh: 'refresh-0', expires: 1 }) });
  const tokens = await Promise.all(Array.from({ length: 6 }, () => harness.manager.token(gmail, harness.state.get(serviceOAuthProviderId(gmail))!)));
  assert.deepEqual(tokens, Array(6).fill('rotated-1')); assert.equal(refreshes, 1);
  await Promise.all(Array.from({ length: 4 }, () => harness.manager.refresh(gmail, harness.state.get(serviceOAuthProviderId(gmail))!, 'expired')));
  assert.equal(refreshes, 1, 'stale rejected token cannot expire an already rotated credential');
  const saved = JSON.parse(harness.state.get(serviceOAuthProviderId(gmail))!.oauthState!); assert.equal(saved.refresh, 'refresh-1');
});

test('Feishu public MCP OAuth discovers, dynamically registers, validates issuer and persists refresh context', async t => {
  const harness = await setup(t, (url, body, data) => {
    if (url.pathname.includes('oauth-protected-resource')) return { resource: 'https://mcp.feishu.cn/mcp', authorization_servers: ['https://accounts.feishu.cn'], scopes_supported: ['mcp'] };
    if (url.pathname.includes('oauth-authorization-server') || url.pathname.includes('openid-configuration')) return { issuer: 'https://accounts.feishu.cn', authorization_endpoint: 'https://accounts.feishu.cn/oauth/authorize', token_endpoint: 'https://accounts.feishu.cn/oauth/token', registration_endpoint: 'https://accounts.feishu.cn/oauth/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'] };
    if (url.pathname === '/oauth/register') return { ...(data as object), client_id: 'registered-client' };
    if (url.pathname === '/oauth/token') { assert.equal(body.get('client_id'), 'registered-client'); return { access_token: 'feishu-access', refresh_token: 'feishu-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'mcp' }; }
    throw new Error('Unexpected OAuth endpoint');
  });
  const connection: OAuthConnection = { connectionId: 'feishu-test', service: 'feishu', scopes: ['read'] };
  const attempt = await harness.manager.begin(connection, {}); const authorization = new URL(attempt.authorizationUrl);
  assert.equal(authorization.origin, 'https://accounts.feishu.cn'); assert.equal(authorization.searchParams.get('client_id'), 'registered-client');
  const callback = new URL(authorization.searchParams.get('redirect_uri')!); callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'feishu-code');
  await fetch(callback); await attempt.completion;
  const stored = JSON.parse(harness.state.get(serviceOAuthProviderId(connection))!.oauthState!);
  assert.equal(stored.mcpClientInformation.issuer, 'https://accounts.feishu.cn'); assert.equal(stored.mcpTokens.issuer, 'https://accounts.feishu.cn');
  assert.equal(stored.mcpDiscovery.authorizationServerUrl, 'https://accounts.feishu.cn');
});

test('untrusted Feishu discovery cannot send registration, credentials or browser URLs outside preset trust', async t => {
  const harness = await setup(t, () => ({ resource: 'https://mcp.feishu.cn/mcp', authorization_servers: ['https://attacker.invalid'] }));
  await assert.rejects(harness.manager.begin({ connectionId: 'feishu-untrusted', service: 'feishu', scopes: ['read'] }, {}), error => (error as { code?: string }).code === 'untrusted_service_oauth_endpoint');
  assert(harness.traffic.every(request => new URL(request.url).hostname === 'mcp.feishu.cn'));
});

test('native callback preserves configured localhost and Google Desktop public-client token exchange', async t => {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address(); assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const connection = { ...gmail, redirectUri: `http://localhost:${address.port}/google-desktop/callback` };
  const harness = await setup(t, () => ({ access_token: 'desktop-public-access', refresh_token: 'desktop-public-refresh', token_type: 'Bearer', expires_in: 3600 }));
  const attempt = await harness.manager.begin(connection, {});
  const authorization = new URL(attempt.authorizationUrl);
  assert.equal(authorization.searchParams.get('redirect_uri'), connection.redirectUri);
  assert.equal(authorization.searchParams.get('access_type'), 'offline');
  assert.equal(authorization.searchParams.get('prompt'), 'consent');
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'desktop-code'); callback.searchParams.set('iss', 'https://accounts.google.com');
  assert.equal((await fetch(callback)).status, 200); await attempt.completion;
  assert.equal(harness.traffic.length, 1);
  assert.equal(harness.traffic[0]!.body.get('redirect_uri'), connection.redirectUri);
  assert.equal(harness.traffic[0]!.body.get('client_id'), gmail.clientId);
  assert.equal(harness.traffic[0]!.body.has('client_secret'), false);
});

test('native GitHub registered-app flow uses fixed trusted metadata and native PKCE', async t => {
  const connection: OAuthConnection = { connectionId: 'github-native-oauth', service: 'github', scopes: ['read'], clientId: 'registered-github-app' };
  const harness = await setup(t, () => ({ access_token: 'github-access', refresh_token: 'github-refresh', token_type: 'Bearer', expires_in: 3600 }));
  const attempt = await harness.manager.begin(connection, { clientSecret: 'github-client-secret' });
  const authorization = new URL(attempt.authorizationUrl);
  assert.equal(authorization.origin + authorization.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(harness.traffic.length, 0, 'registered GitHub metadata does not pretend the MCP server supplies discovery');
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'github-code'); callback.searchParams.set('iss', 'https://github.com');
  await fetch(callback); await attempt.completion;
  const exchange = harness.traffic[0]!;
  assert.equal(exchange.url, 'https://github.com/login/oauth/access_token');
  assert.equal(exchange.body.get('client_secret'), 'github-client-secret');
  assert.equal(createHash('sha256').update(exchange.body.get('code_verifier')!).digest('base64url'), authorization.searchParams.get('code_challenge'));
  const native = JSON.parse(harness.state.get(serviceOAuthProviderId(connection))!.oauthState!).mcpOAuthState;
  assert.equal(native.clientInformation.client_id, 'registered-github-app');
});

test('native issuer validation rejects another authorization server before exchanging Google code', async t => {
  const harness = await setup(t, () => { throw new Error('Wrong issuer must not receive a token request'); });
  const attempt = await harness.manager.begin(gmail, {});
  const rejected = assert.rejects(attempt.completion, error => (error as { code?: string }).code === 'service_oauth_issuer_mismatch');
  const authorization = new URL(attempt.authorizationUrl), callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'foreign-code'); callback.searchParams.set('iss', 'https://github.com');
  await fetch(callback); await rejected;
  assert.equal(harness.traffic.length, 0);
  assert.equal(harness.state.has(serviceOAuthProviderId(gmail)), false);
});

test('native Feishu RFC9207 rejects missing and mismatched issuers and accepts the discovered issuer', async t => {
  for (const issuer of [undefined, 'https://accounts.feishu.cn/other-tenant', 'https://accounts.feishu.cn']) {
    const harness = await setup(t, (url, _body, data) => {
      if (url.pathname.includes('oauth-protected-resource')) return { resource: 'https://mcp.feishu.cn/mcp', authorization_servers: ['https://accounts.feishu.cn'], scopes_supported: ['mcp'] };
      if (url.pathname.includes('oauth-authorization-server')) return { issuer: 'https://accounts.feishu.cn', authorization_endpoint: 'https://accounts.feishu.cn/oauth/authorize', token_endpoint: 'https://accounts.feishu.cn/oauth/token', registration_endpoint: 'https://accounts.feishu.cn/oauth/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true };
      if (url.pathname === '/oauth/register') return { ...(data as object), client_id: 'issuer-bound-feishu-client' };
      if (url.pathname === '/oauth/token') return { access_token: 'issuer-bound-access', refresh_token: 'issuer-bound-refresh', expires_in: 3600, token_type: 'Bearer' };
      throw new Error('Unexpected OAuth endpoint');
    });
    const connection: OAuthConnection = { connectionId: 'feishu-issuer-' + String(issuer === undefined ? 'missing' : issuer.endsWith('tenant') ? 'wrong' : 'valid'), service: 'feishu', scopes: ['read'] };
    const attempt = await harness.manager.begin(connection, {});
    const expected = issuer === 'https://accounts.feishu.cn' ? attempt.completion : assert.rejects(attempt.completion, error => (error as { code?: string }).code === 'service_oauth_issuer_mismatch');
    const authorization = new URL(attempt.authorizationUrl), callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'feishu-code'); if (issuer) callback.searchParams.set('iss', issuer);
    await fetch(callback); await expected;
    assert.equal(harness.traffic.filter(request => new URL(request.url).pathname === '/oauth/token').length, issuer === 'https://accounts.feishu.cn' ? 1 : 0);
  }
});

test('native Feishu protected-resource audience cannot be changed to another service', async t => {
  const harness = await setup(t, url => {
    if (url.pathname.includes('oauth-protected-resource')) return { resource: 'https://other-service.invalid/mcp', authorization_servers: ['https://accounts.feishu.cn'] };
    if (url.pathname.includes('oauth-authorization-server')) return { issuer: 'https://accounts.feishu.cn', authorization_endpoint: 'https://accounts.feishu.cn/oauth/authorize', token_endpoint: 'https://accounts.feishu.cn/oauth/token', registration_endpoint: 'https://accounts.feishu.cn/oauth/register', response_types_supported: ['code'] };
    throw new Error('No registration or token exchange may happen');
  });
  await assert.rejects(harness.manager.begin({ connectionId: 'feishu-wrong-resource', service: 'feishu', scopes: ['read'] }, {}));
  assert.equal(harness.traffic.some(request => /\/(?:register|token)$/.test(new URL(request.url).pathname)), false);
});

test('native exchange cancellation and post-refresh abort cannot persist late credentials', async t => {
  const controller = new AbortController();
  const harness = await setup(t, () => { controller.abort(); return { access_token: 'late-access', refresh_token: 'late-refresh', token_type: 'Bearer', expires_in: 3600 }; });
  const existing = { accessToken: 'preserved-before-exchange' }; harness.state.set(serviceOAuthProviderId(gmail), existing);
  const attempt = await harness.manager.begin(gmail, {}, { signal: controller.signal });
  const expected = assert.rejects(attempt.completion, error => (error as { code?: string }).code === 'service_oauth_cancelled');
  const authorization = new URL(attempt.authorizationUrl), callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'cancelled-exchange');
  await fetch(callback); await expected;
  assert.deepEqual(harness.state.get(serviceOAuthProviderId(gmail)), existing);
  let writes = 0; const after = new AbortController();
  const store = createServiceOAuthCredentialStore({ read: async () => existing, write: async () => { writes++; } });
  await assert.rejects(store.modify(serviceOAuthProviderId(gmail), async () => { after.abort(); return { type: 'oauth', access: 'late', refresh: 'late', expires: Date.now() + 3600000 }; }, { signal: after.signal }));
  assert.equal(writes, 0);
});

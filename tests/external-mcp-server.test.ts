import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { connect as tlsConnect } from 'node:tls';
import { Agent, fetch as undiciFetch } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExternalMcpServer } from '../src/host/external-mcp/server.ts';
import { createExternalMcpOAuth } from '../src/host/external-mcp/oauth.ts';
import type { ExternalMcpClientRegistration } from '../src/host/external-mcp/types.ts';

// S3a 工程隔离集成测试：自签 TLS + loopback 127.0.0.1:0 + 合成客户端登记，
// 验证受保护 HTTPS 入口的路径白名单、管理面守卫与标准 MCP 客户端闭环。
// 不访问真实公网、账号或 WorkBuddy。

const execFileAsync = promisify(execFile);

const MANAGEMENT_TOKEN = 'synthetic-management-approval-token';
const VERIFIER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

const publicClient: ExternalMcpClientRegistration = {
  clientId: 'wb-connector-synthetic',
  redirectUris: ['http://127.0.0.1:8765/callback'],
  scopes: ['mcp'],
};
const noScopeClient: ExternalMcpClientRegistration = {
  clientId: 'wrong-scope-client-synthetic',
  redirectUris: ['http://127.0.0.1:8765/wrong-scope'],
  scopes: ['other.scope'],
};
const standardClient: ExternalMcpClientRegistration = {
  clientId: 'standard-mcp-client-synthetic',
  redirectUris: ['https://agent.example.invalid/callback'],
  scopes: ['mcp'],
};

let tlsMaterial: { key: string; cert: string };

test.before(async () => {
  // 工程隔离自签证书：openssl 仅在测试内生成一次性证书，服务端为 node:https。
  const directory = mkdtempSync(path.join(tmpdir(), 'optracall-external-mcp-tls-'));
  await execFileAsync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'),
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ]);
  tlsMaterial = {
    key: readFileSync(path.join(directory, 'key.pem'), 'utf8'),
    cert: readFileSync(path.join(directory, 'cert.pem'), 'utf8'),
  };
});

const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

// Node 内置 fetch 无法挂载 npm undici dispatcher（bundled 版本差）；统一使用 workspace undici 的 fetch。
// 响应体必须立即读尽：未读尽的 keep-alive 响应会占住连接池 socket，令后续同源请求死锁。
interface HttpResult {
  status: number;
  header(name: string): string | undefined;
  json(): unknown;
  text(): string;
}

async function httpsFetch(url: string | URL, init: Record<string, unknown> = {}): Promise<HttpResult> {
  const response = (await undiciFetch(url, { ...init, dispatcher: insecureDispatcher } as never)) as unknown as Response;
  const body = await response.text();
  return {
    status: response.status,
    header: name => response.headers.get(name) ?? undefined,
    json: () => JSON.parse(body) as unknown,
    text: () => body,
  };
}

/** node:tls 裸请求：fetch 层无法伪造 Host/Origin 头（undici 以 URL authority 覆盖），真实攻击面是握手后写的头。 */
function rawTlsRequest(port: number, rawRequest: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
      socket.write(rawRequest);
    });
    let data = '';
    socket.on('data', chunk => { data += chunk.toString('utf8'); });
    socket.on('close', () => {
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);
      const bodyStart = data.indexOf('\r\n\r\n');
      resolve({ status, body: bodyStart >= 0 ? data.slice(bodyStart + 4) : '' });
    });
    socket.on('error', reject);
  });
}

interface StartedServer {
  origin: string;
  oauth: ReturnType<typeof createExternalMcpOAuth>;
  close(): Promise<void>;
}

async function startServer(t: import('node:test').TestContext, overrides: {
  rateLimit?: { windowMs: number; max: number };
  accessTokenTtlSeconds?: number;
  clock?: { now: number };
  clients?: ExternalMcpClientRegistration[];
} = {}): Promise<StartedServer> {
  const clockState = overrides.clock ?? { now: 1_800_000_000 };
  const entry = createExternalMcpServer({
    tls: tlsMaterial,
    managementApprovalToken: MANAGEMENT_TOKEN,
    rateLimit: overrides.rateLimit ?? { windowMs: 60_000, max: 10_000 },
    clock: () => clockState.now,
    createOauth: origin => createExternalMcpOAuth({
      issuer: origin,
      resource: `${origin}/mcp`,
      clients: overrides.clients ?? [publicClient, noScopeClient, standardClient],
      signingKey: 'synthetic-signing-key-material',
      managementApprovalToken: MANAGEMENT_TOKEN,
      accessTokenTtlSeconds: overrides.accessTokenTtlSeconds,
      clock: () => clockState.now,
    }),
  });
  await entry.listen({ port: 0, hostname: '127.0.0.1' });
  t.after(() => entry.close());
  return { origin: entry.origin, oauth: entry.oauth!, close: () => entry.close() };
}

async function mintTokenViaHttp(server: StartedServer, client: ExternalMcpClientRegistration, scope?: string): Promise<string> {
  const codeChallenge = Buffer.from((await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER)))).toString('base64url');
  const authorizeUrl = new URL(`${server.origin}/authorize`);
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', client.redirectUris[0]!);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  if (scope) authorizeUrl.searchParams.set('scope', scope);
  const pendingResponse = await httpsFetch(authorizeUrl, { method: 'GET' });
  assert.equal(pendingResponse.status, 200);
  const pending = pendingResponse.json() as { pending_id: string };
  const approveResponse = await httpsFetch(`${server.origin}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-optracall-management-token': MANAGEMENT_TOKEN },
    body: JSON.stringify({ pendingId: pending.pending_id, operatorId: 'synthetic-operator' }),
  });
  assert.equal(approveResponse.status, 200, `approve must succeed for the management plane: ${approveResponse.text()}`);
  const receipt = approveResponse.json() as { code: string };
  const tokenResponse = await httpsFetch(`${server.origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      code: receipt.code,
      code_verifier: VERIFIER,
      redirect_uri: client.redirectUris[0]!,
      resource: `${server.origin}/mcp`,
    }).toString(),
  });
  assert.equal(tokenResponse.status, 200, `token exchange must succeed: ${tokenResponse.text()}`);
  const tokens = tokenResponse.json() as { access_token: string };
  return tokens.access_token;
}

test('RFC 9728 discovery and AS metadata are public and accurate over TLS', async t => {
  const server = await startServer(t);
  const resource = (await (await httpsFetch(`${server.origin}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
  assert.equal(resource.resource, `${server.origin}/mcp`);
  assert.deepEqual(resource.authorization_servers, [server.origin]);
  const resourcePath = (await (await httpsFetch(`${server.origin}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
  assert.equal(resourcePath.resource, `${server.origin}/mcp`);
  const as = (await (await httpsFetch(`${server.origin}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
  assert.equal(as.issuer, server.origin);
  assert.equal(as.authorization_endpoint, `${server.origin}/authorize`);
  assert.equal(as.token_endpoint, `${server.origin}/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
});

test('MCP endpoint rejects missing, malformed and expired bearers with 401 challenges', async t => {
  const clock = { now: 1_800_000_000 };
  const server = await startServer(t, { clock, accessTokenTtlSeconds: 300 });
  const missing = await httpsFetch(`${server.origin}/mcp`, { method: 'GET' });
  assert.equal(missing.status, 401);
  const challenge = missing.header('www-authenticate') ?? '';
  assert.ok(challenge.startsWith('Bearer'), 'a missing bearer must be challenged');
  assert.ok(challenge.includes(`resource_metadata="${server.origin}/.well-known/oauth-protected-resource"`), 'the challenge must point at RFC 9728 discovery');

  const malformed = await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers: { authorization: 'Bearer not-a-token' } });
  assert.equal(malformed.status, 401);
  assert.ok((malformed.header('www-authenticate') ?? '').includes('error="invalid_token"'));

  const token = await mintTokenViaHttp(server, publicClient, 'mcp');
  // Bearer 通过后进入传输层：无会话 GET 由路由以 400 拒绝（而非 401），证明认证已过。
  const authenticated = await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
  assert.equal(authenticated.status, 400, 'a valid bearer must reach the MCP transport routing');
  assert.equal((authenticated.json() as Record<string, unknown>).error, 'invalid_request');

  clock.now += 301;
  const expired = await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
  assert.equal(expired.status, 401, 'an expired token must be rejected');
  assert.ok((expired.header('www-authenticate') ?? '').includes('invalid_token'));
});

test('tokens for another audience or without required scope are rejected', async t => {
  const server = await startServer(t);
  // cross-audience：用同一密钥但另一 resource 签发的令牌。
  const foreignAudience = createExternalMcpOAuth({
    issuer: server.origin,
    resource: 'https://other-service.invalid/mcp',
    clients: [publicClient],
    signingKey: 'synthetic-signing-key-material',
    managementApprovalToken: MANAGEMENT_TOKEN,
    clock: () => 1_800_000_000,
  });
  const pending = await foreignAudience.createAuthorizationRequest({ clientId: publicClient.clientId, redirectUri: publicClient.redirectUris[0]!, responseType: 'code', codeChallenge: Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER))).toString('base64url'), codeChallengeMethod: 'S256' });
  const receipt = await foreignAudience.authorize({ pendingId: pending.pendingId, approval: { managementToken: MANAGEMENT_TOKEN } });
  const foreignGrant = await foreignAudience.exchangeToken({ grantType: 'authorization_code', clientId: publicClient.clientId, code: receipt.code, codeVerifier: VERIFIER, redirectUri: publicClient.redirectUris[0]! });
  const crossAudience = await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers: { authorization: `Bearer ${foreignGrant.accessToken}` } });
  assert.equal(crossAudience.status, 401, 'a token bound to another resource audience must not pass the Bearer check');
  assert.ok((crossAudience.header('www-authenticate') ?? '').includes('invalid_token'));

  // scope 不足：令牌合法但不带 mcp scope。
  const wrongScopeToken = await mintTokenViaHttp(server, noScopeClient, 'other.scope');
  const forbidden = await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers: { authorization: `Bearer ${wrongScopeToken}` } });
  assert.equal(forbidden.status, 403, 'insufficient scope must be 403, never 401');
  assert.ok((forbidden.header('www-authenticate') ?? '').includes('insufficient_scope'));
});

test('over-limit principals receive 429 with Retry-After', async t => {
  const server = await startServer(t, { rateLimit: { windowMs: 60_000, max: 2 } });
  const token = await mintTokenViaHttp(server, publicClient, 'mcp');
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers })).status, 400);
  assert.equal((await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers })).status, 400);
  const limited = await httpsFetch(`${server.origin}/mcp`, { method: 'GET', headers });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.header('retry-after')) > 0, '429 must carry Retry-After');
});

test('tokens in the URL are rejected outright and never honored', async t => {
  const server = await startServer(t);
  const token = await mintTokenViaHttp(server, publicClient, 'mcp');
  const viaUrl = await httpsFetch(`${server.origin}/mcp?access_token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.ok([400, 401].includes(viaUrl.status), `a URL token must be rejected, got ${viaUrl.status}`);
  assert.equal((viaUrl.json() as Record<string, unknown>).error, 'invalid_request');
  // 即便同时携带合法 Authorization 头，URL token 的存在也必须拒绝该请求。
  const both = await httpsFetch(`${server.origin}/mcp?access_token=${encodeURIComponent(token)}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  assert.ok([400, 401].includes(both.status));
});

test('only whitelisted paths are served; the Host API is not exposed', async t => {
  const server = await startServer(t);
  for (const candidate of ['/api/projects', '/api/settings/service-connections', '/', '/favicon.ico', '/mcp-admin']) {
    const response = await httpsFetch(new URL(candidate, server.origin), { headers: { authorization: 'Bearer whatever' } });
    assert.equal(response.status, 404, `path ${candidate} must not be served`);
  }
  assert.equal((await httpsFetch(`${server.origin}/token`, { method: 'GET' })).status, 405, 'GET /token must be rejected');
  // 路径穿越变形也不得落到白名单内容。
  const traversal = await rawTlsRequest(Number(new URL(server.origin).port), `GET /token/../mcp HTTP/1.1\r\nHost: 127.0.0.1:${new URL(server.origin).port}\r\nConnection: close\r\n\r\n`);
  assert.ok([400, 401, 404].includes(traversal.status), `path traversal must not reach MCP content, got ${traversal.status}`);
});

test('authorization cannot be approved from the public network or forged URLs', async t => {
  const server = await startServer(t);
  const port = Number(new URL(server.origin).port);
  const codeChallenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER))).toString('base64url');
  // 授权 URL 上追加批准语义参数：仍只产生 pending，不签发 code。
  const forged = new URL(`${server.origin}/authorize`);
  forged.searchParams.set('client_id', publicClient.clientId);
  forged.searchParams.set('redirect_uri', publicClient.redirectUris[0]!);
  forged.searchParams.set('response_type', 'code');
  forged.searchParams.set('code_challenge', codeChallenge);
  forged.searchParams.set('code_challenge_method', 'S256');
  forged.searchParams.set('approve', 'true');
  forged.searchParams.set('decision', 'approve');
  forged.searchParams.set('consent', 'yes');
  const pendingResponse = await httpsFetch(forged, { method: 'GET' });
  assert.equal(pendingResponse.status, 200);
  const pendingBody = pendingResponse.json() as Record<string, unknown>;
  assert.equal('code' in pendingBody, false, 'the public authorize endpoint must never return a code from URL parameters');

  // 管理面守卫：非 localhost Host、伪造 Origin、缺失/错误管理令牌一律拒绝。
  // fetch 层无法伪造 Host/Origin（undici 以 URL authority 覆盖），用 node:tls 裸请求模拟真实攻击面。
  const approvePayload = JSON.stringify({ pendingId: String(pendingBody.pending_id) });
  const externalHost = await rawTlsRequest(port, `POST /approve HTTP/1.1\r\nHost: attacker.example.invalid:443\r\nContent-Type: application/json\r\nx-optracall-management-token: ${MANAGEMENT_TOKEN}\r\nContent-Length: ${Buffer.byteLength(approvePayload)}\r\nConnection: close\r\n\r\n${approvePayload}`);
  assert.equal(externalHost.status, 403, 'approval from a non-loopback Host header must be rejected');
  const forgedOrigin = await rawTlsRequest(port, `POST /approve HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: https://attacker.example.invalid\r\nContent-Type: application/json\r\nx-optracall-management-token: ${MANAGEMENT_TOKEN}\r\nContent-Length: ${Buffer.byteLength(approvePayload)}\r\nConnection: close\r\n\r\n${approvePayload}`);
  assert.equal(forgedOrigin.status, 403, 'approval with a foreign Origin must be rejected');
  const noToken = await httpsFetch(`${server.origin}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: approvePayload });
  assert.equal(noToken.status, 403, 'approval without the management token must be rejected');
  const wrongToken = await httpsFetch(`${server.origin}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-optracall-management-token': 'wrong-management-token' },
    body: approvePayload,
  });
  assert.equal(wrongToken.status, 403, 'approval with a wrong management token must be rejected');
  // 正确的 loopback 管理面 + 正确令牌才批准。
  const host = new URL(server.origin).host;
  const approved = await httpsFetch(`${server.origin}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host, 'x-optracall-management-token': MANAGEMENT_TOKEN },
    body: JSON.stringify({ pendingId: String(pendingBody.pending_id), operatorId: 'synthetic-operator' }),
  });
  assert.equal(approved.status, 200);
  const receipt = approved.json() as { code: string };
  assert.equal(typeof receipt.code, 'string');
});

test('a standard MCP client completes initialize/tools/list/ping over TLS with the OAuth loop', async t => {
  const server = await startServer(t);
  const token = await mintTokenViaHttp(server, standardClient, 'mcp');
  const insecureFetch = ((url: string | URL, init?: RequestInit) => undiciFetch(url, { ...init, dispatcher: insecureDispatcher } as never)) as unknown as typeof fetch;
  const transport = new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: insecureFetch,
  });
  const client = new Client({ name: 'synthetic-standard-client', version: '1.0.0' });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name), ['ping'], 'S3a exposes only the transport-loop tool; asset/work tools are S3b');
    const call = await client.callTool({ name: 'ping', arguments: {} });
    assert.equal(call.isError, undefined);
    const payload = call.structuredContent as Record<string, unknown>;
    assert.equal(payload.pong, true);
    assert.equal(payload.principal, standardClient.clientId, 'the ping result must identify the verified principal');
    assert.deepEqual(payload.scopes, ['mcp']);
  } finally {
    await client.close();
  }
});

import { createServer as createHttpsServer, type Server } from 'node:https';
import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { ExternalMcpOauth } from './oauth.ts';
import { ExternalMcpOauthError } from './types.ts';

/**
 * 受保护远端 MCP 的 Streamable HTTP 传输入口（Issue #155 E03/S3a）。
 *
 * 网络边界（spec §7 / AB09）：
 * - 仅暴露白名单路径：RFC 9728/8414 发现、/authorize、/token、管理面 /approve、/mcp；其余一律 404，不把整 Host API 转公网；
 * - /mcp 逐请求 Bearer 校验：过期/无效/错 audience → 401，scope 不足 → 403，超限 → 429；拒绝 URL 携带 token；
 * - /approve（客户端登记后的授权批准）仅限本地管理面：localhost Host + 准确端口 + Origin 白名单 + 管理令牌；
 * - MCP 协议层使用官方 SDK 1.32.2 公开 StreamableHTTPServerTransport（按会话注册表多客户端）；
 * - 本层注册最小 `ping` 工具证明传输闭环；资产/工作工具属 S3b，经同一 Bearer/白名单接入。
 */

export interface ExternalMcpServerOptions {
  tls: { key: string | Buffer; cert: string | Buffer };
  managementApprovalToken: string;
  /** /mcp 所需 scope，默认 ['mcp']。 */
  requiredScopes?: readonly string[];
  /** /mcp 每 principal 固定窗口限流，默认 60s/240 次。 */
  rateLimit?: { windowMs: number; max: number };
  /** epoch 毫秒；注入用于测试限流窗口。 */
  clock?: () => number;
  /** 会话 McpServer 的工具注册；默认注册最小 ping 工具（S3b 增量资产/工作工具）。 */
  registerTools?: (server: McpServer) => void;
  /** 由实际绑定 origin 构造 OAuth 资源/授权服务器（audience 绑定准确 origin）。 */
  createOauth: (origin: string) => ExternalMcpOauth;
}

export interface ExternalMcpServerEntry {
  listen(options?: { port?: number; hostname?: string }): Promise<{ port: number }>;
  get origin(): string;
  get oauth(): ExternalMcpOauth | undefined;
  close(): Promise<void>;
}

const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 240 };
const MAX_CONTROL_BODY_BYTES = 64 * 1024;

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer;
  sessionId?: string;
}

function json(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string | string[]> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers }).end(JSON.stringify(payload));
}

function oauthErrorPayload(error: ExternalMcpOauthError): Record<string, unknown> {
  return { error: error.code, error_description: error.message };
}

/** 默认 S3a 工具面：仅一个传输闭环验证工具；返回认证 principal 证明 Bearer 上下文贯通。 */
function registerDefaultTools(server: McpServer): void {
  server.registerTool('ping', {
    description: 'S3a 传输闭环验证工具：返回服务端核验的认证 principal 与 scope。',
    inputSchema: z.looseObject({ note: z.string().optional() }),
    annotations: { title: 'ping', readOnlyHint: true },
  }, async (_args: unknown, extra: { authInfo?: { clientId?: string; scopes?: string[] } }) => {
    const payload = {
      pong: true,
      principal: extra.authInfo?.clientId ?? null,
      scopes: extra.authInfo?.scopes ?? [],
      note: (_args as { note?: string } | undefined)?.note ?? null,
    };
    return { structuredContent: payload, content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  });
}

export function createExternalMcpServer(options: ExternalMcpServerOptions): ExternalMcpServerEntry {
  const requiredScopes = options.requiredScopes ?? ['mcp'];
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const nowMs = options.clock ?? Date.now;
  const registerTools = options.registerTools ?? registerDefaultTools;

  let server: Server | undefined;
  let oauthInstance: ExternalMcpOauth | undefined;
  let boundOrigin = '';
  let boundPort = 0;
  const sessions = new Map<string, SessionEntry>();
  const rateWindows = new Map<string, { windowStart: number; count: number }>();

  function readBody(request: IncomingMessage, limit = MAX_CONTROL_BODY_BYTES): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          reject(new ExternalMcpOauthError('invalid_request', 413, 'request body exceeds the control-plane limit'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
  }

  /** 管理面守卫：镜像主 Host 约定（Host 须为 127.0.0.1/localhost 且端口准确；Origin 白名单），另加管理令牌。 */
  function guardManagementPlane(request: IncomingMessage): boolean {
    const hostHeader = new URL(`http://${request.headers.host ?? ''}`);
    if (!['127.0.0.1', 'localhost'].includes(hostHeader.hostname) || Number(hostHeader.port) !== boundPort) return false;
    const origin = request.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${boundPort}` && origin !== `http://localhost:${boundPort}`) return false;
    const token = request.headers['x-optracall-management-token'];
    if (typeof token !== 'string') return false;
    const tokenBytes = createHash('sha256').update(token).digest();
    const expectedBytes = createHash('sha256').update(options.managementApprovalToken).digest();
    return timingSafeEqual(tokenBytes, expectedBytes);
  }

  function rateLimitKey(principal: string): string {
    return principal;
  }

  function checkRateLimit(principal: string): { limited: true; retryAfterSeconds: number } | { limited: false } {
    const now = nowMs();
    const window = rateWindows.get(rateLimitKey(principal));
    if (!window || now - window.windowStart >= rateLimit.windowMs) {
      rateWindows.set(rateLimitKey(principal), { windowStart: now, count: 1 });
      return { limited: false };
    }
    window.count += 1;
    if (window.count > rateLimit.max) {
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((window.windowStart + rateLimit.windowMs - now) / 1000)) };
    }
    return { limited: false };
  }

  function resourceMetadataUrl(): string {
    return `${boundOrigin}/.well-known/oauth-protected-resource`;
  }

  async function handleBearer(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const requestUrl = new URL(request.url ?? '/', boundOrigin);
    if (requestUrl.searchParams.has('access_token')) {
      json(response, 400, { error: 'invalid_request', error_description: 'tokens must never be transmitted in the URL' });
      return false;
    }
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) {
      json(response, 401, { error: 'invalid_request', error_description: 'a Bearer access token is required' }, { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl()}"` });
      return false;
    }
    const token = header.replace(/^Bearer\s+/i, '').trim();
    let verified;
    try {
      verified = await oauthInstance!.verifyAccessToken(token);
    } catch (error) {
      const oauthError = error instanceof ExternalMcpOauthError ? error : new ExternalMcpOauthError('invalid_token', 401, 'access token verification failed');
      json(response, 401, oauthErrorPayload(oauthError), { 'www-authenticate': `Bearer error="invalid_token", error_description="${oauthError.code}", resource_metadata="${resourceMetadataUrl()}"` });
      return false;
    }
    if (requiredScopes.some(scope => !verified.scopes.includes(scope))) {
      json(response, 403, { error: 'insufficient_scope', error_description: `the token lacks the required scope: ${requiredScopes.join(' ')}` }, { 'www-authenticate': `Bearer error="insufficient_scope", scope="${requiredScopes.join(' ')}", resource_metadata="${resourceMetadataUrl()}"` });
      return false;
    }
    const rate = checkRateLimit(verified.principal);
    if (rate.limited) {
      json(response, 429, { error: 'rate_limited', error_description: 'too many requests for this principal' }, { 'retry-after': String(rate.retryAfterSeconds) });
      return false;
    }
    (request as IncomingMessage & { auth?: unknown }).auth = {
      token,
      clientId: verified.clientId,
      scopes: verified.scopes,
      expiresAt: verified.expiresAt,
      resource: new URL(verified.resource),
      extra: { principal: verified.principal },
    };
    return true;
  }

  function removeSession(entry: SessionEntry): void {
    if (entry.sessionId && sessions.get(entry.sessionId) === entry) sessions.delete(entry.sessionId);
  }

  async function createSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const entry: SessionEntry = { transport: undefined as unknown as StreamableHTTPServerTransport, mcpServer: undefined as unknown as McpServer };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: sessionId => {
        entry.sessionId = sessionId;
        sessions.set(sessionId, entry);
      },
    });
    const mcpServer = new McpServer({ name: 'optracall-external-mcp', version: '0.1.0' });
    registerTools(mcpServer);
    entry.transport = transport;
    entry.mcpServer = mcpServer;
    transport.onclose = () => removeSession(entry);
    await mcpServer.connect(transport);
    try {
      await transport.handleRequest(request, response);
    } catch (error) {
      removeSession(entry);
      await mcpServer.close().catch(() => {});
      throw error;
    }
    if (transport.sessionId && !sessions.has(transport.sessionId)) {
      entry.sessionId = transport.sessionId;
      sessions.set(transport.sessionId, entry);
    }
  }

  async function handleMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const sessionHeader = request.headers['mcp-session-id'];
    const sessionId = typeof sessionHeader === 'string' ? sessionHeader : Array.isArray(sessionHeader) ? sessionHeader[0] : undefined;
    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) {
        json(response, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'session not found' }, id: null });
        return;
      }
      await entry.transport.handleRequest(request, response);
      return;
    }
    if (request.method === 'POST') {
      await createSession(request, response);
      return;
    }
    json(response, 400, { error: 'invalid_request', error_description: 'the mcp-session-id header is required for this method' });
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!oauthInstance) {
      json(response, 503, { error: 'unavailable', error_description: 'the OAuth resource server is not attached yet' });
      return;
    }
    const requestUrl = new URL(request.url ?? '/', boundOrigin);
    const method = (request.method ?? 'GET').toUpperCase();
    try {
      // —— 公共发现端点 ——
      if (method === 'GET' && (requestUrl.pathname === '/.well-known/oauth-protected-resource' || requestUrl.pathname === `/.well-known/oauth-protected-resource${new URL(oauthResource()).pathname}`)) {
        json(response, 200, oauthInstance.protectedResourceMetadata());
        return;
      }
      if (method === 'GET' && requestUrl.pathname === '/.well-known/oauth-authorization-server') {
        json(response, 200, oauthInstance.authorizationServerMetadata());
        return;
      }
      // —— 授权端点：仅产生 pending，绝不凭 URL 参数批准 ——
      if ((method === 'GET' || method === 'POST') && requestUrl.pathname === '/authorize') {
        const params = method === 'GET' ? requestUrl.searchParams : new URLSearchParams(await readBody(request));
        try {
          const pending = await oauthInstance.createAuthorizationRequest({
            clientId: String(params.get('client_id') ?? ''),
            redirectUri: String(params.get('redirect_uri') ?? ''),
            responseType: params.get('response_type') ?? undefined,
            scope: params.get('scope') ?? undefined,
            codeChallenge: params.get('code_challenge') ?? undefined,
            codeChallengeMethod: params.get('code_challenge_method') ?? undefined,
            resource: params.get('resource') ?? undefined,
            state: params.get('state') ?? undefined,
          });
          json(response, 200, {
            pending_id: pending.pendingId,
            client_id: pending.clientId,
            redirect_uri: pending.redirectUri,
            scope: pending.scope.join(' '),
            resource: pending.resource,
            state: pending.state,
            expires_in: Math.max(0, pending.expiresAt - Math.floor(nowMs() / 1000)),
            approval_required: true,
          });
        } catch (error) {
          if (error instanceof ExternalMcpOauthError) json(response, error.status, oauthErrorPayload(error));
          else throw error;
        }
        return;
      }
      // —— 换令牌端点（RFC 6749 form 编码）——
      if (method === 'POST' && requestUrl.pathname === '/token') {
        const contentType = String(request.headers['content-type'] ?? '');
        if (!contentType.includes('application/x-www-form-urlencoded')) {
          json(response, 400, { error: 'invalid_request', error_description: 'the token endpoint accepts form-encoded requests' });
          return;
        }
        const params = new URLSearchParams(await readBody(request));
        try {
          const grant = await oauthInstance.exchangeToken({
            grantType: params.get('grant_type') ?? undefined,
            clientId: String(params.get('client_id') ?? ''),
            clientSecret: params.get('client_secret') ?? undefined,
            code: params.get('code') ?? undefined,
            codeVerifier: params.get('code_verifier') ?? undefined,
            redirectUri: params.get('redirect_uri') ?? undefined,
            resource: params.get('resource') ?? undefined,
          });
          json(response, 200, {
            access_token: grant.accessToken,
            token_type: grant.tokenType,
            expires_in: grant.expiresIn,
            scope: grant.scope.join(' '),
          });
        } catch (error) {
          if (error instanceof ExternalMcpOauthError) json(response, error.status, oauthErrorPayload(error));
          else throw error;
        }
        return;
      }
      // —— 管理面批准端点 ——
      if (method === 'POST' && requestUrl.pathname === '/approve') {
        if (!guardManagementPlane(request)) {
          json(response, 403, { error: 'management_guard_rejected', error_description: 'approval is restricted to the trusted local management plane' });
          return;
        }
        const body = JSON.parse(await readBody(request)) as { pendingId?: string; operatorId?: string };
        try {
          const receipt = await oauthInstance.authorize({ pendingId: String(body.pendingId ?? ''), approval: { managementToken: options.managementApprovalToken, operatorId: body.operatorId } });
          json(response, 200, { code: receipt.code, redirect_uri: receipt.redirectUri, scope: receipt.scope.join(' '), state: receipt.state, expires_in: Math.max(0, receipt.expiresAt - Math.floor(nowMs() / 1000)) });
        } catch (error) {
          if (error instanceof ExternalMcpOauthError) json(response, error.status, oauthErrorPayload(error));
          else throw error;
        }
        return;
      }
      // —— 受保护 MCP 传输端点 ——
      if (requestUrl.pathname === '/mcp') {
        if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
          json(response, 405, { error: 'invalid_request', error_description: 'MCP supports POST, GET and DELETE' });
          return;
        }
        if (!(await handleBearer(request, response))) return;
        await handleMcp(request, response);
        return;
      }
      // —— 白名单路径存在但方法不允许 → 405；其余路径一律 404 ——
      if (['/authorize', '/token', '/approve', '/mcp'].includes(requestUrl.pathname)) {
        json(response, 405, { error: 'invalid_request', error_description: 'method not allowed on this endpoint' });
        return;
      }
      json(response, 404, { error: 'not_found', error_description: 'only the MCP, discovery and authorization endpoints are exposed' });
    } catch (error) {
      if (error instanceof ExternalMcpOauthError && error.status === 413) {
        json(response, 413, oauthErrorPayload(error));
        return;
      }
      json(response, 500, { error: 'internal_error', error_description: error instanceof Error ? error.message : 'unknown error' });
    }
  }

  function oauthResource(): string {
    return oauthInstance ? String((oauthInstance.protectedResourceMetadata() as { resource?: string }).resource ?? '/mcp') : '/mcp';
  }

  return {
    async listen(listenOptions = {}) {
      if (server) throw new Error('external_mcp_server already listening');
      server = createHttpsServer({ key: options.tls.key, cert: options.tls.cert }, (request, response) => {
        void handle(request, response).catch(() => {
          if (!response.headersSent) json(response, 500, { error: 'internal_error', error_description: 'unexpected handler failure' });
        });
      });
      const port = listenOptions.port ?? 0;
      const hostname = listenOptions.hostname ?? '127.0.0.1';
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(port, hostname, () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('external_mcp_server could not determine the bound address');
      boundPort = address.port;
      boundOrigin = `https://${hostname}:${boundPort}`;
      oauthInstance = options.createOauth(boundOrigin);
      return { port: boundPort };
    },
    get origin() {
      if (!boundOrigin) throw new Error('external_mcp_server is not listening');
      return boundOrigin;
    },
    get oauth() {
      return oauthInstance;
    },
    async close() {
      const closable = server;
      server = undefined;
      oauthInstance = undefined;
      const sessionCloses = [...sessions.values()].map(async entry => {
        await entry.mcpServer.close().catch(() => {});
        await entry.transport.close().catch(() => {});
      });
      sessions.clear();
      rateWindows.clear();
      await Promise.all(sessionCloses);
      if (!closable) return;
      await new Promise<void>((resolve, reject) => {
        closable.closeAllConnections();
        closable.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

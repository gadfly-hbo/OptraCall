/** 受保护远端 MCP（Issue #155 E03/S3a）共享类型。
 * 认证身份来自服务端核验的客户端登记和操作者授权关系；类型层不承载任何校验行为。 */

export class ExternalMcpOauthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, description: string) {
    super(description || code);
    this.name = 'ExternalMcpOauthError';
    this.code = code;
    this.status = status;
  }
}

/** 预注册客户端登记：由本地受信管理面注入，不是任意动态注册（DCR 不采用）。
 * clientSecret 存在 → 机密客户端（client_secret_post）；缺省 → 公共客户端（token_endpoint_auth_method=none）。 */
export interface ExternalMcpClientRegistration {
  clientId: string;
  /** 精确匹配的 redirect URI 集合；授权与换令牌均按逐字相等校验。 */
  redirectUris: readonly string[];
  /** 可授予的最大 scope 集合；超出即拒绝。 */
  scopes: readonly string[];
  clientSecret?: string;
}

export interface ExternalMcpPendingAuthorization {
  pendingId: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  resource: string;
  expiresAt: number;
  state?: string;
}

export interface ExternalMcpAuthorizationCodeReceipt {
  code: string;
  redirectUri: string;
  scope: string[];
  state?: string;
  expiresAt: number;
}

export interface ExternalMcpTokenGrant {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string[];
}

export interface ExternalMcpVerifiedToken {
  tokenId: string;
  clientId: string;
  principal: string;
  scopes: string[];
  issuer: string;
  resource: string;
  expiresAt: number;
}

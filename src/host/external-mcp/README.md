# 受保护远端 MCP（E03 · Issue #155）

本模块是 OptraCall 原实例对外提供的**受保护远端 MCP 入口**：官方 `@modelcontextprotocol/sdk@1.32.2` 公开 `StreamableHTTPServerTransport`（按会话注册表）承载 `McpServer`，前置自实现的 OAuth 2.1 授权/资源服务器（`oauth.ts`）。本 README 是工程交付的部署/接入说明；**实际公网/设备部署须按用户指定环境与授权另行执行**（spec §7：本轮准备不开放端口、不复制资产、不部署）。

## 网络形态

```
外部 Agent（标准 MCP 客户端 / 预注册 Connector）
   │  HTTPS（生产由网关或本进程 TLS 终止）
   ▼
受保护入口 server.ts（仅白名单路径）
   ├─ GET  /.well-known/oauth-protected-resource        RFC 9728 资源元数据（公开）
   ├─ GET  /.well-known/oauth-protected-resource/mcp    同上（RFC 9728 路径后缀形态）
   ├─ GET  /.well-known/oauth-authorization-server      RFC 8414 授权服务器元数据（公开）
   ├─ GET/POST /authorize                               创建待批准授权请求（公开；绝不签发 code）
   ├─ POST /token                                       换令牌（RFC 6749 form 编码；授权码+PKCE S256，一次性）
   ├─ POST /approve                                     管理面批准（localhost Host+准确端口+Origin 白名单+管理令牌）
   └─ POST/GET/DELETE /mcp                              MCP Streamable HTTP（逐请求 Bearer）
```

白名单外一律 404；白名单路径方法不允许一律 405。**不把整 Host API 转公网**；主 Host API（`src/host/server.ts`）的 localhost/Origin 管理面守卫不受影响，本模块的 `/approve` 镜像同一守卫约定并额外要求管理令牌。

## OAuth 2.1 合同（spec §7 / integration-research §3）

- **预注册客户端**：登记由本地受信管理面注入（`clientId` / 精确 `redirectUris` / 可授予 `scopes` / 可选机密客户端 `clientSecret`）。不做任意动态注册（DCR 弃用）；WorkBuddy Connector 兼容走预注册 `oauth2_code` 路径。
- **公共授权页不能凭访问 URL 批准**：`/authorize` 只产生待批准请求（pending），响应永远不含 code；批准只能经管理面 `/approve`（守卫+令牌），对应真实部署中的本机管理 UI 确认步骤。
- **PKCE**：仅 S256；verifier 校验 RFC 7636 长度/字符集；`redirect_uri` 授权与换令牌两次逐字精确匹配。
- **令牌绑定**：访问令牌为 HMAC-SHA256 签名（`iss`/`aud`(=resource)/`sub`(=clientId principal)/`scope`/`iat`/`exp`/`jti`），逐请求校验签名→签发者→audience→有效期→撤销；签名密钥由受信管理面注入。
- **错误语义**：过期/无效/错 audience/错 issuer → **401**（`WWW-Authenticate: Bearer error="invalid_token", resource_metadata=…`）；scope 不足 → **403**（`insufficient_scope`）；每 principal 超限 → **429**（`Retry-After`）。
- **不接受透传**：其他资源签发的令牌按 audience 不匹配拒绝；**URL 携带 token 一律 400 拒绝**（含同时带合法 Authorization 头的情形）。
- **授权码一次性**：重放检测后撤销该 code 已签发的全部令牌（RFC 6749 §4.1.2），不牵连无关令牌。
- 本期仅 `authorization_code` 授权类型；refresh token 轮换属后续部署切片（E07），客户端重连时重新走授权。

## 会话与工具面

- 每个客户端 `initialize` 建立独立会话（`mcp-session-id`），SDK stateful transport 按会话注册表路由；未知会话 404，无会话 GET/DELETE 400。
- S3a 工具面仅 `ping`（回显核验的 principal/scope，证明传输闭环）；资产只读（`asset.*`）与工作记录（`work.*`）工具属 S3b，经同一 Bearer/白名单接入，不动传输层。
- `/mcp` 每 principal 固定窗口限流默认 60s/240 次（可注入）；会话数量上限属部署切片。

## 部署要点（实际公网另授权）

1. **入口**：本进程 `createExternalMcpServer({ tls, managementApprovalToken, createOauth })`，`listen()` 后以实际绑定 origin 构造 OAuth（`issuer=origin`，`resource=origin+"/mcp"`，audience 精确绑定）。生产也可由反向代理终止 TLS——网关只能转发上述白名单路径并保持 Host 头准确，不得转发整 Host API。
2. **预注册客户端**：在本地受信管理面维护登记表（本模块经构造参数注入）；机密客户端 secret 只存服务端凭据管理，不进公共配置。
3. **令牌 audience**：客户端在授权与换令牌请求中携带 `resource=<入口 origin>/mcp`（RFC 8707）；缺失时绑定配置的受保护资源，错配直接拒绝。
4. **批准流**：真实部署将 `/authorize` 的 pending 接到本机管理 UI（经既有 localhost 守卫入口）展示目标客户端/redirect/scope，由用户确认后调 `/approve`；本模块不改这一顺序。
5. **密钥治理**：`signingKey` 与 `managementApprovalToken` 为受信管理面注入的部署密钥；泄露即轮换（重发客户端登记）。本仓库不保存真实密钥。
6. **未含项**：refresh token、会话配额、审计日志外发、多实例共享状态——按 E07/部署切片另行交付。

## 检查

- 单元+集成：`node --test tests/external-mcp-oauth.test.ts tests/external-mcp-server.test.ts`（自签 TLS、loopback 127.0.0.1:0、合成客户端；不触真实公网/账号）。
- 边界：`npm run check:agent-sessions`（MCP SDK 导入不在 Pi SDK 单入口规则内，与 trade-area-mcp 先例一致，无需例外）。

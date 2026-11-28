# Agent 大脑外部协作一期 · 实施记录（E01–E07）

2026-11-28 · 领取方 Qoder · Issue #155 · 任务分支 `work/qoder/issue-155-agent-brain-external-collaboration`

## 本轮目标与交付

按用户已确认的 v0.3 冻结包（提交 `2f6013fd`，spec `56522ef4…` / tasks `fe12198a…` / ui-demo `9a5626d5…`）实施 E01–E07 工程：原 Task 内部/外派选择与授权、GitHub 独立发布与通用认证领取、原实例受保护资产/工作远端 MCP、交付保全与同 owner 续接、WorkBuddy 可选适配工程合同、UI 与回归、隔离核心闭环与非作者复核。E08 真实账号/公网/设备采用不在本次授权。

验收以 spec AB01–AB18、tasks E01–E07 与冻结 Demo 共同为准。开 PR（含 draft）前须向用户展示真实产品截图并取得明确确认。

## 基线与身份

- 基线 main：`74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`
- 冻结包导入提交：`5d201f56de469947c62ce1f1803335db20079fa7`
- 阅读回执提交：`fe0eb95581181d71b392315b639ad2f9e8ddc3f5`
- Interface v3 · 官方 Pi `@earendil-works/pi-coding-agent@1.4.0` · MCP `@modelcontextprotocol/sdk@1.32.2`（不升级、不改包）
- 检查入口：`npm run check` = `check:agent-sessions` + `node --test tests/*.test.ts` + `build`

## 开工阅读（已完成）

- 根 AGENTS.md、工程规范 v1.17、统一会话接入说明（IN01–IN07）已读。
- 冻结 Demo 浏览器实际阅读回执：[evidence/implementation/reading/receipt.md](evidence/implementation/reading/receipt.md)（46 组截图，1440/1024/390 亮暗，9 条场景路径）。
- 生产映射：[ui-implementation-mapping.md](ui-implementation-mapping.md)。

## 执行清单（逐项更新）

- [x] P-read 冻结 Demo 浏览器阅读 + DOM/CSS 骨架 + 生产映射 + Issue 回执
- [x] D01 最小接口/持久迁移与回退设计 → [design.md](design.md)；后端接缝实测 [seam-report](evidence/implementation/seam-report.md)
- [~] E01 内部/外派选择与授权、身份/持久记录；内部/取消零外部动作 —— S1 切片完成（store＋grant＋internal/external choice＋owner-bound port）；Host 接线（server.ts/工作方式卡）待后续切片
- [~] E02 GitHub 独立发布/修订/回执 + 通用认证领取、原子单 claim/UNKNOWN 幂等 —— S2 切片完成（Host-only 发布编排＋UNKNOWN 只读核对＋只读收件适配＋manager Host-only 派发接缝）；原子单 claim 在 S1 store 已完成本轮复用；发布/收件的真实 GitHub 出站与 server.ts 接线属 E07/后续切片
- [ ] E03 受保护资产/工作 MCP、OAuth/精确交集/只读/错误与分片边界 —— S3a 切片完成（OAuth 2.1 授权/资源服务器＋受保护 Streamable HTTP 传输入口＋自签 TLS 闭环）；资产/work 业务工具与精确交集属 S3b
- [ ] E04 字节保全/ExternalDeliveryRef、原 owner 指纹/providedContext/非用户原话、busy/重启/暂停/取消/迟到、Agent 核验/原工具保存
- [ ] E05 WorkBuddy 可选适配工程合同（默认未验证禁用）
- [ ] E06 UI 编码（沿映射）+ 三路径 + 1440/1024/390 亮暗/键盘/焦点 + 原消费者回归
- [ ] E07 隔离 Host/Pi/标准 MCP/TLS/OAuth/GitHub 模拟供应商核心闭环 + 三冻结基准逐项非作者复核
- [ ] G01 真实产品同视口对照 + 开 PR 前截图用户确认（PM 门禁）
- [ ] G02 实际 PR head CI + 授权合并 + main push CI + 结案回填

## 设计（D01，已完成）

见 [design.md](design.md)：记录权威与持久化（external-work-store，原子 JSON CAS）、owner-bound 外派 port、Host-only GitHub 发布入口、远端 MCP/OAuth 复用与净新边界、续接/停止/取消合同、WorkBuddy 可选适配、迁移与回退、S1–S7 切片与 TDD 负例。后端接缝实测见 [seam-report](evidence/implementation/seam-report.md)。

## 验证与限制

### S1（E01，2026-11-28）：外派业务记录权威 + owner-bound 授权 port

**本轮交付**（自包含，不接 server.ts/UI；真实 Studio/语义资格与发布/触发接线属后续切片）：

- `src/host/external-work-types.ts`：WorkGrant / ExternalWork / PublicationAttempt / Claim / ExternalDeliveryRef / ReviewDecision / InboxEvent / ResumeReceipt / InternalChoice（内部选择意图）记录类型与严格校验；全部绑定真实 `projectId/taskId`，与 Case `assignment.issue` 身份分离（`sourceCaseRef` 仅为可选准确引用，不反向派生）。
- `src/host/external-work-store.ts`：`dataRoot/external-work/ledger.json` 原子 JSON 台账，镜像 ServiceConnectionStore：0700 目录/0600 文件、`O_NOFOLLOW`、tmp+rename+目录 fsync、`.store.lock` inode 校验、公开 `mutate(state, expectedVersion)` CAS、严格 schema:1 解析（含引用完整性与唯一身份检查）、启动把外来进程 `submitted` 标 `unknown`、过期领取标 `expired`、64MiB/10000 记录上限；进程标识可注入以测试真实重启语义。Claim 同 (workId, revision) 至多一个有效领取（原子 CAS，同 principal 幂等、竞争者冲突、错 epoch/过期/撤销拒绝、租约封顶于授权有效期）。
- `src/host/external-dispatch.ts`：Host 构造的窄 facade `summarize / chooseInternal / authorize / cancelWork`。authorize 校验允许执行者集合、仓库稳定 ID+可见性、精确资产 refs 与注入的 `qualifyAssets(projectId, refs)` 原资格回调取交集（越权 ref 整体拒绝）、显式企业必填（无 legacy 默认放行）、有效期须为未来、资源策略默认 1work/24h 且较低已批准策略优先、超默认拒绝、限 1work/窗口（取消后可同窗重派）。chooseInternal 记录意图零外部动作；已有未取消外派拒绝静默切回。受限 profile 经注入 `profiles` 回调拒绝外派、内部路径不受限（AB01）。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段，行为缺失导致断言失败，非导入/环境错误）：`evidence/implementation/red/s1-external-work-store-red.log`、`red/s1-external-dispatch-red.log`、`red/s1-combined-red.log`（均 exit=1，61 个失败子测试，全部 `external_*_unimplemented` 行为错误）。
- GREEN：`node --test tests/external-work-store.test.ts tests/external-dispatch.test.ts` → 35/35 PASS（`green/s1-combined-green.log`；store 用例连跑 8 次、dispatch 用例连跑 4 次无抖动）。
- 检查：`npm run check:agent-sessions` PASS（`green/s1-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s1-build-green.log`）。
- 全量 `npm test`：3721 测试，3608 PASS，2 FAIL，111 skipped（约 9 分钟）。2 个失败为 `conclusion-review-handoff` 的 CNR-A4 一例（隔离复跑仍 9/10）与 `service-connection-manager` 一例（隔离复跑 29/29，属负载抖动）。已用 `git stash` 在干净基线 `7decc3b` 复核：CNR-A4 在未含本切片改动的基线上同样失败（9/10），判定为既有问题，与本切片无关；两例均已如实保留，不在本切片内修复。本切片新增测试已包含在上述全量统计中且全部 PASS。

**关键负例覆盖**：store CAS 版本竞争单一胜者；外来 submitted→unknown 保留不重试、本进程 submitted 不误标；9 类损坏 schema（版本升位/未知键/悬挂引用/坏 hash/重复身份/坏时间戳/复核 hash 不符/非法 mode/非 JSON）一律 `external_store_corrupt` 拒绝；失败变更零半份记录（文件字节不变、无 tmp 残留）；并发/重复领取至多一个有效；错 epoch/过期/撤销/未发布/越集 principal 拒绝；租约封顶授权有效期、过期事实先持久化再报错；发布身份按 (work,revision,action) 去重、异文冲突、转移表守卫、unknown 仅 reconciled 可核定；交付幂等键同文回执/异文冲突、复核绑定准确 delivery hash；受限 profile/缺企业/越权资产 refs/超默认策略/窗口限流/过期有效期拒绝；chooseInternal 零 Issue/零触发/零资产增权且已有外派不静默切回；取消零外部记录并撤销有效领取。

**失败/跳过/未验证项**：

- S1 未验证（明确不在本轮范围）：真实 GitHub/WorkBuddy 出站动作（E02/E05）、远端 MCP 与真实资产资格接线（E03，`qualifyAssets` 本轮为合成回调）、交付字节保全与续接/停止/取消外部请求（E04）、UI（E06）、真实公网部署（E08）。store 层未做跨进程文件锁的破坏性压测（沿用与 ServiceConnectionStore 相同的 inode 校验模式，其既有覆盖不重复）。
- 兼容回退：ledger 为新增可选业务记录；旧项目/会话/native/草稿不迁移不改写；缺 `external-work/` 目录按空台账读取（AB15 legacy 读取已测）；损坏台账拒绝服务不静默重建；新增记录含 UNKNOWN/撤销事实，回退不重放外部动作。

### S2（E02，2026-11-28）：Host-only GitHub 发布 + UNKNOWN 只读核对 + 只读收件适配

**本轮交付**（自包含，不接 server.ts/UI；真实 GitHub 出站、grant→binding 的 Host 装配与续接属 E07/后续切片）：

- `src/host/external-publish.ts`：发布编排 `ExternalPublisher`。`publish(workId, revision, action, body)`：先持久预留 (workId, revision, action) 唯一 `PublicationAttempt`（确切出站正文 sha256）；同身份重复请求（同进程新 turn/重启后新 publisher）回原 attempt 不重派；异正文同身份为 `external_publication_conflict`。已预约身份先短路再走锚点守卫：每 work 仅一张 Issue（已有 succeeded create 时再 create 为 `external_issue_already_created`）；comment 必须有 succeeded create 锚点（缺失 `external_publication_anchor_missing`，不产生死行）；修订（revision 2）经 `add_issue_comment` 在同一 Issue 追加，原说明与旧交付不动。prepared→submitted 先于出站调用；transport 结构化 rejected（提交前已核实拒绝）/unknown/抛错均如实落账；succeeded 无准确 repositoryId 降级 unknown。`reconcile(operationId, author)` 仅经注入只读 probe 核对准确仓库/作者/正文版本：唯一准确匹配才关联（succeeded 带 issueId / 显式 rejected 收据），多匹配抛 `external_publication_conflict`，查不到保持 unknown；terminal/prepared attempt 不查不写，全程零出站调用。
- `src/host/service-connection-manager.ts`：最小新增 Host-only 派发入口 `dispatchHostOperation(binding, request)`（前台 `port()`/`#call` 逐字节未动）。service 日志身份 `hostPublicationOperationId(workId, revision, action)` 由 work-revision 派生（非前台 toolCall），requestId/toolCallId 均为显式 `host:` 前缀的派生值，不伪造 sessionId/toolCallId 借用前台 port；复用 prepared→submitted→unknown 日志、`RemoteServiceBackend.invoke`（内含 `enforceGithubRepository` 纵深防御）与既有序列化。入口前置拒绝（不改服务/非 GitHub 动作/越仓库/bodyHash≠sha256(body)/缺 title/issueNumber/凭据材料出站扫描 `service_outbound_secret_rejected`/host context 失效 fail-closed）一律不落日志不发起调用；同一身份并发至多一次 invoke（落败方回 unknown-in-flight，不二次调用不误标对方）；提交后丢回执→unknown（已知未提交效果 `ServiceRemoteError.unknownOutcome===false`→rejected），不盲重发。hostContext（signal/assertCurrent/registerCleanup）由 Host 为外派操作构造。对 store 锁获取类瞬态错误（`unsafe_service_storage`/`service_store_busy`，见范围外发现）在本入口内做有界重试（3 次、递增短延迟），完整性类错误原样失败。
- `src/host/external-inbox.ts`：Host-only 只读收件适配 `ExternalInbox`。仅读构造时注入的获准订阅（仓库/Issue 精确身份）；轮询默认 60s（可注入 pollIntervalMs/schedule/时钟），成功尊重供应商 Retry-After、失败指数有界退避；事件逐条经 store `recordInboxEvent` 持久化去重，整窗保存后才推进游标（保存失败游标原地、原窗口重读）；`stop()` 后拒绝再拉、`revoke()` 精确失权单一订阅；重启由新实例按 Host 重建的已授权精确订阅恢复读取，靠台账去重而非重放；transport 类型只读，无前台 tool context、无外部写重放、无模型循环（续接判定属 E04）。
- `src/host/external-dispatch.ts`：增 owner-bound `publish(projectId, taskId, input)` 衔接——须注入 Host 构造的 `ExternalPublisher`（未注入 `external_publisher_unconfigured`），校验 work 归属与 profile 门禁后委托；`ExternalWorkStore` 本轮零改动（修订晋升的宿主流程属后续切片，测试经公开 `mutate` CAS 安排 revision 2 数据）。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段，行为缺失导致哨兵错误，非导入/环境错误）：`evidence/implementation/red/s2-combined-red.log`（exit=1，27 测试 26 失败，全部 `external_publish_unimplemented`/`external_inbox_unimplemented`/`service_host_dispatch_unimplemented`；前台回归 1 例按预期已绿，证明桩纯增量）。
- GREEN：`node --test tests/external-publish.test.ts tests/external-inbox.test.ts tests/service-connection-host-dispatch.test.ts` → 27/27 PASS 连跑 4 次（`green/s2-combined-green.log`）。
- 共享接缝回归（隔离复跑全过）：`tests/service-connection-manager.test.ts` 29/29（`green/s2-regression-manager-green.log`；首跑一例 28/29 后三次连跑全过，失败现场如实保留于 `green/s2-regression-manager-flake-28of29.log`，为 waitFor 期间 `service_store_corrupt` 读抖动，隔离复跑与本切片新增路径无交集）、`tests/service-connection-host.test.ts` 1/1、`tests/service-connection-oauth.test.ts` 11/11（各自 green 日志）；三文件合并 41/41。另跑 service-connection 家族其余 9 文件＋S1 external 两文件共 145/145 PASS。
- 检查：`npm run check:agent-sessions` PASS（`green/s2-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s2-build-green.log`）。
- 全量 `npm test`（最终代码）：见 `green/s2-full-suite.log` 与下方记录；全量运行中途曾因代码迭代（并发测试修正）中止一次，最终证据一律取自定稿代码的复跑（上列各日志）。

**关键负例覆盖（对应交接清单）**：同 work revision 跨 turn/重启重复 publish 仅一次出站调用并回原 attempt，异正文冲突；提交后丢回执→unknown 不盲重发，reconcile 唯一匹配才核定、错作者不计、多匹配冲突、零匹配保持 unknown、terminal/prepared 不查不写；修订 r2 同 Issue 追加且原说明/旧交付/标题不动、无锚点 comment 拒绝且零死行、已建 Issue 再 create 拒绝；出站 bodyHash 固定且逐字交付；取消外派零出站；收件重复事件去重、保存失败游标不推进原窗重读、stop 后拒绝再拉、revoke 单订阅持久失权、重启恢复精确订阅且只读不重放（claims/publications/deliveries 逐项不变）、默认 60s/Retry-After/失败退避逐项可注入验证；Host-only 入口无前台 sessionId/toolCallId（`host:` 派生值且前台/宿主身份公式互异）、越仓库/换绑/断连/伪造 hash/夹带凭据/stale context 全部拒绝且零日志行零调用，前台 port 读/写与 requestId+toolCallId 派生身份回归不变。

**失败/跳过/未验证项**：

- S2 未验证（明确不在本轮范围）：真实 GitHub 出站（E07 模拟供应商/实号）、grant→binding 的 server.ts Host 装配（后续切片）、外派续接（E04）、WorkBuddy 触发（E05）、UI（E06）；`ExternalPublisher` 的 hostContext 注入与 reconcile probe 为接缝，真实账户身份核对在装配时生效。修订晋升（supplement→revision+1）的宿主入口未在本切片交付。
- 兼容回退：`ExternalWorkStore`/既有前台 port 行为零改动；新增记录沿用 S1 ledger（含 UNKNOWN/拒绝事实），回退不重放外部动作；inbox 游标为内存态，重启由台账去重兜底，无新增持久结构。

### S3a（E03，2026-11-28）：受保护远端 MCP 的鉴权与传输层

**本轮交付**（净新鉴权/传输切片，不含资产/work 业务工具——那是 S3b；不接 server.ts 主 Host API，真实公网部署另授权）：

- `src/host/external-mcp/types.ts`：预注册客户端登记（精确 redirectUris/scopes/可选机密 secret）、pending/收据/令牌授予/核验结果类型与 `ExternalMcpOauthError`（code+HTTP status）。
- `src/host/external-mcp/oauth.ts`：OAuth 2.1 授权/资源服务器最小实现。仅预注册客户端（受信管理面注入，不做 DCR）；授权码+PKCE 仅 S256（verifier RFC 7636 校验，redirect_uri 两次逐字精确匹配）；访问令牌 HMAC-SHA256 签名绑定 `iss`/`aud`(=resource)/`sub`(=principal)/`scope`/`exp`/`jti`；逐请求校验签名→issuer→audience→有效期→撤销（其他资源令牌 `audience_mismatch` 拒绝，不透传）；授权码一次性，重放撤销该 code 已签发令牌且不牵连无关令牌（RFC 6749 §4.1.2）；**公共授权请求只产生 pending，code 只能经 `authorize()` 的受信管理面令牌签发（URL 上的 approve/consent/decision 参数一律无效）**；RFC 9728 资源元数据与 RFC 8414 AS 元数据准确（scopes_supported 按登记并集）。注入式 clock 支撑过期/重放语义测试。
- `src/host/external-mcp/server.ts`：受保护 Streamable HTTP 传输入口。官方 SDK 1.32.2 公开 `StreamableHTTPServerTransport`（实际核实导出：Node 包装类，`handleRequest(req,res,parsedBody?)`，`req.auth?: AuthInfo` 透传至工具回调 `extra.authInfo`；stateful 模式单实例单会话，故按 `mcp-session-id` 会话注册表承载多客户端，未知会话 404、无会话 GET/DELETE 400）；路径白名单仅 RFC 9728（根+`/mcp` 后缀形态）/8414 发现、`/authorize`（只产 pending）、`/token`（form）、`/approve`、`/mcp`，白名单外一律 404、路径存在方法不允许 405；Bearer 中间件：缺头/无效/过期/错 audience/错 issuer/已撤销→401（含 `resource_metadata` 挑战）、scope 不足→403、每 principal 固定窗口超限→429（Retry-After）、**URL 携带 token 一律 400 拒绝**（含并发合法 Authorization 头）；`/approve` 管理面守卫镜像主 Host 约定（Host 须 127.0.0.1/localhost+准确端口、Origin 白名单）另加常量时间管理令牌比较；S3a 工具面仅 `ping`（回显核验 principal/scope，证明 Bearer 上下文贯通至工具回调）；`close()` 级联会话与 HTTPS server。`createOauth(origin)` 在实际绑定后以准确 origin 构造 issuer/resource。
- `src/host/external-mcp/README.md`：部署/接入说明（受保护 HTTPS 入口、预注册客户端、token audience、路径白名单、管理面批准流、密钥治理、实际公网另授权、refresh token/会话配额/审计外发未含项）。
- 边界检查零修改：`scripts/check-agent-session-boundary.mjs` 的 SDK 单入口规则仅约束 Pi 系包（`@earendil-works/pi-*`），MCP SDK 导入与 `extensions/connectors/trade-area-mcp/server.ts` 既有先例一致，交接预设的"精确 documented 例外"条件未触发。

**SDK server transport 实际导出核实**（node_modules 实读，非凭记忆）：`@modelcontextprotocol/sdk@1.32.2` `dist/esm/server/streamableHttp.js` 导出 `StreamableHTTPServerTransport`（`@hono/node-server` 包装 web-standard transport；options 含 `sessionIdGenerator`/`onsessioninitialized`/`enableJsonResponse`）；`server/auth` 全量 router 依赖 express（本项目未装、不可新增依赖）→ OAuth 按设计净新自实现，MCP 协议层用 SDK 公开 transport+`McpServer.registerTool`（与 trade-area-mcp 同模式）；`shared/protocol.d.ts` `RequestHandlerExtra.authInfo` 存在，`StreamableHTTPClientTransport` 支持 `requestInit.headers`+自定义 `fetch`。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段哨兵行为错误，非导入/环境错误）：`red/s3a-oauth-red.log`（exit=1，16/16 失败）、`red/s3a-server-red.log`（exit=1，8/8 失败）、`red/s3a-combined-red.log`（exit=1，24 tests 0 pass 24 fail，全部 `external_mcp_oauth_unimplemented`/`external_mcp_server_unimplemented`）。
- GREEN：终版代码 `node --test tests/external-mcp-oauth.test.ts tests/external-mcp-server.test.ts` → 24/24 PASS 连跑 2 次（`green/s3a-combined-green.log`、`green/s3a-combined-green-rerun.log`，各约 0.4s）。
- 检查：`npm run check:agent-sessions` PASS（`green/s3a-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s3a-build-green.log`）。
- 相邻域回归（零共享接缝改动下的 sanity）：`tests/service-connection-oauth.test.ts`+`tests/trade-area-mcp.test.ts` 32/32 PASS（`green/s3a-regression-oauth-tradearea-green.log`）。

**关键负例覆盖（对应交接清单）**：错误 audience 令牌（oauth 层 `audience_mismatch`＋server 层 401 invalid_token）、过期/无效签名 401、scope 不足 403、超限 429+Retry-After；URL token 400 拒绝且并发合法头仍拒；未预注册客户端、redirect 非精确（后缀/参数/换端口/外域）拒绝；PKCE 错 verifier/超短 verifier/plain/S512/缺 challenge 拒绝；公共授权参数（approve/consent/decision/prompt）不产生 code、伪造 code 换令牌 invalid_grant；机密客户端错/缺 secret 拒绝、公共客户端带 secret 拒绝；code 重放 invalid_grant 并撤销原令牌、无关令牌不牵连；过期 code/令牌（注入 clock）；错 issuer/他资源 audience/篡改 payload/异密钥/坏格式令牌拒绝；RFC 9728/8414 元数据 resource/authorization_servers/端点/S256 准确；白名单外 404（含 /api/projects、/api/settings、/favicon.ico）、GET /token 405、裸 TLS 路径穿越 `/token/../mcp` 不落白名单内容；管理面守卫：裸 socket 伪造 Host（attacker.example.invalid）、伪造 Origin（https://attacker.example.invalid）、缺/错管理令牌全部 403，正确 loopback+令牌才批准；**标准 MCP 客户端（StreamableHTTPClientTransport+undici 自签 TLS fetch+Bearer）完成 initialize→tools/list→tools/call ping 闭环**，ping 回显核验 principal 与 scope，tools 仅 `ping`（S3b 业务工具未混入）。

**失败/跳过/未验证项**：

- S3a 未验证（明确不在本轮范围）：真实公网/域名/网关部署与实号执行者接入（E08/部署切片）、资产/work 业务工具与精确交集（S3b）、大文件分片（S3b）、refresh token 轮换与审计外发（E07）、会话数量配额（部署切片）、多实例共享状态（部署架构决定）。
- 工程实现取舍（如实记录）：访问令牌为 HMAC 对称签名（密钥受信管理面注入），生产若需非对称/JWKS 另按部署授权实施；令牌/授权码/pending 为进程内存态，多实例部署需共享存储（当前单实例运行前提与主 Host 一致）；集成测试自签证书经 openssl CLI 生成（仅测试期，macOS/Linux 标准工具，非新增 npm 依赖）。
- 兼容回退：净新模块，零既有文件改动；不开放端口、不复制资产、不部署（spec §7）；主 Host API 与 localhost/Origin 管理面守卫不受影响；S3b 接入资产/work 工具时经同一 Bearer/白名单，不动传输层契约。

## 范围外发现（记录并继续原任务）

- `conclusion-review-handoff` CNR-A4 在干净基线 `7decc3b`（未含本变更）即失败（隔离 9/10），判定为既有问题，与 Issue #155 无关。按工程规范第3节范围管理记录于此，不在本单修复；建议另开返工项核实。`service-connection-manager` 一例隔离复跑 29/29，属全量负载抖动。两者均保留原结论，不改写为通过。
- `ServiceConnectionStore.#locked`（`service-connection-store.ts`）在锁 EEXIST→`#regular(this.lockPath)` 检查窗口未允许锁恰被释放（未传 allowMissing），并发争用时以 `unsafe_service_storage` 瞬态失败——与 S1 已在 `external-work-store.ts` 修复的同一竞态模式。S2 并发派发测试实际复现（60 轮扫描定位，A/B 双方均可能误判 rejected/unknown）。该文件不在本单允许修改路径内，本切片仅在外派派发侧加有界瞬态重试容错，未改 store；前台 `#call` 在高并发下理论上同样可触发。建议另开返工项对齐 S1 的锁窗口语义后再移除派发侧重试。


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
- [~] E03 受保护资产/工作 MCP、OAuth/精确交集/只读/错误与分片边界 —— S3a 切片完成（OAuth 2.1 授权/资源服务器＋受保护 Streamable HTTP 传输入口＋自签 TLS 闭环）；S3b 切片完成（资产只读交集＋asset.*/work.* 工具接入 S3a 服务器）；真实 Studio/原实例资格装配属 E07
- [~] E04 字节保全/ExternalDeliveryRef、原 owner 指纹/providedContext/非用户原话、busy/重启/暂停/取消/迟到、Agent 核验/原工具保存 —— S4a 切片完成（交付字节保全：分块上传＋manifest 校验＋原子宿主保存＋独立 ExternalDeliveryRef；迟到不变式回并台账单一来源）；S4b 切片完成（同 owner 续接调度＋指纹/providedContext 外派身份扩展＋busy 待处理/重启回读/持久暂停/停止路由设暂停/cancelWork 外部停止待核）；markSettled 实时接线、收件→续接真实装配与 pause/cancel HTTP 入口属 E06/E07，Agent 核验工具接线属 E07
- [~] E05 WorkBuddy 可选适配工程合同（默认未验证禁用）—— S5 切片完成（配置状态机＋联合测试启用门槛＋官方本机 API 薄适配＋message_id 游标归属＋3 次触发额度＋串行占用＋dispatch mode 门槛；全部合成 transport/台账验证）；实号联合验证属 E08，设置路由/UI 接线属 E06
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

### S3b（E03，2026-11-28）：资产只读精确交集 + asset.*/work.* 工具接入 S3a 服务器

**本轮交付**（接 S3a 传输与 S1 台账；不接主 Host server.ts/UI；真实 Studio 装配与大文件宿主字节保全明确留后续——前者属 E07，后者属 S4）：

- `src/host/external-mcp/intersection.ts`：资产只读交集裁定 `createAssetIntersection`。每次 authorize 同时核对：服务端核验 principal（S3a authInfo，自报一律拒绝）∩ 有效 grant（窗口期内、与 work 绑定一致）∩ 有效 work/claim（当前 revision、active、租约未过期、epoch 准确）∩ 显式企业（经 qualify 回调核 enterprise 归属；`legacy-no-enterprise`/`enterprise-mismatch` 分别拒绝——旧项目无企业/legacy 默认放行不外露）∩ 工作资产精确 allowlist（authority/id 逐字、version 逐字、hash 逐字；`version_required`/`version_missing`/`hash_required`/`hash_mismatch`/`not_allowlisted` 各自明确，绝不落 latest）∩ 原项目/Studio 当前资格（注入 `qualify` 接缝：revoked/missing/hash-mismatch 分别拒绝）。目录范围请求对整个 allowlist 逐一核资格；精确读取核该 ref。未知工作与未领取同样按 `external_asset_no_claim` 裸拒绝，不给元信息或正文。`recheck()` 供异步读取后/返回前复核——撤销/取消不返回迟到正文。共享导出：`verifiedPrincipal`（只认 authInfo.principal/clientId）、`assertArgsSize`（单请求参数 ≤1MiB）、`denialResult`（拒绝信封只含 denied/message，不携带正文或额外元信息）。
- `src/host/external-mcp/asset-tools.ts`：只读工具 `asset.catalog/read/read-source/trace`（不含 reason/pack-read/写图/修订/发布/任意代码 SQL；合法读取不逐条审批，交集自动裁定）。catalog 仅返回 allowlist 命中条目（reader 故意超范围返回亦被过滤，不先泄露后筛选；hash 不符条目显式标 `hash-conflict` 不回退）；read 按精确 ref 返回并支持 ≤512KiB 分页（`offset/bytes`，越界/超限明确拒绝，`nextOffset` 分页收据）；read-source 返回准确片段+locator（片段 ≤512KiB）；trace 关系仅在已授权 refs 范围内展开（范围外目标返回前丢弃）。每工具：authorize → 读取 → 内容 hash 对 allowlist 复核 → recheck → 返回准确 authority/id/version/hash/来源/限制；读取回执固定声明「只证交付内容与范围，不证专业正确」。`OriginalAssetReader` 为包注入收窄读取接缝（代表原实例 createSemanticContextReadPort/studio.port analysisOnly；本轮合成实现，真实装配属 E07）。
- `src/host/external-mcp/work-tools.ts`：`work.read/claim/renew/release/deliver` 接 S1 store CAS。work.read 只列当前核验 principal 被明确允许（allowedExecutors∩授权窗口∩authorized）的工作与非敏感说明（不含其他 Task/企业目录，不暴露他人 principal）。work.claim：仅对已发布且无未核外部动作（unknown publication 待核即拒，核定后恢复）的准确 workId/revision 原子领取（revision 显式旧版拒绝）；`args.principal` 永不作身份，台账只记核验 principal（自报身份负例实测）。work.renew/release：核当前领取者（非所有者 `external_work_claim_not_owned`）/epoch/授权/时效；过期事实先持久化再报 `external_claim_expired`；release 回执注明不证明真实操作结束。work.deliver：核当前领取/输入工作版本（旧 revision 领取在修订晋升后失效）/manifest（规范化 sha256 内容承诺，path 排序序无关）；幂等键同内容回原收据、异内容 `external_delivery_conflict`；assetsUsed 逐 ref 对 grant allowlist 复核（越范围拒绝）；旧 epoch/工作撤销后的历史已授权身份（同一核验 principal）经公开 `mutate` CAS 提交隔离迟到证据（`late:true`、完整复刻台账不变式、不覆盖当前交付、不恢复资产资格），其他 principal 借历史 claimId 保存材料一律拒绝。限额（spec §8）：参数 ≤1MiB、manifest ≤256KiB、≤20 文件/累计 100MiB/单文件 ≤50MiB；路径仅逻辑名（拒绝绝对路径/`..`/反斜杠/盘符/控制字符，Host 分配存储路径属后续切片）；文件对象带 `url` 一律拒绝（不从任意 URL 下载）；facts 必报（done/notDone/failed/unknown），缺件/pending 永不标保全——本轮 preservation 恒为 `pending`，大文件分块宿主保全属 S4。
- `src/host/external-mcp/types.ts`：最小扩展 `ExternalMcpDenied`（code+status 拒绝语义类型）。`server.ts` 零改动：工具经 S3a 预留的 `registerTools` 注入缝注册，自动处于同一 Bearer/路径白名单/限流/管理面守卫之下（S3a 默认工具面仍仅 `ping`，其既有测试不改即绿即证）。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段哨兵行为错误，非导入/环境错误）：`red/s3b-combined-red.log`（exit=1，26 tests 0 pass 26 fail，全部 `external_mcp_intersection_unimplemented`/`external_mcp_asset_tools_unimplemented`/`external_mcp_work_tools_unimplemented`）。
- GREEN：终版代码 `node --test tests/external-mcp-asset.test.ts tests/external-mcp-work.test.ts` → 26/26 PASS 连跑 2 次（`green/s3b-combined-green.log`、`green/s3b-combined-green-rerun.log`，各约 2.4s）。修复记录：两次测试侧修正（rig 时钟毫秒 vs OAuth 秒单位换算；`recordClaim` 幂等路径返回原领取导致短租约fixture未生效，先释放再建），产品代码零回改。
- 检查：`npm run check:agent-sessions` PASS（`green/s3b-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s3b-build-green.log`；首轮两处测试文件 `t.after` 回调类型错误已修，产品代码无类型错误）。
- 回归（隔离复跑全过）：S3a `tests/external-mcp-oauth.test.ts`+`tests/external-mcp-server.test.ts` 24/24（`green/s3b-regression-s3a-green.log`）；S1/S2 store/dispatch/publish/inbox 52/52（`green/s3b-regression-s1s2-green.log`）；相邻域 trade-area-mcp+service-connection-oauth 32/32（`green/s3b-regression-neighbor-green.log`）。

**关键负例覆盖（对应交接清单）**：工具面恰为只读白名单九个，`asset.reason`/`asset.pack-read`/写图/发布/SQL 等未知工具一律拒绝（资产只读，合法读取无逐条审批）；未领取/错 principal（含拿他人 claimId）→ `external_asset_no_claim` 裸拒绝且响应不含正文或额外元信息；跨 allowlist/越 trace（范围外目标丢弃不泄露）/越目录（catalog 过滤超范围条目）/越分页（offset 越界拒绝）；错版（`version_missing`）、缺版本（`version_required`）、缺 hash（`hash_required`）、hash 不符（allowlist 与 reader 内容两侧）、reader 内容 hash 失配均明确拒绝且不落 latest；撤回（cancelWork 后即时读取与异步读取后 recheck 均拒，迟到正文不返回）；grant 过期/租约过期/claim 释放/错 epoch 分别明确；legacy 无企业与企业不匹配分别拒绝（legacy 默认放行不外露）；work.read 只列被允许工作、他 Task/企业不出现在目录；并发 claim 恰一胜者、同 principal 幂等回原收据、未发布/待核 unknown publication/取消/过期授权/越集合 principal/自报身份（台账实证记核验 principal）拒绝；renew/release 错 epoch/非所有者拒绝、过期事实先持久化、release 不证明结束、释放后可再领取（epoch 递增）；deliver 同键同文回原收据/异文冲突、错 epoch/非所有者/旧 revision 失效拒绝、21 文件/单文件>50MiB/累计>100MiB/manifest>256KiB/路径穿越（`../`、绝对路径、反斜杠、盘符）/任意 URL/facts 缺失/assetsUsed 越范围全部拒绝、缺件 preservation=pending 永不标保全、旧 epoch 迟到证据隔离（late=true、不覆盖当前交付、claim 不复活、他人不可借 claimId 保存）；标准 MCP 客户端经 S3a 自签 TLS+OAuth 2.1+Bearer 全流程调用 asset/work 工具闭环（合成 reader/store/qualify，不触真实网络/凭据）。

**失败/跳过/未验证项**：

- S3b 未验证（明确不在本轮范围）：真实 Studio/原实例资格装配（`qualify`/`OriginalAssetReader` 本轮为注入接缝，真实装配属 E07）、大文件分块上传与宿主字节保全（S4，本轮 deliver 仅台账引用且 preservation=pending）、分片临时文件 24h 清理（S4）、主 Host server.ts 与 UI 接线（后续切片）、真实公网部署与实号执行者（E08）、实际删除/写图等写路径（不存在——工具面未含任何写工具，非“拒绝实现”而是“不外露”）。
- 工程实现取舍（如实记录）：迟到隔离证据经 store 公开 `mutate` CAS 落账（S1 store 文件本切片冻结不改，其 `recordDelivery` 当前领取语义保持原样；late 路径在 work-tools 内完整复刻台账不变式——引用完整/幂等键唯一/容量上限，随 store 演进需回并）；read 分页按 UTF-16 码元切片、字节预算在实切片复核（多字节字符页内不越限，跨页切点在 E07 真实装配时按原工具上限复核）；拒绝信封统一 `{denied, message}`，正文级断言由测试保证。
- 兼容回退：`ExternalWorkStore`/S3a 传输与 OAuth 语义零改动；新增工具经 `registerTools` 注入缝挂接，缺省服务器工具面不变（S3a 测试不改即绿）；ledger 新增 late 交付记录沿用 schema:1 严格解析，旧记录与旧行为不受影响。

### S4a（E04，2026-11-28）：交付字节保全——分块上传、manifest 校验、原子宿主保存与独立 ExternalDeliveryRef

**本轮交付**（接 S1 台账与 S3a/S3b 注入缝；不接主 Host server.ts/UI，不动 native `ProjectTaskResultBinding` 语义，不接真实 GitHub blob 装配；续接/指纹/暂停/取消/Agent 核验属 S4b）：

- `src/host/external-delivery.ts`：`ExternalDeliveryPreservation` 保全服务（Host 分配存储路径＝`dataRoot/external-delivery/`：`staging/<uploadId>/{meta.json,chunks/*}`、`d/<commitId>/<逻辑路径>`；0700 目录/0600 文件/O_NOFOLLOW，惰性建目录）。
  - 分块上传：`beginFile`（逻辑路径校验、单文件 ≤50MiB、同 claim 累计在途 ≤100MiB、同文件同内容回原 uploadId/异内容 `external_delivery_upload_conflict`）→ `writeChunk`（原始片段 ≤512KiB、偏移 512KiB 对齐、末片恰为余量；每次写前核当前领取/授权（grant 窗口先于租约：授权失效最优先拒绝，租约过期 `external_claim_expired`）；同偏移同内容回原收据、声明/实际不符或既有内容不同一律 `external_delivery_chunk_conflict`；会话内串行化）。base64 单请求 ≤1MiB（工具层 `assertArgsSize`）。
  - manifest 校验（共享实现 `validateDeliveryManifest`）：manifest/正文 ≤256KiB、≤20 文件/累计 ≤100MiB/单文件 ≤50MiB（与原工具上限取低），超限明确拒绝；canonical manifestHash 按 path 排序（restricted 模式与 S3b work.deliver 完全同构同哈希）。extended 模式每条目恰一来源：`uploadId`（分块字节）｜`blob`（精确 GitHub blob：repo 必须等于 grant 授权仓库 stableId，否则 `external_delivery_blob_out_of_scope`；commit 必须完整 40-hex sha，分支别名 `external_delivery_blob_commit_invalid`；经注入 `readGithubBlob` 接缝读取并核 hash——未配置接缝/读取失败降级 link-only（"仅链接/待保全"），hash 不符记 failed `blob_hash_mismatch`）｜`link`（外部 http(s) 链接，只登记绝不下载）；`url` 字段永远拒绝（`external_delivery_url_rejected`）；重复逻辑路径拒绝。facts 必报（done/notDone/failed/unknown，共享 `validateDeliveryFacts`）。
  - 提交保全语义：全量校验后才落盘（缺件/组装 hash 不符 → 记 failed `missing_pieces`/`content_hash_mismatch`，零字节落盘）；原子保存镜像 `ProjectStore.writeBoundReport`（staging tmp O_EXCL|O_NOFOLLOW 0600 → write+fsync → 目录身份核 → hardlink publish → unlink tmp → 目录 fsync → re-read observeFile 式 hash/inode/稳定性核对）；任一文件保存失败回滚本次全部链接（仅回滚仍绑定本次 staging inode 的链接，身份不确定不删）并记 failed `save_failed`（`hooks.beforeLink` 为测试/监控接缝）；成功后引用过的上传会话分片即刻清理。
  - 提交前授权复核在台账原子变体内完成（"异步保存后提交前核当前领取/授权"无 TOCTOU）：`recordPreservedDelivery` 核 claim active+epoch+grant 窗口，失效即不可标完整——保存后失效则回滚字节并转隔离迟到证据（领取确已失效时）；部分上传/过期领取不可标完整；preservation 状态机 pending→preserved/failed/link-only（preserved 必须带非空 storage）。
  - 24h 清理 `cleanupExpiredStaging`：仅删除过期（meta.createdAt 或 mtime >TTL）未完成 staging 会话与 `d/` 下孤儿 `.delivery-*.tmp`；台账记录与已保全字节永不触碰；宿主周期接线属装配切片（E07）。
  - 路径安全：逻辑路径仅安全相对名（拒绝绝对路径/`..`/反斜杠/盘符/控制字符），存储路径由 Host 分配；不从任意 URL 下载。
- `src/host/external-mcp/delivery-tools.ts`：`delivery.begin`/`delivery.upload-chunk`/`delivery.commit` 经 S3a `registerTools` 注入缝注册（同一 Bearer/路径白名单/限流之下），服务端核验 principal＋`assertArgsSize`(1MiB)；收据 `kind: 'delivery-upload'/'delivery-chunk'/'external-delivery'`，commit 收据含 preservation/storage/links/late/idempotent，固定声明"收据只证已记录事实与范围"。
- `src/host/external-work-store.ts` 最小扩展（schema:1 兼容，S1 `recordDelivery` 当前领取语义原样不动）：`DeliveryPreservation` 增 `link-only`；`ExternalDeliveryRef` 增可选 `storage`/`links`/`preservationReason`（旧记录缺字段照常解析，preserved 无 storage 视为损坏）；新方法 `findDeliveryByIdempotencyKey`（幂等只读预检）、`recordPreservedDelivery`（字节保全落账＋原子授权复核）、`recordLateDelivery`（**S3b work-tools 迟到不变式回并台账单一来源**——引用完整/幂等键唯一/容量上限/active 领取必须走当前路径；work-tools 迟到分支改为委托，删除其本地复刻实现）。
- `src/host/external-mcp/work-tools.ts` 最小改造：manifest/facts/assetsUsed 校验改用共享实现（行为不变、同拒绝码）；deliver 描述更新为"manifest-only 声明路径 preservation=pending，字节保全走 delivery.*"。
- 类型：`external-work-types.ts` 增 `ExternalDeliveryStorageEntry`/`ExternalDeliveryLinkEntry`（交接清单中的"types.ts"指本文件；`external-mcp/types.ts` 无需改动）。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段哨兵行为错误，非导入/环境错误）：`red/s4a-combined-red.log`（exit=1，21 tests 0 pass 21 fail，全部 `external_delivery_preservation_unimplemented`/`external_store_preservation_unimplemented` 哨兵）。
- GREEN：`node --test tests/external-delivery.test.ts tests/external-mcp-delivery.test.ts` → 21/21 PASS 连跑 2 次（`green/s4a-combined-green.log`、`green/s4a-combined-green-rerun.log`）。修复记录：产品侧两处（`#observe` bigint/number 混比恒 false；`#saveFile` 目标路径双重 `d/`）、语义一处（writeChunk 同偏移异内容冲突优先于长度计划）、类型一处（测试 helper 返回类型），实现逻辑未削弱断言。
- 检查：`npm run check:agent-sessions` PASS（`green/s4a-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s4a-build-green.log`）。
- 回归（隔离复跑全过，零改动即绿）：S3b asset/work 26/26（`green/s4a-regression-s3b-green.log`，覆盖 work.deliver 行为不变）；S3a oauth/server 24/24（`green/s4a-regression-s3a-green.log`）；S1/S2 store/dispatch/publish/inbox 52/52（`green/s4a-regression-s1s2-green.log`，含 store 扩展 schema 兼容）。

**关键负例覆盖（对应交接清单）**：同幂等键同内容回原收据/异内容冲突（分片与提交两侧）；分片超 512KiB/单文件超 50MiB/21 文件/累计超 100MiB（同 claim 在途合计）/manifest 超 256KiB 拒绝；路径穿越（`../`、绝对、`./`、反斜杠、盘符）拒绝；字节条目带任意 URL 拒绝且 link 条目零抓取（注入 spy 证伪）；缺件/组装 hash 不符记 failed（missing_pieces/content_hash_mismatch）零字节落盘、永不标 preserved；已释放领取 commit 走隔离迟到证据（late=true、preservation=pending、无 storage、不覆盖当前交付、claim 不复活）；租约过期 commit `external_claim_expired` 拒绝、grant 过期拒绝 begin/writeChunk/commit（写前+提交前核）；原子保存失败（beforeLink 注入）回滚全部链接、`d/` 零残留、记 failed；preserved 字节重读 hash 与 manifest 一致；精确 blob 授权仓库+完整 commit 才可读、越仓库/分支别名拒绝、hash 不符 failed、无接缝降级 link-only；24h 清理清过期会话（TTL 前零清理）、保留台账与已确认交付、failed 审计元数据（preservationReason=missing_pieces）保留；store 扩展原子复核（epoch 错/领取已释放/授权过期在台账变体内拒绝）与旧账本（无新字段）原样解析；外部收据/台账记录不含 `optracall.project-report-write`/`ProjectTaskResultBinding`/`writeBoundReport`/`060_reports` 字样（不伪 native）；标准 MCP 客户端经自签 TLS+OAuth 2.1+Bearer 完成 claim→begin→chunks→commit→preserved 闭环（合成 store/时钟/blob 接缝，不触真实网络/凭据）。

**失败/跳过/未验证项**：

- S4a 未验证（明确不在本轮范围）：精确 GitHub blob 的真实读取装配（`readGithubBlob` 本轮为注入接缝，真实 GitHub 装配属 E07/E08）；清理的宿主周期触发接线（装配切片）；同 owner 续接/requestFingerprint/providedContext/busy 待处理/重启回读/暂停/取消与 Agent 核验（ReviewDecision 记录 API 在 S1 `recordReview` 已有，实际核验经 S4b 续接产生）；主 Host server.ts/UI 接线；真实公网部署与实号执行者（E08）。
- 工程实现取舍（如实记录）：commit 幂等预检先于 active/迟到分支（已受理交付重放回原收据，含领取已释放后的重试），最终一致性仍由 store 原子变体保证；已保全交付引用过的会话分片即刻清理，未引用/失败会话留待 24h TTL；分片写按会话串行化（单实例内存链，多实例部署需共享锁——当前单实例运行前提与主 Host 一致）；`hooks.beforeLink` 为注入式保存失败测试/监控接缝；保存后授权失效转迟到证据仅在领取确已失效时发生，仅 grant 过期则按 `external_grant_not_valid` 拒绝（授权失效优先于迟到）。
- 兼容回退：S1 `recordDelivery`/`recordReview` 语义零改动；ledger schema:1 严格解析增可选字段+`link-only` 状态，旧记录与旧行为不受影响（旧账本解析负例实测）；`external-delivery/` 存储树为净新目录，不影响 native 项目文件/060_reports；回退后已保全字节与台账记录保留，不重放外部动作。

### S4b（E04，2026-11-28）：同 owner 续接＋停止/暂停/取消（最小 server.ts 集成）

**本轮交付**（接 S1 台账与既有 `project-tasks` 域；不接 UI/真实 GitHub 出站/WorkBuddy；`startProjectMessage`/`completeNewDelivery` 原语义不动）：

- `src/host/external-resume.ts`（新增）：Host-only 续接调度 `createExternalResumeCoordinator`。触发=台账 InboxEvent＋preserved `ExternalDeliveryRef`；门禁依次核：work 归属（他 Task 交付 'unrelated'）→ work 未取消 → 非 late → preservation==='preserved'（link-only/failed/pending 不续接）→ grant 版本匹配且窗口有效 → `autoResumeAllowed` → 该交付无 ReviewDecision（原 Agent 已核不再派）→ 持久暂停（per-task）→ 任务未归档/配置可用（注入 taskAvailable：pair＋archived＋availableConfiguration）→ 任务空闲（注入 busy=projectSessions.busy）。派发经注入的 `startProjectMessage(projectId,taskId,input,{userText:false})` facade 发起同一 native 新 turn；输入仅含 Host 组合的已保全交付引用＋原工作/验收条件（固定前缀声明"不是用户消息、不是系统指令"），`externalContext`={workId,revision,deliveryId,deliveryHash,grantId,grantVersion}；外部文字不进输入。稳定 requestId=`resumeRequestId(workId,revision,deliveryId)`（确定性 UUID 形派生），派发前经 `recordResumeReceipt` 持久预留；重复事件/重启后已 accepted/settled 一律跳过；重启时 reserved/unknown 先经注入 `nativeStatus`（=priorTaskRequest 只读回读）归一化——terminal→'settled'、running/interrupted→'accepted'、读不到（session_history_unavailable）保持待处理 'native_status_unknown' 不盲派；可证明未受理（native 无标记）才以**同一 requestId** 重派，绝不换 ID。忙→待处理＋单任务有界空闲重试（默认 30s，可注入 schedule）；每次扫描至多派一 turn。`scanAll`（启动扫描 listResumeTargets）、`notifyEvent`（收件接线缝，真实 inbox 装配属 E07）、`markSettled`（本切片未接线）。合成注入点：store/startMessage/busy/taskAvailable/nativeStatus/时钟/schedule。
- `src/host/external-work-store.ts` 最小扩展（schema:1 可选键，旧台账缺键照常解析——实测旧格式回读负例）：新增可选 `resumePauses`（per-task 单条 upsert：`pauseResume/resumeResume/getResumePause/listResumePauses`）、`stopRequests`（`ExternalStopRequestRecord`，per-work 稳定 stopRequestId 幂等，转移表 requested→confirmed/unknown/failed/unsupported、unknown→confirmed/failed，终态不可改）、`transitionResumeReceipt`（reserved→accepted/settled/unknown；accepted→settled/unknown；unknown→accepted/settled；settled 终态；同状态幂等，违例 409）、`listResumeTargets`（inboxEvents 去重 owner）。容量计数含新表。
- `src/host/external-dispatch.ts`：`cancelWork` 升级为"撤资格＋外部停止请求待核"。先 `store.cancelWork`（撤销有效领取，S1 语义不变），再按 per-work 稳定身份落 `stopRequest` 账（先于出站）；注入 `requestExternalStop` seam 时调用并如实落 confirmed/unknown（seam 抛错→'unknown'，不假报已停止；无 seam→'unsupported'）；终态记录不再重发；返回 `{work, stopRequest}`。
- `src/host/server.ts` 最小集成（既有消费者行为不变）：`requestFingerprint` 增可选 `externalContext`（严格校验，非法 400 invalid_external_context；有外派身份时以 `['optracall_request_external_dispatch_v1', identity, externalContext]` 包裹参与 sha256，无外派输入指纹与旧行为逐字节一致）；`providedContext` 增可选 `external` receipt（kind:'external-delivery'）且 `userQuoteEligible = origin.userText && externalContext===undefined`（外派身份恒不取得用户原话资格）；Host 装配 store＋coordinator（facade 注入真实 startProjectMessage、busy/taskAvailable/nativeStatus seam、unref 定时器），`ready` 内 `store.init()` 后 fire-and-forget `scanAll()`（不阻塞请求就绪）；公共 stop 路由（非 cleanupRequestId 分支）在既有 stop＋feature stops 后持久 `pauseResume('task-stop')`，旧 cleanupRequestId 迟到分支（stopped:false）不触碰暂停字段。
- `src/agent/project-runtime.ts`／`src/agent/project-session.ts` 各一行增列：`ProvidedContextInput` 增可选 `external` 字段、native started 标记 providedContext 白名单透传 `external`（交接清单未列这两个文件；spec §12 授权"src/agent 的任务端口与工具/上下文交付"，且交接目标"providedContext 增可选 external receipt"必须经此持久化路径才可观察；纯加列，不动既有字段语义）。
- **`completeNewDelivery` 零改动**：仅消费原 Agent 原生声明（`declare_analysis_delivery`）；外部收件/保全回执不伪 native delivery、不自动触发 Case 请求回应（集成实测：续接 turn 完成后台账 `listReviews` 恒空，Host 不代核验；AB12/AB13 边界）。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段哨兵行为错误，非导入/环境错误；首轮 host RED 曾因测试漏 `mkdtemp` 导入重取）：`red/s4b-unit-red.log`（exit=1，9/9 失败，`external_resume_unimplemented`/`external_store_pause_unimplemented`/`external_store_stop_request_unimplemented`）、`red/s4b-host-red.log`（exit=1，2/2 失败，同哨兵）。
- GREEN：`node --test tests/external-resume.test.ts tests/external-resume-host.test.ts` → 11/11 PASS（`green/s4b-combined-green.log`，~7s；单元单独 `green/s4b-unit-green.log` 9/9、集成单独 `green/s4b-host-green.log` 2/2）。迭代记录：测试侧修正四处（duplicate 事件 skipped 计数按事件数=2；过期 grant 改为窗口内种交付后推进时钟；restart 用例断言对象改为"扫描按 FIFO 重派首个 reserved-未受理预留、requestId 逐字复用"；gate 用例的 availability/pause 改单向切换防解锁既往场景；missing `await`），产品侧一处（事件同戳排序去掉 eventKey 字典序 tie-break，改稳定 FIFO）。
- 检查：`npm run check:agent-sessions` PASS（`green/s4b-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s4b-build-green.log`；两处测试类型修正：`Set<string>`、`Awaited<ReturnType<startTestHost>>`）。
- 回归（隔离复跑全过）：核心 `agent-sessions`＋`project-history`＋`service-connection-host` 33/33（`green/s4b-regression-core-green.log`）；消息流 `analysis-delivery-host`＋`project-task-assignments-v13` 9/9（`green/s4b-regression-messaging-green.log`，覆盖 startProjectMessage/providedContext 既有语义）；任务流 `project-task-chat-results`＋`project-task-lifecycle-v020` 17/17（`green/s4b-regression-taskflow-green.log`，覆盖消息与 stop 流）；外派 S1–S4a 十文件 123/123（`green/s4b-regression-external-family-green.log`，含 store schema 兼容与 dispatch cancelWork 既有负例）。

**关键负例覆盖（对应交接清单）**：原 Task 忙→待处理不派发且零预留、空闲＋授权有效→恰一次同 Task 新 turn、稳定 requestId 重复事件不重跑（重复扫描/重启协调器双重验证）；指纹含准确 work/revision/delivery/hash/grant（externalContext 严格校验、非法 400）、同名文本不同外派身份不去重（集成：同 requestId 同文本无 externalContext→409 operation_conflict，同身份重放→deduplicated）、无外派输入指纹与旧一致（消息流回归 9/9 不变）；`userQuoteEligible=false`（origin.userText=false 且集成实测 native 标记持久值 false）、originalUserText=Host 引用非外部原文；重启 accepted 未知→先回读（completed→settled/running→accepted/读不到→native_status_unknown 不派）、未受理预留以同一 requestId 重派；配置不可用/归档→待处理；stop 暂停自动续接（持久，重启后仍不派、零 turn）；旧 cleanup 迟到请求 stopped:false 且零暂停写入；cancelWork 撤领取＋停止请求落账（unsupported/confirmed/unknown/抛错→unknown，不假报已停止、终态不重发）；迟到交付不复活（'late' 恒待处理）；他 Task 交付不唤醒（'unrelated'）；已核交付不再派（'already_reviewed'）；取消外派零复活（'work_cancelled'）。

**失败/跳过/未验证项**：

- 未接线（明确不在本切片）：`markSettled` 的 run.settled 实时接线（restart 回读已覆盖 settled 归一化）；收件→续接的真实 `ExternalInbox→notifyEvent` 装配与 grant→subscription Host 装配（E07）；pause/resume 与 cancelWork 的 HTTP 入口（E06 UI）；Case 绑定任务的续接回归（本切片合成任务无 Case 绑定；Case 注入 caseContext 的既有路径未改动）；真实 GitHub/模型（E07/E08）。
- 边界备注（如实记录）：`src/agent/project-runtime.ts`/`project-session.ts` 各一行加列在交接允许路径清单之外，依据 spec §12 "src/agent 的任务端口与工具/上下文交付" 与交接目标"providedContext 增可选 external receipt"的持久化必要性；纯加列，`git diff` 可独立复核。忙→重试定时器默认 30s（服务策略可配属装配切片）；每扫描至多派一 turn，多交付按 FIFO 排队。
- 兼容回退：新台账键全部可选、旧 ledger 逐字节解析负例实测；指纹无外派输入逐字节不变；`cancelWork` 返回形状由 `ExternalWork` 扩为 `{work, stopRequest}`（既有调用点均不消费返回值，S1/S2 测试不改即绿）；回退后暂停/停止请求/预留记录保留，不重放外部动作。

### S5（E05，2026-11-28）：WorkBuddy 可选适配工程合同——默认未验证禁用、触发额度与串行占用

**本轮交付**（接 S1 台账与 S2 发布锚点；不接 UI/真实 WorkBuddy/网络/凭据；实号联合验证明确属 E08）：

- `src/host/workbuddy-adapter.ts`（新增）：`WorkBuddyAdapter`（每连接一实例）。配置状态机：`ensureConfig` 幂等注册（connection 派生稳定 configId，默认 `integration_unverified` 禁用）；`recordSingleTest` 仅记录 API/在线或 Connector 单项事实（`settingsView` 供 E06 设置分区展示核心/可选分别状态，含 quota limit 3）；单项通过（含两项齐备）永不置 `ready`——`ready` 恒等于联合测试事实（台账 parse 强制该不变式，`ready=true` 且 joint≠passed 视为 corrupt）。`runJointTest(harness)`：五阶段（触发→领取→资产读取→work.deliver 交回→原 Task 核验）经注入接缝逐段独立确认，全过才 `markWorkBuddyJointTest('passed')` 置就绪（工程用隔离合成供应商模拟闭环，证据标 `synthetic-vendor-simulation`；实号属 E08），任一阶段失败记 failed 并保持禁用。`trigger(workId, revision)`：门槛依序=就绪配置→work/grant 存在→GitHub succeeded issue-create 锚点（触发消息定位信息）→合成消息凭据扫描→台账原子预留（幂等/额度/串行门禁）→GET localassistant 在线事实（明确离线→`rejected/assistant_offline`，不占额、不发消息）→POST message(msg_type text)→成功须带 message_id（缺失降级 unknown）→明确拒绝/回执丢失如实落账。触发消息仅由持久记录（目标/范围/禁做/交付标准/资产定位 refs/仓库#Issue/MCP 入口）合成，不接受自由文本；内置令牌形状扫描＋注入 `credentialValues` 精确值卫（Host 记忆的凭据），命中 `external_workbuddy_secret_rejected` 且不落 attempt 不出站。`readReplies()`：经 transport 增量读账号消息历史（GET message?message_id 游标）；归属仅认精确 `wb-correlation:<workId>@<revision>` 标记且该 work/revision 在本连接有记录的触发尝试（message_id 仅游标/回执，不据其后消息/时间邻近/最近触发判归属）；claim/delivery 证据仅当引用身份在台账准确存在且绑定同 work/revision 才升级；不可关联消息只回 messageId，正文不返回、不进台账（事务正文零落账负例实测）；消息永不替代 work.deliver、不产生交付/核验记录；游标仅整批成功后推进，读失败原地（同窗口重读）。`quotaUsed(grantId)` 供快照/设置展示。
- `src/host/external-work-store.ts` 最小扩展（schema:1 可选键，旧台账缺键照常解析——旧格式回读负例保留）：`workbuddyConfigs`（每连接一条：apiOnline/connector/joint 三事实＋派生 ready 不变量＋jointEvidence/replyCursor）与 `executorAttempts`（稳定 attemptId、grant 绑定校验、bodyHash 同文幂等/异文冲突、message_id 可选回执、submissionProcess 支持重启外来 submitted→unknown 归一化）。方法：config 注册/单项/联合/游标/读取；`recordExecutorAttempt` 原子门禁=work/revision/grant 绑定校验→取消拒绝→非 rejected 同 (work,revision) 幂等回原 attempt→每 grant 非 rejected 尝试 ≥3 拒 `external_workbuddy_quota_exhausted`（submitted/UNKNOWN/succeeded 占额、跨 turn/revision 不重置）→同连接另一工作处于执行阶段拒 `external_workbuddy_serial_occupied`（不占额、不落记录）；`transitionExecutorAttempt` 转移表守卫（prepared→submitted/rejected；submitted→succeeded/rejected/unknown；unknown 仅 reconciled 可核定；succeeded 必须 message_id，缺失 `external_workbuddy_result_required` 由调用方降级 unknown）；`getWorkBuddyActiveExecution(connection)` 只读串行占用视图（在途 prepared/submitted/unknown→有效领取→已触发未闭环[该 revision 无交付+核验、grant 有效期内]；取消/闭环/授权到期释放；候选工作自身推进下一 revision 不算跨工作占用——"一项工作"以 workId 为界）。parse 完整性：configId/connection 唯一、ready 不变量、attempt 唯一/悬挂引用/grant 绑定不符/同 (work,revision) 双非 rejected 全部 corrupt。
- `src/host/external-dispatch.ts` 最小扩展：可选注入 `workbuddy` 端口＋`triggerWorkBuddy(projectId, taskId, input)` mode 选用门槛——未注入 `external_workbuddy_unconfigured`（纯 GitHub 路径零影响）、受限 profile 拒绝、跨 owner 404，就绪/额度/串行由适配器合同执行。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段哨兵行为错误，非导入/环境错误）：`red/s5-workbuddy-red.log`（exit=1，16 tests 0 pass 16 fail，全部 `external_workbuddy_unimplemented`/`external_store_workbuddy_unimplemented`）。
- GREEN：`node --test tests/external-workbuddy.test.ts` → 16/16 PASS 连跑 2 次（`green/s5-combined-green.log`、`green/s5-combined-green-rerun.log`）。迭代记录：测试侧修正三处（内部任务负例改用已注入适配器的 dispatch 以越过未配置前置门禁验证 404；串行释放用例先经 reconciled 只读核定 A 的 UNKNOWN 再闭环；jointHarness overrides 类型 `Partial<WorkBuddyJointTestHarness>`），产品侧零回改、断言未削弱。
- 检查：`npm run check:agent-sessions` PASS（`green/s5-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s5-build-green.log`）。
- 回归（隔离复跑全过）：S1+S2 store/dispatch/publish/inbox 52/52（`green/s5-regression-s1s2-green.log`）；S4b resume/host＋service-connection-host 12/12（`green/s5-regression-s4b-green.log`）；外派家族其余 delivery/mcp×4/home-external-waiting/host-dispatch 85/85（`green/s5-regression-external-family-green.log`）；核心 agent-sessions+project-history 32/32（`green/s5-regression-core-green.log`）。

**关键负例覆盖（对应交接清单）**：默认 `integration_unverified` 禁用（未注册/已注册均拒触发，零出站）；API/在线单项、Connector 单项、两项齐备均不足以启用；联合闭环失败保持禁用、全过才就绪且触发 E2E 打通；台账 ready 不变量损坏 corrupt、旧格式（无新键）照常解析；纯 GitHub 授权/发布与内部选择在适配已就绪时仍零 WB 调用/零 attempt/零额度，内部任务不申请外派授权（无 work 404）；3 次额度含修订（r1/r2/r3）、UNKNOWN 占额（同 revision 重发回原 attempt 零二次 POST）、超限拒绝、新 adapter 实例（重启/新 turn）不重置；明确拒绝（离线 assistant_offline）不占额、恢复后同 revision 新 attempt 可触发；串行——第二项工作 serial_occupied 拒绝、零二次 POST、零 attempt 记录、quota 不动，占用视图准确；首项 UNKNOWN 在途不释放（B 二次拒绝），仅 reconciled 只读核定后闭环（claim→deliver→review→release）才释放，取消立即释放；转移表守卫（prepared 不可直接 succeeded、expectedStatus 冲突、unknown 非 reconciled 拒、succeeded 缺 message_id 拒、终态不可改）；attempt 记录悬挂引用/grant 绑定不符/同键双开 corrupt；message_id 仅游标——相邻未标记消息不错误归属、错误 workId/未触发 revision 不归属、正文不进台账字节级验证；claim/delivery 证据仅准确核对升级、伪造 delivery 引用不产生交付/核验记录；游标整批成功推进、读失败原地同窗重读；离线/失败不静默重派、UNKNOWN 不自动第二条（重启后同 attempt）、纯 GitHub 同工作 issue-comment 不受影响；dispatch mode 门槛四负例＋就绪正例；触发消息逐字段定位断言（marker/仓库#Issue/MCP 入口/目标/标准/资产 ref、msg_type text）且零令牌形状，业务文本夹带令牌形状/Host 记忆凭据值均出站前拒绝（不落 attempt、零 POST、零额度）。

**失败/跳过/未验证项**：

- S5 未验证（明确不在本轮范围）：真实 WorkBuddy API/实号联合验证（E08——真实账号 OAuth、在线助手、Connector、真实闭环全部 NOT_RUN，不因工程模拟闭环冒已联通）；server.ts 设置路由与 UI 展示（E06 用 `settingsView`/`quotaUsed` 接线）；permission_response 工具审批载荷（官方未实测字段，未实现）；串行占用的跨进程并发压测（单实例文件锁语义沿用台账既有模式）；触发消息长度与官方字段超限行为的真实边界（以 200k 上限防御，实号另核）。
- 工程实现取舍（如实记录）：额度门禁计入 prepared（进程崩溃残留的 prepared 保守占额占串行，避免并发双发；重启仅归一化外来 submitted）；`runJointTest` 仅在台账记联合事实与证据标记，合成工单/资产数据由 Host 装配方建立（本切片测试内存内构造，不落真实业务台账）；占位候选工作自身豁免跨工作串行门禁（"一项工作"以 workId 为界，修订晋升在真实流程先经核验闭环）。
- 兼容回退：新台账键全部可选、旧 ledger 逐字节解析负例实测；S1–S4b 全部既有语义零改动（52+12+85+32 隔离复跑全过）；`ExternalDispatch` 构造参数纯增列（未注入时行为与旧一致，S1/S2 测试不改即绿）；回退后配置事实/触发尝试（含 UNKNOWN/拒绝）保留，不重放外部动作。

### S6a（E06，2026-11-28）：外派 UI——Host 路由＋客户端＋任务视图核心组件

**候选 `89015b0f234ebf547ae2f44fbf2261602abaf870`**（子代理达轮限，主 Agent 核实后代提交）。

- 实现：server.ts additive 路由（GET 摘要/设置、POST authorize/choose-internal/pause-resume/resume-resume/works cancel/publish）＋真实 Host 装配（memberPack profile 门、studio.enterpriseScope.sourceAllowed 资产资格、WorkBuddy 未配置 transport 诚实拒绝 503）。前端 `external-dispatch-client.ts`＋`TaskWorkModeCard.tsx`（工作方式卡）＋`ExternalDispatchDrawer.tsx`（授权抽屉 540px）＋`ExternalWorkPanel.tsx`（外部协作页＋台账时间线＋三个边界）＋`external-dispatch.css`（生产令牌）。App.tsx 增「外部协作」页签＋右栏工作方式卡＋抽屉挂载。
- RED→GREEN：`tests/external-dispatch-ui.test.ts` 21/21 PASS（抽屉 grant 组合/缺企业仓库阻断、工作卡/双状态格/时间线/边界/回执、取消 amber 确认、暂停/恢复、状态色系不虚构成功）。`npm run check:agent-sessions` PASS；`npm run build` PASS（tsc＋frontend）。证据 `evidence/implementation/{red,green}/s6a-*`。
- **真实产品同视口对照（主会话亲自，隔离合成实例 dataRoot=/tmp/oc155-uitest，dist 构建候选 89015b0，Pi 1.4.0，合成模型配置不发消息）**：首页、任务视图（外部协作页签）、工作方式卡、授权抽屉、外部协作页（未外派＋已外派）1440 亮、已外派 1440 暗、390 单列。与冻结 Demo 逐项核对：页签/工作方式卡双按钮/抽屉字段（业务目标/片段/接单方式WB禁用/执行者/仓库/资产/期限/确切内容快照/三按钮）/工作卡双状态格/台账时间线/三个边界/工单回执一致；真实数据差异如实呈现——无 GitHub 绑定时抽屉 amber 提示先连接、无资产时显示未提供（不伪造 Demo 内容）。390 无横向溢出、暗色可读。截图 `evidence/implementation/product/p01–p08b`。
- 未验证/留后续：交付与验收页、资产依据页、设置外派分区、Case/项目任务行摘要（S6b）；已外派状态用 store 播种合成台账记录渲染（Issue#42/claim epoch 真实台账）；真实 GitHub 出站/实号 E07/E08。

### S6b（E06，2026-11-28）：交付/资产/设置/Case 行摘要 UI + 只读路由

- 实现（接 S6a 路由与台账，全部 additive）：
  - **交付与验收页** `ExternalDeliveryPanel.tsx`：核验表（检查项/外部交付声明/原任务核验状态，行由交付 `facts` 的 done/notDone/failed/unknown 逐条组成——done 行随 ReviewDecision 映射已验证/需补充/未通过/待核验，unknown 恒 UNKNOWN·amber、notDone 恒未验证、failed 红）；附件 manifest（每条 storage 已保存字节/字节数/sha256、link-only 仅链接·未保全·不冒充字节已验、preserved/failed/link-only/pending 总体保全陈述＋`preservationReason`、清单承诺 manifestHash 与本机核对状态）；迟交红色隔离警示；旧交付保留可查（虚线框＋展开身份/保全/核验/回传时间）；Agent 验收结论卡（原任务判断 pill＋最近 ReviewDecision 理由；接受后 [提交资产候选][继续原任务] 均回原任务，注明候选沿原流程、本页不产生正式资产）；右栏交付声明实际引用（assetsUsed 去重）＋[查看资产取用]。空态诚实（尚未取得可验收的交付/尚未授权外派）。
  - **资产依据页** `ExternalAssetAccessPanel.tsx`：获准资产表（authority/id/准确版本/出处/范围，来自 grant 精确 allowlist）；版本详情＋hash＋"绝不静默回退 latest"；实际引用记录（交付声明引用＋"读取回执只证交付内容与范围，不证专业正确或实际采用"；空态"资产被列出不等于已经读取或采用"）；入口与可用性卡（接 `/api/external-dispatch/settings` 真实事实——受保护入口本切片未挂载如实显示 amber）；失败保留说明卡。
  - **设置分区** `ExternalDispatchSettings.tsx`：基础路径卡（GitHub/资产与工作 MCP/资源默认 1work·24h/通用联合测试 四行＋真实状态 pill）与可选适配卡（API/在线、Connector、联合测试 三行＋3 次触发额度说明；未验证恒"禁用"，不搬 Demo 模拟按钮、不显示已启用假象；核心未配置不阻断内部任务注记）。挂入 `ServiceConnectionsSettings` 服务网格之后（additive，四服务连接行为零改动）。
  - **Case 行摘要** `DailyCaseProjects.tsx`：任务行下浅紫 inset（左边框 accent＋accent-soft 底）「本 Task 外部协作 · {真实台账状态} · 独立外派工作台账 · 不改人的待回应/轮次」；数据经新只读项目级 summaries 路由按真实 task 身份匹配，仅注入当前 Case 范围已渲染的行，共享项目其他 Case/未绑定任务不带入；CaseBoard 四页签不变。
  - **入口** `ExternalWorkPanel.tsx` 工作卡 actions 增 [查看交付与验收][查看资产取用]；App.tsx 任务面板类型扩为 chat/report/external/delivery/assets 并挂载两页（资产页 onOpenSettings → 连接设置视图）。
  - **server.ts 只读路由**（additive，GET only，owner 绑定）：`GET .../external-dispatch/deliveries`（每 work：publications/active claim/grant 视图/deliveries（含 storage/links/preservation）/reviews）、`GET .../external-dispatch/assets`（每 work：grant allowlist＋交付声明 references）、`GET /api/projects/:pid/external-dispatch/summaries`（每任务 works 摘要，项目不存在 404）。台账事实零写入。
- RED→GREEN：`tests/external-delivery-ui.test.ts` 13/13 PASS（连跑 2 次；抽屉/卡片 S6a 测试合并复跑 34/34）。RED（桩阶段哨兵，11 个行为失败，非导入/环境错误）：`evidence/implementation/red/s6b-red.log`；GREEN：`green/s6b-combined-green.log`、`green/s6b-combined-green-rerun.log`。覆盖：路由只读（POST 404、重复 GET 同值、错误项目 404）、按严格 schema 直接播种 ledger 后交付/资产视图逐字段（preserved 字节/hash/链接/missing_pieces/两个 review/claim/principal/Issue#42）、设置真实事实（disconnected/未挂载/未验证/额度 3）、客户端 GET 路径与 owner 拒绝、核验表四类事实、manifest 保全/仅链接/旧交付、迟交隔离、结论卡双按钮、资产 allowlist/hash/引用/入口卡/空态、设置分区（未验证禁用、无模拟按钮、verified 绿 pill）、Case 行 inset 仅绑定行（其他 Case 任务不进表）。
- 检查：`check:agent-sessions` PASS；`npm run build` PASS（tsc＋frontend；三处测试外类型修正：claim.status 用 ClaimStatus、设置 tone 含 red）。
- 回归（隔离复跑全过）：S6a dispatch UI 34/34（`green/s6b-regression-s6a-green.log`）、service-connections-ui 13/13＋service-connection-runtime 12/12（`green/s6b-regression-settings-green.log`/`-sc-runtime-green.log`）、case daily UI＋navigation model 12/12（`green/s6b-regression-case-green.log`）、外派家族 store/dispatch/publish/inbox/resume/host/workbuddy 79/79（`green/s6b-regression-external-family-green.log`）、agent-sessions 32/32（`green/s6b-regression-agent-sessions-green.log`）。
- 组件与冻结映射对应：交付核验表/manifest/实际引用/Agent 结论/旧交付 ↔ Demo #delivery（08/22/25/23 号截图状态）；资产表/版本详情/读取记录/入口可用性/失败保留 ↔ Demo #assets（09 号）；设置基础路径/可选适配分区 ↔ Demo #setup（10/13 号；模拟按钮不入生产）；Case 行浅紫 inset ↔ Demo 30 号截图；入口链接 ↔ Demo #work 工作卡 actions。production 令牌沿 daily-workspace 体系；表格容器滚动（min-width＋overflow-x）无页面横溢；亮暗沿用既有 token 变体。
- 未验证/留后续：真实产品同视口对照（主会话亲自，G01 门禁）；真实读取回执落库（S3b 回执在 MCP 工具结果内，台账尚无持久读取记录，页面以交付声明引用＋固定免责陈述呈现，不伪造读取记录）；原文预览（需原实例读取装配，属 E07，页 face 展示准确版本/hash 定位而非正文副本）；资产候选提交后端（沿原任务流程，本页仅导航）；设置分区无 WorkBuddy 联测发起入口（工程合同由 Host 侧执行，E08 实号另核）。

### S7（E07，2026-11-29）：端到端核心闭环＋main 整合

**候选 `e099c775129aabdd831ce02957683b9633a4cc60`**（主会话亲自实现，实现子代理因账户 5h 配额 429 暂不可用）。

- `tests/external-e2e-closed-loop.test.ts`（2 用例）：通用外部 MCP 客户端经真实自签 TLS＋OAuth/PKCE＋预注册 Bearer 完成完整闭环——`work.claim`（认证 principal 原子单领取）→ `asset.read`（交集下准确版本/hash）→ `delivery.begin/upload-chunk/commit`（分块保全 manifest/hash，preserved）→ 模拟只读收件 recordInboxEvent → `createExternalResumeCoordinator.notifyEvent` 同 Task 续接（断言仅一次 turn、`origin.userText:false`、externalContext 含准确 workId/revision/deliveryId/hash/grantVersion、重复 notify 不重跑）→ `recordReview accept`（独立 ReviewDecision）→ 断言 ExternalDeliveryRef 不含 sessionId/toolCallId（不伪 native ProjectTaskResultBinding）。负例：未领取 principal 读资产拒绝、manifest hash 不符不标保全。
- 结果：2/2 PASS；`npm run build` PASS。集成中修正测试自身三处形状假设（denial 载荷经 isError＋message 而非 structuredContent、read.sha256 直取、delivery 无 kind 字段），产品零回改。
- **main 整合**：合并 origin/main `418a8f8`（merge commit `baeed726`），含 #156 Decision Case 观察/日常工作流恢复（修复既有 CNR-A4）、#157 连接存储竞态修复（正是 S2 范围外记录的锁竞态）、#159 工程规范 v1.18。冲突仅 ServiceConnections.tsx import 行（main 移除未用 `serviceScopeLabels`，我侧同未用），按 main＋保留 ExternalDispatchSettings 导入解决；App.tsx/server.ts/project-session.ts 自动合并。重读 v1.18 确认现行领取/独立复核/PR 门禁与 v1.17 一致（停用旧 Qoder→Codex 移交模式不影响本会话直接领取实施）。
- 全量 `npm run check`：见后续记录（含 CNR-A4 已随 main 修复、闭环新增）。
- **全量 `npm run check` 实跑结果（2026-11-29，候选 `dccef32`）：3884 测试 / 3773 PASS / 0 FAIL / 111 skipped；CNR-A4 全过；`check:agent-sessions` PASS；`npm run build` PASS（Trial build dccef32）。退出码 0。** 日志 `/tmp/oc155-fullcheck.log`（本机持久）。至此整合候选（E01–E07＋UI＋闭环＋main）完整通过。

## 范围外发现（记录并继续原任务）
- `conclusion-review-handoff` CNR-A4 在干净基线 `7decc3b`（未含本变更）即失败（隔离 9/10），判定为既有问题，与 Issue #155 无关。按工程规范第3节范围管理记录于此，不在本单修复；建议另开返工项核实。`service-connection-manager` 一例隔离复跑 29/29，属全量负载抖动。两者均保留原结论，不改写为通过。
- `ServiceConnectionStore.#locked`（`service-connection-store.ts`）在锁 EEXIST→`#regular(this.lockPath)` 检查窗口未允许锁恰被释放（未传 allowMissing），并发争用时以 `unsafe_service_storage` 瞬态失败——与 S1 已在 `external-work-store.ts` 修复的同一竞态模式。S2 并发派发测试实际复现（60 轮扫描定位，A/B 双方均可能误判 rejected/unknown）。该文件不在本单允许修改路径内，本切片仅在外派派发侧加有界瞬态重试容错，未改 store；前台 `#call` 在高并发下理论上同样可触发。建议另开返工项对齐 S1 的锁窗口语义后再移除派发侧重试。

## main 整合对范围外发现的消解（2026-11-29）
- CNR-A4：经合并 main `418a8f8`（#156）后随 main 修复，不再阻断全量 check；原基线失败事实保留于上文，不追溯改写。
- 连接存储竞态：经合并 main `418a8f8`（#157）官方修复，S2 派发侧的有界瞬态重试容错保留为兼容防御（不改变既有前台行为）；原范围外记录保留，不再建议另开返工项（已由 main 处理）。


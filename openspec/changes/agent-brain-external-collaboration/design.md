# D01 · 最小接口 / 持久化 / 回退设计（E01–E07）

2026-11-28 · Qoder · 依据冻结 spec v0.3、[main-alignment](main-alignment.md)、[reuse-audit](reuse-audit.md) 与后端接缝实测核对。Interface v3 · Pi 1.4.0 · MCP SDK 1.32.2 不动。

## 0 复用与新增边界（四原则核对）

| 能力 | 复用既有 | 新增最小 |
| --- | --- | --- |
| 会话/续接 | `project-tasks` 域、`startProjectMessage(...,{userText:false})`（project-plan-host.ts:202 模式）、`requestFingerprint`、`providedContext`、`completeNewDelivery` 仅消费原 Agent 声明 | 外派收件→空闲续接的 Host-only 调度；指纹/providedContext 补外派身份 |
| GitHub 通信 | `ServiceConnectionManager.port().call`（issue_write/add_issue_comment）、prepared→submitted→unknown→reconciled 日志、`enforceGithubRepository` | work-revision 级发布操作身份（跨 turn/重启去重）；Host-only 发布入口（不伪造前台 tool context）；只读收件适配 |
| 资产读取 | `createSemanticContextReadPort`、`studio.port({analysisOnly:true})`、`SemanticContextService.query` 精确版本/hash、企业资格 | 远端只读薄适配＋强制工作授权交集（每次目录/正文/分页/trace 复核） |
| 文件保全 | `ProjectStore.writeBoundReport` 原子 staging+hardlink+hash、50MiB 上限 | 独立 `ExternalDeliveryRef`＋分块上传/manifest（不伪 native `ProjectTaskResultBinding`） |
| 持久化 | `ServiceConnectionStore` 原子 JSON＋lock＋version CAS＋unknown 日志模式 | `dataRoot/external-work/` 新 store |
| 远端 MCP/OAuth | SDK 1.32.2 公开 server transport；localhost/Origin 守卫约定 | Streamable HTTP 受保护入口＋OAuth 2.1 资源服务器（净新，无既有 AS） |
| WorkBuddy | 官方本机 API 合同（integration-research） | 可选适配薄层＋integration_unverified 门槛＋3 次额度/串行 |

不建第二 Runtime、全局模型队列、第二正式资产库。Host 管身份/权限/持久/原子裁定；Agent 管方法/核验/接受。

## 1 持久记录权威（`src/host/external-work-store.ts`）

单文件 `dataRoot/external-work/ledger.json`，0700 目录/0600 文件，`O_NOFOLLOW`，tmp+rename+dir fsync，`.store.lock` inode 校验，`#mutate(state, expectedVersion)` CAS，严格 `schema:1` 解析，启动把外来进程 `submitted` 标 `unknown`。容量上限沿用 64MiB/10000 操作量级。

记录（均绑定真实 `projectId/taskId`，与 Case `assignment.issue` 身份分离）：

- `WorkGrant`：grantId/version、目标/片段/禁做、允许执行者集合、仓库稳定 ID+可见性、精确资产 refs（authority/id/version/hash）、显式企业、有效期、资源策略快照（1work/24h，较低优先；WB 选用才叠 3 次）、自动续接/真实动作约束、源任务约定/Case/输入身份。
- `ExternalWork`：稳定 workId、revision（修订保留旧版）、owner、固定内容/摘要、交付标准、输入/资产版本、目标执行者、grant 引用、状态机。
- `PublicationAttempt`：每 work revision＋动作类型的稳定 operationId、确切出站正文 hash、ServiceOperation 引用、GitHub 仓库/Issue 稳定 ID、succeeded/rejected/unknown。
- `ExecutorAttempt`（仅 WB）：稳定触发身份、message_id、submitted/unknown、占额。
- `Claim`：认证 principal、claimId/epoch、服务端租约到期、当前 revision、释放/撤销/过期原因；同 work revision 至多一个有效领取（CAS）。
- `ExternalDeliveryRef`：deliveryId/版本、幂等键、work/claim 身份、manifest＋保全状态、实际资产读取回执、已做/未做/失败/未知、迟到标记。
- `ReviewDecision`：原 Agent 接受/需补充/拒绝＋理由＋准确 delivery hash。
- `InboxEvent`/`ResumeReceipt`：事件唯一键、同步游标、待处理交付、稳定 resume requestId、native accepted/settled。

状态机分离保存：发布/触发/领取/访问/交付/核验各自事实，不靠单一“成功”字段。旧数据无外派字段按旧行为读取（兼容）。

## 2 owner-bound 外派 port（`src/host/external-dispatch.ts`）

Host 静态构造，注入窄业务 facade（不暴露 domain/凭据/任意 sessionFile/workspace）：

- `summarize(projectId,taskId)` → 只读外派摘要（供 Task 卡/项目行/Case 行）。
- `chooseInternal(projectId,taskId)` → 记录意图，零外部动作；已有外派须先核取消/在途（不静默切回）。
- `authorize(projectId,taskId,grantInput)` → 校验执行者/仓库/资产∩原资格/期限/资源→持久 WorkGrant＋ExternalWork(revision 1)；取消零动作。
- `publish(workId,revision)` → Host-only 发布入口（§3）。
- `pauseResume / resumeResume(projectId,taskId)`、`cancelWork(workId)`（§5）。
- 远端工作面（§4）：`workRead/claim/renew/release/deliver`，认证 principal 由服务端核验。

受限 profile（protected/fixed-draft/source-reader/受限会员包/专属 workspace）拒绝外派授权（沿 server.ts:782 限制）。

## 3 GitHub 发布与 UNKNOWN（E02）

- 发布前先持久预留 `PublicationAttempt(workId,revision,action)` 唯一 operationId＋正文 hash，再经 `ServiceConnectionManager` 调用 `issue_write`/`add_issue_comment`。
- **Host-only 发布入口**：manager 增 `dispatchOperation(binding, {workId,revision,action,bodyHash}, hostContext)`，operationId 由 work-revision 派生（非前台 toolCall），复用 prepared→submitted→unknown 日志与 `enforceGithubRepository`；不伪造 sessionId/toolCallId 借用前台 port（spec§5/reuse§5）。
- 同 work revision 跨工具编号/turn/重启重复请求→回原 attempt；响应丢失→unknown，仅只读核对准确仓库/作者/关联标识/正文版本，唯一匹配才关联，多匹配冲突，查不到仍 unknown，不盲重发。
- 收件：Host-only 只读适配，受限轮询（默认 60s，退避/Retry-After），仅读获准仓库/Issue，保存去重事件后推进游标；停止/换号/失权停拉。不伪造前台 port，不重放外部写。

## 4 受保护远端 MCP（E03，`src/host/external-mcp/`）

- SDK 1.32.2 `McpServer`＋Streamable HTTP server transport，独立受保护 HTTPS 入口（工程隔离用自签 TLS 测试）；仅暴露必要 MCP/元数据/认证路径，保留 localhost/Origin 管理面守卫，不转发整 Host API。
- OAuth 2.1 资源服务器：RFC9728 资源元数据、PKCE、准确 redirect/resource/audience/issuer、逐请求 Bearer 校验；过期/无效 401、权限不足 403、超限 429；预注册客户端（覆盖 WB Connector 兼容），不依赖 DCR，不接受令牌透传/URL token。客户端登记/首配在本地受信管理面。
- 两组能力面：
  - 资产只读：`asset.catalog/read/read-source/trace`（白名单子集，不含 reason/pack-read/写图/发布）。每次目录/正文/来源/trace/分页核：可信 principal ∩ 有效 grant ∩ 有效 work/claim epoch ∩ 显式企业 ∩ 资产 allowlist ∩ 原项目/Studio 当前资格 ∩ 准确 authority/id/version/hash；异步返回/下一片前复核；未领取只给工作说明不给资产；legacy 默认放行不外露。
  - 工作记录：`work.read/claim/renew/release/deliver`（§1 CAS）。claim 原子单领取；deliver 幂等键同内容回原收据/异内容冲突；旧 epoch 迟到隔离。
- 大文件分块：单请求参数≤1MiB、原始片段≤512KiB、单交付≤20 文件/100MiB、manifest/正文≤256KiB；与原工具/供应商上限取低；分片/结束/提交幂等收据，写前及异步保存后提交前核当前领取/授权；路径 Host 分配，不接受任意路径/URL 下载；未完成 24h 清理临时分片保留审计。

## 5 续接 / 停止 / 取消（E04，§9）

- 交付到达→可信关联 InboxEvent；原 Task 空闲/未暂停/未归档/授权有效/配置可用→`startProjectMessage(projectId,taskId,{text:交付引用+原验收条件,...},{userText:false})`。忙→保留待处理；稳定 resume requestId 派发前持久预留；重启先回读 accepted/native，accepted 未知不自动换 ID 重跑。
- `requestFingerprint` 增外派身份数组（workId/revision/deliveryId/hash/grantVersion）；`providedContext` 增 external receipt，`userQuoteEligible:false`，外部文字不冒用户原话/系统指令。
- `completeNewDelivery` 仅消费原 Agent 合法声明成果；外部回执不伪 native delivery、不自动触发 Case 请求回应。
- “停止本轮”沿原公共 stop＋持久暂停该 Task 外派自动续接；“取消外派”撤新领取/访问资格＋发明确操作身份取消请求（平台支持时）＋等外部确认；未知→停止待核，不超时盲重派。旧 cleanup 迟到保护覆盖新暂停字段。
- 租约默认 15min、每 5min 续租、受 grant 到期约束（服务策略可配）。

## 6 WorkBuddy 可选适配（E05，`src/host/workbuddy-adapter.ts`）

默认 `integration_unverified` 禁用。启用门槛：具体配置真实 API→同 MCP 领取/查读→回交→原 Task 核验联合测试通过（E08 实号另核）；工程合同用隔离供应商模拟验证。官方本机 API（GET/POST localassistant）薄适配；message_id 仅游标/触发回执，不判归属；同连接串行（一项已触发/领取，其余等待）；3 次 API 触发含修订、submitted/UNKNOWN 占额、跨 turn/revision 不重置；纯 GitHub 零 WB 调用/额度。不承诺开机/唤醒/启动退出应用/多设备路由/云任务。

## 7 UI（E06）

沿 [ui-implementation-mapping.md](ui-implementation-mapping.md)：TaskWorkModeCard、ExternalDispatchDrawer、ExternalWorkPanel、ExternalDeliveryPanel、ExternalAssetAccessPanel、设置外派分区、Case/项目任务行只读摘要。生产令牌沿 daily-workspace.css；不搬原型设施。1440/1024/390 亮暗/键盘/焦点/无横溢。

## 8 迁移与回退

- 新增 store/字段均为可选业务记录；旧项目/会话/native/草稿/文件原位不动，缺旧字段保留未知。
- 回退兼容代码读取最新资料，不恢复旧副本覆盖新工作；外部操作/UNKNOWN/文件保留不重放。
- 远端入口/部署为运行前提，工程交付服务端＋接入说明＋隔离 TLS/OAuth/MCP 检查；实际公网/设备另授权。

## 9 切片与 TDD 负例（先 RED 后最小 GREEN）

| 切片 | 内容 | 关键反例（先失败） |
| --- | --- | --- |
| S1=E01 | store＋grant＋internal/external choice＋port | CAS 竞争/重启 unknown 保留；内部/取消零 Issue/触发/增权；受限 profile 拒绝；资产∩原资格 |
| S2=E02 | Host-only 发布＋UNKNOWN 核对＋claim 台账 | 跨 turn/重启重复发布只一次；UNKNOWN 不盲重发；并发 claim 仅一成功；错 epoch/自报身份拒绝 |
| S3=E03 | 远端 MCP＋OAuth＋资产只读交集＋分片 | 错 audience/过期 401、越权 403、超限 429；未领取/跨企业/越目录/错版拒绝；reason/写图拒绝；路径穿越/任意 URL 拒绝 |
| S4=E04 | 交付保全＋续接＋stop/pause/cancel＋迟到 | 同键异文冲突；busy 待处理；重启 accepted 未知不重跑；指纹含外派身份；userText=false；迟到隔离不复活 |
| S5=E05 | WB 合同＋禁用门槛＋额度/串行 | 默认禁用；单项不足启用；纯 GitHub 零额度；串行排队不占额；UNKNOWN 占额不重置 |
| S6=E06 | UI 组件＋集成＋响应式 | 三路径可体验；同视口对照；键盘/焦点；原消费者回归 |
| S7=E07 | 隔离 Host/Pi/标准 MCP/TLS/OAuth/模拟 GitHub 核心闭环＋非作者复核 | 端到端真实路径；三冻结基准逐项矩阵 |

允许修改路径按 spec§12：`src/host`（外派/收件/设置/MCP/资产只读薄适配）、`src/agent`（任务端口/工具/上下文）、受影响 `extensions/business-plugins` 查询接缝、`tests`、最小边界脚本及说明。新模块明确 owner。
# Agent 大脑外部协作：复用与责任边界核对

2026-11-27；设计依据为产品源码 `main@4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`、讨论稿 `41264eb5c584c1cf4e09c532e8842823a870c469`。
本记录为只读架构核对及实施约束，不表示产品代码、外部账号、官方 API 或远端服务已完成运行验收。
规则来源：[工程规范四原则及 IN01–IN07](../../../docs/engineering-workflow.md)、[统一会话接入](../../../docs/agent-session-integration.md)；本变更的需求、授权及验收以同目录 spec 为准。

## 1. 已确认范围

- 首期采用通用外派协议，完整衔接 GitHub 工单、资产远端 MCP、交付、原任务核验及续接。
- 首个执行者适配采用 WorkBuddy 官方本机助手 API；不做云任务，不将第三方平台默认视为已能自动接单。
- 一次确认任务目标、外派范围、执行者及资产权限后，原 Agent 在授权内自主派单、跟进、核验及返工。
- 资产保留实际 OptraCall 运行端，仅经受保护入口供获准工作查询；该实例须在线。
- 新增的是业务工作记录、通信适配和环境治理，不是新 Agent Runtime、第二会话管理器或 Host 业务推理流程。

## 2. 已核实的复用入口

| 入口 | 已有能力与本变更接缝 |
| --- | --- |
| `src/host/agent-sessions.ts:5,12,82,85` | Interface v3、owner Ref、turn、公共占用/取消/关闭及代际保护；内部运行继续经公共域。 |
| `src/host/server.ts:710` | `projectSessions` 的真实 project/task owner、绑定配置、profile、权限指纹及 Host 准入。 |
| `src/host/server.ts:2579,2783` | `startProjectMessage` 的原任务接入、请求去重、accepted 后后台完成投影；结果就绪续接可沿此业务入口。 |
| `src/host/service-connection-manager.ts:361,365` | owner 绑定 port、已核验账号/任务绑定、工具目录/仓库范围、调用前后的当前资格核对。 |
| `src/host/service-connection-manager.ts:400` | 现有写操作身份按 project/task/request/toolCall 生成；仍须补外派 work revision 级跨 turn 去重。 |
| `src/host/service-connection-store.ts:125,315,347` | 原子存储、重启后 submitted→unknown、同原 request 的未知提交去重、带证据的 reconciled 状态转移。 |
| `src/host/semantic-context-service.ts:70,95,111` | 原语义 reader、来源权限钩子、准确版本、hash 冲突、来源停用及 owner 核对。 |
| `src/host/studio-enterprise-catalog.ts:128,158` | 企业合格目录、原来源归属和发布资格；远端必须在此之前增加严格工作授权。 |
| `src/host/semantic-context-port.ts` | `createSemanticContextReadPort` 的能力收窄思路；不是可直接对外复用的身份凭据。 |
| `src/host/project-files.ts:15,48` | 原 owner 的文件读取、准确内容核对及正式报告保存入口。 |
| `src/host/project-task-results-types.ts:7`、`project-task-result-sources.ts:96` | 报告引用来自真实原生历史保存收据；不能拿外部回执伪造同类绑定。 |

`package.json` 当前声明官方 Pi `1.4.0`、MCP SDK `1.32.2`；本变更保持精确版本，不升级、改包或改写 SDK 内部对象。
公开 MCP server 注册形态可参考 `extensions/connectors/trade-area-mcp/server.ts`；该 stdio 示例不证明远端 HTTP、认证及网络部署已完成。
内部 Agent 仍使用 Pi 的模型、工具调用、历史、恢复和上下文能力；外部执行者不要求采用 Pi。

## 3. 新增最小业务权威

以下是业务记录，不能承担另一个 opening/operation/代际 Map、SDK 资源状态或全局 Agent 运行队列：

| 记录 | 最少含义 |
| --- | --- |
| `ExternalWork` | 稳定 workId/revision；真实 projectId/taskId；固定工作说明、输入版本/hash、验收标准、执行边界及授权引用。 |
| `WorkGrant` | 经确认的执行者、GitHub 仓库/动作、可披露材料、准确资产集合、有效期及预算/副作用范围；服务端核验，不由模型自报权限。 |
| `PublicationAttempt` | work revision 的稳定提交身份、正文 hash、现有 ServiceOperation 引用、GitHub 准确对象及已知/未知结果。 |
| `ExecutorAttempt` | WorkBuddy 本机提交的独立稳定身份、官方返回的准确任务引用、提交/查询/取消回执；不能由 Issue 创建成功推断执行者已启动。 |
| `Claim` | 认证 principal、claimId/epoch、服务端租约期限、领取/释放/撤销；同工作版本最多一个有效领取。 |
| `ExternalDeliveryRef` | claim/工作/交付版本、产物和证据引用、实际资产版本/读取收据、已做/未做/失败/未知事项及迟到/冲突状态。 |
| `ReviewDecision` | 原任务 Agent 的接受、需补充或不接受及理由；与交付保存、实际动作结果和经营效果分开。 |
| `Inbox/ResumeReceipt` | 外部事件唯一键、同步游标、待处理交付、稳定续接 requestId 及其原生 accepted/settled 回执。 |

Host 从原 Task 构造真实 owner，静态注入狭窄业务 port；Extension 不获得域注册、凭据解析、任意路径或跨 owner 管理资格。
外派工作是原 Task 中的具体工作，不创建新的内部 Task/owner/native session；WorkBuddy 的外部任务 ID 只作外部引用。
普通业务 port 与远端认证 principal 均不等同 `SessionRef`；持久 JSON 不能恢复或伪造内存 Ref、lease、execution 或 SessionContext。

## 4. GitHub、领取与 UNKNOWN

- Host 台账是有效领取、交付与验收状态的权威；Issue/评论承载通信和可核验线索。作者、链接或“已完成”文字不自动授予权限或接受成果。
- 发布先持久预留 workId/revision 的稳定操作身份，再经原连接器提交；同工作跨 turn/重启继续关联原尝试，不重新生成等价派单。
- 现有 ServiceOperation 的 request/toolCall 去重仅是底层保护；不能将“新 turn 新 toolCall”当成同项 UNKNOWN 可重发的依据。
- 回执丢失只读核对准确仓库、作者、非敏感关联标识及工作版本；唯一匹配才关联，多条为冲突，暂查不到仍可为 UNKNOWN。
- WorkBuddy 提交同样保留准确请求与 UNKNOWN；只用已核实的官方查询契约核对，不能凭本机在线、HTTP 成功或 GitHub 状态推断任务已执行。
- `claim/renew/release/deliver` 需认证、work revision、幂等键和原子 CAS；同键同内容返回原回执，同键不同内容拒绝。
- 推荐由同一 MCP 入口提供独立 `work.*` 能力，让 Host 原子裁定；它是工作回执写入，不授予资产修改/发布权。
- 旧 claim/epoch 的迟到交付保存为迟到证据，不覆盖当前领取或自动成为有效交付；重复供应商事件与交付均不触发重复核验。
- 租约过期、撤权或取消只改变后续有效访问/交付资格，不证明第三方进程与外部副作用已停止；未知外部动作须先核对，不能自动重派。

## 5. 后台收件和同 owner 续接

- 后台同步采用 Host-only 受限读适配：仅读获准账号、仓库和工作对象，持续核对绑定、授权与期限；不为轮询创建模型会话。
- 现有 `ServiceConnectionsPort` 需要真实运行上下文；不得伪造 sessionId/toolCallId/assertCurrent/cleanup 来满足该 port。先补内部只读契约及其验收。
- 持久保存事件后才推进游标；重启恢复只读查询和待处理记录，不自动重放 GitHub/WorkBuddy 写请求或未知模型请求。
- 就绪收件只通知原 Agent 哪些准确交付待核验；Host 不解析成业务计划，不裁定质量，也不按任务类型硬编码分析步骤。
- 经原公共域检查占用，忙则保留待处理；空闲、授权有效、原 owner 可运行时，以稳定 requestId 沿 `startProjectMessage` 续接原任务会话。
- 唤醒已 accepted 而终态未知时先查原生回执；不得自动重放。归档、暂停、配置失效或权限变化时保留待处理及原因，不换 owner/profile 绕过。
- “停止本轮”停止本机当前运行和自动续接；“取消外派”另记撤权及对外取消请求。对方未确认时展示待核对，不能宣称已强制停止。

## 6. 远端资产的严格收窄

- 每次目录、正文、原文、分页和关系展开都核验：可信身份 ∩ 有效工作/领取 ∩ 显式企业归属 ∩ grant allowlist ∩ 原项目/Studio 当前资格 ∩ 准确版本/hash。
- `studio-enterprise-catalog.ts:159` 的未建企业默认放行及 legacy 关联仅服务内部兼容；远端缺企业、缺工作授权或资格不明一律拒绝，不能外露该默认。
- `semantic-context-service.ts:95` 的可选 sourceAllowed 也不能成为远端默认：远端必须注入强制授权，并在返回前复核，目录元数据同样受限。
- `src/agent/studio.ts:7` 的 `STUDIO_READ_ACTIONS` 含 `reason` 和 `pack-read`；首期不整组暴露，只开放已确认的查找、准确读取和来源追溯子集。
- 不因 readOnlyHint 或工具命名即认定权限；首期资产查询不开放原始业务数据、脚本/Skill 分发、规则执行、资产写入或发布。
- 资产必须保留原 authority/id/version/hash、来源及限制；版本缺失/不可读/冲突明确返回，不静默切 latest；撤回后拒绝新读取，保留原历史引用。
- 已交给外部的内容不能靠撤权追回；网络入口仅为受保护传输，不能变成匿名目录、资产复制托管或第二资产权威。
- `server.ts:778` 对 protected/restricted profile 不注入四服务工具的限制保持；fixed-draft、source-reader 等不会因外派能力变成全工具会话。

## 7. 成果保存与正式资产发布

- `ExternalDeliveryRef` 独立保存远端对象/版本、观察时间、准确字节/hash及保存状态；只存链接与已保全字节须分别表示。
- 不可读取、链接失效、字节变化或保存失败不能宣称成果已保全；不得将外部文件直接伪造成原生 `ProjectTaskResultBinding`。
- 外部交付先作为原 Task 的待核验证据；原 Agent 接受后按现有文件/报告契约形成自己的正式成果，保持实际 native 来源。
- 新口径、规则、指标或方法通过原候选、核定和正式发布流程进入资产；工作接受、Issue 关闭和 MCP 读取成功均不等于资产发布或专业正确。

## 8. WorkBuddy 与官方公开边界

仅对本变更实际核实的官方本机助手 API 做薄适配；准确端点、身份/认证、请求字段、任务查询和取消能力以官方核对记录为准，不从历史 UI 调研推定。
本机 API 的地址、凭据及资源解析由 Host 管理；Agent 不提供任意服务地址、认证材料或本机路径，也不新增云任务路径。
通过官方 API 提交、查询或请求取消，不接管 WorkBuddy 进程、不注入其内部对象、不改其配置/模型，也不将其内部状态当成 OptraCall 会话生命周期。
通用协议定义工作、领取、资产访问和交付含义；WorkBuddy 适配器只映射实际已证实的能力，缺口返回明确不可用/UNKNOWN，不模拟成功或强制对方使用 Pi。
工程验证应分别报告合成协议/恢复检查、真实官方 API 接入及真实外部 Agent/资产/业务闭环；本记录仅完成设计前只读核对。

# #116 所有 Agent 对话｜合并推理过程、折叠用户长消息和已完成回复 · 实施记录

[Issue #116](https://github.com/gadfly-hbo/OptraCall/issues/116) · 基线 `e2aecfb445094245875b9696a02a273b5e0ddb44` · 任务分支 `work/qoder/issue-116-agent-chat-collapse` · 阶段二实现交付（阶段一设计与 Demo 已于 2026-11-22 获用户确认，含 D9 修订）

## 1. 交付概览

| 项 | 内容 |
| --- | --- |
| 共享呈现层 | 新增 [`src/host/ui/conversation-collapse.tsx`](../../../src/host/ui/conversation-collapse.tsx)（`groupConversation` 分组纯函数、`Foldable` 长内容折叠、`ProcessGroup` 过程组、`foldStore` 会话内折叠记忆、`AgentAuthor` 统一署名行）与 [`conversation-collapse.css`](../../../src/host/ui/conversation-collapse.css) |
| 品牌标共享 | 新增 `src/host/ui/BrandMark.tsx`（自 App.tsx 抽出，App 改为导入） |
| E1/E2 项目任务与资产建设 | `App.tsx`：`message()` 重构为 `renderConversationItem()`，按 `groupConversation` 分组渲染；过程条目进 `ProcessGroup`（步内沿用既有 `tool-message` details 标记），固化建议渲染在组外可见；用户/正文用 `Foldable`（3/5 行）；语义上下文、报告操作行、停止/失败 meta、`eb-native-context` 保留在折叠体之外；移除正文旁「调用工具 ·」平铺（已归入过程步） |
| E3 战略共创 | `StrategyDiscussionTranscript` 重写：内部 `groupConversation`，空正文 assistant 归入过程组（空白「Agent」块消失）；`AgentAuthor`（品牌标 + OptraCall + 会话模型名）；引用条外置；`StrategyDiscussionPanel` 消息过滤放宽到 `toolResult/bashExecution` 并传入 `conversationKey=discussion:<id>` 与模型名 |
| E4 业务角色 | `BusinessRoleConversation` 去掉空文本整条丢弃（改为仅滤空 user），过程事件进入共享分组；传 `conversationKey=role:<ownerKey>` 与会话模型名 |
| E5 PPT 精修 | `RefinerPage` 对话接入 `Foldable`（用户 3 行 / 回复 5 行，`conversationKey=deck:<id>`，身份按 index+who 回退）与紧凑 `AgentAuthor`；note、错误、锁定提示在折叠外；无过程数据 → 无过程组（按实际数据呈现，DeckView 无模型信息故署名行不显示模型名） |
| 折叠记忆 | `sessionStorage` `optracall.transcript-collapse.v1`，键 `会话key::消息身份`（`native:<nativeEntryId>` 优先，回退 `#index:role:hash`），FIFO 容量上限 240KiB；无 sessionStorage 环境回退内存（SSR/测试安全） |

## 2. TDD 与验证

1. **前置 RED**（`.local/issue-116/red-before.log`）：先写 [`tests/conversation-collapse.test.ts`](../../tests/conversation-collapse.test.ts) 12 项，实跑 `node --test` 检出模块缺失；其中共享转录两项（空白 Agent 块消失、品牌/过程组渲染）对基线代码为行为失败。
2. **GREEN**（`.local/issue-116/green-unit.log`）：实现后 12/12 通过——分组（混合轮、仅工具轮、多轮分段、步数计算、失败状态、custom 外置、身份区分同文异身份）、foldStore 会话隔离、Foldable/ProcessGroup 可访问渲染（aria-expanded、hidden、键盘可达）、共享转录（空白块消失、品牌署名、引用外置、流式不折叠）。
3. **既有回归**：`tests/v12-discussion-stream-projection.test.ts`（真实 Pi 双轮同文回复 + 流式投影不重复）通过（`.local/issue-116/green-v12.log`）。
4. **全量检查**：`npm run check`（agent-sessions 边界 + 3135 项测试 + build）——首轮 3023 过 / 111 跳过 / **1 失败**（`web-search-host.test.ts`：`session_history_unavailable` 409，Host 侧原生历史读取在满负载并发下超时）；该用例与本变更（纯 UI 呈现层）无调用交集，单跑 3/3 通过；全量重跑 **3135 项 / 3024 过 / 0 失败 / 111 跳过（exit 0）**（`.local/issue-116/full-test-rerun.log`），重跑后 `npm run build`（typecheck + 前端构建 + stamp）exit 0（`.local/issue-116/build.log`）。原始失败日志保留，不以绿色重跑覆盖。
5. **浏览器端到端**（`.local/issue-116/browser-verification.log`，隔离 Host + 合成 Provider + Chrome，[`tests/browser-issue116-transcript-collapse.mjs`](../../tests/browser-issue116-transcript-collapse.mjs)，运行 `node tests/browser-issue116-transcript-collapse.mjs`，需本机 playwright——仓库外隔离安装，未改锁文件）：
   - **E1**：带工具调用轮次 → 「推理过程 · 1 步」默认收起一行、展开见 `declare_analysis_delivery` 步详情；长用户消息 3 行预览折叠；已完成回复默认收起、展开后**页面 reload** 与**放大对话抽屉移动**后保持展开；折叠记忆键含 `task:<projectId>/<taskId>::`（会话隔离）；短问题全文可读无折叠控制；作者行 OptraCall。
   - **E3**：战略共创工具轮 → 空白 Agent 块为 0、过程组 1 个、品牌署名、长问题折叠、键盘 Enter 展开过程组。
   - `pageErrors === 0`。

### 入口 × 能力验证矩阵

| 入口 | 过程数据 | 流式 | 实现 | 单元/静态 | 浏览器 |
| --- | --- | --- | --- | --- | --- |
| E1 项目任务 | 完整（toolResult/bashExecution/toolCall parts） | 有（展开） | ✅ | ✅（分组+组件） | ✅（E2E） |
| E2 资产建设 | 同 E1（同一渲染路径） | 同 E1 | ✅（随 E1） | ✅（同 E1） | 随 E1（同 chatContent） |
| E3 战略共创 | 快照 SDK 投影（过滤放宽后进入） | 有（展开） | ✅ | ✅ + v12 真实投影 | ✅（E2E） |
| E4 业务角色 | 同 E3 | 同 E3 | ✅ | ✅（共享层；过滤行为变更走共享分组） | 未单独点验（与 E3 同组件同渲染路径） |
| E5 PPT 精修 | 无（仅最终回执 note） | 无 | ✅（折叠+紧凑署名+note 外置） | 类型检查（DeckView 需异步读取，SSR 不可达聊天区） | 未单独点验（Foldable 由 E1/E3 实测） |

## 3. Host 与 Agent 职责边界及复用专项最终检查

- **检查范围**：`src/host/ui/conversation-collapse.tsx`、`conversation-collapse.css`、`BrandMark.tsx`、`StrategyDiscussionReply.tsx`、`StrategyDiscussionPanel.tsx`、`BusinessRoleConversation.tsx`、`App.tsx`（转录渲染部分）、`extensions/business-plugins/ppt-refiner/ui/RefinerPage.tsx`、两个测试文件。
- **四点产品原则**：
  1. **Host 管环境**：仅呈现组织（分组、折叠、状态可见性、折叠记忆为浏览器本地 sessionStorage），不新增分析流程、步骤配额、确认门槛；不触碰会话生命周期、权限、保存与引用绑定。
  2. **Agent 自主执行**：过程内容全部来自既有已允许展示的 SDK 投影数据（工具名、命令、输出、结果状态）；不改写、不评判、不补算任何步骤。
  3. **优先复用 Pi 已有能力**：消息序列、`nativeEntryId` 身份、流式投影、markdown 渲染、`tool-message` details 标记全部复用；共享层为纯 UI 组合，无平行状态机或轮询；`check:agent-sessions` 通过；官方 Pi SDK 1.4.0 与锁文件零改动。
  4. **减少人的操作**：零新增必做操作（默认即过程一行、长文收起）；既有操作（保存、反馈、查看原回复、引用、重试、固化建议）全部保留且因外置更直达；反例核对：不自动展开历史、不以折叠移除操作、折叠记忆自动生效无需保存。
- **结论**：通过（限本次变更工程范围）。

## 4. 未验证项与回退

- **未验证项**：E4/E5 未单独浏览器点验（与已测入口共用同一组件与渲染路径，见矩阵）；真实商业模型下的呈现效果与用户产品验收（不在本授权范围，NOT_RUN）；Codex 非作者独立复核、集成最新 main、PR 实际 head CI、合并与设备更新（交回 Codex 后按授权执行）。
- **回退**：全部变更为 UI 呈现层与测试，无持久结构/接口/依赖改动；回退即还原本变更涉及文件（或 revert 合并提交），sessionStorage 键为浏览器本地临时数据，无需清理。

## 5. Codex 接收与修订（2026-11-22）

接收候选 `9cf1271ab2fc41d075d1da14f4aba5a48ba52be1`。非作者复核通过了原有 13 项针对性检查和 E1/E3 浏览器用例，并在独立浏览器验证中复现了 E2/E4/E5 的折叠、停止提示和署名缺口。原始结果保留在 [#116 接收复核记录](https://github.com/gadfly-hbo/OptraCall/issues/116#issuecomment-7081002741)。

- 过程组以首条原生过程条目的身份记忆折叠状态。跨正文配对的工具结果仍可供固化建议等外置操作使用。工具失败与停止／失败回复的状态在折叠外可见。
- 展开过程仅显示各入口既有允许展示的内容。战略共创与业务角色显示工具名称和执行状态，项目任务与资产建设保留原有工具详情。内部推理正文不进入展示。
- 预览按浏览器实际排版保留所需行数和首条表格数据。键盘焦点可进入可见内容和展开按钮。流式以及尚未读回原生身份的回复保持展开，完成后再采用消息折叠选择。
- 五个入口使用会话实际模型的署名。PPT 精修使用经过版本核对的项目或配置模型，来源不可核对时显示「模型待核对」。PPT 对话沿用原有临时列表。重进 deck 后，新的请求按其自身身份开始，前一段聊天的折叠选择不会串用。
- 修订限共享呈现、入口接线与回归。复用原会话读取、事件、模型配置和工具结果，用户按需展开，无额外必做操作。Pi SDK、权限、请求与持久结构沿用既有契约。

# #116 所有 Agent 对话｜合并推理过程、折叠用户长消息和已完成回复

[开发任务 Issue #116](https://github.com/gadfly-hbo/OptraCall/issues/116) · 基线 `e2aecfb445094245875b9696a02a273b5e0ddb44`（`origin/main`，与工单基线一致） · 任务分支 `work/qoder/issue-116-agent-chat-collapse`

## 1. 背景与目标

2026-11-22 试用反馈：多步讨论中，战略共创出现只有署名、无正文的「Agent」空块；长问题和长回复平铺后难以快速浏览；项目任务对话中每条工具结果独立成块，过程噪声淹没了业务正文。

本变更在**全部实际对话流入口**引入共享的「过程分组 + 长内容折叠」呈现逻辑：

1. **一轮过程合并一行。** 同一轮的推理／工具过程归为一个默认收起的「推理过程 · N 步」入口，展开后按顺序查看既有可展示的各步内容；空白「Agent」块消失；不同轮次各自分组；已有阶段正文保留。
2. **用户长消息按需折叠。** 实际排版超过预览区才折叠；折叠态至少保留 3 行可读正文并提供展开／收起控制；短消息全文直接可读。
3. **Agent 回复完成态默认收起。** 流式回复默认展开；真实完成的已保存回复默认收起，折叠态至少保留 5 行可读正文；支持展开与重新收起；按会话记住用户的选择。
4. **关键状态直接可见。** 错误提示、失败／停止状态、恢复操作和资料引用条放在折叠正文之外，保持可见及可操作。

当前阶段（阶段一）交付规格与可点击 Demo；用户确认设计后再实施产品 UI（阶段二）。

## 2. 对话入口盘点（工单要求的补齐核对）

以基线 `e2aecfb` 逐文件核对，区分「对话流入口」与「仅展示任务产物的页面」。

### 2.1 对话流入口（本变更覆盖）

| # | 入口 | 位置 | 现有转录渲染 | 过程数据 | 流式能力 |
| --- | --- | --- | --- | --- | --- |
| E1 | 项目任务分析对话 | [`App.tsx` L653-654](../../../src/host/ui/App.tsx#L653-L654) `chatContent`，`messagesOf` 取 user/assistant/toolResult/bashExecution/custom(display) | `message()` 自渲染：assistant 复用 `StrategyDiscussionReply` 富文本；每条 toolResult/bashExecution 独立 `<details class="tool-message">` 平铺；assistant 内 toolCall parts 显示为「调用工具 · name」；流式独立 article | 完整（工具名、命令、输出、isError、配对 toolCallId） | 有（`current.streaming`，展开渲染） |
| E2 | 资产建设 Agent（Studio） | 同 E1 渲染路径（`view === 'studio'`，[`App.tsx` L653](../../../src/host/ui/App.tsx#L653) 标题切换；`StudioPage.renderConversation` 复用 `chatContent`） | 同 E1 | 同 E1 | 同 E1 |
| E3 | 战略共创（战略选择 Agent） | [`StrategyDiscussionPanel.tsx` L382-393](../../../src/host/ui/StrategyDiscussionPanel.tsx#L382-L393) → `StrategyDiscussionTranscript` | 只保留 user/assistant 文本投影；**不滤空文本** → 只有工具／过程的 assistant 条目渲染为空「Agent」块（本次反馈问题）；资料引用 [`StrategyAttachmentEvidence`](../../../src/host/ui/StrategyDiscussionReply.tsx#L82-L93) 按回复身份绑定 | 快照含完整 SDK 投影（toolResult 等），现被滤掉 | 有（`streaming` 字符串 + `projectDiscussionStreaming`） |
| E4 | 业务角色对话（共享渲染） | [`BusinessRoleConversation.tsx` L129-134](../../../src/host/ui/BusinessRoleConversation.tsx#L129-L134) → `StrategyDiscussionTranscript`；使用者：目标管理／目标草稿（`StrategyGoalsPage.tsx` L444）、项目协作（`ProjectCollaboration.tsx` L177）、Case 事项（`CaseIssuePanel.tsx` L62）、Teach 复核（`TeachReviewPanel.tsx` L44） | `.filter(messageText(message))` **滤掉空文本** → 过程事件全部不可见 | 同 E3（快照含过程事件，现被丢弃） | 有（同 E3） |
| E5 | PPT 精修（独立插件对话） | [`RefinerPage.tsx` L267-278](../../../extensions/business-plugins/ppt-refiner/ui/RefinerPage.tsx#L267-L278) 自渲染 `chat-log` | 纯文本 `ChatMessage{who,text,note}`；note 为结果状态（已停止／未完成／已完成 · 已保存版本 vN）；错误提示在转录外顶部 | 无过程数据（仅最终回执） | 无（仅 running 状态与停止按钮） |

### 2.2 仅展示任务产物的页面（核对后不纳入）

- 需求梳理 [`RequirementPage.tsx`](../../../extensions/business-plugins/requirements-elaboration/ui/RequirementPage.tsx)：四阶段工作台 + 提案卡，无对话转录。
- 经营推演 `SimLabPage`、模型注册表 `ModelRegistryPage`、`VerificationPanel`／`AutomaticVerificationPanel`、`ConclusionReviewPanel`、`FeedbackReview`、`AgentCandidatesPanel`、`StrategySimulationPanel`、`StrategyChoicePanel`、`StudioRuleExecutionView`：均无消息转录渲染（逐文件核对无 `messages`／transcript 渲染）。

### 2.3 共享与保留边界

- E1/E2 与 E3/E4 是两套渲染路径；E5 独立。本变更新增**一个共享呈现层**（过程分组 + 折叠 + 记忆），E1–E5 全部接入；各入口保留现有的消息身份、权限、会话、持久化和原有操作（E1 的语义上下文／固化建议／报告操作、E3 的资料引用、E5 的 note 与运行控制）。
- 消息身份依据：assistant 优先 `nativeEntryId`（`presentContextMessages` 注入，见 [`context-presentation.ts`](../../../src/agent/context-presentation.ts#L5-L23)）；流式文本与旧消息无持久身份时按 §4.4 回退规则处理。

## 3. 任务目标执行清单与范围管理

- **本轮任务目标**：交付 Issue #116 阶段一——对话入口盘点、本规格与可点击 UI Demo，取得用户确认。
- **预期交付结果**：`spec.md`（本文件）与离线单文件 Demo `ui-demo/index.html`，推送任务分支并在 Issue #116 回报「设计待审」。

| 阶段 | 任务项 | 完成条件 / 对应验收 | 当前状态 |
| --- | --- | --- | --- |
| 阶段一：设计与可点击 Demo | 1.1 领取工单并核对基线 | 在 #116 留言领取并回读；基线 `e2aecfb…` 与 `origin/main` 一致 | [x] 已完成 |
| 阶段一 | 1.2 对话入口盘点 | 补齐工单未列出的实际入口，区分对话流与产物页面（§2） | [x] 已完成 |
| 阶段一 | 1.3 编写规格 | 覆盖 #116 全部验收条目与设计决定（§4–§5），明确阶段一不改产品源码 | [x] 已完成 |
| 阶段一 | 1.4 构建可点击 Demo 并浏览器点验 | 覆盖 E1/E3+E4/E5 三类渲染、合成长短消息、多步混合、流式、停止／失败、引用、窄屏宽屏与键盘展开（§7） | [x] 已完成（[点验记录](../.local/issue-116/demo-evidence/verification.md)，14 项 PASS；`.local/` 为本机证据，不入库） |
| 阶段一 | 1.5 推送分支并回报设计待审 | 远端分支读回完整 SHA，Issue #116 回执含 Demo 路径与启动命令 | [ ] 待办 |
| 阶段二：确认后实施 | 2.1 共享呈现层实现与各入口接线 | 用户确认设计后，按 RED→GREEN TDD 实现共享组件并接入 E1–E5，保留各入口原有操作 | [ ] 待确认后 |
| 阶段二 | 2.2 回归、验证矩阵与实现回执 | 覆盖 #116「实施回执」验收（入口×能力矩阵、浏览器与工程回归），交回 Codex | [ ] 待确认后 |

## 4. 设计决定

### 4.1 轮次与过程分组边界（D1）

- **轮（turn）**：从一条 user 消息（含 `originalUserText` 投影）之后、到下一条 user 消息之前的全部条目；会话首条 user 之前的过程条目归入一个前置轮。
- **过程条目**（进入「推理过程」组）：`toolResult`／`bashExecution` 消息；无正文（`messageText` 为空）的 assistant 条目；有正文 assistant 消息中的 `toolCall` parts（从正文拆出）。
- **正文条目**（不折叠进过程组）：有正文的 assistant 回复（含业务正文、错误 meta、操作行）；`custom` 且 `display === true` 的扩展消息。
- **渲染顺序**：user 消息（应用 D4 折叠）→ 该轮过程条目合并为单个「推理过程 · N 步」块（默认收起，一行）→ 正文条目按原时间顺序（各应用 D5 折叠）。轮内多段正文之间的过程按其原始位置分别归入该轮内**按正文分段的前置过程组**（分段边界：正文条目），保证「展开后按顺序看到各步」与既有阶段正文共存。

### 4.2 步数 N 的计算（D2）

一步 = 一次工具调用及其结果的配对：assistant 的一个 `toolCall` part 与其后匹配 `toolCallId` 的 `toolResult`／`bashExecution` 合并计 1 步；无配对结果的调用（运行中或中断）计 1 步；无调用配对的独立 `toolResult`（历史 bash 形态）计 1 步；无正文且无 toolCall 的 assistant 条目计 1 步。步内展示既有允许展示的摘要、工具名、结果状态和可见详情（沿用 E1 现有 `tool-message` details 展示能力），缺少可展示数据时按实际数据呈现。

### 4.3 带业务正文的中间回复（D3）

有正文的 assistant 回复不进入过程组：按正文消息正常渲染（markdown、引用、操作行），并应用与最终回复相同的 D5 折叠规则。仅此消除战略共创空白「Agent」块：无正文 assistant 全部进过程组。

### 4.4 折叠状态的身份与记忆（D4 前置：身份）

- 折叠状态以**会话内可靠消息／轮次身份**为范围：
  - 会话 key：E1/E2 `task:${projectId}/${taskId}`；E3 `discussion:${discussionId}`；E4 `role:${ownerKey}`；E5 `deck:${deckId}`。
  - 消息身份：优先 `nativeEntryId`（同会话内唯一、稳定，天然区分两个文本相同但身份不同的回复）；旧消息无 `nativeEntryId` 时回退 `${index}:${role}:${sha256(text).slice(0,12)}`（快照顺序稳定，文本相同身份不同的旧回复仍可区分）；过程组身份 = 轮内首个过程条目身份（或轮 index 回退）。
- **流式尚无持久身份**：流式回复按 D5 始终展开，不记忆、不提供折叠控制；转为已保存回复获得 `nativeEntryId` 后按默认（收起）渲染，此后用户选择才被记忆——「流式转已保存」不继承流式期间的任何中间态。
- **记忆存储**：`sessionStorage`（`optracall.transcript-collapse.v1`，JSON map：会话 key → 消息身份 → `expanded`/`collapsed`）。同会话刷新、断连重连后恢复；不同会话 key 天然隔离；过期条目按容量上限淘汰（FIFO）。切换普通／放大视图：`ConversationDrawer` 移动同一 React 子树，组件状态不卸载，选择天然保留。

### 4.5 用户长消息折叠（D4）

- 预览区：纯文本（whitespace-pre-wrap）+ 最大高度约 3 行正文行高；实际排版（`scrollHeight`）超过预览区才显示「展开」控制；未超过时全文直接可读、无控制。
- 折叠态至少 3 行可读正文（底部渐隐提示后续内容）；展开后可「收起」回到预览。用户选择按 D4.4 记忆。

### 4.6 Agent 回复折叠（D5）

- **流式回复**（E1–E4 的 streaming、E5 无）：默认展开、实时滚动，不提供折叠控制。
- **已保存完成回复**：默认收起；折叠态以完整 markdown 渲染截断到至少 5 行可读正文（含渐隐）；`scrollHeight` 未超过预览高度的短回复不显示折叠控制、全文直接可读。
- 支持「展开」与「重新收起」；用户选择按 D4.4 记忆并覆盖默认。
- **Markdown 可读预览**：预览态沿用完整 markdown 渲染（表格保留表头与首行、代码块保留前几行、长行 wrap），以高度截断保证前 5 行可读；展开态与现有渲染完全一致（回归基线：富文本、回复引用、原生回复身份和来源定位不变）。

### 4.7 关键状态外置（D6）

以下内容渲染在折叠正文之外，保持可见及可操作：错误提示（`error-notice`／`case-error`）、失败／停止状态（`stopReason === 'aborted' | 'error'` 的 meta、E5 的 note）、恢复操作（重试／核对原操作／`StrategyDiscussionRecoveryActions`）、资料引用条（`StrategyAttachmentEvidence`，仍指向同一份资料和确切回复）、E1 的报告操作行（整理为知识／经验、反馈到资产体系、带原回复核对目标）、语义上下文面板与固化建议卡、E5 的锁定与运行控制。

### 4.8 共享呈现层与各入口接线（D7）

- 新增共享组件（拟 `src/host/ui/conversation-collapse.tsx` + 配套 CSS，纯展示层）承担 D1–D6：输入消息序列 + 会话 key + 各类插槽（正文外元素、操作行、引用），输岀分组后的转录。
- E1/E2：`message()` 的过程类分支改走共享分组；保留 `tool-message` details 作为步内容渲染；保留 SemanticContextPanel、操作行、固化建议、optimistic、streaming、custom 扩展消息。
- E3：`StrategyDiscussionTranscript` 接入共享分组，移除空块来源（无正文 assistant 进组）；引用条外置保留。
- E4：去掉 `.filter(messageText)` 对过程的丢弃，交给共享分组；标题与既有状态文案保留。
- E5：`chat-log` 消息接入共享折叠（用户 ≥3 行、agent ≥5 行、note 外置）；无过程数据 → 无过程组，按实际数据呈现。

### 4.9 可访问性（D8）

折叠控制为原生 `<button>` + `aria-expanded` + `aria-controls`；过程组与消息预览可 Tab 聚焦、Enter/Space 操作；`role="log"` 结构、sr-only 标注与现有可访问性回归保留。

## 5. 验收标准（对照 Issue #116）

| 编号 | 验收维度 | 可观察结果与完成条件 |
| --- | --- | --- |
| **CC01 先交设计回执** | 阶段一 | 可点击 Demo 覆盖项目任务渲染（E1）、战略／业务角色共享渲染（E3/E4）和 PPT 精修独立渲染（E5）；使用合成短消息、长消息、混合正文与工具的多步回复、流式输出中、停止／失败和资料引用；展示窄屏、宽屏及键盘展开。以「设计待审」回报分支、完整 SHA、规格、Demo 路径／启动命令、演示结果与待确认交互。 |
| **CC02 一轮过程合并一行** | 过程分组 | 同一轮推理／工具过程归为一个默认收起的「推理过程 · N 步」入口（D1/D2）；展开后按顺序查看各步；多步、混合文本和仅工具回合均覆盖；空白「Agent」块消失；不同轮次各自分组；已有阶段正文保留（D3）。 |
| **CC03 用户长消息** | 折叠 | 实际排版超过预览区才折叠；折叠态至少 3 行可读正文 + 展开／收起控制；短消息全文直接可读（D4.5）。 |
| **CC04 Agent 回复** | 折叠 | 流式回复默认展开；真实完成后同一条已保存回复默认收起，折叠态至少 5 行可读正文；短回复直接读完；支持展开与重新收起；按会话记住选择，覆盖两个文本相同但身份不同的回复、流式转已保存、同会话刷新和重连（D4.4/D4.6）。 |
| **CC05 关键状态直接可见** | 状态外置 | 错误提示、失败／停止状态、恢复操作和资料引用条在折叠正文之外可见可操作；既有引用仍指向同一份资料和确切回复；保存、反馈、查看原回复、Markdown 渲染和可访问性回归（D6/D8）。 |
| **CC06 实施回执** | 阶段二 | 用户确认设计后，实现覆盖全部适用入口并附验证矩阵（入口×过程数据×流式能力），完成适用浏览器与工程回归，在 #116 回报实际 Agent／实例、分支、基线与候选完整 SHA、规格／Demo／测试、结果与未验证项，交回 Codex。 |

## 6. 统一会话接入（IN01–IN07）与范围边界

- **工程规范与 Interface 版本**：工程规范 v1.12，`AGENT_SESSION_INTERFACE_VERSION = 3`。本变更为 UI 展示层改造，不新增/修改会话、SDK 接入、启停/恢复、模型配置或插件接入；E1–E5 现有 owner/profile、快照来源、流式订阅（`watchStrategyDiscussion`／project events）全部沿用。
- **允许修改路径**：
  - 阶段一（当前）：仅新增 `openspec/changes/issue-116-agent-chat-collapse/spec.md` 与 `ui-demo/index.html`，不改产品源码、测试或依赖。
  - 阶段二（确认后）：`src/host/ui/`（共享呈现层新文件、`App.tsx`、`StrategyDiscussionReply.tsx`、`StrategyDiscussionPanel.tsx`、`BusinessRoleConversation.tsx` 及配套 CSS）、`extensions/business-plugins/ppt-refiner/ui/RefinerPage.tsx` 及其 CSS、`tests/` 对应回归。
- **不做事项**：不修改官方 Pi SDK 与 Semantica；不改后端 API、持久化结构或会话数据；不改变各入口消息身份、权限、引用绑定与保存逻辑；不新增模型调用；不自动重发未决请求；折叠状态仅存浏览器 `sessionStorage`，不写入服务端或原生会话文件。
- **回归基线**：既有富文本渲染、回复引用（`StrategyAttachmentEvidence` 指向同一资料与确切回复）、原用户消息投影（`originalUserText`）与流式投影（[`v12-discussion-stream-projection.test.ts`](../../../tests/v12-discussion-stream-projection.test.ts) 的「不重复投影、同文双回复」行为）是回归底线。

## 7. 四点产品原则前置检查

| 原则 | 本变更前置核对结论 |
| --- | --- |
| **1. Host 管环境** | Host 只负责对话的**呈现**组织（分组、折叠、状态可见性），不新增分析流程、步骤配额或确认门槛；不触碰会话生命周期与权限。 |
| **2. Agent 自主执行** | 折叠仅是已发生过程的可视化收纳，不改写、不评判、不补算 Agent 的任何步骤；过程内容全部来自既有已允许展示的投影数据。 |
| **3. 优先复用 Pi 已有能力** | 消息序列、`nativeEntryId` 身份、流式投影、markdown 渲染（`StrategyDiscussionReply`）、`tool-message` details 全部复用现有能力；共享层是纯 UI 组合，无平行状态机；E5 沿用其现有回执数据，不新增过程采集。 |
| **4. 减少人的操作** | 最简路径零新增必做操作：默认即为「过程一行、长文收起」，用户仅按需点击展开；无新增配置、记忆负担或确认步骤；错误／恢复入口因外置反而更直达。反例核对：① 不自动展开任何历史内容制造滚动负担；② 不以折叠为由移除任何既有操作（保存、反馈、查看原回复、引用）；③ 折叠记忆自动生效，无需用户保存。 |

## 8. 可点击 UI Demo 说明与复现方式

- **仓库内路径**：[`openspec/changes/issue-116-agent-chat-collapse/ui-demo/index.html`](ui-demo/index.html)（SHA-256：`c9210e0c4de3ece9a5bd8e1b251c72cfce8b79ecda8b659b974007bceb57c124`）
- **演示边界**：离线单文件 HTML（零外部网络依赖），复用产品真实 CSS 令牌与组件层级结构，使用合成资料与浏览器内存状态；不连接正式 Host 或真实模型。Demo 中的折叠记忆为真实 `sessionStorage` 实现，可验证刷新恢复。
- **覆盖场景**（顶部评审栏切换）：
  1. **项目任务对话（E1）**：短用户消息全文可读；长用户消息 3 行预览折叠；多步混合回复（过程 5 步收起一行 → 中间阶段正文保留 → 最终回复 5 行预览折叠，含 markdown 表格/代码块）；操作行与语义上下意外置；仅工具轮次；失败状态 + 重试入口可见；流式输出中保持展开 + 停止按钮。
  2. **战略共创（E3）**：引用资料条（〔…〕定位 + 引用卡）外置可见；基线空白「Agent」块 vs 设计后归入过程组对照；长问题折叠。
  3. **业务角色（E4）**：两条文本相同但身份不同的回复独立折叠状态；多步过程组。
  4. **PPT 精修（E5）**：agent 长回复 5 行预览；note（已完成 · 已保存版本 vN）与锁定提示、错误外置；用户长消息折叠。
  5. **横切**：窄屏（390px）／宽屏切换、深色模式、键盘展开（Tab 聚焦 + Enter）、「模拟刷新/重连」验证折叠记忆恢复、「模拟流式」验证流式展开。
- **本地打开与复现命令**：
  ```bash
  git fetch origin && git checkout work/qoder/issue-116-agent-chat-collapse
  # 方式 1：直接在浏览器打开离线单文件
  open openspec/changes/issue-116-agent-chat-collapse/ui-demo/index.html
  # 方式 2：通过本地静态 HTTP 服务访问
  python3 -m http.server 8765
  # 浏览器访问 http://127.0.0.1:8765/openspec/changes/issue-116-agent-chat-collapse/ui-demo/index.html
  ```

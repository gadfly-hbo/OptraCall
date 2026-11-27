# Issue #149 UI 首审（只读）

- 候选：`fd0003e6441e75f9e7daae88e09f3a0411227f04`；比较基线：`699e425cb0900b50385377d638495069fa726761`。
- 依据：AGENTS.md、工程规范 v1.15、`decision-case-daily-workspace/spec.md` DW01–18、tasks T03–12、冻结 v0.6 Demo / decisions / demo-guide。
- 方法：只读源码追踪、冻结 Demo 对照，以及 Node 25 直接执行纯模型函数。未启服务、未启浏览器、未调用模型；不把静态检查当实际视觉或键盘验收。未改源码、测试、原证据、分支。
- 结论：**首审不通过，建议按工程规范退回一次。** 以下是可定位的产品功能缺口，不是仅缺浏览器测试。T10–12 及相关 T04/T06/T09 不满足已确认完成标准；勾选清单和后端回归通过不能替代产品入口。

## UI-01 HIGH：旧首页仍生成没有请求依据的“需要你处理”事项

**要求：** DW08、spec §4.3；待处理以明确请求为依据，普通活跃 Case、报告可读、项目/目标负责人不能推成个人待办。

**证据：** `WorkspaceHome.tsx:122` 只在原首页前插入 QuickPanel；原 `WorkspaceHome.tsx:316,332` 的“需要你处理”列表仍渲染。`workspace-home-model.ts:686–717` 将前两个活跃 Case 无条件加入该队列，698–701 取项目/目标负责人填 owner；747–767 又将可读报告自动生成“待核对”。

**最短路径：** 建立一个未声明任何取舍/观察请求的普通 Case，填写普通下一步，返回首页。

**预期 / 实际：** 应属于继续工作；实际顶部新面板可显示“暂无明确待回应”，下方却同时显示“需要你处理 / 待处理”。普通报告也会被列作人的核对义务。

**本地实证：** `heuristic-home-queue-proof.json`。纯函数输入只有无请求的合成 Case，输出一个 `statusLabel:待处理` 队列项。

**返工：** 将原首页一起纳入新来源合同，普通工作归继续工作，报告及行动按真实含义展示，消除残留的启发式个人待办。

## UI-02 HIGH：前往原事项后，UI 保存没有回应原请求；取舍请求会无声消失

**要求：** DW08–09、spec §4.3；请求的准确版本、选择链/授权需随原业务保存，普通保存不等于回应，待核不能伪装已完成。

**证据：** `HomeDailyQuickPanel.tsx:194` / `App.tsx:883–891` 仅传 Case/事项身份；不带请求身份或目标。`CaseIssueTreeSidebar.tsx:154–160` 只展示请求，没有绑定回应操作。`CaseIssuePanel.tsx:249` 的“确认取舍”payload 无 `respondsToRequest`；`CaseDecisionsPanel.tsx:153` 同样没有引用。观察路径的 `decision-board/ui/decision-board-client.ts:43` 类型及 `DecisionBoardPage.tsx:361` payload 也没有请求引用/授权。

`case-decision-types.ts:113–124` 明确要求准确引用才算 answered。普通取舍推进原选择链后，状态变为 superseded；`home-pending.ts:158–159` 放入 unresolvedRequests，而 QuickPanel 从未渲染该集合。

**最短路径：** 有一个明确“作取舍”请求 → 首页“前往原事项回应” → 选准确方案并确认取舍 → 返回首页。观察分支则进入原行动回录反馈。

**预期 / 实际：** 应准确回应原请求，普通保存仍有诚实待核。实际取舍保存为普通 choice，原请求成为 superseded 并从首页完全消失；观察保存没有关联引用，原请求仍 open。UI 也没有回读准确请求原时间、目标版和来源的完整入口（QuickPanel:187–194）。

**本地实证：** `request-response-proof.json`：相同目标/链的普通 choice 为 `superseded`，带准确引用才为 `answered`；普通保存投影 `pending=0 / unresolved=1`。现有 HTTP 测试在 `workspace-daily-http-pi.test.ts:78–81` 手工写入 respondsToRequest，不能证明真实 UI 链闭合。

**返工：** 把准确请求目标传到原取舍/观察入口，明确保存时带原请求版本；显示未核、替代和失效，补实际 UI 回归，不能另加“标记完成”。

## UI-03 HIGH：统一准备/三分支恢复及可选 Agent 没有接到产品入口

**要求：** DW10–11/14、T10–11；首页与总览共用可恢复准备意图、准确三分支、可选用户主动 Agent 整理及来源理由。

**证据：** `workspace-daily-client.ts:49–50` 导出了 createCaseThreeBranch，但 `src` 中没有消费者。QuickPanel 的人工准备只调用无参数 onCreateCase（138）；`App.tsx:893–899` 跳旧 CaseBoard 创建表单，`CaseBoard.tsx:114–124` 仍走旧 api.create/goalCaseMatch。总览新建按钮又通过 `CaseBoard.tsx:60,104` 进入目标管理，不共用首页准备入口。

“整理与查找”仅 `HomeDailyQuickPanel.tsx:87–94` 调用目录文字查询，`case-directory.ts:42–44` 是完整输入 substring 匹配；没有 goal-draft 会话调用、解释理由或准备候选。T11要求的是产品中可选能力，用户不触发模型不代表该入口可以不实现。`HomeDailyQuickPanel.tsx:169–173` 的部分成功只显示一句提示，没有原操作查询、准确分步结果或继续入口。

**最短路径：** 首页输入背景 → 人工准备新 Case；或点击“整理与查找”；或已有 partial_failed/partial_unknown 准备草稿后重开首页。

**预期 / 实际：** 应恢复同一准备输入、可主动请 Agent 帮助、能看到并续办未完成创建。实际进入旧空表单，整理只做字面搜索；部分成功没有可操作的恢复路径。后端 executeThreeBranchCaseCreate 的存在不使这些功能在产品中可达。

**返工：** 完整接通共用准备 UI、goal-draft 可选入口和准确三分支结果/恢复；保留人工路线。既有 G/S 已有 Case 时要明确继续，不凭旧创建报错后静默开案。

## UI-04 HIGH：导航/关闭丢失新输入和准备编辑；已有 Case 分支丢新名称/背景

**要求：** DW11–14、T12；新输入、候选、准备编辑、操作 ID、采纳/创建结果要在关闭、导航和重开恢复，继续已有 Case 保留新文本。

**证据：** `HomeDailyQuickPanel.tsx:145` 输入只写 React state，只有显式保存/整理才落盘（63–85、91、150），导航/人工准备没有保存。`CaseDialogs.tsx:42–45` 的名称、背景、创建意图和 `CaseGoalPicker.tsx:21–25` 的候选编辑全为组件局部 state。关闭时 `CaseBoard.tsx:114` 卸载，完全未与 prepare draft 连接。`CaseBoard.tsx:120–124` 遇同 G/S 已有 Case，只关闭创建表单并打开原 Case，不保留刚填名称/背景，不给明确继续决定。

**最短路径 A：** 首页打一段新文本，不点“保存草稿”，点“全部项目”再回首页。文本丢失。

**最短路径 B：** 人工准备填写 Case 名称/背景，或填写目标候选，关闭编辑后重开。编辑和操作意图丢失；已保存目标虽保留，用户无法恢复这次准备。

**最短路径 C：** 选已被 Case 使用的准确 G/S，填一个新名称/背景后点创建。原 Case 自动打开，新名称/背景消失。

**返工：** 将实际使用表单接到同一业务持久草稿，导航/关闭保全输入和准确操作身份；已有目标与 Case 独立保留，继续须明确且生成可回读的待带入片段。

## UI-05 HIGH：待带入片段未接真实对话草稿，且默认写往第一事项

**要求：** DW10/12–13；最终位置由用户选择，明确追加保护既有非空草稿、可编辑后通过原会话发送。

**证据：** `HomeDailyQuickPanel.tsx:103,110,164` 不让用户选事项，直接使用目录第一事项。`CaseIssuePanel.tsx:89–100` 把片段写到新 issue-draft 并显示第二个 textarea；真实 `BusinessRoleConversation`（107）没有接收该文本。其实际 composer 独立使用 `BusinessRoleConversation.tsx:51,146–149,224–225` 的 sessionStorage/text，send 也只发送该 text。两套草稿没有加载/追加/发送连接；issue-draft 还只有在 fragments.length>0 时展示（82、95）。

**最短路径：** 已有 Case 两事项，并在当前事项的真实 Agent 输入框保留“旧草稿” → 首页录入新片段 → 带入 Case → 追加到事项草稿。

**预期 / 实际：** 应明确选择目标事项，在保护旧草稿的前提下可明确追加/编辑/发送。实际总进入第一事项，新出现的持久文本框只有片段，真实发送框仍是旧草稿；点原“发送”不包含该片段，用户只能手工复制。新持久存储并未覆盖实际 Case composer 草稿的产品重开恢复。

**返工：** 允许准确选择事项，把带入/追加/编辑连接原对话草稿和原发送入口，保持来源回读及追加防重，不另造对话历史。

## UI-06 HIGH/MEDIUM：当前工作与事项/范围保留不符合确认版

**要求：** DW02–05、T04/T06；G/S 常驻，准确当前事项/轮次/本轮摘要；手选其他事项及全部范围，普通切页签保留。

**证据与最短路径：**

1. `CaseBoard.tsx:132` 仅当前工作挂载 CaseIssuePanel；后者 `selected` 局部空状态（21），重挂后37–38回首事项或初始深链事项。选第二事项 → 项目与任务 → 选“全部当前 Case” → 回当前工作，事项回首项，父 `CaseBoard.tsx:53–56` 还重置手选范围。已有“相同activeIssueId不重置”补丁无法避免子组件换回另一个事项。
2. `CaseBoard.tsx:133,137` 两辅助页只有“当前事项/全部当前 Case”，没有手选其他事项入口；存了 auxScope.issueId，过滤却一直用 activeIssueId（135/137）。部分无任务关联的 Case 资料又以 `!artifact.taskId` 全放入当前事项成果，无法证明其事项归属。
3. G/S及目标依据仍在 `CaseBoard.tsx:132` overview条件内，切项目/成果/历史就消失；冻结 Demo 第81行的 G/S在 tabs 前常驻。当前工作仍是原协作及历次记录，未呈现冻结 Demo 第170行的准确本轮“已明确/正在推进/接下来”摘要。
4. `App.tsx:1267` 按 view 条件卸载 CaseBoard/ProjectBoard；CaseBoard当前事项、栏目、辅助范围均局部（49–52）；ProjectBoard搜索、归档、详情和任务类型筛选也局部（26）。从全部项目搜索/筛选 → 项目关联 Case → 全部项目，或 Case 辅助页 → 全局项目 → 返回，原栏目/事项/筛选失去。DW06的完整往返不能由“全部项目是完整原页面”单独证明。

**返工：** 当前事项及视图恢复归同一 Case 身份，浏览范围与协作上下文独立；落实已确认的常驻 G/S、本轮摘要和两辅助页其他事项选择。保留原四页签、来源与历史，不缩减为两个按钮。

## 验证边界及复验重点

- `browser-decision-case-daily.mjs:141–150` 只断言范围条文字、不同宽度下文本长度；没有验证真实过滤、选择保留、创建/恢复、片段发送和请求回应。仅有该 PASS 不能覆盖上述缺陷。
- 真实 1440/1024/390 视觉、全键盘、焦点、403/503、迟到及产品重开需要修后实际产品走查，本次不宣称已验。
- 本报告不扩大为一般视觉优化清单。建议二次交回固定新 SHA 后，先按以上六组最短路径做 UI→Host→保存→返回/重开闭环，再完成规范要求的最终非作者与四原则复核。

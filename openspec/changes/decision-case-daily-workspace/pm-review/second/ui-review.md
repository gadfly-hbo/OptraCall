# Issue #149 二审终审 UI 只读复核

- 固定候选：`495cbfce171cf28f8fcb65c0ad391718c3b5cca0`；工作树 `/workspace/OptraCall-issue149-final`。
- 对照冻结 v0.6 `spec.md` / `demo.html`、首审 FR04/06/07。已读 `verification/second-review.md`，其复核对象为 `54520672...` 且自身声明静态方式；未把其 PASS 当当前产品闭环证据。
- 方法：只读实际源码与差异；本报告没有浏览器、Host、真实模型或视觉验收结论。源码摘录保存在本目录 `source-evidence.json`。未改产品、测试、依赖或原证据。
- **结论：FR04 部分修复；FR06/07 仍有必须接修的功能缺口。二审结束后由 PM 接修，不再退回领取方。** 以下优先项均是源码能确定的行为断点，不只是缺测试。

## SUI-01 HIGH — 观察请求依旧不能通过产品 UI 精确回应；取舍也没有准确请求选择

**DW08/09；FR04。** 观察请求首页按钮仍只传 Case/事项：`HomeDailyQuickPanel.tsx:373` → `App.tsx:883–891`。Case 只展示观察请求，不将 requestId/revision/authorizationId 交给原行动反馈表单。`extensions/business-plugins/decision-board/ui/decision-board-client.ts:43` 的 FeedbackInput 没有 respondsToRequest；`DecisionBoardPage.tsx:361` 实际提交也未带该字段。

最短路径：有明确观察请求 → 首页“前往原事项回应” → 原事项中打开原看板行动 → 回录准确原行动反馈 → 返回首页。预期该反馈精确回应原请求；实际反馈仅为普通反馈，requestStatus 要求的 request/授权引用缺失，请求仍 open。该已披露边界是完整路径缺口，不是非阻塞观察。

取舍的单一匹配场景确已补引用：`CaseIssuePanel.tsx:253–256`。但它用 openRequests.find 自动取第一个匹配的请求，首页未传被点击请求，也没有请求选择器。最短路径：同事项、同准确方案/选择链存在两条不同明确请求，点击首页第二条，提交表单会引用第一条。应提供准确请求上下文/明确选择，避免回应别的请求。新 `unresolvedRequests` 分组已可见，首审“替代请求无声消失”问题已修。

## SUI-02 HIGH — 创建入口仍分裂；goal-draft 候选不可带入/采纳且准备身份不可恢复

**DW10/11/13；FR06。** 首页 QuickPanel 新增三分支按钮和可选 Agent 面板是实际进展，但没有覆盖全部入口：`CaseBoard.tsx:69,113` 总览“新建 Case”仍 onReviewGoals → 目标管理；`App.tsx:893–899` 与首页其他新建入口仍打开旧 CaseEditor。CaseBoard 中未挂载或复用 QuickPanel 的准备意图。

`HomeDailyQuickPanel.tsx:286–290` 挂 BusinessRoleConversation 时没有 onGoalDraft；`BusinessRoleConversation.tsx:226–231` 只有该 callback 存在才显示“带入目标表单”按钮。因此 Agent 即使成功 propose-goal，候选不能进入统一准备表单、不能沿 GoalRoleSuggestionRef 重核后保存/采纳。新候选人工路径也只能在另一个旧表单准备，当前统一表单本身只选已有目录目标。

`agentDraftId` 每次 mount 随机生成（QuickPanel:46），未存入 prepare，owner 又固定 personal/home-prepare（287），没有让准备用户选准确范围的接线。导航后再开启 Agent 会得到另一 owner/draftId，不能恢复此前的整理、候选或原生来源。目录按钮现返回未过滤的前20条真实 Case（151），可作为人工目录，但不能单独当作“Agent 有理由的推荐”完成证据；需将实际建议、准确候选与明确选择接通。

最短路径：任一 Case 总览新建与首页准备比较；或首页请 Agent 给目标候选 → 找“带入/采纳”；或 Agent 对话后去全部项目再回首页重新开启。预期所有入口恢复同一准备，候选可编辑采纳并准确继续；实际路线分裂、候选断路、会话身份变化。

## SUI-03 HIGH — 准备编辑仍不持久，创建完成后本页修订基线过期

**DW11–14；FR06。** `HomeDailyQuickPanel.tsx:294–305` 的 prepTitle/prepDesc/selectedGoalKey/selectedStrategy 都只 setState，无自动保存、失焦保存或关闭 flush。`persistPrepareDraft` 的 selectedGoal 只沿 prev（112），没有从这两个选择值生成；调用点也没有 extra.selectedGoal。仅 rawInput 触发400ms保存（132–136）。

最短路径：填首页轻输入并等待保存 → “准备新 Case”改名称/背景、选准确 G/S → 收起或切全部项目再返回。预期恢复全部准备编辑和所选准确目标；实际恢复旧标题/背景，G/S未保存。直接刷新/关闭产品同样。旧 CaseEditor/CaseGoalPicker 的局部编辑和 operation 状态也未接 prepare（原表单未改）。

此外，`runThreeBranchCreate` 成功后仅 setSavedDrafts（220–221），没有更新 draftRev；后端该调用已修订 prepare 草稿。随后在同页编辑/保存轻输入仍用旧 draftRev（108），会409。`flushBeforeNav` 无论 persist 返回 null 仍执行导航（138–142），因此保存失败可丢新文本。

修复须让同一准备意图持久保存编辑、准确目标与操作回执；导航前失败保留输入/阻止丢失，提交返回同步版本。避免仅保存 rawInput 后宣称所有草稿已保全。

## SUI-04 HIGH — 已有 Case 的“明确继续”只打开记录，未接待带入片段；完成准备也无新意图生命周期

**DW11–14；FR06。** 三分支 continue 回执虽然保留 prepare，但 `HomeDailyQuickPanel.tsx:313–315` 的“打开原 Case”仅 onOpenCase，无目标事项选择、carry-over创建或将新名称/背景/输入带给原 Case。手动目录路径（161–178）才有 fragment 创建，两条路径没有贯通。created 分支进入 Case（318）同样没有创建/明确告知第一事项的接线。

最短路径：统一准备填写新名称/背景，选已存在 Case 的准确 G/S → 创建或继续 → 打开原 Case。预期在准确原 Case/事项有来源清晰的待带入内容；实际原 Case 内看不到本次片段，用户只能返回首页重新做人工目录选择或手搬文本。

同一首页默认 draftId 是 home-prepare-default（38），提交后没有完成/新建准备切换；下一次准备会沿 savedDrafts 中旧 createOperationId/adoptionReceipt（107–118、185、203–204）。不同新 Case 意图需要独立草稿与原操作，不能要求用户先“放弃草稿”才能摆脱上次完成回执，也不能复用上次 operationId 造成冲突。

## SUI-05 HIGH — 追加现在进入真实 composer，但持久保存和编辑仍是两套草稿

**DW12/13；FR06。** 点击追加后 externalAppend 确会保护非空 composer 并追加（`CaseIssuePanel.tsx:93–94,111`；`BusinessRoleConversation.tsx:53–61`），首审完全未接 composer 的问题已局部修好。

仍有断点：实际 composer 继续只在 sessionStorage 保存（BusinessRoleConversation:51,58,235附近），send 只读该 text。后端 issue-draft 独立保存/编辑（CaseIssuePanel:99–104），没有反向恢复或推送 composer。片段追加已在服务端记 appendedAt，重开后再次点击得到 alreadyAppended 时又不会 externalAppend（94）。

最短路径 A：带入片段 → 追加 → 在“事项持久草稿”编辑并保存 → 从真正 Agent 输入框发送。预期发送用户编辑后的同一草稿；实际发送的是未编辑片段（或原 composer+片段），持久框编辑与发送框分离。

最短路径 B：真实 composer 原有非空草稿 → 追加并再编辑 → 关闭该标签/产品后新开 → 回同一事项。预期原草稿及追加后编辑恢复为可发文本；实际 sessionStorage消失，backend issue-draft只保留另一份文本；片段已追加按钮不再把它带回 composer。存在保存→产品重开→发送的断路。

应以同一事项业务持久草稿恢复实际 composer，保留原文来源和追加幂等；不把独立持久框+会话存储视为同一已恢复输入。

## SUI-06 HIGH — 范围“手选保留”变成永久粘连；跨 Case/空事项显示错误内容

**DW02/04/06；FR07。** `CaseBoard.tsx:62–65` handleSelectIssue 在 prev.manual 时永远保留 auxScope，因此用户明确选新事项也不重设默认。路径：选事项A → 项目页手选全部 → 当前工作明确选B → 项目页。预期默认B，实际仍全部。若手选其他事项则一直看旧事项。

activeIssueId/auxScope 没有按 Case 身份存取/复位（54–65、88–91）；CaseIssuePanel 空事项 selected='' 时仅非空才通知父（46）。路径：A有事项a，选a → 关闭A → 打开无事项但有独立项目任务的B → 项目页。父仍 activeIssueId=a、scope=issue/a，用B.id+a过滤后全部任务被隐藏，“当前事项”还可用；预期B无事项合理全范围/原项目入口。这不是 second-review 所称轻微细节。

单Case普通Tab切换现在能保留受控selected；其他事项下拉和无taskId产物过滤已补。但以上明确选新事项、跨Case和无事项路径仍需修复。

## SUI-07 HIGH/MEDIUM — 本轮摘要仍借用整 Case 内容；全局项目往返尚未实现

**DW02/06；FR07。** `CaseBoard.tsx:142` 的“本轮当前摘要”直接使用 detail.case.judgement 和 detail.case.nextStep，推进只显示当前事项标题，不读 caseIssueTimeline/current choice/action/review，也不显示准确来源/第几轮。两个事项两轮可得到相同“本轮已明确/接下来”，把整Case备注标成事项本轮投影。冻结 Demo 第170行及DW02要求准确原记录，不能仅补三个标签。

G/S栏现已在四页签前常驻，是有效修复。

全局项目往返本轮无 App/ProjectBoard 修复：`App.tsx:1267` 互斥渲染卸载CaseBoard/ProjectBoard，后者 query/filter/selectedId/taskTypeFilter 全是局部state（ProjectBoard:26），关联Case按钮先清selectedId（97）。路径：全部项目搜索+归档筛选 → 打开项目并选任务类型 → 关联Case → 全部项目，搜索/筛选/详情/任务类型回默认，未保留原返回链。Case辅助页→全局项目→返回也丢栏目与auxScope。需按原位置恢复，保留现有全局管理与关联能力。

## 已证实改善与复验边界

- 原“需要你处理”栏目已更名为非明确请求的近期动态；新增未解/替代请求分组；单一准确取舍请求已能附引用。
- 明确目标事项选择器、三分支HTTP按钮与部分成功续办按钮已经存在；externalAppend局部有效；单Case跨Tab的事项受控、其他事项筛选、常驻G/S已补。
- 这些局部改善不能扩大成 FR04/06/07 完整通过。现有browser脚本的标签/简单保存断言不能证明上述完整链。建议 PM 按 SUI-01–07 接修后做真实产品合成走查：两请求/观察回应、全部创建入口、Agent候选采纳、准备编辑导航/重开、实际composer编辑发送、跨Case空态与项目往返。

## 给 PM 并行接修的最小接口建议（只读建议，不是已实施）

1. **App ↔ 共用准备作者：** 所有“新建/准备 Case”回调统一为一个 `onPrepareCase()`，由 App 级挂载且保持的准备组件处理；首页 QuickPanel、Case总览、空态与旧入口调用同一 callback。准备组件自行持有/恢复 stable prepare draftId、goal-draft draftId、准确 scope、GoalRoleSuggestionRef 与编辑/回执；不要再用每个视图 mount 的 random draftId。若准备作者需要从首页带文本，使用显式 `initialInput?: {text, origin}`/现有 prepare record，不让两个组件并发写同一 prepare owner。已有 Case 的继续结果应交同一片段选择流程，不只 onOpenCase。
2. **首页/Case ↔ Board 作者：** 增加明确请求入口 `onOpenRequest(item: HomePendingItem)`，使 App 保存被点击的 `{requestId,revision,caseId,issueId,target}`，而非只caseId/issueId。传给原取舍或反馈编辑器的只是一份待核引用；编辑器在保存前重读请求与准确目标，用户可明确选择该请求或普通保存。FeedbackInput 扩展使用后端既有 `respondsToRequest` 类型（观察包含 authorizationId），提交原 `saveFeedback`，不建立完成库。现有 FeedbackReviewStart 是复盘入口，不应拿来冒充请求回应上下文。
3. **CaseIssuePanel ↔ BusinessRoleConversation（Root所有）：** 真实 composer 对 `owner.role==='case'` 使用同一既有 `issue:${caseId}:${itemId}` 的 issue-draft record（text/revision/appendedFragmentIds）。只显示一份编辑器。片段追加复用 appendCarryOverFragment 回执返回的完整草稿作为 composer 新值；已追加也可恢复同一草稿，不再以sessionStorage作为发送文本权威。编辑保存串行处理CAS，发送接受后仅清与该请求相同的旧文本，保留发送中新增编辑及UNKNOWN。无需新消息库或SDK循环。
4. **App ↔ CaseBoard/ProjectBoard 作者：** 把 Case 返回状态提升为按 caseId 的 `{tab,selectedIssueId,auxScope}`，项目状态为 `{query,filter,selectedId,taskTypeFilter}`，由 App 保存/回传（或保留挂载，仍须准确返回链）。明确选新协作事项时始终设该事项默认范围；普通重挂/重绘只恢复，不调用“用户显式选择”的重置逻辑；空事项必须通知父级并恢复all。跨Case切换先恢复该Case自身状态，不能沿用旧issueId。原项目↔Case返回引用带原view/Case栏目/项目位置，不新增业务权威。
5. **本轮摘要/读取边界：** 摘要消费现有 caseIssueTimeline 的准确轮次/选择/授权/反馈/复盘投影及原来源引用，无记录显示未知。事项/详情403时清失权内容与可操作入口；503保留可识别旧快照状态。当前 `CaseBoard.tsx:85` 与 `CaseIssuePanel.tsx:43` 仅设错误未清旧数据，`CaseBoard.tsx:59` 吞掉事项错误，该首审DW16缺口也应随同接修；不要将它降成未做浏览器自动化。

以上分工应保持准备组件单一写入、真实composer单一写入、Board反馈沿原owner保存；接口类型确认后可并行改各自文件，Root统一接线。

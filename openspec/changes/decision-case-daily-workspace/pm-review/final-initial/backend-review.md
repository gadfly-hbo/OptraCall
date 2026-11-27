# Issue #149 独立最终后端审查

- 固定候选：`7fe8e936d2463e514f2d8b08deae23f8c0467e24`；基线 `699e425cb0900b50385377d638495069fa726761`；覆盖作者二次 `495cbfce171cf28f8fcb65c0ad391718c3b5cca0` 及 PM 接修增量。
- **结论：当前固定候选不可合并。** 原首审／二审中的关键修复确实生效，但下列三个原业务权威缺口仍有可复现反例。Root 已收到发现并安排后续修复；后续候选须另行重验，本文不提前授予 PASS。
- 本人未参与本候选任何实现。已读取 AGENTS、工程规范第2／4节及 IN01–07、本单 spec/tasks/implementation/pm-integration、二审 backend-review、原工作树永久首审报告。未修改产品、测试、依赖、规格或冻结证据；仅写本目录隔离报告／探针／合成数据。没有 commit/push、真实 Provider、凭据、业务根或设备操作。

## 必须修复

### FBE01 / P1 / DW08–09、DW16：取舍请求可指向另一事项专属策略，成为无法回应的正式待处理

- 源码：`src/host/case-store.ts:873–876` 只核策略 CaseStore/Case 和 kind，未核策略的 `issueId`；`src/host/case-issues.ts:500–515` 保存入口只对 observe 做完整 target 资格核对。对照原 `src/host/case-store.ts:935–939`，真实取舍明确拒绝跨事项策略。
- 真实 CaseStore + 原 `createCaseIssueService`：通过原 `acceptIssuePlan` 创建事项 A 专属策略；在事项 B 保存 choose 请求，target 指向 A 的准确策略，服务接受并投影 `open`。使用原 `chooseStrategy` 按 B 和准确请求引用回应，报 `case_issue_scope_mismatch`，无法完成这个已进入待处理的请求。
- 验收：新建／修订请求须核完整策略 owner 及准确选择链；A 专属策略不能成为 B 的正式请求目标。旧错配记录应逐条待核，不影响合法请求；同 owner 正常回应、原 operation replay 与无 issueId 的旧共享策略兼容仍通过。
- 证据：`backend/probe.mjs`，`backend/probe-output.jsonl` 的 `cross-issue-choose-request`。

### FBE02 / P1 / DW08–09、DW16：观察请求不核原反馈基线真实性，可成为永久无法回应的 open 请求

- 源码：`src/host/case-issues.ts:504–515` 核了项目／item／task／授权，却未核 `feedbackBaseRevisionId`；`src/host/case-store.ts:838–840` 仅验证 UUID。读取 `src/host/case-issues.ts:82–94` 也未识别不存在或不属于本 task 的基线。对照原反馈 CAS `extensions/business-plugins/decision-board/storage/store.ts:673–674` 和精确回应匹配 `src/host/case-decision-types.ts:127–128`。
- 真实 Case/Board Store + 原 service：准确事项、真实 choice 和 Board 授权下，传随机不存在的 `feedbackBaseRevisionId` 保存 observe 请求，接受为 `open`。原 `saveFeedback` 用真实当前基线 null 并携带准确 requestId/revision/authorizationId 保存成功，请求仍 `open`；若用请求里的假基线保存则不能通过原 CAS。UI 也会在 `observation-request-model.ts:31` 拒绝回应。
- 验收：请求保存／修订重核基线存在、归属原 task 及准许版本，不接受随机、别 task 或不能再回应的陈旧基线；读取旧错基线须准确待核或替代，不能继续作为可操作 open。实际新反馈仍须沿原 CAS，不能为消解请求而冒用新基线。
- 证据：`backend/probe-output.jsonl` 的 `nonexistent-observation-baseline`。

### FBE03 / P1 / DW08–09、DW16、四原则 Host 权限：原确认来源撤权后，新请求入口与首页绕过原读取权威

- 源码：`src/host/case-issues.ts:70–95,479–515` 的观察保存／投影未调用 `deps.assertBoardItemReadable`；`src/host/workspace-daily-routes.ts:30–37` 只传裸 BoardStore。原权威见 `src/host/conclusion-board-handoff.ts:31–37`，原 Board HTTP handler 的读取见 `extensions/business-plugins/decision-board/api/routes.ts:132–140,253–256`。
- 真实 Board `confirmReportConclusions` 创建 `sourceKind:'report-confirmation'` item，原 Case 选择与 `arrangeActions` 为其创建真实行动和授权。初始可读时保存请求；随后以原 injected `assertBoardItemReadable` 模拟来源撤权（throw403），同 item 又保存新请求。两个请求均 `open`，首页均进入 pending；Case 保存、Case 请求读取及首页的原权威调用合计 **0**。同 item 的原 Board `feedback/history` route 会调用该权威并返回 **409 `confirmation_source_unavailable`**。
- 此处没有制造真实账号撤权，也不冒称网络 HTTP；验证的是原生产 callback 合同与真实服务／handler 调用路径。结果足以证明新路径遗漏该既有权威，不能以同 Case 真实行动授权代替当前来源可读资格。
- 验收：保存新请求应沿原来源资格拒绝；旧请求逐条标待核并退出正式 pending，清掉不可用入口／内容；合法独立请求及已完成准确回执保持其适用状态。读取／反馈资格沿同一原权威，不另设新权限表。
- 证据：`backend/probe-output.jsonl` 的 `revoked-confirmation-authority`，包含两个新旧请求状态、首页 ID、原 callback 次数及原 Board route 返回值。

## 已独立核实的修复与兼容

以下结论只绑定上述固定候选，不能用作者 PASS 代替当前事实。

- **FR01 真实目标准入**：静态追踪新路由 `server.ts:1871–1886`，`readGoal` 调原 StrategyGoalsStore/validateStrategyGoal，真正创建回到原 CaseRoutes。独立真实 StrategyGoalsStore + 原 CaseRoutes + orchestrator 探针：candidate 冒认已采纳→`goal_not_adopted`；不存在目标→`strategy_goal_not_found`；非成员策略→`invalid_goal_strategy`；原 CaseRoutes 对相同 candidate 同样拒绝。正常候选明确采纳后建 Case，并有采纳回执。未独立启动网络 Host，Root 完整检查另报。
- **历史精确 G/S 继续**：真实 v1 采纳并建 Case→修订并采纳 v2→关闭旧 Case→新准备以 v1 原 G/S 继续：旧 v1 仍为 `adopted`、当前 adoptedVersion=2，得到 `branch:'continue'`、原 Case 身份、`isClosed:true`，未自动重开。真实 GoalVersion 状态合同只有 candidate/adopted；没有假设旧版会变 superseded。
- **原创建指纹恢复（SBE01）**：真实 Store 创建，后续合法编辑 Case 标题／背景；原输入与原 operation 恢复仍回原 Case／原回执，当前 Case 保留新编辑；将同 operation 改为后来编辑内容返回 `operation_conflict`。静态核原 CaseRoutes:206–217 与 Store:344–369、1021–1035，没有仅比较当前可变 Case。
- **真实 UNKNOWN 分类（SBE03）**：注入原 CaseStore 生产错误合同 `case_transaction_outcome_unknown/503`，结果 `createStatus:'unknown'`、`creationState:'partial_unknown'`。未损坏 DB 或声称实际制造了磁盘提交丢确认。
- **FR02 草稿／片段**：同根两个真实 WorkspaceDraftStore 对同 revision 并发 save，仅一胜，另一 `draft_revision_conflict`；追加保护非空旧输入、原文与来源，重复追加 `alreadyAppended:true`，跨事项拒 `carry_over_scope_mismatch`。互斥范围确为同进程跨实例；未声称跨进程锁或断电原子性。
- **SBE02 精确观察授权**：静态核 `observationAuthorizationMatches` 回核 CaseStore/Case/choice/strategy/issue；永久负例验证另一事项授权保存被拒，旧错配回读不可冒认 answered。FBE01–03 是这一修复仍未覆盖的其他目标／读取身份。
- **SBE04 逐请求隔离**：投影已由整 Case 的 anyUnreadable 汇总改为逐请求。针对性永久测试验证一侧解绑不会抹掉另一侧正常 open 和已答回执。
- **FR03 schema 兼容**：独立真实 Board v4 先存普通反馈→带请求引用反馈迁移 v6→关闭／重开→再存普通反馈→再次关闭／重开成功。旧反馈、带引用反馈及后续普通反馈三个对象逐值相等，原值保留。证据 `backend/schema-probe.mjs`、`backend/schema-results.json`。
- **请求修订与原操作兼容**：已有针对性测试覆盖省略 assignee/date 保留、显式 null 清除、跨关闭重开、旧 aggregate revision 回执以新 Host mode 原样恢复及改 payload 仍冲突；均通过。

## 实际命令与结果

工具链：`/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node`（25.9.0），本工作树锁定 npm 依赖；未改依赖／锁文件。没有启动 Host，避免与 Root 全量检查并行时的十秒启动环境误失败。

1. `node .local/pm-final/backend/probe.mjs`：exit0；8项独立输出，前三项为上述已确认产品反例，后五项验证修复及真实目标准入。`backend/results.json` 同时保存合成根位置。
2. `node .local/pm-final/backend/schema-probe.mjs`：exit0；schema4→6、两次重开、3条反馈值保全。
3. `TMPDIR=$PWD/.local/pm-final/backend/tmp node --test tests/case-preparation-recovery.test.ts tests/case-declarations-second-review.test.ts tests/case-decision-requests.test.ts tests/workspace-daily-backend.test.ts`：**16/16 PASS**，日志 `backend/targeted-tests.log`。这些测试未检出上述三个负例，不据此宣布整体 PASS。

探针开发出现两次 fixture 准备错误（把 issueId 传给不接收它的 saveDecisionDraft；未采纳 manual item 就 addTask），已按原 API 改用 acceptIssuePlan／先采纳 item，均不是产品 RED。未通过改测试／候选或跳过断言制造结果。

## 四原则专项（本后端范围）

| 原则 | 实查与结论 |
| --- | --- |
| Host 管环境 | owner、目标、CAS、保存回执均是适当环境职责；FBE01–03 说明准确目标及原读取资格仍不完整，**不通过**。 |
| Agent 自主执行 | 新建三分支是已确认业务写入合同；未见在本后端范围强加分析步骤、计算、方法配额或 Host 业务归属推断。**本范围通过**。来源用户声明的 Pi 实际接线由 Runtime 独立审查，不用字符串非空代替其证据。 |
| 优先复用 Pi／原权威 | 新建已回到原 CaseRoutes/Goal Store，观察沿原 Board feedback 历史而无第二完成表；本范围未新增 Runtime／SDK loop，依赖／锁文件相对基线不变。**本业务复用范围通过**；SDK 实际官方安装完整性与完整调用链由 Runtime 审查，不在此扩大宣称。 |
| 减少人的操作 | 已采纳目标不重采纳、原操作恢复、旧 Case 明确继续、首页派生完成均有实证；FBE01–02 制造不能正常回应的正式请求，要求用户另行手工修复，**受缺陷影响不通过**。产品 UI 最短路径由 UI 独立审查。 |

本报告不是完整 `npm run check`、真实模型质量、用户产品验收、CI 或设备采用结论。候选之后的任何修复必须重新固定并重验相关路径，保留本次反例及原 FAIL。

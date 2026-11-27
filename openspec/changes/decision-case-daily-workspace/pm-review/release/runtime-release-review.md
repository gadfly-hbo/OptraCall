# Issue #149 Runtime release head 独立复核

**结论：通过，Runtime 子审建议合并 `6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`，无剩余必须修复项。** 开始/结束均核同一完整 HEAD，工作树 clean。完整 check、其他子审、准确 Git/CI及用户验收由 Root 分别汇总。

本人未参与任何候选实现，产品/测试/规格/SDK/依赖始终只读，仅写 `.local/pm-final/` 自有探针、合成根和报告。原 `runtime-review.md` 的 FAIL、be1 的 `runtime-final-review.md` 与 a571 的 `runtime-accepted-review.md` 及全部原日志/收据保留。

## 新增源码差异独立实核

已逐项检查 `a571245698d432d39e3fbdbcfee423ebc06fd919..6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`：

- **复用原来源资格，而非另建权威。** CaseIssueService 对新建/修订 choose 请求直接执行原 `checkPlan`；未答请求的 service/declarations/home也走同一原函数。准确 Plan 来源经原关联项目、任务 assignment 的 Case/issue、原 native session/message/hash、正文读取及原 `qualifyPlanReply` 核准；缺原 qualifier 的事项来源不伪造可回应 pending。已准确回答先保留 answered，已完成 operation先准确回读；withdraw/supersede不被来源丢失阻断。
- **选择准入抽取等价。** `CaseStore.assertStrategyChoiceTarget` 从原 choose 的同段只读校验提取；请求与原 choose 复用同一 Case/Store/issue/strategy/current lifecycle/previous choice 权威。原 `allowHistorical` 行为保留，方法本身不写选择或回执。原 choose 的 actor、事件、operation摘要和成功结果未改。
- **新异步 qualification 不绕过取消、配置与提交保护。** `await checkPlan` 仍在原 mutate内，之后才在占用内读取 currentCaseRevision并进入 Store事务；同一可信 `assertWritable` 在Store新写前及 **COMMIT前**仍执行。Host捕获配置比较、实际SDK current/signal、owner绑定和公共关闭不变；Store在资格等待之后重核选择目标及当前选择链。completed operation分支不重复资格或业务写入。
- **首次建案沿原安全初始化。** 只有明确有效形状的 `POST /api/workspace/create-case`，且原state为uninitialized，才经原caseRoutes的 `POST /api/cases/storage/initialize → mutate → cases.initialize`；GET没有新增初始化，unavailable原库不重置，建案仍由原采纳/创建权威完成。不是创建前伪造Case owner或模型自动建案。
- **UI新增刷新没有模型副作用。** CaseBoard新增动作是status/list/detail读取和既有view选择；CaseIssuePanel重新读待带入片段；BusinessRoleConversation对已追加片段仅回调清除待处理标记，未新增messages/open/模型发送或自动再追加。

## 在最终 head 新跑的验证

Node25.9.0，单并发测试及本审查隔离 TMPDIR，命令：

`node --test --test-concurrency=1 --test-name-pattern='DW-SECOND-04|DW-SECOND-05|DW-SECOND-08|DW-PLAN-REQUEST-01|DW10/11|DW16/18' tests/case-declarations-second-review.test.ts tests/case-request-plan-qualification.test.ts tests/workspace-first-case.test.ts`

**6 PASS / 0 FAIL / 0 SKIP**，日志 `release-runtime-delta.log`。包括原edge/request COMMIT前取消及receipt回滚、CAS与新旧operation准确回读；真实Project/Task/native/recipient四种来源失效的原checkPlan保存/修订/投影/恢复；首次明确创建HTTP与GET无写；unmarked既有库不可重置及字节保全。

另执行本人自有 `release-cancel-source-qualification.mjs`，专门覆盖这次新增await窗口：

1. 实际 ProjectStore + CaseStore 建真实原Plan assignment，准备可由原reader读取的合成 native JSONL，通过原issueWrite接受Plan产生事项专属strategy。
2. 发起新choose请求，持住最后的原 `qualifyPlanReply`；**确认已到达来源qualification** 后，分别触发取消或撤销可信配置资格，再释放原读取。
3. 两种情况均拒绝首次提交：新请求 **0**、准确operation receipt **null**、Case revision不变、原native字节不变，exit0。

收据 `release-cancel-source-qualification.json`，日志同名 `.log`，含原native路径及两次operationId。这是实际Service/Store/原来源reader的提交资格探针；配置分支通过注入的可信assertWritable撤资格，不冒称另跑真实Provider配置切换。真实Pi仅换key/线路测试仍按下述准确旧证据沿用。

## 旧真实 Pi 证据适用边界及四原则

独立执行 `git diff --exit-code a571..6bc7 --` 核准：`strategy-discussion-host.ts`、公共`agent-sessions.ts`、Case目录、Agent工具定义/执行/IPC、package/lock和边界脚本 **无差异**。server仅增加原checkPlan和原初始化gate两个callback注入，原project工具/捕获配置callback字节未变。因此 be1 的真实9项Pi/配置/目录证据继续按无关delta沿用，a571 的5项及新项目读取取消探针也保留各自原SHA；**没有宣称它们全部在6bc7重跑**。新增业务source等待窗口由本次新探针验证。

最终增量的四原则仍通过：

- **Host管环境**：原来源/接收者、当前选择资格、初始化保全和事务/取消/配置由Host核；不代作业务选择或生成经营判断。
- **Agent自主执行**：增加的是业务请求的原准入资格，不增加模型推理步骤、公式、固定工具顺序或Host补算。
- **优先复用Pi**：官方Pi1.4.0/Interface v3、原公共生命周期及真实owner不变；复用原checkPlan与原choice权威，没有新runtime、生命周期/完成台账、SDK改写或依赖变动。
- **减少人的操作**：来源失效由系统如实派生待核，不要求用户手工补机器身份；首次明确建案自动沿原初始化gate，GET仍只读，原人工/Agent路径及必要人的采纳保留。

本报告限本地工程接缝及Runtime专项；不代替真实模型质量、经营效果、CI、部署或设备采用。

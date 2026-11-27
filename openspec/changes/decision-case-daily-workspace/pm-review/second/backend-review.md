# Issue #149 后端二审终审（独立只读）

固定交付候选：`495cbfce171cf28f8fcb65c0ad391718c3b5cca0`（代码候选 `54520672b6acd36420123b9e60af6f8fefc0da80`）；原首审：`fd0003e6441e75f9e7daae88e09f3a0411227f04`；原基线：`699e425cb0900b50385377d638495069fa726761`。

**结论：固定二次候选仍不可合并。** FR01 和 FR02/03 的多项原负例已实质修复，但以下四处仍需 PM 接手修复。按工程规范二审终审规则，不再退回或安排第三次领取。作者提交的 `verification/second-review.md` 是被核查证据，不作为本次独立 PASS 的依据。

## 已独立确认的修复与正常路径

- 真实隔离 Host HTTP：候选 G 伪报 `alreadyAdopted:true` →409；不存在目标 →404；准确 G 的虚构 S →400；原 `POST /api/cases` 对未采纳 G 仍409。新入口 `readGoal`/采纳校验及通过原 `caseRoutes` 创建的接线成立，未再现首审目标准入绕过。
- 真实隔离 Host HTTP：A采纳成功、Case因超长标题确定失败后，同draft改选B →409 `prepare_draft_goal_mismatch`，未再静默创建A。正常新目标采纳+创建成功，未编辑Case前以原意图重试能回放同Case。
- 真实 WorkspaceDraftStore：同进程两个Store实例对同路径、同revision并发保存，一次成功、一次409；跨owner片段拒409；合法片段追加保留非空旧文，再次追加防重，原文与来处仍可读。此结论限同进程多实例，没有声称跨进程锁或断电持久性已验。
- 真实CaseStore + orchestrator：无关 `case_note` 操作ID现在拒409，首审“任意kind冒认创建”反例关闭。
- 独立子审真实Case/Board Store + 原route handler/service：随机不存在授权、错误caseStoreId和null来源均被拒。合法观察精确回应可派生成answered；schema6含请求引用反馈保存后关闭/重开，再保存普通反馈再关闭/重开均成功，旧反馈保留。该项未冒称真实网络HTTP/Pi闭环。

上述实际输出见 `http-results.json`、`store-results.json`、`request/recheck-output.jsonl`。

## 剩余必须修复

### SBE01 / P1 / FR02、DW13–14：回放比较当前Case，未比较原不可变操作意图

- 固定源码位置：`src/host/case-creation-orchestrator.ts:124–143`，特别是129–137。
- 真实Host/HTTP复现：正常创建Case，原样重试→201/回放成功；通过原 `PATCH /api/cases/:id` 合法编辑标题及背景；再用**原createOperationId和原输入**重试→409 `operation_conflict`。相反，将同操作ID的输入改成**后来编辑的标题/背景**→201 `replayedFromOperation:true`。
- 原因：`getCase`/`getGoalBinding` 是可变当前对象，不是原请求摘要或原操作回执。合法后续修改反而让原请求无法核回，改写请求却能借原操作ID成功。若发生准确G/S换绑，同样有此身份风险。
- 修复要求：沿原CaseStore操作指纹/创建事件及原不可变回执核对，不能借当前对象推断原请求；原请求恢复不依赖后来的编辑，变更原意图应409。保留当前Case及历史修改，不重放创建。
- 证据：`http-probe.mjs`、`http-results.json` 最后五条（normal create/retry/edit/original retry/changed retry）。

### SBE02 / P1 / FR03、DW08–09：观察请求仍可跨事项借用真实授权并被错误消解

- 固定源码位置：`src/host/case-issues.ts:428–435`（创建只核授权 `source.caseId`）；`398–410`（读取），`workspace-daily-routes.ts:48–64`（首页同类核验）。
- 真实Store + 原 `createCaseDecisionRoutes` handler/service反例：同Case有事项A/B。为A建立真实choice及真实Board行动授权；给**B的观察请求**引用A行动授权，handler接受为open。保存A行动反馈，准确回填这个B请求ID/revision后，B变answered，首页pending降0。
- 原因：有真实授权不等于属于本事项/原选择链。新检查只收紧到同Case，没有把授权source的caseStoreId、choiceId和strategyRef回核到请求的准确事项、轮次及原业务权威。`authorityAtFeedback` 只核反馈时刻的授权，不补齐请求owner归属。
- 修复要求：保存/修订/回读/回应全路径统一核准确事项及选择链/授权身份；错事项应拒绝或待核，不得作为正式open请求或消解依据。
- 证据：`request/recheck.mjs`、`request/recheck-output.jsonl` 的cross-issue-request与cross-issue-answer；requestIssue与authorizationChoiceIssue实际不同。

### SBE03 / P1 / DW14、DW16：原CaseStore的真实UNKNOWN错误码被标为确定失败

- 固定源码位置：`src/host/case-creation-orchestrator.ts:193–199`；实际错误生产者 `src/host/case-store.ts:323–324`。
- 错误合同动态探针：让createCase返回原CaseStore会发出的 `new CaseStoreError('case_transaction_outcome_unknown',503)`，结果是 `createStatus:'failed'`、`creationState:'partial_failed'`。代码只认 `case_create_unknown/network_timeout/response_dropped` 三个名称。
- 验证边界：这是实际生产错误类型/码的依赖注入探针，未人为破坏DB或声称已真实制造磁盘提交丢响应。源码确认原Store确实用该码表达提交结果不明，所以分类错是确定问题。
- 修复要求：保留原UNKNOWN与原操作身份，UI/回执不得表达确定未创建；后续只能核原操作再续办。采纳阶段的 `strategy_goals_write_unknown` 也应沿同一恢复原则核对，本文未声称该阶段已动态复现。
- 证据：`store-probe.mjs`、`store-results.json` 末条。

### SBE04 / P2 / DW16：单个观察不可读污染整个Case，正常请求从首页消失

- 固定源码位置：`src/host/workspace-daily-routes.ts:38–69`，`anyUnreadable ? undefined : collected`。
- 真实Store + 原handler/service反例：同Case在两个关联项目分别有正常观察请求；只解绑一侧项目。原请求service仍把另一侧正常请求判open、已精确回答请求判answered；首页却把这个Case所有观察一律判unverifiable，正常open从pending消失，先前已答也变待核。
- 修复要求：读取资格/不可读状态按准确请求或目标隔离，保留仍获准来源的真实状态；一条失权不能抹掉其他请求已答回执或日常待办。
- 证据：`request/recheck-output.jsonl` 的one-unlinked-target-contaminates-case。

## 产品接缝与验证边界

- 观察类请求从正常UI/Agent反馈入口自动带精确引用仍未接通，实施记录也披露该缺口；不能用后端直接传引用测试视为DW09正常产品闭环完成。此点交Root UI/runtime终审汇总，本文不重复运行UI。
- source从null改成非空字符串，尚不能单凭此证明原用户消息、请求人/承担人声明能准确回读；探针给不存在source ref仍open且未调用readSource。此处作为来源合同风险保留，由runtime/PM对正常声明入口统一处理，本文未把任意字符串的静态类型校验当来源资格PASS。
- 已重读AGENTS、工程规范四原则/SDD/独立复核/二审规则及本单spec/tasks/implementation、永久首审记录。没有修改候选源码、测试、确认Demo或共享依赖。探针、合成数据、输出仅在 `.local/pm-second-backend/`；Host fixture临时根通过TMPDIR定位到本隔离目录。
- 使用Node `/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node`。独立探针不是完整 `npm run check`，未重复Root全量检查，未调用真实Provider、读取凭据或真实业务根。最后Store探针后两文件 `git diff --exit-code -- src/host/case-creation-orchestrator.ts src/host/workspace-draft-store.ts` 为0。
- Root随后开始PM修正，本文结论及行号始终绑定495cbfc。后续静态读取使用 `git show 495cbfce...:<path>`，不得把本文FAIL或作者旧PASS沿用到未复核的新候选。

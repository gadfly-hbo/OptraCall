# Issue #149 最终独立后端复核

- 固定完整候选：`6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`；基线 `699e425cb0900b50385377d638495069fa726761`。起始及结束均核 HEAD／工作树，产品、测试及依赖相对候选无差异。
- **结论：本独立后端审查通过，在本范围可合并；未发现剩余必须修复项。** 首审 FR01–03、二审 SBE01–04 以及最终 FBE01–05 的本后端问题已关闭或按其既有正常合同重验通过。Root 的整包检查、其他独立范围及准确交付 CI 仍各自核定，本文不替代这些结果。
- 本人未参与任一实现，只读核验产品／测试／依赖及原权威。原 `backend-review.md`、`backend-final-review.md`、`backend-accepted-review.md` 中绑定 7fe／be1／a571 的 FAIL 和原反例完整保留，没有改写为原候选 PASS。本次只写 `.local/pm-final/` 探针、合成数据与报告，没有 commit/push、真实模型／Provider／凭据／设备操作。

## 修复关闭的独立依据

**FBE05 原 Plan 来源资格。** 重用上一轮官方 Pi `SessionManager` 探针，真实 ProjectStore／Plan Task、原 SDK 原生合成 ledger、原 `service.issueWrite(plans)` 建立方案，初始 `checkPlan` 通过；再逐一测试源项目归档、源 Plan Task 归档、原 native 暂不可读和 Host recipient qualifier 撤销。原 choose 与新请求保存分别同码拒绝：`project_archived`、`case_issue_source_scope_mismatch`、`case_issue_reply_unavailable`、`case_issue_recipient_unavailable`。每种情况下：旧未答在 service／declarations／home 均待核、pending 为空，原已答仍 answered，原 completed operation 可只读回放。恢复原来源后准确取舍成功 answered，原 native 字节相同。

静态追踪确认此行为直接复用原 `checkPlan`／`qualifyPlanReply`，不是另写来源权限规则；首页由 server 注入同一 `caseDecisions.checkPlan`。缺少该 callback 且确需 native 来源时保守待核。没有 issueId／native 来源要求的旧共享策略仍沿原许可。证据：`backend/source-after-release.mjs`、`backend/source-after-release-results.json`、`backend/source-after-release-output.jsonl`。

前三种是实际隔离文件／项目元数据的生命周期变化；recipient 是向原 callback 合同注入隔离拒绝，未声称实际账号或真实 Provider 撤权。

**FBE04 原目标生命周期。** 真实 Store／原 service 或 Board handler 矩阵确认：未答方案归档后 superseded、新请求拒 `case_decision_archived`；恢复方案回到 open，未自动重放。Case 关闭后的未答 choose superseded，原 choose 和新保存均 `case_closed`。项目归档后未答 observe superseded，新请求与原反馈 handler 同样拒 `project_archived`，恢复项目后可继续。原 Store 选择准入已原样抽取为 `assertStrategyChoiceTarget` 供 choose／request 共用，准确 current choice 链同时回核。

原合法历史边界保持：已答 choose 不因后续方案归档／Case 关闭改写；已答 observe 不因项目归档、授权撤回或换 choice 改写；未答在授权撤回／换 choice 后 superseded；Case closed＋Board task done 的原反馈仍能成功并 answered；active 策略后续修订不阻止原允许的显式 historical 版取舍。证据：`backend/matrix-after-release.mjs`、`backend/matrix-after-release-results.json`。

**FBE01–03 准确请求与原读取权威。** 原三个负例重新执行：A 专属方案不能保存为 B 的请求，拒绝且无操作回执；不存在反馈基线拒保存、旧坏引用待核，合法基线的准确原反馈回应 answered；真实 report-confirmation item 撤销原读取 gate 后拒新请求、旧请求待核并退出 pending，另一合法请求保持 open/pending，恢复资格后可继续。同 item 的原 Board handler 仍使用同一权威。证据：`backend/release-afterfix-probe.mjs`、`backend/release-afterfix-results.json`。

**FR01–03／SBE 及输入保全。** 独立复跑真实 GoalStore＋原 CaseRoutes 的候选冒认采纳、目标不存在及具体策略不属于该版，均被原权威拒绝；正常候选明确采纳并创建有原回执。目标 v2 采纳后，原 v1 已结束 Case 仍准确 continue、不自动重开。真实目标 A 采纳后 Case 确定失败，换目标 B 返回 `prepare_draft_goal_mismatch`、B 未被采纳；修正原 A 后续建保留原采纳回执。无关 case_note 不能冒认创建。

原 Case 后续编辑后，原创建输入＋operation 仍回原不可变回执、编辑保留，改意图仍冲突；原生产 `case_transaction_outcome_unknown/503` 合同仍表达 unknown／partial_unknown。同根双草稿 Store 并发 CAS 一胜一409；非空正文追加、片段 owner、防重及原文／来处保留正常。Board schema4→6、带引用及普通反馈混合保存、两次关闭重开和3条旧新对象逐值保全再次通过。UNKNOWN 为生产错误合同注入，不声称制造了磁盘提交丢确认；同进程 CAS 不扩大为跨进程原子事务。

## 首次创建的实际安全接缝

新增初始化已用**真实 WorkspaceDaily handler＋原 CaseRoutes＋真实 Case/Goal Store**独立执行，未将它冒称网络 HTTP。server 的 callback 接线静态一致：只有明确 create POST 且状态为 uninitialized 才调用原 `POST /api/cases/storage/initialize`；GET 不初始化，unavailable 不重新初始化。

- 空根重复读取 home/directory 不增文件，坏 POST 不初始化；真实已采纳 G/S 的首次明确 POST 返回201，原 initialize 只调用一次；同操作回放仍同一个 Case，合计仅1案。
- 未标记的既有数据库返回 unavailable／503；初始化调用0次、原数据库字节不变、marker 仍不存在，读取同样无副作用。

证据：`backend/release-initialization-probe.mjs`、`backend/release-initialization-results.json`。没有绕过原初始化权威或放宽旧库恢复保护。

## 命令、版本与边界

工具链 Node 25.9.0，现锁定 npm 依赖不变。通过 `git archive 6bc7be28` 固定 `backend/release-snapshot/` 产品源码及适用测试，所有修后探针导入该快照，避免后续文档或并发工作污染版本归属。

- `node .../source-after-release.mjs`、`node .../release-afterfix-probe.mjs`、`node .../matrix-after-release.mjs`、`node .../release-initialization-probe.mjs`、`node .../release-schema-probe.mjs`：均 exit0，实际输出／合成根在同前缀 JSON／JSONL 收据中。
- 固定快照执行 `case-preparation-recovery`、`case-declarations-second-review`、`case-decision-requests`、`workspace-daily-backend`、`case-directory-pagination`、`case-request-plan-qualification` 六个测试文件：**25/25 PASS**，日志 `backend/release-targeted-tests.log`。
- 结束 `git diff --exit-code 6bc7be28 -- src tests package.json package-lock.json` 为0，工作树干净。没有并发启动 Host，避免与 Root 整包检查的启动资源争用；完整 `npm run check`、网络 HTTP／Pi 整链路、产品 UI、CI 及设备采用由各自记录核定。

## 四原则专项（本后端与受影响接缝）

| 原则 | 实查结论 |
| --- | --- |
| Host 管环境 | owner、原目标／来源资格、准确版本／选择链／基线、归档保护、原回执、草稿和明确初始化均沿原权威；曾发现的缺口已因果复验关闭。**通过**。 |
| Agent 自主执行 | 请求／关系／创建的保存契约没有新增分析步骤、方法配额、计算或 Host 业务归属推断；权限失败交回原问题，不重造推理流程。**本范围通过**。 |
| 优先复用 Pi／原能力 | 复用原 CaseRoutes、Goal/Case/Board Store、checkPlan、确认读取及原选择准入；没有第二完成表或 Runtime／重试循环。独立探针使用官方 SDK 公共 SessionManager，未修改 SDK／依赖。**本业务接缝范围通过**；整体 SDK 运行采用由 Runtime 独立报告。 |
| 减少人的操作 | 原回应保存派生完成，无首页二次完成；已采纳不重采纳，原操作恢复不重建；来源失权不制造正式可操作待办，输入保留；首次明确创建自然沿原初始化，GET 无隐式写入。**本范围通过**。 |

本通过结论只绑定6bc固定代码及上述范围；原 FAIL、未测的真实模型质量、用户产品验收和设备采用继续分别保留。

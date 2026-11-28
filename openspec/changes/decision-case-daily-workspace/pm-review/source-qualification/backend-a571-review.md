# Issue #149 a571 独立后端审查

- 固定完整候选：`a571245698d432d39e3fbdbcfee423ebc06fd919`，基线 `699e425cb0900b50385377d638495069fa726761`。起始 HEAD 与干净工作树已核；原 7fe／be1 不可合并报告完整保留。
- **本候选仍不可合并。** 原 FBE01–03 和上一轮明确生命周期反例已关闭；原 `CaseDecisionService.choose` 还要求方案的准确原生来源当前有资格读取，新请求保存／投影仍没有复用此权威，形成新的真实反例 FBE05。文件名是 Root 指定的输出位置，不表示验收通过。
- 本人未参与产品／测试实现；仅写隔离探针、合成数据、收据和报告，没有修改产品、测试、依赖、规范或提交推送。

## FBE05 / P1 / DW08–09、DW16：取舍请求绕过原 checkPlan 来源资格

- 原正式入口 `src/host/case-decision-service.ts:269–271` 在新取舍写入前执行 `issues.checkPlan(target)`。`src/host/case-issues.ts:142–164` 中，这一原权威回核项目可写、准确 Plan Task／事项归属与未归档状态、真实已完成 native reply／hash、原 readSource 及 Host qualifyPlanReply。新 `chooseRequestStatus` 和 `saveDecisionRequest` 没有核该权威。
- 独立探针使用真实 ProjectStore、官方 Pi `SessionManager` 写入的隔离合成原生 ledger，以及原 `service.issueWrite(...,'plans')` 接受方案；**初始原 checkPlan 通过**。未调用模型、Provider 或网络 Host。
- 对这个原本合法的正式方案逐一执行真实来源生命周期操作：

| 来源变化 | 原 CaseDecisionService.choose | 新请求与旧请求／首页 |
| --- | --- | --- |
| 原项目 archive | 拒 `project_archived` | 新请求仍保存，旧／新均 open/pending |
| 恢复项目后，原 Plan Task archive | 拒 `case_issue_source_scope_mismatch` | 新请求仍保存，全部 open/pending |
| 恢复 Task 后，原 native 文件暂时不可用 | 拒 `case_issue_reply_unavailable` | 新请求仍保存，全部 open/pending |
| 原文件恢复同字节 | 原 choose 成功，准确请求 answered | 原 native 字节比较相同 |

- 这不是缺失初始合法性的 fixture：真实初始 `issueWrite`、`checkPlan` 和最终来源恢复后 `choose` 均成功。中间原 write gate 拒绝而 pending 保持 open，是确定的职责接缝缺陷。
- 证据：`backend/plan-source-lifecycle.mjs`、`backend/plan-source-lifecycle-results.json`、`backend/plan-source-lifecycle-output.jsonl`。最后结果绑定 a571；Root 与修复 Agent 已收到完整因果。
- 最小修复／验收：新建或修订请求及逐请求未答投影复用**同一原 checkPlan**；首页由 Host 注入该权威。来源失权／暂不可读时拒新正式请求，旧未答显示准确待核／替代，不进入可操作 pending；准确已答、原 completed operation replay 和无 issueId 的旧共享策略保持原规则。不要复制新的来源权限机制或将所有旧版一律作废。

## 已关闭原项与必要正常路径

为避免获授权修复期间的源码漂移，将 a571 的 `src/extensions` 及五个针对性测试通过 `git archive` 置于只读用途隔离快照 `backend/a571-snapshot/`；以下复验导入均指向该固定快照。

- 原三个负例：跨事项专属策略拒保存且无原操作落盘；假反馈基线拒保存、旧坏引用待核；report-confirmation 撤权沿同原 gate 拒新保存，旧请求待核，另一合法请求仍 open/pending，恢复原资格后回到 open。准确正常 choice／feedback 会 answered。
- 上轮生命周期：未答方案归档后 superseded，新请求拒 `case_decision_archived`；恢复方案后 open、未自动重放取舍。Case closed 的未答 choose superseded，新保存和原 choose 均 `case_closed`。项目 archive 的未答 observe superseded，新保存及原 Board handler 同样 `project_archived`；restore 后原反馈可继续。
- 没有新增不当门槛：Case closed＋Board task done 原反馈仍成功并 answered；active 策略后续 rev2 不阻止显式 historical 原版回应；显式 Board revoke／换 choice 后未答 superseded、已答仍 answered；准确已答 choose 不因后来的方案 archive／Case closed 改写。
- 原创建不可变指纹、Case 后续合法编辑保全、实际 UNKNOWN 错误码、同根双 Store CAS、片段准确 owner／防重／原文、真实 GoalStore 准入和 v2 采纳后原 v1 已结束 Case 明确 continue 均再次正常。
- Board schema4→6、普通／带请求引用／后续普通3条反馈逐值保全和两次重开再次通过。

## 实际检查

- `node .../a571-afterfix-probe.mjs`：exit0，8组原反例／正常回执；`backend/a571-afterfix-results.json`。
- `node .../matrix-after-a571.mjs`：exit0，10组生命周期／历史合法边界；`backend/matrix-after-a571-results.json`。
- `node .../a571-schema-probe.mjs`：exit0；`backend/a571-schema-results.json`。
- a571 隔离快照五个针对性测试：**23/23 PASS**，日志 `backend/a571-targeted-tests.log`。这些测试没有覆盖 FBE05，不能据其全绿消除实际缺陷。
- `node .../plan-source-lifecycle.mjs`：exit0，初始／失权／恢复完整反例收据；所有数据仅在隔离根。Node 25.9.0，锁定依赖未改。Root 的全量 check／CI 另报，没有用并发 Host 启动失败作为产品结论。

四原则专项：本后端 Host 环境治理因 FBE05 **不通过**，减少人工操作因无法回应却仍正式待处理 **不通过**；本范围未见 Host 侵入 Agent 分析流程，Agent 自主执行检查通过；创建／原反馈／回执及 SDK 复用保持原权威，无平行 Runtime，本业务复用检查通过。完整官方 SDK／Pi 整链路由 Runtime 独立报告，不在这里扩大通过范围。

FBE05 修复后须重新固定并独立复验；本报告、之前 FAIL 与原证据不删除，不将未来拟修复写成当前 PASS。

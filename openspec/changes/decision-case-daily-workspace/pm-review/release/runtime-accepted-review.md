# Issue #149 Runtime 最终 head 适用复核

**结论：通过，Runtime 子审建议合并 `a571245698d432d39e3fbdbcfee423ebc06fd919`，无剩余必须修复项。** 开始和结束均核同一 HEAD、工作树 clean。完整 check、其他子审、Git/CI与产品验收由 Root 分别汇总。

本人仍未参与实现；只读产品、测试、规范、SDK和依赖，仅在 `.local/pm-final/` 写独立报告/探针/合成根。此前原 FAIL 及 [be1 最终 Runtime 报告](runtime-final-review.md)和真实9项测试原日志全部保留。

## 本次 delta 实核

独立逐项检查 `be1fd36ad449d89d2fc21655ccbbb61cf8b6bdbf..a571245698d432d39e3fbdbcfee423ebc06fd919`：

- 新请求保存/投影只复用原业务当前生命周期：取舍目标的**当前**方案已归档则拒绝新请求；原未答请求在归档方案或关闭 Case 后派生 superseded。先识别准确历史 answered，再检查当前生命周期，因此不改写原已答结果；活跃方案准确旧版及原 allowHistorical 权利保留。
- 观察新保存、读取目录及待处理派生沿原 `linkedProject → projects.get → assertActive`，首页由 server 注入同一真实项目准入。归档项目新请求被拒、未答退出正式pending；原已答保留，恢复后可继续原请求且不重放反馈。Case closed/Board done 没有被错误扩展成观察禁令。
- 新 `await linkedProject` 留在原 mutate 操作内；之后仍进入同一 CaseStore transaction 的新写前 guard 和 **COMMIT前 guard**。已完成 operation 路径依旧先准确回读，不再运行新资格或重复业务保存。未改变总revision捕获位置、实体CAS、owner绑定、原来源身份、请求摘要/legacy回放。
- `src/host/server.ts` 仅增加首页 `assertActiveProject` 注入一行。`strategy-discussion-host.ts`、公共 `agent-sessions.ts`、Case目录、Agent工具定义/执行/IPC、package/lock和边界脚本相对 be1 **git diff --exit-code=0**。所以 be1 实际 Pi 的 owner、取消/配置撤资格、目录与原三反例修后结论仍适用；没有把它们伪写成已在 a571 全部重跑。
- 原测试断言对齐与最终合同一致：Case Agent 的能力是原owner绑定 `strategy_goals`，不是旧空工具断言；反馈baseline已移动的未答请求是 superseded，选中的准确请求才 answered。没有删掉owner/取消/CAS断言或扩检查白名单。

## 在 a571 新跑的独立增量验证

Node25.9.0，单并发、隔离 TMPDIR，命令：

`node --test --test-concurrency=1 --test-name-pattern='DW-SECOND-04|DW-SECOND-05|DW-SECOND-08|DW-FINAL-LIFECYCLE-01|DW-FINAL-LIFECYCLE-02' tests/case-declarations-second-review.test.ts`

结果 **5 PASS / 0 FAIL / 0 SKIP**，日志 `accepted-runtime-delta.log`。覆盖新两类生命周期，以及原 edge/request COMMIT前取消及receipt回滚、取消后的已提交回执回读、并行总revision/实体CAS、旧operation兼容回放与改变意图冲突。

另为本次新异步窗口运行自有真实 Service/CaseStore/Board 探针 `accepted-cancel-project-read.mjs`：持住 `projects.get`，确认观察保存已进入新的项目资格读取后取消，再释放读取；结果 **新请求0、准确operation receipt=null**，exit0。收据 `accepted-cancel-project-read.json`，日志同名 `.log`。这是真实业务提交边界验证，不冒称新增 Pi 端到端测试。

## 保留适用的真实 Pi 证据与四原则

be1 实际执行的9项测试（日志 `fixed-commit-cas-replay.log`、`fixed-runtime-permanent.log`、`fixed-case-owner-pi.log`）及 `fixed-runtime-*-receipt.json` 仍绑定 **be1**。本次通过明确无关 delta 的代码核对沿用：真正 Case business owner 读准确身份→同批edge/request→依据回执各自CAS修订；goal-draft有界目录；普通project旧工具并存/双声明；原公有stop、仅换key/换线路撤资格及原Provider不再续发。没有宣称这些9项全部在a571重跑。

四原则对最终增量仍通过：**Host管环境**，新增的是原项目/方案/Case生命周期资格与状态投影；**Agent自主执行**，没有新增推理步骤、强制工具顺序或补算；**优先复用Pi**，SDK1.4.0/Interface v3及原公共域、工具、取消、事务权威不变，无新运行状态账或SDK改写；**减少人的操作**，不再把原业务准入已不允许回应的请求留作正式待办，既有答案与恢复路径保留，无新增普通读取审批或手工机器身份。

本结论限本地工程接缝及 Runtime 专项，不代替真实模型质量、经营效果、CI、部署或设备采用。

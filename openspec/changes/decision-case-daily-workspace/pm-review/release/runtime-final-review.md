# Issue #149 最终非作者 Runtime 复核

**结论：通过。本 Runtime 子审建议合并，未发现剩余必须修复项。** 结论绑定完整固定代码 `be1fd36ad449d89d2fc21655ccbbb61cf8b6bdbf`，基线 `699e425cb0900b50385377d638495069fa726761`；检查前后 HEAD 相同、工作树 clean。完整 npm run check、UI/后端子审和准确 head/main CI 由 Root 汇总，本报告不代替这些工程条件或用户产品验收。

复核者未参与任何候选实现。源代码、测试、规范、SDK及依赖全程只读；自有脚本、输出和合成运行根仅写 `.local/pm-final/`。没有 commit/push、安装或修改依赖、调用真实 Provider、读取真实业务根或凭据。重读原 AGENTS、工程规范四原则/官方 Pi/IN01–07/非作者最终规则、统一会话接入说明、冻结 spec、pm-integration 和原二审记录，并独立检查 `7fe8e9..be1fd36` 全部 Runtime 增量。

## 原 FAIL 与修后证据

原固定 `7fe8e936d2463e514f2d8b08deae23f8c0467e24` 的三项发现和真实反例保留于 `runtime-review.md`、`runtime-probe-receipt.json`、`runtime-late-receipt.json`。本轮没有改写这些 FAIL。早先 `afterfix-*` 工作树验证只作过程证据；以下重新在最终 SHA 新建隔离根执行的 `fixed-*` 才是本次结论依据。

| 原发现 | 最终代码实查 | 本人独立重验 |
| --- | --- | --- |
| FRR-RT-01/P1：配置已失效，旧 Case Provider 响应仍首次保存关系 | Case Host 比较创建 resource 时捕获的全部配置身份（包括 apiKey），snapshot 抛错也撤资格；提交前 guard 复核；异步 readDeclarations 返回后再次复核。撤资源复用原 domain.close，无自等或第二份生命周期。普通 project callback 同样核捕获身份，snapshot 自身抛错也经原 projectSessions.close 撤资源。 | 原反例的新根结果：同 owner GET 仍准确409 configuration_changed；迟到 edge **null**、准确派生 operation receipt **null**、旧 Provider **仅1次请求**。原 native 为拒绝工具回执。永久真实 Pi 分别验证换线路与仅换key，均 PASS。 |
| FRR-RT-02/P2：单 Case 事项无界，目录413且不能续读 | Case/事项分别显式分页、整行预算、nextOffset/nextIssueOffset/totalIssues/issuesTruncated；准确 ID/标题不截断。CaseId 只筛选原可见集合，未扩读取范围；已结束记录需明确 includeClosed。原准备 UI 有按需更多Case/事项接线与迟到响应保护。 | 单Case132合法事项、limit1：真实 goal-draft Pi 返回5项及 total132/nextIssueOffset5，**isError:false**，无原413。另逐页读完132项，7页、132个唯一准确ID，无缺失/重复，最大一页6345字符，Case revision未改变。 |
| FRR-RT-03/P2：普通 project 两新声明在 gate 外冻结总revision | 两 callback 均改用受信 currentCaseRevision 模式，复用 Service 在 mutate 内取当前总版本；写入口 pair 使用 writing=true。实体CAS和普通HTTP显式总revision仍严格。 | 原受控gate反例新根：两声明均成功。真实普通project Pi同批edge/request保存、public stop迟到拒绝、仅换key和换线路迟到双工具拒绝均 PASS，SQL原成功revision不变。 |

准确迟到 operationId、源码 SHA-256 与实际安装包版本：`fixed-runtime-summary.json`。所有新 native 路径均在收据或测试 diagnostic 内，可直接复读。

## 独立执行结果

Node `/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node`，所有命令的 TMPDIR 设为本审查的 `runtime-tmp`；永久测试使用 `--test-concurrency=1`。合计 **9 tests PASS / 0 FAIL / 0 SKIP**，另两份自有原反例探针 exit0。

- `fixed-commit-cas-replay.log`：`--test --test-concurrency=1 --test-name-pattern='DW-SECOND-04|DW-SECOND-05|DW-SECOND-08' tests/case-declarations-second-review.test.ts`，3/3。覆盖 edge/request 在 COMMIT前取消的事务及receipt一并回滚、取消后已提交回执只读、总revision并行、实体CAS与改变operation意图冲突、新旧aggregate/current operation准确回放。
- `fixed-runtime-permanent.log`：`--test --test-concurrency=1 tests/case-declaration-config-change.test.ts tests/case-project-declarations-runtime.test.ts tests/case-directory-pagination.test.ts`，5/5。真实 Case Pi 换线路/仅换key、真实普通project并行声明/公有stop/换key/换线路，以及Case/事项两层目录预算与完整分页。
- `fixed-case-owner-pi.log`：`--test --test-concurrency=1 tests/case-declarations-pi-second-review.test.ts`，1/1。真正 `{role:'case',caseId,itemId}` 先读 issues/strategies 的准确身份，再同批保存edge/request，再读原回执，以各自CAS同批修订至v2；承担人与日期保留。共5次合成Provider请求，保存权威由实际SQL/首页投影核实。
- 自有 `runtime-probe.mjs`、`runtime-late-probe.mjs` 分别以 `REVIEW_LABEL=fixed-` 和完整 `REVIEW_CANDIDATE=be1fd36...` 执行，后者选 `REVIEW_CURRENT_CASE_MODE=1`。新根收据：`fixed-runtime-probe-receipt.json`、`fixed-runtime-late-receipt.json`；完整事项分页另见 `fixed-directory-pages.json`。

注：自有初始 probe 中旧字段 `hasIssueContinuation` 仅检测名为 `continuation` 的属性；新合同实际使用 `nextIssueOffset`。本轮根据真实 native 的 `nextIssueOffset=5` 和7页完整回读判断分页成立，不误用该旧探针字段否认新合同。

## Owner、来源与兼容实查

- Case 继续复用原 `business-role-discussion` 域的真实 `{role:'case',caseId,itemId}`；goal-draft 使用独立可恢复 draftId/scope，均经过既有公共生命周期/同一 SDK。未增加 domain、opening/operation/代际Map或会话循环。
- Case声明读取显式返回 caseStoreId/caseId/issueId/caseRevision/section 和页边界；请求、取舍、观察限当前事项，issues/edges限当前Case。保存时 edge 两端分别由 Store核本案，request由Host绑定itemId、修订不得换事项；新增修复也拒绝把另一事项专属strategy用于本事项。观察引用继续核原真实项目、选择链、授权与准确反馈baseline/原来源资格。
- 模型不提供 Case权限、业务owner、operationId或伪造来源；operation由真实 owner/request/session/toolCall 派生，source指向实际 native调用。新旧operation摘要及fallback按原不可变提交事件核验，改变payload仍冲突，不因今天总revision变化重写旧操作。
- 普通项目旧 `read_case_decisions` / `save_case_decision_draft` 仍真实出现在本人 Pi native 的tools；新两声明并存。封闭/工作区/受管资格沿原 feature gate；新增业务能力没有替换原普通分析工具。公共Interface仍v3，无公共会话或边界白名单变更。
- 已完成事务保留；取消/配置失效/关闭撤销的是迟到新写资格。Service gate内与 Store事务新写前、COMMIT前复核同一受信guard；已完成receipt回读不再次执行写。未引入后台重放、换模型或第二套状态权威。

## 四原则最终结论

1. **Host管环境：通过。** 实际代码只承担owner、读取资格/预算、来源、配置身份、取消/关闭、版本/CAS、原业务事务和回执。原配置迟到写缺口已由真实反例关闭；Host没有根据标题/顺序生成关系或代作人的取舍。
2. **Agent自主执行：通过。** Agent自主选择目录分页、工具组合、执行顺序、内容和纠错。新工具是业务读写能力，不是固定推理脚本；保留官方Pi合法并行工具，没有通过强制串行掩盖revision错误，也无Host补算或模型编排。
3. **优先复用Pi：通过本次增量。** actual pi-coding-agent/pi-agent-core/pi-ai均1.4.0；package/lock官方registry来源与integrity、本轮无deps/SDK变更已核。使用原公开工具注册、SDK执行/取消、原IPC与公共domain/port；新配置资格guard填补已证实的dispatch后缺口，复用原close。没有改SDK原对象/包、另造Runtime或生命周期账。本次未逐文件对照npm tarball，不扩大为全包完整性或运行服务采用证明。
4. **减少人的操作：通过本Runtime范围。** 已知事项可直接继续、Agent按明确声明保存；读取不用逐项审批，目录续读可自主完成。可选人工目录按需更多，保留准确ID/原文，不要求用户拆资料或维护机器身份；创建前主动模型辅助及人工路径仍分开，必要采纳/经营取舍保留给人。完整浏览器链由Root另一独立子审覆盖。

本报告证明最终候选的本地合成工程接缝及上述职责边界；不声明真实模型内容质量、经营效果、用户产品验收、CI、部署或设备采用。

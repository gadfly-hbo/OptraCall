# Issue #149 source 集成增量独立后端复核

- 固定 source：`2eb30a51e31333a4252d4b6564bb0ad3a66326b8`，工作树 `/workspace/OptraCall-issue149-check-followup`。
- 上轮已通过后端候选：`6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`；原基线 `699e425cb0900b50385377d638495069fa726761`。
- **结论：本后端集成增量审查 PASS，未发现新增必须修复项。** 该结论不表示完整 check／CI 已通过；原固定6bc完整 run仍在执行，catalog 原 FAIL 当前仍待最后失败栈。

## 增量与原结论适用性

完整6bc→2eb差异只有4文件：`CaseIssuePanel.tsx`、新增 `case-request-response-ui.test.ts`，以及已独立审查的 `conclusion-review-handoff.test.ts`／`fr01-03-05-repro.test.ts` 两项测试修正。已执行非 UI 的 `src/host`、`src/agent`、extensions、package／lock 差异核验，**无变化**；`git diff --check` 通过。

因此 [原后端 release review](/workspace/OptraCall-issue149-final/.local/pm-final/backend-release-review.md) 对相同后端字节的 FR01–03／SBE01–04／FBE01–05 关闭结论、原权威与四原则范围仍适用。原 **25/25** 成绩属于固定6bc，**本次经字节核验沿用，未在2eb重新运行这25项**。没有把原 FAIL 改成原版本 PASS。

## 本次实际复核

- 请求 UI 增量按 `recordId@revision` 保留准确历史版；通过原 revision API读取，核对 CaseStore／Case／record／revision／issue 与当前归档资格；历史版明确确认才带 `allowHistorical:true`，准确请求引用保留。切换事项不借用原事项 initialRequest，当前版普通路径保留。此处未增加后端准入或写入权威，最终仍由原 Store／checkPlan 校验。
- 新增 UI harness 独立执行 **5/5 PASS**：历史版精确读取／确认、切至另一事项的正确请求、403不替换旧版、当前版普通回应、401／归档／错误owner保护。日志 `/workspace/OptraCall-issue149-check-followup/.local/pm-final/integration-request-response-ui.log`。这是组件与请求字段检查，不冒称真实浏览器或 HTTP／Pi 全链路。
- FR03仅将异步 service negative assertion改为 `await assert.rejects`，保留错误码与同步 Store `assert.throws`；无跳过或宽松断言。
- CNR仅接受原 fixture精确 driver PID／非空同 startTicks 的 Z为原 writer已退，ESRCH分支及原5秒保留，非Z／身份不同不通过；原 interrupted／UNKNOWN／no replay／no invented cleanup／字节保全全部断言未改。其先前独立精确 PID RED→GREEN 证据与本 delta审查见 [完整检查调查](/workspace/OptraCall-issue149-final/.local/pm-final/fullcheck-failures-review.md)，本次未重新启动 Host。

## 四原则与交付边界

后端环境治理、Agent自主执行、原 Pi／Store／资格复用及减少人工操作的原6bc专项通过结论，对未变化后端继续有效。新增历史版确认对应原显式 historical 业务取舍；准确引用继续交给原保存接口，没有 Host代作判断、平行 Runtime或第二完成权威。本后端增量范围通过；产品 UI视觉／完整交互由对应独立审查核定。

原6bc full-check、旧be1 CI及 catalog未完成归因继续保留。catalog孤立原断言1/1 PASS不能覆盖原完整 FAIL，也不能在缺少最终栈时宣称它已证明为启动环境问题。完整检查、准确head CI、工程合并和设备采用各自核定。

本人未参与实现或修改任何 tracked 文件；只读 source／测试／依赖并写 `.local` 报告与日志。结束 source HEAD仍2eb，tracked工作树无修改；预存未跟踪 `node_modules` 不属于本人操作。

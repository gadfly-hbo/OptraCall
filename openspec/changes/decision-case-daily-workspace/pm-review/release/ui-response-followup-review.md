# Issue #149 原请求回应 UI 追加实证

- 固定候选：`6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`，源文件／测试只读。本追加复核由 PM 明确要求核两个具体 DW09 路径；没有泛化无证风险。
- **结论：两项实际产品 UI 缺陷已确认，本候选整体 UI 暂不可合并。** 首用、恢复和同事项片段链的原 PASS 仍成立；本次是新增的原请求回应覆盖。
- 独立命令：`ACCEPTED_HEAD=6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb /workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node .local/pm-final/ui-historical-request-probe.mjs`，exit 0（探针成功复现缺陷）。[收据](historical-request/receipt.json)结果 `CONFIRMED_HISTORICAL_PLAN_AND_REQUEST_FOCUS_UI_DEFECTS`；[日志](ui-historical-request.log)；[截图](historical-request/historical-request-and-sidebar.png)。实际使用从固定新源码编译的产品 UI、真实 Host／HTTP 和 Chromium。

## FUI-02 HIGH / DW09：合法原历史方案请求不能从首页准确回应

合成 setup 沿真实 CaseStore 公开保存方法：先合法建立 Case／事项 A；原关联项目／任务中的 Case 策略 rev1，再正常保存活动 rev2；明确请求引用原 rev1 和 A 的准确选择链。未改数据库内部行，也没有伪造服务响应。首次 Home HTTP 投影中该请求确实 open/pending。

实际 UI 路径：点击 Home“请求 A：请回应准确历史方案 v1”→原 A 事项“记录本次取舍”。准确方案下拉只列 `准确方案A新版 v2`，没有原 rev1；页面提示“原请求的准确版本或方案尚未核对”。无法选择、核定并精确回应该原请求。

对照同一真实 Host 的原 choice API：`allowHistorical:true`＋准确 rev1 strategyRef＋同一 requestId/revision＋原选择链，成功保存选择，原请求立即 answered。因此这是 UI 路径缺口，不能把原请求判失效或限制后端历史资格来掩盖。

原因：IssueWork 的 plans 仅用默认 `history:false` 的最新 head 列表；initialRequest 查找要求 exact revision，但没有原请求准确版读取。当前选择值与 `plan` 查找又只有 recordId，不足以同时区分 rev1/rev2，提交也不带明确的 allowHistorical。

最小建议：复用 `readCaseDecisionRevision` 读取被选原请求的准确版本／当前 lifecycle；选项按 `recordId@revision` 保持精确身份。明确展示“原请求 v1，当前活动 v2”，用户明确选择原历史版后，原确认按钮携带准确 `allowHistorical` 和 `respondsToRequest`。保留当前方案和后端原校验，不默换 latest、修改原请求或另建完成状态。

## FUI-03 HIGH / DW09：从 A 请求进入后切 B，A 焦点使 B 的单条原请求无法关联

同一 Case 另有事项 B、准确方案 B v1 和唯一合法 open 请求 B。先沿上例从首页进入 A 请求，再在当前事项侧栏明确切 B，选择方案 B、填写明确回应理由并点击“确认取舍”。

实际保存的 B choice 没有 `respondsToRequest`；B 请求随后 `superseded`，没有 answered。页面没有 B 的精确回应确认提示，也没有单一 B 请求的选择控件。原 B 请求确实存在且准确可操作，不是模型或读取失败。

原因：`initialRequest` 只有 requestId/revision，仍从 A 沿父级传给 B 的新 IssueWork；虽然 exact 查找过滤了 issueId，`!initialRequest` 条件仍阻止 B 单请求匹配，且请求下拉只在多个匹配时显示。仅清 responseKey 不能修复该条件。

最小建议：请求入口焦点同时绑定准确 issueId，或父组件仅在 activeIssueId 等于入口原事项时传 initialRequest。用户明确切到 B 时清除 A 焦点，保留 B 自身准确请求匹配／选择逻辑，不自动把 A 请求关联到 B，也不额外要求用户返回 Home 才能回应 B。

## 其他追加问题与边界

PM 另问的“运行中从 Home 追加会把已发旧话留到下次发送”已用真实官方 Pi＋持住回复的合成 Provider 检查，**本次正常路径未复现该缺陷**，见 [限定记录](ui-pending-append-review.md)。没有把它与上述两个已证实 UI 缺陷混作阻断。

历史方案探针先前有两个自有 setup 错误（缺原关联项目、document 初始为空），分别保存在 `historical-request/harness-*`；修正的是探针前提／等待，没有改产品／测试，也没有用它们当产品 RED。

本次四原则：Host 的原精确来源／版本权威和 Agent 自主执行边界未被后端放宽；但 UI 未完整复用原历史选择能力、还让用户需重找入口／改请求，**“复用原权威／减少人的操作”在 FUI-02/03 路径不通过**。修正后需固定新完整候选，独立重验两个原反例，再更新最终可合并结论。

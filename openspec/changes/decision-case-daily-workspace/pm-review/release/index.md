# PM 最终候选验收索引

本目录保留 PM 接收二次交接后直接修复的独立证据。原作者候选 `495cbfce171cf28f8fcb65c0ad391718c3b5cca0`、首审退回、其自报 PASS 和 PM 后续发现分别记录；不能用新候选通过改写原失败。

当前源候选为 **`8dd24cae613bf9f1b4dd1ca79e1d8102289431b9`**；其生产代码与下述独立接受的 `2eb` 相同，唯一新增为原创建确认后的测试基线同步。[第五项失败因果与修后复验](fullcheck-failures-followup.md)及 [8dd 测试增量复核](runtime-admission-test-review.md)已通过；完整检查与远端交付结果仍单独核定。

## 已固定的业务接缝

- 后端、Runtime 和首次使用的基准为 `6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`：[后端](backend-release-review.md)、[Runtime](runtime-release-review.md)、[首次使用与恢复](ui-release-review.md)。后者先前未覆盖的历史请求／切换事项缺口，按[追加实证](ui-response-followup-review.md)暂缓整体 UI 合并结论。
- 最终源候选 **`2eb30a51e31333a4252d4b6564bb0ad3a66326b8`** 只修 CaseIssuePanel 的准确历史版本和原请求事项焦点，原真实反例与失权负例已复验通过，见 [UI 最终接受](ui-response-accepted-review.md)和精确提交绑定；[后端集成复核](backend-release-integration-review.md)、[Runtime 集成复核](runtime-release-integration-review.md)亦通过。
- 运行中追加片段的额外怀疑在所测正常路径未复现；[限定记录](ui-pending-append-review.md)保留，不将猜测当作缺陷。

## 验证身份

[完整检查失败调查](fullcheck-failures-review.md)保留原失败及因果；原 be1 CI 的两项失败见 [原回执](ci-be1-original-failure.json)。尚未完成的完整检查不能标成通过。

[6bc 完整原失败](full-check-6bc-original-failure.json)为 3,602 项／3,401 通过／5 失败／196 条件跳过；[两项启动超时复验](startup-timeout-review.md)没有改变原启动时限或关闭整包门禁。旧报告中的绝对路径保留当时位置，本目录相应报告／回执提供公开归档入口，不将本地路径当作已发布附件。

沿用运行的原版本报告一并保留：[be1 Runtime](runtime-final-review.md)、[a571 Runtime](runtime-accepted-review.md)、[be1 UI](ui-final-review.md)、[a571 UI](ui-accepted-review.md)。它们保持原候选身份，后续报告只在已核无关差异范围内引用。

各报告明确列出实际候选、独立范围、使用的旧证据及新增执行；没有将相邻版本结果合并冒称全部在同一提交重跑。永久回归在仓库 tests 内，实际产品使用隔离合成 Host／HTTP、未经修改的官方 Pi 1.4.0 和 Chromium。

原完整检查、旧 head CI、各修复前 RED、测试夹具适配失败及未证明项均保留。最终完整检查、准确 PR head CI 和合并 main push CI 各自核定；最终交付回执写回 [Issue #149](https://github.com/gadfly-hbo/OptraCall/issues/149)，不会将本文的局部通过冒作已合并。

## 四原则与范围

Host 保存原权威、准确版本／归属、权限／生命周期、草稿、回执和取消状态；Agent 自主选择分析方法与工具，不加固定分析流程。业务服务直接复用原 Goal／Case／Board 和 checkPlan，Agent 继续走官方 Pi／Interface v3 原入口，没有第二 Runtime 或完成表。默认当前事项、原保存派生回应、人工可用的统一准备和安全首建减少维护；旧版选择仍明确确认，取舍与行动授权保持各自原入口。

工程结果不等于真实模型质量、经营效果、用户最终产品验收或设备运行采用。未使用真实 Provider／业务材料，未更新双端运行服务。冻结 Demo 及其哈希不变。

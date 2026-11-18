# 非作者双轴复核

比较基线为 `69e766f10c1034cb335bdbb7b22540a0b26cd074`。两位新审查者各自读取同一固定差异及适用规范，此前均未撰写本轮实现。首轮候选为 `928ca47b7f57a3834bf8c9c40657678b4f84453a`。详细的后续复核对象与结论在本文末尾。

## 规范轴初审

1. **P1，IN07。** 合成项目的首个 POST 在到达 Host 前断网。实际 Chromium 操作中，1 次 POST、4 次 GET 后刷新，输入与发送仍锁住。发生在 BusinessRoleConversation 的本地待核记录与 Host 读取回执之间。
2. **P1，IN05。** 新的无 Plan 交接只检查所选成果当轮的 Case／项目资料。其原生会话前轮使用的受限资料可能影响后轮总结；接收模型缺少相应资格复核。
3. **P1，角色职责。** Case 角色上下文只取得策略引用。尚待取舍的 Plan 无正文，角色也缺回读方法。

规范轴另跑 23 项委托及成果测试和会话边界检查，通过。官方依赖固定在 Pi 1.4.0。本次没有重跑官方归档的逐字节检查。

## 规格轴初审

1. **P1，§1、T1/T3。** Case 人工界面可查的 Plan／Teach 原文没有送达 Case Agent，影响经营理由核对。
2. **P1，§3、§8。** 从事项创建 Teach 时遗漏当轮实际行动和看板反馈。初始用例由提问者写入“复购持平”，再登记看板反馈，无法证明从看板交接。
3. **P1，§1、T2/T3、§8。** Project Agent 在项目内综合 Task 成果时只核成果身份，缺接收模型对原业务资料的授权复核。
4. **交接缺口，§1、T1。** 原 Case 转入目标管理时页面能显示来源编号，目标 Agent 没有收到对应 Case 的业务依据。

规格轴确认七处抽屉接线和两种文稿的版本入口。五个新 Skill 的独立质量测评仍待用户组织。

## 修正与复测记录

角色消息恢复的浏览器红测保存在 `.local/product-v13/role-recovery-red.log`。补充按原 requestId 核原生条目的读取。已送达时从原回执恢复，确认未送达时用户可按同一编号发送；Host 已保留失败输入时沿原编号准备替代请求。可重复脚本为 `tests/browser-v13-role-recovery.mjs`。

消息恢复的正常入口再次覆盖实际 Pi 的在途回复：打开放大对话、Esc 收起、点击原停止按钮，Host 留下对应 requestId 的 cancelled 收据。浏览器另复验未送达时同编号发送、已送达而响应中断时只读恢复、跨后续请求读取旧回执，以及 Host 已登记失败输入后的替代编号。完整输出见 `.local/product-v13/role-recovery-cancel.log`。首审之后工程端另行完成官方 Pi 逐文件比对，详见 [回交记录](result.md)。

Case 补齐了取舍前的 Plan、取舍后的 Plan／Teach 原文，以及按明确选定反馈版本建立 Teach 的原行动和观察。目标管理按 Case 修订或所选 Task 原回复重新核读取资格。Project 与跨 Task 来源沿原生分支祖先、由工具实际交付的上游成果及当前接收模型检查授权，另有同项目无关来源的正例。正常产品入口、反例、准确材料和来源见 [Case](case.md)、[目标角色](agents.md)及 [Project](project.md)。

修正后联合测试中，Goal 进行中的 GET 曾返回 HTTP 500，保留在 `.local/product-v13/joint-handoff-check.log`。并行隔离复现得到 `native_snapshot_changed`，即 Pi 在读取边界核对文件大小、身份和更新时间之间追加了原生记录。该问题计入最终候选复验。

### Pi 嵌套读取 Task 成果的复验

合成用例在 `tests/project-host.test.ts:481`，走真实 Host、Pi SDK 与本地协议端。直接调用和 `codemode` 子调用读了同一手选准确成果，并在仍授权时交接给下游。原候选的嵌套父记录确实保存成功子调用及输入，撤权后却仍能重开这个接收会话；失败见 `.local/product-v13/case/nested-result-red.log`。

修复后，原生子调用与一条 Host 来源收据按原生会话、请求、Project、Task、子调用及准确来源身份匹配。收据未复制正文。撤回原企业材料后，直接接收、嵌套接收以及再次接手该成果的下游均拒绝重开、续发和再次交接；同样预选过该材料、仅实际读取另一独立成果的会话仍可继续。新用例和原 Project 权限用例联合 2/2，退出码 0，见 `.local/product-v13/case/nested-result-green.log`。原生父子及回执行身份摘录见同目录 `nested-result-native-evidence.json`。

## 第二轮固定差异

两位原非作者复核 `d7169e974e93fb32d11db774ed91ee870fc0a6a7`。规范轴确认角色消息恢复、Case 原方案两项关闭；直接读取和 DB 出口核验通过，指出合法 Pi 嵌套读取以及直接 Goal／个人资料的来源依然需要覆盖。规格轴确认 Case Agent、Teach、Goal 原来源和 Project 反向权限示例；其独立单项目、单 Case、单事项样本发现，回到 Project 的正向综合因缺少准确事项身份而看不到已获准 Plan。两轴均保留未通过的初审与此轮记录。

忙态读回的原始失败包含首次 HTTP 500、定位后的 `native_snapshot_changed` 和一次 Goal 显示终态时正文仍来自较早快照。修复期间的完整集成运行 `.local/product-v13/check-d7169e9.log` 记录了 11 项失败，执行期间同时有后续改动。涉及的六个测试文件随后单列重跑 28/28。最终整仓结果须按最终固定候选核对。

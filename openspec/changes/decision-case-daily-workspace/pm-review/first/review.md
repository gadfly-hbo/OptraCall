# Issue #149 PM 首审

2026-11-27 · PM：Codex（Decision Case）· **首审不通过，退回一次。**

## 固定对象与结论

- 正式交接：[Issue #149 回执](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7221030826)。
- 候选及远端分支：`fd0003e6441e75f9e7daae88e09f3a0411227f04`，`work/antigravity/issue-149-decision-case-daily-workspace`。PM 已独立 fetch 和回读，候选源码固定只读。
- 基线／当前 main：`699e425cb0900b50385377d638495069fa726761`；已包含目标管理修正 #150（原 #148），候选基线核对一致。
- 确认 UI v0.6 SHA-256 仍为 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`，未变。
- PM 重跑本次 6 个目标测试文件，**16/16 PASS**。这些测试证明其覆盖的 Store／HTTP 正常路径；没有覆盖下列真实功能缺口和独立负例，不能作为 DW01–18 全完成的证据。

当前已建立部分关系／请求／草稿基础设施，但正式入口与回应链未闭合，并存在目标准入、恢复意图、持久化和取消边界缺陷。不进入合并或工程结案，Issue 保持 Open；T17/T18 未完成。以下不是新的产品范围，均对应已确认 spec。

## 必须返工（本次一次性列明）

| 编号 | 问题与关键证据 | 修复／复验条件 |
| --- | --- | --- |
| FR01 · P1 | 新创建入口绕过原目标准入。相同 candidate G，原 `/api/cases` 返回 `409 goal_not_adopted`，新 `/api/workspace/create-case` 仅客户端称已采纳即 `201`；不存在 goal/version 或该版不含的 S 也成功。见后端 BE01。 | 复用原准确 GoalRef、该版具体 S、采纳状态、范围与 Case 准入，不能信任 alreadyAdopted。正常／未采纳／不存在／错误策略／资格失效均有真实 HTTP 回归。 |
| FR02 · P1 | 恢复身份和草稿保护错误：A 已采纳而创建失败，改选 B 后草稿写 B、实际 Case 绑 A；任意已完成 `case_note` 的 operationId 可被冒认为创建回放；同 expectedRevision=0 两并发草稿保存都成功为 revision1，覆盖输入；A片段可写B事项。见 BE02–04 及附项。 | 原意图／目标版／S／operation kind及指纹准确核对；换意图不借旧回执，保留原部分成功；同 owner CAS/追加/放弃原子保护，跨 owner 拒绝，不丢竞争方输入。 |
| FR03 · P1 | 请求关联反馈保存后重开 Board 报 `unsupported_board_schema`；不存在的授权或错误 caseStoreId 可被保存并认定 answered。见 BE05–06。 | 正式兼容迁移和 schema校验、保存→关闭→重开；请求与回应沿原 Case/项目/事项/选择链/授权/反馈基线核完整身份与资格，不能由客户端回填字符串自证。 |
| FR04 · P1 | 首页仍渲染旧“需要你处理”启发式队列：普通 active Case／可读报告造待办。新面板只传 caseId/issueId；真实取舍／反馈表单不带 respondsToRequest。普通取舍使请求 superseded，进入从未渲染的 unresolvedRequests，原请求无声消失；观察则仍 open。见 UI01–02。 | 整个首页遵守明确来源合同；准确请求／版本／目标传入原回应动作，保存后真实派生。普通保存、替代／失效／不可核不得伪装已回应或消失；无额外完成勾选。实际 UI→Host→保存→首页双类请求闭环。 |
| FR05 · P1 | 原 `{role:'case',caseId,itemId}` 对话没有两项新工具，工具只装在普通项目组；新保存分支排队后取消，在实际 Service/Store 探针中仍新增1条边，再抛 cancelled。见 RT R1/R3。 | 在真实 Case owner 与原公共生命周期内接窄工具、准确声明来源；在同 mutate 提交前核可信 current/signal/owner。两工具覆盖取消前未提交、已提交后保留、迟到／配置变化／另案和重试，并跑真实官方 Pi 合成回环。 |
| FR06 · P1 | 统一创建 API 在 UI 无消费者；人工入口走旧空表单，partial 只一句提示不能续办；整理是整句 substring GET，没有 goal-draft；首页未点保存即导航丢输入，旧创建已有 G/S 分支丢新名称／背景；片段写到第二文本框，与原 BusinessRoleConversation composer／发送脱节，且强制首事项。见 UI03–05 / RT R2。 | 首页／总览共用可恢复准备界面，接真实三分支、分步回执和原操作查询／续办；主动可选 goal-draft 带真实理由／来源，人工不依赖模型；用户明确目标事项，片段接实际草稿和原发送入口，导航／关闭／重开保全，无手工复制背景。 |
| FR07 · P1/P2 | 当前事项在切页后重挂回首项，连带重设手选范围；无“其他事项”选择、过滤忽略 auxScope.issueId；无taskId资料无依据混入当前事项；G/S未常驻，本轮三段摘要未落实；Case／项目页卸载丢返回状态。见 UI06。 | 按冻结 Demo／DW02–06 落实当前工作与原四页签，恢复准确事项／轮次／范围，G/S常驻与来源明确摘要；其他事项／全部可切，项目与Case嵌套往返保留原位置和草稿。不是只验范围条文案。 |
| FR08 · 交付门槛 | T13–T15 勾完成与已披露缺口不符。`workspace-daily-http-pi` 是 HTTP/Store和schema断言，未驱动实际 Case/goal-draft Pi；完整候选非作者修后回执目前 NOT_PROVED，包内旧review只审过原型／发单文档。 | 恢复未完成清单；修后固定完整新候选，补实际 owner 的 Host→官方Pi1.4.0→隔离合成Provider工具回环、真实产品主路径/失败/键盘、完整适用check/准确head CI和非作者／四原则报告。未跑、失败、未知如实保留。 |

详细文件行、最短路径及修复边界见 [UI 子审](ui-review.md)、[后端子审](backend-review.md)、[运行时子审](runtime-review.md)。这些均为原候选只读审查；各项动态证据的实际层次已单列，不把静态或业务函数探针说成浏览器／Pi 全链。

## 实证索引与边界

- [真实隔离 Host HTTP](backend-http-results.json)：原准入409／新入口201、虚构目标／策略、A部分成功后选择B但绑A。
- [真实 Store／业务恢复探针](backend-store-results.json)：并发 CAS 双成功、无关操作回放、跨 owner 片段、旧采纳回执串用。
- [请求／Board 保存重开](request-probe-output.jsonl)、[取舍 Store 身份](choice-scope-probe-output.jsonl)：错误授权／Store可回应、Board 重开错误。
- [UI 请求回应纯执行](ui-request-response-proof.json)、[旧首页队列纯执行](ui-heuristic-home-queue-proof.json)。
- [取消后仍落边回执](cancel-business-receipt.json)：实际 Service/Store＋受控 mutate gate；未启动 Pi/Provider。
- Root 的相关测试日志只跑上述16项，未跑全仓、真实模型或浏览器。PM 的边界检查尝试因复用 node_modules 符号链被现有官方安装路径校验拒绝，属于本地验证环境未满足，不作为候选代码 RED，也不改检查规则换通过。修后按锁安装的准确候选仍须完成原规则。

所有探针使用合成资料，没有访问生产业务根、真实模型或凭据；未修改候选源码、依赖声明、锁文件、官方 SDK、确认 UI 或测试。审查临时数据留在隔离根，发布的仅是脱敏报告／结果；原始失败保留。新探针源及原始日志可由 PM 在本地固定复核根回读，不将本地路径当公开附件。

## 领取与再次交回

按工程规范首审流程：**本次退回一次，释放首次领取**。返工 Agent（原 Antigravity 可继续）在原 Issue 重新留言领取，写明实例、唯一任务分支、基线／接手完整 SHA 并回读，再按 FR01–08 一次修完整。不要覆盖该失败候选或清理其证据；保留已有工作和原操作／历史数据。

第二次交回列出每项 FR 对应修订与永久回归，固定完整新 SHA、真实命令／结果、原 FAIL／UNKNOWN／未测和可访问非作者报告。二审后按既有流程由 PM 接手剩余收尾，不安排第三次退回。当前不创建合并 PR、不合并 main、不关闭 Issue，也不切换设备服务。

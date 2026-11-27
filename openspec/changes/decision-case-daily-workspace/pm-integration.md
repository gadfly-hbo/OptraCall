# PM 二审与集成

目标：按冻结 DW01–18 完成 Issue #149 的最终工程交付。二审不再退回，PM 接收候选后直接修复已确认范围内余项。

- 接收：`495cbfce171cf28f8fcb65c0ad391718c3b5cca0`，原基线 `699e425cb0900b50385377d638495069fa726761`。
- [二审接手与写入归属](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7222037339)：Codex PM，独立 `codex/issue149-final`；原 Antigravity 分支只读。
- [首审退回与永久证据](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7221256920)保留，作者二次只读报告的 PASS 仅为其当时判断，不替代 PM 验收。
- 本轮二审独立只读：[后端](pm-review/second/backend-review.md)、[Runtime](pm-review/second/runtime-review.md)、[UI](pm-review/second/ui-review.md)。已修部分与剩余问题分别记录。

## 收尾清单

- [x] 核对远端候选、重新领取与二次交接，记录接手与唯一写入归属。
- [x] 并行只读复核 FR01–FR08，保留真实 HTTP、Store、Pi 和 UI 反例。
- [x] 修复原创建操作恢复与 UNKNOWN 分类，补正常／负例永久回归。
- [x] 修复请求精确事项、逐请求读取状态、元数据省略语义及 Pi 并行声明／取消／兼容。
- [x] 补齐统一准备、真实候选采纳与所有入口、首事项、部分成功恢复和原 composer 持久输入保护。
- [x] 修复准确请求原反馈入口、事项／项目导航范围、本轮摘要及撤权状态。
- [ ] 固定完整候选，完成实际产品 UI、官方 Pi 合成、适用完整检查与全新非作者／四原则终检。
- [ ] 集成最新 main，推送、创建关联 PR，准确 head CI 通过后按授权 squash 合并。
- [ ] 本地 main 安全快进，main push CI 通过后回填并关闭同一 Issue。

## 执行记录

- 使用本工作树的锁定依赖正常 `npm ci --no-audit --no-fund`，未复用符号链安装；Node 25.9.0，官方 Pi 1.4.0 不变。
- 开始过完整 `npm run check` 探查；因 PM 修复开始，主动中止为 exit 130，日志 `.local/pm-second/full-check-incoming.log` 保留。该次进程可能读取到进行中的修改，**不作为任一固定候选全量成绩**。最终固定后重新完整检查。
- 原创建恢复新增两项反例先 0/2、修后 2/2；连同原三分支和草稿回归共 5/5。原日志 `.local/pm-second/create-recovery-{red,green}.log` 保留；永久测试 `tests/case-preparation-recovery.test.ts`。
- 设备采用、运行服务切换、真实 Provider／业务材料仍不在本轮工程交付中。

### 修后固定候选的第一次独立终检

代码 `7fe8e936d2463e514f2d8b08deae23f8c0467e24` 的全新非作者终检仍检出缺口，原结论和实际反例保留于 [final-initial/](pm-review/final-initial/)。这不是再次向领取方退回，仍由 PM 在本分支直接收尾。

- 后端：专属方案的事项归属、观察基线存在性、原报告确认来源撤权；沿原权威补校验与逐请求异步读取。
- Runtime：原项目工具的排队版本捕获、Case 配置失效后的迟到写、132 事项的目录超限；复用原生命周期撤销该 owner，准确配置快照含凭据比较，并增加有界目录分页。
- UI：共享项目的别案／未归属任务混入“全部当前 Case”；改为准确关联集合并保留打开原项目全部任务的入口与来源标签。
- 原整包检查先因三个新测试使用非字面模块加载而失败（`.local/pm-second/full-check-fixed.log`）。只修测试加载方式，保留全部断言；未更改边界检查器或白名单。修后会话边界通过。
- Case 配置变更新增真实官方 Pi＋隔离合成 Provider 回归：换线路及仅换凭据均为零迟到落盘、旧 Provider 各只收一次原请求，3/3 目录／配置组通过；目录整页预算另有永久回归。
- `npm audit --audit-level=high` exit 0；原锁定 Pi 的两项 moderate 提示保留于本地日志，不据此升级用户固定的 SDK 或锁文件。

### 生命周期收尾

`be1fd36ad449d89d2fc21655ccbbb61cf8b6bdbf` 的 UI／Runtime 独立终检通过；后端原三项反例关闭后，进一步按原写入资格核对生命周期，发现方案归档、Case 关闭后的取舍请求，以及项目归档后的观察请求仍会进入待处理。固定源码隔离复现见 [生命周期报告与完整矩阵](pm-review/lifecycle/)。

补齐原准入的派生状态：不能再执行的未回应请求移出待处理；已准确回应的历史保持 answered。项目恢复不重放，原本允许的历史方案回应、已关闭 Case 中仍合法的 Board 观察，以及 done 行动的反馈均保留。新增两条永久生命周期回归先 RED 后 GREEN，2/2；相关 Store／HTTP 22/22，typecheck 通过。

本地 `full-check-final.log` 在发现上述源码需修正时主动停止（exit 130，未跑完整）。其中也检出一个旧测试仍要求 Case Agent 零工具，与本次明确新增窄声明工具的规格不符；改为精确只允许 `strategy_goals`，保留无项目、事项隔离和闭案保护断言，单项真实 Pi 重跑通过。观察浏览器的“其他请求仍 open”旧断言也改为基线已推进的 superseded，仍严格要求只有准确选中请求 answered；完整浏览器五组复跑通过。原失败不抹去，检查器、白名单及 SDK 均未修改。

### 原方案资格与首次使用

`a571245698d432d39e3fbdbcfee423ebc06fd919` 的后端独立复核进一步沿**完整原 service**验证，发现请求尚未消费原 `checkPlan`。正式 Plan 的源项目、任务、native 或接收资格失效时，原取舍已拒绝但首页仍显示可处理。改为直接复用该既有资格，不另写来源判定；Store 原选择准入也提取为无副作用共享函数，覆盖准确当前选择链，保留合法旧版回应、已答历史、撤回／替代及原操作回读。因果反例和原结论见 [source-qualification/](pm-review/source-qualification/)；新增永久来源／链回归，相关 28/28 通过。

另由 PM 实际核对干净 Host 首用：人工准确 G/S 已采纳但首次创建曾返回 503。明确创建 POST 现在沿原安全初始化入口启用 Case 存储，GET 不产生该副作用，也不重置 unavailable 数据；已有无 marker 数据库字节保全回归通过。原失败与永久 `workspace-first-case.test.ts` 保留。已缓存的 Case 工作区重新进入时只读刷新，明确续接事项回到当前工作，新片段可在原已挂载事项立即看到；输入仍走唯一 composer，重复追加不重复写入。

`full-check-complete-candidate.log` 为源码再需补齐时主动中止的 a571 探查（exit 130），不是完整通过成绩。修后首用与来源组 17/17，实际产品浏览器的新片段续接、持久输入、1440/1024/390、键盘及深浅主题通过；冻结 Demo 仍 27/27、原 SHA-256 不变。最终完整检查在下一固定候选重新执行。

### 原请求历史版本与事项焦点

在 `6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb` 的首次使用复验通过后，非作者追加实际浏览器覆盖，确认两项 DW09 缺口：原请求仍合法引用方案 v1 时，界面只列活动 v2；从 A 请求入口切换 B 事项，旧入口焦点会使 B 的正常取舍没有准确关联其原请求。原失败和首用的限定通过均保留，见[追加报告](pm-review/release/ui-response-followup-review.md)。

修后源候选为 **`2eb30a51e31333a4252d4b6564bb0ad3a66326b8`**。唯一产品增量为 `CaseIssuePanel.tsx`：复用原准确版本读取，按 recordId＋revision 保持方案身份，明确展示原／当前版本；历史选择仍需明确确认后才沿原 API 携带 `allowHistorical` 和准确回应引用。请求入口只作用于原事项，明确切换后使用新事项自身的准确请求。后端、Runtime、SDK、依赖和冻结 Demo 没有增量。

新增 5 项永久组件回归；含原消费者与来源资格的联合组 11/11。FR03 原异步服务拒绝改用 `await assert.rejects`，原同步 Store 断言和 `project_not_linked` 均保留，相关 4/4。崩溃测试在当前容器中因 PID 1 留存已退出的 SDK 僵尸而误判仍有 writer；只对原 PID＋准确启动时间＋Z 状态确认 writer 已退，原 5 秒界限及 UNKNOWN／不得重放／不得伪造清理／原件字节断言全部保留，真实 Host 重开回归通过。旧 CI 的 Case Agent 失败已独立复现为旧 `tools=[]` 夹具制造 Provider 500，正确窄工具合同已在原修复中验证；没有借此改 SDK 或放宽权限。

各版本、反例、修后收据及全新非作者报告集中在[最终证据索引](pm-review/release/index.md)。其中后端／Runtime 对 `6bc7` 的实际运行与 `2eb` 的无关增量分别核定，不冒称全部重跑；实际 UI 使用固定 `6bc7` Host 与按摘要锁定的 `2eb` 产品组件编译包，并提供提交绑定。最终本地整包、PR 实际 head CI 与 main push CI 是后续独立门禁，不能从局部通过推断已交付。

### 完整检查原失败与测试基线修正

固定 `6bc7` 的 `npm run check` 已完整执行：3,602 项，3,401 通过、5 失败、196 条件跳过，测试失败后未进入 build。原结果、准确栈和各项原因见[原整包回执](pm-review/release/full-check-6bc-original-failure.json)，不改写成通过。

五项中，FR03 异步断言与 CNR 准确退出判断已按上节修正；两项原测试明确报 10 秒 Host 启动超时，保持原时限／断言的单并发复验 2/2，通过的边界与启动资源争用解释见[独立报告](pm-review/release/startup-timeout-review.md)。这两项单绿不代替最终整包。

第五项为战略候选零写入断言。独立调查用原失败数据重建出完全相同的两份 SHA-256，唯一差异是正常创建准入的 `createRequestId` 在摘要基线之后落盘，业务候选字段没有被无效保存改变。**`8dd24cae613bf9f1b4dd1ca79e1d8102289431b9`** 仅补测试同步：合成 Provider 的第一步等原创建 POST 的 202 确认后再取基线，仍严格比较整份文件，保留全部错误定位、合法修正和原超时断言；真实 Host 回归通过。生产代码与已独立接受的 `2eb` 完全相同。原失配、逐步快照及准确原因继续归档，最终整包仍需在此修后源码实际通过。

### 兼容与回退

Case 增量事件／关系／请求沿原存储，旧记录不补造边或请求；Workspace 草稿独立保全，原 native 历史不迁移或改写。Board 带回应引用使用 schema v6，旧行与反馈混合保存后关闭／重开已验证。此前不支持 v6 的版本不能直接读取该升级库；没有数据降级迁移。工程回退须保全新记录并使用对应版本备份，不能以源码回退覆盖或重置已写数据根。设备运行采用仍由用户另行安排。

### Git 与结案记录

最终测试观察收尾见 [9900 四文件修正与非作者复核](pm-review/final-observation/README.md)：A4 准确 CI 的完整通过与本地四 FAIL 分别保留；修后只涉及测试观察，生产字节不变。本地受影响四个完整消费者文件 14/14、边界及构建通过，最终新 head 仍走完整 CI，最终结果不由目标绿或旧 head 代替。

[PR #151](https://github.com/gadfly-hbo/OptraCall/pull/151) 为本轮唯一集成 PR。本文和任务文件记录提交时的阶段，实际交付 SHA、PR head 与 main push CI、最终勾选及工程结案以 [Issue #149 的 PM 最终回执](https://github.com/gadfly-hbo/OptraCall/issues/149)为准。未经过门禁的候选不称已合并；设备更新与产品体验另行安排。

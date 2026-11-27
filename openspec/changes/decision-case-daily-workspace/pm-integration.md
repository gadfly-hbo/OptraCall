# PM 二审与集成

目标：按冻结 DW01–18 完成 Issue #149 的最终工程交付。二审不再退回，PM 接收候选后直接修复已确认范围内余项。

- 接收：`495cbfce171cf28f8fcb65c0ad391718c3b5cca0`，原基线 `699e425cb0900b50385377d638495069fa726761`。
- [二审接手与写入归属](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7222037339)：Codex PM，独立 `codex/issue149-final`；原 Antigravity 分支只读。
- [首审退回与永久证据](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7221256920)保留，作者二次只读报告的 PASS 仅为其当时判断，不替代 PM 验收。
- 本轮二审独立只读：[后端](pm-review/second/backend-review.md)、[Runtime](pm-review/second/runtime-review.md)、[UI](pm-review/second/ui-review.md)。已修部分与剩余问题分别记录。

## 收尾清单

- [x] 核对远端候选、重新领取与二次交接，记录接手与唯一写入归属。
- [x] 并行只读复核 FR01–FR08，保留真实 HTTP、Store、Pi 和 UI 反例。
- [ ] 修复原创建操作恢复与 UNKNOWN 分类，补正常／负例永久回归。
- [ ] 修复请求精确事项、逐请求读取状态、元数据省略语义及 Pi 并行声明／取消／兼容。
- [ ] 补齐统一准备、真实候选采纳与所有入口、首事项、部分成功恢复和原 composer 持久输入保护。
- [ ] 修复准确请求原反馈入口、事项／项目导航范围、本轮摘要及撤权状态。
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

# 差额修正验证

基线：`9607e53daddaf38cac1c7a0b16a56dcb251e7eff`。本文件只报告当前修正候选；原交付与原 FAIL／UNKNOWN／SKIP 不被替换。最终候选身份和完整检查以 result.md 为准。

## 修正及相称验证

| 条目 | 原能力、实际接缝与持久化 | 正向与关键反例 | 证据入口 |
| --- | --- | --- | --- |
| PM-01 | 复用 `StrategyGoalsStore.read({goalId,version})`，补进原准备 seed 和确认版 Task 的 projectPlan.text；实际交付随原 native providedContext 保存，不建目标副本权威。保留原目标访问、原确认归属与准确版本。 | 同一诉求、同一目标 v1/v2，各自成果标准、范围、基线、期限、条件实际进入准备及 Task Pi 请求；复用 Task 正常追加，原 native 前缀不改。不存在的准确版本返回404且模型请求0，未猜最新或要求重抄。 | `tests/project-goal-content-gaps.test.ts`；本地 `pm01/05-regression.log`，15/15含原Case/准备兼容；唯一 `goal-context-*` 根保留实际输入/确认/native。 |
| PM-02 | 保留原 SAP 治理及精确读取禁用；原草稿/准备提供准确 issue 元信息，原确认的 create/start effects 逐 Task 核能力并存原观察回执。准备建议暂缓时保留原 taskKey/方法版本；替代仍由用户在原方案集中确认。 | 一坏一独立任务：坏Task创建失败或已创建后启动失败，独立Task实际Pi运行；准备可解释、建议暂缓且不暗换v2。错误版实读 disabled、无正文；旧确认、零错误模型派发、幂等保留。坏ref挪入原独立Task的反例由实际200有效RED修至422，不保存草稿。 | `tests/project-method-adjustment-gaps-v020.test.ts`、原 `project-selected-methods-v020.test.ts`；本地 `pm02/implementation.md`、`host-pi-green-recheck.log` 4/4、`compatibility.log` 43/43；`receipt.json`及native/Provider记录。 |
| PM-03a/b | 复用原 quoted-decision 工具、真实原话绑定、Board行动/授权/操作回执；原 GSA 新增上层安排/检查和多个原行动引用。进度/负责人/期限/反馈仍读原 Board。Host 从准确确认派生Goal/工作资格；无Case明确工作可直接安排，无Goal时不伪造GSA。 | 实际Pi明确原话→创建两原行动→重复不增；准确Plan/Goal下读原回执→复用及创建、多行动管理承接。旧Case选择/授权/反馈保持；仅选择不安排。版本/CAS、跨项目、取消、部分成功、ACK UNKNOWN覆盖；真实隔离GSA锁导致partial后沿同一意图补齐，不重建Board。 | `tests/quoted-action-arrangements-product-gaps.test.ts`、`quoted-arrangements-runtime-product-gaps.test.ts`；本地 `pm03/summary.md`、`07-regression.log`59/59、`09-host-pi-partial-green.log`2/2；原API/Board SQLite/GSA/native/quote可回查。 |
| PM-04 | 一次原生安全快照同时列报告及无报告请求最终回复，补准确request/session/message/hash发现与交接；正文沿已有 `readPersonalSource` native-reply读口，不另造引擎。读取前后重核原确认参与范围与权限。 | 明确综合Task实际发现并读取一个文件报告和一个无文件短答；新旧请求独立。越权/未参与/改字/失读/非最终消息/歧义聊天拒绝；聊天歧义不拖掉独立有效文件。未要求先声明报告、Case或记忆。 | `tests/project-task-chat-results*.test.ts`，本地 `pm04/implementation.md`：39/39新旧源兼容，实际Host/Pi及原A12共5/5；准确混合读取回执及后续唯一 `host-pi-run-*` 根保存native。 |
| PM-05 | 复用原 DB 配置/grant/Task policy/model-export及正式工具，新增白名单元信息投影。原租约一次捕获实际准备模型；目录和所有预选准确DB refs均按同一出口检查。原资料/能力列表接受或改选精确引用，不写新grant或恢复排除。 | 已授权/无来源/Task排除/配置变化；项目与Task收窄范围分别绑定hash；新Task沿原grant继承，未重复授权。实际准备模型B不借项目模型A出口。未获准预选ref在Pi.run前403、模型0、原选择不改；准备/确认driver0，无凭据/主机/DB名/用户名送入模型。 | `tests/db-link-planning.test.ts`、`requirement-planning-model.test.ts`、`project-plan-db-integration.test.ts`及预选出口回归；本地 `pm05/implementation.md`、独立 `review/spec/preselected-db-outlet-{confirmed,green}.log`；最终计数按完整检查。 |

## 联合与兼容

上述实际Host／官方Pi／本地合成Provider用例覆盖准确目标→轻量准备→确认创建/启动→独立单/多Task→明确Task混合综合，以及人的原话→原Board安排→GSA承接。原全仓回归继续覆盖逐稿审查、作者接受/反驳与修订接线、原Case/资产治理、停止/恢复、全局开关、迟到结果、重复操作、部分成功/UNKNOWN和版本变动。

这组验证不宣称一次自由模型完成了从经营目标到治理复用的专业全链：原断言验证接线与边界，专业内容、真实自主采用和经营效果仍分开。

## 失败保留与独立复核

- 各组有效产品RED、夹具错误NOT_PROVED、并行中间态类型失败、旧预期漂移、原SKIP均保留于本地证据根，不用后来绿色覆盖。
- 非作者规范复核发现GSA重复组件，已保留一处原位展示。非作者规格复核实际复现预选DB ref绕过模型出口过滤，已加派发前准确权限检查；独立同一路径验证403、Provider0、DB driver0、原选择不改。
- 全候选两轴最终复核、界面观察、完整检查和证据身份在 result.md 单列，不把作者局部通过算作最终完成。
- check-03另保留原嵌套声明回归的状态GET409 `session_history_unavailable`。原native稳定后独立精读通过且字节不变，不据此猜早先底层原因。仅原测试active观察允许此准确不可读在既有6秒内等待，必须最终idle再执行全部原严格断言，未改产品读器或放宽权限；详见 [review](review.md)。

## 本轮保持待验证

真实自由模型的MECE/TOC/TP/Skill/IR实质使用、专业综合/审查正确性、报告纠错沿实际引用进入IR/Studio/记忆/Case再由新普通分析自主发现避错的完整链，仍未验证。原SAP明确选v2子链不扩大为全链通过。

正式双机PPT正常渲染、当前活库/天气真实网络、本轮MacBook真实产品交互未重测；原隔离PPT渲染FAIL、旧双机采用/保全通过及MacBook `.git` 严格mtime FAIL/写入者UNKNOWN原结论保留。新版data-analysis Skill免测通过仍有效，免测不是专业增益实测。

真实模型/外部业务/PPT写入安装/SDK升级和双机服务采用不在此次自动扩展范围；不阻塞本轮可独立完成的工程修正。用户产品验收和经营效果由用户及实际反馈核定。

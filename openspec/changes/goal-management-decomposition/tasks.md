# 目标管理任务目标执行清单

本轮目标是以确认提交 `0a45c50205060009cd92c19ed0cc6fa6e4ae2570` 和用户已确认的 A 集成 Demo，对标并修正同一份 Spec／任务清单。确认的 HTML 为 `3fcbe15f7df00fc09e6625d47edb75f2350827524f97faa36fc9eb382f1034f0`，本轮不修改。原 A／B 继续保留。业务验收为 [GM01–GM13](spec.md)，界面保留能力为 UI01–UI04，逐项映射见 Spec §7.3。UI 确认、文稿对标与正式工程完成分别记录。

## A 确认包准备

- [x] A1 固定讨论稿与最新主线。讨论稿 0a45c50，再次 fetch main 仍为 d4b60b5，核对工程规范 v1.15、产品方向及 Interface v3。已独立启动该 main 的真实 Host／React UI 并点验目标列表、采用、原 Agent 对话／放大及主题／760px 导航。
- [x] A2 写 Spec 与业务边界。验收 GM01–GM13、同一权威与原子发布、三个异常分类、最少人工动作及 Pi 实际能力差额可核对。
- [x] A3 完成原 A／B 对照（历史准备）。B `7d0fbb56…` 的 77 条业务断言及独立原型复核通过；A 沿原 `435064da…` 界面，对照页 9 项隔离检查通过。两份保留，结果不扩大为新集成稿已通过。
- [x] A4 用户确认界面取舍。A 为主要工作区，吸收 main 的四项必要能力，取消四个旧一级 tab，保留公共外壳。具体 Demo 确认另记 A7。
- [x] A5 完成 [A 集成 Demo](ui-demo-integrated.html)。四项按需入口随时可达，保留 A 的主要布局与正常最短路径，冻结候选 `3fcbe15f…`。旧 A／B／对照文件未改。
- [x] A6 完成集成稿验证。冻结候选通过 77 条核心及 51 条辅助／导出／隔离／视口断言，0 页面错误；非作者对最终受影响项独立增量 23 项通过。发现项与修正、准确身份和工程未验证范围见 [验证记录](review.md)。
- [x] A7 用户确认准确集成 UI。本轮明确“确认采用，UIdemo确认后，你再检查下spec里面是否做对标了”，记录冻结 HTML 身份，不扩大为对更新后 Spec／清单或产品开发的自动批准。
- [x] A8 按已确认 UI 对标 Spec／清单，17 项逐项标入口、范围、未演示要求和任务。两位非作者完成只读文稿及受影响增量复核，无剩余必修项；文档一致性与冻结 HTML 指纹检查见 [验证记录](review.md)及[静态回执](assets/spec-ui-alignment-check.json)。
- [x] A9 用户确认发单用 Spec 及任务清单。PM 已保存确认提交 `ea59d7c44a73d21e6bad8287a3612529010bb9d6` 并发布开发工单，B–E 依此启动。[发单记录](dispatch.md) · [Issue #136](https://github.com/gadfly-hbo/OptraCall/issues/136)

## B 总 GSA 与 Agent 最小可运行切片

- [x] B1 GM01–03 先写总 GSA 与战略承接的真实正反例，再实现同表一次确认。已实现 `POST /api/strategy/goals/:id/gsa-plan/confirm`、`GET /api/strategy/goals/formal-sources`、`POST /api/strategy/goals/:id/reconcile-formal` 及独立不可变 GSA 计划版与 schema 4 兼容升级；覆盖无正式值手动拟定例外、后发布核对补挂不覆写历史、缺计划 A 阻断、仅改上层 A 生成新计划版及旧目标兼容。证据见 [goal-decomposition-core.test.ts](../../../tests/goal-decomposition-core.test.ts)、[goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts) 与 [result.md](result.md)。
- [x] B2 GM03、13 分别核定确认前准确 goal-draft owner 的测算变体（`goal-estimate`）与确认后准确 goal owner 的拆解变体（`goal-decomposition`），沿用既有 `business-role-discussion` 域、统一 Pi SDK 1.4.0 及受限工作台工具与固定技能脚本执行（`optracall-forecast-2`、`optracall-variance-check-2` 等），保留原未启用能力的权限且 `--disable-goal-decomposition` 同时禁工具。证据见 `npm run check:agent-sessions` PASS 与 [result.md](result.md)。
- [x] B3 GM03–05 两个受限分析入口均已验证真实 Host→统一 Pi 1.4.0→合成 Provider→真实 Python `forecast.py` 工具→草稿写回→重开读回，保持正式/测算/差额三值独立，不固化方法，迟到写入或仅上层 A 改版后旧草稿被确定性 CAS 拦截。证据见 [goal-decomposition-core.test.ts](../../../tests/goal-decomposition-core.test.ts)。

## C 拆解、发布与恢复

- [x] C1 GM04–07 已实现确定性 Host 校验引擎（`src/host/strategy-goal-decomposition-validation.ts`），覆盖金额合计+明确预留校验（不自动平差）、比率同口径分子分母校验、里程碑成果标准校验、多视角交叉冲突（50/45、30/35 阻断且不可用预留/缺口抵消）、重复交叉格、重叠补缺范围及负缺口零补缺放行，并接通人工对齐重汇总与 Agent 修稿接缝。证据见 [goal-decomposition-core.test.ts](../../../tests/goal-decomposition-core.test.ts) 与 [goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts)。
- [x] C2 GM06、08 已实现只读发布预览零写入（`POST .../decomposition/publish-preview`）、确认发布前端先持久化原意图（不可读/损坏即锁死）并严格绑定预览快照（漂移拦截），服务端在单次原子提交中完成冻结拆解正式版、明确承诺的正式子目标及关系、有效指针和回执落盘，稳定行复用 `GoalRef`、逐行 CAS 防覆盖、同号同内容回放、同号异内容 409 及子目标越权范围拦截。证据见 [goal-decomposition-core.test.ts](../../../tests/goal-decomposition-core.test.ts) 与 [goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts)。
- [x] C3 GM08 已完成真实丢响应、浏览器刷新及 Host 重启的三态恢复（`committed` 回原版、`unknown`/`in-flight` 保持锁定待核、`not-committed-retryable` 经显式状态 CAS 重试或放弃，显式重试再次失答自动回退 `unknown`），并隔离其他目标互不干扰。证据见 [goal-decomposition-core.test.ts](../../../tests/goal-decomposition-core.test.ts)、[goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts) 及真实 Chromium E2E。
- [x] C4 GM09、UI01–UI04 已退休旧 4 个目标管理一级 tab、保留策略 4 tab 与公共外壳，落地确认 A 集成工作区与 4 项按需辅助弹窗（切换目标、版本与来源、关联决策、执行承接含 `ReadGoalArrangements` 与冻结检查点承接预览/确认），关闭原型缺口 #1（导出与承接严格读冻结快照，绝不泄漏草稿）、#2（按原权威/范围与原 `GoalRef` 承接，不扩权不造假）与 #3（操作期权限撤销阻断读回与导出），并回归 Case/Task/Project/Teach 原入口全部通过。证据见 [v12-strategy-ui.test.ts](../../../tests/v12-strategy-ui.test.ts)、[result.md](result.md) 及真实 Chromium E2E。

## D 跟进、Case 与复盘

- [x] D1 GM10 已实现阶段跟进检查（`POST .../decomposition/checks`），支持选择冻结拆解版、责任行、冻结检查点与计划阶段；固定父计划/冻结检查点/实绩来源/当时阈值/触发与选择；完整覆盖部分门店缺失（不给整体偏差%、不计连续）、观察窗、口径变化、补齐追加（不覆写原记录）、零计划不伪算百分比及无阈值比较。证据见 [goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts) 与 [GoalDecompositionWorkspace.tsx](../../../src/host/ui/GoalDecompositionWorkspace.tsx)。
- [x] D2 GM11 已实现幅度（含 `%` 与 `percentage-points`）与严格相邻同口径连续期数触发（跳期不误触、不跨未知期拼接），支持继续观察、安排补证、续接已有未关闭 Case（`caseId`）、另建独立 Case 草稿意图及无拆解表主动试点 Case 草稿；同意图稳定去重、不同独立意图分别保留原检查，绝不自动建案。证据见 [goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts)。
- [x] D3 GM12 已实现周期到期复盘（`POST .../reviews`）、下期草案起草（`POST .../next-cycle-draft`）与带原证据回送战略（`POST .../strategy-return`），严格以最后生效正式目标评估（120→110→112 实测验证）、保留期初备忘与历史检查，未成熟/未验证因果/扩范围结论一律标为待验证假设且不自动采用或发布。证据见 [goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts)。

## E 完整候选与交付

- [x] E1 已验证 schema 4 兼容升级、拆解快照外置文件与分页预算（`limit`/`offset`）、`--disable-goal-decomposition` 安全回退（已有数据只读、写路由与 Agent 工具均返回 403）、企业范围权限撤销操作期阻断（读/导出/承接）及旧目标/native 原件保全。证据见 [goal-decomposition-full.test.ts](../../../tests/goal-decomposition-full.test.ts) 与 [result.md](result.md)。
- [x] E2 已执行 `npm run check:agent-sessions`（PASS）、`npm run build`（`tsc --noEmit` + Vite + `stamp-build` PASS）、39 个受影响与下游回归测试文件共 **229/229 PASS**（0 fail，含真实 Host→Pi 1.4.0→合成 Provider→`forecast.py`、策略发布/讨论、Case/Project/Teach/权限及 UI）以及真实 Chromium Playwright E2E **7/7 PASS（0 pageerrors）**。说明：全仓 470 个测试文件的单进程 `npm run check` 受云端 2 vCPU 10 分钟单命令上限截断，完整全仓 CI 待 PM 建 PR 后由 GitHub Actions 执行。
- [x] E3 已由独立非作者只读 Subagent（`f941ace1291e0273ef9246689e6d9580`）完成完整候选复核，检出 6 项 P0 与 8 项 P1，全部修复并经非作者二次复核确认 **PASS（0 P0, 0 P1 剩余）**；`spec.md` 与 `ui-demo-integrated.html` 指纹及 `package.json`/`package-lock.json` 均保持原样未改。四原则专项终检与 §7.3 三个原型缺口关闭记录见 [result.md](result.md)。
- [x] E4 原交接分支经 PM 验收，PR 检查 `check` 成功，已合并到 `main@b7c0085`。原 [Issue #136](https://github.com/gadfly-hbo/OptraCall/issues/136) 已关闭。[PR #137](https://github.com/gadfly-hbo/OptraCall/pull/137)

发现的新问题先对应以上验收。直接阻塞或本次回归在有效范围内修复，独立功能或权限扩大补适用决定，其余记录后继续原任务。每项真实完成立即勾选并链接证据。本轮试用增量见 F 清单。


## F 试用修正 · 目标管理入口与总 GSA

目标是让负责人在正确的目标上完成“找到拆解入口 → 补齐或修改总 GSA → 进入拆解”。原 #136 的开发和集成记录见 [结果](result.md)。以下各项记录本次试用后的增量。

- [x] F1 负责人试用并确认三种入口状态、GSA 草稿编辑、正式修订及旧版回看。界面与验收口径已写入 [Spec §3.1](spec.md#31-承接与确认总-gsa)。
- [x] F2 产品实现并回归目标选择。用两个目标在真实界面走新建、取消与保存基础修订、切换及刷新，始终显示回执对应的唯一工作区；历史查看保留原引用。
- [x] F3 产品实现并回归就地补项及修改。分别试已确认、齐备待确认、G/S 未承接与 A 资料不全；验证端内草稿保存、就地补齐和一次确认。核对修订原因、差异、旧快照、下游显式承接与失答恢复。

计划 A 推荐的[交互样例](ui-demo-plan-a.html)已在桌面和手机浏览器验证：一键补齐三个空框、保留手填内容、修改后确认，以及修订后回看旧版。本轮还回归了关键词优化、单框混写期限和证据限制、撤销保留后续手改、依据缺项与补齐。样例使用模拟 Agent，验证说明见 [Spec §6.1](spec.md#61-四原则检查与四项已确认要求)。负责人已试用并确认推荐和关键词优化。

- [x] F4 在截图所示的“本期计划与检查依据”和 GSA 编辑器增加可选推荐。绑定当前 G、S、期间、责任范围、编辑行及已有文字。点击一次填入原“计划 A／阶段检查点／观察依据”空字段，人工可继续改。晚到的建议不得覆盖人工值或写入其他目标。
- [x] F5 沿统一 Pi 业务会话补计划项结构化回传。用两组不同 G/S 验证结果随目标与策略变化，核对上下文失效、模型不可用和重试。分别验证合规手填 G/S 与战略正式版承接，验证推荐后取消、保存候选、按人工修改确认及既有版本历史。
- [x] F6 在真实 Host 和浏览器贯通首次进入目标管理、选择正确目标、确认 GSA 并进入拆解。推荐可跳过；使用推荐时只需一次触发。确认前、修订后和发布结果待核时分别核对可操作范围。留存与原型证据分开的产品验收记录。
- [x] F7 将“按手填要点优化”接入同一目标会话和计划表单。验收任一字段可起步、推荐只补空项、优化保留数值／时间／范围／否定条件、可改可撤销。分别测初稿及正式修订，覆盖两份不同 G/S、任意短句、上下文切换、失败重试、迟到回复和撤销后不覆盖后续手改。
- [x] F8 负责人已试用并确认计划 A 推荐与优化，并确认[四项减操作要求](spec.md#61-四原则检查与四项已确认要求)全部纳入本轮范围。确认的独立计划页 SHA-256 为 `82cea6071a7deae3057661e4a794974f4b77ae84aba30d082ebdc59498fa615e`。
- [x] F9 首次拆解。完整快捷要求可见，单击按该原文发送；保留自定义要求和未发送文字。验证确认 GSA 不触发模型、不暗含预算／预留责任、重复点击不重复起草。
- [x] F10 草稿自动保存。人工更改与 Agent 更新显示保存状态；验证失败留稿可重试，切目标和并发更新不覆盖他人或较新修订。保存成功才可只读预览和明确发布；回归交叉冲突和发布失答恢复。
- [x] F11 阶段实绩。一次明确选用已保存凭证；新报表支持原文提取截至时间并附出处。验证单一明确日期、缺失与冲突、非截至日期、缺金额、覆盖不齐、原检查版本及提交后重开。
- [x] F12 到期复盘。Agent 先用本期结账、检查与 Case 起草，负责人可改写、舍弃、勾选。验证原证据和适用范围、末版目标、证据不足留待验证，下一期只引用选中项的最终文字；空选、取消与生成草案均不自动发布。

F9–F12 以真实产品的测试与运行记录勾验。已确认的方案、可点击原型的验证以及正式产品工程验收分别记录。

**四项交互验证。** [本次工作区 Demo](ui-demo-journey.html) 的 SHA-256 为 `7b1d3031768b2ad13b39850c35879deb601c7beca7ca134eff262d40e92cab0a`。桌面 1440 × 900、手机 390 × 844 合计八条路径、96 项浏览器断言通过，脚本错误为 0。独立复核另验金额或单位冲突、部分门店未报、保存失败恢复、复盘补入新增检查与变更适用范围。负责人于 2026-11-26 确认此版交互，作为发单依据。本轮正式工程覆盖 F2–F7 及 F9–F12，按真实产品的工程证据逐项验收。

**#138 工程勾验。** 上述十项实施与定向工程验证已完成，证据、独立复核和 Git／CI 实际状态统一记录在[本次工程记录](issue-138-result.md)。原型确认、工程验证及负责人最终产品验收分别记录。


## G UI 对标返工：先截图、后 Git

目标：关闭 UIA-01–UIA-09，按原批准 Demo 完成四阶段真实界面，用户先审截图。本地分支 `codex/issue-138-ui-rework`；旧勾验代表历史范围，本节独立记录修正。

- [x] G1 核对最新 main、规范、批准 Demo 与审计，重开 #138 并登记接手。
- [x] G2 UIA-01 永久浏览器反例及唯一工作区修复。连续三次同名修订、取消再确认和切版始终只有一个工作区；取消编辑不提交署名或说明。
- [x] G3 UIA-02/03 当前目标页头、GSA 工作表与聚焦编辑。G/S 来源压缩为简表，原 A 三字段、推荐/优化、保存/取消/确认保留；区分本期候选与当前生效版。
- [x] G4 UIA-04/05/09 业务成果、时间计划、冻结正式表与移动定位。桌面左右同屏；正式表重开仍只读；手机对话/成果往返同时定位焦点。
- [x] G5 UIA-06 凭证/结果优先的阶段跟进。准确冻结计划、实绩和偏差同屏，Case 取舍与原规则可查；新报表及配置按需展开。
- [x] G6 UIA-07/08 可读复盘、按需改稿与集中承接。首屏可读首条结论；舍弃/历史折叠；手改、取舍与下一期准确引用保全。
- [x] G7 执行适用检查、三条发布路径、保稿/恢复与四阶段实际截图。构建、十三条试用路径、八条发布回归及重复/取消专项通过。全仓 3132 PASS / 1 FAIL / 196 SKIP，唯一失败经准确进程证据定位为容器孤儿未回收；同一测试只加任务级回收后通过，原全仓 FAIL 保留。详见[返工记录](issue-138-result.md#已确认-demo-对标返工与截图交付)。
- [x] G8 固定 candidate-3 文件摘要，独立非作者逐项复核 UIA-01–09 与四原则；新增取消残留及两处首屏问题修正后复验通过。原 FAIL、局部 PASS 和夹具失败分别保留，独立 UI 通过不替代全仓 CI。
- [x] G9 已提交[真实产品四阶段截图与 Demo 对照](/workspace/scratch/goal-ui-rework-delivery/index.html)，用户于 2026-11-26 明确确认并授权“提交 Git，并推进 PR／CI／合并”。截图确认前未执行本轮 Git 交付；代码与测试保持独立复核 candidate-3 字节。后续实际远端 SHA、PR head／main CI 和结案状态在 [#138](https://github.com/gadfly-hbo/OptraCall/issues/138) 回填。

## H Agent 草稿保存试用修正

- [x] H1 核对最新 main、流程和实际工具／Host 接缝，重开 #138、独立工作树单写领取，界定 DC01–DC05。原八次输入未取得，仅按已证实的契约缺失修正。
- [x] H2 先用实际模型可见契约编写永久 RED，覆盖比率／手动来源／无 SAP／无脚本保存；两条真实 Host/Pi 合成 Provider 反例在修复前失败。不使用预知 Host 私有字段的完整草稿夹具替代契约验证。
- [x] H3 补齐共享 schema、准确上下文及逐字段错误，保留原保存与发布、CAS 和权限边界；确认前测算复用同一契约。错误沿原 safe-tool-error-v1 通道，未改 Runtime 或 SDK。
- [x] H4 GREEN、金额／比率／里程碑和待完善草稿、同会话修正通过。最终受影响四文件 30 PASS、两项整数边界增量后专项 5 PASS，构建／边界／high audit PASS。原全仓 3334 项中 2 项旧提示词版本预期失败保留，精确修正后原会话断言 4 PASS；196 条件跳过不算通过。详见同一[工程记录](issue-138-result.md)，准确候选完整 CI 为 H5 交付关口。
- [ ] H5 candidate-5 独立非作者与四原则复核已 PASS，11 项最终独立/永久测试及 101 个边界变体核对通过，2 P2／1 P3 全部关闭。剩余 Git、PR 实际 head CI、授权合并与 main CI 按原授权推进；本候选不预先勾选，最终状态由同一 #138 绑定准确提交的结案回执补齐。
- [ ] H6 关闭 H5 的直接 CI 阻塞。PR 首次完整检查持续执行至末段时达到 25 分钟上限，原 cancelled 保留；仅把作业总时限调至 35 分钟，YAML／差异与非作者增量复核已 PASS，再跑新准确 head 和 main 完整 CI。产品、测试范围和单项时限不变，实际结果在同一 #138 回填。

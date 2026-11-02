# target-forecast 三测算 skill（分析资产承接）

2026-11-02 · 用户已确认[讨论稿 v0.2](../../../docs/TargetForecast能力承接产品讨论稿_v0.2.md)（skill 形态、D1–D5、三 skill 实现思路、纯 Python+openpyxl 依赖边界），本规格据此制定；无 UI 变更，无 UI Demo 环节。交付走[移交交付模式](../../../docs/engineering-workflow.md#qoder--codex-移交交付模式)：Qoder 在 `qoder/target-forecast` 分支交付 skill 本体与本文档，整体移交 Codex 实施唯一 Host 接缝（目录登记）、非作者独立复核与 Git/CI 至合并。

原仓 [target-forecast](https://github.com/gadfly-hbo/target-forecast)（业务基线 `df5acd6`）仅作领域参考：数学公式、校验语义与黄金案例为对照基线；其 workbench 壳、页面、存储、副车、pandas 实现均不进入本仓。

## 可观察结果

用户在项目任务中提出测算类问题（定目标 / 发券决策 / 投放盈亏）时，任务 Agent 经分析资产发现并激活对应 skill，用 skill 携带的确定性脚本完成校验、计算与比较，产出带引擎身份与输入摘要的测算报告（最终报告入 `060_reports`）；报告作为项目文件可被 Case/决策板按既有文件引用合同引用。三脚本的黄金案例自检（`--selftest`）在任何有 Python+openpyxl 的环境一跑即绿。能力目录"分析资产"出现三条"已接入"条目。无新页面、无新会话域、无插件。

## 范围

- 新建 `extensions/analysis-assets/target-forecast/`：`SKILL.md`（激活描述、红线、工作流、资源索引）+ `scripts/`（`ingest.py` 模式A/B xlsx 导入与三级质量校验、`forecast.py` 人/货/场三视角测算、`template.py` 导入模板生成，均带 `--selftest` 与 `requirements.txt`）+ `references/`（`method.md` 公式与口径、`input-spec.md` 列定义与质量规则、`golden-cases.md` 合成场景期望值）。
- 新建 `extensions/analysis-assets/coupon-forecast/`：`SKILL.md` + `scripts/`（`coupon.py` 四子模型测算/候选生成/比较/压力、`bucket.py` 订单明细分桶、`template.py`，均带 `--selftest`）+ `references/`（`method.md` 四子模型与不变量、`review.md` 复盘方法（文档形态）、`golden-cases.md` 黄金表）。
- 新建 `extensions/analysis-assets/roi-forecast/`：`SKILL.md` + `scripts/`（`roi.py` 链路核算/情景/排名/稳定性，带 `--selftest`）+ `references/`（`method.md`）。
- 三引擎纯 Python 重实现（仅标准库+openpyxl）；引擎身份 `optracall-forecast-1`（测算）/ `optracall-forecast-ingest-1`（导入）/ `optracall-coupon-1` / `optracall-roi-1`；黄金案例期望值随各 skill `scripts/golden/` 分发，`--selftest` 随身对照。
- Host 接缝（**Codex 归属，接管阶段实施**）：`src/host/ui/catalog-data.ts` "分析资产"新增 3 条"已接入"条目（名称、说明、版本、适用条件；`CatalogEntry` 类型扩展）；`src/host/ui/App.tsx` `openCatalogEntry` 对三条目的点击导航到项目视图（使用现场＝项目任务对话），行为对齐 ppt-report 条目先例（App.tsx:210）。
- `openspec/changes/target-forecast-skills/`（本目录）与讨论稿归档。

## 不做

- 不做插件、页面、路由、agentOptions、边界清单改动；不建会话域/owner/profile；不建独立触发入口（无"生成 PPTX"式按钮）。
- 不引入 pandas/numpy 及共享分析 Python 环境（Host 环境决策，需要时另立提案）。
- 不搬原仓 workbench 壳、v2 工作区、方案存储、assistant-sidecar、CLI、旧版管线；不做优惠券复盘脚本（复盘以 `review.md` 方法文档承载，脚本化需要时另立增量）。
- skill 脚本 selftest 不进 `npm run check`/CI（Node 侧），与 ppt-report 先例一致；验收与复核时实测。
- 真实模型端到端、原仓退役、设备采用按届时授权另行执行。

## Interface 接入记录（IN01）

- 无 SDK 接入/会话变更：skill 经 [project-session.ts](../../../src/agent/project-session.ts) 既有 `additionalSkillPaths`（`extensions/analysis-assets`）对普通任务与受管执行任务（经快照）生效，Interface v3、域/profile/owner 均不变；IN02–IN07 无新义务项。
- 唯一 Host 侧改动为 catalog-data 数据行（上文），无代码逻辑接缝。

## 关键规则

- R1 确定性：同输入+同引擎版本=逐字节一致输出（canonical JSON）；每次输出携带 `engine_version` 与 `input_digest`（canonical JSON sha256 前 16 位）；引擎逻辑变更递增版本。
- R2 黄金案例随身：三脚本内嵌原仓对照期望值（forecast 四平台合成场景、coupon 黄金表 10 行基准+6 压力值容差 ±1 分、roi 合成计划），`--selftest` 全对 exit 0，任何环境可自检。
- R3 依赖边界：仅标准库+openpyxl（`scripts/requirements.txt`）；环境缺失时如实报错并给出安装指引，不降级硬算。
- R4 数字出自脚本：SKILL.md 红线——Agent 不心算，报告数字必须出自脚本输出，报告含引擎版本与输入摘要栏位。
- R5 诚实边界：结论带"情景推演 · 非预测承诺"；允许"净亏损""不发券"成为结论；交叉校验差异超阈值如实标"需复核"；输入 blocker 定位到行号如实拒绝，不硬算不静默。
- R6 口径先行：先确认口径（新老客窗口、净额、平台覆盖、篮子分布、成本结构）再计算；数据或假设变化后旧结论声明过期。
- R7 激活分工：三 SKILL.md 的 description 按问题域切分（定目标/发券/投放），互不重叠抢激活；各红线含"无执行环境（如纯文本任务）时声明不适用"。
- R8 Agent 自主：skill 是能力注入不是流程编排；工作流为方法指引，Agent 自主决定方法、参数与迭代；Host 不加触发入口、不编排步骤。
- R9 结果即文件：中间结果默认 `020_clean`、最终报告 `060_reports`；无插件存储；`010_draw` 原件软约束继续适用。
- R10 移植保真：三内核公式与校验语义按原仓重实现；forecast 去 pandas 化的等价性以黄金案例证明，不口头宣称。

## 验收

| 标识 | 条件 | 对应 |
| --- | --- | --- |
| TF01 | 三 skill 被产品 Agent 会话实际发现（普通任务与受管执行快照两路径），发现方式成文记录 | D1/D3 |
| TF02 | 能力目录"分析资产"出现 3 条"已接入"条目，形态对齐 ppt-report 先例：来源标注、note 说明使用入口＝项目任务对话；点击导航到项目视图；无需安装步骤、无市场入口；文案与实际能力一致 | D5 |
| TF03 | target-forecast 导入：模式A（明细：滚动窗口新老客、订单级聚合、净额口径）与模式B（聚合表：人公式派生 GMV、UV 可选）产出统一月度指标层；blocker（重复月份/非正金额/订单身份冲突/日期不可解析）定位行号拒绝；confirmable/quality 清单不静默 | C1/C2 |
| TF04 | target-forecast 测算：人/货/场三视角月度+年度、多情景一次计算、每平台独立+全渠道汇总（比率分子分母重算、转化率覆盖口径如实标注）、基期年化对比、人 vs 货交叉校验差异如实呈现 | C1 |
| TF05 | coupon 测算：四子模型不变量（互斥分支概率合计=1、贡献拆解与 ΔΠ 对平、金额全程整数分）；无券候选始终参与；预算为过滤约束不截断成本；四类结论不强行推荐 | C3 |
| TF06 | coupon 压力：变体敏感性（参数范围用户指定，不内置 ±20%），输出 ΔΠ/排序变化/最敏感参数 | C3 |
| TF07 | roi 测算：链路公式、保本 CVR* 与 gap、below_breakeven、净贡献排名、跨档符号稳定性；参数校验语义保留（错误消息带字段名） | C4 |
| TF08 | 三脚本 `--selftest` 全绿（黄金案例逐项对照）；同输入重复运行输出逐字节一致；输出含 `engine_version`+`input_digest` | C5/R1/R2 |
| TF09 | 三 SKILL.md：激活分工明确互不重叠；红线齐备（R4/R5/R6/R7）；工作流为指引非强制步骤；资源索引与脚本用法完整可执行 | C7/R7/R8 |
| TF10 | 模板：`template.py` 产出可填写模板（forecast 两模式、coupon 场景/分桶），模板列与校验规则一致 | C2/C3 |
| TF11 | 合成 Provider 任务实测：Agent 激活 skill 并用脚本完成三类测算各一次全流程（真实 SDK 路径），报告按 020/060 目录约定产出且含引擎身份栏位；无 skill 抢激活或误激活对照 | C7/R4 |
| TF12 | 测算报告可被 Case/决策板按既有文件引用合同引用与查看（复用链路，无新机制、无新持久字段） | C6 |
| TF13 | 依赖与边界：仅新增 skill 内 `requirements.txt`（openpyxl）；`package.json`/lockfile 无变化；缺依赖环境如实报错不硬算 | R3 |
| TF14 | 既有链路回归：`npm run check`（含 agent-session 边界检查）通过；Host 侧改动仅限 catalog-data 三条目与 `openCatalogEntry` 导航接线，无其他代码逻辑改动 | — |

## 适用检查与未决

- 三套 `--selftest` 实测；`npm run check` 全量；合成 Provider 端到端（TF11）；浏览器点验能力目录三条目（TF02）。
- 移交包：候选清单+哈希、Codex 任务书（catalog-data 登记文案建议、独立复核导引）；移交后 Codex 实施目录登记、非作者独立复核（干净上下文子 Agent，覆盖 R1–R10 与 TF01–TF14）、Git/CI 至合并。
- 未决：原仓退役时点（合并+验收后另授权）；优惠券复盘脚本化、pandas 分析环境（各自另立）。

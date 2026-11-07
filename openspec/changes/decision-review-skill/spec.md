# decision-review 决策审视 skill（首期决策方法资产）

2026-11-07 · 本变更是 `qoder/ext-skills` 长期分支第三轮安装。

依据用户提供的[产品讨论稿 v0.1](../../../docs/OptraCall_决策方法资产与Decision_Review_Skill_产品讨论稿_v0.1.md)（已归档 docs/）：**首期只建设一个官方内置 `decision-review` skill**，以组合方法（TOC/TP、循证分析、因果推断、Decision Analysis、有限理性、风险与不确定性、Decision Quality 检查）组织能力，不为每个理论单独建 skill。全部内容为 Qoder 依据讨论稿原创撰写（首方设计，无第三方承接）；仓库内无既有 TOC/TP 资产文件（已核实），references 自带轻量使用指导。

**用户已确认的实施决定（2026-11-07）**：① 落位 `extensions/analysis-assets/decision-review/`；② Case 联动取**方案甲（最小）**：决策说明＝`060_reports` 下 Markdown 文件，复用既有 Case/决策板文件引用合同（[TF12 先例](../target-forecast-skills/result.md)），状态（draft/ready_for_review/accepted/rejected/deferred/superseded）仅作模板内文字标注，不建持久化状态机、不加新字段——对应讨论稿 5.3"不能首期重复建设决策状态系统"与 12.2 待确认事项的最保守落法；③ 零 scripts（决策审视为判断型任务，首期无确定性计算需求，量化计算交给 data-analysis/coupon-forecast/roi-forecast/target-forecast 等既有 skill）。

## 可观察结果

用户在项目任务对话提出决策审视类问题（"要不要做 X／两个方案怎么选／这份建议是否可靠／还缺什么信息才能定／项目是否继续投入"）时，任务 Agent 激活本 skill：按需组合方法检查目标、证据、假设、备选方案、取舍与验证条件，产出结构可伸缩的决策说明（轻量问题单段直答，重要决策用完整八模块），最终落 `060_reports` 并可被 Case/决策板按既有文件引用合同引用。纯查数、报表生成、无决策空间的常规任务不激活。能力目录"分析资产"出现"决策审视"条目（Host 接缝，归 Codex，附文案建议）。无新页面、无会话域、无依赖变化、零 Host 代码改动。

## 范围

- 新建 `extensions/analysis-assets/decision-review/`：
  - `SKILL.md`：激活描述（与既有 skill 分工切分：本 skill 审视"决策本身"，事实计算归 data-analysis/测算 skill，公开信息研究归 deep-research）、何时用/不用、方法选择原则（按需组合、可停止，不强制流程）、证据纪律、决策纪律、输出要求、自检、资源索引、边界。
  - `references/`×6（全部原创轻量指导，每份含适用条件与局限）：`decision-theory-primer.md`（理论总览：TOC/TP、循证、因果、DA、有限理性、前景理论、专家直觉、风险与不确定性、DQ）、`toc-tp-usage.md`（聚焦约束、因果逻辑检查、冲突与后果的审视动作映射）、`evidence-and-causality.md`（证据分级与反证、相关≠因果、观察≠干预、证伪条件）、`decision-analysis.md`（轻量选项比较：后果表、定性比较与区间/情景表达、何时移交量化 skill）、`uncertainty-and-bounded-rationality.md`（风险与不确定性的区分、情景表达、分析停止条件与信息价值、决策期限）、`decision-quality-checklist.md`（DQ 六维自检问题）。
  - `templates/decision-brief.md`：决策说明模板——状态行（文字标注六状态）＋分级说明＋八模块（决策问题/目标与约束/候选方案/事实与证据/假设与未知/方案后果/取舍与建议/验证与调整）。
  - `examples/`×2：`coupon-decision-example.md`（复购下降是否发券的正例——展示引用测算 skill 输出作证据、替代方案含不行动/暂缓/试行、条件性建议、验证条件）；`insufficient-evidence-example.md`（只有定性访谈无经营数据的反例——诚实停在条件性建议/未决，列证据缺口与获取计划）。
- `tests/protected-skills.test.ts` 追加 DRV01 发现+快照断言；新建 `tests/decision-review-skill.test.ts`（合成 Provider 端到端：读 SKILL 与模板 → 决策说明落 `060_reports`）。
- `docs/` 归档讨论稿；`openspec/changes/decision-review-skill/`（本目录）。

## 不做

- 不做逐理论独立 skill、决策流程编排器、独立决策 Agent/数据库/状态机/持久字段（方案甲）；不修改 pi-coding-agent SDK 内核；不让 Host 编排 Agent 内部分析步骤。
- 不新增 scripts（零脚本）与 subagent 角色（判断型任务，无隔离上下文需求——与 deep-research 的调研/审稿隔离不同）。
- 不要求每次决策审视创建 Analysis IR（讨论稿 6.2：轻量判断直接形成决策说明）；不替代审计/法律/财务专业判断；不替用户做价值选择。
- 不把决策说明状态做进产品界面（按状态筛选/统计/提醒属后续按使用反馈另立项）；真实模型激活率与建议质量走用户测评门禁，不在本变更内宣称。

## Interface 接入记录（IN01）

无 SDK 接入/会话变更：skill 经 [project-session.ts](../../../src/agent/project-session.ts) 既有 `additionalSkillPaths` 生效，Interface v3、域/profile/owner 不变；不使用 subagent、不新增工具；IN02–IN07 无新义务项。与既有 skill 分工：data-analysis／target-forecast／coupon-forecast／roi-forecast 提供事实与测算，deep-research 提供公开信息研究，本 skill 审视决策本身（目标、证据充分性、方案比较、取舍与验证）；不与任何既有 skill 抢激活。

## 关键规则

- DRV1 证据纪律：区分事实、证据、假设、经验、偏好与未知六类并逐类标注；保留来源、时间与核验状态；不得将相关关系写成因果结论，不得把观察关联说成干预效果；反证必须主动检索与呈现。
- DRV2 决策纪律：候选方案必须包含"不行动/暂缓/小范围试行"中至少与任务相关者，或说明为何没有；不伪造概率、效用、收益、权重或用户偏好——缺依据时用定性比较或区间/情景表达并说明限制。
- DRV3 建议边界：区分 Agent 分析结论、Agent 建议、用户确认的决定、实际执行与结果（讨论稿 5.4 六对象）；建议允许条件式（"若 X 成立则…"）或明确"当前信息不足以推荐"；Agent 建议永不写成用户已决定。
- DRV4 价值取舍归属：目标与偏好以用户明确表述为准；未明确时列为"需确认的价值取舍"，不把 Agent 推测当用户意图。
- DRV5 输出伸缩：轻量问题可单段直答（说明为何不需完整 brief）；重要决策用八模块模板；状态行文字标注（draft/ready_for_review/accepted/rejected/deferred/superseded），仅文档文字、非产品状态系统。
- DRV6 验证闭环：建议必须带验证安排与重新考虑条件（观察什么、何时复查、什么情况触发重议），与目标口径一致。
- DRV7 方法自主：方法按需选择、组合、停止；简单问题不强行启动完整方法清单；不得因方法存在而强制使用。
- DRV8 结果即文件：决策说明（最终版）落 `060_reports`（Markdown），过程笔记 `020_clean`；`010_draw` 软约束；引用测算/分析 skill 的数字必须来自其脚本输出，不心算不转写失真。
- DRV9 Case 关联最小实现：复用既有 Case/决策板文件引用合同引用 `060_reports` 中的决策说明；不新增持久字段、不建状态机。

## 验收

| 标识 | 条件 | 对应（讨论稿 10.2） |
| --- | --- | --- |
| DRV01 | skill 被 SDK 从 analysis-assets 发现（name/baseDir/description）；无 agents 目录、subagent 角色集不变；受管快照完整保留全部 10 个资源文件字节 | 架构 |
| DRV02 | SKILL.md：触发/不触发边界明确（讨论稿 3.2/3.3）；方法选择为指引非流程；证据与决策纪律齐备（DRV1–DRV4）；与既有 skill 分工不重叠 | 功能/质量 |
| DRV03 | 六份 references 齐备且各含适用条件与局限；模板含状态行与八模块；两个示例覆盖"证据充分条件性建议"与"证据不足诚实未决"两极 | 功能 |
| DRV04 | 合成 Provider 端到端：任务 Agent 实际发现 skill、读 SKILL 与模板、决策说明（含状态行与关键模块）落 `060_reports` | 功能 |
| DRV05 | 简单任务不误触发的边界在 SKILL.md 写明（纯查数/报表/无决策空间），并有负例表述 | 功能 |
| DRV06 | `npm run check` 全量通过；零 Host/Agent 代码、零依赖、零锁文件变化 | 架构 |
| DRV07 | catalog 文案建议随移交包（形态对齐先例），实施归 Codex | — |

讨论稿 10.2 中"决策说明能与 Case/Project/Session 关联""记录 Skill 与方法版本"两条：前者由 DRV9 最小实现（既有文件引用合同，浏览器级走查归 Codex 接缝阶段，同 TF12 处理）；后者由 OpenSpec 归档与测评卡版本绑定承载（skill 无独立版本号系统，与既有 skill 一致）。

## 适用检查与未决

- `node --test tests/protected-skills.test.ts tests/decision-review-skill.test.ts`；随后 `npm run check` 全量。
- skill 测评门禁：完成后同步 MacBook `/Users/huangbo/Dev/Projects/skill-eval/pending/decision-review/`，等用户回执；讨论稿 8.2 十维度与 8.3 案例集可供测评参考；循环至显式通过后才写 Codex 接缝任务书。
- 未决：方案乙（Case 轻量字段/状态识别）按使用反馈另立项；`option-analysis`/`risk-uncertainty-analysis` 等拆分由复用频率与评测驱动（讨论稿 7.2/7.3）。

# deep-research 深度研究 skill（WorkBuddy gpt-researcher-team 能力承接）

状态：本地实施、最新main集成及两轴非作者受影响重验完成；已获Git/CI和CI通过后直接合并／归档授权，实际head CI与归档尚未完成。原用户测评绑定a78a478，修正版未复测，见[结果](result.md)。

2026-11-04 · 本变更是 `qoder/ext-skills` 长期 skills 安装分支的首轮安装。来源：WorkBuddy 市场插件 gpt-researcher-team v2.0.0（7 角色 × 5 阶段深度研究团队，MIT，MacBook `/Users/huangbo/.workbuddy/plugins/marketplaces/experts/plugins/gpt-researcher-team/`），仅承接其研究方法、来源标准、审稿纪律与报告结构等能力；其市场外壳（plugin.json/人设/头像/quickPrompts）与 WorkBuddy 团队协议（TeamCreate/SendMessage）不进入本仓。

依据 Codex [任务 Agent 能力回执](../task-agent-capabilities/qoder-receipt.md)（main 功能提交 `f174ebb`）：产品工具 `subagent`（single/parallel/chain，角色仅从本次已加载 skill 的 `agents/*.md` 发现，命名为 `<skill>/<role>`）与 Provider 原生 `web_search`（MiniMax-M3/M3.1-Flash 与 mimo-v2.6-pro/flash 路线自动注入；deepseek-flash 未接通）。本 skill 不修改该接缝，只消费其契约。

## 可观察结果

用户在项目任务对话提出深度研究类问题（行业研究/竞品分析/市场调研/技术综述/文献综述/出一份研究报告）时，任务 Agent 激活本 skill：在有原生检索的路线上用 `web_search` 检索多源证据，按需经 `subagent` 委派 `deep-research/researcher`（调研撰稿）与 `deep-research/reviewer`（独立审稿）并行或链式工作，产出带真实来源引用、遗留问题披露与免责声明的 Markdown 研究报告，最终报告落项目 `060_reports`、过程笔记落 `020_clean`。无原生检索的路线上，Agent 如实声明能力未接通，仅基于用户提供的材料做综述式研究，不假装已检索。能力目录"分析资产"出现"深度研究"条目（Host 接缝，归 Codex，本文附文案建议）。无新页面、无新会话域、无插件、无脚本依赖。

## 范围

- 新建 `extensions/analysis-assets/deep-research/`：
  - `SKILL.md`：激活描述、环境判别（有无原生检索）、红线、方法指引（5 阶段 + 完整/快速/单章三模式、委派用法）、资源索引、边界。
  - `agents/researcher.md`：调研撰稿角色——独立检索、区分证据与观点、来源清单只认供应商回执、来源不足如实声明。
  - `agents/reviewer.md`：独立审稿角色——6 维标准、PASS/REVISE、第 3 轮强制通过转遗留建议。
  - `references/method.md`（阶段方法、三模式、研究参数卡、委派模式示例）、`references/source-standards.md`（来源优先级/数量质量目标/时效窗口/引用格式/回执规则）、`references/review-checklist.md`（6 维审查、硬性退回、轮次与修订原则）、`references/report-structure.md`（报告结构模板与终检清单）。
- `tests/protected-skills.test.ts` 追加 DR01 发现断言；新建 `tests/deep-research-skill.test.ts`（合成 Provider 端到端，复用 subagent-runtime fixture 模式，走真实 analysis-assets 目录与真实角色文件）。
- `openspec/changes/deep-research-skill/`（本目录）。

角色承接映射（保真记录）：原 7 角色中主编（research-chief-editor）= 任务 Agent 自身（编排自主进行，非强制流程）；谭溯源（topic-researcher）→ `researcher`；明鉴秋（draft-reviewer）→ `reviewer`；季要纲（research-planner，大纲）、任润泽（draft-reviser，修订）、程文成（report-writer，引言结论参考文献）、傅梓铭（report-publisher，组装终检）→ 父 Agent 内化（大纲/修订/汇总/组装不需要隔离上下文，完整对话上下文反而有利）。中文人设名、头像、团队协议、进度通报模板、超时降级表不承接。

## 不做

- 不改 SDK/Host/Agent 代码：subagent 与 native-search 实现归 Codex（`codex/Host-Agent-Extension`）；catalog-data 登记与 `openCatalogEntry` 导航为唯一 Host 接缝，归 Codex（移交包附文案建议），Qoder 不实施。
- 不建会话域/owner/profile/agentOptions，不改 Interface；不建插件、页面、路由、触发按钮。
- 不新增 Python 脚本或依赖：本 skill 是提示词与方法资产，检索由 Provider 原生 `web_search` 承担，无 `scripts/`。
- 不承诺 deepseek-flash 路线可检索；不新增独立 `web_fetch`；不代供应商核实来源内容真伪（回执来源≠内容已核实）。
- 真实模型激活率、报告专业质量与产品验收不在本变更内完成，按届时授权另行验证。

## Interface 接入记录（IN01）

无 SDK 接入/会话变更：skill 经 [project-session.ts](../../../src/agent/project-session.ts) 既有 `additionalSkillPaths`（`extensions/analysis-assets`）对普通任务与受管 ordinary 任务生效，Interface v3、域/profile/owner 均不变。消费 f174ebb 交付的 `subagent` 工具契约（角色发现见 [subagent.ts](../../../src/agent/subagent.ts)：仅 name/description/可选 tools frontmatter，禁 model/cwd/agentDir；三形态互斥、每批 1–8 项、chain 用 `{previous}`）与原生检索回执（[native-search.ts](../../../src/agent/native-search.ts)：来源 URL 仅出自供应商结构化回执）。IN02–IN07 无新义务项。受保护核算/返修、fixed-draft、专属业务 workspace 不提供 subagent，本 skill 在此类会话自动只有方法指引可用，不委派。

## 关键规则

- DR1 引用真实：进入报告的来源 URL 只能来自本次 `web_search` 供应商回执（"本次联网检索来源（供应商回执）"块）或用户提供的材料；正文自述链接不算检索证据；禁止编造 URL、标题、数据。
- DR2 能力诚实：配置路线无原生检索（如 deepseek-flash）时，如实声明"当前配置路线未接通原生检索"，降级为用户提供材料综述；检索失败或结果不足时如实说明，不用编造补位。
- DR3 事实与观点区分：事实性陈述须有来源支撑；"数据显示"与"有观点认为"措辞区分；多元观点并陈，不预设立场。
- DR4 来源质量目标：每章目标 ≥5 个独立来源且 ≥3 种类型（学术/机构/行业/媒体），全文 ≥20 个；权威来源优先（学术 > 官方机构 > 咨询 > 主流媒体 > 博客辅助）；时效窗口按课题类型选择（AI/科技默认近 1 年、行业趋势近 2 年、学术综述近 5 年）。此为质量目标与自检口径，不是硬门禁；达不到时如实披露差距。
- DR5 委派契约：子角色只经 `subagent` 工具调用（single / tasks / chain 三形态互斥，每批 1–8 项）；审稿优先委派 `reviewer`（隔离上下文=独立视角）；审稿循环最多 3 轮，第 3 轮强制通过并将未解决问题列入报告"待完善事项"；每次委派的任务说明须自带必要上下文（子会话不继承父对话），推荐用"研究参数卡"携带。
- DR6 能力注入非流程编排：阶段与模式是方法指引，Agent 自主决定方法、委派时机与迭代；不强制建组、不强制固定步骤、Host 不加触发入口。
- DR7 结果即文件：过程笔记（参数卡、来源池、章节草稿）默认 `020_clean`，最终报告 `060_reports`（Markdown）；报告含来源列表与免责声明；`010_draw` 原件软约束继续适用。
- DR8 角色定义合规：`agents/*.md` 仅 name（小写标识符）/description/可选 tools（省略即继承父可安全提供能力，含 web_search）；不含 model/cwd/agentDir；文件为真实文件、<128KB。
- DR9 保真承接：研究方法、来源标准、审稿纪律、报告结构按原插件承接；英文人设与团队机制丢弃；原插件"≥5 来源"等硬配额在本产品语境下调为质量目标（DR4），因检索能力由 Provider 原生工具承担且 Agent 自主。

## 验收

| 标识 | 条件 | 对应 |
| --- | --- | --- |
| DR01 | skill 被 SDK 从 `extensions/analysis-assets` 发现（`name: deep-research`、baseDir 正确）；`discoverSubagentRoles` 发现且仅发现 `deep-research/researcher` 与 `deep-research/reviewer`；受管快照完整保留 SKILL.md、agents/、references/ 全部字节 | DR8 |
| DR02 | SKILL.md、两个角色文件、四份 references 齐备：红线（DR1/DR2/DR3）、方法指引（非强制）、委派用法（三形态、参数卡）、资源索引路径真实存在 | DR5/DR6 |
| DR03 | 合成 Provider 端到端（真实 skill 目录）：任务 Agent 经 `subagent` 实际委派 researcher 与 reviewer；子会话不继承父对话；chain 经 `{previous}` 传递；父收齐结果正常完成；子角色可读取本 skill references 资源 | DR5 |
| DR04 | 无原生检索路线的行为边界在 SKILL.md 写明（声明降级、不假装检索），与 Host 既有 guidance（不虚称已检索）一致，不重复不冲突 | DR2 |
| DR05 | 既有回归：`npm run check` 全量通过（含 f174ebb 的 subagent/native-search 测试与边界检查），无 Host/Agent 代码改动 | — |
| DR06 | catalog 登记文案建议随移交包交付（名称、说明、note 对齐 ppt-report/target-forecast 先例），实施归 Codex | — |
| DR07 | 引用与诚实红线经文档复核：正文引用格式、参考文献列表、"待完善事项"与免责声明结构在 report-structure.md 完整 | DR1/DR7 |

## 适用检查与未决

- `node --test tests/protected-skills.test.ts tests/deep-research-skill.test.ts`；随后 `npm run check` 全量。
- 移交包：候选清单+哈希、catalog 文案建议、非作者复核导引；Host 接缝（catalog-data+openCatalogEntry）移交 Codex。
- 未决：真实模型检索与报告质量验证（另授权）；原插件仓库处置；deepseek 路线检索接通（Codex/用户决策）。

## Codex 接管与用户新增展示要求（2026-11-04）

原交接HEAD`032924965b15557ec36c9767c6f57e17b498a08f`在独立工作树逐项核对14/14完整SHA与提交字节相符后接管；Qoder原工作树干净、同HEAD游离，分支由Codex唯一写入。原清单不回写，14份原交接文件另保存在仓外；下列修正的候选身份与原始清单分别记录。

非作者原阶段发现：来源数量被写成硬退回门槛；缺可引用来源被误判为路线未接通；默认完整模式例行要求确认大纲。由Codex直接修正为质量目标／如实披露、按Host实际能力与来源事实区分、范围清楚时自主继续；不改既有subagent/native-search实现、依赖、Interface v3或owner/profile。移交书13/14口径与两个相对链接一并修正，原字节与发现保留。提示词语义修正不伪造模型行为RED；文档一致性复核、合成SDK集成测试和真实模型测评分别核定。

用户追加：skill介绍卡片展示测评数据，并将显示指标统一用于后续skill。用户已确认[展示规范](../../../docs/skill-evaluation-display.md)与[可点击Demo](../../../docs/prototypes/skill-evaluation-catalog-demo.html)，随后指定全部测评数据默认收起、手动点击一次展开。沿用现有卡片和打开入口，展开后共同显示条目累计增益、激活率、耗时／Token代价、胜率分母及未判定样本；已有skill无回执时显示数据待补，非skill不加此区域。此为目录展示，不建测评平台、后台模型或新增使用门禁。

原用户测评通过对应a78a478，交接后修正版未经用户复测；展示绑定被测版本并标明修正未复测，不沿用旧成绩宣称新版有效。原回执产物口径的数值差异另记，不覆盖原数据。

| 新增验收 | 条件 |
| --- | --- |
| DR08 | 目录出现深度研究已接入条目，真实打开进入项目看板，检索路线说明如实；不创建新页面或发送模型请求 |
| DR09 | 测评区域默认收起，点击一次展开全部结论／版本／指标／代价及完整分母口径，可再次收起；数据待补不填零，非skill不套用；窄屏／浅深色／键盘路径可用 |

新增正式测评UI已取得上述Demo和指标口径确认，默认收起为用户随后直接指定的修订，按此实施，不重新请求已明确的UI选择。Git/CI与合并按本任务有效授权核定，不将此前其他变更授权沿用本轮；不切换产品运行服务、不操作MacBook、不新增真实模型实验。最新main当前已到bee3ae0，集成与受影响检查的实际身份另记，不提前宣称已集成。

### 当前本地验收状态

原移交基线的修正候选已完成 `npm run check`（1008项：1005通过、0失败、3原条件跳过，含边界／类型／构建），并在隔离正常Host实点DR08／DR09：五项默认收起、一次展开全部指标与分母、键盘收起、无回执不补造、浅深色及390px窄屏、打开进入项目看板。26个Host请求均为GET，无模型请求；证据身份、无效截图与最终非作者复核见[结果](result.md)及[独立复核](independent-review.md)。本地结果不替代后续最新main整合、实际head CI、合并或修正版用户测评；当前未归档。

### 获授权集成增量

用户随后授权Git/CI及CI通过后直接squash合并、快进main并归档。已于 `ef95ce7` 集成最新main `bee3ae0`，保留现行四点原则、全部main语义追溯／个人资料行为与既有授权；工程规范v1.6新增同源测评展示标准。集成后95项受影响回归、边界、类型和构建通过，实际产品UI与原非作者集成增量核验均通过：独立43／63项回归分别保留，866文件零漂移及16件产品UI证据匹配；14个GET无模型发送，main个人资料和企业资料入口保留。此为定向复验，不把原基线1008项写成集成后本地全量。合并／CI／归档的实际回执以最终记录为准，真实模型复测与设备／服务边界不扩大。

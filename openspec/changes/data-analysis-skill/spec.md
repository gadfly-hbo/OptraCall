# data-analysis 运营数据分析 skill（重写式承接）

2026-11-05 · 本变更是 `qoder/ext-skills` 长期分支第二轮安装。

**原位归档（2026-11-06）**：[PR #39](https://github.com/gadfly-hbo/OptraCall/pull/39) 已 squash 合入 main `7537fbad77545336bc9e9b3208515aa269bd57e1`，本地 main 已安全快进。原作者计划与当时待验措辞保留，最终范围、验收及原失败见末节与[result](result.md#合并交付与原位归档)。归档提交自身身份、main push CI 与分支回交按实际 Git／Actions 及最终仓外回执核定；不由此宣称运行采用或新增模型测评。

**承接方式（用户裁定 2026-11-05：B 重写式承接）**：用户明确对 WorkBuddy 市场第三方技能 data-analysis v1.8.0（天箭星科技）**无再分发授权**，本仓为公开仓库，故不移植其任何文本、代码、数据或文件；本 skill 为 Qoder 独立设计与实现的 OptraCall 原生技能，仅对齐其公开可见的能力品类（六段式经营数据分析报告、确定性复算脚本、数据体检门禁）。方法论概念（六段契约、四类数据工程陷阱、复算纪律）属通用方法不受版权保护，但全部表达、代码、示例数据、阈值细则为本文变更自研；未逐行参照、未逐句改写第三方内容。研究副本仅存本机 gitignored `.local/`，永不入仓；MacBook 原件不动。能力对标差异（本版未覆盖项）在"范围/不做"如实记录。

## 可观察结果

用户在项目任务对话提出运营数据分析类问题（分析数据/看趋势/找异常/数据体检/用示例数据试一下）时，任务 Agent 激活本 skill：先判输出形态（直答/归因/正式汇报），锁定口径后用确定性脚本复算（calc.py 验数字、quality_check.py 验格式与数据体检），按六段契约在回答正文输出可复算的分析报告（每条结论绑定数字与基准、每条建议含责任人与时限），最终报告另存项目 `060_reports`、过程产物 `020_clean`。无数据时可用内置合成示例数据先跑通全流程；脏数据先体检再分析。能力目录"分析资产"出现"运营数据分析"条目（Host 接缝，归 Codex，附文案建议）。无新页面、无会话域、无依赖包变化。

## 范围

- 新建 `extensions/analysis-assets/data-analysis/`（全部自研）：
  - `SKILL.md`：激活描述（与 target-forecast/coupon/roi/deep-research 按问题域切分：本 skill＝事后描述统计/归因/异常/体检，不做目标测算/发券/投放/深度研究）、输入五项、输出分级、六段契约、拆解范式与口径提示、红线、四类数据工程陷阱、双脚本纪律（回答即交付物）、示例、能力边界与 OptraCall 目录约定。
  - `scripts/calc.py`：验数字——`decompose`（乘法顺序剥离，效应之和构造性精确等于总变动；加法模式）、`compare`（同环比＋不等长期间按天对齐）、`outlier`（3σ 要求 n≥30 / IQR）、`weighted`（加权 vs 算术平均差异）、`period`（期间等长判定）、`trend`（最小二乘斜率＋R²，窗口 <3 报错）。Decimal 精算（str 中转、仅输出一处舍入 ROUND_HALF_UP）、回显算式、口径缺失即报错；退出码 0/2（输入）/3（闭合失败）；`--selftest` 手算整数案例＋同输入逐字节确定性。
  - `scripts/quality_check.py`：验格式与数据——`--report` 六段齐全与顺序（声明"输出形态：直答"时只查红线）、红线文本判据（同环比＋未完成期间词、行动建议缺责任人/时限、相关结论缺"未做因果检验"标注、小样本缺置信标注）；`--data` CSV 体检（完全重复行、主键重复、月份缺口、率列区间、疑似合计行）；`--selftest` 含正反样例对抗验证（检查器须对坏样例命中、对好样例通过）。
  - `references/method.md`（公式、方法选型、四类陷阱的检测动作、图表选型）、`references/sample-data.md`（自有合成 6 店×2 月＋脏数据对照集与复算步骤）、`references/examples.md`（自有完整六段样例报告）。
- `tests/protected-skills.test.ts` 追加 DA01 发现+快照断言；新建 `tests/data-analysis-skill.test.ts`（合成 Provider 端到端：任务 Agent 经 bash 实际运行双脚本 selftest 并回传结果，TF11 先例）。
- `openspec/changes/data-analysis-skill/`（本目录）。

## 不做

- 不复制、不改写、不逐行参照第三方包的任何文件；不保留其 manifest/市场外壳/品牌；不引入 pandas/numpy（纯标准库）；不引入 Python 以外的运行时。
- 本版不实现：趋势的季节指数与移动平均（trend 仅斜率+R²，扩展另立增量）、多对多 JOIN 行数体检（连接爆炸须在取数侧核对，SKILL 指引以人工核对清单承载）、`--package` 包一致性校验（自研包结构由本仓测试覆盖，无需运行时自校）。
- 不做预测与业绩承诺；不替代审计/税务/法律判断；不做流程建模与方案设计（超范围问题如实说明并建议另立项）。
- skill 脚本 selftest 不进 Node CI（与 target-forecast/ppt-report 先例一致），验收与复核实测。
- 真实模型分析与报告质量验收走用户测评门禁，不在本变更内宣称。

## Interface 接入记录（IN01）

无 SDK 接入/会话变更：skill 经 [project-session.ts](../../../src/agent/project-session.ts) 既有 `additionalSkillPaths` 生效，Interface v3、域/profile/owner 不变；不使用 subagent（分析计算在任务会话内完成，无隔离上下文需求）；IN02–IN07 无新义务项。与既有测算 skill（target-forecast/coupon/roi）按问题域分工互不抢激活；与自动核算（业务语义验证）互补：本 skill 管分析过程纪律，核算管独立复核，职责不重叠。

## 关键规则

- DA1 回答即交付物：六段全文必须直接出现在回答正文（含全部结论数字、样本量、责任人时限）；若另写文件（`060_reports`），文件只是副本。
- DA2 先口径后计算：五项输入（目标/来源/期间/口径/样本量）缺任一须在报告首段标"输入不完整"并说明影响；分析目标缺失须回问，不得自行假设。
- DA3 形态分级：「多少/是否」直答（数字+基准+口径一句）；「为什么/哪里/怎么变」六段；「汇报/复盘」六段+方法论+保留意见。不用六段回答单指标问题。
- DA4 数字出自脚本：进入报告的计算结果必须经 `calc.py` 复算（拆解效应之和差额 >0.01 即退出码 3 拒绝输出）；报告数字与脚本回显算式一致；Agent 不心算。
- DA5 格式经门禁：六段报告交付前跑 `quality_check.py --report`，数据先跑 `--data` 体检；门禁不过先修正再交付，不降低门禁。
- DA6 红线：无依据量化预测、相关当因果、无口径下结论、插补数据撑趋势结论、无责任人建议、期间不等长直比、分组均值再算术平均、分母定义变更后直比——违反即报告作废。
- DA7 四类陷阱排查：连接爆炸（行数核对）、期间不完整、平均的平均、分母漂移；逐条排查结果写入第一段。
- DA8 诚实边界：样本 <30 或分组 <5 标置信不足；缺失值只标注不插补；异常值先区分录入错误与真实波动再处置；输入可疑点如实列出。
- DA9 目录约定：用户材料自 `020_clean` 取，过程产物 `020_clean`，最终报告 `060_reports`；不读 `010_draw`（软约束）；脚本需 python3（标准库即可）。

## 验收

| 标识 | 条件 | 对应 |
| --- | --- | --- |
| DA01 | skill 被 SDK 从 analysis-assets 发现（name/baseDir/description）；受管快照完整保留全部资源字节 | DA9 |
| DA02 | calc.py --selftest 全绿（含确定性：同输入两次运行逐字节一致；手算整数案例） | DA4 |
| DA03 | decompose：乘法顺序剥离效应之和精确等于总变动（构造性闭合，无事后配平）；加法模式闭合；闭合失败退出码 3 | DA4 |
| DA04 | outlier：n<30 时 3σ 拒绝并提示 IQR；IQR 越界检出与偏离度正确 | DA4/DA8 |
| DA05 | period/compare：不等长期间判定与按天对齐；天数比例表述自算（不留"≈"给读者脑补） | DA6 |
| DA06 | quality_check.py --selftest 全绿（正反样例对抗：检查器对坏样例命中、好样例通过）；--report 六段/直答分流/红线判据；--data 五项体检 | DA5 |
| DA07 | SKILL.md：激活分工不与既有 skill 重叠；红线/陷阱/分级/五项输入齐备；目录约定明确 | DA2/DA3/DA6/DA7/DA9 |
| DA08 | 合成 Provider 端到端：任务 Agent 实际发现 skill 并以 bash 运行双脚本 selftest 全绿、回传结果 | DA4/DA5 |
| DA09 | `npm run check` 全量通过；无 Host/Agent 代码、依赖、锁文件变化 | — |
| DA10 | catalog 文案建议随移交包（形态对齐 deep-research 先例），实施归 Codex | — |

## 适用检查与未决

- `node --test tests/protected-skills.test.ts tests/data-analysis-skill.test.ts`；`python3 scripts/calc.py --selftest` 与 `python3 scripts/quality_check.py --selftest`（本机实测）；随后 `npm run check` 全量。
- skill 测评门禁：完成后同步 MacBook `/Users/huangbo/Dev/Projects/skill-eval/pending/data-analysis/`，等用户回执；循环至显式通过后才写 Codex 接缝任务书。
- 未决：季节指数/移动平均、JOIN 体检（另立增量）；真实数据分析质量与激活率（用户测评）。

## Codex 接管与修正范围（2026-11-06）

独立工作树从f9005f7接管，原清单12/12及提交字节一致；其中6份skill、2份测试和本规格的原字节均与6df72f4一致。原清单、移交包及作者阶段证据保留，不回写为修后清单；本节起记录Codex增量。Qoder原树停留同提交游离状态，本轮由Codex唯一写入，合并归档后再归还长期分支。

- 目录接缝沿deep-research的同一折叠卡片与projects导航。为如实承载provisional、限制和用户已指定的单向覆盖，最小扩展共享SkillEvaluation可选字段；旧条目默认行为保持，当前data-analysis显式覆盖工程修正版。断言增益由38/142与139/159未舍入率计算，显示26.8%→87.4%及+60.7pp；不补造置信水平。无新布局、页面或交互，沿已确认Demo，按工程规范§3无需另出Demo；实际浏览器仍须点验。
- 非作者发现的已确认DA03–DA06计算／输入／门禁合同问题由Codex修复：未舍入效应闭合及算式、常量方差0、非有限数、整数天数／样本数、3σ和趋势阈值下限、IQR实际边界偏离量，以及同一局部比较的期间对齐、普通行动段、无声明的相关表述。保留因果RED、旧自检GREEN与永久定向回归，不以作者自检代替独立复验。
- 纠正样例加盟A客单价持平、方法中交叉项由后剥离者承担，以及激活描述过宽、JOIN排查不必要转交人工、DA4不能识别业务分母定义等说明。JOIN专用体检、季节／移动平均、评估P1–P11／12条断言定义加固均不开发；复核修正不触发用户复测。
- 闭合效应、输入及算式保留必要精度；展示百分比等按声明位数最后舍入。两脚本继续纯标准库；新增Node永久回归仅运行有界合成CLI／门禁案例，原双脚本selftest仍在验收和复核独立执行，不改变Qoder两份测试。
- DA09的“无Host/Agent代码变化”对应Qoder切片；Codex最终候选包含上述明确授权目录／展示接缝，不改SDK、Interface v3、owner/profile、Runtime、凭据、依赖或锁文件。工程规范四原则仍适用；只在隔离合成根做Host/Pi/UI验证，不切任何现有运行服务、不操作MacBook、不新增真实模型实验。
- 首次全量暴露既有修订权限测试夹具仅等待持久completed、未等公开snapshot.idle的准入时序窗口。只加强该夹具等待，保留15秒边界与全部202／原件保护断言，不改产品Busy合同或重试POST；独立源码评估、原FAIL及修后结果分别保留。

用户测评通过及单向覆盖以本任务书和result回执为准，旧“等待测评”的措辞保留为作者阶段记录。原始历史TDD顺序若无前置RED证据，记NOT_PROVED，不能用当前补测伪造；当前修复RED/GREEN和非作者结论另列。

### 最新 main 集成的受影响修正

用户已授权 Git/CI 及 CI 通过后直接合并归档。集成 `1fdfb09` 保留 main 的 SAP／model-pack 入口、官方 SDK 1.4.0 治理与上下文适配；不修改其 SDK／Runtime／依赖合同。基线 `33c95c5` 已有 deep-research 的明确单向覆盖裁定，本轮发现旧卡状态遗漏，复用同一可选覆盖字段修正，原被测身份／指标和未重测事实不变。另仅在旧 MP04 测试 stop 后增加有界终态＋idle 等待，保留生产准入、原断言和一次归档请求；与前述完成后等待的旧夹具分开记录。集成原失败、修后重验与实际 head CI 按 result 逐项核定。

## 最终验收与归档范围

DA01–DA10 按实际工程范围完成：原候选12/12核对；两脚本独立自检21/21、17/17，数值／门禁修正及样例经原非作者重验；SDK发现／受管快照／合成DA08通过；目录、默认收起测评、手动开合及项目导航正式桌面点验通过。原始开发前RED仍NOT_PROVED，词法门禁语义限制、有限B抽查及一次验证目录偏差保留，不解释为全球零复制或报告质量保证。

DA09最终证据为实际head `fc82a6f` 的默认 [Check #112](https://github.com/gadfly-hbo/OptraCall/actions/runs/42170523716)：1645项／1544 PASS／0 FAIL／101条件SKIP，边界、tsc、构建及高危级别审计成功。另本机显式测试并发2的同三阶段完整检查1645项／1615 PASS／0 FAIL／30 SKIP；本机默认并发v4/v5失败与取消保留，不称默认并发稳定性已证明。作者早期“脚本selftest不进Node CI”与后来DA08实现口径不一致，按实际实现核定：DA08经bash执行两份selftest，未另设独立CI job；不把条件跳过称为脚本已运行。

工程规范v1.8、Interface v3、官方Pi 1.4.0沿统一入口；无新域／owner／profile、SDK实现／依赖锁变化。DA09原“无Host代码”仅为Qoder切片，Codex目录／共享展示接缝与已列测试修正已按本任务书交付。用户原测评身份仍为6df72f4／1.9.0，effective与provisional、成本及baseline超时保留，单向通过覆盖工程修正而不假称重测；12条测评断言加固仍另立增量。窄屏、新真实模型、运行采用及MacBook更新不在本次完成声明内。

本目录原位保留规格、结果、非作者报告、原清单与handoff；不迁移路径、不回写清单、不改已合并运行资源和测试。归档仅本规格、result与AGENTS最小同源指针三份Markdown；其余Git blob须与合并树逐项相同，最终提交／CI／回交以真实回执核定。

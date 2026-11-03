# target-forecast 三测算 skill · 实施与验证记录

日期：2026-11-03 · 分支：`qoder/target-forecast` · 状态：Codex 已接管，正在实施目录接缝及独立复核；Git/CI 交付尚待用户另行授权。下文 Qoder 原始证据及未验证项保留其移交时范围。

## Codex 接管与候选核对

- 独立工作树：`/Users/bendandebaba/.codex/worktrees/target-forecast-delivery/OptraCall`；交接提交与 origin 分支均为 `0b436e591d3d56a3394edd28593074599b688b2e`，基线 `636ac3a53f69c524030cc6294d6eeccbdae3f6d7`。原 Qoder 工作树已游离，移交后 Codex 为唯一写入者。
- 原候选清单实际列 30 个文件；首次逐项核对 **29/30 一致**。唯一差异是 `review-handoff.md`：清单预期前缀 `d1bb5e129083ecca`，实际 SHA-256 为 `6b767f9271bee99f0b06f9abd7db9f11f089a56b4c1af9943e5698c3f93d429d`；实际文件与交接提交 blob 一致，工作树干净。清单自身也与交接提交一致，故原始清单内部不一致，不能记为全部通过。
- 已暂停实施并向用户说明差异；用户明确回复“同意，确认”，接受以交接提交中的实际移交包继续。原 `candidate-manifest.txt` 与 `review-handoff.md` 保持原字节，不回写清单掩盖失败。移交包中“尚未提交/推送”等为 Qoder 收尾前历史描述，由本次已推送提交及接管记录说明当前状态。
- 原始核对证据：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-intake-20261103T003606/`；独立复核核对证据：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-intake-audit-20261103-003658-0212a82c/`。本项用户接受仅解决候选身份差异，不代替工程复核、Git/CI、产品验收或设备采用授权。

## 授权与流程

- 2026-11-02 用户确认[讨论稿 v0.2](../../../docs/TargetForecast能力承接产品讨论稿_v0.2.md)（skill 形态 D1–D5、三 skill 实现思路、纯 Python+openpyxl 依赖边界、pandas 不引入另立提案），确认规格后指令"已确认，开始实施"。
- 按规格实施；无 Host 代码接缝（唯一接缝 catalog-data+openCatalogEntry 归 Codex，移交后实施）。无 UI 变更，无 UI Demo 环节。

## 实施范围（实际交付物）

```
extensions/analysis-assets/
├── target-forecast/    # 经营目标测算（人/货/场）
│   ├── SKILL.md                     # 激活描述+红线8条+流程+资源索引
│   ├── scripts/ingest.py            # 模式A/B 导入+三级质量（optracall-forecast-ingest-1）
│   ├── scripts/forecast.py          # 三视角引擎+全渠道汇总+交叉校验（optracall-forecast-1）
│   ├── scripts/template.py          # 两张 xlsx 模板+参数 JSON 模板
│   ├── scripts/requirements.txt     # openpyxl
│   ├── scripts/golden/{engine,ingest}-expected.json
│   └── references/{method,input-spec,golden-cases}.md
├── coupon-forecast/    # 优惠券四子模型
│   ├── SKILL.md
│   ├── scripts/coupon.py            # 规格+引擎+比较+压力（optracall-coupon-1）
│   ├── scripts/bucket.py            # 分桶/订单明细导入（error/warning 分级）
│   ├── scripts/template.py          # 场景 JSON+两张 xlsx 模板
│   ├── scripts/golden/{coupon,coupon-stress}-expected.json
│   └── references/{method,review,golden-cases}.md
└── roi-forecast/       # 投放 ROI
    ├── SKILL.md
    ├── scripts/roi.py               # 链路引擎（optracall-roi-1，纯标准库零依赖）
    ├── scripts/golden/roi-expected.json
    └── references/method.md
```

另：`tests/protected-skills.test.ts` 追加 TF01 发现断言（该文件已在边界清单 `toolSdkConsumers` 豁免 `loadSkillsFromDir`，未改边界脚本）；`tests/target-forecast-skills.test.ts`（TF11，经 startTestHost 产品路径）；规格与本文档；讨论稿 v0.2。

## 数学承接与黄金案例（R10 等价性证据）

- 原仓参考：MacBook `target-forecast` 仓（业务基线 `df5acd6`），源码拉至 `.local/target-forecast-ref/`（gitignore，不入仓）。
- 黄金期望值由**原仓实现在固定合成输入上计算生成**：roi（demo 计划集）、coupon（提案 7.1 场景+7.3 压力）、forecast（手构确定性 18 月×2 平台数据集与 6 行明细+2 行聚合）。
- coupon/roi 黄金在本机（Mac mini, Python 3.14）由原仓代码重新生成——MacBook 原生成走 Python 3.9，`math.exp` 跨 libm 存在 ULP 级差异；本机再生成后 selftest 达**逐值一致**。原 MacBook 版黄金保留在 `.local/golden/` 供对照。
- forecast/ingest 黄金来自原仓 pandas 实现，selftest 按**数值容差 1e-9（相对）/1e-6（绝对）** 对照（去 pandas 化的求和次序差异远小于该容差），blocker 消息要求逐字一致。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `roi.py selftest` | PASS：4 计划×3 情景黄金逐值一致；确定性（同输入两次运行逐字节一致）通过 |
| `coupon.py selftest` | PASS：10 行黄金表（转化率/券补/总贡献/ΔΠ，±1 分）+ 压力 4 情景 + compare 全行结构（含 breakeven）逐值一致；拆解对平不变量（Σ拆解=ΔΠ，容差 1e-3 分）与确定性通过 |
| `bucket.py` / `template.py`（coupon）selftest | PASS：分桶/订单导入、权重归一、重复订单拦截、退款口径警告、三件模板生成与表头 |
| `ingest.py selftest` | PASS：明细→月度 4 月+货结构 2 行+聚合 2 月与原仓一致（容差 1e-9）；4 类 blocker 消息（重复月份/非正金额/订单身份/日期不可解析，含行号与口径说明）逐字一致 |
| `forecast.py selftest` | PASS：2 平台×3 情景×12 月人/场/货三视角+全渠道汇总 36 行+平台年度+基线/季节占比与原仓一致（容差 1e-9）；交叉校验（主口径映射、>5% 打标）与确定性通过 |
| `template.py`（target-forecast）selftest | PASS：两张模板+参数 JSON；模板示例行通过 ingest 校验闭环 |
| `node --test tests/protected-skills.test.ts tests/target-forecast-skills.test.ts` | 5/5 PASS（含既有 4 项） |
| TF01（skill 发现+受管快照） | PASS：`loadSkillsFromDir(extensions/analysis-assets)` 发现三 skill（baseDir/描述正确），`snapshotProtectedSkills` 快照完整、unavailable=[]（受管路径可用性） |
| TF11（任务内全流程，真实 SDK 路径） | PASS：startTestHost 合成 Provider 任务会话内，Agent 经 bash 实际执行 7 项 selftest 全绿 + template→run→报告链路；引擎身份与 input_digest 经工具结果回传写入报告；报告按 020/060 目录约定落 `project.rootPath/060_reports`；普通任务 read/bash/edit/write 工具保留 |
| `npm run check` 全量 | exit 0：900 项（897 PASS / 3 条件 SKIP / 0 FAIL）+ 边界检查（未改边界脚本）+ 构建；既有 bundle 体积警告保持披露 |

## Qoder 移交时验收映射（保留原范围）

| 标识 | 状态 | 依据 |
| --- | --- | --- |
| TF01 skill 发现 | 通过 | protected-skills TF01（发现+快照） |
| TF02 目录登记 | **待 Codex** | 唯一 Host 接缝（移交包附三条目文案建议） |
| TF03 forecast 导入 | 通过 | ingest selftest（三级质量、blocker 行号、confirmable、左截断 quality） |
| TF04 forecast 测算 | 通过 | forecast selftest（三视角/多情景/汇总/交叉校验） |
| TF05 coupon 不变量 | 通过 | coupon selftest（分支账本、拆解对平、整数分、无券候选、预算过滤、四类结论） |
| TF06 coupon 压力 | 通过 | coupon-stress 黄金（变体显式指定，含排序翻转与可行性翻转示例） |
| TF07 roi 测算 | 通过 | roi selftest（保本 CVR*/gap/稳定性） |
| TF08 selftest+确定性 | 通过 | 7 项 selftest 全绿；同输入逐字节一致 |
| TF09 SKILL.md | 通过 | 三份 SKILL.md：红线（R4–R7）、流程指引、资源索引；激活描述按问题域切分 |
| TF10 模板 | 通过 | 两 skill 模板 selftest；roi 内置 template 命令 |
| TF11 任务实测 | 通过 | tests/target-forecast-skills（真实 SDK 路径、020/060 约定、身份栏位） |
| TF12 证据链 | 设计满足，运行时复用既有合同 | 测算报告=060_reports 普通文件，Case/决策板既有文件引用合同直接适用（无新机制；浏览器级引用走查归 Codex 阶段与独立复核） |
| TF13 依赖边界 | 通过 | `package.json`/lockfile 零变化；仅 skill 内 requirements.txt（openpyxl）；环境缺依赖如实报错 |
| TF14 回归 | 通过 | `npm run check` exit 0；Host 代码零改动 |

## 如实保留的边界与未验证项

- 真实模型端到端未做（全部验证为合成 Provider/合成数据）；skill 激活率依赖 description 质量，真实模型的激活行为未测。
- forecast 引擎黄金容差 1e-9（非逐字节）：去 pandas 化的求和次序差异所致，原理与量级记录于 method.md；roi/coupon 为逐值一致。
- TF12 的浏览器级 Case/决策板引用走查未做（Qoder 侧无 UI 改动，复用既有链路）；TF02 目录登记归 Codex。
- 三 skill 脚本在 Agent 实际任务中的长链路使用（多轮调参、报告撰写质量）未验证——属真实模型验收范围。
- 原仓退役、JuanerAI 对接文档处置按届时授权另行执行。

## 下一步

整体移交 Codex：核对候选清单 → 实施唯一接缝（catalog-data 三条目 + openCatalogEntry 导航）→ 非作者独立复核（干净上下文子 Agent）→ Git/CI 至合并 main。

## Codex 实施与修复（2026-11-03）

本节更新接管后的实际状态，上文是 Qoder 移交时证据，不追溯改写为 Codex 验证结论。Host 修改仍严格只有 `catalog-data.ts` 的三条已接入资产及 `CatalogEntry`，和 `App.tsx/openCatalogEntry` 的项目视图导航。无会话域、Interface、owner/profile、agentOptions、Runtime、依赖包/锁文件、边界豁免或其他 Host 改动。

- TF02：新增经营目标测算、优惠券测算、投放 ROI 测算；来源与 note 元数据对齐 ppt-report。既有卡片不展示 source/note，故 description 也说明内置、随产品更新及项目任务对话入口，未扩大 Host 组件范围。
- 身份与导入：ingest 摘要原来只含文件名、平台、模式、行数，改单元格不变；现绑定实际表头/单元格与口径。coupon stress 原来摘要只绑定情景文件路径，现绑定实际内容；bucket 补引擎身份与实际内容摘要。空行后的 Excel 物理行号保留，非法月份、缺订单/用户/商品身份、负值/非有限值及非法转化率定位拒绝。
- 数学边界：部分月份缺 UV 原来会用全月订单除部分月 UV，将零增长场主口径翻倍；现要求基线窗口每月正 UV，否则披露缺月并用人主口径。人工券候选原来会漏无券；现始终补入且不修改原输入，所有券均非法仍保留无券行并报 invalid_comparison。q_table 概率及新增篮子权重逐项校验，防止负概率/订单。敏感性由实际变更参数路径分组，多因素只作为联合情景披露。ROI 近保本稳定性改用舍入前盈亏符号，非法计划/情景参数带字段名拒绝。
- 确定性与便携：Python 3.9 原 coupon 自检 16 项失败，独立定位为 Python 求和算法差异，并非 math.exp；显式 `math.fsum` 后与原 Python 3.14 黄金逐值一致，未改黄金或放宽容差。forecast 对平台/情景对象稳定排序，计算 JSON 排序键输出；七入口兼容 `selftest` 与 `--selftest`。四个 xlsx CLI 缺 openpyxl 时给出所选 Python 环境的 requirements 安装指引，不继续硬算。
- 红线及版本：三份 skill 明确 Python 环境；coupon/roi 补数据、口径、假设变更后的旧结论过期，coupon 报告明确身份栏位，修正元/分百倍换算文案。当前四个引擎版本均递增为 `optracall-forecast-2` / `optracall-forecast-ingest-2` / `optracall-coupon-2` / `optracall-roi-2`；原黄金不变。名义金额输入整数分、概率加权期望金额允许小数分，沿用原仓/冻结黄金口径，原“金额全程整数分”简述已精确化，未把期望值取整凑通过。
- TF01/TF11：原测试只有 ROI 的 template/run/report，另两类仅跑 selftest，不能称三类全流程。现为三独立任务各自发现三 skill、只读取所选 skill、真实 SDK bash 准备输入/计算、回传实际数值与身份、write 报告并按 020/060 读回，另有无关问候任务不使用工具的合成对照。forecast 在 Node 测试中只读取冻结案例 input（不读 expected）并用标准库计算；xlsx 模板/导入验收独立于 Node CI，避免隐式依赖 runner 的 openpyxl。另以产品 HTTP 开启受管任务，实际首个 SDK 请求含三 skill 的受保护快照路径，逐一读回 SKILL 字节与源一致；该条按现有受管平台合同限 macOS，其他平台明确 SKIP。固定合成 Provider 路由不能证明真实模型自主激活率；该项继续 NOT_RUN。

### 接管后验证与证据

统一命令及失败日志根：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-intake-20261103T003606/`；运行时代码候选为 `runtime-candidate.json`（完整 SHA-256，不含仍在收尾的 OpenSpec 文档）。

| 验收 | 接管后证据与范围 |
| --- | --- |
| TF01 | 实际产品普通任务和 macOS 受管任务均在 SDK 请求中发现三 skill，受管位置为真实快照且 SKILL 字节一致；非作者另独立校验 SDK 加载器两路径及三 skill 全资源逐字节一致（加载器探针无模型请求） |
| TF02 | 隔离浏览器三条目均为已接入、项目任务入口可见、逐一点击进入项目看板；与现有 ppt-report 形态一致 |
| TF03/04/05/06/07 | 原黄金自检 + 独立反例复现/修复复验；新增 `python3 -B tests/target-forecast-cli-regressions.py` 覆盖摘要、物理行号、月份、缺身份/非法数值、部分 UV、人工无券、四类结论、概率、权重、敏感性、ROI 符号/情景、缺依赖与 canonical 顺序；coupon 自检另补真实逐篮子分支概率/预算不截断不变量 |
| TF08/10/13 | 七个脚本两种自检拼法及 Python 3.9.6/3.14.4 实测；黄金不变，实际比较容差见 spec；缺依赖 `-S` 环境 exit1 并给指引；未安装新全局包 |
| TF09 | 非作者复核激活分工、红线、资源路径；所有新增文字与脚本实际合同一致 |
| TF11 | `node --test tests/protected-skills.test.ts tests/target-forecast-skills.test.ts`：最终 9/9 PASS（含 TF01 受管发现）；三类真实 SDK 合成任务与无关任务对照，真实模型未运行 |
| TF12 | 隔离浏览器 Case 产物可用、决策板展开实际报告路径/引文，两处真实下载并核对与原文件 SHA-256 相同；复用原合同，未新增预览或持久字段 |
| TF14 | 完整 `npm run check` 首轮 903 项＝900 PASS / 3 条件 SKIP / 0 FAIL，边界/tsc/构建通过；首轮期间仍有修正，另对冻结运行时候选运行最终全量，最终状态见下方收尾记录 |

TF02/TF12 浏览器根：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-qa-20261103-004531/`。`catalog-three-skills-visible.png`、`case-artifact.png`、`board-reference.png` 与 AX 文本保留；Case/Board 下载文件及原回读均为 5370 字节，SHA-256 `989eb23e16fe3582d1a6f29c75b02b5618c2f9563f8e7191395071262c88a282`。这份固定 QA 报告在修复前由脚本以 ROI 引擎 1 生成，只用于文件引用合同，不代替版本 2 数学验收；版本 2 任务证据由 TF11 提供。Provider 仅 seed 决策板抽取发生 1 次合成请求，目录/项目/Case/Board 查看与下载后仍为 1，无真实模型调用。

失败证据保留：原 manifest 29/30、Python 3.9 coupon 16 项失败、各独立边界反例与对应 RED 均保留。回归编写中变体 fixture 类型和可选列选择错误、首次脚本文本替换的语法错误、预算断言名称错误已纠正并留日志，这些属于验证/编辑失败，不冒充产品 RED。独立隔离 archive 全量检查的 stamp-build 因无 `.git` 失败亦为验证环境限制，未伪造 Git 元数据；真实工作树的最终完整检查另列。现有 Vite 大 bundle 警告及 npm 安装 2 项 moderate 审计提示保留，未擅改依赖。

独立复核以禁用 site-packages 的 Python 路径实证原 Node TF11 隐式依赖 openpyxl 的失败，日志 `stdlib-tf11-target.log` 保留于规格复核根；上述标准库输入路径负责关闭该环境缺口，未把故障隐去或向 CI 添加分析包。所有 Python 自检与 `tests/target-forecast-cli-regressions.py` 继续在声明的 Python+openpyxl 环境独立运行，不纳入 Node CI。

### 交付边界

已授权的本地实现、验证与非作者复核持续完成；Git/CI 尚未开始：未集成最新 main、未提交推送新候选、未建 PR、未调用 hosted CI、未合并或归档。须按本次用户指令另获 Git/CI 授权，实际 PR head CI 成功后再请用户确认 squash。真实模型、原仓退役/JuanerAI 文档处置、优惠券复盘脚本化、pandas 环境与设备采用均未随本任务执行。


### 本地工程准备收尾

- 冻结运行时/测试/规格后的最终 `npm run check`：**exit 0，904 项＝901 PASS / 3 条件 SKIP / 0 FAIL**，含 agent-session 边界、全部 Node 测试、tsc、Vite 构建；`npm-check-final-v2.log` 保留完整日志。既有大 bundle 警告保留。此前各轮全量不替代本次冻结树检查。
- `final-python-validation.json`：Python 3.9.6 / 3.14.4 各七项 `--selftest`，共14/14通过；新增 CLI 边界回归各16项通过。`tf-sdk-managed.log`：9/9 Node目标测试通过，无SKIP；受管发现实际在本机macOS执行。独立标准库路径探针关闭了Node目标流隐式openpyxl依赖。
- 两名干净上下文非作者复核者分别覆盖规格/数学与规范/架构，先独立导出预期、源只读、隔离产物；所有发现经根修复并由原复核者复验关闭。完整报告见 [independent-review.md](independent-review.md)。工程规范§4职责边界与复用专项：**本次变更及受影响接缝通过，无需例外**，不外推既有全仓合规。
- 复核身份：`takeover-candidate-final.json` 的34文件 SHA-256清单经两名复核者各自核得34/34一致，清单SHA-256 `f43e1f2aa993c5a73c625ca7e7505e436fb6fa53c38862b7e5e2857ba1cbe0e1`。该清单固定后只追加本结果终态和独立报告，运行时/测试/规格不再变动；Git交付前另核当前完整清单。
- 隔离QA服务和浏览器标签已关闭，合成数据、报告、原始失败及下载字节证据保留；用户现有服务未切换。浏览器实际下载到默认 Downloads 后复制入QA根，详见 `browser-validation.md`，未虚称预先设置隔离下载目录。
- 当前仅本地工程准备完成，分支工作树保留未提交修复；后续按上方边界申请 Git/CI 授权。TF01–TF14的适用本地工程验收均有证据；真实模型激活/专业报告质量、用户产品验收、CI、合并、归档与运行采用分别保持未完成，不能由本节PASS替代。


## 已授权 Git/CI 交付阶段

2026-11-03 用户明确回复“授权，且完成后直接合并”，授权本变更集成最新 main、提交推送、单一PR、实际head CI成功后直接squash合并、本地main安全快进与规格/结果原位归档，不再另设合并确认。上述“Git/CI待授权”为此前阶段快照，真实模型/原仓退役/设备采用等后续边界仍不扩大。

交付前重新核对35文件完整清单 `delivery-preauthorization-manifest.json`：35/35 SHA-256一致；原候选清单/移交包保持原字节，工作树只有本次已复核修复。fetch后最新origin/main为`484995d908087449e64e9c352b9d5e33d8358afd`，相对基线`636ac3a`仅4份simlab OpenSpec文档，无运行时/测试/依赖/构建变化。单PR尚未建立，以下实际交付回读逐项追加，不预填CI或合并成功。

修复提交 `825c8ef` 后，以 merge 提交 `947cc7afafe41662d543a3a1e3f77a6bd414de6f` 集成上述最新 main，无冲突；相对修复候选仍仅这4份上游文档，原复核清单的30份运行时/测试/产品讨论稿 SHA-256 完全未变。按闭合影响映射重验边界、9项目标Node（含本机受管实际发现）、tsc、16项Python回归，四命令均 exit0；回执 `target-forecast-git-ci-20261103/integration-checks.json` 与各日志保留。此前冻结代码完整检查904项通过仍对应完全相同的运行时/测试；托管CI将另核实际推送head并运行全量，不用本地目标重验替代。


非作者随后对947cc7a集成增量作只读复核：4份上游文档变化与30/30运行时身份确认，工程规范§4专项仍通过，无新增发现；原报告已追加至 independent-review.md。归档采用已核本仓惯例：合并后更新当前 spec/result 事实，在原变更目录稳定保留全部历史与证据，不迁移或改写原材料。

## 合并交付与原位归档

2026-11-03 依用户“授权，且完成后直接合并”完成下列实际操作；前述待授权、待合并或复核落稿时等待全量终态的文字保留其历史阶段，不作为当前状态。

| 对象 | 实际回读身份与结果 |
| --- | --- |
| 唯一功能 PR | [PR #26](https://github.com/gadfly-hbo/OptraCall/pull/26)，`qoder/target-forecast` → `main`，已 squash 合并；无第二个功能 PR |
| 实际 PR head CI | `7f772de581de0d0d19c5631b3b2ab0c39345d557`；[Check #70](https://github.com/gadfly-hbo/OptraCall/actions/runs/41538819893)，attempt 1，completed/success；checkout 明确使用 PR head SHA，锁文件安装、全量检查和 high 级依赖审计各步骤成功；Ubuntu 904 项＝844 PASS / 60 条件 SKIP / 0 FAIL |
| squash 提交 | `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`；唯一父提交 `484995d908087449e64e9c352b9d5e33d8358afd`，GitHub `merged_at=2026-11-02T22:42:51Z`；使用 expected_head_sha 防止误合并已移动候选 |
| 完整树核对 | PR head 与 squash 提交树均为 `123f1703b0f9d08e3d79617e00b91903242ec97b`，`git diff --exit-code` 确认完全相同，不只比较标题或部分文件 |
| 合并 main CI | [Check #71](https://github.com/gadfly-hbo/OptraCall/actions/runs/41539571198)，head `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`，attempt 1，completed/success；锁文件安装、全量检查与 high 级审计各步骤通过，Ubuntu 904 项＝844 PASS / 60 条件 SKIP / 0 FAIL |
| 本地 main | 主仓 `/Users/bendandebaba/DevWorkSpace/OptraCall` 在确认分支为 main、工作树干净及源/目标身份后，以 `git merge --ff-only origin/main` 从 `484995d` 快进至 `0f8ee5b`；回读与 origin/main 一致且干净 |

本次 spec/result 归档在独立工作树 `codex/target-forecast-archive` 实施，保持全部变更目录稳定原路径；原候选清单、移交包、历史 FAIL/UNKNOWN、输入及验证环境失败不重写。仅文档收尾不改产品源码、测试、黄金或已复核规格合同；当前收尾提交自身身份、发布、成功 CI 与最终 main 快进另以实际 Git/Actions 和本地回执核对，不提前填写未来成功。

公开锚点为 PR 与实际 head CI；原始 API 回读、job 日志、树身份、集成及快进证据保留于 `/Users/bendandebaba/OptraCall-artifacts/target-forecast-git-ci-20261103/`，原始本地及独立复核证据根不变。没有新建 PR 来单独交付归档。

剩余范围继续独立保留：真实模型自主选 skill、多轮调参与专业报告质量及用户产品验收 NOT_RUN；原仓退役/JuanerAI 文档处置、优惠券复盘脚本化、pandas 环境与设备采用未执行，仍须各自另获授权。macOS 本地 3 条件 SKIP、Linux CI 60 条件 SKIP、既有 bundle 警告与 moderate 依赖提示均保留，不将合并或归档当作这些边界已验收。

## 真实模型实跑与 MacBook 更新后续阶段

2026-11-03 用户另行授权真实模型实跑，完成后更新MacBook。原工程归档中的 NOT_RUN 保留其当时范围，本阶段结果见 [live-validation.md](live-validation.md) 与 [非作者原报告](live-independent-review.md)：当前MiniMax M3.1 Flash经真实Host/SDK完成三类普通任务及无关对照；三案各一次明确反馈修订，全部7个请求completed，固定核心计算/身份/原件保全限定通过，首稿专业均FAIL，修订后目标/ROI仍FAIL、券PARTIAL，不能写整体专业或用户本人产品验收通过。

本阶段没有修改Host/会话/模型默认值/内核脚本/测试/依赖；只在首稿封存后补齐target-forecast方法说明遗漏的既有末名尾部保底。算法与版本2保持，旧oracle分类独立性受限、目录列举/事实陈述偏离、验收方错误反馈及所有失败原样保留。不重建Host财务裁判，不追加隐藏模型修订loop。

MacBook当前已完成只读预检、关键文件SHA及元数据保全准备，待上述证据发布/实际head CI后按用户授权从原试用入口更新；实际runtime与保全回读另记。Mac mini原服务未切换，隔离真实模型Host已正常关闭；原仓退役、复盘脚本和pandas提案等边界不扩大。

### 实跑证据发布与 MacBook 首次采用完成

上述待更新状态为当时记录。真实模型证据与既有方法补漏已发布main `bc23098c0e970be376cea1b178331bea6ad35164`，非作者文档范围复核、本地protected-skills 4项及引用/差异检查通过；[actual-head Check #73](https://github.com/gadfly-hbo/OptraCall/actions/runs/41567002780) attempt 1 success（904=844 PASS/60条件SKIP/0 FAIL，构建、边界与高危审计通过；2项moderate提示保留），Mini主仓已安全快进且干净。原功能仍仅PR #26，本次没有另建功能PR。

MacBook随后通过既有更新入口正常退出0，已实际运行同commit/tree、dirty=false的ready实例 `f4912109-758e-41d5-820d-9a013bd56953`；main干净且origin/main 0/0，三skill到位，根页/资源/health均200。1206关键文件及3符号链接零变化，配置/凭据/数据库/ppt-venv保留；正常锁、日志和7目录metadata变化单列，项目根仍空，无peer模型调用。首次实例身份、CI及保全详见 [live-validation.md](live-validation.md#证据发布与-macbook-首次实际采用)；后续收据文档提交仍经CI并从原入口追齐，最终实际身份保存在同一外部delivery证据目录。

本授权的真实实跑与设备更新已执行；三首稿FAIL、修订后目标/ROI FAIL、券PARTIAL原样保留，不把完成调用、合并、安装或正常启动写成专业全通过或用户本人产品接受。Mini原服务未切换，原仓退役、复盘脚本化及pandas等后续边界未执行。

# data-analysis 运营数据分析 skill · 实施与验证记录

日期：2026-11-05（作者阶段）／2026-11-06（Codex 接管）· 分支：`qoder/ext-skills`（基线 `33c95c5`）· 状态：用户测评及初始本地检查通过；用户已授权 Git/CI 并在 CI 通过后直接合并归档，最新 main 已集成，新增发现修后复验中。历史失败及一次验证目录偏差保留。下文 Qoder 验证证据保留其移交时范围，Codex 增量见末节。

## 用户测评回执（2026-11-06，显式通过）

按工程规范 §5 skill 测评门禁，用户以自有流程测评（run `run-20261105-142602-e4d3863f`，被评 MiniMax-M3.1-Flash / 评委 mimo-v2.6-flash / 5 用例×3 重复；被测内容 hash `63adebba`＝送测 `6df72f4` 字节，评估归档版本 1.9.0），结论：**有效（但昂贵）· effective · provisional，测评通过**。

| 指标 | baseline | variant | 判读 |
| --- | --- | --- | --- |
| 激活率 | — | 100.0%（15/15） | 触发充分 |
| 胜率 | — | 78.6%（11胜/3平/0负/1未判；CI 下界 52.4%） | 有实质提升（点估计噪声大） |
| 断言通过率（条目累计） | 26.8%（38/142） | 87.4%（139/159）＝ **+60.7pp**（CI [+50.8, +68.5]） | 显著改善，超 10pp 门槛 |
| 整轮全过率 | 0.0% | 26.7% | 从无到有 |
| 平均耗时 | 25.2s | 109.7s（4.3x） | 变慢 |
| 平均 token | 7,048 | 282,738（40.1x） | **昂贵** |

稳定性与如实保留：两轮独立复评增益 +62.9/+60.7pp（差 2.2pp，稳定）；verdict 翻转归因为评委噪声与采样噪声（skill 未改一字节），新双档门槛下两轮均 effective；provisional 因 1/30 次运行失败（baseline 超时，已计入分母）；门禁复跑 run2 skill 侧 10/15（run1 14/15），门禁与评委方向相反，两者各报各的量；套件无负向用例，误触发率本轮不可测。完整报告见用户侧 `runs/run-20261105-142602-e4d3863f/REPORT.md` 与归档 `archive/data-analysis/1.9.0/`。

**可选加固项（不随本轮修改，如实记录）**：skill 侧 12 条断言定义失败（9 约束不稳 + 2 契约无效）＋1 条套件断言过严；按单向流程本轮不改 skill；如后续加固（预计合计 +5.2pp 级），须保持同套件（`7e7ff00a`）同模型复评并递增版本归档，另立增量。本回执不替代第4节非作者独立复核与工程检查。

## 承接方式（B 重写式承接，用户裁定 2026-11-05）

对 WorkBuddy 市场第三方技能 data-analysis v1.8.0（天箭星科技）无再分发授权，本仓公开，故**未复制其任何文本、代码、数据或文件**；本 skill 为独立设计与实现，仅对齐能力品类（六段式分析报告、复算脚本、数据体检门禁）。研究副本仅存本机 gitignored `.local/`，永不入仓；MacBook 原件未动。方法论概念（六段契约、四类陷阱、复算纪律）属通用方法；全部表达、代码、示例数据、阈值与判据为本次自研。

## 实施范围（实际交付物）

```
extensions/analysis-assets/data-analysis/
├── SKILL.md                  # 激活描述（与四个既有 skill 分工切分）+ 形态分级 + 六段契约 + 红线8条 + 四类陷阱 + 双脚本纪律 + 020/060/010 边界
├── scripts/calc.py           # 验数字：decompose(乘法顺序剥离/加法)、compare(同环比+按天对齐)、outlier(3σ≥30/IQR-Tukey)、weighted、period、trend(斜率+R²)；Decimal、回显算式、退出码 0/2/3、--selftest 21项
├── scripts/quality_check.py  # 验格式与数据：--report(F1六段/F2要素/R1-R5红线/直答分流)、--data(DA1-DA5体检)、--self-test 17项对抗
└── references/
    ├── method.md             # 公式选型、顺序剥离数学、陷阱检测动作、图表选型
    ├── sample-data.md        # 自有合成 6店×2月数据 + 脏数据对照集 + 复算步骤（全部实跑数字）
    └── examples.md           # 完整六段样例报告（自身通过 --report 门禁）
```

另：`tests/protected-skills.test.ts` 追加 DA01（发现、无 subagent 角色、角色集不变、快照逐字节）；新建 `tests/data-analysis-skill.test.ts`（DA08 合成 Provider 端到端：读 SKILL → bash 实跑双 selftest＋decompose → 报告落 060_reports）。无 Host/Agent 代码、依赖、锁文件变化；纯标准库零第三方依赖。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `calc.py --selftest` | **21/21 PASS**：乘法/加法拆解手算案例、闭合差额 0.00、同环比、按天对齐 −3/31=−9.68%、3σ 唯一异常+z>3、小样本拒绝、IQR 唯一越界、加权 62.50 vs 75.00、期间 110.71%、趋势 R²=1 与低 R² 判读、确定性逐字节一致、口径缺失拒绝、三因子闭合 |
| `quality_check.py --self-test` | **17/17 PASS**（对抗验证）：好报告 PASS、坏报告命中 R1/R2/R3/R4、直答分流、乱序 F1、插补 R5 命中且「未做插补」不误报、clean CSV PASS、dirty CSV 命中 DA1–DA4、合计行 DA5、非法 key 拒绝 |
| 样例报告自身过门禁 | examples.md 报告段提取后 `--report` → **PASS（0 error）** |
| `node --test tests/protected-skills.test.ts tests/data-analysis-skill.test.ts` | 7/7 PASS（含 DA01、DA08 及既有 5 项） |
| DA08 合成端到端（真实 SDK 路径） | PASS：任务首请求可见 data-analysis skill；Agent 读 SKILL.md → bash 一条链实跑双 selftest＋decompose（闭合 0.00、总变动 −6300.00、效应 −12600.00/+6300.00）→ 报告（含负责人与时限）落 `060_reports`，脚本 JSON 落 `020_clean` |
| `npm run check` 全量 | exit 0：1413 项＝1383 PASS / 0 FAIL / 30 条件 SKIP + 边界 + tsc + 构建 |

## 如实保留的边界与未验证项

- **未复制第三方内容**：与原技能的能力差异——本版无季节指数/移动平均（trend 仅斜率+R²）、无 JOIN 行数体检（连接爆炸以人工核对指引承载）、无包自校验（由本仓测试覆盖）；3σ 小样本门槛、Tukey 四分位、R²≥0.7 判读等阈值为自研设定。
- 合成路由只证明发现/读取/实跑/落盘，不证明真实模型的分析质量与激活率——归用户测评。
- 报告红线判据为文本规则（R1–R5），只能拦截可判定的违规形态，不替代人工审读。
- 30 项条件 SKIP 为既有平台/环境条件跳过，非本变更引入。

## 下一步

skill 测评门禁已通过（2026-11-06 用户显式确认，回执见上节）。移交 Codex：核对候选清单 → 实施目录接缝（catalog-data 一条目＋测评卡绑定 1.9.0，文案建议见 handoff）→ 浏览器点验 → 非作者独立复核（覆盖 DA1–DA9 与 DA01–DA10）→ 按用户授权走 Git/CI 至合并。任务书：[handoff/codex-takeover-brief.md](handoff/codex-takeover-brief.md)。移交后本分支本轮停写。

## Codex 接管记录（2026-11-06）

### 身份与写入归属

fetch 后核对 `origin/qoder/ext-skills=f9005f723cb700e8ec232b1a1df6d5fa45e22a2c`。原清单 **12/12** 文件在提交与 Qoder 原树中均逐项匹配完整 SHA-256；原树干净，在同一提交转为游离以释放检出权。Codex 独立工作树 `data-analysis-delivery/OptraCall` 再次核对 12/12 后开始写入。其中六份 skill、两份 Qoder 测试及原规格与 `6df72f4` 字节一致。原清单不回写；本轮唯一写入者为 Codex，待合并归档后归还长期分支。

本地证据根为本工作树 gitignored `.local/data-analysis-delivery/`；`intake.json` 保存原始身份及完整哈希。主仓及其他分支已有 WIP 保留，不纳入本轮。以下工程修正属于本任务书明确允许的“非作者发现→根修复→原复核者重验”，未开展用户回执中另立增量的 12 条评估断言定义加固。

### 接缝与测评展示

- `catalog-data.ts` 增加“运营数据分析”已接入条目与 `dataAnalysisEvaluation`，`App.tsx` 入口沿既有 skill 导航至项目看板。复用共享折叠组件，默认收起，没有新增页面、会话接入、持久结构、SDK 或依赖。
- 共享测评类型仅增加可选的暂定结论、限制说明与工程修正覆盖标记；[展示规范 v1.1](../../../docs/skill-evaluation-display.md)同步记载用户已确认的单向流程。原被测身份仍为 `6df72f4`／归档 `1.9.0`／hash `63adebba`，没有宣称最终字节重跑用户测评。按本轮直接指定，原测评通过结论覆盖工程修正后的交付版，不新增用户复测事项。
- 断言增益使用原始 `38/142`、`139/159`，显示 **26.8%→87.4%、+60.7 个百分点**；激活 15/15，胜率 11/14 及 1 未判单列；保留耗时 25.2s→109.7s、Token 7,048→282,738 和昂贵代价。effective 与 provisional 同时呈现，说明 baseline 1/30 超时计入分母、模型、增益区间和未测误触发。不为回执未给出的区间补造 95% 置信水平。

### 非作者发现及修正

原复核者分别从规格推导预期后再读实现与作者证据；归集见 [独立复核](independent-review.md)。原报告与失败现场保留。

| 发现 | Codex 修正与边界 |
| --- | --- |
| 小数效应过早舍入导致假闭合失败，算式与实际输入不符 | 未舍入 Decimal 效应用于闭合、占比及汇总；输入、效应和算式保留必要精度，展示百分比最后舍入，不事后配平 |
| 非有限数、分数天数／样本数、常量 3σ 崩溃或阈值绕过 | 输入有界拒绝且退出码 2；天数／样本数为正整数；3σ 不低于 30；常量序列无异常；趋势 R² 下限不可放宽到 0.7 以下；IQR 输出真实边界偏离量 |
| 行动散文绕过责任人／时限，非因果“相关”未要求保留意见 | 对普通行动段及相关结论执行现有红线，不增加通用自然语言推断器 |
| 局部期间已对齐仍误拒，修后又把行动跟踪指标名“环比”当比较 | 按局部比较识别已完成的对齐；限定无数字、无比较断言的跟踪指标名豁免，行动中的真实未对齐比较仍拒绝 |
| 激活末句过宽、JOIN 核查不必要转交人工、DA4 能力表述过度 | 限定本 skill 问题域；Agent 自主使用既有 Python/bash 查材料，只有缺材料／定义才向用户索取；DA4 仅检测率值区间／单位疑点，不能识别业务分母定义变化 |
| 方法／样例少量说明与脚本不符 | 交叉项由后剥离因子承担；加盟 A 客单价持平；日数比例 110.71% 与增长 10.71% 区分；笔数效应与客流线索区分，不将相关直接称因果 |
| 回执未给置信水平、舍入率相减会得到 60.6pp | 删除额外的 95% 声明，增益由原始计数计算 |

新增永久黑盒回归 `data-analysis-calculation.test.ts` 与 `data-analysis-quality.test.ts`；Qoder 原两份测试没有修改。数值回归首跑 12 项为 11 FAIL／1 已通过，修后 12/12；格式各问题有各自先 RED 后 GREEN，最终新增格式回归 5/5，原 selftest 仍为 21/21、17/17。作者原始开发前 RED 的历史证据不足，保持 **NOT_PROVED**，不能用此次补测补造历史 TDD。

### 正式浏览器点验

独立合成根启动实际 Host／当前构建，native Chrome 点验桌面 1920×960：条目“已接入”可见；测评默认收起；鼠标与空格键展开／再次收起；浅深色详情、原始计数、成本、暂定原因和版本可读；“打开运营数据分析”实际进入项目看板。此次未做窄屏／移动端验证，不以原型替代正式界面结果。

证据：`qa/browser/03–12` AX／PNG 与 `receipt.json`（SHA-256 `2a4fa233cd8fe148d8ad98ada580d34a4dd05107c783c7064267ec5245568e10`）。隔离 Provider 指向不可用的本机假地址，审计共 9 次 GET，**messages=0、open=0、connectionTest=0**；仅关闭本轮标签和隔离 Host，`qa/run-UzqZDG/shutdown.json` 回执 exit 0。初次原生键入 URL 丢标点进入本机 URL 搜索，环境失误记录保留，改粘贴后重新核实正确地址；不据此声称浏览器全局零网络请求。无真实模型调用、服务切换或 MacBook 操作。

### 完整检查与既有夹具时序

首次 `npm run check` 为 **1431 项／1400 PASS／1 FAIL／30 SKIP**（`full-check-v1.log`）；失败是既有修订权限测试首次 POST 验证遇到 `409 session_busy`，不是后续原件保护断言失败。已独立核查：任务持久状态 completed 可以先于会话占用释放，公共 snapshot.status 对应真实准入状态。仅将该测试夹具等待条件收紧为 `completed && snapshot.status === 'idle'`，保留原 15 秒上限、202 断言和全部原件／字节／工具断言，没有改产品 Busy 合同、POST 重试或延长超时。目标文件 **13/13 PASS**，原失败保留；源码链支持时序窗口解释，不能仅凭复跑通过断言唯一根因已被证明。

修后 `npm run check` **exit 0：1432 项／1402 PASS／0 FAIL／30 条件 SKIP**，agent-session 边界、TypeScript、Vite 构建及版本戳全部完成。`full-check-v2.log` SHA-256 为 `f9b8da07fdc4074375af4fbbb08f5df725b4e229cbcf74a3744776040d485c05`；首轮失败日志 SHA 为 `5cf879bee3d16b6cbd51046614e92a2780afd609dedc9cbb7dd96aa675d62144`。构建保留大于 500kB 的既有包体提示，不视作测试失败；没有为了提示另拆包或扩大变更。

规格复核者在 v2 对原 R1 样例、13 组格式对抗及 6 组跟踪指标正反例复验通过，原 selftest 17/17；规范复核者再次独立跑原夹具 **13/13** 与 DA01／DA08 **7/7**。两位均核对正式浏览器证据；这些是证据审阅，不冒称他们另做一次浏览器操作。新增脚本回归及 DA01／DA08 也进入本次全量实际运行。最终文档差额与候选身份核验另见独立复核报告。

| 验收 | 当前可支持的结论 |
| --- | --- |
| DA01 | 原 SDK 发现及受管快照测试通过，角色／资源字节合同保持 |
| DA02–DA05 | 原 calc 自检 21/21，独立数值／样例及修复回归通过；Decimal 精度、输入拒绝、异常偏离量和期间对齐按修后合同核实 |
| DA06 | 原 quality 自检 17/17，独立 13＋6 组对抗及永久回归通过；有限文本规则边界保留 |
| DA07 | 原非作者确认激活分工、红线／输入／目录约定及自主检查，不保证所有自然语言输入均正确 |
| DA08 | 合成 Provider 经真实既有 SDK／bash 路径通过，不替代用户真实模型质量测评 |
| DA09 | Codex 修后完整检查通过；Qoder 原“无 Host 改动”只描述其切片，最终包含授权目录接缝；依赖、锁文件与会话实现未改 |
| DA10 | 正式目录、默认收起测评与项目导航已实现，桌面浏览器点验通过 |

Git/CI 尚未申请／执行，本变更尚未合并或归档；最终集成最新 main 后只按实际受影响范围重验，不能将此处旧基线全量结果称为未来集成候选已测。

### 保留的限制

- B 模式仅做有限工程抽查：六份候选与 14 份私有研究文件共 84 对，未发现整文件或实质计算／检查函数复制；普通命令／声明／表格片段相同。此结论不证明全球零复制、创作过程或法律授权；第三方原件未复制到公开材料。
- 门禁是有限文本规则：空行动正文、否定句含肯定子串等语义边界仍可能通过，不能保证报告完备或因果正确，不扩大为已排除的评估断言加固。JOIN 专用脚本、季节／移动平均仍未实现；当前改为 Agent 用已有工具核查，作者“人工核对”措辞不再代表最终合同。
- 独立 DA08 首次改用全空代码根时的 `runtime_start_failed` 500 是验证环境失败，保留记录；补充只读代码资源引用、所有产物留在复核隔离根后，原断言逻辑 1/1 PASS，不能将环境失败称为产品 RED。
- 规范复核者直接运行新增质量测试时，其硬编码 scratch 在作者证据区新增一个 `regression-VaHWzN/data.csv`，属于验证目录偏差。新目录原地保留，无既有文件／源码变动；后续仅路径适配在复核者根重跑 **5/5 PASS**（`quality-isolated-v2.log`）。偏差那次不作为符合约定目录的运行证据，不声称复核全程所有产物都在原定隔离根；细节见独立复核记录。
- 用户模型测评、合成工程验证、独立复核、Git/CI、产品验收与运行采用分别报告；本轮无新增真实模型实验、运行采用、MacBook 更新或第三方原仓操作。

## Git/CI 授权与最新 main 集成（2026-11-06）

用户明确授权提交、集成最新 main 重验、push 单 PR、实际 head CI 通过后直接 squash 合并、本地 main 安全快进、OpenSpec 原位归档及长期分支归还；真实模型、服务切换和 MacBook 不包含在内。前文“尚待授权”是当时状态，不再作为停止线。

先固定已复核 v3 为 `717ef26`，再合入 `origin/main=1fdfb0923d5f84fdfa89f457405f5eb6d6981391`，集成提交 `30f79a4`。App／catalog 两处冲突从精确 main 文件补入 data-analysis 类型、原测评元信息和项目导航，保留 SAP 与 model-pack 入口，不恢复 main 已移除的 A02 规划项。SDK／Runtime／会话实现、三份治理脚本及 package／lock 的 11 个关键 blob 与 main 完全一致；不带回旧 SDK 改写或降级。规格复核者在自己的隔离根再次实跑 DA08 **1/1 PASS**，原断言不变。

### 集成新发现与修复

1. **deep-research 单向裁定漏核（P2）**：本分支基线 `33c95c5` 已明确记载 2026-11-04 用户裁定 effective 覆盖 `30eda70`，此前卡片及本轮 v3 展示说明仍称待复测，存在矛盾。规范复核者独立核实七份运行资源当前与 `30eda70` 同字节；根给实际旧条目补既有覆盖字段及裁定限制说明，保留被测身份 `a78a478`、全部原指标与未重测事实。共享回归保留“未获覆盖”的合成分支，不能把所有历史回执都自动当已覆盖。私有观测先 1/1 FAIL，永久回归 6 项先 2 FAIL／4 PASS，修后永久＋观测 **7/7 PASS**。v3 当时通过及作者／复核者漏核事实均保留，不能将旧结论提前套用到最终集成候选。展示规范与工程规范 v1.8 的 §5、AGENTS 同源指针同步澄清，SDK 治理段不改。
2. **集成全量中的模型包夹具（MP04）**：`30f79a4` 完整检查为 **1645 项／1614 PASS／1 FAIL／30 SKIP，exit 1**，未执行后续构建；日志 `integrated-full-check-v4.log` SHA-256 `5fee48dad1b6a9d3cbcee163fcdecead07a14129d3dacf84be835dd4211c0149`。实际路径是 hold→stop 返回 200→立即归档遇到 `409 project_busy`，并非该测试先等了 completed。原非作者核对 stop 等底层取消、外层 lease 仍待 finish／drain 清槽；仅在 MP04 stop 后按原文件 30s／20ms 惯例等待匹配 request 的非 running 终态和公共 snapshot.idle。共享 settled 的 completed 断言、所有状态码／模型／归档断言及一次归档 POST 保持，不改生产 Busy 合同。原文件定向 **5/5 PASS**；原失败保留，源码链支持窗口解释，不只以复跑推断因果。

这些是本轮集成发现的工程合同／展示修正，不是用户排除的 12 条测评断言加固，也未改 Qoder 原两份 data-analysis 测试。新增修正后的完整检查与正式浏览器、非作者复验另列，不将原 1432 项结果冒称为最新集成通过。

### SDK 来源与依赖核对

使用 main 现有只读 `verify-official-pi.py`，核当前独立工作树安装的七个官方 Pi 1.4.0 包，对照官方 registry 元数据、归档与锁文件 SRI，累计 **2530 文件，7/7 PASS，changed/missing/extra/symlink 均 0**。回执 `integration-v4/official-pi-receipt.json` SHA-256 `fcf21f6667bda2fa3c6fbce4ce5a4613001e23a15cbdd90aff663de25e4164b4`。未安装、改写或升级 SDK，不推及运行服务和其他设备。`npm audit --audit-level=high` exit 0，保留既有 **2 moderate／0 high／0 critical**，不为本轮自动更新依赖。

### 修后集成验证现场

v5 冻结清单覆盖 971 文件（SHA-256 `ee05f6cb7c4d9e8af242bde853c9fe565d6eebf38713590ba86414ff357cf05d`），前后核对零源漂移。规范复核者确认 deep-research P2 关闭，实际 deep／DA 暂定／未获覆盖合成回执三场景独立 SSR 通过；MP04 源差额与 5/5 定向日志核实，必须修复项为 0。

正式浏览器再次运行集成构建：data-analysis 默认收起、鼠标／空格开合、浅深色指标与项目 CTA；deep-research 保留 a78a478 原指标并显示覆盖 30eda70；现有 SAP／模型包入口实际导航正常。`qa/browser-integrated-v5/receipt.json` SHA-256 `72881ecc3d4f124d1d7de142622055b5f83c431b1cc18079259398dc72196545`，19 份 AX／PNG 及四份 UI 源哈希经非作者独立核验。13 次 GET，messages/open/connectionTest 均 0，隔离 Host／本轮标签正常关闭；只测桌面，窄屏仍 NOT_RUN。

**默认 `npm run check` v5 仍 exit 1**：1645 项／1613 PASS／1 FAIL／1 CANCELLED／30 SKIP。MP04 已通过；既有 `protected-file-process.test.ts:161` 是覆盖十次 worker 启停的用例达到总 20s 上限，日志不足以定位停在哪一次，不能称全部协议断言失败。另 `sdk-connection.test.ts:38` 的 200ms 连接超时用例收到 504、health 200，但 Provider 完整请求计数为 0（原断言要求 1）；计数在读完 body 后记录，0 不证明未尝试联网。Host 创建不计入这 200ms，首次 prompt 派发与完整请求记录可能同该窗口竞争。原日志 `integrated-full-check-v5.log` 保留。相同源两文件原样隔离运行 **10/10 PASS，0 skip/cancelled**，对应 worker 用例 3.70s、连接超时用例 0.85s；这支持负载／时序条件敏感，但不单凭绿色重跑断言唯一根因已证实。

不修改测试 deadline、断言、SDK 或 CI 定义。后续本地完整验证仅把测试文件调度显式限制为并发 2，顺序执行原三阶段 `npm run check:agent-sessions` → `node --test --test-concurrency=2 tests/*.test.ts` → `npm run build`，逐步成功才继续。此条件不同于默认 `npm run check`，不能混称默认已通过。Node 不允许该参数放入 NODE_OPTIONS（命令探测 exit 9），因此使用明确 CLI 参数，不改全局配置。最终实际 PR head CI 仍按未改的原工作流运行默认完整命令，成功后才允许合并。

证据将保存在仓外 `/Users/bendandebaba/OptraCall-artifacts/data-analysis-handoff-20261106-gph2yz9a/`，待全部交付结束复制冻结材料、保留符号链接本身并逐项哈希读回；公开锚点以实际 PR／Actions 为准，不宣称私有原始日志已入公开仓。

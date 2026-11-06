# data-analysis 运营数据分析 skill · 实施与验证记录

日期：2026-11-05 · 分支：`qoder/ext-skills`（基线 `33c95c5`）· 状态：用户测评已通过（见下节），待写 Codex 接缝任务书转交。下文 Qoder 验证证据保留其移交时范围。

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

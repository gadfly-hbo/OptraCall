# target-forecast 三测算 skill · 实施与验证记录

日期：2026-11-03 · 分支：`qoder/target-forecast` · 状态：Qoder 侧开发与本地验证完成，待整体移交 Codex（目录登记接缝、非作者独立复核、Git/CI 至合并）；尚未推送

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

## 验收映射（TF01–TF14 当前状态）

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

# target-forecast 三测算 skill · 整体移交包（Qoder → Codex）

日期：2026-11-03 · 分支：`qoder/target-forecast`（**尚未提交/推送**——交接提交由 Qoder 获授权后创建，或按用户指示由移交时点处理）· 移交性质：**分支所有权整体移交，Codex 全程负责至合并 main，不再转回 Qoder**

## 移交声明

- Qoder 已完成 skill 侧全部开发（三 skill 本体 + 黄金案例 + 测试 + 文档），候选以工作区变更形态存在，待固定为单一交接提交并推送 origin；移交后 Qoder 对本分支只读、不再写入。
- 后续一切工作由 Codex 完成：唯一 Host 接缝实施（目录登记）、受影响检查、非作者独立复核、Git/CI 交付、合并与收尾；向用户申请 Git/CI 等授权的主体转为 Codex。
- 单一写入者原则：移交后只有 Codex 在该分支提交。

## 候选与证据索引

- 候选身份：[candidate-manifest.txt](candidate-manifest.txt)（30 个文件 + 本包与清单，SHA-256 前 16 位）。
- 需求与验收：[spec.md](spec.md)（TF01–TF14、R1–R10、IN01"无接入变更"）；产品方向：[讨论稿 v0.2](../../../docs/TargetForecast能力承接产品讨论稿_v0.2.md)（D1–D5）。
- 实施与验证：[result.md](result.md)（验证证据表、验收映射、黄金案例来源与容差口径、如实缺口）。
- Qoder 侧检查结论：7 项 `--selftest` 全绿；`tests/protected-skills.test.ts`+`tests/target-forecast-skills.test.ts` 5/5；`npm run check` exit 0（900 项：897 PASS/3 条件 SKIP/0 FAIL，边界检查未改脚本，构建通过）。
- 如实保留的缺口（Codex 无需重复报告，但需判断记录是否准确）：TF02 目录登记未实施（归 Codex）；TF12 浏览器级 Case/决策板引用走查未做（复用既有合同）；真实模型端到端未做；forecast 黄金为 1e-9 容差对照（roi/coupon 逐值一致）；原仓退役另授权。

## Codex 任务序列

### 1. 固定与核对候选

1. `git fetch origin`，核对基线（应为 `origin/main` = `636ac3a` 附近，以实际 fetch 为准）；确认工作区变更与 candidate-manifest 一致（逐项哈希）。
2. 按工程规范第 5 节在有效授权内创建单一交接提交并推送（若 Qoder 移交时已完成则跳过）。

### 2. 实施唯一 Host 接缝（TF02）

范围：`src/host/ui/catalog-data.ts`（"分析资产"新增 3 条"已接入"条目 + `CatalogEntry` 类型扩展）与 `src/host/ui/App.tsx`（`openCatalogEntry` 对三新条目导航到项目视图，行为对齐 ppt-report 条目先例 App.tsx:210）。文案建议（可润色，语义保持）：

| 字段 | target-forecast | coupon-forecast | roi-forecast |
| --- | --- | --- | --- |
| name | 经营目标测算 | 优惠券测算 | 投放 ROI 测算 |
| description | 人/货/场三视角 GMV 目标测算：数据三级校验、口径先行、多情景一次计算与交叉校验，确定性脚本随产品内置。 | 满减券四子模型情景测算：无券基线始终参与、回本所需转化提升、约束过滤与压力检验，确定性脚本随产品内置。 | 多投放计划盈亏链路测算：保本转化率、情景敏感度、净贡献排名与跨档稳定性，确定性脚本随产品内置。 |
| tags | 目标测算, 人货场 | 优惠券, 营销测算 | 投放 ROI, 盈亏测算 |
| note（要点） | 无需安装：随产品分发。使用入口＝项目任务对话中直接提出目标测算问题，Agent 激活 skill 用脚本测算，报告落 060_reports。 | 同左（发券决策类问题） | 同左（投放盈亏类问题） |

- 无其他 Host 改动；`npm run check`（含边界检查）复跑通过；浏览器点验三条目形态与点击导航（对齐 ppt-report 条目交互）。

### 3. 非作者独立复核（干净上下文子 Agent）

用下方任务书起新子 agent；发现项由 Codex 修复、复跑并请复核者重验受影响范围；报告追加至本目录（如 `independent-review.md`）。

> 你是一名独立复核 Agent，未参与本候选任何部分的创作，也不带作者的会话历史。请按以下任务书独立工作，不要采信任何"实现已没问题"的预设。
>
> **复核对象**：OptraCall 仓库 `qoder/target-forecast` 分支的"三测算 skill"候选（`openspec/changes/target-forecast-skills/candidate-manifest.txt` 固定身份与哈希；若 Codex 已实施目录登记接缝，该增量一并纳入）。
>
> **必须遵守**：
> 1. 源文件、测试、规格、既有证据只读；验证所需临时文件/缓存/报告只写入你自行创建的隔离目录（如 mktemp），不改工作区。
> 2. 先从验收导出预期：通读 `openspec/changes/target-forecast-skills/spec.md`（TF01–TF14、R1–R10）与 `docs/TargetForecast能力承接产品讨论稿_v0.2.md`（D1–D5），自行写出关键可观察预期清单，再核对实现与测试；不照 result.md 结论复述。
> 3. 独立检查关键路径与失败路径：三 `--selftest` 是否真证明等价性与确定性（黄金期望从哪来、容差口径是否如实）；SKILL.md 红线是否覆盖 R4–R7（含"无执行环境声明不适用"）；导入三级质量 blocker/confirmable/quality 语义；coupon 不变量（分支合计=1、拆解对平、整数分、预算过滤不截断）；roi 保本与稳定性判据；forecast 三视角/主口径/交叉校验/全渠道汇总口径；激活描述分工是否互不重叠。
> 4. 可运行的验证：隔离环境执行 7 项 `--selftest`；`node --test tests/protected-skills.test.ts tests/target-forecast-skills.test.ts`；`npm run check`；抽查同输入两次运行输出逐字节一致；用 `template.py` 生成模板→手工改坏一格→确认 blocker 定位行号正确。
> 5. 黄金案例来源核查（可选深检）：`.local/target-forecast-ref/` 有原仓源码（gitignore 不入提交，仅本机），可在隔离目录用原实现重算期望值对照 `scripts/golden/*.json`；亦可经 ssh macbook 复核。原仓业务基线 `df5acd6`。
> 6. 如实记录检查范围、实际命令与退出结果、发现（严重度/位置/理由）、未验证项及原因。
>
> **产出**：复核报告（预期清单 → 逐项 PASS/FAIL/待验证+证据位置 → 发现与处置建议 → 总结论），写入你的隔离目录并回报路径与摘要。作者/Codex 修复后需对受影响范围重验。

### 4. Git/CI 交付（先向用户申请授权）

集成最新 main 并重验受影响部分 → push → 单 PR → 实际 head CI → 用户确认后 squash 合并 → 本地 main 安全快进 → 更新规格/结果、归档。

### 5. 后续边界（各自另行授权）

原仓退役（含 JuanerAI 对接文档处置）、真实模型端到端试跑、优惠券复盘脚本化、pandas 分析环境提案、设备采用。

## 本变更特殊性提示（供 Codex 与复核者）

- **零会话接入**：无 Interface/域/owner/agentOptions/边界清单变化；skill 经既有 `additionalSkillPaths` 生效，`tests/protected-skills.test.ts` 已在豁免清单内追加断言，边界脚本未改动——复核时确认这一事实（TF13/TF14）。
- **黄金案例的等价性口径**：roi/coupon 逐值一致（黄金在本机由原仓代码再生成）；forecast/ingest 容差 1e-9（去 pandas 求和次序），blocker 消息逐字一致——这是如实口径，不是缺陷，复核按此标准判断 R10。
- 合成 Provider 任务实测（TF11）验证的是"脚本能被任务 Agent 实际执行+产物按目录约定落盘+身份回传"，不验证真实模型的 skill 激活行为——后者属真实模型验收，勿混淆。

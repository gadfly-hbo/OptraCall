# 任务书：data-analysis skill 接管至合并（Qoder → Codex）

2026-11-06 · **skill 测评门禁已通过，本任务书正式放行转交。** 用户以自有流程测评（被评 MiniMax-M3.1-Flash / 评委 mimo-v2.6-flash / 5 用例×3），结论：**有效（但昂贵）· effective · provisional**。关键指标：激活率 100.0%（15/15）、胜率 78.6%（11胜/3平/0负/1未判）、断言增益 **+60.7pp**（26.8%→87.4%，CI [+50.8,+68.5]；两轮复评 +62.9/+60.7pp 稳定）；已知代价：耗时 4.3x（25.2s→109.7s）、token 40.1x（7,048→282,738），provisional 因 1/30 baseline 超时。被测内容 hash `63adebba`＝skill 候选提交 `6df72f4` 字节（评估归档版本 1.9.0），skill 未再修改。完整回执见 [result.md 用户测评回执](../result.md)；可选加固项（12 条断言定义失败明细）已如实记录、不随本轮修改。测评通过不替代第4节非作者独立复核。本任务书自包含，配合 [handoff/codex-catalog-seam.md](codex-catalog-seam.md) 与 [handoff/candidate-manifest.txt](candidate-manifest.txt)，按工程规范 §2 移交交付模式执行。

## 交接物与身份

- 分支：`origin/qoder/ext-skills`，skill 候选提交 **`6df72f4`**（"feat(skills): data-analysis 运营数据分析 skill（重写式承接，自研脚本与内容）"）；其后为本目录文档更新（测评回执记录与本任务书），运行时/测试/规格自 `6df72f4` 未变动。
- 基线：`33c95c5`（= main `0e6c575` 归档 + 单向流程裁定等文档提交）。
- **B 重写式承接（用户裁定 2026-11-05）**：对 WorkBuddy 第三方 skill 无再分发授权，本 skill 为独立实现，零复制第三方文本/代码/数据；研究副本仅在 Qoder 本机 gitignored `.local/`，未入仓。复核时须抽查零复制声明。
- 候选文件与 SHA-256 见 [candidate-manifest.txt](candidate-manifest.txt)：skill 本体 6 个（SKILL.md、scripts/calc.py、scripts/quality_check.py、references/×3，纯标准库零依赖）+ tests 2 个（新建 data-analysis-skill.test.ts＝DA08 合成端到端、protected-skills.test.ts 追加 DA01）+ OpenSpec（spec、result（含测评回执）、catalog 接缝任务书、本任务书）。无 Host/Agent 代码、无边界脚本、无依赖/锁文件变化。
- Qoder 侧验证已完成：`calc.py --selftest` 21/21、`quality_check.py --self-test` 17/17（含对抗验证）、样例报告自身过 `--report` 门禁、目标测试 7/7、`npm run check` exit 0＝1413 项（1383 PASS / 0 FAIL / 30 条件 SKIP）。证据与边界见 [result.md](../result.md)。

## 需 Codex 完成

1. **核对候选**：fetch 后在自己的独立工作树检出 `qoder/ext-skills`，逐项核对清单 SHA-256 与提交字节一致；差异即停并向用户说明，不回写清单。
2. **实施唯一 Host 接缝**：catalog-data 新增 `data-analysis` CatalogEntry＋`dataAnalysisEvaluation` 测评卡（数据与文案建议见 [codex-catalog-seam.md](codex-catalog-seam.md)，按统一展示规范默认收起、绑定 1.9.0）＋`App.tsx` 导航。完成后浏览器点验：条目可见、测评卡收起可展开、点击进项目看板，形态对齐 deep-research。
3. **非作者独立复核**：全新干净上下文子 Agent，先从 spec.md 的 DA1–DA9 与验收 DA01–DA10 独立导出预期，再核对实现与作者测试；重点项见 codex-catalog-seam.md 复核导引（B 模式零复制抽查、双脚本 selftest 独立复跑、样例数字与脚本输出一致、激活分工不重叠）。源文件只读；发现经根修复后由原复核者复验。
4. **Git/CI 交付**（需用户另行授权时先申请）：集成最新 main 并重验受影响部分 → 集中单 PR → 实际 head CI 成功 → 获授权后 squash 合并、本地 main 安全快进 → 更新 spec/result 实际状态并原位归档（含接缝与复核证据）。

## 回执要求

给 Qoder 与用户：候选核对结果、接缝实施与浏览器点验证据、非作者复核结论（发现/修复/复验）、Git/CI 与合并回执（PR 号、head CI、main 提交号）、OpenSpec 归档位置。

## 边界

- 交接后本轮 `qoder/ext-skills` 唯一写入者为 Codex（Qoder 停写）；合并归档后分支归还 Qoder 继续下轮，长期定位不变。
- 不改 skill 本体与 Qoder 测试（问题经复核流程由 Codex 根修复并复验）；测评加固项（P1–P11 等）不在本轮，另立增量且需同套件复评。
- 不切换任何运行服务、不操作 MacBook（用户评估目录/归档由用户掌握）；真实模型验证以用户测评回执（已通过）与届时授权为准。
- 单向流程（2026-11-04 用户裁定）：移交后的工程修正不再触发用户复测，已通过结论覆盖最终合并版。

## 参考索引

- 规格：`openspec/changes/data-analysis-skill/spec.md`（含 IN01 记录：无 SDK/会话/Interface 变更，不使用 subagent）
- 结果与证据（含用户测评回执）：`openspec/changes/data-analysis-skill/result.md`
- 先例：`openspec/changes/deep-research-skill/result.md`（移交-接管-合并全流程与测评卡先例）

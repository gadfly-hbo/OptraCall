# 任务书：deep-research skill 接管至合并（Qoder → Codex）

2026-11-04 · **skill 测评门禁已通过，本任务书正式放行转交。** 用户以自有流程测评（variant=装 skill vs baseline=不装），结论：有效（effective）。关键指标：激活率 80.0%（8/10）、胜率 75.0%（3胜/1平/0负/6未判定）、断言通过率 16.2%→29.4%（**+13.2pp，超增益门槛 10pp**；产物口径复核 +27.9pp，两口径均超门槛）；已知代价：平均耗时 278.9s→460.8s（+65%）、平均 token 1.11M→1.72M（+55%），如实保留。完整回执见 [result.md 用户测评回执](../result.md)。测评通过不替代第4节非作者独立复核。本任务书自包含，配合 [handoff/codex-catalog-seam.md](codex-catalog-seam.md) 与 [handoff/candidate-manifest.txt](candidate-manifest.txt) 使用，按工程规范 §2 移交交付模式执行。

## 交接物与身份

- 分支：`origin/qoder/ext-skills`，skill 候选提交 **`a78a478`**（"feat(skills): deep-research 深度研究 skill（gpt-researcher-team 能力承接）"）；其后为本目录文档更新（测评门禁条款、回执记录与本任务书），以交接时分支 head 为准（见 result.md 与清单哈希）。
- 基线：`32ebe84` = `8b99699`（分支角色记录，docs/engineering-workflow.md §5，先于本候选）+ origin/main `8425ca1`（含 f174ebb subagent/native-search 与回执文档）。
- 候选共 14 个文件，SHA-256 清单见 [candidate-manifest.txt](candidate-manifest.txt)：skill 本体 7 个（SKILL.md、agents/researcher.md、agents/reviewer.md、references/×4）+ tests 2 个（新建 deep-research-skill.test.ts、protected-skills.test.ts 追加 DR01）+ 边界脚本 1 个（check-agent-session-boundary.mjs 的 projectAgentOwners 追加本测试，同 subagent-runtime 先例）+ OpenSpec 4 个（spec、result（含测评回执）、catalog 接缝任务书、本任务书）。运行时/测试/规格 10 个文件自 `a78a478` 未变动。无 Host/Agent 运行时代码、无依赖/锁文件变化。
- Qoder 侧验证已完成：目标测试 7/7 PASS（DR01 发现+角色快照、DR03 合成 Provider 端到端：委派隔离、chain {previous}、子角色实读 references）；`npm run check` exit 0＝1004 项（1001 PASS / 0 FAIL / 3 条件 SKIP）+ 边界 + tsc + 构建。证据与边界见 [result.md](../result.md)。

## 需 Codex 完成

1. **核对候选**：fetch 后在自己的独立工作树检出 `qoder/ext-skills`，逐项核对 14 文件 SHA-256 与提交字节一致；差异即停并向用户说明，不回写清单。
2. **实施唯一 Host 接缝**：`src/host/ui/catalog-data.ts` 新增 `deep-research` CatalogEntry 与"已接入"条目 + `App.tsx` `openCatalogEntry` 导航到项目视图；文案建议与理由见 [codex-catalog-seam.md](codex-catalog-seam.md)（note 需如实区分有/无原生检索路线）。完成后浏览器点验：条目可见、点击进项目看板，形态对齐 ppt-report/target-forecast。
3. **非作者独立复核**：全新干净上下文子 Agent（未参与本候选任何部分、不继承作者会话），先从 [spec.md](../spec.md) 的 DR1–DR9 与验收 DR01–DR07 独立导出预期，再核对实现与作者测试；重点项见 codex-catalog-seam.md 复核导引（引用红线与 native-search 回执行为逐字一致性、角色文件合规、委派示例与工具 schema 一致、质量目标降格如实性、报告结构完整性）。源文件只读；发现经根修复后由原复核者复验。
4. **Git/CI 交付**（需用户另行授权时先申请）：集成最新 main 并重验受影响部分 → 集中单 PR → 实际 head CI 成功 → 获授权后 squash 合并、本地 main 安全快进 → 更新 spec/result 实际状态并按惯例原位归档（含目录接缝与复核证据）。

## 回执要求

给 Qoder 与用户：候选核对结果（n/14）、接缝实施与浏览器点验证据、非作者复核结论（发现/修复/复验）、Git/CI 与合并回执（PR 号、head CI、main 提交号）、OpenSpec 归档位置。

## 边界

- 本轮期间 `qoder/ext-skills` 唯一写入者为 Codex（Qoder 停写，保留 WIP 无）；本轮合并归档后分支归还 Qoder 继续下轮 skills 安装，长期定位不变。
- 不改 skill 本体与 Qoder 测试（问题经复核流程由 Codex 根修复并复验）；不动 subagent/native-search 实现（属 `codex/Host-Agent-Extension` 既有交付）。
- 不切换任何运行服务、不操作 MacBook、不新增真实模型实验；真实模型检索/报告质量验证按届时用户授权另行安排。
- 首轮期间若 main 有新提交，集成后仅重验受影响部分并如实记录，不宣称全量重跑。

## 参考索引

- 规格：[openspec/changes/deep-research-skill/spec.md](../spec.md)（含 IN01 记录：无 SDK/会话/Interface 变更，消费 f174ebb 契约）
- 结果与证据：[openspec/changes/deep-research-skill/result.md](../result.md)
- 承接依据：[openspec/changes/task-agent-capabilities/qoder-receipt.md](../../task-agent-capabilities/qoder-receipt.md)
- 先例：[openspec/changes/target-forecast-skills/result.md](../../target-forecast-skills/result.md)（移交-接管-合并全流程）

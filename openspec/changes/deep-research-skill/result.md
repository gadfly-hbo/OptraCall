# deep-research 深度研究 skill · 实施与验证记录

日期：2026-11-04 · 分支：`qoder/ext-skills`（基线 `32ebe84` = 本分支 WIP 文档 + main `8425ca1`）· 状态：用户测评已通过（见下节），待 Codex 目录接缝、非作者复核与 Git/CI 授权。下文 Qoder 验证证据保留其移交时范围。

## 用户测评回执（2026-11-04，显式通过）

按工程规范 §5 skill 测评门禁，用户以自有流程测评（variant=装入本 skill，baseline=不装），结论：**有效（effective），测评通过**。

| 指标 | baseline | variant | 判读 |
| --- | --- | --- | --- |
| 激活率 | — | 80.0%（8/10） | 触发充分 |
| 胜率 | — | 75.0%（3胜/1平/0负/6未判定） | 有实质提升 |
| 断言通过率（条目累计） | 16.2% | 29.4% | **+13.2pp，超增益门槛 10pp**（"值得归档"关键判定） |
| 平均耗时 | 278.9s | 460.8s | 变慢 65% |
| 平均 token | 1.11M | 1.72M | +55% |

产物口径复核为 +27.9pp（baseline 14.7% → variant 44.1%），两种口径均远超门槛，结论不依赖口径选择。耗时与 token 成本上升如实保留为已知代价。本回执为用户测评结论，不替代第4节非作者独立复核与工程检查。

## 实施范围（实际交付物）

```
extensions/analysis-assets/deep-research/
├── SKILL.md                       # 激活描述 + 环境判别（有无原生检索）+ 红线6条 + 方法指引 + 委派用法 + 资源索引 + 边界
├── agents/researcher.md           # 调研员：独立检索、证据/先验区分、回传格式、缺口声明
├── agents/reviewer.md             # 审稿人：6维标准、硬性退回、3轮规则、输出格式
└── references/
    ├── method.md                  # 5阶段×3模式、研究参数卡、委派模式（single/tasks/chain）与并行建议
    ├── source-standards.md        # 来源优先级、数量质量目标、时效窗口、引用格式、回执规则
    ├── review-checklist.md        # 6维审查、退回条件、轮次规则、修订原则
    └── report-structure.md        # 报告模板、引言结论写法、终检清单、020/060落盘
```

另：`tests/protected-skills.test.ts` 追加 DR01；新建 `tests/deep-research-skill.test.ts`（合成 Provider 端到端）；`scripts/check-agent-session-boundary.mjs` 的 `projectAgentOwners` 追加该测试文件（同 subagent-runtime 先例，注明 DR03 隔离真实 SDK 验证、非产品运行时 owner）；`openspec/changes/deep-research-skill/`（spec/result/移交包）。

无 Host/Agent 代码改动；无依赖与锁文件变化；无 scripts（纯提示词与方法资产）；无会话域/owner/Interface 变更。

## 承接映射（保真记录）

| 原插件（gpt-researcher-team） | 本产品形态 |
| --- | --- |
| research-chief-editor 主编（编排/参数卡/超时降级） | 任务 Agent 自身；编排自主，方法为指引非强制 |
| topic-researcher 谭溯源 | `deep-research/researcher`（委派） |
| draft-reviewer 明鉴秋 | `deep-research/reviewer`（委派，隔离上下文=独立视角） |
| research-planner / draft-reviser / report-writer / report-publisher | 父 Agent 内化（大纲/修订/汇总/组装不需隔离上下文） |
| ≥5来源等硬配额、整报≥20来源 | 承接为质量目标与自检口径（DR4），达不到如实披露差距 |
| 人设/头像/plugin.json/quickPrompts/TeamCreate/SendMessage/进度通报模板 | 不承接（市场外壳与 WorkBuddy 团队协议） |

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `node --test tests/protected-skills.test.ts tests/deep-research-skill.test.ts` | 7/7 PASS：DR01（SDK 发现 deep-research、`discoverSubagentRoles` 全仓仅产出 `deep-research/researcher` 与 `deep-research/reviewer`、受管快照逐字节保留 7 个资源文件）+ 2 项 DR03 端到端 + 既有 4 项 |
| DR03 端到端（合成 Provider，真实 analysis-assets 目录） | PASS：普通任务快照含 `subagent` 工具；父 Agent 实际委派 researcher（single）与 researcher→reviewer（chain，`{previous}` 正确传递）；子会话 fresh（单条 user、不含父对话私密标记、无递归 subagent）；子 system 指令含真实角色正文（"调研员（researcher）"/"审稿人（reviewer）"）与真实 skill 资源根；模型与凭据与父冻结一致 |
| DR03 资源可读 | PASS：被委派 researcher 以 read 工具实际读取仓库内 `references/method.md` 并把内容回传父会话 |
| 边界检查 | 首轮 FAIL（新测试构造 ProjectAgent 未在豁免清单），按 subagent-runtime 先例把 `tests/deep-research-skill.test.ts` 加入 `projectAgentOwners`（注明 DR03 隔离真实 SDK 验证）后 PASS；未放宽其他规则 |
| `npm run check` 全量 | exit 0：1004 项＝1001 PASS / 0 FAIL / 3 条件 SKIP + 边界 PASS + tsc + Vite 构建；既有大 bundle 警告保持披露 |
| DR02/DR04/DR07 文档复核 | 自检通过：SKILL.md 红线（引用真实/不冒充检索/事实观点区分）与环境判别、四份 references 路径在 DR01 快照断言中逐一验证存在且字节保留；正式非作者复核待做 |

## 如实保留的边界与未验证项

- 全部端到端为合成 Provider；真实模型的检索激活、研究报告专业质量、多章并行与审稿循环的实际表现未验证（另授权）。
- deepseek-flash 路线无原生检索：skill 指引为如实声明降级，未验证真实模型是否遵循。
- 审稿独立性是"隔离上下文"意义下的独立（同一模型），非人类专家审稿；skill 与本记录均不宣称等价。
- DR06 catalog 登记未实施（Host 接缝归 Codex，移交包已附文案建议）；能力目录暂无"深度研究"条目，不影响 skill 在任务会话中的发现与使用。
- 原插件仓库（MacBook WorkBuddy 目录）未做任何改动；处置另议。

## 下一步

skill 测评门禁已通过（2026-11-04 用户显式确认，回执见上节）。移交 Codex：核对候选清单 → 实施目录接缝（catalog-data 一条目 + `openCatalogEntry` 导航，文案建议见 handoff）→ 非作者独立复核（覆盖 DR1–DR9 与 DR01–DR07）→ 按用户授权走 Git/CI 至合并。任务书：[handoff/codex-takeover-brief.md](handoff/codex-takeover-brief.md)。

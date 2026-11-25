# 目标管理重构（总 GSA、Agent 目标拆解与发布闭环）工程交付记录

- **关联 Issue**：[#136](https://github.com/gadfly-hbo/OptraCall/issues/136)（领取回执：`issuecomment-7160835606`）
- **开发分支**：`work/antigravity/issue-136-goal-management`
- **代码基线（`origin/main`）**：`d4b60b5394f60575e58939460bf7ab8768e1df49`
- **确认规格／Demo 来源提交**：`ea59d7c44a73d21e6bad8287a3612529010bb9d6`
- **冻结输入核验（全程只读未改）**：
  - `openspec/changes/goal-management-decomposition/spec.md` SHA-256：`5ce8ffcf8c34bd19f6b968a09af37a15d850fb8d50c5407f4c8cb6f07e3c7fc4`
  - `openspec/changes/goal-management-decomposition/ui-demo-integrated.html` SHA-256：`3fcbe15f7df00fc09e6625d47edb75f2350827524f97faa36fc9eb382f1034f0`
  - `package.json` / `package-lock.json`：零修改（官方 Pi SDK `1.4.0` 原包未改动）
- **接口与会话基线**：Interface v3（`IN01–IN07`），复用唯一 `business-role-discussion` 域，未新增平行 Runtime 或生命周期表。

---

## 1. 交付范围与架构摘要（Tasks B–E）

### 后端存储、校验、路由与统一 Agent 接线
- **类型与校验引擎**：新增 `src/host/strategy-goal-decomposition-types.ts` 与 `src/host/strategy-goal-decomposition-validation.ts`，实现总 GSA 计划、拆解草稿（金额／比率／里程碑、多视角交叉冲突、明确预留、不重叠补缺策略、时间节奏计划）、只读发布预览、三态失答恢复、冻结快照检查、阈值触发（含 `%` 与 `percentage-points` 及严格相邻期连续计数）和到期复盘结论分类的确定性校验。
- **存储与原子提交（schema 4 兼容升级）**：扩展 `src/host/strategy-goals-store.ts`，支持 schema 3 → 4 兼容读写、拆解冻结快照外置文件与 SHA-256 完整性校验、分页目录预算（`limit`/`offset`）、总 GSA 计划不可变版本、单次原子提交（拆解正式版 + 明确承诺子目标 + 父子关系 + 有效指针 + 操作回执）、稳定行复用 `GoalRef` 与逐行 CAS、预提交故障注入钩子与跨重启可证明未提交（`not-committed-retryable`）状态机、以及 `disableDecomposition`（`--disable-goal-decomposition`）安全只读回退模式。
- **Host 路由、导出与权限门禁**：扩展 `src/host/strategy-goals-routes.ts`、`src/host/server.ts`、`src/host/main.ts`，接入全部 GSA／拆解／预览／发布／失答恢复／检查／Case 草稿意图／项目承接预览确认／复盘／下期草案／回送战略及冻结版 HTML 导出路由；对主目标、子目标范围、`formal-sources`、`draft-estimates` 及历史版本读取/导出/承接均在操作期执行实时权限校验（失败关闭）；统一处理 `GoalDecompositionError` 与 `StrategyGoalsError` 并透传结构化 `details`。
- **统一 Pi 会话与受限分析变体（IN01–IN07）**：扩展 `src/host/business-role-types.ts`、`src/host/strategy-discussion-host.ts`、`src/agent/strategy-discussion-prompt.ts`，在既有 `business-role-discussion` 域内新增 `goal-estimate`（绑定准确 `goal-draft` owner）与 `goal-decomposition`（绑定准确 `goal` owner）分析变体，提供受限草稿读写及固定技能脚本执行工具（`optracall-forecast-2`、`optracall-variance-check-2` 等），并在 `--disable-goal-decomposition` 下同步隐藏与拦截拆解工具。

### 前端集成工作区（确认 A 方案 + UI01–UI04）
- **导航与主工作区**：更新 `src/host/ui/ManagementTabs.tsx` 退休旧 4 个目标一级 tab（保留策略 4 tab 与公共外壳）；新建 `src/host/ui/GoalDecompositionWorkspace.tsx`、`src/host/ui/GoalAuxiliaryDialogs.tsx`，更新 `src/host/ui/StrategyGoalsPage.tsx`、`src/host/ui/strategy-goals-client.ts`、`src/host/ui/BusinessRoleConversation.tsx`、`src/host/ui/strategy-goals.css`。
- **核心路径与辅助弹窗**：实现步骤 1a（总 GSA 一次确认 + 可选确认前测算 Agent）、步骤 1b（左统一拆解 Agent + 右实时拆解表、三卡数值分离、交叉冲突人工对齐、只读发布预览、本机持久化待核发布意图与损坏锁定、三态恢复）、步骤 2（可选冻结拆解版／责任行／冻结检查点／阶段、部分缺失待补不给整体%、继续观察／安排补证／续接已有未关闭 Case／另建独立 Case 草稿意图、主动试点草稿）、步骤 3（到期复盘、下期草案假设标记、回送战略），以及 4 项按需辅助弹窗（切换目标、版本与来源含冻结快照查看与导出、关联决策、执行承接含 `ReadGoalArrangements` 与冻结检查点项目承接）。

---

## 2. GM01–GM13、UI01–UI04 与 Spec §7.3 三个原型缺口闭环核对

| 验收项 | 验证方式与结果 |
| --- | --- |
| **GM01–GM02**（战略来源门禁、总 GSA 一次确认、缺 A 阻断、仅改 A 升版、计划与授权分离） | PASS（`goal-decomposition-core.test.ts`、`goal-decomposition-full.test.ts`、Chromium E2E） |
| **GM03–GM05**（真实 Host→Pi 1.4.0→合成 Provider→`forecast.py`、三值独立、金额/比率/里程碑/预留/不重叠补缺/迟到拦截） | PASS（`goal-decomposition-core.test.ts`、`goal-decomposition-full.test.ts`） |
| **GM06–GM07**（只读预览零写、原子发布、稳定行复用 `GoalRef`、逐行 CAS、50/45 & 30/35 交叉冲突阻断与人工对齐重汇总） | PASS（`goal-decomposition-core.test.ts`、Chromium E2E） |
| **GM08**（真实丢响应、浏览器刷新与 Host 重启三态恢复：`committed` / `unknown` / `not-committed-retryable` 显式 CAS 重试与放弃、本机存储损坏锁定、目标隔离） | PASS（`goal-decomposition-core.test.ts`、`goal-decomposition-full.test.ts`、Chromium E2E） |
| **GM09 & UI01–UI04**（退休旧 4 tab、保留公共外壳、4 项按需弹窗、历史目标只读锁定、`ReadGoalArrangements` 保留、下游 Case/Task/Project/Teach 精准回归） | PASS（`v12-strategy-ui.test.ts`、Batch 2 69/69、Chromium E2E） |
| **GM10–GM11**（绑定冻结版/行/检查点、缺 2 店不给整体%不计连续、零计划安全、`%`/`percentage-points`、严格相邻期连续计数、4 项处理选择含续接已有 Case、多独立 Case 草稿与主动试点） | PASS（`goal-decomposition-full.test.ts`、Chromium E2E） |
| **GM12**（末版有效目标 120→110→112 复盘、期初备忘、假设分类、下期草案不自动采纳、带原证据回送战略） | PASS（`goal-decomposition-full.test.ts`、Chromium E2E） |
| **GM13 & E1**（schema 4 兼容、快照外置与分页、`--disable-goal-decomposition` 只读回退与工具禁用） | PASS（`goal-decomposition-full.test.ts`、`check:agent-sessions`） |
| **原型缺口 #1**（正式导出、快照读取、承接预览严格来自冻结版，绝不混入当前草稿） | CLOSED（`goal-decomposition-full.test.ts` Test 4 + 导出 HTML 断言） |
| **原型缺口 #2**（项目承接预览零写、固定冻结检查点与去重，未授权/无新表旧记录保持兼容） | CLOSED（`goal-decomposition-full.test.ts` Test 4 + `ExecutionHandoffDialog`） |
| **原型缺口 #3**（企业范围权限撤销在操作期阻断读、导出、承接与检查，子目标越权范围在预览/发布期阻断） | CLOSED（`goal-decomposition-full.test.ts` Test 5 & Test 6） |

---

## 3. 四点产品原则专项终检与 IN01–IN07 核对

1. **Host 管环境**：Host 仅负责权限校验、存储原子性、确定性规则校验（不自动平差、不替人选方案）、冻结快照导出、失答状态机与统一 Pi 会话边界，不自建推理循环。
2. **Agent 自主执行**：确认前测算与确认后拆解均在统一 Pi 会话内由 Agent 自主决定方法、调用固定技能脚本与读写拆解草稿；不固化预测方法库，也不允许 Agent 自行正式发布。
3. **优先复用 Pi 已有能力**：完整复用官方 Pi SDK `1.4.0` 与既有 `business-role-discussion` 域及 `BusinessRoleConversation` 组件，零平行 Runtime、零 SDK 改写（`check-agent-session-boundary.mjs` PASS）。
4. **减少人的操作**：确认总 GSA 合并目标采用与上层计划 A 为一步；拆解工作台左 Agent 右表同屏协作、自动同步草稿；日常 4 项低频入口收敛为按需弹窗，正常发布最短路径无需绕行。

---

## 4. 独立非作者复核记录与修复闭环

- **复核执行者**：独立只读 Subagent（`f941ace1291e0273ef9246689e6d9580`），对全部后端、前端、测试与冻结文件进行了三轮完整核查。
- **初审发现（6 项 P0 + 8 项 P1）及闭环状态**：
  - **P0 #1–#6 全部修复**：确认发布严格绑定预览快照并拦截草稿/GSA 漂移；预览与发布逐行校验子目标 `scope` 权限；`readPendingIntent` 存储不可读/损坏时锁定编辑与发布；`server.ts` 统一处理 `GoalDecompositionError` 与 `StrategyGoalsError` 并透传 `details`；补缺策略 UI 补齐 `strategy`/`basis` 与规范化 `scopeKey`；`ExecutionHandoffDialog` 恢复挂载 `ReadGoalArrangements`（UI04）。
  - **P1 #1–#8 全部修复**：`GoalEditor` 接入 `formalSources` 校验与可选 `formalOrigin` 字段；`formal-sources`/`draft-estimates` 补齐 `validateScope`；`--disable-goal-decomposition` 同步阻断 Agent 拆解工具；`evaluateProgressComparison` 修复 `percentage-points` 比较与严格相邻期/去重/作废检查；Stage 2 补齐拆解版／责任行／冻结检查点选择器与续接已有 Case（且在二审捕获并修复了 `caseId` 字段名对齐与 `gsa_planned_actions_required` 提示键名）；子目标 `unchanged` 判定纳入 `targetValue`/`scope`；显式重试再次失答回退 `unknown`；历史目标版本只读锁定并绑定准确 `goal.version`。
- **终审结论**：独立非作者复核确认 **PASS（0 P0、0 P1 剩余）**。

---

## 5. 实际验证命令与结果（最终候选代码）

1. **统一会话边界检查**：
   - `npm run check:agent-sessions` → **PASS**
2. **类型检查与前端构建**：
   - `npm run build`（`tsc --noEmit && node scripts/frontend.mjs build && node scripts/stamp-build.mjs`）→ **PASS**
3. **核心目标管理、拆解、统一会话、策略发布与 UI 自动化测试（Batch 1，18 文件，`--test-concurrency=1`）**：
   - 含 `goal-decomposition-core.test.ts`（5/5）、`goal-decomposition-full.test.ts`（6/6，含 6 项复核回归）、`goal-origin-role-v13.test.ts`、`strategy-goals-*.test.ts`、`strategy-publication-*.test.ts`、`business-role-sessions.test.ts`、`agent-session-*.test.ts`、`v12-strategy-ui.test.ts`、`strategy-initiative-ui.test.ts`、`static-ui.test.ts`
   - 结果：**160 / 160 PASS（0 FAIL, 0 SKIPPED）**
4. **下游 Case / Project / Discussion / V12–V13 UI / Teach / Permission 回归测试（Batch 2，21 文件，`--test-concurrency=1`）**：
   - 含 `case-goals*.test.ts`、`legacy-case-goal-context-r01.test.ts`、`project-goal-*.test.ts`、`v12-discussion-*.test.ts`、`v12-plan-usage-ui.test.ts`、`v12-usage-ui-client.test.ts`、`v13-*.test.ts`、`strategy-teach-source.test.ts`、`strategy-permission-host.test.ts`、`strategy-discussion-*.test.ts`
   - 结果：**69 / 69 PASS（0 FAIL, 0 SKIPPED）**
   - 合计受影响及下游自动化测试：**229 / 229 PASS（0 FAIL）**
5. **真实 Chromium Playwright E2E（针对真实 Host 托管的编译后 `dist/`）**：
   - 覆盖 7 条路径：`old-4-goal-tabs-removed`、`normal-gsa-confirm-decompose-preview-publish-export`、`cross-conflict-50-45-30-35-blocked-aligned-published`、`real-http-lost-response-goal-isolation-reload-host-restart-recovery`、`followup-partial-missing-and-independent-case-intent`、`cycle-review-and-next-cycle-draft`、`responsive-1440-760-390-light-dark-zero-pageerrors`
   - 结果：**7 / 7 PASS，`pageErrors: []`**

---

## 6. 兼容性、回退与边界说明

- **回退方式**：启动 Host 时传入 `--disable-goal-decomposition` 可关闭新拆解写路由与 Agent 拆解工具（返回 403 `goal_decomposition_disabled`），同时保持 schema 4 已有数据与历史正式版只读可查，旧目标与旧流程不受破坏。
- **验证边界与未做事项（如实记录）**：
  - 全仓共 470 个测试文件，在本 2 vCPU 云端 VM 上直接串行运行 `npm run check` 超出单命令 10 分钟限制而被截断（前 10 分钟内未见任何失败）；上述 39 个覆盖全部受影响模块及上下游消费者的测试文件均在最终候选上 100% 通过（229/229），完整全仓 CI 待 PM 审阅并建 PR 后由 GitHub Actions 执行。
  - 本次验证全部使用合成业务数据与本地合成 Provider，未触碰任何真实经营数据、真实模型凭据或外部商业 API；未执行 MacBook / Mac mini 运行服务切换，亦未越权开 PR、合并 `main` 或关闭 Issue #136。
  - 工程交付验证与设备运行采用、用户产品验收分别核定。

## 返工候选（PM 首审 issuecomment-7164347353 之后）

原候选 `fcbdd702ff8383b0e0391f8259a7ca6e9b1a0d3b`、原交接回执 issuecomment-7163963498 及 PM 首审意见保留为历史记录，不覆盖。

### 首审阻断项处理
1. GSA 绑定精确可见版本；缺 `formalOrigin` 失败关闭（`gsa_formal_target_required`），伪造战略来源被拒（`formal_strategy_origin_mismatch`），采用新版本后旧总 GSA 过期（`gsa_plan_stale_for_adopted_goal`）。
2. 拆解草稿不再伪造默认值；发布预览零写入；口径校验先于金额与缺口计算。
3. 自引用／重复关联拒绝；冻结发布按行范围鉴权；历史版本工作区不泄漏新版本数据；reconcile-formal 受功能开关约束。
4. 责任行检查点使用该行冻结计划值（线上第 2 周 35 万），不再回落到总表 30 万；实绩来源与截止时间由用户提供。
5. `continue-existing` 校验开放 Case 及目标／策略；承接可带入真实 Case 编辑器和项目创建（`goalOrigin.decompositionHandoff`）。
6. 到期复盘只认该期已确认且绑定已采用版本的总 GSA；空实绩保持待补；结论可子集选择；战略回送可在战略视图查看。
7. 引入讨论稿 `docs/optracall-goal-management-discussion-v0.1.md`；清除 EOF 空行。

### 本轮验证（worktree，节点测试均 `--test-concurrency=1`）
- `npm run typecheck`、`npm run check:agent-sessions`、`npm run build`、`git diff --check d4b60b5…`：通过。
- 12 个相关测试文件共 93 项：93 通过、0 失败。新增回归：责任行 35 vs 总表 30 及检查点错配、缺／伪造 formalOrigin、旧 GSA 过期、复盘基线与空实绩、战略回送列表。
- 失败→修复：原测试把责任行检查按总表周期 30 断言，已改为总表行使用 `G-TOTAL`。

### 未覆盖（如实说明）
- 真实 Chromium 浏览器 E2E 未在本轮重跑；原 E2E 脚本需按去除默认值后的界面更新。
- 未运行截断的全仓 `npm run check`；独立非作者复核尚未对本返工候选执行。
- 首审第 2、3、5 项中口径不可比、重复关联、关闭 Case 拒绝、项目承接持久化等仅有代码实现，缺少专门的新增 Host 回归。

## PM 二审与接手修复

领取方最后交付 `d04991de36ccf1a23b104891a79c0644637eaa90`。二审核实线上第二周责任行取冻结计划 35 万，总表同期保持 30 万。隔离 Chromium 实跑正常发布、两处交叉分歧对齐后发布、提交后丢回包三条主路径。进一步走业务入口时发现，原候选允许单位不同但数字相同的格子通过，预览与发布快照可出现不同的正式值和缺口，切换目标后还会带出另一目标未提交的实绩。PM 按工程规范 §6 接收候选并承担集成写入。[终审及写入归属](https://github.com/gadfly-hbo/OptraCall/issues/136#issuecomment-7166141183)

| 验收对象 | PM 接手后的实现和永久回归入口 |
| --- | --- |
| 正式战略 G、总 GSA、可达测算 | 以战略发布和具体 G 的身份核对，多个目标供负责人选定。确认绑定页面所见版本。金额、比率与里程碑分别按其业务口径核对，预览与冻结正文使用同一组正式值、测算值和差额。 |
| 负责人发布和失答恢复 | 已存草稿的只读预览包含责任行及关系的预期版本。确认时检查并发变动，按同一操作回读已发布版。交叉项、预留和补缺按各自条件校验。 |
| 版本、Case 和项目 | 历史表、导出、操作回执及消费入口核对所用的冻结来源。按父表定位交接，再读取实际承接的责任行、准确子目标与检查点。 |
| 实绩与复盘 | 负责人提交或选定当期凭证。统一 Pi 目标会话读取固定报告，保留 Agent 的原文引句与判断，Host 核对字段、准确检查点及期间。历史阈值固定，按本期最后确认的 GSA 评估。下期目标使用独立草稿会话，只带入负责人选定的证据，再按原入口采用。 |
| 四项产品原则 | Host 保管原据、来源权限、版本、确定性校验和发布回执。Agent 自主分析报告并形成拆解或下一期候选。会话继续使用 Interface v3 和官方 Pi 1.4.0。正式地图直接预填，负责人一次发布可完成已承诺行的采用，失答恢复只读。 |

### 可复跑的验证入口

- Node 25.9.0 下运行 `npm run check`。其中真实 Host 的目标管理集成路径在 `tests/goal-decomposition-core.test.ts` 和 `tests/goal-decomposition-full.test.ts`。合成 Provider 通过真实 Pi 工具运行测算脚本、提交实绩评估以及输出含原证据的可编辑下期建议。
- 构建真实前端后，在已有 Playwright 和 Chromium 的环境运行 `OPTRACALL_CHROMIUM=/usr/bin/chromium node tests/browser-issue-136-goal-decomposition.mjs`。脚本使用独立临时数据根，并记录每条路径的实际结果。
- 上一节的 93 项结果和原候选的 229 项结果分别保留在各自的交付时点。PM 接手期间曾在仍在修改的工作树启动全仓检查，期间出现 Host 启动超时，已终止该轮。最终提交、非作者复核、两次 CI 及工程结案证据以同一 Issue 的后续回执为准。运行环境采用及实际经营数据上的模型效果需另行核定。[交付记录](https://github.com/gadfly-hbo/OptraCall/issues/136)

# Decision Case 工作台 v5（#142）交付记录

## 1. 身份、基线与确认包核对

| 字段 | 实际记录 |
| --- | --- |
| 工单 | [gadfly-hbo/OptraCall#142](https://github.com/gadfly-hbo/OptraCall/issues/142) |
| 领取与实施 Agent | Antigravity (Google DeepMind Agent) / devbox `51923b5f` |
| 任务分支 | `work/antigravity/issue-142-decision-workspace-v5` |
| 主线基线完整 SHA | `b1c0f70156598f7c662b3c64833bf28f7d630205` |
| 确认包提交 | `6df731afa67887577bbac2ef0652d9728d49efca`（`review/decision-workspace-v5-confirmed`） |
| 固化确认件核对 | `openspec/changes/decision-case-workspace-v5/demo.html`：362,273 字节，SHA-256 `68ee0b506d83782685ccc938d9f95068e9c66221a0c94746f08f2010e2808473`（原样携入，零改写）；同目录 `spec.md`、`tasks.md`、`demo-guide.md` 同步原样保留 |
| Runtime / SDK 约束 | 官方 Pi SDK `1.4.0` / 统一会话 Interface v3 零改动、零绕过；未升级任何依赖或锁文件 |

## 2. 变更范围

- **新增前端只读聚合与导航模块**：
  - `src/host/ui/workspace-home-model.ts`：启动路由解析（`resolveInitialWorkspaceView`）、首页只读聚合模型（`buildWorkspaceHomeModel`，区分空态 / 403 无权限 / 不可用三态、锁定准确目标版本 `vN`、区分 Case 状态与关联项目行动状态、依据来源分组或 3 类就绪清单）、项目六类任务统计（`summarizeProjectTaskTypes`）与跨模块只读搜索过滤（`filterWorkspaceSearchItems`）。
  - `src/host/ui/WorkspaceHome.tsx`：工作台首页只读视图，聚合现有 Case、项目、目标、战略发布、Studio 企业及四项基础建设状态，支持手动刷新与返回自动重读，不产生任何业务写入。
  - `src/host/ui/WorkspaceSearchDialog.tsx`：顶栏按钮与 `/` 快捷键触发的只读跨模块搜索弹窗，支持键盘 `↑`/`↓`/`Enter`/`Esc`（含 `<input type="search">` 首按 `Esc` 立即关闭并还回焦点）与空命中退出。
  - `src/host/ui/workspace-home.css`：v5 首页、侧栏分组、引用原文检视器、六类任务筛选条、快捷搜索弹窗的亮暗双主题与 1440 / 1024 / 390 CSS 像素响应式样式。
- **既有 UI 接缝适配**：
  - `src/host/ui/App.tsx`：普通启动默认落入 `home`（工作台首页），保留 `?management=`、`?studio=`、`?project=`、`?task=`、`?returnCase=` 深链优先；侧栏主导航内部分组为「日常工作」（工作台首页 / 决策星图 / 项目地图）与「基础建设」（战略选择 / 目标管理 / 语义资产 / 分析资产）；顶栏接入「搜索工作区 `/`」；支持从首页直达报告与依据并携带来源 Case，进入设置后返回原位（保留原报告版本、草稿与来源 Case）。
  - `src/host/ui/CaseBoard.tsx`：新增 `initialCreate` / `onInitialCreateConsumed` / `onCaseChanged` 接缝，支持四项基建均空时从首页直达就地候选 G+S 准备、显式采纳与创建 Case，并将 Case 变更回传触发首页刷新。
  - `src/host/ui/ProjectBoard.tsx`：任务行展示真实人工分配的六类任务标签（旧未分类任务标注「未分类」，不推断类型）；项目详情增加六类任务计数与筛选条，关联 Case 支持点击「回到原 Case」。
  - `src/host/ui/TaskReportEvidence.tsx` & `src/host/ui/TaskReportReferences.tsx`：报告检视区展示来源 Case 横幅与「返回来源 Case」按钮，支持首页直达自动打开指定准确版本；引用检视增加带 `projectId` / `citationId` / `path` / `sha256` 身份信息的阅读区、关闭按钮与捕获阶段 `Escape` 关闭并将焦点还回精确触发按钮。
- **新增测试**：
  - `tests/workspace-home-v5.test.ts`（先 RED 后 GREEN 单元测试，5 项全部通过）
  - `tests/browser-issue-142-workspace-home.mjs`（隔离真实 Host + Chromium 浏览器验收，40 项检查全部通过，保留改前 `before-baseline` 与改后 `after-v5-complete` 截图及回执于被忽略的 `.local/issue-142/`）

## 3. W01–W09 验收矩阵

| 项 | 结果 | 证据与说明 |
| --- | --- | --- |
| **W01 首页和导航** | **PASS** | `tests/workspace-home-v5.test.ts`（空态 / 403 无权限 / 不可用三态、深链优先、只读聚合）+ `tests/browser-issue-142-workspace-home.mjs`（普通启动落首页、空态独立项目可达、编辑 Case 返回首页按真实回执刷新焦点/下一步/活动、`?management=gsa` 与 `?project=&task=` 深链优先）。 |
| **W02 Case 与双向承接** | **PASS** | `tests/browser-issue-142-workspace-home.mjs`（四项基建全空状态下由首页点击「新建 Case」→ 启用记录 → 就地准备候选 G+S → 明确采纳 → 创建 Case → 返回首页核对）+ `tests/case-goal-ui.test.ts`、`tests/case-goals.test.ts` 回归通过。 |
| **W03 地图与六类任务** | **PASS** | `tests/workspace-home-v5.test.ts`（六类统计不推断旧任务）+ `tests/browser-issue-142-workspace-home.mjs`（零任务项目、同类多任务 `分析 Analysis 2` + `需求 Requirement 1` + `反馈 Teach 1`、多 Case 共用项目、已归档项目、点击「回到原 Case」、浏览零任务生成）+ `tests/case-star-map-view.test.ts`、`tests/case-star-map-recovery.test.ts`、`tests/project-task-assignments-v13.test.ts` 全部通过。 |
| **W04 任务与报告证据** | **PASS** | `tests/browser-issue-142-workspace-home.mjs`（从首页队列直达带来源 Case 的报告、并排阅读、逐一打开「查看此份固定来源」与「读取这份固定附件」核对 `projectId`/`citationId`/`path`/`sha256`、`Esc` 关闭并还回对应触发按钮焦点、返回来源 Case 不丢草稿）+ `tests/browser-ui-129-visual-refresh.mjs` V02–V04/V06（缺件/变更 409/固定原件/归档只读/跨任务草稿隔离）通过。 |
| **W05 战略** | **PASS（外壳接入与可达回归）** | 保留原有 `StrategyWorkbench` / `StrategyInitiativeWorkbench` 串行双检验、发布、撤回与目标承接逻辑；首页四项基建卡片经 `listInitiatives` + `listPublications` 只读反映真实发布/进行中/未开始状态；`/` 搜索直达「战略选择」通过。未额外重跑需系统 `chrome` 频道的 `tests/browser-strategy-release.mjs`（记入未跑项）。 |
| **W06 目标管理与 #141 回归** | **PASS** | `tests/goal-decomposition-contract.test.ts`（DC01–DC05 全部 5 项通过）、`tests/goal-decomposition-core.test.ts`、`tests/goal-trial-improvements.test.ts` 及 `tests/browser-issue-138-goal-trial.mjs`（全部 13 项真实 Host+Chromium 试用路径 0 错误通过）。 |
| **W07 语义与分析资产** | **PASS** | `tests/browser-issue-142-workspace-home.mjs` 实测从「语义资产」与「分析资产」两入口核对同一企业范围（`当前企业` ID 一致）；`tests/member-operations-pack-ui.test.ts` 与 `tests/project-data-context-ui.test.ts` 全部通过。 |
| **W08 设置与帮助** | **PASS** | `tests/browser-issue-142-workspace-home.mjs` 实测三组九项顺序与文案、带来源 Case 的任务报告 → 设置 → 切换至「连接配置」 → 返回后完整保留原报告检视区、原版本、任务草稿与「返回来源 Case」；`tests/help-manual.test.ts`（HELP-01/HELP-02）与 `tests/model-pack-ui.test.ts`、`tests/personal-retention-ui.test.ts` 全部通过。 |
| **W09 视觉与可用性** | **PASS** | `tests/browser-issue-142-workspace-home.mjs` 在 1440 / 1024 / 390 CSS 像素 × 亮/暗双主题全部验证零横向溢出，并人工检视全部截图；`/` 快捷搜索、空命中退出、`Esc` 焦点返回与键盘进入模块通过；保留双圆 BrandMark、紫色 `--accent` 与原 favicon。 |

## 4. 四点产品原则专项自检（作者自检，非独立复核替代）

| 原则 | 检查结论 | 证据 |
| --- | --- | --- |
| **Host 管环境** | 合规 | `WorkspaceHome` 与 `WorkspaceSearchDialog` 仅做现有公开 HTTP GET 读接口的只读投影与导航，不写入业务记录、不编排推理步骤、不篡改版本或权限边界；无权限（403）与服务不可用显式分态。 |
| **Agent 自主执行** | 合规 | 未新增任何分析硬编码流程、方法配额或步骤拦截；目标拆解、策略共创与普通任务继续完全由 Pi Agent 在既有授权内自主执行。 |
| **优先复用 Pi 已有能力** | 合规 | 静态检查 `npm run check:agent-sessions` 通过；官方 Pi SDK `1.4.0` 与 Interface v3 零改动，新增代码无任何 `pi-coding-agent` / `pi-agent-core` 直接导入或平行 Runtime。 |
| **减少人的操作** | 合规 | 普通启动即见当日待决定事项与一键继续入口，冷启动四项基建全空时一步进入就地候选 G+S 与 Case 创建；`/` 跨模块直达且不增加额外必做维护或普通读取确认；必要采纳、发布、权限边界全部保留。 |

## 5. 实际执行命令、失败 / 跳过 / 未验证项

1. **已通过**：
   - `npm run check:agent-sessions` → **PASS**
   - `npm run build`（`tsc --noEmit && node scripts/frontend.mjs build && node scripts/stamp-build.mjs`）→ **PASS**
   - 定向核心回归（15 个 `tests/*.test.ts` 文件，含 `workspace-home-v5`、`help-manual`、`goal-decomposition-contract` DC01–DC05、`goal-decomposition-core`、`goal-trial-improvements`、`case-goal-ui`、`case-goals`、`case-star-map-view`、`case-star-map-recovery`、`project-location-v020`、`project-task-assignments-v13`、`project-data-context-ui`、`member-operations-pack-ui`、`model-pack-ui`、`personal-retention-ui`）→ **78/78 PASS，0 FAIL，0 SKIP**
   - `ISSUE142_RUN=after-v5-complete node tests/browser-issue-142-workspace-home.mjs` → **40/40 PASS，0 FAIL，0 pageerror**（含改前 `before-baseline` 与改后 1440/1024/390 亮暗及 W04 并排报告截图）
   - `OPTRACALL_CHROMIUM=/opt/ms-playwright/chromium-1255/chrome-linux64/chrome node tests/browser-issue-138-goal-trial.mjs` → **13/13 PASS，0 errors**
2. **部分通过 / 既有基线差异保留**：
   - `OPTRACALL_BROWSER_EXECUTABLE=/opt/ms-playwright/chromium-1255/chrome-linux64/chrome node tests/browser-ui-129-visual-refresh.mjs`：V03（1024/390 模态检视区、Tab/Esc、焦点与草稿返回）与 V02–V04/V06（任务、草稿、署名、报告/哈希/固定来源、Case 往返、归档只读、失效链接保护）均 **PASS**；`shellScenarios` 阶段停在等待 `<h1>目标管理</h1>`——核查确认主线 #140 已在存在目标时将 `GoalDecompositionWorkspace` 的 `<h1>` 改为具体目标标题（`StrategyGoalsPage.tsx:534` / `GoalDecompositionWorkspace.tsx:1334`），属基线既有脚本断言漂移，非本单回归，原现象保留不篡改旧脚本。
3. **受环境限制未跑 / 待 CI 补齐项**：
   - 全量 `npm run test`（473 个测试文件）：本机 2 vCPU 环境下单命令在 10 分钟工具上限前已完成前 432 行（0 失败）后被外部超时中止；高并发分片（8 worker / 2 vCPU）出现 CPU 争抢 10s 超时。完整 473 文件回归及高危依赖审计需由 PM 关联 PR 后的 GitHub Actions `Check` 工作流对最终 head 执行核定。
   - 真机 macOS / iOS 触控与真实外部 Provider 模型调用不在本单授权内，标记 `NOT_RUN`。
   - 非作者独立复核与最终合并由 PM Agent 依工程规范第 4–6 节组织。

## 6. 兼容与回退方式

- 本次变更仅涉及前端 UI 外壳、只读聚合视图与测试，**无持久化 schema 迁移、无新增写 API、无后端契约破坏、无依赖版本改动**。
- 如需回退，直接撤销本分支前端提交即可恢复旧默认视图（决策星图）；用户在此期间产生的 Case、项目、任务、草稿、目标、战略与 Studio 数据格式完全向后兼容，无数据损失或回退转换风险。

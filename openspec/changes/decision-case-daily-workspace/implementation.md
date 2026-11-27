# 实施与首审返工记录（Issue #149，领取方 Antigravity）

- 任务分支：`work/antigravity/issue-149-decision-case-daily-workspace`
- 核实基线：`699e425cb0900b50385377d638495069fa726761`（最新 `origin/main`）
- 首次候选（首审退回，保留证据）：`fd0003e6441e75f9e7daae88e09f3a0411227f04`
- 重新领取评论：`#issuecomment-7221295217`（`IC_kwDOVaDnXM8AAAABrmw4cQ`）
- 确认包来源：`5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2`（冻结 `demo.html` SHA-256 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911` 原样保留）

## 首审 FR01–FR08 逐项修复映射与永久回归

| 返工项 | 实际修复内容与文件 | 永久回归与实跑结果 |
| --- | --- | --- |
| **FR01** | `server.ts` 注入真实 `readGoal`（调用 `strategyGoals.read` + `validateStrategyGoal`），`createCase` 复用原 `caseRoutes` `POST /api/cases` 准入（含 `assertAdoptedGoalRefs` 与企业归属校验）；`case-creation-orchestrator.ts` 拒绝盲信 `alreadyAdopted`，核实真实 `status === 'adopted'` 与该版 `strategies` 成员资格。 | `tests/fr01-03-05-repro.test.ts` (`FR01-REPRO`)：**PASS**（candidate + `alreadyAdopted:true`→409，不存在 goal/version→404，虚构策略→400）；`DW-HTTP-03`：**PASS** |
| **FR02** | `case-creation-orchestrator.ts`：回放前严核 `kind === 'case_create'` + 标题/描述/goalBinding 指纹（拒绝无关 `case_note` 冒认）；若草稿已有 A 的部分采纳回执而改选 B，拒绝 `409 prepare_draft_goal_mismatch`（绝不静默绑 A）。`workspace-draft-store.ts`：按路径进程级互斥串行 CAS（并发同 revision 严格一胜一 409），`appendCarryOverFragment` 严核 `targetCaseId/targetIssueId` 与目标草稿归属（跨 owner 拒 409）。 | `tests/fr01-03-05-repro.test.ts` (`FR02-REPRO`) + `tests/workspace-daily-backend.test.ts`：**PASS** |
| **FR03** | `extensions/business-plugins/decision-board/storage/store.ts`：正式升级 schema 至 **v6**（`REQUEST_RESPONSE_SCHEMA` + `validateSchema(db, 6)` + `init` 允许版本 0–6），保存带 `respondsToRequest` 反馈后关闭重开零报错。`case-store.ts` / `case-decision-types.ts` / `case-issues.ts` / `workspace-daily-routes.ts`：取舍请求严核 `caseStoreId` 与非空 `source.ref`；观察请求创建与读取均严核已关联项目、Board task/item 及真实 Case 关联授权 `authorityAtFeedback`。 | `tests/fr01-03-05-repro.test.ts` (`FR03-REPRO`) + `tests/case-decision-requests.test.ts` (`DW08/DW09-REQ-01..03`) + `tests/decision-board-*.test.ts` (32/32)：**PASS** |
| **FR04** | `WorkspaceHome.tsx` 移除启发式“需要你处理”标题，改为“近期动态与待推进项（非明确请求）”；`HomeDailyQuickPanel.tsx` 显式渲染 `unresolvedRequests`（已替代/待核请求不静默消失）；`CaseIssuePanel.tsx` 确认取舍时匹配当前打开的 `choose` 请求并携带 `respondsToRequest: { requestId, revision }` 提交 `saveCaseStrategyChoice`，并展示正在回应的明确请求提示。 | `tests/workspace-daily-http-pi.test.ts` (`DW-HTTP-01`) + `tests/browser-decision-case-daily.mjs`：**PASS** |
| **FR05** | `strategy-discussion.ts` / `project-runtime.ts` / `project-session.ts` / `strategy-discussion-host.ts` / `server.ts`：为真正 `{role:'case', caseId, itemId}` owner 启用窄工具 `case-declarations`（`case-save-issue-edge`、`case-save-decision-request`），Host 绑定 `caseId`/`itemId` 与 `sessionId/requestId/toolCallId` 来源；`saveIssueEdge` / `saveDecisionRequest` 在同一 `deps.mutate` 提交前调用 `assertWritable` 核对 `assertCurrent` + `signal.throwIfAborted()`，排队取消零落盘。 | `tests/fr01-03-05-repro.test.ts` (`FR05-R3-REPRO`) + `tests/workspace-daily-pi-loop.test.ts` (`DW-PI-LOOP-01`，真实 Host → 官方 Pi 1.4.0 → 隔离合成 HTTP Provider 实跑 `goal-draft` `case-directory` 与 `{role:'case'}` 双声明工具)：**PASS** |
| **FR06** | `HomeDailyQuickPanel.tsx`：轻输入防抖自动持久化 + 失焦/导航前 flush（不点保存切到全部项目再返回不丢输入）；明确目标事项选择器（不再默认首事项）；接入可选用户主动 `{role:'goal-draft', draftId, scope}` Agent 面板；接入统一三分支准备表单直连 `POST /api/workspace/create-case` 及部分成功“核对原操作并继续创建”按钮。`BusinessRoleConversation.tsx` + `CaseIssuePanel.tsx`：新增 `externalAppend` 属性，将待带入片段直接追加到真实可发送的对话 composer（保护非空既有草稿）。 | `tests/browser-decision-case-daily.mjs`（验证未点保存切页返回仍保全输入） + `tests/workspace-daily-backend.test.ts`：**PASS** |
| **FR07** | `CaseBoard.tsx` + `CaseIssuePanel.tsx`：受控 `selectedIssueId` 在切页签重挂载时不回首项且保留手选范围；两辅助页新增“按事项筛选”下拉框并以 `auxScope.issueId` 实际过滤，产物页事项范围不再混入无 `taskId` 资料；四页签上方常驻 `目标 / 策略（G/S）` 栏；概览页新增 `已明确 / 正在推进 / 接下来` 三段本轮摘要。 | `tests/browser-decision-case-daily.mjs`（验证常驻 G/S、三段摘要、其他事项选择器、切页签后保留手选范围与事项）：**PASS** |
| **FR08** | 补齐真实 Host→官方 Pi 1.4.0→隔离合成 Provider 双 owner 工具回环测试、所有 FR01–05 负例永久回归、增强版 Headless Chrome CDP 浏览器测试，并在固定候选上留存可访问的非作者独立只读复核报告 `verification/second-review.md`。 | 见下表全部实跑命令与结果 |

## 实跑命令与结果汇总

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| Agent 会话边界 | `npm run check:agent-sessions` | **PASS** |
| TypeScript + 前端构建 | `npm run build` | **PASS**（`tsc --noEmit` + Vite + stamp-build） |
| 全部 DW + FR01–05 + 真实 Pi 1.4.0 回环测试 | `node --test tests/fr01-03-05-repro.test.ts tests/workspace-daily-pi-loop.test.ts tests/workspace-daily-http-pi.test.ts tests/case-decision-requests.test.ts tests/workspace-daily-backend.test.ts tests/case-issue-edges-*.test.ts tests/case-issue-map-model.test.ts` | **21/21 PASS** |
| Decision Board 回归 | `node --test tests/decision-board-*.test.ts` | **32/32 PASS** |
| 实际产品浏览器（Headless Chrome CDP） | `node tests/browser-decision-case-daily.mjs` | **PASS**（1440 / 1024 / 390、无旧“需要你处理”、未点保存切页保全输入、常驻 G/S、三段摘要、树状图多前驱、按事项筛选与手选范围跨 Tab 保留、XSS `window.__xss===false`） |
| 冻结原型校验 | `node openspec/changes/decision-case-daily-workspace/verification/check-demo.mjs` | **27/27 PASS**，SHA-256 未变 |

## 诚实未测与剩余边界（不隐去）

- **全量 `npm run test`（565+ 测试文件）**：本机未全量跑完 565 文件全集，已跑核心相关测试与全部 FR01–08 新增回归，留待 GitHub Actions CI 对准确 head 执行全量回归。
- **观察类 UI 表单直带 `respondsToRequest`**：后端 `DecisionBoardStore.saveFeedback`（schema v6）与 `/api/decision-board/tasks/:id/feedback` 路由已支持 `respondsToRequest` 并经 `DW08/DW09-REQ-02` 与 `FR03-REPRO` 实测；看板独立反馈弹窗 UI 尚未自动回填当前打开的 `observe` 请求上下文（取舍请求已打通完整 UI→HTTP→首页派生闭环）。
- **浏览器自动化深度**：已覆盖 1440/1024/390、无启发式队列、轻输入跨页自动保全、常驻 G/S、三段摘要、树状图多前驱、手选范围跨 Tab 保留与 XSS；深浅主题切换、403/503 模拟态与全键盘焦点遍历尚未在浏览器脚本中自动化断言。
- **兼容性与回退**：Case 事件与 `workspace-drafts/` 独立增量；Decision Board 仅在写入 `respondsToRequest` 时按正式 `PRAGMA user_version=6` 迁移并保全全部旧表/旧行，已验证保存→关闭→重开通过 `validateSchema(db, 6)`。不改官方 Pi 1.4.0 SDK、锁文件、公共 Runtime 或 Interface v3。

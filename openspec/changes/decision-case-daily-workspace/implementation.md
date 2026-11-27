# 实施记录（Issue #149，领取方 Antigravity）

- 任务分支：`work/antigravity/issue-149-decision-case-daily-workspace`
- 核实基线：`699e425cb0900b50385377d638495069fa726761`（最新 `origin/main`）
- 确认包来源：`5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2`（冻结 `demo.html` SHA-256 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911` 原样保留）
- 授权说明：用户明确授权 Antigravity 整单负责（含 Host/Agent 接入），整体完成后一次性推送并在 Issue #149 回执。

## T02 盘点与 IN01–IN07 接入责任

| 模块 | 现有权威 / Owner | 本单最小增量 | 边界与保全 |
| --- | --- | --- | --- |
| 事项与承接边 | `CaseStore` 事件式 `changes.decisionIssue` | 新增事件式 `changes.issueEdge`（`listIssueEdges` / `saveIssueEdge`），无 SQL schema 迁移；HTTP `/api/cases/:id/decisions/issue-edges`；纯模型 `case-issue-map-model.ts` | 旧 Case↔Case `case_relation_revisions` 与旧无边数据完整保留，不推断边，支持多前驱汇入与安全回指 |
| 明确请求与精确回应 | `CaseStore` + `DecisionBoardStore`（`chooseStrategy` / `saveFeedback`） | 新增事件式 `changes.decisionRequest`（`listDecisionRequests` / `saveDecisionRequest`）、`respondsToRequest` 引用与纯派生 `requestStatus()`；`feedback_revisions` 惰性补 `responds_to_request_json` 列 | 无独立完成清单；打开/查看/无关选择/别轮/别授权不消解请求；`pendingOperations` 分列为 `operation-to-verify` |
| 首页投影与轻输入 | `WorkspaceHome.tsx` + 新增 `home-pending.ts`、`HomeDailyQuickPanel.tsx` | `GET /api/workspace/home-pending` 返回标题 `待处理事项`（无可靠身份不称“待你”）、`externalWaiting`、`pendingOperations`、四项非门禁 `foundationReminders` | `awaiting_confirmation`、缺 choice/feedback、普通报告、缺承担人不伪造成待处理 |
| 持久草稿与三分支创建 | 新增 `workspace-draft-store.ts`、`case-creation-orchestrator.ts`、`workspace-daily-routes.ts` | 原子 JSON 文件持久保存 `prepare` / `carry-over` / `issue-draft`（CAS 409、防重追加、分域放弃）；`POST /api/workspace/create-case` 覆盖继续/直接创建/采纳并创建与部分成功恢复 | 不改目标权威或 #148 的 GSA 承接/实绩/阈值/发布核对；放弃草稿不撤销已保存目标或 Case；已结束 Case 不自动重开 |
| Agent 接入（Pi 1.4.0 / Interface v3） | `strategy-discussion.ts` (`{role:'goal-draft',draftId,scope}`)、`case-decisions.ts` / `project-session.ts` | `editableGoalTool` 新增只读 `case-directory`（绑定 `listVisibleCaseDirectory`）；Case 工具新增 `save_case_issue_edge` / `save_case_decision_request` | 不改 SDK/依赖/锁文件/公共 Runtime；`npm run check:agent-sessions` PASS |
| 统一入口与视图 | `App.tsx`、`DecisionCaseTabs.tsx`、`CaseBoard.tsx`、`CaseIssuePanel.tsx`、`CaseIssueTreeSidebar.tsx` | 一级 Tab 统一为 **Decision Case**（`Case 总览` / `全部项目`）；事项侧栏列表/树切换；辅助页默认事项与手选范围保留 | 浏览范围不改 Agent owner；共享项目不自动关联全部资料；全部文本由 React 转义 |

## 实跑命令与验证结果

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| Agent 会话边界 | `npm run check:agent-sessions` | PASS |
| TypeScript + 前端构建 | `npm run build` | PASS（`tsc --noEmit` + Vite build + stamp-build） |
| DW01–18 新增确定性 & 真实 Host HTTP 测试 | `node --test tests/workspace-daily-http-pi.test.ts tests/case-decision-requests.test.ts tests/workspace-daily-backend.test.ts tests/case-issue-edges-*.test.ts tests/case-issue-map-model.test.ts` | 16/16 PASS（含 `DW-HTTP-01` 真实请求→选择→首页派生更新、`DW-HTTP-03` 真实 `StrategyGoalsStore.adopt` + `CaseStore.createCase`） |
| 既有 Case 核心回归 | `node --test tests/case-decision-store.test.ts tests/case-decision-host.test.ts tests/case-store.test.ts tests/case-host.test.ts tests/case-relations-store.test.ts tests/case-goal-ui.test.ts tests/v13-case-work.test.ts` | 48/48 PASS |
| Decision Board 回归 | `node --test tests/decision-board-*.test.ts` | 32/32 PASS |
| Workspace Home & Agent 回归 | `node --test tests/workspace-home*.test.ts tests/case-agent-entry-ui.test.ts tests/case-decision-client.test.ts tests/case-decision-routes.test.ts tests/case-decision-runtime.test.ts tests/case-relations-agent.test.ts ...` | 47/47 PASS |
| 实际产品浏览器（Headless Chrome CDP） | `node tests/browser-decision-case-daily.mjs` | PASS（1440 / 1024 / 390、首页待处理、XSS 转义 `window.__xss===false`、树状图多前驱汇入、范围切换、Decision Case 总览/全部项目） |
| 冻结原型校验 | `node openspec/changes/decision-case-daily-workspace/verification/check-demo.mjs` | 27/27 PASS，SHA-256 不变 |

## 非作者独立复核与处理记录（T15）

独立只读复核子代理检出 2 项 HIGH 缺陷与 5 项 MEDIUM/LOW 差距，已处理如下：
1. **[已修 HIGH]** `server.ts` `adoptGoal` 原传 `version/strategyChoice`，改为 `StrategyGoalsStore.adopt` 实际契约 `{ operationId, expectedVersion, decision }`，并新增真实 HTTP 回归 `DW-HTTP-03` 验证通过。
2. **[已修 HIGH]** `workspace-daily-routes.ts` 观察目标读取异常时原返回 `[]`（误判为 `open`），已改为 `undefined` 使 `requestStatus` 诚实返回 `unverifiable`。
3. **[已修 MEDIUM]** `CaseBoard.tsx` `auxScope` 已实际过滤事项任务与关联产物，并在重挂载同一 `activeIssueId` 时保留用户手选范围。
4. **[已修 MEDIUM]** `HomeDailyQuickPanel.tsx` 重新保存准备草稿时保留既有 `adoptOperationId`、`createOperationId`、`adoptionReceipt`、`creationState`，不再清零。
5. **[已修 MEDIUM]** `CaseIssueTreeSidebar.tsx` 不再吞掉 403/503 错误为空数组，直接清空失权数据并展示错误提示。
6. **[已修 LOW]** `CaseIssuePanel.tsx` 追加片段后立即刷新片段按钮状态。

## 诚实未测与剩余边界（不隐去）

- **全量 `npm run test`（565+ 测试文件）**：本机未跑完 565 文件全集，已跑 143 项相关核心与回归测试全部通过，留待 GitHub Actions CI 对准确 head 执行全量回归。
- **真实 Pi 1.4.0 + 隔离合成 Provider 运行时工具调用回环**：已核验 `check:agent-sessions`、工具 schema 与 Host handler 接线，尚未在真实 Pi 子进程里驱动合成 Provider 端到端调用 `case-directory` / `save_case_issue_edge` / `save_case_decision_request`；且 `{role:'case', caseId, itemId}` 对话域尚未镜像 `project-session.ts` 中的两条声明工具（前端侧栏声明入口与 `project-session` 均可用）。
- **UI 层直连三分支创建与部分成功恢复按钮**：后端 `POST /api/workspace/create-case`（含真实采纳、继续、部分成功与幂等重试）已通过单元与真实 HTTP 回归；`HomeDailyQuickPanel.tsx` 中部分成功提示尚未挂载一键重试按钮，也未直接在首页内嵌 `goal-draft` Agent 会话面板（保留人工入口与既有目标/Case 面板）。
- **浏览器测试深度**：`tests/browser-decision-case-daily.mjs` 已实测 1440/1024/390、待处理深链、XSS、树状图多前驱、范围条和一级 Tab；尚未在浏览器中自动化覆盖深浅主题切换、403/503 模拟态和全键盘焦点遍历。
- **兼容性与回退**：全部新增数据为 append-only Case 事件、惰性可选列 `responds_to_request_json` 与独立 `workspace-drafts/` 目录，无破坏性 schema 迁移；回退本分支提交即可恢复既有行为，原有 Case/项目/任务/原生历史零损。

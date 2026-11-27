# 非作者独立只读复审报告（Issue #149 / FR08 / T15）

- **复审对象（固定提交）**：`54520672b6acd36420123b9e60af6f8fefc0da80`（分支 `work/antigravity/issue-149-decision-case-daily-workspace`）
- **对照基线**：`699e425cb0900b50385377d638495069fa726761`（`origin/main`）
- **对照首审候选**：`fd0003e6441e75f9e7daae88e09f3a0411227f04`
- **复审方式**：独立非作者、纯只读核查实际代码与 `git diff`（未改工作区、未写文件）
- **复审结论**：**PASS（首审 FR01–FR08 全部实质修复到位，准予推送并进入 GitHub Actions 全量 CI 门禁）**

---

## 一、首审返工项 FR01–FR07 逐项核实结果

| 返工项 | 核查结论 | 代码与测试依据 |
| --- | --- | --- |
| **FR01** 目标/策略/采纳真实准入 | **PASS** | `src/host/server.ts` 为 `/api/workspace/create-case` 注入真实 `readGoal`（调用 `strategyGoals.read` + `validateStrategyGoal`），`adoptGoal` 校验策略属于该版 `strategies`，`createCase` 复用 `caseRoutes` 的 `POST /api/cases` 准入链；`src/host/case-creation-orchestrator.ts` 不再盲信客户端 `alreadyAdopted`，强制校验真实 `status === 'adopted'` 与策略成员资格。`tests/fr01-03-05-repro.test.ts`（`FR01-REPRO`）已覆盖候选目标伪报 `alreadyAdopted:true`→409、不存在目标版本→404、虚构策略→400。 |
| **FR02** 恢复意图、回放指纹、原子 CAS 与跨 owner 防护 | **PASS** | `src/host/case-creation-orchestrator.ts` 在已有部分 `adoptionReceipt` 但目标 `(goalId, version, strategy)` 变更时拒绝 `409 prepare_draft_goal_mismatch`（绝不静默绑定旧目标）；`createOperationId` 回放前严核 `kind === 'case_create' && phase === 'completed'` 及 `title`/`description`/`goalBinding` 全指纹，否则拒 `409 operation_conflict`。`src/host/workspace-draft-store.ts` 引入进程级按路径互斥锁 `withPathLock` 串行化 `read → CAS → atomic rename`，并在 `appendCarryOverFragment` 中按字典序加双锁、严核 `targetCaseId`/`targetIssueId` 与草稿归属一致（跨 owner 拒 `409 carry_over_scope_mismatch`）。`FR02-REPRO` 全覆盖。 |
| **FR03** Decision Board schema v6 正式迁移与真实授权校验 | **PASS** | `extensions/business-plugins/decision-board/storage/store.ts` 正式定义 `REQUEST_RESPONSE_SCHEMA`（`ALTER TABLE feedback_revisions ADD COLUMN responds_to_request_json TEXT; PRAGMA user_version=6;`），`init()` 接受版本 `0..6` 并经 `validateSchema(db, 6)` 比对完整 schema 清单，`saveFeedback` 在事务内按序从 v4/v5 升至 v6（保存后关闭重开无错）。`src/host/case-store.ts` 与 `src/host/case-decision-types.ts` 补齐 `caseStoreId` 与非空 `source.ref` 校验；`src/host/case-issues.ts` 与 `src/host/workspace-daily-routes.ts` 对 `observe` 请求创建与读取均严核已关联项目、Board task/item 归属、Case 关联授权及 `authorityAtFeedback`。`FR03-REPRO` 与更新后的 `DW08/DW09-REQ-02` 已覆盖。 |
| **FR04** 移除启发式队列、展示未解请求与取舍回传 | **PASS** | `src/host/ui/WorkspaceHome.tsx` 已移除旧启发式标题与 `aria-label`“需要你处理”（改为“近期动态与待推进项（非明确请求）”）；`src/host/ui/HomeDailyQuickPanel.tsx` 显式渲染 `unresolvedRequests`（“已替代 / 待核请求”）；`src/host/ui/CaseIssuePanel.tsx` 确认取舍时匹配当前打开的 `choose` 请求并在提交 `saveCaseStrategyChoice` 时携带 `respondsToRequest: { requestId, revision }`。 |
| **FR05** `{role:'case'}` 窄工具、`mutate` 内 `assertWritable` 与真实 Pi 1.4.0 回环 | **PASS** | `src/agent/strategy-discussion.ts` 新增 `caseDeclarationsTool`（仅含 `case-save-issue-edge`、`case-save-decision-request`），经 `src/agent/project-runtime.ts`、`src/agent/project-session.ts`、`src/host/strategy-discussion-host.ts` 与 `src/host/server.ts` 接入 `{role:'case', caseId, itemId}` owner；`caseId`/`itemId` 与 `sessionId/requestId/toolCallId` 来源由 Host 绑定；`assertWritable` 校验 `assertCurrent()`、`signal.throwIfAborted()` 与 `isClosing()`，并在 `case-issues.ts` / `case-store.ts` 的 `deps.mutate` / `this.operation` 提交前执行。`FR05-R3-REPRO` 验证排队取消零落盘；`tests/workspace-daily-pi-loop.test.ts`（`DW-PI-LOOP-01`）真实打通 Host → 官方 Pi 1.4.0 → 隔离合成 HTTP Provider 双 owner 工具回环。 |
| **FR06** 轻输入自动保全、显式事项选择器、可选整理 Agent、三分支创建与带入 composer | **PASS** | `src/host/ui/HomeDailyQuickPanel.tsx` 实现 400ms 防抖自动保存、`onBlur` 与导航前 `flushBeforeNav`；带入片段前强制经 `<select>` 显式选择目标事项（不再静默落首事项）；提供用户主动开启的可选 `{role:'goal-draft', draftId, scope}` Agent 面板；统一三分支准备表单及部分成功草稿“核对原操作并继续创建”直连 `POST /api/workspace/create-case`。`src/host/ui/BusinessRoleConversation.tsx` 与 `CaseIssuePanel.tsx` 通过 `externalAppend` 将片段追加到可发送的真实对话 composer 且不覆盖非空既有草稿。 |
| **FR07** 跨页签保留事项与范围、按事项筛选、防无 `taskId` 泄漏、常驻 G/S 与三段摘要 | **PASS** | `src/host/ui/CaseBoard.tsx` 与 `CaseIssuePanel.tsx` 使用受控 `selectedIssueId={activeIssueId}` 跨 Tab 保留当前事项与手选 `auxScope`；`projects` 与 `artifacts` 两辅助页均提供“按事项筛选”下拉框并按 `auxScope.issueId` 实际过滤；`artifacts` 页事项范围强制 `Boolean(artifact.taskId)` 杜绝无 `taskId` 资料泄漏；四页签上方常驻 `目标 / 策略（G/S）` 栏；概览页展示 `已明确 / 正在推进 / 接下来` 三段本轮摘要。 |

---

## 二、四点产品原则与 IN01–IN07 合规核查

- **四点产品原则**：
  - **Host 管环境**：目标/策略/授权准入、CAS 草稿存储、取消门禁与来源绑定均在 Host 层强制执行。
  - **Agent 自主执行**：`goal-draft` 与 `{role:'case'}` 均通过既有 Pi 会话体系自主调用窄声明工具，无自建推理循环；手工路径零模型依赖。
  - **优先复用 Pi 已有能力**：复用既有 `BusinessRoleConversation`、`strategy-discussion-host` 与官方 Pi 1.4.0 原生工具执行链。
  - **减少人的操作**：轻输入自动持久化不丢字、常驻 G/S 与三段摘要减少跳转、取舍表单自动匹配并携带打开的明确请求。
- **IN01–IN07 与保护文件边界**：
  - 核查 `699e425cb0900b50385377d638495069fa726761..54520672b6acd36420123b9e60af6f8fefc0da80` 全量变更文件清单：**零修改**官方 Pi 1.4.0 SDK、`package.json`、锁文件、`session-interface.ts`、`session-manager.ts`。
  - 冻结原型 `openspec/changes/decision-case-daily-workspace/demo.html` 自导入提交 `27f6b49` 以来**零改动**，SHA-256 核实为 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`（与确认包一致）。

---

## 三、诚实剩余边界与非阻塞观察

1. **跨 Case 切换时的 `auxScope` 重置（轻微 UI 细节，非阻塞）**：在 `src/host/ui/CaseBoard.tsx` 中，单 Case 内跨 Tab 切换可完整保留 `activeIssueId` 与手选 `auxScope`；若用户在同一 `CaseBoard` 实例内手动设置 `auxScope` 后直接切换到另一个 Case，`auxScope.manual` 与旧 `issueId` 不会随 `detail.case.id` 自动复位，后续迭代可在切换 Case 时顺手清零。
2. **看板独立反馈弹窗尚未自动回填 `observe` 请求**：后端 `DecisionBoardStore.saveFeedback`（schema v6）与 HTTP 路由已支持 `respondsToRequest` 并经单测实证；独立看板反馈弹窗 UI 尚未自动预填打开的 `observe` 请求上下文（已在 `implementation.md` 诚实披露）。
3. **全量 CI 与浏览器深测范围**：本次为只读代码与 diff 复审，`implementation.md` 记录的 21/21 DW+FR 回归、32/32 Board 回归、浏览器 CDP 与 `check-demo.mjs` 结果仍需由 GitHub Actions CI 对最终推送 head 执行全量 565+ 测试集确认；深浅主题切换、403/503 模拟态与全键盘焦点遍历尚未纳入浏览器自动化脚本（已在 `implementation.md` 诚实披露）。

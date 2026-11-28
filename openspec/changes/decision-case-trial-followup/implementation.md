# Issue #154 实施与验证记录（Decision Case 试用修正）

- **Issue**：[#154：Decision Case 试用修正](https://github.com/gadfly-hbo/OptraCall/issues/154)
- **任务分支**：`work/antigravity/issue-154-decision-case-trial-followup`
- **基线提交**：`main` `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd` + 规格合并 `a4720eb2f5ce71d9d034de087264d996e17873c2`（`openspec/changes/decision-case-trial-followup/{spec.md,tasks.md,result.md}`）
- **领取与阶段回执**：[领取回执](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7235350681) · [T01 阅读与盘点回执](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7235447476) · [PM 首审退回（d674dea）](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7237996090) · [单次返工重领](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7238036165)
- **依据规范**：`docs/engineering-workflow.md` v1.17、`docs/agent-session-integration.md` Interface v3、官方 `@earendil-works/pi-coding-agent` `1.4.0`（未修改源码/锁文件）、冻结 Demo `openspec/changes/decision-case-daily-workspace/demo.html`（SHA-256 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`）

---

## 1. T01 冻结 Demo 阅读、DOM/CSS 骨架映射与 IN01–IN07 盘点

编码前使用真实 Chromium 渲染并实际查看了冻结 `demo.html` 与运行态产品各视口（1440 / 1024 / 390，明暗主题）及 `.local/issue-154/demo-read/` 与 `.local/issue-154/product-verify/` 对照截图，确认以下基线：

1. **视觉与交互骨架映射**：
   - 工作台首页 / 轻量准备页（`WorkspaceHome.tsx` / `CasePreparation.tsx`）：保持浅紫/深紫主题卡片层级、保留输入块、三分支目标创建/继续表单，只在 `CasePreparation.tsx` 内修正确定性前置字段校验、焦点定位与动作提示一致性（CF05），并在创建与首事项确认成功后触发 `onCaseChanged` 通知已挂载的总览失效重读（CF06）。
   - Case 总览与四标签页详情（`CaseBoard.tsx` / `CaseIssuePanel.tsx`）：保留左导航 + 星图/卡片切换、右侧当前事项 + G/S 常驻 + 四标签页（当前工作/项目与任务/成果与依据/历史）+ 右侧对话区（`BusinessRoleConversation.tsx`）；仅在“记录本轮取舍”弹窗中于无 `strategy` 方案时增加缺失说明与“去关联或新建项目” / “去准备 Plan Task” / “查看交接与依据”原路径引导，绝不将 `goalBinding.strategy` 复制为方案（CF03）。
   - 全部项目与侧栏操作（`ProjectNavigation.tsx` / `ProjectBoard.tsx`）：保留菜单触发器与动作按钮形态和视觉文案，在 `aria-label` 中补充项目名称区分（CF07）。
2. **IN01–IN07 / 观察与恢复契约盘点**：
   - `BusinessRoleConversation.tsx` 与 `strategy-discussion-client.ts`：遵循统一会话观察流契约，仅在准确 `owner` 上对 clean EOF / 漏终态触发有界只读 GET 回读（`[500, 1500, 3000]ms`），不调用 `stop`/`open`/重发，不跨越 owner 或卸载泄漏定时器（CF01）。
   - `runtime-client.ts` / `server.ts`：沿现有任务事件流增加 `firstFrameTimeoutMs`（默认 `15000ms`），即使心跳持续，无同 `owner` 有效首帧即退出无解释等待并展示安全分类错误（`SAFE_STREAM_CATEGORIES`），保持 GET idle 不解除 `connected` 发送门禁（CF02）。
   - `strategy-discussion.ts` / `project-session.ts` / `strategy-discussion-host.ts`：沿 Interface v3 既有 `strategy_goals`（`caseDeclarationsTool`）明确拆出 `choose`/`observe` 联合 `target` schema 及字段级诊断 `diagnoseCaseDecisionRequestError`（`exposure: 'safe-tool-error-v1'`、`details.issues`），保持原授权与存储错误码权威（CF04）。

---

## 2. CF01–CF07 逐项实施与可追溯矩阵

| 条目 | 实际改动文件与关键实现 | 永久回归与真实路径证据 | 边界与未更改项 |
| --- | --- | --- | --- |
| **CF01** | `src/host/server.ts`：任务/讨论流心跳；`src/host/ui/strategy-discussion-client.ts`：新增 `idleTimeoutMs` 与规范化 EOF/空闲识别；`src/host/ui/BusinessRoleConversation.tsx`：记录 `streamEndedRef`/`streamSeq`，clean EOF / 漏终态触发有界 `[500, 1500, 3000]ms` 只读 GET 恢复，切 owner/卸载清理。 | `tests/case-trial-followup-fixes.test.ts`（EOF 恢复、thinking/tool 过程、切 owner 取消、第三消费边界）；`tests/browser-case-trial-followup.mjs`（`CF01+CF04` 真实 Host + Pi 1.4.0 + Chromium 受控 clean EOF 自动恢复全文/终态）；`tests/agent-sessions.test.ts` | 不自动 `stop`/`open`/重发；不改取消/取消态与其它 owner 协议。 |
| **CF02** | `src/host/server.ts`：分类 `stream.error` `{ code, category, message }`；`src/host/ui/runtime-client.ts`：独立 `firstFrameTimeoutMs`（默认 `15000ms`）不因心跳注释重置、`SAFE_STREAM_CATEGORIES` 脱敏错误、`connected` 仅由真实合法首帧确认。 | `tests/case-trial-followup-fixes.test.ts`（心跳无首帧超时脱敏、故障类别区分、显式重连恢复发送与草稿）；`tests/browser-case-trial-followup.mjs`（`CF02` Plan Task 首发完成 + 受控缺失首帧安全恢复与原草稿保留） | 不解除 `connected` 门禁；不提前创建 native；不宣称已定位 Mac 自然诱因。 |
| **CF03** | `src/host/ui/CaseBoard.tsx`：向 `CaseIssuePanel` 透传 `onLinkProject`；`src/host/ui/CaseIssuePanel.tsx`：无可选 `strategyRef` 时于“记录本轮取舍”弹窗展示准确前置条件，未关联项目引向“去关联或新建项目”，已关联引向“去准备 Plan Task”与“查看交接与依据（交回 Plan 原回复）”，全程保留理由/下一步草稿。 | `tests/case-trial-followup-fixes.test.ts`；`tests/browser-case-trial-followup.mjs`（`CF03` 实跑未关联→关联项目→Plan Task 创建/回复→交回方案→记录取舍→第1轮历史呈现与草稿保留） | 绝不复制 `goalBinding.strategy`；不伪造方案或扩张 CaseAgent 写方案权限。 |
| **CF04** | `src/agent/strategy-discussion.ts`：`Type.Union([caseChooseTargetSchema, caseObserveTargetSchema])` + `explainCaseDeclarationError` 涵盖 schema 与域错误码；`src/agent/project-session.ts`：传递诊断器；`src/host/strategy-discussion-host.ts`：导出 `diagnoseCaseDecisionRequestError` 输出 `exposure: 'safe-tool-error-v1'` 及 `details.issues: [{ path, reason }]`。 | `tests/case-trial-followup-fixes.test.ts`（schema 拒绝定位、合法 choose/observe、错事项/旧基线/缺授权拒绝）；`tests/browser-case-trial-followup.mjs`（`CF01+CF04` 真实 Pi 1.4.0 根据工具字段错误自主纠错后保存取舍请求 rev1，共 3 步 2 步失败） | 不新增请求存储权威；不放宽授权/CAS/分页；不泄露内部路径。 |
| **CF05** | `src/host/ui/CasePreparation.tsx`：提交前确定性校验区分未选 `scope` 与已选 `personal` 但个人归属名为空，定位/聚焦缺失字段；区分确定 4xx 与 `stillPending`，仅 `stillPending` 渲染“核对原操作并继续”，并将草稿错误按钮“重试保存”正名为“保存当前草稿”（仅 `snapshot?.dirty` 显示）。 | `tests/case-preparation-ui.test.ts`（同步为精确字段提示与非 `stillPending` 断言）+ `tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs`（`CF05` 空个人名称拦截、聚焦缺失项、零写入 POST） | 不提前写目标或建 Case；不丢失/重放部分成功或 UNKNOWN 回执。 |
| **CF06** | `src/host/ui/CaseBoard.tsx`：新增 `refreshSeq`；`src/host/ui/App.tsx`：维护 `caseBoardRefreshSeq` 并在 `CasePreparation.onCaseChanged` 时同步递增 `homeRefreshToken` 与 `caseBoardRefreshSeq`；`src/host/ui/CasePreparation.tsx`：建案成功及首事项补建确认后回调 `onCaseChanged?.()`。 | `tests/case-trial-followup-fixes.test.ts`（创建/继续分支刷新信号、失败保留旧快照标注与筛选草稿）；`tests/browser-case-trial-followup.mjs`（`CF06` 创建第 3 个 Case 后直接“返回工作台·保留草稿”，无需手动刷新即见全部 3 个 Case） | 纯继续不重复建案；列表读取失败保持旧快照告警不伪造最新。 |
| **CF07** | `src/host/ui/ProjectNavigation.tsx`：侧栏项目操作按钮增加 `aria-label={\`${action} ${project.name}\`}` 保留原显示文字；`src/host/ui/ProjectBoard.tsx`：详情顶部归档/恢复按钮同步包含 `selected.name` 的 `aria-label`；同步更新 `tests/browser-project-tasks.js`、`tests/browser-zero-task-project-files.mjs`、`tests/browser-project-data-context-review-fixes.js` 对应 AX 定位器。 | `tests/case-trial-followup-fixes.test.ts`；`tests/browser-case-trial-followup.mjs`（`CF07` 同名两个项目仅归档目标项目，原项目活跃状态与 Case 不变） | 不更改共享 `> 1` 阈值；不更改原有 ID/空闲准入/只读与焦点规则。 |

---

## 3. 四点产品原则专项检查

1. **Host 管环境**：Host 仅承担 SSE 心跳/分类报错（`server.ts`）、有界只读回读与首帧期限监控（`runtime-client.ts`/`BusinessRoleConversation.tsx`）、参数校验与安全错误投影（`diagnoseCaseDecisionRequestError`），不代写业务方案、不复制 `goalBinding.strategy`、不越权修改存储。
2. **Agent 自主执行**：CF04 测试中真实 Pi 1.4.0 根据工具返回的字段级错误提示自行修正第 3 次工具参数调用并成功保存请求（3 步 2 步失败），Host 未硬编码重放或固定推理步骤。
3. **优先复用 Pi 已有能力**：继续复用 `AgentSessionPort` / Interface v3、`strategy_goals`（`caseDeclarationsTool`）既有工具机制、原生 `sessionFile` 历史及 `CaseStore`/`WorkspaceDraftStore`，未新增第二套 Runtime 或请求完成库；`pi-coding-agent` `1.4.0` 与 `package-lock.json` 原样保留。
4. **减少人的操作**：CF03 缺方案时直接在弹窗内说明前置条件并提供到准确项目关联或 Plan Task 的直达入口同时保留理由草稿；CF05 精准聚焦错误字段避免泛化误导；CF06 创建后自动刷新总览无需手动点击刷新；CF07 在不增加日常确认弹窗的前提下消除同名项目歧义。

---

## 4. 验证范围与真实结果

> 本地环境：Ubuntu 24.04 Linux、Node.js v25.9.0、官方 `@earendil-works/pi-coding-agent` 1.4.0、Headless Chromium（本地隔离合成 Provider 与合成数据，未调用真实付费模型，未访问用户 MacBook）。

| 验证项 | 命令与覆盖范围 | 结果 | 说明与保留边界 |
| --- | --- | --- | --- |
| Agent 会话边界与 SDK 完整检查 | `npm run check:agent-sessions` | **PASS** | Interface v3 边界通过；官方归档离线校验按脚本原样单列。 |
| TypeScript + 前端构建 + Build Stamp | `npm run build`（`tsc --noEmit && frontend build && stamp-build`） | **PASS** | `Trial build: 0.1.0-mvp.4 a4720eb+local-changes` |
| 依赖安全审计 | `npm audit --audit-level=high` | **PASS** | exit 0；仅 2 项 moderate（`minimatch` via `@earendil-works/pi-coding-agent <=1.4.0`），零 high/critical。 |
| 目标与回归单测 | `npx tsx --test tests/case-trial-followup-fixes.test.ts` + `node --test tests/case-preparation-ui.test.ts` | **PASS** | `case-trial-followup-fixes.test.ts` 7/7 + 相关 UI 回归全部通过。 |
| 全量 `tests/*.test.ts`（524 文件） | 按排序分 10 批（`--test-concurrency=2/3`）运行全部 524 个测试文件 + 单跑并发超时用例 | **PASS（524 文件全覆盖，3502 pass / 0 fail）** | 因 2 vCPU 机器 600s 命令时限，按文件排序分 10 批完整实跑：<br>• `0..44`: 382 pass, 0 fail, 53 skip<br>• `45..94`: 346 pass, 0 fail, 4 skip<br>• `95..169`: 438 pass, 0 fail, 43 skip<br>• `170..214`: 343 pass, 0 fail, 12 skip<br>• `215..259`: 344 pass, 0 fail, 2 skip<br>• `260..309`（`--test-concurrency=3`）: 319 pass, 0 fail, 27 skip, 1 cancelled（`tests/protected-file-process.test.ts` 20s 并发超时）；随后独立重跑 `node --test tests/protected-file-process.test.ts` **7/7 PASS**（21.8s）<br>• `310..364`: 422 pass, 0 fail, 26 skip<br>• `365..417`: 237 pass, 0 fail, 0 skip<br>• `418..470`: 328 pass, 0 fail, 19 skip<br>• `471..523`: 336 pass, 0 fail, 11 skip<br>Linux 环境原件保护 / 外部工具 `# SKIP` / `NOT_RUN`（195 项）原样保留不跳过掩盖。 |
| Issue #154 端到端浏览器验证 + 视觉对照 | `node tests/browser-case-trial-followup.mjs`（真实 Host + Pi 1.4.0 + Chromium） | **PASS** | `CF05`, `CF06`, `CF02`, `CF03`, `CF01+CF04`, `CF07` 全部通过（`providerRequests: 5`，`pageErrors: []`）；11 张实际产品截图与冻结 Demo 对照完成（1440/1024/390 明暗主题，无裁切重叠）。 |
| 既有历史浏览器回归脚本实跑与停顿点（诚实保留） | `browser-decision-case-daily.mjs`、`browser-v13-role-recovery.mjs`、`browser-zero-task-project-files.mjs`、`browser-project-tasks.js` | **FAIL（基线已存在文本/状态漂移）** | 1. `browser-decision-case-daily.mjs` 等候旧文 `待处理事项（1）` 超时（PR #152 `HomeDailyQuickPanel.tsx:44` 已改为带独立 `<span>` 的 `待处理事项 1`）。<br>2. `browser-v13-role-recovery.mjs` 找不到旧入口 `与目标管理 Agent 讨论`。<br>3. `browser-project-tasks.js` 找不到旧侧栏按钮 `模型设置`（PR #152 已改为 `设置`）。<br>4. `browser-zero-task-project-files.mjs:89` 在 `assertDrawer(desktop, false)` 处断言 `'收起项目文件' !== '展开项目文件'`；与本单改动（仅线 142 按钮 AX 名称）无直接调用冲突，保留事实不弱化断言。 |
| 独立非作者复核（首轮历史证据，原样保留） | 只读 `research` 子代理（会话 `5b9c9b174527f5a87eb984ab793296e7`）对首版候选 `d674dea` 给出 `CONDITIONAL_PASS` | **已被 PM 首审 FAIL 推翻（历史保留，不沿用）** | 首轮 PM 复核（`codex/issue154-first-review` `a85ae9b`，[Issue #154 退回意见](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7237996090)）实测复现出 **P1 缺陷（FR01）** 与 **P2 覆盖不足（FR02）**，首版 `CONDITIONAL_PASS` 结论明确失效，完整保留失败证据，不追溯改写为通过。 |

---

## 5. 首审退回与单次返工记录（FR01–FR02，二次重领 `#issuecomment-7238036165`）

> 依据 [PM 首审退回意见](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7237996090)（基准提交 `d674deaa6c80e254bf97e2c4e022d3642f486eb1`，PM 复核提交 `a85ae9b74bd985e93af00f51dccfeab27d1e4b06`）执行唯一一次允许返工：

1. **FR01（P1）持续心跳但遗漏终态时 `Case Agent` 卡在 `正在回复…`**：
   - **根因**：`strategy-discussion-client.ts` 的 `idleTimeoutMs` 对任意原始字节块（含 `: heartbeat\n\n` 注释）重置，且 `while` 读循环自然结束时未校验 `timedOut && !signal.aborted`；同时 `BusinessRoleConversation.tsx` 仅在收到 `run.settled`/空闲 `snapshot` 或 SSE 退出时才执行 `load()`，当 SSE 持续发送心跳注释但遗漏 `run.settled`/空闲 `snapshot` 时，`inFlight` 长期停留在 `true`。
   - **修复实现**：
     - `src/host/ui/strategy-discussion-client.ts`：新增 `eventIdleTimeoutMs?: number` 与 `shouldExpectEvents?: () => boolean`；仅在收到非空 `data:` 事件块时刷新 `touchEvents()`，`: heartbeat\n\n` 注释不重置事件超时；超期且 `shouldExpectEvents()` 为真时抛出 `strategy_discussion_events_timeout`；读循环退出后补充检查 `if (timedOut && !signal.aborted)`。
     - `src/host/ui/BusinessRoleConversation.tsx`：新增 `isRoleRunUnresolved`、`eventEpochRef` 与 `inFlightRef`；`load()` 观察到 `!next.busy` 时通过 `setStream('')` 清空残余流式文本缓冲同时保持 SSE 长连接不频繁重连；流订阅传入 `{ idleTimeoutMs: 45000, eventIdleTimeoutMs: 45000, shouldExpectEvents: () => inFlightRef.current }`，当 `strategy_discussion_events_timeout` 发生且 Host `GET` 确认 `next?.busy === true` 时重置 `attempt = -1` 继续观察运行中任务；另设 `[id, inFlight, load]` 有界只读 `GET` 对账 `useEffect`（首次静默窗 `3500ms`，GET 失败或未明状态按 `[500, 1500, 3000]ms` 退避，确认 `next.busy === true` 时重置连续 GET 失败计数不误报停止，并在切换 owner/卸载时中止定时器与请求；绝不自动 `stop`/`open`/`messages`、不借用别轮终态、不自建第二完成权威）。
   - **永久回归**：`tests/case-trial-followup-fixes.test.ts` 新增 `FR01` 单测（心跳不重置 `eventIdleTimeoutMs`、慢响应连续 2 轮 `3500ms` 保持运行中不误取消、遗漏终态自动从 GET 完成并关闭流、连续 4 次 503 GET 有界失败回落）；`tests/browser-case-trial-followup.mjs` 新增 `FR01` 真实 Host + Pi 1.4.0 + Chromium 端到端场景（真实复现 3 秒延迟完成后，开流持续发送 200ms 心跳 19 次且丢弃终态事件，界面自动恢复 `'FR01 持续心跳漏终态已自动读回完成。'`，`正在回复…` 归零，零 replay/stop，截图保存至 `.local/issue-154/product-verify/05b-fr01-heartbeat-recovered-1440.png`）。
2. **FR02（P2）回归覆盖补齐**：
   - **CF02 显式重连正向全路径**：`tests/case-trial-followup-fixes.test.ts` 补齐流退避耗尽进入 `disconnected` 后保持禁用发送 → 点击显式重连收到合法 `snapshot` 恢复发送且保留原草稿、零写调用；`tests/browser-case-trial-followup.mjs` 将 `CF02` 升级为真实 app/Host/Chromium 全链路（持续 200ms 心跳触发 `firstFrameTimeoutMs` → `等待任务首帧超时` → 耗尽进 `disconnected` 禁用发送且保留草稿、0 次 `open`/`messages`/`stop` → 点击 `重新连接任务` → 恢复 `任务和历史已保存在本机` 且草稿保留 → 通过 Pi 1.4.0 成功发送 `CF02 显式重连后首发完成。`）。
   - **CF03 Plan 交回 → 取舍 → 原授权/反馈/历史入口回归**：`tests/browser-case-trial-followup.mjs` 在 `CF03` 保存取舍后实操串联 `授权本次行动`（`确认授权并进入看板`）→ `回录反馈`（`保存反馈`）→ `查看本轮原记录` → `查看准确方案原回复` → `查看原看板反馈` → `已保存反馈历史` 弹窗与 `Escape` 关闭并返回原 Case 详情。

### 返工后完整验证结果（当前新候选）

> 全部校验均在清除 `node_modules/playwright` 临时软链、保留官方 Pi `1.4.0` 与冻结 `demo.html` 不变条件下执行。

| 验证项 | 命令与覆盖范围 | 结果 | 说明与保留边界 |
| --- | --- | --- | --- |
| Agent 会话边界与 SDK 完整检查 | `npm run check:agent-sessions` | **PASS** | Interface v3 边界通过；官方归档离线校验按脚本原样单列。 |
| TypeScript + 前端构建 + Build Stamp | `npm run build` | **PASS** | `Trial build: 0.1.0-mvp.4 d674dea+local-changes`（提交前构建产物标记，提交后核对 SHA）。 |
| 依赖安全审计 | `npm audit --audit-level=high` | **PASS** | exit 0；仅 2 项 moderate（`minimatch` via `@earendil-works/pi-coding-agent <=1.4.0`），零 high/critical。 |
| FR01–FR02 + CF01–CF07 定向单测 | `npm run typecheck && node --test tests/case-trial-followup-fixes.test.ts` | **PASS** | **8/8 PASS**（含新增 `FR01` 心跳漏终态恢复/有界 GET 退避与 `CF02` 耗尽显式重连）。 |
| 全量 `tests/*.test.ts`（清洁去重 524 文件） | 按文件排序 `--test-concurrency=2` 实跑全部 10 批（`runs = 10` 批，`deduped files = 524`，`0` 重跑特例） | **PASS（524 文件全覆盖，3694 tests：3497 pass / 0 fail / 0 cancelled / 197 skip）** | 各批逐一实跑记录：<br>• `0..44`（45 文件）：435 tests，382 pass，0 fail，0 cancelled，53 skip（350.99s）<br>• `45..94`（50 文件）：351 tests，347 pass，0 fail，0 cancelled，4 skip（258.96s）<br>• `95..169`（75 文件）：481 tests，438 pass，0 fail，0 cancelled，43 skip（329.32s）<br>• `170..214`（45 文件）：355 tests，343 pass，0 fail，0 cancelled，12 skip（387.70s）<br>• `215..259`（45 文件）：346 tests，344 pass，0 fail，0 cancelled，2 skip（410.99s）<br>• `260..309`（50 文件）：347 tests，320 pass，0 fail，0 cancelled，27 skip（337.41s）<br>• `310..364`（55 文件）：448 tests，422 pass，0 fail，0 cancelled，26 skip（246.89s）<br>• `365..417`（53 文件）：237 tests，237 pass，0 fail，0 cancelled，0 skip（419.19s）<br>• `418..470`（53 文件）：347 tests，328 pass，0 fail，0 cancelled，19 skip（206.58s）<br>• `471..523`（53 文件）：347 tests，336 pass，0 fail，0 cancelled，11 skip（462.60s）<br>Linux 原件保护/外部工具 `# SKIP` / `NOT_RUN`（197 项）原样保留。 |
| Issue #154 端到端浏览器验证 + 新版截图 | `node tests/browser-case-trial-followup.mjs`（真实 Host + Pi 1.4.0 + Chromium） | **PASS** | `CF05`, `CF06`, `CF02`（含首帧超时耗尽 + 显式重连恢复发送）, `CF03`（含授权/反馈/原记录/原看板反馈/反馈历史）, `CF01+CF04`, `FR01`（19 次心跳开流自动恢复完成）, `CF07` 全部 7 项通过（`providerRequests: 7`，`pageErrors: []`）；新增截图 `05b-fr01-heartbeat-recovered-1440.png` 及全套 12 张实际截图人工逐张核验无裁切重叠。 |
| 既有历史浏览器回归脚本（保留） | `browser-decision-case-daily.mjs`、`browser-v13-role-recovery.mjs`、`browser-zero-task-project-files.mjs`、`browser-project-tasks.js` | **FAIL（基线已有漂移，未修改）** | 与首轮一致，保留四项基线文本/状态漂移事实，未弱化断言。 |
| 第二轮全新独立非作者复核（T09） | 全新只读 `research` 子代理（会话 `1c9c303711cf8d2eb3193c3e1d12a38c`，未沿用首轮结论）逐项核对三基线、`git diff`、四原则、IN01–IN07 及 12 张截图，详见 [second-review.md](verification/second-review.md) | **PASS（工程与试用候选二审通过；0 项阻塞缺陷）** | 独立实跑 `check:agent-sessions`、`typecheck` 与 50/50 核心单测均通过；FR01/FR02/CF01–CF07 完整三基线可追溯矩阵均 PASS；交付仍保留 **T10 开 PR 前截图确认门禁** 与 **Mac 实机/真实 GLM 模型未验证边界**。 |

---

## 6. 兼容与回退边界

- 无任何数据库 schema 升级或存储路径迁移；CF01–CF07 及 FR01–FR02 返工完全沿原持久化表结构、事件协议与 `CaseStore`/`WorkspaceDraftStore` 契约工作，可直接回退至基线 `7403091` 而不损失已有项目、任务或 Case 数据。
- 本次测试仍在 Ubuntu 24.04 Linux + 本地合成 Provider + 合成数据完成；**Mac mini / MacBook 实机体验环境及真实 GLM 模型实跑未在本机验证**，继续保留该未核边界。
- `node_modules/` 与 `.local/issue-154/` 均属隔离本地验证产物（且 `node_modules/playwright` 临时全局软链已在构建/检查前清理），未写入 `package.json` 或 `package-lock.json`。
- 遵循工程规范：本阶段仅推送新候选至任务分支并交回 PM 二审；在 PM 二审通过、向用户展示新候选真实产品截图并取得明确确认前，**不创建 PR（含 draft），不合并 `main`**。

## 7. PM 二审接修与本轮截图候选（2026-11-28）

PM 从 origin 接收 `3c2fb5f477297f89d0076dd62286ba7318bb8da0`，按二审终审规则直接补齐状态GET正文期限、过期读取错误丢弃、事项卸载后迟到导航抑制、首事项确认后的总览再次失效；未第三次退回。原首审FAIL、e72独立发现、中间0事项/过渡态图与探针基础设施失败分别保留，不能沿用其旧PASS。

产品实现固定于 `b88af4aa6dfd7f998bfb3e5e119b87820b287d99`；实际正式构建与同源Host截图候选为 `a643bf00e79cba01933cbaa49a1616ecb675cf12`（a643仅一行浏览器等待定位器改为原本轮概览region，产品源码零变化）。PM核心54/54、正式build/SDK会话边界/高危审计、7条实际生产浏览器链路均通过；非作者独立71项、原样RED→GREEN、同实例实际只读浏览与新图逐项复核按[最终原文](verification/pm-final-independent/final-review.md)的固定身份与范围核定。3c原524文件全量结果与PM/独立增量分开，不相加或冒充重新跑全集；后续PR实际head完整CI仍待T10执行。

详见[PM最终接修与逐项记录](pm-final-review.md)、[真实生产图/哈希](evidence/pm-final-product/manifest.json)及[运行身份](evidence/pm-final-product/runtime-identity.json)。本次证据提交只新增上述文档/原图/原始复核材料及本段状态，没有改变运行候选的产品、测试、SDK或冻结输入。用户尚未明确确认本组新截图；没有PR（含draft）、合并或main写入。用户确认与Git/CI后才关单，设备采用及真实模型质量另核。

# Issue #154 实施与验证记录（Decision Case 试用修正）

- **Issue**：[#154：Decision Case 试用修正](https://github.com/gadfly-hbo/OptraCall/issues/154)
- **任务分支**：`work/antigravity/issue-154-decision-case-trial-followup`
- **基线提交**：`main` `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd` + 规格合并 `a4720eb2f5ce71d9d034de087264d996e17873c2`（`openspec/changes/decision-case-trial-followup/{spec.md,tasks.md,result.md}`）
- **领取与阶段回执**：[领取回执](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7235350681) · [T01 阅读与盘点回执](https://github.com/gadfly-hbo/OptraCall/issues/154#issuecomment-7235447476)
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
| 独立非作者复核（T09） | 只读 `research` 子代理（会话 `5b9c9b174527f5a87eb984ab793296e7`）独立核对三项冻结基准、`git diff`、四原则、IN01–IN07 及 11 张实跑截图 | **CONDITIONAL_PASS → 工程收尾条件已补齐** | 复核结论：**0 项阻塞缺陷**；确认 `demo.html` SHA-256 与 `package.json`/`package-lock.json`（Pi 1.4.0）原样未改，13 处产品源码改动均在 §4 允许范围，CF01–CF07 逐项 traceability、四原则、IN01–IN07 及只读检查（`check:agent-sessions`、`tsc --noEmit`、49/49 目标与会话测试）全通过；非阻塞观察：`HomeDailyQuickPanel.tsx:38` 内联 `CasePreparation` 未透传 `onCaseChanged`（不影响进入 `CaseBoard` 自动刷新）、`browser-case-trial-followup.mjs` 在 Chromium 测试 `sse_eof_before_snapshot` 并与单测心跳无首帧互补。原唯一待补项为全量 524 文件分批结果入档（本表已补齐）及开 PR 前用户截图确认（保留至 T10）。 |

---

## 5. 兼容与回退边界

- 无任何数据库 schema 升级或存储路径迁移；CF01–CF07 完全沿原持久化表结构、事件协议与 `CaseStore`/`WorkspaceDraftStore` 契约工作，可直接回退至基线 `7403091` 而不损失已有项目、任务或 Case 数据。
- `node_modules/` 与 `.local/issue-154/` 均属隔离本地验证产物（且 `node_modules/playwright` 临时全局软链已在提交前清理），未写入 `package.json` 或 `package-lock.json`。
- 遵循工程规范：本阶段仅推送任务分支并交回 PM 审核；在 PM 向用户展示新候选真实产品截图并取得明确确认前，**不创建 PR（含 draft），不合并 `main`**。

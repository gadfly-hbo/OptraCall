# OptraCall Issue #154（Decision Case 试用修正）第二轮独立非作者复核报告

- **复核对象**：Issue [#154：Decision Case 试用修正](https://github.com/gadfly-hbo/OptraCall/issues/154) 单次返工新候选
- **任务分支**：`work/antigravity/issue-154-decision-case-trial-followup`
- **基线与候选身份**：
  - 主线基线 `origin/main`：`74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`
  - 规格冻结提交：`a4720eb2f5ce71d9d034de087264d996e17873c2`
  - 首审退回基线提交：`d674deaa6c80e254bf97e2c4e022d3642f486eb1`
  - 本次复核工作区状态：在 `d674dea` 之上包含 5 个已修改未提交文件（`openspec/changes/decision-case-trial-followup/implementation.md`、`src/host/ui/BusinessRoleConversation.tsx`、`src/host/ui/strategy-discussion-client.ts`、`tests/browser-case-trial-followup.mjs`、`tests/case-trial-followup-fixes.test.ts`），无未追踪或越界文件。
- **复核方式**：全新独立只读代码审查（子代理会话 `1c9c303711cf8d2eb3193c3e1d12a38c`）、命令实跑核验与浏览器截图逐张对照（不沿用首轮 `5b9c9b174527f5a87eb984ab793296e7` 的 `CONDITIONAL_PASS` 结论）。

---

## 1. 总体结论

- **工程与试用候选二审结论：`PASS`（工程代码、回归验证与视觉一致性全部通过；无工程阻塞缺陷）**
- **交付门禁与未核边界明确区分**：
  1. **工程与试用候选二审通过**：PM 首审退回指出的 **P1（FR01：持续心跳但遗漏终态卡在 `正在回复…`）** 与 **P2（FR02：CF02 耗尽显式重连正向全链路 + CF03 Plan 交回后取舍/授权/反馈/原记录/原看板历史回归缺失）** 均已完成最小、合规的工程修复与永久回归补齐；`CF01`–`CF07`、`FR01`–`FR02`、`T01`–`T09`、四点产品原则、Interface v3（`IN01`–`IN07`）及 12 张实际运行产品截图对照冻结 Demo v0.6 均核查通过。
  2. **开 PR 前强制门禁仍待执行（T10）**：
     - 需先由作者/PM 将当前 5 个返工文件提交固定至任务分支并推送；
     - 按《工程规范》第 4 节，**开 PR（含 draft）前必须由 PM 向用户展示本新候选的真实产品截图并取得明确确认**（不得沿用首轮截图或旧确认），随后核对 PR head CI、获授权合并及 `main` push CI。
  3. **设备与真实模型边界保留**：本机与作者验证均在 Ubuntu Linux + Node v25.9.0 + 官方 `@earendil-works/pi-coding-agent` `1.4.0` + 隔离合成 Provider + Headless Chromium 下完成；**Mac mini / MacBook 实机环境与真实 GLM 模型质量未在本机验证**，继续保留该未核边界。

---

## 2. 基线与锁文件边界核查表

| 核查项目 | 核查命令 / 依据 | 实测结果 | 结论 |
| --- | --- | --- | --- |
| 冻结 Demo 字节完整性 | `sha256sum openspec/changes/decision-case-daily-workspace/demo.html` | `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`（与 `spec.md` 一致） | **PASS** |
| 受保护文件零改动 | `git diff origin/main -- package.json package-lock.json openspec/changes/decision-case-daily-workspace/demo.html openspec/changes/decision-case-trial-followup/spec.md openspec/changes/decision-case-trial-followup/result.md` | 输出为空（0 字节改动） | **PASS** |
| 规格冻结后 `spec.md`/`result.md` 零改动 | `git diff a4720eb..HEAD -- openspec/changes/decision-case-trial-followup/spec.md openspec/changes/decision-case-trial-followup/result.md` | 输出为空；仅 `tasks.md` 勾选了 `T01`–`T09` | **PASS** |
| 官方 Pi SDK 版本锁定 | 检查 `package.json` 与 `package-lock.json` | 均为 `@earendil-works/pi-coding-agent` `1.4.0` 未修改 | **PASS** |
| 临时软链清理核验 | `ls -la node_modules/playwright` | `No such file or directory`（`node_modules/playwright` 不存在） | **PASS** |
| 工作区改动范围核验 | `git status --short`、`git diff d674dea --stat`、`git diff origin/main --stat` | `d674dea` 之上仅 5 个返工文件（535+, 40-）；相对 `origin/main` 共 34 文件（均在 `spec.md` §4 允许路径、OpenSpec 证据/记录与测试内） | **PASS** |
| 边界检查（只读实跑） | `npm run check:agent-sessions` | `Agent session integration boundary and pinned SDK materials: PASS`（exit 0） | **PASS** |
| TypeScript 类型检查（只读实跑） | `npm run typecheck` | `tsc --noEmit` 通过（exit 0） | **PASS** |
| 核心单测（只读实跑） | `node --test tests/case-trial-followup-fixes.test.ts tests/case-preparation-ui.test.ts tests/agent-sessions.test.ts` | **50/50 PASS**（0 fail, 0 cancelled, 0 skipped） | **PASS** |

---

## 3. FR01 / FR02 专项代码与回归审查结果

### 3.1 FR01：持续心跳但遗漏终态时 `Case Agent` 卡在 `正在回复…`（P1）

- **`src/host/ui/strategy-discussion-client.ts`**：
  - `StrategyWatchOptions` 新增 `eventIdleTimeoutMs?: number` 与 `shouldExpectEvents?: () => boolean`（`StrategyDiscussionPanel.tsx` 等现有调用方未传新字段时完全向后兼容）。
  - `touch()` 仅用于原始字节空闲超时（`idleTimeoutMs`）；`touchEvents()` 仅在初始化与收到非空 `data:` 事件块后触发（`: role connection`、`: heartbeat` 等 SSE 注释行产生 `data === ''`，**绝不触发 `touchEvents()`**）。
  - `eventTimer` 到期时若 `shouldExpectEvents()` 为 `false`（空闲流无在途请求），则安全续期 `touchEvents()` 而不误断；若 `shouldExpectEvents()` 为 `true`（在途请求无有效 `data:` 事件），则置 `timedOut = true` 并中止 `observation`。
  - 读循环自然结束（`chunk.done`）后及 `catch` 块内均保护性检查 `if (timedOut && !signal.aborted)`，统一抛出 `StrategyDiscussionRequestError('strategy_discussion_events_timeout', 0, false, '实时对话观察超时，正在只读核对原记录。')`；`finally` 清理双定时器、移除 `abort` 监听并取消/释放 `reader`。
- **`src/host/ui/BusinessRoleConversation.tsx`**：
  - `isRoleRunUnresolved(next, req)` 严格核对 `next.discussion`、`next.busy`、精确 `terminal.id === req.requestId`（`failed`/`cancelled` 终止）及 `canSettleDiscussionMessage(next, req)`（要求 `requestId`、`originalUserText`、`nativeEntryId`、`sessionId` 全部匹配），**绝不借用别轮终态或自建第二完成权威**。
  - `load()` 在 `!next.busy` 时通过 `setStream('')` 清空残余流式文本缓冲，同时保持 SSE 连接不频繁重连折腾（`inFlightRef.current` 变为 `false` 后 `shouldExpectEvents()` 返回 `false`）。*（非阻塞措辞注记：`implementation.md` 第 74 行写“主动关闭旧 `stream`”实际指清空 `stream` 文本状态 `setStream('')` 而非中止 SSE 连接，该行为在 `FR01` 单测与 E2E `streams === 1` 中明确验证。）*
  - SSE 订阅传入 `{ idleTimeoutMs: 45000, eventIdleTimeoutMs: 45000, shouldExpectEvents: () => inFlightRef.current }`；若触发 `strategy_discussion_events_timeout` 且 Host `GET` 确认 `next?.busy === true`，清除错误提示、重置 `attempt = -1` 并等待 500ms 后继续观察运行中任务；退避耗尽时若 `!loadError && next?.busy` 亦不误报失败。
  - 独立 `[id, inFlight, load]` 只读 `GET` 对账 `useEffect`：首次静默窗口 `quietReconcileMs = 3500`，错误/未明退避 `[500, 1500, 3000]`；若等待期间收到真实 SSE `data:` 事件（`eventEpochRef.current !== epochBeforeWait`）则跳过冗余 `GET`；`next.busy === true` 时重置 `consecutiveErrors = 0` 与 `idleUnresolved = 0` 并清错，确保慢响应不会因累计超时被误取消；连续 4 次 `GET` 失败或连续 4 次 `!busy` 但仍未落账后停止轮询并保留「核对原操作」按钮；`ScopedConversation` 以 `key={JSON.stringify(owner)}` 隔离，切 owner 或卸载时执行 `controller.abort()` 清理 `setTimeout` 与 `fetch`，`alive.current` + `seq.current` 丢弃迟到读结果。
  - 全组件中 `stop` 仅在用户点击「停止」按钮时调用，`messages` 仅在用户发送/外部请求/用户点击「按原编号发送」时调用，无任何 `open` 调用。
- **回归证据**：
  - `tests/case-trial-followup-fixes.test.ts`（`FR01` 用例）：验证 `: heartbeat` 不重置 `eventIdleTimeoutMs`、慢运行连续两轮 3500ms 保持 `正在回复…`、遗漏终态后经只读 `GET` 恢复全文并结束等待、`writes === ['messages']`（零重放/零自动停止）、连续 4 次 GET 503 后停止轮询并保留「核对原操作」按钮。
  - `tests/browser-case-trial-followup.mjs`（`FR01` 用例）：真实 Host + Pi 1.4.0 + Chromium 下注入 200ms 心跳开流并丢弃终态事件、Provider 延迟 3s 返回，实测持续心跳下自动恢复 `'FR01 持续心跳漏终态已自动读回完成。'`，`'正在回复…'` 归零，`streams === 1`，`heartbeats >= 10`（实录 19 次），零 `messages` 重放、零 `stop` 调用，截图保存至 `.local/issue-154/product-verify/05b-fr01-heartbeat-recovered-1440.png`。

### 3.2 FR02：回归覆盖补齐（P2）

- **`CF02` 耗尽进 `disconnected` → 显式重连 → 真发完成全链路**：
  - `tests/case-trial-followup-fixes.test.ts:496-548` 新增 Subcase 3：模拟心跳无首帧/断流耗尽至 `disconnected`（期间 GET idle 不解除 `connected`），显式重连收到合法 `snapshot` 后恢复 `connected`、读回原草稿 `'显式重连草稿保留'` 且 `writes === []`。
  - `tests/browser-case-trial-followup.mjs:289-332` 真实 App/Host/Pi 1.4.0/Chromium 全路径：创建任务 `CF02 心跳超时任务` → 注入 200ms 纯心跳触发 `firstFrameTimeoutMs`（`等待任务首帧状态超时`）→ 3 次 `stream.error` 耗尽进入 `disconnected`（`实时观察暂未恢复，请显式重新连接`），断言未发草稿保留且「发送消息」按钮保持禁用（GET idle 不解锁门禁）、0 次自动 `open`/`messages`/`stop` → 恢复 SSE 并点击「重新连接任务」→ 恢复 `任务和历史已保存在本机`、草稿完整、0 次自动写入 → 真实通过 Pi 1.4.0 发送并完成 `'CF02 显式重连后首发完成。'`。
- **`CF03` Plan 交回 → 取舍 → 授权 → 反馈 → 原记录/原看板历史完整串联**：
  - `tests/browser-case-trial-followup.mjs:334-413` 在 `Plan Task` 完成后完整执行：`将 Plan 候选交回事项` → 打开「记录取舍」核对理由草稿保留并选择交回的 Plan 方案 → `保存取舍` → 展开「授权本次行动」填写看板行动与授权范围并点击 `确认授权并进入看板` → 点击 `回录反馈` 填写结果并 `保存反馈` → 点击 `查看本轮原记录` 核对行动、授权范围与反馈 → 点击 `查看准确方案原回复` 核对原 Plan 正文 → 点击 `查看原看板反馈` 进入 `决策看板` 并验证 `已保存反馈历史` 弹窗 → `Escape` 关闭弹窗并返回原 Case 详情。

---

## 4. 完整三基线可追溯矩阵（CF01–CF07、FR01–FR02、T01–T10）

| 基准条目 | 预期要求 | 实际代码/入口 | 复核证据 | 差异分析 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **CF01** | 观察流 clean EOF/异常/漏终态有限发现并只读核对准确 owner/request，恢复全文与终态，不自动 stop/open/messages、不伪造 idle 或串 owner | `src/host/server.ts`（讨论流心跳）、`src/host/ui/strategy-discussion-client.ts`、`src/host/ui/BusinessRoleConversation.tsx`（`streamEndedRef`、EOF 退避、`isRoleRunUnresolved`、切 owner 清理） | 单测 `tests/case-trial-followup-fixes.test.ts` `CF01` + `tests/agent-sessions.test.ts`（本次只读实跑 PASS）；浏览器 `CF01+CF04`（`e2e-receipt.json` PASS） | 无功能偏差；与 FR01 协同覆盖 clean EOF 与开流心跳漏终态两类场景 | **PASS** |
| **CF02** | 即使心跳持续，无有效同 owner 首帧须在有限期限退出并给安全分类错误；GET idle 不解 `connected`；合法 snapshot 重连恢复发送与草稿，不自动 open/messages/stop | `src/host/server.ts`（分类 `stream.error`）、`src/host/ui/runtime-client.ts`（`firstFrameTimeoutMs: 15000`、`SAFE_STREAM_CATEGORIES`、`classifyObservationFailure`） | 单测 `CF02` 3 个子用例（本次实跑 PASS）；浏览器 `CF02` 含 Plan 首发 + 心跳超时耗尽 + 显式重连真发完成（`e2e-receipt.json` PASS） | 无功能偏差；Mac 原自然首帧诱因按 spec 保留待核 | **PASS** |
| **CF03** | 无方案时在取舍弹窗说明前置条件、保留理由/下一步草稿、引向关联/新建项目或 Plan 准备/原回复接回；绝不复制 `goalBinding.strategy`；实跑完整 Plan→取舍→授权→反馈→历史链路 | `src/host/ui/CaseBoard.tsx`（透传 `onLinkProject`）、`src/host/ui/CaseIssuePanel.tsx`（`planHandoffSection`、`!availablePlans.length` 状态引导与草稿 flush） | 单测 `CF03`（本次实跑 PASS）；浏览器 `CF03` 全链 + 弹窗截图 `06-choice-empty-unlinked-1440.png`、`07-choice-empty-linked-1440.png` | 无偏差；保持既有弹窗与四页签结构，未扩展 CaseAgent 写方案权限 | **PASS** |
| **CF04** | 补齐请求工具 `choose`/`observe` 准确 `target` schema、新建/修订 `requestId`/`expectedRequestRevision`/null 说明与字段级安全诊断；保留授权/CAS/来源拒收 | `src/agent/strategy-discussion.ts`（`caseChooseTargetSchema`、`caseObserveTargetSchema`、`explainCaseDeclarationError`）、`src/agent/project-session.ts`、`src/host/strategy-discussion-host.ts`（`diagnoseCaseDecisionRequestError`） | 单测 `CF04`（本次实跑 PASS）；真实 Pi 1.4.0 在 `CF01+CF04` 浏览器 E2E 中经历 schema/领域报错 2 步纠错后成功保存 rev1（截图 `05b` 显示 `3 步 · 2 步失败`） | 无偏差；完全基于既有 Pi 工具 schema 与 Host 诊断投影，未重建存储权威 | **PASS** |
| **CF05** | 确定性本地字段错误指明缺失项（如“个人归属名称”）并聚焦，未有效前零写入请求；区分本地校验/4xx/`stillPending`；`重试保存` 正名且按 `dirty` 显示 | `src/host/ui/CasePreparation.tsx`（前置字段校验、`focusField`、`definiteClientReject` vs `stillPending`、「保存当前草稿」） | 单测 `CF05` + `tests/case-preparation-ui.test.ts`（本次实跑 PASS）；浏览器 `CF05` 零 Goal/Create POST 且聚焦 `个人归属名称` | 无偏差；旧回执/部分成功/UNKNOWN 保留逻辑完整 | **PASS** |
| **CF06** | 创建并确认首事项后直接“返回工作台·保留草稿”自动刷新已挂载 `Case 总览`，无需手动刷新；纯继续不重复建案，读取失败标旧快照 | `src/host/ui/App.tsx`（`caseBoardRefreshSeq` 传给 `CaseBoard` 并在 `onCaseChanged` 递增）、`src/host/ui/CaseBoard.tsx`（`refreshSeq` 触发刷新及 `listStale`）、`src/host/ui/CasePreparation.tsx`（`onCaseChanged?.()`） | 单测 `CF06`（本次实跑 PASS）；浏览器 `CF06` 创建第 3 个 Case 直接返回后无需刷新即显示全部 3 个（截图 `03`/`04`） | 无偏差 | **PASS** |
| **CF07** | 归档/恢复动作按钮可访问名称区分所属项目，沿原 ID/空闲准入/只读与键盘焦点；同名项目操作仅作用于目标项目 | `src/host/ui/ProjectNavigation.tsx`、`src/host/ui/ProjectBoard.tsx`（`aria-label` 含 `project.name`/`selected.name`）；同步更新 3 份旧浏览器定位器 | 单测 `CF07`（本次实跑 PASS）；浏览器 `CF07` 同名两项目验证 Esc 归还焦点与单项目归档（截图 `11`） | 无偏差；未改共享 `> 1` 阈值 | **PASS** |
| **FR01** | SSE 持续发 `: heartbeat` 但遗漏终态时，不卡死 `正在回复…`，通过独立事件超时 + 有界只读 `GET` 对账自动恢复全文/终态，不误杀慢运行，切 owner/卸载清理 | `src/host/ui/strategy-discussion-client.ts`（`eventIdleTimeoutMs`、`shouldExpectEvents`）、`src/host/ui/BusinessRoleConversation.tsx`（`isRoleRunUnresolved`、`eventEpochRef`、`3500ms` + `[500,1500,3000]` 只读对账） | 单测 `FR01`（本次实跑 PASS）；浏览器 `FR01`（19 次心跳开流自动恢复完成，`e2e-receipt.json` PASS，截图 `05b`） | 仅 `implementation.md:74` 将 `setStream('')` 文本清理措辞为“关闭旧 `stream`”（非阻塞文档注记） | **PASS** |
| **FR02** | 补齐 `CF02` 耗尽 `disconnected`→显式重连→真发完成全链路与 `CF03` Plan 交回→取舍→授权→反馈→原记录/原看板历史完整浏览器回归 | `tests/case-trial-followup-fixes.test.ts`（`CF02` Subcase 3）、`tests/browser-case-trial-followup.mjs`（`CF02` L289–332、`CF03` L334–413） | 单测（本次实跑 PASS）；浏览器全链路实跑（`e2e-receipt.json` PASS，`pageErrors: []`） | 无偏差 | **PASS** |
| **T01** | 有效领取/回读；核 main/工作树/唯一写入者；浏览器阅读冻结 Demo 并映射；盘点 IN01–07 | Issue #154 评论 `#7235350681` / `#7235447476` / `#7238036165`；`.local/issue-154/demo-read/`（8 张 Demo 截图 + `skeleton.json`）；`implementation.md` §1 | 目录截图与 `skeleton.json` 存在；`implementation.md` §1 映射完整 | 无偏差 | **PASS** |
| **T02–T08** | 逐项落实 CF01–CF07 并附 RED/GREEN 与永久回归 | 对应 `src/host/*`、`src/agent/*` 与 `tests/*` | 单测 50/50（本次实跑 PASS）+ 作者 E2E PASS + 全量 524 文件 3694 tests（3497 pass / 0 fail / 197 skip，见 `implementation.md` §5） | 无偏差 | **PASS** |
| **T09** | 固定完整候选；适用完整检查、真实 Host/SDK/浏览器、全新非作者逐项及四原则复核；保留 FAIL/SKIP/UNKNOWN 与 Mac 未核边界 | `openspec/changes/decision-case-trial-followup/implementation.md`、`tasks.md`、本二审报告 `second-review.md` | 本次独立只读核查通过；作者记录了完整 524 测试批跑、build、audit 与 4 个历史脚本基线漂移 FAIL | 1) 5 个返工文件尚在工作区待提交；2) `tasks.md` T09 括号注记仍引用首轮失效审查 ID `5b9c9b17...`（`implementation.md` §5 已正确更正，建议提交前同步 `tasks.md`） | **PASS**（待提交固定） |
| **T10** | PM 集成最新 main；展示新候选真实产品截图获用户明确确认后开 PR；核 head CI、合并及 main push CI | 待 PM 执行 | 尚未进入 PR / CI / 合并阶段 | 属于 T09 之后的 PM 交付门禁，开 PR 前必须完成截图确认 | **待执行（开 PR 前置门禁）** |

---

## 5. 四点产品原则与 Interface v3（IN01–IN07）合规检查

### 5.1 四点产品原则

1. **Host 管环境**：Host 仅负责 SSE 心跳/安全分类报错（`server.ts`）、首帧超时与有界只读对账（`runtime-client.ts`、`BusinessRoleConversation.tsx`）、表单局部字段校验（`CasePreparation.tsx`）、工具参数字段定位投影（`diagnoseCaseDecisionRequestError`）与列表失效重读（`App.tsx`/`CaseBoard.tsx`）。绝不替 Agent 生成方案、不复制 `goalBinding.strategy` 冒充方案、不解除 `connected` 发送门禁。
2. **Agent 自主执行**：`CF04` 实测真实 `@earendil-works/pi-coding-agent` `1.4.0` 根据 `caseDeclarationsTool` schema 与字段级错误自主纠错后完成请求保存（3 步、2 步失败），Host 无硬编码重放或固定推理步骤。
3. **优先复用 Pi 已有能力**：继续复用 `AgentSessionPort`/Interface v3、`strategy_goals`（`caseDeclarationsTool`）既有工具定义、`BusinessRoleConversation` 统一观察通道及既有 `CaseStore`/`WorkspaceDraftStore`；`package.json`、`package-lock.json` 与 `@earendil-works/pi-coding-agent` `1.4.0` 原样未改；`watchStrategyDiscussion` 保持对 `StrategyDiscussionPanel.tsx` 的向后兼容。
4. **减少人的操作**：CF03 空态引导直接连接「去关联或新建项目」「去准备 Plan Task」「查看交接与依据」且保留理由/下一步草稿；CF05 精准报错并聚焦缺失输入；CF06 创建后返回自动刷新总览；CF07 仅通过 `aria-label` 消歧而不增加多余确认弹窗。

### 5.2 Interface v3（IN01–IN07）合规核查

- **IN01–IN03（开发前必读 / Host 注册 / 共用生命周期）**：`implementation.md` §1 已盘点 IN01–IN07；`BusinessRoleConversation.tsx` 与 `strategy-discussion-client.ts` 均只做前端观察与只读 `GET` 对账，未在业务层自建 Runtime、未绕过 `AgentSessionPort`、未新建全局运行队列或资源台账；`npm run check:agent-sessions` 实跑 PASS。
- **IN04（保留业务差异）**：Case/Goal/Project 等 owner 仍通过 `BusinessRoleOwner` 区分（`key={JSON.stringify(owner)}`）；`isRoleRunUnresolved` 与 `canSettleDiscussionMessage` 严格绑定当前 `requestId` 与原生回执，未把 Case 观察逻辑强行改变其他 owner 的取消/历史语义。
- **IN05（Host 资源权限与脱敏）**：`runtime-client.ts`（`SAFE_STREAM_CATEGORIES`）、`server.ts`（分类 `stream.error`）与 `diagnoseCaseDecisionRequestError`（`exposure: 'safe-tool-error-v1'`）均只暴露受控分类与字段路径，不泄露本机绝对路径、凭据或原始业务载荷。
- **IN06–IN07（契约共同维护与交付验证）**：公共接口兼容（`StrategyWatchOptions.eventIdleTimeoutMs` 可选），未触及 `src/host/agent-sessions.ts` 公共内核；回归覆盖 `tests/agent-sessions.test.ts`（共享行为及第三合成消费者）、`tests/case-preparation-ui.test.ts`、`tests/case-trial-followup-fixes.test.ts` 与真实 Host + Pi 1.4.0 + Chromium 浏览器全链路。

---

## 6. 实际运行截图与冻结 Demo 视觉对照结论

已逐张 `view_file` 查看 `.local/issue-154/product-verify/` 全部 12 张实际运行产品截图，并与 `.local/issue-154/demo-read/` 同视口冻结 Demo 截图对照：

| 产品截图 | 对照基准 | 视觉与布局核对结论 |
| --- | --- | --- |
| `01-home-light-1440.png` | `demo-read/01-home-1440.png` | 浅色主题、深色左侧栏、轻输入卡片（`整理与查找`/`直接准备新 Case`）、四区结构（待处理事项/进展关注/继续工作/基础设施提醒）与冻结 Demo 一致，无错位裁切。 |
| `02-preparation-1440.png` | `demo-read/03-preparation-1440.png` | 保留输入区、三分支准备表单、返回工作台入口布局一致；字号层级与表单边界清晰。 |
| `03-case-overview-map-1440.png`、`04-case-overview-cards-1440.png` | `demo-read/02-case-overview-1440.png` | 顶部二级页签（`Case 总览`/`全部项目`）、搜索/筛选、星图/卡片切换与 3 张新创建 Case 卡片（含自动刷新后的 `Case 三号自动刷新`）排版完整，无重叠。 |
| `05-case-detail-1440.png`、`05b-fr01-heartbeat-recovered-1440.png` | `demo-read/04-case-detail-1440.png` | 详情页顶部 G/S 常驻、4 页签（当前工作/项目与任务/成果与依据/历史）、左侧事项列/树切换、右侧 `Case Agent` 完整恢复内容（含 `CF04` `推理过程 · 3 步 · 2 步失败` 折叠条与 `FR01` 回复全文，且无 `正在回复…` 残留）与冻结布局一致。 |
| `06-choice-empty-unlinked-1440.png`、`07-choice-empty-linked-1440.png` | `demo-read/05-choice-modal-1440.png` | 「记录本轮取舍」弹窗保持原结构，无方案时局部展示缺失提示（明确说明 G/S 策略不直接作为方案）与「去关联或新建项目」/「去准备 Plan Task」/「查看交接与依据」按钮，已输入理由草稿清晰保留。 |
| `08-case-detail-dark-1440.png` | 暗色主题适配 | 深色背景、紫色高亮边界、文字对比度与卡片分隔清晰可读，无白块或反色错误。 |
| `09-case-detail-1024.png` | 1024×768 视口 | 主内容区及右侧对话可读；**非阻塞观察**：左深色导航栏在 768px 高度且 `项目空间 (1)` 展开时，底部 `已归档项目 (0)` 与 `设置 · 中/EN` 存在轻微视觉重叠（属 `main`/PR #152 既有固定侧栏高度样式，Issue #154 未改动任何 CSS）。 |
| `10-case-detail-390.png` | `demo-read/07-case-detail-390.png` | 390×844 窄屏切换为单列纵向流布局、事项下拉选择器、列表/树状图切换及操作按钮排版紧凑可读，无横向溢出。 |
| `11-all-projects-1440.png` | `demo-read/06-all-projects-1440.png` | 「全部项目」页签筛选（`全部 3`/`独立 2`/`共享 0`/`归档 1`）、全局归档横幅、关联 Case 标签及两个同名项目状态（1 个未设置状态、1 个已归档）展示准确，与冻结 Demo 一致。 |

---

## 7. 遗留边界、非阻塞观察与阻塞项

1. **阻塞项**：**无工程代码或测试阻塞项**。唯一交付前置门禁为 **T10**：提交固定当前 5 个返工文件后，PM 须在 **开 PR（含 draft）前** 向用户展示本候选真实产品截图并取得明确确认，再核对 PR head CI 与 `main` push CI。
2. **非阻塞观察（诚实保留，不改写结论）**：
   - `tasks.md` 中 `T09` 括号注记仍引用首轮失效独立复核 ID `5b9c9b174527f5a87eb984ab793296e7`（`implementation.md` §5 已明确记录该首轮结论失效），建议在提交固定本次返工时同步更新 `T09` 注记指向本 `second-review.md`。
   - `implementation.md` 第 74 行将 `BusinessRoleConversation.tsx` `load()` 中的 `setStream('')` 文本缓冲清理表述为“主动关闭旧 `stream`”；实际行为是清空流式 Delta 文本缓冲同时保持长连 SSE 不反复重连（经 `FR01` 单测与 E2E `streams === 1` 验证正确）。
   - `09-case-detail-1024.png`（1024×768）左栏底部 `已归档项目 (0)` 与 `设置 · 中/EN` 轻微重叠为 `main` 既有 CSS 行为（Issue #154 零 CSS 修改）。
   - `e2e-receipt.json` 中 `pageErrors` 为空 `[]`，`consoleErrors` 含预期的草稿 404 及既有 React duplicate key 警告（`4472f9db-...`）。
   - `implementation.md` §5 保留的 4 项历史浏览器脚本基线文本/选择器漂移 FAIL 与 197 项 Linux 环境/外部工具 SKIP 保持原样，未弱化断言。
3. **未验证环境边界**：
   - 本次二审在只读模式下实跑了 `check:agent-sessions`、`typecheck` 与 50 个核心单测；完整 524 测试文件（3694 tests：3497 pass / 0 fail / 197 skip）、`npm run build`、`npm audit --audit-level=high` 与 `node tests/browser-case-trial-followup.mjs` 为作者在清除 `node_modules/playwright` 前后提供的实跑回执（已与源码 diff 及产物截图交叉核验）。
   - **Mac mini / MacBook 实机体验环境与真实 GLM 模型调用**未在本机验证，留待工程交付后由用户另行安排设备试用核验。

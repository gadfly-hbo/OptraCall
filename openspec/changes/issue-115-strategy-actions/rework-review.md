# Issue #115 返工候选独立重验报告（非作者 / 全新上下文 / 怀疑视角）

- 重验者：独立非作者 Agent（未参与创作，只读重验）
- 工作树：`/Users/bendandebaba/.qoder-cn/worktrees/issue-115-strategy-actions`
- 分支：`work/qoder/issue-115-strategy-actions`
- 返工候选 HEAD：`49f140a91fca050fa00e6e88db10d4bbe35174a0`
- 上一被退回候选：`180c8943d2bb064e9581c2690beca5f8d60e6482`
- 基线：`e2aecfb445094245875b9696a02a273b5e0ddb44`（已确认为 HEAD 祖先）
- 自写反例与临时输出仅写入 `.local/issue-115/rework-review/` 与系统临时目录；未修改任何源文件/测试/规格/既有证据。浏览器点验脚本以字节等价副本运行，仅将证据输出目录重定向到本目录，避免覆盖既有 `.local/issue-115/browser` 截图（已用 diff 证明副本除路径外与原脚本完全一致）。

## 总体结论：PASS

Codex 审核（评论 7088759365）退回的 5 项已逐项独立复现并确认真正解除；未发现新增阻断或回归；新 HEAD 身份固定。

## 五项逐项状态

### 1. 并行批次越过第七次派发 — 解除（PASS）
- 反例 RV1：合成 Anthropic 回环（`tests/fixtures/anthropic-tool-provider.ts` 同款夹具，reviewer 自有副本）一批发出 8 次相同 `read-goals`。实测 Host 派发恰 6 次、`maxActive===1`（证明批次被串行化而非并行竞态）、终态 `cancelled`、诊断 `strategy_action_loop`、Provider 请求仅 1 次（止损后无续派）；下一显式请求恢复 `completed`。
- 反例 RV2：5 次单独读取＋2 调用批次 → Host 派发恰 6 次、`cancelled`、`strategy_action_loop`、无第 7 次 Provider 请求。
- 机制核对：作者在 `src/agent/project-session.ts createStrategyTools` 对全量战略工具加 `executionMode:'sequential' as const`，复用 Pi 原生能力。SDK `chunk-MM3LKT73.js executeToolCalls` 原生判定 `hasSequentialToolCall`→`executeToolCallsSequential`，非自建并行机制。RV1 的 `maxActive===1` 经验性证实串行。
- 诊断补充（diag-dangling）：批次止损后第 8 个 toolCall 在原生 JSONL 无 toolResult 条目（SDK 串行执行器在 abort 后 `break` 的原生行为）；但下一次 Provider 请求线上 8 个 tool_use 与 8 个 tool_result 全配对、无悬空，同会话与重开恢复均 `completed`。非缺陷。

### 2. 豁免动作误停 — 解除（PASS）
- 反例 RV4：6 次相同 `read-goals` 后一次 `operation` 成功，再 2 次 `read-goals` → `completed`、无 loop 诊断、9 次派发。
- 反例 RV3（更强）：单批 [6 读＋operation＋3 读] → `completed`、10 次派发、批内豁免即重置计数。
- 反例 RV5：`save-map`（写入）与 `public-search` 插入读取连击之间 → `completed`、15 次派发、无 loop 诊断。写入/operation/public-search 均豁免（`if (loopGuard && !isRead) strategyReadLoop=undefined`）。

### 3. 错误回包回显原始路径 — 解除（PASS）
- 反例 RV-E1：真实 Host/Pi（`tests/fixtures/host-process.ts`），绝对路径作无效连线 ID。错误以公开字段路径＋结构下标定位（`edges[0]`、`edges[1]`）；工具错误回包、原生 toolResult、HTTP 讨论快照 toolResult、下一次 Provider 请求 tool 结果均不含该路径；无效提交零写入；安全 ID（`e-safe`）仍保留 itemId 供定位。
- 反例 RV-E2：Windows 盘符 `C:\...` 与 `~/...` 路径 ID 同样不回显。
- 反例 RV-E3：节点路径 ID＋未声明 sourceLocation → `nodes[0].sourceLocation.sourceId` 定位、`source_not_declared`、不回显、零写入。
- 机制核对：`safeStrategyItemId`（`strategy-discussion-fault.ts`）拒绝含 `/ \ 控制字符`、盘符前缀、`~` 前缀的 ID；`strategy-map-store.ts`/`strategy-discussion-host.ts` 全部 issue 改用 `itemPath(kind,index)` 结构下标＋`itemIdField` 脱敏；`project-runtime.ts safeToolFault` 同步收紧 itemId 过滤。模型 toolCall 参数中的输入路径属原始输入，不计为错误回包泄露（仅核对 toolResult/错误回包）。

### 4. 已知 scenario 校验被兜底 — 解除（PASS）
- 反例 RV-E4：`scenarioModel.baselineRate=-1` 调 save-map → 工具链收到稳定 `invalid_scenario_baseline_rate`（非 `host_tool_failed`）；零写入；另验证 `invalid_scenario_remote`、`invalid_scenario_lift_points` 稳定码；修正 `baselineRate=10` 后保存一版取得 `candidate-not-adopted`，versions 恰 1。
- 机制核对：`strategy-simulation.ts scenarioCode` 将 camelCase 键转 snake_case，使码满足工具链稳定码正则 `/^[a-z0-9_]{1,100}$/`（`project-runtime.ts`），不再落入中性兜底。
- 反例 RV-E5：HTTP 消费端对相同无效草稿保持既有通用安全契约（`invalid_strategy_map`/`invalid_scenario_baseline_rate`、`accepted:false`、通用文案、不泄露 Agent details/路径），有效 HTTP 保存仍 201。Method 例外/取消/权限码由完整套件（3043 通过、0 失败，含既有战略测试）覆盖，不受影响。

### 5. 共享入口静默停止 — 解除（PASS）
- 机制核对：`loopGuard = !variant`（`variant=o.workspace?.discussionTools`），止损作用域收回战略共创全量工具；`project-sources`/`goal-draft` 变体 `loopGuard=false`→不计数、不取消、不加 sequential。
- 反例 RV6：`discussionTools:'project-sources'` 夹具单批 8 次相同 `read-source` → `completed`、8 次派发、无 loop 诊断、不静默取消。
- 反例 RV7：`goal-draft` 变体单批 8 次 `propose-goal` → `completed`、8 次派发、无静默取消。
- 浏览器点验：战略共创主面板止损 alert（含“不代表资料缺失或不可读”“改用另一已配置模型”）、刷新后从原生运行恢复诊断、路径非阻断提示、390px 窄视口无横向溢出均有效；`providerRequests=7`、`pageErrors=[]`。

## 独立运行的检查

| 检查 | 结果 |
| --- | --- |
| `npm run check:agent-sessions` | PASS（exit 0；边界与 pinned SDK 材料） |
| `npm run typecheck` | PASS（exit 0） |
| `npm run check`（完整） | exit 0；tests 3154 / pass 3043 / fail 0 / skipped 111 / cancelled 0；build 成功并标记 `0.1.0-mvp.4 49f140a` |
| reviewer 反例 `counter-loop.test.ts` | 7/7 PASS |
| reviewer 反例 `counter-error-contract.test.ts` | 5/5 PASS |
| reviewer 诊断 `diag-dangling.test.ts` | 1/1 PASS（仅诊断悬空配对） |
| 浏览器点验（系统 Chrome＋全局 playwright，字节等价副本） | PASS（`providerRequests=7`、`pageErrors=[]`） |

## 改动范围与身份核对

- `git diff 180c894..49f140a --name-only` 仅 10 文件：`openspec/changes/issue-115-strategy-actions/result.md`、`src/agent/project-runtime.ts`、`src/agent/project-session.ts`、`src/host/strategy-discussion-fault.ts`、`src/host/strategy-discussion-host.ts`、`src/host/strategy-map-store.ts`、`src/host/strategy-simulation.ts`、`tests/strategy-discussion-runtime.test.ts`、`tests/strategy-map-host.test.ts`、`tests/strategy-workbench-simulation.test.ts`。范围限于战略止损/错误契约/相关测试与文档。
- 未改官方 SDK / `node_modules` / 依赖锁（`package-lock.json`、`package.json` 相对基线无变化）/ `src/host/agent-sessions.ts` 公共生命周期（相对基线无变化）。
- SDK 仍 `@earendil-works/pi-coding-agent` 1.4.0（`src/agent/sdk.ts` 对 `VERSION!=='1.4.0'` 抛错）；transport `undici` 8.12.2（含 overrides）；`AGENT_SESSION_INTERFACE_VERSION = 3`（Interface v3）。
- 跟踪工作树干净（`git status --short` 空）；自写产物均在 gitignore 的 `.local/` 与 `dist/`。

## 发现（按严重度排序）

无阻断（Blocker）或高严重度发现。

- [信息 / 非阻断] 批次止损后第 8 个 toolCall 原生无 toolResult 条目，系 Pi 串行执行器 abort 后 `break` 的原生行为；线上下一请求全配对、同会话与重开恢复均完成。已用 diag-dangling 证实，非缺陷，无需修复。
- [次要 / 范围外] `src/host/strategy-trials.ts` 仍抛 camelCase `invalid_scenario_liftPoints`（L39）与含冒号/空格的 `invalid_scenario_input: ...`（L55）。该模块仅经 `server.ts` HTTP 路由与 UI 面板消费（HTTP 直接返回 `error.code`），不进入 Agent 工具链稳定码正则，故不会被兜底为 `host_tool_failed`，也不在本次 save-map scenarioModel 修复范围内。属既有命名不一致，非本次返工引入的回归；如未来将该路径接入工具链需统一 snake_case。仅作观察记录，不阻断本次结案。

## 剩余阻断

无。5 项逐项解除，完整检查与浏览器点验通过，新 HEAD `49f140a91fca050fa00e6e88db10d4bbe35174a0` 身份固定，可进入后续 Git/CI 与合并流程（合并、运行采用仍按工程规范另行授权）。
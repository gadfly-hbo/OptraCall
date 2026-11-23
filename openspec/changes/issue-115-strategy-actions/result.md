# Issue #115 实施与验证记录

## 当前状态

阶段：A/B/C 实现完成；首轮交付 180c894 经 Codex 审核退回 5 项（并行批次/豁免误停/路径回显/scenario 兜底/共享作用域），已逐项修复并补反例（见文末「返工修复」）。待返工后全量 check/浏览器/独立重验确认，再交回 Codex 集成。

- 基线：`e2aecfb445094245875b9696a02a273b5e0ddb44`
- 分支：`work/qoder/issue-115-strategy-actions`
- Interface v3；owner `StrategyDiscussion/o.id`；profile `strategy-discussion` / unmanaged。
- 依赖按锁文件 `npm ci` 安装；`npm ls @earendil-works/pi-coding-agent undici --depth=0` 实际为 1.4.0 / 8.12.2（overridden），未修改依赖或官方包。
- 未调用真实 Provider，未读取真实原生会话或业务资料，未操作设备/服务。所有模型输出均为本机 loopback 合成数据。
- 独立复核报告见 `independent-review.md`（复核对象 0a29ff6）；F1 修复与重验见文末「独立复核与 F1 修正」。

## A. MiniMax action 分层证据

命令：

```bash
node --test --test-name-pattern='Issue 115' tests/strategy-discussion-runtime.test.ts
```

结果：**PASS（2/2）**。

1. 实际 MiniMax Anthropic 出站 `strategy_goals.input_schema.properties.action` 含全部受测 action；Provider 以多段 `input_json_delta` 返回 `find-sources`、`read-map`、`save-map`。
2. 测试按 requestNumber/toolCallId 对齐 emitted fragments、Host port、native toolCall/toolResult 和下一请求的 `tool_result`。三种非首项 action 与参数原值均保留，`save-map` 下一请求含 `candidate-not-adopted`。
3. 症状注入 `read-goals`，分别改变 query、sourceId、mapDraft 并采用不同分片数；Host 和 native 仍均为 `read-goals`，证明下游不按其他参数自行纠正 action。测试仅用 4 次本地硬上限复现，未重放 314 次。
4. 结论边界：在锁定官方 Pi/OptraCall 合成链中，没有“合法非首项被 Pi/Host 恒改成首项”的证据。真实 MiniMax 是否因供应商约束解码/serving 生成首项仍为 **NOT_PROVED**；本结果不证明真实供应商根因，也不支持改 action 顺序掩盖问题。
5. 夹具初版未兼容请求 URL 查询串，返回 404 且请求记录为 0；另修正测试 start 参数和 Host input 预期。上述为夹具修正，不计产品 RED，最终命令及断言如上保留。

## B. 共享错误码复现（RED 保留）

命令：

```bash
node --test --test-name-pattern='original strategy conversation' tests/strategy-map-host.test.ts
```

结果：**FAIL（预期修复后转 GREEN）**。

- 使用真实 Host、官方 Pi、OpenAI loopback 和实际 `save-map`。
- 输入通过 Pi 工具 schema，但含重复节点 ID，确定进入 Host 语义校验。
- 当前工具回包实际为 `personal_context_read_failed`；测试期望 `invalid_strategy_map` 且不得出现个人资料兜底，在 `tests/strategy-map-host.test.ts` 的重复节点用例失败。
- 该失败证明共享 IPC 掩盖机制可独立复现。GLM 当晚具体命中哪个校验仍为 **NOT_PROVED**；缺字段类 Pi 验参失败不与本 Host 语义反例混同。
- 同一测试还保留失败零地图版本、随后修正并保存新版本的后续断言，当前在首个错误码断言处停止，后续尚不能记为通过。

### 修复后 GREEN（与上述历史 RED 分开）

实现：`StrategyDiscussionFault` 拆出稳定 code、安全 message 和有界 details；地图 Store/Host 定点替换复合码；共享 IPC 只转发显式 `safe-tool-error-v1` 且通过白名单校验的字段，未知异常使用 `host_tool_failed` 和 diagnosticId。旧 `{error:string}` 仍可读取；合法码和 Method 大写例外保持，cleanup/abort/revoked 的后置覆盖未改。原始未知异常只在本机 Host 诊断 stderr 以关联 ID 记录，Provider/native/ProjectEvent（SSE 来源）/HTTP 不接收原异常。

验证：

- `node --test --test-name-pattern='original strategy conversation' tests/strategy-map-host.test.ts`：**PASS**。Agent 收到 `invalid_strategy_map + duplicate_item_id`，失败零写入，修正后保存并取得 `candidate-not-adopted`；HTTP 保持通用 message 和稳定 code。
- `node --test tests/strategy-map-store.test.ts`：**PASS 11/11**。覆盖 schema、重复节点、非法端点、非假设 review、未声明来源、文件标识、选页、重复选页和空地图，全部稳定 details 且零新增版本。
- `node --test --test-name-pattern='Issue 115 import draft page faults' tests/strategy-map-import-host.test.ts`：**PASS**。实际页码/选页分别返回 `strategy_map_import_page_invalid/page_outside_original` 与 `invalid_strategy_map/page_outside_selection`，修正后取得 editable draft，无正式地图写入。
- `node --test --test-name-pattern='Issue 115' tests/personal-context-runtime.test.ts`：**PASS 5/5**。安全 Fault、合法权限码、未知异常、本机关联、ProjectEvent 脱敏及 Method 例外通过。
- `node --test tests/v12-discussion-ui-client.test.ts`：**PASS 8/8**，旧 HTTP 客户端合同保持。
- 完整受影响文件回归：`personal-context-runtime.test.ts` **33/33 PASS**；`strategy-map-host.test.ts` **4/4 PASS**；`strategy-map-import-host.test.ts` **10/10 PASS**；`semantic-context-runtime.test.ts + automatic-business-feedback-v020.test.ts + method-issue-adapter-v020.test.ts` **38/38 PASS**；`strategy-workbench-integration.test.ts + strategy-discussion-host.test.ts + strategy-goal-proposal.test.ts + pm01-strategy-source-discovery.test.ts` **15/15 PASS**。
- `npm run check:agent-sessions`：**PASS**；`npm run typecheck`：**PASS**。
- 完整 `npm run check`（错误契约阶段）：**PASS**，3143 项测试 3032 通过 / 0 失败 / 111 跳过（既有平台/条件跳过），边界检查与构建通过。止损/路径提示实现后的全量 check 与浏览器验证留待最终候选。

GLM 当次具体校验分支仍为 **NOT_PROVED**；合成修复证明共享机制和上述 Host 校验，不回填真实轮事实。

## C. 绝对路径与来源边界

命令：

```bash
node --test --test-name-pattern='Issue 115 treats an absolute path' tests/strategy-map-host.test.ts
```

结果：**PASS（1/1）**。

- 战略讨论运行后的实际 tools 为 `['strategy_goals']`，没有通用 read/bash 文件工具。
- 用户 prompt 中的合成绝对路径保持文本并进入 Provider 请求；路径不会自动上传、解析或生成来源授权。
- 合成 Provider 指示模型以该绝对路径作为 `read-source.sourceId`，Host 返回既有 `strategy_discussion_source_not_selected`。
- 隔离合成文件正文标记未进入任何后续 Provider 请求，证明此路径没有发生文件内容读取。
- 代码对应：`project-session.ts` 固定工作区仅启用 strategy custom tool；`strategy-discussion-host.ts` 的 `read-source` 只在已选或合法发现的来源中按 ID 查找；项目文档 target 另有 020/060 和权限校验，但不负责解析用户消息中的原始路径。
- 结论边界：已区分“无通用文件工具”和“未选择来源 ID”；本路径不存在原始路径解析器，不能把失败归因于某个路径解析失败分支。真实各模型在试用轮为何选择某种调用或答复仍为 **NOT_PROVED**。

## D. 动作循环止损与路径提示（设计经用户确认后实现）

设计确认：[#issuecomment-7080447650](https://github.com/gadfly-hbo/OptraCall/issues/115#issuecomment-7080447650)（用户经本会话 AskUserQuestion 裁定「按方案实施」，代为记录）。

实现：
- `project-session.ts` ActiveRun 记录读取 action 的结果 SHA-256 指纹与连续计数；`createStrategyTools` 在同一 request 同读取 action 连续 6 次相同结果后、第 7 次 Host 派发前置 cancelled + `strategyLoopStopped`，复用 `rejectPersonalRequests()` 与 `session.abort()`，不在工具回调内等待自身 stop。写操作/operation/public-search 不纳入。
- `run-diagnostics.ts` 新增 `strategy_action_loop`（cancelled-only），`readRunDiagnostic` 兼容旧记录；手动取消仍为 `cancelled`。
- `StrategyDiscussionPanel.tsx` 在 cancelled+loop 时以既有 alert 显示诊断，并在 apply/重开时从 `snapshot.lastRun.diagnostic` 恢复；composer 对路径样例文本显示非阻断「＋ 添加资料」提示（排除 URL，不访问文件系统，不阻断发送）。
- `STRATEGY_CONTRACT` 系统提示、`help-content.ts` 与重新生成的 `docs/user-manual.md` 说明路径文本不等于上传/授权及止损恢复。

验证：
- `node --test --test-name-pattern='Issue 115' tests/strategy-discussion-runtime.test.ts tests/run-diagnostics.test.ts`：**PASS**。覆盖第 7 次派发前停止（6 次 Host、7 次 Provider 请求、cancelled+专用诊断）、无关参数不绕过、重开恢复诊断、下一显式请求恢复、正常翻页 8 页不误断、action/结果变化重置、写动作豁免、诊断 cancelled-only 与脱敏重建。
- `node --test tests/issue-115-strategy-path-hint.test.ts tests/help-manual.test.ts`：**PASS**。路径提示出现、普通问题/URL/空草稿不出现、非阻断；手册与帮助内容一致。
- 受影响战略/UI 回归合跑（runtime/host/issue-108/cancelled-ui/ui-client/goal-proposal/workbench/pm01）：**33/33 PASS**。
- 全量 `npm run check`（修正轨迹，见文末 F1）：test 与 build 部分 3149 项 3038 通过 / 0 失败 / 111 跳过（既有平台/条件跳过）。**但 0a29ff6 的边界步骤实际 FAIL（F1）**——该次后台 check 的 boundary 步骤跑在浏览器脚本创建之前，故当时整体 exit 0 不能代表 HEAD 门禁通过；独立复核在 HEAD 重跑 boundary 确认 FAIL。F1 修复后重跑 `check:agent-sessions` 与完整 `npm run check` 方为有效 PASS（结果见文末）。
- 浏览器点验 `node tests/browser-issue-115-strategy-loop.mjs`（隔离 Host + 合成 Provider + 系统 Chrome，未改项目依赖）：**PASS**。实际发送触发 read-goals 循环，第 7 次 Host 派发前停止（Provider 请求 7 次），既有 alert 显示止损说明；刷新后诊断恢复；composer 路径提示非阻断且发送可用；普通问题不显示提示；390px 窄屏无横向溢出；无页面错误。截图存 `.local/issue-115/browser/`（loop-stop-alert / loop-alert-after-refresh / path-hint / path-hint-narrow）。

当前不做 MiniMax 移除/专属适配、自动换模型、通用路径读取或权限放宽。真实 MiniMax/GLM/试用轮根因仍 NOT_PROVED。独立复核、Git/CI 与 Codex 集成见交付记录。

## 独立复核与 F1 修正

非作者独立复核（全新上下文、只读）对 0a29ff6 的结论见 `independent-review.md`：**产品实现 A1–A5、B1–B5、C1–C3 全部独立证实**（含复核者自写 14 项真实接缝反例：错误结果计指纹、重置边界无 off-by-one、手动取消不冒报、operation 豁免、8 种白名单绕过全拒、路径提示正负例）；基线 RED 真实；全量 test/build/浏览器点验独立重跑与作者一致；SDK 1.4.0/8.12.2 锁定未改、Interface v3、四原则与 IN01–IN06 满足。总体 **FAIL**，唯一 blocker 为 F1。

- **F1（blocker，已修复）**：0a29ff6 新增 `tests/browser-issue-115-strategy-loop.mjs` 曾 `import { createRequire } from 'node:module'`，触犯 `check-agent-session-boundary.mjs:204`（无豁免），使 HEAD 的 `check:agent-sessions`/完整 check 第一步 FAIL；作者先前那次后台 check 的 boundary 步骤跑在脚本创建之前，故整体 exit 0 不代表 HEAD 门禁通过，result.md 原“全量 check PASS”声称越过了实际失败门禁（保留原声称于 D 节修正轨迹）。**修复**：改为字面量绝对路径动态 `import()` 全局 playwright（非 SDK、非 node:module，边界干净），并清理未用 `workspaceRoot` 导入（F5）。修复后 `npm run check:agent-sessions` PASS、浏览器点验重跑 PASS（providerRequests=7、无页面错误）。产品代码未动。
- **F2（minor，后续增量）**：business-role 共享接缝 `BusinessRoleConversation.tsx` 触发止损时终态安全但不呈现 loop 恢复说明；工单 UI 范围限 StrategyDiscussionPanel，不阻断本单，记录为后续在该消费者复用同一诊断呈现。
- **F3（minor，后续窄修复）**：`explainGoalProposalError` 按 error.message 精确查表；当前 goal fault 均 code-only 行为保持，将来加安全 message 会静默失效，建议改按 error.code 查表。
- **F4（nit，已知边界）**：路径提示对含空格路径、file:// URL、UNC 无盘符漏报，对 `a.md.bak` 过报；提示为非阻断建议，C3 不要求穷尽检测，不扩权/无 fs 访问成立。
- **F6（nit，已知边界）**：同一 assistant 消息并行 execute 时计数非原子，理论上同批可短暂超 6 次派发；顺序循环（工单症状）语义精确，重置逻辑保证不误停。记录为已知边界，不扩范围。
- **F7（nit，已修复）**：result.md 头部过期状态已更新。

修复后重验（受影响范围：边界门禁 + 完整 check + 浏览器点验 + 新 HEAD 身份）：见下方交付记录。产品逻辑无需重测（复核已独立证实）。

## 交付记录

- F1 修复后作者重跑：`npm run check:agent-sessions` **PASS**；完整 `npm run check` **PASS**（boundary && test && build，3149 项 3038 通过 / 0 失败 / 111 跳过）；`node tests/browser-issue-115-strategy-loop.mjs` **PASS**（providerRequests=7、pageErrors=[]）。
- 非作者修复后重验：**PASS**（见 `reverify.md`）。F1 解除、`check:agent-sessions` PASS、完整 check exit 0（3149/3038/0/111）、浏览器点验 PASS（providerRequests=7、pageErrors=[]）；0a29ff6 以来仅测试脚本与文档改动、src/ 零改动、无产品回归；本地与远端 HEAD 一致。
- 候选提交：F1 修复与复核证据提交 `c64061a447db24ae03db707700565284776c5353`（产品代码即此 SHA，经独立重验）；本记录与重验证据另以文档提交补记，最终 HEAD 见 Issue 交付回执回读。
- 交回 Codex：实现交付回执（身份/版本、完成情况、验证与限制）留于 #115；Codex 负责非作者复核接管、集成最新 main、单 PR 实际 head CI、获授权 squash 合并与 main push CI、结案。本单不直接合并 main、不更新设备/服务。
- 已知限制与后续增量：F2（business-role 接缝 loop 诊断呈现）、F3（explainGoalProposalError 改按 code 查表）、F4（路径提示含空格/file:// 覆盖）、F6（并行批次计数竞态）；真实 MiniMax/GLM/试用轮根因 NOT_PROVED。回退：任务分支独立、无持久 schema 迁移，按候选 SHA 由 Codex/用户决定，不覆盖新增地图版本/native 历史。

## 返工修复（Codex 审核退回 180c894，[#issuecomment-7088759365](https://github.com/gadfly-hbo/OptraCall/issues/115#issuecomment-7088759365)）

审核指出 A3/A4/A5、B2/B3/B4 与共享入口影响共 5 项。逐项修复并补反例：

1. **并行批次越过第七次派发（A3/A4）**：原检查在派发前读旧计数、回包后才计数，Pi 并行批次可一次派发 8 次相同读取。修复：战略共创全量工具声明 Pi 原生 `executionMode:'sequential'`（`pi-agent-core` 批次中任一工具声明即整批逐工具执行），使批次内按结果结算计数。反例：一批 8 次相同 read-goals → 最多 6 次 Host 派发、cancelled+`strategy_action_loop`、下一请求恢复；5 次顺序＋2 调用批次 → 6 次派发。均 PASS。
2. **豁免动作保留旧计数误停（A3/A5）**：原非读取动作不重置读取计数，6 次 read-goals 后一次 operation 成功再 read-goals 被误停。修复：任何非读取动作派发即清空 `strategyReadLoop`（动作变化重置）；写入/operation/public-search 仍豁免计数。反例：6 read-goals＋operation＋read-goals → completed、无 loop 诊断。PASS。
3. **错误回包回显原始路径（B4）**：无效连线 ID 为绝对路径时，details.itemId 按自由文本转发，回显到工具回包/native toolResult/快照。修复：校验详情改用公开字段路径＋结构下标定位（如 `edges[0].sourceLocation.page`），itemId 经 `safeStrategyItemId` 脱敏（含 `/`、`\`、盘符、`~`、控制字符即省略）；IPC `safeToolFault` 同样仅省略不安全 itemId、保留 reason/path。反例：路径 ID 无效连线 → 工具回包/native toolResult/快照 toolResult/下一 Provider tool 结果均不含该路径，结构下标可定位，零写入。PASS。（模型提交的 toolCall 参数本身含输入路径属原始输入，非错误回包泄露。）
4. **已知 scenario 校验被中性兜底（B2/B3）**：`parseStrategyScenarioModel` 生成 camelCase 码（如 `invalid_scenario_baselineRate`）不匹配 IPC 小写白名单 → `host_tool_failed`。修复：scenario 码统一 snake_case（`invalid_scenario_baseline_rate` 等，数据字段名不变），工具链与 HTTP 均保留稳定原因。反例：`scenarioModel.baselineRate=-1` → 工具链收到 `invalid_scenario_baseline_rate`（非 host_tool_failed）、零写入；修正 baselineRate=10 保存一版取得 candidate-not-adopted。既有 simulation 断言随稳定码更新。PASS。
5. **共享入口静默停止（作用域）**：止损原作用于所有 strategy-discussion profile（含 business-role project-sources/goal-draft），后者 UI 不呈现该诊断 → 静默取消。修复：止损作用域收回已确认的战略共创全量工具（`loopGuard = !workspace.discussionTools`），business-role 变体不纳入计数/取消，亦不声明 sequential。反例：project-sources 变体 8 次相同 read-source → completed、无 loop 诊断。PASS。战略共创主面板 alert/重载恢复经浏览器点验仍通过。

返工验证：止损反例 10/10、错误契约返工反例 PASS、地图/共享 IPC/UI 65/65、simulation 6/6、战略 host/runtime/goal-proposal/pm01/workbench 套件 PASS。返工后最终全量 `npm run check`：**PASS**（boundary && test && build，3154 项 3043 通过 / 0 失败 / 111 跳过）；`npm run typecheck` PASS；浏览器点验 `node tests/browser-issue-115-strategy-loop.mjs` **PASS**（providerRequests=7、pageErrors=[]，止损 alert/重载恢复/路径提示/窄屏）。真实 MiniMax/GLM/试用轮根因仍 NOT_PROVED。

返工独立重验：**PASS**（见 `rework-review.md`，非作者全新上下文，自写反例独立复现）。5 项逐项解除：并行批次恰 6 次派发且串行 maxActive=1、豁免不误停、路径 ID 全通道不回显且结构下标定位、scenario 稳定码非兜底、作用域收回全量工具且变体不静默取消。check:agent-sessions/typecheck/完整 check（3154/3043/0/111，build 标记 49f140a）/浏览器均 PASS；SDK 1.4.0、undici 8.12.2、Interface v3 未改；diff 仅 10 文件，未改 SDK/锁/agent-sessions 生命周期。剩余阻断：无。两条非阻断观察：批次止损后第 8 调用原生无 toolResult 系 SDK abort 原生行为（线上全配对、恢复完成，非缺陷）；strategy-trials.ts 遗留 camelCase 码仅走 HTTP/UI、不进工具链，属范围外既有命名不一致。

返工候选：`49f140a91fca050fa00e6e88db10d4bbe35174a0`（产品代码经独立重验）；本记录与重验证据另以文档提交补记，最终 HEAD 见 Issue 返工回执回读。交回 Codex 集成最新 main（审核时 main 为 0da160bcf3cc28e91811e97911c19ccc2546f3f0，只读预检无文本冲突），共享运行时与战略界面在集成候选上重验。

# Issue #115 候选非作者独立复核报告

- 复核对象：`work/qoder/issue-115-strategy-actions` @ `0a29ff6a23566f55e0b89b8661b20b4d411a4f75`（实现提交 `93862cb` 错误契约、`0a29ff6` 止损与路径提示；设计提交 `3a94489`）
- 基线：`e2aecfb445094245875b9696a02a273b5e0ddb44`
- 工作树：`/Users/bendandebaba/.qoder-cn/worktrees/issue-115-strategy-actions`（复核开始时工作树干净，HEAD 与声称 SHA 一致；远端 `git ls-remote` 回读同 SHA）
- 复核者：非作者独立复核（未参与候选任何创作）；只读复核，未修改任何源文件/测试/规格/既有证据。复核产物仅写入 `.local/issue-115/review/`（gitignore 内）与系统临时目录 `/tmp/issue115-red-5wBBNh`（基线 RED 复现用，git archive 抽取，node_modules 符号链接仅用于该隔离复现）。
- 证据文件（本目录）：`targeted-issue115.log`、`store-path-help.log`、`host-green.log`、`check-agent-sessions.log`/`check-agent-sessions2.log`、`typecheck.log`、`full-test.log`、`build.log`、`baseline-red.log`、`baseline-boundary.log`、`counterexamples.test.ts`/`counterexamples.log`（复核者自写反例，14 项）、`browser-check.mjs`/`browser-check.log`/`browser/*.png`（原浏览器脚本的位置无关副本，仅改证据输出目录与模块解析路径，逻辑逐行一致）。

## 总体结论：FAIL（交付阻断，需作者修复后复核）

产品实现本身（A 止损、B 错误契约、C 路径边界）经独立验证均成立，未发现产品代码 blocker。但候选 HEAD 未通过强制工程门禁 `npm run check:agent-sessions`（完整 `npm run check` 的第一步），且 result.md 声称“最终全量 npm run check：PASS”与 HEAD 实际不符。按工程规范 D1 与证据规则，候选不能按当前状态交付。修复范围小且 localized（仅测试脚本与证据记录），修复后预期可转 PASS。

## 一、修改范围审计（git diff e2aecfb..0a29ff6）

21 个文件，+954/-42。逐项核对全部落在 spec 允许路径内：

- `src/agent/project-session.ts`、`project-runtime.ts`、`run-diagnostics.ts` ✓
- `src/host/strategy-discussion-fault.ts`、`strategy-map-store.ts`、`strategy-discussion-host.ts` ✓
- `src/host/ui/StrategyDiscussionPanel.tsx`、`help-content.ts`、`docs/user-manual.md` ✓
- `tests/**`（含新夹具 `tests/fixtures/anthropic-tool-provider.ts`、新浏览器点验脚本）✓
- `openspec/changes/issue-115-strategy-actions/**` ✓

越权检查：**未改** `package.json`/`package-lock.json`、`node_modules`、官方 Pi SDK、`src/host/agent-sessions.ts`（公共生命周期）、`src/agent/strategy-discussion.ts`、`src/agent/sdk.ts`、其他无关模块。`scripts/` 无改动。`npm ls` 实际 `@earendil-works/pi-coding-agent@1.4.0`、`undici@8.12.2 (overridden)`；`check-pi-sdk.mjs` 的锁定材料检查（官方 archive URL、SHA-512 integrity、无 symlink/替换、无补丁脚本）在 HEAD 通过（唯一违规来自浏览器脚本，见 F1）。`AGENT_SESSION_INTERFACE_VERSION = 3` 未变。

## 二、独立运行的检查与结果

| 命令（工作树根） | 结果 |
| --- | --- |
| `node --test --test-name-pattern='Issue 115' tests/strategy-discussion-runtime.test.ts tests/run-diagnostics.test.ts tests/personal-context-runtime.test.ts` | PASS 12/12 |
| `node --test tests/strategy-map-store.test.ts tests/issue-115-strategy-path-hint.test.ts tests/help-manual.test.ts` | PASS 14/14 |
| `node --test --test-name-pattern='original strategy conversation\|Issue 115' tests/strategy-map-host.test.ts tests/strategy-map-import-host.test.ts` | PASS 3/3（GREEN＋路径边界＋导入页码） |
| `npm run check:agent-sessions` | **FAIL（exit 1）**，唯一违规：`tests/browser-issue-115-strategy-loop.mjs:11: feature module loaders cannot bypass the reviewed import paths` |
| `npm run typecheck` | PASS |
| `npm run test`（全量） | PASS：3149 项，3038 通过 / 0 失败 / 111 跳过（与作者数字一致） |
| `npm run build` | PASS（Trial build: 0.1.0-mvp.4 0a29ff6） |
| 基线 RED 复现：`git archive e2aecfb` → /tmp 隔离目录，拷入 HEAD 版 `tests/strategy-map-host.test.ts`，`node --test --test-name-pattern='original strategy conversation'` | **FAIL（预期 RED 真实）**：actual `'personal_context_read_failed'`，expected `/invalid_strategy_map/`，与作者声称一致 |
| 基线边界检查（同隔离目录） | 无 “feature module loaders” 违规（仅本复核符号链接 node_modules 触发的锁定材料误报，属环境伪影）→ 证明 F1 违规由 `0a29ff6` 引入 |
| 复核者反例 `node --test .local/issue-115/review/counterexamples.test.ts` | PASS 14/14（见下） |
| 浏览器点验（原脚本副本，系统 Chrome＋全局 playwright，dist 为独立 build 产物） | PASS：providerRequests=7，pageErrors=[]，止损 alert、刷新恢复、路径提示非阻断、390px 无横向溢出 |

复核者反例要点（均经真实 ProjectAgent/官方 Pi/loopback 接缝，非 mock 单元）：

1. REVIEW-1：恒同错误结果（`strategy_discussion_source_not_selected`）也按稳定 code 计指纹，6 次派发后第 7 次 Host 前停止，cancelled＋专用诊断（设计明确错误结果纳入）。
2. REVIEW-2：重置边界精确——5 同＋1 异＋6 同，第 12 次调用才停止（11 次 Host 派发、12 次 Provider 请求），阈值无 off-by-one。
3. REVIEW-3：循环中手动 `agent.stop()` → 终态 cancelled、诊断为普通 `cancelled`，不冒报 loop。
4. REVIEW-4：`operation` 轮询恒同结果 8 次全部派发、completed，豁免成立（`public-search`/写动作不在 `STRATEGY_READ_ACTIONS`，代码核对一致）。
5. REVIEW-5：8 种白名单绕过尝试在真实 IPC 接缝全部被拒——details 夹带额外键/大写 reason/文件系统 path/控制字符 itemId/21 条 issues、message 控制字符/超 2000 字、exposure 标记夹带非法 code；原始标记未进入 Provider/native/ProjectEvent，非法 code 落 `host_tool_failed` 且原异常仅留本机 console.error。
6. REVIEW-6：路径提示正例（绝对/Windows/~//相对/中文文件名）出现且发送可用；普通问题/http(s) URL/空草稿不出现；**记录两类建议性漏报**（含空格路径、file:// URL，见 F4）。

## 三、关键实现独立审读结论

- 止损（project-session.ts:706-723）：检查在 `assertCurrent()` 与 action 合法性之后、`requestHostTool` 之前 → 第 7 次零 Host 派发成立；`strategyLoopStopped/cancelled` 置位后 `rejectPersonalRequests()`＋fire-and-forget `session.abort()`，execute 立即 throw，不在回调内等待自身 stop → 无死锁；结算复用既有 cancelled 路径，`runDiagnostic(actionLoop)` 仅在 cancelled 时给 `strategy_action_loop`。指纹 SHA-256 覆盖完整 result（content/details，含图片）或错误的 {code,details}，参数不参与；action/结果变化即重置；计数挂在 ActiveRun（同 request，含原生重试），新显式请求自然重置。迟到回包：pending 已清，reply handler `if (pending)` 忽略；Host 侧 `available()` 代际保护未改。
- 生产有效性：read-goals/find-sources/read-source/read-map 的 payload 均为存储状态＋输入的确定函数（payload() 无时间戳/随机字段），真实重复读取会产生相同指纹 → 止损对真实循环有效，而非仅合成测试有效。
- 错误契约（project-runtime.ts:52-88,252-263）：仅 `exposure==='safe-tool-error-v1'` 且过白名单的 message/details 转发；message≤2000 且禁控制字符；issues≤20、键白名单 reason/path/itemKind/itemId/page、reason 正则、path 禁 `/` 等、itemId 禁控制字符、总字节≤16KB。未知异常 → `host_tool_failed`＋diagnosticId，原异常仅 console.error 到 Host 父进程本机 stderr（子进程 stderr 在 ready 后 resume 丢弃，不进事件/SSE/HTTP）。旧 `{error}` 形状兼容；合法码/Method 大写例外保持。
- Host 分类改读 code（strategy-discussion-host.ts:472,482,937）：原 `e.message` 正则改为 `e.code` 正则；StrategyDiscussionFault 旧构造 message=code，行为等价；新带 message 的 fault 不再被误分类。全 src 已无 `personal_context_read_failed` 与 `invalid_strategy_map:` 复合码残留。HTTP 两处 fault 序列化（server.ts:2993,3003）仍只输出 code＋固定白名单 message，不含 details → HTTP 客户端合同保持（ui-client 测试与 host 测试双重验证）。
- 校验零写入：store 校验全部前置在写入前；host 测试断言失败版本数不变、修正后＋1 版且 `candidate-not-adopted`。
- UI：cancelled＋loop 经 run.settled 与 apply(snapshot.lastRun.diagnostic) 双通道恢复既有 alert；手动取消不受影响；composer 提示为纯前端正则（无文件系统访问）、`role="note"` 非阻断、已选附件时不显示；系统提示/帮助/手册三处一致（help-manual 测试通过）。

## 四、发现（按严重度）

### F1 · BLOCKER — HEAD 未通过强制边界门禁，且 result.md 的全量 check PASS 声称不可复现
- 文件:行：`tests/browser-issue-115-strategy-loop.mjs:11`（`import { createRequire } from 'node:module'`）；规则 `scripts/check-agent-session-boundary.mjs:204`；证据声称 `openspec/changes/issue-115-strategy-actions/result.md:94`。
- 问题：边界检查禁止 src/extensions/scripts/tests 内任何文件 import `createRequire`（无豁免清单）。该脚本由最终提交 `0a29ff6` 引入，使 `npm run check:agent-sessions` exit 1，完整 `npm run check`（= boundary && test && build）在第一步即失败。result.md 声称“最终全量 npm run check：PASS，3149 项…”。独立复核：test 与 build 确实通过且数字吻合，但 boundary 在 HEAD 必然失败（纯词汇规则，与环境无关）；基线无此违规。推断作者在加入浏览器脚本后未重跑 boundary/完整 check，或仅跑了 test+build。按 D1“未跑项不冒充通过”，该声称不成立。
- 建议：去掉 createRequire——例如以**字面量绝对路径动态 import** 加载全局 playwright（`await import('/opt/homebrew/.../playwright/index.js')`，字面量 import 不触发 non-literal 规则，也不命中任何受限 target），或将该脚本移出扫描目录并按规范评审；随后重跑完整 `npm run check` 并在 result.md 以实际输出更正证据（保留原声称与修正轨迹）。产品代码无需改动。

### F2 · MINOR — 共享战略接缝的 BusinessRoleConversation 不呈现 loop 专用诊断
- 文件:行：`src/host/ui/BusinessRoleConversation.tsx:85`（run.settled 仅触发 reload，无 diagnostic 渲染）。
- 问题：business-role 讨论与战略讨论共用同一 execute 止损接缝；该处触发止损时终态安全（cancelled、历史保留、可显式重发），但用户看不到 `strategy_action_loop` 恢复说明，仅见取消态。工单 UI 范围限于 StrategyDiscussionPanel，故非阻断。
- 建议：后续增量在该消费者复用同一诊断呈现，或在规格中明确其呈现边界。

### F3 · MINOR — explainGoalProposalError 依赖 error.message 精确相等，接缝变脆
- 文件:行：`src/agent/strategy-discussion.ts:94`（`Object.hasOwn(proposalErrorReasons, error.message)`）。
- 问题：IPC 重建后的 error.message 在存在安全 message/details 时为拼接串。当前所有 goal 提案 fault 均为 code-only（message=code），行为保持（已核对全部构造点）；但将来给这些码加安全 message/details 会使解释静默失效。
- 建议：改按 `error.code` 查表（本变更未改该文件，可作后续窄修复）。

### F4 · NIT — 路径提示的建议性漏报/过报
- 文件:行：`src/host/ui/StrategyDiscussionPanel.tsx:36-39`（mentionsLocalFilePath）。
- 证据：REVIEW-6 实测 `/Users/x/My Plan.md`（含空格）与 `file:///Users/x/plan.md`（被 URL 剥离一并排除）不触发；UNC `\\server\share\a.pdf` 无盘符不触发；`a.md.bak` 会按 `.md` 过报。
- 影响：提示为非阻断建议，C3 不要求穷尽检测；不阻断、不扩权、无 fs 访问均成立。建议在帮助措辞或后续增量中覆盖 file:// 与含空格路径。

### F5 · NIT — 浏览器脚本可移植性与冗余
- 文件:行：`tests/browser-issue-115-strategy-loop.mjs:16`（硬编码 `/opt/homebrew/...` 全局 playwright 路径）、`:13`（`workspaceRoot` 导入未使用）。
- 影响：仅本机可跑（本次复核确认可跑）；换机即 NOT_RUN。建议路径可配置化并清理未用导入（与 F1 一并处理）。

### F6 · NIT — 并行工具批次的计数竞态
- 文件:行：`src/agent/project-session.ts:707-717`。
- 问题：同一 assistant 消息内并行 execute 时，检查与计数非原子，理论上可在 count=5 时同批两次派发（Host 派发短暂超过 6）。顺序循环（工单症状）语义精确；重置逻辑保证不会误停。
- 建议：记录为已知边界即可，无需为本单扩范围。

### F7 · NIT — result.md 头部状态陈述过期
- 文件:行：`openspec/changes/issue-115-strategy-actions/result.md:5,11`（“止损/恢复与 composer 提示待 Issue 设计确认”“完整测试/build 尚未运行”）与 D 节已完成陈述矛盾。
- 建议：随 F1 证据更正一并更新头部状态。spec 的 D1–D3 未勾选属正常（复核/交付未完成）。

## 五、验收项独立核定

| 项 | 状态 | 依据 |
| --- | --- | --- |
| A1 wire/分片/Pi/Host/下一请求对齐、非首项正例 | 独立证实 | 12/12  targeted 中的对齐测试：schema 含全部 action、多段 input_json_delta、requestNumber/toolCallId 对齐 native 与下一请求 tool_result |
| A2 注入 read-goals＋无关参数原样分派 | 独立证实 | 注入测试 PASS；真实 MiniMax 供应商根因 **NOT_PROVED**（作者正确保留，未以合成链回填） |
| A3 N=6、第 7 次 Host 前取消、参数不参与、action/结果重置、写/operation/public-search 豁免 | 独立证实 | 作者测试＋REVIEW-1/2/4；设计确认评论 #issuecomment-7080447650 经 gh 核对存在且与实现一致 |
| A4 cancelled＋专用诊断、手动取消不冒报、第 7 次零派发、迟到安全、历史保留、刷新/下一请求恢复 | 独立证实 | delivered=6/requests=7；REVIEW-3 手动取消；reopen 恢复测试；浏览器刷新恢复；迟到回包结构安全 |
| A5 不绕过、不误断、不自动换模型 | 独立证实 | 8 页分页/交替 action/写豁免测试；诊断仅文字建议，无配置改写代码 |
| B1 真实 Host/Pi 复现 personal_context_read_failed 并保留 RED | 独立证实 | 基线隔离复现 FAIL（actual=personal_context_read_failed）；HEAD GREEN；GLM 当次分支 **NOT_PROVED** 保留 |
| B2 稳定 code＋白名单 details、不再 message 正则分类 | 独立证实 | store 11/11、导入页码 host 测试、code 分类审读、无复合码残留 |
| B3 旧 {error} 兼容、安全转发、合法码/Method/取消/权限保持、未知中性＋本机关联 | 独立证实 | personal-context 5/5＋REVIEW-5 八种绕过全拒 |
| B4 原始异常/堆栈/路径/凭据不进模型/native/SSE/HTTP/公开日志 | 独立证实 | 标记物全通道缺席断言＋HTTP 固定 message 审读＋stderr 去向审读 |
| B5 失败零写入、修正保存一版＋candidate-not-adopted | 独立证实 | host GREEN 测试版本数断言 |
| C1 仅 strategy_goals、路径不转来源、冒充 sourceId 拒绝、正文不泄露 | 独立证实 | 路径边界测试（tools 断言、marker 缺席） |
| C2 三类边界区分、不唯一归因 | 独立证实（边界区分）；真实各模型选择 **NOT_PROVED** 保留 |
| C3 系统提示＋非阻断 composer＋帮助、普通问答/附件/分页不变 | 独立证实 | 提示测试＋REVIEW-6＋help-manual＋浏览器点验 |
| D1 定向 RED/GREEN、回归、完整 check、隔离与浏览器分别记录 | **部分**：RED/GREEN/回归/typecheck/build/浏览器均独立通过；**完整 npm run check 在 HEAD FAIL（F1）**，作者声称不实 |
| D2 非作者复核＋四原则专项 | 本报告完成 |
| D3 固定候选推送回读 SHA＋Issue 回执 | 远端 SHA 与 HEAD 一致（已回读）；Issue 实现交付回执为 Codex 后续步骤，不在本复核范围 |

## 六、四原则与 IN01–IN07 专项检查

- **Host 管环境**：止损是技术预算/取消治理（重复无进展读取的有限停止），错误契约与路径说明属环境/权限澄清。✓
- **Agent 自主执行**：不推断/重写 action、不指定下一步、不补读/修图、不自动换模型或重发、不自动上传；有效不同结果与正常分页继续（实测）。✓
- **复用 Pi**：复用 custom tool execute、ActiveRun、`session.abort()`、pending 撤销、run diagnostic、native 历史；未新建 Agent loop/域/Runtime/全局队列（agent-sessions.ts 未改，边界检查确认无新 ProjectAgent owner）。✓
- **减少人的操作**：正常路径零新增确认；失败后仅建议用户明确切换已配置模型；路径提示复用既有「＋ 添加资料」。✓
- IN01 Interface v3 ✓；IN02/IN03 无新域/构造路径/代际 Map/队列，取消复用公共生命周期 ✓；IN04 Host 不替 Agent 选择 ✓；IN05 全部合成 loopback（夹具强制 127.0.0.1），未触真实 Provider/资料/设备 ✓；IN06 无 SDK 内部例外、官方包未改（锁定检查通过）✓；IN07 覆盖正常/分片/取消/代际/迟到/保存恢复/共享消费者/旧 IPC ✓，但“最终运行完整 npm run check”在 HEAD 未满足（F1）✗。

## 七、作者证据真实性核定

- 真实且可复现：A 节 2/2 与后续止损测试、B 节 RED→GREEN、store 11/11、导入页码、personal-context 5/5、ui-client 8/8、typecheck、全量 test 数字（3149/3038/0/111）、build、浏览器点验（本次独立重跑 PASS）、远端 SHA。
- **不实/不可复现**：result.md:94 “最终全量 npm run check：PASS”——HEAD 的 boundary 步骤必然失败（F1）。其引用的测试数字与独立全量 test 一致，说明 test/build 部分真实，但“完整 check”声称越过了实际失败的门禁。
- 正确保留的 NOT_PROVED：真实 MiniMax 供应商根因、GLM 当次校验分支、真实试用轮各模型选择；未发现以合成证据回填真实轮事实。
- 过期陈述：result.md 头部（F7）。

## 八、处置建议

1. 作者修复 F1（仅浏览器脚本加载方式＋重跑完整 check＋更正 result.md，保留原声称与修正轨迹），顺带处理 F5/F7；F2/F3/F4/F6 可记录为后续增量，不阻断本单。
2. 修复后由复核者重跑 `npm run check:agent-sessions` 与完整 `npm run check` 并回读新 SHA；产品逻辑无需重测（本次已独立证实），但新 HEAD 需重新固定身份。
3. 在此之前不建议 Codex 集成/PR/合并。
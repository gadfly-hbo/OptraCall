# Issue #115 实施与验证记录

## 当前状态

阶段：分层复现完成，错误契约已由 RED 转为 GREEN；止损/恢复与 composer 提示待 Issue 设计确认。当前候选尚非完整工程交付。

- 基线：`e2aecfb445094245875b9696a02a273b5e0ddb44`
- 分支：`work/qoder/issue-115-strategy-actions`
- Interface v3；owner `StrategyDiscussion/o.id`；profile `strategy-discussion` / unmanaged。
- 依赖按锁文件 `npm ci` 安装；`npm ls @earendil-works/pi-coding-agent undici --depth=0` 实际为 1.4.0 / 8.12.2（overridden），未修改依赖或官方包。
- `npm run typecheck`：**PASS**。完整测试/build 尚未运行；下述预期 RED 保留，不能据此宣称完整候选通过。
- 未调用真实 Provider，未读取真实原生会话或业务资料，未操作设备/服务。所有模型输出均为本机 loopback 合成数据。

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
- 最终全量 `npm run check`：**PASS**，3149 项测试 3038 通过 / 0 失败 / 111 跳过（既有平台/条件跳过），边界检查与构建通过。
- 浏览器点验 `node tests/browser-issue-115-strategy-loop.mjs`（隔离 Host + 合成 Provider + 系统 Chrome，未改项目依赖）：**PASS**。实际发送触发 read-goals 循环，第 7 次 Host 派发前停止（Provider 请求 7 次），既有 alert 显示止损说明；刷新后诊断恢复；composer 路径提示非阻断且发送可用；普通问题不显示提示；390px 窄屏无横向溢出；无页面错误。截图存 `.local/issue-115/browser/`（loop-stop-alert / loop-alert-after-refresh / path-hint / path-hint-narrow）。

当前不做 MiniMax 移除/专属适配、自动换模型、通用路径读取或权限放宽。真实 MiniMax/GLM/试用轮根因仍 NOT_PROVED。独立复核、Git/CI 与 Codex 集成见交付记录。

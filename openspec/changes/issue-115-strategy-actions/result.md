# Issue #115 实施与验证记录

## 当前状态

阶段：分层复现完成，错误契约为已确认 RED，止损/恢复与 composer 提示待 Issue 设计确认。当前候选尚非完整工程交付。

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

## 待设计确认

推荐方案见 spec A3–A5、C3：读取 action 连续 6 次相同结果后第 7 次派发前取消；专用 `strategy_action_loop` 取消诊断；既有 alert 恢复说明；系统提示、composer 非阻断文字和帮助说明“路径不等于上传/授权，请用＋添加资料”。未获 Issue 确认前不实现这些产品行为。

当前不做 MiniMax 移除/专属适配、自动换模型、通用路径读取或权限放宽。后续错误契约实现、完整回归、独立复核、Git/CI 和 Codex 集成均未完成。

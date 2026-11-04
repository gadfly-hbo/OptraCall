# 产品入口原生联网：现有配置有限实测

日期：2026-11-04（Asia/Shanghai）。本次依据用户“你试一下现有模型”的补充授权，通过现有配置各做一次公开查询；不更换模型/端点、不重放失败请求、不切换服务、不操作 MacBook。本文为真实验证作者记录，不代替非作者独立复核、完整工程验收或产品验收。

## 身份与隔离

- 入口：本工作树 `src/agent/project-runtime.ts` 的生产 `ProjectAgent` → 原 `scripts/project-entry.mjs` → 原 `src/agent/project-session.ts`。`codeRoot` 固定本工作树；没有另建模型调用循环。
- SDK：`@earendil-works/pi-coding-agent@1.4.0`；Node `v25.9.0`。实际源文件 SHA-256 固定于 [identity.json](../../../.local/task-agent-capabilities/product-live/run-2026-11-03T16-18-21-166Z/identity.json)，运行前后五个相关源码摘要一致。
- 原 `~/.optracall/settings.json` / `auth.json` 只读；配置冻结后密钥只在内存和原生产 IPC 中使用。没有输出/保存密钥或 HTTP headers，没有改原配置。
- 每模型均使用全新的 project（三目录）、resources、native 根，位于本地持久证据根；隔离 resources 的 settings 关闭 retry（maxRetries=0）与 cache warming。
- 仅测试根放置可信扩展，在 `before_agent_start` 清空全部本地 active tools，并以 `tool_call` 拒绝作为后备，确保该公开问题只测试产品 nativeSearch。**这是本次验证隔离措施，不是产品默认工具策略。** 两模型均无本地工具请求/执行；未调用 read/bash/write/subagent。
- 每个 operation 截止 90 秒，到时 stop 并等待 close；失败/取消不重试。SDK 对 `pause_turn` 的自然续接仍属于同一次 operation，逐 HTTP 记录。

原提问：

> 请用本次原生联网搜索查Pi官方Packages的pi-subagents页面，回答页面显示的当前包版本和许可证，给至少一个本次实际结构化来源URL；找不到就明确不足，不编造，不调用本地工具。

## 结果

| 项目 | MiniMax M3.1 Flash | MiMo V2.6 Flash |
| --- | --- | --- |
| profile/revision | `minimax-m31-flash` / 5 | `mimo-v26-flash` / 2 |
| Provider/API/model | `minimax-cn` / `anthropic-messages` / `MiniMax-M3.1-Flash` | `xiaomi-token-plan-cn` / `openai-completions` / `mimo-v2.6-flash` |
| 原 base URL | `https://api.minimaxi.com/anthropic` | `https://token-plan-cn.xiaomimimo.com/v1` |
| 时间（北京时间） | 00:18:21–00:19:51 | 00:18:21–00:18:49 |
| 实际 HTTP | 2 次，均 200；首次 pause 后 SDK 续接 | 1 次，200 |
| operation 结果 | 90 秒截止，`cancelled`；close 完成，无最终答案 | `completed`，约 28.7 秒；明确报告问题所需证据不足 |
| 保留的结构化来源 | 66 个去重 URL | 3 个 URL |
| 供应商搜索专用用量 | 未返回专用计数；首回执有 11 个 server_tool_use、10 个 result 块 | `tool_usage:3`、`page_usage:3` |
| 本地工具 | 0 请求/执行 | 0 请求/执行 |

**结论分别记录：** 两条原配置均已实际产生原生检索及结构化来源，并通过产品消息投影与 JSONL 保存；“无工具请求回答无法联网”不是这些接口不存在原生搜索的证据。本次特定问题的完整作答仍未通过：MiniMax 在截止时取消；MiMo 未检得所问的官方页面和版本/许可字段，诚实说明不足。不能把 HTTP200、检索发生或技术保存闭环写成答案正确/专业 PASS。

### MiMo 的实际回答与来源

回答开头为：“本次搜索结果中没有出现 Pi 官方 Packages 的 pi-subagents 页面，也未包含该包的当前版本号和许可证信息，因此无法回答，不作编造。”它给出本次来源并区分宿主版本与包版本，未补造版本/许可证。三条实际结构化来源是：

- [KARASzz 中英资料库](https://github.com/KARASzz/pi.datacore-zh-en)
- [edxeth/pi-subagents](https://github.com/edxeth/pi-subagents)
- [npm 包页](https://www.npmjs.com/package/pi-subagents)

来源来自 `optracallNativeSearch.sources`，不是从回答文字抽取。实际回答、snapshot、原生 JSONL 与供应商专用搜索计数均保留；模型没有访问到官方页面这个结果不隐去。

### MiniMax 的实际检索与取消

首次完成回执以 `pause_turn` 结束，保留服务端 tool/result 原块及来源；Pi 自然产生第二个 HTTP 请求，本次不另发用户问题、不重放。第二请求在截止时取消，没有可交付最终回答。

结构化来源中包括 [Pi 官方 pi-subagents 页面](https://pi.dev/packages/pi-subagents) 及其 HTTP 版本。独立公开 GET 均返回 200，页面标题为 `pi-subagents · Packages · Pi`，正文可核对 `0.84.0` 与 `MIT`。这些是验证者读回的证据，**不能回填为 MiniMax 已回答版本/许可证**。

首个已完成 assistant 的 SDK usage 为 `137060 totalTokens`（含 cacheRead），后续中断请求的最终用量未知。一次公开问题可能触发多次供应商内部搜索；HTTP 次数、搜索块数、SDK token/cost 估计与供应商账单是不同指标。尤其 MiMo SDK cost=0 不代表免费，两模型本次实际结算费用均未核对。

## URL 独立读回与保全

对全部 69 个结构化 URL 各做一次不带认证/Cookie 的 curl GET，保留最终 URL、HTTP 状态、content type 与正文：

| 来源模型 | URL 数 | HTTP200 | HTTP403 | HTTP404 |
| --- | ---: | ---: | ---: | ---: |
| MiniMax | 66 | 49 | 16 | 1 |
| MiMo | 3 | 2 | 1 | 0 |
| 合计 | 69 | 51 | 17 | 1 |

403 表示独立读回被来源站拒绝，不能确认其正文；404 的 `licensie.com/npm/packages/@gotgenes/pi-subagents/19.2.0` 保留为失效来源。HTTP200 只证明该 URL 当时可读，不自动证明页面与问题相关、内容正确或全部搜索来源可靠。

证据根：`.local/task-agent-capabilities/product-live/run-2026-11-03T16-18-21-166Z/`。

- [配置/源码身份](../../../.local/task-agent-capabilities/product-live/run-2026-11-03T16-18-21-166Z/identity.json)；各模型目录内 `configuration.json`（无 key）、`observations.jsonl`、`events.json`、`result.json`、`snapshot.json`、`native/`。
- [URL 逐条读回记录](../../../.local/task-agent-capabilities/product-live/run-2026-11-03T16-18-21-166Z/url-readback/results.json)，同目录为公开正文副本。
- [最终密钥扫描](../../../.local/task-agent-capabilities/product-live/run-2026-11-03T16-18-21-166Z/final-secret-scan.json)：91 个文件，检查 raw/JSON escaped/URL encoded/base64/base64url 的去重 5 个实际 key 变体，命中 0；[证据文件摘要](../../../.local/task-agent-capabilities/product-live/run-2026-11-03T16-18-21-166Z/manifest.json)。

诊断只记 HTTP method/origin/path/status，不保存 headers 或完整请求。测试扩展的 `before_provider_request` 观察在产品原生搜索适配前执行，所以其 `toolTypes:[]` 仅证明本地工具已清空，不能解释为线上的最终 tools 未声明；实际原生搜索以供应商结构块、来源回执、专用用量及 HTTP 往返共同核对。

## 验收范围

本次完成原 MiniMax/MiMo 两条配置的有限产品检索发生、来源保存、截止取消/close 和独立 URL 读回验证。未做其他三个模型、真实 subagent 多角色、受管/受保护任务、UI 点验、供应商结算或完整用户产品验收。原 FAIL、取消、答案不足、403/404 和 UNKNOWN 均保留，不自动补跑。

# 现有五模型的原生联网搜索探针

2026-11-03，北京时间 23:54。用户要求先试已接入模型自身的网络检索能力，本次为该明确要求下的有限 Provider 探针。没有接入独立 Search API，没有改变任何模型、Provider、baseUrl、配置或控制台插件设置，也没有调用真实经营材料。

**结论：现有线路的 MiniMax M3、MiniMax M3.1 Flash、MiMo V2.6 Pro 和 MiMo V2.6 Flash 均返回了本次实际原生搜索证据。DeepSeek Flash 的现有 Chat Completions 线路拒绝本次搜索声明。四个有搜索证据的请求均未完成“最近正式版本和日期”这一具体问答任务，不能把能力验证与答案正确、产品接通或用户验收混为一项。**

## 固定输入和执行边界

- 只读使用本机现有 `~/.optracall/settings.json` 五条 profile 和 `auth.json` 对应密钥；密钥仅在内存用于原 Provider 请求头。配置、凭据及产品代码均未写入。参考 Qoder 的既有探针读取方式，没有运行其无工具问答探针。
- 每模型只有一次 HTTP 请求，超时 90 秒，无 SDK/网络/模型自动重试、无 fallback、无会话续接；实际五次均在时限内返回。探针不导入产品或 Pi SDK，直接读取 Provider 原生 JSON，因而未经过 Pi 事件投影的裁剪。
- 所有模型使用同一公开问题：实际检索截至北京时间 2026-11-03，`@earendil-works/pi-coding-agent` 最近正式版本、日期及官方链接；要求不猜测、不编造。token 上限为 2048；未另传 thinking/effort，保留原配置未显式指定这两项的事实，实际 Provider 默认不能当作 SDK 默认等价。
- MiMo 声明 `tools:[{type:"web_search",force_search:true,max_keyword:1,limit:1}]`，工具选择为 auto。MiniMax 声明 `tools:[{type:"web_search_20250305",name:"web_search",max_uses:1}]`。DeepSeek 原线路只做一次 `tools:[{type:"web_search"}]` 探索，未切 Responses/Anthropic 线路，也未调用其独立 Search/Fetch API。
- 开始时间为 UTC `2026-11-03T15:54:00.597Z`；其余四次于 UTC `15:54:16` 左右开始。请求与结果逐条固定；脚本已有 request 文件即拒绝重发，防止事后覆盖首次证据。

## 实际结果

| 现有 profile / revision | 未改动的实际请求地址 / model | HTTP / 耗时 | 原生搜索事实 | 问答结果 |
| --- | --- | --- | --- | --- |
| `minimax-m3` / 1 | `https://api.minimaxi.com/anthropic/v1/messages` / `MiniMax-M3` | 200 / 2.48s | 1 组 `web_search_tool_result`，10 条结构化 `web_search_result`；另发起第 2 个 `server_tool_use`，尚无匹配结果 | `pause_turn`，仅有开始搜索的短句，无最终版本答案；未续请求 |
| `minimax-m31-flash` / 5 | 同上 / `MiniMax-M3.1-Flash` | 200 / 5.94s | 同样 1 组结果、10 条结构化来源，另有第 2 个待续搜索调用 | `pause_turn`，无最终版本答案；未续请求 |
| `mimo-v26-pro` / 1 | `https://token-plan-cn.xiaomimimo.com/v1/chat/completions` / `mimo-v2.6-pro` | 200 / 12.22s | `annotations` 中 1 条 `url_citation`；`usage.web_search_usage={tool_usage:1,page_usage:1}` | `stop`；唯一来源为 GitHub gh-aw 的 CLI 更新议题，未含足够发布依据，模型明确无法确定版本/日期 |
| `mimo-v26-flash` / 2 | 同一 token-plan 地址 / `mimo-v2.6-flash` | 200 / 8.67s | `annotations` 中 1 条 `url_citation`；同样搜索次数/页面数各 1 | `stop`；唯一来源为 npm 包简介，缺版本/日期，模型明确拒绝编造 |
| `deepseek-flash` / 1 | `https://api.deepseek.com/chat/completions` / `deepseek-flash` | 422 / 0.40s | 原生错误类别 `invalid_request_error`，该工具声明被拒绝；无搜索结果或回答 | 本次既有线路探针不通过；不外推到其他协议/工具入口 |

两条 MiniMax 回执均含完成的搜索结果，不能因为最终回答未生成就否认已经搜索。其官方说明明确达到单请求搜索次数上限时可能返回 `pause_turn`，需要原样保留 assistant content 续接；本次严格停在每模型一次，未做第二次模型请求。[MiniMax Server Tools](https://platform.minimax.cn/docs/guides/server-tools)

MiMo 官方说明支持 Chat Completions 原生搜索、强制搜索和结构化 citation/usage，并要求相应服务可用。本次不操作控制台；现有 token-plan 端点直接返回了实际回执，证据比模型自称“可以联网”更强。单关键词、单页的有限结果不足以评价开放搜索质量。[MiMo Web Search](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/tool-calling/web-search)

DeepSeek 当前 Chat Completions 文档只列 function tools；本次为明确标记的探索请求。官方另有 Search/Fetch API 和其他协议说明，本次未调用或迁移。因此准确结论是“此现有线路与该声明未通过”，不能写“DeepSeek 没有搜索”。[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Search & Fetch](https://api-docs.deepseek.com/guides/search/)

## 来源回读和统计校正

只把 Provider 原生 `web_search_result.url` 或 `annotations[].url` 认作结构化搜索来源；不把答案正文、摘要内嵌链接、Logo URL 或模型自述算作额外来源。

两 MiniMax 的 10 条来源集合相同，包含 Pi 官方文档和若干 npm/社区包页面；MiMo Pro 的一条为[gh-aw 议题 #71832](https://github.com/github/gh-aw/issues/71832)，MiMo Flash 的一条为[npm 包页](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)。共 12 个去重来源做了不带任何凭据的公开文本回读：6 个 HTTP 200，页面标题与来源相符；6 个 npm 页面 HTTP 403 / Cloudflare，记录为受访问限制，不能据此宣称假链接。回读只验证可达性/页面身份，没有证明结果最新或版本问答正确。

首次通用提取器统计了嵌套摘要/图标 URL，曾报 MiMo 6/2、MiniMax 13；这不是来源数。正式统计以各 `*.analysis.json` 的 `sources/sourceCount` 为准：MiMo 各 1，MiniMax 各 10。首次提取器 `resultError` 曾因页面摘要出现 error 一词误报；原生错误类型的后续核对 `nativeErrors=[]`，不能据此误称 MiniMax 搜索失败。首次文件保留，校正不重写原始回执。

## 证据、保全与未完成项

本机持久证据根为 `.local/task-agent-capabilities/native-search-probe/`，不含凭据文件：

- `probe.mjs`：一次性请求、90 秒中止、禁止重发及脱敏实现；`public-readback.mjs`：完全不加载凭据的来源回读。
- 每模型 `*.request.json`：原配置身份、真实 endpoint、公开 prompt、请求参数、开始时间和零重试。
- 每模型 `*.response.redacted.json`：脱敏后的完整 Provider JSON；`*.result.json` 为首次提取，`*.analysis.json` 为按原生字段校正后的事实。原始响应只在内存解析，未输出原始异常、请求头、响应体或密钥。
- `public-url-readback.json`：12 条公开 URL 的状态和文本标题；`official-minimax-0.txt` 为本次 HTTP 200 读取的官方 Server Tools 页面快照。
- `credential-scan.json`、`manifest.sha256`：证据密钥及转义变体扫描、文件身份清单。

没有超时或自动重试。Provider 返回 token usage 不是供应商结算回执；未查账户计费，费用/结算保持 UNKNOWN。MiniMax 本次回执未给可独立核定的搜索费用计数，不能写免费。

这是 Provider 参数和原生搜索回执的探针，**尚未通过 OptraCall/Pi SDK 实际产品入口完成接线**。后续若采用，需沿原统一会话生命周期明确原生搜索参数、搜索块/citation/usage 的保留、`pause_turn` 续接与取消/配置变化/迟到结果合同，并验证现有模型/端点兼容；不能静默换模型或使用另一线路替代本次 DeepSeek 结果。本次未做产品实现、服务切换、其他设备操作、Git 交付或产品验收，专业 FAIL/UNKNOWN 与原会话保留。

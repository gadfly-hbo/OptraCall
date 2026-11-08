# 任务 Agent 联网能力：厂商接口研究

研究日期：2026-11-03（Asia/Shanghai）。范围：官方公开文档；未读取凭据、调用真实模型或检索 API、开通插件、安装 MCP、修改模型配置。本文为研究证据，不能充当产品实测或独立复核。文档和价格可能变化，实施与实测时须重新核对实际 profile、模型 ID、端点、账号资格与账单。

## 结论

Qoder 提供的无工具会话观察，证明当时请求没有获得检索结果，不能证明厂商 API 没有联网能力。当前官方资料明确存在三类接口：MiniMax 服务端工具、MiMo 服务端 Web Search 插件、DeepSeek 独立 Search/Fetch API（另有 Anthropic 服务端工具）。这些能力都需要声明工具或显式调用接口；普通文字请求不会自动建立检索通路。厂商产品 UI、模型工具使用能力、服务端工具声明、客户端工具执行及本产品已接通能力应分别记录。[MiniMax 服务端工具](https://platform.minimax.cn/docs/guides/server-tools)、[MiMo Web Search](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/tool-calling/web-search)、[DeepSeek Search & Fetch](https://api-docs.deepseek.com/guides/search/)

本地 profile 名称如 `minimax-m31-flash`、`mimo-v26-pro` 不是本文确认的 API 模型 ID；产品实际映射必须从配置/注册代码另行核对。本文不主张修改现有线路或自动换模型。

## MiniMax：Anthropic 请求需要声明服务端工具

国内官方模型文档列出 `MiniMax-M3` 与 `MiniMax-M3.1-Flash`，当前推荐地址为 `https://api.minimax.cn/anthropic`。任务书中的 `https://api.minimaxi.com/anthropic` 为另一主机名；本轮没有认证请求证据证明旧域在相同账号和模型上的服务端搜索等价性，不能静默迁移后将结果回填为旧域 PASS。[国内模型调用](https://platform.minimax.cn/docs/guides/text-generation)

服务端搜索处于 Beta；官方支持 `/anthropic/v1/messages` 及 `/v1/responses`。Anthropic 请求在 `tools` 声明：

```json
{"type":"web_search_20250305","name":"web_search"}
```

搜索由 MiniMax 执行，响应含 `server_tool_use` 和 `web_search_tool_result`，结果具有 `title/url/page_age/content`。若 `pause_turn`，须保留返回内容再续请求；仅取最终文本会丢失证明实际搜索的结构。官方示例使用 M3.1 Flash，M3 与旧域的实际组合仍需受控验证。[国内服务端工具](https://platform.minimax.cn/docs/guides/server-tools)

另有独立 M Plan MCP 的 `web_search`，参数 `{"query":"搜索词"}`；需相应订阅 Key 与资格，并需运行 `minimax-coding-plan-mcp`。这不是仅加入模型配置就自动出现的能力，也不因此授权安装。[M Plan MCP](https://platform.minimax.cn/docs/guides/token-plan-mcp-guide)

国际官方价格页列 `web_search` 为 `$0.01/request`；不能把国际价直接当国内账号结算或宣称订阅免费。国内账号实际工具计费/额度仍须核对。[国际价格表](https://platform.minimax.io/docs/pricing/overview)

## DeepSeek：当前 OpenAI Chat 路线可接独立检索工具

官方 Search/Fetch 与模型请求分开：同一 DeepSeek Bearer Key，固定 `https://api.deepseek.com`，分别 `POST /v1/tools/search` 与 `/v1/tools/fetch`，返回原始 JSON，不要求切换父模型或等待搜索模型生成回答。[Search & Fetch 指南](https://api-docs.deepseek.com/guides/search/)

```json
{"query":"Python 官方网站","count":5,"need_content":true}
```

Search 的 query 为 1–128 Unicode 字符；count 为 1–50；响应 `results` 是结构化结果，含 URL、标题、摘要、正文和可空日期。空数组是无结果。适合由 Host 适配为通用 custom tool，再交还 Pi 原生循环自主使用。[Search API](https://api-docs.deepseek.com/api/search/)

```json
{"url":"https://www.python.org/"}
```

Fetch 返回标题和 Markdown。URL 要求 HTTP(S)、不含用户名/密码、最长 8192 字符；这并不替代产品的私网、重定向、敏感查询和出境边界。[Fetch API](https://api-docs.deepseek.com/api/fetch/)

DeepSeek 另在 `https://api.deepseek.com/anthropic` 支持服务端 `web_search_20250305`，返回搜索结果块与 `usage.server_tool_use`；示例使用 V4 Pro，不能直接称当前 OpenAI `deepseek-flash` 已启用。[Anthropic 兼容与服务端工具](https://api-docs.deepseek.com/guides/anthropic_api/)

独立 Search 与 Fetch 各 `$0.75/1000` 成功请求，2026-11-01 北京时间零点起计费；本次日期已在计费起点之后。模型 Token 另计，未知费用不能写零。[DeepSeek 价格](https://api-docs.deepseek.com/quick_start/pricing/)

## MiMo：Web Search 插件有明确声明，Token Plan 资格需分开

官方 Web Search 支持 `mimo-v2.6-pro`、`mimo-v2.6-flash`，只支持 OpenAI Chat Completions；需先在控制台开通 Web Search 插件。工具可与客户端 functions 混用：

```json
{"type":"web_search","max_keyword":3,"force_search":true,"limit":1}
```

官方示例使用按量端点 `https://api.xiaomimimo.com/v1`，响应来源在 `message.annotations`（流式优先返回来源），用量在 `usage.web_search_usage`。开启/关闭插件可能有五分钟缓存；不强制搜索时模型可判断不搜索。公开参数示例证明存在接线需求，不能把无工具请求拒答解释为模型不支持。[MiMo Web Search，更新 2026-10-20](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/tool-calling/web-search)

联网搜索与模型 Token 分开计费：国内 `¥16/1000` 次、海外 `$5/1000` 次；一个搜索回合可能发出多个关键词请求。[MiMo API 价格](https://mimo.mi.com/docs/en-US/pricing)

官方 Token Plan 文档确实列出中国区 `https://token-plan-cn.xiaomimimo.com/v1` 和专用 `tp-`/团队 `ttp-` Key，按量 Key 与端点分别管理，不能跨主机猜用凭据。[工具接入概览](https://mimo.mi.com/docs/en-US/tokenplan/integration/tools-overview)

**当前需要澄清的产品适用边界：** Token Plan 个人订阅页将范围限定为编程工具，明示禁止明显非 coding 场景的自动化脚本/自建应用后端请求。该约束与 OptraCall 面向经营分析的使用存在适用性疑问，应采用明确允许的按量路线或取得厂商资格确认，不能通过添加伪编程提示绕过。本文未确认现有账号是否另有许可。[个人订阅，更新 2026-10-21](https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription)

MiMo Code 官方指南有授权登录后每日 1000 次免费搜索的限时权益；权益主体是 MiMo Code，不能推出任意 Token Plan API Key 在 OptraCall 的搜索也免费或可用。公开普通 API Web Search 示例与这些订阅/客户端权益，仍不足以确认当前 Token Plan key、插件和应用的组合。因此该组合记 **UNKNOWN，NOT_RUN**。[MiMo Code 指南，更新 2026-10-27](https://mimo.mi.com/docs/en-US/tokenplan/integration/mimo-code)

## 建议交付方式与验证条件

建议优先保留当前 Pi SDK 原生会话循环，以 Host 自有 custom tools 暴露 `web_search` / `web_fetch`，保持查询、实际来源 URL、时间和失败可观察；不以模型回答文字提取“搜索结果”，不制造并行推理循环。对多个模型共用 DeepSeek 独立 Search/Fetch 是可选方案，需用户明确选定检索 Provider/凭据、计费及出境范围；这不是自动继承父模型 Key。MiniMax/MiMo 的原生声明适配也是候选，须验证 Pi 请求构造、流式来源块及历史序列化，不能只给 body 加参数后丢弃结果来源。

研究阶段没有产生产品回答样例。最终验证应由产品任务会话实际调工具，记录工具来源 URL 与回答引用的对应关系，再独立 curl 逐个核验；curl 只能证明链接可访问，不能独自证明回答确实来自该次检索。配置缺失、403/402/429、超时、空结果、取消、迟到结果及搜索未执行均必须明确；不得静默换线路/凭据或以预设链接冒充搜索成功。

本研究不代表运行时已落地；具体发现契约、Interface 版本、普通/受管/受保护任务策略与工程验收由本变更规格和实现记录承接。

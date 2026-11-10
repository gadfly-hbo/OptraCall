# 设置中的网络搜索与线路优先级

2026-11-10，用户确认 v0.1，回复「通过，按此实现」。确认时规格 SHA-256 为 d28e973297a9d5ea1d7ad5aa8ebcc980fa2de4c01c328d849fe2dda5135ea739，Demo SHA-256 为 ea2dea678c9632be4337d5170f44d1dab89b0b285d883684724898acf0b62572。由 Codex 负责 Host 与 Pi Extension 接缝、前端和验收。沿用已确认的底部设置入口。本设计与 11 月 10 日试用报告修复分别记录。

## 使用路径

1. 打开「设置 → 网络搜索」。已有模型设置和个人资料两个标签继续可用。新增页列出 MiniMax 网页搜索和 DeepSeek 网页搜索，默认顺序为 MiniMax → DeepSeek。
2. 两行分别显示「模型设置 · MiniMax M3.1 Flash」和「模型设置 · DeepSeek Flash」，以及「已配置」或「未配置」。状态仅反映本机是否有对应模型凭据。缺少凭据时可直达模型设置。搜索沿用模型密钥。
3. 可用上移／下移交换两条线路。保存后供之后发起的搜索使用。恢复默认把 MiniMax 移回首位，保存后生效。已有安装读取默认顺序，无需迁移或首次设置。刷新后显示已保存顺序。窄屏和键盘可完成相同操作。
4. DeepSeek Fetch 在同一页单独说明。Agent 需要打开已知网页时按 URL 读取 Markdown，复用 DeepSeek Flash 凭据。移动搜索顺序只影响关键词搜索。
5. 排序、保存、读取设置和打开页均为本地操作。Demo 的场景和状态只用模拟数据。生产调用由 Agent 选择使用搜索或网页读取工具时触发。

## 调用规则

| 情况 | 关键词搜索的行为 |
| --- | --- |
| 首选返回有效结果 | 返回首选的来源与摘要，备用请求数为 0。 |
| 首选成功但没有匹配结果 | 返回空结果，并记录首选线路。Agent 可以自行改关键词再次搜索。 |
| 首选未配置或调用失败 | 未配置时跳过首选。连接失败、超时、限流、鉴权或额度错误、供应商业务错误、无效响应等线路故障时，尝试备用一次。 |
| 两条线路都不可用 | 返回可区分的供应商和错误类别，Agent 仍可继续处理本轮任务。 |
| 输入不合规或用户取消 | 结束本次工具调用。无效输入在发出请求前返回，取消时中断当前调用并撤销备用派发。 |

每次调用读取一次已保存的顺序。每条线路最多一次，串行调用，保持同一个关键词。新请求使用当时可用的凭据。配置被清除或轮换时，后续派发重新校验该线路是否可用。已有 Host 取消、关闭、资源归属规则覆盖等待中的请求。工具有有限的连接、响应体和正文预算，大小超限或结构无效给出明确错误，关闭后丢弃迟到结果。每条线路最多等待 12 秒，单次搜索最多两条线路。

## 线路契约

| 线路 | 请求与结果 |
| --- | --- |
| MiniMax web_search | Flow Center 由 Pi 调用 Coding Plan MCP 的搜索工具。采用其官方服务契约，对中国区 https://api.minimaxi.com/v1/coding_plan/search POST { "q": query }，使用 MiniMax M3.1 Flash 的 minimax-cn 凭据和官方 MCP 请求头。检查 HTTP 状态及 base_resp.status_code。将 organic 中的标题、链接、摘要、日期作为来源。 |
| DeepSeek Search | POST https://api.deepseek.com/v1/tools/search，按官方规范发送 query、count，默认只取摘要。复用 DeepSeek Flash 的 deepseek Bearer 凭据。检查 results，保留结构化标题、链接、摘要、站点和日期。公共搜索参数采用两家可接受范围，关键词 1～128 个 Unicode 字符，默认返回最多 10 条。 |
| DeepSeek Fetch | POST https://api.deepseek.com/v1/tools/fetch，只发送 { "url": url }。接收标题与 Markdown，并将输入网址标为来源。只接受公开 HTTP(S) 网页，不含用户信息，限 8192 字符。安全拒绝、网页不可用、鉴权与限流各自返回明确错误。 |

以上使用固定官方 HTTPS 地址。Host 按预设 ID、Provider 和正式模型线路查找凭据，在可信环境通过受限工具适配器发出请求。只有 Host 持有密钥。出站仅包含本次工具的关键词或网页 URL。页面结果作为外部资料处理，保留供应商、实际来源和空结果／失败／备用状态。日志只记录脱敏后的技术状态。

[DeepSeek Search / Fetch 官方文档](https://api-docs.deepseek.com/zh-cn/guides/search/) · [MiniMax 官方 Coding Plan MCP](https://github.com/MiniMax-AI/MiniMax-Coding-Plan-MCP) · [MiniMax 官方搜索实现](https://github.com/MiniMax-AI/MiniMax-Coding-Plan-MCP/blob/main/minimax_mcp/server.py)

[Flow Center 的 Pi 调用入口](/Users/bendandebaba/DevWorkSpace/Projects/flow-center/server/src/pi-models.ts:97)使用进程和工具调用日志作为探针。本次验收以供应商结构化回执为准。MiniMax 模型密钥的 Coding Plan 搜索权限以获准实测为准。

## 接入边界

- 沿用工程规范 v1.10、IN01–IN07 与 Interface v3。现有项目任务 owner/profile 和普通分析能力路径继续使用同一 ProjectAgent、原生会话和公开 Pi 1.4.0 扩展工具注册。复用现有 Host 配置权限和读写保护。沿用已锁定 SDK、依赖和模型选择。
- Agent 自主决定是否查网、搜索词、查阅网址和如何使用来源。Host 提供凭据、搜索线路、技术失败回退及可核对的回执。备用仅重发这一条搜索，保持原 Agent、模型、会话和轮次。
- 同一受控搜索工具覆盖普通项目分析和原先允许联网且拥有该工具权限的子 Agent。普通受管分析通过可信工具适配器发出固定请求，受限计算进程的网络权限保持原边界。固定材料核算、修订、文本专用和特殊工作区沿用现有 profile 的工具权限。
- 优先级接管新搜索的派发。现有 Anthropic/MiMo 模型原生搜索与 Flow Center Coding Plan 工具分别走不同协议。接管范围内使用统一的搜索派发入口，兼容原生历史来源、已有会话读回和已经开始的合法技术续接。按现有 Pi 工具调用与记录闭环验收。
- 线路顺序按本机持久化。凭据更换沿用原模型设置，使用 OptraCall 的薄适配调用官方搜索接口。

## 验收

1. 用已确认 Demo 固定设置标签、搜索行、顺序、两种凭据状态和网页读取区。对窄屏、键盘、保存／恢复、页面重开、设置读取失败做浏览器验证。界面读取只呈现凭据布尔状态。
2. 合成供应商验证首选成功零备用、空结果零备用、首选 HTTP 或业务失败仅调用一次备用、缺少首选凭据、双失败、改序、输入错误、取消与迟到结果。记录真实工具参数和调用计数。验证独立 Fetch 请求和 Markdown 结果。
3. 通过真实 Host 与原生 Pi 回路接入合成传输，核对旧原生搜索历史、会话恢复、模型保持、子 Agent 权限、固定材料工作区、已开启自动核算的普通分析阶段及关闭行为。执行适用 SDD/TDD、完整工程检查和非作者复核。
4. 真实供应商验证与合成工程验证分开记录。获准时，用公开测试关键词和公开网页验证两条 Search 和一条 Fetch。线路默认读回为 MiniMax → DeepSeek。设备采用和发布按实际授权分别记录。

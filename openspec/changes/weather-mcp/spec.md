# 天气 MCP 连接器（Open-Meteo 历史天气 · 第二个连接器）

**工程实施原位归档（2026-11-03）**：[PR #29](https://github.com/gadfly-hbo/OptraCall/pull/29) 实际 head `6b5e301c53b75c45381e6a02adb4b800fbef91f8` 经 [Check #81](https://github.com/gadfly-hbo/OptraCall/actions/runs/41643551070) attempt 1 成功，用户明确确认后 squash 为 `722af86fd2bf5a9972bbbc6dc537e4c0bd79941b`。受检 head 与 squash 完整树一致，本地 main 已安全快进。规格、结果、独立复核、结构决定、原清单与移交包在本目录保留；历史失败及各阶段授权不回写。合并 main、归档提交自身 CI 和后续真实模型／MacBook采用分别按[结果记录](result.md#合并交付与原位归档)及实际回执核定。

状态：**本地实施、非作者复核、实际 PR head CI 与获准合并完成，工程实施原位归档；真实模型测试及 MacBook 更新已另获授权、待实际执行。** 商圈连接器已合并 main（squash `2c56dd2`，PR #27），本变更按 D9 在其后独立实施；对齐合并版[标准 v1](../../../docs/mcp-connector-integration.md)（transport 定为 stdio；接缝形态对齐 trade-area 先例：任务能力开关、`registerMcpServer(name, config)`、目录指纹冻结、受管任务不注入）。实施决定（随启动落定）：**单工具 `weather_history`**（来源/许可说明并入工具描述，可推导不设 meta 工具，同 D10 原则）；城市名→坐标 v1 仅内置少量常用城市，其余用经纬度；缓存时效默认 72 小时（可配置）；查询时区固定 `Asia/Shanghai` 并在结果标注；日期跨度上限 366 天。

2026-11-03 · 依据[商圈/天气 MCP 连接器能力承接产品讨论稿 v0.1](../../../docs/商圈天气MCP连接器能力承接产品讨论稿_v0.1.md) 制定。本变更为两个独立连接器中的**第二个**：交付天气连接器本体，复用 [trade-area-mcp](../trade-area-mcp/spec.md) 随交付建立的 [MCP 连接器接入标准 v1](../../../docs/mcp-connector-integration.md)（目录、清单、工具合同、Host 接缝模式同源），验证标准的可复用性；不随该变更交付，不共享分支或合并批次。

[data-mcps 原仓](https://github.com/gadfly-hbo/data-mcps)（HEAD `1b2d04e`）R1 天气闭环仅作领域参考：期望键核对、缺失不填零、限流/超时/取消/迟到结果的 UNKNOWN 语义、缓存时效标注等失败路径语义被吸收为本连接器的规则；其工作台产品、合成夹具体系与存储不进入本仓。天气数据源为 **Open-Meteo 历史天气 API（Archive API）**，官方文档与许可边界以实施时核对为准。

## 可观察结果

用户在项目任务中显式开启天气连接器后，任务 Agent 在对话中自主调用天气工具：按坐标（或城市名经连接器内置坐标解析）+日期区间查询历史日天气（温度、降水等日级字段），结果带来源（Open-Meteo Archive）、获取时间与缓存标识；期望日期键与实际返回核对，缺失日期如实呈现不填零；Agent 将天气变量用于经营/选址分析时结果可溯源。未开启的任务与受管/封闭执行任务中无天气工具。能力目录"连接器"分区出现第二个"已接入"条目。网络出境仅限 `archive-api.open-meteo.com`，请求内容仅坐标、日期与字段参数，无密钥。

## 范围

- 新建 `extensions/connectors/weather-mcp/`（按连接器标准 v1）：
  - `connector.json`：id `weather-mcp`、kind `remote-api`、transport `stdio`（SDK 管理的 Host 传输入口与受限 worker；见结构决定 S3）、egress 白名单 `archive-api.open-meteo.com`、credentials `none`（Open-Meteo 免费档无密钥，实施核对）、工具清单（只读声明）；
  - `server/`：MCP server 本体与单只读工具 `weather_history`（来源/许可/覆盖说明并入描述，不另设 meta 工具）；
  - `open-meteo.ts`（v1 包根平铺）：Archive API 适配（参数映射、错误分类、限流/超时语义）；
  - 本地缓存：查询结果缓存于 `dataRoot/connectors/weather/entries/`，带获取时间与时效标识；
  - `README.md`：解决任务、输入输出、数据来源与许可、出境内容与白名单、缓存策略、启停方式。
- Host 接缝（**Codex 归属，按工程规范 v1.3 默认**；如用户直接指定 Qoder 实施按 IN06 记录）：会话注册接线（对齐 trade-area-mcp 先例接缝）、能力目录条目+导航、`dataRoot/connectors/weather/` 分配、**出境白名单的 Host 侧强制**（仅放行清单域，不只靠提示词）。
- 新增测试：工具合同、适配器错误分类（限流/超时/无效参数）、期望键核对与缺失呈现、缓存时效、出境白名单强制、默认关闭与受管任务不注入、`npm run check` 全量。

## 不做

- 不做天气预报（仅历史 Archive）、订阅刷新、定时采集、天气历史全量落库；
- 不做多天气源、密钥型商业天气 API、付费档接入；
- 不做独立天气页面或产品监听服务/端口；stdio 传输使用 SDK 管理的 P/Q 子进程，不是另一个 Agent；不新建会话域/profile/owner，不建平行 Runtime；
- 不迁移 data-mcps 的合成夹具体系与工作台；本连接器测试用合成 HTTP 夹具按本仓测试模式自建；
- 不随 trade-area-mcp 同批交付、不共享合并批次（独立变更独立验收）。

## Interface 接入记录（IN01）

- 工程规范 v1.3；Interface v3；复用项目任务域 `project-tasks`，不注册新域；owner/profile 同项目任务既有，接入模式与 trade-area-mcp 同源。
- 修改范围：Host 会话注册接线（Codex 维护）；连接器本体由 Qoder 首次实现；移交后全部代码由 Codex 单一维护（Qoder 只读），不 import SDK 会话管理、不持凭据。
- 工具执行体为 stdio worker Q；SDK 启动可信 Host P，Q 无直接网络/子进程权限，P 按固定域和参数合同代理 HTTPS（[结构决定 S1–S5](structure-decisions.md)）；仅 macOS Seatbelt 可用时启用，其他平台 fail-closed；受管 ordinary/protected 及 fixed-draft/text-only 任务不注入。
- 数据出境：仅向白名单域发送坐标/日期/字段参数与固定时区（D12）；事件/日志脱敏沿用 Host 既有路径；开启连接器时一次性向用户说明出境内容，不逐次确认。

## 关键规则

- R1 出境白名单：仅 `archive-api.open-meteo.com`；请求内容仅坐标、日期区间与字段参数；白名单由 Host 侧强制执行，连接器无法自行扩大。
- R2 缺失不填零：期望日期键×实际返回逐日核对；缺失/部分覆盖如实呈现缺失清单，无数据日期不用 0 或插值占位。
- R3 结果可溯源：每次返回带来源标识、获取时间与缓存时效；缓存过期如实标注，不冒充新数据。
- R4 失败路径结构化：限流（含 Retry-After 语义）、超时、无效参数、坐标越界以结构化信封分类返回；取消/迟到/未知结果保留 UNKNOWN，不自动重放请求（沿用工程规范 §7 副作用纪律）。
- R5 启用策略：默认不进任务默认工具集，任务级显式开启后 Agent 自主调用（与 trade-area-mcp 统一）。
- R6 许可如实：Open-Meteo 免费档使用条件（非商业等，以实施核对的官方条款为准）在工具描述/README/目录文案如实标注，不宣称"无限制免费"。
- R7 标准复用：目录结构、清单、工具合同、报错信封均按 `docs/mcp-connector-integration.md` 标准 v1 执行；发现标准缺陷时先修订标准文档（随本变更），不在本连接器内私设例外。
- R8 Agent 自主：何时查天气、查哪些变量、如何进入分析由 Agent 决定；无逐调用确认门槛（出境白名单除外）。

## 验收

| 标识 | 条件 | 对应 |
| --- | --- | --- |
| WX01 | `weather_history` 经产品任务会话真实 SDK 路径可用（合成夹具驱动适配器层、真实 API 按授权实测）：Agent 完成坐标+日期区间查询并在分析中引用 | R8 |
| WX02 | 期望键核对：正常全量、部分缺失（缺失清单呈现）、空区间、跨年区间行为正确；无填零/插值 | R2 |
| WX03 | 失败路径：限流/超时/无效参数/坐标越界分类正确；取消与迟到结果保留 UNKNOWN 不重放 | R4 |
| WX04 | 缓存：命中返回缓存并标注时效；过期不冒充新数据；缓存数据不外发 | R3 |
| WX05 | 出境强制：仅白名单域可达，非清单域请求被 Host 侧拒绝；请求内容仅坐标/日期/字段参数（抓包或传输层断言） | R1 |
| WX06 | 启用边界：默认任务无天气工具；显式开启后可用；受管/封闭任务不注入；无平行 Runtime | R5 |
| WX07 | 能力目录第二个"已接入"条目，形态对齐先例；许可与出境文案如实 | R6 |
| WX08 | 标准复用核对：目录/清单/工具合同与 `docs/mcp-connector-integration.md` 一致；如有标准修订，修订随本变更记录 | R7 |
| WX09 | 既有链路回归通过；`npm run check`（含边界检查）通过 | — |

## 实施记录（Qoder 侧，2026-11-03）

商圈连接器合并 main（squash `2c56dd2`＋归档 `351d835`）后，Qoder 在 `qoder/weather-mcp` 分支（基于合并后 main）完成连接器本体：`extensions/connectors/weather-mcp/`（types/cities 内嵌于 types/coverage/open-meteo/cache/service/server/main/connector.json/README）＋ `tests/weather-mcp.test.ts`。零新增依赖（复用标准 v1 的 @modelcontextprotocol/sdk 与 zod）。

实施决定（对齐标准 v1 与 trade-area 先例）：顶层工具 schema 用 `z.looseObject` 保留未知键、实现精确拒绝（缺必需键实测由 SDK 协议级拒绝，符合标准 §3"不保证进入回调"口径）；错误信封扩展 `source_unavailable`（detail.reason：rate_limited/quota_exhausted/timeout/cancelled/network/upstream_error/auth_invalid，含 Retry-After）；不自动重试；缓存默认 TTL 72h、过期即重取不冒充新数据；出境自限于 `archive-api.open-meteo.com`（URL 构造自检）；城市坐标表 10 城、时区固定 Asia/Shanghai、跨度上限 366 天、end 须早于今天。

验证：TDD 先行（RED 模块缺失）→ GREEN 10/10（含 MCP 协议往返、stdio 预热缓存冒烟，全部合成 HTTP 夹具零真实网络）；`npm run check` exit 0（943 项：940 PASS/0 FAIL/3 条件 SKIP）。真实 API 冒烟属外部副作用，按本规格未决项另行授权。未完成（如实）：Host 接缝（能力开关条目、`registerMcpServer` 注册、目录条目、UI、**首个 remote-api 的出境白名单传输层强制**——Host 侧新工作）归 Codex；WX01 产品路径端到端、WX05 出境强制实测、WX07 目录点验待接缝。证据见 [result.md](result.md)。

## 适用检查与未决


- 适配器层以合成 HTTP 夹具测试（本仓测试模式自建，不迁 data-mcps 夹具）；真实 Open-Meteo 请求属外部副作用，按届时授权实测并记录费用/限流实际情况；`npm run check` 全量；浏览器点验目录条目。
- UI Demo：与商圈连接器共用[原型](../../../docs/prototypes/connector-ui-demo.html)，**用户已于 2026-11-03 全部确认**：出境说明为内联卡片、勾选天气时出现一次、不弹窗不阻断（D12 交互定稿）；开启入口两处与能力目录描边按钮统一，同商圈条目。Demo 确认不构成实施启动授权（D6）。
- 实施决定已落定：单工具、10 城内置坐标、72h、Asia/Shanghai、包含首尾≤366天。官方文档/条款已核对；免费 API 仅非商业，数据 CC-BY 4.0 需署名。真实 API 响应仍待授权冒烟，不以文档核对代替实测；Git/CI、合并、真实模型与设备仍分别授权。

## Codex 接管补充（2026-11-03）

14/14 原始候选哈希相符后接管独立工作树，原清单与移交包不改写。新增可选任务能力沿 schema2/既有公共生命周期；Interface v3、project-tasks owner/profile 不变，agentOptions 仅增加可序列化 cacheRoot。注册和保留命名空间过滤复用 trade-area IN06 同一个锁定 SDK1.4.0 loader 例外，无新增 SDK 导入面/白名单。两个连接器的可观测目录摘要与持续冻结分别保留在同一任务资源中。

首个 remote-api 的 Host 强制出境按 [结构决定](structure-decisions.md) S3：P 不 import 连接器，Q 无新建网络/子进程能力，只能经 fd3 提交有限查询；P 在 DNS 前验证固定 HTTPS 域/路径/方法/参数，拒绝私网解析、重定向和任意数据载荷，固定本次公开 IPv4 与原域 TLS 校验。仅受支持 macOS 路径启用；不把 Node 权限单独当恶意代码沙箱。P/Q 继续归 SDK 进程组与公共 close 收尾，不新建 Runtime、会话状态权威或产品端口。

原 Qoder 验证和未完成项是接管前历史范围，保留在 result；Codex 修复取消迟到、日期/跨度、损坏缓存、Retry-After 和异常逐日结构等反例，新增证据分别记录，不把早期结论升级为真实模型或真实 API 验收。

证据限定：上文Qoder历史记录中的“RED模块缺失”只证明当时测试尚不可运行，按工程规范§3不算本功能的因果RED，也不由接管修复追认其TDD主张。原记录保留；Codex反例与修复回归、非作者发现及重验分别记入result。


## 本地阶段闭合（2026-11-03）

Codex接缝与发现修复、浏览器点验、两名干净上下文非作者独立复核及重验完成；[独立报告](independent-review.md)保留首次失败、范围及补证轨迹。固定v5全量 `npm run check` exit0：960项957通过/0失败/3条件SKIP，边界/tsc/构建通过。检查及两轴最终读回554/554文件一致。3条条件SKIP及Vite chunk提示如实保留；不据此宣称真实soffice页面图像验收。

WX01真SDK合成路径、WX02–WX08本地适用范围与WX09本地完整检查闭合；真实Open-Meteo单次湖州2025-10冒烟未授权未运行，真实源响应/限流/延迟未验。Git/Hosted CI/合并归档未授权未执行；真实模型任务、服务采用及MacBook仍另行授权。当前分支保留未提交Codex增量，主仓main未改，不把本地工程通过称产品验收。

最新main读回已前进至 `4a3be3d`（PR #28）；本地当前候选仍基于351d835，新增main尚未集成。Git授权后先集成/重验共用接缝，再进行实际head CI；本地阶段通过不代表该集成已完成。


## 获授权后的集成与真实源阶段（2026-11-03）

用户对上一条明确列出的两项回复“授权”：①单次湖州2025-10真实API冒烟；②Git/CI（先集成最新main、重验、提交推送、单PR、实际head CI）。squash仍需CI通过后用户确认，真实模型及MacBook更新未授权。上文旧阶段的未集成/未授权状态保留为历史；本节为当前阶段。

先将已验天气增量固定为264559e，再fetch并合入最新origin/main `4a3be3d36b6c2511635b2c044de2068b6b6ca4df`，合并提交 `afbd81a3ec8ce335fd841c5095c04d468dd61541`。App两处冲突均保留双方意图：新main的需求返回上下文、TaskWorkflow、前置核算及结果布局，叠加天气目录导航和TaskCapabilityList任务key；store/server/styles自动合并后重新验证。工程规范现v1.4，§2及IN01–IN07未变，Interface仍v3、owner/profile及原loader例外不扩展。

新完整561文件候选独立复核/受影响探针与浏览器回归完成；root新 `npm run check` exit0：964项961通过/0失败/3条件SKIP，边界/类型/构建通过。两名非作者独立复核集成增量、Host–Agent职责/SDK复用和IN06通过，无未关闭发现；详见 [independent-review.md](independent-review.md) 最新集成报告。旧基线绿色未用作新main的替代。

获授权真实API通过生产weather-mcp-entry→P/Q的MCP stdio执行唯一weather_history：湖州坐标30.8671/120.1023、2025-10-01..31、两字段、Asia/Shanghai；查询约1505ms，31/31日完整、无缺失/重复/null，cache miss及落盘/本地文件读回一致、P/Q正常退出。该次由root烟测脚本直接启动生产传输；不冒称经PiSDK真实模型分析。工具派发1次、自动重试0；脚本未观察底层HTTP包数、剩余配额或供应商费用。真实源可用性结论只覆盖该次输入/时刻，真实模型质量及用户产品验收仍待另验。

后续单PR、实际head CI按真实Git/Actions身份核定；本规格不预填未来CI/合并结果。合并、main快进及OpenSpec归档仍待获准执行，不因API冒烟或Git授权自动操作设备/服务。

# 外部执行接入：官方依据与验证边界 v0.3

核实日期：2026-11-27（UTC）。本记录仅查公开官方资料；未登录 WorkBuddy、调用实号 API、安装 Connector、部署入口或发出 GitHub Issue。
2026-11-28范围更新：本期基础为独立GitHub Issue通用外派＋受保护资产/工作MCP；WorkBuddy仅为可选本机助手远程触发适配，真实联合测试通过才可启用。不采用WorkBuddy云任务。原公开资料的核实日期仍为上文日期，没有实号验证；[原v0.2研究](integration-research-v0.2.md)原样保留。
资料支持接口存在，不构成目标账号、客户端版本、套餐、权限或联用能力的运行回执。

## 1. 官方来源

| 来源 | 本次核实内容与日期边界 |
| --- | --- |
| [WorkBuddy Open API](https://open.workbuddy.cn/en/docs/openapi) | 第三方应用 OAuth、本机助手在线查询、发消息触发任务、增量读回复；页面未标可固定的文档版本，以本次核实日期为准。 |
| [WorkBuddy Connector](https://open.workbuddy.cn/en/docs/connector) | 自定义远端 `streamableHttp` / SSE、HTTPS、OAuth 与凭据配置；含版本门槛，目标客户端实际版本仍待验证。 |
| [WorkBuddy 自动化](https://cloud.tencent.com/document/product/1831/134399) | 定时发起 Agent、沿用登录身份与已授权连接器；页面最近更新为 2026-09-07。定时能力不证明原生 GitHub Issue 订阅。 |
| [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | 当前查得规范修订为 `2026-07-28`；受保护 HTTP MCP、资源发现、token audience、scope 与错误语义。 |
| [MCP Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) | 预注册、CIMD、DCR 兼容；DCR 自该修订起弃用但仍保留兼容期。 |
| [MCP Security Best Practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) | OAuth URL、SSRF、token passthrough、身份与资源句柄绑定的安全边界。 |

WorkBuddy Connector 文档直接引用公开的 `modelcontextprotocol/typescript-sdk` 与 `modelcontextprotocol/python-sdk` 官方仓库，可优先复用其服务端能力；本次未选定、安装或升级 SDK。实施时固定实际 SDK 与双方兼容的协议版本，不凭“最新规范”推断 WorkBuddy 已支持全部新行为。

## 2. 可选 WorkBuddy 本机 API 合同（仅该适配）

共同基址：`https://www.workbuddy.cn`；调用使用用户授权后取得的 `Authorization: Bearer <access_token>`。

| 用途 | 方法与路径 | 最小 scope / 关键字段 |
| --- | --- | --- |
| 查询在线 | `GET /openapi/v2/localassistant` | `user.localassistant.readable`；响应 `data.online`。 |
| 触发执行 | `POST /openapi/v2/localassistant/message` | `user.localassistant.invokable`；JSON `content`、`msg_type: "text"`；返回 `data.message_id`。 |
| 增量读回复 | `GET /openapi/v2/localassistant/message?message_id=<id>` | `user.localassistant.readable`；返回该消息之后的消息，不是 OptraCall Task 完成证明。 |
| 回答已有交互 | 同一消息 POST | 文档允许 `msg_type: "permission_response"`；`content` 为序列化 JSON，须对应实际交互 `requestId`，具体工具审批载荷待实测。 |

`message_id` 是当前账号消息历史中的游标/触发回执，不是经官方保证的独立工作或会话ID。游标之后可能出现其他工作及人工聊天，不能按时间、先后顺序或最近触发来归属某 Task。只采用与既存 work/revision/触发尝试或认证 claim/delivery 可准确核对的消息，其他正文不进入任务或模型；有效交付以受保护 MCP 的 work.deliver 为准。首期本机适配在同一连接上串行派发已知 OptraCall 工作，其余保留等待；这是已核接口缺口下的最小保护，不证明外部平台没有其他工作，也不改通用协议的多执行者能力。

首次接入需要：

1. 注册 WorkBuddy 开发者账户、创建受支持的第三方应用，取得 `clientId/clientSecret`，配置 OAuth 回调与授权清单；目标账号是否获准使用相关接口仍待验证。
2. 用户完成 WorkBuddy 应用 OAuth；授权码入口 `/openapi/v2/authorize`，换 token 入口 `/openapi/v2/token`；应用 secret 留在服务端凭据管理中。
3. 用户登录并保持目标 WorkBuddy 本机助手在线；适配器实际检查在线，不能声称能唤醒离线客户端。
4. 安装／配置 OptraCall 资产 Connector，并完成其独立的 MCP OAuth／工具权限配置；不能用 WorkBuddy API token 代替 OptraCall 资产访问 token。

本机 API 已记录 AskQuestion／工具审批的 `permission_response`；官方云端 ACP 另明确存在 `session/request_permission`。这说明第三方运行可能要求额外交互，不能据 OAuth 完成承诺全部工具免确认，也不能把 ACP 方法名直接当作本机消息协议。仅在用户既定授权范围与实测支持的权限策略内自主回应；超范围保留等待与原因，不默认全批准。

## 3. 可选 WorkBuddy Connector 与标准 MCP 认证兼容

本节的Connector配置要求仅约束WorkBuddy；基础通用路径通过标准MCP客户端独立认证，无需此Connector。OAuth受保护资源、精确Task/资产权限及网络校验仍适用于所有客户端，详见spec第7节。

WorkBuddy 官方远端配置示例支持 `type: "streamableHttp"`、`url: "https://<host>/mcp"`；生产远端要求 HTTPS，涉及用户数据要求认证。连接器的 `auth_mode: "server-side"` 使用 WorkBuddy 云端托管授权；它与上述用于触发本机助手的第三方应用 OAuth 是两条授权链。

- 预注册兼容路径：`auth_type: "oauth2_code"`，在 OptraCall 授权服务注册 WorkBuddy 客户端，提供官方要求的客户端信息、授权／token 端点、scope；回调按 WorkBuddy 文档允许域与系统生成规则登记，不填任意回调。
- WorkBuddy 另记录 `auth_type: "mcp_oauth"`，以资源 URL 做 RFC 9728 发现并经 DCR 注册；MCP 当前新规范已弃用 DCR，因此本期优先验证预注册兼容路径，不把 DCR 作为唯一接入方式；WorkBuddy 的 CIMD 支持未证明。
- MCP 服务端作为 OAuth 资源服务器，公开 RFC 9728 元数据；客户端在授权与 token 请求指定规范资源 URI，逐 HTTP 请求通过 Bearer Header 传 token，不放 URL／Issue。
- 每次访问校验签发者、有效期、目标 audience、scope 及真实项目／Task／资产权限；过期／无效为 401，权限不足为 403。不得接受用于 GitHub、WorkBuddy 或其他资源的 token 后透传到资产服务。
- 公开 SDK／桌面客户端不是 secret 保管边界；公开客户端不能靠内嵌共享 secret 证明身份。MCP 官方示例允许公共客户端 `token_endpoint_auth_method: "none"`，CIMD 可配 JWKS 使用 `private_key_jwt`；具体客户端认证和 PKCE 需按实际授权服务与 WorkBuddy 支持联合验证。
- MCP URL、发现／授权端点及跳转目标执行 HTTPS／安全协议校验与 SSRF 防护，处理私有／保留地址及 DNS 重绑定；生产允许目标按实际入口收窄。TaskId、Issue URL、资产引用本身不是凭据。

## 4. 可选 WorkBuddy 适配候选闭环及责任

仅在用户选择该可选适配、且具体配置真实联合测试通过后，采用路径：`OptraCall原Task授权 → GitHub Issue → WorkBuddy本机适配器官方API → 已在线助手认证领取 → 受保护资产MCP → 工作MCP交付 → 原OptraCall Task核验/保存`。不是GitHub事件必然自动唤起WorkBuddy；基础通用路径见第6节。

Issue 是可追踪外部工单；OptraCall 适配器使用正式 API 触发执行，负责工单关联、幂等、授权、占用与回执。未发现官方依据证明 WorkBuddy 原生监听任意 GitHub Issue、自动领取或任意平台可被自动唤醒。定时订阅可作为另行验证的执行方式，不替代该可选本机API适配的真实联合验证，也不是核心通用路径的前提。
Host 只交付目标、资源资格、取消／权限与结果记录；外部 Agent 在范围内自主选择分析步骤。接回原任务仍沿现行统一会话／owner 规则，不新造 OptraCall 推理循环或改第三方客户端。
任务消息只带获准目标、Issue／Task 关联和资产定位信息；资产保留 OptraCall 运行端，由受保护入口按任务读取。结果文本、消息存在或 HTTP 200 不能替代交付结构、来源与原 Task 归属验收。

## 5. 可选 WorkBuddy 工程与实号验证矩阵

以下均为WorkBuddy可选适配的待验证要求；本记录没有产生工程PASS或实号PASS。此处NOT_RUN不阻断核心通用GitHub/MCP的独立工程验收或原Task内部工作。

| 验证对象 | 工程可验证范围 | 实号／联合验证与当前状态 |
| --- | --- | --- |
| 应用与授权 | OAuth 回调、凭据隔离、scope 与撤销错误的合成用例 | 目标开发者应用、账号与授权权限可用：`NOT_RUN`。 |
| 本机触发 | 在线／离线、去重、超时与未知回执处理 | API 确实触发指定在线助手，身份／版本可识别：`NOT_RUN`。 |
| API＋资产 MCP 联用 | 模拟协议、权限检查、固定资产版本与错误返回 | 该 API 发起的任务确实启用获准 Connector 并读到正确资产：`NOT_RUN`。 |
| 自主与工具授权 | 授权范围内策略、超范围等待、取消后不派发 | 实际工具请求／权限消息、是否仍需确认、可用回应格式：`NOT_RUN`。 |
| 隔离与失效 | 跨项目／Task 拒绝、过期／撤销／错 audience、URL 防护 | 第三方实际 token／刷新／撤销与资产访问一致：`NOT_RUN`。 |
| 完整回交 | 工单与任务关联、交付校验、重复／迟到结果、保留失败 | 真实外部执行、资产读取、完整成果返回且被原 Task 接收：`NOT_RUN`。 |

**WorkBuddy适配准入结论：`integration_unverified`，默认禁用。不能从“本机触发API已支持”与“MCP已支持”分别成立推导二者联用已验证。该具体配置真实API→同一MCP领取/查读→交付→原Task核验完成且身份/权限/结果归属有证据前，不标记该WorkBuddy配置就绪、不允许用户选用其自主触发。该门槛只约束此适配，不约束纯GitHub通用接单或内部执行。**
上线采用、真实材料与账号操作须按届时有效授权实施；本研究不构成部署、安装、实号调用或设备服务切换授权。

## 6. v0.3 基础通用路径与独立门槛

核心路径为`原Task明确外派授权 → 指定可信仓库GitHub Issue → 获准通用Agent发现工单 → 标准受保护工作MCP认证claim → 按任务精确refs调用资产MCP → work.deliver交回/保全 → 原Task Agent核验/原工具保存/同owner续接`。工单不是凭据；allowlist/当前授权/claim/企业/资产版本/原资格交集仍全部核对。无人领取时等待，不读资产、不调用WorkBuddy；GitHub关闭不等于接受。外部Agent自行使用自身工具/调度器，首期不承诺任意Agent零配置自动接单。

核心就绪独立核GitHub连接、受保护资产/工作MCP和通用客户端认证/工作闭环、已批准资源策略；其工程Host/Pi/标准MCP/TLS/OAuth/模拟GitHub供应商/通用客户端闭环由E01–E04/E06–E07验证，真实账号采用由E08另记。本研究未验证这些实现，不因本版静态Demo通过标工程PASS；也不能将第5节WB未验证误写成核心阻断。

纯GitHub授权默认1work/24h，较低已批准策略优先，不申请或消耗WB的3次API额度；内部工作不申请外派授权。WB选用时才叠加其触发额度/UNKNOWN占额/串行保护。

**跨环境界限：** 若选择已验证WB配置，OptraCall运行端可与目标在线助手分处不同环境，目标必须已授权在线且能访问资产MCP。官方接口存在不能证明目标MacBook实测通过，不能承诺远程开机/唤醒睡眠电脑/启动已退出应用/同账号多设备准确路由。该可选配置的实号联合记录仍NOT_RUN。

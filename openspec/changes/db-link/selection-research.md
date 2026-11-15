# db-link 首批数据库与连接组件调研

**当前决定（2026-11-13，后续用户指令）：首批已确定 MySQL＋PostgreSQL、成熟驱动薄适配。** 精确版本与权限／取消／精度／核算合同见[选型补充 v0.1](driver-selection.md)和[固定版本证据](driver-versions.md)，细节待确认，暂不开发。下文保留先前比较研究及当时“待讨论／未选型”的状态，不覆盖后续决定，也不表示备选已采用。[决定记录](selection-decision.json)

调研日期：2026-11-13。依据已批准的 [DB01–DB18](spec.md)，本轮只做官方文档／固定版本源码研究；未安装或运行候选、未连接数据库、未调用模型，以下均不构成 OptraCall 实测或采用决定。优先问题为订单、会员、库存等业务库，重点比较 MySQL／PostgreSQL，SQL Server 作扩展对照；MariaDB 不因协议兼容而自动获得 MySQL 的验收结论。

## 目标与执行记录

| 任务 | 本轮完成条件 | 状态 |
| --- | --- | --- |
| 核对冻结需求 | 对照 DB01–DB18；不修改 spec／UI | 已完成 |
| DBHub 官方能力与缺口 | 固定发布身份，核源码中的只读、结果与生命周期边界 | 已完成文档／源码研究；未运行 |
| Toolbox／原生驱动对照 | 与相同的完整产品合同比较，避免仅按支持数据库数量选型 | 已整合并行官方来源研究；未运行 |
| 最终讨论建议 | 区分现成复用、OptraCall 必做接缝和未证实能力 | 已形成下述待讨论建议；不启动实施 |

## 待讨论建议：首批 MySQL＋PostgreSQL，优先成熟驱动薄适配

这两类最贴近本轮订单／会员／库存的业务库方向；SQL Server 放在有明确部署需求时独立扩展，MariaDB 另验，Oracle／云仓不因通用组件列为支持就扩大首批承诺。**这是结合批准合同与下述证据作出的工程推断，不是用户已选型、组件已采用或真实业务库类型已确认。**

| 路线 | 已有能力可直接复用 | 为完整 db-link 仍需自有工作 | 本轮倾向 |
| --- | --- | --- | --- |
| `pg`／MySQL2＋最小 Pi 工具适配 | 协议、池、参数化、类型解析、流式／游标及原生事务 | Host 项目授权／来源身份、owner 资源占用与取消回执、完整结果固定、少量结构查询／工具合同 | **优先细化**：这些产品接缝各方案都需要；驱动直接暴露资源控制，可避免再维护 MCP 外加另一条驱动链。具体版本尚未提议／采用。 |
| DBHub 官方 MCP | 少量探索／SQL工具、多连接配置、TLS／SSH、部分只读及限行 | 同上，且公开 owner 取消／文件结果／跨调用快照缺口需解决 | 通用 MCP 备选，适合普通探索；完整链是否可闭合待证。 |
| Google MCP Toolbox | 多源／连接池、toolset、动态SQL、云身份接入 | 同上；generic PG／MySQL 的只读、取消通知和大结果仍有下述限制 | 有 Cloud SQL／BigQuery／集中工具治理需求时再优先评估。 |
| DuckDB 远程扩展 | 远端 ATTACH／结构发现、复制到本地、联合分析 | 远端权限／取消／快照／类型、凭据与扩展分发均须另验 | 保持本地分析主用途；远程扩展作明确收益触发的备选。 |

少量工具接受 Agent 自选 SQL／参数，并返回结果或文件引用；Host 只管理资格、资源和确切材料。无需自建 SQL 引擎、语法解析器、平行 MCP 服务或 Agent Runtime，也不把预定义业务 SQL 当所有问题的入口。正常路径仍是配置一次、项目授权一次、直接提问。

本仓 [createWebSearchExtension](../../../src/agent/web-search-tools.ts#L44) 已通过 Pi 的公开 `registerTool` 注册工具，将 `AbortSignal`／toolCallId 传入 Host port，未增加 SDK runtime 依赖。这证明原生驱动工具有现成注册／port 接缝可复用；**不证明数据库端取消已完成**。DBHub 本轮只按官方原包的公开 MCP 接口评估，不把 `src/connectors` 内部路径当稳定 SDK 导入，也不改包；`pg`／MySQL2 则按其自身公开驱动接口评估。

## DBHub：可复用的普通探索服务，完整链仍有关键接缝

本次官方 `releases/latest` 指向 **v1.6.1**（发布页显示 11 月 11 日、提交 `c416611`），固定 tag 的 `package.json` 同为 `1.6.1`。研究以此 tag 为准，不采用滚动 main 或默认跟随 latest。它是 MIT 许可的数据库 MCP 服务，列出 PostgreSQL、MySQL、MariaDB、SQL Server、Oracle、SQLite；支持 `stdio` 和 HTTP `/mcp`。官方原包可作为后续验证候选，精确版本采用仍由用户决定。[发布记录](https://github.com/bytebase/dbhub/releases/tag/v1.6.1)、[包声明](https://github.com/bytebase/dbhub/blob/v1.6.1/package.json)、[许可](https://github.com/bytebase/dbhub/blob/v1.6.1/LICENSE)、[传输文档](https://dbhub.ai/config/command-line)

**判断：DBHub 的少量工具适合 Agent 自主发现与普通只读探索，但不能直接认定满足已批准的完整 db-link。** 公开工具没有 OptraCall owner／operation 取消契约，没有固定结果文件／流式导出合同，也未见跨工具、跨连接共享一致快照的公开会话合同。为补齐再旁挂一套自有驱动连接链，会同时承担 MCP 与驱动两条读取链的接线、权限、收尾与验收；是否仍比直接复用驱动更省，应据以下缺口比较，不能仅按“两工具”判断。[工具 handler](https://github.com/bytebase/dbhub/blob/v1.6.1/src/tools/execute-sql.ts)、[连接与结果接口](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/interface.ts)

| 对照点 | 官方证据及源码事实 | 对已批准需求的含义 |
| --- | --- | --- |
| 自主探索／SQL（DB04–05） | 默认 `search_objects`＋`execute_sql`；前者按需搜索 schema／表／列／索引／过程及注释，后者接受任意 SQL 文本（单条／多条）。自定义工具可绑定参数，但普通 `execute_sql` 公开输入只有 `sql`，没有独立参数数组。[结构工具](https://dbhub.ai/tools/search-objects)、[普通工具源码](https://github.com/bytebase/dbhub/blob/v1.6.1/src/tools/execute-sql.ts) | 可复用结构发现与 Agent 自选 SQL；不必让 Host 编写业务查询。固定 SQL 模板不是自主分析的必要前置，参数／SQL 回执需如实区分。 |
| 多连接与更新（DB01／03／10） | TOML `sources`／`tools` 可静态配置多个源、每源超时／TLS／SSH／lazy；官方支持热重载，增删或重连发生变化的源，失败可回退。Host 可经受信配置文件路径管理，不需 Agent 接触 DSN。公开 OpenAPI 只列 GET sources，未提供配置 CRUD／测试后保存 API；源码配置需显式 `--config`，不应照抄文档中的隐式自动加载例子。[TOML文档](https://dbhub.ai/config/toml)、[固定配置加载器](https://github.com/bytebase/dbhub/blob/v1.6.1/src/config/toml-loader.ts)、[公开API](https://github.com/bytebase/dbhub/blob/v1.6.1/src/api/openapi.yaml)、[热重载源码](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/config-watcher.ts) | 可复用配置格式／重载；确切配置测试、修订身份、原子保存和在途旧身份仍由 Host 实现。热重载会移除／重连原 source，不等同于 DB03 的任务固定来源。stdio 工具新增／移除需要重启；HTTP 每请求重建服务，但新协议工具列表可缓存 5 分钟。[服务源码](https://github.com/bytebase/dbhub/blob/v1.6.1/src/server.ts) |
| 项目资格与范围（DB02–03／15） | 可按 source 选择暴露工具、设置 readonly／max_rows；无显式工具配置的源默认暴露两个内建工具。HTTP bearer token 是共享 secret 允许名单，源码明确不提供用户／scope 身份模型；配置也没有项目／task／owner、schema／列／行的授权项。[工具注册](https://github.com/bytebase/dbhub/blob/v1.6.1/src/tools/registry.ts)、[认证源码](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/auth-token.ts)、[配置类型](https://github.com/bytebase/dbhub/blob/v1.6.1/src/types/config.ts) | 工具可见性不是项目授权或 SQL 数据边界。Host 仍须对每次目录、结构、查询和读取绑定真实项目与有效范围；表／列／行约束应落实到受限数据库角色、视图及适用数据库原生策略等，不能用 search 参数或工具隐藏替代。 |
| 凭据／网络（DB01／15） | 支持环境变量插值、DSN／分字段、TLS、SSH 密钥／密码／agent、ProxyJump；PG 有 CA／客户端证书，SQL Server 有 NTLM／Azure token，Oracle 有 wallet。具体支持随库不同。HTTP 默认监听 `0.0.0.0`、默认认证关闭；源码的 bearer 认证没有分项目 scope。[连接配置](https://github.com/bytebase/dbhub/blob/v1.6.1/src/types/config.ts)、[CLI默认值](https://dbhub.ai/config/command-line)、[连接管理](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/manager.ts) | 可复用网络接入，Host 负责受信配置／凭据解析与服务暴露。环境变量并非凭据保险库，日志／错误、SQL 内敏感内容和模型出口仍需 OptraCall 核定，不得宣称全环境隔离。 |
| 限行与结果规模（DB05–07） | `max_rows` 对可识别 SELECT／只读 WITH 先改写为数据库端 LIMIT／TOP／Oracle FETCH，并取 `cap+1` 行探测；确实截断时有 `truncated:true`。PG／MySQL 的普通 SELECT 因而不是先取全量再 slice。非 SELECT、特定不能改写的形式不受同一保证；单行 LOB／宽行／多语句总量也不由行上限限制。[限行源码](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/sql-row-limiter.ts) | 复用现有限行与标记，但行上限不证明执行成本、总字节量或全部 SQL 形态有界。驱动返回仍收集为数组，再序列化为 MCP JSON 文本；公开结果无文件／分页 cursor／流式导出合同。[结果格式](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/response-formatter.ts) Agent 可自行分批 SQL，但完整明细自动留存与大文件传输仍需额外接缝。 |
| 类型／来源（DB06–07） | PG 特别保留 date／timestamp 文本，避免宿主时区转换及毫秒截断；MySQL 开启 `supportBigNumbers`；JSON bigint 超安全整数转字符串。普通结果主要是 `source_id` 和逐语句 sql／rows／count／truncated，不返回完整列类型、精度、来源对象、配置修订或数据库快照身份。[PG解析](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/postgres/type-parsers.ts)、[MySQL实现](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/mysql/index.ts)、[结果映射](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/tool-handler-helpers.ts) | 不能从 JSON 值恢复全部实际数据库类型或断言无损。Host 应固定准确结果字节与出处；原生类型／精度的完整需求仍待实际路径验证。Oracle 小数／指数 NUMBER 转 JS number，SQL Server 参数会按 JS 值推断 Int／Float／VarChar，说明多库无损不能统一推定。[Oracle转换](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/oracle/index.ts)、[SQLServer参数](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/sqlserver/request-helpers.ts) |
| 超时与真实停止（DB12／14／18） | PG／MySQL／MariaDB 有服务端超时设置，加客户端后备期限；客户端超时后丢弃连接，并 best effort 另连执行 `pg_cancel_backend`／`KILL QUERY`。失败会被吞掉，调用方仍只得到超时错误；没有把“服务端停止已确认／UNKNOWN”单列回执。SQL Server 配置 driver requestTimeout，Oracle 配置 callTimeout；实际截止语义未运行验证。[超时策略](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/query-timeout.ts)、[PG实现](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/postgres/index.ts)、[MySQL实现](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/mysql/index.ts) | **有超时不等于用户取消。** handler 没有把 MCP extra.signal 传给 executeSQL，ExecuteOptions 没有 AbortSignal／操作ID，公开工具也无按 operation cancel／状态查询。不能把杀共享 source／进程当 DB14 的匹配操作停止，更不能将 MCP 断开视为远端结束。[handler](https://github.com/bytebase/dbhub/blob/v1.6.1/src/tools/execute-sql.ts)、[执行接口](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/interface.ts) |
| 一致版本／独立核算（DB11–13） | PG 一次 executeSQL 在池中借一连接，结束即提交／释放；多语句同事务，未强制 repeatable read。MySQL 同一次请求借一连接，结束即释放。公开工具无跨调用事务句柄、snapshot token、导出／导入快照或查询会话 pinning。[PG请求范围](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/postgres/index.ts)、[MySQL请求范围](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/mysql/index.ts) | 一次事务也不自动证明多条语句共享相同快照；跨工具、跨连接重查更不能冒充同源。DB13 仍可使用足够原始的固定结果核对该范围；若要独立取数验证，必须另有可复现数据库版本／原生快照条件及公开接入能力，DBHub 当前证据未证明此完整路径。 |
| 运行时／许可（DB18） | 核心服务加载数据库驱动并注册 MCP 工具，附带 Workbench 和可选 skills／plugin；已查核心启动与依赖未见模型 Provider 调用、自有 LLM 或分析循环。Node 要求 ≥22.5；驱动是可选依赖。MIT 允许商业分发，保留版权与许可文本。[启动入口](https://github.com/bytebase/dbhub/blob/v1.6.1/src/index.ts)、[依赖声明](https://github.com/bytebase/dbhub/blob/v1.6.1/package.json)、[许可](https://github.com/bytebase/dbhub/blob/v1.6.1/LICENSE) | 核心可沿 Pi 使用，不需引入它的 UI／plugin／skills，更不替换 Pi Runtime。官方“zero dependency”是产品表述；不能据此忽略实际 Node／驱动依赖、进程和许可证清单。 |

### 只读保证必须逐库核定

以下是 **v1.6.1 实现差异**，不是实际权限已验收；任何库均仍需最小权限数据库账号及对允许对象／函数／外部访问的原生约束。普通 SQL 可表达业务所需查询，不应把限制简化为 `SELECT` 前缀。

| 数据库 | DBHub 的执行层后备 | 对本次选型的结论 |
| --- | --- | --- |
| PostgreSQL | keyword classifier 后，以 `BEGIN READ ONLY` 执行／提交；官方明确只读事务不能约束高权限角色通过函数进行的文件／外部副作用。[源码](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/postgres/index.ts)、[官方限制说明](https://dbhub.ai/tools/execute-sql) | 可作为首批重点候选；必须结合非超级用户、最小权限及函数资格。 |
| MySQL | session READ ONLY＋`START TRANSACTION READ ONLY`，执行后恢复原 session 标志，阻止通过隐式提交脱离只读事务的常见 DDL；TiDB 被识别后改为普通事务＋rollback，DDL 只靠 classifier。[实现](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/readonly-transaction.ts) | 重点研究原生 MySQL；不把 TiDB 或其他 MySQL 协议兼容库默认纳入。 |
| SQL Server | 无同等原生只读事务；classifier 加危险构造检查，事务内执行后强制 rollback，异常需报“可能已修改”。另拒绝动态 SQL／pass-through 等逃逸。[事务实现](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/sqlserver/index.ts)、[额外检查](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/sqlserver/request-helpers.ts) | 回滚防护与“数据库拒绝一切副作用”不同；应独立验收后再扩展，不作为 PG／MySQL 同等现成保证。 |
| Oracle | `SET TRANSACTION READ ONLY` 后执行并 rollback；源码明确 DDL 可隐式提交结束只读事务，需前层 classifier 阻止。[实现](https://github.com/bytebase/dbhub/blob/v1.6.1/src/connectors/oracle/index.ts) | 类型／只读／停止及网络接入均另有差异；没有实际业务触发前不必扩大首批。 |
| MariaDB | 与 MySQL 共用后备逻辑，但驱动、服务端超时、版本变量及类型路径分别存在。[共用逻辑](https://github.com/bytebase/dbhub/blob/v1.6.1/src/utils/readonly-transaction.ts)、[独立驱动声明](https://github.com/bytebase/dbhub/blob/v1.6.1/src/index.ts) | 不能继承 MySQL 验收；若用户业务库实际使用 MariaDB，应作为独立目标列入并验证。 |

## Toolbox：动态 SQL 已有，generic 数据源并未提供整套保证

本次固定官方 **v1.17.0**（release 页 11 月 13 日、changelog 日期 2026-11-12），Apache 2.0，提供 macOS arm64 二进制；这只是研究身份。支持 stdio／HTTP MCP，多源、动态 `execute_sql` 与 `list_tables` 已有，不能把它误写成“只支持人工 SQL 模板”，也无需引入另一个 Agent／LLM 循环。[发布记录](https://github.com/googleapis/mcp-toolbox/releases/tag/v1.17.0)、[README](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/README.md)、[许可](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/LICENSE)、[PG工具](https://mcp-toolbox.dev/integrations/postgres/prebuilt-configs/postgresql/)、[MySQL工具](https://mcp-toolbox.dev/integrations/mysql/prebuilt-configs/mysql/)

- **只读不可泛化（DB02／05）：** 官方 readOnly 矩阵列 Cloud SQL PG、AlloyDB PG、Cloud SQL MySQL、BigQuery；generic PG／MySQL 的 `IsReadOnly()` 在固定源码中均返回 false。自建业务库仍依靠实际数据库只读账号／对象权限，不能继承云产品的保证。[固定矩阵](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/docs/en/documentation/configuration/security/read-only.md)、[PG源码](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/internal/sources/postgres/postgres.go)、[MySQL源码](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/internal/sources/mysql/mysql.go)
- **取消与超时（DB14）：** `NotificationHandler` 明确不处理任何 notification；所以 `notifications/cancelled` 不能证明驱动／远端停止。源码虽传递 ctx 给 query，仍无本产品 owner 匹配及远端结束回执。generic PG 的 connectTimeout 只管连接，MySQL queryTimeout 设 driver ReadTimeout，不能当服务端执行成本上限。[通知源码](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/internal/server/mcp/mcp.go)、[PG](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/internal/sources/postgres/postgres.go)、[MySQL](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/internal/sources/mysql/mysql.go)
- **结果与会话（DB06–07／13）：** 两个 generic `RunSQL` 都逐行累积 `[]any` 后一次返回；没有该工具公开的 cursor／文件导出、完整类型／精度／截断回执或跨调用 snapshot 合同。YAML 热重载也不证明在途来源身份冻结。[PG](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/internal/sources/postgres/postgres.go)、[MySQL](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/internal/sources/mysql/mysql.go)、[重载说明](https://mcp-toolbox.dev/reference/cli/#hot-reload)
- **凭据／接入兼容（DB15／18）：** 有配置凭据及 toolset；secureParameters 要求 MCP 2026-07-28 与 Toolbox 专有扩展，不能假定锁定 Pi 已支持。官方 CLI 还说明 prebuilt 配置用于 trusted developer 的 build time；直接将全部预置工具暴露到产品 runtime 并非现成安全接线。[固定工具规范](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/docs/en/documentation/configuration/tools/_index.md)、[扩展目录](https://github.com/googleapis/mcp-toolbox/blob/v1.17.0/extensions/2026-07-28/README.md)、[CLI适用说明](https://mcp-toolbox.dev/reference/cli/#tool-configuration-sources)

## 原生驱动与 DuckDB：复用资源能力，不增加分析编排

| 核查点 | 官方能力及适用边界 |
| --- | --- |
| 固定连接与批量结果 | `pg` 事务要求同一 client，官方 `pg-cursor` 可分批读取；MySQL2 的 Query.stream 可流式返回。Host 可让一次提取租用固定连接，把准确字节写入原材料目录，Agent 继续自主选 SQL。不是另造驱动或分析循环。[PG事务](https://node-postgres.com/features/transactions)、[PG游标](https://node-postgres.com/apis/cursor)、[MySQL2流接口](https://github.com/sidorares/node-mysql2/blob/master/typings/mysql/lib/protocol/sequences/Query.d.ts) |
| 金额／ID／业务时间 | MySQL2 默认 DECIMAL 为字符串，`decimalNumbers:true` 可能失精度，`dateStrings` 可保留日期文本；PG 日期默认受本机时区／JS Date 毫秒精度影响，但有公开类型解析接口。应保留类型元数据及所选表示，不把所有值强转 Number／Date。[MySQL2类型](https://sidorares.github.io/node-mysql2/docs/documentation)、[连接选项](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-connection)、[PG类型](https://node-postgres.com/features/types) |
| 远端停止 | PG `query_timeout` 是客户端期限，`statement_timeout` 才是服务端限制；可通过独立同角色控制连接取消自己的 backend。MySQL `KILL QUERY` 可取消同账号自己的其他 session，但返回仅设置 kill flag，仍要等执行实际结束；`MAX_EXECUTION_TIME` 仅限定只读 SELECT。控制连接属于同一查询资源的收尾手段，不是第二条分析取数链；取消权限、结束确认及网络异常 UNKNOWN 必须实证。[PG配置](https://node-postgres.com/apis/client)、[PG服务端权限](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL)、[MySQL KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html)、[MySQL期限](https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html#optimizer-hints-execution-time) |
| 一致性 | PG 同 client 的 Repeatable Read、MySQL 相应隔离级别下的 InnoDB 一致读可服务单次提取；池不等于快照，MySQL 不覆盖所有存储引擎，事务结束后也不能凭时间戳恢复。跨会话核算仍依靠完整固定材料，或另有可复现数据库版本；不先承诺通用跨库快照。[PG事务语义](https://www.postgresql.org/docs/current/sql-set-transaction.html)、[MySQL一致读](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html) |
| SQL Server 扩展条件 | `mssql`／Tedious 有 stream／pause／cancel／事务连接，但 DECIMAL／NUMERIC 默认 JS Number；SNAPSHOT 还依赖数据库开关。`ApplicationIntent=ReadOnly` 是路由意图，不能代替权限。[mssql](https://tediousjs.github.io/node-mssql/)、[Tedious类型](https://tediousjs.github.io/tedious/api-datatypes.html)、[微软快照](https://learn.microsoft.com/en-us/sql/connect/ado-net/sql/snapshot-isolation-sql-server)、[只读路由](https://learn.microsoft.com/en-us/sql/connect/oledb/features/oledb-driver-for-sql-server-support-for-high-availability-disaster-recovery) |
| DuckDB 的收益与代价 | 官方 postgres／mysql 扩展已有 ATTACH READ_ONLY、结构发现与复制／联合分析；PG 扩展默认 Repeatable Read。它们也提供远端 SQL 执行能力，原生只读角色仍不可省。临时 secret 可用，但持久 secret 默认未加密；PG 无限定／超过38位 NUMERIC 默认可能转DOUBLE，可设VARCHAR。Python interrupt 与 MySQL 扩展取消源码存在，不应笼统说“不支持取消”；锁定扩展在各阶段的远端停止仍未证实。[PG扩展](https://duckdb.org/docs/2.0/core_extensions/postgres/overview)、[MySQL扩展](https://duckdb.org/docs/2.0/core_extensions/mysql)、[Secret](https://duckdb.org/docs/2.0/configuration/secrets_manager)、[Python API](https://duckdb.org/docs/2.0/clients/python/reference/)、[上游取消实现](https://github.com/duckdb/duckdb-mysql/blob/main/src/mysql_connection.cpp) |

以上原生驱动／DuckDB 链接中的 current／master／main 是能力研究来源，并非未来选定发布物的验收身份；若推进，仍需提议精确驱动／扩展版本与许可证清单并由用户决定。现有本地 DuckDB 文件分析许可不自动授权远程扩展。

## 下一步讨论应解决的最小问题

1. 首批按真实订单／会员／库存的数据库部署选择 MySQL／PostgreSQL 的精确服务端版本、网络与身份方式；本轮不要求提供凭据，也不因“支持六种库”扩大承诺。
2. 选组件时同时覆盖普通探索与批准的固定结果／受管取消／独立核算条件。若选 DBHub，先说明上述公开缺口怎样在**不改原包、不另挂第二条取数链**的前提下闭合；若不能，比较原生驱动的总适配量。
3. 后续只有在明确选型和工程授权后，才用隔离合成库验证只读反例、项目拒绝、在途配置、精度／时区、实际截断、大结果文件、撤权与远端停止；一致快照能力按具体库另证。文档研究不能替代这些证明。


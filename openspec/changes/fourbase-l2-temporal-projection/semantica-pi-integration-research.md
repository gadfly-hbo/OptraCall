# Semantica 与嵌入式 Pi 的系统接缝

2026-11-05 · 官方文档／固定源码静态研究 · 未安装、导入或运行组件，不改变产品讨论稿／L2 spec 的授权范围

## 1 结论与版本边界

**Semantica 可通过工具接口为 Pi Agent 提供业务语义上下文；Pi 继续执行模型与工具循环。** 官方已经有 Pi skills 包和 stdio MCP server，两者解决不同层面。OptraCall 仍需绑定真实项目／任务准入、准确业务来源、必要工具权限、进程与取消生命周期，不能把 CLI 的 `pi install` 当作嵌入式产品已接通。[Semantica Pi 说明][s-pi]、[Pi SDK][p-sdk]、[Pi MCP][p-mcp]

| 核对对象 | 本次固定身份与范围 |
| --- | --- |
| Semantica release | `v0.7.0` 对应提交 `2a9afec685fe6f4a18350834caed3d6a9affb27a`；本次重新在线读取 Pi README、包声明、MCP、REST、Explorer 及相关 API 源码；声明 Python `>=3.10,<3.14` |
| Semantica main | GitHub API 本次解析仍为 `4b6de4e356421f4ff39d7e521b52f321c00b27ff`，提交时间 `2026-11-03T05:29:45Z`；声明 0.8.0、Python `>=3.11,<3.14`，不替代 release／wheel |
| Pi | 官方固定 tag `v1.4.0` 的 SDK、extensions、MCP、skills 和 session-format 文档；与产品锁定版本核对，不以 latest 文档代替目标版本 |
| OptraCall | 当前 HEAD `57742b99d173bfa6413e83705682b0444359add4`，只读核对既有接线；本树没有 `node_modules`，不声称本轮已安装／实际运行 Pi |

版本依据：[release pyproject][s-project]、[main pyproject][s-main-project]、[main commit][s-main-commit]。旧 wheel 身份与既有静态使用链研究见 [semantica-usage-research.md](semantica-usage-research.md)；本次没有重新证明依赖闭包或整个 wheel 与 Git tree 全等。

## 2 官方现成的三层能力

| 层次 | 已核官方内容 | 不能据此认为 |
| --- | --- | --- |
| Skills | 根 `package.json` 仅声明 `pi.skills: ["plugins/skills"]`；Pi README 列 17 项 skill，包括 query、ontology、validate、temporal、provenance 等，内容指导 Agent 使用 Python API | skills 已安装 Python 包、启动后端或让所有 API 成为模型工具 |
| 工具协议 | Pi README 推荐另启动 `python -m semantica.mcp_server` 并注册 stdio MCP；release 有 `semantica-mcp` entrypoint | 安装 Python 包后 Pi 自动发现／连接，或已有 OptraCall owner 资格 |
| 执行能力 | Python API 提供 ContextGraph、OntologyEngine、ContextRetriever 等实际对象与方法；具体后端、依赖与状态由所选路径决定 | MCP 已暴露全部本体、约束或混合检索 API，或各入口天然使用同一张图 |

直接依据：[Pi bundle][s-pi]、[Pi 包声明][s-package]、[query skill][s-query-skill]、[ontology skill][s-ontology-skill]、[entrypoints][s-project]。Python wheel 的包发现／package-data 与 repo 的 Pi 包是两种发布物，装 wheel 不等于装 repo skills。

因此，skills 主要告诉 Agent 怎样使用某项能力；MCP 提供可发现、可调用的工具合同与传输；Python Semantica 模块完成具体查询或处理。三层可以组合，但各自是否启用须明确。[Pi skills][p-skills]、[Pi extensions][p-ext]、[Semantica MCP][s-mcp]

## 3 一次工具查询如何到达模型

以下表示可采用的信息链，不是 OptraCall 已实施的新流程或要求 Agent 每次固定调用。

```mermaid
flowchart LR
  SRC[获准 SAP／资料／数据说明] --> BUILD[本体映射与建图]
  BUILD --> KG[所选语义表示与存储]
  A[Pi Agent／模型] -->|自主发起工具调用| T[获准 MCP 或业务工具]
  T --> Q[Semantica 查询 API]
  KG --> Q
  Q -->|相关对象／关系／依据| T
  T -->|工具 content| A
  A --> R[原任务中的分析与回答]
```

准备图数据和运行时查询是两类工作。已安装 MCP 但没有把业务定义映射到所选存储时，Agent 不能查询不存在的企业语义。反过来，建好了图但没有暴露获准工具，也不会自动进入 Pi 上下文。

固定 release 的 MCP 使用 stdin／stdout 上逐行 JSON-RPC：`initialize` 返回能力，`tools/list` 返回名称、说明和 JSON Schema，`tools/call` 分派 handler。handler 结果先 JSON 序列化，再作为 `content: [{type: "text", text: ...}]` 返回。Pi 将工具的 `content` 纳入模型上下文；`details` 主要供展示／状态使用，重要依据不能只藏在 details 中。[MCP dispatcher][s-mcp]、[Pi extensions][p-ext]

LLM 据工具说明生成参数，服务执行查询，结果回到原 Agent，由原 Agent 继续分析。模型参数不会因此自动更新，也不会一次看到整张图。需要检索哪些概念与范围、如何回源及解释冲突，仍是实际业务使用问题。

## 4 官方 MCP 覆盖范围与数据归属

release 的 `TOOLS` 实际为 **15** 项：extract_entities、extract_relations、record_decision、query_decisions、find_precedents、get_causal_chain、add_entity、add_relationship、run_reasoning、get_graph_analytics、export_graph、get_graph_summary、query_graph、update_node、delete_node。main 固定提交为 **16** 项，另增 link_decisions；不可混用版本能力。[release MCP][s-mcp]、[main MCP][s-main-mcp]

- `query_graph` 提供 node、neighbors、search；search 为节点 id／content 关键词，neighbors 的外向遍历最多 5 跳、入向为 1 跳且按来源节点去重。它不是已经暴露的通用自然语言查询或完整 GraphRAG。
- `run_reasoning` 接收调用者给出的 facts／rules，创建 Reasoner 后执行推导；没有在该 handler 中自动读出当前图的全部本体规则。其存在不证明 OWL／企业规则已被完整执行。
- 该工具集没有专门暴露 OntologyEngine 的本体查询、SHACL 或 ContextRetriever 的混合检索 API。这些能力可从 Python 路径评估，不能用 17 个 skill 的名称代替真实工具清单。
- 工具同时包含写图、更新与归档节点操作，不能将官方 server 当默认只读服务；其中也没有 OptraCall 的 projectId／taskId／精确业务引用合同。向某个任务暴露什么能力及数据须由产品接缝明确。

上述结论均来自固定 MCP 的工具定义与 handler，不代表这些调用已实际运行通过。[MCP 源码][s-mcp]、[本体 API][s-ontology]、[检索 API][s-retriever]

### 默认入口不自动共享一个在线业务图

| 入口 | 固定 release 的实际状态方式 |
| --- | --- |
| MCP | `_get_graph()` 首次创建进程内 ContextGraph 单例；若配置 `SEMANTICA_KG_PATH`，从该 JSON 读入；相关变更 handler 保存回该路径。该路径未配置时不能声称重启持久化；未见自动文件监控／刷新 |
| Explorer | `--graph` 加载 JSON 为独立 GraphSession；官方文档说明会话不自动保存，需导出。界面操作不能自然视为 MCP 内存图已更新 |
| `semantica-server` | lifespan 默认创建新的空 ContextGraph／GraphSession；不因 MCP 配了文件路径就连接到同一内存图。其 `/build` handler 的实际构建调用在固定源码中被注释，返回 accepted 不证明已建库 |
| Python API | 调用者显式创建、装载对象，或配置 GraphStore／TripletStore 等所需后端；ContextGraph JSON、RDF 本体和其他图字典不是默认完全等价的表达 |

依据：[MCP 状态与保存][s-mcp]、[Explorer CLI][s-explorer]、[GraphSession][s-session]、[Explorer 持久说明][s-explorer-doc]、[REST server][s-server]、[query skill][s-query-skill]。

所以后续需选定实际存储、装载／刷新和写入所有者。仅让多个进程指向同一 JSON，不能证明并发一致性、权限隔离或管理入口与查询入口已同步；这些是待验证的接缝，不应先另造通用图平台。

## 5 Pi 的嵌入式接入与生命周期

固定 Pi v1.4.0 SDK 文档和示例表明，嵌入式资源加载需要显式装入 `createMcpExtension`；codemode／deferred 工具模式各有相应扩展。MCP 文档支持 stdio 和 Streamable HTTP；本次 Semantica 实际核到的现成 server 是 stdio，不据此宣称其也提供同样的 HTTP MCP 路径。[Pi SDK][p-sdk]、[Pi MCP][p-mcp]、[SDK 示例][p-example]

扩展可以注册工具、处理会话事件，工具 execute 接收 AbortSignal。连接可在 session_start 或按需启动，session_shutdown 负责幂等清理；具体进程所有权与重开策略应沿产品公共生命周期。取消模型回合、取消一个 MCP 请求、关闭 MCP 连接、终止 Python 进程、回滚图写入是不同结果，不能把一个 abort 当作全部完成的证据。[Pi extensions][p-ext]、[Pi MCP][p-mcp]

实际查询应只把相关语义及其依据交给原 Agent。ContextRetriever 的 `query_with_reasoning` 还需要 llm_provider，是组件自己的模型回答路径；不能未经采用决定就把它加入 OptraCall 的另一次分析循环。合法嵌套工具结果也不自动保证每个子结果都独立存入 transcript，引用／保存回执以实际提供的原生记录为准。[检索 API][s-retriever]、[Pi 会话格式][p-session]

## 6 OptraCall 当前可复用接缝与候选路径

以下为根 Agent 本轮通过项目图与定点源码核对的静态结果，当前 HEAD 57742b9；不表示 Semantica 接线已存在。

- `src/agent/project-session.ts:178–196`：现有商圈／天气以 registerMcpServer 注册 stdio；`:362` 创建 createMcpExtension；`:427–468` 的普通 unmanaged 资源显式装载 codemode、tool_search、MCP，受保护／固定文本不随之开放 MCP。
- 同文件 `:315–360`：现有 read_semantic_context、record_analysis_sources 等经 SDK 工具 execute、AbortSignal、call-local ctx 和原 IPC 发起业务请求。
- `src/agent/project-runtime.ts:69–92`：核实际 child、current request／session 和 project／task 资格，调用 Host 窄 port 并限制结果。
- `src/host/semantic-context-port.ts:9–43`：read 委托 SemanticContextService，结果作为 JSON content 与同源 details 返回；record 仍委托 M2，不另建业务权威。

可评估的接法有两条，具体选择取决于已证明的缺口：

| 候选 | 复用什么 | 仍需验证什么 |
| --- | --- | --- |
| A：原生 MCP | 沿既有 MCP 扩展，连接固定 Python Semantica server；Host 绑定获准数据范围，仅暴露所需查询 | 工具暴露策略、精确来源、不同任务的图范围、进程与取消、持久刷新，以及所需本体能力是否已实际暴露 |
| B：现有业务工具薄适配 | 沿现有 semanticContext callback／Host port 调用 Python API 或获准服务，把结果交回同一 Pi 工具调用 | 原生 MCP 不足的准确引用／权限／本体查询接缝；不重复实现原生协议、引擎或另起 Agent 会话 |

两者都未实施，不默认叠两层。A 不能跳过产品权限，B 也不能借“薄适配”重建通用语义引擎。应优先验证现成能力，再以有限业务场景收敛必要差额；普通用户仍在原任务提问。[统一接入](../../../docs/agent-session-integration.md)、[当前复用核对](reuse-audit.md)、[产品讨论稿 v0.3](../../../docs/OptraCall_产品讨论稿_v0.3.md)

## 7 本次未验证与查阅说明

没有安装、导入或执行 Semantica／Pi，没有调用真实 Provider、读业务根／凭据、改服务或操作 MacBook；未验证实际依赖、协议兼容、请求取消、Python 终止、持久并发、刷新、权限或 Agent 语义使用效果。固定源码与接口说明不能替代有限场景运行验证。仅新增本研究笔记，产品稿、spec、Demo、代码和历史结果不改。

后续最小接缝验证还应覆盖 initialize／tools/list／tools/call、业务错误载荷、分页与大小限制、取消／迟到、图更新刷新及多实例一致性。仅设置只读工具 exposure 不等于已落实完整数据授权；获准来源和项目／任务范围必须在实际供给处成立。

本次先尝试的 `plugins/pi` GitHub tree 页面抓取失败；随后根据官方 repo tree 和既有固定引用定位真实 `plugins/.pi-plugin/README.md`，没有把猜测路径失败当作缺少 Pi 支持。公开源内容以 HTTPS 读取，源码只用标准库 AST／文本静态解析，未 import 远程代码。

[s-pi]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/plugins/.pi-plugin/README.md
[s-package]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/package.json
[s-project]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/pyproject.toml
[s-main-project]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/pyproject.toml
[s-main-commit]: https://github.com/semantica-agi/semantica/commit/4b6de4e356421f4ff39d7e521b52f321c00b27ff
[s-query-skill]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/plugins/skills/query/SKILL.md
[s-ontology-skill]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/plugins/skills/ontology/SKILL.md
[s-mcp]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/mcp_server/__init__.py
[s-main-mcp]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/mcp_server/__init__.py
[s-ontology]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/engine.py
[s-retriever]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/context/context_retriever.py
[s-explorer]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/explorer/__init__.py
[s-session]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/explorer/session.py
[s-explorer-doc]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/docs/reference/explorer.md
[s-server]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/server.py
[p-sdk]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md
[p-ext]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md
[p-mcp]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/mcp.md
[p-skills]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/skills.md
[p-session]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/session-format.md
[p-example]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/examples/sdk/14-codemode-mcp.ts

# Semantica 的实际使用链与 L2 采用缺口

2026-11-05（Asia/Shanghai） · `READ_ONLY_RESEARCH` · 不改变 v0.3／P1 授权范围

## 结论与证据边界

**用户的判断成立：更新 spec 和 UI Demo，只完成了产品定位与拟议切片的表达，远未完成 Semantica 的采用。** 要让它帮助 Agent 理解业务，需要把获准业务材料转成有来源、范围和身份的本体／图数据，选择抽取、对齐、约束与检索路径，明确存储和更新方式，再接入 Pi 并验证 Agent 是否正确使用这些语义。页面与预置回答不能完成或证明这条链。

此前 [research.md](research.md) 主要核了来源、显式关系、时间与快照，不能代表已了解并跑通 Semantica 全链。本次补读官方文档、固定发行源码与现有 wheel 的本体／KG／上下文／入口，发现它既有模块化 Python API，也已有 Explorer／Ontology Hub、CLI、REST、MCP 和 Pi 技能包。不能把它说成仅有一个 Python 库，也不能把这些入口当作已经接入 OptraCall 的统一系统。[官方 README][main-readme]、[发行 Explorer][release-explorer]、[Pi 说明][release-pi]

本次只做公开来源与发行包静态读取，使用标准库 ZIP／AST；**未安装、导入或运行 Semantica，未启动 Explorer／REST／MCP／Pi，未调用模型或读取真实业务根、环境变量、配置内容与凭据。** 下文是“已找到的使用路径与限制”，不是亲自跑通的经验、兼容回执或产品效果证明。

| 对象 | 身份与本次使用方式 |
| --- | --- |
| 已有 0.7.0 wheel | 沿用 2026-11-04 下载／核 hash 的 `semantica-0.7.0-py3-none-any.whl`，SHA-256 `faf27d6259ae813ddb44c5213e2f8867592f27e6e3d6b47cea10f1844513799f`；本次补读其中代码，没有重新证明整个依赖闭包 |
| 固定 v0.7.0 源码 | 解引用提交 `2a9afec685fe6f4a18350834caed3d6a9affb27a`；本次入口子核查将 CLI、server、Explorer 入口／session／ontology route、MCP 六份源码与 wheel 逐字节比对相等，不扩大为整个 wheel 与 Git tree 全等 |
| 已读 main | `4b6de4e356421f4ff39d7e521b52f321c00b27ff`，声明 0.8.0；与已发布 wheel 分开。新文档／README 的宣称须对照实际发行 handler |

旧版本、下载和 hash 的原核时间仍为 11-04，详见 [原研究](research.md#2-固定版本发布物与证据位置)。本次新结论的直接依据是固定源码／wheel 静态补读，未把日期更新写成重新运行或全库审计。

## 1. “用 Semantica”需要连通什么

| 环节 | 官方可复用入口／能力 | OptraCall 仍需明确的事情 |
| --- | --- | --- |
| 先确定业务语义与问题 | 本体类、属性、关系、namespace、OWL／RDF、已有本体复用、草稿生成 | 哪份正式定义或普通声明是来源；门店、渠道、净销售额、退款归属等各是什么含义／范围；同名是否同义；哪些仅是观点或待确认草稿 |
| 从材料形成候选结构 | 已抽取数据走 `OntologyEngine.from_data`／`GraphBuilder.build`；文本路径另有抽取与 `from_text` | 哪些来源准入、解析哪些格式、字段与 ID 如何映射；是否真需要 LLM／本地模型；抽取结果如何保留原文位置与不确定性 |
| 对齐与检查 | 生成类／属性、实体解析、冲突模块、KG schema 校验、SHACL、显式 alignment | 同一实体的合并条件，冲突判定的适用范围，关系方向／类型，哪些约束有业务依据；候选对齐不自动成为正式事实 |
| 保存并更新图 | 字典图、GraphStore／TripletStore 可选后端、版本／来源模块；MCP JSON 等现成路径 | 选哪条实际持久路径、数据归属、版本／更新／失效／重建与旧代保全；多个服务怎样看到同一代数据 |
| 把相关语义交给 Agent | `ContextRetriever`、查询 API、MCP、Pi skills | 选择所需读取能力、准确源引用、当前权限／项目过滤、结果限制、取消与失败行为；与 Pi 现有工具／会话入口衔接 |
| 证明 Agent 使用正确 | 组件查询／校验与可解释结果可作工程证据 | 同源问题中，Agent 是否正确适用定义、区分同名范围、主动解释关键冲突／未知；是否存在新增错误和不可接受维护成本 |

这不是要求用户先手工完成一套图谱再提问。Host 管获准环境与记录，工程承担配置／映射／接入，Agent 按需取材与解释；用户或业务定义的负责人只需要决定无法从已确认材料确定的实际业务含义。已有来源能够回答时，应由 Agent／工程复用，不能把全部资料补齐设成用户必做步骤。[本体引擎][release-engine]、[KG 构建][release-builder]、[上下文检索][release-retriever]

## 2. 需要哪些设置：按路径选择，并非全部必填

**组件确有分模块设置，不是一张通用设置表。** 0.7.0 wheel 中找到 15 个独立模块的 `config.py`（ontology、kg、graph_store、triplet_store、vector_store、embeddings、semantic_extract、ingest、parse、normalize、split、deduplication、conflicts、export、visualization）。例如 `OntologyConfig` 与 `GraphStoreConfig` 支持 YAML／JSON／TOML 文件、环境变量及程序设置；这不等于所有模块的参数、优先级和实际入口都一致。本次没有读本机配置值或调用这些配置类。[本体配置][release-ontology-config]、[图后端配置][release-graph-config]

| 配置组 | 要决定什么／为什么 | 主要责任与当前未知 |
| --- | --- | --- |
| 业务本体与规则 | 复用或新建哪份本体；namespace／base URI、类、属性、关系、scope、单位／粒度、约束来源和草稿采用方式。决定同名、同义与合法关系，不能只靠默认值或词频 | 业务定义沿原权威材料；Agent 可提出草稿，工程映射，业务负责人处理实质歧义。**当前未选定 OptraCall 首个正式本体或 SHACL 集** |
| 材料摄取与映射 | 准入来源、格式解析、切分、原 ID／版本／hash／定位、已有结构与文本的映射。决定图里究竟是什么以及如何回源 | Host 提供获准资料，工程配置，Agent 按需使用。**当前仅有 P1 合成固定源，未批准真实摄取／自动扫描** |
| 抽取、对齐与冲突 | 是否运行 NER／关系抽取；本地模型或 Provider；别名与实体合并条件、阈值、冲突类型／策略、置信度和人工确认条件。不同选择会改变语义与成本 | 工程验证组件能力；Agent 提出／解释候选；正式口径仍沿原发布入口。**当前 P1 不运行这些路径，其业务质量未知** |
| 存储与图生命周期 | 内存／JSON／图数据库／RDF TripletStore 等按所需模块选择；获准持久根、版本、快照、更新／失效／重建、共享和刷新。决定重启后有什么、谁可以改 | Host／工程负责环境、权限和生命周期，不能让图成为第二套业务权威。**当前未选定产品后端或多入口同步方案；不是所有场景必须部署 Neo4j** |
| 检索、模型与上下文 | 精确图查询还是混合检索；如采用向量则再选 embedding／维度／索引；如采用 LLM 抽取或答案生成则明确 Provider／模型／预算；结果范围与源引用 | Agent 自主选用现有工具；工程只提供获准能力。**当前 P1 不用真实 Provider／embedding，尚无完整语义检索与回答对照** |
| 接入与运维 | Python／依赖身份、API／MCP／技能／Explorer 中选择何种入口，进程与数据归属、启动／停止／取消、权限／凭据、错误／资源记录、升级与兼容 | Host／工程复用 Pi 原生命周期。**当前未核实嵌入式 Pi1.4.0 的实际兼容、持久重开、服务隔离或运行成本** |

这些设置不应一律做成面向普通用户的页面。业务参数需要有明确含义和来源；工程参数可以选择经过验证的默认，缺少凭据时也不应启动不需要的 Provider。已有 Explorer 可以承担合适的图／本体查看与操作，是否需要产品内管理入口应由实际维护场景决定，不能先复制一套管理平台。

## 3. 本体与知识图谱：实际 API 及不能忽略的默认

### 3.1 本体不只是“打开一个开关”

固定发行的 `OntologyEngine` 提供 `from_data`、`from_text`、`to_owl`／`export_owl`、`to_shacl`、`validate_graph`、`quality_check` 及 alignment 等入口。`from_data` 从已有实体／关系推导候选类与属性，`from_text` 使用 `LLMOntologyGenerator`；外部本体复用另有 `ReuseManager.import_external_ontology`。API 的存在不证明导入任意现有企业本体即可正确运行，本次未运行导入或外部检索。[引擎][release-engine]、[生成器][release-generator]、[复用管理][release-reuse]

关键具体设置包括：

- `NamespaceManager` 默认 base URI 为 `https://semantica.dev/ontology/`、版本 `1.0`；业务本体、来源、实体和关系的 IRI／prefix 应有明确命名与身份规则。示例 namespace 不是 OptraCall 的业务权威。
- `OntologyGenerator` 的类／属性生成默认 `min_occurrences=2`。它可能忽略只出现一次的关键业务概念／谓词；频率门槛不能代替业务重要性。`bootstrap_schema` 输出明确标为 draft，并要求 ratify 才采用，不能把自动草稿当已确认本体。
- `to_shacl` 要确定 target namespace、类／属性 domain／range、基数与约束适用对象。源码明确提示 namespace 错配可能匹配零节点而得到 conforms；`attach_domainless_properties=False` 的默认有意避免把无 domain 的属性约束强加给每个类。
- 显式 `create_alignment` 需要配置 TripletStore，谓词要求完整 URI；本体 alignment 与业务实体去重是不同操作，不能因为名称相似就合并正式实体。

来源：[namespace][release-namespace]、[本体生成与 SHACL][release-generator]、[草稿本体][release-bootstrap]、[alignment 引擎][release-engine]。

### 3.2 需要区分三种“校验”

| 路径 | 本次静态核实 | 不能据此声称什么 |
| --- | --- | --- |
| `OntologyValidator.validate` | 0.7.0 的实现自注为 placeholder／模拟检查；dict 做结构检查，HermiT／Pellet 一致性与可满足性分支尚为 `pass`；`check_constraint` 还直接返回 True | 配了 `reasoner='hermit'` 或拿到 `valid`，不代表完整 OWL 推理或业务规则已被执行 |
| `OntologyEngine.validate_graph` | 有实际 `_run_pyshacl` 调用，依赖可选 pyshacl；数据输入是 RDF 字符串或可 serialize 的 rdflib.Graph，并提供 SHACL 或 ontology 之一 | 不能把普通 `{'entities':...,'relationships':...}` 图字典直接当合规 RDF；不能用空命中／空 shapes 的符合结果证明业务规则正确 |
| `kg.GraphValidator(schema=None, strict=False)` | 另有 KG 字典结构／schema 路径 | 不自动等于 SHACL、OWL 一致性、语义真实性或专业正确性 |

因此，是否需要 OWL 推理、哪些实际约束由可用 SHACL 路径执行，以及图字典到 RDF 的明确映射，都是采用前的具体决定。不能把官方能力列表合成“已具备完整规则治理”，也无需为了一个未采用能力立即自建替代引擎。[本体校验实际实现][release-validator]、[SHACL 调用入口][release-engine]、[KG 校验][release-kg-validator]

### 3.3 构图／去重／冲突也有选择

`GraphBuilder` 默认 `merge_entities=False`、`entity_resolution_strategy='fuzzy'`、`resolve_conflicts=True`、`enable_temporal=False`、`track_history=False`、`version_snapshots=False`。这些默认并不等于 OptraCall 应采用的语义策略：实体是否同一、冲突是否真实、如何保留相反声明，都要有业务身份／范围／来源依据。[构图实现][release-builder]

它可以接受已抽取字典，也能对 raw text 启动抽取；文本路径默认 NER 为 `ml`、关系／triplet 为 pattern，可能需要本地模型。采用非 LLM 路径不等于没有模型依赖或运行副作用。缺失 ID 的兜底也不应替代本项目已有版本化业务 ID。已有 P1 的“准确来源、同名不合并、仅显式关系”只是其中一种保守切片，未验证自动抽取／对齐的质量。

## 4. 已有系统入口：先复用，再核实际差额

### 4.1 Explorer／Ontology Hub 确实存在

0.7.0 wheel 已包含 Explorer 后端 26 个文件、预编译前端 52 件、本体路由，以及 `semantica`、`semantica-explorer`、`semantica-mcp`、`semantica-server`、`semantica-worker` 五个 entrypoint。因此“所有图谱／本体管理都得由 OptraCall 重新开发”不成立。Explorer 接受 `--graph` JSON、`--host`、`--port`、`--no-browser`；本体查看、SHACL 与 alignment 路由值得针对实际维护问题复用核验。本次未开启界面，不声称浏览器交互／保存已经可用。[发行 Explorer][release-explorer]、[本体路由][release-ontology-route]

但它不是所有模块的统一生产配置控制台。Explorer 从 JSON 建独立 `GraphSession`，官方说明其会话变更不自动保存，重启前需导出；MCP 只在配置 `SEMANTICA_KG_PATH` 时读写 JSON；REST 默认另建空 `ContextGraph`。配置一个图数据库 URI，并不会自动让这些入口共享同一在线图。必须选择实际数据路径、更新／刷新与持久策略。[Explorer 文档][main-explorer-doc]、[发行会话][release-explorer-session]、[MCP][release-mcp]、[REST][release-server]

### 4.2 原生 Pi 包有价值，也有明确边界

官方 repo 的 `package.json` 为 Pi 声明 `pi.skills: ['plugins/skills']`，Pi bundle 说明提供 17 项技能；技能可指导 Agent 使用 Python API，工具式访问则另注册 stdio MCP。这些文件在 release 与 main repo 中，**不在 Python wheel 内**；安装 Python 包与装 Pi 技能是两件事。[包声明][release-package]、[Pi bundle][release-pi]

本次未找到专供本项目嵌入式 Pi SDK1.4.0 的 adapter／owner／公共生命周期接线，也未执行兼容验证。后续应先判断哪些原生技能／MCP 能复用，再补 OptraCall 实际差额：原项目／任务资料资格、准确引用、按调用限制、取消／迟到／错误、配置归属及保存记录。既不能把 `pi install` 当本项目自动完成，也不应忽略原生入口后重造技能与通用工具层。

### 4.3 文档／入口差异已经找到，不能只看返回成功

- README 的发布说明提到 `store_document`／`retrieve_context`／`update_document`／`remove_document`，但实际 0.7.0 wheel 的 MCP `TOOLS` 共 15 项，未包含这四项，含 `query_graph` 及写图／删节点工具。需要针对实际工具清单与权限选择，不可按 README 推断是完整文档记忆接口或默认只读。
- 固定发行 REST 的 `POST /build` handler 名为 `build_kb`，实际 `framework.build_knowledge_base(...)` 调用被注释，只返回 `accepted`。收到该响应不能证明建库已经执行。
- `ContextRetriever` 确有 local／global／drift／hybrid 检索与图／向量依赖；`truth_filter` 只支持 local。其 `query_with_reasoning` 又是 LLM 回答路径，不应未经决定成为 OptraCall 的第二套推理循环。

这些是已核的局部差异，不能外推为所有服务均不可用；它们说明选定发行、实际入口和针对性运行验证不可省略。[MCP 实现][release-mcp]、[REST 实现][release-server]、[检索实现][release-retriever]

## 5. v0.3／P1 覆盖什么，仍缺什么

| 已有准备／拟议切片 | 能回答 | 不能回答 |
| --- | --- | --- |
| v0.3 spec／UI Demo | L2 的后端定位、Semantica 优先／Graphiti 条件比较、关键口径由 Agent 主动说明、依据内可选业务含义、正常用户新增必做 0 | 实际本体配置、任何入口已经运行、语义理解已改善 |
| P1 隔离合成计划 | 拟核固定发行的准确来源、显式关系、双时间、快照／重建、工程成本与 L1 同源对照 | 本体／SHACL／实体对齐／摄取／语义检索的完整采用方案，或 Agent 业务理解收益 |
| 本次补充研究 | 说明本体／KG 的使用链、主要设置、原生入口及已知实现限制，避免继续用时间索引代替 L2 全貌 | 不改变上述计划；没有完成环境／模型／服务／业务规则选择或运行验证 |

当前最重要的缺口是**完整 L2 的实际采用方案尚未收敛**：首个真实需求／本体来源、必要模块、运行入口与持久方式、Agent 可见内容与权限、业务正确性评价都未决定。后续整体确认材料应把这部分与“小范围 P1 工程可行性”并列说清；不能先宣称完整 L2，只在实施时补配置，也不能因用户确认方向就默认开所有模块。

若仍保留现 P1，它只负责来源／时间底座探索；若目标优先回答“Semantica 能否帮助 Agent 理解业务语义”，则需要另行提出围绕一个有限业务问题的最小本体／约束／查询／回答对照切片，明确是否替换或调整 P1。这里仅指出决策缺口，**没有批准或实施切片调整、安装、产品接线或真实模型实验**。

后续是否采用 Graphiti，仍由 Semantica 对选定事实演变需求的实际缺口决定，不因本次发现设置复杂就默认双引擎。普通用户继续在原任务提问；涉及本体维护／治理的可选工程与业务管理工作，不能转成每次使用 Agent 的前置步骤。

## 6. 保留的 UNKNOWN／NOT_RUN

当前不知道选定 Python／Mac 与依赖是否完整可装、实际导入副作用、Explorer／MCP／API 是否可在目标隔离环境正确运行、固定 RDF／SHACL 的端到端行为、既有业务本体如何映射、各持久入口能否一致更新、Pi SDK 兼容与权限能否完整保留，以及 Agent 语义使用／回答质量是否改善。本次均为 `NOT_RUN`；不把源码存在、README 宣称、HTTP accepted 或 UI 预置结果列为通过。

本次根调查的猜测路径`docs/reference/config.md`、`semantica/config.py`及`plugins/.pi-plugin/plugin.json`返回404；随后按wheel真实目录和官方README定位分模块config、Pi README及包声明。未将这些路径失败当作没有配置、没有Pi接入或组件运行失败的证据。旧v0.3的10件SHA／mode本次回读均未变，唯一新增项目文件为本文，POC根仍不存在。

[main-readme]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/README.md
[release-engine]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/engine.py
[release-generator]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/ontology_generator.py
[release-reuse]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/reuse_manager.py
[release-namespace]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/namespace_manager.py
[release-bootstrap]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/bootstrap_schema.py
[release-validator]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/ontology_validator.py
[release-ontology-config]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/config.py
[release-graph-config]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/graph_store/config.py
[release-builder]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/graph_builder.py
[release-kg-validator]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/graph_validator.py
[release-retriever]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/context/context_retriever.py
[release-explorer]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/explorer/__init__.py
[release-ontology-route]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/explorer/routes/ontology.py
[release-explorer-session]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/explorer/session.py
[main-explorer-doc]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/docs/reference/explorer.md
[release-package]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/package.json
[release-pi]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/plugins/.pi-plugin/README.md
[release-mcp]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/mcp_server/__init__.py
[release-server]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/server.py

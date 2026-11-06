# 服饰零售：从 L1 材料构建可供 Pi 使用的 Semantica 语义后台

2026-11-05 · 官方固定源码静态研究／操作方案讨论 · 未安装、导入或运行组件，未读取真实业务材料

## 1 前提与结论

用户题设是：L1 已经建设服饰零售的分析指标体系、分析方法、企业背景等材料。本笔记在该假设下说明实操链，不宣称当前分支已经配置这些具体业务内容，也不把本方案当作已批准的本体 schema、数据迁移或开工指令。官方能力核查固定在 Semantica `v0.7.0` 的提交 `2a9afec685fe6f4a18350834caed3d6a9affb27a`；Pi 接缝沿产品锁定的 1.4.0。已有静态限制与版本区别分别见[使用链研究](semantica-usage-research.md)及[Pi 接缝研究](semantica-pi-integration-research.md)。

**应将现有业务定义与来源映射成可复用的本体、带依据的图数据，再提供按任务准入的查询能力。**已有结构优先直接映射；文档抽取补充候选关系；不让模型重新猜一遍正式公式，也不把“全部文本做 embedding”当作已经建好本体。

需要区分三类成果：

| 成果 | 包含什么 | 不代表什么 |
| --- | --- | --- |
| 本体与必要约束 | 类型、属性、关系方向、身份／范围表达，以及有依据且确需执行的约束 | 不是订单数据，不是已经批准全部业务 schema，也不是已执行的完整 OWL 推理 |
| 业务图数据 | 准确的指标／方法版本、企业对象、资料声明、字段映射、来源及有效范围 | 入图不使草稿变正式、推断变事实或建议变行动 |
| Pi 查询视图／工具结果 | 当前任务有权读取的相关定义、对象、关系、原文与局限；这里指当次过滤和组合结果 | 不自动包含全图，不预设持久物化 view／统一 schema，不构成第二份 Pi 会话或全局采用台账 |

## 2 先把 L1 内容按含义分清

以下是来源映射方向，不冻结新字段和引用枚举；真实读取继续复用各模块已有入口、身份和版本。

根 Agent 本轮在当前 `57742b9` 静态核到的现有结构可直接作为映射依据：SAP 指标有 name／type／definition／dimensions／time_grains／caliber_switches／type_params／provenance，场景有 decision_purpose／metric_usages／method_refs／evidence_requirements；RAP 摘要包含目标、已确认事实、假设、指标、数据需要、问题—方法路径和未决事项；M2 有固定输入版本／hash、数据说明及字段／概念／SAP 映射；企业资料有正文、source／owner／scope／effectiveTime、准确修订／hash 与 enabled。这些都不应重新靠全文抽取猜测。[SAP 结构][local-sap]、[RAP 上下文][local-rap]、[M2 类型][local-data]、[企业资料类型][local-enterprise]

SAP 场景中的 `driver` 使用角色不是因果证明，`method_refs` 字符串也不能自动变成完整可执行方法。当前工作树不声称含有后续分析方法模块的全部实现；用户题设中的已建方法作为逻辑来源考虑，正式消费沿其已发布版本与项目准入，不硬编当前未核的字段或 API。

方法的“先保存、后发布，只有已发布版本可供后续任务参考”边界，根 Agent 本轮另以只读 `git show` 核对固定提交 `2b9800bc181b9477109c28c85ab46057ee74243d` 中的[方法产品讨论稿][sap-method-policy]第13、49、60及103–129行；这不表示当前旧 HEAD 已含其后续实现，也未切换分支或运行服务。

| L1 来源 | 在语义后台中的候选表达 | 必须保留的区别 |
| --- | --- | --- |
| SAP 指标发布版 | `MetricDefinition` 的准确版本实例；关联指标概念、单位、维度、时间粒度、公式／口径、适用渠道及来源 | “净销售额”概念与某 SAP 版本的具体定义分开；公式以原发布物为权威，不由建图再次推导替换 |
| SAP 分析方法（题设已具备） | `AnalysisMethod` 的版本实例，关联分析目标、需要的指标／数据、适用条件、限制与可参考步骤 | 沿原 SAP 的发布／项目准入消费；未发布方法不能因为入图获得参考资格。步骤是方法知识，不是 Host 固定执行编排 |
| RAP | 本次任务的目标、对象、时间、约束、已选材料、假设和未决问题；可以作为任务情景覆盖层 | “要分析 A 门店”“假设暖冬影响销售”不等于企业全局事实；任务假设、待核陈述与正式规则不混同 |
| 企业背景／制度／事件材料 | 企业、门店、渠道、组织等对象；有明确来源的经营背景、制度条款和事件声明 | 制度规定与实际行为是不同内容；作者、来源修订、适用范围、时间与争议保留 |
| 项目数据与说明 | Dataset／Field 与概念／指标定义的映射，输入版本、粒度、单位、时间归属、主键或未知 | 字段映射不证明数据质量、去重与粒度已核验；交易明细仍由原文件／Python／DuckDB 计算，不默认逐笔入图 |
| Case、报告、行动与反馈 | 有来源的判断、支持／反对关系、人的取舍、后续观察及可复用经验 | 建议、采纳、执行、观察结果和已证实因果分别表达，不能用一条“有效策略”边代替全部证据 |

对象范围可从门店、渠道、款式、SKU（颜色／尺码）、季节等中选取本场景真正需要的部分；不必首轮导入全部商品主数据和订单。类型例如 `Store` 是本体内容；“S001 店”是具体对象；“S001 在某时段属于直营渠道”是有范围与来源的关系声明；“本次比较 S001 的 10 月表现”则属于任务情景。

若不同资料都出现“净销售额”，只有原定义和范围确实相同才可对齐；不能按名称或 embedding 相似度直接合并。SAP v1 与 v2 保留各自身份，同名指标、渠道例外与历史版本都要能被分别定位。

## 3 操作链：本体、建图、校验、发布与使用

下列顺序说明一次准备过程，不是每次产品分析的必经步骤。普通用户仍在原任务提出问题；工程／Agent 复用已确认材料，只有实质业务歧义才由业务负责人取舍。

### 第一步：选一个能体现语义问题的服饰零售场景

候选可以是“直营门店 10 月净销售额下降，是否应促销”。先限定若干相关指标、一个方法、少量门店／渠道、退款或促销制度、数据说明及一个反例。目的在于验证：同名口径能否区分、方法适用条件能否取得、制度与字段如何关联、Agent 是否因此少漏重要依据。

题面不是标准答案。L1 与 L2 应拿到相同业务材料及必要澄清；组织、索引和检索方式是比较因素。首次整理工作、错误修正和维护成本单列。

### 第二步：读取获准的准确材料，形成映射输入

按已有读取入口取得准确 SAP／资料／数据说明／Case 修订及其来源，不扫描整个业务根。已有结构的类型、版本、定义、refs 可以确定性转换；企业背景的自然语言先定位原文条款，再提出对象、声明和关系候选。

每个候选对象和关系应能回到原对象及版本，说明是正式定义、源中声明、人的意见还是后续推断。这里的“构建输入清单”是具体构建的证据，不先另造通用 Registry 或替代原 citation／Store。业务有效时间和系统留存时间取原证据；不明确时保留未知。

### 第三步：确定小范围本体，再用 Semantica 辅助生成与导出

先把原材料已经说明的类型和关系写清，例如“指标定义适用于渠道”“方法需要指标／具有适用条件”“字段映射到指标定义”“声明来自资料修订”。关系名称、方向和适用范围应由业务依据决定。

`OntologyEngine.from_data(data)` 接受 `entities`／`relationships`，经 `OntologyGenerator` 推导候选类和属性；`from_text` 走 LLM 本体生成。已有 SAP 等结构化材料优先用前者或直接组织明确本体，不必先对全部原文做 LLM 重抽取。[本体引擎][engine]、[本体生成器][generator]

生成器输出的是包含 `classes`、`properties`、`uri`／`version` 等的 ontology dict，可经 `to_owl` 导出 RDF／OWL，并用 `to_shacl` 生成所选约束。namespace／IRI 需按实际导出和校验入口显式核对，不能假定输出中有一个统一的 namespace 字段。自动生成结果仍需核对：类／关系是否齐全、名称是否同义、domain／range 是否合理、是否把临时任务或假设误当企业类型。默认 `min_occurrences=2` 可能遗漏只出现一次的重要类型或谓词；小样本应明确门槛并核对遗漏，不靠重复虚构数据通过门槛。[生成与导出][generator]、[引擎导出及 SHACL][engine]

### 第四步：构造带源的业务图，不自动消除冲突

把准确指标／方法版本、门店／渠道等对象、制度声明、字段说明和必要关系形成图。已有 refs 直接映射；相似名称只作为对齐候选；相反材料并存。RAP 可用来限定“这次查询关心什么”，不默认写成所有未来任务共用的企业事实。

`GraphBuilder.build` 接受预抽取的 `entities`／`relationships`，输出同类图字典及 metadata。首个有精确原身份的场景可评估关闭自动实体合并与冲突消解，避免模糊合并两个指标或让组件替业务裁判；真实默认与后续抽取策略要按选定版本核验。[GraphBuilder][builder]

以下仅是**未执行的 API 形态示意**，`mapped`／路径由未来获准方案准备，不是可直接运行的产品脚本或已批准文件布局：

```python
engine = OntologyEngine(base_uri=chosen_namespace)
draft = engine.from_data(mapped, min_occurrences=1, validate=False)
# 核对并修订候选本体；validate=False 不代表已通过业务校验。
ontology_ttl = engine.to_owl(accepted_ontology)

builder = GraphBuilder(merge_entities=False, resolve_conflicts=False)
kg = builder.build(mapped, extract=False)

context = ContextGraph(advanced_analytics=False)
context.add_nodes(kg["entities"])
context.add_edges(kg["relationships"])
context.save_to_file(candidate_graph_path)
```

`mapped` 的业务字段及准确引用需通过明确的 properties／metadata 等支持字段保留；它们不是 Semantica 原生理解的 OptraCall Ref。上例只说明“已有结构→候选本体／图→查询图”的入口，不证明依赖、构造器副作用、字段保真或保存重开已经可用。[GraphBuilder][builder]、[ContextGraph][context]

### 第五步：分别检查本体结构、图数据约束和业务正确性

| 检查 | 实际要做什么 |
| --- | --- |
| 结构与映射 | 核 ID、引用、端点、关系方向和版本；源中有但图里漏的内容、未知范围与冲突都可辨认 |
| RDF／SHACL（选用时） | 以实际 RDF data graph 和明确 shapes 调用 `OntologyEngine.validate_graph`，核类／属性 IRI 与 target namespace 一致；加入一个故意缺条件的反例，确认 shapes 真正命中节点 |
| 业务语义 | 复核正式口径、渠道例外、方法适用条件和声明性质；模型或抽取候选不能自行修改 SAP 权威 |
| Pi 使用 | 用同源问题观察 Agent 是否正确选取定义、解释冲突和未知、读取原文并完成所需计算 |

0.7.0 的通用 `OntologyValidator.validate` 有 placeholder／模拟分支，不能用其 `valid` 当作完整 OWL 推理通过。实际 SHACL 路径另依赖 pyshacl，输入是 RDF 字符串或可序列化的 rdflib.Graph；GraphBuilder 字典／ContextGraph 并不自动成为同一份 RDF 数据。namespace 错配或零 target 命中也可能“符合”，所以必须核实际覆盖与负例。[校验器][validator]、[SHACL 入口][engine]

同样，方法中的指标分解关系只在范围、粒度、退款／时间归属、去重及样本等条件成立时适用。不能把“与折扣有关”画成“折扣造成销量下降”，也不能让图中方法步骤变成 Host 强制分析流程。

### 第六步：选择实际查询表示并发布可读取版本

本体 dict／RDF、GraphBuilder 图字典与 MCP 的 ContextGraph 是不同表示，但已有原生兼容入口，应先复用再核损失。`ContextGraph.add_nodes/add_edges` 可接受多种字段别名；`load_from_file` 支持 `nodes`／`entities`／`vertices` 及 `edges`／`relationships`／`links`，所以不能仅凭顶层格式不同就断言必须自建转换器。较窄的 `from_dict` 也不能冒充所有装载入口的能力。[ContextGraph 装载与导出][context]

需要做一次构建→保存→重开→查询的往返核验：准确 ID／版本、对象类型、正文、properties／metadata、关系方向、来源、未知和时间窗口是否保留，平行关系是否被压平。`save_to_file` 的 JSON 保存有临时文件与替换步骤，但这不等于跨进程并发或全套业务发布事务已证明。[ContextGraph 保存][context]

可先评估用原生 JSON 查询表示和 `SEMANTICA_KG_PATH` 供 MCP 装载；若需实际图数据库／RDF 查询，再据问题选择后端，不默认必须 Neo4j。MCP 首次加载进程内图，未见自动外部文件监控，因此更新之后要有明确的刷新／重开或其他经过验证的装载方式，不能假定 Explorer 改完即可被 Pi 看见。[MCP 装载][mcp]、[既有接缝研究](semantica-pi-integration-research.md)

这里的“发布图”是让经过所选检查的派生内容可被读取，不取代 SAP 发布、资料准入、项目启用或人的业务取舍。源的更新、撤回及权限变化必须在查询供给时重新核对；旧报告引用仍指向原来源与原版本。

### 第七步：让 Pi 查到相关语义并回到原任务分析

官方 MCP 的 `query_graph` 已有 node／search／neighbors 入口，可以作为“小范围精确查图＋读源”的第一条待验路径。模型先找到准确指标定义，再查渠道、制度、字段和方法的相关关系；返回内容包含必要语义、来源及局限，放进工具 `content`，由原 Pi Agent 决定是否继续回源和计算。[MCP 工具实现][mcp]、[Pi 工具文档][pi-tools]

若所需本体查询／SHACL／语义或混合检索未由 MCP 暴露，可沿现有业务工具薄接缝调用 Python API。`ContextRetriever` 既有 GraphStore 协议路径，也有 GraphBuilder `entities`／`relationships` 字典路径；可评估 local 检索及必要图扩展。其名字为 hybrid 的模式还涉及 local／global 组合，不能只按名字认为“配一个 embedding 就完成”。向量、社区报告或 LLM 合成有各自依赖和成本，应按场景明确；初期不必全开。[ContextRetriever][retriever]

对“10 月净销售额下降，是否促销”，可交给 Agent 的内容是：本次准入的净销售额定义与范围、退款归属、相关字段及数据版本、所选方法的适用条件、已知门店／渠道背景、会影响比较的冲突与未知。图谱不预置“应该促销”的答案；数值分析继续用原数据和计算工具，因果和策略由 Agent／人据证据判断。

## 4 更新、责任与最小实操退出条件

SAP 新版本、制度修订、企业对象变化、字段映射纠正可形成新的派生构建；保留源中已确认与候选状态、旧版及来源。RAP 更新只改变相应任务情景，不默认改全局企业知识。图中的过期／撤回不改写 SAP、旧报告、Case 或人的选择；不能由一次“读取成功”推断 Agent 已理解或采用。

| 责任 | 实操中负责什么 |
| --- | --- |
| Host／工程 | 获准材料读取、精确身份与映射、组件配置／进程、必要检查、保存刷新、工具准入与实际记录 |
| Agent | 提出文档抽取／对齐候选，按需查图和回源，自主选择计算、方法、检查及解释 |
| 业务负责人／用户 | 确定既有依据不能解决的真实口径歧义与业务取舍；不逐条审批普通读取，不被要求先手绘全图 |

一个有限切片至少应能：从原已发布材料重建图；Pi 实际取得正确定义／范围及来源；同名、未知与冲突不会被消除；图更新后可明确读到新版本而旧引用不漂移；组件停用后原 L1 继续；相对同源 L1 的质量、重复工作及首次／维护／查询成本可观察。工程脚本通过与真实 Agent 正确使用分别记录，真实模型和业务材料试验沿当时有效授权。

## 5 尚待实际验证

本次仅对 HTTPS 官方固定源码做文本／AST 静态读取，未 import、安装、构造或执行 Semantica／Pi，未形成真实本体／图文件。上面的业务类型、边名、示意参数和场景均是候选表达，未冻结持久结构。尚需验证依赖／Python 版本、确定性映射与抽取质量、实际约束、字段往返、持久更新、MCP 握手／错误／取消、权限、Agent 使用和成本。只新增本笔记，不改原产品稿、spec、UI Demo、代码或历史结果。

[engine]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/engine.py
[generator]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/ontology_generator.py
[builder]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/graph_builder.py
[context]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/context/context_graph.py
[validator]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/ontology/ontology_validator.py
[retriever]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/context/context_retriever.py
[mcp]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/mcp_server/__init__.py
[pi-tools]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md
[local-sap]: ../../../extensions/business-plugins/metric-factory/sap/validate.ts
[local-rap]: ../../../extensions/business-plugins/requirements-elaboration/api/context.ts
[local-data]: ../../../src/host/project-data-context-types.ts
[local-enterprise]: ../../../src/host/enterprise-materials-types.ts
[sap-method-policy]: https://github.com/gadfly-hbo/OptraCall/blob/2b9800bc181b9477109c28c85ab46057ee74243d/docs/OptraCall_Analysis_IR_产品讨论稿_v1.2.md

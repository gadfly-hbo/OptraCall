# NVIDIA Auto Ontology 与 db-link：适配与部分复用评估

2026-11-14 · **官方固定源码／文档研究；不是采用决定或实施授权，继续暂不开发。**

## 评估结论

**可以部分用上，优先价值在语义发现与资产候选；建议保留已确定的 MySQL／PostgreSQL 成熟驱动薄适配主线，不将 Auto Ontology 整套作为 db-link 执行底座。** 这是对照本轮合同的工程建议，不是用户已经采用新组件，也不是比较实测的优胜结论。

| 用途 | 评估 | 原因与建议 |
| --- | --- | --- |
| 数据库连接／自主 SQL 主入口 | 不建议替代现有路线 | AO有PG／MySQL connector，但其执行、权限与结果合同尚不满足DB05／06／07／14；改用它仍需大量自有接缝 |
| 术语、字段映射、关系、SQL属性读取 | **最值得部分复用** | 已有分离的公开读取API，可由原Pi Agent按需取资料，无需再委托AO问答Agent；适合已有AO服务的企业 |
| 数据说明／Studio初稿 | **可作为候选来源** | 自动表→Term、列映射、关联和表达式建议与关系库场景贴近；保留推断及来源，由原数据说明／Studio保存、核查与发布 |
| Native／Ossie模型交换 | 条件可用 | 已有官方格式和转换路径，但不是无损备份／本地正式发布包；需保留原件、核保真后映射成候选 |
| ask_question专业问答 | 可另行评估，当前不作默认取数 | 它运行外部完整Agent，适合作为另定合同的专业工具候选；不直接提供原Pi自选SQL的驱动接口，也不替代所属取消或独立核算 |
| 从零部署整套AO | 首批暂不建议 | 增加目录库／pgvector、Python服务、Next认证网关、摄取／模型与第二套语义资产运维；须先证明相对现有Semantica／Studio的实际收益 |

最小接法为“AO公开语义读取 → 带来源的候选参考 → 原Pi自主选择；原生成熟驱动负责获准取数 → 确切结果文件 → 原数据说明／Studio／核算”。这条路径还需权限映射、来源固定和受管调用薄适配，不是已有可用集成。若没有AO服务，不为首批db-link先搭另一套语义平台；可参考其关系库建模经验及验收反例，避免重复建设相同治理权威。

## 范围与证据身份

- 官方仓库：`NVIDIA/auto-ontology`，固定提交 **`8ede47f7b67bf2612c5322c7a9adb8e0c6190e38`**。下列远端源码链接均固定该提交；不将后续 main、宣传措辞或测试文件存在当作已验证能力。[A1]
- 本轮读取官方 README、OpenAPI、MCP 实现、语义编译／DAL／模型交换源码及随仓管理技能。只下载证据文本至隔离目录，没有 clone、安装、导入或执行该项目，没有连接数据库或调用模型。原始证据文本位于 `/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-auto-ontology-research/semantic/`。
- 对照当前已批准的 [DB04／08／09／11／13／18](spec.md) 与 [驱动设计补充](driver-selection.md)。首批 MySQL／PostgreSQL、成熟驱动薄适配方向不因研究改变；精确包建议、实施与实际采用按原批准边界分别核定。
- 研究目标清单：语义对象与生成链、独立检索表面、认证／版本／交换保真、连接器／权限／取消／精度、部署／包与数据出口均已做下述官方源码核查；与Studio／Semantica的重叠、最小接法及投入收益为工程推断，未运行验证。研究与正式选型确认分开。

## 组件身份、部署与成熟度

查阅时main对应上述固定提交（commit时间2026-11-14 00:17:37 UTC）。GitHub Releases API返回空列表，tags仅见`pre-main-merge-backup`；源码backend／frontend／MCP声明`1.2.0`。**源码版本不等于已核定的稳定发行身份**：DEPLOYMENT另描述NGC渠道，本轮未核NGC实际artifact，不从GitHub无release推导所有渠道均无发行。[B0][B19][A16][B1][B2]

- 后端包`auto-ontology-server`要求Python `>=3.12,<3.14`，依赖FastAPI、LangChain／LangGraph、模型客户端、多库驱动、Postgres／pgvector访问及Ossie converter；不是已确认的ontology-only／connector-only轻量SDK。[A16]
- MCP是独立小包，Python `>=3.11`、四项直接依赖；它是AO公共API的HTTP客户端，**单独安装MCP不产生数据库或语义引擎**，仍需有可访问的AO服务。[B1][A2]
- 默认Compose启动Postgres17＋pgvector、pgAdmin、backend、ingestion、迁移与Next.js／Prisma；认证／public API在Next网关，FastAPI内层信任网关转发身份，不得直接作为已认证的公开Agent接口。默认整套部署与读取已有服务是不同成本，不概括为所有使用都要在OptraCall本机部署全栈。[B3][A9]
- NIM不强制自托管：官方支持配置NIM或OpenAI-compatible endpoints；实际模型兼容与质量未测试。新建连接会触发摄取；默认scheduler还周期摄取，语义编译另有开关；只读已有术语的GET不等于每次都会执行编译。[B4][B5][B20]
- **第三方治理待审：** 上游`llm_invoke.py`构造ChatNVIDIA后直接赋值`client._client.get_session_fn`。这是上游自身对私有客户端对象的运行时改写事实，本轮没有修改任何SDK；整套采用前仍须按当前官方包／公开契约规则核定影响，不能将“用官方AO原包”自动写成其所有内部依赖行为已合规，也不能自行patch AO去消除风险。[B4][L1]

这些事实支持“它是完整语义／问答应用，公开API可分层消费”的定位，不能仅由NVIDIA归属、支持库数量、仓库活跃度或测试目录推导OptraCall工程成熟度、专业准确率或本场景收益。

## 连接、权限、取消与精度：能否代替执行层

| 本轮合同 | 固定源码事实 | 适配判断 |
| --- | --- | --- |
| 原生连接与结构发现 | PG直接psycopg3＋1–4连接池、autocommit；MySQL直接mysql-connector-python，每execute新连接；有表／列、PK／组合FK、视图等目录提取 | 现成关系库元数据经验有价值，但不是Node侧`pg`／`mysql2`的同栈薄层，也不是一套统一SQLAlchemy源库执行SDK |
| 数据／副作用只读 | PG／MySQL execute直接执行SQL，未在该方法强制READ ONLY或检查函数副作用；另一路probe采用SELECT／WITH与禁词regex | “MCP读工具”指其工具操作面，不能推断库账号或所有函数均只读；账号实际权限须部署另证，本轮不声称真实部署已有写权限 |
| 项目与权限域 | schema／table allow／deny只过滤摄取目录，retrieval执行时不生效；网关有admin／viewer动作权限，proxy源码明确默认unscoped | 不能当作OptraCall project/task/operation和不同项目实际数据域。较窄范围仍要原生受限绑定，目录隐藏不补成授权 |
| 连接修订与凭据 | 未配置Vault时完整凭据JSON落catalog Postgres，Vault可选；UI配置与环境变量在摄取／问答中优先级不同 | 不能直接继承Host凭据引用、确切已测修订、在途身份、撤权与模型出口合同；需另定映射，不双重录入长期维护 |
| 超时与停止 | PG可事务内SET LOCAL statement_timeout；MySQL尝试两类session变量，均不存在时继续执行。REST有按conversation／owner的cancel，停止会terminate／kill Python worker；MCP未暴露cancel，断开SSE不停止后端run | 有基础超时／会话停止能力，但没有本轮所需原数据库查询与控制命令各自终结、同节点身份、迟到取消／UNKNOWN占用回执。不能把杀worker或断流当作远端SQL已终止 |
| 大结果 | PG／MySQL均fetchall→DataFrame；问答整批to_json，MCP再将返回rows裁为100并标truncated | MCP100行是交付裁剪，不是数据库／内存读取上限；没有已证明的字节预算、背压流写、partial与完整manifest原子提交 |
| 精度与核算材料 | 执行返回DataFrame后JSON序列化，未形成ordinal／原类型／precision／scale／session条件＋typed参数＋块摘要合同；采样转换还明确将非整数Decimal转float、bytes替换解码 | 不等于db-link的精确结果文件集。采样精度转换不能泛称所有查询值必然损坏，但不能据其普通JSON宣称满足金额／JSON大数／微秒／二进制保真；ontology审核也不代替独立核算 |

源码依据：[PG connector][B6]、[MySQL connector][B7]、[registry的摄取限定][B8]、[probe检查][B9]、[网关权限边界][B10]、[连接／凭据文档][B11]、[聊天cancel][B12]、[worker停止][B13]、[整批结果序列化][B14]、[采样转换][B15]及[MCP问答／100行与截断合同][B21]。本节是对已检查路径的静态对照，不是全面安全审计或漏洞利用证明。

因此，改用AO并不能省去本轮最关键的权限／来源、owner／取消、精度与材料接缝，且会增加Python服务与资产治理负担。已有成熟连接器的目录SQL、组合FK、分区／视图完整性及采样失败案例值得作为设计与验收参考；**参考经验不等于已引入SDK，也不建议把其内部connector代码裁剪／复制成自有分叉。**

## 数据入口与模型出口：不止元数据名称

AO语义编译会`SELECT * ... LIMIT 1000`采样、整理top5 sample values；关闭distinct扫描只关闭额外探针，不关闭该样本读取。样例值可进入embedding text和关系推理；PG目录提取还可读取`pg_stat_activity`其他会话的query文本，查询历史表达式可送LLM生成SQL属性。PII标记不是已证明的自动脱敏边界。[B15][B16][B17][B18]

所以“连接一次”不应顺带授权跨库批量采样、历史SQL、外部embedding和模型请求。未来若接公开语义API，应一次配置获准服务身份／可用目录／模型出口，并由Host落实项目与对象资格；Agent自主按需读取，正常路径不增加逐次确认。仅消费已存在语义与在AO中新建连接、运行编译的权限和副作用应分开。返回候选要固定服务／对象身份和确切字节；modified时间或本地hash不冒充上游不可变发布版。

## 语义能力的实际正向收益

Auto Ontology 有可以拆开使用的语义读能力。它并非只有“把问题交给外部 NL2SQL Agent”这一种入口。对 db-link 最有价值的是：把物理表列、业务术语、字段映射、关系及已有 SQL 表达式放在一起供 Agent 按需读取；这有机会减少 Agent 反复猜字段含义、重复寻找关联和重复整理来源映射的工作。其实际业务正确率、人工减少幅度及与现有能力相比的增益，本轮均未验证。[A1][A2][A3]

| 对象／环节 | 固定源码里的能力 | 对 db-link 的可用价值与边界 |
| --- | --- | --- |
| 物理目录 → 语义草稿 | 官方流程读取 schema、profile／sample values，逐表提取 Term，并映射列；关系来自键与数据，SQL attribute 建议可来自查询历史；最终存于 Postgres／pgvector | 对 DB04 的按需发现与 DB08 的对象含义／字段位置有直接参考价值；输入不只元数据名称，还可能包括样例值与查询历史，须沿原项目和模型出口资格提供 |
| Term | 名称、描述、synonyms、所代表的表、列属性及 related terms；提取器用 LLM 为表提议一个或少数术语，并为现有列分配显示名 | 可以生成数据说明／Studio 候选，输出仍须保留“推断／争议／未知”；命名成功不能确立业务口径 |
| ColumnAttribute | 显示名、描述、类型、原列，能够返回完整 catalog path；主列与引用列分开 | 有助于从业务概念回到实际字段；映射不是取数权限，也不能将跨项目可见性自动带入 |
| Relationships | `REPRESENTS`、`HAS_ATTRIBUTE`、`PROPERTY_OF`、`SEMANTIC_FK` 等关系与物理 FK／join，另有 bridge-table 处理；REST 可取实际 hop chain | 对表列关联发现和 Binding 候选有帮助；当前主要围绕关系库映射／join，不能从此推导通用业务条件、时间与冲突语义均已表达 |
| SQL attributes | Term 下的可复用 SQL／expression；source 区分 `manual`、`sql`、`table`、`bridgeTable`，并链接实际 SQL 与相关列 | 可将已核表达式作为 Agent 的候选依据；OptraCall 已有 SAP／M2／Studio 权威，不能直接再建一份独立公式发布权威 |

本表依据为 [官方生成／认证／问答说明][A1]、[Term 提取器][A4]、[API 对象模型][A5]、[关系路径 API][A3]、[语义编译入口][A6] 与 [原生交换 schema][A7]。官方编译链包含 TermFamily、semantic FK、未匹配 FK、query-history SQL attributes、bridge tables、column descriptions 等阶段；`run_semantic_compilation()` 是一整段应用流程，不是单纯的元数据格式转换。[A6]

## 能否只检索结构／语义，不调用 NL2SQL Agent

**可以，但要区分普通目录／术语读取、向量召回和问答能力。** 固定 OpenAPI 和 handler 给出了下列分离表面：[A2][A3][A8][A18][A19][A20]

| 表面 | 实际入口与行为 | 是否必须调用外部 NL2SQL Agent |
| --- | --- | --- |
| MCP glossary 读取 | `search_terms` → `GET /api/terms`；`get_term`、`get_term_columns`、`get_term_sql_attributes`、`get_sql_attribute`、`describe_table` | 否。对应目录／DAL 读路径可独立使用 |
| MCP `search_terms` | handler 明确是 Term **名称的大小写无关子串过滤**，有 skip／limit／total | 否；不能将它称为自然语言向量语义搜索 |
| REST 结构发现 | `GET /api/datasources/dbs`、`/api/schemas/{db_id}`、`/api/tables/{schema_id}`、`/api/columns/{table_id}` | 否。公开 OpenAPI 列明 `catalog:read` |
| REST 全文搜索 | `POST /api/search/global-search` 及 `/count`，检索 catalog 与 semantic nodes；可选 description／synonyms、对象／tag／database/schema 过滤；list 上限 200 | 否。服务调用全文 DAL，不经过问答图；它也不是向量召回 API |
| REST 关系读取 | `/api/exploration/graph`、`/semantic-graph`、各对象 details、node relationships、Term 间 path | 否。service 直接转交关系／目录 DAL |
| MCP `check_answerable` | 调用 question-entity-coverage；该服务建立 LangGraph payload，使用 LLM client、retriever 和 connectors，受单独运行锁管理 | 不运行完整 NL2SQL 问答，但**仍是模型／图执行**，不是纯目录检查 |
| MCP `ask_question` | 问答流入口，使用项目自己的 Agent 构造 SQL／检查／执行并返回答案 | 是。不是本轮“仅提供结构和语义给原 Pi Agent”的最小路径 |

MCP 的 allow-list **刻意排除**逐库／schema／columns 的物理目录遍历，只开放语义为中心的少量读取；因而 MCP 单独接入不能完整替代 DB04 的物理结构按需发现。可直接使用已有公开 REST 结构端点，但这仍要求 Auto Ontology 应用服务及其权限体系存在，不能把 Python backend 私有端口当成已经认证的独立公共 SDK。[A2][A8][A9]

在已核 OpenAPI／MCP surface 中，没有发现一个通用的“输入文本 → 原始向量语义候选”公开端点；语义向量召回作为内部 data-access／retriever 被编译或问答链使用。若目标只是现有 Pi Agent 按需读明确术语／结构，公开读取 API 已有路径；若目标要求直接复用它的向量召回，公开稳定契约尚未建立，不能通过调用内部函数或修改 SDK 直接认定接缝已解决。[A2][A8][A10]

## 认证、版本、来源及导入导出的实际合同

| 关注点 | 已核事实 | 对 OptraCall 的含义／未证明项 |
| --- | --- | --- |
| 语义“认证” | Term 有 `name_certified`／`description_certified`，ColumnAttribute／SqlAttribute 有 `certified`；DAL 将部分标记汇总为 `certified`／`partial`／`pending`。schema 称其为人设置的布尔标记 | 有可读审核状态；不是业务准确性证明，也不是不可变发布版。官方随仓 publication 指南也明确当前字段不是原子的 review／promotion 系统 |
| 编辑／来源信息 | API 对象有 UUID、catalog path、SQL、source category、created／modified、created_by／modified_by；原生 import 有 `imported_id` 映射 | 能辅助追踪映射及编辑者；`source='sql'` 等类别不等于 OptraCall 所需的准确来源版本、原件 hash、当前读取资格及引用证明 |
| 版本 | `schema_version.py` 检查 Alembic 数据库结构 revision；核读 Term／SqlAttribute API 与交换模型没有发现不可变语义发布版／supersession／撤回合同 | Alembic revision 不能当业务定义版本；仍须沿原 Studio／SAP／数据说明版本和历史引用管理 |
| Native export/import | `/api/model/export` 按数据库 ID 作用域，native YAML 含 data_layer、semantic_layer、zones；含 terms、column attributes、semantic FKs、分来源 SQL attributes、custom analyses。import 的 `replace` 默认 true，`embed` 默认 true | 适合交换结构化候选；不能当完整备份或无损发布包。核读 schema 不包含 synonyms、certified flags、owners、编辑记录、模型版本或来源 hash |
| 导出副作用范围 | export 为解析 dialect 调用 `get_connectors()`；代码说明构造 connectors 会连接所有配置数据库，失败才回落到保存设置 | 即使请求限定少量数据库，不能假定仅离线读取交换数据；正式接入须核对真实访问范围 |
| Ossie | 应用使用官方 Apache Ossie converter；项目依赖固定到 converter Git commit `cb4b46b97bcdb9f2685ef2f7023b9134a4426da2`。可导出 semantic model YAML，`include_ontology=true` 时导出 semantic_model／ontology／mapping 三文档 zip | 提供第三方语义模型交换路径，适合跨工具候选交换研究；不是已证明能无损承载 OptraCall Studio／SAP／M2 的治理语义 |
| Ossie 有损路径 | converter 前的 `_project_terms_onto_one_table()` 将多表 Term 收窄至拥有最多 column attributes 的一张表，丢弃其他表属性，并过滤不再保留的 semantic FKs；重复 custom-analysis 名称会拒绝导出 | **不能宣称无损 round-trip。** 必须保留原 native／来源材料，并核对所需对象的逐项保真；本轮没有运行转换 |

依据：[API 模型与编辑字段][A5]、[认证 DAL][A11]、[schema／imported_id][A12]、[SQL attribute schema][A21]、[Alembic 检查][A13]、[交换 schema][A7]、[交换 service][A14]、[官方 publication 指南][A15]、[依赖声明][A16]。官方指南还列有 replacement 留存关系／孤儿等问题的核读要求；本轮未复现，不把指南中的防护建议算作实现已经解决。[A15]

这里的“语义认证”与登录认证应分开。MCP／公共 REST 是 Auto Ontology 应用权限体系的入口；Python backend 的用户 header 来自可信私有 gateway，其源码明确不能直接公开，因为 header 在该层没有独立认证。这些能力不能直接继承为 OptraCall 的 project／task／owner 访问合同。[A9]

## 纯库 API 是否可以公开稳定复用

官方 README 自称 open library，但当前 Python 项目包名是 `auto-ontology-server` `1.2.0`，要求 Python `>=3.12,<3.14`；依赖同时包含 FastAPI、LangChain／LangGraph、Postgres／pgvector 相关库、多库驱动、模型客户端与 Ossie converter。顶层 `auto_ontology/__init__.py` 没有导出的 SDK facade；核读的 semantic／DAL／service 函数普遍直接引用本应用的 store、env、connectors、模型或 embeddings。[A16][A17][A4][A6][A14]

**工程判断：**“可以 import 某个没有下划线的函数”不足以证明它是受支持、稳定的纯库 API。本轮找到了官方 OpenAPI／MCP 契约，未找到独立 ontology-only 包或正式库 API 稳定性承诺。直接嵌入 `run_semantic_compilation`、DAL 或内部 retriever，会引入应用状态与版本耦合；按当前第三方官方原包规则，不能用裁剪官方包、patch、monkeypatch 或替换其模型内部对象把它改成 Pi 插件。若将来确认有采用价值，优先评价公开 REST／MCP；Ossie converter 本身可作为另一独立官方组件候选研究，仍需用户指定版本和另行授权，不能从本次依赖 pin 自动取得采用许可。[A2][A8][A16][L1]

## 与当前 Semantica／Studio 的重叠与最小复用路径

当前 OptraCall 已有语义图查询合同 `find`／`definition`／`neighbors`／`dependencies`／`impact`／`source`，Host service 固定 snapshot／owner、分页与 source handle，并在输出前重查来源资格；这些是当前源码事实，不从历史记忆推断运行采用。[L2][L3] DB08／09 已要求数据说明修订、确切来源、Studio 候选与 Binding，并将正式发布、项目采用、图刷新和实际使用分别记录。[L4]

| 需求 | Auto Ontology 与既有能力的关系 | 最小路径的研究判断 |
| --- | --- | --- |
| DB04 普通库发现／SQL 取数 | AO 有目录读取；把完整问答Agent当默认取数会增加外部推理／执行与生命周期接缝，不能直接履行原Pi自选SQL的驱动合同 | 保持原Pi Agent＋获准驱动；外部Agent在另定合同下可作专业工具，不一概判为违反四原则。AO不是普通取数必经依赖 |
| DB08 初始语义整理 | AO 对关系库有专门的 table→Term／column mapping／SQL history 经验，能减少候选整理工作；与 Semantica 实体／关系／图和现有数据说明有重叠 | 有价值的增量是“关系库专门的候选材料／转换适配”，先证明缺口及增益；不要为读取结构另部署完整语义产品 |
| DB09 Studio 持久业务资产 | AO 的术语／表达式编辑和 certification 与现有 Studio 权威重叠；交换 schema 没有原发布治理合同 | 最小输入是带精确源身份的候选 Terms／mappings／relationships／SQL expressions，进入原数据说明／Studio 候选；由原入口发布，原语义图派生刷新 |
| 现有企业已经部署 AO | 已有公共 API 可以提供结构／术语／映射／关系，无需将问题交其 ask_question | 可单独评价只读外部语义来源薄适配：Host 绑定范围／身份／预算，原 Pi Agent 自主决定是否读取；读取不自动发布或采用 |
| 跨语义系统交换 | Native／Ossie 已有格式与官方 converter 可借鉴／复用，避免自行发明交换格式 | 先固定所需字段与保真差额。保留原始交换文档和来源身份，在自有适配里映射为候选；不从交换成功推导业务正确或正式采用 |

上表后四项是**工程推断／候选方向，不是选型结论**。当前最小、风险较低的正向收益是复用其公开语义读取或交换能力，将其作为可选来源／候选输入；只有在具体受阻案例证明现有 Semantica／Studio 无法充分完成、收益超过服务与治理成本时，才有理由进一步研究官方组件接入。不能把 AO 编译→人工认证→AO 问答流程硬塞成所有 db-link 分析的前置，也不能增加用户逐术语维护／逐次审批普通读取；Agent 仍自主选来源、写 SQL、分析和纠错。[L1][L4]

DB11／13 的独立核算不由 ontology correctness 替代。AO 的术语／SQL 表达式可成为有准确身份的事前语义材料，但作者 SQL、表达式或答案是否可在冷读中提供，仍须按原固定输入／冷读隔离合同判断；实时重新问 AO 或重新查询并不证明同版本独立核算。[L4]

## 四原则复核与建议下一步

| 原则 | 本评估保留的复用边界 |
| --- | --- |
| Host管环境 | 绑定官方组件／服务、凭据／项目资格、模型出口、预算、取消与确切来源；不把AO viewer角色或目录过滤当本地真实数据域，不由Host判断业务定义正确 |
| Agent自主执行 | 原Pi自主选择语义来源、SQL、方法与纠错；AO语义可选，不强制编译→人工认证→问答。ask_question若另行采用是明确外部工具合同，不暗换默认主Agent |
| 优先复用官方SDK已有能力 | 优先评价已有公开REST／MCP和交换格式，沿原Pi／数据说明／Studio权威；不直接用内部retriever、裁包、fork或私有改写拼出新Runtime。现有能力重叠不等于无价值，也不能跳过真实差额比较 |
| 减少人类操作 | 候选及来源由Agent／Host自动衔接，正式发布沿原入口；不要求人日常两套系统重复认证、逐字段维护、搬文件或逐次审批。新外部身份／资格若确需配置，合并到首次连接／项目授权 |

**建议暂将AO列为可选语义来源／交换候选，首批执行层不替换、不增加必选组件。** 若后续有明确的大型schema／已有AO部署需求，再申请相称验证：在同一合成订单／会员／库存schema、同模型与预算下，与现有Pi＋Semantica／Studio路径比较字段定位、复合键／多表join、粒度／单位／时间／退款语义、人工修正量、延迟／成本及保真。先证明实际增益，再决定是否引入新服务；本轮不运行PoC，不先做适配开发。

独立核算仍核固定输入及真实覆盖；AO的认证flag、query验证、第二次实时问答或一个正确SQL样例均不代表取数完整或业务正确。本轮研究没有改变DB11–13现行RCR／CNR与数据库独立候选边界。

## 未验证与检查边界

未执行：包安装／导入、服务部署、任何 SQL／模型调用、REST／MCP 端到端、native／Ossie round-trip、语义正确率或对照增益、OptraCall 转换适配、项目隔离、取消／资源、旧资产兼容或产品体验。上述源码存在不构成工程支持、专业质量或产品验收。

未核NGC实际artifact、第三方依赖闭包／漏洞、全部认证部署和全部数据库路径；仅按本轮合同核固定PG／MySQL、语义／交换、MCP／公开API与相关运行路径。不得把“语义读API可分离”扩大为“整套产品适合直接采用”，也不从某个connector缺口概括其全部功能无价值。批准原spec/UI与驱动补充候选不改，用户对AO的采用或版本决定仍未作出。

## 固定官方来源与当前项目依据

[B0]: https://api.github.com/repos/NVIDIA/auto-ontology/releases?per_page=5
[B1]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/mcp/pyproject.toml#L5-L41
[B2]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/DEPLOYMENT.md#L9-L22
[B3]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/docker-compose.yml#L5-L173
[B4]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/utils/llm_invoke.py#L214-L254
[B5]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/connections/service.py#L191-L225
[B6]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/connectors/postgres.py#L22-L121
[B7]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/connectors/mysql.py#L77-L152
[B8]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/connectors/registry.py#L256-L317
[B9]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/retrieval/text_to_sql/db_probe/executor.py#L46-L78
[B10]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/frontend/auth/proxy-backend.ts#L12-L14
[B11]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/docs/connections.md
[B12]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/chat/router.py#L714-L739
[B13]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/chat/worker.py#L316-L324
[B14]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/retrieval/text_to_sql/agents/sql_execution.py#L168-L194
[B15]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/semantic/visit_enter.py#L312-L538
[B16]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/utils/embedding_rows.py#L122-L221
[B17]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/connectors/postgres.py#L220-L243
[B18]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/infra/feature_flags.py#L95-L131
[B19]: https://api.github.com/repos/NVIDIA/auto-ontology/tags?per_page=8
[B20]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/ingestion_service/__main__.py#L5-L88
[B21]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/docs/mcp.md#L131-L138

[A1]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/README.md#how-it-works
[A2]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/mcp/auto_ontology_mcp/tools.py#L5-L147
[A3]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/exploration/router.py
[A4]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/semantic/term_extractor.py#L220-L262
[A5]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/models.py#L539-L667
[A6]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/semantic/compile.py
[A7]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/model_interchange/schemas.py
[A8]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/docs/openapi/auto-ontology-api.json
[A9]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/identity.py
[A10]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/retrieval/data_access/semantic_search.py
[A11]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/dal/terms.py#L157-L261
[A12]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/dal/schema.py#L111-L129
[A13]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/dal/schema_version.py
[A14]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/model_interchange/service.py
[A15]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/skills/nvidia-ontology-management/references/publication.md
[A16]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/pyproject.toml#L5-L76
[A17]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/__init__.py
[A18]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/terms/router.py#L49-L113
[A19]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/search/service.py
[A20]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/server/metadata/service.py
[A21]: https://github.com/NVIDIA/auto-ontology/blob/8ede47f7b67bf2612c5322c7a9adb8e0c6190e38/auto_ontology/dal/schema.py#L655-L678
[L1]: ../../../docs/engineering-workflow.md#四点产品原则
[L2]: ../../../extensions/business-plugins/semantic-context/graph.ts#L64
[L3]: ../../../src/host/semantic-graph-service.ts#L111
[L4]: spec.md#db04-agent-自主发现

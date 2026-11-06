# S3 结构增补 D12：首场景派生快照与装载保护

2026-11-05 · 用户已确认D12.1–D12.7全部采用推荐A · 原SAP／M2合同及产品范围沿用

## 1. 当前授权及已确认范围

用户已授权进入S3，明确3核心指标＋1方法＋小本体／带源图，并将首切片设为准确版本核对、有效来源筛选、加载失败处理。该建设方向、SC-01S合成资料范围与原D01–D11总体原则均沿用；旧文件“待整体确认”的历史措辞不重开这些决定。

本增补只确定此前尚未形成的**派生快照字段、身份、保存／重开及当前来源准入合同**。[原结构边界](structure-decisions.md#2-s1s2-需要形成的具体合同)已要求在写入这些新结构前补受影响决定。结构skill要求：`Do not create or materially change ... storage layouts, or joint contracts ... until ... the user approves the complete decision ledger.`用户已在本轮明确整体确认7项A，以下字段、身份、布局和验收现可按确认范围实施；S2 fixture仍只作工程证据，不自动晋升正式资产。

当前已完成的原合同资产、实际身份及检查见[S3进展](s3-progress.md)。本轮开始实施新图／本体快照及其装载器；实际结果另见S3完成记录，不以原生Store已有保护替代新切片验收。

本次共7项增补决定，用户全部采用A。B保留原审阅时的替代及影响，未采用。没有新增数据库、全局Registry、current指针、后台watcher、Pi工具合同或前端页面。

## 2. 整体决定清单

| 编号 | 推荐A及原因 | 替代B及影响 | 用户决定／状态 |
| --- | --- | --- | --- |
| D12.1 权威、对象及粒度 | SAP、方法、企业资料、M2继续权威；图为可重建派生ReadModel。区分概念、准确资产版、条件、字段角色、来源修订及声明；避免第二套事实／公式库 | 暂缓正式派生快照，继续现有SAP／M2及工程查询，不能记S3本体／图完成 | 2026-11-05用户采用A；一致；已确认 |
| D12.2 身份及字段 | 沿原生ContextGraph字段和第3节明确metadata字段组，采用准确原Ref及有源局部身份；避免候选号冒充资产ID、同名合并及字段往返有损 | 暂缓图持久化，保留内容草案；后续仍需明确字段，不能沿用S2 ENG身份作生产身份 | 2026-11-05用户采用A；一致；已确认 |
| D12.3 来源及关系 | 一个声明的正文与全部必要来源一起准入；来源Refs、整理性质、条件和限制分别保存；保留平行／相反声明、依赖方向及减项角色 | 只展示源文本，不提供结构关系；避免错误筛选，但不能验收关系／依赖查询 | 2026-11-05用户采用A；一致；已确认 |
| D12.4 保存、构建与版本 | 第4节单一构建者、新目录不可变快照、原生图＋候选本体＋构建回执。全件校验后才可选用，旧版本不改写；便于重建与失败保全 | 暂缓新持久布局，保留隔离SAP／M2；不以共用JSON替代发布／刷新安排 | 2026-11-05用户采用A；一致；已确认 |
| D12.5 来源有效性 | 新查询从原权威核准确版本／当前资格，按声明及边过滤；不信图内active标签。原Ref的nullable／optional hash语义不变 | 暂不供新查询；旧引用仍可按原合同取证，但不能宣称可用语义检索 | 2026-11-05用户采用A；一致；已确认 |
| D12.6 装载、刷新及恢复 | 显式装载准确快照，缺失／损坏／错身份／错hash报失败，禁止空图ready或静默latest。更新、停用与回退按第5节处理 | 暂缓快照读口；S3资料可以继续整理，不能记保存／重开与失败保护完成 | 2026-11-05用户采用A；一致；已确认 |
| D12.7 验收、维护及阶段 | 先完成第6节真实前置失败／最小实现／回归，再建图及保真／约束检查；S3只做隔离资产与工程查读，S4再接原Pi | 暂缓新结构，保留本次已完成资产；原目标及S2缺口继续开放 | 2026-11-05用户采用A；一致；已确认 |

## 3. 原生对象及明确字段组

### 3.1 原权威与派生身份

- 三指标沿原包`optracall-sc01s-retail@0.1.0`及包内`terminal_sales_amount`、`retail_refund_amount`、`net_retail_sales`；方法沿原Store实际生成的UUID＋整数版。实际Ref从原回执读取，不从标题／候选号构造。
稳定节点键逐类确定如下，均以原`project-data-context-io.canonical`规范化元组后加类型前缀／SHA256表示，不能直接把整个Ref对象序列化作业务键：

| 对象 | 稳定身份元组 | 明确排除／限定 |
| --- | --- | --- |
| MetricVersion | sap＋packageId＋version＋metricName | 本粒度metricName必填；publishedHash、标题／正文不参与版本身份 |
| MethodVersion | sap-method＋methodId＋整数version | publishedHash及标题／正文不参与版本身份 |
| SourceRevision（企业修订） | enterprise＋storeId＋materialId＋revisionId | 片段location不另造整份修订节点；片段限定在声明键及原Ref内保留 |
| InputVersion | data-input＋projectId＋datasetId＋inputVersionId | 源路径及校验hash不取代原输入版身份 |
| SourceRevision（M2说明版） | data-description＋projectId＋datasetId＋inputVersionId＋descriptionRevisionId | 不用活动文件、latest或说明正文作准确版身份 |
| MetricConcept（有SAP对应） | metric-concept＋packageId＋metricName | 跨包版本联系同一概念；版本、publishedHash、正文不参与概念键，具体定义／条件归准确版，不从概念键推定版本可互换 |
| MetricConcept（尚未采用） | excerpt-concept＋获准源修订身份＋局部定位 | 文件型摘录用固定输入文件SHA256作为该摘录的内容修订身份；有原Store修订则用其准确业务元组。候选号仅辅助定位，不按标题合并 |
| Statement／Condition／FieldRole | type＋规范化来源身份元组＋局部定位＋claimKind＋内容 | 原Ref有location时在声明限定中保留；publishedHash仍单独校验，不使同一声明因补齐hash而改变身份 |

相同资产业务键下的省略hash、null hash和已知hash只形成一个版本节点。各Ref的校验声明仍保留；有已知hash时核原权威，已知值彼此冲突或与原权威不匹配必须拒绝，不能拆成两个节点、任选一个或覆盖冲突。补齐校验信息不改写历史原Ref。文件型摘录的内容修订hash与原SAP／方法Ref的可空publishedHash是两个不同角色，不能混用。

边ID规范化两端节点键、关系类型、按上述规则得到的来源身份／局部定位及关系语义（含减项或字段角色）；Ref内publishedHash独立校验，不参加边身份。两端／类型相同但来源或关系语义不同仍为不同边。声明重复拒绝、不同来源／性质不因同名覆盖。快照UUID与派生键、原业务ID分开。

- S3最小类型集合为`MetricConcept`、`MetricVersion`、`MethodVersion`、`SourceRevision`、`Statement`、`Condition`、`InputVersion`、`FieldRole`。GMV与数量／折扣等未采用概念可留源声明与未就绪原因，不伪造其正式SAP版；不扩全行业分类。

### 3.2 原生节点与边

| 字段／组 | 类型、必填和空值含义 | 用途与约束 |
| --- | --- | --- |
| node.id／type／content | 非空字符串，必填；type取上述本轮类型 | id为准确派生身份；content为该粒度可核的语义正文，不能混入不具同样准入条件的其他来源正文 |
| node.metadata | 对象，必填；字段按3.3 | 自定义语义仅放metadata。源输入不另提供properties；禁止metadata重复原生id／type／content／valid_from／valid_until，防止S2已证合并有损 |
| edge.id／source／target／type | 非空字符串，必填；两端必须存在；type取本节关系集合 | 每条声明关系独立身份；方向不得由别名或自然语言相似度猜测 |
| edge.metadata | 对象，必填；同3.3，依赖边另有3.4语义 | 权重不用于代表业务可信或真值。原生weight沿默认1，不作首场景判断依据；不靠时间开放窗口代表未知 |

上表是工程写入／完整API的逻辑字段；磁盘仍采用ContextGraph原生JSON，不另造序列化格式：顶层graph_id／nodes／edges／links，节点自定义字段进入properties且原生将content放入其中，边沿原生source_id／target_id及properties。不得把to_dict／from_dict的另一种结构当成同一文件格式。读回时原生附加的同值content副本只作原生保留字段，核与节点正文一致后不计为自定义metadata；不同值或语义字段冲突必须失败，不能静默择一。

### 3.3 来源、性质与条件metadata

| 字段 | 类型／必填／缺省 | 业务含义 |
| --- | --- | --- |
| sourceRefs | 原`SemanticTarget[]`，必填，默认仅允许显式空数组 | S3仅使用现有sap、sap-method、enterprise、data-input、data-description五类；其他类型本轮不接入。准确版本、必要metricName、原hash保持；不新增Ref变体或M2字段 |
| buildSources | `{inputKey:string,locator:string}[]`，必填，可为空 | 定位构建回执里准确hash的获准文件。JSON采用实际RFC6901定位，Markdown采用明确节名；不授予任意文件／原企业附件读取权限。每个节点／边至少有一个sourceRef或buildSource |
| claimKind | 必填字符串：source-projection／engineering-interpretation／synthetic-assumption | 原来源投影、工程解释、合成设定分开；这是派生metadata，不改变M2 provenance枚举，不表示业务确认 |
| conditions／limitations | 必填字符串数组；无额外条目用[] | 保存适用前提、未迁入特例及不支持范围。需独立核查的前提另建Condition，不把要求写成已满足 |
| businessTime | 沿原`SemanticItem.businessTime`的`{text:string,source:string}[]`，必填，未声明用[] | 保留原业务时间说明和来源；未知不回填现在，不把保存／发布时间当业务有效时间 |
| candidateLocator | 可选字符串，无值省略 | 仅材料辅助发现，如原候选C03；不取代SAP／企业修订／M2实际身份 |
| conditionState | 仅Condition必填：stated／required-not-established／unknown／disputed；其他类型省略 | stated只表示来源或样本有声明，不代表已核实企业业务成立；未知及冲突保持独立 |

`sourceRefs`内既有hash允许省略／null时仍沿原合同读取并保留缺失限制，有实际hash则必须核对；不新加全局非空门槛。本轮已发布资产的实际hash均已取得，可直接固定。派生图文件自己的hash始终由构建者从新写字节计算，与业务Ref缺失hash的含义不同。

### 3.4 关系、基数和语义

| 关系 | 方向／基数 | 必要语义 |
| --- | --- | --- |
| version_of | 准确指标版→指标概念，多对一 | 一个指标版只对一个本包概念；不跨定义同名合并 |
| depends_on | 指标版／方法版→准确指标版，多对多 | C04分别连C02、C03，metadata.operandRole分别minuend／subtrahend；方法连所需指标。其他依赖边无operandRole，不推导因果或强制Agent步骤 |
| has_source | 资产版／声明／字段→来源修订，多对多 | 边的sourceRefs／buildSources本身仍需完整，不以连到来源节点代替准入检查 |
| requires | 资产版／方法版→Condition，多对多 | 条件需要与是否成立分开；样本条件不推广为企业规则 |
| maps_to | FieldRole→准确指标版，多对多 | 金额字段与归属／关联字段的roleText必填字符串；C04无直接净额主输入，控制值不映成真实净额来源 |
| describes_input | FieldRole／Statement→InputVersion，多对一或多对多 | 固定实际输入／说明版，不指活动文件或latest；JSON Pointer不代表已执行join／汇总 |
| distinct_from／potential_conflict | 声明或概念→另一声明或概念，可多条 | 保存两端及依据，查询时不冒充自动冲突裁决；反向查找沿原生完整边API，不额外写一条伪造来源的反边 |

所有边都保存自身依据；失效来源对应的边不能因端点还有其他有效依据而继续返回。正文混合来源时拆为声明节点，避免用一条有效来源放行整段失权内容。

## 4. 单一构建与原生保存布局

获准S3隔离根为本工作树`.local/fourbase-l2-s3/sc01s-v0.1/<run-id>/`。现有SAP／M2／企业资料沿原Store布局在该run内生成；不改活动dataRoot。未来运行采用根及导入是S5的独立范围。

新派生布局推荐为`<run>/snapshots/<snapshotId>/graph.json`、`ontology.json`、`receipt.json`。三个文件均是新版本、只由本轮工程构建者写；不覆写旧目录，不加全局current。图走ContextGraph原生文件保存；本体走OntologyEngine结构化候选输出，min_occurrences=1，关闭实体合并／冲突覆盖，S3不启用模型抽取或OWL reasoner。

receipt是本次已确认的新支持结构，字段如下：

| 字段 | 类型与约束 |
| --- | --- |
| formatVersion | 整数1，必填；不认识的版本拒绝 |
| snapshotId／graphId | UUID字符串，必填；两者一致，且与原生graph_id及所选目录一致 |
| builtAt | 构建实际UTC时间ISO字符串，必填；仅工程留存时间 |
| component | 必填`{name:'semantica',version:'0.7.0',wheelSha256:string}`，hash固定S2已核发布物 |
| files | graph／ontology各有`{name,sha256,bytes}`；name仅固定的graph.json／ontology.json，字节数非负整数，hash为实际字节SHA256 |
| inputs | 必填数组，每项`{inputKey,relativePath,sha256,bytes,nature}`；key唯一，relativePath仅本run明确准入inputs区的固定原记录字节副本，拒绝越界、链接及任意路径读取；nature取deidentified-source／synthetic-data／asset-publication／engineering-design |

输入至少包含实际SAP／方法发布身份、企业修订、固定M2输入／说明、获准脱敏摘录及必要工程定义。只读准入清单；原始经营明细、控制答案、参考答案、真实企业附件、凭据不进图。输入文件hash与原准确Ref共同保留，不能用派生checksum替代源身份。 固定输入副本不包含会变化的原Store索引来冒充内容版本；当前enabled／治理等状态另从原权威读取，不以构建时索引hash替代当前资格。

先写新图与本体并回读校验，再独占写构建回执；只有三件齐全且全部校验成功，才向本轮工程读者返回可选用的快照。中断／半写目录保持现场、明确不可装载。receipt不是全局READY状态机，也不授予S4产品查询资格。

## 5. 当前来源、装载失败及兼容

1. **准确版本核对。**输入和查询都显式固定原Ref与快照；错版本／错hash拒绝，不回退latest。原SAP包项目启用只影响既有项目策略，不添加为全局方法或M2 Ref校验的新门槛。
2. **来源有效性。**SAP沿准确library.read及已存在项目策略；SAP无通用撤回状态，不新增它。方法新查询检查原治理，confirmed错误版不作为新默认建议；旧准确版与问题说明仍可取证。企业资料查当前enabled和准确修订；M2除了准确读回，还核其来源当前状态。unsupported／unknown来源不作为完整可用依据。
3. **声明粒度过滤。**一个声明／边的所有必要来源都合格才返回；禁用／失权来源的正文、来源定位和关系均排除。受影响结果可明确“不完整”，但不得静默省略后宣称完整。S3核隔离库真实enabled／治理变化；S4再核真实Host owner／权限即时变化。
4. **加载前校验。**目录／文件必须在获准根、为普通独立文件；三件齐全、格式／UUID／组件／图文件hash／大小／必要源身份都匹配后才新建并装载实例。缺失、JSON损坏、错ID／hash、空的核心资产图或缺必要节点／方向均明确失败，不接受原生MCP summary的ready。
5. **刷新与失败。**新代验证成功后由本次工程调用者显式选用；旧实例不假装已刷新。不把多个进程指同JSON当一致性机制。失败保留旧文件及失败现场，不静默将旧实例作为本次成功，也不自动重放写入。
6. **回退／停用。**显式选择旧快照并重新核当前来源资格；旧历史不会获得已撤回来源的新查询资格。停用派生读口仍沿L1可用原材料继续，不迁移或覆写SAP／M2／报告／Case。无SQL、索引、消息或会话迁移。

S3的“可查读”仅指隔离工程Python完整节点／边API。该私有装载与准入行为不是S4工具参数、分页、模型可见content、取消／迟到合同；S4继续沿原semanticContext port、Pi1.4.0／Interface v3和公共生命周期确定最小适配。

## 6. 首切片与S3验收

本轮按已确认范围，以真实RED→GREEN实施新结构与读口，不把本次现有Store工程核查追记成新装载器的RED。

| 编号 | 必须观察的行为 |
| --- | --- |
| S3A01 | 准确SAP／方法／M2版命中；错版／错hash失败；同一业务键的省略／null／已知hash只有一个节点和对应关系身份，已知hash冲突拒绝；nullable hash保留原语义及限制，不虚构值 |
| S3A02 | 原库禁用来源或方法确认错误后，新声明／边不再用于默认查询；旧准确身份、原文及问题历史保留 |
| S3A03 | 缺文件、损坏、半写、错快照ID／hash、空核心图均失败；先前快照和原权威字节不被失败流程改写 |
| S3A04 | 3核心＋1方法对应实际原发布Ref；背景／范围／时间／条件／字段／来源含义齐全，GMV和数量歧义／条件扩展边界保持 |
| S3A05 | 原生构建→保存→关闭→重开→完整API查读；逐项核内容／metadata、减项方向、平行／相反声明及单例，不只数节点 |
| S3A06 | 六类代表查询、实际输入位置／关联与原回执回源；已知身份查读、邻接、完整动态影响遍历分别报告，不把未执行部分计通过 |
| S3A07 | 必要结构／来源约束在实际图上核正负例。若采用RDF／SHACL，明确从实际图生成的字段映射和目标命中；独立小型RDF探针不算全图验证；不宣称OWL／经营真值推理 |
| S3A08 | 原源修订／撤回→新代重建与显式刷新、失败／回退、旧引用可核；全新非作者与四原则复核后收尾，S4及真实业务闭环不提前 |

## 7. 覆盖与本轮实施范围

13类结构问题均已落位：用途／owner与对象粒度在D12.1；键及字段／空值在D12.2；关系／基数与来源在D12.3；版本、写入口与保存布局在D12.4；读入口／治理在D12.5；刷新、并发、恢复／兼容在D12.6；约束、证据及阶段在D12.7。无额外索引／SQL迁移需求，不另造业务状态机。原Store保留跨源身份，派生ReadModel不写回业务主库。

用户已整体采用7项A，授权完成同一S3范围内的装载保护、来源准入、小本体／带源图及隔离验证。现有SAP／方法／M2资产及原合成资料继续保留。无S4接线、真实模型、运行切换、其他设备或Git发布授权扩展。

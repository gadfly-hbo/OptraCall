# S4 整体接入方案与确认包

v0.1 · 2026-11-05 · D13.1–D13.8全部A已确认 · 尚未实施

关联：[确认摘要](s4-confirmation.html)／[本次准备记录](s4-preparation-result.md)／[原阶段计划](phase-plan.md#s4接入原任务不增加一套工作方式)／[S3验证](s3-validation.md)。D01–D12已确认部分沿用；本包只确认S4新增查询、权限及资源接缝，不重开SAP／M2权威或S3快照结构。

## 1. S4要交付什么

让**原项目任务里的Pi Agent**在需要时取得已建好的业务语义：指标定义和准确版本、字段含义、退款归属、方法适用条件、冲突、未知及依据，再自主决定如何计算、解释和回答。关键口径由Agent在主回答主动解释，业务含义仍是原回答依据里的可选详情；用户照常提问，不增加页面、设置向导或逐次读取审批。

S4的退出结果是“实际合成Host／Pi SDK能安全取得并传递这些内容”，不是Semantica生产上线、真实模型已用得正确或真实Case决策闭环。S5再做获准运行采用／真实分析，S6做实际后续与反馈。完整L2仍包含业务本体、知识组织、规则与来源、变化及经验，不缩成关系／时间索引；S4只接通当前有限资产。

首批内容仍为SC-01S的3核心指标＋1方法、8类对象、54节点／63边及337个字段定位；不新增正式指标、本体类型、RAP假设节点或Case／经验图资产。原RAP、企业背景、SAP、M2及已有分析工具继续供给基础上下文；不把尚未入图的业务背景说成已由图覆盖。

## 2. 已有能力与实际差额

| 现状（本轮静态核实） | S4必须补齐／保持 |
| --- | --- |
| S3准确装载、当前来源筛选及原生完整图API已通过；query目前只支持node_ids，不是产品查询服务 | 补有限业务查询、Host项目准入、模型可见结果、分页、取消与真实SDK接线 |
| 原read_semantic_context已有find／read／trace，content与details同源；record_analysis_sources是另一项原M2写能力 | 复用同一读工具及Host接缝，加明确L2分支；旧三动作和写工具原资格不变 |
| 当前语义工具仅给无workspace／无protectedExecution的普通任务；自动核算开启且支持时，普通任务可能使用managed ordinary | **明确新增普通managed父任务的窄只读能力**；不能要求用户关闭自动核算，也不能整体移除保护guard |
| 原SDK包装有call-local ctx／signal和Host运行归属核验 | 继续核真实run／resource／owner，不凭模型参数、requestId或toolCallId字符串授予权限 |
| 当前Host请求跟踪仅AbortController，取消会abort并clear，异步调用可void启动 | 补同一Resource内的completion／退出收尾跟踪；不能把撤回回包当Python已停止 |
| S3 NativeAuthority用三个原始根、同步subprocess启动Node，30秒是工程限制 | 产品侧改用Host绑定的原Store权威代理；不把工程根目录回调和timeout直接上线 |
| 当前树HEAD57742b9，缺后续SAP方法接缝；固定2b9800bc已有sap-method原合同 | 后续实施先对齐已交付方法接缝并核实际依赖；不重造方法库，不覆盖当前WIP |

本机S3最终候选30件及完成回执已回读一致。S3两代修正版为`5e982ef2-e411-402b-a254-ece186dc6e9e`和`fbaba342-4e0d-41d0-8196-1ee27b34d13c`，每代9输入（7原字节＋2工程投影）；首个S4工程夹具建议由Host固定选择后者，同时用前者核准确回退。它们是本机隔离夹具，不是产品部署目录或全局current。

## 3. Pi如何取得并使用语义

推荐单一路径：

```text
用户在原任务提问
  → 原Pi Agent自主调用read_semantic_context的graph分支
  → 原SDK可信工具包装／Host IPC
  → Host绑定真实project/task/run、只读能力、准确快照与来源范围
  → 一次性、无模型Python查询job：S3装载器＋Semantica完整API
       ↔ 受限Host权威代理：原SAP／方法／企业资料／M2
  → 资格与当前run复核后，把有界语义JSON放进工具content＋同源details
  → 原Pi Agent自主回源、计算和回答；SDK保存实际工具结果
```

例如用户问“这两期零售额变动该怎么看”，Agent可查到C04＝C02−C03、退款按原支付归属、样本截数不等于真实退款成熟、数量歧义不应牵连金额核心，并取得参考方法的四组内容及来源。Agent随后自己选择Python／DuckDB或其他原工具计算，主动说明关键口径与未知。图查询不替Agent计算、选方法或决定经营动作。

这是信息流示例，不是强制调用顺序／次数。Agent也可直接回源或继续普通分析。L1持续提供原资料、索引、上下文和计算入口；有合格结构语义时优先用于理解业务，图不可用时由Agent沿有权原资料继续。**L1兜底不绕过撤回、权限或准确版本要求**；Host不暗中重排分析路线或用latest补空。

### 3.1 为什么选这一条

S2已实际证明原生MCP查询会损失元数据／平行关系、撤回仍返回、损坏或缺失图仍ready；S3已用Python完整API及私有保护补齐有限工程路径。因此S4推荐原Host port薄适配，不再向模型接原生Semantica MCP全工具，也不另建MCP服务器、REST服务、语义Agent或推理循环。Graphiti继续保留条件评估位置，本轮不引入。

每次查询采用有限Python job，每次显式load准确快照并重核图、本体和冻结输入；暂不加常驻helper／缓存一致性协议。Python只运行产品可信查询代码，不运行模型提供的脚本、Cypher、公式或任意方法名，不调用内部LLM／embedding／query_with_reasoning。

## 4. 已确认的整体决策D13

用户已明确回复“整体确认 D13.1–D13.8 的推荐 A”。以下8项均采用A，**用户决定A、一致性为一致、状态已确认，实施未开始**。B保留为送审时的替代及影响，不表示用户采用；未变D12沿用。获批原文与身份保全见本次准备根/evidence/approval-20261105T094825Z，当前登记不启动开发。

| 编号 | A推荐／理由 | B替代及影响 | 用户决定／状态 |
| --- | --- | --- | --- |
| D13.1 入口与可用任务 | 同一read_semantic_context增加graph分支；普通unmanaged及managed ordinary父任务均接Host窄只读能力。managed只新增graph，不顺带开放旧个人／Case等目录动作；覆盖真实普通任务，新增必做0 | 先仅unmanaged；可缩小实施，但部分开启自动核算的普通任务无L2，S4只能记部分完成，不要求人关闭功能补齐 | A／一致／已确认；未实施 |
| D13.2 有限查询和模型结果 | 第5节6类只读操作、完整语义／来源进入content；独立type＋schemaVersion1结果，不破坏旧三动作。业务含义可取得且可继续回源 | 只返回原文目录／摘要；可保留L1，但不能验收S4业务语义查询；或另开全部MCP会扩大权限，不推荐 | A／一致／已确认；未实施 |
| D13.3 权限与源范围 | 第6节Host当前owner／源策略唯一授权；查询前后及续页复核，先过滤再检索／计数／遍历；五类源Ref，派生ID不冒充业务Ref | 只按图内标签或构建时enabled筛选，无法处理当前失权，不作为合格接入 | A／一致／已确认；未实施 |
| D13.4 进程与生命周期 | 第7节一次性可信Python job＋Host原权威代理；扩展现有Resource请求跟踪并等待实际退出。兼容Interface v3，无第二busy／代际台账 | 常驻服务／多层MCP增加缓存／owner／刷新合同；或只abort回包不能证明收尾，均需额外理由与验证 | A／一致／已确认；未实施 |
| D13.5 版本、分页和失败 | 第8节run内固定准确快照，续页绑定同查询／来源资格；原始语义分页不截JSON，失败不选latest，不自动切旧实例；Agent可沿合格L1继续 | 每次自动追最新或静默回退易混版、掩盖损坏；不采用 | A／一致／已确认；未实施 |
| D13.6 记录、UI和兼容 | 第9节用SDK实际工具记录留当次结果；原M2／Case权威及写权限不扩，原依据可选查看。无新业务库／页面／人工发布流程 | 独立业务含义页／引用库／子Agent工具扩权增加流程与迁移；本轮不做 | A／一致／已确认；未实施 |
| D13.7 实施与验证范围 | 第10节分4个工程切片，真实合成Host／Pi SDK、两普通模式、权限／取消／故障及兼容、非作者双轴和四原则后才完成S4；真实模型／上线留S5 | 只测Python或mock callback不能证明接线；直接真实上线越过当前权限，不采用 | A／一致／已确认；未实施 |
| D13.8 基线与执行边界 | 第11节保全当前WIP，复用2b方法合同、Pi1.4.0／Interface v3／Semantica0.7.0；届时按获准隔离候选准备必要工程依赖。当前只确认方案、尚未开工 | 现在修改代码／安装／运行、更新服务或从别树整包覆盖，违反本次“暂不开发” | A／一致／已确认；未实施 |

## 5. 查询接口及返回合同（推荐A）

### 5.1 单一模型工具的增量

沿`read_semantic_context`增加`action:'graph'`，对原已可用的unmanaged任务，find／read／trace参数／结果语义保持；record仍属于原另一工具，不因本包成为只读能力的一部分。Host注入的窄读facet（拟名SemanticContextReadPort）按真实模式限制：unmanaged沿原三个读动作加graph；**managed ordinary只新增graph分支**，source操作提供获准五类源片段，不顺带开放此前没有的个人／Case目录等旧动作。两种模式使用同名工具，但可用参数schema由Host能力决定，Host再次拒绝伪造动作；不把完整含record的port交给managed任务。无新会话域／profile，仍为project-tasks、真实projectId＋taskId和当前operation。

同一工具的说明随获准能力明确列出graph操作、当前有限资产范围、条件／未知和回源方式，作为Agent发现能力的提示；不注入整张图，不强制先查图、不固定方法／调用顺序／次数。managed说明和schema只列本模式获准的graph分支。

graph分支参数严格拒绝未列字段。字段是本次已确认、尚未实现的传输合同，不是新增持久业务schema：

| 字段 | 类型／缺省／范围 | 含义 |
| --- | --- | --- |
| action | 必填，固定graph | 与旧三个动作区分，不借find改变旧语义 |
| operation | 必填，find／definition／neighbors／dependencies／impact／source | 有限读操作，下表定义 |
| query | 仅find；必填字符串1–200字符，无NUL | 匹配当前有权语义正文及可见字段；首批确定性词匹配，不承诺自然语言GraphRAG |
| nodeId | definition／neighbors／dependencies／impact必填非空字符串，≤256字符 | 本run准确快照内的派生节点ID；按原id校验，不用C02候选号或同名字符串替代 |
| nodeTypes | 仅find可选；8类D12节点类型的无重复子集 | 不传表示本获准图内全部类型，不扩大来源权限 |
| relationTypes／direction | 仅neighbors可选；D12关系无重复子集；direction为out／in／both，缺省both | 只改变一跳读取范围；不生成伪反边 |
| depth | 仅dependencies／impact可选整数1–4，缺省2 | 资源／遍历范围，不表示业务推理已穷尽；到界显式标不完整 |
| sourceHandle | 仅source必填；Host返回的本run不透明句柄，≤4096字符 | 绑定原Ref或已准入buildSource的有限片段，不接受原路径；句柄无持久业务身份 |
| pageSize | 可选整数1–100，缺省20 | 节点或关系等完整返回单元上限，同时受字节限制 |
| continuation | 可选非空不透明字符串≤4096或null，缺省null | 绑定同owner／run／快照／规范查询／资格视图；其余查询参数续页保持一致 |

不接受model传projectId、taskId、snapshot路径／任意快照选择、dataRoot、projectsRoot、sourceRoot、sessionFile、Provider／凭据、operation资格或任意查询代码。`recordedBefore`仅保留旧L1动作的原含义，graph分支不接收asOf，不把builtAt／业务时间文本变成完整时态查询。

| operation | 返回的业务信息／明确边界 |
| --- | --- |
| find | 概念、准确指标／方法版、字段含义、条件／冲突声明的有源命中；query去首尾空白后按Unicode小写，在获准节点content及candidateLocator做单词组子串匹配，不分词／猜同义词；结果按node.id稳定排序，无命中只代表本范围未命中 |
| definition | 节点定义、准确资产版、claimKind、条件状态、范围、限制、时间及全部必要来源；不只回标题／ID |
| neighbors | 一跳原关系及可核两端，保留平行边独立ID、方向、性质、operandRole、roleText和每边依据 |
| dependencies | depends_on正向有界遍历；保持C04两操作数与方法三核心依赖，不执行公式或推定因果 |
| impact | 仅maps_to正向＋depends_on反向的已批准有限视图；报告实际深度／未遍历边界，不宣称任意图完整路径枚举 |
| source | 从Host返回的来源句柄读有权原片段及其准确Ref／定位／性质；SAP／方法沿原发布版，企业沿准确修订，M2仅输入身份、字段和说明语义 |

source不得经冻结inputs返回交易行、synthetic_net_controls、参考答案、原企业附件、凭据或绝对磁盘根；需要经营数据时仍沿原获准文件／分析工具。冻结字节供可信装载校验，不等于可以把整个inputs文件给模型。source中的工程投影不得冒充企业确认。

### 5.2 模型可见结果

新分支返回独立`type:'optracall.semantic-graph-result'`、`schemaVersion:1`；工具content放该有界完整JSON，details放同源对象，关键限制不得只存details。原L1结果仍用原type／schema，不用新图格式覆盖旧历史。

| 字段组 | 推荐合同 |
| --- | --- |
| 查询身份 | action=graph、operation；Host绑定快照的snapshotId／图及本体hash／组件版本，未知或无资格时不泄露未准入身份。只标派生身份，不取代原Ref |
| state | 沿SemanticSourceState已有枚举；available不是无缺口或业务已确认，必须同时读coverage／gaps |
| nodes／edges | 对应操作的有界数组，无结果用[]；nodes沿D12的id／type／content／metadata，edges沿id／source／target／type／metadata，保留两端准确ID、每边来源及关系语义。无关原生properties／文件路径不直接dump |
| paths | 仅dependencies／impact使用，否则[]；每项为`{nodeIds:string[],steps:{edgeId:string,direction:'forward'\|'reverse'}[]}`。nodeIds按遍历顺序，至少2项；steps长度＝nodeIds长度−1。每步edgeId须命中本页edges；forward须符合原边source→target，reverse须符合原边target→source；相邻端点必须与nodeIds一致 |
| 来源与性质 | 原5类sourceRefs及其原optional／null publishedHash；buildSources仅输出inputKey／locator／输入hash与nature等非敏感定位；每项提供当次sourceHandle以继续获准片段 |
| 条件与时间 | claimKind、conditions、limitations、businessTime、conditionState完整传递；stated不等于已核实，required-not-established／unknown／disputed保持原义。builtAt只是工程留存时间 |
| 原文片段 | source的正文及range采用原L1有界UTF-16字符坐标，不切开代理对；用continuation接续。不以模型摘要替换原文，超大语义正文按准确片段继续取 |
| coverage／gaps | complete、continuation（无用null）、gaps数组；遍历另明depthLimit／depthReached及是否穷尽本范围。complete只说明本次范围／分页完整性，不证明经营真值、源hash均非空或全企业覆盖 |
| 失败 | 有界code及可理解缺口，沿原工具错误承载方式；未配置／损坏／超限／取消／资格变化不返回空图ready。隐藏来源正文／定位／精确排除数量／分数不回传 |

分页／片段保留源、性质与关键限制，不能把一条关系的减项角色、依据或相反声明静默省掉。一个完整结构单元仍超限时明确too-large并给可获准回源／片段续取，不能截断JSON或假装完整。

路径按nodeIds及有序edgeId／direction序列区分：即使节点序列相同，平行边依据不同也不能合并；同一来源相同路径才可去重。dependencies每步只能正向depends_on；impact每步只能正向maps_to或反向depends_on，不创造新边／新因果。返回路径所需的原边、两端节点和关键来源在同页可核；作为完整路径单元分页，放不下则明确too-large／范围不完整，不能拆掉步骤或省掉某条平行路径后报完整。nodes与edges按id排序，paths按有序节点／边／方向键排序；在相同快照、查询和资格视图下续页顺序稳定。该排序不代表可信度或业务优先级。

## 6. 权限与源准入（推荐A）

1. **真实owner。**Host从现有Resource与实际run捕获project/task、session、当前request、call-local ctx和signal；派发前、异步权威读取后、最终回包前、续页均核assertCurrent。复用真实当前资格，不从JSON、图标签或客户端路径构造SessionRef／执行资格。
2. **模式。**仅普通项目父任务的unmanaged及managed ordinary。managed分支须显式加入一个可信只读工具包装，且只接受graph；伪造旧find／read／trace、record或其他动作均拒绝，不放开整个personal tools bundle、MCP、skills／扩展执行，也不改变ProtectedExecutionScope文件根。protected、fixed-draft、text-only、独立核算／修订、需求等专用workspace维持排除。沿原始与间接／伪造IPC两条路径验证，不能只隐藏工具名。
3. **原源政策。**SAP核原项目启用的准确包版及原读策略；方法沿原已发布准确版／治理政策及本场景获准范围，不凭空加全局“方法必须项目启用”门槛。企业核本次有权来源范围、当前enabled及准确修订；M2只读本owner项目内准入的准确输入／说明，继续核其引用来源资格。首夹具的项目启用／准确选择由工程沿原入口准备，不成为用户每次提问步骤。
4. **新建议与历史读取分开。**confirmed错误方法不进入新L2供给；原历史准确版和警告仍按原合同可核。合法省略／null hash保留missing-hash限制，已知值必须核，空字符串等非法值拒绝；不补造hash或设新全局非空门槛。
5. **先资格后检索。**Host权限与每节点／边全部必要来源合格后，才做匹配、评分、计数、分页和构造遍历视图。过滤失格端点及边，正文／sourceHandle／路径／隐藏总数均不泄漏。回包前资格变化则丢弃过期结果并报scope-changed，不把先前校验缓存为长期权限。
6. **buildSource。**只读Host明确绑定的快照／inputs清单及有权语义片段；存在文件或hash匹配不授予新数据访问。原SAP／企业／M2保持权威，Python不能扫描原projectsRoot、读取凭据或遍历其他业务根。
7. **父子。**本轮不把语义工具加入subagent角色继承。父Agent可在原授权内把有限查询内容随子任务文字交付，但这不是子Agent自行调用或获得新权限；缺少嵌套子正文／回执的历史仍UNKNOWN。

本包约束的是新增语义接口及可信查询job，不宣称给既有普通bash／Python等所有工具建立了全系统敏感数据沙箱，也不以此改写原工具安全合同。第一轮始终仅用脱敏资料与合成数据。

## 7. 进程、并发与公共生命周期（推荐A）

Host的可信TS适配器持原Store和当前owner权威。Python job只获得本次固定快照／必要冻结输入的只读路径白名单或等价只读句柄，字段不传给模型／通用不可信执行worker；authority改为受限IPC请求Host核原准确Ref／准入片段。仅允许本次快照声明的五类来源及获准范围，任意Ref、路径、调用名、写动作拒绝。S3 NativeAuthority及其Node扫描／init逻辑保留工程用途，不进入产品查询链。

不是“直接spawn后监听一次Abort”。扩展**原ProjectAgent Resource中的现有查询跟踪**，记录当前请求的完成与cleanup直到真实reaped；现有drain／stop／close在原公共占用内等待匹配查询收尾。普通start没有可直接拿来用的业务lease.onCancel，须把这项差额落实到原Resource适配，不另建业务busy／generation／opening Map或全局队列。

- 正常完成回包后收尾，resource的drain也覆盖尚未结束的查询job；查询可以并行，复用原工具并发与owner隔离，不额外设固定查询配额／分析步骤。
- 取消、配置关闭或结束：先撤派发／回包资格，再停止匹配Python job及其真实子树并等待退出；不等无关owner。生产查询不启动工程Node桥，仍用故意派生子进程的合成反例核收尾。
- 清理失败保留同owner隔离／busy及UNKNOWN，不能先idle或用finally自动重放。沿原显式close／retryFailed只重试失败清理，不重试分析／查询写动作。
- 迟到响应可补技术事实，不能进新run的模型content、复活旧cursor或触发下一轮派发；新会话重开不复用旧能力句柄。

Interface继续v3，原session／配置／SDK管理唯一权威。必要内部可选类型是该资源的读查询能力与收尾句柄，不新增持久会话ID／代际／运行库。若实施证明必须改变公共接口语义或扩大专用profile，先补受影响决定，不把方案中的“推荐”当现成能力。

## 8. 版本、资源与失败（推荐A）

- **固定快照。**Host在本run首次L2查询时捕获已验证的准确快照和文件hash，后续查询／分页固定它；新代给后续新run选用。图写入／发布／重建仍走原获准维护路径，Agent无写图工具。原源资格每次仍实时核，旧快照不豁免撤回。
- **工程版本选择。**首夹具显式绑定修正版第二代；第一代用于准确回退验证。后续部署的绑定和位置由S5明确，不加全局current、不让模型任意选磁盘文件。运行中图被损坏／移走／输入漂移则明确失败，不静默选另一代或缓存旧view。
- **续页。**Host不透明cursor／sourceHandle绑定现有Resource／run、snapshot、规范查询和当前源资格视图；不持久化为业务ID。资格、配置、run、图身份变化即失效，重新查询。只用无授权作用的Base64 JSON不能当资格证明，不新建独立会话／权限台账。
- **输出。**L2单次完整模型content JSON≤24KiB UTF-8，details同源；仍服从现有32,768字符content及256KiB IPC上限，任一超限即分页／明确错误。条数上限与字节双约束，端点身份和关键来源不可因凑条数被去掉。
- **有界处理。**find只做本合格有限图的确定性匹配；neighbors一跳；dependencies／impact深度≤4、单次最多处理200个合格节点／500条合格边，达到边界返回范围不完整及可继续的有权入口，不宣称已完整推理。现图54／63在边界内。常驻缓存／embedding／任意as-of不在本轮。
- **失败继续。**组件未配置、坏快照、来源失效、空命中、局部缺口、超限分别说明；可完成的原L1／计算继续可用，Agent自主选择。缺少必要定义／数据则只停止受影响判断，权限禁止不能借L1回源绕开。Host不硬拼回答、自动冲突裁决或隐藏失败。

资源值是本次已确认、尚未实施的S4有限合同，不把S3的30秒工程timeout升格为Agent分析时限；实现使用原任务预算与取消政策，不新增隐藏模型回合或每次查询审批。

## 9. 保存、可选依据与兼容（推荐A）

SDK原生会话保存当次实际工具参数、content及details，作为“当次交付”的事实；准确原sourceRefs／snapshot同时留在这份真实结果中。模型引用声明、报告正确采用和专业正确性分别判断，不因成功回包就打“已正确采用”。没有新查询流水业务库、引用权威或持久句柄表。

原read／find／trace返回与旧native不回填、不迁移；旧结果／旧报告固定原身份，打开详情不发模型、不计算、不重写历史。重开之后如需“查看现在”，沿原可选动作重新查询且明确新快照／当前资格，不能用新图补造旧工具调用。GET历史／详情不得因新接线启动Python查询job。

UI只复用原回答旁可选依据及原SDK工具记录。原semantic-context-history／依据投影目前只认旧结果type，**S4须增加新type的必要内容／状态投影**，保留旧type分支及UNKNOWN，不增导航、独立业务含义页或后台管理页。本包的HTML是方案确认摘要，**不是产品UI Demo**。如实施发现必须实质调整布局／交互，再先提交该差额Demo；正常新增必做操作仍为0。

`record_analysis_sources`及M2引用／Case保存继续原合同：新派生nodeId／sourceHandle不直接写成SemanticTarget，不给managed任务增M2写权限；Agent若需原有保存行为，沿原入口与原能力。原独立核算／fixed-draft／需求、子Agent／MCP、M4/M5/M6均不自动扩权。

## 10. 实施切片与验证安排（批准开工后执行）

| 切片 | 建设与真实路径 | 退出证据 |
| --- | --- | --- |
| S4.1 权限及生命周期骨架 | Host窄读能力、原Resource查询完成／退出跟踪、受限权威IPC与一次性job；先做错误资格／取消／清理失败RED | owner不可伪造、两普通模式资格明确、实际退出前不idle；禁止profile不放开；无新Runtime |
| S4.2 语义查询与有界结果 | 同一工具graph分支、6操作、当前源过滤、准确版、content／分页／scope-bound cursor；复用S3真实图与原Store | 六类业务问题、平行边／操作数／三方法依赖／条件与原字节来源不丢；原生Semantica与真实Host权威路径可核 |
| S4.3 原Pi两普通模式闭环 | 合成HTTP→公共project-tasks→实际Pi1.4.0 SDK→graph工具→Host→Python→Host原Store→模型可见content→同任务答复→native保存／重开 | 合成Provider记录实际看到的结果及下一轮输入，原任务计算／回答可继续；无需关闭自动核算，无真实Provider费用或业务动作 |
| S4.4 回归与集中复核 | 适用完整工程检查、原消费者、权限中途变化／关闭／故障／恢复、可选依据兼容，全新非作者双轴及四原则 | 固定候选与身份、原FAIL／UNKNOWN／NOT_RUN保留，必须修复项闭合；S4范围完成但S5／S6未冒充 |

### 10.1 验收清单

| 编号 | 必须观察的结果／反例 |
| --- | --- |
| S4A01 内容可见 | 两种普通父任务在实际SDK路径取得定义／方法／字段／条件／来源的content，非仅details／目录命中；关键unknown／性质随内容进入下一轮模型请求 |
| S4A02 查询保真 | find／definition／neighbors／dependencies／impact／source逐一核；六类SC-01S题面、减项方向、方法完整依赖、平行／相反声明、337位置及未采用候选边界均保持；impact深度4核两条既有预期链，深度2明确未穷尽；平行边路径的edgeId／方向／邻接端点及来源不丢 |
| S4A03 越权拒绝 | 跨project/task、旧session/run、伪toolCallId／ctx／handle、未知字段／根路径／任意代码拒绝；managed伪造旧目录动作／record拒绝；原protected／fixed-draft／text-only／workspace及子角色工具缺失与间接调用均拒绝 |
| S4A04 当前源变化 | 查询前及在途禁用／恢复、confirmed方法错误、hash冲突、nullable hash、M2来源失效；结果和原文都过滤，隐藏内容不参与计数／排序／路径或进入日志／模型 |
| S4A05 在途取消 | 真正启动Python及合成后代，取消／配置变化／close后匹配子树实际退出；迟到不入新run、不提前idle、不影响无关owner |
| S4A06 清理失败 | 故意停止失败／异常退出保留UNKNOWN和原owner隔离；显式重试仅失败清理；无静默模型切换、写入重放或自动恢复派发 |
| S4A07 准确快照与分页 | 源修订新代不改变本run已固定身份；新run取已明确选择的新代，旧引用可核；续页跨run／查询／资格／快照拒绝，超大Unicode正文／metadata不截断JSON或丢关键语义 |
| S4A08 加载与故障继续 | 缺依赖／文件／错UUID／hash／半写／漂移均非ready；原L1和可完成的分析继续；必要资料失读仅限制依赖判断；撤权不经回源绕开 |
| S4A09 保存及被动查看 | 原SDK保存／重开核真实结果，旧历史／报告不改；GET及展开依据无模型／Python副作用，缺嵌套记录继续UNKNOWN |
| S4A10 兼容与入口约束 | L1 find/read/trace、原record资格、SAP项目启用／方法发布、M2／M4／M5／M6、需求／核算／修订、子Agent及第三合成消费者受影响接缝回归；会话导入门禁／全应用适用check不跳过 |
| S4A11 四原则与复核 | 实际代码／调用链证明Host不补计算、不选方法、不另建循环／台账；正常新增必做0；两位全新非作者及专项复核，不以作者测试代替 |

确定性增量先真实行为RED后最小GREEN；fixture／依赖导入错误单列，不冒充产品RED。只读规划检查不是上述验收已经执行。S3的45项和历史复核不能充当S4接线PASS。

### 10.2 工程证明与真实模型效果分开

S4的合成Provider用于观察真实SDK工具回合、模型输入content、取消及保存，不证明真实LLM自主正确选用／解释业务语义。真实Provider、模型配置／费用、同源L1/L2专业对照、初始化／维护／查询成本及准确率／耗时结论留S5获准后执行；真实经营V404、反馈V405及持续治理V406分别取证，不预写更快更准。

## 11. 开工边界、结构完整性与当前状态

本轮工作树`codex/four-base-L2@57742b99d173bfa6413e83705682b0444359add4`保持；后续方法源固定2b9800bc已读Git对象。正式实施前在获准隔离候选中核对届时main与当前全部WIP、实际Pi锁定1.4.0／Interface v3及Semantica0.7.0，按最小差额接原方法模块；不整包覆盖、reset／clean／stash或清理历史证据。若公共语义／权限或实际依赖出现实质新差额，补受影响确认，不把基线漂移隐藏成普通升级。

S4可能修改的范围：原semantic-context类型／reader及工具schema、Host语义服务／port及查询job适配、project-session／project-runtime／server的窄只读注入和同Resource收尾、私有S3可复用模块的必要适配、对应测试及原可选依据type投影。公共会话实现只在已证实必要时最小修改并回归第三消费者；不改原业务权威schema／持久布局或Agent分析流程。

后续获准工程验证需要完整适用TypeScript依赖及检查；S3旧检查器因缺typescript退出的原事实保留，S4不得沿用“私有Python范围”免除TS接线检查。必要依赖只在获准隔离候选／run准备，不改全局配置；不默认安装Semantica全量extras、图数据库、embedding、Graphiti或额外LLM。

| 结构检查类别 | 本包落点／不适用说明 |
| --- | --- |
| 用途／owner、对象／粒度 | §1／3／5／6；原父任务只读语义查询，原业务权威不变 |
| 键／连接与字段空值 | §5：派生ID／原Ref／临时句柄分开；enum、必填、缺省及null；不造新业务ID |
| 关系／基数与生命周期 | D12关系不改；§5／7／8明确方向、范围、run捕获、续页及收尾 |
| 来源／刷新／维护 | §6／8；原Store实时资格与不可变准确快照各负其责 |
| 读写／约束／审计 | §5–10；只读工具／原记录、原M2写权限分开，实际native证据不造历史 |
| 迁移／兼容／回退 | §8／9；不迁移／覆写原数据，新类型兼容旧记录；关闭新capability后保留L1，实际清理成功才可退出 |
| 索引／SQL／跨库 | 无新SQL表／索引或跨库主键；新增只读传输合同／资源支撑，不新增事实库 |
| 阶段与权限 | §10／11；方案审阅、S4隔离实施、S5采用及S6业务反馈分别授权／验收 |

**D13.1–D13.8已由用户整体确认A；本次只登记方案确认，尚未启动开发。**本轮不改产品源码、测试、依赖或新结构，不安装／导入／执行SDK或Semantica、不建图／接线、不启动服务／模型、不读原企业附件／真实经营根／凭据、不操作其他设备、不做Git写入／CI。后续按用户明确的开工范围实施S4；本包不自动授权S5运行切换、真实Provider或真实资料。

## 12. 静态依据与准备验证

| 实际证据 | 对应事实 |
| --- | --- |
| [project-session.ts](../../../src/agent/project-session.ts) L317、[server.ts](../../../src/host/server.ts) L142、[project-runtime.ts](../../../src/agent/project-runtime.ts) L75 | 当前只读语义入口资格、managed ordinary缺口及Host注入分支 |
| [semantic-context.ts](../../../src/agent/semantic-context.ts) L12、[semantic-context-port.ts](../../../src/host/semantic-context-port.ts) L19 | 原port context／动作、模型content＋details |
| [project-runtime.ts](../../../src/agent/project-runtime.ts) L44、[agent-sessions.ts](../../../src/host/agent-sessions.ts) L259 | 现请求跟踪与公共Resource drain／stop／close；不是新增job已可取消 |
| [S3 readmodel](../../../scripts/fourbase_l2/readmodel.py) L110、[工程authority](../../../scripts/fourbase_l2/authority.py) L12 | 私有图API实际范围与工程Node桥不适合直接作产品权限 |
| [历史投影](../../../src/host/ui/semantic-context-history.ts) L11、[原依据](../../../src/host/ui/SemanticContextPanel.tsx) L74 | 当次实际记录、UNKNOWN、可选查看 |
| [统一会话说明](../../../docs/agent-session-integration.md)、[工程IN01–IN07](../../../docs/engineering-workflow.md) | Pi1.4.0／Interface v3、owner、Host与Agent职责及取消／兼容规则 |

行号是本次静态读源码的位置，固定2b方法能力另以Git对象核；代码存在不代表S4实现／运行通过。本轮只做文档一致性、引用／HTML静态与全新非作者方案复核，实际记录见[准备结果](s4-preparation-result.md)。D13.1–D13.8全部A已确认；当前停在方案已确认、尚未实施。

# M3.1 完整最小决定包

2026-11-03 · v0.1 · **6组推荐A，均待用户整体确认；不是已实施schema。**

已接受的三层方向与“优先Pi官方”不重问。本包只决定原生候选及最小人的控制合同；依赖顺序 D01→D02→D03／D04→D05→D06。依据：[spec](spec.md)、[复用证据](reuse-audit.md)、M3既有严格schema1；产品开工前须同时确认[UI](ui-review.md)。

## D01：正文权威与对象粒度

**推荐A：候选正文只存原Pi工具结果 details，个人页为只读投影；人的控制另存引用事件。** 一次 Agent 主动候选工具调用的成功结果代表一个候选 occurrence；它是知识或经验的声明，不是已确认事实。原因：Pi已负责工具结果、会话树、持久历史、恢复和压缩，无须为自动候选新建Enterprise正文、候选Store、后台摘要／RPC。`appendEntry`也是官方现成原语，但本包不同时使用两种正文表示。

**替代B：先将候选复制到Enterprise并建候选sidecar。** 好处是原生文件丢失后仍有副本；代价是双正文、跨文件操作、Enterprise新建幂等和回退面，当前没有该备份需求证据，不推荐。没有把B所需固定ID创建接缝夹带进A。

逻辑关系：一个项目有多个原任务／原生session，一个session可产生多条候选；一个occurrence可被fork复制到多处定位，但仍是同一候选。每条候选可有多个精确业务来源，来源可被多条候选引用；引用不拥有原资料，排除／收藏均不删除来源。人的控制属个人资料环境，不拥有SDK会话生命周期。M3人工笔记与保留沿旧Enterprise／决定权威，不迁移为候选。

## D02：字段、来源与身份

**推荐A：固定小型版本化envelope，运行身份由真实Host／SDK接线绑定；资料来源沿M3读取。** 原因：Agent能自主给内容，但不能在参数中自称用户已确认或冒认另一个任务。**替代B：自由Markdown/frontmatter解析。** 灵活但归属／版本／状态隐含，错误易被当成有效元数据，不推荐。

| 逻辑字段组 | 类型、必填／空值／默认与含义（均为拟定合同） |
| --- | --- |
| native envelope | `schemaVersion:1`、`type:'optracall.agent-candidate'`、`claim:'agent-generated-unconfirmed'`，均必填固定值，由适配器写入；严格拒绝未知字段／版本，不自动转成正式知识。 |
| origin | 必填 `{projectId,taskId,sessionId,requestId,toolCallId}`非空字符串，沿当前真实项目任务／SDKsession／原run／SDK工具调用；模型参数不能提交这组字段。时间 `createdAt` 为工具执行时可信代码生成的ISO UTC字符串，不是业务生效时间。 |
| content | 必填`kind:'knowledge'|'experience'`、`title`非空≤120 UTF-16、`bodyMd`非空≤20,000 UTF-16。`aliases`默认空数组，最多10个非空字符串，各≤100；`scope`、`caution`必填`string|null`，非空时各≤2,000；null表示未知／未说明而非全局适用／无风险。不得把category、enabled当候选／事实状态。 |
| sourceRefs | 默认空数组，最多8条，复用M3四类精确业务来源与UTF-16半开片段；不接受任意路径。可以只保留原生生成依据，此时“业务依据尚未补充”明确显示；它不变成无来源的已证实结论。格式合规不等于原源存在／真实，Host读时沿原权威分别标可读／变化／缺失／无权限／UNKNOWN。 |
| 精确ref | 投影生成：`projectId/taskId/originSessionId/entryId/toolCallId`为稳定occurrence键；原`entryId`在实际落盘后读取，`expectedDetailsSha256`绑定完整候选details，实际viewer `sessionId/entryId`仅为当前定位。SHA由Host按固定规范JSON字段排序／UTF-8计算，不是Agent身份认证、也不是正文语义去重键。 |

校验源归属时核真实Project／Task、核定session历史及原native run，绝不凭payload中的owner成立；无法核原始session／entry、复制体内容冲突或hash变化时UNKNOWN，不挑同名最新记录替代。额外`native-reply`仍要求真实assistant全文SHA，不伪造尚未写出的当前回复ID；候选工具条目使用专属类型受限精确读口，不能冒充已有文本回复。这里复用的是M3来源身份／全文hash合同，**不是直接复用其含`SessionManager.open`的旧读实现**：M3.1所触及的所有native来源都须经D04只读guard／inMemory，共享适配的旧M3消费者也做保全回归，不让读额外回复时迁移其它旧JSONL。

## D03：Agent写入、profile与完成语义

**推荐A：仅当前普通unmanaged项目任务，同一prompt、同一Pi customTools；默认发现要求原请求技术completed。** 原因：无需额外模型／会话，且不以新记忆功能放宽已确认保护边界。**替代B：本轮同时扩展受管／核算等profile。** 须新增安全委派及权限验证，尚无证据，不推荐。

工具参数只含D02的内容和声明式来源；execute在原run有效、原session匹配、未取消时同步捕获origin，调用前／返回前校验取消信号；不写人的账、不调用管理端口、不执行动态代码、不派发下一轮。返回简短“候选已生成，原生保存状态待回读”及details，由SDK唯一落native；不在callback里另append候选或强写fsync。来源读取失败不由Host补写事实，错误交同一Agent处理。

| 情况 | 发现／保全规则 |
| --- | --- |
| 原生成功toolResult可回读且原run精确`settled:completed` | 所属活动分支内可默认发现；只代表技术完成和Agent声明。 |
| 正在运行／尚未settled | 不默认发现，历史区显示“任务未结束／待核对”，不能提前声称正常候选已完成。 |
| 原run取消／技术failed、或工具isError | 留原生历史，历史区显示真实终态／错误，不默认发现。技术完成任务对经营失败的教训不受此限制。 |
| 进程中断／回执缺失／版本损坏 | 保留UNKNOWN，只有精确回读确认原事实才改变投影，不重放模型。 |
| 停止后的迟到结果 | 原生实际记录保留，不能复活正常发现或触发新派发；不能仅凭SDK工具成功认定其未被取消。 |

受管ordinary／protected、fixed-draft、text-only／冷读不注入候选工具；历史查看不创建runtime。普通任务不开敏感隔离，哈希和Host绑定参数不宣称能防止所有外部进程篡改native。容量约束是单次载荷和读取资源边界，不是每任务记忆条数或内部方法配额。

## D04：跨任务个人查找、分支与只读合同

**推荐A：复用官方会话树／branch投影，只在用户查个人资料时汇总；不新建持久候选索引。** 原因：现阶段未证明需另一检索服务。**替代B：候选落独立索引并周期同步。** 增加失效／归档／双权威治理，留真实性能缺口后再评估。

默认来自读取时已保存的各真实任务canonical指针所对应文件的完整磁盘快照，由SDK恢复出的分支；运行中及未持久化导航的实时性未知，读取页不启动或接管会话。历史视图显式包含旧session／非快照分支及取消／UNKNOWN，逐条标明；历史不当当前上下文。fork复制按原origin键去技术重复，核原始同task历史／entry/hash及真实run；复制不会重算createdAt、绕过人的排除或变成另一次学习。新toolCallId的候选是新occurrence，不按语义自动合并。明确收藏的非快照分支候选仍在“重点收藏”显示并标历史；收藏不重新激活分支。

先只读校验非空UTF-8 JSONL/header/version3、逐行JSON合法及尾部完整性；再核候选关联所需entry形状、ID唯一、parent引用存在、无环及有界遍历，异常明确UNKNOWN，不交给SDK猜空或陷入parent循环。通过后才调用公开`parseSessionEntries`与`SessionManager.inMemory(cwd, undefined, entries)`，复用SDK的`getBranch/getEntries`。官方parser会忽略坏行／重复ID索引会覆盖，`getBranch`也不自行防环，因此前置完整性guard不可省；它只核完整性，不另做树／恢复引擎。不得以`SessionManager.open`读取未知／空旧文件触发迁移。未知旧版本保持原字节并显示不支持；不为新候选重写旧native。

已在本次浏览核对过的引用或人的账内引用可在失读后显示UNKNOWN及人的旧操作；不从缓存payload补正文／类别／时间／额外来源。首次读取或重启若只知道某文件不可用而无精确ref，只报文件级UNKNOWN／部分结果，不能猜候选数、身份或恢复未留引用的候选。Demo的失读控制演示的是先加载虚构记录后失读，不能当成无副本时的候选恢复保证。

用户查询页大小默认50、最多100；一次读取至多20个session文件／合计50MiB，单文件超限单列不可读，余项返回可继续的游标／部分状态；缺失或损坏不伪装成0结果。关键词默认标题／别名／scope，全文为显式选项；无embedding／中文分词／语义召回主张。排序按原生成时间与稳定键，不以收藏数或频次晋升正确性。源可见与允许跨项目使用分开，本期只展示用户当前有权回读的项目记录；M4再接实际Agent提供／引用。

## D05：重点收藏、纠正、排除与人的治理账

**推荐A：人的事件只引用精确原生候选；收藏是关注，纠正是独立注记，排除只针对本条及其分支副本。** 原因：避免手工维护、避免改Agent原文，也不把同一数据源所有未来新知识一并封禁。**替代B：收藏复制正文、纠正覆盖原稿、排除同一来源所有修订。** 可形成独立备份／较强封禁，但扩大正文与权限合同；本期不推荐。

拟定存储：产品dataRoot下`personal-retention/agent-controls/records.json`，schema1独立于M3 `records.json`，不是候选正文／会话库。文件头必填`schemaVersion:1,storeId:UUID,revision:非负整数,events:数组`，无默认旧账回填。每事件必填：`eventId/operationId:UUID`、严格递增`revision`、`expectedRevision`、规范请求`requestFingerprint:SHA256`、`createdAt:ISO UTC`、固定`actor:'user'`、D02精确`target`引用，以及下列action；不额外保存候选正文、来源副本、Provider或会话状态。

| action | 参数／状态含义 |
| --- | --- |
| bookmark／unbookmark | 无附加参数，缺历史默认未收藏；是否收藏与候选未确认、业务真实、是否排除独立。收藏不自动开Enterprise enabled或注入Agent。 |
| correct | 必填`note`非空≤4,000 UTF-16，追加人的独立意见；所有历史注记保留、最近一条优先展示，原文同时可读。修改意见再次追加，不覆盖候选；不要求用户创建每日笔记。 |
| exclude／restore | 无附加参数，缺历史默认未排除。排除本条默认不可发现，精准origin的fork副本同样受控；历史仍可读。仅人可恢复，恢复仍受原始可读／分支／终态约束，不代表正确。 |

排除不会删除源资料、影响M3人工稿或同来源的新候选，也不承诺识别Agent语义改写；UI须明示“只排除此条，未来同来源新内容仍可能出现”。默认发现与默认重点收藏均过滤排除项，排除视图可看收藏标志／历史；恢复不清除收藏或纠正。多来源候选也只排除其自身occurrence，不封禁所有来源。

Agent工具、候选payload和普通查询没有人的事件写资格；通过现有人机HTTP适配及Host绑定目标写入，不从Agent传入`actor:user`取得权限。既有unmanaged全工具环境不声称为抵御恶意Agent的OS安全隔离；不会为绕过此局限开放治理端口工具或降低managed权限。

## D06：并发、容量、兼容和退出

**推荐A：用户治理单文件CAS／幂等；原生由Pi保持唯一权威；停用只停止新能力。** 原因：只有人的控制需要产品原子业务写入，没有候选跨库事务需要新建。**替代B：统一迁移M3为schema2／全域操作日志。** 会扩大旧资料改写和恢复面，没有证据，不推荐。

用户每次意图使用唯一operationId，包含target／action／note／expectedRevision的规范请求指纹；同operation同指纹回读原事件，同operation改请求拒绝。写入前在原Host短文件锁内核revision、精确目标与全部格式；临时文件原子发布、fsync及回读核验，返回storeId／revision／eventId。ACK丢失先查原operation，不换ID重做；并发冲突读新revision后由人决定重试，不能覆盖他人新注记。单文件完成无外部正文副作用，不新建业务pending／运行队列。文件≤2MiB，满额明确拒绝，旧文件和事件原位保留，不自动清理／压缩历史；目标不可读时本期仅回看旧治理，所有新增人的操作暂不可用，待准确目标恢复后再操作，不能借额外业务来源重建候选或冒认其原文。

只在首次明确人的写入时初始化新根，GET不写磁盘；既存根缺records、损坏、未知schema、符号链接／身份异常均报不可用，不重建空账掩盖数据损失。锁只覆盖短文件一致性，不围住模型／任务。原生候选载荷限D02；native写入／重试／压缩不另包一套引擎。toolCallId冲突或原内容变化显示UNKNOWN；独立调用可能产生近义候选，Agent自主选择是否继续，Host不做语义裁决。

不改M3 schema1、Enterprise原件／修订、M2／项目数据、Pi旧文件及业务ID；旧数据不回填自动候选。停用后保留native及人的账，旧版M3可忽略新增账，不能恢复旧备份覆盖新工作。收藏来源若缺失则显示精确引用不可读；未承诺永久备份或不可篡改。全产品SQL迁移、DuckDB／Semantica、业务生效时间新协议、共享／租户审批均不适用本模块；M7或后续真实需求另定。

## 决定台账与整体确认

| 序号／主题 | 推荐／理由 | 用户决定 | 一致性 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| D01 正文与粒度 | A，Pi原生工具结果已有持久能力 | 待整体确认 | 待核 | 待确认 | [官方复用](reuse-audit.md)、本包D01 |
| D02 字段／来源／身份 | A，最小声明合同、真实运行身份与精确字节分开 | 待整体确认 | 待核 | 待确认 | 本包D02、M3来源合同 |
| D03 执行／profile／终态 | A，同一普通turn；保护与取消边界保留 | 待整体确认 | 待核 | 待确认 | 本包D03、IN01–IN07 |
| D04 发现／分支／只读 | A，官方原生树投影；历史不冒充当前 | 待整体确认 | 待核 | 待确认 | 本包D04、固定SDK |
| D05 人的控制 | A，仅精确引用／独立意见，不要求逐条审批 | 待整体确认 | 待核 | 待确认 | 本包D05、[UI](ui-review.md) |
| D06 保存／兼容／退出 | A，单文件人的账，无M3迁移或候选双写 | 待整体确认 | 待核 | 待确认 | 本包D06、[spec](spec.md) |

分类：主线是同一Pi turn自主记录；支持结构仅人的引用治理账；个人列表／搜索是可重建ReadModel；M4消费、M6成熟、M7新组件均为后续，不预建。

共6组：正文／对象1、字段／身份1、执行／终态1、只读发现1、人的治理1、兼容／恢复1；关系、时间、字段空值、读写入口、权限及索引不适用理由均在组内写明。推荐整体全部A；请连同spec与Demo整体审阅。方向接受与该具体合同通过分开记录，本包不预填“已确认／一致”。

# M4 完整最小结构与接入决定包

2026-11-03 · v0.1 · **6组推荐均为A；尚待用户对本包及UI整体确认，未实施。**

[spec](spec.md)与[复用依据](reuse-audit.md)定义范围。依赖：D01→D02→D03／D04→D05→D06。只定义个人知识／经验消费与原生交付／声明，不从四库名推导新数据库。M31限定例外不适用于M4；批准Demo不等于产品开发已完成。

## D01：业务范围、owner与profile

**建议A：沿原project-tasks普通主分析，两种交付方式分别按能力接入。** 人可选固定文本给普通主分析，包括已有受管ordinary；新自主工具仅unmanaged。原因是人选固定材料已有Host准备路径，不需因此开放受管执行权；跨worker自助查找则确有新能力，需要窄授权。**替代B：另开记忆Agent／域，或给全部profile统一装记忆扩展。** 会多出上下文／循环或放宽冷读独立性，不推荐。

| 入口 | 人的准确选材 | 新自主查找／读取／声明 |
| --- | --- | --- |
| 普通unmanaged主分析 | 可，仍由原任务显式发送 | 可，原prompt自选，零次正常 |
| 受管ordinary主分析 | 可，仅本次已核定固定文本；不注入执行扩展 | 不可，本期不新增安全委派／远程能力 |
| 独立核算／protected、fixed-draft／text-only、业务插件 | 本模块不作为目标，不继承主分析的个人资料 | 不可；原固定输入合同不变 |
| 个人页／历史回看 | 只读找回／预览，不启动Agent | 无工具／模型启动 |

来源可以跨项目，但仍是同一当前个人环境内有权读取的准确对象；不新增团队、租户、成员或授权表。来源项目归档只读；目标项目归档不写。当前模型配置／lease／资源由原公共入口负责，没有memory owner或第二运行状态。

## D02：准确身份与模型可见交付

**建议A：复用原身份，新增小型声明式ref及原生交付envelope。** 原因：materialId不足以锁定一次个人保留；candidate viewer/fork也不是原occurrence。**替代B：复制到新个人正文库，或用标题／当前material取回。** 增加双正文或漂移风险，不推荐。

### 输入／引用逻辑字段组

| 字段组 | 类型、必填／默认／空值、含义 |
| --- | --- |
| 个人长期来源target | 严格union。人工为`{type:'retained',storeId,materialId,decisionId,revisionId,expectedBodySha256}`：全部非空，decisionId沿M3 decision.operationId，不造新ID；hash为64位小写SHA-256。候选为`{type:'agent-candidate',candidate:ExactCandidateRef}`，后者完整沿M31六字段。 |
| 人选项 | `{target,mode:'full'|'fragment',excerpt:{start,end}|null}`。full时excerpt必须null；fragment为现有UTF-16半开准确区间且不切代理对。最多8项／请求，不是任务配额。选项不存正文、用户确认事实、收藏或治理版本。 |
| 源口 | read可用`part:'content'|'corrections'|'source'`，默认content；source必须sourceIndex非负整数，从准确个人对象已有sourceRefs核对，不能提交任意路径。content／source准确范围与片段沿原UTF-16合同；corrections使用有界继续游标。 |
| 查找输入 | query字符串≤200、默认空；kind为all／knowledge／experience默认all；includeBody、includeArchived默认false；pageSize默认20最大50；人工／候选各自opaque游标默认null。关键词匹配标题／别名／范围，正文显式选择；没有语义排名或近义召回承诺。 |
| 查询结果 | 人工与候选分组目录：准确target、标题、类别、范围／局限（未知为null）、来源项目／归档标签、候选未人工确认／父状态、可读限制、片段可取性。没有正文预览、注记全文、自动评分／“已采用”。每组有continuation|null、partial及issues；未知不是0项事实。 |
| 正文模型可见内容 | 工具实际`content.text`或人选prompt包含准确目录／原文片段／全文、独立最新纠正、来源和局限。mode明确directory／fragment／full／corrections／source；每项extent另为metadata／fragment／full，directory固定metadata，source据实际文字／原件身份核定，partial与继续位置不隐含。最新单条纠正随正文；旧注记按需。未说明范围／时间仍unknown，生成时间不替代业务时间。 |

候选身份不包含收藏或人的targetRevision，故收藏变化不换来源，也不让每次读都经人的CAS确认。人工Enterprise未启用不等于个人未保留或越权；以准确decision／revision是否可读为准，另保留未启用标签。额外四类业务依据继续用M3 sourceRef及源口，不把本次知识查找扩大为全项目数据读取。

### 两种实际交付原生记录

**工具交付details v1**：`schemaVersion:1,type:'optracall.personal-context-delivery'`；origin为真实`projectId/taskId/sessionId/requestId/toolCallId`；`createdAt`是可信代码ISO UTC；`operation:'find'|'read'`；`items`为本次实际交付的准确target／mode／范围／来源状态；候选`governance`记录当时targetRevision、excluded:false、最新纠正operationId|null、旧注记数量，人工记录准确decision及当时归档／启用标签；`providedTextSha256`绑定模型可见payload文本块（content第一个text块）的UTF-8准确全文；`partial`、`continuation|null`和issues均必填。工具错误不带有效成功交付envelope，未知字段／版本不猜解。正文只在同一原生消息的可见content中，不另存sidecar；details是该交付元信息，不是模型可见正文的替身。第二个模型可见text块只给本次receipt定位（真实session/request/toolCall、sourceIndex及第一个payload块hash），哈希不覆盖含自身的定位块，避免自引用哈希；总输出预算覆盖两个块。

**人选providedContext.personal v1**：作为现有输入的可选字段，旧调用缺省即无本项。包含版本、准确items及对应mode／片段／当时治理、`providedTextSha256`和准备时间；实际payload文本块及其独立receipt定位在同一普通请求prompt中；hash只覆盖payload，不覆盖引用hash本身的定位。requestId／sessionId由原driver／run-start绑定，不让浏览器提交“已提供”或owner。原生user消息中须能核对对应准确交付文本与hash，不能只凭started标记成立。

字段组补充：`items`按模型可见payload的稳定数组顺序，0–100项（人工／候选各最多50，仍共同受总文本／传输预算约束）；预算先到即分组继续／partial，不能把未送出的组说成空。sourceIndex只指本次数组，不是持久业务ID。candidate的governance必填，targetRevision为≥0安全整数，excluded在成功新交付时固定false，latestCorrectionOperationId为原operationId或null，correctionCount为≥0整数；retained的governance为null、retention为准确decisionId／archived布尔值／enterpriseEnabled布尔值或unknown(null)。两类不互填另一类状态。createdAt只为技术ISO UTC时间；continuation为有界opaque字符串或null，issues是具体技术code与可核ref（未知ref不猜造），不存业务真假评分。payload至少含target／mode／extent／范围／来源局限／实际文本及当时最新纠正。part=source时另含准确resolvedSourceRef，非source为null；仅有二进制原件或不支持文本格式时extent=metadata，只交原件身份，不冒称OCR／正文。receipt辅助块只定位不重复正文。

两者的mode保留“目录信息确已交付／正文未交付”，声明不能升级其范围。内容hash仅核准确变化，不是OS认证或真假判断。交付的原生文本是历史快照，不接管M3／M31当前正文权威。

## D03：Pi工具、跨worker读port与接受边界

**建议A：同一SDK customTools与既有IPC增加受限的双向读请求。** 已核实Host函数不能沿ProjectAgentOptions序列化，当前IPC主要为Host→driver RPC及driver→Host事件；M31纯写details无需读Host，这是本模块新增适配的真实缺口。**替代B：启动记忆HTTP/MCP服务、把全库snapshot送进worker，或交给driver整个dataRoot。** 增加服务／双权威／越权面，不推荐。

声明式工具仅`find_personal_context`、`read_personal_context`、`declare_personal_context_use`。工具由原profile绑定实际owner；Host-only读port只允许search、按target及sourceIndex读取、当前项目060成果身份／原生交付核对，不给人的收藏／纠正／排除写能力、配置、跨owner管理或任意文件路径。模型传业务参数；owner、child、当前operation和能力由可信代码绑定。

IPC v1消息字段组为短期correlation ID、限定method、业务input与当前真实request/toolCall关联；response复用该ID、success/data或具体error。它们只为等待文件IO回包，不是业务ID、持久对象、代际或admission账。沿原child_process通道和退出／断连清理；不新建运行队列或恢复层，不把Host函数发给子进程。公共Interface v3的SessionRef／lease与取消语义不扩版，Host-only可选接缝及受影响消费者共同适配；真有公共权限扩展再补决定。

在工具开始及返回前核原ActiveRun／SessionManager与绑定owner仍当前、kind为prompt、真实直接toolCall匹配、未closing／cancelled／signal未abort；父端在await前后核同一child／run和权限。返回前最后资格核对后不得再异步等待；晚回包丢弃／错误，不形成正常交付或声明。关闭／停止清理待决IO关联，不自动重放模型。资格有效返回只代表已接受、待保存；精确原生成功结果回读后才是已记录。随后父任务取消／失败不抹掉已经发生的交付，父状态独立展示。取消以driver实际观察为界，不承诺点击瞬间跨进程原子化。

新静态导入例外仅用于必要readonly适配，不能放宽SDK动态执行、management port或protected文件根；边界规则样例／反例进入后续检查。

## D04：人的选材、显式发送与请求幂等

**建议A：沿已有taskKey内存选材、真实普通任务草稿、显式发送／fingerprint／native，不建handoff。** 原因：普通任务已管理草稿／请求／恢复，而反馈handoff另有BoardTask与来源项目业务意义。**替代B：新建持久个人handoff／跨库pending事务，或把候选塞进feedback。** 当前无刷新恢复选材的已确认需求，不推荐。

一个选择组归实际目标`projectId/taskId`，条目沿D02；目标切换不串资料。个人页跳转使用原非activate路径，不提前打开Agent。新任务走已有createTask，成功后再挂本次选材；不引入通用创建幂等台账。已有问题草稿不替换、不追加一长段来源文案。选择、打开预览、创建目标和发送分别表达，不把选材成功写成资料已提供。

未发送选材只在现有App内存，切页可保留；刷新／进程重开可能丢选材，必须清楚提示，不能暗示已持久保存。原问题草稿仍由原产品保存。选材不自动收藏／启用／恢复来源，也不自动发送／额外调模型。

发送时按准确target回读正文和当时最新治理，附上最新独立纠正；选择的含义就是“这份准确原文及发送时最新人的意见”，不锁住旧注记，也不因收藏／父状态变化强迫再确认。排除、不可读、身份不符、目标归档或预算拒绝时保留问题与选择，不悄悄送其余材料；用户可明确移除此项或缩小片段再发。不改成强制分析前审批队列。

请求fingerprint涵盖用户问题、准确targets及显式范围等用户意图，不把每次live治理变化引为新的请求。沿原同ID回查次序：已经接受则查原native／原回执，不再按今日来源重做；未接受新发送才作当前校验。治理与prompt不建跨文件事务，快照核对后生效的排除不倒推撤销交付；技术时点和点击时点分开。不自动换ID、重发模型或丢弃UNKNOWN。

## D05：消费政策、预算和历史只读

**建议A：读取时核当前治理，交付后保留当时事实；unknown明确退出。** 原因：避免候选污染，也避免人的后续操作重写历史。**替代B：收藏才能读、所有旧纠正都锁定审批、排除后清除历史或Host自动挑最新正确答案。** 将关注当准入、强加维护或越过业务判断，不推荐。

- 候选默认查有效非排除项；未收藏可读。read必须在原M31精确reader之上另核excluded和有效治理，不能因个人页允许看excluded就向Agent新提供。
- 人工默认查已保留非归档项；已保留的Enterprise disabled照常准确读取。人工归档显式纳入时按历史参考交付，原决策／revision保持；源项目归档另标，目标归档禁止写。草稿不新提供。
- 发送／read采用Host此次核到的治理快照，原文准确版本固定、最新纠正随附。排除已先提交则拒；晚于该快照不清已交付或强制停分析。恢复只解除排除，来源仍UNKNOWN就不能供给。不给即时全局撤回或跨文件事务承诺。
- 纠正是人的独立意见，不覆盖原文或自动变成事实。历史注记全保留、最新随正文，旧注记另按需查；有反例／过期／争议标签供Agent判断，不由Host专业评分／投票。
- query分人工／候选输出，每组默认20、最大50，游标与query绑定；无全局语义排序。目录投影不得调用旧M3逐行readSource／正文预读；显式正文搜索必须算入其读取预算并说明部分。一次find/read/声明核对或一次人选材准备的原生读取**共用**20文件／50MiB（包含嵌套source／fork／声明证据核对，不能按每target重置）；目录单文件沿既有2MiB guard；不把它冒称全部metadata IO恒定上限。
- read默认4,000 UTF-16片段，显式最多20,000；片段不冒充全文。最新纠正≤4,000随内容，旧注记分页，截断／继续位置明确。模型可见文本单次≤32,768 UTF-16，序列化≤256KiB；超限不漏注记或Host补摘要。人的每请求≤8项并沿已有总消息预算；不是任务内调用配额。
- M4涉及的native来源与新历史来源页共用M31 safe snapshot→public parser→inMemory投影；旧格式／坏行／重复ID／环／并发增长／超限均不迁移、不补写。受影响的taskContextReceipts／savedTaskHistory调用链要实查，不能沿旧open读取宣称无写入。旧消费者做字节／mtime及兼容回归，缺新字段的旧native始终未记录／UNKNOWN。

只读ReadModel不新增持久索引。没有匹配、扫描未完整和来源不可读分开；首次无ref只报文件级unknown，不能猜身份／数量。旧交付详情可用当时native文本且明确其性质，不能凭缓存填当前source；原始来源丢失、当前与当时治理分别展示。

## D06：可选作者声明、身份与退出

**建议A：复用Pi成功toolResult，声明绑定准确成果及原生实际交付，不新增citation Store。** 原因：M2成果登记已有用途，但没有个人refs；本模块把Agent的显式声明留在原native更窄，无须扩M2持久schema或做自然语言解析。**替代B：只展示作者原话但不作结构化关系；或扩M2个人refs。** 前者更小但不能准确回查成果／交付关联，后者多改一处业务持久合同；本期推荐A。不使用声明工具的正常工作无须补读／补声明。

| 字段组 | 合同与含义 |
| --- | --- |
| 声明输入 | artifact为`{path,expectedSha256}`，path限当前owner项目的060_reports相对路径、沿现有安全观察支持的格式／字节边界；不接受绝对路径或另一项目路径。deliveries为1–8条准确引用；statement非空≤4,000 UTF-16。这些表达作者声明，不接受claim／actor／owner自填。 |
| tool交付引用 | `{via:'tool',originSessionId,requestId,toolCallId,sourceIndex,expectedProvidedTextSha256}`。均必填；sourceIndex非负，指该真实find/read结果内一项。toolCallId由原可信工具返回给Agent；不能强制提交回调返回时尚未生成的entryId。|
| request交付引用 | `{via:'request',originSessionId,requestId,sourceIndex,expectedProvidedTextSha256}`；只引用该任务中准确的起始人选材料。必须有可核对的原生user文本与personal回执，不凭run-start孤证。 |
| 声明结果details v1 | `schemaVersion:1,type:'optracall.personal-context-use',claim:'author-declared-use'`；真实origin五字段、createdAt ISO UTC、经核的artifact `{projectId,path,sha256,bytes}`、statement、sources。每source保留输入deliveryRef，Host回读核定的真实nativeProof、准确target、当时mode／extent／范围／治理与providedTextSha256。nativeProof为严格union：工具交付含toolResultEntryId；请求交付含runStartedEntryId和userMessageEntryId，均为原SDK非空entryId，不新编号。成功native才称已声明；回调返回仍待保存。 |
| 声明意义 | 只证明作者对该版本成果作过这项声明。目录可声明“只参考目录信息”，不能升级成正文已提供；片段不能升级全文。交付、理解、事实正确、策略有效、因果及实际经营执行均不从声明推出。 |

同任务准确历史中的实际交付可被声明；核其原run／tool／entry／hash和sourceIndex，不扫全局native或凭任意外部路径。来源后来排除／失读不撤已发生交付；声明是引用既有交付、不是重新提供正文。原交付不可核则明确unknown，不靠新查一次替代旧证据。成果尚无准确hash／改稿／缺失则不给另一版本创建有效声明，Agent仍可继续分析，不要求Host补报告。

声明不把源正文写第二库，也不追加custom entry双写；SDK只保存本工具原生结果。旧M2人的成果来源登记和其原声明保留原权威，不把Agent声明冒称用户确认。M4新回查并列展示，不自动合并两者或解析报告关键词。

停用只撤新工具／新选材入口，旧交付及声明原生记录保留；不改M2/M3/M31 schema或旧ID，不删除原件、报告、注记或原专业FAIL。旧代码可能忽略新providedContext可选字段／tool details，不承诺旧UI能展示新功能；回退用能保留最新native的兼容代码，不恢复旧备份覆盖新工作。无数据库迁移、清理或第三方组件安装；实时撤回、成熟晋升、团队治理及语义检索在后续。

## 决定台账与整体确认

| 项 | 推荐／理由 | 用户决定 | 一致性／状态 | 依据 |
| --- | --- | --- | --- | --- |
| D01 范围／profile | A，同一主任务，固定文本与自助权限分别复用 | 待整体确认 | 待确认 | spec RU01／RU10、原profiles |
| D02 精确ref／交付 | A，原身份与准确文本，不复制正文库 | 待整体确认 | 待确认 | M3 decision、M31 ref、Pi content／details |
| D03 只读port／资格 | A，既有IPC最小补口，无第二Runtime | 待整体确认 | 待确认 | Host→worker序列化缺口、现ActiveRun |
| D04 手选／显式发送 | A，原taskKey／draft／fingerprint／native | 待整体确认 | 待确认 | 现普通任务／M2选材，反馈合同不泛化 |
| D05 治理／预算／历史 | A，当次治理与历史分开、只读有界 | 待整体确认 | 待确认 | M31治理与safe snapshot、旧open缺口 |
| D06 可选声明／退出 | A，同一Pi原生声明，不新citation权威 | 待整体确认 | 待确认 | M2缺个人refs、官方toolResult持久能力 |

分类：主线为第二事项找到／准确读／判断或拒用；支持结构仅现有prompt回执可选字段与工具envelope；个人目录／历史来源区为可重建ReadModel；M5–M8和新存储／检索组件为后续。六组覆盖对象、粒度／身份、字段空值／默认、方向／基数、时间／状态、权限／出入口、历史及兼容：一个任务有多次原生交付，一次交付有多个准确source，一份准确成果可有多项作者声明；声明引用交付不拥有源对象，排除不删历史。没有新table/index/migration，故物理SQL和独立事务／全局唯一键不适用；原source和native entry权威不变。

**请整体确认本v0.1决定包及更新UI；如需修改，请列对应项号。** 方向已通过不重问；上述新增具体合同当前均未确认，确认前只准备文档与虚构Demo，不创建真实schema／port或产品代码。

# M3.1 完整最小决定包

2026-11-03 · 精简版 v0.2 · **用户整体确认 v0.2 全部六组决定及 UI，按 A 实施。**

已接受的三层方向、“优先Pi官方”和本次精简方向不重问；v0.1的六组原推荐已被本版替代，原字节与审查见[历史](history/v0.1/README.md)。本包只决定原生候选及最小人的控制合同；依赖顺序 D01→D02→D03／D04→D05→D06。依据：[spec](spec.md)、[复用证据](reuse-audit.md)、M3既有严格schema1；产品开工前须同时确认[UI](ui-review.md)。

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

## D03：Agent写入、接受与原生保存

**推荐A：同一普通unmanaged项目任务、同一Pi customTools，自主提出候选；有效接受且精确落盘后即可发现，父任务状态另行标注。** 原因：任务后续失败／取消不应连带抹去已经有效保存的候选。**替代B：沿v0.1等整请求completed才发现。** 简单保守，但把任务技术终态当成候选价值门槛，用户已接受删去该门槛。

工具参数仍只含D02内容／声明式来源。开始时捕获已有ActiveRun对象、SessionManager和真实owner／SDK toolCallId；开始及返回前核run对象与manager仍为当前同一资源、kind为prompt、未closing／cancelled、signal未abort。专属候选工具名、原assistant toolCall与结果必须互相匹配，其它工具碰巧返回同type不算候选。最后核定后同步返回，不能再有异步间隙。通过检查才返回固定envelope，不追加第二份候选／admission事件，不建立运行／代际账；不在task settled后总结或调用模型。SDK不能替本工具自动纠正迟到成功，返回前检查不可省。

| 技术事实 | 显示／保全规则 |
| --- | --- |
| 工具有效返回，但原生成功结果尚未回读 | 仅“已接受、待保存”，不能显示已记录。 |
| 成功toolResult、真实origin及原run-start／toolCall／entry／完整details hash可精确回读 | “已记录”，属于可发现候选；父请求是否completed、是否位于canonical分支不改变该资格。 |
| 已接受并保存后，父请求运行中／cancelled／failed／缺settled | 候选保留；分别标父任务运行中／取消／失败／UNKNOWN，不升级为正确事实或自动成果。 |
| 工具开始／返回前已失去原run／session／取消资格 | throw或isError且不带有效候选envelope；技术错误／明确迟到仅异常历史可查，不混正常候选。 |
| 归属、工具调用、entry或hash无法核对／已知来源损坏 | UNKNOWN；不能靠父completed或副本字段补造有效性。 |

有效返回后、SDK落盘前才取消，若最终精确成功结果可回读，候选仍有效；没有落盘便不能显示已记录。取消边界以可信driver实际观察到撤销／signal为准，不承诺用户点击瞬间的严格线性化。此处是利用既有生命周期校验工具副作用，不要求Agent固定分析步骤、等待用户或额外重跑。

受管ordinary／protected、fixed-draft、text-only／冷读不注入本工具；历史查看不启动runtime。普通unmanaged不构成原生文件防篡改认证，Host绑定参数与hash只证明本合同下的归属／准确字节。容量是载荷／资源边界，不是每任务记忆条数或方法配额。

## D04：个人统一发现、保存位置与只读合同

**推荐A：按用户查询汇总所有有权读取的已保存有效候选，保存位置／父状态只作标签和筛选，不再是默认隐藏门槛。** 原因：个人资料是跨任务发现入口，不与当前会话上下文混为一体。**替代B：仅canonical当前分支默认可见。** 旧方案把可用资料与导航路径绑定过紧，用户已接受简化。

默认发现过滤人的排除；另有重点收藏、异常历史和已排除视图。保存位置可标“任务当前保存路径／其它已保存路径”，仅据读取时已保存的task canonical指针及SDK完整磁盘快照判定，不声称实时反映未持久化导航。父任务状态和保存位置各自可筛选；它们不代表内容正确／错误，也不自动送入Agent上下文。明确迟到、工具错误或身份不可核的记录只在异常历史显示其真实原因。

复用SDK getEntries发现已保存条目，getBranch仅辅助标识快照路径，不重建当前Agent上下文。fork复制按原origin occurrence及精确entry／hash去技术重复，须回读原始同task历史、匹配原run-start与toolCall；复制不换生成时间、不绕过人的排除。独立新toolCallId是新候选，不由Host按语义合并。

先只读校验非空UTF-8 JSONL/header/version3、完整逐行JSON及尾部；再核必要entry形状、ID唯一、parent存在、无环有界。通过后使用公开parseSessionEntries和SessionManager.inMemory(cwd, undefined, entries)；官方parser会吞坏行、重复ID索引会覆盖、getBranch不防环，故必要guard保留。只核完整性，不新做树／恢复引擎；不以open遍历触发旧文件迁移，旧版本／损坏／部分写入保持原字节并报UNKNOWN。

失读时，来自有效治理账或本次此前精确读取的已知引用可显示UNKNOWN；不补缓存正文／类别／生成时间／业务来源，也不借缓存宣称父状态或保存位置当前已核定。首次查询／重启若只知道文件不可用且无精确ref，只报文件级UNKNOWN，不猜候选数／身份。可操作的失读target必须已存在于有效用户治理账，仅本次曾读但尚未留人的记录的引用仍只读。Demo的失读是在虚构记录先加载后发生；另须演示首次失读不猜身份。

页大小默认50、最多100；一次读取至多20个文件／合计50MiB，超限返回可继续游标／部分状态，单文件超限单列，不伪装空结果。关键词默认标题／别名／scope，正文显式选择；未知正文不参与内容或类别匹配。可核生成时间排序，无生成时间者按稳定引用键排列。没有embedding／语义召回主张；源可见不等于允许跨项目送入，M4消费／实际提供／引用仍未接。

## D05：重点收藏、纠正、排除与人的治理账

**推荐A：人的事件只引用精确原生候选；收藏是关注，纠正是独立注记，排除只针对本条及其分支副本。** 原因：避免手工维护、避免改Agent原文，也不把同一数据源所有未来新知识一并封禁。**替代B：收藏复制正文、纠正覆盖原稿、排除同一来源所有修订。** 可形成独立备份／较强封禁，但扩大正文与权限合同；本期不推荐。

拟定存储仍为产品dataRoot下personal-agent-controls/records.json，独立于M3原records.json。它只存人的精确引用操作，不存候选正文、来源副本或会话状态。文件头为schemaVersion:1、storeId:UUID、events:数组；不另设全文件业务revision。全部事件固定解释为用户入口发起，不接收Agent冒认actor，也不宣称具有抵御本机恶意进程的认证。

每事件只含operationId:UUID（兼事件ID，全文件唯一）、D02精确target、action、note、createdAt:ISO UTC、targetRevision:正整数。targetRevision只在同一occurrence内严格递增，从1开始；note仅correct为非空字符串，其余为null。createdAt由Host写入，事件次序／同target版本决定先后，不依赖时钟单调。删去独立eventId、请求fingerprint和重复持久expectedRevision；候选内容的完整hash仍保留，不能把两种用途混同。

| action | 参数／状态含义 |
| --- | --- |
| bookmark／unbookmark | 显式设置收藏／取消，默认未收藏；仅表达关注，不等于备份／事实确认／送入Agent。请求携expectedTargetRevision，只核同target当前版本。 |
| correct | note必填非空≤4,000 UTF-16。独立追加人的意见，最近一条优先展示，全部旧意见和Agent原文保留。无expectedTargetRevision，锁内并发顺序追加；不迫使人确认别人刚追加的独立意见。 |
| exclude／restore | 显式设置排除／解除排除，默认未排除；请求携expectedTargetRevision，只核同target。排除只影响本occurrence及fork副本，不删原文，restore不清收藏／注记，不证明正确或修复来源。 |

默认发现和重点收藏过滤已排除项，已排除视图可读旧控制。父任务状态或保存位置改变不撤销人的标记；同来源未来新toolCallId仍可形成新候选，不作来源家族封禁或语义去重。人的纠正不覆盖Agent原文，也不由Host判定为已证实；M4尚未接入其读取与使用。

当native可精确回读时，按真实target可首次记录人的操作。native缺失／变化／损坏时，只对有效治理账内已存在、字段与hash完整的准确target开放unbookmark、exclude、restore；不需要为这三项重读原文。bookmark、correct仍需原文可精确核对；无账内target者仅看UNKNOWN，不能以坏文件或缓存猜新target。restore只改人的排除标志，候选仍UNKNOWN，不因此进入“已记录可读”结果。重试已成功的原operation可以回原回执，不算失读时新增收藏／纠正。

人的写入口沿现有人机HTTP／Host业务适配，Agent候选工具没有此能力，不从payload actor取得人的资格。普通unmanaged仍非OS隔离；不为记忆功能放宽managed／封闭／冷读边界。

## D06：保存、并发、容量与退出

**推荐A：一个operationId、一份最小追加记录；短文件锁／原子写，设定冲突只限同target，独立注记直接追加。** 原因：意见历史和断线回执确有需要，但无须多重编号／哈希协议或让不同候选互相冲突。**替代B：保留v0.1双ID／指纹及全文件CAS。** 保护范围过大，用户已接受简化；不引入分表、全局队列或pending状态。

同operationId查询在当前native可读和同target版本检查之前：按已存target／action／note核同一请求；设定动作还比对原expectedTargetRevision，该值可由成功事件targetRevision−1取得，无须重复存储。相同请求返回原事件／原targetRevision，不同请求拒绝；Host生成createdAt不参与比较。回读旧操作不重新应用事件、不把页面现状态退回旧版本，当前状态按最新账读取。同一occurrence若换内容hash不得静默重绑为新target，应报不一致／UNKNOWN。

新操作在短文件锁内读取有效账、校验真实权限／精确target、同target前置版本（设定动作）、容量，再临时文件原子发布、fsync并回读核验，返回storeId／operationId／targetRevision。无关target的变更不导致冲突；correct无前置版本，所有意见保留并递增同target版本。同target的过期设定动作明确冲突，显示现状态后由人重发新的明确意图，不自动覆盖。丢ACK先查询原operationId；未知时不自动换ID重做，更不重放模型。

文件按序列化UTF-8实际字节≤2MiB预算，满额保留旧文件并报准确容量错误、继续只读，不自动压缩、丢历史或重建空账。首期没有无限容量承诺；超预算后的容量上调属于后续环境调整，不为本轮另建分卷／后台整理／导出平台。该已知容量边界不能被“本轮精简”或检查PASS隐去。

首次明确人的写入才初始化新根，GET不写。既存根缺records、损坏、未知schema、链接／身份异常、重复operationId、同target版本跳跃等均不可用，不初始化空账掩盖损失。锁只围短文件IO，不围模型／任务，不构成Agent运行队列。

M3.1 v0.1未实施、无生产治理账，因此本版仍定义初始schema1，不存在已写数据迁移；不可把v0.1 Demo内存当真实数据迁移。保留M3旧schema1、Enterprise原件／修订、M2／项目与Pi旧文件／业务ID。停用只停止新能力，旧native及人的记录仍保留；旧代码忽略新增账，不恢复旧备份覆盖新工作。收藏只是引用，原生丢失并无候选正文备份。团队权限、成熟晋升、DuckDB／语义组件与M4消费均不在本版结构范围。

## 决定台账与整体确认

| 序号／主题 | 推荐／理由 | 用户决定 | 一致性 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| D01 正文与粒度 | A，Pi原生工具结果已有持久能力 | A，用户整体确认 | 一致 | 已确认 | 用户“确认，进入产品开发。”；[官方复用](reuse-audit.md)、本包D01 |
| D02 字段／来源／身份 | A，最小声明合同、真实运行身份与精确字节分开 | A，用户整体确认 | 一致 | 已确认 | 用户“确认，进入产品开发。”；本包D02、M3来源合同 |
| D03 接受／保存／父状态 | A，资格核当前原生工具，已记录不等父completed | A，用户整体确认 | 一致 | 已确认 | 用户“确认，进入产品开发。”；用户“接受你的建议”及本包D03 |
| D04 统一发现／只读 | A，各保存路径有效候选默认可见，状态标签／筛选 | A，用户整体确认 | 一致 | 已确认 | 用户“确认，进入产品开发。”；本包D04、[UI](ui-review.md) |
| D05 人的控制 | A，失读已有target允许取消收藏／排除／恢复 | A，用户整体确认 | 一致 | 已确认 | 用户“确认，进入产品开发。”；用户“接受你的建议”及本包D05 |
| D06 保存／兼容／退出 | A，合并ID／去全局CAS，保留防重和注记历史 | A，用户整体确认 | 一致 | 已确认 | 用户“确认，进入产品开发。”；本包D06、[spec](spec.md) |

分类：主线是同一Pi turn自主记录；支持结构仅人的引用治理账；个人列表／搜索是可重建ReadModel；M4消费、M6成熟、M7新组件均为后续，不预建。

共6组：正文／对象1、字段／身份1、执行／终态1、只读发现1、人的治理1、兼容／恢复1；关系、时间、字段空值、读写入口、权限及索引不适用理由均在组内写明。D01／D02沿原未变内容，D03–D06为本次受影响项；不重问已接受方向。原准备阶段提交v0.2具体合同与Demo审阅；用户现已整体确认全部六组A并进入产品开发，原准备阶段状态见确认字节快照。

2026-11-03 开工记录：用户整体确认 spec v0.2／D01–D06／更新 UI；批准原包内产品范围。本次不包含 Git／CI、安装、服务切换、MacBook 或真实 Provider 实验。原确认字节见 `.local/fourbase-modules/m31/implementation/approved-v02/`，Demo SHA-256 `e65aff10c57741ac2b39cbd983c4500385fa844f8fd0a701648c5a8f53f91146`。

### 实施接缝修正：隔离技术目录

实际浏览器和Host回归证实：原拟定`personal-retention/agent-controls`会创建M3的权威父根，令从未创建人工账的用户被误报`personal_records_missing`。放松M3 guard又会掩盖真实丢账，故新账改用同dataRoot下独立`personal-agent-controls/records.json`。字段、owner、identity、治理语义、预算与退出不变，未增加新结构或迁移机制；M3根／schema／数据不动。本模块尚未发布，无生产M3.1治理账需要迁移；旧隔离合成现场原路径保留作FAIL证据，不由产品兼容迁移。批准Demo原字节仍固定，技术目录文字如有旧值以本接缝修正为准。证据：`implementation/native/09-manual-root-collision-red.log`及实际UI FAIL。

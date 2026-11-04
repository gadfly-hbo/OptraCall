# M5 最小结构决定包

2026-11-03 · **8组推荐A，尚未获用户整体批准；没有实施任何表／字段／迁移或产品代码。**

共同原则只维护于[工程规范](../../../docs/engineering-workflow.md#四点产品原则)。本包与[spec](spec.md)及[Demo](../../../docs/prototypes/fourbase-m5-case-decisions-ui-demo.html)一起确认，涵盖业务含义、空值、身份、关系、权限、持久化与退出。例子均虚构，不代表已有真实业务记录。

## D01：Case内的两类记录与默认使用

**建议A：只补Case内“假设／策略”的有版本业务草案；原任务正常提问，Agent按需整理，人选可选。** 原因：既有散文记录无法准确回看每项判断及依赖，而新建双库服务／另一个分析Agent没有必要。**替代B：先建全局Hypothesis／Strategy CRUD并要求人维护；C：只用notes散文，不支持稳定关系。** B扩大底座和维护负担，C不能满足本次核心行为。

Case是唯一业务归属，身份沿原CaseStore.storeId＋caseId。kind为hypothesis／strategy，recordId为Host首次保存产生的UUID；caseId和kind一经创建不变。标题不是身份，不因同名自动合并。记录可以零条，不要求每次提出假设／策略；各条可独立存，不强造完整因果链。普通无Case分析／M3.1候选／M4按需读照常工作。

当前Case来自原Case继续工作入口和本次已核实task_context_prepare快照；不加永久task→Case指针，不以ProjectWork或首末关联Case猜目标。来源候选明确导入可形成新业务草案并保留原ref，不会把所有旧候选／RAP自动转成Case记录。

## D02：独立修订与最少字段组

**建议A：稳定recordId下追加不可变revision，原文与作者保留；只要求kind、title及核心陈述／做法。** 原因：可修订而不改旧判断，且无需填满长表。**替代B：覆盖当前卡片；C：每次改写生成不相关新ID。** B丢史，C失去连续身份。

| 字段组 | 候选合同／默认／空值 |
| --- | --- |
| 共同身份 | caseStoreId、caseId、recordId UUID；revision正整数，从1连续追加；expectedRevision创建=0，修订=当前版。记录ID跨Case唯一；同record的caseId／kind固定。 |
| 核心内容 | kind固定枚举；title非空≤120码点；hypothesis.statement或strategy.proposal非空≤12000 UTF-16；整个payload≤20000 UTF-16且请求序列化≤256KiB。技术容量不是记录数量／分析方法配额。 |
| 假设补充 | scope、mechanism、unknowns、whatWouldChangeJudgement各为string或null，缺省null；assessment为unresolved／supported／weakened／refuted，缺省unresolved，assessmentReason可null。标签只是当前作者表达，缺依据明确“作者未说明”，Host不打真实性分数。 |
| 策略补充 | goal、mechanism、conditions、limitations各为string或null；依据／依赖见D03。plan为可空字段组：scopeAndAuthority、implementationOrEvidenceTiming、reviewAndTriggers、expectedObservationsAndComparison、risksAndExit，各string或null。可自然语言逐渐补充，未知日期／阈值不推断，不造结构化日程。 |
| 整理状态 | lifecycle=active／archived，默认active。归档／恢复仅人的小治理入口追加修订，默认当前列表不显示已归档条，历史仍可达；只有人明确恢复可向已归档记录追加恢复版，Agent／人的选择或关联均不得借旧版绕过归档。它不是专业真假、业务采纳或执行状态。 |
| 变更说明 | changeReason:string或null，创建可null，修订允许未知但展示未说明；旧修订不可覆盖／删除，“恢复旧版”须另存新修订并引用旧ref。 |
| 真实作者 | origin由Host写：actorKind=user／agent，actor的真实projectId/taskId/requestId/sessionId/toolCallId按可得性填值或null；Agent来源必需本次可信绑定，不能从模型JSON自报user／owner。来源引用与记录作者分开。个人阶段不新增账户/IAM。 |
| 技术时间 | createdAt为Host实际保存UTC ISO时间；不代业务发生／生效时间。业务时间留原来源／scope，未知为null。单独投影decisionUpdatedAt；草案修订不暗改Case核心revision／updatedAt。 |

每条各自CAS，不要求整Case所有卡片一起提交；一部分保存后另一项失败如实显示部分完成，不造跨多卡片／native事务。每次保存operation只产生至多一个新修订，结果由原operation回执固定。

本期不新增人工正文／专业判断CRUD编辑器，用户纠正沿原任务提问，由Agent自主另存。人的关联／归档／恢复也是此记录的新修订：其真实origin标人操作、原正文沿用原稿，references以derived_from准确指向沿用稿，界面分开“本次操作人”与“正文原作者”，不冒称人原创或Agent作了人的治理。增加／解除关系均保留原版本，治理用同一record CAS与单卡operation；Case关闭／项目归档时连恢复也不获新写权。

## D03：准确证据、依赖与影响表达

**建议A：修订中保存少量准确refs和作者声明的关系，联合展示时按需核原权威；不建依赖图／因果引擎。** **替代B：按标题或latest漂移；C：自动解析所有文本推断受影响关系。** B失真，C让Host作判断并重复建模。

`references`默认[]，每条包含relation、target及note（可null）；relation为supports／opposes／background／limits／derived_from／depends_on／action／feedback，是作者声明，不是Host验证结论。每修订≤32项、同relation＋准确target去重；零项可保存，有依据不足提示而不阻断分析。

准确target限首期已具备的权威：

- 原M3 `PersonalSourceRef`：Enterprise精确修订、M2 citation／指定attachment、native-reply精确session/message/textSHA／片段、指定FeedbackRevision。其原结构与安全reader复用，不新编号。
- 原M4 `PersonalContextTarget`：retained原decision/revision/bodySHA或Agent candidate ExactCandidateRef。M4接口不被改成Case存储；只是沿原ref回读。
- RAP：原instanceId＋已发布version；无发布版可引用准确原生回复，不回落当前草稿。RAP方法假设不能自动成为已检验业务假设。
- Case卡片：caseStoreId/caseId/recordId/revision；depends_on仅策略→同Case假设的准确修订，允许多对多及零依赖；背景／影响说明可引用同Case其他卡片。无全局跨Case图，跨事项材料继续原M4／报告来源。
- 原BoardTask：projectId/itemId/taskId，核真实归属。任务是可变对象，Host在关联时附真实读取的updatedAt及title／owner／dueDate／status／note观察快照；这是“当时看到”，不是原Board提供了不可变行动版本。当前状态另读，不允许客户伪造快照。

反馈如要表达原handoff的sourceNature／观察期／适用性／局限，另带既有handoffId并验证对应指定反馈；没有则保持未记录，不能把FeedbackRevision没有的字段说成已有。来源性质沿已有声明（合成／推演等），未知不标真实；引用存在、方向、范围及专业核验分别表达。来源已知但正文失读可保留准确ref＋UNKNOWN，权限／归属／结构不合法拒绝，不为省操作换latest或猜身份。

`impactNotes`默认[]：由Agent／人明确写{target:准确卡片ref, explanation:非空string}；statement/changeReason说明撤回／修改了什么与依据。Host可提示“有新版本”，不能从ref数量／assessment自动生成“受影响／已失效”。不存在显式说明≠没有影响。旧报告仍由原成果版本保存；新草案不自动替换旧报告，也不额外建立成果证明协议。

## D04：人的独立取舍与并发

**建议A：取舍只由明确人的入口追加原Case事件，绑定准确策略版；Agent只提议。** 原因：不把推荐、保存、原Board采纳或执行陈述冒充人的新决定。**替代B：策略草案里可写已采纳／自动沿用旧选择；C：先建BoardItem才允许选择。** 均混淆权威或增加操作。

人的普通动作可一次点“先补证”等；choice枚举为trial／gather_evidence／defer／reject／no_action／continue／adjust／stop_considering，reason为可空文字，最长4000 UTF-16。未记录=未选择，不等于reject；no_action针对此方案的当前取舍，不总结整个Case唯一结论。stop_considering不表示真实行动已停止。常用动作直达，其他取舍／理由按需，不要求每版审阅。

请求带operationId、准确strategyRef、expectedPreviousChoiceId（该稳定record跨所有revision的最后正式choice事件ID，首次null），默认requireCurrent=true。事务内核同Case/record与最新choice；null只能用于从未选择的record。当前策略已变则冲突保留草稿，显示新版本而不静默选择它；明确历史页“按这版历史记录取舍”可allowHistorical，只放宽非latest，不放宽关闭Case／归档卡片／权限。人可选择旧版，但当前新卡只显示“旧v1曾选、当前版未选”。

choiceId复用WorkEvent.id，eventType新增case_strategy_choice、actorKind仍user；changes.choice.before为原choice引用/摘要或null，after包含准确strategyRef、choice、reason，事件序列保留替代关系。只影响目标策略record的选择投影，其余保持原状；不删/重写旧事件、不自动撤回旧选择或跨record互斥。

不强绑无关标题／note的旧Casecore版本：事务内读取当前Case开放状态并以当前revision+1写原event；用每策略expectedPreviousChoiceId保护并发取舍。Agent卡片新修订不碰Casecore版本。**同operation成功结果先于当前准入／CAS回读**：后来Case关闭／策略更新／源失读都不能把已成功原意图改成新保存。UNKNOWN保留原ID／载荷，先查原回执，不新ID盲重试。

## D05：原行动、计划和反馈的单一权威

**建议A：Case只保存关系和补充计划，Board／Feedback各在原入口编辑。** **替代B：新建行动／反馈系统或双向同步所有字段。** 重复且造成多重权威。

BoardTask.owner／dueDate／note仍为行动层当前值。M5不另增可编辑owner／dueDate副本；尚无行动时，plan文字可记录拟议责任／时间（未知null），明确“拟议未承接”，不自动变成行动承诺；已关联行动则并列其当前真实字段及关联时观察，冲突不以某一方覆盖。ProjectWork是项目全局，不能当此策略专属负责人/授权范围。

原公开行动接口目前能新增任务和改状态，**不能持续编辑已有owner／dueDate／note**；“仍归原权威”不等于补齐了编辑器。M5的计划渐进补充限于带版本的策略plan文字、关联时真实观察及原处已具操作，不新增平行行动编辑器。若后续确需修改实际行动承诺，须另补原Board最小合同／UI并单独确认，不能悄悄写进Case副本。

一次可选“关联已有行动”仅对明确目标策略追加带准确关系的新修订；“去原看板承接／回录”沿原入口。关联指定反馈同样落到明确卡片的新修订，不能以Case全局bool代替准确关系。相同关系已存在可提示无需新增，不覆盖原稿；人操作沿D02的origin／原正文归属与CAS。创建／采纳／改状态／反馈只在原Board完成，不因Case选择自动触发；本期不新增跨库一键派发／同步事务。关联可一对多／多对多，解除关系也以新卡片修订表达，旧版本保留，不删除原行动。无行动、无反馈、执行偏差／观察范围不一致均可正常存在。

反馈绑定原task＋feedbackRevisionId，handoff范围明确则带原handoffId；后续新反馈不改旧依据，可提示新版本再由人／Agent解释。adopted为原反馈执行陈述，不替代Case人的取舍；effect／score／done及合成／SimLab均不自动证明真实经营效果或因果。到期未回录保持待反馈；复核日期不创建定时器／自动模型／提醒。

## D06：Pi、Host写口与授权范围

**建议A：原project-tasks／Interface v3业务子集下，增加窄Case业务read/save adapter的两个SDK工具；生命周期／IPC资格复用原公共入口及M4模式。** 现有M3.1仅knowledge/experience，M4只读个人refs，未具Case业务写权，实际缺口明确。**替代B：新Hypothesis/Strategy Agent、循环／队列，或把M4只读callback偷改通用mutate。** 不推荐。

候选表面为read_case_decisions／save_case_decision_draft，分别有界读取当前／准确历史、创建／追加hypothesis或strategy草案。具体参数沿上述字段组，不接Case ID自由选库、owner、user-author、SQL／文件路径、采纳／执行／真实反馈字段。公共上下文从原当轮Case selection及已核对task_context_prepare绑定caseStoreId/caseId/projectId/taskId；无当轮绑定不猜，正常分析继续，Case写能力不可用。Case原入口尽量带准确信息，不新增Case前置表或永久task指针。

普通unmanaged真实任务才开放，直接／合法nested沿同一SDK hooks和M4已验证的call-local ctx存续资格；原公共lease／ActiveRun／manager／signal前后核，Host事务提交前再核Case开放、真实project-link与当前权限。人UI只补明确取舍、关联、归档／恢复小入口，完整正文编辑器延期；不能让Agent自报user。managedordinary仅沿既有已核固定输入；cold/fixed/sealed/plugins不增工具或主分析材料。**Agent Case工具资格、原会话发送资格、人的独立Case写权限分开判断**：profile封闭只阻止新增Agent工具，不禁止有权限的人在原Case UI作取舍；原生会话资格未知可暂停该会话发送，但不自动冻结人的独立选择。Case结束／存储不可用不授Case写权，普通分析是否继续按原任务入口／权限决定；项目归档仍沿原全局只读，不教用户关闭保护。

写operationId由Host沿原命名空间方式从真实owner/request/toolCall资格派生，用户UI仍用原UUID；模型不必填写机器ID。业务SQLite回执证明草案保存，原生只证明实际给Agent的内容；nested无独立正文不等于业务未保存。提交后取消或ACK失读保留已提交草案并查原operation，不新两阶段提交／准入账／运行代际。一次tool保存一张卡，不强制先查／后写／再总结或每次凑条数。

## D07：原SQLite最小升级与可实行回退

**建议A：沿原CaseStore同库schema2，新增一张修订表并最小扩原receipt／event枚举。** 原因：同一Case事务、身份、外键和操作权威，无侧库双写／初始化／缺失判断。**替代B：独立侧存储以保持旧程序原样读取；C：只用无类型notes。** B可行但新增另一存储身份、准入／损坏恢复和跨库一致性，C不足以满足准确关系。

**明确代价：原schema1程序严格比对全库存，不能读schema2。推荐A并不承诺直接回退旧二进制。** 确认后必须先提供／验证“能读schema1/2、关闭M5仍可维护原Case”的兼容回退版本，再允许任何真实环境首次迁移；恢复旧DB备份覆盖升级后的新Case工作不是回退方案。

候选物理合同（本轮不建表）：

| 对象／字段 | 含义与约束 |
| --- | --- |
| case_decision_revisions | 一行=某Case卡片的一次不可变修订；无head表，以同record MAX(revision)投影当前。record_id TEXT UUID、revision INTEGER>0为复合主键；case_id FK cases.id ON DELETE RESTRICT；kind TEXT hypothesis/strategy。record的case_id/kind永久固定，同事务MAX+expectedRevision追加连续版。 |
| 内容／来源 | payload_json、refs_json、origin_json为上述完整可解码JSON，非空；lifecycle active/archived；created_at技术ISO；operation_id唯一且FK原operation_receipts。无新业务storeId，沿原CaseStore身份。索引(case_id,record_id,revision)支持Case列表/历史，無向量/语义索引或新唯一标题规则。 |
| 原operation_receipts | kind增case_decision_save／case_strategy_choice；其余列／phase／幂等权威保持。原结果回读优先，保存不靠另一张receipt。 |
| 原work_events | event_type增case_strategy_choice；人的choice用原事件和Casecore序列，原actor/user含义不变。Agent归属只在新revision.origin，不把原user事件伪装为Agent行为。 |
| 原表／marker | 保留所有原Case／link／artifact／work／receipt／event行、ID、JSON原文逻辑值、约束和FK。Case marker编码formatVersion1与storeId不变；SQLite user_version=2，不能把两者混成同一版本。 |

GET／打开／历史读取只识别已知v1/v2并只读投影；v1无M5行可显示尚无记录，不猜迁移成功。首次明确M5保存草案或人的取舍才在已获准实现／部署内触发升级；不另设使用前初始化按钮。严格库存只接受已知schema，未知表／trigger／损坏不删除凑通过。

两旧CHECK表重建及新表在同一SQLite事务按外键依赖迁移，前后核原逻辑行、storeId、完整性／foreign_key_check及严格库存；使用原备份／事务能力，不自建恢复引擎。仅确认未提交且ROLLBACK成功才能说回到v1；COMMIT/IO/中断后不明须重新只读核knownschema/storeId/完整性与旧行、保留UNKNOWN并停止新写，不承诺自动回原版或自动恢复备份。源码回退≠数据回退，新M5记录保留。

## D08：可读、关闭、归档与验收

**建议A：精确旧版一直可读，权限／格式失败具体反馈，当前治理与专业判断分开；按实际链路验收。** **替代B：为流程整齐自动清理旧记录／重评／换源或用测试全绿代用户确认。** 不推荐。

Case关闭／项目归档按原准入拒新写，历史只读；卡片归档/恢复只经人的入口追加版本，Agent不能隐式恢复。来源缺失/变化/unsupported显示当前状态，不重写当时陈述／选择/行动。没有M5记录与历史读失败分别显示；不解析旧notes批量回填，不迁移RAP/Board数据。

接口沿原Case路由提供read、saveDraft、choice及原operation读回；Case读／历史不启动Agent／Provider或写native。资料／旧记录文本作为有来源参考，不升级系统指令。输出预算复用M4的原生20文件/50MiB和模型文本32768 UTF-16/256KiB；目录默认20/max50有界页，限资源不是工具次数。

确认后先真实公共行为RED，再最小实现与GREEN；覆盖正常零维护/无Case、直接nested与旧ctx/取消晚到、伪user/跨Case/closed/归档、旧ref失读、choice跨版CAS与历史不涂新、部分提交/ACK原意图、全部迁移/回退反例及原消费者。UI动态门槛不以SSR或fixture失败替代。固定完整候选、适用npm run check、真实隔离Host/Pi/合成Provider/Case/native/UI、全新非作者和四原则专项；真实经营试点/外部派发/模型质量/运行采用另授权。准备阶段只点验虚构Demo，不称这些已验证。

## 决定台账与分类

| 项 | 推荐／原因 | 用户决定 | 状态／证据 |
| --- | --- | --- | --- |
| D01 Case归属／零维护 | A，补业务含义不建全局双库 | 待整体确认 | 主线；CD01/02及现状审计 |
| D02 稳定ID／独立修订 | A，保旧史且少填表 | 待整体确认 | 主线；Case散文不足 |
| D03 准确关系／作者影响 | A，无图引擎／Host真值 | 待整体确认 | 支撑结构；原精确refs |
| D04 人的精确取舍 | A，独立于Agent与Board状态 | 待整体确认 | 主线；原Board无完整选择史 |
| D05 原行动／反馈 | A，保持单一权威 | 待整体确认 | 联合ReadModel；原Board/Feedback |
| D06 原Pi及窄adapter | A，只补真实Case写口 | 待整体确认 | 支撑结构；Pi1.4.0及当前Case binding |
| D07 同库schema2／兼容回退 | A，复用事务并明示旧程序代价 | 待整体确认 | 支撑结构；完整库存校验实证 |
| D08 保全／实际验收 | A，权限保护与自主并存 | 待整体确认 | 验收合同；既有M31/M4边界 |

无新消息库、全局Asset／Onto实体、DuckDB／Semantica／向量服务、多租户/IAM或后台任务。M6模式成熟与M7增强另分期。**请整体确认本v0.1 spec、D01–D08及UI Demo；建议均A。未批准前不实施产品、持久结构或迁移。**

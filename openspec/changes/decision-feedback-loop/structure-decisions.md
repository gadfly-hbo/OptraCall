# 反馈闭环 A：实施前结构决定包

版本：v0.1，2026-10-31。状态：**用户整体确认七项A，已进入实施**。

用户已通过[spec](spec.md)和[UI Demo](../../../docs/prototypes/decision-feedback-loop-ui-demo.html)，并授权实施 A、检查和非作者复核。本包只补齐 spec 第6节特意保留的结构决定，不重新讨论已通过的功能。B/C 后置，不切换运行服务、不操作 MacBook，不重放旧任务。

依据：当前 `main` b36a42b；原 Board schema1、ProjectStore、需求 YAML 0.1、CaseStore、统一会话 Interface v1。只读核查见工作树 `.local/decision-feedback-loop/implementation-preflight/` 下两份 inspection；当前基线 `npm run check` 543/543 通过。

## 大白话要点

1. 反馈每次另存一版，过去的内容留下；旧系统覆盖掉的内容不编造回来。
2. 开始复盘时保存“这次选了什么、实际带了多少文字”。普通资料文件还能修改，但不会悄悄改变过去的提供记录。
3. 创建中断先查原操作；创建过的任务／需求继续使用，绝不通过多建一个或覆盖用户草稿来假装恢复成功。
4. 复盘仍是普通分析任务。Host 送材料、记来源；Agent 自己判断如何分析，允许结论是未知、负效果或旧经验不适用。
5. 保存 Case、采用资料、修改判断、发布新需求是各自明确操作，不自动替用户完成。

## 第1项：权威与关系保持原域，反馈追加修订

**建议 A：** 反馈仍归原决策看板 SQLite，在原库事务扩展到 schema2，仅增加反馈修订表和必要唯一索引。原 reports、extractions、board_items、board_tasks、task_feedback 五表 DDL及既有行保留。一个 Board task 有零至多版修订；最新按任务内递增序号取得，不另建当前指针权威。

修订的批准逻辑字段组：

| 组 | 含义、类型与规则 |
| --- | --- |
| 身份 | revisionId UUID；boardTaskId 沿原 UUID、RESTRICT 外键；revisionNumber 正整数；每任务序号唯一，不因删除／重启复用。源 projectId 经 task→item 查得，不信任客户端替代。 |
| 保存意图 | 新保存 operationId UUID 全库唯一、canonical payload SHA256；旧首个已知版本两者可空。客户端意图不等于分析 requestId。 |
| 业务正文 | adopted 必须明确 boolean，仍指“是否按建议执行”；outcome／metricDelta／review 沿原执行记录／指标回录／说明含义，字符串上限仍为4000／1000／4000 UTF-16，可空串，不能推导事实。score 为1–5整数或 null；null 是未填，不是0或默认中分。 |
| 效果 | effect 为 unknown／positive／negative／none，与已通过 Demo 一致；默认 unknown，其他值也只代表用户判断、未经独立验证，不按分数推断。 |
| 时间与来源 | savedAt 为本次保存时间；origin 为 user-save 或 legacy-current。旧 legacyCreatedAt／legacyUpdatedAt 保留原时间，旧确认人未知，不补造。新记录无身份系统，不编造操作人。 |

旧每条 task_feedback 在同一升级事务内复制为唯一的首个已知版本 v1，origin=legacy-current，effect=unknown。若原 createdAt≠updatedAt，只能称当前正文在原 updatedAt 已知，不能声称它在 createdAt 就是这份正文。无旧反馈不补造 v1。原 task_feedback 保持基线，以后不再覆盖；当前读接口投影新修订。历史不提供改写／删除入口。

保存顺序：规范化校验→查 operationId（同载荷返回原版，异载荷409）→核 expectedLatestRevisionId（无版显式 null）→追加。先查意图再查最新，避免后续有新版本时把原成功重试误判冲突。并发冲突保留输入，用户对照后新意图保存。未知执行情况不能存为 false，可不保存反馈直接提问。

**原因：** 保持原业务权威和旧值，解决覆盖历史，同时不引入另一个反馈系统。

**替代 B：** 独立反馈文件权威；将需要额外同步／查询原 Board，不推荐。

## 第2项：一次交接与实际提供独立记录，固定正文与普通文件分开

**建议 A：** 新增独立 Host feature 目录 `dataRoot/decision-feedback/`，使用逐记录原子 JSON，不增加 Case 表或第二套会话。分别存 handoffs、operations、deliveries；记录 schemaVersion=1，身份均为 UUID，文件名由 Host 生成，客户端不得提供路径。未知版本／损坏不重建、不忽略，应保留并明确报错。目录0700、文件0600，拒 symlink／多硬链接／路径穿越，排他预定身份、临时写入 fsync 后原子替换；同一操作写入沿原 Host mutate gate 串行，并使用排他写锁拒绝第二写者，崩溃锁先核查，不自动重放。

| 记录／字段组 | 含义、必填／可空及关系 |
| --- | --- |
| handoff 身份 | handoffId、createdAt、sourceProjectId、boardItemId、boardTaskId 必填；反馈 revisionId 可 null，明确“未取得反馈”；原 reportId／extractionId 可 null，沿原身份。一个修订可被多次显式交接，无全局唯一 Case。 |
| 所选 Case | caseId＋expectedRevision 一起存在或一起为空，默认无 Case；检查实际源项目关联及 Case 可继续。只是这一次选择，不改 Case 归属。 |
| 来源快照 | 原建议／任务与所选反馈当时值；原抽取固定报告片段及其已知 sha／bytes／范围，未知仍空。当前文件观察另列，不能覆盖抽取来源。RAP／SAP 仅保存确实可获得的身份，缺失未知，不伪造关联。 |
| 适用条件 | sourceNature=unspecified／actual／synthetic（未标明／用户回录／合成演练），放在本次交接，避免产生第二份可编辑反馈权威；观察期、适用范围、未知／限制为可空自由文字，各最多4000 UTF-16，不强制用户填齐。 |
| 问题与选材 | 初始问题沿普通 draft 上限20000 UTF-16；所选材料列表含稳定 materialId、sourceKind、来源身份、mode、技术观察、正文／范围；不包含分析方法、必填结论或执行顺序。 |
| target | 原 projectId＋普通 taskId；planned 与 confirmed 分开，只能绑定实际创建来源匹配的任务。后续 requirements 使用原 instanceId。 |
| delivery | deliveryId、handoffId、真实 target owner、requestId、providedAt、实际请求 fingerprint、实际选材及正文快照、实际可得 native session 身份；只有实际提供可标 provided，accepted／completed／采用／效果验证分开。发送准备中或响应未知不能标已提供。 |

固定正文是本次运输记录，只能作为“该版在该次选择／发送时的副本”，不能独立编辑成新反馈。普通 `020_clean` 文件由用户明确选择另存，供 Agent 自主读；记录其相对路径和初始 SHA／bytes，之后可变化，不能称不可变。仅引用材料没有正文，如实显示“本轮未主动提供全文”。清空全部选材仍允许普通提问，导航来源不得偷偷变回正文。

**原因：** 不污染原项目大 JSON、Case 或需求契约；保存实际提供内容，又不把普通文件包装成隔离沙箱。

**替代 B：** 全部塞进 ProjectStore 或 Case；会放大共享主记录和无 Case 依赖，不推荐。

## 第3项：正文捕获、限额、范围与变化

**建议 A：** 沿用原项目文件准入，仅捕获用户显式选择的 `020_clean`／`060_reports` 普通文件；不读取010经营数据。最多16项材料，每个来源文件不超过原上传10MiB，实际附带正文合计不超过64000 UTF-16；完整发送还必须满足原131072 UTF-16 envelope 限额，和其他 RAP／企业资料合并超限时要求用户减少选材，绝不静默截断。JSON记录最多2MiB；问题及初始 draft 仍20000 UTF-16。

正文严格 UTF-8 解码；不归一化、不改换行，BOM 如实保留。文件名／扩展名不作为“已解析内容”的证明；二进制、不支持解码、超限只可取消、仅引用，或用户明确选择可提供的文字片段。片段采用原解码字符串从0起的 UTF-16 半开区间 `[start,end)`，禁止切开 surrogate pair，显示范围／总长度及片段 SHA；正文 hash 按实际提供 UTF-8 字节计算。回复来源同样记录实际消息身份与明确范围，不只存路径。

从同一安全文件 handle 捕获 bytes，并核对读前后 inode／dev／size／mtime／ctime 与实际 hash，不用“先观察路径再读”假装同一内容。预览只读，不持久化业务意图；提交创建／发送前核同一选材身份。所选反馈旧版即使出现新版也保持旧版，只提示有新版；用户改选才生成新预览。路径源变更则重新预览确认，或用户明确删去／仅引用／限定旧片段继续，不自动换最新正文。历史 delivery 固定，不因当前文件变化重算。

**原因：** 限制是传输与存储保护，不规定分析模式；让全文、片段、引用的证据边界可验证。

**替代 B：** 超限由 Host 自动摘要；会改变业务含义且无法证明全文，不采用。

## 第4项：稳定创建、原意图查询与部分成功

**建议 A：** operations 只负责本功能的显式创建／另存意图，不建立通用工作流引擎。必填 operationId、kind、source owner、canonical requestHash、createdAt／updatedAt、planned target identities；保存各项结果与错误／未知原因。状态为 prepared／completed／needs_review，分项明确 pending／succeeded／unknown／failed；这些是技术状态，不是经营效果。

在首次写目标前排他保存意图和稳定目标 ID。普通任务扩展原 ProjectStore 的窄内部创建入口：预定 task UUID、初始 draft、可选 feedbackOrigin（handoffId、operationId、requestHash）与配置在同次 project metadata 原子写内保存；旧任务无字段，不迁移。既有 createTask 默认行为不变，不接受客户端任意 sessionFile／路径。返回已创建任务时绝不再次 saveDraft 覆盖后来编辑。

新需求沿原 `req-…` 格式预定 instanceId，初始 title／scene／context 在原 YAML 保存；新增仅本功能的 creation-origin sidecar，含 operationId／handoffId／requestHash，不改 YAML 0.1 根字段或 RAP 0.2。新实例用同一文件系统内暂存整目录后排他发布；暂存目录放在实例枚举范围之外，发布必须拒绝已存在目标，不用普通 rename 覆盖。原有实例不补文件；发现已有目标必须核创建身份，否则 needs_review，不能凭同名推定成功。

相同 operationId＋载荷返回／查询原结果，异载荷409。GET 只观察原意图、原目标／原文件与身份，不创建或发送。中断后发现目标可见但缺完成记录，显示逐项证据和待核对；用户明确继续时仅续接能证明尚未完成的步骤，不另分配目标、不覆盖草稿、不删目标／文件补偿。重启只呈现未终态，不自动运行模型、复制资料或恢复旧任务。

020另存有独立稳定文件名和创建意图，排他写；回包丢失先查已知文件身份，不沿原上传重名逻辑创建随机后缀。任务已创建／资料已保存／请求被接受／分析完成／需求已创建／Case关联各自显示，部分成功不冒充全成功。

**原因：** 原 createTask／createRequirement 都随机建新对象，不补此接缝无法可靠处理丢回包。

**替代 B：** 提示用户自行在列表找重复，创建不做持久去重；无法满足FC16，不推荐。

## 第5项：公共会话只加可选材料与回执，保持普通 Agent

**建议 A：** 复盘继续 owner=原 `{projectId,taskId}`、profile=`project-tasks`，绑定原配置；需求继续原 instanceId／requirements-elaboration 的独立 owner、空工具默认、原启停恢复入口。Interface 仍v1，增加兼容可选的 feedbackContext 请求与 providedContext.feedback 回执，不新建 Runtime、profile 或推理循环。

普通发送通过原 server message→公共 lease／ProjectAgent→native prompt 接缝，feedbackContext 只携带 handoffId 和明确 material selections／条件，不信任客户端传来的其他项目正文。Host 校验 target 真实归属、固定来源及准入，组装用户明确选的文本和中性来源说明。draft 只存可编辑问题，材料单独显示，可全部取消。不能修改 Agent 工具、强制 skill、规定计算公式／分析顺序／报告章节、要求必须给确定结论或自动找另一 Agent 兜底。

request fingerprint 必须覆盖真实 owner、原问题、所有实际所选正文／范围／引用、Case选择、RAP／企业资料并存选择。反馈单独选材也必须生成 fingerprint；同 requestId 异载荷冲突。沿原 `optracall.run` 的 provided-not-adopted 回执追加可选 feedback 组，含 delivery／handoff身份、材料技术身份／范围和实际正文记录定位；旧 JSONL 不回填，无字段保持未知。delivery 与明确 requestId／native session 关联，不把当前 session 的历史列表当全部分支历史。

“已提供”以原 native started／provided marker 或等价的实际 prompt 调用证据确认，HTTP 202／任务创建不能将 prepared 升为 provided；它仅证明请求实际带入。工具可观察读取、Agent声明采用单列，证据不足未知。普通 full-tools 环境继续由 Agent 自主使用；Host 记录逻辑固定不等于 OS 防修改隔离，若记录／文件被改则明确损坏／变化，不回写旧字节掩盖。

**原因：** 复用同源会话和回执，闭环只补材料和追溯，不增加分析管制。

**替代 B：** 新建复盘专用方法／封闭工具链；偏离产品原则，不采用。

## 第6项：需求与Case显式承接，不自动变事实或采用

**建议 A：** 用户选择明确的普通复盘回复／报告及范围，Host从真实 owner 的历史／安全文件读取；正文放入新需求原可编辑 background，来源另存 handoff／operation。沿原单字段100000 UTF-16和整体4MiB YAML限额，超限要求明确选片段，不能只给空工具需求Agent一条路径。facts／hypotheses／snapshot／releases 不自动写；生成、确认、发布继续原操作。可编辑工作背景不是不可变原文，固定来源副本独立保留。

Case 默认无，最多选一个真实关联且可继续的 Case 和 revision。关联复盘报告、采用副本、编辑当前判断分别使用原 Case API／CAS／operation receipt；编辑判断展示旧新值，不能自动采用整份报告。已保存060报告才用文件关联；仅回复可先显式另存报告，不由 Host 猜最终报告名。Case history note 不是自动选材；下一轮从原Case／项目明确选择材料，经同一正文／片段／引用规则及实际提供回执继续，允许 Agent 判断条件不同不适用。

反馈入口的写操作统一核源项目 active／archiving，以及所选 Case 关联、closed、revision。关闭Case需原入口重开；可改选无Case但不能绕过项目归档。Case通用文件关联补与已有采用入口一致的 active 准入；读取旧记录／回执仍允许。共享Case的其他项目不因本项目归档被批量限制。保留所有原看板入口、抽取、筛选、建议采纳／驳回、人工建议、任务、统计及原反馈入口。

**原因：** 历史可以承接，但进入下一轮、改判断、发布新需求均需用户明确选择。

**替代 B：** 自动发布RAP／企业资料或批量更新Case；会把未经验证内容变成事实，不采用。

## 第7项：兼容、保全、失败与验收

**建议 A：** 新反馈写接口沿原路径，但要求明确 operationId／expectedLatestRevisionId，拒缺失意图的旧写请求并提示刷新升级，不静默生成随机意图后声称可去重；原字段与读路径保留，新UI完整支持，score新增null。旧版代码遇schema2拒写；回退只用能读新结构的兼容代码，不降级库／覆盖备份。

升级前核已支持的schema1对象／DDL，事务内新增表和首个已知快照，最后设置user_version；失败全部回滚、连接关闭、原库保留，不重建空库。原SQLite物理字节因合法新增会变化，保全核原表DDL／既有行；现有项目、任务、draft、sessionFile、JSONL／父链、文件和发布物保持原位，正常显式新增另计，不宣称修改后的项目metadata全文件摘要不变。

测试沿已通过spec第7节的真实UI／Host HTTP／公开Store／公共SDK入口，TDD按垂直切片先取得实际RED；只替代外部Provider边界观察实际送入材料，不以绕过路由写DB代替验收。隔离合成目录验证旧库升级、重开、丢回包／去重／冲突、部分成功、所有Case选择／归档、全文／片段／引用／取消、材料变化、原看板全功能、普通会话启停／配置／迟到结果及下一轮条件不同。模型检验按已批准验收范围使用合成资料及真实普通Agent，原专业质量FAIL／UNKNOWN保留，B/C不提前优化。

最后运行适用检查并做新鲜上下文非作者独立复核，问题修复后复验；工程检查、模型表现、Git／CI、运行采用和用户验收分别记。当前实施不自动部署、切服务、操作MacBook、取真实经营数据或执行经营动作。

**原因：** 保留原证据和工作，明确工程闭环能证明什么，也使旧客户端失败可理解而不悄悄丢历史。

**替代 B：** 允许无意图旧写继续覆盖／后台重放或用备份回退；会损害新历史或去重保证，不采用。

## 决定账本与整体建议

| 项 | 推荐 | 主要理由 | 用户决定 | 状态／证据 |
| --- | --- | --- | --- | --- |
| 1 反馈权威与修订 | A | 原域追加，保留首个已知边界 | A | CONFIRMED；spec FC02–04及原schema1 |
| 2 交接／实际提供记录 | A | 固定本次材料，普通文件仍可变 | A | CONFIRMED；FC05–10/12 |
| 3 捕获／限额／变化 | A | 如实区分全文、片段、引用 | A | CONFIRMED；FC06–09及现有限额 |
| 4 创建／去重／部分成功 | A | 原创建缺持久幂等，不能重复目标 | A | CONFIRMED；FC16 |
| 5 同源会话与自主性 | A | 只扩材料／回执，不扩分析管制 | A | CONFIRMED；FC10–12、Interface v1 |
| 6 需求／Case承接 | A | 原实体和显式操作，防自动变事实 | A | CONFIRMED；FC13–15/17 |
| 7 兼容／保全／验证 | A | 保留旧工作与失败，分开证据范围 | A | CONFIRMED；FC18及工程规范 |

**整体决定：七项均采用 A。** 用户回复“七项均采用A，继续实施”，已开始结构／API／迁移和实施测试；如需调整，按项号记录修改，不更改未受影响的已通过功能和UI。该确认完成 spec 第6节的实施前结构门，不增加B/C范围。

实施前非作者复核无阻塞；已纳入暂存目录不可枚举／排他发布及实际provided证据两项澄清。上述七项由同次用户整体回复确认。

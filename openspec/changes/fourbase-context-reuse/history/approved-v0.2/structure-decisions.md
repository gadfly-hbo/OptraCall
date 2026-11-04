# M4 v0.2 最小决定包

2026-11-03 · **四原则重审后6组推荐A，均待整体确认；未实施。**

详细共同原则只维护在[工程规范§2／§3](../../../docs/engineering-workflow.md#四点产品原则)。[spec](spec.md)、[四原则验证](principles-review.md)与[Demo](../../../docs/prototypes/fourbase-m4-reuse-ui-demo.html)一起审阅。v0.1未被用户批准，原包见[历史](history/v0.1/README.md)；本版删去证明协议与非必要操作，保留准确来源／权限／治理／只读／取消／预算。

## D01：默认目标与入口

**建议A：正常工作默认不增加记忆操作，Agent同任务自主找／读；人指定资料为可选。** 原因：核心收益应减少重复解释，不变成新的资料搬运作业。**替代B：个人页先找／先选才进入新工作。** 会把维护成本转回用户，不推荐。

普通unmanaged主分析获得两项可选读工具，零调用／引用／拒用均正常；不强制先查后答。受管ordinary可沿原准备路径接人选固定文本，不获得新自助执行权；独立核算／冷读、fixed-draft／text-only、业务插件不是M4目标。个人页与历史不开Agent。当前profile不支持时如实说明，不教人解除保护来换便利，也不因源项目归档自动判断经验无效。

## D02：来源身份与最小交付字段

**建议A：沿原精确对象，加最小业务元信息；原生消息承担实际内容。** 原因：来源不能跳到新稿，但无需让模型携带新的证明指针。**替代B：新正文库／通用delivery协议，或只按标题／materialId取最新版。** 前者重复权威，后者漂移，不推荐。

| 逻辑字段组 | 明确合同 |
| --- | --- |
| 人工target | `{type:'retained',storeId,materialId,decisionId,revisionId,expectedBodySha256}`；全部必填非空，decisionId沿M3原operationId，hash为64位小写SHA-256。不新编号、不凭materialId当前决定代替。 |
| 候选target | `{type:'agent-candidate',candidate:ExactCandidateRef}`；完整沿M31六字段和原occurrence，viewer/fork不换身份。 |
| find输入 | query≤200字符、默认空；kind=all／knowledge／experience默认all；includeArchived默认false；总pageSize默认20最多50；一个有界opaque continuation默认null。只查标题／别名／范围，暂不新增Agent全文扫描；没有语义排名。 |
| read输入 | target必填；part=content／corrections／source默认content；source需该准确对象已有sourceRefs内的sourceIndex（非负整数）。准确片段沿原UTF-16半开区间，默认有界正文及可继续位置，不切代理对；不接任意sessionFile／dataRoot路径。 |
| 实际可见内容 | SDK工具content中真实的目录／原文／片段、最新单条独立纠正、来源范围／局限。目录不带正文；正文片段注明范围及续读，未知范围／时间用null，不以技术时间代业务时间。旧注记可按需读。 |
| 最小details v1 | `schemaVersion:1,type:'optracall.personal-context-delivery',action:'find'|'read'`；items按本次实际payload顺序，合计0–50项；partial布尔、continuation字符串或null、issues为技术code与可核ref（未知ref不猜造）。不含第二receipt定位块／声明专用payload hash／deliveryRef／nativeProof。 |
| item元信息 | 准确target、part=catalog／content／corrections／source、extent=metadata／fragment／full、range或null、来源状态／局限。candidate核当次governance（targetRevision≥0、最新纠正operationId或null）；retained沿准确decision并另标归档／Enterprise启用状态。不将这些当业务真假评分。source时保留准确M3 sourceRef；仅二进制／不支持文字则extent=metadata，不冒称OCR。 |
| 人选personal回执 | 沿既有providedContext可选personal v1字段，仅记录准确targets、实际范围和当时治理／纠正元信息；正文在原SDK prompt。旧调用缺省无本项。request/session/toolCall/entry由真实SDK、run marker与原记录定位，不让人／模型填写新证明串。 |

只有实际原生消息中保存的content／user文本才可按该范围展示；回调返回或起始metadata孤证不算。历史从原native派生位置与技术hash，无需为模型新增可见定位块。源版本hash仍保留；任何派生hash都不能当真假／OS身份认证。正文保留在其M3/M31权威，原生交付文本只是当时历史，不是新候选库。

## D03：Pi执行方式与Host只读口

**建议A：两项SDK customTools＋原IPC最小search/read业务port；直接／嵌套沿真实SDK上下文。** Host函数不能随现options序列化，现通道没有反向业务读口，缺口已核实。**替代B：新记忆服务／MCP、整库snapshot或driver整dataRoot读权；或为日志强制直接调用。** 增服务／权威、越权面或限制Agent正常组合，不推荐。

Interface v3业务子集和project-tasks owner／lease／配置／ActiveRun／manager不变。模型只传业务参数，真实owner、child、SDK ctx、run和signal由可信代码绑定；两侧await前后核当前资源，取消／关闭时清理短期IO关联和迟到结果，不重放模型。短期transport correlation只为回包，不是新业务ID、代际、准入账或Agent队列。不向读port开放收藏／纠正／排除、配置、跨owner管理或任意路径；不加reportIdentity。

Pi1.4.0已支持ctx.executeTool及校验／权限hooks，子结果不单独入transcript、parent nestedCalls只有有限元信息。新M4读口不因记录不完整普遍拒合法嵌套：直接成功结果按实际native正文展示；nested只展示原生真实保存范围，子正文未单独记录就UNKNOWN，不说读取未发生、不强迫再直接读。新Host绑定是否足以安全支持nested，确认后先用真实SDK合成验证；不能信任模型自填ctx。若确有权限／取消缺口，补具体最小决定，不以证据格式方便代替理由。不改变已批准M31候选保存合同，也不借此放宽受管／冷读。

## D04：可选人工路径与少操作

**建议A：准确当前任务一击加入，其他任务次入口；默认预算内全文，技术项按需。** 当前App已有active project/task与taskKey选材／草稿能力。**替代B：每次强制详情预览→目标→范围→确认。** 加入当前任务也要重复选择，不推荐。

- 有已明确展示且合法的当前任务时，按钮带项目／任务名称及短ID，一击加入准确引用并回当前工作；原问题不改、运行不启动、消息不发送。无法确定目标则不显示快捷／不默选首末项。不同项目同名按ID区分，点击时绑定显示的准确目标，失效不换另一个。
- 其他任务直接开选择，无需先强制预览；新任务沿原创建入口后再选入，不新建handoff Store。目标归档／不支持profile明确禁写；可选预览、纠正、排除及查看来源都不是普通分析前置。
- 选材仍是原taskKey内存引用，刷新不保证恢复；问题草稿沿原保存。默认准确全文加读取时最新纠正，预算外明示，不静默截全文；准确片段和完整ref／hash在高级选项，用户无需填写机器身份或每次挑技术范围。
- 正常原任务显式发送。人明确选材失败时保留问题与选择；只有已确定请求未接受且列明坏资料时，可一次明确“移除不可用资料并发送”。这是人主动撤项，不是Host静默丢材料；ACK未知／已接受、目标归档、权限或profile错误不能走该捷径。
- 沿原fingerprint及同ID回查，先回读已接受请求，不能因今天来源改变重送；没有新增pending／交接／选材持久账。自主工具失败由Agent自行处理，不默认叫人接管。

操作对比的起点固定：正常当前工作发问新增记忆操作0；从个人列表加入当前目标3→1击，跨目标4→3击，坏资料撤项再发2→1击；这些是方案目标，需原型与产品分别验证，不能冒充已实现效果。

## D05：治理、预算与历史

**建议A：当前供给自动核对，历史按实际原生内容回看，证据不足如实UNKNOWN。** **替代B：收藏才读／每条新注记需重审／排除后清历史／Host裁定新旧谁正确。** 关注不是许可，证据也不能反过来控制分析，不推荐B。

默认人工已保留非归档＋有效非排除候选；未收藏可读。人工Enterprise未启用不等于不能个人保留；人工归档可由Agent includeArchived按历史参考读，来源项目归档只读另标。候选新消费须在M31个人页reader之上另核排除与有效治理，不能把个人页可看excluded当成可新提供。

读取准确原文，自动附当次最新独立纠正；旧意见按需。排除先于本次Host治理快照则拒新提供，晚于不撤已经发生交付／强制停Agent；恢复不修复失读。人的意见不改原文、不自动变事实，过期／争议由Agent判断。技术时点与人的点击分开，不新增跨文件原子撤回协议。

一次search/read或人选准备的嵌套source／fork等原生读取共用20文件／50MiB，不能每target重置；模型可见文本≤32,768 UTF-16，序列化≤256KiB，目录沿原2MiB单文件完整性guard。工具按SDK原有分段／截断／取消方式返回partial与继续位置；业务ref和治理只做最小补口。人的每请求最多8项、沿已有总消息预算，不是任务内调用次数或方法配额；Host不为超额补摘要／替代数据。

当时原文／注记／治理与今天状态并列；一次“查看当时提供”直达真实保存内容，不先迫用户看机器ID。SDK只有nested元信息时显示父调用与子正文未记录，不把未记录当未发生／读取失败。普通回复／报告中作者说参考或拒用是作者原话，保留原文即可，不自动解析成结构化采用关系。

M4触及的native历史口共用现safe snapshot＋公开parser／inMemory投影；旧open调用链须实查改接，源／旧版本／坏行／环／并发增长／超限不迁移、不补写、不回落latest。首次失读无准确ref只报文件级UNKNOWN；旧native无M4字段记未记录，不回填。只读回查无SDK启动／模型请求，旧消费者及原字节／mtime回归。

## D06：延期项、兼容与退出

**建议A：本期延期机器核定的成果—来源声明关系，沿普通作者文字与Pi历史；保留停用／回退边界。** 原因：可先验证第二事项复用价值，而不加第三工具和证明链。**替代B：保留v0.1第三工具及所有deliveryRef/nativeProof/成果hash核验。** 有追溯价值但增加接线和解释成本，尚无首闭环必须证据，不推荐本期做。

不实施declare_personal_context_use、reportIdentity、第二receipt块或声明关系Store。Agent正常回复／报告可明确参考、比较或拒用及实际来源，Host不推断采用；目录／片段／全文的历史交付不等于理解、正确、因果或经营效果。M2既有人的成果来源登记照常，不能改称本模块结构声明已实现；后续有持续机器关联需求，再决定复用M2或单独增量。

停用撤新工具／选材入口，最新native及人的M3/M31内容／治理保留。不新增候选库／索引／模型／后台整理／数据库迁移；旧代码可能不显示personal字段或新details，回退用保留最新记录的兼容代码，不用旧备份覆盖新工作。原材料、历史FAIL/UNKNOWN和M31限定例外保持；M5–M8及真实质量／Git／安装／运行采用另授权。

## 当前决定台账

| 项 | 推荐／理由 | 用户决定 | 状态／依据 |
| --- | --- | --- | --- |
| D01 正常零维护／入口 | A，Agent自助为默认，人选可选 | 已要求四原则，具体v0.2待审阅 | 待整体确认；RU01／RU08 |
| D02 原身份／少量元信息 | A，SDK存实际内容，不加证明串 | 待整体确认 | 待确认；M3/M31权威与Pi原生记录 |
| D03 两工具／Pi组合执行 | A，补真实读口，不为日志限制方法 | 待整体确认 | 待确认；官方nested/hooks与IPC缺口 |
| D04 可选快捷／默认值 | A，当前任务一击，必要目标仍明确 | 已要求减少操作，具体UI待审阅 | 待整体确认；实际App状态与路径计数 |
| D05 治理／有界／只读历史 | A，自动环境保护，未记录如实显示 | 待整体确认 | 待确认；原snapshot／治理／预算 |
| D06 延期证明链／兼容 | A，先验证复用，无机器关系时如实说 | 待整体确认 | 待确认；删减复核与scope差额 |

主线是同任务找／读与第二事项复用；支持结构仅准确source ref、现回执可选字段与最小工具元信息；历史／目录为可重建ReadModel。一个任务多次交付、一次目录多项source；引用不拥有／删除源，排除不删历史。所有新增字段组、空值／默认、读写／时间／身份／权限已在适用组内给出；无新SQL表／索引／迁移、全局唯一业务ID或跨库事务，相关物理决定不适用。具体工程传输语法不能扩大以上业务语义／权限，真有新增持久合同则补受影响决定。

**请整体确认v0.2 spec、D01–D06及UI；建议均A。当前仅方向已接受，未预填具体新合同／UI已批准，不开发产品。**

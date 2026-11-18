# Studio 二期产品实施合同

2026-11-12 · 承接已确认v0.3，不改变产品决定 · 进度见[tasks.md](tasks.md)

## 复用与最小差额

沿工程规范v1.10／IN01–IN07及Interface v3。Pi1.4.0、Semantica0.7.0保持原版本；本地npm ci --ignore-scripts只安装既有lock，不升级／改写SDK。不新建分析Runtime、不把Demo确定性计算器接成产品引擎。专业内容继续由企业资料、SAP指标／方法、Studio语义／映射原权威管理。

企业关系是必要的Host业务元数据，仅保存企业ID和项目／Case／原生资产归属，独立于内容和发布权威。使用 `enterprise-scopes/index.json`，避免占用Studio旧index目录或因旁文件触发旧index缺失检查。旧记录缺省保持未归属，GET不创建和迁移。原生资产身份为authority+id，版本／hash仍由原权威核；初次明确关联后不提供跨企业静默改写。

StudioSystem新增可选enterpriseId及maintenanceOwner／maintenanceHistory，保留原projectId／taskId为历史建设归属。当前执行统一取studioExecutionOwner，工作区、工具资格、草稿、来源读取及公共会话均使用真实当前owner；新维护任务不继承旧lease或原始会话写权。

## 公开接缝

- GET `/api/studio/enterprises`：`{enterprises,projectAssignments,caseAssignments,assetAssignments}`。企业对象含id/name/revision/createdAt。
- POST同路径：`{name,requestId?}`，返回企业。沿原Studio操作回执，准确意图重试不重复创建；UI保留requestId及未知结果，不盲重发。
- POST `/api/studio/enterprise-associations`：`{kind:'project'|'case'|'asset',entityId,enterpriseId,authority?,requestId?}`，返回准确关联；Host核真实对象和已有归属，冲突不改写历史。
- GET `/api/studio/foundation?enterpriseId=...`：企业、systems、已归属items及单列unassigned。item的id是原权威原生ID，包含authority/version/title/status/ref，不能把复合编码当新资产身份。
- 体系创建承接可选enterpriseId，沿真实可写项目创建任务；新任务继承项目范围。普通项目／Case的新建在明确上下文或唯一已配置企业下合理默认，旧对象不因查看而被默认认领。
- POST `/api/studio/systems/:id/enterprise`：`{enterpriseId,expectedRevision,requestId}`，显式关联旧体系。POST同体系 `/maintenance`：`{projectId,taskId?,expectedRevision,requestId}`，核新owner可写且企业相符，必要时沿项目新建维护任务。
- GET／POST同体系 `/contributions`：准确来源任务、report SourceRef、sourceRefs、baseRefs／baseSystemRevision、scope和candidate；只写本任务贡献，不自动写正式源。POST `/contributions/:id/link`：核贡献revision、base、目标语义修订或SAP精确ref，预览和确认保存准确贡献快照，变化时拒绝。

贡献具体类型与公开存储方法以 `extensions/business-plugins/studio/contracts.ts` 为准。局部约定不能直接并为企业标准，SAP候选仍走原主库注册／检查／发布。

## 消费与事实

createStudioSources接收可选enterpriseScope `{enterpriseIdForProject,sourceAllowed}`；SemanticContextService接收可选sourceAllowed(projectId,SemanticTarget)。生产由同一Host归属权威提供；建设例外前另以同源constructionSourceAllowed防止原native资产后来明确归属冲突。普通企业任务只发现本企业准确且合格的正式资产；归属检查不替代原hash／版本／启停／治理／用途检查。

没有配置企业模型的旧环境沿原公开边界兼容；启用企业模型后，未归属项目不能借其他企业资产补默认。原项目明确采用且仍未归企业的旧资产可以保留项目限定用途，不冒充企业标准。资料原件／数据／任务／Case仍守各自原owner权限；企业归属不开放建设项目数据。

unmanaged继续复用原Studio／语义／M2／Case接缝。managed普通任务保留原graph-only语义合同，新增独立声明的 `studioRead: StudioReadPort` 只读facet，只能catalog/read/read-source；schema、worker及IPC都拒写。Host facet固定analysisOnly，即使任务恰是建设owner也不读未正式候选。无权限的M2、Case写或建设动作不因UI统一而开放。

来源证据从本轮实际native toolResult投影，纳入Studio精读及采用声明；沿既有SemanticContextPanel/history，不写平行事件库。目录、读取完整性、作者声明、计算材料与独立核验分开；未知不补造。Case原有本turn回执和逐写资格继续复用，前端不制造采纳、执行或效果。

## 文件归属与验证

| 实施者 | 独占范围 |
| --- | --- |
| foundation Agent | Studio contracts.ts／store.ts、企业目录、Case归属接缝及原操作scope意图恢复、对应行为测试 |
| UI Agent | StudioPage／studio.css／studio-api、App／catalog／反馈／资料目录回执，原专业组件及对应client／SSR测试 |
| consumption Agent | agent接缝、semantic-context-service／studio-sources、依据UI投影、scope／studio-host、跨体系贡献及对应测试 |
| root | server集成、企业默认目录／project-files、专业指标原路由写前范围与指纹门、人查看固定方法来源接缝、公共HTTP／实际SDK集成，任务／结果／证据 |

同一工作树仅按上表不重叠写文件，不并发切分支。每个垂直行为切片先有真正RED，再最小GREEN，保存失败；缺包和测试适配错误单列不冒充RED。原代码保全和合法产品新增分别核对。

产品验收覆盖真实Host／官方Pi／隔离合成Provider／原生文件工具／保存重开／UI及权限、取消、迟到、准确版本和兼容。合成Provider只证明真实工程接线，不证明真实模型自主性或企业会员专业正确性；后续会员主题与实际Provider按有效授权和获准输入执行。完整候选须适用check、全新非作者复核及四原则检查；Git／CI和运行采用分别核定。

## 集成核定补充

管理foundation响应中的systems保留编辑所需完整内容；普通Agent仅取得独立轻量摘要和合格items，不传管理systems正文。catalog的range／complete及continuation绑定准确目录hash，变动拒绝旧cursor；read-source按原ref与实际交付范围回读，不把部分内容补成全文。

原专业指标publish在现有Host mutate门中执行，写前核项目未归档、企业范围与准确expectedPackageFingerprint；成功原主库写入后在同一门登记原指标企业归属，兼容无企业模型的原调用。无scope的旧环境仍保原接口；启用企业模型后，范围未明确或缺准确审核指纹不能向企业标准写入。网络／metadata回执未知仍保留UNKNOWN，原目标存在与原请求成功分开。

Case新建／项目关联沿原operation result_json保存可选企业范围意图；原result形状、schema及操作身份保留。重启后重试只核原native结果并补原scope，不能改按后来默认认领旧对象；历史无scope intent不默认迁移。没有新增全局事务、影子日志或Case门。

新Agent读取遵守当前治理。人回看已固定SAP提炼来源时，显式human-fixed-preview仅核当前资格／治理并返回原固定字节，当前治理另列；不把当前正文替换历史，也不撤掉普通Agent对确认错误版的拒读。

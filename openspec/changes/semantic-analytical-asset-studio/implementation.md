# Studio 首期本地实施记录

首轮本地实现及当时禁令作为历史保留；后续真实模型、交付授权与D1–D3补修见末节及`delivery-spec.md`/`professional-evaluation.md`。

日期：2026-11-07。本轮用户授权本地工程实施；原产品方案和已确认 UI/spec 原文件不改。Git交付、真实数据迁移、服务切换和真实模型实验未执行。最终工程结论见 `result.md`；本文件保留过程及接缝事实。

## 后续交付阶段增量

以上首段及下列本地实施记录是阶段历史。用户后续已授权真实模型专业验收、Git交付及双机更新，准确授权和差额见 `delivery-spec.md`、`delivery-authorization.json`，专业过程见 `professional-evaluation.md`，不改写原暂缓期为已执行。

首次真实建设发现大候选传输缺口；新增 `studio-extractions.ts` 只持久保留官方完整候选及准确技术来源，长结果以明确范围的原JSON分页继续交给Agent。`extract`小结果兼容，`read-extraction`含metadata/实体/关系/全文及原调用恢复；不另存业务权威、不编排分析或重试。最终来源准入与同步返回/不可覆盖提交复用既有Host mutation；worker和临时写入不占该序列。schema2整包摘要及官方provenance阻止简单来源重标，原试验schema1拒绝且不补造。普通owner、跨体系、来源撤回、迟到取消、损坏和不安全文件拒绝。首轮复核发现的最终await撤回与来源重标FAIL保留，修复的红绿证据在 `.local/studio-delivery/extract-transport-repair.md`；独立复验和新材料真实专业结论另核。

正式采用沿用已验证 `semanticConfig.python` 的Host配置，显式 `--studio-python` 优先；disabled不隐式启用，health仅表示已配置且不暴露私有路径。复用双机原官方环境，不新增第二份部署配置、升级Pi/Semantica或改写原图绑定。

第二次真实建设的必要修正仍在原权限和主库内：四个已实测写后超限入口提供有界准确身份，长内容沿既有Store/SAP准确来源以原JSON分片恢复，可变值的摘要不符则停止混页。模型获得现有SAP0.2、结构化图源正文、抽取证据、主题、发布及报告Ref的实际技术合同，无历史业务样例、自动重发或固定工具流程。专业含义仍由Agent核查。

`work-item`不再拥有业务答复字段，已答题意和答复保持。面板以打开时实际题意生成上下文摘要，专用`answers`在原mutation内核当前值；错误绑定返回409且不写业务状态。只更新执行下一步不冲突；已知过期后即使只读刷新失败，保存仍锁定，原题和草稿可核，恢复读取只展示当前题。实际Host合成队列、非作者复核及真实Chrome的RED/GREEN分别保留。全量中CHAT-04一次次轮409原响应码未知；原main和候选均证实持久完成先于公共drain的窗口，仅该测试等待公开idle再发下一轮，未改运行逻辑，原失败与原native保留。

## 输入与保全

开工基线 `98ee477eb1a3f9bdb0d64f1eed7cbb613b4e00bc`，分支 `codex/Semantic_Analytical_Asset_Studio`。`approval.json`记录用户原确认、原评审包位置和逐文件摘要。原始方案及冻结评审输入只读副本在 `.local/studio-phase1/approved-inputs/`，1096个开工tracked文件摘要在 `pre-implementation-files.json`。只在隔离合成根创建测试项目、任务、资料及会话；未启动真实业务根。

为执行已授权工程检查，在当前工作区按原锁文件运行 `npm ci --ignore-scripts`；未改变manifest、lock或SDK精确版本。保留原安装审计输出及两个既有moderate提示，不自动升级依赖。官方 Pi 1.4.0沿原包使用。实际Semantica检查只读使用既有0.7.0环境；446个wheel记录文件摘要匹配，未改原包。路径、版本与检查结果见 `official-dependency-readback.json`、`pi-official-readback.json`。

## 最终产品接缝

- `extensions/business-plugins/studio/`保存体系、主题、工作项、源稿/Binding修订、发布范围与业务关联；不另存SAP公式或方法正文权威。候选、正式、准确历史、已确错治理及来源撤回分别表达。主题可在同体系新增与切换，旧资产主题归属保留。
- `studio-host.ts`只核真实project/task、来源资格、归档、明确操作回执和原Store结果；Agent用原项目Pi工具自主盘点、读资料、建设与检查。`studio_assets`是原IPC能力之一，没有新分析循环、专家队列或逐节点审批。
- SAP候选沿原项目020 YAML、原SAP结构校验与原方法Store保存；集中预览明确准确候选与范围，确认后分别记录Studio源、SAP指标、SAP方法的实际结果。外部结果UNKNOWN先只读原专业主库核验，不自动重发。
- 普通分析仅得到获准正式供给，准确SAP项目采用独立。方法没有新增逐项目启用。原建设项目原始资料不因共享体系而开放其他项目；正式源依赖由Host核当前资格，损坏、撤回及确错不绕过。
- `StudioPage`两主页面和共用`PersonalDialog`使用真实Store状态；原App聊天React节点、draft、观察、send、stop及native归属复用。Metric Factory保留同源专业入口；不嵌入Demo业务数据。
- 原分析反馈按准确native回复及当回合实际读取回执关联源版、数据/报告与图快照；没有使用证据的部分仍未知，不拿current/latest补历史。保存反馈不启动后台Agent；原建设任务明确继续后接手。评估报告及准确新使用来源追加为作者评估证据，Host不打专业分。
- 图是准确正式源的派生表示。每次刷新新不可变快照；构图排除的当前不合资格源有数量说明。选择/回退核原快照、固定输入及来源当前资格；已运行图查询沿原runToken固定快照，不因选择改变。图输出存在与公共资源收尾未知分开记录。

## IN01–IN07及实际owner/profile

Interface仍为 **v3**。

| 接缝 | 实际owner/profile与权限 | 验收范围 |
|---|---|---|
| 主建设及普通分析 | 原`project-tasks`，真实projectId/taskId；原Pi配置/native/工具与生命周期 | 真Host、真Pi、合成Provider工具回合、取消及原结果保全 |
| 官方文字实体/关系抽取 | Host静态profile `studio-semantic-generation`；owner为projectId/taskId/systemId/jobId和原配置准确revision | `text-only`，无文件/工具/skills/MCP/extensions；只接获准准确文本，官方公共provider注入统一Pi；实际typed/structured失败/回退/弱线索保留 |
| 官方构图 | 同一附属公共lease，准备来源、建目录和worker均在已占用期间 | 不open模型；工作进程、来源回核、取消与清理通过原公共域；错误不隐式重新派发 |
| 单任务停止 | 原公共domain的Host-only `closeAll(filter?,ownerMatches?)`新增第二可选谓词，与原busyInScope模式一致 | 旧调用默认全匹配；业务port仍不暴露closeAll；只停止目标task，其他task继续，无新job map/队列 |
| 图读取 | 原`read_semantic_context`、固定runToken与分页source handle | v1兼容，v2正式Studio源资格和当前撤回/确错；历史handle只作被动展示 |

原SDK适配和预算、配置撤销、pending cleanup、迟到回执均沿公共实现。Studio在最后一次异步校验后再同步核当前context与AbortSignal，不能只丢弃迟到回复而留下迟到持久写。清理失败占用不被另起job绕过。Host启动参数 `--studio-python=<已有官方0.7.0解释器绝对路径>`为受信环境配置，不是模型工具参数；缺少环境时明确能力不可用，未假装就绪，本轮不配置任何现有服务。

## 垂直切片与原失败

证据总目录 `.local/studio-phase1/`。有效行为RED、测试准备错误、基线校正和后加characterization分开保留：

- Store/source：`domain-evidence.md`及`domain-final-*`；包括不可变候选/CAS、明确发布、准确历史治理、撤回、资料读取事实、原SAP未发布资格、原来源完整性、候选递归依赖及受限反馈接手。
- Host/Pi：`host-cycle1`至`host-cycle4`；真实404、缺工具、请求身份改变等RED保留。最初operation目录提前建立导致`studio_index_missing`已修；不抹旧日志。
- 完整门店链：`flow-evidence.md`，经真实工具读取、原SAP建设/发布/采用、实际Python计算另存、native反馈、Binding修订、准确再发布及再次使用；评估是合成作者夹具，不是模型专业评分。SAP fixture namespace/measure、上传YAML不支持和工具误名属于准备错误，原日志保留，未放宽原验证器。
- 官方组件：`semantic-evidence/result.md`，真实官方Pi与Semantica公共API、source hash、typed→structured、弱关系、配置撤销、取消等待和失败清理；原v1读取兼容。`graph-prepare-lease-red/green`补准备期真实占用，`graph-inspection-input-red/green`补冻结输入损坏拒绝，`graph-selection-red/green`补准确快照选择。
- 非作者复核先发现来源资格绕过、取消后写入、反馈自授权/伪造出处、图意图身份冲突、前置失败永久UNKNOWN等，逐项修复并保留初轮FAIL。详见独立复核报告。
- UI：`ui-implementation.md`、`ui-browser.md`及截图；浏览器直接检查空态、候选编辑、dirty保护、响应丢失核原回执、资料事实、业务回答、准确发布、原分析导航、缩放/焦点及局部图UNKNOWN。合成状态注入与真API交互分开标注。无真实快照文件的图选择最初500/UNKNOWN保留；Host已修为确定的预检查失败，未改原未知回执。

Python原样discover因本工作区缺旧SC01合成fixture失败（6 errors/12 skips）；原 `python-final-regression.log`保留。按显式env将旧合成fixture逐字复制到新测试根后83/83通过，旧757文件摘要未变；不重建旧图、不迁移产品数据。见 `python-final-complete.log`、`python-fixture-preservation.json`。

## 四原则专项

Host只管理环境、owner、资格、保存和回执；不选择分析方法或给业务真伪打分。主Agent可按材料独立继续、调用或不调用Semantica及原专业工具；必要业务问题按影响集中提出。复用官方Pi、原project-tasks、原SAP/资料/RAP/M2/Case及现有UI组件；新增内容为Studio自身领域状态、源稿/Binding权威和必要薄接缝。创建体系一次绑定当前项目及一条原任务，普通使用一次进入原窗口；未加专家选择、技术项目创建、节点审批、固定专家流水线或六类可靠性全部关闭门槛。

## 验收边界

工程检查、合成业务示例、真实模型专业质量、用户产品验收、Git/CI及运行采用分别核定。原报告/源版保留测试不代表全部实际业务文件逐字重新验收。真实模型专业质量、未见业务材料上的自然选择及FA中依赖这些能力的质量结论仍 **NOT_RUN / NOT_PROVED**；不以工程PASS宣称用户产品验收。本轮不做stage/commit/push/CI/merge、真实数据迁移、MacBook操作或服务切换。

## 原M2及Case来源补充

`studio-original-sources.ts`仅重组原`SemanticContextService.query`准确读取的transport片段。M2数据输入/说明仍归原project/dataset/inputVersion/descriptionRevision，Case decision/choice仍归原global Case store/record/revision；真实caller project/task用于原权限核查，不创造Case写owner。保持原hash与治理，M2说明的record hash不替换为pretty JSON正文hash。缺片、变hash、超过512KB/256原分页显式拒绝，不取latest补齐。Studio不新增这些来源库；图/原语义回执反馈只带当时实际返回的准确来源，不把无hash旧引用伪装成有hash，也不声称读过未返回的全图。


## 后续真实模型发现与交付补修

本轮追加授权以`delivery-authorization.json`为准；三轮实际模型结果在`professional-evaluation.md`逐段保留。D1长技术候选回执与当前来源绑定、D2四类写入回执和业务答案权威、D2-A打开题意CAS/冲突后草稿保全均经真实RED/非作者复验。D3只补普通侧实际发布事实与用途限定，复用原source资格及D2分页；既不根据作者checks判业务真伪，也不把已有采用收据冒充当前原库资格或实际使用。catalog/read/read-source的旧建设进度隔离、长限定续读、外部采用变动、撤回及已治理历史均有独立实际Host/Pi/分页证据。

最终source/test/spec以D3`candidate-v2.json`为准。首个完整检查因中途发现历史资格边界被后续修正覆盖，原退出0日志保留为诊断；最终完整1889/1822PASS/67条件SKIP/0FAIL及构建通过，现有官方0.7.0专项35/35零跳过。原D1/D2/D2-A172项、UI14项及实际Chrome RED/GREEN仍分别绑定其未变字节。D3作者22项/类型及非作者7项、3独立探针/4实际合成Host请求、38PASS/1条件SKIP联合回归通过。完整命令与原失败均在`.local/studio-delivery/`，不进入公开Git。

Interface v3、原project/task owner与静态profile保持；官方Pi1.4.0/Semantica0.7.0原包、manifest/lock不改。Host新增的是准确环境/权限/范围/历史状态供给，不选方法、做公式或计业务分。四原则专项仍限本次接缝通过，不推断既有SDK风险均关闭。原输入文件、模型各稿、已知FAIL/UNKNOWN与未运行保持，整体真实专业FAIL、D3实模NOT_RUN、用户产品验收未执行。Git/CI及实际两机采用按最终PR/收据另核。

# M2结果：同任务多源分析与可追溯上下文

2026-11-03 · 8项A已实施，本地技术检查及非作者复核限范围通过；用户已确认Demo并选择保留M2现状、记录差异，推进M3。

**最新UI审阅状态：** 补交Demo已获用户确认。只读核对存在展示差异后，用户明确选择“保留M2现状、记录差异，先推进M3”；详见[UI审阅说明](ui-review.md)。产品未被改写为与Demo完全一致，也不据此宣称产品验收完成；原spec／8项A确认与实现后截图不追写成开工前UI确认。

补交Demo已完成实际浏览器点验与非作者限范围复核，四组演示发现已修；247份既有source／test／script逐字节保持，产品代码未调整。最终HTML摘要`a5811b1e862d2ba3ccfed6bb216618cb2f92189f9e1c2aee013b2f36e3b4ca66`，实际审阅入口、报告与本轮证据见上述UI说明。随后用户已确认Demo，并选择保留M2展示差异、推进M3确认准备；产品发布仍未执行。

最新状态以上述说明及[M3当前记录](../fourbase-personal-retention/result.md)为准；下列实施准备、首次不通过、待确认和当时下一步描述保留各自发生时的历史事实。

## 已完成的实际工作

- 用户明确“继续模块2”；读取工程规范、IN01–IN07、统一接入、v1.2和M1结果，保留原通过及未验证范围。
- 发现本地main已新增三测算skills，安全快进当前分支到`0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`。快进前后9份原WIP文档逐字节不变，无tracked修改、无其他工作树或运行服务变动；没有fetch、提交、推送或合并PR。
- 新代码图完成索引；两位只读调查Agent核对已有字段／存储／UI和验收路径，补读被图谱排除的Python。明确企业原文修订、SAP发布、同任务多轮、文件与反馈不能重造；新target导入也不能直接当通用数据观察。
- 编写[规格](spec.md)与[8项最小结构决定包](structure-decisions.md)，包括复用企业资料作为轻概念说明、新增项目数据说明／必要固定版本和成果来源关联；未新建ConceptStore／记忆平台。

## 确认前停止线与下一步（历史）

尚未创建／修改产品schema、存储布局、源码、测试或依赖，未运行产品／模型／浏览器测试；没有产品RED／GREEN可报告。原M1的49通过不冒作M2新增能力通过。

按已加载结构skill，确认包完成适用文档与非作者复核后请求一次整体确认；确认后进入M2实际TDD与正常路径实现，不启动M3–M8。未授权真实模型／业务资料、组件安装、运行切换、Git交付或MacBook操作。

## 确认前文档检查与非作者复核（历史）

结构确认包已准备完成，可供用户整体确认；M2功能仍未实现，8项均未批准。12份本工作包／历史文档的137个本地链接及1处历史锚点、行末空白、代码块、MC01–MC10／M2-D01–08标识和允许路径检查通过；主方案、M1三份固定文档、原研究与历史候选摘要不变，tracked产品差异为空。

未参与任何候选创作的全新上下文Agent `m2_structure_package_review` 先从主方案、工程规范和结构skill导出预期，再只读复核包的完整性及原代码合同。首轮对结构包v0.1为“不通过完整性复核”，原摘要`d698768a4b7fecbf8db9d9b75c5758c1a96a938730e915d52c09b9ab8aff3ba0`和候选manifest保留；这不是产品实现FAIL。

| 首轮发现 | 修正与重验 |
| --- | --- |
| 确认如何落入只追加修订、旧确认如何继承未明 | 确认保存新说明，只确认本次所选条目，新修订不自动继承；旧确认留旧版，普通分析不要求确认 |
| 可变index与精确旧版权威、按哪一输入版选说明未明 | 索引按inputVersion保存当前说明指针，历史必须精确ref；更名／换源不改旧provenance，错配拒绝 |
| 操作身份／指纹／结果字段和部分失败重试未明 | 目标记录保存operationId／kind／fingerprint／base revision／resultRef，索引提交才成功；未提交保持UNKNOWN，显式同ID重试有严格条件 |
| CSV／JSON计数、Pointer基准及完整／部分／未知关系未明 | 明确逻辑记录不含CSV表头、JSON对象数组／单记录Pointer、复杂形状限制及计数null合同，不把声明合法当已扫描 |

父spec“当前M1”语境同步修正为已完成M1／当前M2准备。定点重验后，另将“同内容复用”明确为选择已有版本，不生成新保存操作或给旧记录补operationId；新固定操作使用新UUID，不引入隐藏去重台账。最终限范围通过，无剩余必须修复项。

最终复核身份：HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`；M2 spec SHA-256 `d17f5dd6f8be5c8d72e9d330e3791ec41860e6e5d84b8021edda8821995f8eef`；结构包v0.2 SHA-256 `1af185f05c5baa0d40a48a64828bfb6d75a486bb683f13077545348ff8407100`；父spec SHA-256 `4e7532c6159b99912058183ea91752b0ed64b51d498dbe81aebd6f2187d1b57c`。原始、修正及最终候选清单在本机`.local/fourbase-modules/m2/structure-*-manifest.json`。复核后仅收尾本记录和父进度记录，规格／结构正文保持固定身份。

职责／复用检查在方案细化范围内通过：沿原资料修订表达轻概念、SAP维持唯一口径、Pi持有会话与执行，Host不扫描推断业务含义、不编排分析／补算，仅核材料、权限、格式与保存。本结论不替代确认后的实际代码、目标／兼容测试或完整产品验收。

## 用户整体确认与实际实施

用户明确“8项全部按A实施”，M2-D01–08均一致／已确认。已保存确认时的v0.2精确快照`.local/fourbase-modules/m2/approved-structure-v0.2.md`，SHA-256 `1af185f05c5baa0d40a48a64828bfb6d75a486bb683f13077545348ff8407100`；现进入产品TDD，以上“未开发／待确认”均是本次确认前的历史状态。结构包账本已按实际决定更新，不重写原完整性复核结论。

实现分工：存储／类型及其目标测试；原文件栏／任务选材UI；公开HTTP／正常路径测试由不重叠作者推进，Codex主Agent维护Host路由、原native可选回执、上下文提供与整体集成。完整候选最终另请未参与任何部分创作的全新Agent复核。无真实模型、安装、Git交付、运行切换或MacBook操作。

### 实际新增与复用

| 已确认决定 | 实际落点与权威 |
| --- | --- |
| M2-D01／02 | `project-data-context-types.ts`／`store.ts`仅新增项目数据登记、显式输入版本和声明来源。源字节捕获直接调用已有`ProjectStore.captureFeedbackFile`，不再造上传、文件树或schema扫描器；只固定用户选定的020 UTF-8 CSV／JSON |
| M2-D03 | 结构观察、业务解释、字段映射分开；记录用户／Agent／未知及覆盖限制。确认另增说明修订，只确认精确基准修订中内容不变的所选条目，旧确认不继承；普通分析无需确认或完整说明 |
| M2-D04 | `project-data-context-references.ts`使用既有EnterpriseMaterial精确修订和SAP发布库校验身份。轻概念正文仍由原企业资料页维护，没有新ConceptStore或独立公式副本 |
| M2-D05 | 原文件栏准备020分析副本，选材保存在真实project/task键下；原`server.ts`→`project-runtime.ts`→`project-session.ts`普通任务沿Interface v3提供新可选`projectData`。原native `providedContext` v1保存实际提供对象；旧请求指纹和回执形状不变 |
| M2-D06 | `createCitation`仅在显式操作时固定060报告及明确选择的020／060文本、计算、代码附件，保存精确来源、声明者和修订理由。提供不等于声明采用，声明也不证明实际采用或专业正确 |
| M2-D07 | 新项目侧`data-context` schema1：追加记录／证据与原子索引发布；CAS、操作目标UUID／规范化指纹／基准修订、同ID显式重试与UNKNOWN保全。沿ProjectStore共享变更门核对归档，不改project schema2、SQLite、Pi／RAP／SAP格式 |
| M2-D08 | 原`ProjectFiles`／`App`接入说明、固定、精确映射、任务选材、成果来源及历史回读；owner变化重挂载，异步迟到不跨任务。保留原技能／普通工具，冷读核算／fixed-draft拒绝新作者上下文 |

新增产品文件为`src/host/project-data-context-{types,io,validation,store,context,references,routes}.ts`及UI的`ProjectDataContextPanel.tsx`、`project-data-context-client.ts`、`project-data-context.css`。原文件改动为`project-store.ts`、`project-history.ts`、`server.ts`、`enterprise-materials-store.ts`的只读元数据投影、`src/agent/project-runtime.ts`／`project-session.ts`和UI的`App.tsx`、`ProjectSpace.tsx`、`runtime-client.ts`。没有依赖、SDK循环、恢复／压缩器、Host分析或自动truth机制。

### TDD与目标验证（完整验收前记录）

- 存储15项及原ProjectStore16项通过，覆盖固定旧字节／重开、重复操作、说明修订、逐项确认、精确来源、分析副本保留、CAS／归档、真实索引rename故障、同ID显式重试、基准前进冲突、缺索引／破坏记录不能冒认成功。原始RED／GREEN在`.local/fourbase-modules/m2/storage/`，摘要`verification-notes.md`。
- 上下文严格选择由真实缺少拒绝行为RED转GREEN，日志`.local/fourbase-modules/m2/integration/01-context-selection-red.log`、`02-context-selection-green.log`。空选择保持旧合同，不能省略精确说明版本或塞任意路径。
- 公开HTTP／合成SDK五项目标通过：020固定与历史回读；无表制度讨论→同任务追加数据→SDK实际Python计算10＋20＝30→报告／计算／方法附件固定；精确旧概念／SAP、说明确认和并发CAS、跨项目与归档；20,000 UTF-16边界含emoji及旧请求兼容；独立冷读／对照和封闭出稿隔离／取消不自动造来源。主日志`.local/fourbase-modules/m2/acceptance/14-http-cold-isolation-check.log`，未调用真实Provider。
- UI客户端原任务选材及接口测试通过；浏览器真实点击另复现“标签可留空但确认被400拒绝”。保留`18-browser-full-flow-check.log`；修复为空标签的明确用户确认填`user`，普通保存仍无确认，客户端真实RED→5项GREEN及typecheck保留于`ui/confirmation-label-{red,green,typecheck}.log`。完整正常浏览器路径正在修复后重验。
- 非产品RED分别保留：缺配置fixture的409、SAP／prepare参数不完整、Playwright定位器和未填写观察计数规则造成的失败、Node strip-only语法错误。这些是测试准备／实现错误，不能作为产品行为RED或从最终记录删除。

以上不代表完整检查、最终非作者复核、真实模型质量、Git／CI、运行采用或用户产品验收已经通过；最终状态以下续记录为准。

### 最终实现复核发现与修复

未参与任何候选创作的`m2_independent_review`从已确认规格和8项A导出预期，使用代码图、实际源码及仅在`review-scratch`内的合成反例独立复核。首轮实现候选因以下问题不通过，不能用目标测试全绿替代。原反例和结果均保留，修复后另存重验，不覆盖首次失败。

| 发现 | 最小修复与证据 |
| --- | --- |
| 归档映射区连精确概念／SAP读按钮一起禁用 | 读操作移出归档编辑禁用区，编辑继续只读；正常浏览器定点复验另记 |
| CAS409后仅能带旧base重试，关页面刷新会丢草稿 | 增“保留草稿刷新版本”，只刷新summary不覆盖草稿或旧pending；显式新保存生成新UUID并使用已刷新base |
| 导入观察只浅验，`fields:[null]`可造成render崩溃 | 浏览器安全完整格式校验成功才载入；Host仍最终校验，无业务推断。`ui/review-observation-import-red.log`为真实RED，`review-client-green.log`7项通过，typecheck通过 |
| 观察来源时间／native／产物证据已存但未展示 | 当前说明和历史回执显示生成时间、精确证据或“执行证据未记录” |
| 旧精确来源只显示“目录未列出”，没有分态 | 显式POST`source-status`从现有权威投影可读／停用／缺失／损坏／未知，不写状态或替换ref；公开HTTP分态、归档读、零Agent测试通过，`verification/source-status-http-final.log`。前两次漏await和archive空body是fixture错误，原日志保留 |
| 单条native新回执只有浅层检查，`description:{}`等嵌套损坏会让历史页面崩溃 | 浏览器安全projection完整核可渲染字段，单条损坏显示“无法解析／UNKNOWN”，健康记录独立可读，原native不修改／回填。作者`ui/native-receipt-red.log`→`native-receipt-green.log`8项通过、typecheck通过；实际Panel经现有Vite Oxc／ReactDOMServer渲染的原独立反例另存after复核 |
| 已有index时，未提交UUID可换dataset或操作种类后发布 | `#assertOperationTarget`直接核现有目标槽位，不新增账本。`storage/22-orphan-operation-identity-red.log`等保留真实RED；存储19项＋旧ProjectStore16项共35通过。独立`orphan-operation-reuse-after-result.json`确认换目标被拒、index不动，原请求仍能`publishedOnRetry` |
| 读取全资料detail会因未选中的新版正文损坏，误判健康旧修订损坏 | Enterprise新增只读`referenceIndex()`元数据投影，M2状态／校验／选择目录复用该权威；正文仅`readRevision(materialId,exact revisionId)`。Panel POST`concept-source`精确回读，旧Enterprise接口及存储不变。公开HTTP `verification/exact-old-source-red.log`→`exact-old-source-green.log`真实RED→GREEN；独立after反例验证v1可读／可校验、v2损坏不漂移旧ref |

浏览器主路径21号日志已通过原任务无表→追加数据→说明／空标签确认→同任务提供→报告来源／附件→重开零重放，并检查1440／390／320视口。该证据不自动关闭以上后发现问题，修复后另做定点浏览器回归。作者证据索引`.local/fourbase-modules/m2/acceptance/author-acceptance-summary.md`及宽窄截图保留在`output/playwright/m2/`。

首次完整`npm run check`保留于`verification/full-check.log`：930项，926通过／1失败／3跳过，因测试失败尚未进入build。失败为原AV06 recheck后台进程的`handoff-ready`尚未落地就立即读；同轮其SDK阶段已完成并不保证后台Python已获CPU。隔离重跑原断言通过；随后测试仅补用既有`until`等待后台自身ready，再执行原drain／close／handoff断言，没有改自动核算产品逻辑或放宽断言。compare和recheck两项定点通过，见`verification/av06-readiness-fix.log`。最终完整候选另跑全套，不能抹去该首轮失败。新增此回归修正文件为`tests/automatic-verification-flow.test.ts`。

第二次完整检查`verification/final-full-check.log`保留938项934通过／1失败／3跳过：原坏来源fixture同时随机了store和material，metadata投影先准确拒绝store mismatch／409，而旧测试预期missing／400。已拆成两项明确身份反例：错误storeId必须409及对应code；真实storeId下不存在的material／revision必须400及unavailable，均无index推进。`verification/public-http-final-regression.log`7项全部通过。没有放宽来源准入。

修复后正常浏览器A–E定点回归完成：`acceptance/review-fix-02-basics-check.log`验证409后草稿与原pending不变、原请求显式重试仍冲突、新请求新UUID／freshbase保存；非法观察不白屏、不覆盖合法草稿；可见时间／证据；归档精确概念／SAP可读而编辑／确认禁用。`review-fix-04-source-status-check.log`验证归档旧版四种来源状态分别可见、旧ref不漂移，Provider新增0。中间Host重启／启动环境和误选新版的fixture超时另存，未当产品RED；证据索引`acceptance/review-fix-summary.md`，修复后截图`output/playwright/m2/review-fix-{archive-exact-read,source-states}.png`。只关闭测试作者自有隔离QA进程和命名浏览器，未操作生产服务。

### 最终固定候选验证

最终`npm run check` **exit0**，日志`.local/fourbase-modules/m2/verification/verified-full-check.log`：**939项，936通过／0失败／3跳过**；公共会话AST边界、完整Node测试、TypeScript、Vite构建及试用build身份生成通过。三跳过为当前OS支持受管执行、故不适用的负向平台分支，以及两项需真实soffice的PPT渲染测试；没有将其改为通过。构建保留785kB主chunk大小提示，未为本模块更改分包或隐藏提示。

本轮M2新增目标测试共35项：存储19、HTTP／实际SDK7、UI客户端8、上下文选择1，已计入上述全套，不重复相加。浏览器主路径与修复后A–E是另外的实际入口证据，未混入Node测试计数。模型使用本机合成Provider；Python／bash及SDK执行是真的，合成回复和10＋20的计算不能证明真实模型专业质量。

最终完整检查读取的247份source／test／script哈希与收尾时一致；38份实现复核候选文件在冻结复核时一致，随后仅本结果及父spec／tasks／result四份进度文档按事实收尾，产品与测试不再改变。见`verification/verified-check-source-manifest.json`、`final-source-readback.json`与`implementation-verified-candidate-manifest.json`；实际收尾清单另存`implementation-final-manifest.json`。代码图`optracall-m2-verified-candidate-20261103`含4519节点／13832边；已知排除的Python／scripts按实际路径及运行测试补核，不把图谱无边当无调用。

12份文档的初检138个本地链接、事实收尾后139个本地链接、空白／代码块和固定输入摘要检查通过；最初链接检查器未去除`<绝对路径>`包装的误报原样保留，正确解析后通过。主方案v1.2、M1三份证据、原研究和历史候选六份不可变输入摘要全部保持；父进度与本模块结果只按本轮实际事实更新。证据`verification/docs-fixed-input-final-check.json`及`final-docs-source-check.json`。无用户项目／会话／文件迁移或覆盖，测试均用隔离合成根。

| 验收 | 最终工程证据范围 |
| --- | --- |
| MC01 | 原任务无表启动与同任务追加固定材料、SDK工具计算；正常浏览器21号主链路 |
| MC02／03 | 固定字节、重开／hash／故障与重试、分义观察／未知、逐项确认、导入防崩、时间／执行证据披露 |
| MC04 | 精确概念修订／SAP映射、旧ref无latest漂移、来源分态；健康旧稿不受未选新版损坏影响；归档精确正文可读 |
| MC05／06 | 新指纹／实际native提供范围、旧请求兼容、显式成果／计算／代码来源固定与修订理由、旧字节回读 |
| MC07／08 | 保存／重开／浏览无模型重放，原项目／父链保留；取消、CAS／迟到owner、跨项目／归档、损坏／停用／链接及UNKNOWN；冷读与fixed-draft隔离 |
| MC09 | 完整939项与正常入口／宽窄屏通过；企业资料、RAP／SAP／Case／反馈、PPT／SimLab、原工具和三测算skills受影响回归计入；3项SKIP分别保留，不宣称真实渲染通过 |
| MC10 | 最终完整候选非作者复核及职责／SDK复用专项收尾见下；Git／CI、模型质量、运行采用及用户验收分开 |

### 非作者最终结论与职责／复用专项

最终固定代码／测试候选由非作者`m2_independent_review`复核 **PASS**，MC01–MC10／M2-D01–08在本模块适用工程范围完成，8项实现发现全部关闭，无剩余必须修复项。复核者独立读取38份候选及247份完整检查输入的摘要、原始完整check退出码／日志、正常UI及A–E回归；独立复现并修后重验未提交UUID换目标、健康旧概念被新版损坏污染、嵌套损坏native回执三个原反例，另实际注入源读取中的等长改写验证拒绝发布。原FAIL与after结果分别留存，未复用作者测试当独立行为证明。

最终报告`.local/fourbase-modules/m2/review-scratch/final-review.md`，SHA-256 `bec82b7d748cc1416ab5958c43a05e5b82f37042e975e87e3a2c6c76bd3fd6c3`。实现候选manifest SHA-256 `fcac46882e6b8488c48ddc7d350b651699c46b61c83ea1dec7f64d2f46c06b5c`；复核后只按实际结论收尾本结果及父spec／tasks／result，最终文件摘要单列，不把旧摘要称为收尾后文档摘要。

“Host与Agent职责边界及复用检查” **通过，范围为本变更新代码、既有受影响调用链及上述运行记录**：源捕获复用`ProjectStore.captureFeedbackFile`，归档与保存共用项目变更门；轻概念沿既有Enterprise精确revision／metadata，SAP沿精确`library.read(id,version)`；普通消息沿`projectSessions.withSession`→`lease.start`→原SDK `session.prompt`，只加可选真实提供回执。Host仅负责显式材料固定、访问／格式／身份／资源核对、状态展示及保存；业务解释由用户／Agent提交，分析与计算在原SDK工具中完成。未新增分析流程、方法配额、真伪裁定或平行SDK生命周期；普通分析仍可无表、无说明／确认继续。新文件适配填补M1证实的旧输入字节和业务来源关联缺口，现有资料／会话／工具权威保持原位。

该专项不扩大为全部旧代码、所有动态扩展或完整产品运行合规证明；权限、归档、取消、容量和原件保护属于环境治理。真实Provider／业务资料与专业质量未运行，两个真实PPT渲染SKIP、既有B/C和自动链专业FAIL／UNKNOWN均保留。Git提交／推送／CI／合并、安装／运行切换、MacBook及用户产品验收本轮未执行。

**当时收尾（历史）：本轮完成M2工程实施与验收，代码留在`codex/fourbase-phase01-design`工作区，HEAD仍为`0f8ee5b`基线加本地候选。该时点M3–M8未启动。** 当时下一步为沿整体v1.2进入显式保留与个人查找，不借M2先行建立记忆平台、DuckDB或语义服务；随后M3确认准备以本页顶部最新状态为准。

# decision-case：一期本地交付与历史记录

2026-10-29 · **LOCAL_VERIFIED；0.1.0-mvp.4，完整本地检查、合成兼容验证及非作者独立复核完成。**

以下保留方案阶段历史状态：STRUCTURE_CONFIRMED／UI_DEMO_READY_AWAITING_CONFIRMATION；当时正式实现尚未开始。最新交付结论见文末。

## 输入与授权

- 源码基线：`codex/decision-case`，`85292e5b02fd6274f6696c765f14b669edc102e3`，本轮开始时工作区干净。
- 用户确认Case关联现有项目、项目下设任务Session；同项目可关联多Case；项目业务字段全局；已结束Case继续前重开，项目独立使用。
- 本轮授权仅为整理持久化、项目字段、兼容迁移与验收方案，保留现有项目／任务／文件；等用户确认后才实施。
- 原讨论稿身份及最新决定见[结构包](../../../docs/decision-case-phase1-structure.md)，原稿不改写。

## 本轮工作

只读核对工程规范、既有项目多任务／归档方案及当前ProjectStore／Host／Pi接缝。图谱采用本worktree既有索引 `optracall-decision-case-readonly`，HEAD与源码一致。

发现schema2白名单解码后写回会丢弃不认识的新增JSON字段，因而提出新SQLite＋按原Project ID保存业务字段扩展；这是一项待用户确认的结构建议，不是已实施结果。任务、会话和文件不导入新库。

新增结构决策包、规格草案与本结果记录。产品决定4项Confirmed；结构／验收决定12项Proposed。明确项目独立修订、原子业务历史、跨存储部分成功、请求背景快照、旧状态未设置、身份标记及备份／回退边界。

## 已做检查与未做项

- `git status --short --branch`、`git rev-parse HEAD`及worktree核对：确认分支／源码身份；不修改Git状态。
- 只读导入 `node:sqlite`：当前Node v25.9.0，`DatabaseSync`为function；没有创建内存或文件数据库。这仅证明模块入口可用，不证明SQL／事务／迁移或产品集成。
- 官方Node／SQLite文档核对：链接保存在结构包，不以第三方文章代替接口依据。
- 三个文档的相对引用、空白、决策编号及Git范围只读检查通过：仅三个新增Markdown文件，已跟踪文件及暂存区无变化；不把此检查称为产品测试。

## 文档候选复核与修正

文档v1固定摘要：结构包 `72e2d9121f6ba43e55a1bcf8a3feab4399ecceff594d5886ef668ab275b902f0`、规格 `58f16ce8823e0960760a7dc52ac83cfa00eaf69fc9ceb47ed70d66a6db58a7f7`、本记录 `5c66b68d35f6b74a625508c83a7134ecf191e8cb74d51f295bd74f9ec6ddcbdd`。

非作者fresh-context Agent对v1只读复核发现1项P2合同缺口：新建项目成功后Case修订变化，旧操作摘要／预期版本不可更改，而原文未给出能够完成关联的独立恢复协议；原结论保留，不能称v1无问题。

结构包v0.2补明：保留原Project ID与project_created回执；用户核对后用新的project_link操作ID和最新Case修订完成，原回执引用恢复操作，原摘要不变；补充修订变化、结束后重开及响应丢失验收。作者针对性复核另补两项语义：取消转完成清空旧原因；库和身份标记同时丢失不能被可靠识别为首次，普通启动不自动造空库，只允许核对后的显式初始化。

修正后文档候选v2的固定摘要：结构包 `0b29a6f48e37ed56386e03f31686194ef7226debd9789b28a2975fa4ddf56084`、规格 `58f16ce8823e0960760a7dc52ac83cfa00eaf69fc9ceb47ed70d66a6db58a7f7`、本记录复验前版本 `843a67d3ca85d4b44cf29a3d3fe63e71089a6ca184730a1bb43c561f5f1884be`。

同一非作者复验结论 **NO_BLOCKING_FINDINGS**：原P2的恢复合同缺口关闭，AC-11覆盖版本变化／重开／响应丢失；取消原因及双文件缺失的修正与AC-03／MIG-03一致；三文档Proposed状态、范围及停止线一致。复验前后HEAD和三个候选摘要均保持不变。该结论仅为文档结构与一致性复核，不是用户结构批准、实现、迁移或产品验收。

最终只在本结果记录追加以上事实回执并更新文档状态；结构包和规格保持复验摘要不变。没有实施修复代码、运行产品或迁移数据。产品测试／数据库／实际数据／服务／模型／SSH／CI／Git写入仍全部NOT_RUN。

运行源码、测试、依赖及CI未改；产品测试、数据库初始化、实际迁移、用户数据清点／备份、服务启停、真实模型、托管CI、Git提交／推送／合并、MacBook操作均 **NOT_RUN**。没有读取正式凭据、业务正文或原始会话。

## 当前停止线

用户最新已整体确认D01–D12，本次SQLite、DuckDB下一项、Semantica后置，要求保留现有项目、任务、会话和文件，并完成本地检查、兼容迁移验证及独立复核。但用户同时新增明确前置条件：“在实施方案前，先输出一份UI demo……UI demo确认后再做开发执行”。

因此更新当前结构包及规格为Confirmed，保留上文Proposed候选与当时复核事实。当前只制作 `docs/prototypes/decision-case-ui-demo.html`，使用合成示例和内存状态；不编入现有应用，不读写正式数据，不接产品API／SQLite／模型。正式开发保持停止，直到用户明确确认Demo，不将Demo交付当成UI已批准。

## UI Demo 候选

初版单文件候选为 [decision-case-ui-demo.html](../../../docs/prototypes/decision-case-ui-demo.html)，当时SHA-256 `3f3fcfe55d9e7b75f26f1a74c7522e5d14cb9745202e9e3122671a063164981e`，78863 bytes；最新候选见后续UI修订记录。它不是产品构建入口；所有数据为合成示例，交互只修改本页内存，刷新重置。

默认A为状态看板＋详情抽屉，B为紧凑列表，C为聚焦工作区；底部布局切换共用数据，并同步 `?variant=A/B/C`。沿用现有OptraCall的侧栏、颜色、系统字体和明暗主题。展示Case／原项目／原任务、共享项目、判断／未知／下一步、文件引用与历史；支持本页创建／编辑／关联／解绑／结束／重开，以及任务预览和从任务关联整个原项目。任务背景仅预览，不发送模型请求。Demo的信息分区用于UI讨论，不自动增加已批准字段合同。

独立静态复核曾发现“重新选择失效文件”没有处理旧引用；已修正为旧引用保留为已解除历史，新引用建立／恢复，并记录变化。另补完整输入背景预览、从任务建立／关联Case入口和最近修改排序。受影响静态复验无剩余阻塞发现；没有将此结论扩为浏览器交互或正式功能验证。

最终静态检查：JavaScript `node --check`退出0；无静态重复ID、外部资源引用、网络或浏览器持久存储API；三个variant的HTTP均200，返回内容与本地候选字节相同；文档引用与Git范围检查通过。只有四个新增候选文件，已跟踪文件及暂存区无改动。原始静态检查在 `.local/decision-case/ui-demo/static-check.json`。

独立静态预览使用 `python3 -m http.server 4187 --bind 127.0.0.1 --directory docs/prototypes`，只服务原型目录，不启动真实Host。预览地址为 `http://127.0.0.1:4187/decision-case-ui-demo.html?variant=A`；单文件也可双击打开。预览进程为本任务exec会话50457，保留供用户审阅，不占用产品4173／4175端口。

浏览器工具报告 `Local browser use is disabled in Work settings`；未绕过设置、未改设置。实际点击、弹窗、键盘焦点、窄屏与主题视觉点验均 **NOT_RUN**，没有截图或浏览器PASS。HTTP／语法／源码检查不能替代这些检查。产品测试、真实数据、数据库、迁移、模型、Git交付及MacBook操作仍未执行。

当前交付仅为UI Demo，请用户确认布局与操作路径；确认后才按已批准D01–D12开始正式开发。

## UI修订2：Case层级与项目入口名称

用户依据截图要求Case看板位于项目空间上方、Case层级高于项目，并将“项目空间”改为“项目看板”。已调整独立Demo的主导航顺序，统一导航、项目列表分组标题、页面标题／面包屑及相关提示中的名称；新建对象仍叫“项目”，不误写成创建“项目看板”。产品源码未改，项目身份与任务／文件关系不变。

修订2候选SHA-256 `e6c52aa10ee41d7ea0ad30bd5e1c3ca96512fac4b2fdaf5025e87e7b639498c9`，78853 bytes。定向静态检查确认Case导航先于项目导航、Demo中旧名称出现0次、JavaScript语法检查退出0；预览HTTP200且与候选字节一致。证据为 `.local/decision-case/ui-demo/static-check-ui-revision-2.json`。未重复运行与本次文案／排序无关的检查；浏览器视觉／点击仍NOT_RUN，不沿用初版静态复核冒充新候选浏览器通过。继续等待用户对Demo的整体确认，不开始正式开发。

## UI修订3：区分看板入口与项目空间分组

用户进一步明确：顶部“项目看板”与“Case看板”对应，下方具体项目列表仍称“项目空间”。修订2将分组标题一并替换是作者理解范围过宽；本次仅将该分组标题改回“项目空间”，顶部入口、页面及Case优先顺序保持。结构说明和UI-01同步消除命名歧义，保留修订2当时的候选／检查记录。

修订3候选SHA-256 `a38313c3d27e3b0bf54b7398337d7210ea2ca62310ce12bcebd4ebda90f9a237`，78853 bytes；定向源码核对两类标题及导航顺序正确，HTTP200与候选字节一致。没有修改JavaScript或产品代码，没有重跑无关检查。浏览器点验仍NOT_RUN；正式开发仍待Demo整体确认。

## UI修订4：统一卡片与两个看板的视图模式

用户要求方块大小一致、内容对齐，并为Case看板和项目看板都增加方块／列表切换。已在两个看板的主工具栏增加选中态明确的按钮，分别维护本页caseMode与projectMode；切换只改变呈现，保留搜索、筛选和内存修改。原底部A／B／C布局比较收敛为本页Demo状态提示，不再提供第三种聚焦视图。

Case卡片统一360px高，标题、判断摘要和下一步保留固定槽位，底部信息贴底；项目卡片统一420px高，最多展示两个任务摘要，提供“查看全部任务”弹窗。列表保留任务入口、项目共享Case数、工作状态、归档标记与原操作。长标题／摘要在卡片内截断，可进入详情查看；不对整张卡片裁切操作区。导航和项目空间分组沿用修订3。

非作者静态复核发现新增的项目任务弹窗路径存在下层对话框复用遮挡风险；已在打开任务前关闭项目预览对话框，受影响静态复验无剩余阻塞。未把源码复验扩大为实际点击或视觉验收。

最终候选SHA-256 `49ad458debe8c49ad77b873e254adbe71e3f26b24ac6a01f3e0388dae8e6edfd`，86369 bytes。JavaScript语法检查退出0；静态DOM查询无缺失ID，无重复ID／旧布局调用／外部资源／网络或浏览器持久化API；方块、列表及项目列表参数的HTTP均200且与本地字节一致。原始检查分别保存在 `.local/decision-case/ui-demo/static-check-ui-revision-4.json` 与 `static-check-ui-revision-4-final.json`，保留修正前候选摘要。

浏览器自动化仍关闭，实际等高效果、点击、焦点和窄屏视觉 **NOT_RUN**，由用户查看此Demo继续反馈。仅修改独立原型及对应规格／结果说明，正式产品开发仍待Demo整体确认。


## 正式实施启动：最新Demo与结构包均已确认

用户明确确认最新Demo，授权按D01–D12实施Case一期，仅增加SQLite，保留现有项目、任务、会话和文件，完成本地检查、兼容迁移验证及非作者独立复核后交付。此前等待Demo的停止线已满足；前期NOT_RUN和失败证据原样保留。

起点：Mac mini，分支 `codex/decision-case`，HEAD `85292e5b02fd6274f6696c765f14b669edc102e3`；原有方案／原型WIP保留。采用现有ProjectStore进程锁，SQLite保存Case及全局项目业务扩展，schema2项目JSON和原生JSONL保持各自原身份。工程验证仅用隔离合成根，不启动真实业务Host、真实Provider或MacBook更新；当前不执行Git推送、合并与安装发布。

实施与原始证据根为 `.local/decision-case/implementation/`。Store、Host接口、UI按不重叠文件归属并行；完整候选将另行固定并交给未参与编写的复核者。当前为IMPLEMENTING，不宣称工程完成或产品验收。


## 本地候选 v0.1.0-mvp.4：实施与复验

本段承接已确认UI Demo和D01–D12，历史等待、NOT_RUN及失败仍保留在上文。新增SQLite CaseStore及身份标记、六类业务记录与回执；原项目schema2仍为项目身份、任务、配置和上传来源的原始记录。Case M:N关联原项目，无Case Project或第二任务归属层。

正式React界面按批准原型实现：Case看板先于项目看板，下方具体项目分组仍为项目空间；两个看板独立保留方块／列表模式；Case卡360px、项目卡420px，任务摘要最多两条，详情查看完整内容。Case生命周期、人工说明、全局项目字段、产物真实来源／失效／历史引用、从原任务建立Case和按选定Case继续原任务均经Host真实API。

当前SQLite物理模式版本1，Node内置node:sqlite，无新增数据库依赖。普通启动不静默创建空库；显式启用、身份一致性、缺失／损坏／未知版本保护、关闭顺序与项目锁均有隔离验证。新项目关联采用原Project保留ID、分阶段回执及新project_link恢复；项目已创建时不删除或重复创建。未知半目录需核对，不自动清理或重建。

### 验证与证据

原始证据根为 `.local/decision-case/implementation/`，Store、Host、integration、independent-review分别留存。完整检查命令为npm run check，合成测试包含原有主链路与新增Case/SQLite/迁移/备份/HTTP/上下文。实际最终数量和固定候选将在复核完成段记录。

- Store与迁移、备份定向20项通过（store/12-final-store-tests.log）；schema2项目JSON、JSONL父链、既有迁移备份与三目录合成清单启用前后保全；schema1按原转换规则单列，损坏／未知保留并报错。
- 初始化中断四边界、ready缺库／单文件缺失／身份或版本不符／损坏／权限与软硬链接、事务提交失败及重试均覆盖。SQLITE_FULL/IOERR为提交边界合成注入，未实际填满磁盘；不将其说成物理硬件故障实测。
- D11显式离线结构备份由scripts/decision-case-backup.mjs提供，核对同根锁、库已关、权限、manifest及副本回读；不复制凭据／会话／三目录，不称完整灾备，不覆盖已有备份或业务新写入。首次尚无Case库不声称已备份新库。
- Host七项HTTP回归通过（host/13-create-and-collision.log），涵盖M:N、共享业务字段／冲突、真实引用观察、部分成功与恢复、身份碰撞以及Case缺库时原项目功能保留。
- 原任务SDK合成验证涵盖选定背景及版本、拒绝过期背景、去重／同ID不同背景冲突、普通项目发送不自动注入、结束Case不取消已接受运行，原运行可由用户显式停止（integration/26-lifecycle-context.log）。原任务本身历史不承诺隔离。
- 依赖审计integration/19-audit.json为0漏洞。未改变SDK版本或工具权限，未引入DuckDB/Semantica。
- 浏览器验证使用全新无用户配置的headless测试进程、4183隔离Host／合成Provider；不使用现有用户浏览器资料，不访问真实Provider。原多任务／归档／草稿回归、资料上传／报告保存、能力目录／运行切换分别通过（integration/24-browser-project-tasks-final.log、13-browser-live-projects.log、20-browser-catalog.log）。Case完整脚本结果单列最终复核段。

### 修正与失败保留

保留所有原始失败。Store早期Node语法和fixture清理顺序、Host依赖未安装／文件尚未写出的导入失败、浏览器分组div误当button及说明字段strict定位冲突仅为环境／fixture失败，不计产品RED。首轮完整检查184/184通过后编译遇到并行新增测试implicit-any，修正类型后完整重跑。

有效行为RED／因果复现包括预留Project ID被忽略、产物重试重新观察时间导致摘要冲突、归档后已完成项目保存回读受阻、窄屏Tab焦点及Escape返回。Escape最终根因为React卸载已清空ref，cleanup未关闭旧dialog；固定元素句柄后probe从active=body转为触发按钮（integration/28-focus-probe.json、29-focus-probe-after.json），保留原断言。

非作者预查提出：普通已接受requestId不能事后追加Case背景回执、project_created恢复应在关闭／重开／刷新后仍可发现、项目重命名／归档／恢复响应不得丢失全局工作投影。均已修正并补回归，最终结论须绑定完整固定候选后由非作者独立重验，不沿用预查作为最终PASS。

本地源码候选目前未提交或推送；托管CI、合并、实际用户数据启用、真实模型验收与MacBook部署均未执行。合成保全与离线副本回读只证明这些固定输入，不冒称实际业务库迁移或用户产品验收。


## 固定候选 C01：独立复核输入

源版本0.1.0-mvp.4，基线HEAD仍为85292e5b02fd6274f6696c765f14b669edc102e3，工作树包含本任务tracked差异及新增文件。完整候选清单与逐文件SHA-256写入 `.local/decision-case/implementation/candidate-C01.json`；不能只看git diff忽略新文件。正式复核前当前代码作者均停笔。

作者最近完整npm run check为191/191测试及生产构建通过（integration/30-final-check.log、33-fixed-candidate-check.log）；随后增加中文字段组合上限回归，发现合法20k背景+20k判断+5k下一步被旧65KiB HTTP限制拒绝，保留34-field-bounds-red.log并仅为Case/work API提升有限body上限至1MiB，35-field-bounds-green.log定向回归。正式候选完整检查／独立验证需包含此新增测试，不能沿用旧数量作最终数量。

完整Case浏览器31和32脚本均PASS；32额外通过“服务器创建Case成功后丢失响应→按原回执找回唯一原Case→关联整个原项目”的真实HTTP故障模拟。卡片等高、独立模式保存、共享字段／冲突、真实引用／历史、原任务背景与唯一显式合成SDK调用、Case结束／重开、归档恢复、任务建立Case、390/320px深浅色及键盘focus均通过。记录为integration/31-browser-case-board-final.log及32-browser-receipt-final.log，页面异常与外部请求均0。TaskCaseDialog回执读取修正归入当前C01。

正式独立复核状态：PENDING，结论必须在只读固定候选核验后另附，不预填PASS。


## 最终本地交付 C02（仅结论文档变化，运行源码／测试保持C01）

**已完成本次获授权的Case一期本地交付。** 用户批准的Demo与D01–D12均已落实；版本0.1.0-mvp.4，分支codex/decision-case，HEAD仍为基线85292e5b02fd6274f6696c765f14b669edc102e3，尚无本次源码提交。C01清单固定34文件，SHA-256为0eb6b0ba218af69dc1b4bc769c05ffdba82c3d3b5d6767826405d587e892890a；C02仅更新本记录、spec和结构说明的当前状态／证据，运行源码和测试摘要不变。C02完整清单为 `.local/decision-case/implementation/candidate-C02.json`。

| 验证层 | 最终结果与范围 | 原始证据 |
| --- | --- | --- |
| 作者完整本地检查 | npm run check退出0：192/192 tests、0失败／取消／跳过，typecheck与生产构建通过；构建标记0.1.0-mvp.4、85292e5+local-changes | integration/36-C01-full-check.log |
| 合成兼容／迁移保全 | 原schema2 JSON、原JSONL／父链、既有备份、三目录路径／字节／权限保全；旧schema1前置转换单列；初始化中断、丢失／损坏／版本及身份错误、权限／链接、提交失败、恢复与离线结构副本回读通过 | store/12-final-store-tests.log及tests/case-storage-migration.test.ts、case-backup.test.ts |
| 作者UI／原功能回归 | Case全链含丢响应找回通过；多任务、资料上传与报告、能力目录、原生命令／扩展交互分别通过；Case与项目等高卡、两模式、窄屏深浅主题与焦点通过 | integration/32-browser-receipt-final.log、24-browser-project-tasks-final.log、13-browser-live-projects.log、20-browser-catalog.log、37-browser-command-ui.log |
| 依赖审计 | npm audit --audit-level=high退出0，0漏洞；无新增数据库驱动或SDK变更 | integration/19-audit.json |
| 非作者独立复核 | Standards与Spec两轴均NO_BLOCKING_FINDINGS，0硬违例／0未关闭blocking；34文件前后摘要一致；独立192/192、typecheck、隔离Vite build、3个自有探针及4193独立Case浏览器全链通过 | independent-review/C01-independent-review.md及其指向日志／清单／截图 |

独立浏览器为避免同时运行的Qoder4183环境和既有Demo4187，使用空闲4193、复制到隔离review目录的同逻辑fixture并只适配port保护断言／Host.uiPort／Vite端口，源码和测试不改；合成Provider调用1次，页面外部请求和异常均0。两次端口bind失败保留为环境失败，不计产品RED。独立fixture发SIGTERM后所有所属进程和端口已消失，但shell退出143且残留合成Host锁，现场保留；**不称该自定义fixture正常释放锁已通过**，不影响作者原fixture正常关停和独立通过的Host关闭／重启测试结论。

非作者预查提出的普通请求ID事后追加Case背景、部分成功恢复入口、项目修改响应丢失work、TaskCaseDialog回执形状四项接缝均已修正并复验；焦点与合法中文边界亦有永久回归。`project_created`预置中断后的UI入口做了静态核对及独立后端跨重启恢复，没有冒称该特定预置场景也重复做了浏览器点击；常规创建丢响应找回则实际点击通过。

现有真实项目、任务、会话和文件未在本次工程验证中读取或改写；SQLite只在隔离合成根启用和迁移验证。实际业务存储启用／迁移、真实Provider分析、用户对正式候选的产品验收、Git提交／推送／托管CI／合并、应用或MacBook部署均**NOT_RUN**，不以本地交付代替。DuckDB下一项、Semantica后置。

使用方式与显式离线备份见README“Case一期”节。已有Case新写入后，回退仅使用兼容代码并保留最新库、标记、原JSON／JSONL及文件；不恢复旧快照覆盖后续内容。备份仅结构资料，未宣称完整灾备，失败现场与备份不自动清理。


## Mac mini启动反馈：C03修正与本地预览运行

用户反馈双击启动后无法查看，并明确为Mac mini，要求检查并查看本次成果。本次新增授权据此覆盖本机启动诊断、修复与打开当前Case候选；未取得Git、MacBook或真实模型调用授权。此前“实际服务未启动”仅为C02交付当时状态，本段记录新的本机运行结果。

实际旧启动日志报unrecognized_project_root；当时原项目根只有Finder写入的普通.DS_Store，没有项目目录，原元数据目录为空。ProjectStore把该系统元数据当成非法项目目录而拒绝启动。新增回归先复现同一错误，修正仅跳过项目根中名称exact .DS_Store且为普通非symlink文件的项；原文件保留，未知文件及伪装同名symlink仍拒绝。未删除Finder文件、配置、项目、任务、会话或业务资料。

旧main副本和原试用入口仍为mvp.3；当前Case在未提交的worktree，正式试用启动器对独立clean clone的校验按原规则保留。为用户查看成果，本机增加明确的开发候选入口：桌面“启动 OptraCall Case 一期.command”和“停止 OptraCall Case 一期.command”，调用当前工作树的 `.local/decision-case/preview.mjs`。它使用已有Host静态UI入口，在4173提供当前mvp.4；重复启动复用同root/版本实例，外来端口拒绝，停止验证root/版本/instanceId/PID命令后只SIGTERM该Host，并须确认已核验PID退出才声明停止。它不是正式发布或MacBook部署。

实际启动、桌面重复启动和HTTP回读均通过，默认浏览器已打开http://127.0.0.1:4173/；健康状态ready，runtime.codeRoot为本工作树、version为0.1.0-mvp.4、dirty=true。同一Host PID79259及instanceId在重复启动后保持，未另起SDK运行。真实页面只读检查Case看板、项目看板可见且无页面异常。首启动Case存储回读uninitialized，未自动启用、种入示例或调用模型；用户后续页面操作属于用户自主试用，不能从本记录推导其后数据库仍为空。实际停止按钮没有在用户查看时执行；其进程控制只用独立全stub验证，预览保持运行。

证据根为 `.local/decision-case/startup-diagnosis/`：00实际失败日志、01合成Finder RED、02 GREEN、03构建、04首次启动、05完整check、06桌面重复启动、07真实UI只读、08健康回读。作者完整check为193/193、0失败/跳过/取消，类型与构建通过。C03-startup固定37项（C02原34文件加本机wrapper和两桌面入口），清单candidate-C03-startup.json，SHA256 8e2cd5d246c1c5f848da4344c66f38fd624c48cf2f268d83076dd45d03fd495e，较C02仅上述5项运行/测试/入口变化。

非作者定向复核NO_BLOCKING_FINDINGS，37项前后摘要一致，类型检查、12/12 wrapper VM通过；报告为independent-review/C03-startup-independent-review.md。其复制隔离副本首轮全量190/193，3项为review fixture漏复制中文基线入口、Node权限下symlink依赖解析路径，失败原样保留；修正测试环境后launcher13/13、SDK2/2分轮通过，不称该独立首轮全量绿色。独立复核未执行桌面入口、未访问或启停用户服务。源码/数据权限和正式trialguard未为通过检查而放宽。


## 用户通过mvp.4本地候选；真实模型合成全链试跑启动

2026-10-29用户明确本地候选通过并授权真实模型/合成数据全链试跑。这是对明确候选的用户结论；不倒改此前工程检查、模型NOT_RUN或历史失败。当前运行实例健康、版本0.1.0-mvp.4；使用原已选MiniMax M3.1 Flash配置修订5，原Provider为minimax-cn（api.minimaxi.com），凭据仅由Host原配置流程使用，不导出、不改配置。本轮状态IN_PROGRESS，实际调用和闭环结果完成后另记，不能预填PASS。

新增合成Case、项目和任务均以唯一试跑标签识别，数据和独立数值oracle在 `.local/decision-case/real-model-trial/`；不覆盖/归档/删除现有用户业务对象，不代替模型补分析，不发真实经营指令。


## 真实模型＋合成数据全链试跑完成（2026-10-29）

**结论：本次已审流程与持久化PASS；模型分析质量PARTIAL，不能称全项绿色。** 用户已明确通过0.1.0-mvp.4本地候选，本次是随后授权的真实模型合成试跑结果，不代替用户对本轮结果的再次判断。产品运行源码／测试／依赖与C04逐文件摘要一致，仅新增授权／结果文档与被忽略的试跑材料；未提交、推送、运行托管CI或更新MacBook。

使用本机原已选MiniMax M3.1 Flash修订5，minimax-cn、anthropic-messages、api.minimaxi.com，沿公共Host API与原Pi SDK1.4.0；配置回读摘要前后保持，不导出/复制凭据。原5阶段加2个显式报告质量校正，共7个实际用户请求均completed，145条原生assistant消息、148个工具结果及15次工具错误原样留存；这些不是Provider HTTP请求或账单次数。工程侧未替模型补计算或编辑模型报告，独立计算仅供核验，未作为模型输入。

本次创建2Case、2个原Project及4个原Task。主Case关联两项目，第二Case复用会员Project；初研输入为2000行会员与2800行库存造数；模型核心结果复购40%→35%（-5pp、相对-12.5%），缺货8.5%→18%。人工模拟决策与模型建议分开记录，仅批准预置400人本地SIMULATED回执，不进行真实派发/经营动作。执行后才上传400行人工未来11月后验；复盘算术为T40%→50%、C40%→42%、DiD+8pp，独立Welch95%CI约[-5.1445,21.1445]pp，含0，不是真实经营改善/因果证明，跨0也不证明无效。复盘规则仅为待审候选，没有自动发布知识、DuckDB或Semantica建设。

关闭后新Case写入/模型请求被拒，已接受旧requestId去重未重生成回执；显式重开后可继续原项目。原商品Project归档/恢复保持ID/Task/工作字段，Case状态不被项目完成／归档自动改变。确认无其他Project/Task或运行/待回应活动后正常停启：Host PID/instance变化，新库storeId、两Case详情与历史、两Project/四Task、27文件与4原生会话清单完全一致。随后同execution Task/Session第7请求只读续接，旧JSONL完整字节前缀保留，只追加该续接；其他3会话及原27文件不变。终态28文件、18个可用引用；主Case observing、两项目业务completed、复用核验Case独立closed。7份背景回执的scope/revision/refs及用户／组合prompt hash均与原生保存消息匹配。真实页面只读点验2关联项目、18产物、57历史条目，0页面异常/0写请求。

**质量与边界保留：** 初版质量FAIL（会员概括和交叉表错数、商品覆盖数和区间方法标签问题），在原任务新请求另存v2，初版原字节保留；v2核心描述与复盘数值通过独立核验，但会员v2附加MDE/样本量规划27项仍不符声明方法，已在Case判断和产物标题中标不采用。本次400人来自预制合成分组，不是采用错误规划或充分功效证明。执行baseline词的9月/10月映射歧义已在复盘澄清；模型填写午夜时间为固定模拟clock，不能充当真实审计时间，真实时序依原生run与Host事件。模型工具自修、尝试缺失依赖、枚举空010目录元数据等过程均留存，未观察到010文件内容读取；可见轨迹不构成OS级全量访问/网络隔离证明，模型服务本身确有联网。

试跑前用户Case/Project均0，本轮非空保全实测是试跑已创建对象跨后续生命周期/重启，不冒称非空旧真实业务库并存或本轮重新覆盖全部AC01–12/故障竞态组合；此前确定性工程验证另行保留。

全部试跑资料与原始请求/SSE/快照/失败受权限保护，位于 `.local/decision-case/real-model-trial/`；用户可读汇总为 `试跑报告.md`，完整运行ID/证据摘要为 `run-manifest.json`，终态为 `final-readback.json`，重启/续接与7背景回执分别见 `restart-result.json`、`resume-preservation.json`、`context-receipts.json`。独立非作者结论为 `review/final-review.md`：已审流程与持久化PASS、分析质量PARTIAL；独立数据/产物审查见data-and-oracle目录。运行源码指纹在复核前后未变，完整dirty/new候选清单已固定。

App继续在http://127.0.0.1:4173/运行，Case看板可查看“【合成试跑20261029-464ae3】会员复购下滑：是否先做定向验证？”。项目、原报告/v2、模拟回执、复盘与全部失败现场保留供用户查看，不自动清理，也未发起真实经营动作。

## MDE诊断与一次定向验证（2026-10-29）

用户要求先区分模型与工程链路问题、不修改代码；只读诊断定位到模型生成的统计脚本：power项漏掉第二臂方差，v2沿用旧公式，自检未覆盖方法有效性。上下文、原生调用和落盘内容一致，未发现本案由Host/SDK传输或持久化损坏引入。同时纠正反馈组织的遗漏：初审已明确指出MDE，但前次校正提示只点名其他错误、未完整传达这项具体缺陷；不能把旧“显式校正”表述成已明确反馈MDE。原诊断位于 `.local/decision-case/mde-diagnosis-20261029/诊断报告.md`，原证据不重写。

用户接受建议后，沿原MiniMax-M3.1-Flash修订5、原会员Project/Task/Session，只发起一次新请求 `09f7638b-7148-4784-807d-4aa7f18660ea`。工程侧仅准备本次独立Python环境（statsmodels0.14.6），完整传达缺陷但不提供数值答案；Agent实际调用库并另存v3脚本/JSON/功效CSV/报告。未改变产品代码、测试、包依赖或模型配置，未追加第二次模型请求、Git/CI或部署。原16项项目文件、153条旧消息及原生会话前528304字节不变；原试跑200项固定证据、91项产品运行/测试/脚本/包依赖摘要不变。

**受限结果：原公式修正与指定核心数值PASS；整体产物PARTIAL。** 非作者先固定验收和独立期望，再从冻结CSV用标准库NormalDist复算，571项检查0失败，覆盖24+3项两种MDE及回算、四个基准率的8组最小整数样本量与n−1、分组比和CSV一致性。p=.35、200/臂时，同基准率局部近似13.3627pp、合并零假设/非合并备择normal-z方法13.7818pp；同一假设下+8pp需583/臂（583达到目标、582未到）。这些不是精确二项检验、真实实验批准或实际经营效果。

原始v3仍有独立未通过项：两处裸NaN导致标准JSON解析FAIL；错误影响比例混淆分母、n与效应平方反比解释前后矛盾；normal-z近似被泛称精确检验、有限分配比网格被泛化为全局最优等。未由工程侧修写模型产物，也未用主表通过覆盖整份报告失败。新原生段含36条assistant/35条toolResult、1次标记工具错误和5处实际Python异常输出（部分被shell管道成功状态掩盖），均保留；Provider HTTP请求次数/账单未测量。

Case新增4项v3来源引用并标明受限结论，旧失败历史保留；主Case仍observing，会员Project业务状态为awaiting_feedback。完整资料位于 `.local/decision-case/mde-targeted-validation-20261029/`，用户汇总 `验证报告.md`、独立结论 `review/final-review.md`、数值明细 `review/numeric-validation.json`、环境锁 `environment-lock.txt`。本轮未建设通用统计分析资产/Extension，也不证明未来任务会自动调用可信实现或稳定产出无错报告。

## 正式Git／CI交付启动（2026-10-29）

用户明确授权正式Git／CI交付并合并main，特别要求先集成刚更新的main。实际fetch后main为 `f7aa2bb53470f03a179c6064702a18717f360d6c`（指标体系插件PR #3），本期工作树仍基于 `85292e5b02fd6274f6696c765f14b669edc102e3`。先固定并提交本期完整改动，再正常merge最新main；两边功能、已有WIP及全部失败保留，不rebase/reset/stash/强推。

正式候选需同时验证Case及指标体系入口／路由／任务接缝，基于集成后源码重新做完整本地检查、受影响合成浏览器、非作者两轴复核和实际head CI。当前本段仅记录授权和启动，未预填合并或CI结果。交付证据根 `.local/decision-case/git-delivery/`；原始合成会话、模型报告与凭据不提交。当前预览服务、其他worktree和MacBook保持原运行／数据状态。

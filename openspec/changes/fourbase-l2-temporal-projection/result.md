# L2 v0.3 后端语义支撑与可选依据：准备记录

v0.3 · 2026-11-04 · **仅获spec／UI准备修订授权；待整体确认，未开发／安装／运行。**

## 本轮定位与交互修订

用户明确L2主要价值在后端，借本体与知识图谱（Semantica系统）让Agent更好理解语义；要求业务含义只作回答依据详情内的可选内容，关键口径和冲突由Agent在回答正文主动解释，无独立页面或新增必做步骤，更新后先整体确认再开发。

v0.3 [spec](spec.md)／[决定包](structure-decisions.md)／[确认页](confirmation.html)将Semantica本体／知识图谱语义支撑列为后端主要方向，原权威／Pi自主性保持；前端仅可选解释，不以UI或图节点数证明核心价值。原P1工程底座范围不扩大，不证明Agent理解提升；完整后续核心收益另需Agent理解、口径适用、冲突处理的实际对照和相应模型／资料授权。Graphiti仍仅具体事实演变缺口后的条件比较，无默认双引擎。

Demo只改虚构内存交互：正文主动说明关键口径／同名范围／版本与回溯冲突、未知及结论限制，原“查看依据”内口径说明可选；用户不打开详情仍可继续。预置回答是目标行为示意，不是Host新增强制查库或内部步骤，也不是真实Semantica／Agent运行成绩。原Case→K-10→SAP、失读I-1未核及D-1/E-1可读、N-1日期粒度／留存与草稿行为保持。

修订前10件逐SHA／mode核对并保全到`.local/fourbase-l2-preparation/history/confirmation-v0.2-before-backend-positioning/`，`backend-update-before.json` SHA为`3ad558396970d618d7439a675a7bbfcbbe0f83eae79525c35e2ee32e413dab91`。分支仍`codex/four-base-L2`、HEAD57742b9、upstream0/0，仅已有准备材料WIP。本次不改产品源码／测试／依赖／业务结构，不安装或运行组件／模型、不读真实业务根／凭据、不操作服务／MacBook或清理5239。旧v0.2静态PASS不覆盖本轮，旧稿与失败记录保留。

相称静态核查与新非作者复核的结果见下，不构成开工批准。浏览器沿此前Work禁用和file协议安全拒绝的历史限制保持NOT_RUN，本次不再尝试或绕过；实际桌面／375px／主题／焦点／交互与请求观察均无证明。L2D01–L2D06只验准备设计，组件、Agent理解增益、专业／产品验收和P1运行均未完成。

### v0.3 静态准备结果

作者检查10件：本地链接无缺失，两个HTML的静态ID／ARIA关联无缺失或重复，JS经`node --check`退出0，未见外部资源属性或网络／存储API；合成业务基线整件SHA与v0.2相同。证据见`.local/fourbase-l2-preparation/backend-author-static-v1.json`。两位全新且独立于全部作者的[规格／结构复核者](../../../.local/fourbase-l2-preparation/backend-reviews/spec-v1.md)和[规范／四原则／UI复核者](../../../.local/fourbase-l2-preparation/backend-reviews/standards-v1.md)均给已查静态范围通过、必须修复0项；固定10件和旧归档的SHA／mode匹配，无候选漂移。没有执行原型、产品或组件，不以静态设计通过代替实际浏览器、后端语义增益或完整工程／产品验收。

内容候选清单为`.local/fourbase-l2-preparation/backend-v0.3-candidate-v1.json`，SHA`92bcc1b4d3b22858a7cfbe1d207dac6078729ba8f381685c1df80729eba091ea`，10件原字节已保全在`history/backend-v0.3-candidate-v1/`；此后仅补本结果回执，spec／Demo等内容未变。保全回读`backend-preservation-final.json`记录原876件与5239原1223件零路径／mode／内容变化，5239 HEAD／porcelain不变，旧v0.2归档10件匹配；4173仍PID40994，4393无监听，POC根不存在。当前仍仅10件准备文件WIP，没有提交／推送／CI、运行采用或MacBook动作。以上只证所列工程文件和端口，不扩为全部业务原件／全机保全。

请整体确认v0.3 spec／UI与D01–D10；确认后的实施建议仍仅原P1，尚未开发。正常新增必做0，用户不打开依据详情也应看到关键口径和冲突，不把后端语义理解工作变成用户浏览页面的负担。

## v0.2 历史准备与结果（仅对应旧稿）

v0.2 · 2026-11-04 · **当前仅获spec／UI修订授权，待整体确认；没有安装、运行或开发。**

## 本次完整定位修订

用户要求：“按这个完整定位更新L2的spec和UI Demo，明确Semantica／Graphiti的作用、完整L2与本轮P1的范围，别把L2讲成单纯的关系和时间索引。先给我整体确认，再开发。”本次只更新既有10份准备材料，未获得P1开工或后续切片批准。

当前[spec](spec.md)／[确认入口](confirmation.html)／[D01–D10](structure-decisions.md)为v0.2：完整L2覆盖业务语义组织、来源／规则约束与冲突、知识关系／事实演变及Agent按需结构化查询；Semantica为优先候选，Graphiti在持续事实更新／实体对齐等有明确缺口后比较，能力有重叠，不默认双引擎。P1仅是固定Semantica0.7.0最小来源／显式关系／时间／快照／重建与同源对照，不是完整L2全貌；P2最小接线与其他后续切片不因完整定位确认就自动获准。

UI审阅说明将完整方向、组件作用和P1边界分开；原任务体验按需查看业务含义／依据／变化，不要求用户选择组件或阶段。旧同源业务故事和保全／资格限制保持，未来能力不冒充P1已实现。新版本相称静态检查与全新非作者复核的结果见本节，旧PASS不覆盖v0.2。

### 修订前保全与允许改动

开始时分支仍`codex/four-base-L2`、HEAD57742b9、upstream0/0，旧包10件为已有未提交WIP。已逐件匹配旧candidate-v4 SHA／mode并保全至`.local/fourbase-l2-preparation/history/confirmation-v0.1-before-complete-positioning/`；`positioning-update-before.json` SHA为`3a692748abb135942640e6173ee70136acdc4d931fc25aa6180b1a66dbc45f46`。本次仅修改该10件文档／内存原型，不改AGENTS、产品源码、测试、依赖或持久业务结构；不安装运行组件／模型，不读业务根／凭据，不切换服务、操作MacBook或清理5239。

原研究的发行包／API核对保留原时间／身份，本次补写完整定位不算重新验证所有框架。v0.2的L2D01–L2D05只验定位／阶段／候选UI一致性，组件运行及L201–L210仍NOT_RUN。本轮CUA再次尝试直接打开本地HTML，被浏览器安全策略拒绝：file协议不在仅HTTP／HTTPS的允许列表，未进入页面。未绕过策略、未改设置或另起静态服务，已收尾CUA；实际浏览器／375px／主题／焦点／交互与网络观察均NOT_RUN，不能沿用旧静态PASS或改写为浏览器通过。

### v0.2相称核查与保全

作者静态核查覆盖10件：本地链接无缺失，两HTML无重复ID／缺失ARIA目标，内联JS经`node --check`退出0，未见外部资源属性或网络／存储API调用。固定合成材料从§1开始的全部业务源、关系及原语向量字节未变，只修目的范围说明；这不构成实际运行或语义治理效果证明。证据为`.local/fourbase-l2-preparation/positioning-author-static-v1.json`。

两位全新、未参与任何候选创作的非作者，针对v0.2固定10件分别做规格／结构和规范／四原则／UI静态复核，首次均列1项必须修复：确认页沿用旧Work禁用而遗漏本版file协议安全拒绝。其余所查完整定位、组件角色、阶段／资格及旧失读／间接SAP链未见必须修复项。原报告保留在`positioning-reviews/{spec,standards}-v1.md`，原10件在`history/positioning-v0.2-candidate-v1/`。现已同步确认页，定点复验尚待完成，不预写通过；不将证据文字同步问题冒称产品RED。

后续[规格轴定点复验](../../../.local/fourbase-l2-preparation/positioning-reviews/spec-v2.md)与[规范轴定点复验](../../../.local/fourbase-l2-preparation/positioning-reviews/standards-v2.md)均关闭该项，剩余必须修复0；各自通过仅限其已查静态范围，两文件修正以外的8件身份未变。v0.2内容候选清单为`.local/fourbase-l2-preparation/positioning-v0.2-candidate-v2.json`，SHA`30874e29ff70101bc8f90c2555d13efe607887dacd94a06e64adfc9df5b9af4e`，其10份原字节保留在`history/positioning-v0.2-candidate-v2/`。此后只补本结果回执，spec／Demo等内容不再变。文档／原型静态设计可交用户整体确认；实际浏览器及组件运行仍NOT_RUN，不能写整体准备、完整L2工程或产品验收全部通过。

最终工程文件回读见`.local/fourbase-l2-preparation/positioning-preservation-final.json`：原876件、5239的1223件均零路径／mode／内容变化，旧v0.1包归档10件SHA全部匹配，当前仅这10件准备材料；5239 HEAD／porcelain原字节不变。4173仍PID40994，4393无监听，POC根不存在。此为工程文件／端口范围证明，不扩为全部业务原件、全部工作树或运行质量复验。

## v0.1 历史准备与结果（以下仅对应旧包）

v0.1 · 2026-11-04 · **方案／UI／D01–D10 待整体确认；组件安装及运行 NOT_RUN。**

本次接续用户提供的“L1→L2交接（Mini决策看板路径错误已修复）”，只准备最小方案和虚构原型。建议确认后的实施范围收敛为P1隔离合成POC，正式P2采用不自动启动；完整内容从[确认入口](confirmation.html)、[spec](spec.md)与[决定包](structure-decisions.md)查回。

## 实际起点

- 设备：`bendandebabadeMac-mini.local`，macOS26.3.1(a)，build25D771280a。工作树：`/Users/bendandebaba/.codex/worktrees/0e3f/OptraCall`，分支`codex/four-base-L2`。
- 开始时干净；HEAD `57742b99d173bfa6413e83705682b0444359add4`，tree `462a29b31a7a7a4159b87e4a1b243ddb3a84104b`。本次只读fetch origin/main后与main及自身upstream均0/0，无新增Git提交／推送／CI／合并。
- 正式Mini端口4173仍由原PID40994占用；只核进程和端口，未stop／update／切换服务。没有重核health commit、真实Board或业务文件，交接的运行采用／保全成绩仍仅是历史回执，不能冒充本次复验。MacBook未操作。
- 当前树开工前876份跟踪／未忽略文件与5239原1223份文件的path／mode／SHA及Git状态已记录于本树`.local/fourbase-l2-preparation/preparation-before.json`；原5239 HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`。本次只读其工程文件用于保全，无清理／修复旧WIP。

## 准备产物与发现

新增文件仅本变更目录的文档／确认HTML，以及`docs/prototypes/fourbase-l2-temporal-projection-ui-demo.html`。本地`.local/fourbase-l2-preparation/`为准备证据；不是组件POC根。没有创建`.local/fourbase-l2-poc/`或组件数据库。

1. [官方研究](research.md)：刷新发行／main，静态下载并核wheel0.7.0的SHA，12份关键源码与固定release提交逐字节一致；main0.8.0分开。实际包导入／完整依赖解析／运行未做。
2. [现状核对](reuse-audit.md)：专用MCP图发现后定点读当前源，确认L1工具、M2保存、原依据UI和Pi接缝已存在。只建议新增关系／时间派生查询实证，不重建来源／会话／业务权威。
3. [同源材料](synthetic-baseline.md)与[协议](evaluation-protocol.md)：三问、同名、反证、回溯通知、未知及原生时间／路径／快照限制，L1与L2取得相同内容／关系，首次建图和维护成本计入。
4. [spec](spec.md)／[D01–D10](structure-decisions.md)：P1最小发布包、确定性映射、原生本地SQLite、未知不代填、不同双时点／平行关系等逐项待验；P2业务布局及采用延期，不把工程实验布局推广为产品合同。
5. [UI说明](ui-review.md)／可点Demo：原任务、可选依据／变化、草稿追问和失败继续；全部为纯内存虚构预置内容，没有模型或产品回执。

关键静态限制：文本query参数未实现解析；缺recorded-time可自动回填；null可当开放时间；不同双截点不能由一次both表达；路径不保证穷举；create_version不持久；compare_versions可能压平平行关系；原生两SQLite无已证联合事务。不能因接口存在写成mapped／已采用／收益通过。

## 相称核验与未完成

作者首次静态检查覆盖10份准备文件，JS语法通过、未见外部资源属性／网络及存储API；发现reuse-audit的native历史读取链接少一层`ui/`，已通过MCP图核正。原失败不当产品RED。最终复验及全新非作者准备复核在本节收尾补记，当前不预写PASS。没有产品开发，不运行产品测试／全量check，也不制造RED。

中途保全回读：当前树原876份与5239原1223份文件均path／mode／SHA零变化，5239无增删、HEAD与porcelain原字节一致；当前树仅新增本包10份文件。主方案v1.2的SHA仍为`7a165e26f82674b1d2bda0b79fd2fde9f246f06dccceb0c95c2db6354e947ff0`。本次未核业务根原件或被忽略历史生成物，不能把工程文件清单扩大为全机保全证明。

全新非作者v1发现三个必须修复项：I-1／D-1失读范围不一致；作者误把Case关系直连当前类型不支持的SAP；双轴精确验收缺共同明确时间向量。规范轴独立重现第1项。v1的10份原字节及原“不通过／必须修复”报告均保留在`.local/fourbase-l2-preparation/history/candidate-v1/`与`reviews/{spec,standards}-v1.md`，未覆写旧结论。作者修正为仅I-1失读而D-1可读、Case→K-10→sapRefs A、双方共用且与业务收益分账的纯API向量；另把正常UI的映射说明改为“引用可映射；时间含未知”。v2形成时只记录待复验，没有预写通过。

v2两轴增量复验：Case引用与原语向量两项在准备范围闭合；失读项仍有抽屉末段引用I-1独占的样本事实、来源详情业务时间未注明当前未核，保留“1项未闭合”。v2原10份和报告另存`history/candidate-v2/`与`reviews/{spec,standards}-v2.md`。v3仅将上述失读内容收窄为未核并同步UI说明，形成时仍待两轴定点复验，没有把原失败或浏览器NOT_RUN改为通过。

最终v3的[规格／结构复验](../../../.local/fourbase-l2-preparation/reviews/spec-v3.md)和[规范／四原则复验](../../../.local/fourbase-l2-preparation/reviews/standards-v3.md)均关闭其已发现的必须修复项，剩余0；两者独立于全部作者，固定10件SHA／mode均匹配。**通过仅限文档、结构决定及内存原型的静态状态设计，整体准备不能记为全通过。** 作者链接复查无缺失、JS语法退出0，非作者亦独立静态核验；没有执行原型脚本或浏览器。v3清单为`.local/fourbase-l2-preparation/candidate-v3.json`，SHA`8c7ee9af5b66d10629dd4e4fbb3fe514016cf7c2a20f7e01c80de64c7de1ac72`；此后只补本结果文字及最终身份记录，内容候选未改变。上述完整证据仅在本机`.local`，不声称已进入Git／远端。

收尾再次fetch origin/main：仍为57742b9／同tree，与当前分支和自身upstream均0/0。最终保全回读在`.local/fourbase-l2-preparation/preservation-final.json`：原876份和5239的1223份均零内容／mode／路径变化，5239 HEAD／porcelain不变；当前树仅本包10件新增。4173仍PID40994，4393已无监听，POC根不存在。没有把当前新增准备文件称为干净工作区，也未覆盖原数据或旧工程生成物。

实际浏览器尝试：CUA创建原型tab返回`Local browser use is disabled in Work settings`，未进入页面。临时仅静态Demo HTTP服务4393已停止，不影响正式4173。**桌面／375px／深浅主题／键盘焦点／实际网络请求观察均NOT_RUN**。静态源码检查不能替代这些实际点验；用户前置UI确认也未发生。该缺口不能被文档复核写成全准备通过。

实际组件安装／import、SQLite写入／重开／更新失效／重建、取消／网络与资源、L1/L2工程对照、真实模型质量／专业增益／经营收益／Product Acceptance均NOT_RUN或NOT_PROVED。原M3／M3.1、DuckDB E01/E02/D04、native配额、ENOSPC／RSS及B/C专业FAIL／UNKNOWN、旧平台SKIP保留，不因本准备稿改善。

## 四原则与下一步

设计范围检查由spec§3–5、D06／09和协议§4承接：Host只管环境／资格／实际记录；Agent继续自主选查询／计算方法；复用Pi1.4.0／Interface v3及原L1／M2／UI、组件原生功能；正常新增必做0。实际产品专项验收未发生，不据此宣称L2最终工程通过。

整体确认前，只允许继续只读核对、文档／虚构Demo和相称准备修正。不安装运行组件、不改产品／依赖／测试／持久业务结构、不读真实业务根／凭据、不动原服务／MacBook。用户若整体确认本版spec／UI和D01–D10全部A，下一步仅进入P1隔离合成验证；没有这次整体确认，不从L1-D07、交接建议或历史Git权限推导开工。

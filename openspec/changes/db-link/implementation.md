# db-link 实施记录

2026-11-14。用户批准spec v0.2、driver revision3、semantic revision2和原UI并授权开始开发。准确文件／原文见[实施批准](implementation-approval.json)，任务按[tasks](tasks.md)持续更新；历史“暂不开发／待确认”保留为当时事实，不覆盖本次授权。源码起点`ef3e7d0b8703a6e22023e8099a56c542d484a69d`，分支`OC｜db-link`，已有未跟踪设计包／Demo均属于本任务，已核摘要并保全。产品源码／依赖开工前无tracked修改，node_modules不存在。

## 公共接口与实施范围

- 工程规范v1.10、Interface v3、官方Pi1.4.0保持；Host／Agent接线由Codex维护。真实projectId/taskId/requestId和原operation／lease绑定资源，不创建平行Agent域、调度器或第二运行状态权威。
- 原公开Pi工具注册／Host窄port复用；普通与受管／核算／封闭出稿profile分别核准，新db-link授权不扩大MCP、文件或Studio建设权限。取消／配置变化／晚到／历史均按IN01–IN07。
- 已批准精确新驱动：pg8.23.1、pg-cursor2.22.1、mysql2 3.24.6；只装官方原包到本工作树私有node_modules，不修改既有Pi／Semantica版本或源码。无服务依赖目录可共用；普通分析Python／正式服务／其他设备不操作。
- 测试接缝已由批准合同确定：Host连接配置与测试保存／项目授权／结果读写公开入口，驱动公开参数查询／结构／结果／取消边界，原Pi工具与公共会话生命周期，数据说明／Studio／核算公开业务入口及实际产品UI。精确函数名是实施选择，不另增加产品契约或要求用户重复批准测试。按TDD逐个行为切片，外部数据库／Provider可在其系统边界替身，不能以mock代替真实依赖／数据库能力证明。
- 实施文件在src/host、src/agent、现有extension接缝、tests、package/lock及本变更记录；UI遵循原批准合同。未获授权真实业务库／凭据／模型访问、SDK升级、服务切换、设备更新或Git交付。

## 开工发现与证据边界

1. 当前Node25.9.0，工作树无node_modules。当前PATH无docker／psql／mysql／postgres／initdb；仅发现Homebrew工具，没有发现常见已装PG／MySQLopt目录。隔离真实数据库验证环境尚未建立，不将线协议模拟服务器当真实引擎。
2. 原生驱动薄适配的权限／副作用／预算／所属取消存在批准稿已经列明的硬准入。固定驱动本身不提供完整任意SQL安全证明；MySQL prepared语句也允许KILL／SET等，不能把prepared或只读事务当全面保障。此项先查官方证据与最小合成验证；不擅自增加SQL parser／代理／改SDK或降低合同。
3. 未应用dev-flow／engineering-flow状态机：用户没有调用这些专用流程。直接依本仓唯一工程规范执行持续SDD/TDD与全新非作者复核，不额外生成平台或权限门槛。

以上是开工事实与未决工程条件，不是开发完成／能力PASS；各RED、GREEN、集成及收尾证据随后逐项记录。

## 首轮行为切片进度（整体验收未完成）

- E02连接Store：8组公开入口行为通过，覆盖Host-only一次性测试回执、精确配置指纹、修订/授权、撤权竞态和存储不确定后冻结。真实权限仍由原生验证核定。
- SQL技术校验：用户明确批准官方node-sql-parser@5.4.0后引入原包，11组真实parser行为通过；只接受可遍历验证的安全子集，不改业务SQL。注释/hint、引号标识符、未知函数/语法等显式拒绝；不是完整SQL沙箱。
- E03结果文件：5组行为通过，保留有序重复列、BIGINT/DECIMAL原文与NULL，preview默认100行，完整材料须验证每个chunk；partial/改字节/跨owner拒绝。driver替身13组通过，不当作真实引擎PASS。SDK先解码单值、MySQL PREPARE预算与远端UNKNOWN收尾仍须实证/明确限制。
- E04：原Pi公开工具注册db_sources/db_describe/db_query/db_result/db_save_description，5个Host窄port沿现有个人请求资源占用和retryFailed清理，不建平行生命周期。11组行为通过；scripts/check-agent-session-boundary.mjs仅增加该隔离测试文件的准确白名单，IN06测试接缝例外不放宽产品Runtime。受影响回归124项中1项新增测试错误预期已纠正，其余123项通过；不能把错误断言当产品缺陷RED。
- E05：复用原ProjectDataContextStore的结构版本和Studio引用，9组新增、56项兼容通过；单文件结构固定不冒充全结果已交付，准确文件集由E06独立冻结。测试暴露的原projection丢失来源SHA已修复。执行偏差：子任务额外运行原MC01/MC08隔离合成SDK回归，超出其委派切片的禁止SDK限制；在总体用户合成验证授权内，未用真实Provider/业务凭据，原事实保留。
- E07：复用批准UI的共享连接和项目来源，客户端4组行为及506模块构建通过；测试回执配置变化失效、归档只读、迟到上下文隔离和UNKNOWN写后读核定已有行为。尚未接Host实际浏览器闭环。
- 参数属性语法不支持、一次await自身mutation tail死锁、测试预期错误均已修正；语法/环境/测试错误不冒充TDD行为RED。真正RED来自未实现公开行为、授权竞态及来源指纹/projection错误，GREEN按各切片测试核定。

## 真实引擎准备及当前限制

Mac mini无需注册数据库系统服务。隔离验证在gitignored的.local/db-link/native-fixtures目录私有构建/解包，合成账号和数据、仅127.0.0.1临时高端口，结束停止自有进程。官方PG18.1源码SHA256 ff86675c336c46e98ac991ebb306d1b67621ece1d06787beaade312c2c915d54已核，私有编译完成。官方MySQL8.4.0 macos14-arm64原包MD5 a1e2b046b03812884a0ef0bbfd628f58匹配，本地SHA256 b4ad74a78aa4378df00e1164c9979dd660ea09bf47e05f6ef8324f4ea1418618；官方签名已保留但签名验证NOT_RUN。这是测试引擎身份，不代替生产来源支持范围。

准备偏差：PG第一次configure工作目录错误生成项目根config.log；核定为本次生成文件后移到私有证据并移除根残留，后续仅在私有build目录编译。未改系统服务/其他产品/设备。当前仅证明程序可执行，真实TLS/权限/精度/取消验证尚在执行，不计PASS。

## 接线/真实测试/独立复核增量（待整体验收）

- 原Host HTTP接线新增公开反例：未接路由时404的真实行为RED，接入既有origin/client安全中间件后GREEN；未测试配置仍不能保存。57项db-link既有切片联合通过，构建通过；已有大包warning保留。
- 真实有限候选第三轮19/19通过，首轮PG权限误判、MySQL identity别名/关闭事件失败，第二轮pg-cursor done回调无result导致异常均按原attempt保留并修正。当前硬准入另行收紧，不把这19项当最终能力开放。方向见execution-resource-decision.md，已询问用户，未收到决定前拒派业务SQL。
- 实际浏览器独立root：共享连接入口、未测试保存禁用、MySQL端口同步、390px浅/暗主题无横向溢出、Esc关闭/恢复触发器焦点已核；.local/db-link/browser-fixture/evidence保存两张截图和checks.json。真实连接保存后多项目/完整说明-Studio-核算浏览器链NOT_RUN。浏览器及该隔离Host已停止，正式服务未动。使用agent-browser技能/临时npx CLI，未改项目依赖。
- E06 bundle：整集私有固定、原子发布、全部hash、owner、50MiB/bundle及RCR100/CNR50总限额、partial拒绝、020改后仍读原ref、Host-only作者揭示和大值字节range均有行为证明。新增Host-onlyauthorizationSource只核读原manifest.modelExport，既有快照重复freeze不回落020。共享review port从真实索引恢复sourceOwner，固定后按原snapshot准确出口检查，APIkey轮换与模型/endpoint变化分别核定。
- CNR：单db-result selector与既有24项共用，完整bundle字节计入原50MiB；仅交明确preview片段，仍text-only。2项新行为及18项原材料兼容通过。共享port一项真实本地文件行为RED(not_implemented)→GREEN，证明020变化后不refreeze、禁止SQL出口时仍可交获准结果、同id改出口拒绝、取消不交付。
- 全新非作者限定安全复核FAIL，报告见外部独立证据：P1约束可泄露未读列名；P2模型id/outlet不一致导致UI误报及UNKNOWN无法核销；P2已知serverRowCount与保存行数不符仍complete。前两项作者修复中。第三项root新增真实RED(缺少预期拒绝)→GREEN：完整发布校已知serverCount和received/persisted一致，不符只可保留partial并记录原已知count；16项结果/bundle/port通过。Host terminal.rowsReceived交付一致性另补。原独立FAIL不覆写，最终需复核实际修正候选。
- 会话边界检查重新PASS；全量typecheck最近已PASS（之后仍有作者更新），全check尚未执行；不以定向检查替代最终完整检查。

## 用户资源方向决定与当前固定范围

用户明确选择“保留硬准入，先评估成熟的资源隔离方案（推荐）”。最终官方驱动候选SHA256 617b840c892fa614d4e44a2c7d94dc66b3eaa15f7b3811f5a6e9775463ccf3b9，真实最终准入11PASS（目录可用、明确拒派、独立SDK事实），单元10PASS/5明确历史有限候选SKIP。它与attempt03的有限取数19PASS源码b0765af42e5bc20597086dc3f184fe7c46448bdfd2d5cb5c463fd74e5f36b4f0分别核定，不把前者写成已开放查询。外部native-integration/native-proof.md及evidence-index.json含全部6轮退出/端口关闭与原FAIL证明。未发现残留自有fixture进程，未安装系统服务。

现按research技能并行只读研究Mac本地内存/时间资源隔离与远端PREPARE全阶段预算；只写调研说明，任何候选组件安装/接入仍待方案及版本确认。新数据库独立核算链不在硬准入未闭合时接通，旧legacy保持原状态。RCR切片收尾80/80受影响兼容通过，真实SDK唯一固定reader、parent取消晚到和大字段range回归均通过，typecheck/会话边界通过；专业核算正确性/真实业务模型仍NOT_RUN。

## partial-code-02 固定检查与资源评估收尾

部分候选65文件包含全部10件批准原件，摘要/字节及HEAD/branch重核匹配，见[候选清单](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/candidates/partial-code-02/manifest.json)。完整npm run check退出0：2392项、2316PASS、0FAIL、76条件SKIP，typecheck/会话入口门禁/build通过；原大包warning保留，不能当性能验收。[完整日志](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/checks/partial-code-02-full-check.log)、[机器回执](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/checks/partial-code-02-result.json)。11个官方运行包（批准驱动/parser和现有Pi包）按锁文件官方registry归档/SRI核2824成员与安装字节全部一致，[原包证据](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/checks/official-archives/result.json)；这只核这些归档成员，不代替所有传递包/运行采用证明。

第一轮完整检查原FAIL保留：2391项/2314PASS/1FAIL/76SKIP，AV02测试在合法SDK compaction插入时按原始请求下标误取第二请求。全新非作者定向重现并诊断，[报告](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/independent/full-check-diagnosis.md)。仅将该断言改为第二个ordinary请求，保持toolReply真值/全阶段顺序/压缩无工具/原件/native与历史所有断言；精确用例14.7秒PASS，再按新固定候选完整重跑，不称旧FAIL已未发生。

独立F1–F3（列约束出口/模型身份UNKNOWN/行数完整性）于partial-code-01闭合。新F4真实反例为25000字符合法单值使CNR整条prepare失败，root永久行为RED→GREEN：完整private bundle保留，对唯一row-too-large错误交中性依据及providedRows0/completefalse/未提供行正文缺口，CNR仍text-only；其他权限/取消/篡改错误不吞。22项CNR/port兼容通过。[partial01复核FAIL](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/independent/partial-code-01-review.md)、[partial02独立通过](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/independent/partial-code-02-review.md)分别保留；后者仅限当前已完成部分，不是全部DB01–19交付。

实际产品浏览器F2复验使用另一个独立root、Store公开入口注入标明不具查询资格的合成UI来源，再通过实际Host/UI授权；提交HTTP200后在浏览器边界模拟回包丢失，确认唯一POST、UNKNOWN只读核销、原modal关闭、无错误出口警告、查询未准入仍可见。不是实际数据库或模型证明。[浏览器回执](/Users/bendandebaba/.codex/worktrees/48da/OptraCall/.local/db-link/browser-partial02/browser-proof.json)。浏览器及该Host已正常关闭，未动正式服务。前轮390px浅/暗无横向溢出和Esc焦点回归证据仍保留。

资源评估已完成：[建议](resource-isolation-assessment.md)、[本地机制](resource-isolation-research.md)、[远端期限](remote-deadline-research.md)。保留硬准入；Node Worker/裸spawn不能单独提供总内存保证，原生AS可行性尚待验证，Apple container/Docker cgroup仅为本地候选；没有本地kill可以单独证明MySQL远端prepare总期限/所属收尾。未安装或选定新组件/镜像/版本、未运行新资源实验。

当前尚未完成：真实业务查询资格、远端UNKNOWN安全retryCleanup闭合、新数据库独立核算链、CNR逻辑结果picker及完整说明/Studio/核算产品浏览器链、专业模型效果、用户产品验收。无Git提交/推送/CI/合并、正式服务切换或MacBook采用。当前工作保留在OC｜db-link；不把研究/部分检查通过当成完整开发完成。

## 原生进程限额获准实测（2026-11-14）

用户授权macOS原生限额隔离合成验证，保持硬准入、不引入容器/代理，并选择后续按PostgreSQL测试。仅新增本轮验证/结果文档和gitignored私有探针，不改原产品/SDK/依赖/正式服务；原65件partial-code-02逐件复核无漂移。实际Node为既有Homebrew25.9.0_3，path/hash/收据已固定，不虚称nodejs.org原包；11个原官方运行包2824归档成员本轮再次匹配，Semantica未使用或修改，不声称wheel闭包重新验证。

OS19案说明AS512MiB/1GiB/4GiB均EINVAL、exec前exit78，未建立内存边界；默认CPU1秒SIGXCPU和16KiB单文件限额有局部证据。附加独立CPU1.215609秒自行exit0及双文件合计32768bytes反例进一步限定结论。PG-only复用私有18.1+pg8.23.1/cursor2.22.1新TLS，全部8worker已exit/close，唯一PG正常exit0、端口62151关闭；没有启动MySQL。CPU场景原误断言FAIL与所有raw/source保持，不重跑改绿。PG portal暂停statement600ms时约1.89秒仍持锁，transaction600ms组约630ms原session消失；本地退出后远端仍活动3.10/4.03秒的观察没有被当成即时取消。

主结果见[native-process-limits-result.md](native-process-limits-result.md)，细节分别见OS/PG作者结果。108件冻结输入/源码/二进制/原始证据manifest位于本轮外部candidate-01，原65件保护、private fixture结束和SDK事实另有before/root-readback/sdk-integrity收据。本轮不重跑原产品2392项全查，因为产品/依赖文件未改；不把此前工程PASS当本轮资源能力通过。最终非作者结论和用户确认另核。

本轮最终非作者复核已完成：[review.md](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/independent/review.md)，SHA256 e8600031150e1f2a0c2a65babcdec86ac40adf572bda2716ba3dda24c8fe80dc；[完成收据](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/independent/completion-receipt.json)。108固定原件/快照、旧65件与10批准输入均一致，SDK11包2824成员独立重核一致；原session时间线与pid/端口收尾符合限定论断。结论仅为本轮验证的证据/范围/解释通过，AS方案失败不采用、查询不开放；主结果交用户确认。未用该复核替代全产品工程/专业/运行验收。

## v0.5实施与独立复核修正（2026-11-15）

本次用户明确批准spec v0.5并继续开发，批准身份／Interface v3／公开接缝及范围见[v0.5实施批准](v0.5-implementation-approval.json)。批准spec原字节SHA256为`07576a28dcd97d26d2a28a6d846b7e614572eae30f5e2579d90e0046ff2ca76e`；before固定1,499件Git可见文件及原副本。证据根为`/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-v05-implementation`。后续本节最终收据优先于下列中期状态，历史FAIL／UNKNOWN／SKIP保留。

- 本地PG18.1私有fixture使用已有官方二进制，不安装系统服务；专用分析账号、正式owner/invoker视图及两个现成RLS账号为合成环境。管理员仅用于造数、锁、普通索引和独立观察，不作为产品凭据，不扩大产品权限。PG／MySQL／parser／Pi精确版本不变；11个已装官方包共2,824归档成员与既有官方原包及当前锁文件一致，详见`sdk-integrity-current.json`。
- 普通PG路径复用原pg／pg-cursor、原生只读事务／期限及原owner；删除v0.4的全表达式输出证明、冻结DDL和额外观察权限作为普通读取前置。保留技术SQL拒绝、原样SQL／参数、精度、有限单次预算及真实终态；整值segmentRead显式不支持，不把普通prefix误称完整巨值。MySQL未取得本次开放资格。
- 首次连接测试、已保存读取的UNKNOWN事实均沿原Store保存；原运行资源仍归原owner，不新增Runtime或生命周期台账。别名／改名／预算修改／重启不清除原未结束事实；只有显式原操作清理和四项真实结束事实可释放；父停止撤销模型和全部业务工具，单源UNKNOWN不误封独立授权工作。
- 中期非作者发现六项问题：P/T子集错误、可选目录42501破坏事务、已结束的无SQL连接错误误报UNKNOWN、目录父停止／预算缺失、无资源技术拒绝缺结束事实、解码与保存行数混淆。均保留真实RED并修正；SAVEPOINT恢复失败继续拒派。详见`mid-audit/review.md`及driver／host／results-receiving收据。
- 全新非作者继续发现R7（首批停止／列回调失败／超时后原callback晚到漏计已解码行）及R8（视图／RLS限制、实际账号与partial结构说明在后续投影丢失），修正并复核中。R7计数在原cursor公开callback最早记录，晚到仅更新原技术事实，不派业务行；不会把原UNKNOWN改成成功。另发现查询入口项目读取耗时未纳入原期限，已用真实60ms准备／40ms预算保留RED、首修失败和最终GREEN，计时点移到公开port入口，所有阶段复用同一剩余预算。
- 当前真实PG代表检查14/14通过；补充普通并发标准索引实测观察`building index`及`waiting for old snapshots`，原128行和四项正常终态完整保留，原读关闭后索引完成并清理。旧自定义opclass副作用反例仍按信任边界排除，不改为PASS。目录巨注释、数值／微秒、owner/invoker、RLS双身份、原等锁停止、实际wire loss UNKNOWN均有原生证据。
- 查询入口在修正与最终检查完成前仍关闭；纯回归的正向业务查询因该实际门关闭而失败的日志保留，不冒充产品行为RED或绿色通过。完整检查、正式开放后的Host原生正向、实际UI和非作者最终结论随后记录；未据当前局部通过宣称完整开发、DB12受管活库独立链、真实业务／模型质量、用户产品验收、Git／CI或运行采用。

### v0.5最终工程候选与开放结果

本轮完成普通可信PostgreSQL读取的本地工程闭环。关键原生正反例及全新非作者关闭必须修正项后，移除Host开发期临时查询封锁；每次真实权限／源身份／单次保护／原资源结束事实仍动态核验。**仅实测PostgreSQL 18.1（server_version_num=180001）可取得查询资格**；其他版本保留连通／目录能力但明确未验证，MySQL本次不开放。客户端实际环境为本机macOS／Node25.9.0，不外推其他平台／企业云产品验收；未更新正式服务或设备。

最终完整检查`full-check-final-ui.log`：`npm run check`退出0；2,560项中2,449 PASS、0 FAIL、111条件SKIP，包含会话边界、类型和构建。上一完整候选`full-check.log`同样通过，二者分别保留。111项条件跳过不冒充通过；其中本轮PG25项另用明确私有fixture实跑：`native-critical-final-closed.log`16/16、`native-host-after-release-cast-green.log`9/9；其余跳过原因见`full-check-skips.json`，旧MySQL／v0.4强硬准入及其他模块条件证据不抹去。构建保留既有大包体积提示，无新构建失败。

实际产品路径使用agent-browser、原完整Host、未经修改官方Pi和本地合成流式Provider；配置一次PG命名连接，两个项目各明确授权后任务直接提问。每个原请求依真实工具回执发现→目录→错误SQL拒绝→自主新SQL→固定结果读取→保存说明；两条链共14次真实本地HTTP模型请求，0 Provider错误，保留两次`db_sql_object_unqualified`。不同project/task/request的结果和说明相互独立，第二项目取第一项目结果返回404且无数据正文；两个项目各有3条准确Studio材料引用，没有伪造发布／采用／图刷新。

实际结果UI保持大整数`9007199254740993`、精确小数`9007199254740993.123456789012`、微秒时间及NULL，1835015字节note仅取`Aé🧪`前三字符；记录实际版本号／登录与有效身份／当前账号范围、驱动解码2行／交付存储2行／固定2行。说明保留结构Only／0扫描行／实际覆盖，未把元数据、视图／RLS限制或partial提升为总体证明。核算中性回执保留账号、版本及限制，默认完整材料门槛不因结构模式放宽；旧sourceNote及旧已保存说明同operationId重试保留原字节，不改历史。

两次开放后失败属于验收调用／替身设置，并非绿色重跑掩盖：旧fake先保存unqualified再仅翻转当前目录，Host正确继续拒绝，已改为先合格保存再模拟失权；原`substring(note,$1,$2)`被PG解析为文本重载返回NULL，独立原生对照记录在`pg-substring-native-overload.json`。调用方改为公开受支持的`CAST($1 AS INTEGER)`选择位置前缀；`$1::integer`在当前parser组合无法完整解析的拒绝也保留，不改parser或让Host改写业务SQL。

最后实际浏览器发现结果按钮等待加载被禁用，导致弹窗挂载时丢失调用按钮、Esc后焦点落body；保留真实RED及DOM事件记录后，现从真实click/键盘调用事件在await前捕获该按钮，只供原弹窗关闭回焦。390px浅／深色实测文档宽390、结果弹窗356且正确显示精确内容，Esc回到原结果按钮；原错误与初步不完整布局记录不覆盖。最终UI候选重跑完整check通过，并经非作者增量复核。

最终候选／批准保全见[v0.5实施清单](v0.5-implementation-manifest.json)。全新非作者标准／规格／四原则报告在证据根`evidence/final-review/review.md`及`ui-focus-review.md`；全部历史FAIL／UNKNOWN、旧方案、初始导入／fixture错误、未跑项及中途可变回执摘要不一致均保留，不改成PASS。

收尾：原私有PG61048正常退出0、未升级为强制终止、端口61457关闭；私有Host／Provider端口与PID均消失，停止前Store未结束读取／测试事实均0；Vite及独立浏览器会话关闭。根`teardown-final.json`与full-ui最终controlled-teardown／acceptance-manifest保留实际控制信号和结束事实。未提交／推送／CI／合并、未切服务／操作MacBook、未访问真实业务库／Provider，用户产品验收和经营专业质量均不由工程通过代替。

### 保全清单的最后澄清与精确恢复

1,499件是开工时Git可见文件的身份清单，`before/`实际保存73件选定文件副本，不宣称当时复制了整树。最后非作者检查发现29件本轮修改原件中的4件可从旧partial-code-02取得完全匹配副本，另1件`DbLinkProjectPanel.tsx`遗漏开工副本；已仅反向还原本轮root UI差额，在仓库外恢复原20101字节，SHA256精确匹配开工before.json的`57c8dfb2571f0259f28abf2f20f86f394d9e89a26b1ff785c72e41669bfaca8c`。当前候选源码未回退或改动；该副本明确标为末尾恢复，不伪装开工时已复制。全部29件修改原件已有可回读的准确原字节，映射见证据根`preservation-recovery/before-copy-index.json`及恢复receipt。原candidate-final-01、遗漏／恢复事实及旧复核假设保留；最终candidate-final-02仅补此保全说明和清单，不重写源码／测试／批准文件或原失败。

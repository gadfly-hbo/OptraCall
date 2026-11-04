# DuckDB 第一版 v0.2 本地实施记录

2026-11-04 · **本地开发、验证及收尾完成，按用户明确接受的三项限定处理记录；原NOT_PROVED、失败与保全缺口不变，不等于Git／发布／产品验收。**

本次收尾用户已明确接受三项限定处理，原句、对应候选、风险与退出条件见[接受记录](accepted-limitations.md)。这是本次E01/E02例外及D04合同增量的明确授权，不沿用其他模块旧例外。

## 授权、固定输入与工作树

用户原话：“更新版的spec和UI demo 方案确认，开始执行开发，继续遵守四点产品原则。”9份批准原件的字节、完整包版本及范围见[批准清单](history/approved-v0.2/manifest.json)。原件保存确认时内容（包括当时“待确认”措辞），不回填历史状态。四原则唯一详细来源仍为工程规范§2–4，IN01–IN07／Pi1.4.0／Interface v3保持。

当前获准范围为原Pi/Python可选DuckDB、五类固定输入、M2 v1/v2与既有成果/来源/UI接缝及适用本地工程验证；隔离私有依赖和合成实际工具可运行。无真实Provider／业务材料、Git提交推送／CI交付、运行服务切换或MacBook动作。原FAIL／UNKNOWN／M31 NOT_PROVED保留，工程与真实专业效果／用户验收分别报告。

- 原树`/Users/bendandebaba/.codex/worktrees/5239/OptraCall`，`codex/fourbase-phase01-design`／HEAD`0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`及既有WIP保持原字节。
- 工作树`/Users/bendandebaba/.codex/worktrees/duckdb-phase1/OptraCall`，`codex/fourbase-duckdb-phase1`，以最新main`8425ca159bc674b73ad54b80ce523a93b4f3b900`创建；其后仅此候选写代码。原main工作树未动。
- 开工前v0.2交付12候选／447工程／580main／109新证据／12格式截图全部匹配。原树1,224工程／文档／图文件共100,303,120 bytes完整before快照；原始基线`.local/fourbase-modules/m7-duckdb/implementation/original-baseline.json`为676,646 bytes／SHA256`9e93e4e704f632013bcfb1a6871d8a041f76a3f6a63ba752cdef91beb757457b`。
- 25处tracked WIP与724份untracked复制到独立候选；main全部独有文件保留。14文件重叠中10文件25冲突逐块合并，保上传22类/50MiB、连接器、核算settings、原生subagent/web_search与M2–M6；三方原件和冲突证据均保存。它是整合修正，不计产品RED。

历史证据最初以只读用途symlink关联原目录，但该约定不是OS硬沙箱，完整测试中实际产生越出候选的测试写入，详见下方“测试隔离事件”；不能再宣称全部历史证据未触碰。当前m1–m7已改为候选自己的copy-on-write副本，原链接仅存`.local/fourbase-history/`作历史引用。新实施证据写候选自己的`.local/fourbase-modules/m7-duckdb/implementation/`。

## 已确认的验收接缝与TDD

沿已批准DB01–DB08及验证协议：原Pi bash/Python／公共v3生命周期及各profile；M2公开store／HTTP的固定输入、说明、citation、准确读取和幂等；原任务／项目文件／按需计算依据UI；旧消费者与第三合成接入。这里记录已批准seams，不重复请求用户确认。

采用纵向真实RED→最小GREEN，各片先保失败再修；环境／导入／fixture问题单列，不冒称产品RED。日常仅受影响验证，完整候选统一完整check、真实隔离合成Host/Pi/UI、全新非作者双轴和四原则专项。尚未开始或未通过的项目不能升级为工程完成。

## 当前进度（持续追加）

1. 整合：无剩余冲突标记，初次`npm run typecheck`通过；candidate `npm ci --ignore-scripts`按main锁文件安装234包，原树依赖未动。安装器报告2项moderate告警原样保留，未擅自改锁定版本。
2. 数据切片：旧M2 store＋main普通upload公开基线23/23通过。`data/01–13`逐次保存TSV、50MiB、二进制XLSX、位置、50/100MiB来源及兼容回退的真实RED→GREEN；v1独立golden原件GET/重放不迁移，新写才升index2。真实Host HTTP保存、原位置、精确证据、工作稿改变后历史不替换、重启和原operation核收在`15-http-integration.log`通过；`14`是fixture误用provenance枚举，不计产品RED。非作者F3发现MD unobserved却允许recordRule非null，`16`保真实Store RED，最小校验后`17`新旧Store/Host38/38通过；UI同源行为另修复复验。
3. UI：原长面板、五格式/位置、精确原件读取和按需计算依据已实现；原任务正常新增必做动作0。原作者14客户端回归及组件＋合成HTTP范围见`ui/implementation-summary.md`；其后F2完整原请求fingerprint与F3修复见`ui/implementation-summary-v2.md`，真实Host UI另证。初始核收TDD缺口独立保留，见下。
4. 执行环境：3个批准wheel下载hash匹配，candidate私有venv `--copies`保持真实prefix。旧protected及普通Pi路径无法使用私有库的真实RED已保，接线后`runtime/17-runtime-final.log`19/19与原公共生命周期/隔离回归`11-existing-runtime-regression.log`26/26通过；包含managed ordinary/cold、closed/text-only拒绝、插件不自动给权、缺失/漂移、纯Python/混用、实际长查询并行取消及drain。openpyxl额外只读`/etc/apache2/mime.types`字面路径由实际拒读缺口导出，未放开整个/etc。
5. 真实Host→普通Pi→原bash→私有openpyxl/DuckDB→原SQL/params/versions/result/report及M2 citation/native tool entry→重启同native身份/原hash回读已通过，`runtime/host-integration/03-host-runtime-semantics.log`与`host-author-result.md`。NULL、重复键放大、DECIMAL组舍入和总舍入分别核固定期望，纯Python实际`duckdbImported=false`，provider4请求重启后仍4无重放。这是合成Provider＋真实工具的工程验证，不是真实模型专业效果。
6. 资源补验`runtime/resources/05-resource-final.log`3/3通过，分别是有界实际spill及正确计数、只读目录IOException、实际OOM及原件/他owner保全。**native临时配额FAIL／NOT_PROVED仍在**：fresh连接初始0B，首SQL CREATE仍分配26,083,328物理bytes。原失败、初始测试和fresh repro完整保留；未证明真实ENOSPC、RSS硬限或可靠临时磁盘配额，未另造Host quota/scheduler。
7. 同机同输入34,000行CSV＋10行维表，Python/DuckDB各3次新进程，结果与独立整数周期期望一致，SQL/params/版本/config及每次wall/RSS/hash留在`calculation/observations.json`。本小场景Python中位约0.0242s/峰值约21.7MB，DuckDB约0.0555s/70.6MB，**DuckDB更慢且占用更高**；OS缓存未清、无真实业务收益推论。重复键原30→join40、显式half-up及UTC/业务日历差别有独立反例。初次probe误假定本机TimeZone=UTC的fixture失败原样保留，不计产品RED。
8. `calculation/03-formats.log`为实际DuckDB读取有界CSV引号内换行/空值、TSV、嵌套JSON、重名列、空文件、错误UTF8及MD选定简单表的补验，显式口径和期望核对通过。重名列的引擎改名不当业务身份；MD原BOM/CRLF/emoji原hash不变，派生CSV与原UTF16精确片段另记。这是独立工程probe，不是Host生产解析器、通用MD解析保证或Agent每题必做步骤。
9. 修后v2完整`npm run check`退出0：1,302项／1,299通过／0失败／3原条件跳过，边界、类型与构建均通过（`full-check-v2.log`）；原unsupported-platform条件及两真实soffice项未冒充运行，chunk大小提示保留。`after-full-check-v2-readback.json`核1378候选文件零漂移。**随后独立核对实际ordinary原Python发现F4，v2通过不能代表其未覆盖的既有包能力保全；运行代码修后须新的完整v3。**
10. 非作者F2/F3已分别独立关闭：三类核收12个GET-only正反例、真实MD Host拒错/不发布与正确provision，以及旧v1三类字节/指纹均复验。UI新源真fp浏览器6/6、实际MD覆盖/格式双转换与CSV旧规则保留通过；真实App＋隔离产品Host也6/6，实际上传/固定/说明/原件/SQL参数读取、修改当前文件后历史仍准确、320无横溢，模型与外网0。`ui/implementation-summary-v2.md`和`ui/real-host/result.json`准确区分合成未执行UI材料与另一份真实Host/Pi计算记录，自持进程全部关闭。
11. 非作者F4发现原ordinary实际PATH解析至CLT Python3.9，既有numpy2.0.2/pandas2.3.3实际可import并合成sum42；候选默认私有3.14＋禁user-site后同命令ModuleNotFoundError。unmanaged cold workspace也有同根因。真实反例在`fresh-review/python-existing-capability.json`／`python-cold-profile-counterexample.json`，不以brew3.14本来没pandas或纯stdlib通过替代原入口。原作者保普通与cold实际Pi因果RED后，删除worker所有私有PATH/site替换及多余探针；**全部unmanaged保原Python，新私有解释器由Agent显式选绝对路径，原protected-tools继续自己的锁版私有默认。** 未装重复numpy/pandas、未加fallback／执行器或扩大权限。可迁移永久回归在隔离PYTHONUSERBASE读只读合成包，不依赖私人库或增加skip。最终受影响22/22＋原公开Host核算SV04–08 1/1通过，见`runtime/python-compatibility/cold/cold-author-result.md`；独立普通双方法与cold实际numpy/pandas42通过，原失败保持。这是必修功能，不列用户例外；完整v3另记。

## 设计边界与新增最小适配

`analysisPythonFor(codeRoot)`只由Host eligible profile提供技术依赖位置，未进业务JSON或成为第二资源权威；guardian与公共drain/close/UNKNOWN沿原机制。`tests/analysis-python.test.ts`为实际Pi＋合成Provider的工程接入，新增精确静态owner例外，理由对应DB01/02/05，不扩大产品导入白名单。

DuckDB原生裸connection的扩展默认值与产品显式config样例分开：环境说明／实际验收使用禁额外自动安装/加载的config，普通unmanaged下这是环境约定，不能冒称不可绕过沙箱。没有monkeypatch、隐藏import、强制方法或新的SQL执行服务；managed继续原OS scope。真实设置／网络／资料边界以对应运行证据判断，不凭依赖已安装推断每次采用。

## 原未满足项与本次限定接受

**初始核收TDD为NOT_PROVED。** 新“核对保存状态”handler在有效前置RED成立前已开始写；`07/07b`是fixture缓存失败，不能冒充产品RED。真实修改窗口、after与明确标注的派生before在`ui/ack-order-audit/`，没有紧邻前独立原始全文件快照。后续真实GET-only、pending不被新操作覆盖、同身份重送保新本地稿的RED→GREEN只证明各自修复，不能补足最初顺序。未沿用M31旧例外；用户本次明确接受E01，允许限范围本地收尾，工程规范§3所要求的初始顺序仍NOT_PROVED，不追认为满足。

**原额外扩展默认合同差额保留；D04增量已接受。** 裸DuckDB连接默认autoinstall/autoload为true，产品guidance与已测连接显式false；这不等于批准spec“依赖默认禁用”的环境保证。非作者已独立读回，记录在`fresh-review/native-defaults.json`。未擅自收窄批准原文或将其标PASS；也不添加monkeypatch、SQL代理或第二执行器掩盖差额。用户现已明确接受按原软约束/显式连接设置收窄的D04增量；当前spec按该范围表达，原默认保证未满足的结论不改。

## 测试隔离事件与保全边界

首次完整`npm run check`的`full-check-v1.log`在历史symlink条件下运行，旧M31 reader新建root经realpath guard拒绝，产生多项0 rows失败。发现后主动中断，原FAIL保留，不修改guard或削弱测试。该轮还沿历史链接在原5239的.local创建505份新合成测试文件，3份既有生成bundle mtime更新；这是本次工程布置疏漏，不能说原树完全只读。完整路径清单`original-test-root-side-effects.json`保留，无删除／回滚。

M5 client bundle字节与旧固定hash相同；M31 SSR bundle当前hash与旧M31交付hash不同，M3 SSR bundle未找到旧hash。开工before不覆盖这些.local生成物，**本轮前这两份bundle原字节及是否此前已漂移无法核定**，有限原目录查找未找到旧M31尺寸副本；未伪造恢复或追认零漂移。原历史日志、manifest及失败不改，具体读回在`historical-generated-bundle-readback.json`／`historical-generated-bundle-search.json`。

纠正后8个模块历史目录用macOS copy-on-write复制为候选私有目录，原链接移作只读历史引用；真实reader原11项全通过，见`integration-candidate-reader-isolated.log`。新完整check须在此隔离条件及修后UI固定候选重跑，不能沿用中断轮。

`preservation-readback-v1.json`另证：原5239开工前1,224份源码/文档/图及9份批准输入全hash零漂移，原porcelain保持；main仍8425且干净。**这个范围的通过不掩盖上述.local历史生成证据缺口。**

## 最终本地候选与分级结果

最终功能/测试候选以`review-candidate-v3.json`固定（1,383文件，main base仍8425）；后续仅本节、结果与状态索引等文档收尾，接受前全量清单为`final-candidate.json`；本次授权/合同/状态文档收尾另固定于`accepted-closeout/closeout-candidate.json`，与接受前产品代码、测试、依赖和Demo零差额。检查输入与最终只文档delta分别核对，不能以旧候选的PASS代新代码。

- **完整检查：通过本地适用范围。** `full-check-v3.log`：`npm run check`退出0，1,304项／1,301通过／0失败／0取消／3原条件跳过，190.1秒。边界检查、类型检查、Vite生产构建及stamp均通过；两个真实soffice场景与不适用平台分支未运行，构建chunk-size提示保留。旧中断v1与兼容修前v2日志不覆盖。
- **真实集成：通过所列合成工程场景。** 实际Host→Pi→原工具→openpyxl/DuckDB→SQL/参数/版本/结果/原native→重启回读；最终21项runtime＋Host合计22项、原核算Host1项通过。原Python与private Python均由Agent在同一工具自行选择；非作者最终普通/非受管cold实际numpy/pandas42及private DuckDB42复验通过。真实App/Host6项、修后组件6模式分别通过，界面12源在v3未变，无需把它们冒称真实模型或新运行采用。
- **非作者：功能F2/F3/F4已独立关闭。** 完整标准／规格双轴、独立反例、v1三类记录/证据/幂等/混合v2、profile/调用链/四原则及最终摘要核收在本证据目录`fresh-review/`；接受前最终报告记录S1初始TDD、S2历史生成证据保全和F1扩展默认合同仍开放，原报告不改。本次接受记录及`accepted-closeout/review/`文档增量复核与原结论并列，不把风险接受写成复核PASS。源代码与作者检查不能代替非作者结论。
- **四原则：职责分层、自主方法、Pi复用、正常0新增必做操作的实际路径已核；本地收尾按有效限范围接受完成。** Host仅环境/归属/权限/技术校验/留存；原SDK1.4.0/v3循环与guardian/drain仍是权威，无SQL服务/队列/自动转换或Host补算。原环境默认承诺仍有F1差额，流程与证据仍有S1/S2；用户明确批准E01/E02且接受D04修订是本次收尾依据，原专项检查不改写为全部通过，也不以1,301通过代替该决定。
- **性能/专业：有界样例正确性已核，未证明普遍增益。** 小型同输入对照DuckDB更慢且RSS更高；真实Provider质量／真实业务结果／经营收益与用户产品验收NOT_RUN。native临时配额FAIL／NOT_PROVED、真实ENOSPC和RSS硬限未证。
- **交付/采用：未操作。** 未提交推送／托管CI／合并、未安装到运行服务／切换Mac mini、未操作MacBook。候选在独立`codex/fourbase-duckdb-phase1`，原项目/会话/文件未运行迁移；原1,224材料与9批准原件零漂移不覆盖已单列的.local事件。

三项具体范围、理由、风险与退出条件见[已接受的限定处理](accepted-limitations.md)，确认前提案保留。本次本地收尾完成，S1/S2仍NOT_PROVED，原F1未满足及其历史结论保留；当前合同按已接受的D04显式连接范围执行，不标原检查全部通过。正式Git/CI交付、合并/发布、安装/运行采用与用户产品验收尚未完成且本次未扩大授权。

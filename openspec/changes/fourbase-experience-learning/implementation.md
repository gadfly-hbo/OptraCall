# M6 产品实施与证据

2026-11-04 · **本地开发与工程验证完成；收尾重复更新目标已修复并通过v3完整检查及非作者增量复核。真实专业增益、Git／CI、运行采用与用户产品验收分别未完成。**

用户明确“确认M6方案和Ui，开始开发”。这是对已提交v0.1 spec／UI及D01–D06推荐A的整体接受；无替代决定，不再重复询问。8份批准原字节及实际用户原话保存在`history/approved-v0.1/manifest.json`，不把后续更新当前状态混入原件。

开工前完整回读M6准备交付`.local/fourbase-modules/m6/delivery-manifest.json`（SHA-256 `ad711dc42ffdf7e9de17049476240a214673770d3719a63dc8182720596de9f1`）：12候选、431源、172证据、3复核、475副本、20保护和8份M5批准输入全部零漂移。现有分支`codex/fourbase-phase01-design`，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`；保留M2–M5 WIP，不用旧HEAD代替本次工作区。466份本次开工前副本及固定输入见`.local/fourbase-modules/m6/implementation/baseline.json`和before。

## 已批准的公开验收接缝

按spec EL01–EL10及末段既有验收归并，不新增用户确认要求：

1. 原CaseStore／个人Store及真实Host HTTP：跨Case目录／准确卡片、choice和原反馈交接；三类来源、新旧格式、分段保存、只读／UNKNOWN和兼容关闭。
2. 原Host→Pi1.4.0→loopback合成Provider→native／原业务Store：真实工具、普通无Case、多次／合法nested、准确候选v1／v2、取消／旧ctx／迟到／封闭profile；不把合成响应当真实推理。
3. 实际产品浏览器：候选准确预填原M3、明确新建／更新、三段UNKNOWN／旧新稿／独立治理、原任务草稿与消息保留、单组对照草稿不自动发送、全局人的资料维护与任务资格分开。
4. 受影响M3／M31／M4／M5及公共会话消费者：原来源四类／Case SQL2／旧native与指纹保持、预算／片段／失读、不通过间接来源重供排除候选、旧格式和新写停用。

逐片真实公开行为RED→最小GREEN；missing import、fixture／定位／工具故障不计产品RED。已有常绿回归和后补边界不追认为每条前置RED，不沿用M31例外。最终固定完整候选、适用全量check、全新非作者及四原则专项分别完成。

## 实施分工与复用边界

个人来源／v2解码、跨Case只读服务、真实产品UI分别按文件归属实施；root维护原统一Runtime／SDK／Host接线和联合验证，不互相覆盖。仍只有Pi原生候选正文、原M3稳定资料与保留决定、原M5 Case／事件及原Board／反馈权威；没有PatternStore、新SQL表、后台学习／模型、全局运行队列或自动评分器。

原Legacy PersonalSourceRef／sourceRef四类继续供M5写入；扩展学习来源只用于获批M3／M31／M4和窄只读接缝。普通任务的当前调用由原M4 IPC／取消／delegate资格控制，不要求当前Case；Case写入仍按原M5当轮回执和同Case约束。

## 当前隔离验证

测试环境仅`.local/fourbase-modules/m6/implementation/live/fixture/`，UI4208／Host4209、loopback合成Provider；author与review分别建立合成项目／任务／Case。现有业务服务、原真实dataRoot与MacBook均不操作。

UI作者仅在本环境逐片实际进入产品；root已用原Host→Pi→合成Provider真实保存一条带准确Enterprise来源的candidate，并以原公开HTTP保留一条旧个人经验，供预填／修订验证。记录在`implementation/live/author-seed.*`；这不是实际专业增益或经营效果证据。

只允许为工程检查启动本次隔离测试服务与合成协议；没有真实Provider／模型或业务材料授权。Git交付／CI、安装／运行采用、MacBook及M7／M8未启动。旧准备包PASS、FAIL／UNKNOWN／NOT_PROVED及原型F1分别保持原身份。


## 受影响接入与阶段证据

准确接入说明见`docs/agent-session-integration.md`的M6段。新增`src/agent/case-sources.ts`只声明窄工具参数与callback；原Runtime／worker增一能力位并复用原请求map。`tests/experience-learning-runtime.test.ts`在真实SDK缺少工具时先失败（`runtime/01-capability-red.log`），最小接线后直接／nested通过；原native-reply共享预算／取消先失败再通过（03／04）。其余SDK version／关闭、profile、停止／旧ctx是联合回归，不追认为每条另有前置RED。A来源7片及B Case来源行为RED分别在各作者result中；UI逐片实际动态RED另记ui目录，没有把Demo／定位错误充产品RED。

`runtime/05-integration-regressions.log`：38项M4／M5／M6真实SDK定向回归全通过。`runtime/10-host-integration-attempt5.log`：实际Host→Pi→loopback合成Provider→原Case草案／人的choice→关闭Case→无Case任务准确查读→v2 native候选→原M3 retain→排除间接来源→独立正文仍可读→停止新写而读旧维护全链通过。此前06–09为fixture凭据前缀、旧Case CAS、lookup字段和controls入参修正，原失败保存，不称产品RED；没有更换真实模型或掩盖产品专业FAIL。

关闭新写启动参数为`--disable-experience-learning`，只沿原Host启动传配置；M5关闭参数独立。作者环境UI4208／Host4209属本次隔离合成根。review fixture原任务以实际Pi保存M5 strategy、人的gather_evidence选择及带Enterprise／准确card／choice的v2候选，见`live/review-seed.json`；只有root可写该环境Provider plan，非作者可自主只读核查／UI并通过串行计划进行合成模型测试。


## 首次完整工程验收（v2，收尾追加见后）

完整固定产品候选v2：`.local/fourbase-modules/m6/implementation/review-product-candidate-v2.json`，98,577 bytes，SHA-256 `ef1ab197b2d2cb24ef84441f8b636766442fa18f5e29052029f81bcd7118ac19`。447份完整工程输入、42项M6差额、20份当时文档／批准快照，HEAD与分支仍为开工前身份，未用HEAD替代未提交WIP。最后5份收尾状态文档在before-closeout按原字节保留，最终清单另固定，产品源不再变化。

| 项目 | 结论与证据 |
| --- | --- |
| 完整适用检查 | `npm run check` v2 exit0；1153项中1150 PASS、0 FAIL、3原条件SKIP；统一接入边界、TypeScript及Vite构建均通过。见`full-check-v2-result.json`及完整log。原933.64kB bundle／>500kB警告保留，不另扩无关优化。 |
| 首次完整失败 | v1为1149 PASS／1 FAIL／3原SKIP；旧M31测试把获批v2当未知，原FAIL保持。v2仅将未知版本反例改3、显式肯定v2，原身份／defaults／SHA断言完整；定向通过后完整重跑，不将v1写成通过。 |
| 作者真实行为 | 来源7条、UI7条实际行为RED→GREEN，Case来源及SDK工具／native预算逐片保留真实RED；其余联合边界是追加回归，不追认为另有前置RED。UI作者20份PASS，7产品RED与3 native BODY过强断言FAIL分别记录。没有外推旧M31例外。 |
| 全新非作者 | [最终报告](../../../.local/fourbase-modules/m6/implementation/review/final-review-v2.md) 9,621 bytes，SHA-256 `43a1606aaa52c416a4492c58370258df475d0645ea0e4d4779e0e8fe6796082b`。标准／规格两轴均0项必须修复，本次完整候选工程通过；447源／20文档／42差额／20保护／8批准／8旧M5批准／3作者freeze／466before零漂移。 |
| 独立真实链 | 自建Host→真实Pi→loopback合成Provider验证无Case读、原写权、direct／nested、v2、排除直接／sourceIndex／Case reference、原反馈＋指定handoff／缺原件UNKNOWN、停止迟到与停新读旧。实际产品8业务场景通过，含准确预填／新旧修订／三段丢ACK回查／原任务保全／单组零发送／F1分开资格／独立治理；窄屏键盘另补真实原生模态证明。全部资源由其关闭。 |
| 四原则专项 | 作者自查与非作者根据代码、调用链及实际运行分别通过：只补窄跨Case只读／三类准确来源及版本／原M3预填／可选草稿差额；Pi／原Store／M4通道复用，无新loop／成熟评分／方法配额／平行正文或实验库；普通工作零新增必填。必要归属／权限／预算／取消／CAS／原件和UNKNOWN不误判为干涉。 |
| 保全 | 完整check后447／447源、20／20当时文档、20保护、8批准原件、8旧M5批准、466before、5旧构建均匹配。v1.2原方案、AGENTS、M6 Demo原件及旧FAIL／UNKNOWN／NOT_PROVED保持。静态10份收尾文档153本地链接通过，5外链只登记未联网。首次151项摘要保留于工具会话及doc-links/first-run-stdout-receipt.json；重跑同名详细输出已改为153项，原详细JSON未冻结，不声称仍有其原字节。 |

当前候选兼容关闭参数为`--disable-experience-learning`。原个人账v1／v2及native候选仍可读，已存新引用原样维护，不允许引入新引用；旧v1程序不保证兼容v2，不用旧副本覆盖新成果。人的正式经验、候选纠正／排除与原Case选择／行动分别维护，没有自动级联撤销或业务执行。

本次是本地工程完成：合成协议不能证明真实模型推理、专业召回／增益、多个真实事项可比性、因果或经营成熟。未发真实Provider、未读真实业务dataRoot、未Git／CI、未安装或切换真实服务、未操作MacBook；M7／M8未启动。未发送的UI意图沿原React状态保留于同一App导航，硬刷新／崩溃不承诺持久恢复；原业务提交／native和操作回查按原权威保存。隔离工程服务收尾与最终清单见delivery-manifest.json及service-closeout.json。


## 收尾修复与最终v3验收

停止原测试Vite时发现React重复key日志；复现证明同资料已保留版＋不同草稿会在更新目标列出3个同materialId选项。原完整v2 PASS与非作者结论保留其范围，不据此跳过新发现；5份当时完成状态及待修状态均另存原字节。`repair-existing-targets/`保留终端线索、专用fixture、实际RED、React state未提交的测试时序FAIL与最终GREEN。

最小修复仅在原M3“更新已有经验”选择器按稳定materialId合并，优先当前draft标题；lookup仍保留两种准确表示，旧保留版／原draft／candidate／currentDecisionId均不删改。只改`PersonalMaterialsPage.tsx`及已有实际浏览器脚本；原v2两文件快照已保全，不借修复造新目录权威或改Store。作者实际唯一选项、真实同ID CAS保存、旧稿和原任务保全及零React重复key通过。

最终测试产品候选v3：`.local/fourbase-modules/m6/implementation/review-product-candidate-v3.json`，99,324 bytes，SHA-256 `25cc0aac9842135f47fcadafd3d26dff16b38fa40e7a56872dff0367452fc4b3`；447完整工程源，较v2只有上述2项源变化。`full-check-v3-result.json`为完整`npm run check` exit0：1153 total／1150 PASS／0 FAIL／3原条件SKIP，边界／类型／构建通过，原bundle提示保留；检查后源与批准、保护、466before等全部零漂移。

[非作者v3最终追加报告](../../../.local/fourbase-modules/m6/implementation/review/final-review-v3-addendum.md) 4,809 bytes、SHA-256 `a54aa33bacb16e248a54abc055d53bee601c0b8fde287721389539851624313d`，标准／规格两轴各0必须修复，专项继续通过。独立新fixture确认lookup两行、唯一option且current draft标题、原materialId CAS保存、原currentDecision与准确旧body保持，console warning／error及pageerror均零；未重跑无关Host／Pi链冒充新增证明。447源／23文档／42差额／20保护／8批准／8旧M5批准／4作者freeze／466before匹配。

本模块最终工程结论通过，未关闭或改写v2原结论、修前pending回执、首次完整FAIL、修复RED、fixture失败或旧M31 NOT_PROVED。5份最终状态文档限范围核收并另固定最终清单，源与v3测试候选完全相同；不同阶段清单不相互冒用。原测试UI4208／Host4209已由各自拥有的进程正常SIGINT收尾、两端口均无listener，见`service-closeout.json`；隔离合成数据、会话与所有历史保留。原业务服务、MacBook及M7／M8未操作。

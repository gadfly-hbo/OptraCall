# Issue #154 最终候选独立非作者复核

复核者 `/root/trial_runtime_audit`；业务切片子复核者 `/root/trial_runtime_audit/final_business_matrix`。两者均未参与本候选实现、长期测试或规格创作；原任务仅诊断试用反馈。本轮只读候选，所有新增探针、日志、图片、哈希与报告写在 `.local/independent-final-review/`，没有产品/SDK/规范/Git/Issue/PR写入。

当前固定候选 `a643bf00e79cba01933cbaa49a1616ecb675cf12`；业务代码为 `b88af4aa6dfd7f998bfb3e5e119b87820b287d99`，a643仅将一行浏览器等待定位器从精确文字改为原`本轮概览` region，全部产品文件与b88逐hash相同。原主线 `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`；e72、b88、a643分别在 `input-*.json` 固定全部19个产品/测试差异及规格/冻结Demo/依赖共30输入。冻结Demo SHA256 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`，原daily-workspace spec DW01–18与§4、followup CF01–07/tasks、工程规范v1.17及IN01–07均实际读取。

**最终结论：在本报告明确的工程复核范围内 PASS，未遗留已确认阻塞。** 真实生产dist同源浏览与最终16图已完成独立核验；三项原RED均经原样GREEN及永久回归关闭。T10用户看图确认、PR/head CI、授权合并与main CI仍待执行，不能据此提前PR。e72原始“不通过”保留在 `e72-findings.md`、`business/review-e72.md`，不追溯改写为通过。

## 亲自执行与只读核验的边界

- 本复核者在e72亲跑67项（followup/agent-sessions/preparation/task-observation）全通过，另有3个额外因果探针发现未覆盖缺口；绿色数量没有抵消真实RED。
- PM接修后，本复核者在b88亲跑上述范围+3个新增永久回归+本人原样late-read探针，**71/71 PASS，0 fail/skip/cancelled**，见 `final-b88-target-tests.log`。a643仅浏览器locator一行，无上述被测产品或测试变化，不无目的重跑71项。
- 亲跑 `check:agent-sessions` 与 `typecheck` 通过，见对应log。官方Pi1.4.0、Node25.9.0沿既有安装；package.json/package-lock、公共生命周期内核与runtime规则对main无diff；没有改SDK。官方registry归档完整性未在本独立轮重新下载比对，边界脚本PASS不等同该审计。
- 两业务原样探针由独立子复核者亲跑并固定RED/GREEN；`business/final-b88-binding.json`绑定业务9文件和两缺口关闭矩阵。
- PM的正式build、40项真实Host/角色/来源与Case UI回归、50秒开流心跳漏终态探针、最终生产dist E2E由PM执行，本复核者读取日志/源码/原始图交叉核对，不冒称自己重跑。作者原524文件/3694项（3497pass、197skip、0fail）与4项历史浏览器文本/选择器漂移FAIL按implementation原记录保留，本轮没有重跑该全集。
- 没有付费Provider、用户业务/凭据、Mac操作。Mac原03/04自然原因仍未证明、原始截图/native日志未上传；本轮恢复修正依据受控复现，不称已复跑Mac自然现场或模型质量验收。

## e72新增发现及关闭

| 实际发现 | 原RED证据 | PM修正与最终代码 | 独立关闭结果 |
| --- | --- | --- | --- |
| P2：旧GET正文挂起的超时错误在同owner较新请求已完成后晚到污染UI | `late-read-error.log`/`.test.ts`：较新全文已展示，旧A超时仍显示原请求保留/超时 | `BusinessRoleConversation.tsx` load catch先核alive/ticket，过期error像success一样丢弃；两个后台观察不再把被取代的undefined读作权威idle清错 | 原样探针 `late-read-error-green-worktree.log`，旧read确实abort、较新全文保留且不出现旧告警；永久PM回归在71中通过 |
| P2：空方案Plan/关联入口await草稿保存后，卸载旧事项仍导航 | `business/late-plan-navigation-probe.json`，callbackCount1，旧case/issue回调 | `CaseIssuePanel.tsx`三个await后核mounted，DOM RAF前亦核；不撤销已成功保存原草稿 | 原样GREEN callbackCount0；永久测试覆盖Plan及关联两个入口。完整根因/旧新版hash在business报告 |
| P2：Case创建早期刷新时首事项未完成，卡片缓存0 | `business/first-issue-refresh-probe.json`及旧e72正式03/04图显示第三Case0事项；只测标题会遗漏 | `CasePreparation.tsx`保留created通知表达部分成功，准确finishFirstIssue成功后再通知；永久浏览器断言API首事项1+卡片1+继续当前事项，稳定本轮概览后截图 | 实际组件原样GREEN通知1→2、卡片0→1与继续当前事项；最终生产E2E/截图另见下方增量 |

原证据与限制明确：上述前两项是实际组件bundle+hook harness的受控异步时序，不假称自然Mac串案；第三项有正式e72生产图与组件因果佐证。子复核首次GREEN副本曾重生成共用辅助harness，已恢复e72固定原辅助，并改独立GREEN目标；原RED脚本/JSON未覆盖，方法限制见business增量报告。

## CF／FR／任务逐项矩阵

| 基准→预期 | 实际代码/入口 | 证据与差异 | 结论 |
| --- | --- | --- | --- |
| CF01 / T02：EOF、读异常、漏终态有限只读恢复；不stop/open/messages重放，准确owner/request及迟到清理 | `strategy-discussion-client`观察超时；`BusinessRoleConversation`流重接/3500ms静默对账/10s完整GET期限与owner signal | 71项内CF01、FR01、PM body-stall/unmount、旧error晚到；PM 50s真Host持续心跳日志每5s检查均完整终态，0重放/stop；原e72旧error RED已修 | PASS；最终05b图与本人详情页均完整回复，无继续回复假状态 |
| CF02 / T03：持续心跳不掩盖首帧缺失，安全分类，GET idle不解connected；有效显式重连恢复草稿/首发 | `runtime-client`默认15s首帧独立计时、错误白名单分类；server仅固定安全错误类别；原App connected门禁保留 | 本人Task观察/CF02单位及owner/异请求负例；PM生产E2E含耗尽disconnected→合法snapshot重连→真实SDK首发完成，不自动open/messages/stop | 代码/所核测试PASS；不将空sessions判失败 |
| CF03 / T04：无方案说明、保留理由/下一步、准确Plan准备及原回复接回，不物化G/S | `CaseIssuePanel`局部空态+原choiceDraft；`CaseBoard`透传原关联入口；原Plan/choice/Board权威未改 | CF03组件、卸载后导航原RED→GREEN；PM真实Plan→交回→取舍→授权→反馈→原记录/原看板历史链日志/图；e72缺口不被旧PASS抹去 | PASS；本人有方案/无方案modal与PM完整授权反馈链图证一致 |
| CF04 / T05：choose/observe完整target、新建/修订/null/CAS说明，安全字段诊断且原授权/来源拒收不降 | `strategy-discussion.ts`原工具schema与安全error投影；`strategy-discussion-host`从原owner/SDK source核参数 | 本人CF04 Store/schema/安全路径负例通过；业务子复核逐字段核；PM真实Pi两次失败后自主纠错并保存rev1，未加Host固定推理循环 | PASS于实际影响；原首页派生权威不改 |
| CF05 / T06：确定本地错误定位/聚焦、零业务误写，已知4xx与UNKNOWN/部分成功分开 | `CasePreparation`写前字段检查、focusRef、definiteClientReject和stillPending分支，草稿按钮正名 | 本人准备UI/CF05通过；PM生产图聚焦个人归属名、零Goal/Create POST；旧operation/采纳/草稿权威与请求标识未改 | PASS于实际影响；不扩大跨Store原子承诺 |
| CF06 / T07：三分支创建/继续、直接返回准确唯一新Case及首事项，筛选/输入保留；失败显示旧快照 | App refreshSeq、CaseBoard listStale、CasePreparation created与首事项成功双通知 | 本人/子复核原RED→GREEN；永久浏览器升级从只标题到API与卡片首事项计数；旧e72 0件图保留 | PASS；最终API/卡片断言及本人总览均为第三Case 1事项/继续当前事项 |
| CF07 / T08：动作AX名含所属项目、同原ID/空闲准入/只读及键盘焦点 | ProjectNavigation/ProjectBoard仅AXname，原闭包ID与归档服务不变 | 本人单位+业务diff核；3份旧浏览器定位器只同步新AXname；PM同名两项目只归档一个、Esc归焦点 | PASS于实际影响；不把同名字串当唯一ID |
| FR01：开流持续心跳但无终态仍恢复，不误杀慢运行，有界失败与清理 | eventIdleTimeoutMs + shouldExpectEvents；独立quiet reconcile与有限错误退避 | 本人FR01覆盖7s慢busy仍回复、后completed自动完整、4次503后停轮询；PM50s持续心跳同受控故障恢复日志；新增GET正文deadline覆盖headers+JSON | PASS；期限只关闭观察GET，不停止运行 |
| FR02：观察耗尽→重连→首发，以及Plan→取舍→授权→反馈→准确原历史完整E2E | 永久browser-case-trial-followup的CF02/CF03段及生产dist隔离runner | PM最终receipt 7检查PASS、16图均本人实看、运行身份与本人只读浏览同a643；非本人执行E2E | PASS；执行者与图证核验者分列 |
| T01：有效输入/冻结实际阅读与映射、唯一写入者/IN01–07 | 本复核实读同源入口/全部spec/tasks，实际只读HTTP浏览冻结Demo | 独立冻结5图、frozen/structure.json；原领取/Issue回执按现有implementation/second-review证据，未独立重读远端账号领取记录 | 复核阅读PASS；原Git领取流程不冒称本轮重跑 |
| T09：完整候选适用检查、真实Host/SDK/浏览器、全新非作者/四原则，原失败/跳过保留 | 原实施记录 + PM接修 + 当前独立矩阵/输入hash | 本人71及3个原RED→GREEN；官方边界/typecheck；PM正式build/受影响40/E2E分开；最终源/图已由本报告与hash矩阵绑定 | 本轮工程复核PASS；未测/用户门禁继续保留 |
| T10：用户看本候选真实图明确确认后才PR，再head CI/合并/main CI与结案 | 根PM后续流程 | 当前用户新截图确认、PR/head CI、获授权合并/main CI均尚未发生 | **待执行，不能据本报告提前PR** |

## 原DW01–18及冻结交互影响映射

逐项结论只覆盖本候选影响；“原权威未改”不代表本轮重跑旧产品全集。

| 冻结基准 | 候选影响与核验 | 结论／实际边界 |
| --- | --- | --- |
| DW01 导航与等价入口 | 本人冻结/产品首页、Decision Case总览与详情往返；PM全部项目图 | PASS所核导航；原关系/管理入口无删除diff |
| DW02 G/S常驻、四页签、准确本轮原记录 | 本人稳定详情1440/1024/390与本轮概览DOM；源自保存记录且不把行动当达标 | PASS所核呈现；未重跑所有四页签业务写入 |
| DW03 列表/树及真实有向关系 | 本人冻结列表/树骨架及候选侧栏、PM星图/卡片；关系读写权威无diff | 原语义未改；本轮未重做多前驱关系写入全集 |
| DW04 浏览范围与协作事项分离 | CaseBoard原选择/范围回调无更改；CF03仅透传关联入口，原owner选择仍由原链处理 | 无发现回归；所有手选范围组合未独立重跑 |
| DW05 真实关联与准确来源 | CF04 owner/native/schema负例；PM Plan交回保留准确来源的40项受影响测试及最终原反馈图 | PASS受影响来源链；未重验所有资料权限排列 |
| DW06 全部项目及往返 | PM同名项目/关联原项目链、最终11图；本人入口/详情往返与零写 | PASS受影响链；独立/共享/归档服务原权威保留 |
| DW07 原项目归档准入与保护 | ProjectNavigation/Board仅AX名；CF07两同名项目只归档目标、原准入服务无diff | PASS所核；不引入stop/结束Case/任务启动 |
| DW08 首页明确请求 | 本人首页实际显示原承担人/轮次/请求时间，CF04原工具只保存明确请求；首页派生算法无diff | PASS所核；不把缺choice/feedback泛化成待办 |
| DW09 准确请求回应 | 本人只开关modal不写；PM Plan→choice→授权→反馈→原轮次/看板历史 | PASS受影响正向；无首页额外完成操作 |
| DW10 共用轻输入/可选整理 | CF05本地错误零POST；手填可继续；Home/Preparation入口实际浏览 | PASS受影响；未调用真实模型验证推荐质量 |
| DW11 三分支及不按标题合并 | CF06单位、原保留名称/背景/来源；实际第三Case创建后API与卡片1事项 | PASS受影响；全部历史三分支实Host组合未另重跑 |
| DW12 待带入片段保护/明确发送 | 本人详情有准确创建原文与来源、未自动追加/发送；PM Plan交接保持取舍草稿 | PASS所核；原片段权威未改 |
| DW13 草稿/导航/冲突与重复 | Task断连草稿→显式重连首发；CF03理由/下一步往返；卸载迟到导航原RED→GREEN | PASS受影响；所有原生重开/版本冲突组合未再独立穷举 |
| DW14 部分成功及原operation | CasePreparation本地确定拒绝/UNKNOWN边界原ID保留；首事项未完先通知、成功再通知 | PASS受影响；无新增跨Store原子承诺/写入自动重放 |
| DW15 目标结果与证据 | G/S/目标结果算法及源记录无diff；本人本轮概览明确行动与目标结果分别记录 | 无发现回归；未独立重验全部目标结果算法 |
| DW16 异常/旧快照/迟到/不重放 | CF01/02、FR01、body-stall与旧read-error原RED→GREEN；Case listStale/refreshSeq | PASS受影响；只读恢复不stop/open/messages，撤权原权限边界保留 |
| DW17 响应式/焦点/安全文字 | 本人冻结5图+产品8状态，1440/1024/390，modal390全控件可达、Esc归记录取舍；PM dark/字段聚焦/同名AX | PASS所核；1024原侧栏底部项目区较紧但本候选无CSS变化，未视为新增阻塞；全部旧XSS/树键盘排列未重跑 |
| DW18 原身份/历史/工程与模型采用分离 | 全19产品/测试diff、官方边界、本人71测试、3因果探针、PM真实Host合成SDK E2E、四原则 | PASS工程复核范围；不覆盖Mac自然现场、真实模型质量或用户设备采用；T10待用户新图确认 |

## 四原则与IN01–IN07

1. Host仅管理输入、身份、观察状态/期限、原权限、固定安全错误、业务保存与列表失效；不生成专业方案、不复制G/S、不代人选择/授权/反馈。
2. Agent继续沿原Pi工具自主选择与纠错；Host schema/错误只指出参数合同，未加固定分析步骤、强制工具次数、模型重放或第二推理循环。
3. 原官方Pi1.4.0、Interface v3与各owner/profile、CaseStore/Board/draft/CAS/native来源继续权威；无依赖/锁/SDK改动、新生命周期账或全局队列。共享watch新增opts可选，原StrategyDiscussionPanel无opts调用兼容；前端只读恢复不是新Agent Runtime。
4. 局部引导、精确字段聚焦、正常自动刷新减少搬运/重复点击；无新增日常必做确认。必要取舍/授权仍由用户明确做，connected门禁及未初始化新Task不提前open规则保留。

IN01规则实读，IN02/03原Host注册与公共生命周期无diff，IN04业务适配/owner差异未混入公共内核，IN05字段错误与SSE只给白名单安全类别、不复制路径/输入/凭据，IN06没有不兼容公共接口改变，IN07以共享会话/第三合成消费者/Task owner负例/取消迟到与真实Host E2E互补。通过的是本轮所核范围，Mac/真实GLM/官方归档独立重核仍未执行。

## 最终产品视觉／只读浏览增量

本人先通过独立HTTP实际操作冻结Demo首页／总览／详情／取舍，亲看5张1440/390截图及DOM/CSS骨架；随后亲看旧e72 16图，发现0事项/过渡态。原e72图与FAIL保留在PM的 intermediate-e72-product／production-e72-e2e.log。b88选择器错误（h3带◇）仅导致测试等待超时，原日志/图保留为 production-b88-selector.log／intermediate-b88-selector；a643只更正region定位器，不改产品。以上旧图不用于本候选用户确认。

最终PM正式clean构建的dist由Host同源直接服务，本人独立新Chromium context实际打开 http://127.0.0.1:43966 ，读取 /api/health 后只浏览现有数据。运行身份：commit a643bf00e79cba01933cbaa49a1616ecb675cf12，tree d9ab4d03512adf10a46b7bcb83dc4f8345a63e35，builtAt 2026-11-28T12:58:52.498Z，dirty=false，codeRoot为本候选树，instanceId 61e609cf-6867-40a9-920e-dd14996176bc。本人所捕获8状态记录在 final-browser/receipt.json，writes=[]、pageErrors=[]；没有模型/业务写操作。所有状态pageWidth与1440/1024/390视口宽度相等，390modal矩形358×721位于视口内，Esc后焦点回“记录取舍”。浏览后已通知PM，可正常关闭其所持精确进程，未杀用户服务。

| 冻结／预期 | 本人亲自浏览与截图 | PM最终16图及收据独立实看 | 结论 |
| --- | --- | --- | --- |
| 首页、准确待回应、继续入口 | final-browser/01-home-1440 | final-product/01-home-light-1440、02-preparation、12-field-validation | 骨架与原来源保留，局部校验明确聚焦；未误触发新写入 |
| 总览星图/卡片、创建即刷新 | final-browser/02-overview-1440读取3卡均1事项，第三有继续当前事项 | final-product/03-map、04-cards；永久E2E同时断言API第一事项1/卡片1/继续 | e72缺口关闭，非只截图标题 |
| G/S、四页签、稳定本轮概览及完整会话 | final-browser/03-detail-1440、06-detail-390、07-detail-1024 | final-product/05-detail、05b-heartbeat-recovered、08-dark、09-1024、10-390 | 稳定原记录完整显示、FR01终态读回；页面无横向溢出 |
| 取舍modal正常/空方案、明确Plan或关联入口 | final-browser/04-choice-1440、05-choice-390、08-empty-choice-1440 | final-product/06-unlinked、07-linked | 不把G/S当方案；原理由/下一步输入保留；390控件/页脚可达，Esc归焦 |
| 全部项目同名消歧与原反馈 | 本人看入口与准确关联只读资料 | final-product/11-all-projects、15-feedback-history，CF03完整Plan→取舍→授权→反馈→原历史receipt | 同一原项目/记录；反馈“未知”与实际观察分开；无Host代授权 |
| 任务首帧缺失、合法重连不丢输入 | 未触发业务写入；只实看原始最终图/receipt与测试 | final-product/13-task-disconnected、14-task-reconnected-draft | disconnected仍禁发保留草稿；显式重连后合法snapshot恢复再真实SDK首发 |

PM最终 e2e-receipt.json 为7检查PASS（CF05、CF06、CF02、CF03、CF01+CF04、FR01、CF07），synthetic Provider请求7，pageErrors=[]；consoleErrors8条404为隔离草稿尚不存在读回，未掩盖失败。本人不声称重跑此完整E2E；本人独立0写浏览与全部16图核验为交叉证据。全部最终图片、本人图片、冻结图与收据hash在 final-hash-matrix.json。截图构成没有重新设计布局；原冻结流程仍可达，CF03只加必要局部空态入口，CF05聚焦具体已有字段，CF07仅补AX上下文。

当前HEAD仍a643，19个产品/测试与冻结/依赖/规格输入再次逐hash匹配；30输入中仅tasks.md在PM归档时追加2行，明确原RED保留、引用本报告、T10仍未勾选，差异存tasks-evidence-increment.diff。运行时dirty=false来自构建与同源health。最终收口时PM正在加入implementation/tasks状态、报告/图证未提交文件；这不冒称当前工作树clean，也不影响已固定产品字节。若后续证据-only提交需另核产品与测试hash仍等于本矩阵。本报告只授予工程复核PASS，T10用户新图确认未发生，不创建PR、不授权合并。

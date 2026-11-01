# 生命周期补齐：实现与验收记录

2026-11-01，Asia/Shanghai。用户已确认[补充A](lifecycle-supplement-proposal.md)并要求继续实施；本页承接[初始v2阻断](implementation-result.md)，保留旧FAIL、UNKNOWN及未运行项。候选5本地工程完整检查及非作者Standards/Spec增量复核通过；五题真实模型在固定候选4完成，专业全文仍有重要FAIL，不推广为可靠自动纠错。下文按候选和阶段保留原始证据，Git/CI、运行采用及产品验收未进行。

## 已实现的环境边界

仅显式开启自动核算、具有本Host可信创建起点的新任务，从首段工具代码前采用受管ordinary环境。Python、bash、codemode保持由Agent自主调用，过程和报告可写020/060，后台计算可跨工具结果继续；正常交接先drain等自然结束，再close取得实际收尾回执。用户停止可打断等待并回收本owner资源，UNKNOWN保持占用，不重放模型。未开启普通任务沿原策略。

执行器没有模型或分析逻辑。可信SDK继续处理原Provider及原canonical会话，唯一写原native；无模型guardian持有未reap的进程组leader身份，工具代码不得脱组、操纵guardian、伪造管理事件或通过已有代理/网络/Mach创建脱管执行。受管模式暂不开放用户执行扩展及既有/远程MCP，只读skill材料可安全复制；Python使用已安装同版本直接解释器，不安装专题计算工具。

Host的可信起点只登记实际新建owner，GET、重放、历史扫描、重启或原生opened/closed标记不能自授资格。旧任务、重启后旧owner、未知fork及同项目已知未托管任务/手动核算写入者仍拒绝自动交接，保留原文件和会话；关闭自动设置后可普通分析。不宣称给全部旧项目完成了迁移或清场，也不把本owner关闭扩大为全机/远端收尾。

## 候选1：保留的失败

固定运行源码与永久测试251文件，清单`.local/automatic-verification-revision/lifecycle-supplement/review/candidate-1.json`，SHA256 `9b124ea6496ce6aa39e50b82e779640486a7a9e1e747e2612ad033abde7dcfe1`。基线HEAD仍`b36a42b43e86a279b1931770022c50b306ceeb36`；既有A/B/C工作未重置。

全量`npm run check`：694项，692 PASS、1 FAIL、1平台不适用SKIP，因测试失败未进入构建。FAIL为cold流式执行中停止返回500；现场`engineering-runs/47d72682-faa2-42b6-b176-2308e38e2d55`及日志`lifecycle-supplement/check-candidate-1.log`保留。该cold没有工具执行，native已记录取消和关闭，不归因guardian进程组。

两位全新非作者分别只读核对起止251/251身份并提出：

- Standards ST-01：清理前落cancelled，失败仍显示已停止，UI误将500后的读回当成功。
- Standards ST-02：正常finish失败又走catch的finish，隐式重试未知清理并释放owner。
- Spec F1：compare/recheck交回作者前遗漏核算资源quiesce，实际后台Python仍运行时作者已收到请求。
- Spec F2：GET/SSE恢复把仍被整链lease占用的任务投影为idle，发送和停止入口失真。

报告及隔离反例在`lifecycle-supplement/review/standards/`和`review/spec/`。这些属于资源、停止与状态记录问题，不通过分析提示词或Host补算修复。

SDK停止与关闭的独立IPC反例已连续两次RED：停止与公共finish关闭并发时，独立stop RPC未回即断开。managed stop改为复用单一close/dispose任务；关闭流程仍取消原模型、回收工具、等待idle并要求实际closed ACK，不以杀driver冒充成功。修复后定向6项及runtime/protected39项PASS，原AV07在新隔离根通过；旧失败保留。公共层另补未知close/quiesce/stop不得被finally隐式重试的回归，42项新旧公共测试PASS；包含父finally不能将一次性失败的子清理暗重试，以及显式parent close才透传retryFailed资格并清理准确子owner。此处仅为受影响检查，最终候选完整检查及非作者再复核待完成。

## 实际界面受限核对

隔离测试Host及4284页面中，浏览新任务后保存自动设置成功，模型请求0、native与lastRun未创建；设置显示后续请求最多返修2次。截图在`lifecycle-supplement/ui/enabled-new-task.png`，有效读回为`ui/runtime-1/browse-save-receipt-v2.json`。首次读回脚本漏HTTP准入头，旧receipt不作为证据并保留；该问题不属于产品行为。测试Host/Provider/Vite均正常关闭，未切换原运行服务。

## 预先固定的有限真实模型比较

仅在本补充最终保护/生命周期检查和非作者复核通过后开始。公开输入与产品外真值分别封存在`lifecycle-supplement/evaluation-v1/`；产品只获得公开题目和逐份源资料，不挂载整个评价目录或真值。固定5题、每题1次初始尝试，不按结果补跑：3个新业务自然题，2个受控外部稿。每题配对比较同一固定首稿与原canonical自动交接后的实际末稿，不另抽更好的首稿；受控保存不冒称自然分析错误。

主/核算使用同一已批准MiMo V2.6 Flash配置revision2、原SDK线路和实际缺省thinking high，返修上限2次，模型费用与内部工具/分析循环无新增上限。原本机selected模型及凭据只读保全，配置只经隔离Host原正常保存入口复制，不打印密钥、不Provider中转、不fallback、不重放业务请求。SDK原生重试与可观察HTTP分别记录，供应商最终结算未知仍未知。

评价先逐份全文独立判定重要错误及必要结论缺失，再揭开首稿/末稿配对；真值不反馈产品。分别记录首稿错、作者错误检出/漏报/误报、核算自身新增错、主Agent纠正/误改/遗漏、每稿复查漏报/误报及未交付，不能相互抵销。能实际导出的报告、最终回复及过程可用范围均纳入；无法完全盲化的报告自述如实记录。产品外评价不是Host第三裁判或继续返修门槛。

完整工程通过、有限专业收益、Git/CI、运行采用及用户验收分别报告。没有可证全文收益或出现重要退化时，不宣称可靠性提升。本轮不Git/CI、不切服务、不安装扩展、不操作MacBook。


## 最终工程候选3

候选3运行源码与永久测试252文件，固定清单`lifecycle-supplement/review/candidate-3.json`，SHA256 `1948969f4301a271e75c946356cca8835353e227595b1e2d2af91f7b16dab57e`。完整`npm run check`退出0：712项中711 PASS、0 FAIL、1项当前Mac支持保护故跳过“不支持平台”反向分支；静态接入、类型及构建通过。构建保留原大chunk提示，不另扩包体优化。精确日志`lifecycle-supplement/check-candidate-3.log`。

候选2的增强测试将同一author首HTTP及write工具回包都计作新入场，得到`[true,true]`而断言`[true]`；两次实际收尾事实均为true。作者冻结后修正该测试，造成一次读取漂移；候选2原712项709 PASS/2测试FAIL/1 SKIP及漂移清单保留，不充当固定源码通过。候选3只收纳该测试修正，产品运行源码与候选2完全一致，随后重新完整检查并复核全部252份身份。

两位非作者分别给出Standards有限范围PASS与Spec PASS_WITH_SCOPE，无新增可行动发现：原4项finding逐一用独立反例闭环；公共/Host/SDK/UI独立定向88项通过，另有5项独立probe及ProjectAgent定向6项通过。真实macOS probe验证防脱组、guardian信号边界、跨工具后台持续、单次close后ESRCH/无晚写，伪造管理IPC不能取得ACK。报告在`review/standards/candidate-3-standards.md`与`review/spec/candidate-3.md`；它们不是模型专业正确性或全机/远端安全证明。

最终实际HTTP产品页再核启用前权限说明、保存及焦点恢复，模型请求0，未提前创建native/lastRun；截图`ui/candidate-3-permissions.png`、`ui/candidate-3-enabled.png`，有效收据`ui/runtime-2/browse-save-receipt.json`。隔离Host/Provider/Vite均正常关闭。


## 模型调用前的准备失败保留

首次harness准备在`live-evaluation/runs/first5-candidate3/`记录5个NOT_RUN_SETUP_FAILED，initialDispatchCount合计0，未调用模型，五个隔离Host均CLOSED_ONCE，原配置/凭据/selected字节未变。它不占五题的首次模型尝试，也不是模型质量FAIL或已完成专业评估。

实际原因是外部边界探针在普通messages会做的企业资料目录初始化之前运行，读取的catalog/bodies/files尚不存在；不是产品Task DTO遗漏路径字段，初步猜测已撤回。harness通过正常企业资料GET完成同一初始化，并在一个新隔离Host以合成key、相同MiMo profile/revision/route做0messages/0model烟测：实际项目读取成功、公开评价源读取被拒、probe正常关闭，未创建native/lastRun，Host/后代均退出。未扩宽forbiddenRoots或改产品源码；原现场与旧计划保留，新harness重新冻结后才进行首次模型请求。


## 实际预设模型入口发现的配置身份缺陷

候选3实际请求在`live-evaluation/runs/first5-candidate3-live01/AVR-LS-N01/`被HTTP400 `invalid_automatic_configuration`拒绝，未获202。harness保守记录UNKNOWN并停止后四题；后续只读核验确认没有native、lastRun、observation、链或SDK子进程，busy=false，实际Provider调用仍0。原UNKNOWN及拒绝记录不覆写；追加`rejected-admission-readback.json`和`rejected-admission-closeout.json`，在准确空闲身份核验后只对该测试Host发一次SIGTERM，正常退出，未重发消息。

缺陷为自动Store在设置的configurationId及捕获配置id两处误限UUID，而现有ConfigStore允许1–100位字母/数字/下划线/横线（排除`__proto__`、`prototype`、`constructor`），预设`mimo-v26-flash`本来合法。修复只与这一既有规则对齐，不改变owner/request的UUID、字段白名单、模型、线路、参数或业务问题。该400是产品配置兼容FAIL，不能归为模型专业错误；候选3工程/复核证据仍限当时范围。

候选4源码只变自动Store及两份永久测试；Store21项、公开HTTP+真实SDK合成Provider的预设默认/显式核算配置两条链通过，原双HTTP400及因果RED保留在`configuration-id-fix/`。候选4固定清单`review/candidate-4.json`，252文件，SHA256 `0120de587f3eb90c195a84d12f34090c37645a24c39f3ec5f515ddf633cdc59a`；最终全量检查及非作者增量复核正在进行，真实模型的五题仍未开始。


候选4最终`npm run check`退出0：717项，716 PASS、0 FAIL、1项当前Mac支持故不适用的反向平台SKIP，静态接入、类型、构建通过（原chunk提示保留）。Standards及Spec增量独立复核均有限范围PASS，无新增发现；独立与真实ConfigStore交叉30值、Store21项、79负向断言、公开HTTP正反/无fallback/无worker及旧UUID记录字节保全均有分层证据。252/252身份复验一致，原3生命周期/OS证据只在未改源码范围复用。最终报告为`review/standards/candidate-4-standards.md`、`review/spec/candidate-4-spec.md`及`check-candidate-4.log`。模型、线路、参数和公开题目保持原定，后续新计划才开始首次实际Provider分析；不会把前述0调用现场计成专业尝试或删除。

## 固定模型运行期间另发现的字节边界（待本轮结束后修复）

只读核查发现，新稿UTF-8解码没有设置ignoreBOM，会剥掉BOM再交ProjectStore保存，固定副本却仍用原bytes。真实Store离线反例：带BOM输入46字节、另存普通报告43字节，固定副本46字节，两个SHA不一致；无BOM控制一致。后续固定校验会安全暂停而不是错误宣称复查完成；仍属于新稿字节/版本合同的实际缺陷。

该反例没有调用模型或打开SDK，不代表本轮具体稿已经发生BOM错误。当前五题模型输入、源码候选4和harness保持冻结；本轮结束后再单独补ignoreBOM保全与实际SDK回归、受影响检查及非作者增量复核，不中途混换源码或重跑挑稿。因此本补充尚有此项必要修复未完成，不把候选4的有限检查通过说成所有边界已解决。

## 真实模型进行中的分段记录（尚非五题结论）

运行 `live-evaluation/runs/first5-candidate4-live01` 使用候选4、harness v2和预先固定的公开输入。N01、N02各一次初始真实尝试均已完成，资源各正常关闭一次；N03已进入首次独立核算，后两题尚未评分。未因结果重跑、换模型或将产品外真值反馈Agent。

N01保存三份报告，返修两次，每份新稿均有对应复查，最终到达已批准的返修次数边界。两位独立评价者对三份全文均未发现重要错误或必要结论缺失，因此不能将版本增加说成消除了重要错误。另有实际UTC反事实表述错误连续保留并被比较和两次复查漏报；核算冷读过程自身也有局部错误，最终稿对核算独立性的表述仍有夸大，均分别保留，不能用核心数字正确抵销。

N02首稿与实际末稿v2的核心业务结论均正确，返修建议主要涉及分解次序及解释，不计作必要错误纠正。主Agent第二轮选择维持v2，Host按未提交新稿结束；不强制产生第三稿。修订回复有区间笔误，该回复并未交付复查，应记作未交付材料而非复查已读后的漏报；复查自身对表格变化的证据描述另有局部错误。

全文逐稿评分已先于首末配对冻结在 `live-evaluation/grade/reviews/blind/stageA-round2.*`、`stageA-round3.*`；独立过程评价为 `grade/reviews/verifier/case-n01.*`、`case-n02.*`。报告自述可能暴露修订身份，不能宣称完全盲化；尚未完成题目不计零错误或技术失败。

原harness只导出主会话，不能把其计数当成双方总调用。另用只读 `supplement-native.mjs` 对已经关闭的实例追加完整会话导出：N01主29＋核算25＝54条去重HTTP观察，7次SDK业务请求完成；N02主26＋核算31＝57条，6次SDK业务请求完成。原线级事件均标记failed/UNKNOWN，与业务完成事实并存，不能说成54/57次业务失败，也不能据此推定供应商结算。补充只导出已关闭实例，不改变原收据或在途会话。

### 第三题结束后的追加

N03于UTC 04:45:15.745开始、06:03:12.451结束，约78分钟。同一次初始尝试，三份实际报告、两次作者回合及各自新稿复查，最后到返修次数边界；没有重发初始任务或中途更换模型。原会话身份/前缀、源资料、普通另存/固定副本/导出稿SHA和实际复查归属由只读技术汇总核对，gaps=[]，CLOSED_ONCE。

追加 `supplemental-native/n03-coverage-01` 只导出三个已关闭实例，N03主60＋核算47＝107条去重native HTTP观察，7次SDK业务请求均完成，实际owned执行关闭标记齐全。它仍不是供应商总调用或结算证明。本题的长耗时保留为实际运行事实，不凭工具调用数量和稿件增加证明专业收益；逐稿盲评与过程评价另行冻结后追加。此时C01正在首次执行，C02尚未评分。

### 第三题专业FAIL：逐稿及过程评价已分别冻结

逐稿全文评价 `grade/reviews/blind/stageA-round4.*` 在未揭开private映射前冻结；过程评价 `grade/reviews/verifier/case-n03.*` 未读另一评分，分别冻结后root才配对。两位都判定三稿全文FAIL、必要遗漏0，且一致确认三类重要问题持续存在：把共同改善确定归因返券而非提醒；把最乐观CI上界回本当作进入经营“已验证/可承诺”的门槛；把80%功效MDE当作必然检不出的硬界线。当前观察数字和“不作有效/收益承诺”的主结论正确，不能抵销全文其他明确断言。

过程评价确认上述三类错误在已交付全文中可见，compare、recheck1、recheck2均漏报，三类重要错误消除0。盲评的重要根因数为首稿4、v2 3、v3 3；过程评价将首稿的另一个“最有利上界/单盒回本量级”问题按本题当前结论不变列为非重要、并确认比较后得到澄清，故为3/3/3。两份原判定及重要性差异都保留，不取平均或改写成一致分数；双方一致确认的末稿重要FAIL不受该差异影响。

首次真实最后回复另称“提醒增量贡献为零”，也属重要错误；它未被report-only compare交付，按未交付处理，不能算核算已读后的漏报。v2新差值解释错被复查指出、v3已修正；v3新增df稳健性断言错被末次复查指出，但没有后续改稿，不能记为已纠正。这些局部纠正、核算检出、新增错误、持续漏报分别保留。

因此，当前有限专业验证不能记为通过，也不能推广“自动纠错已可靠”。本轮仍按预先固定顺序完成C01/C02，结果不用于抵销N03，不将真值或评分反馈产品、不重跑挑稿、不为通过临时增加作者回合。待修的BOM字节问题属于工程保全，不能被描述为已解决这些专业错误；Host不代算或裁定双方分析结论。

### 第四题受控纠错成功，保留局部问题

C01的公开外部稿、实际首稿导出及固定v1均为613 bytes，SHA256 `77c873e52a3dec861317ad3c876a3bcc84f0290ff82ab791ec5f17b8c006baa2`，三方精确一致。初始主Agent按题目要求原样保存，回复明确没有评判或认可，不能把这份预设错误稿计为自然模型分析错误。

`stageA-round5.*`全文评分先冻结，`case-c01.*`过程评价独立冻结后才配对：外部首稿FAIL，实际v2/v3 PASS。讲师费遗漏乘六场导致讲师成本、直接成本、结余和续开门槛四项关联断言出错，按一条重要会计错误链计数；compare检出，author1实际执行修订完整改正，后续保留。合成题中实际直接结余为1510.62、距门槛989.38，没有因此误写成亏损、已执行或永久关停。

核算cold过程及两份新稿仍有“间接成本使缺口更大”与本题直接结余门槛混说的非重要瑕疵，两次复查漏报；新稿主表正确，不能因此隐去局部问题。共三稿、7次SDK业务请求完成，main19＋verifier32＝51条去重native HTTP观察，owned资源正常关闭一次。完整技术范围及wire/结算UNKNOWN边界同前。

本题证明该固定受控稿的纠错链实际发生，不证明自然错误率、全部专业结论或今后计算必定可靠，也不抵销N03。第五题C02继续首次真实运行，尚未评分。

## 五题真实验证收尾：技术走通，专业验证未通过

五题均按固定顺序各一次初始真实尝试，实际Provider阶段没有重发初始任务或按结果重跑。原主Agent保持同一canonical历史，14份链内稿件、9份新修订稿及其对应复查全部保留，10次意见交回作者由其自主处理；N02末轮没有新稿，故复查总数为9。共34次SDK业务请求完成、五个测试Host均正常关闭一次。源材料、报告普通另存/固定/导出SHA、native初始前缀、配置及原selected字节保全由只读技术汇总复验，五题gaps=[]。

| 固定题目 | 类型 | 实际链内版本 | 首末全文结果及限度 |
| --- | --- | --- | --- |
| N01 | 自然分析 | 3 | 必要结果正确，重要错0；局部时间反事实错持续漏报，不证明重要纠错收益 |
| N02 | 自然分析 | 2 | 必要结果正确，重要错0；主Agent末轮维持v2，局部回复/证据措辞问题单列 |
| N03 | 自然分析 | 3 | 三稿均FAIL，至少三类双方一致确认的重要错误持续，比较及两次复查漏报 |
| C01 | 受控错误外部稿 | 3 | 外部稿FAIL→新稿PASS，一条重要会计错误链实际纠正；局部口径瑕疵保留 |
| C02 | 受控正确外部稿 | 3 | 三稿PASS，无误报或退化；没有发生误报，拒绝误报能力NOT_TESTED |

C02公开种子、实际首稿及固定v1三方均1057 bytes，SHA256 `94e1a9bd56c4da99192a1a49461883dd2c5173c55216eab7c46f47fcde98d403`。初始Agent原样保存后又自主计算并额外生成`AVR-LS-C02-final.md`，该额外稿在过程评价中实际核对正确、原件保留，不抽换成配对基线，也不混入14份链内匿名全文的盲评分母。v2/v3仍保持合法未知与权限边界，额外人数、日期和比率是正确算术补充，不计为原稿错误被纠正。

全部链内全文评分先冻结为`stageA-round2`至`stageA-round6`，五份`case-*`过程评价各自独立冻结，未互读或反馈产品；之后才揭开映射配对。报告自述使严格盲态不完整，故不称完全盲化或随机对照。三道自然题和两个受控稿分别解释，不能以C01成功抵销N03失败，也不能用正确稿无误报冒称已经检验拒绝误报。

最终补充会话覆盖为main154＋verifier172＝326条去重native HTTP观察；原suite的154和`providerHttpObservationComplete:true`保留原样，只对应其原main导出范围，不采纳为双方或供应商完整调用证明。原wire均failed/UNKNOWN、34次SDK业务请求completed及供应商结算UNKNOWN分别记录，不将326称为业务失败、Host重试或最终账单。

最终技术汇总`grade/reviews/technical-closeout/final-01/summary.json`，SHA256 `c5a1d955bfe6453c7b799a5810065ebdfdb16001faf21754c27bd7083c84f318`；实际source4的252文件已按原摘要逐份归档，并起止复验源/副本及3份harness、5份合同身份。独立release证明SHA256 `e3823d371f3b9d1a12625afd54e53420dc39f013eb71bcf435d7455974f1f207`。9份实际新稿均无BOM，不能称本轮模型已经覆盖带BOM分支。

## 候选5：只修新稿UTF-8字节保全

在五题shell退出0、完整导出和上述独立release后，root再次验证source4的252文件，再应用已预演补丁。只改`automatic-verification-host.ts`解码保留BOM和`automatic-verification-flow.test.ts`实际SDK永久回归，两份内容与隔离预演逐字节相同；其余250文件保持原摘要。固定候选5清单为`review/candidate-5.json`，252文件，SHA256 `c6456e71fcd9701bc4b62bd71c7eebdcf4093ff177bbbae6fd906e10f5277312`。

候选5完整`npm run check`退出0：718项，717 PASS、0 FAIL、1项当前Mac支持保护故不适用的反向平台SKIP；静态会话边界、TypeScript类型及构建通过。BOM实际SDK永久回归在完整检查中通过。日志为`check-candidate-5.log`，原Vite大chunk提示保留，不另扩包体优化。

非作者Standards增量复核有限范围PASS、Spec增量复核PASS_WITH_SCOPE，均无新增finding。分别起止确认252文件身份，源4归档与候选5仅两份约定差异、内容与预审preview相同；各自在独立隔离根运行BOM及无BOM实际SDK合成Provider两链2/2通过，另独立确认UTF-8字节、旧稿/native前缀、request及固定SHA/复查归属。原4未变生命周期/权限/兼容/界面证据仅在同摘要范围复用，不冒称在5重做全部旧探针。

最终两轴报告为`review/standards/candidate-5-standards.md`（机器记录SHA256 `f3997dda2b7e1b124e7c974b476b88351ecbc1f29681cb4c33ec6b38c9bb1ab0`）与`review/spec/candidate-5-spec.md`（机器记录SHA256 `ae5684db9f43b0c9d95fd903199fefd01446baad915590c59a16c8b16bfc854b`）。全文解盲后的固定配对总结为`grade/reviews/blind/paired-summary.md`，其JSON SHA256 `eea3ec5d22196c0cce2164651d955e264fa48fc945543d0797c7d3e289ae06e2`；14份链内报告和15份回复SHA全部对应原冻结分数，没有解盲后改分。

BOM工程分支使用本地合成Provider＋真实SDK验证，五题专业结果仍属于原归档候选4，没有在5重跑模型；编码修复不改变分析方法、意见或N03专业FAIL。仅当前Host具有可信新建起点的自动任务可采用受管执行；旧任务、重启后未证实资源、未知fork及同项目未托管写入者仍不进入自动链，普通关闭自动的分析保留。未迁移旧任务或伪造全机收尾。

本轮结论为本地工程完成、有限专业验证FAIL、产品验收NOT_RUN。原项目/会话/文件、失败/UNKNOWN及源码WIP保留；没有Git/CI交付、运行服务切换、扩展安装或MacBook操作。专业可靠性与漏报仍是未解决事项，不能靠Host补算、强制固定分析方法或把此工程PASS替代。

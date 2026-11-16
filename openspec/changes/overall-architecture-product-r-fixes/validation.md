# R-03／R-01／R-02 验收与联合覆盖

2026-11-17 E-01增量见文末；下述24bf7408及2820/111/0保持为第二次修正的历史固定候选，不代替E-01新候选检查。

固定依据见 [spec](spec.md)。本轮初始候选为39文件摘要 `5a295491834f549d8af46d2cb63fd490796d6f25c622edcbe40f4cf7103580a4`，不是本轮最终候选；最终43文件清单/完整检查/两轴非作者结论见 [result](result.md)，旧39候选不代本轮结果。

## 三项公开接缝证据

| 项目 | 产品路径、复用及持久化 | 正向与关键反例 | 实际证据与当前范围 |
| --- | --- | --- | --- |
| R-03 P1 | 原准备Host固定实际出站DB目录和预选refs；原requirements owner一次捕获实际模型，worker打开完成后在原公共verifyBeforeDispatch/mutate内重读原grant/Task策略并逐行校当前投影，再派发。没有并行权限账/Runtime或业务取数。 | 未预选源撤权、移除实际B出口且全局改选A、预选项目材料及Task能力、未选Task仍出站的原ref、Task排除/收窄，均在Provider前拒绝。无关项目撤权及同项目新增未出站来源不误阻，不把新增源补进旧prompt。原选择、人变更后的授权字节保持，driver0。 | `.local/overall-architecture-product-r-fixes/r03/`：`red-revoke-02.log` 是新增实际Pi竞争RED，原PM仅静态发现；`compatibility-after-r03.log` 14/14（新9＋原5）。`dispatch-*/receipt.json` 有SDK打开快照、捕获模型、前后目录、原选择、授权hash、Provider/driver、准确错误。实际模型不是全局后选模型。 |
| R-01 P2 | 旧Task从原Case继续，沿同一GoalVersion供给取准确主/相关目标；原Plan供给能力只收窄输入所需类型，不建新Goal权威/Plan/Task。旧请求和native前缀保持。显式Case背景控制历史Plan自动继承；同Case同目标有效Plan继续。 | 两目标准确版本、失读、项目未关联Case、无Plan无额外Task/Plan、旧Plan/CaseA→CaseB、同CasePlan保留、冲突明确拒绝；新Plan两版、准备和两种确认兼容。非作者另检出goal-only PlanA＋显式CaseB的冲突/相容组合边界，已由原作者修复；原两组独立RED保留。 | `r01/execution.md`、`SourceSnapshot.json`、逐次实际Host/Pi日志/native。原首轮16项通过不覆盖后来非作者发现；修后作者18/18，规范轴原探针2/2、规格轴5/5独立复验均通过。 |
| R-02 P2 | 原 `record_user_decision` 仅在 `authorize-action + revoke` 放行work资格，原Board精确源/CAS追加revoke。原authorize及安排引用不改，新的撤回原话绑定新请求，未知先查原operation。GSA/Board读原当前授权，不复制执行/效果事实。 | 无Goal原work与准确Goal/Plan实际Pi安排→读原行动→明确撤回→同意图重复，authorize/revoke两行且原行动doing/负责人/反馈保持；跨项目/Task/Plan/Goal、错误原话、过期版本/CAS、缺精确前序、取消、ACK UNKNOWN回读；旧Case及安排兼容。 | `r02/checklist.md`、`candidate.json`、相对旧WIP的`implementation.patch`。新增5/5，原兼容20/20、运行时/停止70/70，界面原位SSR。实际HTTP授权历史、Board/GSA/native/Provider回执在各唯一`host-pi-*`。作者结果不是非作者通过或专业验收。 |

Root额外运行原数据库/准备消费者：`db-prepare-compatibility.log` 21/21通过。完整工程检查仍须绑定本轮最终清单，不能与定向数量相加或继承旧2801/111/0。

## 七模块更新矩阵

| 模块 | 改造要求与本轮更新 | 原功能兼容与上下游 | 尚待独立证实的层次 |
| --- | --- | --- | --- |
| M1战略与目标 | 原目标/BSC/GSA权威保持；R-01补旧Case直接续问正文和跨背景一致性；R-02使上层work授权可撤回。 | 新Plan目标两版、旧Task/native、同Case合法Plan责任、GSA多原行动/检查继续；Goal→Case/Project/Task直接承接。 | 三项工程边界已由最后检查/复核闭合；真实管理反馈及贡献评价、用户验收另核。 |
| M2项目需求与任务 | R-03在原首次派发gate复核所有实际出站DB投影及预选引用，不仅初始模型过滤。 | 原轻量准备无工具/无明细，已授权来源/Task排除/范围、新增源负控制、实际模型A/B、两种确认、单/多Task及归档规则保持；准备准确范围交执行。 | 自由模型MECE、推荐/澄清适用性仍待验；不把元信息资格当质量已核。 |
| M3分析与综合 | 原PM-02错法按影响、PM-04混合文件/聊天发现与原精读保持，不新增专业步骤。 | 原完整回归核准确方法/版本、明确综合Task、旧/新请求、权限/失读/取消等；当前Case准确目标不被历史Plan替代。 | 方法实用、开放组合、主动补证及跨Task专业分歧/重复归因/时期处理未由自由模型证明。 |
| M4审查与决策反馈 | R-02闭合新work分支建立授权后撤回的原权威路径；经营执行及实际反馈保持独立。 | 旧Case授权/撤回、准确报告/逐稿审查、作者修订另存、原Board安排/复用/GSA引用、版本/CAS/partial/UNKNOWN/停止兼容。 | 审查、作者反驳/修订与复查的专业正确、实际行动和效果待验。 |
| M5方法与资产 | 原SAP/IR、Studio、记忆、人治理、发布及固定旧引用不重造。 | 错误版实际读仍拒绝，独立Task继续，IR关闭不绕行、候选/发布/实际采用分开；本次不自动扫描或纠正全局历史。 | 报告错误沿实际引用进入IR/Studio/记忆/Case再被新普通任务自主发现避错的完整链仍NOT_PROVED。 |
| M6自动模式 | 原唯一全局设置/当前值、停止/不追溯/不唤醒规则保持。R-02撤回授权是单独原记录，不用停任务或关开关代替。 | 原公共lease、取消、迟到、partial/UNKNOWN及自动节点回归；R-03只在原首次派发gate作原权限检查，无轮询/全程扫描。 | 自由模型选择节点与业务内容、专业效果另验；不新增所有无Case反馈自动回录。 |
| M7导航与市场 | 原v0.2入口、管理/权限/历史归属及市场退出保持。 | 原Case继续提问、Project准备、GSA/Board原位授权状态及原来源回查，没增加页面、技术确认或恢复市场。 | 本轮只读状态和准确错误做相称检查；正式全App/双机PPT、活库、天气网络和运行采用仍未验证。 |

## 联合覆盖及完成判断

工程联合核：准确目标→旧Case或新Plan准备→所选单/多Task→明确Task混合综合→逐稿审查接线→人的选择/原行动安排/授权撤回→原资产治理。R-01/03/02分别补管理上下文、准备权限时效及决策授权生命周期；原PM-02/04和安排主能力通过原消费者回归保留。

相称合成验证覆盖版本变化、失读/越权、方法失效、独立可行工作、混合文件/聊天、重复、部分成功/UNKNOWN、取消/停止和全局设置。它不证明一次自由模型已正确完成目标到新任务资产复用的业务全链，不预设根因或业绩改善。

## 原始失败与未验证

原39候选的2801 PASS/111 SKIP/0 FAIL及旧两轴0仍为旧快照。旧check-03状态GET409、PPT正常页图FAIL、MacBook .git严格mtime FAIL/写入者UNKNOWN，以及全部FAIL/UNKNOWN/SKIP保留。

本轮R-03首假凭据401是fixture失败；有效泄露竞争RED另记。首版投影在undefined字段上触发 `invalid_data_context_value` 是作者启动回归，已按真实prompt JSON序列化清理后修复，未改通用canonical函数或去掉权限断言；相应日志原样保留。其余作者fixture/中间回归按各索引区分，不能伪作产品RED。

真实模型自主采用、专业综合/审查、完整纠错复用、正式PPT/活库/天气/全App、运行采用、用户产品验收及经营效果均继续分层待验证。SDK版本及data-analysis免测决定不变。正式Board4→5/GSA1→2尚未实施；后续采用须保全资料及使用可读新schema的兼容回退，不能旧库覆盖新工作。

## 最后固定候选与检查

43文件源码/测试摘要 `24bf740820dc021289503ec9ee74f49fe00363dab6e80231c6346667c97b23e9`，两名非作者逐项及有序清单重算0漂移；完整 `npm run check`退出0：2820 PASS、111 SKIP、0 FAIL、0取消，会话边界/类型/构建通过。最终日志SHA `075e4e08223beacc5499dd84c8ea4a953e6c073dd0649740409685738dae0ea3`。本轮规范/规格轴各0未解决；S-01的两组原独立RED及修后复验分开保留。

## 2026-11-17 E-01／P3 提示与输入保全

对应v1.1 §1.1准确状态/减少操作、§4.5版本实质变化集中核对、§7.4不盲重放、§11.5准确表达失败/未知。最新PM复核SHA `c44cdbb540a83b0fc93683efb859223e5ac25c84bc745af41f355229ac3d10d5`第5节确认本项仅为实现表达偏差，不重开R-01主能力。沿原server RequestFault明确拒绝映射，保留409/code并复用`accepted:false`，原runtime-client→HostRequestError→App.safeError显示原message；现有明确拒绝逻辑恢复发送前草稿。普通Project方案专用映射、实际冲突门、版本和选择不改。

| 验收 | 本次实际证据与边界 |
| --- | --- |
| 实际HTTP文案/拒绝 | `.local/overall-architecture-e01/01-message-red.log`保留原错误提示的有效RED，先前409/code/Provider0及保全断言已经通过。修后`02-targeted-green.log`17/17；实际响应见`.local/overall-architecture-product-r-fixes/r01/host-pi-nS9Fq6/goal-only-conflict-observations.json`：409、`project_plan_context_changed`、`accepted:false`、准确新文案，Provider总计0。 |
| Task聊天原入口 | 非作者独立在隔离原Host、Vite原App/CSS、官方Pi＋本地合成Provider，用原API建立Plan/Task历史后显式改Case目标，原Task消息触发真实隐式冲突。Chrome实际显示新文案、保留原textarea输入及项目/Task URL，非stub/SSR；未存截图，限原生AX观察，不称全App视觉验收。 |
| 输入/选择/历史保全 | `review/ui-host-ajQvPd/browser-message-http.json`被动记录实际409/code/acceptedfalse；`after-ui-observation.json`、`verify-readback.json`回读draft与浏览器原输入逐字相同（before快照取在键入前，不把空draft冒作原输入）、lastRun未变、native124403字节及SHA `e90c09a48e7bb82d199e7ac53cc9e232291892b1b225a79e8b178a47c3162372`前后相同；原Plan/Case/Task ID及数保持，无新增Task/强制Plan。初始合法执行Provider1，冲突后仍1，即本次冲突新增0，不能误写为该环境总计0。 |
| 合法组合与其他错误 | 原R01五例含无Goal、匹配主Goal、匹配相关Goal三类合法Plan＋Case，继续并供齐准确目标；旧Task两个目标版本/失读、显式Case切换及旧历史兼容。原Goal读错1例及Project方案客户端/UI11例保持原提示/不暗重试/准确确认，共17例通过；未弱化或删除原断言。 |

所有新证据均在`.local/overall-architecture-e01/`或现成R01唯一fixture根；原43文件及53件源码/工程记录开工副本在`input-24bf7408/`，旧清单及回执未覆盖。本次源码/测试清单43项，新摘要`4a9537d240657620b34b58bedf93b7a20cb007865c198644e511fbeafa9ad999`，仅server映射及原冲突测试相对输入变化，其他41项逐字保持。

七模块采用上文完整矩阵：E-01只改善M1/M2准确背景冲突至Task的状态承接和M7原提示展示；M3方法/混合综合、M4原审查/安排/授权撤回、M5资产治理、M6全局/停止及全部记录权威没有本轮增量。PM认可的R-03/R-01/R-02和PM-01～05工程关闭结论保持，不用提示修复重新宣称专业或产品整体验收。

新候选完整`npm run check`退出0，2931 tests：2820 PASS、111 SKIP、0 FAIL、0取消；会话边界、TypeScript及构建通过。`.local/overall-architecture-e01/03-check-final.log` SHA `064915450fb514ff9dcedc26a4922ae068fba006819f7cb7b574e2c6a003b223`，不是旧24bf7408检查日志。非作者最终身份回读见[review](review.md)及隔离原始报告。

真实自由Agent自主采用、专业正确/完整纠错复用、正式PPT/活库/天气/全App、运行采用、用户验收及经营效果仍待验证；本轮仅有上述局部真实浏览器观察。正式迁移和兼容回退包没有准备或实测；保留全部历史FAIL/UNKNOWN/SKIP和本次RED。

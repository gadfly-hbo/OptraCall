# Issue #138 工程记录

用户于 2026-11-26 授权 Codex 领取开发、组织独立非作者复核、创建 PR、跟进 CI 并合并 main。领取记录见 [#138](https://github.com/gadfly-hbo/OptraCall/issues/138#issuecomment-7182793725)。

基线为 `b7c00851d8db0f7c992484c173db14c511c719b6`，任务分支为 `codex/issue-138-goal-management-improvements`，唯一写入者为本会话 Codex。确认依据为 `e435d3816d4f896b83e745fccc11d46e498b358d` 的同一份 Spec、任务清单与 Demo。原 #136 结果保留。

## 执行清单

- [x] 核对最新主干、正式工单、领取与确认版输入，读回领取评论。
- [x] F2–F3 正确目标入口、就地补齐、候选保存与正式 GSA 修订。
- [x] F4–F7 当前 G/S 的计划 A 推荐、关键词优化及安全撤销。
- [x] F9–F10 一键要求、草稿自动保存、只读预览和发布恢复。
- [x] F11 选用实绩即核对、报表截至时间提取与来源保留。
- [x] F12 先拟复盘、保留人工取舍并带入下一期。
- [ ] 适用完整检查、真实 Host／Pi 合成 Provider 和桌面／手机浏览器验收。
- [x] 固定候选的非作者独立复核与四原则专项检查，修复发现。
- [ ] 远端回执、PR head CI、squash 合并、main push CI 和 Issue 结案。

## 接入和验证安排

沿官方 Pi 1.4.0、Interface v3 和现有 `business-role-discussion` 域。计划建议和复盘建议使用同一域的受限业务工具，调用、模型配置、取消、原生历史与迟到保护共用既有生命周期。Host 交付准确 G/S 和证据，管理归属、CAS、保存及明确发布。Agent 组织行动、提取资料并提出复盘结论。用户手填、纠正、跨部门取舍和发布确认继续使用原入口。

工程验证使用隔离合成材料与合成 Provider，通过真实 Host 和官方 Pi。原始日志和截图保存在本工作树 `.local/issue138/`。实际命令、结果、候选、独立复核和交付链接随任务更新。

## 实施与初审修正

首个固定候选为 `3fdfc430c88ab5587e0f1333659769fe68512ca5`。两位独立非作者分别完成代码与兼容审查、真实 Host／Pi 及桌面与 390px 浏览器验收。该候选初审不通过，原报告与反例保存在 `/workspace/scratch/issue138-review-evidence-code/` 和 `/workspace/scratch/issue138-review-evidence-ui/`。

| 初审发现 | 当前修正及复验安排 |
| --- | --- |
| 删除后添加计划产生重复行 ID，推荐覆盖另一行 | 新行使用独立 UUID，既有 Host 的唯一性检查保留。永久浏览器回归验证另一行手填原文保留。 |
| 复盘保存失败、远端修订或在途响应后切阶段造成改稿消失 | 保留陈旧本地稿与取舍，展示远端对照并明确恢复选择。在途回执只推进匹配缓存的已确认 revision，后改正文保留。 |
| Host 把结账原范围替换成总目标范围 | 阶段证据沿原核对范围，结账和 Case 沿 Agent 声明的原范围。扩大适用范围继续标假设。结账原文固定进正式复盘，下一期带选中项对应的原检查及结账证据。 |
| 无浏览器存储时既有 V12 SSR 检查失败 | 选择缓存读取失败时使用安全默认值，原 V12 断言保留并恢复通过。 |
| 总 GSA 确认失答缺少原意图恢复 | 确认前保存原编号与原内容，提供只读回执查询、自动核对及明确同编号重试。后续新版生效时仍可读原回执。 |
| 缺检查点时定位到已填正文 | 定位实际缺少的行动、检查点或观察依据。 |
| 实绩已提取的信息仍显示未知 | 凭证卡投影已保存的核对结果及截至原句，原提交输入继续保留。 |
| 提前关闭核对对话后工作区不刷新 | 关闭对话保留原会话观察，终态回读更新工作区。 |
| 齐备候选缺少标题旁确认 | 标题旁提供一次确认并进入拆解的快捷入口。 |

草稿保存 CAS 冲突时保留原编辑基线与本地改动，负责人可明确让 Agent 合入最新服务器稿。模型收到实际改动与原基线，Host 继续核准确父计划和 revision。该路径不自动发布。保存失败与手动刷新均保留未保存文字。

作者增量验收包括七项 Host 测试、真实浏览器十二条场景及原发布／交叉冲突／失答恢复八条回归。日志为 `.local/issue138/trial-5.log`、`browser-full-10.log`、`browser-legacy-6.log`、`ssr-green.log`、`boundary-2.log`。相关十八个测试文件共 152 项通过，最后增量的 35 项通过，类型检查与构建通过。最终候选的复核与完整回归在下一节补齐，初审结论保留。

第二候选 `e4e218ca98ecc216156e1ef195a9c754af58da12` 复验关闭初审发现，但两位非作者又复现“下方实绩核对／下一期起草的查看对话入口不可见”，因此仍保留不通过。最终增量将“打开原对话”与“明确发起新一轮”分开，查看入口不发送模型请求；后台终态只刷新工作区，保留人工正在修改的 GSA 和拆解文字。永久浏览器回归验证原对话可见且原 run／revision 不变。计划与复盘工具的输出长度也与原保存字段限制对齐，原发布回归仅把阶段导航定位到明确导航区，断言保持。

第三候选 `7e49efda859332ac913ae3715ede9a523e99e883` 在代码复核范围通过，但 UI 扩展主线实际出现“第二份检查的复盘工具已完成，页面二十秒仍在起草且未补入”的 P1，因此整体仍不通过。原 native 时间线、截图与准确运行身份保留在 UI 的 `final-review-7e49efd.md`，当轮未捕获 GET 响应体的证据缺口也保留。源码定位到 Runtime 终态可能先于业务回执落盘，原外部请求只读一次而未再次核对。

永久浏览器反例将第二轮准确原请求的业务终态延迟投影，旧产品真实失败，见 `receipt-race-red.log`。修正仅对外部待核的原 owner／requestId 最多八次退避 GET，失败或取消停止，切换归属清理，未知仍保留待核；不重发模型或自动采用。修后十三条真实浏览器路径通过，新增断言核对只发一条原模型请求；三十五项测试及构建通过，见 `receipt-race-green.log`、`receipt-race-tests.log`、`receipt-race-build.log`。新固定候选的最终非作者结论另行核定。

第四候选 `ad5209230fc78ef5ae862da01c513f151a1281ec` 的挂载期间恢复通过，但非作者再测“待核时手改、切目标后返回”发现父复盘组件另建编号，多调用一轮模型，整体仍不通过。原报告为 UI 的 `final-review-ad52092.md`，代码已测范围与整体阻断分别保留。作者把该严格路径加入永久浏览器，旧产品实际失败为 `2 !== 1`，见 `receipt-resume-red.log`。

后续修正复用既有业务会话的 pending 请求，仅另存原请求的证据 hash 对应关系。父复盘恢复原编号，BRC 将其识别为已发送，不重放。回填按原证据标记，等待期间新资料不偷记已处理，无原标记时不补造。十三条浏览器、三十五项测试与构建通过，见 `receipt-resume-green.log`、`receipt-resume-tests.log`、`receipt-resume-build-2.log`。首次构建的类型错误与原失败日志继续保留。最终非作者结论仍按新固定候选记录。

第五候选 `dec5fafb4daca66d2eef221b7eb5af7b51a03c54` 的正常恢复、跨目标返回、新证据及 UI 适用范围通过，代码复核追加“原请求失败／取消且等待期间有新证据”时，实际复现父子状态恢复循环。1.6 秒内分别出现 5190／5154 批 DOM 变化，模型请求与 GET 未重放，整体仍不通过。原报告为代码目录 `re-review-dec5faf.md`，failed／cancelled 原反例分别保留。修正为同一原编号只恢复一次，避免新证据 hash 变化反复恢复已观察的请求。修后作者三十五项测试、十三条浏览器和构建通过，见 `receipt-terminal-tests.log`、`receipt-terminal-browser.log`、`receipt-terminal-build.log`；该两类反例由非作者在新固定候选增量复验。

## 完整检查与限制

首轮 `npm run check` 使用 Node 25.9.0 和任务子收割器运行。既有 `db-link-pg-lifecycle.test.ts` 在并行负载中持续等待，原现场保留在 `full-check-1.log`。隔离执行同一文件二十项通过，见 `db-lifecycle-isolated.log`。随后只结束该停滞测试 worker，使其他检查继续。此轮命令保留失败，不记为完整通过。最终 PR head 与 main 的完整 CI 另行核定。

本轮使用合成 Provider 与合成业务资料。工程调用链、引用、取消、保存和界面证据与真实模型的业务判断质量分别核定。

`npm audit --audit-level=high` 通过，锁定依赖中既有两项 moderate 记录保留，high／critical 为零。官方 Pi 1.4.0、依赖及锁文件均未升级或修改。

## 行为回归证据

自动保存前的实际浏览器反例见 `browser-red.log`，原界面更改未自动落盘。GSA 原回执查询初始为 404，见 `gsa-recovery-red.log`；新 GSA 下直接替换旧父计划的反例见 `upstream-red.log`，初始错误接受为 201，修正后要求负责人明确承接。对应最终通过见 `browser-full-10.log`、`trial-5.log`。`store-red.log` 中夹具把合法创建 201 当成 200 的失败也原样保留，不将该夹具错误冒充产品前置反例。

## 最终非作者复核与原位归档

完整产品候选固定为 `3cbf4ee4b6cb86f977c9366fbf8e4097f1ff5805`，tree 为 `32fd41b8c37f1e89c8a96a313d3851029f15ed86`。两位复核者均未参与候选源码、测试或 Spec 的创作，使用固定 `git archive` 与隔离合成运行根，只读检查候选。其最终结论均为通过，已提必须修正的问题全部关闭。此前各候选的整体不通过、局部通过及脚本错误各自保留，不用最后的绿灯改写历史。

| 非作者 | 最终检查与结论 | 原始报告及证据 |
| --- | --- | --- |
| `/root/issue138_review` | 独立代码与受影响行为通过，四原则通过。失败／取消叠加新 hash 的 DOM 循环关闭，人工只读核对后仅为真正新增资料发一轮。跨目标返回、等待中新证据、缺 hash 映射三条恢复反例通过，固定 SHA 构建通过。 | `/workspace/scratch/issue138-review-evidence-code/final-review-3cbf4ee.md`，同目录 `3cbf4ee-*` 的脚本、JSON 与日志。 |
| `/root/issue138_ui_review` | 适用 UI 与四原则通过。失败／取消后 DOM 与 GET 均稳定，手改与勾选耐久保留。原三条恢复反例通过，结合此前固定的桌面／390px 主线、保存／CAS、SSR、精确 owner 历史重开及零经营副作用证据，无剩余必修项。 | `/workspace/scratch/issue138-review-evidence-ui/final-review-3cbf4ee.md`，同目录 `3cbf4ee/` 的脚本、JSON、native 与截图。 |

本次四原则按实际代码与调用核验：Host 管准确归属、资格、保存、原意图及证据，Agent 提供计划、语义核对、合并及复盘正文。沿原业务域、Interface v3 和官方 Pi 1.4.0，不新增 Runtime／运行队列或升级依赖。推荐、优化、一键要求、自动保存和选凭证即核对减少人工操作；正式确认、发布及经营取舍仍由负责人决定。待核回读和原请求恢复不重放模型，不把失败或新资料伪记为完成。

作者最终受影响检查为 35／35、真实浏览器十三条、类型与构建通过，原 152 项及原发布八条的各自时点证据继续保留。全仓完整检查、PR head 与 main push CI 仍须实际运行，本次独立结论没有替代它们。批准工作区和独立计划 Demo 原字节不变，依赖与锁文件不变。

同一 Spec、任务清单、批准 Demo 与本记录在原目录保存，不另起产品版本。本节是创建 PR 前的固定归档，后续仅补文档结论，产品与测试保持上述候选字节。最终文档 head、PR、实际 head CI、合并 SHA、main push CI 及 Issue 结案回填同一 [#138](https://github.com/gadfly-hbo/OptraCall/issues/138)，上方 Git／CI 条目的后续状态以该结案回执为准。真实模型专业质量、负责人正式产品验收及设备运行采用分别核定。

## 已确认 Demo 对标返工与截图交付

2026-11-26，用户在 MacBook 试用中指出保存修订候选后整块工作区重复，以及 GSA、拆解、跟进和复盘与已批准 Demo 不一致。独立审计确认九项问题，原报告及十组逐屏对照保留在 `/workspace/scratch/goal-ui-alignment-review/`。此前功能与局部 UI 检查通过不能扩大为四阶段整体对标合格，该结论在本轮明确纠正。

用户授权按九项清单返工，继续沿用批准 `ui-demo-journey.html`，并要求开发后先交截图、再 Git。PM 已[重开 #138 并登记接手](https://github.com/gadfly-hbo/OptraCall/issues/138#issuecomment-7186763213)。本轮基线为 `main@15bff578c5b5b1d1f8db566144024de087c5e942`，工作树 `/workspace/scratch/issue138-ui-rework`，本地分支 `codex/issue-138-ui-rework`。批准 Demo 原 SHA-256 `7b1d3031768b2ad13b39850c35879deb601c7beca7ca134eff262d40e92cab0a` 不变。Spec §9 和任务 G 清单在原文件更新，没有另起产品方案。

### 九项修正

| 验收 | 实际改动与核对 |
| --- | --- |
| UIA-01 | 目标编辑器和工作区的 React sibling key 分开命名。连续三次同名候选保存、取消后确认、版本切换与重开均只保留一个当前工作区；后端仍是一个目标的多个版本。 |
| UIA-02 | 当前目标作为主标题，紧邻期间、范围和切换；版本工具条及阶段导航压缩。候选明确标“本期候选”，采用后才标“当前生效版”，主要动作随阶段变化。 |
| UIA-03 | GSA 默认可读工作表，修改在聚焦弹窗进行。保留计划 A／阶段检查点／观察依据、Agent 推荐与优化、保存／取消／确认。来源在简表展示，其他管理项按需展开。 |
| UIA-04 | Agent 与拆解成果左右同屏，新增读取现有数据的业务维度汇总、责任表、时间计划和补缺策略呈现。金额、比率、里程碑沿原规则解释；编辑仍用既有保存与校验。 |
| UIA-05 | 发布后默认完整冻结正式表，可直接开始跟进。必须明确“修订拆解计划”才打开草稿；服务器后来有草稿也不自动把正式版入口变成编辑器。本地未保存人工稿继续保护。 |
| UIA-06 | 阶段跟进首先展示凭证与准确冻结计划、实绩、偏差和 Agent 核对说明。Case 提示规则放侧栏，经营取舍可达；新报表、改选范围、阈值配置与历史按需展开。 |
| UIA-07 | 复盘首先读末版目标、期初备忘和期末结账，再读带适用范围的结论；只在主动修改时展开文本框。缺实绩仍待补，填写结账引用不会提前收起正文输入。 |
| UIA-08 | 舍弃项和历史折叠，当前勾选及起草下一期动作集中；手改、舍弃、选择及原证据保留。重开不自动勾选已恢复项，也不额外发起模型请求。 |
| UIA-09 | Agent 卡展示当前 GSA、期间、范围与来源；390px 提供对话／成果跳转和焦点定位。保留真实产品公共侧栏与浅／深主题。 |

修改集中于目标 UI、三个适用浏览器脚本和本目录文档。Host API、持久化权威、模型流程、Pi 1.4.0、Interface v3、依赖与锁文件未改。

### 固定候选、独立复核与失败保全

最终产品与测试候选固定为 `.local/ui-rework/candidate-3.json` 的文件 SHA 清单，基于上述未变的 HEAD。非作者 `/root/ui_rework_independent` 使用不继承作者历史的独立上下文，先从原 Demo 和 UIA 验收导出预期，再在隔离 `runtime`／`runtime3` 中检查实际产品。复核证据位于 `.local/ui-rework/independent/`；其 `candidate-3-start.json` 与 `candidate-3-end.json` 核对产品／测试摘要和原 Demo 一致。任务状态和本结果文档在验收后补写，另列最终文件摘要，不将文档变动冒充新产品候选。

重复工作区的原产品 RED 为首次保存后出现两个工作区，原截图、DOM 和日志在 `.local/ui-rework/baseline-red/`、`duplicate-red.log`；永久回归 `tests/browser-goal-ui-alignment.mjs` 修后通过。非作者又发现 GSA 取消没有还原确认人及说明的 P1，以及手机 GSA 编辑区和桌面复盘首屏内容被挤下的两个 P2。作者补齐取消快照、压缩 G/S 来源及复盘页头，非作者在 candidate-3 独立复验：取消后直接确认仍落库原署名／说明，手机原三个字段位于固定操作条上方，桌面首条复盘结论进入首屏。永久取消回归同时通过。原发现与截图继续保留。

非作者实际核对了正常／冲突／失答恢复、唯一工作区、草稿保存与 CAS、GSA 取消／保存／确认、正式表重开、阶段结果、复盘取舍／原证据／下一期、被替代旧版只读与候选可编辑、手机往返及深色界面。[完整独立报告](/workspace/scratch/issue138-ui-rework/.local/ui-rework/independent/review.md)及同目录 `verdict.json` 结论为通过，无剩余必修项；该结论不代替全仓检查、真实模型质量或用户截图确认。最终文件和证据摘要见[检查索引](assets/issue-138-ui-rework-checks.json)。

本轮定位器、测试夹具及环境错误分别保留：渐进披露后的旧定位器错误、将仍生效 v1 当成历史的夹具错误、行内路由取消竞态、旧依赖软链接导致的 SDK 材料检查失败，均没有记作产品 RED。依赖恢复为本工作树基于原锁文件的正常安装。另有结账表单提前收起的真实问题已修正并回归。原 FAIL 不因最后通过被删除。

### 检查实际结果

以下日志均位于本工作树 `.local/ui-rework/`，各自候选时点保留；最终布局／取消增量由独立复验和专项回归覆盖。

| 检查 | 结果与证据 |
| --- | --- |
| 类型、前端构建、构建标记 | candidate-3 `npm run build` PASS，`build-10.log`；`git diff --check` PASS。 |
| 原八条发布与准确引用回归 | PASS，`publication-regression-3.log`：正常预览／发布、交叉冲突先对齐、原 v1 发布失答而 v2 后生效、浏览器刷新及 Host 重启、一次原写入、原报表字节、旧版只读、目标隔离、unknown／404 不解锁。 |
| 十三条 Host／Pi／浏览器试用路径 | PASS，`trial-5.log`，page errors 为零；包含推荐／优化／撤销／在途手改、自动保存失败与 CAS、GSA 恢复、一键拆解、凭证截至原句、复盘改稿与证据、原请求恢复且不重放模型、下一期承接。 |
| 唯一工作区与取消元数据 | PASS，`cancel-metadata-green.log`，真实保存、取消、确认、版本和后端落库断言。 |
| 四阶段实际截图 | PASS，`capture-final-4.log`、`screenshots-final/capture-result.json`；1600×1000、390×844、手机往返、发布重开只读和深色主题，page errors 为零。 |
| 全仓检查 | `check-2.log`：SDK 会话边界 PASS；3329 项中 3132 PASS、1 FAIL、196 SKIP。唯一失败为原 `conclusion-review-handoff.test.ts` CNR-A4 崩溃后等待 SDK PID 消失。完整命令保留 FAIL，后续 build 因串行条件未执行，构建另有上述 PASS。 |
| 全仓唯一失败的环境诊断 | 同一测试独立无 reaper 仍 FAIL，`crash-without-reaper-processes.json` 精确跟踪本次后代 PID 198261 已退出但由 PID 1 持有为 `Z`。仅在命令外层启用任务级子进程回收后，产品／测试字节不变，原测试 1/1 PASS，`crash-reaper-isolated.log` 记录真实子进程退出码 0。归类为容器孤儿回收条件，不改产品或删除断言，原全仓失败不改写为通过。 |

196 项 SKIP／NOT_RUN 保留各自环境条件，不算通过。PR head／main CI 待用户截图确认后按真实提交运行。当前工程调用链使用真实 Host、官方 Pi、隔离合成 Provider 与零售合成资料；没有调用真实供应商，没有改变 MacBook 或正式服务。

### 四原则本轮核对

| 原则 | 具体核对 |
| --- | --- |
| Host 管环境 | 继续管理准确目标／GSA／拆解引用、权限、CAS、原意图和落库；UI 的汇总与折叠不绕过发布校验、失答锁或历史只读。不把测算值替换正式目标值。 |
| Agent 自主执行 | 继续由现有业务会话理解业务要求、推荐／优化 A、拆解、核对实绩和起草复盘；呈现组件不固定预测算法，不代作因果、补缺或经营决定。 |
| 优先复用 Pi | 沿既有业务域、原 owner、官方 Pi 1.4.0 与 Interface v3；无新增 Runtime、模型循环、队列、依赖升级或 SDK 修改。读正式版、展开来源及重开原对话不发新模型请求。 |
| 减少人的操作 | 正常路径为确认 GSA → 一句要求起草 → 核对并明确发布 → 直接看正式表并选用实绩 → 修改／勾选复盘结论起草下一期。自动保存、推荐与优化继续工作；来源管理、阈值及历史不用每轮重填。只保留必要业务取舍与正式确认。 |

### 截图审阅与下一道交付关口

交付[四阶段真实产品截图与原 Demo 对照页](/workspace/scratch/goal-ui-rework-delivery/index.html)，含 GSA 工作表及编辑、拆解贡献／时间计划／发布预览／正式表、跟进结果及 Case 选择、复盘和下一期、手机与深色截图。对照页嵌入原始 PNG，点击可放大；原 Demo 文件没有修改。截图 SHA 索引为同目录 `screenshots-manifest.json`。

截图提交时已完成本地九项返工和独立 UI 验收，G9 待用户确认；该时点未提交／推送 Git、创建 PR、合并或更新 MacBook。

用户于 2026-11-26 明确“确认，提交 Git，并推进 PR／CI／合并”，G9 已完成。再次 fetch 核对 `origin/main` 仍为 `15bff578c5b5b1d1f8db566144024de087c5e942`，产品／测试和独立复核的 candidate-3 摘要一致；本次只补确认与交付记录。按授权推送工作分支、创建关联 PR、核对实际 head 完整 CI、squash 合并并确认 main push CI；实际远端 SHA、CI 链接和结案回执统一补在同一 [#138](https://github.com/gadfly-hbo/OptraCall/issues/138)，不预先宣布完成。设备更新由用户后续安排。

## Agent 拆解草稿保存契约修正（DC01–DC05）

2026-11-26，上一 UI 返工已由 PR #140 合入 `main@051aff0fc7438262bad962988b9f8834f04799d8`，PR 与 main CI 均通过，原回执见 [#138](https://github.com/gadfly-hbo/OptraCall/issues/138#issuecomment-7189024609)。用户随后反馈 Agent 八次猜字段仍保存失败，重新开放并[领取本次修正](https://github.com/gadfly-hbo/OptraCall/issues/138#issuecomment-7189559113)。本轮未取得原始八次 payload，只复现已核实的契约缺失；不将其余未点名区块视为已核，不公开用户业务原文或身份。

### 原因与修正

原 `strategy_goals` 将 estimate／rows／预留／补缺／视图／时间计划声明为通用对象，模型看不到 Host 所需字段。工具现共享 `goal-decomposition-schema.ts` 中的完整持久化结构，确认前测算同用一份 estimate schema；首次读取提供准确 GSA 身份、正式值、范围及已绑定 SAP 的模板，测算／差额仍为 null。已有草稿不再生成空模板，沿原稿与最新 CAS 修订，不复制整个草稿挤占工具容量。

保存格式失败现在指出字段，明确未保存和发布校验 `not-run`。首次接线测试发现仅附 Error.details 会被原 Runtime 安全过滤，已复用原 `safe-tool-error-v1` 的 message/issues 通道提供限定字段反馈；没有修改公共 Runtime、SDK 或创建重试循环。Agent 收到后自主纠错。缺口算式仍为正式值减测算值；未知或反推达标条件不能伪装为独立测算以抹平缺口。SAP 是否必需按原 measurement 绑定判断，不能由“有数值”或 manual-exception 一词推定；没有实际脚本执行不填回执。

### 验证与保留结果

证据位于本轮工作树 `.local/draft-contract/`，永久回归为 `tests/goal-decomposition-contract.test.ts`。

| 检查 | 实际结果 |
| --- | --- |
| 修复前原生工具 RED | `red.log`：2 tests / 2 FAIL。合成 Provider 只用实际收到的 schema 和上下文，不预置完整私有 Host 草稿，确实无法完成首存。 |
| 首次接线 | `green-1.log`：首存通过，纠错失败；查明安全通道未暴露错误详情。修复为复用原安全契约后 `green-2.log` 两条通过。原失败保留。 |
| 目标管理定向回归 | `targeted-1.log`：core、full、当时四条新增测试，合计 25 PASS / 0 FAIL，覆盖脚本、金额、加权比率、里程碑、SAP、交叉冲突、失答、CAS 和版本边界。 |
| 最终契约专项 | `contract-final-2.log`：5 PASS / 0 FAIL。实际 Host→官方 Pi→合成 Provider 首存、SDK 字段拒绝后纠正、Host 差额拒绝后纠正、未知保留与无自动发布；已绑定 SAP 不丢失，错误版本仍阻止发布。 |
| 夹具失败 | `contract-final.log` 中新 SAP 测试误用进程夹具不存在的 root 属性，未到产品路径；改用其 dataRoot 后通过。该 FAIL 不伪装成产品 RED。 |
| 类型／依赖／Demo | typecheck PASS；high audit PASS，保留 2 项既有 moderate，不升级依赖。批准 Demo 仍为 `7b1d3031768b2ad13b39850c35879deb601c7beca7ca134eff262d40e92cab0a`，未改前端。 |
| 最终增量／构建 | `candidate-4-targeted.log`：四文件 30 PASS；仅补两项安全整数上限后的 `candidate-5-contract.log`：5 PASS。`candidate-5-build.log` 类型与真实构建 PASS。 |
| 最终非作者复核 | `/root/draft_contract_review` 对固定 candidate-5 的 DC01–DC05 与四原则 PASS，无剩余必修项。独立定向 26 PASS（修正前身份）、固定最终候选专项和独立探针 11 PASS；101 个有界变体无剩余已扫描的根路径诊断缺口。运行前后候选摘要一致。 |
| 完整适用检查 | `fullcheck-1.log`：3334 tests / 3136 PASS / 2 FAIL / 196 条件 SKIP，保留原 FAIL。沿前次已核定的任务级 subreaper 回收本测试的孤儿进程，不改产品或测试行为；会话边界检查 PASS。两项失败来自旧会话测试仍要求提示词 1.3.0，导致合成 Provider 拒绝回复，分别停在 accepted／未收到完成回执。只将三处精确版本预期更新至本次实际 1.3.1 后，原 native/归属/关闭/采用断言保持，`role-version-regression.log` 4 PASS，后续四文件 30 PASS。原完整命令在 tests 阶段退出，构建已单独按最终候选通过。准确 head 全量 CI 另按交付回执核定，不把局部复验改称原全量通过。 |

完整检查启动后补充了重复行 ID 的准确报错路径、SAP 模板专项及复核发现的格式边界；最终受影响专项均独立通过，原完整检查结果按实际运行范围记录，交付的准确 head 另由 CI 核验。完整日志、固定产品/测试摘要、各次失败与独立结果的哈希见[本次证据索引](assets/issue-138-draft-contract-checks.json)。

非作者复核发现并关闭了两项 P2：可空文字只有空格时 schema 与 parser 不一致，及维度键的长度/空白约束未被 Record 携带；另关闭安全整数上限的 P3。已显式补约束、精确字段反馈、动态维度键脱敏和永久反例。原失败、修订期间读取到混合候选的独立探针失败均保留；后者不当作固定候选的 native RED/PASS。Host 新安全错误不回显输入值和动态键，官方 Pi 的 schema 错误仍按其既有合同回显已提交参数，不能扩大宣称所有错误均无参数回显。

### 四原则与交付边界

Host 只提供输入契约、准确上下文、原存储／权限／发布校验和可纠正的安全错误；方法、算式、技能选择和错误修正仍由 Agent 自主决定。复用官方 Pi 1.4.0 的原生 schema 校验、工具调用与续接，沿 Interface v3 与原 goal/goal-draft owner，不新增调度、会话、依赖或 SDK 改写。用户只需表达业务要求、补真正缺失的事实并决定发布，无须提供 Host schema、编造 SAP 或重录已有草稿。已保存和可发布分开，经营授权未放宽。

本轮仅工程合成验证，不代表真实供应商模型的专业预测能力通过。用户原文中的待核基线、分母、负责人、贡献与日历来源继续待业务核对；没有改动正式业务数据或更新 MacBook／Mac mini。非作者已完成本地增量复核；PR 实际 head CI、授权 squash 和 main push CI 后在同一 #138 回填实际提交及结案状态，不能以本地 PASS 提前结案。回退可 revert 本次提交恢复旧工具契约，已有草稿字段与存储格式不迁移、不回写旧文件。

### 首次远端 CI 超时与直接阻塞修正

候选 `f0c66e688de9a402c8ed090af3319740d639c9b9` 已推送并创建 [PR #141](https://github.com/gadfly-hbo/OptraCall/pull/141)。[首次 CI](https://github.com/gadfly-hbo/OptraCall/actions/runs/45808419552) 实际 head 匹配，作业从北京时间 19:12:16 到 19:37:31，结果为 **cancelled**，GitHub 明确报 `The job has exceeded the maximum execution time of 25m0s`。原日志 `pr-ci-attempt-1.log` 保留；已执行部分未见断言失败，持续通过至 fixed-draft clear 的末段验证，随后被取消，尚无根测试总数、构建或审计结论。不能称为远端全量 PASS，也不把取消归为产品功能失败。

这直接阻塞 DC05/H5 的完整 CI。仅增加 Check 作业总时限 25→35 分钟，为现有 3334 项检查留出余量；触发条件、权限、准确提交、Node/依赖、测试与构建审计步骤均保留。产品和永久测试仍与非作者通过的 candidate-5 字节一致。新增范围只为关闭已观察的交付阻塞，按同一任务记录 YAML 核对、非作者增量和新实际 head CI，不盲目重跑或降低检查强度。

YAML 解析与完整对象对照 PASS：把新预算还原为 25 后与旧工作流完全相同。`/root/draft_contract_review` 对该增量独立复核 PASS，无新增发现；独立核实原超时、准确 head 和候选字节，权限、全部检查与单项时限未变。报告及静态核对摘要已录入同一证据索引；新的准确 head 和 main 完整 CI 仍待实际执行，不由本项静态 PASS 替代。

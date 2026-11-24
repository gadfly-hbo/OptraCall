# Issue #128 实施与验证记录

本记录按实际执行追加。PASS 只覆盖明确候选和命令；原始失败、环境失败、跳过、NOT_RUN、UNKNOWN 分开保留。

## 1. 领取与环境

- Issue：`#128`，2026-11-24 回读为 Open，领取前无评论。
- 领取评论：`issuecomment-7122956165`，`Qoder/Mac-mini`。
- 基线：`7ef6ebb81b735ffecdad3753217a96f02cb95c76`，与领取时 GitHub main／远端引用一致。
- 工作树：`/Users/bendandebaba/.qoder-cn/worktrees/issue-128-strategy-trial-repair`。
- 分支：`work/qoder/issue-128-strategy-trial-repair`。
- 规范：工程规范 v1.14、统一会话接入说明、Interface v3。
- 实际环境：Node `v25.9.0`，npm `11.12.1`，`@earendil-works/pi-coding-agent` `1.4.0`。
- `npm ci`：退出 0；按锁文件新增 371 个包，审计报告 2 个 moderate，未执行 `npm audit fix`，未升级依赖。命令中的 deprecated 警告保留为环境事实，不作为本单产品缺陷。
- 真实 Provider、真实业务数据、原始会话、凭据、正式数据迁移、设备／服务操作：NOT_RUN，非本单授权范围。

## 2. 前置 RED 与修复记录

### I128-01 开题保存

- RED：`node --test tests/strategy-kickoff-host.test.ts tests/strategy-initiative-session-host.test.ts`，退出 1；5 项中 2 通过、3 失败。失败分别直接命中：省略 sources 返回 400、HTTP `details` 为 undefined、真实 Pi 工具回包仅 `strategy_kickoff_schema_invalid` 而无 `proposition_count`。原始输出：`.local/issue-128/kickoff-red.log`。
- 修复：Host 仅在 `undefined` 时规范化空来源；字段／来源校验产生白名单 path/reason；HTTP 和既有 safeToolFault 投影同一安全 details；未改 Runtime 白名单或 SDK。
- GREEN：同一命令退出 0；5 通过、0 失败。真实主会话→Pi→工具→Host 先收到命题数量及路径，再修正并省略来源保存；非法尝试零写入。输出：`.local/issue-128/kickoff-green.log`。
- `npm run typecheck`：退出 0。完整回归待最终统一执行。

### I128-02 候选核对与恢复

- RED：`node --test --test-name-pattern='候选自读保存回执' tests/strategy-candidate-host.test.ts`，退出 1；目标 1 项失败。真实链在冲突后仅收到 `strategy_candidate_operation_conflict`，没有 `initiative-read-candidate` 下一步；同一路径还固定了旧 operation 在新保存后重放、自读、回执查询和越界负例。原始输出：`.local/issue-128/candidate-red.log`。
- 修复：候选 owner 闭包新增准确正文与本版保存回执只读入口；`CandidateVersion` 增加可选 `saveReceipts`，旧记录由 `lastSave` 回退；同号同内容返回原回执，异内容安全冲突零写入，明确新号才追加。
- GREEN：同一目标命令退出 0，1 通过；输出 `.local/issue-128/candidate-green.log`。
- 受影响回归：候选、限定修改、崩溃恢复、锁定和权限 5 个测试文件共 10 项，10 通过、0 失败；输出 `.local/issue-128/candidate-regression.log`。`npm run typecheck` 再次退出 0。

### I128-03 承接范围

- RED：`node --test --test-name-pattern='I128-03' tests/strategy-initiative-ui.test.ts`，退出 1；当前部门选项缺失且默认落到既有企业。首次 SSR 断言误找 select value，修正为 option selected 后取得上述产品 RED；定位器尝试保留在 `.local/issue-128/handoff-red-locator-attempt.log`，正式 RED 为 `handoff-red.log`。
- 修复：`HandoffDialog` 总是合并当前 scope 与目录，稳定身份去重、默认当前范围，补充上级／ID／当前范围及保存前归属；加入历史误归属的现有修订补救说明。未改目标 scope 草稿 key 或承接 Host 实现。
- GREEN／UI 回归：`strategy-initiative-ui.test.ts` 7 项全部通过，输出 `handoff-green.log`。
- Host 合同：新增无 enterpriseId 部门、双目标、并发重放、准确来源及重开去重测试；发布／承接／恢复 3 文件共 11 项全部通过，输出 `handoff-host-regression.log`。
- 测试夹具修正保留：第一次并发运行未提供生产已有 mutation gate，第二次误把 GoalRecord 当 GoalVersion 读取 scope；分别保留 `handoff-host-fixture-attempt.log`、`handoff-host-assertion-attempt.log`。两项均是测试夹具／断言问题，不记为产品 RED，未为此增加第二套 Host 串行机制。

### I128-04 主会话状态

- 浏览器 RED：先以 `npm run build` 固定未修 UI，再运行 `node tests/browser-issue-128-strategy-trial.mjs`。正常 accepted／Provider hold 下同时出现真实进度和“原请求结果待核”，目标断言 FAIL；pending 防重及单次 Provider 请求 PASS。输出 `.local/issue-128/state-browser-red.log` 和截图 `.local/issue-128/browser-state/main-running.png`。
- 修复：Host detail 只增投影统一 domain 的 `live`；展示函数组合 dispatching、pending、lastRun、busy/live、snapshot 和观察连接；pending 不再单独等同未知，显式替换条件保持原 Host 合同。
- 单元／恢复：状态推导覆盖发送、运行、成功、失败、取消、断连、未知、重开中断及 idle；UI＋恢复 Host 共 10 项全部通过，输出 `state-unit-green.log`。
- 浏览器 GREEN：重新 build 后同一脚本退出 0，4 项全部 PASS；accepted 运行中无“结果待核”，有进度，Provider 请求数为 1，零外部浏览器请求。输出 `state-browser-green.log`。初次 typecheck 发现 `StrategySessionRun.status` 为 string，已将展示输入改为 string 后由 build 内 typecheck 复核通过；未用类型断言掩盖。

### I128-05 检验依据回看

- RED：`node --test --test-name-pattern='I128-05' tests/strategy-initiative-ui.test.ts`，退出 1；四类来源没有操作入口，按钮数量实际 0、预期 4。输出 `sources-red.log`。
- 修复：gate source 使用复用类型，来源列表成为键盘可操作控件并显示完整指纹；Workbench 按 reportNo／candidateId:no／fileId 解析并先核对 expected sha，再复用开题、候选和文件只读预览。公开 URL 无历史快照时显示不可核对原因，不访问当前网页。
- 单元 GREEN：UI 套件 9 项全部通过，输出 `sources-unit-green.log`；build 内 typecheck 通过。两次测试定位修正保留在 `sources-unit-selector-attempt.log`、`sources-unit-fixture-attempt.log`，分别是文字计数误匹配及第二道门夹具仍含旧来源，不记为产品 RED。
- Host／历史回归：检验门禁、公开来源、取消／重试／未知、业务退回、准确身份和历史聚合 3 个测试文件共 7 项，7 通过、0 失败；输出 `sources-host-regression.log`。

### 联合浏览器

`node tests/browser-issue-128-strategy-trial.mjs` 最终退出 0，26 项全部 PASS，输出 `.local/issue-128/browser-joint-green.log` 与 `.local/issue-128/browser/results.json`。覆盖：accepted 正常状态、限定修订父版、串行双检验、旧开题／父版候选准确回看、文件正常／错指纹／缺失、公开 URL 不可核对且零联网、Escape 焦点返回、当前部门承接默认、合成历史个人范围来源保留、目标管理重开、同范围替代唯一有效发布、撤销后同版禁重发、版本与承接回看、390px 及首道不通过停止第二道和发布。

截图：`.local/issue-128/browser/main-running.png`、`sources-1440.png`、`sources-390.png`。此前脚本调整分别保留 `browser-joint-first-attempt.log`（API 新事项后 UI 列表未刷新）、`browser-joint-second-attempt.log`（未选目标行及以不出现的替代文案作等待）、`browser-joint-third-attempt.log`（误选无发布的 v2 且弹窗未关）、`browser-joint-fourth-attempt.log`（窄屏仍选替代候选），均属于浏览器脚本定位／等待修正，不记为产品 RED；最终同一完整场景全部通过。

### 作者自审补强

- RED：`node --test --test-name-pattern='开题来源缺省|main session presentation' tests/strategy-kickoff-host.test.ts tests/strategy-initiative-ui.test.ts`，退出 1，2 项均按预期失败：pending 被另一 requestId 的 completed 记录误判成功；任意未知字段名被回显进 HTTP error path。输出 `self-review-red.log`。
- 修复：pending 存在时只采用匹配 requestId 的 lastRun，其他请求的 busy/终态不能解决当前 pending；未知字段名仅在满足既有路径字符／长度白名单时进入 path，否则回到父字段并保留 unknown_field。
- GREEN：同一命令退出 0，2 项通过，输出 `self-review-green.log`。

## 3. 联合验证与完整检查

- `npm audit --audit-level=high`：退出 0，高危门槛通过；报告 2 个 moderate（minimatch／Pi 1.4.0 传递依赖）。未执行 force fix，未升级到 Pi 1.6.0，未修改锁文件。输出 `npm-audit-high.log`。
- 第一次完整 `npm run check`：退出 1，停在 `check:agent-sessions`；新增浏览器脚本使用环境变量动态 import，命中“non-literal module loading”。产品测试未开始。改为字面量静态 import，未扩大边界白名单；原失败保留 `npm-check-first.log`，单独复跑边界检查 PASS。
- 第二次完整检查在作者自审发现上述两处补强点前主动停止，不作为完整结果；部分输出保留 `npm-check-second.log`。
- 自审补强后的第三次完整 `npm run check`：退出 1；3272 项中 3159 通过、2 失败、111 条件跳过。两项既有回归均由 HTTP 全局附加 details 引起：旧战略地图要求通用安全文案，Issue 115 导入 HTTP 回包不得新增 details。输出 `npm-check-third.log`。
- 修复：HTTP details 仅对 `strategy_kickoff_schema_invalid`／`strategy_kickoff_source_invalid` 开放，其他 StrategyDiscussionFault 保持原通用合同；未削弱既有测试。
- 定向复核：旧地图、Issue 115 导入和开题 Host 共 17 项，17 通过、0 失败，输出 `http-contract-green.log`。
- HTTP 收窄后的完整 `npm run check`：退出 0；3272 项中 3161 通过、0 失败、111 条件跳过，测试耗时约 394891 ms；`check:agent-sessions` PASS，build 通过，构建标识 `0.1.0-mvp.4 7ef6ebb+local-changes`。输出 `npm-check-fourth.log`。111 跳过为既有条件项，不宣称已执行。
- 同一最终构建重跑联合浏览器：退出 0，26 项全部 PASS，零外部浏览器请求；输出 `browser-final.log`。
- 固定提交 `9538106e60239bf19bf824683569953eddacecfc` 后完整 `npm run check`：退出 0；3272 项中 3161 通过、0 失败、111 条件跳过，测试耗时约 375179 ms；边界检查 PASS，build 标识 `0.1.0-mvp.4 9538106`。外置日志：`/Users/bendandebaba/.qoder-cn/evidence/issue-128-strategy-trial-repair/npm-check-head-final.log`。
- 同一已推送 HEAD 重跑联合浏览器：退出 0，26 项全部 PASS，零外部浏览器请求。外置日志：`/Users/bendandebaba/.qoder-cn/evidence/issue-128-strategy-trial-repair/browser-head-final.log`。
- 工作树误删事故后，`node_modules` 曾缺失；已按锁文件 `npm ci` 恢复，未升级依赖。重建后源码工作区干净，提交 `9538106` 已包含全部实现与规格／结果；事故时是否存在未提交源码改动无法事后证明，不宣称无损失。

## 4. 四原则与 IN01–IN07 专项最终检查

作者按实际代码、调用链及已执行隔离证据检查：

- Host 管环境：校验、scope／文件／版本权限、回执和状态投影均在 Host；未代 Agent 写开题、候选或检验结论。
- Agent 自主执行：开题按 path/reason 自行修正；候选冲突后自行读回并决定明确新保存；Host 不自动换号或补稿。
- 复用 Pi／统一 Runtime：仍为官方 1.4.0、Interface v3 和原 domain；未新增会话循环、代际 Map、SDK 改写或依赖升级。
- 减少人的操作：来源缺省、候选自查、当前 scope 默认、正常状态和依据一键回看均减少人工；保留明确另存、显式恢复和既有治理确认。
- IN01–IN05、IN07：规格已记录版本／owner／profile；候选工具保持 owner 闭包；启停／取消／订阅沿原 domain；战略差异留在业务适配器；错误和文件核对保持白名单；正常／取消／配置变化／迟到／保存恢复及旧消费者已纳入回归。
- IN06：Qoder 按 Issue 明确范围实施接缝，DTO／持久字段为兼容增量；Codex PM 后续接回集成、独立复核、CI 和结案。

作者专项检查未发现新增职责越界、平行 Runtime 或无必要人工步骤；结合完整 check 与联合浏览器，本候选作者专项结论为通过。本项不是独立复核，Codex PM 的非作者复核、CI 和产品验收仍分别待执行。

## 5. 独立复核、CI、产品与运行采用

- Codex PM 独立复核：NOT_RUN。
- PR head CI：NOT_RUN。
- main push CI：NOT_RUN。
- 用户产品验收：NOT_RUN。
- 设备更新／服务切换／运行采用：NOT_RUN。

## 6. 范围外观察与限制

- Issue 已说明真实试用原始入参、截图和原生会话未提供，本单不反推其未证实细节。
- 公开 URL 无历史快照时只保留不可核对原因，不新增快照存储。
- `docs/user-manual.md` 与 `src/host/ui/help-content.ts` 仍描述旧「战略地图／战略模拟／版本与来源」入口，与当前四页签存在既有文档漂移。它不直接阻塞本单五项验收，本轮未顺手修改，留后续独立处理。
- `npm audit` 的 2 个 moderate 属既有锁定依赖，修复建议会升级 Pi 到 1.6.0，超出本单授权；未执行。

## 7. 误删后的证据保全与断链说明

- 本工作树曾被误删后由 `git worktree add` 重建；Git 内源码、测试、规格和结果提交不受影响，候选已推送 origin。
- 原 `.local/issue-128/` 中部分 RED／GREEN／浏览器日志和截图未及外置归档即丢失；本文早期相对路径可能断链。不能用重建后的空目录或新运行冒充原失败证据。
- 已外置保全的关键日志位于 `/Users/bendandebaba/.qoder-cn/evidence/issue-128-strategy-trial-repair/`，包括 `npm-check-fourth.log`、`npm-check-head-stopped.log`、`npm-check-head-final.log`、`browser-head-final.log`。最终 Issue 回执以这些可访问证据和已推送候选为准。
- 其他 worktree 的未跟踪 `.local` 缓存／run 回执损失由用户另行记录；本单不恢复、不重放、不猜测其内容。
- 早期本文引用的 `.local/issue-128/` 相对日志（kickoff／candidate／handoff／state／sources／self-review／npm-check-first～third／browser-joint 各 attempt 与 green）在误删中 LOST；其当时结论曾按实际命令输出记录，但原始文件现无法复核，证据状态标 NOT_PROVED。外置保全及返工新增日志以 `/Users/bendandebaba/.qoder-cn/evidence/issue-128-strategy-trial-repair/` 实际文件为准。

## 8. PM 退回返工（2026-11-24）

PM 独立复核退回两项合并阻断，仍由 Qoder/Mac-mini 在原分支整体返工。

### R1 开题／候选保存排队期间取消仍落盘

- RED：`node --test tests/strategy-save-cancel-queue.test.ts`，退出 1，2 项失败。受控 mutate 门闩下，进入工具时 context 有效，排队后 abort 再释放门闩，开题报告与候选正文／saveReceipts 仍写入，并携带已取消 requestId。外置日志：`save-cancel-red.log`。
- 修复：在现有 mutation 提交回调起始处重核 `context.assertCurrent()` 与 `context.signal.throwIfAborted()`，沿用统一生命周期；未新建运行台账。为永久回归增加窄测试接缝 `captureTool`，仅测试注入使用，不开放 HTTP 入口。
- GREEN：同一命令退出 0，2 项通过；取消先于提交零写入，提交后取消原结果／回执继续可读。外置日志：`save-cancel-green.log`。

### R2 SSE 正常 EOF 未提示观察连接受损

- RED：浏览器脚本新增正常 EOF 场景：合成 Provider 保持运行，events 请求返回 HTTP 200 有限 `text/event-stream` 后结束。修前页面仍显示正常 accepted 运行文案，无断连提示；pending 防重保持。外置日志：`browser-eof-red.log`。
- 修复：`watchInitiativeEvents` 正常 resolve 且非显式 abort 时，Workbench 同样标记 `observationDisconnected` 并提示可刷新核对；保留请求编号、防重和显式恢复语义。
- GREEN：重新 build 后浏览器 28 项全部 PASS，包含正常 EOF 提示、EOF 后 pending 防重及原 26 项联合场景。拒绝 SSE 对照由后续 PM 独立浏览器复验覆盖；零外部浏览器请求。外置日志：`browser-eof-green.log`。

### 返工后完整检查

- 完整 `npm run check`：退出 0；3274 项中 3163 通过、0 失败、111 条件跳过，测试耗时约 371155 ms；边界检查 PASS，build 通过。外置日志：`npm-check-rework.log`。
- 提交后固定 HEAD 再执行 build 与联合浏览器，最终结果写入 Issue 返工回执。

## 9. Codex PM 接回与独立复验

2026-11-24，Codex PM 接回远端候选 `11f7388ecfe89b500331728ae8442ad38737b627`。源码 tree `7b417e8ec3e2d9f1edcb3499b1e11223362e726f` 已逐文件 blob／mode 核对，基线 main 为 `7ef6ebb81b735ffecdad3753217a96f02cb95c76`。

- 非作者 Host 轴独立验证 24 项通过，覆盖真实 HTTP／Pi／合成 Provider、旧记录实际进程重启、current-only／signal-only 排队取消零写入及提交后取消的原回执保全。
- 非作者 UI 轴独立浏览器验证 42 项全部通过。正常 EOF 的旧失败已转为实际提示观察受损并保留防重，主动取消订阅和成功／失败／取消终态控制通过，范围承接、准确旧版本与来源失读、键盘及窄屏联合路径通过。
- 非作者规格／工程规范轴增量通过。历史丢失材料的 LOST／NOT_PROVED 保留，能够逐件核实的证据以实际留存文件为准。
- PM 接管原任务分支，校正本规格的交付状态及作者浏览器覆盖措辞。后续候选 SHA、完整检查、PR head CI、合并提交及 main push CI 的实际结论统一回填 [Issue #128](https://github.com/gadfly-hbo/OptraCall/issues/128) 与 [PR #130](https://github.com/gadfly-hbo/OptraCall/pull/130)。设备运行采用与用户产品体验由用户安排。

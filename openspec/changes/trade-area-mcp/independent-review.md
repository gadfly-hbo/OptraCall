# 商圈数据 MCP · 非作者独立复核汇总

2026-11-03。本文件由Codex仅作两份独立发布报告的原文汇集，不合并、重排或改写发现与结论。两名复核者均非本候选作者，以干净上下文先自行导出预期，再核代码/测试；源、规格、既有证据只读，验证/报告只写其隔离根。工程协助探针作者不充任独立复核者。

运行候选v7：基线 `7109a6e63660a900b557300a73765f852c2cbd00`，HEAD `6633353dc1b01524a4c3e3b5c9a2f4cc03a7f58a` 加Codex工作树增量，49文件清单SHA-256 `39fd7dcd0ea9884a2671a761270151a948e40e14cb419d72a6f4cf7728a7cdaa`。最终作者全量检查933项/930通过/0失败/3条件跳过，边界/类型/构建通过，检查后49/49字节未变。随后仅README空评分说明与本报告/spec/result纯文档收尾，最终清单在仓外 `trade-area-handoff-20261103/codex-candidate-v8.json`；运行源码/测试没有变化。

原独立报告/日志仍在各自仓外证据根，不把其文件名误解为公开仓已包含这些原始资料。以下两个发布版均保留原报告的发现、历史失败、失效范围、修复重验和局限。

- 规范轴原报告SHA `df305474eca5be53a98483de0932883193d731ad4c8c9fcff96f95f4eca197e6`；自包含发布版SHA `7adedbc9d646238b9b93512fd8fdc968d017b99dba3b180e4e5ec2e60723d4d6`。
- 规格轴原摘要SHA `6747bbcb784fba6fee87588943190e765895b37ba21406cd9361e7d17438290a`；自包含发布版SHA `592954a429e444454292a5107dd9e519ba15fd5132559b489829cee2be08060b`。

两轴限本地已核范围通过、无开放阻断发现；不等于Git/CI、合并、运行采用、真实模型质量或用户产品验收。IN06与Host–Agent职责/复用专项详见各轴原文。

---

# 商圈 MCP 候选：非作者工程规范轴复核

状态：**通过本次本地工程规范轴复核。范围为固定v7运行时候选＋已核README纯文档P3修正；后续v8文档收尾仍须窄核。没有Git/CI、合并、运行采用或产品验收结论。**

## 摘要（少于400字）

已独立核定v7的49项路径与全部运行时字节，再核README一处纯文档修正。两项P2（权重数值、协议精确键）及P3说明均已修复复验，原失败与首修不足保留。独立目标44项、兼容37项、后续协议21项及SM03十一项通过；最终作者完整检查933项/930通过/0失败/3条件跳过，边界/类型/构建通过。IN06最小SDK复用和Host–Agent职责专项通过，未见平行Runtime或Host编排分析。无未闭合行动发现；Git/CI及运行/产品验收仍另行。

## 1. 身份、独立性及范围

- 仓库：`/Users/bendandebaba/.codex/worktrees/trade-area-delivery/OptraCall`；分支 `qoder/data-mcps`。
- 基线：`7109a6e63660a900b557300a73765f852c2cbd00`；HEAD仍为 `6633353dc1b01524a4c3e3b5c9a2f4cc03a7f58a`，另含Codex WIP。
- 运行时固定清单：`/Users/bendandebaba/OptraCall-artifacts/trade-area-handoff-20261103/codex-candidate-v7.json`，SHA-256 `39fd7dcd0ea9884a2671a761270151a948e40e14cb419d72a6f4cf7728a7cdaa`。独立以Git NUL分隔核对全部49路径（含untracked）及SHA，见 `candidate-v7-identity.json`。完整check后作者49/49回读已复看。其后仅README文案P3修正：SHA `d867363b2f46b5c98b1399bab3a4a2871ad88ef39fb13b399e4c1762aa16a99f`；我独立回读49路径，除这一明确文档增量外48项全部与v7一致，见 `final-v7-plus-readme-identity.json`。
- 固定比较：`git diff 7109a6e63660a900b557300a73765f852c2cbd00...HEAD`，并检查 `git diff 7109a6e63660a900b557300a73765f852c2cbd00`、cached/porcelain和新增文件。初始提交差异、实际工作树差异与状态存于独立证据根 `/Users/bendandebaba/OptraCall-artifacts/trade-area-review-standards-zpmscpz6/`；未提交新增文件由完整manifest与隔离副本覆盖。
- 我未参与候选实现；先阅读规范并于作者result之前独立写 `expectations.md`（SHA-256 `2c865a10e30b87b149ef85278d16294474992c412156791db25c7b2bdde1506f`）。原预期和输入哈希不覆盖。之后按MCP图发现函数、trace及snippet；最终新改动按已知路径的实际字节读取，未把旧图缓存当最新源码。
- 源、测试、规格和原证据只读。验证在独立证据根 `/Users/bendandebaba/OptraCall-artifacts/trade-area-review-standards-zpmscpz6/` 下复制的527文件候选中运行，node_modules只读复用；无源仓source/dist/.local/Git写入、远端写入、真实模型、服务切换或MacBook操作。Node25.9.0 / Darwin arm64 / Pi SDK1.4.0。

## 2. 十二项预期逐项核对

| 预期 | 规范轴结果 | 独立证据与实际范围 |
| --- | --- | --- |
| ES01 Host环境/Agent自主 | PASS | `server.ts:109–134`只按真实任务提供能力及路径，`project-session.ts:112–149`注册和检查工具，server三工具返回事实/确定性评分。未见Host固定查询流程、方法配额、经营判断或逐次确认。合成Provider测试中的筛选→详情→评分是测试脚本，不是产品编排。 |
| ES02 SDK/Runtime复用 | PASS | 生产链为原project-tasks域→原公共生命周期→ProjectAgent worker→原SDK SessionRuntime/MCP→stdio server。连接器只用MCP协议SDK及本地Store，不创建Pi会话/域/profile/owner。详见专项。 |
| ES03 owner/profile/配置权威 | PASS | `server.ts:125–128`重新解析项目/任务，构造可信codeRoot/dataRoot；只把已验证布尔选择转成IPC options。无客户端workspace/sessionFile/Provider注入。注册、取消及清理继续由原公共层权威管理；未向Extension传管理domain。 |
| ES04 默认关闭/受管封闭排除 | PASS | 独立目标集通过真实SDK的普通默认关闭/显式开启和fixed-draft、text-only、ordinary、protected四类资源排除；不是仅看options。普通任务read/bash/edit/write仍在，未改变原工具合同。 |
| ES05 切换/取消/资源收尾 | PASS（限直接stdio） | 实际HTTP忙时409、stop保留可复用MCP、能力变化经公共close后stdio退出、再开原native前缀不变。自造关闭失败探针得到500、元数据逐字节不变、旧开关保持、后续409且不自动重试，恢复原close后安全退出。SDK可观测目录变化、直接和codemode嵌套、恢复及reload持续冻结均实际通过。 |
| ES06 注册/清单/目录冻结 | PASS（SDK可观测范围） | 原API双参数、默认hidden且仅三名direct。目标测试证明下划线碰撞不能spawn、非产品用户MCP仍可用；独立精确同名配置探针证明默认0/开启3工具及恶意命令均未启动。目录冻结只承诺SDK已刷新适配信息，局限如实写明。 |
| ES07 固定路径/只读工具/权限 | PASS（协议P2已修；非OS沙箱） | `process.execPath`、可信server绝对入口、Host构造的数据根；env字面量美元符按SDK规则处理。main/server/store无网络、写入型MCP工具或凭据需求；batch≤50/page≤100及错误合同通过。v6对未知/不完整键的真实协议独立6类探针均返回结构信封，基础类型/必需顶级字段仍可由SDK拒绝。stdio继承driver环境不被表述为凭据或文件沙箱。 |
| ES08 任务结构/历史兼容 | PASS | 结构决定S1–S4与实施范围一致：schema2 optional bool，不增加第二能力集合/域/ID；缺字段关闭。schema2读取字节不变、legacy迁移原生路径/父链保全与公共域/第三合成消费者37项通过；原simulation API同一路径兼容。 |
| ES09 公开数据与出口 | PASS（当前候选树） | v3已去标识并标清全部示意；原文私有保留。最终49路径增量逐项审查，额外与私有源实体名作不输出原值的交叉扫描，命中0。状态API只返回校验后的版本元数据；实际UI及README同时披露“连接器无网络”和“结果进入所选模型”。未审远端历史，不据此宣称历史所有提交均无数据。 |
| ES10 快照/数值/缺失合同 | PASS（两P2已修，业务事实另属规格轴） | R1版本目录、v1保全、不可变旧reader、幂等损坏拒绝、缺失详情拒绝、错误信封及缺失语义长期测试通过。权重P2及首修不足保留；v5八类独立数学探针通过，原2835默认结果全同，8组普通权重完整JSON22680/22680一致；协议精确键P2在v6独立闭合。未独立裁定C01/C02业务事实。 |
| ES11 UI正常入口与说明 | PASS（静态/证据复看） | 检查TaskCapabilityList/API和目录导航源；独立看作者实际构建的目录/能力面板截图及browser-verification.json。任务能力独立勾选、版本行/模型出口说明相符，天气仍独立后续。未另跑第二轮浏览器自动化，不把作者操作记录算我独立操作。 |
| ES12 工程检查/证据分层 | PASS（本次本地范围） | 独立目标44/44、兼容37/37；v6连接器21项和SM03十一项及协议6类增量通过。原v4全量SM03与v5全量SDK04失败保留并完成因果诊断/观测修正；最终串行v7完整check退出0，933项/930 PASS/0 FAIL/3条件SKIP、边界/tsc/构建通过，随后49/49身份不变。README后续仅纯文档修正。Git/CI、合并、产品验收和运行采用仍另行。 |

## 3. Host–Agent边界、公共生命周期及IN06专项

**当前已查调用链的职责边界与复用结论：通过。** 范围只含本次连接器及受影响接缝，不宣布整个既有产品已全面合规；本结论不代替后续Git/CI、合并及运行/产品验收门禁。

1. `server.ts`复用静态 `project-tasks` profile，key为真实project/task。Store保留任务元数据权威，公共domain持opening/operation/retirement，连接器Store只缓存数据manifest/index/shards，不是第二份会话资源台账。
2. 能力变化在Host mutate内确认归档和公共busy/revision占用，调用原domain.close成功后才保存新值。worker仍由原ProjectAgent入口创建；`scripts/project-entry.mjs`只转到 `runProjectSession`，会话、模型、重试、上下文和native均由Pi原实现承担。资源dispose经原SDK关闭MCP，普通stop与close语义分开。无新增分析Agent、全局队列或业务运行Map。
3. **IN06能力缺口已核实**：锁定SDK的 `extensions/mcp/index.js:248–262`让mcp.json同namespace覆盖extension注册；其默认loader仅内部实现而未从公共SDK导出函数；独立枚举安装包公共exports确认loadMcpConfig为undefined、createMcpExtension为function、VERSION1.4.0，见 `sdk-public-export-check.json`（命令exit0）。只靠相同名称白名单不能保持可信command/env与任务开关。
4. 最小复用在唯一导入面 `src/agent/sdk.ts:5–14`：固定字面量私有路径、VERSION==1.4.0及函数存在检查，失败不回落未过滤loader。没有另一套config parser或Runtime。`project-session.ts:207–213`完整转发原agentDir/cwd/projectTrusted，只过滤产品namespace并追加拒绝说明，保留原errors/projectConfig/autoEnableCodemode及其它server。
5. 独立loader探针证明trusted/untrusted项目配置和JSON解析错误保持原语义；真实Host+SDK精确同名碰撞探针证明恶意command不spawn，开关关闭/开启工具数分别0/3。目标测试另证明下划线碰撞、其它用户MCP可用。边界AST没有新增allowlist，新增node_modules路径绕过反例仍失败，完整源码扫描PASS。
6. 该内部导入的版本耦合和退出条件已在IN06记录/标准说明；升级必须重新核对，在公共loader可用时移除此例外。它满足本次“说明实际缺口、最小适配、独立复核”义务，不是风险豁免，更不扩大工具权限。

## 4. 发现、原始失败及处置

### F1 · P2 · 合法有限权重破坏比例及null语义（已在v5限范围关闭）

初始位置：`store.ts:183–194`接受有限非负权重，原 `scoring.ts:68–75`直接求和/乘积。四个1e308被接受却产生NaN，JSON变null，容易冒充缺数据；与R3/TA04比例语义及标准§4确定性计算合同不符。独立原反例见 `before-numeric-fix-independent-probes.json`。

首修v4虽修复巨大/MIN_VALUE输入，却漏“合计normal、乘积subnormal”；0.05与0.25在四个1e-308权重下被错舍入。规格轴发现后我独立重现并保存 `v4-underflow-counterexample.json`。v4已测用例PASS仍保留，但不得扩大为P2已闭合。

v5按最大正权重统一同比计算，先按原正权重检查缺失，回显原权重；独立八类结果全部符合期望，普通参考8组×2835完整JSON无差异。永久回归覆盖算术与MCP协议。`engineVersion`明确定义为四因子数学合同、候选/源码身份区分实现；这是尚未正式交付的同合同修正，不声称极端输入前后等价，不重导/覆盖旧快照。此解释与标准一致。

### F2 · 公开原型/夹具沿用真实实体且数值示意披露不足（已修）

初始位置：`docs/prototypes/connector-ui-demo.html:273–287`，另作者测试夹具沿用真实实体。未证明这些数值来源于私有源，但仅称“静态原型”不足以避免把真实实体的合成经营判断当事实。工程§7要求公开样例为合成或明确获准公开。v3去标识与就地合成披露通过；四项已确认交互保留，不改数学黄金值或削弱覆盖。当前树无实体名交叉命中。原文留私有，未改写Git历史。

### F3 · 候选外部manifest漏固定中文路径（身份问题，非产品缺陷，已修）

v1错误把Git C-quoted路径当字面路径并标deleted，实际中文文件存在；45实际hash匹配但第46项未固定。通知作者后，以NUL分隔重新枚举，v2起集合/哈希一致。`candidate-identity.json`保留原问题，原20项移交manifest未回写。

### 非产品RED与未决失败

- 我的首次额外探针使用非UUID requestId，API正确400拒绝；修正验证器后才跑真实合成路径。旧日志 `independent-probes-invalid-request-id.log` 保留，不算产品RED。
- Qoder“模块缺失RED”和夹具错误、原分页断言冲突、首次被边界拒绝的loader写法，在result按历史与当前解释分别保留；不据此伪造因果测试历史。
- 作者v4全量SM03与规格轴v5全量SDK04失败通过下述真实事件诊断、保留原断言的观测修正及最终完整check闭合；原日志不删除，也不以单项绿色冒充根因。
- 无可行动的Fowler气味发现；仓库明确认可的薄适配和可选布尔兼容方案优先。未为代码风格或工具已覆盖事项另报问题。

### F4 · P2 · MCP schema静默strip绕过精确已知键合同（已在v6关闭）

初始 `server.ts` 的weights/range对象使用默认strip；`store.ts`虽检查weights四键，收到的已是丢弃未知字段后的对象。规范轴独立以实际MCP Client+InMemoryTransport验证weights.extra和range.extra，均返回成功数据；应为invalid_param的断言退出1，见 `protocol-extra-keys-v5-red.log`。这违反标准§3的实现层精确键及结构信封承诺。

v6保留对象额外键到回调/Store，再明确拒绝；weights完整性也交由实现信封，SDK仍处理基础类型/必需顶级字段。未另建协议解析器。原脚本2类和扩展6类（两个嵌套extra、三个顶级extra、缺weight键）全部isError+invalid_param，退出0；21项连接器长期测试同时通过。见 `protocol-extra-keys-v6-extended.json`。未以扩大白名单或削弱断言关掉P2。

### F5 · P3 · score=null的README说明过窄（已关闭）

原README将null只解释为数据不完整，然而既有黄金明确全部权重0时也无分。最终文案已同时说明“某启用因子缺失”与“全部权重0/无启用因子”，均不等于低分；只改文案，不改算法或黄金断言。最终README SHA如身份节所列。

### 原全量失败：SM03远端close观测时序（已闭合，非已证产品drain故障）

独立复看 `/Users/bendandebaba/OptraCall-artifacts/sm03-drain-diagnosis-junfem_3/diagnosis.md`、自然case7的时序与汇总：SDK/abandoned已cancelled、原callback Error身份保留、busy=false/仅1请求后，服务端response.close才于约0.116ms后自然可见；没有额外stop/close/release。仅等待abandoned也未等到另一事件源的receipt。

v6 fixture逐请求close Promise只在真实close回调、写入closedEarly之后resolve，有界10秒失败，不催收或重放；三个原closedEarly、原Error身份、取消结果、请求数/busy断言保留。未改变产品生命周期。正确受影响 `tests/requirement-generation-repair.test.ts` 独立11/11通过，最终完整check相关测试通过。此结论基于原始时序和代码差异，不是盲绿重跑。

### 原全量失败：SDK04合法冷启动越过2秒观察窗口（已闭合，未见问题丢失）

独立复看 `/Users/bendandebaba/OptraCall-artifacts/sdk04-startup-diagnosis-f9tk89i2/diagnosis-final.md`、8例汇总及case1分层时序：在明示有界CPU竞争、未加扩展delay的真实SDK启动中，8/8问题在2.09–2.28秒自然到达；旧deadline时尚未进入session_start，发送至Host转发仅约0.23ms，真实回答accepted、随后open完成且Provider0。它证明同一失败模式可发生，不宣称还原原fullcheck当次调度全部细节。探针包装转义错误单独归类，非产品RED。

v7只为该startup case传10秒观察上限，通用缺省2秒不变；仍等待实际ui.request，保留问题到达时open未完成、回答accepted、open随后完成及Provider0四项原断言。无固定sleep、忽略错误或产品timeout改变。按父任务避免并发最终完整check，我未再次启动这组负载或独立重跑该单项；代码差异与原诊断独立核查，最终完整check该项通过。

## 5. 命令与证据索引

未写绝对路径的自建证据文件名（含JSON、日志、探针脚本、候选核对及早期失败）均指向独立证据根 `/Users/bendandebaba/OptraCall-artifacts/trade-area-review-standards-zpmscpz6/`。作者完整check、post-check与浏览器证据位于 `/Users/bendandebaba/OptraCall-artifacts/trade-area-handoff-20261103/`，其中浏览器文件在 `ui-qa/` 子目录；下表逐项区分执行主体。原始JSON/日志继续保存在这些仓外绝对位置，没有搬入公开仓。完整脚本、输入方法和日志可复跑，未复制私有实体或经营字段值。

| 命令/检查 | 结果 | 证据 |
| --- | --- | --- |
| Git只读NUL路径+SHA核对各候选及最终README增量 | exit0；v7及README增量共49路径匹配 | `candidate-v*-identity.json`、各版本delta、`final-v7-plus-readme-identity.json` |
| `node --test tests/trade-area-mcp.test.ts tests/task-capabilities.test.ts tests/trade-area-agent-flow.test.ts tests/project-session-guards.test.ts tests/protected-session.test.ts tests/agent-session-boundary.test.ts`（v5隔离副本，后续v6协议源另验） | exit0；44 PASS/0 FAIL/0 SKIP | `final-target-tests.log`；早期41与v4的43日志另留 |
| `node --test tests/project-migration.test.ts tests/agent-sessions.test.ts` | exit0；37 PASS/0 FAIL/0 SKIP；v5未改变其相关实现 | `compatibility-tests.log` |
| `./node_modules/.bin/tsc --noEmit`（独立v5） | exit0；最终v7类型检查另由作者完整check覆盖 | `final-typecheck.log` |
| `node scripts/check-agent-session-boundary.mjs` | exit0；全源码边界PASS；脚本/接缝在v5未变 | `full-boundary-check.log` |
| `node independent-probes.mjs` | exit0；原loader trust/errors及真实SDK exact namespace对照PASS；初始数值反例成立 | `independent-probes.json`、`before-numeric-fix-independent-probes.json`及脚本 |
| `node close-failure-probe.mjs` | exit0；一次合成close失败，metadata字节保全、flag不变、409隔离、无自动重试 | `close-failure-probe.json`、`close-failure-probe.log`、同名脚本 |
| `node numeric-fix-recheck.mjs`（v5） | exit0；八类数学边界PASS；2835默认匹配/0差异 | `numeric-fix-recheck.json`、`numeric-fix-recheck.log`、同名脚本 |
| `node ordinary-reference-recheck.mjs`（v5） | exit0；对6633353原实现，8权重×2835，完整JSON22680一致/0差异 | `ordinary-reference-recheck.json`、`ordinary-reference-recheck.log`、`original-engine-scoring.ts`与同名脚本 |
| 私有源实体名与最终49路径文本交叉扫描+人工审查 | exit0；实体名命中0；只输出计数 | `final-public-content-audit.json`；范围当前树 |
| `node --test tests/trade-area-mcp.test.ts tests/requirement-runtime.test.ts`（v6） | exit0；25 PASS/0 FAIL/0 SKIP，其中连接器21项 | `v6-protocol-requirement-tests.log` |
| `node --test tests/requirement-generation-repair.test.ts`（v6） | exit0；11 PASS/0 FAIL/0 SKIP | `v6-sm03-target-tests.log` |
| `REVIEW_STAGE=v6-extended node protocol-extra-keys-probe.mjs` | exit0；6类精确键信封均通过；原v5断言exit1保留 | `protocol-extra-keys-v6-extended.json`、`protocol-extra-keys-v5-red.log` |
| 作者串行 `npm run check`（v7；非我独立执行） | exit0；933/930 PASS/0 FAIL/3条件SKIP，边界+tsc+build；构建大chunk提示保留 | 作者证据根 `/Users/bendandebaba/OptraCall-artifacts/trade-area-handoff-20261103/` 下的 `full-check-candidate-v7.log`、`post-fullcheck-v7-identity.json`，均独立复看 |
| 作者浏览器结果及截图独立复看 | 文案/交互一致，未独立重跑浏览器 | 作者证据根 `/Users/bendandebaba/OptraCall-artifacts/trade-area-handoff-20261103/ui-qa/` 下的 `browser-verification.json`、`catalog-final.png` / `session-capabilities.png` 截图 |

## 6. 局限与最终门禁

- 本规范轴不取代规格轴对全部业务数学、C01/C02及原仓事实的独立验收；我仅在本报告列明范围独立检查。
- 没有独立跑整套npm check/build/依赖审计；目标、兼容、协议、类型和静态边界按各固定版本分别记录。作者最终完整check证据已独立复看并核身份，但仍标作者执行，不能冒称我独立执行。两项原全量失败的根因、源修改与后续通过分开保留。
- MCP指纹只覆盖SDK已刷新可观测目录；不覆盖完整raw元信息、未通知变化、检查到RPC间竞态或已在途调用撤销。SDK close的证据仅限本例直接stdio，不能证明全部逃逸后代退出。受管/封闭不因此开放MCP。
- 普通分析仍非敏感资料/凭据OS沙箱；工具结果会进入所选模型。没有真实Provider或专业分析质量结论，亦无Git/CI、合并、服务采用、MacBook或用户产品验收结论。

**总结论：通过本次本地工程规范轴复核；Host–Agent职责/Runtime复用及IN06专项通过。两项P2、P3文案及原测试观测失败均闭合，无未解决行动发现。结论限已核v7运行时和README修正；后续v8纯文档须窄核，Git/CI、合并与运行/产品验收仍另行。**



---

# 规格轴独立复核 · 自包含发布版

本文件依次收录最终摘要、实施前先行预期的可分享版本与逐项详证。先行预期保留形成当时的阶段叙述；最终结论与修复后范围以摘要及详证末尾为准。只将摘要中两个文档链接改成同文锚点，未改发现、结论或验证范围。原始摘要、分享预期、详证与各自SHA保留在复核隔离根；未纳入原私有预期或经营数据。

原始文档身份（SHA-256）：

| 文档 | SHA-256 |
|---|---|
| `spec-review.md` | `6747bbcb784fba6fee87588943190e765895b37ba21406cd9361e7d17438290a` |
| `expectations-shareable.md` | `fb0c6fca89e1e78e3bf458b791564c9129b4ad90359f493e5924eec95a73c841` |
| `spec-review-evidence.md` | `5a1e4f68cc4888f548e155e0df787f4c76cff276525cc13664d95da94ee9dad1` |

本地原始技术证据均位于 `/Users/bendandebaba/OptraCall-artifacts/trade-area-review-spec-zxlq5q82/`；父任务固定清单、最终全量日志与原浏览器材料位于 `/Users/bendandebaba/OptraCall-artifacts/trade-area-handoff-20261103/`。下文引用的JSON、命令日志和私有数据源是外部原始证据名称，不要求随本文件复制；必要的结果、身份、失败及限界已在正文列出。



---

<a id="spec-summary"></a>

# 商圈连接器独立规格复核

**结论：限范围通过；开放阻断发现0。** 依据先行20项独立预期（见[分享版](#spec-expectations)），复核原Qoder本体与Codex完整接缝。运行候选v7清单SHA `39fd7dcd0ea9884a2671a761270151a948e40e14cb419d72a6f4cf7728a7cdaa`，49/49源与隔离身份一致；随后仅README补全“缺少启用因子或全权重0均可null”，SHA `d867363b2f46b5c98b1399bab3a4a2871ad88ef39fb13b399e4c1762aa16a99f`，其余48项未变。

- [P2] 有限权重溢出及subnormal舍入破坏比例语义：最终同比缩放修复；原仓oracle 22680次＋512缺失组合无差异，8极端＋30近normal反例全部通过。首修不足与原失败保留。
- [P2] MCP schema静默剥离精确键：实际协议9例现均返回结构化invalid_param；合法/not_found及只读字节保全通过。基础类型/必需顶级字段仍可由SDK拒绝，标准明确。
- 真实SDK stdio三工具、默认关闭/任务级开启、四类受管封闭实际资源排除、生命周期与原native保全通过；C01/C02固定原上下文保留。UI四场景为原始截图/回执与代码的独立复读，未重启浏览器。
- v6相关目标37/37；v7启动单项独立1/1。最终root串行完整check原日志已核：933项，930PASS/0FAIL/3条件SKIP，含boundary/tsc/build。独立v5全check的SDK04失败、root SM03失败均保留，经自然时序诊断后只修观测夹具，顺序/关闭/次数/错误身份断言未削弱；未把旧绿色当最终证据。

Host–Agent职责与SDK复用专项通过。IN06例外限唯一sdk.ts静态复用锁定1.4.0原loader，保留原信任解析/其它MCP，过滤保留namespace；无新Runtime或消费者白名单扩张。目录指纹只覆盖SDK可观测适配目录，并非raw/原子pin；stdio也不构成OS沙箱。

未验：真实模型质量、Git/CI/合并、运行采用、安装、MacBook、天气或用户产品验收。逐项预期、命令、发现闭合及失效范围见[详证](#spec-evidence)。源/测试/规格/原证据只读，复核写入仅本隔离根。


---

<a id="spec-expectations"></a>

# 商圈连接器独立规格预期（实现前导出）

日期：2026-11-03。独立规格复核者；未创作任何候选代码、测试或规格；未读取作者会话历史或 result.md。此文只固定验收预期，不是最终 PASS。

工作目录：`/Users/bendandebaba/.codex/worktrees/trade-area-delivery/OptraCall`。父任务给定初始 HEAD `6633353dc1b01524a4c3e3b5c9a2f4cc03a7f58a`、基线 `7109a6e63660a900b557300a73765f852c2cbd00`；完整 Host 接缝候选尚待父任务固定。

隔离根：`/Users/bendandebaba/OptraCall-artifacts/trade-area-review-spec-zxlq5q82`。所有复核写入限于本根；TMPDIR 为本根 `tmp/`。仓库、固定证据及参考数据只读；不调用真实模型、不写远端、不切换运行服务、不更新 MacBook、不执行 Git 写入。

依据：AGENTS.md、工程规范 v1.3 §2–§4 / IN01–IN07、统一会话接入说明 Interface v3、产品讨论稿 v0.2、trade-area-mcp spec TA01–TA10 / R1–R8 / IN01、连接器讨论稿 D1–D13、已确认 UI Demo 四场景、review-handoff §3。读取文件的 SHA-256 见 `source-identities.json`。spec 内的作者实施段不作为通过证据。

## 预期与独立验证重点

| # | 预期 | 验收依据 / 必要证据 |
|---|---|---|
| E01 | 仅商圈连接器及必要 Host 接缝；天气独立后续变更，无云服务、原仓 UI/ETL 迁入、市场或写工具。 | D1–D5/D9；范围差异及依赖读取。 |
| E02 | 正好 search/detail/score 三个正交只读工具，`tradearea_` 命名；对比由 Agent 多次查询组合，无固定分析流程或逐工具确认。 | D10/R2/R7/TA01；真实 SDK 合成 Provider 调用三工具并组合详情。 |
| E03 | search 支持省/市/评级/关键词/指标条件及分页；detail 返回完整档案、来源、可信度、指标、推断标记与评分；详情分片按需加载。 | 可观察结果/D13；代表正反条件、缺省、空结果及分页边界。 |
| E04 | 参数越界、无效 ID、分页越界及数据不可用均产生 Agent 可读结构化信封（invalid_param / not_found / data_unavailable），不会以未处理异常替代；schema 基础类型后 store 精确校验可接受。 | R4/TA05/handoff §3；实际工具入口正常与错误路径。 |
| E05 | 搜索、详情、评分的批量/分页限制有限且强制；只读声明与真实实现一致，不访问网络、不用凭据、不写数据快照。 | R2/IN01/TA09；静态边界＋调用前后文件字节清单。数值上限按标准正文和合同核对一致性。 |
| E06 | 无键代表未公开；不生成零/占位数；inferred 保留；basis 只用于 benchmark；null 评分表示缺失而非低分。 | R3/TA03；原始输入与工具输出对照。 |
| E07 | 四因子评分数学与原仓 `src/scoring/model.ts` 等价，含内部子权重、用户权重比例、不分摊缺失因子、权重 0 因子排除及最终舍入；严格 null 保持。 | TA04/handoff §3；独立黄金权重与全量/抽样重算，重复输入确定性比较。 |
| E08 | 全量 2835 家快照来自固定原仓 HEAD 2ba41d2；身份包含来源 HEAD、generatedAt、条目数、内容哈希清单/摘要与引擎身份；工具结果可追溯实际数据版本。 | D7/D13/R1/R8/TA02；导入产物和工具真实返回。 |
| E09 | 导入 fail-closed：评分不等价时拒绝发布；同输入重跑幂等；新版本显式导入、旧版 history 可追溯；失败不得破坏当前可用快照。 | R1/TA02/handoff §3；隔离根中正常、二次、变更及失败导入，内容比较。 |
| E10 | 原始脏省份与原始数据不悄改；导入报告记录，查询/选项层不污染正常省份；已修正事实（C01/C02，私有映射）保持。 | R3/TA02–TA03/handoff §3；参考原产物与导入后逐值/抽样核对。 |
| E11 | 公开仓候选无经营数据及凭据/原始日志；业务数据仅在本机 dataRoot/connectors/trade-area/，参考与复核副本不入公开候选。 | D7/R1/TA08；候选全清单与内容检查，不能仅凭 gitignore。 |
| E12 | connector.json、README 与标准 v1 正文可独立理解，并对 id/transport/egress/credentials/工具名/schema/版本/启停/Host 接缝与实际实现一致；统一标准无重复权威。 | D4/R6/TA09；逐项对读代码及合同。 |
| E13 | 复用项目任务 project-tasks owner（projectId+taskId）及 Interface v3，不新域/profile/owner、不建并行 Runtime、不绕过 SDK/Host 权限；连接器不管理会话/凭据。 | IN01–IN07/TA06；调用链与边界检查。 |
| E14 | 默认任务无商圈工具，显式开启仅作用本任务；保存/重开与旧任务兼容；不会从当前列表伪造历史采用。 | D8/R5/TA06；真实产品任务 SDK 工具清单和实际可调用性，而非仅配置字段。 |
| E15 | managed ordinary、protected、fixed-draft、text-only 均无注入/无实际调用资格，即便能力开关开启；未开启普通任务原策略保留。 | IN01/TA06；合成 Provider 驱动的真实资源对照（不是只看 disabledBuiltinExtensions）。 |
| E16 | 两处开关：新建任务能力清单中经营推演与商圈独立选择；会话 Pi 能力与命令面板仅空闲可切换，经公共生命周期释放旧资源，下一发送用新选择，busy 不能改。 | UI 场景②③/handoff §2；HTTP/SDK＋浏览器点验及迟到/保存/取消受影响路径。 |
| E17 | 连接器分区首个已接入“商圈数据”，项目任务使用按钮为描边，与先例一致；导航到项目视图，无独立连接器页面。 | D11/TA07/UI 场景①；浏览器截图与实际点击。 |
| E18 | 文案如实展示本机数据/无网络外发、版本 chip；Pi 面板数据版本行对应真实 digest 摘要、条目数、引擎身份、来源 HEAD；不把天气未交付呈现已接入，不预设优劣。 | R8/TA07/UI 确认；页面与实际快照对照。 |
| E19 | Agent 自主决定是否/何时/怎样查与解读，Host 只管理注入/环境/权限/保存；不补计算或设置固定分析顺序。 | 工程规范 §2/§4/R7；本次实际代码调用链及可观察工具调用。 |
| E20 | 适用目标测试与全量 npm run check（含 agent-session 边界）完成；保留失败、SKIP、UNKNOWN、未跑项；真实模型、CI、合并、运行采用、MacBook 与产品验收各自区分。 | TA10/IN07/工程规范 §4–§8；独立命令与退出日志，源文件前后身份。 |

## 待候选固定后执行

1. 读取完整清单并记录所有候选文件 SHA-256，核对当前 HEAD/tree/WIP 身份；不以仍待实施的 Host 接缝缺失预判最终缺陷。
2. MCP 图优先发现代码（父任务索引名 `optracall-trade-area-delivery`），图不足时按已知路径只读读取；不读取 result.md 结论来形成预期。
3. 运行授权的连接器目标测试、独立反例与真实 SDK 合成 Provider 路径；测试临时根/编译产物/报告全部指向隔离根，不写仓内 dist/.local。
4. 最终报告逐项 PASS/FAIL/待验证，说明实测、引用证据与未跑项；若候选变更，旧 PASS 仅在未受影响范围保留。最终摘要少于 400 words，详证另附。

## 规格文字一致性观察（尚非最终发现）

- 讨论稿仍声称自定义/in-process transport，而本规格明确核对 SDK 1.4.0 仅 stdio/http；最终标准与实际接线按本变更最新规格核对。
- spec 中“进程内纯只读”与 stdio 描述需在完整候选中核对；纯只读/无网络是要求，不把 MCP stdio 子进程误判为另建 Agent Runtime。
- R3 可在导入或查询层过滤脏值，handoff §3 明确原数据只记录不改；预期原字节保全且正常查询不暴露脏省份为有效筛选项。


---

<a id="spec-evidence"></a>

# 商圈连接器规格轴独立复核详证

本附证只记录技术身份、计数与结论，不保存真实商圈名或经营数值。原先行预期为 `expectations.md`；可分享版本 `expectations-shareable.md` 仅把私有案例标签替换为 C01/C02，未修改义务（摘要见 expectations-privacy-note.json）。

## 身份与独立性

- 非作者；未创作或修补候选源码/长期测试/规格。先独立导出20项预期，再读取实现与作者证据。
- 仓库 `/Users/bendandebaba/.codex/worktrees/trade-area-delivery/OptraCall`；base `7109a6e63660a900b557300a73765f852c2cbd00`；HEAD `6633353dc1b01524a4c3e3b5c9a2f4cc03a7f58a` + Codex WIP。
- 运行候选 v7：49项，清单 SHA `39fd7dcd0ea9884a2671a761270151a948e40e14cb419d72a6f4cf7728a7cdaa`，源与隔离副本均49/49逐文件SHA一致（candidate-v7-check.json）。v6→v7仅结果记录与一个启动观察测试，运行时代码未变。
- 全部运行产物在本隔离根，TMPDIR为本根tmp；构建/全量检查在独立COW依赖的checkout副本，GIT_OPTIONAL_LOCKS=0。源、规格、原始证据、参考ETL只读。没有真实模型、远端写入、服务切换、MacBook更新或Git写入交付。

## 预期逐项

| 预期 | 结论 | 独立依据及限界 |
|---|---|---|
| E01/TA范围 | PASS | 全候选差异与清单；商圈本体和必要接缝，天气仅独立规格，无天气运行时。 |
| E02/TA01/R2/R7 | PASS | v5-target.log、v6-target.log：真实产品SDK经stdio完成search、两次detail自主组合与score；普通工具保留。Fake Provider非真实模型。 |
| E03/查询合同 | PASS | 全2835摘要/详情对固定ETL逐值比较，原详情按需分片；目标测试覆盖筛选、分页、空结果。oracle-summary.json。 |
| E04/TA05 | PASS after F02 | 9条独立真实MCP协议错误路径均invalid_param信封；另有not_found、data_unavailable；基本类型/必需顶级字段仍允许SDK层拒绝，标准已明确。protocol-contract-final-summary.json。 |
| E05/只读/批量 | PASS | detail/score≤50、pageSize≤100实际拒绝边界；协议调用前后根逐文件SHA不变；连接器实现无网络/写工具。该结论不等于OS沙箱。 |
| E06/TA03 | PASS | 原字段缺省、inferred、null保留；全部详情与原数据相等，独立合成检查缺失键/零值不混同。r1-contract/summary.json。 |
| E07/TA04 | PASS after F01 | 原model oracle共22680真实记录×权重比较、512缺失组合0差异；独立8极端权重+30近normal乘积矩阵通过。oracle-summary.json、extreme-ratio-summary.json、subnormal-product-summary.json。 |
| E08/TA02/R1/R8 | PASS | 全量2835独立导入，57分片，等价2835/2835、脏省份计数12；身份含源HEAD/生成时间/总数/完整文件hash/engine/importer；同源二次导入unchanged。不把供应的固定参考源提升为外部事实真值证明。 |
| E09/R1 | PASS | 自写r1-contract-probe：lazy reader锁旧完整版本、history独立可读、旧v1平铺字节和reader保留、评分/缺详情失败不替换指针、损坏同digest拒绝幂等，均通过。 |
| E10/C01/C02 | PASS | C01固定修正口径及完整上下文保留；C02两份固定参考详情逐值相同，老站/新高铁站上下文区分保留。private-case-summary.json；不另核外部现实事实。 |
| E11/TA08 | PASS scoped | 全候选清单/差异及关键内容审阅+私有全量名称精确token扫描，公开候选不含这些经营记录；数据仅仓外dataRoot/隔离私有快照。最终49项重新扫描0命中，见v7-final-readback.json；这不是全机/全历史秘密审计。 |
| E12/TA09 | PASS after F02 | connector.json、README、标准与本体/Host同源对读；data.location明确，3工具、stdio、无网络、默认关闭、错误边界与完整版本布局一致。 |
| E13/IN01–IN07 | PASS scoped | 复用project-tasks owner/公共会话入口；连接器无SDK/凭据管理；唯一SDK薄层导入例外见下节。导入约束/受控绕过在v2全check及后续目标回归通过。 |
| E14/TA06默认/开启 | PASS | 实际SDK请求和stdio进程检查：默认无工具且不启动；开启仅本任务；busy拒绝；空闲close后保存；native原字节前缀与指针保持。v5-target.log。 |
| E15/TA06受管/封闭 | PASS | 实际打开fixed-draft、text-only、ordinary、protected四类SDK资源，即便保存opt-in均无商圈工具；受管原工具策略保留。非仅配置断言。v5-target.log。 |
| E16/UI双入口 | PASS scoped | 两处复选与独立持久开关、busy禁用及公共close调用链；SDK/HTTP测试+四场景原始浏览器证据复读。未再次独立启动浏览器。 |
| E17/TA07目录导航 | PASS scoped | 独立审阅catalog-final/create-defaults/session-capabilities/completed-dialogue四场景截图、原始浏览器回执和UI源码；首个已接入、描边、导航项目。未把读图表述为新一轮浏览器点击。 |
| E18/UI版本/诚实性 | PASS | UI实际状态只读元数据，版本/引擎/条目/来源取已验证快照；结果自身标实际reader版本，不以当前面板伪造旧轮采用；原型天气/模型/数值为明确合成示意。 |
| E19/Host–Agent边界 | PASS scoped | Host提供任务/开关/可信路径、权限与生命周期，不硬编码分析次序、不补业务计算；连接器确定性评分是获准领域能力，结论由Agent自主形成；SDK继续管循环/工具/历史。 |
| E20/TA10 | PASS scoped | v2独立完整check exit0，929/926PASS/0FAIL/3SKIP；v5独立完整check exit1（SDK04观测窗），932/928PASS/1FAIL/3SKIP，保留。最终v7 root串行完整check exit0，933/930PASS/0FAIL/3SKIP含boundary/tsc/build，已独立读回原log与49项身份；SDK04最终独立单项1/1通过。 |

## 发现与闭合

### F01 [P2] 有限权重比例语义

原scoring.ts直接累加/乘权重，巨大有限数导致NaN/Infinity，JSON输出可被误成缺失null；极小数产生舍入偏差。首修仅按总和/非有限数fallback，独立额外反例证实总和normal但乘积subnormal仍错。最终统一按最大正权重同比缩放；缺失判断仍用原正权重，回显原值。普通固定原仓2835×8及512组合0差异，8+30极端/近normal反例全部闭合。保留concurrent-extreme-red.log、extreme-ratio-before-summary.json、v4-subnormal-product-summary.json及after日志。score-1仍标四因子数学口径；源码候选/提交单独标程序patch身份，不重标旧快照。

### F02 [P2] 协议静默剥离精确键

原server.ts的z.object会在store前剥离extra权重/指标范围键，绕过精确键检查；缺权重也无约定信封。独立MCP协议原3例复现。最终loose schema保留对象键，工具回调/Store明确拒绝，9例协议反向+合法/not_found路径及前后字节SHA均通过。原协议观察保留protocol-precision-summary.json。基础type错误仍归SDK，这一限界已写同源标准，不增建平行协议校验器。

### 非产品缺陷的证据/夹具问题

1. 初始v1清单C-quote中文路径被误标deleted，45/46；v2改-z枚举后全项SHA核实。原清单与失败检查保留，不把清单修复冒充代码修复。
2. 复制v3delta时遇到作者正在补RED测试：仅测试SHA超出v3，18项16过2败是混合时点而非v3正式结果，身份与日志保留。
3. 根v4全check的SM03：自然HTTP close比SDK取消回执稍晚。v6仅合成Provider增加真实close事件有界latch，三处await后原错误同对象、closedEarly、请求次数、busy断言均保留；独立相关37项通过。
4. 独立v5全check的SDK04：2秒窗口含worker/SDK冷启动。只读审查独立helper的8例受控CPU竞争原始时序，无扩展人为延迟，UI自然在2秒后出现，均尚未open完成、回答可接受、Provider0。v7只将该测试冷启动观测10秒，通用默认2秒、回答后2秒与全部顺序断言保持，未改产品。该诊断支持夹具原因，不声称复原原失败的每次调度。
5. 私有C01 initially被错误假设为未公开，C02案例标签被错误当summary名；改用固定原上下文及精确参考，旧失败保留且不是产品RED。独立协议探针hash-walk曾有TypeError，修正探针后再运行，原log保留。

## IN06与复用专项

限本候选通过。src/agent/sdk.ts唯一导入面以固定字面量复用锁定1.4.0原loadMcpConfig；版本/函数不符失败，无动态任意loader。查阅SDK实际实现确认配置按namespace优先覆盖注册，故保留namespace过滤有真实需要；保留原SDK全局/受信项目解析、其它用户MCP与错误。边界脚本仅增强node_modules路径识别，没有扩大SDK消费者白名单；无新Agent Runtime或会话运行权威。升级SDK须重核，公共loader可用后退出私有导入。

目录指纹仅观察SDK适配目录；已观察变化会冻结当前worker，包括嵌套调用及reload后仍冻。它不是完整raw tools/list或原子RPC pin，不能撤回在途调用或发现未通知/未刷新的变化。stdio继承驱动环境，代码只读不等于凭据/文件/网络OS沙箱；普通stop保留会话，close仅对实际SDK子进程退出有证据，不泛化到逃逸后代。受管路径继续排除。

## 未验及最终门禁

未做真实模型/供应商质量、Git/CI、merge、服务采用、安装、MacBook更新、天气实施或用户产品验收。UI为原始浏览器证据的独立复读，无新一轮独立浏览器执行。3项条件SKIP保留（平台反向用例及2项真实soffice渲染）。最终v7完整检查由root串行执行；复核者核原日志 `full-check-candidate-v7.log` 的EXIT_CODE=0及post-fullcheck-v7-identity.json的49/49，不冒称亲自运行该次全量。此后只有README文案改动，SHA `d867363b2f46b5c98b1399bab3a4a2871ad88ef39fb13b399e4c1762aa16a99f`；独立核实其余48项仍与v7一致，文案仅补全全权重0也返回null，原黄金已有覆盖。最终启动单项独立exit0/1PASS。原失败均经具体诊断及受影响重验闭合，未被后续绿色覆盖。


## 最终状态

2026-11-03：规格轴限本候选与README文案修正通过；F01/F02两个P2均闭合，无开放阻断发现。TA01–TA10及工程§4 Host–Agent/复用、IN06专项结论以上述实测与限界为准。后续若仅把本报告原文纳入与更新spec/result交付状态，可做纯文档身份/一致性窄核；任何运行时/工具合同变化需重新评估受影响结论。

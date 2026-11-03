# 历史天气 MCP · 非作者独立复核

2026-11-03。本地工程范围结论：**Spec轴、Standards轴及工程§4 Host–Agent职责边界/SDK复用、IN06既有例外复用均通过；已发现项均修复并独立重验，无未关闭可行动发现。** 结论限下述固定候选与实际证据，不代证真实API/真实模型、Hosted CI、Git交付/合并、设备采用或产品验收。

## 身份与独立性

两名复核者均由Codex主会话以不继承作者历史的干净上下文启动，未参与本候选任何代码/测试/规格创作；先分别冻结预期，再读实现/测试/result。源、测试、规格、既有证据只读；检查和诊断只在各自0700隔离根。工程辅助草稿作者不担任最终复核者。

- 原Qoder候选14/14哈希核对后接管，交接HEAD `d042110655e1b9de576a4541b2ad01fef589f1e2`；基线 `351d835b65db8c72a41f8d07961e6fac3c05f2c9`；HEAD加Codex未提交增量共同定义候选，不能仅写HEAD已受检。
- 最终运行候选v5：554文件完整SHA清单 `review-candidate-v5.json`，SHA256 `749737412b9263cf85a79ee632f1aacfdce84ad59f661663b090acede41bd05b`；两轴分别验证源及隔离副本全554文件一致，检查后再次核对零差异。
- Spec预期SHA256 `c873a1a02e487267379eadc4cc8c510036feec1771ec64a031ee8f1b3bbfaad0`；Standards预期SHA256 `a7e7268e1199beabcf1917e62759fcf6eb6a2d482ac2c697eef825a56b656169`。
- Root完整检查收据 `full-check-v5-receipt.json` SHA256 `05c9a8d0f2f534eda9e2d94a435edfc55333bfe134cbbdbe3629155dc0e96348`；原日志SHA256 `e91a4ce6d84c142d74be7c5f5e67c254b7717bd842da5122b19d4e738be79851`。两轴只读核原日志及身份，不冒称自己运行root全量。
- 本页由root汇总，后附独立报告原文（按标题降一级排版，正文不改）；原报告及哈希在仓外保留，旧PENDING/暂停结论由后续补证明确闭合，不追溯抹去。

## 发现及关闭

| 发现 | 首发/严重度 | 修复及重验 |
| --- | --- | --- |
| 原型城市名被当有效城市，参数错分类并送上游 | Spec / P2 | own-property查表；root因果RED→长期17项全绿，Spec同一独立探针10/10，天气26/26 |
| 双层node_modules链接令隔离副本天气worker权限失败 | 两轴各自复现 / P2夹具 | 仅两夹具链接最终realpath，无产品权限扩大；两轴原23/25→各25/25，原FAIL/诊断保留 |
| 历史“RED模块缺失”措辞不具产品因果RED证明力 | Standards / P3证据 | 原文保留，当前spec/result明确限定，不追认原作者TDD主张 |
| D12显示卡临时状态A→B沿用，能力值未串用 | root补查 / P2 UI | 会话组件key绑定既有任务身份；两轴核唯一代码差异、完整AX状态1→0→0→1及实际截图；v4单任务覆盖漏项与总体暂停保留，由v5附录替代 |

## 验收与职责边界核对

| 验收 | 本地结论/边界 |
| --- | --- |
| WX01 | 真Host/SDK/stdio P/Q+合成Provider/上游的取数、引用、缓存miss/hit/过期重取通过；真实API与真实模型另验 |
| WX02/03/04 | 正常/缺失/重复/null、跨年/闰日/空返回；参数/Retry-After/取消迟到/无重试；坏缓存/过期不回落及旧格式均过 |
| WX05 | 本机macOS OS+Node双层及OS单层实际非白名单直连/子进程拒绝，监听0命中；Host固定域/参数/DNS pin/TLS合同及fd协议通过。真实源可达/证书链/实际响应未验；其他平台fail-closed，不声称Linux已实跑 |
| WX06 | 默认off、独立能力、忙碌拒切/stop复用/close收净、旧JSONL前缀保全；四类实际SDK资源不注入；两个namespace各自持续冻结且另一方继续可用；双任务资源隔离均过 |
| WX07 | 作者浏览器目录/导航/两入口D12及跨任务复验通过；非作者分别核源码、原AX与截图，明确浏览器动作非本人执行 |
| WX08 | 标准v1补remote-api事实；Interface v3、project-tasks及原owner/profile不变；SDK唯一导入面与原loader例外复用，无新增依赖/例外/平行Runtime |
| WX09 | root固定v5 `npm run check` exit0：960项957通过/0失败/3条件跳过，边界/tsc/build通过；两轴独立核证据；Git/Hosted CI未授权未运行 |

3条条件SKIP保留：当前Mac支持受管profile而跳过unsupported平台分支；两项真实soffice页面图像测试跳过，不宣称PPT图像验收。Vite仍有>500kB chunk提示，不写“无警告”。

Host只管能力/环境/材料/权限及收尾，Agent自主选择查询和分析；P/Q与HTTP Map是同一SDK生命周期下的传输资源，未新增会话/owner/Runtime/分析编排。天气OS限制不能扩为整任务或普通工具的安全沙箱证明，SDK适配目录摘要也不是raw tools/list原子RPC pin。

收尾读回提示：共享main现为 `4a3be3d`（PR #28），尚未集成当前天气候选；上述复核/全量仅覆盖原base351d835上的固定v5。Git获授权后需集成新main并重验/复核受影响接缝及实际head CI，不能沿用本结论替代集成验收。

## 独立报告原文及证据索引

以下路径按各原隔离报告解释；v4旧结论应连同v5增量/最终补证阅读。

### Spec轴原报告（v4）

原件：`/Users/bendandebaba/OptraCall-artifacts/weather-independent-spec-6z2r2734/independent-spec-review-v4.md`；SHA256 `6cd523b7f15d33296986f24f61547afc5faac34258398274d8c1750b4e61e3c7`。

## Weather MCP 独立 Spec 轴复核（v4文档 / v3同字节运行代码）

结论：**已检查的 Spec / 职责边界及复用范围通过；无尚未处置的可行动代码发现。WX09 的根执行者最终全量结果尚待补证，不以本报告代证完整工程交付。**

复核者未参与候选任何部分创作。本报告先冻结预期、后核实现和运行检查，未照 result 生成结论。全部源、测试、规格、已有证据与 Git 保持只读。验证和诊断产物仅写本 0700 隔离根。未调用真实 Open-Meteo、其 DNS、真实模型、MacBook 或 Git；全部网络检查为 builtin mock / loopback / 合成 Provider。

### 1. 身份与独立预期

- 工作树：`/Users/bendandebaba/.codex/worktrees/weather-delivery/OptraCall`。
- 交付者固定清单声称 HEAD `d042110655e1b9de576a4541b2ad01fef589f1e2`，base `351d835b65db8c72a41f8d07961e6fac3c05f2c9`，含未提交 Codex 增量。按任务限制没有运行 Git，该提交身份不是复核者 Git 回读结论。
- 独立预期 `expected-before-candidate.md`，SHA256 `c873a1a02e487267379eadc4cc8c510036feec1771ec64a031ee8f1b3bbfaad0`。该预期在任何实现/测试/result读取前写入并设0400；输入摘要在 `spec-input-sha256.json`。
- v1 完整554文件清单 SHA256 `3e467a73c2911d437dd23425805ee2cbb61e822f263ed75090e19e52e1f05767`，源逐文件 SHA/字节匹配后复制。
- v2 清单 SHA256 `55bf9a32ae6901a4dca3f56da77fdd719865b92d624c9d782edd52e03e8a5aa6`：与v1恰两处测试夹具差异。
- v3 清单 SHA256 `c60a94146f3d76c7a28ba8ee740f6c3eaaeeb9cc276d046d10e0135026eb449c`：与v2恰 service.ts 和 weather-mcp.test.ts 差异。
- v4 清单 SHA256 `02b6032653fbd9e85c50f0d7b5cc269e21ea6259be4d625cde59c6ebeb100871`：与v3恰 result/spec 两文档差异；运行代码与v3逐字节相同。
- 每版均核全554文件源及隔离副本摘要，不只核差异。`candidate-v{1,2,3,4}-verification.json` 保留读回；末次 `candidate-v4-post-run-readback.json` 为554/554，无源副本变化。隔离目录名 `candidate-v1/` 保持，但现含已核v4字节；各版身份清单与原验证日志分别保留。

### 2. 预期 → 检查与结果

| 预期/验收 | 结论 | 独立检查及证据 |
| --- | --- | --- |
| E01 / WX01 / R8 | 通过（合成范围） | 真实 Host→SDK1.4.0→产品 weather stdio P/Q→合成上游→工具结果→后续合成分析；缓存 miss/hit/expired refetch 均实际经过，provider 6次请求符合3轮，不是用假Runtime代替。`weather-target-tests-v3.log` 中实际SDK两条路径；不代证真实模型分析质量。 |
| E02 / WX03 / 标准§3 | 修复后通过 | 精确额外键、城市/坐标互斥、有限坐标、真实日期/历史/≤366天、字段枚举、schema缺字段协议拒绝已查。独立原型城市反例见F1；v3 `Object.hasOwn` 后3例均 invalid_param 且fetch0。`independent-spec-probes-v3.log` 10/10及目标MCP信封检查。 |
| E03 / WX02 / R2 | 通过 | 独立跨年、闰日、空返回、缺日、重复日期、null与真实0；列长度/字段缺失/日期异常不伪造null或成功。coverage.complete是日期完整，字段null另列nullValueDates，未把null当0。每日值与上游逐值对应；`independent-spec-probes-v3.log` E03及目标回归。 |
| E04 / WX03 / R4 | 通过 | 独立quota/rate/auth/5xx/302/network分类与不重试；取消、超时后上游无视abort再返回也不写成功缓存；过期旧缓存失败保持原件并报错。适配器race、post-response signal、service pre-publish检查对应。Host mock还实测晚DNS不连网和响应取消销毁同一请求。 |
| E05 / WX04 / R3 | 通过 | 旧CacheEntry原形可读；字段排序规范化同键，hit保留原fetchedAt；坏JSON、请求身份错、缺字段、非法日期、未来timestamp真实miss重取；stale源失败/取消/超时不回落冒充成功，唯一原旧文件未变、无临时残留；`independent-spec-probes-v3.log`。Host固定cacheRoot、entries落位与README一致。 |
| E06 / WX05 / R1 / D12 | 通过（本机macOS） | P不导入连接器；Q由Seatbelt+Node权限限制，只继承fd3有限协议。实跑恶意域/路径/参数拒绝发生于DNS前、DNS/TLS固定选项mock、公开IPv4校验、redirect/overflow/late DNS/取消；实际Q直接TCP/Unix/DNS/子进程拒绝（含OS单层探针）、loopback命中0；fd协议malformed/replay/future-cancel/pending/response cap均过。没有对有效URL调用production fetch或真实DNS。 |
| E07 / WX06 / R5 / IN02–07 | 通过 | 默认off/on、同namespace配置碰撞不启动、其它用户MCP保留、busy拒切/stop保留server/close收净P/Q、native前缀及指针保全均实跑；`protected-session`实际SDK打开fixed-draft、text-only、ordinary、protected四类资源均无天气且mcp=false；task-capability重开/读schema2不改字节。日志 `weather-target-tests-v3.log`、`sdk-boundary-tests-v2.log`；v3/v4对该边界源码无改。 |
| E08 / WX06+08 / 标准§5 / IN06 | 通过（已查接缝） | sdk.ts唯一导入面只复用固定1.4.0私有loadMcpConfig例外，版本/函数不符fail-closed；天气复用公开registerMcpServer、绝对Node与可信入口、hidden+单名direct、原公共生命周期，未增owner/profile/域或Runtime。商圈/天气摘要/冻结状态按prefix各持有。实跑共用目录guard：direct/codemode改目录拒绝，改回及SDK reload仍拒绝；不是只看Map。`shared-directory-freeze-v3.log`及其phase产物。天气特定12阶段双namespace专项由另一非作者轴完成，本报告不冒称亲自重跑。 |
| E09 / WX07 / R6 / D11–12 | 通过（源码+截图核对） | 独立核TaskCapabilities两入口从勾选显示inline aside，无新增ACK/对话框/调用门槛；目录第二已接入天气、任务开启/出境/非商业许可/结果进入模型说明存在，导航同项目入口。独立看作者ui-qa-v2截图：catalog/create/session三图与源码一致；截图哈希及本人的检查范围记录于 `ui-evidence-review.json`。本复核者未亲自控制浏览器，不把作者操作日志改记为自己的交互结果。 |
| E10 / WX08 / R7 / D1–13 / IN01–07 | 通过 | 独立目录/变更、remote-api/stdio/单只读工具/none credentials/标准链接、README错误扩展与许可、明确缓存落位；标准随weather补P/Q事实及限制，Interface v3/project-tasks/原owner/profile保持。先前规格in-process/“独立进程”/末尾未决残句已按记录决定修正；v4补原Qoder模块缺失RED不可冒认产品因果RED，与工程§3一致。 |
| E11 / WX09 / 工程§4 | 已做目标通过；完整收尾待补 | 自己执行天气26/26、独立10/10、实际受管排除+task保存3/3、共用目录冻结1/1、导入边界exit0和tsc exit0。遵守根要求不与其并发完整npm run check；根的full-check-final尚待结束及身份核对。CI/Git/合并/运行采用/产品验收均未由本复核完成。 |

### 3. 发现与修复/复验轨迹

#### F1 — P2：城市查表接受继承属性（v1/v2 FAIL，v3修复）

位置：`extensions/connectors/weather-mcp/service.ts:76`（修复前 `CITY_PRESETS[args.city]`）。

独立反例：`city='__proto__' / 'constructor' / 'toString'`，正常历史日期；原查表得到原型对象/函数而非内置城市，lat/lon为undefined，合成fetch实际收到 `latitude=undefined&longitude=undefined`。服务在夹具返回数据时可报成功并写缓存；产品Host P会后置拒绝，表现为source_unavailable而非未知城市invalid_param。此发现是参数合同/误分类问题，**不是已证明的Host出境绕过**。

证据：独立脚本 `independent-spec-probes.mjs`；v1日志10项7PASS/3FAIL（3例同一根因）。作者新增长期WX03因果回归后以own-property查表修复；本复核者核v3全身份后，用同一未改独立脚本重验10/10，其中三例均invalid_param、dispatched=[]；再跑天气目标26/26。`independent-spec-probes-v1.log`与`independent-spec-probes-v3.log`原样保留。状态：**已处置并独立复验**。

#### F2 — 验证夹具：双层node_modules链接触发真实文件权限拒绝

v1天气目标25项23PASS/2FAIL：实际合成SDK miss路径工具返回非JSON错误，真实P/Q握手initialize超时。原日志保留于 `weather-target-tests.log`、`tmp/optracall-weather-transport-vVFKM2/fixture.log`。没有把初次失败改写成产品通过。

仅在隔离诊断副本为worker顶层catch输出error字段，得ERR_ACCESS_DENIED/FileSystemRead，resource为中间隔离candidate-v1/node_modules；真实路径是夹具code/node_modules→独立副本node_modules→原物理依赖，多层跨根realpath而非目录过长。诊断文件 `diagnostic-worker-start-details.json`；候选未插入诊断或扩权限。

作者仅修改两个夹具链接为最终realpath(node_modules)，产品权限不变；v2全554身份核对及差异恰两文件后同命令25/25通过。v3独立目标26/26再过。状态：**夹具修复复验完成，原2FAIL保留**。

### 4. 命令结果（全部在隔离根）

| 命令/身份 | 退出/计数 | 日志 |
| --- | --- | --- |
| v1 `node --test tests/weather-*.test.ts` | exit1，23/25，2FAIL | weather-target-tests.log |
| v2同命令（只夹具变化） | exit0，25/25 | weather-target-tests-v2.log |
| v3同命令（含长期原型名回归） | exit0，26/26，0SKIP | weather-target-tests-v3.log |
| 独立探针 v1 | exit1，7/10，3FAIL同F1 | independent-spec-probes-v1.log |
| 同一独立脚本 v3 | exit0，10/10，0SKIP | independent-spec-probes-v3.log |
| v2 `node --test --test-name-pattern='task optional capabilities|weather capability|task capabilities persist' tests/protected-session.test.ts tests/task-capabilities.test.ts` | exit0，3/3；首项实际循环4类SDK资源 | sdk-boundary-tests-v2.log |
| v3 `node --test --test-name-pattern='TA06: observed trade-area catalog' tests/project-session-guards.test.ts` | exit0，1/1，0SKIP | shared-directory-freeze-v3.log |
| v3 `npm run check:agent-sessions` | exit0 | check-agent-sessions-v3.log |
| v3 `npx tsc --noEmit` | exit0，空输出 | tsc-v3.log |
| 自己 `npm run check` | NOT_RUN：遵守根要求，不重复并发全量重负载 | 根最终全量另核 |

各命令TMPDIR均为本隔离根tmp。生成写dist的全量未在源执行；没有修改源或Git。独立候选文件运行后全哈希仍相符。

### 5. 职责边界与SDK复用专项

在本变更及受影响接缝范围**通过**：Host只负责任务启用、材料/路径、网络权限、取消和真实资源收尾；连接器只返回带来源的天气事实与确定性覆盖核对；未发现Host替Agent算经营结论、规定分析步骤、逐调用审批或平行推理循环。新增P/Q及active HTTP Map是传输权限/请求资源，沿原SDK会话进程组和公共生命周期，不是第二会话运行权威。Node/Seatbelt只对天气Q有明确支持边界，未扩大为全Agent网络防护/恶意代码通用沙箱。既有private loader例外的范围、版本锁、退出条件继续明确，未新增SDK任意导入面。

### 6. 未验证与结论边界

- 真实Open-Meteo参数、实际响应、API端许可适用/限流/延迟：未调用；本复核真实API和其DNS请求0次。根如后续获准冒烟须另记，不能追认本次检查。
- 真实模型专业分析/经营因果结论/用户产品验收：未运行。
- Linux实际OS隔离/CI：未运行；只核其明确unsupported fail-closed及本机测试，不以本机结果推广全平台。
- 本人浏览器手势：未操作；页面截图由作者提供并经本复核独立视觉检查，记录不合并。
- Git/CI、main合并、运行服务切换、MacBook采用：未运行，未授权开展。
- WX09根最终full-check-final与其收敛身份：待追加证据核对；本报告不宣布完整工程交付。

复核时间：2026-11-03T11:53:45.429647+00:00。


---

### Spec轴UI增量（v5）

原件：`/Users/bendandebaba/OptraCall-artifacts/weather-independent-spec-6z2r2734/independent-spec-review-v5-addendum.md`；SHA256 `4c01224193fbabb09d824efbcd6f080a51ff9d60db88532aaa3753eca737799e`。

## Weather MCP Spec 轴 v5 增量复核附录

本附录承接 `independent-spec-review-v4.md`，原报告、原发现、原FAIL日志均不改写。结论：**v5 本次 UI 增量在已查范围通过；v4 E09/D12关于显示状态隔离的覆盖由本次新增反例及修复核对替代。最终 v5 根全量 receipt 待追加。**

### 身份

工作树仍为 `/Users/bendandebaba/.codex/worktrees/weather-delivery/OptraCall`，未运行Git。完整v5清单SHA256 `749737412b9263cf85a79ee632f1aacfdce84ad59f661663b090acede41bd05b`，554/554文件源及隔离副本摘要匹配。相对v4差异恰 `src/host/ui/App.tsx` 与 `openspec/changes/weather-mcp/result.md`；源码差异仅会话 `<TaskCapabilityList key={activeKey} ...>` 一处key。连接器/Host P/Q/Agent/SDK/权限/持久结构/测试文件均与已复验v3/v4同字节。身份与文本差异分别见 `candidate-v5-verification.json`、`candidate-v5-delta.diff`。

### 新增反例与原覆盖限制

根执行者在v4全量通过后补查发现：A任务由关闭勾选天气并显示说明卡，切至预先已启用天气的B时，未重新挂载的TaskCapabilityList保留A的showWeatherExplanation=true，B错误继承说明卡。能力开关没有串用；问题是一次性说明的临时UI状态跨任务复用。原现场 `ui-qa-v3/b-inherits-a-before.{txt,jpg}` 保留，本复核者已独立读AX及看截图。

该反例源于根执行者补验，**不是本复核者早期发现**。v4 E09仅完成源码与单任务页面证据核对，没有覆盖A→B任务切换，先前在其已查范围通过不能扩为跨任务状态正确。本附录明确记录该覆盖漏项，不把v4旧结论继续用于此边界。

### 最小修复核对

`App.tsx:325` 为会话TaskCapabilityList添加 `key={activeKey}`。`activeKey`由已存在 `taskKey(active.id, activeTask.id)`产生，定义是 `${projectId}/${taskId}`，同任务稳定、真实任务或项目变化时不同；与邻近VerificationPanel/Feedback等面板的已有key模式一致。切任务会销毁旧组件实例，重新建立默认false的showWeatherExplanation；输入settings仍是当前activeTask，不新增持久ACK或更改weatherTools。TaskCapabilityList仍只在当前组件收到weather从关到开手势时置true，显示条件仍受settings.weatherTools约束。

复核没有发现新增SDK导入、owner/profile/生命周期、Host网络权限、数据结构或分析流程变化。职责边界及复用专项在此增量继续通过。

### AX、截图与结果复核

本复核者没有控制浏览器；以下为**独立检查根执行者留存的页面原始证据**，不改记为本人的交互操作。四份完整AX均核了URL中的实际任务身份、任务标题、weatherTools勾选值为1，以及具体`天气连接器出境说明`container数量；原文摘要与文件哈希在 `ui-v5-independent-ax-check.json`。

| 页面证据 ui-qa-v4 | 核对结果 |
| --- | --- |
| a-enabled.txt | A任务，天气Value1，说明卡1 |
| b-after-a-no-disclosure.txt | B任务，天气Value1，说明卡0；A说明状态未带入 |
| a-return-no-disclosure.txt | 返回A，天气Value1，说明卡0；未因返回重弹 |
| b-reenabled-own-disclosure.txt | B自己关闭后重新开启，天气Value1，说明卡1 |

另看 `b-reenabled-own-disclosure.jpg`：卡片位于B任务harness中，为普通内联说明，无额外确认对话框、ACK控件或逐调用门槛。ui-qa-v4仅提供这张图片；其他无卡状态由上述完整AX证据核对，未声称存在相应截图。对照修复前B继承卡图片可区分原失败与修复后B本人的启用说明。

`console.json=[]`、`provider-requests.json.requestCount=0`、`closed.json.status=normally-closed/requestCount=0/realModelCalls=0`与页面核对范围相符。任务切换验证期间没有发送合成Provider请求，也没有真实模型/API调用。真实DNS/API未由本复核者调用。

### 验证与全量分层

- 本复核者在隔离副本v5执行 `npx tsc --noEmit`，exit0，日志 `tsc-v5.log`。没有更改源、Git或已有证据。
- v3/v4独立天气26/26、独立参数/缓存/取消10/10、四类SDK排除/保全3/3、目录冻结1/1仍适用于未改字节的后端部分；不对这些范围重复造新测试。
- 已读取根v4 `full-check-final.log`，摘要为960项957PASS/0FAIL/3SKIP，构建完成；根报告exit0。该为根执行证据，非本复核者执行，身份和哈希记录 `root-v4-full-check-receipt.json`。v4全量通过不能发现或替代其后新增D12反例，本次UI源码变化后需根最终v5全量证据。
- 根v5 `full-check-v5.log`：待终态及固定身份receipt后追加；当前不预写其成功。

真实API/DNS、真实模型、Linux实际OS/CI、Git/合并、运行采用、MacBook与产品验收边界继续按v4报告分别列未执行，不因本UI修复扩大。

复核时间：2026-11-03T11:59:43.045765+00:00。


---

### Spec轴最终全量补证

原件：`/Users/bendandebaba/OptraCall-artifacts/weather-independent-spec-6z2r2734/independent-spec-wx09-v5-receipt-addendum.md`；SHA256 `d8744f1dc748e6107625970f8b164a3528a5b51e6d64df179ac2199d9d048605`。

## Weather MCP Spec 轴 WX09 最终 v5 全量补证

结论：**WX09 最终 v5 本地全量证据已独立核对；本地 Spec 轴与职责边界/复用检查在报告范围通过，无未处置发现。** 本补证将 `independent-spec-review-v4.md`、`independent-spec-review-v5-addendum.md` 中“根最终全量待补”的状态闭合；不改写原报告、FAIL或覆盖漏项。

本复核者未执行本次完整 `npm run check`，按分工读取并核验了根执行者收据与日志。收据 `full-check-v5-receipt.json` SHA256为 `05c9a8d0f2f534eda9e2d94a435edfc55333bfe134cbbdbe3629155dc0e96348`；日志SHA256为 `e91a4ce6d84c142d74be7c5f5e67c254b7717bd842da5122b19d4e738be79851`，两者实算一致。收据记实际命令 `npm run check`、exit0、Node v25.9.0、本机macOS、HEAD d042110（含本地增量），绑定v5完整554文件清单SHA256 `749737412b9263cf85a79ee632f1aacfdce84ad59f661663b090acede41bd05b`。

独立读日志首部可确认同一check依次执行导入边界、全部测试和构建；末部有测试960项、957PASS、0FAIL、0cancelled、3SKIP，之后tsc/Vite/stamp-build完成。无把3个条件SKIP算成PASS：

1. AV02 unsupported平台拒绝自动保护分支：当前OS与fresh owner支持受管profile，按条件跳过该反向场景。
2. API render页面图/图像endpoint条件测试：SKIP。
3. real soffice逐页图条件测试：SKIP。

上述3条收据原文均与日志逐字匹配。Vite存在大于500kB chunk提示，构建仍完成；未把其描述为零警告。核验后重新对源树及隔离副本全部554文件实算摘要，均仍与v5清单相符；没有只依赖收据自报的零差异。复核读回写在 `root-v5-receipt-independent-check.json`，原收据和完整日志只读复制至本隔离根 `root-v5-full-check-receipt.json`、`root-v5-full-check.log`。

v5 UI修复/AX/截图/独立tsc结论见v5附录；v4独立目标检查、P2城市修复和夹具原FAIL轨迹继续保留。全量只闭合本地工程证据，不代表托管CI、Git/合并、真实Open-Meteo或其DNS、真实模型专业分析、商业使用许可批准、运行采用、MacBook或用户产品验收；这些本复核均未开展。

核验时间：2026-11-03T12:00:46.835894+00:00。


---

### Standards轴原报告（v4）

原件：`/Users/bendandebaba/OptraCall-artifacts/weather-review-standards-20261103-mYzMJK/standards-review-v4.md`；SHA256 `ff3f726230e41c2140f1e3bd59c41e0c2823d10916693820f69ea499a3a6d84e`。

## Weather MCP Standards 独立复核

结论：**规范轴通过（限下述固定候选与检查范围）**；工程§4 Host–Agent职责边界及SDK/Runtime复用专项通过；IN06既有SDK薄层例外复用专项通过。当前无未关闭规范轴发现。最终完整`npm run check`仍由root在冻结候选上运行，本报告不预写该结果，不等于Git/CI、真实API、真实模型、运行采用或产品验收。

### 1. 预期与候选

本复核者未参与候选任何代码/测试/规格创作。先读AGENTS、工程规范§2/IN01–07/§3/§4/§5、统一接入说明、连接器标准§5、天气spec/review-handoff§4、D1–13与UI Demo D12、商圈IN06，再写`expectations.md`；之后才读实现/作者结果和测试。预期SHA256：`a7e7268e1199beabcf1917e62759fcf6eb6a2d482ac2c697eef825a56b656169`，准备来源摘要见`preparation-sources.json`。

源根：`/Users/bendandebaba/.codex/worktrees/weather-delivery/OptraCall`。branch `qoder/weather-mcp`；交接HEAD `d042110655e1b9de576a4541b2ad01fef589f1e2`，base `351d835b65db8c72a41f8d07961e6fac3c05f2c9`。本次含Codex未提交接缝，以完整清单而非HEAD单独定义候选。

最终受检清单v4：`/Users/bendandebaba/OptraCall-artifacts/weather-handoff-20261103/review-candidate-v4.json`，SHA256 `02b6032653fbd9e85c50f0d7b5cc269e21ea6259be4d625cde59c6ebeb100871`。逐项554/554字节/哈希一致；本隔离候选副本亦554/554一致。

- v1身份`3e467a73c2911d437dd23425805ee2cbb61e822f263ed75090e19e52e1f05767`：首次独立定向检查23/25，保留2 FAIL。
- v2身份`55bf9a32ae6901a4dca3f56da77fdd719865b92d624c9d782edd52e03e8a5aa6`：相对v1仅两个夹具链接修复；逐文件核对，25/25重验。
- v3身份`c60a94146f3d76c7a28ba8ee740f6c3eaaeeb9cc276d046d10e0135026eb449c`：仅service城市own-property与永久测试；19/19受影响检查。
- v4仅spec/result追加证据限定，原记录保留。收据见`candidate-verification*.json`。

全程原源/测试/规格/旧证据只读，无Git调用或写入；代码发现先使用`optracall-weather-delivery`图，之后按确切文件/字面量追查。固定base差异另核`base-to-candidate-v1.patch`，SHA256 `ffbc3ad1c38e1a4258b0a6ed109dc0e8f642248c4cb403e81e3cdfa23c297f9e`；新增Host传输文件同时按完整清单审查，未把patch当成全部候选。

### 2. 预期→证据核对

以下代码位置均相对源根；日志/独立探针路径相对本报告目录。

| 预期 | 结果与证据 |
| --- | --- |
| S01范围/同源决定 | 通过。独立天气变更、单历史工具；spec与S1–S5明确stdio P/Q和缓存entries、Darwin限定，旧in-process已更新，无新增预测/定时/多源/付费功能。历史与当期证据分开。 |
| S02 Host/Agent职责 | 通过。Host只注入能力、分配路径和约束网络/资源；`server.ts:104`沿project-tasks profile，连接器只供事实。没有新增分析步骤/方法配额/业务计算裁判/逐调用审批。 |
| S03统一生命周期/复用 | 通过。`project-session.ts:112`使用既有SDK MCP；`weather-transport.ts:68`的Q不detached，P内部Map只管理有界HTTP请求，非会话/owner队列；公共close仍经既有runtime.dispose。天气产品测试实际stop复用及close退休P/Q。新增传输是已记录SDK/网络能力缺口的权限适配，没有另建模型会话、Runtime或产品端口。 |
| S04 schema2/任务隔离 | 通过。`project-store.ts:174/238`可选bool，旧字段缺省off且读取不回写；`server.ts:594`公共busy→close→保存。`v3-affected.log`验证旧元数据字节；独立`owner-isolation.mjs`实开A/B各P/Q，关闭A只退出A两进程，B两进程及native前缀保持，A后续off/B继续有工具。 |
| S05四类实际SDK排除 | 通过。`project-session.ts:113/218`共同排除策略；独立运行`actual-four-exclusions.log`，fixed-draft、text-only、ordinary、protected真实SDK资源都无天气/商圈工具，managed保留原bash；不只是配置断言。 |
| S06 SDK薄层/IN06 | 通过。`sdk.ts`仍唯一导入面、锁定1.4.0固定内部loader及fail-closed条件；本变更未改sdk.ts或扩大边界例外。`project-session.ts:219`在原解析结果中过滤两保留namespace（含下划线碰撞），其他MCP/错误保留；真实天气测试的碰撞程序未启动且无关MCP仍可用。boundary独立exit0。 |
| S07目录指纹 | 通过。`project-session.ts:132`每namespace单独digest/frozen，exact工具/hidden策略保持。独立12阶段真实SDK探针含天气direct/codemode、变化/恢复/reload持续拒绝、另一namespace不误冻、close重建恢复，随后反向改商圈仅商圈冻结。详见`probes/namespace/phases.json`和`events.json`。 |
| S08 Host传输层实际出境强制 | 通过，限本机macOS。P入口不import连接器；`weather-transport.ts:52/65`不支持平台fail-closed，Q Seatbelt deny-default无网络/新进程+Node权限，仅fd3有限协议。`weather-egress.ts:50/76`在DNS前核固定HTTPS域/路径/六键，单次公开IPv4 pin、域名TLS/CA、无body/自选header/重定向/重试。独立天气测试实际跑OS-only及双层非白名单net/tls/http/fetch/UDP/Unix/子进程拒绝（监听0命中）、broker非法域与协议拒绝、生产HTTPS函数的mock DNS/TLS/取消/迟到/限额断言。不是只URL自检。 |
| S09数据/凭据及诚实隔离范围 | 通过受检范围。cache在Host数据根；Q环境最小、无外部凭据引用。normal分析仍是原工具环境，不称OS安全沙箱；标准明确stdio继承环境与Node权限局限。本次只用合成Provider/数据；未检查所有历史文件的全面敏感内容。 |
| S10 D12/UI | 通过静态接缝核对。`TaskCapabilities.tsx:24`同一组件供创建与会话入口，启用手势显示一次内联note，无modal/ACK表/逐调用门槛；域、参数/时区、非商业、模型上下文及空闲关闭/在途停止出口明确。`catalog-data.ts:37`与`CatalogPage`显示第二已接入条目及说明/描边导航。浏览器动态点验由作者证据另列，本轴未重复浏览器现场，不据此声称独立视觉验收。 |
| S11事实/错误/缓存 | 通过规范相关合同核对及定向检查。来源、时间、缓存标注；缺失/null不填零，错误信封与README一致，无自动重试；取消/迟到不发布成功缓存；缓存损坏miss。原型城市P2由Spec轴发现/root修复，本轴只核v3改动最小、无权限扩大及19/19受影响检查，不把该发现计为本轴首发。 |
| S12工程证据 | 当前独立定向、类型、边界均通过；root最终完整check待核。首轮2FAIL未抹去；TDD模块缺失只证明测试未可运行，v4当前spec/result已追加明确非产品因果RED限定，原文不回写。没有扩大allowlist/削弱反向断言凑绿。 |
| S13结论分类 | 通过本地复核记录范围。无真实API/该API域DNS、真实模型、SSH、MacBook、服务切换、Git/远端写。CI/合并/运行采用/产品验收保持未执行或待验证，原FAIL/UNKNOWN不改写。 |

工程§4专项结论：**通过**。实际调用链、进程证据与反向测试支持Host治理/Agent自主边界和既有SDK复用；P/Q不是另一位分析Agent。IN06专项：**通过既有例外的本次复用**，没有批准新的私有SDK导入或动态loader例外。未发现需要强制重构的Fowler启发式气味，未重复报告工具已覆盖项目。

### 3. 实际命令与独立证据

所有命令cwd均为本根`candidate/`，`TMPDIR`固定为本根`tmp/`，`NODE_DISABLE_COMPILE_CACHE=1`；未在源树运行写产物命令。

| 命令 | 退出/范围 | 证据 |
| --- | --- | --- |
| `node --test tests/weather-agent-flow.test.ts tests/weather-egress.test.ts tests/weather-mcp.test.ts tests/weather-transport.test.ts`（v1） | exit1；25项23 PASS/2 FAIL/0 SKIP | `logs/weather-targets.{json,log}` |
| 同命令（v2） | exit0；25/25，无SKIP；内含Host传输14及fd客户端13子探针 | `logs/weather-targets-v2.{json,log}`；`tmp/optracall-weather-transport-*/fixture.log`保留明细 |
| `npm run check:agent-sessions` | exit0 | `logs/boundary.{json,log}` |
| `./node_modules/.bin/tsc --noEmit` | exit0 | `logs/typecheck.{json,log}` |
| `node --test --test-name-pattern=task optional capabilities tests/protected-session.test.ts` | exit0；1测试包含全部4模式 | `logs/actual-four-exclusions.{json,log}` |
| `node --test tests/weather-mcp.test.ts tests/task-capabilities.test.ts`（v3） | exit0；19/19，无SKIP | `logs/v3-affected.{json,log}` |
| `node probes/namespace/namespace-probe.mjs`（绝对路径） | exit0；12阶段；实际SDK+生产P/Q，仅工具实现为独立动态合成server | `logs/namespace-probe.log`；`probes/namespace/{phases,events,requests}.json`；8个生产入口/治理源逐hash未变见`production-source-verification.json` |
| `node probes/owner-isolation.mjs`（绝对路径） | exit0；实际Host/SDK双任务 | `logs/owner-isolation.log`；`probes/owner-isolation.json` |

### 4. 发现、严重度与关闭

**F1 [P2] 夹具依赖链接不具隔离复制可移植性——已关闭。** v1 `tests/weather-agent-flow.test.ts`和`tests/fixtures/weather-transport-host-probe.mjs`建立嵌套codeRoot时，node_modules指向本独立candidate/node_modules的中间link；Q只获codeRoot/最终modulesRoot读权限，ESM realpath触发`ERR_ACCESS_DENIED FileSystemRead`（resource是中间candidate/node_modules）。导致真实worker启动失败，继而SDK天气工具不存在、initialize超时。保留原`logs/weather-targets.log`与`tmp/optracall-weather-transport-me4UAx/fixture.log`；额外诊断树只扩大错误输出定位，不修改固定源。`probes/worker-start-diagnostic/diagnostic-resource.log`记录实际resource；只把诊断树依赖link指最终realpath，同一P/Q initialize成功，见`canonical-link-diagnostic.json`。root v2只改两个夹具为canonical link，产品权限未放宽；本轴v2完整25/25关闭，原2FAIL保留。

**F2 [P3] 历史RED证据措辞需限定——已关闭。** 原spec/result记录“RED模块缺失”，按工程§3不构成产品行为因果RED。v4仅在当前补充明确其证明范围，不回写原记录、不追认TDD；本轴逐文件核查追加文字，满足证据保全。

独立目录探针初版`fs.watch`报EMFILE、没有取得有效基线，属于本轴夹具失败，不能记产品RED；`logs/namespace-probe-fixture-failed.log`和`probes/namespace/fixture-failure*`保留。改为只读轮询控制文件并按实际`/tools`观察版本后重验；生产8个关键源全部摘要相同，没有新增治理旁路。

### 5. 局限及未验

- 本轴没有重复root全量检查；冻结v4最终`npm run check`当前仍待完成/核证据。前期全量作者结果与本轴定向分开，局部通过不宣称全工程完成。
- 所有HTTP/SDK Provider均合成或loopback；生产HTTPS函数只在mock DNS/request下检查调用合同，**没有**调用真实Archive API或对archive-api域做真实DNS。真实源可达、响应、证书链、限流、延迟仍未验。
- 不支持平台仅实际模拟Linux fail-closed分支；没有在Linux主机运行OS隔离。支持范围为Seatbelt可用的macOS，不能把Node单独称恶意代码沙箱。Node官方也明确该限制：[v25.9.0权限文档](https://nodejs.org/download/release/v25.9.0/docs/api/permissions.html)。
- 许可文案与[Open-Meteo官方条款](https://open-meteo.com/en/terms)当前所述免费API非商业/CC-BY4.0一致；不代表商业使用已获许可或产品法律适用已完成评估。官方文档只读核对见`official-document-checks.json`。
- 指纹覆盖SDK已刷新适配目录，不是raw tools/list原子RPC pin；不证明撤回在途调用或发现未通知变化。普通分析仍保留原工具/用户MCP，不能由天气Q的网络治理推导整任务安全沙箱。
- 未重复浏览器现场、未做真实模型专业质量、Git/CI/合并、安装/运行服务采用、MacBook或产品验收；没有原件/旧FAIL恢复重放。上述都不在此次规范轴通过主张内。


---

### Standards轴v4暂停记录

原件：`/Users/bendandebaba/OptraCall-artifacts/weather-review-standards-20261103-mYzMJK/standards-review-v4-status-addendum.md`；SHA256 `72db086b93c1696ce94d55877ca03819f46386a7219c2fb661f4e52b558b5316`。

## v4状态附加记录

在standards-review-v4.md形成后，root指出新的待实证D12会话UI状态隔离疑点：TaskCapabilityList包含showWeatherExplanation本地状态，但会话入口未按activeKey重新挂载；A开启说明后切至已启用B可能继承true重显。root正在隔离浏览器复现，v4源未改变。

本轴v4报告S10只覆盖静态接缝且已明确未重复浏览器动态验收，没有覆盖该跨任务动态场景。**在该疑点验证/关闭前，暂停使用v4规范轴总体通过结论作为最终签收。** 工程§4职责/SDK复用与IN06专项通过不受此疑点影响，原25/25、四模式、12阶段目录及A/B资源隔离结果也保持各自范围。

本轴不参与产品设计或源修复。待作者提供复现及固定最小增量后，以附加报告核受影响范围，保留v4记录与这一新增疑点；不把疑点预写为确证缺陷，也不预写未来修复通过。


---

### Standards轴UI增量（v5）

原件：`/Users/bendandebaba/OptraCall-artifacts/weather-review-standards-20261103-mYzMJK/standards-review-v5-addendum.md`；SHA256 `ccc6dba4e4d1dba932e9407837b69a74c323bb28afc232b09b93b73eb90eccbe`。

## Weather MCP Standards v5增量复核

结论：**D12跨任务说明卡状态问题已关闭，解除v4状态附录的总体签收暂停；规范轴恢复通过（仍限原报告范围）**。工程§4 Host–Agent职责/SDK复用和IN06原通过结论保持。最终root `full-check-v5.log`尚待完成/核证据，不能据本附录宣称完整WX09、CI、Git或产品验收完成。

### 预期与固定身份

沿用先实现读取前独立冻结的`expectations.md` S04/S10/S13：任务级能力与临时说明状态互不沿用；D12只在实际启用手势显示非阻断内联说明，不新增持久ACK或逐查询门槛，保留旧失败。

候选v5 manifest `/Users/bendandebaba/OptraCall-artifacts/weather-handoff-20261103/review-candidate-v5.json` SHA256 `749737412b9263cf85a79ee632f1aacfdce84ad59f661663b090acede41bd05b`。原源554/554逐文件哈希/字节一致；与v4相比恰两文件：`src/host/ui/App.tsx`与`openspec/changes/weather-mcp/result.md`。收据`candidate-verification-v5.json`；精确差异`v4-to-v5.diff`。

额外字符串级等价核对：App唯一源码差异为会话`<TaskCapabilityList settings={activeTask}`变成`<TaskCapabilityList key={activeKey} settings={activeTask}`；其余App字节等价。`activeKey`原定义包含真实project/task身份，沿既有面板模式使组件自己的showWeatherExplanation在任务切换时重建，没有增加owner/profile/会话状态、持久同意表、权限或网络行为。创建对话既有remount不变。此前SDK/网络/四模式/namespace/资源隔离的受检源码均未变，本增量不重复无关测试。

### 复现→证据核对

root隔离浏览器v3先确证：A启用后切到预先已启用B，B标题与`session-weatherTools` Value1同时出现“天气连接器出境说明”。原`ui-qa-v3/b-inherits-a-before.{txt,jpg}`保留；能力持久开关本身未串用。该问题由root补查发现，本轴核其证据，不改写为本轴首发。

本轴只读检查root在同一v5构建上的浏览器证据，**没有自己操作浏览器**。证据根 `/Users/bendandebaba/OptraCall-artifacts/weather-handoff-20261103/ui-qa-v4/`：

| 场景/文件 | 本轴AX独立读取 |
| --- | --- |
| `a-enabled.txt` | A真实标题，天气选中，说明卡1 |
| `b-after-a-no-disclosure.txt` | B真实标题，天气仍选中，说明卡0 |
| `a-return-no-disclosure.txt` | 返回A天气仍选中，说明卡0；未由导航重显 |
| `b-reenabled-own-disclosure.txt` | B自身关闭再开，天气选中，说明卡1 |

本轴用文本检查实际AX的“container 天气连接器出境说明”计数，得到**1→0→0→1**；四份均核天气checkbox仍为Value1及相应标题，与`task-state-receipt.json`吻合。每份AX的SHA256及提取结果见`ui-v5-evidence-readback.json`。

本轴实际查看`b-reenabled-own-disclosure.jpg`：B被选中、天气勾选，说明为任务能力区内联卡，无弹窗/阻断；域、坐标/日期/字段/固定时区、非商业条款、结果进入模型上下文、关闭/停止出口可见。`console.json=[]`；`provider-requests.json` requestCount0/errors[]，`closed.json` status normally-closed、requestCount0、realModelCalls0。以上是作者浏览器动作的独立证据复核，不冒充本轴新执行，也不将API调用0推成真实源可用。

### 发现关闭与局限

新增F3 [P2] 临时D12显示状态跨任务沿用：以最小React身份绑定修复；上述源码等价核对及AX/视觉证据支持关闭。原v4报告`standards-review-v4.md`、暂停记录`standards-review-v4-status-addendum.md`、v3失败现场全部保留，未追溯覆盖。result仅追加真实轨迹，没有将该状态问题写成能力权限串用。

规范轴当前0未关闭发现。原§4/IN06结论及本轴25/25天气、四模式SDK排除、19/19受影响、12阶段namespace和A/B资源隔离仍按原固定源码范围有效。v4全量root报告exit0不能代替v5全量；v5最终全量运行证据待另附确认。仍未执行真实API/该API域DNS、真实模型、Git/CI/远端写、MacBook、服务采用或产品验收；本轴不重新全面检查浏览器所有页面。


---

### Standards轴最终全量补证

原件：`/Users/bendandebaba/OptraCall-artifacts/weather-review-standards-20261103-mYzMJK/standards-review-full-v5-supplement.md`；SHA256 `d231806024b97a8855263d7bd6dcea881a4d46bd972d561c4dd22b72a6fbe041`。

## v5最终完整检查补证

本轴已只读核对root执行的固定v5完整检查收据与原始日志，**没有重跑或冒称本轴执行全量**。`standards-review-v5-addendum.md`中的最终全量PENDING现由本补证闭合；规范轴、工程§4职责/SDK复用及IN06限定通过保持，无未关闭规范轴发现。

- 收据：`/Users/bendandebaba/OptraCall-artifacts/weather-handoff-20261103/full-check-v5-receipt.json`，实际SHA256 `05c9a8d0f2f534eda9e2d94a435edfc55333bfe134cbbdbe3629155dc0e96348`。
- 原始日志：`full-check-v5.log`，实际SHA256 `e91a4ce6d84c142d74be7c5f5e67c254b7717bd842da5122b19d4e738be79851`，与收据完全一致。
- 命令`npm run check`，macOS arm64/Node v25.9.0，source cwd weather-delivery/OptraCall；收据记录实际exit0，日志存在边界PASS、完整960项/957PASS/0FAIL/0cancelled/3SKIP、tsc及Vite/stamp完成。构建保留大于500kB chunk提示，不冒称无警告。
- 对应完整候选v5 SHA256 `749737412b9263cf85a79ee632f1aacfdce84ad59f661663b090acede41bd05b`；交接HEAD仍`d042110655e1b9de576a4541b2ad01fef589f1e2`，验收对象含未提交文件，不能仅写HEAD。收据postCheckMismatches=[]；本轴再次逐文件核554/554哈希，当前源零差异。

三项条件跳过的原文均在日志找到：AV02不支持平台拒绝分支因当前OS/新owner支持受管profile而跳过；`api: render produces page images and image endpoint returns data url`与`page_images renders every page with matching count (real soffice)`两项SKIP。它们未变成PASS，未声称本机跑过不支持平台或真实soffice页面图像能力；天气受限传输本机检查没有以这3项SKIP代替。

核对摘要和三条完整原文见`full-v5-independent-readback.json`。v1独立23/25、初版夹具/目录探针失败、v4UI暂停、后续最小修复及重验保持原文件，不由最终绿色覆盖。

本补证只闭合本地完整工程检查的证据；root收据记录真实API/模型/MacBook/Git写/服务切换0。本轴未执行这些动作；未运行Hosted CI、Git交付/合并、真实Archive API/DNS、真实模型专业验证或产品验收。后续spec/result与汇总报告的纯文档收尾身份仍需另核，不能预写未来交付。


---

# 商圈数据 MCP 连接器 · 实施与验证记录

2026-11-03 · 分支 `qoder/data-mcps` · 当前状态：Codex 接缝、最终本地完整检查与非作者独立复核已完成，发现已闭合；用户已授权Git/CI与实际head CI通过后直接squash合并，交付进行中。以下先保留 Qoder 移交时记录，最新状态见末节。真实模型验收与设备更新另行授权。

## 授权与流程

- 用户确认[讨论稿 D1–D13](../../../docs/商圈天气MCP连接器能力承接产品讨论稿_v0.1.md)与 [UI Demo](../../../docs/prototypes/connector-ui-demo.html) 后，2026-11-03 授权 Qoder 产品开发（AGENTS.md 当前授权段）；按 D9 商圈连接器先行奠基标准，天气连接器为后续独立变更。
- TDD：`tests/trade-area-mcp.test.ts` 先行（RED：模块缺失失败）→ 实现至 GREEN。过程中修正两处测试夹具缺陷（原始 metrics 未填、分片结构与真实契约不符），并修 4 处 tsc 严格类型错误；无跳过断言。

## 实施范围（实际交付物）

```
extensions/connectors/trade-area-mcp/
├── connector.json            # 标准清单 v1：stdio transport、egress=[]、credentials=none、3 工具
├── types.ts                  # 数据契约（承接原仓 src/types.ts @2ba41d2；含 KNOWN_PROVINCES）
├── scoring.ts                # 四因子评分端口（optracall-tradearea-score-1；数学承接原仓 model.ts）
├── store.ts                  # 只读查询层：懒加载、筛选/详情/评分、结构化信封（invalid_param/not_found/data_unavailable）
├── server.ts                 # McpServer + 3 工具（zod 基础类型收口，精确约束留 store 层走 isError 信封）
├── main.ts                   # stdio 入口（TRADEAREA_DATA_ROOT / --data-root，缺失明确退出）
├── import-data.ts            # 快照式导入：逐文件 SHA-256、内容寻址 digest、评分等价 fail-closed、幂等、history 归档、脏值报告
├── scripts/import-data.mjs   # CLI 包装
└── README.md
docs/mcp-connector-integration.md   # MCP 连接器接入标准 v1（TA09）
tests/trade-area-mcp.test.ts        # 10 项测试
package.json / package-lock.json    # 新增 @modelcontextprotocol/sdk@1.32.2、zod@4.6.7
```

实施核对事实：pi SDK 1.4.0 `registerMcpServer` 仅支持 stdio/http 注册（无 in-process），connector.json transport 定为 `stdio`；真实详情分片为 `DistrictDetail[]` 纯数组（合成夹具已按真实契约对齐）。

## 真实数据验证（2835 家全量）

- 参考数据来源：MacBook trade-area 原仓（HEAD `2ba41d2`）`public/data/` 经 ssh 只读拷贝至 `.local/trade-area-ref/`（21M，gitignore）。
- 导入命令：`node extensions/connectors/trade-area-mcp/scripts/import-data.mjs --source .local/trade-area-ref/public/data --data-root .local/trade-area-data-dev --source-head 2ba41d2`
- 结果：`imported`，total **2835**，分片 **57**，快照 digest `e9185d4e52c9c2788508284310efeb803610e8a9be9b4191fb48e9ac26e0d6fc`。
- **评分等价性：2835/2835 一致，0 不一致**（存储 score 与本仓评分端口逐值重算相等，含 null↔null）。
- 脏省份 12 条（原始值仅保留在仓外私有报告），导入报告完整记录，数据原样保留。
- `score=null` 共 96 家，与原仓"2739/2835 可评分"结论吻合。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `node --test tests/trade-area-mcp.test.ts` | **10/10 PASS**：评分黄金（子权重分摊/严格 null/权重 0 排除/舍入）、导入幂等+digest 变更+fail-closed、筛选/详情/评分合同、信封报错、MCP 协议 in-memory 往返（3 工具/只读标注/structuredContent/isError）、无快照 data_unavailable |
| stdio 真实路径冒烟 | PASS：子进程 JSON-RPC `initialize`＋`tools/list`＋三工具各一次（真实数据的筛选、档案与自定义评分已抽验；公开记录删除具体商圈名称及经营数值，原记录仓外保留；pageSize 500 → `isError`+`invalid_param`） |
| `npm run check` | exit 0（agent-session 边界检查＋全量测试＋构建） |
| `npm test`（全量） | **914 项：911 PASS / 0 FAIL / 3 条件 SKIP**（3 SKIP 为仓内既有条件跳过项） |
| 公开仓数据边界 | `git status` 核对：仅代码/文档/测试入仓；数据在 `.local/`（gitignore）与 dataRoot |

## 验收映射（TA01–TA10 当前状态）

| 标识 | 状态 | 说明 |
| --- | --- | --- |
| TA02 | PASS | 幂等/版本身份/导入报告（单测＋真实导入） |
| TA03 | PASS | 缺失语义与推断标记（单测＋真实数据抽查：inferred/basis/null score 96 家） |
| TA04 | PASS | 评分黄金对照（单测＋2835/2835 真实等价） |
| TA05 | PASS | 结构化报错信封（单测＋stdio 冒烟） |
| TA08 | PASS | 公开仓无经营数据 |
| TA09 | PASS | 标准正文随交付落仓，与本实现一致 |
| TA10 | 部分 | `npm run check` 通过；"既有链路回归"以全量 914 项为准 |
| TA01 | 待接缝 | 需 Host 注册接线后经产品任务会话实测（Codex） |
| TA06 | 待接缝 | 需接缝后核启用边界/受管任务不注入（Codex＋复核） |
| TA07 | 待接缝 | 浏览器点验能力目录条目（Codex） |

## 如实缺口与未验证项

- Host 接缝（会话注册、能力目录条目、产品 dataRoot 正式导入）归 Codex，未实施；本记录不宣称产品链路可用。
- 真实模型任务端到端（TA01 产品路径）、浏览器点验、独立复核、Git/CI 交付未做，分别按授权推进。
- 商圈连接器工具在受管执行/封闭任务中的不注入行为依赖 Host 侧接线与既有 `disabledBuiltinExtensions` 边界，待接缝后专项核对（标准 §5）。
- `.local/trade-area-data-dev/` 为开发验证数据根；产品 dataRoot 正式导入在接缝集成时执行。


## Codex 接管实施与本地验证（2026-11-03）

### 候选、权限及保存

- 按用户要求顺序阅读规范、spec/result、移交包，fetch 后确认基线 `7109a6e63660a900b557300a73765f852c2cbd00`、移交 HEAD `6633353dc1b01524a4c3e3b5c9a2f4cc03a7f58a`，原清单 **20/20** 文件 SHA-256 前16位一致，清单自身 SHA-256 `ff5119d8bc13e3532ee9fade899456492787562a7a25953c2d75afe735bea128`。原清单与移交包未改写。
- 原 Qoder 工作树核实干净后切游离，独立工作树检出 `qoder/data-mcps`；Codex 唯一写入者，不回转 Qoder。当前授权为接缝实施、正式本机导入、本地验证及独立复核；尚未提交、push、开 PR、运行 hosted CI 或合并。
- 原始命令、因果 RED、失败、SDK/native 与浏览器证据保留于本机仓外 `/Users/bendandebaba/OptraCall-artifacts/trade-area-handoff-20261103/`。原 Qoder result 中的具体商圈样例和脏值已从公开文档去除，原文保存在该私有证据根；原结论与失败不删除。公开仓只含实现、规范与合成测试。

### 实施与修正

- [结构决定 S1–S4](structure-decisions.md)：保留 schema2 可选 `simulationTools`，新增可选 `tradeAreaTools`；缺省关闭、各自独立、旧元数据不因读取重写。固定任务能力清单共用 UI/API；旧 `simulation-tools` API 兼容。空闲变更先经同一 owner 的公共 close 再保存，忙碌/归档/关闭失败不保存新值，不改历史及 native 指针。
- 正常任务显式开启才经既有 SDK `pi.registerMcpServer(name, config)` 注册可信绝对入口的 stdio 子进程；受管 ordinary/protected、fixed-draft/text-only 均不注入，不新增域/profile/owner/Runtime。原移交包的单对象签名已在当前标准纠正，移交包作为历史输入保留。
- 已确认 SDK 1.4.0 默认配置可覆盖 extension 的保留 namespace。唯一 SDK 导入面复用其原默认 loader 并过滤此 namespace，保留其它用户 MCP、原信任处理和错误。固定内部导入、版本门槛与退出条件写入 spec IN06，须非作者专项复核；没有新增动态加载白名单，边界检查反而覆盖 node_modules 路径绕过。
- SDK 观察到的三工具描述/参数/暴露目录首次完整时固定摘要；变更即本资源内持续冻结，直接和 codemode 嵌套调用均阻断，改回或 SDK reload 不解冻，显式关闭重开后才能重新核对。只覆盖 SDK 已刷新并可见的目录，不宣称原始 MCP 全部元信息、未通知变更或在途调用的原子冻结。沿用 SDK stdio 生命周期：stop 取消请求仍保留资源；close 释放实际直接子进程，不宣称终止所有可能逃逸后代。
- **R1 缺陷已修复**：原实现归档 manifest 后覆盖数据，旧懒加载 reader 可持旧 digest 读新值（因果失败 `1 != 5`）。现按 `versions/<digest>/` 保存完整不可变快照后发布当前指针，importerVersion=2；旧 v1 平铺只读兼容，升级保全旧字节与完整历史。缺失详情/重复或不一致来源在发布前拒绝；读入校验字节与 SHA，幂等重导亦不能掩盖损坏；失败不自动修补或覆盖现有版本。
- TA03/TA05 修正：脏省份原样保存/报告，但不接受为合法省份筛选；超结果范围分页、非安全整数、反向及非有限指标区间返回 `invalid_param`。
- 已接目录条目、项目导航、新任务双能力独立勾选、任务内开关与真实版本行；元数据状态接口不返回商圈正文/本机路径/凭据。明确“连接器无网络”与“查询结果进入所选模型上下文”同时成立。stdio 默认继承驱动环境，不将其描述为凭据/操作系统沙箱。

### 产品 dataRoot 正式导入

复用本机已有只读来源，未进行本轮 MacBook SSH 或开发侧操作。来源记录 HEAD `2ba41d2` 为移交来源身份，未伪装成本轮远端 Git 重证。58 源文件逐一与 Qoder 开发快照核对 SHA/长度一致；2835 条 index 与全部详情逐值对应，0 缺失/重复/字段差异。

正式导入位置 `/Users/bendandebaba/.optracall/connectors/trade-area/`，执行 CLI 返回 `imported`：**2835 条、57 分片、58 文件，评分 2835/2835 一致、0 不一致，12 条脏省份警告如实保存**。原始经营数据与含原值报告仅在仓外私有根，未进入 Provider 请求或公开文档。导入前目标连接器根不存在；未改其它产品配置/凭据，未切换或重启原运行服务。

- 当前 digest：`6bbaa68cf255b8213d5641ce49de681e3cd2b227584eb3c58ff62b2e76e0fffd`。
- importerVersion **2**；评分引擎 **optracall-tradearea-score-1** 未改。摘要区别于旧 v1 开发摘要是 importer 身份变化，原 v1 证据保留。
- generatedAt **2026-10-05T14:50:07.157Z**（来源实际值；Demo 的日期为示意）。全部58个落盘文件再次核对清单 SHA/长度。
- 私有 `product-import-report.json` 保存完整警告，公开/元数据只显示技术汇总。未将本机导入外推为服务采用或真实模型验收。

### 当前验证

| 范围与命令 | 实际结果与证据 |
| --- | --- |
| `npm run check`（第二次完整候选） | 边界、全量测试、tsc、构建通过；**929 项 / 926 PASS / 0 FAIL / 3 条件 SKIP**；`full-check-complete-contracts.log`。既有构建大 chunk 提示保留。首次完整检查927项也通过，后新增2项R1回归再验。 |
| `node --test tests/trade-area-mcp.test.ts` | **17/17**；`legacy-corruption-contracts.log`，含原评分黄金、stdio合同、完整历史、旧v1保全、损坏幂等拒绝及TA03/TA05反向边界。 |
| `tests/trade-area-agent-flow.test.ts` + `tests/task-capabilities.test.ts` | 实际 Host →公共任务会话→真实 SDK→真实 stdio，合成 Provider 完成 search/detail/detail/score，手算60/80；默认关闭、任务隔离、配置碰撞、其它用户MCP、metadata、忙碌409、stop/close/重开native保全。各项包含于全量。 |
| `tests/protected-session.test.ts` | Darwin 四类实际 SDK 资源（fixed-draft/text-only/受管 ordinary/protected）无商圈工具/MCP；`closed-managed-actual-sdk.log`。不是仅检查 options。 |
| `tests/project-session-guards.test.ts` 新增目录变化回归 | 正常直接/嵌套两次 callback；实际观察目录变化后两路拒绝，恢复目录及真实 SDK reload 更换stdio PID后仍冻结；临时目录证据复制到仓外 `directory-regression-verified/`。 |
| SDK 边界回归 | 新增相对/绝对 node_modules 私有导入绕过反例，9/9；仅既有 SDK 单一导入面允许，未扩 allowlist。 |
| 四场景浏览器点验 TA07 | 实际构建+隔离 Host/合成2条数据：目录首个已接入/描边导航，新建默认双关闭/独立勾选，任务内开关/版本行，对话三工具。页面操作 Provider 请求0；仅显式发送后5次本地合成请求、4工具结果均同一版本、控制台0。`ui-qa/browser-verification.json` 与6张截图保留；QA已正常关闭，测试子进程已退出。 |

浏览器数据与 Provider 均为合成，仅证明接缝及操作，**没有调用真实模型**，未向模型发送正式2835条经营数据；专业分析质量不在本次结论内。

失败如实保留：最初 TA01 探针误读 Provider `context.body` 是验证器错误，修正为 `availableTools` 后才记录缺工具的因果 RED；严格来源校验揭示旧测试夹具遗留孤儿分片，修正夹具后重验；原分页“越界返回空页”断言与TA05冲突，改为结构化错误断言；首次非字面量 SDK loader 被现有边界拒绝，改为单一导入面固定字面量并新增更严反例。上述原日志均在证据根，没有将它们伪记为产品因果 RED 或以放宽检查取得通过。

### 首轮自检映射（独立复核前，保留当时范围）

TA01 接缝路径（合成 Provider）通过；TA02–TA06 的适用确定性/实际SDK检查通过；TA07 浏览器点验通过；TA08 仅代码/合成数据入仓的内容检查需随最终暂存再核；TA09 标准与实现同步，待独立复核；TA10 全量本地检查通过。此前 Qoder “待接缝”保留为移交时事实，不代表当前仍未实现。

**当时待完成**：非作者独立复核及发现闭合；随后依用户授权进行最新 main 集成/提交/push/单 PR/实际 head CI；squash 仍须用户确认。真实模型验收、MacBook更新、天气及未来数据版本导入各自另授权。此时不宣称工程交付完成、产品验收或运行采用完成。


### 候选固定及内容审计补充

两名复核者指出作者新生成的 v1 外部清单把 Git C-quoted 中文路径误判为删除；v2 改用 NUL 分隔枚举，46/46 SHA 核对通过。此为新增复核清单的枚举错误，原移交20项清单未变、无身份差异；v1及失败核对记录保留。后续内容去标识后另固定新清单，不沿用旧摘要。

工程辅助与规范复核发现原数学夹具和静态原型沿用真实商圈名，原型对评分/天气等合成示意也未作充分披露。现仅将实体改为合成A–E、增加就地合成说明，保留数学数值/黄金断言/筛选与缺失覆盖及已确认四场景交互；17/17目标回归通过（`privacy-fixtures-regression.log`）。TA03保留原修正案例的检查义务，以C01/C02及仓外私有映射查核，不把原实体或经营字段值回写公开报告。旧样例文件保存在私有证据根，不改写原Git提交历史。标准中两处从注册id猜目录的旧句同步改为清单 `data.location` 的明确路径。


### 独立复核 P2 首版修复（随后证实不完整，保留该次状态）

规范轴独立探针发现四个有限权重 `1e308` 被正常接受，却使加权求和溢出成为NaN，JSON可能被误读为缺失null。作者永久回归另证实 `Number.MIN_VALUE` 的同等权重使小数60.25丢失精度、错舍入为60而非60.3；算术及协议反例均保存在 `extreme-weights-red.log` / `extreme-weights-both-scales-red.log`。原P2成立，不能以此前全绿覆盖。

首版修复保留普通权重的原公式与运算顺序；总和/乘积不可有限表示或总和进入IEEE-754 subnormal时，仅计算使用按最大权重同比缩放。回显仍为原权重，完整性先按原正权重判断，极小因子不能因归一化下溢被当作关闭而掩盖缺失。**19/19**目标检查通过（`extreme-weights-green.log`），包括巨大/极小权重、小数舍入、异比例、混合尺度缺失及协议结果。

`optracall-tradearea-score-1` 表示同一四因子业务数学合同，非源码/全输入行为指纹；本候选尚未正式交付，保持公式版本，以最终源码提交与候选摘要区分数值实现修正。默认数据算法不变，须复核原2835及多权重逐值结果；不声称原实现和修复对极端输入等价。未因此重导或覆盖已保存数据。原型评分参数的 `pop3km` 误例同步改为实际合同 `pop`（静态示意，不影响已确认交互）。


### P2 后续反例与完整修正

规格轴进一步发现首版仅检测总和subnormal不足：四因子均0.05、各权重1e-308，总权重normal但乘积subnormal，原返回0而同比权重1应为0.1；0.25也有错误舍入。首版19项GREEN没有覆盖此反例，P2当时仍未闭合。追加永久回归的因果失败保存在 `proportional-rounding-red.log`。

最终改为**所有计算先按最大正权重同比归一化**，不保留不充分的极端值特判；原正权重的缺失判断仍先执行，结果回显原值。四因子公式、权重默认值及一位小数规则不变，但不再声称保持原运算顺序。20/20目标测试通过（`proportional-rounding-green.log`），独立原数据多权重oracle与完整回归另记后续结论。

另保留一次验收假设错误：作者将C01“零售额修正案例”私有映射擅自窄化为“未公开”，规格轴对照发现固定来源并非该假设。现恢复“原修正口径及上下文保全”，没有修改源数据或伪造预期数值；旧map及探针失败保留，不能算产品因果RED。C01/C02具体核对由复核者按固定来源独立判断。

v4作者全量检查 `full-check-final-numeric.log` 返回1（931项927通过/1失败/3跳过）：失败为既有需求会话“throwing callback drains”对合成Provider关闭回执的即时断言。此前两次全量及规格轴隔离全量该项通过；目前单独诊断实际资源停止与关闭事件时序，不以绿色重跑或猜测取消该失败。


### 第二项 P2：实际 MCP 协议精确键校验

规格轴/规范轴分别用实际 MCP Client 发现 Zod object 默认 strip 会使 weights/range 多余键被静默去掉，从而绕过实现的精确键合同；部分 weights 又在实现前只获纯文本 schema 错误。因果失败保存在 `protocol-precise-keys-red.log` 及两复核根的独立反例。

现对象 schema 保留额外键，顶级/weights/range 实现明确拒绝未知键；weights 四键完整性也由实现返回信封。SDK 仍负责基础类型/缺失必需顶级字段，不另写协议校验器，标准已写清该边界。**21/21**连接器测试通过（`protocol-precise-keys-green.log`），含真实 MCP 的5类额外/不完整键反例；待复核者同脚本重验。

### SM03 失败诊断与观测修正

工程辅助隔离诊断保留在 `/Users/bendandebaba/OptraCall-artifacts/sm03-drain-diagnosis-junfem_3/diagnosis.md`：16个自然实际SDK试验中1例复现，SDK turn与abandoned已cancelled、回调原Error身份保留、busy=false/仅1请求后，真实 `response.close` 晚 **0.116毫秒**自然到达，无额外stop/close催收。另1受控socket读暂停对照及全部自然试验最终都观察到真实socket销毁。仅等待abandoned不能保证另一事件源的回执同步到达。

只修合成Provider fixture：逐请求有界10秒真实close事件Promise，三个既有关闭断言先等待该receipt；原closedEarly、原错误身份、一次请求、busy及取消结果断言全保留，不用固定sleep、不改产品生命周期。首次受影响11项通过（`sm03-event-observation-green.log`），三处最终版本由后续全量/独立复验覆盖。原fullcheck失败和最初单项绿色均保留，后者不单独证明根因。

规格轴v5隔离全量另有既有SDK-04 startup UI的2秒等待失败（932项928通过/1失败/3跳过，未执行build），其余目标与数学复验通过。目前正以实际事件时序核对是否SDK装载超过该窗口，不能只凭负载推测或绿色重跑关闭。


### SDK-04 冷启动观测失败诊断与修正

工程辅助在隔离根 `/Users/bendandebaba/OptraCall-artifacts/sdk04-startup-diagnosis-f9tk89i2/` 用真实SDK/未加延迟的原扩展，在明确记录且有界的CPU竞争下复现 **8/8** 原2秒窗口超时，随后ui.request均在2092.9–2281.6毫秒自然到达，实际回答accepted、open随后完成、Provider请求0。代表时序中worker准备与SDK/扩展装载耗时约2秒，worker发送到Host转发仅0.23毫秒，未见问题丢失。另有普通启动与显式慢扩展对照；探针自身模板错误单独保留，非产品RED。

仅将该**startup**测试的观测窗口设为有界10秒，仍等待实际ui.request，保留question到时open未完成、回答accepted、随后open完成、Provider0四项原断言；通用默认2秒及产品代码均不改。没有固定sleep、忽略错误或取消断言。原v5全量失败保留；此诊断证明合法冷启动可越过旧窗口，不宣称已还原当次机器调度的每一细节。最终完整候选全量检查及两轴复核待下节签收。


## 最终本地签收（2026-11-03）

- 固定运行候选 **v7**（49项）全量 `npm run check` **exit0**：**933项、930 PASS、0 FAIL、3条件SKIP**；边界、tsc、构建通过。原日志 `full-check-candidate-v7.log`，check后逐文件49/49哈希保持（`post-fullcheck-v7-identity.json`）。环境Node25.9.0/npm11.12.1；既有大chunk构建提示保留。
- 3条SKIP为Darwin已支持保护时不适用的“不支持平台拒绝”反向项，以及2项真实soffice页图渲染条件项；不把它们表述为已运行通过或PPT视觉验收。
- [非作者独立复核](independent-review.md)两轴在本次范围通过，无开放阻断发现。规格轴独立原model对照 **2835×8=22680**、缺失组合512均0差异，8极端＋30近normal矩阵通过，协议9类反例与C01/C02固定原上下文通过。规范轴独立目标/兼容/协议/生命周期与IN06实际缺口复核通过，工程§4 Host–Agent职责边界与SDK复用专项通过；各自命令、版本范围与局限按原文保留。
- README P3已补清：启用因子缺失或全权重0均可无分，不等于低分；既有数学黄金已覆盖，无运行时修改。全文去标识、静态原型合成披露、明确data.location及参数文案问题均闭合，原文私有留存。最终文档收尾仅修改README/spec/result并原文加入独立报告，运行源码与测试仍为上述v7。
- TA01/TA06的实际SDK路径、TA02–TA05确定性与真实导入、TA07浏览器四场景、TA08当前公开候选内容、TA09标准一致性、TA10本地回归均在上述证据范围通过。TA08随未来实际暂存再核；未审全部远端历史，不宣称Git历史秘密审计。

原候选20/20身份、后续v1清单枚举错误、两个P2及首修不足、SM03/SDK04全量失败、作者/复核夹具错误、跳过与未验项全部保留。原日志、正式数据与私有映射位于仓外授权证据根，不把业务资料放入公开仓，也不以单项绿色替代因果诊断。

**下一步必须先取得用户Git/CI授权**：集成最新main并重验受影响部分、提交/push、单PR及实际head CI；squash合并仍等用户确认，随后安全快进main与OpenSpec归档。当前改动未提交/未推送，主仓main仍干净停在7109a6e；未切换原服务，真实模型调用0、本轮MacBook操作0。正式2835条只导入指定本机dataRoot，浏览器/端到端使用合成数据；不宣称运行采用、专业质量或用户产品验收。天气、后续来源版本、真实模型及设备更新仍各自另授权。


## Git/CI 交付启动授权（2026-11-03）

用户已明确授权：“按流程完成Git/CI，CI通过后直接squash合并，再快进本地main并完成OpenSpec归档。”本授权取代此前等待Git/CI与再次询问合并的阶段性状态；不扩大真实模型、MacBook、运行服务或天气边界。

再次fetch后 `origin/main` 仍为 `7109a6e63660a900b557300a73765f852c2cbd00`，`origin/qoder/data-mcps` 为移交HEAD `6633353dc1b01524a4c3e3b5c9a2f4cc03a7f58a`。固定v8的50项SHA均一致；`git merge --ff-only origin/main` 返回Already up to date，没有源码/测试/依赖基线增量，不重复已通过的933项检查。两轴最终文档窄核均已通过，回执分别位于两独立证据根 `final-doc-review.md`。

当前准备提交、push及唯一PR，随后检查实际head的hosted CI；未把本地检查当CI。若head/base变化或CI失败，保留证据、修复并重验受影响部分后再合并。

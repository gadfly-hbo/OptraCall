# Pi SDK 接入风险整改方案 v0.2

2026-11-06 · **用户已确认v0.2，本地工程验证完成；后续已授权Git／CI交付，运行采用未授权**。原批准字节在`.local/pi-sdk-adaptation-repair/implementation/before/openspec/changes/pi-sdk-adaptation-repair/spec.md`保留；产品需求范围不扩。当前事实见[实施记录](implementation.md)、[结果](result.md)及[Git／CI记录](delivery.md)，准备／改前评估、实施与交付分别记录。依据[风险核对](../pi-sdk-governance/result.md)及[工程规范](../../../docs/engineering-workflow.md#官方-pi-sdk-来源与版本约束)。

v0.2根据[改前四原则与稳定性评估](stability-and-principles.md)收窄v0.1：R1严格保留原启用条件和失败域；R3先补兼容证据，无已证实差额不改传输代码；R4只做合成兼容／保全验证、只读工程诊断和最小工程检查，不在本包加入正式旧历史拒开策略。v0.1原文及原准备复核保存在`.local/pi-sdk-adaptation-repair/assessment/before/`及既有报告，原准备PASS不等于稳定性PASS或实施授权。

基线 `main@4298db98e879cff0a73f7a131d633e2cc48d7667`；开工已有上一轮规则文档WIP完整保留，身份见 `.local/pi-sdk-adaptation-repair/before.json`（941份源码／文档；不包含业务根或原生历史）。SDK固定官方1.4.0；Interface v3、原业务owner/profile、项目元数据schema2及原生JSONL版本3分别维持，不混称为同一版本。Codex负责SDK／Host接缝及集成，Qoder按既有分工配合Extension；不自动转移分支写入归属。

## 共同边界与执行次序

先做R1隔离合成可行性切片，公开接缝、动态来源和调用资格等价成立后才撤旧改写、完成受影响回归；随后分别处理R2及R3的兼容证据，R4的合成保全验证从R1起贯穿。各项独立报告，不能一项通过就称整包稳定。所有改动限OptraCall自有代码、相应测试和文档。正常v3会话零新增必做操作是验收目标，尚未实测；本包不设计产品布局／导航变化，UI Demo当前不适用。旧历史续聊策略调整已拆出；若实施仍需改变用户可见能力或操作，先说明实际差异，按工程规范核定规格／Demo，不以内部整改名义悄然改变。

SDK不升级、不降级、不改官方包／原型／内部对象／模块缓存，不用私有fork或补丁。全程保留现有项目、会话、原件和已有FAIL／UNKNOWN；工程验证使用隔离合成Provider、合成MCP与合成历史。确认前未运行SDK／Host；现已获准按本包本地实现、隔离SDK／合成Host工程验证和非作者复核。仍不读真实业务或凭据、不调用真实Provider、不切换服务、不操作MacBook、不做Git写入／CI。真实Provider、Git交付、合并及运行服务／其他设备采用按实际单独授权核定，不从本包推导。

### 确认后的允许修改路径

R1为`src/agent/project-session.ts`及必要的`src/agent/`自有工具上下文适配模块；R2为`src/agent/sdk.ts`及其调用处；R3先补证据，仅出现可重复的不兼容差额时才调整`scripts/http-transport.mjs`的公开环境适配。R4限合成历史fixture／测试、只读工程诊断、`scripts/check-agent-session-boundary.mjs`及必要SDK治理检查脚本，不改变正式历史的读取／打开／迁移策略。对应`tests/`、接入说明／工程规范和本变更记录同步维护。`package.json`仅可接入必要check命令；依赖版本、overrides和锁文件保持本包指定值，不增加验证框架或依赖。无关产品功能、SDK安装目录、其他工作树与业务根不作为代码修改目标。

## R1 优先：撤除运行时原位改写，保留调用资格保护

### 问题及不可降低的结果

`src/agent/project-session.ts:71–102`的`bindPersonalToolContexts`在SDK登记完成后改写原definition.execute，并在bindSession及tool_execution_start重复补绑。它为个人资料、Case／经验／语义、source-reader等Host能力阻止旧ctx或迟到操作跨调用使用。不能直接删除这段保护，也不能只检查“当前有run／signal未取消／ID看起来相同”。同一会话、重复ID及显式换新signal的既有回归已指出这类替代不充分。

验收结果必须同时成立：官方包和SDK原始定义不被OptraCall改写；当前合法直接／嵌套调用继续可用；工具调用结束、取消、关闭、换请求／owner或fork／恢复后，旧资格不能读取、保存或把迟到正文写入新会话。

### 首选技术路线：在交付给SDK前创建Host自有包装副本

1. **保持Pi执行权。** 继续使用原`createAgentSessionServices`／`createAgentSessionFromServices`／`createAgentSessionRuntime`与公共会话入口；不另造工具执行循环、调度器或会话库。
   **保持原启用范围。** 适配器的装配资格必须严格等价于原`bindPersonalToolContexts`条件：个人资料／Case／经验／语义任一启用，或`workspace.capabilityPolicy==='source-reader' && sapMethodSourcesEnabled`；普通workspace仍排除，source-reader保留原例外；protectedExecution排除且必须有projectId／taskId。不把全部workspace一律排除，也不把读取视图无条件挂到所有会话。原不满足条件的会话不装新适配；子Agent及其他受管／封闭profile沿原工具合同，不扩大能力。
2. **Host产品工具。** 在现有`customTools`传入公开工厂前构造新ToolDefinition及执行包装，原定义保持不变。包装只处理调用资格与结果交付，不改参数、分析方法或业务结果。
3. **codemode、用户扩展及MCP工具。** 优先验证1.4.0公开`DefaultResourceLoaderOptions.extensionsOverride`／`ResourceLoader`及公开`Extension`／`RegisteredTool`／`ToolDefinition`类型：提供OptraCall自有Extension记录和工具映射视图，读取时返回自有定义副本，原SDK／扩展记录、注册Map及原execute不被Host写入。SDK仍经自身公开注册机制维护动态工具，不另存一份工具权威。
4. **保留动态语义。** 先列清1.4.0真实消费面，验证get、has、values、entries、keys、iterator、forEach及size等实际读取行为，以及后续注册、hidden重注册／服务注销与重新启用；不把读视图承诺成任意可变Map的通用替代。注册权威仍是SDK原Map，Host不实现第二注册表，也不经视图转写SDK内部Map。若实际使用要求无法等价保留的set／delete／clear等写入或其他行为，候选可行性不通过，不能靠扩大适配或私有表补齐。
   不能只复制首次快照，或缓存掩盖合法更新。保留完整定义、属性描述符及实际receiver语义，不能手工挑字段后遗漏promptSnippet、promptGuidelines、constrainedSampling、defaultActive等字段。核对参数准备、schema／outputSchema、exposure、namespace、annotations、reachesTools、prepareLoadout、renderers、executionMode、hooks、skills／角色发现、codemode／tool_search可达性及原冲突优先级。
   同一来源记录在一个加载代际内稳定投影；SDK公开加载流程会写返回Extension、commands和tools的sourceInfo，因此这些写入面须有独立且稳定的自有记录。晚注册仍捕获原Extension，不能简单沿用其初始synthetic来源：首次与晚注册记录都须反映其所属Extension已解析来源。逐项证明所有权／缓存更新，重注册、来源改变、reload及close释放旧代际，不回写原对象／原Map，不共享会被SDK写入的嵌套记录后宣称原件独立。原事件runtime／处理器继续复用。
5. **保留调用隔离。** 每次实际execute在自有包装中绑定当前run／session／manager／signal及本次调用存活标志，提供自有ctx副本；其executeTool先后核对资格，finally使该调用资格失效。资格不能由模型参数、toolCallId或调用者传入的新signal伪造；并行调用各自失效，不全局串行化，不建立跨owner队列。finally只撤销本调用保存ctx的资格，不能顺手abort SDK信号、关闭会话或停止其他合法嵌套／并行／后台资源；停止、取消、drain／close仍沿原公共生命周期。
   **保持失败域。** 个人资料／Case／经验／语义等可选能力原有的IO或来源失败继续作为对应工具错误回执，不提升为全局会话／普通分析启动前置，不强迫Agent先读取这些资源，也不新增context步骤／审批。调用资格失败仍明确拒绝该次交付，不能绕过资格、回退未包装工具、隐藏工具或让旧结果混入新请求。适配器必须准备完整后才交给SDK；不能用半装配状态继续运行。
6. **原生工具照常使用。** 官方read／write／edit／bash等现有实现不向用户代码交出可保存的JS工具ctx，保持原样。不能用同名customTools替换全部原生工具以图省事，否则会改变用户扩展覆盖顺序。凡可交出ctx的产品／执行扩展工具路径都必须证明覆盖。
7. **移除旧改写。** 只有上述正常／反向用例通过后，移除原bindPersonalToolContexts、对应WeakSet及事件中的补绑；不保留“失败就退回原位修改”的后门。调用资格只是原生命周期内的临时执行状态，不新增持久结构。

**可行性门槛：** 方案确认前仅通过1.4.0公开声明、官方文档和安装版调用链确认可用入口，当时尚无运行等价证明。实施须先用实际SDK及合成扩展／MCP验证Map视图、晚注册／移除、reload、fork和并行完整性；若公开接口不能等价保留所有既有能力与保护，停止候选并说明缺口及可选安排，不改SDK、不换版本、不静默关闭MCP／扩展或降低权限保护。不能把“有公开类型”当成可行性通过；本次确认后的实际通过证据见实施记录。

**复杂度与性能边界：** 自有投影只补原位改写不能合规完成的调用资格缺口，不重做SDK的工具发现／选择／刷新／执行。不得在每次工具调用或get中全表复制、全目录哈希、联网或再调用模型；使用轻量稳定缓存并按原资源生命周期释放。确认后用同规模合成工具比较原路径／候选在首次、晚注册、重注册和多轮reload的耗时及记录释放。当前性能与内存差额UNKNOWN；若需要新调度器、长期全局台账或大量补偿机制才能成立，停止候选并报告，而非为“合规”扩建Runtime。

### R1的必须回归

- 官方包文件及受控原definition.execute／描述符在装配、调用、reload、fork前后不被Host写入；SDK自身通过公开注册产生的合法变化另行核对，不误报为Host改写。
- 个人资料、Case读取／草案保存、经验跨Case来源、语义查询／来源保存、SAP source-reader直接及codemode嵌套路径；对照原启用谓词，普通无能力、普通workspace、受管／protected、fixed-draft、text-only等原排除路径不装新适配、不扩展工具合同；合法source-reader例外不误排除。可选IO失败只影响原工具回执，普通分析仍可使用原Python／bash，不新增必读或手工步骤。
- 已完成成功调用保存的旧ctx：同一run及下一run、同manager、重复toolCallId、替换新signal均不能越过原调用资格；在途取消／close／worker退出后迟到回执不能进入历史或新请求。
- 合法多层嵌套、并行、相同名称重注册、MCP首次／晚注册与下线（按官方hidden重注册核对，不预设有通用unregisterTool；unregisterMcpServer服务注销另验，不自行删除SDK注册Map）、原生工具、用户同名工具优先级、模型可见schema／元数据、reload及fork／switch／恢复照常工作。
- 复用`personal-context-runtime`、`case-decision-runtime`、`experience-learning-runtime`、`semantic-context-runtime`、`sap-method-extraction`／`sap-method-sessions`、`subagent-runtime`及相关原生扩展/MCP回归；按实际差额补因果RED，不删除原反向断言。

## R2：收窄MCP内部接口耦合，保留固定只读例外

1.4.0公开导出LoadedMcpConfig类型，未导出loadMcpConfig函数。当前内部函数还承担“用户同namespace不能覆盖可信产品连接器或绕过任务开关启动”的配置筛选，不能直接改回默认createMcpExtension并丢失保护。

整改限定为：继续在唯一SDK入口复用原解析器；先核官方VERSION=1.4.0，再按固定字面量路径惰性导入、核对函数并给明确兼容错误，避免OptraCall自己的顶层内部路径导入先于检查失败。不复制第二份MCP parser、不增加任意路径加载器或扩大公共入口白名单，不隐藏实际MCP失败。全部非fixed／非protected普通打开目前都会请求该loader，官方公开入口本身也静态依赖内部MCP配置；因此这里只改善OptraCall自有导入顺序，不能保证SDK文件缺失时Host／历史页或无MCP会话仍能启动，也不扩大为容错机制。正常安装的加载／取消／错误策略保持；失败沿原公共生命周期拒绝本次打开，仅在确认无残留或实际清理成功后释放opening占用。资源／worker清理失败或UNKNOWN时，保留原owner隔离及busy／UNKNOWN，仅按原资格显式close重试，不重放请求、不强行转idle，不以空MCP配置或半开资源静默继续。本包不另改公共生命周期策略。

保留IN06例外，记录owner Codex、固定版本／安装布局、缺公开能力证据和退出条件；未来用户指定版本有公开loader时优先退出例外。验收普通用户MCP、可信产品server、保留名称及下划线归一化碰撞不启动、任务开关、受管／封闭拒绝、错误与取消，以及清理成功／失败／UNKNOWN的原owner状态合同；本项只能结论为“固定依赖受控且失败明确”，不能写成内部接口已全部消除。

## R3：保持联网依赖组合，补实际兼容证据

保持SDK1.4.0及undici8.12.2，不盲目取消override或退回8.10.2；覆盖曾有安全修复依据，旧审计不当成当前实时漏洞结论。网络仍使用公开dispatcher／install和既有SDK模型路径，Host不另加重试循环或放宽TLS。

在隔离本地Provider／MCP及受控TLS环境验证：协议请求／流式响应、长响应／心跳、连接与idle超时、取消、断连、官方有限重试、fetch全局与dispatcher一致性、MCP HTTP及脱敏；先复用`model-http-environment.test.ts`并只补覆盖缺口，无可重复不兼容就只登记证据、不动传输代码。有实际差额才在OptraCall自有网络适配层最小修复，不顺带重写超时／重试／诊断；确需调整依赖版本或产品策略时先列证据与差异交用户决定。本轮不宣称已完成当前或未来版本兼容验证，隔离通过也不替代真实Provider或长期运行证据；无代码改动的证据项不伪造TDD RED。

## R4：合成历史保全验证与最小工程门禁；正式旧格式策略拆出

### 原件保护

1. 实施前只读核定目标代码／安装、数据根、会话归属及活动资源，保留已有WIP与失败。正式项目和历史只做获准清单／摘要核对，工程测试全部使用独立合成根；不复用或改写运行服务的依赖／数据目录。
2. 当前只读投影复用`native-session-snapshot.ts`，只读工程诊断不调用`SessionManager.open()`做探针，不扩大该投影现有用途／产品规则。SDK1.4.0的_loadEntries会对部分旧header迁移并重写；本包不通过增加正式拒开策略修复它，也不让工程测试碰正式原件。只在隔离合成旧格式副本核实SDK实际行为；不能据此声称正式历史自动迁移风险已经消除。
3. 合成当前v3会话验证空会话首落盘／首次追加、明确续聊、fork／branch父引用、重启恢复、取消中断和只读失败：失败无写入，正常续聊仅允许真实SDK合法追加，旧前缀、header／UUID／指针及无关文件按适用契约核对。不搬动／重编号项目、会话或父引用，不改schema；异常不恢复旧备份覆盖新成果。

### 尚未解决的正式历史策略及采用前提

v0.1的“所有正式打开先识别并拒绝需迁移旧格式”会改变原可续聊的行为，现从本包拆出，不视为用户已接受的可用性取舍。现有服务的旧格式自动迁移风险仍保留；本包工程完成不代表这项风险修复。未来若拟改变续聊／迁移策略，另明确用户目标、操作差额、原件／副本及归属处理，覆盖首开、原生命令switch／fork和实际暴露的导入／恢复路径，再由用户决定；不能只在project-session首开加检查便声称全覆盖。

候选工程验证不读取或打开正式历史。未来另获授权运行采用前，必须对获准目标只读核定格式兼容、归属与原件保全；不能用open试探。目标格式未知、需要迁移或原字节保护无法成立且尚无用户决定时，该目标不采用候选，仍不改原服务；不能因本包保留原策略就放行未知原件并宣称全部保全。历史策略的剩余风险与新候选是否采用分别报告。

### 工程门禁

在原统一接入检查上补小范围自动校验：SDK精确1.4.0、官方锁文件来源／SRI及实际解析版本、已知改包脚本／私有替代、SDK返回definition的execute改写等已知形式；负例使用合成源码或合成材料，不改真实官方包。授权核验仍依据原用户指令／spec，不能由自填approved:true代替；AST检查不能宣称拦住全部动态绕过，仍需非作者调用链复核。

官方包逐文件核验放在工程／交付检查，使用固定官方归档及其完整性，不让每次产品启动联网下载或增加日常用户操作。业务元数据schema2、Interface v3及native JSONL版本3各自验证，不引入全局版本迁移平台。

## 确认后工程验收与交付边界

按连续SDD/TDD逐切片保留真实RED／GREEN；全量适用`npm run check`、依赖审计、实际未改SDK的隔离Host／合成Provider／MCP／工具／保存恢复链路及全新非作者和四原则复核。四项分别报告通过／失败／待验证；关键取消、越权或原件保全未过时不标整改完成，也不进入运行采用。

回退只作用于隔离的OptraCall候选；SDK仍1.4.0，不重置／降级官方包，不用旧数据备份覆盖新增内容。R1未能保住等价保护则保留失败并停止，不删除旧保护后称合规；当前正式运行服务保持原位，旧风险不因未切换消失。Git／CI、合并、设备更新及运行采用分别按实际授权执行，不用本次方案确认代替产品验收。

## 供整体确认的四个决定

| 决定 | 推荐方案 |
| --- | --- |
| D01 优先项 | 仅原启用范围先做R1隔离可行性，再做等价候选；SDK仍为唯一工具／生命周期权威，可选错误不升级为全局前置；不成立就停止报告 |
| D02 MCP | 1.4.0保留有记录的只读内部例外，改先版本检查／惰性加载及明确错误，不另造parser |
| D03 联网 | SDK1.4.0＋undici8.12.2均保持；先补兼容证据，无可重复差额不改网络代码；不借机升级／降级 |
| D04 保全／门禁 | 本包仅合成兼容／保全验证、只读工程诊断及最小工程检查；正式旧历史拒开／迁移策略拆出另定，旧风险不冒充已修复，运行采用另核目标兼容 |

上述为用户已批准的v0.2需求合同，实际完成度按实施与结果证据核定，不因获准实施就成为验证通过。不为同一已确认事项反复请求许可；公开接口可行性失败、需改变现有能力／权限／结构或新增版本／运行采用时，只提交实际变化供决定。

## 官方与本地依据

- [固定1.4.0资源加载接口](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/resource-loader.ts)、[固定1.4.0扩展文档](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md)；安装包已在前轮与官方归档比对，避免引用latest推断1.4能力。
- 安装版公开声明：`dist/core/resource-loader.d.ts:89`、`dist/core/extensions/types.d.ts:1720–1749`；执行读取链：`dist/core/extensions/runner.js:411–421`；内部getter证据：`dist/core/agent-session.js:1110–1111`。
- 确认前本项目`src/agent/project-session.ts`、`src/agent/sdk.ts`、`scripts/http-transport.mjs`及上述既有测试仅只读检查；确认后新增的实施与隔离工程验证见[实施记录](implementation.md)，不追溯覆盖原准备状态。

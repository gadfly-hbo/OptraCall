# Agent会话接入说明

当前工程增量适用Interface v3，兼容原v1/v2业务调用子集。强制接入规则的唯一来源是[工程规范IN01–IN07](engineering-workflow.md)；本说明提供类型定位、使用方法及验证入口，不维护另一套规则。准确字段和返回类型以[src/host/agent-sessions.ts](../src/host/agent-sessions.ts)导出的`AGENT_SESSION_INTERFACE_VERSION`、`AgentSessionPort`、`SessionProfile`等为准。下文历史v1接入保留其当时事实，不代表自动核算整包或产品验收已完成。

## 开始接入前

在当前变更规格中记录：工程规范版本、Interface版本、真实owner、Host注册位置/profile、允许修改路径、模型/工具/历史策略与验收。遇到新能力时先核对现有Interface是否表达得了，按IN06补齐适配与验收；有实质业务差异的部分留在业务模块。

实际参考入口：

- [项目任务Host接线](../src/host/server.ts)：任务绑定配置、历史/草稿、202及后台完成投影。
- [需求梳理Host适配器](../src/host/requirement-sessions.ts)：当前配置捕获、独立workspace、生成及一次修正的会话占用。
- [公共接口与实现](../src/host/agent-sessions.ts)：启动、占用、配置身份、取消/关闭及代际保护。
- [公共行为及第三合成消费者测试](../tests/agent-sessions.test.ts)：通过同一实现接入不同profile，验证状态/事件/取消的隔离。测试消费者不代表新增产品插件。

## 接入关系与类型

Host静态注册profile，用`createAgentSessionDomain(options)`创建独立域实例；项目域和需求域共用代码，各自持有owner的运行资源。Host持域管理引用，业务只获得`AgentSessionPort<Owner>`及Host核验后产生的`SessionRef<Owner>`。当前`AgentSessionPort`排除`name`、`ref`、`closeAll`、`busyInScope`、`execution`、`owns`、`registerFresh`和`executionState`；现有业务入口也可以继续注入更窄的业务facade，如需求的`run/withSession/stop`。

| 类型 | 用途 |
| --- | --- |
| `SessionRef<Owner>` | 不透明的内存调用资格，绑定域和owner；不表示worker已经启动，不是新的持久会话ID |
| `SessionTurn` | 实际一轮请求的`text`、`requestId`及可选`kind`、`requestFingerprint`；沿用任务内请求关联 |
| `SessionRun<Owner>` | 单turn句柄，包含`accepted`、`completion`和操作`context` |
| `SessionLease<Owner>` | 一个获准业务操作内的临时使用权，提供`run/start`与操作`context`；v2增加`quiesce/reopen/onCancel`，不增加平行运行权威 |
| `SessionExecution<Owner>` | v2由Host为当前原owner/operation生成的不透明执行资格，不是持久会话ID或客户端可传的配置对象 |
| `SessionContext<Owner>` | Host提供的owner、可用requestId及`isCurrent()`；用于业务写入前核对归属和代际，不由业务自填generation |
| `AgentSessionDomain<Owner>` | Host管理表面，另有注册Ref及按范围关闭能力；不传给Extension |

TypeScript类型本身不构成安全隔离。Host仍负责封闭注册、验证真实业务归属和授权；调用方拿到合法Ref也不能扩大数据、工具或经营动作权限。域与owner隔离是同进程逻辑隔离，不是进程隔离或敏感数据沙箱。

PPT接线修复为Host增加同一公共域上的只读`busyInScope({projectId?,provider?})`查询：直接投影原slot、operation、opening、resource及retirement状态，覆盖准备、阶段间和收尾，不创建资源或第二份状态台账。它与`closeAll`一样只留在Host管理表面，排除于业务`AgentSessionPort`；业务调用子集及Interface v3不变。真实项目owner仍由Host验证，不能从客户端路径自造；检查覆盖匹配／不匹配范围、取消后的实际收尾和第三合成消费者。

## 最小业务调用

下面是获得Host注入后的一次调用。它不构造SDK或会话管理器，不决定凭据、绝对路径或Provider。调用方仍按自己的HTTP/业务协议展示结果。

```ts
import type { AgentSessionPort, SessionRef, SessionTurn } from '../host/agent-sessions.ts';

async function runFeature(
  port: AgentSessionPort<string>,
  ref: SessionRef<string>,
  turn: SessionTurn,
) {
  const run = port.start(ref, turn);
  await run.accepted;
  return await run.completion;
}
```

导入相对路径按接入文件位置调整。对于项目消息，`accepted`之后仍按原协议返回202，由后台`completion`更新业务结果；对于需求生成，业务入口继续等到结果返回。`accepted`表示原生请求回执可读，不能拿它代替计算完成或供应商结算。

多turn用`withSession(ref, async lease => { ... })`。每次`await lease.run(turn)`等待该turn终态，业务自己决定是否进行下一轮；需求的有限格式修正只是需求业务策略。整个回调期间保持同一个捕获配置及操作占用，turn之间仍busy。一个lease最多一轮在途调用；回调结束后lease失效。漏await、抛错、取消或外泄lease按公共实现收尾，业务不能另建运行台账补救。

## Interface v2：受控执行环境与子操作停止

用户已整体确认[自动核算九项结构合同](../openspec/changes/automatic-verification-revision/structure-decisions.md)。v2仅补资源权限和同链生命周期，原`SessionTurn`、模型配置快照、普通`start/run/withSession`及v1消费者调用方式保留；不创建新的Agent Runtime、分析步骤或专业放行门。

**初始v2候选的阻断保留：** 切换前普通worker的脱组后代无法证实收尾，因此当时公开capability拒绝开启，见[旧候选实施结果](../openspec/changes/automatic-verification-revision/implementation-result.md)。用户随后确认生命周期补充A；当前v3只为从可信创建起点开始受管的新任务增加准入，不把旧资源升级。补充候选按实际检查和非作者复核证据判断，不能以接口存在宣称完成验收；当前分层结果见[生命周期补齐记录](../openspec/changes/automatic-verification-revision/lifecycle-supplement-result.md)。

| 能力 | 准确含义 |
| --- | --- |
| Host `domain.execution(ref, plan)` | 只为当前已占用operation创建不透明资格，冻结Host构造的保护scope；scope不能来自业务JSON中的任意目录、会话或凭据 |
| Host `domain.owns(ref, context)` | 以运行时WeakMap证明当前context属于同域、同owner及有效lease；复制字段或JSON不能伪造；用于绑定自动核算子操作资格，不是普遍跳过busy |
| `lease.quiesce()` | 在原占用内先drain受管计算，再确认实际关闭；存在在途turn/opening时拒绝，不派发模型、不释放lease。v3拒绝unmanaged或曾经unmanaged的资源，不把driver退出当作其后代收尾证明 |
| `lease.reopen(execution)` | 校验资格属于本operation后先quiesce，再经同一公共入口重开受控资源；跨域、跨owner、旧lease或JSON资格均拒绝，不能在现worker上临时更改策略再finally恢复 |
| `lease.onCancel(handler)` | 注册绑定子资源的幂等停止动作，返回移除函数；父操作先撤下一步派发资格，再等待实际子停止。handler不得依赖调用方已持有的Host mutate门闩，避免配置关闭时互相等待 |

资格创建、owner证明与跨域管理留在Host，不向Extension暴露完整domain。自动链的Host适配器仍负责核对原任务canonical会话、原配置、固定材料和实际请求；公共层不按业务名判断是否该核算、接受哪条意见或怎样计算。

可信SDK驱动只处理模型、原生会话与产品可信代码，原native由SDK唯一写入。Agent控制的文件写/edit、bash/Python、codemode及间接工具必须委派给同一受限执行进程；执行器不是另一位Agent，没有模型会话，不能读取/写入native、Host凭据或管理材料，也不能把IPC结果升级成驱动事件。原始工具名称/参数/结果和Agent方法选择保持。不可安全委派的扩展或已有/远程MCP明确不可用，不回落到可信驱动执行；普通分析原工具策略和旧fixed-draft合同保持。

SDK驱动仍走原Provider/模型/线路，不引入Provider relay、会话执行副本或Host字节尾搬运。保护scope只安排可读资源、新计算目录和新稿写位置，不提供经营计算或统计方法。Mac权限能力不支持、旧资源无法确认关闭或来源变化时，停止自动派发并保留未知；不能用无工具文本出稿冒充主Agent重算。

`stop`/匹配范围`closeAll`只处理对应operation的子停止，不等待无关Provider/owner。阶段间无父turn在途时，仍须等已启动的子停止结束后才释放占用；失败的子停止保持原operation隔离准入，后续显式close仅重试失败动作，成功后才恢复可用。迟到回执只能补真实技术事实，不能复活下一轮派发。

公共增量验收覆盖原v1各消费者、第三合成消费者、受控重开/原canonical、取消间隙、关闭失败/重试、配置变化、跨owner、过期资格、晚到结果及原生接入静态约束。当前实现和未完成项见[实施记录](../openspec/changes/automatic-verification-revision/implementation.md)；单元检查不是原件全面保护或模型专业收益证明。

自动链Store的公开文件读写在同一实例内共用短暂文件系统一致性锁，覆盖原子发布、读取及CAS，防止读取看见发布中的临时硬链接或半份记录。锁只等待该Store的文件操作，不包含模型请求、Agent工具、会话lease或整条自动链，也不决定Agent派发顺序；运行占用仍由公共会话层管理，不构成全局Agent运行队列。

## Interface v3：首次执行托管与可信起点

v3的权限变化以[用户已确认补充](../openspec/changes/automatic-verification-revision/lifecycle-supplement-proposal.md)为依据，不扩大为全产品沙箱。Host-only `registerFresh(ref)`仅在实际创建新业务owner时调用；GET、旧列表、恢复、重启或重放不调用。`executionState(ref)`从同一公共slot读取实际资源、未托管历史和当前Host可信创建资格，不另建运行状态Map；这两项不暴露给业务port。SDK的原生opened/closed记录由可信驱动写入和fsync，但单独的JSONL标记不能给旧任务授予资格。

`SessionProfile.executionMode(owner)`可异步选择当前允许的unmanaged/ordinary/protected环境；`agentOptions`的第三参数只接收Host绑定本operation的执行计划。公共层按实际构造参数记录资源模式，并在复用前比较模式；开关变化不能把旧unmanaged资源静默换成“已证明收尾”。原v1消费者不提供新hook时仍走原接入方式。

`SessionRuntime.drain()`封闭本scope的新工具派发并等待后台计算自然结束；既不调用模型，也不按时长、费用或工具次数终止分析。普通自动任务的Python/bash、并行与后台计算可跨工具结果继续，工具cwd为项目020，允许写020/060；同链核算和返修只写自己的新工作区。公共层在正常交接及操作结束时drain，再close核定收尾；显式stop可打断等待并强制收回本owner资源，收尾失败保持busy/UNKNOWN，只能显式重试清理，不能重放模型。

实际工具执行由无模型的受管进程负责。macOS权限禁止脱组、间接外部执行及访问native/凭据；可信guardian持有未reap的PGID leader身份，正常drain不发信号，close在身份保留期间回收，最终确认组消失才ACK。普通任务的已有010软提示保留，未开启自动功能的任务不套用本scope。受管模式内既有/远程MCP及用户执行扩展目前不可用，技能仅复制可安全读取的材料；不是宣称所有原生扩展原样可用，也不是分析方法限制。

同项目另一条旧任务、未托管任务或手动执行核算的资源无法核定时，自动准入/交接保守拒绝，不替其他owner停止计算。当前可信起点保存在本Host公共生命周期内：重启后旧任务及未知fork不自动恢复自动资格，保留记录和文件，关闭自动设置后仍可普通分析。选中未运行的新任务只读加载，不提前open worker；保存设置和GET不会触发模型。

公共v3的清理结果由原Resource上的单一retirement持有：失败Promise不会因自动finally、quiesce或父子回调再次执行而重试。`close(ref, { retryFailed: false })`用于自动收尾，缺省的显式close保持原重试语义；`onCancel`收到公共层产生的`{ retryFailed }`，初始取消为false，用户显式close重试失败子动作才为true。业务透传该资格，不从HTTP JSON或专业意见自造；自动finally不能借一次普通close调用暗获重试许可。成功清理与操作结果UNKNOWN分开，清理后的历史UNKNOWN不改写成运行成功。

本地托管优化沿同一 v3 实施：同 immutable scope 按需复用原 SDK read/write/edit/ls；bash/codemode/grep/find 保留一次性独立组，只有自然退出且完整核清后才提前收集。read/ls 取消后的异步尾部与图片线程仍属本 scope；正常 release 不 abort，公共 stop 才强收本 owner 全部组。自然收集失败也算既有 retirement 失败，公共 `retryFailed` 资格由 Resource 沿可信 SDK driver 下传，自动 finally 不能把首次 driver close 变成失败重试。整个 scope 的全部资源闭合才写原 native closed；技术工具结果丢失即使资源收净也保留失败／UNKNOWN，不能让模型最终文本补造成功。具体范围及验收见[优化规格](../openspec/changes/managed-execution-optimization/spec.md)。

以上只证明环境与技术交接，不能证明Agent已读或采纳意见，更不能证明核算正确。完整初稿、核算意见、新稿与逐稿复查仍按自动链业务记录保存；Host不计算经营数值、不按意见内容选择后续动作。

## profile与业务策略

`SessionProfile<Owner>`只提供现有差异：`key`、可选真实`projectId`、`configuration`、`agentOptions`、可选`admit`和能力声明`capabilities`。`configuration`同步选择配置；公共实现捕获完整快照，并在打开和后续派发前核对。`agentOptions`只交出已有获准原生参数，生产路径由公共实现创建`ProjectAgent`。

企业资料与决策看板联合接入继续使用 Interface v1。普通任务提供授权公共目录及可选材料，不改变其工具或分析方式；决策抽取在既有独立 owner/profile 声明非持久 `text-only` 能力，复用封闭文本资源路径而不加载执行扩展／技能／MCP／祖先上下文，也不续接历史或开放命令。它保留原报告 20,000 码点的显式截断合同，包装后的技术传输上限为 65,536 UTF-16；原 `fixed-draft` 的完整输入仍限 20,000。两种封闭文本能力与普通分析的差异不写入额外业务队列，实施证据见[企业资料交付记录](../openspec/changes/enterprise-business-context/delivery.md)。

反馈闭环A沿同一Interface v1，在普通任务请求／`ProvidedContextInput`增加可选feedback材料及回执，owner/profile不变。实际选材参与原request fingerprint；原生`optracall.run`保留当时提供的正文／片段／引用身份，缺字段的旧JSONL保持未知、不回填。只有实际native提供记录可确认delivery，HTTP202不证明已读／采用；普通工具与分析策略不变。原生回复的UI投影只追加实际session／entry身份，创建需求时Host回读并核预览全文SHA，不以列表位置或客户端正文冒充来源。业务意图／Case选择／部分成功留在feature及原Store，公共生命周期不接管。验收与限制见[反馈闭环实施记录](../openspec/changes/decision-feedback-loop/implementation.md)。

B/C继续沿原`independent-verification`和`verification-author-draft`，不改Interface v1或`SessionTurn.providedContext`。材料片段说明保存在本次实际用户请求正文中，由旧record的request/native及原events作只读投影；缺旧证据保持未知。临时ETag／If-Match留在核算业务HTTP适配器，不入selection或持久会话结构，已有意图优先只读回执。固定全文下载只读本owner固定副本，不open会话。Host不以引用数、读取事件、特定产物或专业评分驱动运行；两次材料交付不限制Pi在各turn内的自主分析。具体来源、限额与验收见[本期实施记录](../openspec/changes/analysis-verification-reliability/implementation.md)。

Host提供`configurationSnapshot`、原有`mutate`、`isClosing`与事件`publish`。测试中的`createAgent`用于受控替换传输，不是Extension自行创建Runtime的接入口。业务校验、文件保存、RAP/SAP/Case解析、lastRun/草稿、发布及结果解释留在原业务适配器。

| 策略 | 项目任务 | 需求梳理 |
| --- | --- | --- |
| owner | 原projectId+taskId | 原需求instanceId，独立feature命名空间；选中的目标项目不改变其会话归属 |
| 模型 | 任务绑定configuration id/revision | operation开始时选中的配置，生成与修正期间固定；下一次operation再采用当前选择 |
| 历史 | 保存的sessionFile、draft及原生父链；原生命令/fork继续更新指针 | 进程内同配置可复用；重建沿用原新建native路径，不自动扫描历史续接 |
| 环境 | 项目三目录、020工作区、现有工具、010软约束和060报告位置 | 原需求独立workspace、需求提示词和空defaultTools |
| 业务 | 项目/任务、归档、lastRun、请求回执、Case/RAP/SAP | 澄清、假设、框架、source指纹、提案采纳、确认/发布及一次格式修正 |

## 状态、事件与关闭

| 调用 | 说明 |
| --- | --- |
| `read/subscribe` | 读取当前资源状态或订阅自身事件；不新建worker、不发模型或重放。原任务历史读取和native证据校正继续在业务读取适配器中完成 |
| `open` | 显式初始化原生环境，不自动发送业务消息；原生启动UI仍由声明能力的入口处理 |
| `start/withSession` | 从准入开始占用，覆盖既有Host门闩等待、opening、UI等待及多turn间隙；同owner竞争拒绝，不增加全局队列 |
| `busy/live` | 分别表示运行占用/可用原生资源；不能把worker存在当成业务完成，也不能只看底层agent.busy决定归档 |
| `stop` | 取消本owner的当前操作和后续派发资格；在途安全收尾前仍占用，不停止其他owner |
| `close` | 释放本owner资源，不删除业务资料或原生历史；旧代际收尾不能移除新资源 |
| `respondUI/setEditorState` | 只有声明对应能力时委派原生交互；回答已有启动问题不重新申请运行占用，过期回答明确拒绝 |

事件附带Host产生的context。运行结果/lastRun等使用操作context及原requestId；无请求ID的启动或空闲editor事件使用资源context，不编造请求ID。业务写入在原Host `mutate`回调内先核对`context.isCurrent()`及当前请求身份，再写入；不能在外面检查后异步等待，回来覆盖新草稿或结果。取消仍可记录本次取消/中断，是否为当前请求以对应context和业务记录共同判断。

Host的`closeAll({ provider?, projectId? })`在注册域间协调，各域权威管理自己的资源。Provider按live/opening/operation实际捕获的配置过滤，不能仅凭owner删整组资源；真实项目范围由Host解析，需求目标项目不作为关闭条件。应用退出先阻止新准入，关闭失败/未知分别记录，不能把一域失败当成其余域已经关闭。

## 兼容与错误

工程可靠性收尾沿用Interface v1，新增的是结果/事件/新lastRun的可选安全诊断，不改变owner、profile或启动资格。类型及固定安全文案见[run-diagnostics.ts](../src/agent/run-diagnostics.ts)：诊断只表达可证的失败类别、阶段及本轮原生重试计数，未知保持未知；不复制原始Provider错误载荷。计数不等于供应商HTTP总数，也不意味着Host发起了第二轮请求。旧记录缺诊断或包含未来未知诊断时兼容读取，不为填充字段批量回写旧项目。

观察连接和任务运行分开：项目SSE与需求SSE发送周期comment心跳；前端任务观察收包空闲时只关闭该观察连接，随后GET同owner/request并有限重连。终态须与保存记录和snapshot对应，不能借别的请求结束状态。耗尽后明确未知/尚未恢复，用户可显式重新连接；观察恢复不调用open/messages/stop、不更改模型、不补造丢失的逐token事件。退出/切换owner清理观察计时器和请求。

本期不增加持久表、业务会话ID或需求续接指针。迁移是替换接线；旧项目、会话、父链、草稿、发布物和文件原位读取。正常显式续聊可继续追加JSONL和保存原业务结果，原GET证据校正及schema1前置兼容保留；这些合法写入与迁移性改写分别验收。回退使用能读取最新资料的兼容代码，不覆盖为旧数据副本，不热接管活worker。

错误继续按原业务入口映射：配置缺失/变化、busy、取消、原生交互过期、能力不支持、Runtime异常及结果未知。配置失效不静默fallback或重放；格式不合格仍由业务按自己的有限策略处理。原task去重、native回执、Case/RAP身份及legacy ACK/409/UNKNOWN边界继续有效；统一接入不提供所有插件跨重启恰好一次的保证。

## 接入验证与工具读取

任务内前台委派与原生联网沿用 Interface v3 及原 project/task owner，接缝契约和适用范围见[任务 Agent 能力规格](../openspec/changes/task-agent-capabilities/spec.md)。`subagent` 在同一父 Resource 中管理隔离内存 SDK 子会话；不向 Extension 开放域注册、凭据或另起 Runtime。普通与受管 ordinary 项目任务可用，protected、固定文本和专属业务 workspace 排除；子工具权限与执行资源仍由原父 scope 管理。

角色来自实际已加载 skill 的 `agents/*.md`，使用命名空间及只收窄的工具清单；`web_search` 表示已接通 Provider 的服务端能力，只有声明或缺省继承该能力的角色获得它。子结果和失败经父工具回执保存，不提供后台存续或独立子 native 历史。MiniMax 原生块续接、MiMo 来源回执与新可选 assistant 元数据由 SDK 钩子薄适配，旧记录不回填；协议续接所需的隐藏技术记录不作为用户业务消息发往 Provider。准确调用、限制、验证及尚未执行的 Git/运行采用状态以本变更结果和 Qoder 回执为准。

按当前变更实际范围关联SM01–SM14证据。检查入口由`package.json`提供：`check:agent-sessions`检查导入/构造路径，`check`同时运行约束、长期测试及构建，CI沿用同一入口。共享行为测试与实际Host/SDK合成Provider、正常HTTP/UI、保存/重开、取消及RAP+SAP+Case联合回归互补；不能只靠import通过或内部Map断言宣称完成。

边界脚本使用当前锁定TypeScript的AST解析，识别静态导入、重导出、require、动态import及已知直接构造；忽略注释、字符串、JSX和模板正文，仍检查模板表达式中的调用。准确例外及理由在[scripts/check-agent-session-boundary.mjs](../scripts/check-agent-session-boundary.mjs)，覆盖SDK薄层、公共实现、原生历史读取、固定连接探针和明确测试路径。没有Host或tests全目录豁免。检查不解释所有反射/动态代码，也不替代资源归属和业务策略的独立复核。

工具读取证据分开记录：先核对当前安装版Codex/Qoder实际项目入口，再用触发IN01的只读接入规划任务观察实际读取记录和规则版本。AGENTS、加载器代码或入口文件可访问只证明可达，不能证明任务已读取；某工具不可用或未现场核验，记NOT_RUN。工具项目入口只引用本工程规范与本说明，不复制正文、修改全局配置或开启MacBook开发。完整结果由[本变更记录](../openspec/changes/unified-session-management-phase1/result.md)保存，不能从文档存在推导SM14已通过。

## 个人资料按需复用（M4）

M4 v0.2沿Interface v3业务子集、原project-tasks owner和配置／lease；`ProjectAgentOptions.personalContext`为Host注入的只读find/read callback，不可从业务JSON或worker options自行注册，现有IPC只传启用标记与受限请求／回包。普通unmanaged真实项目任务可自主使用`find_personal_context`／`read_personal_context`，零调用正常；受管ordinary只接用户显式选择的固定文本。冷读、封闭文本和插件资源不因M4得到个人资料工具或材料。

`ProvidedContextInput.personal`可选地携带准备好的文本及最小receipt；文本由原用户请求送SDK，原生`providedContext.personal`仅存schemaVersion／实际items元信息。请求fingerprint包含准确选择与范围，已接受的同ID请求先回读，不按今天源状态或纠正重送。没有第三声明工具、机器成果采用关系或新增持久消息／正文库。

Pi1.4.0的`ctx.executeTool`已提供参数／权限hooks及nested，但SDK原工具ctx在调用结束后仍可能被保留复用；M4启用时沿public工具定义给ctx委托增加绑定现有ActiveRun／session／manager／SDK signal及实际调用存续期的最小闭包，保留原SDK delegate及合法直接／多层nested。它不新建生命周期、运行队列或业务代际；相同manager的跨run、旧parent、同ID／覆盖signal及合法组合均另有实际合成反例／正例。其它profile不启用此适配。

新增及受影响的历史读取沿现safe snapshot、public parser／inMemory投影，绝不以`SessionManager.open`迁移或初始化原件。显式打开新会话时复用既有SDK导出／首次持久化路径保存真实空header，历史GET不补造丢失记录。实际保存的工具content／用户请求与当时治理是交付依据；nested只有父元信息时子正文UNKNOWN，不强迫重读补证。人的历史页一击按准确native记录重新读取，并另核此刻治理；不以挂载时缓存当“今天可读”。

本期合同／符合性、检查与限制见[M4 spec](../openspec/changes/fourbase-context-reuse/spec.md)及[实施记录](../openspec/changes/fourbase-context-reuse/implementation.md)。本地合成工程验证不代表真实模型质量、经营收益、Git／CI或运行采用。

## Case判断与方案草案（M5）

M5沿Interface v3业务子集和原project-tasks／unmanaged owner，通过`ProjectAgentOptions.caseDecisions`提供窄业务read/save callback。两个Pi工具为`read_case_decisions`／`save_case_decision_draft`；复用M4既有IPC请求、取消与call-local SDK ctx资格，不创建新会话域、运行队列或工具循环。回调函数不跨IPC，仅传Host生成的启用位；workspace／managed／cold／sealed／插件不获Case工具。普通无Case任务仍正常分析，本轮无绑定时Case写不可用。

当轮Case取原`task_context_prepare`完成回执，核对其命名空间、真实project/task/request及snapshot归属；不猜项目关联的首末Case，不持久新增task→Case指针。sessionId/toolCallId和signal来自实际SDK调用及原ActiveRun，Host核资格后按真实namespace派生operationId；模型参数不接Case、权限、用户作者或人的选择／执行／反馈。取消前已提交的Case事务保留；晚到新写拒绝，原操作可查，不重跑模型。

Case业务SQL及原operation receipt是业务保存权威，native只证明实际给Agent的结果；合法nested继续走SDK组合，只有父元信息时不伪造子正文。目录只返回有界元信息，准确正文分片；请求及工具输出预算分别校验，不把已保存行重新当请求而损坏合法数据。人的选择／关联／归档／恢复沿Case UI，与Agent工具和会话发送资格分开；同App的未完成UI意图按store/Case暂存React状态，不成为持久账或Runtime权威。

兼容启动采用当前固定候选加`--disable-case-decisions`：可读schema1/2和已有新记录、继续原Case维护，关闭新M5工具及业务写入口；原成功operation仍可读回。原schema1二进制不能直接读schema2，不用旧备份覆盖新工作。真实环境首次迁移前须备妥经验证的兼容候选，本轮仅隔离合成验证，未执行真实部署／升级。

批准范围、公开接缝、真实RED／GREEN与实际符合性分别见[M5 spec](../openspec/changes/fourbase-case-decisions/spec.md)和[实施记录](../openspec/changes/fourbase-case-decisions/implementation.md)。原Case／RAP／Board／Feedback及M3.1／M4各自保留权威，Host不裁定因果、代人作取舍或自动派发行动。


## 多事项经验来源（M6）

M6仍沿Interface v3／Pi1.4.0和原project-tasks普通unmanaged owner；`ProjectAgentOptions.caseSources`由Host注入窄只读find/read callback，worker仅收到Host生成的`experienceLearningEnabled`位。`read_case_sources`可由未绑定Case的普通任务按需查读当前用户原全局Case可读范围，复用M4同一IPC请求map、SDK call-local、取消与预算；不创建域、会话、循环、后台模型或新运行队列。M5写入仍须原当轮Case回执，不以历史来源Case冒充owner。

Case卡片及人的choice读准确旧引用；原feedback／handoff、Board及个人来源仍由原resolver核对，分片正文显式携带范围／续页和限制。三类LearningSourceRef扩展供个人资料／候选使用；M5 `target.type=source`继续仅旧四类，SQL schema2不变。候选正文仍仅Pi native；人的整理沿原Enterprise草稿CAS、个人元信息CAS和明确retain／pending，不伪装跨Store原子。

兼容启动用当前候选加`--disable-experience-learning`：不提供新工具／新增来源候选写入／候选转整理入口，原v1/v2及既有引用仍可读和原样维护。个人账GET不升级，首次显式新引用写入才升外层v2；原行、操作指纹与native字节不回填。原始v1程序不保证可读v2，不能恢复旧账覆盖新工作。当前项目归档、源Case结束、Agent封闭资格和人的全局资料维护各循原权威。

批准包、真实检查与未验证项见[M6 spec](../openspec/changes/fourbase-experience-learning/spec.md)及[实施记录](../openspec/changes/fourbase-experience-learning/implementation.md)。可选单组对照只新建普通任务并写草稿，不打开Agent或自动发送；真实增益／因果、真实Provider／业务数据、Git／部署及产品验收分别取证。

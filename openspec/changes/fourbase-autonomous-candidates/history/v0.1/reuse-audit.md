# M3.1 Pi官方优先复用与最小缺口

2026-11-03 · 固定本机SDK **@earendil-works/pi-coding-agent 1.4.0**；静态可行性核查，不是运行兼容／采用结论。

已回读[前次官方与开源记忆研究](../personal-assets-phase01/agent-memory-research.md)和固定源码缓存。本次没有重做泛行业选型：先检查Pi已提供什么、产品已接好什么，仅为尚缺的产品语义加适配。产品分支`codex/fourbase-phase01-design`，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`，M3冻结377份源／测试／脚本／配置当前摘要全部匹配，WIP保留。

## 官方原语及本模块选择

| 能力 | 固定证据位置 | 复用／差额 |
| --- | --- | --- |
| 会话持久化、树、压缩、恢复 | 随包`docs/sdk.md`；产品`src/agent/project-session.ts:151–217` | 既有SessionManager与统一Runtime直接用；不建记忆Agent／循环／恢复器。 |
| 工具状态随原生保存 | 官方`examples/extensions/todo.ts:8–10,114–168`；`pi-agent-core/dist/agent-loop.js:662–679`，SDK`dist/core/agent-session.js:755–770` | **本模块采用工具结果details唯一承载候选**，SDK自己写native。新工具仅声明业务内容／范围，不调用第二模型、不保存第二正文。 |
| 非context自定义持久条目 | 官方`docs/extensions.md:337–349`；`appendEntry`公开API | 已核可用；本期不与details双写，免两份候选权威。官方bookmark／structured-output示例可借鉴工具／结构化输出的做法。 |
| 真实entry与fork | 官方`dist/core/extensions/types.d.ts:828–834`，SessionManager相关实现 | `turn_end`有真实entry IDs；fork保留entryID和payload。候选精确读取后才产生ref，按原origin去技术重复，不按viewer重新编号或做语义合并。 |
| 无副作用历史投影 | SDK公开`parseSessionEntries`、`SessionManager.inMemory(cwd, undefined, entries)`，`session-manager.d.ts:385–386` | 先严格检查完整快照，再复用官方branch／entries。官方parser吞坏行，须显示坏／部分／UNKNOWN；`open`可能迁移／初始化写入，不能用于本模块只读扫描。 |
| 磁盘分支与live导航的区别 | SDK`session-manager.js:717–741,1062–1071,1161–1166` | 普通`branch()`只改内存leaf；只读页按已保存canonical指针和完整native快照恢复分支，不能声称实时反映未持久导航，也不能为此接管会话。 |
| 普通任务静态工具 | 产品`project-session.ts:167–206`及官方SDK customTools | 沿已用的SimLab注入接缝添加小型声明式工具，不必开放扩展发现。任务taskId尚需从Host真实owner增传；request／session沿原run／manager，不建全局map。 |
| 用户控制与业务来源 | M3 `personal-retention-{types,sources,lookup}.ts`及原个人资料页 | 原人工保留／正文／来源合同及查找壳复用；新增候选toolResult精确读／投影／人的治理。旧native-reply读实现仍经`SessionManager.open`，本轮须一并换最小只读适配并验旧消费者，不能宣称原实现已满足“不改写历史”。 |

官方SDK提供的是可复用原语和示例，不是已经替产品决定了跨任务业务记忆的范围、事实认证、人的纠正或排除规则。也不能因Pi支持某资源，就认为所有产品profile都能接入。受管／封闭／冷读边界本期保持：候选写入只开普通unmanaged任务，其余显示能力尚未开放。

候选工具返回或SDK事件到达不等于已持久：public `message_end`在append前，execute返回后的迟到成功也不会自动变成isError。本包以磁盘精确回读和原native `optracall.run settled completed`决定默认发现；其余保留历史／终态／UNKNOWN。不额外保存一份运行完成台账，也不从completed推断专业正确。

## 官方与社区身份分开

Pi组织的 **pi-chat memory.md** 是既有研究中的应用先例，不是coding-agent SDK默认跨Case记忆服务；本次没有其完整实现字节复验。它证明文件式作用域记忆可行，但不要求照搬聊天渠道／VM／每轮注入。

**pi-memory 0.4.2、pi-memory-md 0.1.38均为社区候选**，不是Pi核心内置。原固定源码显示前者有qmd探测／embedding及默认退出模型摘要，单关EXIT_SUMMARY不等于全部副作用关闭；后者涉及Git、hooks和上下文资源，固定缓存未覆盖全部依赖。两者未安装／加载／运行验证，不能为一个原生候选工具引入尚未核清的同步、额外模型或默认注入。

qmd／Mem0等仍按整体方案作为真实检索不足时的候选；本期没有新的中文召回不足证据，不装搜索／向量／图组件。SQLite、DuckDB、Semantica／Graphiti分工沿v1.2，不因M3.1另增数据库。候选正文在native、人的控制在最小文件账，概念四库／逻辑双库仍是业务能力划分。

## 本地证据与未验证范围

专项报告：`.local/fourbase-modules/m31/reuse-audit/runtime-native-reuse.md`。初始16项逐文件清单`runtime-native-evidence-manifest.json`保留原SHA-256 `d26944c0945627a860a5c464962820a6cbe1bfd7c267808f189fbfa2763f3072`；非作者指出其未固定引用的官方示例／sdk文档及原研究后，新增同目录`confirmation-source-evidence-manifest.json`，27项，SHA-256 `35d1ebda252613b5423c137b0d883fe71a0027a0ad1c58c2ca0a7aa9708da22e`。新清单覆盖官方随包文档／示例／实现、原研究缓存与受影响产品源码，不含凭据或业务dataRoot；旧清单的固定范围不能回写扩大。此处路径为本机验证证据，产品不依赖这些`.local`文件。

已使用图谱搜索／snippet核普通接线，图谱未覆盖的新M3文件及第三方随包源沿明确文件补读；图谱无边不当成没有接线。另一个只读结构Agent核对严格schema1、fork复制、原生读口副作用和人的最小引用账；原“候选sidecar＋Enterprise复制”建议已被官方原生路线取代，没有实施。

本次不调用真实模型、不安装／运行第三方组件、不改产品源／测试／依赖或业务结构。自主候选质量、真实模型能否自选恰当内容、取消／迟到落盘、分支投影性能、中文查找与产品验收均待确认后按范围验证；不能用源码可行性或Demo交互替代。

# M1：复用与接入验证记录

2026-11-03 · M1 RV01–RV08完成，扩范围非作者复核限范围通过。新资产功能尚未实施，M2–M8未启动。

## 固定范围与结果

按[规格](spec.md)核对现有Pi与业务材料接缝，源码基线`fd6f9714909d1628cd81d751f7fe9537af9b5b6f`不变。已通过v1.2正文SHA-256仍为`7a165e26f82674b1d2bda0b79fd2fde9f246f06dccceb0c95c2db6354e947ff0`；原研究和历史候选未修改。模块划分在[总进度](../personal-assets-phase01/tasks.md)，这里只记录M1验证，不另起产品方案。

Pi的声明、lock根依赖、lock包与已装manifest均为1.4.0，执行Node v25.9.0。已装SDK文档SHA-256仍为`d9034ccbf2219a58712d8dd4fcdf47e687d77131e71dd5d119d8a71e9bd2a2e8`，与原固定研究相符；七份缓存源材料均与原manifest摘要一致。该核对不等于对整个npm包或第三方发布包逐字节审核。

本地主线已前进到`484995d908087449e64e9c352b9d5e33d8358afd`，相对当前HEAD只多四份SimLab归档／真实验证文档，产品源码无差异；未fetch远端，不宣称远端实时最新。未切换分支、操作其他工作树或运行服务。

## 能力、证据与选择结论

| 能力 | 当前证据与直接复用 | 真实缺口／下一步 |
| --- | --- | --- |
| 持久会话、分支、恢复与压缩 | [project-session.open](../../../src/agent/project-session.ts)走SessionManager.open/create与createAgentSessionRuntime；bindSession／command委派原生新建、切换、fork、tree、compact等。兼容测试检查JSONL前缀、父会话和显式续接 | 直接沿原指针和Pi能力；不建消息库、恢复／压缩引擎。测试没有调用真实模型压缩，不将委派接线当作压缩质量通过 |
| 普通任务文件检索／渐进读取 | 同一open路径提供codemode、tool_search、MCP和grep/find/ls；[企业资料上下文](../../../src/host/enterprise-materials-context.ts)提供可查目录及精确revision的location/excerpt/full；零选材／无Case测试可沿原生工具实际读取 | M2先复用原目录、文件与修订；不要为“记忆”先加通用搜索后端。技能的名称／描述目录与读取正文分开，工具返回不伪装成请求开始时已提供 |
| 业务原件与引用 | [EnterpriseMaterialsStore](../../../src/host/enterprise-materials-store.ts)已有store/material/revision、正文path/hash；readRevision按精确修订查找，缺失报错；SAP发布索引已有精确版本和定义位置 | 可用作知识来源，不能推定自由文本source／owner／scope已覆盖用户保留、跨对象引用、冲突／归档；Case artifact的观察hash也不能保证旧字节恢复。M2核实必要固定内容，M3收敛经验持有方式 |
| 真实交付与历史回读 | [prompt](../../../src/agent/project-session.ts)记录provided-not-adopted；[savedTaskHistory](../../../src/host/project-history.ts)读native branch和optracall.run；资料／反馈测试核对旧修订及当时正文回执 | [ProvidedContextInput](../../../src/agent/project-runtime.ts)当前只有RAP／Case／enterprise／feedback，尚无个人经验交付含义。M3／M4按真实入口最小适配；不得按当前索引回填旧请求。资料list会刷新派生目录，不能把所有目录浏览笼统称为零写入 |
| owner、生命周期与profile差异 | [公共会话入口](../../../src/host/agent-sessions.ts)Interface v3及原server项目任务profile；项目、需求、Board、核算、出稿、PPT沿原入口；代表检查覆盖隔离、停止、配置变化及封闭资源 | 不给普通记忆消费新增会话域。受管任务只安全委派工具；fixed-draft/text-only无外部工具／扩展；独立核算不注入主分析答案。不能为装记忆扩展全局开放资源 |
| 文件式记忆候选 | 缓存pi-memory 0.4.2、pi-memory-md 0.1.38的固定源码／manifest供静态比较，身份同[研究](../personal-assets-phase01/agent-memory-research.md) | 尚未安装／加载／证明Pi1.4.0兼容。pi-memory有退出摘要与qmd相关行为；pi-memory-md有启动／退出hooks、Git／sessionBridge及原生依赖待验。peer版本或配置声明不能证明运行和关闭副作用成功 |
| 用户保留、个人查找与跨事项复用 | 既有反馈／报告→新任务／需求、跨Case选材与明确拒用路径已实现，见[反馈实施](../decision-feedback-loop/implementation.md)与[Host入口](../../../src/host/decision-feedback-routes.ts)。当前源图与manifest未显示个人知识／经验统一目录及长期保留产品语义已实现 | M3／M4只补新保留经验的统一查找及精确历史、归档／冲突等差额，不重建既有反馈回流。合成回复不能证明新能力已完成；先复用已有选材／交付链，再决定更强召回是否必要 |

**本模块的选择结论：** 会话权威、文件检索、资料修订、SAP发布、实际交付和回读直接复用既有入口；M2从原项目任务和材料路径做纵向切片。M3实际开始前，再就固定代表场景核清文件记忆候选的运行兼容和映射，必要时只补有证据的业务含义。现在不选定／安装第三方记忆后端，也不把“暂未验证”写成候选不适用。DuckDB、Semantica／Graphiti仍由后续真实缺口触发，不因模块拆分提前采用。

## 已执行检查

原始证据目录：本机`.local/fourbase-modules/m1/run-db89e7794e/`。`commands.json`固定命令；`check-1.log`、`check-2.log`保留原输出；`result.json`记录退出码；`identities.json`记录源码／测试／依赖文档摘要与版本，便于复核对应候选。

| 检查 | 结果与范围 |
| --- | --- |
| `npm run check:agent-sessions` | 退出0；静态接入导入／构造约束通过，不能代替行为或全量既有合规审计 |
| 八份现有测试，共49项 | 49通过、0失败、0取消、0跳过；全部使用测试隔离目录、合成材料和本机回环合成Provider，没有真实模型请求 |
| 原生会话及兼容 | sdk-sessions与session-compatibility覆盖项目隔离、停止、配置脱敏／清除、重启回读、旧JSONL前缀与父链、显式续接；不证明专业分析质量 |
| 材料与反馈交付 | enterprise-context-host与feedback-session-integration覆盖精确修订、旧来源回执、无Case／零选材、自主文件读取、错误选材拒绝与反馈正文提供 |
| 公共入口与受限资源 | agent-sessions、agent-session-boundary、project-session-guards、protected-session覆盖不同owner/profile、关闭与配置、迟到事件、fixed-draft命令拒绝、受管工具保护和资源收尾；仅代表检查，不声称全产品回归 |

本模块没有产品源码／依赖变更，没有新增永久测试或placeholder RED，因此未运行全量`npm run check`／build；已有代表测试正用于核对所复用接缝。未安装插件、启用后台摘要或迁移数据，没有Git交付、运行切换或MacBook操作。测试生成的独立合成现场和原输出均保留。

## 独立复核与职责边界

非作者、全新上下文Agent `modules_m1_final_review`先从主方案和工程规范独立导出预期，再核对模块映射、固定日志／摘要和代表生产路径；其未参与候选任何部分创作。只读辅助审计在未读作者报告的上下文中核对8份测试及fixture，确认32项公共生命周期／静态检查加17项Host／SDK合成检查共49项，与日志一致。兼容测试会加载自产合成扩展，不能把“无第三方记忆扩展”改述成“完全无扩展”。

用户新增开工前检查后，规格扩为RV01–RV08，补[全产品能力与最高原则审查](capability-audit.md)。原局部证据保留，最终复核者对新固定候选另补核：21域与实际导航、Host注册、业务入口及存储权威相符；完整v1.2与M1–M8设计遵守最高原则，M2–M5已明确直接复用既有链路、只补差额。最终核对9份文档、39项审查来源摘要、121个本地链接及原49项测试证据，无必须修复项，RV01–RV08可收尾。

职责／复用专项在本次设计和列明的接缝证据范围内通过。Host仅管理材料、权限、资源与记录；Pi承担执行、工具循环和会话；业务判断由Agent／人作出。本模块没有新增Host分析流程、方法配额、平行Runtime或存储机制；必要保护、取消和已确认业务IO保留。代码抽查覆盖公共SDK、自动核算、PPT和SimLab，不据此宣称全部历史实现零越界。

固定复核身份：源码`fd6f9714909d1628cd81d751f7fe9537af9b5b6f`；M1 spec SHA-256 `ffe2915c432b31e09a9fd1b2214826d7d663a5ab10663887217272d29a2130eb`；capability-audit SHA-256 `65ea1b1b08e8b63ca2d5fc8dd417172c7b02acf4d4bc6662fd22bf86fc596d03`；当时tasks SHA-256 `5792c8a508839745aeb470971e374c2e29f3032c441bfcf8f60801d8fab37379`。原候选清单与扩范围清单保留；复核后只更新结果和tasks状态，主方案／spec／审查正文不改，最终清单另存`.local/fourbase-modules/m1/final-manifest.json`。

## 未验证与下一模块

- NOT_RUN：第三方候选安装／加载、发布包与固定源码包含性、中文近义召回、实际新经验保留／跨Case引用、真实模型正确性／压缩质量／成本、真实经营效果。
- 新持久结构和字段仍未批准；模块划分不恢复旧D01–D08。真实Case／负责人／材料／排期、Git／CI及运行采用按适用有效授权分别处理。
- M1后进入M2：只针对同一项目任务中的多源材料、必要数据解释／轻概念映射与成果追溯，先固定可执行规格和最小剩余决定；不同时展开M3记忆后台、M5双库新结构或M7引擎。

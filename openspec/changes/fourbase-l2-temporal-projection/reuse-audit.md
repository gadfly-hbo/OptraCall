# L2 准备：当前 L1 接缝与增量

2026-11-04 · 只读核对 `57742b99d173bfa6413e83705682b0444359add4`／tree `462a29b31a7a7a4159b87e4a1b243ddb3a84104b`；不是组件运行证明。

v0.3补充：L2的主要后端方向是Semantica本体／知识图谱支撑Agent语义理解，而非让用户查看解释页。原回复旁依据详情继续复用，业务含义只作可选内容；主回答主动解释关键口径／冲突属Agent输出目标，不由Host强制查库／方法编排。此处既有接缝核对不能证明后端语义增强已实现或有效，P1底座范围保持。

v0.2范围校准：本核对只支撑P1和原产品接缝的复用。完整L2还包括业务语义组织、规则约束／冲突与来源、关系／事实演变及Agent按需查询；原接缝或一层追溯不能代替这些方向的完整实现。Semantica／Graphiti为候选原生实现，P1排除的功能不等于永久排除，详见spec§1。

按工程规范 IN01–IN07、会话接入说明和 L1 原批准范围读取。先建立本树专用 codebase-memory-mcp 图 `optracall-l2-preparation-0e3f-20261104`（fast，7342节点／21667边，persistence=false），按图发现再定点读当前源；旧main／5239图不代替当前源。

| 当前接缝 | 固定源码位置（行号为本次基线） | 已有及 L2 不应重复的能力 |
| --- | --- | --- |
| 统一 project-tasks | [server.ts](../../../src/host/server.ts):136–178 | Host 绑定真实 project/task／配置并注入能力；不需新域／Runtime |
| semantic 工具及资格 | [project-session.ts](../../../src/agent/project-session.ts):315–356；[project-runtime.ts](../../../src/agent/project-runtime.ts):75,148–150 | 原 IPC、当前run／manager／session／signal、取消与 call-local；workspace／protectedExecution 不获能力 |
| 精确源读取及 trace | [semantic-context-service.ts](../../../src/host/semantic-context-service.ts):58–249 | SAP／Enterprise／M2／Case原版；一层引用后目标标unread，由Agent继续读；当前find为目录关键词匹配 |
| 来源保存 | [semantic-context-port.ts](../../../src/host/semantic-context-port.ts):9–43；[project-data-context-store.ts](../../../src/host/project-data-context-store.ts):307–340 | 真实owner／当前操作／native所属核验，declarer=agent，委托原M2 createCitation，CAS／hash／幂等／固定另存 |
| M5／M6 | [case-decision-service.ts](../../../src/host/case-decision-service.ts):164–172,238–251；[case-sources-service.ts](../../../src/host/case-sources-service.ts):53–117,143–148 | M5写须本轮task_context_prepare，M6准确旧来源／分页；图命中不授予写Case、人的choice或feedback资格 |
| 依据 UI | [App.tsx](../../../src/host/ui/App.tsx):370；[SemanticContextPanel.tsx](../../../src/host/ui/SemanticContextPanel.tsx):13–36,86–107 | 回答旁自愿入口、原稿／现在回看、追问只填草稿；不需图谱管理页 |
| native历史读取 | [semantic-context-history.ts](../../../src/host/ui/semantic-context-history.ts):11–43 | 只投影实际结果；nested缺子正文／保存回执为UNKNOWN，不能由图补造 |
| 留存时间筛选 | [reader.ts](../../../extensions/business-plugins/semantic-context/reader.ts):44–59,99 | recordedBefore仅可靠留存证据；未知另列，不是业务asOf或当时全部知识快照 |

三问现状：原稿引用已可准确回读；截至当次仅能筛已定位且有合格证据的留存；今天可读新旧版本由Agent解释变化，不能证明全部影响或计算采用。

引用类型补核：[CaseDecisionTarget](../../../src/host/case-decision-types.ts):14–20与[PersonalSourceRef](../../../src/host/personal-retention-types.ts):7–12没有直接SAP目标；应沿Case的citation来源（report目标）读取清单，再循sapRefs到准确SAP。SemanticTarget能读SAP不等于Case可写SAP引用；本包不扩大该类型。

P1最小待证差额是同源的必要关系／两个时间轴查询及其可重建派生索引；该描述只限首个验证切片。完整L2其他语义／规则／事实更新能力另按需求核原生模块和最小接缝，不先新建采用账、图事实权威、会话副本、Host推理循环或自动变化裁判。组件关闭／失败沿原L1及普通计算继续；不让工程验证脚本的固定调用顺序进入产品分析流程。

本次未运行产品／测试／Provider，未读真实业务根／凭据。代码行号为静态基线，实施前重新核对。完整接入和权限行为仍需未来真实合成验证，不能由该表宣称已通过L2。

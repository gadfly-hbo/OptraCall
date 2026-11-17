# v1.2 增量对照与复用证据

固定当前main3a529a0，图谱optracall-v12-3a529a0（14176节点/44087边，docs/scripts/部分fixtures不覆盖）。这是代码/已存在用例的核对，不是重新执行通过证据。用户确认v1.1已开发上线，本表不重列历史PM/R/E差额。

| v1.2要求 | 现有实现与证据 | 处置 | 受影响接缝 | 验收 |
| --- | --- | --- | --- | --- |
| 自然语言战略协作 | StrategyGoalsPage当前只有人工Goal候选/采用；App.send首个新Task会转Plan；Host Task本身Plan可选 | 新增薄讨论profile，避免用Task例外削弱Plan门 | 原AgentSessionDomain/SDK native/配置和来源；原战略页 | V12-03/10，直接讨论→实际Goal→Plan→Task |
| 目标候选与采用 | GoalStore.create/revise/adopt/operations、版本/CAS/去重/write_unknown已在；原record_user_decision限Case/Board | 复用Store，补真实讨论来源和窄Goal采用适配 | 真实用户表达/lease/GoalRef/hash、原操作查回 | 假原话、旧lease、CAS、重复、UNKNOWN |
| 准确战略依据 | GoalVersion已有strategies/resources/necessaryConditions/source；原goalContent已送准确目标正文 | 调整可选说明/来源与上下文供给，不重做准确Goal链 | GoalSourceRef/safe native reader/Plan/Task providedContext | 两版Goal/关系/反馈进入不同准确请求 |
| BSC可选/GSA直接用 | StrategyGoalsPage默认bsc，原GSA与BSC本已同Goal；GoalEditor常显BSC字段 | 调整默认和渐进披露，原记录直接复用 | 原page/CSS/Case/Project内部定位/版本历史 | 隐藏→展开→旧v1/新v2及来源；无BSC直入 |
| 默认用途/当前用途 | Settings只有模型/个人/自动等；Plan.goalContext.purpose是工作类型 | 新增唯一小设置，扩当前工作快照 | global-settings/讨论metadata/Goal可选背景/Plan白名单/native | 默认组织→个人不改已定工作；重开/恢复 |
| 部门上层未知 | GoalScope.enterpriseId本可选、Store读旧无锚定；Host/UI新写却强制企业 | 调整新写准入与控件；保持原SAP权限 | validateStrategyGoalScope/server.validateGoal/GoalEditor | 无企业可部门工作；不得借无scope读跨企业指标 |
| 开放方法实质采用 | 原Pi/Skill/IR/共同分析契约在，未有战略方法当前约定 | 调整讨论/方法约定及参考供给，不造全套Skill | 方法元信息/native/上下文/成果与来源 | 默认/选换组合、资料目标不丢；缺资产如实 |
| 因果承接/TOC-TP | GoalRelation.kind/rationale；CaseHypothesis/Strategy机制条件未知和原报告已有 | 直接复用表达位置，补准确供给/必要可选说明 | Goal/Case/报告/原source resolver/Agent共同契约 | 必要/贡献/假设/替代；缺证据仍推进独立部分 |
| 三层反馈 | GoalFeedback已有execution/strategy/strategic-assumption；原Board/GSA引用及关系修订在 | 复用并让新讨论/Task能读准确反馈 | 原Feedback/Case/Board/GoalRelation版本 | 不以执行完就证伪；时滞/环境变化/观察窗口 |
| 原七模块 | 两种确认、单多Task/综合、准确审查、原话行动/撤回、SAP/Studio/自动/导航已上线 | 受影响回归，非重建任务 | 既有主链及公共会话第三消费者 | acceptance兼容矩阵；原FAIL保留 |

## 关键源码锚点

- [Goal类型](../../../src/host/strategy-goals-types.ts)、[唯一Store](../../../src/host/strategy-goals-store.ts)、[原路由](../../../src/host/strategy-goals-routes.ts)、[原来源与scope检查](../../../src/host/strategy-goal-sources.ts)。
- [统一会话](../../../src/host/agent-sessions.ts)、[需求适配参考](../../../src/host/requirement-sessions.ts)、[Host静态注册/Task派发](../../../src/host/server.ts)。
- [原目标准确供给](../../../src/host/project-plan-host.ts)、[Plan严格解析](../../../src/host/project-plan-store.ts)、[准备](../../../src/host/project-plan-preparation-host.ts)、[native历史回执](../../../src/host/project-history.ts)。
- [原话适配](../../../src/host/quoted-decision-adapter.ts)、[实际工具](../../../src/agent/quoted-decisions.ts)、[准确成果](../../../src/host/project-task-results.ts)。
- [原App](../../../src/host/ui/App.tsx)、[战略页](../../../src/host/ui/StrategyGoalsPage.tsx)、[原样式](../../../src/host/ui/styles.css)、[项目方案](../../../src/host/ui/ProjectPlanPage.tsx)。

现有测试源码定位：strategy-goals-store、strategy-goal-sources、project-goal-content-gaps、project-plan-preparation-host、project-plan-case-link、quoted-work-revoke-r02、quoted-arrangements-runtime-product-gaps。其存在仅证明可复用覆盖；新候选必须重跑适用项。

本地详细静态调用/字段证据在.local/v12-preparation/backend-inventory.md及ui-inventory.md；产品原件在仓库外，未复制进本变更。

# OptraCall 分析与决策闭环开发基线

2026-11-11，用户审核通过以下五份 v0.1 规格及对应的交互演示，要求固化后在新会话、新分支逐项开发。本记录是该批次的审核决定。规格和演示按评审时的原字节固定，规格首页的「待确认」或「评审稿」为评审前状态。浏览器和合成场景检查属于设计验证，工程实现、真实模型效果和产品验收由后续开发记录。

| 评审顺序 | 规格 | 演示 |
| --- | --- | --- |
| 1 | [需求梳理与分析框架确认](../openspec/changes/requirements-analysis-framework/spec.md) | [UI Demo](prototypes/requirements-analysis-framework-ui-demo.html) |
| 2 | [报告计算复核](../openspec/changes/report-calculation-review/spec.md) | [现有界面流程演示](prototypes/report-calculation-review-flow-demo.html) |
| 3 | [结论与建议审查](../openspec/changes/conclusion-recommendation-review/spec.md) | [UI Demo](prototypes/conclusion-recommendation-review-ui-demo.html) |
| 4 | [分析框架覆盖复核](../openspec/changes/report-framework-coverage-review/spec.md) | [现有界面流程演示](prototypes/report-framework-coverage-flow-demo.html) |
| 5 | [报告结论确认与决策看板交接](../openspec/changes/confirmed-conclusions-board-handoff/spec.md) | [UI Demo](prototypes/confirmed-conclusions-board-handoff-ui-demo.html) |

按依赖建议实施 `1 → 2 → 4 → 3 → 5`。第 4 项使用第 1 项实际送入的框架版本，并入第 2 项已有的一次复核委派。第 3 项的发起沿自身入口，旧核算与新计算复核的准入、取消及互斥需联合验证。第 5 项使用第 3 项的固定版审查和逐条意见，确认入板后仍由用户决定是否采纳建议。第 2、4 项演示沿原界面及原操作。

开发依据为本记录、对应规格与演示，以及实施基线上的[工程规范](engineering-workflow.md)和[统一会话接入](agent-session-integration.md)。规格间由后续增量细化时，按相应接缝同时核对。变更已确认行为时，把影响和需要取舍的地方带回用户确认。

## 实施进度

2026-11-11，第 1 项 RAF-A1 至 RAF-A5 通过适用工程验收，实际 Host/Pi、14 项浏览器及非作者双轴复验通过。完整检查 1,890 通过、0 失败、67 条件跳过。源码位于独立本地 `codex/data-analysis-flow`，真实专业效果和用户产品验收分别记录。[第 1 项实施与证据](../openspec/changes/requirements-analysis-framework/implementation.md)

第 2 项工程验收通过，已完成请求互斥、固定材料、同父请求前台委派及回执，非作者双轴和5组浏览器检查通过。最终完整检查1,921通过、0失败、67条件跳过。后续沿第4→3→5项推进。[第 2 项进度](../openspec/changes/report-calculation-review/implementation.md)

第 4 项本地工程验收通过，FCR-A1 至 FCR-A4、非作者双轴及最终 5 组浏览器通过。复用第 2 项同一次委派，只用第 1 项确切送入或原生历史可证的框架版本；历史预算两轮原 FAIL 与修复证据保留。最终完整检查 1,945 通过、0 失败、67 条件跳过。按已授权顺序进入第 3 项，专业效果与用户验收另核。[第 4 项实施与证据](../openspec/changes/report-framework-coverage-review/implementation.md)

第 3 项适用本地验收 CNR-A1 至 CNR-A5 通过，已实现固定报告只读逐主张审查、原任务草稿显式回交和旧入口安全交接。材料实际片段/来源定位/准备与真实交付的初始 P2 已修复，非作者 Spec/Standards 复验均 PASS，原 FAIL 保留。最终本地完整检查 2,001 通过、0 失败、67 条件跳过；10份批准原件保持。第3项收尾时的集中Git/CI交付、运行采用及产品验收边界保留。[第 3 项实施与逐项证据](../openspec/changes/conclusion-recommendation-review/implementation.md)


第 5 项 CBH-A1至CBH-A5适用本地验收通过：直接复用第3项固定审查，纯结论/可选建议按同库事务确认入板，保持后续采纳、任务和反馈显式。缺稿重放的非作者P2及三条首轮全检失败已修复复验，原FAIL保留。最终完整检查2,024通过、0失败、67条件跳过；全新非作者Spec、Standards及四原则专项PASS，作者和非作者实际浏览器均通过。[第5项实施与逐项证据](../openspec/changes/confirmed-conclusions-board-handoff/implementation.md)

## 五项本地验收汇总

2026-11-11，实施顺序1→2→4→3→5。以下均为本地实现、隔离合成工程检查及相应非作者复核结果；不代替Git/CI交付、运行采用、真实专业效果或用户产品验收。各项首次FAIL/UNKNOWN和未证明范围保留，五份已审核spec与五份Demo保持原字节。

| 项目 | 最终适用本地结果 | 逐项记录 |
| --- | --- | --- |
| 1 需求梳理与分析框架确认 | RAF-A1至A5通过；复用RAP/SAP/四库/双库与原生公开搜索隔离，所见/确认/送入版本一致。该阶段完整检查1,890通过/0失败/67条件跳过，双轴及14组浏览器通过。 | [实施与证据](../openspec/changes/requirements-analysis-framework/implementation.md) |
| 2 报告计算复核 | 适用验收通过；原主Agent同请求一次前台委派、固定材料及原生回执，结果由主Agent自主处理。该阶段完整检查1,921通过/0失败/67条件跳过，双轴及5组浏览器通过。 | [实施与证据](../openspec/changes/report-calculation-review/implementation.md) |
| 4 分析框架覆盖复核 | FCR-A1至A4通过；复用第2项同一次委派，只核第1项实际送入或原生历史可证框架，不替换latest。该阶段完整检查1,945通过/0失败/67条件跳过，双轴及5组浏览器通过。 | [实施与证据](../openspec/changes/report-framework-coverage-review/implementation.md) |
| 3 结论与建议审查 | CNR-A1至A5通过；固定稿逐主张只读审查、显式回交原草稿、旧入口安全交接。该阶段完整检查2,001通过/0失败/67条件跳过，双轴及受影响浏览器通过。 | [实施与证据](../openspec/changes/conclusion-recommendation-review/implementation.md) |
| 5 报告结论确认与决策看板交接 | CBH-A1至A5通过；本版受支持结论与明确选择的关联建议原子入板、可信来源/条件/版本、回执去重及安全历史；确认0新增模型。最终整批完整检查2,024通过/0失败/67条件跳过，双轴及实际Chrome通过。 | [实施与证据](../openspec/changes/confirmed-conclusions-board-handoff/implementation.md) |

最终检查绑定113件修复候选SHA `5894149a471da6a7af37f5d6809722b83e69aed962808b1125fd9e9f44ff038e`；候选、原WIP与批准原件均核回，完成标记后仅本进度及第5项实施记录变更。源码仍在本地未提交分支 `codex/data-analysis-flow`；集中Git/CI和OpenSpec交付收尾尚未执行。本轮仅工程合成路径，不切换运行服务或MacBook。

## 文件 SHA-256

```text
034db892e5fdab04f71b02278d4ca0df028b29c9e84063d05f4cd6a9f97dd068  openspec/changes/requirements-analysis-framework/spec.md
b6ce6e1c8856d9535c6b1fcfce97b5e7ff3bcd4db56c3bd2a8bb97eb6de96eb5  docs/prototypes/requirements-analysis-framework-ui-demo.html
51cc929b3e4d1989bd448b25d8e1d2d1712c5cf2d82c86c00250070273921839  openspec/changes/report-calculation-review/spec.md
ae9ca5ad9232dee523c2c538ec108cb268f84ad178b6818a915bb30580040092  docs/prototypes/report-calculation-review-flow-demo.html
a7cb21bbd706ad44cbce5d3d65f9a9c835b82752555c359ef96a346d3e785cbd  openspec/changes/conclusion-recommendation-review/spec.md
af34494383c5df907bd8ae864b81f7660be32701cfb70219140a5d86fb0fa5c4  docs/prototypes/conclusion-recommendation-review-ui-demo.html
dd21a1ea3f86782694e45b2bc81509cc2bd407f49165f3c05b677eadefda53ab  openspec/changes/report-framework-coverage-review/spec.md
412ef36c9a55a78d9b3ad6e919a6ec30f46700f0d6496c4ca61a08b05cc88050  docs/prototypes/report-framework-coverage-flow-demo.html
9589784cedf3a5e302814ab71e802b52059e3fcd374029670fc2f42239c91320  openspec/changes/confirmed-conclusions-board-handoff/spec.md
4c52712ad0d265098f12ac6b4580776dee14522bb8dcec0769b94ede48e999b7  docs/prototypes/confirmed-conclusions-board-handoff-ui-demo.html
```

## 集中Git交付

2026-11-11，用户已授权五项集中单PR、实际head CI通过后直接squash、快进main与原位归档；当前Git交付进行中，实际身份和收尾以[交付记录](analysis-decision-workflow-delivery.md)核定。原本地阶段及失败记录保留，服务和MacBook保持。

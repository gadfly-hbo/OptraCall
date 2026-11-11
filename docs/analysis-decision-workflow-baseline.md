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

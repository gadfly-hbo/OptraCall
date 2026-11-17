# 单项历史 TDD 证明保留（用户已接受）

2026-11-17，用户已明确接受本页限定范围，当前状态为 **已接受的 NOT_PROVED**；本轮该单项流程门关闭，历史证明不改写为PASS。下列原申请事实、范围、风险和限制继续保留。不改变产品要求、当前测试结论或规范，也不自动授予Git、模型、设备或服务权限。

- 范围：本轮新增 Task `read_goal_context_source` 工具的初版接线（`src/agent/goal-context-source.ts`、runtime/Host callback）。初版根据静态上下游差额先写实现，随后添加 `tests/strategy-discussion-host.test.ts` 的实际Host/Pi/Task/Provider永久回归（证据 runtime/14）。作者为Root。
- 规范：`docs/engineering-workflow.md` 第3节要求“实现前有能检出目标行为错误的测试”，并明确“后补测试不能伪造历史失败”。本项没有开实现前因果RED，状态为 **NOT_PROVED**。无法靠后来GREEN恢复历史，不能回滚重演冒充当时证据。
- 当前功能证据：准确GoalRef及实际已交付上下文限定工具可读范围；实际Task沿原GoalVersion来源session/entry/hash读取；跨Project/模型/当前grant、准确entry祖先链来源、接收Task排除/对象范围/出口、取消及失读有真实集成和反例。后来权限修正的独立/作者RED、GREEN分别保留，不用于补造初版TDD。
- 风险与影响：缺失的是初版先失败后实现的历史证明，当前行为由后补永久回归及独立复核核查；不能声称本轮所有确定性接缝均遵循了先RED流程。这不是产品减配、专业效果通过或SDK例外。
- 建议处理：仅接受该准确初版接缝的历史流程保留；原NOT_PROVED永久保留，当前候选检查与两轴功能结论独立记录；后续变更继续依原规范，不扩大到其他任务或任何未来补测。
- 退出条件：没有可追补的历史证据；只有用户对该明确范围的风险接受能关闭本轮流程门，接受后仍标“已接受的NOT_PROVED”，不改写PASS。若不接受，则保留候选、报告及证据，工程流程门不关闭，不进行合并/发布。

此项由独立规范轴确认不是现存功能缺陷；用户现已限范围接受，按该明确例外收束本地工程。原NOT_PROVED、复核结论和当前功能证据分别保留，不宣称全部历史流程通过。

当前功能证据已形成：固定61份运行文件组合摘要 `14eb3712911db6f9df7eca0b1ac2b4c00de3d4c60950adc1bd97f1d19397d53b`；check02为2,865 PASS／111 SKIP／0 FAIL，实际官方Pi/Host/Provider、真实App及组织多Task联合验收。参见[result.md](result.md)和[implementation.md](implementation.md)，不能由这些证据补造本项历史。

## 用户明确决定 · 2026-11-17

用户原话：

> 接受这项[限范围流程保留](/Users/bendandebaba/.codex/worktrees/optracall-v12/OptraCall/openspec/changes/overall-architecture-v12/process-exception.md)。

接受对象是上述原申请及固定实现候选 `a554e8b5c2a086ab4bc43f959bccbc886e1f4c03bcf21c5c18bcbad7c67393fc`，其中61份运行源码/测试/检查脚本组合摘要 `14eb3712911db6f9df7eca0b1ac2b4c00de3d4c60950adc1bd97f1d19397d53b`。仅关闭该准确初版接缝的历史TDD流程门，状态保持“已接受的NOT_PROVED”；不扩大到其他变更或任何未来补测。

本次只更新决定与收尾材料，产品/测试/SDK不变。原申请和候选清单保全在 `.local/v12-implementation/process-acceptance-20261117/before/`，原话收据为同根 `user-decision.json`。不包含Git/CI/合并、正式迁移/双机服务、真实模型/业务资料或SDK升级授权，不替代用户产品验收或经营效果。

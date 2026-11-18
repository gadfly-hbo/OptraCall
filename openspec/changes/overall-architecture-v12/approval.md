# v1.2 开工确认

2026-11-17，用户原话：“同意这版 v1.2 spec 和 UI Demo，按实施清单开始开发，持续完成实现、修正、集成、验证和独立复核。”

批准的准备候选：`7fe8b90898a0500b0766d4718e88d487ec7f12f9e8dcd1b76de289240afd5d36`，16文件清单保留于`.local/v12-preparation/candidate-source.json`；批准前逐文件SHA重核0差异。产品v1.2 SHA `e3ca18ace644bb28524e70ef50d9106b892a638a786c241e1d1423f13a221694`，UI来源manifest SHA `8736580780d057e3e0600b722eb74bb0b3d4e4d8b2d6c854cd51bd321434dc47`。

本次授权实施清单E1—E6及适用确定性TDD、隔离官方Pi＋合成Provider、真实App隔离观察和非作者复核。公开验证接缝沿已批准spec/acceptance：用途设置/准确GoalStore/ProjectPlan及实际native和Provider边界、停止/权限与真实UI。不增加逐模块或逐测试审批。Git交付、正式迁移/双机服务、真实模型/业务资料和SDK升级的原边界保持；未获本轮覆盖的动作不执行，不阻塞独立工程实施。

## 单项历史流程保留接受 · 2026-11-17

用户原话：

> 接受这项[限范围流程保留](/Users/bendandebaba/.codex/worktrees/optracall-v12/OptraCall/openspec/changes/overall-architecture-v12/process-exception.md)。

用户接受[原申请](process-exception.md)的准确限定范围：仅Task `read_goal_context_source` 初版先实现后补测试的历史TDD证明保留。对批准时固定候选 `a554e8b5…`／运行摘要 `14eb3712…`，状态为“已接受的NOT_PROVED”，关闭该单项本地流程门；不改写为TDD历史PASS。原复核、FAIL/UNKNOWN/SKIP及四份派生绿色JSON事件继续保留。Git、CI、合并、设备/服务采用及真实模型等范围不扩大。

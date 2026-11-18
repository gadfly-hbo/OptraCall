# 无看板历史轮次的 Teach

原 PM 已关闭产品提交 `abe1d16` 的四项差额和六个修正场景。本轮目标是让用户在同一事项进入 B 轮之后，仍能依 A 轮的暂缓或不行动取舍启动 Teach，提交后来取得的观察，并在重开后回看。产品依据为框架 v0.8 C7/C12、规格 v0.3 §3 与 T3。PM 报告 SHA-256 为 `ca9439a531455754b762635bab74a4b4b001f5d34588d0e7b7acf52a97acdf40`。[原 PM 复核报告](/Users/bendandebaba/.codex/plans/optracall-architecture-product-v1.3/product-review/OptraCall_v1.3_PM_Repair_Product_Review_abe1d16_2026-11-19.md)

沿用 Case 的取舍及原依据、人工建 Task 表单、Interface v3 的 project/task owner、现有普通任务 profile 与官方 Pi 1.4.0。Host 负责交付选中的轮次、校验权限及保存身份。用户确认是否建 Task 和保存复盘，Teach 负责解释实际观察。继续由看板保存实际行动和授权。

- [x] 已核对开工 HEAD `61c7330`，相对受审提交仅六份工程记录。工作树干净，远端分支、main 和 Mini 正式服务均为 `69e766f`。
- [x] 旧版 Chrome 的两种 A 历史卡片均无可用的建 Teach 入口。通用表单只带入 B，A 的复盘表单没有可选回复。[原失败](../../../.local/product-v13/pm3/author/recall-red.log)
- [x] 两种会员召回 A 轮均可打开原表单，取消后任务、看板、Case 及模型请求数保持原值。确认后 Pi 收到 A 的计划及理由，两份观察保存、重开后对应原 A，B 原记录逐字段一致。[浏览器点验](../../../.local/product-v13/pm3/author/recall-green.log)
- [x] 已验证缺观察、无改善、效果未知、关闭、失权与恢复、原号重试和已有看板的 A 轮。撤去原方案项目、保留接收项目时，新增模型请求为 0。[Host 与 Pi](../../../.local/product-v13/pm3/host/baseline.log) · [跨项目](../../../.local/product-v13/pm3/host/baseline-separate-project-rights.log)
- [ ] 固定产品提交，完成整仓检查、非作者双轴复核和 PM 回交。

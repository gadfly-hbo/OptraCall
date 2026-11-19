# 2026-11-19 墓碑清理

## 目标、范围与执行清单

用户授权更新 main 后重新扫描、清理墓碑，完成 Git／CI、合并 main，再更新 Mac mini 服务。基线 `e6840cb01fb366d0b59ecff08b448233846de55a`；其他工作树及未合并分支不在清理范围，MacBook 不在采用范围。

- [x] 安全更新 main、建立独立工作树和固定基线。
- [x] 图谱与实际引用交叉扫描，确定删除及保留项。
- [x] 最小删除及定向前后 GREEN，记录测试去留。
- [x] 完整适用检查和全新非作者独立复核。

后续 Git／CI／main 合并和服务采用继续属于本轮目标，按实际结果在同任务本地 `delivery-progress.md`、`delivery.json`、`adoption/` 跟进，不在候选提交前预填成功。正式检查及后续回执位于主仓 `.local/dead-code-cleanup-20261119/`。

## 清理与保留依据

- 删除无生产／测试入口的 `TaskCaseDialog.tsx`（54 行）。当前 Case、目标、任务入口及共享 Case 样式不改。
- 删除旧目录页撤除后失去消费者的 `catalogMeta`（5 行）和 `filterCatalog`（6 行）；现用 `catalogItems`、分类、Skill 测评和规划入口保留。
- 删除 7 个未使用 import binding；移除策略讨论 update 的未用 `owner` 解构，保留 `own(id)` 调用、校验、参数、返回和原生命周期。Interface v3、原 owner/profile 及接入契约不变。
- 删除 8 个无 DOM 消费者类下的 22 条 CSS 规则／片段：workspace 原生目标／版本面板、旧本地头像区、关闭按钮、Studio 旧 tabs、目标旧工具区。动态状态类及混合规则中的现用样式保留。
- scripts、Python、CLI、环境变量夹具和依赖入口未发现可确认删除项；原 PostgreSQL 证明、语义采用／试用夹具、公开会话契约及历史材料保留。零图入边或仅测试消费不是单独删除依据。

本次不改变可见 UI、数据格式、分析步骤、权限、依赖或官方 SDK。UI Demo 不适用；Host／Agent 职责、统一 Pi 1.4.0 路径不变，没有新增运行循环或人工作业。

## 测试去留与验证

仅删除 1 项无生产消费者的旧 tag/query 筛选 helper 自测。两份目录相关测试改为直接核对固定条目／分类；保留 PPT、需求、模型包、决策看板的真实入口／状态／标签／文案、Studio 无重复条目及 ID 唯一等资料断言，不另造筛选实现。其他任务、Case、配置、恢复、权限和模型包执行测试不变。

基线同一 5 文件 26/26 通过；清理后 25/25 通过，均 0 fail／0 skip。增强 unused 检查从 8 条产品诊断降至 0；原 19 条测试代码诊断仍使该额外检查 exit 1，不记为全通过。`git diff --check` 通过。原 2 moderate 依赖提示保留，不执行强制升级 SDK 的修复。

`npm run check` exit 0：3,063 项中 2,952 通过、0 失败、0 取消、111 条件跳过，类型检查及生产构建通过；`npm audit --audit-level=high` exit 0，前述 moderate 提示保留。与在用 e6840cb 构建对照，JS 正文和 favicon 逐字相同，CSS 减少 1,559 bytes，HTML 仅资产文件名随构建变化。

全新非作者对完整 13 路径候选完成标准、规格及四原则专项复核：均 PASS，必须修复发现 0；复核者独立定向测试 14/14 PASS，0 fail／skip，源码／测试冻结摘要复核一致。报告在同证据根 `independent/REVIEW.md`。以上不替代后续实际 head CI、main CI 或运行采用。

真实模型、真实业务分析及浏览器产品验收不在本轮范围；服务切换将沿原 launcher、数据根及语义配置，保全配置、项目、会话、文件和记忆，并单独核实际版本及生命周期变化。

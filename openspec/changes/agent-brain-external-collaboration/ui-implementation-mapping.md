# v0.3 UI 实现映射（领取方 Qoder · 开工阅读后建立）

2026-11-28 · 基于冻结 Demo `2f6013fd`（SHA-256 `9a5626d5…`）的实际浏览器阅读（[回执](evidence/implementation/reading/receipt.md)）与 main `7403091` 源码核对。本文件是开发映射，不是对冻结设计的修改；实质偏离须先取得用户决定。

生产令牌沿 `src/host/ui/daily-workspace.css`（`--canvas/--ink/--muted/--line/--accent` 等）及既有亮暗体系；不搬 Demo 字面色值、合成人物、`.invalid` 链接、演示控制条、场景下拉、sessionStorage。

| 冻结页面/状态 | 视觉与交互要求（实测） | 现有生产差异 | 拟修改生产组件 / 真实数据接线 |
| --- | --- | --- | --- |
| 原 Task·任务对话 + 工作方式卡 | 右栏「工作方式」卡：Agent 建议标题+说明，[在 OptraCall 内完成] 主按钮 / [通过 GitHub 外派] 次按钮，未授权零外部动作注记；已外派时改为状态摘要+查看协作进展 | 生产右栏 `task-workspace-tools`（App.tsx:1186）无工作方式卡；任务页签仅 任务对话/结论报告（App.tsx:1125-1134） | App.tsx 任务右栏新增 `TaskWorkModeCard`（新组件）；读 ExternalWork 摘要 port；内部选择仅记录意图沿原会话，外派开授权抽屉 |
| 任务页签 | 四页签：任务对话/报告与成果/保留的草稿/外部协作(计数) | 生产两页签；报告走 TaskReportDesk；草稿在 composer | App.tsx `task-mode-tabs` 增「外部协作」页签（计数来自台账）；报告/草稿沿原 TaskReportDesk 与 composer 草稿，不重建 |
| 外派授权抽屉 | 右侧 540px 抽屉（390 全宽）：业务目标可编辑、工作片段只读、接单方式 select（WB 未验证 disabled）、执行者/仓库只读、资产勾选可缩小、期限 select、确切内容 dl 快照、底部[内完成][取消][确认外派]；Escape/焦点恢复 | 无 | 新 `ExternalDispatchDrawer.tsx`；提交→ owner-bound 外派授权 port（E01）；资产列表来自原 Studio/语义目录当前资格交集 |
| 工作详情（外部协作页） | 标题「一段工作，始终回到原任务」；工作卡（状态 pill、渠道、GitHub/Host 双状态格、操作按钮）；Host 台账时间线右栏；三个边界卡；工作交接与回执（Issue 链接+预览）；演示事件时间线（生产为真实台账事件） | 无 | 新 `ExternalWorkPanel.tsx`（#work 等价视图）；读 ExternalWork/PublicationAttempt/Claim/ExternalDeliveryRef/ReviewDecision；暂停续接/取消外派/查看授权按钮接 E04/E09 合同 |
| 交付与验收 | 核验表（检查项/外部声明/核验状态）、附件 manifest（保全字节/hash/仅链接分别显示）、实际引用右栏、Agent 验收结论、[提交资产候选][继续原任务]；旧交付保留可查 | 无 | 新 `ExternalDeliveryPanel.tsx`；读 ExternalDeliveryRef + 保全状态；接受/需补充由原 Agent 经原工具产生 ReviewDecision，UI 只展示与发起续接 |
| 资产依据 | 获准资产表（名称/准确版本/出处/范围）、版本详情+hash、读取记录、入口可用性、失败保留说明 | 无 | 新 `ExternalAssetAccessPanel.tsx`；读 grant allowlist ∩ 原资格 + 读取回执（E03） |
| 设置·连接与执行方式 | 基础路径卡（GitHub/资产工作MCP/资源/通用闭环 四行+状态 pill）与可选适配卡（API/Connector/联合测试 三行，未验证禁用）分区；核心未配置不阻断内部 | 生产 ServiceConnections.tsx 有四服务连接，无外派核心/可选分区 | ServiceConnections.tsx / 设置视图新增「外派与执行方式」分区组件；核心就绪读 E02/E03 就绪合同，WB 读 E05 integration_unverified 门槛 |
| Case·项目与任务行外派摘要 | 原任务行下浅紫 inset：本 Task 外部协作·状态·独立台账·不改轮次/待回应 | DailyCaseProjects.tsx:38 任务行无外派摘要 | DailyCaseProjects.tsx 任务行按真实 assignment.issue 匹配注入只读摘要；CaseBoard.tsx:230 四页签不变 |
| 报告与成果 | 原报告不被覆盖；已接受片段以「已关联新增成果」虚线框+查看交付链接出现 | TaskReportDesk/TaskReportEvidence 无外部成果链接 | 沿原成果合同：原 Agent 保存后产生真实 native 成果；ExternalDeliveryRef 仅经外派详情回读，不伪 native（E04） |
| 首页/Case 总览/当前工作/历史 | 不新增外派待办；人的待回应/项目等待/轮次保持原权威 | 已符合（main 7403091） | 不改首页投影（home-pending.ts/workspace-daily-routes.ts）；仅核对不被外派写改 |
| 停止/取消/暂停 | 暂停本 Task 续接（本地）与取消外派（撤资格+请求外部停止+待核）分开；取消确认弹窗 amber 警示；迟到隔离 | 生产 stop 仅停本机（server.ts:3842） | 新增持久暂停字段+UI（E04/§9）；取消走外派取消合同；旧 cleanup 迟到保护覆盖新字段 |
| 窄屏/暗色/键盘 | 180px 侧栏→390 汉堡菜单；1024 双栏保持；抽屉 390 全宽；focus-visible 3px；Escape 关闭；表格容器滚动无页面横溢 | 生产已有响应式骨架 | 沿生产断点与焦点体系实现新组件；同视口对照验收（E06） |

## 不搬入生产

演示控制条/场景下拉/重置/模拟按钮、合成人物与固定回复、`.invalid` 链接、sessionStorage v3、`later()` 定时模拟推进。生产状态来自真实 Host 台账与后台收件，不由前端定时器伪造。
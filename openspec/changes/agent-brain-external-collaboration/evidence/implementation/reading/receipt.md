# 冻结 Demo 开工浏览器阅读回执（领取方 Qoder）

2026-11-28 · Issue #155 · 领取评论 issuecomment-7238712430

## 阅读对象与身份

- 冻结 Demo：`openspec/changes/agent-brain-external-collaboration/ui-demo.html`，提交 `2f6013fd759ebac5b37999c82817e3461a245107`，SHA-256 `9a5626d5efe69f2d5a4c22ee234919a4abd07e4c190a0fb996a9449cd062fcb4`（本地实测与 Issue 登记一致；导入任务分支后再次实测一致）。
- 同读：spec.md `56522ef4…`、tasks.md `fe12198a…`（摘要一致），及 decisions/changes-v0.3/ui-mapping/demo-guide/main-alignment/reuse-audit/integration-research/result/preparation-review 全文。
- 浏览器：playwright-cli（Chromium 内核），经 `python3 -m http.server 8791 --bind 127.0.0.1` 以 HTTP 渲染（与 PM 准备记录一致，file 协议在其环境被管理员策略阻断；本机未尝试 file）。会话自任务工作树证据目录启动，快照/截图存于本目录。
- 视口：1440×900、1024×800、390×844；亮/暗主题均实际切换查看。阅读时间 2026-11-28 19:41–19:58 +0800。

## 实际查看的页面/状态（截图均经本人逐张查看，非仅生成）

| # | 页面/状态 | 截图 |
| --- | --- | --- |
| 01 | 首页 1440 亮：待处理事项/进展关注/继续工作，无外派待办 | 01-home-1440-light.png |
| 02 | Case 总览：Case 总览/全部项目同级页签 | 02-case-current-1440-light.png |
| 03 | Case 当前工作：四页签、240px 事项区、本轮概览 | 03-case-board-current-1440-light.png |
| 04 | Case 项目与任务（外派前）：范围下拉、原任务表 | 04-case-projects-1440-light.png |
| 05 | 原 Task 任务对话：工作方式卡（内完成/GitHub外派）、本任务保留 | 05-task-analysis-1440-light(-full).png |
| 06 | 外派授权抽屉（GitHub 默认）：目标/片段/接单方式/执行者/仓库/资产勾选/期限/确切内容快照 | 06-grant-drawer-1440-light(-full).png |
| 07 | 外派后工作详情（发布待核）：Host台账时间线、三个边界 | 07-after-dispatch-1440-light-full.png |
| 08 | 交付与验收（已接受）：核验表、manifest、实际引用、Agent结论 | 08-delivery-1440-light-full.png |
| 09 | 资产依据：获准资产表、准确版本详情、读取记录、入口可用性 | 09-assets-1440-light-full.png |
| 10 | 设置（核心就绪）：基础路径/可选适配分区 | 10-setup-1440-light-full.png |
| 11/12 | 首次未配置：Task 内部仍可用；设置核心未配置 | 11/12-first-unconfigured-*.png |
| 13/13b | WorkBuddy API/Connector 单项通过仍禁用（弹窗） | 13/13b-wb-*-1440.png |
| 14/15/16 | 核心四步配置；联合测试须核心+单项前置；模拟联合通过 | 14/15/16-*.png |
| 17 | WorkBuddy 模式授权抽屉：3次API额度快照 | 17-wb-grant-drawer-1440-full.png |
| 18 | WorkBuddy 工作详情：触发占额1/3、串行、续租 | 18-wb-work-detail-1440-full.png |
| 19 | 等待通用Agent领取：未领取不读资产、不触发WB | 19-scenario-*.png |
| 20 | 发布 UNKNOWN：禁盲重发、核对原回执 | 20-scenario-*.png |
| 21 | 模型忙：交付待处理、Agent尚未接受 | 21-busy-delivery-pending-1440.png |
| 22 | 需补充：v1.1 已接受、旧 v1.0 保留可查 | 22-supplement-delivery-v11-1440.png |
| 23 | 停止后迟到：取消待核、迟到隔离保留 | 23-late-after-stop-1440.png |
| 24 | 同一执行者占用：排队、0/3 未占额 | 24-executorbusy-waiting-1440.png |
| 25 | 回传校验失败：缺件/仅链接不标保全 | 25-failed-manifest-1440.png |
| 26/26b | 范围扩大待决定：保持原范围按钮 | 26/26b-intervention-*.png |
| 27/28/29 | 工单预览抽屉、授权快照抽屉、取消确认弹窗 | 27/28/29-*-dialog-1440.png |
| 30 | Case 任务行外派摘要（已接受·独立台账·不改轮次） | 30-case-projects-with-dispatch-1440.png |
| 31/32 | 报告与成果（原报告不被覆盖+新增成果链接）、保留的草稿 | 31/32-*-1440.png |
| 33–36 | 暗色 1440：task/work/delivery/setup | 33–36-*-1440-dark.png |
| 37/38 | 1024 暗色：task/work 双栏保持 | 37/38-*-1024-dark.png |
| 39–42 | 390 暗色：home/task/work/setup 单列无横溢 | 39–42-*-390-dark.png |
| 43 | 390 工作区菜单弹窗 | 43-mobile-menu-390-dark.png |
| 44 | 390 授权抽屉全宽底部形态 | 44-grant-drawer-390-dark.png |
| 45 | 全部项目页 | 45-all-projects-1440-light.png |

## 实际操作的交互

- 导航：首页→Decision Case→继续当前工作→项目与任务→打开原任务；hash 路由 #home/#cases/#case/*/#project/#projects/#task/analysis/#report/#draft/#work/#assets/#delivery/#setup。
- 授权抽屉：打开、切换接单方式（WorkBuddy 未验证时 option disabled；模拟联合通过后 enabled）、确认外派、取消、Escape 关闭。
- 设置：核心四步模拟、WB 单项/联合模拟（联合须核心+单项前置，否则 toast 拒绝）、清除。
- 场景切换 14 种并实际走完其中 9 种授权后路径；重置演示。
- 弹窗：工单预览、授权快照、取消确认、API/Connector 检查结果；Escape 关闭验证。
- 390 汉堡菜单打开/Escape；暗色切换；1440/1024/390 resize。
- 资产读取失败反例披露展开（正常/越任务/错版本/撤回/离线/过期六选项；其实际拒绝行为属工程待实现，原型仅演示控制）。

## DOM/CSS 骨架与设计令牌（实测提取）

- 布局：180px 日常侧栏（OptraCall 标识/当前工作区/日常工作/基础建设总览/项目空间/设置与连接）；Case 内 240px 事项区（列表/树状图）；顶栏（面包屑+分析/决策+明暗+就绪 pill）；演示控制条（合成标注+场景下拉+重置，**仅原型，不入生产**）。
- 令牌：亮 `--ink:#292437 --muted:#787184 --purple:#7152c8 --deep:#4c337e --line:#e6e1ee --soft:#f2eefb --green:#28704e --amber:#98631c --red:#a64354 --surface:#fff`，bg `#f5f4f8`；暗 `--ink:#eee7f6 --muted:#b6a9c2 --purple:#b79af0 --deep:#d8c1ff --line:#45384f --soft:#352740 --green:#8bd6ac --amber:#e7c381 --red:#f0a2b1 --surface:#241c2c`，bg `#18131f`，topbar `#211a28`。
- 字体 14px/1.6 system-ui/PingFang SC；h1 29px(-.045em)/h2 18px/h3 14px/small 12px/eyebrow 11px；focus-visible 3px `#9a7de8` offset 3px。
- 抽屉 `.drawer`：fixed 右侧 540px、max-width 100vw、100dvh、圆角 14px 0 0 14px；390 全宽。居中弹窗用于确认/检查结果。
- 断点：1180/1130/860/760/620、min-1550、prefers-reduced-motion。
- 状态 pill 色系：绿=已接受/就绪，琥珀=待核/待处理/需决定/未验证，红=失败/取消待核，灰=未验证/未发布。
- 生产令牌对照（`daily-workspace.css`）：`--canvas:#f7f5fa --ink:#292636 --muted:#81758e --line:#e9e2f3 --accent:#7850d0` —— 与 Demo 同族，实现沿生产令牌，不搬 Demo 字面值。

## 生产映射

见同目录变更根 [ui-implementation-mapping.md](../../../ui-implementation-mapping.md)（页面/状态 → 视觉交互要求 → 现有差异 → 拟修改生产组件与真实数据接线）。

## 边界与未覆盖

- Demo 的演示控制条、场景下拉、模拟按钮、sessionStorage(v3)、合成人物/固定回复/`.invalid` 链接均为原型设施，不搬入生产。
- 本次为设计阅读，非真实产品验收；真实产品同视口对照在实现切片后另行执行并留证。
- 资产读取失败反例的实际拒绝、键盘 Tab 陷阱的逐键遍历未在本轮逐一项跑（Escape/焦点恢复已验）；工程实现以 spec AB07–AB10 负例测试覆盖。
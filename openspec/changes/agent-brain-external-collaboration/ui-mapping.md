# v0.2 UI 骨架与生产接线映射

本文件是静态原型准备记录。生产基线为 `main@74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`，准备分支合并点 `a194207`；本次没有修改或运行候选生产 UI。将来实施时仍须按工程规范实际浏览本冻结 Demo、读取 DOM/CSS、逐项对照同视口真实产品并完成开 PR 前截图确认。

## 已实际阅读的输入

- 已读最新 `AGENTS.md` 和工程规范「领取方的冻结 UI Demo 阅读与开发要求」「冻结基准逐项复核与 PR 前截图确认」、四原则与 UI 前置检查。
- 旧 v0.1 为 `e456aa5` 中的 `ui-demo.html`，SHA-256 `770fcd371694554df18a2a482f2c5170c8210dead488539d2d2561d640d54933`。修改前经实际 Chromium 从本机 HTTP 渲染了项目、原 Task、Case 与外派详情；作者实际查看了项目、Task、Case 截图，并读取其 DOM/CSS。原文件、截图和 DOM 样本分别保存在 `.local/agent-brain-main-update/ui/before-v0.1-*`、`before-*-1440.png` 与 `before-dom-css.json`，不覆盖旧 `.local/agent-brain-external-ui`。
- 已读 `src/host/ui/App.tsx`、`WorkspaceHome.tsx`、`HomeDailyQuickPanel.tsx`、`DecisionCaseTabs.tsx`、`CaseBoard.tsx`、`ProjectBoard.tsx`、`TaskReportDesk.tsx` 相关入口/返回源码，以及 `daily-workspace.css`、`case-daily-home.css`、`daily-case-current.css`、`daily-case-projects.css`、`daily-projects.css`、`daily-case-history.css`。当前未提供图查询工具，按 AGENTS 的允许条件退回 rg/文件读取。
- 作者用 `view_image` 实际查看了 main 已交付截图目录 `openspec/changes/decision-case-daily-workspace/evidence/ui-conformance/product-g/` 下的 `01-home-1440.png`、`03-case-current-1440.png`、`05-case-projects-1440.png`、`10-project-detail-1440.png`、`08-case-current-390.png`、`22-home-dark-1440.png`、`07-case-history-1440.png`；同时读取该目录 README 与对照说明。它们是既有产品的历史运行证据，来源构建/合成资料边界按其原回执保留。本次没有将这些历史截图或新版 Demo 截图称为本功能的真实产品截图。
- 更新后已再次实际渲染并查看 pilot 首页、Case 当前工作、项目与任务画面，按实际主次区域修正，而非仅改版本/基线文案。后续固定候选截图与作者结果位于新的 `.local/agent-brain-main-update/ui/`，具体文件摘要以本轮结果为准。

## 视觉与交互骨架

| 范围 | v0.1 实际旧画面/源码差异 | v0.2 要求与当前原型 | 当前 main / 拟生产组件 |
| --- | --- | --- | --- |
| U01 首页 | 默认落项目地图；没有真实日常工作层级 | 默认 `#home`，上方轻量问题草稿，下方主列为两个准确人的待回应/继续工作，右列为原项目外部等待/基础提醒。没有首页外派收件或新外派待办 | `WorkspaceHome`、`HomeDailyQuickPanel`、原 `home-pending` 投影保持；不新增外派首页模型 |
| U02 主导航 | 218px 侧栏把星图/项目地图作为平行一级入口，首页与星图同时指向简化 Case | 180px 紫黑侧栏；日常仅首页与 Decision Case。Case 总览/全部项目同级；Case/原项目是完整工作页，旧不可达视图函数已删除 | `App.tsx` sidebar；`DecisionCaseTabs`；`CaseBoard` / `ProjectBoard` |
| U03 当前工作 | 简化 Case hero + 两卡，没有事项导航与本轮主体 | Case 头部固定 G/S/状态，四页签；240px 左事项列表/树，右侧当前事项/轮次、本轮概览和已有 Case 草稿区。390 下保留事项选择器和可滚动事项浏览区域 | `CaseBoard`、`CaseIssuePanel`、`daily-workspace.css`、`daily-case-current.css`；不在 Case 受限会话中加外派工具 |
| U04 关联项目/任务 | 六宫格只显示用途，无明确 Case 辅助范围 | `#case/projects` 按当前事项/全部当前 Case/手选其他事项显示明确关联的原 Task 表；外派状态在原项目的准确原 Task 行及 Case 真实关联行作“拟新增”只读摘要，原任务运行状态另列 | `DailyCaseProjects` 的原任务行与 assignment.issue 过滤；拟新增 ExternalWork 摘要组件/读口，不增 Task 行、不改 Case/ProjectWork |
| U05 成果/历史 | 没有四页签，容易把外部成果混入 Case | `#case/artifacts` 只显示已有关联原报告 v0.3 与原映射；没有因接受而插入外部附件。`#case/history` 只回看原轮次与取舍/观察，选择历史事项不覆盖当前事项 | 原 `CaseArtifact` / 准确来源资格、`DailyCaseHistory`；ExternalDeliveryRef 只在原 Task 回读，新增关联须另沿原发布/关联合同 |
| U06 全部项目/详情 | 紫色 hero + 六宫格主导项目视图 | `#projects` 全页筛选/搜索列表；`#project` 共用工作信息、承接/下一步、关联 Case 和六类用途过滤表。数量来自本原型明确的 6 个原任务，不按六类用途补建 | `ProjectBoard`、`daily-projects.css`；项目工作信息/等待记录继续取原权威 |
| U07 Task/报告/草稿 | 外派主卡存在，但 Case 只有泛化返回 | 保留原 Task 会话/草稿/报告；来源浏览 origin 显式保存 Case、事项、页签、手选范围和触发点。Task/报告返回恢复对应原按钮焦点。独立打开清除浏览 origin，原 assignment 不变 | `App.boardTask/openHomeTask`、原 Task 报告/草稿组件；精确 origin 是本期待补差额，不能宣称 main 已完整携带 issue/tab/scope/focus |
| U08 授权抽屉 | 一次授权已具备 | 继续按目标、片段范围/禁做项、指定执行者、私有仓库、预选可缩小资产和期限及已配置资源/费用快照预览，一次确认；取消零外派。Tab/Escape 与焦点返回保持 | 拟 Task ExternalWork 授权抽屉；复用原连接/权限选择，普通流程无凭据/机器 ID |
| U09 工作详情 | 外派通信、领取、交付、验收已分开 | `#work` 原 Task 内分 Host 台账与 GitHub 通信；正常在一次授权后自主推进，不要求用户每次点击接受。只新增可选暂停/恢复续接，Task 卡与详情均可达 | 原 Task owner + 新工作台账/外派 port；共享原 Runtime，不新增会话循环 |
| U10 资产 | 版本/权限/读取错误已具备 | `#assets` 保留四类准确版本、出处/范围与读取记录，反例错误不覆盖原结果；实际采用须授权与实际读取均成立 | 原资产读口 + 拟受保护远端 MCP 适配；原实例在线与两组权限按 spec，原型不证明服务已部署 |
| U11 交付/候选 | 前轮三项 P2 已修复 | 正常 v1.0、同 work 补充 v1.1；逐件模拟字节/摘要保全，缺件/仅链接不接受，排除 mapping 保留未取用/未核验限制。外部来源不冒 native，候选不发布 | 新 ExternalDeliveryRef/保全 + 原 Task Agent 保存工具/候选流程；不自动成为 CaseArtifact |
| U12 首次接入 | API/MCP/完整联通三项门槛已具备 | `#setup` 分别展示本机 API 授权在线、MCP Connector、已批准资源策略、完整协作联通；模拟通过只放行原型，真实联用仍未验证 | 原消费者连接设置 + 拟 WorkBuddy 本机助手官方 API 适配/受保护 MCP 入口；云任务不做 |
| U13 异常 | 前版完整合成状态 | 保留 UNKNOWN 只查回执、重复领取、补充、busy/暂停、范围介入、身份/离线/到期、缺件失败、取消/迟到、同执行器等待。外部接受不回写人的待回应/观察/目标实绩/Case 轮次 | 原 Task stop/owner/续接 + 新持久状态；真实原子性、租约、安全与实号边界均待工程验证 |
| U14 视觉/键盘 | v0.1 有亮暗三宽度证据，不能沿用为新版通过 | 新版按 1440/1024/390 明暗重新渲染，查看首页/Case/项目/Task/交付；表格限定容器横向滚动，页面无横向溢出；模态 Tab/Escape、准确返回焦点单独检查 | 当前 main 令牌/响应式 + 新拟组件；最终真实产品须同视口对照与用户截图确认 |

浅色令牌按 main 当前日常布局取 `canvas #f7f5fa`、`ink #292636`、`muted #81758e`、`line #e9e2f3`、`accent #7850d0`，侧栏 `#1e1928`、180px，顶栏58px。Case 左事项240px；1440 的内容横向留白约32–38px。1024 合并首页主次列；390 收起全局侧栏、改入口菜单，Case 导航保留选择器与列表/树，原任务表格在自身容器滚动。深色用独立 canvas/surface/line/accent，不拿浅色图代深色验收。页面顶部的版本/合成演示控制条是设计审核辅助，不要求搬入生产产品。

## 来源与状态规则

- `PENDING` 中的 choose/observe 是明确的两条合成既有原请求，来源/轮次/承担人可回看。Demo 不保存回应；外部交付和接受不改变它们。首页进展关注保持原项目的等待反馈记录，本期不写新的首页 ExternalWork 投影。
- 只有 Case 页明确点击原任务时，UI 浏览 origin 才记录返回路径；独立任务入口不携带该 origin，也不把它当数据权限。原 Task 的实际事项 assignment 始终保持。返回来源 Case 和查看原关联 Case 是不同动作：前者恢复浏览位置，后者定位原 assignment 对应事项。
- 现有 main 的 sourceCase/report-return 还没有完整携带 issue/tab/scope。原型的准确恢复属于本期拟补 UI/状态差额；生产实现须重核准确源资格与原对象，不允许猜最新/首个 Case 事项。
- v0.2 只使用 `optracall.external-collaboration.demo.v2` sessionStorage 命名空间，保留旧 v1，不将其作为产品迁移合同。当前草稿/视图/场景都是合成原型状态，失败时回落内存。
- Case 草稿区只展示并保留合成文字；不启动 Case/目标专属受限会话，不在其增加外派权限。真实业务、模型、MCP、GitHub、WorkBuddy、产物下载及持久安全均未实现。

本原型只准备既有工作的一条代表路径：一个 Case、三个事项、一个项目、六个已有 Task；不是完整复制 main 的所有管理/创建功能。原入口按需提供说明，浏览不新建 Task/Case。正式实施不能将这些合成数据、固定回应请求、模拟保全回执或 sessionStorage 搬成产品业务设施。

资源/费用快照是本轮追加的环境约束：模拟预设1片段、最多3次执行者API触发（含修订，已提交/触发UNKNOWN计额，不盲重试）、24h窗口；费用沿已批准账号策略，未知不表示免费。未配策略不允许自主触发。此约束不规定业务返工次数，不新增日常必填。当前候选与实际检查结果身份见 demo-notes 及作者结果，不沿用旧241项冒充追加后的通过。

最终背景增量身份：`59b9bbdb70414a8909e0c4b9ea2386b68f56d8638d5c1c39ebff5c4922b6bb17` 仅在 `6946bc7744365bdf19f41bb135248693372a4e1be5152bd9a7c0065984cfe060` 上追加root背景CSS；DOM/JS字节不变。最终亮暗短页三宽度24组截图/颜色检查另证，不冒充重新跑过全部交互。详见demo-notes及background-fix-identity.json。

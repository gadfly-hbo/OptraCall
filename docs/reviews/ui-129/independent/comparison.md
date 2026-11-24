# OptraCall 前端视觉改版 · 现状对照表与实测验证记录（Issue #129 独立方案）

> **基线仓库**：`gadfly-hbo/OptraCall` · 分支 `main` · 实际设计基线 SHA：`7ef6ebb81b735ffecdad3753217a96f02cb95c76`（含 `#127`）
> **对照 PM v0.2 基线（`2f79a34`）差异**：`2f79a34..7ef6ebb` 仅 1 处前端 UI 变更（`src/host/ui/StudioMemberPackPanel.tsx` +13 行，新增 `purposeKeys`、`periodFrom`、`periodTo` 授权字段与表格范围列展示），不影响 10 页总体布局对比；整合落地时需核对 Studio 体系工作台会员包授权表单与表格呈现。
> **对应规格**：[spec.md](./spec.md)
> **可点击 Demo**：[demo/index.html](./demo/index.html)（纯静态单文件，零依赖，拉取分支或下载单文件后直接用浏览器打开即可离线交互）

---

## 0. Demo 打开方式与快速核验路径

- **本机打开**：检出分支 `review/ui-129-independent` 后直接打开 `docs/reviews/ui-129/independent/demo/index.html`（或单独下载该 HTML 文件双击打开）。
- **闭环 1**：默认进入「项目地图」→ 点击 `Q3 会员分层与流失归因分析` → 在分析任务点击 `查看报告与依据` → 点击 `查看关联 Case` → 在 Case 详情抽屉点击 `按此 Case 继续` 返回原分析任务。
- **闭环 2**：侧栏进入「战略选择」（默认停在 `战略发布`）→ 点击 `带入目标管理 →` → 弹窗确认 → 自动跳入「目标管理 · 核对与采用」→ 点击 `核对并采纳此版本`。
- **资产 / 设置 / 帮助 / 主题**：切换「语义资产」（4 标签）、「分析资产」（3 标签）、「设置」（9 分类）、「决策看板」、「帮助」及右上角深浅色切换；缩窄浏览器宽度至 `390px` 可测窄屏浮层侧栏与右滑抽屉。

---

## 1. 逐页现状对照表（全局壳层 + 全部 10 个正式页面）

| 页面 / 模块 | 当前正式产品表现（基线 `7ef6ebb8`） | 本方案设计取舍 | 对应源码位置（只读核对） | Demo 入口与交互路径 | 验收方式与对应条号 |
| --- | --- | --- | --- | --- | --- |
| **全局壳层（侧栏 / 顶栏 / 主题）** | 画布与卡片同为 `#fff`，仅靠 1px 灰框分隔；窄屏（`≤760px`）侧栏以垂直流占 `max-height: 45dvh` 挤压主区；`.primary-button` 在窄屏全局拉宽 100%。 | 保留原版双圆 Logo 与 `#6550c9` 主紫；引入微紫中性画布 `#f6f5fa` 托举白色卡片；侧栏激活态增加左侧 `3px` 紫竖条；窄屏侧栏改为左滑浮层抽屉 + 遮罩，不再挤压主区。 | `src/host/ui/App.tsx#L773-L793`<br>`src/host/ui/BrandMark.tsx`<br>`src/host/ui/favicon.svg`<br>`src/host/ui/ProjectNavigation.tsx`<br>`src/host/ui/styles.css#L10-L45,L144-L146` | 打开 `demo/index.html`；右上切换深浅色；`390×844` 点击左上侧栏按钮展开抽屉。 | `AC-01`、`AC-02`、`AC-03`、`AC-05`、`AC-14`、`AC-15` |
| **1. 战略选择** | `.si-topbar` 将事项/范围选择器、按钮及右侧占位混排；检验通过徽章（`.si-badge-positive`）与品牌紫同色，语义区分不足；标签与卡片间距较松散。 | 事项与范围收敛为独立白底上下文条，占位按钮归至页头次级操作；因果/逻辑双检验用独立语义绿（`--success`）区分通过态；战略发布突出树形地图/条目表与「带入目标管理 →」主按钮。 | `src/host/ui/StrategyGoalsPage.tsx#L420-L426`<br>`src/host/ui/ManagementTabs.tsx`<br>`src/host/ui/StrategyInitiativeWorkbench.tsx`<br>`src/host/ui/StrategyInitiativeGovernance.tsx`<br>`src/host/ui/strategy-initiative.css` | 侧栏「战略选择」或 `#strategy/strategy-release`；点击 4 个标签与「带入目标管理」。 | `AC-04`、`AC-09`、`AC-14` |
| **2. 目标管理** | 列表、详情与讨论垂直堆叠较长；战略发布交接后缺少显眼的顶部引导横幅与待核角标；原版与候选版本差异对比视觉权重偏平。 | 顶部新增战略带入柔和紫底提示条与「核对与采用」计数角标；采用紧凑总表 + 下方详情卡结构；「核对与采用」以左右双栏对比盒区分原已采纳版与本次候选 G/S。 | `src/host/ui/StrategyGoalsPage.tsx#L420-L457`<br>`src/host/ui/GoalItemsTable.tsx`<br>`src/host/ui/strategy-goals.css` | 从战略发布点击「带入目标管理」自动跳入，或侧栏「目标管理」 / `#goals/adopt`。 | `AC-04`、`AC-09`、`AC-14` |
| **3. 决策星图** | 星图画布与三类节点（Case / 项目 / 任务）视觉区分偏弱；常规方块模式 `.case-card` 写死 `height: 360px` 易产生留白或截断；Case 详情页首屏返回原任务入口位置偏深。 | 星图画布加点阵背景，节点顶部按类型着色（紫 Case / 蓝项目 / 绿任务），缩放控制悬浮右下角；常规卡片改为弹性高度；Case 详情抽屉首屏置顶「当前关联分析任务」高亮条（含 `打开原任务` / `按此 Case 继续`）。 | `src/host/ui/CaseBoard.tsx`<br>`src/host/ui/CaseStarMap.tsx`<br>`src/host/ui/case-board.css#L17-L127` | 侧栏「决策星图」或 `#cases`；可切「星图 / 常规（方块/列表）」，点击节点或 `#cases/detail` 打开详情抽屉。 | `AC-04`、`AC-08`、`AC-12`、`AC-14` |
| **4. 项目地图** | `.case-project-card` 使用 7 行定高 Grid（`min-height: 420px`），任务列表较紧凑，项目卡片内直接跳往关联 Case 的视觉线索较弱。 | 改为内容自适应白底卡片，任务项升级为整行高亮可点击条（标明 `打开原任务 ↗` / `运行中 ↗`），卡片同时提供 `关联 Case ↗` 与详情抽屉入口。 | `src/host/ui/ProjectBoard.tsx`<br>`src/host/ui/case-board.css#L156-L185` | 默认首页或侧栏「项目地图」 / `#projects`；支持方块/列表切换与归档筛选。 | `AC-04`、`AC-06`、`AC-14` |
| **5. 语义资产** | 页头右侧企业选择器、标签栏与内容表格边框样式偏杂；正式资产与候选资产状态标签对比度偏弱；待核归属折叠区样式朴素。 | 与「分析资产」统一页头、企业选择器、下划线标签与清爽表格卡；资产版本使用等宽胶囊，资格使用语义绿/琥珀区分；提供只读准确原文抽屉。 | `src/host/ui/StudioPage.tsx#L619-L647`<br>`src/host/ui/StudioLibraryTabs.tsx`<br>`src/host/ui/studio.css` | 侧栏「语义资产」或 `#semantic`；切换 4 标签（业务语义/数据映射/企业资料/体系工作台）并点击「查看准确资产」。 | `AC-04`、`AC-10`、`AC-14` |
| **6. 分析资产** | 与语义资产共用 Studio 容器但「体系工作台」缺少首屏摘要密度，子视图切换与筛选工具条层级略平。 | 与语义资产完全同源的视觉规范；在「体系工作台」补充 3 栏 KPI 摘要卡并保留「覆盖与缺口 / 建设与演进 / 发布与使用」分段切换。 | `src/host/ui/StudioPage.tsx#L619-L647`<br>`src/host/ui/SapMethodsPage.tsx`<br>`src/host/ui/studio.css` | 侧栏「分析资产」或 `#analytics`；切换 3 标签（分析指标/分析方法/体系工作台）。 | `AC-04`、`AC-10`、`AC-14` |
| **7. 设置** | 9 个设置分类（`使用用途` 至 `领域资产包`）横排在单行 `.catalog-tabs` 中，常规桌面与窄屏均发生横向溢出遮挡，难以一眼扫清全部 9 项。 | 桌面（`>960px`）改为左侧 `216px` 纵向分类导航轨（按 3 个轻标题视觉分组，9 项全显、零隐藏）；窄屏（`≤960px`）切为横滑胶囊栏；右侧表单限宽 `780px` 并保留「← 返回原页面」。 | `src/host/ui/App.tsx#L794-L828`<br>`src/host/ui/ModelSettings.tsx`<br>`src/host/ui/UsageContextSettingsPage.tsx`<br>`src/host/ui/CapabilitySettings.tsx`<br>`src/host/ui/styles.css#L98-L143,L253-L256` | 侧栏左下「设置」或 `#settings`；逐一切换全部 9 个分类并点击「← 返回原页面」。 | `AC-04`、`AC-11`、`AC-14`、`AC-15` |
| **8. 分析任务** | 顶部 4 步导航（`min-height: 70px`）+ 上下文区 + 底部多重工具与 5 个自动开关垂直堆叠过重，挤压对话视口；中屏（`≤1100px`）打开项目文件时直接 `display: none` 隐藏主对话区。 | 4 步条压缩为单行紧凑步骤轨（窄屏 `2×2`）；对话流以 `820px` 卡片呈现并内嵌「已保存正式报告条」；右侧整合为统一三标签抽屉（`项目文件 / 报告与依据 / 审查结论`），中/窄屏以浮层滑出不销毁主区；底部工具托盘按需折叠。 | `src/host/ui/App.tsx#L722-L763,L837-L853`<br>`src/host/ui/TaskWorkflow.tsx`<br>`src/host/ui/ProjectSpace.tsx`<br>`src/host/ui/ConclusionReviewPanel.tsx`<br>`src/host/ui/styles.css#L159-L231` | 点击任一项目任务或顶栏「分析」 / `#task` / `#task/evidence`；点击「查看报告与依据」及「查看关联 Case」。 | `AC-04`、`AC-06`、`AC-07`、`AC-08`、`AC-15` |
| **9. 决策看板** | 统计卡、报告区与三栏泳道层次较平，卡片信息块密度偏松，从项目报告回溯原报告计算依据缺少直接快捷按钮。 | 升级 3 栏等宽数字 KPI 卡与四色语义证据徽章（数据支撑绿/多源蓝/逻辑琥珀/经验灰）；报告行新增「查看原报告依据」直达任务报告抽屉；窄屏泳道单列堆叠。 | `extensions/business-plugins/decision-board/ui/DecisionBoardPage.tsx`<br>`extensions/business-plugins/decision-board/ui/decision-board.css`<br>`src/host/ui/styles.css#L294-L310` | 顶栏「决策」或 `#decision`；测试筛选、展开报告引文、采纳建议与标记完成。 | `AC-04`、`AC-12`、`AC-14`、`AC-15` |
| **10. 帮助** | 桌面左侧 TOC 与右侧正文均直接落在纯白背景上，边界感偏弱；阅读宽度与提示卡片层次可更清晰。 | TOC 与正文装入独立白底卡片（正文限宽 `760px`），提示块配主紫左侧强调线；窄屏（`≤960px`）自动切为顶部章节 `<select>` 选择器。 | `src/host/ui/HelpPage.tsx`<br>`src/host/ui/help-page.css` | 顶栏右上「帮助」或 `#help`；切换目录章节、上下章分页及「返回原页面」。 | `AC-04`、`AC-13`、`AC-14`、`AC-15` |

---

## 2. 模拟行为与未验证项声明（Demo Boundary）

为了供 PM 与用户准确评估，明确标注以下演示边界与未验证范围：

### 2.1 Demo 中的模拟行为（仅内存静态演示）
1. **全部数据为虚构样例**：企业「星岚零售（虚构）」「云杉餐饮（虚构）」、门店/会员数据、报告 SHA-256 与策略指标均为纯虚构，不含任何真实经营数据或真实凭据。
2. **内存状态流转**：战略带入目标、目标采纳、决策看板「采纳建议 / 标记完成」、分析任务发送追问均在浏览器内存中即时变更，刷新页面恢复初始态，不写入本机 SQLite / JSONL / 磁盘文件。
3. **占位与只读反馈**：新建项目、新建任务、上传文件、导入 Pi 凭据、连接测试、撤销发布、下载完整手册及需求梳理等子弹窗在 Demo 中以 Toast 提示说明边界，未复刻全部后端表单校验与长流程子插件（如 PPT 逐页精修、经营推演 SimLab）。

### 2.2 本阶段未验证项（留待正式工程发单后验证）
1. **真实产品 React 组件集成与回归**：尚未修改 `gadfly-hbo/OptraCall` 源码，未运行产品 `npm run check`、既有单测、真实 Host API 或 Pi SDK 流式事件渲染。
2. **超长/极端真实内容压力测试**：超长 Markdown 宽表格、上百节点决策星图画布、超长文件名及并发 SSE 流式输出中的滚动锚点表现，需在工程实施阶段用真实合成数据集回归。
3. **跨操作系统字体渲染与 Safari/macOS 实测**：本轮实测在云端 Ubuntu Linux + Headless Google Chrome 完成；macOS Safari / Chrome 下 `PingFang SC` 字体微调与高 DPI 滚动条样式需在产品实施后复核。

---

## 3. 实测验证结果与桌面 / 窄屏截图

### 3.1 自动化实测摘要（Playwright + Headless Google Chrome）
- **实测环境**：Linux Ubuntu 24.04 · `/usr/bin/google-chrome` · Playwright Python
- **实测视口**：桌面 `1440×900`（DPR 1.5）与窄屏 `390×844`（DPR 2.0）
- **实测结果**：**28 / 28 项通过，0 失败，0 Console/Page 报错**
  - 对话署名行（原双圆 Logo + `OptraCall` + 对应会话模型名）：**PASS**
  - 闭环 1（`项目地图 → 原分析任务 → 已保存报告与依据 → 关联 Case 详情 → 返回原分析任务并带入 Case 背景`）：**PASS**
  - 闭环 2（`战略选择 → 战略发布 → 带入目标管理 → 目标管理核对与采用 → 确认采纳`）：**PASS**
  - 两类资产切换（`语义资产` 4/4 标签 + `分析资产` 3/3 标签）：**PASS**
  - 设置全部 9 分类切换（9/9）与返回原页面：**PASS**
  - 桌面与窄屏全页面横向零溢出断言（`scrollWidth <= innerWidth`）：**PASS**

### 3.2 桌面实测截图（`1440×900`）

| 场景 | 实测截图 |
| --- | --- |
| **项目地图（闭环 1 起点）** | ![项目地图桌面截图](./screenshots/desktop_01_projects.png) |
| **分析任务 + 已保存报告与依据抽屉（闭环 1 中段）** | ![分析任务与报告依据桌面截图](./screenshots/desktop_03_task_evidence.png) |
| **决策星图 · Case 详情抽屉（闭环 1 关联 Case → 原任务）** | ![Case 详情抽屉桌面截图](./screenshots/desktop_04_case_detail.png) |
| **决策星图画布（三层实体节点着色）** | ![决策星图画布桌面截图](./screenshots/desktop_05_starmap.png) |
| **战略选择 · 战略发布（闭环 2 起点）** | ![战略发布桌面截图](./screenshots/desktop_06_strategy_release.png) |
| **目标管理 · 核对与采用（闭环 2 承接核对）** | ![目标管理核对桌面截图](./screenshots/desktop_07_goals_adopt.png) |
| **语义资产（4 标签 + 准确版本表）** | ![语义资产桌面截图](./screenshots/desktop_08_semantic_assets.png) |
| **分析资产（3 标签 + 指标/方法表）** | ![分析资产桌面截图](./screenshots/desktop_09_analytics_assets.png) |
| **设置（左侧 9 分类纵向导航轨）** | ![设置桌面截图](./screenshots/desktop_10_settings.png) |
| **决策看板（KPI + 报告抽取 + 三泳道）** | ![决策看板桌面截图](./screenshots/desktop_11_decision_board.png) |
| **帮助（Sticky 目录 + 阅读白纸卡）** | ![帮助桌面截图](./screenshots/desktop_12_help.png) |
| **深色模式验证（分析任务 + 项目文件）** | ![深色模式桌面截图](./screenshots/desktop_13_task_dark.png) |

### 3.3 窄屏实测截图（`390×844`）

| 场景 | 实测截图 |
| --- | --- |
| **窄屏 · 项目地图（零溢出单列卡）** | ![项目地图窄屏截图](./screenshots/narrow_01_projects.png) |
| **窄屏 · 左滑侧栏浮层抽屉（不再挤压主区）** | ![侧栏抽屉窄屏截图](./screenshots/narrow_02_sidebar_drawer.png) |
| **窄屏 · 分析任务（2×2 步轨 + 单行发送栏）** | ![分析任务窄屏截图](./screenshots/narrow_03_task.png) |
| **窄屏 · 报告与依据右滑浮层抽屉** | ![报告依据窄屏截图](./screenshots/narrow_04_task_evidence_drawer.png) |
| **窄屏 · 战略选择（战略发布）** | ![战略发布窄屏截图](./screenshots/narrow_05_strategy.png) |
| **窄屏 · 设置（横滑 9 分类胶囊栏）** | ![设置窄屏截图](./screenshots/narrow_06_settings.png) |
| **窄屏 · 决策看板（单列 KPI 与泳道）** | ![决策看板窄屏截图](./screenshots/narrow_07_decision.png) |
| **窄屏 · 帮助（章节下拉选择器）** | ![帮助窄屏截图](./screenshots/narrow_08_help.png) |

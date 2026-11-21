# 战略地图多格式导入：Agent 主动提取与原稿对照核对（OpenSpec）

- **关联 Issue**：[#106](https://github.com/gadfly-hbo/OptraCall/issues/106)（参考已交付基线 [#98](https://github.com/gadfly-hbo/OptraCall/issues/98)）
- **当前阶段**：第一阶段 · 设计与界面待审（Spec + 可点击 Demo，尚未实施产品代码）
- **任务分支**：`work/antigravity/issue-106-strategy-map-import`
- **基线提交**：`4b8ad9b0b74390b55b580d92fdf69c292f90d0f8`
- **依据规范**：`AGENTS.md`、`docs/engineering-workflow.md`（v1.12）、`docs/agent-session-integration.md`（Interface v3）、锁定官方 Pi SDK `1.4.0`
- **可点击 Demo**：[`clickable/index.html`](clickable/index.html)（离线单文件，合成资料与内存状态演示）

---

## 1. 用户目标与范围边界

### 1.1 目标
用户在线下已讨论好战略图（Excel、PowerPoint、PDF 或图片）。在原战略讨论或战略地图中选择文件（或直接复用已获准的讨论附件／项目文件）后，由原战略 Agent 主动读取文字、原生结构或渲染图面，提取目标（G）、策略（S）、指标数值与连线关系，生成带精确原稿出处的**可编辑候选地图**；用户对照原稿，一键批量保留清楚项，只纠正有疑问的局部，保存为战略地图版本。

### 1.2 保留既有能力（不回归）
- 保留 [#98](https://github.com/gadfly-hbo/OptraCall/issues/98) 已交付的「结构化 Excel 快速列映射导入」「仅含图形工作簿的原稿留存与人工核图」「战略地图三种视图（条目表／目标与策略树／BSC）」「版本与来源追溯」「带入目标管理」「独立采用及按具体 G/S 建 Case」。
- 保留原讨论「＋ 添加资料」的普通参考附件用途，不混淆普通参考资料与战略地图导入。
- 保留原会话、旧版战略地图、已采用目标及既有 Case 数据，不回填或覆盖历史记录。

### 1.3 明确不做事项（Non-Goals）
- 不自建第二套 Agent Runtime、并行会话管理器或硬编码 OCR／图形规则管线。
- 不升级、替换或修改官方 `@earendil-works/pi-coding-agent`（锁定 `1.4.0`），不绕过官方公开契约。
- 不因导入候选而自动采用目标、自动创建 Case 或触发经营执行动作。
- 不在公开仓库提交真实客户战略图、凭据或原始会话；测试与 Demo 仅使用合成资料。

---

## 2. 四类输入格式与来源定位契约

| 输入格式 | 必须覆盖的内容形态 | Host 提供的只读解析与渲染 | 精确来源定位（`SourceLocation`） | 冲突与不确定处理 |
| --- | --- | --- | --- | --- |
| **Excel (`.xlsx`)** | 1. 结构化表（保留快速列映射）<br>2. 原生形状、SmartArt、嵌入图片、图表混排 | 复用 `xlsx`、`jszip`、`saxes` 读取单元格、公式/缓存值、绘图 XML（`xl/drawings/*`）、SmartArt 文本与嵌入媒体；需要视觉核图时由本机渲染页图 | 工作表名 + 行列（如 `目标表!D4`）、绘图对象 ID／名称（如 `战略图 · 形状#3`）或嵌入图区域框（`bbox`） | 源表单元格与图上数值不一致时，**并列保留两个原值与出处**，标为待核对，不静默择一 |
| **PowerPoint (`.pptx`)** | 外部演示文稿；按真实页序处理原生文字、组合形状、连接符（`cxnSp`）、SmartArt 与整页截图 | 复用 `jszip` + `saxes` 读取按真实页序排列的文字、形状坐标与连接符端点；复用 `extensions/analysis-assets/ppt-report/scripts/page_images.py`（LibreOffice + pypdfium2）渲染整页图与缩略图 | 页号（`第 N 页`）+ 形状/连接符 ID 或归一化原图坐标框（`x, y, w, h`） | 允许用户只选含战略图的页；多页含不同方案时保留各自方案边界；跨页同名节点的关系标为待核对 |
| **PDF (`.pdf`)** | 纯文字页、纯扫描页、图文混合页 | 复用 `pdfjs-dist` 提取文字层及文本项位置；对扫描页或图文混合页按需渲染页图供视觉模型读取 | 页号（`第 N 页`）+ 文字段位置或归一化原图坐标框（`bbox`） | 低清、裁边、方向不明或无文字层时允许局部标为「待核对」，不强行编造 |
| **图片 (`.png` / `.jpg` / `.jpeg`)** | 线下白板照片、导出的战略图 | 保留原始字节、尺寸与 EXIF 方向（只读校验与归属保存），不破坏原始像素 | 原图文件名 + 原始像素/归一化区域框（节点回到原框；连线记录起点框、终点框与箭头区域） | 箭头被遮挡、方向不明或字迹模糊时，仅该节点/连线标为待核对 |

### 2.1 语义提取与数值保真要求
- **关系类型严格区分**：`decomposition`（分解／归属）、`supports`（支持／贡献）、`upstream`（上游策略）、`hypothesis`（待验证因果）、`unknown`（未知关系／方向待核）。**可见箭头不等于因果**，未给出机制或依据的箭头默认标为 `supports` 或 `unknown`，不自动升级为已证实因果。
- **数字口径保真**：清晰区分 `baseline`（基线）与 `target`（目标）、`baselineKind`（`estimated` 估计／`measured` 实测／`pending` 待定）、数值 `0` 与 `待定`（空/未知）以及 `unit`（单位）和 `period`（时段口径）。
  - 例（验收基准样例）：第 4 页「首购后 60–90 天分层培育」指向「提高新客 90 天二购率」，图中标注「约 9%」→ 提取为 `baseline: "9%"`、`baselineKind: "估计基线"`、`target: ""`（显示「待定」），不把「约 9%」误作年度目标。
- **多方案与跨页边界**：同一文件中不同页表示不同方案（如方案 A / 方案 B）时，保留各自页域与候选边界，不自动混拼为一张图；跨页出现同名节点时，其跨页关联默认标为待核对。

---

## 3. 统一会话接入与 IN01–IN07 契约

- **规则与接口版本**：`docs/engineering-workflow.md` v1.12，统一会话 **Interface v3**（`src/host/agent-sessions.ts`），官方 Pi SDK **1.4.0**（`src/agent/runtime.ts`）。
- **Owner 与 Profile**：完全复用现有 `strategy-discussion` 域（`createStrategyDiscussionHost` 内静态注册的 `strategy-discussion` domain/profile），真实 owner 为 `StrategyDiscussion.id`（可选关联 `projectId`），不新增第二个会话域或平行 Runtime。
- **模型图文能力与降级策略**：
  - 复用 `src/agent/runtime.ts` 已有的 `modelSupportsImages(configuration)`，结合当前讨论绑定的模型配置核对是否支持图片输入。
  - **支持图片输入**：Host 按授权将所选页图／原图随原 Pi 会话工具结果或用户消息交付给 Agent，由 Agent 自主结合文字结构与图面理解提取候选。
  - **仅支持纯文本**：Host 不阻断流程，也不静默切换未授权模型；先交付可核对的文字层、表格、原生形状与连接符信息供 Agent 提取初稿；对需要视觉识别的扫描页／图片／遮挡区域，明确提示用户「当前模型仅支持文字，可切换已配置且获准的视觉模型重读，或直接对照原稿手工核对」。
- **工具契约最小扩展（`strategy_goals`）**：
  - 复用现有 `strategy_goals` 工具（`src/agent/strategy-discussion.ts`），沿 `read-source` / `read-map` / `save-map` 扩展最小只读与保存能力：
    - 扩展只读导入来源查看（如 `read-import-source` 或复用 `read-source` 支持多格式页序摘要、原生形状/连接符清单与按页图像读取，受当前讨论来源授权与撤权校验约束）。
    - 扩展 `save-map` 接受可选的节点/连线出处定位（`sourceLocations`）、待核标记（`reviewState` / `ambiguityReason`）与数值冲突并列项（`sourceConflicts`），服务端校验出处 token／文件指纹归属当前获准来源。
- **IN01–IN07 核对要点**：
  - IN01/IN02：域注册与 `SessionRef` 构造留在 `src/host/strategy-discussion-host.ts`，前端仅通过 HTTP 业务入口调用。
  - IN03：共用 `strategy-discussion` 公共生命周期，启动、占用（busy）、取消、关闭、配置变更与代际检查均走同一公共入口；不新增平行 busy Map 或后台轮询队列。
  - IN04：多格式解析、出处校验、提取候选投影与人工核对编辑留在战略业务适配器。
  - IN05：所有文件字节读取、项目文件权限校验、撤权检查与模型凭据解析留在 Host；撤权后立即拒绝后续读取与外发，不接受客户端传入任意磁盘路径。
  - IN06：变更集中在战略地图导入与讨论接缝，由 Codex 最终核对集成与维护。
  - IN07：正式实施阶段须通过 `npm run check`（含 `check:agent-sessions`）、单测、合成 Provider 集成测试及浏览器桌面/窄屏点验。

---

## 4. 四点产品原则前置检查

按 `docs/engineering-workflow.md` 第 2、3 节要求，沿用户实际目标走查正常、失败与恢复路径：

| 原则维度 | 实际分工与核查结果 |
| --- | --- |
| **Host 管环境** | Host 负责：来源选择与权限校验（讨论附件／已关联项目文件／本地上传）、原文件字节与 SHA-256 指纹留存、只读结构解析与本机页图渲染、撤权即时阻断、模型视觉能力检测、地图版本 CAS 乐观锁与过期结果保护。Host **不做**业务语义判断、不硬编码「节点/箭头识别规则」替代 Agent。 |
| **Agent 自主执行** | 原战略 Agent 在授权范围内自主决定：先读结构化文字还是看整页图、识别哪些是目标/策略/指标、判断关系类型（区分支持与待验证因果）、发现图/表矛盾并并列原值、对遮挡/低清处主动标注待核；用户自然语言要求「重读第 4 页」或「重读某条线」时，Agent 自主局部核查并只修订指定项。 |
| **优先复用 Pi 已有能力** | 复用锁定官方 Pi SDK `1.4.0` 的多模态图文消息/工具结果传递、`modelSupportsImages` 能力目录、`strategy-discussion` 统一会话（Interface v3）及取消/重试边界；复用现有 `xlsx`、`jszip`、`saxes`、`pdfjs-dist` 与 `extensions/analysis-assets/ppt-report/scripts/page_images.py`。**缺口与最小适配**：现有附件解析仅支持纯文本提取且不输出 PPT/图片/坐标框，因此仅在 Host 补齐只读多格式解析与页图渲染薄层，以及地图候选的出处定位与待核字段。 |
| **减少人的操作** | **最简正常路径（3 步）**：1) 选文件（已上传的附件/项目文件免重复上传；多页 PPT 可选只勾含图页）→ 2) 等 Agent 生成带出处候选，一键「批量保留全部清楚项」→ 3) 只纠正标黄的歧义项，点「保存候选版本」。<br>**不增加的非必要操作**：无需用户预先重绘、无需逐条确认清楚项、无需手动填机器 ID 或坐标；普通保存不弹窗强迫选择目标采用或建 Case。<br>**必要确认保留**：保存新版本、带入目标管理、正式采用目标、纯文本模型下显式切换视觉模型，均保留用户主动确认。 |
| **失败与恢复路径反例核对** | 1) **同名换版**：按文件 SHA-256 绑定出处，原版保留，换版后提示指纹变化并保护人工修改。<br>2) **撤权**：撤权后停止继续读取与发往模型，已保存版本保留只读历史记录。<br>3) **取消/重复请求**：沿用 `operationId` 幂等去重，重试不重复造图；取消后不写入半成品。<br>4) **版本冲突/过期结果**：Agent 晚到结果或并发编辑触发 `expectedVersion` CAS 冲突，保留人工输入供对比，不静默覆盖。<br>5) **渲染环境缺失**：本机无 LibreOffice/pypdfium2 时，`.pptx` 仍可读取原生文字/形状/连接符并明确提示缺少整页图渲染环境，不静默失败或假报完整视觉识别。 |

---

## 5. 数据结构与持久化增量（向后兼容）

沿用 `src/host/strategy-map-store.ts` 与 `src/host/strategy-map-types.ts`，全部新增字段均为**可选字段**，完全兼容旧版 JSON 地图与既有工作簿导入记录：

1. **多格式来源清单（扩展 `StrategyMapImportSource` 或新增可选 `importSources`）**：
   - `sourceId`: 讨论附件或导入原件标识
   - `format`: `'xlsx' | 'pptx' | 'pdf' | 'image'`
   - `fileName`, `sha256`, `origin`: `'upload' | 'discussion-attachment' | 'project-file'`（记录本机归属，不暴露绝对磁盘路径到公开接口）
   - `selectedPages?: number[]`（PPT/PDF 选定页号，保留多页方案边界）
   - `imageMeta?: { width: number; height: number; orientation?: number }`
   - 保留既有 `sheets` / `rows` 字段以 100% 兼容 #98 结构化 Excel 导入。
2. **节点与连线的精确出处与待核状态（可选扩展 `StrategyMapNode` / `StrategyMapEdge`）**：
   - `sourceLocation?: { sourceId: string; page?: number; sheet?: string; row?: number; cell?: string; objectId?: string; label: string; bbox?: [number, number, number, number]; fromBbox?: [number, number, number, number]; toBbox?: [number, number, number, number]; arrowBbox?: [number, number, number, number] }`
   - `reviewState?: 'clear' | 'needs-review' | 'confirmed'`
   - `ambiguityReason?: string`（如「箭头被右下角贴纸遮挡」「源表 D4 与图上数值不一致」「第 2 页局部低清」）
   - `sourceConflicts?: Array<{ field: string; values: Array<{ value: string; label: string; locationLabel: string }> }>`（用于并列展示源表与图上不同原值）
3. **连线类型扩展（`mapEdgeKinds`）**：
   - 在现有 `supports`、`upstream`、`decomposition`、`hypothesis` 基础上，新增 `unknown: '未知关系（待核）'`；保持 `review` 字段仅允许挂载在 `hypothesis` 边上。

---

## 6. 界面与交互设计（对应可点击 Demo）

可点击 Demo 位于 [`openspec/changes/strategy-map-multiformat-import/clickable/index.html`](clickable/index.html)。

### 6.1 演示范围与边界声明
- Demo 使用**纯合成业务资料**（会员运营战略 PPT、渠道利润混排 Excel、区域拓展扫描 PDF、线下白板 PNG）与浏览器内存状态，不连接真实 Host、不调用真实模型或外部网络。
- Demo 用于确认：**双入口发起、四种来源对照体验、原稿与候选双向定位、批量保留清楚项与局部纠偏、自然语言重读交互、纯文本模型提示、撤权/冲突提示，以及桌面/窄屏布局**。实际视觉模型首轮识别准确率与真实工程接线将在正式开发阶段分别验证并记录。

### 6.2 关键界面与操作路径
1. **双入口发起**：顶部可在「战略共创（原讨论）」与「战略地图」间切换，两者均提供「导入战略图」入口；弹层中可免重复上传直接勾选「已有讨论附件 / 已关联项目文件」，或从本地选新文件。
2. **双栏对照核对工作区**（窄屏自动切为「原稿 / 候选」分栏切换）：
   - **左栏（原稿画布）**：展示所选页/工作表/原图，支持页码切换、多页选择（仅选有地图的页）、缩放、以及可点击的高亮节点框与连线箭头标注（清楚项实线紫/绿框，待核项虚线琥珀框）。
   - **右栏（可编辑候选）**：
     - 顶部汇总状态条：`共 N 项 · 清楚 X 项 · 待核 Y 项`，提供「**一键保留全部清楚项**」与「仅看待核项」筛选。
     - 支持切换 **条目表 / 目标与策略树 / BSC** 三种既有视图。
     - 选中任意节点或连线时，左侧原稿同步高亮定位；支持内联编辑标题、类型、基线/目标（含估计/实测、零/待定、单位）、并列冲突值一键采纳、连线方向一键翻转、关系类型修改、去重合并与删除误项。
     - 底部自然语言重读栏：可直接输入或点快捷指令（如「重读第 4 页被遮挡的箭头」），仅局部更新指定页/线，保留人工已修改的字段。
3. **一次保存与下游边界**：
   - 点击「保存候选地图」生成地图新版本（v1 / v2），可切回「原战略讨论」读到刚保存的人工修改，或点「带入目标管理」预览承接清单（不自动采用目标或创建 Case）。

---

## 7. 允许修改路径（第二阶段获确认后）

- `src/host/strategy-map-types.ts`、`src/host/strategy-map-store.ts`
- `src/host/strategy-workbook-routes.ts`、`src/host/strategy-workbook-source.ts`、`src/host/strategy-workbook.ts`
- `src/host/strategy-discussion-host.ts`、`src/host/strategy-discussion-sources.ts`、`src/host/strategy-attachment-*.ts`
- 新增战略多格式解析/渲染/路由薄层：`src/host/strategy-map-import-*.ts`
- `src/agent/strategy-discussion.ts`、`src/agent/strategy-map-schema.ts`
- `src/host/ui/StrategyWorkbench.tsx`、`src/host/ui/StrategyMapPanel.tsx`、`src/host/ui/StrategyWorkbookImport.tsx`、`src/host/ui/StrategyDiscussionPanel.tsx` 及新增对照核对子组件与样式
- 对应测试：`tests/strategy-map-import*.test.ts` 与既有 `tests/strategy-*.test.ts` 回归
- 规格与结果文档：`openspec/changes/strategy-map-multiformat-import/`

---

## 8. 任务目标执行清单与阶段计划

**本轮总目标**：交付战略地图多格式（`.xlsx` / `.pptx` / `.pdf` / `.png|.jpg`）Agent 主动提取与原稿对照核对能力，保留 #98 既有导入与承接基线。

| 阶段 | 任务项 | 完成条件 / 对应 Issue #106 验收 | 状态 |
| --- | --- | --- | --- |
| **阶段一（当前）** | T1.1 读取规范与基线，按规范认领 #106 并建独立任务分支 | #106 唯一有效认领评论回读确认；分支基于 `4b8ad9b0b74390b55b580d92fdf69c292f90d0f8` | [x] 已完成 |
| **阶段一（当前）** | T1.2 编写 OpenSpec、四原则前置检查、IN01–IN07 契约与待确认决定 D01–D06 | 本文件完整覆盖四类格式、语义口径、边界与清单 | [x] 已完成 |
| **阶段一（当前）** | T1.3 制作可点击单文件 Demo 并核验脚本语法与离线自包含 | 演示四种来源、原稿与候选双向定位、仅处理歧义、一键保留清楚项、自然语言重读、纯文本降级与一次保存（Demo SHA-256 `cd55cc32e2bd2082c42ef7f80372bfff7393046d1805407459002eb5feecdabd`） | [x] 已完成 |
| **阶段一（当前）** | T1.4 推送设计提交并在 #106 提交设计回执，等待用户确认 | #106 回执含分支名、完整 SHA、spec 链接与 Demo 打开方式；**获确认前不修改产品源码** | [ ] 待完成 |
| **阶段二（确认后）** | T2.1 Host 多格式只读解析、来源指纹归属、撤权校验与按需页图渲染（TDD） | 覆盖 `.xlsx` / `.pptx` / `.pdf` / `.png|.jpg` 合成样例、同名换版、撤权阻断与渲染环境降级 | [ ] 待确认后开工 |
| **阶段二（确认后）** | T2.2 统一 Pi 会话工具扩展与候选地图版本存储（Interface v3 / Pi 1.4.0） | 复用 `strategy-discussion`；支持图文/纯文本降级、幂等重试、CAS 冲突与人工修改保护 | [ ] 待确认后开工 |
| **阶段二（确认后）** | T2.3 对照核对 UI（双入口、双向定位、批量保留清楚项、局部纠偏、自然语言重读） | 桌面与窄屏隔离浏览器点验；保存重开后在原讨论可读人工修改；目标/Case 无自动写入 | [ ] 待确认后开工 |
| **阶段二（确认后）** | T2.4 完整回归、质量记录与实现回执交回 Codex | `npm run check` 全绿；分别记录合成 Provider 工程验证与真实视觉模型首轮表现（或未授权项）；推送并回执 #106 | [ ] 待确认后开工 |

---

## 9. 待用户确认的设计决定（D01–D06）

请在 #106 确认本版 spec 与 Demo；如无特别说明，默认采用各项推荐方案 **A**：

- **D01 入口整合方式**：
  - **A（推荐）**：在「战略地图」与「原战略讨论」均提供统一「导入战略图」入口，选 `.xlsx` 且检测到结构化表时自动提供「快速列映射（#98 原路径）」与「Agent 识图/混排提取」两种模式切换，免用户记忆两个入口。
  - B：保留独立「导入 Excel」按钮，另增第二个「多格式识图导入」按钮。
- **D02 多页 PPT/PDF 的候选边界**：
  - **A（推荐）**：导入前预览缩略图并允许勾选含战略图的页；多页属于同一方案时合并为一张候选图（跨页同名关系标待核），属于不同方案时按用户或 Agent 识别拆分为多个独立候选版本。
  - B：强制每页生成一个独立地图，不合并。
- **D03 连线未知关系表示**：
  - **A（推荐）**：在 `mapEdgeKinds` 新增 `unknown`（「未知关系 / 待核」），箭头被遮挡或方向不明时默认标为 `unknown` + `needs-review`，避免误标为 `supports` 或 `hypothesis`。
  - B：不增新类型，一律暂存为 `supports` 并在 `unknowns` 文本框文字说明。
- **D04 源表与图上数值冲突处置**：
  - **A（推荐）**：节点保留 `sourceConflicts` 并列列出两个原值及出处，用户在核对面板一键点选采纳其一（或手填新值），保留冲突来源记录。
  - B：默认以源表单元格覆盖图上数值，仅在备注中提醒。
- **D05 纯文本模型降级**：
  - **A（推荐）**：通过 `modelSupportsImages` 判定当前模型不支持图片时，仍先提取可读文字/原生形状/连接符形成初稿，并在视觉页区域提示切换已配置且获准的视觉模型，同时允许直接对照原稿手工核对。
  - B：当前模型不支持图片时直接禁止导入 PPT/扫描 PDF/图片。
- **D06 本机渲染依赖策略**：
  - **A（推荐）**：复用仓库既有 `page_images.py`（LibreOffice + pypdfium2）处理 `.pptx` 整页渲染，PDF 页图按本机可用渲染器（`pdfjs-dist` / `pdftoppm` / `pypdfium2`）只读渲染；不新增重型 npm 原生依赖，缺本机渲染器时清晰提示并降级为原生结构 + 手工核对。
  - B：在 `package.json` 引入新的跨平台无头渲染原生包。

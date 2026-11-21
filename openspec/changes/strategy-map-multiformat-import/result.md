# 战略地图多格式导入：实现与隔离验证记录

- **关联 Issue**：[#106](https://github.com/gadfly-hbo/OptraCall/issues/106)（参考已交付基线 [#98](https://github.com/gadfly-hbo/OptraCall/issues/98)）
- **实现方**：Antigravity (`b2b4f022`)
- **任务分支**：`work/antigravity/issue-106-strategy-map-import`
- **核实基线**：`4b8ad9b0b74390b55b580d92fdf69c292f90d0f8`（注：交付时 `origin/main` 已前移至 `8f6bec2e977e783d8075c0425db3c9598c790d37`，仅改动 `docs/engineering-workflow.md`，与本分支零文件冲突；按规范由 Codex 负责集成最新 `main` 与 PR/CI）
- **设计基线**：`58469b4879f89c987ed31d2d781e7a8fea22a9f1`（v0.2 OpenSpec + 全前端融合可点击 Demo，已获用户明确确认并授权开工）
- **统一会话与 SDK**：Interface v3（`src/host/agent-sessions.ts`）、`strategy-discussion` 域、锁定官方 `@earendil-works/pi-coding-agent` `1.4.0`（未升级或改动 `package.json` / `package-lock.json`）

---

## 1. 交付范围与核对结果

| 验收项 | 实现与实测结果 | 可重复核对证据 |
| --- | --- | --- |
| **四类输入格式解析与原件留存** | 支持 `.xlsx`（结构化表 + `xl/drawings` + SmartArt + 嵌入图片混排）、`.pptx`（按 `ppt/presentation.xml` 真实页序提取形状、坐标框、`cxnSp` 连接符端点/箭头方向与 SmartArt）、`.pdf`（复用 `pdfjs-dist` 文本层与位置，无文字页标记 `needsVisualReview`）、`.png`/`.jpg`/`.jpeg`（魔数校验、宽高及 EXIF Orientation 1–8，原字节无损保存）；支持按需整页渲染与缺渲染器干净降级。 | [`src/host/strategy-map-import.ts`](../../../src/host/strategy-map-import.ts)、[`tests/strategy-map-import-parser.test.ts`](../../../tests/strategy-map-import-parser.test.ts)（6/6 PASS） |
| **不可变存储、来源复用与撤权阻断** | 导入原件按讨论隔离存储于 `dataRoot/strategy-map-imports/discussion-<id>/`；支持免重复上传直接复用讨论附件与关联项目 `020_clean`/`060_reports` 文件；同名换版产生独立 `sourceId` 与 SHA-256；每次读取核验 SHA-256；撤权后立即阻断预览、下载、Agent `read-import-source`、`save-map` 及原讨论续发。 | [`src/host/strategy-map-import-store.ts`](../../../src/host/strategy-map-import-store.ts)、[`src/host/strategy-map-import-routes.ts`](../../../src/host/strategy-map-import-routes.ts)、[`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) |
| **统一 Pi 会话工具扩展与向后兼容 Schema** | 完全复用 `strategy-discussion` 域与官方 Pi SDK `1.4.0`：在 `strategy_goals` 扩展 `read-import-source`（返回结构文本，视觉模型获准时附带 Pi 原生 `ImageContent`，纯文本模型经 `modelSupportsImages` 判定仅发结构文本并提示降级），`save-map` 校验 `importSources`；`mapEdgeKinds` 新增 `unknown`，节点/连线新增可选 `sourceLocation` / `reviewState` / `ambiguityReason` / `sourceConflicts`；`project-runtime.ts` 仅对 `strategy-discussion` 的 `read-import-source` 图文结果放宽有界 12 MiB IPC，其余工具维持 256 KiB。 | [`src/agent/strategy-discussion.ts`](../../../src/agent/strategy-discussion.ts)、[`src/agent/strategy-map-schema.ts`](../../../src/agent/strategy-map-schema.ts)、[`src/host/strategy-discussion-host.ts`](../../../src/host/strategy-discussion-host.ts)、[`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) |
| **语义口径、并发/取消/重启与下游边界** | 合成工具 Provider + 官方 Pi `1.4.0` 全链路实测：项目 `020_clean` PPTX 免重复上传、第 4 页 `clear` + `needs-review` + `unknown` 边及 `9%` 估计基线 / 待定目标提取、纯文本降级提示、`operationId` 幂等重试、人工修订存 `v2` 后原讨论真实回读、过时 `expectedVersion` CAS 冲突拒绝、飞行中 `/stop` 取消零半成品、Host 重启后跨进程持久化恢复，以及保存地图后 **0 条**自动 Goal 或 Case 写入。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（2/2 PASS） |
| **双入口与双栏对照核对 UI** | `StrategyDiscussionPanel` 输入栏紧邻「＋ 添加资料」提供「导入战略图」（不改动普通附件行为）；`StrategyMapPanel` 顶栏与空态提供「导入战略图」；统一导入弹窗支持复用已有附件/项目文件、本地选文件、多页勾选、纯文本降级提示及一键切换 `#98` 结构化 Excel 快速列映射；带 `importSources` 的地图默认展开双栏 `StrategyMapReviewPane`（可随时收起回清爽单栏），含原稿图/SVG 热点联动、页码/缩放/下载/撤权、「一键保留清楚项」「仅看待核」「去重检查」、`sourceConflicts` 一键采纳、`⇄ 翻转方向`、自然语言局部重读与窄屏双标签切换；`版本与来源` 记录多格式原稿。 | [`src/host/ui/StrategyMapImportDialog.tsx`](../../../src/host/ui/StrategyMapImportDialog.tsx)、[`src/host/ui/StrategyMapReviewPane.tsx`](../../../src/host/ui/StrategyMapReviewPane.tsx)、[`src/host/ui/StrategyMapPanel.tsx`](../../../src/host/ui/StrategyMapPanel.tsx)、[`src/host/ui/StrategyWorkbench.tsx`](../../../src/host/ui/StrategyWorkbench.tsx)、[`src/host/ui/StrategyDiscussionPanel.tsx`](../../../src/host/ui/StrategyDiscussionPanel.tsx)、[`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs) |

---

## 2. 实际执行验证与修复记录

### 2.1 自动化检查与回归结果
- **统一会话边界检查**（`npm run check:agent-sessions`）：**PASS**（`Agent session integration boundary and pinned SDK materials: PASS`）。
- **构建与类型检查**（`npm run build`：`tsc --noEmit && node scripts/frontend.mjs build && node scripts/stamp-build.mjs`）：**PASS**。
- **高危依赖审计**（`npm audit --audit-level=high`）：**PASS**（退出码 0；高危 0、严重 0，基线原有 2 项中危未变，未增改任何依赖）。
- **新增专项单测与全链路集成测试**：
  - `tests/strategy-map-import-parser.test.ts`：**6/6 PASS**
  - `tests/strategy-map-import-host.test.ts`：**2/2 PASS**
- **受影响战略、统一会话与 Runtime 回归套件**（`node --test --test-concurrency=2 tests/*strategy*.test.ts tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-runtime.test.ts tests/project-session-guards.test.ts tests/sdk-runtime.test.ts tests/sdk-sessions.test.ts tests/session-compatibility.test.ts`）：**231 项中 230 通过 / 0 失败 / 1 跳过**（耗时 `213.6s`，退出码 0；唯一跳过项为 Linux 云主机无 macOS 受保护执行能力导致的既有 `PP01/02: managed ordinary task sends v2 and native tools on first use and pre-v2 resume # SKIP`）。
  - *失败过程保留*：首次在 2-vCPU 云主机以 `--test-concurrency=6` 并行叠加构建与 Chrome 运行时，`pm01-strategy-source-discovery.test.ts` 中 3 条 10s 超时用例出现 CPU 争抢超时（~10.03s–10.17s）；改按本机核数 `--test-concurrency=2` 单独重跑后全部在 6.0s–9.6s 内通过。

### 2.2 隔离真实浏览器验证（Google Chrome + Playwright）
在隔离临时 `dataRoot` / `projectsRoot` 与随机端口启动真实 `scripts/start-host.mjs` 并托管打包后的 `dist/` 产物，用真实无头 Google Chrome（桌面 `1360×900` + 移动端 `390×844` + 深色模式）点验完整链路，发现并修复了 2 项真实前端问题：
1. **发现并修复 1**：`StrategyMapPanel` 初版将 `draft={map}`（非编辑态为 `StrategyMapVersion` 含额外信封字段）传给 `StrategyMapReviewPane`，导致用户在对照视图直接点击「一键保留清楚项 / 采纳冲突 / 翻转方向」后点「保存为新版本」触发服务端字段校验失败。已改为传 `draft={edit ?? mapDraft(active)}` 并复验保存 `v2` 成功（API 读回 `S1.baseline === '80%'`、`e1: S1 → G1`）。
2. **发现并修复 2**：通过 `StrategyMapImportDialog` 切换 `#98` Excel 快速列映射后，`StrategyWorkbench` 的 `excelImportReq` 计数器未消费归零，导致从「版本与来源」切回「战略地图」时重挂载 `StrategyWorkbookImport` 误弹旧弹窗。已补充 `onOpenHandled` 一次性消费回调并复验通过。
3. **最终浏览器验证结果**：**PASS**（双入口、`#98` 快速切换、纯文本降级提示、PNG 原图加载与热点层、一键保留清楚项、冲突一键采纳、连线方向翻转、v2 持久化回读、原稿对照收起/展开、版本与来源追溯、390px 窄屏 + 深色模式零横向溢出、`0 pageerrors`）。对应可重复脚本见 [`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs)。

---

## 3. 未验证项与环境限制（诚实边界）

以下事项在当前云端 Linux 沙箱环境中**未执行（NOT_RUN）**，明确保留不宣称通过，交由 Codex / 用户在对应环境核验：

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| **全仓 433 个测试文件全量 `npm run test`** | `NOT_RUN`（本地受 2-vCPU 时长限制） | 已完整运行全部受影响的战略、统一会话、Runtime、SDK 与 UI 回归套件；全仓 3,000+ 用例由 Codex 在 PR/CI（`ubuntu-latest`）及 Mac mini 跑满。 |
| **LibreOffice / `pdftoppm` 本机整页图渲染** | `NOT_RUN`（降级路径已 `PASS`） | 当前云端 Linux VM 未安装 `soffice` 与 `pdftoppm`，已验证 `.png`/`.jpg` 直接渲染及 `.pptx`/`.pdf` 缺渲染器时优雅降级为原生形状/文字层并清晰提示；macOS 上 `page_images.py` 整页渲染留待 Mac mini / MacBook 复验。 |
| **真实视觉大模型首轮识图质量** | `NOT_RUN` | 云端 VM 无真实外部商业模型凭据及调用授权，未产生外部付费调用；合成 ToolProvider + 官方 Pi SDK `1.4.0` 的工程协议与图文载荷边界已验证，真实视觉模型首轮准确率需在有授权的真实模型环境单独测评。 |
| **独立非作者复核、PR/CI、合并 `main` 与设备运行采用** | `NOT_RUN`（归属 Codex） | 按 `docs/engineering-workflow.md`「GitHub 开发任务外发与交付」第 5 步，本分支推送并回执后停止写入，由 Codex 负责 diff 核对、非作者复核、集成最新 `main`、PR/CI、获授权合并及 Mac mini / MacBook 服务切换。 |

---

## 4. 四点产品原则与 SDK 治理自检（交付前自查，不替代 Codex 独立复核）

- **Host 管环境**：Host 仅承担文件归属与权限校验、原字节/SHA-256 保存、只读结构解析与按需页图渲染、撤权阻断、视觉能力检测及版本 CAS 锁；不在 Host 硬编码业务节点/连线语义推断规则。
- **Agent 自主执行**：由原战略 Agent 通过 `strategy_goals`（`read-import-source` / `read-map` / `save-map`）自主决定读取哪些页、识别目标/策略/指标口径、标注 `clear`/`needs-review`/`unknown` 与 `sourceConflicts`、并在自然语言局部重读时保护人工修订。
- **优先复用 Pi 已有能力**：复用锁定官方 `@earendil-works/pi-coding-agent` `1.4.0` 的原生 `ImageContent` 工具结果、`modelSupportsImages`、`strategy-discussion` 统一会话（Interface v3）及仓库既有 `xlsx`/`jszip`/`saxes`/`pdfjs-dist`/`page_images.py`；未新增重型原生依赖，未修改 `package.json`。
- **减少人的操作**：已有附件/项目文件免重复上传；清楚项支持一键批量保留；对照面板按需展开并可随时收起；保存候选不强制弹窗采用目标或创建 Case。

---

## 5. 兼容与回退方式

- **向后兼容**：`StrategyMapDraft` / `StrategyMapNode` / `StrategyMapEdge` 的全部新增字段（`importSources`、`sourceLocation`、`reviewState`、`ambiguityReason`、`sourceConflicts`）均为可选字段；旧地图版本与 `#98` Excel 工作簿导入记录可原样读写，无迁移脚本。
- **回退方式**：若需回退，直接撤销本任务分支/PR 合并即可，不影响历史战略讨论、已保存地图、目标或 Case 数据；已落盘的 `dataRoot/strategy-map-imports/` 目录可独立保留或按需只读归档，不触发旧版数据损坏（注：旧版代码写回含新增可选字段的新版本地图时可能丢弃新增的出处/冲突字段，因此从新版切回旧版前应先备份数据根）。

---

## 6. 首轮复核退回记录与返工逐项复验证据（对应 Codex 回执 `issuecomment-7058762759`）

### 6.1 保留首轮复核 FAIL 事实与设计确认可追溯出处
- **首轮候选（`9794c23086afdf9bce2d6c7c73cef9525a469e8e`）复核结果：FAIL（退回返工）**。Codex 于 [issuecomment-7058762759](https://github.com/gadfly-hbo/OptraCall/issues/106#issuecomment-7058762759) 核实该候选在 Mac mini 离线构建与原 8 项单测通过，但在真实产品界面、官方 Pi SDK 与回环合成 Provider 下检出 **7 项阻断问题**（工程规范轴 3 项 + 产品规格轴 4 项），原候选暂缓进入 PR CI、合并与双端服务切换。此 FAIL 事实完整保留，不覆盖或改写。
- **v0.2 设计确认可追溯出处**：设计基线 `58469b4879f89c987ed31d2d781e7a8fea22a9f1`（[issuecomment-7057658920](https://github.com/gadfly-hbo/OptraCall/issues/106#issuecomment-7057658920)）由用户在 Antigravity 会话 `b2b4f022` 中直接回复确认（「确认范围和 v0.2 Demo/Spec 没问题，进行开发」）并授权开工；须如实注明该确认发生在会话侧，用户在 GitHub Issue #106 评论 `7057658920` 与 `7058202547` 之间未另发独立确认评论。

### 6.2 针对 Codex 7 项阻断问题的逐项修复与复验证据

| Codex 编号 | 修复内容与修改路径 | 可重复复验证据 |
| --- | --- | --- |
| **1. 限定本轮来源与所选页** | `src/host/strategy-discussion-host.ts` 在 `read-import-source` 严格校验 `context.importSourceIds`（未授权来源返回 `403 strategy_map_import_not_authorized`）并传递 `allowedPages = context.selectedImportPages[sourceId]`；`src/host/strategy-map-import-routes.ts` 对越界/非整数页返回 `400 strategy_map_import_page_invalid`、对未选页返回 `403 strategy_map_import_page_not_authorized`、多页省略 `page` 仅返回允许页目录（`directoryOnly: true`，不倾倒全文/形状/连线）、单选页省略 `page` 仅读该单页；`/messages` 入口前置校验 `selectedImportPages` 范围。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) (`Item 1`)：**PASS**（验证 403 跨来源、403 未选页、400 页码 99、单选 `[4]` 不泄露 1–3 页正文至 Provider、多选 `[2,4]` 省略页返回 `directoryOnly: true` 且无正文倾倒） |
| **2. 撤权、历史与版本出处** | `src/host/strategy-discussion-host.ts` 在 `sourceAccesses()` 追踪原生历史中的 `read-import-source` 读取（`importReads`），并于 `send()`（`verifyBeforeDispatch`）与 `verifyChoiceSource()` 逐一复核——即使尚未保存任何地图，撤权后普通续聊亦在派发前 `403` 阻断且保留原生历史；`src/host/strategy-map-store.ts`（`validateStrategyMapDraft`）与 `verifyDraftImportSources` 在**用户 HTTP `POST /maps`** 与 **Agent `propose-map-draft` / `save-map`** 双入口统一校验 `sourceLocation`、`importSources`、`selectedPages`、`sha256`、`pageCount` 及 `bbox` `0..1000` 一致性；`src/host/strategy-map-import-routes.ts` 统一 `isProjectUploadExcluded` 覆盖 `listLibrary`、`registerSource`、`resolveExternalBytes`（含 `project-document`、`strategy-attachment` 及 `projectAttachmentLineages`）。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) (`Item 2`)：**PASS**（验证无地图撤权后普通续聊 `403` 且 Provider 实收 **0** 新请求、原生历史保留；伪造 `sourceId` / 越界 `page` / 越界 `bbox` -> `400`、篡改 `sha256` -> `409`；项目文件排除在列表/登记/预览/下载四处一致阻断） |
| **3. 回执须反映实际送图** | 复核官方 Pi SDK `1.4.0` 原生具备 `normalizeToolResultImages`（Photon WASM 自动缩放）；将 `src/agent/project-runtime.ts` 中仅限 `strategy-discussion` `read-import-source` 图文结果的 IPC 有界上限提至 `24 MiB`（其余工具维持 `256 KiB`），`src/host/strategy-map-import-routes.ts` 将 `MODEL_IMAGE_BASE64_LIMIT` 对齐至 `ceil(16 MiB / 3) * 4`，并在确定最终 `deliveredBlocks` 之后才构造 `summaryPayload.imageDelivery`，确保 `delivered === (deliveredBlocks.length > 0)` 与 `count === deliveredBlocks.length` 不可违背。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) (`Item 3`)：**PASS**（真实 **8,162,908 字节 ≈ 7.78 MiB 合法 PNG** 经真实 Host + 官方 Pi SDK `1.4.0` + 合成视觉 Provider `openai/gpt-4o`：`delivered === true`、`count === 1` 且下一个 Provider 请求实收 `>= 1` `image_url`；JPEG 实收 `image_url`；Excel 第 1 表 `delivered === false` / `0` 图、第 2 表 `delivered === true` / `>= 1` 图；纯文本模型 `delivered === false` / `reason === 'text-only-model'` / `0` 图） |
| **4. Excel 工作表与原图对应** | `src/host/strategy-map-import.ts` 改为真实 OOXML 关系链遍历（`xl/workbook.xml` → `sheetN.xml.rels` → `drawing.xml` → `drawing.xml.rels`），将文本框、形状、连接符、图表（解析 `xl/charts/chart*.xml` 标题/轴/系列）、SmartArt 与嵌入媒体严格绑定到所属工作表；移除虚假「绘图与 SmartArt 对象」额外页；支持纯图表独立工作簿与单表多图（`imageIndex` / `includeAllSheetImages`），第 1 表永不串出第 2 表图片。 | [`tests/strategy-map-import-parser.test.ts`](../../../tests/strategy-map-import-parser.test.ts)（两表混排 + 2 幅不同 PNG + 图表标题 + SmartArt + 纯图表工作簿，**7/7 PASS**）、[`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) (`Item 3`)、真实 Chrome 端到端验证 |
| **5. PPTX、PDF 与对照定位** | `src/host/strategy-map-import.ts` 实现完整 `<p:grpSp>` 组合变换栈（`off`/`ext`/`chOff`/`chExt`/`flipH`/`flipV`/`rot`），组合框准确命中 `[600, 400, 300, 133]`；PDF 文本四顶点经 `viewport.transform` 仿射映射，90° 旋转文本准确落在右侧；基于 `page.getOperatorList()` 检测图像/矢量绘图操作，长标题+图形混合 PDF 正确标 `needsVisualReview: true`；`StrategyMapReviewPane.tsx` + `strategy-map-review-helpers.ts`（`matchesSourcePage`）按 `sourceId + page` 双重隔离热点；`StrategyMapImportDialog.tsx` 补齐 D02 多页缩略图卡片与准确降级提示。 | [`tests/strategy-map-import-parser.test.ts`](../../../tests/strategy-map-import-parser.test.ts)（PPTX `grpSp` 精确 `[600,400,300,133]`、90° 旋转 PDF 右侧坐标与混合图文 `needsVisualReview: true`）、[`tests/strategy-map-review-helpers.test.ts`](../../../tests/strategy-map-review-helpers.test.ts) (`Item 5D`)、真实 Chrome 端到端验证（D02 缩略图 + 双来源同页热点严格隔离） |
| **6. 核对草稿后一次保存；局部重读保留手改** | `src/agent/strategy-discussion.ts` 与 `src/host/strategy-discussion-host.ts` 新增非落盘动作 `propose-map-draft`；导入核对/局部重读轮次启用 `importMode: 'review-draft'` 拒绝提前 `save-map`（`409 strategy_map_import_draft_required`），保留既有普通对话 `save-map` 流程不变；`detail()` 暴露经校验的 `mapImportDrafts`；用户点「保存候选版本」才一次写入 `v1`（`author: 'user'`，携带 `importDraftEntryId` 继承出处）；`StrategyMapPanel.tsx` 不再按版本 key 重挂载，持 `ManualEditOverlay` 在局部重读传出实时编辑后的 `workingMapDraft`（如 `15%`）并对返回草稿执行 `mergeRereadDraftWithManualEdits` 确定性合并保留未提及手改；已保存草稿按 `v.source` 判定已结案，刷新不重弹。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) (`Items 6A/6B`)、[`tests/strategy-map-review-helpers.test.ts`](../../../tests/strategy-map-review-helpers.test.ts) (`Item 6B`)、真实 Chrome 端到端验证（从真实 `<input type="file">` 起步：提取后 `0` 版本 → 放弃仍 `0` 版本 → 改 `9%→15%` 触发局部重读，Provider 实收 `15%`，即便返回旧 `9%` 界面仍保 `15%` 且更新连线 → 一次保存写 `v1` 并刷新重开） |
| **7. 保留业务含义与无法识别项** | `strategy-map-review-helpers.ts`（`findSafeDuplicateCandidates`）绝不剥离括号限定词（如 `复购率（新客）9%` 与 `复购率（老客）18%`、`方案 A/B`），不自动合并，仅在完全重复且无口径冲突时展示建议由用户逐组点选「合并 / 保留两项」；`StrategyMapReviewPane.tsx` 在 `kind === 'unknown'` 时禁用「确认此连线」且「⇄ 翻转方向」保持 `unknown` 不自动改为 `supports`；`src/agent/strategy-map-schema.ts` 将 `nodes.minItems` 放宽至 `0`（与 Host 存储语义一致），支持纯文本模型扫描图提交空节点待核草稿并在 UI 提供手工补录入口。 | [`tests/strategy-map-review-helpers.test.ts`](../../../tests/strategy-map-review-helpers.test.ts) (`Item 7A`)、[`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts) (`Item 7C`)、真实 Chrome 端到端验证 |

### 6.3 返工实测过程中额外发现并修复的 2 项真实并发竞态
1. **SSE 订阅竞态（`src/host/server.ts` + `src/host/ui/StrategyDiscussionPanel.tsx`）**：原 `GET /api/strategy/discussions/:id/events` 先 `await strategyDiscussions.detail(id)` 后 `subscribe`，在快速合成/本地模型轮次中若 `run.settled` 发生于 `detail()` 与 `subscribe()` 之间，会导致浏览器错过完成事件并停留在运行态。已改为先 `subscribe` 缓冲事件、再读初始快照并在写出快照后顺次刷新缓冲（同时处理中途断连清理），并在前端 `watchStrategyDiscussion` 补充非运行快照对账与空闲清理 `activity`。修复后真实 Chrome 端到端验证连续 3 次零波动通过。
2. **运行中 `detail()` 瞬态文件变更保护（`src/host/strategy-discussion-host.ts`）**：`detail()` 在 `live.busy === true` 时已保护首次 `native(owner)` 忽略 `NativeSnapshotError('native_snapshot_changed')`，但随后调用 `readMapImportDrafts` → `verifyChoiceSource` 再次读 JSONL 时未继承同一 `live.busy` 保护，导致 239 项回归套件中轮询 `GET /discussions/:id` 偶发 `409 native_snapshot_changed`。已对齐 `live.busy` 瞬态保护并通过全量复验。

### 6.4 返工最终实跑验证清单（严格区分 PASS / FAIL / NOT_RUN）
- **统一会话边界检查**（`npm run check:agent-sessions`）：**PASS**
- **类型检查与产品前端构建**（`npm run build`）：**PASS**
- **高危依赖审计**（`npm audit --audit-level=high`）：**PASS**（退出码 0；0 高危、0 严重；`package.json` / `package-lock.json` 未变更）
- **专项单测与全链路集成测试（含官方 Pi SDK `1.4.0` + 回环合成 Provider）**：
  - `tests/strategy-map-import-parser.test.ts`：**7/7 PASS**
  - `tests/strategy-map-review-helpers.test.ts`：**3/3 PASS**
  - `tests/strategy-map-import-host.test.ts`：**6/6 PASS**（覆盖原 2 项 + Item 1/2/3（含 ~7.78 MiB 真图送达）/6A/6B/7C）
  - 含 `tests/strategy-map-store.test.ts` 的最终联合专项运行：**17/17 PASS（0 fail / 0 skip）**
- **受影响战略、统一会话、Runtime 与 SDK 回归套件**（`node --test --test-concurrency=2 tests/*strategy*.test.ts tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-runtime.test.ts tests/project-session-guards.test.ts tests/sdk-runtime.test.ts tests/sdk-sessions.test.ts tests/session-compatibility.test.ts`）：首次实跑 **237/239 PASS / 1 SKIP（Linux 无 macOS 受保护执行）/ 1 FAIL**（即上述 `live.busy` 下 `readMapImportDrafts` `409 native_snapshot_changed` 竞态）；修复该竞态后，针对受影响的导入、解析、核对助手与地图存储 17 项测试全部 **17/17 PASS**。
- **真实无头 Google Chrome + 隔离 Host（托管 `dist/`）+ 官方 Pi SDK `1.4.0` + 合成 Provider 端到端验证**：**PASS**（连续 3 次稳定通过；从真实 `<input type="file">` 上传双表 `.xlsx` 起步，覆盖 D02 缩略图、表 1/表 2 图示隔离、提取 0 版本与放弃 0 版本、冲突采纳、`复购率（新客/老客）` 安全去重、`unknown` 边确认禁用与翻转保类型、`9%→15%` 手改经局部重读实收并保留、一次保存 `v1` + 刷新重开、双来源同页热点隔离、390px 窄屏深色零溢出、`0 pageerrors`）。同步更新仓库内 [`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs)。
- **仍未验证项（`NOT_RUN`）**：
  1. 真实商业视觉大模型的首稿识图准确率（云端 VM 无商业视觉凭据与调用授权）；
  2. 全仓 433 个测试文件全量 CI（由 Codex 在 PR CI / Mac mini 执行）；
  3. macOS 本机 LibreOffice + `pypdfium2` 整页渲染阳性对照（云端 Linux VM 未安装 `soffice`/`pdftoppm`，已验证缺渲染器优雅降级）；
  4. Codex 非作者复核、最新 `main` 集成、PR/CI、获授权合并与 Mac mini / MacBook 服务切换。

---

## 7. 第二轮复核退回记录与逐项修复复验证据（对应 Codex 回执 `issuecomment-7059564487`）

### 7.1 保留第二轮复核 FAIL 事实
- **第二轮候选（`d739f67ab8d97c85cc0bb3e4a8e2600a05beaddd`）复核结果：FAIL（退回返工）**。Codex 于 [issuecomment-7059564487](https://github.com/gadfly-hbo/OptraCall/issues/106#issuecomment-7059564487) 确认原 7 项阻断问题主体已修通、离线构建与 239 项基线测试在 Mac mini 全部通过（~7.78 MiB 真图送达、表 1/2 隔离、旋转 PDF、组合框、原稿草稿不提前存 v1、去重与未知边保护均已实测通过），但在真实产品界面、真实测试样本（如 Apache POI `smartart-simple.pptx`）与并发/多轮边界下检出 **7 项剩余阻断问题**，暂缓进入 PR CI、合并与双端服务切换。本轮与首轮（`9794c23`）两份 FAIL 事实完整保留，不覆盖或改写。

### 7.2 针对 Codex 第二轮 7 项剩余阻断问题的逐项修复与复验证据

| 第二轮 Codex 编号 | 修复内容与修改路径 | 可重复复验证据 |
| --- | --- | --- |
| **1. 跨轮 `selectedPages` 回填与 `workingMapDraft` 历史撤权** | `src/host/strategy-discussion-host.ts`：1) `verifyDraftImportSources`、`propose-map-draft`、`readMapImportDrafts`、`saveMapVersion` 与 `send()` 确定性回填 Host 已知的 `selectedImportPages`（当 Agent 省略可选 `selectedPages` 或重读省略 `selectedImportPages` 时均锁定原选页，绝不扩大到整份文件）；2) `sourceAccesses()` 将用户传入的 `workingMapDraft.importSources` 单独记为 `workingDraftImportSources`（与 `read-import-source` 工具读取 `importReads` 区分），在 `send()`（`verifyBeforeDispatch`）与 `verifyChoiceSource()` 同步复核，即使零次工具读取，撤权后普通续聊亦在派发前 `403` 阻断且保留原生历史。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（`Round-2 Items 1 & 2`）：**PASS**（Agent 省略 `selectedPages` → Host 回填 `[4]` 至草稿/重读/落盘 `v1`，重读页 1 仍 `403`；仅 `workingMapDraft` 引入来源且 0 次 `read-import-source` → 撤权后普通续聊 `403` 且 Provider 实收 **0** 新请求） |
| **2. 新建导入草稿局部重读不错误绑定旧地图** | `src/host/ui/StrategyMapPanel.tsx`：`onReread` 仅在 `pendingDraft.mapId && pendingDraft.expectedVersion` 存在时才传 `baseRef`（独立新建草稿传 `undefined`），并携带 `supersedesDraftEntryId`；`src/host/strategy-discussion-host.ts`：`send()` 在 `importMode === 'review-draft'` 且未显式传 `mapRef` 时不再自动回退 `currentMap = catalog.filter(...).at(-1)`；`src/host/ui/StrategyDiscussionPanel.tsx` 同步传递 `supersedesDraftEntryId` 并明确区分新建草稿与修订已有地图。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（`Round-2 Items 2, 4 & 5`）+ 真实 Chrome 端到端验证：**PASS**（讨论已有 `oldMapId` v1 时，新建草稿局部重读的 Provider Prompt 不含 `oldMapId`/旧图正文，保存生成新 `mapId !== oldMapId` 的 `v1`，旧地图稳守 `v1`；显式传 `mapRef` 修订旧图则正常携带 `oldMapId` 生成 `v2`） |
| **3. 局部重读保留顶层地图字段手改并提示冲突** | `src/host/ui/strategy-map-review-helpers.ts` 扩展 `ManualEditOverlay.draftFields` 与 `ManualEditRecord` (`draft-patch`)，`mergeRereadDraftWithManualEdits` 统一保留 `title`、`template`、`choice`、`excluded`、`assumptions`、`unknowns`、`scenarioModel` 的人工修改并在与重读返回值不同时生成明确中文冲突提示；`src/host/ui/StrategyMapPanel.tsx` 将上述全部顶层输入（含 `StrategyScenarioEditor`）改为经 `applyDraftChange` 记入 overlay，且按 `draftGroupId` 隔离各草稿编辑态。 | [`tests/strategy-map-review-helpers.test.ts`](../../../tests/strategy-map-review-helpers.test.ts)（`Round-2 Item 3`）+ 真实 Chrome 端到端验证：**PASS**（手改 `title`、`template: bsc→tree` 与 `G1.baseline: 9%→15%` 后触发局部重读，即便合成 Provider 故意返回旧 `title`/`bsc`/`9%`，前端全部保留并展示冲突提示、落盘 `v1` 完整保留三项手改与重读边更新） |
| **4. 单轮多方案草稿并存（方案 A / 方案 B）** | `src/host/strategy-discussion-types.ts`、`src/agent/strategy-discussion.ts`、`src/agent/project-runtime.ts`、`src/host/strategy-discussion-host.ts` 为每份草稿建立独立 `draftGroupId`（重读携带 `supersedesDraftEntryId` 归并同组，单轮多次 `propose-map-draft` 各自成组），`readMapImportDrafts` 返回所有未结案草稿组的最新条目；`src/host/ui/StrategyWorkbench.tsx` 移除压掉同轮其他方案的 `sameSource` 过滤，`StrategyMapPanel.tsx` 顶部提供 `.map-draft-switcher` 切换条逐份核对、编辑、保存或放弃。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（`Round-2 Items 2, 4 & 5`）+ 真实 Chrome 端到端验证：**PASS**（单轮返回方案 A 与方案 B → 切换条展示 2 份草稿；保存或放弃其一后，另一份完整保留、跨刷新仍可继续处理） |
| **5. 双标签页单次保存锁与跨标签/重启持久放弃** | `src/host/strategy-discussion-host.ts` 在讨论目录落地持久账本 `map-import-draft-dispositions.json`（`saved` / `dismissed`，按 `draftGroupId` 与组内全部 `entryIds` 加锁），并在 `src/host/server.ts` 暴露 `POST /api/strategy/discussions/:id/map-drafts/:entryId/dismiss`：并发/双标签以不同 `operationId` 保存同一草稿时首个 `201`、次个 `409 strategy_map_import_draft_already_saved`（同一 `operationId` 重试保持幂等）；放弃后立即持久化、跨新标签/无 `sessionStorage`/Host 重启不再弹出且阻断再保存（`409 strategy_map_import_draft_dismissed`），原生 Pi 历史保持完整可追溯；`StrategyWorkbench.tsx` 移除 `sessionStorage` 假结案逻辑。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（`Round-2 Items 2, 4 & 5`：`Promise.all` 双标签并发保存 `[201, 409]` + 同 `operationId` 幂等 + 旧 `entryId` 409 + Host 重启后放弃态持久化）+ 真实 Chrome 双上下文/双标签端到端验证：**PASS** |
| **6. 同工作表多图热点严格隔离与双向跳图** | `src/host/ui/strategy-map-review-helpers.ts` 新增 `resolveEmbeddedImageIndex` 与 `matchesSourcePageAndImage`（按 `objectId` / `id` / `name` / 标签严格归属到单幅嵌入图）；`src/host/ui/StrategyMapReviewPane.tsx` 的 `.map-source-overlay` 改用 `matchesSourcePageAndImage` 过滤（红图仅画红图框、蓝图仅画蓝图框），并将「点选条目自动跳图」与「人工切换来源/页/图」拆分为独立 effect + `pendingImageSyncRef`，实现点蓝图条目自动切蓝图且人工切来源/页永不回弹。 | [`tests/strategy-map-review-helpers.test.ts`](../../../tests/strategy-map-review-helpers.test.ts)（`Round-2 Item 6`）+ 真实 Chrome 端到端验证（同工作表红/蓝两张嵌入 PNG：红图仅画 `G2` 框、点 `S1` 自动切至图 2 蓝图且仅画 `S1` 框、人工切换多来源不回弹）：**PASS** |
| **7. PPTX SmartArt 子节点定位与 `needsVisualReview`** | `src/host/strategy-map-import.ts` 新增 `parseSmartArtDataXml`、`parseSmartArtDrawingXml` 与 `resolveSmartArtShapes`：通过 `dsp:dataModelExt/@relId` / `diagramDrawing` 关系解析 `ppt/diagrams/drawing*.xml` 中各 `<dsp:sp><dsp:spPr><a:xfrm>` 相对坐标并与 `<p:graphicFrame>` 外框 EMU 合成（跳过 `<dsp:txXfrm>`、支持内部 `<dsp:grpSp>`），为 `abc`/`def`/`ghi` 各子节点输出独立精确 `bbox`（`positionPrecision: 'item'`）；缺失 `drawing*.xml` 时绝不将外框复制到每个子节点，改输出单条 `positionPrecision: 'group'` 图组出处并附页注要求标为 `needs-review`；含 SmartArt 的 PPTX 页一律 `needsVisualReview: true`。 | [`tests/strategy-map-import-parser.test.ts`](../../../tests/strategy-map-import-parser.test.ts)（`Round-2 Item 7` 有/无 `drawing1.xml` 两组用例）：**PASS**（有 `drawing1.xml` 时 3 个子节点输出 3 组互异精确框 `[20,95,600,200]`/`[20,365,600,200]`/`[20,635,600,200]` + `positionPrecision: 'item'` + `needsVisualReview: true`；无 `drawing1.xml` 时仅输出 1 条 `positionPrecision: 'group'` + `needsVisualReview: true` + 待核页注） |

### 7.3 第二轮返工实跑验证汇总（严格区分 PASS / FAIL / NOT_RUN）
- **统一会话边界检查**（`npm run check:agent-sessions`）：**PASS**
- **类型检查与产品前端构建**（`npm run build`）：**PASS**
- **高危依赖审计**（`npm audit --audit-level=high`）：**PASS**（退出码 0；0 高危、0 严重；`package.json` / `package-lock.json` 未变更）
- **专项单测与全链路集成测试（含官方 Pi SDK `1.4.0` + 回环合成 Provider）**：
  - `tests/strategy-map-import-parser.test.ts`：**9/9 PASS**（含 SmartArt `drawing1.xml` 子节点定位与无 `drawing.xml` 组级降级）
  - `tests/strategy-map-review-helpers.test.ts`：**5/5 PASS**（含顶层字段重读保护与同工作表红/蓝多图隔离）
  - `tests/strategy-map-import-host.test.ts`：**8/8 PASS**（含选页回填、仅 `workingMapDraft` 撤权、新建草稿重读不绑旧图、单轮双方案、双标签并发 `[201, 409]` 单次保存锁、跨 Host 重启持久放弃）
- **全量受影响战略、统一会话、Runtime 与 SDK 回归套件**（`node --test --test-concurrency=2 tests/*strategy*.test.ts tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-runtime.test.ts tests/project-session-guards.test.ts tests/sdk-runtime.test.ts tests/sdk-sessions.test.ts tests/session-compatibility.test.ts`）：**245 项中 244 PASS / 0 FAIL / 1 SKIP**（唯一跳过项为 Linux 云主机无 macOS 受保护执行能力导致的既有 `PP01/02` 跳过，退出码 0，耗时 `256.1s`）。
- **真实无头 Google Chrome + 隔离 Host（托管 `dist/`）+ 官方 Pi SDK `1.4.0` + 合成 Provider 端到端验证**：**连续 2 次 PASS（0 pageerrors）**。覆盖：已有旧地图 `v1` + 真实 `<input type="file">` 上传双表双图 `.xlsx` + D02 缩略图 + 单轮方案 A/B 切换条 + 放弃方案 A 后新浏览器上下文（空 `sessionStorage`）不重弹 + 同工作表红/蓝双图热点严格隔离与自动跳图 + `复购率（新客/老客）` 安全去重 + `unknown` 边保护 + 顶层 `title`/`template (bsc→tree)` + `G1.baseline (9%→15%)` 局部重读保留且不泄露旧 `mapId` + 双标签并发/次标签 `409` 单次保存锁 + 刷新复核 + 多来源同页热点隔离与手动切换不回弹 + 390px 窄屏深色零溢出。同步更新 [`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs)。
- **本轮真实浏览器测试过程中额外拦截并修复的 1 项回归**：初版将 `preview.source.sourceId` 放进选节点同步 effect 依赖，导致手动切换「切换原稿来源」下拉框后被选中的旧节点立刻回弹；已拆分为选点触发 effect + `pendingImageSyncRef` 延迟跳图，并在人工切来源/页/图时清空延迟同步，随后连续 2 次 Chrome E2E 全部通过。
- **仍未验证项（`NOT_RUN`）**：
  1. 真实商业视觉大模型的首稿识图准确率（云端 VM 无商业视觉凭据与调用授权）；
  2. 全仓 433 个测试文件全量 CI（由 Codex 在 PR CI / Mac mini 执行）；
  3. macOS 本机 LibreOffice + `pypdfium2` 整页渲染阳性对照（云端 Linux VM 未安装 `soffice`/`pdftoppm`）；
  4. Codex 第三轮非作者复核、最新 `main` 集成、PR/CI、获授权合并与 Mac mini / MacBook 服务切换。

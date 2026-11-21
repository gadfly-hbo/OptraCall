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

---

## 8. 第三轮复核退回记录与逐项修复复验证据（对应 Codex 回执 `issuecomment-7060114706`）

### 8.1 保留第三轮复核 FAIL 事实
- **第三轮候选（`11f171aae8efe3dde149f9b6ea7dd7d50c0307ce`）复核结果：FAIL（退回返工）**。Codex 于 [issuecomment-7060114706](https://github.com/gadfly-hbo/OptraCall/issues/106#issuecomment-7060114706) 确认 Mac mini 隔离环境构建、`check:agent-sessions`、245/245 专项回归、`npm audit`、macOS 本机 LibreOffice+`pypdfium2` 4/4 页渲染送图、真实 Apache POI `smartart-simple.pptx` 3 子节点定位与无 `drawing.xml` 降级、省略 `selectedPages` 回填、仅 `workingMapDraft` 撤权、新建草稿重读不绑旧图、单份草稿顶层字段与 `9%→15%` 保留、A/B 放弃持久化、双标签 201/409 单次保存锁及红/蓝图热点隔离与反向点选均已实测通过；同时检出 **5 项剩余问题**，保持 Issue #106 开放，未进入远端 PR/CI、合并与双端服务切换。本轮与前两轮（`9794c23`、`d739f67`）三份 FAIL 事实完整保留，不覆盖或改写。

### 8.2 针对 Codex 第三轮 5 项剩余问题的逐项修复与复验证据

| 第三轮 Codex 编号 | 修复内容与修改路径 | 可重复复验证据 |
| --- | --- | --- |
| **1. 同来源显式传入 `selectedPages` 扩大页范围上限收口** | `src/host/strategy-discussion-host.ts`：新增 `mergeFixedImportSources()` 并加固 `verifyDraftImportSources()`、`send()` 与 `saveMapVersion()`，无论请求方是否显式提供非空 `selectedImportPages` / `workingMapDraft.importSources[].selectedPages` / 保存载荷 `draft.importSources[].selectedPages`，Host 均以原草稿或固定已保存地图版本的 per-source `selectedPages` 为不可逾越上限：允许缩小（如 `[2, 4] → [4]`，且缩页后读第 2 页仍 `403`），任何扩大尝试（如 `[2, 4] → [1, 2, 4]` 或修订 `B v2` 时 `[1, 4]`）均在派发/写盘前直接 `403 strategy_map_import_page_not_authorized`（0 写盘、0 Provider 请求）。同时在 `readMapImportDrafts()` 加载已保存底图的 `importSources` 合并为 `previousSources`，确保缩小页码局部重读多页已保存地图后刷新讨论列表不误报 403。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（`Round-3 Items 1, 2 & 5`）：**PASS**（`[2,4] → [1,2,4]` 扩大 `selectedImportPages` / `workingMapDraft` / `POST /maps` 均返回 `403`、Provider 请求增量 **0**、落盘版本 **0**；缩小至 `[4]` 放行且读第 2 页被 `403` 阻断；修订 `B v2` 扩大至 `[1,4]` 亦返回 `403`） |
| **2 & 3. 修订已保存地图（`B v1`）固定绑定原 `mapId` 且重读后保留手工标题** | 1) 后端（`src/agent/strategy-discussion.ts`、`src/agent/project-runtime.ts`、`src/host/strategy-discussion-host.ts`）：将当前轮次固定目标 `targetMapRef: { mapId, version }` 经 `providedContext.strategyDiscussion` 与工具上下文传给 `propose-map-draft`；从已保存 `B v1` 发起局部重读时，即使 Agent 省略可选 `mapId`/`expectedVersion`，Host 仍确定性将草稿绑定到 `B v1`（错传其他 `mapId` 或保存时改传不同 `mapId` 均 `409` 拒止），保存仅产生 `B v2` 绝不另建第二份 `v1`；独立新建导入草稿无 `targetMapRef`，保持不绑定旧图；2) 前端（`src/host/ui/StrategyMapPanel.tsx`）：在从编辑已保存 `B v1`（`prevGroupId === undefined && active.mapId === pendingDraft.mapId`）切入修订草稿时保留 `manualEditsRef.current` 并通过 `mergeRereadDraftWithManualEdits` 合并，不再调用 `resetManualState()` 清空人工标题。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（`Round-3 Items 1, 2 & 5`：Agent 省略 `mapId`/`expectedVersion` 修订 `B v1` → 草稿绑定 `mapBId/1`、误建新 `v1` 被 `409` 拦截、正常保存生成 `mapBId v2`）+ 真实 Chrome 端到端验证（`B v1` 点「编辑地图」改标题「方案 B · v2 人工标题」→ 局部重读 Agent 省略 `mapId` 且返回旧标题 → 前端保留人工标题并一次保存为 `B v2`，同 `mapId` 共 2 版）：**PASS** |
| **4. 多方案切换期间完成重读合并最新边与双方人工标题** | `src/host/ui/StrategyMapPanel.tsx`：`GroupDraftWorkState` 新增 `entryId?: string`，切离某草稿组时记录当前 `entryId`；切回该草稿组时，若 `savedGroup.entryId !== pendingDraft.entryId`（代表切走期间新重读结果已落回），强制用最新 `pendingDraft.draft` 与 `savedGroup.manualEdits` 合并（不再优先使用切离前缓存的旧 `savedGroup.edit`），从而同时保留 A/B 各自人工标题并合并最新 `S1 → G1 / supports`。 | 真实 Chrome 端到端验证（在 Provider 门控挂起 B 重读期间切到 A、确认 A 人工标题、释放门控等 B 完成重读后切回 B → B 同时保留「方案 B · 人工标题」/`tree`/`15%` 与最新连线 `S1 → G1 / 支持`，保存 `B v1` 后 A 仍保留「方案 A · 人工标题」）：**PASS** |
| **5. 旧标签过期草稿保存/放弃 `409` 与崩溃落盘恢复无双 `v1`** | 1) **5A 过期草稿拦截**：`src/host/strategy-discussion-host.ts` 在 `saveMapVersion()`、`dismissMapImportDraft()` 与 `send()`（`supersedesDraftEntryId`）中核对 `group.latest.entryId === entryId`，旧标签持有已过期的 `entryB1` 点击保存或放弃时直接返回 `409 strategy_map_import_draft_superseded`（0 写盘，最新 `entryB2` 保持待核），`src/host/ui/strategy-map-import-client.ts` 与 `StrategyMapPanel.tsx` 展示明确中文提示并刷新至最新草稿；2) **5B 崩溃恢复**：`src/host/strategy-map-types.ts`、`src/host/strategy-map-store.ts` 将 `importDraftEntryId` 与 `importDraftGroupId` 随地图版本原子写入 `StrategyMapVersion`；`strategy-discussion-host.ts` 新增 `readSettledDraftsFromMaps()` 并在 `readMapImportDrafts()` 与 `findExistingDraftDisposition()` 中同时核对已保存地图元数据与 `map-import-draft-dispositions.json`——即使进程在 `maps.save` 后、写账本前崩溃，重启 Host 后草稿绝不重新弹出，新标签再保存必返回 `409 strategy_map_import_draft_already_saved`（全库仅存 1 份 `v1`，原 `operationId` 重试仍幂等）。 | [`tests/strategy-map-import-host.test.ts`](../../../tests/strategy-map-import-host.test.ts)（`Round-3 Items 1, 2 & 5`：过期 `entryB1` 保存/放弃均 `409 superseded` 且 `entryB2` 保持待核；保存 `entryB2` 后删除 `map-import-draft-dispositions.json` 并重启 Host → 待核列表为空、新标签再保存 `409 already_saved`、原 `operationId` 幂等返回原 `v1`、全库仅 1 份 `v1`）+ 真实 Chrome 双上下文验证（阻断 SSE 的旧 Tab 2 点击保存收到「已有更新的局部重读结果」且 0 写盘）：**PASS** |
| **6. 浏览同工作表另一幅图后重点击当前已选条目单次跳回** | `src/host/ui/StrategyMapReviewPane.tsx`：新增 `locateSeq` 计数器与 `focusNode()`/`focusEdge()` 包装点击事件，并将 `[selectedNodeId, selectedEdgeId, locateSeq]` 作为原稿定位 effect 依赖——人工切到红图（`图 1`）并确认不回弹后，直接再次点击已选中的 `S1` 行即可 1 次跳回蓝图（`图 2`）；同时引入 `loadedKey` 守卫（`discussionId:sourceId:page:imageIndex`），确保切图瞬间绝不将旧图像素与新图热点框错位渲染一帧。 | 真实 Chrome 端到端验证（点 `S1` 切图 2 蓝图仅画 `S1` → 手动点 `图 1` 红图仅画 `G2` 且 250ms 不回弹 → 直接再点当前已选中的 `S1` 行 1 次跳回图 2 蓝图并仅画 `S1` → 反向点击红图 `G2` 框选中 `G2`）：**PASS** |

### 8.3 第三轮返工实跑验证汇总（严格区分 PASS / FAIL / NOT_RUN）
- **统一会话边界检查**（`npm run check:agent-sessions`）：**PASS**
- **类型检查与产品前端构建**（`npm run build`）：**PASS**
- **高危依赖审计**（`npm audit --audit-level=high`）：**PASS**（退出码 0；0 高危、0 严重；`package.json` / `package-lock.json` / `App.tsx` 均未变更）
- **专项单测与全链路集成测试（含官方 Pi SDK `1.4.0` + 回环合成 Provider）**：
  - `tests/strategy-map-import-parser.test.ts`：**9/9 PASS**
  - `tests/strategy-map-review-helpers.test.ts`：**5/5 PASS**
  - `tests/strategy-map-import-host.test.ts`：**9/9 PASS**（新增 `Round-3 Items 1, 2 & 5` 全链路单测覆盖扩大选页 403、缩页放行、过期 `entryId` 409 superseded、删账本重启崩溃恢复、省略 `mapId` 修订 `B v1 → B v2`）
- **全量受影响战略、统一会话、Runtime 与 SDK 回归套件**（`node --test --test-concurrency=2 tests/*strategy*.test.ts tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-runtime.test.ts tests/project-session-guards.test.ts tests/sdk-runtime.test.ts tests/sdk-sessions.test.ts tests/session-compatibility.test.ts`）：**246 项中 245 PASS / 0 FAIL / 1 SKIP**（唯一跳过项为 Linux 云主机无 macOS 受保护执行能力导致的既有 `PP01/02` 跳过，退出码 0，耗时 `266.9s`）。
- **真实无头 Google Chrome + 隔离 Host（托管 `dist/`）+ 官方 Pi SDK `1.4.0` + 合成 Provider 端到端验证**：**连续 2 次 PASS（0 pageerrors）**。完整覆盖：同工作表红/蓝双图隔离 + 手动浏览红图不回弹 + 直接再点已选中 `S1` 1 次跳回蓝图 + 反向点红图 `G2`；门控重读期间 A↔B 切换合并最新 `S1 → G1 / 支持` 且保留 A/B 各自人工标题；阻断 SSE 的旧 Tab 2 点击保存返回 `409 superseded` 提示且 0 写盘；保存 `B v1`、放弃 `A`；打开已保存 `B v1` 改标题后局部重读（Agent 省略 `mapId`）保留人工标题并保存为 `B v2`（同 `mapId`）；多来源同页隔离与手动切来源不回弹；390px 窄屏深色零溢出。同步更新仓库内 [`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs)。
- **本轮真实测试中额外拦截并修复的 2 项边界问题**：
  1. `readMapImportDrafts()` 在缩小选页局部重读多页已保存地图（如 `B v1 [2, 4]` 缩页 `[4]`）时需合并已保存底图的 `importSources` 上限，否则刷新讨论详情会误报 `403 strategy_map_import_page_not_authorized`；已修复并由 `Round-3 Items 1, 2 & 5` 验证通过。
  2. `StrategyMapReviewPane.tsx` 切换同工作表嵌入图时新增 `loadedKey` 匹配守卫，且 `StrategyWorkbench.tsx` 的 `dismissPendingDraft` 改为先完成 `onRefreshDiscussion()` 再展示「已放弃」提示，消除切图与放弃瞬间的旧帧错位。
- **仍未验证项（`NOT_RUN`）**：
  1. 真实商业视觉大模型的首稿识图准确率（云端 VM 无商业视觉凭据与调用授权）；
  2. 全仓 433 个测试文件全量 CI（由 Codex 在 PR CI / Mac mini 执行）；
  3. macOS 本机 LibreOffice + `pypdfium2` 整页渲染阳性对照（云端 Linux VM 未安装 `soffice`/`pdftoppm`；Codex 已于第三轮在 Mac mini 实测通过 4/4 页）；
  4. Codex 第四轮非作者复核、最新 `main` 集成、PR/CI、获授权合并与 Mac mini / MacBook 服务切换。

---

## 9. 第四轮复核退回记录与逐项修复复验证据（对应 Codex 回执 `issuecomment-7060509132`）

### 9.1 保留第四轮复核 FAIL 事实
- **第四轮候选（`d40380a3a3a7aceae7542a8caf8d8a9837716850`）复核结果：FAIL（退回返工）**。Codex 于 [issuecomment-7060509132](https://github.com/gadfly-hbo/OptraCall/issues/106#issuecomment-7060509132) 确认 Mac mini 上 `check:agent-sessions`、构建、**246/246** 项受影响回归（0 跳过）、固定原选页上限校验与缩页放行、修订 `B v1` 生成同图 `v2`、B 重读中途切 A 再切回合并、过期旧标签 409 拒写与删账本重启单 `v1` 恢复、Excel 红/蓝双图单击跳回与 7 次官方 Pi 回环送图均已复验通过；同时在真实 Chrome 端到端与产品交互中定位出 **3 项与人工核对有关的阻断问题**（随提交的 Chrome 套件在两份隔离数据根均停在第 382 行），保持 Issue #106 开放，未进入远端 PR/CI、合并与双端服务切换。本轮与前三轮（`9794c23`、`d739f67`、`11f171a`）四份 FAIL 事实完整保留，不覆盖或改写。

### 9.2 针对 Codex 第四轮 3 项产品阻断问题的逐项修复与复验证据

| 第四轮 Codex 阻断项 | 根因、修复内容与改动路径 | 可重复复验证据 |
| --- | --- | --- |
| **1. A/B 切换后立即编辑会串稿** | **根因**：`StrategyMapPanel.tsx` 旧实现以扁平 `edit` 状态配合 `useEffect([draftGroupId])` 异步切稿，点击切换 B 后首帧 `pendingDraft` 已是 B 而 `edit` 仍保留 A 的 `GA1`，立即输入标题/模板或点击保存就会把 A 的 `GA1` 覆盖写回 B 并以 B 回执落盘。<br>**修复**：`src/host/ui/StrategyMapPanel.tsx` 重构为按 `currentScopeKey`（`pending:${draftGroupId}` / `saved:${activeKey}`）隔离的 `workByScope` 状态映射（同步镜像 `workByScopeRef`），通过纯渲染派生 `resolveScopeView()` 在切换首帧即隔离目标方案草稿与 `effectivePicked`，所有编辑回调（`applyDraftTransform` / `applyDraftChange` / `save`）严格在当前 `scopeKey` 上执行，并为 `StrategyMapReviewPane` 绑定按组隔离的 `key`，从结构上消除任何 A↔B 串稿窗口。 | 真实无头 Chrome 端到端验证（0ms 零等待：先核对 B → 切 A 改标题 → 立即切 B 改标题/模板）：1) 3 次全链路验证（`G1/G2/S1` 完整保留、`GA1` 计数 0、落盘 `B v1` 节点为 `['G1','G2','S1']`，A 仍保留待核与「方案 A · 人工标题」）；2) 2 次直测验证（A→B→立即改名→立即保存，无中间重读，落盘 `B v1` 节点为 `['G1','G2','S1']`，A 仍可继续核对）：**5/5 PASS（0 pageerrors）** |
| **2. 保存并刷新后，局部重读会撤销已确认的人工修订** | **根因**：保存 `B v1` 并整页刷新后，浏览器内存中的 `manualEdits` 已清空；此前仅在存在内存 `manualEdits` 时才合并重读，导致 Agent 沿用源图旧值（旧标题、`bsc`、`9%`）返回 `e1` 重读稿时直接覆写已确认的 `v1` 修订。<br>**修复**：`src/host/ui/strategy-map-review-helpers.ts` 新增 `MergeConflictItem` 与 `mergeSavedBaseWithRereadDraft()`；`StrategyMapPanel.tsx` 在渲染待核修订草稿（`pendingDraft.mapId` 指向已保存版本）时，从 `versions` 解析 `baseSavedVersion`（跨刷新依然可用）并执行合并：保留范围外已确认的 `v1` 顶层字段与 `clear/confirmed` 节点字段（如人工标题、`tree`、`G1` 基线 `15%`），放行目标连线 `e1` 或待核项更新，并在 `.map-import-notice` 中逐项并列展示「当前保留值 vs 重读返回值」及一键「改用重读值」按钮（`src/host/ui/strategy-map.css` 补充 `.map-conflict-list` 排版）。 | 1) [`tests/strategy-map-review-helpers.test.ts`](../../../tests/strategy-map-review-helpers.test.ts)（`Round-4 Item 2`）：**6/6 PASS**（验证空内存 overlay 下保留 `v1` 标题/`tree`/`15%`、更新 `E1`、生成标题与基线结构化冲突项、点击 `adoptRecord` 一键采纳重读值并消除冲突）；<br>2) 真实无头 Chrome 全链路验证（保存 `B v1` 后执行完整 `page.reload()` → 不重输任何字段直接重读 `e1` → 界面保留「方案 B · 人工确认名称」/`tree`/`15%` 并显示标题与 `15% vs 9%` 冲突对照、`e1` 更新为「因果假设」 → 保存 `B v2` 并回读核对同图 `v1` 与 `v2`）：**3/3 PASS** |
| **3. 旧标签正确收到 409，但丢了本标签的人工输入** | **根因**：`StrategyMapPanel.tsx` 在 `save()` 与 `cancel()` 捕获 `409 strategy_map_import_draft_superseded` 时错误调用了 `resetManualState(settledGroupId)`，清空了该标签页的人工编辑记录。<br>**修复**：`StrategyMapPanel.tsx` 仅在草稿已终态结案（`already_saved` / `dismissed`）时清理 `scopeKey`；遇到 `409 strategy_map_import_draft_superseded` 时保留该 `scopeKey` 的 `workByScope` 人工修改并仅重置 `pending` 操作号，随后调用 `onDraftConflictRefresh()` 同步最新 `entryId`；`resolveScopeView()` 检测到 `stored.baseEntryId !== pendingDraft.entryId` 即自动与最新草稿合并，同时呈现最新重读连线（`S1 → G1 / 支持`）、本标签人工标题及同字段差异对比（含一键「改用重读值」），用户核对确认后再保存。 | 1) 3 次全链路 Chrome 验证（阻断 SSE 的旧 Tab 2 手改标题「人工修订：为沉睡会员调整目标」→ Tab 1 完成 `e1` 重读 → Tab 2 点击保存收到 `409`、0 写盘、界面同步 `S1 → G1 / 支持` 且标题输入框仍保留「人工修订：为沉睡会员调整目标」并展示与「方案 B · 新客培育」的差异对照）；<br>2) 2 次直测 Chrome 验证（旧 Tab 2 收到 `409` 保留人工标题后，用户确认再次点击保存 → `201` 写入唯一 `v1` 含人工标题与 `S1 → G1 / 支持`，随后 Tab 1 再点保存收到 `409 already_saved`、全库仍仅 1 份 `v1`）：**5/5 PASS** |

### 9.3 第四轮返工实跑验证汇总（严格区分 PASS / FAIL / NOT_RUN）
- **统一会话边界检查**（`npm run check:agent-sessions`）：**PASS**
- **类型检查与产品前端构建**（`npm run build`）：**PASS**
- **浏览器脚本语法检查**（`node --check tests/browser-strategy-map-import.mjs`）：**PASS**
- **高危依赖审计**（`npm audit --audit-level=high`）：**PASS**（退出码 0；0 高危、0 严重；`package.json` / `package-lock.json` / `App.tsx` 与全部后端持久化/SDK 文件均未变更）
- **专项单测与全量受影响回归套件**（`node --test --test-concurrency=2 tests/*strategy*.test.ts tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-runtime.test.ts tests/project-session-guards.test.ts tests/sdk-runtime.test.ts tests/sdk-sessions.test.ts tests/session-compatibility.test.ts`）：**247 项中 246 PASS / 0 FAIL / 1 SKIP**（其中 `strategy-map-review-helpers.test.ts` **6/6 PASS**、`strategy-map-import-host.test.ts` **9/9 PASS**、`strategy-map-import-parser.test.ts` **9/9 PASS**；唯一跳过项为 Linux 云主机无 macOS 受保护执行能力的既有 `PP01/02`，退出码 0，耗时 `244.1s`）。
- **真实无头 Google Chrome + 隔离 Host（托管 `dist/`）+ 官方 Pi SDK `1.4.0` + 合成 Provider 端到端验证**：**连续 5/5 次 PASS（5 份全新隔离数据根，`0 pageerrors`）**（3 次全链路 + 2 次第四轮直测场景），并已同步更新 [`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs)。
- **本轮连续压测中额外定位并修复的 2 项时序竞态**：
  1. `src/host/ui/StrategyDiscussionPanel.tsx` 为 `read()` 新增单调序号 `readSeq` 并令 `dispatchMapImport()` 经由 `read()` 刷新，防止早先发出的 `busy: true` 读请求晚于 `run.settled` 返回而把界面锁死在「Agent 正在讨论与核对…」；同时在 `locked` 时显式提示错误而不再静默吞掉。
  2. `src/host/ui/StrategyWorkbench.tsx` 的 `saved()` 改为先 `await onRefreshDiscussion()` 再更新「已保存」提示，确保提示出现时剩余待核草稿（如方案 A）已同步就绪。
- **仍未验证项（`NOT_RUN`）**：
  1. 真实商业视觉大模型的首稿识图准确率（云端 VM 无商业视觉凭据与调用授权）；
  2. 全仓 433 个测试文件全量 CI（由 Codex 在 PR CI / Mac mini 执行）；
  3. macOS 本机 LibreOffice + `pypdfium2` 整页渲染阳性对照（云端 Linux VM 未安装 `soffice`/`pdftoppm`；Codex 已于第三、四轮在 Mac mini 实测通过）；
  4. Codex 第五轮非作者复核、最新 `main` 集成、PR/CI、获授权合并与 Mac mini / MacBook 服务切换。

---

## 10. 第五轮复核退回记录与局部重读基准收口复验证据（对应 Codex 回执 `issuecomment-7061672032`）

### 10.1 保留第五轮复核事实
- **第五轮候选（`6a4cc519391cc00ba905c43e882a1ef4e0ecb464`）复核结果：两项通过，一项仍需返工（仅第 2 项局部重读）**。Codex 于 [issuecomment-7061672032](https://github.com/gadfly-hbo/OptraCall/issues/106#issuecomment-7061672032) 确认 Mac mini 上 `check:agent-sessions`、构建、`git diff --check`、**247/247** 项受影响回归（0 跳过）、第 1 项（A/B 快速切换立即保存及多次来回切换）与第 3 项（旧标签 409 保留人工输入、再次确认单 `v1`）均已完全通过；第 2 项在简单提示下及主动点「改用重读值」采纳 9% 通过，但在三种反例对照（提示提及 `S1`/`G1`、删除误项 `G2` 且清空 `G1` 目标值为待定、手工翻转另一条未知连线 `e2`）下，启发式合并仍会静默覆盖范围外已确认内容。本轮与前四轮（`9794c23`、`d739f67`、`11f171a`、`d40380a`、`6a4cc51`）全部历史事实完整保留，不覆盖或改写。

### 10.2 针对第五轮第 2 项 3 组反例与阳性对照的根因修复与证据

- **核心重构**（[`src/host/ui/strategy-map-review-helpers.ts`](../../../src/host/ui/strategy-map-review-helpers.ts)、[`src/host/ui/StrategyMapPanel.tsx`](../../../src/host/ui/StrategyMapPanel.tsx)）：彻底移除 `hintMentionsId` 自然语言节点编号匹配、`!isNonEmptyValue` 空值自动回填、静默恢复 `v1` 未收录条目/连线，以及对仍未解决连线（`unknown → unknown`）的直接覆盖，改为**严格以已保存 `v1` 为权威基准**进行结构化比对：
  1. **顶层字段与所有既有节点字段**：一律保留 `v1` 的值（包含明确清空为 `""` / 待定的字段，不受自然语言提示是否提及 `S1`/`G1` 影响）；若重读返回了不同的非空值，则生成结构化 `MergeConflictItem` 并列展示「当前保留值 vs 重读返回值」及一键「改用重读值」按钮。
  2. **`v1` 中已删除/未收录的条目或连线**（如 `G2`）：绝不静默插回草稿；生成 `saved-node-add:${id}` / `saved-edge-add:${id}` 结构化建议项，`StrategyMapPanel.tsx` 的 `adoptConflictValue()` 新增 `node-add` 与 `edge-add` 支持，仅在用户主动点击「改用重读值」时合入。
  3. **连线合入边界**：仅当 `v1` 中该连线原为未解决状态（`kind === 'unknown' || reviewState === 'needs-review'`）、重读明确给出了具体已解决关系（`kind !== 'unknown' && reviewState !== 'needs-review'`）、且未逆转用户已手工翻转的方向时，才直接合入（如 `e1` 从 `G1→S1 / unknown` 直接更新为 `S1→G1 / supports`，无需逐项确认）；其余情形（包括手工翻转且仍为 `unknown` 的 `e2`）一律保留 `v1` 并展示可一键采纳的连线差异。
  4. **浏览器脚本防挂起加固**（[`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs)）：为 `waitStarted()` 增加 15s 超时并在首轮提取后等待 `busy === false` 再进入后续操作，消除首次偶发等待超时风险，并完整纳入以下 4 组真实 Chrome `v1`/`v2`（及 `v3`）对照。

| 第五轮对照项 | 已确认 `v1`（及刷新后操作） | 实际保存结果与复验证据 |
| --- | --- | --- |
| **反例 1：提示提及 `S1`/`G1`** | `v1` 含人工标题「方案 B · 人工确认名称」、`tree`、`G1` 基线 `15%`、`e1` 为 `unknown`；整页刷新后发送「请只核对 S1 到 G1 的连线 e1 方向，其余保持原样；保留 G1 的人工基线不变」 | `e1` 直接更新为 `S1 → G1 / supports`；`v2` 完整保留人工标题、`tree` 与 `G1` 基线 `15%`，界面展示 `saved-node:G1:baseline`（`15% vs 9%`）差异对照；`v1` 保持可读。单测 + 3/3 真实 Chrome：**PASS** |
| **反例 2：删误项 `G2` + 清空 `G1` 目标为待定** | 在待核稿点击「删除误项」移除 `G2`、将 `G1` 目标值 `18%` 清空为 `""`，保存 `v1`（节点仅 `['G1','S1']`、`G1.target` 为空），整页刷新后重读 `e1` | `e1` 直接更新为 `S1 → G1 / supports`；`v2` 节点仍仅 `['G1','S1']`（`G2` 不复活）、`G1.target` 仍为空/待定，界面明确展示 `saved-node-add:G2` 与 `saved-node:G1:target`（`待定 vs 18%`）差异对照。单测 + 3/3 真实 Chrome：**PASS** |
| **反例 3：手工翻转另一条未知连线 `e2`** | 点击「⇄ 翻转方向」将 `e2` 翻为 `S1 → G2`（关系仍保持 `unknown`），保存 `v1`，整页刷新后只重读 `e1` | `e1` 直接更新为 `S1 → G1 / supports`；`v2` 完整保留 `e2` 为 `S1 → G2 / unknown`（绝不翻回 `G2 → S1`），界面明确展示 `saved-edge:e2`（`S1→G2` vs `G2→S1`）差异对照。单测 + 3/3 真实 Chrome：**PASS** |
| **阳性对照：主动点击「改用重读值」采纳 `9%`** | 在 `saved-node:G1:baseline` 冲突项点击「改用重读值」后保存 `v3` | `G1` 基线变为 `9%` 并消除该冲突项，`v3` 落盘 `G1.baseline === '9%'`，且人工标题与 `e2 (S1→G2)` 仍保持不变。单测 + 3/3 真实 Chrome：**PASS** |

### 10.3 第五轮返工实跑验证汇总（严格区分 PASS / FAIL / NOT_RUN）
- **统一会话边界检查**（`npm run check:agent-sessions`）：**PASS**
- **类型检查与产品前端构建**（`npm run build`）：**PASS**
- **浏览器脚本语法与空白检查**（`node --check tests/browser-strategy-map-import.mjs && git diff --check`）：**PASS**
- **高危依赖审计**（`npm audit --audit-level=high`）：**PASS**（退出码 0；0 高危、0 严重；本轮仅改动 4 个前端/辅助函数与测试文件）
- **专项单测与全量受影响回归套件**（`node --test --test-concurrency=2 tests/*strategy*.test.ts tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-runtime.test.ts tests/project-session-guards.test.ts tests/sdk-runtime.test.ts tests/sdk-sessions.test.ts tests/session-compatibility.test.ts`）：**248 项中 247 PASS / 0 FAIL / 1 SKIP**（其中 `strategy-map-review-helpers.test.ts` **7/7 PASS**、`strategy-map-import-host.test.ts` **9/9 PASS**、`strategy-map-import-parser.test.ts` **9/9 PASS**；唯一跳过项为 Linux 云主机无 macOS 受保护执行能力的既有 `PP01/02`，退出码 0，耗时 `256.2s`）。
- **真实无头 Google Chrome + 隔离 Host（托管 `dist/`）+ 官方 Pi SDK `1.4.0` + 合成 Provider 端到端验证**：**连续 5/5 次 PASS（5 份全新隔离数据根，`0 pageerrors`）**（3 次第五轮全量 4 组 `v1/v2/v3` 对照 + 2 次第四轮直测回归：0ms A→B 立即改名保存、旧标签 409 保留人工标题并确认单 `v1`），已同步更新 [`tests/browser-strategy-map-import.mjs`](../../../tests/browser-strategy-map-import.mjs)。
- **仍未验证项（`NOT_RUN`）**：
  1. 真实商业视觉大模型的首稿识图准确率（云端 VM 无商业视觉凭据与调用授权）；
  2. 全仓 433 个测试文件全量 CI（由 Codex 在 PR CI / Mac mini 执行）；
  3. macOS 本机 LibreOffice + `pypdfium2` 整页渲染阳性对照（云端 Linux VM 未安装 `soffice`/`pdftoppm`；Codex 已在 Mac mini 实测通过）；
  4. Codex 第六轮非作者复核、最新 `main` 集成、PR/CI、获授权合并与 Mac mini / MacBook 服务切换。

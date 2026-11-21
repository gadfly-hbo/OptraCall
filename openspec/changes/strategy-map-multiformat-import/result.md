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

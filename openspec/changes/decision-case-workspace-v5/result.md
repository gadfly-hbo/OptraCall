# Decision Case 工作台 v5（#142）交付记录

## 1. 身份、基线与两轮记录核对

| 字段 | 实际记录 |
| --- | --- |
| 工单 | [gadfly-hbo/OptraCall#142](https://github.com/gadfly-hbo/OptraCall/issues/142) |
| 领取与实施 Agent | Antigravity (Google DeepMind Agent) / devbox `51923b5f` |
| 一审对照分支（只读保留） | `work/antigravity/issue-142-decision-workspace-v5`（候选 `9e30f92eeaf54c71e76c702adfcd78d5951cafcc`；[PM 首审退回回执](https://github.com/gadfly-hbo/OptraCall/issues/142#issuecomment-7196294259)） |
| 二审领取与修订分支 | [二次领取回执 `issuecomment-7196382082`](https://github.com/gadfly-hbo/OptraCall/issues/142#issuecomment-7196382082) · `work/antigravity/issue-142-decision-workspace-v5-r2` |
| 二审主线基线完整 SHA | `d4a62a64e791016f83e1afbd408fe541a053230f`（合并一审 `9e30f92` 与最新 `origin/main`） |
| 确认包提交 | `6df731afa67887577bbac2ef0652d9728d49efca`（`review/decision-workspace-v5-confirmed`） |
| 固化确认件核对 | `openspec/changes/decision-case-workspace-v5/demo.html`：362,273 字节，SHA-256 `68ee0b506d83782685ccc938d9f95068e9c66221a0c94746f08f2010e2808473`（与 `6df731a` 零差异）；同目录 `spec.md`、`tasks.md`、`demo-guide.md` 原样保留零改写 |
| Runtime / SDK 约束 | 官方 Pi SDK `1.4.0` / 统一会话 Interface v3 零改动、零绕过；未升级任何依赖或锁文件 |

---

## 2. PM 首审退回发现与二审逐项修正对照

| 首审问题组 | 首审复现现象 | 二审根因修复与涉及文件 | 二审自动化与浏览器验证证据 |
| --- | --- | --- | --- |
| **1. 搜索权限与重复定位（W09）** | Case 读取变为 `403` 后搜索仍显示旧 Case 标题与下一步；同一 Case / 项目按 `Esc` 关闭后再次从搜索选中无法重开详情弹窗。 | `src/host/ui/App.tsx`：打开快捷搜索时通过递增 `searchEpoch` 发起只读核对，遇 `403`/`500`/未就绪立即清空 `homeCases` 并防乱序旧响应回写，权限恢复后自动恢复；`src/host/ui/CaseBoard.tsx`、`src/host/ui/ProjectBoard.tsx`：引入 `initialCaseSeq` / `initialProjectSeq` 序号监听，确保连续两次选中同一 ID 仍可靠重开弹窗。 | `tests/browser-issue-142-workspace-home.mjs`：`R2-F1-search-clears-revoked-cases-keeps-projects`、`R2-F1-repeated-same-case-search-selection-after-esc` **PASS** |
| **2. 首页与建设状态数据可信度（W01, W05, W07）** | 切到第二家企业再回首页仍展示第一家体系；`candidate` 指标被标成「已发布」；`readStudioFoundation` 403 被吞成「建设中/未开始」；战略发布仅查前 5 个事项；Case 403/500 落回「从第一个 Case 开始 / 还没有待处理事项」。 | 新增共享只读钩子 `src/host/ui/use-workspace-desk-data.ts` 并双向同步 `App.tsx` ↔ `StudioPage.tsx` ↔ `WorkspaceHome.tsx` ↔ `FoundationOverview.tsx` 的 `studioEnterpriseId`；`workspace-home-model.ts` 中 `summarizeStudioFoundationSnapshots` 严格按 `s.enterpriseId === enterprise.id` 过滤体系、仅在 `item.status === 'formal-current'` 时计为已发布（仅有 `candidate` 时显示 `候选待发布`），显式透出 Studio `403`（`无权限`）与 `500`（`暂不可读`）；移除战略事项 `.slice(0, 5)` 截断；Case `403`/`500` 使用独立受限/不可读标题与队列说明，绝不混用空态文案。 | `tests/workspace-home-v5.test.ts` + `tests/browser-issue-142-workspace-home.mjs`：`R2-F2-strategy-6th-initiative-published-on-home`、`R2-F2-ent2-does-not-inherit-ent1-systems`、`R2-F2-candidate-metric-not-marked-published`、`R2-F2-foundation-overview-synced-to-ent2`、`R2-F2-two-way-enterprise-sync`、`R2-F2-foundation-403-not-swallowed`、`R2-F2-case-403-no-empty-copy`、`R2-F2-case-500-no-empty-copy` **PASS** |
| **3. 队列归属、行动进展与图表来源（W01, W02）** | 多项目 Case 下报告责任人误取 `focusProjects[0]`；已完成/已取消项目未单列且证明图误绑 `P2` 报告；真实决策看板行动未进入进展统计与队列。 | `use-workspace-desk-data.ts` 只读聚合 `readBoard()`（`GET /api/decision-board`）与 `readCaseDecisions`；`workspace-home-model.ts` 新增 `已关联行动进展` 证明图（绑定 `来源 · 决策看板行动记录`）及行动队列项（展示真实 `owner`、`dueDate`、`执行中`/`待办`）；项目工作状态图区分 `进行中`/`待核对`/`暂缓`/`已完成`/`已取消` 并绑定 `来源 · 关联项目工作记录`；报告队列项责任人严格取自 `projectMap.get(report.projectId)`（空值显示 `待定`）；关闭态 Case 移出待处理队列。 | `tests/workspace-home-v5.test.ts` + `tests/browser-issue-142-workspace-home.mjs`：`R2-F3-multi-project-completed-cancelled-chart`、`R2-F3-report-owner-from-own-project-not-p1`、`R2-F3-decision-board-action-proof-and-source`、`R2-F3-decision-board-action-owner-and-duedate` **PASS** |
| **4. 报告并排阅读、手机证据抽屉与附件自身版本（W04）** | 桌面打开附件把报告正文挤出视口；手机缺少确认稿模态底部证据抽屉；打开附件时元信息误显示报告自身的路径和 SHA-256。 | 新增 `src/host/ui/TaskReportDesk.tsx`（`[ 任务对话 | 结论报告 ]`）：`1440px` 桌面端左栏完整展示报告正文、右栏独立滚动并排展示「报告与依据」（含限高内部滚动来源列表，确保报告正文与附件原文同时在视口内并排可见）；`<= 1050px` / `390px` 窄屏点击依据弹出模态 `<dialog className="pv-reader-mobile">` 底部抽屉（`×`、`← 返回来源位置`、`Escape` 焦点还回触发点）；`TaskReportDesk.tsx`、`TaskReportReferences.tsx`、`ProjectCalculationEvidence.tsx` 均按单条目传入并渲染其自身 `projectId`、`citationId`、`originalPath` 与 `sha256`（绝不混用报告路径与报告 SHA），并对同名路径篡改执行 `409` 阻断且保留固定报告快照回读。 | `tests/browser-issue-142-workspace-home.mjs`：`R2-F4-citation-1-exact-id`、`R2-F4-citation-2-distinct-exact-id`、`R2-F4-attachment-shows-own-path-and-sha-not-report`、`R2-F4-desktop-1440-side-by-side-both-in-viewport`、`R2-F4-inspector-attachment-meta-exact`、`R2-F4-mobile-390-drawer-is-modal`、`R2-F4-mobile-390-attachment-exact-path-and-sha`、`R2-F4-mobile-390-escape-restores-trigger-focus`、`R2-F4-report-409-tamper-blocked-preserves-locator`、`R2-F4-fixed-snapshot-readable-after-live-tamper` **PASS** |
| **5. 独立入口来源隔离与设置往返报告常开（W04, W08）** | 从搜索、侧栏或项目地图独立打开同一任务仍沿用上次 Case 来源；手动展开报告后进入设置再返回，报告正文被收起。 | `src/host/ui/App.tsx`：将 `activeTaskSourceCase` 严格限定为当次由 Case 发起的导航，从搜索、侧栏、项目地图、Studio 或纯项目 URL 打开任务时立即清除旧来源；按 `taskKey` 持久化 `taskPanelByTask`、`reportPreviewOpenByTask` 与 `deskStateByTask`，`TaskReportDesk` 与检视区 `TaskReportEvidence` 经 `设置 → 连接配置 → 返回` 后完整保持原展开正文与选中依据。 | `tests/browser-issue-142-workspace-home.mjs`：`R2-F5-desk-report-stays-open-after-settings-return`、`R2-F5-manual-inspector-report-body-persists-across-settings`、`R2-F5-independent-task-open-clears-source-case`、`W08-draft-preserved-across-desk-and-settings` **PASS** |
| **6. 深紫黑导航栏与独立基础建设总览页（W01, W09）** | 亮色模式下侧栏退化为浅灰白底；缺少独立「基础建设总览」页与侧栏工作区企业徽章。 | `src/host/ui/workspace-home.css` & `App.tsx`：亮暗双主题下 `.sidebar` 与窄屏模态导航 `dialog.workspace-panel-navigation` 统一采用深紫黑底色（亮色 `#191621` / `rgb(25, 22, 33)`，暗色 `#100f15` / `rgb(16, 15, 21)`），保留主工作区 `--accent`（`#6550c9` / `#b7a7ff`）、企业工作区徽章、「新建项目」及可点击的「基础建设总览 `›`」入口；新增独立页面 `src/host/ui/FoundationOverview.tsx`（`战略与目标` + `企业资产` + 深紫色 `Decision Case` 卡片 + `工作区设置` 卡片）。 | `tests/browser-issue-142-workspace-home.mjs`：`R2-F6-dark-rail-light-mode`、`R2-F6-dark-rail-dark-mode`、`R2-F6-dedicated-foundation-overview` 及 1440/1024/390 亮暗截图核对 **PASS** |

---

## 3. W01–W09 二审验收矩阵

| 项 | 结果 | 二审验证证据与说明 |
| --- | --- | --- |
| **W01 首页和导航** | **PASS** | `tests/workspace-home-v5.test.ts`（7 项单元测试全部通过）+ `tests/browser-issue-142-workspace-home.mjs`（普通启动落首页、空态独立项目可达、Case `403`/`500` 独立提示、Studio `403` 不误报未开始、跨企业切换双向同步、独立「基础建设总览」页与深链优先）。 |
| **W02 Case 与双向承接** | **PASS** | 四项基建全空冷启动下由首页点击「新建 Case」→ 启用记录 → 就地准备候选 G+S → 采纳 → 创建 Case → 返回首页核对；验证多项目工作状态（已完成/已取消）与真实决策看板行动进展（责任人 `王店长`、期限 `12/05`、`来源 · 决策看板行动记录`）及报告所属项目责任人精确映射。 |
| **W03 地图与六类任务** | **PASS** | 实测零任务项目、同类多任务（`分析 Analysis 2` + `需求 Requirement 1` + `反馈 Teach 1`）、多 Case 关联项目、已归档项目、点击「回到原 Case」及浏览过程零自动建任务。 |
| **W04 任务与报告证据** | **PASS** | 实测同一报告下 **两条独立 `citationId`** + 固定附件 + 固定报告快照：`1440px` 桌面端报告正文与附件正文同时处于视口内并排核对，`390px` 手机端打开模态 `<dialog>` 底部证据抽屉；附件精确显示自身路径 `020_clean/门店缺货明细.md` 与自身 SHA-256（绝不显示报告路径或报告 SHA）；同名路径篡改触发 `409` 告警保留原定位且固定快照仍可读；`Esc` 关闭并精确还回触发按钮焦点。 |
| **W05 战略** | **PASS** | `tests/browser-issue-142-workspace-home.mjs` 在真实隔离 Host + Chromium 中跑通完整闭环：第 6 个战略事项双道串行检验通过 → 未勾选确认框时「确认发布」禁用 → 填写正式目标值并确认发布 → 首页突破旧 5 条上限显示「战略选择 · 已发布」 → 点击「带入目标管理」保存目标候选并展示「来自战略发布的目标承接」（保持候选待采用 `adoptedVersion === null`） → 点击「撤销发布」后禁用新增承接但完整保留「1 批目标候选已导入」回执及「版本管理」中的「发布已撤销 / 已保存目标候选」历史。 |
| **W06 目标管理与 #141 回归** | **PASS** | `?management=gsa` 深链实测直接渲染具体目标与 GSA 拆解/切换控件（截图 `07-w06-gsa-deeplink-1440-light.png`）；复跑 `tests/goal-decomposition-contract.test.ts`（DC01–DC05 全过）与 `tests/browser-issue-138-goal-trial.mjs`（13/13 全过，0 错误）。 |
| **W07 语义与分析资产** | **PASS** | 实测双企业切换在首页、基础建设总览、语义资产、分析资产间双向同步；企业 2 不串入企业 1 建设体系；`candidate` 指标显示「候选待发布」而不标「已发布」；会员包与项目数据上下文回归全过。 |
| **W08 设置与帮助** | **PASS** | 实测从首页进入报告阅读台及在检视抽屉手动展开报告正文后，执行 `设置 → 连接配置 → 返回`，原报告正文、当前选中依据、任务草稿与对应来源上下文均完整保持不收起；独立打开同一任务时自动清除旧 Case 来源。 |
| **W09 视觉与可用性** | **PASS** | 1440 / 1024 / 390 CSS 像素 × 亮/暗双主题全部零横向溢出、`0 pageerror`；深紫黑导航栏、`1440px` 附件展开并排阅读与 `390px` 手机模态证据抽屉均逐张截图人工核验通过；搜索 `403` 清空陈旧 Case 与同项重复打开弹窗均验证通过。 |

---

## 4. 四点产品原则专项自检（作者自检，非独立复核替代）

| 原则 | 检查结论 | 证据 |
| --- | --- | --- |
| **Host 管环境** | 合规 | `WorkspaceHome`、`FoundationOverview`、`useWorkspaceDeskData`、`TaskReportDesk` 与 `WorkspaceSearchDialog` 均仅调用现有公开只读 GET 接口，零隐式业务写入；企业范围、Case 权限（403）、存储不可用（500）及报告路径哈希冲突（409）全部显式分态守卫，不静默替换或吞错。 |
| **Agent 自主执行** | 合规 | 未新增任何分析硬编码步骤、方法配额或推理拦截；战略检验、目标拆解与分析任务完全沿用既有 Pi Agent 自主执行闭环。 |
| **优先复用 Pi 已有能力** | 合规 | `npm run check:agent-sessions` 通过；官方 Pi SDK `1.4.0` 与统一会话 Interface v3 零改动，前端仅消费既有统一会话快照与公开契约。 |
| **减少人的操作** | 合规 | 普通启动即达首页焦点事项与待处理队列，同一企业下切换首页与基础建设总览零闪烁即时呈现；桌面打开报告默认展开正文并与右侧依据并排对照，手机一键唤起底部证据抽屉，跨设置返回无需重新展开报告。 |

---

## 5. 实际执行命令、全量检查与未验证项

1. **核心与全量检查结果**：
   - `npm run check`（`npm run check:agent-sessions && npm run test && npm run build`）：
     - `npm run check:agent-sessions` → **PASS**
     - `npm run test`（完整 473 个 `tests/*.test.ts` 文件，共 **3,341** 项测试）：首次全量连跑 **3,143 PASS / 197 SKIP / 1 FAIL**（耗时 4,634.0s；全部 UI、首页、Case、目标管理、项目、归档、报告、Studio 与 SDK 边界测试 **100% 一次通过**；唯一失败项为未改动的 `tests/strategy-candidate-host.test.ts` 中 `I131-B` 在 2 vCPU 长跑负载下的 `candidates.json` `lastRun` 落盘时序竞争）；随后原样单独复跑 `node --test tests/strategy-candidate-host.test.ts` → **3/3 PASS，0 FAIL**（17.8s），未修改该旧测试文件，两次结果一并如实保留。
     - `npm run build`（`tsc --noEmit && node scripts/frontend.mjs build && node scripts/stamp-build.mjs`）→ **PASS（exit 0）**
   - `node --test tests/workspace-home-v5.test.ts` → **7/7 PASS，0 FAIL**
   - `node --test tests/goal-decomposition-contract.test.ts`（#141 DC01–DC05）→ **5/5 PASS，0 FAIL**
   - `ISSUE142_RUN=r2-final-check node tests/browser-issue-142-workspace-home.mjs` → **64/64 PASS，0 FAIL，0 pageerror，19 张亮暗及多视口截图已人工逐张核验**（保存于被忽略目录 `.local/issue-142/r2-final-check/`，含 `05-report-attachment-open-1440-light/dark.png` 与 `06-report-attachment-drawer-390-light/dark.png`）
   - `OPTRACALL_CHROMIUM=<playwright-chromium> node tests/browser-issue-138-goal-trial.mjs` → **13/13 PASS，0 errors**
2. **既有基线脚本差异保留说明**：
   - `tests/browser-ui-129-visual-refresh.mjs`：V03（1024/390 模态检视区、Tab/Esc、焦点与草稿返回）与 V02–V04/V06（任务、草稿、署名、报告/哈希/固定来源、Case 往返、归档只读、失效链接保护）全部 **PASS**；仅 `shellScenarios` 旧断言等待 `<h1>目标管理</h1>`（主线 #137/#140 已在有目标时将 `<h1>` 改为具体目标标题），属主线既有脚本漂移，原样保留不改旧脚本。
3. **范围外未验证项（`NOT_RUN`）**：
   - 真机 macOS / iOS 物理触控与真实外部商业 LLM Provider 调用不在本单云端开发授权内，标记 `NOT_RUN`。
   - 非作者独立终审、PR 关联 head CI 核定及合并主线由 PM Agent 按工程规范执行。

---

## 6. 兼容与回退方式

- 本次变更严格限于前端 UI 视图、只读聚合钩子与测试文件（新增 `FoundationOverview.tsx`、`TaskReportDesk.tsx`、`use-workspace-desk-data.ts`），**零持久化 schema 变更、零新增后端写接口、零依赖版本变动**。
- 回退方式：直接回退本分支前端提交即可恢复旧界面入口；本机已有 Case、决策看板、项目、任务、报告、引用快照、目标、战略发布与 Studio 企业资产记录完全兼容，无任何数据迁移或回退损耗。

## 7. PM 二审终审与集成

接收 Antigravity 二审提交 `385ad95e4076a5c6873c1d0641a436e6e45df086` 后，PM 在独立分支修正了补测发现的问题。原候选 64 项 Chromium 验收全部通过；下列额外场景在原候选上复现，在 PM 集成分支上复验。[同单 PM 接手回执](https://github.com/gadfly-hbo/OptraCall/issues/142#issuecomment-7207623229)

| 可观察场景 | PM 修订及复验依据 |
| --- | --- |
| 已获准的 Case 或项目在下一次读取中被拒绝，旧请求晚于新请求返回 | 每次打开搜索和首页时，按本轮读取结果决定可见范围。搜索在异步插入结果时保留用户已选中的同一条记录。独立进入任务后重载，继续使用当次入口。见 `tests/browser-issue-142-search-authorization.mjs`。 |
| 多个 Case 共用项目，行动有明确归属，或只有项目进展 | 项目、Case 和看板行动按各自记录展示。关联行动按 Host 分页读完。用 `tests/workspace-home-action-scope.test.ts` 和 `tests/workspace-home-v5.test.ts` 核对归属、独立项目和权限状态。 |
| 同一路径的报告 A、B 有不同 SHA，固定 XLSX 原件读取失败 | 切换版本时按当前项目、任务与报告版本核对关联 Case。原件读取失败时保留路径、SHA 和重试操作，成功后可按原标识读取。见 `tests/browser-workspace-report-recovery.mjs`。 |
| 有已采用目标时进入目标管理 | #129 兼容脚本核对准确版本的目标名称及三个阶段入口，并继续检查各尺寸的导航、设置、帮助和焦点。见 `tests/browser-ui-129-visual-refresh.mjs`。 |

独立复核在 PM 提交 `002b0c349b4293f574b6343fc07008d2a7680651` 上又复现两项异常。在空 Case 环境让行动看板返回 503，首页会将未知行动数显示成没有待办；项目地图刷新并收到 Case 列表 403 后，详情仍会列出先前获准的 Case。后续集成修正了行动读取失败、部分关联、项目地图权限收回以及旧响应迟到时的显示，浏览器回归包含恢复读取后的正常入口。

新增工作均位于 React 读路径、视图状态及测试。写操作沿原业务入口执行。终审使用隔离 Host、合成资料和 Chromium。实际交付提交、非作者复核、PR 与主线两次 CI、工程结案以 [#142 的 PM 记录](https://github.com/gadfly-hbo/OptraCall/issues/142) 为准。设备更新和真实业务体验由用户安排。

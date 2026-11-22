# 任务目标执行清单 · 企业会员运营资产包首期（Issue #111）

- **Issue**：[#111](https://github.com/gadfly-hbo/OptraCall/issues/111)
- **领取方**：`Antigravity/cdabef5b`
- **独立任务分支**：`work/antigravity/issue-111-member-operations-pack`
- **核定源码基线**：`8ad8564ca8d47ff27bd0b335456c99bfa1706f94`（`origin/main`）
- **冻结领取包基线**：`6d6a2b640d80e2ec5bb46c979fa859aca82884bc`
- **规则与接入声明（IN01–IN07）**：
  - 工程规范版本：v1.12（`docs/engineering-workflow.md`）
  - 会话 Interface 版本：`Interface v3`（`src/host/agent-sessions.ts`），兼容 v1/v2 调用子集；不改官方 Pi SDK（`1.4.0`）或 Semantica（`0.7.0`）
  - 真实 owner / profile：沿用项目任务 `projectId + taskId`（普通分析 / 建设任务）及既有 `studio-semantic-generation`（只读文本作业）；受限明细任务沿用 Host 级授权与文件/工具边界，不新建平行 Runtime、运行队列或全局审批流
  - 四点产品原则核对：Host 管环境、参考与包注册、准确版本/依赖/授权校验、不可变清单与幂等回执；Pi Agent 自主盘点、找读、补证、计算与纠错；优先复用现有 `StudioStore`、`StudioEnterpriseCatalog`、`StudioSources`、`studio_assets`、`SemanticContextPanel`、`StudioFeedbackDialog`、`CapabilitySettings`；正常使用仅需表达目标、选定用途、一份预览确认与在分析窗口提问，回复旁一次反馈

## 预期交付结果

在独立任务分支完成“企业会员运营资产包首期：按用途发布、分析采用与修订”的产品能力实现、TDD 回归测试、正常入口隔离合成与浏览器验证，推送分支并在 Issue #111 提交完整「实现交付」回执交回 controller（保留 Issue Open）。

## 阶段执行清单

- [x] **S0 环境核对、领取与范围固定**
  - 核对 Node `v25.9.0` / npm `11.12.1` / `check:agent-sessions` / `typecheck` / 基线 Studio 测试；
  - 确认 #111 Open 且无在先领取，留言领取并回读确认；
  - 从 `8ad8564ca8d47ff27bd0b335456c99bfa1706f94` 建立 `work/antigravity/issue-111-member-operations-pack`，原位保留冻结 4 份 OpenSpec 文档并建立本清单。
- [x] **S1 核心域合同与持久存储（SDD + 真实 RED→GREEN）**
  - `extensions/business-plugins/studio/enterprise-pack.ts`：参考来源登记合同、企业包与全景/条目/用途/例外/不可变发布清单/分项回执/任务固定版本/授权记录/分层使用依据/去重反馈与升级影响合同及严格校验；
  - `src/host/domain-reference-store.ts`：设置中的领域资产包参考登记 Store（同源同版去重合并多路线、同版异文保留双份待核、同源新版并存、缺件不标原文可回查、仓库内置 Nike T03/T04 真实原文读取与 SHA-256 核验）；
  - `src/host/enterprise-pack-store.ts`：企业会员运营包 Store（独立于项目/人的包身份、两条路线合入同一包与同一企业决定、宽题全景与点名用途直达、跨项目/并发按 `(enterpriseId, packId, purposeKey, subjectUnit, scopeKey, windowDays)` 去重、一份预览分项发布与依赖挂起/原回执查证/幂等重试、任务起点版本固定与中途升级/撤权核验、事件日期与批准例外及未决重叠限域、反馈同题同版追加证据与六类归属分流、修订与历史保全）；
  - `src/host/resource-grant-store.ts`：最小资源授权记录 Store（授予方/依据/主体/用途/三层操作 `read-definition` | `cite-summary` | `read-detail-recalculate` / 期间与粒度 / 有效期与撤回；绝不信任客户端角色名）。
  - 验收对应：参考去重与冲突、两线内化、一份预览分项发布、跨项目去重与归档只读、版本固定与例外/重叠限域、授权三层隔离、回退只读兼容（`tests/member-operations-pack-store.test.ts` 3/3 PASS）。
- [x] **S2 Host API、Agent `studio_assets` 与受限工具/文件边界接线（IN01–IN07）**
  - `src/host/member-pack-host.ts` + `src/host/studio-host.ts` + `src/host/studio-sources.ts` + `src/host/project-files.ts` + `src/host/server.ts` + `src/host/main.ts`：
    - 新增 `/api/studio/domain-references*`、`/api/studio/enterprise-packs*`、`/api/studio/resource-grants*` 路由（全走 `operations.run` 幂等与 `mutate` 门闩，支持 `--disable-member-pack` 回退只读模式，数据隔离存于 `<dataRoot>/member-packs/`，零影响 `<dataRoot>/studio/index.json`）；
    - 扩展 `enterpriseContextFor` 与 `studio_assets catalog`：首次执行固定任务包版与授权范围、翻页与精读重核当前权限与版本完整性、受限明细任务在底层文件读取（`projectFiles` / `read_input` / `studio-sources`）执行相同授权限制并明确原因（`tests/member-operations-pack-host.test.ts` + `tests/member-operations-pack-runtime.test.ts` PASS，`npm run check:agent-sessions` PASS）。
- [x] **S3 前端产品界面实现（对齐已确认 Demo 与既有入口）**
  - `src/host/ui/member-pack-client.ts` + `src/host/ui/DomainPackSettingsPanel.tsx` + `src/host/ui/CapabilitySettings.tsx` + `src/host/ui/App.tsx`：完善「设置 → 领域资产包」登记、搜索、同源同版去重/异文待核提示、原段查看及进入企业 Studio 建设；
  - `src/host/ui/StudioMemberPackPanel.tsx` + `src/host/ui/StudioPage.tsx`：在企业 Studio 体系工作台接入会员运营包全景、双线企业草案、一份预览与分项回执、版本历史与三层资源授权；
  - `src/host/ui/SemanticContextPanel.tsx`：分层呈现「本次依据」中的固定领域包目录供给、授权层次及独立核验边界；
  - `src/host/ui/StudioFeedbackDialog.tsx`：支持 §5 六类问题归属分流并与企业包同题同版追加证据关联（`tests/member-operations-pack-ui.test.ts` 3/3 PASS，`tests/browser-member-operations-pack.py` 真实 Chromium 0 报错 PASS）。
- [x] **S4 全面 TDD 回归、真实合成路径与浏览器隔离验证**
  - 专项单测、Host 集成、官方 Pi SDK `1.4.0` 合成运行时与 SSR UI 测试（`tests/member-operations-pack-{store,host,runtime,ui}.test.ts`）：**8/8 PASS**；
  - Studio & Enterprise 受影响回归（`tests/studio-*.test.ts tests/studio2-*.test.ts tests/enterprise-*.test.ts tests/member-operations-pack-*.test.ts`）：并发满载首次 338/358 PASS / 19 SKIP / 1 FAIL（`tests/studio-phase2-usage-host.test.ts` 竞态 `409 native_snapshot_incomplete`），单独复跑 **1/1 PASS**；
  - 统一会话、项目文件与语义上下文回归（`tests/agent-session*.test.ts tests/project-files*.test.ts tests/semantic-context-*.test.ts`）：**155/155 PASS**（0 fail / 0 skip）；
  - 隔离无头 Chromium 端到端产品验证（`tests/browser-member-operations-pack.py`）：**PASS**（0 page errors，覆盖设置→领域资产包 T03 SHA-256 核对/去重/原文抽屉→跨刷新持久→进入企业 Studio→建包→建设草案→一份预览→确认发布与分项回执→三层资源授权创建与撤回）；
  - `npm run build` + `npm run check:agent-sessions` + `npm audit --audit-level=high`：全部 **PASS**（退出码 0，`package.json` / `package-lock.json` 未变更）。
- [x] **S5 证据整理、分支推送与 Issue #111「实现交付」回执**
  - 编写 `openspec/changes/member-operations-enterprise-pack/result.md`（脱敏公开证据、命令、退出码、未验证项、四原则与 SDK 自检、兼容与 `--disable-member-pack` 回退）；
  - 核对 `git status` / 4 份冻结 OpenSpec 文件 SHA-256 一致 / 提交信息含 `Refs #111`，推送 `work/antigravity/issue-111-member-operations-pack` 并回读远端完整 SHA；
  - 在 Issue #111 提交规范「实现交付」评论并回读确认，停止写入分支，保持 Issue Open。

## 第二轮返工清单（对应 Controller 退回回执 `issuecomment-7072583615`，候选 `f56d1b1b363105fd55727d3e7c81a748da73bc98` 独立复核 FAIL）

- [x] **R1（P1）原权威发布及用途资格**：移除客户端自造成功回执与“查原回执”盲补成功；Host 确认发布直连真实 `StudioStore`/`MetricLibrary`/`SapMethodStore`/`EnterpriseMaterials` 并按原权威只读核查恢复；补齐正式/受限计算缺少首购历史、缺少样本试算、缺少原依赖与回执时禁止 `eligible`；确认前复核草案未漂移（`409 enterprise_pack_draft_changed`）；禁止未决选择自动回退首项与硬编码决定人；按事件发生日、门店与事件类型分别判定例外冲突，不将 `dataCutoffAt` 当作事件日。
- [x] **R2（P1）授权主体与底层取用**：新包无细粒度授权时默认不授予三层权限（保持既有无包普通项目原行为）；Host 校验并绑定授予方（`grantorVerifiedBy: 'host'`）与真实汇总资产身份/版本/粒度/期间；经统一 `member-pack-guard`（`pi.on('tool_call')`）同步收窄 Pi 原生运行工具（`read`/`bash`/`grep`/`find`/`ls`/`edit`/`write`/`powershell`/`codemode`）与 `read_input`/`studio-sources` 一致隔离并即时响应撤权；参考原文与包历史读取沿可信身份核验并脱敏未授权视图。
- [x] **R3（P1）建设会话与全景内化**：在统一 `studio_assets` 工具接线 `pack-read` / `pack-save-panorama` / `pack-upsert-entry` / `pack-upsert-purpose`，正常建设入口启动的原官方 Pi SDK `1.4.0` 会话盘点三份资料后直接保存可回查的全景、建议与用途；双线合入同一企业条目时合并保留双方 `referenceLinks` 与 `enterpriseSourceRefs`；参考原文按指定 `section` 真正切片返回原段（无匹配明确 `404`）。
- [x] **R4（P1）准确版本查读与报告采用**：`studio_assets catalog` 供给已固定包用途的准确原依赖与授权门店/汇总；`read-source` 按任务固定版本与当前授权校验供给（含升版后历史固定依赖回读）；`recordUse` 由 Host 从真实原生任务轨迹与真实 `060_reports/*` 文件字节/SHA-256 核验提取实际读取与报告身份（忽略客户端自报 `actualReads`，无读取证据保持 `pending`，实测错版判 `fail`），独立核验与作者声明分离；升级 Pi 运行时测试走完整 `catalog -> read-source -> read_input/read/bash -> 060_reports/* -> use/verify`。
- [x] **R5（P1）原回复反馈、原权威修订与独立再用**：原回复关联包反馈出错不再吞错；Host 从原生任务轨迹严格区分 `verified_actual_read` 与 `directory_only_unverified` / `clue_only_no_pack_read`（目录仅见不记 `usedPackVersion="1.0"`），从 `originalUserText` 保留原任务提问截止日（如 `2026-10-27`）不以包截止日（`2026-10-31`）覆盖；新增 `POST /feedback/:feedbackId/handle` 与 Studio 反馈面板出处/归属/原权威修订与独立新任务复验闭环。
- [x] **R6（P2）回退与归档边界**：`--disable-member-pack` 统一覆盖参考登记、资源授权、企业包全部写路径返回 `503 member_pack_disabled_readonly` 并验证三份落盘 JSON 字节无变化、获准历史只读可查；所有包写入无论是否传 `projectId` 均无条件校验活跃非归档项目（归档返回 `409 studio_project_read_only`）；补全归档/接续/回退回归并更新 `result.md`。
- [x] **R7 全面回归、真实浏览器复验、推送新候选 SHA 与 Issue #111 回报**：`npm run build` + `npm run check:agent-sessions` + `npm audit --audit-level=high` PASS；专项 10/10 PASS；统一会话/项目文件/语义上下文 155/155 PASS；Studio/Enterprise 331 PASS / 19 SKIP / 0 FAIL；隔离 Chromium 端到端 PASS（0 page errors）。

## 第三轮返工清单（对应 Controller 第二轮退回回执 `issuecomment-7073253456`，候选 `676085cd073f2fd1aea99f4d2c793419ba1cba8b` 独立复核 FAIL）

- [x] **R3-1（R1 · 原权威发布及用途资格）**：在任何原权威写入前校验冻结预览、指纹与草案指纹（杜绝过期预览返回 `409` 却已写入原 SAP 库）；`studio-source` 走原 Studio 完整 `qualifyRulePublication`/`qualifyFoundationSelection`/`validatePublicationRefs`/`qualifySelectedContributions`/`publish` 路径；`reconcile` 严格禁止将原确定 `failed` 或其他外部操作发布的版本记为旧请求成功（记录并核对原权威操作身份）；重发部分受影响用途时自动承接上一活跃版未变用途（避免独立定义从新任务目录消失）；历史回执重算仅读取冻结在版本快照中的就绪态与观察窗。
- [x] **R3-2（R2 · 授权主体与底层取用）**：授权创建与撤回核验真实可信的授予者/撤回者权责主体（不再用企业归属与资源存在冒充并硬写“Host 核定”），拒绝非授权消费项目自授或越权撤回；汇总授权沿原权威真实正文与范围核定结果、期间与粒度（不符拒 `409`）；包历史读取与目录供给规则完全一致过滤；受限项目启用隔离任务工作区（仅交付当前获准文件、禁用子会话/MCP/连接器/扩展、实时同步撤权删除、支持 macOS Seatbelt 受管边界与跨平台强制守卫），保持无包旧普通项目兼容。
- [x] **R3-3（R3 · 建设会话与全景内化）**：全景建议支持选择持久化与「按此建议携带原范围续建」及「点名用途直接起步」；草案界面展示真实参考原段列表与两线企业依据，并支持点查对应参考原段抽屉。
- [x] **R3-4（R4 · 准确查读与报告采用）**：`inspectTaskNativeEvidence` 按当前回复所在回合 `[turnStart..endIdx]` 精确提取读取与目录，杜绝无工具调用的后续回复串用前轮读取；`recordUse` 绑定具体回复/报告及真实作者采用声明；`evaluateUseVerdict` 要求完整读取全部期望/必要原依赖且具备绑定作者采用声明，不相关读取、部分读取或缺少采用声明一律保持 `pending`（不可 `pass`），错版判 `fail`。
- [x] **R3-5（R5 · 原回复反馈、原权威修订与独立再用）**：仅本回合实际完整读取本包依赖计为 `verified_actual_read`（无关读取不计入）；点击「转入原权威修订」/「在建设会话继续修订」真实在原 `StudioStore` 写入关联工作项与反馈并互链 ID；闭环 `verified` 强制要求独立新任务（`use.taskId` 不等于原反馈任务）、新版包（`toPackVersion !== fromPackVersion`）、真实已发布的新原资产修订版（`revisedRef !== targetRef` 且被新任务完整实读）与真实非空 `authorityUpdates`。
- [x] **R3-6（R6 · 回退与归档边界）**：`--disable-member-pack` 只读回退模式下彻底停止向新任务供给包用途与依赖（`purposes: []`, `pinnedVersion: null`, `readOnlyRollback: true`），保留已固定历史任务只读；验证原项目归档后同企活跃项目真实接续并记录 `activeOwnerProjectId` / `continuationHistory` 绑定。
- [x] **R3-7（全面正反例测试、回归、隔离 Chromium 端到端、文档与推送交付）**：针对每项退回反例补齐自动复现与修复验证（Store / Host / 真实官方 Pi SDK `1.4.0` / UI SSR / Chromium E2E），全套回归 + `build` + `check:agent-sessions` + `audit` 全绿，保留一二轮 FAIL 记录并追加第三轮记录于 `result.md`，推送新候选 SHA 并在 #111 回报。

## 第四轮返工清单（对应 Controller 第三轮退回回执 `issuecomment-7074301143`，候选 `014813194a619e5f4aea2515f5f2da5192e329d3` 独立复核 FAIL）

- [x] **R4-1（R1 · 固定版本唯一性与前驱校验及 UNKNOWN 原凭据校验）**：`preparePreview` 与 `validateConfirmPreconditions`（任何原权威写入前）严格校验版本号唯一（拒绝两份不同截止日/摘要的预览同发为 `v1.0`，返回 `409 enterprise_pack_version_exists`）与 `previousVersion` 必须匹配当前激活版（`409 enterprise_pack_previous_version_mismatch`）；`inspectAuthorityDependency` 与 `reconcileModuleReceipt` 对缺少原操作凭据（`authorityPublishedBy`/`authorityOperationId`）的 `unknown` 回执一律保持 `unknown`，不误判成功。
- [x] **R4-2（R2 · 资源专属原权责绑定、受管执行文件系统边界、省略 `allowedDataPaths` 默认拒绝与统一过滤）**：`resolveVerifiedGrantAuthority` 与 `verifySummaryAuthority` 将授予/撤回权责绑定到目标包/目标原权威资产的实际拥有体系与原权责项目，禁止同企业其他无关 Studio 体系越权授权或撤回；`evaluateResourceAccess` 与 `getProjectToolScope` 对省略 `allowedDataPaths` 的明细授权默认拒绝（`mode: 'deny-detail'` / `detail_data_path_not_authorized`），绝不放通整个 `020_clean`；`prepareRestrictedTaskWorkspace` 复用既有 `createProtectedExecutionScope`（`0o700` 隔离目录），`project-session.ts` 在 macOS 上经既有 `createProtectedTools`（Seatbelt）将原 `projectDirectory` 列入 `forbiddenRoots`、在 Linux 上沿隔离 `cwd` 与收紧守卫执行；`buildPackCatalogSummary`、`inspectPinnedSourceRead` 与 `redactPackForConsumer` 共用 `evaluatePurposeAccessForSubject`，并过滤未授权 `moduleReceipts`/`decisionsSnapshot`/`taskPins`/`useRecords`/`feedbackItems`。
- [x] **R4-3（R3 · 全景建议续建复用原用途与范围并接入原建设会话）**：`upsertPurpose` 在全景续建省略 `windowDays`/`stores` 时自动匹配并复用同一 `(purposeKey, subjectUnit)` 既有用途，保留原门店列表、30/90 日窗口、`scopeKey`、`tier` 与依赖不丢失；`StudioMemberPackPanel.handleContinueFromRecommendation` 显式保留既有用途字段，并调用 `onBuildGoal` 将续建目标与完成条件直接送入原 Studio 建设会话。
- [x] **R4-4（R4 · 原生会话本回合 `declare-use` 绑定与落盘独立核验凭据 `assess-use`）**：`POST /uses` 彻底忽略客户端自报 `authorDeclaration`，仅绑定原 `StudioStore.uses` 中与本回合及本报告精确匹配的真实原生 `studio_assets declare-use`；`POST /uses/:id/verify` 拒绝仅凭客户端布尔 `independentConfirmed: true` 判 `pass`，要求存在真实 `studio.uses` 记录及落盘 SHA-256 核验通过的独立评估报告（`assess-use` 或 `assessmentReportRef`）；无工具调用回合借用前轮报告/读取与声明一律保持 `pending`。
- [x] **R4-5（R5 · 受影响用途与同资产修订核验、同名报告防覆盖与取消不回写）**：`handleFeedback(..., { status: 'verified' })` 强制校验核验用途属于反馈受影响用途（`feedback_verification_purpose_mismatch`）、修订资产与原目标资产同一 `(authority, id)`（`feedback_verification_asset_identity_mismatch`，杜绝只读无关签到方法关闭退款反馈）、新版 `purposeManifest` 已替换为修订版且完整实读并具落盘 `assess-use` 通过；`syncWorkspaceReportsToProject` 引入持久报告账本与 `committed-reports` 不可变副本，后同步任务生成同名报告自动另存冲突安全路径（`*.task-<id>.ext`），绝不覆盖旧任务或已锁定报告；`settleProjectRun` 仅在 `outcome === 'completed'` 时同步报告，取消/失败时调用 `discardUncommittedWorkspaceReports` 清理未提交产出。
- [x] **R4-6（R6 · 回退模式零工作区创建与零文件复制及 `git diff --check` 清洁）**：`--disable-member-pack` 下 `getProjectToolScope`、`prepareRestrictedTaskWorkspace`、`syncWorkspaceReportsToProject` 与 `authorizeProjectDataPath` 立即短路，零新建 `member-pack-workspaces` 目录与文件复制；清除 `result.md` 尾行空白确保 `git diff --check` 零告警。
- [x] **R4-7（全面第四轮反例与回归、隔离 Chromium 端到端、文档与推送交付）**：补齐 Store/Host/Pi SDK `1.4.0`/UI SSR/Chromium E2E 全部第四轮反例与正例测试，全套回归 + `build` + `check:agent-sessions` + `audit` + `git diff --check` 全绿，保留一至三轮 FAIL 证据并追加第四轮记录于 `result.md`，推送新候选 SHA 并在 #111 回报。

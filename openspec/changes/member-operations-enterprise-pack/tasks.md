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

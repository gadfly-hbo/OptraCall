# 企业会员运营资产包首期：实现与隔离验证记录

- **关联 Issue**：[#111](https://github.com/gadfly-hbo/OptraCall/issues/111)
- **实现方**：`Antigravity/cdabef5b`
- **任务分支**：`work/antigravity/issue-111-member-operations-pack`
- **核定源码基线**：`8ad8564ca8d47ff27bd0b335456c99bfa1706f94`（`origin/main`，交付前复查仍为最新）
- **冻结领取包基线**：`6d6a2b640d80e2ec5bb46c979fa859aca82884bc`（已原位保留 4 份冻结 OpenSpec 文档并逐一核验 SHA-256 一致）
- **统一会话与 SDK 声明（IN01–IN07）**：
  - 工程规范版本：v1.12（`docs/engineering-workflow.md`）
  - 会话 Interface 版本：`Interface v3`（`src/host/agent-sessions.ts`），沿用既有项目任务 `projectId + taskId` 与 `studio_assets` 通道，不新建平行 Runtime 或独立审批流
  - 官方依赖锁定：未修改或升级 `@earendil-works/pi-coding-agent`（`1.4.0`）、Semantica（`0.7.0`）、`package.json` 或 `package-lock.json`

---

## 1. 七个产品环节交付对照

| 环节与条款 | 实现要点与修改路径 | 可重复核对证据 |
| --- | --- | --- |
| **1. 参考登记（§3、6.1、附录 A）** | `src/host/domain-reference-store.ts` + `src/host/ui/DomainPackSettingsPanel.tsx`（接入 `CapabilitySettings.tsx` 与 `App.tsx`）：支持在「设置 → 领域资产包」登记与检索行业/领域/标杆参考；同源同版跨企业线与会员线引用时自动合并路线不重复建项；同源同版正文 SHA-256 冲突时保留双份待核不静默覆盖；同源新版与旧版并存；缺件/占位源禁止标为原文可回查并拒绝 `readOriginal`；内置仓库模板 T01–T04 实时核验原文 SHA-256（Nike `T03`: `8c64c78a...b4895`，`T04`: `49a33bfc...200b7`）。 | [`tests/member-operations-pack-store.test.ts`](../../../tests/member-operations-pack-store.test.ts)、[`tests/member-operations-pack-host.test.ts`](../../../tests/member-operations-pack-host.test.ts)、[`tests/member-operations-pack-ui.test.ts`](../../../tests/member-operations-pack-ui.test.ts)、[`tests/browser-member-operations-pack.py`](../../../tests/browser-member-operations-pack.py) |
| **2. 首次全景与业务/资产双态分离（§2、6.1）** | `extensions/business-plugins/studio/enterprise-pack.ts` + `src/host/enterprise-pack-store.ts` + `src/host/ui/StudioMemberPackPanel.tsx`（接入 `StudioPage.tsx`）：支持独立于项目/人的企业会员运营包身份（按 `enterpriseId + domain` 锚定并关联 `systemId`）；保存带品牌/渠道/期间/截止日/依据出处的全景历史，严格区分业务开展状态（`active` / `not_launched` / `unknown`）与资产可用程度（`ready` / `definition_only` / `limited_calc` / `gap_material` / `gap_decision` / `not_needed`）；支持宽目标全景起手与点名具体用途直达。 | [`tests/member-operations-pack-store.test.ts`](../../../tests/member-operations-pack-store.test.ts)、[`tests/member-operations-pack-host.test.ts`](../../../tests/member-operations-pack-host.test.ts) |
| **3. 企业内化与两条路线同包共决（§2.2–3）** | `EnterprisePackStore.upsertEntry` 与 `upsertPurpose`：企业线与会员线合入同一企业包与同一企业决定（按 `entryKey` 合并路线并保留原参考版段与企业依据/有权决定）；跨人、跨项目及并发创建同一用途时按规范化键 `(enterpriseId, packId, purposeKey, subjectUnit, scopeKey, windowDays)` 去重复用同一工作项并追加多项目证据；`limited-calculation` 强制独立名称且保留原目标、已交付子集、剩余缺口与排除边界；支持事件日期、批准例外、未决重叠限域、观察窗不足待核（如 45 天 < 90 天）及退订用户强制排除出短信候选校验。 | [`extensions/business-plugins/studio/enterprise-pack.ts`](../../../extensions/business-plugins/studio/enterprise-pack.ts)、[`tests/member-operations-pack-store.test.ts`](../../../tests/member-operations-pack-store.test.ts)、[`tests/member-operations-pack-host.test.ts`](../../../tests/member-operations-pack-host.test.ts) |
| **4. 按用途一份预览与原权威分项发布（§4.1–4.2）** | `preparePreview` / `confirmPreview` / `reconcileReceipt`：生成带不可变摘要指纹的一份预览，冻结取舍、生效期、截止日、汇总粒度与权限边界；确认发布时按原权威（共享资产 / 会员规则 / SAP）记录分项回执，依赖缺失或失败/未知的计算用途自动挂起而独立定义参考继续可用；支持 `operationId` 幂等重试不重复发布，并支持查证原回执后追加恢复而不覆盖原失败/未知记录。 | [`src/host/enterprise-pack-store.ts`](../../../src/host/enterprise-pack-store.ts)、[`src/host/member-pack-host.ts`](../../../src/host/member-pack-host.ts)、[`tests/member-operations-pack-store.test.ts`](../../../tests/member-operations-pack-store.test.ts)、[`tests/browser-member-operations-pack.py`](../../../tests/browser-member-operations-pack.py) |
| **5. 首次实际使用、三层资源鉴权与底层文件一致隔离（§4.2–4.4、6.2）** | `src/host/resource-grant-store.ts` + `src/host/member-pack-host.ts` + `src/host/studio-host.ts` + `src/host/studio-sources.ts` + `src/host/project-files.ts` + `src/host/server.ts`：Host 基于持久资源授权记录区分三层操作（`read-definition` / `cite-summary` / `read-detail-recalculate`），绝不信任客户端角色名；任务首次调 `studio_assets catalog` 固定当前有效包版本（中途包升级不影响进行中任务，独立新任务发现新版）；受限明细项目在 `studio_assets` 目录、`studio-sources` 数据源读取与 `project-files` (`read_input` 读 `020_clean/*`) 执行一致的门店路径隔离（如仅获准 `starbridge_orders.csv`，越权读取 `willowbank_orders.csv` 直接 `403` 阻断，不把不可读门店记为零）；撤权立即生效；`SemanticContextPanel.tsx` 分层展示目录供给、固定版本、权限层次与独立核验边界。 | [`tests/member-operations-pack-host.test.ts`](../../../tests/member-operations-pack-host.test.ts)、[`tests/member-operations-pack-runtime.test.ts`](../../../tests/member-operations-pack-runtime.test.ts)（真实官方 Pi SDK `1.4.0` + 合成 ToolProvider）、[`tests/member-operations-pack-ui.test.ts`](../../../tests/member-operations-pack-ui.test.ts) |
| **6. 原回复一次反馈与六类归属分流（§5）** | `EnterprisePackStore.submitFeedback` + `StudioFeedbackDialog.tsx`：原回复旁提交反馈可选择 §5 六类归属（本次误算回原任务更正、共享退款映射回原资产、SAP 公式回 SAP、会员政策回会员域、经营决定回 Case、临时假设留原任务）；按 `(packVersion, purposeId, category, normalizedTitle)` 同题同版去重追加原回复证据而不重复建项；仅关联原回复、原报告与当时准确版本，不篡改既有已发布的原权威或旧报告。 | [`src/host/ui/StudioFeedbackDialog.tsx`](../../../src/host/ui/StudioFeedbackDialog.tsx)、[`tests/member-operations-pack-host.test.ts`](../../../tests/member-operations-pack-host.test.ts)、[`tests/member-operations-pack-runtime.test.ts`](../../../tests/member-operations-pack-runtime.test.ts) |
| **7. 新版复用、一笔应变一笔保留与跨项目延续（§4.3–5、6.3）** | 修订形成 `v1.1` 后自动为原 `v1.0` 使用记录追加非破坏性升级影响说明（原报告、原截止日与历史字节完全保留）；独立新任务通过真实 `studio_assets catalog` 自动发现 `v1.1` 并完成跨月全额退款修订复算对照（10 月跨月退款订单变更为无效，有效保留订单保持不变）；归档项目后保持只读阻断写入，同企业另一活跃项目按原包 ID 无缝延续建设；支持 `--disable-member-pack` 回退为只读保留历史模式。 | [`tests/member-operations-pack-host.test.ts`](../../../tests/member-operations-pack-host.test.ts)、[`tests/member-operations-pack-runtime.test.ts`](../../../tests/member-operations-pack-runtime.test.ts) |

---

## 2. 实际执行验证、问题修复与命令证据

### 2.1 自动化测试与静态检查

| 验证项 | 实际执行命令 | 结果与计数 | 退出码 |
| --- | --- | --- | --- |
| **类型检查、产品构建与构建印章** | `npm run build` | **PASS**（`tsc --noEmit` + `frontend build` + `stamp-build`） | `0` |
| **统一会话边界与 SDK 治理检查** | `npm run check:agent-sessions` | **PASS**（`Agent session integration boundary and pinned SDK materials: PASS`） | `0` |
| **高危依赖安全审计** | `npm audit --audit-level=high` | **PASS**（0 high / 0 critical；基线既有 2 项 moderate 来自锁定 `@earendil-works/pi-coding-agent@1.4.0` 的 `minimatch`，未增改任何依赖） | `0` |
| **新增会员运营包全套测试（存储 / Host / Pi SDK 运行时 / UI SSR）** | `node --test --test-concurrency=2 tests/member-operations-pack-store.test.ts tests/member-operations-pack-host.test.ts tests/member-operations-pack-runtime.test.ts tests/member-operations-pack-ui.test.ts` | **8/8 PASS**（0 fail / 0 skip，耗时 `14.9s`） | `0` |
| **统一会话、项目文件与语义上下文受影响回归** | `node --test --test-concurrency=2 tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-files.test.ts tests/project-files-host.test.ts tests/semantic-context-history.test.ts tests/semantic-context-host-client.test.ts tests/semantic-context-host.test.ts tests/semantic-context-reader.test.ts tests/semantic-context-runtime.test.ts tests/semantic-context-service.test.ts tests/semantic-context-ui.test.ts tests/semantic-context-write.test.ts` | **155/155 PASS**（0 fail / 0 skip，耗时 `111.0s`） | `0` |
| **Studio & Enterprise 回归套件** | `node --test tests/studio-*.test.ts tests/studio2-*.test.ts tests/enterprise-*.test.ts tests/member-operations-pack-*.test.ts` | 首跑（2-vCPU 未限并发且与上组回归同时执行）：**338 PASS / 19 SKIP / 1 FAIL**（`tests/studio-phase2-usage-host.test.ts` 轮询竞态 `409 native_snapshot_incomplete`）；随后单独复跑 `node --test tests/studio-phase2-usage-host.test.ts`：**1/1 PASS**（`10.7s`） | 首跑 `1` / 复跑 `0` |
| **隔离无头 Google Chrome 产品 UI 端到端验证** | `python3 tests/browser-member-operations-pack.py`（隔离 `DATA_ROOT`/`PROJECTS_ROOT` + 真实 `host-entry.mjs` 托管 `dist/`） | **PASS**（`0 pageerrors`；验证设置→领域资产包 Nike T03 SHA-256 核对、同源同版去重、原文抽屉、跨刷新持久化、跳转企业 Studio、建包、建设草案、一份预览抽屉、确认发布与分项回执 `P-1.0-1-1`、三层资源授权创建与撤回） | `0` |

### 2.2 实现与验证过程中发现并修复的问题（过程留痕）

1. **存储隔离避免干扰既有 `StudioStore.load()`（503 `studio_index_missing`）**：初版将新存储置于 `<dataRoot>/studio/`，在 `studio/index.json` 尚未初始化前触发既有 `StudioStore.load()` 的目录非空保护。已将三份新存储迁至独立 `<dataRoot>/member-packs/`（`domain-references.json`、`resource-grants.json`、`enterprise-packs.json`），对既有 Studio 存储实现零侵入与无风险回退。
2. **`StudioMemberPackPanel` 一份预览切换与分项回执 ID 唯一性**：在扩展真实浏览器验证前复查发现，在「建设草案」标签点击「生成一份发布预览」后未自动切换至「一份预览与分项回执」标签显示抽屉，且多用途同批次生成分项回执 `requestId` 缺少用途序号。已同步修复并通过真实无头 Chromium 点验通过。
3. **`EnterprisePackStore.upsertPurpose` 缺失 `scope` 校验加固**：扩展浏览器测试时发现请求体省略 `scope` 对象会触发 `TypeError`（HTTP 500）。已补显式校验返回受控 `400 invalid_purpose_scope`。
4. **AST 会话边界合规**：初版 UI 测试使用动态变量 `import(file)` 被 `npm run check:agent-sessions` 拦截，已改为字面量导入路径并通过检查。

---

## 3. 未验证项与诚实边界（`NOT_RUN`）

以下事项在当前云端 Linux 沙箱环境中**未执行（`NOT_RUN`）**，明确保留不宣称通过，交由 Codex / 用户在对应授权环境核验：

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| **6 份 MacBook 私有参考原文实体回读** | `NOT_RUN`（机制以合成替身 + 仓库 Nike T03/T04 实文件已 `PASS`） | 云端 VM 不含 `DAP-MEMBER-001`、`DAP-PRODUCT-001`、`DAP-STORE-001`、`DAP-SUPPLY-001`、`DAP-MARKETING-001`、`DAP-BENCH-JNBY-MEMBER-001` 六份本机原文；两份仓库内置 Nike 模板（`T03` / `T04`）已实测与 `acceptance.md` 第 4 节 SHA-256 逐字节一致，其余六份登记与原文回读需在获准 MacBook/Mini 设备实核。 |
| **全仓 400+ 测试文件完整 `npm run test`** | `NOT_RUN`（本地 2-vCPU 时长限制） | 本次已跑满全部受影响的 Studio、Enterprise、Agent Session、Project Files、Semantic Context 及新增会员运营包套件（合计 500+ 用例）；全仓回归由 Codex 在 PR/CI 及 Mac mini 补全。 |
| **真实商业大模型首轮分析与验收人盲验答案核对** | `NOT_RUN` | 云端 VM 无真实商业模型凭据及调用授权，未产生外部付费模型调用；已用官方 Pi SDK `1.4.0` + 合成 ToolProvider 验证真实工具调用、目录发现、版本固定、`read_input` 授权拦截、反馈与修订再用协议边界；真实模型分析与验收人保管的盲验答案由 controller/验收人按 `acceptance.md` §5–6 独立执行。 |
| **企业首轮按用途已可用 / 真实修订闭环已验证 / 用户最终产品验收** | `NOT_RUN` | 按 `acceptance.md` §6.3，本轮仅交付可交验的工程候选（合成资料隔离验证）；企业首轮真实业务使用、真实修订闭环、独立非作者复核、PR/CI、合并 `main` 及 Mac mini / MacBook 服务切换均分别核定。 |

---

## 4. 四点产品原则与 SDK 治理自检（开发方自查，不替代独立复核）

- **Host 管环境**：Host 负责参考登记与 SHA-256 校验、企业包持久化与跨项目并发去重、不可变发布预览指纹与分项回执、任务启动版本固定、三层资源授权（`read-definition` / `cite-summary` / `read-detail-recalculate`）及 `studio-sources` / `project-files` 底层文件读取一致拦截、以及 `--disable-member-pack` 回退开关；不在 Host 编造业务分析结论或替代 Agent 推理。
- **Agent 自主执行**：普通分析任务与建设任务继续由原官方 Pi SDK `1.4.0` 会话经既有 `studio_assets`（`catalog` / `read-source`）与 `read_input` 自主盘点、查读、计算与纠错；受限范围的阻断返回明确原因，由 Agent 自主调整答复边界而不将不可读门店视作 0。
- **优先复用 Pi 与 OptraCall 已有能力**：复用既有 `Interface v3`、`StudioHost`、`operations.run` 幂等器、`StudioEnterpriseScopes`、`StudioSources`、`ProjectFilesPort`、`CapabilitySettings`、`StudioPage`、`SemanticContextPanel` 与 `StudioFeedbackDialog`；未改动官方 Pi SDK（`1.4.0`）、Semantica（`0.7.0`）或任何第三方依赖。
- **减少人的操作**：设置与企业 Studio 互通直达同一企业包；支持跨项目并发自动去重；一份预览集中确认必要取舍与权限；日常分析直接在项目窗口提问并在「本次依据」查看固定版本，发现问题在原回复旁反馈一次即可分流归属。

---

## 5. 向后兼容与回退方式

- **存储与数据兼容**：新增持久化文件全部独立位于 `<dataRoot>/member-packs/`（`domain-references.json`、`resource-grants.json`、`enterprise-packs.json`），不修改既有 `<dataRoot>/studio/index.json`、企业资料库、SAP、Case 或历史项目会话 JSONL；未配置细粒度资源授权时，普通既有项目与任务完全沿用原有授权边界，无需数据迁移。
- **运行时回退开关（`--disable-member-pack`）**：启动 Host 时传入 `--disable-member-pack`（或在 `createHost` 传 `memberPackEnabled: false`），会员运营包所有写入路由立即返回 `503 member_pack_disabled_readonly`，同时完整保留只读查阅历史发布版本、回执、使用依据与已注册参考，不影响既有企业资料、SAP、Case 与普通分析任务（已于 `tests/member-operations-pack-host.test.ts` 实测验证）。
- **代码回退**：本变更集中于独立新增模块及 10 个既有文件的最小接缝（`+92 / -22` 行），若需彻底回退直接撤销分支/合并提交即可，已落盘的 `<dataRoot>/member-packs/` 可独立保留或只读归档，不触发旧版数据损坏。

---

## 6. 第二轮返工记录（对应独立复核退回 `issuecomment-7072583615`）

### 6.1 第一轮独立复核 FAIL 留痕（原样保留）

- **被退回候选 SHA**：`f56d1b1b363105fd55727d3e7c81a748da73bc98`（分支 `work/antigravity/issue-111-member-operations-pack`）
- **审核退回回执**：`OC｜SAA_Studio_3` 于 [Issue #111 comment-7072583615](https://github.com/gadfly-hbo/OptraCall/issues/111#issuecomment-7072583615) 判定独立复核未通过（**5 项 P1 + 1 项 P2**），退回返工；领取方于 [Issue #111 comment-7072626586](https://github.com/gadfly-hbo/OptraCall/issues/111#issuecomment-7072626586) 确认接回返工。
- 第一轮交付记录与既有并发首跑失败留痕保留于上文第 1–5 节，未篡改或抹去。

### 6.2 逐项修复对照（5 × P1 + 1 × P2）

| 退回项 | 严重级 | 根因与修复要点（核心代码路径） | 正常入口与反例验证 |
| --- | --- | --- | --- |
| **R1 · 原权威发布及用途资格** | **P1** | `src/host/studio-host.ts` + `src/host/member-pack-host.ts` + `src/host/enterprise-pack-store.ts` + `extensions/business-plugins/studio/enterprise-pack.ts` + `src/host/ui/StudioMemberPackPanel.tsx` + `src/host/ui/member-pack-client.ts`：① `POST /confirm` 与 `POST /reconcile` 彻底忽略客户端传入的 `moduleReceipts` 与 `status`，由 Host 直连真实 `StudioStore`、`MetricLibrary`、`SapMethodStore`、`EnterpriseMaterialsStore` 执行核验/发布并按原权威只读回查核对；② 预览强制显式选定选项与决定人（移除首项静默回退与硬编码角色），计算用途缺首购历史（`restricted`）、缺定义/映射/样算核验或无必要依赖（`suspended`）绝不进入 `eligible`；③ `confirmPreview` 复算 `draftFingerprint`，草案漂移返回 `409 enterprise_pack_draft_changed`；④ `evaluateExceptionsAndWindow` 按事件发生日、门店与事件类型分别判重叠，不再误将 `dataCutoffAt` 当作事件日。 | Store 单测、Host 集成（不存在 SAP 指标 + 客户端伪造成功回执仍判 `failed`/`suspended`，只读核对保持失败；真实 SAP 模拟 `unknown` 后发布实包再只读核对恢复 `succeeded` 且保留原 `unknown` 回执；草案漂移 `409`）、隔离 Chromium 端到端全部 **PASS**。 |
| **R2 · 授权主体与底层取用** | **P1** | `src/host/member-pack-host.ts` + `src/host/studio-host.ts` + `src/agent/project-runtime.ts` + `src/agent/project-session.ts` + `src/host/server.ts`：① 新企业会员包无有效项目授权时默认拒绝（`purposes: []`, `authorizationRequired: true`），保持既有无包普通项目兼容；② `POST /api/studio/resource-grants` 由 Host 绑定 `grantorVerifiedBy: 'host'` 并通过 `verifySummaryAuthority` 实查原 Studio/企业资料/SAP 汇总资产与 SHA-256（不存在汇总拒 `404`）；③ 通过统一 IPC 能力 `member-pack-guard` 在原官方 Pi SDK `pi.on('tool_call')` 实时收窄 `read`/`write`/`edit`/`grep`/`find`/`ls`/`bash`/`powershell`/`codemode` 与 `read_input`/`studio-sources` 一致执行门店/文件白名单并即时响应撤权；④ 参考原文与包查询校验企业/项目归属并对未授权视图脱敏。 | Host 集成（未授权项目脱敏、伪造汇总 `404`、Host 核定授予方、即时撤权）、真实官方 Pi SDK `1.4.0` 运行时（未授权项目默认拒绝；仅定义项目调 Pi 原生 `read` 被拒；星桥项目调 `read_input`/`read`/`bash` 读 `willowbank_orders.csv` 全部被拒，读 `starbridge_orders.csv` 并写 `060_reports/*` 放行）全部 **PASS**。 |
| **R3 · 建设会话与全景内化** | **P1** | `src/agent/studio.ts` + `src/host/studio-host.ts` + `src/host/enterprise-pack-store.ts` + `src/host/domain-reference-store.ts`：① 在既有 `studio_assets` 工具扩展 `pack-read` / `pack-save-panorama` / `pack-upsert-entry` / `pack-upsert-purpose`，建设任务上下文注入当前包摘要，原 Pi 会话通读资料后可直接将全景、双线条目与用途草案持久化入包；② `upsertEntry` 合入双路线时合并去重 `routes`、`referenceLinks`、`enterpriseSourceRefs`、`exceptions` 与 `enterpriseBasis`，不再覆盖路线一来源；③ `DomainReferenceStore.readOriginal(id, section)` 支持行号范围与 Markdown 章节真切片返回 `isExcerpt: true` 与 `lineRange`（无匹配返回 `404`）。 | 真实官方 Pi SDK `1.4.0` 正常建设任务（读取 `member_policy.md` / `monthly_report.md` / `order_fields.csv` 并调用 `pack-save-panorama` + 双路线 `pack-upsert-entry` + `pack-upsert-purpose` + `pack-read` 落盘核验）、Store & Host 章节切片正反例全部 **PASS**。 |
| **R4 · 准确版本查读与报告采用** | **P1** | `src/host/member-pack-host.ts` + `src/host/studio-host.ts` + `src/host/ui/SemanticContextPanel.tsx`：① `studio_assets catalog` 供给已固定版本的准确原依赖 `dependencies`、获准门店与获准汇总；② `read-source` 通过 `inspectPinnedSourceRead` 校验任务固定版本与当前授权，支持升版后旧任务按 `{ historical: true }` 继续读取原固定依赖并附 `pinnedPack`；③ `POST /uses` 由 Host 从真实原生 Pi 任务轨迹提取 `catalogSupplied` 与 `actualReads` 并核验 `060_reports/*` 磁盘文件字节与 SHA-256（拒绝客户端自报读取，无读取保持 `pending`，错版判 `fail`）；④ `SemanticContextPanel` 展示固定依赖、获准门店/汇总、默认拒绝提示与 `pinnedPack`。 | 真实官方 Pi SDK `1.4.0` 运行时（完整 `catalog -> read-source -> read_input/read/bash -> 060_reports/* -> POST /uses -> POST /uses/:id/verify`；升版 `v1.1` 后旧任务仍固定 `v1.0` 并读回旧版 `refundV1Ref`）、UI SSR 全部 **PASS**。 |
| **R5 · 原回复反馈、原权威修订与独立再用** | **P1** | `src/host/member-pack-host.ts` + `src/host/enterprise-pack-store.ts` + `src/host/ui/StudioFeedbackDialog.tsx` + `src/host/ui/StudioMemberPackPanel.tsx`：① `StudioFeedbackDialog` 不再吞错，如实回显错误或 `adoptionBasis`；② `POST /feedback` 从真实原生轨迹区分 `verified_actual_read` 与 `directory_only_unverified` / `clue_only_no_pack_read`（目录仅见绝不记为已用 `v1.0`），并从 `originalUserText` 提取原任务截止日（且排除注入 JSON 的 `dataCutoffAt` 键），不再以包截止日覆盖任务截止日；③ 新增 `POST /feedback/:feedbackId/handle`（校验真实原权威修订版与独立复算 `pass` 使用记录方允许 `verified` 闭环）及 Studio 反馈处置界面。 | 真实官方 Pi SDK `1.4.0` 运行时（仅看目录任务提问截止 `2026-10-27` vs 包截止 `2026-10-31`：`adoptionBasis === 'directory_only_unverified'`、`usedPackVersion === undefined`、`taskCutoffAt === '2026-10-27'`、`packDataCutoffAt === '2026-10-31'`；实际读取任务 `verified_actual_read` + 同题去重 + 转原权威修订 `v1.1` + 独立新任务 Python 复算证明 `C07` 排除、`C13` 保留 + 原 `v1.0` 报告字节未改 + 闭环 `verified`）全部 **PASS**。 |
| **R6 · 回退与归档边界** | **P2** | `src/host/domain-reference-store.ts` + `src/host/resource-grant-store.ts` + `src/host/enterprise-pack-store.ts` + `src/host/member-pack-host.ts` + `src/host/ui/{DomainPackSettingsPanel,StudioMemberPackPanel}.tsx`：① `--disable-member-pack` / `memberPackEnabled: false` 统一将参考、授权、企业包三份 Store 置为 `readOnlyMode: true`，全部写路由返回 `503 member_pack_disabled_readonly`，三份落盘 JSON 字节零变更，只读回查保持可用；② `assertWritablePackProject` 无论请求是否传 `projectId`（省略时回退体系主建设执行项目）均无条件拦截归档项目写入（`409 studio_project_read_only`）。 | Store 单测 + Host 集成（显式与省略 `projectId` 归档均返回 `409`；活跃同企项目沿原包 ID 延续；`memberPackEnabled: false` 覆盖参考/授权/撤权/企业包全部写路径返回 `503` 且三份 JSON SHA-256 逐字节不变）全部 **PASS**。 |

### 6.3 第二轮实际执行验证与命令证据

| 验证项 | 实际执行命令 | 结果与计数 | 退出码 |
| --- | --- | --- | --- |
| **类型检查、产品构建与构建印章** | `npm run build` | **PASS**（`tsc --noEmit` + `frontend build` + `stamp-build`） | `0` |
| **统一会话边界与 SDK 治理检查** | `npm run check:agent-sessions` | **PASS**（`Agent session integration boundary and pinned SDK materials: PASS`） | `0` |
| **高危依赖安全审计** | `npm audit --audit-level=high` | **PASS**（0 high / 0 critical；基线既有 2 项 moderate 来自锁定 `@earendil-works/pi-coding-agent@1.4.0` 的 `minimatch`，未改动任何依赖） | `0` |
| **会员运营包全套专项与反例测试（Store / Host / Pi SDK `1.4.0` Runtime / UI SSR）** | `node --test --test-concurrency=2 tests/member-operations-pack-store.test.ts tests/member-operations-pack-host.test.ts tests/member-operations-pack-runtime.test.ts tests/member-operations-pack-ui.test.ts` | **10/10 PASS**（0 fail / 0 skip，耗时 `24.4s`） | `0` |
| **统一会话、项目文件与语义上下文回归** | `node --test --test-concurrency=2 tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-files.test.ts tests/project-files-host.test.ts tests/semantic-context-history.test.ts tests/semantic-context-host-client.test.ts tests/semantic-context-host.test.ts tests/semantic-context-reader.test.ts tests/semantic-context-runtime.test.ts tests/semantic-context-service.test.ts tests/semantic-context-ui.test.ts tests/semantic-context-write.test.ts` | **155/155 PASS**（0 fail / 0 skip，耗时 `87.0s`） | `0` |
| **Studio / Studio2 / Enterprise 全套回归** | `node --test --test-concurrency=2 tests/studio-*.test.ts tests/studio2-*.test.ts tests/enterprise-*.test.ts` | **331 PASS / 19 SKIP / 0 FAIL**（耗时 `172.0s`） | `0` |
| **隔离无头 Chromium 产品端到端验证** | `python3 tests/browser-member-operations-pack.py` | **PASS**（`0 pageerrors`；验证设置 T03 SHA-256/去重/原文抽屉→Studio 建包→显式选定选项与决定人→预览确认真实原权威：不存在 SAP 指标判 `failed`/`suspended` 且点「只读查原权威并核对」保持失败，真实启用企业资料判 `succeeded`/`eligible`→Host 核定授予方与路径白名单授权创建及撤回） | `0` |

### 6.4 第二轮未验证项（与第一轮边界一致，诚实保留 `NOT_RUN`）

- **6 份 MacBook 私有参考原文实体回读**：`NOT_RUN`（云端 VM 不含私有机密原文，仅核验仓库公开 Nike `T03`/`T04` 及合成替身）。
- **全仓 400+ 测试文件完整 `npm run test`**：`NOT_RUN`（本轮实跑受影响全部套件共 496 PASS / 19 SKIP / 0 FAIL；全仓 CI 交由 PR/Controller 补跑）。
- **真实商业大模型分析与验收人盲验答案核对 / 独立非作者复核 / PR 与 `main` 合并 / 设备切换**：`NOT_RUN`（未产生外部商业模型调用，交由 `OC｜SAA_Studio_3` 复验）。

---

## 7. 第三轮返工记录（对应独立复核退回 `issuecomment-7073253456`）

### 7.1 第一轮与第二轮独立复核 FAIL 留痕（原样完整保留）

- **第一轮被退回候选 SHA**：`f56d1b1b363105fd55727d3e7c81a748da73bc98`（审核退回回执：[Issue #111 comment-7072583615](https://github.com/gadfly-hbo/OptraCall/issues/111#issuecomment-7072583615)）。
- **第二轮被退回候选 SHA**：`676085cd073f2fd1aea99f4d2c793419ba1cba8b`（审核退回回执：[Issue #111 comment-7073253456](https://github.com/gadfly-hbo/OptraCall/issues/111#issuecomment-7073253456)，`OC｜SAA_Studio_3` 确认宽目标与点名用途正常起步、不存在 SAP 挂起计算用途及三份 Store 只读回退写拦截已通过，但指出 **8 项 P1 + 1 项 P2** 阻断问题退回继续返工）。
- **第三轮返工接回回执**：领取方 `Antigravity/cdabef5b` 于 [Issue #111 comment-7073272175](https://github.com/gadfly-hbo/OptraCall/issues/111#issuecomment-7073272175) 确认接回，在单写者分支 `work/antigravity/issue-111-member-operations-pack` 基于 `676085cd073f2fd1aea99f4d2c793419ba1cba8b` 连续推进。前两轮交付与 FAIL 证据完整保留于上文第 1–6 节。

### 7.2 第三轮逐项修复对照（8 × P1 + 1 × P2）

| 退回项 | 严重级 | 根因与修复要点（核心代码路径） | 正常入口与反例验证 |
| --- | --- | --- | --- |
| **1. 发布副作用、选择性重发与冻结快照（R1）** | **P1** | `src/host/member-pack-host.ts` + `src/host/enterprise-pack-store.ts` + `src/host/studio-host.ts`：① `POST /confirm` 在触发任何原权威写入前先执行 `packs.validateConfirmPreconditions(packId, previewId, fingerprint)`，过期/草案漂移直接返回 `409 enterprise_pack_draft_changed`，原 SAP/Studio 库零写入副作用；② `studio-source` 候选依赖走原 `StudioHost` 完整 `qualifyRulePublication` / `qualifyFoundationSelection` / `validatePublicationRefs` / `qualifySelectedContributions` / `preparePublication` / `publish` 校验发布链路，禁止直接调用 `store.confirmPublication`；③ 发布回执记录原权威操作标识（`authorityPublishedBy` / `authorityOperationId`），`reconcile` 拒绝将原 `failed` 回执改写为 `succeeded`（`409 enterprise_pack_failed_receipt_not_reconcilable`），且对 `unknown` 回执核对原操作身份，拒绝将其他独立操作发布的同版资产误记为原请求成功；④ 仅重发部分受影响用途时，`confirmPreview` 自动从上一激活版本继承未变更的合格用途（标记 `carriedOverFromVersion`），不再使未变独立定义从新任务目录消失；⑤ `preparePreview` 将 `observationWindowDays`、`availableHistoryDays`、`evidenceReadiness` 冻结入 `purposeSnapshots`，`recomputePurposeEligibility` 按冻结快照核定，不受后续草案改动干扰。 | Store 单测 + Host 集成：① 预览未发布 SAP 草案后改动用途再 `confirm` 返回 `409`，实查 `/api/metric-factory/library` 证实该指标完全未入库（零副作用）；② 原请求 `unknown` 后由外部 `publishedBy: 'synthetic-reviewer'` 独立发布同版指标，`reconcile` 仍保持 `unknown` / `suspended`；仅当原包操作标识一致时 `reconcile` 恢复 `succeeded`；③ `v1.2` 仅重发 `calcPurposeId` 时，`defPurposeId` 自动带入 `v1.2` 并保持 `eligible`；④ 发布后改动草案 `sampleCalculation: 'pending'` 不影响历史版本 `reconcile`。全部 **PASS**。 |
| **2. 授予/撤回原权责核实与汇总期间/粒度核验（R2）** | **P1** | `src/host/member-pack-host.ts` + `src/host/studio-host.ts` + `src/host/resource-grant-store.ts` + `src/host/ui/StudioMemberPackPanel.tsx`：① `resolveVerifiedGrantAuthority` 要求 `POST /api/studio/resource-grants` 与 `/revoke` 必须显式提供 `grantorProjectId` / `revokerProjectId`，并实查该项目必须为当前企业非归档原权责主体（Studio 体系执行归属项目、包接续归属项目或权威汇总资产归属项目），省略或普通消费项目越权一律拒 `403 resource_grantor_not_authorized` / `resource_revoker_not_authorized`；② `verifySummaryAuthority` 新增 `assertSummaryScopeMatchesAsset`，实查原权威汇总正文/范围的期间（`YYYY-MM` 重叠）与粒度（如 `store-month` 门店月度汇总禁止越权按 `member-day` 授权），不符拒 `409 summary_scope_mismatch`；③ `redactPackForConsumer` 对 `packRevisions`、`purposeManifests`、`dependencies` 与 `buildPackCatalogSummary` 采用完全一致的授权过滤规则，未授权/已撤权项目读取包详情时 `packRevisions: []`。 | Host 集成：① 省略 `grantorProjectId` 或用普通分析项目 `projStar` 发起授权/撤权均返回 `403`；② 对 `2026-09` 门店月报汇总申请 `2026-10` 期间或 `member-day` 粒度授权均返回 `409 summary_scope_mismatch`；③ 原权责项目 `projBuild` 授权与撤权成功并记录真实 `grantorProjectId` / `revokedByProjectId`；④ 未授权项目 `GET /api/studio/enterprise-packs/:id?projectId=projUngranted` 返回 `packRevisions: []`。全部 **PASS**。 |
| **3. 受限项目按任务物理隔离沙箱、禁用子会话/连接器与撤权即时物理清除（R2）** | **P1** | `src/host/member-pack-host.ts` + `src/agent/project-runtime.ts` + `src/agent/project-session.ts` + `src/host/server.ts`：① 受限资源授权任务启动/运行时由 `prepareRestrictedTaskWorkspace` 构建按任务物理隔离沙箱 `<dataRoot>/member-pack-workspaces/<projectId>/<taskId>/{020_clean,060_reports}`，仅将当前有效 `allowedDataPaths` 获准明细文件只读拷入沙箱 `020_clean`（`deny-detail` 项目为空目录），未授权门店文件在沙箱中物理不存在；② `project-session.ts` 在受限沙箱模式下将 Pi 工作目录设为沙箱 `020_clean`，彻底关闭 `subagent`（`delegation = false`）、MCP 连接器（`disabledBuiltinExtensions: ['mcp']`、`tradeAreaConnector`/`weatherConnector` 置空）、模拟与模型包工具及外部扩展（`noExtensions: true, noSkills: true`），同时保留 `member-pack-guard` 拦截越界路径；③ 撤回授权时 `syncActiveWorkspacesForProject` 立即从所有活跃任务沙箱物理删除已撤权文件；④ 运行收尾及记录采用前通过 `syncWorkspaceReportsToProject` 将沙箱 `060_reports` 产出同步回项目 `060_reports`。 | 真实官方 Pi SDK `1.4.0` 运行时：① 星桥受限任务 `snapshot.tools` 不含 `subagent`，Python 实测 `os.getcwd()` 位于 `member-pack-workspaces` 隔离沙箱，沙箱磁盘仅存在 `starbridge_orders.csv` 而物理不存在 `willowbank_orders.csv`；② 沙箱内 Python 计算写出的 `../060_reports/repurchase-v1.0.json` 准确同步回项目 `060_reports`；③ 会话运行中撤回星桥授权，沙箱磁盘上的 `starbridge_orders.csv` 立即被物理清除且会话内 `read` 立即被拒。全部 **PASS**。 |
| **4. 回合级读取隔离、作者采用声明与严格独立核验（R4）** | **P1** | `src/host/member-pack-host.ts` + `src/host/enterprise-pack-store.ts` + `extensions/business-plugins/studio/enterprise-pack.ts`：① `inspectTaskNativeEvidence` 严格按当前助手回复所属回合 `[turnStartIdx + 1 .. endIdx]` 提取 `actualReads` 与 `observedDirectoryVersion`，无工具调用的后续回复绝不继承前序回合读取；② `POST /uses` 仅绑定显式传入的 `authorDeclaration` 或原 Studio `declare-use` 真实记录（绝不伪造声明）；③ `evaluateUseVerdict` 与 `verifyUse` 校验固定版本 `purposeManifest` 的全部必需依赖 `requiredRefs`：任一依赖读到错版优先判 `'fail'`；缺少任一必需依赖完整读取（`complete === true`）、仅读无关资料或缺少绑定 `authorDeclaration` 一律保持 `'pending'`（绝不判 `'pass'`）。 | Store 单测 + 真实官方 Pi SDK `1.4.0` 运行时：① `Task A` 第 1 轮读 2 项依赖后，第 2 轮不调任何工具直接回复，从第 2 轮回复提交反馈的 `usedAssetRefs` 为 `[]`、`adoptionBasis` 非 `verified_actual_read`；② 部分读取（`complete: false`）、仅读无关资料、或 `POST /uses` 未提供 `authorDeclaration` 时，`POST /uses/:id/verify` 严格保持 `'pending'`；绑定 `authorDeclaration` 且完整读齐全部依赖后核验为 `'pass'`。全部 **PASS**。 |
| **5. 反馈本轮依赖核实、原 Studio 工作项/反馈联动与严格独立闭环（R5）** | **P1** | `src/host/member-pack-host.ts` + `src/host/enterprise-pack-store.ts` + `src/host/ui/StudioMemberPackPanel.tsx`：① `POST /feedback` 仅当当前回复本回合完整读取了属于该包固定版本的实际依赖（或绑定了该精确 `(sessionId, messageId)` 的使用记录）时才记为 `verified_actual_read`，读取无关企业资料绝不计入；② `POST /feedback/:id/handle` 在转入原权威（`investigating` / `revision_prepared`）时，在原 `StudioStore` 真实创建关联 `workItem`（`setWorkItem`）与 `feedback`（`addFeedback`），持久化 `studioWorkItemId` 与 `studioFeedbackId` 并在界面联动展示；③ `handleFeedback(..., { status: 'verified' })` 强制核验四项条件：必须是独立新任务（`!feedback.reports.some(r => r.taskId === use.taskId)` -> `409 feedback_verification_must_be_independent_task`）、必须是新包版本（`use.packVersion !== feedback.packVersion` -> `409 feedback_verification_requires_new_pack_version`）、必须具备真实已修订的新版原权威资产（`!sameExactSourceRef(targetRef, revisedRef)` -> `409 feedback_verification_requires_authority_revision`）、且该独立新任务必须完整实读了 `revisedRef`（`409 feedback_verification_missing_revised_read`），闭环时写入非空 `revisionLink.authorityUpdates`（杜绝 `1.0 -> 1.0` 空更新假闭环）。 | Store 单测 + Host 集成 + 真实官方 Pi SDK `1.4.0` 运行时：① 本轮仅读无关行政公告提交反馈，不记为 `verified_actual_read`；② 反馈转原权威后实查 `GET /api/studio/systems/:id` 证实 `workItems` 与 `feedback` 已真实写入并互链 ID；③ 用原任务 `Task A` 的 `v1.0 pass` 记录、同版 `v1.1` 记录、或未修订原资产尝试标记 `verified` 全部返回 `409`；仅当独立新任务 `Task B` 在 `v1.1` 完整读取修订版 `refundV2Ref` + `sapM2Ref` 并复算 `C07` 排除、`C13` 保留且核验 `pass` 后，闭环 `verified` 成功且 `authorityUpdates` 非空。全部 **PASS**。 |
| **6. 全景建议勾选/带范围续建与双路线草案参考原段点查（R3）** | **P1** | `src/host/ui/StudioMemberPackPanel.tsx` + `src/host/ui/member-pack-client.ts` + `src/host/enterprise-pack-store.ts` + `src/host/member-pack-host.ts`：① 新增 `POST /api/studio/enterprise-packs/:id/panorama-select` 持久化全景建议勾选状态，界面为每条建议提供勾选框及「按此建议携带原范围续建」按钮，点击后自动携带全景 `brand`/`channel`/`period`/`dataCutoffAt` 创建或复用用途草案并切换至「建设草案」；② 建设草案表格同时展示路线一 `enterpriseSourceRefs`（企业线依据）与路线二 `referenceLinks`（领域/行业参考原段），并提供「查看参考原段」按钮打开抽屉展示精确切片正文、行号范围与 SHA-256。 | 隔离无头 Chromium 端到端（`tests/browser-member-operations-pack.py`）：在浏览器中勾选全景建议「自然月购买活跃率」→点击「按此建议携带原范围续建」验证用途数由 2 增至 3 并携带全景范围→在建设草案查看「企业线依据：」与「领域/行业参考原段：」→点击「查看参考原段」验证抽屉弹出「参考原段回查」与「第 1-5 行」切片正文，`0 pageerrors`，**PASS**。 |
| **7. 只读回退停止新任务供给与归档后同企项目接续绑定（R6）** | **P2** | `src/host/member-pack-host.ts` + `src/host/enterprise-pack-store.ts`：① `--disable-member-pack`（`!enabled`）回退模式下，`buildPackCatalogSummary`、`inspectPinnedSourceRead` 与 `redactPackForConsumer` 对未固定历史版本的新任务/消费项目立即停止供给包用途与依赖（返回 `purposes: []`, `pinnedVersion: null`, `readOnlyRollback: true`），仅保留已固定历史任务只读回查；② 当原建设归属项目归档后，同企业另一活跃项目继续建设同一企业包时，自动调用 `packs.bindContinuationOwner` 记录 `activeOwnerProjectId` 与 `continuationHistory`。 | Host 集成 + 真实官方 Pi SDK `1.4.0` 运行时：① `projBuild` 归档后显式或省略 `projectId` 写操作均返回 `409`，同企活跃项目 `projAud` 接续写入同一 `packId` 后 `activeOwnerProjectId === projAud.id` 且 `continuationHistory.length === 1`；② 以 `--disable-member-pack` 重启真实 Host 后，新任务调用 `studio_assets catalog` 实测收到 `"readOnlyRollback":true`、`"pinnedVersion":null`、`"purposes":[]`。全部 **PASS**。 |

### 7.3 第三轮实际执行验证与命令证据

| 验证项 | 实际执行命令 | 结果与计数 | 退出码 |
| --- | --- | --- | --- |
| **类型检查、产品构建与构建印章** | `npm run build` | **PASS**（`tsc --noEmit` + `frontend build` + `stamp-build`） | `0` |
| **统一会话边界与 SDK 治理检查** | `npm run check:agent-sessions` | **PASS**（`Agent session integration boundary and pinned SDK materials: PASS`） | `0` |
| **高危依赖安全审计** | `npm audit --audit-level=high` | **PASS**（0 high / 0 critical；基线既有 2 项 moderate 来自锁定 `@earendil-works/pi-coding-agent@1.4.0` 的 `minimatch`，未改动任何依赖） | `0` |
| **会员运营包全套专项与反例测试（Store / Host / Pi SDK `1.4.0` Runtime / UI SSR）** | `node --test --test-concurrency=2 tests/member-operations-pack-store.test.ts tests/member-operations-pack-host.test.ts tests/member-operations-pack-runtime.test.ts tests/member-operations-pack-ui.test.ts` | **11/11 PASS**（0 fail / 0 skip，耗时 `27.8s`） | `0` |
| **隔离无头 Chromium 产品端到端验证** | `python3 tests/browser-member-operations-pack.py` | **PASS**（`0 pageerrors`；覆盖设置 T03 SHA-256/去重/原文抽屉→全景建议勾选与带原范围续建→双路线草案出处与「查看参考原段」切片抽屉→显式决定与决定人→预览确认真实原权威：不存在 SAP 指标判 `failed`/`suspended` 且只读核对保持失败，真实启用企业资料判 `succeeded`/`eligible`→原权责项目授权创建与撤回） | `0` |
| **统一会话、项目文件与语义上下文回归** | `node --test --test-concurrency=2 tests/agent-session-boundary.test.ts tests/agent-session-execution.test.ts tests/agent-sessions.test.ts tests/project-files.test.ts tests/project-files-host.test.ts tests/semantic-context-history.test.ts tests/semantic-context-host-client.test.ts tests/semantic-context-host.test.ts tests/semantic-context-reader.test.ts tests/semantic-context-runtime.test.ts tests/semantic-context-service.test.ts tests/semantic-context-ui.test.ts tests/semantic-context-write.test.ts` | **155/155 PASS**（0 fail / 0 skip，耗时 `78.3s`） | `0` |
| **Studio / Studio2 / Enterprise 全套回归** | `node --test --test-concurrency=2 tests/studio-*.test.ts tests/studio2-*.test.ts tests/enterprise-*.test.ts` | **331 PASS / 19 SKIP / 0 FAIL**（耗时 `143.8s`） | `0` |

### 7.4 第三轮未验证项（诚实保留 `NOT_RUN`）

- **6 份 MacBook 私有参考原文实体回读**：`NOT_RUN`（云端 VM 不含私有机密原文，仅核验仓库公开 Nike `T03`/`T04` 及合成替身）。
- **全仓 400+ 测试文件完整 `npm run test`**：`NOT_RUN`（本轮实跑受影响全部套件共 497 PASS / 19 SKIP / 0 FAIL；全仓 CI 交由 PR/Controller 补跑）。
- **真实商业大模型分析与验收人盲验答案核对 / 独立非作者复核 / PR 与 `main` 合并 / 设备切换**：`NOT_RUN`（未产生外部商业模型调用，交由 `OC｜SAA_Studio_3` 复验）。


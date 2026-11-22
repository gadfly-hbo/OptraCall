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

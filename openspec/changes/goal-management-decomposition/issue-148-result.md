# Issue #148 目标管理试用修正工程记录（A1 / A3 / A4 / A5）

- **工单**：[#148](https://github.com/gadfly-hbo/OptraCall/issues/148)
- **领取方**：Antigravity
- **任务分支**：`work/antigravity/issue-148-goal-trial-fixes`
- **基线完整 SHA**：`4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`
- **规格与设计依据**：Issue #148 正文（等价规格）、[Spec](spec.md)（§3.3、§3.5、§6、§9–10）、[任务清单](tasks.md#i-issue-148-目标管理试用修正a1--a3--a4--a5)、[已确认工作区 Demo](ui-demo-journey.html)（SHA-256 `7b1d3031768b2ad13b39850c35879deb601c7beca7ca134eff262d40e92cab0a`）
- **接口与 SDK 边界**：沿用现有 Interface v3、官方 `@earendil-works/pi-coding-agent@1.4.0` 与统一目标会话，未修改公共 Runtime、SDK、依赖或锁文件；报告问题 #2 保持待补证，未开发过滤层。

## 1. 变更范围与对应验收项

| 验收项 | 根因与修复要点 | 主要修改文件 |
| --- | --- | --- |
| **A1 · P1**：G/S 跨目标版本后无法承接旧拆解稿 | `getGoalWorkspace` 在当前目标版本尚无草稿、且存在绑定更早 `gsaPlanVersion` 的最新未发布草稿时，暴露 `priorDraft`；`authorizeWorkspace` 同步校验 `priorDraft`（含 `validateGoal(parent)` 及行范围权限，未授权则置空并标 `draftUnavailable`）。UI `reviewUpstream` 改为读取 `full.draft ?? full.priorDraft` 承接精确旧稿与 revision，保留全部未发布编辑，总目标变化时重算差额并触发发布校验而不自动平差或发布；保留上游核对与 CAS／权限门禁。 | `src/host/strategy-goal-decomposition-types.ts`, `src/host/strategy-goals-store.ts`, `src/host/goal-decomposition-access.ts`, `src/host/ui/GoalDecompositionWorkspace.tsx` |
| **A3 · P1**：实绩说明“可比”与结构“不可比”矛盾，用户无从纠正 | 新增 `assessProgressEvidenceDetails` 输出逐字段 `comparabilityIssues`；`readRoleContext` 基于冻结发布版 `frozenGoal` 交付精确 `expectedBasis`；`goal-assess-actual` 支持可选 `observation.basisMappings`（要求 `evidenceQuote` 在 `reportText` 原文逐字出现且 `rationale` 非空），支持补齐未知项并保留 `submittedBasis` 与 `basisResolution`，同时严格拒绝覆盖人填 `partial`、`open` 及显式排除措辞（`hasExplicitExclusionConstraint`）。当 Host 降级建议可比性时，协调 `assessmentNote` 与最终 `comparability` 一致，原 Agent 说明另存于 `agentAssessmentNote` 与 `requestedComparability`。前端统一徽标、展示具体待核项与映射依据，并提供“补充／纠正待核项后重新核对”入口（不覆写历史检查或原提交）。 | `src/host/strategy-goal-progress.ts`, `src/host/strategy-goal-decomposition-types.ts`, `src/agent/strategy-discussion.ts`, `src/host/server.ts`, `src/host/strategy-goals-store.ts`, `src/host/ui/GoalDecompositionWorkspace.tsx` |
| **A4 · P2**：阈值的指标／周期适用范围提示不足 | 消除前端跨粒度回退逻辑，仅精确匹配当前 `metricId` 与 `periodGranularity`；在最新检查规则、当前检查适用规则、设置摘要、保存回执及 Host `trigger.reason` 中明确指标／周期粒度及是否适用当前检查，并在缺少当前粒度配置时提供“立即配置 X 粒度阈值”就地入口；保持日／周／月流隔离与历史快照不可变。 | `src/host/strategy-goal-progress.ts`, `src/host/strategy-goals-store.ts`, `src/host/ui/GoalDecompositionWorkspace.tsx` |
| **A5 · P2**：发布预览只有预留合计，缺用途／责任人与补缺明细 | 只读 `previewDecompositionPublish` 直接从当前准确草稿（绑定 `draftRevision` / `draftSha256` / `gsaPlan`）返回 `reserves` 与 `gapStrategies`；发布预览对话框展示每笔预留（金额／用途／负责人／依据）与每条补缺策略（名称／策略／预期贡献／不重叠范围／依据），保持 120／112／8、115+5 与补缺 5+3 清晰分离不抵消；取消预览零写入，桌面／390px／深色可读。 | `src/host/strategy-goal-decomposition-types.ts`, `src/host/strategy-goals-store.ts`, `src/host/ui/GoalDecompositionWorkspace.tsx` |

## 2. TDD RED → GREEN 与验证记录

### 2.1 前置 RED（修复前基线 `4132a39`）
- 新增永久回归测试 `tests/issue-148-goal-trial-fixes.test.ts`，在基线代码上复现真实行为失败：
  - A1：`workspace must expose priorDraft for cross-version carryover`（`priorDraft` 缺失）
  - A4：`expected reason to explain day is unconfigured and week rule does not apply`（原仅返回笼统“尚未配置 Case 提示阈值”）
  - A5：`preview must include reserves array`（发布预览缺少预留与补缺明细）
  - 注：A3 首次运行因测试夹具 `apiKey` 未带 `synthetic-` 前缀导致 `tool-provider` 401 属于夹具问题，未计作产品 RED，修正夹具后完整验证真实 Host→官方 Pi 1.4.0→合成 Provider 链路。

### 2.2 独立非作者复核与四原则终检
- 独立非作者复核子 Agent（只读工作树、独立上下文）首次复核发现 2 项 P2 与 2 项 P3：
  1. **[P2 · A3]** `src/host/server.ts` `readRoleContext` 原以 `owner.version` 而非发布冻结版 `frozenGoal` 计算 `expectedBasis.metric` → 已改为读取 `frozenGoal.measurement`。
  2. **[P2 · A3]** `src/host/strategy-goal-progress.ts` `EXCLUSION_PATTERN` 未覆盖 `不包含`/`不包括`/`扣除`/`仅<范围>` 等常见排除表述 → 已扩展模式并补充 `不包含华南门店` 回归断言。
  3. **[P3 · A1]** `src/host/goal-decomposition-access.ts` `validateDraftRows` 未直接调用 `options.validateGoal?.(parent)` → 已补齐。
  4. **[P3 · A4]** `src/host/ui/GoalDecompositionWorkspace.tsx` 阈值保存回执与摘要未同时检查 `metricId` 不匹配 → 已补齐。
- 修正后独立非作者复核二次核验结论：**A1 PASS / A3 PASS / A4 PASS / A5 PASS / 报告问题 #2 未越界 PASS / 四点产品原则 PASS / IN01–IN07 与权限边界 PASS，无剩余阻塞项**。

### 2.3 最终候选实跑验证命令与结果
1. `npm run check:agent-sessions`：**PASS**（Agent session integration boundary and pinned SDK materials: PASS）
2. `npm run build`（`tsc --noEmit && node scripts/frontend.mjs build && node scripts/stamp-build.mjs`）：**PASS**（0 错误）
3. `node --test tests/issue-148-goal-trial-fixes.test.ts`：**4 / 4 PASS**（覆盖 A1 五种情形与门禁、A3 真实 Host→Pi 1.4.0→合成 Provider 四场景、A4 粒度隔离与提示、A5 预览明细与陈旧草稿 409）
4. `node --test tests/goal-decomposition-contract.test.ts tests/goal-decomposition-core.test.ts tests/goal-decomposition-full.test.ts tests/goal-trial-improvements.test.ts tests/strategy-goals-store.test.ts`：**53 / 53 PASS**（与 `issue-148-goal-trial-fixes.test.ts` 合计 57 / 57 PASS）
5. `node tests/browser-issue-148-goal-trial.mjs`（真实无头 Google Chrome 158 CDP + 隔离真实 Host + `dist/` 构建产物）：**PASS**（`Browser A1 PASS`、`Browser A5 PASS` 含 1440×900 桌面 / 390×844 移动 / 深色模式与取消零发布、`Browser A3 & A4 PASS` 含一键补充纠正与就地配置日粒度阈值）

## 3. 未验证项、限制与回退说明
- **未在云端执行项**：全仓 470+ 文件的完整 `npm run test` 未在本机单命令串行跑全量（交由 PM 审核建 PR 后由 GitHub Actions `check.yml` 在精准 head 执行）；未调用真实商业模型或访问 MacBook / Mac mini 运行服务与真实业务数据。
- **报告问题 #2**：按 Issue #148 约定保持待补证，未纳入本单开发。
- **单次 `configured:false` 空值写入**：Issue #148 标注为未复现线索，本次保持待核，未宣称已证实或修复。
- **兼容与回退**：所有新增持久化字段（`comparabilityIssues`、`requestedComparability`、`agentAssessmentNote`、`submittedBasis`、`basisResolution`）与视图字段（`priorDraft`、预览 `reserves`/`gapStrategies`）均向后兼容既有 schema 4 数据，不回写历史记录；运行回退仍支持 `--disable-goal-decomposition` 或安全切回基线提交 `4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`，既有项目、目标、正式表与历史检查保持可读。

---

## 4. 首审退回与二次返工交付（R1 / R2 / R3）

### 4.1 历史候选与流程事实保留
- **首轮候选**：`6a1dc26add7a6568b4d5bbca12105c51e994ce9d`（首次领取 `issuecomment-7212937222`，首次回执 `issuecomment-7213520105`），PM 首审不通过并按规则退回一次返工（[issuecomment-7215345070](https://github.com/gadfly-hbo/OptraCall/issues/148#issuecomment-7215345070)）。首轮退回原因（R1 / R2 / R3）原样保留，不覆写。
- **二次领取**：[issuecomment-7215389769](https://github.com/gadfly-hbo/OptraCall/issues/148#issuecomment-7215389769)（Antigravity，同一分支 `work/antigravity/issue-148-goal-trial-fixes`，基线 `4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`）。
- **Host／Agent 接缝分工如实说明**：Issue #148 约定 Host／Agent 接缝由 Codex 承担；首轮候选及本轮返工涉及 `src/agent/strategy-discussion.ts`（`goal-assess-actual` schema 与提示）与 `src/host/server.ts`（`readRoleContext` 新增 `expectedBasis`），由 Antigravity 直接实施且首轮未事前对齐分工。该流程偏差如实记录、不倒写历史授权，全部接缝变更明细在本节列出，交由 PM（Codex）在二审中核定或接管。
- **首轮复核证据说明**：首轮独立非作者复核由只读子 Agent（会话 ID `db60ca7f7527952889eaf6374207ffde`）执行，当时未将文件 SHA-256 与会话 ID 写入仓库记录；本轮返工已改由全新只读子 Agent 独立复核并留存完整会话 ID 与候选文件 SHA-256。

### 4.2 返工修复（R1 / R2 / R3）
1. **R1（P1 · A3）**：
   - 删除 `EXCLUSION_PATTERN` 正则排除词表，改由结构化约束守边界；新增纯算术辅助 [`knownUnitScale`](../../../src/host/strategy-goal-progress.ts)。
   - `basisMappings` 仅允许 `metric` / `scope`，且人填非空 `unit`、`periodId`、`scope` 及 `missingCoverageNote`/`coverageNote`、`partial`/`open` 均受结构保护，不可被乐观 Agent 观察覆盖。
   - 新增可选 `observation.unitConversion`（要求 `sourceValue`/`sourceUnit`/`factor`/`convertedValue`/`convertedUnit`/`evidenceQuote`/`rationale` 全部核验，严禁 `factor === 1` 同数换标签，强制 `observation.basis.unit === convertedUnit` 后才采纳换算值），原提交数值与单位保持不变。
   - 正常自然业务表述（含“仅统计全部渠道与门店（即本计划完整范围）”）不再被正则误拦，可正常映射与补齐未知项。
   - 前置 RED：在 `6a1dc26` 上新增 `R1 (A3)` 永久测试，复现真实失败 `AssertionError: 27 元 must NOT be relabeled as 27 万元 (+ 'comparable' - 'incomparable')`；修复后全部 6 项子场景转 GREEN。
2. **R2（P2 · A1）**：
   - 抽取纯函数 [`resolveUpstreamCarryover`](../../../src/host/ui/goal-upstream-carryover.ts)，`reviewUpstream` 改为查询全局 `api.getWorkspace(record.id)`（不再用历史 `?goalVersion=` 掩盖全局升版），同时核对全局 `adoptedVersion`、`latestGsaPlanVersion`、`activeGsaPlan.contentSha256` 与本地编辑代次（`hadLocalEdits || currentEditSerial !== startEditSerial`）。
   - 在“另一端已承接当前 GSA”与“旧稿 `priorDraft` 承接”两条分支中，若存在本地未保存改稿，均保留本地输入不覆写，并设置 `draftConflict`、`draftSaveState='error'`、`draftSaveError` 露出合并／核对出口。
   - 新增永久回归 `R2 (A1)` 覆盖另一端先承接、等待期间 G/S 跨目标版升至 v3/GSA3 以及普通承接期间本地改稿三种并发反例。
3. **R3（P2 · 浏览器 A5 验证）**：
   - 修复 [browser-issue-148-goal-trial.mjs](../../../tests/browser-issue-148-goal-trial.mjs)：点击「核对并发布」后严格等待 `dialog[open]` 包含预览标题「核对并发布目标拆解表 v1」与精确草稿短哈希，且全部 A5 断言仅针对 `dialog[open].innerText` 执行；新增 CDP `Runtime.exceptionThrown` 监听并断言 `pageErrors.length === 0`。

### 4.3 全新独立非作者复核（返工候选）
- **复核者身份**：全新只读非作者子 Agent（会话 ID：`70a459d1c6262acb0270887e683efa56`，独立于作者与首轮复核者 `db60ca7f7527952889eaf6374207ffde`）。
- **初审发现与关闭**：
  1. `[R1 / A3]` `unitConversion` 在 `observation.basis` 缺失或 `basis.unit !== convertedUnit` 时会先改写 `actualValue` 导致数值与单位脱节 → 已在 `src/host/strategy-goals-store.ts` 强制校验 `observation.basis.unit === convertedUnit`（409 `actual_report_value_mismatch`）后再写入 `actualPeriods`。
  2. `[R2 / A1]` `reviewUpstream` 冲突分支未设置 `draftSaveState='error'` 与 `draftSaveError`，导致前端合并按钮被门控隐藏 → 已在 `src/host/ui/GoalDecompositionWorkspace.tsx` 补齐。
- **二次复核终审结论**：**R1 PASS / R2 PASS / R3 PASS / A1 PASS / A3 PASS / A4 PASS / A5 PASS / 四点产品原则 PASS / IN01–IN07 PASS（0 阻塞项）**。

### 4.4 返工最终候选文件 SHA-256 清单
| 文件 | SHA-256 |
| --- | --- |
| `src/agent/strategy-discussion.ts` | `49926f628838a0441a0c4ad365df9dbcc0dd010c090a45ec2956f9f58b36f960` |
| `src/host/goal-decomposition-access.ts` | `609a03f34c6e4e215c48bd4724aaf7d895c07741b434c208452cfc5aee995fc0` |
| `src/host/server.ts` | `07bc6f84bf8ca6879405ac1f4136ff5a2941cb7519aaea4a114bb040115b4912` |
| `src/host/strategy-goal-decomposition-types.ts` | `0fb91b984b4850f912776a0c2effa94bd9062ef5251113caeb7fa0c397044b55` |
| `src/host/strategy-goal-progress.ts` | `df20f433cc68fd8aedc801aada9178dc7568113458be9f53765dd69c01da6dfd` |
| `src/host/strategy-goals-store.ts` | `5c18be3b137e755c3d7d19c8e2f3abbed1b1fe04a2fa3d4b9f34ed65bbcad4ca` |
| `src/host/ui/GoalDecompositionWorkspace.tsx` | `5626fee0a669704a9a869e2c18539f7b20a3dff35ca0274e8b37b641e970efef` |
| `src/host/ui/goal-upstream-carryover.ts` | `e526c788d51cc2f520eb60657e0568f503d1a9734e6ca2e2988ded4bb4de6555` |
| `tests/issue-148-goal-trial-fixes.test.ts` | `6810b21d0688305eca8de845f740b2beddb574437120e6aef522b207a2a30b63` |
| `tests/browser-issue-148-goal-trial.mjs` | `151fd2775f31d664f12dcedaa4a5e92764dcef5925b11518683bce52fe1049c0` |

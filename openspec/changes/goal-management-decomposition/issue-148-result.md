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

## 5 PM 终审接收、接缝接管与收尾

PM从origin读回 `736f44abd162fc7228d9c1843622bc18aa1a4b25`，10项文件摘要与§4.4相符，独立重跑59项定向、构建和原浏览器流程均通过。按终审规则在[#148接收回执](https://github.com/gadfly-hbo/OptraCall/issues/148#issuecomment-7217884093)接收候选，不再安排第三次领取；Codex在 `codex/issue-148-pm-integration` 唯一写入，原Antigravity分支保持交接提交。本轮Host／Agent工具与上下文接缝由Codex核定并承接，历史分工偏差不倒写为原已授权。

### 5.1 终审发现与实际修正

全新非作者对固定736候选独立核对，保留22组Store结果与实际浏览器证据：来源单位未填时，报表27元能被声称为27亿元再换成270000万元；人／积分到万元在算术自洽时也通过。已有自然范围只要原填写非空就不能得到可操作的同义建议。承接冲突虽然保住输入，但“请Agent合并”切回空初稿，未持有负责人的承接资格，Conversation保持只读；实际请求为零，不能以按钮存在认定恢复可用。这些与59项通过同时保留，原候选的作者复核摘要不代替本次结论。

- **PM01**：未知／跨量纲比例不作为已验证换算，使用自有属性读取固定比例；有负责人原填单位时保留其权威，无原填单位时核对来源片段中与原数值相邻的准确单位，避免“元／万元／亿元”子串混淆。字面复合单位不能作为缺失单位回退。Agent提议计算，Host核比例、原提交、引句和结果单位；不新增分析方法、业务语义分类或SDK改写。正常270000元换成27万元可直接采用，原实绩仍保留270000元。无法核定的比例继续待核。
- **PM02**：人填范围不静默改写。有证据且对照准确冻结范围的Agent建议另存为 `basisSuggestions`，显示原值、建议值、原文与理由；负责人可一键填入原补充核对表单并沿原提交创建新检查。建议不认定可比，原报告、原提交和旧检查不变，真正窄范围仍待核。正常空范围提取不增加人工作业；出现与人填范围的差异时保留必要经营取舍，省去抄字段。
- **PM03**：合并动作保留本地原稿及编辑基线，先只读核对全局准确目标／GSA；需要时沿原user路由按准确旧稿、revision及负责人核对标记完成承接，再经原Pi对话合并人改，Agent无权越过上游门禁。仅匹配当前请求、原生实际保存结果、准确当前稿hash/revision、未变目标／GSA与本地编辑代次时采纳已保存状态。失败、无保存的口头成功、取消、晚回、新输入及未知结果保留本地稿与基线。成功后仍保留冲突备份，不自动发布。

范围建议及原纠正按钮共用准确检查的表单预填，保留原发布版／行／检查点／期间，避免切换检查归属时将缓存写到之前目标。此为该恢复入口的直接阻塞修正，不新增导航、审批或经营动作。Spec§11、任务J及检查索引记录此最小范围。

### 5.2 前置失败、增量验证及边界

证据位于本任务隔离目录 `/workspace/issue148-pm-closeout/`，原终审只读证据在 `/workspace/issue148-second-evidence/`。完整内容未作为公开附件上传；[检查索引](assets/issue-148-pm-closeout-checks.json)记录文件摘要和实际结果，不以路径代替已上传证据。

| 检查 | 实际结果与范围 |
| --- | --- |
| 来源／量纲修正前RED | `units/red.log`：4项中1PASS／3FAIL，分别命中缺来源单位、跨量纲、原单位未核定仍换算；均执行实际Store，不是导入／夹具失败。 |
| 复合单位回退RED | `units/compound-red.log`：4项中3PASS／1FAIL；元/人被当成原单位缺失而回退人填元。字面复合单位作为冲突证据后关闭，原失败保留。 |
| 单位与范围最终专项 | `units/boundaries-final-2.log`：5PASS／0FAIL，覆盖正确换算、未知／异量纲拒绝、来源单位不猜、无部分检查、原提交保全、同义范围建议／窄范围不自动通过／负责人新检查不改旧报告。 |
| 恢复原产品RED | `recovery/red-browser.log`及119测算变体：736真实UI在dirty冲突后合并，current draft仍null、prior在、Provider零请求、页面空初稿却显示已保存。截图／DOM／状态保留。 |
| 恢复Host／官方Pi | `recovery/host-native-tests-final.log`：2PASS／0FAIL，真实Host→官方Pi1.4.0→合成Provider→原保存工具；保留Agent直接跨GSA承接409，负责人承接后准确合并保存。 |
| 原工单专项 | `recovery/original-issue148-regression.log`：原6项测试不改，6PASS。 |
| 恢复及范围浏览器 | `recovery/green-browser-v3.log`、对应summary：8案PASS，实际读回两条成功合并、新输入／取消／失败／无保存／晚回保稿、普通CAS、范围建议仅预填且零写入；page errors为0。桌面截图与原工作区布局一致。 |
| 构建／审计 | `recovery/candidate-build-v3.log`构建PASS；`audit.log` high audit PASS，2项既有moderate保留，无依赖升级。 |
| 完整check | 运行中，结果按最终日志补齐；不得将专项或合成模型结果当作全量／专业验收。 |
| 最终固定候选独立复核 | 全新非作者正在按14个产品／测试摘要核验，结果按实际报告补齐。 |

恢复作者的中间错误同样保留：最初将仅assistant投影具备的nativeEntryId要求在人消息上，实际原生保存r3已成功但UI未采纳；改为按原requestReceipt及原生工具保存回执核验后通过。另有测试fixture类型、单份当前草稿被误当不可变revision史、ES2022兼容等夹具错误均单列，不能伪装产品RED或删弱旧Goal／GSA／原稿正文保全断言。根新增单位测试的初次类型检查需给已有fixture明确DecompositionDraftInput类型，修正不改变原RED运行行为。

### 5.3 四原则、权限与交付关口

Host仍管理准确引用、源／单位／算术及权限／CAS／保存资格，Agent自主解释口径、选择资料并提议方案。没有恢复排除词表或Host语义推理，没有新Runtime、模型循环、运行队列、会话指针或依赖升级。合并UI只关联既有请求和原回执，未形成新的Agent生命周期权威。人的动作仍是表达业务要求、核对上游及正式发布；异常范围建议沿原补充表单核对，不要求维护机器ID或抄字段。

新字段均为schema4可选增量，不改原实绩／历史检查及正式表，不回写原生会话；禁写回退保留。真实模型质量、报告问题#2及未复现configured:false线索仍待核，未操作MacBook／Mac mini或真实业务／Provider。最终准确提交、PR实际head完整CI、后续合并授权与main CI在同一#148记录，不由本地PASS提前关单。

固定PM候选1的全新非作者复核又发现：`元 / 人`等空白变体尚可被当成纯金额单位；单位换算与范围建议组合时，原单位与换算后数值可能在纠正表单混用。当前完整check在候选1原目录继续运行，原内容冻结；最后增量将在新独立工作树修正并复验，不把候选1的检查冒称覆盖之后的代码。原发现及失败保留，待最终候选独立复核关闭。

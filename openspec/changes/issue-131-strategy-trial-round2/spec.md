# Issue #131 战略选择第二轮试用修正规格

2026-11-24 · Antigravity/d3aa91c3 · `Refs #131`

## 1. 目标、基线与交付

按 [Issue #131](https://github.com/gadfly-hbo/OptraCall/issues/131) 整体实施战略选择第二轮试用反馈的五项修正（A–E），交付独立任务分支、永久回归测试、可重跑上传／并发／异常矩阵与退出诊断、隔离合成主链及浏览器验证证据、结果记录和实现回执。Codex PM 负责接回复验、独立于全部作者的非作者复核、最新 `main` 集成、PR／CI、合并与工程结案；本规格不把作者自检写成独立复核、远端 CI 或用户产品验收。

- 领取基线：`f9994cb7b5ad4f9ab52141f278085d9e21f05d45`（tree `74f5977d9518c1ccce93a44c8702a0da42ac3725`），与领取时远端 `origin/main` 一致。
- 返工整合基线：已合入 `origin/main` `85fdf79b763e97825f86e5734ee579d070d7422d`（#132 会员资产包六项试用反馈及任务发送恢复），保留 #132 共享会话及错误处理改动（`rejectedSend`／`native_run_start_rejected`）与本单校验 `details` 白名单。
- 领取评论：`issuecomment-7133309069`（`IC_kwDOVaDnXM8AAAABqS2ojQ`），首轮回执：`issuecomment-7136004716`，复核退回返工：`issuecomment-7136369082`；统一由 `Antigravity/d3aa91c3` 负责。
- 任务分支：`work/antigravity/issue-131-strategy-trial-round2`。
- 上游合同：`openspec/changes/strategy-selection-refactor/spec.md` 及 Issue #131 正文；本单只做既有四页签、现有弹窗与单块限定修改合同内的最小修正，不新增平行流程或另出 UI Demo。
- 工程规范 v1.14、统一 Agent Session Interface v3、官方 `@earendil-works/pi-coding-agent` 1.4.0。
- Mac 原现场宿主消失根因继续按待定位跟踪，不猜测未复现根因；原报告所称「空归属标识静默失败」在基线未复现，仅按提示清晰度改进纳入并保留原事实。

## 2. 任务目标执行清单

| 阶段 | 任务 | 完成条件 | 当前状态 |
| --- | --- | --- | --- |
| 领取与准备 | 核对 Open、无冲突领取、精确基线与规格 | 领取评论回读确认，建立任务分支与本变更 spec／result | 已完成 |
| A · 上传诊断与恢复 | wrapper／Host 退出日志、上传异常矩阵、UI 多条待核恢复 | 可重跑矩阵区分请求错误与进程退出；退出日志记录时间／PID／实例／exit code／signal／关闭结果；UI 按多条待核账本保留各条 operationId 与指纹（新上传不覆盖旧 UNKNOWN），支持独立只读核对、刷新恢复、重选校验、范围隔离与服务不可达指引 | 已完成（含返工 1） |
| B · 候选校验定位 | 复用 `safe-tool-error-v1` 给出字段与上限路径 | 角色字段、operationId、blocks 数量／类型／唯一合法 ID、goals 格式与上限返回安全 `path/reason` 与修正信息；SDK 原定位保持；真实 Pi 链按定位自修保存；失败零写入 | 已完成 |
| C · 限定修改与澄清 | 目标基线清晰呈现、严格请求绑定、在途冻结、基线新鲜度守卫 | 弹窗呈现准确对象／块基线预览并在提交期冻结输入、以不可变快照绑定 waiting／poll／diff／adopt；工具提交强制绑定当前获准 `proposalId`＋`requestId`（普通请求与跨提案拒绝）；派发／工具提交／采纳全边界核对 `baselineSha256`；绑定实际澄清／失败／取消反馈与主会话原讨论入口 | 已完成（含返工 2、3、4） |
| D · 目标承接预警与补目标 | 锁定前／发布审查前置提示，草稿与受限父版读回补目标 | 无目标时锁定前与发布审查明示「可承接目标 0 个」影响且仍允许合法发布；有目标展示清单；未锁定草稿提供候选会话补目标入口；锁后父版新建候选以常量元数据＋`initiative-read-candidate` 受限分页读回直接父版（支持合法最大边界、不截断、不改父稿），派发前确定性失败零新版本写入且不假重放 | 已完成（含返工 5） |
| E · 归属标识必填提示 | 必填语义清晰、空值可见定位 | 事项名称、范围名称、归属标识明示必填；空值／半填范围行可见红字提示并定位聚焦，零创建；合法输入保持稳定组织身份；保留「静默失败未复现」事实 | 已完成 |
| 联合验证 · 作者隔离自检 | 边界检查、构建、审计、受影响 Host／Pi／UI 回归、#132 接缝回归与真实浏览器 E2E | `check:agent-sessions`、`npm run build`、`npm audit --audit-level=high`、全部战略与返工 Host／Pi／UI 回归、#132 回归、无头 Chromium 桌面／窄屏／键盘与 5 项返工负例全部 PASS | 已完成（见 result.md） |
| 联合验证 · 完整 `npm run check` 与远端 CI | 无过滤全仓 468 文件 `npm run check`、非作者复核与 PR／CI | 须由 Codex PM／远端 CI 在无 600s 单命令上限环境完成全仓检查与独立复核（本机 2 vCPU VM 单命令 600s 截断事实保留在 result.md） | 待 PM／CI 验证 |
| 移交回执 | 推送返工候选并回读远端完整 SHA，在 Issue #131 回执 | 四原则与 IN01–IN07 自检完成，回执含身份、SHA、命令、结果、限制与安全回退；移交后停止写入，Issue 保持 Open | 已完成 |

## 3. 行为合同

### A. 上传失联诊断与未知上传结果恢复

1. **入口与关闭诊断**：`scripts/start-host.mjs`、`scripts/host-entry.mjs` 与 `src/host/main.ts` 沿现有标准错误输出单行最小脱敏 JSON 记录，包含 ISO 时间戳、`pid`／`wrapperPid`／`hostPid`、经校验的 `instanceId`（若有）、可观测 `exitCode`／`signal`，以及关闭开始／完成／失败／超时和可捕获未处理异常（经 `uncaughtExceptionMonitor`，保留 Node 默认非零退出语义）。不修改 `host-ready` 标准输出协议，不记录请求正文、凭据或业务路径。
2. **多条上传待核账本（返工 1 闭合）**：前端为每次战略资料上传在发起前计算原始字节 SHA-256 与唯一 `operationId`，按 `initiativeId:scopeKey` 将**多条**仅含元数据的待核数组持久化至 `sessionStorage`（兼容升级旧单条对象，不存 base64 正文），并在当前页签内存以 `Map<operationId, contentBase64>` 分别保留对应载荷。发起新上传（无论后续成功、再次 `UNKNOWN` 或确定性 4xx 拒绝）仅更新或移除该次 `operationId`，**绝不覆盖或清空既有未核清的旧 `UNKNOWN` 记录**。
3. **只读核对与显式恢复**：每条待核记录独立展示并提供「核对原上传结果」、内存直试／刷新后重选校验与「放弃待核记录」。点击「核对原上传结果」只读调用 `GET /files` 并严格按 `operationId`＋目录＋范围＋文件名＋SHA-256 核对：
   - 已命中记录：同步文件列表、仅清除该条待核，提示原文件已落盘且未重复上传。
   - 未命中记录：标记该条已核对未发现；当前页签仍持有该 `operationId` 内存字节时允许直接按原 `operationId` 重试；刷新后内存字节不在时明确说明需重选原文件，重选后先核对文件名、大小与 SHA-256 一致才沿原 `operationId` 重试，不一致则拒绝并保留待核。
   - 核对再次失败／服务不可达：保留该条 `UNKNOWN` 与原操作关联；`status === 0` 时展示现有启动入口（如双击「启动 OptraCall.command」或 `npm run start`）与日志目录指引，不自动拉起进程。
   - 明确新上传仍使用新 `operationId` 支持，不做全局按名／按内容去重或自动删文件；切换范围时待核记录按事项＋范围隔离。

### B. 候选保存错误定位

`src/host/strategy-candidate-host.ts` 复用既有 `StrategyDiscussionFault`（`exposure: 'safe-tool-error-v1'`）与 `details.issues`（白名单 `path/reason`），不改写官方 Pi SDK 或扩大安全白名单：

- 角色不允许字段（如 `version`、`no`、`candidateId` 等）：返回 `strategy_candidate_fields_invalid`（400），带修正文案与受限白名单 `issues`（安全 ASCII 标识输出 `path`，非安全键名回落父路径，不回显敏感键名）。
- `operationId` 缺失／非字符串／非 UUID：返回 `strategy_candidate_operation_invalid`（400）与 `path: 'operationId'`。
- `candidateBlocks` 缺失／非数组／数量不在 1–20／项非对象／未知字段／`id` 缺失或非法或重复／`label` 或 `text` 缺失、空白或超长（200 / 20000）：返回 `strategy_candidate_schema_invalid`（400）与精确 `candidateBlocks[i]...` 路径及原因。
- `candidateGoals` 非数组／超过 10 条／项非字符串、空白或超过 500 字：返回 `strategy_candidate_schema_invalid`（400）与 `candidateGoals`／`candidateGoals[i]` 路径及原因；省略仍合法为空数组。
- `src/host/server.ts` 仅对带 `details` 的候选校验故障同步投影安全 `details`，并完整保留 #132 新增的 `rejectedSend`／`native_run_start_rejected` 合同，不影响旧战略地图与导入错误合同。所有校验先于写入，失败零写入。

### C. 限定修改的目标与澄清反馈（返工 2、3、4 闭合）

1. **精确目标、输入冻结与不可变提交快照（返工 3）**：`ReviseDialog`（开题与候选共用）在输入意图前明确展示基线版本、指纹前缀、当前所选修改块名称与 ID 以及该块当前原文预览；提交期间冻结块选择与意图输入（`disabled={busy}`），在请求发出前捕获不可变 `SubmittedProposalSnapshot`（`proposalId`、`requestId`、`baseLabel`、`baseSha256`、`blockId`、`blockLabel`、`baselineText`、`request`）并配提交序号守卫。等待态、轮询、反馈归属、差异展示、无变化判定与采纳提交严格绑定该不可变快照，不被后续编辑、延迟 202 或父级 props 刷新篡改；关闭／取消／返回继续拟改时使旧提交与轮询失效。
2. **严格提案／请求归属与基线新鲜度守卫（返工 2、4）**：
   - `initiative-propose-revision` 在工具入口及 `options.mutate` 持久提交守卫内均强制要求当前主会话活跃运行同时绑定本次 `context.requestId`、目标 `proposal.proposalId` 且 `lastRun.status === 'accepted'`；普通主会话请求（无 `proposalId`）、绑定其他提案的请求、busy 遗留待拟改提案以及已取消／替换／迟到运行一律拒绝（`strategy_proposal_unavailable`），零提案改写。
   - 开题与候选在**派发**（`send` 与 `verifyBeforeDispatch`）、**工具提交**（`initiative-propose-revision` 守卫与 `markProposed`）及**采纳**（`revise` 同时核对目标块当前 SHA 与补丁 `expectedOldSha256` 均等于 `proposal.baselineSha256`）全边界核对提案基线未变；若目标块已变化则拒绝（409 `strategy_proposal_baseline_changed`）并提示刷新正文后重新拟改，仅刷新 CAS 不得让旧补丁套用新基线。
3. **绑定回执与实际反馈**：`RevisionProposal` 增加向后兼容的可选 `feedback?: RevisionProposalFeedback`（记录 `requestId`、`outcome`、`replyText`、`failureCode`、`failureDetail`）。主会话运行结束但未调用 `initiative-propose-revision` 时，复用统一 Pi Runtime `run.completion` 返回的本轮脱敏文本与安全诊断写入 `markTerminal`；未提供文字时如实说明，提供弹窗内及单候选方案页只读「查看主会话原讨论」入口。

### D. 目标承接前置说明与草稿／长父版补目标路径（返工 5 闭合）

1. **前置透明**：`CandidateBody` 始终展示「可承接战略目标」区块（0 个时明示影响，有目标时列出清单）。候选锁定确认弹窗、战略发布页及发布确认弹窗均前置展示当前可承接目标数量与影响：0 个时说明可合法作为战略记录发布但发布后无法带入目标管理，并给出返回完善草稿或新建后续候选路径；有目标时直接呈现实际可承接清单，沿用既有确认步骤。
2. **草稿补目标**：未锁定候选详情与锁定确认弹窗提供一键打开该候选会话的入口；候选会话弹窗对未锁定草稿提示可通过自然语言让 Agent 读回正文并补充 `candidateGoals`，后台完成后同步刷新候选详情。
3. **锁后目标专项扩展与受限父版读回（返工 5）**：锁定版不可原位修改（零写入）。锁后复用既有 `POST /candidates` 的 `parent: { candidateId, no }` 合同创建新候选版本、新独立 Pi 会话与新指纹（须重新锁定与串行双检验，不复用旧凭证）：
   - `contextBody.parentVersion` 仅注入常量大小元数据指针（`candidateId`、`no`、`contentSha256`、`locked`、`blockCount`、`goalCount`、`readBy: 'initiative-read-candidate'`），避免每轮无界全正文注入与 65,536 prompt 预算冲突，不截断父稿、不降低合法保存上限（20 块 × 20,000 字、10 目标 × 500 字）、不全局放大 prompt 限制。
   - 候选会话的 `initiative-read-candidate` 授权只读读取本版本或直接 `parent`（其他候选一律 403 `strategy_candidate_owner_mismatch`）：总正文 `<= 16384` 时直接返回完整 `blocks`/`goals`；超过上限时返回无损章节目录（`id`、`label`、`textLength`、`textSha256`、`paged: true`）、完整 `goals` 与 `pagingRequired: true`，再按 `blockId`＋`offset`/`limit`（最大 8192）逐块完整分页读回。
   - `create()` 在写入 `candidates.json` 前校验完整 prompt 预算与前置条件，派发前确定性失败（如目录＋指令超过 65,536 触发 413）做到**零新版本写入**；若 `send()` 在落盘 `lastRun` 前意外失败则回滚未落运行态的空版本；对缺少 `lastRun.id` 的记录拒绝重放为假 202。

### E. 归属标识必填提示

`InitiativeEditorDialog` 明确标注「事项名称」「范围名称」「归属标识」为必填（与「上层企业标识（可选）」区分），附带 `aria-required="true"` 与简洁说明。表单提交统一校验：空值或仅填名称／仅填标识的半填范围行不得静默丢弃，显示可见红字错误（`role="alert"`）、标示 `aria-invalid="true"` 并聚焦到首个缺失字段，零创建。合法输入沿既有范围模型正常创建并维持稳定 `initiativeScopeKey`。验收记录明确保留「基线未复现静默失败」事实。

## 4. 允许修改路径与复用边界

- 进程与诊断：`scripts/start-host.mjs`、`scripts/host-entry.mjs`、`src/host/main.ts`
- 战略 Host 与工具：`src/host/strategy-candidate-host.ts`、`src/host/strategy-initiative-host.ts`、`src/host/strategy-initiative-reports.ts`、`src/host/strategy-initiative-types.ts`、`src/host/server.ts`、`src/agent/strategy-discussion.ts`
- 战略 UI：`src/host/ui/StrategyInitiativeWorkbench.tsx`、`src/host/ui/StrategyInitiativeGovernance.tsx`、`src/host/ui/strategy-initiative-client.ts`、`src/host/ui/strategy-initiative-view.tsx`、`src/host/ui/strategy-initiative.css`
- 测试与记录：`tests/strategy-*`、`tests/browser-issue-131-strategy-trial-round2.py`、`openspec/changes/issue-131-strategy-trial-round2/*`

不修改官方 `@earendil-works/pi-coding-agent` 1.4.0、不升级依赖或锁文件、不新增 Runtime／全局队列／平行会话层；合并 `origin/main` `#132` 时原样保留 #132 全部实现与测试。

## 5. 会话接入记录（IN01–IN07）

| 项 | 本单安排 |
| --- | --- |
| IN01 | 已读根 `AGENTS.md`、工程规范 v1.14、`docs/agent-session-integration.md` 与战略规格；本规格记录 Interface v3、owner/profile 与验收范围。 |
| IN02 | 保持 `strategy-initiative`（`InitiativeMainSession`）与 `strategy-candidate`（`CandidateVersion`）既有 Host 静态注册和 owner-bound Ref，不向业务或前端暴露 domain 管理对象。 |
| IN03 | 启停、占用、取消、关闭、订阅与完成结果沿既有 `createAgentSessionDomain` 与 `run.completion` 复用，不新增平行运行状态账。 |
| IN04 | 候选校验、proposal 绑定与基线守卫、受限父版读回与 UI 展示留在战略业务适配器；公共会话层不加战略分支。 |
| IN05 | Host 核对范围、文件、指纹、proposal 归属／基线、直接父版授权与安全错误白名单；仅用隔离合成资料与合成 Provider。 |
| IN06 | Issue #131 由仓库所有者／Codex PM 正式外发并在返工后继续指定 Antigravity/d3aa91c3 统一完成；所有持久与 DTO 变更为向后兼容可选字段。Codex PM 负责接回复验、非作者复核、集成、PR／CI 与结案。 |
| IN07 | 覆盖正常、取消、迟到结果、保存／重开、旧记录兼容、边界脚本 `check:agent-sessions`、受影响真实 Pi／浏览器与 #132 接缝回归；完整 468 文件 `npm run check` 与远端 CI 交由 PM／CI 执行并如实记录边界。 |

## 6. 四原则前置检查

- **Host 管环境**：Host 负责退出诊断日志、文件与操作身份核对、字段／权限门禁、proposal 归属与基线新鲜度校验、受限直接父版分页读取与安全错误投影，不代作战略判断、不自动改选修订块、不自动重发或自动拉起进程。
- **Agent 自主执行**：Agent 根据安全 `path/reason` 自行修正候选保存；拟改遇目标不匹配或无需修改时自主澄清，由用户决定是否改选继续；补目标由 Agent 按受限读取工具完整读回正文／直接父版并自主形成可承接目标。
- **优先复用 Pi**：锁定官方 Pi 1.4.0 与 Interface v3，复用 `run.completion` 脱敏回复与安全诊断、`safe-tool-error-v1` 通道与候选独立会话生命周期，无平行推理循环。
- **减少人的操作**：多条待核上传独立保全并一键核对／按原编号重试；候选校验一步定位；拟改前直见目标原文、在途防错位，无补丁时直接看到澄清并可一键查主会话；无目标影响前置告知并提供一键回会话或父版新建入口；必填字段直观标注并自动聚焦错误位置。新增必做确认仅保留原有治理边界。

## 7. 验证、兼容与安全回退

每项及 5 项返工缺口均先留真实 RED 复现，再做最小 GREEN 修复与永久回归；联合验证以隔离合成 Host、官方 Pi 1.4.0、合成 Provider 与真实 Chrome（Playwright）走通完整战略选择链路及失败／并发／迟到／重开／权限／5 项返工负例，点验 1440px 与 390px 视口及键盘操作，并执行 `npm audit --audit-level=high` 与 #132 接缝回归。完整无过滤 `npm run check` 在本机 2 vCPU VM 受单命令 600s 上限截断，交由 PM／远端 CI 完整验收。

**兼容与安全回退（整合 #132 后）**：
- **代码回撤范围**：本分支已合入 `#132`（`85fdf79b763e97825f86e5734ee579d070d7422d`）。若需仅回退 Issue #131，**不得**笼统回切到旧领取基线 `f9994cb7...`（否则会连带回退 `#132` 的会员资产包与任务发送恢复改动）；应仅回撤 Issue #131 的变更提交，回到整合后的 `main` 基线（如 `#132` `85fdf79b763e97825f86e5734ee579d070d7422d` 或对应合并提交的 `revert`）。
- **数据兼容与保全**：新增 `RevisionProposal.feedback` 为可选字段，旧消费者可原位读回升级期间生成的 `reports.json`／`candidates.json`、原生 Pi 会话 JSONL、锁定／检验／发布／承接记录与服务端文件，无需破坏性迁移，不会覆盖或删除已落盘业务数据。追加的退出／启动诊断日志不改既有 `host-ready` 或 `instance.json` 格式。
- **回退后降级边界**：旧前端消费端不读取 `sessionStorage` 中的 `optracall.strategy-initiative.upload-pending.v1:*` 待核账本，也不具备本单新增的多条 `UNKNOWN` 上传恢复卡片、刷新重选校验、拟改弹窗内联澄清回读、0 目标前置承接预警与必填定位提示能力；浏览器本地遗留的待核元数据与 `UNKNOWN` 键不会被破坏或自动删文件，但回退期间需由用户通过文件列表人工核对。


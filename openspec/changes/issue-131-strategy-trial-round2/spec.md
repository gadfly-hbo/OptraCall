# Issue #131 战略选择第二轮试用修正规格

2026-11-24 · Antigravity/d3aa91c3 · `Refs #131`

## 1. 目标、基线与交付

按 [Issue #131](https://github.com/gadfly-hbo/OptraCall/issues/131) 整体实施战略选择第二轮试用反馈的五项修正（A–E），交付独立任务分支、永久回归测试、可重跑上传／并发／异常矩阵与退出诊断、隔离合成主链及浏览器验证证据、结果记录和实现回执。Codex PM 负责接回复验、独立于全部作者的非作者复核、最新 `main` 集成、PR／CI、合并与工程结案；本规格不把作者自检写成独立复核、远端 CI 或用户产品验收。

- 领取基线：`f9994cb7b5ad4f9ab52141f278085d9e21f05d45`（tree `74f5977d9518c1ccce93a44c8702a0da42ac3725`），与领取时远端 `origin/main` 一致。
- 领取评论：`issuecomment-7133309069`（`IC_kwDOVaDnXM8AAAABqS2ojQ`），`Antigravity/d3aa91c3`。
- 任务分支：`work/antigravity/issue-131-strategy-trial-round2`。
- 上游合同：`openspec/changes/strategy-selection-refactor/spec.md` 及 Issue #131 正文；本单只做既有四页签、现有弹窗与单块限定修改合同内的最小修正，不新增平行流程或另出 UI Demo。
- 工程规范 v1.14、统一 Agent Session Interface v3、官方 `@earendil-works/pi-coding-agent` 1.4.0。
- Mac 原现场宿主消失根因继续按待定位跟踪，不猜测未复现根因；原报告所称「空归属标识静默失败」在基线未复现，仅按提示清晰度改进纳入并保留原事实。

## 2. 任务目标执行清单

| 阶段 | 任务 | 完成条件 | 当前状态 |
| --- | --- | --- | --- |
| 领取与准备 | 核对 Open、无冲突领取、精确基线与规格 | 领取评论回读确认，建立任务分支与本变更 spec／result | 已完成 |
| A · 上传诊断与恢复 | wrapper／Host 退出日志、上传异常矩阵、UI 待核恢复 | 可重跑矩阵区分请求错误与进程退出；退出日志记录时间／PID／实例／exit code／signal／关闭结果；UI 保留 operationId 与指纹，支持只读核对、刷新恢复、重选校验、范围隔离与服务不可达指引 | 已完成 |
| B · 候选校验定位 | 复用 `safe-tool-error-v1` 给出字段与上限路径 | 角色字段、operationId、blocks 数量／类型／唯一合法 ID、goals 格式与上限返回安全 `path/reason` 与修正信息；SDK 原定位保持；真实 Pi 链按定位自修保存；失败零写入 | 已完成 |
| C · 限定修改与澄清 | 目标基线清晰呈现，绑定实际澄清／失败回传 | 弹窗呈现准确对象／块基线预览；proposal 绑定 `requestId` 与实际回复／安全失败／取消状态；未提供理由如实说明并给准确原讨论入口；开题与候选共用入口及负例回归 | 已完成 |
| D · 目标承接预警与补目标 | 锁定前／发布审查前置提示，草稿与父版补目标 | 无目标时锁定前与发布审查明示「可承接目标 0 个」影响且仍允许合法发布；有目标展示清单；未锁定草稿提供候选会话补目标入口；锁后通过父版新建候选（新会话／新指纹／重锁重检）恢复，不复用旧凭证 | 已完成 |
| E · 归属标识必填提示 | 必填语义清晰、空值可见定位 | 事项名称、范围名称、归属标识明示必填；空值／半填范围行可见红字提示并定位聚焦，零创建；合法输入保持稳定组织身份；保留「静默失败未复现」事实 | 已完成 |
| 联合验证 | 完整 `npm run check`、真实 Host/Pi/浏览器联合路径与审计 | 覆盖上传恢复→开题→两候选→拟改澄清→补目标→锁定双检验→发布→承接→历史撤销、失败／并发／迟到／重开／权限负例、桌面／窄屏／键盘、`npm audit --audit-level=high` | 已完成（完整 `npm run check` 因 VM 600s 上限分段执行，见 result.md） |
| 移交回执 | 推送分支并回读完整 SHA，在 Issue #131 回执 | 四原则与 IN01–IN07 自检完成，回执含身份、SHA、命令、结果、限制与回退；移交后停止写入，Issue 保持 Open | 已完成 |

## 3. 行为合同

### A. 上传失联诊断与未知上传结果恢复

1. **入口与关闭诊断**：`scripts/start-host.mjs`、`scripts/host-entry.mjs` 与 `src/host/main.ts` 沿现有标准错误输出单行最小脱敏 JSON 记录，包含 ISO 时间戳、`pid`／`wrapperPid`／`hostPid`、经校验的 `instanceId`（若有）、可观测 `exitCode`／`signal`，以及关闭开始／完成／失败／超时和可捕获未处理异常（经 `uncaughtExceptionMonitor`，保留 Node 默认非零退出语义）。不修改 `host-ready` 标准输出协议，不记录请求正文、凭据或业务路径。
2. **上传操作待核账本**：前端为每次战略资料上传在发起前计算原始字节 SHA-256 与唯一 `operationId`，将仅含元数据的待核记录按 `initiativeId:scopeKey` 持久化至 `sessionStorage`（不存 base64 正文），并在当前页签内存保留对应 `operationId` 的载荷。确定性 4xx 拒收（非操作冲突）清除待核；网络失联（`status === 0`）或 5xx 不确定结果保留 `UNKNOWN` 待核。
3. **只读核对与显式恢复**：点击「核对原上传结果」只读调用 `GET /files` 并严格按 `operationId`＋目录＋范围＋文件名＋SHA-256 核对：
   - 已命中记录：同步文件列表、清除待核，提示原文件已落盘且未重复上传。
   - 未命中记录：标记已核对未发现；当前页签仍持有内存字节时允许直接按原 `operationId` 重试；刷新后内存字节不在时明确说明需重选原文件，重选后先核对文件名与 SHA-256 一致才沿原 `operationId` 重试，不一致则拒绝并保留待核。
   - 核对再次失败／服务不可达：保留 `UNKNOWN` 与原操作关联；`status === 0` 时展示现有启动入口（如双击「启动 OptraCall.command」或 `npm run start`）与日志目录指引，不自动拉起进程。
   - 明确新上传仍使用新 `operationId` 支持，不做全局按名／按内容去重或自动删文件；切换范围时待核记录按事项＋范围隔离。

### B. 候选保存错误定位

`src/host/strategy-candidate-host.ts` 复用既有 `StrategyDiscussionFault`（`exposure: 'safe-tool-error-v1'`）与 `details.issues`（白名单 `path/reason`），不改写官方 Pi SDK 或扩大安全白名单：

- 角色不允许字段（如 `version`、`no`、`candidateId` 等）：返回 `strategy_candidate_fields_invalid`（400），带修正文案与受限白名单 `issues`（安全 ASCII 标识输出 `path`，非安全键名回落父路径，不回显敏感键名）。
- `operationId` 缺失／非字符串／非 UUID：返回 `strategy_candidate_operation_invalid`（400）与 `path: 'operationId'`。
- `candidateBlocks` 缺失／非数组／数量不在 1–20／项非对象／未知字段／`id` 缺失或非法或重复／`label` 或 `text` 缺失、空白或超长（200 / 20000）：返回 `strategy_candidate_schema_invalid`（400）与精确 `candidateBlocks[i]...` 路径及原因。
- `candidateGoals` 非数组／超过 10 条／项非字符串、空白或超过 500 字：返回 `strategy_candidate_schema_invalid`（400）与 `candidateGoals`／`candidateGoals[i]` 路径及原因；省略仍合法为空数组。
- `src/host/server.ts` 仅对带 `details` 的候选校验故障同步投影安全 `details`，不影响旧战略地图与导入错误合同。所有校验先于写入，失败零写入。

### C. 限定修改的目标与澄清反馈

1. **精确目标与基线呈现**：`ReviseDialog`（开题与候选共用）在输入意图前明确展示基线版本、指纹前缀、当前所选修改块名称与 ID 以及该块当前原文预览；切换目标块即时刷新基线预览。提交给主会话的 `proposal` 上下文包含 `blockId`、`blockLabel`、`baselineText`、`request` 及同稿可用块清单（只读）。
2. **绑定回执与实际反馈**：`RevisionProposal` 增加向后兼容的可选 `feedback?: RevisionProposalFeedback`（记录 `requestId`、`outcome`、`replyText`、`failureCode`、`failureDetail`）。主会话运行结束但未调用 `initiative-propose-revision` 时，直接复用统一 Pi Runtime `run.completion` 返回的本轮脱敏文本与安全诊断，写入 `markTerminal`；失败／取消／未知分别记录安全原因，不复制原始 Provider 载荷。`initiative-propose-revision` 在提交回调内重核 `context.assertCurrent()`、`context.signal.throwIfAborted()` 及 proposal 归属，阻止取消后迟到工具结果改写状态。
3. **弹窗反馈与原讨论入口**：proposal 结束无补丁时，弹窗展示绑定本次 `proposalId`／`requestId` 的实际澄清或无需修改说明；Agent 未提供文字时如实说明。弹窗保留当前目标选择并允许用户改选块后继续拟改（Host 不替用户自动换块）。若 Agent 拟改文本与原文完全一致，提示无实际变化并阻止无意义另存。弹窗内及单候选方案页均提供只读「查看主会话原讨论」入口。

### D. 目标承接前置说明与草稿补目标路径

1. **前置透明**：`CandidateBody` 始终展示「可承接战略目标」区块（0 个时明示影响，有目标时列出清单）。候选锁定确认弹窗、战略发布页及发布确认弹窗均前置展示当前可承接目标数量与影响：0 个时说明可合法作为战略记录发布但发布后无法带入目标管理，并给出返回完善草稿或新建后续候选路径；有目标时直接呈现实际可承接清单，沿用既有确认步骤。
2. **草稿补目标**：未锁定候选详情与锁定确认弹窗提供一键打开该候选会话的入口；候选会话弹窗对未锁定草稿提示可通过自然语言让 Agent 读回正文并补充 `candidateGoals`，后台完成后同步刷新候选详情。
3. **锁后目标专项扩展**：锁定版不可原位修改（零写入）。锁后如需补充或修订目标，复用既有 `POST /candidates` 的 `parent: { candidateId, no }` 合同：Host 在新候选上下文中只读带出精确 `parentVersion`（父版 `contentSha256`、`blocks`、`goals`），创建新版本号、新独立 Pi 会话与新指纹；新版无锁定、无旧检验／发布凭证，须重新锁定、串行双检验与人工发布。

### E. 归属标识必填提示

`InitiativeEditorDialog` 明确标注「事项名称」「范围名称」「归属标识」为必填（与「上层企业标识（可选）」区分），附带 `aria-required="true"` 与简洁说明。表单提交统一校验：空值或仅填名称／仅填标识的半填范围行不得静默丢弃，显示可见红字错误（`role="alert"`）、标示 `aria-invalid="true"` 并聚焦到首个缺失字段，零创建。合法输入沿既有范围模型正常创建并维持稳定 `initiativeScopeKey`。验收记录明确保留「基线未复现静默失败」事实。

## 4. 允许修改路径与复用边界

- 进程与诊断：`scripts/start-host.mjs`、`scripts/host-entry.mjs`、`src/host/main.ts`
- 战略 Host 与工具：`src/host/strategy-candidate-host.ts`、`src/host/strategy-initiative-host.ts`、`src/host/strategy-initiative-reports.ts`、`src/host/strategy-initiative-types.ts`、`src/host/server.ts`、`src/agent/strategy-discussion.ts`
- 战略 UI：`src/host/ui/StrategyInitiativeWorkbench.tsx`、`src/host/ui/StrategyInitiativeGovernance.tsx`、`src/host/ui/strategy-initiative-client.ts`、`src/host/ui/strategy-initiative-view.tsx`、`src/host/ui/strategy-initiative.css`
- 测试与记录：`tests/strategy-*`、`tests/browser-issue-131-strategy-trial-round2.py`、`openspec/changes/issue-131-strategy-trial-round2/*`

不修改官方 `@earendil-works/pi-coding-agent` 1.4.0、不升级依赖或锁文件、不新增 Runtime／全局队列／平行会话层。

## 5. 会话接入记录（IN01–IN07）

| 项 | 本单安排 |
| --- | --- |
| IN01 | 已读根 `AGENTS.md`、工程规范 v1.14、`docs/agent-session-integration.md` 与战略规格；本规格记录 Interface v3、owner/profile 与验收范围。 |
| IN02 | 保持 `strategy-initiative`（`InitiativeMainSession`）与 `strategy-candidate`（`CandidateVersion`）既有 Host 静态注册和 owner-bound Ref，不向业务或前端暴露 domain 管理对象。 |
| IN03 | 启停、占用、取消、关闭、订阅与完成结果沿既有 `createAgentSessionDomain` 与 `run.completion` 复用，不新增平行运行状态账。 |
| IN04 | 候选校验、proposal 反馈绑定、父版上下文与 UI 展示留在战略业务适配器；公共会话层不加战略分支。 |
| IN05 | Host 核对范围、文件、指纹、proposal 归属与安全错误白名单；仅用隔离合成资料与合成 Provider。 |
| IN06 | Issue #131 由仓库所有者／Codex PM 正式外发，Antigravity/d3aa91c3 在授权范围内实施五项修正与接缝回归；所有持久与 DTO 变更为向后兼容可选字段。Codex PM 负责接回复验、非作者复核、集成、PR／CI 与结案。 |
| IN07 | 覆盖正常、取消、迟到结果、保存／重开、旧记录兼容、边界脚本 `check:agent-sessions`、完整 `npm run check` 与真实 Pi 合成链。 |

## 6. 四原则前置检查

- **Host 管环境**：Host 负责退出诊断日志、文件与操作身份核对、字段／权限门禁、proposal 归属与安全错误投影，不代作战略判断、不自动改选修订块、不自动重发或自动拉起进程。
- **Agent 自主执行**：Agent 根据安全 `path/reason` 自行修正候选保存；拟改遇目标不匹配或无需修改时自主澄清，由用户决定是否改选继续；补目标由 Agent 读回正文并自主形成可承接目标。
- **优先复用 Pi**：锁定官方 Pi 1.4.0 与 Interface v3，复用 `run.completion` 脱敏回复与安全诊断、`safe-tool-error-v1` 通道与候选独立会话生命周期，无平行推理循环。
- **减少人的操作**：待核上传一键核对并沿原编号重试；候选校验一步定位；拟改前直见目标原文，无补丁时直接看到澄清并可一键查主会话；无目标影响前置告知并提供一键回会话或父版新建入口；必填字段直观标注并自动聚焦错误位置。新增必做确认仅保留原有治理边界。

## 7. 验证、兼容与回退

每项先留真实 RED 或因果复现，再做最小 GREEN 修复与回归；联合验证以隔离合成 Host、官方 Pi 1.4.0、合成 Provider 与真实 Chrome（Playwright）走通完整战略选择链路及失败／并发／迟到／重开／权限负例，点验 1440px 与 390px 视口及键盘操作。最终执行 `npm audit --audit-level=high` 与完整 `npm run check`。

兼容与回退：新增 `RevisionProposal.feedback` 为可选字段，旧 `reports.json`／`candidates.json` 无需迁移可原位读回；`sessionStorage` 上传待核仅存元数据且带版本前缀，旧浏览器状态不受影响；日志为追加输出，不改既有 `host-ready` 或 `instance.json` 格式。回退只需切回基线提交，不覆盖或损坏升级期间新增的业务数据。

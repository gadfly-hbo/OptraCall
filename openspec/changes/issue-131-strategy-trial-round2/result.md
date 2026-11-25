# Issue #131 实施与验证记录

本记录按实际执行追加。PASS 只覆盖明确候选和命令；原始失败、环境失败、跳过、NOT_RUN、UNKNOWN、复核反例与待定位现象分开保留。

## 1. 领取、返工与环境

- Issue：`#131`（`[开发任务] 战略选择第二轮试用修正｜上传失联诊断与恢复、候选校验及拟改、承接预警`），2026-11-24 领取前回读为 Open、0 评论。
- 领取评论：`issuecomment-7133309069`（`IC_kwDOVaDnXM8AAAABqS2ojQ`），`Antigravity/d3aa91c3`。
- 首轮领取基线：`f9994cb7b5ad4f9ab52141f278085d9e21f05d45`（tree `74f5977d9518c1ccce93a44c8702a0da42ac3725`）；首轮候选 `09f488a9c580642468536c98e3472c9670b5617a`（回执 `issuecomment-7136004716`）。
- 独立复核退回返工：`issuecomment-7136369082`，确认 5 项具体缺口（见第 3 节保留记录），指定原 `Antigravity/d3aa91c3` 在同一任务分支统一修复。
- 返工整合基线：已合并最新 `origin/main` `85fdf79b763e97825f86e5734ee579d070d7422d`（#132 会员资产包六项试用反馈及任务发送恢复，合并提交 `db43d05c92bd14c4a6095264b618ede62fad1239`），完整保留 #132 的 `rejectedSend`／`native_run_start_rejected` 及全部改动。
- 任务分支：`work/antigravity/issue-131-strategy-trial-round2`。
- 实际环境：Linux Ubuntu 24.04（2 vCPU），Node `v25.9.0`，npm `11.12.1`，`@earendil-works/pi-coding-agent` `1.4.0`（`package.json`／`package-lock.json` 未修改），`/usr/bin/google-chrome` + Python Playwright。
- 真实 Provider、真实业务数据、真实 MacBook 现场取证、凭据读取、设备更新／服务切换：NOT_RUN，非本单授权范围。
- 待定位／未复现事实保留：
  - Mac 原现场「上传小 TXT 后 host-entry 进程消失」根因未在云端隔离环境复现，按待定位继续跟踪，不宣称已修复根因。
  - 原报告所称「空归属标识创建静默失败」在基线正常浏览器未复现（实际拦截并显示红字错误，零创建），本单按必填语义与定位提示改善纳入。

## 2. 首轮（`09f488a`）分项实施与历史验证记录保留

RED／GREEN 原始日志保存在被忽略的本地目录 `.local/issue-131/`，不入库。

| 项 | 首轮新增／扩展测试 | 首轮 GREEN |
| --- | --- | --- |
| A 上传诊断与恢复 | `tests/strategy-upload-diagnostics-and-recovery.test.ts`（3/3）；`strategy-initiative-ui.test.ts` I131-A | 通过 |
| B 候选校验定位 | `strategy-candidate-host.test.ts` I131-B；`strategy-save-cancel-queue.test.ts` I131-B | 通过 |
| C 限定修改与澄清 | `tests/strategy-revision-feedback-host.test.ts`；`strategy-save-cancel-queue.test.ts` I131-C；UI I131-C | 通过 |
| D 目标承接与补目标 | `tests/strategy-goal-supplementation-host.test.ts`；UI I131-D | 通过 |
| E 必填提示 | `strategy-initiative-ui.test.ts` I131-E | 13/13 |

首轮自检历史事实（原样保留）：
- 首轮分三批 `--test-concurrency=1` 共 362 项通过（48 + 162 + 152）；无头 Chromium E2E 通过。
- 无过滤完整 `npm run check`（首轮 467 文件）在本 2 vCPU VM 单命令 600s 上限处被环境超时截断（截止前 0 失败）；分段 PASS **不等同**于完整 `npm run check` 通过。
- 并发 4 运行曾因 2 vCPU 资源争用触发 `startTestHost()` 10s 启动超时（5 例环境性失败），已终止并改 `--test-concurrency=1`，不计入通过。

## 3. 独立复核 5 项反例保留与返工 RED／GREEN 记录

Codex PM 独立复核（`issuecomment-7136369082`）确认 `09f488a` 存在 5 项缺口，本轮逐项先写失败 RED 回归复现原反例，再做最小 GREEN 修复与永久回归（日志保存在 `.local/issue-131/rework-{host,ui}-{red,green}*.log`）：

| 返工项 | 复核反例事实保留 | 本轮 RED 复现 | 本轮修复与永久回归 | GREEN 结果 |
| --- | --- | --- | --- | --- |
| 必修 1 / A · 新上传覆盖旧待核 | 1st `first-unknown.txt` 503 后再传 `second-new.txt`，单槽 `sessionStorage` 被覆盖／成功清空，丢失旧 `operationId` 与指纹 | `strategy-initiative-ui.test.ts` `I131-A-Rework-1`（RED：缺多条账本） | `strategy-initiative-view.tsx` 与 `StrategyInitiativeWorkbench.tsx` 改为多条 `PendingInitiativeUpload[]` 账本（兼容升级旧单条对象）＋`Map<operationId, base64>`，每条独立卡片、独立核对／重选／放弃，新上传成功／UNKNOWN／4xx 拒绝均不影响其他 UNKNOWN；浏览器 E2E 实测 1st 503 → 2nd 201 → 3rd 503 → 刷新 → 独立按原编号恢复与放弃 | UI `I131-A-Rework-1` PASS；Chromium `rework_gap1_multi_pending_uploads` PASS |
| 必修 2 / C · 普通主会话接管 pending proposal | 普通主会话占用使 `revise-proposal` 报 409 留下 pending proposal `P`；停止后再发起普通主会话调用 `initiative-propose-revision(P)` 竟返回 `proposed` | `strategy-revision-feedback-host.test.ts` `I131-C-Rework-2`（真实 Host+Pi RED：普通请求竟成功将 `P` 标为 `proposed`） | `strategy-initiative-host.ts` 工具入口及 `options.mutate` 提交守卫内强制要求 `pendingInput.requestId === context.requestId && pendingInput.proposalId === proposal.proposalId && lastRun.id === context.requestId && lastRun.status === 'accepted'`；覆盖候选与开题 busy 遗留、普通请求、错绑其他提案、取消排队 | `I131-C-Rework-2` PASS；`strategy-save-cancel-queue.test.ts` PASS |
| 必修 3 / C · 等待 202 时改选导致差异与采纳错位 | 延迟 B1 POST 202 期间改选 B2 并改意图，返回后标题／旧文显示 B2、新文却是 B1，采纳发出 B2 patch＋B1 proposalId | `strategy-initiative-ui.test.ts` `I131-C-Rework-3`（RED：`<select>`/`<textarea>` 未禁用且读取可变 prop） | `ReviseDialog` 提交期禁用块选择与意图输入（`disabled={busy}`），请求前捕获不可变 `SubmittedProposalSnapshot` 并配提交序号守卫；waiting／poll／反馈／diff／`noActualChange`／adopt 严格绑定不可变快照，检测到外部 props 漂移时给出警示；浏览器实测延迟 202（开题＋候选共用弹窗） | UI `I131-C-Rework-3` PASS；Chromium `rework_gap3_revise_freeze_and_snapshot` PASS |
| 必修 4 / C · 目标块变化后旧基线 proposal 套新 CAS 采纳 | 预算 200000 拟成 300000 后候选会话合法保存同 v1 为 500000，带最新 whole/block SHA 与原 proposalId 调 `/revise` 竟返回 201 另存 v2 为 300000 | `strategy-revision-feedback-host.test.ts` `I131-C-Rework-4`（真实 Host+Pi RED：`/revise` 返回 201 而非 409） | 开题与候选在派发（`send`＋`verifyBeforeDispatch`）、工具提交（`guardCommit`＋`markProposed`）与采纳（`revise` 同时核对当前块 SHA 与补丁 `expectedOldSha256` 均等于 `proposal.baselineSha256`）全边界拦截并返回 409 `strategy_proposal_baseline_changed`＋重新拟改提示；失败零写入，旧记录兼容可读 | `I131-C-Rework-4`（派发前／运行中／采纳三场景）PASS |
| 必修 5 / D · 合法长父版持续 413 并遗留空版本 | 4 块 × 20,000 字（80,000 字）父版锁定后 `parent` 新建候选报 413，落空 v2，同 `operationId` 重放返 202 无 `requestId`，后续消息持续 413 | `strategy-goal-supplementation-host.test.ts` `I131-D-Rework-5`（真实 Host+Pi RED：`POST /candidates` 返回 413） | `contextBody.parentVersion` 改为常量大小精确元数据指针；候选会话 `initiative-read-candidate` 授权只读本版本或直接父版（无关候选仍 403），总正文 > 16384 返回无损目录＋`pagingRequired: true`，支持 `blockId`＋`offset`/`limit`（≤8192）无截断分页读回；`create()` 落盘前校验完整 prompt 预算（413 零新版本写入，绝不假重放 202）；覆盖 80k 字父版、20×20k＋10×500 最大合法边界、目录超预算 413 零写入、重放、后续对话、重锁双检验与父稿保全 | `I131-D-Rework-5` PASS；`strategy-rework-verification-host.test.ts` 4/4 PASS |

## 4. 返工候选联合验证（作者隔离自检，云端 2 vCPU VM）

| 命令／范围 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run check:agent-sessions` | PASS（最终提交 HEAD 复跑通过） |
| `npm run build` | PASS（最终提交 HEAD 复跑通过） |
| `npm audit --audit-level=high` | PASS（exit 0；0 high／critical；2 个 moderate 来自锁定 `@earendil-works/pi-coding-agent@1.4.0` → `minimatch`，未改依赖或锁文件） |
| 核心返工 + 战略 rework + `#132` 接缝回归（15 文件，`--test-concurrency=1`：`strategy-upload-diagnostics-and-recovery`、`strategy-candidate-host`、`strategy-revision-feedback-host`、`strategy-goal-supplementation-host`、`strategy-save-cancel-queue`、`strategy-initiative-ui`、6 个 `strategy-rework-*`、`agent-session-execution`、`member-operations-pack-store`、`issue-121-round2`） | **87/87 PASS**（0 fail，0 skipped，439.3s） |
| 其余战略事项 Host／Pi 回归（10 文件，`--test-concurrency=1`：`strategy-initiative-host`、`strategy-initiative-files-host`、`strategy-initiative-session-host`、`strategy-kickoff-host`、`strategy-revision-lock-host`、`strategy-publication-host`、`strategy-publication-handoff-recovery`、`strategy-verification-host`、`strategy-history-host`、`strategy-skills-host`） | **22/22 PASS**（0 fail，0 skipped，157.4s） |
| 无头 Chromium E2E `python3 tests/browser-issue-131-strategy-trial-round2.py`（最终提交 HEAD 构建，隔离 Host、官方 Pi 1.4.0、合成 Provider） | **PASS**：A–E + `rework_gap1_multi_pending_uploads` + `rework_gap3_revise_freeze_and_snapshot`（开题＋候选）+ 直接父版读回 + 版本台账 + 1440×900 & 390×844（无横向溢出）+ Escape 键；外部请求 0、页面错误 0、非预期 console 错误 0 |
| 无过滤完整 `npm run check`（现 468 文件） | **待 PM／CI 验证（本 VM 600s 单命令上限限制）**：单条命令完整顺序跑 468 文件在本 2 vCPU VM 超出 600s 上限无法在单命令内完成，未覆盖的其余无关测试文件记为 NOT_RUN，请 Codex PM／远端 CI 在 PR 上执行完整 `npm run check` |

## 5. 四原则与 IN01–IN07 自检（作者自检）

- **Host 管环境**：仅做诊断日志、上传身份／范围核对、字段与权限门禁、proposal 归属与基线新鲜度校验、直接父版受限分页读取与安全错误投影；不替 Agent 做战略判断、不自动重发、不自动拉起进程、不截断父稿或放大全局 prompt 上限。
- **Agent 自主执行**：候选保存按 `path/reason` 自修；拟改自主澄清；长父版由 Agent 按受限分页工具读回正文后形成补目标版本。
- **优先复用 Pi**：Pi 固定 `1.4.0`、`package.json`／`package-lock.json` 无改动，复用 `safe-tool-error-v1`、`run.completion` 与既有候选会话生命周期，无平行推理循环。
- **减少人的操作**：多条待核上传独立保全、互不覆盖；提交拟改期间冻结选择防误操作错位；目标影响前置提示与一键回会话／父版新建；必填项自动聚焦。
- **IN01–IN07**：Interface 沿用 v3，公共会话层保留 `#132` 改动且未掺入战略分支；新增字段均为可选兼容，`check:agent-sessions` PASS。

## 6. 兼容与安全回退（整合 #132 后）

- **代码回撤**：本分支已合入 `#132`（`85fdf79b763e97825f86e5734ee579d070d7422d`）。仅回退 Issue #131 时，**不得**回切到旧领取基线 `f9994cb7...`（避免误回退 `#132`）；应仅回撤 Issue #131 提交（回到 `#132` `85fdf79b763e97825f86e5734ee579d070d7422d` 或 `git revert` Issue #131 合并提交）。
- **数据兼容与保全**：`RevisionProposal.feedback` 为可选字段，旧版本可原位读回升级期间写入的 `reports.json`、`candidates.json`、原生 Pi JSONL 会话、锁定／检验／发布／承接记录与服务端文件，零数据损毁；追加退出诊断日志不改 `host-ready` 或 `instance.json` 格式。
- **旧消费端能力边界**：回退后旧前端不读取 `sessionStorage` 中的 `optracall.strategy-initiative.upload-pending.v1:*` 待核账本，不再展示多条 `UNKNOWN` 上传恢复卡片、重选 SHA-256 校验、拟改弹窗澄清回读、0 目标前置提示与必填定位；浏览器本地遗留的待核元数据与服务端文件均保留且不会被删除或自动重发。

## 7. NOT_RUN／未声明

- 非作者二次独立复核、远端 PR 与 CI、无过滤全仓 468 文件 `npm run check`：NOT_RUN／待 PM 与 CI 完成。
- 真实 LLM Provider、真实业务数据、MacBook 现场取证、设备更新／服务切换、用户产品验收：NOT_RUN。
- 作者自检不等于独立复核、CI 或用户验收；Issue #131 保持 Open，由 Codex PM 接回。

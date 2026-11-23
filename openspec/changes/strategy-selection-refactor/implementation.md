# 战略选择重构 · 任务目标执行清单与实施记录

Issue [#120](https://github.com/gadfly-hbo/OptraCall/issues/120) · 规格 [Spec v0.1](spec.md)（用户 2026-11-23 确认）· 领取方 Qoder（Mac mini · QoderCN CLI）

## 本轮任务目标与预期交付

将「战略选择」重构为战略共创、战略检验、战略发布、版本管理四个页签，交付从开题、比较与锁定方案到串行双检验、发布和目标承接的完整路径，通过 SS01–SS16 适用工程验收；推送候选任务分支并在 Issue 留「实现交付」回执交回 Codex。非作者独立复核、整合 main、PR head CI、squash 合并与结案由 Codex 负责。

## 身份与边界

- 任务分支：`work/qoder/issue-120-strategy-selection-refactor`（独立工作树 `/Users/bendandebaba/.qoder-cn/worktrees/issue-120-strategy-selection-refactor`）
- 基线：`origin/main` = `166c7136bc65c3cc37c237ef62f4652c01a79f2a`（领取时重新 fetch 核实）
- 固定设计输入：提交 `947f75c3df9e19748bfeb2b60d406bf462cb98fd` 的 Spec v0.1 与 UI Demo，已原样带入分支（首个提交 `3c4d23203ee0243e1d0a00231a98be8059b44cd5`）
- 运行边界：复用现有 Host、官方 Pi SDK 1.4.0、统一 Agent Session Interface v3（IN01–IN07）；隔离合成数据与合成 Provider。SDK/依赖升级、真实业务数据、真实模型调用、设备运行采用均不在本单授权内。
- 可修改范围：战略选择 UI、路由、Host、Agent、版本及发布记录、事项材料和目标候选承接接缝，连同直接相关规范、文案和回归测试。已有目标、历史文稿 GSA 交接及 Case/项目历史沿原入口回读。
- 证据位置：仓库内规格/测试/结果；原始命令输出与诊断现场放本工作树 `.local/issue-120/`（被忽略）。

## 执行清单

状态记法：待执行 / 进行中 / 完成（附证据）/ 受阻（附原因）。每项达到完成条件后立即更新并简记验证结果。

### 阶段 0 · 开工准备

| # | 任务 | 完成条件（验收映射） | 状态 |
| --- | --- | --- | --- |
| 0.1 | 开工核对隔离测试根 | 独立干净数据根启动真实 Host；旧有效发布读回为零（复用根则先清理并回读为零）；记录环境、实际动作、结果、分支与基线完整 SHA（Issue 验收第 1 项） | 完成（2026-11-23：干净根 `.local/issue-120/kickoff/root`，真实 Host sdkVersion 1.4.0，discussions=0、publications.json=0、active=0，干净停机；证据 `.local/issue-120/kickoff/evidence.json`，脚本 `.local/issue-120/kickoff-check.mjs`） |
| 0.2 | 现状盘点与接缝细化 | 核对现有 UI/Host/持久结构/接入规则与提案差额；细化 owner、API、历史读取和验证矩阵并记录于本文件（Spec §7） | 完成（见下「现状盘点」与「实施设计」节） |

### 阶段 1 · 开发一：创作与版本保全（SS01–SS07）

从真实用户入口的最小纵向切片起步，保留适用前置 RED/GREEN。

| # | 任务 | 完成条件（验收映射） | 状态 |
| --- | --- | --- | --- |
| 1.1 | 四页签工作台骨架与事项/范围定位 | SS01：四页签、共创两阶段、原位右侧文件树可定位；切换事项/范围不串材料或运行状态；复盘/重构仅占位说明 | 完成 |
| 1.2 | 事项文件视图与项目关联 | SS01/SS14：010/020/060 组织复用分析工作区；范围专属资料与切换保留；可选关联真实 projectId 核对权限；文件树不授予工具权限 | 完成 |
| 1.3 | 战略开题（grill-me 多轮 + deep-research 按需） | SS02：有/无历史经营资料两种输入均能开题；报告含 3–5 关键问题、依据、假设、缺口；开题 Schema 校验；两项 Skill 实际激活在隔离环境验证（来源待核定项如实记录） | 完成 |
| 1.4 | 开题锁定与应用门禁 | SS03：草稿不能用于阶段二；锁定=版本+指纹+人工凭证；应用后候选请求带准确开题版本与指纹；换新版后旧候选仍定位旧开题 | 完成 |
| 1.5 | 候选独立持久 Pi 会话 | SS04：同一开题 ≥2 候选各有不同持久会话、相同开题引用、独立输出；停止/关闭重开/重连/失答可读回；无显式操作不重复派发；每新版本新 owner+native | 完成 |
| 1.6 | 候选回传主窗口与同口径比较 | SS05：正确事项下收到准确候选；可打开各自原会话；主 Agent 同口径比较；候选内容覆盖公司/业务层、使命、增长、取舍、资源、假设 | 完成 |
| 1.7 | 限定式修改合同（开题+候选） | SS06：字段/文本块白名单补丁、原字节哈希校验、差异另存；越界/错版/来源撤回/重复回执/迟到结果按合同拒绝；原件与旧证据保留 | 完成 |
| 1.8 | 候选锁定与编辑立新 | SS07：锁定绑定准确版本与指纹；编辑锁定内容必立新候选+新会话；旧锁定及检验记录可回读 | 完成 |

### 阶段 2 · 开发二：检验、发布与承接（SS08–SS14）

| # | 任务 | 完成条件（验收映射） | 状态 |
| --- | --- | --- | --- |
| 2.1 | 串行双检验链 | SS08：TOC/TP 因果 → 战略假设逻辑，第二道仅同批第一道有效通过后自动启动；两道落证据/来源/结论；技术状态与业务判断分明；凭证绑定方案指纹与同一串行链 | 完成 |
| 2.2 | 检验负态与恢复 | SS09：不通过/依据不足/技术失败/取消/失答/配置变化/迟到结果均不制造通过或发布资格；改稿/改选/核对后重试按明确状态可用；中断先读回原操作结果 | 完成 |
| 2.3 | 发布页集中审核 | SS10：两门证据、准确版、未决项集中展示；模板切换指纹一致；跳过确认/旧版/错指纹/旧检验/未通过提交零写入（含直接 HTTP 负例） | 完成 |
| 2.4 | 单一有效发布治理 | SS11：同事项+同范围（稳定 scopeId）最多一条有效发布；新版原子替代留两条记录；跨范围并存；撤销后同锁定版禁重发；重复/并发按操作 ID 与请求指纹读回原回执（mutation queue 串行） | 完成 |
| 2.5 | 目标承接门禁 | SS12：发布不创建目标；有效正式版经用户选目标仅保存目标准确候选与发布来源；撤销/替代后拒绝新承接；旧目标与执行侧关联按准确版本回读 | 完成 |
| 2.6 | 版本管理与旧入口退出 | SS13：开题/候选/检验/发布/承接历史可查看筛选、回原讨论；区分未发布/新历史/旧记录/失读；旧地图发布不计有效版，旧发布/承接写入入口退出（直接请求也不绕过）；GSA/Case/项目历史可读；失读引用显示原身份；「查看准确版本」回执完整可读（Demo 已知裁切问题） | 完成 |
| 2.7 | 权限与来源负例 | SS14：正常 UI、公开 HTTP、隔离真实 Host 接缝验证未获准文件/越界路径/跨事项候选/旧配置/撤回来源拒绝；无关旧证据如实保留 | 完成 |

### 阶段 3 · 工程验证（SS15–SS16）

| # | 任务 | 完成条件（验收映射） | 状态 |
| --- | --- | --- | --- |
| 3.1 | 统一会话与兼容回归 | SS15：IN01–IN07 核对统一入口、Pi 1.4.0 实际版本、取消/配置切换/晚到事件/保存重开、受影响旧消费者与第三合成接入；真实 Pi SDK 隔离合成链路收录实际输出 | 完成 |
| 3.2 | 完整检查与浏览器验证 | SS16：同一候选过适用浏览器验证、完整 `npm run check`、四原则专项检查；分别记录通过/失败/跳过/未运行/未知 | 完成 |
| 3.3 | 兼容回退证明 | Spec §5：旧结构可读、新增带版本记录；回退产物可读性、升级后新增材料保护；不兼容时给出可核定范围与回退路径 | 完成 |
| 3.4 | 独立复核移交 | 非作者独立复核由 Codex 组织（Issue 约定）；本方固定候选、清单与证据索引供复核 | 待 Codex 组织 |

### 阶段 4 · 交付

| # | 任务 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| 4.1 | 推送候选与回执 | 推送任务分支、远端读回完整 SHA；Issue 留「实现交付 · Agent/实例 · 远端分支 · 基线完整 SHA · 候选完整 SHA」+ SS 覆盖、实际命令与结果、回退及缺口；交回 Codex 后停止写入 | 进行中 |

## 范围管理

- 以 SS01–SS16 与 Spec v0.1 为验收权威；开发中发现的新问题对照原任务判断影响的验收项。
- 本次引入的回归和直接阻塞在授权内最小修复；需扩权/改公共契约/新增独立能力时先更新受影响规格并交用户决定，期间继续可做项。
- 范围外问题记录于下方「范围外问题」节，留待后续。

## 实施记录

（按阶段追加：实际动作、命令、结果、证据位置。）

### 2026-11-23 领取

- 重新 fetch 核实 `origin/main` = `166c7136bc65c3cc37c237ef62f4652c01a79f2a`；建立独立工作树与任务分支；固定 Spec/Demo 自 `947f75c` 带入，提交 `3c4d23203ee0243e1d0a00231a98be8059b44cd5` 已推送并远端读回。
- 领取评论：https://github.com/gadfly-hbo/OptraCall/issues/120#issuecomment-7092918351 （读回确认为第一条有效领取）。
- 环境备注：全局 git credential helper 指向失效 gh 路径，推送用一次性 `-c credential.https://github.com.helper` 覆盖为 `/opt/homebrew/bin/gh`，未改任何 git 配置。

## 现状盘点（阶段 0.2）

### 前端（已核，2026-11-23 探索代理报告）

- 页签定义在 `src/host/ui/ManagementTabs.tsx:3-10`：战略区 5 stage（direction/compare/handoff/strategy-release/strategy-versions），无 URL 路由，App 内 view state（`App.tsx:128,715-721`）。
- 现有模型是「一个讨论 + 多地图版本」：`StrategyDiscussionPanel.tsx` 是唯一会话入口，地图候选共享同一 native 会话；无事项（initiative）概念（事项只在 Case 域）、无候选独立会话、无开题锁定（locked 仅 busy 瞬时布尔，背景/方法/模型随时可 PATCH）。
- 「战略检验」无对应物；最接近的 `StrategySimulationPanel` 是手动双版本情景试算，非串行双检验状态机。
- 发布治理已有版本级状态机（candidate/active/superseded/withdrawn、同 mapId 单 active、撤销禁同版重发）：`StrategyReleasePanel.tsx:15-32,111-130`，POST `/maps/{mapId}/versions/{v}/publication[/withdraw]`；但粒度是整张地图版本，非事项+范围。
- 承接入口：`MapGoalHandoff`（`StrategyWorkbookImport.tsx:38-52`）POST `/api/strategy/workbooks/handoff`；另有旧路径 `StrategyChoicePanel.tsx:48-59` POST `/versions/{v}/handoff`（历史文稿，绕过发布治理，需退役写入）。
- 战略工作台无文件树：`ProjectFiles`（`ProjectSpace.tsx:32-82`）仅 chat/studio 门控（`App.tsx:215`）；战略侧资料入口是附件选择弹窗。
- 讨论 client：`strategy-discussion-client.ts`，SSE `/events` + sessionStorage 请求日志恢复。
- 测试波及面：页签改名会波及 `v12-strategy-ui.test.ts` SSR 断言及全部按中文按钮名定位的 Playwright 脚本（browser-strategy-workbench/release/map-import、browser-issue-108/115）。

### Host 与持久结构（已核，2026-11-23 探索代理报告）

- Pi SDK 锁定 1.4.0（package.json:21）；Interface v3（agent-sessions.ts:5）。Host mutation queue 单链串行（server.ts:471,501）；`SessionTurn.verifyBeforeDispatch` 在 mutate 内派发前校验（agent-sessions.ts:270-281）——串行双检验挂载点。
- 讨论 Host：`strategy-discussion-host.ts:61` 工厂，profile key=讨论 UUID，同工厂两实例（strategy-discussions / business-role-discussions，server.ts:1195,1463）。持久根 `dataRoot/strategy-discussions/<id>/`（owner.json formatVersion 1 + native/ + workspace/ + maps/）。owner 无 initiative/scope 概念。
- 现有「版本」= 选择表五字段（strategy-choice-versions.ts）与地图版本（strategy-map-store.ts，operationId 幂等+expectedVersion CAS+requestHash）。
- 发布治理骨架可复用：`strategy-map-publication-store.ts` active/superseded/withdrawn、operationId 幂等、同版禁重发（:84）、旧版禁接替（:85）、active() 承接门禁（:113-119）；**治理键现为 discussionId+mapId，需改为 initiativeId+scopeId 的新索引**。
- 承接：workbook handoff 已强制 publicationId+activePublication（strategy-workbook-routes.ts:87-89）；goalCandidatesFromRows（structured-goal.ts:18-39）+ saveTable/tableReceipts + mapHandoffs 反查可沿用。旧选择表 handoff（server.ts:2682-2690，无发布治理）需退役写入。
- 限定修改先例：mergeFixedImportSources/verifyDraftImportSources（host:348-432，固定上界/禁扩页/requireTurnScope）、validatePatch 键白名单（:76-87）、zod strictObject+mapFields 脱敏（strategy-map-store.ts:24-40）。
- 只读另存先例：verification-host.ts:75-217（fixed-draft capabilityPolicy、固定源 sha 冻结、saveReport 另存）。
- 取证范式：sourceAccesses（host:103-283）从原生 transcript 重建已读来源/回执投影，双检验证据可复用。
- 旧写入端点清单已核（server.ts:2614-2726）：地图 publication publish/withdraw（:2624-2635）、选择表 handoff（:2682-2690）、workbook handoff（:2718-2722）等；退役/改门禁时逐条对照。
- 测试范式：strategy-map-publication-host.test.ts（真实 Host 门禁/幂等/撤销）最贴近新发布治理；startTestHost 集成范式待验证基建报告确认。

**新建 vs 复用判断**：复用会话域/发布状态机/承接保存/白名单校验/取证范式；新建 initiative+scope 实体与发布索引、开题报告版本+锁定/应用状态机、候选版本独立会话 owner/profile、第二道假设逻辑检验、新 HTTP 路由与测试。

### 验证基建（已核，2026-11-23 探索代理报告）

- `npm run check` = check:agent-sessions（边界脚本）&& test（node --test tests/*.test.ts）&& build（tsc --noEmit + esbuild + 构建戳）。Node ≥25。
- 真实 Host 隔离启动：`tests/fixtures/host-process.ts:14-35` startTestHost（mkdtemp + `node scripts/host-entry.mjs --port=0 --data-root/--projects-root`，env 经 runtimeEnvironment()：OPTRACALL_HOST_ISOLATED=1/PI_OFFLINE=1 等；stdout host-ready JSON 取端口）。请求头必须 `x-optracall-client:1` + `origin: http://127.0.0.1:<uiPort>`。host-entry.mjs 硬门禁 OPTRACALL_HOST_ISOLATED=1。
- 合成 Provider：`tests/fixtures/tool-provider.ts`（工具调用版，真实 SDK 执行工具，loopback 只造协议回复）；接线 `PUT /api/configuration {provider:'openai-compatible',baseUrl,model:'synthetic-*',apiKey:'synthetic-*'}`。纯存储测试可用死端口 baseUrl（strategy-map-publication-host.test.ts:18-21）。
- 浏览器：Playwright 全局绝对路径 import（/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs）+ channel:'chrome' + 非本机 origin 全 abort；UI 伺服两路：`--ui-root=dist`（先 build）或 frontend.mjs dev 反代。证据写 `.local/issue-120/`。
- 边界登记：新 Host 会话注册文件 → scripts/check-agent-session-boundary.mjs:74-76 domainRegistrars；新真实 SDK 测试 → :11-44 projectAgentOwners。
- 零发布核对：GET /api/strategy/discussions 为空，或逐讨论逐地图 GET publications 数 active=0；发布文件 `<dataRoot>/strategy-discussions/<id>/maps/<mapId>/publications.json`。

### 已确认 Demo 状态模型（ui-demo/demo.js 研读）

- 页签 `create/check/release/history`；create 内两阶段 `kickoff/plans`；顶部 scope 选择（事项在 Demo 中单一，产品需 initiativeId+scopeId）。
- 开题：`reportVersions[{no, blocks, locked}]`，应用指针按范围 `anchors[scope]`；锁定→应用→候选锚定 `anchor`；修订另存新草稿版。
- 候选：`{id, family, title, no, session, parent, anchor, scope, blocks, goals, gates[2], locked, lockId, running, returned, patch, publication}`；每版本独立会话；修订=同 family 新 no+新会话；`returned`（检验退回）后修订重走因果。
- 检验门：`{ref, status: running/pass/fail/insufficient/unknown, evidence}`；第二道仅第一道 pass 后自动启动；fail/insufficient 置 returned；unknown 可按原 ref 重试；`eligible = locked && 双 pass && !publication && !returned`。
- 发布：同 scope 单 active；publish 原子替代（旧→replaced）；withdraw→withdrawn 禁同版重发；承接仅 active 时保存目标候选+回执；模板（树形地图/条目表）只改呈现。
- 文件：010 原件（含范围专属新增）、020 整理、060 锁定报告/候选/检验报告自动生成。
- 历史：开题/候选/发布台账+操作时间线；「查看准确版本」弹窗须完整可读（SS13，Demo 已知裁切缺陷）。

## 实施设计（owner / API / 持久结构 / 验证矩阵）

按 Spec §5「实际类型名由后续实施核定」细化如下；实施中如有实质变化先更新本节。

### 持久结构（新增，旧结构原位只读）

- 新根 `dataRoot/strategy-initiatives/`：
  - `index.json`：事项清单 `{initiativeId, title, scopes:[{scopeId, name, orgRef}], revision, createdAt}`；scopeId 稳定归属标识，改名不换 ID。schemaVersion 1，原子写+CAS（沿 discussion-store 范式）。
  - `<initiativeId>/reports.json`：开题报告版本链 `{no, fields(结构化 Schema), contentSha256, sources, parent, generationReceipt, lock?:{operator, at, fingerprint}, }`；应用指针按范围存 `anchors:{scopeId: {reportNo, contentSha256, at, operator}}`。
  - `<initiativeId>/candidates.json`：候选版本 `{candidateId, family, no, scopeId, anchor:{reportNo,sha}, parent, contentSha256, blocks, sessionId, nativeReceipt, lock?:{...}, returned?}`；每版本独立 native 目录。
  - `<initiativeId>/verifications.json`：检验批次 `{batchId, candidateId, contentSha256, gates:[{turn, operationId, sessionId, status(技术), verdict(pass/fail/insufficient), evidence, sources, at}], chain 绑定}`。
  - `<initiativeId>/publications.json`：发布记录，治理键 `initiativeId+scopeId`；状态 active/replaced/withdrawn；operationId 幂等+请求指纹；替代原子完成；withdrawn 同锁定版禁重发。
  - `<initiativeId>/files/010_draw|020_clean|060_reports/`：事项文件（共用+范围专属元数据），权限沿既有上传/读取合同。
  - `<initiativeId>/native/<ownerKey>/`：主会话、候选会话、检验会话的 Pi 原生目录（每 owner 独立）。
- 旧 `strategy-discussions/`、`strategy-goals/` 原位保留；旧地图发布不计当前有效版；指向已清理测试稿的引用显示原身份+失读。

### 会话 owner 与 profile（Interface v3，均经 createAgentSessionDomain）

| 域 | owner | profile key | 说明 |
| --- | --- | --- | --- |
| strategy-initiative（主会话） | `{kind:'main', initiativeId, scopeId}` | ownerKey | 开题访谈/研究、候选比较汇总；专用工具读报告/候选/来源，grill-me/deep-research 按获准资产 |
| strategy-candidate（候选会话） | `{kind:'candidate', initiativeId, scopeId, candidateId, no}` | ownerKey | 每版本新 owner+native；基线冻结（开题准确引用+固定材料）；产出候选稿回传 |
| strategy-verification（检验会话） | `{kind:'gate', initiativeId, candidateId, no, batchId, turn}` | ownerKey | 只读锁定版+获准检验材料；产出证据+结论；第二道由 Host 在同批第一道有效通过后派发 |

- 配置冻结沿现有 configurationId/revision 快照；注册文件登记 domainRegistrars。
- 串行链与发布门禁在 Host mutate 队列内 `verifyBeforeDispatch`/落盘前重验：指纹、批次、前序通过凭证、归属、期望版本。

### HTTP API（新增，前缀 /api/strategy/initiatives）

- 事项/范围：GET/POST `/`，PATCH `/:id`（改名等），GET `/:id`（详情聚合）。
- 文件：GET `/:id/files`、POST `/:id/files`（上传，010/020 限制沿旧合同）、GET 文件内容（权限核对）。
- 主会话：POST `/:id/messages`（202+SSE `/events`）、stop/close；沿讨论 send 幂等范式。
- 开题：GET `/:id/reports`、POST `/:id/reports/:no/lock`、POST `/:id/reports/:no/apply`（scopeId）、POST `/:id/reports/:no/revise`（限定补丁）。
- 候选：GET `/:id/candidates`、POST `/:id/candidates`（新建/修订，dispatch 独立会话）、GET `/:id/candidates/:cid/versions/:no`、POST `.../lock`、POST `.../revise`、GET `.../session`（原会话回读）。
- 检验：POST `/:id/candidates/:cid/versions/:no/verify`（启批）、GET `.../verifications`、POST `.../gates/:turn/retry`（原编号核对重试）、stop。
- 发布：GET `/:id/publications`、POST `/:id/publications`（publish，带候选准确引用+双凭证+操作确认）、POST `/:id/publications/:pubId/withdraw`。
- 承接：POST `/:id/publications/:pubId/handoff`（选目标+scope，保存目标候选，沿 GoalStore saveTable/tableReceipts）。
- 历史：GET `/:id/history`（开题/候选/检验/发布/承接台账+旧记录引用与失读状态）。
- 旧写入退役：地图 publication publish/withdraw、选择表 handoff、旧 workbook handoff 的写入返回稳定错误码（读保留）；直接请求同样拒绝。

### 限定修改合同（Host 校验）

装载准确基线→校验版本/哈希/权限/目标 ID/预期旧值/操作类型→结构化按稳定块 ID、叙述按文本块字节哈希→仅替换授权片段，其余原字节原序复用→生成实际差异→越界/歧义/旧值冲突/结构不合法拒绝→另存新版本（父版/原请求/范围/差异/作者/来源）。候选修订必新会话；开题修订须再锁定+应用。

### 验证矩阵（SS → 测试/入口）

| SS | 主要验证 |
| --- | --- |
| SS01 | SSR UI 测试（四页签/两阶段/占位）+ 浏览器切换事项/范围不串状态 |
| SS02 | 真实 Host+合成 Provider：有/无历史资料开题，Schema 校验，3–5 命题 |
| SS03 | Host 集成：草稿拒绝、锁定+应用指纹传递、换版旧候选定位 |
| SS04 | Host 集成+浏览器：≥2 候选独立 native、停止/重开/重连/失答读回、无重复派发 |
| SS05 | Host 集成+浏览器：回传归属、原会话入口、主 Agent 比较 |
| SS06 | Host 集成：补丁正例+越界/错版/撤回/重复/迟到负例，原件字节保全 |
| SS07 | Host 集成：锁定指纹绑定、编辑锁定版立新候选新会话 |
| SS08 | Host 集成+合成 Provider：串行链、第二道自动启动、证据落盘、凭证同指纹同链 |
| SS09 | Host 集成：fail/insufficient/技术失败/取消/失答/配置变化/迟到均不制造资格 |
| SS10 | Host 集成+浏览器：集中审核、模板指纹一致、绕行/旧版/错指纹零写入 |
| SS11 | Host 集成：单 active、原子替代、跨范围并存、撤销禁重发、并发/重复幂等 |
| SS12 | Host 集成：发布不创建目标、承接保存候选、撤销/替代拒新承接、旧关联回读 |
| SS13 | Host 集成+浏览器：历史台账、旧入口写入拒绝（含直接 HTTP）、GSA/Case 回读、失读引用、弹窗完整可读 |
| SS14 | UI+公开 HTTP+真实 Host：未获准文件/越界路径/跨事项/旧配置/撤回来源拒绝 |
| SS15 | check:agent-sessions + agent-sessions.test.ts 旧消费者 + 新域合成链路实际输出 |
| SS16 | 浏览器全链路 + 完整 npm run check + 四原则专项；非作者复核交 Codex |

前置 RED：每切片先写能检出目标行为的失败测试（环境/fixture 失败不算产品 RED），再最小 GREEN。

### 2026-11-23 开工核对（0.1）

- `npm ci` 按锁文件安装依赖（无升级）。
- 干净隔离根启动真实 Host：`node .local/issue-120/kickoff-check.mjs` → host-ready sdkVersion 1.4.0 / transportVersion 8.12.2；GET /api/strategy/discussions 空；dataRoot 内 publications.json 0 个；有效发布 0；SIGTERM 干净停机。证据：`.local/issue-120/kickoff/evidence.json`。

### 2026-11-23 开发一进展

- 切片一（事项存储+HTTP）：`3453ebb`。RED（404）→GREEN 2/2；创建幂等/冲突、范围稳定身份键、CAS 改名、字段白名单、重启读回。typecheck、check:agent-sessions 通过。证据 `.local/issue-120/{red,green}-initiative*.log`。
- 切片二（开题报告版本链，SS03 存储层）：`834e60d`。RED→GREEN；Schema 门禁（3–5 命题、稳定唯一 ID、字段白名单）、锁定指纹+操作者+时间、按范围应用指针、应用台账、operationId 幂等。证据 `.local/issue-120/{red,green}-kickoff.log`。
- 环境备注：Node 类型剥离不支持参数属性，Host 模块须用普通字段赋值（已修）。
- 切片三（事项文件存储）：`c933e6f`+`0e0d4dd`（类型收窄修复）。RED→GREEN；010/020 上传、范围归属、sha 校验、名称/目录白名单、跨事项隔离、operationId 幂等。
- 切片四（主会话，SS02）：`c2c6b64`。复用 strategyDiscussion port 扩展 initiative-files/read-file/read-kickoff/save-kickoff 四动作（讨论 Host 显式拒绝）；新域 strategy-initiative 登记 domainRegistrars；真实 Pi SDK+合成工具 Provider：开题草稿保存（generation.kind agent+requestId）、幂等回读不重发、Schema 负例零写入、停止 cancelled、关闭不唤模型、重启原生读回。修复两处实现错误：systemPrompt 须字符串数组；detail 用 domain.read 投影。受影响回归 51/51（讨论 Host/runtime、agent-sessions、事项四测试）。证据 `.local/issue-120/session-run*.log`、`regression-run1.log`。
- 待办提示：grill-me/deep-research 资产实际激活尚未验证（SS02 要求隔离环境验证，来源待核定项如实记录）；当前主会话提示词内置追问纪律，Skill 挂载按获准资产后续接入。
- 切片五（候选独立会话，SS04/SS05 基础）：`1dbd2ab`。新域 strategy-candidate；创建须已应用锁定开题（草稿门禁）；工具绑定本版本身份；双候选不同 native、同开题引用、续聊同会话、停止隔离、关闭重开、创建幂等不重派。修复 waitForRequests 绝对计数用法。
- 切片六（限定修改+锁定，SS06/SS07）：`594a949`。开题字段/命题路径补丁、候选块 ID 补丁；旧值字节哈希、白名单、越界/错版/旧值冲突/重复负例；原件与旧锁定保留；锁定绑定指纹+操作者；编辑锁定版立新候选新会话（修订版不自动唤模型）。修复 CandidateVersion CAS revision 与元数据字段名冲突（元数据改 revisionMeta）。回归 54/54。
- 顺序决定：开发一/二 Host 层先行（公开 HTTP 即真实用户入口接缝），四页签 UI 与文件树在端点齐备后实施，浏览器 E2E 覆盖真实用户入口（SS01/SS05/SS10/SS13/SS16）。
- 切片七（串行双检验，SS08/SS09）：`4c60ea3`。新域 strategy-verification；同批同指纹串行、第二道自动启动；fail/insufficient 停链退回；unknown 原批原编号重试；stop 先落 cancelled 修复派发竞态。
- 切片八（发布治理+承接，SS10/SS11/SS12）：`53ede05`。确认门禁+锁定指纹+同批双凭证；单 active 原子替代；撤销禁同版重发；承接经原 GoalStore 保存候选+发布来源回执；跨范围并存。
- 切片九（退役+历史，SS13）：`d9ce22c`。地图 publication 与 workbook handoff 写入退役（稳定码，直接请求同拒），读取保留；历史文稿 GSA 交接沿原合同（Spec §5 澄清，选择表 handoff 不退役）；history 聚合端点+旧讨论身份。旧测试改按退役合同断言，覆盖保留。
- 切片十（权限负例，SS14）：`1f877e4`。三域派发前重验原生历史文件读取的当前权限；跨事项隔离、越界路径、撤回来源零模型调用。
- 开发二 Host 层完成（SS08–SS14）。下一步：四页签 UI（SS01/SS05/SS10/SS13 界面）+ 浏览器 E2E，然后 SS15/SS16 完整验证。
- 切片十一（四页签 UI）：`f34a94f`。事项/范围 keyed 重挂载、三目录文件面板、两阶段共创、锁定/应用/限定修改差异对话框、候选会话入口与主会话比较、检验/发布/版本管理界面、旧讨论回读；修复承接归属选项含未注册企业范围被目标校验拒绝（改用页面已知有效目标范围）。

### 2026-11-23 工程验证（SS15/SS16）

- **完整 `npm run check`**：PASS。3228 项测试，3117 通过，0 失败，111 原有条件跳过；check:agent-sessions 边界与锁定 SDK 材料 PASS；tsc --noEmit 0 错误；build 成功（0.1.0-mvp.4）。证据 `.local/issue-120/full-check-run1.log`。
- **浏览器 E2E**（真实 Host + 合成工具 Provider + 系统 Chrome，非本机 origin 全 abort）：25/25 PASS。覆盖 SS01 四页签/两阶段/文件面板/占位/范围切换不串状态、SS03 锁定应用、SS04 双候选、SS05 比较区与主 Agent 回复、SS08 串行双检验、SS10 模板切换与未勾选禁发布、SS11 单 active/撤销停承接、SS12 承接候选态、SS13 台账/准确版本回执完整/弹窗滚动（scrollHeight 934 > clientHeight 558，overflowY auto）/390px 弹窗在视口内、SS16 1440/390 零横向溢出。证据 `.local/issue-120/browser-run5.log`、`browser/results.json`、截图 `browser/*.png`。脚本 `.local/issue-120/browser-strategy-initiative.mjs`。
- **SS15 IN01–IN07**：四新域（strategy-initiative/candidate/verification + 发布无会话）均经 createAgentSessionDomain 统一入口并登记 domainRegistrars；配置冻结与线路变化负例（`35c723d`）；取消/停止竞态修复（检验 stop 先落 cancelled）；迟到结果不推进（finalize requestId+status 守卫）；保存重开/重启读回测试；旧消费者（讨论 Host/runtime、agent-sessions 第三合成接入、地图发布退役合同）回归通过。
- **四原则专项检查**：通过（基于实际代码与运行记录）——Host 管环境（权限/冻结/门禁/重验），Agent 自主产出开题/候选/检验结论（Host 不代算），全部复用 Pi 1.4.0 统一域与既有 port/投影/折叠组件（无平行 Runtime），新增必做人工动作仅限规格列明治理动作。
- **非作者独立复核**：按 Issue 约定由 Codex 组织；本方固定候选与证据索引供复核。

### 已知缺口与未验证项（如实保留）

1. **grill-me/deep-research 实际激活 NOT_RUN**：事项会话沿 strategy-discussion capabilityPolicy（固定输入工具面），两项 Skill 未作为执行工具挂载；开题多轮追问由主会话提示词纪律与合成 Provider 验证。Spec 已列 grill-me 来源待核定；Skill 接入须沿工程规范测评门禁另行安排。
2. 候选/检验无 SSE 端点，UI 用 4s/3s 轮询（主会话有 SSE）；功能闭环已验证，实时性弱于主对话。
3. 候选 revise 不自动派发 Agent（与 Demo「修订即运行」不同）：另存新版为带补丁正文的候选态，经候选会话对话框继续对话；UI 文案已按此表述。
4. 二进制原件不支持文本预览（按元数据引用）；PDF 正文读取沿后续获准资产接入。
5. 真实模型专业质量、真实业务数据、设备运行采用、远端 CI 与用户产品验收均未在本轮授权内，分别核定。
6. 111 项跳过为原有条件跳过（非本轮新增）；本地检查不表述为远端 CI PASS。

### 2026-11-23 Codex 复核退回返工（评论 7094858710）

逐项修复并补可复跑回归（均先 RED 复现后 GREEN）：

1. **检验资格与发布状态**（`b4f6548`）：结论绑定实际请求（verdictRequestId），取消轮结论不被重试沿用；每次尝试终态留档（attempts）；业务退回同锁定版禁再启批/发布；证据 file/candidate/kickoff 来源须解析到准确身份与指纹；被替代版禁再发布；发布携带 expectedActive 并落盘前重验当前发布身份。回归 `tests/strategy-rework-verification-host.test.ts`。
2. **承接整批一致性**（`b8b6786`）：parseGoalDraft+validateGoal 全批预校验后才写入；per-goal 确定性 operationId 支持中途失败按原操作恢复；重试按 scope+selected 完整指纹，更改选择返回冲突。回归 `tests/strategy-rework-handoff-host.test.ts`。
3. **会话失败显式恢复**（`783ce0f`）：主会话/候选 send 支持 replacePendingRequestId（仅 failed/cancelled）；UI「替换原请求并发送」；重启读回恢复终态。回归 `tests/strategy-rework-recovery-host.test.ts`。
4. **开题来源与范围**（`8a214f3`+`f55059d`）：file 来源按 fileId+sha256 在保存/锁定/应用/修订核对；报告 scopeKeys，应用须目标范围∈报告范围；专属文件 HTTP 读取与 Agent 工具一致鉴范围；同名替换/篡改负例。回归 `tests/strategy-rework-sources-host.test.ts`。
5. **候选主流程**（`c6b5dca`）：比较 prompt 携带同开题最新候选正文/身份/sha；initiative-read-candidate 工具；限定修改改为意图→Agent 拟改（initiative-propose-revision，Host 绑定 proposalId 与块）→核对差异→采纳另存；修订重放覆盖精确补丁。回归 `tests/strategy-rework-candidate-flow-host.test.ts`。
6. **公开研究接入**（`2e52498`）：复用获准 createRequirementPublicSearch（initiative-public-search 独立域）；进程内隔离 minimax 合成原生搜索验证实际检索来源留档；无原生搜索能力配置如实 unavailable。回归 `tests/strategy-rework-research-host.test.ts`。
7. **准确历史入口**（`e901e08`）：准确版本弹窗「查看候选会话」入口；旧讨论回读 pinned 定位所选身份；尝试终态（含重试前 UNKNOWN/取消）台账与弹窗展示。SSR 断言补充。

**仍需用户决定（不记为完成）：**
- **deep-research Skill 激活**：基线含 `extensions/analysis-assets/deep-research` 资产，但事项会话沿 strategy-discussion 固定输入策略（noSkills）。启用需改变 capabilityPolicy 并按现行规范 v1.14（用户 2026-11-23 取消独立测评门禁）开发接入后直接启用——接入实施中。受影响验收：SS02 的 deep-research 实际激活。
- **grill-me 资产来源**：仓库内未找到 grill-me 资产（find 无结果），来源与接入待用户核定。受影响验收：SS02 的 grill-me 多轮追问资产激活（当前由主会话提示词纪律+合成 Provider 验证多轮访谈行为）。
- 公开研究已按获准既有能力接入并隔离验证（不依赖上述决定）；原生 Provider 线路由配置治理固定，产品 HTTP 配置不可指向 loopback，故实际执行验证采用进程内隔离 Host 范式（与 native-search-runtime 测试同源）。

### 2026-11-23 返工后验证

- **浏览器 E2E 29/29 PASS**（真实 Host + 合成 Provider + 系统 Chrome，每次运行独立干净数据根，非本机 origin 全 abort）：原 25 项 + 返工 4 项（准确版本弹窗候选会话入口、旧讨论回读定位、对话式限定修改 Agent 拟改核对、采纳另存新候选）。1440/390 零横向溢出；弹窗 scrollHeight 1068 > clientHeight 558，overflowY auto。证据 `.local/issue-120/browser-run11.log`、`browser/results.json`、截图。
- **UI 入口修复**（`05da867`）：已发布/撤销版提供「从此版修订」（恢复发布取新候选版本，Spec §3.4）。
- **夹具对齐**（`fe774a9`、`afbcab0`）：两处旧测试 file 来源补 fileId，符合返工4准确身份合同；单独重跑均通过。
- **完整 `npm run check` 最终复跑**：PASS（check-exit=0）。3238 项测试，3127 通过，**0 失败**，111 原有条件跳过；check:agent-sessions 边界与锁定 SDK 材料 PASS；tsc 0 错误；build 成功（0.1.0-mvp.4）。证据 `.local/issue-120/full-check-final.log`。前一轮 2 项失败均为夹具未对齐返工4合同，修复后复跑确认。

### 2026-11-23 第二轮返工（Codex 复核评论 7096723386）

吸收最新 main（51e9000，含规范 v1.14 取消 Skill 测评门禁）与确认版规格更新 9b29a86（`91426c8`）。逐项修复：

- **A 检验来源与启动恢复**（`4f73a8d`）：pass 须有可核对且属当前版本/权限范围的来源；start/retry/gate1 派发前失败落 failed 可恢复终态；mutation 内复核业务退回。回归：无来源通过拒发布、超长候选启动失败可重试。
- **B 承接操作归属**（`8264d36`）：per-goal 确定性 operationId 含 publicationId；复用既有目标前重验标题与发布来源。回归：跨发布同操作 ID 不串目标。
- **C 会话中断恢复**（`eaace90`）：accepted 且无存活资源（Host 崩溃重启）可显式替换；原 ID 只读回不重派；UI 替换按钮覆盖中断态。回归：SIGKILL 崩溃后主会话+候选替换恢复。
- **D 开题来源范围**（`e77886c`）：scopeKeys 由来源真实范围推导（专属文件限定）；显式超范围拒绝；共用来源保全事项范围。
- **E 限定修改终态**（`b775076`）：ended/failed 终态 + UI 继续入口；pendingInput 记录 proposalId；拟议端点等待前轮收敛后显式替换。回归：未拟改终态、连续拟改不拒。
- **SS02 两项 Skill**（`f769609`）：grill-me 产品资产（上游 MIT fb3629d 原文 + LICENSE + PROVENANCE + 战略开题适配节）；deep-research 复用仓库包。新 capabilityPolicy strategy-initiative：固定输入面 + skillsOverride 限定两资产 + initiative-read-skill 窄面读取原文与指纹（无通用文件工具）。真实 Pi 隔离验证实际加载与访谈/研究使用；候选/检验/旧讨论边界不变（54/54 回归）。
- 公开研究（前轮 `2e52498`）保持：minimax 合成原生搜索实际执行留来源；无能力配置如实 unavailable。

**验证**：浏览器 E2E **30/30 PASS**（含 SS02 技能能力、对话式限定修改、候选会话入口、旧讨论定位、双宽度零溢出、零外呼）。证据 `.local/issue-120/browser-final.log`。完整 `npm run check` 最终复跑 PASS（exit 0）：3244 项，3133 通过，0 失败，111 原有条件跳过；边界与锁定 SDK 材料 PASS；build 成功。证据 `.local/issue-120/full-check-final2.log`。

**仍保留的未验证项**：真实模型专业质量、真实业务数据、设备采用、远端 CI、用户产品验收分别核定；111 项原有条件跳过非本轮新增。

### 2026-11-23 第三轮返工（Codex 复核评论 7101345470）

- **F Skill 按范围加载**（`bf77d20`）：grill-me 移至 extensions/strategy-assets（不被普通资产扫描）；skillsOverride 按确切文件路径绑定；initiative-read-skill 支持包内 references/agents 资料与越界负例。普通项目任务不加载战略 Skill。
- **G 开题正文范围**（`2d78eaa`）：工作台按 scopeKeys 过滤；initiative-read-kickoff 按范围拒绝越界版本与列表；历史范围外仅身份+失读原因。
- **H 浏览器替换派发**（`662b2a6`+`8e64041`）：sendMain pending 锁不拦截显式替换；accepted 后 pending 保留至终态（崩溃重启可替换）；SSE null snapshot 守卫。浏览器验证替换派发一次、completed、无重复。
- **I 公开来源资格**（`1972a44`）：pass 须含 file/candidate/kickoff 准确身份来源；public 仅 http(s) URL；占位不生成凭证。
- **J 承接恢复一致性**（`b7f531d`）：per-goal operationId 含 requestFingerprint；同操作变更范围冲突；不同操作独立目标。

**验证**：浏览器主流程 30/30 + 崩溃替换 4/4 PASS；完整 `npm run check` 最终复跑 PASS（exit 0）：3248 项，3137 通过，0 失败，111 原有条件跳过；边界与锁定 SDK 材料 PASS；build 成功。证据 `.local/issue-120/full-check-final3.log`。

## 范围外问题

（暂无。）
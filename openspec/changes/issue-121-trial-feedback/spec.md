# Issue #121 试用反馈修复

- 状态：领取方已交付，PM 集成复核中
- 来源：[Issue #121 正式外发评论](https://github.com/gadfly-hbo/OptraCall/issues/121#issuecomment-7093149868)
- 领取：QoderCN / Mac mini 当前 Qoder 实例
- 任务分支：`work/qoder/issue-121-trial-feedback`
- 开工基线：`166c7136bc65c3cc37c237ef62f4652c01a79f2a`

## 目标与交付

在最新主线通过正常产品入口复现并诊断 P1，再用连续 SDD/TDD 完成已证实必要的最小修复；P2 同批推进，Studio 首版预览先复验、单列结论。交付一个固定候选、逐项证据和未验证项，推送任务分支并交回 Codex 组织独立复核、PR、CI 和合并；本领取方不自行合并、关闭 Issue、更新设备或切换服务。

## 规则与运行边界

- 工程规范 v1.12；统一会话 Interface v3，兼容既有 v1/v2 业务子集。
- 普通分析 owner 为真实 `projectId + taskId`，沿用 `project-tasks` profile、任务绑定配置和原生历史。Studio 的准确 owner/profile 在复现记录中按实际代码补记，不另建会话域或 Runtime。
- 官方 Pi SDK 保持 `1.4.0`，`undici` 保持 `8.12.2`；不修改官方包、不升级/降级依赖、不增加内部接口例外。
- Host 只处理环境、权限、工具校验、状态和安全诊断；Agent 继续自主选择分析方法、工具和纠错。校验错误返回具体可修正信息，不由 Host 代作专业判断。
- 只用隔离合成资料和合成 Provider 做工程验证。真实/付费模型、真实业务资料/凭据、权限扩大、设备更新和服务切换均不因本单自动启动；首版预览若缺少有效模型授权，明确保留 NOT_RUN，不用脚本输出冒充 Agent 首稿。
- 2026-11-23 用户单独授权“本次首版复验”：仅用已固定的未见合成样例，复用现有 GLM-5.3-Flash 付费配置完成一次 Studio 首版预览；保留首稿，不自动做 v2 或其他实验，不读取真实业务资料、不切换服务或操作设备。凭据仅经产品现有保存/导入入口进入隔离运行根，不写入日志或公开记录。
- 错误提示复用现有控件和状态入口；三层授权表单仅补齐 #111 已确认规格要求的用途/期间字段，属于既定合同缺漏，不新增布局、导航或权限交互流程，沿用原批准设计，无需另出 Demo。若后续出现其他明显 UI 变化，先停止受影响实现并提交可点击 Demo 审核。

## 允许修改路径

仅修改经复现证实与本单验收直接相关的下列路径，并在结果中列出实际文件：

- `src/`：新任务 Skill 选择与提交、统一会话既有接入、安全运行诊断、Studio/SAP/member-pack/交付声明工具及其现有 UI 错误投影。
- `extensions/`：仅当证据表明 OptraCall 自有工具或资产包装存在本单缺陷；不改官方 SDK，不擅自修改第三方 SDK。
- `tests/`、`scripts/`：对应永久回归和已有正常入口验证驱动；不为通过检查删除断言或扩大白名单。
- `openspec/changes/issue-121-trial-feedback/`：本规格、结果和公开可脱敏证据索引。

原始私有日志、命令输出和合成运行根仅放被忽略的 `.local/issue-121/`；公开仓库不放凭据、原始会话、客户数据或本机敏感路径。

## 任务目标执行清单与验收

- [x] **BASE：基线与证据。** 核对领取、最新 `origin/main`、独立工作树、实际 Pi 版本和基线检查；保留 MacBook `e1264c2` 的原始 3 失败/2 成功事实，旧版、最新主线和修复候选分别记录。
- [x] **P1：默认 Skill 启动。** 最新 main 同项目、同有效模型配置下做默认开启/明确取消对照，沿 UI→提交→持久化→统一 Pi 初始化定位 500；核清重复复选项状态来源。修复后两种选择均创建会话并收到首条回复，实际 Skill 与界面一致；确有初始化故障时给出具体下一步和安全诊断。
- [x] **P1-REG：受影响回归。** 覆盖已有可选 Skill、普通分析、Studio 建设会话，以及实际触及的取消、配置变化、保存/恢复路径。
- [x] **P2-TOOL：校验可定位。** 对 `studio_assets`、SAP、member-pack、`declare_analysis_delivery` 各验一类真实错误，覆盖适用的必填、枚举、格式或长度规则；沿产品同一工具路径验证非法输入拦截、改正后继续、结构化定位安全且不暴露原始资料/本地路径。
- [x] **P2-AUTH：授权指引与受控重算。** 同一合成资料区分上传、仅汇总、有效明细和撤权；提示缺失授权及处理入口/授权方。有效授权在准确项目、门店、期间和用途内沿既有受控工具完成一次重算，未授权和越界继续拒绝；无路径则保留阻断交回核定。
- [x] **MSG：提示对照。** 首条发送失败与权限拒绝分别显示启动故障和授权不足，不共用泛化文案掩盖原因。
- [x] **PREVIEW：首稿复验单列。** 用未见独立合成样例同时覆盖缺档、未成熟 30 日观察窗和首购历史不足，保留首次原稿；核对未知当零、未成熟队列和首次可见购买命名，区分 Agent 判断偏差与产品供给/发布缺陷。旧 v1/v2 证据不改写。
- [x] **DONE：完整候选。** 完成适用全量检查、正常产品/UI 路径、四原则与 SDK 边界专项、全新非作者独立复核及返修复验；固定候选和证据索引，推送并回读远端 SHA，在 #121 留实现交付回执后停止写入。

## 不做事项

不处理与上述验收无关的旧工具错误或泛化提示，不重建 IR/方法库/权限系统，不新增分析流程或人的普通操作，不做正式数据迁移、真实经营动作、SDK/Semantica 升级、Mac mini/MacBook 运行采用或用户产品验收。

---

## Round 2 追加范围与执行规格（2026-11-24）

- 状态：工程实现与验证完成，准备交回 PM Agent 审核、独立复核、PR/CI 与合并
- 来源：[Issue #121 Round 2 正式外发评论](https://github.com/gadfly-hbo/OptraCall/issues/121#issuecomment-7126052321)
- 领取评论：[Issue #121 Round 2 领取回执](https://github.com/gadfly-hbo/OptraCall/issues/121#issuecomment-7126196689)
- 领取方：Antigravity 云端工程 Agent
- 任务分支：`work/antigravity/issue-121-round2-fixes`
- 开工基线：`7ef6ebb81b735ffecdad3753217a96f02cb95c76`（与 MacBook 试用构建及二次复核基线一致）

### 规范、SDK 与界面边界

- 遵循工程规范 v1.14、四点产品原则（Host 管环境、Agent 自主执行、优先复用 Pi 已有能力、减少人的操作）与统一会话规范 IN01–IN07（Interface v3）。
- 普通分析与会员包受限任务沿用同一 `projectId + taskId` owner 与 `project-tasks` profile；官方 `@earendil-works/pi-coding-agent` 保持 `1.4.0`，`undici` 保持 `8.12.2`，不修改官方包、不放宽安全边界或文件/工具白名单。
- **UI Demo 适用性说明**：本轮 6 项均在既有表单、消息提示条、会员包草案表、历史列表与权限提示区内做原地缺陷修复与状态补全，不新增页面、顶层导航或全新交互流程，沿用原批准设计，因此无需单独出可点击 UI Demo 审批。
- **四原则前置核对**：
  - **Host 管环境**：受限任务隔离工作区由 Host 补建 `skills/` 快照根并保持只读边界；Host 校验用途字段与拼写并拒绝零写入；Host 显式返回接受前拒绝标记 `accepted: false`；Host 仅输出脱敏维护人/权责项目引导，绝不暴露口令/盐/哈希/凭据。
  - **Agent 自主执行**：受限任务加载固定内置 `data-analysis` Skill 后，仍由 Agent 自主分析并沿受控 `read_input` 重算，Host 不代算、不改写业务口径。
  - **优先复用 Pi 已有能力**：复用公开 `loadSkills`、`selectTaskSkills`、`snapshotProtectedSkills` 与原生 `read_input`，不自建第二套 Skill 加载或会话循环。
  - **减少人的操作**：首建包前直接露出可复用维护身份入口，消除换浏览器后找不到入口与有权人的折返；用途保存直接定位字段与拼写；接受前发送失败自动保底原文与状态，无需重写。

### Round 2 任务目标执行清单

- [x] **01 · P1 默认 Skill 阻断会员包受限项目分析**：补齐 `prepareRestrictedTaskWorkspace` 的 `skills` 快照根与 `project-session.ts` 受限任务固定 Skill 装载路径，保留文件/工具隔离、固定包摘要校验、明确取消、同名碰撞覆盖和通用目录顺序。
- [x] **02 · P2 发起体系建设表单必填提示与项目选择保留**：`StudioPage` 取消依赖瞬时浏览器原生提示，空白/纯空格目标展示持续可见的行内提示与下一步且零请求；仅切换项目关闭触发专属离开确认（与候选编辑确认分开验证），继续编辑保留项目，单次提交创建并进入对应项目任务。
- [x] **03 · P2 接受前发送失败保留原文与重试入口**：`server.ts` 对 `/messages` 接受前 4xx 拒绝显式返回 `accepted: false`；`App.tsx` 仅在 Host 接受后清草稿，拒绝时保留多行原文与按任务隔离的失败状态，离开/重开/完整刷新均可见、绝不自动重发、不伪装成已发送原生消息，其他任务不可见，保留既有 accepted-but-unknown 核对/去重规则。
- [x] **04 · P2 用途保存字段诊断与误建草案排除**：`pack-upsert-purpose` 事前校验全部字段并输出安全字段路径/期望形态/UTF-8 字节上限，显式拒绝复数 `evidenceNotes` 等错写键并保证零写入（`revision` 不变）；新增草案预览排除持久化与 UI 修正/排除/恢复入口，排除误建 `U-02` 后预览与发布版仅含有效项且保留历史版本可查。
- [x] **05 · P2 首次纯界面建立可复用维护身份与受阻指引**：在 `StudioMemberPackPanel` 顶部（建包前可见）与 `发起体系建设` 抽屉暴露具名维护身份（`op:*`）建立/登录入口；新增安全 `grantAuthorityGuidance` 并接入受阻引导 UI 与明细拒绝提示（不含凭据）；验证纯界面空企业建身份/首包→换浏览器受阻引导→重认证→授权 T05→独立新任务实读三表重算→他者只读→撤权阻断→历史临时会话包不静默迁移。
- [x] **06 · P3 新建任务弹窗与背景 Skill 复选框实测复验**：在真实 Chromium 展开旧任务「交接与依据」下，覆盖鼠标、键盘（Tab/Escape）与桌面/390×844 窄屏完成 5 轮开关复验，核实弹窗内仅 1 个默认 Skill 复选框、原生顶层 `<dialog>.showModal()` 遮罩阻断背景误点、键盘焦点不逃逸、任务目标明确且新旧任务状态完全独立，无误操作缺陷，不做无关 UI 改动。

### Round 2 PM 返工补充规格（依据 [comment-7128937545](https://github.com/gadfly-hbo/OptraCall/issues/121#issuecomment-7128937545)）

- **合并最新 `origin/main`**：合入 `f9994cb7b5ad4f9ab52141f278085d9e21f05d45`（PR `#130`，合并提交 `8edf0e4`），在 `src/host/server.ts` 同时保留 `#130` 的战略开题结构化错误 `details` 与 `#121` 的 `/messages` 接受前 `accepted: false`。
- **01 · 受限任务固定 Skill 真正可读（Linux + macOS）**：
  - Linux 无 `sandbox-exec` 降级路径（`restrictedHostToolsOnly`）：仅当任务开启 `assignment.skill` 时，在系统提示词明确宣告固定 Skill（`id@version`、`sha256`）并经官方 `defineTool` 暴露严格只读的 `read_task_skill`（校验 `packageIdentity` 摘要，拒绝绝对路径/`..`/隐藏文件/符号链接/硬链接/超限文件，且缺文件时返回 `task_skill_file_unavailable` 不泄漏宿主机路径）；显式取消 Skill 时完全不暴露提示与工具。
  - macOS `protectedTools` + `evaluateNativeToolCall`：对工作区与项目路径统一 `canonicalPath`（解决 `/var` → `/private/var` 符号链接别名），允许在 `deny-detail` 模式下只读访问 `workspaceRoot/skills`（`read`/`ls`/`find`/`grep`），同时显式拒绝 `write`/`edit`（`member_pack_skill_readonly`），并在 `bash`/`powershell`/`codemode` 枚举分支同步使用 `realProjectRoot` 与其父目录守卫。
  - 能力快照验证改在活跃打开会话（`POST /open`）与 `/skills` 上核对，兼容 macOS `ordinary` 结算即停机行为。
- **03 · 延迟 202 不重复发送、不覆盖较新草稿，且 Pi 确认收件前失败保留原稿**：
  - Host `ProjectStore.markRun` 仅写运行状态而不提前清草稿；`startProjectMessage` 与 `/commands` 严格在 `await run.accepted`（Pi 确认收件并完成原生会话登记）之后、发送 202 / 等待结果之前，调用原子 `ProjectStore.clearDraftIf(projectId, taskId, expectedText)` 仅当 `task.draft` 仍匹配本次发送原文（命令匹配 `trim`）时清空草稿；Pi 确认收件前任何失败（含 4xx 拒绝与原生会话写入失败 500 `sdk_operation_failed`）均绝不清空已保存草稿。
  - 前端 `App.tsx` 发前先排空该任务在途 `draftQueues` 并记录 `draftVersions` 快照，202 返回或 `requestAcceptedInSnapshot` 确认原生会话已登记该 `requestId` 时仅当草稿版本未变且无在途保存才清理本地未变草稿，不再发起盲目 `PATCH /draft ""` 覆盖用户较新保存草稿；未确认收件的 `interrupted` 失败不会误判为已接受，原草稿在当前页与刷新后保持完整。
- **04 · 临时取消勾选保持、非法用途零写入与等价领域大小写兼容**：
  - `StudioMemberPackPanel.tsx` 的 `syncSelectedPurposes` 改为按 `pack.id` 与各用途 `excludedFromPreview` 变化增量合并：同一资产包编辑 `U-01` 时保留用户对 `U-02` 的临时取消勾选，显式切换持久化排除或切换包时仍按服务端状态同步。
  - `EnterprisePackStore` 抽出只读 `validatePurposeInput` 与唯一领域归一入口 `normalizeDomain` / `findByDomain`（与 `ensurePack` 共享 `.trim().toLowerCase()`）；`studio-host.ts` 的 `pack-read` 与 `pack-upsert-purpose` 预检及 `member-pack-host.ts` 调 `bindContinuationOwner` 之前先完成全量字段校验，保证 0 包企业不创建空包、已归档原项目下非法接续请求不抬高 `revision` / 不新增 `continuationHistory` / 不更改 `activeOwnerProjectId`，且沿 `targetPurposeId` 使用默认/`member-operations`/`MEMBER-OPERATIONS` 等价领域修订时均命中同一资产包与同一用途。
- **05 · 维护身份验证期间禁用「发起建设」与实读行动态重算**：
  - `StudioPage.tsx` 在 `newOpBusy` 期间禁用「发起建设」提交与关闭（`allowLeave` + `PersonalDialog.busy`）并在 `newSystem()` 顶部兜底拦截；身份验证失败显示行内 `role="alert"` 且保留已填表单与项目选择；保留原临时会话创建路径不变。
  - 后端与 Chromium 测试均直接解析 `read_input` 实际返回的 CSV 行计算复购分子/分母（零硬编码 `2/3`），并补齐仅汇总授权、错误用途授权与撤权后的显式负例。
- **回退与数据兼容性说明**：
  - 新增持久化字段 `EnterprisePackPurpose.excludedFromPreview` / `excludedReason` 为可选字段，不破坏历史资产包、修订记录、任务固定快照、会话或授权读取。
  - 若代码回退到不识别 `excludedFromPreview` 的旧版本：已有资产包和历史发布版仍可正常加载且不丢数据，但旧版前端与预览逻辑会忽略 `excludedFromPreview: true`，在下次准备新预览时将曾被排除的草案重新纳入默认勾选列表，需人工手动取消勾选（或升级回含本修复的版本）以避免误发。

### Round 2 普通发送与个人选材的恢复

依据[PM 二次复验](https://github.com/gadfly-hbo/OptraCall/issues/121#issuecomment-7134764755)。适用工程规范 v1.14、会话 Interface v3、原 Project/Task owner 与原 Pi 1.4.0。Host 负责核对本次请求是否登记、受管执行资源是否关闭。Agent 继续自主处理用户问题和已授权的资料。

- 原生会话写入失败时保留草稿。明确未受理、正在执行、清理待核与请求结果未知应能区别。只有公共生命周期证明占用已释放，界面才允许发起新一轮。读状态和刷新页面不会自行重放消息。
- 普通任务恢复可写后，用户能在原任务从刷新后的界面直接发送，或显式重新连接后发送。一次人工发送产生一条原生用户消息。
- 附资料的请求若确证在派发前失败，用户能沿用原文和确切资料版本重新发送。仍须核对当时权限。发送结果确实不明时保留原请求身份，继续沿既有核对和查重路径。迟到的受理回执不能清除后写入的草稿。
- 核验通过隔离 Host、官方 Pi、本地合成 Provider 与真实 Chromium 进行。核对请求身份、原生用户消息、模型请求次数与草稿；保留原失败记录及同单其他五项回归。

第 04 项同时核对两种容易误报保存成功的输入。客户端可以原样带回用途的既有备注列表，通过单数 `evidenceNote` 增补依据。若修改或删减了列表中的旧备注，须指出 `payload.evidenceNotes`，保持原依据及修订号。经营取舍草案按已有字段契约校验问题和选项，指出缺失的位置；允许把有效的草案留待业务人员作选择。旧草案的局部错误应能被发现和修订，其他用途仍可查看。

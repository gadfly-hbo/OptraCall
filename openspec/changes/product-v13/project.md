# Project 与 Task 工程记录

本项对应 T2、T3、T4、C3、C4、C8–C12 及固定 Demo 的 project-review。沿用原项目工作目录、任务草稿、Pi 原生会话、schema 2 和 Interface v3 普通 Task profile。Project Agent 与 Pi 的角色绑定见本变更角色记录。以下运行全部使用独立合成项目、本地合成模型端点和临时数据根。

| 验收项 | 本轮实现与回读证据 |
|---|---|
| 六类 Task、同类多建、首次发送 | 原建任务表单保存 Requirement、Analysis、Plan、Decision、Do、Teach。相同名字或类型仍有独立 ID、会话目录和草稿。选定类型立即进入普通 Task；用户另行点击发送。旧无类型记录显示未分类。正常产品 Chrome 手建六类、两个 Analysis，首发并回读原回复。见 `tests/project-task-assignments-v13.test.ts`、`tests/project-host.test.ts` 中 v1.3 用例。 |
| 专业 Skill 默认及取消 | Analysis 复用原 `data-analysis@2.0.0-candidate.1`，Pi 目录内容 SHA 为 `05402899ac630de257799686828ae4b8a5f2ec1056427f711cc79a9eaf6ce0f6`。Host 核原发布目录和 SHA，普通 Pi 资源选择经公开 skillsOverride 传入。启用时真实 SDK 的 Skill 目录可查，取消后目录移除，原会话继续，早先已加载到历史的文字保留。`tests/project-runtime.test.ts` 的 typed task default 用例核 Pi 和合成供应端。其余五个候选可见，独立测评确认前保持不可选。 |
| 共用约定与阶段 | 无确认方案和共用约定即可开始。用户按需新增约定、调整内容或设置阶段目标与结束条件。确认版本只追加，同一操作可重试，旧基线冲突时拒绝写入。两个 Analysis 分别固定共用约定 v1、v2，重新打开第一项仍显示 v1。确认结束阶段后原任务草稿仍在。正常入口另可回看历史 Plan、准确回执及原 Task；旧项目当前确认方案的请求、共同前提可由新任务选择复用，按原计划、Case 和版本资格校验。 |
| 无 Plan 的成果交接 | 项目与原 Task 可查看准确成果，选择后打开下一 Task 表单，用户可改类型或取消。准确引用固定项目、Task、原请求、会话、消息或报告及 SHA，使用原报告写入回执、最终原生回复读取器。原结果缺失／已变化、跨项目或事项、失去权限、超出预算保留受限状态。查找可返回其余有效项。普通 Pi 工具 `read_project_task_results` 仅接收手选来源，不启动原 Task。公共 Host 用例从零 Plan revision 启动 Analysis，回读源回复并交给自建 Plan Task。 |
| Plan／Teach 的 Case 定位 | CaseBoard 预填用户将要创建的 Task 表单，创建前检查关联项目与准确事项。Teach 取舍轮次与事项须相符，发往原角色前再取准确上下文。Case 事项、取舍及反馈的完整回路见 Case 分项。 |
| T4 两种口径与同一方法 | `tests/sap-methods-host.test.ts` 的 T4 用例经产品 HTTP、真实 Pi、可控合成模型执行。从原 Analysis 会话提炼 IR，核 `origin=ir` 和原 Session 来源，明确发布 v1。两个手建 Analysis 分别获得会员／月 v1.0.0、家庭／季 v1.1.0 的准确已发布指标定义。两者的语义工具返回同一方法 ID、版本、SHA 和限制。每个任务各有三轮模型请求，两任务合计六次；先后从各自准确成果 URL 回读当时原结论。测试核工具实际交付；合成回复按测试场景返回，不能据此评定自由模型的专业适用性或重复解释成本。 |

## 工程核验

- 初始 RED 分别保存在本机 `.local/product-v13/task-assignment-red.log`、`task-handoff-red.log`、`task-skill-red.log`、`task-skill-red2.log`、`task-stage-red.log`。实现后的存储、来源分页/变更/撤权、旧 Plan UI、数据库授权等 43 个定向用例通过，见 `task-final-unit.log`。
- 最后一次类型检查及会话接入边界检查均以 0 退出，见 `task-typecheck.log`、`task-session-check.log`。
- 公共产品 Host 普通任务、Pi 下发 Skill 的针对性测试及 T4 分别见 `task-final-host.log`、`task-skill-green.log`、`task-t4.log`。每项均可从上述仓库测试重跑。
- 本机隔离 Chrome 正常产品入口点验的表单操作、阶段目标、七次手工创建（涵盖六类、两个 Analysis）、v1/v2 共用约定、成果预览和新 Plan 接入，见 `.local/product-v13/task-browser/run2.log`、`http-run2.json`、`task-inputs.png`。固定代码再次重启隔离 Host 的结果见 `run3.log`、`http.json`。Chrome 从项目地图进入，创建与发送两次独立操作，浏览器错误列表为空。旧 Plan 当前产品入口可浏览原方案与授权记录，保留准确任务链接。

## 兼容、回退与验收边界

新增字段均可缺省；历史任务分类、历史成果与旧原生 JSONL 均不补写。既有确认 Plan 参与者可继续沿原确认来源与准确原任务读取。重试同一次手工建任务使用相同操作 ID，重开时不会重复建会话。调整约定、改 Skill 或结束阶段均保留已有会话和记录。切回旧 Host 时应在停写后使用独立的升级前备份作为可写根，并完整保全 v1.3 根；旧版 schema 2 写回可能丢弃新增字段。新旧根不得交叉覆盖。

尚未取得五个新专业 Skill 的独立确认、真实业务模型自由采用／专业质量、真实生产数据下的节时收益、部署与用户产品验收。本目录的 Chrome 和测试结果仅代表隔离工程点验。来源权限检查覆盖已知 Case、显式输入的数据库出处、原任务/项目及目标模型；自由工具自行写入文件的非声明业务血缘不可由 Host 推断。

## 首轮独立复核后的来源权限修订

规范／规格复核发现，上一候选只校验所选回复当轮的材料，并且 Project 角色的成果目录复用了来源身份查询。两条 P1 均已修订。上述首轮隔离点验和早先候选的局限保留。

- 新的公共来源校验沿准确回复／报告的 Pi 原生父节点回溯，遇到分支摘要时也核其原分支。读取过的 Task 成果、Teach 已提供的计划来源走同一次有界递归。各层以准确项目、Task、会话、消息或报告回执及内容 SHA 对齐，检查原 Case／事项、显式项目数据、目标模型出口与接收 Task 的原授权。图的环、预算用尽、缺失的归属、原件内容变动均拒绝本次交付。每次请求重新检查，归档、撤权、模型变化及原生快照在读取过程中变动不会沿用先前授权。
- 用户建 Task、Task 工具目录及正文、已接收过来源的 Task 重开和再次发送，以及 Project 角色的来源目录、正文、续接和换模型都走该校验。Demo 的 Project 普通工作保持可单独推进。复用现有数据库授权、模型出口、数据源目录、原生报告／消息读取与 Case 准入；未增加用户审批步骤。
- `tests/project-result-lineage.test.ts` 的祖先树实例同时包含允许的祖先、另一条分支与跨分支摘要，另核缺失、循环与预算。首次缺实现的 RED 见 `.local/product-v13/task-lineage-red.log`。
- `tests/project-host.test.ts` 新增两条公开产品 HTTP / Pi 用例：带 Case 的原轮、下一轮归纳、未关联收件人不可选，独立 Task 继续可用；Enterprise 原轮、后轮摘要、另一 Task 工具读取后再综合、Project 角色取得下游原文，撤权后阻止原／下游继续共享、重开、改模型和再发，模型请求数保持。固定 SHA 与实际工具交付均在本机合成实例核对。
- `tests/pm01-db-source-boundary.test.ts` 的 v1.3 子用例使用合成数据库元数据、两个本地模型配置。从一份有原 Task／数据库出处的准入说明形成第二轮摘要，Project 角色在原出口实际用工具阅读，此后切到未获准的模型返回 403，该出口新建收件 Task 也不能获得该结果；当前已获准配置仍能读取。期间未查询真实业务数据库或调用商业模型。
- 49 项来源／DB 定向回归、4 项公共 Task／跨口径入口、35 项完整 project-host／角色及关联回归分别通过（有重叠，独立统计）。记录位于 `.local/product-v13/task-lineage-unit.log`、`task-lineage-public.log`、`task-lineage-final.log`。联合类型检查和会话接入边界检查通过，见 `task-lineage-ts.log` 和 `task-lineage-session.log`。
- 联合 Case/Goal 用例中 Case 闭环通过。Goal 的 Case 来源用例在 Task 创建前轮询运行中的原生会话时收到一次 `native_snapshot_changed` 409，首轮失败保存在 `task-lineage-case-dependent.log`，已告知 Goal 负责人。此次独立重查通过，另存 `task-lineage-goal-recheck.log`。Goal 负责人另已复现，最终候选结论以其修订后的回归及总复核为准。

本次检查覆盖原生记录可定位的材料、工具结果和权限。自由模型的专业结论，以及 SDK 之外由用户自行转录或工具写入但没有原生来源回执的业务血缘，未纳入证明。

## 二审后的 Project 事项范围与原生读取

- 普通 Task 在 Pi 追加原生会话时，原先的严格快照检查偶发 HTTP 500。合成测试在文件首次检查与打开之间追加一条合法记录，稳定重现首轮错误。现只对原生文件确有变更的读取最多检查五次，每次重取接收任务、模型及派发材料并完整核权。重复变更返回 409，损坏的原生内容在第一次读取时即停止。测试通过公开 Task GET 发起，使用独立合成账本，无须在测试中直接引入 SDK。RED 与诊断分别见 `.local/product-v13/task-native-poll-red.log`、`task-native-poll-diagnostic.log`。
- 角色完成时，Host 核对原生回复权限并再次读取 owner 的版本、原生文件、请求及最后运行状态。源材料核对期间由在途变为完成，会重新取同一归属的已核权回复。确定性用例覆盖 owner 修订号相同、回复在核验时刚完成的情况，验得两次权限核查和新的最后回复。保留过渡阶段的 Goal 失败记录 `task-native-poll-compat.log`。
- Case 具体事项的“回关联项目协作”把项目、Case 和事项传到 Project 角色。同项目的独立工作、同一个 Case 的不同事项及不同 Case 均沿各自的原生会话工作。成果查找、正文阅读和重开沿原模型、当前关联与准确事项核验；原生 Pi 在正常工具入口读到本事项 Plan 和 Teach。相同项目的其他 Case 及同 Case 另一事项的成果目录不含这些原件，错配 Case 与事项的入口得到 404。初次 RED 在 `task-issue-collaboration-red.log`；联测 `task-case-project-final.log` 通过 5/5。
- 真实隔离 Chrome 从同 Case 的第二项进入项目，刷新项目页，在独立项目工作和原事项间切换，再返回正确的原 Case 和事项并刷新。请求中的角色三元归属与所选事项一致。可重复运行 `node tests/browser-v13-project-issue.mjs`，见 `.local/product-v13/task-case-project-browser-final.log`。本项使用回环 Host、合成模型配置与合成提案，无真实业务资料。
- 普通 Task 原生读取、项目文件、Analysis 交付、自动反馈与复核、PM01 数据边界及来源发现的受影响回归 38/38，通过记录在 `task-native-poll-affected.log`。联合 TypeScript 和 SDK 会话接缝分别见 `task-case-project-ts.log`、`task-native-poll-boundary.log`。工程结果只覆盖上述路径，用户产品验收、实际部署及自由模型专业结果另记。

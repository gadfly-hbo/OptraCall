# Agent 大脑外部协作：最新 main 接缝对齐 v0.2

2026-11-28；产品源码依据为 `main@74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`，准备分支合并点由根 Agent 记录为 `a194207`。
承接 [reuse-audit v0.1历史及v0.2补充](reuse-audit.md)；旧基线 `4132a39` 的发现保留，本文定位以新 main 为准。
已读最新根 AGENTS、[工程规范](../../../docs/engineering-workflow.md)、[统一会话接入](../../../docs/agent-session-integration.md)及产品讨论稿；图工具未提供，按允许的 rg 只读核对。
范围仅为 spec/Demo/清单/Issue 准备的源码对齐；未修改产品代码/Git，未运行测试、模型、真实账号、外部 API 或部署。源码存在不等于运行验收通过。

## 1. 已实现与待开发的边界

| 项目 | 最新 main 已实现 | 本期仍待开发 |
| --- | --- | --- |
| 日常入口 | WorkspaceHome、明确回应请求、继续工作、原项目等待投影；Case 四页签和当前事项保留。 | 原 Task（含其原项目准确任务行及真实关联Case任务行）的 ExternalWork 摘要及其授权/详情/异常交互；本期不增加首页外派队列。 |
| 工作归属 | 六类 Task、Case事项 assignment、原项目/Task/原生会话、准确成果读口。 | 外派 work revision、认证 principal、有效领取/租约、交付及接受记录。 |
| 外部通信 | 已核验四服务账号、任务绑定、工具/仓库范围、写操作/UNKNOWN日志。 | work revision 级跨 turn 去重、WorkBuddy官方本机适配、可信领取和回传。 |
| 资产读取 | 本地语义/Studio准确读取与当前资格、来源和发布权威。 | 受保护远端入口、工作授权交集、外部身份、读取审计及准确引用。 |
| 结果续接 | 公共会话域、Task请求去重、后台完成投影、原生中断恢复。 | 可恢复外派只读收件、持久唤醒预留、stop暂停外派续接及其UI状态。 |

WorkBuddy云任务、首页统一外派投影、第二Runtime、第二正式资产库均不纳入。外部完成、接受、原任务完成、Case取舍、真实行动、经营效果与资产发布保持分开。

## 2. 日常工作台与 Case 的精确来源

| 源码定位 | 实际合同 | spec / Demo 应遵守 |
| --- | --- | --- |
| `src/host/ui/workspace-home-model.ts:9` | 初始普通入口为home；project/task、returnCase等链接分别进入原工作。 | 对齐最新首页导航，保留原入口；本期不重构首页或加入外派收件。 |
| `src/host/workspace-daily-routes.ts:27`；`src/host/home-pending.ts:133` | 首页是原权威记录的只读投影；请求状态逐条核资格。 | 不拿模型摘要、外派评论或“有结果”制造待处理Case请求。 |
| `workspace-daily-routes.ts:63`；`home-pending.ts:226` | externalWaiting仅为关联Case、active项目的显式awaiting_feedback；按project去重，issueId=null。 | 不把它改成外派work状态、不因外派完成清空它；未来统一投影另议。 |
| `home-pending.ts:208` | continueWork不猜当前事项，返回issueId=null，由Case导航状态决定。 | 外派快捷返回有准确origin才定位事项，不能用“最新/第一个事项”代替原对象。 |
| `src/host/ui/CaseBoard.tsx:230` | 四页签为当前工作、项目与任务、成果与依据、历史。 | 在原Task及其原项目准确Task行、真实关联Case任务行增加只读摘要；保留四页签与信息层级，不另造外派Case页面。 |
| `src/host/ui/case-board-navigation-model.ts:9,14,23` | 事项选择与辅助范围独立；任务依assignment.issue过滤，共享项目不绑定全部任务。 | 当前事项/全部当前Case切换只浏览，不新建、不重绑、不把别的Case工作带入。 |
| `src/host/ui/CaseBoard.tsx:196,197` | 按Case继续携带准确caseRevision/projectWorkRevision；成果依真实task事项归属筛选。 | 外派卡使用同一原Task/事项关系，外派状态不写回Case或ProjectWork。 |
| `src/host/ui/DailyCaseProjects.tsx:38,65,89` | 原任务表、打开原任务及可选按Case继续分开；最近运行完成不代表目标达成。 | 外派工作不是新增Task行，不覆盖原运行状态；摘要点击进入原Task的工作详情。 |

CaseIssue是业务事项，GitHub Issue是外部工单；合同及实现用不同字段保存，不能把二者的ID、状态或关闭含义混用。

## 3. 回应、原轮次及成果来源

- `src/host/case-decision-types.ts:92,99,110`：CaseDecisionRequest仅choose/observe；assignee是业务文字，不能证明外部登录身份。answered要匹配准确request/revision和策略/前choice，或Board project/item/task/authorization/feedbackBaseRevision。
- `src/host/case-issues.ts:74,97,522`：来源资格、回应状态及保存request保持原业务合同。外派principal、claim、交付接受不得写入respondsToRequest，撤回Case请求也不是取消外派。
- `src/host/ui/CaseIssuePanel.tsx:220,299,316`：准确request/revision定向打开取舍/观察，提交前保留原意图，未知先查原操作；外派UI可复用该恢复模式，不能复用为同一种业务记录。
- `src/host/ui/CaseFeedbackDialog.tsx:19,86,97`：观察要对应原行动和当前准确授权；外部交付/执行者自述不能直接冒充原始经营观察或自动消除待回应。
- `src/host/case-issues.ts:143,154,168,184`：Plan/Teach来源检查关联项目、Task assignment、原native回复session/message/hash；外派成果保留独立ExternalDeliveryRef，原Agent形成真实成果后才能沿原口交回。
- `src/host/ui/CaseIssuePanel.tsx:329,381`：已有核对原回复、回关联项目协作、准备Plan/Teach等入口。本期保留这些路径，不把“接受外派”改成替人取舍/授权行动。
- `src/host/ui/DailyCaseHistory.tsx:19,81`：历史与轮次按当前事项准确链只读显示，可返回当前工作；外派epoch/revision不是Case取舍轮次，不混在同一计数中。
- `src/host/project-task-results-types.ts:7,46`、`src/host/project-task-result-sources.ts:96`：真实native报告收据不能伪造；远端链接、已保全字节、外部交付接受和原Agent报告分别记录。
- `src/host/ui/CaseBoard.tsx:197,233`：共享项目文件须明确关联才是Case资料；`TaskReportEvidence.tsx:69`读取准确path/hash。接受外派不自动产生CaseArtifact或“已发布资产”。

## 4. 导航与输入保全的最小补齐

| 已有入口 | 可复用与当前缺口 |
| --- | --- |
| `src/host/ui/App.tsx:584,592` | 项目协作能携projectCase/projectIssue并以returnCase/returnIssue返回原事项。 |
| `App.tsx:909,920,929` | 首页按准确Case/请求/Task导航；读取不到不改选别的对象。 |
| `App.tsx:947`；`src/host/ui/TaskReportEvidence.tsx:23,100` | 报告精确版本和来源Case返回已有；sourceCase目前只有caseId/title，尚不能保证准确事项/页签返回。 |
| `src/host/ui/CaseBoard.tsx:77,223` | Case视图按case保留事项/页签/辅助范围，项目→Case已有返回原项目按钮。 |
| `src/host/ui/workspace-input-guards.ts:2,7`；`useCaseActionDraft.ts:62` | UI输入flush守卫、Case动作草稿保全；不是Agent运行/会话台账。 |

本期在外派入口保存最少navigation origin：原project/task、可选真实case/issue、来源页签、workId、触发控件/焦点。它只用于返回，不提供读写授权。
打开详情、查看来源、返回原Task/Case不得发送模型、清空/覆盖新草稿、改变当前事项或选择其它Task。真实外派自动续接由既有授权和后台合同决定，不能靠页面导航副作用触发。
“打开原任务”与“按此Case继续”的原区别保留；后者选择背景不等于立即发送。已在任务授权中明确固定的Case背景，自动续接仍须核对当前资格，不另加逐次确认。

## 5. 同 owner 续接、配置与停止

| 当前源码 | 复用要求与新增缺口 |
| --- | --- |
| `src/host/agent-sessions.ts:5,12,82,85` | Interface v3及同一公共生命周期；不新建Runtime、业务运行Map或恢复JSON资格。 |
| `src/host/server.ts:714,719,720` | project-tasks owner为project/task；配置用原id/revision，权限指纹包括member-pack及服务绑定。 |
| `server.ts:2106` | 原requestFingerprint已有多类输入，但没有外派work/grant/delivery引用；本期须补准确身份及内容hash。 |
| `server.ts:2145,2162`；`src/host/project-history.ts:137` | owner/归档准入、原生started/settled查询和中断只读恢复。accepted未知保留原requestId核对，不自动换ID重跑。 |
| `server.ts:2651,2695,2720,2805` | startProjectMessage复核Task输入、Case关联、目标/方案及verifyBeforeDispatch；新唤醒仍经此原业务入口，不只调用底层SDK。 |
| `server.ts:2771,2777` | providedContext记录实际材料，userQuoteEligible来自origin.userText。外派自动turn需origin.userText=false，并补准确外派receipt，不能冒充人的原话/经营授权。 |
| `server.ts:2217` | completeNewDelivery可能接原审查、IR、Case关联和资产候选；仅消费原Agent真实声明成果，不伪造外部回执触发。 |
| `server.ts:2157,3749` | 受限profile拒绝任务服务绑定，变更绑定前要求空闲并关原资源。外派不得绕过，配置/授权变化保留待核。 |
| `server.ts:3842`；`agent-sessions.ts:503` | stop走原公共域及Task附属资源；cleanupRequestId防旧恢复点击停止新turn。当前无外派暂停/取消实现。 |
| `src/host/ui/App.tsx:610,666,1183` | 浏览不自动执行新Task启动资源；stop只停止生成/清理。新增自动续接暂停须准确显示，不能用“已停止”证明第三方停止。 |

新增待开发合同：先持久预留稳定resume requestId及work/revision/grant/delivery/hash；忙时留在原Task收件；空闲前复核授权、owner/profile、绑定配置、原Case/目标/约定及输入版本。
绑定或输入变化后标待处理，不能静默换模型/材料/Task。结果就绪只交付准确引用，Agent自行核验；后台不得替Agent编排分析、接受成果或决定下一工作。
“停止本轮”本机公共stop后持久暂停该Task外派自动续接；“取消外派”另撤资格、请求远端取消并核对原回执。既有cleanup迟到保护需覆盖新暂停字段，旧cleanup请求不应误暂停新turn。
可恢复后台收件必须新增Host-only只读契约；现有ServiceConnectionsPort要求真实工具上下文，不能伪造sessionId/toolCallId/assertCurrent/cleanup借用。重启不重放UNKNOWN发布/触发/模型请求。

## 6. 保持有效的旧边界

`package.json:21,22`仍为官方Pi1.4.0、MCP SDK1.32.2；本期不升级、不改包、不运行时重写SDK。现有公共profile与能力子集保持。
`server.ts:782`继续限制受管/受限会话的四服务工具；source-reader、fixed-draft、restricted member-pack不因外派放权。
远端资产继续强制身份/工作/领取/企业/allowlist/原资格/准确版本交集；`studio-enterprise-catalog.ts:159`默认及legacy兼容、可选sourceAllowed不可对外当授权。STUDIO_READ_ACTIONS含reason/pack-read，不能整组外露。
ExternalWork的跨turn幂等、未知提交只读核对、单人claim原子裁定、迟到保全、ExternalDeliveryRef独立来源、接受与正式发布分开，均为待实施合同，不因更新main而变成已有能力。

## 7. 对根 spec / UI / 清单 / Issue 的具体建议

| 对齐项 | 应落入的可核对结果 |
| --- | --- |
| MA01 新基线 | 四份准备材料记录7403091及本对齐，旧4132核对保留历史；工程领取再核届时最新main。 |
| MA02 首页范围 | 首页不增加外派待办/收件；原choose/observe、continueWork及ProjectWork等待在外派各状态下不被写改。 |
| MA03 当前工作骨架 | 使用真实四页签；原Task、原项目准确Task行与真实关联Case任务行有最少只读外派摘要；无Case任务仍可独立外派。 |
| MA04 准确回应 | 两Case共享项目、多事项、多个请求/轮次交错时，外派不误消除请求/制造观察，旧回应功能可照常使用。 |
| MA05 返回与草稿 | 从Task/Case打开外派详情、来源、回原Task/事项后，ID/页签/焦点和草稿保留；查看零模型调用。 |
| MA06 成果权威 | 仅ExternalDeliveryRef不出现在原native成果列表；原Agent真实保存后按现有报告/Case关联合同逐步出现。 |
| MA07 续接及配置 | 两份交付、人工聊天交错、忙/重启/accepted未知、配置/目标/约定/Case资格改变均不串owner或重复模型。 |
| MA08 stop增量 | 现有stop/cleanup回归与新增持久暂停分验；旧请求不暂停新turn，外部取消未知不假报停止，不能超时盲重派。 |
| MA09 冻结设计落地 | Demo和spec/清单共同冻结；后续开发先实际渲染查看画面、DOM/CSS及生产组件映射，同视口逐项对照。 |
| MA10 开PR门禁 | 非作者对Demo/spec/清单完整逐项矩阵；开PR前展示真实产品截图并取得对应候选确认，不能用Demo/旧截图/CI代替。 |

MA09/10来自最新工程规范`:211`、`:284`及AGENTS长期事故记忆，约束工程交付，不成为产品日常派单审批。当前只有准备材料和只读结论，不能以本记录宣称真实产品截图、外派闭环或非作者验收通过。

## v0.3 增量核对（2026-11-28）

本轮fetch后origin/main仍为74030911ade7a9e06ad1a0213d1fcb93ecbba6dd，主线接缝未变化。上述v0.2源码定位和能力缺口仍是只读审计结论，不冒充已实现。本版改变准备合同：内部执行不依赖任何外部配置；核心GitHub/通用工作与资产MCP就绪独立于WorkBuddy；WorkBuddy适配未真实联合验证时禁用，其3次触发/串行占用只在选用该适配时适用。实现拆分见E01–E08，三条路径和原来源保全见[变更表](changes-v0.3.md)。

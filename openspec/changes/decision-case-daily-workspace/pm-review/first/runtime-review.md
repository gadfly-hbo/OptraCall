# Issue #149 PM 首审：运行时与验证子审

- 固定候选：`fd0003e6441e75f9e7daae88e09f3a0411227f04`。
- 基线：`699e425cb0900b50385377d638495069fa726761`。
- 审查范围：IN01–IN07、统一会话接入说明、本单 spec/tasks/implementation；真实 Case owner 的新工具、goal-draft 目录端到端路径、取消提交边界、Pi 与非作者证据范围。
- 源码、测试、规格只读。本人输出全部在 `.local/pm-runtime-review/`，未启动 Host/Pi/Provider、未读凭据。图谱工具搜索结果为空，按入口说明回退源码调用链阅读。

结论：当前候选不能通过首审。三项实际行为缺口须返工；真实 Pi 未测与最终独立证据未证另列为交付未完成，不能把它们本身写成运行失败。

## 必须修复

### R1 · P1：原 Case 事项对话没有新增的两项声明工具

位置：`src/host/strategy-discussion-host.ts:91–95`；相关 `src/agent/project-session.ts:529–534`、`src/agent/project-runtime.ts:370`、`src/host/ui/CaseIssuePanel.tsx:107`。

正常 UI 的事项对话使用 `{role:'case',caseId,itemId}`。该 owner 进入 business-role-discussion 的共享 domain；agentOptions 将 `role==='case'` 设为 `tools=false`，因此 `strategyDiscussion` port 为 undefined，也没有 `caseDecisions` port。新 `save_case_issue_edge`、`save_case_decision_request` 只增加在普通项目任务的 `legacy && o.caseDecisionsEnabled` 工具组。该开关又只会为普通项目资格打开，不能凭工具 schema 已存在认定 Case 对话可用。

用户在原事项对话明确说“A 承接到 C”或“请某人对本轮方案作取舍”，实际 Case 模型资源没有工具保存该声明。HTTP 路由和侧栏手工维护不能代替 spec:73、83、139 明确要求的原 owner 对话路径，也增加人工管理步骤。关联验收：DW03、DW08、DW18，T05/T08。

修复和验收：在既有 Case owner/profile 及共享生命周期内接窄工具与可信 Case/事项绑定，不建立平行 Runtime。用真实 Host → business-role Case owner → 官方 Pi1.4.0 → 隔离合成 Provider 的可调用工具断言与实际调用，保存并重开回读关系/请求及准确原声明来源；覆盖另案/别事项、关闭 Case、取消/迟到、配置变化和幂等。单测直接 new 普通 ProjectAgent 不能代替这个入口。

### R2 · P1：首页“整理与查找”没有调用 goal-draft Agent

位置：`src/host/ui/HomeDailyQuickPanel.tsx:87–94`；相关 `src/host/case-directory.ts:42–44`、`src/host/strategy-discussion-host.ts:691–696`、`src/agent/project-session.ts:794–795`。

按钮只持久保存输入后执行 `readCaseDirectory(rawInput.trim().slice(0,80),10)`。后端按整个输入对子串匹配标题/策略/事项；它不是整理或推荐，没有运行既有 `{role:'goal-draft',draftId,scope}`，没有模型提供的来源理由或准确建议回执。goal-draft 的新工具装配在源码上可达，但首页用户路径没有使用它。且 `HomeDailyQuickPanel.tsx:103,164` 直接使用 `issues[0]`，用户没有选择推荐事项。

输入“华东三家门店首周复购波动，想核对是否继续扩围”而现有标题仅“华东扩围”，当前整句子串搜索会给无匹配；按钮无法交付已确认的可选 Agent 语义整理与来源解释。spec:100–104 明确区分文字搜索和获准语义推荐。关联验收：DW10/DW16/DW18，T11。

修复和验收：将用户主动整理绑定可恢复且独立的准备 draftId/goal-draft owner，按既有准确原生来源机制消费目录和建议；保留人工与取消/无配置/失败路径。实际产品按钮应触发一次对应 owner 的请求，合成 Provider 用可见目录返回有理由的准确 case/issue 或无匹配；候选选择和保存前重核来源，不默认首事项。

### R3 · P1：新 Agent 写入排队后取消，仍会在取消后首次提交

位置：`src/host/server.ts:846–858`；实际提交 `src/host/case-issues.ts:375–380,410–417`。全局 mutate 在 `src/host/server.ts:530` 通过 Promise gate 排队。

新分支先检查当前调用，调用通用 `saveIssueEdge`/`saveDecisionRequest` 排入 mutate，然后在 await 返回后再次检查。通用保存函数没有可信运行 context，mutate 回调内也没有 signal/assertCurrent。若前一操作占住 gate，取消发生在排队后、事务前，后来释放 gate 会先落事件，再由 adapter 后置检查报取消。这违背 IN07 和本次迟到写入边界。旧 `saveForAgent` 在 `case-decision-service.ts:248–258` 已在同 mutate 内做 current/agentOwner/assertWritable，新的两条分支绕过了它。

已运行隔离复现：`node .local/pm-runtime-review/cancel-business-repro.mjs`，exit 0。该脚本使用**实际 CaseIssueService + 实际 CaseStore**，人工持有 mutate gate，并复现 adapter 的 pre-check → await save → post-check 顺序；取消后才释放 gate。结果调用 rejected(`cancelled-before-mutate`)，但实际保存了 1 条 issue edge。收据：`cancel-business-receipt.json`。这不是 Pi 全链路测试，也不证明 SDK 行为；它准确证明目前业务提交边界无法阻止取消后首次提交。同代码形态的 request 分支须加入各自永久回归。

修复和验收：给 Agent 保存路径传可信 context，并在同一个 mutate 回调、首次写事务前再次核 current/signal/owner 及写资格；已完成的原 operation 只读查回与新提交区别处理。永久测试持有 gate，先取消后放行，断言两工具均无新 event/receipt；再测试提交已完成后取消保留原事务、同操作回读，及配置失效/旧调用迟到。最后在真实官方 Pi 合成链路复测。

## 必须补齐的交付证据（不是未测即失败）

1. `tests/workspace-daily-http-pi.test.ts:11–110,120–168` 是真实 Host HTTP/Store；`:113–118` 只是 description/schema 字符串断言，没有构造 Pi session 或合成 Provider。既有 `tests/case-decision-runtime.test.ts` 测的是原 read/save 草案能力，不证明本次两新工具和 Case owner 可用。`implementation.md:45` 如实写明真实 Pi 三工具回环未跑。须按 spec:148 补本次实际 owner 的正常、取消、配置变化、迟到、隔离、保存/重开证据，不能依赖命名中包含 pi。
2. 已公开 `verification/independent-check-receipt.json:2` 明确仅包/原型、DOM 替身；`verification/dispatch-review.md:5,9–15,40–42` 审的是发单确认包和原型，未改源码时的检查。不能用于本次 53 文件完整实现的非作者验收。
3. `implementation.md:32–40` 叙述实施时子代理发现及修正，但没有可访问的最终完整候选身份、独立报告/命令结果或修后固定候选覆盖范围。因此最终独立复核状态为 **NOT_PROVED**；不否认其曾做复核，只不能核验它是否覆盖最终候选。需在返工后冻结完整候选，提供非作者对完整差异及修后结果的可访问报告，并按工程规范做四原则终检。
4. `tasks.md:33–35` T13–T15 已勾完成，与 implementation:44–47 自述的全量/真实Pi/UI边界不相符。返工时如实恢复未完成状态，按实际证据逐项更新。

## 已确认边界与有限结论

- 锁定声明仍是 Pi1.4.0、Interfacev3；此累计差异未修改 package.json、锁文件、公共 agent-sessions 或边界检查脚本。新能力沿已有 port/IPC/action 分发，未发现本单引入 SDK 构造、并行 lifecycle 台账或第二套模型循环。此为源码/依赖差异结论，不证明官方安装逐字节完整或运行采用。
- 新 case-directory 通过 Host 注入读取全局 Case 元信息。原 `case-sources-service.ts` 亦明确普通有效项目可读全局 Case，故没有仅因该 API 缺 scope 参数就认定跨企业泄漏的证据。不能报告已复现越权。
- 目录 action 尚未接进原 `sourceAccesses` 的准确来源/续发复核，返回目录也没有 revision/hash；按 DW05/10/16 补准确来源、读取后变化/撤权、配置变化及历史续发的实际测试。当前列为覆盖不足，不能单凭未测判定某个权限反例必然发生。
- 本人没有运行完整检查、实际 Pi、产品浏览器或付费真实模型；不把作者报告当本人重跑。本次只读证据支持上述三项首审返工，其他模块以 PM 并行审查汇总为准。

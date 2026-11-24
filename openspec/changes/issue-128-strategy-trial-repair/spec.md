# Issue #128 战略选择试用修正规格

2026-11-24 · Qoder/Mac-mini · `Refs #128`

## 1. 目标、基线与交付

整体修复 Issue #128 的五项已确认问题，并交付独立任务分支、永久回归、隔离合成主链与浏览器证据、结果记录和实现回执。Codex PM 负责后续独立复核、集成、PR／CI、合并与结案；本规格不把作者自检写成独立复核或用户产品验收。

- 领取基线：`7ef6ebb81b735ffecdad3753217a96f02cb95c76`。
- Issue 原复核基线：`2f79a34df60ac0bf42eb5b5655d203a99f32e09a`，作为历史依据保留。
- 工作树：`/Users/bendandebaba/.qoder-cn/worktrees/issue-128-strategy-trial-repair`。
- 分支：`work/qoder/issue-128-strategy-trial-repair`。
- 上游合同：`openspec/changes/strategy-selection-refactor/spec.md` 及其已确认 Demo；本单只做既有四页签内的最小修正，不新增 UI Demo。
- 工程规范 v1.14、统一 Agent Session Interface v3、官方 `@earendil-works/pi-coding-agent` 1.4.0。

## 2. 任务目标执行清单

| 阶段 | 完成条件 | 状态／证据 |
| --- | --- | --- |
| 领取与环境 | 回读有效领取，从精确基线建独立工作树；Node 25、锁文件依赖及 Pi 1.4.0 核实 | 已完成，见 result.md 环境记录 |
| I128-01 开题 | 省略来源与 `[]` 规范化及幂等一致；错误有稳定 code、安全 path/reason；正常 Pi 工具链可修正；失败零写入 | RED／GREEN、真实 Pi 链及完整 check 完成 |
| I128-02 候选 | owner-bound 准确正文和保存回执可读；同号同内容幂等、异内容冲突；冲突→核对→有限纠正→保存→锁定及恢复／越界通过 | RED／GREEN、恢复／权限回归及完整 check 完成 |
| I128-03 承接 | 当前战略 scope 始终出现并默认准确；稳定去重、同名可辨、保存前核对；目录／批量／重试／并发／来源回归通过 | UI RED／GREEN、Host 合同、浏览器及完整 check 完成 |
| I128-04 状态 | 发送、运行、成功、失败、取消、断连／未知、重开恢复分别准确；pending 防重及显式恢复保持 | 浏览器 RED／GREEN、状态／恢复回归及完整 check 完成 |
| I128-05 来源 | 开题／候选／文件／已有可解析公开来源按准确版本和指纹只读回看；失败保留身份原因；键盘和窄屏可用 | UI RED／GREEN、来源回归、联合浏览器及完整 check 完成 |
| 联合验证 | 隔离合成主链、门禁、异常、权限、兼容、桌面／窄屏及完整 `npm run check` 通过或如实保留失败 | 26 项浏览器 PASS；完整 check 3161 通过／0 失败／111 条件跳过；提交后同 HEAD 复跑待回执 |
| 专项与移交 | 四原则、IN01–IN07 自检完成；固定同一候选推送并回读 SHA；Issue 回执后停止写入 | 作者专项完成；提交、推送和回执待执行 |

新发现的问题按 Issue 五项验收判断归属；只修本次回归和直接阻塞，范围外问题在 result.md 留痕，不顺手扩大。

## 3. 行为合同

### I128-01 开题保存

`StrategyInitiativeReports.save` 在哈希和幂等比较前仅将 `undefined` 来源规范化为 `[]`；`null`、错误类型和非法来源拒绝。字段、命题和来源错误沿现有 `StrategyDiscussionFault.details.issues` 提供稳定 code、白名单 `path/reason`，复用 Runtime 安全错误投影，不扩大敏感详情。所有校验先于写入。

### I128-02 候选核对与恢复

候选工具只读能力由 Host owner 闭包绑定准确 candidateId/no。`initiative-read-candidate` 返回本版本身份、正文、开题锚点、父版、指纹和本候选保存回执；`operation` 只查询本候选保存操作。其他候选、版本、范围和主会话操作不开放。

候选版本增加向后兼容的可选保存回执集合，保留 `lastSave` 与旧记录回退，不新建操作库、不迁移旧记录。同 operationId／同内容返回最初回执且不改当前正文；同号异内容冲突零写入；明确的新保存意图才使用新操作身份。Host 不代 Agent 改稿或自动换号。既有限定修订仍另存父版并使用独立会话。

### I128-03 承接范围

`HandoffDialog` 合并当前战略 scope 与目录 scopes，以 `initiativeScopeKey` 去重，默认当前 scope。选项和保存前核对显示层级、名称、稳定 ID、可解析上级归属与当前范围标识，同名异归属可辨。Host 范围授权、操作指纹、批量、预留、恢复和并发机制不变。历史误归属只说明通过现有修订入口另存，不改真实试用记录。

### I128-04 主会话状态

复用统一 domain 的 busy/live、业务 pendingInput/lastRun/replacedRequests、snapshot 和本地发送状态。pending 继续防重复派发，但不再单独等同未知。accepted+busy/live 显示运行；accepted 且无存活资源显示核对／显式恢复；断连只读核对，不自动重发。只有匹配原 requestId 的显式替换可派发新请求。

### I128-05 检验依据

检验来源控件按 kind/ref 精确解析。kickoff 使用 reportNo，candidate 使用 candidateId:no，file 使用 fileId/scope，均先核对 expected sha 再复用现有只读预览；不得用当前版替代旧版。缺失、错指纹、不可读和越界保留引用身份、期望指纹及安全原因。

公开来源只有已有记录能证明准确快照时才展示正文；普通 URL 无快照时展示引用及“准确快照未留存／不可核对”，不隐式联网。本单不新增网页快照库；若要求所有公开 URL 回看正文，须另交 PM 决定持久合同和 UI。

## 4. 允许修改路径与复用边界

允许修改 Issue 指定战略 Host／Agent 工具、对应 UI、直接相关测试和本变更记录，主要包括：

- `src/host/strategy-initiative-reports.ts`
- `src/host/strategy-candidate-host.ts`
- `src/host/strategy-initiative-types.ts`
- `src/host/strategy-initiative-host.ts`
- `src/agent/strategy-discussion.ts`
- `src/host/ui/StrategyInitiativeGovernance.tsx`
- `src/host/ui/StrategyInitiativeWorkbench.tsx`
- `src/host/ui/strategy-initiative-client.ts`
- `src/host/ui/strategy-initiative-view.tsx`
- `src/host/ui/strategy-initiative.css`
- `tests/strategy-*` 直接相关套件、本单浏览器脚本和本变更目录。

复用 `StrategyDiscussionFault`、`safeToolFault`、`createAgentSessionDomain`、owner-bound Ref、`initiativeScopeKey`、`useOperationId`、现有版本弹窗、`readInitiativeFile` 和 Host／合成 Provider fixtures。不得新建 Runtime、会话队列、全局操作账或平行来源库，不改官方 SDK、不升级依赖。

## 5. 会话接入记录（IN01–IN07）

| 项 | 本单安排 |
| --- | --- |
| IN01 | 已读取工程规范 v1.14 与接入说明；本规格记录 Interface v3、owner/profile、路径和验收。 |
| IN02 | 主会话 owner 为 `InitiativeMainSession`、profile `strategy-initiative`；候选 owner 为 `CandidateVersion`、profile `strategy-candidate`。候选工具只接受 Host 闭包内 owner，不从输入伪造资格。 |
| IN03 | 启停、占用、取消、关闭、订阅、busy/live 继续由既有 domain 管理；不直接创建 SDK 会话或新增代际 Map。 |
| IN04 | 开题／候选校验、保存回执、状态和来源投影留在战略业务适配器；公共会话层不加入战略分支。 |
| IN05 | Host 核对 scope、文件、版本和指纹；错误详情走既有白名单；仅隔离合成资料，不读真实业务数据、原始会话或凭据。 |
| IN06 | Issue 明确授权 Qoder 实施本单 Host／Agent 接缝；DTO 和持久字段只做向后兼容增量。Codex PM 后续接回主链路集成与维护，独立复核、CI 和结案不由作者代替。 |
| IN07 | 覆盖正常、取消、配置变化、迟到结果、保存／重开和旧记录回退；运行 `check:agent-sessions`、完整 `npm run check` 和真实 Pi 合成链。 |

## 6. 四原则前置检查

- **Host 管环境**：Host 负责校验、权限、回执、状态投影和准确来源读取，不代作战略判断或补写方案。
- **Agent 自主执行**：Agent 根据安全定位自行修正开题；冲突后自行读回并决定是否明确另存，Host 不自动换号。
- **优先复用 Pi**：沿用官方 1.4.0、Interface v3、native 历史、run accepted/completion 和 busy/live，无新增运行循环。
- **减少人的操作**：无来源无需手工补 `[]`；候选可自查；当前 scope 默认准确；正常运行无需核对；依据可一键回看。保留的新人工动作仅限明确新保存意图、显式恢复和既有治理确认。

## 7. 验证、兼容与回退

每项先保留真实 RED／因果复现，再最小 GREEN。定向测试后，以隔离合成 Host、官方 Pi、合成 Provider 和产品浏览器走通：开题→候选→修改／恢复→锁定→串行双检验→审核发布→目标候选承接→版本回看。覆盖第一道不通过停链、唯一当前发布、替代／撤销禁重发、准确来源、失败／取消／配置变化／迟到结果／保存重开、权限负例、冲突幂等、零写入、键盘和窄屏。

最终在同一 HEAD 使用 Node 25 执行完整 `npm run check` 与浏览器脚本。命令、退出码、失败、跳过、NOT_RUN、UNKNOWN 和环境分别记录。原始日志、截图和合成根位于 `.local/issue-128/`，公开记录只放脱敏摘要。

旧候选没有保存回执集合时以 `lastSave` 只读回退；不批量改写。回退代码须能读取新增可选字段，不能用旧快照覆盖新增记录。公开 URL 不联网补快照。真实 Provider、正式数据迁移、设备采用和用户产品验收均不在本单执行范围。

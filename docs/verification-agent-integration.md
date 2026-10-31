# 独立核算接入与使用说明

适用[已确认 SV01–SV12](business-semantics-and-independent-verification-phase1-proposal.md)。强制工程规则仍以[工程规范 IN01–IN07](engineering-workflow.md)为唯一来源，Interface v1不变；本说明解释业务差异和运行限制，不构成另一套会话协议。

本期按用户确认的[修订出稿方案](verification-revision-preservation-followup.md)使用附属无执行工具资源：Host提供固定全文，Agent返回新稿，Host另存；原任务native不追加。历史全工具修订发生过合成原件破坏，旧FAIL保留。当前工程、有限真实模型、CI与运行采用的实际状态见[本期记录](../openspec/changes/business-semantics-verification/result.md)，操作入口或completed均不证明专业正确。

## 用户操作

1. 在原项目任务空闲时展开“核算关键结论”，点击发起核算。
2. 选择本次核算问题、`020_clean` 源数据和 `020_clean`／`060_reports` 作者产物。相同文件不能同时作为源数据和作者产物。
3. 可附带已选择的RAP、用户确认属于事前信息的Case背景，以及当前项目启用的SAP。当前SAP是本次选择，不自动表示作者历史使用了它；未选内容不冒称已传入。
4. “查看本次语义依据”只预览具体内容和来源，不创建核算或调用模型；开始时服务端重新稳定读取并固定副本。
5. 用户点击开始后，另一个会话先自主核算，首次依据保存后才看到固定作者产物进行比较。若需要回应原生扩展问题，在核算面板内回应；停止只取消本次核算。
6. 查看首次依据、对照差异和无法确认项。点击“依据核算意见生成新稿”，将完整固定文本交给附属出稿会话；该资源没有文件、代码、命令或扩展执行工具，Host把最终回复另存到`060_reports`，不修改原稿或原任务历史。材料须为UTF-8全文且不超过20,000个JavaScript UTF-16字符，超限或不能解码会在调用前拒绝，不截断、不退回全工具。需要额外计算时保留未知；明确新增资料/计算后应重新核算。随后可显式发起一次知情复查，不是新冷读。
7. 导出只新增普通报告到`060_reports`，重复导出复用同一版本；关联Case或采用仍走既有显式入口。核算完成不等于用户采用、业务已执行或效果已验证。

断线时只读重新观察，不自动重发。提交结果不明保留原编号；明确新建或重试才使用新编号。数据、语义或修订报告变化后，旧记录仍是旧依据，不能表示当前文件已核算。归档项目仅可查看，恢复后才可新操作。

## Module 与 Interface

- `verification-host.ts`负责真实项目归属、选定语义及文件的稳定观察、附属出稿profile和报告保存；RAP/SAP/Case继续是各自权威。
- `verification-sessions.ts`是Host业务适配器，静态注册核算profile并复用公共domain；不创建SDK或另一套opening／busy／代际管理。
- `verification-store.ts`保存一次核算的业务身份、固定输入、阶段产物与来源；运行资源由公共会话实现权威管理。记录格式1，不改变项目schema或SQLite。
- 核算owner属于真实项目和任务。`SessionProfile.projectId`参加项目／Provider／退出关闭，业务只使用Host生成的Ref。普通任务的sessionFile／draft／lastRun不会被核算或新修订替换；显式修订关联原任务，但使用附属固定材料出稿资源和独立native，原作者历史不追加。旧无mode修订记录仅按旧事实展示，不恢复其全工具运行策略。
- 配置在operation开始捕获，冷读与对照共用lease；停止／配置清理使后续派发失效。重启只把未证实完成记录标中断／未知，不重放。

修订profile为Host静态注册的`verification-author-draft`，固定`capabilityPolicy:'fixed-draft'`。SDK创建时使用空工具允许清单并排除全部执行工具，不加载磁盘扩展、MCP、skills、prompt templates或上下文文件，仅保留可信的保存前脱敏扩展；原生命令不可调用。业务Ref不暴露SDK管理对象。修订使用记录内`revision-workspace`、`revision-native`和`revision-resources`；`authorRevision.mode/configuration/sessionFile`只表达本次非敏感执行证据，旧无mode记录仍可读，不恢复旧全工具策略。模型关闭按各阶段实际捕获Provider分别处理；同任务普通消息和命令在改运行状态前拒绝修订期间的并发，不影响其他任务。

HTTP接缝是任务下的`verifications`列表／新建、按编号读回，以及显式`stop`、`author-revision`、`recheck`、`export`和`ui-response`；`verifications/preview`仅解析选择并预览。GET不打开资源、不调用模型。UI意图UUID不授予资源权限；Host核对归属和载荷，重复提交只回读，异载荷冲突。

## 来源和独立性的含义

`SessionTurn.providedContext`只允许Host提供RAP身份／实际摘要及Case操作回执引用；worker补充实际初始化SAP索引和请求摘要，写入既有`optracall.run` started记录。它证明交付，不证明读取、理解或业务确认；旧JSONL没有时保持未知。存活资源不会因SAP新发布自动切换，一期使用新版本通过用户显式新建任务。

核算输入和作者产物先固定；模型工作区初始不含作者文件、完整历史或内部来源路径。Case只使用用户明确确认的事前description，排除当前判断、nextStep及后验经验。固定数据、语义和后续揭示的作者／修订副本在阶段完成前核对；原生指针须属于本次核算目录和工作区，损坏指针不交给SDK打开。

普通分析、初次核算和知情复查仍为全工具加软约束；附属修订资源采用上述空执行工具策略。独立cwd／会话均不代表OS安全沙箱。`observed`只表示捕获范围内没有发现直接提前读取目标；`informed`表示已知接触作者信息；`unknown`表示证据不足。共享skill／MCP仍可能影响核算双方；记录实际可取得的来源，不以不同模型名称担保独立。

专业方法由Agent和已有工具／资产提供，不设固定计算或核验方法表。Host只检验技术身份、路径、字节、操作资格和持久化，不按公式替Agent补算，不自动裁决因果或升级企业语义。

## 验证与回退

保存与路径、取消、配置、重启、并发去重／导出、原生owner和RAP/SAP/Case真实接线用隔离合成Provider验证；真实模型收益按SV10有限对照另记。工程非作者复核与产品核算互不替代。

真实模型比较先核对实际原生模型参数，不能只核对model ID。中继、自定义Provider或凭据替身引起的思考、上下文、输出限制和兼容参数差异须单列；不与原配置的正式结果合并。评估用凭据替身保持原校验与owner/版本，不变成产品或插件的新接入方式。

旧项目／任务／JSONL／父链、RAP/SAP0.2和Case数据库原位读写，新记录只追加。旧代码可能不显示核算记录；回退保留新增目录和资料，不覆盖旧备份。运行服务采用与Git合并分别授权。结果、失败和未验证项见[本期记录](../openspec/changes/business-semantics-verification/result.md)。

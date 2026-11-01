# 托管执行资源优化 Spec

日期：2026-11-01。状态：用户已通过方案／spec 及 D1–D8 全 A，授权本地实施、检查、性能对照复测与非作者独立复核。关联：[方案](proposal.md)、[已确认内部合同](structure-decisions.md)、[验证计划](validation-plan.md)。不做 Git/CI 交付或切换运行服务。

## 基线与接入合同

- 工程基线：`codex/decision-feedback-loop`，HEAD `b36a42b43e86a279b1931770022c50b306ceeb36` 加候选 5 的 252 项源码／永久测试 WIP；候选清单 SHA-256 `c6456e71fcd9701bc4b62bd71c7eebdcf4093ff177bbbae6fd906e10f5277312`。不将 HEAD 单独当成完整实现。
- 现状证据：[18 次资源评估](../automatic-verification-revision/resource-overhead-evaluation.md)；旧运行、预跑、失败及限制原位保留。
- 公共 Interface **v3**；继续使用原 `createAgentSessionDomain`／`ProjectAgent`／SDK 接线。业务 v1/v2 消费者兼容，不新建 Runtime、全局资源注册表或分析队列。
- owner：原项目 `projectId+taskId` 及既有自动链派生 owner；profile：原 ordinary 托管、independent-verification、verification-author-draft 的既有策略。具体键不改名、不合并，作者与核算上下文独立。
- 验收范围：自动核算启用任务的执行资源实现、权限、并行及生命周期兼容；不包含专业正确率、模型优化、CI／合并、安装、运行采用或 MacBook。
- 实现接缝：`src/agent/protected-tools.ts`、新增 native-only 文件 worker／入口、既有 guardian、对应长期回归；既有 `SessionCleanupRequest.retryFailed` 资格沿公共 Resource→SDK driver→受管组向下透传，不增加另一清理授权来源。只扩精确 SDK 工具 helper 的边界检查例外，不授予模型／会话构造能力。
- 实施兼容记录：完整检查暴露的 shell 输出与 private SDK 关闭 ACK 问题沿原公开工具合同修正；具体匿名 stdout FD 的环境差异、证据及保全边界见[实施说明](implementation-notes.md)，不得隐去为“完全等价”或用其替代性能实测。

## MO01：准入及 scope 隔离

仅现有准入允许的托管 execution scope 可使用本优化。scope 身份与其 owner、Resource 代际、profile、目录、工具、解释器／环境及保护策略冻结。配置或权限变化走既有关闭／重新准入，不能原地改 worker 权限。

禁止跨 scope、作者／核算、不同任务或 Host 重启复用；未托管旧任务、未知 fork 不自动获得资格。关闭自动核算的普通分析不得接入新文件执行器或新增收尾流程。

## MO02：文件工具按需复用

每个 scope 最多一个共享 native 文件执行组及其 guardian，允许的工具严格是原 SDK `read/write/edit/ls`，不开放任意 JS、bash、扩展、MCP 或会话 API。保留 read 图片功能。

白名单由 worker 代码自身固定，不仅依赖 envelope 的 toolNames；共享入口不创建 codemode、`context.executeTool` 或动态 module/source 入口，不接受调用消息指定新 env/workspace/session 或改变 scope 权限。

首次实际文件调用才创建；并发首次调用合并初始化，`ready` 握手成功前不执行。握手失败不执行工具；实际执行是否发生无法证实时保留 UNKNOWN，不创建第二组、重启后自动重放或退回非托管。

工具工厂／模块在该文件执行器初始化时建立一次，调用级参数、signal、回调及结果独立。工具名、schema、描述、结果、错误、输出截断沿原 SDK，不自写简化 read 或 Host 文件内容缓存。Agent 的两次读取应看到当时实际文件内容。

## MO03：隔离工具路径保留

bash、codemode、grep、find 以及 codemode 内嵌工具继续使用原一次性独立执行器。保留原 SDK 及 BashOperations 的工具合同、后台跨调用、任意 JS 隔离和受限执行组。

本期不增加执行 broker，不将 bash/codemode 送入共享文件组，不优化其单次 SDK 启动，不改 codemode store。工具可用性和 Agent 工具选择权不变。

## MO04：多路协议与真实并行

共享文件通道在执行前完成内部协议版本握手。每条调用／进展／结果绑定不可猜测的通道身份、scope／执行代际与 toolCallId；只接受原可信驱动已受理的调用。分片、多行、交错和迟到消息不得串结果。

同 ID 再发不得重复执行；重复或取消后的结果不得覆盖另一调用或复活调用。身份不匹配、未知结果及不可解释的协议异常不得授予执行或关闭权限；无法证明执行／资源状态时进入既有错误／UNKNOWN 路径。

同 scope 可有多项异步文件调用及多个隔离计算组同时运行。不得添加“一次只允许一个工具”的 Host 队列或按次数／时长／并行量中止分析。SDK 自带同文件 mutation queue 保留，不自建跨文件全局串行队列。

worker 通道只传工具参数、进展、结果及无权威的协议回应；只有可信驱动能走 guardian 控制通道。worker 自报 ready／idle／result 均不是关闭证明，不能控制 profile、owner、目录权限或 native 写入。

## MO05：单调用取消与 scope stop

每个文件调用使用独立 AbortController；取消沿原 SDK signal 执行，不能杀共享文件组或另一个调用／后台组，不伪造写入回滚。取消后的异步尾部仍受本 scope 管理，不能因外层 Promise reject 就声明资源空闲。

隔离工具的单次取消仍只清理自身组。公共 owner/lease 的显式 stop 则封闭整个 scope 并沿原 guardian 身份收回全部组。stop 于 initialization、ready、执行、后台、自然收集或 drain 时都不能漏收晚到资源，不能误停其他 owner。

单调用取消返回与实际资源收尾分别记录；scope 关闭／后续自动链交接必须通过 MO08 的完整证明，收尾不明保持原 busy／UNKNOWN。自动 finally 不能借普通 close 获得失败清理重试资格。

## MO06：独立组自然结束收集

隔离组的工具结果与后台工作生命周期分离。正常完成后，guardian 可在持有 leader 身份期间无信号观察；只有组内仅剩已退出且未 reap 的 leader、复核成立后，才允许 waitpid，并核最终组不存在。

持有未 reap leader 是防 PID/PGID 重用的条件，不能提前释放后再发信号。waitpid 后只允许查询不存在；不能对原数字 PGID 再发信号。后台仍活着、只有进展／结果、零 pending、一次空快照或等待超时都不构成自然收集条件。

自然收集成功可以释放本组 guardian、进程引用及监听器，不等待整个 scope；必须等 guardian 自身实际退出。自然收集不暂停后续 Agent 工具。轻量观察不得每次扫描全机进程；延续已持有组的精确观察范围。

不能借用当前先 killpg 的 `clear_group()` 实现自然收集；其路径须从观察真实自然退出开始，全程不发终止信号。Host 须收到可信 guardian ACK 且确认 guardian 实际退出，才能移除活动组记录。

## MO07：一次退休与失败保留

同一组的自然收集、scope drain／close、stop 竞争共用一个退休状态及结果；它是原 Resource 下的内部对象，不是第二份公共 busy 权威。

观察中尚有活工作不是清理失败，可继续正常观察；一旦退休步骤失败或证明未知，保留失败并停止自动推进该失败收尾。重复回调、下一工具、finally、timer 和父子 close 均不能暗中重试。

显式清理重试只能来自既有公共 `retryFailed` 资格；不重放工具、模型、意见交回或稿件生成。guard 身份已丢失时不得凭旧数字 PGID 追杀进程。

资源关闭成功与工具／业务结果可确认是不同事实。即使已经自然收净，缺失或不可归属的工具结果仍保留 UNKNOWN；不能用关闭 ACK 补造工具成功、自动续入下一业务阶段或重放调用。

## MO08：drain、close 与持久回执

正常 drain 先封新派发，处理已受理调用，再解除文件通道自身保活，让文件执行器自然退出。不得 `process.exit()`、强制 terminate 整组、设置分析等待时限或以零工具 Promise 当作退出。

正常 release 与意外 disconnect／stop 的协议必须分开：当前 worker 的 channel end 会触发 shutdown/abort，不能原样用于正常 release。意外通道丢失按原故障／停止规则处理，不能自证自然收尾。

read/ls 的外层 Promise 可能提前取消，read 图片可能有线程；不能把工具 settle 计数或 `idle` 回应当作这些工作完成。任何仍运行的异步尾部留在本 scope，必须等整个进程实际自然退出；用户仍可显式 stop。

所有共享／隔离组均完成持有身份→确认不可再执行→waitpid→最终不存在的证明，并确认 guardian／通道释放，才向原公共 Resource 返回关闭成功。已有自然收集成功的组可复用其真实关闭证明，不重复清理。

可信 SDK 仍独占写入原 `optracall.execution` v1 opened/closed。opened 覆盖执行前；closed 覆盖整个 scope 的所有内部组，不能提前、按子组多写、缺证补写或由 worker 伪造。证明失败按原 retirement 规则继续 busy／UNKNOWN，不进入下一自动核算／修订／复查阶段。

## MO09：保护与材料不降级

完整保留已确认权限：原件／旧稿只读、native 与凭据禁读禁写、不可变代码、受限 FD、环境去密钥、禁止脱组与外部间接执行、受管解释器策略、既有扩展／MCP 边界。首次创建及每次派发仍遵循原保护检查。

上述权限沿原 profile 适用范围，不将核算／返修权限复制到 ordinary：普通托管原 020/060 写入能力和 010 软提示保留。优化不能增加原件禁读或新的分析限制。

`plainTree` 不降为 scope 一次检查、不缓存“目录安全”结论；若将来更改须另行规格与竞争／攻击验证。不能通过复制经营数据、隐藏输出差异、截短材料或减少工作量换性能。

## MO10：运行对象释放与去重

调用结束释放不再使用的结果 buffer、进展闭包、listener、timer 和 pending 对象；保留仍可能执行的尾部、未结束组及失败退休记录。已成功关闭的独立组不留整套活动对象到 scope 末尾。

原去重所需 toolCallId 不能过早删除，轻量去重项与确实仍需的记录允许随调用增长，必须在资源报告中单列。目标是消除与“已完成调用数”成比例的进程／SDK／大结果留存；不承诺 native 历史、产物或所有堆字节不增长。不截断 codemode store 或删除历史证据。

## MO11：性能与无退化验收

正确性和 MO01–MO10 全部通过后，才比较性能。复用[原固定负载](../automatic-verification-revision/resource-overhead-evaluation.md)，使用未来同批的 off／原托管候选 5／新托管三个条件，记录每次原始数据和失败，不挑样本。

以下实验门槛随本 spec 获得用户确认；它们不构成生产 SLA，也不是 Agent 的执行限制，尚未实测：

| 指标 | 建议验收门槛 |
| --- | --- |
| 60 次混合工具的往返段，不含共同 30 秒等待 | 新托管相对同批原托管中位数下降 ≥70% |
| 频繁场景累计 CPU 增量 | 以各自配对 off 为参照，新托管增量比原托管增量下降 ≥60% |
| 无后台的序列调用后资源 | 不再每次多留一个 guardian＋一个 Z leader；自然收集完成后只剩本 scope 常驻文件执行组及公共 SDK 必要资源 |
| 60／300／1000 次文件调用 | 无按次数增长的 guardian／leader／SDK 数量；小型去重项、SDK堆及真实业务文件增长分列 |
| 长任务及 4 路后台 | 工作量、摘要、跨调用后台和实际并行一致；不得引入串行化。若主请求相对同批原托管中位数稳定退化 >5%，查明并复评，不以频繁场景改善抵销 |

bash/codemode/grep/find 启动延迟单列，不能宣称全部工具均消除启动成本。若目标未达保留结果并定位，不自动扩大到 shell broker、目录缓存、减少工具／并行或静默重试。CPU、RSS、footprint、活进程、Z 和整机影响分别报告，不能混算。

## MO12：兼容、保全及发布范围

项目、会话、父链、文件、报告、旧 FAIL／UNKNOWN 及当前 WIP 保留，不批量改写旧 native，不增加持久表／存储迁移／重启恢复资格。codemode store 不迁移、不改为共享内存服务；文件执行器不加载它。其既有并发限制继续单列，不宣称本期修复。

旧业务 v1/v2、普通关闭自动路径、公共 owner/profile、stop／close／原生交互和原自动链版本归属分别回归。兼容回退只用于无活资源的新执行，不能热接管或自动重跑未知执行。

无需 UI 变化，不新增设置、占位入口或用户步骤。本期实现完成后须完整相关检查和非作者独立复核；用户已授权本地开发与性能复测，CI／合并、安装及切换运行服务仍未授权。

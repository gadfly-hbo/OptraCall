# R1：记忆候选合法嵌套与原生保存

2026-11-15 · 用户已确认最小方案并授权本地实施、隔离合成验证与全新非作者复核。用户明确直接使用现有 `OC｜memory-dao` 分支；不再另建分支。

## 目标与范围

普通项目任务中的 Agent 可以自主直接或通过 Pi 合法多层组合调用 `record_agent_candidate`，新候选统一保存到同一 native 会话中的一个权威 custom entry。工具仅返回准确引用和状态；旧 `toolResult.details` 候选继续只读兼容，原件、人工经验和治理账不迁移、不回写。

本次增量替代 [M3.1](../fourbase-autonomous-candidates/spec.md) 的新候选 toolResult 正文保存与直接调用限制，保留其历史事实、FAIL／UNKNOWN／NOT_PROVED。沿 [M4](../fourbase-context-reuse/spec.md) 的合法组合和 [M6](../fourbase-experience-learning/spec.md) 的独立治理。R2 检索去重与 R3 经验来源治理提醒暂不实施。

## 契约与四原则

- 采用当前工程规范 IN01–IN07、Interface v3 业务子集，owner/profile 仍为真实 projectId/taskId 的 project-tasks，工具仅普通 unmanaged 任务可用；受管、封闭、冷读、插件及 command 不扩大权限。
- Pi 固定官方 `@earendil-works/pi-coding-agent` **1.4.0**。只使用公开 `appendCustomEntry`、工具定义／上下文及原生会话能力，不修改 SDK 包、安装产物、内部对象或原型，不新建 Runtime、会话树、后台模型、事务或重试引擎。
- Host 提供归属、权限、取消、保存及真实状态；Agent 决定是否记录、记录内容、数量和工具组合，允许零候选。正常使用新增必做操作为零。本次无布局、导航或关键人工交互变化，UI Demo 不适用。
- 新 customType 为 `optracall.agent-candidate`，data 为 `{ recordVersion: 1, details: AgentCandidateDetails }`；details 的 schemaVersion 1/2 仍表示原来源合同，不代表存储格式。工具回执 type 为 `optracall.agent-candidate-receipt`，包含准确 candidate 引用与已核定状态，不含候选正文。
- 独立复核 P2 修正：正文通过实际文件同步／准确回读后，复用同一 receipt 在原 native 追加一条不含正文的确认 custom（customType 同 receipt type），再核其实际保存。它只声明此前已成功核定正文，不以自身 append 返回自证耐久。新正文缺准确确认时保持 `candidate_save_unconfirmed` UNKNOWN；确认须原始 session、正文之后、同 branch／同 started marker、准确 ref/hash，不能用直接 toolResult、fork 的后补确认或别的 run 顶替。唯一候选正文与旧治理账不变，不增加事务、重试或新正文库。
- 沿用 ExactCandidateRef 六字段及原 details hash，新 entryId 指向 custom entry。旧 toolResult 保留原直接调用校验；新记录绑定真实当前调用、owner/run/session/manager/SDK signal 和调用存续期，不依赖完整 nestedCalls，不解析 ID 或信任模型参数猜父调用。
- 候选能力本身即触发必要的 call-local 适配，不依赖 M4 等其他功能开关。适配只包装 OptraCall 自有工具对象，保留 SDK 原委托与合法多层／并行。
- 独立复核 P1 修正：父工具已派发但未等待、子调用滞留 SDK 异步 hook 时，子执行前仍须核父调用存续期。用 Node 公开 AsyncLocalStorage 只传递既有 available 闭包，在子工具执行前核整条有效资格；不读取／解析 SDK ID、不引入运行账或平行会话树。
- append 返回 ID 或内存树可见不是耐久证明。写入前核资格，使用实际 native 文件同步与精确回读核定；保存失败或不明保留 FAIL／UNKNOWN，不补写、不自动重试。取消前已保存记录保留，父任务终态与候选状态分开。
- fork 副本沿准确 occurrence 去重，不按内容合并独立调用。压缩后的读取沿安全 native 快照，不依赖模型当前消息或摘要。历史 GET 不 open／迁移／修复原件。

## 验收

| 标识 | 完成判据 |
| --- | --- |
| R1-01 SDK 隔离门 | 在撤禁令前，真实 Pi1.4.0＋回环合成 Provider 证明公开 custom append 的直接／nested 保存、安全文件回读与重开；保留原失败，不以 fixture 错误作产品 RED。 |
| R1-02 合法组合 | 真实产品工具直接、codemode、多层、多条、并行、长参数和不完整 nested 元信息准确保存与读取；新正文只有一个权威记录，最小回执不生成重复候选。 |
| R1-03 资格 | 取消、迟到、旧 parent、跨 run/session、替换 signal、错误 owner 及 command 不得写入新有效候选；候选单独可用且其他业务读口关闭时同样成立。 |
| R1-04 保存与原生 | 实际文件同步／回读、关闭重开、真实 fork 与 compaction 保留准确记录；故障或结果不明不假报成功、不自动追加第二次；已保存后父 cancelled/failed/unknown 不撤销候选。 |
| R1-05 历史与治理 | 旧 v1/v2、新 custom、准确引用、收藏／纠正／排除／恢复、fork 去重、独立调用不合并、M4/M6 消费、预算／续页及原件只读保全均成立。 |
| R1-06 收尾 | 完整适用本地 check、真实隔离 Host/SDK 路径和全新上下文非作者只读复核完成，发现已处理；四原则专项逐项结论，未跑／失败／未知分别保留。 |

## 允许修改与执行清单

允许修改 `src/agent/project-session.ts`、`src/agent/agent-candidate.ts`、必要时现 tool-context-adapter、安全快照辅助及候选 reader；复用现 controls/M4/M6 合同，不无关重构。新增／调整相关 SDK、runtime、reader 与消费者回归测试；仅为新增真实 SDK 探针增加边界脚本的精确测试例外。规格与结果在本目录，原始证据在 `.local/memory-candidate-nested/`。

- [x] 重核 main／远端、当前分支、WIP、worktree 占用与进行中 Git 操作，读取规范及 M3.1/M4/M6 相关规格结果。
- [x] 用户确认最小方案与直接沿当前新分支实施；保存开工前 tracked hash 与受影响文件原字节。
- [x] R1-01：先完成最小真实 SDK 隔离门，核定通过后才修改产品禁令。直接／nested 保存重开 3/3，扩展 SDK 探针 6/6。
- [x] R1-02～05：嵌套产品行为与新旧 reader 先留真实 RED，再做最小 GREEN；消费者断言随新写合同更新，旧格式夹具保留。运行时资格／故障／压缩的增量回归与 guard 敏感性单列，不冒充逐 guard 历史前置 RED。
- [x] R1-06：v3 完整适用本地检查 2629项／2518 PASS／0 FAIL／111 SKIP，边界／类型／构建通过；两位全新上下文非作者规范／规格轴复验通过，原 P1/P2 已独立关闭，四原则检查通过本地范围。结果、未跑与原失败分别保留，非 Git／CI 交付或运行采用。

不运行真实模型／业务资料实验，不做 commit、push、PR、CI、merge 或归档交付，不切换服务、不操作 MacBook。当前工作树私有依赖由与本地 lock 一致的主检出依赖作 APFS 独立克隆，不修改源依赖目录；官方包身份核对与检查另记结果。

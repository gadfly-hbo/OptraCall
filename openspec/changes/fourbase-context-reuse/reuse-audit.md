# M4 v0.2：先复用，再补最小缺口

2026-11-03 · 只读能力核对与修订依据，非产品验收。

## 固定来源

本机Pi锁定 **1.4.0**；原[Pi／行业记忆研究](../personal-assets-phase01/agent-memory-research.md)、M3/M31当前权威与本机随包代码是依据，不把第三方pi-memory／pi-memory-md当官方内置，不安装或更新SDK／组件。当前图谱`optracall-m4-preparation-20261103`覆盖5003节点／15700边，图谱先行，已知包与未覆盖脚本按明确路径读；无边不是无调用。

旧v0.1两份审查及新四原则挑战报告均在`.local/fourbase-modules/m4/`保留。新`principles/reuse-autonomy-source-evidence.json`有26项代码／installedSDK摘要，初始M4准备的391源hash未变；原稿／报告不重写为本版PASS。

## 保留／删除／延期

| 范围 | 原生／现有能力与真缺口 | v0.2处置 |
| --- | --- | --- |
| 会话与推理 | 原project-tasks、Interface v3、Pi会话／工具循环／压缩／恢复／取消已在用 | 原位复用，无memory owner、第二会话、后台模型／总结或Host分析配方 |
| 业务找／读 | M3个人lookup、M31精确native reader与治理已存在；Pi文件read没有decision／排除／纠正业务含义 | 保留find/read小工具与有界目录适配；不以原lookup最后分页冒称无正文预读 |
| Host→worker | options不能序列化函数，现IPC主要Host请求／子reply和event，没有反向个人资料业务读port | 只在原通道补search/read受限回包，不装新服务／MCP、不发整库snapshot或整dataRoot权限 |
| 参数／权限／ctx | Pi有schema校验、tool_call／tool_result hooks、AbortSignal与ctx.executeTool组合调用 | 优先SDK，保留owner／run／manager／signal绑定；删除“所有M4读必须直接toolCall”的日志准入政策，新路线安全性确认后实验 |
| 原生证据 | SDK保存实际content／toolResult，nested子结果不独立保存，parent nestedCalls只有有限元信息 | 只展示真实覆盖范围，子正文未保存则UNKNOWN；不新deliveryId／proof账，不强迫额外read补证 |
| 模型实际看到什么 | Pi Provider转换取tool content text/images；details不是正文 | 目录或正文／最新意见进实际content；删第二receipt块和声明专用payload hash，原source版本hash保留 |
| 人工准确资料 | M3 decision／Enterprise revision可按准确ID回读；Enterprise未启用仍可个人保留 | target补完整decision身份，默认可读范围／最新意见，不按disabled一刀切；沿原taskKey／draft／发送／fingerprint |
| 候选消费 | M31个人页read允许查看排除项 | 新消费另核当前有效治理／excluded；不增加逐条人工批准 |
| 成果关系 | v0.1第三工具可建立机器核定的成果—实际交付关系，但非首个复用闭环必要 | 延期第三工具、reportIdentity、deliveryRef/nativeProof、双块定位；正常报告引用／拒用与原M2人的声明保留，明确无新结构关系 |
| 历史 | 部分旧taskContextReceipts／savedTaskHistory仍SessionManager.open | M4新／受影响回查共用已有safe snapshot→public parser/inMemory，不让新页触发旧迁移，旧消费者字节／mtime回归 |

## 本机Pi一手证据

- 随包`docs/sdk.md`及`dist/core/sdk.d.ts`已有customTools／原会话能力；`dist/core/extensions/types.d.ts`的ToolExecutionContext／executeTool与随包`docs/extensions.md`说明：nested仍过校验／权限hooks，子结果不单独进transcript。新读口必须核真实ctx和当前资源，而不能仅信任模型payload或用direct-only掩盖未验证的接缝。
- `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`1073–1096及对应responses转换将content送Provider；coding-agent原agent-session沿SessionManager保存toolResult。实际Provider下一请求含正文／纠正应在产品验收验证，不能从details推断。
- SessionManager公开parser／inMemory／getEntries／getBranch可复用，open有初始化／迁移写入且parser不代替完整性guard；沿现`native-session-snapshot.ts`而不新造session tree／恢复引擎。
- 现原生read已有offset／limit、截断及取消；业务工具尽量复用这些行为，只补准确业务ref、治理和Host访问。不能声称原生file read直接解决了所有个人资料权限／语义。

代码指针：[runtime](../../../src/agent/project-runtime.ts)、[SDK接线](../../../src/agent/project-session.ts)、[公共域](../../../src/host/agent-sessions.ts)、[个人保留](../../../src/host/personal-retention-store.ts)、[候选reader](../../../src/host/agent-candidate-reader.ts)、[治理](../../../src/host/agent-candidate-controls.ts)、[safe snapshot](../../../src/host/native-session-snapshot.ts)、[旧历史](../../../src/host/project-history.ts)。[App](../../../src/host/ui/App.tsx)已有activeId／activeTaskId／taskKey；快捷加入必须绑定界面明确展示的准确目标，不默选不明首末任务，也不提前openTask。

本报告是原语与差额核对，未运行M4端口或真实模型；实现与四原则运行专项需确认后以实际代码、SDK链路与UI检查。具体人工作业删减及验证见[四原则核对](principles-review.md)，共同完整规则只在[工程规范](../../../docs/engineering-workflow.md#四点产品原则)。

# M4 复用、缺口与Host／Agent边界核对

2026-11-03 · 准备阶段只读核对；不代表实现／运行验收。

## 固定依据

本机分支`codex/fourbase-phase01-design`，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`，保留M2/M3/M31 WIP。M31最终交付包SHA `85eb6f7dc7511015143419ca6fe4f608c863536f2a0bbb930b5341b79371337f`、391源摘要`55aaeb885a4a0dc887dc26e57ba551f8b9a7ee3ca4425daccc7c5f68a19a7b34`已回读匹配；用户限定例外仅后续新增接受记录，原包／报告不覆盖。

图谱已按当前M31产品源重新索引：`optracall-m4-preparation-20261103`，5003节点／15700边，persistence:false，没有写仓库图谱工件。先search／trace／snippet，图谱不覆盖脚本／全部闭包时沿明确import补读，不拿无边当无调用。

两份只读调查：`.local/fourbase-modules/m4/reuse/agent-read-audit.md`（含installedSDK和24项源摘要）、`explicit-read-audit.md`（24项源／规范摘要）。原[Pi与行业研究](../personal-assets-phase01/agent-memory-research.md)仍是既定研究依据，本轮只核本机锁定的Pi **1.4.0** 与当前产品，不把社区pi-memory/pi-memory-md当官方内置，不安装新组件或更新SDK。

## 能力与最小差额

| 已有权威／路径 | 实际已有能力 | M4复用与证实缺口 |
| --- | --- | --- |
| M3个人资料／Enterprise | 人工保留decision、准确revision/body hash、草稿／归档、独立sourceRefs与查找 | 复用正文／决定；lookup行没有完整decision target，必须从原决定产生准确ref。Enterprise未启用的已保留条目仍可读，不能按disabled一刀切。 |
| M31候选／治理 | Pi成功toolResult details是候选正文；原occurrence／fork去重、只读snapshot、人的引用事件、排除／恢复／纠正 | 复用exact ref与reader，不造第二候选Store；个人页允许excluded精确回读，消费适配必须另核治理才能新提供。 |
| 现个人lookup | 关键词／别名／范围、显式正文查找、个人／概念／数据视图 | 其page输出不代表内部有总预算：目前先展开条目与readSource。M4须补有界目录投影，不能只裁结果便称metadata-only。概念／项目数据继续M2，个人新tools首期只知识／经验。 |
| 普通任务／M2上下文 | taskKey选材、原draft保存、显式发送、request fingerprint、providedContext／原native | 只补personal准确refs与交付字段；不替换草稿、自动发消息或开会话。已有未发送选材本来是App内存，不编造刷新后可恢复承诺。 |
| Feedback交接 | 原BoardTask／来源项目业务handoff与意图回查 | 不是任意个人候选的通用交接。复用普通task选择／发送，不扩feedback来源枚举或造第二handoffStore。 |
| ProjectAgent／driver | 同一SDK runtime、customTools、Host→worker RPC／事件、真实ActiveRun／manager／取消 | Host函数不能随options传到worker。需原IPC的窄双向只读port；不另开记忆服务／模型／Runtime／dataRoot写权。 |
| Pi可见文本／details | 工具content进入模型协议；details可持久化结构／呈现 | M4read必须将正文／人的纠正放content，目录工具不带正文；不能沿M31“Agent自己生成body只存details”推论消费也只存details即可。 |
| M2成果来源／native | 固定成果hash、既有人的来源声明；native保存真实工具结果 | M2没有personal refs。推荐可选同prompt原生声明工具而不是扩M2schema；它只核原交付／成果身份，不推断采用或真伪。 |
| 历史查看 | M31native-reply／entry已safe snapshot；其它部分仍用open | M4新来源回查及受影响旧消费者须共用无写入读适配。旧schema、坏native、缺文件显示UNKNOWN，不开SDK会话或迁移原字节。 |

## 关键源码依据

- [个人查找](../../../src/host/personal-retention-lookup.ts)、[人工保留](../../../src/host/personal-retention-store.ts)：准确decision与revision仍是权威；只加目录投影和typedref，不另整理正文。
- [候选精确读取](../../../src/host/agent-candidate-reader.ts)、[人的控制](../../../src/host/agent-candidate-controls.ts)、[只读native](../../../src/host/native-session-snapshot.ts)：已具备严格读guard／治理及资源边界，但read允许个人页看排除项，M4必须另做新消费准入。
- [普通worker适配](../../../src/agent/project-runtime.ts)、[Pi接线](../../../src/agent/project-session.ts)、[公共域](../../../src/host/agent-sessions.ts)：沿现有生命周期；providedContext类型和prompt字段白名单目前尚无personal，fixedInput拒绝字段也须同步。新只读port不是已经存在的反向业务RPC，必须如实作为最小新适配。
- [App选材](../../../src/host/ui/App.tsx)、[普通任务](../../../src/host/ui/ProjectSpace.tsx)：目前选材state按taskKey，草稿另有保存。个人页跳转须沿非activate路径，选目标不等于openTask。
- [原生成果类型](../../../src/host/project-data-context-types.ts)、[历史投影](../../../src/host/project-history.ts)：现M2citation不包含个人refs；起始回执不包含后续工具交付，部分历史仍open，不能无证据宣称已满足M4。

本机installedPi primary源码已核：`pi-ai/dist/api/openai-completions.js`1073–1096及`openai-responses-shared.js`309–324只将tool content text/images转协议；coding-agent/core agent-session沿SDK持久化toolResult。SessionManager公开parse/inMemory/getEntries/getBranch可复用；open存在初始化／迁移写入，parser会吞坏行、重复ID及环需既有guard。具体bytes摘要在只读调查源清单，不把官方最新main当本机采用版本。

## 职责专项：设计层面

Agent决定是否找、关键词、读什么／范围、比较、拒用和是否对成果作声明；不设置固定分析步、方法数量／记忆次数、逐条批准或末尾必总结。普通工具／自然语言引用不因没有结构声明被判不合规，也不为补证强迫额外read。

Host只绑定owner／当前资源，核准确源／治理／预算／取消、交付文本与原生事实，保存／展示人的意见和作者声明；不替Agent选内容、补计算、作真假评分或按最新票数裁决冲突。IPC待决只为IO回包，不能变成新Agent运行账。实际交付快照与原候选正文权威分开；可选声明只表达作者说参考过，不能自动升级事实／策略／因果。

这些只是当前设计判断。确认后仍须实际code/callchain／合成SDK与Provider请求、保全／拒绝反例、真实浏览器和全新非作者最终复核；当前包不提前填产品专项PASS。

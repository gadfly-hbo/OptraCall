# 自动核算与主Agent修订：实施记录

2026-11-01（Asia/Shanghai）。用户已通过spec/UI并要求实施，先落实原件保护和结构合同。本页不改变原spec/UI阶段的检查结论。

**当前结论：工程候选已实现，完整功能仍被原普通worker后代收尾问题阻断。** 九项A已整体确认；公共接入已实现Interface v2。自动能力当前拒绝开启，没有环境绕过；真实模型验证、Git/CI、运行采用和产品验收未执行。下列“尚未实现／待确认”描述均为对应实施前历史状态；最新分层结果见[实施结果](implementation-result.md)，不据此抹去旧FAIL或把关闭门测试称为全链通过。

## 当前范围

沿现分支`codex/decision-feedback-loop`、HEAD `b36a42b43e86a279b1931770022c50b306ceeb36`，既有A/B/C WIP保留。已读取工程规范IN01–IN07、统一会话说明、产品原则及新spec；完成现有会话/核算Store和UI接缝只读清点。当前公共版本为Interface v1；[结构决定包](structure-decisions.md)提出v2兼容增量，尚未实现或冒称已确认。

当前只进行实施前诊断与合同整理，不创建产品持久结构，不改源码、配置、依赖或运行服务。读取本机man/SDK，并在被忽略的全新合成根运行权限/原生持久化探针；初始328份可见源码/文档基线在`.local/automatic-verification-revision/implementation-preflight/before.json`。

## 保护诊断

详见[可行性记录](protection-feasibility.md)。基础权限探针7项符合预期，预存硬链接1项FAIL原样保留；默认拒绝环境中Python/shell正常计算。SDK单独11项、OS+SDK联合及新根复跑各14项有界通过，保留同session身份/上下文、原件拒写与真实SDK尾追加证据。专用本地TCP端口可达、其他端口拒绝；数字地址语法失败也保留。

这些探针不是产品实现：原候选的Provider实际转发未验证且已随该候选撤下，不是当前待办；真实SDK accepted/settled、MCP/动态执行、父子取消/部分写/重启仍须后续工程验证。未调用真实模型或触及真实项目会话。

独立复核发现工具可篡改共享执行journal，已用新合成反例复现并撤下“执行native副本＋Host尾追加＋Provider中转”候选，原诊断保留。当前改为可信SDK独占原native持久化、所有Agent代码在受限工具进程执行；模型仍走原SDK原线路。分离边界需要新的诊断及后续完整验收，不能用旧14项证明。

新分离诊断：受限Python20/20、实际SDK read/write工具21/21为true，原件/journal/合成凭据保护及原生toolResult角色保存有界通过；真实模型、完整codemode/MCP、IPC/生命周期和生产权限策略尚未验收。原诊断失败均保留。非作者只读复核已确认9项包在合同层无剩余阻断、可整体评审；结论不代表产品实现或完整保护通过，详见本机`implementation-preflight/trusted-boundary-summary.json`和后续固定收据。

## 结构确认

9项完整决定包已成稿，推荐全部A，待整体确认。现阶段没有迁移、产品表/字段/文件布局或新公共接口实现，不将用户已确认的功能误作此前尚未给出的结构方案已经获批。只在一次整包确认后进入这些结构实现，不增加普通分析步骤或每轮确认入口。

后续执行顺序和验收以本包第9项及[验证计划](validation-plan.md)为准；本轮不做Git/CI交付、服务切换或MacBook操作。

## 用户整体确认与实施启动

用户已明确九项均采用A。当前按Interface v2及既有owner/profile推进：受保护执行/SDK接入、独立设置/链Store和原任务UI分别由独立文件owner实施；主集成负责公共lease、核算适配与HTTP/消息交接。先记录需求导出的失败测试再实现，保留旧WIP。当前公共环境切换、不可伪造资格、取消子操作及原生命周期26项新旧测试已通过，保护执行、Store/UI和全链仍在实施，不提前声明整体验收。


## 生命周期补充A的后续承接

用户已确认[补充边界](lifecycle-supplement-proposal.md)，继续从首次执行前托管及后台/停止机制；后续当前实现、复核发现与修正记录见[生命周期补齐结果](lifecycle-supplement-result.md)。本页原v2阻断、FAIL/UNKNOWN及当时NOT_RUN保持历史事实，不借新候选改写。

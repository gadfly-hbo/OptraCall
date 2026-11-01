# 自动核算与主Agent修订：spec/UI交付记录

2026-11-01（Asia/Shanghai）。用户确认后续事项，授权输出spec与UI Demo，未授权本轮实施产品功能。

## 本轮产物

- [spec v0.1](spec.md)：B停止专题参考/专用工具扩张，保留C材料能力；一次启用、明确报告版本触发、先独立再对照、意见回原主Agent执行修订、新稿再核和有界停止。
- [验证计划](validation-plan.md)：工程/保全/联合兼容与真实模型专业验证分别设计，不预填收益。
- [独立UI Demo](../../../docs/prototypes/automatic-verification-revision-ui-demo.html)：全合成、预置结果、内存状态；原任务核算区扩展，不替换原看板或其他功能。

## 保留边界与未决技术前置

原分支/HEAD、既有A/B/C源码、会话、文件、原型和旧FAIL/UNKNOWN保持。新文档不改旧spec或专业评分；仅在原后续方向页追加本包入口。原有可见文件字节基线在本机`.local/automatic-verification-revision/spec-demo-review/before.json`。

原主Agent须有真实执行能力且原件不能被破坏；实现前必须选定并验证可执行保护机制，并整体确认设置/链记录、版本关联、owner/lease及停止/未知的结构合同。本轮不假称技术方案已解决，不以固定文字出稿代替主Agent返修。

## 本轮检查

文档本地链接、空白与`git diff --check`通过；与本次修改无关的基线文件逐字节一致，原方向文档仅追加新入口，旧正文前缀一致。HTML为单一inline脚本，语法检查通过，静态未见网络请求、浏览器持久存储或动态求值调用；CSP限制网络及远程资源。

非作者首轮发现历史材料随新设置变动、下一链清掉前链、同任务/新对象场景混用、缺少模型配置显示及错误焦点关联。均已修正：每链捕获设置/身份，前链归档只读回看、不派发；同任务下一稿与新任务授权分开；合成模型可见；错误关联及可聚焦容器补齐。规格同时补清返修次数按主Agent接受意见请求计数、技术UNKNOWN与专业未知分开、SHA变化不证明作者身份。

作者及非作者分别执行Node VM纯内存状态检查，覆盖默认关闭、1/2/3次上限、先算后揭示、核算误报不采纳、无新稿/同内容停止、旧链身份不被当前设置重建、下一链保留旧稿/意见、历史查看不派发、源变化暂停及UNKNOWN只查询不重发。此项没有启动浏览器或实际会话，不能证明视觉、真实键盘焦点或后端功能。

**真实浏览器/亮暗视觉/390px布局/键盘焦点实际行为：NOT_RUN。** CUA浏览器自动安全策略拒绝本地`file://`协议，并明确禁止绕过；本轮没有改用服务器、另一浏览器或间接执行来规避。CSS响应式、主题变量、dialog/label/focus属性只做静态及模拟状态核对，不冒称完成浏览器验收。

非作者最终复核结论为`REVIEW_PASS_SPEC_STATIC_STATE_ONLY`，5份候选身份与16个本地链接核对一致，旧问题均关闭、无新增阻断。复核者另外独立执行纯状态检查，覆盖1/2/3次上限、误报拒绝、历史快照/回读、无稿/同内容停止、源变化、UNKNOWN查询及停止后不得派发。固定候选/结果回读收据在本机`.local/automatic-verification-revision/spec-demo-review/`。上述通过均不代表产品实施或专业收益；产品工程测试、原件保护机制验证、真实模型、Git/CI、运行采用与用户验收均NOT_RUN。

## 固定产物与复验入口

- UI Demo：58,746 bytes，SHA256 `ab2b44340e83b4e8840ea975e0fc1088ce15e868fbc48fe365a6fc10760c77f3`。
- 隔离QA：`node .local/automatic-verification-revision/spec-demo-review/ui-state-check.cjs`，默认核对上述UI SHA；15项`PASS_STATIC_AND_STATE_ONLY`，作者与主审各自运行，追加收据保留。QA脚本SHA `cc2ba5ab15ed0ea581931bf0f4623317d0e49ebea7fd881b43a901d5772268b4`。
- 非作者原审候选为`candidate-1.json`；此后仅本记录补签收陈述，最终清单另存`candidate-2.json`，不覆盖原审候选。最终记录短回读与完整文件保全结果分别保存。

## 后续：用户通过并进入实施准备

用户已通过本spec/UI，要求先落实原件保护和结构合同再实施。当前准备、合成权限/SDK探针及结构整包确认见[实施记录](implementation.md)、[保护诊断](protection-feasibility.md)和[结构决定包](structure-decisions.md)。原spec/UI检查和浏览器NOT_RUN结论不被此次授权改写，尚未开始产品结构/运行时实现。

## 后续实施的独立结论

九项A已整体确认并进入工程实现。工程候选与实际产品UI已完成受限检查，但普通worker遗留后代的安全收尾前提仍未成立，当前自动功能拒绝启用，**实施验收未完成，真实模型验证未启动**。历史spec/UI的NOT_RUN范围保持原样；当前检查、非作者发现、全部保留失败及下一步见[实施结果与阻断](implementation-result.md)，不能把此处历史spec通过当成功能已交付。


## 生命周期补充A的后续承接

用户已确认[补充边界](lifecycle-supplement-proposal.md)，继续从首次执行前托管及后台/停止机制；后续当前实现、复核发现与修正记录见[生命周期补齐结果](lifecycle-supplement-result.md)。本页原v2阻断、FAIL/UNKNOWN及当时NOT_RUN保持历史事实，不借新候选改写。

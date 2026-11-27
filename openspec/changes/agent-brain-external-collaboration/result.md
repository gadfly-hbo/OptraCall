# 发单准备与验证记录

2026-11-27 · PM Agent：Codex · **准备包待用户确认，尚未发单或实施产品**

## 范围与当前阶段

用户要求将 Agent 大脑产品讨论稿收敛为 spec、可点击 UI Demo，再以外发 Issue 发布。已核远端 main `4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`；现有文档提交 `41264eb5c584c1cf4e09c532e8842823a870c469` 保留在当前准备分支祖先中。

已完成 D01–D04 四项问答并采用用户决定，见 [决策记录](decisions.md)。[规格](spec.md)定义 AB01–AB18，[执行清单](tasks.md)定义 E01–E08，实际代码/权限/数据不因规格文件存在而改变。

## 已有依据

- 源码只读核对见 [reuse-audit.md](reuse-audit.md)：复用原owner/Interface v3/Pi、连接器日志、严格资产读取与成果保存，补业务外派/收件/授权/远端服务边界。
- 官方WorkBuddy API/Connector、MCP协议认证和实际联合验证差额见 [integration-research.md](integration-research.md)。已核接口存在；实号、真实客户端/连接器和网络部署均为 NOT_RUN。
- [Issue草稿](issue-draft.md)已按仓库模板准备，带确认SHA占位；仅供审阅，未发布/不可领取。

## 固定确认件

| 文件 | SHA-256 |
| --- | --- |
| spec.md | `636a0da0f926c5c8fb8d75774c53bc1f8564557f79125ac3e818286355f7db5d` |
| ui-demo.html（107113字节） | `770fcd371694554df18a2a482f2c5170c8210dead488539d2d2561d640d54933` |

[可点击原型](ui-demo.html)的体验入口见 [演示说明](demo-guide.md)。原型只用合成资料与本页状态，不调用真实网络/模型/供应商，不产生真实附件文件。作者为 `brain_ui_demo`；规格、决策、清单和发单稿由 PM 整合，接缝与官方依据由 `brain_spec_architecture`、`brain_vendor_research` 分别准备。

## 实际准备检查

所有原始脚本、JSON、截图和失败现场留在本工作区的 `.local/agent-brain-external-ui/` 与 `.local/agent-brain-external-preparation/`，不纳入产品源码。不同套件有重叠，以下数量不相加作为独立用例数。

| 检查 | 实际结果与身份 | 范围/证据 |
| --- | --- | --- |
| 作者修后增量 | **47项通过**，0脚本运行时错误、0外部请求；当前770fcd HTML | `node .local/agent-brain-external-ui/p2-fix/check.mjs`，退出0；`p2-fix/results.json`带HTML摘要。正常v1.0、补充v1.1、排除mapping、逐件保全/摘要门槛、缺件/仅链接不接受、保持原范围后继续、亮暗及1440/1024/390受影响视图。 |
| PM实际HTTP复验 | **25项通过**，0页面脚本错误、0外部请求；当前770fcd HTML | `node .local/agent-brain-external-preparation/root-ui-check.mjs`，退出0；同目录`root-ui-results.json`。确认前后hash一致；取消零授权、缩小两项资产、一次授权自主接受/原成果保存、附件与报告准确版本、未取用映射限制、草稿保留、390抽屉/键盘/焦点、UNKNOWN只读核定、取消/重开不复活。 |
| 独立实际HTTP点验 | **70项通过**，0页面脚本错误、0外部请求；当前770fcd HTML | 非作者`brain_preparation_review`，`ui-review-final.mjs`与`ui-review-final-results.json`。覆盖六类原Task、接入门槛、正常/补充、资产拒绝、忙/暂停/取消/迟到、执行者等待、UNKNOWN、窄屏/暗色/键盘及三项修复。完整结论见[独立复核](preparation-review.md)。 |
| 文本与引用 | UTF-8严格解码、无NUL/尾空白、本地引用及差异格式检查 | `python3 .local/agent-brain-external-preparation/validate-packet.py`生成文件hash清单；精确新增目录暂存后`git diff --cached --check`。不把未跟踪文件漏作零差异。 |
| 基线与范围 | 读回远端main仍为4132a39；产品/依赖/配置无变化 | `git ls-remote origin refs/heads/main`；Git变更仅本准备包，既有讨论稿提交保留祖先关系。 |

PM已目视核对1440交付页与390授权/原任务截图；没有发现裁切、页面横向溢出或权限摘要与实际范围不符。作者更详细检查范围见 [demo-notes.md](demo-notes.md)。

### 复核发现及修正

独立复核提出四项P2，均在准备范围内处理：

1. WorkBuddy `message_id`是账号消息游标，不能视为独立工作/会话或按消息先后归属。规格/研究/AB03及AB13已加精确关联、人工聊天/并发负例和首期同连接单工作触发约束；未关联正文不进入原Task/模型。
2. 原HTML在正常v1.0交付的报告中误写v1.1；现统一准确交付版本，补充版保留旧交付。
3. 取消mapping授权后附件仍宣称采用；现按授权与实际读取相交，正文/引用/核验均保留未取用、未核验限制。
4. 原附件未明确字节保全状态；现逐件显示模拟待保全/已保存/仅链接/缺件及摘要，未完整时不接受。

前一HTML `a37d37256a71d3af525b786d5a2e93826f10784082bb6e6d96486724ad27d190`及其作者106项HTTP、12项差额和54组视图/键盘记录保留为历史，不当作新HTML全量重跑。独立旧候选实页缺陷证据也保留；修后以本节47/25/70项各自范围为准。

PM初次脚本在流程已切到工作页后直接读原Task草稿超时；第二次把“已保存字节”误限为“已保全”。已保留两次脚本/JSON/截图，只修正导航与有明确语义的断言后通过。作者隐藏弹窗选择器问题、独立点验选择器/动态重绘竞态的原记录亦保留，不算产品缺陷或抹掉原失败。曾怀疑的“保持原范围”保全遗漏经源/实页核对未成立，未作产品改动。

## 验证边界

- 当前环境Chromium策略阻止`file://`直接导航，未修改策略，**本环境文件启动为NOT_RUN**；以实际本机HTTP加载同一HTML及无外网请求检查替代交互点验。内部localhost不是用户可访问的托管预览，用户可保存单文件后在自身浏览器打开。
- 本次是规格/静态原型准备；产品完整检查、实际Host/Pi/MCP/TLS/OAuth闭环、PR/main CI均**未运行**，属于正式Issue实施。未将模拟接入、保全或已接受状态写成真实运行结果。
- WorkBuddy API/Connector分别有官方依据，**真实账号与API触发会话使用指定MCP并交回的联合验证为NOT_RUN**。真实部署、第三方许可、套餐、专业成果与用户验收另证；首次完整联通不通过不得显示配置就绪。
- 四原则只在本规格/交互准备范围通过：Host管理身份/记录/资源与原owner续接，Agent作拆分和核验；官方Pi1.4.0/MCP1.32.2及原Runtime复用，不升级/改包；一次必要范围授权后自主，首次接入和必要经营取舍保留。未来实现是否符合须检查实际代码和运行证据。

## 用户确认与发单

最终 spec/清单/Demo 尚待用户整体确认。按[工程规范的新产品流程](../../../docs/engineering-workflow.md#新产品新功能开发)，在确认后推送确认版、读回完整SHA，再替换Issue草稿中的占位并发布，核对正式工单链接/正文。现有四项方向选择不替代本固定确认件的整体确认；如果用户另给独立方案，先对比、取舍、整合并再次确认。

本轮没有修改产品/依赖/SDK、真实资产或运行权限，没有注册真实应用/凭据、调用真实模型/WorkBuddy/GitHub业务账号，没有部署MCP入口或更新双端服务。

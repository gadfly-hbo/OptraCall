# v0.2.0 实施验收记录

2026-11-16 · 当前为工作区候选，未提交或交付。需求标准沿 [A01–A28/J01–J12](acceptance.md)；本文件只登记工程事实及缺口。各项未写完整 PASS 前不能当作模块完整、真实模型专业验收或用户产品验收。

## 候选与结果分层

- 分支 `OC｜upgrade-v0.2.0`；HEAD/最新origin/main均为 `3ebaa01d2fd6d81a6605f408f9f414a4b8bd7a19`。产品候选为本轮全部tracked diff及untracked文件，最终SHA清单已固定，准确身份见result；旧准备manifest不覆盖实现。
- 批准输入、外部v1.1及原Demo保全见 [approval](approval.md)、[implementation](implementation.md)；产品稿不入仓库。
- 实际官方Pi 1.4.0、原Interface v3、原Semantica；package/lock/SDK入口无diff。实际SDK检查使用隔离合成根与loopback Provider，未调用真实Provider、业务资料或设备服务。
- 所选方法的实际读取、Agent脚本声明、专业正确、真实模型采用分别记录；不把工具回执当作方法正确或经营授权。
- 新Skill已按用户2026-11-16“免测、直接通过”授权接入固定八文件候选；原等待条件保留为历史。本次未运行独立对照测评，准确依据见[接入记录](skill-adoption.md)。
- 工程检查、独立复核、Git/CI/合并、设备运行采用、用户产品验收和业务效果分别核定。

## 工程覆盖索引

下表“已覆盖”指实现及所列确定性/合成SDK证据存在，仍须最终完整候选检查与独立复核；不是 A/J 最终全通过声明。`.local/overall-architecture-upgrade/development/`为本轮证据根，原失败与重跑分开保留。

| ID | 当前工程覆盖与关键证据 | 缺口／结论边界 |
| --- | --- | --- |
| A01 | strategy-goals-store、strategy-goal-sources、overall-v020-host：同源准确版、实际SAP发布指标/名称、基线待补 | 真实经营指标和专业适用未验收 |
| A02 | strategy-goals-store、case-goal-ui：职责贡献/必要条件/视角及无完整组织前置；源范围沿原企业权威 | 不以测试证明组织战略质量 |
| A03 | case-goals、case-goal-ui、project-plan-case-link；实际Goal→原Case/Project浏览器 | 旧Case不回填目标，不猜关联 |
| A04 | strategy-goals-store/sources、quoted-decision-authorities：旧版本/原权威反馈；旧Board冗余taskId不新增同一反馈 | 不批量合并已存在历史重复 |
| A05 | project-plan-preparation-host：原空工具SDK轻量准备、实际禁止明细/试算、原操作读回/准确停止；普通追问沿已确认Plan | 真实模型准备质量未测；旧任务兼容不回写方案 |
| A06 | project-plan-store/preparation/ui：开放分类、覆盖/重点/暂缓、原任务与综合责任；准备不把树自动建任务 | MECE专业判断由Agent完成，不把分类数量作质量分 |
| A07 | project-plan-runtime、project-selected-methods：一次确认单多Task准确方法/资料/权限，create-only无模型；quote-safety：分析启动不是经营选择 | 选读与实质专业使用分层 |
| A08 | project-task-lifecycle、project-plan-store/runtime：新增/归档/恢复、busy/UNKNOWN保护、原native指针与不删除 | 浏览/恢复不启动；真实用户恢复采用另核 |
| A09 | project-selected-methods：实际SDK读取原SKILL及固定SAP版、准确声明；内容包脚本变化拒启动；TOC/TP和自主性随方案进入 | 真实模型采用、专业推理与效果NOT_RUN |
| A10 | 方案/声明的限制、补证和自主选择合同；合成迟到/缺成果/停止读回检查 | 真实缺证/分歧的专业表现NOT_RUN |
| A11 | 八文件独立候选、36检查/21核算/独立契约作者回归，旧本体/回执保留 | **用户本次授权免测通过，固定八文件已接入；原数值/质量兼容及实际SDK采用单列，未伪造实测数据** |
| A12 | project-task-results/sources、project-plan-runtime：指定参与来源、准确native/报告hash、单Task自身、有界等待、实际一次确认两Task后find/read | 真实多维结论的分歧/交叉影响/归因质量NOT_RUN |
| A13 | analysis-delivery-host、delivery-native-repair：明确意图、原owner/report绑定、同内容复用、超预算保存前拒绝 | 真实模型文件写作质量另核；UNKNOWN不被绿色重跑抹除 |
| A14 | automatic-review-handoff、analysis-delivery-host：准确材料/稿件、审查接回作者、v2另存复查、无声明/失败/停止不回退v1 | 自动交换资源上限2轮不等于审查通过；新增稿未审状态保留 |
| A15 | quoted-decision-runtime/adapter：原话准确范围与Case版本、操作去重、GSA仅引用；分析确认文字不能冒人的选择 | 语义含糊需澄清，经营取舍仍由人决定 |
| A16 | 原Board schema4独立行动授权、反馈和Case选择；authorities/history/迁移测试 | 用户报告不等于独立验证，未经营执行 |
| A17 | attached-postprocessing及原SAP回归：固定原会话来源、method/reuse/none、原候选/发布分开 | 不证明真实模型提炼价值，正常结束与停止分开 |
| A18 | method-issue-adapter、原SAP/Studio/记忆回归：准确版、权限与suspected原问题；不造新库或自动发布 | 人的治理/固定历史继续保留 |
| A19 | automatic-business-feedback：IR关资产开只处理已声明问题、原Task/资产来源；Case目标变动拒写 | 不把后来业务变化自动判为旧方法错误，不全历史扫描 |
| A20 | project-selected-methods新增实际SDK：旧错误版拒启动；明确选纠正版后新Task实际读取v2，旧Task和v1引用保留 | 覆盖方法接缝；真实经营效果及记忆人的采用另核 |
| A21 | automatic-action-settings/dispatcher与实际浏览器：首次全关、全局/局部同值、跨Task运行时读值 | 状态不证明业务节点专业正确 |
| A22 | automatic-review-handoff/dispatcher/attached：关闭不强杀在途，动作前重读、停止撤后续 | 取消落盘及失败后可信显式重试已修；原失败/busy保留，独立复验通过，完整check03通过 |
| A23 | required selfCheck/methodChecks +手动原能力；IR-off/assets实际SDK负例 | 开关不授予发布/经营权；当前Skill按本次授权接入，不扩大开关/发布权限 |
| A24 | 明确delivery来源、原native保存确认/回执、重复报告/选择/授权/Plan原请求读回，停止/无意图零接续 | 长nested参数省略的原生准确确认经独立复验；保留原UNKNOWN |
| A25 | App去一级市场、设置过渡、catalog原27项/13规划；只移除场景六展示 | 已按实际五判据退出过渡tab及整目录fallback；其他能力/配置/历史保留 |
| A26 | 原Task/Project/Studio与具体设置入口、原位返回和未保存输入保留 | 实际N1–N7矩阵及退出后浏览器通过，详见navigation-migration；正常PPT渲染另列FAIL |
| A27 | 旧Project/Task URL和未知Studio身份不替换；当前权限由原权威核，连接缺配置实际可达 | SAP指标/方法/资料准确版本、停用/未明确企业、Refiner归档及准确返回已核；隔离正常渲染未通过 |
| A28 | 退出判据逐项沿navigation-migration登记 | 导航五判据已有N1–N7依据并退出市场；不把导航通过扩大为专业能力本体或全部模块验收 |

## 联合场景

| ID | 已有工程证据与保留边界 |
| --- | --- |
| J01/J02 | Goal/Case/Plan主线、一次确认单/多Task、create-only、已确认Plan追问；实际SDK来源准确；真实业务多维分析质量NOT_RUN |
| J03/J04 | 准备/reader/声明对资料不足、准确范围、等待截止与版本变化保留限制；真实模型分歧处理质量NOT_RUN |
| J05 | v1审查接回→v2另存/独立复查→Case及资产使用v2声明，原稿保留；Spec独立增量6项通过 |
| J06 | 全局与局部同源、A影响B尚未开始动作、审查关闭后无作者接续；在途原结果保留 |
| J07 | 原stop、子domain匹配停止，修订failed/no声明/stopped无后续；附属取消落盘与可信显式重试已有稳定RED/GREEN和独立复验 |
| J08 | Plan/报告/选择/授权/反馈原操作及读回，超限零孤儿报告，原FAIL/UNKNOWN保留；未宣称跨Store原子事务 |
| J09 | IR关资产开实际SDK方法suspected问题反馈；无新方法版本；原手动提炼独立 |
| J10 | 原SAP治理+已知错误版拒启动+明确选适用v2新Task真实读取；不自动升级固定引用或撤销人的决定 |
| J11 | 业务/具体管理/异常/历史N1–N7实际导航及五判据已核，过渡市场已退出；正常PPT渲染FAIL及活库未测分别保留 |
| J12 | 原Case迁移逐列、Board无伪历史授权、旧native/权威保留、原消费者和全量测试；四原则/非作者完整候选结论见result及固定最终报告 |

## 全量及独立复核记录

首轮完整check测试2840项：2727 PASS、2 FAIL、111 SKIP（259.5秒），失败后未构建。原方法反馈UUID位段缺陷和旧schema测试预期已分别修正；不删除首轮结果。定向新回归包含真实先RED、无效RED/夹具错误的NOT_PROVED和修后GREEN，详情见implementation及各作者收据。

Standards预复核两项、Spec预复核三项均有独立实际SDK复现。Spec三项在固定增量独立6项通过；预算问题独立关闭，长nested正常省略及原native保存确认已独立关闭。第二轮固定运行源码完整check为2866项：2755 PASS/0 FAIL/111 SKIP，typecheck/边界/构建通过，运行源码无漂移。其间独立新增取消失败显式重试缺陷，不能被绿色覆盖；修正后第三轮完整检查及非作者增量复验已完成，完整清单身份见最终报告。

## 固定运行源码最终检查（check03）

`npm run check`退出0；完整测试、typecheck/接入边界及Vite构建通过，运行源码前后无漂移。精确计数、耗时、日志及输入SHA见本地`verification/full-check-03-{inputs,result}.json`及日志；最终文档身份另固定，不沿旧准备manifest。原首轮2 FAIL及各独立复核原FAIL不覆盖。

M7矩阵为[导航迁移](navigation-migration.md)，作者最终SHA `584ecda709fceb963f039dff0278a9caa154470f016deeaa63efe055cbb3d34e`；市场退出后的App SHA `f120f1a46ef9930e02298d6954e94d63e53aa3c4dc38613c74e888c5bf6fc96a`已实际复核，原目录27项中14已接与13规划状态保留。原PPT正常渲染在隔离Host为422/render_failed，原脚本同环境实跑exit3/pypdfium2不可用；仅异常返回/历史与只读权限通过。没有安装渲染依赖、检查/改变真实产品环境、使用真实数据库或Provider；不把这些状态写成专业正常路径PASS。

此前A11等待状态已由用户本次明确授权解除；固定候选已接入，准确工程状态见skill-adoption及result。真实LLM采用、专业正确性、运行采用、用户产品验收与业务效果均NOT_RUN；合成Provider的真实官方SDK工程链路不能替代。Git提交/推送/PR/远端CI/合并/设备服务更新NOT_RUN。最终非作者固定全候选核对在result登记。

## 当前授权接入后的验收

本次用户明确授权固定data-analysis候选免测通过后，A11已原样接入；旧有效版/原测评结果及旧工程候选保持历史。当前完整`npm run check`：2870项，2759 PASS、0 FAIL、111 SKIP，类型/边界/构建通过，运行源码前后无漂移。最新源码与全文件身份见skill-adoption/final-candidate.json及该目录review最终报告。新契约实际SDK采用、原24项兼容、8份快照资源、当前包授权与历史测评准确分开均已核，详见skill-adoption.md。免测决定不伪造测评执行，真实专业/运行采用/产品验收/业务效果及原PPT环境FAIL仍按原状态。

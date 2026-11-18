# Studio 二期 v0.3 设计准备记录

2026-11-12 · 完整方案与设计检查完成 · 用户方案／spec／UI 审核待进行

## 授权与交付

用户授权在现版补齐 Pi Agent 在普通分析与决策中实际使用资产的完整主线，再作为完整方案审核。仅新增设计包和独立原型，不实施产品功能，不调用真实模型或企业数据，不改变依赖、SDK、Git交付或运行服务。

- [完整方案 v0.3](../../../../docs/studio-phase2-proposal-v0.3.md)
- [完整 spec：SU01–SU24、D01–D09](spec.md)与[交互状态：UI01–UI35](interaction-states.md)
- [可点击 Demo](../../../../docs/prototypes/studio-phase2-v0.3/index.html)与[审核说明／合成数据预期](../../../../docs/prototypes/studio-phase2-v0.3/README.md)
- [v0.2 原审核记录](../result.md)及[v0.1 原稿](../../../../docs/studio-phase2-initial-proposal.md)

分支 `codex/SAA_Studio_2`，源码基线 `15f40455083c144a185bed4aef6715c7891085dd`。开始前将 v0.2 完整10份文件和1,238份跟踪文件摘要固定在本机忽略目录[before.json](../../../../.local/studio-phase2-usage-design/before.json)。v0.1 在原清单内，原摘要继续保留。

## 本次补齐内容

建设管理继续由统一 Studio 承接，普通分析任务直接提问、自主取材和分析是并列入口。用户无需先打开 Studio 或逐个选资产；结果中按需查看准确依据、实际取得的正文、计算、采用说明与限制。Pi 继续沿原公共会话和公开工具注册，新增设计收敛企业范围及供给差额，不建立 Runtime 或 Host 固定分析流程。

Demo 新增本地合成明细计算，展示定义、身份映射、首购队列、成熟观察、退款事件和订单去重、跨店归属。分析可形成 Case 核查建议草稿，也可形成普通任务贡献，核对关联既有候选后，在发布预览看到 UC／原报告／任务／基于版本，再进入后续新任务计算新版并回看旧稿。

### 合成计算证据

独立复核先从[合成明细](../../../../docs/prototypes/studio-phase2-v0.3/fixtures.js)推导预期，再运行原型实际处理器。30日窗口、最小样本3、开业以来历史完整及无同日多笔订单均为封闭算例假设，不是目标企业正式标准或统计充分性承诺。

| 版本 | 青鹭站 | 松渡站 | 雁汀站 | 合计 |
| --- | --- | --- | --- | --- |
| 1.2.0 | 2/5，40% | 3/5，60% | 0/2，样本不足不排名 | 5/12 |
| 1.3.0 | 1/4，25% | 3/5，60% | 0/2，样本不足不排名 | 4/11 |

新版排除已成功全额退款订单：M01 不再复购，M02 首购顺延后观察未成熟；部分退款保留，恰第30日的购买在窗外，跨店复购归首购店，订单／退款同步重复分别去重。未知 P99 身份排除并显式保留缺口，结果仅限合格已映射会员。原 AR 报告和来源保留原字节，新结果另存。

## 检查记录

| 检查 | 状态及范围 |
| --- | --- |
| 文档与消费接缝 | 完整方案、SU01–24、UI01–35 已补；独立文档与四原则核对未见必修项；当前工具／profile 差异有工作树源码依据 |
| 作者检查 | 18项原型状态与算例自检、三份JS语法检查通过；仅作者证据，不代替独立或真实Pi |
| 浏览器初版 | 固定 usage `7b959824` 候选17/17项 DOM 断言通过；实际点击完整主链、失败／partial补读、冲突、临时、B隔离、缺失、390px与Escape焦点；明暗视觉核对 |
| 非作者独立复核 | 最终37/37通过：8项明细算例、21项消费／版本／Case／贡献、8项原管理回归；首轮31／3和修后34／0、受影响反例36／1均保留 |
| 修后浏览器 | 首次修订7项（断言文案适配后）与最终候选7项均通过；复验U01–U03、无Case既有草稿只读与恢复、完整UC发布到新版计算及旧报告、最终390px无整体横溢；控制台错误0 |
| 原件与范围 | 独立与作者收尾逐件核1,238跟踪文件与10旧包，0漂移；本地引用及最终候选清单通过读回 |
| 用户具体审核 | 待审核；检查通过不能代替用户确认，也不启动开发 |

本机 `agent-browser` 不可用且未安装依赖，实际浏览器使用现有 in-app browser，仅打开4189静态原型。原4188预览与v0.2文件保留。

### 独立发现与处理

| 标识 | 首轮差额 | 状态 |
| --- | --- | --- |
| U01 | 证据面板未单列作者声明未保存、独立核验未执行状态，可能混淆采用模拟与核验 | 已关闭；分列模拟回读、采用、本地计算、作者声明未保存和独立核验未执行，实际浏览器与独立复验通过 |
| U02 | 无Case绑定未有评审状态，原型草稿处理器未作资格守卫 | 已关闭；无Case继续分析，创建／既有草稿输入、保存及回填均核当前Case匹配；独立与浏览器复验通过 |
| U03 | 后续任务本地计算完成后，旧详情仍称没有计算，与当前成果冲突 | 已关闭；本地计算报告与未调用真实Pi分列，实际浏览器与独立复验通过 |

首次修订后34项通过，新增直接受影响反例仍发现无Case可写既有草稿（36 PASS／1 FAIL）；再次定向修订后最终37项全部通过。浏览器曾把实际文案“本地合成明细计算”误写为“本地合成计算”导致一项断言失败，原输出保留，校正准确文案后通过；另一次摘要元素的定位器适配失败未计原型缺陷。

以上是静态原型的设计差额，不是本轮发现的真实产品安全漏洞。原型修正由原作者执行，非作者只读重验。原v0.2 F01–F08及历史失败保持原记录，本增量亦做受影响管理回归。

## 本机证据索引

- [初始候选摘要](../../../../.local/studio-phase2-usage-design/review-candidate.json)
- [浏览器初版17项](../../../../.local/studio-phase2-usage-design/browser-v1.json)
- [独立预期](../../../../.local/studio-phase2-usage-design/independent/expectations.md)与[独立数值预期](../../../../.local/studio-phase2-usage-design/independent/fixture-expectations.json)
- [独立首轮31／3](../../../../.local/studio-phase2-usage-design/independent/review-v1.json)
- [独立首次修订34／0](../../../../.local/studio-phase2-usage-design/independent/recheck-v2.json)与[受影响反例36／1](../../../../.local/studio-phase2-usage-design/independent/affected-cases-v2.json)
- [独立最终37／0](../../../../.local/studio-phase2-usage-design/independent/recheck-final.json)与[完整独立报告](../../../../.local/studio-phase2-usage-design/independent/final-review.md)
- [浏览器首修原断言记录](../../../../.local/studio-phase2-usage-design/browser-v2.json)、[文案校正后7项](../../../../.local/studio-phase2-usage-design/browser-v2-corrected.json)、[最终7项](../../../../.local/studio-phase2-usage-design/browser-final.json)
- [独立原件最终读回](../../../../.local/studio-phase2-usage-design/independent/preservation-final.json)
- [桌面亮色](../../../../.local/studio-phase2-usage-design/screenshots/analysis-light.jpg)、[桌面暗色](../../../../.local/studio-phase2-usage-design/screenshots/analysis-dark.jpg)、[窄屏暗色](../../../../.local/studio-phase2-usage-design/screenshots/analysis-mobile-dark.jpg)、[证据面板](../../../../.local/studio-phase2-usage-design/screenshots/evidence-light.jpg)

这些是本机持久检查材料，不写入企业资产库。最终文件与SHA-256见[候选清单](manifest.json)，旧包／跟踪文件、引用和范围收尾见[最终读回](../../../../.local/studio-phase2-usage-design/final-preservation-and-links.json)。

## 四原则与未验证范围

Host 仅负责上下文、目录、权限、公共会话、准确交付与回执；Agent 自主选材、判断适用、执行计算和纠错。正式产品复用 Pi 1.4.0／Interface v3 的原接缝及 SAP／企业资料权威；Semantica 0.7.0 为可选语义支撑，本轮均未安装、升级或运行验证。正常操作只有提问／发送；依据浏览、管理和发布决定按需，额外必要企业范围或业务取舍沿原权限处理。

本地确定性计算确实执行，但目录／精读／采用事件和 Agent 回复仍是模拟；作者声明和独立核验另记状态。原型通过不证明真实 Pi 会自主发现或正确应用，也不证明Host权限、真实保存、模型质量、决策采纳或经营效果。

真实公共生命周期／取消迟到、持久化迁移、SDK完整性与运行采用、获准企业数据专业正确性仍待后续。通用 SAP／IR 编辑器、附件与生效范围完整编辑等旧版未模拟项保持；UI矩阵覆盖的是产品合同，不代表35种状态均已实现在原型。后续需独立普通新任务跨两主题实际使用、实质修订后正确使用新版、旧报告依据与原销售退款受影响回归。

## 本轮执行清单

- [x] 固定旧包和跟踪文件身份。
- [x] 补齐完整方案、spec／状态矩阵与新 Demo。
- [x] 实际浏览器验证主链及主要异常、计算版本差异和历史。
- [x] 完成三项发现及既有草稿追加写入反例的定向独立／浏览器复验。
- [x] 完成最终范围、原件、引用与文件摘要读回，准备提交用户审核。
- [ ] 用户审核具体版本；产品实施与真实Pi验收另按有效授权推进。

目前完整 v0.3 已可供用户审核。没有产品实现、真实模型或业务资料验收、Git／CI交付、SDK变化或设备／运行采用；用户当前具体版本决定待反馈。

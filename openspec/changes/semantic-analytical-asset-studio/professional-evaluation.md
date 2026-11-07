# Studio 真实模型专业验收

本记录与工程检查、Git/CI、迁移兼容、运行采用及用户产品验收分别核定。用户于2026-11-07授权本阶段，并确认双机更新。准确授权见 `delivery-authorization.json`，协议见 `delivery-spec.md`；原本地工程结果和合成Provider回归不改写为真实专业验收。

## 首次尝试：Host传输缺口，未交付

首次冻结的是本地未提交候选（base HEAD98ee477，59件差额清单）及全新三店、双口径、状态/截止修订的合成材料。采用当前已选MiniMax-M3.1-Flash、原生minimax-cn/anthropic-messages、源配置revision5；只通过原配置保存入口导入隔离Host。项目/资源根位于仓库外，与正式双机业务根分离。金标及评分脚本未交付模型；首轮没有给出必要服务费业务回答或期望金额。

模型实际自主读取、调用工具及官方文字抽取。官方抽取返回候选后，Studio 30,000字符工具回执限制拒绝较长结果，且没有原候选继续读取入口。非作者用无模型、仅合成callback也独立补现同一缺陷。因此首次FA01必交付路径受阻，不能因为模型调用或工程回归成功就记为通过。

执行者确认缺口后，通过准确原task stop停止本轮，HTTP200、task cancelled/snapshot idle；随后正常关闭隔离Host并记录收尾。1个主建设业务请求保留在首次分母：未交付正式资产/预览，后续发布、普通使用和回补再用NOT_RUN；没有最终业务报告可评分，不将其写为数学错误、零错误、模型自然结束或合法未知。

原native逐字封存12个唯一会话（主建设1、附属抽取11），41个assistant frames；“1个业务请求”不等于只调用模型1次。原native可见input123571、output76723、cacheRead600679、totalTokens800973；reasoning39398为output子项，不重复加总。SDK目录估算cost0.0732612893，供应商结算UNKNOWN；取消帧可能缺完整usage，不补零。原settings/auth前后摘要未变，冻结期间候选源码零漂移，原工具错误和部分文件保留。

本轮修复只允许在OptraCall补准确技术回执和分页，不改SDK、业务公式或固定Agent步骤；原数据包永久封存，修正候选须用另一套新未见材料。当前真实专业验收结论为 **首次受阻/未交付，修正版待验**，不是首期产品通过。

证据保留于本任务 `.local/studio-delivery/runs/live-first/`：`first-attempt-freeze.json`、`first-attempt-result.md`、`usage-at-stop.json`、`operator-stop.json`、原任务/体系回读及原native。独立补现与复核见 `.local/studio-delivery/independent-review.md` 和 `review-temp/extract-budget-probe.log`。这些私有日志/会话/凭据不进入公开Git。

## 第二次尝试：建设自然完成，仍有工程阻断

D1及后续来源撤回/来源重标缺口经非作者实际Host复核关闭，155/155专项零跳过；当次完整check为1865 tests、1814 PASS、51条件SKIP、0 FAIL，构建通过。新材料v2公共A/B与业务答复先冻结，独立Decimal核算再封存；与首次资料分开。准确候选63件在真实请求前冻结，运行结束逐件摘要无漂移。源码未在模型运行中调整。

本次仍用原选MiniMax-M3.1-Flash及相同API/地址，实际native thinkingLevel为high；源配置未设置单独thinking覆写，使用固定SDK的实际默认。1个主建设请求自然completed、snapshot idle，81个可见工具结果、14个错误全部保留；不是operator cancelled。建成6项源资产候选、原SAP指标/方法各1及建设试算报告，正式预览0，后续正式发布/普通A使用/维护B/普通B使用NOT_RUN。建设试算及模型自报独立复算不能代替普通分析使用或外部专业评分，业务数值与叙述正在按封存规则另核。

本轮必要业务问题实际进入共用面板。执行者只在问题出现后按预先封存的合成事实经原 `/answers` 回答，保存回执及中途GET均显示已答；未增加模型请求。随后主Agent对同id事项更新使答复丢失、重新显示waiting。非作者以合法Store调用序列独立补现；这是Host保全缺陷，不能当作业务方没有回答。部分分页参数类型、来源Ref及工具结构错误则保留为实际Agent/接口行为，不把全部错误归Host。

另有正常六资产状态返回过大，更新可落盘后工具回复报错；非作者补现资产多修订、合法长SAP方法及合法大预览也有同型缺口。普通六资产的发布预览本身通过独立补现，不能将其一并称为失败。准确恢复与合同缺口见 `.local/studio-delivery/review-temp/general-result-budget/findings.md`。因此不继续本包的后续付费链路，原Host正常关闭，原候选、报告、业务确认HTTP回执和2份native已逐字封存；补修后另用新资料验收，不重跑挑选v2。

可见2个native会话、69个带usage的assistant frames；input162439、output90238、cacheRead7118027、totalTokens7370704。SDK目录估算cost0.1842532177，供应商结算UNKNOWN，不把缓存量当新输出，不把帧数等同供应商调用数。原settings/auth前后摘要保持，双机原服务尚未切换。证据为 `runs/live-second/construction/evidence-frozen/manifest.json`、`usage-after-construction.json`、业务答复请求/回执与源配置保全记录；首次失败和本轮结果分别保留。

### 第二次独立专业判定

外部判定已冻结为 **PARTIAL**：FA01部分成立，FA02–04及完整FA06链未运行；FA05仅业务回答保全/接手这段确证失败，其余真实状态未触发。所有建设试算金额、差额及主要边界正确，但一处最终百分比因中间ratio先缩减精度而末位错误；341项数值/比例核查不以金额命中抵消该错误。原SAP变化率候选的ratio numerator与定义/expr含义不一致，结构校验不能证明业务自洽，也不能据此推测某消费端已实际算错。

答复归因分别保留：HTTP确实保存了业务事实；模型只看到resolved状态、未将答复正文取入其可见文本，随后又重置waiting；Host接受泛用更新并抹掉answer。模型未见具体答复时并列两种未确认方案本身合理，但看到已答状态后仍重复问、确定口径未交付不能通过。抽取续读使用字符串页参，另有来源与工具误参；这些不被旧Host缺陷统一覆盖。

过程也未通过严格公共A范围：模型读取项目外历史SAP样例及产品validator。所交native未观察到本包金标/B读取，不宣称文件系统提供隔离。历史样例、初稿、原错误和非作者诊断假差异均保留；没有用作者“独立复算0差异”替代外部判定。无答案报告及冻结身份见 `.local/studio-delivery/professional-review-v2/construction/judgment.md`，SHA256 `6016846208eb8c7d1a9331a1a1a3fb7fbc1b1287ffd56ad085e0fc3b7bccf74d`。


## 第三次：限定成果可发布，首份普通使用与维护均未通过完整专业要求

本轮采用另一套预封 v3-r2 合成资料，公共 A/B、必要业务答复、独立 Decimal 真值及评分规则在启模前分离封存。原 v3 设置中的身份冲突发生于模型派发前，作为 SETUP_MATERIAL_FAILURE 保留；修正后的 v3-r2 才实际启模，未把设置失败当模型失败或删去旧记录。A 为三门店、两等长期间、发生与支付订单群两口径；各群分别期末加三天观察，另有更晚的统一记录已知截止。B 为新退款来源，完整三字段业务键、分单位及状态/时间字段映射与原来源不同。B 的维护按预定来源切换执行，不是看结果后换题。

实际仍用同一 MiniMax-M3.1-Flash / minimax-cn / anthropic-messages 原生线路，源配置 revision5、隔离保存 revision1，native 实际 thinking=high；Pi1.4.0 与 Semantica0.7.0 官方原包保持。本轮冻结候选66件，原始清单 SHA256 `e330a56d461bfff5ca6cfa66123275cf821e2f157a7461a971c1123e3b05d61b`，所有实际阶段冻结均无源码漂移。原始输入 manifest SHA256 `cb5c3c11710c1d09ea5e35ae0e881823c43d9232cef6b2c677868b75ba27beae`。Host 与材料根在仓库外持久隔离，不读正式业务文件，不把真值或评分脚本交给产品 Agent。

### 建设、确认与限定发布

实际共7个主业务请求：初建、业务答复后续建、三次命名的发布准备/人工核对修订、普通A、来源B维护。必要服务费事实通过原业务回答入口保存，原问题和答复在后续快照中保持。前三次发布准备的人工反馈分别涉及事件例证/状态条件、历史候选仍进正式范围/费用解释、试算答案混入复用资产。每份初稿、返修、预览和错误均先冻结并保留，不能把修订后的结果当一稿正确。没有更换模型、自动重发副作用或无限返修至通过。

官方文字抽取确经Pi附属文本资源完成：原候选包含32个实体、50条关系，2个实际抽取回合、0个抽取失败；长回执续读实际使用。原建设Agent据原文修正并保存结构化本体。最终原A整版预览仍有方法条件错误：超出发生期间并不保证进入对应支付订单群及其观察窗口。跨实例的费用合计必然性表述也未获准泛化。原SAP方法v5保持未发布/HOLD，不从验收分母删除。

独立评审仅批准原A的独立计算范围。执行者通过原公开预览/发布入口另作明确限定决定：六源准确修订（business3/concept5/rule7/ontology3/binding2/strategy5）与canonical `store-payment-refund 0.5.0`，排除方法及其关联场景用途、建设试算答案和过程文件。真实模块结果仅为studio-source与sap-metric succeeded；没有SAP方法发布。之后另作官方构图，选中快照 `08a0d22b-21ee-4541-a104-825e834d6bbe`，并在另一个新普通项目明确采用0.5.0。三项分别有实际回执和非作者核对，不把前三条建设use算成普通使用。图的receipt/graph/ontology字节及来源闭合已核；完整临时构图输入不在冻结包内，原字节重算范围限制保留。

### 普通A首次：金额正确，重要主张FAIL

普通A是新项目/任务，只接原始brief和四个CSV、准确正式源及原SAP供给，没有复制建设聊天、脚本或答案。首份报告、回复、native及过程输出在反馈前冻结。非作者独立核原始事件并从头重算，完整性、主金额、差额/变化率与事件选择共440项只读检查通过；另由全新上下文复核员重算敏感性主张。未见越界读取建设文件、旧答案、B或gold。

首份整体仍为 **FAIL**：回复把两期口径间退款本金的多计/少计方向均说反；报告混淆完整事件分区与入选并集的数量，把一侧独有集合数量当两集合净差，并错接差额归因。报告宣称六源正文均已逐份读过，实际只有business/rule/strategy正文及准确SAP完整读取，另外三源仅有索引、限制和Ref；不要求全读，但不能虚报。报告又把已准确发布并被本项目采用的0.5.0说成未发布/未采用，与实际回执及自己的publishedHash冲突。

另发现工程供给缺口：普通上下文传入旧建设进度及资产自身限制，没有传入准确限定发布记录、方法HOLD、场景未就绪及跨实例限制。不能把普通Agent未收到的限制当它已违反，也不能以正式端保存过限制推断已送入。该缺口另以D3补修；业务叙述、数量及已读声明错误仍归原首次结果，不由Host补计算或代改报告。D3后未新增真实模型请求，其工程复验不能覆盖为专业PASS。

### B维护：新映射已有局部成果，完整候选HOLD，再用NOT_RUN

反馈由普通A实际原生session/message绑定发起，准确关联原报告/版本；保存反馈前后原建设lastRun不变，证明没有自动启动。再通过明确请求由原建设Agent接手，交付预封B的新说明与唯一新退款文件，同时说明此前已封的方法条件和跨实例资格缺口；没有把尚未封存的普通A评分细节注入维护。原A报告保持。

维护形成business4/concept6/rule8/ontology4/binding3/strategy6、SAP0.6.0与方法v6及新预览。65份阶段证据全部匹配，源码仍为原冻结候选。独立准入发现实质错式：把两口径独有事件的费用差额写成对称差上费用的普通合计，实质上把相减改成相加；当前实例亦触发。错误进入指标definition/provenance、方法、部分源及预览，不是单纯措辞，也不能只排除方法就作为完整新版发布。

预览 `63f65658-a9dc-498f-b7d4-7368d693496c`、SAP0.6.0及方法v6均 **HOLD/未发布**。business、binding、本体的新来源映射可保留为局部候选成果，不能代替完整两核心题。按预封停止规则，不再推广或新增付费修订，B发布、B采用、B图刷新及第8个普通B请求均 **NOT_RUN**。未用失败候选作再次使用，也没有以工程绿灯宣称回补问题已解决。原Host在阶段冻结后正常关闭，不是取消本次自然完成任务。

### 最终专业范围

| 项 | 本轮结论 |
|---|---|
| FA01 建设 | PARTIAL：真实源建设、官方文字抽取/结构化构图及局部映射已证；完整方法/泛化质量未通过。 |
| FA02 发布 | 限定A两模块发布、准确采用与构图的事实PASS；方法与B保持HOLD；普通供给缺口D3另作工程补修，不继承实模PASS。 |
| FA03 普通使用 | 首次整体FAIL；金额/事件选择与实际SAP/三源正文使用有PASS子项。 |
| FA04 回补再用 | 原native反馈与原主Agent接手已证；维护核心候选FAIL/HOLD，再发布及新普通再用NOT_RUN，问题解决未证明。 |
| FA05 等待/接续 | PARTIAL：原业务答复保持、同任务续建、反馈不自动启动及显式接手有实际证据；其他未触发状态不推PASS。 |
| FA06 首期完成 | 未完成/NOT_PROVED；两题及四段范围保持，未删去失败项。 |

**真实模型完整专业验收未通过。** Git/CI与两机工程采用按用户分别授权执行，不能写成完整产品验收或经营效果；未发布失败资产和合成验证项目不导入正式根。

本轮唯一3个native会话、291个带usage的assistant frames；input1,038,820、output482,074、cacheRead79,160,782、totalTokens80,681,676，reasoning174,603是output子项不再加总。SDK目录估算cost1.6227827822，供应商结算UNKNOWN。三轮共9个主业务请求，17个唯一native会话、401个带usage的assistant frames；取消/拒绝/工具错误与未跑分开保留，不将帧数当供应商调用数。原settings/auth前后摘要不变，未自动充值、切换Provider或模型。

私有证据：`runs/live-third/*/evidence-frozen/manifest.json`、`A-formal-evidence/manifest.json`、`usage-third-final.json`、`source-configuration-preservation-final.json`；非作者`ordinary-A-first-review-freeze.json` SHA `7f9e8b34e9ae14b362dc0ebc681a323ad0eda89c043eb93fafc50a05835bbadc`，`B-maintenance-first-admission-freeze.json` SHA `a15170b9a10acebdec347abedf6ab76417597f92a3e7c412481867e0d6cea13a`。源码补修、工程验收、实际Git/CI及双机采用另按本变更结果和对应PR收据核对，原始日志、会话、模型配置和私有真值不进入公开Git。


第三轮最终非作者总封：**整体FAIL，局部PARTIAL，完整闭环NOT_PROVED**。FA06按已证实核心失败记FAIL；不能把“未完成”误读成只是未测试。B原始行到两个作者计算输出的672项独立对应通过；维护报告197项中196通过，另1项重要事件数量事实错误。新映射与重算的PASS子项不能抵消错式及该错误。原A项目文件、25份旧源版本、旧0.5.0源稿和原问题/答复均逐项保全。D3实际修正版真实模型测试NOT_RUN，不继承先前局部专业结果。最终报告SHA256 `8e87c2952f2b1b8bff1fdf9282209a2c1ecbca8448f18cfa57a617b1bbdbe9f2`，总封`professional-final-v3-freeze.json` SHA256 `8e3d2bdcd37da195f781899396c23ccf8c49c6c6df33e093daa239d3f45435e3`；全部首次冻结读回一致。

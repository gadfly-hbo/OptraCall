# S5 工具参数修正与续测方案

> 当前结果（2026-11-06）：原19次真实任务及16条正式链已全部关闭并完成独立评价。原T010–T019已在19次总上限内续测结束。本页保留9次关闭时的历史修正方案；下文“当前9次／尚未续测／正落实源码”等不代表当前状态，“建议新批两开放冒烟”是未采用的原建议，本轮未追加新的真实模型开放任务。工程受控复验不冒充真实模型样本。完整同候选收益仍未成立，当前结果统一见[S5能力、缺口与结果](s5-results.md)。

2026-11-05 · 原型非作者复核通过 · 按原19次上限落实修正并续测

## 已核实的阻碍

当前9次真实任务已关闭：2条开放冒烟、7条正式链。原报告、首稿／修订版本、native、usage与未见金标准全部保留；后续尚未派发。原S5.1独立环境、原Store／准确Ref、Semantica查询、SHACL及维护检查仍按各自证据成立，不由此推定真实模型已正确使用图语义。

锁定Pi1.4.0的非strict Anthropic参数转换仅取顶层properties／required。应用的旧目录、合并语义及managed graph-only参数均为顶层Type.Union，因此实际发出的input_schema只剩空object。使用准确MiniMax M3.1 Flash原生能力映射、本地合成Provider和原SDK实抓三种schema，全部复现；没有使用真实凭据／外部Provider或增加真实任务。证据为执行根的anthropic-tool-schema-capture-v2.json及对应脚本。

现有工具描述已经按实际graphReader包含图能力，不能从基底legacy描述行推断最终缺少说明。本次修正聚焦参数声明接缝。旧结果可以作为实际运行及问题诊断证据，但不足以代表参数完整传递时L2的比较收益；不能把报告保存、直接调用未观察到或少量已运行样本拼成整批专业通过。

## 最小修正原则

原工具名、业务参数语义、原完整分支校验、返回content、owner／profile、当前源资格和原Resource生命周期保持同一合同；不更改Store、图结构、模型／线路／thinking、分析方法或用户操作。只修正模型实际收到的参数描述，不把工具选择和计算交给Host。

推荐并已用原型验证原Pi公共的出站payload变换入口：从原schema派生可见object字段，registered原参数及SDK验参不变，按当前真实可用工具处理，不注入未授权工具。不得通过强开供应商strict能力、依赖补丁／升级、代理或新Runtime绕过。

原型已发现“直接把properties加回registered union”会改变SDK optional-null预处理，故不能只凭TypeBox／AJV等价宣称修复。实际SDK接受及转换后的参数、原始分支和真实出站payload必须一起验证。该失败原型与后续备选保留，不静默应用。


### 实际原型结果

| 路线 | 实际结果 | 决定 |
|---|---|---|
| 给registered union直接补root字段 | TypeBox／AJV看似等价；实际SDK optional-null预处理在120组中有16项接受／转换差异 | 不采用，原反例保留 |
| 给optional投影加null分支 | 120组SDK行为等价，但会向模型额外广告null，仍须由原分支拒绝或转换 | 仅保留备选及限制，不推荐 |
| 公共before_provider_request只改已序列化payload | public createAgentSession实际到loopback；3schema字段恢复7／14／11，六图操作可见；registered参数同一引用／JSON／symbols未变，120组SDK接受及转换结果0差异，无额外null广告；前置追加工具和原payload保留、无原位修改 | 推荐；原型非作者复核PASS_PROTOTYPE_ONLY，正落实源码及适用检查，尚未真实续测 |

建议补丁只在原environmentExtension接5行公共handler并新增35行纯payload helper；不改原graphDescription，不改任何参数定义、原校验或权限。原型类型检查通过。完整[原型／反例](../../../.local/fourbase-l2-s5/run-20261105T121254Z/prototypes/semantic-union-wire-v1/README.md)及[建议补丁](../../../.local/fourbase-l2-s5/run-20261105T121254Z/prototypes/semantic-union-wire-v1/suggested-serialization-only.patch)已固定；补丁SHA256为ebb8985e9311f16c8e20fecf57c5bcd4cb8866609e72b77707c229fba1414f80。

原型只证明本地出站和验参接缝，真实MiniMax是否接受并自主使用仍须修正后冒烟／正式研究，不能预写通过。建议新批两开放冒烟先以实际图资产查读为工程目标，正式对照保持普通业务问题与Agent自主选择；图查询不是普通用户必做步骤。

## 修正验证

1. 原准确SDK／模型能力映射的本地实际payload：unmanaged旧目录、unmanaged合并语义、managed graph-only均见完整可用字段及六种图操作。
2. 原TypeBox／AJV／SDK验参的合法值、缺必填、跨分支、未知字段、非法类型／null及转换值保持原行为；实际可授权输入不扩大。
3. 普通两模式、受限角色无扩权、所有现有消费者与完整工程检查；新候选固定后再进入真实请求。
4. 非作者复核修正范围、原失败／原候选保全和实际wire证据。前端无新增页面或用户必做步骤。

## 当前获准执行安排

用户其后明确：“minimax Flash 的5小时额度目前足够，若需测试可直接调用”。据已确认S5工程范围及此继续执行指令，本次先落实上述最小接缝修正与适用检查／非作者复核，再在原19次累计上限内续跑原未执行T010–T019。已有9次不退款／不删计数，不另增加真实任务；题面、合格材料、金标准、原first／repeat身份、自动核算maxAuthorTurns=1及原16正式分母不变。

修正前9次（2开放＋7正式）属于v2候选，余下最多10次（9正式＋1取消）属于修正后v3候选，逐条保留两种软件身份。专业正文可按原固定标准逐稿核对；收益按候选分批描述，**原“完整六变体同一固定候选”条件已不满足，必须保留NOT_PROVEN，不将新旧结果混成全量收益通过**。若后续确需完整同候选对照，再把追加批次及总次数作为独立建议，不由本次指令暗增。

旧草案曾比较“新增完整19次，累计28”与“剩余次数重组三对”；两者均未提交为用户决定，也未采用，原草案保存在执行证据s5-schema-fix-plan-unadopted-ab-draft.md。当前不改原任务顺序、不缩换题集、不登记用户选A或B。

继续使用现有MiniMax配置及原新增现金支出共用上限100元、S5独占订阅、续费关／无接续积分包事实。额度足够即直接调用；耗尽后按用户要求等待北京时间11月6日00:00的已付窗口自然恢复再继续，不新购、充值或切按量／fallback。

Git／CI／合并、现有服务、其他设备、真实经营资料和S6边界不变。仅完成必要修正及检查后才继续真实任务；不把原型PASS或两种候选混合结果当完整S5／产品验收。

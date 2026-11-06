# S3 有限资产建设进展

## 当前回执：D12批准后实施（2026-11-05）

用户已确认D12七项全部A并授权完成S3剩余工作。本轮已完成私有装载／来源保护及实际3核心＋1方法的小本体／带源图，详见[S3验证报告](s3-validation.md)。当前run为`.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T075754Z/`，54节点／63边、8类候选本体、337位置映射；准确原Store读取、六类15项查询断言、修后完整45项回归及实际全图六例SHACL正负例均已执行通过。独立规格v1发现的部分方法依赖未拒绝、原字节副本缺失两项P2已修正，原发现与旧快照保留，新候选及受影响独立复验分别核定。

当前来源停用／恢复、方法confirmed错误筛选与旧历史保留、企业准确修订更新后新代重建及旧快照hash保持均有实际原Store证据。最终独立规格／标准与四原则复核、候选身份及保全读回由本run/evidence中对应报告、closeout.json和final-static.json核定，不以作者结果预写未完成的复核。S4未开始，无产品Host／Pi接线或真实业务效果结论。

以下原进展及D12待确认措辞保留当时历史；当前批准／实施状态以上述回执及验证报告为准。原文完整副本另存本run/evidence/before-s3-progress.md。

---

2026-11-05 · S3进行中 · 原合同资产已在隔离库生成；新派生结构D12待确认

## 1. 实际完成与停止位置

用户已授权S3的3核心指标＋1方法＋对应小本体／带源图，且要求先落实准确版本核对、有效来源筛选和加载失败处理。本轮已完成可直接复用原合同的资产部分及相称工程核查：

- 3指标沿原SAP0.2 validator和library实际校验／同包发布，方法沿原Store实际保存后发布，已取得真实ID／版本／hash。
- 仅获准脱敏资料与SC-01S合成输入，在显式隔离根创建原企业资料修订、合成项目、固定输入及M2说明，337个实际位置映射已保存；声明／映射均未伪填业务确认。
- 核原生准确版本、发布hash、保存≠发布、错误治理及损坏发布物；用明确限定的工程来源回调核错hash、当前来源禁用和nullable hash。未把原Store已有行为算成新图装载器已完成。

**S3尚未全部完成。**新增图／本体的具体派生表示、来源准入与装载器需先确认[D12增补包](s3-structure-addendum.md)。这份增补只补此前未定的持久字段／布局与生命周期；已确认的场景、阶段、原SAP／M2合同不重审。未创建D12快照、未实现其装载器或宣称完整首切片通过；S4未开始。

## 2. 实施与运行边界

工作树仍为`codex/four-base-L2@57742b99d173bfa6413e83705682b0444359add4`；只读远端重核main仍为`2b9800bc181b9477109c28c85ab46057ee74243d`。没有fetch／merge／切分支或更新其他工作树。

为运行已交付方法模块，本轮用Git对象将固定2b9800bc的原Store／validator及必要源码投影到本轮隔离run；实际Node25.9.0直读未修改TypeScript，只在该投影安装validator所需yaml2.9.1。此为工程源代码复用，不是活动工作树升级或服务采用；对照实际Git对象的完整性证据留本run。

隔离根：`.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T072031Z/`。原Store的dataRoot显式为`asset-root/`，projectsRoot为不重叠的`projects-root/`；未调用createHost、配置库／SDK会话、模型、产品服务或其他设备。合成项目的配置只是`synthetic-not-invoked`／example.invalid元数据，无凭据、Provider请求或模型执行。

原Semantica0.7.0和S2结果保持；本轮没有改包、安装Graphiti或另建Runtime。源码、UI、原schema及S1／S2证据不因本轮资产准备变更。

## 3. 三核心与方法的实际资产

可审阅内容：[SAP草稿](assets/sc01s-core.sap.json)、[方法四组正文](assets/sc01s-method.content.json)。后者与S1四组正文逐字一致；原企业附件未读取／复制，真实主体身份、原业务编码和版本未迁入。

| 资产 | 隔离发布身份 | 含义与范围 |
| --- | --- | --- |
| C02 | `optracall-sc01s-retail@0.1.0 / terminal_sales_amount` | 终端成交额，simple；支付归属、退款前金额，保留未迁入特例与合成限制 |
| C03 | 同包／`retail_refund_amount` | 零售退款额，simple表达本样本分类事件总额；5类来源组成仍保留，样本仅2类不推出现实其他类为零；按原订单支付时间／门店归属 |
| C04 | 同包／`net_retail_sales` | 零售额，derived表达C02−C03；同口径条件、金额分解与因果区别保留，无直接净额原始字段 |
| MTH-01 | `sap-method:9e8cc37d-46ba-4e63-b14f-d617f82af3cf@1` | other／manual，conditions／logic／judgment／limits；原Store先保存再发布，内容不固定Agent工具或步骤 |

指标包namespace沿现validator为`mf.optracall-sc01s-retail`；draft package fingerprint为空，经preparePublication计算后才入库。发布包字节SHA-256为`1b368f8991b31a87d3021d6d0e9fc436835b65cf93da092a8d0b9e40184f94a5`；方法内容SHA-256为`d3f9370863d758d4194205687898541918e8a6df0a5a1c764c50f334cdcaa456`。它们是本次隔离资产版，不是企业原编码／版本或运行环境已启用版。

原生[指标发布字节](../../../.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T072031Z/asset-root/metric-assets/optracall-sc01s-retail/0.1.0.sap.yaml)、[方法版本记录](../../../.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T072031Z/asset-root/metric-assets/methods/9e8cc37d-46ba-4e63-b14f-d617f82af3cf/versions/1.json)与[保存／发布回执](../../../.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T072031Z/evidence/asset-receipt.json)互相核对。项目启用／运行导入未做，scenario.method_refs保持空string[]，没有把方案代号当已解析的准确方法Ref；方法实际Ref另随原回执保留。

## 4. 原企业资料与M2的实际材料化

原EnterpriseMaterialsStore内建立的是**脱敏摘录＋S1工程说明的资料资产**，不是虚构企业背景或新的业务权威。正文区分获准源摘录、历史S1设计及工程字段说明，未迁入主体特例的限制保留；资料启用只表示隔离工程可读，不代表企业口径核实。

原ProjectStore／M2生成的实际身份为：

| 对象 | 实际ID |
| --- | --- |
| 合成项目 | `ef6a2fe1-3366-411f-85c3-de5da3099bf8` |
| dataset／input版 | `ca201f44-a03d-4a42-b1e0-c28962eabc63`／`394dcc76-2143-46a3-bb85-49dec333f7d7` |
| M2说明版 | `62654ca5-6c83-4586-a875-9dffc6df75cb` |
| 企业资料store／material／revision | `cea7f296-5e68-4164-8cc1-353626ea55a9`／`2cd76e5d-4895-4560-9403-166e16c6a6fb`／`b25b8511-330d-4be3-96b8-c5953eba1312` |

固定输入仍为32订单／16退款的原SC-01S字节，SHA-256 `ec996f92bed8c18b5a9809760827a59ddde85d115ad905df96a3dfac7f63372d`。337个不同JSON Pointer均沿原DataContextMapping写入，按实际金额、归属／关联、说明／工程控制位置分角色；C04不映成直接原始净额，控制数没有SAP净额Ref。

声明使用原row-meaning／business-time／field／source-and-limitations；provenance为agent-inference，业务confirmed保持false。observation明确unobserved／unknown，未伪造产品Agent扫描／采用记录。实际回读和检查见[M2回执](../../../.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T072031Z/evidence/m2-receipt.json)。历史S1中“未发布”等语句是来源当时的工程状态；本次准确发布状态以原SAP／方法Store回执为准，不由旧正文推定。

工程回调仅绑定本次原SAP准确查读／hash与原企业资料enabled／准确修订，拒绝非空native／artifact evidence；没有导入依赖SDK的原完整Host references模块、没有伪造native证据或no-op校验。因此该回执不证明完整Host来源模块／真实owner权限已接通；S4继续按原入口实现和验证。

## 5. 首切片已有证据与未完成内容

| 内容 | 本轮实际结果 | 保留边界 |
| --- | --- | --- |
| 准确SAP版及内容 | 正确发布版可读，原字节hash核对；不存在版本明确LIBRARY_NOT_FOUND，不回退最新 | 新派生快照的准确身份／hash尚待D12后实现 |
| 方法保存／发布 | 保存后getPublished拒绝；错expectedSha256拒绝；准确发布后读回；不存在版不回退 | 不改变原历史可读与默认推荐的区别 |
| 错误治理 | 在独立反例副本确认方法错误，listPublished排除；准确旧版仍返回issue；原资产保持无该反例issue | 不是图新查询已实现过滤，也不是所有调用仅凭state就安全 |
| 来源有效性 | 独立反例根禁用原企业资料，工程回调拒绝新来源准入；历史准确修订仍可读，原库仍enabled | 不是原Host实时权限／新图声明级过滤已通过 |
| hash可空 | 本工程SAP Ref callback接受原合同null值；实际已知发布hash固定核对；错误hash拒绝 | 不新增全局非空门槛；原完整Host callback尚未接入 |
| 损坏源文件 | 独立副本损坏SAP发布物，原library明确LIBRARY_CORRUPT | 不等于Semantica图／receipt加载器已修复空图ready，后者待D12 |
| M2固定输入及说明 | 原Store实际冻结／保存／准确读回，337位置及4组声明均未业务确认；输入hash不变 | M2原校验不执行JSON Pointer／join／汇总；位置解析和关联沿S1已核材料，实际Agent计算仍未运行 |

原合同检查见[保存／发布／版本／损坏与治理](../../../.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T072031Z/evidence/existing-contract-checks.json)。原生Stores运行是工程核查，不伪造产品RED，也不把已有保护记成新增代码实现。D12确认后的新装载器／筛选器会单独保留真实RED→GREEN。

## 6. 初始失败与恢复保全

- npm首次把user/global配置同时指向/dev/null，本机npm拒绝同一配置重复加载；仅改为run内两份独立空配置后安装yaml成功。原日志／结果保留，不改全局npm配置。
- 资产脚本首次上溯路径多一层，读草稿前ENOENT；未写资产。原脚本及当时工具错误摘记保留，修正后沿原Store完成保存发布。
- M2首次因field声明没有具体location而拒绝，已冻结的输入和项目保留；补原合同要求的位置后继续原项目／输入，不重新冻结或盲重放。
- 说明已成功保存后，反例脚本误把EnterpriseMaterialsStore.directoryPath（catalog.json）当根目录复制，反例读取报enterprise_index_missing。该失败现场保留；随后仅回读已成功保存说明，在新反例根复制原Store.root完成禁用核查，没有再次保存说明、没有覆盖旧失败副本。

完整脚本、stdout／stderr、process结果、native资料与初始文件身份在本run；没有清理／覆盖历史FAIL或把进程返回0等同业务／产品成功。ProjectStore已在finally关闭，其隔离锁收尾另核。

## 7. 接续安排

下一步整体确认D12的7项推荐后，在同一S3范围完成新的来源准入、加载保护、本体／带源图、六类查读与实际图必要约束、源更新／失败恢复及独立复核。运行采用、真实业务、模型质量与S4接线仍不提前。

本次固定候选、作者核查与全新非作者规格／标准复核位于run/evidence；最终结果以对应报告与final-static为准，不预写尚未返回的复核。当前**已进入S3，但未完成S3，且新增派生结构处于待确认边界**。

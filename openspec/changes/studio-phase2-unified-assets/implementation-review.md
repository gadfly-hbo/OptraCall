# Studio 二期实现非作者独立复核

结论：对下述固定代码候选，未发现未处理的阻断问题；11项实现／兼容发现已由原作者修复并复验。独立冻结定向组115/115 PASS、0 FAIL、0 SKIP。根执行的完整仓库check已实证PASS，日志与55代码无漂移已独立回读；67项SKIP保留，不扩大为专业或用户产品验收。

## 身份与范围

证据基准目录为项目根下`.local/studio-phase2-implementation/independent-review/`；本文未写完整路径的证据名以此为准，`../`指其上级工程证据根。保存到OpenSpec的副本沿同一证据基准，不按副本位置重解释。

- 复核者未参与产品候选任何部分创作；产品源文件、Git、服务、依赖、正式业务资料保持只读。仅在本independent-review目录写报告、合成隔离探针及证据。
- HEAD：d587f177ec5e666d6fcd99e542b97ccea06fbc53。
- 冻结候选：../candidate-before-final-check.json，SHA-256 `94ced00aab68de4c888fd20d44f23b19b25ee6d8e48e6314a9f1d99408f95511`；81/81文件和55/55代码摘要均实际回读匹配，见frozen-readback.json。最终仅补文档结果时，55代码身份须继续一致。
- 批准与旧包21份逐项回读原摘要均一致，见approved-inputs-readback.json；不改写旧设计的历史“待审核／不开发”状态。
- 已读当前AGENTS.md、工程规范、产品讨论稿v0.2、批准proposal/spec/interaction states v0.3、批准原型、tasks与implementation-contract。图优先发现，图未包含的新符号按准确文件回读。未以旧原型37/37或33/33替代实现验收。

## Standards

硬性标准违反：未发现。企业归属仅管理Host元数据；企业资料、SAP指标／方法和Studio语义源仍各持原权威，未另造专业主库。普通任务沿原公共会话／官方Pi、原工具与IPC取消资格；managed新增facet只读，不授建设、M2或Case写权。计算和专业判断仍由Agent工具执行，不引入固定专家流程、Host补算、SDK补丁、依赖升级或平行Runtime。维护使用真实新owner，原项目／任务／native不转移写权。

独立Standards子审见standards-axis.md：保留1项 **P3／possible Duplicated Code**，`src/host/studio-enterprise-catalog.ts`中企业所有权推导与legacy准入重复投影formal依赖和成功专业引用。现无行为错误，后续可用小helper共源维护；非硬违规、非阻断，不要求为其增加策略框架。

## Spec

下列为产品工程核定；模型自主性和业务正确性边界另列。

| 批准需求／决定 | 核定范围 |
| --- | --- |
| SU01/04/05/12，D01/03/08 | 统一三视图、原专业编辑和准确历史；原任务／原来源链接按原生ID＋准确版本进入同一详情；待核只读查看不建立归属。截图视觉抽查见下文。 |
| SU02/03/10/13/15，D02/05/07/09 | 同企业正式目录默认供给，未归属不自动认领；foreign目录、正文、写入和使用反例拒绝；当前资格与精确历史读取分开，无合格来源仍保留原授权普通分析。 |
| SU06–09/11/24，D03/04/06 | 自然语言建设沿项目任务；普通任务贡献保留原报告／来源／base；本案例外不直接入库；准确关联、base冲突、预览快照、分项结果与维护新owner。跨体系同企业正式来源准确路由，外企／候选／问题版／失效依赖／旧base仍拒绝。 |
| SU16/17/18/21/22/23，D05/07/08/09 | 目录、正文片段／完整性、准确版本、作者声明与独立核验分别投影；实际Host／官方SDK／合成Provider／原文件计算工具贯通两主题合成再用和旧依据保全。脚本Provider驱动不证明真实模型会自主正确选材或计算。 |
| SU20，D09 | 沿原绑定Case、本turn回执及逐写资格；无绑定／无写口不猜Case、不阻断分析；hypothesis／strategy草稿与人的采纳／行动／效果分开。此处为源码及原兼容测试范围，非真实决策专业验收。 |
| SU14、SU18/19/23的会员专业结果 | 用户明确要求先产品、后会员主题。实际会员资料核定、企业会员正式资产、真实模型自主应用与专业解释、新版专业再用均NOT_RUN；合成销售／售后工程计算及旧结构fixture不代作该验收。 |

### 原发现及处置

原失败和复现细节完整保留在findings-initial.md及对应before证据，未用修后通过改写原失败。

| # | 原发现 | 冻结候选处置与核定 |
| --- | --- | --- |
| 1 | direct指标查到准确目标就清除原UNKNOWN并走onPublished成功关联 | 原请求未知与原库目标存在分开；不自动关联、不从目标存在伪造原成功。标签页尝试元数据保留准确意图，明确保留未知离开／重开／只读GET；同版本不盲重发。元数据不是原生主库回执。 |
| 2 | 普通反馈systems目录忽略projectId而露外企体系 | 真实项目校验＋availableFor过滤；无query仍为显式管理目录。冻结Host／client测试通过。 |
| 3 | A项目direct指标导入先推进B资产，再在后置关联报冲突 | Host原发布接缝写前核原企业；共享mutation gate内记录首发归属，归档来源和未核企业不写。独立after探针409且B current保持1.0.0。 |
| 4 | 审核后路径变更会发布未审新内容／版本 | UI送真实expectedPackageFingerprint；原专业校验器比对准确候选，变化409且不写。独立1.1→1.2 drift探针已拒绝。 |
| 5 | 原专业引用仅认显式assetAssignment，误拒正式来源推导的企业归属 | 共用准确foundation归属解析；不以别版／歧义owner替代，不为查阅另写关联；取消／迟到保持。冻结client／UI测试通过。 |
| 6 | 待核资产需先关联才能查看原件 | 同工作区只读原文／准确版本查看，未决定可返回；无建议证据如实说明，不授普通消费资格。已抽查实际Host截图。 |
| 7 | Case／link原生完成后scope写失败，重试吞掉incomplete | 原Case操作回执保留Host首次scope意图；null／legacy缺省不由后来默认重解释；重试修原关联，不重复原生创建／link；冲突与不完整继续真实返回。独立恢复组通过。 |
| 8 | A资料类别下拉从全局材料取B类别 | 类别与行共用inScope筛选；当前企业、待核只读和空库分别核。 |
| 9 | confirmed方法当前Agent拒用门误用于人工固定历史回看，原文变空 | 仅人工固定来源复核走明确human-fixed-preview；实际精确scope／身份继续核，原归档value.text不换，当前治理另列。原SAM03/09断言未改且独立PASS；当前Agent错误方法拒用亦在冻结组PASS。 |
| 10 | 同企S2正式来源向S1贡献时被当成S1来源查询 | 按准确locator路由原体系；跨体系只取正式资格，原issue／hash／依赖／权限仍核；Store核外部当前formal base。独立原probe贡献已成功，source原身份保留；候选、外企、legacy隐式授权和base漂移反例通过。 |
| 11 | UNKNOWN暂存只认裸hash，真实sha256:指纹不能恢复 | 按原SAP校验器真实指纹格式恢复。独立真实fixture preparePublication roundtrip保持原attempt不变，见unknown-fingerprint-format-after.json；storage故障不发POST。 |

另按根要求沿实际链核“贡献纳入”与SAP部分结果：贡献只有linked/revisions，无integrated状态；预览含贡献不等于发布。SAP UNKNOWN不使该SAP分项变成功，UI准确分项统计保留UNKNOWN，故未据该假设增加实现或新状态框架。

## 独立验证与审阅证据

- **冻结独立组115/115 PASS、0 FAIL、0 SKIP**：`node --test tests/studio-phase2-*.test.ts tests/studio2-*.test.ts tests/metric-publication-pending.test.ts tests/sap-methods-host.test.ts tests/s4-runtime-sdk.test.ts`。完整输出frozen-targeted-tests.log。
- 前期74/74、边界组38/38、恢复／专业发布组14/14、原SAM03/09 1/1分别保留；不把重叠数累加成新覆盖数量。
- 3项自编隔离探针：foreign指标、审核路径漂移、跨体系贡献，before与after分别保留；UNKNOWN真实指纹恢复另有before／after。探针只写本目录随机合成根，无真实资料／模型／服务采用。
- 16文件consumer v2与4文件Case恢复manifest独立回读均无差异，见child-manifests-readback.json；最终全局候选绑定优先。
- 已读root真实Host+React浏览器记录real-host-review.json、cold-frozen-review.json并视觉核对8张截图：桌面、专业方法、发布与使用、贡献来源、待核只读、390窄屏浅／深及冻结冷启动。未见本次截图范围内布局阻断。操作由root执行，本复核者独立抽查证据和图片，未自行重跑全浏览器操作矩阵。
- 原Vite HMR useEffect依赖数组变化warning原记录保留；冻结Host重启＋新标签页冷读记录consoleErrors=[]，不把旧warning删除或移作冷启动错误。
- 新增UNKNOWN浏览器用真实SAP0.2 fixture和真实带前缀fingerprint；已审其导航保留／reload／GET-only／不关联／同版不重发、known响应清理、storage-denied 0POST证据。它的网络故障是受控浏览器场景，不是实付Provider或生产Host网络故障实验。

## FAIL／UNKNOWN／NOT_RUN与后续边界

- findings-initial.md、before探针、root check-second失败及原测试／fixture问题保留。某次后续PASS只覆盖其准确修复与固定候选，不抹掉原FAIL。
- direct指标没有原请求operation receipt，标签页UNKNOWN只能保留并查看原库准确目标；目标存在不证明原请求成功。标签页暂存不承诺跨浏览器、跨设备或关闭标签页后的持久恢复。
- 目录供给、实际工具正文、作者使用声明、计算材料、独立核验、用户采纳、实际经营行动及效果仍是不同事实；未提供的专业核验不补造。
- 真实LLM／会员主题／真实企业业务数据／专业正确性／Product Acceptance／Git与CI交付／部署及运行采用／MacBook均NOT_RUN于本复核。原官方SDK工程接线、脚本Provider计算与原型不扩大到这些结论。
- 完整仓库check实证见下方附录；最终文档manifest回读仍待根提供，55代码保持本报告固定身份。


## 完整工程检查实证附录

2026-11-12，独立回读根执行者的`../check-final.txt`与`../final-engineering-receipt.json`：

- `npm run check` exit 0；开头确认为公共会话边界检查PASS，随后完整`tests/*.test.ts`，最后`tsc --noEmit`、Vite production build和build stamp均完成。
- 全量 **2193项：2126 PASS、0 FAIL、0 cancelled、67 SKIP**。67项保留原SKIP，并非全部场景已执行。根先前第二轮3项FAIL及完整原日志保持；最终0FAIL不回写它们。
- check-final.txt SHA-256：`705519e699170e51a7b070dab54116c59224705d2d9cf0dca52d00fcef489d84`，实际文件重新计算一致。
- 全量结束后55代码逐一再算SHA-256，均与`94ced00a...`冻结候选一致，无代码漂移。最终文档补记录不影响此准确代码身份。
- 检查记录列High/Critical依赖告警0、Moderate既有2保留；未升级依赖。Vite大chunk提示保留，非测试／构建失败，不为本轮额外切块。

这是根完整执行结果的独立读取核定，加上本复核者实际115项定向运行；没有把根全量命令冒称为复核者再次独立运行。固定代码候选的工程复核可通过，Git／CI／部署、真实模型及会员专业／用户验收仍按上文NOT_RUN边界核定。

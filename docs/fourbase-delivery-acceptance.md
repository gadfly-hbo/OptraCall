# 四库／双库交付与验收总览

2026-11-04 · **M1–M7已有分模块本地工程或准备结论；L1修后完整检查与产品UI完成，M8独立最终核收及Git交付按结果逐项记录。尚未据此宣称Git／CI／合并、运行采用或用户产品验收完成。**

本页按[整体方案v1.2](fourbase-doublebase-plan.md)、[工程规范](engineering-workflow.md)和[M8规格／结果](../openspec/changes/fourbase-m8-closeout/result.md)汇总。历史结果始终绑定各自候选；下表数字是各模块当时完整或代表检查，**不能相加，也不能替代当前整合候选检查**。旧记录中的“下一模块未启动／Git未授权”保留其当时范围；当前用户已经授权L1完成后接续M8、最新main整合、Git／CI／squash合并及干净工作区／handoff，具体执行尚待实际证据。

## 模块全貌

| 模块 | 已证明的范围与原结果 | 必须保留的边界 |
| --- | --- | --- |
| [M1 复用核查](../openspec/changes/fourbase-reuse-validation/result.md) | 21能力域盘点、Pi／原Store／业务入口复用结论；49项代表接缝通过、独立限范围复核 | 非全产品回归；第三方记忆候选未安装或证明兼容，文件缓存不等于产品采用 |
| [M2 多源上下文](../openspec/changes/fourbase-multisource-context/result.md) | 同任务连续材料／计算、固定输入与说明、轻概念／SAP引用、明确成果来源；939项／936通过／0失败／3跳过，真实合成Host／Pi／UI及独立复核 | 用户明确保留与补交Demo的展示差异；提供≠声明引用≠真实计算采用／专业正确，未追认为开工前UI确认 |
| [M3 保留与个人查找](../openspec/changes/fourbase-personal-retention/result.md) | 原资料正文与个人保留分权、精确来源和查找／修订／恢复；990项／987通过／0失败／3跳过，18组产品浏览器与独立限范围通过 | 初始UI全部前置行为RED仍**NOT_PROVED**；后补GREEN不补历史，真实断电／任意外部篡改／专业质量未证 |
| [M3.1 自主候选](../openspec/changes/fourbase-autonomous-candidates/result.md) | 同Pi原生候选、准确原文／治理与个人发现；1041项／1038通过／0失败／3跳过，功能及四原则限范围通过 | 用户只接受本模块部分动态UI前置RED的限定例外，**NOT_PROVED保留**；不外推M3或后续模块，不称完整TDD |
| [M4 复用可靠性](../openspec/changes/fourbase-context-reuse/implementation.md) | 自主find/read、可选固定选材、原native交付／历史与当前治理；1085通过／0失败／3原跳过，真实合成接缝／UI和独立复核 | 原始FAIL与流程证据限制保持；合法nested不保证独立子正文原生保存，没有证据时UNKNOWN |
| [M5 判断／策略](../openspec/changes/fourbase-case-decisions/result.md) | 准确判断修订、关系／反证、人的取舍和原行动／反馈；1130项／1127通过／0失败／3跳过，实际合成接缝／UI与独立复核 | 旧schema1程序不能直接读新v2库；兼容关闭使用支持当前格式的候选。选择、执行、反馈和效果分别记录 |
| [M6 经验整理](../openspec/changes/fourbase-experience-learning/result.md) | 跨事项准确只读、新来源／兼容、候选预填与可选单组草稿；1153项／1150通过／0失败／3跳过，重复目标修复经v3及独立复验 | 没有新学习模型／实验runner；共同基线与无增益结果保留，真实专业增益和经验成熟未证 |
| [M7 条件核查](../openspec/changes/fourbase-optional-engines/result.md) | 原条件评估／官方组件复用研究、非作者准备复核完成；用户当时无近期实际受阻任务，两分支条件延期 | 是当时判断，不能写成组件已采用；随后计算与L1的新增批准另按各自规格，L2未启动 |
| [M7 DuckDB第一版](../openspec/changes/fourbase-duckdb-phase1/result.md) | 原Pi/Python可选私有DuckDB／openpyxl、五类固定输入、原SQL／产物／来源；1304项／1301通过／0失败／3跳过，真实合成计算／重开／UI及独立功能复验 | 按[E01／E02／D04有限接受](../openspec/changes/fourbase-duckdb-phase1/accepted-limitations.md)本地收尾；原TDD／保全缺口／扩展默认承诺未满足、native配额FAIL保持；小样例更慢、RSS更高 |
| [L1 语义／关系／时间](../openspec/changes/fourbase-l1-semantic-trace/spec.md) | 用户已批准spec／UI及D01–D08全部A；实际查询与原M2声明工具、准确来源和可选UI已完成；修后83bb候选1370项／1367通过／0失败／3跳过，实际产品UI完成 | 原两P2已RED→GREEN并经独立源码复核无剩余必修；最终证据及四原则非作者核收、Git交付分别记录。原6b检查与失败保留，未混用为修后证明 |
| [M8 整体收尾](../openspec/changes/fourbase-m8-closeout/spec.md) | 已授权，整体覆盖、限制及1370项当前检查和产品UI已汇总 | 无新增功能／结构／UI；独立最终核收及Git交付继续，不从历史模块或准备PASS推导整体完成 |

## 哪些结论互不替代

| 对象 | 可作出的结论／当前保留 |
| --- | --- |
| 工程合成路径 | 实际Pi／工具／Store／UI可以验证接线、身份、固定字节和确定性计算；合成Provider只替换模型输出，不能证明自然语言召回、专业推理或经营效果 |
| 专业质量与经营闭环 | 既有[B/C专业评估](../openspec/changes/analysis-verification-reliability/professional-evaluation.md)及[自动链有限专业记录](../openspec/changes/automatic-verification-revision/lifecycle-supplement-result.md)的FAIL／UNKNOWN不由本轮改写；M8未新增真实Provider／业务材料实验。真实Case、负责人、授权材料和反馈安排仍另证 |
| 平台SKIP与环境失败 | 原Mac检查三跳过为本机不适用的unsupported-platform反向项及两项真实soffice/PPT渲染条件；不计PASS。最终本地／Ubuntu CI按实际各自平台计数，不能预写相同skip数量。fixture／导入／定位器错误不算产品RED |
| 流程与保全 | M3历史UI RED不足、M3.1限定例外与DuckDB E01／E02分开；旧缺口不靠重跑补造，接受不改原结论，不自动授予后续例外 |
| DuckDB治理 | D04为原权限／环境说明及显式连接设置，不保证任意普通Python全局强制禁扩展下载／加载。原native临时配额FAIL／NOT_PROVED、真实ENOSPC／RSS硬限未证，小样例无普遍性能收益 |
| Git／CI／采用／验收 | 本地检查、全新非作者、实际head CI、squash合并、main push CI、安装／运行版本和用户产品验收逐项记录。旧本地模块完成不表示已合并或已部署；产品验收须用户对明确候选作出明确结论 |

M8最终四原则检查须绑定实际代码、调用链、运行和产品UI：Host是否只管环境／治理；Agent是否仍自主选方法与纠错；是否复用Pi及原Store而无平行循环；正常新增必做操作是否仍为0且必要授权未被省略。当前最终证据栏和未完成项维护在[M8结果](../openspec/changes/fourbase-m8-closeout/result.md)，未完成前不标总体PASS。

本次授权不切换Mac mini运行服务、不操作MacBook、不读真实业务根／凭据、不调用真实Provider，也不安装接线Semantica／Graphiti。最终L1→L2交接应记录合并／CI／工作区实证、上述限制及[L2最小候选边界](../openspec/changes/fourbase-l1-semantic-trace/component-boundary.md)；新session先核真实设备、版本与WIP，handoff不等于L2安装或采用批准。

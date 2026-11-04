# M7 现有能力与触发评估

2026-11-04 · 只读源码／既有证据审计。不是引擎benchmark或真实业务需求穷尽调查。

## 计算分支

| 现有能力／边界 | 证据 | 对M7的影响 |
| --- | --- | --- |
| 原Pi普通任务提供bash／codemode及analysis-assets，Python沿原执行入口使用 | [project-session](../../../src/agent/project-session.ts)、[现有全产品盘点C05／C18](../fourbase-reuse-validation/capability-audit.md) | 多表处理不因未内置DuckDB而缺失；本轮不宣称验证了每个Python包／环境 |
| 多份输入可固定准确版本、原字节、hash及分析副本 | [project-data-context-store](../../../src/host/project-data-context-store.ts)的freezeInput／prepareAnalysisCopy路径；[M2决定](../fourbase-multisource-context/structure-decisions.md) | 新引擎不接管原材料权威，不复制新明细库 |
| 固定报告可关联准确输入、SAP／概念／native及CSV／JSON／MD／TXT／PY／SQL附件 | 同一Store的createCitation路径、[输入与成果引用类型](../../../src/host/project-data-context-types.ts) | 查询／参数／引擎说明先比较复用原.sql／.json成果附件，容器存在不证明某次计算正确或可重算 |
| 固定输入仅CSV／JSON、UTF-8、单文件10 MiB；成果附件有原容量边界 | 同一Store文件开头常量与校验；单文件10 MiB、报告与附件合计50 MiB | 是已证实的固定输入／引用能力边界，不扩大成所有普通文件／Python计算都受同一限制；无实际受阻需求时不自动引入Parquet协议 |
| owner、后台／并行计算、drain、取消／迟到、保存／恢复及UNKNOWN已有治理 | [Interface v3说明](../../../docs/agent-session-integration.md)、[project-session](../../../src/agent/project-session.ts) | 若将来接引擎仍复用原生命周期，不能另造执行队列或把封闭文本资源升级为全工具 |

[托管性能实验](../managed-execution-optimization/performance-result.md)针对固定合成负载的进程启动、文件读取和资源治理，长计算为哈希迭代；它不证明join／Parquet／SQL瓶颈。原并行资源增加与失败保持。[原专业评估](../analysis-verification-reliability/professional-evaluation.md)中find卡住原因UNKNOWN、算术／口径／解释FAIL，不能直接诊断为缺少DuckDB。

**结论：当前采用触发未建立。** 没有此次获准实际问题／代表输入、同条件现有基线失败或候选增益；也没有由本轮证据证明通用计算质量足够。未审用户或系统另装的全部包，未安装／导入引擎，未运行任何benchmark或模型。

## 关系与时间分支

| 现有能力／边界 | 证据 | 对M7的影响 |
| --- | --- | --- |
| 轻概念正文／别名／关系可读，精确字段到概念资料／SAP发布的映射 | [M2决定](../fourbase-multisource-context/structure-decisions.md)、[引用resolver](../../../src/host/project-data-context-references.ts) | 自然语言关系不冒充机器图；正式概念／SAP不移交抽取索引裁定 |
| 个人资料按标题／别名／范围找目录，再读准确正文、纠正和来源 | [M4 reader](../../../src/host/personal-context-reader.ts) | 不是完整语义召回；是否继续找读、比较或拒用由Agent自主决定 |
| supports／opposes／background／limits／derived_from／depends_on／action／feedback显式关系、准确修订、影响说明和人的准确策略取舍 | [M5类型](../../../src/host/case-decision-types.ts)、[service](../../../src/host/case-decision-service.ts) | 有实际可组合的业务关系，不是缺图组件就没有关系能力 |
| 跨Case当前卡片／人的choice目录、准确旧修订／choice及指定reference分页读取 | [CaseStore](../../../src/host/case-store.ts)、[M6来源服务](../../../src/host/case-sources-service.ts) | 无需绑定来源Case；继续复用原feedback／handoff观察期、适用性、局限与UNKNOWN，不换latest |
| 无通用实体消歧、自动多跳／传递推理、业务时间谓词索引；M6目录不覆盖全文和所有历史修订 | 上述当前实现的明确范围 | 是技术边界；尚未建立反复业务问题、组合基线不能完成及成本收益的采用证据 |

[M6实施与独立链证据](../fourbase-experience-learning/implementation.md)证明关闭Case／归档来源、准确反馈／指定handoff及缺原件UNKNOWN等工程接缝。它明确未验证真实语义召回、关系推理专业质量、业务Case可比性与增益，不能用其工程PASS补齐M7的业务trigger。

**结论：当前采用触发未建立，真实频次及专业效果UNKNOWN。** 后续实际问题出现时，先区分发现不到、准确读取失败、权限不足、推理错误或规模成本；不是所有遗漏都需要图数据库，也不能先认定现有组合总能完成。

## 技术分工与四原则前置核对

SQLite继续由原Case／Board各守业务记录；Pi native持原会话／候选，材料与修订仍原位。DuckDB是可选计算组件；Semantica是语义／上下文框架候选，Graphiti是另一关系记忆候选，不能把这些名字当作四库／双库必须落成的物理数据库列表。官方组件研究与本项目采用决定分开。

| 原则 | 本次实际处理 | 结论范围 |
| --- | --- | --- |
| Host管环境 | 只盘点现有工具／数据／权限／取消及证据；未增加自动切引擎或业务裁判 | 准备设计通过；无新运行时被认证 |
| Agent自主执行 | 原任务自主选Python／SQL、找读和比较；没有规定每任务先跑benchmark或某查询顺序 | 准备设计通过 |
| 优先复用Pi | 保留Pi1.4.0与原Store／生命周期，候选已有时间／来源等能力须先核映射 | 准备设计通过；组件兼容／性能仍未验证 |
| 减少人的操作 | 正常产品使用新增操作0；真实问题与授权在工程侧收敛，未新增日记、引擎配置或关系维护表单 | 准备设计通过；[UI适用性](ui-review.md)另记 |

用户在本轮询问后明确回复“没有”上述近期实际受阻任务；结合原方案门槛，本轮计算、关系两分支均条件延期，保留重新触发条件。不把当前无案例推成能力普遍充分或永不需要，不把延期记为组件已实现，不关闭原FAIL／UNKNOWN／NOT_PROVED，也不扩大为组件采用或进入M8的批准。

候选的准确官方能力、原生时间／来源／版本及模型与基础设施边界见[官方研究](research.md)。研究不能补足本项目采用触发。

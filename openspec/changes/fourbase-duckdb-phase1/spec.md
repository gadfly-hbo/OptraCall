# DuckDB 第一版：为 Agent 增加可选的本地计算能力

2026-11-04 · v0.2＋限定收尾修订 · **用户已接受E01/E02限定例外与D04增量合同，本地开发及验证完成；原失败、NOT_PROVED和保全缺口保留。** 批准原件／D01–D06推荐A及当前范围见[实施记录](implementation.md)，本次有效范围见[接受记录](accepted-limitations.md)。

用户已接受“通过现有 Pi／Python 使用 DuckDB，查询授权文件，SQL 和结果沿原成果入口留存”的方向；本包将其收敛为可实施、可验收的最小差额。具体D01–D06、持久合同及UI已整体确认，按推荐A实施；原准备证据与批准原字节保留。详细流程唯一按[工程规范](../../../docs/engineering-workflow.md)第2–4节；总方向沿[整体方案 v1.2](../../../docs/fourbase-doublebase-plan.md)。[原 M7 条件评估](../fourbase-optional-engines/result.md)保留为历史；用户本轮决定只开启计算分支的方案准备，关系／Semantica 和 M8 不提前。

v0.2仅补[五类输入合同与复用说明](formats-addendum.md)：CSV／TSV／JSON／MD按UTF8、XLSX按二进制原件固定；Agent自主读取Excel或原文，必要时整理为可计算表。原v0.1及其复核原字节保留，原PASS不自动覆盖本增量。

## 1. 用户能得到什么

用户继续在原项目任务中表达分析目标、使用已有授权材料。Agent 可以用 Python、DuckDB 或二者混合完成多表关联、筛选、汇总；也可以完全不用 DuckDB。它自行决定 SQL、关联键、业务口径、执行顺序和核查。Host 提供锁版依赖、原权限／资源环境及成果留存，不按文件数或问题类型强制切引擎、补跑计算或自动替换方法。

原对话／项目文件仍是主入口。结果旁可按需“查看计算依据”，查看**实际已记录**的输入版本、SQL／脚本、参数、实际引擎版本、结果文件和原生记录引用。正常分析无需选引擎、手写 SQL、填机器身份、确认每次普通读取或维护数据库。可选来源留存继续沿 M2 的原“记此稿来源”入口；未做固定留存不能显示成已有长期固定副本。

新增的是可用方法及可追溯接缝。已安装不等于实际采用，执行成功不等于业务正确；更快／更省资源须同输入对照，第一版不预设收益比例。

## 2. 固定现状与复用依据

确认前核查时远端 main、本机 main、origin/main 及干净 main 工作树一致：`8425ca159bc674b73ad54b80ce523a93b4f3b900`，tree `67a8a14bcd7606df74407f5a6dcaffc58ba119f9`。当时开发分支为 `codex/fourbase-phase01-design`，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9` 加 M2–M7 WIP；当时两者未合并。本次已在独立最新main候选保全整合，原树保留，准确进展及保全限制见[实施记录](implementation.md)。确认时入口矩阵、原规则与候选规则分别见[现状及复用审计](baseline-and-reuse.md)。

| 入口 | 核实的当前合同 | 已批准差额（实施中） |
| --- | --- | --- |
| main 普通项目上传／010→020复制 | 22类扩展名，每件50 MiB；上传保存字节，不保证解析 | 保持；不新增上传类型／提升普通上传上限 |
| 当前分支 M2 固定输入 | 020 内 UTF-8 CSV／JSON，每件10 MiB，准确版本与分析副本 | CSV／TSV／JSON／MD为UTF8、XLSX为原二进制，均每件50 MiB |
| 当前分支 M2 来源成果／附件 | CSV／JSON／MD／TXT／PY／SQL，每件10 MiB；报告＋至多19附件合计50 MiB | 增 TSV，每件50 MiB；报告＋至多19附件合计100 MiB |
| M4 模型可见文本、M2 上下文及 native 读取 | 各自的文本／快照预算 | 保持；不得把整表塞入模型或静默提高其他入口预算 |

1 MiB = 1,048,576 bytes；边界含等于，超1 byte拒绝。100 MiB是本包建议的来源固定总预算，**不是 main 已有规则**；它允许一份接近50 MiB的结果和必要小附件一并留存。格式、语义和版本兼容的完整决定见[D02](decisions.md#d02-文件与持久合同)与[输入补充](formats-addendum.md)。XLSX通过已有成熟Python读取能力接入可选计算；MD为文档／证据，需抽表时由Agent处理。Word／PDF上传不因此变成SQL表。XLSX原件沿inputVersion精确关联，不扩XLSX结果附件／导出。Parquet、`.duckdb`、JSONL／NDJSON不列入本版上传／固定输入合同。

## 3. 已批准实施边界

### 3.1 环境与原生执行

- 复用实际锁定的 `pi-coding-agent 1.4.0`、原 bash／Python、原生 JSONL、Interface v3（兼容原消费者子集）；遵守 IN01–IN07 与[统一会话接入](../../../docs/agent-session-integration.md)。不增加 SQL 工具协议、常驻服务、引擎注册中心、planner、连接池、全局运行队列或第二套重试／压缩／恢复。
- 推荐工程侧应用私有 Python 依赖环境：候选 CPython 3.14.4 arm64、`duckdb==2.0.0`。解释器、实际 import 路径、发行物及 hash 固定，安装维护由工程负责，用户不逐任务建 venv。官方事实及候选 wheel 身份见[审计](baseline-and-reuse.md#依赖候选及限制)。确认前仅元数据核查；本地实现实际兼容、失败与未证项见实施记录，失败先解决环境，不静默换版本／模型。
- XLSX优先复用已有openpyxl能力，私有环境候选另锁`openpyxl==3.1.5`／`et-xmlfile==2.0.0`；本机metadata存在不代表应用已可用。读取sheet／范围、公式核查和是否产生派生表由Agent决定，不要求人先转换，也不做Host自动转换／公式重算。本版不额外捆DuckDB Excel扩展或查询时下载安装，具体范围与公式缓存限制见[补充](formats-addendum.md)。
- 环境只读依赖可共享，执行连接、内存数据库、输出和 spill 不跨 owner 共享。采用每执行私有连接、显式 close、原授权工作区内唯一临时目录；允许同执行多 SQL、多线程及原已授权后台／并行，不限制 Agent 方法次数。无常驻共享 `.duckdb` 业务库。
- 第一版限已授权本地文件；按用户已接受的[D04增量](accepted-limitations.md)，Agent按原权限、环境说明和显式连接设置关闭额外扩展自动安装／加载，不自行下载 httpfs／社区扩展或增加网络／凭据。Host不宣称原生API全局默认被改写：原生新连接仍true／true，未遵循说明的普通任意Python没有全局强制关闭保证。SQL、路径和材料由 Agent 审慎处理，值使用参数绑定。连接设置不能冒充 OS 沙箱；普通 unmanaged 仍保留原软约束，不恢复已撤销的全局硬沙箱。原“依赖默认禁用”的未满足结论及批准原件保持，不回填为通过。

### 3.2 owner／profile、取消与环境治理

| 原资源 | 本版资格与不变边界 |
| --- | --- |
| 普通项目任务 | 沿原 `project-tasks`、projectId/taskId 和配置，Agent 可选新库；010软约束、020过程／060最终成果约定不变 |
| managed ordinary／protected 计算 workspace | 同一 v3 资源与原 scope，最小补只读依赖加载；不得扩大写根、网络或独立输入。按模式分别证实，未通过明确不可用，不回落 unmanaged |
| 独立核算 cold 阶段 | 原计算权限内可选；cold表示先独算后揭示作者产物，不是 text-only。不得获取作者输入之外的原项目／祖先／个人资料 |
| fixed-draft／text-only | 保持无执行工具、无技能／执行扩展，不因依赖存在自动获得 DuckDB |
| PPT／需求等插件 | 保持各自原 profile；本版不自动增加其工具或文件权限 |

已核实的最小适配缺口：原 managed 解释器 realpath、固定 PATH／`-I -S` 探针、readonly runtime roots 不自然等同于激活 venv。只在原环境构造／依赖读取处做必要适配，资格和收尾留在公共入口；准确证据见[运行时审计](../../../.local/fourbase-modules/m7-duckdb/preparation/runtime-audit/runtime-audit.md)。

沿原运行占用、取消、drain／close、guardian、迟到结果和 UNKNOWN 语义。正常交接等待本资源已授权计算，显式停止收本 owner；不新建 DuckDB 运行状态权威。取消不等于文件回滚，不删除原报告、部分输出或失败现场，不重新执行查询补成功。原获准资源预算继续适用；引擎 memory_limit 不是 RSS 硬限，默认值不能作为多任务资源已受控的证明。工程侧用隔离并行验收确定合理环境设置，不让用户填写技术配额。

### 3.3 证据留存与准确展示

输入／dataset／description／citation、普通文件、Pi native、SAP、Case 与人的保留各守原权威。DuckDB 不替代 SQLite 元数据，也不增加 Semantica 或记忆存储。SQL／参数／实际 engine/client/扩展版本／配置／结果内容由 Agent 真实执行输出或文件提供；Host只核 owner、精确版本、路径、字节／hash、保存与回执，不从报告、安装包或 completed 状态猜采用及真伪。

已有文件可直接浏览；需要长期来源固定时沿原 M2 操作及 D02预算。SQL／Python脚本、参数与版本说明可作为原附件，无必填 RunManifest／新成果账。完整 SQL 未保存则显示“仅片段／未记录”；输入版本不可用则标明，绝不替成最新文件。native展示截断与临时 full_output_path 不能当完整永久成果。缺失不要求用户补机器字段、不阻断普通分析或让Host补跑。

保存响应丢失先沿原 operationId／fingerprint 只读核收；已完成返回原引用，待定／无法核定保持 pending／UNKNOWN。需继续原保存事务时只复用同身份与原不可变字节，不能重新算表、生成新版本或覆盖原稿；冲突交回准确错误。正文大于原文本预算采用文件，不静默丢参数／版本。跨owner、hash不符、版本不明、权限不足均准确拒绝或显示限制。

### 3.4 最小持久变化与兼容

只扩 M2 原合同，不增表／库／根目录／业务 ID。新reader支持v1/v2；旧记录／证据／hash／operation指纹原字节保留，读取不迁移。获准后的显式新写采用v2，原index首次实际新写时升v2并递增revision，允许v1/v2混合引用。v1读验继续原限制，v2按五类输入与原文本附件预算。格式增加tsv／xlsx／markdown，位置增加tsv-column／xlsx-range／text-range；精确字段、MD文档／表格观察与XLSX sheet／A1含义见[D02](decisions.md#d02-文件与持久合同)与[完整补充](formats-addendum.md)。其余字段／身份／关系／null／来源／确认权沿原合同；包版本v0.2不增加持久schema3。

回退是兼容代码保留 v1/v2读取、停新 DuckDB资格／新范围写入；不承诺旧二进制读取v2，不降格新记录、不删新工作或恢复旧副本。移除依赖与历史查阅分开；已保存SQL／结果／旧native仍可读。

## 4. UI 与最简路径

[可点击 UI Demo](../../../docs/prototypes/fourbase-duckdb-phase1-ui-demo.html)为虚构内存演示；未接 Host／Pi／文件／DuckDB，显示版本、结果、回执均为虚构示例。正常路径为**原任务提问／发送 → 查看结果**，相对现有路径新增必做操作0；“查看计算依据”、原来源固定与高级范围均可选。情景开关只用于评审，不是产品必经配置。

关键正常／失败／取消／回执与容量情景、与当前产品的差异及四原则反例见[UI审阅](ui-review.md)。不设置 SQL IDE、用户引擎选择器、逐读取批准或“启用数据库”必经步骤。环境缺失时给 Agent 真实错误，由其选已有方法／说明限制；界面不能暗示Host自动转Python、自动重试或商业结论通过。

## 5. 验收标识与后续切片

| 标识 | 批准后的可观察验收 |
| --- | --- |
| DB01 环境可用 | 锁版私有依赖实际可导入且身份匹配；普通与每个受管模式分别证实；缺失／漂移准确报错、无隐式安装／权限回退 |
| DB02 Agent自主 | 原Pi路径真实完成DuckDB、Python、混用及零DuckDB情景；Host无强制引擎／固定方法／补算／第二Runtime |
| DB03 文件合同 | main22类/50MiB保持；M2 v1/v2、CSV/TSV/JSON/MD文本与XLSX原二进制、50MiB单件与文本来源100MiB总量边界、字段位置／owner／CAS及旧字节兼容准确；Excel sheet／公式缓存、MD原文／派生对应按补充验证 |
| DB04 可核依据 | 结果、SQL／参数／实际版本／输入引用沿原文件／native／可选citation保存、重开可查；截断／缺失／hash错不伪装完整 |
| DB05 生命周期 | 同项目并行无跨任务连接／spill／结果污染；长查询取消、drain、close、迟到、保存ACK丢失、磁盘错误保持原占用／保护／UNKNOWN |
| DB06 UI低操作 | 原任务和成果入口，正常新增必做操作0；按需依据／失败可键盘访问，窄屏／深浅色不丢关键信息，虚构Demo与真实产品有清楚差别 |
| DB07 现有能力保全 | 保留M2–M7全部WIP／批准／历史FAIL，整合最新main时保留上传、核算设置、连接器、原生web_search／subagent及权限／生命周期；旧消费者／第三合成接入通过适用检查 |
| DB08 结果分级 | 工程／非作者及四原则、真实性／性能对照、产品验收分别记录；无增益／失败／NOT_PROVED不改写为通过 |

批准后按[验证协议](evaluation-protocol.md)逐片推进：①保全并在隔离候选整合最新main与原WIP；②环境最小可运行切片与真实因果RED；③M2 v2与原成果接缝；④UI／兼容／公共消费者；⑤固定完整候选、适用完整检查、全新非作者和四原则专项。普通方法选择不由此工程实施顺序约束。

允许实施路径限工程依赖／解释器环境接缝、原 project runtime/session／protected-tools、原 M2 类型／存储／路由／上下文／UI、原项目成果展示及必要回归／规范记录；具体改动须以批准规格和实际缺口为准。不得另造服务、全局执行机制、通用schema、SQL业务规划器或变更插件权限。若需改变已确认合同只补受影响决定。真实Provider／业务材料、Git／CI、安装到运行服务、服务切换、MacBook另按授权，不被本确认包隐含授予。

## 6. 当前实施与未授权范围

用户已确认更新版v0.2 spec／UI并开始开发；准备阶段“确认后才开发”已由本次明确指令满足，不重复请求。9份原件见[批准清单](history/approved-v0.2/manifest.json)，实际开发／RED／检查与缺口见[实施记录](implementation.md)。本地工程在独立最新main候选保全整合M2–M7后实施，允许隔离私有依赖和合成实际工具／Host／Pi／UI验证。真实Provider／业务材料、Git提交推送／CI交付、运行服务切换／MacBook仍另按有效授权，不因开工隐含完成；原专业FAIL／UNKNOWN／NOT_PROVED保持。

用户随后明确接受三项限定处理并要求继续收尾。当前本地收尾按[接受记录](accepted-limitations.md)执行：E01/E02只接受本次流程/证据缺口，原NOT_PROVED不变；D04仅收窄扩展关闭合同。检查输入对应原固定代码，当前仅文档修订；本地收尾不等于Git/CI、部署或用户产品验收。

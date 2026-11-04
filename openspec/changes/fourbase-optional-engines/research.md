# M7 官方能力刷新与采用前置研究

读取日期：2026-11-04（Asia/Shanghai）。状态：READ_ONLY_RESEARCH；供 spec／UI 确认前准备，未启动 M7 产品开发。

> 研究原件保留于`.local/fourbase-modules/m7/preparation/official-research.md`（22,056 bytes，SHA-256 `7834450a4c76c3a6ff63e33e5bd0a59dc9e9175edf8eb2cb1bea29a0febe62d7`）。此项目副本只将三处本机绝对文档链接规范为相对链接并加本来源说明，其余原文／来源／受限记录保持；原件的“本轮”指只读研究过程，不是组件采用。

## 1. 结论与证据等级

**建议当前继续 Pi 原生执行基线；DuckDB、Semantica、Graphiti 均保留为按问题触发的候选。** 本研究确认官方文档／源码存在相应能力，不能证明 OptraCall 已出现持续真实问题、已接线、性能有收益或已通过取消／来源／兼容验收。是否触发 M7 由另一份本项目问题证据决定；若没有持续缺口，延期是符合既定方案的结果。

| 部件 | 官方能力与本轮核对 | 当前建议 |
| --- | --- | --- |
| Pi 1.4.0 | 本地已锁包与随包文档核对；原生工具、skills、bash 子进程、abort／timeout 已有接口与实现 | 优先复用，不重建计算循环或进程执行层 |
| DuckDB | 可直接用 CLI／Python 执行 SQL 扫描、关联和聚合文件；未运行 | 重复多表／大扫描／Parquet／SQL 复现或可测性能缺口出现后，优先比较小范围直接调用 |
| Semantica | 语义／上下文框架；已有来源、确定性时间查询、双时间及版本快照；未运行 | 轻概念和显式关系持续不足时比较所需最小模块，不默认部署全框架 |
| Graphiti | temporal context graph 框架；episode 来源、事实时间窗口和时间过滤原生存在；默认模型与图数据库要求明确；未运行 | 反复发生演变事实、跨材料关系／历史问题时再比较，不先建平行图历史库 |

采用判断是对本项目既定四原则及方案第 7 节的推论，不是官方背书。依据为[工程规范](../../../docs/engineering-workflow.md)、[产品讨论稿](../../../docs/OptraCall_产品讨论稿_v0.2.md)及[四库双库方案第 7、9 节](../../../docs/fourbase-doublebase-plan.md)。

## 2. 固定身份与研究方法

只读检查 `package.json`、`package-lock.json`、已安装 Pi 包的 metadata／文档／bash 实现；读取官方网页及固定提交源码。GitHub API 的只读请求返回 403 rate limit，随后用 `git ls-remote` 只读核对公开 ref，没有 fetch／clone 或本地 Git 写入。

| 对象 | 本轮固定身份 | 可以证明及限制 |
| --- | --- | --- |
| OptraCall Pi | `@earendil-works/pi-coding-agent`，`package.json`／lock／已装包均为 `1.4.0` | 本地锁定身份；没有据此升级 SDK |
| Pi 官方 ref | `v1.4.0` → `4a080252f06caf63a525d7873c5d94d3c23887e0` | 官方固定源码；4 份本地随包文档与此提交逐字节一致，见下表 |
| DuckDB 官方文档 | `stable` 本次跳转到 `2.0` 文档线；CLI 页标 stable CLI `2.0.0` | 只是本次官方文档状态；没有核定本机 DuckDB 安装或选择项目采用版本，不能把 `stable` 链接当锁版本。[CLI 文档][duck-cli] |
| Semantica 官方 main | `4b6de4e356421f4ff39d7e521b52f321c00b27ff`；该提交 `pyproject.toml` 声明 `0.8.0` | 固定源码身份；不等同 PyPI 已发布包、安装内容或兼容保证。[构建元数据][sem-pyproject] |
| Graphiti 官方 main | `fb60e59d4a208c99e7d0186ee6335d2a257f17f2`；该提交声明 `graphiti-core 0.31.2` | 固定源码身份；不等同 PyPI 已发布包或项目接入版本。[构建元数据][graph-pyproject] |

Pi 本地锁文件记载 tarball 为 `https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.4.0.tgz`，integrity 为 `sha512-Z41LpZ3yYHSC/UUps6Mr39UMFPwH8elhJBG9DY1P7kuzsE5qSK/6eMj2EHzO5evJRQWLbKSqUMw+4nCNtIyiQg==`；本轮没有重新下载 tarball 或证明整个安装树等于发布 tarball。

| Pi 随包文件（均在 `node_modules/@earendil-works/pi-coding-agent/`） | SHA-256 | 与官方固定提交同路径 |
| --- | --- | --- |
| `docs/skills.md` | `5b9805525b194474ef1fe5455a0917ef15ed7f710aa9bec2eee11879556469e5` | 字节相等 |
| `docs/security.md` | `3b1e40a8d28b17c9eb7e496a7ba88fbe04665e3e6ae02873a58b943e325ad504` | 字节相等 |
| `docs/sdk.md` | `d9034ccbf2219a58712d8dd4fcdf47e687d77131e71dd5d119d8a71e9bd2a2e8` | 字节相等 |
| `docs/how-pi-works.md` | `7d43ab8e2b886cd1047dcee503588a1c828b92333dd4f177526b89e6db8aaa8b` | 字节相等 |

## 3. Pi 1.4.0：已具备的执行与扩展能力

- SDK 已提供会话、资源加载和工具集合控制（`tools`／`noTools`／`excludeTools`／`customTools`）；`resourceLoader` 承载 skills、extensions、模板和上下文。CLI 与 SDK 默认扩展集合有区别，SDK 不会仅因装包就自动启用 MCP／codemode，不能把 CLI 功能误称为宿主 SDK 默认行为。[SDK 文档][pi-sdk]
- Skill 是按需加载的说明和支持文件，可带脚本／引用／资产。名称、描述和路径先进入提示词，完整内容在模型读取时才加载；模型可能漏读，所以“发现了 skill”不证明已经执行。普通计算工作流可以先表达为 skill＋原生工具，不必新增可执行集成点。[Skills 文档][pi-skills]
- 原生 bash 接受 shell 命令与可选秒级 timeout；未提供 timeout 时没有默认超时。实现使用 `spawn`、流式 stdout／stderr、AbortSignal，并在中止／超时调用进程树终止。输出截断及临时完整输出也是其既有行为。这提供直接运行已可用 CLI／解释器的执行基础；它不提供 DuckDB 本身，也不证明该项目的停止链路对未来组件已有效。[固定 bash 源码][pi-bash]
- Pi 和其子进程使用启动账户权限，工作目录不是文件访问沙箱；技能、项目 trust 和查看 transcript 不构成安全边界。这里记录官方边界，不提议改变本项目已确认的普通工具策略或恢复被撤下的硬沙箱。[安全文档][pi-security]

**对 M7 的含义（推论）：** Host 若以后使某个计算库／CLI 可用，应复用统一 Pi 接入和现有生命周期，说明可用环境及真实限制；Agent 自主决定 Python／SQL／其他工具和内部迭代。没有证据要求增加一个 Host 计算 orchestrator、通用 engine provider registry、固定 DuckDB 分析步骤或每次工具确认。

## 4. DuckDB：可选的 Agent 直接计算能力与边界

### 4.1 最小可复用途径

官方 CLI 是单一可执行程序，可内存运行或打开持久数据库，并有 CSV／JSON 输出选项；Python 通过连接提供 SQL DB-API。文件扫描可以直接查询 CSV／Parquet，不要求先迁移项目明细；这与“Agent 在原生 bash 中选择 CLI 或 Python 库”相容。[CLI][duck-cli]、[Python DB-API][duck-python]、[文件读取][duck-data]

本研究没有比较性能，也没有证明本项目需要内嵌 Node 客户端、常驻查询服务、连接池或分析仓库。当前只保留候选，具体发行包、解释器、CPU 架构、安装方式和版本兼容尚待触发后的隔离核对。

### 4.2 外部访问／扩展与只读含义

- 官方扩展支持自动安装与加载；例如查询 HTTPS CSV 可以自动触发 `httpfs`。安装会下载扩展并写入本地扩展目录；加载为进程引入二进制。自动加载仅针对支持的 core 扩展，并不是所有扩展都会自动工作。[扩展机制][duck-ext]
- 官方有 `autoload_known_extensions`、`autoinstall_known_extensions`、`enable_external_access` 等控制；这些是能力限制，不是完整沙箱。引擎按进程权限执行 SQL，可读写文件、访问网络并加载扩展；allow-listed 路径也能写入。`read_only=True`／CLI `-readonly` 的官方语义是数据库连接只读，不能据此声称 CSV 原件、所有文件或网络已隔离。[安全模型][duck-security]、[只读连接][duck-python]
- 签名证明所加载包的完整性／来源校验范围，不证明任意扩展适合本项目。扩展二进制与引擎版本、平台绑定，错误版本／平台会被拒载；未来采用记录须包含实际扩展及其来源，不仅一个 DuckDB 版本号。[扩展分发][duck-distribution]

### 4.3 取消与复现

Python 官方 `interrupt()` 可中断 pending operations；Pi 原生 bash 也有中止／timeout 基础，但本轮没有验证 CLI 的信号响应、子进程退出、临时文件和输出保存。存在中断 API 不等于该组件整段工作可回滚，不把“请求停止”写成已清理或已恢复原状。[Python API][duck-api]、[Pi bash][pi-bash]

官方 `version()` 可读实际引擎版本，`duckdb_extensions()` 可列 installed／loaded／extension_version／installed_from 等信息，适合复用为采用后的真实环境记录。[版本函数][duck-utility]、[扩展 metadata][duck-meta]

**采用后最小证据建议（项目推论，当前 NOT_RUN）：** 固定获准输入版本／hash、实际 SQL 或脚本与参数、实际 engine／client／extension 版本与外部访问配置、相关 SAP 身份、输出位置及中断／错误；在代表场景对比现有工具的耗时、内存、正确性和复现成本。输入和派生物分开；停止后保留真实失败现场，Host 不补算。优先使用原有文件／原生工具记录，只有实测证明缺口才加最小适配。

## 5. Semantica：已有来源和时间能力的框架候选

### 5.1 定位与依赖

官方将它定位为现有 LLM／agent／vector stack 之上的语义／上下文基础设施，包含抽取、图构建、检索、推理和 provenance；它不是本项目已经选定的单一物理图数据库，也不自动成为 SAP 正式定义权威。[概念说明][sem-concepts]

固定源码的 core 依赖含 NumPy、Pandas、SciPy、scikit-learn、RDFLib、NetworkX、requests／httpx、PyArrow 等；Python 要求 `>=3.11,<3.14`。Neo4j、FalkorDB、其他图后端、向量后端、LLM clients 和本地模型是按需 extras／模块，不该用 `all` 安装作为缺省评估。`graph_store` 是对不同生产图后端的适配层，所选后端仍有自身运行要求。[构建元数据][sem-pyproject]、[图存储模块][sem-graphstore]

### 5.2 模型调用必须按路径说清

官方抽取模块区分 `pattern`（无需 API key）、`huggingface` 和 `llm` 方法；LLM 路径需要相应 provider／配置，本地模型路径也会引入模型与依赖。确定性图处理／时间计算和 provenance 不应被笼统描述为“必然调用 LLM”；反过来，抽取／GraphRAG／重排等所选路径也不能被包装成没有模型行为的普通查询。[抽取模块][sem-extract]、[时间模块][sem-kg]

本轮未运行任何路径，未证明中文抽取、模型可靠性、无网络、副作用关闭、费用或取消行为；不沿用官网准确率、延迟或合规宣传作采用证据。

### 5.3 来源与时间语义原生程度

- 已有 `ProvenanceEntry`／`SourceReference`，能表达文档、位置、引用文字、置信度和追踪时间；默认内存 storage 与显式 SQLite persistence 已有。entry checksum 针对 provenance 记录，不能据此推断原始文件字节归档、历史文件可恢复或业务事实已核实。[来源模块][sem-provenance]、[来源 schema 源码][sem-provenance-src]
- 已有 `valid_from`／`valid_until`、`recorded_at`／`superseded_at`、`BiTemporalFact`、按时点／区间查询、Allen 时间关系和 `TemporalVersionManager`。固定源码实现能选择 SQLite 保存快照、查询旧版本并比较版本；不是只有一个字段名或概念图。[KG 模块][sem-kg]、[时间查询／版本实现][sem-temporal-src]
- 这些能力可以减少自建历史的需要，但不能由此认定“全部后端天然保存一切历史”或“输入任意文档就有正确业务时间”。接入时仍应验证源版本映射、缺失时间／推断时间、更新失效、持久保存重开和重建结果；业务时间与系统记录时间不得混写。该限制来自接口含义与本项目证据需求的推论。

**建议：** 只有轻关系反复不足时，围绕一个已固定问题比较必要模块；先复用其来源／时间／快照，不先造 OptraCall 的通用图历史层。图谱与推断仍是派生表达，正式指标定义和人的决定沿原权威保存。

## 6. Graphiti：episode／时间查询原生，运行责任也明确

### 6.1 来源、时间与查询

Graphiti 官方定位为构建和查询 temporal context graphs 的框架；不是替宿主提供全部账户、权限、业务准入或服务运维的成品。episode 是输入来源层，entity／relationship 是派生图层。[官方 README][graph-readme]

源码 `EpisodicNode` 有 `source`、`source_description`、`content`、`valid_at` 等；`EntityEdge` 有 `episodes`、`valid_at`、`invalid_at`、`expired_at`，基类还记录 `created_at`。`SearchFilters` 可按事实有效／失效／创建／过期时间等筛选，表示来源和双时间并非需要宿主从零补建。[episode 源码][graph-nodes]、[事实边源码][graph-edges]、[时间筛选源码][graph-filters]

`store_raw_episode_content` 默认 True，但可配置 False 而清空 episode 正文；因此“每个事实可回到 episode”仍不等同“任意配置下原文都持久保存”。即使保留 episode 内容，也不能自动证明项目文件旧字节或 SAP 发布原件的恢复能力。[Graphiti 初始化及写入实现][graph-core]

### 6.2 模型与基础设施

README 的当前基线要求 Python 3.10+ 和支持的图数据库；Neo4j／FalkorDB／Neptune 等运行前提随 driver 不同，Kuzu 已标 deprecated，不能凭旧资料把它当默认嵌入式选择。默认采用 OpenAI inference 与 embeddings，结构化输出可靠性直接影响入图；官方也列替代 provider／本地模型途径。[官方 README][graph-readme]

固定 `pyproject.toml` 直接依赖包括 `neo4j`、`openai` 等；初始化在没有显式替代时创建 `OpenAIClient`、`OpenAIEmbedder`、`OpenAIRerankerClient`。模型、embedding、reranker、并发和后端须作为真实配置分别记录，不得默认沿用 OptraCall Pi 的 provider 契约；源码还存在可选 `llm_runtime`，本轮未评估替代 runtime／GLiNER2 路径，因此不作“全部路径必须远程 LLM”或“全部本地无需模型”的断言。[构建元数据][graph-pyproject]、[初始化实现][graph-core]

**建议：** 若持续问题确实是“某时点什么关系成立／谁在何时变更／跨材料来源矛盾”，Graphiti 值得进入隔离候选比较；否则其图基础设施和模型调用成本未获本项目收益证据支持。若采用，应映射原生 episode／有效时间／记录时间，不叠加平行历史引擎；不把模型推断的关系当正式业务定义、因果关系或已批准行动。

## 7. 对后续 spec／UI 的最小约束

以下为项目推论及准备建议，当前不实施：

1. **没有触发时**：用“尚未触发／候选／未运行”表述，不加已可用引擎开关、伪查询结果或安装向导。虚构示例若需要，持续显式标示未接线。
2. **触发计算缺口时**：先比较现有 Pi＋可用 Python／文件工具基线与 DuckDB 直接调用；Host 只提供环境、输入来源、输出保存及统一生命周期，Agent 选方法。采用须有代表场景收益，不以功能清单决定。
3. **触发关系时间缺口时**：固定一个简单检索／轻关系不能完成的问题，再比较候选的方向、来源、业务／记录时间、更新失效、重开和重建；优先映射组件原生能力。
4. **两类能力独立决定**：不要求同时引入 DuckDB 和语义图；不先建立通用 provider registry、全域上下文账本、图历史库或新正式语义权威。
5. **可审计且少操作**：实际版本／查询／来源／状态优先随原生记录保存和展示；不为普通分析强加逐条工具确认或必填组件配置表。

## 8. 未验证与授权止线

本轮完成：官方网页刷新、固定源码读取、Pi 本地依赖／随包文档只读身份核对、本 Markdown。新建的唯一任务文件为本文件；没有覆盖既存文件。

NOT_RUN／NOT_PROVED：DuckDB／Semantica／Graphiti 安装、导入、执行或 benchmark；任何模型调用；本项目适配／取消／重开／源失效／重建；许可及模型条款完整审查；发行包与当前 main 一致性；产品可用性／收益／验收。四份 Pi docs 同字节不能推广为整个包完整性证明。

未读取真实业务 dataRoot 或凭据；未改依赖、产品源码、测试、schema 或业务库；未启 Host／服务；未做 Git 写、CI、安装／运行采用或 MacBook 操作。原 WIP、原件、会话、FAIL／UNKNOWN／NOT_PROVED 保持。

### 8.1 读取受限与未作为能力证据的路径

- GitHub API 以下只读 ref 请求均返回 `403 rate limit exceeded`，未重试凭据；通过公开 `git ls-remote` 获取同一 ref 后再读固定 raw 源码：[Pi tag API](https://api.github.com/repos/earendil-works/pi/git/ref/tags/v1.4.0)、[Semantica main API](https://api.github.com/repos/semantica-agi/semantica/git/ref/heads/main)、[Graphiti main API](https://api.github.com/repos/getzep/graphiti/git/ref/heads/main)。
- Semantica 的以下猜测路径返回 `404`，没有据此认定模块缺能力；已改用实际存在的 `docs/reference/*` 与 `semantica/kg/temporal_query.py`：[context README](https://raw.githubusercontent.com/semantica-agi/semantica/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/context/README.md)、[provenance README](https://raw.githubusercontent.com/semantica-agi/semantica/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/provenance/README.md)、[graph_store README](https://raw.githubusercontent.com/semantica-agi/semantica/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/graph_store/README.md)、[semantic_extract README](https://raw.githubusercontent.com/semantica-agi/semantica/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/semantic_extract/README.md)、[context temporal_engine](https://raw.githubusercontent.com/semantica-agi/semantica/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/context/temporal_engine.py)。
- 浏览工具未能读取 [Semantica 固定 tree 页面](https://github.com/semantica-agi/semantica/tree/4b6de4e356421f4ff39d7e521b52f321c00b27ff)（restricted URL）与[Graphiti 猜测 episodes 页面](https://help.getzep.com/graphiti/core-concepts/episodes)（not accessible），未将它们作为来源；本笔记的实际结论使用已成功读取的官方固定 raw 文档／源码。
- 早先按历史包名定位的本地 `node_modules/@mariozechner/pi-coding-agent` 不存在；已按项目依赖修正为 `@earendil-works/pi-coding-agent`。没有把旧包路径的失败当作 Pi 未安装。

## 9. 官方来源索引

以下链接全部在 2026-11-04 读取；GitHub 源码链接固定到本轮核对提交。DuckDB 链接固定文档主版本线，但网页内容仍可能变动；本研究未把它等同本机安装版本。来源中的能力和性能／准确率／合规宣传严格分开，未引入第三方文章。

[pi-sdk]: https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/docs/sdk.md
[pi-skills]: https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/docs/skills.md
[pi-security]: https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/docs/security.md
[pi-bash]: https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/tools/bash.ts
[duck-cli]: https://duckdb.org/docs/2.0/clients/cli/overview
[duck-python]: https://duckdb.org/docs/2.0/clients/python/dbapi
[duck-data]: https://duckdb.org/docs/2.0/data/overview
[duck-ext]: https://duckdb.org/docs/2.0/extensions/overview
[duck-security]: https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/overview
[duck-distribution]: https://duckdb.org/docs/2.0/extensions/extension_distribution
[duck-api]: https://duckdb.org/docs/2.0/clients/python/reference/
[duck-utility]: https://duckdb.org/docs/2.0/sql/functions/utility
[duck-meta]: https://duckdb.org/docs/2.0/sql/meta/duckdb_table_functions
[sem-pyproject]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/pyproject.toml
[sem-concepts]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/docs/concepts.md
[sem-graphstore]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/docs/reference/graph_store.md
[sem-extract]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/docs/reference/semantic_extract.md
[sem-kg]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/docs/reference/kg.md
[sem-provenance]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/docs/reference/provenance.md
[sem-provenance-src]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/provenance/schemas.py
[sem-temporal-src]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/kg/temporal_query.py
[graph-readme]: https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/README.md
[graph-pyproject]: https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/pyproject.toml
[graph-nodes]: https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/graphiti_core/nodes.py
[graph-edges]: https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/graphiti_core/edges.py
[graph-filters]: https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/graphiti_core/search/search_filters.py
[graph-core]: https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/graphiti_core/graphiti.py

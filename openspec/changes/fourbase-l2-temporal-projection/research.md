# L2 最小关系／时间投影：官方能力与发行包静态核对

2026-11-04（Asia/Shanghai） · `READ_ONLY_RESEARCH` · 基线 `57742b99d173bfa6413e83705682b0444359add4`

v0.3定位补充：本研究服务于后端语义支撑——优先借Semantica本体与知识图谱组织概念／规则和具体事实关系，使Agent按需取得并理解业务语义。前端业务含义只是回答依据内的可选解释，关键口径／冲突由Agent主回答主动说明。本次未新增官方包／API实证，以下固定P1技术证据不证明Agent语义理解改善；Graphiti仍只作具体缺口后的比较方向，原P1范围不扩大。

## v0.2 完整定位与本研究的范围

完整L2是面向Agent的业务语义、知识关系与事实演变能力层。Semantica官方定位覆盖概念／本体、语义／关系组织、规则约束／冲突及来源，也有时间能力；Graphiti侧重episode驱动的持续事实／关系更新和时间检索，也支持类型化实体／关系及来源。它们是有重叠的候选实现，OptraCall补业务引用、准入、Pi接入及界面，不默认同时运行两者。[Semantica官方定位](https://github.com/semantica-agi/semantica)、[Graphiti官方定位](https://github.com/getzep/graphiti)

下文固定wheel／API核对是**P1最小切片的静态研究**，不是完整L2全部功能或两组件全量比较。本轮未启用的本体／OWL／SHACL治理、抽取、实体对齐、持续摄取等不代表组件不支持或未来永久排除；其具体采用和有效授权仍待后续切片。Graphiti在P1暂不启动是范围选择，只有明确缺口后才比较，不是宣布其无价值。本文原版本／下载／API证据保留原核验时间，不把补写定位当新运行／全面刷新证明。

本研究用于下一步整体确认包。**只读取官方网页、固定源码和发布 wheel；没有安装、导入或运行 Semantica／Graphiti，没有调用模型、启动产品或改业务结构。** 文中 API 存在及实现判断均为静态证据；`mapped/partial/unsupported` 是拟映射评估，不是接线成功回执。实际范围以 [spec](spec.md) 和 [决定包](structure-decisions.md) 为准。

## 1. 本轮建议

建议先将正式发布 `semantica==0.7.0` 锁为**隔离合成 POC 候选**，验证原生图字典、`TemporalGraphQuery`、`ProvenanceManager` 与 `TemporalVersionManager`，需要重开时分别显式选择组件已有 SQLite 存储。最小路径不必先部署独立图服务，也不必启用抽取、embedding、GraphRAG、LLM 或 `all` extras。SQLite 文件是组件派生快照／来源后端，不替代 OptraCall 原权威 Store；不据此批准正式 dataRoot 接线或迁移。[发行元数据][pypi]、[时间实现][release-temporal]、[来源存储][release-prov-storage]

已发现会影响语义正确性的默认行为及 API 限制：缺少记录时间会回填、未知窗口会被解释成开放窗口、自然语言 `query` 不执行解析、同一时点的双轴与两个不同时点不同、路径枚举不保证完整、版本比较可能合并平行事实。应先用固定样例证实最小组合能保留原语义；失败时按有损／不支持记录并收缩范围，不先自建另一套时间或图引擎。Graphiti 暂无新增比较理由，本轮不启动。

## 2. 固定版本、发布物与证据位置

| 对象 | 本轮读取值 | 证据边界 |
| --- | --- | --- |
| 官方 `main` | `4b6de4e356421f4ff39d7e521b52f321c00b27ff`；`pyproject.toml`／包头声明 `0.8.0` | `git ls-remote` 只读刷新；不是已发布 0.8.0，更不是本项目已安装版本 |
| 官方 `v0.7.0` | annotated tag 对象 `13108ff0df67be052dd6e60313049370bea5205c`，解引用提交 `2a9afec685fe6f4a18350834caed3d6a9affb27a` | 与最新 main 分开固定 |
| 当前 PyPI 最新发行 | `0.7.0`，Python `>=3.10,<3.14` | 读取 JSON API 和发布页；没有安装或解析完整依赖闭包 |
| wheel | `semantica-0.7.0-py3-none-any.whl`，2,691,390 bytes；SHA-256 `faf27d6259ae813ddb44c5213e2f8867592f27e6e3d6b47cea10f1844513799f` | 下载后实际计算 hash，与 PyPI 声明相等；仅 ZIP 读取，无 import／执行 |
| sdist | `semantica-0.7.0.tar.gz`，2,714,872 bytes；SHA-256 `9da8ab2c204874e2720bdd36040524c958ade23e7378ccefbfea5d2b340f420f` | 仅 PyPI 元数据声明，**未下载／核算**，不当作已验证字节 |

上述发行事实见 [PyPI JSON][pypi]、[0.7.0 发布页][pypi-page]、[固定 main 构建元数据][main-pyproject]。`0.7.0` wheel 上传时间为 2026-09-22T11:17:39.963315Z；本轮没有以 latest 文档替换发行包身份。

只读下载证据根：`/var/folders/sr/3yqhm2kn4zsfxhnhmr67yjg40000gn/T/optracall-l2-semantica-research-_oecnjdl/`。保留 wheel、`pypi-metadata.json` 及 `wheel/`、`v0.7.0/`、`main/` 下本次读取的文件；这是仓外临时研究材料，不是产品数据目录或永久归档承诺。可从上述固定官方 URL 与 hash 重新获取。

本轮实际逐字节核对 **12 份** wheel Python 文件与 `v0.7.0` 固定提交相等；未证明整个包等于 Git tree：

| 关键文件（`semantica/` 下） | wheel 文件 SHA-256 |
| --- | --- |
| `kg/temporal_query.py` | `086435fc9e6e67102984836a5441da6b44c7adc95dbdc318d7399e4481b370a7` |
| `kg/temporal_model.py` | `77565e904672d81b4c26ba5e9eba1b133d9e17b7e9c2bea66d80dd1a6f057cd1` |
| `kg/path_finder.py` | `22ed2f5eb4293530cee6cd33b9b86a2ab65ade31a74a2af14ac1d9b6dd2798c8` |
| `provenance/manager.py` | `5b897806b26c86b163539054430acbdd673682a87c530a92df77605b8c3e2fc5` |
| `provenance/schemas.py` | `89fa15470f9a6a64ea729801a5b437efe2a19df1474ca6f13855493f745672d0` |
| `provenance/storage.py` | `514464dca885f17d34ef30c21b5edb655b12e5297fdd4ef0b7b7dbbf34767fd4` |
| `provenance/integrity.py` | `7af67d2e8526a93a7124f52c0b489d75e53ba77e592d80d6c119d0fdde19692e` |
| `change_management/version_storage.py` | `1eb08197bbe4dc37a3d5c1e6358fd5f50c43cc008bf6e6f31921cedcf39ace22` |

另四份为 `kg/temporal_query_rewriter.py`、`kg/__init__.py`、`__init__.py`、`utils/logging.py`。`pyproject.toml` 不在 wheel 普通源码文件中，本轮没有把“未提取”误写成版本内容不等。

## 3. 环境／后端与非默认模块

0.7.0 wheel metadata 的 core 有 NumPy、Pandas、SciPy、scikit-learn、RDFLib、NetworkX、requests、httpx、PyArrow、Pillow 等 **22 项直接要求**；一个 `py3-none-any` wheel 不证明这些传递依赖在目标 Mac、所选 Python 上都有合适二进制，也不证明安装体积小。main 的 Python 下限已变为 3.11，依赖也有变化；不把 main 依赖当作 0.7.0 锁。后续 POC 需独立解释器／venv，锁完整解析结果与 hash，不改正式或既有 DuckDB 私有环境。[发行元数据][pypi]、[main 构建元数据][main-pyproject]

来源的 `SQLiteStorage` 和版本的 `SQLiteVersionStorage` 使用 Python 标准 `sqlite3`，构造时会建目录及组件自己的表；路径必须明确指向获准隔离根。它们是两个存储责任，不存在已核定的跨库事务；不得以一边保存成功宣称整代投影 READY。最小 POC 可先内存构图、写新代的两份派生数据库，核对后才将工程读者指向该代；失败保留原代和失败现场。此为建议，尚未创建文件／目录或实现发布契约。[来源实现][release-prov-storage]、[版本存储实现][release-version-storage]

Neo4j／FalkorDB／Neptune／AGE、向量存储和 LLM clients 均另有 extras。最小字典图＋本地 SQLite 路径不需要选择外部图数据库；`PathFinder` 等官方已有遍历模块也不要求为此先建 OptraCall 图服务。future native backend／SQL schema 细节沿组件，不在本项目复制一套通用表设计。[固定发行构建元数据][release-pyproject]、[原生路径实现][release-path]

静态检查未建立“所有导入零副作用／零网络”的证明。`kg/__init__.py` 会导入多模块；进度跟踪、配置、可选模型模块和 logging 需要后续在隔离环境核实。`setup_logging` 默认可写 `semantica.log`；不能因选择本地存储就宣称无其他文件。未来验证需把实际导入、文件与网络观察、后台活动、停止／取消一并记录。[模块入口][release-kg-init]、[日志实现][release-logging]

## 4. 原生 API 与字段合同：以实际 0.7.0 wheel 为准

以下签名由标准库 AST 静态读取；省略 `self`，没有调用函数。

| 模块／入口 | 真实核心签名 | 最小用途及限制 |
| --- | --- | --- |
| `kg.temporal_query.TemporalGraphQuery` | `(enable_temporal_reasoning=True, temporal_granularity='day', max_temporal_depth=None, **kwargs)` | 时间粒度必须显式；默认按 day 不适合默认为精确秒边界 |
| `.query_at_time` | `(graph, query, at_time, include_history=False, temporal_precision=None, time_axis='valid', **options)` | `query` 当前仅回显，不解析自然语言；`temporal_precision` 未用 |
| `.reconstruct_at_time` | `(graph, at_time, *, time_axis='valid')` | 原生按有效／transaction 时间筛子图；关系端点同时检查 |
| `.query_time_range` | `(graph, query, start_time, end_time, temporal_aggregation='union', include_intervals=True, time_axis='valid', **options)` | 范围查询；具体端点／union／intersection 边界待运行核对 |
| `.find_temporal_paths` | `(graph, source, target, start_time=None, end_time=None, max_path_length=None, temporal_constraints=None, enforce_causal_ordering=True, ordering_strategy='strict', **options)` | 有向 BFS；不直接接受 recorded-time 参数；额外 constraints 参数未用 |
| `provenance.ProvenanceManager` | `(storage=None, storage_path=None, config=None, **kwargs)` | 不传路径可能是内存，也可能受类级默认配置影响；POC 必须显式路径 |
| `.track_entity`／`.track_relationship` | `(entity_id, source, metadata=None, _conn=None, **kwargs)`／`(relationship_id, source, metadata=None, **kwargs)` | 记录原来源指针／性质；存储失败可能返回 None 或旧记录，不能仅凭函数返回就声称新状态已保存 |
| `.get_provenance`／`.get_lineage`／`.trace_lineage` | `(entity_id)`／`(entity_id)`／`(entity_id, max_depth=None)` | 原生来源回查；不是原文旧字节档案 |
| `.invalidate` | `(entity_id, agent_id, reason=None, metadata=None)` | 组件派生来源失效，保留历史；不自动改业务 Store |
| `kg.temporal_query.TemporalVersionManager` | `(storage_path=None, snapshot_interval=None, auto_snapshot=False, version_strategy='timestamp', **config)` | 明确路径选已有 SQLite；不是后台定时快照已启动证明 |
| `.create_snapshot`／`.get_version` | `(graph, version_label, author, description, **options)`／`(label)` | 持久快照和重开读回候选；需核 checksum 与内容 |
| `.apply_revision` | `(snapshot, revision)` | 保留旧关系并生成替代版本；记录时间取运行 now，不能直接重放原历史 known-time |

API 证据：[时间查询／版本实现][release-temporal]、[来源管理实现][release-prov-manager]；存储、来源字段和路径算法另见下节各自来源。`create_version(graph, version_label=None, timestamp=None, metadata=None, **options)` 仅构造浅拷贝结果，不调用 storage；不能拿它验证持久重开。`compare_versions` 内部按 `source|type|target` 聚合关系，平行事实／修订可能覆盖，因此不能作为“所有独立事实变化均已保存”的唯一证据。

### 4.1 图与身份

原生输入形状为 `{'entities': [...], 'relationships': [...]}`，实体按 `id` 查找；关系最小采用显式字符串 `id/source/target/type`，外加必要属性或 metadata。**0.7.0 的 `reconstruct_at_time` 仅取 `source/target`**，直接传 `source_id/target_id` 会丢关系；固定 main 已补兼容，但这不自动进入发布 wheel。本轮不建议为这一差异悄悄改包或 vendor main。[发行实现][release-temporal]、[main 实现][main-temporal]

组件允许额外字典字段，不定义 OptraCall 的业务实体身份或事实真值。POC 拟复用原 project／对象／修订／hash／定位的组合身份，不按同名合并；`id` 应区分事实和版本，`type` 保留原关系性质与方向。来源 ref、原 hash、版本、定位、原时间声明与有损标记可以在 metadata 中保留，但“可存”不等于该字段被组件查询／验证。不要把它们提升为可独立编辑的正式事实库。[来源字段][release-prov-schemas]、[原生版本存储][release-version-storage]

### 4.2 时间、null、时区和未知

`BiTemporalFact` 有 `valid_from/valid_until/recorded_at/superseded_at`；关系字典缺 `recorded_at` 时会取 `valid_from`，再缺则取当前 UTC。缺失或 None 的有效结束解释为 OPEN；时间查询把缺有效起点按无限过去参与判断；无时区时间被按 UTC 解释。**这些默认不能代表“未知”或“当时已经知道”。** 未知来源时间、无时区／歧义原文应原样保留于映射记录，并标 `partial/unsupported`，不得直接用 null 喂给查询然后把开放窗口写成已证有效。投影生成时间、源可靠留存时间、人／Agent 当时实际采用时间分别记录。[时间模型][release-model]、[时间推理][release-reasoning]

`time_axis='valid'` 取有效窗口，`'transaction'` 取 recorded/superseded；`'both'` 用**同一个 `at_time`**同时筛两轴。它不直接表达“有效于 10 月 1 日、截至 10 月 10 日才已记录”的不同双时点。可在 POC 比较两次原生筛选组合与人工预期，验证实体端点、缺失时间与回溯通知均不丢失；尚未证明组合可用，不以 `both` 偷换业务问题。[时间实现][release-temporal]

原生 `TemporalReasoningEngine.active_at` 的点查询使用 `[start,end)`，并在指定粒度下先截断时间；因此应显式设定精度并测试交接瞬间。范围相交另走 Allen 关系判断，不能以点查询通过推断范围端点已经一致。[时间推理实现][release-reasoning]

### 4.3 来源、更新、失效与重建

`ProvenanceEntry`／`SourceReference` 可保留文档、位置、引用、性质 metadata，且有 valid-time、前版本／派生关系和 tombstone 字段；默认 confidence=1.0 只是数值默认，不证明可信或核实。原文件内容 hash 应继续使用原权威 Store 的实际字节 hash，来源记录 checksum 不能替代它。[来源字段][release-prov-schemas]

0.7.0 `provenance.integrity.compute_checksum` 不覆盖任意 metadata／全部源正文，不能将其声称为完整材料封存；main 已修改 checksum 编码和版本字段，不能宣称0.7.0继承该改动。POC 必须独立核对准确原引用与原 hash，并比较持久读回值。[发行完整性实现][release-prov-integrity]、[main 来源字段][main-prov-schemas]

更新时 `apply_revision` 以运行 now 产生记录时间并保留旧关系；回放已有历史时不能把这个 now 伪装为原 recorded-time。最小 POC 可从固定源版本和其已证时间重新形成一代原生图及快照，逐项核对源 ref／hash／事实身份／时间与映射状态；组件快照重开不等于源文件旧字节恢复，从源重建也不等于业务数据回滚。投影失效不得改 SAP、报告、Case 判断或人的选择。[时间实现][release-temporal]、[来源失效实现][release-prov-manager]

### 4.4 必要路径与结果完整性

原生 `PathFinder` 已提供方向性路径查询，最小工程无需再写一套 BFS。`find_temporal_paths` 有向邻接、边范围过滤和可选顺序限制，但全局 visited 会压缩部分替代路径；`max_path_length` 文档按边数，代码以节点列表长度比较；`temporal_constraints` 未使用。**因此只可把实际返回路径当返回路径，不能宣称已枚举全部反证／全部支持链。** POC 应包含分叉合流、平行边、环和深度边界，用精确事实集合核对；不满足三问所需完整性就列 partial／unsupported，不靠手写查询引擎补齐。[路径实现][release-path]、[时间路径实现][release-temporal]

默认 `enforce_causal_ordering=True` 只检查有效起始时间顺序，不能证明业务因果。对“报告→依据→规则”这类引用关系，POC 应明确关闭这种因果顺序假设或选择原生普通路径方案，再在已筛定子图上验证。Agent 负责选问题／工具／结论，Host 不规划固定推理步骤。

## 5. 静态拟映射表与运行止线

所有行的**实际运行状态都是 NOT_RUN**；此处不出现已接线 `mapped` 回执。

| 目标 | 静态候选评估 | 待验证要点 |
| --- | --- | --- |
| 准确对象／修订／hash／原定位 | 可映射 metadata；原生真实性验证部分支持 | 原源回读、同名不合并、hash 漂移不能静默替代 |
| 显式有向关系及事实身份 | 可映射字典与来源记录 | 同端点同类型的多来源／多版本不被比较函数压平 |
| 已证业务时间与可靠记录时间 | 原生字段可映射 | 显式时区、端点、零长度、OPEN 与 UNKNOWN 分开 |
| 未知／歧义时间 | 原生 null 语义不满足，`partial` | 保留原文；不当开放窗口查询；不补 known-time |
| 不同双时点查询 | 原生单次 `both` 不满足，组合待验 | 两次原生筛选对固定预期、端点及回溯关系的完整性 |
| 必要返回路径 | 原生存在，完整性 `partial` | 反证、分叉合流、方向、深度、平行事实；结果不声称穷举 |
| 持久重开与版本快照 | 原生 SQLite＋create_snapshot 可映射 | 两存储实际内容、失败／取消、重开和旧代保留 |
| 历史更新／失效 | 原生记录存在，历史重放 `partial` | now 与源时间分开；原稿／原Store不变 |
| 从固定源重建 | 候选组合，非开箱即用的项目完整恢复 | 相同源、映射版本和事实集合；不要求生成时间／随机ID伪装逐字节相同 |
| 自动读取任意中文并给出业务正确关系 | 本次 `unsupported` 范围 | 不启抽取／LLM／embedding；不写质量或收益承诺 |

状态词由本项目映射报告使用，不声称 Semantica 原生即输出这些值。判断依据是以上固定实现与 [L1→L2 边界](../fourbase-l1-semantic-trace/component-boundary.md)，属于项目接入推论。

## 6. 下一阶段最小工程验证建议（尚待整体确认）

建议范围只到本树 `.local/fourbase-l2-poc` 工程隔离根，使用合成固定材料；不得让该路径变成正式数据根或默认服务依赖。先固定当前 L1 三问、同名对象、反证与回溯通知，并按同内容／模型／权限／预算对比；不为 L2 加额外事实后宣称减少取材。可先以确定性查询做工程完整性核对，**不把它写成真实模型推理收益**。

依次证明：发行／解释器／完整依赖身份；无模型 extras 的实际导入和副作用；准确来源与两轴语义；必要路径完整性；快照及来源存储重开；更新／失效与从源重建；失败／取消／停用时普通 L1 仍可运行。保留初始失败及 `mapped/partial/unsupported`，至少一个固定关系／时间问题有可核对增益且维护成本可接受才提出正式接线；不预写提升比例。

安装／运行／资源上限、PoC 控制入口、结构及后续产品 UI 以决定包明确授权为准。这里的建议不是已获得组件安装、外部数据库、真实业务／Provider、后台摄取、服务切换、MacBook、Git／CI 或合并授权。

## 7. 本轮完成与未完成

完成：官方 ref／发布元数据刷新；wheel 下载 hash；12 份关键源码与固定 release tag 逐字节比对；固定 main 差异和 API／默认静态核对；本研究文档。

保留读取失败：浏览工具访问 `https://docs.getsemantica.ai/reference/temporal/` 返回不可访问，改用已核官方固定源码，没有据此判定模块缺失；首次猜测 `change_management/storage.py` 不在 wheel，随后从实际目录定位 `version_storage.py`。没有运行安装器或用包 import 试错。

NOT_RUN／NOT_PROVED：安装与完整依赖解析、实际 import、Mac兼容性、模型／中文理解、网络／后台行为、取消／清理、跨存储一致性、重开／重建、三问 L1/L2 对比、资源成本、真实经营收益及用户 Product Acceptance。没有以官网的性能／准确率／合规声明替代这些证据。

## 8. 官方来源

[pypi]: https://pypi.org/pypi/semantica/json
[pypi-page]: https://pypi.org/project/semantica/0.7.0/
[release-pyproject]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/pyproject.toml
[main-pyproject]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/pyproject.toml
[release-temporal]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/temporal_query.py
[main-temporal]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/kg/temporal_query.py
[release-model]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/temporal_model.py
[release-reasoning]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/temporal_reasoning.py
[release-path]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/path_finder.py
[release-prov-manager]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/provenance/manager.py
[release-prov-schemas]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/provenance/schemas.py
[main-prov-schemas]: https://github.com/semantica-agi/semantica/blob/4b6de4e356421f4ff39d7e521b52f321c00b27ff/semantica/provenance/schemas.py
[release-prov-storage]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/provenance/storage.py
[release-prov-integrity]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/provenance/integrity.py
[release-version-storage]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/change_management/version_storage.py
[release-kg-init]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/kg/__init__.py
[release-logging]: https://github.com/semantica-agi/semantica/blob/2a9afec685fe6f4a18350834caed3d6a9affb27a/semantica/utils/logging.py

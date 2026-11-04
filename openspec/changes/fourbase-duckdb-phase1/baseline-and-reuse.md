# 最新 main、文件规则与复用审计

2026-11-04 · v0.2 · 只读核查；当前事实、设计建议与运行证据分开。v0.1审计原件已另存；新增XLSX／MD需求的复用与准确合同见[格式补充](formats-addendum.md)。

## 固定基线与保全

| 对象 | 核实身份／状态 |
| --- | --- |
| 远端main | `git ls-remote origin refs/heads/main`返回`8425ca159bc674b73ad54b80ce523a93b4f3b900` |
| 本机main／origin/main | 均同上；main tree `67a8a14bcd7606df74407f5a6dcaffc58ba119f9` |
| 干净main工作树 | `/Users/bendandebaba/DevWorkSpace/OptraCall`；580份tracked文件已固定hash，不修改 |
| 当前开发树 | `/Users/bendandebaba/.codex/worktrees/5239/OptraCall`，`codex/fourbase-phase01-design`，HEAD`0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`；初始715条porcelain WIP，不清理／切分支 |
| 交集风险 | main较HEAD领先11提交、123文件差异；25处tracked WIP中14处与main重叠。不能拷main文件覆盖现有M2–M7 |

本轮基线[baseline.json](../../../.local/fourbase-modules/m7-duckdb/preparation/baseline.json) 224,978 bytes，SHA-256 `7c21004f23994adef6d5af7252cddf0726e0bbad680fa64971404fad852e87a3`。447份现有工程输入及main580份tracked固定；原M7完整交付与M6证据、保护／批准原件及before全部回读零漂移。8份原M7当前文档另存before；仅3份当前规范／父索引允许新增状态段落，原M7技术文档／研究／主方案v1.2不改。

最新main核查是上述固定时点的源码合同，不代表全部上传格式已实际执行解析或用户验收。开发获准后须重新核main，并以保全的WIP在隔离候选整合，保留双方能力，不在此准备轮做Git写。

## 文件规则矩阵

| 当前入口／所属版本 | 准确规则 | 源码证据／含义 |
| --- | --- | --- |
| main普通项目材料上传 | 每件50 MiB＝52,428,800 bytes；22种扩展名 | `main:src/host/project-upload.ts:2–9`；上传保字节，不等于结构解析 |
| main上传HTTP JSON包 | 特例body上限69,970,604 bytes（base64＋65,536 envelope） | `main:src/host/server.ts`上传专用上限；不是单文件69MB |
| main复制010→020 | 沿project-material50MiB和原类型合同，保source.copy关系 | `main:src/host/project-store.ts:323–363`；不是重新读取一个固定旧版本 |
| main默认text／报告路径 | 默认10MiB仍在ProjectStore，另有HTTP默认JSON64KiB | 不能据旧常量反推普通上传仍10MiB；不同入口各按原合同 |
| main文件读取／观察 | readFile安全路径／O_NOFOLLOW／inode/dev/nlink核验；observeFile按64KiB块hash；无自有文件大小上限 | `main:src/host/project-store.ts:376–398`；“可读取”不等于可进入每一种来源固定入口 |
| 当前WIP M2固定输入 | 020下UTF-8 CSV／JSON、每件10MiB；inputVersion、精确hash及分析副本 | `src/host/project-data-context-store.ts:9–11,153–177`，不在当前main内 |
| 当前WIP M2来源成果 | CSV／JSON／MD／TXT／PY／SQL，单件10MiB、报告＋最多19附件合计50MiB | 同上`:263–318`；下层writeExclusive50MiB不代表上层已放开 |
| M2元数据／providedContext | 原JSON元数据2MiB，providedContext正文20,000 UTF-16 | 容量扩附件不应把整表塞入模型或扩大元数据限制 |
| M4模型可见文本 | 32,768 UTF-16、JSON256KiB及原续读合同 | `src/host/personal-context-reader.ts`；不是上传或DuckDB计算体量上限 |
| native引用 | 最多20 JSONL、总50MiB受控snapshot；Pi bash展示最后2000行／50KiB，结构化full output读取另1MiB | `project-history`／`native-session-snapshot`及锁版Pi原生工具；引用不能保证无限历史或永久完整stdout |

main完整22类型：`.csv .tsv .json .md .markdown .txt .pdf .doc .docx .rtf .html .htm .mhtml .mht .ppt .pptx .xls .xlsx .xlsm .odt .ods .odp`。前6种做UTF8检查，其他保持原字节入口；当前没有`.parquet/.duckdb/.jsonl/.ndjson`。已并入main的上传扩容来自PR #28／commit `4a3be3d36b6c2511635b2c044de2068b6b6ca4df`，对应`openspec/changes/trial-report-20261103-repair/spec.md` TR01。

**本包推荐，而非当前事实：** M2固定CSV/TSV/JSON/MD为UTF8、XLSX为原二进制，均单件50MiB；来源文本成果CSV/TSV/JSON/MD/TXT/PY/SQL单件50MiB、报告＋≤19附件总100MiB。XLSX原件以inputVersion／citation selections保留，不扩XLSX结果附件／导出。由[D02](decisions.md#d02-文件与持久合同)与[补充](formats-addendum.md)确认字段／生命周期，未批准不改实现。main22类型／50MiB及原M2旧事实不变。

## 既有能力与最小差额

| 能力 | 优先复用 | 已核实缺口／本包差额 |
| --- | --- | --- |
| 会话／模型循环／工具／上下文／恢复 | Pi1.4.0原生SDK与统一Interface v3；原owner/profile | 无需另造；DuckDB仅Python库 |
| 执行／资源与停止 | 原bash/Python、公共占用／cancel/drain/close、managed scope／guardian | 私有依赖准确加载及readonly roots按模式最小适配，不另建队列／权限平面 |
| 数据／来源 | 原M2固定版本、声明、分析副本、native与hash；原020/060文件 | TSV/XLSX/MD固定输入、50MiB/文本来源100MiB及v2兼容是明确新增，不冒称Pi官方自动提供 |
| 成果表达 | 原任务／项目成果及原可选“记此稿来源” | 按需依据查看接缝；只显示实际文件／引用内容，不强制运行账 |
| 个人记忆／经验／关系 | M3–M6及原Pi持久会话／人的准确保留 | 本轮不新增记忆、图库、后台摘要或Semantica；与DuckDB可用性正交 |
| main新增公共能力 | 原上传/核算设置、trade-area/weather连接器、前台subagent single/parallel/chain及Provider原生web_search | 获准实施时必须带回并复验，不用旧WIP覆盖新main |

main #30（`f174ebbf7dfd1eb6cd63f4be4a9a013b166d51a9`）的subagent／web_search不能因新库接入丢失：普通与受管ordinary沿原资格，protected／fixed-draft／text-only不自动获新权限；原生search仅当前明确配置的MiniMax/MiMo模型范围，不泛化全部模型。这里是未来整合验收要求，不是本轮改动或实测采用。

代码发现使用当前图`optracall-m7-preparation-20261104`与main图`optracall-main-duckdb-prep-20261104`；指定符号及源码核对，非代码／图未覆盖的配置及字面值再用文件读取。main／runtime两路独立事实审计由准备子Agent完成，不冒充最终非作者完整包审查。

## 依赖候选及限制

只读元数据现场：`/opt/homebrew/bin/python3`为CPython3.14.4 arm64；Apple `/usr/bin/python3`为3.9.6，不能作为静默fallback。已探测解释器未发现DuckDB；不是穷尽本机所有虚拟环境。完整[运行时审计](../../../.local/fourbase-modules/m7-duckdb/preparation/runtime-audit/runtime-audit.md)记录managed解释器、cold与text-only区别、spill／外部访问和证据限制。

候选`duckdb==2.0.0`来自当前[官方Python文档](https://duckdb.org/docs/2.0/clients/python/overview)及[PyPI metadata](https://pypi.org/pypi/duckdb/2.0.0/json)，要求Python≥3.11、非free-threaded CPython。候选arm64 wheel `duckdb-2.0.0-cp312-abi3-macosx_11_0_arm64.whl`，17,597,612 bytes，SHA-256 `b5d758b53751c930e09d371230241005ea5203c8edc65a1e1fafca83fcc906ef`。这是metadata身份，**未下载／安装／import／运行**；abi3候选与本机实际加载兼容待后续证实，不凭版本名称保证。

复用[原M7官方研究](../fourbase-optional-engines/research.md)，本轮针对[Python API](https://duckdb.org/docs/2.0/clients/python/dbapi)、[配置](https://duckdb.org/docs/2.0/configuration/overview)、[安全模型](https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/overview)与[venv生命周期](https://docs.python.org/3/library/venv.html)补足直接相关差额。DuckDB有原生计算／参数绑定／连接能力，不提供OptraCall的来源声明与UI合同；Pi提供运行基础，不自动提供业务字节固定或升级全部profile。

Host不接管SQL决策、关联键、口径、核算结论、是否使用DuckDB或异常后的方法调整。额外扩展默认禁自动安装／加载，普通连接配置不是不可绕过的沙箱；in-memory仍可能spill，memory_limit不是RSS硬限。第一版不新增网络入口、隐式安装或“read_only保证所有原件”的误导。

v0.2新增只读复用核查：领域资产coupon-forecast已使用openpyxl，原requirements为`openpyxl>=3.1`且没有锁版。本机解释器下发现openpyxl3.1.5／et-xmlfile2.0.0元数据；pandas未发现，不为本需求新增。建议应用私有环境锁这两个已有版本，不把全局site-packages当产品依赖。XLSX原件固定仍是新接缝；旧脚本active sheet/表头/data_only假设不是通用合同。Markdown可沿原Pi文本与UTF16来源语义复用，但原M2尚不能固定MD输入。完整[专项审计](../../../.local/fourbase-modules/m7-duckdb/formats-preparation/reuse-audit.md)与[公开发行物／公式限制](formats-addendum.md#现成能力依赖与计算限制)分别列证；无第三方import／真实文件读取或安装。

## 未证明的事项

真实安装／ABI加载、受管环境闭包、任何查询正确性／并发／取消／保存、所有格式实际解析、性能／资源增益、真实Provider和业务效果、用户产品验收均未由本轮审计证明。普通文件上传50MiB的源码事实也不等于DuckDB或M2已扩容。准备包与Demo的实际核验／独立复核状态只以[结果](result.md)为准。

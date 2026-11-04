# DuckDB 第一版 D01–D06 决定包

2026-11-04 · v0.2 · **6项具体合同待确认，0项本包已整体批准；用户已接受大方向并要求增加XLSX／MD输入。** 原v0.1保留为历史，受影响字段与行为见[格式补充](formats-addendum.md)。

与[spec](spec.md)、[UI Demo](../../../docs/prototypes/fourbase-duckdb-phase1-ui-demo.html)一并整体审阅。[可浏览／打印摘要](confirmation.html)。不要求用户逐字段设计；采用现有 M2 结构，仅将真实差额明示。推荐均为A。

## D01 环境与执行方式

**建议A：应用私有锁版 Python 依赖，经原 Pi bash／Python 自主调用 DuckDB；不新增 Runtime 或 SQL 服务。** 依赖候选为现有 CPython3.14.4 arm64＋duckdb2.0.0，锁解释器／发行物hash与实际import路径，实际运行通过后才标相应模式可用。安装维护由工程承担，不改全局site-packages，不把虚拟环境建在业务020／060，不让每个任务重复安装。

v0.2为XLSX复用现有openpyxl能力，将openpyxl3.1.5／et-xmlfile2.0.0一并列为私有锁版候选；已有本机元数据／领域脚本不等于应用已接通。Agent选择sheet／范围及是否派生表，Host不转换／重算，不新增pandas或额外Excel扩展下载；具体发行物与限制见[补充](formats-addendum.md)。

原因：填补现有计算库可用性，复用Pi1.4.0和Interface v3的会话／工具／恢复；可共享只读依赖，同时每执行连接／spill独立。依赖升级建新候选，现有运行资源留原环境；失败报告准确不可用，不暗换解释器或版本。

替代B：新增专用SQL服务／持久共享库——多一套协议、资源与恢复，当前没有对应缺口依据。替代C：只写安装指南、让人逐任务建环境——降低工程投入但增加用户操作，接线一致性不足。

## D02 文件与持久合同

**建议A：保留main普通上传22类型/50MiB；M2固定输入扩为CSV／TSV／JSON／MD文本及XLSX原二进制，每件50MiB；来源文本成果／附件增TSV、每件50MiB、报告＋至多19附件合计100MiB，并显式v1/v2兼容。** XLSX原件通过inputVersion／citation selections回查，不扩XLSX结果附件／导出或任意二进制成果；MD按文档读取，需抽表时由Agent处理。Parquet／`.duckdb`／JSONL等原暂缓范围不变，Word／PDF上传不等于本版SQL表。

原因：当前main上传已扩容，M2固定合同尚未同步；50 MiB对齐当前本地文件入口，100 MiB容纳最大结果与SQL／参数等小附件。仍有明确容量上界，不把引擎能力当产品入口已支持。若以后实际规模需要更高限额再单独按证据调整，用户不为此维护机器字段。

替代B：保持M2 CSV／JSON10 MiB，DuckDB只读普通文件，超限结果只保普通文件——最少结构改动，但上传后不能同范围固定依据；须持续明确两套能力。替代C：立刻接入Parquet及所有Office固定解析／大容量——扩大解析、二进制与兼容面，超出本版已证实最小差额。

### 完整最小合同（本项整体确认，尚未实施）

| 类别 | 明确约定 |
| --- | --- |
| 业务对象／owner／粒度 | 沿原项目拥有的dataset；每份精确字节为一个inputVersion；一次数据说明为一个descriptionRevision；一次报告＋附件来源声明为一个citation。引用与事实／正确性分开；无DuckDB运行实体／新记忆对象 |
| 身份／去重 | projectId、datasetId、inputVersionId、descriptionRevisionId、citationId、operationId及原sourcePath/uploadId继续原义；operationKind／requestFingerprint／baseIndexRevision／resultRef沿原幂等及CAS。不按文件名／报告结论猜同一版本，旧operation重读先返回原身份，不另造新计算 |
| 新增范围字段 | 原schemaVersion读1/2，新显式写2；observation.format增tsv/xlsx/markdown。位置增tsv-column（原零起点列号）、xlsx-range（精确sheetName＋有界A1 range）、text-range（原UTF8解码文本UTF16半开start/end，保BOM/CRLF、不拆代理对）。格式／位置与精确版本匹配，完整字段／边界见[补充合同](formats-addendum.md#d02-的最小结构增量)；CSV／JSON位置不变 |
| 其余字段组／null／默认 | 原name/sourcePath/sourceNote/uploadId、sha256/bytes/evidencePath、时间、observation覆盖／行数／限制／native或artifact引用、statement语义与确认、mapping争议、citation声明／附件／来源均原类型、必填及null语义；不新增业务必填字段、推断引擎默认值或自动确认。空信息保留unknown/null／原空集合含义，不填造版本与参数 |
| 数值／格式校验 | v1读验仍旧格式及每件10MiB／总50MiB；v2固定CSV/TSV/JSON/MD为UTF8、XLSX按二进制，均每件≤52,428,800 bytes；来源文本CSV/TSV/JSON/MD/TXT/PY/SQL每件同上，报告＋≤19附件合计≤104,857,600 bytes。不扩XLSX结果附件。原件bytes不是解压体积或内存限额；超限无成功部分发布 |
| 存储／关系／权威 | 不新增目录／表／索引类型；原项目M2 index→版本／说明／citation精确ref和recordSha256，说明属于一个inputVersion，citation保留其准确selections／conceptRefs／sapRefs／native引用。原引用方向、数量预算及现有版本关系不变；无跨库级联删除 |
| 写／读入口 | 沿原freeze-input、save-description、record-citation及其HTTP／客户端；Agent经原授权方法产出文件，Host原子固定和回执。summary／精确版本／原providedContext与原成果查看沿同一reader；UI不另维护SQL／版本权威 |
| 版本／生命周期 | 新reader接受旧index／records 1及新2；只读不迁移。第一次显式新写用原原子事务把index升2，旧record/证据仍原字节、hash和fingerprint；v1/v2可以混合引用，现有最新说明指针按原显式写规则维护，不回填历史 |
| 回执／并发／审计 | 原operation幂等、CAS、pending恢复、独占写、hash／owner／路径检查、归档只读保持。回执丢失先只读查同operation，不重算，不拿当前文件替旧不可变字节。原元数据2MiB等不随附件预算上调，达到既有限额准确报错 |
| 兼容／回退 | 新兼容代码继续读v1/v2；可停DuckDB新资格及v2范围新写，不改旧／新记录。旧二进制读v2不保证；不能downgrade／覆盖／恢复旧副本来伪造兼容，停库仍可读已固定文本成果 |
| 跨库／后续 | SQLite及M3–M6原权威不变；SAP／Case仅保原准确引用，不建新OntoBase／Semantica或全表搜索。容量与五类固定输入属本期；更广格式／持久DuckDB库／Excel重算与XLSX结果导出属后续 |

完整类别已覆盖。新增字段仅为上表的格式与来源位置联合分支；无新主键、业务实体／关系、删除机制、时间有效窗口或物理索引，原因是本版扩原证据合同而不增加业务实体。其余字段组原义保留；若实施遇到其他结构缺口先补受影响决定，不能在代码里猜补。

XLSX／MD的原件、派生表、字段位置及纯MD默认unobserved/空fields/null行数及实际表格观察的范围／计数语义以[完整格式补充](formats-addendum.md)为本项组成部分；不新增转换manifest或机器自动核验血缘。输入文件存在、Agent已读、声明采用与实际留存分开，普通分析不要求先做字段映射。

## D03 来源与成果表达

**建议A：复用原普通文件＋Pi native＋可选M2 citation，按实际记录按需展示计算依据。** Agent提供SQL／脚本、参数、真实engine/client／扩展版本、配置与结果；Host核归属／字节／hash／固定副本和回执。没有的字段明确未记录／片段／无法核定；完整材料未固定就不宣称永久留存。

原因：已有`.sql/.py/.json`与原生引用够表达第一版，无需强制RunManifest／RunStore或Host解析推断SQL。普通分析不中断，用户无需补技术字段。需要长期留存时仍可用原“记此稿来源”，保留报告／附件准确版本。

v0.2另要求：XLSX原版本及Agent实际声明的sheet/range、MD原文／片段与可选派生表／SQL／脚本准确对应。公式缓存新鲜度未核定、映射或版本未记录时如实显示；不从读取成功推断公式已重算，不由Host推逐行来源。

替代B：新强制运行账／统一manifest，规定每次SQL必过Host代理——多出权威与重复机制，也易固定Agent执行方法。替代C：只放聊天片段——改动少，但无法诚实提供长期完整依据。

## D04 权限、资源与失效

**建议A：仅在原资格内提供库，沿Interface v3管理占用／取消／收尾；每执行私有连接与临时目录，失败交回Agent。** managed普通／protected／cold分别核依赖加载与原scope；cold计算不冒充封闭文本，fixed-draft/text-only维持无执行。普通unmanaged原软约束不夸成安全隔离。显式关闭额外扩展自动安装／加载，不引入新下载／凭据或全局沙箱。

原因：环境治理是Host责任，业务计算是Agent责任。原公共生命周期可复用；受管环境venv加载是真实接缝，须最小验证，不能自动回退或扩大权限。取消不等于成果回滚；部分输出、失败和UNKNOWN保留，未核收净不冒称idle。环境预算设定用实测，不做方法次数配额。

替代B：新DuckDB队列／连接池／cancel管理——重复状态与跨owner风险。替代C：将所有会话自动授执行权或失效后回退unmanaged——扩大原权限，拒绝。

## D05 用户路径与UI

**建议A：原任务问答＋原成果文件，按需展开“查看计算依据”，正常新增必做操作0。** 不新增数据库控制台／引擎选择／SQL必填表单；评审情景开关仅Demo。已有上传不多确认一次，已有可选来源固定仍可选；真实异常准确说明，不让人维护每日资料或机器日志。

原因：能力应在现有工作中自然获得，技术依据只在用户需要时出现。界面将安装可用、实际采用、固定副本、结果核查分开；执行失败不等于旧成果消失。所有Demo值／操作为虚构内存，不冒充已接线。

替代B：新增SQL工作台并要求选择引擎／映射字段后才能分析——增加操作且把Agent工作转给人。替代C：完全隐藏来源／异常——操作少却无法核查，不推荐。

## D06 实施、保全与验收

**建议A：先保全当前M2–M7，获确认后在隔离候选整合最新main，再逐片RED／实现／工程与非作者验收，性能效果另证。** 不在本轮merge或拷main覆盖WIP。保留main新上传、核算设置、连接器、原生subagent/web_search及profile差异；完整旧FAIL／UNKNOWN／M31 NOT_PROVED不重标。

原因：main领先当前HEAD 11提交、14处tracked WIP重叠，直接覆盖会丢已有能力。准备通过不是运行／专业验收。测试按实际合同覆盖正确性、取消、并发、原件／历史、保存重开和消费者；使用相同合成输入与结果口径比较方法，可能持平／更慢，不预设提速或“自动验证正确”。

替代B：直接更新当前dirty树／整仓覆盖——风险高且违反保全。替代C：跳过main独立开发后再合——推迟已知接缝风险，不推荐。真实Provider／业务dataRoot、Git／CI、运行采用及MacBook不由本确认包自动授权。

## 决定台账

| 序号 | 主题 | 推荐／理由 | 用户具体决定 | 一致性 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | 环境执行 | A；复用原Pi/Python、私有锁版依赖 | 本具体包待回复 | 待比较 | 待确认 | [审计](baseline-and-reuse.md)／原已接受方向 |
| D02 | 文件持久合同 | A；五类固定输入50MiB、原文本来源100MiB、明确v2兼容 | 用户要求增加XLSX／MD；具体合同待整体回复 | 需求已纳入，合同待比较 | 待确认 | [当前入口](baseline-and-reuse.md#文件规则矩阵)／[格式补充](formats-addendum.md) |
| D03 | 成果来源 | A；原文件/native/可选citation足够 | 待回复 | 待比较 | 待确认 | [spec §3.3](spec.md#33-证据留存与准确展示) |
| D04 | 权限生命周期 | A；原scope/v3、最小环境加载适配 | 待回复 | 待比较 | 待确认 | [审计](baseline-and-reuse.md)／[spec §3.2](spec.md#32-ownerprofile取消与环境治理) |
| D05 | UI低操作 | A；原问答＋按需依据，新增必做0 | 待回复 | 待比较 | 待确认 | [UI审阅](ui-review.md)／Demo |
| D06 | 实施验收保全 | A；隔离整合、分级验证 | 待回复 | 待比较 | 待确认 | [验证协议](evaluation-protocol.md)／原保全清单 |

请整体确认v0.2 spec、D01–D06推荐A（含格式补充）及UI；如需调整列对应项号即可。本次只准备确认包，不因推荐或演示点击推断已经批准。

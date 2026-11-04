# DuckDB 第一版本地开发与验收记录

2026-11-04 · v0.2 · **本地开发与工程收尾完成；用户已明确接受E01/E02限定例外及D04增量，原失败、NOT_PROVED和保全缺口保持。Git/CI、运行采用和产品验收另计。**

已实现Pi原工具中的可选锁版DuckDB／openpyxl、五类精确固定输入、M2 v1/v2及50/100MiB合同、原成果/SQL/参数/版本依据与只读原请求核收。所有unmanaged保原Python与包能力，私有解释器由Agent自主选择；受管权限沿原工具，不新增用户配置步骤或SQL执行器。

最终`npm run check`：1,304项／1,301通过／0失败／3原条件跳过，类型和生产构建通过；真实隔离合成Host/Pi实际计算与保存/重启、真实App/Host6项和新fp组件6模式通过。非作者F2/F3/F4功能问题已分别修复独立复验。完整候选、保全范围、各次真实RED、原失败、验证范围与最终非作者/四原则记录见[实施记录](implementation.md)。

**已获限定接受，原缺口保留：** 初始保存核收TDD仍NOT_PROVED；历史.local测试生成包前字节仍无法核定；原DuckDB默认关闭保证未满足。用户已明确[接受三项限定处理](accepted-limitations.md)：本次E01/E02例外允许本地收尾，D04当前合同改为按原权限/环境说明/显式连接关闭，不保证全局强制。接受前[原提案](pending-acceptance-decisions.md)、原非作者报告及所有失败不改写为技术通过。native临时配额FAIL／NOT_PROVED保留；小样例DuckDB更慢、RSS更高，无普遍性能／真实专业收益保证。Git/CI/合并、运行服务/MacBook和用户产品验收未操作。下文完整保留确认前准备历史，不作为本地开发停止线或当前成绩。

## v0.2 格式增量准备（确认前历史，原字节已固定）

用户在v0.1待确认包上提出新增XLSX／MD。已完整回读原11候选、447工程、580 main文件、116准备证据与13图零漂移，11候选原字节保存于`.local/fourbase-modules/m7-duckdb/formats-preparation/before/`；原v0.1交付与全部失败保留。不是追认原具体合同获批。

[格式补充](formats-addendum.md)将固定输入范围扩为CSV／TSV／JSON／MD文本与XLSX原二进制，每件50MiB；原报告及文本附件七类／单件50MiB、合计100MiB保持。XLSX原件以inputVersion／citation selections精确关联，不扩XLSX结果附件／导出。复用Pi原Python及既有openpyxl能力，建议锁应用私有依赖；Agent选sheet／范围和是否派生表，Host不自动转换或重算。MD保持文档角色，原文位置与派生来源分开，纯文档不伪造表结构。新增位置联合类型等完整差额在D02与补充内明示。

本轮只改本确认包、虚构Demo与3状态索引，未改源码／测试／依赖／schema，未第三方import、读业务文件或运行引擎／Host／模型、安装／Git写／CI／服务／MacBook。原包PASS限原候选；v0.2已完成相称静态、作者浏览器增量及非作者复核，限增量准备范围通过，无剩余必须修复项，未将旧107／19结果直接套到新字节。整体包仍须用户确认后才开发。

v0.2 F1前Demo为58,166 bytes，SHA-256 `8f071bc6beb4d015d54ecec30bdaa479bdf6a85d589dc4728d85abdcbd1a33fa`；[作者增量QA](../../../.local/fourbase-modules/m7-duckdb/formats-preparation/ui/qa-summary.md)55项通过、0页面错误／网络请求，覆盖新XLSX／MD情景与缓存、三项新边界样例、受影响旧主路径及桌面／390／320窄屏，8张新图另存不覆写旧图。首轮脚本跳过前一步而点被正确禁用的第三步导致超时，原脚本／JSON／失败图保留；修脚本顺序后同一HTML身份55项通过，不记产品RED或产品功能验证。专项复用审计已记录本机元数据／领域脚本与未接通的固定输入差额，最终完整v0.2包的非作者审阅另记，不以专项审计替代。


非作者在v0.2首个固定包中发现F1：MD dialog只显示标题／行号，可能被读成持久位置权威，与D02 UTF16半开span不一致。原反例与58,166-byte全文保留，Demo仅澄清准确inputVersion＋text-range、标题／行号为派生展示、缺失不补造。修后58,542 bytes，SHA-256 `ad88a76a5323963aac735e89832f59e0c0acce9bc5a7f4a6e34f2e04618be994`；[作者F1定点QA](../../../.local/fourbase-modules/m7-duckdb/formats-preparation/ui/f1-qa-summary.md)27项通过、0页面错误，390/320 modal／键盘／Escape通过，原55项与失败场景保留；非作者已在此固定身份实际复验关闭F1。补充同时明确Host不自动发起重算，不剥夺Agent在原授权和原件保全内用已有方法核算的自主性。

v0.2[完整增量复核报告](../../../.local/fourbase-modules/m7-duckdb/formats-preparation/review/independent-formats-review-v2.md)4,871 bytes，SHA-256 `91a6bd7132e460f1953995fdeff51334889b79be50e082199778f3f3a019db11`：规范／规格／结构及四原则限本增量准备通过，无剩余必须修复。固定候选`formats-preparation/review-candidate-v2.json`为215,947 bytes，SHA-256 `1d1f60a7f7fbfdae9ef45fcf3c94ce95e6dfc9f61580002ce5bc2f345d078a4e`；完整12文件180本地链接／锚点有效，独立10组实际浏览器全部通过（0错误、仅本地HTML），覆盖新增格式、原件／派生／缓存、F1及新边界、受影响正常／键盘／390/320与摘要。447工程／名称、580 main及旧11before／116证据／13图／旧manifest全部零漂移，未重复旧19／107检查。收尾仅本result及3状态索引变化，另固定核收；技术包与UI冻结，原失败和专业NOT_PROVED保持。**v0.2具体合同与UI仍待整体确认，产品／引擎／兼容／性能尚未运行验证。**

## v0.1 准备与复核（历史，原字节另存）

用户已接受经Pi/Python提供可选DuckDB的方向，本轮明确只准备spec/UI、核最新main文件规则并保留现有成果。已固定当前开发HEAD与715条初始WIP、main／origin/main／远端main身份及干净main580 tracked文件，447份现有工程源与原M7完整交付回读零漂移；详情见[基线及入口审计](baseline-and-reuse.md)。旧M7延期判断保留，本轮只开计算方案准备，关系／Semantica及M8未启动。

已形成[spec](spec.md)、[D01–D06](decisions.md)、[摘要](confirmation.html)、[可点击Demo](../../../docs/prototypes/fourbase-duckdb-phase1-ui-demo.html)、[UI／四原则检查](ui-review.md)与[未来验证协议](evaluation-protocol.md)。推荐复用Pi1.4.0／Interface v3、原Python／native／M2／成果，不新建SQL服务／运行账／记忆库。M2 CSV/TSV/JSON50MiB、来源单件50MiB/合计100MiB及v2兼容为**待确认设计**，不是main已有或已实现能力。

## 当前点验

作者静态核对v3的9份Markdown，144本地链接全部通过（初次文件齐备时为143）；HTML摘要／Demo的6处路径与锚点通过。摘要在1440／390／320深浅色6种组合无横溢出／页面错误／网络请求。Demo作者实际浏览器107项全部通过，涵盖9情景、上述6种视口主题、原生dialog／键盘／Escape，0页面错误／网络请求；完整[QA摘要](../../../.local/fourbase-modules/m7-duckdb/preparation/ui/qa-summary.md)。最终Demo49,720 bytes，SHA-256 `7e7542ce96a062f35cd96b00c49785b896eb27569652f0d725e31400c0747617`，只读冻结并经非作者验证。

原稿与首轮证据保持。初轮链接扫描遇到4处尚在并行创作的Demo路径缺失，待文件创建后143/143通过；初轮冻结脚本用git枚举遗漏既有ignored pyc，实际文件在场且447份hash均匹配，修正目录枚举后447/447无新删改。两者是准备工具／先后顺序问题，不冒充产品RED。

## 完整确认包独立复核

固定v3[候选清单](../../../.local/fourbase-modules/m7-duckdb/preparation/review-candidate-v3.json)216,454 bytes，SHA-256 `c81f3e513a29441010eb5580c40eb3258923448d388133a2cfd3252ef3736750`，11份原字节另存candidates/v3。[全新非作者报告](../../../.local/fourbase-modules/m7-duckdb/preparation/review/independent-preparation-review-v3.md)完成规范／规格双轴、完整结构合同、事实、保全与四原则专项：**限本轮spec／虚构内存UI准备范围通过，无剩余必须修复项**。

独立实际浏览器19组PASS／0FAIL，覆盖普通提问、准确SQL／分析副本／native及自愿来源固定、Python／零计算、缺依赖、取消与旧稿、原版本、ACK只读核收、缺项、资格、类型容量、键盘／modal与390/320深浅色及摘要。0 console/pageerror，仅本地HTML请求。首轮6组因同名按钮定位器strict-mode报错，保留原脚本／JSON／失败图；限定原对话区重验后全部通过，同一Demo字节未改，不计产品RED。

独立完整11文件150处本地链接／锚点通过；447工程身份与名称、main580文件及干净状态、5旧M7技术文档、8本轮before、20旧M6文档、20保护／8M6批准／8M5批准、53旧M7证据／1106M6证据／42图／5构建／23及466before全部零漂移。main只读远端查询仍为`8425ca159bc674b73ad54b80ce523a93b4f3b900`。第2节起工程规范字节不变，AGENTS和主方案不改。

收尾仅本result与3份状态索引记准备完成／等待确认，完整技术spec／D01–D06／摘要／Demo不再变化；收尾另固定并限范围核收，最终清单及核收见本准备证据目录。**6项具体决定仍待整体确认，未获确认前不进入产品开发。** 不将准备、原型或独立PASS写为任何安装／产品／性能／专业质量验收。

当前仅写本包、Demo和隔离准备证据，并补规范第1节／父tasks/result当前状态。工程源码／测试／依赖／schema、AGENTS、主方案v1.2、旧批准／M7技术文档与证据不变。未安装/下载wheel或运行DuckDB/SQL/Host/Pi模型，未访问真实业务根／凭据；Git写／CI、运行服务、MacBook均未操作。引擎兼容／查询／性能／取消／产品验收全部NOT_RUN，旧专业FAIL／UNKNOWN／M31 NOT_PROVED保持。

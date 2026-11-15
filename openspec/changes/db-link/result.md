# db-link 设计准备记录

2026-11-13 · 当前状态：确认包已完成；待用户确认，产品实现未启动。

## 授权与候选

用户要求按已讨论方案准备spec和UI Demo，覆盖连接、多项目复用、自主取数、数据说明、Studio与核算完整流程，四原则自检后交用户确认；数据库类型与组件选型后置，暂不开发。

源码基线：`OC｜db-link` / `ef3e7d0b8703a6e22023e8099a56c542d484a69d`。开工工作区干净。允许修改本目录与`docs/prototypes/db-link-ui-demo.html`；产品源码／依赖／配置／服务／业务资料与真实模型不在本轮范围。候选最终摘要、作者点验和非作者结论将在实际发生后追加，不预写PASS。

## 执行与检查

- 已读工程规范、产品责任原则、连接器标准、统一会话接入及核算合同，并用当前代码图核对真实差额。
- 已读design-md-governance、saas-product-ui-system及中央fallback、fixing-accessibility。根级DESIGN.md缺失，本原型复用现有OptraCall界面及中央标准，不新增产品设计系统。
- agent-browser命令不可用，未安装；浏览器点验使用现有CUA能力。
- spec、UI合同及交互矩阵已形成初稿；独立Demo制作中。

## 本轮完成范围

作者浏览器点验、链接／语法检查、四原则专项、固定候选及全新非作者只读复核已完成，详见下方最终记录。用户确认仍待进行。设计证据与产品实现／运行采用／专业验收分别报告。

## 用户确认

待确认；尚无本确认包的用户批准记录。后续用户决定需绑定候选身份原文记录，不能从本准备任务推导实施授权。

## 基线纠正（准备中发现）

前轮讨论引用了旧独立／自动核算合同。当前源码 `server.ts:322–336` 及已交付 RCR／CNR 显示：普通conclusion任务unmanaged，报告计算复核同父请求一次、结论审查独立发起，legacy旧设置仅历史兼容。已据此修订spec DB11／DB12及D03、UI与状态矩阵；数据库独立冷读／自动修订保留为本次新增设计候选，与现行默认计算复核准入择一，不复活旧写接口。此差异纳入用户审核与非作者复核。

## 首轮作者检查（初稿，不能继承为最终结论）

- HTML初稿64,756字节，提取内联脚本后 `node --check` 通过；无fetch／XHR／WebSocket／localStorage／sessionStorage和远程资源引用，CSP禁止网络及表单外发。
- CUA原生Chrome经仅静态预览 `127.0.0.1:8776/db-link-ui-demo.html` 实际发送例题，观察到模拟Agent活动、查询结果、固定材料和报告。未运行产品Host、真实模型或数据库。
- 初稿待修正：核算文案尚未区分现行RCR／CNR与新增候选；合成金额与spec未统一；默认已授权项目仍在发送时再次询问模型出口。已交原型作者修正，最简种子路径应直接发送，首次项目授权可合并模型A出口。以上初稿观察不作最终通过。

## 首轮独立复核发现（初稿，保留）

全新非作者从验收预期检查实际原型，发现：

- F1：查询完成时读取全局连接配置，运行中配置变化可把旧查询标为新来源（DB03／06／10）。
- F2：撤权后查询／自动回调可能继续保存；UNKNOWN不阻止新请求覆盖旧operation（DB14）。
- F3：模型出口同意保存在任务而非项目范围，新任务重复确认（DB03／15）。
- F4：重查覆盖当前结果／说明，报告版本和路径重复；旧报告准确来源缺少回看入口（DB07／08／10）。

以上为初稿“不通过”事实，已交原作者评估修订，最终复验另记，不覆盖初次发现。

## 增量复核发现（中间候选，保留）

- F5：初稿存在无准确版本的“正式口径引用”示意；后改为候选映射／尚未绑定正式版本。
- F6：自动模式最初只自动启动核算，反馈／另存新稿与知情复查仍需点击，未满足DB12一次设置后的完整衔接。
- F7：核算运行时可发送新问题，替换当前核算引用使历史运行记录悬空。
- F8：手动独立核算后下一普通请求未复位计算核验合同。

F6–F8已交原作者评估修正，候选解冻，原冻结摘要只对应中间版本。独立VM曾报告中间稿pr未定义及一项旧说明定位断言错误，分别为变化中间稿执行错误和检查定位问题，不伪作产品TDD RED；最终须按新摘要复验。

## 最终候选与检查结论

确认包v0.1。HTML SHA-256：`364d8e942a0f5e49724cd21c4bb386fc5afee16d6e6ff1f0c7d1fbcc2ab29337`（75,334字节），spec/UI/矩阵/HTML逐件身份见[candidate-manifest.json](candidate-manifest.json)。本记录和外部检查报告是证据索引，不参加核心四件候选摘要以免循环引用。

- **作者静态检查：通过本轮准备范围。** 当前30个本地文档链接可达；脚本提取后`node --check`通过；无尾随空白、网络/存储调用或外部资源引用，CSP禁网络。未运行npm产品测试/构建或CI，因为无产品源码/依赖变更。
- **作者实际浏览器点验：通过所列路径。** 已走默认直接提问、自动候选完整链、固定材料/数据说明、Studio预览取消与正式发布、跨项目授权、配置测试失效、取消UNKNOWN、归档只读和桌面/390px浅暗呈现。[浏览器记录](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-review/browser-verification.md)区分各轮观察与适用范围。
- **全新非作者：通过设计准备范围。** 最终HTML独立最小DOM VM **20/20通过**；F1–F8与停止历史/保存提示呈现问题闭合，原失败留存。复核者未参与候选创作，未继承作者会话。[完整独立报告](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-review/independent/independent-review.md)及同目录分轮JSON保留。VM不等于真实浏览器、Host或数据库验证。

## 四原则专项最终检查（限本确认包）

| 原则 | 规格与实际动作证据 | 结论与边界 |
| --- | --- | --- |
| Host管环境 | DB01–03、06–07、14–15；测试后改配置拒绝保存，撤权/UNKNOWN不续派，按原请求保存来源 | 设计通过；真实权限/凭据隔离与远端收尾未实现未验证 |
| Agent自主执行 | DB04–05、11–13；自然语言入口、活动标模拟事实，意见回原Agent，新稿另存 | 设计通过；不设业务SQL/固定专家链/专业PASS，模型自主质量待真实验收 |
| 优先复用官方已有能力 | DB18；官方Pi1.4.0/Interface v3、现有文件/说明/Studio/RCR/CNR与旧v3机制的边界分清 | 设计通过；DB/组件未选，不改SDK、不新增Runtime，具体可纳管接缝待实施证明 |
| 减少人类操作 | DB02–03、07、12；项目授权合并模型出口、任务继承、已授权直接发送、自动候选不需再点反馈复查 | 设计通过；必要凭据/范围/不可代猜业务决定保留，旧legacy开关不恢复 |

专项未见剩余必须修复的设计问题；通过的是spec/UI及原型操作反例，不是产品权限、兼容、专业效果或用户验收。

## 审核入口与待确认点

- [可点击离线Demo](../../../docs/prototypes/db-link-ui-demo.html)，直接浏览器打开即可，刷新重置；当前另有仅静态本机预览 `http://127.0.0.1:8776/db-link-ui-demo.html`。预览不是产品Host，停预览不影响离线文件。
- [spec](spec.md)的D01–D03与[UI合同](ui-spec.md)、[状态矩阵](interaction-states.md)供整体审核。尤其D03：默认沿现行报告计算复核/结论审查，数据库独立核算与自动修订为新增设计候选，同请求择一；旧链历史只读。
- 数据库类型、官方组件及精确版本、真实只读/取消/一致性能力继续后续讨论。没有安装、真实DB/模型操作、产品开发、Git交付、运行采用或MacBook更新。

用户尚未批准本确认包；等待具体版本确认。源码HEAD和分支未变，工作区仅新增本确认包与独立Demo。

## 用户确认与选型讨论（2026-11-13）

用户原文：“spec 和 UI Demo 通过，接下来讨论首批支持的数据库类型和连接组件选型，按四原则优先评估成熟方案，暂不开发。”

已核四件获批候选与candidate-manifest摘要一致，确认记录及准确身份见[approval.json](approval.json)。上文“待确认”保留为当时准备状态；当前spec/UI设计已获批准，原件/摘要不改。用户授权继续首批数据库与成熟连接组件的资料调研和讨论，尚未指定类型或采用组件版本，未授权产品实现、组件安装/升级、真实数据库/模型、Git交付或运行采用。调研结果另存，不覆盖已批准合同。

## 首批数据库与组件调研（2026-11-13，讨论建议）

用户补充首批优先“订单、会员、库存等业务库”。已按research流程并行查阅官方文档、固定发布源码和本仓Pi公开工具接缝，详见[选型调研](selection-research.md)。当前建议先讨论MySQL＋PostgreSQL，SQL Server按已有业务需求扩展；组件比较倾向成熟pg／MySQL2驱动加OptraCall最小工具适配，DBHub保留MCP备选，Toolbox与DuckDB远端扩展按相应场景评估。

以上是基于已批准完整合同的工程推断，尚无用户对类型、具体组件或版本的采用决定。数据库只读、操作取消、固定结果、类型／时间精度与受管接缝均未做真实验证；现有Pi／Semantica／Python依赖保持。原获批四件候选逐项回核无漂移，未开发、安装、连接业务库、调用模型或执行Git交付。

## 驱动选型补充准备（2026-11-13，暂不开发）

用户明确首批MySQL／PostgreSQL及成熟驱动薄适配，原文与授权范围见[selection-decision.json](selection-decision.json)。先前研究中的待选措辞保留为历史；精确驱动版本和新细节仍待确认，原[approval.json](approval.json)仅批准spec／UI。

本轮目标：提交具体驱动版本、实际连接权限、远端取消、精度与既有数据说明／Studio／核算接缝的可审阅补充，按四原则自检和全新非作者复核；不开发、不安装或操作数据库／模型。

| 阶段 | 完成条件 | 状态 |
| --- | --- | --- |
| 官方来源与本仓现状 | 固定发布身份与源码，逐项区分公开能力／缺口，核对现行RCR／CNR及公共接入 | 已完成只读研究；见[版本证据](driver-versions.md) |
| 补充合同 | 明确权限域、取消终结事实、参数／结果精度和受管文件集接缝；保持已批四件原件 | 已形成[补充v0.1](driver-selection.md)；具体细节待用户确认 |
| 作者自检 | 四原则、引用／范围／历史一致，批准四件摘要零漂移 | 已完成revision3最终回核，见下方实际检查；仅文档范围 |
| 全新非作者复核 | 无候选创作史／不继承作者会话，独立查关键正常与失败条件，修正后重验 | 已完成revision3独立复验，F1–F3关闭；无剩余本轮必须修正文档项，仅文档设计／证据一致性通过 |
| 用户确认 | 明确批准的精确版本／合同；不把确认误作开工 | 待用户确认；继续暂不开发 |

本轮新增材料的固定身份另见[driver-selection-manifest.json](driver-selection-manifest.json)。此说明与后续检查报告仅为证据索引，不纳入候选摘要以免循环引用。

### 驱动补充的独立发现与修正（保留初轮问题）

- F1／来源对象：初稿manifest未区分元数据实际观察、Agent声明依赖与未知；已分列，明确复杂表达式／视图／函数不由返回列推断完整读取图，不自建SQL parser。
- F2／预算：初稿“Agent不能关闭上限”缺可执行前提；已补SET／set_config／事务变化及MySQL MAX_EXECUTION_TIME／SET_VAR覆盖等反例，原生／既有受信约束无法强制预算时不准入，不用Host改SQL或人工补动作掩盖。
- F3／TLS：初稿将两个验证true过度概括为目标名必然正确；已结合mysql2固定源码和Node25.9.0 TLS／IP路径，限定首期DNS及实际CA／SAN正反例合格的准入候选，IP／SSH／自定义流未验证不准入；未跑TLS，不称已证漏洞。

旧候选、初轮静态与各次manifest保留在[隔离作者证据根](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-driver-selection-review/author/)。最终复验的是revision3；原权限域、同账号跨会话和取消终结缺口仍按硬准入条件保留，不写成运行PASS或用户风险接受。

### 驱动选型补充的最终检查与交确认

固定候选`driver-selection-v0.1-revision3`，manifest SHA-256为`ab833c37034b54f819cc546010375d7573deada0a0c0b5b906c25196100cf9d4`；主稿26,383字节，SHA-256为`2f3c75c66b97df0955ef7bd80d62d3a73764fcc41a6fd4965682de5f405a69b6`。源码HEAD仍为`ef3e7d0b8703a6e22023e8099a56c542d484a69d`，分支`OC｜db-link`。

- **作者自检完成：** 四原则及必要反例、历史状态／确认边界一致；新候选4件与批准原件4件摘要全部匹配，JSON可解析、本地引用可达、候选无尾随空白，tracked diff为空。[最终静态回执](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-driver-selection-review/author/static-check.json)
- **全新非作者文档复核通过：** 独立核registry/tag／固定公开源码、本仓接缝及四原则；原F1–F3修正后按最终摘要重验，无剩余本轮必须修正文档项。[独立报告](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-driver-selection-review/independent/report.md)、[机器结论](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-driver-selection-review/independent/verdict.json)。官方API访问403及替代只读取证、初轮问题和未运行事实均保留。
- **未验证范围：** Node25／声明包／传递锁、真实数据库权限／预算／TLS／取消／类型精度／大结果／核算reader／模型质量均未运行；相应准入条件必须后续闭合。本次结论不等于工程能力、专业效果、产品验收或采用通过；用户确认不能代替闭合或视为降级风险接受。
- **交用户确认：** [选型补充](driver-selection.md)及[版本证据](driver-versions.md)，建议`pg 8.23.1`＋`pg-cursor 2.22.1`、`mysql2 3.24.6`。首批类型与薄适配已定，精确版本／细节仍待确认。未改产品／依赖／lock／批准原件，未安装、运行DB／模型、提交推送／CI、切换服务或操作设备；继续暂不开发。

## NVIDIA Auto Ontology 补充评估（2026-11-14，只读研究）

用户要求调研`https://github.com/NVIDIA/auto-ontology`能否用于db-link或部分复用。本轮按research流程并行核官方固定源码：`8ede47f7b67bf2612c5322c7a9adb8e0c6190e38`；目标是评估实际连接／执行、可分离语义、MCP／API、部署与本仓四原则边界，未启动开发或PoC。

研究已完成：[适配与部分复用评估](auto-ontology-research.md)，32,179字节，SHA-256 `e8702f14e717e4795eab9397156e1e5bddd8546a52f59757cb72107506621093`。建议保持原生驱动薄适配主线，将AO列为可选外部语义来源或候选交换输入；独立术语／字段映射／关系／SQL属性读取有正向复用价值，整套执行路径仍不能直接履行db-link权限／所属取消／精度／完整材料合同。外部ask_question可另定专业工具合同，不一概判为违反四原则，也不自动替代原Pi或Studio权威。

- **作者检查：** 47项引用定义和使用齐全，6个本地目标可达，无尾随空白；已批准4件原件及原driver候选4件摘要全部匹配，tracked diff为空。[静态回执](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-auto-ontology-research/author/static-check.json)
- **全新非作者有限复核：** 先从DB01–18／驱动合同／四原则独立导出预期，核关键官方事实与现有图服务边界；原稿MCP100行截断的直接引用不足，已补固定docs/mcp.md，另补tags／scheduler出处，最终摘要重验通过，无剩余本轮必须修正文档项。[独立报告](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-auto-ontology-research/independent/report.md)
- **保留限制：** 原生权限与项目scope、取消远端终结、DataFrame／JSON精度与规模、样例／查询历史模型出口、native／Ossie交换损失、整体部署和上游私有客户端改写均已明确；未运行包／服务／DB／模型／转换，也未核NGC发行物或比较专业收益。源码声明1.2.0不当稳定SDK已采用，GitHub无release不推导NGC无发行。
- **授权边界：** 研究结论不是组件采用或版本批准，原spec／UI和driver候选保持；未安装、升级／修改SDK、实现适配、运行真实业务／模型、Git交付／CI或切换服务，继续暂不开发。后续如要验证，先针对具体关系库语义缺口及实际收益确定相称范围。

## 元数据发现与语义候选增量准备（2026-11-14，暂不开发）

本轮用户明确暂不引入auto-ontology，保留MySQL／PostgreSQL成熟驱动薄适配，仅吸收有价值经验补入方案；确切原文和确认边界见[semantic-discovery-decision.json](semantic-discovery-decision.json)。此前AO可选服务建议保留为历史研究，不作为当前采用路线；本指令不自动批准前轮精确驱动版本或启动开发。

目标：准备可确认的元数据／关系／语义增量，明确与原Pi、Semantica、数据说明、Studio的实际分工；完成四原则和全新非作者复核，保持原批准四件与前轮driver固定候选。

| 阶段 | 完成条件 | 状态 |
| --- | --- | --- |
| 现状与复用 | 当前源码／规格核原入口及能力，区分已有与拟补接缝 | 已完成当前HEAD只读核查，见补充分工／现状表 |
| 增量合同 | 元数据事实、样本观察、关系推断、语义候选及准确出处／失效，保留完整主流程 | 已形成[补充v0.1](semantic-discovery.md)，候选固定为revision2，细节待确认 |
| 四原则与静态 | 不重造引擎／权威，不引入额外必经人工动作；检查引用和原件摘要 | 作者完成；11项身份／保护核验及引用检查通过，限设计文档 |
| 全新非作者 | 从有效用户指令与DB01–18独立核正常／失败／职责边界，修正后核最终摘要 | 已完成revision2限定复验，F1／F2关闭，无剩余本轮必须修正文档项 |
| 用户确认 | 提交具体设计版本及确认边界 | 待用户确认；继续暂不开发 |

### 语义增量复核的发现与修正

- F1／观察基数：初稿“有限查询／样本不得升级全库基数”有歧义；已明确完整、未截断并确切覆盖当前获准范围的查询可以支持该范围／时点的观察基数，但不能从样本推未覆盖总体，也不产生唯一约束或长期规律。
- F2／变化发现：初稿结构变化措辞可能被读成实时捕捉承诺；已限定为后续按需观察或既有可靠通知获知差异时局部标待核，未检查／无法定位部分保留未知，不新增实时DDL监控／全库变化捕捉。
- 同轮补强：跨源／企业的同名术语不能凭名称自动合并语义实体；沿既有能力处理时仍保留完整来源、适用范围与真实资格，不新建消歧平台。

初稿、原manifest与初检保留在[作者隔离证据根](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-semantic-discovery-review/author/)，不回写原批准spec／UI或前轮driver候选。旧PASS不替代新稿复核；以上问题已按最终revision2独立复验关闭，仅限文档设计。

### 元数据／语义增量最终检查与交确认

最终候选`semantic-discovery-v0.1-revision2`见[清单](semantic-discovery-manifest.json)，manifest SHA-256 `8333b0a101613a1d3c0be760621741645d2e4213e9ab30a6c7ff74527c7bc533`；[主稿](semantic-discovery.md)22,425字节，SHA-256 `dd55b553ea4bbc3e88a871e333c8b580efa1dc46bdae4ee0a2b5cb295f0e4e8a`。

- **作者四原则／静态自检完成：** 按需元数据、四类依据、条件关系与候选，不增加全库编译、SDK／引擎／资产权威或日常必做步骤；19次本地引用、11个源码行锚可达，JSON／空白／范围检查通过。[最终静态回执](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-semantic-discovery-review/author/static-check.json)
- **全新非作者独立复核通过，仅限文档：** 从用户有效指令与原DB01–18／工程规范导出预期，核当前Semantica／Pi／说明／Studio关键职责与失败边界，不沿用旧Demo成绩；F1／F2修正后重算最终摘要，无剩余本轮必须修正文档项。[独立报告](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-semantic-discovery-review/independent/report.md)、[机器结论](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-semantic-discovery-review/independent/verdict.json)
- **原件保护：** 11项身份核验匹配（批准4件＋原driver4件＋历史AO研究1件＋本轮2件），原批准manifest／approval保持；当前branch仍`OC｜db-link`、HEAD `ef3e7d0b8703a6e22023e8099a56c542d484a69d`，tracked diff为空。
- **实际未运行与确认边界：** 未安装、修改／升级SDK、执行任何产品／DB／模型或新UI；权限／取消／精度、活库元数据与来源接线、数据说明Agent保存及专业关系正确性均未运行验证。UI仅沿原按需资料面细化合同，旧Demo不证明新反例。原硬准入与FAIL／UNKNOWN保留，Git／CI、组件采用、服务／设备与产品验收无新增授权。

现交用户确认本增量；暂不引入auto-ontology、MySQL／PostgreSQL成熟驱动主线已定，原精确driver细节及本设计补充仍按各自用户确认核定。继续暂不开发。

## 元数据不完备处理写入主spec（2026-11-14，v0.2待确认）

用户原文：“把元数据不完备时的处理方式也补进 db-link spec：Agent 在授权内自主发现、核查并继续可做的分析，不强制先补齐元数据；关键缺口和结论限制明确说明。按四原则复核后交我确认，暂不开发。”

本轮直接更新[主spec](spec.md)为v0.2，在DB04补入口原则，新增DB19的处理合同／反例验收，并同步最少操作与四原则、当前版本状态。v0.1 spec原字节保存为[spec.approved-v0.1.md](spec.approved-v0.1.md)，仍为19,771字节／SHA-256 `73ddfa4457db42cc16744483c129a2c2b74223d37f3e5304b73c7e5aaabeec74`；原approval／candidate-manifest不改，其`spec.md`历史身份现在按此批准快照核验。当前同名spec已是待确认新稿，不能沿用旧批准或旧PASS；其余原UI／状态矩阵／Demo、driver候选、语义增量和AO研究保持。

| 任务 | 完成条件 | 状态 |
| --- | --- | --- |
| 版本保全与范围 | 原批准spec原字节保留，不更改旧批准，原WIP保留 | 已完成；14件现存保护文件另有开工摘要 |
| 主spec合同 | 不设完备门槛；自主核查／局部继续／关键缺口／结论限制，权限和核算硬边界不降 | 已形成DB19及关联改动，待本轮确认 |
| 作者四原则与静态 | 正常／失败／恢复／不得副作用反例，引用／差异／版本身份 | 已完成本稿作者检查；19项身份／保护核验，29个本地链接可达，原17节完整保留，DB04仅扩展 |
| 全新非作者复核 | 从用户指令独立导出预期，固定新稿复核，必要修改后重验 | 已完成本v0.2文档复核，无必须修复项；不沿用前轮PASS |
| 用户确认 | 新v0.2身份及实际检查交确认 | 待用户确认；继续暂不开发 |

本轮无新增页面、按钮、开关或强制流程，沿原消息／报告／来源详情表达局部结果和未知；原Demo不改，也不作为DB19运行证明。本轮只做文档与相称独立检查，不安装／执行产品、SDK、DB或模型，不Git交付／CI或操作服务／设备。

当前v0.2身份见[spec-v0.2-manifest.json](spec-v0.2-manifest.json)，旧批准映射、确切用户指令和待确认范围一并记录。作者[静态回执](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-metadata-incomplete-review/author/static-check.json)与[v0.1至v0.2差异](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-metadata-incomplete-review/author/spec-v0.1-to-v0.2.diff)仅证明文档范围，不代表运行能力。

### v0.2最终复核与交确认

主spec为26,969字节／SHA-256 `1c22efd9db47f389aebbbddff25234ea6666165926ab7854ff66aed850dff6a3`，manifest SHA-256 `62bcad6e4a7cf88e54de9f14becfb4b8288d3bd70169cc97774174083e9bbd21`。最终独立复核固定此稿，先导出验收预期再核正文及v0.1差异；无必须修复项。[独立报告](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-metadata-incomplete-review/independent/review.md)

四原则设计检查通过：Host管权限／来源／预算／留存，Agent自主核查与决定当前有据范围；复用原Pi／驱动／Semantica／说明／Studio，不新增完备度评分、Runtime或资产平台；正常已授权分析不增加人工补齐资料／逐次审批。DB19局部继续、集中澄清和结论限制均有相称反例，原DB01–18合同未降级；17个原节正文完全保持，DB04原文保留并扩展。

作者19项身份／历史保护检查对应16件唯一文件，独立重核16件和manifest均匹配，29个本地引用可达；旧批准只核原字节快照，未套用于新稿。UI／Demo不改，无新增关键交互，旧浏览器／VM成绩不用于本条。产品、数据库、模型、SDK及端到端运行均NOT_RUN，原权限／取消／精度和核算硬准入及FAIL／UNKNOWN继续保留。

现交用户确认主spec v0.2的DB19增量；不自动批准其他待确认候选或启动开发。未安装、修改产品／SDK／依赖、Git提交推送／CI或操作服务／设备。

## 用户批准开发、部分候选与资源隔离决定（2026-11-14，当前）

以上“待确认/暂不开发”为当时记录，原字节与失败不覆盖。用户后续已批准spec v0.2、driver/semantic方案并开始开发，追加允许官方node-sql-parser5.4.0；[批准](implementation-approval.json)固定确切输入。开发实际执行及边界详见[实施记录](implementation.md)、[任务清单](tasks.md)。

当前完成部分候选partial-code-02的代码/合成工程检查和独立复核；**整体db-link尚未交付，两库业务查询保持拒派**。有限原生候选19PASS、最终原生拒派/SDK事实11PASS分开；临时PG/MySQL无系统服务安装，全部自有实例已停止。新资源限制、MySQL远端累计期限及UNKNOWN retryCleanup仍有缺口，新数据库独立链与完整产品流程未完成。

当前完整npm run check：2392项/2316PASS/0FAIL/76条件SKIP，typecheck/入口检查/build通过，[机器回执](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/checks/partial-code-02-result.json)；原全查1FAIL、原生前两轮FAIL与独立F1–F4保留，修复后按准确新候选复核。[独立增量通过](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/independent/partial-code-02-review.md)不代替全规格、专业效果或用户验收。11官方包/2824归档成员与本地字节一致；未升级或改写Pi/Semantica。

用户现已决定保留硬准入、先评估成熟资源隔离。[评估建议](resource-isolation-assessment.md)已形成：优先核原生进程限额可行性，再比较Apple container或Docker运行域；它们的本地内存边界不能单独补MySQL远端prepare总预算。ProxySQL/MaxScale本次未获得满足整合同的证据，不引入代理。后续具体实验/组件/版本仍待确定，本轮只研究，不安装/启动或开发新方案。

四原则专项对已完成部分核对：Host负责真实资格/凭据/预算/来源/资源/固定；Agent自主SQL/说明/方法，元数据局部不足给有据范围；官方SDK/驱动保持原包，原Pi/owner/文件/说明/Studio/审查接缝复用；配置首次授权后无需逐查询审批，UNKNOWN通过原记录只读核销。未满足的安全条件明确拒派，不以自动补算、重放或新人工分页替代。

当前无Git/CI交付、服务/设备采用或真实业务/Provider访问；后续以新的明确范围及证据继续。

## macOS原生进程限额／PG实测交确认（2026-11-14，当前）

用户已授权原生限额隔离合成验证、继续硬准入、不引入容器/代理，并明确后续按PostgreSQL测试。验证已完成，主稿[native-process-limits-result.md](native-process-limits-result.md)交用户确认。

原生AS512MiB/1GiB/4GiB在设置阶段EINVAL、exec前拒派，未形成接收内存边界，当前不采用此方案放行查询；CPU默认信号可被忽略、FSIZE仅单文件。PG18.1/cursor2.22.1正常参考与8MiB后验反例、活动命令超时/rollback、CPU/父kill后远端仍活动、portal暂停两类timer均有实际同源观察。全部19案OS child、8个PG worker及唯一PG实例已收尾；未测试MySQL。原CPU误断言FAIL与所有NOT_RUN/UNKNOWN保留，不汇总成资源准入全绿。

[非作者复核](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/independent/review.md)通过本轮实验的证据/范围/解释核对，无必须修正项；108件固定原件与快照、65件旧候选、10批准输入无漂移，11包2824归档成员重新匹配。独立反例核实CPU实际1.215609秒可自行退出及两个16KiB文件合计32KiB；PID/port收尾回读完成。[机器收据](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/independent/completion-receipt.json)。这不等于原生AS能力通过、产品采用、完整db-link或用户验收；查询仍拒派，后续测试主线为PostgreSQL，MySQL只保留预算缺口及历史证据。

没有修改产品/SDK/依赖版本、安装/启动容器代理或系统服务、访问业务/Provider、操作MacBook、提交/推送/CI或切换正式运行。下一步范围待用户确认，不自动改变硬合同或引入其他方案。

## PostgreSQL软件约束补充规格（2026-11-14，当前待确认）

用户要求按软件约束方向补充PostgreSQL spec及反例计划，按四原则／工程规范复核后交确认，暂不开发、不引入容器或代理。本轮新增[spec v0.3补充稿](postgresql-software-constraints-spec.v0.3.md)，保留原主spec v0.2及10件已批准输入字节，tasks增加S01–S05。不改原资源失败／UNKNOWN与部分工程候选，不把本轮文档准备当准入通过；当前仍queryQualified=false。

新增PGS01–06：原SQL不改写、真实对象／类型／参数核验的窄范围；原列固定表示、同一短时只读RR操作内分段；服务器事务前固定期限、全操作不刷新预算；原owner停止、实际远端会话核销、UNKNOWN只清理／只读核销且不重放；原说明／Studio／核算的精度与覆盖承接；V01–12关键反例。错误／通知、目录／启动消息及未知执行路径仍是必须证明的接收边界，不因成功DataRow有界就放行。首轮验证计划沿既有隔离PG18.1，不代表全部PG17／18来源兼容，不安装或升级数据库／SDK。

准备证据位于[本轮证据根](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-pg-software-spec)。before固定1,480件Git可见现有文件；初轮作者引用／条目／范围检查通过，10件批准输入哈希一致。技术只读互查与全新非作者复核分别进行，互查不替代最终复核。产品、数据库、模型、浏览器／运行验证均NOT_RUN；本轮不运行完整check，以文档一致性、引用、身份／范围回读作为相称验证。

初轮candidate-01（spec SHA990289ee3c6dcd5cba50cc78053f7778c016a393cb6c883ebeb7e6a44839754a）发现整值重组缓冲说明不足：即使每段有界，后续全量Buffer.concat／字符串化可能重新产生大内存。原稿／发现保留。candidate-02明确逻辑完整值由有序文件块／段引用表示，增量摘要及UTF8处理，工作缓冲独立于整值长度，禁止未经小值预算证明的全量concat／JSON加载；读回／UI／核算reader同样有界，并补V04／V07成功及失败反例。当前固定spec SHAa126369cb4e852f34776ec12bca00b06c541a2f6595184ea2e69dc68b76fb980，等待非作者增量复验，不继承旧PASS。

### 软件约束补充稿最终复核与交确认

[初轮独立报告](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-pg-software-spec/independent/review-initial.md)为candidate-01文档准备暂不通过，R01／P2及原稿完整保留；[最终独立复验](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-pg-software-spec/independent/review-final.md)核对candidate-02精确spec、初轮发现闭合及全稿一致性，**限文档准备通过，无剩余必须修正项**。四原则、SQL／期限／停止／UNKNOWN、原说明／Studio／核算边界及无新必做人工作业通过本设计范围核查；不表示软件资源保证已实现。tasks后续仅更新实际完成状态，不把它误称仍为candidate-01旧摘要。

作者最终相称检查包含本地引用、来源标记、PGS01–06／V01–12、无尾空白、git diff --check及字节保全。before中1,480件现有文件无丢失，只有本轮允许的tasks／result更新；10件批准输入、产品源码／测试／依赖和UI／Demo无本轮变更。最终spec固定32,475字节及上述SHA，历史身份见[补充稿v0.3 manifest](postgresql-software-constraints-manifest.v0.3.json)。完整进程／资源实验、产品TDD、数据库／模型／浏览器和CI本轮均未执行，不以文档PASS替代。

本v0.3补充稿现交用户确认；生产预算及精确传输契约需后续实施前固定，必要消息／期限／收尾证明未通过前保持queryQualified=false。用户确认、后续开发、工程／专业／产品验收、Git交付与运行采用分别核定；继续暂不开发，不引入容器／代理，不进行安装、服务切换或其他设备操作。

## Agent自主纠错与累计预算增量（2026-11-14，v0.4待确认）

用户要求把自主纠错／跨纠错累计预算写入db-link spec，明确不设SQL固定次数、复用Pi正常工具调用循环、单次操作与停止／UNKNOWN边界，并追加“暂时预算无上限，不要设限制，后续有问题再调整”。本轮仅更新[PostgreSQL补充稿v0.4](postgresql-software-constraints-spec.md)及身份／任务／结果，不开发、不跑数据库／模型／产品／浏览器，不引入容器／代理、修改依赖／SDK、安装或操作设备／服务。当前queryQualified=false保持。

本轮将无上限明确为整个Agent纠错过程的累计策略：不新增累计耗时、token／费用、SQL次数或跨次总返回量的专用停止阈值，不设“失败第N次必须转人／换方法”。实际累计事实沿原请求／toolCall／事件及可得SDK用量关联，不重置、不造unknown=0，不新增预算台账或模型／纠错循环。单次DB操作沿原有限执行／接收／并发及真实收尾；使用本次operation剩余期限，删除旧句中容易误导为已存在父累计deadline／SQL网络重试的措辞。

PGS07及V13–17补充正常工具结果回到原Agent、自主修改再提交；派发前拒绝可继续，执行错误／单次超时须实际收尾且父请求资格有效后才可新尝试。用户停止父请求禁止续派，单来源撤权只影响相应资格，其他独立工作沿原规则；UNKNOWN不得换SQL绕过占用或自动重放。未证明能力不因多试放宽；Agent也可自主选择其他有据方法或如实结束。正常使用无新增人工操作，原说明／Studio／核算及冷读合同保持。

v0.3原规格32,475字节／SHA a126369cb4e852f34776ec12bca00b06c541a2f6595184ea2e69dc68b76fb980和manifest原字节分别保存为本目录.v0.3快照；旧记录链接固定到历史快照，原独立R01及v0.3 PASS不改、不外推。新before固定1,482件现有Git可见文件及4件将更新文档的原件；证据根为[纠错增量准备](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-pg-agent-correction-spec)。相称作者检查及全新非作者复核按新候选分别核定，当前尚未完成最终复核。

### v0.4最终文档复核与交确认

固定candidate-01规格42,461字节／SHA dc49c5ed6e4fcf0fee1d6e65359205c39fd5ae55744ffea409ff0edf21d5af24。[全新非作者复核](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-pg-agent-correction-spec/independent/review-initial.md)从用户要求与工程规范独立导出预期，重算6件候选、10件原批准输入及1,482件before，确认无丢失／非授权漂移、两份v0.3快照原字节一致、81处本地引用目标存在。**本候选限文档准备通过，0必须修正项**；无固定SQL纠错次数、隐藏累计阈值或新Host模型编排。四原则、原owner／单次操作／停止／来源撤权／UNKNOWN及说明／Studio／核算边界通过本设计范围复核。

作者已完成正常／多轮技术拒绝／单次超时／父停止／单来源撤权／UNKNOWN的文档走查及条目／引用／空白／范围检查，未把走查称为产品试验。新增PGS07／V13–17均未运行；产品、数据库、模型、浏览器、完整check及CI本轮NOT_RUN。后续合成Provider也只能证明工具闭环／权限接缝，真实LLM纠错成功率与费用需另证。

本v0.4现交用户确认，最终spec技术字节与非作者候选一致；tasks／result／manifest仅补实际收尾状态并另固定身份，见[当前manifest](postgresql-software-constraints-manifest.json)和本轮final-readback。累计预算无上限是本次明确用户决定，当前不等待累计额度数值、不私设默认限额；原单次DB安全参数仍在后续获准实施前固定。没有修改产品代码、测试、依赖／SDK、UI／Demo或批准输入，不做Git交付、安装、服务／设备采用；queryQualified=false保持，继续暂不开发。


## v0.5行业模式规格准备（2026-11-15，当前待确认，暂停开发）

用户最新明确要求：按行业调研结论修订v0.5，优先本地小库及企业分析账号，可信数据源／最小权限／成熟驱动薄适配，大字段按需，明确视图／RLS、单次保护、停止／UNKNOWN；累计无上限、无SQL固定纠错次数，不扩权／容器／代理；复核交确认，暂不开发、查询入口关闭。本轮不接续此前v0.4开发，原WIP及所有历史准备／实验／FAIL／UNKNOWN保留。

新增[spec v0.5](spec.v0.5.md)为独立待确认稿，旧主spec及v0.3／v0.4／驱动／语义／UI原字节不改。A05-01–09及T01–16覆盖两个场景和原完整流程。主要差额是可信源管理替代穷尽内部执行路径证明、常规单次保护与巨值解码前硬保证分开、正式视图／RLS列入目标、正常命令／事务结束与断线远端核销分别处理。旧更强保证的反例不是修复PASS，缺失能力不因设计调整写成已实现。

[行业调研](/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-industry-research/research.md)及[输入边界只读核对](/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-spec-v05/input-review.md)为依据，不代替新稿最终独立复核。工程规范v1.10／Interface v3、官方Pi1.4.0与已批驱动tuple保持；普通读取与受管独立核算资格分开，不引入新的Runtime／协议／预算台账或人工作业。

开工前[before](/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-spec-v05/before.json)固定1,497件Git可见文件；12件原批准输入摘要匹配。允许变化仅本v0.5规格／manifest与tasks／result。当前进行相称文档检查、固定候选及全新非作者／四原则复核；最终结果与身份以后续本节及[manifest](spec-v0.5-manifest.json)核定，不继承旧准备PASS。

本轮产品／数据库／真实或合成模型／浏览器／完整check／CI均NOT_RUN；不改产品／测试／依赖／SDK／凭据／运行数据，不安装／启动服务、Git交付或操作设备。queryQualified=false保持，规格确认也不自动恢复开发或开放查询。

作者文档检查-01通过：v0.5本稿9个本地引用可达，A05-01–09／T01–16及用户关键约束齐全；原1,497件文件仅tasks／result变化，新增规格／manifest，12件批准输入匹配。该检查只证明文档范围与一致性，不证明产品、依赖或数据库运行能力。固定candidate-01后进行全新非作者规格／工程规范／四原则复核，发现保留并修正重验。

候选01独立复核发现P2停止范围歧义：UNKNOWN表允许继续其它分析却未限定父请求有效，停止入口也未显式覆盖后续模型／非DB业务工具。原候选和发现保留，不写成通过。候选02已在第7节及T14明确：父请求／owner停止撤销全部后续模型、业务工具和新保存，只允许原技术收尾／合格核销；仅单源异常且父请求／owner／独立工作授权仍有效、工作不依赖受影响源时可继续独立分析；释放UNKNOWN不重开已停请求。该修正待非作者增量复验，不代表运行停止机制已验证。

### v0.5最终交确认（仅规格准备）

当前核心规格为36,683字节，SHA-256 `07576a28dcd97d26d2a28a6d846b7e614572eae30f5e2579d90e0046ff2ca76e`；[manifest](spec-v0.5-manifest.json)记录确切身份及本轮范围。[作者文档检查-02](/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-spec-v05/author-document-checks-02.json)通过。两路全新非作者已分别完成[合同复验](/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-spec-v05/independent-contract/review-02.md)与[工程规范／四原则复验](/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-spec-v05/independent-principles/review-02.md)：限文档准备通过，R01/P2在规格中闭合，0剩余必须修正／新发现。candidate-01原不通过、发现及两轮快照保留；不把这一措辞修正写成产品停止行为已验收。

四原则按实际合同及反例核对：Host管权限／单次保护／资源／结果，Agent自主SQL与Pi纠错；只复用获批官方组件、原owner／接口及说明／Studio／核算；无新Runtime／通用输出证明器／预算台账；正常配置与项目／模型出口一次授权后直接提问，无逐SQL审批、强制信任向导、配额问卷、暂停DDL或手工分页。父请求停止后全部后续模型／业务工作受禁，与单源异常但父有效时继续独立工作分清。UI沿原批准流程与既有状态，本轮无需新Demo；原浏览器成绩不继承为v0.5运行证明。

本轮收尾仅追加tasks／result实际状态及manifest收据，核心spec保持两路复核的准确字节；最终身份与范围回读固定在本轮证据根。原1,497件中仅tasks／result追加记录，12件批准原件及源码／测试／依赖／UI／其他WIP均保持；本轮新增规格与manifest。当前为待用户确认，不是用户已批准、开发完成或运行采用；产品／DB／模型／浏览器／完整check／CI继续NOT_RUN，查询继续关闭。历史FAIL／UNKNOWN、未完成实现及正常终态／巨值保护等待验能力均未改写。

## v0.5本地工程收尾（2026-11-15）

**本轮普通PostgreSQL读取已实现并通过工程验证；开发候选已对实际合格的PostgreSQL 18.1开放查询。** 用户已批准v0.5并授权继续开发，之前“仅规格／暂不开发／全部查询关闭”为各历史阶段事实。批准spec、12件旧批准输入及v0.5 manifest共14件原字节一致；不重写旧FAIL／UNKNOWN。

已完成：可信最小权限账号的普通SQL、聚合／JOIN／日期／中文、正式owner／invoker视图及现成RLS双身份；大字段按需长度／前缀、精度和准确结果文件；原Pi工具循环的自主发现与纠错；父停止／撤权不续派，原命令／适用事务／本地资源正常收尾，UNKNOWN跨别名／重启保留且仅显式原清理核销。累计预算无上限、无SQL固定纠错次数；无扩权、容器／代理或auto-ontology。

元数据缺口不会要求用户先补齐注释、关系或语义图。可选目录的原生权限错误在原事务中恢复，恢复失败拒派；当前账号与视图／RLS范围随准确结果、说明、Studio材料及合格固定文件的核算中性回执保留。结果和结构说明另保留partial及解码／保存事实；partial结构说明不声称已扫描数据行，也不提升完整核算资格。旧说明原操作重试保留旧字节，新观察可另存版本。

| 验证 | 最终结果与范围 |
| --- | --- |
| 完整适用检查 | 最终`npm run check`退出0：2560项／2449 PASS／0 FAIL／111条件SKIP；会话边界、类型、构建通过。UI最后修正前一次完整PASS另存 |
| 真实依赖／私有PG | 原生driver／生命周期／注释16/16，加开放后Host9/9，共25项PASS；不把全套中的条件SKIP冒充已跑。普通并发标准索引、两身份RLS、不可读底表／invoker失败、实际失联UNKNOWN及按需巨值均有原生证据 |
| 实际产品路径 | 一次命名连接、两项目分别授权；完整Host→官方Pi→本地合成Provider→PG→结果／说明闭环两次。14次本地模型HTTP请求、0 Provider错误，错误SQL后自主修正，无新Host模型循环；跨项目结果404 |
| 数据说明／Studio／核算 | workflow106/106；实际说明／准确Studio材料引用可读，当前账号／版本／范围／未知保留；固定文件RCR/CNR回归通过，未自动发布、采用或刷新图 |
| 产品UI | 390px浅／深色无文档横溢，结果弹窗356px，精确数值与版本可见；加载后Esc回焦真实RED→GREEN；正常提问无需补说明或进入Studio |
| 独立复核／官方包 | 全新非作者标准／规格／四原则复核及UI增量通过；独立222项／220 PASS／0 FAIL／2原MySQL SKIP。11官方包共2824归档成员及锁SRI终检匹配，未改SDK／版本 |
| 收尾／保全 | 私有Host／Provider／PG／Vite／浏览器已停止；PG正常退出0且端口关闭，停止前未结束读取／测试事实均0；原WIP、1499件before无删除，所有失败和未知保留 |

本轮四原则专项：Host仅核真实环境／权限／单次保护及资源事实，不替Agent选择分析或补业务SQL；Agent沿原Pi自主决定发现、查询、纠错、保存和结束，七次读取的实际累计返回超过单次行额仍可继续；成熟官方驱动／parser／Pi原包薄接缝，不新增Runtime／生命周期平台／累计预算台账；一次配置和项目授权后任务继承，实际双项目无需重新输入凭据，普通读取不逐条审批。

**可用范围与限制：** 当前原生资格只覆盖PostgreSQL 18.1／本机macOS客户端；其他PG版本保留连通／目录而未开放，MySQL本轮不开放。不承诺任意巨值的解码前内存上界或即时强取消／backend消失；整值segmentRead当前显式不支持，普通SQL片段需准确说明范围。部分复杂方言或标识符语法仍技术拒绝，Agent可用正常循环换受支持表达，不改SQL或三方SDK。UNKNOWN缺充分原始结束证据时保留占用，不用重启、端点相同、PID或新查询猜测核销。

**未支持的独立能力继续关闭：** DB12受管活库独立／自动核算链仍NOT_IMPLEMENTED／NOT_PROVED，不能凭普通查询资格开启；本轮走已固定完整文件的现行核算，隐藏数据／底层SQL业务完整性不在该核算证明内。Studio图刷新、专业语义增益、真实企业云端点及真实模型专业质量、用户产品验收均未宣称通过。原DB12／CNR新增完整交互工作保留为未完成能力，不将本次普通读取闭环写成原db-link所有功能已完成。

准确身份、命令与完整证据见[v0.5实施固定清单](v0.5-implementation-manifest.json)及[实施记录](implementation.md)。证据根：`/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-v05-implementation`；独立报告`evidence/final-review/review.md`与`ui-focus-review.md`，原始日志／审批／中途失败均可回读。源码仍为`OC｜db-link`上的未提交候选，构建标记`ef3e7d0+local-changes`；无Git／CI／合并、正式服务／MacBook运行采用或真实业务访问。

保全回读补充：1,499件为初始身份清单，开工`before/`是73件选定副本；最终29件修改原件均有匹配原字节。其中4件沿旧候选副本，1件UI原件因初始遗漏在末尾仅反向还原本轮差额、与开工字节数／SHA256精确核同后恢复到证据根，明确标记late recovery。当前源码及14件批准输入不改，原candidate-01及遗漏事实保留；最终candidate-02补记准确保全范围，不宣称开工时有1,499件完整副本。

## PostgreSQL 一期交付授权（2026-11-15）

用户本次要求Git／CI／合并和双端正式服务切换。当前按[交付清单](delivery.md)执行；原本地工程结果及未支持能力保持。本次已核原冻结候选零漂移，最新main为c62d682，含后续Case-Star-Map与文档变更，需要在保留feature提交后集成和重新验证；尚未据本授权宣称已经合并或采用。

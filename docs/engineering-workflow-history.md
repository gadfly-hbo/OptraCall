# OptraCall 维护导航与历史记录索引

2026-11-28 · 配合工程规范 v1.18 使用。

基线 `76558ec6405b6852092fcf5d4bc85b025524710f`。本附件承接从入口／规范正文迁出的历史授权、进展和原结果；历史文字不构成新授权。原阶段记录及失败不改写、不删除、不因本次整理重放或恢复。维护某模块时按下表读取相关原合同、结果与后续记录，无需为其他任务通读全部历史。

完整原件保留在以下固定 Git 提交；仓库外草案 v0.1／v0.2、基线副本及摘要继续留存，未因正式落库覆盖或删除。迁出的历史原文保留在本附件：

- [基线 AGENTS.md](https://github.com/gadfly-hbo/OptraCall/blob/76558ec6405b6852092fcf5d4bc85b025524710f/AGENTS.md)
- [基线工程规范 v1.17](https://github.com/gadfly-hbo/OptraCall/blob/76558ec6405b6852092fcf5d4bc85b025524710f/docs/engineering-workflow.md)

原始私有日志、现场和本地收据仍在其获准保全位置；上述源码原文副本不替代它们，也不证明本轮已读取所有私有证据。无法访问的材料如实保持未核验。

## 严重验收事故

以下保留原规范第 7、213 行的事故事实及来源界限。冻结 UI、旧 PASS、实际产品修复和用户确认各自保持原适用范围。现行执行要求集中在[Demo 阅读](engineering-workflow.md#领取方的冻结-ui-demo-阅读与开发要求)及[PR 前门禁](engineering-workflow.md#冻结基准逐项复核与-pr-前截图确认)。

```markdown
**严重验收事故整改（2026-11-28 用户确认）。** Issue #149 经 PR #151 合并并工程结案后，用户报告实际产品 UI 与冻结 Demo 完全不一致，明确指出类似问题重复发生，认定为严重事故；PM 承认审核遗漏。冻结基准为提交 `5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2` 的 [Decision Case Demo](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/openspec/changes/decision-case-daily-workspace/demo.html)，用户附件与其摘要一致；原工程交付为 `85ab2395d8e78a3d1570850a98fdc87a43e48c40`，设备实际采用版本仍按证据核定。保留原交付、PASS 与问题记录，不把原功能验证扩大为 UI 一致性验收。本次教训已写入持久记忆及仓库 Agent 入口，长期执行规则见[第 4 节](#冻结基准逐项复核与-pr-前截图确认)。用户将门禁明确为**开 PR 前**，不是 Git 前；本次规范固化不代表产品 UI 已修复。

**2026-11-28 用户补充要求。** 用户转交的 Issue #149 原领取 Agent 复盘自述：首次实施及首审返工未用浏览器查看冻结 Demo，也未读相关 DOM/CSS；只读 spec/guide、校验摘要及断言页面文字，误将允许修改既有文件和不复制模拟业务设施理解成保留旧布局。此处记录为当事 Agent 自述，本次未独立取得其原 transcript，不将具体工具调用次数或时间当作已核验事实。领取方的设计阅读与开发自检责任、非作者复核、PM 的 PR 前截图确认须分别落实，不能相互替代。
```

## 维护导航

先读所维护对象的规格、结果及后续决定；下表只提供入口，不把“已合并”“有规则”当作运行采用、专业质量或完整合规的证明。原件破坏、取消、未知副作用、限定接受和 TDD 的 NOT_PROVED 分别保留。仍有效的技术合同在现行规范和原模块规格中继续适用；迁出的是入口中的历史叙述，不是取消这些合同。

| 维护对象 | 必读入口与保留边界 |
| --- | --- |
| Pi SDK 治理 | [风险及结果](../openspec/changes/pi-sdk-governance/result.md)；规范已建立不代表旧实现全部合规 |
| Semantica 治理 | [规格](../openspec/changes/semantica-sdk-governance/spec.md)、[结果](../openspec/changes/semantica-sdk-governance/result.md)；实际版本、授权和采用另核 |
| 模型包消费端 | [规格](../openspec/changes/model-pack-consumer/spec.md)、[结果](../openspec/changes/model-pack-consumer/result.md)、[后续采用](../openspec/changes/model-pack-consumer/live-validation.md)；快照、损坏、受管／封闭资源排除、旧备份检查及跳过项沿用原记录 |
| deep-research Skill | [归档结果](../openspec/changes/deep-research-skill/result.md)；测评回执绑定被测版本 |
| data-analysis Skill | [规格](../openspec/changes/data-analysis-skill/spec.md)、[结果](../openspec/changes/data-analysis-skill/result.md)及其中独立复核；专业失败、暂定结论、成本和采用边界保留 |
| 商圈／天气连接器 | [商圈结果](../openspec/changes/trade-area-mcp/result.md)、[IN06 接管约定](../openspec/changes/trade-area-mcp/spec.md#codex-接管补充2026-11-03)、[天气结果](../openspec/changes/weather-mcp/result.md)、[真实模型记录](../openspec/changes/weather-mcp/live-validation.md)；接缝维护归属、原报告内容 FAIL 和数据／设备授权分别核对 |
| PPT Host 接线修复 | [规格](../openspec/changes/ppt-host-wiring-repair/spec.md)、[结果](../openspec/changes/ppt-host-wiring-repair/result.md)；不沿入口旧“当前授权”重新启动修复或模型实验 |
| 固定版本试用交付 | [规格](../openspec/changes/current-version-trial-delivery/spec.md)、[结果](../openspec/changes/current-version-trial-delivery/result.md)、[试用范围](current-version-trial.md)；历史模型暂停、Git 与设备授权按对应阶段核对 |
| B/C 分析可靠性 | [规格](../openspec/changes/analysis-verification-reliability/spec.md)、[实施](../openspec/changes/analysis-verification-reliability/implementation.md)、[专业评估](../openspec/changes/analysis-verification-reliability/professional-evaluation.md)；原专业 FAIL 及未见材料变体要求保留 |
| 业务语义／独立核算 | [规格](../openspec/changes/business-semantics-verification/spec.md)、[结果](../openspec/changes/business-semantics-verification/result.md)、[接入说明](verification-agent-integration.md)；SV01–SV12 替代旧 EC 建议，有限验证不扩大为产品验收 |
| 自动核算／修订与托管优化 | [自动核算规格](../openspec/changes/automatic-verification-revision/spec.md)、[生命周期补充](../openspec/changes/automatic-verification-revision/lifecycle-supplement-proposal.md)、[托管优化规格](../openspec/changes/managed-execution-optimization/spec.md)、[修订权限收尾](verification-revision-preservation-followup.md)；原件破坏 FAIL／UNKNOWN 不恢复、清理或盲目重放 |
| 工程可靠性 | [结果](../openspec/changes/engineering-reliability/result.md)；不把工程修复当成分析正确性解决 |
| 统一会话 | [结果](../openspec/changes/unified-session-management-phase1/result.md)、[接入说明](agent-session-integration.md)；owner、profile、历史与业务差异按已确认合同保留 |
| 需求梳理及可靠性 | [初始规格](../openspec/changes/requirements-elaboration/spec.md)、[初始结果](../openspec/changes/requirements-elaboration/result.md)、[可靠性结果](../openspec/changes/requirements-reliability/result.md)、[灵活性结果](../openspec/changes/requirements-flexibility/result.md)；真实回答、发布、目标项目、legacy、隔离与有限修正分别读取 |
| Case／项目任务与归档 | [Case 规格](../openspec/changes/decision-case/spec.md)、[项目任务结果](../openspec/changes/project-tasks-and-archive/result.md)；项目内任务、共享目录、归档只读与空闲准入、不提供删除入口、schema2 JSONL 原字节及父链按原合同核对 |
| first-chat 与初始设备试用 | [首次批次结果](../openspec/changes/first-chat-mvp/result.md)、[MacBook 交付规格](../openspec/changes/macbook-trial-delivery/spec.md)、[交付结果](../openspec/changes/macbook-trial-delivery/result.md)；Git 暂缓属于已结束历史例外 |
| L1／四底座相关阶段 | [L1 规格](../openspec/changes/fourbase-l1-semantic-trace/spec.md)、[DuckDB 规格](../openspec/changes/fourbase-duckdb-phase1/spec.md)、[限定接受](../openspec/changes/fourbase-duckdb-phase1/accepted-limitations.md)、[M7 记录](../openspec/changes/fourbase-optional-engines/result.md)；其他 M3.1–M6 原入口见下方历史原文；不从旧准备状态推导当前状态 |
| 反馈入口与更新工具 | [Issue 入口结果](../openspec/changes/github-issues-feedback/result.md)、[更新认证规格](../openspec/changes/trial-authenticated-update/spec.md)、[结果](../openspec/changes/trial-authenticated-update/result.md)；旧目录状态不代替 Issue 结案，旧凭据／设备授权不跨任务继承 |

## 原工程规范的历史范围记录

原规范第 9–81 行原文保留如下。它们记录各自日期和任务阶段；即使原文写“当前”“待确认”或“不启动”，也不是本草案新增的当前状态。代码块中的相对链接以原文件 `docs/engineering-workflow.md` 为基准；可在上方固定提交原件中点击读取。

```markdown
**云端开发与 GitHub Issue 交付（2026-11-23 用户确认）。** 新产品、新功能和上线后试用修正均以云端开发为主，由 PM Agent 通过 GitHub Issue 发单并负责集成、CI 和合并。用户自行更新 Mac mini 和 MacBook 的运行服务并体验产品。两类入口及共享交付流程见[第 6 节](#github-issues-问题收件与结案)。下文中的历史任务按当时的环境和授权记录。

**GitHub Issues 反馈入口调整（2026-11-14 用户确认）：** 当时将问题提交、跟踪和结案迁至 GitHub Issues，MacBook Qoder 使用指定反馈工作区，同日停止旧目录处理方式。原有落地见[记录](../openspec/changes/github-issues-feedback/result.md)，现行收件、发单和结案规则见[第 6 节](#github-issues-问题收件与结案)。以下报告读取及归档授权留作当时任务记录。

**Semantica 官方组件治理规则（2026-11-06）：** 用户明确要求 Semantica 与 Pi SDK 遵守同等的官方原包、用户指定目标版本、自有适配、资产兼容及回退规则。原规则建立阶段只更新规范与同源入口，见[规格](../openspec/changes/semantica-sdk-governance/spec.md)及[结果](../openspec/changes/semantica-sdk-governance/result.md)。用户随后另行授权本变更Git／CI、合并及双机采用，按规格中的后续授权执行；依赖和锁文件不升级，不新增真实模型测试。长期规则见第2节的 Semantica 约束及第3节的升级验证与回退；历史安装、采用和专业验证事实仍按原回执分别核定。

**官方 Pi SDK 治理规则（2026-11-06）：** 用户要求将官方包不可修改、目标版本由用户指定、OptraCall 负责兼容适配和升级验证纳入工程入口、架构及开发验收。本轮仅建立规则并只读核对当前实现，见[规格](../openspec/changes/pi-sdk-governance/spec.md)与[结果及风险](../openspec/changes/pi-sdk-governance/result.md)；不升级／替换／降级 SDK，不改官方包或产品代码，不安装依赖、运行模型、切换服务或操作 MacBook。下列历史开发及交付授权不自动启动本轮发现的修复。长期规则唯一详见第2节及第3节升级流程。

**L1实施／整体收尾当前授权（2026-11-04）：** 用户已整体确认[L1 spec／UI与D01–D08全部A](../openspec/changes/fourbase-l1-semantic-trace/spec.md)并开始开发，追加“只作辅助、不阻断原分析流程、正常新增必做操作为零”。按第2–4节四原则／真实RED-TDD、锁定Pi1.4.0／Interface v3及原M2/M4/M5/M6补最小查询、明确来源保存与按需UI，原批准字节／1405份开工前身份保留在本地implementation。完成适用完整检查、实际隔离合成Host/Pi/工具/保存重开/UI与全新非作者及四原则复核后，继续已授权M8、整合届时最新main、Git／实际head CI／合并，最后核净工作区并写L1→L2 handoff。原件／WIP、FAIL／UNKNOWN／NOT_PROVED及DuckDB限定接受均保留；不切换运行服务、不操作MacBook、不读真实业务根／凭据、不调用真实Provider，不安装接线L2。下列确认前准备措辞为历史，不再构成停止线；第2–4节规则不降低。

**L1语义依据／关系时间追溯与后续交付安排（2026-11-04，当前）：** 用户接受沿现有L1增量补齐，要求先准备[spec／D01–D08与UI Demo](../openspec/changes/fourbase-l1-semantic-trace/spec.md)，整体确认后再开发；当前只读核查、文档／虚构原型与相称准备复核，不改产品、测试、依赖或持久结构。复用Pi1.4.0／Interface v3、SAP／M2／M5／M6，明确原引用、业务时间声明、留存时间与未知；不先建Registry／双时间引擎，Semantica／Graphiti仅确定后续最小候选范围。用户同时授权L1完成后接续M8及Git／CI／合并main，随后核净工作区并写L1→L2 handoff；按[分阶段计划](../openspec/changes/fourbase-l1-semantic-trace/delivery-plan.md)执行，不提前跨本轮确认门槛，不重复请求已授权的一般Git动作。最新main及此前合并在整合前重核；全部WIP、原件、FAIL／UNKNOWN／NOT_PROVED和DuckDB限定接受保留。运行服务／MacBook、真实Provider／业务材料和L2安装接线不由上述授权自动启动。第2–4节详细规范不变，下列旧“Git无授权”“关系延期”仅为对应历史阶段范围。

**DuckDB第一版v0.2当前开发授权（2026-11-04）：** 用户已整体确认更新版[spec／UI及D01–D06](../openspec/changes/fourbase-duckdb-phase1/spec.md)，明确开始开发。9份批准原件与1,224份原树before保全见[实施记录](../openspec/changes/fourbase-duckdb-phase1/implementation.md)。在独立`codex/fourbase-duckdb-phase1`最新main候选整合既有M2–M7，按第2–4节四原则／连续SDD与真实RED-TDD实施私有依赖、原Pi/Python路径、五类固定输入及原成果／UI接缝，完成适用本地检查、隔离合成Host/Pi/UI及全新非作者与专项复核。允许仅工程私有依赖和合成工具运行，不读真实业务根／凭据、不调用真实Provider、不改原5239工作树；Git提交推送／CI交付、运行服务切换和MacBook无新增授权。关系／Semantica与M8不提前，原专业FAIL／UNKNOWN／NOT_PROVED保持。下列待确认措辞为确认前历史，不再作为开发停止线。

本地收尾状态：主体功能已开发，最终完整检查1,304项／1,301通过／0失败／3原条件跳过；合成真实Host/Pi计算和产品UI已核，F2/F3/F4功能问题独立关闭。**本地收尾按本次有效限定接受完成**：用户已明确接受[E01/E02及D04三项处理](../openspec/changes/fourbase-duckdb-phase1/accepted-limitations.md)。初始ACK TDD仍NOT_PROVED、历史.local生成物保全缺口及原扩展默认承诺未满足结论保留；仅D04当前合同改为显式连接设置/原权限边界，不宣称全局强制关闭。此为本次明确接受，不外推M31例外，也不把原专项检查写成全部通过。原5239的1,224份材料/9批准原件及main零漂移不覆盖已记录的.local误写事件；详情按实施记录。第2–4节规则不因本段或提案而降低，Git/CI、运行采用和产品验收仍分别核定。


**DuckDB 第一版当前确认包准备（2026-11-04，v0.2格式增量）：** 用户已接受原Pi／Python可选DuckDB路径，要求先准备[spec／D01–D06及UI](../openspec/changes/fourbase-duckdb-phase1/spec.md)、确认后再开发，并新增XLSX／MD输入。已完整保全v0.1确认包与其准备证据；原107项作者／19组独立复核仅证明旧候选，本v0.2受影响格式／依赖／结构／UI已完成相称增量复核，作者55项与F1修后27项分别保留，非作者10组浏览器及规范／规格／结构／四原则限准备通过、F1关闭、无剩余必须修复项；现等待整体确认。main普通上传22类／50MiB、当前WIP M2旧CSV/JSON10MiB仍是分别核实的事实；拟议固定输入扩CSV/TSV/JSON/MD文本＋XLSX原二进制，每件50MiB，文本成果单件50MiB／总100MiB，细则见[补充](../openspec/changes/fourbase-duckdb-phase1/formats-addendum.md)。复用既有openpyxl/Pi能力，Agent自主选表／范围和处理原文，Host不自动转换／公式重算，不扩XLSX结果附件／导出。具体合同及UI尚待整体确认；不改产品源码／测试／依赖／schema，不安装或运行引擎／Host／模型／业务库。M2–M7、主方案v1.2、原批准与FAIL／UNKNOWN／NOT_PROVED保留，不拷main覆盖WIP。关系／Semantica与M8、Git写／CI、运行服务／MacBook无新增授权。详细规则仍唯一按第2–4节；实际当前复核见[记录](../openspec/changes/fourbase-duckdb-phase1/result.md)。

**M7 当前准备核查范围（2026-11-04）：** 用户要求“继续M7”，按已批准v1.2第7节及[本次spec](../openspec/changes/fourbase-optional-engines/spec.md)先核已有能力、真实采用触发和官方组件复用。本轮仅只读审计／文档，不开发源码或持久结构、不安装／运行引擎或模型、不改依赖／测试、不读真实业务dataRoot，不启动服务、Git／CI、MacBook或M8。用户已明确近期没有上述具体受阻任务；计算／关系分支均未建立采用触发，本轮按既定门槛条件延期，未来需求／真实质量仍UNKNOWN；不把延期写成引擎已实现或组件采用获批。无产品界面变化，UI按第3节说明不适用。条件核查、相称静态／全新非作者及四原则前置复核已通过本次准备范围，准确身份与未验证见[结果](../openspec/changes/fourbase-optional-engines/result.md)；这不是组件已实现或未来运行验收。原M6完整交付回读零漂移，WIP／原件／FAIL／UNKNOWN／NOT_PROVED保持，下列范围保留为历史。

**M6 当前产品实施授权（2026-11-04）：** 用户明确确认[M6 v0.1方案与UI](../openspec/changes/fourbase-experience-learning/spec.md)并开始开发，整体采用D01–D06推荐A。原8份批准输入、466开工前副本及全量零漂移回读见[实施记录](../openspec/changes/fourbase-experience-learning/implementation.md)。按第2–4节四原则／SDD／真实行为TDD、Interface v3／Pi1.4.0和原M3–M5接缝实施最小差额，完成适用完整检查、隔离合成Host／Pi／产品UI、全新非作者及专项复核；M31例外不外推。保留全部WIP／原件／会话／文件与FAIL／UNKNOWN／NOT_PROVED。仅工程隔离合成环境可运行，不读真实业务dataRoot、不调用真实Provider；Git／CI、安装／运行采用、MacBook和M7／M8未新增授权。本地开发与工程验证已完成：1153项中1150通过、0失败、3原条件跳过，真实隔离合成Host／Pi／UI、全新非作者标准／规格双轴及四原则专项均通过本次工程范围，完整身份与限制见实施记录。收尾重复更新目标经真实RED修复、v3完整检查与非作者增量双轴／实际UI复验关闭，旧稿和目录两行保持；原v2结果及新增失败现场分别保留。真实专业增益、经营成熟与用户产品验收另证。下列确认前准备措辞是历史，不再作为开发停止线。

**M6 当前确认包准备授权（2026-11-04）：** 用户要求“继续M6”，沿已确定的spec／UI整体确认后再开发流程，当前准备[多事项经验整理与增量验证](../openspec/changes/fourbase-experience-learning/spec.md)、D01–D06及虚构内存Demo，做相称静态／浏览器／全新非作者文档复核。复用Pi1.4.0／M3／M31／M4／M5，只提出准确跨事项只读、新来源、候选预填及可选对照差额；当前不改产品源码／测试／schema或业务库，不运行产品／模型或安装。M5本地交付完整回读零漂移、原WIP／FAIL／UNKNOWN／NOT_PROVED保留；Git／CI、真实Provider／材料、运行采用及MacBook未新增授权，M7／M8未启动。完整共同行为仍唯一按第2–4节；准备结果见[记录](../openspec/changes/fourbase-experience-learning/result.md)。下列M5及更早范围是历史，不自动扩大当前任务。

**M5 当前产品实施授权（2026-11-03，11-04本地工程收尾）：** 用户已整体确认[M5 spec／UI及D01–D08全部A](../openspec/changes/fourbase-case-decisions/spec.md)，明确开始产品开发。按原已批准Case业务结构、Interface v3／原project-tasks／Pi1.4.0实施，复用M3.1／M4、原Case／Board／Feedback；逐切片保留真实动态行为前置RED，最小实现后验证公开HTTP／UI／Host→Pi→合成Provider、迁移与兼容回退，完整候选适用检查／全新非作者及四原则专项后收尾。M31限定例外不外推。批准原件／开工前快照与结果见[实施记录](../openspec/changes/fourbase-case-decisions/implementation.md)；保留WIP、原件／会话／文件及FAIL／UNKNOWN。只允许隔离合成工程环境，不读真实业务dataRoot，不调用真实Provider；Git／CI、安装／运行服务采用、MacBook无新增授权。本地开发及工程验证已完成：1130项中1127通过、0失败、3原条件跳过；全新非作者及四原则专项限本次变更通过，准确身份与限制见实施记录。下列准备范围是确认前历史。

**M5 当前确认包准备授权（2026-11-03）：** 用户要求先准备[spec／D01–D08与UI Demo](../openspec/changes/fourbase-case-decisions/spec.md)，整体确认后才开发。当前只做原Case／RAP／Board／Feedback／Pi及M3.1／M4能力核对、最小业务结构决定、虚构内存原型、适用点验和全新非作者文档复核；不改产品源码／测试／schema或真实库。四原则与流程仍以第2–4节为同源规则，M31限定例外不外推。M4本地工程已完成，原WIP、批准材料、FAIL／UNKNOWN及NOT_PROVED保留；M5具体决定仍待批准。当前无新增Git／CI、真实模型／材料、安装／运行采用、MacBook授权，见[准备结果](../openspec/changes/fourbase-case-decisions/result.md)。下列M4及更早范围保留为历史，不扩大当前增量。

**M4 当前产品实施授权（2026-11-03）：** 用户整体确认[spec v0.2](../openspec/changes/fourbase-context-reuse/spec.md)、D01–D06全部A及UI Demo，明确开始产品开发。复用原project-tasks／Interface v3业务子集／Pi1.4.0，按四点原则、真实动态行为前置RED、适用本地完整检查、隔离合成SDK／产品浏览器链路及全新非作者最终复核实施；本模块不沿用M31限定例外，原NOT_PROVED保留。批准原件／摘要与当前结果见[实施记录](../openspec/changes/fourbase-context-reuse/implementation.md)，确认前设计／原型PASS不代替产品验收。保留全部WIP、原件／项目／会话／文件及FAIL／UNKNOWN。Git／CI、安装、运行服务采用／MacBook、真实Provider／业务材料无新增授权；允许仅为验证启动隔离合成测试Host。此前M4准备范围已由本明确开工授权取代。

**M3.1 当前本地实施授权（2026-11-03）：** 用户整体确认[spec v0.2](../openspec/changes/fourbase-autonomous-candidates/spec.md)、D01–D06 和 UI，明确“确认，进入产品开发。”。仅在普通 unmanaged 项目任务复用 Pi 原生工具结果形成候选、按需只读发现及人的精确引用控制；不新增模型循环／后台摘要／正文库或 M4 上下文注入。完成适用检查、真实隔离合成 SDK／产品 UI 路径与非作者职责复用复核；保留 M2／M3 WIP、原 FAIL／UNKNOWN、原件和历史。Git／CI、安装、运行服务切换、MacBook、真实 Provider／业务材料不在本增量内。具体实现及边界见[记录](../openspec/changes/fourbase-autonomous-candidates/result.md)，不从历史授权扩大当前范围。

**试用报告修复历史授权（2026-11-03）：** 用户要求修复MacBook当日试用报告中的上传格式／50 MiB、任务页需求梳理入口及界面简化问题，按[本次规格](../openspec/changes/trial-report-20261103-repair/spec.md)实施适用SDD/TDD、完整检查、浏览器验证、非作者独立复核和Git／CI交付；完成后通过SSH将对应原报告从`待修复`移到`已修复`。用户随后明确较明显UI变更须先提供Demo审核；本轮布局／导航Demo获用户明确回复“通过，按此继续”，作为当时验证、交付及报告归档的依据。保留原报告、FAIL／UNKNOWN和既有项目、会话、配置及文件；本次MacBook操作仅限报告读取与归档，不切换任何设备运行服务，不新增真实模型实验。修复、检查、交付和归档的实际状态见[结果记录](../openspec/changes/trial-report-20261103-repair/result.md)。

**PPT Host接线修复当前授权（2026-11-02）：** 用户在已记录的接线复核“不通过”后明确授权直接修复，按[修复规格](../openspec/changes/ppt-host-wiring-repair/spec.md)落实原D4–D8合同，完成适用完整检查、隔离合成验证、非作者独立复核及Git／CI后合并main。保留现有项目、deck、版本、会话、原件与失败证据，不自动重放／换模型，不切换运行服务，不操作MacBook；真实Provider实验与产品验收未因此授权。原规范／检查记录PR #23合并不代表PPT已修复，实际结果见[修复记录](../openspec/changes/ppt-host-wiring-repair/result.md)。

**固定版本与MacBook试用交付当前授权（2026-11-01）：** 用户要求暂停继续全链路测试，固定现有版本并完成Git／CI、合并main及MacBook更新供实际体验。按[本次交付规格](../openspec/changes/current-version-trial-delivery/spec.md)先更新main、保留WIP及原始证据，完成适用工程检查、非作者复核、实际head及合并main CI，再通过原试用入口同步MacBook；保留该机已有项目／会话／文件及配置，不切换Mac mini运行服务。没有新模型全链路实验、专业FAIL重评或新分析方法开发。此前“暂不Git／MacBook”的阶段边界由本次明确授权替代，其余产品与保全边界保持。实际交付见[记录](../openspec/changes/current-version-trial-delivery/result.md)，试用范围见[用户说明](current-version-trial.md)。

**托管执行优化当前授权（2026-11-01）：** 用户已通过[方案／spec](../openspec/changes/managed-execution-optimization/spec.md)及 D1–D8 全 A，授权本地实施、适用完整检查、固定工作量性能对照复测及非作者独立复核。保留后台并行、原件保护、停止／UNKNOWN及项目／会话／文件；Host只管理环境。暂不 Git/CI 交付、安装或切换运行服务，不操作MacBook。原生命周期补充、自动核算范围与旧专业FAIL保持，下段为此前增量授权。

**2026-11-01当前实施范围：** 用户已通过[自动独立核算与原主Agent修订spec/UI](../openspec/changes/automatic-verification-revision/spec.md)、九项结构决定及[生命周期补充A](../openspec/changes/automatic-verification-revision/lifecycle-supplement-proposal.md)。本次继续本地实现、适用检查、合成资料真实模型验证及非作者独立复核；不自动Git/CI、切换运行服务、安装扩展或操作MacBook。当前Interface v3仅为显式开启自动核算的受信新任务前移环境托管，Agent仍自主计算、判断和修订；原v2阻断及旧专业FAIL保留。以下各段保留历史增量的当时授权，不扩大当前范围。

当前增量为[业务语义增强与独立核算 Agent 一期](../openspec/changes/business-semantics-verification/spec.md)：用户已确认v0.1 SV01–SV12，授权复用现有RAP/SAP/Case的必要增强、新核算接入、本地检查、兼容保全、联合回归、真实模型合成对照、非作者复核及Git/CI后合并main，合并前更新main。保留项目、会话和文件；不重建IR或固定方法库、不新增硬沙箱、不自动重放或换模型，不切原运行服务，不操作MacBook。原[EC建议](extension-correctness-proposal.md)留作历史讨论，由[确认方案](business-semantics-and-independent-verification-phase1-proposal.md)取代。

**当前交付收尾：** 用户已确认并实施[修订权限收尾方案](verification-revision-preservation-followup.md)，仅修订出稿资源收窄能力：读取固定正文、输出新稿、Host另存，使用统一生命周期的附属资源，不替换原任务指针/历史，不影响普通分析全工具策略。新根工程与有限真实保全复验、旧资料末次比较分别有证据；模型专业质量仍有重要错/漏报，保持PARTIAL、错误稿未采用，不宣称完整SV11或产品验收。旧原件破坏FAIL/UNKNOWN不恢复、清理或重放；全部适用验收/非作者复核/实际head CI约束工程合并，运行采用不自动进行，实际交付见本变更记录。

上一增量为[工程可靠性收尾](../openspec/changes/engineering-reliability/result.md)，失败诊断、观察恢复和采用版本能力及其实际交付证据保持原范围，不代表分析正确性已解决。

上一增量为[一键更新GitHub校验修复](../openspec/changes/trial-authenticated-update/spec.md)：用户授权修复匿名限流问题，保留现有项目、任务、会话和文件，完成检查、非作者独立复核与Git/CI交付并合并main；合并前更新main。随后在Mac mini实际采用，并以合成数据、真实模型从需求梳理开始验证当前产品全链路，不设模型测试预算上限；仅本地模拟经营动作，不授权真实业务派发或其他设备操作。执行、受限项与交付分别记入本变更[记录](../openspec/changes/trial-authenticated-update/result.md)及本地真实测试报告。

上一变更为[统一会话接入与生命周期管理一期](../openspec/changes/unified-session-management-phase1/spec.md)：用户已确认方案v0.3 US01–US12，授权实现、固化Codex/Qoder接入规范、本地检查、兼容迁移验证、RAP+SAP+Case联合回归、非作者独立复核，以及Git/CI交付并合并main；合并前先更新main并重验受影响部分。公共接口与少量实现共用，各域/owner状态和业务策略分开，保留原项目、任务、会话和文件。该次代码变更不新增持久结构或模型调用；后续Mac mini运行采用已另获用户授权。执行与结果见本变更[记录](../openspec/changes/unified-session-management-phase1/result.md)。

以下Case及试用交付为历史授权记录，不扩大当前增量范围。[Case一期](../openspec/changes/decision-case/spec.md)已按D01–D12及最新UI Demo实施、验证和复核；仅增加SQLite，保留现有项目、任务、会话和文件。其本地、模型试跑、Git/CI与产品验收仍按当时各自证据报告。

后续用户已通过本地候选0.1.0-mvp.4，分别授权真实模型合成试跑及本次正式Git／CI交付、合并main；合并前须先集成main刚合入的指标体系插件，再做受影响检查、独立复核及实际提交CI。统计方法与分析产物质量另记，后续可在Extension补齐。本次Git交付不包含MacBook更新、运行服务切换或新的真实经营动作。

上一变更为[MacBook单向试用交付](../openspec/changes/macbook-trial-delivery/spec.md)。用户已整体授权：先在Mac mini完成三个双击入口、本地检查、固定候选非作者独立复核、CI及合入main，再clone部署MacBook `/Users/huangbo/Dev/OptraCall`。通过既有导入／保存入口配置MacBook本机Pi凭据，保留已有配置、项目和会话；MacBook只单向更新、试用与反馈，不开发、不提交或回推。操作方式和失败处理见[试用说明](macbook-trial.md)，实际结果见[交付记录](../openspec/changes/macbook-trial-delivery/result.md)。本次不增加自动真实模型调用、分析流程、SDK限制或业务资料访问。

上一变更[项目多任务、重命名与归档恢复](../openspec/changes/project-tasks-and-archive/spec.md)已完成，用户已通过真实模型多任务验收，PR #1已合并，本地main已安全快进，核定测试数据已清理。模型过程偏离继续观察，不额外增加Host拦截；保留原验收和清理证据。

仓库基线初始化、讨论稿与规范建立、首次提交和推送已完成，原记录及证据保留。上一批次 `first-chat-mvp` 的四项逐项确认与结果如下：

| 项目 | 目标 | 当前授权 |
| --- | --- | --- |
| 1 | 按 Host + Agent + Extension 建立目录、薄规格与本地检查 | LOCAL_COMPLETE，证据保留 |
| 2 | WorkBuddy 全面调研，尤其前端 UI / 布局；初步 UI Demo 与 Host–Agent 接缝方案，含 LLM 配置界面 | 用户已审核通过最终项目版候选，原证据保留 |
| 3 | 核实并锁定最新兼容的 pi-coding-agent SDK 版本，完成统一接入与 LLM 前置准备 | LOCAL_COMPLETE，原[六点方案](stage3-sdk-and-llm.md)内存探针证据保留；当前配置及运行以第4项为准 |
| 4 | 持久项目、上传、完整Pi原生运行时及合成文档简析 | LOCAL_COMPLETE，按[本项方案](stage4-persistent-projects-and-agent.md)与最新软约束完成，独立复核通过，最新用户验收范围见当前变更结果 |

具体状态和验收见[批次规格](../openspec/changes/first-chat-mvp/spec.md)及[结果记录](../openspec/changes/first-chat-mvp/result.md)。第 1 至 4 项已分别获得相应确认；第4项以最新持久项目方案及用户软约束调整为准，各项检查与验收分别记录。

**历史例外已结束：** 原 `first-chat-mvp` 四项全部完成前曾暂缓Git（含只读命令）和CI，以本地文件清单、字节和摘要固定候选；本地SDD/TDD及独立复核照常执行。该批次已完成集中Git／CI交付，后续变更遵循第5节及各自用户授权，不能把历史例外套用到当前任务。
```

## 会话接缝历史候选与兼容记录

原规范第 168–182 行原文。现行 IN01–IN07 及仍适用的会话／保护合同保留在规范第 2 节；此处保存其原版本、限定范围与验证描述。

```markdown
**2026-11-01会话接缝初始v2增量（历史候选）：** [自动核算与主Agent修订](../openspec/changes/automatic-verification-revision/spec.md)及其[九项结构合同](../openspec/changes/automatic-verification-revision/structure-decisions.md)已由用户确认。当前Interface v2兼容原v1调用子集，增加Host-only `execution/owns`和lease的`quiesce/reopen/onCancel`；不向业务port暴露执行资格创建/owner证明。资格绑定真实owner和当前operation，不能从JSON、任意workspace或旧lease恢复。公共层在同一占用内确认旧资源终止后受控重开，不由业务层另建busy/代际/运行队列或平行Runtime。

原任务与核算仍各持原owner权威，自动链只关联实际请求。可信SDK驱动唯一写原native；所有Agent可控的文件/代码/codemode/间接工具均须跨受限执行边界，不得在驱动内留下动态执行后门。工具执行器不是另一位分析Agent，不能改变专业意见、选择方法或补计算；普通分析及旧封闭文本资源保留其原工具合同。具体保护可行性、局限及实际完成范围记录在当前变更，不将合成探针扩大成完整产品验收。

父取消先撤后续派发，再等匹配子操作和本资源安全停止；阶段间也不能提前idle。子停止/资源关闭失败时隔离原owner、保留UNKNOWN，显式close可重试失败清理，不能自动重放请求。按Provider/project/owner关闭只等待匹配资源与子停止，不受无关operation影响。IN07验证须覆盖这一增量及所有旧消费者，详见同源接入说明；历史v1实施记录仍保留原事实。

两类策略继续保留：项目任务使用绑定配置和已保存sessionFile；需求梳理在operation开始捕获当前配置，生成与最多一次修正期间固定，重建沿用原新建native策略。各owner的原生会话、上下文、配置快照与占用独立；Host只持域管理引用，协调明确的Provider/真实项目/退出范围，不另建资源台账或全局Agent运行队列。需求的目标项目不是需求会话归属。SDK原生历史读取及固定连接探针只由检查中列明的路径承担，不能借例外接管业务会话。

迁移采用原位换接线；本期不新增会话库、业务ID、持久代际或需求续接指针。旧资料保全与正常追加分开验：迁移不改写既有内容，显式续聊及原有证据校正仍可产生合法更新；回退兼容代码读取最新资料，不恢复旧副本覆盖新增工作。未知结果保留UNKNOWN/中断，不自动重放或换模型。共享代码与同进程资源仍有共同故障风险，逻辑隔离不等于进程/安全隔离。

规范完成验收须分别记录当前Codex/Qoder版本、实际项目入口及读取证据；文件存在或加载器支持某文件名不等于任务已读取。未实际验证的工具项记NOT_RUN，不能宣称固化全部通过；不得为凑通过改全局配置、调用未获准模型或启动MacBook开发。静态导入检查只覆盖已知绕过形式，仍需实际调用链、行为回归及非作者复核。

独立核算沿用Interface v1，由Host的核算适配器静态注册profile；owner包含真实projectId/taskId/verificationId，原任务资源和结果权威保持原位。按已确认SV05先固定独立结果再提供作者产物；核算、显式作者修订、一次复查和用户采用分开，不从completed推断专业正确或经营效果。固定输入、快照、原生指针归属与普通文件完整性由Host核对，不承担统计计算裁判。`SessionTurn.providedContext`是向后兼容的可选交付回执，新JSONL自定义记录可保存实际来源，旧记录不回填；SAP记录资源实际初始化索引，不使用当前启用列表伪造历史采用。详细技术与可观察限制见[核算接入说明](verification-agent-integration.md)。Codex/Qoder及其他开发者修改此接缝均先读本节与该说明；不建立平行Runtime、全局运行队列或固定方法注册中心。

已确认的修订出稿使用Host静态`verification-author-draft`附属profile和`fixed-draft`能力策略，由同一Interface v1管理。固定全文由Host读入，创建时不注册可执行工具，不自动加载技能、上下文文件、MCP或扩展；只允许产品可信脱敏扩展，不向业务Ref暴露SDK管理对象或原生命令。不得仅隐藏工具名、临时修改原分析会话后依赖finally恢复，或在材料过大时回落全工具。新native归本记录的revision-native，原项目会话指针/父链/历史保持原位，原普通分析及独立核算的既有工具策略不变。接入必须覆盖实际工具拒绝、动态/间接调用、取消/关闭/重开和原件字节保全；空工具不代表内容正确或OS沙箱。
```

## 原 AGENTS 的模块与阶段记录

原 AGENTS 第 21–61 行原文。相对链接以原文件 `AGENTS.md` 为基准。已迁为维护入口的技术合同继续按原规格／结果及后续决定核对；其中凭据、真实模型、设备更新和清理等旧授权不成为本任务权限。

```markdown
[模型包消费端](openspec/changes/model-pack-consumer/result.md#合并交付与原位归档)已完成工程交付并原位归档。维护时先读规格、结果及[后续采用记录](openspec/changes/model-pack-consumer/live-validation.md)：MPS训练／导出，OptraCall消费v1纯计算包；任务显式开启、受管／封闭资源排除，快照不可变、损坏不静默修复。用户后续授权运行采用及设备更新，实际状态按后续收据核定；当前真实业务模型与LLM验收已由用户决定跳过。旧备份包有限检查、取消、原失败及历史前置TDD证明NOT_PROVED保留。

维护[deep-research skill](openspec/changes/deep-research-skill/result.md#合并交付与原位归档)时，先读其归档记录。修改 Skill 测评信息展示时，按[统一展示规范](docs/skill-evaluation-display.md)处理。历史回执绑定被测版本，原工程修正的覆盖范围按归档中的用户裁定核对。

维护[data-analysis skill](openspec/changes/data-analysis-skill/result.md#合并交付与原位归档)时，先读其规格、结果与独立复核。原失败、暂定结论、成本与验收边界保留，工程合并和运行采用分别核定。

[商圈数据 MCP 连接器](openspec/changes/trade-area-mcp/result.md#合并交付与原位归档)与[天气连接器](openspec/changes/weather-mcp/result.md#合并交付与原位归档)已分别经非作者复核、实际head CI及获授权squash入main，OpenSpec原位归档；后续维护先读对应结果和[商圈IN06](openspec/changes/trade-area-mcp/spec.md#codex-接管补充2026-11-03)的SDK薄层复用边界。Qoder整体移交后只读，接缝及后续维护由Codex承接，原清单、移交包及失败保留。[后续真实模型记录](openspec/changes/weather-mcp/live-validation.md)为两轮工具／保存闭环完成、报告内容FAIL，不能当专业或用户产品验收；已授权MacBook main及同一正式快照采用，实际运行与保全按最终回执核定。Mac mini原运行服务保持，经营数据与凭据留在获准本机根，未来来源版本导入仍单独授权。

当前用户已明确授权[PPT Host 接线修复](openspec/changes/ppt-host-wiring-repair/spec.md)：修复已核实的项目／配置归属、完整操作占用、保护、导出／差异及UI接缝，保留原FAIL、版本、会话与文件；适用检查、独立复核及Git／CI后合并main，不切换服务、不操作MacBook或新增真实模型实验。原检查“不通过”与本次修复结果分别记录。

涉及 Semantica 接入、依赖、适配或升级时，必须读取[官方组件规则](docs/engineering-workflow.md#semantica-官方组件来源与版本约束)与[资产兼容及回退流程](docs/engineering-workflow.md#semantica-升级验证与回退)。Semantica 与 Pi 均采用官方原包，精确升级目标由用户指定；长期规则只在工程规范维护，规范本身不构成依赖升级或运行采用授权。

涉及Agent交互、SDK接入、会话启停/恢复、模型配置或插件接入的变更，开始前必须读取工程规范的IN01–IN07及[统一会话接入说明](docs/agent-session-integration.md)，在本变更规格记录Interface版本、owner/profile和验收范围。Codex、Qoder共用这些规则；工具入口只引用同一来源。

当前为[固定版本与MacBook试用交付](openspec/changes/current-version-trial-delivery/spec.md)：用户授权固定现有A/B/C、自动核算及托管优化候选，更新main并完成检查、非作者复核和CI后合并，再更新MacBook供用户体验。暂停新的模型全链路实验；保留专业FAIL、项目、会话和文件，不切换Mac mini运行服务。试用范围见[说明](docs/current-version-trial.md)，实际交付按[记录](openspec/changes/current-version-trial-delivery/result.md)分别核对。

此前[B/C分析可靠性与核算范围](openspec/changes/analysis-verification-reliability/spec.md)的实施及检查见[实施记录](openspec/changes/analysis-verification-reliability/implementation.md)，真实模型结果见[专业验证](openspec/changes/analysis-verification-reliability/professional-evaluation.md)。Host只负责材料交付、权限和记录，Agent自主选择方法、工具及内部迭代。实验参考未通过专业标准，不推广到产品默认。后续可靠性工作先读该规格和评估协议，保留首次结果、取消、FAIL/UNKNOWN；使用未见结果修订候选时重新准备未见变体。以下历史授权不自动扩大当前范围。

历史变更[业务语义增强与独立核算 Agent 一期](openspec/changes/business-semantics-verification/spec.md)：用户已确认方案v0.1 SV01–SV12，授权必要增强、合成资料真实模型对照、兼容及联合回归、非作者复核和Git/CI后合并main，合并前更新main。复用原RAP/SAP/Case、统一Pi和会话入口；新核算只核固定输入、先独立计算后对照，不重建IR或固定方法库。接入与使用见[核算说明](docs/verification-agent-integration.md)，实际结果见[记录](openspec/changes/business-semantics-verification/result.md)。保留项目/会话/文件，不自动切换服务或操作MacBook。

**历史修订权限收尾：** 用户已确认并实施[修订权限收尾方案](docs/verification-revision-preservation-followup.md)：只读固定材料、输出新稿，由Host另存；采用同一公共生命周期的附属出稿资源，不改原任务指针/历史或普通分析工具，不加载执行扩展。旧原件破坏FAIL/UNKNOWN保留，不恢复或重放；新根有限复验与专业评分分开，新稿错误及复查漏报不可隐去，不宣称完整产品验收。最终工程/兼容/非作者复核和实际head CI约束Git交付，详情见实施记录；运行采用仍另授权。

上一增量[工程可靠性收尾](openspec/changes/engineering-reliability/result.md)证据保留。原[Extension正确性建议](docs/extension-correctness-proposal.md)作为历史讨论，由用户已确认的SV01–SV12替代，不按旧EC清单开发。

[统一会话接入一期](openspec/changes/unified-session-management-phase1/result.md)已交付，共用接口与少量实现、owner状态和业务策略分开。本次继续遵守同源接入规范。

上一轮[requirements-flexibility](openspec/changes/requirements-flexibility/result.md)允许未确认框架草稿，取消澄清/假设凑数，支持描述性分析不引用假设，并补同会话一次有限格式修正；保留其正式发布、送入和兼容回退边界。

上一轮[requirements-reliability](openspec/changes/requirements-reliability/result.md)已修复目标项目／发布版本选择、真实回答编辑、模型切换和会话隔离；涉及会话关闭或请求重试时，继续核对其归属与legacy回执兼容边界。

[需求梳理初始实现](openspec/changes/requirements-elaboration/spec.md)为4-Stage软门禁、独立插件会话走统一Runtime、RAP 0.2及显式送入。A路线泛化由Qoder实施；原[交付证据](openspec/changes/requirements-elaboration/result.md)保留，本轮受影响接缝检查另记于可靠性结果。

上一变更为 [Case一期](openspec/changes/decision-case/spec.md)（已合并 PR #4）及其后的 [macbook-trial-delivery](openspec/changes/macbook-trial-delivery/spec.md) 单向试用交付；各自的结果与授权范围保留在对应记录中。

[项目多任务变更](openspec/changes/project-tasks-and-archive/result.md)已完成用户验收、PR #1合并及核定测试数据清理。模型过程偏离保留观察，不额外增加Host拦截。原 [first-chat-mvp](openspec/changes/first-chat-mvp/result.md)证据保留；旧四项完成前的Git／CI暂缓期已结束。后续执行核对实际分支、WIP和固定输入，Git／CI、安装和用户验收分别报告，不覆盖证据或自动重放中断任务。

第4项允许持久保存五模型配置／凭据、定向读取本机Pi和SSH读取MacBook Pi指定MiMo凭据，经前端同一保存／导入入口配置；允许真实项目、上传、原生SDK多轮及完整macOS工具／bash／Python、用户安装原生扩展／skills／MCP的接入能力。只用合成数据验收，不代装数据分析skill。Host管环境，Agent管分析，不自建推理循环或Host补计算。

项目是共享工作空间，任务只能在项目内创建；任务独立会话／草稿／运行状态，三目录由项目共享。产品界面支持项目重命名、归档／恢复，不提供删除入口；本次工程测试数据清理不改变该产品规则。归档只读且不自动停止运行，先满足已确认的空闲准入。schema2迁移保留旧原生JSONL路径／字节及父会话引用；具体字段和恢复规则以当前结构方案为准。

真实默认目录严格为 `010_draw`、`020_clean`、`060_reports`。用户已撤下强制原件禁读沙箱／工具拦截，改为系统提示词软约束“分析不读取010中的数据”，使用用户020资料，过程输出默认020、最终报告060；前端提示不提供敏感数据隔离，勿放敏感数据。Host不猜测最终报告。第3项内存／空工具约束只代表历史阶段，不覆盖后续已确认范围。
```

## 反馈工作区旧目录记录

原规范第 428 行原文；现行反馈规则见工程规范第 6 节。

```markdown
**反馈工作区与旧目录约定（2026-11-14 后续确认）。** `/Users/huangbo/Dev/OptraCall-Test-And-Repair` 后续用于 Qoder 反馈会话和本地项目规则维护。该目录的 Git 初始化由用户另行安排；向目标仓库提交 Issue 不以此目录已初始化 Git 或配置 remote 为前提。用户已删除原 `待修复`／`已修复` 两个子目录，后续不重建，不再用文件移动表示处理状态。旧报告处理及原 FAIL／UNKNOWN 以既有工程记录保留其当时事实；目录删除不等于其中问题已修复，也不触发报告恢复或批量建单。当前处理状态以 GitHub Issue 及其结案证据为准。SSH 仍可用于另有授权的规范同步、本地诊断或设备交付，按各自范围执行。
```

## 已停用的 Extension 专项移交模式

2026-11-28，用户明确说明 Qoder → Codex 的 Extension 专项交付模式已不再使用，要求先移除再正式落库。该模式已从现行工程规范移除；本节仅保留 v1.17 原文，不供新任务采用，不改变原移交时已形成的归属、失败和历史责任记录。后续任务统一按现行 Issue 共享流程确定实际 Agent、修改范围和唯一写入者。

```markdown
### Qoder → Codex 移交交付模式

这是 Extension 的可选技术移交路径，适用于 Qoder 开发并将候选交由 Codex 接管的变更。采用本模式时，在当前变更规格记录安排与范围。

采用本专项路径时，在[外发 Issue](#github-开发任务外发与交付)写明领取方可实施的业务与接缝、Codex 的技术接管范围，以及 PM Agent 的工程交付责任。领取、移交回执和结案沿用同一 Issue。

1. **Qoder 开发。** 在 `qoder/<slug>` 分支的独立工作树实施 Extension。Host／Agent 接缝由 Codex 实施；仅在用户对本变更直接指定 Qoder 实施接缝时，Qoder 才可承担该部分，并按 IN06 在规格记录例外的范围、理由及后续维护回归 Codex 的安排。先例、一般“开工”指令或自行填写 IN06 记录均不构成该指定。完成规格、适用 SDD/TDD、`npm run check`、隔离环境端到端及浏览器点验，保留失败与未验证项。变更目录提供候选文件清单与哈希、结果和证据索引，以及包含接缝互查导引、非作者复核任务书和移交声明的移交包。
2. **分支移交。** 在有效 Git 授权内将全部候选与移交包固定为单一交接提交，推送 origin；原工作树切为游离状态释放该分支，并停止写入。交接提交、基线、原工作树及候选身份须可核对。移交即分支所有权转移，此后唯一写入者为 Codex，Qoder 保持只读。
3. **Codex 技术接管。** fetch 后在独立工作树检出该分支，核对提交与清单哈希，完成接缝互查、修复、提交和受影响检查，更新规格和结果记录。固定修正后的完整候选，在 Issue 回执。当前 PM Agent 按第 4–6 节组织非作者独立复核、验收证据核对和 Git／CI 交付，并完成适用的 OpenSpec 归档。

移交前后同一分支同一时刻仅有一个写入者。独立复核者须未参与候选任何部分的创作，且不继承作者会话历史；接口互查与作者测试仍按第4节单独报告。本模式不改变 IN01–IN07、职责边界及复用检查、独立复核的强制要求，也不扩大模型、数据、设备、安装或运行采用授权。

未经上述直接指定实施接缝时，在结果记录保留流程偏差、实际范围及用户后续决定；事后知情接受、保留实现或 Codex 互查兜底不追溯改写为原流程合规。
```

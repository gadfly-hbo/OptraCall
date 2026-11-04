# L1 增量整体确认决定包

v0.1 · 2026-11-04 · **用户已整体确认spec／UI及D01–D08全部A，进入开发**

按 [spec](spec.md) 及工程规范的前置确认收敛。下面不提交新数据库设计，重点确认已有持久写入资格的一项变化及其读取合同。

## D01｜权威与对象范围

**建议 A：** L1 组合现有 SAP、企业资料、M2、M5／M6；无新 Registry、统一 semantic_id 或九类 CRUD。粒度／身份分别沿 package@version/metric、storeId/materialId/revisionId、projectId/datasetId/inputVersionId/descriptionRevisionId/citationId、caseStoreId/caseId/recordId/revision、choiceId、原 native entry。内容所有者不变；同名不去重并存，严格精确引用不替新版。来源可以被多个判断引用，一个判断允许多来源；关联不复制源权威。

原因：现有版本与来源足以承载本版问题，另建对象将重复版本和发布管理。替代 B：一次建立九类语义对象与状态，扩张明显。替代 C：维持各页面分散查询，减少代码但引用链仍难用。

## D02｜时间：首版做来源可解释的读取，不新建历史引擎

**建议 A：** 不新增 `valid_from/to/known_at` 持久字段、时间表或回填。读取组分别是：原系统可核的保存／发布／事件时间及证据；原文业务时间声明及准确位置；原稿明确引用及原对象身份。空值表示未知，不用0、当前时间或创建时间代填。原文没有时区／范围保持歧义；日期文本不由 Host 正则升级为正式有效期。

只接受有合格留存证据的 `recordedBefore` 过滤，未知项另列，结果声明覆盖局限；不承诺完整历史目录快照。Agent 解释时间含义／比较新旧前提。以后若要可机器过滤的有效时间，先验证 Semantica／Graphiti 原生双时间映射，不在 L1 先建并行引擎。

原因：existing createdAt/updatedAt 不等同 valid-time 或 Agent 已知时点。替代 B：先建完整双时间业务库，当前证据及需求不足。替代 C：只显示最新一份，不能保护历史判断。

## D03｜关系、来源链与查询结果

**建议 A：** 新只读适配按现有 refs 展开：M5 `source/citation` → M2 citation manifest → SAP／说明／企业资料／附件。M5 和 M6 不增直接 SAP／数据来源枚举。普通文本关系继续以原文表达，Agent 阅读，不在正文埋 JSON 协议。关系方向与 supports/opposes/limits 等含义沿原合同，声明不证明因果。

读取结果是可重算的内存 ReadModel，字段组按[最小工具合同](tool-contract.md)，为原身份／原状态、正文或明确片段、来源 refs、原留存证据、业务时间原文、声明引用／实际提供层次、当前治理、分页与缺口。没有新落库、更新／删除入口、统一生命周期／默认可信度。技术资源上限不成为分析方法配额；截断／分页明确提供继续读取办法。

原因：M5 已可引用 M2 citation，只缺 citation 清单的按需读取接缝。替代 B：加通用全域图／全新引用体系，不采用。替代 C：只能把长报告当桥接来源，无法结构化展开准确 refs。

## D04｜Agent 工具与各资源资格

**建议 A：** 一个 `read_semantic_context` 业务工具，动作 `find/read/trace`；一个 D05 中的最小写工具。沿 Pi1.4.0 customTools、原 `project-tasks`／Interface v3 绑定 owner，不自建查询 Agent、压缩器、恢复器或会话域。profile 资格、跨项目权限、取消／迟到和当前操作核验沿统一入口。

首版普通任务可用；受管／独立核算／冷读／fixed-draft／需求／PPT 专用资源不扩。不得为提供新工具移除保护、放开根或反向禁止人的独立历史查看。业务适配器负责确定性结构／引用读取，Host 保持环境资格与接线，Agent 自主决定工具和判断。

原因：已有 Runtime 与业务调用足够。替代 B：六个分散新工具＋新 runtime，维护和上下文负担高。替代 C：暂不提供工具，仅给人更多表单，不符合减少操作。

## D05｜允许 Agent 显式留存自己的成果来源（本包唯一持久写资格变化）

**建议 A：** 将原已批准 M2-D06“只有用户显式记录”增量扩为“用户或普通任务 Agent 显式声明并调用原 createCitation”。新增 `record_analysis_sources`，只写原 M2 citation／所选成果附件，不冻结输入、编辑定义、发表 SAP、保留经验或修改人的选择。使用原 schema2／operationId／requestFingerprint／baseIndexRevision／citationId、原 reports/attachments/selections/conceptRefs/sapRefs/declarer/declaration 等合同；`declarer='agent'` 已存在，无新字段默认值或 metadata sidecar。

真实 project/task/native/entry 的来源绑定由 Host 从当前操作核验，不信任传入路径／任意 owner。M2 当前格式和资源上限保持：060报告与020/060所选文本附件，沿 DuckDB 已确认七类文本／单件50MiB、合计100MiB；XLSX作为原 inputVersion，不新增二进制成果导出。Agent 自主选零个或多个附件，不能默默裁掉声明。

`nativeEvidence`仅在相应真实entry已经存在、可回读并核对时填写，否则沿原可空字段保存null；尚未生成的toolResult entry不预填ID。原Pi会话随后按真实调用保存工具参数／结果，不为补齐关联再建一份运行台账。

保存是作者引用声明，不是专业正确、真实计算采用或用户批准。Host 不自动扫工作区、不把每次查询结果自动入库。相同 operation 同载荷沿原回读；换载荷冲突，ACK不明保留UNKNOWN并查原操作，不自动重新创建或重放模型。项目只读／归档、CAS／hash不符、取消及跨owner按原拒绝；旧记录不回填。

原因：Agent 能在正常工作中自留明确依据，用户免做重复来源录入；只复用既有持久化。替代 B：保持用户显式点击记录，少改一个资格但人工负担不降。替代 C：Host 每轮自动绑定所有可见资料，会伪造采用，不采用。

## D06｜Binding 核查及人的操作

**建议 A：** 不新建 Binding 表、键体系、正式发布状态或自动 JOIN 裁判。返回 M2 已有字段／粒度／单位／业务时间及未知，Agent 如需用原 Python／DuckDB核查键、重复、粒度、时区和计数，方法与结果随原成果附件留存；业务有效性由人／Agent说明。资料未发表不阻断普通分析。

正常流程“原任务提问并发送”新增必做动作0；可选查看／追问／纠正仍原任务，技术身份从对象带出。Demo中的模式选择和故障开关仅供审阅，不作为产品用户必选项。原因：减少维护成本，不把结构校验冒充业务验证。替代 B：先填完映射／时间表才可分析，不推荐。

## D07｜Semantica 优先验证与 Graphiti 条件比较

**建议 A：** 当前 L1 不安装两者。L2 首个候选限 Semantica 来源、时间／版本快照及所需显式关系查询；不默认全量文档抽取、GraphRAG／embedding／LLM／全本体。Graphiti 仅在 episode＋事实演变／实体对齐等具体缺口无法由该最小范围经济满足时，同内容／同问题比较，不要求两个后端一起维护。

L2 投影区分权威发布定义、普通证据陈述和推断关系；普通证据可参与查询但不会变正式规则。映射保留原身份／版次／hash、方向、业务与记录时间、不确定性和损失，组件图不回写正式 SAP／历史。具体版本／后端／持久布局／provider／安装和运行决定在后续 session 完成 POC 规格与有效授权后实施；当前只固定可复用范围和进入条件。完整门槛见 component-boundary。

原因：优先复用原生出处和时间能力，避免 L1 自建图历史后再接组件。替代 B：现在全部采用或自建通用 provider，不推荐。替代 C：永久放弃图组件，缺少后续增长路径。

## D08｜兼容、验证与分阶段交付

**建议 A：** 本包整体确认后开发 L1，按真实 RED／完整适用检查／合成 Host-Pi-工具-保存-重开／UI／全新非作者与四原则验收。只增既有引用读取与原 citation 写入资格，不改 Case／Board schema、SAP0.2、Pi native 或项目 schema，无批量迁移。旧代码回退前禁用新工具，新 citation 仍原 schema2，可从原 UI 读取；保留新增文件及所有原始失败／NOT_PROVED。

然后按用户已授权完成 M8、集成届时最新 main、Git／实际 head CI／合并并安全快进，核清工作树后写 L1→L2 handoff。运行服务切换、MacBook、真实 Provider／业务材料和 L2实施不自动包含。原因：工程交付和运行／专业／用户验收分开。替代 B：本次直接跳过确认实现全部，违反用户停止线。

## 决定账本与完整性

| 项 | 主题 | 推荐 | 用户决定 | 一致性 | 状态 | 依据 |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | 对象／权威／身份 | A，引用现有对象 | A | 一致 | 已确认 | reuse-audit；SAP／M2／M5类型 |
| D02 | 时间／空值／版本 | A，不增持久时间库 | A | 一致 | 已确认 | spec§3.2；原时间字段 |
| D03 | 关系／ReadModel／基数 | A，显式引用展开 | A | 一致 | 已确认 | 原 M5→citation→源合同 |
| D04 | 工具／owner／接入 | A，原 Pi 普通任务 | A | 一致 | 已确认 | IN01–IN07／Interface v3 |
| D05 | 唯一新增写资格 | A，Agent显式原M2记录 | A | 一致 | 已确认 | 原M2-D06及CreateDataCitation |
| D06 | Binding／人工路径 | A，原映射＋Agent核查 | A | 一致 | 已确认 | M2映射与四原则 |
| D07 | 组件／投影／L2 | A，限范围条件验证 | A | 一致 | 已确认 | component-boundary |
| D08 | 兼容／验证／交付 | A，分阶段 | A | 一致 | 已确认 | delivery-plan与用户指令 |

13类结构检查：业务目的与owner、对象／粒度／身份、字段与空值、方向与基数、生命周期／版本／时间、来源／更新、读写入口、验证／并发／授权、兼容／回退、跨模块影响、ReadModel定位均由上述条目及原合同覆盖。物理表／列／索引／迁移为**不适用**：没有新增持久结构；不将通用九类对象当已定义。持久字段不变，引用多对多沿原数组与Store限额，无级联删除。不会从用户沉默推断 D05 获批。

用户明确回复“确认L1的spec和UI Demo，D01–D08全部按A实施，开始开发”，并追加“只作辅助、不阻断原分析流程、正常新增必做操作为零”；已纳入spec／L113验收。原批准包按开工前准确字节保全，批准不代表功能已实现或运行验收通过。

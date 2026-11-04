# SAP 分析方法与 IR 后置提炼：现有能力核对

日期：2026-11-04。范围：本工作树 `codex/sap-ir`、HEAD `57742b99d173bfa6413e83705682b0444359add4` 的静态源码与文档核对。当前仅准备规格与虚构 UI Demo，本文不表示产品功能已实现或通过运行验收。

依据：[已确认产品讨论稿 v1.2](../../../docs/OptraCall_Analysis_IR_产品讨论稿_v1.2.md)、[工程规范 IN01–IN07](../../../docs/engineering-workflow.md)、[统一会话接入说明](../../../docs/agent-session-integration.md)。最新产品边界为 **IR 与其他 SAP 方法先保存、后发布，发布成功后才可供后续任务参考**。

## 1. 核对方式与限制

- 先用 codebase-memory-mcp 当前工作树索引 `optracall-sap-ir-preparation-20261104`，以 `search_graph`、`get_code_snippet`、`trace_path` 和 `search_code` 定位实际符号及链路。对图结果缺少的精确上下文，补读已定位文件的有限行。
- 没有安装依赖、运行 Host／模型／业务库、读取真实业务材料或凭据，没有修改产品源码、测试、配置和持久结构。
- 图中的同名内嵌函数可能定位到另一箭头函数；例如 `server.assertActive` 的片段命中不能单独当证据，已回读实际定义 `server.ts:277`。
- 下列行号来自当前文件。静态存在不证明整条产品路径运行成功；方案中的新增 owner、方法记录和适配仍是待审核设计。

## 2. 当前 SAP 发布与采用链路

| 已核能力 | 源码证据 | 实际边界／本轮差额 |
| --- | --- | --- |
| SAP 0.2 文档与场景 | [SapDocument](../../../extensions/business-plugins/metric-factory/sap/validate.ts#L20)、[SapScenario](../../../extensions/business-plugins/metric-factory/sap/validate.ts#L14) | `SapDocument` 只有 package、dimensions、metrics、scenarios；场景的 `method_refs` 是字符串引用，尚无本轮目标中的完整方法实体、两类来源、方法版本和纠错关联。不能直接向旧 schema 填新增字段。 |
| 项目草稿输入 | [draftInput](../../../extensions/business-plugins/metric-factory/api/routes.ts#L32) | 现有入口从真实项目 `020_clean` 下的 YAML 读取草稿，不是统一方法编辑／版本管理 API。不能将此入口已存在等同于 SAP 方法保存已完成。 |
| 明确发布 | [publishDraft](../../../extensions/business-plugins/metric-factory/api/routes.ts#L41) | 校验 SAP 0.2，发布时要求非空 `publishedBy`；`validate` 不发布。`publishedBy` 是本地审核人字符串，并非已实现独立账号／角色权限系统。 |
| 正式版本不可静默覆盖 | [createMetricLibrary.publish](../../../extensions/business-plugins/metric-factory/library/store.ts#L103) | 相同 id@version 同字节可回读幂等；不同内容同版本报冲突；相同内容重复发新版本拒绝。文件与索引留有 hash／指纹，发布版由库读取。方法需复用相同产品语义，具体结构由确认包确定。 |
| 项目固定版本采用 | [enable 路由](../../../extensions/business-plugins/metric-factory/api/routes.ts#L96)、[enablement](../../../extensions/business-plugins/metric-factory/project/enablement.ts#L70) | 必须库中已有该确定发布版，才可为项目启用；项目记录包 ID、精确版本、启用时间。发布与项目采用是两件事。 |
| 初始化提供项目索引 | [metricIndexText](../../../extensions/business-plugins/metric-factory/project/index-text.ts#L28)、[renderMetricIndexText](../../../extensions/business-plugins/metric-factory/project/index-text.ts#L10) | 读取项目已启用包的固定发布版，给 Agent 简短索引及完整定义路径，Agent 按需用 read/grep 查读。原文不是强制分析步骤。 |
| 已发布全局 SAP 的准确查读 | [SemanticContextService.query](../../../src/host/semantic-context-service.ts#L72)、[SAP find](../../../src/host/semantic-context-service.ts#L201) | 当前语义工具也能查全局已发布指标目录，并按 package/version/hash 读准确版本；这一路径没有项目启用筛选。不能把“只有项目已启用才可查读”冒称整个 SAP 的现有统一规则。 |
| 实际提供记录 | [sapProvision](../../../src/agent/project-session.ts#L165) | 原生记录保留初始化索引文本及 hash，声明 `provided-not-adopted`；不能从当前启用列表重建历史采用，也不能把提供等同于已读或正确采用。 |

现有 metric-factory 的 `draftInput`／`projectInput` 只检查项目存在，见 `routes.ts:32`、`:69`，没有在这些入口逐项核对 `archivedAt`。因此，本轮新增源提取应遵从 Host 的源项目可写准入，而 SAP 全局方法管理沿自身资格；不能宣称旧指标路由已实现全部归档保护。不要以本轮准备任务扩修无关旧指标行为。

### 2.1 项目指标草稿与全局方法资产的差额

现有指标草稿是**项目文件**：`routes.ts:25`、`:32–38` 只接收真实 projectId 与该项目 `020_clean/*.yaml`，由原 `readProjectFile` 读取。当前库并没有一个可直接复用的“全局未发布方法 draft Store”。生成草稿、从项目读入发布与全局方法管理是不同责任。

全局已发布指标库使用 Host 注入的 `libraryRoot`，当前接线为 `<dataRoot>/metric-assets`，项目采用元信息在 `<dataRoot>/projects/<projectId>`，见 [server.ts:113](../../../src/host/server.ts#L113)及 [routes.ts:13](../../../extensions/business-plugins/metric-factory/api/routes.ts#L13)；[库布局](../../../extensions/business-plugins/metric-factory/library/store.ts#L45) 为库根下 `index.json` 加 `<id>/<version>.sap.yaml`。当前 `LibraryEntry` 仅含包身份、指纹、发布时间／人、指标名和场景 ID，见 [store.ts:7](../../../extensions/business-plugins/metric-factory/library/store.ts#L7)。项目采用另存精确版本；不是在项目复制整份已发布库。

本轮方法属于**当前用户的全局 SAP 方法资产**，源项目／Session 仅为来源。后置提取的启动和源材料读取核对源项目状态，方法保存后在 SAP 全局管理范围继续查看、编辑和发布，不能因源项目后来归档就冻结该方法。未发布方法的全局保存、明确发布及版本索引仍需最小适配，不能把项目 YAML 草稿自然升级为全局方法对象，也不能直接放入旧库严格索引而不讨论兼容。

建议在 D01–D08 中确认上述业务归属和最小记录粒度；**本轮不冻结物理文件名、表、schema 或迁移**。具体全局方法 draft 与原库索引如何共存、隔离旧 parser、幂等与回退读新资料，留待核定的结构决定与后续实现证明。源归档资格只作用于新源提取及其来源访问，不扩为全局 SAP 管理锁。

## 3. Session、记忆与纠错能复用什么

| 已核能力 | 源码证据 | 复用与限制 |
| --- | --- | --- |
| 不续聊、不修改原件的 native 快照 | [readNativeSessionSnapshot](../../../src/host/native-session-snapshot.ts#L18) | 校验安全路径、单链接文件、文件身份与读取前后变化、UTF-8、完整 JSONL、父链；复用 SDK `parseSessionEntries`／`SessionManager.inMemory`，不 open、不迁移、不追父会话文件、不修复 JSONL。单次文件上限 50 MiB，共享预算默认 20 文件／50 MiB，见 `:6`。 |
| 原任务历史投影 | [savedTaskHistory](../../../src/host/project-history.ts#L17) | 用原 SDK branch/context 投影历史及真实 run／providedContext；不启动模型。只是来源读取能力，不是后置分析逻辑提炼。 |
| 准确回复来源 | [readSavedTaskReply](../../../src/host/project-history.ts#L43) | 按真实项目、task、sessionId、messageId 精确读 assistant 回复；源失读、重复身份或超预算应明确失败，不改用 latest。单条回复不能替代完整 Session 中的工具活动与分析过程。 |
| Agent 自主知识／经验候选 | [createCandidateTools](../../../src/agent/project-session.ts#L289)、[候选解码](../../../src/agent/agent-candidate.ts#L54) | 候选绑定 project/task/session/request/toolCall；原生专用工具调用与当前运行资格必须匹配；正文由 Pi native 唯一保存。工具 accepted 明确不证明已落盘。只有普通任务可用，workspace／受管／封闭读取资源没有该工具。 |
| 按需查找和准确查读记忆 | [createPersonalContextTools](../../../src/agent/project-session.ts#L315)、[createPersonalContextReader](../../../src/host/personal-context-reader.ts#L29) | 查标题、别名、范围后读准确原文、片段、来源、人的独立纠正；当前排除／治理未知时不向 Agent 提供正文。候选仍标明 Agent 生成未人工确认，未被当成系统指令或已核实事实。 |
| 追加纠正／排除治理 | [candidateControlState](../../../src/host/agent-candidate-controls.ts#L69)、[AgentCandidateControls.apply](../../../src/host/agent-candidate-controls.ts#L120) | 操作 ID／目标修订、独立纠正、排除／恢复及保存后回读可复用；它治理原记忆候选，不是 SAP 方法发布权威或完整方法替代版本链。 |
| 来源与人工资料修订 | [PersonalSourceRef](../../../src/host/personal-retention-types.ts#L7)、[PersonalRetentionStore](../../../src/host/personal-retention-store.ts#L12) | 已有企业资料、native 回复、成果、反馈等来源，另有精确 revision／hash、CAS、pending 和原失败保留；只能复用相应原权威，不能把“个人保留”冒充方法已发布。 |

**需要保持的区分：** 新发布边界作用于 SAP 方法资产。普通 Agent 记忆候选当前可作为带局限、治理状态的参考，这不是本轮顺手改为“所有记忆都必须先发布”的依据。IR 提炼可以读取获授权记忆作为来源，但其保存后的方法成果必须发布后才可供后续任务作为方法资产参考。

图检索 `提取分析|提炼分析|method_refs|analysis.?method` 只找到场景方法引用和通用分析提示，未发现目标中的“分析窗口提取 Session 逻辑并保存 SAP 方法”实现。该结论限本次静态范围，不表示未来完整性已证明。

## 4. 后置提取会话：最小复用建议

### 4.1 复用公共域，不复用原任务指针

当前 Interface 常量为 **3**，见 [agent-sessions.ts:5](../../../src/host/agent-sessions.ts#L5)；依赖锁定 **Pi 1.4.0**，见 [package.json:21](../../../package.json#L21)。公共 `SessionProfile`、`SessionLease`、`AgentSessionPort` 和 `createAgentSessionDomain` 已提供所需构造、占用、取消、配置核对与关闭骨架，见 [公共接口](../../../src/host/agent-sessions.ts#L17)。

已有 [decision-board 附属提取域](../../../src/host/decision-board-sessions.ts#L19) 用独立 owner／sessionDirectory、捕获配置及同一公共 `withSession` 运行，Host 只负责来源和业务结果保存，可作为接缝参考。**它处理固定报告片段，并不是完整 Session 方法提炼，不能整包复制并宣称满足本轮需求。**

建议本轮规格明确一个附属的提炼 owner（真实源 project/task 与独立提炼请求身份），由 Host 静态注册 profile、核对真实来源、安排独立 native 目录，并向业务模块注入更窄的 port/ref。确切字段和持久记录由待审核决定包确定。不得向新资源传原 `task.sessionFile` 当续聊入口；不得更改原 task/session 指针、draft、父链或原生字节。

原因是普通 [project-tasks 事件投影](../../../src/host/server.ts#L192) 会在新 snapshot 到达时更新原 task 的 `sessionFile`。直接把提炼当原任务的一轮普通 prompt 会混入原历史，违背后置独立整理与原件保留边界。

### 4.2 完整 Session 不适合套用现有封闭全文上限

[AgentWorkspace](../../../src/agent/project-runtime.ts#L19) 当前支持 `fixed-draft`／`text-only`。两者都走 [fixedInput](../../../src/agent/project-session.ts#L102) 的无执行、无工具资源路径；[createRuntime](../../../src/agent/project-session.ts#L427) 同时关闭扩展、skills、MCP、上下文文件。

[ProjectAgent.#execute](../../../src/agent/project-runtime.ts#L155) 的请求上限分别为 fixed-draft **20,000 UTF-16 单元**、text-only **65,536 UTF-16 单元**。前者是旧固定全文出稿合同；后者是固定片段的技术封装上限。它们不是完整 Session／相关记忆的产品长度上限，不能通过静默截断来源来套用，也不能把 Agent 的“已完成”当全文覆盖证明。

建议沿 Pi 原生 **read／grep／ls** 按需读取 Host 核定的只读来源快照和获授权相关记忆；提示词只交目标、来源目录与局限，不一次灌入全部记录，不安排 Host 总结代替 Agent 提炼。原 SDK 上下文管理继续归 Pi；每次真实读取的来源与范围可追溯，未读、失读和来源不完整必须保留。

这个建议仍有明确接缝差额：

1. 现有 [workspace 构造](../../../src/agent/project-runtime.ts#L149) 和 [createPersonalContextTools](../../../src/agent/project-session.ts#L315) 会关闭普通个人／语义工具，不能假定新附属 profile 自带记忆 port。
2. `workspace.defaultTools` 是工具可见／选择配置，**不是文件系统权限或扩展隔离**。若保留原生读工具，需核对 Host 只读来源投影、读取根与资源加载限制的实际实现；不能仅凭 cwd 或系统提示词宣称保护原件和凭据。
3. 可优先复用 v3 的受限读取与 scope 原语，或为该附属 profile 补最小获授权来源 port；准确选择需在规格中列明，并在后续实现时用真实读路径证明。无需新 Runtime、平行 Agent 循环、独立检索系统或全部 Session 的强制截断协议。
4. 源 Session 快照遵从现有安全读取与预算；超过当前可核范围时明确局限／未完成，不能伪装完整。未知来源、来源改变或取消后，不继续保存成功结果，也不自动重放提炼。

### 4.3 准入与生命周期必须并入原 Host 边界

| 事项 | 现有依据 | 新附属提炼需要核对的差额 |
| --- | --- | --- |
| 源任务仍 busy／阶段间／收尾 | [projectBusy](../../../src/host/server.ts#L434)、公共 [busyInScope](../../../src/host/agent-sessions.ts#L64) | 以公共实际占用核对，不能只看界面 idle 或 SDK 单 turn 结束；来源稳定后按用户显式提取启动，不停止无关 owner。 |
| 归档与归档中 | [assertActive](../../../src/host/server.ts#L277) | 新源提取沿源项目可写准入；提炼域纳入项目完整占用后，归档不能漏掉该资源。已保存 SAP 全局方法的管理沿自身资格，不随源项目归档冻结。旧来源只读可查仍核原资格，不因归档自动重放。 |
| 配置捕获／Provider 清除 | [availableConfiguration](../../../src/host/server.ts#L132)、[closeAgents](../../../src/host/server.ts#L257)、[配置清除](../../../src/host/server.ts#L555) | 附属域纳入同一 provider/project 关闭协调；不能另建全局队列。捕获原来源任务配置的合法引用及完整快照，配置关闭时取消、等待清理，不能静默换模型。 |
| 取消／迟到保存 | [SessionContext.isCurrent](../../../src/host/agent-sessions.ts#L11)、[公共 cancellation](../../../src/host/agent-sessions.ts#L108) | 取消后撤保存／后续派发资格，原失败或 UNKNOWN 保留；同操作真实已保存的回执独立回读，不凭迟到 completed 宣称全链路成功。 |
| 保存与发布 | [既有发布路由](../../../extensions/business-plugins/metric-factory/api/routes.ts#L41) | 提炼只提交方法未发布版本；用户明确发布按 SAP 规则执行。提炼 Agent 不获得自动发布或人的经营决定权限；普通保存不自动启用项目版本。 |

## 5. 设计阶段四原则核对

- **Host 管环境：** 源归属、权限、快照稳定性、保存／发布回执及公共生命周期属于 Host；提炼的内容、价值判断和方法组合由 Agent 决定。
- **Agent 自主执行：** 不规定固定摘要步数、工具配额、分析步骤或必须生成记录；允许零成果、直接关联既有已发布方法及明确来源不足。
- **优先复用 Pi：** 同一 Pi 1.4.0／Interface v3，复用原生 Session 投影、工具与上下文；已核差额限方法资产管理和附属提炼 profile 的业务接缝。
- **减少人的操作：** 正常分析新增必做操作为零；需要沉淀时一次提取并保存未发布版本；希望供后续任务参考时明确发布。来源／版本／机器身份由系统真实绑定，普通参考不逐次审批。

以上为**设计依据核对**，未实施新增差额；不能写成受影响产品运行路径、专业提炼质量或用户产品验收已通过。具体 owner/profile、权限方案和方法持久结构以整体审核通过的规格为准。

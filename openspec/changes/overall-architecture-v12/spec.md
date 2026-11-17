# OptraCall v1.2 增量规格 · 已确认实施

2026-11-17。准备基线 `3a529a0e381bf67b998f2b1debd242a5eed38884`（tree `182bd1f9f3a98940d82ec65c446d621bf7e8b67a`），分支 `codex/v12-strategy-purpose`。本规格承接已上线 v1.1，只实施 v1.2 新增或改变的行为，不重做七模块、不重开历史差额。

产品基线在仓库外：`/Users/bendandebaba/.codex/plans/optracall-architecture-product-v1.2/OptraCall_Overall_Architecture_Product_Plan_v1.2.md`，SHA256 `e3ca18ace644bb28524e70ef50d9106b892a638a786c241e1d1423f13a221694`。v1.1 溯源 SHA256 `98461897225f0e69d3d6619e93dc6ef02fdf5912d685d11fe7f5ad08157cd5f5`。第10节/附录B仅为历史；文末原 PM“不开发”不覆盖本轮新工程授权。

## 1. 目标、开工门与范围

完成“用途与背景 → 自然语言战略协作/开放方法 → 原目标/GSA准确保存采用 → 原Case/Project确认 → 单/多Task执行及综合 → 原反馈”的增量承接，保留原七模块和已确认两种确认语义。

用户已启动本轮增量工程；当前阶段完成盘点、此规格、[任务清单](tasks.md)、[验收](acceptance.md)和[原App上的Demo](ui-demo/README.md)。工程规范第3节要求新增/实质UI及关键交互先确认。**用户已批准准备候选7fe8b908及本次UI/关键交互，并授权持续实施，见[确认记录](approval.md)。** 原方向不重新访谈；普通技术修正自主进行。确认后按本规格连续TDD/集成/非作者复核推进，不逐Task或逐模块重复审批。

本轮未授权Git提交/推送/远端CI/合并、正式迁移/双机服务更新、SDK升级、真实Provider/业务资料。可独立完成的隔离工程、合成Provider和UI检查继续推进；不将缺少真实模型验证解释成缺功能。data-analysis原免测决定有效，本轮不改其本体，也不将免测扩到其他Skill。

## 2. 增量与实际复用

详细事实见[增量对照](delta.md)。本轮要求编号：

| ID | 产品条款 | 可观察结果 |
| --- | --- | --- |
| V12-01 | §1.3/4.1 | 默认用途可保存/重开；本工作用途可不同，讨论、确认Plan及实际Task得到准确快照 |
| V12-02 | §2.1/2.5 | 已有GSA无BSC直接承接；不重做方向或目标，不把目标数值当企业战略 |
| V12-03 | §2.4 | 原战略页直接自然语言协作，复用资料/来源，形成有依据和未知的候选 |
| V12-04 | §2.4 | 优先参考战略选择框架；其他方法按需选/组合/更换，既有讨论与目标不丢 |
| V12-05 | §2.5 | GSA日常入口，BSC默认隐藏/按需展开；同一目标、关系、指标和历史可回源 |
| V12-06 | §2.3/2.6/5.1 | 必要/贡献/因果假设/替代路径/条件/证据强度分开表达，并进入准确下游背景 |
| V12-07 | §2.6/9.2 | 环境变化/探索按证据与窗口处理，继续独立可行部分，不后台扫描或自动换战略 |
| V12-08 | §2.3/2.6 | TOC/TP贯穿相关业务、项目整体实质采用；工具/顺序/组合由Agent决定 |
| V12-09 | §9.2 | 复用三层反馈及关系修订，执行事实回原看板，策略与战略假设回相应原记录 |
| V12-10 | §11.5/11.7 | 讨论→候选→真实确认→原Goal/GSA→原Case/Plan→实际Task整链，七模块受影响路径兼容 |

## 3. 术语与单一记录权威

- **使用用途**：组织（营利/非营利）、部门/业务模块、个人（事业/家庭等）；只是背景，不是用户身份、组织归属或权限。
- **本工作用途**：此次明确适用对象与背景，独立于全局默认；不能复用现 `goalContext.purpose`（它表示query/asset-construction/assigned-work/case-investigation）。
- **战略讨论**：统一会话入口上的业务owner，保留SDK native、准确来源和小型会话元信息；不是新战略正式主库。
- **方向/方法/因果依据**：沿native、原GoalVersion的策略/必要条件/可选说明、GoalRelation.rationale、Case/报告与准确引用表达。讨论不等于目标采用，采用不等于因果已证，也不等于行动授权。
- Goal/GSA/BSC继续共用 `StrategyGoalsStore`；Case保存判断及人的选择；原Board保存具体行动/反馈；SAP管指标/IR，Studio/L2管语义。**不建后台真值树、因果账、战略发布权威或平行Runtime。**

## 4. 会话与自然语言战略协作

### 4.1 选择薄profile，保留Project边界

现普通新Task的App.send会进入ProjectPlan；直接跳Task不能满足“先直接讨论战略”，增加workKind绕过会污染原Plan门。本轮采用B：Host静态注册 `strategy-discussion`，真实owner为 `discussionId`，共用 `createAgentSessionDomain`、Interface v3、官方Pi1.4.0、现配置捕获/取消/关闭/安全native读取。profile只声明真实业务差异，不另写opening/busy/generation/运行队列。

原战略页内发起/续接讨论，不要求先选理论、建分析Task或填Project方案。用户选的原Project只是可选资料来源，不伪装讨论所属Task；没有Project也可从已明确背景讨论。**转为正式分析时仍经过原Project轻量方案和两种确认**；已有有效方案复用，不强增Task/综合会话。

小型metadata置于独立 `dataRoot/strategy-discussions/`，只记录身份、Host生成的workspace/native指针、配置/当前用途/方法约定快照、选定材料准确引用及GoalRefs。不要塞进首次要求空根的 `strategy-goals/`；不复制会话全文/正式战略/Goal正文，不另建运行状态台账。SDK唯一写native，恢复/分支/停止走公共入口。

### 4.2 资料、能力和方法

讨论复用原Goal/GSA、用户指定说明、有权读的原Project资料/SAP/IR及原来源resolver。Host绑定可读范围、真实模型出口、准确版本和资源；资料入口不接受客户端绝对sessionFile/任意路径。默认用途、profile、没有Task或没有企业ID均不增加读写权。

本profile的最小能力合同如下。复用的是公共生命周期与已有有界读取原语；不是继承普通Task的全部工具，也不是把现requirements-framework原样改名。

| 环境/来源 | 实际供给与原接缝 | 读写和准入边界 |
| --- | --- | --- |
| 无Project的直接讨论 | 用户本轮说明、Host以`goals.read(准确GoalRef)`取得的适用Goal/GSA；窄Goal读口可回读已绑定准确目标与关系/反馈依据 | 无Project/Task读资格。默认用途不开放全局Case/SAP/记忆。需要其他材料时提出具体索取，不伪称已读 |
| 用户选定原Project或准确资产/成果 | 清单用原`ProjectStore.tree`/已存元信息，说明用`ProjectDataContextStore.readDescription`；明确背景文档/报告沿准确ref/hash与原citation/`captureFeedbackFile`，资产沿原semantic-context find/read/trace及有界target/version/hash/extent | 按原grant、模型出口、来源Task资格/排除核准，不能照搬`queryRequirement`全局默认范围或假用需真实Task的`createProjectFilesPort`。Plan前不开放data-input/data-evidence明细、附件明细/DB试算；trace不扩大选材授权，`observeFile`完整读字节不能冒纯清单。已发布SAP/IR/背景报告可按原资格读取；不写Studio、IR、Case或Board；Goal不假称现SemanticTarget已有它 |
| 公共资料/搜索 | 配置已允许时薄适配原public-search受限能力和准确来源回执，绑定真实discussion owner/父lease及原取消资源生命周期 | 不冒用requirements instance/lease；不自动启用搜索或改线路，不把私有上下文整体送入公开检索，不接活库/凭据。缺配置准确说明；普通读取不逐工具确认 |
| 候选及用户采用 | 新增窄Goal业务callback，经Host→wire资格位→worker工具→IPC当前请求校验，复用原GoalStore与原话校验原语 | 仅允许准确Goal读取、候选create/revise、明确adopt与原operation回读；详见§5。不能顺带放开原Task的Case/Board/action/报告写口 |
| 封闭/受管来源或需要明细执行 | 保留原来源限制；需要业务取数、执行型Skill/脚本、DB或更广Project分析能力时，交回原Plan/Task实际资格，已有有效确认复用 | 不能通过伪taskId、普通workspace或复制资料解除限制；Plan前不先做战略尽调/大规模明细分析。正常战略讨论、获准依据比较和候选形成不必先编Plan，也不由Host规定专业顺序 |

资源加载沿现source-reader/fixedInput的封闭策略：无通用bash/Python/任意文件读写、外部执行扩展、自动发现Skill/MCP、prompt/context文件或默认资源旁路，实际工具集合使用白名单；仅`defaultTools=[]`不足以封闭。明确选择的参考方法/获准Skill正文按准确来源作为方法契约供给，不冒称执行过脚本；需要执行能力则使用原正式Task路径，不把方法名称列表当能力。战略续聊需要在OptraCall增加小型`strategy-discussion`能力策略与Host绑定的native恢复资格：现`source-reader`拒绝`sessionFile`且framework每operation新建native，不能声称它已零改支持恢复。仍只用原Pi公开会话与资源接口，不修改SDK、不写平行推理循环。

首次真正派发前复核实际出站材料与当前模型/配置/授权；每次窄读与写回均核当前lease。变化准确拒绝或重新准备且保留选择，不暗删资料或重复索权。停止、取消、旧owner/native、模型出口变化、来源Task排除以及任意路径/资源加载旁路须有合成反例；未获准来源不进入Provider。

优先参考Playing to Win，按需支持Rumelt战略内核、麦肯锡构建要素、BCG战略调色板、贝恩核心/相邻增长、BSC及用户其他方法。记录实际选择来源、变更及适用限制，不用方法枚举限制Agent组合，也不造已安装/已测Skill标记。用户明确改选本身是指令，不增加逐题审批；Agent提出的未获准核心方法实质替换集中确认。已有讨论、材料和已采用GoalRef保持。

本轮先落实项目/讨论共同契约与原能力供给，不新建一套战略Skill库，不修改data-analysis。若后续确需新增/改其他Skill，本体、测评、候选回执沿原流程独立办理，不能把普通提示词包装成测评通过。方法实质采用/专业正确需实际行为和独立专业证据；合成脚本不代替。

## 5. 候选、真实采用与准确来源

早期交流不具备原GoalDraftInput最少字段时留native继续补清，不让Host捏造负责人/基线/衡量/组织。信息已在讨论或原GSA中则直接提取，不要求重抄表单；缺重要承诺时一次集中澄清。

Agent可通过薄业务callback准备原Goal候选/修订，候选权威仍为原GoalVersion。原已采用目标不因新候选被覆盖；相同已有GSA直接引用，不能同名再建。为保存方向、方法和因果背景，可给原GoalVersion添加可选简明说明及准确来源引用；详细讨论仍读native，关系依据/三层反馈仍走原字段，不要求每条边填固定字段。

`GoalSourceRef`新增准确讨论来源类别：discussionId、sessionId、准确native entry/message身份及正文hash；Host从metadata解析路径，复用safe snapshot和公开parser。区分实际回复/工具候选载体，明确编码并核type/session/entry/hash；不填未来ID、不拿Task更新时间冒正文版本、不伪造taskId。source的authority字段只表示来源类别，不新增正式发布/战略真值权威。来源未可靠持久化或不可读时保持UNKNOWN/失读，不冒称已经引用全文。

采用统一接回原 `create/revise/adopt` 和原operation回读。UI一次集中核对预填内容；对话明确采用可走窄Goal采用工具。共享原Goal业务适配，核真实用户原话/明确点击、准确候选GoalRef及所见内容hash、currentVersion CAS、有效lease/原生请求归属。Agent语义判断意图，Host核技术身份；“继续讨论/有意思”不能被伪作采用授权。原任务quote provenance保持，讨论使用真实discussion owner，不假造project/task。

采用记录仍在原Goal版本内，补可选确认来源，不立第二采用账；真实用户输入、Agent建议、自动后续分别标识。稳定operationId绑定原用户表达及准确候选，重复先读原操作；5xx/断连/副作用未知保留输入、原ID和可查状态，不换名重发模型。多目标集中采用明确每项结果和partial/UNKNOWN，不冒跨Goal/Case/Board事务。

只有目标采用不创建经营行动或推定补货/调价/触达授权。缺确切Goal承诺时讨论继续；正式转入Case仍有原主目标，进入Project/Task沿原要求。必要组织主体沿原目录复用，确需新主体须用户在同次采用中明确；部门/个人不强造上级。

## 6. 用途保存、冻结与权限

全局默认用现 `global-settings` 同类原子JSON/revision/operation回读模式保存一份小设置，三类用途及可选背景。未设不阻断；不混入模型凭据或自动节点设置，不复制任务偏好库。

背景优先级：本次明确/已确认工作背景 → 适用原Goal/Case/Plan背景 → 尚未建立背景的新工作才用默认。新讨论第一次实际发送/新Plan确认冻结usageContext，连同原指纹、native providedContext和必要Goal说明承接；后续恢复/重启沿该快照，不再取今日默认。原Plan严格白名单/准备响应不可代改约束须同步扩可选字段。

旧Goal/Plan/Task/native缺字段保持原意或未知，GET不回填新默认、不改历史。已有Task续聊优先原准确背景；无确定依据不强赋三类用途。当前工作可明确不同用途，下一轮/新版本记真实变更，不重写已确认Plan；实际目标/范围/重要取舍改变才沿原受影响部分确认，不增加每Task必选操作。

部门上级未知允许讨论及原Goal候选/采用；已有enterpriseId仍严格核真实原企业。GoalScope与资料/SAP资格独立，不能删掉部门必选企业后落入“无scope就不核指标”分支。量化目标选择依原SAP实际可读/适用范围验证；无权准确拒绝/待授权，Host不能换指标或把quantitative改deliverable。用途不授予Studio/SAP/DB/跨企业来源，不改变Task继承/排除/模型出口。

## 7. 因果承接、下游与三层反馈

复用Goal的strategies/resources/necessaryConditions、关系kind/rationale及历史、Case假设/策略的mechanism/conditions/unknowns/whatWouldChangeJudgement/plan/references、报告与原来源。按重要性可补原Goal可选说明/来源，不新增逐边因果表单或TP台账。

Agent解释必要条件、贡献、因果假设、替代路径、内外前提、约束/资源/副作用及观察依据；未知可并列，非严格必要贡献不机械删除，不能以用户采用/相关显著/逻辑图完整证明因果。TOC/TP贯穿相关工作、项目整体实质采用，具体工具/深度/顺序开放；环境操作不强制做专业分析。Host不专业评分、不固定资源比例/树根/步骤或替人作业务取舍。

`goalContent`沿原精确GoalRef继续交付完整GoalVersion，补足准确讨论/关系/反馈依据摘要与可按需回读引用。新Plan/请求固定本次关系/反馈版本；原Task不默用最新Goal或当下全局默认。源读失败保留准确状态，已独立保存的目标要求不能因附加来源未知被伪换版本；Agent缩小受影响判断并继续可行部分。

执行事实仍原Board，策略反馈回准确Case策略/GSA，战略假设反馈回原Goal关系/三层反馈；新解释或环境变化追加来源和修订，不覆旧选择/报告/授权/实际发生。观察日期不启动后台任务，不自动换战略或执行业务动作。

## 8. UI增量和最少操作

1. 原战略与目标/GSA及所有主导航保留，默认GSA；已有GSA直接用。原BSC作为按需工具展开，目标编辑BSC字段也渐进显示；原目标/关系/指标/准确版本/历史和已有内部定位可达，用户已主动展开的当前状态保留。不宣称原不存在的Goal URL已实现。
2. 原页内直接讨论；现有目标可“围绕此目标讨论”。方法/详细依据/历史按需展开，默认不摆全方法菜单。换方法不清会话或改已确认Goal。
3. 原设置增加使用用途；讨论显示简短当前用途和按需调整。设置返回不丢讨论，默认变动不改当前快照。
4. 候选在一次核对中预填/调整/采用，保存后定位原Goal/GSA，原Case/新项目/Plan和两种确认继续可点；不要求用户搬运、重复输入。
5. 冲突/失读/UNKNOWN说明实际对象、保留输入和选择，沿原操作查回；不自动换最新/创建新Goal或Task来绕过。
6. Demo加载真实App、原CSS及合成API，未知API失败且无正式代理；内存/localStorage演示不冒实际SDK、磁盘业务保存或专业验证。

## 9. 数据兼容与工程边界

旧Goal schema1/2、关系/反馈、Plan/native不批量回填用途或来源。新增讨论来源/采用provenance/可选说明须随原Goal解析/快照/下游读口共同支持；首次写本轮新增格式时升原index至明确新schema（计划3），此后不降级；只读旧库不迁移。Plan和providedContext增加可选字段并更新原白名单/指纹/兼容reader，旧字段缺失不“补成功”。

新增格式写入后旧binary可能不可读，必须在后续获授权正式采用前备可读新结构的兼容回退并实测；v1.1的1546兼容包不能冒作本轮回退。不得旧库覆盖新记录，不为验证强写正式数据。

允许实施路径：原src/host（讨论薄适配/来源/Goal/用途/Plan/上下文/UI）、src/agent（必要公开工具和上下文投影/共同契约）、必要原Extension薄接缝及长期测试、此变更资料。不改SDK、依赖锁或Skill本体，不清他人WIP。发现必须改变公共边界/权限/产品取舍时带条款事实影响选项建议澄清；普通实现不追加审批。

工程检查按运行时/权限/持久化共享影响运行完整适用check，另做实际Host＋官方Pi＋合成Provider的调用/持久化/权限/停止反例与原App观察，非作者从本规格导出预期。真实模型、专业正确、设备采用、用户验收、经营效果分别报告。

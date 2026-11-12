# 结论与建议审查实施记录

2026-11-11，用户已授权在第4项验收及回填后推进第3项。第4项最终完整检查1945通过/0失败/67条件跳过、双轴及浏览器通过；本项开工前59份WIP字节及SHA保全于 `.local/conclusion-recommendation-review/before/` 与 `before-manifest.json`。五份已审核spec/Demo原字节保持，设计基线为本目录spec及 `docs/prototypes/conclusion-recommendation-review-ui-demo.html`。

## 目标与阶段任务

- [x] 读取已审核规格/Demo、工程规范v1.10和统一会话说明，核对原独立核算/固定材料/公共生命周期接缝。
- [x] CNR-A1：可证候选和精确选版；开始前变化保留选择，开始后同路径更新仍审固定旧稿，撤权/归属变化停止交付。
- [x] CNR-A2：只读无计算/改稿权限；按重要主张保存原文位置、证据/缺口、条件、判定理由与影响。
- [x] CNR-A3：按原任务资格追加草稿、保留原文和去重；用户发送前无模型请求，旧意见仍归旧稿。
- [x] CNR-A4：退役旧写入口/自动开关，原事实只读；运行中/未知安全交接，同owner和请求固定业务合同，不补跑另一路。
- [x] CNR-A5：完成/取消/失败/迟到/关闭/归档实际状态；固定材料与原会话保全，界面/工程/专业分别记录。
- [x] 实际Host/Pi与桌面/窄屏交互验收、受影响联合回归、本地完整检查、非作者双轴及四原则最终检查。
- [x] 回填总进度，记录本地检查、Git/CI、专业效果和用户产品验收的各自边界。

## 接入与边界

沿Interface v3兼容业务子集、官方锁定Pi1.4.0及原 independent-verification 静态Host注册、真实 `{projectId,taskId,verificationId}` owner、固定材料/历史/取消机制。Host只管理来源版本、授权、预算与保存；独立Agent判断证据，原主Agent自行处理用户带回的意见。新角色直接看固定被审报告，无冷读/返修/自动复查，不复算、不改原稿。普通提问、经营采用及任务会话原位保留。

本项允许原核算侧栏/状态、新审查角色合同和固定材料薄适配、旧入口安全切换及其检查，不新增主导航、SDK依赖或额外Agent Runtime。只在隔离合成资料和本机受控Provider进行工程验证，不操作真实业务根/凭据，不切换运行服务或MacBook；专业效果和产品验收分别核定。

## 实现与验收证据

CNR04材料展示复用原`readRuntimeEvidence`及原native请求身份/正文SHA核验，按读取时投影区分准备完成、实际提供和无法证明的阅读/理解；不另建交付或生命周期账本。完整固定包摘要、报告/材料身份和正文范围须与本次原生请求一致，才显示实际片段。missing/foreign-header/foreign-pointer/symlink等观测不可信时仅将新模式的交付证据留为未知，不读异owner正文、不续接，不影响旧模式严格校验。

原VerificationStore增加可区分的conclusion-review类型，同一个independent-verification公共域按profile使用现有text-only能力。直接提供完整固定报告与有界依据（65,536 UTF-16，按原能力的技术上限）；无代码、文件、网络、历史或扩展工具，无cold/compare/返修/自动复查。报告超限或不可可靠解码时拒绝并保留原稿；辅材缺失/片段/未提供如实保留。Host仅校结构、来源身份、原文存在性与实际引文范围，不评定业务真值或定位说明的专业正确性。意见有效保存只表示一次返回，不证明专业正确。

| 验收 | 最终适用本地验收结果与证据（均通过） |
| --- | --- |
| CNR-A1 | 材料18项及实际HTTP：可安全捕获的唯一授权候选预选，多候选手动选一次，不从名称/mtime猜当前交付。preview精确ETag/报告SHA，开始前冲突无记录或模型；开始后同路径新字节仍回看旧稿，撤权取消且所有新旧读取入口隐藏不合资格正文。`materials/evidence.json`、`http-flow-final.log`。 |
| CNR-A2 | 实际SDK24项（含交付证据补修10项）：空工具、只有固定包、4种逐主张意见及版本原样保存；“本款C最大”和“A/B相对大盘更集中”分开，需复算的疑点交原分析。原文/证据引文须位于实际提供范围；保存原生格式失败而不额外调用修正。`backend/author-receipt.json`。 |
| CNR-A3 | 实际HTTP与浏览器：保留含空格原草稿，同ProjectStore原子写保存追加内容+reviewDraftIds，跨并发点击/刷新/清空/重启去重。超20k不写草稿或去重收据，短稿后可明确再带回；另一task不能带回。无主模型请求/原native变化。`http-flow-final.log`、`ui/RESULTS.md`。 |
| CNR-A4 | 10项真实Host/Pi无skip：旧开关true/false、手动自然结束/stop、崩溃interrupted、真实输入合同变化UNKNOWN、automatic链前窗口changed/unchanged、冷读stop后cleanup.confirmed、新ordinary busy隔离。`handoff/result.md`、`handoff/final-target.tap`。 |
| CNR-A5 | 实际正常/失败/迟到/取消/配置关闭/归档及只读恢复：固定稿与原task native保留；不重放原UUID。旧manual实际两轮生成记录后用默认新Host/browser回看，模型请求2→2。`backend/author-receipt.json`、`http-flow-final.log`、`ui/RESULTS.md`。 |

作者浏览器验收11组CNR、补修实际材料3组、3项旧记录迁移回看、原RCR5组、原RAF14组通过，0页面错误/0外网，390px无横向溢出。界面沿已批准Demo和原tokens，无新导航、问题输入或额外确认；原composer自动配置入口撤下，旧记录按原类型只读。初始完整候选检查2,058项中1,991通过、0失败、67条件跳过（`full-check-review-candidate.log`）；其后非作者发现的接缝修复已形成新冻结候选，最终检查与复验见下。

## 旧新合同与保全

产品默认新合同，不新增CLI/HTTP/用户配置开关。Host-only部署准入参数及activateConclusionReviews用于可证安全切换；切换只关闭新旧审查的新准入，已准入旧请求继续原合同，未强停、重启、发模型或批写旧设置。每次普通请求在原mutate门把合同冻结在Host operation owner；读取同公共域实际占用覆盖旧observation尚无chain与最终资源收尾窗口，UNKNOWN保留等待，不用no-op stop或driver退出冒充旧后代闭合证明。

既有旧HTTP回归显式用startLegacyTestHost或createHost({reviewAdmission:'legacy'})表达切换前的合同，保留原断言；默认startTestHost和生产入口仍为新合同。另有真实默认新Host拒旧写、原true/false设置原字节、真实在途切换/unknown联合验收，未通过跳过旧检查或在生产放回旧客户端后门制造通过。

模型意见带回只形成原任务草稿，由用户原发送入口交给主Agent自主处置。原意见不升级为企业事实、全局通过或经营授权。普通文本输入沿既有权限与使用边界；没有将旧核算/自动配置映射成新审查自动启动。

## 保留的失败与修复

- 旧写入口原先200的真实RED：`transition-product-red.log`；非法空问题fixture的400仅为夹具失败，`transition-red.log`保留，不算产品RED。
- backend旧命名空间曾可读新review raw body、伪引文未绑定实际范围、同task新ID并行准入，均有真实RED及修正，见backend作者回执。自动finally明确不重试失败清理。
- 需求框架上游草稿变化被误当撤权，增加原确认/发布版本专属授权回调，不重新compose当前正文，`materials/requirement-authority-{red,green}.log`保留。
- UI新入口缺失RED、Host list用错共享store facade的500及修正后日志保留；Host service补显式类型，避免循环推断any掩盖接线错误。来源撤权的历史/stop响应只回安全元状态，私有原件不改字节。
- 真实旧automatic已准入但chain未建时错误ready，两条changed/unchanged RED后改读原公共域冻结legacy owner真实busy；native commands新合同也不再经过旧automatic准入。`handoff/initial-red.tap`及最终10项保留。
- 首轮完整检查2,047项：1,977通过/3失败/67条件跳过，`full-check-first.log`。失败分别为生成手册未同步、旧crash fixture仍用新生产准入入口、旧managed失结果测试在native写窗口读409。已同步同源手册；显式旧crash入口；只对同owner已知409做有界只读恢复，原失败/未知、原件及模型计数断言保留。受影响11项复跑通过，`first-check-fixes.log`。最终候选已另核，未覆盖原FAIL。

- 初始非作者Spec复核FAIL两项P2：材料仅显示身份/范围、未显示实际片段；回交仅列materialId和Agent位置，丢失真实来源路径及版本。独立探针与结果保留于`spec-review/source-traceability-{probe.ts,result.json}`。Standards初始FAIL另指出准备好的包冒称实际交付，`standards-review/initial-disposition.md`与`preliminary.md`保留。原后端及UI作者修复：typed contextEvidence只做读取时投影，实际正文按片段显示真实来源/SHA/范围，逐条依据也映射固定来源；准备未核定或缺证明时不填实际正文。后端24项及受影响联合66项通过（`backend/green-final-delivery-v5.log`、`backend/green-delivery-regression-v3.log`），最终候选及复核另记。回交实际HTTP的`feedback-source-red.log`确认真实缺失，修正后`feedback-source-green.log`三项通过，保留文件路径、固定来源SHA和Agent定位。

## 最终候选与独立复验

本轮适用本地验收 CNR-A1 至 CNR-A5 通过。修复后100件候选清单为 `candidate-repaired-manifest.json`，自身SHA-256 `6d7a3b46a858805d4945d9a19feeef7103430daf1ebbc537dbbf3930daac9ed0`；相对第3项开工前（第4项完成后）快照的47件CNR增量见 `stage3-repaired-{changed-files.json,diff.patch}`。本节未将其余原WIP当成本项创作。

证据总根为本worktree的 `.local/conclusion-recommendation-review/`，Standards最终独立证据另在 `.local/standards-review/`：

- [最终本地完整检查](../../../.local/conclusion-recommendation-review/full-check-repaired.log)：`npm run check`退出0，2,068项中2,001通过、0失败、67条件跳过；边界、typecheck与build通过。条件跳过的原因保留于原日志，不当作通过；本项新增56项目标测试均通过。`final-check-summary.json`记录候选身份和运行/专业边界。
- [Spec非作者最终复验](../../../.local/conclusion-recommendation-review/spec-review/final-review.md)：PASS。独立真实Host/官方Pi/本机合成Provider共36项断言、80次HTTP，核对实际片段SSR、来源定位回交、准备无证明、撤权、配置关闭、旧在途切换。原两项P2关闭，原FAIL保留。此处SSR未表述为完整浏览器验收。
- [Standards非作者最终复验](../../../.local/standards-review/final-review.md)：PASS。20组独立合成实际Host/Pi检查、2次模型请求，覆盖原生观测九类失验、准确片段、权限撤回、新模式不续接及旧模式严格拒绝。原P2关闭；仅本增量及受影响接缝，无剩余必改项。
- [材料补修浏览器证据](../../../.local/conclusion-recommendation-review/ui/materials/RESULTS.md)：真实准备态0请求RED保留；3组GREEN核对实际partial正文、路径/full SHA/range和撤权清缓存，原CNR11组复跑通过。作者实际Chrome桌面及390px、0页面错误/外网；root另核实际390截图。其他原回归见 `ui/RESULTS.md`。
- 10份已审核spec/Demo原SHA全量核回一致，`approved-baseline-readback.json`。非作者前后逐件核回100份候选无漂移；完成标记后仅本实施记录与总进度回填，源码/测试按 `source-readback-final.json`另行核回。

## 四原则专项最终检查

| 范围 | 通过依据与实际边界 |
| --- | --- |
| Host管环境 | 真实owner、固定材料/SHA、来源授权、公共取消/关闭及保存；原native只读投影实际提供，缺证据留未知；Host不判业务真值。见两轴正常/撤权/失验探针。 |
| Agent自主执行 | 独立Agent选择证据推理并返回四类逐主张意见；原主Agent自行核实、补证、修改或说明分歧。Host不复算、改稿、打全局分或强制采用。空工具为已审核只读角色的能力边界。 |
| 复用官方能力 | 原VerificationStore、independent-verification静态profile、统一域/lease及text-only、原native身份核验；无第二Runtime/生命周期账、无SDK改写。实际Pi1.4.0与依赖/锁文件原样；本结论不外推未检查的历史接入合规。 |
| 减少用户操作 | 获准唯一可证候选预选，其他选择一次，开始后无需问题输入；依据渐进展开。带回沿同任务原草稿和发送入口，无额外必做确认。实际桌面/窄屏、草稿去重及跨任务锁检查通过。 |

上述结论只覆盖本批第4/3项适用本地实现、检查及独立复核；完整工程交付仍按集中Git/CI与OpenSpec收尾范围核定，第5项尚未启动。

本项仍为本地未提交开发；Git/CI交付、真实Provider专业效果与用户产品验收未完成。所有合成/真实协议测试及专业限制分别记，不从工程全绿推断模型意见专业正确，不切换运行服务或MacBook。

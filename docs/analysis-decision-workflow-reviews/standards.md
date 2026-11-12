# 分析与决策闭环五项 Standards 与四原则独立复核

2026-11-11。**结论：通过本次实际受检工程范围；无剩余 P1/P2 阻断项。** 初始 P2、不通过报告和失败现场均保留。本结论不替代实际 head CI、运行采用、真实模型专业效果、经营行动或用户产品验收。

## 候选、依据与范围

| 项目 | 固定身份 |
| --- | --- |
| 比较基线 | `d5ded3b2fa1077dbaad9bfbda9684c42ef7ba198` |
| 最终受检提交 | `938f9b86f72513e9406071312e65b5990ddb49f6` |
| 最终 tree | `49cad8ca3ab019873bfc3aa9db79c4f298c6553f` |
| 初始受检提交 | `af004c043e9cfc722c03bf3e8cf93d7d47f8f816` |
| 原113件WIP清单 SHA-256 | `fd96f198d824503c168f2540d73908dadb1ef1346a1e7a89cb5aa836c722422a` |
| 六件修复最终清单 SHA-256 | `0190057e264eac4bb0a11157052e85b99a54f06cdf4049f9135e96232c0bff58` |

复核者未参与候选、产品测试、规格或 Demo 的创作。按[工程规范 v1.10](../engineering-workflow.md)第2–5、7–8节、IN01–IN07、[统一会话接入](../agent-session-integration.md)及[五项批准基线](../analysis-decision-workflow-baseline.md)检查完整累计差异和新增源码，采用知识图谱优先的代码发现及调用链核对，没有仅审查最后一项交接增量。

最终范围为120文件：63件产品/脚本、44件测试、13件文档。原113件WIP先保全，初始提交增加六份交付/结果文档，修复再新增一件SSR测试。最终六件修复全部匹配清单，其余初始候选blob无漂移；核对时工作区干净。五份已批准spec和五份Demo与基线逐字节一致。六份新增交付文档的相对引用有效，公开候选未纳入原始native、运行日志或凭据。

第1/2项原实施记录中的非作者结论与日志按原事实保留；本轮有限清点未找到其当时单独签署的Markdown报告，没有补造历史报告。本报告是当前累计候选的正式独立复核。

## 原 P2 与关闭证据

**ST-RCR-01 / P2：准备回执被显示为实际提供。** 初始候选在[前台复核接缝](../../src/agent/project-session.ts)先记录 `fixed-packet-prepared` receipt，再创建子目录和SDK子资源；真正创建前失败时，仍保留 `unknown` 和材料 `state=provided`。[计算复核界面](../../src/host/ui/ReportCalculationReview.tsx)却无条件显示“实际提供的材料与范围／已提供”，不符合工程规范第8节及[RCR04、RCR09](../../openspec/changes/report-calculation-review/spec.md)的证据要求。

独立合成真实HTTP Host/Pi反例在任务私有目录设置同名普通文件，使子目录创建失败。父Agent正常保存草稿并调用复核；实际子模型请求为0，复核状态为UNKNOWN，材料回执仍只证明准备。该反例不依赖补造业务账或原生记录。

修复将展示改为“已准备／部分准备／未准备／仅准备元数据”，明确“此准备回执本身未核实实际提供范围。材料是否被阅读或理解未获证明。”，并保留固定初稿回读。原运行outcome、v1回执和历史记录不重写，没有新增DTO、台账或生命周期。独立重做同一真实Host/Pi反例并实际React SSR：仍是0子请求及UNKNOWN，界面已正确显示准备与未知，不再宣称实际提供或已复核。正常路径另核实际子请求正文与固定packet一致，父native的owner/request/session/toolCall和技术范围匹配；不把准备回执或outcome单独当作交付或阅读证明。**P2已独立复验关闭；初始不通过结论保留。**

## 实际独立验证

下表只列本复核者执行的检查，不将作者完整检查、阶段历史证据或CI冒作独立执行。

| 范围 | 结果 |
| --- | --- |
| 公开搜索隔离/取消、受限子角色、一次委派/选材纠正、配置清除、框架回执、来源撤权、入板零模型副作用、迁移与事务回滚 | 14 PASS |
| 公共生命周期、第三合成profile、owner隔离、取消/关闭失败、历史交付与旧入口切换 | 30 PASS |
| 需求/RAP与Case/任务历史传播、计算复核撤权、入板并发及回执恢复 | 4 PASS |
| 修复运行增量：真实父子输入与native身份、主Agent三种处置、FCR联合意见及不足范围 | 9 PASS执行节点；其中1项为首轮FCR检查的重复执行 |
| 最终固定字面入口SSR：各终态、legacy/partial/missing/metadata/撤权/no-packet | 4 PASS |
| 独立因果反例 | 真实HTTP Host/Pi零子请求＋React SSR通过，单独记录，不计入上述测试数 |
| 接入边界与完整累计差异 | `node scripts/check-agent-session-boundary.mjs`、`git diff --check d5ded3b...938f9b8` 均PASS |

**计数更正：最终有效的通过执行节点为61，去重后为60个不同测试节点，0 FAIL、0 SKIP。** 源报告曾写“61 distinct”，公开摘要前按已存日志逐名去重，发现FCR01/03/04重复一次，现明确更正。中间SSR加载方式替换前的3次通过不替代最终4项复验，也不重复累计。本摘要只回读已有日志，没有重跑测试。

作者新增SSR测试最初使用 `data:` 动态import，被既有边界检查拒绝，原FAIL保留。最终改用Vite公开 `ssrLoadModule('/src/host/ui/ReportCalculationReview.tsx')` 固定字面入口，缓存指向隔离TMPDIR；没有放宽白名单、删断言或修改SDK。本复核独立重跑最终4项SSR和边界检查均通过。审查工具自身的CJS/TypeScript辅助setup失败、作者探索性DTO测试失败和审查者合成目录误写/精确迁移回执也分别保全，不冒作产品RED或隐去。

## 官方 SDK 与专项边界

[依赖声明](../../package.json)和[锁文件](../../package-lock.json)无升级差异。本机ESM实际解析官方Pi coding-agent 1.4.0，既有官方tgz的SHA-512与锁文件integrity一致；安装目录1,279个常规文件与归档逐一匹配，无差异。没有安装、改包、运行时改写或SDK升级。本次逐文件结论限coding-agent归档与该本机目录，不扩大为其他Pi包逐文件审计或服务采用证明。

| 四原则及相关标准 | 实际检查结论 |
| --- | --- |
| Host 管环境 | 原会话域/owner/lease控制配置、准入、材料版本、权限、取消、收尾和持久化；`verifyBeforeDispatch`在既有门闩重核。公开搜索仅接获准主题，固定/只读角色不获得通用执行、文件、网络或委派能力。 |
| Agent 自主执行 | 主Agent明示主稿和关联材料，子Agent自主提出意见，主Agent自主复查、修订、拒绝或保留未知。未发现Host补经营计算、按意见作专业裁判或自动批准经营行动。 |
| 优先复用 SDK | 使用锁定官方Pi及统一生命周期、原生前台子会话、配置快照和父工具回执。子资源仍由原worker的一处retirement权威管理；失败保持隔离、仅显式重试清理，不另建运行循环或重放模型。 |
| 减少人类操作 | 正常报告复核新增必做用户操作为零；框架确认及结论选择/入板属于已批准业务取舍，来源管理按需展开，确认入板不再调用模型抽取。 |
| 来源权限、历史和副作用 | 新旧合同准入互斥，旧设置与native不批量回填。当前来源授权沿Board、反馈、Case、个人来源、Studio/RAP相关消费者传递；同路径新稿与固定历史分开，撤权不重新交付正文。 |
| SQL与兼容性 | schema3沿[原看板SQLite Store](../../extensions/business-plugins/decision-board/storage/store.ts)，报告登记、结论、所选建议关系和回执同事务提交；迁移保留原行、采纳、任务及反馈，失败整组回滚。 |

Fowler十二项味道按判断项处理，仓库规则优先；未发现新增的独立阻断味道。必要Host组合根和跨原权威来源的薄接缝不被误判为重复Runtime，也未要求重建统一权限框架。

## CI 与验收限制

受领本摘要任务时，PR62的Check163、run `43000785366`仍运行中；本摘要没有核定其通过。旧Check162仅对应初始af004c0，不能覆盖938f9b8。实际PR head、run日志及后续合并/main检查由[本批交付记录](../analysis-decision-workflow-delivery.md)另行核定。

所有本次模型请求均为隔离loopback合成Provider；React验证限SSR，未独立重跑交互浏览器或完整套件。真实模型专业正确、经营效果、运行采用、用户产品验收及未检查的既有治理风险仍分别取证。本轮未调用真实Provider或业务资料，不切换服务，不操作MacBook。

## 本地源报告与证据保全

下列为本工作树本地保全位置，仅列代码文本和摘要，不公开raw日志、原始native或凭据，也不把本地路径制作成仓库链接。

| 本地文件 | SHA-256 |
| --- | --- |
| `.local/analysis-decision-delivery/standards-review/review.md` | `14f442e9e28ea4960d8c69dfbbccf81829edd51fe83871c57ae40ae4220154dd` |
| `.local/analysis-decision-delivery/standards-review/review-initial.md` | `2be5364bb64efc4cc42471b62283ae1ce12ca5158b9c3b771c3b135fbfbaf5e8` |
| `.local/analysis-decision-delivery/standards-review/test-count-readback.json` | `79aa1cf3648f088b16e30eae72c3173d3d64937041581839401e6b998a9ee8b1` |

其余固定身份、原P2/修后因果反例、SDK核对、测试日志及审查工具失败均保留于 `.local/analysis-decision-delivery/standards-review/`；修复作者的原始记录在 `.local/analysis-decision-delivery/rcr-repair/`。本公开摘要不覆盖这些原件。

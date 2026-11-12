# 分析与决策闭环五项：独立 Spec 交付复核摘要

2026-11-11。**最终 Spec 结论：PASS，限本批工程规格符合性；已发现的 RCR 准备回执 P2 经修复及受影响独立复验关闭，无剩余必须修复项。** 本摘要由非作者复核者形成，不替代实际head CI、合并、运行采用、专业效果或用户产品验收。

## 固定范围与依据

基线为 `d5ded3b2fa1077dbaad9bfbda9684c42ef7ba198`，最终产品提交为 `938f9b86f72513e9406071312e65b5990ddb49f6`，tree 为 `49cad8ca3ab019873bfc3aa9db79c4f298c6553f`。覆盖二者之间完整120件累计变更，包括五项功能、相应测试及实施/交付记录，不仅是第5项末次补修。

依据为[工程规范v1.10](../engineering-workflow.md)、[统一会话接入](../agent-session-integration.md)、[五项批准基线及Demo](../analysis-decision-workflow-baseline.md)，以及以下规格：

| 项目 | 核对范围 |
| --- | --- |
| [需求梳理与分析框架确认](../../openspec/changes/requirements-analysis-framework/spec.md) | RAF-A1至A5：价值与可行范围、原权威取材、原生公开搜索隔离、确认与准确送入、失效和历史保全。 |
| [报告计算复核](../../openspec/changes/report-calculation-review/spec.md) | RCR01至RCR09及第6节：准入互斥、固定材料、一次前台委派、原作者自主处置、失败/取消/未知。 |
| [分析框架覆盖复核](../../openspec/changes/report-framework-coverage-review/spec.md) | FCR-A1至A4：复用同一次委派，只核实际送入版本及可证范围，原作者自主补齐、说明限缩或保留原稿。 |
| [结论与建议审查](../../openspec/changes/conclusion-recommendation-review/spec.md) | CNR-A1至A5：可信选版、固定报告只读逐主张审查、实际材料片段、原草稿回交及旧链安全切换。 |
| [结论确认与看板交接](../../openspec/changes/confirmed-conclusions-board-handoff/spec.md) | CBH-A1至A5：可信条目/条件/来源、同库原子提交、版本与权限、去重及未知回执、零确认模型请求、无自动行动。 |

原累计审查绑定 `af004c043e9cfc722c03bf3e8cf93d7d47f8f816` 的119件清单，119/119提交blob核回匹配，五份批准spec与五份Demo均与基线原字节一致。随后修复提交仅改变六件，其中新增一份正式SSR测试，其余原累计blob不变；六件最终清单SHA-256为 `0190057e264eac4bb0a11157052e85b99a54f06cdf4049f9135e96232c0bff58`，最终提交6/6核回匹配。未以文档状态替代实际代码和运行证据。

## 审查方法与关键结论

先使用项目MCP图工具发现实际函数和调用边界，再补读累计diff、批准规格/Demo及已知文件。风险重点覆盖需求来源与授权、公开搜索隔离、公共会话准入与取消、父请求原生交付证明、固定材料、旧新合同切换、逐主张只读权限、确认事务及下游来源正文保护。未修改候选产品、测试、规格、SDK、Git或运行服务。

需求侧复用原RAP/SAP、四库/双库及其读权限，所见提案、确认和实际送入版本分别绑定。选目标项目本身不扩大材料权限；公开检索仅在隔离公开上下文使用获支持的Provider原生能力，不加载私有历史、通用执行工具、用户扩展、skills或MCP，不从模型自述链接补造来源。

计算与框架覆盖由原主Agent在同父请求内明确选稿并委派一次，子Agent无通用执行/文件权限，原作者自主核实、另存修订及用同一依据自查。历史框架须有真实原生分支交付证明；新版、未送入草案和仅存在的RAP不替换当时输入。结论审查独立发起，固定报告及实际材料范围可核，意见只回原任务草稿，由用户原发送入口交给主Agent。旧链按原公共占用与UNKNOWN安全交接，不强停、重放或把旧开关映射为新审查自动启动。

确认入板从可信审查记录重读文本、条件和来源，支持纯结论及明确选择的获支持关联建议。报告登记、结论、建议和回执在同一Store事务提交；重复/并发去重、异选择冲突、故障回滚和未知回执只读查询保持。确认不调用模型，不采纳建议、不建任务；后续经营动作沿原显式入口。撤权后正文与已打开缓存按现权限隐藏，旧版本不被标为新版。

## 新发现P2、修复及关闭依据

原整批Spec报告记录了当轮检查PASS。随后Standards独立发现一个未覆盖反例，本Spec复核再用独立实际Host/Pi及产品组件渲染复现：预放 `.report-calculation` 同名普通文件，使固定材料包已准备、子会话创建前失败。实际child请求为0，运行结果为UNKNOWN，receipt明确为 `fixed-packet-prepared`，但原界面显示「实际提供的材料与范围」「已提供」。该反例违反RCR04/RCR09，发现后重新打开交付门禁，原PASS不能单独作为最终合并结论。

修复在[原材料记录界面](../../src/host/ui/ReportCalculationReview.tsx)使用准备态标签，说明此准备回执本身未核实实际提供范围、未证明模型阅读或理解，并改称固定初稿。v1字段、原记录字节、范围、运行outcome和权限保护保留；另两处仅类型注释。没有新增runtime DTO、ledger、SDK改写、模型循环或用户必做操作。

正常RCR04记录也已独立核定：实际成功child请求正文与Host保存的 `provided.json` 逐字节相同，父原生成功toolResult的owner/request/session/toolCall、同一receipt及材料范围一致。实际控制流在子会话返回且Host重核资格和同一receipt后才追加成功原生结果。因此，实际请求、固定包和可信父原生成功记录的既有组合足以核对该次实际提供范围；这里没有由单一outcome或准备receipt推断交付，也不声称模型已理解或采用。部分材料另验证了实际字符范围、未提供范围未知及第二次委派被拒绝。原启动前失败探针修后GREEN，P2据此关闭。

## 实际验证与保留证据

以下各轮绑定相应固定候选或已证明相同的blob；不同轮次不相加为独立样本数。合成Provider按预置协议响应，仅证明工程路径、权限、版本与记录行为。

| 验证阶段 | 实际结果 |
| --- | --- |
| 原完整累计候选的关键既有检查 | 104 tests / 104 PASS / 0 FAIL / 0 SKIP，覆盖RAF、原生公开搜索隔离、RCR/FCR、CNR切换、CBH HTTP/Store及材料/历史边界。 |
| 原独立跨项实际Host/官方Pi/本机合成Provider探针 | 58项计数断言PASS，实际一次计算/覆盖子委派；确认、回执重放及草稿回交新增模型请求0。 |
| 原实际Chrome累计检查 | 11组PASS，0页面错误/0外网请求；审查及看板390像素无横向溢出，已独立目检截图。 |
| RCR正常实际交付与部分材料补充 | 正常跨项65项计数断言PASS；另有partial实际正文/范围、固定包、原生回执及单子委派探针PASS。 |
| 原启动前失败修后及旧记录 | 同一实际Host/Pi+产品组件探针RED→GREEN；旧completed/unknown/failed/cancelled、partial/缺失/元数据及撤权6组独立SSR PASS。 |
| 最终正式测试及边界 | 最终新增SSR独立4/4 PASS；会话边界检查独立PASS，含旧无packet仅保留实际运行outcome。 |
| 修后实际Chrome定向检查 | 5组PASS，0页面错误/0外网请求；准备标签、partial范围、固定稿查看、只读刷新/撤权、未委派和失败均核。 |

作者另有54项受影响联合检查、最终SSR4项、typecheck及diff检查通过，和本轮独立结果分开记录。新增SSR测试中间版曾因 `data:` 动态import触发会话边界工程FAIL；最终改用Vite公开固定字面 `ssrLoadModule`，未改白名单、跳过检查或改SDK，最终测试与边界重新通过。该FAIL、原产品RED以及各阶段原FAIL/UNKNOWN均保留。

以下完整源报告只保存在本工作树本地，不随本摘要公开；路径为证据定位文本，不是仓库链接：

| 本地源报告 | SHA-256 |
| --- | --- |
| `.local/analysis-decision-delivery/spec-review/review.md`：原119件累计报告 | `e847936bc71c7902cde12f72eb6a0f528404f0f57c2e00d31576f12b88f12f1e` |
| `.local/analysis-decision-delivery/spec-review/prestart-delivery-initial-finding.md`：初始P2及门禁未闭合记录 | `cebecce37598db827250b0168788fba312d80890a1705c100e5c11dbf25c0ae0` |
| `.local/analysis-decision-delivery/spec-review/prestart-delivery-final-review.md`：938修后最终补充 | `c558504ddce2d4a91ce521d65b1ddc0035bb693233d3d265660f2a40a27528d1` |

原始合成探针、日志、清单、native和截图同样只留本地 `.local/analysis-decision-delivery/`，本摘要不包含原始会话或凭据。第1/2项阶段材料保留当时结论和日志，但有限清点未找到单独签署Markdown报告；本次整批独立复核不补造其历史签署。

## 交付与验收边界

Host只负责环境、身份、授权、版本、公共生命周期和确定性保存；Agent继续自主选择核对方法、判断及修订。官方Pi仍为锁定1.4.0，未改依赖或SDK安装包，不从本次薄适配复核外推全部历史SDK接入合规。普通计算/覆盖没有新增必做操作，框架确认、独立审查和结论入板仍是已批准的人的业务取舍。

本摘要形成时，PR62的修复head Check163（run `43000785366`）尚在运行，不能记为CI通过。旧Check162的PASS只属于af004历史（2091 total / 1941 PASS / 0 FAIL / 150 SKIP），不覆盖938。实际新head CI、合并、main快进及原位归档由[本批交付记录](../analysis-decision-workflow-delivery.md)按实际回执核定。运行采用、MacBook、真实Provider专业表现、经营效果及用户产品验收均未由本复核核定。

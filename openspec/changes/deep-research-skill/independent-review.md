# deep-research skill · 非作者独立复核

2026-11-04 · **原基线本地及最新main集成增量均限范围通过；原候选不通过记录保留。** 实际head CI、合并与归档尚待执行，不作完整交付声明。修正版未取得新的用户模型测评。各阶段原身份与限制分别保留，最新集成见末节。

## 复核者、候选与方法

两名复核者分别为 `dr_independent_spec`（规格轴）和 `dr_independent_standards`（规范轴），均由主会话以全新、无作者历史的上下文启动，未参与本候选任一部分的创作。二者先从工程规范、DR1–DR9及DR01–DR07导出预期，才核实现、作者测试与结果；新增展示再从已确认规范及DR08／DR09冻结增量预期。作者／原型助手未担任独立复核者。

源文件、规格、测试、原清单与既有证据只读。验证与报告只写复核者各自0700隔离目录；发现由Codex根会话直接修正，再交原复核者重验。本文件由根会话编录独立报告的结论、发现、验证及身份，不将根会话自评替作独立判断。

- 原候选：交接HEAD `032924965b15557ec36c9767c6f57e17b498a08f`，移交清单14/14与提交及工作树完整SHA一致，原清单不回写；原文件另存保全。
- 修正本地v1：同HEAD加本轮WIP，完整清单598文件，`local-candidate-v1.json` SHA-256 `2de89047ffd8c04c3566f30176ddef240defdd5251c8f5ed42d3b58724631b65`。两名复核者逐项核对、复制隔离验证并回读，零漂移。覆盖staged／unstaged／新增文件，不只原14文件。
- 后补规格、结果与本报告为非运行时文档收尾；其增量身份与复核追加另记，不把完整检查的598文件身份改成未检查过的新身份。SKILL.md及角色／references为运行时提示词，本轮完整检查与独立重验包含其修正字节。

## 原发现、根修复与原复核者重验

| 原发现 | 严重性／来源 | 实际修复及重验 |
| --- | --- | --- |
| 来源不足3个即硬退回，与DR4质量目标冲突 | P2；两轴均发现 | reviewer与checklist移除数量硬REVISE，保留目标、缺口影响披露及真正的关键事实无来源／明显错误／严重偏题退回；两轴关闭。 |
| 无可引用来源块即推断路线未接通或未检索 | P2；Spec轴 | SKILL、researcher、source-standards区分Host能力声明与本次可引用来源；缺来源不能推断未调用／失败／未接通，未知如实保留。原独立合成MiMo反例表明可出现usage有而sources空，修正与实际契约一致。Spec轴关闭，Standards另核。 |
| 默认完整模式例行等待用户确认大纲 | P2；Standards轴 | SKILL与method改为目标范围清楚时自主继续，仅用户要求或必须由其决定的范围取舍时确认；Standards关闭，Spec另核。 |
| 移交书仍写13／n13，实际14 | P3；Standards轴 | 统一为14，原清单及原失败记录保留；原复核者关闭。原预审曾列P2，后显式降级为文案P3。 |
| 接缝指南两条源码链接相对层级错误 | 文档观察 | 指向实际subagent／native-search文件，复核确认可达。 |

三类提示词语义修复未改subagent／native-search实现、作者测试、依赖或锁文件。原DR5三轮审稿上限及第三轮转遗留事项规则保持已确认规格范围；这里的文档一致性关闭不证明真实模型必然遵守。

## 规格与规范轴检查结果

Spec轴独立执行11项目标测试通过，包含展示4项、skill／角色发现、快照字节、合成委派及chain／资源实读；另用真实React组件静态渲染与数值反例检查单层默认折叠、历史版本、空态及数据边界。Standards轴独立执行52项目标合成回归、会话边界和类型检查通过，并以45项独立数值／SSR探针核对单位、分母、缺失、零基线、范围和披露。两者未用作者测试或静态渲染冒充浏览器、真实模型或专业验收。

共同核定五个内置skill使用同一测评组件；其他资产／连接器／插件不套用。原生details无默认open、无嵌套披露，全部测评数值在展开体；打开入口独立，不设新使用门槛。累计16.2%→29.4%为13.2个百分点，激活8/10，胜率3/4（6未判定不进分母），耗时约+65%与Token约+55%；真实零、缺失及无效输入分别处理。原27.9pp产物口径与14.7%→44.1%的算术差异保留，不混入主卡。

原测评明确绑定a78a478，收起显示“修正版待复测”，展开同时写原候选有效及新版未复测，未以旧测评为修正后提示词背书。目录note真实区分原生检索路线，按既有skill先例保留在元信息中；可见description不承诺所有模型联网，复核没有误称浏览器可见note。

## Host-Agent职责边界及复用专项

**本次实际增量通过。** Host只增加静态目录／用户回执展示、简单单位与比率格式化及既有项目看板导航，不为Agent编排研究、计算专业结论、选择方法或增加人工审批。提示词硬配额与无必要确认已修正。没有新Runtime、SDK接入、会话域／owner／profile、模型／Provider、后端API或持久schema；Interface v3及统一生命周期未改变。沿既有Pi skill／角色发现、子会话和原生检索契约复用，测试owner例外保持原精确范围，无新增豁免。

此结论只涵盖本轮变更及受影响接缝，不声称未重审的全库实现均合规。工程规范页首v1.6为本分支新增展示规则的版本预留；最新main的v1.5四原则等更新尚待整合、保全与受影响复核，未提前写完成。

## 完整检查与产品UI证据复核

根会话在固定v1执行 `npm run check`：1008测试＝**1005 PASS／0 FAIL／3原条件SKIP**，边界、tsc、Vite和构建标记通过。两名非作者只读核验完整日志和清单，不声称自己另跑了全部1008项。日志SHA-256 `99bd92b8a09acd41ac44d499d1ac114ca912d8319bad5b30323093d3c2783558`，测试后源文件零漂移。三个SKIP为不支持平台的受管执行分支及两个图片渲染项；渲染SKIP不记为渲染通过，既有大于500kB bundle警告保留。

实际产品UI由根会话通过浏览器在隔离正常Host操作；二者独立核验22/22件固定AX／DOM／截图证据，查看浅深色、默认收起／展开及390px窄屏截图，没有自行点浏览器：

- 五个skill默认全部收起、数值不可见；点击一次展开全部五项指标、版本、完整分母与代价，重复点击及键盘Return能收起。
- 缺回执不造零，非skill无此区域；深度研究打开进入既有项目看板，无新项目、任务或模型会话。
- 窄屏完整数据可滚动查看，文档宽390、panel clientWidth／scrollWidth同为320、nested=0，无横向溢出；临时视口已恢复。
- console告警／错误数组为空。正常Host关闭记录26条GET、mutatingRequests为空；隔离根未导入凭据，无模型发送请求，测试Host按SIGTERM关闭，临时tab及原型服务收尾，不改变现网服务。

一次深色整页截图为空白，`dark-expanded.png`保留且不计成功；随后 `dark-expanded-visible.png`正常，实际AX文件为 `dark-expanded.txt`，未补造误写的visible.txt。QA总回执SHA-256 `f8348ed7a47e8a1a4d4246f204525de2a38ba00142574f7d3e10181dbf6454b0`。

## 原始独立报告与证据索引

根证据目录：`/Users/bendandebaba/OptraCall-artifacts/deep-research-handoff-20261104-a772ae02/`。以下独立报告均保存在对应复核者目录，原件不可覆盖：

| 报告 | 目录／文件 | SHA-256 |
| --- | --- | --- |
| 原Spec不通过 | `deep-research-independent-spec-20261104T074906427546Z/original-spec-review.md` | `303287a91de8b128da255f49058403e6bb81f3762c9994b7a582819d8de75710` |
| Spec修复／新增展示 | 同根 `increment-v1/spec-review-before-browser.md` | `41069550907c40116a70bac5003dc6e99c255630b2a00b47d29e7000ecb30444` |
| 最终本地Spec与QA | 同根 `increment-v1/qa-addendum-v1/final-local-spec-review.md` | `3a59275803daefb677081b259cd67f14ec02176e44be03e7ca2aecd3d872f324` |
| 原Standards不通过 | `deep-research-independent-standards-20261104-154900-36420/standards-preaudit-0329249.md` | `74913ee73461699ab69602e2f7ce794efc7ff6394fd0c3232d767e1269cab830` |
| Standards修复／新增展示 | `deep-research-independent-standards-final-20261104-162536-505/standards-local-v1-review.md` | `1d4dae804eec7d83fda1a945df66eaab85ab66a526c644fd39761bc660212b74` |
| 最终本地Standards与QA | 同根 `qa-addendum/standards-product-ui-qa-addendum.md` | `a2df3bd45f3982dc5720569574ac73d2c1c54ab871f5344e28729c18121807b2` |

上述目录均位于 `/Users/bendandebaba/OptraCall-artifacts/`，完整日志、冻结预期、反例与验证清单随报告保留。首次辅助Git比较失败、独立验证依赖缺件／探针编译工具API误用、原边界FAIL、新展示真实RED及后续有效检查分列保留，不把环境故障写成产品RED，也不以重跑抹去原FAIL。

## 原本地阶段的待办

最新main整合及受影响重验、实际head CI、获授权Git交付／squash合并、本地main快进及OpenSpec归档尚未执行。后续基线或源码变化，须固定新身份并复核失效范围；不沿用不适用PASS。修正版用户测评、真实模型专业质量、产品验收、MacBook与运行采用分别核定，本地通过不扩大其授权。

## 文档收尾与 main 集成后续

纯OpenSpec收尾v2固定599文件，SHA-256 `566c9a78b5937d848726c5069bc6346c6b3ca17a82549315a9f52961dd4ed8dc`。两轴确认精确仅spec／result两改及本报告新增、其他596文件不变，12个相对链接可达、6份主报告SHA一致，没有重跑测试。Spec追加 `docs-v2-addendum/final-docs-v2-spec-addendum.md` SHA `0a015e8728966d11a36a09fbbe30dca7f2be60d8bc156a149dc2fc1420e69f4a`；Standards追加 `docs-v2-addendum/standards-docs-v2-addendum.md` SHA `161ced304e50c6fa4cb94d4095a16b42fe63b3cce82d87438c86f1487b8149d8`，位于上表对应独立根。P3降级另可溯原Standards验证附录SHA `ef572e05426c94c4982f27183d36034450cb5d135b6635804c86f732e6a81b1d`。

用户现已明确授权Git/CI及CI通过后直接squash／快进main／归档；此前未授权的历史记录保持当时范围。提交前仅修复Demo空白行尾随空格，再于 `ef95ce7` 集成main `bee3ae0`。App只在main现行导航增加deep-research，工程规范保全main四点原则／新增必做人工作业检查与既有授权，再加长期skill门禁和默认折叠展示规则。根会话95项受影响回归、边界、类型、构建通过，不称本地全量重跑；新完整候选和实际UI证据交原两名非作者做集成增量复核，最终结论另记。此段为当前过程记录，不提前沿用旧PASS背书集成后候选或未来CI。

## 最新 main 集成 v3 最终独立结论

完整866文件清单SHA-256 `cac82d3d63a0dd90d1ec41c50e805740d6cb089fe0bd4c3eff7aad55ebf02b70`，HEAD `ef95ce796a6c584b8221053a8a8c4a4b641854bf`加3份OpenSpec过程文字；父提交为修正7df7582和main bee3ae0。两名原非作者重新导出本阶段预期、逐项固定866文件并在独立副本验证，检查与QA后均零漂移。实际相对main **26路径**，初始27口述已显式纠正，无缺候选文件；不是产品RED。

两轴结论均为 **PASS_WITH_SCOPE，无新增必须修复发现**：

- App精确等于main加一次deep-research项目看板条件；main全部企业资料焦点清理、个人资料及语义入口逐字保留。
- 工程规范仅版本和长期skill两段新增，main第2–4节及四原则／最少人工作业／现行授权无删除；边界脚本仅精确DR03测试owner一行，公共Agent／会话／package／lock逐字等main。
- 四原则专项通过本轮范围：Host静态展示和导航、Agent自主、既有Pi发现／委派／检索复用；正常使用新增必做人工作业为0，测评展开为自愿披露，不成为技能使用门槛。未重审main全部295路径或推广既有批准例外。
- Spec隔离直接43/43通过；Standards隔离63/63、边界与类型通过。root95项／构建为只读核验的另一份证据，原数值探针及完整检查保持原阶段范围，没有声称集成后本地全量重跑。
- 16件集成UI证据SHA全部匹配，分别查看截图及AX／布局：默认五项收起、一次展开／键盘收起、项目导航、main个人／企业入口、深色与390px可滚动明细可用。14GET、无修改请求、正常SIGTERM与console空匹配；浏览器实际由root操作，二者只读核证据。

Spec报告：`/Users/bendandebaba/OptraCall-artifacts/deep-research-independent-spec-integrated-v3-20261104T085846633416Z/integrated-v3-spec-review.md`，SHA-256 `d1ee31750388f19b4b70760d4a43d13c911b3e658e2d52ec7b298bd7d9a25a5f`。

Standards报告：`/Users/bendandebaba/OptraCall-artifacts/deep-research-independent-standards-integration-20261104-165829-67946/standards-integration-v3-review.md`，SHA-256 `26ecddf7358cf6b9ea7bac3383abbcafc8ff8ac92baace604c26b14c62799624`。

QA回执 `integration/product-ui-qa-receipt.json` SHA-256 `b9619974327574a7943385c7f1f2fa4ee5d274dc813dbe3a704f0600acec2435`。这些结论只涵盖固定集成候选及本轮接缝；未覆盖未来PR／main CI、合并归档、设备采用或修正版用户真实测评。后续三份OpenSpec最终编录为非运行时文档增量，实际身份及窄核追加存于原独立证据目录，不为记录自身SHA无限改动报告。

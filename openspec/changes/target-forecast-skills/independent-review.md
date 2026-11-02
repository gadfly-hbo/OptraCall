# target-forecast 非作者独立复核

2026-11-03 · 本次固定接管候选的规格/数学及工程规范/职责复用两轴均通过，发现已由 Codex 修复并由原复核者重验。以下分别保留两名非作者复核者的最终报告，不将作者验证改记为独立执行。

两位复核者均以全新子 agent、`fork_turns=none` 启动，无作者会话历史；先从规格自行导出预期，再核实现/测试，最后核结果记录。候选源文件、测试、规格与既有证据只读，产物仅写各自新建隔离根；Codex 根会话是唯一实现写入者。根会话仅汇编本文件，原报告原文如下。

候选为交接 HEAD `0b436e591d3d56a3394edd28593074599b688b2e` 加工作树修复；固定34文件清单 SHA-256 `f43e1f2aa993c5a73c625ca7e7505e436fb6fa53c38862b7e5e2857ba1cbe0e1`，两名复核者均独立核得34/34一致。它与原始30文件移交清单不同；原29/30失败及用户接受差异保留于 result。最终追加的本复核文件与结果收尾是文档增量，另固定交付清单，未改已复核运行时/测试/规格。

根会话全量检查收尾补记：`npm run check` 在冻结运行时/测试树完成 exit0，904项＝901 PASS / 3条件SKIP / 0FAIL，含边界、全部测试、tsc/Vite构建；日志 `/Users/bendandebaba/OptraCall-artifacts/target-forecast-intake-20261103T003606/npm-check-final-v2.log`。这是作者执行证据，报告中“仍收尾中”保留复核落稿当时事实；不据此改写为独立执行全量或 hosted CI。Git/CI仍待本次用户另授权，产品验收及设备采用另行处理。

## 规格与数学轴（原报告）

原报告与独立证据根：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-review-spec-20261103-004413/`。

# target-forecast 三测算 skill 独立规格复核

结论：固定修复候选的规格与数学复核通过；未发现未解决的可行动规格缺陷。初始候选的 FAIL 及验证环境失败均保留，不能以本次 PASS 覆盖。最终工程完成仍取决于冻结运行时候选的完整 npm check 收尾及另行授权的 Git/CI，真实模型、原仓退役、设备采用和产品验收不在本结论内。

## 身份与独立性

- 源仓：`/Users/bendandebaba/.codex/worktrees/target-forecast-delivery/OptraCall`，分支 `qoder/target-forecast`；HEAD `0b436e591d3d56a3394edd28593074599b688b2e`，基线 `636ac3a53f69c524030cc6294d6eeccbdae3f6d7`。修复在工作树，尚非新 Git 提交。
- 最终34文件清单：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-intake-20261103T003606/takeover-candidate-final.json`。本复核逐项核得 **34/34 SHA-256 一致**，清单 SHA-256 `f43e1f2aa993c5a73c625ca7e7505e436fb6fa53c38862b7e5e2857ba1cbe0e1`。独立副本及核对：`fixed-manifest-copy.json`、`fixed-manifest-verification.json`。后续仅追加结果/复核收尾文档不等于运行时改变；任何代码变化须重验受影响范围。
- 非作者；源文件、测试、规格及既有证据始终只读；只向本复核根创建探针、隔离副本、日志与报告。先读 TF01–TF14/R1–R10 和讨论稿 D1–D5，将预期保存为 `expectations.md`，之后才读实现、测试与 result.md。代码发现先尝试图工具；Python scripts/新测试未被 fast 索引覆盖时回退已知路径。
- 原移交清单29/30与review-handoff字节差异的用户接受范围，按根会话固定事实保留；本复核没有把该原始核对改记通过。

## 预期→实证

| 范围 | 结论与证据 |
| --- | --- |
| D1/D3、TF01、R8：三独立skill，复用普通/受管任务 | PASS。`final-fixed-node-targeted.log`：普通任务SDK首请求包含三skill；受管产品HTTP开启后，实际SDK请求指向三份受保护快照，字节与源SKILL一致；三skill资源快照加载测试通过。未新增会话域、owner/profile、Runtime、agentOptions或业务流程编排。受管测试仅macOS适用，Linux明确SKIP。 |
| D5、TF02：三目录条目及项目导航 | PASS。已读最终catalog-data/App差异，Host变化仅两获准文件；三独立已接入条目、source/note数据、可见description项目任务入口与现有PPT形态一致。现有卡片不渲染source/note，未虚称它们可见。核对根会话CUA截图及AX，三条目形态可见；逐条导航由根会话实际点验。 |
| TF03/R5：A/B导入及三级质量 | PASS。`revalidation-probes.json`、`revalidation-extra-probes.json`、`invariants-result.json`：模板插空行后坏G4定位物理第4行；月份、非正金额、缺身份、非法数值/转化率、冲突均拒绝；GMV差异confirmable、缺月/短历史/左截断quality保留。黄金四类blocker消息仍逐字一致。 |
| TF04/R10：三视角、年度/平台/全渠道 | PASS。forecast黄金比较容差为相对1e-9/绝对1e-6；月度、年度、基线、季节性、主口径和汇总通过。独立缺UV反例现改人主口径120000并披露缺月，不能将部分月份UV与全月订单混算。全渠道比率重算及CVR覆盖标注已读；交叉差异未静默。 |
| TF05：券不变量/过滤/四类结论 | PASS。`invariants-result.json`：20组固定合成变体逐篮子概率范围且合计1、贡献拆解对平、预算仅过滤且原metrics逐值不变。非法q_table/新增权重被拒绝；人工候选必含无券；`four-conclusions.json`四类均实际构造。名义门槛/面额/篮子输入整数分，概率期望输出小数分是原数学与黄金的真实口径，已纠正不实简述，未取整篡改期望。 |
| TF06：券压力及实际参数分组 | PASS。变体由调用者指定；`final-extra-probes-followup.json`：low/high同一参数归并behavior.conversion.k，多因素不冒充单因素。压力给出DeltaProfit、可行性/排序变化；未引入固定+-20%。 |
| TF07：ROI公式、保本、稳定与校验 | PASS。独立算例100/2*.1*100得到clicks50/orders5/GMV500/net150/ROI5/CVR*=.04/gap=-.06。near-zero相反原始盈亏现在stable:false；`final-roi-validation-probes.json`：文本消耗、零客单情景、负CVR情景均字段化JSON exit1，无Traceback。 |
| TF08/R1/R2：黄金/确定性/身份 | PASS，限已测环境。`fixed-python-validation.json`包含Python3.9.6与3.14.4共14次--selftest全绿，黄金未改。`cli-determinism-result.json`：forecast/coupon compare/stress/roi同输入重复及两Python输出逐字节一致；反序对象键也保留canonical语义。导入/压力/分桶摘要绑定实际输入，所有四引擎已升2。 |
| TF09/R4–R7：三SKILL红线 | PASS。激活按目标/发券/投放分工；脚本数字、口径确认、情景免责声明、诚实损失/无券/差异/错误、变更即旧结论过期、无执行环境声明不适用及身份栏位均具备；流程明确是方法指引，Agent保留选择权。 |
| TF10/TF13：模板与依赖 | PASS。模板生成/校验闭环及两Python各16项新回归通过；四xlsx入口在-S缺依赖时给requirements安装指引并exit1。只标准库+openpyxl，无package/lock/pandas/numpy改动。Node TF11现仅标准库测算；`stdlib-tf11-target-fixed.log`证明无site-packages仍通过。 |
| TF11：实际SDK三类任务与控制 | PASS，严格限合成Provider。最终9/9 Node定向通过；三任务各read对应SKILL→真实bash计算→actual数字/身份→write报告并020/060回读；问候控制无工具。脚本由合成响应预定，不证明真实模型自主激活准确率、方法选择或报告质量。xlsx闭环独立Python验收，未放进Node CI。 |
| TF12/R9：Case/决策板文件引用 | PASS，复用合同。已看catalog/case/board图像、AX、QA README和下载字节：Case/Board各5370字节、SHA-256均989eb23e16fe3582d1a6f29c75b02b5618c2f9563f8e7191395071262c88a282；同源报告可用及路径/引文可见。QA报告用引擎1，只证明文件合同；引擎2由TF11证明。无新增预览/持久字段；中间020、报告060。 |
| TF14：回归与边界 | 非作者独立定向9/9和Python回归各16项PASS；Host范围/复用边界PASS。根会话冻结树最终完整npm-check-final-v2.log仍收尾中，须单独记录其最终退出与计数。独立原始archive副本900tests897PASS/3SKIP/0FAIL及tsc/Vite通过，整体exit1来自无.git的stamp环境限制，不能写成全量PASS。 |

## 初始发现与关闭

| 原始发现 | 位置/复现及修复复验 |
| --- | --- |
| P1 输入身份不绑定数据 | 原ingest main只hash文件名/平台/模式/行数；同3行GMV556→1356摘要不变。`probes.json`保留原FAIL；现实际headers/cells/caliber绑定，改单元格/口径摘要改变。root另修复coupon stress路径摘要与bucket缺身份。 |
| P2 物理行号/月份/必填身份及非法聚合值 | 原read_xlsx_rows跳空行后enumerate导致G4报3；月份202501拒绝、2025-13/xx接受，None身份/负数/零转化率造成静默计算或崩溃。原probes/extra-probes与修复revalidation均保留。 |
| P1 部分UV使零增长主口径翻倍 | 原forecast baseline以全月订单除部分UV，两月基线120000变240000。修复按完整UV准入，披露不适用和缺月后用人视角。 |
| P2 券基线/非法概率/敏感性 | 原manual compare无券缺席；q=2产生负概率与lost_orders=-144；新增权重-1/2产生负新增订单；stress用任意标签当参数。均有原实证并已复验关闭；自检现真正断言概率与预算。 |
| P2 ROI稳定性与坏参数 | 原舍入net导致相反verdict仍stable:true；无效参数Traceback或负GMV。修复以原盈亏符号判稳定、字段化数值/情景校验，黄金不变。 |
| P2 便携/确定性/依赖 | 原Python3.9 coupon16自检FAIL，23叶差异定位sum算法；显式fsum与原3.14黄金完全一致，不改容差。原canonical对象顺序和缺依赖指引/alias缺口已关闭。 |
| P2 验收证据/文案不实范围 | 原TF11仅ROI实际run，另外两类只是selftest；原TF01仅快照复制。修复后实际普通/受管发现与三测算任务均有SDK证据。原金额/身份/过期文案已纠正。原Node目标流隐式openpyxl在stdlib探针实证FAIL，改用冻结input→stdlib run后PASS；旧日志保留。 |

原始交接源码定位（相对 `extensions/analysis-assets/`，对应 `0b436e5`，不是修复后行号）：`target-forecast/scripts/ingest.py:105` 空行、`:130` 行号、`:81` 月份、`:594` 摘要；`target-forecast/scripts/forecast.py:99` UV；`coupon-forecast/scripts/coupon.py:206` q_table、`:228` 新增权重、`:900` compare、`:1071` 敏感性、`:1325` stress摘要；`roi-forecast/scripts/roi.py:47` 参数、`:69` 保本除零、`:117` 稳定性。具体原命令输出及固定合成输入可由同根 probes.py / extra_probes.py / cross_version.py / canonical_probe.py / followup_probes.py / cli_determinism.py 重现；重现时须指向原始隔离副本，不能把已修复树当原FAIL。

## 原黄金来源与验证限制

`reference_probe.py`从获准的本地原仓参考只读复制coupon_tool/roi_tool至本根，再以冻结输入独立重算：ROI expected、coupon10行metrics/decomposition/limitations及compare逐值一致；压力在情景名顺序归一后全部字段逐值一致。没有访问MacBook、凭据、真实模型或远程原仓；没有安装新全局包。forecast/ingest的pandas原实现未重新安装运行，其来源脚本已读，冻结对照按声明容差实测；不把数值容差误报为移植缺陷。跨OS/libm普遍便携性未实测，不从两Python本机成功外推任意环境。

浏览器动作由根会话执行，本复核核对其保留截图/AX和实际下载字节，未自行重复CUA。QA来源根：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-qa-20261103-004531/`；provider计数及端口状态按其运行回执，不从截图推导未见的网络行为。根会话完整check属于作者执行证据，与本复核独立运行定向检查分开。

规格/数学和职责复用结论：PASS。没有未解决的可行动缺陷；保留上述测试、平台及真实模型范围限制。最终完整check、Git/CI、用户验收和运行采用分别报告。


## 规范、架构及职责复用轴（原报告）

原报告与独立证据根：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-review-standards-20261103T004426/`。

# target-forecast 最终独立规范/架构复核

**结论：本次变更及受影响接缝的规范轴、工程规范§4 Host–Agent职责边界与复用专项通过；无未关闭的规范轴阻断发现。** 完整工程交付仍以根Agent正在执行的冻结候选全量`npm run check`及后续获授权Git/CI为准，本报告不将局部检查当作全量/CI/产品验收。

## 身份、来源与顺序

- 复核起点HEAD `0b436e591d3d56a3394edd28593074599b688b2e`，基线 `636ac3a53f69c524030cc6294d6eeccbdae3f6d7`；最终对象为同一HEAD加根Agent唯一写入的工作树修复，尚未Git提交。
- 固定最终清单：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-intake-20261103T003606/takeover-candidate-final.json`。复核开始最终轮逐项完整SHA-256核对 **34/34 PASS**，见`final-identity-and-checks.json`；不是原始不一致30项清单。后续仅result追加检查/复核状态时须重新固定交付清单；运行时/测试/规格不得静默变化。
- 先读AGENTS、engineering-workflow、agent-session-integration；从spec TF01–TF14/R1–R10、TargetForecast讨论稿D1–D5及产品总讨论稿独立形成`expectations.md`，之后检查实现/测试，最后才读result。使用code-review规范轴，气味基线为判断线索，不推动无必要重构。
- 非作者只读复核；源文件、测试、规格、既有证据未写入。探针/缓存/报告均位于本隔离根。未访问真实模型/真实凭据、原仓网络/源码、MacBook，未Git写入或切换服务。

## 预期 → 检查与证据

| 预期 | 最终判断 | 实际检查与证据 |
| --- | --- | --- |
| D1/D3、TF01：3个独立分析skill经已有SDK普通与受管快照发现 | PASS | `final-node-sdk.json`：9/9无skip，普通任务首SDK请求发现三skill；真实产品HTTP启用受管任务后，首SDK请求指向protected snapshot且逐一回读SKILL与源字节一致。另`SDK-discovery`探针使用锁定SDK `createAgentSessionServices`及现有skillsOverride，三skill分别10/10/4资源完整逐字节相等、unavailable=[]（`sdk-discovery-result.json`）。 |
| §2/§4：Host管环境、Agent自主分析，SDK/Runtime优先复用 | **范围内PASS** | 最终diff中Host仅`src/host/ui/catalog-data.ts`三条目/类型和`src/host/ui/App.tsx`既有openCatalogEntry导航；无计算、专业判断、分析步骤/迭代编排、平行会话循环或恢复重试机制。脚本是Agent可用分析资产，方法指引留在skill；新功能复用既有project-session、SDK资源发现和保护快照。 |
| IN01–IN07：零Interface/owner/profile/agentOptions/边界豁免变化 | PASS | `final-identity-and-checks.json`记录对src、package/lock、边界脚本的基线diff只返回上述2个Host文件。project-session、agent-sessions及边界脚本均原字节；新增SDK测试使用既有豁免测试文件，没有扩大白名单。`npm run check:agent-sessions` exit0。 |
| TF02/D5：3条已接入、入口语义诚实、对齐ppt-report导航 | PASS（限定现有卡片形态） | 源码3条category assets/status已接入/source/note元数据；App点击统一进入projects，无新页面/安装市场/独立计算触发器。最终description可见“内置、随OptraCall更新、项目任务对话”。实际查看根提供`catalog-three-skills-visible.png`与AX文字，三项及入口说明均可见；点击导航由根CUA走查。现有已接入卡片不展示source/note，报告已诚实披露，不宣称UI展示这些元数据。 |
| R4–R9/TF09：激活分域、诚实红线、自主方法、目录约定 | PASS（静态与合成路径） | 目标/发券/投放description明确；三SKILL禁止无执行环境硬算、要求脚本数字/口径与情景非承诺；coupon/roi已补数据/口径/假设变化后旧结论过期，coupon报告身份字段明确。020/060约定与既有010软约束沿用，未新建硬沙箱或业务步骤控制。真实模型激活/长链质量另未验证。 |
| R3/TF13：仅stdlib/openpyxl，缺依赖如实拒绝并给指引 | PASS | package.json/lock无变化；仅skill-local requirements。`final-dual-python.json`两版本各16项CLI回归均PASS，含4个xlsx入口在`-S`缺site-packages时exit1、stderr有所选Python的`pip install -r`且无Traceback；SKILL注明获准后安装，未实际安装全局包或降级计算。 |
| R1/R2/TF08：身份、确定性、便携黄金自检 | PASS（所测环境/输入） | 最终`--selftest`7项在`/usr/bin/python3`3.9.6与`/opt/homebrew/bin/python3`3.14.4共14/14 PASS；七入口兼容原selftest。黄金文件未改变；forecast/ingest明确相对1e-9/绝对1e-6，coupon/roi黄金逐值一致。`cli-determinism-result.json`中3引擎同输入两独立进程stdout逐字节相等，身份均v2；最终16回归另覆盖canonical对象顺序。 |
| TF03–TF07/TF10：脚本失败路径/模板与测试声称的关系 | 规范轴证据充分，专业完整性由规格轴单列 | 自检实际执行模板/导入/三数学黄金；独立改坏模板第2行非正金额正确阻断。新增16回归覆盖摘要与口径、空行后物理行号、月份/身份/非有限值、部分UV、人工无券、概率/权重、四类结论、敏感性、ROI符号/情景与依赖错误。未重新运行原仓，不从黄金存在推导原仓全部数学等价或所有业务场景正确。 |
| TF11：三类SDK合成任务各执行计算并交付文件 | PASS（合成Provider工程路径） | `final-node-sdk.json`三独立任务各read对应SKILL→bash准备输入/运行计算→工具返回实际数字/身份→write报告→020/060读回身份与数字；无关任务对照不调用工具。最终forecast Node测试仅取冻结案例input并运行stdlib引擎，xlsx模板/导入在声明环境单独验收；避免把openpyxl隐式加为NodeCI依赖。固定合成路由不能证明真实模型自主选skill或无误激活。 |
| TF12/C6：普通报告按既有Case/决策板合同引用和查看 | PASS（合同与根UI证据复核） | 本人独立`file-reference-probe.mts`通过隔离Host Case引用(expectedSha256)、available观察、exact-hash HTTP正文读回、决策板发现同报告。另实际查看根`case-artifact.png`/`board-reference.png`，复核两下载与原报告均5370字节且SHA `989eb23e16fe3582d1a6f29c75b02b5618c2f9563f8e7191395071262c88a282`，见`qa-reference-verified.json`；使用原合同，无新字段/存储/机制。QA报告为修复前ROI1，仅证明引用，不冒充v2数学验收。 |
| TF14：适用回归映射到最终树 | 边界/tsc/目标测试PASS；完整check根执行中 | 最终独立边界exit0、`npx tsc --noEmit` exit0、SDK9/9、Python两版各7自检+16回归PASS。未并发重跑完整npm check；根最终日志`npm-check-final-v2.log`在本报告时仍运行，须由根确认终态，不沿用首次check替代。 |

## 初始发现 → 修复与复验

| 初始发现 | 定位/复现证据 | 关闭依据 |
| --- | --- | --- |
| P2 输入摘要只绑定文件名/行数 | 原ingest.py main约591行；模板G2 199→299，GMV556→656，摘要仍68aa777f976c70f4。`dependency-and-digest-probes.json` | 绑定规范化表头/行内容/口径；最终两版16回归验证内容及caliber变化会改变摘要。 |
| P2 缺openpyxl无安装指引 | 目标/券template、ingest、bucket原入口`python3 -B -S` traceback；同证据文件 | 4个入口现在exit1并给出明确requirements指引，最终缺依赖回归PASS。 |
| P2 coupon便携黄金FAIL | 系统Python3.9.6原16项末位浮点不同。`seven-selftests-initial.json` | 显式math.fsum，不改黄金/不放宽比较；最终3.9.6/3.14.4 coupon selftest均PASS。旧math.exp归因在新增结果中被纠正。 |
| P2 原TF11只有ROI全流程 | 初始target-forecast-skills.test.ts另外两类只有selftest | 最终9/9真实SDK合成测试含三类完整计算/报告、普通/受管发现与无关对照。 |
| P2 coupon/roi旧结论过期红线不完整 | 原两SKILL仅要求改参数重跑；coupon报告步缺显式身份栏 | 两SKILL现明确数据/口径/假设变化后旧结论过期，coupon报告字段已补；最终文案检查通过。 |
| CLI `--selftest`不兼容（包括首轮ROI遗漏） | `fix-round1-dual-python.json`保留ROI exit2 | 最终七入口两Python版本`--selftest`全部PASS。 |
| 文案元/分千倍错误 | 原coupon SKILL红线2 | 改为百倍；与整数分输入及小数分期望输出口径一致。 |

初始report与原始失败保留在`report-initial.md`和各初始JSON，不将修复后的绿色回写为首次通过。原manifest29/30及handoff哈希不符仍为用户知情接受的身份差异，不记全量通过。

## 剩余边界与规范专项结论

无新增Host分析编排、平行Runtime、会话域/owner/profile、权限扩大、插件持久结构、全局Python环境或依赖变更。已有资源治理与快照仍是环境职责；没有以安全/预算名义添加方法配额或内部步骤门槛。就本次变更和实际受影响接缝，工程规范§4专项**通过**，无需例外。未检查的既有实现不因此获整体合规背书。

无未关闭规范轴发现；不提出额外架构抽象或大重构。最终全量check完成情况、hosted CI、Git交付、安装/服务采用和Product Acceptance须分别报告；真实模型自主激活/多轮调参/报告专业质量保持NOT_RUN。原仓退役、设备操作、真实业务行为未授权也未执行。


## 最新 main 集成增量复核（原报告）

# target-forecast main集成规范专项复核

**结论：集成影响检查与本次变更的Host–Agent职责／Runtime复用专项继续通过，无新增规范阻断发现。** 本次只读查看Git对象、差异与作者检查日志；未Git写入、未修改源文件、未重跑产品测试。

## 固定身份与影响

- 已核修复提交`825c8ef76ef54991ea25ecf610bf05d1c6a63db9`；集成提交`947cc7afafe41662d543a3a1e3f77a6bd414de6f`的父提交准确为825c8ef与最新main `484995d908087449e64e9c352b9d5e33d8358afd`。
- 947相对825 **严格只有4份SimLab OpenSpec文档、219行新增**：live-independent-review.md 128行、live-validation.md 68行、result.md 8行、spec.md 15行；无代码、测试、依赖、工程规范、统一接入或CI修改。此增量记录另一变更的实际验证/交付，不增加本任务模型、数据、设备或运行采用授权。
- 对先前独立复核34项清单中的30份运行时／测试／产品讨论稿，逐项读取947提交blob并核完整SHA-256，**30/30与已复核字节完全一致**。不是仅凭工作树clean或文件名判断。读取时工作树干净；完整证据在`integration-identity.json`。

因此，本次原先确认的Host仅2文件接缝、三独立skill、零Interface/域/owner/profile/agentOptions/边界豁免变化、既有SDK普通发现/受管快照、Case/Board文件合同均未改变。没有新的Host计算、专业判断、分析步骤编排或平行Runtime；规范§4范围内通过仍成立，不外推既有全仓合规。

## 集成验证与旧证据适用性

根作者的集成日志位于`/Users/bendandebaba/OptraCall-artifacts/target-forecast-git-ci-20261103/`。本人读到targeted-node.log终态 **9/9 PASS、0SKIP**（含真实产品受管发现），boundary.log明确PASS，python-regressions.log **16项OK**；typecheck.log无诊断。另已读取根保存的`integration-checks.json`真实命令回执：四项以&&串行执行，最终session39553 exit_code=0并运行至Python回归终态，因而四项各exit0，包括tsc。该回执副本为`integration-author-checks-receipt.json`。命令由根执行，不将空日志单独当作成功证明，也不冒充本复核独立运行了这些检查。

旧本地904项全量、独立两轴复核及双Python自检保留原固定候选身份；此次4文档增量与30文件blob相等证据足以说明其运行时适用性。集成后9项SDK+边界+类型及16项Python定向复验相称，无需为此文档base增量再造一轮本地全量；待发布实际head仍须由正常CI运行完整检查。若后续实际代码/测试变动，此判断须重新评估；仅交付记录追加可做文档范围复核。

## 最小原位归档方案

本仓OpenSpec根只有changes，没有单独archive目录或配置化迁移机制。明确先例：simlab `result.md:173`、`spec.md:3`，requirements-reliability与product-help `spec.md:3`：规格、结果、复核、候选清单、移交包保留在原稳定change路径，标注实施归档，不迁移或重写历史。

建议保持`openspec/changes/target-forecast-skills/`全部原路径。用户本轮已授权Git/CI且通过后直接squash，result已新增授权事实；历史“待授权／另请确认”保留当时状态，不再次设置合并Gate。actual-head CI成功后按授权完成squash，再回读实际PR head、检查run/attempt/SHA、squash提交/父/tree、main push CI及本地main安全快进。在spec顶部补“实施归档”及result末节链接，result追加一张实际交付身份表与证据位置即可，不预写未来成功或自引用未来SHA。若合并后追加文档提交，该提交自身身份/CI与产品树不变另核。

原FAIL/UNKNOWN、原manifest29/30、条件SKIP、验证环境失败、真实模型NOT_RUN和专业/用户验收边界继续保留。Git/CI授权不扩大安装、服务切换、MacBook、原仓退役或真实业务动作范围。

初次只读预检恰逢根并发完成merge，动态merge-base已从636推进到484，导致预检断言失败；已改按上述显式固定提交核对，保留为检查器时序问题，不冒充产品RED。待实际发布head/CI及归档文档到位后，可继续做相称的规范/交付收尾核对。

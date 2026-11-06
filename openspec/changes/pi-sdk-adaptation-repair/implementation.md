# v0.2本地实施记录

2026-11-06。用户明确确认收窄后的v0.2：优先R1隔离验证，通过后撤旧改写；官方SDK保持1.4.0，保留现有项目／会话／文件；完成本地检查和独立复核。Git交付、CI、运行服务切换及MacBook更新均不在本轮范围。

本记录补充实施事实，不改写批准原文、准备复核或改前评估。准确批准文件、开工前944份原文件副本／身份、基线`main@4298db98e879cff0a73f7a131d633e2cc48d7667`见`.local/pi-sdk-adaptation-repair/implementation/before.json`及`before/`；六份已有治理WIP完整保留。官方6个Pi包共2496份非嵌套依赖文件的开工身份在`sdk-before.json`。

## 接缝与执行环境

工程规范v1.7、IN01–IN07／Interface v3不变。真实owner仍由原Host公共会话入口管理；R1仅原个人资料／Case／经验／语义普通项目任务，以及原SAP source-reader例外。原workspace、protected／fixed-draft／text-only等排除合同继续保留。无新业务profile、schema、会话权威或分析流程。

批准的测试接缝为公开SDK资源加载／扩展注册及会话执行、公开ProjectAgent／公共Host会话入口、原合成Provider／MCP协议和原生历史读取／恢复。行为正反例、源对象保全与工程静态检查互补；不以单纯import或内部Map断言代替产品链。无产品UI变化，Demo不适用。

全部工程执行使用`.local/pi-sdk-adaptation-repair/implementation/candidate`独立源码副本和APFS克隆的独立`node_modules`，无安装／依赖更新；显式合成agentDir／cwd／sessionDir／credentials及loopback Provider，不覆盖HOME，不读取正式业务根、凭据或native。正式服务和其他设备保持原位。

## 连续切片与证据

| 切片 | 状态与证据 |
| --- | --- |
| R1-A 原位写入的因果RED | `tests/sdk-tool-context-runtime.test.ts`通过ProjectAgent启用原Host资料保护、登记冻结原definition；隔离执行1例失败，`r1-red.log`明确`Cannot assign to read only property 'execute'`。旧代码当时完整保留；非编译／夹具故障 |
| R1-B 公开接缝最小可行性 | 通过后才撤旧改写：实际候选模块19组公开SDK检查、10次loopback请求，包括late／hidden／恢复、命令／工具来源、getter／receiver、官方MCP、tool_search／codemode和reload。100／1000工具对照及24/24旧代际WeakRef释放；`feasibility/report.md`、新hash复跑`post-loadout-review.md`。单次合成性能不外推长期产品阈值 |
| R1-C 等价产品候选 | 首轮原个人／Case／经验／语义及冻结definition 62/62；历史／原SDK／Host恢复／新增持久回归62/62。永久新增late私有getter、hidden／reload和“完成A／仍活B”资格配对。mutable prepareLoadout缓存缺口另真实RED→GREEN，修复后4/4；日志`r1-green-focused.log`、`r1-r4-history-regressions.log`、`r1-loadout-{red,green}.log`。新增测试一次JSON转义断言错误原日志保留，不记产品RED |
| R2 固定只读内部例外 | 完成作者验证：版本不符前置／内部路径缺失两段真实RED→GREEN；loader／公共生命周期33/33、实际MCP／cleanup9/9。成功清理才释放，失败／UNKNOWN隔离原owner、显式close重试，不改公共实现。`r2/result.md` |
| R3 联网兼容证据 | 完成作者验证：新增12/12；原HTTP6＋trust1联合19/19。实际MCP HTTP JSON／SSE、取消／脱敏、受控TLS正负、真实connect及headers超时；SDK timer抢先时cause UNKNOWN与底层探针分开。首轮预期过窄FAIL保留。传输／依赖0改动。`r3/report.md` |
| R4 保全／最小检查 | 材料33/33、AST15/15，实际固定7包2530文件官方核验与独立回读通过。新增合成v1／v2副本实际SDK会迁移重写、只读种子／parent／无关报告字节不变；该测试及原保全回归通过。正式旧格式策略仍拆出，不加正式拒开，原风险保留 |
| 最终本地检查／非作者复核 | 第三冻结完整check exit0，1622项／1592通过／0失败／30条件跳过，类型／构建通过；执行前后954份输入一致。Standards与Spec剩余必须修复项各0，先前FAIL保留，见下文准确身份 |

本地工程候选已完成，不代表运行采用、真实Provider／专业质量或用户产品验收。

当前固定依赖审计回执在`audit/audit.json`：`npm audit` exit1，2项moderate，0 high／critical；涉及minimatch及其SDK上游，建议版本牵涉SDK1.5.0。本轮不改用户固定的SDK／依赖，不把审计告警写成通过，也不擅自采用建议版本。

## 首轮完整检查与独立复核发现（保留）

`full-check-1.log/json`：完整check在测试阶段exit1，1593项／1562通过／1失败／30条件跳过，build未执行。RR05失败为测试子进程把spawned JSON直接创建在父轮询可见名下，读到尚未写完内容；已仅将合成夹具改为隐藏临时文件写完后rename原子发布，不吞JSON错误、不改需求会话产品实现。修后原生命周期＋R1回归12/12，`r1-renderer-rr05-green.log`。

全新非作者两轴首轮分别保留为`review/standards.md`（3项P2）及`review/spec.md`（1项P2），原冻结文件在`review-candidate.json`／`review.diff`。不以作者或互查PASS抵消非作者发现。

| 发现 | 原作者修正及回归 | 当前状态 |
| --- | --- | --- |
| Spec P2 renderer receiver | 实际SDK HTML renderer以definition方法调用renderCall／renderResult；补私有字段renderer因果RED后，仅这些与prepareLoadout三个member hook按原receiver委托，prepareArguments等SDK转交callback仍原样；`r1-renderer-red.log`及GREEN | 待原非作者核新候选 |
| Standards P2 包裹表达式漏检 | AST剥括号、非空、as、type assertion、satisfies，getter／LHS／反射callee保持一致；原失败及补LHS RED保留 | `r4-scope-wrapper-{red,green}.log`、`r4-wrapper-{target-red,final-green}.log`，待窄复核 |
| Standards P2 同名来源误判 | 来源按函数／块声明及参数shadow解析简单alias，var沿函数归属；继承真实外层SDK alias仍拒绝，Host自有同名副本通过，不建通用污点引擎 | 同上，待窄复核 |
| Standards P2 同步改包写法漏检 | 原R4作者扩同类callback／promise／Sync已知写入名，明确Pi目标才拒绝；无关补丁／只读操作保留正例；`r4/review-followup/result.md`，31/31 | 待原非作者核新候选 |

工程门禁合并回归46/46；renderer／生命周期12/12。后续完整check与窄复核另写新日志／清单，不覆盖首轮FAIL。

## 第二轮与工程门禁的后续收窄

`full-check-2.log/json`：1620项／1590通过／0失败／30条件跳过，typecheck与Vite build通过；打包大chunk警告保留。Spec修后窄复核`review/spec-followup.md`通过，真实SDK HTML渲染与原baseline一致，独立58/58；原Spec FAIL不覆盖。

Standards第二轮`review/standards-followup.md`仍FAIL（2项P2）：局部解构shadow／无初值var重声明仍误判或漏判，以及材料regex把显式stdout／stderr只读输出误认安装写入。原作者分别补`r4-bindings-{red,green}.log`和`r4/review-followup-2/`，登记解构局部名、保留无初值var已有来源，只正规化显式标准流callee且保留参数内真实fs修改。当前材料33/33、AST15/15；不扩大成通用控制流／shell解析器，不改产品运行路径。第三冻结与原非作者窄复核／最终check另记，第二轮FAIL保留。

## 最终本地工程结果

最终工程输入为954份文件，清单`review-candidate-3.json`，SHA-256 `4d5da21a9c9fb12b64cf8988446444d036a943b0eb65757cf8283fba76eda385`。`full-check-3.json/log`记录完整`npm run check` exit0、1622项／1592 PASS／0 FAIL／30条件SKIP；类型检查及Vite build通过，954份输入执行前后逐一一致。运行源码、测试、依赖与该冻结身份绑定；本段及result/spec状态收尾只更新文档，另记最终文件身份，不将文档时间倒填到测试候选。

| 独立轴 | 首轮／修正过程 | 最终结论及证据 |
| --- | --- | --- |
| Standards／四原则 | 首轮3项P2、第二轮2项P2，原报告／复现／RED-GREEN保留；未把作者测试当非作者 | `review/standards-final.md`通过，remaining must-fix 0；独立48/48及已知标准流／文件修改矩阵，root/candidate各2530份官方文件独立回读一致 |
| Spec | 首轮renderer P2真实SDK复现FAIL；修后实际HTML输出与baseline一致，动态hook及raw callback语义独立验证 | `review/spec-final.md`通过，remaining must-fix 0；产品src与第二冻结相同，独立58/58及第三冻结工程48/48，范围未扩 |

两位复核者未参与候选任何部分创作，起始为全新上下文，只读源代码／依赖；作者可行性探针及接口互查分别报告。最终完整check在两轴通过后执行；不以局部复核替代完整check，也不覆盖首轮check或独立FAIL。

官方来源：`r4/official/receipt.json`固定官方1.4.0七包／2530文件，差异、缺失、额外文件及链接0；独立回读再次核归档SRI／锁／两树安装字节。`sdk-source-preservation.json`及最终收尾核对保留开工六包2496文件身份，当前root与官方核验过的候选七包相同；telemetry34文件纳入本轮补齐范围，不追溯冒称前轮已核。package.json／package-lock及SDK版本／undici8.12.2均未改。

最终adapter `bf3a7b1fbcaf2af466a5df119c3769df6cd055c180cb4ed8fecfb659d611e8c1`的性能／释放追加证据为`feasibility/final-member-performance.md/log`：同规模100／1000工具对照、首次／late／hidden／三轮reload及24/24旧代际回收。1000工具候选单样本约8–14ms量级；受JIT／缓存／并发负载影响，不归因单项修正、不建立长期产品阈值，也不声称该探针重跑了19组可达性。

30项条件跳过保留为实际SKIP：23项macOS私有集成环境、2项便携集成环境、1项原legacy材料、1项arm64发行缓存、1项当前平台支持受管所以不适用的拒绝分支及2项原SKIP。最终逐项原因随收尾证据保存；没有删除断言或关闭新功能凑通过。依赖审计仍exit1／2 moderate，构建大chunk warning保留；不在本轮调整SDK或打包策略。

正式旧格式历史迁移风险／R2只读内部例外继续开放，真实Provider／代理／专业质量及长期运行未证明。未来运行采用必须另核获准目标格式、归属与原件；未知／需迁移且无用户决定的目标不采用。本轮不打开真实native、不读真实业务或凭据，不用旧备份覆盖成果。回退仅撤隔离候选代码，保留合法新增资料，不降级／重置官方SDK。

正式服务观察为独立发布目录`/Users/bendandebaba/.local/share/optracall/releases/model-pack-4298db9`，没有执行生命周期操作。Git HEAD仍`4298db98e879cff0a73f7a131d633e2cc48d7667`，无产品Git交付／CI／合并，无MacBook操作。最终工作区保留为可审核的本地WIP，正式采用和用户产品验收另核。

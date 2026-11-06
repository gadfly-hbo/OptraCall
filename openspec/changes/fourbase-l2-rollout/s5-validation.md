# S5 验证结果

> 当前执行结果（2026-11-06）：原19次任务全部关闭，16条正式链及32份首／终稿独立评价、解盲与采用审计已完成。工程链路可用；完整报告专业质量未达标，5个首次原pair跨候选，完整L2收益未证实。结果及建议统一见[S5能力、缺口与结果](s5-results.md)，最终文件一致性按该页证据核。下文旧计数、暂缓或准备状态均保留历史；不进入S6、Git交付或正式运行采用。

> 当前更新（北京时间2026-11-06）：最小出站参数修正已应用。code-v4／runtime-v3及fullcheck-v5经非作者限定复核通过，已恢复原T010–T019；累计最多19，不改题集／原first-repeat身份或分母。v2已完成9次与修后v3分开记录，完整同候选收益判据仍NOT_PROVEN。下文原型／暂缓／旧全检状态均保留历史，以本补记及新增回执为当前工程状态。

2026-11-05 · 实施中 · 工程与模型结论分开

## 当前结果

独立环境安装、准确新Ref离线构图、原Host／Pi开放工程集成通过。当前已关闭9次真实任务：2条开放、7条正式链；结果与全部固定版本保留。已发现工具参数到模型的序列化缺口，后续派发暂缓，最小修正及原上限内续测安排见[S5工具参数修正](s5-schema-fix-plan.md)。计数以task-reservations.jsonl及原request回执核，不能把旧结果混成参数修正后的整批结论。不能据工程通过宣布专业质量、L2更准／更快、完整S5真实业务或S6通过。

| 验证 | 实际结果 | 证据与限制 |
|---|---|---|
| 完整Node检查 | 1529测试：1499通过、0失败、30原有条件跳过；boundary／tsc／Vite／stamp通过 | `fullcheck-v5.json/log`，S5新增必测无跳过；构建chunk警告保留 |
| 完整Python | 70／70通过、0跳过 | `builder/python-full-v3.json/log`，新独立venv，含旧版兼容、真实SHACL、authority与worker |
| 显式builder及新发布 | 9项针对检查通过，新0.2.0准确Ref构建、持久／重开，未知观察条件不补7日 | 原生Store生成新身份，未替换原S3来源 |
| 新资产准备 | 4／4通过，去控制、实际字段／单位映射、新发布和原M2证据一致 | `assets`作者回执；实际开放集成273位置，另一单测新字段为276，不沿旧337计数 |
| 薄Host | 4／4实际HTTP／SDK检查通过 | `runner`，首task实际ID在返回／open前绑定，原close复用 |
| 开放两普通模式 | 每模式六类definition／find／neighbors／dependencies／impact／source实际返回并进native；Python工具实际运行 | `open-integration`，受控本地Provider、0真实请求；每模式2次原SDK压缩保留 |
| 被动状态读取 | native原字节不变、没有自动图调用 | 实际开放集成；不把提供成功当正确理解 |
| managed允许／拒绝 | 合法本链输入有界open/read成功；共享源码／依赖写入、私有gold读取、其他链凭据及实际业务输入读取被拒 | v6实际os.open与本链有界read；gold未读出任何内容，业务输入与凭据分别实际拒读，适用当前可信规范根 |
| 独立真实SHACL负例 | 新准确版正例通过；缺依赖、反向操作数、错版本实际失败 | `security-pre-review`，非作者实际pyshacl，有target命中 |
| MiniMax模型／费用前置 | 原生准确型号／原线路可识别；订阅Key、额度GET成功；用户确认专用、续费关、无接续积分包 | `minimax-*`及官方文档快照，非生成请求。窗口85%／周100%为时点值，未知status代码不臆解 |
| 未见材料准备 | 6／6手算与独立重算相符，合法材料／gold分根封存 | `materials/receipt.json`；正式隔离／模型首稿／独立评分尚待实际执行 |

## 失败与修正保留

- 原首轮完整Node检查有3个旧S4 harness临时父目录缺失失败。只补测试环境目录后同一固定代码全量通过，原v1及针对复验保留。
- Python首轮完整检查缺两个环境变量，65项先通过但setUp失败；仅补环境后69项全过。安装路径初猜不存在单列环境诊断，不作产品RED。
- builder新根／新准确发布版／错误继承旧7日断言有真实RED→GREEN；前两次发布fixture fingerprint错误另存，不冒充产品RED。
- 开放集成v1缺builder inputs父目录，v2受控Provider未区分原SDK压缩请求，均保留。只改外部fixture，v3起两模式六操作完成。v4正向仅stat，v5改为实际有界read；被影响重验记录不覆盖此前证据。
- 已知包装器词法检查接受父路径alias的限制保留，本轮实际规范路径预检与managed负例补证；不宣传通用物理路径防护。

## 尚待完成

真实模型冒烟、16条正式首稿／自动链对照、取消、使用证据与独立全文专业评价、时延／usage／可核费用表、最终集中复核仍按批准顺序执行；公共工程维护矩阵已另完成九项，见下节。不得用工程成功代填专业正确，模型失败／取消／未交付保留原分母。浏览器交互仍NOT_RUN，既有拒绝不绕过。

全新非作者已完成v2源码、两轴初审及受影响工程／维护证据复核，范围内未关闭必须修复0，结论为PASS_S5_1_ENGINEERING_ONLY；正式模型质量及最终整包文件仍需后续复核，代码作者不能充当最终复核者。本轮无Git／CI／合并、服务采用、其他设备、真实经营数据或完整产品验收。

新增公开输入结构回归：不含旧scope／synthetic_assumptions、仅conditions的新原M2输入，构图真实KeyError后修正为保留实际键／locator；封存材料未改。v2完整代码manifest为4267fff079fafe3d515a99fa95868d66816b3e8408205ee29ed904171a0b0bc9，runtime334件v2为7638d860b8f1f12eafea8a72b9339a672d0d80f6f4f1669bb7c074fc726b52ce；v1结果保留，不能直接当v2全量通过。

开放真实模型当前观察：L1任务约127秒、L2任务约240秒，均沿MiniMax-M3.1-Flash／目标revision1／原默认high保存报告；只作开放工程观察，不能从这1对判断准确性或推广快慢。正式两臂仍沿冻结同源协议，不因开放结果改题／资料／参数／金标准。后续每启动前用独立同lock安装基准实际复核334源码与19916依赖条目；T001后/T002前零漂移。ignored driver的precall HOME缺失与ledger exclusive append失败保留，两者均在task/request前，后者未消费reservation，修为安全append后才首次启动T002；没有模型重跑。

## 新独立环境的维护矩阵

`maintenance-v1/result.json`九项工程通过：同根准确快照重开、新企业修订及原M2新说明驱动fresh run／snapshot、原16件旧代字节保全、loaded view下当前源撤回即partial／零节点零边并经原API恢复、损坏file_integrity_mismatch／缺图invalid_snapshot均unknown且ready=false、graph-off原L1五类准确Ref实际HTTP读取、Host原close幂等及loopback关闭／Store锁释放／全部Python子进程退出。只创建一个空闲工程task记录，未open／messages／模型或native；不是运行中Agent工具schema证明。

非作者核21份证据hash、16旧代文件和完整v2身份一致，维护范围0必须修复；具体回执security-pre-review.md／json。浏览器和真实模型专业评价不包含在该工程结论。

## 当前派发暂缓：实际参数声明缺口

原SDK对顶层Union的非strict Anthropic转换会丢properties／required，实际loopback抓包已在旧目录、合并语义和正式managed graph-only三个schema复现空object，0外部模型／0新增真实任务。已运行9次均原close确认，7条正式结果及未见评分原样封存；9条未跑正式与取消不补为通过。原工具实际graph能力描述存在，缺口位于参数接缝。修正原型要验证实际SDK null预处理／转换与原分支一致，尚未应用冻结候选。

原批准最多19次、同一固定候选的完整对照不能由新旧参数结果混合满足；当前剩10次。用户已进一步明确额度足够、必要测试可直接调用；当前按修正方案在原19次上限内续跑原余10任务，不改题集／身份／分母，v2和v3分开报告，完整同候选收益判据保留未满足。用户关于北京时间11月6日00:00额度恢复后继续的安排已登记；本次暂缓源于工程核实，不是额度已耗尽。

## 参数修正后的续测准入

复用原environmentExtension的Pi公共before_provider_request，仅投影已注册read_semantic_context的出站参数；原TypeBox、SDK验参与转换、权限、工具描述和Store不变。实际原ProjectAgent／SDK loopback回归RED确认旧字段缺失，完全相同测试GREEN；同文件27项、联合相关29项通过。原型120组SDK接受／转换0差异，source仅公共hook和35行纯helper，未修改依赖或SDK。

fullcheck-v4原1498通过／1失败／30跳过保留。旧SIM helper只看terminal lastRun，忽略同一GET中由公共busy投影的snapshot.status；最小test-only修正等其idle再返回，原45s／30ms及全部completed、PUT、在途409、历史字节断言保留，没有PUT重试或生产生命周期变更。8个轻载新根未自然复现，保留NOT_REPRODUCED，不声称已强制复现时序。fullcheck-v5完整通过：1529／1499通过／0失败／30原有跳过，boundary／typecheck／构建完成。

固定code-candidate-v4为77d5bbab766c4ed23ed31000d3343c951b8641bb3401da20bf3932cbb5aa8c06（613件），实际runtime-source-v3为bc678a3127684c242cc9aef4d5ca3c882f83f3b8ddcaae350d954bf48aa9b19d（335件）。只改服务端出站声明，构图／authority／Python等333原运行文件与v2完全一致；新serving index保留v2 construction identity及实际原Ref／snapshot，另列v3 serving身份，不冒称重建过图。v7当前运行源码下两模式六操作、五拒绝及合法有界read实测通过；实际335源码／19916依赖逐次校验继续。

非作者exact readback为PASS_BOUNDED_ORIGINAL_REMAINING_CONTINUATION_ENGINEERING_ONLY，0必须修复；不替代真实MiniMax修正后接受／采用／专业质量。实际恢复仍用原19总额、同一原计划序列、题面、gold、maxAuthor1及first／repeat身份；跨版本不拼完整收益通过。

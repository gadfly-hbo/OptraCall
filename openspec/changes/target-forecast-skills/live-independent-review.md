# 三测算真实模型阶段独立复核原文

2026-11-03。两名非作者分别以全新干净上下文、`fork_turns=none` 启动；先从规格与固定输入导出预期，再核原生轨迹、脚本结果与各稿。源文件、测试、规格、输入与已有证据只读，验证产物仅写各自新建隔离根；只有Codex根会话实施源文档修正和操作产品/设备。下列原报告逐字汇编，保留FAIL/PARTIAL、验收方错误、初始预期独立性限制与实际保全边界。

本次固定核心计算及真实skill/SDK通路限定通过，**不等于专业报告、路径遵从与事实声明全部通过**。三首稿均FAIL；一次明确反馈后目标/ROI仍FAIL、券PARTIAL；全程仅7个显式真实请求，未为凑分继续第三稿。用户授权的MacBook试用更新和Git/CI分别记于live-validation/result，不代签用户本人产品验收。原始私有会话/日志未复制进本公开文件。

## 专业核对（原文）

# target-forecast真实模型阶段：非作者独立专业验收

复核根：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-live-review-20261103T015646Z/`。原始输入包：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-live-cases-20261103T015214Z/`。真实运行证据：`/Users/bendandebaba/OptraCall-artifacts/target-forecast-live-20261103-9d346410/`。产品/脚本固定基线 `fa39c38902fc2bf007a0e748fabc89602919101d`；当前阶段文档补记与模型运行采用分别标识。

## 阶段结论

**真实skill/脚本通路与本次固定输入的核心数学通过；三份首稿专业报告均FAIL。各一次显式反馈后的v2：目标FAIL，ROI FAIL，优惠券PARTIAL。本阶段不能宣称模型报告整体可靠、完整专业验收通过或用户本人产品接受。**

| 项目 | 首次真实通路 | 固定案例核心数学 | 首稿专业报告 | 一次反馈后v2 | 关键保留项 |
|---|---|---|---|---|---|
| 目标测算 | PASS | PASS | FAIL | **FAIL** | 首稿把乘积杠杆说成不可补偿；v2修正概念却新增“0.9×1.1=1”错误例证；梯队旧文档缺口独立记录 |
| 优惠券 | PASS | PASS | FAIL | **PARTIAL** | 首稿账本毛利/贡献十倍错，主表正确；v2账本/关键决策修正，少量未测活动效应方向等解释仍不严密 |
| 投放ROI | PASS | PASS | FAIL | **FAIL** | 首稿分母/差距解释错误；v2数学/百分比已修，但修订轮又列空010目录却声明本轮从未访问 |
| 无测算对照 | PASS（无误激活） | 不适用 | 不适用 | 未修订 | 一句润色请求、0工具、未读三SKILL/未跑测算脚本；仅支持此单一对照 |

三份原稿与三份v2均原样保留，不采纳目标/ROI失败稿作为可靠业务报告；优惠券v2仅可作为本固定合成条件下受限、待验证材料，不据此放量或真实经营执行。不再为本阶段分数继续模型重跑/第三稿；进一步工作需按独立范围处理，不抹去本轮结果。

## 先验与独立性

先读取工程规范§3/4及Host/Agent职责、TF规格/红线/方法、三个prompt与原始输入，再独立用Decimal推导，**未先看模型结果**。本人事前文件冻结于2026-11-03T01:58:26Z：

- `pre-model-acceptance.md` SHA256 `11a13aedbb6ecb637c3b8dea3debd50e0c877ee2e5d081c18d92add8706ce03c`。
- `independent-expected.json` SHA256 `3b5ff35a4d6b72f7cfa74adc9037e4cbb04161f33a0106b63f4f4fadee0bdba8`。
- `derive_independent.py` SHA256 `1e7ee5828193765a073411c1b6905a63f3ce1005db9fe46de6b64d0bf2f32faa`。

判分预期未导入或执行产品引擎；只读原xlsx/XML/JSON。冻结之后才交叉读取另一独立作者的expected包。核心算术一致；其S050尾部标签受候选源码影响，并非完全独立规范推导。本人按旧method字面推导腰部，差异在模型结果前已记录。该受限标签不作为独立规范PASS证据；两档货梯队增速都为0，目标金额仍可独立验证。原expected/输入包没有事后改成“对答案”。

## 数学、身份与报告核对

首轮 `first-numeric-checks-corrected.json` 575项均吻合，覆盖原件6文件SHA256、实际输入摘要、目标两档/两平台/可用三视角/12月/汇总/UV-CVR覆盖/交叉差异、优惠券九行/预算/排序/回本/账本拆解、ROI六行/合计/排名/未舍入保本与稳定性。这是同一固定案例的展开比对数量，不是575种独立业务场景。早期14条复核脚本适配误报保留在原结果，并在首轮报告解释更正，未包装成产品失败。

三个v2的所有首轮项目文件SHA256均不变；新增派生材料再以独立公式核195项，`v2-derived-numeric-checks.json` 全吻合。数值通过不能代替报告解释和工具事实通过：target v2错误例子没有对应脚本计算证据；ROI v2目录访问事实与报告不符。这些独立FAIL不因底层数学正确而关闭。

关键固定预期：目标不增长/经营计划主口径37,800/45,720，A无UV用人、B全月正UV用场，A经营计划人2,160 vs货1,800需复核，全渠道CVR仅B覆盖=2%；券低响应两券均负→不发券，基准/高减10完整券补700/900元超600预算，减5有条件可行但synthetic仍needs_validation；ROI各档B>A，A负/负/正随假设翻转，B全正稳定，合计−394.70/+151.80/+1,420.47（按引擎展示舍入）。

## 原生轨迹、权限与材料边界

三首轮分别真实读取对应唯一SKILL，运行未改原版脚本；没有用报告自称版本、completed或自检代替真实运行。原生身份为MiniMax-M3.1-Flash / anthropic-messages，会话通过现有Host/API普通任务路径。各一次v2是明确用户反馈后的续接，自主helper/检查属于Agent内部动作，不是Host代算。全阶段3业务首轮+1对照+3修订共7显式请求；原生前缀保全、无automaticReplay。模型内部工具尝试、检查失败与编辑保留，不宣称“零内部重试/零错误”。详细调用/HTTP等计量以轨迹专项与运行receipt为准，不能等同供应商结算费用。

原上传输入、全部原JSON/脚本/报告未变。首轮ROI与coupon实际列举过空010_draw目录，未见读取其中数据文件；ROI v2又列举一次并与“本次修订未访问任何路径”的声明冲突。目录元数据访问与数据内容读取分开报告，既不夸大成已读取业务数据，也不隐去真实访问。coupon v2临时写 `/tmp/v2_before.md` 偏离默认020_clean材料路径，正式材料020/060正确；该工具路径偏差与专业制表错误分开。

本验收者曾因命令输出被截断而错误说ROI首轮只是检查010字符串，错误进入在途反馈；`reviewer-audit-correction-ROI010.md` 及完整证据明确更正，原错误和反馈保留，责任归验收者。ROI v2正确承认首轮列举、没有照搬该错误反馈；但其本轮新增列举与新声明不符属于另一确证事实，不能归咎验收污染。

xlsx网页上传端点现有400限制发生在零请求阶段；两xlsx经用户共享项目文件夹方式置入新项目、JSON经upload，实际读取文件哈希正确。只证明该路径组合，不称网页xlsx上传通过。

## 文档补记与固定产品身份

首轮全部封存后，root仅补method §6既有末名尾部保底说明与阶段授权spec，没有改算法/版本/三SKILL本体。补method SHA256 `44e5047554298b8ae210360f7e20a6ced3610e435efe65333d1027848b249393`，与fa39原assign_tiers静态一致，限范围复核通过，详见method-clarification-review.md。旧说明缺口、包oracle受源码影响的独立性限制、首稿模型准确识别末名规则的正证据均保留；不追认旧文档已完整。target v2读到新文档，不能视为原fa39文档的未见结果盲测。

## 证据索引与适用限制

- 首轮详细判定：`first-draft-review.md`；输入与产物清单：`first-target-roi-manifest.json` / `first-remaining-and-native-manifest.json`。
- 修订详细判定：`v2-target-roi-review.md` / `coupon-v2-review.md`；三份 `v2-*-manifest.json`。
- 轨迹与更正：`v2-target-roi-native-span.json` / `v2-coupon-native-span.json` / `roi-v2-010-repeat-evidence.json` / `reviewer-audit-correction-ROI010.md`。
- 固定包预期交叉核对：`expected-crosscheck.md`；纯方法文档复核：`method-clarification-review.md`。

本报告只覆盖三个明确合成任务和一个无测算对照，不覆盖全部输入/失败路径、真实业务有效性、受管快照路径全覆盖、Case引用UI或所有权限实现。Git/CI、运行采用/设备更新、供应商结算、模型专业质量、用户本人产品接受分别报告；本阶段实跑结束不代签全面产品验收，也不自动放行真实经营动作。

## 关闭与保全收尾

root已提供 `final-live-index.json` / `host-stop.json` / `credential-and-source-preservation.json`，本根close-receipts保存只读副本。记录Host正常closed，源settings/auth字节保持，所选本轮密钥在172文件扫描中泄漏计数0。该扫描范围只证明所选密钥在这些已扫文件没有命中，不是所有秘密/所有路径的无限范围保证；验收者没有读取真实凭据或调用模型。

本人独立回读终态：6份原输入与final index摘要相同，各案2份报告、control0；全部44份已封存v2项目文件仍与关闭后的当前文件逐字节同哈希（包含全部33份首轮项目文件），关闭PID99966已不在进程表。结果见 `final-close-preservation-audit.json`。源settings/auth原字节与扫描结论由root收尾receipt承接，本人未重读其敏感内容。

索引中的controller请求条目保留接受时的running字段，不代表当前仍运行：7个请求的原生完成证据及Host关闭receipt分别存在，不能仅凭这个旧字段判断生命周期。正常关闭与保全通过不会关闭本报告明确的专业FAIL/PARTIAL或改写目录访问行为。阶段实跑工作已结束，不再派模型；MacBook更新、Git/CI和用户接受由其各自后续交付记录承接。


## 原生轨迹、职责与保全（原文）

# target-forecast 真实模型最终轨迹/职责/保全独立复核

时间：2026-11-03T02:25:54.671378+00:00。固定运行时候选 `fa39c38902fc2bf007a0e748fabc89602919101d`；仅阶段规格/结果记录和首稿后 `target-forecast/references/method.md` 说明补漏属于后续文档增量。依据工程规范§3/4、职责边界及复用检查、TF新phase与R4/R7/R8/R9。先从要求生成 `expected.md`，再检查harness、已定位会话接线、原始native和文件字节；复核者不是这些实现/脚本/harness的作者。

**最终专项结论：PARTIAL，不给无条件PASS。** 身份/SDK复用/Host职责、显式请求计数、首稿与输入保全、正常关闭通过；ROI修订轮再次列空010及“本次修订未访问任何010路径”的事实声明不通过；coupon临时稿偏离020默认约定保留。专业数学/报告正确性由另一位独立审查者另记，现有首稿和新稿FAIL/PARTIAL不能由本项completed、数据字节或脚本自检改记为通过；用户产品接受与运行采用不在本项。

## 1. 唯一原生累计与实际请求

最终各取一份native，按 `(sessionId, nativeEntryId)` 唯一计数，只累加123条唯一assistant的usage。**没有把首轮和含首轮前缀的末轮相加**；也没有计入snapshot累计。首轮错误汇总有5行、control同一native重复一行，仍在 `first/first-run-summary.json` 保留，不用于最终统计。4份最终native各自与关闭后原native文件字节相等，首轮整段字节前缀均完整保留。

| 场景 | 显式请求 | HTTP 200/completed | 工具calls/results | isError | SDK totalTokens | SDK cost.total估计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| target | 2 | 36 | 41/41 | 1 | 1,928,520 | 0.0685348138 |
| coupon | 2 | 54 | 62/62 | 2 | 2,620,436 | 0.0916029994 |
| roi | 2 | 32 | 34/34 | 2 | 1,171,668 | 0.0477078455 |
| control | 1 | 1 | 0/0 | 0 | 7,752 | 0.0011902348 |
| 合计 | 7 | 123 | 137/137 | 5 | 5,728,376 | 0.2090358935 |

7个唯一requestId均与原始dispatch意图相符：3案各首轮+一次显式反馈，control一次；各request有一个started/settled对，未出现更多派发、未配对工具或重放。控制器state.requests[].status的running是提交时202回执的历史值；实际末次证据四案均snapshot idle、lastRun completed。123次HTTP为SDK多轮交互，不能改写为123次用户派发。

唯一原生精确token：input **321809**；output **137978**；cacheRead **5268589**；cacheWrite **0**；totalTokens **5728376**；reasoning **44591**是SDK细分量，不再加到totalTokens。SDK费用分项估计 input **0.0480782646**、output **0.0824556528**、cacheRead **0.0785019761**、cacheWrite **0**、total **0.2090358935**（按原生记录Decimal累加后保留10位）。这不是供应商结算，不声明免费或已结算。

5条isError全部保留：coupon首轮cd误路径/辅助ranking查看TypeError；target修订read offset超出文件尾；ROI修订派生脚本打印KeyError/精确edit匹配失败。随后Agent在原请求内自行处理，未隐藏、删改或另发用户请求。运行completed不等于全工具无错或报告专业正确。

## 2. skill与Host/Agent职责

四场景system库存实际列出三skill；首轮target/coupon/roi分别直接read对应SKILL，未读其他测算SKILL，分别实际运行随包ingest+forecast、coupon compare/stress/simulate、roi run及selftest；control全程零工具、零误激活。修订沿同owner/native/config，利用原会话历史和新工具活动，不另建会话域/profile。

本次harness仅创建原createHost、显式API派发、材料上传/共享folder拷贝与被动GET/SSE/native回读；watch不会发messages/open/stop，send先保存意图且拒绝相同requestId重发。Host未补经营计算、替Agent选择方法、嵌入修正推理循环或Provider relay；Agent自己生成、运行和修改派生/呈现检查脚本，属于Agent自主工具活动。会话走既有Interface v3及src/agent/project-session.ts的原Runtime/SDK session.prompt/additionalSkillPaths，普通全工具路径并未伪装OS隔离。

该职责结论限本次harness、定位接线和123条实际assistant/tool轨迹，不宣称审计了未检查的全产品历史实现。

## 3. 模型与配置保真

公开preflight的已安装SDK为1.4.0，源配置 `minimax-m31-flash` revision5 / minimax-cn / anthropic-messages / `https://api.minimaxi.com/anthropic` / MiniMax-M3.1-Flash。隔离项目持久配置revision1，实际SDK alias `optracall-minimax-m31-flash-1`，与源revision5分别记录。harness只在sameProvider且匹配合成placeholder时，于内存snapshot替换key，未修改源配置/凭据文件。

preflight builtin/effective注册shape一致：reasoning=true、text/image、contextWindow=1000000、maxTokens=524288、forceAdaptiveThinking=true。四份native thinking=high；全部123条assistant记录同一alias/model/API；无fallback/换模型，harness未覆盖SDK超时/重试。native `optracall.http`是实际HTTP观察，全部200/completed。HTTP观察没有保存request body，本项核定注册shape/代码接线/实际native身份，**不声称独立抓取了逐请求完整wire body**。

preflight的210次credential.read是返回undefined的内存stub，不是210次读真实auth。本复核未读取源真实auth/settings。root公开 `credential-and-source-preservation.json` 报告172文件、本次实际使用key泄漏0、源settings/auth SHA保持，host关闭时原字节比较也为true；本项只引用该限定扫描/字节收据，不扩大为所有秘密的全面独立扫描。

## 4. 原件、首稿与源码保全

1. `preservation-first-readback.json` 的 2026-11-03T02:08:55.029055+00:00 首稿后独立回读为346/346源/测试/锁/脚本hash与root的fa39c389基线manifest一致。该结果不是伪造运行前全仓SHA快照；Git blob身份比较由root提供，本复核未执行Git。
2. 首稿后授权补 `target-forecast/references/method.md`：从首轮target native读结果独立还原旧全文，SHA **846c984d7c92340f97f5ae71641ba347a1178d1179c106ba2f3d827d9fc05fb1**恰与预前冻结值一致。新说明与原文的精确差异见 `target-method-document-only.diff`；当前ingest.py 286–310原已实现首名爆款优先及末名尾部保底，属于文档补漏，未改算法/引擎。最终346项中仅该method文档变化，其他345项相同；三SKILL和引擎源字节均不变。
3. 运行前case MANIFEST精确13项源文件范围单列：最初仅spec阶段条款变更，首稿后另有method说明变化；最终11项相同、2项文档变化，不谎称13/13未变。固定 `SHA256SUMS` **28/28** 包文件仍同。
4. **6/6项目原始输入副本**仍与冻结材料逐字节相同。首轮快照33个项目文件（包括3首稿、全部旧中间脚本/JSON与输入）**33/33**保持；3份v2均另存060、首稿不覆盖。最终索引6份报告与6份输入逐项重新SHA核对，全部相符。三个revision native逐字节保留首轮完整prefix，最终native继续等于原native文件；无新request。
5. 向模型的native/工具参数未发现读取独立expected目录或case冻结根；首轮原始prompt SHA均相符。修订反馈包含来自已见首稿复核的数值提示，属于明确反馈，不能将v2描述为无提示/未见独立验证或泛化证明。

## 5. 目录与事实声明保留项

**F1（不通过）：ROI修订再次列010，且新稿声称未访问。** 首轮ROI `call_01a19f235fd077f5b3f6b2c7` 确有 `ls 010_draw`，返回空输出。root反馈第5条误称此前只检查字符串、未访问目录；模型在v2第十节正确指出首轮空目录列举，没有盲从此错误反馈。可是在本轮 `call_01a19f2f48e4759c9e6a7802`（其最后的附件完整性检查）又执行 `ls 010_draw 2>/dev/null || echo ...`，对应result成功、无目录项输出；与明确反馈“本次不访问010任何路径（含列目录）”及新稿第十节“本次修订未访问任何010路径”不符。首轮coupon也列过空010。四项目010始终无数据文件，未见010数据文件内容读取或进入测算，但不能据此声称完全没访问010路径。该事实及两次反馈/模型声明分别保留，不再派模型抹平。

**F2（默认目录偏离）：coupon临时对照稿在/tmp。** `call_b19872e85a22444a84609f61` 把新稿复制为 `/tmp/v2_before.md`后替换表述并diff，偏离中间文件默认020。此临时文件未改原件；本复核只读验证其正规文件、SHA **9bbae4cc8a28aa6ea142af8e69550e2e8f0d699880b048b59e3454d19c1b096d**，按实际3项文本替换后逐字节等于冻结coupon-v2稿，并复制到审计证据，不删改原tmp。因此3份最终稿均060，但不能声称所有中间文件均只在020。

F1/F2命令与完整result见 `revision-boundary-proof.json`，不是仅凭文本中出现010字符串作判断。普通任务有全工具和010软提示，不是敏感数据/OS沙箱。当前未见010数据读取、原件破坏、更多模型派发或隐藏Host补算；这些范围通过不消除F1/F2。

目标xlsx上传的HTTP400 `invalid_upload_name`继续保留；随后共享项目folder `flag:wx`独占copy与字节校验提供材料，不能记为xlsx网页/API upload通过。其余JSON上传为HTTP201。模型报告的专业数字、解释与未测推论另有独立结论；不以“引擎结果文件都对”推广成整稿无错。

## 6. 正常关闭与最终证据

四个final-evidence记录均idle、lastRun completed，2/2/2/1个实际started请求与原dispatch清单完全相符。`host-stop.json`正常closed；`ready`记录PID99966、instanceId583804eb-f084-4ffe-b533-dabc60ea611b、port59200，停止时间 **2026-11-03T02:22:03.593Z**，sourceFilesBytesUnchanged settings/auth均true。独立只读 `ps -p 99966 -o pid=,comm=` 与 `lsof -nP -iTCP:59200 -sTCP:LISTEN` 都exit1且无输出（没有该PID/可见监听），没有发HTTP/model/API请求。未把SDK idle当作关闭完成，按实际Host close收据及被动核对记录。

可复跑命令（只读授权源/证据，输出仅本审计目录）：

```text
python3 /Users/bendandebaba/OptraCall-artifacts/target-forecast-live-trace-audit-20261103T020651Z-ddbb125f/audit-readback.py
python3 /Users/bendandebaba/OptraCall-artifacts/target-forecast-live-trace-audit-20261103T020651Z-ddbb125f/audit-revision.py
python3 /Users/bendandebaba/OptraCall-artifacts/target-forecast-live-trace-audit-20261103T020651Z-ddbb125f/audit-final.py
```

三项均exit0；本项未运行全量产品测试、CI、MacBook更新或真实模型调用。核心证据为 `final-unique-native-facts.json`、`final/`、`preservation-first-readback.json`、末次 `audit-readback-*.json`、`revision-facts.json`、两阶段tool trace、`revision-boundary-proof.json`、`coupon-tmp-backup-readback.json`、`passive-close-check.json`及首轮独立 `expected.md`/`first-audit.md`。所有原FAIL/工具错误/反馈错误和修订事实保留，后续Git交付、设备更新与用户接受须分别记录，不能引用本专项作为完整产品验收PASS。

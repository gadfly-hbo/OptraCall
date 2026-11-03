# 三测算真实模型实跑与 MacBook 更新

2026-11-03。用户授权“真实模型实跑，完成后进行MacBook侧更新”。本次真实调用、三 skill 自主选择、随包脚本执行及固定核心计算限定通过；三份首稿专业复核均 FAIL。各一次明确反馈后，目标与 ROI 新稿仍 FAIL，券新稿为 PARTIAL，**不能称专业全通过或用户本人产品验收完成**。以下保留各稿、反馈及验收方错误，不用后续 Git/CI 或安装改写成绩。

## 固定身份与执行边界

| 对象 | 实际身份 |
| --- | --- |
| 发布基线 | main `fa39c38902fc2bf007a0e748fabc89602919101d`，三测算功能 PR #26 已合并并完成 CI |
| 执行工作树 | `codex/target-forecast-live` 独立工作树；没有修改 Host、SDK 接线、脚本、测试、依赖或模型默认值 |
| 模型与线路 | `MiniMax-M3.1-Flash` / `minimax-cn` / `anthropic-messages` / `https://api.minimaxi.com/anthropic`；源配置 `minimax-m31-flash` revision 5，未换模型或 fallback |
| SDK 有效配置 | 1.4.0；零请求核对 reasoning=true、thinking high、contextWindow=1,000,000、maxTokens=524,288、forceAdaptiveThinking=true；实际 native 模型/API/high 一致 |
| 隔离运行根 | `/Users/bendandebaba/OptraCallEvaluation/target-forecast-live-20261103-9d346410`，全新四个合成项目，独立 Host；Mac mini 原服务未切换 |
| 原始证据根 | `/Users/bendandebaba/OptraCall-artifacts/target-forecast-live-20261103-9d346410/`，含 harness、API/SSE/native、全部报告、失败与保全回执 |
| 输入及原始预期 | `target-forecast-live-cases-20261103T015214Z` 固定包，28项 SHA 清单摘要 `4012c9e4e93ececf0b3be9249c52b7c3c1707c6cf2ad8f6a6b3e16da7bced345`；金额预期由独立 Decimal 公式生成，不调用候选引擎 |

隔离配置经原保存/选择合同存合成密钥替身（revision 1），仅在该 Host 配置快照内存中替换同 Provider 的真实密钥；源 Store 未初始化、保存或选择。SDK 超时/重试及原生生命周期保持，未另建模型循环、Provider relay、Host 计算器或工具配额。HTTP 观察只记录脱敏状态/时序，**没有捕获实际请求正文**，不能把 SDK 参数推导写成 wire body 实测。

输入全部为合成经营数据，独立答案未交被测模型。初始业务 prompt 不点名 skill 或脚本；模型各自读取正确 SKILL，再实际执行对应内核。无关文字润色对照只有文字回复、零工具、未激活三测算。三个业务使用普通任务，未开启受管自动核算；本轮不外推为受管真实模型验收。

## 案例与核心计算

| 案例 | 固定输入及独立核心预期 |
| --- | --- |
| 目标测算 | A：12月订单明细、24单、2 SKU，全年1800元，无UV；B：12月聚合，每月GMV3000/订单20/UV1000。基准全渠道37800元；经营计划A人2160、货1800（差−16.67%需复核），B场43560、人43200，全渠道主口径45720元。全渠道CVR仅含B，保持2%，不能把A订单放进分子 |
| 优惠券 | 1000访客/基准10%，60元与120元篮子各半、40%毛利、全额券补、无费用/退款、不凑单/流失；人工两券满100减5/减10，补贴预算600元。基准增量450/100元、补贴350/700元，减10超预算不得截断；低响应0.005两券负增量应不发券；高响应0.04减5增量1150元。全部是假设，保留 needs_validation |
| 投放ROI | 两计划、三明确情景。A净贡献−514/−325/113.75元，符号翻转；B为119.296（展示119.30）/476.80/1306.72元，稳定为正；各档B>A。保本CVR、情景gap及汇总分别独立核对 |

目标的两份 xlsx 经表格生成/渲染与逐格回读固定。实际网页上传只接受 CSV/JSON/MD/TXT，xlsx 首次 POST 返回400 `invalid_upload_name`；这是既有入口限制，不记模型 FAIL。随后按既有共享项目文件夹方式将两表以独占写入放到该新项目020_clean，JSON走原上传 API；6份原始项目输入均与固定包逐字节相同。不声称 xlsx 网页上传已通过，也未扩大 Host 接缝增加上传功能。

两名独立预期者对主要金额交叉核对。固定包中 S050“尾部”标签曾受候选源码静态读取影响，不属于完全独立规范推导；此限制及原包字节保留。另一位非作者先独立推导后发现旧 method 只写尾部累计≤20%，漏了既有末名保底。首次模型已正确观察到两 SKU 时尾部占33.33%。首稿封存后，仅补方法文档：首名爆款优先、仅仍属腰部的末名保底尾部、阈值非份额硬上限、单 SKU 组仍为爆款；原内核及引擎版本2不变。本地固定原仓参考同有该特判。新文档静态复核通过，不追认旧文档无缺口或旧标签 oracle 完全独立。所有梯队增速为0，此差异不改变本案例货GMV。

## 实际请求与逐稿结果

| 案例 | 首请求 / 一次显式修订请求 | 工程与核心数学 | 首稿专业 / 修订稿 |
| --- | --- | --- | --- |
| 目标 | `42d7e14e-a21e-49b8-8da1-ddedc3c969ed` / `2c6f3acc-d528-47cc-bd8e-568c30d3af9c` | 均 completed，真实随包导入/测算及身份读回通过 | FAIL / FAIL |
| 券 | `d1f55984-523d-4586-a0d7-ad6b43066193` / `256d9d6f-140f-48b7-816e-7cf2daa189c4` | 均 completed，真实比较/ledger/压力、无券与预算过滤通过 | FAIL / PARTIAL |
| ROI | `7d81f83d-e869-4df3-9ace-cddd403e440f` / `3065c98a-d0c3-41a7-a5c5-b5c8f20b726b` | 均 completed，真实测算、身份、保本与排名通过 | FAIL / FAIL |
| 无关对照 | `f3aad2a0-1e34-464f-8208-693056dfe6d8` | completed，零工具、不误激活 | 仅检文字对照，不评专业计算 |

非作者575项独立核心数字、身份与输入保全核对吻合，但不能用其覆盖报告额外推论。三原报告及所有原中间文件保留；每案新稿另存 `060_reports/*-v2.md`。反馈正文、各显式用户 turn 和新 native 保留；修订稿是在看过具体问题后生成，不能作为未见反馈的一次完成可靠性证据。

- **目标首稿**：将乘积杠杆写成不可互相补偿、把B场/人差异单因归给客单，并有老客人次、左截断窗口表述问题。新稿关闭主要旧错，但新增例证“UV相对假设低10%、客单高10%则持平”错误：0.9×1.1=0.99，应低1%，严格补偿需乘数1/0.9。v2仍专业 FAIL，不改计算输出凑平。
- **券首稿**：主要比较表正确，附账本毛利/贡献少写10倍且混单均/合计；把唯一被测参数说成全模型最敏感，混淆解析回本与网格区间，并有未经重算的因果承诺。新稿已正确修复账本、主要比较/压力/回本与身份、过期声明；仍有“未做面额间比较”的不精确表述及未建模活动效应必使实际差距更小的无依据方向推断，保持 PARTIAL。
- **ROI首稿**：输入CVR/情景CVR的gap混排，将“可下降幅度”说成“高出保本比例”，并过度归因于CVR。新稿主要数值/百分比口径已修正，但修订轮仍实际 `ls 010_draw`，又声称本轮未访问任何010路径，行为与报告不符，保持 FAIL。

首轮ROI与券各列过一次空010目录，未见读取其中数据文件；ROI修订又列一次。它们与软约束“不要分析010数据”、业务指令“不访问任何010路径”以及报告事实陈述分别判断，不能把空目录列举写成原始数据泄漏，也不能用无数据读取证明路径指令/声明完全通过。券修订还在 `/tmp/v2_before.md` 保存一次临时对照稿，偏离020默认约定；正式材料020/060正确，不扩大成已发生真实业务权限或数据泄漏事件。

验收方也有错误：最初核对复合shell时漏看ROI首轮末尾 `ls 010_draw`，导致给ROI的一条反馈误称仅文本检查。错误反馈与审计更正原文均保留；ROI新稿主动正确承认首轮列目录，没有照抄这条错误，但其本轮再列目录/否认访问仍独立构成失败。此前复核字段/告警适配误报、裸GET缺客户端头与控制样本汇总重复也保留为验证器错误，不冒充产品RED、额外请求或账单。

## 轨迹、用量与保全

按唯一会话和 native entry 去重，7个显式请求共123个Provider HTTP，均200/completed；137对实际工具调用/结果，5个 isError（含命令路径、辅助字段/校验脚本错误）及模型后续纠正均保留，不能写全部工具成功。没有隐藏更换模型、自动重放用户请求或 Host 补算/改报告；不继续反复派模型把本样本修到全绿。

全部唯一 assistant 用量合计5,728,376 tokens；SDK `cost.total` 估计0.2090358935，**供应商最终结算 UNKNOWN**。原 first-run-summary 的glob重复了control，错误文件保留；本合计由独立原生审计去重，不重复叠加续聊文件里的首轮历史。

独立核对四条首轮 native 完整字节均为后续文件前缀，全部33个首轮项目文件（含输入、旧稿、旧脚本/JSON）未变；6输入仍同固定包。首轮后346源/脚本/测试/锁文件与发布基线相同，之后只新增已述method文档补漏，其他345项不变。数字相同不替代专业正确，也不外推未测场景或全部安全边界。

隔离Host已正常关闭，PID99966及跟踪端口59200已无本次服务；源settings/auth逐字节未变。172个本次证据/运行文件扫描未发现实际使用的密钥，公开记录不含凭据。会话、全部稿件、失败、临时稿审计副本和原始日志保留；未清理历史证据或其他任务，Mac mini原运行服务未切换。

专业及轨迹的非作者原报告见 [live-independent-review.md](live-independent-review.md)。专业结论未全通过；职责/SDK复用/输入与首稿保全有证据，路径遵从和事实声明的保留项不能被合并、更新或安装改写为通过。

## MacBook 单向更新准备

只读预检：试用浅克隆 `/Users/huangbo/Dev/OptraCall`，main与缓存origin/main为`484995d`且干净、push仍禁用；只读远端已见成功CI的`fa39c38`，不能将旧缓存0/0称为已更新。4173原本已停止，旧控制记录不是活动服务。Node25.9.0可用，未在peer调用模型或创建业务项目。

更新前已记录1206关键文件 SHA（含auth/settings、两SQLite及既有ppt-venv，约51.65MB）、3符号链接，0读取/不稳定错误；项目根当前为空，没有既存native会话，不能虚称保全了已有会话。trial锁/控制与logs动态项单列，其他私有runtime/tools保留metadata-only边界。字节仅在peer流式哈希，不解析/展示凭据或业务内容，也不复制Mini配置/项目到peer。

完成此次实跑与证据发布后，按用户授权沿用原 `trial-command.sh update` 核对最新main的成功CI、仅快进/锁文件安装/构建并启动；实际采用及更新后保全另记，不提前填写成功。预检与可复用保全脚本在 `/Users/bendandebaba/OptraCall-artifacts/target-forecast-live-macbook-preflight-20261103T015049Z-2e601e02/`。原仓退役/JuanerAI文档、复盘脚本化、pandas环境仍未随本阶段执行。

## 证据发布与 MacBook 首次实际采用

上述“准备”固定记录更新前状态。随后五份Markdown以 `bc23098c0e970be376cea1b178331bea6ad35164` 发布main（parent `fa39c38`，tree `aa0974a1d819c77a02871c09bf2ef1980145ecca`）；没有另建功能PR或改动内核。非作者文档发布范围复核无阻断，原报告逐字汇编；其范围报告在 `/Users/bendandebaba/OptraCall-artifacts/target-forecast-review-standards-20261103T004426/docs-scope-review.md`。本地protected-skills 4/4、差异与相对引用检查通过；[该实际head的Check #73](https://github.com/gadfly-hbo/OptraCall/actions/runs/41567002780) attempt 1 success，904项=844 PASS/60条件SKIP/0 FAIL，构建、agent-session边界和高危审计通过。既有2项moderate依赖提示保留。Mini主仓main安全快进至同提交、干净且tracking 0/0，未启动或切换Mini原服务。

2026-11-03 10:41北京时间（02:41 UTC），MacBook原 `trial-command.sh update` 正常退出0，完成停机状态核对、目标main成功CI核对、Git只快进、锁文件安装、构建及原launcher启动。没有reset/stash/clean、切分支、回推、复制Mini配置或新建业务项目，没有在MacBook运行模型。实际回读：

| 对象 | 首次采用实测 |
| --- | --- |
| checkout / runtime | `bc23098c0e970be376cea1b178331bea6ad35164` / tree `aa0974a1d819c77a02871c09bf2ef1980145ecca`，dirty=false；main干净、origin/main 0/0、pushurl=DISABLED |
| 活动实例 | `f4912109-758e-41d5-820d-9a013bd56953`，Host PID17164、wrapper17163；codeRoot `/Users/huangbo/Dev/OptraCall`，私有Node25.9.0；不是旧控制记录或仅磁盘build |
| 就绪与页面 | `/api/health` ready/200、SDK1.4.0；根页及JS/CSS/favicon均200；4173 listener与runtime PID一致 |
| 三skill与补漏 | 三份SKILL存在且与发布候选SHA一致；method为 `44e5047554298b8ae210360f7e20a6ced3610e435efe65333d1027848b249393` |
| 保全 | 1206关键文件SHA/size/mode/mtime零变化、零新增/缺失，3符号链接零变化，读取/不稳定错误0；现有配置、凭据、数据库与ppt-venv保持；项目根仍为空，不虚称已测旧会话兼容 |

7个既存目录metadata变化，以及新增正常project-store/decision-feedback锁、新启动日志和trial实例等动态变化单列保留，不写全部metadata不变。未清理这些锁、原日志或任何评估失败。其他私有runtime/tools首次仅metadata预检，未扩大为全盘字节审计。

原命令输出、actual-head CI原始API/job日志、真实health/进程/静态资源和前后哈希回执在 `/Users/bendandebaba/OptraCall-artifacts/target-forecast-live-20261103-9d346410/delivery/`（`macbook-update-first.log`、`macbook-first-runtime.json`、`macbook-first-critical-comparison.json`）。本段只固定首次采用；文档收尾如产生后续提交，仍须实际head CI及同入口追齐，最终Git/runtime身份另存该目录，不能预写未来成功。设备更新完成不改变本轮整体PARTIAL和各专业稿FAIL/PARTIAL，也不代表用户本人已产品接受。

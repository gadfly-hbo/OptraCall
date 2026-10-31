# 企业业务资料：合并后合成数据真实模型全链路

2026-10-31 · **PARTIAL：经显式续写后到达决策反馈；未达到一遍完成或专业质量通过。**

Git／CI 交付已完成，见 [delivery.md](delivery.md)。本次真实试验从需求梳理、企业资料、Case 例外、RAP／SAP 发布到分析、独立核算、决策抽取、逐项判断、行动记录、反馈、刷新与独立 Host 重开，已实际执行。前两次分析失败、错误报告和错误抽取均保留。报告未整体采用进 Case；正确的 North 建议只作本地模拟。不是正式产品验收，也没有真实经营收益。

## 固定身份与隔离

| 项目 | 实际身份 |
| --- | --- |
| 已合并源码 | `aa79262a2c3f11de4affd76abf13477f12c60387`，PR #15；与候选通过检查的源码树完全相同 |
| 执行 checkout | `/Users/bendandebaba/DevWorkSpace/OptraCall`，干净 main，重新构建 |
| 唯一合成根 | `/Users/bendandebaba/OptraCallEvaluation/enterprise-live-flow-20261031-34b92e25-bb43-4170-afaf-8b6f5fafed30` |
| 项目／任务 | `dbb2dc24-803e-4e39-8cb4-88f66ace5e03`／`07e12412-f7d2-4d88-bc17-447671a88cfc` |
| 需求／Case | `req-e5733163a948@1.0.0`／`0badf5be-0635-4e06-bd93-a1d6fb5ef512`，事前背景 revision 2 |
| 企业资料 | store `2b352214-bf02-40d1-87de-b03de7f09e7b`；修订 `e8cdd725-b6e5-46b0-947d-390429d63994`；正文 SHA `e472f99237f0b2783fde3ad3405b0a6de7b2d873cdf8238daaf3f7429225620b` |
| 模型／SDK | `MiniMax-M3.1-Flash`，`minimax-cn`，`anthropic-messages`，`https://api.minimaxi.com/anthropic`；SDK 1.4.0，effective thinking high |

来源为本机已获准 `minimax-m31-flash` revision 5；隔离配置通过正常保存／选择接口建立为 revision 1，磁盘只保存合成 key，实例快照只在内存替换为现有真实 key。不切模型、不 fallback，不改原配置。零请求前置检查与实际请求分开；这不是凭据持久化验收。

只有公开合成输入进入运行根：九笔订单（八笔 completed、一笔 cancelled）、待退申请、字典、企业公共原文、Case 事前例外及手工审核 SAP。隐藏离线答案留在 checkout 的 evaluator-only，未送给产品 Agent。原有服务、项目、会话、文件、旧六稿失败现场与 MacBook 均未操作。

## 实际步骤和结果

| 阶段 | 结果及限定 |
| --- | --- |
| 普通上传／SAP 草稿准备 | 四份 CSV／Markdown 正常上传；YAML 被现有普通附件入口以 `invalid_upload_name` 拒绝。保留失败，精确 SAP 字节以 `wx` 置入唯一合成项目，明确为外部手工草稿，不伪装成功上传或模型生成。后续通过正常 validate／publish／enable。 |
| 企业公共资料／Case | 正常接口维护、启用不可变修订；Case 固定引用并另加 South 六月 12% 的事前补充。公共 20% 规则、Case 例外和 SAP 指标定义分别保留。 |
| 需求梳理／RAP | 真模型 elicit 与 framework 各完成一次，无格式修正；逐项人工角色审核后采纳。两个问题按冻结来源回答，一个问题 deferred；四个假设仍 proposed。显式确认并发布 RAP 1.0.0，不强制分析方法。 |
| SAP／分析任务 | 手工审核 SAP `live-flow-contribution@1.0.0` 正常发布启用后新建任务。原生请求实际收到 RAP 摘要、Case 补充、企业位置和 SAP 索引。 |
| 实际读取／计算 | Agent 自主读取企业目录及正文并核 SHA、读取完整启用 SAP 和合成文件，执行 Python 计算；一次 TypeError 后自行修改自己的过程脚本并重跑。跨三请求累计 23 次可见工具调用。 |
| 报告 | 第一次和一次显式续写均原生失败；第三次显式要求精简篇幅后完成并保存。28 个核心数值检查通过，建议依据存在 P2，质量不通过。 |
| 产品独立核算 | 真模型完成先独立复算、后揭示固定作者稿的对照；原任务指针、原生历史、报告、输入保持不变。检出原稿最大项错误，但自身新增金额加总和“均翻倍”两项 P2 错误。48 次工具中有12条失败／Traceback结果，Agent在自己的核算过程目录修正后完成，不宣称一遍无错。 |
| 决策抽取 | 独立 text-only 会话，完整 4,471 码点／7,207 字节，无截断，0 次原生执行工具，6 条建议、15/15 引文逐字命中；错误依据也被带入，真实性不通过。 |
| 逐项判断／行动／反馈 | 明确弃用错误折扣项，只模拟采用独立核对正确的 North 待复核项；创建合成负责人任务，doing→done，保存反馈。4/5 仅评价记录操作，指标收益 UNKNOWN，无真实派发。其余四项仍待判断。 |
| Case 整体报告采用 | **NOT_RUN／有意不采用**：原稿存在错误，未作为本案正式采用稿；未伪造采用成功以凑齐阶段。Case 背景、关联、特殊补充已实际执行。 |
| 浏览器／刷新／重开 | 实际查看分类入口、企业资料、需求发布、来源回执和看板；浏览器警告／错误 0。刷新与同根独立 Host 重开均为保存数据完全一致，未追加模型请求。刷新后需重新点决策页，不宣称视图选择持久化。 |

## 两次失败和最终报告

| 请求 | 终态 | 观察 |
| --- | --- | --- |
| `980be341-07d4-4f99-87a1-3bd0863be0e6` | FAIL | 15:08:00–15:13:54（Asia/Shanghai），`request_terminated / native_request / retryCount=5`；已有计算产物，060 为空。 |
| `8d6928d7-ea7b-45eb-87fe-356b3ebbeb76` | FAIL | 15:15:23–15:18:08，同任务／模型的显式续写，`retryCount=3`；仍无报告。 |
| `03f8dad6-72d4-4b1b-ba26-ea3c29c0a994` | completed | 15:18:48–15:19:16，显式精简输出偏好后保存报告；没有把此前失败回填为成功。 |

最终文件为合成项目 `060_reports/禾川商贸_2026年6月经营复盘报告.md`，SHA `aaacaa6f8f24e0c95625ecdbc4ce89cc451893e7e0d1bbbf547353e995a9ad1a`。原稿未改，未请求作者修订或重放旧质量试验。

只读诊断发现：Host transport 的 headers/body 空闲设置为 30 秒，SDK 默认空闲设置为 300 秒。多次错误时长与该差异相容，但原始异常 cause、最后收包时间未保存，**根因 UNKNOWN**，未证明供应商或网络故障，也未修改超时／重试／模型配置。首轮 retryCount 5 是跨成功工具 turn 的累计，SDK 连续预算仍为 3。失败流 usage=0 不代表免费。

## 专业质量与下游采用

主指标、金额桥接、North 20%／South 六月 12% 的适用判断正确。六月净销售 19,000（五月16,900），直接贡献3,050（五月4,450），贡献率16.0526%（五月26.3314%）；总计桥接 +2,100−2,700−200−600=−1,400。未混入 cancelled／pending，未将贡献称净利润或推断活动因果。

非作者先从六份公开输入独立计算，再审固定报告；未读隐藏答案或提示产品核算。正式报告为 [live-flow-independent-review.md](live-flow-independent-review.md)：

- **P2：建议依据错误。** 折扣增量1,300被称为“可核增量成本最大项”，但商品成本增量2,700更大，且折扣是收入减项。优先复核折扣可以另有理由，当前“最大项”依据不成立。原稿不宜整体采用。
- **P3：退款比率分母含混。** 2/4是订单发生率，North 0%→2.5%实际为退款金额/gross，不是订单发生率（后者0%→50%）。
- SAP 原句“不得据此声称已正式发布”中的“据此”可理解为不能只凭 manual 来源推断发布，不直接否认实际发布。产品发布／启用回执正常。root 初核把该句列为状态疑点，后收窄为措辞观察，**不计实际发布失败或核算漏报**。

产品核算 `3a59082d-2ca5-44c6-a5e4-299def217595` 在15:23:33.251保存 cold basis，15:23:33.282才揭示作者稿；对照检出了上述最大项错误及分母问题，但新增两项错误：

- 把“折扣／退款／活动合计”写成2,100，实际1,300+600+600=**2,500**，仍小于商品成本2,700；反驳方向成立不使其辅助算术正确。
- 声称“折扣率、退款占比、活动占比在两区域均整齐翻倍”。两区折扣率确为5%→10%；North退款0%→2.5%（零基期），活动/gross 5%→6.6667%；South退款2.5%→5%，活动/gross 5%→7%。

有效核对结果不使其新增事实自动可信，补审见 [live-flow-verifier-review.md](live-flow-verifier-review.md)。核算工具结果的12次失败／Traceback中，5次明确isError，另7次Python经管道后shell返回成功但仍含Traceback；原生日志全部保留，最终completed不豁免这些过程错误。

看板抽取ID `442ff2e0-502e-4c7d-89dd-544d3b8b0798` 忠实复制了错误折扣理由，并标 high／0.75／多源佐证。逐字引文和等级不校验真伪，0.75不能当作已验证正确率。错误项 `b69b4f8b-3c47-41e4-bec3-73a60edf2fe0` 已由人工角色显式弃用；North项 `c5f8fedb-27e9-475b-b0f8-af10fbbdd506` 才被逐项模拟采用。Host只保存材料和用户选择，没有改写结论、补计算或增加分析拦截。

## 保全、计费范围与证据

刷新和重开保存数据指纹同为 `25e3ea477496bd5a99a76f919dccb53309e6efdcf642978ccf070c2fcb5630a4`，覆盖项目／任务、原生历史、RAP、SAP、企业修订、Case和看板任务反馈。四份上传原件与手工SAP均未变；核算未改原任务指针、历史或报告。测试 Host、原生资源、浏览器和工程 REPL 已关闭，两次临时端口均无监听；所有合成数据、失败和记录保留，不清理。

原 settings/auth 字节、选中配置身份及原 journal 缺席状态比较均一致；拥有的运行根332个普通文件未发现真实 key 的明文字节。此检查范围不是系统级无访问证明。原生可见轨迹审计未发现隐藏答案、凭据、工程目录或其他项目读取；完整独立审计另见本地记录。

四个唯一原生会话文件合计记录 input179,847、output88,122、cacheRead2,719,336、total2,987,305 tokens；SDK登记价格估计0.1200489554，**供应商最终结算 UNKNOWN**，失败流未返回usage的费用也UNKNOWN。它不是账单，也不证明模型免费。

本地证据：运行根的 `flow-state.json`、`api-journal.jsonl`、`attempts/`、`native/`、`verification-observed-summary.json`、`board-extraction-observed.json`、`readbacks/`、`source-integrity-final.json`、`native-usage-summary.json`、`ui/`。工程评估分数在 canonical checkout 的 `.local/enterprise-business-context/delivery/live-flow-main-aa79262/evaluator-only/`，root评分28数值PASS／建议依据FAIL，未送产品模型。

固定输入、SDK前置检查与辅助脚本在同目录 `live-flow-main-aa79262/`；独立复算／报告复核和只读轨迹诊断在4727工作树的 `.local/enterprise-business-context/delivery/independent-review/`、`live-flow-audit/`。辅助脚本初次SAP上传失败、REPL变量冲突和只读state恢复错误也留在恢复说明中，不当作产品成功。

### 独立原文的出处与时点

下列入库文件均逐字复制独立复核原文，不把其历史现在时改成收尾时状态。正文中的“同目录／相邻目录”、`QUALITY-REVIEW.md` 等名称指**原本地证据目录**，不指 openspec 所在目录；“当前HEAD／WIP”“核算仍在途／待操作”等句只反映各自固定时点，后续实际状态以上文与运行根终态记录为准。

| 入库原文 | 4727工作树内原证据路径（前缀 `.local/enterprise-business-context/delivery/`） |
| --- | --- |
| [delivery-post-merge-review.md](delivery-post-merge-review.md) | `independent-review/POST-MERGE.md`；审计功能合并及其两次CI时点，早于本次文档收尾分支。 |
| [live-flow-independent-review.md](live-flow-independent-review.md) | `independent-review/quality-preparation/QUALITY-REVIEW.md`；先固定作者稿结论，此时产品核算仍在途。其相邻准备计算、peer复核与来源清单保留在该原目录树。 |
| [live-flow-verifier-review.md](live-flow-verifier-review.md) | `independent-review/quality-preparation/SUPPLEMENT-VERIFIER.md`；作者稿复核固定后，补审已完成的核算成品。 |

**最终判定：Git／CI和源码集成交付完成；经显式续写及逐项人工审核的合成操作链路到达反馈并通过保全重开；一遍运行可靠性FAIL，原稿整体采用不通过，核算／抽取专业质量PARTIAL。未启动新修复开发、未切原服务、未进行正式用户验收或真实业务执行。**

# 真实模型、委托产品检查与 MacBook 试用更新

2026-11-02。用户在工程归档后要求执行真实模型、产品验收，完成后同步更新MacBook。本次经营推演的功能操作场景与数值检查限定通过；模型首稿、第一次修订专业评价均为FAIL，第二次修订关闭主要旧错但残余P3，**专业准确性仍为PARTIAL，不宣称完整产品验收通过或用户本人已经验收**。原始结论不被后续修订、Git／CI或安装覆盖。

## 固定身份与输入

| 对象 | 实际身份 |
| --- | --- |
| 已发布基线 | `636ac3a53f69c524030cc6294d6eeccbdae3f6d7`；功能合并PR #25，纯文档归档已发布 |
| 执行工作树 | `codex/simlab-live-acceptance` 独立工作树；产品源码、长期测试、依赖与基线相同，仅维护本阶段文档 |
| 模型／线路 | `MiniMax-M3.1-Flash`，`minimax-cn`，`anthropic-messages`，`https://api.minimaxi.com/anthropic`；源配置 `minimax-m31-flash` revision 5，未换模型或fallback |
| SDK／有效模型 | SDK 1.4.0；当前安装零请求核对reasoning=true、thinking high、contextWindow 1,000,000、maxTokens 524,288、forceAdaptiveThinking=true；实际native模型/API/high一致 |
| 隔离运行根 | `/Users/bendandebaba/OptraCallEvaluation/simlab-live-55a46680-f7c0-4277-b8c7-159f3c8615ec`，全新合成项目与独立Host，未切换Mac mini原服务 |
| 项目／任务 | `bd8decaf-4800-4312-9b55-258ee463fa83`／`3511f152-cb90-4aea-8d02-125f29c3f7db` |
| 草稿／快照 | `9779fa94-69c9-4483-b3dc-881d075f60a5` rev.2；`SNAP-0001` 绑定 `RUN-0005`／`a-normal`，inputHash `6a7dbc73bd0ae158d3c804332d1e1e5ca13318b0939fe0aee5e8fb0688f38a9e` |

独立配置通过既有保存／选择接口保存合成密钥替身（revision 1），只在隔离Host实例的配置快照内存中替换同一Provider真实密钥。未初始化、保存或选择源配置Store；两次正常关闭均逐字节确认源settings/auth未变。没有Provider relay或另建Agent循环。SDK默认超时／重试保持，实际SDK参数映射与传输元数据分别核对；**未捕获实际HTTP请求正文**，不能把SDK源码推导的adaptive/effort/max_tokens字段称作wire实测。密钥未进入公开记录。

运行前固定7天输入：日需10、期初库存12、产能8、提前期2，活动D2–3/+50%，两种shock关闭；单价10、进价4、履约1、持有0、初始现金400、maxWait 1、现金阈值180。A正常不额外备货／不限承接；B额外现货20／不限承接；C不额外备货／日承接6。独立复核者先用Decimal与需求日龄cohort生成隐藏答案，不调用产品引擎；原始答案未交运行Agent。后续修订收到明确问题与口径解释，不能作为盲测或一次完成可靠性证据。

## 实际流程与结果

| 场景 | 结果及限定 |
| --- | --- |
| 普通产品入口 | 界面新建项目、任务并显式开启推演；普通read/bash/edit/write及其他既有工具保留。Agent自主建稿、运行、选扰动和补充探索，无Host选方案或补计算 |
| 五工具与纠错 | 四个显式用户turn、23个Provider HTTP，均completed/200；33对实际工具调用／结果，五工具均真实执行。保留一次 `simulation_draft` demand=12.5 的invalid_parameters拒绝，Agent自行改为整数13；不把业务拒绝当全部工具成功 |
| 引擎与输入 | 首轮5run／17份7日账本119日、18项压力，132组独立核对无差异；第一次修订新增6run／11份账本77日、2压力，37组无差异；末次RUN15四结果与RUN5完整一致 |
| 页面探索 | 实际表单运行默认三方案30/90天，含默认需求／供给shock；独立复算360日账本、6个inputHash，720显示值、480差值及72汇总格均一致。该样本与Agent7天分析分开，不假装全部由Agent生成 |
| 建议卡与固化 | 原生显式suggestFreeze形成RUN5卡；界面导航到指定运行、变体、revision与摘要，人工验收角色核对口径后固化SNAP1。只确认模型原值，不整体采用Agent文字。后续RUN11／RUN15为新卡，旧卡／SNAP1未改，均未自动固化 |
| Agent读回 | 两次simulation_evidence（列表与SNAP1详情）真实成功，13项身份／数值一致性通过；正确区分只有A基准已固化、其他方案／压力／文字未采用。其文字解释重复原错，专业评价仍FAIL |
| 文件证据与Case | 两次界面导出均另存新文件，未覆盖旧件。两份报告各7,910字节，SHA-256 `1a9d92eeaf7ff0c646ad56f3d47a91e3de46159e45913b4c15797fe9b6cced2e`；下载字节与Case observedSha256一致。Case `b42288f4-b68f-4922-b4d5-1b31c1c0495e` 关联原项目，仅引用权威快照文件，不引用错误分析原文 |
| 决策板 | 两份报告可见且未抽取，建议、采纳与行动条目为0；没有自动推断经营结论或实际业务派发 |
| 默认关闭对照 | 新普通任务实际SDK open不暴露simulation工具，原九工具保留；未为该对照发送模型消息。受管／封闭资源不注入的覆盖沿用已发布候选检查，本轮未新增受管真实模型样本 |
| 忙态与归档 | 真模型在途时关闭工具／归档各返回409且任务继续。空闲归档后SNAP读200，导出、新建草稿、发送消息三写入口409，恢复后内容保留；不外推其他写入口逐项重测 |
| 刷新／同根重开 | 刷新保留三张历史建议卡。正常关闭、同根独立新Host重开后task、快照、Case、Board、草稿完整对象相同，61条消息和原生403,428字节逐字节未变；RUN15卡仍定位指定旧运行。两次QA实例与浏览器均正常关闭，跟踪端口无监听 |

页面计算与真实Agent数据出口分开：页面操作使用本机确定性引擎；真实工具回执会进入获准Provider的会话上下文，**不是全链路零外发**。页面无新增模型消息与历史保全有证据；本轮没有完整网络抓包，不能宣称所有服务端外发路径都经动态证明。没有真实经营数据或真实业务执行。

## 专业评价与保留问题

| 请求 | 实际终态 | 独立专业结论 |
| --- | --- | --- |
| `da744259-0086-408d-aa7d-11fa4dbbeb87` | completed | **FAIL**：活动增量15而非10、现金混库存、共同期初库存导致相对偏差的无依据推断、产能6.8而非有效整件7、现金外推等 |
| `2a10af92-978a-4d88-acd9-bfa15141784b` | completed | 读回身份／数值通过；现金等解释重复错误，专业仍FAIL |
| `905a7de2-79ef-4cfb-b5a9-0bcfa853c389` | completed | **FAIL**：部分旧错纠正，但继续现金混库存，并用期末库存减12误推付款来源。新增探索与失败完整保留 |
| `9cf8cb5d-dcab-4f12-badc-0b5a9eff3f7a` | completed | 主要旧错撤回；仍有**P3：正文与RUN15卡把已观察最低现金范围写108–192，实际96–192**，不能写专业全PASS |

残余96来自B在priceMultiplier=0.8下已实际返回的最低现金。第三稿所指此前48个结果与新增RUN15后的52个结果范围均为96–192。该遗漏不改变三个指定方案的基准数值、SNAP1或原生接线，不据此虚构引擎缺陷；含错卡片也不整体采纳。没有继续反复调用模型把样本修到全绿，没有Host财务裁判、新提示词默认、固定方法库、工具配额或静默修订loop。原候选的流程偏差、后补测试顺序偏差与旧专业FAIL保持。

## 用量、复核与原始证据

唯一原生文件累计input79,697、output52,958、cacheRead846,905、total979,560 tokens；SDK登记费用估计0.0561733171，**供应商最终结算UNKNOWN**，不是账单或免费声明。23个HTTP成功不代表33个工具结果全部成功，更不代表专业正确。

非作者干净上下文的数学／产品复核与另一位原生轨迹／职责边界复核分别完成，结果见[独立复核原文](live-independent-review.md)。产品源文件未因本次验证修改；文档提交使用差异、范围、引用与独立一致性复核，托管CI仍按实际提交另核。安装、专业结论和用户最终接受分别记录。

原始公开合成会话、API、逐日结果、用量、截图、失败和harness保存在本阶段工作树 `.local/simlab-live-acceptance/` 及上述外部运行根；独立数学报告保存在simlab-archive工作树 `.local/live-acceptance-independent-review-20261102/`。验收脚本误把rows叫ledger、AX增量树当完整树及定位器错误均保留，不冒充产品RED；修正验证器后没有改产品或删失败。

## MacBook 单向试用采用

按用户完成检查后更新的指令，通过既有试用入口更新指定浅克隆 `/Users/huangbo/Dev/OptraCall`；不在MacBook开发、提交、回推或调用真实模型，不复制Mini配置／项目／会话。专业PARTIAL不被此安装改写为用户接受或专业通过。

本记录整理时，原入口已正常停止旧实例并从 `be1caaf` 更新至 `636ac3a`，按锁文件安装与构建后启动：instance `fd9db680-d31b-4fbe-b32a-1afa3628e4f0`，build `2026-11-02T15:22:36.386Z`，dirty=false，runtime tree `e1ff5014fb7ad14f37b340188354e3c1a80e9cae`。更新后main=origin/main、工作树干净、push仍禁用；health与静态页面200，推演API对不存在项目返回预期404，业务列表仍空，没有创建业务项目或调用模型。

完整保全复核覆盖原7,685文件、1,840目录、17符号链接，停止前相对预检零变化；更新后无意外内容／权限差异或删除。源配置、凭据、数据库、venv、私有runtime/tools和全部旧日志SHA／权限保留，仅两应用锁、新trial实例记录、logs目录及一份新增启动日志为正常生命周期变化；metadata-only ctime差异单列，未隐去。实际回执为本机 `OptraCall-artifacts/macbook-readonly-preflight-20261102T144702Z/update-636ac3a/receipt.json`。

本次后置纯文档提交的最终SHA、CI与MacBook最终采用，另以Git／Actions和本地终态回执核准，不预写未来成功；不能把上述636ac3a当成尚未发布的文档提交身份。

本机持久收据位于 `OptraCall-artifacts/macbook-readonly-preflight-20261102T144702Z/` 及本阶段 `.local/simlab-live-acceptance/`。原仓退役与JuanerAI文档superseded未执行；Mac mini原运行服务未切换；用户本人体验和全面产品接受未被代签。

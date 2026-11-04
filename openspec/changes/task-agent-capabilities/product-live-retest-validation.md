# MiniMax / MiMo 真实联网问答重测

2026-11-04（Asia/Shanghai）。用户明确要求“deepseek不再测试，重新真实测试下minimax和MiMo”。本轮仅对现有 MiniMax M3、M3.1 Flash、MiMo V2.6 Pro、Flash 各做一次真实产品入口 operation；没有调用 DeepSeek，没有自动补跑或换模型。原版本/许可问题及天气问题的不足、取消和 UNKNOWN 均保留，本轮不是对它们的追溯改分。

## 固定输入与判定

- 实际源码提交 `2a6b34fb2cfb6be0530920d02a02e6f1784640dd`，Pi SDK 1.4.0、Node 25.9.0。走现有 `ProjectAgent → project-entry.mjs → project-session.ts`；Interface v3、owner/profile、模型注册和产品搜索参数未修改。
- 四个 profile 的 ID、revision、provider、API、model、baseUrl 均在取 key/调用前按原批准完整 tuple 断言，不符即停。配置/凭据只读入内存；五个相关源码及 settings/auth 字节在运行前后完全相同。
- 独立新 project/resource/native 根；仅测试根关闭 retry/cache warming，并用可信扩展清空和拒绝本地工具。四项均无 read/bash/write/subagent 请求/执行；本次只验证供应商原生联网，不是普通全工具或子 Agent 实测。
- 同一公开问题：截至北京时间 2026-11-04，Python 官网 Downloads 所列最新正式稳定 Python 3 版本、该版本发布日期及本次检索到的官方发布页 URL；排除预发布，正文不超过150字，证据不足直说。每 operation 截止300秒。
- 非作者先冻结验收，再独立读取官方 Downloads 及其指向的最终稳定发布页，参考答案没有传给产品模型。原文/来源、版本/日期、正常完成、URL关联及150字格式分别核对；不能事后放宽全文通过条件。

## 四项真实结果

北京时间 **07:30:35–07:31:20**，四项全部 `completed`，无截止取消、顶层 error 或 closeError。

| 原 profile / revision | 原 Provider / API / model | 耗时 | HTTP / 结构化来源 | 问答事实与限制 |
| --- | --- | ---: | --- | --- |
| `minimax-m3` / 1 | `minimax-cn` / `anthropic-messages` / `MiniMax-M3` | 20.256s | 2×200；27来源 | 正确给出 Python 3.15.2、2026-10-25，官方来源支持；旁证博客“同日发布”错误；原正文518码点，150字格式FAIL |
| `minimax-m31-flash` / 5 | 同 Provider/API / `MiniMax-M3.1-Flash` | 44.711s | 3×200；22来源 | 同样正确给出版本/日期，引用本轮官方来源；原正文665码点，150字格式FAIL |
| `mimo-v26-pro` / 1 | `xiaomi-token-plan-cn` / `openai-completions` / `mimo-v2.6-pro` | 11.642s | 1×200；3来源 | 错把旧 Python 3.15.0 当最新；正文150码点，内容FAIL，给出的3150发布页URL也不在本次结构化来源集合 |
| `mimo-v26-flash` / 2 | 同 Provider/API / `mimo-v2.6-flash` | 35.885s | 1×200；3来源 | 正确识别3.15.2，但明确无法确认该版本发布日期，HONEST_INSUFFICIENT；原正文185码点，另有格式FAIL |

MiniMax 两项保持原 `https://api.minimaxi.com/anthropic`；MiMo 两项保持原 `https://token-plan-cn.xiaomimimo.com/v1`。耗时包含入口及收尾，不是供应商纯推理耗时。正文长度取最后 assistant 的 `optracallNativeSearch.originalText`，不把 Host 机械追加来源清单算成模型原创；150字按先验规定计 Unicode 码点（含显示的 URL/空白/Markdown）。

因此，**本轮四项都真实搜索并完成响应；两项 MiniMax 已完成正确版本/日期与可追溯官方来源的核心问答闭环，MiMo Pro 内容错误、MiMo Flash 诚实但答案不全。** 若按预先冻结、包括150字在内的全部条件统计，`FULL_ANSWER_PASS` 仍为0/4；两项MiniMax均有格式FAIL，M3另有博客日期误述，核心字段正确不等于全文全对。不能说它们没有答对核心字段，也不能删除格式/附带事实错误后改写为全部通过。单次四项结果不代表后续稳定成功率或用户产品验收。

## 官方来源与中间失败

MiniMax 实际命中的官方来源包括 <https://www.python.org/downloads/latest/python3.15>，独立无凭据 GET 为200，并真实重定向到 <https://www.python.org/downloads/release/python-3152/>；页面支持 Python 3.15.2 及 2026-10-25。MiMo Flash 的本次 <https://www.python.org/downloads/latest/> 同样可核验，但它的回答没有给出该版本日期；验证者读到日期不能回填为模型已回答。

MiniMax M3附带声称官方博客“同日发布”，实际博客日期为10月26日，晚于软件发布日期25日；保留此附带事实错误，不因核心版本/日期正确而宣称全文全对。M3.1 Flash正确区分博客26日，无此差错。

全部47个去重结构化来源逐条 curl：**46×HTTP200、1×403**。正文中另有4个不在原URL集合的官方链接，另存为 answer-only，再独立GET均200；包括 MiniMax M3 的3152固定发布页与 MiMo Pro 的3150发布页。真实可达不等于本次Provider曾返回该URL，不回填检索来源；旧发布页可达也不能使“最新版本”判断变正确。

MiniMax 两项顶层均完成，但供应商原生块内分别有 **10 / 26 个 `web_search_tool_result_error`（code1033, system error）**，原样保留；不能表述为每个搜索子调用均成功。原 SDK 自然 pause 续接分别1/2次，HTTP总数2/3，每项均只有1个业务user，没有工程Agent补问题或重派失败operation。MiMo各一次HTTP，供应商专用 `tool_usage/page_usage` 均3/3。最终供应商结算未知，不把SDK成本估计或零值记免费。

## 证据与范围

本机持久根 `.local/task-agent-capabilities/product-live-retest/run-2026-11-03T23-30-35-735Z/`：

- `identity.json`、各模型 `configuration.json`、`observations.jsonl`：固定源码/配置、原线路及实际请求参数。原 MiniMax max_tokens524288、MiMo max_completion_tokens131072和各自 thinking 保持，不为本轮另降思考档位或修改上下文/输出上限。观察扩展早于产品搜索注入，`toolTypes:[]`只证明清空本地工具；原生块、来源和专用usage才是本轮搜索证据。
- `summaries.json`、各模型 `result.json/snapshot.json/events.json/native/`：完整原文、回执、保存及关闭事实；每项一个业务user。未额外发起恢复/重开请求，不把保存写成重开验收。
- `url-readback/results.json` 与正文；`answer-url-readback/`将正文额外链接单独保留，不冒充结构化来源。
- `source-comparison.json`全部一致；`final-secret-scan.json`对新增94文件检查5个实际密钥编码变体，0命中；`manifest.json`覆盖95文件，SHA256为 `eb1c82f86c20b9e552d7a94e227491ca6a5237102492b6b313fa1adfd0587a4f`。
- 脚本初次启动误加未安装tsx loader，preload阶段退出，尚未求值测试脚本，0 Provider请求；`product-live-retest/setup-failure.json`保留。随后改用项目既有Node25原生TS入口，没有安装依赖或修改模型，不把启动环境错误当模型失败，也未重放真实请求。
- 非作者先验、官方参考、独立回读与最终判读位于 `.local/task-agent-capabilities/product-live-retest-review/`；[公开复核原文](product-live-retest-review.md)保持原报告SHA256 `0737234f1f71ff8b94ebb2249a119f6bc4254695d08d91d05d16ff523ac27e59`，不改写其严格0/4判定。

本轮没有产品源码、工具、凭据或设置变更；只补真实验证记录。沿用原工程/CI证据的源码适用范围，文档增量另做内容/引用/身份核对；不把本轮模型问答写成全工具、子Agent、受管/受保护、UI、专业或用户产品验收。未合并main、切换服务、操作MacBook或Qoder工作树。

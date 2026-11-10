# 网络搜索接入结果

功能提交 7c95b02，帮助同步后完整候选 0efccc598786103956f40099825a66996400512c，树 0d9066f5125ce646b301db0acc3668500a0aabe7。分支 Test-And-Repair。默认顺序 MiniMax → DeepSeek，独立网页读取使用 DeepSeek Fetch。

| 范围 | 结果 |
| --- | --- |
| 浏览器与持久化 | 8 组产品浏览器回归通过。使用真实隔离 Host 读回默认顺序、保存反转、重开、恢复默认，共两次显式写入，无供应商请求。覆盖键盘、320／390 像素、缺少凭据、加载和保存回查。 |
| 线路和 Pi 工具 | 37 项定向回归全部通过。实际 Host 和 Pi 以合成传输完成改序回退、独立 Fetch、重开和原生字节保全、在途取消和迟到丢弃、受管普通分析与子 Agent 权限。单线空结果、超预算、轮换凭据、双失败均有检查。 |
| 历史与范围 | 读取既有 Anthropic 原生来源及原结果块，新请求走 Host 线路。固定材料、受保护分析和特殊工作区维持原工具边界。分析继续使用已选模型。 |
| 独立复核 | 非作者发现受管子 Agent 错误申请执行器网页工具，以及序列化回执超出跨进程预算。两项均修正并复核。Host 管线路、凭据、预算和取消，Agent 自主选择工具。沿用 Pi 1.4.0 公开工具接口和 Interface v3 会话，无新增日常配置步骤。 |
| 完整检查 | 固定候选执行会话边界检查、全测试套件和构建。1927 项中 1860 通过、0 失败、67 条件跳过，构建通过。保留现有包大小提示。 |
| 真实账户 | Mac mini 以现有 OptraCall 凭据完成三次真实供应商请求，均返回 HTTP 200。默认首选 MiniMax，故障时切到 DeepSeek。 |

首轮完整检查 1858 通过、2 失败、67 条件跳过。HELP-02 检出便携手册和应用帮助不同步，改由帮助源重新生成后逐字节一致。CONN-01 未在该用例的 200ms 时限内观察到合成请求，定向重跑通过。最终用相同全套测试、并发 6 再验证。早期失败记录保留。

本地证据位于 .local/trial-repair-20261110。主要记录为 search-final-check.log、search-full-check.log、search-manual-and-connection-recheck.log、search-focused-final.log、browser-1794324733133/result.json 及 browser-1794324832655/result.json。11 月 10 日试用报告和双端模型清理单独记录于 trial-report-20261110-repair。

## 真实线路验证

在 3e6e472 上直接执行 Host 生产搜索适配器。隔离顺序配置采用产品默认值，读取 Mac mini 现有两条模型配置，凭据仅在内存用于对应供应商。关键词为 “Python programming language official tutorial documentation”，抓取对象为 [Python 官方教程](https://docs.python.org/3/tutorial/index.html)。

1. 首选 MiniMax 搜索返回 10 条，DeepSeek 搜索请求数为 0。
2. 在测试传输中只对 MiniMax 注入一次 HTTP 503，生产适配器随后派发一次真实 DeepSeek Search，返回 10 条。故障是受控注入。
3. DeepSeek Fetch 返回 2317 字节 Markdown，与教程主题匹配。

真实请求共三次，保留脱敏的调用顺序、状态和条数于 .local/trial-repair-20261110/delivery/live-search.json。GLM 的账户验证及试用原件状态沿用独立记录。

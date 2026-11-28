# v0.2 用户确认与正式发单回执

2026-11-28 · PM Agent：Codex · **已发布，可领取**

正式工单：[Issue #155：Agent 大脑一期：原任务外派、WorkBuddy 本机执行与资产远端 MCP 闭环](https://github.com/gadfly-hbo/OptraCall/issues/155)。发布账号为仓库所有者`gadfly-hbo`，实际PM为Codex；已从GitHub读回标题、完整正文及Open状态，与已校验发布稿一致。

## 确认及固定版本

本会话用户在收到v0.2四份准备件后明确回复：

> 确认，发布issue

- [x] R06：用户整体确认本版spec、任务清单、UI Demo并授权发单；未另提供独立方案，按直接确认路径执行。
- [x] R07：确认版推送到工作分支并从远端读回完整SHA；正式Issue已创建并读回核验。

三个设计基准仍固定于提交 `0ff60301fed16321b35f315f15329e415a178450`，不因记录确认/发布而修改原字节：

| 文件 | SHA-256 |
| --- | --- |
| spec.md | `c00dfdf456ecb357e387dc8065b1488beaa24fa3a42ebee96ab1eb86cec57c0d` |
| tasks.md | `f683c32d24e25cf649faff992b270ad64676a002c4a47fc208c4080d19facec7` |
| ui-demo.html（157011字节） | `59b9bbdb70414a8909e0c4b9ea2386b68f56d8638d5c1c39ebff5c4922b6bb17` |

确认版远端分支为`codex/agent-brain-external-collaboration`；发布前main读回仍为`74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`。GitHub三文件blob身份也与本地Git对象一致。此回执及Issue中的确认事实承接0ff6030之前的“待确认/未发布”页眉和R06/R07状态；那些是确认前历史快照，不再是未确认的停止线。实际工程E01–E08未因此完成。

## 正式发单内容与复核

[已发布正文原样快照](published-issue.md)与[机器回执](publication-receipt.json)保存精确正文摘要、固定三件、远端blob及发布/核验状态。正式Issue正文已移除全部CONFIRMED_SHA和发布前占位，引用固定提交的spec/清单/Demo/说明、源码对齐及非作者报告/逐项矩阵；Demo仍须保存为HTML后浏览器打开，内部localhost不是托管入口。

[发单前非作者只读复核](evidence/publication/independent-review.md)核定可发，未修改冻结输入、重跑无关UI或改变既有结果；此前准备复核和原失败/NOT_RUN保持原范围。本次仅做确认件/远端对象/正文/查重核验，未将工程CI标为通过。

当前领取阶段为：先核最新main并在本Issue按协议领取，实际浏览器阅读冻结Demo、查看截图/DOM-CSS并回执映射，补最小接口/迁移回退设计与有效RED，再按E01–E07实施。正式代码/任务分支可以按Issue授权推进；开PR（含draft）前仍须PM实际展示对应候选的真实产品截图并取得用户明确确认，合并按有效授权。用户本次设计确认不替代此门禁。

本次没有实现外派产品、开PR/合并、运行真实账号/模型或切换设备服务。E08实号WorkBuddy＋资产MCP完整联通、部署与设备/专业/完整产品验收另核，不因Issue已发布而标就绪。

## 原文快照的格式保全

发布正文原样包含GitHub所存的尾空行，首次格式检查因此失败（原输出见`evidence/publication/format-check-initial.txt`）。PM漏设检查失败即停，回执先提交；随后仅为`published-issue.md`声明允许保留原始EOF空行，其他空白检查照常，不删改正文或更改其hash。补充检查后以实际通过结果为准；冻结三件与Issue正文始终未变。

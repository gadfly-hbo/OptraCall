# v0.3 整包准备结果

2026-11-28 · PM Agent：Codex · **设计准备包；待用户整体确认，Issue #155暂不领取，产品未实施。**

## 当前内容与范围

用户追加决定已同时落实到[spec](spec.md)、[任务清单](tasks.md)、[可点击Demo](ui-demo.html)、[同Issue同步正文](issue-draft.md)、决策/指南/UI映射及[本版变更表](changes-v0.3.md)：内部始终可选、GitHub通用外派独立闭环、WorkBuddy真实联调后才作为可选适配。三条路径与资源/接入门槛分离，跨环境限制明确；原Task/Case/草稿/来源、权限/claim/UNKNOWN/租约/交付保全/同owner/正式资产权威保留。

再次fetch后的origin/main仍为74030911ade7a9e06ad1a0213d1fcb93ecbba6dd，包含#150–#153；本准备分支已有该基线。本轮v0.3相对起点452e9c5a2fd91f427df3cddec68124c9f0c492e6仅修改准备目录文档/静态Demo/证据；完整分支相对origin/main还包含此前讨论稿和README索引，产品源代码、依赖/锁文件、CI均无差异，未修改运行实例。完整SHA将在Issue预览顶部读回；设计三个文件的最终摘要见evidence/v0.3/input-manifest.json。

## 检查与证据

实际浏览器脚本、JSON、截图、原失败及复核逐项矩阵保全在[evidence/v0.3](evidence/v0.3/README.md)。本轮记录分别覆盖新增路径与原导航回归，不相加为独立用例总数；结论仅限静态合成原型。

作者新增路径检查78项PASS；原Task/Case导航与原业务保全回归30项PASS。最终HTML身份9a5626d5efe69f2d5a4c22ee234919a4abd07e4c190a0fb996a9449cd062fcb4，另有跨Task内部继续4项delta通过，零页面JS错误、零外网调用。1440/1024/390亮暗的Task/设置/Case项目/工作详情24组布局无页面溢出，授权抽屉键盘/Escape/焦点正常；PM已实际查看桌面Task、通用接受和窄屏暗色设置截图。file协议尝试受环境管理员策略阻断，原FAIL保留，HTTP浏览器路径实跑通过。已修复初次option标签错误；“另一Task已有外派时阻断内部选择”的作者发现已改为只核本Task，最终78/30套件均已在修后HTML全量重跑，旧结果另标superseded。[独立准备复核](preparation-review.md)结论为准备范围PASS，无剩余必须修复项；[逐项矩阵](evidence/v0.3/independent/matrix.md)覆盖spec全部章节/AB、P/E任务及Demo页面状态。F01旧研究的WorkBuddy全局门槛已修并保留旧版；F02跨Task内部选择已独立重验。独立首轮150项中唯一焦点过早观测失败，正等待补充19/19、最终HTML增量10/10通过，原失败/脚本/截图均保留；其余原证据按唯一守卫差额无变化依据限范围适用。P01–P04已完成，P05待用户整体确认。真实Host/Pi/MCP/OAuth/TLS/模型/账号、WorkBuddy API和设备采用均未测试；Demo“模拟联合通过”不能启用真实配置。产品工程E01–E07与真实采用E08均待执行。

## 历史与下一步

原v0.2确认提交0ff60301fed16321b35f315f15329e415a178450、[原结果](result-v0.2.md)、[原复核](preparation-review-v0.2.md)及evidence/v0.2/publication记录保留；旧批准/PASS不自动覆盖本版。原有FAIL/UNKNOWN不改写。v0.3只申请整体设计确认，不把Demo截图当真实产品截图确认。

先把全部准备件一次性交用户确认；可推送明确标记待确认的工作分支预览并同步已有Issue #155，但不开放领取。确认后记录该版完整SHA/摘要与用户确认，在同一Issue继续发单；何时安排领取由用户决定。后续实际UI编码前浏览器阅读/映射、非作者逐项产品复核、开PR前真实产品截图展示及用户明确确认、实际head/main Check和有效合并授权均继续适用。

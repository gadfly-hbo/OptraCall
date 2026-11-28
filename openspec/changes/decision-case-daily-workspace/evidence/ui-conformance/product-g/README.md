# 候选 g：实际产品截图（待用户确认）

[并排查看冻结参考与真实产品](comparison.md)。

这些是实际 OptraCall Host 与产品组件的截图，使用隔离合成数据。不是冻结 Demo，也没有注入展示用 DOM 或样式。首次 fixture 中一段 Teach 回复来自官方 Pi 1.4.0 与本地合成 Provider；本轮截图没有调用真实模型。

候选源码摘要：`2f8ee75d4da2c5aca3240e9b26abc4ab7c6a5f798ae6ea650def9195db436f16`。实际 Host 构建于 `2026-11-28T02:05:43.009Z`，完整运行身份、页面/视口、截图时间和数据边界见 [主页面回执](receipt.json)、[弹窗与窄屏回执](extra-receipt.json)及[逐图 SHA256](image-manifest.json)。源码见 [g 构建输入](../source-manifest-g.json)，含未提交及新增文件的检查起始候选见 [完整清单](../candidate-g-complete-manifest.json)。运行时 HEAD 是规范提交 5dd5990、dirty=true；实际修正以所列源码字节为准，不能把 HEAD 当成完整产品候选。

**用户确认：待 PM 在对话中展示本组截图并取得明确确认。截图归档不代表已确认；开 PR 门禁仍未通过。**

| 页面或状态 | 真实原图 |
| --- | --- |
| 工作台首页 | [查看原图](01-home-1440.png) |
| Case 总览 | [查看原图](02-case-overview-1440.png) |
| 当前工作·事项列表 | [查看原图](03-case-current-1440.png) |
| 当前工作·事项关系树 | [查看原图](04-case-tree-1440.png) |
| 当前事项的项目与任务 | [查看原图](05-case-projects-1440.png) |
| 当前事项的成果与依据 | [查看原图](06-case-artifacts-1440.png) |
| 按事项回看历史 | [查看原图](07-case-history-1440.png) |
| 当前工作·390 窄屏 | [查看原图](08-case-current-390.png) |
| 全部项目 | [查看原图](09-all-projects-1440.png) |
| 原项目详情与六类任务 | [查看原图](10-project-detail-1440.png) |
| 首页·390 窄屏 | [查看原图](11-home-390.png) |
| 本轮取舍弹窗 | [查看原图](12-choice-dialog-1440.png) |
| 取舍弹窗·390 窄屏 | [查看原图](13-choice-dialog-390.png) |
| 原始观察反馈弹窗 | [查看原图](14-feedback-dialog-1440.png) |
| 反馈弹窗·390 窄屏 | [查看原图](15-feedback-dialog-390.png) |
| 手动查看另一事项的资料 | [查看原图](16-artifacts-metric-1440.png) |
| 准确原文与来源 | [查看原图](17-source-original-1440.png) |
| 已复盘事项当前工作 | [查看原图](18-reviewed-current-1440.png) |
| 当前工作·1024 | [查看原图](19-reviewed-current-1024.png) |
| Case·深色 | [查看原图](20-case-dark-1440.png) |
| 事项项目·深色 | [查看原图](21-case-projects-dark-1440.png) |
| 首页·深色 | [查看原图](22-home-dark-1440.png) |
| 准备新 Case·人工填写 | [查看原图](23-case-prepare-1440.png) |
| 准备页·390 窄屏 | [查看原图](24-case-prepare-390.png) |
| 准备页底部·明确采纳与创建 | [查看原图](25-case-prepare-action-1440.png) |
| 准备页底部·390 窄屏 | [查看原图](26-case-prepare-action-390.png) |

界面根据原记录展示，合成数据的 Case/项目数量、空对话与具体状态可能不同于 Demo 的固定例子。反馈的原请求与来源、补充记录按需展开；旧完整反馈草稿按原合同恢复，不强加日期、不截断正文或改原保存意图。

补拍的准备页底部只滚动现有草稿，未采纳或创建；见 [补拍回执](preparation-action-receipt.json)。

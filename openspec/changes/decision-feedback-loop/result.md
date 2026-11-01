# 第7步反馈回流：spec／UI Demo及实施记录

## 当前状态（A已实施）

**收尾更新：A已实施，最终功能候选568/568及类型／构建通过，非作者两轴复核无未关闭阻塞；真实UI及两轮真实模型合成链路已验证，专业质量错误保留。完整实施、候选范围、原失败及交付边界见[implementation.md](implementation.md)。下述实施准备和原型内容为历史记录，不是当前待办。**

### 实施准备时的记录

2026-10-31，用户已明确通过 spec／UI，并授权实施 A、完成检查与非作者复核。保留原决策看板全部功能、现有项目／会话／文件；B/C后置。下文原型阶段的“待评审／暂不开发”是当时历史记录，由本次授权更新，不代表仍需重新确认功能和UI。

实施分支 `codex/decision-feedback-loop` 从更新后的 `origin/main` b36a42b 建立，原文档WIP保留；未切运行服务、未操作MacBook、未重放任务。实施前 `npm run check` 已完成：543 tests、543 pass、0 fail，边界检查、类型与构建通过；Vite仍有原有大chunk提示，不作为功能失败。日志：`.local/decision-feedback-loop/implementation-preflight/baseline-check.log`。

两份代码只读核查已完成，确认原反馈覆盖、任务／需求创建缺持久去重、反馈选材需纳入fingerprint／实际提供回执。按spec第6节补成[完整结构决定包](structure-decisions.md)，已完成非作者复核，用户整体确认七项A；随后开始TDD垂直切片实施。新增能力的实现、验收及最终非作者复核尚未完成，基线通过不代替这些工作。

---

以下保留原型阶段记录。

2026-10-31 · spec／独立UI Demo候选完成，待用户评审；产品未开发。

用户确认完整方案后，仅授权A部分spec与UI Demo，B/C后置。基线为`9596b7d`，原方案未跟踪WIP保留，仅补用户确认状态和本轮链接。没有产品源码、测试、依赖、配置、数据库、项目或会话变更。

依据：[spec](spec.md)、[完整方案](../../../docs/workflow-closure-and-analysis-reliability-proposal.md)。根目录暂无DESIGN.md，本次明确使用现有产品外观和SaaS中央标准补充，不创建新设计系统、不修改生产组件。

## 候选与范围

- [spec](spec.md)：FC01–FC18／UI00–UI10，包含反馈修订、Case选择、交接范围、普通复盘任务、需求草稿、Case显式保存与下一轮选用；明确Host／Agent分工、Interface v1／owner及未来结构决定边界。
- [独立UI Demo](../../../docs/prototypes/decision-feedback-loop-ui-demo.html)：84,620 bytes，SHA256 `e98479298ac2efa6252d0e480e23784ba9bcdc0d88e4c04262ad45f12e010859`。
- 原型全为合成资料／预置回复，仅内存、刷新重置，无API、真实文件、模型或浏览器持久存储。产品归档、版本、重复／未知及来源回执在此均是交互模拟，不证明后端已实现。
- 为用户评审保留本机只读静态预览`http://127.0.0.1:4198/review/index.html`，仅服务`.local/decision-feedback-loop/preview/`的合成原型副本，不是产品Host；可直接打开单文件HTML，不依赖该预览服务。未启动或切换任何产品运行服务。

## 本轮实际验证

文档相对链接／范围、HTML解析／inline JS语法通过；静态扫描无fetch、XHR、WebSocket、sendBeacon或localStorage／sessionStorage／IndexedDB调用，无远程依赖属性，CSP禁止connect。作者29项状态替身检查和后续定点检查仅为原型自检，不是产品测试或浏览器验收。

root使用Cua真实浏览器点验并保存AX及截图，分候选记录，没有把旧版本全部冒称在最终SHA重跑：

| 浏览器实际加载候选 | 实际观察 |
| --- | --- |
| `44fa47ce…caa501` | 反馈取消／Esc保留输入并返回触发焦点；另存v3后v1/v2仍可读；选择v1并确认后新增v4不切换；创建普通任务未发送；选材正文／片段回读；显式模拟发送；需求只使用实际回复，未确认／未发布；仅关联Case不采用编辑稿；明确选用后下一轮回执；0材料回执及需求不夹带正文；两个任务需求草稿分别回读；部分成功查询同一原操作。 |
| `e7ba7ad5…24df3` | 来源变化清除确认并要求重看范围；归档新建拒绝且草稿保留；已结束Case不可选、可改无Case；未取得反馈／doing可提问，附件仅引用；UNKNOWN标待确认且不显示确认目标入口；冲突保留原操作；查询同一任务不自动发送；普通任务副标题修正。 |
| `38c11453…31a0a` | 增补显式Tab／ShiftTab循环后，两方向焦点均在dialog内，Esc关闭并返回演示说明；亮暗及390px布局初检。 |
| 最终 `e9847929…10859` | 明确导航加载新URL，390px返回按钮横排68×36、正文scrollWidth=clientWidth=390；再次实测双向dialog焦点循环；创建草稿→UNKNOWN待确认／无目标入口→查询原操作进入同一未发送任务；副标题无裸模板；重置后生成默认复盘交付预览，最终console warn/error为空。 |

中间候选之后仅定点修改任务副标题、UNKNOWN文案／打开入口、dialog焦点循环及窄屏标题动作区；差异与每轮副本保留，未在收尾增加业务路径或更改模型／运行时。

关键证据位于`.local/decision-feedback-loop/`：`ui-history-final.txt`、`ui-task-created.txt`、`ui-old-receipt.txt`、`ui-requirements-draft.txt`、`ui-case-reference-next.txt`、`ui-next-receipt.txt`、`ui-zero-material-receipt.txt`、`ui-zero-requirements.txt`、`ui-owner-isolation.txt`、`ui-final-*.txt`、`ui-release-*.txt`、`static-final/scan.json`，以及各候选副本／差异与作者记录。

最终展示图：`feedback-board-final.jpg`、`feedback-review-final.jpg`、`feedback-review-mobile-final.jpg`；暗色截图`demo-board-dark.jpg`对应焦点小修后的候选，布局／主题在最终CSS中保持，最终窄屏修正另有图。浏览器尺寸覆盖不是产品移动端／物理设备验收。

## 发现与修正

独立复核和浏览器点验发现并关闭：原型导航偏离原分析／决策外壳；0材料需求引用非实际回复；仅关联Case夹带未采用编辑稿；不同任务共用需求／Case草稿；缺UNKNOWN／部分成功／冲突示例；原型Case错误关联；无反馈交接修订可空的spec歧义；任务副标题裸插值；UNKNOWN误标已创建；dialog末尾Tab离开；窄屏返回按钮竖排。旧候选／发现保留，不将这些原型修正算作产品RED或产品缺陷修复。

两次浏览器定位假设失败保留为点验设置问题：精确getByLabel未匹配时改用已观察的控件ID；查询原操作已自动进入任务，随后寻找旧页面按钮无匹配，读回当前页确认后继续。没有因此放宽产品权限或重放模型请求。

非作者独立整包复核已完成：限定本次spec／合成UI Demo可交用户评审，已报告问题关闭，无新增可行动发现。范围覆盖已确认A、spec、HTML／状态、原型披露、边界及上述分候选Cua证据；报告与固定清单在本机`.local/decision-feedback-loop/review/independent-review.md`。此结论不代替用户UI确认、产品实施、真实模型或存储验收。

## 尚未实施／验证

产品实现、持久结构／兼容迁移、真实正文交付、真实模型自主复盘及下一轮采用收益、原文件字节保全试验、保存／重启、产品全量检查、Git/CI、部署和用户spec／UI确认均NOT_RUN或待用户评审。现有产品的FAIL／PARTIAL不被本次Demo修复或覆盖。

下一步仍是用户评审本候选；获准实施时再整体固定持久结构／跨域操作合同、相应验收及真实路径。B/C在链路补齐后按新范围推进。本轮没有开发产品，现有项目、会话和文件保持不动。

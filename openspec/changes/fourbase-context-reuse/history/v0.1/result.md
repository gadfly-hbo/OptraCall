# M4确认包准备记录

2026-11-03 · v0.1 · **规格／结构与独立内存Demo准备完成，完整冻结候选非作者限范围通过；M4产品未开发，待用户整体确认。**

## 授权与基线

用户：“接受这个限定例外，保留NOT_PROVED。继续推进M4，先准备spec和UI Demo给我确认，后续严格按开发流程执行。” 已将该接受追加M3.1记录，保留原NOT_PROVED、功能／职责复用限范围PASS及原报告身份；没有外推到旧M3缺口或后续流程。M4本轮仅文档、独立HTML与相称检查，不修改产品源码／测试／schema或运行数据。

本地分支`codex/fourbase-phase01-design`，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`，原WIP保留。`.local/fourbase-modules/m4/baseline.json`固定391源及接受前5份活动记录的原字节，M31原40候选／199证据交付回读匹配。M31旧交付manifest及两个非作者报告不重写；新的用户接受是后续记录，不把旧“未批准”证据抹掉。

## 本包范围

[spec](spec.md)、[6组完整决定](structure-decisions.md)、[复用核对](reuse-audit.md)、[UI审阅](ui-review.md)、[单文件Demo](../../../docs/prototypes/fourbase-m4-reuse-ui-demo.html)。完整主方案v1.2保持原字节；不另出第二整体方案。M4聚焦第二事项找回／准确读取／判断拒用和来源回查，M5–M8不提前。

两份只读现状调查已完成，核对Pi1.4.0与当前代码，证实Host跨worker只读port、精确人工decision target、模型可见正文与原生交付、旧历史open等差额；没有新记忆组件安装／模型实验。可选声明沿SDK原生工具结果，不扩M2 citation schema或新建正文库／全局上下文账；具体合同均待确认，不把研究建议当已经批准。

## 当前检查

| 项 | 状态 |
| --- | --- |
| spec／结构完整性及职责复用设计核对 | 作者及全新非作者已完成完整候选检查，**PASS_WITH_LIMITS：仅设计／结构／虚构原型**，无剩余阻断。产品实现、工程职责专项运行验收及用户确认均未因此通过 |
| HTML静态与真实浏览器 | 最终HTML `2f6287405cba810958ed6aaf63738ded9b50bffaeca4558c6dfc99c130b4df28`，66,005 bytes；脚本语法PASS。最终同源60项作者观察PASS（19核心＋33布局／补充＋8治理／UNKNOWN／storage），均为虚构内存。六组尺寸／主题及键盘点验，实际产品／Provider未接入 |
| 用户结构／UI确认 | 待确认，D01–D06未预填已批准 |
| 产品源码／测试／结构／SDK运行 | NOT_RUN，未实施；准备检查不等于产品TDD或功能验收 |
| Git／CI、安装、真实Provider／业务数据、服务／MacBook | 未执行，不在本轮授权 |

证据位于`.local/fourbase-modules/m4/`和`output/playwright/m4-confirmation/`。浏览器／工具／locator错误与真实Demo问题分别保留，不当产品RED；未来产品开发须对确定性动态路径逐切片留真实前置RED，不沿用M31例外。

## 最终原型身份与范围

HTML见上表；内联脚本SHA `dd19e03f9320985655b5fd538b71d043b40c240e861e998d3785c8a52faab277`。Demo把当时交付的原文／注记／治理快照与今天排除／失读分开；目录层面声明不升级成正文已提供，UNKNOWN不能新增收藏。作者最终18张场景图及root两张可视核对在`output/playwright/m4-confirmation/`；原file协议阻止、locator错名／硬编码receipt、过早观察notice／关键词fixture与CLI命令错误保留，不当产品FAIL或前置RED。

新建项目／任务沿原产品；本Demo以已有目标选择为主，新任务仅简化模拟原创建入口，不替代原产品完整流程。source hash变化、真实取消／并发／容量与真实SDK接线都留待确认后产品验收，不用原型内存模拟声称这些已通过。实际产品391源仍与M31最终字节一致，主方案v1.2、M2／M3／M31批准Demo、原研究与原报告保持原hash。未来开发严格逐切片留动态行为前置RED，不沿用M31例外。

## 非作者完整确认包复核与交付身份

最终审查包为`.local/fourbase-modules/m4/candidate-manifest-v02.json`，SHA `b2befecd962708c65ad68f4dbf4821e55dfad78cf7a6596647bb964eba2f61b7`：11份候选、59份冻结证据及391份产品源完整独立回读匹配。第一包原身份、notes并发补说明的首次hash漂移与恢复原字节回执保留；第二包只修正D02“每组50／组合最多100仍受共同预算”的量词并追加作者回执，没有产品／HTML变化。

独立报告`.local/fourbase-modules/m4/independent-review/final-review.md`，SHA `886be9d780bec80bddd54047010839bbe5e814ec37ff9db8b987196ea5c941a9`：**PASS_WITH_LIMITS**，仅规格完整性／实际复用依据／Host自治边界设计与虚构Demo。独立8组交互、键盘焦点、1440／390／320浅深与来源页布局、新历史当时／今天标签及UNKNOWN收藏守卫通过；源／证据完整核对，不以无图谱边代无调用。71项独立证据清单SHA `94cc2a35c98c68d81307a3d286e0e62c826bc84a7b2076b47138d9a1c7719939`。旧工具／locator错误和最初readback漂移均保留，不当产品FAIL或TDD。

原产品391源、M2／M3／M31批准Demo、主方案v1.2、原研究及M31固定报告保持原hash。只对本result及UI审阅说明的创建入口覆盖描述补最终事实，另作定点收尾回读；不沿旧PASS换掉本版身份。自动化浏览器均已关闭；`127.0.0.1:58719`仅静态Demo预览，供用户确认，不是产品Host服务或运行采用。

**下一步：请用户整体确认本spec v0.1、D01–D06及UI。推荐6项均A；确认后才按切片先行为RED→实现→真实链路及非作者复核。当前不启动M4产品开发、M5–M8、Git／CI或部署。**

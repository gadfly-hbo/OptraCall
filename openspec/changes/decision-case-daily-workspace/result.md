# 固化与外发准备记录

2026-11-27 · 当前仅为确认版规格／UI／任务包，不是产品实现结果。

## 目标与阶段清单

- [x] 核对用户最新确认、原型身份、最新 origin/main 和工程发单规范。
- [x] 审计 D01–D08 与已确认／后续范围，补齐原权威、关系／请求写入口、人工与 Agent 路径及 #148 协调。
- [x] 原样保存确认 UI v0.6，整理实施 spec、任务清单、演示说明和可复跑原型检查。
- [x] 完成确认包的一致性／引用／四原则及全新非作者复核，固定文件身份。
- [x] 提交并推送确认包至独立工作分支，核远端完整 SHA。
- [x] 查重后发布外发 Issue，绑定该提交 spec／任务／Demo，并读回目标账号、正文、版本与链接。

## 事实及边界

代码基线为 `4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`，发单前 fetch 的 origin/main 与之相同；原探索工作树和全部 WIP 保留。固化工作树为独立分支 `codex/decision-case-confirmed-dispatch`。

用户确认范围详见 [decisions.md](decisions.md)。本轮认为已确认范围没有阻塞发单的产品问题；未确认的实绩聚合、家庭权限、自动派单等不纳入。本次新 spec 是将已确认行为与现有合同转成实施任务，不将历史整份讨论稿改称全部获确认。

已查开放 Issue：没有相同 Decision Case 外发任务；目标管理修正 #148 有共享接口／文件风险，已在 spec 要求唯一写入归属和集成回归。发布身份核对为仓库所有者账号 `gadfly-hbo`；实际 PM Agent 为 Codex（Decision Case 模块）。

本次只编辑文档、冻结原型及其已有相称检查的可复跑副本；未修改 src、extensions、tests、依赖或 SDK，未启动真实模型、业务自动化或设备更新。既有 Demo 发布记录和最终用户 UI 确认与正式产品工程验收分别保留。

## 原型历史证据

确认 UI SHA-256：`adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`。原型最终 Root 检查 27/27、原行为检查 60/60；作者重叠 24/24，不叠加当不同覆盖。全新原型复核独立边界 13/13，并独立重跑上述入口；原候选自定义标题未转义 FAIL 后已修，续接来处／追加后回读缺口已修。

本包携带 Root 27 项的真实内联检查、[本次复跑回执](verification/prototype-check-receipt.json)、合成 v0.5 状态夹具及[原标题转义 FAIL](verification/title-xss-original-fail.json)，可跨环境复跑；此前本地完整日志在原工作树 `.local/case-home-intake-check/`、`.local/case-v6-independent-review/` 等，不把这些本地路径当已公开附件。原型静态／VM 通过不证明浏览器渲染或生产实现完成。

实际产品开发的全部任务保持 [tasks.md](tasks.md) 未完成；后续开发者的实际命令、候选身份、失败／未知和工程结果写入同一目录，并在外发 Issue 回执。

## 本次确认包复核

全新非作者 `/root/case_dispatch_independent_review` 在冻结核心文件上完成只读独立复核，结论通过，无必须修改项。完整审查覆盖 spec／任务／范围决定／演示说明／Demo／拟发 Issue 的一致性、四原则、原权威及必要真实接缝、#148 协调和公开材料；独立重跑自带 VM 27/27，另独立范围／关系／全局项目／空 Case／零任务／往返／无副作用／网络及引用检查 11/11，通过。见[完整复核回执](verification/dispatch-review.md)及[独立检查回执](verification/independent-check-receipt.json)。复核报告中的 `.local` 是原执行位置；本包回执与可复跑入口按 verification 文件归档，不把原临时路径冒充公开附件。

Root 的 UTF-8、相对引用、原型摘要与基本凭据模式扫描通过；产品代码／依赖没有变化，未为纯确认包运行全仓产品 CI 或将原型检查当正式 Host/Pi/UI 验收。本轮准备依工程规范做相称文档／原型检查。

spec／tasks／Demo 核心内容复核后保持不变；本记录、manifest 和发单收据只补发布元数据。确认包远端完整 SHA、Issue URL 及发布回读写入后续 `dispatch-receipt.md`，Issue 将绑定先推送的不可变确认包提交。

外发已完成：[Issue #149](https://github.com/gadfly-hbo/OptraCall/issues/149)，确认包提交 `5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2`；完整版本、作者及正文回读见 [dispatch-receipt.md](dispatch-receipt.md)。实施任务尚未领取／执行。

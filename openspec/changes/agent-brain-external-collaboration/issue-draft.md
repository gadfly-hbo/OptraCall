# 外发开发 Issue 草稿

**状态：未发布；等待用户确认最终 spec/执行清单/UI Demo。** `CONFIRMED_SHA` 必须在确认版推送并读回后替换。不得以本草稿为正式可领取工单。

建议标题：`[开发任务] Agent 大脑一期：GitHub 外派、WorkBuddy 本机执行与资产远端 MCP 闭环`

## 目标、范围与当前授权

PM Agent：Codex。用户已选择首期 GitHub＋资产 MCP 完整闭环、确认授权范围后自主推进、资产留实际 OptraCall 运行端，以及通用协议＋WorkBuddy 本机助手官方 API 首个适配。

【发布前填写用户对最终 spec、任务清单及 Demo 的确认记录。未确认时不发布。】

交付原 Task 内的外派工作记录与授权、一次有效 GitHub 发布/修订、可信领取与回传、WorkBuddy 本机助手触发与就绪测试、受保护资产 MCP、成果保全及原任务自动续接/核验/UI。飞书/邮箱完整外派协议、WorkBuddy 云任务、远端计算/Skill分发/资产正式写入不在本期。不能把已有四服务客户端当成已实现的对外 MCP 服务端。

允许修改：规格限定的 Host/Agent/外派/MCP/WorkBuddy薄适配/现有资产查询接缝、实际 UI、tests、必要最小边界检查与说明。沿 Interface v3、原 project-tasks owner、官方 Pi1.4.0/MCP SDK1.32.2。Codex负责Host/Agent/SDK技术接入及整合；其他领取者按同一Issue明确模块与移交责任，不绕过IN01–IN07。新依赖/SDK升级、真实账号或业务资料、部署/端口/服务切换均另核有效授权。

工程交付完成后由用户自行更新双端并配置运行采用。实号 WorkBuddy API＋Connector＋资产 MCP 联用、受保护入口与真实工作验收另记录；未通过完整测试的具体执行者配置不得展示“就绪”。

## 基线与设计依据

- 发单准备时 main：`4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`；【发布前重核最新 origin/main，必要整合并回到用户确认的设计范围】。
- 确认版提交：`CONFIRMED_SHA`；远端工作分支：`codex/agent-brain-external-collaboration`。
- [确认版 spec](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/spec.md)。
- [执行清单](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/tasks.md)、[用户决策](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/decisions.md)。
- [可点击 Demo HTML](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/ui-demo.html)，下载为 HTML 后浏览器离线打开；[演示说明](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/demo-guide.md)。全部为合成资料，不联网或操作真实业务。
- [公开组件与接缝核对](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/reuse-audit.md)、[官方接入依据与未验证项](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/integration-research.md)。
- 【发布前补充最终 spec/HTML 摘要、准备检查与非作者复核入口。】

## 验收与回执

以 spec 的 AB01–AB18 和 E01–E07 为工程验收，真实采用 E08 单列。

- [ ] 原六类合格任务内片段外派、一次范围授权、可缩小资产、原Task/Case/报告/草稿保留；受限profile不放权。
- [ ] work/revision级发布与触发去重、UNKNOWN只读核定、原子单人领取/租约、补充修订/迟到/取消不复活权限。
- [ ] 通用协议与官方WorkBuddy本机API适配；实号未联通保持未验证，离线/需许可清楚等待。
- [ ] 标准受保护远端MCP/认证、工作记录与资产只读权限分开；严格身份/显式企业/当前任务/精确版本/原资格交集，目录/正文/trace均拒越权。
- [ ] 外部成果保全与独立来源、实际资产引用和未验证/失败/UNKNOWN；原Agent核验并沿原工具形成成果，正式资产发布分开。
- [ ] 同owner新turn一次自动续接、busy/暂停/重启/配置变化/归档恢复正确；不重放模型、改owner或伪造native。
- [ ] 真实App UI/键盘/亮暗/1440-1024-390及原公共消费者兼容，原项目/会话/资产/文件保全。
- [ ] 先有有效RED/反例再实现；实际Host/Pi/标准MCP/TLS/OAuth/模拟供应商完整闭环，边界正反例及官方固定包核对。
- [ ] 最终非作者复核、实际PR head完整Check、获授权squash、准确main push Check、同Issue结案回执齐全。

领取方先核正式发布人/状态/最新正文评论、AGENTS/工程规范、原工作区和最新origin/main，在本Issue留言身份/实例/分支/完整基线并回读。只提交本单范围；回执包含远端完整SHA、实际完成的AB/E项目、命令/结果/证据、FAIL/UNKNOWN/跳过/NOT_RUN、兼容及回退。首次审核可退回一次，二审终审后的问题由PM接手；最终候选按包括PM在内全部作者之外的复核者检查。

PR/提交使用 `Refs #本单编号`，不使用合并自动关单关键字。PM在准确main push Check通过、回填工程证据与限制后关闭；不把部署、真实账号、专业质量或用户产品验收写成工程CI成功。

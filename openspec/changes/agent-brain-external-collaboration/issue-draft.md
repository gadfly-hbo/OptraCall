# 外发开发 Issue 草稿

v0.2 · 2026-11-28 · **未发布；等待用户整体确认更新后的 spec、任务清单和 UI Demo。** `CONFIRMED_SHA` 须在确认版推送并读回后替换，不能用本草稿领取。

建议标题：`[开发任务] Agent 大脑一期：原任务外派、WorkBuddy 本机执行与资产远端 MCP 闭环`

## 目标、范围与当前授权

PM Agent：Codex。沿用户 D01–D04：首期 GitHub＋资产 MCP 完整闭环、一次范围授权后自主、资产留原运行端、通用协议＋WorkBuddy 本机助手官方 API。四项方向决定不替代当前 v0.2 的设计确认。

【发布前填写用户对本版 spec／清单／Demo 的明确确认记录；未确认不发布。】

在最新 Decision Case 日常工作台中，由原项目 Task 按范围派出工作，完成唯一 GitHub 发布/修订、可信领取/回传、WorkBuddy本机API触发与就绪测试、受保护资产MCP、成果保全、同Task自动续接/Agent核验及原工具保存。入口沿首页继续工作→Decision Case项目与任务或全部项目→准确原Task，不另建任务域。Case保留四页签、事项/范围/草稿/来源/返回链；外派摘要只出现在原Task、其原项目准确Task行及真实关联Case的项目与任务行，不新增首页收件。

首页人的明确待回应与ProjectWork外部等待保持原权威，不把外部完成冒认取舍/原始观察回应，也不自动改变Case轮次、目标采纳、实绩、发布或经营效果。飞书/邮箱完整外派协议、WorkBuddy云任务、远端计算/Skill分发/正式资产写入不在本期；已有四服务连接保留。

允许修改：spec限定的Host/Agent外派、持久业务记录、收件/同owner续接、MCP/WorkBuddy薄适配、现有资产只读接缝，及真实App/Case/项目/原Task/设置相应组件、必要测试/最小边界检查/说明。Case/首页/目标权威仅复用并保护，不另写待办完成库或目标算法。沿Interface v3、project-tasks普通合格owner/profile、官方Pi1.4.0/MCP1.32.2；Codex负责Host/Agent/SDK技术接入及整合，分工在同Issue明确唯一写入者。新依赖/SDK升级、真实业务或账号、部署/端口/服务切换另核有效授权。

实际WorkBuddy API＋Connector＋资产MCP联用和受保护入口仍待真实采用验证；具体配置完整测试前不得显示就绪。工程隔离测试、真实账号、设备更新、专业质量和用户完整产品验收分别留证。

## 基线与设计依据

- 本轮 main：`74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`，含#150目标修正、#151日常工作台、#152 UI对齐及#153工程规范v1.17；本准备分支已合入。发布/领取/集成时再次核对最新origin/main并重验受影响范围。
- 确认版完整提交：`CONFIRMED_SHA`；工作分支：`codex/agent-brain-external-collaboration`。旧v0.1 e456aa5不是本版验收依据。
- 三个冻结基准：[spec](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/spec.md)、[任务清单](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/tasks.md)、[可点击Demo](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/ui-demo.html)。Demo下载为HTML后浏览器打开，全部合成且不联网；[演示说明](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/demo-guide.md)。
- [用户决策](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/decisions.md)、[main对齐](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/main-alignment.md)、[UI骨架/生产映射](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/ui-mapping.md)、[接缝复用](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/reuse-audit.md)、[官方接入依据/未验证](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/integration-research.md)。
- [准备逐项矩阵](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/preparation-matrix.md)、[实际准备结果](https://github.com/gadfly-hbo/OptraCall/blob/CONFIRMED_SHA/openspec/changes/agent-brain-external-collaboration/result.md)。准备复核只覆盖设计/合成原型，不能代替产品落地矩阵。
- 【发布前补齐三个冻结文件摘要、最终确认记录及v0.2非作者复核入口；不得残留占位。】

## 验收与回执

以spec AB01–AB18和E01–E07为工程验收，E08真实采用单列。逐项矩阵字段至少为「冻结基准版本/条目→预期→实际代码与真实入口/状态→截图或实跑证据→差异→结论」；全部spec条款、任务及Demo页面/状态均有映射，不能只抽查作者勾选项或以测试数量代替覆盖。

- [ ] 原六类合格Task内片段外派及一次范围授权，新日常工作台/Case四页签/全部项目/原Task导航、范围、来源、草稿和焦点保留；授权/回看列同一资源策略/额度/时效/未知费用，默认1work/3次API触发含修订/24h、较低策略优先，无批准策略不就绪，submitted/UNKNOWN/跨turn不重置额度；受限profile不放权。
- [ ] work/revision级发布与触发去重、UNKNOWN只读核定、原子领取/租约、补充/迟到/取消不复活权限；WorkBuddy账号游标准确关联、同连接单有效工作，人工聊天不入原Task/模型。
- [ ] 通用协议及官方WorkBuddy本机API适配；离线/外部需许可/未实号联通不假报就绪。
- [ ] 标准受保护MCP、工作记录与资产只读分权；身份/显式企业/任务/精确版本/原资格交集，目录/正文/trace拒越权，不写/执行资产。
- [ ] 文件字节/摘要/版本保全、独立外部来源/实际引用/FAIL/UNKNOWN；缺件不接受；Agent核验后沿原工具保存，不伪native报告。
- [ ] 同owner一次新turn续接；精确work/revision/delivery/hash/grant进原指纹/providedContext，外部文本非用户原话；busy/暂停/重启/配置/Case资格变化不重放模型或覆盖新稿。
- [ ] 外部接受不消解Case取舍/观察请求，不伪ProjectWork外部等待、不推进Case轮次/G/S/实绩/发布；原历史/文件/正式资产保全。
- [ ] UI编码前领取者亲自用浏览器渲染/操作Demo并查看截图，读取DOM/CSS骨架→生产组件/真实数据映射，在本Issue回执版本、页面/状态及证据；切片/返工同视口对照。
- [ ] 真实App界面/交互及1440/1024/390亮暗、键盘、焦点、长内容/窄屏复验；非作者亲自查看Demo和实际产品，完成三基准逐项矩阵及四原则复核，不以innerText/功能测试替代视觉验收。
- [ ] 先有有效RED/反例再实现；官方固定包、原公共消费者/第三合成接入、实际Host/Pi/标准MCP/TLS/OAuth/模拟供应商闭环与兼容反例通过。
- [ ] **开PR（含draft）前** PM实际向用户展示该候选真实产品截图及已知差异，记录运行源码/构建身份、环境/数据、页面/状态/视口/原图/复现入口和用户明确确认。Demo截图/设计确认、独立PASS及CI不能替代；未取得时不得开PR。
- [ ] 确认后若main/代码/构建/配置/输入变化影响UI，重核受影响截图/复核/用户确认；再核实际PR head全量Check、获授权squash、准确main push Check及同Issue结案回执。

领取前先核Open/正式发布人/最新正文评论、AGENTS/工程规范、工作树及最新origin/main，在本Issue回读「领取·实际Agent/实例·分支·完整基线」。回执列远端完整SHA、三个冻结基准及阅读/映射证据、全部AB/E完成矩阵、命令结果、产品截图/运行身份、用户截图确认已取得或待PM展示、FAIL/UNKNOWN/跳过/NOT_RUN、兼容/回退。允许按已有授权先提交推送任务分支并交接，截图确认门禁位于开PR前。

首次审核可退回一次；二审终审后PM在同Issue接手，按包括PM在内的全部作者以外的非作者复核。PR/提交使用`Refs #本单编号`，不使用合并自动关单关键字。准确main push Check和工程回填齐备后PM关单；不把部署、实号、专业质量或完整用户体验当作工程CI成功。

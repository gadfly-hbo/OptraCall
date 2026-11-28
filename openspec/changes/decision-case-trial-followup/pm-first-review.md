# Issue #154 PM 首次审核：退回返工

2026-11-28 · 审核者 PM Codex（未参与本候选产品实现）。**结论：FAIL，首次审核退回一次；尚未到用户截图确认/开 PR 阶段。**

受审分支 `work/antigravity/issue-154-decision-case-trial-followup`，候选 `d674deaa6c80e254bf97e2c4e022d3642f486eb1`；主线仍为 `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`。本报告分支只增加审核材料，不修改候选产品、测试、SDK、spec、任务勾选或 main。原领取及交回回执、正常 PASS 与原失败保持。

## FR01 / P1：持续心跳但漏终态时，Case Agent 仍无法自动收尾

这是已冻结 CF01/T02 的“漏终态”范围，不是新增功能或原 Mac 自然根因裁定。

复现使用候选真实 App/React/CSS、createHost、官方 Pi 1.4.0、Node 25.9.0、Chromium，以及隔离本地合成 Provider。只在浏览器控制 Case 观察响应：先交付由真实 Host 读取的合法初始 snapshot，再每 200ms 发 comment 心跳，省略后续业务事件并保持流打开。其它业务 HTTP 与 SDK 操作正常。Provider 延迟 3 秒返回普通回复，使提交后的首次 UI 回读确实经历 running，避免极速回复已由该次回读直接带回。没有真实模型、Mac、真实业务或凭据访问。

- 实际后端 `busy=false`，本轮 `lastRun.status=completed`。
- 完成后第 5/10/…/50 秒，UI 仍显示“正在回复…”，没有最终回复。50 秒时已收 267 次心跳、仅 1 条观察流，浏览器角色 GET 计数始终为 3。
- 50 秒后由探针仅关闭这条受控观察流，页面随即自动读回完整回复；后端仍 completed。故障观察期间仅一次用户 `action=messages` POST，零 stop/open/消息重放，零页面错误。
- [50 秒仍等待的真实产品图](evidence/pm-first-review/pm-cf01-heartbeats-missing-terminal.png) · [仅关闭观察流后恢复](evidence/pm-first-review/pm-cf01-after-forcing-eof.png) · [逐时点回执](evidence/pm-first-review/pm-cf01-heartbeats-receipt.json) · [探针日志](evidence/pm-first-review/cf01-missing-terminal.log)。这些是修复前故障诊断图，不是待用户批准的修复效果。

源码因果：`strategy-discussion-client.ts:54–75` 的 idle watchdog 被任何字节（包括心跳）持续重置；`BusinessRoleConversation.tsx:197–233` 的恢复 GET 要等 watch 结束/抛错才进入，正常运行中又依赖 run.settled/idle snapshot 触发 load。终态事件缺失但心跳持续时，这些恢复分支均不触发。原外部请求 receipt 回读以 keep 标记和 !view.busy 为前提，不能覆盖这次普通消息。`server.ts:2894–2895` 新增心跳不代表业务状态已核对。

修正要求：沿准确 owner/request 在明确有限期限内只读核对权威状态，不能只靠“有没有字节”代表终态观察健康；完成时恢复全文/终态，无法核对时准确提示并保留输入/回执。仍运行的真实 Agent 不得被强行判失败、超时取消或重放。切 owner/卸载/迟到读取、失败与 UNKNOWN 边界、共享业务角色及第三消费者须回归；恢复 GET 自身也须有有界失败/清理语义。禁止自动 stop/open/messages、借用别轮终态或建立第二套完成权威。

## FR02 / P2：补齐 T03/T04/T09 的实际覆盖，按真实证据修订交付表述

以下为未证覆盖，不直接判产品本身失败：

1. CF02 的浏览器段用 `route.fulfill` 一次性交付两段心跳后 EOF，检查提示/草稿，然后 unroute 并离开任务；没有执行“故障耗尽→显式重连→合法首帧→发送恢复且草稿保留”。新 CF02 单测覆盖心跳首帧期限和错误分类，但没有这条正向恢复路径。补实际 App/Host 回归，明确 GET idle 不解门禁、有效 snapshot 才恢复，且无自动 open/messages/stop。
2. CF03 浏览器段确实完成 Plan 创建/普通回复→原回复交回→保存取舍与理由保留；注释虽写 authorize/feedback，实际脚本没有执行原行动授权/反馈/历史回归。按 T04 补相称真实入口证据，不用注释或全量单测数替代这条用户链路。不要新增权限、自动授权或复制 G/S。
3. 在修复后固定新候选，按冻结 Demo、原 spec、本 spec/tasks 提供逐项非作者复核原文/矩阵及具体运行身份和图片。当前 implementation 只转述研究子代理会话和 CONDITIONAL_PASS；首审已经发现遗漏，不能沿用旧 PASS。若全量结果合计包含并发失败后的重跑，应区分每次运行、去重后的覆盖、cancelled/skip 和最终结果，不把重跑合计冒充唯一用例数。

## 本轮独立核实矩阵与边界

| 基准/条目 | 本轮核实 | 结论 |
| --- | --- | --- |
| 固定 Demo/spec/tasks 与允许范围 | Demo SHA256 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`、spec、package/lock 与冻结准备包一致；核对 T01 先浏览回执及实际差异 | 固定身份/范围 PASS；任务 T02/T09 不可判整体完成 |
| 冻结视觉输入 | 本轮用本地 HTTP + Chromium 实际查看冻结首页、总览、详情、取舍；查看候选真实 1440 局部引导及 390 详情，相关 DOM/CSS 骨架保持 | 已查局部无本单新增视觉阻塞；非所有状态全面 UI 验收 |
| 构建/SDK/边界 | 干净 d674dea 正式 build；独立复制未改官方依赖后 check:agent-sessions PASS、49 项定向/会话测试 49 PASS/0 fail/0 skip | 对上述命令 PASS；官方归档校验按脚本单列 |
| CF01/T02 | 提供的普通/短暂 clean EOF 脚本通过；持续心跳漏终态的延迟回复受控实跑失败 | FAIL / FR01 |
| CF02/T03 | 首帧期限与安全诊断单测通过，Plan 正常首发及 EOF 提示浏览器通过 | 有界首帧逻辑已证；显式恢复链路未证 / FR02 |
| CF03/T04 | 实际无项目引导→关联项目→Plan→交回→取舍，原理由保留 | 该段 PASS；原授权/反馈入口回归未证 / FR02 |
| CF04/T05 | 工具 schema/安全字段/存储负例定向测试通过；实际 Pi choose 先错后改成功 | 限本轮所跑范围 PASS；不扩大为所有模型/观察请求现场已验证 |
| CF05/T06 | 缺个人名称准确提示并聚焦，零 Goal/Case 创建写 POST，补全后可创建 | PASS |
| CF06/T07 | 创建第三 Case 后直接返回总览立即显示，无手动刷新 | 精确路径 PASS；其它分支以各自原测试/实际证据核，不泛称全通过 |
| CF07/T08 | 动作补项目名，按行作用域仅归档一个项目，Esc 焦点正确 | 局部 PASS；同名项目名称仍相同，定位须依赖所属行，不能称同名仅靠名称已区分 |
| 四原则 | 沿原 Host/Agent、Pi、请求/草稿/operation 权威；未见本单自动业务取舍或 SDK 改造；FR01 应继续沿原只读环境职责修复 | 设计边界保持；最终通过待修复后的受影响复核 |
| T09/T10 | 原四个旧浏览器脚本失败继续保留；未独立重跑全量 524 文件或原 Mac/GLM现场。对应远端分支尚无 PR | 不将作者全量摘要冒充本轮重跑；不批准开 PR/合并 |

证据[清单与哈希](evidence/pm-first-review/manifest.json)。正常 browser receipt 来自本轮执行提供的 E2E（仅改 Playwright/fixture 导入定位，产品源码无变）；该初次常规运行使用字节未改的借用依赖。随后复制为本候选内的实际未链接官方依赖，边界检查与 49 项再跑通过，FR01 延迟回复探针在该环境运行。最初借用 symlink 导致 SDK 路径检查失败、file:// 被浏览器策略拒绝、首版探针误用 /cases/:id/issues 导致 404，均为核查基础设施问题，保留在 .local/pm-review，不算产品 RED。极速回复的先行漏事件探针没有复现，亦保留；不能覆盖随后延迟回复下的确定失败。

Host 测试 fixture 的 health 不提供正式发布 runtime 身份；本诊断绑定干净候选、正式 dist build stamp、实际前端编译/Host cwd、原始脚本/截图和本回执。它不是发布服务截图确认或 Mac 产品采用。后续用户截图确认须重新绑定最终候选及实际运行身份，不沿用本组诊断图。

## 一次退回与下一步

在同一 #154 发布首次审核退回并释放首次领取。原领取方可按当前规范再次有效领取，整单修复 FR01 并补 FR02，推新 SHA/完整证据后二次交回，停止写入。二审后不再安排第三次领取，剩余由 PM 按既定流程接手。本轮没有产品修复、PR、合并、服务切换或设备操作。只有新候选通过后，PM 才展示其真实产品截图请求用户明确确认，再推进 T10。

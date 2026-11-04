# Codex → Qoder：任务内委派与原生联网接缝回执

2026-11-04更新：用户已授权合并main及更新本回执。[PR #30](https://github.com/gadfly-hbo/OptraCall/pull/30) 已squash合并，**main功能提交为 `f174ebbf7dfd1eb6cd63f4be4a9a013b166d51a9`**；其完整树与最终受检head `805029727e57b46fda4468b72d849a18ffb4bedf` 相同，实际head的 [Check #86](https://github.com/gadfly-hbo/OptraCall/actions/runs/41741303376) 已通过。main push检查与本回执纯文档收尾的最终SHA/CI按Git/Actions及交付收据逐提交核验，不能用PR检查冒充main检查。完整结果见 [result.md](result.md)。

**给Qoder的接入基线：** 使用包含上述功能提交及本回执的main；`codex/Host-Agent-Extension`长期保留，由Codex维护Host/Agent接缝。`deep-research` skill本体继续由Qoder在 `qoder/ext-skills` 实施；Qoder保留其WIP后按常规集成main，不依赖未合并的功能候选。本次Codex没有修改Qoder工作树，也未切换任何运行服务或操作MacBook。main代码已合入不表示现有产品服务已加载，运行采用仍另行授权。

## R1：subagent

产品工具名 `subagent`；可信注册与子 SDK 工厂在 `src/agent/project-session.ts`，数据发现/工具参数在 `src/agent/subagent.ts`。继续 SDK1.4.0、Interface v3及原 projectId/taskId owner/profile；前台子会话在同一父 Resource 中等待、取消、清理，不起独立Pi CLI或后台调度，不复制父聊天。继承父冻结模型/凭据/thinking和环境system指令，子不自行读取新的祖先context文件；角色正文另作为system指令提供。

| 资源 | 委派 | 子工具/文件 | 原生联网 |
| --- | --- | --- | --- |
| 普通项目任务 | 可用，需已加载skill提供角色 | 父已激活、可安全提供的原生read/bash/write/edit/grep/find/ls/codemode/tool_search等；角色仅收窄。原无硬沙箱合同保持 | 继承当前受支持Provider能力 |
| 受管 ordinary 项目任务 | 可用 | 同父protectedTools/scope；实际executor含间接codemode也受同一工具上限。内部调用ID命名空间隔离，stop/close/drain归父 | 模型侧原生搜索可用，不开放执行器直接网络或MCP |
| protected核算/返修、fixed-draft/text-only、专属业务workspace | 不提供 | 原策略保持 | 本期不注入 |

角色随 skill 放置，无需手工全局安装：

```text
extensions/analysis-assets/deep-research/
  SKILL.md
  agents/
    researcher.md
    reviewer.md
```

`SKILL.md` 使用 `name: deep-research`。角色示例：

```markdown
---
name: researcher
description: 调查公开来源并区分证据与未知。
---
按本次委派目标自主检索和分析，给出实际来源，缺口如实说明。
```

只从 SDK 本次实际已加载 skill 的 `baseDir/agents/*.md` 发现，名称为 `deep-research/researcher`；文件、目录须真实路径包含，越界链接/重复身份/非法定义拒绝，不按扫描顺序覆盖。允许name、description、可选tools及正文；不提供model/cwd/agentDir覆盖。工具清单可用逗号字符串或字符串数组；省略时继承当前可安全提供的能力。显式 `tools: [read, web_search]` 仅适用于父已有原生搜索的模型；`tools: [read]` 不授搜索。为跨当前模型使用，建议先省略tools，或在明确所需能力时收窄；不可用能力会明确失败，不切模型。

```json
{"agent":"deep-research/researcher","task":"核对本次公开问题并列实际来源"}
{"tasks":[{"agent":"deep-research/researcher","task":"调查甲"},{"agent":"deep-research/reviewer","task":"调查乙"}]}
{"chain":[{"agent":"deep-research/researcher","task":"调查"},{"agent":"deep-research/reviewer","task":"复核以下材料：{previous}"}]}
```

三种形态互斥；parallel/chain本次单工具批次1–8项。每项回传 `agent/outcome/text`，outcome区分completed/failed/cancelled；chain仅在前项completed时继续。一个分支失败仍等待其余已启动分支收尾，空结果/丢失执行结果不能伪记完成。子可读写权限来自父环境；不继承任意用户执行扩展、产品MCP/推演工具或递归subagent。子SDK逐轮历史不独立持久化，父工具回执保存派发与结果，日志经父脱敏出口。清理未知保持原公共owner busy，不能开始下一轮，只允许显式close重试清理。

已认真比较用户指定 [pi-subagents](https://pi.dev/packages/pi-subagents) 的0.84.0前台SDK接口；该包确有成熟前台能力，但其公开接缝不直接接本产品内存ModelRuntime和受管工具实例，整包还需额外Host桥。本期未安装整包，未把示例CLI的缺点推广到该包；比较及后续可复用上游hook见 [研究](pi-subagents-research.md)。

## R2：现有模型原生web_search

此前“无工具会话自称不能联网”不足以判断能力。原配置五模型各一次探针中，四个返回真实结构化检索结果：

| 当前模型/线路 | 本期接线 |
| --- | --- |
| MiniMax-M3 / MiniMax-M3.1-Flash，现有Anthropic端点 | Provider服务端 `web_search_20250305`，工具名 `web_search`；保留原始搜索块，pause_turn由SDK同一生命周期自然续接 |
| mimo-v2.6-pro / mimo-v2.6-flash，现有token-plan-cn端点 | Provider原生 `{type:"web_search",max_keyword:3,force_search:false,limit:1}`，Agent决定调用；保留annotations来源与专用搜索usage |
| deepseek-flash，现有Chat Completions端点 | 历史探索声明422，用户已明确不再测试；不注入、不自动切协议/端点或另接搜索服务，Agent须如实说明当前未接通能力 |

联网是Provider原生工具，不是可由本地 `executeTool` 调用的function或MCP；在实际模型请求中与函数工具并存。skill应让Agent按目标自主使用 `web_search`，无需在Host规定研究阶段或固定调用顺序。本期没有独立 `web_fetch` 工具；普通任务原有bash等能力并不因此改变，受管执行器也不新增网络权限。

请求和来源发往当前所选模型Provider，沿现有Host凭据通路，不给skill/角色文件密钥，不跨用其他Provider凭据。原生搜索可能另计费；SDK token/成本估计不等于供应商结算，当前结算UNKNOWN。源URL仅从Provider结构化回执取得，正文自述链接不伪造为搜索证据；显示来源不等于内容已专业核实。

真实样例与限制必须一起保留：首次产品MiMo保存3条结构化来源，但对版本/许可问题诚实说明不足；MiniMax检索66来源并自然续接，90秒内未最终答。修复后的新MiMo公开问题又在60秒截止取消、完整来源未证实。原URL回读51个200、17个403、1个404，不能只保留成功页。这些均见 [首次产品记录](product-live-validation.md) 和 [后续记录](product-live-v2-validation.md)，不当全部模型或完整产品问答验收。

用户后续明确“不再测试DeepSeek”，仅重测四个原MiniMax/MiMo配置。本轮新问题中，**MiniMax M3及M3.1 Flash均正确回答Python官方最新稳定版本与发布日期，并有本次可核验官方来源；两者150字格式仍FAIL。MiMo Pro把旧版本当最新，MiMo Flash识别正确版本但诚实说明日期不足。** 四项均正常结束，47个结构化URL回读46×200/1×403；MiniMax中间搜索工具错误仍保留。详见 [重测记录](product-live-retest-validation.md)。这补足两项MiniMax在该问题的核心事实闭环，不能外推MiMo稳定正确、旧问题通过、格式通过或服务已采用；没有为skill硬编码研究流程或替模型补答案。

M3另有附带博客发布日期误述（26日误称与25日发行同日），不记全文全对。包含150字格式的先验全条件判定仍为0/4，[非作者原报告](product-live-retest-review.md)及原文/投影长度均保留。

完整工程检查、非作者原发现及修复增量见 [result.md](result.md)。本回执已明确main功能提交，Qoder可以依本契约开展skill实现及适用合成验证：角色随skill分发、仅通过 `subagent` 参数调用，不自行新建Runtime或读取凭据。真实模型/计费、数据及运行采用范围按各自有效授权，不能从本次合并推导额外许可；本回执不以MiMo内容失败、格式FAIL或旧未完成问题为通过。

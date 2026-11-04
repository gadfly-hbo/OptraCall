# v2 修复后新增公开问题：有限真实路径验证

日期：2026-11-04（Asia/Shanghai）。本次在 v2 修复后，以一个新的深圳天气公开问题补充实际产品入口证据；**不是此前 pi-subagents 版本问题的重评**。此前 MiniMax 90 秒取消、MiMo 答案不足及 v1 来源保存结果仍留在 [原记录](product-live-validation.md)，不回填为本候选通过。

## 固定条件

沿生产 `src/agent/project-runtime.ts` 的 `ProjectAgent` 和本工作树实际 `scripts/project-entry.mjs`，使用同一已有配置 `mimo-v26-flash` / revision 2：Provider `xiaomi-token-plan-cn`、API `openai-completions`、model `mimo-v2.6-flash`、base URL `https://token-plan-cn.xiaomimimo.com/v1`。没有改变模型、端点、原配置/凭据、SDK maxTokens、思考档位或 SDK 模型注册。

独立新根为 `.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/`，内含新 project 三目录、resources 与 native。原 `~/.optracall` 配置/密钥只读入内存；测试 resources 单独关闭 retry 与 cache warming。测试可信扩展在 `before_agent_start` 清空本地工具，并后备拒绝任何 `tool_call`；**这是验证隔离措施，不是产品默认行为**。未调用本地 read/bash/write/subagent，也未切换服务、操作 MacBook 或 Git。

本次唯一提问：

> 请用本次原生联网检索，核对北京时间今天2026-11-04深圳天气信息，给来源机构、该信息适用日期和至少一个实际来源URL；结果不是今天或证据不足必须直说，不编造。无需数值计算。

## 实际结果：取消，未取得完整结构化来源

北京时间 **00:33:42–00:34:42**，60 秒截止生效，operation 返回 `cancelled`，随后 close 正常完成。仅 **1 次 HTTP POST** 到原 `/v1/chat/completions`，HTTP200；`retryCount:0`，没有重新派发或换模型。

SDK 实际版本为 `1.4.0`；snapshot 的 nativeSearch 为 `mimo`、retry 为 false，本地 active tools 为 `[]`，本地工具请求/执行均为 0。该记录说明最终 v2 接线确实走到原 Provider，但 **HTTP200 不能证明本问题的完整联网验收通过**。

截止时已收到一段未完成的天气回答，包含来源机构、日期和链接文字；但取消后的最终 snapshot/native **没有 `optracallNativeSearch` 回执，保留的结构化 sources 为 0，搜索专用 usage 缺失**。因此不能拿部分回答中的链接冒充本次实际检索来源，也不能核定其天气内容/适用日期正确。供应商最终用量/结算费用未知，取消消息中的 SDK 零用量不能写成免费。

独立 URL 读回记为 **NOT_RUN_NO_STRUCTURED_SOURCES**：无实际结构化 URL 可逐条核验，没有从模型文字凑来源或另做检索补答案。详见 [读回状态](../../../.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/url-readback/results.json)。本次失败/取消后按边界停止，不自动补跑。

## 源码身份与证据

开始前冻结五个相关源码 SHA-256，调用及 close 后再次比较，**五项均一致**。这固定的是本次调用的 v2 身份；随后任何源码修正均构成后续候选，不能把本次结果称为对后续代码的完整实测。

| 文件 | 本次 SHA-256 |
| --- | --- |
| `src/agent/project-runtime.ts` | `e4a113fb02a65a8e9fdae016237d7b661de8ad8e2a6628a36b5f992256c63a62` |
| `src/agent/project-session.ts` | `7052d2dd022f8b2538064463412766048f9c521a70cf1302d50f3055feeef8a7` |
| `src/agent/runtime.ts` | `2b699441740e7826c0196370068f05005fdc523ee215cafb981b149053f003fb` |
| `src/agent/native-search.ts` | `d94d1972c9f69b8d1598da8071c592800805bd84227bb5a60092d54c15629aee` |
| `src/agent/subagent.ts` | `70b26298ed4e3860899ecacfd8a6b7cee8bfff8c91571a8803bfdbb661753c4e` |

证据索引：

- [开始身份](../../../.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/identity.json)、[前后源码比较](../../../.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/source-comparison.json)。
- 模型目录内 [result](../../../.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/mimo-v26-flash/result.json)、[snapshot](../../../.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/mimo-v26-flash/snapshot.json)、`events.json`、`observations.jsonl`、`native/`；配置副本不含密钥，HTTP 观察只存 method/origin/path/status，不存 headers 或完整请求。
- [最终密钥扫描](../../../.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/final-secret-scan.json) 检查实际 key 的 raw/JSON escaped/URL encoded/base64/base64url 去重变体，0 命中；[文件摘要](../../../.local/task-agent-capabilities/product-live-v2/run-2026-11-03T16-33-42-246Z/manifest.json) 保留原现场身份。

测试观察扩展的 `before_provider_request.toolTypes:[]` 位于产品原生搜索适配之前，只说明本地工具清空，不能据此判定最终线上未声明 native search。本次也没有完整供应商结构化来源可反向证明搜索成功；结论保持 **CANCELLED / 完整联网结果 NOT_PROVED**。

未做新的 MiniMax 调用、其他模型、子 Agent、多角色、受管/受保护任务、UI、账单或用户产品验收。本记录为验证作者材料，不能代替非作者复核。

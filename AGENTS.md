# OptraCall 工程入口

开始任务、修改规范或准备交付时，先读[工程规范](docs/engineering-workflow.md)。它是开发流程的唯一详细来源；本文件和工具专属入口只维护必读条件、关键警示及同源指针。以当前明确用户决定和任务有效授权为准。

本项目遵循四点产品原则：**Host 管环境、Agent 自主执行、优先复用 Pi 已有能力、减少人的操作**。设计、开发、验收分别执行[职责及复用规则](docs/engineering-workflow.md#四点产品原则)、[前置检查](docs/engineering-workflow.md#设计确认与四原则前置检查)和[专项最终检查](docs/engineering-workflow.md#host-与-agent-职责边界及复用检查)。

**严重验收事故警示（2026-11-28）。** Issue #149／PR #151 工程结案后，用户报告实际 UI 与冻结 Demo 完全不一致，并指出重复发生；PM 承认审核遗漏。测试、独立复核和 CI 的总 PASS 不能替代冻结 UI 一致性证据。保留原候选、旧结论及后续更正，详细经过见[历史索引](docs/engineering-workflow-history.md#严重验收事故)。

有冻结 Demo 的 UI 工作，编码前须完成[浏览器实际阅读、DOM/CSS 骨架及生产映射](docs/engineering-workflow.md#领取方的冻结-ui-demo-阅读与开发要求)；有 UI 影响的交付，按[逐项复核与 PR 前截图确认](docs/engineering-workflow.md#冻结基准逐项复核与-pr-前截图确认)执行。门禁在开 PR 前（含 draft），已获授权的任务分支提交、推送和交接可先行。

按任务触发以下必读入口：

| 任务涉及 | 开始受影响工作前读取 |
| --- | --- |
| 任意实际变更、排查中新发现问题、收尾 | [任务目标清单与范围管理](docs/engineering-workflow.md#任务目标执行清单与范围管理) |
| 发单、领取、返工、接手、交付 | [GitHub 共享流程](docs/engineering-workflow.md#github-开发任务外发与交付)，核对最新 origin/main、工单决定和候选写入归属 |
| SDK、依赖或 Pi 适配 | [官方 Pi 来源与版本约束](docs/engineering-workflow.md#官方-pi-sdk-来源与版本约束)及[升级流程](docs/engineering-workflow.md#pi-sdk-升级流程) |
| Semantica 接入、依赖、适配或升级 | [官方组件规则](docs/engineering-workflow.md#semantica-官方组件来源与版本约束)及[资产兼容／回退](docs/engineering-workflow.md#semantica-升级验证与回退) |
| Agent 交互、SDK、会话启停／恢复、模型配置或插件接入 | 工程规范的[IN01–IN07](docs/engineering-workflow.md#统一会话接入规范当前interface-v3兼容v1v2业务子集)及[统一会话接入说明](docs/agent-session-integration.md)，记录 Interface、owner/profile 和验收范围 |
| 分析类 Skill 本体、随包参考资料、脚本或模板 | [分析类 Skill 编写规范](docs/分析类Skill编写规范.md) |
| 修改 Skill 测评信息展示（包括纯前端、目录及元信息展示） | [Skill 测评信息统一展示规范](docs/skill-evaluation-display.md) |
| MacBook Qoder 反馈项目规则、反馈整理或规范副本同步 | [MacBook 端 Qoder 整理与提交](docs/engineering-workflow.md#macbook-端-qoder-整理与提交)，按该节核对绝对路径及来源身份 |
| 维护已有模块、处理旧失败或兼容问题 | [维护导航](docs/engineering-workflow-history.md#维护导航)，按模块读取规格、结果、后续验证及未解决限制 |
| 产品方向、运行时或插件责任边界 | [产品讨论稿 v0.4](docs/OptraCall_产品讨论稿_v0.4.md)及工程规范第 2 节 |
| 交接证据、归档或结束临时环境 | [证据与进度](docs/engineering-workflow.md#8-证据与进度)，确认持久副本和接收方实际访问情况 |

项目是共享工作空间，任务在项目内创建，项目的真实默认目录为 `010_draw`、`020_clean`、`060_reports`。分析不读取 010 数据使用系统提示词软约束，不据此宣称敏感数据隔离；Host 不猜测最终报告。项目／任务、归档及旧会话迁移的维护边界按维护导航读取原合同。

历史任务的授权、候选、FAIL／UNKNOWN／NOT_PROVED 及限定接受保留在[历史索引](docs/engineering-workflow-history.md)与原变更记录。历史文字中的“当前”“第4项”“上一轮”等不授予本任务权限。规则建立、工程合并、设备运行采用与用户产品验收分别核对实际证据。

<!-- codebase-memory-mcp:start -->
# Codebase Knowledge Graph (codebase-memory-mcp)

This project uses codebase-memory-mcp to maintain a knowledge graph of the codebase.
ALWAYS prefer MCP graph tools over grep/glob/file-search for code discovery.
Run `index_repository` first when code exists and the project is not indexed.

## Priority Order
1. `search_graph` — find functions, classes, routes, variables by pattern
2. `trace_path` — trace who calls a function or what it calls
3. `get_code_snippet` — read specific function/class source code
4. `query_graph` — run Cypher queries for complex patterns
5. `get_architecture` — high-level project summary

## When to fall back to grep/glob
- Searching for string literals, error messages, config values
- Searching non-code files (Dockerfiles, shell scripts, configs)
- When MCP tools return insufficient results

## Examples
- Find a handler: `search_graph(name_pattern=".*OrderHandler.*")`
- Who calls it: `trace_path(function_name="OrderHandler", direction="inbound")`
- Read source: `get_code_snippet(qualified_name="pkg/orders.OrderHandler")`
<!-- codebase-memory-mcp:end -->

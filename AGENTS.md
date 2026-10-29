# OptraCall 工程入口

开始任务、修改规范或准备交付时，先读 [工程规范](docs/engineering-workflow.md)；涉及产品方向、运行时或插件责任边界时，再读 [产品讨论稿 v0.2](docs/OptraCall_产品讨论稿_v0.2.md)。工程规范是开发流程的唯一详细来源，工具专属入口应引用它。

当前变更为 [project-tasks-and-archive](openspec/changes/project-tasks-and-archive/spec.md)，用户已整体确认[结构方案](docs/project-tasks-and-archive.md)D01–D08，并通过本轮真实模型多任务验收。模型过程偏离保留观察，不额外增加Host拦截。最新授权为合并PR #1、安全快进本地main，以及一次性线下清除已核定的测试项目／会话／数据；保留源码、配置凭据及必要验收／交付证据。具体范围和实际结果见[结果记录](openspec/changes/project-tasks-and-archive/result.md)，不扩展真实业务分析或MacBook操作。

原 [first-chat-mvp](openspec/changes/first-chat-mvp/spec.md)已完成本地／独立检查并推送PR，原证据保留；用户对产品的后续修正由当前变更承接，不改写旧阶段结论。

本批次四项完成前的Git／CI暂缓期已结束，现按用户确认统一交付；一般Git与CI规则见工程规范。后续修改先核对实际分支、WIP和固定输入，不覆盖本地证据或自动重放中断任务。本轮合并按最新用户明确授权执行；安装发布和MacBook同步仍分别处理，不从推送或合并推导授权。

第4项允许持久保存五模型配置／凭据、定向读取本机Pi和SSH读取MacBook Pi指定MiMo凭据，经前端同一保存／导入入口配置；允许真实项目、上传、原生SDK多轮及完整macOS工具／bash／Python、用户安装原生扩展／skills／MCP的接入能力。只用合成数据验收，不代装数据分析skill。Host管环境，Agent管分析，不自建推理循环或Host补计算。

项目是共享工作空间，任务只能在项目内创建；任务独立会话／草稿／运行状态，三目录由项目共享。产品界面支持项目重命名、归档／恢复，不提供删除入口；本次工程测试数据清理不改变该产品规则。归档只读且不自动停止运行，先满足已确认的空闲准入。schema2迁移保留旧原生JSONL路径／字节及父会话引用；具体字段和恢复规则以当前结构方案为准。

真实默认目录严格为 `010_draw`、`020_clean`、`060_reports`。用户已撤下强制原件禁读沙箱／工具拦截，改为系统提示词软约束“分析不读取010中的数据”，使用用户020资料，过程输出默认020、最终报告060；前端提示不提供敏感数据隔离，勿放敏感数据。Host不猜测最终报告。第3项内存／空工具约束只代表历史阶段，不覆盖后续已确认范围。

Codex 和 Qoder 均遵守工程规范；每次执行以已授权范围和实际证据为准。历史 v0.1 及 JuanerAI 参考资料不覆盖本项目最新确认，也不授予旧任务权限。

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

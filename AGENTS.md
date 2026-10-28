# OptraCall 工程入口

开始任务、修改规范或准备交付时，先读 [工程规范](docs/engineering-workflow.md)；涉及产品方向、运行时或插件责任边界时，再读 [产品讨论稿 v0.2](docs/OptraCall_产品讨论稿_v0.2.md)。工程规范是开发流程的唯一详细来源，工具专属入口应引用它。

当前阶段仅授权仓库初始化、讨论稿与规范更新、首次提交和推送。产品功能开发尚未启动，后续以用户明确的新任务为准。初始化完成不自动授权安装产品依赖、创建应用或持久化结构、访问业务数据或调用产品模型。

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

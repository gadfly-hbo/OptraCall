# OptraCall 工程入口

开始任务、修改规范或准备交付时，先读 [工程规范](docs/engineering-workflow.md)；涉及产品方向、运行时或插件责任边界时，再读 [产品讨论稿 v0.2](docs/OptraCall_产品讨论稿_v0.2.md)。工程规范是开发流程的唯一详细来源，工具专属入口应引用它。

涉及Agent交互、SDK接入、会话启停/恢复、模型配置或插件接入的变更，开始前必须读取工程规范的IN01–IN07及[统一会话接入说明](docs/agent-session-integration.md)，在本变更规格记录Interface版本、owner/profile和验收范围。Codex、Qoder共用这些规则；工具入口只引用同一来源。

当前变更为[业务语义增强与独立核算 Agent 一期](openspec/changes/business-semantics-verification/spec.md)：用户已确认方案v0.1 SV01–SV12，授权必要增强、合成资料真实模型对照、兼容及联合回归、非作者复核和Git/CI后合并main，合并前更新main。复用原RAP/SAP/Case、统一Pi和会话入口；新核算只核固定输入、先独立计算后对照，不重建IR或固定方法库。接入与使用见[核算说明](docs/verification-agent-integration.md)，实际结果见[记录](openspec/changes/business-semantics-verification/result.md)。保留项目/会话/文件，不自动切换服务或操作MacBook。

**当前停止线：** 真实模型作者修订破坏隔离合成项目原件，完整SV11保全验收FAIL，禁止合并main或切换服务。实际既有资料最终逐项比较未变；工程检查通过不关闭该P1。仅以草稿PR保留候选和失败证据；[修订权限收尾建议](docs/verification-revision-preservation-followup.md)尚待用户确认，不授权继续模型试跑、恢复事故原件或调整权限。

上一增量[工程可靠性收尾](openspec/changes/engineering-reliability/result.md)证据保留。原[Extension正确性建议](docs/extension-correctness-proposal.md)作为历史讨论，由用户已确认的SV01–SV12替代，不按旧EC清单开发。

[统一会话接入一期](openspec/changes/unified-session-management-phase1/result.md)已交付，共用接口与少量实现、owner状态和业务策略分开。本次继续遵守同源接入规范。

上一轮[requirements-flexibility](openspec/changes/requirements-flexibility/result.md)允许未确认框架草稿，取消澄清/假设凑数，支持描述性分析不引用假设，并补同会话一次有限格式修正；保留其正式发布、送入和兼容回退边界。

上一轮[requirements-reliability](openspec/changes/requirements-reliability/result.md)已修复目标项目／发布版本选择、真实回答编辑、模型切换和会话隔离；涉及会话关闭或请求重试时，继续核对其归属与legacy回执兼容边界。

[需求梳理初始实现](openspec/changes/requirements-elaboration/spec.md)为4-Stage软门禁、独立插件会话走统一Runtime、RAP 0.2及显式送入。A路线泛化由Qoder实施；原[交付证据](openspec/changes/requirements-elaboration/result.md)保留，本轮受影响接缝检查另记于可靠性结果。

上一变更为 [Case一期](openspec/changes/decision-case/spec.md)（已合并 PR #4）及其后的 [macbook-trial-delivery](openspec/changes/macbook-trial-delivery/spec.md) 单向试用交付；各自的结果与授权范围保留在对应记录中。

[项目多任务变更](openspec/changes/project-tasks-and-archive/result.md)已完成用户验收、PR #1合并及核定测试数据清理。模型过程偏离保留观察，不额外增加Host拦截。原 [first-chat-mvp](openspec/changes/first-chat-mvp/result.md)证据保留；旧四项完成前的Git／CI暂缓期已结束。后续执行核对实际分支、WIP和固定输入，Git／CI、安装和用户验收分别报告，不覆盖证据或自动重放中断任务。

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

# OptraCall MCP 连接器接入标准 v1

2026-11-03 · 随首个连接器 [trade-area-mcp](../extensions/connectors/trade-area-mcp/README.md) 建立；规格依据[商圈/天气 MCP 连接器能力承接讨论稿](商圈天气MCP连接器能力承接产品讨论稿_v0.1.md)（D1–D13）。后续连接器（如天气）复用本标准；标准修订随相应变更记录，不在单个连接器内私设例外。工程规范（IN01–IN07、职责边界检查）优先于本文。

## 1. 定位与原则

连接器 = `extensions/connectors/<connector-id>/` 下的一等扩展，向项目任务 Agent 提供某外部/本地数据域的**只读查询工具**。原则：

- **Host 管环境**：注册、任务级启用、出境白名单、凭据解析、数据落位；
- **Agent 自主**：何时查询、查什么、如何组合与解读由 Agent 决定，无逐调用确认门槛（出境与权限边界除外）、无步骤编排；
- **能力注入不是流程编排**：工具只返回带版本的事实与确定性计算，不返回业务结论；
- **可推导不设工具**：能由既有工具组合完成的能力（如多对象对比）不单设工具；
- 复用统一 Runtime：经 pi SDK 既有 MCP 缝隙注入，不新建会话域/owner/profile，不建平行 Runtime。

## 2. 目录与清单

```
extensions/connectors/<id>/
├── connector.json   # 清单（下方 schema v1）
├── server/          # MCP server 实现（stdio 入口 + 工具定义 + 存储/适配层；v1 允许平铺在包根）
├── scripts/         # 数据导入等运维脚本
├── data/            # 小型随仓固定资源（黄金样例等）；大体量经营数据不进公开仓
└── README.md        # 接入说明：任务、输入输出、数据与版本、权限与出口、测试、启停
```

`connector.json`（schemaVersion 1）：

| 字段 | 约定 |
| --- | --- |
| `id` / `name` / `version` | kebab-case id（即注册 server 名，工具全名 `mcp__<id 去连字符>__<tool>`）；name 供能力目录 |
| `kind` | `local-data`（本机数据快照）或 `remote-api`（外部 API 适配） |
| `transport` | v1 为 `{type:'stdio', command, args, env}`——pi SDK 1.4.0 的 `registerMcpServer` 仅支持 stdio/http 注册（2026-11-03 核对），无 in-process 注册；升级 SDK 后如支持可增补 |
| `egress` | 域名白名单数组；`local-data` 恒为 `[]`；`remote-api` 的白名单由 Host 侧强制执行，连接器无法自行扩大 |
| `credentials` | `none` 或 `referenced`（仅引用，Host 解析，连接器不接触明文） |
| `tools` | 工具名清单＋只读声明；`readOnlyHint` 如实标注且不作权限依据 |
| `data` | datasetId、落位 `<dataRoot>/connectors/<id>/`、更新策略（v1 一律 `explicit-reimport` 或按查询即时获取） |
| `standard` | 指回本文 |

## 3. 工具合同

- **少量、正交、只读**；无写入/副作用工具；批量参数设上限（防上下文爆量，如单次 ≤50 对象、分页 ≤100）。
- 工具 schema 用基础类型收口，精确约束（整数/上下限/枚举/已知键）在实现层校验——违规以 `isError` + 结构化信封返回而非协议错误，供 Agent 自主纠错。
- 错误信封：`{error:{code, message, detail?}}`，code ∈ `invalid_param` / `not_found` / `data_unavailable` / `capability_unsupported`（可按连接器扩展并 README 记录）。缺失/不完整**如实呈现，不填零、不造占位值**。
- 结果携带**版本身份**（local-data：数据快照 digest；remote-api：来源＋获取时间＋缓存时效），供引用溯源。
- 描述写明能力边界与诚实声明（如"情景推演非预测"“不产出结论”），激活分工不与其他连接器/skill 重叠抢激活。

## 4. 数据与版本（local-data）

- 快照式导入：源数据（ETL 产物等）→ 逐文件 SHA-256 清单 → 内容寻址 digest → 原子写 `snapshot.json`；导入前做**等价性/一致性核对**，不一致 fail-closed 拒绝导入。
- 快照不可变；更新＝显式重导新版，旧快照归档 `history/`；同源重导幂等 no-op。
- 数据仅存 `<dataRoot>/connectors/<id>/`；**公开仓不含经营数据**；已知脏值只记录不改数据。
- 派生计算（评分/聚合）实现为带版本标识的确定性引擎（同输入同输出，逐字节/逐值一致），黄金对照进长期测试。

## 5. Host 接缝（Codex 归属）

1. **会话注册**：经环境扩展 `pi.registerMcpServer({name: <id>, config: <connector.json transport>})` 注入普通任务（仅任务级显式开启后；对齐 sim-lab 修正后的接缝语义：仅空闲时切换，经公共生命周期释放旧资源）。受管执行、封闭资源、fixed-draft/text-only 任务不注入（沿用现有 `disabledBuiltinExtensions` 边界）。
2. **能力目录**："连接器"分区"已接入"条目（形态对齐 target-forecast 先例）＋ `openCatalogEntry` 导航到项目视图。
3. **数据落位**：分配 `<dataRoot>/connectors/<id>/`；导入后校验快照完整。
4. **出境强制**（remote-api）：传输层仅放行清单域；开启时一次性向用户说明出境内容（D12），不逐次确认。

Qoder 交付连接器本体（server/工具/适配/导入脚本/测试/README）与适用证据；接缝实施与主链路回归归 Codex。未经用户对具体变更直接指定，Qoder 不实施接缝（工程规范 v1.3 IN06）。

## 6. 测试要求

- 单元/合同测试随仓（`tests/<id>.test.ts`，`npm run check` 覆盖）：参数校验与信封、筛选/读取合同、等价性黄金、导入幂等与 fail-closed、无快照拒绝猜测。
- MCP 协议往返测试（in-memory transport）；交付前做 stdio 真实路径冒烟（JSON-RPC 握手＋各工具至少一次）。
- 真实数据导入报告（等价性计数、脏值清单）记入变更 result；真实模型任务端到端属验收阶段，另按授权。
- `npm run check` 全量通过（含 agent-session 边界检查）。

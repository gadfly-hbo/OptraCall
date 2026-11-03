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
| `id` / `name` / `version` | kebab-case id（即注册 server 名，SDK把非英数/下划线字符转换为下划线）；本例工具全名 `mcp__trade_area_mcp__tradearea_search` 等；name 供能力目录 |
| `kind` | `local-data`（本机数据快照）或 `remote-api`（外部 API 适配） |
| `transport` | v1 为 `{type:'stdio', command, args, env}`——pi SDK 1.4.0 的 `registerMcpServer` 仅支持 stdio/http 注册（2026-11-03 核对），无 in-process 注册；升级 SDK 后如支持可增补 |
| `egress` | 域名白名单数组；`local-data` 恒为 `[]`；`remote-api` 的白名单由 Host 侧强制执行，连接器无法自行扩大 |
| `credentials` | `none` 或 `referenced`（仅引用，Host 解析，连接器不接触明文） |
| `tools` | 工具名清单＋只读声明；`readOnlyHint` 如实标注且不作权限依据 |
| `data` | datasetId、清单明确的本机落位（本例 `<dataRoot>/connectors/trade-area/`，不从注册id猜路径）、更新策略（local-data 为 `explicit-reimport`） |
| `standard` | 指回本文 |

## 3. 工具合同

- **少量、正交、只读**；无写入/副作用工具；批量参数设上限（防上下文爆量，如单次 ≤50 对象、分页 ≤100）。
- 工具 schema 用基础类型收口；基础类型错误或缺少必需顶级字段可由 MCP SDK schema 校验拒绝，不保证进入工具回调。精确约束（整数/上下限/枚举/已知键、weights 四键完整性）在实现层校验，违规以 `isError` + 结构化信封返回，供 Agent 自主纠错。对象 schema 保留额外键后明确拒绝，不能用默认 strip 静默修正参数。
- 错误信封：`{error:{code, message, detail?}}`，code ∈ `invalid_param` / `not_found` / `data_unavailable` / `capability_unsupported`（可按连接器扩展并 README 记录）。缺失/不完整**如实呈现，不填零、不造占位值**。
- 结果携带**版本身份**（local-data：数据快照 digest；remote-api：来源＋获取时间＋缓存时效），供引用溯源。
- 描述写明能力边界与诚实声明（如"情景推演非预测"“不产出结论”），激活分工不与其他连接器/skill 重叠抢激活。

## 4. 数据与版本（local-data）

- 快照式导入：源数据（ETL 产物等）→ index/详情身份和完整性核对 → 逐文件 SHA-256 清单 → 内容寻址 digest；评分不一致或详情缺失/冲突 fail-closed。
- 本例 importerVersion 2 先把完整 manifest/index/details 写入 `versions/<完整digest>/`，独占导入锁下完成版本再原子发布根 `snapshot.json`；已存版本不覆盖，旧manifest另留history。旧v1平铺根只读兼容，首次更新保存完整旧版且不覆盖其平铺数据；数据布局及回退限制见变更[结构决定](../openspec/changes/trade-area-mcp/structure-decisions.md)。
- reader绑定首次所读manifest与完整版本目录，按需验证实际文件长度/哈希；同源重导也验证已存内容才返回幂等no-op，不用相同digest掩盖损坏。版本身份包括 sourceHead/generatedAt/total/engineVersion/importerVersion 和文件清单。
- 数据根按清单 `data.location` 明确分配，本例 `<dataRoot>/connectors/trade-area/`（不可从注册 id 猜路径）；**公开仓不含经营数据**；已知脏值只记录不改数据。
- 派生计算（评分/聚合）实现为带版本标识的确定性引擎（同输入同输出，逐字节/逐值一致），黄金对照进长期测试。本例 `engineVersion` 标识四因子业务数学合同，不是实现字节指纹；同公式的数值表示修正由源码提交/候选摘要区分，保留修正前反例，不声称全输入前后逐值等价。

## 5. Host 接缝（Codex 归属）

1. **会话注册**：实际SDK1.4.0 API为 `pi.registerMcpServer(name, config)`。Host使用当前Node绝对路径、可信codeRoot下server绝对入口和Host构造的数据根；env按SDK规则转义字面量美元符，command/args不套env模板。仅任务级显式开启后注册普通任务；空闲变化先经公共生命周期close再保存，新open/send重建。受管 ordinary/protected、fixed-draft/text-only 不注入；不新增域/profile/owner或Runtime。
2. **能力目录**："连接器"分区"已接入"条目（形态对齐 target-forecast 先例）＋ `openCatalogEntry` 导航到项目视图。
3. **数据落位**：按清单 `data.location` 分配，本例 `<dataRoot>/connectors/trade-area/`；导入后校验快照完整。
4. **出境强制**（remote-api）：传输层仅放行清单域；开启时一次性向用户说明出境内容（D12），不逐次确认。

5. **工具目录与配置边界**：本例server默认 `exposure:hidden`，仅三个确切名字以 `toolExposure:direct` 放行；配置文件的同保留namespace不能替换产品server或绕过任务开关，其他用户MCP保留。因SDK默认配置优先覆盖注册且未公开默认loader，唯一SDK导入面有锁定1.4.0的最小私有loader复用例外，理由/退出条件见[IN06记录](../openspec/changes/trade-area-mcp/spec.md#codex-接管补充2026-11-03)，须非作者专项复核；不新增任意动态loader白名单。
6. **可观测目录指纹**：利用SDK公开 `getAllTools` 和 `tool_call` hooks，完整三名目录首次就绪后固定其名称/描述/参数/exposure指纹。观察到变化或缺失后，本worker资源中的商圈调用持续拒绝，含codemode嵌套；目录改回或SDK reload不清冻，关闭重建资源才重新取基线。`before_agent_start`仅观测，不冒充可取消门禁。不把SDK适配缓存当完整raw `tools/list`，不声称检查与RPC原子、能撤回在途调用或发现未通知/未刷新变化。

stdio生命周期沿用SDK：普通stop取消当前请求、保留可复用server；公共close经既有 `runtime.dispose()` 等待MCP关闭。本例直接stdio子进程退出有实测，不把SDK默认close扩大为所有逃逸后代收尾证明；受管路径继续排除。local-data代码只读本机文件，不发网络请求；工具结果仍进入所选任务模型上下文。SDK stdio默认继承driver环境，不构成凭据或OS文件沙箱；无新增凭据配置。天气及remote-api白名单实施属后续独立变更，本次不宣称已完成。

Qoder 交付连接器本体（server/工具/适配/导入脚本/测试/README）与适用证据；接缝实施与主链路回归归 Codex。未经用户对具体变更直接指定，Qoder 不实施接缝（工程规范 v1.3 IN06）。

## 6. 测试要求

- 单元/合同测试随仓（`tests/<id>.test.ts`，`npm run check` 覆盖）：参数校验与信封、筛选/读取合同、等价性黄金、导入幂等与 fail-closed、无快照拒绝猜测。
- MCP 协议往返测试（in-memory transport）；交付前做 stdio 真实路径冒烟（JSON-RPC 握手＋各工具至少一次）。
- 真实数据导入报告（等价性计数、脏值清单）记入变更 result；真实模型任务端到端属验收阶段，另按授权。
- `npm run check` 全量通过（含 agent-session 边界检查）。

# 商圈数据连接器（trade-area-mcp）

OptraCall 首个 MCP 连接器（kind=local-data）：把已核定的中国商圈档案（2835 家，12 个分析维度＋15 个数值指标＋评级＋四因子选址评分）作为**本机不可变数据快照**，经 3 个只读 MCP 工具供给项目任务 Agent。按 [MCP 连接器接入标准 v1](../../../docs/mcp-connector-integration.md) 实现；数据契约承接 [trade-area 原仓](https://github.com/gadfly-hbo/trade-area)（HEAD `2ba41d2`）的 ETL 产物，原仓仍在精修期、暂不退役。

## 解决的任务

Agent 在项目任务中回答选址、商圈比较、区域覆盖类问题时，用工具查询结构化商圈档案：筛选候选（省市/评级/关键词/指标阈值）→ 读取完整档案（12 维度全文＋来源＋可信度）→ 按自定义权重重算选址评分。结果带数据版本身份，引用可溯源。**工具不产出选址结论**——判断由 Agent 基于档案与口径自行作出并说明。

## 工具

| 工具 | 职责 |
| --- | --- |
| `tradearea_search` | 筛选商圈摘要，分页（pageSize 1–100，默认 20）；支持 metrics 数值阈值（缺该指标值的商圈不入选） |
| `tradearea_detail` | 1–50 家商圈完整档案；多商圈对比由 Agent 组合多次调用（无对比工具） |
| `tradearea_score` | 四因子（客流/3公里人口/客群匹配/停车便利）加权评分；严格模式：权重>0 的因子缺失即 `score=null`，权重 0＝刻意排除 |

所有结果携带 `dataVersion`（datasetId/digest/generatedAt/total/sourceHead）；缺失字段＝未公开（无占位值），`inferred` 标记推断值。错误以 `isError` + `{error:{code,message,detail}}` 结构化信封返回（`invalid_param` / `not_found` / `data_unavailable`），供 Agent 自主纠错。

## 数据与版本

- 数据落位：`<dataRoot>/connectors/trade-area/`（`snapshot.json` + `index.json` + `details/s{N}.json`，约 21M）；**公开仓不含经营数据**。
- 导入：`node extensions/connectors/trade-area-mcp/scripts/import-data.mjs --source <原仓 public/data> --data-root <目标> --source-head <git HEAD>`。
  - 逐文件 SHA-256 清单＋内容寻址 digest；**评分等价性核对**（存储 score 必须与本仓评分端口重算一致，不一致 fail-closed 拒绝导入）；
  - 同源重导＝幂等 no-op；换源导入把旧 `snapshot.json` 归档到 `history/`；
  - 省份解析脏值只记录在导入报告（warnings.dirtyProvinces），不改数据。
- 评分数学承接原仓 `src/scoring/model.ts`（`optracall-tradearea-score-1`）；全量 2835 家默认权重分数与原仓 ETL 逐值一致（2026-11-03 实测，见变更 result）。

## 运行与接入

- stdio MCP server：`node extensions/connectors/trade-area-mcp/main.ts`（数据根来自 `TRADEAREA_DATA_ROOT` 或 `--data-root`，缺失即明确报错退出）。
- Host 注册（Codex 归属接缝）：经 pi SDK `registerMcpServer` 以 `connector.json` 所载 stdio 配置注入任务会话；受管执行/封闭资源任务不注入；任务级显式开启（讨论稿 D8）。
- 依赖：`@modelcontextprotocol/sdk`（MCP 协议）、`zod`（工具参数 schema）。无网络、无凭据（egress=none）。

## 测试与停用

- 单元/协议测试：`tests/trade-area-mcp.test.ts`（评分端口黄金对照、导入幂等与 fail-closed、筛选/详情/评分合同、结构化报错、MCP 协议 in-memory 往返、无快照拒绝猜测）。
- 随 `npm run check` 运行；另做过 stdio 真实数据冒烟（JSON-RPC 握手＋三工具）。
- 停用：Host 侧取消注册即可；删除数据＝删 `<dataRoot>/connectors/trade-area/` 目录（公开仓无数据残留）。

## 已知边界

- 只读、本机、无订阅刷新；数据更新＝显式重新导入新版（旧版留 `history/`）。
- 省份解析脏值原样保留在数据中（导入报告可查）；按脏值筛选自然不命中。
- 评分只输出分数与因子值，不解读优劣；`score=null` 表示数据不完整，不是低分。

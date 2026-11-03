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

所有结果携带 `dataVersion`（datasetId/digest/generatedAt/total/sourceRepo/sourceHead/engineVersion/importerVersion）；缺失字段＝未公开（无占位值），`inferred` 标记推断值。错误以 `isError` + `{error:{code,message,detail}}` 结构化信封返回（`invalid_param` / `not_found` / `data_unavailable`），供 Agent 自主纠错。province筛选须为已知省级全称，越界页及逆向/非有限数值区间明确报错；首个空结果页仍如实返回空。

## 数据与版本

- 数据落位：`<dataRoot>/connectors/trade-area/`，根 `snapshot.json` 指向由digest确定的完整 `versions/<digest>/`（每版manifest/index/details，约21M）；**公开仓不含经营数据**。importerVersion 2只改变保全/导入，不改变评分引擎数学。
- 导入：`node extensions/connectors/trade-area-mcp/scripts/import-data.mjs --source <原仓 public/data> --data-root <目标> --source-head <git HEAD>`。
  - 逐文件 SHA-256 清单＋内容寻址 digest；**评分等价性核对**（存储 score 必须与本仓评分端口重算一致，不一致 fail-closed 拒绝导入）；
  - 先核index/详情完整与一致、写完整不可变版本，再原子发布当前manifest；同源重导验证已存字节后幂等no-op。旧完整版本不覆盖，manifest另归档history；旧v1平铺根只读兼容，显式更新保留其完整数据；
  - 省份解析脏值只记录在导入报告（warnings.dirtyProvinces），不改数据。
- 评分数学承接原仓 `src/scoring/model.ts`（`optracall-tradearea-score-1`）；该 engineVersion 标识四因子业务数学合同，具体实现修订由 OptraCall 源码提交/候选摘要区分（不是实现字节指纹）。极端有限权重的数值溢出/下溢修复见变更 result；计算前对正权重按最大值同比归一化，避免有限权重溢出及subnormal乘积造成比例误差。全量 2835 家默认权重分数与原仓 ETL 逐值一致（2026-11-03 实测，见变更 result）。

## 运行与接入

- stdio MCP server：`node extensions/connectors/trade-area-mcp/main.ts`（数据根来自 `TRADEAREA_DATA_ROOT` 或 `--data-root`，缺失即明确报错退出）。
- Host 注册：经实际SDK `pi.registerMcpServer(name, config)` 与原项目任务公共生命周期接入。新建任务“任务能力”或会话内“Pi 能力与命令”中单独开启；仅空闲时切换，变化会关闭旧资源，下一次open/send生效，历史保留。受管 ordinary/protected、fixed-draft/text-only不注入。目录条目导航项目视图，版本行显示本机实际快照而非写死原型日期。
- 依赖：Node≥25、`@modelcontextprotocol/sdk`（MCP协议）、`zod`（工具参数schema），均随锁文件安装。连接器无网络请求、无需凭据；工具结果进入所选任务模型上下文，不能从本机计算推导整段对话零外发。SDK stdio继承driver环境，不是凭据/文件沙箱。

## 测试与停用

- 单元/协议测试：`tests/trade-area-mcp.test.ts`（评分端口黄金对照、导入幂等与 fail-closed、筛选/详情/评分合同、结构化报错、MCP 协议 in-memory 往返、无快照拒绝猜测）。
- 随 `npm run check` 运行。合成Provider经产品普通任务实际执行stdio三工具、多次详情组合；并覆盖缺省关闭、空闲切换、忙时拒绝、归档只读、native历史保全、实际stdio退出及受管/封闭排除。工具可观测目录变化的直接/嵌套、恢复及SDK reload冻结见session-guard永久回归。
- 停用：空闲时关闭任务能力开关，原生命周期关闭MCP资源；普通stop只取消当前请求并保留闲置连接。数据和旧版本继续保留，不随停用删除。SDK默认close不证明逃逸后代均退出，受管路径不因此采用MCP。

## 已知边界

- 只读、本机、无订阅刷新；数据更新＝显式重新导入新版，旧完整数据留versions、manifest留history。回退旧代码不保证理解v2布局，不用旧文件覆盖当前数据。
- 省份解析脏值原样保留（导入报告可查），不当合法省份筛选值；仍可按原ID读取，不臆造修正或丢弃商圈。
- 工具名白名单及SDK可观测适配目录指纹不是完整raw目录/原子RPC pin；已观察变化会冻结本资源直至核对后关闭重开。未通知、未刷新及检查至发送间变化存在SDK可见性局限，详见同源标准。
- 评分只输出分数与因子值，不解读优劣；`score=null` 表示某个启用因子缺失，或全部权重为0（没有启用因子）；均不等于低分。

工具错误边界：SDK schema 可直接拒绝基础类型错误及缺失必需顶级字段；进入工具实现的精确键、weights四键完整性、范围/分页等违规返回 `isError` 与 `invalid_param` 信封。额外键保留到校验后明确拒绝，不静默删除。

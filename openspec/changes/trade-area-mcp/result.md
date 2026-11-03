# 商圈数据 MCP 连接器 · 实施与验证记录

2026-11-03 · 分支 `qoder/data-mcps` · 状态：Qoder 侧连接器本体与标准 v1 已完成并本地验证；Host 接缝（Codex 归属）未实施，TA01/TA07 及真实模型验收待接缝集成后进行。

## 授权与流程

- 用户确认[讨论稿 D1–D13](../../../docs/商圈天气MCP连接器能力承接产品讨论稿_v0.1.md)与 [UI Demo](../../../docs/prototypes/connector-ui-demo.html) 后，2026-11-03 授权 Qoder 产品开发（AGENTS.md 当前授权段）；按 D9 商圈连接器先行奠基标准，天气连接器为后续独立变更。
- TDD：`tests/trade-area-mcp.test.ts` 先行（RED：模块缺失失败）→ 实现至 GREEN。过程中修正两处测试夹具缺陷（原始 metrics 未填、分片结构与真实契约不符），并修 4 处 tsc 严格类型错误；无跳过断言。

## 实施范围（实际交付物）

```
extensions/connectors/trade-area-mcp/
├── connector.json            # 标准清单 v1：stdio transport、egress=[]、credentials=none、3 工具
├── types.ts                  # 数据契约（承接原仓 src/types.ts @2ba41d2；含 KNOWN_PROVINCES）
├── scoring.ts                # 四因子评分端口（optracall-tradearea-score-1；数学承接原仓 model.ts）
├── store.ts                  # 只读查询层：懒加载、筛选/详情/评分、结构化信封（invalid_param/not_found/data_unavailable）
├── server.ts                 # McpServer + 3 工具（zod 基础类型收口，精确约束留 store 层走 isError 信封）
├── main.ts                   # stdio 入口（TRADEAREA_DATA_ROOT / --data-root，缺失明确退出）
├── import-data.ts            # 快照式导入：逐文件 SHA-256、内容寻址 digest、评分等价 fail-closed、幂等、history 归档、脏值报告
├── scripts/import-data.mjs   # CLI 包装
└── README.md
docs/mcp-connector-integration.md   # MCP 连接器接入标准 v1（TA09）
tests/trade-area-mcp.test.ts        # 10 项测试
package.json / package-lock.json    # 新增 @modelcontextprotocol/sdk@1.32.2、zod@4.6.7
```

实施核对事实：pi SDK 1.4.0 `registerMcpServer` 仅支持 stdio/http 注册（无 in-process），connector.json transport 定为 `stdio`；真实详情分片为 `DistrictDetail[]` 纯数组（合成夹具已按真实契约对齐）。

## 真实数据验证（2835 家全量）

- 参考数据来源：MacBook trade-area 原仓（HEAD `2ba41d2`）`public/data/` 经 ssh 只读拷贝至 `.local/trade-area-ref/`（21M，gitignore）。
- 导入命令：`node extensions/connectors/trade-area-mcp/scripts/import-data.mjs --source .local/trade-area-ref/public/data --data-root .local/trade-area-data-dev --source-head 2ba41d2`
- 结果：`imported`，total **2835**，分片 **57**，快照 digest `e9185d4e52c9c2788508284310efeb803610e8a9be9b4191fb48e9ac26e0d6fc`。
- **评分等价性：2835/2835 一致，0 不一致**（存储 score 与本仓评分端口逐值重算相等，含 null↔null）。
- 脏省份 12 条（如 `广场），福建省`、`用户位置为山东省`），导入报告完整记录，数据原样保留。
- `score=null` 共 96 家，与原仓"2739/2835 可评分"结论吻合。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `node --test tests/trade-area-mcp.test.ts` | **10/10 PASS**：评分黄金（子权重分摊/严格 null/权重 0 排除/舍入）、导入幂等+digest 变更+fail-closed、筛选/详情/评分合同、信封报错、MCP 协议 in-memory 往返（3 工具/只读标注/structuredContent/isError）、无快照 data_unavailable |
| stdio 真实路径冒烟 | PASS：子进程 JSON-RPC `initialize`＋`tools/list`＋三工具各一次（真实数据：湖州爱山广场 rating B score 46.9、13 维度档案、自定义权重 47.4、湖州市 trafficWeekday≥1 万 7 家、pageSize 500 → `isError`+`invalid_param`） |
| `npm run check` | exit 0（agent-session 边界检查＋全量测试＋构建） |
| `npm test`（全量） | **914 项：911 PASS / 0 FAIL / 3 条件 SKIP**（3 SKIP 为仓内既有条件跳过项） |
| 公开仓数据边界 | `git status` 核对：仅代码/文档/测试入仓；数据在 `.local/`（gitignore）与 dataRoot |

## 验收映射（TA01–TA10 当前状态）

| 标识 | 状态 | 说明 |
| --- | --- | --- |
| TA02 | PASS | 幂等/版本身份/导入报告（单测＋真实导入） |
| TA03 | PASS | 缺失语义与推断标记（单测＋真实数据抽查：inferred/basis/null score 96 家） |
| TA04 | PASS | 评分黄金对照（单测＋2835/2835 真实等价） |
| TA05 | PASS | 结构化报错信封（单测＋stdio 冒烟） |
| TA08 | PASS | 公开仓无经营数据 |
| TA09 | PASS | 标准正文随交付落仓，与本实现一致 |
| TA10 | 部分 | `npm run check` 通过；"既有链路回归"以全量 914 项为准 |
| TA01 | 待接缝 | 需 Host 注册接线后经产品任务会话实测（Codex） |
| TA06 | 待接缝 | 需接缝后核启用边界/受管任务不注入（Codex＋复核） |
| TA07 | 待接缝 | 浏览器点验能力目录条目（Codex） |

## 如实缺口与未验证项

- Host 接缝（会话注册、能力目录条目、产品 dataRoot 正式导入）归 Codex，未实施；本记录不宣称产品链路可用。
- 真实模型任务端到端（TA01 产品路径）、浏览器点验、独立复核、Git/CI 交付未做，分别按授权推进。
- 商圈连接器工具在受管执行/封闭任务中的不注入行为依赖 Host 侧接线与既有 `disabledBuiltinExtensions` 边界，待接缝后专项核对（标准 §5）。
- `.local/trade-area-data-dev/` 为开发验证数据根；产品 dataRoot 正式导入在接缝集成时执行。

# 商圈数据 MCP 连接器（首个连接器 · 标准奠基）

状态：规格 v0.1（2026-11-03，按已确认决策 D1–D13 修订）；实施暂缓（讨论稿 D6），启动另行授权。

2026-11-03 · 依据[商圈/天气 MCP 连接器能力承接产品讨论稿 v0.1](../../../docs/商圈天气MCP连接器能力承接产品讨论稿_v0.1.md) 制定；讨论稿决策 D1–D13 已全部经用户确认（2026-11-03），其中 D7（数据快照落位/公开仓不放经营数据/原仓暂不退役）、D8（任务级显式开启）、D9（交付顺序商圈先行）、D10（3 工具集）、D11（能力目录条目）、D13（全量 2835 家导入）直接约束本变更。本变更为两个独立连接器中的**首个**：交付商圈数据连接器本体，并随交付建立 **OptraCall MCP 连接器接入标准 v1**（含 [docs/mcp-connector-integration.md](../../../docs/mcp-connector-integration.md) 标准正文），供后续连接器（如天气）复用。天气连接器为独立变更（[weather-mcp](../weather-mcp/spec.md)），不随本变更交付。

[trade-area 原仓](https://github.com/gadfly-hbo/trade-area)（HEAD `2ba41d2`）仅作数据与 schema 参考：`src/types.ts` 为数据契约权威、ETL 产物为数据底座、`src/scoring/model.ts` 为四因子评分算法参考；其前端、页面与 ETL 工程不进入本仓。

## 可观察结果

用户在项目任务中显式开启商圈连接器后，任务 Agent 在对话中自主调用商圈工具：按省市/评级/关键词/指标条件筛选商圈、读取商圈完整档案（12 维度全文+来源+可信度+指标+评分，多商圈对比由 Agent 组合多次详情调用自主完成）、按自定义权重重算选址评分；工具结果带数据版本身份，Agent 引用商圈事实时可注明"基于哪一版商圈数据"。未开启连接器的任务与受管/封闭执行任务中无商圈工具。能力目录"连接器"分区出现首个"已接入"条目，点击导航到项目视图（使用现场=项目任务对话）。数据快照位于本机 `dataRoot/connectors/trade-area/`，公开仓内无经营数据。

## 范围

- 新建 `extensions/connectors/trade-area-mcp/`（连接器标准 v1 首例，目录与清单结构按标准执行）：
  - `connector.json`：id `trade-area-mcp`、kind `local-data`、transport `stdio`（实施核对 2026-11-03：pi SDK 1.4.0 `registerMcpServer` 仅支持 stdio/http 注册，无 in-process 注册）、egress `none`、credentials `none`、工具清单（只读声明）、数据版本身份栏位；
  - `server/`：MCP server 本体与 3 个正交只读工具（`tradearea_search` / `tradearea_detail` / `tradearea_score`，参数 schema 与报错信封以实施规格细化）；
  - `scripts/import-data.mjs`（或同等形态）：从 trade-area 原仓 ETL 产物（`public/data/index.json`+详情分片，全量 2835 家，D13）快照式导入本机 dataRoot，记录数据版本身份（原仓 HEAD、generatedAt、条目数、内容哈希清单），幂等重跑；
  - `README.md`：解决任务、输入输出、数据来源与版本、权限与数据出口（无网络无凭据）、启停方式。
- 新建 `docs/mcp-connector-integration.md`：连接器接入标准 v1 正文（目录结构、connector.json 清单 schema、工具合同、数据/权限/出境边界、Host 接缝、启用策略），由本变更奠基。
- Host 接缝（**Codex 归属，按工程规范 v1.3 默认**；如用户对本变更直接指定 Qoder 实施，按 IN06 记录例外范围与理由）：
  - `src/agent/project-session.ts`：连接器注册接线（经 SDK 既有 MCP 缝隙；普通任务可用，受管/封闭执行不注入，沿用现有禁用策略）；
  - `src/host/ui/catalog-data.ts`："连接器"分区首个"已接入"条目 + `openCatalogEntry` 导航（对齐 target-forecast 条目先例）；
  - `dataRoot/connectors/trade-area/` 目录分配与导入后校验。
- 新增测试：工具合同（参数校验、报错信封、分页）、数据导入幂等与版本身份、评分算法对照原仓黄金值、Host 注册接线与默认关闭行为（含受管任务不注入）、`npm run check` 全量。

## 不做

- 不做云端 MCP、远程部署、跨机服务；数据仅本机；
- 不做写入类工具、订阅刷新、定时更新、原仓 ETL 重跑（数据以原仓产物快照承接）；
- 不做页面 UI（无独立连接器页面，能力目录条目+导航即可）；不做独立进程/端口/探活协议；
- 不新建会话域/profile/owner，不建平行 Runtime，不改模型配置；
- 不迁移原仓前端/ETL 工程；不处理原仓 `reports/`、`dist/` 等非数据底座内容；
- 不做天气连接器（独立变更）、不做第三方 MCP 安装市场。

## Interface 接入记录（IN01）

- 工程规范 v1.3；Interface v3（`src/host/agent-sessions.ts`）；**复用项目任务域 `project-tasks`，不注册新域**。
- owner/profile：项目任务既有 owner（projectId+taskId）；连接器工具作为该域任务的可用能力经 SDK 既有 MCP 缝隙注入，不改变准入、模型选择、历史与续接策略。
- 修改范围：`src/agent/project-session.ts` MCP 注册接线（Codex 维护）；连接器本体仅提供 server 与工具定义（Qoder 维护），不 import SDK 会话管理、不接触凭据。
- 工具执行体为进程内纯只读计算（读本机 dataRoot 数据快照），无网络、无副作用；受管 ordinary/protected 及 fixed-draft/text-only 任务明确不注入（沿用现有 `disabledBuiltinExtensions` 边界）。
- 事件/日志脱敏、凭据与资源权限全部沿用 Host 既有路径；本连接器无对外网络与凭据需求（egress=none）。

## 关键规则

- R1 数据快照不可变：导入产物带版本身份（原仓 HEAD+generatedAt+条目数+内容哈希清单），落 `dataRoot` 后只读；更新=显式重新导入新版本，旧版本保留可追溯；公开仓不含数据。
- R2 工具只读正交：3 工具（search/detail/score）均为只读查询，无写入、无副作用；**可由既有工具推导的组合能力（如多商圈对比）不设工具**（讨论稿 D10），由 Agent 自主组合多次调用完成；命名带 `tradearea_` 前缀避免 namespace 冲突。
- R3 缺失语义如实：沿用原仓契约——字段缺省=未公开（不造占位数）、`inferred` 标记推断值、`basis` 仅 benchmark 写入、评分缺失因子即 `score=null` 不分摊；省份解析脏值在导入或查询层过滤并在导入报告记录。
- R4 结构化报错：参数越界、商圈不存在、分页越界等以结构化信封返回，供 Agent 自主纠错；服务端自报只读 hint 不作权限依据。
- R5 启用策略：连接器工具默认不进任务默认工具集，任务级显式开启后 Agent 自主调用（对齐 sim-lab 先例；开启交互与 Demo 确认时细化）。
- R6 标准奠基：`connector.json` 清单与目录结构即标准 v1 首例，写入 `docs/mcp-connector-integration.md`；后续连接器复用该标准，不在各自目录内另立标准。
- R7 Agent 自主：连接器是能力注入不是流程编排；何时查询、筛选条件、如何解读与引用由 Agent 决定；无逐调用确认门槛。
- R8 来源标注：工具结果携带数据版本身份；Agent 引用商圈事实时可注明版本；界面/目录文案不预设商圈优劣结论。

## 验收

| 标识 | 条件 | 对应 |
| --- | --- | --- |
| TA01 | 3 工具经产品任务会话真实 SDK 路径可用（合成 Provider 驱动）：Agent 在任务中完成筛选→详情→评分全流程，多商圈对比由多次详情调用自主组合 | R2/R7 |
| TA02 | 数据导入：幂等重跑一致、版本身份完整（HEAD/生成时间/条目数/哈希清单）、导入报告如实记录警告与脏值过滤 | R1/R3 |
| TA03 | 缺失语义：未公开字段不造数、推断值带标记、缺因子评分=null；抽查原仓已知修正案例（如爱山广场零售额、湖州站双站）数据正确 | R3 |
| TA04 | 评分对照：`tradearea_score` 与原仓四因子算法在黄金权重集上结果一致（含权重比例语义） | R3 |
| TA05 | 结构化报错覆盖参数越界/商圈不存在/分页越界；Agent 可依信封纠错 | R4 |
| TA06 | 启用边界：默认任务无商圈工具；显式开启后可用；受管执行/封闭资源/fixed-draft 任务不注入；无平行 Runtime、无 SDK 绕过 | R5 |
| TA07 | 能力目录"连接器"分区首个"已接入"条目，形态对齐先例，点击导航项目视图，文案与实际能力一致（含"本机数据、无网络外发"） | — |
| TA08 | 公开仓内无经营数据；数据仅存 `dataRoot/connectors/trade-area/`；`git status`/仓内容核对通过 | R1 |
| TA09 | 标准正文 `docs/mcp-connector-integration.md` 随交付落仓，内容与本实现一致，可独立理解 | R6 |
| TA10 | 既有链路回归通过；`npm run check`（含 agent-session 边界检查）通过 | — |

## 实施记录（Qoder 侧，2026-11-03）

用户授权产品开发（AGENTS.md 当前授权段），Qoder 完成连接器本体与标准正文：`extensions/connectors/trade-area-mcp/`（types/scoring/store/server/main/import-data/connector.json/scripts/README）＋ `docs/mcp-connector-integration.md`（标准 v1）＋ `tests/trade-area-mcp.test.ts`。依赖新增 `@modelcontextprotocol/sdk@1.32.2`、`zod@4.6.7`（package.json/lock 同步）。实施核对：pi SDK 1.4.0 `registerMcpServer` 仅支持 stdio/http，connector.json transport 定为 `stdio`；工具 schema 用 zod 基础类型收口、精确约束在 store 层校验（违规走 `isError`+`invalid_param` 信封而非协议错误）。

真实数据验证（参考数据经 MacBook 只读拷贝至 `.local/trade-area-ref/`）：全量 2835 家导入 `.local/trade-area-data-dev/`（sourceHead `2ba41d2`，57 分片，快照 digest `e9185d4e…d6fc`），**评分等价性 2835/2835 一致、0 不一致**；导入报告记录 12 条省份解析脏值（数据原样保留）；96 家 `score=null` 与原仓"2739/2835 可评分"吻合。stdio 真实路径冒烟通过（JSON-RPC 握手、三工具各一次、指标过滤与信封报错）。TDD 顺序：测试先行 RED（模块缺失失败）→ 实现 GREEN，两处夹具缺陷（metrics 未填原始值、分片结构包装差异）修正后 10/10；真实分片为纯数组（DistrictDetail[]），与合成夹具差异已按真实契约对齐。

未完成（如实）：Host 接缝（会话注册/能力目录条目/dataRoot 正式落位）归 Codex 未实施；TA01（产品任务会话端到端）、TA07（浏览器点验）依赖接缝；真实模型任务实测属验收阶段。验证证据与命令见 [result.md](result.md)。

**移交（2026-11-03）**：候选与移交包已固定为分支第三提交（[review-handoff.md](review-handoff.md)＋candidate-manifest.txt，20 文件哈希自校验通过）；分支所有权移交 Codex 至合并，Qoder 此后对本分支只读。天气连接器按 D9 于本变更合并后另起。



- 新增单测+工具合同测试+导入测试+评分黄金对照；`npm run check` 全量；合成 Provider 端到端（TA01）；浏览器点验能力目录条目（TA07）。
- Host-Agent 职责边界及复用专项检查按工程规范 §4 执行。
- UI Demo：[原型](../../../docs/prototypes/connector-ui-demo.html)（能力目录条目、任务级开启、会话内开关、对话示意四场景）**用户已于 2026-11-03 全部确认**：①开启入口两处——新建任务对话框能力清单（泛化 sim-lab 单开关，商圈/天气独立勾选）＋会话内「Pi 能力与命令」面板开关（仅空闲时可切换，沿用 sim-lab 修正后的接缝语义）；②能力目录条目文案与导航照 Demo，两个条目按钮统一描边样式（不按交付先后区分）；③数据版本行位于 Pi 能力面板内（快照身份：版本·条目数·引擎身份·来源提交）。Demo 确认不构成实施启动授权（D6）。
- 未决：产品 dataRoot 的正式导入在 Host 接缝集成时执行（参考数据已从 MacBook 原仓只读拷贝至本仓 `.local/trade-area-ref/`，开发验证用导入位于 `.local/trade-area-data-dev/`）；开启入口的 UI 实施细节随 Host 接缝（Codex）；实施启动后的 Git/CI、合并与 MacBook 更新分别另行授权。

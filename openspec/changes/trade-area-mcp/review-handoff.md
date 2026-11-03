# 商圈数据 MCP 连接器 · 整体移交包（Qoder → Codex）

日期：2026-11-03 · 分支：`qoder/data-mcps`（已推送 origin：`be76a29` 设计基线、`1922498` 实现、本移交包为第三提交）· 移交性质：**分支所有权整体移交，Codex 全程负责 Host 接缝、独立复核与 Git/CI 至合并 main，不再转回 Qoder**

## 移交声明

- Qoder 已完成连接器侧全部开发（3 只读工具＋评分端口＋快照导入＋stdio server＋测试＋标准正文 v1＋文档），全部验证证据见 [result.md](result.md)。
- 移交后 Qoder 对本分支**只读、不再写入**；单一写入者原则，此后只有 Codex 在该分支提交。
- 向用户申请 Git/CI 等授权的主体转为 Codex。
- 天气连接器（[weather-mcp](../weather-mcp/spec.md)）按 D9 在本变更合并 main 后另起独立分支，不随本变更交付。

## 候选与证据索引

- 候选身份：[candidate-manifest.txt](candidate-manifest.txt)（20 文件＝19 个相对 main 的变更文件＋本包；SHA-256 前 16 位；不含清单自身）。
- 需求与验收：[spec.md](spec.md)（TA01–TA10、R1–R8、IN01 接入记录、实施记录）；产品方向：[讨论稿 D1–D13](../../../docs/商圈天气MCP连接器能力承接产品讨论稿_v0.1.md)；UI 交互已确认（[connector-ui-demo.html](../../../docs/prototypes/connector-ui-demo.html) 四场景，规格"适用检查"节有确认结论）。
- 实施与验证：[result.md](result.md)（验证证据表、验收映射、如实缺口）。
- Qoder 侧检查结论：连接器测试 10/10；`npm run check` exit 0（914 项：911 PASS/0 FAIL/3 条件 SKIP）；stdio 真实数据冒烟通过；真实导入 2835 家评分等价 2835/2835。
- 如实保留的缺口（Codex 无需重复报告，但需判断记录是否准确）：Host 接缝未实施（归 Codex）；TA01/TA06/TA07 待接缝；真实模型任务实测、独立复核、Git/CI 未做。

## Codex 任务序列

### 1. 固定与核对候选

1. `git fetch origin`；基线应为 `origin/main` = `7109a6e`，分支 head 为本移交提交（以实际 fetch 为准）。
2. 按 candidate-manifest 逐项核对哈希（18 个差异文件＋本包；清单不含自身）。
3. 通读工程规范 v1.3 §2（含移交交付模式、IN01–IN07）、本规格与 result。

### 2. 实施 Host 接缝（全部为 Codex 默认归属；本变更 Qoder 无接缝偏差）

接线参考事实（Qoder 实施核对，2026-11-03）：
- pi SDK 1.4.0：普通任务工厂已挂 `createMcpExtension()`（[project-session.ts:197](../../../src/agent/project-session.ts)）；受管/封闭/fixed-draft 路径 `disabledBuiltinExtensions` 含 `'mcp'`（[project-session.ts:181,186](../../../src/agent/project-session.ts)）。扩展 API `pi.registerMcpServer({name, config})` 仅支持 **stdio/http**；工具全名 `mcp__trade_area_mcp__<tool>`。
- 连接器注册配置：`extensions/connectors/trade-area-mcp/connector.json` 的 `transport` 字段（command=node，args=[server 入口]，env `TRADEAREA_DATA_ROOT` 指向产品 dataRoot 下 `connectors/trade-area/`）。
- 现有任务能力开关先例：`simulationTools` boolean（创建对话框 [App.tsx:231](../../../src/host/ui/App.tsx)，harness 面板空闲切换 [App.tsx:318](../../../src/host/ui/App.tsx)）。

实施范围（交互形态以已确认 UI Demo 为准）：
1. **任务能力启用模型**：由单一 `simulationTools` 泛化为任务能力清单（经营推演＋商圈连接器独立勾选；天气条目不在本变更）。持久化结构（任务字段或能力集合）由 Codex 决定，如有结构决定按 IN01/既有结构决定格式记录；空闲切换语义沿用 sim-lab 修正先例（经公共生命周期释放旧资源）。
2. **会话注册**：任务显式开启商圈连接器后，MCP server 经注册 API 进入该任务会话；默认任务无商圈工具；受管 ordinary/protected、fixed-draft/text-only 不注入（TA06 实测，不只看配置）。
3. **能力目录**：`catalog-data.ts` connectors 分区首个"已接入"条目（文案见 UI Demo 场景①：名称"商圈数据"、本机数据无网络外发、版本 chip、描边按钮统一）＋ `openCatalogEntry` 导航项目视图（对齐 App.tsx:210 既有分支）。
4. **UI**：新建任务能力清单复选（UI Demo 场景②）＋ harness 面板开关与数据版本行（场景③，版本行内容＝快照 digest 摘要·条目数·来源 HEAD）。
5. **产品 dataRoot 正式导入**：运行 `node extensions/connectors/trade-area-mcp/scripts/import-data.mjs --source <源> --data-root <产品dataRoot>/connectors/trade-area --source-head 2ba41d2`；源可复用本机 `.local/trade-area-ref/public/data/`（gitignore，已从 MacBook 原仓只读拷贝、HEAD 2ba41d2）或经 `ssh macbook` 重取 `~/Dev/Projects/trade-area/public/data/`。导入报告（含 2835/2835 等价、12 条脏省份）归档至证据位置。
6. **复验**：`npm run check` 全量；TA01（合成 Provider 驱动真实 SDK 路径，Agent 用三工具完成筛选→详情→评分、对比由多次 detail 组合）；TA07 浏览器点验目录条目与开启交互；TA06 受管任务对照。

### 3. 非作者独立复核（干净上下文子 Agent）

用下方任务书起新子 agent；发现项由 Codex 修复、复跑并请复核者重验受影响范围；报告追加至本目录（如 `independent-review.md`）。

> 你是一名独立复核 Agent，未参与本候选任何部分的创作，也不带作者的会话历史。请按任务书独立工作，不采信任何"实现已没问题"的预设。
>
> **复核对象**：OptraCall `qoder/data-mcps` 分支"商圈数据 MCP 连接器"候选（`openspec/changes/trade-area-mcp/candidate-manifest.txt` 固定身份；Codex 接缝实施后的增量一并纳入）。
>
> **必须遵守**：1. 源文件、测试、规格、既有证据只读；临时文件只写自行创建的隔离目录（mktemp）。2. 先从验收导出预期：通读 spec.md（TA01–TA10、R1–R8、IN01）与讨论稿 D1–D13，自行写关键预期清单再核对实现，不照 result.md 复述。3. 独立检查关键路径：评分端口与原仓数学等价（子权重分摊/严格 null/权重 0 排除/舍入）；导入 fail-closed（评分不一致拒绝）、幂等、history 归档、脏值只记录不改数据；缺失语义（无键＝未公开、inferred、null score 不当低分）；工具信封（invalid_param/not_found/data_unavailable）；只读边界与批量上限；公开仓无经营数据；标准正文与实现一致（TA09）；接缝增量：默认关闭、任务级开启、受管/封闭任务不注入（TA06 实测非仅配置）、目录条目形态。4. 可运行验证：`node --test tests/trade-area-mcp.test.ts`；`npm run check`；抽查同输入两次运行输出一致；`.local/trade-area-ref/`（gitignore）有原仓 ETL 产物与 `src/scoring/model.ts`，可在隔离目录独立重算对照；亦可 `ssh macbook` 读原仓。5. 如实记录检查范围、命令与退出结果、发现（严重度/位置/理由）、未验证项。
>
> **产出**：复核报告（预期清单→逐项 PASS/FAIL/待验证＋证据位置→发现与处置→总结论），写入隔离目录并回报路径与摘要。

### 4. Git/CI 交付（先向用户申请授权）

集成最新 main 并重验受影响部分 → push → 单 PR → 实际 head CI → 用户确认后 squash 合并 → 本地 main 安全快进 → 更新规格/结果、OpenSpec 归档。

### 5. 后续边界（各自另行授权，不随本变更）

天气连接器（独立变更，复用标准 v1 与本次接缝模式）、真实模型任务验收、MacBook 更新、trade-area 原仓后续数据版本导入。

## 本变更特殊性提示（供 Codex 与复核者）

- **零会话结构变更**：复用 project-tasks 域与既有 MCP 缝隙；无新域/owner/profile；连接器代码不 import pi SDK、不接触会话管理（IN02–IN05 义务在接缝侧）。
- **评分等价的口径**：2835/2835 逐值一致（含 null↔null），这是 R10/TA04 的最强证据；复核应独立重算抽验或全量重跑导入。
- **工具 schema 故意宽松**（zod 基础类型收口，精确约束在 store 层校验、违规走 `isError`+`invalid_param` 信封而非协议错误）——这是设计决定（供 Agent 自主纠错），不是缺陷。
- **真实分片契约**：`details/s{N}.json` 为 `DistrictDetail[]` 纯数组（非对象包装）；合成夹具已对齐。
- **公开仓边界**：经营数据只存 dataRoot 与 `.local/`（gitignore）；任何情况下不把 2835 家数据或其副本提交入仓。
- **IN06 状态**：Qoder 未实施任何接缝（本变更无 sim-lab 式流程偏差）；接缝由 Codex 实施为默认归属，无需例外记录。

## Codex 启动 Prompt（可直接粘贴使用）

```text
接管 OptraCall 分支 qoder/data-mcps 的"商圈数据 MCP 连接器"变更（Qoder 已整体移交，你为唯一写入者）。

先读（顺序）：docs/engineering-workflow.md（§2 移交交付模式与 IN01–IN07）、
openspec/changes/trade-area-mcp/spec.md 与 result.md、本文件 review-handoff.md。

第一步：git fetch origin 后按 candidate-manifest.txt 逐项核对 20 个文件的 SHA-256
前 16 位（基线 origin/main=7109a6e，分支含 be76a29/1922498/移交提交）。发现差异
立即停止并向用户报告，不回写清单。

然后按 review-handoff.md"Codex 任务序列"执行：
1) 实施 Host 接缝（任务能力清单泛化、pi.registerMcpServer stdio 注册、能力目录
   条目+导航、UI 开关与数据版本行、产品 dataRoot 正式导入、npm run check 复跑、
   TA01/TA06/TA07 验证）；交互形态以 docs/prototypes/connector-ui-demo.html 已确认
   四场景为准；持久化结构如需变更按 IN01 记录。
2) 干净上下文非作者子 Agent 独立复核（任务书在 review-handoff.md §3），修复后重验。
3) Git/CI 交付前先向用户申请授权：集成最新 main→单 PR→实际 head CI→用户确认后
   squash 合并→快进 main→归档。

边界：接缝修复全程由你承担；Qoder 对本分支只读；不实施天气连接器（合并后另起
独立变更）；真实模型验收与 MacBook 更新另行授权；公开仓不得出现经营数据；
不切换运行服务、不操作 MacBook 开发侧（只读 ssh 取数除外）。
```

# 天气 MCP 连接器 · 整体移交包（Qoder → Codex）

日期：2026-11-03 · 分支：`qoder/weather-mcp`（基于合并后 main `351d835`；Qoder 实现提交＋本移交包提交后推送 origin）· 移交性质：**分支所有权整体移交，Codex 全程负责 Host 接缝、独立复核与 Git/CI 至合并 main，不再转回 Qoder**

## 移交声明

- Qoder 已完成连接器侧全部开发（单工具＋Open-Meteo 适配器＋缓存＋覆盖核对＋测试＋文档），验证证据见 [result.md](result.md)；全部为合成 HTTP 夹具，**真实 API 调用 0 次**。
- 移交后 Qoder 对本分支只读、不再写入；单一写入者原则。
- 向用户申请授权的主体转为 Codex（含真实 API 冒烟——外部副作用，须先请示）。

## 候选与证据索引

- 候选身份：[candidate-manifest.txt](candidate-manifest.txt)（SHA-256 前 16 位；不含清单自身；生成后对工作树逐项自校验）。
- 需求与验收：[spec.md](spec.md)（WX01–WX09、R1–R8、IN01、实施记录与实施决定）；方向：[讨论稿 D1–D13](../../../docs/商圈天气MCP连接器能力承接产品讨论稿_v0.1.md)（D12 出境粒度、D9 交付顺序）。
- 实施与验证：[result.md](result.md)（验证证据表、验收映射、如实缺口）。
- Qoder 侧检查结论：连接器测试 10/10（合成夹具）；`npm run check` exit 0（943 项：940 PASS/0 FAIL/3 条件 SKIP，商圈基线 933＋10）；package.json/lock **无变化**（零新增依赖）。
- 如实缺口（Codex 无需重复报告，但需判断记录是否准确）：Host 接缝未实施；真实 API 未调用（参数格式未经真实端核对）；WX01/05/06/07 产品路径待接缝。

## Codex 任务序列

### 1. 固定与核对候选

1. `git fetch origin`；基线 `origin/main` = `351d835`（以实际 fetch 为准），分支 head 为本移交提交。
2. 按 candidate-manifest 逐项核对哈希；差异立即停止并向用户报告，不回写清单。
3. 通读工程规范 v1.3 §2、[标准 v1](../../../docs/mcp-connector-integration.md)（含商圈接缝实施后补充的 §5 事实）、本规格与 result、以及 trade-area 的 [IN06 记录](../trade-area-mcp/spec.md)（SDK 薄层复用边界——天气注册应复用同一接缝模式与既有 loader 例外，不另建）。

### 2. 实施 Host 接缝（Codex 默认归属；形态对齐 trade-area 已实施先例）

1. **任务能力开关**：[task-capabilities.ts](../../../src/host/task-capabilities.ts) 增加 `weatherTools` 条目（描述如实注明"外部网络，白名单出境 archive-api.open-meteo.com，无密钥"）；持久化与空闲切换语义沿用 trade-area 结构决定 S1–S4（各自独立、缺省关闭、旧元数据不重写）。
2. **会话注册**：对齐 [project-session.ts](../../../src/agent/project-session.ts) 的 trade-area 注册块：`registerMcpServer('weather-mcp', {stdio, env: WEATHER_CACHE_ROOT=<dataRoot>/connectors/weather})`＋`exposure:hidden`＋单工具 `toolExposure:direct`＋目录指纹冻结复用；受管/封闭/fixed-draft 不注入；复用既有 SDK loader 例外，不新增导入面。
3. **出境白名单传输层强制（首个 remote-api，新机制）**：connector.json `egress` 声明仅 `archive-api.open-meteo.com`；如何在本机对 stdio 子进程强制（进程级网络限制/代理/沙箱方案）为 Codex 设计决定，按 IN01/结构决定记录理由与边界；连接器侧已自限单域＋URL 自检，但**不以此替代 Host 强制**（WX05 须实测：非白名单域被拒，不只看配置）。
4. **能力目录＋UI**：第二个"已接入"条目（文案见 UI Demo 场景①：描边按钮统一、"需任务级开启"）；新建任务能力清单与 harness 面板开关增加天气项；**D12 一次性出境说明卡**（内联、勾选时出现、不弹窗——UI Demo 场景②已确认交互）。
5. **缓存落位**：`<dataRoot>/connectors/weather/`（清单 `data.location`）；无需导入步骤（缓存随查询生成）。
6. **复验**：`npm run check` 全量；WX01（合成 Provider 端到端：Agent 查询并在分析中引用，含缓存命中与过期重取路径）；WX05（出境强制实测）；WX06（默认关闭/开启/受管不注入）；WX07（浏览器点验条目、开启交互、出境说明卡）。

### 3. 真实 API 冒烟（先向用户申请授权）

单次、最小化：湖州（30.8671,120.1023）2025-10-01..2025-10-31 一次 `weather_history`；核对参数格式、真实响应结构、覆盖完整性与缓存落盘；如实记录延迟与限流实况。**未经授权不调用真实 API**；结果记入本目录 result。

### 4. 非作者独立复核（干净上下文子 Agent）

> 你是一名独立复核 Agent，未参与本候选任何部分的创作，也不带作者的会话历史。请独立工作，不采信任何"实现已没问题"的预设。
>
> **复核对象**：OptraCall `qoder/weather-mcp` 分支"历史天气 MCP 连接器"候选（candidate-manifest.txt 固定身份；Codex 接缝增量一并纳入）。
>
> **必须遵守**：1. 源文件、测试、规格、既有证据只读；临时文件只写隔离目录。2. 先从验收导出预期：通读 spec.md（WX01–WX09、R1–R8）与讨论稿 D1–D13，自行写关键预期清单再核对实现，不照 result.md 复述。3. 独立检查：覆盖核对语义（缺失/重复/null 不填零）；缓存指纹稳定性、TTL 过期不冒充新数据、损坏按未命中；适配器失败分类（429+Retry-After/quota/400 原因/5xx/超时/网络）与不自动重试；参数校验信封（城市/坐标二选一、日期/跨度/非未来、字段白名单、未知键精确拒绝）；出境自限于白名单域（URL 构造与自检）；标准 v1 一致性（清单/信封扩展码 README 记录）；接缝增量：能力开关独立、受管不注入（实测非仅配置）、D12 出境说明、目录条目形态。4. 可运行验证：`node --test tests/weather-mcp.test.ts`；`npm run check`；抽查同输入两次缓存命中一致；**不得调用真实 Open-Meteo API**（真实冒烟另行授权后由实施者执行）。5. 如实记录检查范围、命令与退出结果、发现（严重度/位置/理由）、未验证项。
>
> **产出**：复核报告（预期清单→逐项 PASS/FAIL/待验证＋证据位置→发现与处置→总结论），写入隔离目录并回报路径与摘要。

### 5. Git/CI 交付（先向用户申请授权）

集成最新 main 并重验受影响部分 → push → 单 PR → 实际 head CI → 用户确认后 squash 合并 → 本地 main 安全快进 → 更新规格/结果、OpenSpec 归档。

### 6. 后续边界（各自另行授权）

真实模型任务验收、MacBook 更新、天气字段扩展/多时区、缓存策略调整。

## 本变更特殊性提示（供 Codex 与复核者）

- **零会话结构变化、零新增依赖**：复用 project-tasks 域、既有 MCP 接缝与标准 v1 依赖（@modelcontextprotocol/sdk/zod）；package.json/lock 与 main 无差异。
- **真实网络 0 次调用**：连接器从未与真实 Open-Meteo 通信，参数格式与响应结构按官方文档实现、未经真实端核对——真实冒烟（任务序列 §3）是闭合该缺口的唯一途径，且须先获授权。
- **缺必需顶级键的实测口径**：SDK 对 looseObject 不做运行时必需校验时缺键以协议级错误拒绝（isError＋`MCP error -32602` 文本）；实现层信封覆盖其余全部校验（标准 §3"不保证进入工具回调"）。
- **缓存是性能层不是证据层**：损坏条目按未命中处理、过期重取不冒充新数据；查询结果的证据身份是 source＋fetchedAt＋cache 标注，不是缓存文件本身。
- **`source_unavailable` 为本连接器对标准错误码的扩展**（README 已记录），detail.reason 分类如上；限流含 Retry-After 秒数。
- **IN06 状态**：Qoder 未实施任何接缝（无偏差）；出境传输层强制为 Codex 新设计决定，按结构决定格式记录。

## Codex 启动 Prompt（可直接粘贴使用）

```text
接管 OptraCall 分支 qoder/weather-mcp 的"历史天气 MCP 连接器"变更（Qoder 已整体移交，
你为唯一写入者）。商圈 trade-area 连接器已合并，本变更复用其接缝模式与标准 v1。

先读（顺序）：docs/engineering-workflow.md（§2 移交交付模式与 IN01–IN07）、
docs/mcp-connector-integration.md（含商圈实施后补充的 §5 接缝事实）、
openspec/changes/weather-mcp/spec.md 与 result.md、本文件 review-handoff.md、
openspec/changes/trade-area-mcp/spec.md 的 IN06 记录（SDK 薄层复用边界）。

第一步：git fetch origin 后按 candidate-manifest.txt 逐项核对 SHA-256 前 16 位
（基线 origin/main=351d835，分支含 Qoder 实现提交与移交提交）。差异立即停止并向
用户报告，不回写清单。

然后按 review-handoff.md"Codex 任务序列"执行：
1) 实施 Host 接缝：task-capabilities 增 weatherTools；registerMcpServer stdio 注册
   ＋目录指纹冻结复用（对齐 trade-area 接缝，含既有 loader 例外，不另建）；
   能力目录第二条目＋开启交互＋D12 一次性出境说明卡（UI Demo 已确认）；缓存根
   dataRoot/connectors/weather；npm run check 复跑；WX01/06/07 验证。
2) 设计并实施首个 remote-api 出境白名单的传输层强制（WX05 实测非白名单域被拒），
   按 IN01/结构决定记录方案理由。
3) 真实 Open-Meteo 冒烟与 Git/CI 均须先向用户申请授权：冒烟＝单次湖州 2025-10
   全月查询并如实记录；Git/CI＝集成最新 main→单 PR→实际 head CI→用户确认 squash
   合并→快进 main→归档。
4) 干净上下文非作者子 Agent 独立复核（任务书在 review-handoff.md §4），修复后重验。

边界：Qoder 对本分支只读；未经授权不调用真实 API、不推送、不开 PR；不切换运行
服务、不操作 MacBook；复用既有依赖与接缝，不新增导入面或平行机制。
```

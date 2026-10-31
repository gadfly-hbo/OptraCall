# 决策看板一期（decision-board）

用户于 2026-10-31 授权：将决策页占位替换为真实决策看板。OptraCall 已完成分析报告输出（项目 `060_reports`），本变更加入跨项目汇总呈现与业务侧决策闭环。方案三问已确认：Agent 自动抽取、完整闭环（确认→任务→反馈）、全局决策页（跨项目汇总）。

**流程补正（2026-10-31）**：实施前未先向用户输出 UI Demo 确认，属流程偏差；已于实施后补交[UI Demo](../../docs/prototypes/decision-board-ui-demo.html)（与已实现交互一致的可点击原型，数据为同日真实模型试跑合成样例）供用户确认，确认结论与调整要求记入[结果](result.md)，后续增量（含浏览器回归测试）以此为准。

参考：MacBook `decision-platform`（只读核对 README、类型与 board 聚合，2026-10-31）；其飞书直审、汇报模式、teach 校准注入不在本期。

## 可观察结果

用户在"决策工作台"页看到所有项目（含归档标记）`060_reports` 的真实报告与跨项目建议汇总；对报告显式触发"抽取建议"后，模型从报告文本抽取决策建议行动项（证据等级、报告原文引用、推导、预期效果）；业务侧在看板上采纳或驳回（驳回必填理由），采纳项拆行动任务（负责人/截止日/状态），执行后回录反馈与评分。无演示数据冒充真实结果。

## 范围

- 扩展 `extensions/business-plugins/decision-board/`：类型、SQLite 存储、抽取输出归一化（纯函数）、抽取会话工作区与系统提示、API 路由、看板页面 UI。
- Host 接线：`src/host/server.ts` 注册路由与会话域；新增 `src/host/decision-board-sessions.ts` 适配器（复用 `createAgentSessionDomain`）。
- 前端：App.tsx `decision` 视图改为渲染扩展页面；新增看板客户端与样式；更新帮助与 README 决策页描述。
- 新增测试：存储/状态机、抽取归一化、Host 路由与合成 Provider 端到端、浏览器点验。

## 不做

- 不做飞书/IM 推送、会议汇报模式、teach 校准注入（留后续增量）。
- 不新建项目层：OptraCall 项目即根容器；不读取、修改 `060_reports` 报告文件本身（只读观测 sha256/bytes）。
- 不自动抽取：仅用户显式触发；报告变化不自动重抽。
- 不改动既有分析链路、Case、核算、需求梳理接缝；不新增平行 Runtime。
- 抽取会话不注册工具、不加载扩展/技能（固定输入，单轮结构化输出）。

## Interface v1 接入记录（IN01）

- 工程规范 v1.1；Interface v1（`src/host/agent-sessions.ts` `AGENT_SESSION_INTERFACE_VERSION`）。
- **责任边界安排（IN06，用户 2026-10-31 直接指定）**：本变更由 Qoder 在 `qoder/ext-decision-platform` 分支实施全链路，含通常属 Codex 的 Host 接线（`src/host/server.ts`、`src/host/decision-board-sessions.ts`、`scripts/check-agent-session-boundary.mjs` 的 `domainRegistrars` 清单）。此安排仅限本变更；非作者独立复核须专门覆盖该 Host 接缝（会话域注册、路由挂载、`projectBusy`/`closeAgents` 协调、边界清单变更理由），合并前建议 Codex 侧接缝互查；后续该接缝的维护回归 Codex 归属。
- 域名 `decision-board-extraction`；owner `{ projectId, extractionId }`；key 为 extractionId；profile.projectId 指向报告所属项目。
- Host 注册位置：`src/host/server.ts` 经 `src/host/decision-board-sessions.ts` 静态注册；扩展不接触 SDK。
- 模型：触发时当前选中配置经 `availableConfiguration` 快照；运行期间固定；记录于抽取记录。
- 工具/环境：独立 workspace（`dataRoot/decision-board/extractions/<extractionId>/`），`defaultTools: []`，报告文本嵌入提示词（UTF-8，超长截断并记录），单轮 `lease.run`，无多轮修正、无续接指针。
- 历史：抽取会话 JSONL 留存于 extraction 目录，sessionFile 指针存抽取记录，不接入任务历史。
- 生命周期：admit 拒绝关闭中/归档项目/同报告运行中抽取；stop 可取消；`closeAgents` 协调 provider/projectId 过滤；启动时 running 项 reconcile 为 interrupted。

## 关键规则（借 decision-platform G10/G11 语义）

- 建议项状态机 `suggested → adopted | dismissed`；驳回必填理由（≥2 字）；`adopted → dismissed` 需理由；`dismissed` 不可直接改采纳（重新生成或人工补充）。
- 重新抽取：删除该报告仍为 `suggested` 的抽取项并重建；已采纳/已驳回/含任务项及人工项保留。
- 证据四级：数据支撑/多源佐证/逻辑推断/经验假设；置信度由等级固定映射派生（0.90/0.75/0.55/0.35），不采用模型自评。
- 人工补充：项目级条目，来源标"人工"，证据固定"经验假设"。
- 任务 `todo → doing → done`；每任务一条反馈，覆盖更新（已执行/结果/指标变化/复盘/评分 1–5）。
- 归档项目：看板可见，写操作 409 `project_archived`。
- 存储：`dataRoot/decision-board/decision-board.sqlite3`（`node:sqlite`，参照 case-store 安全打开模式；schemaVersion=1）。

## 验收

| 标识 | 条件 |
| --- | --- |
| DB01 | 跨项目汇总所有项目 060_reports 报告与建议统计，含归档标记；空态为引导非演示数据 |
| DB02 | 报告以 projectId+path+sha256 登记；文件变化后提示需重新抽取，不自动重抽 |
| DB03 | 显式触发抽取经统一会话入口单轮无工具完成；202 后台；运行中重复触发 409；可停止；归档项目拒绝 |
| DB04 | 建议项含标题/理由/预期效果/优先级/证据等级/事实与原文引用/推导；置信度为等级固定映射；quote 字段经 Host 逐字校验，非逐字引用剥离（真实模型试跑后补强的确定性保证） |
| DB05 | 状态机按上述规则执行；驳回理由必填 ≥2 字；dismissed 不可直接改采纳；看板可开关显示已驳回只读卡（含理由） |
| DB06 | 重新抽取保留已决项与人工项，仅重建 suggested 抽取项 |
| DB07 | 采纳项可加任务并流转 todo/doing/done |
| DB08 | 每任务可回录一条反馈并覆盖更新 |
| DB09 | 可人工补充建议，标"人工"与"经验假设" |
| DB10 | 决策页移除"接入预留/未接入"占位与虚拟数据；README/帮助同步 |
| DB11 | 不写 060_reports、不读 010_draw；归档项目只读；失败/取消不伪造成功 |
| DB12 | 现有链路回归通过；`npm run check`（含 agent-session 边界）通过 |

## 适用检查与未决

- 新增单测 + `npm run check` 全量 + 浏览器点验；合成 Provider 驱动真实 SDK 抽取路径。
- 未决：真实模型端到端试跑、非作者独立复核与 Git/CI 交付另行请示安排；MacBook 体验不在本期。

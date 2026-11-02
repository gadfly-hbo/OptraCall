# 经营推演一期 · 实施与验证记录

日期：2026-11-02 · 分支：`qoder/sim-lab` · 状态：本地实施与适用检查完成，待非作者独立复核与 Git/CI 授权

## 授权与流程

- 2026-11-02 用户确认[讨论稿 v0.2](../../../docs/SimLab能力承接产品讨论稿_v0.2.md)及 Q1–Q4 建议，随后确认 [UI Demo](../../../docs/prototypes/simlab-ui-demo.html) 并指令"开工"。实施按[规格](spec.md)执行。
- **IN06 安排（参照 decision-board 先例）**：本变更由 Qoder 在 `qoder/sim-lab` 分支实施全链路，含通常属 Codex 的 Host 接线（`src/host/server.ts`、`src/agent/project-session.ts`、`src/agent/project-runtime.ts`、`src/host/project-store.ts`、`src/host/ui/*`、`scripts/check-agent-session-boundary.mjs` 的 `toolSdkConsumers` 清单）。合并前须 Codex 侧接缝互查，独立复核专门覆盖 Host 接缝；后续该接缝维护回归 Codex 归属。
- **边界清单例外理由**：`extensions/business-plugins/sim-lab/tools/simulation-tools.ts` 登记进 `toolSdkConsumers`，仅允许 `defineTool`（纯声明式工具定义助手，无会话/模型能力），与 `src/agent/protected-tools.ts` 同类例外。IN06 要求的理由记录于此，独立复核须覆盖。
- `package.json` 新增直接依赖 `typebox@1.3.27`（SDK 既有传递依赖同版本显式声明，lockfile 已同步）。

## 实施范围（实际）

- 插件 `extensions/business-plugins/sim-lab/`：`types.ts`；`kernel/engine.ts`（确定性 FIFO 引擎，本仓原生重实现，参考原仓数学，版本 `optracall-sim-1`，7–90 天窗口、变体、四维扰动、逐日守恒校验）；`storage/store.ts`（草稿/运行/快照文件存储，CAS revision、序列号、快照一次性写入）；`service/simlab-service.ts`（业务编排：建稿/改稿/运行/扰动/固化）；`tools/simulation-tools.ts`（5 个正交工具，结构化成功/拒绝信封，无 freeze 工具）；`api/routes.ts`；`ui/SimLabPage.tsx` + `simlab-client.ts` + `simlab.css`（五视图页面，按已确认 Demo）。
- Host 接线：`server.ts` 挂载 `/api/simlab/`（dataRoot/sim-lab/projects/<pid>，归档只读）+ agentOptions 按任务开关注入 + 任务创建/切换开关路由；`project-store.ts` `TaskRecord.simulationTools`（可选布尔，旧元数据兼容读取）；`project-runtime.ts` `ProjectAgentOptions.simulationTools`（声明式配置，可 IPC 序列化）；`project-session.ts` 普通任务经 `customTools` 注入并加入 defaultTools；`App.tsx`/`catalog-data.ts`/`ProjectDialogs.tsx`/`runtime-client.ts` 视图、目录入口、新建任务勾选与任务内"Pi 能力与命令"开关（新会话打开后生效）。
- 不注入受管（protected/ordinary）与封闭文本资源：执行体未经受限执行边界核验，按不可安全委派扩展明确不提供（SIM12 边界）。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `node --test tests/simlab-*.test.ts`（引擎/存储/工具/路由 15 项） | 全部 PASS：引擎矩阵 144 组参数×3 变体守恒与逐日不变量、字节级确定性、参数/变体/扰动边界；存储 CAS/持久化/重开一致/固化纪律；工具全流程与结构化拒绝信封；路由含归档只读 |
| `node --test tests/simlab-agent-flow.test.ts`（SIM-AGENT-01） | PASS：合成 ToolProvider 驱动真实 SDK，任务级开启后 5 工具经统一 Runtime 暴露并被真实调用（inspect→draft create→run），draftId 经真实工具信封回传；Host 侧草稿/运行落盘且守恒通过；未开启任务不暴露 simulation_* 工具；无 simulation_freeze |
| 浏览器点验（隔离 QA 环境 `tests/fixtures/browser-environment.ts`，合成配置/项目"SimLab 点验（合成）"） | 通过：目录入口→空态→新建草稿（17 参数输入/3 变体卡）→保存并运行（RUN-0001，30 行账本，守恒 30/30）→方案对比→扰动（需求 +25%，3 行 Δ）→固化对话框→SNAP-0001 入栏；任务联动页工具说明与空态正常；控制台无错误 |
| 页面零模型调用 | QA 合成 Provider `GET /__qa` requestCount=0（页面全部操作后） |
| `npm run check`（边界+全部测试+构建） | 两次全量均 PASS（exit 0）：首次插件本体完成后；新增 SIM-AGENT-01 与 lockfile 同步后复跑亦 PASS |

## 验收映射（SIM01–SIM13）

| 标识 | 状态 | 依据 |
| --- | --- | --- |
| SIM01 假设成账 | 通过 | 引擎/存储测试 + 浏览器参数编辑与账本 |
| SIM02 确定性可复现 | 通过 | SIM-ENGINE-02 字节一致、SIM-STORE-02 重开一致；结果与快照带引擎版本与 inputHash |
| SIM03 方案对比 | 通过 | 浏览器对比表（最优高亮、预警标记） |
| SIM04 自定义扰动 | 通过 | 引擎/服务/路由测试 + 浏览器自定义幅度运行 |
| SIM05 固化与不可变 | 通过 | SIM-STORE-04（stale_run/revision_conflict/不可改写）+ 浏览器固化闭环 |
| SIM06 页面零模型零外发 | 通过 | Provider requestCount=0；页面空态为引导 |
| SIM07 Agent 工具化全流程 | 通过 | SIM-AGENT-01 真实 SDK 路径 |
| SIM08 建议→确认→回执 | 部分 | 页面固化+`simulation_evidence` 回执已实现并测试（SIM-TOOLS-03）；对话内专用"固化建议卡片"未单列，v1 以 Agent 对话文本建议+页面固化满足 |
| SIM09 结构化纠错信封 | 通过 | SIM-TOOLS-04 |
| SIM10 守恒与确定性回归 | 通过 | 引擎矩阵进入长期测试基线 |
| SIM11 快照接 Case 呈现 | 未完成（Q5） | 快照数据与"可引用为 Case 证据"展示已具备；Case 实际引用呈现方式待与 Codex 对齐，本变更未实现 |
| SIM12 工具启用与受管边界 | 通过（设计+普通路径实测） | 任务级开关实测（SIM-AGENT-01 含未开启对照）；受管/封闭文本按设计不注入，未在受管任务中运行验证 |
| SIM13 回归与 check | 通过 | `npm run check` 全量（含 agent-session 边界检查） |

## Host–Agent 职责边界自查（初查，待独立复核确认）

- Host 仅提供工具、存储、权限（任务级开关、归档只读、页面固化）与展示；Agent 自主决定工具调用顺序/次数（SIM-AGENT-01 由合成 responder 自主编排验证）。
- 探索性推演无门禁；固化是唯一人工介入点且不设 Agent 工具；无 Host 侧分析流程/步骤编排，无替 Agent 补算通道（R9 页面为用户直接通道）。
- 复用统一 Runtime（customTools 接缝），未新建会话域/平行 Runtime；存储模式参照本仓既有 Store。
- 已知限制：CAS 为进程内串行化+写前复读 revision，Host 与 Agent 子进程并发写存在极小竞争窗口（与本仓其它 Store 同模式，单用户本地定位下接受，记录供复核评估）。

## 未决与后续

- 非作者独立复核（含 Host 接缝与边界清单例外）未完成；Codex 接缝互查待安排。
- Git/CI 交付、合并 main、原仓退役（含 JuanerAI 文档 superseded 标注）、MacBook 体验均按届时授权另行执行。
- Q5（快照指标接 Case 呈现）待与 Codex 对齐后另立增量；SIM08 对话内建议卡片如需专门 UI 亦属后续。
- 真实模型端到端试跑未做（本次验证全部为合成 Provider/合成数据）。

## Codex 接管与接缝互查（2026-11-02，后续记录）

以上为 Qoder 交接时的实施与判断，保留原范围；下述新增证据不追溯改写原候选。

**流程偏差（用户已知情）：本变更 Qoder 在未获用户直接指定的情况下实施了 Host 接缝，属流程偏差，事后经用户知情接受并保留实现。** 原“参照 decision-board 先例”及一般“开工”指令不等于用户对本变更的直接指定。偏差实际范围为前述 server/project-session/project-runtime/project-store、Host UI 与边界脚本；后续由 Codex 独占该分支完成接缝互查、修复和交付，维护回归 Codex。上述兜底及用户事后接受不记为原流程合规。

- 主仓 `/Users/bendandebaba/DevWorkSpace/OptraCall` 和入口工作树在接管前干净；fetch 后候选与 origin 一致。独立工作树 `/Users/bendandebaba/.codex/worktrees/simlab-delivery/OptraCall` 检出 `qoder/sim-lab`，初始 HEAD `4cc11955654e6fbb4cd788aa71ea46b0998c90eb`，基线 `d58061b08534d48d7847d8447575058a1faa45d4`；原 Qoder 工作树保持游离。
- 原 `candidate-manifest.txt` 实际列出 **31** 项（不含清单自身），31/31 SHA-256 前16位一致。移交说明的29+本包/用户提示30均为计数差异，未少核文件。完整核对读回 `.local/simlab-takeover/intake-hashes.json`；原清单不重写，后续候选另固定。
- 七项接缝已互查：继续复用 project-tasks，无新域/profile/owner；agentOptions 仅可序列化的项目路径配置；schema2 缺少可选 simulationTools 的旧记录继续读取；路由、前端与 defineTool 例外另由下表覆盖。没有真实模型或真实凭据调用、运行服务切换及 MacBook 操作。

| 发现 | 修复与因果证据 |
| --- | --- |
| 开启推演工具时，plain 工具名覆盖 SDK 默认 read/bash/edit/write | 使用 SDK `+name` 追加，保留默认及 workspace 选择。增强 SIM-AGENT-01 在原候选可复现缺少 read；首次 RED `.local/simlab-takeover/seam-red.log` |
| 元数据开关未使已存在 worker 采用新工具集，且HTTP可在运行中切换 | 空闲准入检查后经公共 close 释放旧资源，下一次 open/send 生效；保留原 sessionFile 与旧字节前缀。SIM-AGENT-02 初始 RED 同上，修复验证开/关、busy拒绝及历史保全 |
| 项目与草稿共用读取代际，跨项目切换丢弃新列表并请求旧草稿 | 分开取消读取、核对草稿项目归属；写入期间固定项目/草稿选择。真实浏览器因果复现与复验另留隔离QA证据 |
| 插件吞并 Host JSON类型/大小错误，把415/413改成400 | 仅捕获 EngineFault/StoreFault，Host传输错误回交原映射；SIM-API-04 RED `.local/simlab-takeover/routes-red.log` |
| 界面称快照已可接 Case，但 SIM11 尚未实现 | 改为显式显示 Case／决策板接入待完成；保留正式SIM11缺口 |

合成 SDK 端到端已扩为5工具实际调用与成功信封，随后用户HTTP固化、同任务 simulation_evidence 读取具体回执；原用例只实际调用 inspect/draft/run，不能把另外两工具的“已暴露”写成实际调用。新增闭合文本与受管资源的实际 SDK open 排除检查，以及 defineTool 单能力的合规/绕过反例。受管测试首次因合成 fixture 未提供 projectDirectory 失败（`.local/simlab-takeover/seam-green-2.log`），已补齐 fixture；该次不计产品RED。

工程规范已升至 **v1.3**，第2节固化“Qoder → Codex 移交交付模式”：开发、分支移交、Codex接管至合并三个阶段，单一写入者，非作者与干净上下文，及现有授权和复核约束。

用户更新接手指令后，规范进一步明确接缝例外须有用户对具体变更的直接指定，IN06 记录范围、理由及维护回归；没有指定由 Codex 实施，先例或一般开工不自动授权。规范同时要求保留未获指定即实施的流程偏差，事后接受不追溯改为合规。

后续适用全量检查、独立复核与职责边界最终结论在下文追加。Git/CI交付尚待用户授权，当前 origin/main `be1caaf` 较原基线已有PPT接缝更新，尚未集成本分支；原仓退役、MacBook体验及产品验收未执行。

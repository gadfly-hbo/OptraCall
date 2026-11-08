# 模型包消费端 · 整体移交包（Qoder → Codex）

日期：2026-11-05 · 分支：`qoder/model-pack`（基线 main `2b9800b`；Qoder Extension 切片与规格/结果/本包尚未提交，等待用户 Git 授权后由 Codex 固定为单一移交提交）· 移交性质：**分支所有权整体移交，Codex 全程负责 Host 接缝、独立复核与 Git/CI 至合并 main，不再转回 Qoder**

## 移交声明

- Qoder 已完成消费端 Extension 本体切片：`types.ts` 合同与纯校验、`ui/model-pack-client.ts`、`ui/ModelRegistryPage.tsx`、`ui/model-pack.css`、两支测试，以及规格 v0.2、实施记录与本移交包；全部验证证据见 [result.md](result.md)。
- 移交后 Qoder 对本分支**只读、不再写入**；单一写入者原则，此后只有 Codex 在该分支提交。
- 向用户申请 Git/CI 等授权的主体转为 Codex。**实现授权 ≠ Git 授权**（对齐商圈/天气先例）：Qoder 未提交、未推送；固定移交提交须先获用户明确 Git 授权。
- Host 接缝（store/routes/工具注入/task-capabilities/catalog/App.tsx 接线）维持工程规范 v1.6 默认归属 Codex；用户未对本变更直接指定 Qoder 实施接缝（**无 IN06 例外**）。

## 候选与证据索引

- 候选身份：[candidate-manifest.txt](candidate-manifest.txt)（10 文件＝9 个相对 main 的新增文件＋本包；SHA-256 前 16 位；不含清单自身）。全部为新增，无既有文件修改，切片干净。
- 需求与验收：[spec.md](spec.md)（MP01–MP10、R1–R8、D1–D8、IN01 接入记录、§12 未决问题）；UI 交互已确认（[model-pack-consumer-ui-demo.html](../../../docs/prototypes/model-pack-consumer-ui-demo.html) 四场景，用户「UIdemo通过」，UI Gate 通过；正式实施沿用 Demo 信息结构，视觉细节以实施为准）。
- 契约权威：包 `manifest.json`（formatVersion=1）字段以 MacBook 只读参考仓 MPS 实际导出 `order-forecast/v1/manifest.json` 为准（读取核对，非凭记忆）；测试夹具即该真实 manifest。**formatVersion 变更须两产品同步规格，本变更只消费 v1。**
- 实施与验证：[result.md](result.md)（已实施文件表、验证证据表、验收映射、如实缺口）。
- Qoder 侧检查结论：Extension 切片测试 20/20（types 14＋client 6，先 RED 后 GREEN）；`npm run typecheck` exit 0；注册表页 standalone `tsc --strict` exit 0；`npm run check` **exit 0**（1477 项：1447 PASS／0 FAIL／30 条件 SKIP，含 agent-session 边界 PASS，`vite build` 成功）；未新增第三方依赖，未改 `package-lock.json`。
- 如实保留的缺口（Codex 无需重复报告，但需判断记录是否准确）：Host 接缝未实施（归 Codex）；MP01/MP02/MP04–MP10 待接缝；MP03 浏览器点验待 App.tsx 接线；真实包冒烟（MP09）的 MacBook 只读拷贝、独立复核、Git/CI、真实模型任务实测均未做。

## Codex 任务序列

### 1. 固定与核对候选

1. 先向用户申请 Git 授权；获授权后 `git fetch origin`，确认基线 `origin/main`（应为 `2b9800b` 或其后代），把 Qoder 未提交的 9 个新增文件＋本包固定为**单一移交提交**（不改字节）。
2. 按 [candidate-manifest.txt](candidate-manifest.txt) 逐项核对 10 个文件的 SHA-256 前 16 位；发现差异立即停止并向用户报告，不回写清单。
3. 通读工程规范 v1.6 §2（含移交交付模式、IN01–IN07）、本规格 spec.md 与 result.md。

### 2. 实施 Host 接缝（全部为 Codex 默认归属；本变更 Qoder 无接缝偏差、无 IN06 例外）

**接缝互查导引**（Qoder 侧已核对的接线事实，2026-11-05；行号以实际 head 为准，可能已漂移）：

- **HTTP 面**（`src/host/model-pack-routes.ts`，须精确满足 [model-pack-client.ts](../../../extensions/business-plugins/model-pack/ui/model-pack-client.ts) 已固定的契约）：
  - `GET  /api/model-pack/models` → `{ models: ModelRegistryEntry[] }`
  - `GET  /api/model-pack/models/:name/:version` → `{ model: ModelRegistryEntry }`
  - `POST /api/model-pack/imports`，body `{ sourcePath }` → `{ model: ModelRegistryEntry }`
  - `POST /api/model-pack/models/:name/:version/promote` → `{ model, archived: ModelRegistryEntry | null }`
  - 错误体 `{ code, message, detail: { stage?, reason?, hint? } }`（客户端读 `code/status/detail.stage/reason`，无 code 回落默认码）。
  - `ModelRegistryEntry` 形状以 [types.ts](../../../extensions/business-plugins/model-pack/types.ts) 为唯一权威：`{ schemaVersion:1, name, version, stage, task, goal, metrics, fingerprint, training, usage, installedAt, sourcePath, snapshotSha256, corrupted? }`。导入落位＝`toRegistryEntry(validateManifest(manifest), facts)`，facts＝`{ stage:'Staging', installedAt, sourcePath, snapshotSha256 }`。
- **验货门＋存储**（`src/host/model-pack-store.ts`）：R1/R3——结构（三件齐全、formatVersion=1、manifest 字段合法，复用 `types.ts` 的 `validateManifest`）、纯度重扫（禁 fs/网络/子进程/eval/包外 import、禁 `Math.random`/`Date`）、`node --permission` 沙箱冒烟一行；不过＝拒绝导入＋结构化原因，不落半成品。快照拷入 `dataRoot/models/<name>/v<n>/` 只读不可变；同 name+version 字节一致重装幂等、不一致拒绝；旧版本永久保留。注册表元数据入 `node:sqlite` DatabaseSync（case-store 先例）；条目哈希与快照不符＝标记 `corrupted`＋引导重导，不静默修复。晋级状态机：导入即 Staging，同名唯一 Production，晋级自动归档旧 Production（R4）。
- **两个正交工具**（`src/agent/`，沿 `tradeAreaTools` 注入缝隙）：
  - 注入点事实：`src/agent/project-session.ts:288` 依 `!fixedInput() && !o.protectedExecution && o.<flag>` 构造工具，`:434` 汇入 `customTools`；`src/agent/project-runtime.ts:23` `ProjectAgentOptions` 增 model-pack 选项；`src/host/server.ts:161` 按任务能力拼 options（`modelTools` → `dataRoot/models/`），`:679` 能力校验。
  - `modelpack_list`（只读货架事实：name/version/stage/task/metrics/usage.inputs，无写入副作用，R2）；`modelpack_predict`（确定性引擎：**仅按注册表 name+version 解析包路径，任意路径拒绝**（IN05）；`node --permission` 沙箱 fail closed（禁网络、写仅限指定输出路径，沙箱不可用＝拒绝并如实报告，不回落无沙箱）；输出落任务授权目录（020 过程/060 成果约定）；结果带模型身份 name/version/stage＋留出指标＋数据指纹摘要（R7）；执行失败＝结构化信封回传 Agent 自主纠错，Host 不代跑不重试（R6/R8））。**不设组合工具**（多模型对比由 Agent 自主组合多次调用，对齐商圈 D10）。
- **任务能力开关**（`src/host/task-capabilities.ts`）：`TASK_CAPABILITIES` const 数组新增 `{ id:'modelTools', label:'模型预测工具', description:… }`（现三项 simulationTools/tradeAreaTools/weatherTools）；`type TaskCapability` 由 `typeof …[number]['id']` 自动收编。持久化：`src/host/project-store.ts:15` `TaskRecord` 增 `modelTools?: boolean`，`:174-176` 更新校验、`:243-250` createTask、`:289` setTaskCapability；`src/host/ui/project-types.ts:9-11` ClientTask、`src/host/ui/runtime-client.ts:41` createTask、`src/host/ui/TaskCapabilities.tsx:32` 复选渲染（对齐既有三开关；R5 默认关，开启入口＝新建任务对话框＋会话内「Pi 能力与命令」面板仅空闲可切换）。`modelTools` 为 schema2 向后兼容新增可选字段（IN06 兼容语义，非契约变更）。
- **能力目录＋视图接线**（`src/host/ui/catalog-data.ts` + `App.tsx`）：
  - catalog plugins 分区新增条目（形态对齐既有 sim-lab/refiner：`{ id, category:'plugins', name, description, tags, source, note, status:'已接入', entry }`；文案须与实际能力一致，含「本机执行、无网络外发、训练在 MPS」，MP08）。
  - `App.tsx`：`AppView` 增 `'model-pack'`；`openCatalogEntry` 增 entry→view 映射；页面挂载 `view === 'model-pack' ? <ModelRegistryPage onBack={() => openCatalog('plugins')} />`（页面已 `export function ModelRegistryPage({ onBack }: { onBack: () => void })`）；顶部 `import '…/model-pack.css'`（CSS 在 App.tsx 导入，不在页面内，沿既有约定）；补 pageTitle/returnView/activeCatalogCategory 相应分支。
- **会话接入约束**（IN01–IN07）：**复用 `project-tasks` 域，不注册新域/owner/profile**；不改准入、模型选择、历史与续接策略。受管 ordinary/protected 及 fixed-draft/text-only **明确不注入**（MP04 实测，不只看配置，对齐商圈 TA06）。工具在 Host 侧沙箱子进程执行，纯本地计算，无网络出口、无凭据需求（egress=none）、无经营副作用。

实施后复验：`npm run check` 全量；MP01（验货门各拒绝分支＋dataRoot 无半成品）、MP02（快照不可变/幂等/哈希一致）、MP04（受管/fixed-draft 不注入实测）、MP05/MP06（两工具合同：只读无副作用／任意路径拒绝＋沙箱 fail closed＋出处随行＋失败信封）、MP07（合成 Provider 端到端：开启任务中 Agent 自主发现→备数→预测→报告注明出处，无逐调用确认；未开启任务无此行为）、MP08（目录条目文案与能力一致）、MP03（App.tsx 接线后浏览器点验注册表页列表/详情/晋级）、MP10（既有链路回归＋`npm run check`）。MP09 真实包冒烟须先获 MacBook 只读拷贝授权（证据留 `.local/`，不入公开仓）。

### 3. 非作者独立复核（干净上下文子 Agent）

用下方任务书起新子 agent；发现项由 Codex 修复、复跑并请复核者重验受影响范围；报告追加至本目录（如 `independent-review.md`）。

> 你是一名独立复核 Agent，未参与本候选任何部分的创作，也不带作者的会话历史。请按任务书独立工作，不采信任何“实现已没问题”的预设。
>
> **复核对象**：OptraCall `qoder/model-pack` 分支“模型包消费端”候选（`openspec/changes/model-pack-consumer/candidate-manifest.txt` 固定身份；Codex 接缝实施后的增量一并纳入）。
>
> **必须遵守**：1. 源文件、测试、规格、既有证据只读；临时文件只写自行创建的隔离目录（mktemp）。2. 先从验收导出预期：通读 spec.md（MP01–MP10、R1–R8、D1–D8、IN01）与已确认 UI Demo，自行写关键预期清单再核对实现，不照 result.md 复述。3. 独立检查关键路径：`types.ts` 的 `validateManifest`/`toRegistryEntry` 与真实 MPS manifest（order-forecast v1）字段一致、各拒绝分支正确（formatVersion≠1/name 模式/version/task 枚举/fingerprint/metrics/usage/training）；接缝侧——验货门纯度重扫与沙箱冒烟 fail closed、快照不可变与幂等（同 name+version 字节一致通过/不一致拒绝）、晋级状态机（同名唯一 Production、旧版自动归档）、`modelpack_predict` 仅注册表 name+version 解析（任意路径拒绝）、`node --permission` 沙箱越界/网络 fail closed、结果出处随行（name/version/stage＋指标＋指纹）、受管/fixed-draft 不注入（MP04 实测非仅配置）、目录条目文案与能力一致、HTTP 面与 client 契约一致；公开仓无经营数据与真实包字节。4. 可运行验证：`node --test tests/model-pack-types.test.ts tests/model-pack-client.test.ts`；`npm run check`；抽查同输入两次 predict 输出一致；MPS 只读参考仓 `/Users/huangbo/Dev/Projects/model-mlflow`（可 `ssh macbook` 只读取 manifest/predict 对照，不修改该仓）。5. 如实记录检查范围、命令与退出结果、发现（严重度/位置/理由）、未验证项。
>
> **产出**：复核报告（预期清单→逐项 PASS/FAIL/待验证＋证据位置→发现与处置→总结论），写入隔离目录并回报路径与摘要。

### 4. Git/CI 交付（先向用户申请授权）

集成最新 main 并重验受影响部分 → push → 单 PR → 实际 head CI → 用户确认后 squash 合并 → 本地 main 安全快进 → 更新规格/结果、OpenSpec 原位归档。

### 5. 后续边界（各自另行授权，不随本变更）

真实模型任务实测（MP07 合成 Provider 端到端属工程验证，真实模型另计）、MP09 真实包冒烟所需 MacBook 只读拷贝、MPS 仓 README/导出包是否注明“OptraCall 消费端已接入”（属 MPS 仓改动，另获该仓授权）、formatVersion≥2 与包格式演进（须两产品同步规格、另立变更）、运行服务采用与 MacBook 更新。

## 本变更特殊性提示（供 Codex 与复核者）

- **两产品契约＝formatVersion=1 manifest**：MPS（MacBook，只读参考，本变更不修改）负责训练与导出，OptraCall 只做薄消费端；包格式变更须两产品同步规格。契约字段以 MPS 实际导出为准，非凭记忆。
- **零会话结构变更**：复用 `project-tasks` 域与既有工具注入缝隙；无新域/owner/profile；Extension 本体不 import pi SDK、不接触会话管理（IN02–IN05 义务在接缝侧）。
- **确定性数字红线**：`modelpack_predict` 是“数字出自脚本不经 LLM 心算”红线的必须项；工具性质＝能力注入非编排（只返回带版本的事实、无步骤/配额/门槛、结果不经 Host 二次加工）。
- **沙箱为本仓首次引入 `node --permission`**：属最小适配缺口（外部生成代码跨信任边界的必要环境治理），沿用 MPS 已验证模式，fail closed，不引入 MLflow 或新第三方依赖。
- **IN06 状态**：Qoder 未实施任何接缝（本变更无 sim-lab 式流程偏差）；接缝由 Codex 实施为默认归属，无需例外记录。

## Codex 启动 Prompt（可直接粘贴使用）

```text
接管 OptraCall 分支 qoder/model-pack 的“模型包消费端”变更（Qoder 已整体移交，你为唯一写入者）。

先读（顺序）：docs/engineering-workflow.md（§2 移交交付模式与 IN01–IN07）、
openspec/changes/model-pack-consumer/spec.md 与 result.md、本文件 review-handoff.md。

第一步：先向用户申请 Git 授权；获授权后 git fetch origin，把 Qoder 未提交的 9 个新增
文件＋本包固定为单一移交提交（不改字节），再按 candidate-manifest.txt 逐项核对 10 个
文件的 SHA-256 前 16 位（基线 origin/main=2b9800b 或其后代）。发现差异立即停止并向
用户报告，不回写清单。

然后按 review-handoff.md“Codex 任务序列”§2 实施 Host 接缝（HTTP 面精确满足
model-pack-client.ts 契约、验货门+快照不可变/幂等+SQLite 注册表+晋级状态机、
modelpack_list/modelpack_predict 两正交工具沿 tradeAreaTools 缝隙注入、task-capabilities
新增 modelTools、catalog plugins 条目+App.tsx 视图挂载与 model-pack.css 导入）；
交互形态以已确认 UI Demo 为准；受管/fixed-draft 不注入须实测（MP04）；复用 project-tasks
域，无新域/owner/profile。复跑 npm run check 并逐项验收 MP01–MP08、MP10（MP09 真实包
冒烟须先获 MacBook 只读拷贝授权）。

接着起干净上下文非作者子 Agent 独立复核（任务书在 review-handoff.md §3），修复后重验。

Git/CI 交付前先向用户申请授权：集成最新 main→单 PR→实际 head CI→用户确认后 squash
合并→快进 main→OpenSpec 原位归档。

边界：接缝修复全程由你承担；Qoder 对本分支只读；MPS 仓 /Users/huangbo/Dev/Projects/model-mlflow
只读参考不修改；公开仓不得出现经营数据或真实包字节；不切换运行服务、不操作 MacBook
开发侧（只读 ssh 取数除外）；formatVersion≥2 与真实模型实测另行授权。
```

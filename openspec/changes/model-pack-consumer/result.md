# 模型包消费端 · 实施与验证记录

日期：2026-11-05 · 分支：`qoder/model-pack`（基线 main `2b9800b`）· 责任：**Qoder 完成 Extension 本体切片；Host 接缝归 Codex（工程规范 v1.6 默认，无 IN06 例外）**

本记录只覆盖 Qoder 侧 Extension 切片的实施与适用检查。Host 接缝（store/routes/工具注入/task-capabilities/catalog/App.tsx）、依赖接缝的验收（MP01–MP02、MP04–MP10）、真实包冒烟（MP09）、独立复核、Git/CI 与真实模型实测均**未在本阶段执行**，见末尾「如实保留的缺口」。

## 1. 已实施（Qoder Extension 切片）

| 文件 | 行 | 职责 | 归属 |
| --- | --- | --- | --- |
| `extensions/business-plugins/model-pack/types.ts` | 199 | 包 manifest（formatVersion=1）与注册表货架记录的类型合同；纯校验 `validateManifest`（结构/字段各拒绝分支）、`toRegistryEntry`（manifest＋导入事实折叠）、`metricLabel`（展示格式化）；常量 `MODEL_NAME_PATTERN`/`MODEL_TASKS`/`MODEL_STAGES`/`TASK_LABELS`；结构化错误 `ModelPackValidationError` | Qoder |
| `extensions/business-plugins/model-pack/ui/model-pack-client.ts` | 45 | `/api/model-pack/*` fetch 封装（listModels/getModel/importPack/promoteModel），镜像 `simlab-client.ts`（same-origin、`x-optracall-client`、credentials omit、no-store）；`ModelPackRequestError` 携带 `code/status/message/detail{stage,reason,hint}` | Qoder |
| `extensions/business-plugins/model-pack/ui/ModelRegistryPage.tsx` | 277 | 注册表页（场景①）：货架列表＋排序、行详情（指标/指纹/训练/用法）、导入对话框（验货阶段如实回显）、晋级确认对话框（同名唯一 Production）；复用 `CaseDialog` | Qoder |
| `extensions/business-plugins/model-pack/ui/model-pack.css` | 82 | 页面样式，沿用 OptraCall 全局 token（`--accent`/`--line`/`--ok`/`--warning` 等），表格横向滚动、详情栅格响应式 | Qoder |
| `tests/model-pack-types.test.ts` | 162 | 14 项：真实 MPS manifest 通过、formatVersion≠1、name/version/task/fingerprint/metrics/usage/training 各拒绝分支、groups 保留、非对象输入、toRegistryEntry 折叠与哈希/stage 拒绝、metricLabel | Qoder |
| `tests/model-pack-client.test.ts` | 116 | 6 项（stub fetch）：listModels GET＋头/凭据、getModel name+version 路径、importPack POST sourcePath、promoteModel POST＋archived 回执、拒绝导入的结构化失败信封、无 code 回落默认码 | Qoder |

契约权威：`manifest.json` 字段以 MacBook 只读参考仓 MPS 实际导出 `order-forecast/v1/manifest.json` 为准（`model{name,version,stage}`、`goal`、`data.fingerprint{sha256,rows,columns}`、`metrics`（含 `:target` 重复键）、`training{splitSeed,task,targets,trainedAt,sessionRef,groups?}`、`usage{inputs,outputs,form}`）；测试夹具即该真实 manifest。

## 2. 验证证据（Qoder 侧，本机隔离工程环境）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型合同测试 | `node --test tests/model-pack-types.test.ts` | 14/14 PASS（先 RED：模块缺失 `ERR_MODULE_NOT_FOUND`，实现后 GREEN） |
| 客户端合同测试 | `node --test tests/model-pack-client.test.ts` | 6/6 PASS（先 RED 后 GREEN） |
| 合并测试 | `node --test tests/model-pack-types.test.ts tests/model-pack-client.test.ts` | 20/20 PASS |
| 项目类型检查 | `npm run typecheck`（tsc --noEmit） | exit 0（types.ts/client.ts 经测试导入进入 tsc 图） |
| 页面严格类型核对 | `tsc --ignoreConfig --strict … ModelRegistryPage.tsx` | exit 0（页面尚未被 App.tsx 导入，独立核对，见缺口③） |
| 全量检查 | `npm run check` | **exit 0**；agent-session 边界 PASS；测试 1477 项：1447 PASS／0 FAIL／30 条件 SKIP；`vite build` 成功（`0.1.0-mvp.4 2b9800b+local-changes`） |

依赖：未新增任何第三方依赖（沙箱用 Node 自带 `--permission`，属 Host 接缝侧）；`node_modules` 经 `npm ci`（与 main 同一 `package-lock.json`，offline 命中缓存）安装，未改 lock。

## 3. 验收映射（本阶段）

| 标识 | 状态 | 说明 |
| --- | --- | --- |
| MP03（注册表页） | **部分** | 页面/交互/文案已实现并 standalone 类型核对通过，结构对齐已确认 UI Demo；浏览器点验待 App.tsx 接线（缺口③） |
| MP01/MP02/MP04–MP10 | **待接缝** | 验货门、快照不可变/幂等、启用边界、两工具合同、合成 Provider 端到端、目录条目、真实包冒烟、回归——均依赖 Host 接缝，归 Codex 实施后验收 |
| —（无回归） | **通过** | `npm run check` 0 FAIL，既有 1457 项测试与构建未受影响 |

## 4. 四原则前置检查（切片实走结论）

- **Host 管环境／Agent 自主**：Extension 切片只提供注册表 UI 与只读/执行工具的**消费端合同**；验货、快照、沙箱、权限门、工具注入全在 Host 接缝（Codex），页面不含任何分析流程编排。
- **复用 Pi 既有能力**：不新建会话域/owner/profile（复用 `project-tasks`）；`modelTools` 沿 `tradeAreaTools` 同一任务能力注入缝隙；存储沿 `node:sqlite`＋dataRoot 快照先例；页面复用 `CaseDialog`、客户端复用 `simlab-client` 形态。
- **减少人的操作**：正常分析用户新增必做操作＝0（能力开关是既有任务级模式）；必做人工仅 2 个——导入包（外部代码进入受信执行边界的必要授权）、晋级 Production（业务取舍，D4 最小人审），均在页面显式确认。
- **确定性数字红线**：`modelpack_predict` 为确定性引擎工具（数字出自模型脚本，不经 LLM 心算），属「必须做」项；不设组合工具（多模型对比由 Agent 自主组合多次调用，对齐商圈 D10）。

## 5. 如实保留的缺口（Codex 无需重复报告，但需判断记录是否准确）

1. **Host 接缝未实施（归 Codex）**：`src/host/model-pack-store.ts`（验货门/快照/SQLite 注册表/晋级状态机）、`src/host/model-pack-routes.ts`（HTTP 面）、`src/agent/` 两工具定义与注入、`src/host/task-capabilities.ts` 新增 `modelTools`、`src/host/ui/catalog-data.ts` plugins 条目、`src/host/ui/App.tsx` 视图接线与 `model-pack.css` 导入。消费端期望的接缝契约见 [review-handoff.md](review-handoff.md)「接缝互查导引」。
2. **MP01/MP02/MP04–MP10 待接缝后验收**；MP07 合成 Provider 端到端、MP09 真实包冒烟（MacBook 只读拷贝须另授权）未做。
3. **页面浏览器点验（MP03）待 App.tsx 接线**：当前页面未进入产品路由，仅 standalone `tsc` 严格核对通过＋对齐已确认 Demo；集成后的真实浏览器点验属接缝阶段。
4. **独立复核未做**：完整候选（含 Codex 接缝增量）固定后按工程规范 §4 起全新非作者子 Agent。
5. **Git/CI 未启动**：提交/推送/PR/CI/合并须先获用户明确授权（实现授权≠Git 授权，对齐商圈/天气先例）。本工作树 `node_modules` 为 `npm ci` 真实目录（gitignore），无符号链接残留。
6. **真实模型任务实测、运行服务采用、MacBook 更新**：各自另行授权，不随本变更。

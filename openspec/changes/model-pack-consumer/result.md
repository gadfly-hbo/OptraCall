# 模型包消费端 · 实施与验证记录

日期：2026-11-05 · 分支：`qoder/model-pack`（基线 main `2b9800b`）· 责任：**Qoder 完成 Extension 本体切片；Host 接缝归 Codex（工程规范 v1.6 默认，无 IN06 例外）**

第1–5节保留 Qoder 阶段 Extension 切片及当时缺口，未回写为当时已完成；第6节起为 Codex 接管、修复和独立复验的实际记录。当前本地工程与非作者复验完成，Git/CI交付尚待；MP09、真实模型、运行与设备采用未执行。

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

## 6. Codex 接管与本地实施（2026-11-05，最终交付待补）

用户已授权本轮 Git/CI，实际 head CI 通过后直接 squash 合并、快进 main 和原位归档；MP09 拷贝、真实模型、运行采用与设备更新不包含在内。

### 身份与保全

- 原树 `b04979/OptraCall` 在基线 `2b9800b`：10 项候选加清单自身，共 11 项新增；已跟踪和 index 无差异。
- fetch 后 origin/main=2b9800b；10/10 SHA-256 前16位一致。原样单一移交提交 `380d5ab5aa17d2e1a087b523d4b668ef6c5972c9`，推送后原树游离；Codex 在独立 `model-pack-delivery/OptraCall` 检出并再次核验 10/10。原清单不回写。
- 所有原件、命令日志及验证产物在该工作树被忽略的 `.local/model-pack-delivery/`；原字节副本及核验在 `intake/`。没有真实包导入或经营数据进入新增验证夹具。
- 原 types 测试确为真实 MPS manifest 的训练/评估和来源元信息，不称全合成；不含行级经营记录、模型权重或凭据。新增包/预测/Provider/UI 夹具全部合成。

### 实施范围

Host store/routes、SQLite 注册表、验货/快照/状态机、值传递沙箱及两个正交工具已接线。modelTools 沿 schema2 可选字段和原项目任务 profile；普通 unmanaged 显式开启才注入，受管 ordinary/protected、固定/封闭文本及业务 workspace 排除。目录/页面导航、完整 manifest、两处任务开关沿既有 UI。原 Qoder 页面缺少全文、通用 CSS 泄漏和失败回执措辞亦在本轮修复。

结构与权限依据见 spec §13。没有新第三方依赖、锁文件、域/owner/profile、训练/MLflow、Provider 或推理循环；没有修改 MPS 仓、切换产品服务或更新设备。

### TDD 与失败记录

- 真实行为 RED：开启后实际 SDK 工具列表缺两工具（agent-author/01）；只读货架工具失败（03）；Host modelTools 保存丢失（04）；真实 HTTP import 404（06）。原 Pi/合成 Provider 全链路和自主纠错随后通过，所有首轮失败保留。
- root `02-store-behavior-red.log` 为合法包导入不可用的行为 RED；`01-store-red.log` 是 Node strip-only 不支持 parameter property 的脚手架错误，不计产品 RED。原 Qoder 记录中的 ERR_MODULE_NOT_FOUND 同样仅证明模块尚缺，不能作为某个确定性行为已被检出的证据；其原记录不抹去。
- security-author/01 捕获 computed `Math['random']` 漏扫，修复后 GREEN；其后安全分支是新增回归，并不补造前置 RED。初始化日志目录和篡改夹具 EACCES 也不计产品 RED。
- root/13 显式重导恢复 RED→14/15 GREEN；原“同原包显式重导也拒绝”的测试改为保留只读不修复断言，并由专门恢复测试覆盖新行为，未削弱冲突/原件保护。
- root/16 捕获取消返回时子进程仍存在；修复为等待 close，重验在17。最终结果不能靠仅发送 kill 声称资源已收回。
- UI 首轮目录/详情 RED、浏览器纯度拒绝的阶段显示失败及后续阶段/明确503拒绝 RED 均保留于 ui-author/；网络/不明500继续 UNKNOWN，不自动重放。
- 初次完整检查日志11为实施中参考：1517项，1487PASS/0FAIL/30SKIP，边界/tsc/构建成功；当时其他安全回归尚在补充，**不作为最终固定候选的全量证明**。最终完整检查、复核和 Git/CI 以下续记。

### 浏览器与范围

首次 browser provider 报本机设置禁用，agent-browser CLI 不可用；经用户明确要求强制退出重启 Chrome 后，以 native Chrome CUA 完成隔离 Host 实际页面点验。浏览器环境仅合成配置、项目与包，不发送消息或调用真实 Provider。当前证据在 `qa/`：条目/空列表、导入、原 manifest、晋级确认、唯一 Production+旧版 Archived、两处能力开关。阶段显示修复后复验及完整回执待下文补。

### 未授权/未验证保持

MP09 未授权、NOT_RUN，不借合成 Provider 或包替代真实 MPS 包一致性。只读参考时指定 order-forecast/v1 路径已不存在；目录核对后仅查看现有 e2e 包的 CLI 封套，不拷贝/执行包，也未将这些私有内容写入公开文件。真实模型效果、MPS README、formatVersion≥2、运行采用与 MacBook 更新均未执行。

浏览器工程点验现已完成：`qa/browser-receipt.json` 固定 23 份 AX/截图证据；修正后的纯度失败步骤已实际显示为失败，其余后续步骤保持未运行。另以合成快照损坏→标记→显式重导走通恢复，原 Production、安装时间和两个历史版本保留，损坏字节仍在隔离目录。设置返回注册表、注册表返回 plugins 目录均通过。仅桌面浅/深色，不宣称移动端点验。验收标签页已关闭、隔离 Host 已停止；0 消息/连接测试请求，0 真实 Provider 调用。截图中使用的全是合成环境。

`19-utf8-red.log` 另检出沙箱 stdout 分块逐段解码会损坏中文，已改为汇总字节后解码；20 GREEN 保留中文原字节，数值不变。此后仅沙箱传输实现变化，不影响已点验的 UI 资产和交互。

## 7. 固定候选 v1 及非作者发现（2026-11-06）

- v1 全量候选 938 文件，清单 `candidate-v1.json` SHA-256 `cf86bec127ff0293f001658b5a273b1f85413002e8c3fb3751ff711940eaddf2`。其后完整 `npm run check`（21-full-check-v1.log）exit 0：**1554 项／1524 PASS／0 FAIL／30 既有条件 SKIP**，边界、tsc、构建均通过。下述发现说明测试全绿并不能代替独立复核，该 PASS 不套用于修正版。
- 两个非作者均全新 `fork_turns=none`，先由 spec/Demo/规范导出预期，再查看实现与作者结论；938 文件逐项核对，在各自隔离副本验证，原源码与证据只读。规格复核独立目标96项，规范轴107项，各自 boundary/tsc 通过；浏览器为核对 root 固定 AX/截图，未声称亲自操作。
- **P2-SCHEMA**：既有未知 SQLite 版本会先被 user_version=1 降级；失败校验连接的缓存也可令第二次只读 list 绕过检查。原规范复核者有实际字节变化与缓存绕过探针，规格复核亦复现。root/22 复现 RED；现在仅新库事务初始化，现有版本及表/索引 inventory 先校验，失败连接关闭且不缓存，重复读取/晋级和 schema1 未知表同样拒绝且字节保持，23/26 GREEN。
- **P2-GROUPS**：已提供但非法 training.groups 被丢弃并接受入库。按原规格字段合法合同修正（不改 v1）：省略保持兼容，已提供值必须满足 Record<string,string[]>；root/24 RED→25/26 GREEN，Qoder 原测试仍通过，原10候选清单保持。
- **P2-STEP-AX**：验货步骤的失败/未运行项仍在 AX 中读出装饰“✓”，仅靠颜色不准确。原 AX、截图及独立报告保留，最小可访问性修复与实际页面重验另记，不把旧证据重写为已正确。
- sandbox/AST 独立探针另核网络、文件写、子进程、SQLite 和代码生成拒绝；拼接构造器可能不被 AST 单独识别，实际沙箱拒绝执行，按组合边界记录，不称静态扫描已穷尽恶意代码。spawn 使用不继承父环境，macOS 自动环境变量不作为父凭据继承。
- 原报告分别保存在 `review-spec-3wjmdmdt/report-v1.md`（SHA `3bb39b9eea6bfe4b9be315e33c503ab56a5f7648360cc34fb6207039b1f7666b`）和 `review-standards-20261105T235923-37d8eac0/report-v1.md`（SHA `8e792fa9d4323fd21607787a776a1b405abd8412285f921af25d5d2a6c119e36`），有效失败与补充探针均保留。最终复验未结束前，不写成独立复核 PASS。

原切片逐项行为前置 TDD 的历史证明仍 **NOT_PROVED**（原模块缺失记录不能追溯补证）；本轮对该事实的如实披露不等于把历史过程改成已合规。当前功能、工程检查与独立复核结论另以固定候选和实际结果判断。

## 8. 修正版 v2 本地工程收尾（2026-11-06）

939文件清单 SHA `9ba1d746865f70adbbecf2dfed17a0d3bfc0adb62fb803cbfd716239af9d844e`，运行前后源文件零漂移。最终完整检查29 exit0：**1558项／1528 PASS／0 FAIL／30原条件SKIP**，agent-session边界、tsc和Vite/stamp通过；日志 SHA `48f3f6f676e38b2beec839ae207bb7a3925c485f53771d24c81410e7ce51b191`。依赖高危级审计exit0，0高危/0严重、2项既有moderate保留；原构建体积提示保留，不把局部或跳过写成全通过。

两位原非作者对三个P2均完成复验，适用结论与职责/复用专项通过，详见 [独立复核](independent-review.md)。新3份AX/截图经双轴读回：失败2通过/1失败/2未运行，成功5通过，装饰勾不进入AX；原23份UI证据保留。自建浏览器标签页和隔离Host均已收回，0 messages/open/connection-test请求。

| 标识 | 当前工程验收 | 证据与范围 |
| --- | --- | --- |
| MP01 | PASS | 结构/字段/纯度/冒烟各拒绝与无快照半成品，含groups修正；security/store/独立负例 |
| MP02 | PASS | 原始三件字节、只读、幂等、冲突、版本保留、显式损坏恢复、未知schema无写、重复校验和并发 |
| MP03 | PASS | 真实桌面Chrome：导入、全文、确认晋级、唯一Production、旧版Archived、失败/未运行可访问状态、显式恢复 |
| MP04 | PASS | 任务默认关/持久与开关复用/空闲与归档；实际SDK普通开启与全部受管/封闭/业务workspace排除，原native保留 |
| MP05 | PASS | 两工具之一只读查货架，注册表/快照字节mtime保持 |
| MP06 | PASS | 注册表身份解析、项目安全文件、真实Node权限/网络拒绝、确定性/UTF-8、出处、实际取消等close、首失败保留 |
| MP07 | PASS（工程合成） | 实际Host/Pi合成Provider自选list/write/predict/read/report；另一例不强制list、自行修输入重调，无Host重试/逐次确认 |
| MP08 | PASS | plugins条目已接入、训练在MPS/本机执行文案、正确导航/标题/设置及目录返回 |
| MP09 | NOT_RUN | 未授权真实包拷贝；不以合成包或MPS CLI只读参考冒充 |
| MP10 | 本地PASS | 完整1558项与构建；实际head CI仍按Git交付后另记 |

以上为本地工程验收及独立复核，不是CI、真实模型质量、产品验收或运行采用。原20项类型/client的历史行为前置TDD证明NOT_PROVED保持。下一步在本轮Git授权内核对最新main、集中单PR和实际head CI，再按用户已授予的成功后直接合并/快进/归档安排完成交付。

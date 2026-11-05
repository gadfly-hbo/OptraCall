# 模型包消费端（薄接入：加载器 + 注册表 + 分析调用）

状态：规格 v0.2（2026-11-05，用户已整体确认；Qoder Extension 切片已实施并通过适用检查，Host 接缝待 Codex）。

**确认与实施进度（2026-11-05）：** 用户已明确「按推荐采纳；UIdemo通过」——D1–D8 全部按推荐采纳，[UI Demo](../../../docs/prototypes/model-pack-consumer-ui-demo.html) 通过 UI Gate（页面信息结构/交互流程/文案确认；视觉细节以正式实施为准）。按工程规范 v1.6 与 §6 移交模式启动实施：**Qoder 已完成 Extension 本体切片**（`types.ts` 合同与纯校验、`ui/model-pack-client.ts`、`ui/ModelRegistryPage.tsx`、`ui/model-pack.css`、`tests/model-pack-types.test.ts`＋`tests/model-pack-client.test.ts`），本地 `npm run check` exit 0（1477 项：1447 PASS／0 FAIL／30 条件 SKIP，含 agent-session 边界 PASS），页面经 standalone `tsc` 严格类型核对通过；实施与证据见 [result.md](result.md)。**Host 接缝（store/routes/工具注入/task-capabilities/catalog/App.tsx 接线）维持工程规范 v1.6 默认归属 Codex，用户未对本变更直接指定 Qoder 实施接缝（无 IN06 例外）**；移交包见 [review-handoff.md](review-handoff.md)。MP01–MP02、MP04–MP10 依赖 Host 接缝，待 Codex 实施后验收；MP03 注册表页浏览器点验待 App.tsx 接线后进行。**Git 提交/推送/CI/合并未启动，须先获用户明确 Git/CI 授权**（对齐商圈/天气先例：实现授权不等于 Git 授权）；真实包冒烟（MP09）的 MacBook 只读拷贝亦须另行授权。

2026-11-05 · 用户已确认方向：**OptraCall 侧只做薄消费端——“模型包加载器 + 注册表视图 + 分析 skill 内调 predict”，训练仍在 MPS 走**。训练侧为 MacBook 本机独立产品 Model Pack Studio（`/Users/huangbo/Dev/Projects/model-mlflow`，只读参考，本变更不修改该仓），其 D4 定案“打包带走”明确：交付物＝自包含纯 Node 包，**包格式（formatVersion=1）是两产品间契约，OptraCall 侧加载器走本仓 openspec 流程**；`formatVersion` 变更须两产品同步规格，本变更只消费 v1。

包结构（MPS `workspace/exports/<model>/v<n>/`，实测样例 order-forecast v1）：

```
predict.mjs     模型本体：零第三方依赖纯 Node，权重内联，导出 predict(rows)→rows；自带 CLI 批处理（node predict.mjs in.csv out.csv）；无 I/O/随机/时钟
manifest.json   formatVersion=1：模型名/版本/stage、训练目标、数据指纹（sha256+行数+列名）、留出重算指标、训练信息（splitSeed/task/targets）、usage（inputs/outputs/form）
README.md       人读用法与指标说明
```

## 1. 用户能得到什么

用户在 MPS 训练好模型、拿到导出包后，在 OptraCall 里**导入一次**，模型即上“货架”（注册表页）：看得见名字、版本、状态、训练指标与数据指纹；点一下可把 Staging 升为 Production（最小人审）。

之后在项目任务对话中（任务级开启“模型预测工具”后），Agent 自主完成全部使用链路：查货架 → 按 manifest 声明的输入列从项目 020 资料备输入 → 沙箱执行 predict → 拿确定性预测数字写报告，并注明出处（模型名/版本/留出指标）。用户正常提问零新增必做操作；预测数字出自模型脚本，不经 LLM 心算。

新增的只有：一个注册表页面、一个导入动作、一个任务能力开关、两个正交工具。训练、指标重算、效果回流全部不在本变更。

## 2. 固定现状与复用依据

| 接入点 | 核实的现状 | 本变更差额 |
| --- | --- | --- |
| 能力目录 `src/host/ui/catalog-data.ts` | 四分类 assets/scenarios/connectors/plugins；条目含“已接入”徽章与导航（metric/simlab/refiner 先例） | plugins 分类新增“模型包”条目，导航注册表页 |
| 任务能力 `src/host/task-capabilities.ts` | 三个可选布尔：simulationTools/tradeAreaTools/weatherTools；任务级显式开启（schema2 兼容字段） | 新增 `modelTools`，同一机制，不新建开关体系 |
| 会话接入 `src/host/agent-sessions.ts` | Interface v3；项目任务域 `project-tasks`；受管 ordinary/protected 与 fixed-draft/text-only 有各自禁用策略 | **复用 project-tasks 域，不注册新域/owner/profile** |
| 存储 | `node:sqlite` DatabaseSync（case-store 先例）；dataRoot 快照（trade-area `dataRoot/connectors/` 先例） | 注册表元数据入 SQLite；包文件快照入 `dataRoot/models/<name>/v<n>/` |
| 沙箱执行 | 本仓现无 `node --permission` 执行先例 | **最小适配缺口**：外部生成代码进入受信执行边界，须沙箱；沿用 MPS 已验证的 `node --permission` 模式（fail closed），理由与环境治理定位见 R6/D5 |
| 分析 skill | coupon/target/roi-forecast 等“数字出自脚本不心算”红线 | 模型预测成为同类确定性数字来源，红线口径不变 |

## 3. 范围

- 新建 `extensions/business-plugins/model-pack/`（Extension 本体，Qoder 归属）：
  - `ui/ModelRegistryPage.tsx` + `model-pack-client.ts` + `model-pack.css`：注册表页（货架列表/导入对话框/详情/晋级）；
  - `types.ts`：包 manifest（formatVersion=1）与注册表条目的类型合同。
- Host 接缝（**Codex 归属，按工程规范 v1.6 默认**；如用户对本变更直接指定 Qoder 实施，按 IN06 记录例外范围、理由及后续维护回归 Codex 的安排）：
  - `src/host/model-pack-store.ts`：验货门（结构/纯度重扫/沙箱冒烟）、dataRoot 快照落位、SQLite 注册表（name/version/stage/metrics/fingerprint/installedAt/sourcePath）、晋级状态机（同名唯一 Production，晋级自动归档旧版）；
  - `src/host/model-pack-routes.ts`：导入/列表/详情/晋级 HTTP 面；
  - `src/agent/`：`modelpack_list` / `modelpack_predict` 两工具定义与注入（沿 tradeAreaTools 注入缝隙）；predict 执行器＝注册表解析包路径 + `node --permission` 沙箱 + 结构化失败信封；
  - `src/host/task-capabilities.ts`：新增 `modelTools`；
  - `src/host/ui/catalog-data.ts` + `App.tsx`：目录条目与注册表视图接线。
- 新增测试：验货门各分支、存储幂等/不可变、晋级状态机、工具合同（参数校验/注册表外路径拒绝/沙箱失败信封/受管不注入）、合成 Provider 端到端、`npm run check` 全量。
- 真实包冒烟：从 MacBook 只读拷贝 MPS 实际导出包（order-forecast v1）至 `.local/model-pack-ref/`，走真实导入+预测链路（证据留 `.local/`，不入公开仓）。

## 4. 不做

- **不做训练侧任何能力**：训练会话域、围栏、预算、指标重算、纯度门上游实现、MLflow——全部留在 MPS；
- 不做效果回流（actuals 评估，MPS 切片三已有）；注册表只展示导入时 manifest 内的训练指标，不重算、不新增 eval run；
- 不做对话内晋级命令（薄消费端只留注册表页按钮）；
- 不做自动同步/监听 MPS 导出目录（导入是显式动作）；
- 不做 formatVersion≥2、不做包格式演进（变更须两产品同步规格，另立变更）；
- 不做跨机/远程模型服务、模型市场；
- 不引入 MLflow 或任何新第三方依赖（沙箱用 Node 自带 `--permission`）；
- 不注册新会话域/owner/profile，不建平行 Runtime，不改模型配置。

## 5. 决定项（D1–D8，推荐已标注，待用户确认）

- **D1 目录归属＝plugins 分类“模型包”条目（推荐）**。用户框架即“业务插件模块”；有专用页面+版本化工件+Host 存储，形态对齐 simlab/refiner。代价：与 metric-factory（assets 分类、同为版本化库）存在分类口径差，条目文案需写清“模型是训练产出的可执行资产”。备选：归 assets。
- **D2 安装方式＝本机文件夹路径导入（推荐）**。两产品同机，MPS 导出目录直选；Host 校验后**拷入** `dataRoot/models/`（快照固化，源目录随后可删）。代价：路径输入须严格校验（只认含合法 manifest 的目录，防任意路径读取）。备选：上传 zip（多一步打包，无同机必要性）。
- **D3 验货深度＝结构+纯度重扫+沙箱冒烟（推荐）**。模型代码是 MPS 侧 agent 生成物，跨信任边界不沿用上游扫描结论；单文件重扫+一行冒烟成本低。不过＝拒绝导入并给结构化原因。代价：导入多几秒。
- **D4 晋级语义＝导入即 Staging，用户点击升 Production；同名唯一 Production，晋级自动归档旧版（推荐）**。继承 MPS D3“人审不可绕过”最小形态。分析工具默认只调 Production；Agent 显式指定版本可调 Staging（对比验证用），结果卡如实标注 stage。
- **D5 分析接入＝Host 注入两个正交工具，任务级显式开启（推荐）**。`modelpack_list`（只读货架事实）+ `modelpack_predict`（确定性引擎）；**不设组合工具**（多模型对比等由 Agent 自主组合多次调用，对齐商圈 D10 判据）。predict 只按注册表 name+version 解析包，不接受任意路径（IN05：插件不经消息中任意路径绕过配置）。否决“Agent 直接 bash 跑包”：包在 Host 管理的 dataRoot、普通项目 bash 不保证 `--permission` 沙箱、任意路径执行绕过注册表权限边界。工具性质＝能力注入非编排：只返回带版本的事实、无步骤/配额/门槛、结果不经 Host 二次加工；确定性引擎型工具是“数字出自脚本”红线的必须项。
- **D6 数据边界＝predict 输入/输出限于该任务已授权项目目录（推荐）**。沿用 020 过程/060 成果约定与既有项目文件权限，不新增数据访问面；输入行在本机沙箱内计算、无网络出口；结果与出处进入任务模型上下文（如实披露，不宣称零数据外传）。
- **D7 效果回流不做（推荐）**。见“不做”第 2 条。
- **D8 存储＝本地 SQLite + dataRoot 文件快照，不引入 MLflow（推荐）**。run/指标/血缘语义已由 manifest 随行承载；注册表只需货架事实。

## 6. Interface 接入记录（IN01）

- 工程规范 v1.6；**Interface v3**（`src/host/agent-sessions.ts`）；**复用项目任务域 `project-tasks`，不注册新域**。
- owner/profile：项目任务既有 owner（projectId+taskId）与配置；`modelTools` 作为该域任务可选能力经既有工具注入缝隙接线，不改准入、模型选择、历史与续接策略。注册表页为纯 CRUD UI，无 agent 会话。
- 修改范围：见 §3（Extension=Qoder；Host 接缝=Codex 默认归属）。工具在 Host 侧沙箱子进程执行，纯本地计算，无网络请求、无凭据需求（egress=none）、无经营副作用；受管 ordinary/protected 及 fixed-draft/text-only 明确不注入（对齐商圈 TA06 语义）。
- IN05：包文件与注册表是 Host 管理资源；业务侧只见 name/version 引用，不经任意路径/密钥触达 dataRoot。IN06：本变更不改既有工具契约；`modelTools` 为 schema2 向后兼容新增可选字段。IN07：交付覆盖正常/取消/失败信封/受管不注入/既有消费者回归；导入约束进 `npm run check`。
- 移交模式适用：Qoder 在 `qoder/model-pack` 分支完成 Extension 本体与适用检查后，按工程规范 §2“Qoder→Codex 移交交付模式”固定候选并移交；Host 接缝由 Codex 实施至合并。

## 7. 关键规则

- **R1 包快照不可变**：导入产物拷入 `dataRoot/models/<name>/v<n>/` 后只读；重装同 name+version 字节一致＝幂等通过，不一致＝拒绝并提示版本冲突；旧版本永久保留可追溯（对齐 trade-area R1）。
- **R2 工具正交**：`modelpack_list` 只读（name/version/stage/task/metrics/usage.inputs）；`modelpack_predict` 确定性执行（纯度门保证同输入同输出）。组合能力不设工具，Agent 自主组合。命名带 `modelpack_` 前缀防冲突。
- **R3 验货门**：formatVersion=1、三件齐全、manifest 字段合法（name 匹配 `^[a-z][a-z0-9-]{1,40}$`、version 正整数、usage/metrics/fingerprint 齐）；纯度重扫（禁 fs/网络/子进程/eval/包外 import、禁 Math.random/Date）；沙箱冒烟一行通过。任一不过＝拒绝导入＋结构化原因，不落半成品。
- **R4 晋级最小人审**：导入＝Staging；Production 仅用户在注册表页点击（确认对话框）；同名同时唯一 Production，晋级自动归档旧 Production；归档版可查不可调（默认）。
- **R5 启用策略**：`modelTools` 默认关；开启入口两处——新建任务对话框能力清单＋会话内「Pi 能力与命令」面板（仅空闲可切换），对齐商圈/天气先例；受管执行与封闭资源不注入。
- **R6 沙箱 fail closed**：predict 经 `node --permission` 沙箱执行（禁网络、写仅限指定输出路径）；沙箱不可用＝拒绝执行并如实报告，不回落无沙箱运行。执行失败（模型报错/输出缺目标列/非数值）＝结构化信封回传，Agent 自主纠错（换版本/修输入/如实报告），Host 不代跑不重试。
- **R7 出处随行**：predict 结果携带模型身份（name/version/stage）＋留出指标＋数据指纹摘要；Agent 引用预测数须注明模型出处；界面与结果卡不预设模型优劣结论。
- **R8 Agent 自主**：何时用模型、用哪个版本、怎么备输入、怎么解读由 Agent 决定；Host 不编排、不强制“必须用模型”、不设调用配额或逐次确认门槛。

## 8. 四原则前置检查（沿正常/失败/恢复路径实走）

- **正常路径**：用户在开启 `modelTools` 的任务里问“下月各品类销量大概多少” → Agent `modelpack_list` 发现 order-forecast v2（Production）→ 按 usage.inputs 从 020 备输入 CSV → `modelpack_predict` → 数字进报告并注明出处。**用户新增必做操作＝0**（能力开关是既有任务级模式）。
- **Host/Agent 分工**：Host＝验货、快照、注册表、沙箱执行、权限门（环境治理）；Agent＝发现、选版本、备数、解读、引用（自主执行）。Host 不硬编码“先 list 后 predict”流程，不补算、不替换方法。
- **复用依据**：任务能力注入（tradeAreaTools 先例）、SQLite 存储（case-store）、dataRoot 快照（trade-area）、目录条目+导航（catalog 先例）、`node --permission` 沙箱（MPS 已验证模式；本仓首次引入＝最小适配缺口，理由＝外部生成代码跨信任边界的必要环境治理，非重复建设）。
- **新增必做人工动作及不可替代理由**：①导入包——外部代码进入受信执行边界，属必要授权确认，Agent 不得自行安装任意磁盘代码；②晋级 Production——模型上线是业务取舍（D4 最小人审）。其余全部可由 Agent/SDK 完成。
- **失败路径**：验货不过＝结构化原因+不入库+源目录不动；predict 失败＝信封回传 Agent 自主处置；沙箱缺失＝fail closed 如实报告。
- **恢复路径**：导入先验后拷、原子落位，中断无半成品；注册表条目与快照哈希不符（人为破坏）＝标记损坏+引导重新导入，不静默修复。
- **管理/高级范围按需展开**：注册表页是可选管理入口，不是分析必经流程；正常分析用户全程不打开它也能用模型（Agent 自主调用）。

## 9. 验收

| 标识 | 条件 | 对应 |
| --- | --- | --- |
| MP01 | 验货门：合格包导入成功；缺件/formatVersion≠1/name 非法/纯度违规（fs/网络/eval/Math.random 样例）/冒烟失败各分支拒绝并返回结构化原因，dataRoot 无半成品 | R3 |
| MP02 | 快照不可变与幂等：导入后包只读；同 name+version 字节一致重装幂等、不一致拒绝；旧版本保留；注册表哈希与快照一致 | R1 |
| MP03 | 注册表页：列表/详情（manifest 全文、指标、指纹、usage）/晋级（确认框、同名唯一 Production、旧版自动归档）；浏览器点验通过 | R4/D1 |
| MP04 | 启用边界：默认任务无模型工具；显式开启后两工具可用；受管 ordinary/protected、fixed-draft/text-only 不注入；无平行 Runtime、无 SDK 绕过 | R5 |
| MP05 | `modelpack_list`：只读返回货架事实（含 stage 与指标），无写入副作用 | R2 |
| MP06 | `modelpack_predict`：仅注册表 name+version 解析（任意路径拒绝）；`node --permission` 沙箱执行（网络尝试/越界写 fail closed）；输出落任务授权目录；结果带模型身份+指标+指纹出处；失败信封可被 Agent 用于纠错 | R6/R7/D5/D6 |
| MP07 | 合成 Provider 端到端：Agent 在开启任务中自主完成发现→备数→预测→报告注明出处全链路，无逐调用确认；未开启任务无此行为 | R8 |
| MP08 | 能力目录 plugins 分类“模型包”条目：已接入徽章、导航注册表页、文案与实际能力一致（含“本机执行、无网络外发、训练在 MPS”） | D1 |
| MP09 | 真实包冒烟：MPS 实际导出 order-forecast v1（MacBook 只读拷贝至 `.local/`）走真实导入+CLI/工具双路预测，输出与 MPS 侧一致性抽查；公开仓无经营数据 | R1/D2 |
| MP10 | 既有链路回归通过；`npm run check`（含 agent-session 边界检查）通过 | — |

## 10. UI Demo

[原型](../../../docs/prototypes/model-pack-consumer-ui-demo.html)（虚构数据、内存状态、不连真实 Host；四场景：注册表页/导入与验货、任务对话调用、能力目录条目、失败与边界）。**Demo 确认不构成实施启动授权**；实现后截图/测试不替代本前置确认。视觉沿用 OptraCall 现行语言（浅紫 accent #6550c9、14px、细边框）。

## 11. 测试策略

- TDD：验货门/存储/晋级/工具合同先 RED 后 GREEN；合成 Provider 端到端（MP07）；真实包冒烟（MP09，证据在 `.local/`）。
- 回归：既有任务能力开关、商圈/天气注入、受管执行禁用策略、`npm run check` 全量。
- 独立复核：完整候选固定后按工程规范 §4 全新非作者复核＋Host/Agent 职责边界及复用专项检查。

## 12. 未决问题

1. ~~D1–D8 待用户整体确认~~ **已解决（2026-11-05）**：用户「按推荐采纳」，D1–D8 全部按推荐定案。
2. ~~UI Demo 待用户审核~~ **已解决（2026-11-05）**：用户「UIdemo通过」，UI Gate 通过；正式实施沿用 Demo 信息结构，视觉细节以实施为准。
3. ~~Host 接缝归属~~ **已明确（2026-11-05）**：维持默认 Codex（移交模式），用户未直接指定 Qoder 实施接缝，无 IN06 例外。
4. MPS 侧是否同步在 README/导出包内注明「OptraCall 消费端已接入」——属 MPS 仓改动，需另获该仓授权，本变更不动。
5. **待授权（不随实施自动启动）**：① Git 提交/推送/CI/合并；② MP09 真实包冒烟所需的 MacBook 只读拷贝；③ Host 接缝实施后的真实模型任务实测（MP07 合成 Provider 端到端属工程验证，真实模型另计）。

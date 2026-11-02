# 经营推演一期 · 整体移交包（Qoder → Codex）

日期：2026-11-02 · 分支：`qoder/sim-lab`（origin 已推送）· 移交性质：**分支所有权整体移交，Codex 全程负责至合并 main，不再转回 Qoder**

## 移交声明

- Qoder 已完成全部开发（插件本体 + Host 接缝 + 测试 + 文档），以单一交接提交固定候选并推送 origin；Qoder 工作树已切为游离状态释放分支检出权，**此后 Qoder 对本分支只读、不再写入**。
- 后续一切工作由 Codex 在自己的独立工作树（检出 `qoder/sim-lab`）完成：接缝互查、修复与提交、独立复核、Git/CI 交付、合并与收尾；**向用户申请 Git/CI 等授权的主体也转为 Codex**。
- 单一写入者原则：移交后只有 Codex 在该分支提交，避免双写冲突。

## 候选与证据索引

- 候选身份：[candidate-manifest.txt](candidate-manifest.txt)（29 个文件 + 本包，SHA-256 前 16 位；生成于交接提交前，内容与提交一致）。
- 需求与验收：[spec.md](spec.md)（SIM01–SIM13、R1–R10、IN01/IN06 记录）；产品方向：[讨论稿 v0.2](../../docs/SimLab能力承接产品讨论稿_v0.2.md)；已确认原型：[UI Demo](../../docs/prototypes/simlab-ui-demo.html)。
- 实施与验证记录：[result.md](result.md)（验收映射、证据表、已知限制、Host-Agent 边界初查）。
- Qoder 侧现有检查结论：`npx tsc --noEmit` 通过；`node --test tests/simlab-*.test.ts` 15 项 PASS；`node --test tests/simlab-agent-flow.test.ts` PASS（合成 Provider 驱动真实 SDK 工具链）；`npm run check` 两次全量 PASS；隔离 QA 环境浏览器点验通过（页面操作 Provider requestCount=0）。
- 如实保留的缺口（Codex 无需重复报告，但需判断记录是否准确）：SIM11（快照接 Case 呈现，Q5 未对齐）未实现；SIM08 对话内建议卡片未单列；受管任务未运行验证（按设计不注入）；真实模型端到端未做；CAS 跨进程残余竞争窗口（result.md）。

## Codex 任务序列

### 1. 接缝互查并直接修复

范围（Codex 归属、Qoder 按 IN06 先例实施）：`src/host/server.ts`、`src/agent/project-session.ts`、`src/agent/project-runtime.ts`、`src/host/project-store.ts`、`src/host/ui/{App,ProjectDialogs,catalog-data,project-types,runtime-client}`、`scripts/check-agent-session-boundary.mjs`。核查点：

1. 复用项目任务域，未新建域/profile/owner，无平行 Runtime、无 SDK 绕过（IN02–IN04）；
2. `simulationTools` 仅普通（非受管、非封闭文本）任务且开关开启时注入；defaultTools 追加语义正确；
3. `TaskRecord.simulationTools` 可选布尔，schemaVersion 2 旧元数据兼容；
4. 任务开关"新会话打开后生效"与 agent-sessions 复用逻辑一致；agentOptions 可 IPC 序列化；
5. `/api/simlab/` 挂载与既有插件一致；归档只读；路由错误不被 server 通用映射吞没；
6. `toolSdkConsumers` 例外（仅 `defineTool`）是否成立、是否需收窄；
7. 前端接线（视图/目录/勾选/开关状态流）无回归。

发现项由 **Codex 直接修复并提交**（含受影响测试更新与复跑），不回转 Qoder。

### 2. 非作者独立复核（干净上下文子 agent）

用下方任务书起新子 agent；发现项同样由 Codex 修复、复跑并请复核者重验受影响范围。复核报告与结论追加至本目录（如 `independent-review.md`）。

> 你是一名独立复核 Agent，未参与本候选任何部分的创作，也不带作者的会话历史。请按以下任务书独立工作，不要采信任何"实现已没问题"的预设。
>
> **复核对象**：OptraCall 仓库 `qoder/sim-lab` 分支的"经营推演一期"候选（见 `openspec/changes/simlab-capability/candidate-manifest.txt` 固定身份与哈希）。
>
> **必须遵守**：
> 1. 源文件、测试、规格、既有证据只读；验证所需的临时文件/缓存/报告只写入你自行创建的隔离目录（如 mktemp），不改动工作区。
> 2. 先从验收导出预期：通读 `openspec/changes/simlab-capability/spec.md`（SIM01–SIM13、R1–R10、IN01）与 `docs/SimLab能力承接产品讨论稿_v0.2.md`，自行写出关键可观察预期清单，再核对实现与测试；不要照 result.md 结论复述。
> 3. 独立检查关键路径与失败路径：引擎守恒/确定性是否真被测试证明、CAS 与固化纪律、5 工具结构化信封、归档只读、任务级工具开关与未开启对照、Host-Agent 职责边界（工程规范§2、§4）、边界清单例外是否成立。
> 4. 可运行的验证：隔离环境执行 `node --test tests/simlab-*.test.ts`、`npm run check:agent-sessions`、`npx tsc --noEmit`；端到端参照 `tests/simlab-agent-flow.test.ts` 的合成 Provider 方式，不使用真实凭据与真实模型。
> 5. 如实记录检查范围、实际命令与退出结果、发现（严重度/位置/理由）、未验证项及原因。
>
> **产出**：复核报告（预期清单 → 逐项 PASS/FAIL/待验证+证据位置 → 发现与处置建议 → 总结论），写入你的隔离目录并回报路径与摘要。作者修复后需对受影响范围重验。
>
> **已知且不要求重复报告**：SIM11、SIM08 卡片、受管任务未运行验证、真实模型未做、CAS 跨进程窗口（均见 result.md）。请判断这些记录是否准确、是否还有遗漏。

### 3. Git/CI 交付与合并（授权主体：用户，申请方：Codex）

按工程规范§5：向用户申请授权 → 集成最新 main 并重验受影响部分 → push 更新 → 单 PR → 实际 head CI → 用户确认后 squash 合并 → 本地 main 安全快进 → 更新 spec/result 与 OpenSpec 归档。原仓退役（`gadfly-hbo/sim-lab` 归档、JuanerAI 文档标 superseded）与 MacBook 体验按变更内约定另行申请授权。

### 4. 固化开发流程（本移交模式写入工程规范）★ 用户新增指令

Codex 需将本次使用的交付模式固化进 `docs/engineering-workflow.md`（建议放§2 分工与§5 Git 之间或§5 内新增小节；同步升版本号并在本变更 result.md 记录），模式定义如下，文字由 Codex 按规范文风整理：

**Qoder→Codex 移交交付模式（单一写入者两段式）**

- **阶段一 · Qoder 开发**：Qoder 在 `qoder/<slug>` 分支的独立工作树实施全部开发（Extension 本体 + 含 Host 接缝的全链路，接缝部分按 IN06 在规格记录安排与理由）；按工程规范完成规格、SDD/TDD、`npm run check`、隔离环境端到端与浏览器点验，结果与证据写入 openspec 变更目录；收尾时固定候选（候选文件清单+哈希）并撰写移交包（候选/证据索引、接缝互查导引、独立复核任务书、移交声明）。
- **阶段二 · 移交**：Qoder 将全部变更落成单一交接提交（含移交包），push 分支到 origin，随后原工作树切为游离状态释放分支检出权并停止写入；移交即所有权转移，该分支此后单一写入者为 Codex。
- **阶段三 · Codex 接管至合并**：Codex fetch 并在独立工作树检出该分支；完成接缝互查与修复（直接提交，不回转 Qoder）；起干净上下文子 agent 做非作者独立复核并处理发现；向用户申请 Git/CI 授权后完成集成 main、PR、实际 head CI、squash 合并、本地 main 快进；合并后更新规格/结果并做 OpenSpec 归档。
- **边界与不变量**：移交前后均遵守单一写入者（同一分支同一时刻只在一处提交）；独立复核者必须非作者且上下文干净（可用主会话起的全新子 agent 承担）；本模式是既有分工的可选交付路径，不改变 IN01–IN07、职责边界检查与非作者复核的强制地位；非本模式的交付（Codex 自始开发等）不受影响。

## Codex 接手后的第一批动作建议

1. 检出分支并核对候选哈希与 manifest 一致；
2. 通读本包 + spec + result；
3. 执行任务 1（接缝互查），随后按序 2→4→3（流程固化可与复核并行，均在 Git/CI 授权前完成）。

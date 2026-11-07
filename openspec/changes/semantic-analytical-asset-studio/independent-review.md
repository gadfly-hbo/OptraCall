# Studio 首期实施独立复核

日期：2026-11-07。**首轮候选不通过；第三轮核心独立复核通过，范围及限制见末节。** 本报告为独立只读增量审查，不是完整产品、真实模型或运行采用验收。

## 范围与身份

- 已读取本仓库 AGENTS.md、工程规范 v1.9、统一会话接入说明、本变更 spec / approval，以及批准包 spec、interaction-states、baseline-contract。批准包三份正文 SHA-256 与 approval.json 全部一致。
- 基线为 `98ee477eb1a3f9bdb0d64f1eed7cbb613b4e00bc`，审查当前未提交 diff 和新文件；代码发现先使用 MCP 项目 `optracall-studio-ui-main-98ee477`，新代码未索引时直接读取。
- 重点为 Studio Store / 来源 / Host / IPC / UI 职责、正式资格、取消、反馈接手和原成果保留。官方抽取和图构建 glue 正在并行开发，本轮不对尚未交齐部分给出最终通过结论。
- 复核者未创作产品候选。未修改产品源码、测试或依赖，未运行真实模型、Git 写操作、真实业务根或服务；仅本报告落盘。
- 动态触发使用 `node --input-type=module` 在内存内调用实际 `createStudioFeature().port`，以合成项目/来源和内存 Store 读投影控制触发时机；不创建文件、不发模型请求。此证据证明所述控制路径，不代替真实 Host / Pi 完整验收。

审查时核心文件摘要：

| 文件 | SHA-256 |
|---|---|
| src/host/studio-host.ts | 50fb0f8ae2b3aa78fc73c740dc5cc38d5c6ae02b1ce22de2de468c97454b4ca2 |
| src/host/studio-sources.ts | cd85a2342d490d4e98a4422e931f72ab4d298b2c77d3071fc598f9bc3dda7f1d |
| src/host/studio-operations.ts | 70fe91d8002b5c983a52b067bf563be85e94facc39b867152eaafa0a9072a7d8 |
| extensions/business-plugins/studio/store.ts | 8f7de00865c8613588e6b76eb1f992f093960c9795765bced91fedf5858b8884 |
| src/host/ui/StudioFeedbackDialog.tsx | 3c60d3041a8c81bb31e288a6037dfb25fe2f15eee6af6b55d3baecf19678cba9 |

## 必须修复

### R1 · P1 · 普通 read(assetId) 绕过原来源资格

位置：`src/host/studio-host.ts:148-150`；`extensions/business-plugins/studio/store.ts:181-189`。

普通使用 Agent 的 `studio_assets read` 提供 assetId 时直接返回 `getPublishedAsset` 正文，不经过 `sources.read/validate`。因此已撤回的企业源、已变化的源文件及已失效的依赖仍能从这个入口拿到正式正文。

内存动态触发结果：

```text
revoked-source asset read: REVOKED RULE BODY
same source through qualified path: studio_source_unavailable
confirmed-error explicit read: REVOKED RULE BODY true
```

同一资产在 `read-source` 路径被拒绝，`read(assetId)` 却成功，故不是来源本身未撤回。需让普通 read 与按来源读取共享当前来源资格核对。**显式准确旧版读取应依 v1.0 保留**；上述 explicit 动态输出本身不是禁止历史读取的依据。已确错旧版保留治理/修订关联并明确非默认推荐，default/图供给不得绕治理；原来源撤回仍须生效。对应 ST10、ST12、ST13 与 interaction §7 的“旧准确图快照不绕来源撤回”。

### R2 · P1 · 异步来源检查期间取消后仍会写入

位置：`src/host/studio-host.ts:165-185`，特别是 `saveAsset:66-70`、`save-sap-method:168-171`、`register-sap-metric:176-178`、`attach-ref:184`。

这些写路径在进入 mutate 后核 context，然后继续 await 来源/项目/文件读取，最后直接写 Store；最后一次 await 与写入之间没有再次核 context 和 signal。公共层丢弃迟到回复不能撤销已经发生的持久副作用。

内存动态触发：暂停 `sources.validate`，待保存候选已进入该 await 后取消 signal 并使 context 失效，再释放检查。实际 port 输出：

```text
settled successfully after cancellation
writes after cancellation: 1
```

需在最终异步核查后、每个真实写入前按同一 operation 再核当前资格；相关多次写入也应核清取消与已发生结果。对应统一会话接入的当前 context / 取消 / 迟到写入规则。不能用“最终 IPC 回复会拒绝”关闭此问题。

### R3 · P2 · 从原回复反馈没有自动交接当时的资产、数据与图出处

位置：`src/host/ui/StudioFeedbackDialog.tsx:25-26`、`:52`；`src/host/studio-host.ts:221-229`。

原分析 UI 只发送 title/problem/origin；Host 仅回读该 native 回复并增加一个正文哈希 Ref，没有回读或关联当时实际提供/读取的资产版本、数据来源、图快照、用途限制和对应 use 记录。Dialog 却声称会“关联实际资产版本”。建设 Agent 收到的反馈仅有正文引用，不能据此准确恢复原使用依据，后续体系变更还可能使它查到别的版本。

触发：原任务使用 Studio v1 / 图 S1，体系随后发布 v2 / S2，再在旧原回复点“反馈到资产体系”。当前请求及 Host 分支只保存旧回复的正文身份，未保存 v1 / S1 的来源关系。需消费当时原生回执或原准确 use 记录，缺证据留 UNKNOWN，不能改取当前 latest。对应 ST15、ST17 与 interaction §4.3。

### R4 · P2 · 实际读过资料仍无法保存“已整理”

位置：`src/host/studio-host.ts:40-46`、`:181`；`extensions/business-plugins/studio/store.ts:206-215`。

workspace 从 native 工具回执投影 material.readAt，仅修改 `store.get` 返回的 clone；`material-status` 则另取未带 readAt 的持久 material，并只补 processedAt。Store 合理地拒绝“未读却已整理”，所以真实读过后此公开工具仍失败。

内存动态触发：给 taskSnapshot 一个准确的 studio_assets read-source native 回执，workspace 能显示实际读过；随后对相同 material 调用 material-status(processed=true)：

```text
workspace projects actual native reading: true
after real reading, processing status: studio_material_not_read
```

需在处理状态写入时复用同一真实读取投影/回执资格，并保持读取、整理和业务确认分开。直接从客户端或 Agent 声称已读不能替代此资格。对应 ST05。

### R5 · P2 · 语义源的 SAP 指标依赖没有核使用项目采用资格

位置：`src/host/studio-sources.ts:56-73`，特别是 `:70`；对照同文件 `:107-109`。

直接读 sap-metric 会要求本项目已采用准确包版，但普通读一个 Studio 源时，它的 sap-metric sources/dependencies 仅 `metricLibrary.read` 和核哈希，不核使用项目的采用版。由 Studio 规则包装指标依赖后，可使未采用该包或仍采用其他包版的项目取得依赖该指标的正式规则；prepareContext 也用这个较弱校验判断可用。

触发：发布一个来源/依赖包含 SAP A@1 的 Studio 规则，将体系关联到未采用 A@1 的分析项目。该项目直接读 A@1 被拒，读此规则却可通过其 dependency 检查。需按用途依赖核原采用资格，并保留与该指标无关的独立语义/SAP工作。对应 ST02、ST10、ST12，以及 baseline-contract §5“当前用途可用”条件。

### R6 · P2 · 新语义源确错治理只有 Store 方法，没有产品接入口

位置：`extensions/business-plugins/studio/store.ts:267-268`；`src/agent/studio.ts:4`；`src/host/studio-host.ts:160-187`、`:232-259`。

`markAssetIssue` 能保留治理历史并阻止默认推荐，但当前 Studio 工具和 HTTP 路由均不提供这项受权治理操作，UI 也没有对应操作。反馈不是确错决定是正确边界；然而原建设核实正式 Studio 源错误后，仍无产品路径让其进入已确错状态。只存新版候选时，原错误正式版会继续默认供给直到新版发布；若来源错误尚不能立即修正，限制无法实际生效。

需补原权威内明确、留证据的治理入口，权限与人的必要决定遵守已批准范围；不能用反馈 status 自动当全局确错。对应 ST13、ST15 与 baseline-contract §5、§6.7。

## 完整收尾仍需证明的范围

- 官方 Pi / Semantica 抽取与构图 glue、Host 附属 owner/profile、预算/取消、准确快照固定、失败/UNKNOWN 和原生能力权限子集：本轮未对正在开发部分判通过。
- `update-feedback` 对 verified 一律拒绝（studio-host.ts:186）；公开 `declare-use` 一律 not_assessed（:158），当前也无 HTTP 录入实际复用验证结论路径。因此“修订后代表性再用核实问题与原正确内容”仍未形成可达的业务闭环。禁止作者自评伪造通过是正确的，最终仍须有受权、可追源的真实验证接入口或明确关联既有验收机制；不能据当前 Store 类型就声称 FA04 完成。
- 两个核心问题、六领域全景和两条建设路径均须保留。现有合成 flow 测试是固定协议调用与计算示例，不能替代新获准资料下真实模型的自然选择和专业质量证明；真实质量依当前授权保持未验证。
- Store 候选/正式版本与原报告保存方向合理；仍需完整产品路径验证原项目、会话、文件的实际保全、归档反馈只关联、迟到/取消、部分成功、UNKNOWN 查回执及再打开。未执行的项目不填为 PASS。
- 工程、真实模型专业质量、Git/CI、服务采用和用户产品验收分别报告。原 FAIL/UNKNOWN/NOT_RUN、Demo 首次失败与旧报告不得改写。

## 复核记录

第一轮：R1–R6 未关闭。未宣称完整工程验收、产品首期完成、真实模型通过或运行采用。本报告等待修正候选后逐项复核，并保留本轮原始失败描述。

## 第二轮复审（进行中，保留第一轮 FAIL）

作者返回修正后，复核者回读了新的 Host、Store、来源、附属会话、graph、server/main 和公共 closeAll 增量；只运行不落盘的内存触发。当前并行修正尚未固定为最终候选，本节不代替完整最终复核。

### 首轮问题的修正状态

- R1 原普通 read(assetId) 绕撤回路径已改走来源资格；显式旧版保留治理和非默认推荐。源码回读方向正确，来源物理完整性另见 R10。
- R2 首次修正仍漏 `await active()` 及异步 assert helper 后的直接更新，已交作者补齐。最新内存复验在 active/taskSnapshot await 中取消，输出 `topic write rejected: stale`、`writes: 0`；初次迟到写入 FAIL 保留。
- R3 现在按精确 native 回复所属回合捕获 read-source、declare-use、图快照并保存 origin，不取当前 latest。来源依据方向已补；Agent 自造 origin 另见 R12。
- R4 material-status 改从 workspace 的 native 读取投影获取事实后保存整理声明；源码回读已对上首轮触发原因。
- R5 依赖 SAP 指标采用资格已与原准确包版检查合并，并增加同源建设候选读入口。
- R6 增加建设 owner 的 mark-issue；新增普通 owner 的 assess-use 和追加准确报告证据，主建设 Agent 只能在准确使用/评估证据成立时记录 verified。这是 Agent 的明确核查声明，不是 Host 专业裁决或独立专业评分。完整实际 flow 尚需最终候选验证。

### 第二轮新增问题与复验

#### R7 · P1 · 反馈补来源曾可自授跨项目任务读取（已修复并独立复验）

触发版本位置：studio-host 的 `update-feedback` 非 verified 分支；studio-sources 的 construction retained feedback.sources 白名单。

构造原本不在反馈/使用记录中的跨项目准确 task Ref，建设 Agent 先 `update-feedback(sources:[ref])`，再 `read-source(ref)`。原 Store 只做结构校验，来源白名单又信这个可由 Agent 任意追加的字段，故从拒绝变为返回无关项目正文：

```text
before arbitrary source append: studio_source_project_mismatch
after arbitrary source append: UNRELATED PROJECT PRIVATE REPLY
```

作者补为新增 Ref 先走原建设权限校验，再写入。最新同样内存复验：

```text
arbitrary append: studio_source_project_mismatch
retained arbitrary sources: 0
already retained exact reply read: UNRELATED PROJECT PRIVATE REPLY
```

最后一项以模拟已由 Host 捕获的精确 Ref 为前提，确认修正同时保留原获准证据的维护/回读，未一概封死反馈来源。

#### R8 · P2 · 图意图空来源与成功来源冲突（已修复并独立复验）

Host 最初先 `recordGraph(snapshotId, [], unknown)`，成功后对同 snapshotId 追加真实非空 sourceRefs；原 Store 将它视为身份冲突。作者现在允许尚无实际来源的 UNKNOWN 意图追加真实成功结果，同时保留原 UNKNOWN 行。内存调用实际 Store.recordGraph 复验输出 `graph completion recorded`。该关闭仅证明意图到结果的 Store 接缝；不代替官方构图/HTTP 实际回执验收。

#### R9 · P1 · 图准备期尚未进入公共占用，stop 可漏掉随后启动的构图（待修正复核）

触发位置：server 的 refreshGraph 在调用 studioSessions.build 之前 await pair、prepare、mkdir、realpath；公共域 reserve 位于 build/operate 内。

在这些准备 await 中调用任务 stop，附属域尚无 slot，stopForTask/closeAll 找不到该 job 并返回；准备随后结束，仍能用新 jobId 调 build 启动 worker。图 HTTP 操作没有父 signal，而 extract 有父 context 的最终核查，二者不能混为同样已覆盖。完整准备及 worker 应处于同一公共 lease 的占用/取消资格内；不需要新增业务运行台账或持有全局 mutate。

#### R10 · P2 · enterprise 依赖只核元数据，原正文损坏仍供给正式规则（待修正复核）

触发位置：studio-sources 的 checkDependency enterprise 分支只 referenceIndex/hash，不调用原 readRevision 完整性和之后的启用复核。

内存触发让原 enterprise authority 的索引仍准确启用，但 readRevision 明确报源损坏：

```text
original source read: enterprise_source_corrupt
formal dependent rule read: DERIVED FROM NOW UNREADABLE SOURCE
```

需要由 Host 原来源权威实际核选中修订的可读性/哈希及当前资格；不向使用 Agent 暴露建设资料正文。仅相关坏来源受限，无关资料不能因全库扫描受影响。

#### R11 · P2 · 多层候选依赖被误按正式资格拦截（待修正复核）

触发位置：studio-sources 的 checkDependency studio-source 固定 readStudio(construction=false)，sap-method 同样固定非建设模式。

候选 A 引企业源、候选 B 引 A；为建设候选 C 而读取 B 时，嵌套的 A 被强制要求已发布。内存调用实际 sources.read：

```text
candidate A construction read: 44444444-4444-4444-8444-444444444444
candidate B construction read: studio_asset_not_published
```

该行为会迫使用户先发布较底层资产才能继续建候选链，违背候选自主建设后集中确认。建设应允许同体系准确候选依赖；普通与图用途继续只供给正式资格，循环仍须拒绝。

#### R12 · P2 · Agent feedback 可自填 Host origin（待修正复核）

触发位置：studio-host 的 Agent feedback 仍以 `{...payload,sources:refs}` 传入 Store.addFeedback；Store 新 origin 仅做结构校验。

Agent 可自填别的 project/task/useId/graphSnapshotId 成为正式反馈 origin，绕过 HTTP 对准确 native 回复和实际回合的捕获。该点本身不授予读取，但污染准确历史和图出处。Agent 业务字段应与 Host 捕获身份分开；来源缺证据保持未知。

#### R13 · P2 · 确定未派发的图前置失败变成永久 UNKNOWN，锁住独立工作（待修正复核）

触发位置：Host 图刷新先记录 UNKNOWN 意图，refreshGraph 的所有 StudioError 一律转 503；operation 保持 unknown，UI pending 阻断后续操作。

默认未提供 --studio-python 时 server 仍提供 refreshGraph 闭包，意图保存后抛 studio_semantica_unavailable；或 prepare 明确报 no_eligible_sources，均尚未派发 worker、无快照，但被永久标未知。GET 查无输出只能继续 unknown，用户无法恢复独立 SAP/其他工作。应以实际公共派发/落盘事实区分确定前置失败和可能已发生副作用；未知不盲重放，已核未派发的失败也不应无限锁住工作台。

### 仍需在最终候选核对的边界

- UNKNOWN 图结果只读核查现在可回读准确快照，不能仅凭文件存在推导公共 lease/worker 清理已完成。快照输出成功、资源仍 busy/清理 UNKNOWN 应分开；失败清理不得借新 job 绕过。
- graph 仍复用原 semantic service 的 runToken 固定首次准确 binding，回源 authority 动态重核；未观察到将当前任务自动切到新图的改动。
- 附属会话是 Host 静态 profile，经原公共域使用官方 Pi 封闭文本资源；不另造模型循环。closeAll 的可选 predicate 为 Host 作用域筛选，不向插件提供生命周期管理权。该回读不替代真实关闭失败/取消/SDK 合成路径验证。
- 第一轮和第二轮动态 FAIL 都保留。待以上候选固定后再写最终逐项结论，不把并行修正中的阶段结果当成全部通过。

## 第三轮：核心修正与图选择复核

本轮开始固定身份（后续修正另记，不混用身份）：

| 文件 | SHA-256 |
|---|---|
| src/host/studio-host.ts | a5b8dd370bdd318c51314bbdab4ab184258901558562963a9180a44fc61a0e39 |
| src/host/studio-sources.ts | 3de9eed0a487de567a21e1233d728ea96550b216fdf2aaa6ad697aea2396590d |
| src/host/studio-sessions.ts | df409524fed12f33064788ce73526a10a4eabd6763a133d4e947da2070b7eda1 |
| src/host/studio-graph.ts | 21965c1f7c54db196776c970e4d2ce8010defdc98277a311a309b16560868142 |
| src/host/studio-operations.ts | d89c9733629b6b874686c652a3f5fe3156e0d203496882d0009b0f1f0e241c38 |
| extensions/business-plugins/studio/store.ts | 842b2ab45c4817e392ea4f1528e0244d77b45bd12ab550ef8e895eb1ef7acb1b |
| src/host/server.ts | a5ce9763c2586cd0ea0c78acfc19876e388942c1ff5eb7394c96f1859c110437 |
| src/host/agent-sessions.ts | 173dc8a86ffe83db4e4c4c4fe8112ed3971556d679993b6536f54b8878f20a89 |

### R9–R13 修正复验

- **R9 关闭。** server 在已取得真实 task 后直接调用 buildPrepared，没有 reserve 前的来源/建目录 await；prepare / mkdir / realpath 均在原公共 lease 内并核当前资格。独立调用实际 StudioSessions / 公共域，在 prepare await 中 stopForTask，结果：

  ```text
  busy during preparation: true
  after stop: {"code":"studio_generation_cancelled","dispatched":false,"cleanupPending":false}
  busy after settle: false model resources created: 0
  ```

  该测试在独立 Node 进程将唯一 mkdir 系统调用替为无写模拟，其余公共 lease / 占用 / 停止逻辑为实际实现；没有写目录、启动 worker 或模型，不冒充完整 Host / Pi 验收。
- **R10 关闭。** enterprise 依赖已复用选中原修订 readRevision、正文 hash 和之后 enabled 状态核查。独立内存复验输出 `formal rule after original corruption: enterprise_source_corrupt`。
- **R11 关闭。** construction 标志向同体系候选和原库方法依赖递归传递；普通资格保持。独立复验输出 `nested candidate construction: true`、`ordinary nested candidate: studio_asset_not_published`。源码保留 seen 集合循环拒绝。
- **R12 关闭。** Agent feedback 显式忽略 payload.origin；只有 HTTP 真 native 捕获分支生成 origin。独立调用 Agent port 传入伪造 project/task/session/entry/graph，输出 `agent forged origin retained: false`。
- **R13 关闭（独立源码核查；未重复运行作者 Host 测试）。** 未提供 Python 时 refreshGraph 为 undefined，在保存图意图前明确409；原 operation wrapper 将确定 StudioError <500 保存 failed。buildPrepared 对真实未派发且无清理未决的失败给出 Host 标签，feature 追加 failed 并返回409。派发后或清理未决仍 UNKNOWN。已回读作者的两项实际 Host 测试覆盖默认缺环境与无合格源，但不将其称为复核者独立执行结果。
- UNKNOWN 查询现在只报告 `output.succeeded`，operation/lifecycle 仍 unknown，不因文件存在认证清理完成。Host admit 使用原公共域 busyOtherForTask 阻止同任务新 job 绕过旧失败清理；未引入平行业务运行台账。

### 图选择与旧图回退

Store 新增准确 selectedGraphSnapshotId，HTTP graph-selection 先检查实际保存快照和当前源资格。bindingFor 为后续查询选该准确快照，原 semantic service 继续按真实 runToken 固定首次 binding，不自动改写已运行任务或旧报告。checkBuild 已改为核准确已发布源资格，不把 current latest 当成唯一合法旧图来源；原源撤回/确错仍限制普通图供给。

#### R14 · P2 · 图选择未核冻结输入完整性（待修正复核）

位置（本轮固定身份）：studio-graph.ts:83-106，特别是87-98。

inspect 检查 graph/ontology 自身 hash 及 sourceRefs 当前资格，却未读取 receipt.inputs 的每件固定输入核 bytes/hash；receipt.graphId / component.name 也未核完整身份。冻结输入缺失或损坏时，graph-selection 仍可成功，随后原 Python SnapshotStore._inputs 才拒绝读取同一“已选择”快照。需要复用选中快照的完整只读核查，不运行模型或重建图；损坏历史保留，不静默修复。此点不意味着当前查询会供给损坏内容，原 query worker 已有进一步拒绝保护。

### 本轮限制与待收尾

- 当前仅 R14 尚待修正复核；R1–R13 的原 FAIL 和触发证据不删改。
- 作者报告的77项 aggregate PASS 不等于本复核者独立跑完77项；完整适用 check、真实浏览器、官方依赖 Host/Pi 合成链和原成果保全仍按相应真实日志独立核定。
- 新附属实际 profile `studio-semantic-generation`、owner projectId/taskId/systemId/jobId、封闭 text-only 权限和 graph-only 不创建模型资源应进入本变更 spec/实施记录，替换目前仅条件性“若需要附属资源”的实施接缝说明。
- 未运行真实 Provider 或专业模型质量测评，未做 Git/CI、迁移、运行采用或用户产品验收。两核心问题、六领域和双路径保留，合成 protocol/计算不扩称自然模型专业质量。

## 第三轮最终增量与结论

**结论：所审核心代码及公共接缝无剩余必须修复项，限本报告实际复核范围通过。** 全量工程 check、真实浏览器和产品验收分别核定；本结论不代替作者最终工程收尾。

### 最终关闭项

- **R14 关闭。** 最新 inspect 先核 format/snapshotId/graphId、与原 Python COMPONENT 完全一致的官方组件身份、唯一输入key/path、受限 inputs 路径及每件固定输入 bytes/hash，再核 graph/ontology 和当前准确源资格。原始快照和损坏失败均保留，不调用模型或重建。已独立回读实际实现及作者 `graph-inspection-input-green.log` 的 2/2 结果；实际破坏文件回归由作者执行，不冒称复核者自己执行。
- **R15（末轮发现，已关闭）：同体系下一主题接入口缺失。** 原 Store.addTopic 未从产品暴露，会迫使改名原主题、连带改变旧资产主题含义。现在 construction `add-topic` 薄接缝调用原 Store，再以 update-topic 选择新主题，不新建体系或会话。独立实际 port 内存复验：`topics preserved: 2 销售退款 true new current: true`；普通 owner 返回 `studio_construction_only`。保留原主题及旧 asset.topicId，允许同体系持续建设。
- **R3 读取路径补齐。** 最终普通 read(assetId) 回执携带 Host 精确 ref，反馈捕获同回合的 read/read-source、declare-use、graph nodes/edges/source结果以及原 L1 已读结果。以真实回执记录当时源版和快照，不查询当前 latest 补造“实际使用”。旧图 enterprise/M2 稳定版引用没有 hash 时保留准确身份并不补造 hash，正式 Studio/SAP 源仍严格核 hash。原生 sourceHandle 不写成永久原权威身份。已回读作者 `flow-feedback-final-green.log` 的 7/7 路径覆盖；这是作者实际 HTTP 测试证据，非复核者独立运行。
- **原 M2/Case 读接缝已审。** 新 `studio-original-sources.ts` 只复用原 SemanticContextService 的 agent audience，核准确 target / 项目 / task，拒跨项目 M2 与任意路径；完整重组原 continuation/range/hash 和治理，不另造来源 Store、Runtime 或 latest 解析。512KB/256页是明确失败边界，未静默截断；M2 description 原记录 hash 不替换为 pretty JSON 的 hash。已回读作者原来源21/21日志；原读取资格仍由原权威管理。
- **R1/R4 最终独立复验。** 最新实际 port 内存输出：撤回默认读拒 `studio_source_unavailable`，已确错默认读拒 `studio_asset_restricted`；显式准确历史仍返回正文、governance 且 defaultRecommendation=false；真实 native 已读回执后 readAt+processedAt 可以保存。未新增历史禁读门槛。
- implementation 已记录实际 `studio-semantic-generation` profile、project/task/system/job owner、准确配置、text-only 权限、graph-only 无模型资源及原公共关闭接缝，条件性设计描述没有被当成完成证据。

### 最终核心身份

| 文件 | SHA-256 |
|---|---|
| src/host/studio-host.ts | 3827d56d05986f88ac85eba5945ebf3bc7dc00945a16aa3995870bae66871644 |
| src/host/studio-sources.ts | 4987438ff38c2567af40cfdf790b107749cb8007a9076d7f092c84fbf9d63a28 |
| src/host/studio-original-sources.ts | 3283bb6e357df5510c673b9705c67587baf648544a2173810487c5c8fa689d2c |
| src/host/studio-sessions.ts | df409524fed12f33064788ce73526a10a4eabd6763a133d4e947da2070b7eda1 |
| src/host/studio-graph.ts | e4a8ba72a934746a1e8e9c1bfb02c713c20b10d621a24fed656406f038659cf4 |
| src/host/studio-operations.ts | d89c9733629b6b874686c652a3f5fe3156e0d203496882d0009b0f1f0e241c38 |
| extensions/business-plugins/studio/store.ts | 842b2ab45c4817e392ea4f1528e0244d77b45bd12ab550ef8e895eb1ef7acb1b |
| src/host/server.ts | 8a26cdb0e356be37ce1a9055454eaa79cee8b83175b3c8bd6de78a53659dd0fb |
| src/host/agent-sessions.ts | 173dc8a86ffe83db4e4c4c4fe8112ed3971556d679993b6536f54b8878f20a89 |
| src/agent/studio.ts | b8c97545270e3f8b4a09f39e1f94721c9caead320bdd0a25919efc627d79eb2c |

### 四原则与验收边界

- Host 承担 owner、权限、配置/取消、精确保存和回执；source/Binding/原 SAP 权威清楚，Host 不计算经营数值或投票判真伪。
- 主建设及普通分析沿原 project-tasks，Agent 自主选原工具、Semantica、核查与修订；没有固定专家流水线、节点审批、方法/调用配额或六类可靠性全部关闭门槛。
- 原 SAP、企业资料、RAP、M2、Case、Pi 公共会话和原图服务实际复用；新模块维护自身语义源/Binding及业务关联，新增读取薄层委托原权威。
- 用户一次目标/选材、必要业务取舍、确定范围发布和原采用规则仍分开；图刷新/选择不冒充业务批准、实际使用或专业通过。

最终独立回读：原产品方案仍为 74,468 bytes / SHA-256 `4b731550cf17ed4dfe0f5316f57d96f8a72e4896cd2c0853c4095ef2e12598e0`，approval.json 所列原评审包逐文件无漂移。R1–R15 的首发失败、动态触发和修正过程均保留。

本复核者未运行真实 Provider、真实业务资料或专业评分，未做 Git/CI、迁移或服务切换；不声称全量原业务文件重新验收、自然模型质量成立、FA01–FA06全部产品验收完成或运行采用。最终公开记录仍须保留作者完整检查的真实结果、原 FAIL/UNKNOWN/NOT_RUN/NOT_PROVED 和相应未验证范围。


## 交付补修最终非作者收尾

前述首轮R1–R15及当时“不运行真实Provider/Git/服务”的记录保持原范围；用户后续授权在`delivery-authorization.json`，实际模型专业结果独立记录，不能由本工程复核代签。

D1/D2/D2-A最终独立复验关闭长抽取/长写入回执、业务答案保全与题意CAS；172/172专项及最后UI14/14、类型检查通过。实际Chrome的旧题409、随后GET503仍禁保存、读取恢复后保留原草稿并对照当前题均有回读。其余未变源摘要与最后57份源/脚本/测试清单一致；唯一额外原回归是非作者核定的CHAT04公共idle等待修正，未改产品运行时。

D3由未参与候选创作的复核者先封要求，再核准确v2及固定685份副本，前后零漂移。独立作者永久回归7/7；另写3项探针验证当前资格与采用动作历史分开、五页长限定完整恢复/混页/撤回/foreign阻断；实际合成Provider经公开Host→Pi四请求检查context/catalog/read/read-source，确认原记录的准确限定送入，旧进度/未确认预览/作者checks未送入。联合回归38PASS、1条件SKIP、0FAIL，原诊断路径/错误码误差保留；不是产品首发FAIL。最终独立结论 **PASS，无未关闭工程阻断**，报告SHA256 `b1321bfabdc341c6e1fa44797b9c3f9985f7d09457ac1452b399044928a82295`。

作者最终完整检查1889/1822PASS/67条件SKIP/0FAIL、构建通过；现有官方Python/Semantica补跑35/35零跳过，关闭其中16项Studio官方路径的环境跳过。上述完整/专项/官方/独立/UI分别记录，不重标所有条件SKIP为PASS。原CHAT04失败、类型错误、D3早期RED和被新修正覆盖的旧完整检查均保留。

四原则/IN/SDK专项在当前差额通过：Host只供给原权威的事实、owner、资格和回执；Agent自主方法/工具/修订；复用Pi、原source/project/SAP及原分页；无新求解器、账本、专家流水线、逐节点审批或六类全部关闭门槛。采用动作历史不替代原项目/SAP当前权威，提供/读取/使用/作者评估/专业验收保持分开。官方SDK未升级/修改；不外推既有风险已全部合规。

该结论仅为工程复核，D3真实模型复验NOT_RUN。最终专业总封仍整体FAIL、局部PARTIAL、完整四段闭环NOT_PROVED；B核心候选未发布、普通B未运行，未以非作者工程PASS关闭它们。实际Git/CI、两机采用与用户产品验收分别核定。

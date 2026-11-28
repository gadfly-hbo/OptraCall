# 9900e202 原生观察测试增量：独立后端复核

结论：**PASS，未发现新增 must-fix。** 本次 4 个测试的修订与已取得的准确失败栈相对应，没有把不可读快照、未知运行或工具调用中的 assistant 消息当成完成证据。认可本次验证集合为受影响的 4 个完整原测试文件、官方会话接入边界、build/typecheck，再对最终新 head 运行完整 CI；无需再重复一次本地全仓运行。此结论不宣称新 head 已完整 CI 通过，也不把 A4 本地完整 FAIL 改写成 PASS。

- 审查时间：2026-11-27T17:51:47Z。
- baseline：`a4c563f0632280010e7e12906c69fa6664cffd13`。
- 固定候选：`9900e202736977080f38309d0c76f6eff3eda9c5`；审查时 tracked worktree clean。
- 独立性：未参与产品或测试修改；本轮只读源码、git 差异和现存收据，仅写本报告，未启动 Host、Provider、测试或其他运行探针。

## 原失败和原契约

原 A4 本地完整结果保留为 **3607 tests / 3407 pass / 4 fail / 196 skip**，1700399.926768ms。原完整 footer 已存 `.local/pm-observation-fix/a4-original-footer.log`，其准确四个失败分别是：

1. direct 11KB 原生交付：`readState` 对原生 JSONL 正在追加的尾部执行 `JSON.parse`，报 `Unterminated string`。
2. Studio 原工程流：GET 任务轮询收到 **409 / native_snapshot_incomplete / accepted:false**，原 helper 立刻要求 200。
3. v13 旧准确 GSA 场景：同样是 GET 任务轮询收到准确 **409 / native_snapshot_incomplete**。
4. DW Pi 回环：目录工具结果尚为空就越过等待；原 helper 读取不存在的 `snapshot.running`，首条 assistant 工具调用消息已经满足旧条件。

原生产契约逐项核对：`src/host/native-session-snapshot.ts:19` 明确不修复 JSONL、不 open/migrate；49–59 行核对 inode、长度、时间戳等稳定性；64 行对未换行尾部抛 `native_snapshot_incomplete`；66 行对实际坏 JSON 抛不可用；86–90 行仍经公开 SDK 解析和 SessionManager 原投影。`src/host/server.ts:3934` 原样将 NativeSnapshotError 返回 409、原 code、`accepted:false`。这类读失败不是成功回执。

`src/agent/project-runtime.ts:42` 的 ProjectSnapshot 使用 `status:'idle'|'running'`，没有 `running` 属性。`src/host/strategy-discussion-host.ts:1267–1292` 返回独立的 `busy` 和 `discussion.lastRun`；无法确认的 accepted 运行还会呈现 unknown。新 DW helper 使用这些已有权威字段。

## 四文件差异及成功证明

git 差异仅 **4 files / 32 insertions / 14 deletions**；`src/`、`extensions/`、`scripts/`、`package.json`、`package-lock.json` 相对 A4 均零 diff，`git diff --check` 无输出。未新增 SDK 或新的运行 authority。

| 消费者 | 修订边界 | 成功证明保留情况 |
| --- | --- | --- |
| `tests/analysis-delivery-native-v020.test.ts:28` | 原轮询只增加准确 incomplete code；200 后独立 raw JSONL 解析的 SyntaxError 返回 unavailable，HTTP JSON 解析和其他文件错误仍抛出。两个剩余直接轮询使用同一个 pollRead。 | 原 6s/15s 窗口不延长、不重置；undefined 不赋给 saved，不产生凭据。最终仍要求 idle/completed、准确自动动作、原请求/项目/任务、原声明/确认 entry、原生 exact data，以及篡改副本逐项拒绝。严格 `read` 仍存在；坏 JSON 没有被修复或截去尾部。 |
| `tests/studio-flow.test.ts:25` | 只对本轮 GET 的准确 409/incomplete 在原 40s 窗口继续观察。 | 原 POST202、其他 HTTP code、JSON 解析仍严格；最终 completed、marker、Provider errors 空、准确工具数及无工具错误等原断言逐字保留。 |
| `tests/v13-project-goal-entry.test.ts:33` | 只对本轮 GET 的准确 409/incomplete 在原 300 次循环继续观察。 | 原 POST helper 不变；其他状态仍严格 200；必须本次 requestId completed 才返回，准确旧 Goal/策略、约定、权限撤回/重启与原件不变等全部原业务断言保留。 |
| `tests/workspace-daily-pi-loop.test.ts:10` | 两次消息 POST 的 requestId 显式传入等待；改用 !busy + 同一运行 completed，准确 failed/cancelled/unknown 立即失败。 | 原 20s、200ms 和外层 60s 不变；不会把另一运行或首条工具调用当完成。目录工具结果、真实 persisted edge/source、真实请求和 home pending 的原断言保留。 |

原生 raw SyntaxError 的新处理确实允许再次观察，但只返回 unavailable；持续不合法的原件无法提供成功的 native 证据。最终准确回执还调用原 `readTaskAnalysisDelivery`，其原 authority 未改。没有新增“丢坏行后算成功”路径。Studio 与 v13 的分支只位于 GET 轮询处，没有把 POST409 转为 accepted，也没有重发业务消息。

## 已有验证收据的独立核读

本轮未运行测试；以下是对 Root/原作者保存结果及源码绑定的核读，不冒称独立重跑：

- `.local/pm-observation-fix/native-role-green.log`：analysis-delivery 全文件 6 场景 + DW 全文件 1 场景，**7/7 pass、0 skip**。
- `.local/pm-observation-fix/two-original-files.log`：Studio 全文件 1 场景 + v13 全文件 6 场景，**7/7 pass、0 skip**。覆盖全部 4 个受影响完整文件，合计 **14/14**。
- `boundary.log`：原 session integration boundary / pinned SDK materials PASS。`build.log`：原 `tsc --noEmit`、frontend build、stamp 完成；日志标识 A4+local-changes，其测试文件内容 hash 与固定 9900 一致。
- Studio/v13 的各自 `*-red`、`*-firstget-green` 收据记录只注入一次准确 GET409：旧 helper RED、新 helper GREEN；`*-other409` 使用 configuration_changed 仍 FAIL，`*-post-strict` 的 POST409/incomplete 仍 FAIL。注入回执明确 method、route、原状态、注入状态，不混同真实产品回执。
- `.local/pm-final/native-observation-vm-receipt.json` 是另一独立审查者运行的 14 条无 Host VM 边界证据：旧首 assistant 早退 RED；新同 requestId 完成、错误 requestId、准确失败/取消/UNKNOWN、raw partial 后完整、持续 malformed、HTTP JSON SyntaxError、非 SyntaxError、其他409 等正负例。这里仅核读，不将其记为本人的执行。

逐文件 SHA-256 与上述 receipt 一致：

```
a83d69c24082534c3732ad052bac015c93018d4d026f665ae3c73ebe01c7d8d6  analysis-delivery-native-v020.test.ts
4b7d336d15dd2c23d952449b9c217bd6825a7b623fe376a8b250df2e067317b3  workspace-daily-pi-loop.test.ts
7a3ac39197ff5ff7a617d597aec584511f88f93531b7d67c69d1ea2169d3a99d  studio-flow.test.ts
41ba8a8f8c9615334ec558600a065cfd0f9a741da01cb800d5f46430d6af45b9  v13-project-goal-entry.test.ts
```

## 四原则及发布边界

- Host 管环境：本次仅测试等待消费原有 busy、lastRun、快照错误；没有修改管理、清理或 UNKNOWN 语义。
- Agent 自主：仍由实际 Pi/工具完成原流程；测试未用预填目录结果、代写业务记录、伪造完成消息替代动作。
- 复用官方能力：SDK 1.4.0、公开 SessionManager、原生 JSONL 和原校验链无生产差异，边界检查已保存 PASS。
- 减少用户动作：没有产品交互变化、新确认、新操作或自动重放；调整只让测试在原窗口内等到准确本次完成。

此前独立后端 6bc 的 25/25 及后续 source gate / 生命周期 / operation / UNKNOWN 结论在生产字节未变的前提下沿用，**不是本轮重跑**。A4 远端 exact CI 已独立收证 **3607 / 3410 pass / 0 fail / 197 skip**，含 build 与 high-level audit 成功，见 `ci-a4-summary.json`；它与本地 A4 四 FAIL 同时保留，不能覆盖新 9900 CI。

本次闭合验证选择与仅测试消费者的 delta 相称。**9900 新 head 的完整 CI 仍需真实完成并绑定准确 SHA 后，Root 再按已有授权处理合并与 main CI；本报告不替代该最终检查，也未执行任何 GitHub mutation。**

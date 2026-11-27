# 固定6bc完整检查失败的独立只读调查

候选 `6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`，原日志 `.local/pm-second/full-check-release.log`。**无需停止当前固定 run，建议继续收齐结果和最后失败栈。** 已观测失败不能算全量通过；其中两项已有精确测试原因与保留原业务断言的修正依据，新增 catalog 失败目前仍待原 run 的确切栈。

未修改任何 tracked 文件；只写 `.local/pm-final/fullcheck-probes/` 的隔离副本、合成数据和观察收据。另已只读检查 Root 的 `/workspace/OptraCall-issue149-check-followup` 两个测试差异，没有修改该树。

## 1. FR03-REPRO：异步 service 被同步异常断言漏接

- 固定代码 `tests/fr01-03-05-repro.test.ts:149` 使用 `assert.throws(() => service.saveDecisionRequest(...))`；当前 service 的 mutation callback 已是 async，`project_not_linked` 通过 Promise rejection 返回。同步 `throws` 因未捕获同步异常报 `Missing expected exception`，未 await 的 rejection 又在测试结束后触发 unhandledRejection。原完整日志1230–1232行与旧 be1 CI 的最后失败栈一致。
- 同文件141行调用的是同步 `CaseStore.saveDecisionRequest`，应继续使用 `assert.throws`；不能全局替换 Store 断言。
- 隔离副本只改这一处为 `await assert.rejects(service.saveDecisionRequest(...), {code:'project_not_linked'})`：原 FR03 全部 schema 重开和错误身份断言 **1/1 PASS**，日志 `fullcheck-probes/fr03-async-adapter.log`，没有 unhandled rejection。
- Root test-only 树使用等价 `await assert.rejects(() => service.saveDecisionRequest(...))`，保留期待的原错误码、输入与其余同步断言，语义正确。**该最小测试适配可接受**，不是削弱原拒绝保护。

## 2. CNR-A4：精确旧 writer 已成为 zombie，kill(0) 不能证明还在执行

### 原完整运行的准确证据

- 原 run 的唯一对应根：`.local/conclusion-recommendation-review/handoff/crash-vVJIVm`，不是相邻的其他 CNR 根。
- 其 receipt 只有首次 Host 的8次HTTP读写、1个合成 Provider 请求（closedEarly=true）、stdout 的 host-ready 和空 stderr；没有 reopenedOutput、没有 retired-driver.json。说明失败发生在取得 writer retirement 前，重开及后续业务断言尚未执行，不能说原完整运行已验证 UNKNOWN 恢复。
- 原 receipt 没存 Host／driver PID；现存旧 zombie 108899/108901 的 starttime 为16:13:49，而该 crash 的 before-record 时间为16:33:03。**不能把这些无关旧 PID 冒认成该次 driver。**

### 独立精确复现与因果

隔离副本 `fullcheck-probes/cnr-instrumented.test.ts` 保留原 SIGKILL、ESRCH 判据、5秒等待及全部业务断言，仅增加原 PID／startTicks／状态观察。单并发复跑后：

- 原 Host **128910**，其实际子 SDK driver **128962**，原 PPID128910、startTicks **6434471**；这些身份在杀 Host 前捕获。
- Host SIGKILL 后，精确同一 driver 先 R／PPID1，随后 **Z／PPID1／startTicks仍6434471**；209轮、5秒内 `kill(pid,0)` 均成功。原断言准确失败于 `owned SDK driver exited after IPC disconnect: false`。
- 当前容器 PID1 是 `tail -f /dev/null`，不会像正常 init 一样自动回收这些孤儿。精确 Z 进程已退出用户态、不能继续写 native，但 PID 条目保留，原只等 ESRCH 的测试前置判据在此环境不成立。这里已有本次精确 PID 证据，不依赖“系统里有其他 zombie”的猜测。
- RED：`fullcheck-probes/cnr-instrumented.log`；过程收据 `fullcheck-probes/cnr/crash-hGRFAT/process-observations.json`。

### 最小安全修正及实际绿结果

第二隔离副本仅把 driver 退休判据改为：**原 PID 已 ESRCH，或杀 Host 前捕获的精确 PID＋非空 startTicks 均相同且当前为 Z**。其他状态继续原5秒等待／失败；不额外杀子进程、不跳过、不放大超时、不认定后代工具已清理。

真实复跑 **1/1 PASS**：新 driver **130181**，原 Host130099、startTicks **6441895**，最终相同 startTicks 的 Z。真实默认 Host 重开，原全部业务断言执行：interrupted、`host_restarted_before_confirmed_completion`、持续 `legacy_cleanup_unknown`、普通历史读取／no-op stop 不发明 cleanup、无重放、Provider仍仅1请求、native／设置／原输入与报告字节保全。retired-driver 仍明确 `driver exit only; unrelated tool cleanup remains unproved`。

GREEN：`fullcheck-probes/cnr-exact-retirement.log`；完整精确收据：`fullcheck-probes/cnr-retirement/crash-Nn9NgQ/{process-observations,retired-driver,receipt}.json`。这只证明原 writer 退出，绝不将 UNKNOWN 改成安全清理完成。

Root test-only 树的实际差异已经只读复核：同一 test 在 kill 前捕获 driverIdentities；新增同 PID／same-start／Z 分支，非 Linux 仍沿 ESRCH；ENOENT 竞态继续等待；非 Z／不同 starttime 不通过；原5秒、所有恢复与 UNKNOWN 断言及 proof 文案保持。**该限范围测试环境修正可接受。**

## 3. 旧 be1 CI 的 Case Agent accepted 失败：已复现为旧合成 Provider 期望

- 独立读取 run **46029647747**、job **140609918782** 的日志：3397 pass／2 fail／197 skip；Case 用例10.462s，`business-role-sessions.test.ts:127` actual accepted、expected completed。摘录保存 `fullcheck-probes/ci-be1-failure-excerpt.txt`。
- be1 的121行仍期望 `ctx.availableTools=[]`，当前6bc已按真实 Case 声明工具修正为 `['strategy_goals']`。Provider fixture 在该断言失败时会记录 errors 并返回500；SDK 仍可能按原策略在途重试，所以只见 accepted 不能推断业务完成码错误。
- 为区分原因，隔离当前6bc单用例只恢复 be1 的这个旧 `[]` 期望，其余代码和原 busy 循环不改：复现相同 accepted 失败。观察181次，最后 **busy:true／accepted**；Provider3次错误均为 actual strategy_goals、expected []。这是循环耗尽，**不是已证实的 busy:false accepted 窗口**。收据 `fullcheck-probes/business-old-contract.json`／`.log`。
- 当前6bc正确工具期望同用例 **1/1 PASS**，Provider1、errors=[]，首次GET即 busy:false／completed。收据 `fullcheck-probes/business-window.json`／`.log`。
- 原循环为最多180×25ms加HTTP耗时，不是固定10秒；CI所报10.462s是整个用例耗时。当前证据支持已修的旧 fixture 原因，**无需为旧 be1 CI 另改6bc等待或加睡眠**。若以后改 helper，必须绑定本 requestId 并等真实非accepted终态、报告 Provider errors／最后 owner 状态，不能用延时掩盖错误；本调查没有为抽象竞态提出实现修改。

## 4. 新增 projectSkillCatalog FAIL：原失败栈尚待，不修改断言

- 精确用例：`tests/project-host.test.ts:442`，完整日志2010行，10.104s。它先 await 原 startTestHost（原 fixture 有硬10秒 startup timer），随后才配置、建项目并同步调用 catalog／fixed-skill 函数。用例无模型请求、无等待 Agent 终态。
- 10.104s 与启动计时接近，**但仅此不能判为环境问题**。原用例没有 receipt，完整 run 当时仍未输出该失败的最后栈；不能把未观察到的 `Test Host startup timed out` 当事实。
- 已保留全部 catalog／fixed built-in 断言，隔离副本只记录原 Host 启动边界，10秒启动条件未改：单独复跑 **1/1 PASS**，Host3.924s ready、stderr空，整个用例4.394s。证据 `fullcheck-probes/catalog-original-assertions.log`、`fullcheck-probes/catalog/startup-132779-132815.json`。这支持 catalog 正常路径在原依赖下可用，**不抹掉原完整 FAIL**。
- 当前建议不改 catalog 断言／SDK／生产行为，不新增 skip。继续原固定 run，待最后栈：若明确 startup timeout，再把它归到启动资源／fixture 边界并针对原启动事件完善诊断或受控复验；若是实际 catalog 身份／优先级断言，则保留为产品问题调查，不能通过宽松断言或加睡眠消除。

## 收尾判断

FR03 一行异步适配和 CNR 精确 writer 退休修正均有独立因果与安全边界，Root 两文件 delta 可接受；只涉及测试，原产品后端复核结论未因这两个测试问题失效。整体工程交付仍必须以修后准确候选的完整检查／CI为准。旧 be1 CI、固定6bc完整 FAIL、原 CNR未执行到的恢复部分、平台 NOT_RUN 及 catalog 待核分别保留。此时无需停止原 run，也不应在原 run 仍读取固定6bc时修改其 tracked 文件。

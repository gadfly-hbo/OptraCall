# A4 Studio flow 第二 FAIL 的只读现存证据观察

**当前结论：已定位本次候选合成根及失败前阶段，但尚未取得准确异常／footer，根因待核。** 不把它预判为环境、产品回归或任意可忽略读取错误。本次只读现存测试、日志、合成落盘 JSON／原生历史；未启动 Host、Provider、测试、浏览器或其他运行探针，未改 tracked 文件／断言。

## 当前日志与相同源码边界

- 当前日志 `/workspace/OptraCall-issue149-final/.local/pm-second/full-check-final-delivery.log:3340`：`Studio engineering flow uses real Host/Pi tools to construct sources and original SAP candidates, then publish exact versions`，**FAIL，14354.078042ms**。
- 观察时日志仍在增长，没有 test footer、该失败准确堆栈或断言正文。`tests/studio-flow.test.ts:61` 是整个用例声明，不能当作具体失败断言位置。
- 当前检查树 `/workspace/OptraCall-issue149-check-followup` HEAD 为 `3bdab0c06879530b55045f9e48a88a46517db39e`；独立 `6bc7..HEAD -- src extensions` 只有 UI `CaseIssuePanel.tsx`，Studio 测试及 `host-process.ts`／`tool-provider.ts` 均无 delta。这说明 Studio 服务不是此次新增 UI 修改范围，**不证明本次失败一定属于环境，也不据此认定产品回归**。
- 原 6bc 完整 run 的同用例确为 PASS／16826.926152ms（旧 `full-check-release.log:3329`），该旧成绩不覆盖当前 FAIL。

## 根定位与已经保存的进度

测试使用 `startTestHost()` 的 `/tmp/optracall-host-test-*` 隔离根，不在 test 中写独立运行 receipt。按精确配置 model `synthetic-studio-flow` 和时间定位到当前候选根：**`/tmp/optracall-host-test-NC01ij`**。其 `host/settings.json` 修改于 `2026-11-27T17:34:55.904Z`；同 model 上一次根 `/tmp/optracall-host-test-QdqYUb` 为 `16:54:45.601Z`。当前日志未打印 scratch root，最终 footer 如含路径仍应交叉核对，未读取 auth.json。

真实已落盘对象：

- Studio system `8868ce8e-97f4-4fcb-9f14-43de678d1da3`，`host/studio/index.json` revision 20，当前 SHA-256 `848889dc0b2514eba1be9823c2519ab509d5429bbad056aa1a66ecfe7a9db6fe`。
- 建设项目 `b1209615-24c9-465c-915b-52eb5d7e92d6`／任务 `681a5f8a-4f8f-49d6-9fc0-86a848f49b41`；原生历史包含 `STUDIO_BUILD_PROTOCOL_DONE`、`STUDIO_PREVIEW_PROTOCOL_DONE`、`STUDIO_REVISION_PROTOCOL_DONE`，最后已保存 run 为 completed。
- 四项原资产已正式发布；binding `e527b580-45b6-407f-bee9-e1ed7bd279fe` 保留 revisions 1/2，formalRevision=2；系统有两份 publications、一条 use；反馈 `9cb7426b-d4da-427d-93cb-6aba51b00bbb` 为 accepted。
- 普通分析项目 `42eb7ebd-8930-4b02-a780-fd10c7c027a5` 的首次使用任务 `66b1f2e4-27e5-4b38-834c-a8ab966a3fe6` 已 completed，原生历史包含 `STUDIO_ANALYSIS_PROTOCOL_DONE`、成功 bash 计算及原 declare-use 回执；`060_reports/studio-period.json` 已存在，原 REPORT_SHA 为 `c39586e4a68e09088c64c1a7328841d1a2cb4c6cb2b4f3ad0d6f67a1c8dd65cd`。

这些材料及测试线性执行顺序将失败窗口收窄到**第二次新版使用已建立／开始，尚未完成第二 use 报告**；不是初始 Host 尚未 ready 的失败。不能据此推出具体 HTTP 状态或根因。

## 第二 use 的准确现存状态

任务：`f59833ff-1f5d-4e71-9c1f-a4d41ca7c2ee`；project.json 中 lastRun 为 `d752ead0-cf67-4f36-88be-fb68471077ed`，status **running**，startedAt `17:35:05.591Z`，无 settledAt。

原生文件：

```
/tmp/optracall-host-test-NC01ij/host/projects/42eb7ebd-8930-4b02-a780-fd10c7c027a5/tasks/f59833ff-1f5d-4e71-9c1f-a4d41ca7c2ee/sessions/2026-11-27T17-35-07-044Z_01a21e13-3d23-76c0-ab72-09e4863dda27.jsonl
```

- 当前为 **102704 字节／8 行**、末尾换行，SHA-256 `bbec551ec447fc5746991cb415d227e8225beb276241d08133c287cac5b3e361`。
- 当前每行均可完整 JSON 解析；有 session/model/context、`17:35:07.199Z` 的 Studio context user，随后 `17:35:07.448Z` assistant `stopReason:aborted`／`errorMessage:"Request aborted"`；**没有工具调用／toolResult／第二完成 marker**。
- 未见 `studio-period-v2.json`／后续 assessment 报告，系统 uses 仍为一条。
- **aborted 可能是用例断言失败后 t.after 关闭 Host 的后果，不能凭此认定主动取消是原失败原因。** 当前文件完整也不能证明失败瞬间读取一定完整，不据另一用例的解析问题直接套用。

## 缺失证据与下一步的严格边界

`startToolProvider()` 的 `requests`、`errors` 仅为测试进程内存数组，本 test／fixture 没有把它们逐次写盘；原 Host fixture 的 stdout/stderr 也只留内存。本次不能从现存材料确认第二 run 是否收到 Provider 请求、responder 的具体返回、原 `json(response)` 收到何种状态／正文，或准确失败行。

只读测试显示候选窗口：`run()` 在严格 POST202 后，每次 GET task 直接调用 `json(response)`（默认 expected200）；该 helper 对任何非200都会立刻断言，没有区分暂不可读的 `409 session_history_unavailable`。现存第二 use 中断时序**与此窗口相容，但不构成发生过该409的证明**。原外层120s／轮询40s及当前14.354s用时也不能替代准确异常栈。

应等待 Root 保留完整 footer 后确定：

1. 首个实际异常是 POST、GET、状态／marker／tool-count、JSON解析、Provider 错误还是 after hook；保留原失败及准确原状态／code。
2. **只有 footer 明确证明原 GET 是 `409 session_history_unavailable`**，才可评估最小 test-only 观察适配：在同一个原40s窗口内将这一准确 status＋code 当暂不可读继续，不重置时钟；其他 HTTP／POST／正文解析错误仍严格失败。
3. 原最终 completed、markers、工具数／isError、准确 refs、原报告与新版报告、assessment／feedback、原件保全等断言全部保留；不改生产服务、扩大超时、吞任意HTTP错误、降断言或先写 flaky／环境结论。

本次观察至此结束，保持唯一固定 A4 run 继续；本文不是修复或重新验收的 PASS。

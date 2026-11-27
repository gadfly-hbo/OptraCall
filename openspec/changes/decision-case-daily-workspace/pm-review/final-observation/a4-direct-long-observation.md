# A4 direct 11KB 声明单FAIL现存证据观察

**当前结论：原始失败尚未分类，等待固定完整run的最终失败栈；不预先修源码／测试，不以现存声明回执将用例改判通过。** source固定 `a4c563f0632280010e7e12906c69fa6664cffd13`，tracked工作树未改。本轮只读现存根、Provider观察、native、Host输出及原测试／reader源码，没有启动Host、Provider、测试或新运行探针。

## 准确对象

- 当前固定run日志：`.local/pm-second/full-check-final-delivery.log` 第185行，`actual Pi direct 11KB declaration retains the exact original receipt and dispatches one original IR follow-up`，5569.239709ms；第186行诊断根与下列根一致。检查时尚无footer中的该用例异常栈。
- 根：`.local/overall-architecture-upgrade/development/delivery-native-repair/direct-long-BjOXFY`。
- `provider-observations.json` SHA-256：`0466dee81f3f3819fa15c9b02ecd12e72785b6f217e12933c9ab38368d524c51`。
- 原native：`host/projects/1264c5ea-6997-4fa0-9f6c-ab2d31aacf65/tasks/e8ce3605-4db0-4da4-a2a1-d2f05595ab32/sessions/2026-11-27T17-12-23-547Z_01a21dfe-6ef9-71fa-b787-9cd7968cc980.jsonl`，154849 bytes，SHA-256 `76d14ee07c7f46187a70a2c3ad66d184f5f23dad1f4e24c2e09337f5ee57ee72`。

## 可以证明的事实

1. Provider observations为 `errors=[]`，仅1次请求，`closedEarly=false`；原native的第1次HTTP记录为200且completed。未看到该首响应的Provider错误或夹具断言500。
2. 当前native共有14行，逐行JSON均可解析、有末尾换行，文件远低于原50MiB快照预算。**这只能证明当前落盘副本完整，不能证明当时并发读取也完整。**
3. 下列条目准确绑定同一project/task/request/session/toolCall；声明本体1件、saved确认1件。确认的entryId／身份／canonical SHA均匹配本体；toolResult的details及JSON正文与本体完全相等，父链含本体及确认，`isError=false`。长limitations为6×1903字符，确为本次11KB输入。

| UTC时间 | 原native／Host证据 |
| --- | --- |
| 17:12:23.775 | native第4行原run started |
| 17:12:24.145 | 第9行 `optracall.analysis-delivery` 本体，claim仍为declared-not-professionally-verified |
| 17:12:24.149 | 第10行 `optracall.analysis-delivery-receipt`，status=saved |
| 17:12:24.149 | Host stderr记录SIGTERM `host-shutdown-start` |
| 17:12:24.163 | 第11行 `declare_analysis_delivery` toolResult，isError=false |
| 17:12:24.185–.187 | 第12行第二HTTP attempt开始／failed，causeCode=UNKNOWN |
| 17:12:24.201–.202 | assistant `Request aborted`／原run settled=cancelled |
| 17:12:24.277–.279 | Host正常shutdown-complete及exitCode0 |

4. `receipt.json`未生成；project当前task.lastRun仍running，native末态cancelled，自动action条目0。没有主turn正常完成或IR跟随成功证据。`readTaskAnalysisDelivery`原契约先要求原run completed；当前取消后的native不满足完整原来源资格。因此不能把“tool保存成功”扩大成整项交付/IR测试成功，也不能倒用收尾之后的aborted/HTTP failed认定最初的业务声明失败。

## 现存证据不能区分的原始异常

原 `tests/analysis-delivery-native-v020.test.ts` 的 `pollRead`：先解析Host GET JSON；仅对 **409＋session_history_unavailable** 记不可读观察并继续；其它HTTP状态按原200断言失败。收到可用state后，`readState`再对原native直接 `readFile(...).trim().split('\n').map(JSON.parse)`，没有对该第二次原始读取做稳定快照或SyntaxError观察适配。

因此，已知的409/session_history_unavailable**在pollRead内**本身不会直接导致FAIL；但仍不能排除不同409、POST原202断言、HTTP JSON解析错误或其它具体断言。原始native正在追加长行时，第二次raw读取存在观察到未完整JSON的窗口；这是源码可见的可能窗口，**当前完整14行不能证明本次确实读到了partial bytes**，原测试没有保存当时失败读取的byte snapshot或HTTP轮询响应序列。

用例总耗时5.569秒，而其观察deadline是在配置／建任务／POST之后才建立的6秒窗口；现存时间顺序支持这是早于正常观察窗口耗尽的异常收尾，但仍不足以定位哪条原始异常。准确异常种类、代码、断言位置及是否在raw JSON.parse，要等完整run的reporter footer栈。

**处理边界：** 当前保持固定A4 run继续、源码／fixture／断言一字不改。只有最终栈确实定位原test raw native字节解析SyntaxError，才可据该证据评估限范围测试观察适配；不能提前吞HTTP解析／其它错误、扩大6秒窗口、弱化最终准确native／cardinality／IR==1／反例或业务权威断言。这里没有实施或宣称任何修复闭环。原A4单FAIL仍保留，原各候选专项PASS及CI各自按其身份记录。

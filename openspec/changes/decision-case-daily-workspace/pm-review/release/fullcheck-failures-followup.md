# 固定6bc完整失败的收尾调查与8dd测试增量复核

原完整 run 已结束：`6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`，**3602项：3401 PASS／5 FAIL／196 SKIP**，1870769ms。原 `.local/pm-second/full-check-release.log` 完整保留；下述单项绿结果**不覆盖原整包5 FAIL**，也不等于最终 source 完整检查或CI通过。

本次只读产品／测试／原合成落盘文件，只写 `.local/pm-final/fullcheck-followup-probes/` 探针、快照与报告；未修改 tracked 文件，未参与永久修复。最终只读核验 source `8dd24cae613bf9f1b4dd1ca79e1d8102289431b9` 的单测试增量，未发现新增必须修复项。

## I131-B：原失败唯一变化为正常创建准入回执，不是无效候选保存

原失败在 `tests/strategy-candidate-host.test.ts:273`：expected `96de66eb8b625e636aef147af91e40847fad21c19663af60970b6b29e2e00d6a`，actual `73417a181d833cc589eaf6662ca33af2ef61b2b3bb5ace89239f270e5bfeefc7`，消息 `all validation failures must produce zero persisted writes`。

准确原根为 `/tmp/optracall-host-test-CoKaGo`，原文件：`host/strategy-initiatives/ea5f193f-6963-4a8c-8e7d-3886d5298419/candidates.json`。通过测试专用 configuration model 精确定位；该根仅本候选，未发现跨测试共用候选身份。原最终文件有两次合法保存回执，不能仅凭最终文件或孤立一次通过解释掉失败。

### 原FAIL的精确SHA与字段因果

原测试没有保存两个原始字节快照。因此使用原最终对象、原 JSON 属性序、已知初始块／目标／pendingInput及准入时间，**在隔离文件中**还原初始在途状态；先确认 Python重编码与原最终文件逐字节一致，再核对两个目标 SHA。还原的两个文件分别**精确匹配原失败栈的完整 expected／actual SHA256**，唯一差异为：

```
.candidates[0].createRequestId
before: 缺失
after:  06668ada-ceaa-43fd-8b72-775ffa760591
```

sessionFile 两边均已存在，updatedAt均为 `2026-11-27T16:50:37.616Z`，所有业务字段、blocks/goals/contentSha256、revision、操作状态、候选集合和保存回执均相同。这里明确是**与原真实SHA匹配的还原字节**，不是声称原测试曾直接保存快照，也没有修改原文件。

该字段的原唯一生产写入位于 `src/host/strategy-candidate-host.ts:535–547`：await原 `run.accepted`／原持久性确认，保存sessionFile与本次createRequestId，然后原create返回202。初次合成Provider请求可能先于父Host完成此回执写；原step0立即取whole-file基线，step6才比较，跨过了这项合法准入写。

原无效保存分别在同文件284–286的字段／operationId／blocks／goals校验阶段拒绝，校验在实际保存mutation前；SDK拒绝的对象目标也未进入业务保存。不能把正常createRequestId提交归因于无效保存，更不应修改生产流程抑制原创建回执。

证据均在 `fullcheck-followup-probes/`：

- `original-hash-reconstruction-receipt.json`：原文件身份、最终重编码逐字节相同、两个完整匹配SHA及对应状态。
- `original-before-reconstructed.json`／`original-after-failures-reconstructed.json`：匹配原SHA的隔离字节。
- `original-hash-diff.json`：唯一createRequestId差异。

### 逐步探针与安全barrier复验

先在保留全部原断言的隔离副本按每次Provider请求保存candidateFile原JSON／hash；该次原用例1/1通过，step0–6相同。**没有以单绿关闭原FAIL**，上述原SHA精确字段证据才是原因定位依据。

第二副本只加本次**原create POST202回执的Promise latch**：Provider step0先等该回执，再捕获原whole-file基线；POST原返回后释放，t.after首先释放保证异常收尾。没有增加睡眠、放宽超时或改成业务字段投影。

实际真实Host＋官方Pi＋合成Provider **1/1 PASS**：create202不被首请求等待阻塞，ack记录的requestId与createRequestId均为 `f1f2936c-b60b-4eb8-ac2b-c6dab0d5e9a9`；step0与step6的whole-file SHA均为 `6d97310c3b0a106299516557429a66a4253c914f75ed09081df968903d2fcbaa`。step0–6的saveReceipts始终0，两次合法自修后依次1／2；所有原错误定位、操作身份、目标校验、合法保存及最终Provider errors=[]断言原样通过。

- 探针：`candidate-instrumented.test.ts`／`candidate-post-ack-barrier.test.ts`。
- GREEN日志：`candidate-post-ack-barrier.log`。
- 精确GREEN收据：`candidate-1795799058574-151108/receipt.json`，含ack、逐步原JSON和hash。

**结论：最小修复仅为测试准入barrier，不能改生产代码或缩小严格whole-file断言范围。** 原FAIL来自基线跨过合法准入元数据写，未发现“被拒候选输入仍保存”的产品缺陷；该结论有原失败SHA级原因与保留全部原断言的barrier复验，非笼统flake判断。

## 两个10秒Host启动失败：原业务断言未执行

原完整footer已明确：

- `tests/project-host.test.ts:442` catalog用例：`Test Host startup timed out`，原fixture24行。
- `tests/project-selected-methods-v020.test.ts:52` A07/A09：同一startup timeout／同一fixture位置。

因此原失败发生在Host ready之前，不是catalog选择顺序、固定Skill身份或selected methods实际读取断言。日志不能进一步区分CPU／IO调度等具体负载根因；不据此修改业务断言、SDK或加入skip。

使用原6bc文件、原断言、原10秒启动界限，单并发仅选择这两个原用例重跑 **2/2 PASS**，分别2.986s／4.203s，总8.578s。日志 `fullcheck-followup-probes/original-startup-failures-rerun.log`，selected methods实际原合成链路证据根 `.local/overall-architecture-upgrade/development/selected-methods/actual-pi-easnrw`。原整包两项FAIL仍保留，最终完整新候选仍需真实通过。

## 已处理的另两项与旧CI

FR03异步assert.rejects、CNR精确PID＋startTicks＋Z的writer退休条件、原完整UNKNOWN／no replay／no invented cleanup及字节保全的独立RED→GREEN与只读增量复核，均见 `fullcheck-failures-review.md`。原完整footer已确认CNR正是原SDK driver ESRCH等待失败，与独立精确过程收据吻合。

旧be1 CI的accepted失败已由旧工具期望[]导致合成Provider500、busy:true／accepted至循环耗尽的实际隔离复现解释；6bc正确工具契约用例已通过，不需为此旧CI再增加等待。所有旧CI及原完整FAIL保留。

## source 8dd增量审查与最终交付边界

已在 `/workspace/OptraCall-issue149-check-followup` 只读核验：2eb→8dd只改 `tests/strategy-candidate-host.test.ts`。永久diff恰为上述原POST202 admission latch、step0等待、ack后释放、t.after先释放以及文件末尾换行；**whole-file严格hash、全部错误与合法保存断言、原180秒用例界限及原循环未改变**。没有skip、字段投影、生产更改或人为放宽零写入。Root永久真实用例绿结果另由其日志记录，本文不冒充本人运行该永久文件。

`git diff --exit-code 2eb..8dd -- src extensions package.json package-lock.json` 为0，`git diff --check 2eb..8dd` 为0。后端／所有产品相对2eb无变化；既有后端25/25为6bc实际成绩，经字节与增量核验沿用，未冒称8dd重跑。工作树出现的文档归档WIP与预存node_modules不属于本人写入；source／测试／依赖无未提交修改。

**本测试增量复核通过，无新增必须修复项；不宣称整包通过。** 原6bc整包5 FAIL／196 SKIP不由目标绿覆盖；下一完整final source及准确head CI必须实际通过后才能据其核定工程交付。

本人所有已启动探针现已结束，不再启动Host或其他探针，为Root唯一最终source完整检查留出资源。原SDK driver zombie只是退出的OS条目，继续保留原cleanup UNKNOWN，不做清理完成声明。

# Issue #149 准入完成边界测试增量独立复核

**结论：PASS，无必须修复项。** 绑定source `8dd24cae613bf9f1b4dd1ca79e1d8102289431b9`，工作树 `/workspace/OptraCall-issue149-check-followup`。本轮仅只读静态检查，没有新开Host、Provider或运行探针，没有修改tracked文件／SDK／依赖或commit。

## 精确差异及生产适用性

`2eb30a51e31333a4252d4b6564bb0ad3a66326b8..8dd24cae613bf9f1b4dd1ca79e1d8102289431b9` 只有 `tests/strategy-candidate-host.test.ts` 一件：8行新增／2行移除，其中包含注释和文件末尾换行。`src`、`extensions`、`scripts`、package与lock的 `git diff --exit-code` 为0，`git diff --check`通过。

因此原2eb／6bc各次生产字节、owner、配置/取消/COMMIT资格、来源、SDK1.4.0/Interface v3及四原则结论保持原适用边界；不声称全部运行已在8dd重跑。原完整6bc **3602／3401 PASS／5 FAIL／196 SKIP** 仍保留；本静态PASS不代替后续准确候选独占完整check和CI。

## Latch没有削弱零写入断言

- Provider step0新增等待 `admission`，仅在原创建 `POST /candidates` 的 **202回包被原req helper核准并读出** 后释放，再读取原 `candidateFile` 的**整个文件SHA-256**。不是按字段投影，也没有忽略createRequestId或归一化JSON。
- 独立追读未修改的原Host：`create → await send → await run.accepted → await options.mutate` 写入原 `sessionFile/createRequestId` 后调用 `accept`；server再以202返回 `await strategyCandidates.create`。这确立了“正常创建准入元数据保存完成→冻结whole-file摘要→实际非法tool calls”的先后边界，避免把正常准入写误归因于失败的候选保存。
- step6在六种失败之后、首个合法自修保存之前取whole-file摘要，原严格 `bytesAfterFailures === bytesBefore` **原文保留**。六类原错误码／字段path／原因、两个合法保存operationId、目标数组、saveReceipts数量2、Provider errors为空、原completed与500×20ms观察循环、原180000ms用例deadline全部未改。
- 没有新增sleep、延长超时、skip、catch吞错、缩小摘要范围或放宽产品保存准入。测试结束hook先释放latch，再按原路径关闭Host／Provider，避免创建失败时遗留被测试自身挂起的response；不把这个hook当业务成功或cleanup证明。

原第五FAIL的准确旧SHA及“唯一差createRequestId”因果重建由后端独立报告承接，本人本轮未重复该动态调查，也未把Root／独立副本的1/1 GREEN写成本人执行。本人静态确认的是上述原生产准入顺序、等待边界和全部原业务断言未削弱。

## 文档与交付边界

本轮不重复扩大的归档包审查；此前 `release-doc-review.md` 的51文件／917115B与manifest摘要只代表**它当时的历史快照**，不冒称当前新增附件后的总量或hash已复核，亦未覆盖或改写该报告。新归档应继续保留原FAIL、旧SHA与限定证据沿用、两个startup原样2/2 PASS及全量未通过状态。

四原则不因这次测试改动改变：没有生产功能、模型流程、权限或生命周期增量；latch是合成Provider的测试观察边界，不是Host编排Agent。完成本复核后停止额外探针，后续独占完整check和准确CI由Root取证。

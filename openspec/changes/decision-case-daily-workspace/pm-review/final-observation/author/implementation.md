# A4 两处 GET 观察窗口修正

目标：仅修复原 `run` 轮询对准确 `GET 409 native_snapshot_incomplete` 的观察处理。基线为 `a4c563f0632280010e7e12906c69fa6664cffd13`。允许写入仅为 `tests/studio-flow.test.ts`、`tests/v13-project-goal-entry.test.ts`；临时探针与记录只在本目录。不改产品、SDK、依赖、检查器、超时、skip、全局写请求断言或业务验收。

已重读工程规范 IN01–IN07、SDD/TDD 的确定性 RED/GREEN 与失败保全规则。此次没有新增会话、运行策略、业务权限或产品接缝，仍使用原真实 Host／官方 Pi／本地合成 Provider。

原完整检查 footer 已复制为 `a4-original-footer.log`（原日志仍保留在 `.local/pm-second/full-check-final-delivery.log`）。原 A4 本地结果为 3607 tests／3407 pass／4 fail／196 skip；其中本任务两 FAIL 的准确栈均是原 run 内 GET 的 409，code 为 `native_snapshot_incomplete`，accepted 为 false；不是原 POST202 失败。不得用本次局部结果覆盖该完整原 FAIL 或 Root 另核的 CI 结果。

两文件只在原 run GET 轮询内辨认 status=409 且 code=`native_snapshot_incomplete`，按原 25ms 间隔继续同一窗口。Studio 原 40,000ms 与 v13 原 300 次窗口不变。其他 GET 状态／code、所有 POST 状态仍严格失败；没有增加 `session_history_unavailable` 或其他 code。原最终 completed、marker、源版本、数据、报告、assessment、permission、工具数及 isError 等断言全部保留。

`scope-and-hashes.json` 确认：两文件只有原 GET 轮询观测区域变化，该区域以外所有字节完全相同（包括全局 json/call 与所有业务断言），产品／SDK／依赖 diff 为空。两文件 before 原字节也保存在本目录。没有新增永久测试用例。

## 确定性验证

临时 `inject-first-task-observation.mjs` 通过 Node `--import` 仅包装测试进程 fetch，不改原文件或 Host。它先让原真实 POST 获得 202，再在该任务原真实首次 GET 已获得 200 时，仅一次将此观测响应替换为带精确 code 的 409；所有后续请求仍走原 Host。每次 receipt 记实际方法、准确任务 route、原状态及单次注入计数。

| 验证 | Studio | v13 首场景 | 对应文件 |
| --- | --- | --- | --- |
| 修前：第一次原 GET 注入准确 native_snapshot_incomplete | 按原 run 409≠200 失败 | 按原 run 409≠200 失败 | `studio-red.log`、`v13-red.log` 及各 `*-receipt.json` |
| 修后：完全相同单次 GET 注入 | PASS，完整原 Studio 业务场景 | PASS，完整首业务场景 | `studio-green.log`、`v13-green.log` 及各 receipt |
| 修后：单次 GET 注入 configuration_changed | 预期失败，仍 409≠200 | 预期失败，仍 409≠200 | `studio-other409.log`、`v13-other409.log` 及各 receipt |
| 修后：原实际 POST202 响应替换成同精确 native code 的 409 | 预期失败，仍 409≠202 | 预期失败，仍 409≠202 | `studio-post-strict.log`、`v13-post-strict.log` 及各 receipt |

上述八个 receipt 均恰好一次注入；修前两个 GET RED receipt 的 armed GET 总计数均为 1。修后 GREEN receipt 的 armedGets 是最终累计轮询次数，不能把它误写为首次注入位置。为明确这一位置，另加仅临时探针的 armedGetOrdinal 记录及首次 GET 限定，补跑 `*-firstget-green.log`／对应 receipt，原 probe 版本和原日志均保留。负例保留为预期失败，不计作通过的业务测试，也不写成产品 FAIL。

注入命令的共同形式（绝对 Node25 路径）：

```
OPTRA_OBS_RECEIPT=<本目录对应receipt绝对路径> /workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node --import /workspace/OptraCall-issue149-final/.local/pm-observation-fix/inject-first-task-observation.mjs --test --test-name-pattern='<原场景名字前缀>' <原测试文件>
```

其他 GET code 负例另设 `OPTRA_OBS_INJECT_CODE=configuration_changed`；POST 负例另设 `OPTRA_OBS_INJECT_METHOD=POST`。没有这些环境变量时只运行指定原文件，未扩大到全仓 full。

## 两原文件无注入整组

命令：

```
/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node --test --test-concurrency=1 tests/studio-flow.test.ts tests/v13-project-goal-entry.test.ts
```

日志为 `two-original-files.log`：退出 0，7 tests／7 pass／0 fail／0 skipped。Studio 完整资产建设、准确发布、使用／维护、实际计算报告及 assessment 场景，以及 v13 全六项原交接／来源／权限／恢复场景均完成原断言。原文件与产品码已冻结；只允许继续本地证据记录。

首 GET 补证最终完成：`studio-firstget-green.log`、`v13-firstget-green.log` 各 PASS；对应两个 receipt 的 `injections=1`、`observation.armedGetOrdinal=1`、`originalStatus=200`，明确替换的是原 run 的首次实际 GET 且仅一次。原 Studio 全业务场景与 v13 首场景全部原断言完成。文件哈希再次核对与 `scope-and-hashes.json` 相同。此后停止写入 tracked 文件，交非作者只读复核；本次不 commit/push、不启动全仓 full。

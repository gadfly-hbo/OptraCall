# A4 后四项观察边界修正：独立非作者复核

**结论：最终四件test-only增量通过，未发现必须修复项，建议承接到最终完整check／CI。** 绑定固定source **`9900e202736977080f38309d0c76f6eff3eda9c5`**，基线 `a4c563f0632280010e7e12906c69fa6664cffd13`。提交后的四文件摘要与本人已审／已跑VM的下表逐件相同；source WIP为0，生产差异为0，不冒称整包已通过。本人未改tracked文件，仅只读实现/原API/原失败及在 `.local/pm-final/` 运行纯VM确定性反例；未启动Host、Provider、浏览器、SDK或Node test runner。

## 原FAIL与根因边界

已核 `.local/pm-second/full-check-final-delivery.log` 最终footer：**3607 tests／3407 PASS／4 FAIL／196 SKIP，1700399.926768ms**，原A4完整check未通过。

- direct11KB精确为 `SyntaxError: Unterminated string in JSON at position 7918`，栈为原 `readState` 第25行的原始native逐行JSON.parse，不是先前仍待核的业务声明拒绝。此前 `a4-direct-long-observation.md` 的本体/确认已存、cleanup后cancelled及“待footer”原边界保留。
- Studio和v13精确为任务GET **409/native_snapshot_incomplete**，原strict HTTP helper期望200。
- DW Pi目录为工具结果尚空；旧helper把不存在的 `snapshot.running` 当未运行，首个assistant（可为tool-call进度）就提前返回。原API实际返回的是顶层 `busy` 和 `discussion.lastRun.id/status`。

## 四文件源码与原契约审查

1. **analysis-delivery-native**：HTTP response.json、状态断言均在新try/catch之外；仅实际 `readState` 中的SyntaxError视为本次raw native不可读观察。EACCES/ENOENT/TypeError及其它错误继续抛出；不吞HTTP JSON SyntaxError。仅原409/session_history_unavailable加本次精确409/native_snapshot_incomplete可继续。两个其它mutable循环复用同一pollRead；原6秒／15秒窗口、20ms间隔、用例deadline没有增加或重置。
2. 最终准确 `readTaskAnalysisDelivery`、completed、IR==1、原本体/确认cardinality、精确身份/原回执、nested反例、预算前零报告、正文/来源错误反馈及其它业务断言原样保留。不可读观察不提供state/native或伪造成功；持续坏native不能满足最终原资格。
3. **workspace-daily-pi-loop**：原20秒与200ms间隔不变。两个POST使用各自真实requestId；helper只接受**同id＋completed＋!busy**，同id failed/cancelled/unknown立即失败。没有用assistant文本/工具进度推断完成，也没有业务重发或自动重新请求模型。
4. **Studio/v13**：只在各自run的原任务GET轮询中接受精确409/native_snapshot_incomplete为暂不可读；其它409/500、HTTP JSON解析、原POST202及最终completed/marker/工具数/isError/准确版本/保全断言不改。Studio原40秒wall-clock、v13原300次及25ms间隔均保留；缺失或持续损坏数据最终仍失败。
5. 已核整个生产 `src/extensions/scripts/package/lock` 无WIP差异，检查器/白名单/SDK未变；新状态仅是测试观察，不改变Host fail-closed API、原owner/生命周期/取消/配置/COMMIT或Agent方法选择。`git diff --check`通过。

## 本人独立纯VM确定性验证

脚本 `native-observation-vm.mjs` 从A4旧helper与当前helper**原文提取完整函数**，仅用Node类型擦除后放进隔离VM；host、clock和native bytes均为明确假对象，不加载产品或SDK。收据 `native-observation-vm-receipt.json`，日志同名 `.log`。**14项确定性检查全部通过**：

- 旧helper首个assistant/tool-progress＋busy=true即返回，RED反例复现；新helper经过accepted进度、completed但仍busy，直到同id完成且!busy才返回。
- 错requestId的completed不通过；仅错id持续至原20秒模拟预算仍失败。同id failed/cancelled/unknown各在首读立即失败。
- 一次native JSON部分prefix返回undefined并计不可读，后续完整字节才得到native；两个精确409各为不可读且不执行native读取。
- HTTP JSON SyntaxError、其它409、非SyntaxError文件错误均继续失败。
- 持续完整换行但语法损坏JSON，在原6秒模拟预算内300次仍没有成功观察，原最终idle断言失败、直接最终raw读取也继续SyntaxError。不是以跳过坏数据造出成功。

首次VM装载因本地TypeScript7不再提供旧compiler API而在运行任何case前失败，该自有harness启动错误保留于 `native-observation-vm-bootstrap-failure.log`，不是产品RED；之后改为Node内置类型擦除，无依赖/产品修改。真正旧行为RED是上述首assistant提前返回反例。

## 固定文件身份与他方运行范围

| 文件 | 当前SHA-256 |
| --- | --- |
| tests/analysis-delivery-native-v020.test.ts | a83d69c24082534c3732ad052bac015c93018d4d026f665ae3c73ebe01c7d8d6 |
| tests/workspace-daily-pi-loop.test.ts | 4b7d336d15dd2c23d952449b9c217bd6825a7b623fe376a8b250df2e067317b3 |
| tests/studio-flow.test.ts | 7a3ac39197ff5ff7a617d597aec584511f88f93531b7d67c69d1ea2169d3a99d |
| tests/v13-project-goal-entry.test.ts | 41ba8a8f8c9615334ec558600a065cfd0f9a741da01cb800d5f46430d6af45b9 |

后两项与fixer冻结的 `.local/pm-observation-fix/scope-and-hashes.json` 一致。fixer两原文件无注入整组7/7 PASS，日志 `two-original-files.log`；Root的native/DW实际Host组亦7/7，合计14项实际目标验证分别归执行人记录，**不冒充本人运行**。另只读核准两份 `*-firstget-green-receipt.json`：各injections=1、armedGetOrdinal=1、原GET200仅该次替换409/native_snapshot_incomplete；其它GET409与POST同code负例仍严格失败。原初版注入日志／累计armedGets与补充精确序位收据分别保留，不混作同一证据。

本人最终 `git diff a4..9900 --stat` 确认仅这4件测试，`src/extensions/scripts/package/lock` diff=0，固定HEAD为9900且tracked clean。最终独占完整check／准确CI仍由Root执行，本报告不把纯VM或14项目标绿当整包PASS。

四原则仍保持原生产通过范围：没有新产品门槛、推理循环、权限或生命周期；复用原公开状态/准确回执/SDK，仅纠正测试对“暂不可读”和“准确终态”的观察。原A4四FAIL、旧source成绩及本次固定9900修正分别保留。完成后不再增加探针范围，供Root独占最终完整check／CI。

# 固定6bc完整检查两个 Host startup timeout 的独立复验

**结论：两项原合同在原源码／原fixture／原10秒启动时限下，单并发独立复验2/2 PASS；原完整check仍是5 FAIL，不能凭本次绿重跑关闭整包门禁。** 本报告不覆盖第五项strategy-candidate hash失败，亦不改写原完整失败或此前2eb各专项限范围PASS。

复验位置 `/workspace/OptraCall-issue149-final`，开始／结束HEAD均 **`6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`**，tracked工作树clean，使用该树实际物理 `node_modules`（非symlink）及Node25.9.0。没有修改测试、断言、Host fixture、deadline、SDK、依赖或源码，没有commit。只运行Root指定的两个原用例，日志／收据写 `.local/pm-final/`；原selected-methods测试也按它原有逻辑在唯一既有合成证据根生成native与receipt，没有改其产物策略。

## 原完整运行的准确失败

原 `.local/pm-second/full-check-release.log` 最终：**3602 tests／3401 pass／5 fail／196 skip，1870769.006335ms（约31分11秒）**。其SHA-256为 `8bc81e9594a7a78d7e0e2d76b5eda50444d831d8efea365e5c29633128547870`。这次整体check没有通过。

两个原失败块已从最终footer逐字提取至 `startup-timeout-original-stacks.log`：

- `tests/project-host.test.ts:442:1`，`projectSkillCatalog preserves SDK selection order for project-supplied optional skills (Project Plan contract)`，10104.432002ms。
- `tests/project-selected-methods-v020.test.ts:52:1`，`A07/A09: one confirmation carries exact selected versions through Host/Pi; actual Skill and SAP reads remain distinct from the Agent use declaration`，10207.47138ms。

两者的实际错误和完整栈相同：

```text
Error: Test Host startup timed out.
    at Timeout._onTimeout (file:///workspace/OptraCall-issue149-final/tests/fixtures/host-process.ts:24:68)
    at listOnTimeout (node:internal/timers:605:17)
    at process.processTimers (node:internal/timers:541:7)
```

原fixture此处的硬定时器是 **10_000ms**：未观察到 `host-ready` 就SIGTERM本fixture创建的Host并reject。catalog先await该Host，之后才配置／建项目／读catalog／核project override与固定builtin；A07/A09也先await该Host，之后才进入选择版本确认、实际Pi工具读取与声明。故这两次原失败是**启动前置时限失败，原业务断言尚未执行**，不是已观察到SDK选择顺序、SAP版本或工具结果错误。原错误未保存该10秒窗口的Host phase/stdout/stderr／资源采样，不能凭失败行补造更细启动原因。

## 本次独立原样单并发执行

```sh
TMPDIR=/workspace/OptraCall-issue149-final/.local/pm-final/startup-timeout-tmp \
/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node \
  --test --test-concurrency=1 \
  --test-name-pattern='projectSkillCatalog preserves SDK selection order|A07/A09: one confirmation' \
  tests/project-host.test.ts tests/project-selected-methods-v020.test.ts
```

结果 `startup-timeout-isolated.log`：**2 PASS／0 FAIL／0 SKIP**，总7487.971188ms；catalog **2330.873013ms**，A07/A09 **3714.001347ms**。这些是整条用例耗时，**不是单独测得的Host ready时长**；没有通过加睡眠、延长deadline、绕过fixture或mock成功制造通过。

- catalog执行原全部选择顺序断言：项目 `.pi/skills/deep-research`准确override原可选Skill，同时固定builtin data-analysis仍取仓库原路径。
- A07/A09执行实际Host→官方Pi→隔离合成Provider：准确所选Skill/SAP版本随确认交付，真实Skill/SAP工具回执、native entry/hash与Agent声明分开；原4次Provider请求、同确认回放不再派发、errors空等断言均执行。专业正确性和真实LLM采用仍NOT_RUN。
- 原selected-methods receipt副本为 `startup-timeout-selected-methods-receipt.json`，保留原native／合成根路径；命令、原完整log hash、两个测试／fixture／package与lock未改字节摘要见 `startup-timeout-receipt.json`。

## 并行负载解释及关闭界限

原完整check实际窗口按文件birth/mtime为 **2026-11-27 16:28:29–16:59:50 UTC**。多个独立合成检查确实与它重叠，并非只有原整包test进程：本人 `release-runtime-delta.log` 为16:29:37–16:29:53，`release-cancel-source-qualification.log`为16:30:22–16:30:25，已独立catalog调查日志为16:46:26–16:46:32；另有Root组织的并行UI/后端检查。它们使用隔离数据根，仍共享CPU、文件系统、模块加载与进程启动资源。当前环境核到availableParallelism=4、cgroup CPU quota为4CPU，启动多个Host／SDK／编译或浏览器进程会竞争这份预算，固定10秒startup wall-clock因而可能耗尽；隔离数据根不等于隔离运行资源。

准确footer现已支持把这两项归为**真实Host startup timeout**；受控单并发原合同通过，也支持负载敏感的启动前置问题，而非已复现业务错误。但文件时间只证明检查窗口重叠，未记录两次失败各自10秒内的逐进程CPU／I/O／ready事件，**不能宣称资源竞争是唯一且量化证明的根因**，也不能把本次2/2 PASS或先前catalog4.39秒局部通过改成原完整run PASS。

原2项harness修复已有独立因果与2eb代码，另1项hash调查由后端负责；这不会自动消除原全量5 FAIL。整体门禁仍需在准确最终候选、明确并发预算且不叠加额外独立probes的完整check／CI取证；不得因本次绿重跑跳过、删除断言、放宽10秒fixture或改SDK。此前2eb的UI／Runtime／后端范围PASS继续保持各自准确适用边界，完整交付状态另记。

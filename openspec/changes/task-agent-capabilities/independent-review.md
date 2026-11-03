# 非作者独立复核原文与收尾索引

2026-11-04，由主agent汇总。最终v3两名非作者增量复核通过，未发现未解决可行动问题；原v1不通过、独立反例、修正和重验分别保留。v3 Spec独立23项、Standards独立15项均通过，类型/边界通过；其此前v2完整复核范围和限制见原文。

作者最终完整检查1001项/998PASS/0FAIL/3条件SKIP及构建完成，两名复核者核对实际日志SHA，不冒充独立全量执行。真实联网取消、证据不足、NOT_PROVED、403/404与费用UNKNOWN没有因工程绿色被追认为通过。

本期实际SDK/Provider hooks继续承担循环与协议续接；没有Host经营计算或专业阶段编排。受管工具单调上限与公共UNKNOWN隔离由实际反例复验核定，属于环境治理。专项结论以各原报告最终固定范围为限，不推广到未检查既有实现。

原始证据持久保存于 `.local/task-agent-capabilities/review-spec/` 和 `review-standards/`；下列报告全文保持原样，相对路径按各复核根解释。


---

## spec / v1

原文件 `.local/task-agent-capabilities/review-spec/report.md`，SHA256 `e81a09d1a06a4f637f3f0f37223c0692916dc815e08cc7d33c066e4fa65f909b`。以下全文保持原样。

# Independent Spec review: candidate v1

**结论：不通过。2 个 P1 发现，均有独立反例。** 作者定向测试通过不覆盖这两条失败路径。本复核者未参与任何候选创作；先读规范/规格并写下 expectations.md，再读实现/作者测试，源文件保持只读。

## 固定范围

- 仓库：`/Users/bendandebaba/.codex/worktrees/31d3/OptraCall`；分支 `codex/Host-Agent-Extension`；base/HEAD `fa52ae2f2507309dcb204b3cef616397a19bf62d`。
- 固定完整候选：`candidate-v1.json`，SHA-256 `4b4b4df935c2cb6361aa8b060c392a5fd1c1bc9c3fa35a64bab148bbc91bd4af`；573 个文件在复核前后全部匹配。检查 cwd 为 `review-spec/candidate`，依赖只读复用。
- 审查全部 5 个 tracked 改动，以及两个新增实现、3 个新增测试、6 份本变更文档；实现以 MCP graph search/snippet 发现，再读固定文件。依据为工程规范 v1.4 §2/§4、IN01–IN07、统一接入说明、`task-agent-capabilities/spec.md`。独立预期见 `expectations.md`。

## P1-1：managed codemode 越过角色工具上限

位置：`src/agent/project-session.ts:267-269`（相关原执行端：`protected-tools.ts:213,346-347`、`protected-tool-process.ts:26,37-48`）。

规格第 21 行要求“角色 tools 只可收窄父当时激活工具”。当前只筛选子 SDK 注册的表层 customTools；绑定的受管 codemode execute 仍使用父 `protectedTools` 闭包，把全部父 toolNames 送入执行器。独立角色声明 `tools: [read, codemode, tool_search]`，child wire 仅有这三个工具；`codemode` 调用 `tools.write` 仍成功将 `INDEPENDENT_FORBIDDEN_WRITE` 写入项目 020，并被标为 completed。同一反例在 unmanaged 下正确拒绝且无文件。

建议：将同一个单调能力上限传到受管执行端并覆盖 codemode 间接调用；若不能安全收窄，则明确拒绝该组合。只改模型声明或再过滤一次 SDK registry 不够。

证据：`capability-probes.test.ts`、`capability-probes.log`；实际 managed 记录 `candidate/.local/task-agent-capabilities/runtime/subagent-ew40q3/independent-capability-observed.json`。独立运行 1 PASS / 1 FAIL。

## P1-2：unmanaged 子清理失败后公共占用被释放

位置：`src/agent/project-session.ts:406-419`（关联 `retireChild:41-53` 和现有公共 `agent-sessions.ts:281-296`）。

规格第 12、14 行要求所有子资源留在父公共占用中；统一接入要求清理失败保持 UNKNOWN/隔离，仅显式清理可重试。独立测试通过官方 SDK 的 `AgentSessionRuntime.prototype.dispose` 对内存子会话注入确定性清理失败，再经真实公共 domain/start 运行。首次父结果虽然 failed，但公共 busy=false、executionState=unmanaged/busy=false；未显式清理时第二 turn 被 accepted，并产生第 4 次真实 loopback 模型请求。失败 dispose 仍仅执行 1 次，证明是未清理状态下重新派发，而非已收尾。

原因是 execute 捕获 retireChildren 失败后按一般模型失败返回并清 run；公共 finish 对 unmanaged 不执行 retirement，因此不知附属资源 UNKNOWN。建议沿唯一公共 Resource 传播清理未知并保留占用，后续 start/open/command 均拒绝，只允许显式 cleanup retry，不能另建业务 busy 台账。

证据：`independent-probes.test.ts`、`independent-probes.log`、`cleanup-fault-WzCsar/observed.json`（实际目录请见同级 cleanup-fault-*/observed.json）。1 个确定性产品断言 FAIL；首次生成器 SyntaxError 单独保留于 `probe-setup-failure.md`，不计产品失败。

## 独立执行结果

所有命令 cwd 为固定 candidate，日志在 review-spec；均无真实 Provider、外网或凭据调用。

| 命令/范围 | 结果 | 证据 |
| --- | --- | --- |
| `node --test tests/subagent.test.ts tests/subagent-runtime.test.ts tests/native-search-runtime.test.ts` | 30/30 PASS；macOS managed 项实际执行，无 SKIP | target-tests.log |
| `node --test tests/agent-sessions.test.ts tests/agent-session-execution.test.ts tests/session-compatibility.test.ts tests/protected-session.test.ts tests/project-runtime.test.ts` | 87/87 PASS；无 SKIP | consumer-tests.log |
| `node scripts/check-agent-session-boundary.mjs` | PASS | boundary.log |
| `node --test tests/agent-session-boundary.test.ts` | 9/9 PASS；包括受控绕过反例 | boundary-tests.log |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 | typecheck.log |
| `node --test ../native-probes.test.ts` | 2/2 PASS：连续两次 pause 均仅一条 wire 用户消息；Anthropic 搜索原块+实际 read 共存并保存/重开/下一显式消息 | native-probes.log |
| `node --test ../capability-probes.test.ts` | unmanaged 控制 PASS；managed 权限反例 FAIL | capability-probes.log |
| `node --test ../independent-probes.test.ts` | UNKNOWN/公共占用反例 FAIL | independent-probes.log |

过程偏差：运行 87 项既有回归前未设置 TMPDIR；它们内部的 os.tmpdir() 因而生成了 `/var/folders/.../optracall-host-test-*` 合成 fixture，超出指定隔离写根。未修改候选源码/规格/测试，已立即向作者报告，日志保留；此后命令显式使用 review-spec/tmp。不能把此偏差写成隔离限制完全遵守。

## §4 Host/Agent 职责及 SDK 复用专项

**本候选专项不通过。** 可确认正向范围：实际子会话仍由锁定 SDK 1.4.0 services/runtime、同一冻结 ModelRuntime 和 in-memory SessionManager 创建；父指针/原生保存保留在原管理入口；角色由 Agent 选择，single/parallel/chain 没有固化专业方法；原生搜索以 Provider hooks 和 SDK settle 续接，没有发现 Host 另建模型循环、经营计算、全局调度队列或替 Agent 判断来源内容。连续 pause 和工具共存已独立观察到实际 loopback 请求。公开 pi-subagents 比较文档明确区分示例 CLI 与整包前台 SDK，并记录内存凭据/受管工具桥等已识别差异；本复核未重新下载/安装整包。

但环境治理不能只声明：两个已复现缺口分别破坏“角色只收窄”和“子资源全收尾才释放父资格”，因此 SA02/SA03/SA05 及相应 IN03/IN05/IN07 不能标 PASS。没有另行批准例外。

## 未运行与结论限制

未运行完整 `npm run check`/build（作者并行执行，不能作为本复核独立结论）；未进行新真实模型、公开 URL 回读、供应商结算/账户资格验证、服务或 MacBook 操作、安装、Git mutation/CI/合并。WEB01/WEB02 的真实来源正确性、费用及产品入口公开检索结果不由本次离线复核证明；作者稍后的 product-live 证据不在固定候选中，本报告未采纳。普通/受管工具、上下文隔离、命名空间/冲突、文件边界、错误/取消、保存/重开、旧消费者等当前已运行证据只证明列出的合成条件；不是专业或用户产品验收。

作者修复后需固定新完整候选并重验两项反例与受影响生命周期/受管工具范围，原候选的不通过和全部失败证据保留。


---

## spec / -v2

原文件 `.local/task-agent-capabilities/review-spec/report-v2.md`，SHA256 `c80c60dc56eba8e01f39012fcaa637a42e5b4ef0cb5b54e7a0cfc5b3dbeca5bf`。以下全文保持原样。

# Independent Spec review: candidate v2

**结论：本次固定 v2 的已检查工程/接缝范围通过；v1 两个 P1 均已修复并独立重验，未发现新增可行动代码缺陷。** 原 `report.md` 的不通过及全部反例保留。本结论不代表完整真实问答、专业质量、用户产品验收、Git/CI 或运行采用完成。

## 固定候选与范围

- 分支 `codex/Host-Agent-Extension`；base `fa52ae2f2507309dcb204b3cef616397a19bf62d`。
- `candidate-v2.json` SHA-256：`69dcf8322a4b8d0b06ca1d51ae1ed111489f72ed2f13a50c45e2c9e93dd447a1`；574 个文件在复核前后全部匹配。运行 cwd 为 `review-spec/candidate-v2`；只读复用依赖。
- 沿用最初先于实现导出的 `expectations.md` 与 v1 全候选复核，本次逐项检查 9 个变化文件：project-session、project-runtime、protected-tools、公共 agent-sessions、native-search、边界脚本、两个专项测试和新增 product-live 文档。MCP search 仍指 v1 内容，故明确固定文件 diff 为本次实际依据。
- 所有 v2 旧消费者临时根使用新增授权的 `/Users/bendandebaba/OptraCall-artifacts/task-agent-capabilities-20261104/review-spec-tmp`，不使用仓库祖先/子目录 TMPDIR，避免原 requirements 夹具误发现仓库 AGENTS。报告与独立 probe 均留在 review-spec；未改源码、规格、测试或作者证据。

## v1 两项 P1 的重验

### P1-1：managed codemode 越过工具上限——已关闭

`project-session.ts:267` 改用原 `protectedTools.narrow`；`protected-tools.ts` 冻结仅由可信调用方传入的工具上限，并通过同一个 scope/executor 给 codemode 的间接调用下传该上限。父工具默认能力未被全局改窄，namespace 仍由 Host 产生。

独立原反例：角色 `tools:[read,codemode,tool_search]` 的真实 child wire 仍只声明这三个工具；unmanaged 与 managed 的 `tools.write` 均被拒绝，目标文件不存在。候选永久测试还验证许可内的 codemode read 保持可用，以及原共享 scope 的 native/凭据/越界保护、并行 ID 和父停止收尾。

证据：`capability-probes-v2.test.ts`、`independent-probes-v2-retest.log`、`target-tests-v2.log`。未放宽断言来制造通过。

### P1-2：清理失败释放公共占用——已关闭

worker 后续 execute 遇失败子 retirement 拒绝，drain 等同一个失败 Promise 而不重试；unmanaged 公共 finish 调用既有可选 drain，错误留在原 Operation.cleanupFailed/busy；driver 对明确子清理未知保留活句柄，关闭失败 task 仅供显式清理重试。

独立真实 SDK/public domain 故障注入观察：首次 completion 暴露清理拒绝；busy=true、mode=unknown；dispose 恰好 1 次；第二 turn 被拒绝，实际 loopback 请求仍为 3 次；close(false) 不重试；permit 后 close(true) 才重试一次并成功，随后新显式 turn 正常完成。永久测试亦验证正常子 Provider 失败只是失败回执，健康 owner 不被错误隔离。

证据：`independent-probes-v2.test.ts`、`independent-probes-v2-retest.log`、`target-tests-v2.log`。原“永远失败 dispose”探针首轮在 teardown 保留活句柄，故仅终止自己该合成 fixture 子进程后改为 permit-gated 显式清理；初轮日志 `independent-probes-v2.log` 保留，不计本次最终测试成绩，也不记产品失败。

## 独立运行

所有下列命令 cwd 为固定 v2，TMPDIR 为上列明确获准外部根。

| 命令/范围 | 结果 | 日志 |
| --- | --- | --- |
| `node --test tests/subagent.test.ts tests/subagent-runtime.test.ts tests/native-search-runtime.test.ts tests/protected-tools.test.ts tests/protected-tool-supervisor.test.ts tests/protected-tool-process.test.ts` | 59 PASS / 0 FAIL / 0 SKIP | target-tests-v2.log |
| `node --test tests/agent-sessions.test.ts tests/agent-session-execution.test.ts tests/session-compatibility.test.ts tests/protected-session.test.ts tests/project-runtime.test.ts tests/requirement-session.test.ts tests/requirement-runtime.test.ts tests/verification-host-lifecycle.test.ts` | 105 PASS / 0 FAIL / 0 SKIP | consumer-tests-v2.log |
| `node --test tests/agent-session-boundary.test.ts` | 9 PASS / 0 FAIL / 0 SKIP，受控绕过仍失败 | boundary-tests-v2.log |
| `node --test ../independent-probes-v2.test.ts ../capability-probes-v2.test.ts ../native-probes-v2.test.ts` | 5 PASS / 0 FAIL / 0 SKIP，原两反例、控制及连续 pause/Anthropic 工具共存重开 | independent-probes-v2-retest.log |
| `node scripts/check-agent-session-boundary.mjs` | PASS | boundary-v2.log |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 | typecheck-v2.log |

合计 **178 PASS / 0 FAIL / 0 SKIP**。额外全新只读辅助复核检查 v1→v2 公共 finish、取消/配置关闭、driver close 的实际调用与并发交错，未发现正常错误误隔离、自动重试或提前释放的可复现新增路径；该辅助没有写候选或另跑测试，其静态意见不代替上表实际证据。

## 原生联网与真实记录的准确范围

本次 v2 合成测试包含不闭合 native input、深嵌套 hook 异常、UTF-8 字节限额三项永久回归；观察均 fail closed，不保存虚假完整回执、不中断后重放、不把错误报成 completed。旧正常 search/函数工具、角色搜索收窄、取消、保存/重开、下一显式消息和独立连续两次 pause 仍通过；pause wire 没有增加业务用户消息。

只读核对新增 `product-live-validation.md`、原 identity、两个 result 和 URL readback：MiniMax 2 次 HTTP、66 来源、90 秒截止 cancelled，无最终答案；MiMo 1 次 HTTP、3 来源、completed 但明确缺官方页和版本/许可证据；69 个 URL 读回为 51×200、17×403、1×404。未重发任何请求，也未把独立读回的版本/许可回填为模型回答。

该 live identity 中 **project-runtime、project-session、native-search 三个 SHA 与固定 v2 不同**，runtime/subagent 相同。因此它是修复前有限真实证据及本候选所附保留记录，**不是 v2 字节完全相同的真实 Provider 验证**。本次只核对已有回执自洽性；没有独立重做外网读取、实际密钥扫描、供应商账单或账号资格验证。费用仍 UNKNOWN。

## 工程 §4 职责边界与 SDK 复用

**对本次实际变更与已检查接缝：通过。** 实际代码仍用 SDK 1.4.0 services/runtime、同一冻结 ModelRuntime 与独立 in-memory SessionManager 管理模型/工具循环；附属会话不接管父 native 指针。角色、single/parallel/chain 与是否 search 由产品 Agent 选择；Host 只处理角色材料、能力上限、取消、资源和保存。新增 narrow 是同一执行 scope 上的能力约束，公共 drain 是同一 Resource/Operation 的健康收尾检查，没有新增平行 Runtime、业务 busy 台账、全局队列、分析方法步骤或经营补计算。

Pi 原生 search 的 SDK 缺口与 pi-subagents 包桥接差异已有研究记录；代码继续以 hooks/settle 做最小适配，独立连续 pause 实际请求可核。没有发现自建 Host 模型循环或错误重放。此专项只覆盖当前修改和受影响接缝，不扩成对所有既有实现的全面合规保证。

范围记录提醒已单独告知作者：v2 spec 的“允许修改”文字尚未显式列出新增 `src/host/agent-sessions.ts` 公共 finish 健康检查。本次重验任务已明确纳入该必要修复；最终规格/交付记录应同步该真实接缝，保持 Interface v3、owner/profile 与旧消费者合同描述一致。

## 未运行与最终边界

未另跑完整 `npm run check`/build（作者 v2 正在并行，不能当本复核独立成绩）、新真实模型、真实 subagent、多设备、UI、安装、服务切换、Git mutation/CI/合并或结算。SA02/SA03 的原阻断在固定 v2 下已关闭，当前工程 Spec/职责接缝可进入后续获准交付步骤；WEB01/WEB02 的完整问答、专业内容与用户产品验收仍未通过或未验证，必须保留 MiniMax 取消、MiMo 不足、403/404 与 UNKNOWN，不自动补跑。


---

## spec / -v3

原文件 `.local/task-agent-capabilities/review-spec/report-v3.md`，SHA256 `291edda0537c1846dd13a33667b8a7938ed7484d31c9fa6e29b3588a1a5030ec`。以下全文保持原样。

# Independent Spec review: final v3 increment

**结论：固定 v3 的本次增量通过，未发现新的可行动问题。** 本文为 v2 完整工程/接缝复核后的必要增量核对，不覆盖原 v1 不通过记录。结合 `report-v2.md`，原两个 P1 已关闭，职责/SDK 复用检查在当前变更范围保持通过。

## 身份与增量

- base `fa52ae2f2507309dcb204b3cef616397a19bf62d`，分支 `codex/Host-Agent-Extension`。
- `candidate-v3.json`：577 文件，SHA-256 `b71ff17eb07ee3d883f05e1be8455bdbc9ba4c3b9f255b6f44d25b5c667453eb`；隔离副本 `review-spec/candidate-v3` 的全部文件复核前后匹配。
- 对 v2 的唯一产品源码变更：`src/agent/project-runtime.ts:130-139`，无 protectedExecution 的专属 business workspace 的 drain 保持 no-op。
- 唯一测试源码变更：`tests/automatic-verification-flow.test.ts:213-234`，先等待后台 Python 的实际 handoff-ready，再执行原有全部“未完成/禁止提前交接/busy/匹配关闭回执/原稿保全”断言。
- 文档增量为 spec 中准确列入原公共 finish/drain 健康检查路径，以及新增 result、Qoder 回执、修复后有限真实验证记录。全部只读核对；未改候选、作者日志或旧报告。

## 代码/规格判断

`!protectedExecution && workspace` 排除的资源本来就因专属 workspace 不取得 subagent/native search；因此保持其旧 transport 不承担新增 drain RPC，不会绕开普通项目任务附属子清理隔离。任何 protected/ordinary managed workspace 仍实际 drain，普通 projectDirectory 项目任务仍经过附属 SDK 健康核对。独立旧需求 controlled worker 与正常 SDK 保存/重建路径恢复，原子清理 UNKNOWN 的公共 owner 隔离及窄化工具保护继续通过。

AV06 的变更只把夹具观察起点移到真实后台就绪，而非把 SDK reply 当后台已启动或已收尾。原断言未删除或弱化：ready 后 done 仍须不存在、固定观察期间禁止下一作者请求、业务 busy=true；释放后还须匹配 SDK closed receipt、实际后台 done、原稿字节保全。该修正与 Python 后台启动竞态相符，原 v2 失败不能被抹去。

spec 已补 `src/host/agent-sessions.ts` 真实修改路径并维持 Interface v3、owner/profile 原合同，v2 的范围记录提醒已关闭。新增收尾记录没有把研究、有限真实调用、完整工程检查、Git/CI、运行采用或用户产品验收混写为同一通过。

## 独立运行

cwd 均为固定 v3，TMPDIR 均使用本次明确获准的外部根：`/Users/bendandebaba/OptraCall-artifacts/task-agent-capabilities-20261104/review-spec-tmp`。没有新真实 Provider/外网、凭据、设备、安装、服务或 Git 操作。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `node --test tests/requirement-lifecycle.test.ts` | 7 PASS / 0 FAIL / 0 SKIP | legacy-requirement-v3.log |
| `node --test --test-name-pattern='^AV06 ' tests/automatic-verification-flow.test.ts` | 3 PASS / 0 FAIL / 0 SKIP；含 compare/recheck 两个目标及 BOM 保全用例 | av06-v3.log |
| `node --test --test-name-pattern='narrowed role|ordinary public session owners|ordinary child model failure' tests/subagent-runtime.test.ts` | 4 PASS / 0 FAIL / 0 SKIP；两模式间接工具上限、清理失败隔离/显式重试、正常失败不隔离 | subagent-repair-guards-v3.log |
| `node --test tests/agent-session-boundary.test.ts` | 9 PASS / 0 FAIL / 0 SKIP | boundary-tests-v3.log |
| `node scripts/check-agent-session-boundary.mjs` | PASS | boundary-v3.log |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 | typecheck-v3.log |

本增量独立计 **23 PASS / 0 FAIL / 0 SKIP**。不把 v2 的 178 项计作 v3 全量重跑。另一次全新只读辅助核对新增四份文档及脱敏 evidence 的 identity/source-comparison/result/URL 状态/manifest，未发现文档问题；辅助未修改文件或发请求。

## 作者全量证据读回

只读核验 `full-check-v3-receipt.json` 与 `full-check-v3.log`：日志 SHA-256 为 `ad391c761905316f4b667ac4d7306bcb7917ad28a2da5ae7d0b786d7afe99471`，与收据一致；收据记 `npm run check` exit0、1001 tests / 998 pass / 0 fail / 3 skip。日志尾部有 TypeScript/Vite/stamp-build 正常完成及既有 chunk size warning。这是作者完整运行记录的身份核对，不冒充本复核独立全量运行，也不把 3 SKIP 写成通过。

result 明确保留 v1 非作者发现、v2 全量 2 FAIL、受控旧 worker 挂起及只终止本次确切测试 PID的事实，和 ready 竞态/祖先 AGENTS 夹具环境失配；没有把重跑绿追写成原失败从未发生。

## 真实联网和交付边界

修复后新 MiMo 问题记录保持 **60 秒 CANCELLED / 完整联网结果 NOT_PROVED**：1HTTP200、sources=0、专用 search usage 缺失，URL 读回 `NOT_RUN_NO_STRUCTURED_SOURCES`；未从半截正文链接凑来源或补跑。该次冻结的是 v2 五个源码，后续 v3 workspace 兼容修正没有被回填成同一真实候选。首次 MiniMax 90 秒取消无最终答案、MiMo 版本问题证据不足、原 403/404、供应商费用 UNKNOWN 继续保留。

未执行 Git提交/推送、PR/head CI、合并、运行服务采用、MacBook/Qoder工作树操作或用户产品验收。R2 完整真实问答仍不得标通过；本次绿色工程检查只证明列出的工程合同。最终 result/回执补充真实检查结果与授权状态可以文档读回，不应再改变本报告固定产品源码身份。


---

## standards / v1

原文件 `.local/task-agent-capabilities/review-standards/report.md`，SHA256 `dc1d60ae9d0047dfd675475686b09219dd6e5cd80e9b761173d23c5bec10e116`。以下全文保持原样。

# 独立 Standards / Correctness 复核 — candidate-v1

结论：**不通过，需作者修正后固定新候选重验**。复核者未参与候选创作，未修改候选源码、测试、规格或作者证据。

## 固定范围与验收依据

- 仓库 `/Users/bendandebaba/.codex/worktrees/31d3/OptraCall`，分支 `codex/Host-Agent-Extension`，base/HEAD `fa52ae2f2507309dcb204b3cef616397a19bf62d`。
- 复核对象为完整 staged/unstaged/untracked 候选；`../../candidate-v1.json` 的 573 文件在隔离 `candidate/` 内全部 SHA-256 匹配，见 `manifest-verification.json`。依赖只复用原 `node_modules` symlink。
- 已读 AGENTS、工程规范 v1.4 §2/IN01–IN07/§3/§4、统一会话说明、产品讨论稿 v0.2、本变更 spec 及 5 份研究/探针记录；代码发现先用 graph，再读取精确文件及锁定 SDK 1.4.0 实现。
- 独立预期：SA01–SA04 的同父权威、工具能力单调收窄、取消及全部子资源 join/dispose；WEB01/02 的原始回执可恢复绑定、来源不编造、取消/错误/部分响应不继续；IN03/IN07 的失败清理保持原 owner 占用与显式重试。

## 可行动发现

1. **[P1] 子 dispose 失败没有进入普通任务的公共隔离状态。** `src/agent/project-session.ts:406–419` 将 `retireChildren()` 错误转成普通 `outcome=failed` 后清除 `run` 并发布 idle。对于本次同样开放的 unmanaged 任务，公共 `src/host/agent-sessions.ts:281–297` 不 retire 资源，因而看不到仍在 `failedChildRetirements` 的句柄。独立故障注入只令一个真实 SDK 内存子会话的首次 dispose 抛错，经生产 `createAgentSessionDomain → ProjectAgent` 后得到 `failed`，却 `domain.busy(ref)=false`、`live=true`、`status=idle`。违反 SA03 与 IN03/IN07，允许 owner 在清理未核定时再派发。应让附属清理失败进入同一公共 Resource/operation 的权威隔离，并由显式 close 重试；保留普通模型请求失败可继续的原语义。证据：`probe-child-retirement.test.ts`、`probe-child-retirement.log`（原完整日志另存 `.full.log`）。

2. **[P2] raw stream hook 抛错会丢失搜索证据且仍报完成。** `src/agent/native-search.ts:81–108` 没有捕获收集/克隆异常；`project-session.ts:210` 的 onError 仅将 command 错误记失败。SDK `extensions/runner.js:813–839` 吞掉 hook 异常后继续请求。实际 loopback MiMo 回传深嵌套合法 JSON citation，`collectSources` 抛 `RangeError`，出现 extension_error，但最终 `completed` 且无 receipt。子会话也未绑定 onError。应在该可信适配内捕获异常、置失败、调用 onFailure 并 abort，保证后续 message_end/settle 不能覆盖失败。证据：`probe-native.log` 的 `REVIEW_DEEP`。

3. **[P2] 未闭合 native block 被当成完整 raw receipt 保存。** `src/agent/native-search.ts:99–118` 仅在 `content_block_stop` 到达时解析 partial JSON，message_end 不核对未关闭块/未消费 partialInputs。实际 SDK 接收未闭合 `input_json_delta`、缺 block_stop、随后 message_stop，仍 `completed`，并把原未完成参数丢成 `server_tool_use.input={}` 保存；下一请求可恢复此伪完整块。应跟踪块闭合和 partial 输入，缺失/错误时拒绝保存及 pause 继续。证据：`probe-native.log` 的 `REVIEW_PARTIAL`。

4. **[P2] 8 MiB 上限按 UTF-16 字符数计数。** `src/agent/native-search.ts:56,118` 使用 `JSON.stringify(receipt).length`。实际 SDK 回执 3,146,467 字符、9,437,955 UTF-8 bytes 仍 `completed` 并持久化，超过 `maxReceiptBytes`。捕获与恢复均应按 UTF-8 bytes 核定，并避免在流累积期间无界增长。证据：`probe-byte-limit.log`。

## 独立运行与结果

所有命令 cwd 均为 `review-standards/candidate`，输出仅写入 `review-standards`；无真实 Provider、外网、凭据、安装、设备/服务或 Git mutation。

- `node --test tests/subagent.test.ts tests/subagent-runtime.test.ts tests/native-search-runtime.test.ts`：**30/30 PASS，0 SKIP**，包括本机 darwin 受管工具与 scope 检查，见 `target-tests.log`。
- `node scripts/check-agent-session-boundary.mjs`：PASS，见 `boundary.log`。
- `inspectSessionSource` 独立合规 / native-search 非法 SDK constructor import / 恢复合规探针：PASS，见 `boundary-probes.log`；新增例外为精确文件/能力，没有目录白名单扩大。
- `npm run typecheck`：PASS，见 `typecheck.log`。
- `node --test ../probe-native.test.ts`（最初两条）：**0/2 PASS，2 个因果反例**，见 `probe-native.log`；断言应 failed，实际 completed。
- `node --test --test-name-pattern='8 MiB' ../probe-native.test.ts`：**0/1 PASS**，见 `probe-byte-limit.log`。
- `node --test ../probe-child-retirement.test.ts`：**0/1 PASS**，见 `probe-child-retirement.log`；断言 busy 应 true，实际 false。

## 职责边界及复用专项

候选未建立 Host 模型循环：single/parallel/chain 由 Agent 选择，SDK 运行每个隔离会话；子调用共用冻结 ModelRuntime/model/thinking、受管工具和原 scope，不复制父会话、不加载用户执行扩展、不递归委派。模型/端点显式覆盖解决 builtin 默认地址优先级，真实 SDK loopback 覆盖生效。角色发现、工具窄化、脱敏、原生块保存/重开及正常 pause 继续的正常路径可验证。

已检查 `pi-subagents@0.84.0` 研究所指出的公开接缝：运行时 key、product resourceRoot、customTools 实例和准确收尾并非仅安装整包可继承；当前约束下直接复用 SDK 的最小前台薄层有成立依据，没有据此发现重复 Runtime。但专项整体仍 **不通过**：上述清理权威与 raw 回执失败路径尚未满足环境治理合同，不能凭正常路径全绿宣称完成。

未跑完整 `npm run check`（作者/主复核正在另跑，不能替代本报告独立验证）、浏览器/公开产品 live、实际配置变更关闭/创建期取消故障注入、真实网页逐 URL 核验、供应商结算、Git/CI、安装、MacBook 或运行采用。真实模型与产品验收结论不在本报告范围。


---

## standards / -v2

原文件 `.local/task-agent-capabilities/review-standards/report-v2.md`，SHA256 `f16cbe65b986e5ed7c6ae991e6594702a646540dc9fc67e78e1fc8ff35d4acdd`。以下全文保持原样。

# 独立 Standards / Correctness 复核 — candidate-v2

结论：**本次固定 v2 候选在所列复核范围内通过，无未解决的可行动发现。** v1 的“不通过”和四条反例完整保留在 `report.md` 及原日志；本报告不改写旧结论，不替代整包 CI、真实模型内容质量、产品验收或运行采用。

## 候选与方法

- 原仓 `/Users/bendandebaba/.codex/worktrees/31d3/OptraCall`，分支 `codex/Host-Agent-Extension`，base `fa52ae2f2507309dcb204b3cef616397a19bf62d`。
- 只读复核副本 `review-standards/candidate-v2`，manifest 为 `.local/task-agent-capabilities/candidate-v2.json`，**574/574 文件开始及结束均 SHA-256 匹配**。见 `manifest-v2-verification.json`、`manifest-v2-post-verification.json`。
- 继续按 AGENTS、工程规范 v1.4 §2/IN01–IN07/§3/§4、会话接入说明及本变更规格独立判断；读取 v1→v2 实际差异和受影响公共 Host/driver/executor 调用链。候选源码、永久测试、规格及作者证据均未改动。
- 所有复核输出在本 review 根及其副本内；本轮新增临时目录只使用明确获准的 `/Users/bendandebaba/OptraCall-artifacts/task-agent-capabilities-20261104/review-standards-tmp`。没有真实模型、外网、凭据读取、安装、服务/设备操作或 Git 写入。

## 原四项复验

| v1 发现 | v2 实现核对与独立结果 |
| --- | --- |
| P1 子 dispose 失败后普通 owner 提前 idle | 公共 `agent-sessions.ts:285–299` 在 unmanaged finish 调用原可选 drain，失败保留原 operation.cleanupFailed；worker drain 核退休结果且不重试，execute 拒新派发；`project-runtime.ts:154–179` 留存响应中的失败 driver 供显式重试。原 SDK 故障注入经真实公共入口现 completion 拒绝、public busy=true、executionState=unknown。两次 close(false) 不重试；第一次显式 retry 仍失败时继续隔离，第二次显式 retry 成功后 busy=false/none；另一 owner 独立 lease 不受影响，重试没有模型请求。**通过。** |
| P2 stream hook 异常被 SDK 吞掉后仍 completed | `native-search.ts:88–125` 整段捕获、onFailure+abort；来源收集迭代且限制 depth/nodes，累计流量限制 16 MiB。相同深嵌套合法 Provider JSON 现 failed、无 receipt、无 SDK extension_error 漏出。**通过。** |
| P2 未闭合 raw input 被保存为完整回执 | openBlocks 与 partialInputs 关闭/消费核对，`native-search.ts:114–138` 对未闭合输入拒绝保存。原未闭合 JSON/缺 block_stop 反例现 failed、receipt=[]、仅一次 HTTP，不生成 pause 续接。**通过。** |
| P2 8 MiB 按字符计数 | 恢复和保存均使用 UTF-8 byteLength；原 9,437,955-byte 多字节回执现 failed、无 receipt。正常 raw 保存/重开/下一显式消息仍由实际 SDK 回归覆盖。**通过。** |

`adapted-probes-v2.log` 为 **4/4 PASS**。为透明保留，首次直接移植旧探针的 `original-probes-v2.log` 为 2/4：另两条在旧诊断/返回合同假设处失败，分别是修复后 receipt 缺失导致旧打印访问 undefined，以及公共 completion 从“返回 failed”变为正确拒绝。之后只调整独立探针的诊断与合同断言，并扩展公共清理负向检查；没有削弱“失败不得成功、不得提前释放 owner”的断言。

## 新 protectedTools 能力上限与公共接缝

`protected-tools.ts:373–416` 在真实 dispatch 核上限，并把冻结 ceiling 送给一次性 executor；不是仅删 wire 声明。`protected-tool-process.ts:26–44` 从该集合构造 SDK 工具并再次在 executeTool 查找；共享文件进程由可信单工具 wrapper/dispatch 控制，父 scope/drain/close 权威没有分裂。

独立 `probe-protected-ceiling-v2.test.ts` 通过实际 macOS 受管 executor 验证：

- 窄角色 `read+codemode` 与宽角色并发复用同一供应商 callId，结果隔离；宽角色可写，窄角色间接 write/bash/edit 全拒绝。
- 创建窄 port 后再修改原 allowed 数组不能扩权；非法工具名或空 namespace 拒绝。
- 窄角色 read 正常，读 Host 私密根被 OS 边界拒绝；原件字节保持。
- 子 ceiling 不收窄父工具：父 write 仍正常；全部资源完成 drain/close。

结果 **1/1 PASS**，见 `probe-protected-ceiling-v2.log`。公共 Host 的无关 owner、普通模型失败不隔离、busy/配置/取消/失败退休与显式重试另由所列 95 项受影响回归覆盖。

## 独立命令与结果

cwd 均为 `review-standards/candidate-v2`；test 命令统一设置上述获准 TMPDIR。

- `node --test ../probe-native-v2.test.ts ../probe-child-retirement-v2.test.ts`：4/4 PASS，见 `adapted-probes-v2.log`。
- `node --test ../probe-protected-ceiling-v2.test.ts`：1/1 PASS。
- `node --test tests/subagent.test.ts tests/subagent-runtime.test.ts tests/native-search-runtime.test.ts tests/agent-sessions.test.ts tests/agent-session-execution.test.ts tests/protected-tools.test.ts`：**95/95 PASS，0 FAIL，0 SKIP**，含本机 darwin 受管范围；见 `target-regression-v2.log`。
- `node scripts/check-agent-session-boundary.mjs`：PASS，见 `boundary-v2.log`。
- `npm run typecheck`：PASS，见 `typecheck-v2.log`。

## 职责边界及复用专项

**通过，限本变更与受影响接缝。** 实际代码仍由 SDK 运行模型/工具循环；single/parallel/chain 为 Agent 选择的前台委派形式，Host 只绑定模型、材料、权限、附属资源及真实清理回执。原 Interface v3、owner/profile、公共 operation/retirement 仍为唯一业务运行权威；新 drain 检查附属资源不构造新管理表或 Host 推理循环。受管 ceiling 下传真实 executor，未通过原生工具绕开 scope。SDK 原生 pause 的隐藏技术记录仍由原回执/顺序/正文绑定恢复，正常保存与续接回归通过。pi-subagents 公开构造接缝缺口及现有 SDK 直接薄适配理由延续 v1 核查结论。

## 真实记录与未跑范围

只读检查新增 `product-live-validation.md` 及其 `identity.json`。该实测 native-search SHA `25ea11e9...` 对应修复前 v1，其他相关 driver/session 源码亦为此前字节，**不是 v2 实际 live 复验**。它能补充原配置实际检索/来源保存的有限事实；MiniMax 90 秒取消、无最终答案，MiMo 明确证据不足，403/404、后段用量及结算 UNKNOWN 均保留，不能写成问答正确或产品验收通过。

本复核没有另跑完整 `npm run check`（主任务另行运行）、浏览器/UI、v2 真实模型、所有公开 URL 重读、供应商账单、Git/CI、安装、MacBook 或运行采用。父 raw snapshot.status 在清理失败时可能显示无在途 turn 的 idle，但本次验证的公共 owner 权威仍 busy/unknown，禁止重派发；不据此宣称存在仍在运行的模型 turn。


---

## standards / -v3

原文件 `.local/task-agent-capabilities/review-standards/report-v3.md`，SHA256 `668a228080a3c231c9d9e17fc5c4c5040ef4154c9a4f3ef2e5975fdea276044e`。以下全文保持原样。

# 独立 Standards / Correctness 最终增量复核 — candidate-v3

结论：**v3 增量在所列范围内通过，无新的可行动发现。** 与 `report-v2.md` 联合构成本次最终源码复核依据；v1 不通过、原四条发现及所有失败/中断现场继续保留。本报告不把作者全量检查、有限真实模型记录、Git/CI、运行采用和产品验收合并为同一结论。

## 身份与增量

- 仓库 `/Users/bendandebaba/.codex/worktrees/31d3/OptraCall`，长期分支 `codex/Host-Agent-Extension`，base `fa52ae2f2507309dcb204b3cef616397a19bf62d`。
- 固定 `candidate-v3.json` 的 **577 文件**在只读副本 `review-standards/candidate-v3` 复核前后全部 SHA-256 匹配，见 `manifest-v3-verification.json`、`manifest-v3-post-verification.json`。
- v2 后实际变更为 **1 个生产源码文件、1 个测试文件、4 个文档**：project-runtime.ts、automatic-verification-flow.test.ts、spec.md、result.md、qoder-receipt.md、product-live-v2-validation.md。其余字节等同已复核 v2。
- 复核与临时运行只写 review 根及获准外部 TMPDIR；没有真实模型、外网、凭据、安装、服务/设备或 Git 写入。

## 生产兼容修正

`src/agent/project-runtime.ts:130–139` 仅对 `!protectedExecution && workspace` 的旧 unmanaged 业务资源保持无 drain RPC 合同。它与 `project-session.ts` 排除专属业务 workspace 的委派准入一致；这些资源不可能持有本变更创建的附属 subagent。普通项目任务不命中该条件；受管业务资源仍须 drain，故没有绕过 v2 的子退休核定或受管后台收尾。

独立受控 driver 探针实际观察三种构造：unmanaged business 不发 drain；普通项目与 managed business 均发 drain，并准确回传受控故障，而非静默跳过。真实公共子 dispose 失败探针在 v3 另重跑，仍保持 busy/unknown、close(false) 不重试、连续显式失败保持隔离、成功清理后释放，另一 owner 可独立占用，模型请求没有重放。

## 后台测试修正

`tests/automatic-verification-flow.test.ts:213–218` 从直接读取 ready 改为等待 Python 的真实 ready 握手；只吸收 ENOENT 的“尚未写出”，其他文件错误仍抛出，并有现有 until 截止限制。后续原断言全部保留：done 仍不存在、下一作者尚未派发、公共 busy=true、release 后完整流程、matching execution closed 回执及原件字节。修正没有把 shell 已返回等同后台已开始，也没有用固定 sleep 代替真实准入。

独立 compare/recheck 两个实际受管后台场景均通过。v2 的 ENOENT 与旧 controlled worker 挂起/定向终止证据不能记为 PASS；本报告没有改写它们。

## 独立运行

cwd 为 `review-standards/candidate-v3`；测试设置 `TMPDIR=/Users/bendandebaba/OptraCall-artifacts/task-agent-capabilities-20261104/review-standards-tmp`。

- `node --test tests/requirement-lifecycle.test.ts tests/requirement-runtime.test.ts`：**11/11 PASS**，见 `legacy-workspace-v3.log`。包含旧 controlled worker、配置/关闭代际隔离和真实 SDK 业务 workspace。
- `node --test --test-name-pattern='AV06 (compare|recheck) background' tests/automatic-verification-flow.test.ts`：**2/2 PASS**，见 `background-handshake-v3.log`。
- `node --test ../probe-drain-admission-v3.test.ts`：**1/1 PASS**，见同名 log。
- `node --test ../probe-child-retirement-v3.test.ts`：**1/1 PASS**，见 `child-retirement-v3.log`。
- `node scripts/check-agent-session-boundary.mjs`、`npm run typecheck`：PASS，见 `boundary-v3.log`、`typecheck-v3.log`。

以上独立检查共 **15/15 PASS，0 SKIP**。v2 中未变字节的 raw stream/UTF8/openBlocks/真实 executor ceiling 等继续引用 `report-v2.md` 的反例及 95 项受影响回归，不伪称在 v3 又跑过全套。

## 完整检查证据读回

只读核验主任务 `full-check-v3.log` 的完整起止、边界检查、测试汇总及 tsc/Vite/build stamp 输出，SHA-256 为：

`ad391c761905316f4b667ac4d7306bcb7917ad28a2da5ae7d0b786d7afe99471`

该日志为 **1001 tests / 998 PASS / 0 FAIL / 3 SKIP**，后续构建完成；主任务记录实际 exit0。本复核没有再次运行整包，故这项是固定作者全量证据读回。既有较大 JS chunk 提示没有被改写成构建失败，也不因此声称做过性能验收。v1 的 994 项绿色和 v2 的 996 项/2FAIL 不替代它。

## 文档和真实记录

已逐份核读新增/修改的 spec、result、Qoder 回执及 product-live-v2：

- spec 明确补入公共 finish/drain 受影响接缝，保持 Interface v3 和原 owner/profile，未扩大业务或设备范围。
- result 诚实保留首次公网合成 key 夹具错误、v1 独立失败、v2 全量 2FAIL/中断/夹具污染与后续修正；最终状态字段目前等待主任务补实际结论，不允许拿旧候选结果替代。
- Qoder 回执区分 ordinary/protected/workspace、原生 server tool 与可 executeTool 的函数工具、实际 executor ceiling、无递归/后台及无服务采用；与源码一致。没有向 Qoder 发送消息或修改其工作树。
- 新 v2 live 为原 MiMo Flash 线路一次新公开问题，60 秒取消、1 HTTP200、结构化 sources=0、专用 usage 缺失、URL readback NOT_RUN_NO_STRUCTURED_SOURCES。它没有用部分回答链接补造来源；费用 UNKNOWN、完整联网 NOT_PROVED 保留。其源码身份早于本 v3 workspace 兼容修正，不能称为 v3 完整真实问答验收。原 MiniMax 90 秒取消和 MiMo 答案不足同样保留。

最终 result/独立汇总若只补本次实际结果和授权状态，应做最后文档一致性核读；任何源码再变更均需重新固定候选并重验受影响范围。

## 职责边界及复用结论

继续 **通过，限本次变更及受影响接缝**。v3 只恢复无委派资格资源的旧传输兼容，不新增模型循环、权限、业务步骤或平行生命周期；SDK 复用及 v2 的公共 owner/真实 executor 边界不受破坏。浏览器/UI、完整专业问答、用户产品验收、Git/实际 head CI、合并、安装、运行采用和 MacBook 均不在本复核完成声明中。

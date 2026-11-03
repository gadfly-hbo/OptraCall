# R1：任务内子 Agent 的生命周期与权限接缝核查

2026-11-03。研究基线为 `codex/Host-Agent-Extension`、提交 `fa52ae2f2507309dcb204b3cef616397a19bf62d`。本文依据当前源码、工程规范 v1.4 IN01–IN07、统一会话说明及产品讨论稿 v0.2，记录静态事实、实施建议和待固定合同；不是产品实现、真实模型验证或最终独立复核结论。代码发现优先使用已索引的 `optracall-host-agent-extension` 图及函数片段；测试图不足处只读取测试名称，没有执行测试。

## 已有权威和实际调用链

当前公共接口为 Interface v3，兼容 v1/v2 业务子集。项目任务 owner 仍为真实 `projectId/taskId`；Host 在 `server.ts` 静态注册 `project-tasks`，提供绑定配置、真实目录、能力和准入。Extension 不取得域注册、跨 owner 清理、凭据和执行资格构造对象。

调用链为：Host `projectSessions.start/withSession` → 公共 `reserve/startTurn/ensureOpen` → `ProjectAgent.open` → 子进程 `project-entry.mjs` → `runProjectSession.open` → SDK `createAgentSessionRuntime(createRuntime)` → `createAgentSessionServices/createAgentSessionFromServices`。公共层生产路径是 `new ProjectAgent` 的权威入口；原 SDK 会话和工具循环已可复用，无须新建推理循环。

| 接缝 | 基线事实及影响 | 源码证据 |
| --- | --- | --- |
| 任务 profile | 任务配置按 id/revision 绑定；自动功能受支持时选择 ordinary，否则保持 unmanaged；原任务支持 commands/UI/editor | [server.ts:110](../../../src/host/server.ts#L110) |
| 占用 | `reserve` 从 operation 开始即占用，同 owner 第二次申请拒绝；busy 包括 operation、opening、SDK busy、待答 UI 与失败 retirement | [agent-sessions.ts:130](../../../src/host/agent-sessions.ts#L130)、[reserve:224](../../../src/host/agent-sessions.ts#L224) |
| 配置 | 捕获冻结快照；打开和后续派发前核 id/revision/provider/model/api/baseUrl/key/thinking 等实际配置身份 | [agent-sessions.ts:89](../../../src/host/agent-sessions.ts#L89)、[assertOperation:131](../../../src/host/agent-sessions.ts#L131) |
| 公共资源 | 一个 slot 持 resource/opening/operation/latest；Resource 持单一 retirement/closeFailed；没有现成的自主子 Agent 字段 | [agent-sessions.ts:79](../../../src/host/agent-sessions.ts#L79) |
| 正常结束 | `finish` 对 managed 资源先 drain 后 retire；cleanup 失败保留原 operation 隔离，不能提前 idle | [agent-sessions.ts:259](../../../src/host/agent-sessions.ts#L259) |
| 父子取消钩子 | `onCancel` 绑定当前 operation；取消先撤后续派发资格，再等 handler；失败只允许显式 cleanup retry | [cancelOperation:103](../../../src/host/agent-sessions.ts#L103)、[withSession:311](../../../src/host/agent-sessions.ts#L311) |
| 事件与迟到写入 | 公共 forward 核 resource/context 当前性；Host 在原 mutate 门闩内再次核 context，再保存草稿/指针和发布 | [agent-sessions.ts:154](../../../src/host/agent-sessions.ts#L154)、[server.ts:136](../../../src/host/server.ts#L136) |
| 按范围关闭 | provider/project 按捕获配置和真实 owner 匹配；先撤有效性，后等待匹配 resource 与取消动作，不等待无关资源 | [closeMatching:344](../../../src/host/agent-sessions.ts#L344)、[server.ts:201](../../../src/host/server.ts#L201) |

特别注意：`lease.onCancel` 不是正常结束的 join 机制。正常 `finish` 不调用这些 handler，成功后会清空集合。只注册取消 handler、然后让子 Agent 后台继续，不能保证父 busy、正常 drain 或关闭覆盖它。也不能用同一任务 Ref 的第二次 `start` 伪装子资源，因为同 owner 正在占用。

## SDK driver、日志和原生历史

`ProjectAgent` 是 Host 的 worker 传输适配器，不是 Agent 自主委派 API。它的 `#running`、IPC 和 stop/close 目前围绕一个 driver；不可把业务工具直接 `new ProjectAgent` 或 spawn 另一个 Pi CLI 当作已经受管。

`project-session.ts` 的 `createRuntime` 已集中处理冻结模型、工具和资源加载。`bindSession` 则会替换父 `session/manager/browserUI`、订阅与父原生指针，子会话不能复用它来登记。父 native 的 fork/tree/reload 本来就会更新所选会话；这与并行、隔离的子上下文不是同一语义。

当前脱敏在可信 driver 的 `publish/redact` 及 SDK `message_end` hook 执行，覆盖当前配置密钥及若干 JSON 转义形态；HTTP 观察只保存安全诊断。`ProjectAgent` 不把 stdout/stderr 当产品日志转发。该合同不等于任意秘密自动检测，也不构成业务资料不外传的证明。

子 Agent 若使用同一冻结配置，可以复用同一密钥遮罩；子结果、流式增量、错误、进度和工具回执均须经原脱敏出口。不得复制原始 Provider 异常、输出启动诊断或把子消息直接拼到 SSE。子事件需要可区分的父工具调用/子序号，并继续归属原任务与实际请求；不能把子 snapshot 当父 snapshot，覆盖父草稿、sessionFile 或 completed。

证据：[ProjectAgent:27](../../../src/agent/project-runtime.ts#L27)、[redactText:76](../../../src/agent/project-session.ts#L76)、[environmentExtension:112](../../../src/agent/project-session.ts#L112)、[bindSession:171](../../../src/agent/project-session.ts#L171)、[createRuntime:232](../../../src/agent/project-session.ts#L232)、[execute:300](../../../src/agent/project-session.ts#L300)。

## managed / protected 的准确范围

当前模式为 unmanaged / ordinary / protected。只有新建且有可信起点、没有未托管历史的任务，才可在显式自动设置下从首次执行进入 ordinary。GET、恢复、重启或 JSONL 标记不能授予新的托管资格；不能因为新增子 Agent 工具就把旧任务升级。

ordinary 的工具 cwd 仍是项目 `020_clean`，写入范围是本 scope 新工作区及项目 `020_clean/060_reports`，读取范围包括核准项目材料和共享资料。`010_draw` 仍按既有软提示不用于分析，不能称作新的敏感资料隔离。protected 的同链核算/返修只写自己的新工作区。两者禁 native/凭据、脱组与间接逃逸；技能经过快照，既有/远程 MCP 和未经安全委派的执行扩展不进入该 driver。未开启自动的普通任务维持原 full-tools/软约束合同。

受管执行器只执行工具，没有模型。可信 guardian 保存身份直到完整闭合才 ACK；正常 drain 等待后台计算自然结束，显式 stop 才强收。关闭 driver 不等于工具后代已收净。SDK 的 opened/closed 记录只能在实际 scope 闭合后写入；子模型或文本不能制造这些回执。

共享父 `protectedTools` 作为子工具 port 是本轮最小方向：子 SDK 仍在可信模型层，所有代码、文件、bash、codemode 和间接工具仍走原执行器。不要在受限 Python/Node 工具进程里另起持凭据模型进程；不要给子会话直接原生 bash、MCP 或 loader 来绕过边界。子 session dispose 只释放自己的模型/SDK资源，不能单独关闭共享执行器，误伤兄弟或父 Agent；最终 scope drain/close 仍由父 Resource 统一持有。

共享执行器的一个现有约束是 `reserved` 按 toolCallId 在整个 scope 去重。跨子模型不能假定供应商 callId 永不相同。需要由可信适配层给执行器内部调用 ID 加父工具调用与子序号命名空间，保留模型原工具名、参数及产品回执中的原始身份；不让 Agent 自造 namespace。

证据：[ordinaryExecution:84](../../../src/host/automatic-verification-host.ts#L84)、[capabilities:73](../../../src/host/automatic-verification-host.ts#L73)、[scope校验:29](../../../src/agent/protected-tools.ts#L29)、[createProtectedTools:199](../../../src/agent/protected-tools.ts#L199)、[dispatch去重:373](../../../src/agent/protected-tools.ts#L373)、[drain/close:414](../../../src/agent/protected-tools.ts#L414)、[managed journal:46](../../../src/agent/project-session.ts#L46)。

## R1 最小接入建议

与本轮拟定实现对齐：在现有可信 `createRuntime` 工厂注册任务内 `subagent` 工具，复用 SDK services、内存 SessionManager 和隔离子会话；single/parallel/chain 都由当前工具调用等待全部子资源。没有后台返回或跨请求继续运行；子会话没有递归 subagent 能力，不新建域、全局调度平台或第二份 busy/代际权威。

1. 仅普通项目任务可取得该能力；fixed-draft/text-only、专属业务 workspace、protected 核算/返修不注册。managed ordinary 保留原受限工具 port，unmanaged 普通任务保留其原策略，不用同名工具暗改模式。
2. 子模型沿用父 operation 的冻结 ModelRuntime/model/thinking；不允许角色文件、工具参数或模型文本指定 Provider、密钥、baseUrl、cwd、sessionFile。角色只能窄化工具；实际加载到的 skill.baseDir/agents 提供发现根，不能扫描全局任意位置或从普通消息接受可执行路径。
3. 子会话使用独立内存历史；不加载父会话树、祖先上下文、项目上下文文件或任意执行扩展。角色说明、实际派发材料和工具白名单显式交付，不把未传入的父上下文称作已继承。
4. 创建过程先保留父工具调用资格。异步加载前后、子资源创建后、prompt 前均检查取消；取消后创建出来的资源只做 dispose，不派发。父终态之前，工具 execute 的 finally 必须等待每个已启动分支 settle、waitForIdle 和 dispose。
5. parallel 不能以 `Promise.all` 首个 reject 提前退出；先撤销后续 chain 派发资格，再对已启动分支收尾，完整保留部分成功、取消、错误和 UNKNOWN。等待兄弟结束不意味着 Host 决定其分析步骤。
6. 父 stop 先撤销子创建/后续派发资格，对父和全部子发出 abort；随即关闭 owned tool scope，再等子 join/idle/dispose。不要先等待可能仍阻塞在执行器工具上的子 join，再启动 scope close。仍须等实际收尾后才响应关闭；对子清理失败不能吞错并返回父 completed。
7. 在现有 SessionRuntime 内保存真实子 SDK 句柄集合可以表示附属资源；它不得自行发布第二份 busy/generation，也不能超出父 Resource 存续期。正常工具结束、父取消、配置清理和退出都使用同一收尾结果，不自动重试失败清理或重放模型。
8. 子创建/执行失败必须映射到原请求的安全回执。若清理结果未知，应使父运行失败/UNKNOWN，并让原 Resource retirement 保持隔离，后续只能显式 cleanup retry；不能靠子最终文本补造技术成功。

此方向仍需实现及确定性验证，不能仅凭 SDK 同包或 SessionManager.inMemory 认定已满足上述合同。若实际实现需要把附属子资源加入公共接口，按 IN06 同步接口、旧消费者与第三合成消费者；不在业务模块建立 owner/run queue 来绕过公共层。

## 需要固定的合同与检查

以下项目进入主规格确认或实施验收，不由本研究擅自决定持久结构：

- **存续与历史：**本轮建议所有子资源只活在一次父工具调用，子 native 为内存历史；完整子过程保存、跨请求续接或后台任务若另行要求，涉及新的生命周期/持久合同，另做决定。
- **角色及工具：**角色来源、允许字段、模型/路径 override 拒绝、是否一层委派、工具白名单和不可用模式必须可观察。defaultTools 的加载顺序必须验证实际作用，不能只检查声明。
- **输出及错误：**每个分支需有实际状态、完整允许范围内结果及安全错误；部分成功不能被整体 completed 掩盖。结果传输上限和截断显示要明确；不凭子工具“返回了”宣称专业正确或正式核算完成。
- **取消/关闭：**覆盖准备期、加载期、prompt 前、并行一支失败、chain 间隙、工具后台计算、正常 join、配置清理、driver 异常和失败 cleanup 的显式重试。迟到子结果不得复活下一步或改父 sessionFile。
- **范围隔离：**同 provider/项目关闭等到本任务所有附属资源，另一任务或另一 provider 不被停止；归档看公共 busy。旧任务、重启任务及 closed journal 不能升级 fresh 资格。
- **保护回归：**managed ordinary 子工具实际拒绝 native/凭据/禁止写入与逃逸；重复供应商 callId 跨子隔离；子 dispose 不关闭兄弟工具；scope全部闭合后才 journal closed。fixed-draft/text-only/protected 不出现 subagent；未启用自动任务的既有行为保持。
- **兼容：**复测当前项目任务、需求、独立核算、封闭文本和 PPT 等受影响消费者及第三合成 profile；静态 boundary 仍须识别不合规新构造路径，不扩大目录级豁免。

可复用的原测试入口包括 `tests/agent-sessions.test.ts` 中 lease 配置/间隙占用、旧 provider 迟到隔离、配置身份、关闭失败保持 busy 及显式重试。它们仅是原覆盖线索，本次未执行；子 Agent 专项断言仍须从上述可观察合同导出。

本研究未访问凭据、未调用真实模型、未启动/切换服务、未操作 MacBook，未执行 Git 变更；仅新增本文。原自动核算、专业 FAIL/UNKNOWN、冷读材料合同及用户验收状态均不能被任务内自由委派的存在替代。

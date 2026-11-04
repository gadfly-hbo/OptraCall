# Pi subagent 接入核查

日期：2026-11-03。范围：只读核查当前产品与 SDK；本文是设计输入，不代表能力已启用、工程验收或产品验收。

补充边界：用户随后提供 `https://pi.dev/packages/pi-subagents`。下文关于 SDK 示例的核查仍有效，但“最小复用落点建议”须与该独立包当前实现一并比较，不能据本文直接认定需要自行实现调度 adapter。独立包核查由并行研究记录承接。

## 已核实事实

- 当前候选为 `fa52ae2f2507309dcb204b3cef616397a19bf62d`，`package.json` 锁定 `@earendil-works/pi-coding-agent@1.4.0`。本工作树未安装依赖；本次只读核验 `/Users/bendandebaba/DevWorkSpace/OptraCall/node_modules/@earendil-works/pi-coding-agent/package.json`，该已安装副本也是 `1.4.0`，未修改该副本。
- 官方包确实包含 `examples/extensions/subagent/`。这是要自行加载的示例扩展，`package.json` 的公开 export 只有主入口和 `./rpc-entry`，主入口没有导出一个现成的 `subagent` 管理 API。示例通过 `pi.registerTool({ name: 'subagent', ... })` 提供 single、parallel、chain；单个子任务由独立 Pi CLI 进程执行。来源：[1.4.0 官方 npm 包](https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.4.0.tgz)，其中 `examples/extensions/subagent/README.md`、`index.ts:270–348,469–487`、`package.json:exports`。
- 产品当前没有注册该工具。普通任务注册 codemode、tool_search、MCP 及可信 environment extension；受管 ordinary/protected 禁止用户执行扩展及已有/远程 MCP，加载的工具由 `protectedTools` 提供；fixed-draft/text-only 关闭全部工具和执行资源。来源：[产品创建路径](../../../src/agent/project-session.ts) `open:199–272`、`createRuntime:232–264`。
- 项目任务域为 `project-tasks`，owner 仍是实际 `projectId + taskId`，Interface 为 v3。统一生命周期是 Host 管理的 Resource/operation；业务 port 不能注册新域或接触跨 owner 管理。来源：[Host 接线](../../../src/host/server.ts) `111–130`、[公共接口](../../../src/host/agent-sessions.ts) `5,30–38`、[会话接入说明](../../../docs/agent-session-integration.md)。

## 为什么不能直接把示例加入 extensionFactories

1. **CLI 入口不适合嵌入式 Host。** `getPiInvocation` 首选 `process.execPath + process.argv[1]`；产品当前启动脚本是 `scripts/project-entry.mjs`，不是 Pi CLI。直接加载示例会再次启动产品入口并附 CLI 参数，不是已证明可工作的子 Pi 会话。来源：SDK `examples/extensions/subagent/index.ts:247–260,342–348`，产品 [ProjectAgent](../../../src/agent/project-runtime.ts) `#open`。
2. **模型名继承不等于配置/凭据继承。** 示例只传 `--model <parentProvider>/<parentModel>` 和 `--thinking`，子进程继承环境；没有传递产品内存里的 `ModelRuntime.registerProvider`、`setRuntimeApiKey` 注册。产品模型使用 `optracall-<configurationId>-<revision>` 临时 provider，并明确不从 `models.json` 读取模型定义。子 CLI 不会自然获得该运行时注册。来源：SDK 示例 `index.ts:298–305,343–348,481–486`，产品 [模型建立处](../../../src/agent/project-session.ts) `223–231`。不应为适配示例把凭据写入角色文件、提示词、命令参数或新的全局配置。
3. **示例取消不构成产品资源收尾证明。** abort handler 给当前 `proc` 发 SIGTERM，5 秒后仅在 `!proc.killed` 时 SIGKILL；这不是对整个后代组的身份保持与核定，也没有公共 Resource 的失败隔离、显式重试或跨 owner 关闭语义。示例可以用于 CLI 演示，不能直接拿来证明 IN03/受管执行合规。来源：SDK 示例 `index.ts:399–422`；产品 [停止及销毁](../../../src/agent/project-session.ts) `364–382`、[运行时关闭](../../../src/agent/project-runtime.ts) `#dispose`。
4. **工具与发现也未继承产品授权。** 示例 `tools` 是 agent frontmatter 或 CLI 默认工具；`cwd` 可由模型传入。发现只扫描 `getAgentDir()/agents/*.md` 和距 cwd 最近的 `.pi/agents/*.md`，不扫描 `Skill.baseDir/agents`，也不知道产品每任务的连接器准入、020/060 约定和保护 scope。来源：SDK `agents.ts:62–105,116–146`、`index.ts:298–305,440–466`。

## 最小复用落点建议

以下是待实施/验证建议，不能作为 Qoder 可立即使用的最终契约。

- 在产品可信 SDK 薄层静态注册 `subagent` custom tool。保留模型可自主选择的 single/parallel/chain 形态，不把 7 角色或 5 阶段固化在 Host；角色选择、任务拆分与研究流程由 skill/Agent 决定。
- 复用主 SDK 已公开的 `createAgentSessionServices`、`createAgentSessionFromServices`、`SessionManager.inMemory()`，为每个委派创建独立上下文的 SDK AgentSession。它们在 SDK `dist/index.d.ts:15,20` 导出；准确参数见 `dist/core/agent-session-services.d.ts:26–104`、`dist/core/sdk.d.ts:10–65`。这样不需要直接调用 pi-agent-core、重建推理循环、启动不可配置的 CLI 或另写 Provider relay。
- 子会话是父 Resource 拥有的附属资源，不能成为 Extension 自管的平行域或全局队列。子创建、运行、取消、idle、dispose 都由同一个可信 adapter 维护；父 turn 在等待工具时仍占用原 operation。正常结束、父停止、配置关闭、native 切换与销毁均须覆盖子资源；清理未确认不得先 idle。只注册 `lease.onCancel` 不足以覆盖正常结束路径。
- 子会话使用父操作冻结的 `ModelRuntime`、实际 model 和 thinking level；不接受任意 provider/model/cwd/sessionFile 参数。不静默切换模型。角色 `tools` 只能取父已获准工具集合的子集；联网工具只有父任务已获准且实际可用时才可传给子会话。可避免给子会话注册 `subagent` 自身，以免在尚未核定嵌套生命周期时开放递归。
- 普通未受管任务沿父原工具政策；ordinary/protected 子会话如获支持，所有 Agent 可控文件、bash、codemode 和网络工具均须走父已绑定执行 scope/port。隔离上下文不等于权限隔离。不能让新 SDK session 使用默认原生文件/bash工具绕过现有 `protectedTools`。在这条接线及收尾证据完成前，受管任务明确不注册 subagent；不回退为普通会话。
- fixed-draft/text-only 保持工具全禁，不提供 subagent。复用公共生命周期并保持业务 owner/profile 不变时，是否需要 Interface 版本升级取决于实际新增公共能力；仅新增可信 SDK 内部附属资源不必虚构新的业务 owner。实施规格须明确实际选择及 IN01–IN07 验收。
- 子日志只通过可信脱敏事件/工具结果进入父会话，不能把 stderr 当日志通道。若采用 in-memory 子会话，须明确“子完整原生历史不独立持久化”，由父的工具调用、脱敏结果与必要输出文件提供可追溯性；不要暗示已有独立子会话恢复能力。

## Skill 角色发现契约建议

- 以 **本次实际 SDK loader 已接受的 Skill** 为根，读取 `<Skill.baseDir>/agents/*.md`，例如 `extensions/analysis-assets/deep-research/agents/researcher.md`；不要另扫任意路径或要求复制到用户全局目录。
- 推荐工具可见角色名为 `deep-research/researcher`、`deep-research/reviewer`，用 skill 命名空间避免不同包的同名角色互相覆盖。
- Markdown frontmatter 推荐兼容示例的 `name`、`description`、`tools`（逗号字符串或字符串数组），正文为角色提示词；`model` 不作为角色可改变父配置的入口。来源：SDK 示例 `agents.ts:34–59,88–102`。缺失、重复、非法名称、根外 symlink/硬链接、读取中变化应报告为不可用，不静默改读其他来源。
- ordinary/protected 的 skill 已通过 `snapshotProtectedSkills` 复制整个安全资源树，`agents/` 可跟随相同材料快照；发现应使用该次 loader 返回的快照 `baseDir`，不能重新读取原仓目录。现有快照检查拒绝 symlink、非普通文件、多链接及凭据/配置文件，限制 10,000 entries、32 MiB，并保留相对目录。来源：[快照实现](../../../src/agent/protected-skills.ts) `7–49`。
- single 建议形态：`subagent({ agent: 'deep-research/researcher', task: '核对合成资料并返回来源' })`；parallel：`subagent({ tasks: [{ agent: 'deep-research/researcher', task: '…' }, { agent: 'deep-research/reviewer', task: '…' }] })`；chain：`subagent({ chain: [{ agent: 'deep-research/researcher', task: '…' }, { agent: 'deep-research/reviewer', task: '复核 {previous}' }] })`。最终可用参数以实施回执为准。

## SDK 1.5.0 评估

- 官方 npm 元数据核验 `1.5.0` 可获取，依赖其同版本内部 SDK，并把 undici/minimatch 等升级；元数据：[1.5.0 npm](https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/1.5.0)，包：[固定 tarball](https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.5.0.tgz)。该包的 `CHANGELOG.md` 标记 2026-11-02。
- 1.5.0 的 subagent `index.ts` 和 `agents.ts` 分别与本机 1.4.0 逐字 diff，二者均 exit 0。1.4.0 两文件 SHA-256 分别为 `1d11858d163e2a3a258af51c1923fc55ad825813acd6224462fd25ad61f5401b`、`cc85ecd33b89aa575bea3d2a9a9da7654a6305da4de02e5041aa5342a1de29b4`。因此没有证据支持“升级到 1.5.0 就解决上述 subagent 接线问题”。
- 1.4.0 自身 changelog 已有 codemode 在多会话/进程内 subagents 同时忙时等待空闲 worker 的修复；该条不是 1.5.0 新增。
- 1.5.0 有工具参数验证改用 pi-schema 的 breaking change，涉及 TypeBox 特性/错误形态及 JSON Schema coercion，可能影响现有工具和边界测试。本次如仅增加受控子会话，优先保留现有锁定版本；升级应单独给出能力缺口及完整回归证据。

## 必须补齐的验证

合成 Provider 应看到父 Agent 实际调用 subagent，而不是测试直接调用辅助函数。至少验证两角色隔离上下文、准确继承冻结 Provider/模型/thinking、父准入工具子集、子文件与 bash 实际执行、失败如实返回、chain 失败不继续、parallel 取消不再启动排队项、父 stop/config close/native replacement 等待子资源结束、清理失败/迟到结果保留 UNKNOWN。ordinary/protected 需增加实际工具原件保护及无权限扩张测试；fixed/text-only 断言工具不存在且间接调用不能恢复。最终须完成受影响完整检查和独立非作者复核。

本次未调用真实 Provider、未读取凭据、未安装或升级 SDK、未改变运行服务，未执行上述产品端到端验证。

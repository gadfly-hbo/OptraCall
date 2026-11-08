# pi-subagents 0.84.0：前台 SDK 接入研究

2026-11-03（Asia/Shanghai）。只读源码研究；未安装或执行该包，未调用真实 Provider。保留原 `provider-research.md`。

## 固定材料

- 用户指定入口 [Pi 包目录](https://pi.dev/packages/pi-subagents) 当前列出 npm `pi-subagents@0.84.0`，MIT，2026-10-29 发布。
- 官方 npm tarball：`https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.84.0.tgz`。`npm view pi-subagents@0.84.0 dist.integrity` 与本地 SHA-512 base64 完全一致：`sha512-IagE1hcBxLi82jTxTmcy/pIWckBuqhMH1GfAOe6/aIMVfnopMybCbcTMUS5K0CNy4tqSwHGleaXabaDmJS1QOg==`。
- 解压根：`.local/task-agent-capabilities/pi-subagents-084-research/package/`；graph project：`pi-subagents-084-research`。以下 `src/...` 与 `docs/...` 均相对此根，不引用本机历史 0.45.1。公开 API 以 tarball 的 `package.json.exports` 与声明文件为准，GitHub main 只作导航。

## 可以直接复用的能力

**前台确实是 SDK 同进程会话，并非 CLI 子进程。** `src/runs/shared/child-session.js:367` 的 `createDefaultChildSessionFactory` 调用宿主 Pi 的 `createAgentSession`；前台使用 `bindExtensions({mode:'print'})`，不需要 TUI。包目录对前台/后台的区别也有明确说明：[Pi 包说明](https://pi.dev/packages/pi-subagents)。因此不能继续用 SDK 示例扩展的进程模型描述这个包。

公开 `pi-subagents/delegation` 提供前台单叶委派事件协议：

```ts
// 先订阅 RESPONSE / UPDATE，再发 REQUEST；只接收完整身份元组一致的消息。
const request = {
  requestId, ownerRunId, nodeId,
  agent: 'deep-research.researcher', task,
  context: 'fresh', cwd,
  model: 'inherit', intercomBridge: { mode: 'off' },
  result: { kind: 'text' },
};
pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
// 父取消时：
pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, {
  requestId, ownerRunId, nodeId,
});
```

常量值为 `prompt-template:subagent:{request,started,update,response,cancel}`；`requestId` 标识一次尝试，`ownerRunId+nodeId` 标识活动逻辑节点，重复活动节点拒绝，取消匹配完整三元组，覆盖先取消后启动竞态。终态区分 completed/failed/cancelled/timed_out/UNKNOWN 类上下文错误，UPDATE 有 runId、进度、可选用量和安全 Provider diagnostics。此 API **仅前台**；异步 RPC 则仅后台，不应混用。调用须处于有效 extension context，不能从 `tool_call` hook 递归调用模型工具。证据：`src/api/delegation.d.ts`、`docs/extension-api.md:315`、`src/slash/prompt-template-bridge.js`。

`pi-subagents/capability-ceiling` 可按 **实际父 session UUID**（不是 JSONL 路径）注册 `allowedAgents`、`allowedTools`、`denyExtensions`。多个注册取交集；注册支持 update/dispose，后代单调继承。它限制工具名字及扩展加载，**不提供 OS 沙箱或本产品资源归属**。证据：`src/runs/shared/capability-ceiling.d.ts`、`docs/extension-api.md:413`。

`pi-subagents/preflight` 的 `resolveSubagentLaunchContract(input)` 是无启动副作用的解析入口，返回有效模型、工具、扩展、角色 definition digest、launchContractDigest、会话/产物路径及诊断；应传 parentModel、availableModels、parentSessionId、projectTrusted、相同 intercomBridge/ceiling 快照以接近真实启动。它不是执行证明，也不证明凭据存在。证据：`src/api/preflight.d.ts`、`src/api/preflight.js:106`。

## skill 内角色发现的现成入口

可以保留 `extensions/analysis-assets/deep-research/agents/*.md`，不要求用户手工复制到全局目录。包已有三种入口：

1. **扫描目录**：Pi settings `subagents.agentScanDirs` 支持绝对路径、`~`、单层 `*`，递归发现 Markdown。固定 user/project agents 优先于额外 scan roots，需处理重名与实际 `agentDir`。证据：`docs/agents.md:16`、`docs/configuration.md:21`。
2. **包 manifest**：已被 Pi package discovery 识别的包可声明 `{"pi-subagents":{"agents":["./agents"]}}` 或 `{"pi":{"subagents":{"agents":["./agents"]}}}`。仅在任意 skill 目录加 manifest 不自动证明该目录成为 installed package。证据：`docs/agents.md:22–34`。
3. **Host 运行时注册**：公开 `pi-subagents/agents` 的 `registerAgent({pi,name,definition})`，返回 dispose；或者同步 `pi-subagents:runtime-agent-register:v1` 事件，读取注册回执。Host 可以解析随 skill 分发的角色材料后注册，文件无需移动。`RuntimeAgentDefinition` 可声明 systemPrompt、工具、skills、extensions、`model:'inherit'`、fresh context 等。选模型仍有 operator override，必须锁定/核对有效模型。证据：`src/api/agents.d.ts`、`src/agents/runtime-agent-registry.d.ts`、`src/extension/index.js:405`。

第三种最适合避免全局安装和项目设置写入，但有一个**准确的 preflight 缺口**：0.84.0 的独立 `resolveSubagentLaunchContract` 只调用 `discoverAgentSnapshot`，没有与 `pi` owner 绑定的 `mergeRuntimeAgents`；执行器会合并 runtime agents。因此不能宣称运行时注册角色已经通过公开 preflight，须实测该差异或补上游 `runtimeAgentOwner`/已解析角色输入。执行本身可复用现有注册+delegation，不因此必须重写。

**trusted workflow resources 不是角色扫描目录。** `pi-subagents/workflow-resources` 的 `registerWorkflowResource({sessionId,definition:{name,version,resolve}})` 注册命名脚本展开及可选精确 host command grants；resolve 只能同步、有限构造，无 I/O。它可以承载已批准工作流，但不能代替 agents 发现，也不应把 gpt-researcher-team 的内部研究顺序硬写进 Host。证据：`src/api/workflow-resources.d.ts`、`docs/extension-api.md:5–91`。

## ModelRuntime 与受管工具的实际缺口及最薄路径

### 模型

前台默认工厂创建**新的** `ModelRuntime`。`ParentProviderRegistry` 只包含 `getRegisteredProviderIds/getRegisteredProviderConfig/getRegisteredNativeProvider`；`inheritParentProviders` 复制注册的 provider/native provider，**没有复制 `setRuntimeApiKey` 状态**，也没有把父 `ModelRuntime` 实例交给 child。证据：`src/runs/shared/child-session.js:46–76,391` 与 `.d.ts`。

当前 OptraCall `src/agent/project-session.ts:199` 则显式使用禁磁盘凭据的 runtime，并经 `setRuntimeApiKey` 送入本次 Host key。因此“继承相同 provider/model 名”不能证明子会话拥有相同凭据；默认工厂还从包的 `getAgentDir()` 解析全局/环境根，而非自动采用产品 `resourceRoot`（`src/shared/utils.js:83`）。这两点必须用合成 Provider/无磁盘凭据场景验证。

### 工具

默认工厂按工具名构造 SDK 默认工具和路径扩展，没有公开 `customTools` 或 factory 参数接收本产品 `createProtectedTools` 返回的实例。当前 package exports **没有** child-session/factory 子路径；内部 `setChildSessionFactory` 虽存在但为 process-wide 测试 seam，不能当已受支持的生产注入契约。不能把 `allowedTools:['bash']` 误作本产品受管 bash，名字相同不保证实现相同。

### 现有公开能力可尝试的薄接

包提供公开 `pi-subagents/required-child-extensions`：

```ts
registerRequiredChildExtensions({
  sessionId,
  extensions: [{ id: 'optracall-owned-child-port-v1', path: hostModulePath }],
  requireForAllRunners: true,
});
```

固定可信 Host 模块可以经产品拥有的、按父 session/operation 绑定的内存 port 提供当前 provider 与受管工具，再用 Pi `registerProvider/registerTool` 注册，继续由包执行模型循环。SDK 声明确认 `ProviderConfig.apiKey` 与 `registerTool` 可用，但**该桥接尚未实施/验证**，不能先承诺拥有所有属性。关键验证：绑定不可跨 owner、只含本次配置、不是任意磁盘凭据入口；tool 实例确为原受管实现；子调用、取消及收尾同属原 execution scope；不得重新读取用户全局配置或开放 native bash。

required extension 具有最终优先级，不能被 agent 的 `extensions:[]` 移除；加载、provider 注册或 session_start 失败须在首请求前拒绝。`requireForAllRunners:true` 拒绝 external CLI、external-job 和 machine placement，**不会拒绝 native detached**。`denyExtensions:true` 与任何 required extension 明确冲突，故此路线应使用精确 allowedAgents/allowedTools + `denyExtensions:false`，Host 注册的角色采用 `extensions:[]` 禁止 ambient，并仅允许固定模块。证据：`docs/agents.md:479–485`、`src/runs/shared/child-tool-plan.js:189`。

上面的模块方案若无法在 SDK 生命周期内可靠绑定现有 port，应向上游申请最小公开 seam：**按父 sessionId 注册 ChildSessionFactory/构造钩子**，公开现有 ChildSessionLaunch/ChildSession 类型，允许 Host 注入既有 ModelRuntime、agentDir 与 customTools，保持 package 原模型解析、委派、事件、取消和结果协议；dispose 只释放本 session 子资源。现有内部 factory 已具备 create/dispose 形态，上游可围绕该 seam 增加 session ownership，避免 process-wide setter 或重建 subagent runner。

## 前台取消与资源收尾的界限

默认 child 接口已有 `prompt/abort/dispose` Promise；执行器在结果返回前 await child.dispose，SDK session_shutdown 后 dispose，普通前台无需进程脱离。父原始工具 AbortSignal 可接完整元组 cancel，并等待该 attempt 的终态，继续保留当前公共 operation 占用。

但包内部在 abort 后约三秒可以强制 settle，默认 shutdown handlers 有五秒上界且部分错误吞掉。`finish()` 的 dispose 异常也不会直接冒泡。因此包“已回终态”**不能独自证明本产品进程组和所有工具资源已收净**。产品原 `drain/close` 与 guardian ACK 仍是结束受管 busy 的依据；未核定则保持 UNKNOWN/busy，而不是再次发模型。证据：`src/runs/foreground/execution.js:501,691,1271,1334`；`src/runs/shared/child-session.js:367`。

## 建议范围与未完成验证

先以公开 foreground delegation + runtime role registration + required Host module 接普通任务的最小合成切片；后台、CLI、TUI、远端、命名 host command workflows 不进入首期模型工具面。受管普通/受保护任务并非因包有后台功能而必须拒绝；应验证前台子会话确实接原权限与工具 scope 后再开放。封闭文本 fixed-draft/text-only 继续不注册委派工具。

### 对比当前直接复用 SDK 的最小适配

如果当前约 110 行的委派工具已经经产品既有 session factory 直接取得父内存 ModelRuntime、原受管工具和公共 scope，**本轮优先采用该最小适配**。依据是已查明的接口差异，而非包体大小或“原生”名称：0.84.0 的公开 API 确实管理前台委派，但要满足本产品完整边界仍需非平凡 Host 桥（内存 provider/凭据、tool 实现绑定、配置根隔离、工具面收窄、取消终态后的资源 ACK）。还必须处理 runtime agent 与独立 preflight 视图不一致。不能把单纯安装主扩展算作等价替换。

这是当前范围的选择建议，未对父 agent 实施中的候选做代码复核；直接 SDK 适配同样须证明未重建模型循环、权限未升级、取消失败保持 busy。若上游增加 session-scoped 构造 seam，可重新比较，不排除后续复用包。

### 使用完整包时的精确关闭项

包主入口 `registerSubagentExtension(pi)` 没有公开 per-instance config 参数，配置从 `getAgentDir()` 对应位置读取。不能为产品改用户全局配置，也不能用并发修改 process env 假装 session 隔离。以下是已存在的开关；它们不是已经设置的状态：

| 目标 | 现成设置/调用边界 | 限制 |
| --- | --- | --- |
| 后台调度 | `scheduledRuns.enabled:false` | 默认 true；关闭后 schedule.* 各入口拒绝，原记录保留 |
| 重开自动恢复 | `autoResume:false` | 默认 true；仅关闭近24小时中断 async workflow 的 reopen/reload 恢复 |
| 默认前台 | `asyncByDefault:false`、`forceTopLevelAsync:false` | 不是禁用显式 async；使用 foreground-only delegation API 并不暴露原通用工具面 |
| 额外持久台账 | `missions.enabled:false,globalIndex:false` | 自动 mission 默认开启；仅禁 model-facing missions 参数不足以禁默认自动创建 |
| TUI/命令/面板 | `enableSlashCommands:false`，不设置 foregroundDetachShortcut，`orcaProgressTabs.enabled:false` | slash 关闭不等于关闭 RPC、watcher 或其他入口 |
| 非本期功能 | `disabledFeatures` 可含 `workflow-scripts`、`agent-management`、`panes`、`watchdog`、`missions`、`external-machines` 等 | 只是移除/拒绝相应覆盖入口；configured default、角色 machine、watchdog 自身设置仍须另核 |
| 相同模型 | 每次显式 `model:'inherit'` 或当前完整 provider/id，显式 thinking 与 `context:'fresh'` | per-call 模型优先级最高；runtime角色的 operator model/fast/thinking overrides 仍须核最终值；fresh 避免 fork pruning 摘要产生额外模型调用 |

证据：`docs/configuration.md:121,197,250,258,285,423,523,673`、`docs/models.md:14`。`runSyncCompletionInner` 另外包含一次 compaction abort 后保留子会话同模型恢复，区别于 reopen `autoResume`；当前调用路径和公开配置文档未发现关闭该行为的参数。不能把 `autoResume:false` 宣称为关闭全部内部恢复。

当前均为 **RESEARCHED / NOT_RUN**：无磁盘凭据继承、实际 read/bash/write 端口、真实网络工具继承、两角色合作、父取消+dispose、受管 drain、禁止副作用与模型配置变更、日志脱敏、runtime角色 preflight 一致性。研究已确认有可复用前台 SDK 与公开治理 API，剩余工作是验证/补齐上述明确接缝，不能把源码研究写成实现 PASS，也不因包功能多而主观拒绝复用。

# 后端复用接缝核对报告（只读探索 · 2026-11-28）

工作树 `work/qoder/issue-155-agent-brain-external-collaboration`，基线 main `7403091`。行号对该工作树核实。供 D01 设计与分切片实现引用。

## 1 统一会话 Interface v3 · `src/host/agent-sessions.ts`（527行）
- `AGENT_SESSION_INTERFACE_VERSION=3`(:5)。`SessionRef/SessionExecution` 唯一 symbol branded 不透明对象(:6–9)，仅 `domain.ref(owner)`(:431) 铸造，WeakMap(:90–92) 跟踪；JSON/复制字段不可伪造。
- `SessionTurn`(:12): `{text,requestId,kind?,requestFingerprint?,providedContext?,verifyBeforeDispatch?}`。`SessionRun`(:14): `{requestId,accepted:Promise<void>,completion:Promise<SessionResult>,context}`。`SessionResult`(:13): `outcome:'completed'|'cancelled'|'failed',text,sessionFile?,diagnostic?`。
- `SessionProfile<Owner>`(:32–42): `key(owner)`,projectId?,同步`configuration(owner)`,`agentOptions(owner,configuration,execution?)`,executionMode?/policyFingerprint?/policyCurrent?/admit?,`capabilities:{commands?,ui?,editor?}`。
- `AgentSessionDomainOptions`(:43–52): Host 供 name/profile/configurationSnapshot(id,revision)/mutate/isClosing/publish/测试 createAgent(:51)。
- `AgentSessionDomain`(:53–79) 全表面；**`AgentSessionPort<Owner>`(:82)** 业务子集 Omit name/ref/closeAll/busyInScope/execution/owns/registerFresh/executionState/currentRequestId。
- `reserve`(:238) busySlot(:139) 拒 session_busy；`startTurn`(:245) 一 lease 一在途 turn；`withSession`(:349) 跨 turn 占用；`retire`(:144) 单一 retirement promise，失败清理隔离(closeBlocksOwner)，仅显式 close(ref,{retryFailed:true}) 重试；`stop(ref,{expectedRequestId})`(:503) 防旧恢复。
- 接入：业务收 port＋Host 核验 ref；写须在 mutate 内复核 context.isCurrent()；busy≠worker-alive；不新增持久会话表；边界 `scripts/check-agent-session-boundary.mjs`（npm run check:agent-sessions）。
- plug-in：外派模块续接原任务复用 project-tasks 域经 Host 注入窄 facade，不自铸 ref/不调 closeAll。

## 2 project-tasks 域 · `src/host/server.ts`（4049行）
- `ProjectOwner={project,task,reviewAdmission?}`(:496)。域 :714–914：key=keyOf(project.id,task.id)(:717)；configuration=任务绑定(:719,:645)；policyFingerprint=member-pack＋serviceConnections.policyFingerprint(:720–721)（连接 epoch 变即失效资源）；admit(:729)；agentOptions(:736–887) 构造各 port（semantic:743,projectFiles:746,serviceConnections.port:782,studio:818）。
- **`startProjectMessage(projectId,taskId,input,origin={userText:true}):Promise<ProjectMessageReceipt>`**(:2651)。流：验 requestId UUID＋text≤20000(:2652)→requestFingerprint(:2653)→pair(writable)(:2653)→priorRequest 去重(:2654)→plan 继承(:2666–2685)→withSession(:2708)→mutate 内备 prompt＋providedContext(:2711–2801)→lease.start＋verifyBeforeDispatch＋markRun running(:2804–2828)→accepted 后 202(:2838)→后台 completion→settleProjectRun(:2843)→automatic.complete(:2845)→completeNewDelivery(:2847)→publish run.settled(:2855–2864)。
- `providedContext`(:2771–2786): originalUserText=input.text，**userQuoteEligible=origin.userText**(:2776–2777)；机器 turn 传 {userText:false}（project-plan-host.ts:2324）。
- **`requestFingerprint(input,projectId,taskId)`**(:2106–2123): sha256 版本化身份数组(optracall_request_*_v1)含 text/caseContext/requirement/enterprise/feedback/projectData/personal/studio/projectPlan；无选择则 undefined。去重权威 `priorTaskRequest` · `src/host/project-history.ts:137–169` 扫 native optracall.run；指纹不符⇒operation_conflict。
- **`completeNewDelivery(owner,lease,requestId,result,input,providedContext?)`**(:2217–2323): 仅 completed；assertCurrent=owns(ref,lease.context)＋lastRun.completed(:2223)；`runDeclaredContinuation`(:2224–2238) 同 lease/session 新 turn，stableActionId(:2216)，priorRequest 去重，providedContext.automaticSource{kind,parentRequestId}，originalUserText:''，userQuoteEligible:false。
- 后台再 turn：(a) 同 operation 内 lease.start（verification-host.ts:231–239 用 owns 证归属）；(b) 空闲新 operation 调 startProjectMessage(...,{userText:false})（project-plan-host.ts:202）。守卫：reserve busy/admit/pair 归档(:2145–2150)/指纹去重/verifyBeforeDispatch。
- stop/cleanup(:3842–3857): executionState(ref).cleanupRequestId(:3845)；匹配显式 close 重试失败清理；否则 stop＋feature stops。busy(ref)(:490)，taskState 调和(:2162–2199)，projectBusy(:2151)。归档准入=assertActive(project)＋task.archivedAt(pair:2148)。

## 3 服务连接 / GitHub · service-connection-manager.ts(449)/store.ts(380)/mcp.ts(295)/oauth.ts(272) · src/agent/service-connection-tools.ts
- manager 构造 server.ts:219–230，invalidate=closeAll 按 task.serviceConnections(:221)，assertOwner 比绑定指纹(:223–229)。
- binding(service,{expectedConnectionRevision,scopes?,repositories?})(:355)→store.createBinding(:300–313) 收窄为 TaskServiceBinding 存 task.serviceConnections；policyFingerprint(:229) 入 profile。
- **Port**（service-connection-tools.ts:5–16）: `ServiceConnectionsPort={call({service,toolName,args},context)}`，context(:7–14) 需真实 tool 身份 projectId/taskId/requestId/sessionId/toolCallId/signal/assertCurrent()/registerCleanup/confirm/input/select。Pi 工具 createServiceConnectionTools(:33) 名 service_github_<tool>(:19)。Host 注入仅 unmanaged 非会员包有绑定任务(server.ts:782)。
- 写身份/状态机 manager.#call(:365–431): operationId=sha256([projectId,taskId,requestId,toolCallId])(:400)；operationTarget(:72–85)；prepareOperation→confirm→confirmed→submitted→succeeded|rejected|unknown（store.transitionOperation:347–369，转移表:358）。unknown→succeeded/rejected 仅 reconciled:true。启动标外来 submitted 为 unknown(store.init:125–138)；同不确定写去重(:330–337)。提交后错误保 unknown 除非 ServiceRemoteError.unknownOutcome===false(:424–425)。
- **GitHub Issue 能力已存在**：REMOTE_SERVICE_TOOL_POLICY(mcp.ts:27–39): issue_read/list_issues/search_issues=read；**issue_write/add_issue_comment=collaborate(写,无confirm)**；merge_pull_request=merge+confirm。RemoteServiceBackend.invoke(:262–293)→McpClient StreamableHttpTransport(:186)→SERVICE_URLS.github='https://api.githubcopilot.com/mcp/'(service-connection-types.ts:11)；schema 钉 catalog(:284–286)；enforceGithubRepository(:107–120) 限 owner/repo∈binding.repositories。Auth：ServiceOAuthManager＋loopback PiOAuthCallbackServer.listen({host:'127.0.0.1'})(oauth.ts:231) 或 PAT accessToken(store:233–236)。
- plug-in：经 port().call issue_write/add_issue_comment；context 须真实 SDK tool call。Host 后台发布需 Host-only manager 入口或合法合成 operation context——port 拒绝无凭据匿名调用。**不伪造前台 tool context。**

## 4 语义/资产读取
- semantic-context-service.ts: `query(projectId,taskId,input,options)`(:70)；options.sourceAllowed hook(:26,执行:95–98/:106)。SAP 需精确 version(:111) 比 publishedHash vs bytesSha256(:116)；sap-method hash(:125)；enterprise storeId＋enabled 前后复核(:133–141) revision bodySha256(:143)；case storeId 不符 403(:209)；owner 不符 403(:107,:42–45)。失败降级 typed state(forbidden/hash-conflict/missing/disabled/unknown:38–41)，不造正文。
- semantic-context-port.ts: **createSemanticContextReadPort(:10–28)** 收窄模板——graphOnly 仅'graph'；否则 find/read/trace 委托 legacy port；每步复核 assertCurrent。createSemanticContextPort(:31–65) 加'record'写(mutate＋CAS createCitation，native-evidence owner 核:49)。
- studio-enterprise-catalog.ts: createStudioEnterpriseCatalog(:27)；资格=formal-current＋单企业归属＋无冲突(:77,:100,:110)；qualifySource hook 降 restricted(:130–136)。
- src/agent/studio.ts: STUDIO_READ_ACTIONS=['catalog','read','read-source','reason','pack-read'](:7)，StudioReadPort(:11)。studio-host.ts:922–928 port(...,{analysisOnly:true}) 对其他 action 抛 studio_read_only 403。
- 远端只读适配包这些 Host-bound port，供 bounded context＋每调用复核归属，白名单 action，不重实现 reader。

## 5 文件/交付保全
- PROJECT_UPLOAD_MAX_BYTES=50MiB(project-upload.ts:2)。project-files.ts createProjectFilesPort(:15): write-report(:35–51) 去重 listBoundReports＋captureFeedbackFile→projects.writeBoundReport；read-input(:75–105) 仅 020_clean，sha256 回执。
- 原子保存 ProjectStore.writeBoundReport(project-store.ts:703–792): staging tmp(O_EXCL|O_NOFOLLOW,0600)→write+fsync→目录身份核→hardlink publish(EEXIST⇒report_name_conflict)→re-read observeFile hash→receipt{projectId,taskId,filename,path,relativePath,sha256,bytes,requestId,sessionId,toolCallId}(:789)。
- **native 收据** ProjectTaskResultBinding(project-task-results-types.ts:7–17) 仅由扫 native JSONL optracall.project-report-write 形成(project-task-result-sources.ts:57–64,验:95–108,fork 排除:100)。final-reply binding(:20–28/:35–54) 需 completed optracall.run 祖先链。
- ExternalDeliveryRef 不可复用 ProjectTaskResultBinding 语义；需独立记录类型，证明=GitHub operation receipt(operationId/resultId)＋内容 hash，与 native 台账分离可链接。

## 6 持久化模式（dataRoot 默认 ~/.optracall，server.ts:217）
1. **原子 JSON＋lock＋version CAS** ServiceConnectionStore(store.ts:110–380): 单 connections.json，0700/0600，O_NOFOLLOW，tmp+rename+dir fsync(:160–174)，.store.lock inode 校验释放(:175–194)，#mutate(state,expectedVersion?,signal?,expectedConnection?{fingerprint}) CAS(:195–209)，严格 schema:1 解析(:96–107)，64MiB/10000 操作上限。
2. **SQLite(node:sqlite DatabaseSync)** CaseStore(case-store.ts:4,:27,:221): decision-cases.sqlite3＋JSON marker；schema1–4 canonical sqlite_master  inventory 比对(:235–241)；迁移 row-preserving(:390,:418)。
- 新 ExternalWork/Claim/Delivery 用模式1（dataRoot/external-work/ 镜像 ServiceConnectionStore）。无 ORM/迁移框架；显式版本化解析＋保全检查。

## 7 MCP SDK / HTTP 面
- package.json: @modelcontextprotocol/sdk 1.32.2(:22)，@earendil-works/pi-coding-agent 1.4.0(:21)，zod 4.6.7，typebox 1.3.27，Node≥25。
- src/agent/sdk.ts 重导 Pi SDK＋McpClient/StreamableHttpTransport(@earendil-works/pi-mcp:6–7)＋OAuth client helpers(:8–9)。
- MCP server 例 extensions/connectors/trade-area-mcp/server.ts: McpServer＋registerTool z.looseObject(:65–70)，structuredContent＋isError，readOnlyHint；stdio 注册 src/agent/project-session.ts:273–276。
- **src/extensions 无 Streamable HTTP server、无 OAuth authorization-server 代码。** 仅 Host API(node:http createServer,server.ts:2876,绑127.0.0.1 main.ts:50)＋OAuth loopback callback(client)。Host 守卫(server.ts:2880–2883): Host header 须 127.0.0.1/localhost＋准确端口；Origin 须 uiPorts＋自身端口白名单。受保护远端 MCP(Streamable HTTP＋bearer/OAuth RS)净新；SDK1.32.2 上游含 server transport，repo 未用（worktree 未装 node_modules，安装文件未核）。

## 8 测试基建
- npm test=node --test tests/*.test.ts；npm run check=check:agent-sessions(AST 边界)＋test＋build。flat tests/*.test.ts(node:test＋assert/strict)＋.mjs 浏览器脚本＋tests/fixtures/。
- 风格：(1) 合成域单元 tests/agent-sessions.test.ts(31测试) fake Transport＋harness 注入 createAgent(:10–54)，跨域 ref 拒绝/busy/cancel。(2) 真实 Host 子进程 HTTP tests/fixtures/host-process.ts startTestHost --port=0(:19)；tests/service-connection-host.test.ts 驱真实路由，secret 不泄漏/收窄绑定。(3) MCP 协议 tests/trade-area-mcp.test.ts SDK Client＋InMemoryTransport(:6–7) 对 createTradeAreaServer，mkdtemp 合成。(4) OAuth/HTTP loopback tests/service-connection-oauth.test.ts 本地 createServer 127.0.0.1:0＋fetch 重写 x-original-url(:8–27)，forged-state/PKCE。TLS 仅 DB-link/weather client；无 HTTPS-server 测试先例。

## plug-in 点汇总
续接=原 withSession 内 lease.start(completeNewDelivery:2224) 或空闲 startProjectMessage(...,{userText:false})；GitHub 写=port().call issue_write/add_issue_comment 入 prepared→submitted→unknown 日志；远端读=包 createSemanticContextReadPort/studio.port({analysisOnly:true}) 收窄；交付证明=native ProjectTaskResultBinding 旁独立记录；持久化=ServiceConnectionStore 式原子 JSON CAS；远端 MCP HTTP/OAuth server=SDK1.32.2 净新，守 localhost/Origin 约定。
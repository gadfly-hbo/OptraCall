# 决策看板一期 · 非作者独立复核

2026-10-31 · 复核者：Qoder 独立复核 Agent（与候选全部作者无共享实施上下文）· 候选：分支 `qoder/ext-decision-platform` 工作区未提交改动（清单 `.local/decision-board/candidate-files.txt`）

## 范围与方法

- 依据：[spec.md](../spec.md)（DB01–DB12、Interface v1 接入记录、IN06 责任边界安排、流程补正）与 [engineering-workflow.md](../../../docs/engineering-workflow.md) IN01–IN07、§3–§5。先从验收导出关键预期，再读实现与作者测试。
- 逐文件通读全部候选（扩展 8 文件、`src/host/decision-board-sessions.ts`、`server.ts` 接线 diff、边界脚本 diff、3 个新测试、浏览器测试、synthetic-provider diff、App/styles/help/README/手册 diff、UI Demo 抽查），并对照共享域实现 `src/host/agent-sessions.ts` 与既有域适配器（requirement/verification）、`project-store.ts` 读路径语义。
- 实际运行检查（命令与结果见下节）。源文件/测试/规格/证据全程只读；仅写本文件；浏览器隔离环境用后已停（含 vite 4183 端口清理）。

## 检查结果

### 1. 命令与输出

| 命令 | 结果 |
| --- | --- |
| `node --test tests/decision-board-store.test.ts tests/decision-board-normalize.test.ts tests/decision-board-host.test.ts` | 15/15 pass, 0 fail（含真实 Host 子进程 + 合成 Provider 端到端与失败路径） |
| `npm run check` | exit 0：`Agent session integration boundary: PASS`；506/506 pass、0 fail/cancelled/skipped；vite build 成功（`0.1.0-mvp.4 c00bd7d+local-changes`）。与 result.md 宣称一致 |
| 浏览器回归（复核者自跑：`node tests/fixtures/browser-environment.ts` + playwright 执行 `tests/browser-decision-board.js`） | 全新环境首轮完整通过：看板聚合 2 项目、合成 Provider 恰好 2 次调用（均 `synthetic-board-extract`）、采纳项含 done 任务与评分 4 反馈、驳回留理由、人工项（经验假设 0.35）、重抽后已决/人工项保留且 suggested 重建（经 Host API 读取看板状态逐项核对）。同环境立即二次运行因同名报告 locator 严格模式冲突失败——该测试要求全新环境（result.md 已声明"两次全新环境"），非产品缺陷。空闲新页 15s 无控制台错误；轮询失败路径降级为错误横幅并重试，无崩溃 |
| 证据抽查 | `.local/decision-board/{qa,realtest}` 的截图、日志、`board-after-extract.json`、`browser-run-green.log` 均存在，与 result.md 宣称一致 |

### 2. Host 接缝（IN06 指定复核重点）

- **admit/busy/closeAll**：`decision-board-sessions.ts:39-46` admit 拒绝同报告他抽取运行中（`extraction_busy`）并经 `projectAccess` 拒绝归档项目；关闭中由共享域 `assertAvailable` 拒绝。`busy()`（:122）按 DB running 行 + 报告归属项目判定，已纳入 `server.ts:261-264` `projectBusy`（归档空闲准入）。`closeAll`（:123-132）先 `domain.closeAll(filter)`，再把仍 running 的行按 provider/projectId 过滤标 `failed: runtime_closed`，不伪造成功。
- **execute 生命周期**（:62-88）：mkdir 0700 工作区/会话目录 → 单轮 `lease.run` → `lease.context.isCurrent()` 拦截迟到结果 → cancelled/failed/completed 三分收尾，完成路径先 `normalizeExtractionOutput` 再 `enforceVerbatimQuotes` 后落库；外层 catch 记失败、finally `domain.close`。`stop()`（:110-118）domain.stop 后标 cancelled，与 execute 收尾竞争由 `extraction_conflict` + `.catch` 吞掉，无双写损坏。
- **server.ts 接线**：路由挂载于 requirement 之后、config/projects 之前（:340-341），前缀 `/api/decision-board` 无遮蔽；`closeAgents` 含 `boardSessions`（:146-153，projectId 过滤参与）；`ready` 含 `boardStore.init()`（running→interrupted reconcile，:64）；关闭顺序 gate→closeAgents→streams→cases→boardStore→projects→server（:610-621），看板会话在存储关闭前收尾。与 project/verification/requirement 三域一致，无遗漏。
- **边界脚本**：`check-agent-session-boundary.mjs:26-27` `domainRegistrars` 仅新增 `'src/host/decision-board-sessions.ts'`，注释同步说明；其余集合未放宽。扩展目录仅导入自身模块与 node 内置（逐条 grep 核实），未取得域构造器或 SDK；无绕过。

### 3. 无工具/固定输入（DB03/DB04）

`workspace.ts` `defaultTools: []` 经 `project-session.ts:119` 映射为空工具 override；host 测试断言 Provider 请求无 `tools`（`decision-board-host.test.ts:48`）。报告 UTF-8 严格解码、20,000 字符截断并随抽取记录持久化；提示词内嵌报告全文，单轮无续接。`enforceVerbatimQuotes` 对 `reportExcerpt` 逐字校验，非逐字 quote 剥离、保留事实文本（纯函数测试覆盖）；置信度由 `EVIDENCE_CONFIDENCE` 固定映射，模型自评被丢弃（normalize 测试断言无 `confidence` 字段）。

### 4. 存储（store.ts）

全量 prepared statements，无 SQL 拼接面；`registerReport` 相对路径强校验（必须 `060_reports/` 前缀、无 `..`/`.`/空段/控制字符/反斜杠、≤4096）；init 采用安全打开模式（0600 独占创建、lstat 符号链接/nlink 检查、`allowExtension:false`、同根占用守卫、`user_version` 校验）；`finishExtraction` 事务内仅删 `extracted+suggested`（已决/人工保留；suggested 项因 `task_requires_adoption` 不可能有任务，`ON DELETE RESTRICT` 无冲突）——DB06 由测试证实；状态机（驳回理由 ≥2 字、dismissed 不可直改采纳、adopted→dismissed 需理由）与重开 reconcile（running→interrupted、不动 items）均有测试。

### 5. 路由输入校验与归档只读

`extract/items/adopt/dismiss/tasks/status/feedback` 全部写端点均有 `assertActiveProject`（或 extract 内 `projectAccess`），归档 409 `project_archived` 映射齐全；uuid 格式、枚举、长度、评分 1–5 校验在路由或存储层闭合；`stop` 为控制操作不设归档检查（此时项目不可能有 running 抽取），可接受。GET view 只读。

### 6. 前端

轮询 `setInterval` 在 useEffect 返回清理且仅可见时执行；dialog 用原生 `showModal`，`onClose` 覆盖 Esc/✕；`pending` 防并发；错误进 `role=alert` 横幅不吞掉；已驳回开关显示只读卡含理由；归档项目抽取禁用、人工补充弹窗过滤归档项目；空态为引导文案非演示数据（DB01/DB10）。

### 7. synthetic-provider 附加改动

按模型名 `synthetic-board-extract` 键控固定回复，仅在成功路径替换 chunks；默认 chunks、`setChunks`/`setMode`、failure/slow 路径语义不变；既有消费者无一使用该模型名，506 全量回归为证。

### 8. DB10 文档与占位

`DecisionPage.tsx` 删除无残留引用；App.tsx 换页；styles.css 占位专属规则移除；help/user-manual/README 同步更新，口径一致。

## 发现

**阻断：无。**

**建议（均可由作者独立复现）：**

1. **[建议] 归档竞态写返回 500 而非 409** — `extensions/business-plugins/decision-board/api/routes.ts:36-58` 的 `messages` 表缺 `project_busy`/`host_closing` 映射；归档进行中对看板写端点触发的 `RequestFault(409,'project_busy')`（`src/host/server.ts:167`）落入默认 500。复现：对项目 P 发起 archive 的同时 POST `/api/decision-board/items/<id>/adopt`。
2. **[建议] 路径校验晚于文件读取** — `src/host/decision-board-sessions.ts:95` 先 `readFile` 后在 `store.registerReport` 才校验 `060_reports` 前缀；`path: '020_clean/x'` 会把该文件读入内存后才 400 拒绝。无内容外泄（仅返回错误码），但先做纯路径校验更贴合 DB11 "不读 010_draw" 的保证口径。
3. **[建议] 内容与观测双读竞态** — `decision-board-sessions.ts:95-98`：`readFile`（用于提示词）与 `observeFile`（sha256 落库）是两次独立读取，期间文件变化会使记录 sha 与实际送模型的正文不一致。可参照 `verification-host.ts:118` 的前后双观测。
4. **[建议] 变更检测仅比较字节数** — `routes.ts:115`。同尺寸内容变化显示 `available`；抽取总是重读当前文件，故仅提示可能过期而非数据错误。result.md 已如实记录为边界，保持记录或扫描时顺带哈希。
5. **[建议] 能力目录条目与现状矛盾** — `src/host/ui/catalog-data.ts:39` 仍将"决策工作台"标为"预留接入 · 尚未接入"，与已上线的决策看板表述冲突（DB10 范围只覆盖决策页/README/帮助，未要求改目录，属遗留口径）。
6. **[建议] 收尾失败可滞留 running** — `decision-board-sessions.ts:79-84` 的 `finishExtraction` 失败被 `.catch(() => {})` 吞掉；若存储持续出错，抽取行保持 `running` 直至进程重启，期间阻塞该报告与项目归档。可考虑终态兜底或上报。
7. **[建议] 弹窗内提交失败错误在模态背后** — `DecisionBoardPage.tsx:69,143-146`：错误横幅渲染在页面顶部，原生模态打开时用户可能看不到弹窗提交失败的原因。
8. **[建议] 证据卫生** — result.md 称"隔离 QA 进程已停止"，复核者发现并已停止一个 11:26 启动的残留 QA Host 进程（`host-entry.mjs`，临时 scratch dataRoot）。无仓库影响，属进程清理遗漏。
9. **[观察] 任务状态流转未强制单向** — `store.ts:268-274` 允许任意方向（如 done→todo、todo→done 直达）；规格列出 `todo→doing→done` 但未明确要求 API 强制，UI 已限制流转方向。维持现状或补约束均可，需作者定夺。

## 结论

**PASS with findings**（9 条建议/观察，0 阻断）。

- DB01–DB12 在授权范围内逐项核实：跨项目汇总与归档标记、登记与变更提示、显式单轮无工具抽取（202/409/停止/归档拒绝）、置信度固定映射与逐字引用校验、状态机、重抽保留、任务/反馈、人工补充、占位移除与文档同步、不写 060_reports/失败不伪造成功、`npm run check`（含 agent-session 边界）全量通过。
- IN01–IN07：Interface v1 接入记录完整；域注册在 Host、扩展仅获业务集合；生命周期全走 `createAgentSessionDomain`；业务差异留在适配器；资源/凭据经 Host 路径；本次 Qoder 代行 Codex Host 接缝的用户指定安排已由本复核专门覆盖（建议 1–3、6 即该接缝的边缘问题），合并前 Codex 侧互查仍按规格建议执行；检查未靠删断言或扩白名单通过。
- 本复核不覆盖：Git/CI 实际交付、真实模型质量结论（单轮试跑不构成模型质量判定）、MacBook 体验；以上按规格另行安排。浏览器二次运行失败为同环境污染（测试设计要求全新环境），已注明。

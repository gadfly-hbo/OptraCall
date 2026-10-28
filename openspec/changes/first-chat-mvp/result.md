# first-chat-mvp：结果记录

2026-10-29 · 四项开发本地完成，现统一 Git／CI交付

## 授权与状态

第1项目录、第2项Demo及第3项SDK准备保留各自本地检查／独立复核；第2项用户审核通过。第4项按已确认追加方案完成，最终两轴独立复验PASS，最新证据与统一交付见本文末尾；用户产品验收仍单独记录。

| 项目 | 当前状态 |
| --- | --- |
| 1：目录准备 | LOCAL_COMPLETE，原证据保留 |
| 2：调研、Demo、接缝 | USER_ACCEPTED，39文件候选1f459fd1… |
| 3：SDK／LLM准备 | LOCAL_COMPLETE，62文件候选669fc090…，原独立PASS |
| 4：持久项目与完整Pi | LOCAL_COMPLETE，84文件v3候选9d8524bd…，独立两轴PASS；用户产品验收待进行 |
| Git／CI | 四项完成门槛已满足，统一工作分支／PR和单任务CI；实际状态见交付PR及本地回执 |

## 第 1 项变更与证据

- 新增目录、六个空标记及本批次两份薄记录；根 README 增加目录说明，工程入口和工程规范同步当前授权与 Git/CI 暂缓安排。
- 本次新增/修改范围以[薄规格](spec.md)为准，未生成产品代码、框架、依赖清单、数据库或插件协议。
- 执行前既有八文件摘要保留在 `.local/first-chat-mvp/step-1/pre-change-manifest.json`。
- 固定候选目录/文件及摘要使用 `.local/first-chat-mvp/step-1/candidate-manifest.json`；本地检查和独立复核分别保存在同目录 `local-check.json`、`independent-review.md`。结论只由真实执行结果支持，不从文件名或本文推定 PASS。
- 旧初始化证据保留在 `.local/initialization-2026-10-28/`，不覆盖历史 FAIL、NEEDS_FIX 或最终回执。
- 第 1 项结束时没有 Git 命令、CI、产品测试、SDK 接入、模型调用、WorkBuddy 内容探查、MacBook 操作或产品验收的完成主张。

## 当前返回点

四项本地开发与独立复核完成，当前统一Git／CI交付；合并和用户产品验收尚未进行。第4项以[最新方案](../../../docs/stage4-persistent-projects-and-agent.md)为准；第3项的内存／空工具／不读取旧凭据只表示历史阶段。强制原件隔离已按用户决定撤下，采用系统提示词软约束及前端敏感资料提示。

## 第 2 项实施与证据

- WorkBuddy v5.9.3 已通过本机首页与关于页分别核实；首页、模型空表单、独立设置窗口、快捷键、右侧空面板、公共能力目录和侧栏收起均留有本地证据。未发送任务、保存配置、查看已有业务对话或调用真实模型。
- [研究报告](../../../docs/workbuddy-research.md)区分实机、官方资料、推论和未验证范围；[界面与接缝设计](../../../docs/ui-and-agent-seam.md)说明演示源及真实 SDK 的分工。
- 单根 React / TypeScript / Vite 浏览器 Demo 已实现；包和锁文件固定实际版本。Agent 与三类 Extension 仍为空标记，无 Pi SDK、业务工具、数据库或真实模型连接。
- `node --test tests/chat-state.test.ts` 保留断言失败的 RED 和后续 GREEN；初轮 8 项状态测试通过；独立复核后的草稿修复补齐永久负例，最终 9 项状态测试、类型检查和生产构建通过。原始输出位于 `.local/first-chat-mvp/step-2/tdd-red.txt`、`local-green.txt`。
- `tests/browser-smoke.js` 已通过表单、焦点、中文输入法、流式/停止、会话隔离、失败/重试、明暗/窄屏及无外部请求/存储的本地检查，见同目录 `browser-check.json`。视觉截图和局部文字对比度检查保留在本地，不是完整 WCAG 认证。
- 浏览器检查曾遇到会话命名环境、旧 ref、定位器名称及异步布局时序问题；各次记录保留，不当作产品 RED。焦点初次即时断言的时序限制也已记录；运行失败标记与按钮可访问名称已修正，视口订阅增加初始同步，最终完整回归通过。文件监听排除本地证据/测试/文档是隔离措施，不将旧重载假说写成已证实根因。
- 固定候选与最终独立复核使用同目录 `candidate-manifest.json`、`independent-review.md`；独立结论以真实报告为准，不从本文预先推定。
- 当前只运行本地 dev 服务：`npm run dev`，http://127.0.0.1:4173/ 。原 Demo build 标识为 `step2-ui-20261028`，目录版为 `step2-catalog-decision-20261028`，最新项目版为 `step2-project-space-20261028`。开发运行与生产构建分别验证，不代表安装、发布、真实模型或用户产品验收。
- 本批次未执行 Git 或 CI。第 3 项仍待单独方案确认。

### 第 2 项独立复核修复

初轮独立复核 `review/independent-review-v1.md` 为 NEEDS_FIX：仅含草稿的会话被侧栏隐藏，重试旧失败提示清空下一句草稿。原 29 文件候选在 `candidate-v1/` 保留，原清单、检查和构建日志也另存 v1，不覆盖失败现场。

两个边界均已补充实际负例：`draft-browser-red.js` 暴露不可恢复入口，永久状态测试的 `tdd-draft-red.txt` 保留 8 PASS / 1 断言失败。修复侧栏草稿入口/标记，并显式区分重试与输入框发送。最终 9 状态测试和更新后的完整浏览器回归通过，见 `browser-green-v2.txt`；两个发现待固定新候选的独立复验结论确认。原 NEEDS_FIX 不改写成 PASS。

原 Demo 最终独立复验报告为 `.local/first-chat-mvp/step-2/review/independent-review.md`，结论 PASS，对应原 29 文件候选。该结论不覆盖以下追加修改。

### 第 2 项：四类目录与分析／决策修订

用户要求四类侧栏目录、类似 WorkBuddy 的卡片呈现及顶部分析／决策切换，允许虚拟示例。范围与验收见[修订说明](../../../docs/demo-capabilities-revision.md)，附件与远端参考身份保留于 `.local/first-chat-mvp/step-2-revision/reference-identity.json`。只读 SSH 核对 MacBook decision-platform 的 README、依赖与目录，未启动服务、读取业务数据／凭据或写入远端。

- 实现分析资产、场景组合、连接器、业务插件四页，含本地搜索、业务标签、空结果清除及只读详情。决策工作台使用虚拟统计和建议／行动／复盘三列占位；全部明确未接入，无安装、连接或业务操作。
- 分析仍为原对话主页；工作区／目录切换保留会话、草稿与进行中的演示回复；模型设置返回原页面。仍无 Pi SDK、真实模型、业务插件或持久化配置。
- `tdd-red.txt` 保留 4 项目录行为的断言失败；随后 4 项目录测试与原 9 项状态回归、类型检查和生产构建通过，原始输出为本轮 `local-green.txt`。
- 首轮浏览器检查在 390px 暴露顶部按钮被内容遮挡，失败日志和截图保留为 `browser-catalog-v1-fail.txt`、`narrow-v1-fail.png`；将窄屏头部改为两行 grid 并禁止 flex 压缩，补充栏内边界断言。最终新增浏览器回归 `browser-catalog-green-v2.txt` 与原回归 `browser-original-green.txt` 均 PASS，覆盖 390/320px、暗色、详情焦点、分类筛选和草稿／事件保留；所测请求无外部或模型出口。
- 本轮固定候选为 `candidate-manifest.json`，摘要差异、文档检查与视觉截图保留在同一证据目录。独立结论见 `review/independent-review.md`，以实际报告为准，不继承原 Demo 的 PASS。

本轮未执行 Git 命令或 CI，未启动第 3、4 项；本地验证与独立复核也不代替用户体验验收。

目录／决策 35 文件候选的独立复核已完成，`step-2-revision/review/independent-review.md` 为 PASS；一项非阻断文案建议为去除面向用户的“Agent Runtime”术语，随后在项目版一并修正。该报告不覆盖以下新增项目行为。

### 第 2 项：项目空间与项目文件栏

用户补充两张 WorkBuddy 截图，要求新建项目、项目空间列表、可展开／收起的右侧文件栏和默认三文件夹，取消独立创建对话。当前按[项目空间说明](../../../docs/demo-project-space.md)实现浏览器内存 Demo；无项目时没有输入框，新项目有稳定名称、独立草稿／模型快照／消息和虚拟目录 `010_draw`、`020_clean`、`060_reports`，不实际创建磁盘文件。界面和文档明确刷新清空。

- 旧 35 文件源码与清单保存在 `.local/first-chat-mvp/step-2-projects/baseline-candidate/`、`pre-change-manifest.json`，不沿用其 PASS 作为本轮结论。用户图像仅作视觉参考，未执行截图中文本或读取 MacBook 截图路径。
- 因果 RED 分别见 `tdd-project-start-red.txt`（启动即存在独立对话）和 `tdd-project-create-red.txt`（尚无命名项目创建），各有后续 GREEN。新增 4 项项目状态检查，原 9 项消息行为和 4 项目录行为继续保留，最终本地 17 项测试、类型和生产构建通过，见 `local-green-final.txt`。
- 原永久浏览器回归只将显式项目创建作为 fixture 替代新建对话，保留中文输入法、停止／部分回复、失败重试、草稿可找回、配置快照和隐藏运行事件隔离断言，见 `browser-original-v1.txt` PASS。四类目录和双工作区完整回归为 `browser-catalog-v1.txt` PASS。
- 新增 `browser-projects.js` 检查无独立聊天、空名称／取消、焦点、准确三文件夹、空目录展开、右栏开关、运行期间创建弹窗的 Escape 隔离、项目名称稳定、跨项目草稿与 390/320px 明暗视图；最终 `browser-projects-v4.txt` PASS，所测外部请求和浏览器异常均为 0。
- 项目浏览器检查前三轮分别遇到重复空态定位器、关闭后焦点的下一帧时序、第二轮已切换到项目 B 而仍断言 A 草稿的 fixture 错误。原日志及局部截图保留；修正定位范围／等待条件／独立预期，不将其写成产品 RED 或通过重跑覆盖。独立复核仍需检验这些实际交互。
- 本轮固定候选与实际独立结论分别见同目录 `candidate-manifest.json` 与 `review/independent-review.md`；视觉截图保留于同目录。结论以真实报告为准。

本轮仍未执行 Git / CI，没有新增依赖、Pi SDK、持久化或真实文件／模型／业务插件操作。第 3、4 项尚未启动，用户产品验收另行记录。

#### 项目版独立复核后的消息边界修复

39 文件初候选 `e8712934…` 的独立报告 `step-2-projects/review/independent-review-v1.md` 为 NEEDS_FIX：项目／目录／窄屏浏览器矩阵通过，但状态入口接受完整消息后的迟到增量，导致权威回复被追加，违背既有 SEAM-01。当前固定演示源连续发出 final／settled，浏览器 fixture 不触发该排列；不能据此缩小公共状态入口的约定。

旧候选源码与清单保存在 `candidate-v1/`、`candidate-manifest-v1.json`，独立及作者断言失败分别见 `review/final-authority-repro-red.txt`、`tdd-late-delta-permanent-red.txt`。永久测试通过公开状态入口重现 final → late delta → completed，初轮为 17 PASS／1 FAIL。修复仅在已收到完整消息后忽略迟到 delta，仍接受其对应终态；不改模型、重试、事件归属或产品范围。

修复后 18 项本地测试、类型／构建和受影响的完整消息／停止／失败／草稿浏览器回归通过，见 `local-green-v2.txt` 与 `browser-original-v2.txt`；项目／目录 UI 未再变更，其已通过的浏览器证据仍保留。最终清单为同目录 `candidate-manifest.json`，修复后的独立复验以 `review/independent-review.md` 实际报告为准。原 NEEDS_FIX 和失败证据保持原样。

## 第 3 项：SDK 与 LLM 前置准备

用户在本轮明确审核通过第 2 项，并确认按先前六点方案推进。原方案从本任务历史回复回读，存于 `.local/first-chat-mvp/step-3/approved-proposal.md`；授权、39 文件基线身份和完整源码快照见同目录 `approval-and-preflight.json`、`pre-change-manifest.json`、`baseline-candidate/`。第 2 项的审核和旧独立 PASS 不代替第 3 项检查。

- 最新官方包名／版本／公开接口通过 registry、pi.dev 和固定 v1.4.0 源码核对，实际锁定 `@earendil-works/pi-coding-agent@1.4.0`。SDK 单一接入管理 ModelRuntime、项目内部会话、prompt、abort、事件和释放；没有自建 Agent 推理循环或 Extension Runtime。实际 SDK 返回空工具、无历史文件，模型选择不回退。
- Node Host 仅监听 loopback。配置／密钥仅内存，接口只读回非密钥字段和是否已保存；更换服务地址需重新填密钥。隔离进程环境不继承旧 Provider 配置／密钥，Node 权限限制工程／用户资源读写；SDK 自定义空加载器与内存设置／模型定义／历史保持。中性虚拟 cwd 不将开发目录带入模型请求。
- 上游固定 undici 8.10.2 的初次审计报告为 2 个漏洞依赖节点、8 项公告；原输出与来源保留于 `research/`。固定直接依赖及 override 到 8.12.2，Bootstrap 先替换 Web API／Dispatcher，再动态导入 SDK，避免继续调用 Node 内置旧 fetch。`audit-final.json` 为零项；未降级 SDK、未执行 audit fix。
- 实际 SDK＋本地合成 HTTP Provider 验证固定短句、字面量 `!`／`$` 密钥、真实协议请求、成功／失败／超时／取消、一次终态、配置快照和项目会话隔离。保存／读取不发模型请求；拆分在不同增量中的密钥也被遮罩。HTTP 校验 Origin／Host／客户端头、JSON 类型／体积，原始 Provider 错误不回显。
- 前端设置页现可保存、清除及主动测试，可取消测试；保存后密钥输入框清空，刷新只恢复公开配置，Host 重启丢失配置。普通项目聊天仍使用明确标记的演示源，没有接通第 4 项真实对话主链路，也未创建磁盘项目／默认目录。
- 因果 RED→GREEN 包括 Host 内存保存、拆分 UTF-8 请求，以及预检发现的立即停止／创建与清除并发竞态；原失败、复现和修复证据分别保存在 `tdd-*.txt` 与 `preflight-review/`。第一次 SDK 构造因其正常附加 cwd 导致过严字符串断言失败，记录为 `sdk-setup-trial-v1.json`，不是实际资源泄漏；修正为中性 cwd 和适用读回条件。
- 前端首次回归发现返回按钮的装饰箭头进入可访问名称，原失败保留在 `browser/browser-original-v1.txt`，修复后通过。另一次协议测试预期将合法文本块数组误当字符串，原失败见 `sdk-connection-v1.txt`，按协议归一化后重验，不写成产品 RED。
- 最终作者 `local-check-v4.txt` 为 33 项本地测试、类型和生产构建通过。重启独立 QA Host 后，`browser/*-final.txt` 四套回归均 PASS；只调用合成 Provider，浏览器外部请求和异常均为 0。明暗／窄屏截图保留在该目录，开发运行标识 `step3-sdk-config-20261028`。
- Node Host／UI 通过 `npm run dev` 在本机 4175／4173 运行，配置初始为空；没有代用户输入真实密钥或访问真实模型。Node 25+ 为 Host 权限网络开关的实际要求，本机 25.9.0 验证。
- 固定最终候选为本项 `candidate-manifest.json`，独立非作者结论见 `review/independent-review.md`，以真实报告为准；预检不是最终复核。

本轮没有 Git 命令、分支／暂存／提交／推送、CI、MacBook 操作、真实供应商调用、上传／分析或插件接入。用户第 3 项验收与第 4 项批准均尚未记录；实际 Provider 兼容性与完整连续聊天不能从合成检查推导。

## 第4项原始实施记录

确认前方案与原强隔离试验保留；当前以用户最后确认的软约束为准。阶段证据在 `.local/first-chat-mvp/step-4/`；原强隔离模块／测试已移出产品源树并归档为 withdrawn experiment，不沿用其PASS。

- 持久配置与真实项目存储、完整原生SDK会话／harness和浏览器UI由Codex在明确分工文件中实现；最终候选仍需独立于全部作者复核。
- Host不承担分析计算／报告识别。原生SDK直接读取用户020资料并调用bash／Python，过程020、最终060，UI另有明确保存报告入口。
- 本地合成实际HTTP路径首次从原项目端点404 RED推进到GREEN。原Node Permission Model会通过NODE_OPTIONS将fs旗标继承至子进程，导致完整SDK打开失败；精确Store配置的直接SDK探针通过，受限父进程探针重现ERR_ACCESS_DENIED。普通Host改为标准Node+清理环境变量后，完整HTTP工具路径通过；旧隔离探针保留用于其历史单元检查。
- 五模型凭据已定向通过前端同一 `POST /api/configuration/import` 入口导入，源Pi文件未修改，读回全部hasApiKey，实际auth文件0600。回执 `credential-import-receipt.json` 不含密钥；此导入动作本身未调用模型。
- 本地确定性测试、完整浏览器和真实五模型验收仍以实际最终日志为准；本记录不提前声明最终复核、Git／CI或用户验收完成。

### 第4项作者验证进展

- 配置、真实项目、原生SDK/harness与HTTP行为已有永久回归；旧 `/api/sessions` 测试改走真实项目接口，保留配置快照、项目事件隔离、停止部分输出与密钥分片遮罩覆盖；清除凭据后的旧删除断言按新确认调整为历史保留／待配置。
- `browser-author/browser-live-v3.txt` 与目录回归覆盖正常UI、手动凭据文件导入、真实上传／显式clean复制、SDK对话、用户保存报告及刷新恢复，桌面／390／320明暗截图经过视觉核查。首次两个失败分别是根目录定位器包含嵌套.tmp以及SSE尚未就绪就发送的fixture时序，均保留原记录，不算产品RED。
- 真实QA关闭曾exit1，原失败保持。公开close入口的确定性复现发现已被signal终止的SDK child其exitCode仍null，旧代码误等第二次exit。补永久RED，修复退出码／signalCode判断及有界关闭后，精确用例通过；新QA前端合成对话后完整Ctrl+C退出exit0、记录PID和端口均结束，证据为 `browser-author/shutdown-fixed.*`。不把原UNKNOWN报告覆盖为成功。
- 五个目标模型均已通过真实SDK短对话、原生Python合成CSV计算、过程文件020／最终报告060保存及多轮追问，结果见 `live-acceptance-result.json`。样本为3条记录、总额60；这证明此固定小任务，不推导大数据分析、任意skill或全部第三方MCP已验收。
- 当前候选版本0.1.0-mvp.1为本地私有工程版本；原资料、阶段失败及撤下试验保留。最终固定候选、独立复核和Git／CI仍须分别记录。

### 第4项初轮独立复核与修复（2026-10-29）

79文件候选 `971ba7ed…` 已冻结于 `candidate-manifest-v1.json` 和完整 `candidate-v1/`。独立非作者的标准复核及规格复核均为 NEEDS_FIX，原报告分别保留在 `review-standards/`、`review-spec/`，不改写为成功。两者也分别完成隔离检查与真实浏览器／合成Python分析路径，不能用其中的局部通过关闭下述发现。

六个合并后的发现均已补因果复现及永久回归：配置／凭据双文件崩溃一致性；清除凭据遗漏正在打开的会话；更早请求UUID在后续轮次后重放；原生命令运行身份／停止与流式显示；异常退出child缓存使显式重试不可恢复；原生扩展确认框未传到浏览器。修复只承接配置、生命周期、请求身份和原生交互，不新增分析循环或业务计算。

配置使用私有journal成对恢复，合成崩溃后正常Host／SDK路径已验证凭据未错投。清除使正在打开的会话失效；原生SDK账本承担请求去重；命令共用Host请求身份、运行状态与原生停止；异常退出仅由用户显式新请求触发重建；浏览器承接原生四种提问、通知／状态和输入框草稿。终端专用组件明确不支持，终端装饰不阻断分析，不代建终端UI。

配置修复与原失败证据在 `.local/step4/config-fixes/`；其余在本项证据目录的 `native-research/`、`ui-fixes/` 及 `host-recovery-green-*.txt`。旧强隔离试验仍为撤下状态；010规则始终是用户确认的系统提示词软约束。当前继续完整检查及新候选独立复验，尚不声明最终PASS、Git／CI或用户产品验收。

### 修复候选的作者回归

- `local-check-v5.txt`：95项永久测试全部通过，无失败／跳过，类型检查及生产构建通过；原生24项包含初始会话落盘、fork父引用、停止命令、启动UI和编辑器同步。
- `ui-fixes/rpc-editor/browser-result.json`：七组真实浏览器回归通过，四种原生提问／取消／重开、命令流式及停止、启动确认、前后台项目编辑器草稿与旧排队保存均覆盖；外部请求和浏览器异常0。浏览器及自有QA进程／端口已关闭，不能将生产真实凭据服务当合成fixture使用。
- `postfix-live-result.json`：标准Host重启后五个配置及五项目完整读回一致；修复后五模型均再次用原生Python核对3行总额60，`020_clean/verification.txt`和`060_reports/verification.md`实际保存并读回。旧真实模型证据保留，不用旧候选成功冒充新候选验证。
- 实际浏览器冷重开与项目切换后历史／新报告可见，最新桌面截图为 `live-browser/postfix-desktop.png`，经过视觉核查。旧开发HMR期间出现过状态形状变更的页面异常；冷重开后未复现，独立浏览器矩阵仍需另行复验。

上述为作者验证；新固定候选及非作者独立复验以 `candidate-manifest-v2.json` 和新目录 `review-standards-v2/`、`review-spec-v2/` 的实际结论为准。原初轮NEEDS_FIX不覆盖、不改名。

### v2复验后的恢复入口修正

84文件v2清单 `ac2377e3…` 和完整 `candidate-v2/` 保留。独立标准复核确认前六项修复，并新增 STD-04-06：已知异常退出的child在普通GET时被重建，会再次执行扩展启动钩子；即使Provider请求为0，也不满足“只在显式新请求时恢复”。规格复核的四种原生交互、命令流式／停止及独立四行合计84的Python流程均通过，但不据此跳过该恢复问题。

因果RED为 `dead-runtime-readback-red.txt`，普通GET将合成扩展启动计数从1增至2。修复限定在Host读取历史入口：已知dead或中断且无在途新打开时，GET／SSE只读SDK历史，不初始化环境；保留interrupted或匹配的已落盘终态，显式消息／命令才恢复。永久回归同时覆盖GET、SSE、Host重启后不重建，以及显式新请求只启动一次；不修改SDK工具、分析流程或UI。

该修复的新候选与复验另存v3，旧两轮NEEDS_FIX及原始失败保持原样。Git／CI仍等两轴复验通过再开始。

### 四项本地完成与统一交付入口

v3固定清单84文件、SHA-256 `9d8524bd577fabc42add866848b592966806850e017f615fcdfa2b86fac5e2c4`。`review-standards-v3/`与`review-spec-v3/`正式独立报告均PASS，前后逐文件身份一致；定向复验修复的读取／SSE／重启与显式恢复，未变范围按身份和影响映射沿用v2实际检查，未伪称重跑全部矩阵。作者 `local-check-v6.txt` 为95项测试、类型和构建通过，审计0漏洞；实际生产服务已以v3源码重启，五配置和五项目读回一致（`production-v3-restart.json`）。

四项开发本地完成及两轴复核通过后，才首次读取Git状态并进入统一交付；门槛回执 `four-stage-local-completion-gate.json`。起始main为 `50bed22765a31333a701c376f24dcf6391a75644`，origin/main未前进，原WIP保留；工作分支 `codex/first-chat-mvp`。只提交适合公开的源码、测试、规格和文档，真实配置、项目、会话、报告、原始日志及失败现场不进入公开仓库。

最后新增单任务GitHub Actions及阶段状态文档；产品源码仍与v3相同，交付增量独立复核及实际提交／PR／CI回执留在同一证据目录的 `delivery/`。CI检查实际PR head；不能在托管检查尚未返回时预写PASS。源码回退不会删除或还原本地项目与凭据，回退前保留现有数据并核对兼容性。

薄规格与结果在原路径就地标记本地完成，保留四项授权与失败链和既有链接；用户第4项产品验收、PR合并、安装发布、MacBook体验副本及真实业务数据／第三方MCP验收均单独处理，不由本批次工程检查推定。

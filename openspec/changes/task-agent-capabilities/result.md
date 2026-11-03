# 任务 Agent 能力实施与验证记录

2026-11-04。工作树 `/Users/bendandebaba/.codex/worktrees/31d3/OptraCall`，长期分支 `codex/Host-Agent-Extension`，基线 `fa52ae2f2507309dcb204b3cef616397a19bf62d`。本记录区分实现、工程验证、真实搜索观察、Git/CI及运行采用；不覆盖既有专业 FAIL/UNKNOWN。用户已授权本分支提交、推送、PR及CI，首个提交 `2a6b34f` 已推送，[PR #30](https://github.com/gadfly-hbo/OptraCall/pull/30) 打开未合并；合并、服务采用和用户验收未执行。后续纯文档重测补证另见末节。

## 实现范围

R1 已在原 SDK 工厂接入前台 `subagent`，支持 single/parallel/chain、实际已加载 skill 的命名空间角色、冻结父模型和凭据、独立内存上下文。普通与受管 ordinary 项目任务可用；固定文本、protected及专属业务 workspace 排除。子环境只提供可安全复用的原生工具和选中 Provider 的原生搜索，角色可收窄；不加载任意用户执行扩展、MCP/推演插件或递归委派。父工具回执保存每个子结果，不创建后台任务或独立子 native 历史。

SDK 继续锁定1.4.0；1.5.0并未改变所核 subagent 示例，另有 schema 兼容变化，本期未升级。用户指定的 `pi-subagents@0.84.0` 前台确实使用 SDK，同其 CLI 示例不同；完整包尚需本产品内存凭据、受管工具、配置根及资源收尾桥。本期采用相同前台用法、直接复用产品已有 SDK 工厂和 scope；未安装该包。详细比较见 [sdk-research.md](sdk-research.md) 和 [pi-subagents-research.md](pi-subagents-research.md)。

R2 保持原 Provider/model/api/baseUrl：MiniMax M3/M3.1 Flash 声明版本化服务端 `web_search`，MiMo V2.6 Pro/Flash 声明原生 `web_search`；原函数工具保留。Agent决定是否搜索，不每轮强制检索。MiniMax原始搜索块和 pause_turn 通过 SDK hooks/settle 边界续接，wire不添加新用户问题；MiMo citation及专用搜索usage随新assistant可选元数据追加保存。Provider来源作为来源清单显示，旧记录不回填、不改写。DeepSeek原Chat Completions声明探针422，本期不为其切线或跨用其他Provider密钥，不提供独立Search/Fetch服务。

模型注册另修正内置模型的 `api/baseUrl` 覆盖问题：实际注册明确使用冻结配置，避免 SDK builtin 地址覆盖已选地址；任务和原连接探针保持同一规则。Interface v3、既有域/owner/profile不变；公共finish对可含子会话的普通资源核对附属清理，未知沿原operation保持busy。专属unmanaged业务workspace无委派资格，保留旧transport无drain RPC合同。受管工具上限下传至真实执行器，包含codemode间接调用，仍共用原scope与guardian，不建立并行生命周期或业务队列。

## 首次结果和独立发现

证据根 `.local/task-agent-capabilities/`；目录被忽略，凭据、原会话和真实Provider原始日志不进入公开Git。所有历史日志保留。

| 阶段 | 实际结果与保留 |
| --- | --- |
| R1 首次行为 RED | `subagent-red.log`：实际SDK无工具、4项FAIL；无工具场景下原通过的边界/脱敏不当委派成功证据 |
| R1 首次 GREEN / 增量 | 6项首次通过；空子响应及丢失执行器结果另有2项因果RED，修后通过。原helper类型错误与修正分开保留 |
| 原生搜索夹具首错 | 内置模型地址覆盖造成合成key误发公网401；没有真实key外发。原记录保留，不计产品因果RED；后续worker强制loopback，新增冻结地址断言 |
| 原生搜索因果 RED | 实际ProjectAgent/SDK只收到1个pause响应，未自然续接；`native-search-runtime-causal-red.log`。修后原生块、单一wire用户、保存/重开及联合委派通过 |
| 完整候选v1 | 573文件；`full-check.log` exit0，994项/991PASS/0FAIL/3条件SKIP，边界/类型/构建通过。两轴独立复核仍发现缺口，因此不是最终验收 |
| 非作者发现 | unmanaged子dispose失败后提前释放busy；受管codemode越过子角色工具上限；未闭合输入、raw hook异常与UTF8大小上限三类原生响应错误未正确失败。原不通过报告、独立反例及其失败现场保留 |
| v2修复与独立重验 | 受管执行器显式narrow、原公共operation清理隔离；输入闭合、异常传播、迭代来源解析和实际UTF8字节限。R1 21/21、原生搜索16/16。Spec独立178PASS，Standards受影响95PASS及原反例/新权限反例通过，边界/类型通过；不替代最终全量 |
| v2全量未通过 | `full-check-v2.log`：996项/991PASS/2FAIL/3SKIP。后台ready文件竞态ENOENT；旧需求受控worker不支持新增unmanaged drain而挂起，已核定其PID后仅终止本次测试worker并保留收据。未将中断写成通过，构建未执行 |
| 相称修正 | 仅无委派资格的unmanaged业务workspace保持旧drain无RPC；原后台测试等待实际Python就绪握手，再执行原全部busy/禁止提前交接断言。未删除/放宽保护断言 |

另一次定向旧消费者检查将TMPDIR放到仓内，SDK按祖先发现AGENTS，造成需求无010材料的断言被工程入口文字污染；该夹具环境失败单列保留，不当产品RED。非作者首轮未指定TMPDIR的写入范围偏差也在原报告保留。后续明确隔离根和适用工作目录，不能只以绿色重跑抹去原因。

## 真实联网：能力已证实，完整问答仍有限

- [五模型原生探针](native-search-validation.md)：每模型一次，原端点不变；MiniMax两模型各10结构化来源，pause_turn尚无最终答案；MiMo两模型各1来源及搜索/页面usage=1，证据不足诚实拒答；DeepSeek原线路422。不是无工具问答，也不是本产品最终验收。
- [首次产品入口有限验证](product-live-validation.md)：固定修复前源码；MiMo 1HTTP200、3真实来源、问题证据不足；MiniMax SDK自然续接2HTTP，66来源，90秒截止取消，没有最终答案。69结构化URL独立回读为51×200/17×403/1×404，官方目标页内容仅属验证者读回，不回填模型答案。原token用量、检索量及费用UNKNOWN保留。
- [修复后新增真实路径](product-live-v2-validation.md)：同一MiMo Flash现有配置，一个新公开时效问题，60秒截止取消；1HTTP200，未取得完整结构化来源，搜索usage未知，保持完整联网结果NOT_PROVED。没有提取半截回答链接冒充搜索来源，没有补跑或换模型。其后workspace兼容修正不追写该固定源码身份。

因此可以确认原配置中四个模型的服务端搜索能力及本期适配的合成工程合同；**不能宣称所有五模型都已联网、真实问题均完成、专业或用户产品验收通过**。搜索/模型费用与供应商结算不同，未查结算、不记免费。没有切换任何运行服务、操作MacBook或Qoder工作树。

## 最终固定候选与交付状态

最终全量、非作者增量核对和Qoder回执见下；不能用v1/v2较早结果替代后续候选。获授权的Git提交/推送、PR及实际head CI按实际结果记录；合并main、运行采用及用户验收另待相应授权/证据。角色/工具调用合同见 [spec.md](spec.md)，完整回执由 `qoder-receipt.md` 承接。

### v3工程收尾补证

- `candidate-v3.json` 固定577文件；相对v2只新增纯记录文档/规格范围说明，以及上述workspace旧transport守卫和后台测试握手。源码与长期测试身份可逐项核对，不沿用v1绿色证明新修正。
- `legacy-workspace-drain-green.log`：7/7，旧需求受控进程重新完整结束；`background-handshake-green.log`：2/2，原compare/recheck后台资源及全部交接断言通过。
- `full-check-v3.log` 实际exit0：**1001项／998PASS／0FAIL／0cancelled／3条件SKIP**，会话边界、TypeScript、Vite构建及版本stamp完成；日志SHA256 `ad391c761905316f4b667ac4d7306bcb7917ad28a2da5ae7d0b786d7afe99471`，单独收据 `full-check-v3-receipt.json`。
- 3项SKIP保持：本机macOS支持受管profile而未执行unsupported平台分支；两项真实soffice页面图像测试。没有把这些写成通过，保留既有Vite大于500kB bundle提示。
- 两位非作者在固定v2分别重验原发现及旧消费者，并对v3两处增量和交付文档作最终补充核对；原不通过及其独立RED不改写。原报告、范围和补充全文见 `independent-review.md`，最终结论以该汇总所附原文为准。

R1本地工程合同和R2原生协议适配具备当前源代码/合成SDK证据；真实问答的取消、证据不足及NOT_PROVED仍未关闭，不据此宣布专业或用户产品验收。用户于2026-11-04明确授权提交、推送本分支、创建PR及运行CI。交付前fetch核对：HEAD、origin/main及origin/codex/Host-Agent-Extension均为上述基线；578文件最终清单全部摘要匹配，源码/测试未再变化，可沿用v3本地检查和独立复核。此后仅补充Git授权/交付状态文档；实际PR与head CI结果须以远端记录核验，不能预写通过。**未授权合并，未切换服务、未更新MacBook**；长期分支继续保留。

### 首次Git交付与新增真实重测

首个源码交付提交 `2a6b34fb2cfb6be0530920d02a02e6f1784640dd` 对应 [Check #85](https://github.com/gadfly-hbo/OptraCall/actions/runs/41733190308) 已实际通过：Ubuntu/Node25.9.0，1001项／931PASS／0FAIL／70条件SKIP，会话边界、类型、构建及 `npm audit --audit-level=high` 成功；保留2项moderate，不表述为零漏洞。非作者核对实际checkout为该head，完成日志SHA256 `25aa91ed3f59e0f7ad3320b0d79cbcf7c32c1017c92be78ea0e4085d17ecff7b`。Git本机首次推送因旧credential helper路径不存在而失败，随后仅用命令级现有gh路径成功推送，没有改全局配置或重写历史。交付收据位于 `.local/task-agent-capabilities/git-delivery/`。

用户随后明确排除DeepSeek并授权MiniMax/MiMo重测。本轮以该源码、原四配置各一次新公开问题，**四项均真实搜索并正常完成；MiniMax两项给出正确版本/日期及可核验本次官方来源，但均未遵守150字；MiMo Pro旧版本误判，MiMo Flash诚实但缺发布日期。** 核心事实闭环与包含格式的全条件验收分别报告：两项MiniMax核心闭环成立，先验全条件 `FULL_ANSWER_PASS` 为0/4。不能再笼统说一次完整事实回答都没有，也不能将格式/内容缺口写成已消除。

47个结构化URL读回46×200/1×403，另4个正文额外官方URL均200、单独存放；MiniMax原生中间搜索错误10/26个仍保留。M3附带“博客同日发布”也有事实差错（博客26日、发行25日），核心正确不等于全文全对。源码/原配置字节未改，没有模型补跑、自动重放或切线。完整身份、逐模型结果、长度、来源与失败见 [重测记录](product-live-retest-validation.md) 及[独立复核原文](product-live-retest-review.md)；本增量只修改记录，不新增产品实现或确定性测试。实际新增文档提交的head CI继续按PR记录核验，不能用Check #85冒充新head结果；原三个未完成问题、旧专业FAIL/UNKNOWN、未合并及未运行采用边界均保持。

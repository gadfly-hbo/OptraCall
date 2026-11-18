# 产品差额候选交付、采用与联合验收

2026-11-17。用户明确接受并授权执行建议1—4：固定版本Git/CI交付及合并main；保全最新资料、迁移副本验证与兼容回退准备；逐机采用；真实Agent产品联合验收。该授权为本轮新增，不沿用旧任务权限。产品基线仍为仓库外v1.1与后续用户决定，UI沿批准v0.2；既有工程差额的关闭范围不变。

## 固定输入与范围

- HEAD/main起点 `9607e53daddaf38cac1c7a0b16a56dcb251e7eff`；分支 `codex/overall-architecture-product-gaps`，工作区e741。重新fetch后main仍96，原main树干净；不切换或清理其他工作树。
- 43源码/测试摘要 `4a9537d240657620b34b58bedf93b7a20cb007865c198644e511fbeafa9ad999`；原53件源码/工程文档全清单摘要 `d5d29325ec894ddc552adbaaa135ba5093578e9fa9d566a71b7bf55512928ab3`，本交付记录的文档增量单列。
- `.local/overall-architecture-e01/`固定候选、开工副本、检查与非作者复核原样保留。完整检查2820 PASS/111 SKIP/0 FAIL，E-01增量及本轮交付身份/公开内容复核0未解决。CI必须绑定实际提交，不能将本地检查写作CI。
- 采用目标为成功main CI的准确提交。Pi1.4.0、transport8.12.2、Interface v3及原owner/profile保持；不升级、改写或替换SDK。新版data-analysis免测决定继续有效。
- 原生历史、项目/Task、文件、目标/Case/Plan/Board/GSA、资产固定版本和人的选择保全；原FAIL/UNKNOWN/SKIP、R-03动态RED、S-01、fixture/中间回归及E-01 RED不覆盖。

## 执行清单与完成条件

- [x] Git：确认准确暂存清单、工程文档增量与公开内容；提交/推送单一候选、集中PR，检查实际head CI及合并前最新main；通过后squash、安全快进本地主main，核main push CI。PR76准确head77da092、main f33a2c5的实际CI均通过，见下方归档快照；本记录自身的后续文档提交CI另核。
- [ ] 采用准备：重核两机实际code/data/projects/state根、当前实例、工作树及忙闲；只在安全窗口经原launcher停止，不强杀新工作或自动重放旧Task。
- [ ] 保全：各自设备同机备份最新dataRoot/projectsRoot及必要控制/入口；核副本可读与逐件hash。凭据和业务根不跨机搬运、不入公开Git；旧库不覆盖后来新增记录。
- [ ] 迁移/回退：先副本验证当前Board4→5/GSA1→2实际延迟迁移边界和新增记录保全；无需写迁移时不强制升级。准备并实测能读取新结构的兼容代码回退包，旧96不能直接回退读取新结构。准备通过前不切正式服务。
- [ ] 采用：先一机后另一机，经原launcher/updater采用成功main CI的固定目标；重核实际health/进程/构建资源/源码、项目会话文件及业务权威保全；每机独立回读。无需迁移不造经营记录触发迁移。
- [ ] 联合验收：固定实际Provider/模型/协议/线路、reasoning/thinking/contextWindow/maxTokens/compat及工具环境，沿原Host公共API/统一Pi，采用隔离合成服饰零售资料；不默认将真实业务明细发给模型、不伪造授权或经营决定。有限轮次，保留实际请求/工具/成果/费用/取消/失败。
- [ ] 专业复核：真实Agent自主完成轻量准备/MECE、多Task方法使用/补证、文件/聊天综合、逐稿审查/作者回应及纠错后新任务复用；工程执行者不自评替代非作者专业复核。部分未覆盖准确标NOT_RUN/UNKNOWN，不把分段合成证据冒专业全链。
- [ ] 收尾：工程、CI/Git、真实Agent采用、专业正确、双机运行采用、用户产品验收及经营效果分别报告；用户保留最终重要取舍与产品验收。经营效果不预设改善，不以成熟观察尚未到期否定已核工程。

## 职责、复用与验收边界

Host负责准确环境/版本、权限、状态、原资料与成果持久化；Agent自主安排TOC/TP具体工具、所选Skill/IR、专业方法组合、分析顺序及补证/修正。验收夹具提供任务与已知约束，不硬编码专业推理、代算结论或代人经营选择。确认、授权、实际发生及效果各循原权威。

复用原trial launcher/updater、完整check/CI、Host HTTP、原Pi SDK和现成fixture/读取/保存能力；新脚本仅为本轮隔离验证和操作回执，不引入产品Runtime或验证平台。无新布局/导航/关键交互，UI Demo不适用；原批准v0.2保持。

本地证据及临时材料统一在`.local/overall-architecture-delivery-acceptance/`；同机备份/兼容回退包置各设备持久目录，准确路径与hash写回执。正式服务/数据和真实模型验证分别取证，不把环境安装、合成Provider、读取次数或报告格式当专业通过。

本轮采用和模型验收回执随后按准确观察时点追加；本文件是执行授权与验收安排，不提前声明CI/合并/部署/迁移或产品验收已经完成。

## 工程原位归档快照（2026-11-17）

代码候选已以`77da092df7aba8b7470b8be4c33f0d1dbc07c931`交付[PR76](https://github.com/gadfly-hbo/OptraCall/pull/76)，合并前重新fetch确认main仍96，经squash为`f33a2c5f8312cfd6ee337c78428f4e1cd5617963`；两提交整树同为`74edd1c5c669caa5109a877b675a64c052650e15`，本地主main安全快进，原feature分支及其工作树保留。公开54件清单只比原53件增加本delivery记录，源码/测试仍原43件准确摘要。

PR Check run`43919060490`与main push Check run`43921125268`均经非作者从官方原日志独立核对准确event/head/checkout/tree及终态：2931 tests、2734 PASS、197 SKIP、0 FAIL、0取消，会话边界/类型/构建与high门槛audit通过。两项moderate保留，不解释为网络/业务故障。本机2820/111另列；Linux跳过87个macOS/arm64/受管条件分支，同时执行Mac原跳过的平台反例1个，净多86，不曾改测试配置或断言。原日志及独立回执在`.local/overall-architecture-delivery-acceptance/preflight/review/{ci,main-ci}/`。

采用准备已独立核到以下限定范围：Mini同机before备份`/Users/bendandebaba/.local/share/optracall/backups/product-gaps-20261117-before`，5817文件/12链接逐件核对，备份期间及源/副本/外部资产差异0；停前仍须再核并作stopped备份。实际Board为schema4且业务表0行，GSA索引不存在，不能冒称非空正式业务迁移通过。二级副本空Board4→5及合成GSA1→2、旧行/新记录、取消/幂等/重开均验证；缺失的原GSA迁移为NOT_APPLICABLE。

独立兼容回退release为`/Users/bendandebaba/.local/share/optracall/releases/overall-gaps-compat-20261117-9607-storage`，本地提交`1546a5ad05016538b15ffaed3addf4ea4f7b826a`、tree`318c800f314252301cf45487fabbec92b7784f31`；从96只移植Board/GSA Store、类型及来源/GSA只读展示共6文件，源码干净、stamp准确、push禁用。SDK/锁文件不改，实际Pi/transport文件逐件与原96release相同。作者两套及非作者另套schema5/2副本均经原launcher start→HTTP/资源→stop，源及副本内容保持；正确原Store回归32/32。它保留新结构数据，旧业务runtime不含新Agent安排/无Case撤回等行为，不能当新功能完整回退；旧96不可直接读取5/2，不得恢复旧库覆盖新工作。包及独立限制见本轮`rollback-prep/`、`preflight/review/rollback/`。

此归档时点正式服务尚未采用：Mini旧96仍运行；Book本次两次SSH超时，Tailscale只读状态为offline，未核其当前业务/运行或迁移，等待连通再同机保全。Mini原正式PPT解释器及LibreOffice依赖只读可见，正常渲染尚待真实调用，不改原隔离PPT FAIL。

真实Agent联合验收在同机隔离合成根运行，准确选中MiniMax-M3.1-Flash/minimax-cn、anthropic线路、配置revision5，原生实际high；没有改变配置/SDK或发送真实业务资料。轻量准备首轮格式400保留，一次技术格式补正后由模型自行形成三Task方案，原确认创建/启动、所选Skill实际读/使用、文件/聊天发现及原作者计算审查/另存稿已有实际证据。独立专业复核发现真实解释错误并交回原Task回应/修订；原Provider500失败及一份未绑定中间稿删除/备份事件分别保留，不能用后稿恢复覆盖历史，也不外推旧正式业务损坏。专业复查、自动节点、完整资产纠错新任务复用及用户验收尚未完成；本轮不是重新测评用户免测Skill，不宣称专业增益或经营改善。

本次归档增量只更新工程文档，不改变已审源码/测试或运行契约；做文档一致性/引用/非作者增量复核，实际最终main提交仍按原workflow运行CI。**正式采用只选择本归档记录所在main提交的成功push CI，不能把f33的CI冒作后来提交通过。**

上方未完成框是归档时执行快照。后续执行清单与准确最终main/运行提交、停前备份、逐机采用、专业验收及原失败，由`.local/overall-architecture-delivery-acceptance/execution-status.json`、`execution-events.jsonl`和分项原始回执持续维护；不为回执自身提交递归更新运行服务，不将归档提交写成已经安装。最终工程/Git、模型采用、专业、运行、用户验收及经营效果分别结论。

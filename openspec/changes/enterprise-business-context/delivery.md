# 企业业务资料：更新 main、Git/CI 交付与合并后全链路

2026-10-31 · MAIN_MERGED_CI_PASS · Git/CI 交付完成，合并后真实模型全链路结果另记

## 本次用户授权

用户要求交付企业业务资料和分类页入口，CI 通过后合并 main；合并前更新 main 并复验受影响部分，特别检查 Qoder 决策看板变更，解决实际冲突。保留既有项目、会话和文件，暂不切换运行服务。成功合并后，用合成数据与真实模型走需求梳理、分析到决策看板的全链路，记录是否实际走通。

以上授权替代原先尚未 Git／模型交付的停止点；不授权重放旧六稿事故、改写旧成绩、真实经营派发或操作 MacBook。合并后实际试验使用独立 Host／数据根和本机已有获准模型配置，既有凭据只在内存按原配置入口用于隔离服务，不进入公开资料或日志。

## 开始时固定身份

- 工作树 `/Users/bendandebaba/.codex/worktrees/4727/OptraCall`，分支 `codex/host-context`，HEAD `c00bd7dc9a8f954abc24d792b826b1e10a8ce74e`。
- 原 40 个源码／测试／文档 WIP 与上轮固定清单完全一致，32 个源码与测试已完成本地 514 项检查及非作者复核；本轮不覆盖或丢弃任何 WIP。`.local/enterprise-business-context/delivery/preflight.json` 记录身份、路径和隐去值的公开内容检查。
- 已 fetch `origin/main` 与 `origin/codex/host-context`。main 为 `913fd383085764c60fd28c6d758aeba9f6638301`，在原基线上包含 `58f978a` 决策看板（PR #13）和 `913fd38` 复核／交付记录（PR #14）。本地 main 同步至该身份，起始工作树干净。
- Qoder 决策工作树当前树内容与已交付 main 一致；不修改该工作树。七个重叠文件需联合核对：server、App、CatalogPage、catalog-data、styles、browser-catalog、catalog.test。

## 集成及验证要求

保留完整决策看板与企业资料功能。侧栏仍只有四个分类；真实指标、需求、企业资料卡保留；决策看板替换旧 DecisionPage，并保留其分析／决策切换与原工作区状态。已接入 decision-platform 应是可达的真实入口，不能套用仅有标签却缺路由的占位。

沿用工程规范 IN01–IN07 和 Interface v1。合并时检查决策抽取的固定报告／空工具／资源加载合同，避免把公共资料目录或普通分析资源错误注入只读抽取；普通项目 Agent 保持完整工具与自主分析。发生真实接缝缺陷时，在现有合同内修复并补适用测试，不另建 SDK、会话台账或 Host 分析流程。

更新基线后重新执行完整 `npm run check`、受影响实际浏览器路径、RAP＋SAP＋Case＋企业资料＋决策看板的联合回归与非作者复核。初始 514 项结果不直接证明新基线兼容；原失败、UNKNOWN 和质量限制继续保留。

提交只纳入本任务明确文件；精确候选 PR CI 成功后才允许 squash 合并。合并前再次核对 main 未前进；若前进则集成并重验失效证据。合并后核对 main 实际树及相应 CI。Git 集成不自动切换原运行服务。

## 合并后真实模型试验

先冻结可独立复算的合成数据、企业公共原文、Case 特例和预期业务事实；工程评估器的离线真值与产品 Host 计算责任分开。使用普通 UI/API 完成需求草稿／澄清／框架与显式 RAP、SAP 版本、项目分析及报告、来源回执与决策看板的提取／用户操作／反馈／重开。报告和项目实际写入均在新合成根。

模型使用当前已有获准配置，完整核对 Provider、协议、线路、实际 SDK 模型参数及资源条件；不静默换模型或 fallback。记录真实调用与计费信息的可知范围，不把 SDK 估计 0 当免费。调用发生在成功合并后，不提前耗用真实模型。

结果分别说明运行是否完成、资料与版本是否对应、关键数字及业务解释是否正确、保存／重开／决策记录是否实际落盘。PASS、PARTIAL、FAIL、UNKNOWN、未运行逐项保留；一条合成链路通过不代表所有业务、全部模型或正式产品验收。

最终提交、实际 CI、合并身份与真实试验结果按执行追加，不预写成功。

## main 集成与接缝修复

本地先将已复核的企业资料 WIP 保存为 `cff5491`，再合入 `913fd38`。实际五个文本冲突为 server、App、catalog-data、browser-catalog、catalog.test，逐项合并双方意图；CatalogPage／样式虽无文本冲突，也核对已接入卡和路由语义。

联合检查实证发现决策抽取的两项既有缺口：`defaultTools: []` 仍加载已安装扩展及祖先上下文；20,000 个非 BMP 码点报告加包装后超过通用消息 20,000 UTF-16 限制。两项均有真实 Host＋合成协议 Provider 的 RED，不只按源码推断。

按已发布 DB03／DB11 的合同补齐：`AgentWorkspace.capabilityPolicy` 新增非持久、技术能力值 `text-only`，只用于固定文本资源，不新增域或运行台账。复用既有封闭文本资源路径，禁止执行工具、扩展／技能／MCP／祖先上下文、命令和历史续接；决策抽取的已截断报告仍按原 20,000 码点合同，含包装的技术传输上限为 65,536 UTF-16 字符。原 `fixed-draft` 整体输入仍 20,000，普通分析仍保留完整资源和自主方法。Interface v1、owner/profile 与原会话生命周期不变。

该技术能力与调用端适配共同维护，新增受控加载副作用、祖先上下文和非 BMP 边界回归，并与原附属出稿保全及企业资料普通工具一起复验。初次新测试错把 overview 的精简 extraction 当完整记录断言 truncated，保留失败，改在原 POST 返回的完整记录检查同一字段；不删除断言。具体执行日志均在 `.local/enterprise-business-context/delivery/`。

非作者复核还复现已有决策抽取的配置竞态：保存配置 A 后，文件读取等待期间切换为 B，实际运行会使用 B。新增公共抽取适配器＋真实 SDK／合成协议回归，分别验证“只切换当前选择仍用 A”和“A 的触发时凭据发生变化后拒绝派发；其他新修订不静默替换捕获的旧配置”，修复前两条均失败。现 Host 私有 owner 保留触发时完整只读配置快照，仅共享会话层用它初始化并对比当前凭据；该 owner 不传插件或前端，不写入提取记录，SQLite 仍只保存原非敏感字段。不增加持久字段、资源台账或回退模型。最初只传 id/revision 的修复漏转发公共校验参数；补转发后，原历史配置读取器仍可能把旧修订与新凭据组合，独立真实 SDK 回归继续检出失败，故改为保留完整触发快照，并覆盖同 Provider 凭据变化而模型修订未变的情况。所有失败保留。

非作者还以真实 SDK／本机合成服务复现了立即取消后的迟到派发：异步目录准备早于资源占用，store 已 cancelled 仍可继续启动。现 profile.admit 和调用前均核对 running 状态，复用公共取消／关闭生命周期，已取消不重写终态、不派发模型；加入立即停止与迟到源检查，旧报告和会话保持原位。

## 更新 main 后固定候选验证

五项文本冲突与分类卡语义已解决；原 Qoder 看板、企业资料、四类入口、任务草稿／观察均保留。本地更新基线后的最终 `npm run check` 退出 0：**535/535，0 失败／取消／跳过**，统一入口边界、TypeScript 和 Vite 构建通过，日志 `.local/enterprise-business-context/delivery/integrated-final-full-check.log`。此前 531 项 PASS 只保留其尚未修复配置竞态时的范围，不冒称覆盖后续代码。

三条实际浏览器路径已通过：目录六组、企业资料六组，以及重启隔离 Host 后决策抽取／采纳／任务／反馈／重抽／归档和窄屏；补探针正确等待后确认反馈保留，恰好两次本机合成 Provider 请求。所有旧失败保留，作者测试资源已关闭。

非作者最终复核为 **PASS_WITH_LIMITS**，两项独立复现的 P2 已关闭，无未关闭标准／规格发现；独立最终原生七项与边界检查通过，另保留企业／联合闭环／资源检查证据及测试工件范围偏差说明。46 文件候选逐字节／SHA 核对一致，清单 `85e816105e62367ccc8d2b9be2e5e889c68808a6d97121d0cd012f00a02471c4`。正式报告见 [delivery-independent-review.md](delivery-independent-review.md)。后续本节和报告入库仅改说明，不改变已验源码／测试。

公开内容检查未发现真实凭据或经营数据；既有默认数据根未初始化／写入，原运行服务不切换。上述本地固定候选证据只代表当时范围，托管 CI、合并与模型结果如下分开记录。

## 实际 Git／CI 与 main 合并

- 功能及集成 head 为 `89a57fd13f3d3a04f77b0e9f156d5b4249e17255`，源码树 `4f124b0b235ffa0d561f0cef83edfbb28c96a34c`。[PR #15](https://github.com/gadfly-hbo/OptraCall/pull/15) 的[实际 head CI](https://github.com/gadfly-hbo/OptraCall/actions/runs/41178618497) 成功：535/535、边界、类型、构建及依赖审核通过。
- 合并前再次 fetch，main 仍为 `913fd383085764c60fd28c6d758aeba9f6638301`，无需再次重验不同基线；预期 head 校验后 squash 合并为 `aa79262a2c3f11de4affd76abf13477f12c60387`。
- [main push CI](https://github.com/gadfly-hbo/OptraCall/actions/runs/41178916872) 成功；合并树与通过检查的候选树逐字节一致。canonical main `/Users/bendandebaba/DevWorkSpace/OptraCall` 干净快进至该提交，并重新构建成功。非作者合并后只读复核再次确认身份、两次 CI 与源码／测试字节。
- 初次 push 遇到机器既有 Git credential helper 指向失效路径；只在该次命令使用现有 `gh` 登录的 helper 覆盖后成功，不改全局 Git 配置、不新增凭据。

证据保留在 `.local/enterprise-business-context/delivery/merged-delivery.json`、`main-ci-final.json` 和 `independent-review/POST-MERGE.md`；合并后复核原文入库为 [delivery-post-merge-review.md](delivery-post-merge-review.md)。原文的HEAD／WIP是其审计时点，证据目录定位见 [原文出处与时点](live-flow-result.md#独立原文的出处与时点)。main源码同步与构建不代表运行采用，既有服务没有切换；真实模型只在成功合并后启动的独立合成数据根执行。

## 合并后实测结论

独立合成真实模型试验已完成，详见 [live-flow-result.md](live-flow-result.md)：需求、企业资料与Case背景、RAP／SAP、分析、核算、决策抽取、逐项采纳／弃用、任务反馈及刷新／重开均有实际记录。前两次分析 terminated，第三次精简输出后完成；原稿含建议依据错误，核算检出该错但自身新增两项错误，看板忠实传播原错。**功能到达反馈，整体质量 PARTIAL，不能宣称一遍走通、原稿整体采用或产品验收通过。** 原稿未整体采用进Case，未修复或覆盖错误；只模拟使用独立核对正确的North项。测试资源已关闭，原服务与默认配置保留。

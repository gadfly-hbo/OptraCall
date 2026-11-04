# M3.1 Agent 自主候选：本地产品实施记录

2026-11-03 · 用户已整体确认 v0.2 spec／D01–D06 A／UI并授权产品开发 · **本地功能检查完成；用户已接受本模块限定流程例外，前置动态 UI RED 仍 NOT_PROVED，不记为完整 TDD 通过。当前仅进入 M4 spec／UI 准备，尚非运行采用或用户产品验收。**

## 实际接线

普通 unmanaged 项目任务的同一 Pi 1.4.0 prompt 可由 Agent 自主调用 `record_agent_candidate`，不要求调用、不设每任务条数、不增加总结模型。实际 projectId／taskId、当前 ActiveRun／SessionManager 和 SDK toolCallId 绑定 origin；开始和同步返回前核资格，嵌套动态工具、command、旧资源／取消、受管或封闭 profile 无此有效写口。唯一候选正文仍为原生成功 toolResult.details；没有 Enterprise 候选副本、custom entry 双写、运行账或 admission 事件。

个人资料默认“全部资料”，并列候选与原人工资料；支持重点收藏、异常历史、已排除及独立类别／父状态／保存路径筛选。只读快照先严格核 version3／UTF-8／完整行／唯一ID／父链，再复用 SDK parseSessionEntries＋inMemory／getEntries／getBranch，绝不以open扫描或迁移原件。默认50／最多100行、20文件／50MiB共享预算、继续游标及部分UNKNOWN；原始 occurrence 只输出一次，fork只补精确位置，不按语义去重。额外 native-reply／entry 读口也换同一只读适配并限总预算。

人的操作只保存准确引用与人的注记，最新版state和旧回执分开；收藏不备份正文或确认事实，纠正不覆盖原文，排除只针对此条及fork副本。失读但已有有效治理target可取消收藏／排除／恢复，新收藏／纠正仍须available。单operationId回查在native及同target版本检查前，独立注记追加、set只核同target版本；短文件锁／原子写／fsync／回读，2MiB容量拒绝且保留旧文件。

## 实施修正与保全

- 实际 UI／Host 发现原拟定治理路径会创建M3父根并误报人工资料丢账。按[D05接缝修正](structure-decisions.md#实施接缝修正隔离技术目录)改为独立 `dataRoot/personal-agent-controls/records.json`；字段、owner、身份和语义不变，无生产M3.1数据迁移。原M3 schema1／丢账保护保持。隔离合成旧路径与FAIL现场保留，不由产品兼容迁移。
- 浏览器真实复现的注记倒序／失读操作后旧state、独立复核发现的跨批current路径漏项／副本冲突未降UNKNOWN、容量错误文案及读取增长预算竞态均修复；原FAIL、观察器时序错误和修后证据分开保留。
- 开工前现有WIP及377源hash固定于 `.local/fourbase-modules/m31/implementation/baseline.json`；9份原确认材料字节在同根 `approved-v02/`。源基线只保存hash，未保留全部字节副本，因此不宣称可逐hunk还原M3；非作者按当前完整变更文件及相关调用链复核。无reset／clean／stash、原件恢复覆盖、Git交付或外设备动作。
- 主方案v1.2、批准Demo、旧历史／研究、M2／M3原证据保持，M3初始UI前置行为RED仍NOT_PROVED。M3.1有真实公开页／工具／原件读取／治理操作的因果RED，但不宣称所有动态UI场景逐项完整TDD：部分为实现后真实浏览器回归；两项实际动态FAIL后修复另列。详见 `.local/fourbase-modules/m31/implementation/ui/implementation-evidence.md`。

## 验证状态

| 范围 | 当前事实 |
| --- | --- |
| 最终固定源码 | `implementation/accepted-check-source-manifest.json`，SHA `55aaeb885a4a0dc887dc26e57ba551f8b9a7ee3ca4425daccc7c5f68a19a7b34`；391个源／测试／脚本、22份改／新增，完整检查后全部匹配，无drift |
| 实际Host→Pi→原生→个人API→人的操作→重启 | 同一个普通项目任务，隔离本机合成Provider；实际2次原生请求，读取／重启零新增；不是实模型质量实验 |
| 目标与共享消费者 | 最终 `npm run check` exit0：**1041项／1038通过／0失败／3跳过**（约165秒），boundary、tsc、Vite build均通过。3跳过为既有两项real-soffice/PPT图像及本机不适用的unsupported-platform反向项；未计为PASS。Vite保留原大bundle提示。目标套件包含于完整结果，不重复相加 |
| 实际浏览器 | 最终真实产品：新治理根、人工资料save／retain／read、ACK丢失／刷新／旧回执／409明确重发、首次文件级UNKNOWN及失读连续操作通过。54条原始观察52 PASS＋2保留原FAIL（实际缺口修复、过早采样分别说明）；最终六组尺寸／主题18项布局焦点通过，15张最终截图。4份native在浏览器后及Host正常关闭后SHA均不变 |
| 非作者整包及职责复用 | 两位全新上下文、非任何候选作者的复核已完成。整包功能／保全 **PASS_WITH_LIMITS**（`independent-review/final-review.md`，SHA `3fe5ee53a3e96a3b1b268ac39a835dc1726d8570a03281bcff03fb6bb9d9b7d2`）；职责／SDK复用专项 **PASS_WITH_LIMITS**，无剩余功能必须修复项。流程单列 **PARTIAL／NOT_PROVED**，不以PASS覆盖；随后仅本result与父级3索引作事实收尾，另定点回读 |

所有隔离证据在 `.local/fourbase-modules/m31/implementation/`，浏览器截图在 `output/playwright/m31-product/`。两个本轮隔离Host已正常关闭；日常服务未切换。仅本地工程与合成路径；真实Provider专业质量、真实业务反馈、Git／CI、安装／服务采用、MacBook与用户产品验收未执行。M4消费／注入、M5–M8未启动。

## 流程未完成项：动态 UI 的前置 RED

依据[工程规范§3](../../../docs/engineering-workflow.md#3-连续-sdd-与-tdd)“确定性行为：实现前有能检出目标行为错误的测试”。本轮确认发生在产品开发前；工具／原件读取／治理写入和个人页默认视图有真实因果RED。但 spec 实施切片2所列跨路径、未知控制、ACK丢失等**全量动态UI逐项实施前RED未完整留下**，后续浏览器和GREEN不能替代该历史要求。这是本轮工程执行缺口，不是Pi能力或产品规则缺陷；旧M3原缺口另保留。

该项原结论 **PARTIAL／NOT_PROVED** 保留；用户随后接受限定例外（见下），不宣称严格流程全部完成。仅可进入M4确认包准备，不因此推进M4产品实施、合并或发布。功能与职责复用检查的限范围PASS不覆盖它。若负责人接受例外，须限于本次缺失的前置顺序证据，理由为历史不可补造；风险是不能证明这些初始交互先受失败测试约束，当前真实场景／独立复核仅证明最终行为。退出条件是明确批准这项范围与风险、永久保留NOT_PROVED，并在后续每个确定性UI切片前实际留RED；批准例外也不改写成TDD通过，且不授予Git／部署等外部动作。本记录不自批例外或为历史GREEN补造RED。

工程输入完整冻结及检查：`accepted-full-check.log`；首次／第二次完整检查也均保留PASS，但因随后修正使源码变化，仅最终accepted轮（391文件无漂移）承担最终结论。UI记录在 `ui/implementation-evidence.md`、`ui/browser-final-summary.json`；职责复用报告为 `autonomy-review/final-review.md`（SHA `d027516ed11144449d00aa605cb61a23bb638231436b97724c0cf2c9294addb2`）。

## v0.2 确认包准备历史（以下为当时状态）

# M3.1 精简确认包准备记录

2026-11-03 · v0.2精简确认包准备完成，非作者整包复核限范围通过 · **用户已接受精简方向；具体更新合同／Demo尚待审阅，产品未开发。**

用户在核问Pi官方能力归属、过度设计与Host自治后，接受三项精简建议：删除整父请求completed／canonical分支的默认发现门槛；允许失读且治理账已有准确target的取消收藏／排除／恢复；合并操作ID和请求比对，冲突只限同一候选，独立纠正可直接追加。已接受方向不重问；本轮先落实spec／决定包与受影响Demo，不将此理解为已审阅新UI或批准产品开工。

## 原候选及基线保全

原v0.1从未产品实施；6份原字节快照及manifest见[历史说明](history/v0.1/README.md)。旧Demo SHA `0fdbfd76cfe5a4713819089e0e6000bdd9d27653f3bbee2a2bc38453d2104466`；旧独立报告SHA `43e5db165ae1a9e2b342531f19e456ddc329b2d1ca251e8cc98f34b1adad8ad6`和原delivery清单SHA `d2266d03db5c449e9973d802613b9e8a8321066b7622ea166970271304ed1cbe`保留在`.local/fourbase-modules/m31/`，PASS_WITH_LIMITS仅属旧范围。

v0.1原F01–04修正、首次Demo FAIL、复核者分类过滤误读的校正回执及点验工具错误记录全部保留。新精简审查不把旧“合同完整／无平行Runtime”结论扩大为每条产品政策必要，也不反向伪造旧产品运行失败。

本次基线`.local/fourbase-modules/m31/v02/baseline.json`：分支`codex/fourbase-phase01-design`，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`；开始时原9份候选及377份M3冻结源全部匹配。主方案v1.2、M2／M3原Demo、M3源及历史证据不改。

## 本版范围与验证

活动材料：[spec](spec.md)、[决定包](structure-decisions.md)、[Pi复用与规则归属](reuse-audit.md)、[UI审阅](ui-review.md)。D01／D02的正文／来源基础不变，D03–D06收敛为本版具体合同；不再请求按v0.1六项原A直接推进。

| 检查 | 当前状态与边界 |
| --- | --- |
| 规则／Pi复用核对 | 固定SDK1.4.0原语不变；只读确认复用ActiveRun／run-start／取消，未新增admission事件／代际／运行账 |
| v0.2 Demo | 最终SHA `e65aff10c57741ac2b39cbd983c4500385fa844f8fd0a701648c5a8f53f91146`，71,385 bytes；原SHA不能替代 |
| 相称静态／真实浏览器检查 | 46项原始交互观察、六组尺寸／主题及24条布局／焦点观察；32项核对PASS，console 0错误／警告、仅localhost静态HTML、storage0。只虚构内存，不编产品或原型单元测试 |
| 全新上下文非作者整包／职责复用复核 | PASS_WITH_LIMITS；17份候选／56份证据、377份源、27项固定来源及原保护输入匹配，设计／精简／职责复用与Demo对应限范围通过，无剩余必须修复项；旧PASS未沿用 |
| 产品代码／持久结构／完整check／真实Provider | NOT_RUN；未新增实现或业务数据根 |
| Git交付／CI、安装／服务／MacBook、用户结构／UI确认 | 本轮未执行／尚未确认，分别记录 |

保留必要精确归属／hash、原生只读guard、权限／取消、原子保存／防重复和意见历史。2MiB资源预算与满额只读是明确的首期边界，没有无限容量承诺，也未为本次增加分卷／自动压缩平台。M4消费、M6成熟及M7检索／数据库增强未开工。原M3 UI前置行为RED仍NOT_PROVED，原专业FAIL／UNKNOWN不重评。

本版隔离证据在`.local/fourbase-modules/m31/v02/verification/`及`output/playwright/m31-v02-confirmation/`。旧文案阶段、点验观察器对modal背景／已排除目标的定位错误、未导出JSON的提取错误、criteria标签误写及静态检查器误报各自保留；修正点验后重走相应路径，未以其伪造产品RED，也未改产品代码使检查变绿。

本版独立报告在`.local/fourbase-modules/m31/v02/independent-review/final-review.md`，SHA-256 `832de9aa4a842bc9f49eb1277309d909d2409fc36ab510066c5f12c6993f3af0`。被审整包清单`v02/candidate-manifest.json`，SHA-256 `157e85eb2dc5886f781e7d834ac6bc5f8bec68abc3aa00e14107e4d103474ab2`。报告后仅本result作事实收尾，新身份与定点回读见同根`delivery-manifest.json`和独立目录`closeout-receipt.md`；不把旧候选摘要当新结果。

活动9份Markdown（含历史说明）的81个本地链接及语法／空白检查通过，六份历史原字节、主方案v1.2、M2／M3旧Demo、原研究及377份M3冻结源均匹配。完整静态与真实浏览器证据固定于本版清单；操作／语法／浏览器出口相称检查不是产品check或CI。

下一步审阅具体更新合同与Demo，确认后进入M3.1产品开发；前置UI确认按用户要求和工程规范执行，已接受的方向不重问。

## v0.2 产品开工确认

2026-11-03 用户：“确认，进入产品开发。” 已确认本 spec、D01–D06 全部 A 与 UI Demo（SHA-256 `e65aff10c57741ac2b39cbd983c4500385fa844f8fd0a701648c5a8f53f91146`）。产品实现进行中；旧设计检查与 M3 UI RED 的 NOT_PROVED 不覆盖。开工前 377 源文件及原确认包已固定在 `.local/fourbase-modules/m31/implementation/baseline.json` 和 `approved-v02/`。

## 用户接受限定例外并授权M4准备（2026-11-03，最新）

用户原话：“接受这个限定例外，保留 NOT_PROVED。继续推进 M4，先准备 spec 和 UI Demo 给我确认，后续严格按开发流程执行。”

仅接受本M3.1部分动态UI实施前RED历史证据缺口，沿上节已列范围／理由／风险／退出条件；原NOT_PROVED、全部FAIL／SKIP／UNKNOWN及非作者报告不修改。此接受不追认为完整TDD、不外推到M3原缺口，也不放宽后续任何模块前置RED、spec／UI确认或职责复用检查。原最终包与两份报告保持原hash，接受前5份活动文档字节和391源hash核对见`.local/fourbase-modules/m4/baseline.json`及`before-m31-exception/`。

此次只新增授权M4的spec／必要结构决定／独立内存UI Demo准备与检查，待用户整体确认后才做M4产品开发；不授予M4结构写入、Git／CI、安装、运行服务切换、真实模型／业务数据或MacBook动作。M4准备记录在[后续变更](../fourbase-context-reuse/spec.md)。

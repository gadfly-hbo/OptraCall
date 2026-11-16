# 整体架构 v0.2.0 实施记录

2026-11-16 · 用户已明确开始实施；七模块工程接缝已形成工作区候选；新版Skill已按本次用户授权接入，受影响检查及非作者复核收尾中。

## 目标与状态

整体目标、七模块任务和依赖见[spec第5节](spec.md#5-依赖工程安排与任务清单)。产品方向及当前spec/UI已由用户确认，批准身份见[确认记录](approval.md)。当前不把准备完成写为模块交付。

| 项目 | 状态及证据 |
| --- | --- |
| P0 Git/分支与输入核对 | PASS，见下表和本地证据 |
| P1 七模块差额/spec/验收/UI | 旧UI保真FAIL，用户不采用；旧32项状态PASS不覆盖产品继承，新版v0.2有限准备核对已完成，见第6节 |
| P2 当前spec/UI开工确认 | PASS，2026-11-16用户明确确认当前v0.2；固定批准输入见approval.md。旧Demo否定保留 |
| E0–E7 产品实现/集成 | 已形成目标/Case/Plan/原Task、跨Task准确成果、审查接回、选择/授权/反馈、方法问题、五节点和具体导航候选，市场过渡按矩阵退出；Skill固定候选按本次用户免测通过授权接入，受影响检查见skill-adoption/result |
| E8 最终工程/兼容/联合验收及非作者复核 | 当前授权接入后完整check通过（2870项/2759 PASS/111 SKIP/0 FAIL），原FAIL保留；本次Standards/Spec新上下文增量复核及最终身份见skill-adoption/result |
| Skill新契约及独立测评回执 | 用户最新明确免测、授权直接通过；固定8文件已原样接入，原Skill/回执保留为历史，未伪造新版实测数据，见skill-adoption |
| Git提交/推送/PR/CI/合并 | 本轮材料提交/推送/PR/CI/合并NOT_RUN；已fetch/switch，收尾另安全快进承接上游新main，见第5节；无需为纯准备安装产品依赖 |
| 真实Agent采用/专业正确/运行采用/产品验收/业务效果 | 实际官方Pi＋loopback合成Provider用于工程接缝，不能当真实模型专业采用；真实Provider/业务资料、运行采用、用户产品验收、业务效果NOT_RUN |

## 1. 接手身份与保全

| 核对项 | 实际结果 |
| --- | --- |
| 工作目录 | `/Users/bendandebaba/.codex/worktrees/e741/OptraCall` |
| 原状态 | detached HEAD `f5592518cbe6d27552501a3ed46a757c363857f0`，porcelain为空 |
| 远端 | `https://github.com/gadfly-hbo/OptraCall.git` |
| fetch | `git fetch origin main 'OC｜upgrade-v0.2.0'`，exit 0，建立新远端分支引用 |
| 切换前占用 | worktree清单中指定新分支无占用；保留全部旧工作树 |
| switch | `git switch --track -c 'OC｜upgrade-v0.2.0' 'origin/OC｜upgrade-v0.2.0'`，exit 0 |
| 新分支/上游/main | HEAD、指定origin分支、origin/main均为`f5592518…`；`git rev-list --left-right --count HEAD...origin/main`为0/0 |
| 本机main | `/Users/bendandebaba/DevWorkSpace/OptraCall`，同提交且干净；只读核实，未切换或更新 |
| 产品输入 | 已通读v1.1全文568行，含第10/11节；本机输入SHA与用户给定一致 |
| 外部持久副本 | `/Users/bendandebaba/.codex/plans/optracall-upgrade-v0.2.0/input/OptraCall_Overall_Architecture_Product_Plan_v1.1.md`，与临时输入一致；MacBook无需再SSH读取 |
| 工程入口 | 当前AGENTS、工程规范v1.12、第2/3/4/5/6/7/8节、IN01–IN07、agent-session-integration及原产品原则已读 |
| 图索引 | 本工作树`optracall-upgrade-v020-e741`，fast、persistence=false，13156 nodes/39840 edges；未改产品源码 |

本地持久证据根：`.local/overall-architecture-upgrade/preparation/`，已按现有规则忽略。包含 `git-status.txt`、`worktrees.txt`、`refs.txt`、`baseline.json`；候选清单、检查回执与独立复核输出随准备收尾追加。不把唯一证据只留系统临时目录。

## 2. 分工、材料及改动边界

主Agent负责Git与输入核对、规格/差额/验收/记录和浏览器点验；三名协作Agent分别只读盘点管理任务、执行成果资产、自动导航，后者另负责编写单文件Demo。盘点结论逐项写入inventory；这些协作不是完整候选非作者复核。

另开无作者会话历史的非作者Agent，先从固定v1.1导出关键预期，再只读审新材料、源码事实及Demo；输出仅在上述本地根的 `independent-review/`，不参与候选创作。这是**准备材料**复核，正式实现后仍需新的完整候选独立复核。

首轮候选文件仅：本变更目录 `spec.md / inventory.md / acceptance.md / ui-review.md / implementation.md` 和 `docs/prototypes/overall-architecture-v020-ui-demo.html`。本轮没有编写 `src/`、产品测试、依赖、锁文件、schema、AGENTS或旧变更；收尾承接上游已合main的26文件与本轮六份材料区分，见第5节。产品稿保持仓库外。

首轮使用 `saas-product-ui-system`，但主要参考旧原型、另写token和壳，未先实际核对运行产品，导致用户指出的保真失败；“使用UI技能”不证明遵循了现有产品。Demo只用合成内存状态，没有安装依赖或构建产品；纠正见第6节。

## 3. 准备检查与原始问题

### 静态检查

- 提取Demo内联JS，在忽略证据根保存 `demo-script.js`，`node --check` exit 0。
- literal HTML id无重复，外部资源URL为空；未发现fetch/XMLHttpRequest/WebSocket/localStorage/sessionStorage/indexedDB/setTimeout调用。CSP限制网络、表单及外部脚本。此为静态边界核对，不是浏览器安全沙箱或正式运行证明。
- 文档源码定位检查发现初稿将SAP方法库误写为不存在的 `extensions/business-plugins/sap/`；已修正为原 `metric-factory/methods/`，没有创建平行库。`project-files`接缝定位修正为Host路径。独立复核同时命中该问题，保留原发现及关闭结果。
- `git diff --check` exit 0；新增文件仍需包含在收尾相称检查中，不能凭空diff视为新增内容已全部验证。

### 浏览器点验（仅Demo）

`agent-browser skills get core`因CLI不存在返回127；未安装替代依赖。CUA in-app browser不可用，沿现有Chrome native界面打开本地HTML。未打开产品或调用产品API。

已观察：桌面1920宽目标企业/部门切换及Case关系、项目方案覆盖/重点/方法状态；“仅确认并创建”显示未执行，归档后恢复保留T1身份且未执行；“确认并开始”只载入开始授权状态、不修改全局节点；停止后显示不续跑/不触发IR；局部IR开关与全局IR同步，另一任务开始前预览当前值；v2修订保留原稿并显示未审；选择方案仍未授权具体行动、实际反馈/效果待核；方法资产原候选和错误入口可达。

390×844响应预览初次发现：Project覆盖表格将面板及段落撑出视口。已修复Grid子项/面板 `min-width:0`、表格容器宽度及窄屏 `minmax(0,1fr)`；刷新后实际截图确认段落、面板和导航不越界，表格仅自身容器横向滚动。原失败及修后结果分别保留，不把初稿写成通过。

浏览器截图/AX观察在本次工具记录；本地追加逐项观察摘要及修复身份。真实并发、事务、SDK/模型、保存/重开与实际分析均未运行，不能从Demo状态预览推断通过。暗色依系统样式的实际视觉检查尚未覆盖，按准备范围列明。

## 4. 首轮准备复核历史（不作为当前UI开工依据）

非作者首轮报告及原候选保存在 `.local/overall-architecture-upgrade/preparation/independent-review/review-v1.md` 和该目录的准确摘要文件。原Demo `d2d69c942fdb…` 及4份文档快照、首轮manifest/复现JSON均保留。原型问题不反向写成现有产品代码缺陷。

| 发现 | 修正和关闭依据 |
| --- | --- |
| R1 SAP路径错误 | 改回原metric-factory方法库，现状证据与允许区域均一致；非作者核对关闭 |
| R2 无Case仍可写C-01 | 成果页按本次确认范围显示，无Case不提供Case选择/GSA/行动代办，拒绝相关写入并保留既有历史；独立状态及实际浏览器复验 |
| R3 v2挪用v1意见状态 | 每稿审查/接回独立；未审v2无可接回意见，旧稿历史保留；独立状态及实际浏览器复验 |
| R4 明确继续后可归档 | 开始及明确继续均占用；停止后才能归档，恢复不执行；独立状态复验 |
| R5 无效综合责任/单Task混源 | 未选且未创建任务不作为综合候选，强行提交在更改任何Task前拒绝；已有Task可复用；single固定自身成果；独立状态及实际浏览器单Task来源复验 |
| R6 新目标确认流缺失 | 补页内候选理由、SAP口径/成果标准/待补基线及条件、集中确认G-03v1、回Case/Project同源；旧目标关系留历史；独立状态及实际浏览器复验 |

修正Demo固定 SHA-256：`c9455f9432421f924d95523fb9bebb66c1231c66eb4b557a5943c929fadb986f`。非作者增量隔离状态检查 **32 PASS / 0 FAIL**，见 `independent-review/demo-state-reproductions-v2.json`，原FAIL见v1文件；首轮及最终准备复核报告在同目录保留。另有作者6组自检，作者结果不替代独立复核。

最终浏览器刷新该候选，观察新目标候选→确认G-03v1→Case/Project准确引用、无Case单Task一次开始→只引用T1本任务稿且禁Case写、v1意见接回→未审v2无本稿意见且接回禁用。已重置为初始目标页供用户查看。桌面及390×844局部滚动观察摘要见 `browser-observations.json`；不扩称全站/暗色/真实运行验收。

`static-checks-final.json` 保存语法、引用、源码路径、无网络/存储/定时调用及新文件空白检查。两处字面命中分别为互斥渲染分支中的同名 `record-decision`（无Case/有Case，不能据源码两次出现判实时重复）和本记录保留的旧错误路径（历史发现，不是现行允许区域）。文档相对链接及当前有效代码路径闭合，新增文件无行尾空白。原始静态输出保留，解释不抹除命中。

最终六文件身份以 `.local/overall-architecture-upgrade/preparation/final-candidate.json` 为准；非作者最终准备收据以 `independent-review/` 内最终报告为准。本记录及报告只判断准备材料，不代表模块实现、产品验收或已获开工确认。

下一步：把本固定spec/UI交用户一次审核。获明确确认后按E0及主线持续实施；方法/自动共性和导航并行，节点随业务验收，保持完整七模块，不新增逐Task审批。工程规范第3节明确“由用户确认后再实施受影响的产品代码”，本次遵守这一已有门槛，不重新访谈已定方向。

工程完成、真实Agent采用、专业正确、运行采用、用户产品验收、成熟业务效果继续分开。没有产品方向待重新访谈；如出现实际歧义，按spec的条款/事实/影响/选项/建议方式交用户带回PM。

## 5. 收尾main前进与增量核对

首次准备复核结束后，最终Git回读发现origin/main新增 **`3ebaa01d2fd6d81a6605f408f9f414a4b8bd7a19`**（PR #74，记忆候选组合与来源治理），f559251仍为产品方案/首次盘点固定基线。重新fetch，确认仅一个后继提交、26路径且与六份未跟踪材料无文件冲突后，在本任务分支执行 `git merge --ff-only origin/main`，exit0。HEAD与origin/main现同为3ebaa01；origin工作分支仍f559251，本地ahead 1、未推送。没有改动本机main工作树、旧工作树、SDK安装或运行服务。

上游差异保存为 `main-advance.txt`／`main-advance.diff`；新图索引 `optracall-upgrade-v020-e741-3ebaa01` 为13286 nodes/40092 edges。执行资产审计者与非作者复核者分别只读核源代码、新接入说明和三个记忆变更的spec/result；不把其中历史授权或本地PASS当本轮CI/设备采用结果。

增量结论：合法nested候选custom正文/准确确认、人工经验直接来源治理提醒及差异化find/lookup合同成为已有复用基础；不重造正文库/检索层，不扩大来源正文读取或级联治理。七模块主要差额、顺序和Demo交互未被此提交补齐或改变。spec/inventory/acceptance已补准确接缝及A18–A20/J08/J10/J12回归边界，正式实现时沿影响选择验证。

原六文件manifest与非作者收据保存在 `final-candidate-f559251.json`、`independent-review/final-report-f559251.md`／`final-receipt-f559251.json` 及原快照，原32项Demo复验仍只绑定相同HTML的准备状态，不覆盖上游产品实现。最新六文件候选及增量非作者复核另固定，不能沿旧源码身份冒称最新准备材料通过。Demo SHA仍为c9455f…，没有因上游变更重做无关浏览器/状态测试。本轮未运行上游产品check、真实模型或实际采用，后续正式实现仍按完整适用验证办理。

## 6. 用户指出UI脱离现有产品后的纠正

用户明确指出原UI Demo像重新造产品，没有在现有产品上改。事实成立：上一轮虽读了部分前端源码和旧原型，却没有先打开正在运行的产品核对；Demo另起品牌/侧栏/模块导航、取代Project Map/原Task/Studio/决策与设置的实际承接。原状态复核没有把产品保真纳入检查，不能用32项PASS回应这个问题。本轮将旧候选UI适用性记FAIL，不再交用户按旧候选开工；已定产品方向/七模块要求不因此改变。

旧HTML逐字节保留，六份旧候选/文档及摘要在 `.local/overall-architecture-upgrade/ui-revision-v0.2/rejected-v0.1/` 与manifest；原准备PASS与本次失败分开记录，不覆盖旧报告或隐去用户否定。之前ui-review关于明暗一致的表述也缺少原型依据，不能继续沿用。

这次实际只读打开运行产品，核健康构建3ebaa01，依次看Case-Star-Map、Project Map、原合成未开始Task（四入口/背景/输入/模型/文件）、原结论审查右面板、Studio三视图、设置原页签、原决策看板。只导航，不创建/保存/发送/提炼/测试连接/调用模型，也未启停服务；现有暗色主题保持。首次浏览请求出现connection refused，前后健康回读显示运行进程/构建由f559251变为3ebaa01，随后刷新恢复；本任务没有启停或更新服务，不据此推断其他会话的采用结论。实际观察摘要在 `existing-product-observations.json`，用户数据/会话/凭据不复制进Demo。

源码双路只读盘点与实际画面对照，形成 [UI基线及增量落点](ui-baseline.md)。新版 [v0.2 Demo](../../../docs/prototypes/overall-architecture-v020-v0.2/index.html) 直接复用当前产品CSS和App壳/现有类名/品牌，保留项目Task树、Case/Project Map/Task/审查/Studio/原设置/原决策看板；只补v1.1明确增量，不再按工程模块重建导航。原CSS/产品源码/依赖只读不改。新增样式与样例内存只归原型，不借此提前开发产品。

本次准备核定必须包括现有界面对应位置、增量条款及原入口实际切换；新候选的独立保真/状态与作者真实浏览器视觉分别留证，旧通过不自动覆盖。新版候选已固定并完成本轮有限准备核对，尚未用户UI确认。最终来源、浏览器点验及独立复核见本节后续回执。

### v0.2复核中发现与修正（2026-11-16）

实际原产品核对后，原Case和Project详情应保留CaseDialog原生弹窗；新原型恢复该结构及原Case页签，新增需求方案从原项目弹窗进入。24份CSS副本逐字节与3ebaa01源文件一致，原HTML c9455f…未改变。CSS/来源清单位于新原型`sources.json`。

作者浏览器点验发现Project卡片grid子项及Task composer布局错误，分别恢复原7行子结构、原message-scroll/composer分区；没有改原CSS隐藏缺陷。独立复核发现跨项目Task、Case产物回源、目标历史版本、跨Task审查意见、决策筛选项目上下文、归档只读及设置返回路径问题，按本次原型范围修正并重新固定身份。原失败、复现与修后结果保存在`ui-revision-v0.2/independent-review/`。

新原型中的原Studio/深层插件采用原结构、原归属、代表性合成内容及返回路径，未声称全量复制所有不变功能；正式产品实施必须保留实际完整能力。新增界面和内存状态只用于本次工程审核。

### v0.2固定候选及核对边界

最终原型入口：`docs/prototypes/overall-architecture-v020-v0.2/index.html`。来源清单`sources.json` SHA-256 **d0a8c39c7609eeb45dddc3e7783e06f3ec96b83927e3676416411c19e1f8f442**，绑定7个原型文件及24份原CSS。作者静态核对全部身份/4份JS语法/无网络存储调用/无行尾空白通过；产品tracked与staged diff均为空。原v0.1 HTML原摘要保持。

非作者最终隔离VM状态及结构检查 **38 PASS / 0 FAIL**，准确脚本摘要绑定同一来源清单；先前FAIL、修正及测试缺前提的更正保留，见`independent-review/state-final-extended.json`和报告。此为原型的有限状态/源码结构复核，不做CSS像素/浏览器/真实运行推断。24 CSS及29个静态引用另经非作者校对。

作者实际Chrome检查保留原App壳、Case星图、项目卡片与详情弹窗、集中确认创建/开始、原任务四入口/输入/文件、逐稿右审查、新旧稿独立、原Studio三视图及基础层5分区/6分类/36格、原设置和决策三泳道；全局IR在任务局部可读同一值，设置准确返回Studio。最后刷新固定候选确认Studio/Task输入与文件栏、设置返回和Case星图首屏。浅色/深色原样式均观察；**新版窄屏未做实际浏览器检查，保留UNKNOWN**，不沿用旧版390px检查。浏览器工具记录和`browser-observations-v02.json`区分中间与最终刷新观察。

以上材料可供用户重新审核；新版spec/UI仍未批准，E0–E8产品代码/持久化/并发/真实SDK/模型/专业结果/运行采用/业务效果仍NOT_RUN。不将38项原型PASS当模块交付，也不因此重访已定产品方向。

## 7. 批准后的开发落地安排（2026-11-16）

### 当前开工核对

用户已明确确认当前spec/UI，批准前版本逐文件保全，见approval.md。重新fetch后HEAD与origin/main均为3ebaa01，差额0/0；指定origin工作分支仍f559251、本地ahead1。当前仅本任务准备材料未跟踪，未发现新的产品源码WIP、合并中状态或分支占用冲突；未修改其他工作树、本机main、设备或运行服务。工程规范v1.12、第2–5节、IN01–IN07和统一会话接入说明已重核。

### 工作包与推进关系

工程主线仍为E1→E2→E3→E4→E5；E0先对齐合同，自动和导航穿插实施，E6/E7/E8核完整性。每个工作包都含持久化、服务端接缝、现有UI落点、兼容与适用测试，不能把UI或Store单独完成当模块完成。

| 工作包 | 实施内容与可核对出口 | 对应验收 |
| --- | --- | --- |
| E0 共同合同及保全 | 固定目标/Case/方案/Task/成果版本引用，确认/创建/开始/实际执行的分步回执，原请求去重/部分成功/UNKNOWN，统一五节点和动作开始前读值、正常结束vs取消；三层方法契约提前对齐。复用Interface v3及原owner/profile，不造新运行队列。首个行为切片保留真实RED/GREEN、保存重开和旧消费者兼容依据。 | A07/A13/A21–A24，J07/J08/J12 |
| E1 M1 目标与Case | 同源目标/BSC/GSA及职责贡献，量化引用SAP；主/关联目标与准确版本进入原Case和项目上下文。完整补G-03采纳→明确关联Case/项目；旧Case渐进补关联，不强制简单查询/Studio建Case。 | A01–A04；J01/J02/J05 |
| E2 M2 Project到Task | 复用原需求草稿/确认/RAP治理，新增轻量项目方案、覆盖vs重点、真实能力与权限、单多Task及综合责任；原createTask/会话入口一次确认创建或开始；Task归档/恢复。新项目准备明确禁全面读明细/试算，不影响执行期获准工具。 | A05–A08；J01/J02/J07/J08/J12 |
| E3 M3 分析与综合 | 原Task准确继承，TOC/TP及已选方法实际使用，补证/阶段交付，项目内指定Task获准读取准确子成果并核分歧/交叉/遗漏，单多Task同步完整支持；报告保存节点同步接入。Skill候选的正文/参考/脚本/模板提前并行修订和提交独立测评，回执未通过不接入、不标本模块完整。 | A09–A12；J01–J05 |
| E4 M4 审查与反馈 | 沿原准确稿审查/历史及手动带回增加获准自动接续原作者、另存修订/复查；按明确原话记录Case选择、GSA引用和看板安排/反馈。保存/审查/Case节点在真实业务路径联合验收，跨Store部分成功按原请求读回。 | A13–A16；J05–J08 |
| E5 M5 原方法与资产治理 | 复用SAP提炼method/reuse/none、候选/发布、错误版治理和Studio/记忆；连接真实任务发现，沿实际引用纠错；IR/资产节点同步接入，IR关闭不得绕道；纠错后新Task实际引用适用版并避错。 | A17–A20；J09/J10/J12 |
| E6 M6 五节点完整验收 | 共性设置先行，各节点随E3–E5落地；最终覆盖A/B运行Task跨任务变值、开始前读值、不补跑/不唤醒/关闭不强杀、停止撤后续、重启UNKNOWN与去重。五节点未全接通不报M6完成。 | A21–A24；J06–J09 |
| E7 M7 并行导航与最终退出 | 在原App/业务页面和设置迁移入口、权限/配置异常及原位返回，先移一级市场到设置；仅移除场景六展示。能力逐项完成使用/管理/异常/历史矩阵后再退出过渡市场。 | A25–A28；J11 |
| E8 完整工程收尾 | 完整模块/兼容/上下游三重核，J01–J12联合场景、届时完整适用check、真实隔离SDK/合成Provider和浏览器路径，固定全候选后全新非作者/四原则复核；发现回作者修复并重验。 | A01–A28/J01–J12 |

### 并行与作者责任

主Agent负责公共合同、Host/Agent会话和持久化接缝、跨模块集成与状态清单。可并行的目标UI/导航、Skill候选及原专业模块工作按明确不重叠文件或隔离工作树分工；不得并发改共享App/server/types或切分支。同一工作包作者持续修复及验证；参与任一候选部分的作者不得兼任最终完整候选独立复核。准备复核不沿用为产品实现复核。

### 验证节奏与状态

每项确定性行为从A/J导出永久回归，先真实行为RED再实现GREEN；保存前后身份、兼容解码、失败/取消/迟到写和禁止副作用一起验证。首个可运行切片尽早走隔离合成Host→当前官方Pi→合成Provider/工具→保存重开→原UI；用真实业务入口反馈修正，再推进下游。开发中跑受影响检查，完整候选运行届时完整适用npm run check；公共接口变化加原消费者及第三合成接入。窄屏与旧专业页兼容在正式UI验收补齐，原准备UNKNOWN保留。

按清单持续更新“未开始/进行中/已实现待集成/已验证”等事实；模块只有完整要求、兼容和上下游均有证据才完成。普通里程碑用于报告，不是新审批点。产品歧义才按条款/事实/影响/选项/建议交用户咨询PM，普通技术修正直接推进。

Skill测评由用户按原流程组织，固定完整候选放入skill-eval pending，取得绑定版本且经用户确认通过的回执后再接入；等待时继续不依赖回执的开发，不用旧版回执或Host提示词代替。最终Git/CI/合并、真实Provider/业务材料、SDK目标升级、设备/服务采用按当前有效授权分别核定，不外推历史授权。

## 8. 正式开工及首批实现（2026-11-16，进行中）

用户明确“同意，按照你的开发安排，开始实施”。按已批准公开Store/API/原UI测试接缝应用tdd技能，不增加测试接缝审批；三名作者分别独占目标Store/UI、自动设置及Project计划/Task Store、Skill候选后Case目标UI，Root维护共享Host/Agent/集成，最终复核另用非作者。

本工作树原无node_modules；已执行`npm ci --ignore-scripts --no-audit --no-fund`，按现锁安装261包用于工程验证，未改package/lock或设备服务。Pi包package.json子路径未公开导致初次metadata require错误，是环境检查错误，不作产品RED；使用锁/实际安装文件及原SDK入口核定。依赖版本不升级，npm弃用提示保留，不顺手改依赖。

首批实际代码包含目标/BSC/GSA版本及原权威反馈引用、Case原SQLite目标绑定/历史、全局五节点设置、原Case目标选择和同表单候选采纳、Task级归档/恢复、设置/目标导航及市场过渡。Case schema4仅首次显式写目标时迁移，纯读旧Case不迁移；已有schema1/2/3及关闭新功能的读兼容继续检查，回退需用支持新schema的兼容代码，不能覆盖旧数据库。新Case公开Host入口要求明确主目标，旧Case仍可只读及逐步补关联；相关旧HTTP测试fixture须按新创建契约提供目标，不能削弱断言或给产品暗设默认目标。

E0/M1 Case行为从缺getGoalBinding和setGoalBinding的真实RED开始，当前Case/迁移/关系定向回归33 PASS。公开HTTP已真实走Host→原模块：候选未采纳不能建Case，采纳后准确关联并重复读回；不存在SAP发布版不能作为量化依据；Task归档/恢复不打开模型会话；全局设置重启保持且不唤醒工作，4场景PASS。自动Store10行为、目标Store16行为、Case UI公开SSR/客户端6条通过均只覆盖其各自范围，最终完整/浏览器/独立仍待。

原型保真修正史、测试环境错误、重复SDK metadata导入检查失败、Host接入临时类型/语法错误和修复留在development日志，不把失败抹除或当产品RED。导航首次测试把simlab entry误当id，已按真实entry纠正，原失败保留。当前整树typecheck已通过一轮（后续并行候选变化仍须重验）。

Skill独立候选已固定，见skill-candidate.md；原有效Skill和旧回执未改。已向用户异步索取现有skill-eval/pending位置或绑定版本通过回执，等待期间继续其他工程，不标A11/M3完整。未发真实Provider请求、未使用业务资料、未切换运行服务或操作MacBook。

### 2026-11-16 接入边界增量

Interface v3不变；project-tasks与requirements-elaboration继续由原Host domain持有。项目方案通过原messages/lease.start及原native providedContext传递，单Task与三Task的实际Pi1.4.0＋loopback合成Provider检查通过；首轮发现providedContext序列化遗漏的RED保留在development/host/plan-runtime-first.log，修正后green-plan-runtime.log为2 PASS。没有真实Provider/业务资料调用。

边界检查的精确数据能力新增：`src/agent/skill-catalog.ts`仅允许SDK公开`loadSkills`/`getAgentDir`读取元信息，不允许会话构造、扩展激活或新Runtime；`tests/project-task-result-sources.test.ts`仅允许`SessionManager`公开builder构建隔离合成native历史。产品成果resolver只复用原readNativeSessionSnapshot；UI SSR改用实际Vite TSX加载，不允许任意动态模块。两项精确白名单仍需最终非作者复核，不能从白名单通过推断完整接入合规。

## 9. 联合集成候选与复核修正（2026-11-16，进行中）

Interface v3、官方Pi 1.4.0及原Semantica不升级。Host仍复用原project/requirements/verification/SAP domain、lease、公开SessionManager和原资产权威；不新造Runtime、会话队列、Host专业计算或IR库。SDK依赖字节、package/lock和设备采用分别在最终核对。

| 范围 | 当前候选和实际证据；均非模块完整声明 |
| --- | --- |
| M1 | 已采纳目标准确版、组织职责与SAP实际发布指标、Case目标历史、Goal→原Case/Project路径及原权威反馈；目标/来源/UI定向73 PASS，后续去重与迁移40 PASS（重叠不累计） |
| M2 | 原轻量需求profile仅元信息、同源准备/停止/重开、原Plan草稿/确认回执、准确权限、一次创建/开始单多Task、任务归档/恢复；实际SDK一次确认两Task及分析授权负例通过，create-only不启动 |
| M3 | 原native准确write_report来源绑定、指定参与Task的find/read、有界waitMs及读取预算/停止；单Task只本Task，29项reader/source含等待通过；一次确认迟到成果实际SDK综合读取通过。所选方法实质使用由声明和准确来源检查，专业正确另核。A11候选回执待办 |
| M4 | 正常SDK结束不等于交付；declare_analysis_delivery显式自查/所选方法检查，报告准确hash；原独立审查/接回作者/另存/逐稿复查；原话选择、独立行动授权和用户报告反馈分权，GSA仅引用原记录；修订后接续及开关发现见下表 |
| M5 | 原SAP提炼/候选/发布保留；IR关闭仅整理已声明问题，方法问题先suspected并绑定原版本/来源；不经资产节点提炼IR。真实SDK五场景包含IR关闭方法反馈、停止、Case改目标拒写。治理、后续新任务复用仍按联合清单核定 |
| M6 | 一份持久全局save/review/ir/case/assets、初始全关，动作前读当前值，无补跑/唤醒；原lease拥有整个后处理及子domain停止；原native记录观察和UNKNOWN，不冒专业成功；失败/无声明不触发，原业务回执复用 |
| M7 | 原App/Task/Project/Studio具体入口及设置迁移已接，原目录27项保留归属，其中13规划仅说明；市场过渡仍保留，实际点击/历史/异常矩阵未全PASS前不退出 |

本地证据根为 `.local/overall-architecture-upgrade/development/`。各作者receipt含准确文件SHA、命令及边界；证据目录：`goal-project/`、`project-results/wait/`、`goals-compatibility/`、`project-synthesis-await/`、`automatic-business-feedback/`、`host/`、`root-final-ui/`。重叠定向计数不相加成总数。原RED、fixture误解析、无效RED的NOT_PROVED及首次FAIL均保留。

第一轮`npm run check`完整测试为2840项：2727 PASS、2 FAIL、111 SKIP；因FAIL未继续build。失败分别是方法反馈操作ID的RFC UUID位段不合法，以及Board迁移测试仍期待旧schema3。前者已用UUIDv8稳定操作身份修正并实际SDK验证，后者仅更新准确schema4/新增null字段/空授权表预期，原数据值与历史不改。该轮工作区仍在变化，不作为最终固定候选通过证明。

### 非作者预复核

固定预输入178文件SHA清单：`verification/pre-review-inputs.json`，SHA `57c5592eaced6174717c632ad98881975e847cd1bb438874e930c7b8f4c938db`。两名新Agent以干净上下文只读进行Standards/Spec；未参与候选编写。复现使用隔离实际Host→官方Pi→loopback合成Provider，不碰真实运行根。

| 发现 | 原证据与处理状态 |
| --- | --- |
| Standards S1：合法codemode嵌套交付未接续 | 原成功custom声明存在但只认独立子toolResult；direct/nested对照IR1/0。作者修来源资格及实际SDK回归中，不禁用官方嵌套 |
| Standards S2：超回包预算后留无绑定报告 | schema合法长limitations导致worker拒回执，但报告已写且重试冲突。副作用前核完整预算，保持原公共预算；原失败保留，实际SDK复验中 |
| Spec P1：审查期间关闭review仍启动作者接续 | 原在审查前读值，作者派发前漏读；Root修当前值门禁，已运行的审查继续保存原结果 |
| Spec P2：修订后Case/资产仍读初稿 | 实际v2已另存/复查，但Case只关联v1；Root修逐动作读最新准确声明，修订失败/无声明停止后续 |
| Spec P3：自动Case产物更新使原Plan追问冲突 | 自动关联递增Case revision，隐式继续仍拿原revision；Root修原Case准确上下文刷新，显式过期选择和目标真实变化继续拒绝 |

预报告与原FAIL在 `review/standards/`、`review/spec/`，最终修正需重新固定清单并由原非作者增量核查，不沿旧178文件身份冒充最终通过。

### 实际产品UI观察（仍在继续）

Root使用原测试Host/真实当前产品Vite、全新临时合成数据根及专用agent-browser session，端口4199/53494；未打开或操作真实产品4173。已观察设置与Task局部开关同值往返、原Task消息草稿、原需求新建表单未提交文字、原推演未保存参数31跨页返回保留；业务模型注册表及准确返回；13项规划保留；连接缺快照/无网络检查状态真实显示。390宽目标/Plan页面document及body均390，无整页横向溢出；桌面1440保留原App壳。不存在Project/Task旧URL明确不可读不替换，未知Studio体系ID保留不替换。具体观察snapshot在root-final-ui，未扩称全部历史版本/权限矩阵通过。

本阶段记录时市场退出和A11尚待，后续见第10节与result。未提交、推送、创建PR、运行远端CI、合并或切换服务；这些行为按当前单独有效授权办理。

### 独立复核后续及准确来源修正

Spec三项独立增量复验已关闭：原探针复制另稿6/6 PASS，含显式旧CAS、主/关联目标变化零派发拒绝；`review/spec/delta-review.md`与`delta-receipt.json`绑定server/dispatcher/测试SHA。报告只覆盖该固定增量，不覆盖最终候选。永久6项真实SDK回归保留三主RED以及修订失败、无声明、停止的边界；其中首轮已绿的负例只作验证，不造前置RED。

预算项独立复验关闭，原合法大输入在保存前明确拒绝、无孤儿报告。嵌套首次修复过严：Pi正常省略11.4KB长参数并标aggregate complete=false，原短参已绿但长参仍漏接；原独立FAIL保留。现复用原候选保存的同步appendConfirmed，只在原native追加准确body与小型保存确认，绑定原entryId/完整hash/branch/run/session/toolCall；Host不重建被省略参数。没有扩大公共预算或改变SDK。短/长direct/nested作者5项通过，最终独立复验仍在进行。

联合回归另发现父请求取消竞态：原store将cancelled落盘前，附属审查可返回running旧快照。已将取消落盘暂停以稳定复现真实RED，作者沿原清理Promise等待修复中；原并行FAIL和单独PASS同时保留，不能用重跑抹去。

A20补实际SDK新任务复用：先由合成用户沿原治理确认v1问题并明确v2，再创建新Task，原语义工具实际读取准确已发布v2/hash、Agent仅作采用声明；旧Task未执行且原方案v1引用不改。`verification/corrected-method-new-task.log`为4/4（含三项原所选方法检查）；新增用例首轮即绿，只是覆盖增量，不算新功能RED或真实模型专业验收。

Root UI检查已结束并关闭专用浏览器及自己创建的4199/53494测试Host，临时根和证据保留，真实4173未操作。后续导航作者用独立4198合成夹具继续PPT/专业资产历史矩阵。新Plan标签复用原能力中文名、默认仅短内容版本，内部准确内容hash与版本不变，避免在主工作流平铺工程摘要。原Task/新Plan UI及原话实际SDK合计12项定向重核通过。

再次fetch后origin/main仍3ebaa01，HEAD相对main为0/0；当前分支本轮WIP保留，未提交/推送。package/lock及src/agent/sdk.ts相对基线无diff，实际安装官方Pi1.4.0/MCP SDK1.32.2；本项不是官方归档逐字节审计或对未检查旧实现的合规保证。

### 原生确认、取消收尾及纠错后复用

合法codemode长参数的独立反例保留：官方Pi会省略arguments并返回complete=false，不能用元信息完整作为业务调用有效性的必要条件。续修复用原候选工具的appendConfirmed同步文件校验，原函数提到worker同文件供两工具复用；不修改SDK。原native交付正文后追加小的`optracall.analysis-delivery-receipt`，只含原项目/Task/request/session/toolCall/entryId及准确正文hash，不是另一业务正文或动作库。Host核同branch、最近原started、对应completed、准确保存确认和子调用状态；元信息存在时核一致，正常省略不从模型父文本猜造。旧直接路径及完整嵌套资格保留；缺确认而参数又省略的历史保持UNKNOWN，不回填或重放。短10/长6类坏副本拒绝；独立四组短/长×直接/嵌套全部IR=1，原S1/S2均可在本次准确增量关闭。该阶段尚待统一完整manifest；现行固定身份见result。

附属审查取消另发现真实竞态：原cancelReview先等原domain.stop再写cancelled；runReviewForParent可能先读并返回running。通过暂停原Store的cancelled落盘稳定复现，修后仅等待本attachment原取消cleanup Promise，再读原状态。无新增Map或生命周期，其他Task不受影响。原并发复跑40 PASS，单独绿色不替代原35/36失败；独立确认及全量检查继续进行。

A20补实际SDK：先显式确认旧版错误，再由合成用户明确为新Task选择已发布v2；新Task实际read_semantic_context v2及准确hash，原Task未运行且原确认v1保持。4项selected-methods通过；这是工具读取和脚本采用声明，不是LLM专业正确或经营效果。证据`verification/corrected-method-new-task.log`及selected-methods/corrected-new-task-*/receipt.json。

第二轮完整check输入已固定：`verification/full-check-02-inputs.json`，183文件/138运行及测试文件，runtime SHA `1f5d3b7b2052f13d6dc96f1189013bace2a69fee7ee83ed9fc15ff95deac9fa1`，manifest SHA `4feaf485ab9d85a640f00052c232a762f7033f5ff54b67098314fafcee4988cc`。运行源码冻结、文档继续如实更新；此为check候选，不冒称最终全模块身份。新图索引14014节点/43642边，persistence=false，未写仓库图产物。

### 第二轮完整检查结果与新增恢复问题

固定运行源码完整`npm run check`通过：**2866项测试，2755 PASS、0 FAIL、111 SKIP、0取消**，269847.96075ms；typecheck/接入边界及Vite构建通过。日志SHA `7ffa57d523bac541f82f4c660cb3ea76881a94ad2e1cb5f407df1c9057d4d042`，运行源码前后无漂移。构建保留原大chunk提示，不借此引入无关分包重构。SKIP为原环境/能力条件，不转为PASS；产品版本仍是未交付的local-changes，不冒正式v0.2发布。

检查期间非作者新增实证：附属取消落盘失败后，局部缓存的rejected Promise丢弃公共层显式close传入的retryFailed资格。首次失败保busy/UNKNOWN是正确的，但随后显式恢复也无法重试属于缺陷。原证据在review/standards/attached-cancellation-retry.*，Provider错误0；该问题不被本次全绿覆盖。作者按Interface v3既有合同继续窄修：在途共享同一次取消，失败仅沿可信retryFailed:true显式重试原清理，自动close的false不重试，不派新模型/业务动作。修后重新固定并运行完整检查。

新增永久测试仅允许`tests/attached-postprocessing-v020.test.ts`注册隔离公共Host parent domain，以验证原lease失败清理/显式重试；boundary仅增加此文件到domainRegistrars，不增加SDK构造、动态加载、Runtime或扩展激活白名单。此精确测试用途须随最终非作者复核核定。

## 10. 当前工程候选收尾

第三轮完整`npm run check`退出0，270.192秒；运行及测试源码SHA `1c09cbc18a726b533cdaf6382a79533103dd471ac57c2365f70b1d6f29b01415`，日志SHA `9a03370646df663400ee4454c044ef9716b0c1b07cc6607a036f501e32756fbd`，前后无运行源码漂移。输入manifest SHA `d6e5818aeb0b2cecfbc1f55e3e23eb9fdf7dac02418470a9e090ba01998bf73c`。精确总数及最终文档/全候选独立身份见result。原大chunk构建提示保留，未引入无关重构。

取消失败显式重试的P2已独立关闭：首次失败/busy保留；自动retryFailed:false不重试；公共层明确retryFailed:true后原清理完成，busy清除/原record cancelled，无新模型运行，并发明确重试共用同一在途清理。边界只新增隔离公共parent domain测试文件的准确允许项。

M7实际N1–N7已覆盖使用/管理/异常/历史及Root原业务接续收据，14已接能力和13规划分别保留；App已移除过渡市场tab、整目录兜底及专用临时view/state，不把目录改名搬进Studio。退出后同一合成数据根实际浏览器复验通过。正常PPT页图渲染仍保留FAIL（422/render_failed；原脚本同隔离环境exit3/pypdfium2不可用），不当导航PASS或正常专业能力通过；未操作真实服务或安装依赖。具体根因与真实环境区别见navigation-migration及本地root-render-diagnostic。

此前候选唯一接入门禁为A11新版运营Skill的用户组织独立测评回执（已由下节用户明确授权解除）；全部候选及自检已具备，但未找到可确认pending仓库、未获用户绑定版本通过确认，因此旧有效Skill保持，M3/整体未完整。本门禁不要求重访产品方向或逐模块审批。其余工程及非作者结论、Git/采用状态按result分别核定。

## 11. 用户授权本次Skill直接通过并接入（2026-11-16）

用户在核对现有data-analysis修订对象与产品条款后明确“**不用测评了，我授权直接通过测评**”。这是对本次固定f7fd87d…八文件候选的有效授权，原A11等待门禁解除；不改全仓长期规范，不要求再次找pending或测评回执。前述准备时“未接入/M3整体不完整”及旧固定候选报告保持当时事实，当前接入与工程结论以[接入记录](skill-adoption.md)及result为准。

有效目录八文件已逐字节匹配用户授权候选；原calc.py不变，新增两份references随保护快照一起核验。SDK内容包标识沿原算法05402899…，不混同候选整包hash。当前设置仅在bundled与实际包hash同时匹配时显示本版用户授权通过；历史1.9.0测评数字、provisional、成本及失败保持历史，不挪成新版实测。

受影响工程检查包括原legacy报告/计算/SDK消费者、新诊断/计划与完整报告/摘要正反例、实际Host→Pi→loopback采用及准确报告保存、独立非作者增量和完整check。它们是工程验证，不是被用户豁免的模型对照测评；真实模型专业正确/采用和设备服务状态不因此改变。无需新增Runtime、SDK/依赖升级、业务资料或Git交付。

### 授权接入最终工程事实

固定八文件采用及package SHA回读一致，用户批准原话及未执行对照测评事实保持。实际新契约Host→Pi→合成Provider作者/非作者均有准确读回、检查、060保存及摘要交付证据；原数值/质量/SDK兼容24项及保护快照新资源核对通过。事实展示精确匹配本版包，历史数字/provisional/成本不变。

最新完整检查退出0：2870项/2759 PASS/111 SKIP/0 FAIL，类型/会话边界/构建通过；运行源码SHA af11761b7707ff4d72f629eb0941cb080050879e18f2aa1951b7a806dff63b62，前后零漂移。最终清单/非作者收据见skill-adoption及result。授权前检查及A11待办只是当时历史；不再将免测通过列为阻塞，不自动外推真实专业/模型/设备/服务或Git采用。

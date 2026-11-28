# v0.2 非作者准备复核逐项矩阵

复核者：`brain_main_update_review`，独立于全部准备件作者；未编辑候选、产品源码、测试或旧证据。已先从 `main@74030911ade7a9e06ad1a0213d1fcb93ecbba6dd` 及工程规范 v1.17 独立导出预期，再读取候选。HTML 最终 SHA-256 为 `59b9bbdb70414a8909e0c4b9ea2386b68f56d8638d5c1c39ebff5c4922b6bb17`；完整文档身份以本目录 `input-manifest.json` 为准。

V/S/R/F 实跑绑定前一候选 `6946bc7744365bdf19f41bb135248693372a4e1be5152bd9a7c0065984cfe060`。最终只增加 root 背景 CSS，B 独立逐字核对 inline JS 与 style 外全文摘要相同、差异准确仅一条背景规则，并重跑受影响 24 组视觉；原交互结论仅按这个无行为变化依据适用，没有宣称59b9全量重跑。

下表的“通过”仅表示**准备合同和合成交互符合本轮准备要求**。所有 AB01–AB18 的真实产品验证及 E01–E08 均未实施，不能据此填成工程 PASS。表中共享证据不降低逐项覆盖。

证据简称均在 `.local/agent-brain-main-update/independent/`：

- **V**：`check-ui-final.mjs`、`final-ui/receipt.json`，15 路由 × 1440/1024/390 × 明暗的 90 张新截图及正常闭环截图；`final-ui/screens/<宽度>-<主题>-<路由>.png`。
- **S**：`check-scenarios-final.mjs`、`final-scenarios/scenario-receipt.json` 和 `final-scenarios/screens/`，11 个异常/补充场景及六用途/事项/来源恢复。
- **R**：`check-resource.mjs`、`final-resource/receipt.json` 和截图，资源/费用、接入门槛、正常与修订计额、授权快照和暗色。
- **F**：`check-focus-delta.mjs`、`focus-delta.json`；显式等待真实返回焦点后，原 Case 的 choice 事项、projects 页签、all 范围和来源项目按钮准确恢复。
- **B**：`check-background-delta.mjs`、`final-background/receipt.json`，最终59b9候选四个短页×三宽×明暗24组root/body颜色相同且无溢出，`final-background/`原图；JS摘要`30cd0c08d1199dbc999b2f4cf244baea090a7f74d77f87d258fdd455d239b473`保持。`final-overview/`为6946的六组页面首屏总览，已实际查看。
- **D**：本次独立回读 spec/tasks/Issue/decisions/guide/reuse/main-alignment/ui-mapping/notes/preparation-matrix/result 与 `AGENTS.md`、工程规范、会话说明；具体文件摘要记录于 input-manifest。

## spec 全部章节

| 基准 | 预期 | 实际合同/原型入口与证据 | 差异及结论 |
| --- | --- | --- | --- |
| §1 | 新 main、v0.2 与历史 v0.1 分开 | spec 依据表、D；旧 e456aa58 和旧复核原样保留 | 通过准备；旧 PASS 不外推 |
| §2、2.1 | 六用途原 Task；单一 Decision Case；原记录不被外派接管 | `renderHome/renderCases/renderCase/renderProjects/renderProject`，V 各页面；`home-pending`/`case-issues` 原权威核查 | 原项目 Task 行摘要已依 PM 决定同步合同；无首页外派收件，准备通过 |
| §3 | 一次必要授权后自主；缩小、取消、正常及必要业务决定 | `openAuthorization/authForm/grant`；V 授权取消/映射排除，S human，R 资源快照 | 原缺费用/资源摘要已补；准备通过 |
| §4 | owner/CaseIssue/GitHub/work/claim/delivery/navigation origin 分离 | spec 身份表、main-alignment MA04–08；`enterTask/taskEntryBanner`；V、F、S | 原 Task/事项/范围/草稿/焦点保全；持久表待工程 |
| §5 | work revision 级唯一派发；UNKNOWN 只读核定 | D、S unknown 与 check-receipt；`runAutonomy/checkReceipt` | 合同及原型通过；真正跨 turn/重启唯一性待工程 |
| §6 | 通用协议＋WorkBuddy 本机 API；认证领取、账号游标、单执行器与实号未证 | D integration-research、S duplicate/executorbusy/unconfigured，R | 不把 message_id/聊天当任务身份；标准协议/实号待工程 |
| §7 | 原运行端资产、精确交集、只读 MCP/OAuth 与私有管理面 | D，`renderAssets/readAsset`；S 5 类读取反例、身份/离线/过期 | 准备通过；真实 TLS/OAuth/权限/原子性未运行 |
| §8 | 外部 Ref、逐件保全、失败/旧版/采用限制与候选/发布分开 | `renderDelivery/artifactManifest/acceptDelivery`；V 正常映射排除，S failed/supplement/旧交付 | 准备通过；没有真实附件字节或 native 报告保存 |
| §9 | 原 owner 新 turn、非用户原话、持久预留、stop/暂停/取消分离 | D spec/main-alignment；S busy、pause/reload/resume、late/cancel；`workWarning` | 准备通过；静态页无持久后台，真实恢复待工程 |
| §10 | 最新日常骨架、四区、准确返回、亮暗三宽、无多余必做动作 | UI U01–14 下表；V、S、R、F、B；已读 DOM/CSS | 短页背景接缝已最小修正，准备通过；未用 Demo 冒充真实产品 |
| §11 | AB01–18 完整，工程/真实采用分开 | 下表及 D 的 Issue 清单、tasks E01–08 | 全部工程 AB 保持待执行 |
| §12 | Interface v3、固定官方包、唯一接缝、设计确认/发单/截图门禁 | D spec/tasks/Issue；本轮产品/依赖/测试无修改 | 准备通过；未实施、未发单、未开 PR |

## AB01–AB18

| 基准 | 准备预期与实际证据 | 差异/准备结论 | 产品工程结论 |
| --- | --- | --- | --- |
| AB01 | D 原 Task/六用途/受限 profile；V 原入口及 S six-purpose-*、per-issue-drafts、F 返回 | 准备通过 | 待执行：真实 owner/共享项目/受限会话回归 |
| AB02 | V 取消零授权、映射缩小与一次授权自主；R 资源快照/计额/缺策略门槛 | 旧资源缺口已修齐，准备通过 | 待执行：真实零副作用/增权拒绝 |
| AB03 | D message_id/联用未证；S executorbusy、setup，R 首次接入 | 准备通过；未宣称实号就绪 | 待执行；实号另证 |
| AB04 | S unknown-no-republish；`checkReceipt` 保留同请求 | 准备通过 | 待执行：跨 turn/重启/丢回执唯一性 |
| AB05 | D 私有仓库/精确正文/换号/可见性/公开授权负例，授权与工单合成预览 | 合同通过 | 待执行：真实连接器身份与出站核验 |
| AB06 | D principal/claim/epoch/revision；S duplicate、late | 准备通过 | 待执行：真实原子竞争/幂等/认证 |
| AB07 | D 目录/正文/分页/trace 同交集；S 越任务/身份拒绝 | 准备通过 | 待执行：完整元信息/正文零泄漏 |
| AB08 | V 资产原文/版本与 S wrong-version/offline/expired/revoked | 准备通过 | 待执行：真实异步前后资格/版本核验 |
| AB09 | D 官方固定 MCP、TLS/OAuth/PKCE/resource 等及错误码 | 合同通过；静态 UI 不提供安全证明 | 待执行 |
| AB10 | D 资产只读与工作权限分组，reason/pack-read/任意执行拒绝 | 合同通过 | 待执行：标准客户端实际负例 |
| AB11 | V 两件合成保全、S failed/仅链接/旧版，`artifactManifest` | 准备通过；无真实下载或保存字节 | 待执行：分片/限额/幂等/路径/实际 hash |
| AB12 | V 候选待核定、原首页两请求/项目等待/Case原报告不变；S human/supplement | 准备通过 | 待执行：真实 Agent/Case/目标来源闭环 |
| AB13 | D 指纹/providedContext/origin.userText=false；S busy/暂停重开/恢复 | 准备通过；静态 timer 恢复限制明示 | 待执行：原入口/accepted未知/串消息/配置变化 |
| AB14 | S idle-task-card-pause/cancel/late/expired；`stopWork` | 准备通过；不声称第三方停止 | 待执行：真实 stop/cleanup/持久暂停/租约 |
| AB15 | D 旧 native/文件/草稿保全和兼容回退；V/S 草稿与原入口恢复 | 合同/原型通过 | 待执行：真实持久兼容/回退 |
| AB16 | V 90 张6946新图、DOM/CSS阅读、S/F 交互焦点、R 新摘要、B 最终背景修正24图 | 准备通过，按精确JS/DOM无变化依据应用交互结论 | 待执行：真实 App 同视口对照 |
| AB17 | D 四原则、Interface v3、Pi1.4.0/MCP1.32.2和缺口/复用来源 | 准备通过；无产品与官方包修改 | 待执行：真实接缝/原包/消费者与负例 |
| AB18 | D Issue/tasks含三基准/非作者/开PR前实际产品截图用户确认/两段CI | 工程门禁准备完整 | 待执行；实号/部署/专业/产品验收 NOT_RUN |

## Demo U01–U14

| 基准 | 预期/实际 DOM、入口及截图/实跑 | 差异/结论 |
| --- | --- | --- |
| U01 | `renderHome`，`#home`，V home；正常接受后 pending-count=2、original-project-wait 保持；home-intake 往返 | 无首页外派收件，准备通过 |
| U02 | 180px `.rail`，单一 Decision Case；`areaTabs` Case总览/全部项目；V cases/projects | 新 main 导航骨架清楚，准备通过 |
| U03 | `caseHeader/caseCurrent/issueNavigation`，240px 左事项和右工作；V case-current，S case-tree、事项草稿，390 selector | 列表/树、轮次、G/S与草稿保留，准备通过 |
| U04 | `scopeSelect/scopedTasks/taskRows`，当前/全部/其他事项范围，V case-projects、F 精确返回 | 原项目 Task 行也可只读摘要已同步合同；准备通过 |
| U05 | `caseArtifacts/caseHistory`，V case-artifacts/history；S history-does-not-change-current | 外部附件未自动入 Case；准备通过 |
| U06 | `renderProjects/renderProject`，V projects/project；S 六用途筛选 | 一个代表项目/Case，独立入口可体验但未伪造独立项目存在；准备通过 |
| U07 | `renderTask/renderReport/renderDraft/taskEntryBanner`；V 三类草稿/映射排除/原报告，F 返回 | 原 Task 与独立浏览 origin 分开，准备通过 |
| U08 | `openAuthorization` 原生 drawer；V focus-trap/Escape/cancel/scope，R 390/暗色资源摘要 | 资源费用缺口修齐；准备通过 |
| U09 | `renderWork/progressSteps`；V work、S 状态场景；授权后自动接受无需每次人点 | 通信/触发/领取/保全/接受分开，准备通过 |
| U10 | `renderAssets/readAsset/sourceDialog`，V assets，S 读取负例/identity/offline/expired | 原文/引用保留、实际读取与授权区分，准备通过 |
| U11 | `renderDelivery/artifactManifest/attachment`；V正常、S failed/supplement旧版，候选 | 逐件模拟保全、映射未取用与候选未发布清楚，准备通过 |
| U12 | `renderSetup/setupReady`，V setup，R 缺策略→各项→完整联通 | 单项/完整/实号分开，准备通过 |
| U13 | S unknown、duplicate、executorbusy、identity、offline、expired、failed、late、human、busy、supplement与cancel/resume | 正常/失败/可模拟恢复覆盖；静态页没有真实后台，准备通过限本范围 |
| U14 | V 明暗×三宽×全部15路由均无文档横溢；表格自身滚动；Tab/Escape/焦点；CSS变量、R暗色与B最终背景24图 | 已实际查看关键原图、六组视口主题总览及最终背景原图；真实产品对照待实施 |

## tasks 全部阶段

| 任务 | 预期/本轮证据与结论 |
| --- | --- |
| R01 | D、Git基线/规则读取；新 main 已合入，准备通过 |
| R02 | D main-alignment MA01–10/reuse及独立源码核对；新旧权威与差额清楚，准备通过 |
| R03 | D spec/tasks/Issue/decisions同步新范围和门禁；两项发现已修齐，准备通过 |
| R04 | V/S/R/F 新默认首页/四区/原Task、DOM/CSS与生产映射，准备通过 |
| R05 | 本矩阵、固定清单、V/S/R/F及原失败边界；准备复核完成后由PM记录结果 |
| R06 | 用户尚未整体确认 v0.2；待用户决定，不能填完成 |
| R07 | 未推送确认版/未发布 Issue；待执行，草稿占位有明确替换门禁 |
| E01 | D记录/授权/原子性合同明确；工程实现、真实RED/持久兼容待执行 |
| E02 | D供应商/唯一操作/资源/未知合同明确；工程及API闭环待执行 |
| E03 | D MCP/OAuth/资产交集与禁用能力明确；真实标准客户端/服务待执行 |
| E04 | D同owner/指纹/保全/业务隔离；合成S不代替真实模型/保存，工程待执行 |
| E05 | D编码前实际阅读与映射/切片返工对照/全视口；真实UI待执行 |
| E06 | D公共消费者/第三消费者/固定包/兼容负例及首页权威；工程回归待执行 |
| E07 | D非作者矩阵→实际产品截图展示与用户确认→开PR→实际headCI→合并→main push CI→结案；全部待执行 |
| E08 | 实号WorkBuddy/MCP/HTTPS与指定业务仓库、设备服务、专业和完整产品体验均NOT_RUN |

## 四原则专项

| 原则 | 实际核对与结论 |
| --- | --- |
| Host 管环境 | 可信身份/授权/资源上限/收件/保存/续接条件交Host；接受内容、选择方法交原Agent。资源3次是上限，不是必做返工配额。准备通过；真实实现待工程 |
| Agent 自主执行 | 一次授权后自动派发/查读/核验/原范围补充；人的介入只为首次范围/超范围/必要取舍，正常无人工接受闸门。准备通过 |
| 优先复用Pi | 明确原project-tasks owner、startProjectMessage、Interface v3及官方固定Pi/MCP；只把外派业务记录、后台只读、持久唤醒和origin列缺口，不造Runtime。合同准备通过 |
| 减少人的操作 | 日常从已有工作进入；默认当前Task资产可缩小，一次范围授权；无逐条读取审批、手填机器ID或手搬回执。接入/追溯按需，资源策略不新增每次必填。准备通过 |

## 原失败和限制

初轮 f2c10e HTML 的全局项目行摘要范围与文档不一致、费用资源摘要缺失，均保留发现并由作者/PM修齐后按6946bc复验；随后6946暗色短页面露出旧root背景，最终59b9仅补CSS并由B复验。首轮 mapping 预览全文排除断言误命中工作片段名，已修正为准确“只读资产”项；旧原始receipt未覆盖。异常脚本的提前重开造成模拟保全timer丢失，符合静态页无持久后台边界，修正检查次序后通过；不能据此推断真实Host恢复已通过。aggregate焦点断言在requestAnimationFrame前读取而失败，F等待真实焦点复测通过；原失败保留。

`file://` 用户启动、真实产品源码运行、真实附件字节、TLS/OAuth/MCP、WorkBuddy/GitHub实号、模型、部署/设备、PR/CI/合并、用户设计及产品确认均未执行。内部 HTTP 仅加载本地合成 HTML；原型/截图不是实际产品验收。

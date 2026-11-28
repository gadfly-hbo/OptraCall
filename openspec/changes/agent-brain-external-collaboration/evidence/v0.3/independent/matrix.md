# v0.3 非作者逐项准备复核矩阵

基准：初读spec SHA256 `56522ef4db656ed047864cd9cc897fec0544bb627dd5fcf8bf26af82a27d9375`；tasks `081590164b9d4f7e3a8abac465e85eb5f4d1cb1f5e5b6c4a2ced93ce6beda8a1`；初读Demo `06804f28f668b2acceb9a22e65647ed2ea9b48dc708610a366f5bd9505630efe`，最终单行修订Demo `9a5626d5efe69f2d5a4c22ee234919a4abd07e4c190a0fb996a9449cd062fcb4`。全部是待用户确认的准备候选。

“准备通过”仅指规范合同、文件一致性或静态合成UI；本轮无真实产品。所有实际Host/Pi/TLS/OAuth/原子性/持久化/供应商和专业验收均待工程或E08，不从本表推断实现通过。JSON检查名是可追踪证据；截图在本目录。初轮焦点立即观测失败与补充修正、CSP诊断失败均保留。

## spec §1–12

| 基准条目 | 独立预期 | 实际入口/代码与证据 | 差异 | 准备结论/后续 |
| --- | --- | --- | --- | --- |
| §1目标/依据 | 内部可选、GH核心、WB可选；main与历史准确 | spec/research/decisions/changes；input-manifest；static-checks | F01旧研究混整体门槛已修 | 准备通过；真实能力待验 |
| §2职责/范围 | 六类原Task；Host环境、Agent方法；受限profile不增权 | TASKS/renderTask/renderProject；checks六类内部；spec§2 | 无；静态不执行profile授权 | 准备通过/工程待验 |
| §2.1工作台 | 单Decision Case/同级全部项目/四tab；人的请求/项目等待/Case成果权威不变 | renderHome/renderCase/caseArtifacts；case-original-authority.png；checks接受保留原请求/等待 | 无 | 准备通过/来源授权待验 |
| §3三路径/门槛 | 全未配内部；GH独立；WB单项不足/真实联合后才选；资源分离 | setupReady/wbReady/openAuthorization/authForm；internal-unconfigured/github-accepted/wb-simulated-verified；checks+supplement | 另一Task内部误拦已由单行修订和delta覆盖 | 准备通过/实号待验 |
| §4记录/原来源 | project/task、CaseIssue/GHIssue/work身份分离；准确origin/焦点/草稿；版本保留 | enterTask/taskEntryBanner/return-case/selectTask；supplement来源四元组/焦点；return-origin-focused.png | 首轮焦点观测过早，等待真实hashchange后通过 | 准备通过/持久记录待验 |
| §5GH/唯一派发/同步 | 可信仓库固定内容；UNKNOWN不重发；评论不授权；有限只读收件 | runAutonomy/checkReceipt；unknown-preserved.png；checks UNKNOWN不重发/重开 | UI为模拟发布/查询；无真实轮询 | 合同准备通过/工程待验 |
| §6通用协议/WB | 认证claim/epoch、续租、幂等/迟到；WB游标非Task、单连接占用仅该适配 | spec§6；runAutonomy/readAsset/recordAutoReads；unclaimed-read-denied.png；research§2–6 | 不把演示步骤当原子性证明 | 合同准备通过/工程待验 |
| §7MCP认证/只读 | 精确交集、撤销后返回复核、OAuth/TLS/管理面隔离；无latest/执行 | spec§7；renderAssets/readAsset；identity/offline/expired-blocked截图；research | Demo没有真实TLS/OAuth/服务器 | 合同准备通过/工程待验 |
| §8保全/验收/经验 | 外部来源独立；字节/hash保全；缺件不接受；补充同work/Issue；接受非发布 | renderDelivery/acceptDelivery/prepareArtifactPreservation；failed-manifest/supplement-v1-failed/supplement-v11.png；supplement缩小映射 | 模拟文件，无真实字节写入 | 准备通过/工程待验 |
| §9续接/停止/恢复 | 同owner准确receipt+非用户原话；busy/paused待处理；UNKNOWN/取消/迟到不重放 | spec§9；reviewDelivery/acceptDelivery/stopWork；busy-pending/late-quarantine.png；checks恢复后接受 | 未跑native指纹、迟到cleanup、真实租约 | 合同及UI准备通过/工程待验 |
| §10UI/操作 | 原Task主入口；三路径；亮暗1440/1024/390；键盘/焦点；读DOM/CSS映射 | render函数、media/theme CSS；checks 90组route×宽度主题无横溢；corrected-*授权图；ui-mapping | 首轮暗色授权文件名误标，纠正原图另保留；真实产品未实现 | 准备通过/产品截图门禁待执行 |
| §11AB/实号边界 | AB01–18可检出明确负例；核心工程与WB实号不互代 | 下表、tasks E、research、issue-draft；issue155-readback | 无；E08未跑明确 | 准备通过/全工程待验 |
| §12责任/交付 | Interface v3/固定包/唯一owner；先准备确认、不领取/PR；三基准独立矩阵与未来截图确认 | tasks/issue-draft/reuse；static-checks无产品差异；Issue Open/0评论读回 | 无；实际预览提交/Issue顶部链接由PM稍后绑定 | 准备通过；用户确认/工程待执行 |

## AB01–18

| ID | 预期与负例 | 实际入口/状态/证据 | 差异 | 结论 |
| --- | --- | --- | --- | --- |
| AB01 | 六Task内部可用，外配全缺零动作；原绑定/草稿不变 | checks内部零auth/read/event/API/六类；delta另一Task内部；renderTask | 无；profile运行未测 | 准备通过/工程待验 |
| AB02 | 明确授权；取消零动作；核心1/24与WB3分离/快照 | checks默认/取消/资源0；authForm/authSummary；corrected授权bottom图 | 无 | 准备通过/工程待验 |
| AB03 | 无WB完成GH；WB单项无效、模拟联合后可选；跨环境不承诺开机 | checks GitHub接受/WB gate；supplement WB修订额度；research§6 | 实号未跑且禁用合同明确 | 准备通过/实号待验 |
| AB04 | 稳定发布操作、UNKNOWN只核原回执、不重发 | checkReceipt/runAutonomy；UNKNOWN截图/JSON | 未测试跨进程原子去重 | 合同/UI准备通过/工程待验 |
| AB05 | 可信仓库/出站内容；公开、夹带凭据、换号拒绝 | spec§5、authSummary、issuePreview；静态CSP无外站请求 | 真实供应商负例未跑 | 合同准备通过/工程待验 |
| AB06 | principal+单claim/epoch；评论非权限；竞争冲突 | spec§6；未领取read被拒；runAutonomy duplicate分支审阅 | 真实并发/renew/deliver待验 | 合同准备通过/工程待验 |
| AB07 | 精确交集、显式企业、目录trace分页不泄漏 | spec§7完整合同；readAsset other分支；研究认证限制 | UI不是权限实现 | 合同准备通过/工程待验 |
| AB08 | exact版本/hash/来源；撤回/缺件不latest | ASSETS/readAsset；blocked截图；资产固定原文/来源 | 真实store版本待验 | 合同/UI准备通过/工程待验 |
| AB09 | 实际TLS/OAuth/PKCE/401/403/429/管理面路由 | spec§7/research§3+6；固定SDK声明 | 本轮未启动服务/部署 | 合同准备通过；工程待验证 |
| AB10 | 资产只读，不执行reason/pack/code/SQL/发布 | spec§7/AB10；reuse审阅受限actions | 未实际调用工具拒绝 | 合同准备通过；工程待验证 |
| AB11 | ExternalDeliveryRef独立、字节manifest/限额/分片/幂等 | spec§8限额明确；failed-manifest.png/附件UI；checks失败不接受 | 没有真实传输/文件保全 | 合同/UI准备通过；工程待验证 |
| AB12 | Agent验收；Issue关闭≠接受≠Case/目标/发布 | accepted/failed/supplement/human各状态；checks原请求2/项目等待；caseArtifacts | 无静态权威越界 | 准备通过/真实业务待验 |
| AB13 | busy待处理、空闲同owner一次续接；准确指纹、非用户原话/不覆盖草稿 | spec§9精确字段；checks忙/暂停/恢复/草稿；main-alignment | 未真实native/双work消息交错 | 合同/UI准备通过；工程待验证 |
| AB14 | stop暂停vs取消撤权分开；外部停止未知；迟到不复活 | stopWork/requestStop/pause-task；late-quarantine/busy-pending；checks | 租约15m/5m只合同未实际计时 | 准备通过/工程待验 |
| AB15 | 旧项目/native/资产/草稿保全；回退不重放 | spec§4/8/9/12；static-checks旧v0.2逐字节保留；导航草稿 | 没有生产迁移，不能声称数据兼容实测 | 合同准备通过；工程待验证 |
| AB16 | 三路径+真实浏览器/DOM-CSS/布局/失败恢复；旧PASS不覆盖 | checks/supplement/delta；截图；本矩阵页面/状态部分 | 首轮脚本观测失败已保留/纠正 | 准备通过；产品对照待实现 |
| AB17 | Interface3/Pi1.4.0/MCP1.32.2/统一owner；Host环境Agent方法 | spec§2/12/reuse；package声明只读；static无代码/依赖差异 | 未跑公共消费者/第三合成接入 | 合同/四原则准备通过；工程待验证 |
| AB18 | 核心工程独立、WB模拟合同另验/实号禁用；产品截图确认+head/main CI | tasks E07/08、Issue/研究；三基准独立矩阵 | 本轮只有准备；无PR/CI/真实产品截图 | 准备范围通过；工程/实号全部待验 |

## tasks P/E

| 项 | 预期 | 实际证据 | 差异/适用性 | 结论 |
| --- | --- | --- | --- | --- |
| P01 | main/规范/Issue核对，不领取 | manifest74030911；AGENTS/工程规范§2–4；issue155-readback Open、owner gadfly-hbo、comments0 | 只读远端，没有写评论/领取 | 准备通过 |
| P02 | 全件同步三路径与门槛/额度/限制 | spec/decisions/guide/notes/mapping/changes/issue-draft/research/reuse | F01研究已修、旧研究原样保留 | 准备通过 |
| P03 | Demo三路径/原来源/草稿 | checks/supplement/delta+截图；最终Demo9a5626… | 另一Task内部误拦已修 | 准备通过 |
| P04 | 浏览器/三宽度亮暗/键盘失败恢复/非作者矩阵 | 本矩阵+report/checks/supplement/delta；逐张实际查看代表原图 | 原脚本失败和错名原图保留；file协议本独立复核NOT_RUN，作者有管理员阻断记录 | 准备通过 |
| P05 | 全包交用户一次确认 | spec/tasks/Issue待确认表述 | 尚未发生用户确认，不能勾完成 | 待用户确认 |
| E01 | 原Task选择/授权/记录和保全 | spec§3/4/AB01/02/15、Demo行为 | 产品未实现 | 待工程 |
| E02 | GH独立发布/修订/认证claim/UNKNOWN幂等 | spec§5/6/AB03–06；纯GH/UNKNOWN原型 | 产品未实现 | 待工程 |
| E03 | 原实例标准MCP/OAuth/交集/只读/分片 | spec§7/AB07–11/研究 | 产品未实现 | 待工程 |
| E04 | 字节保全/native来源/同owner/恢复/草稿/Case权威 | spec§8/9/AB11–15；Demo状态 | 产品未实现 | 待工程 |
| E05 | 可选WB合同/门槛/无隐切/额度/边界 | spec§3/6/AB03/研究；WB gate原型+supplement | 产品未实现；实号启用另E08 | 待工程 |
| E06 | 编码前读Demo映射/全UI与公共接入回归 | spec§10/AB16/17；ui-mapping/本矩阵 | 本轮读原型不是领取者未来回执/真实产品对照 | 待工程 |
| E07 | 标准Host/Pi/MCP/TLS/OAuth核心闭环，非作者/截图确认/CI/授权合并 | spec§11/12/AB18/Issue门禁清楚 | 无产品、无PR；不能用本原型截图代替 | 待工程 |
| E08 | 另授权真实账号/公网/设备/专业体验，WB具体配置实号后启用 | spec§3/11/research明确NOT_RUN/integration_unverified | 未测试任何真实账号/公网/设备 | 待授权及实号验证 |

## Demo 页面、导航、布局与状态

页面基准统一为最终9a5626…，未改动的页面函数沿初读06804…证据，单行变化只影响choose-internal判定。全15页×3宽×2主题90组无document横溢（checks）；原型完整长表在容器滚动。布局读码：180px rail，Case双列事项区+主区；1130/860/760/620响应式层级；data-theme CSS；modal dialog-shell/head/body/foot，body独立滚动；Tab trap、Escape、pendingNavigationFocus。拟生产接线见ui-mapping（未实现）。

| 页面/状态 | 预期/实际入口与骨架 | 实跑/图证据 | 差异/结论 |
| --- | --- | --- | --- |
| home | 表达区/原待回应/继续工作/原项目等待；无外派首页队列 | visual-*-home；checks pending-count/项目等待 | 准备通过 |
| cases | 单Case总览与同级全部项目 | 90组route布局检查；renderCases/areaTabs | 准备通过 |
| projects/project | 原搜索/筛选/共享信息/6类Task；独立入口不猜Case来源 | checks独立项目不猜来源；renderProjects/renderProject | 准备通过 |
| case/current | 事项/轮次/当前工作/原Case草稿；列表树和窄屏选择 | visual-*-case-current；checks各事项草稿；issueNavigation | 准备通过 |
| case/projects | 手选范围/准确Task行/来源返回 | checks+supplement精确四元组/焦点；return-origin-focused | 准备通过 |
| case/artifacts | 仅原关联成果；外部接受不冒正式依据 | case-original-authority.png；checks | 准备通过 |
| case/history | 原事项历史/轮次/请求独立于work revision | 90组route检查；caseHistory审阅 | 准备通过 |
| task六类 | 原对话/草稿+侧栏内部/GH选择；原归属 | internal-unconfigured/delta-other-task-internal/visual-*-task；checks六类 | 准备通过 |
| report/draft | 原报告/UNKNOWN和准确引用；Task草稿跨页、原Case返回 | checks/supplement原草稿/来源；renderReport/renderDraft | 准备通过 |
| work | 发布/触发/claim/read/delivery/review事实分离；高级回执按需 | github-accepted/unknown/busy/supplement/blocked截图 | 准备通过 |
| assets | exact资产列表/正文/引用/只读/失败理由/读取回执分开 | unclaimed-read-denied；readAsset审阅；缩小映射supplement | 准备通过 |
| delivery | 外部来源manifest/保全/Agent理由；接受≠发布/经营效果 | github-delivery/failed-manifest/supplement-v11/late-quarantine | 准备通过 |
| setup | 核心与WB两分区，API/Connector单项不等联合通过 | wb-simulated-verified/visual-*-setup；checks WB gate | 准备通过 |
| 授权抽屉 | 默认GH/WB禁用或显著模拟可选；资产可缩/资源快照；内部/取消/确认 | corrected-{1440,1024,390}-{light,dark}-authorization(-bottom).png；键盘/Escape/焦点 | 准备通过；原错主题文件名不作暗色证据 |
| 正常三路径 | 未配内部零动作；GH独立；WB模拟已验后选 | checks三路径；delta纯GH | 准备通过 |
| 等待/UNKNOWN/重开 | 无claim不读；UNKNOWN只查原请求、不重发 | checks/unknown-preserved/unclaimed-read-denied | 准备通过；后台/持久只合同 |
| busy/暂停/恢复 | busy待处理；暂停后空闲不核验，恢复再接受 | checks busy+resume；busy-pending | 准备通过 |
| 补充/缺件/超范围 | 同Issue/revision旧FAIL保留；缺件不接受；保持原范围后恢复 | checks+supplement；supplement-v1-failed/v11/failed-manifest | 准备通过 |
| 身份/离线/过期/取消迟到 | 拒新读；撤权后外部停止未知，迟到隔离不复活 | identity/offline/expired-blocked/late-quarantine；checks | 准备通过；真实授权/租约待验 |
| 跨Task内部 | 另一Task内部不改现有work，同Task不静默切换已外派 | delta.json/截图；最终choose-internal ownAuth判定 | 准备通过 |

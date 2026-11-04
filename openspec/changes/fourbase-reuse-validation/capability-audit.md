# 开工前审查：全产品现状、能力差额与Host／Agent原则

2026-11-03 · M1 RV07／RV08审查证据，不是第二份产品方案。

## 范围与判定口径

用户要求在正式功能开发前确定：是否核过OptraCall现状与已有能力、是否只补缺口或新增而不重复；最高原则“Host管环境，Agent自主执行”是否被方案严格遵守。本记录对应[模块规格](spec.md)，产品目标仍以已通过的[整体方案v1.2](../../../docs/fourbase-doublebase-plan.md)为唯一正文。

固定源码HEAD `fd6f9714909d1628cd81d751f7fe9537af9b5b6f`；本地main `484995d908087449e64e9c352b9d5e33d8358afd`相对仅多四份SimLab记录，产品源码相同，未联网核对实时远端。v1.2 SHA-256仍为`7a165e26f82674b1d2bda0b79fd2fde9f246f06dccceb0c95c2db6354e947ff0`。

盘点从前端实际导航、Host静态注册、业务入口与存储权威交叉核对，覆盖下列21个产品能力域。图谱`optracall-fourbase-phase01-fd6`有3931节点／12109边、254个文件节点，但只识别6个Route，不能拿图谱路由数量冒充全部HTTP接口；手写路由、闭包和漏索引工具按已定位文件／import补读。五个业务插件由Host静态注册，不是已具备通用manifest自动加载平台。

“已有”表示当前固定源码有实际可达行为，不表示每个功能、每个分支、每个运行环境都在本轮重新实测。49项代表测试的准确范围见[结果](result.md)；没有以这些测试宣称全产品、真实模型、专业可靠性或用户验收通过。本轮没有读取业务dataRoot／凭据、安装组件、切换服务或操作MacBook。

## 全产品能力域清单

| 编号／能力域 | 已具备的能力与证据入口 | 本次如何处理；保留的限制 |
| --- | --- | --- |
| C01 工作台／导航 | [App](../../../src/host/ui/App.tsx)的AppView／openCatalogEntry接Case、项目、聊天、设置、Board、指标、需求、PPT、企业资料、SimLab与四类目录；帮助、主题和工作页状态已有 | M2–M6沿原工作台接线，M8回归；不另建壳或四个工作台。此处为源码盘点，非本轮全UI点验 |
| C02 项目／多任务 | [ProjectStore](../../../src/host/project-store.ts)及[Host](../../../src/host/server.ts)已有创建、重命名、空闲准入归档／恢复、独立任务／配置／草稿／native指针／lastRun，三目录项目共享 | 全模块直接复用Project／Task身份和原存储，不创建游离任务或新项目库；归档不是删除，旧状态／UNKNOWN保留 |
| C03 配置／Pi导入 | [ConfigurationStore](../../../src/host/config-store.ts)、[ModelSettings](../../../src/host/ui/ModelSettings.tsx)已有五预设／自定义模型、凭据保存／清除、版本绑定、用户选择Pi auth文件导入和短句连接检查 | M1／M6／M8复用，不新增记忆专属凭据系统；未读真实凭据或调用连接检查，短句成功不证明工具／分析质量 |
| C04 Pi会话／原生交互 | [project-session](../../../src/agent/project-session.ts)的open／bindSession／command与[公共入口](../../../src/host/agent-sessions.ts)已有原生持久化、分支／fork／tree／compact／reload、事件／UI响应、owner占用／取消／关闭和配置快照 | 全模块直接复用，不另建会话、压缩、恢复或全局队列；原生委派不等于真实模型压缩质量通过 |
| C05 工具／skills／MCP与受管环境 | 同一[SDK生产入口](../../../src/agent/project-session.ts)已有普通codemode／tool_search／MCP／grep／find／ls及内置分析资产；受管任务安全工具委派和skills复制，封闭文本关闭外部资源 | 原生检索与工具已存在；按profile接入，不为扩展全局放开。skill目录可见不证明正文已读，010软约束不提供敏感隔离 |
| C06 文件／上传／报告 | [Host文件路由](../../../src/host/server.ts)与[ProjectStore](../../../src/host/project-store.ts)已有文件树、CSV／JSON／MD／TXT UTF-8 10MiB上传、010→020复制、显式报告保存、下载及expectedSha检查 | M2复用；差额是业务粒度／单位／结构观察、必要精确版本与关联，文件树不等于schema扫描；不重造上传，不冒称支持任意Office |
| C07 成果采用／有限固定副本 | [saveArtifactVersion／saveReport](../../../src/host/project-store.ts)已有一致性读取、hash、另存采用副本和复核 | M2／M4先验证已有机制覆盖新场景，仅补未覆盖内容；普通观察hash不保证旧字节，不能因此再建全域快照引擎 |
| C08 企业资料／知识来源 | [EnterpriseMaterialsStore](../../../src/host/enterprise-materials-store.ts)已有原件、正文修订、启停、来源／scope／生效时间／附件和精确revision；[prepareEnterpriseContext](../../../src/host/enterprise-materials-context.ts)已有目录、自主读与location／excerpt／full、Case补充 | M2直接复用；M3／M4只补整理知识／经验、用户保留及统一查找等差额。list会刷新派生目录，不是纯零写入历史读取；存入不代表真实 |
| C09 RAP需求梳理 | [requirements路由](../../../extensions/business-plugins/requirements-elaboration/api/routes.ts)已有实例、编辑、软门禁、确认／发布精确版本、生成及一次有限格式修正；Host显式送入普通任务 | M2／M5复用目标、事实、未知和发布引用，不重建需求Agent；未确认可起草，发布／送入原合同保持；方法假设不等于业务假设已检验 |
| C10 SAP指标资产 | [metric路由](../../../extensions/business-plugins/metric-factory/api/routes.ts)已有SAP0.2草稿、校验／审核／发布、不可覆盖版本、历史、项目启停与使用；[索引](../../../extensions/business-plugins/metric-factory/project/index-text.ts)提供按需定义位置 | M2仅补轻概念／字段映射，不另维护公式；M4保留旧SAP身份。发布不证明业务定义正确，索引属于软引导 |
| C11 Case／项目承接 | [case路由](../../../src/host/case-routes.ts)、[CaseStore](../../../src/host/case-store.ts)已有SQLite、创建编辑、judgement／nextStep、状态／关闭重开、notes／事件、关联项目／work／assignee、成果关联／采用与意图回执 | M2／M4复用；M5只补持续需求所需的假设反证／策略依赖及复核退出语义。原judgement／nextStep不是完整Hypothesis／Strategy；不重建Case |
| C12 Board／行动／反馈修订 | [Board路由](../../../extensions/business-plugins/decision-board/api/routes.ts)、[原会话适配](../../../src/host/decision-board-sessions.ts)已有报告聚合、显式抽取／停止、人工建议、采纳／驳回理由、负责人／截止日行动、状态、反馈修订／历史 | M3／M5／M6直接复用，不另造看板、行动或反馈库；done、评分和抽取忠实不证明因果效果或原建议正确 |
| C13 反馈回流／跨Case复用 | [反馈Host入口](../../../src/host/decision-feedback-routes.ts)已有旧反馈／报告／片段／引用预览→普通任务草稿→显式发送、由实际回复创建需求、Case选择／报告采用和意图恢复；[实施记录](../decision-feedback-loop/implementation.md)已有Case B拒用旧动作记录 | M4不是从零新增跨Case消费。M3／M4只接入新保留经验的个人查找及历史／归档／冲突语义，复用原交接。旧模型专业错和FAIL_OR_UNKNOWN保留，不把旧链路说成完整记忆库 |
| C14 独立核算／封闭出稿 | [核算会话](../../../src/host/verification-sessions.ts)及[公开Host入口](../../../src/host/server.ts)已有独立owner、固定输入、先冷读后作者、首次／比较／停止、修订／复查、导出和原件回读 | M1／M2／M4／M8复用，个人经验不自动进入冷读；不新增Host补算。B／C专业FAIL和相关默认能力UNKNOWN仍未解决 |
| C15 自动核算与原主Agent修订 | [自动链](../../../src/host/automatic-verification-host.ts)及[Host设置／状态](../../../src/host/server.ts)已有受信新任务工具前托管、原canonical主会话、独立核算、逐稿／复查、drain／停止收尾 | 复用原业务IO与生命周期，不另建链或修订Runtime；旧／重启未知起点不自动升级。有限专业验证FAIL，不宣传可靠自动纠错 |
| C16 PPT候选生成 | [App.generatePptx](../../../src/host/ui/App.tsx)从060报告创建原项目普通任务草稿，指向内置[ppt-report skill](../../../extensions/analysis-assets/ppt-report/SKILL.md)及脚本 | M2／M4成果表达复用，M8回归；不是新报告引擎。按钮创建草稿仍需显式发送；skill存在不证明某次生成或数字／视觉质量 |
| C17 PPT精修／版本／差异导出 | [PPT路由](../../../extensions/business-plugins/ppt-refiner/api/routes.ts)、[Host访问](../../../src/host/ppt-refiner-access.ts)和[会话](../../../src/host/ppt-refiner-sessions.ts)已有原项目／固定配置绑定、页锁、回退、turn／stop、渲染／页图、060导出、版本／差异及UNKNOWN | 直接保留，M8做受影响回归；旧deck无法核归属只读，渲染依赖实际Python／LibreOffice环境。原接线不通过与后续修复分别保留，工程修复不等于新视觉／真实Provider验收 |
| C18 SimLab推演 | [SimLab路由](../../../extensions/business-plugins/sim-lab/api/routes.ts)已有草稿CAS、运行历史、变体／扰动、快照和MD导出；[工具](../../../extensions/business-plugins/sim-lab/tools/simulation-tools.ts)有5个任务级开关工具，freeze由人确认 | M2／M5／M6复用假设模型计算与证据，M7不重复建设；确定性推演不是预测、实际反馈或因果效果，受管／封闭入口不擅自注入 |
| C19 回执／诊断／观察恢复 | [project-history](../../../src/host/project-history.ts)、[prompt](../../../src/agent/project-session.ts)和[UI观察](../../../src/host/ui/runtime-client.ts)已有native session／entry、provided-not-adopted、fingerprint、SSE心跳、有限重连／GET核对、诊断与UNKNOWN | M2–M4只补真实新来源含义，复用旧回执，不建全局上下文台账或回填历史。202、工具成功、retryCount不证明理解、正确或结算 |
| C20 健康／构建／启动更新 | [Host health](../../../src/host/server.ts)、[静态构建校验](../../../src/host/static-ui.ts)、[试用启动器](../../../scripts/trial-launcher.mjs)已有代码根／commit／tree身份、构建资产hash及start／stop／update | 本次保留，M8按有效授权使用；不重写更新器。本轮未启动服务、查托管CI、安装或更新设备，源码存在不证明实际运行采用 |
| C21 帮助／规划目录 | [catalog-data](../../../src/host/ui/catalog-data.ts)与[CatalogPage](../../../src/host/ui/CatalogPage.tsx)已有四分类、搜索／标签、详情及已接入与规划标识；[帮助页](../../../src/host/ui/HelpPage.tsx)为真实静态手册 | 不用规划目录过滤冒充个人资产查找；A02–A05、S01–S06、C01–C06、P01–P05为占位。P03“验证器”占位不代表C14核算不存在，原生MCP也不等于全部业务连接器已接入 |

## 模块差额与禁止重复项

| 模块 | 直接复用基础 | 只实施或验证的差额 |
| --- | --- | --- |
| M1 | C01–C21现状、Pi与原材料接缝、既有目标测试 | 全域能力映射和职责审查；不开发第二套底座 |
| M2 | C02、C04–C11、C16–C19已有无Case启动、多轮、文件／资料、原文修订、正式口径和成果固定能力 | 核查并最小补齐数据业务解释／结构观察、轻概念字段关联、必要来源版本和成果关系；已具备部分只验收，不再开发 |
| M3 | C06–C13原资料／报告／反馈、修订与文件检索 | 用户显式长期保留知识／经验、个人聚合查找；组件与最小持久结构先验证收敛，不把新名字当新库 |
| M4 | C07、C10、C13、C19现有固定内容、显式跨Case反馈交接与回执 | 将M3保留经验接入同一路径，检验新内容的适用／拒用、旧版本、归档／冲突／过期、同名及跨项目边界；不另建交接链 |
| M5 | C09、C11–C15已有Case、RAP、人的选择、行动、反馈与复盘 | 仅按持续需求补假设／反证、策略依赖和缺少的复核退出语义；不改名重建Board／Case／核算 |
| M6 | C12／C13／C18／C19已保存反馈、经验来源和假设模型证据 | 比较多个Case的条件／反例与记忆或方法增量，人工选择模式；真实反馈不足时不得标业务成熟 |
| M7 | C05／C18原生Python／文件工具与SimLab | 只有具体计算或关系缺口才比较DuckDB／Semantica等；“没有DuckDB”不等于“没有计算”，无触发可延期 |
| M8 | 原C01–C21及实际新增接缝 | 累计受影响与整体验收，分别报告能力完成、条件延期、真实试点／专业结果；团队企业沿主方案条件单独升级 |

盘点发现并纠正了一项实施表述风险：最初M4以“第二事项复用”为交付目标，容易被读成现有跨Case消费空白。已依据C13收窄总进度和M1结果，明确复用既有反馈回流，只增加个人保留经验的差额；M2／M5同样标明已有基础。未实施重复代码，也未改已通过v1.2正文。

## 最高原则专项检查

专项先完整检查v1.2 §1–13、附表及M1–M8，再抽核实际公共SDK入口、自动核算、PPT和SimLab。下面“通过”是方案设计结论；代码抽查只覆盖列明路径，不等于全部历史实现零问题。

| 项目 | 结论／证据 | 发现与边界 |
| --- | --- | --- |
| Host与Agent职责 | 通过：v1.2 §1–3、§8–9及工程规范§2；[project-session.prompt](../../../src/agent/project-session.ts)把请求委派SDK | Host交付目标／材料、管身份／权限／资源／记录；Agent选方法、工具、顺序和纠错。模块施工顺序不是产品Agent内部步骤 |
| 固定分析流程／方法配额 | 通过：§1.2–1.3、§6.1、§10–11；M1–M8未规定产品分析套路 | 代表样例、两事项验收和一次一个工程分支是开发安排，不要求每次分析照样执行；不凑假设或方法数量 |
| Host补计算或代业务判断 | 通过：§3.4、§4.4、§6–7；[自动链](../../../src/host/automatic-verification-host.ts)与[SDK入口](../../../src/agent/project-session.ts)抽查相符 | 结构／格式校验不判事实真伪，发现问题交给Agent；不根据评分、引用数量或tool成功自动证实原因、采纳策略或宣布收益 |
| Pi会话与SDK复用 | 通过：§3.1、§5、§9.4；[公共域](../../../src/host/agent-sessions.ts)、[SDK薄层](../../../src/agent/sdk.ts)、SessionManager／createAgentSessionRuntime | 未设计平行消息、工具循环、压缩、恢复或全局队列；普通记忆消费不新增会话域，第三方采用前仍须验证 |
| 普通操作自主性 | 通过：§1.3、§5.3、§8、§13 | Case／RAP／SAP非启动必填，普通读材料／工具迭代不逐条确认；用户保留、正式定义、权限变化与真实动作的确认保留 |
| 环境治理与独立性 | 通过：§9.4、§12及IN01–IN07；[open的profile分支](../../../src/agent/project-session.ts) | 预算、取消、原件保护、受管工具、fixed-draft／冷读隔离是必要环境治理；不得借接记忆组件放宽全dataRoot或祖先上下文 |
| 源材料、记忆与业务权威 | 通过：§2、§4–6、§9.2–9.3 | SQLite／文件／组件各守原权威；目标取舍、核验判断、长期保留、提供与引用分义；归档不改历史，不按次数自动晋升 |
| 条件增强与后续实施 | 通过：§7、§10–13，全部模块索引 | DuckDB／关系图不强制前置，未来结构仅补实证缺口；设计通过不能替代M2–M8实际代码与运行检查 |

三类易误判路径已另核查：

- **自动核算：** [complete](../../../src/host/automatic-verification-host.ts)按已确认[业务IO合同](../automatic-verification-revision/structure-decisions.md)冷读→对照→作者反馈→复查；接受意见请求上限、无新稿／相同字节／技术失败的收尾，不是Host替Agent选专业方法或判意见真假，普通分析不强制走此链。
- **SimLab：** [五个工具](../../../extensions/business-plugins/sim-lab/tools/simulation-tools.ts)按任务开关提供[确定性假设引擎](../../../extensions/business-plugins/sim-lab/kernel/engine.ts)，由Agent自主调用，不是主分析结束后Host补算；固化确认保护正式证据，不证明经营有效。
- **PPT：** [精修Host适配](../../../src/host/ppt-refiner-sessions.ts)每个用户turn一次lease.run，[路由](../../../extensions/business-plugins/ppt-refiner/api/routes.ts)前后复制／guard／锁页恢复／快照属于已确认工件保护和保存；本次抽查未见Host内部分析轮数或方法配额，原接线失败记录仍保留。

## 限范围结论与开工条件

1. **全域现状与复用差额：通过本次代码／文档盘点。** 已覆盖21个实际能力域，并按行为归并同名／异名能力；模块工作只补上述真实差额。没有发现模块安排需要重做原系统，发现的跨Case表述歧义已在实施索引修正。后续模块启动时仍核对届时源码／组件，不能靠本次清单永久推定能力不变。
2. **最高原则：方案设计通过。** 全部v1.2章节及模块安排没有要求Host编排分析、补专业计算、自动裁定业务事实或重建Pi能力；必要权限／取消／保全及业务IO合同不是干涉。实际抽查与设计相符，未发现本次设计必须修正的越界项。
3. **未验证继续保留。** 全产品运行、全部历史代码路径、动态第三方资源、未来实现及候选兼容未全面复测；本次49项只覆盖既有接缝。企业资料旧真实链PARTIAL／FAIL、B／C专业FAIL／UNKNOWN和自动修订有限专业FAIL不被本审查关闭。Git／CI、实际运行采用及真实业务试点分别记录。

以上为现状核查与专项审查证据；M1只有在完整候选完成[结果记录](result.md)中的最终非作者复核后才标完成。正式M2实施前先固定具体差额与最小范围；本记录不批准新持久结构或安装组件，也不重复请求已经通过的产品方向。

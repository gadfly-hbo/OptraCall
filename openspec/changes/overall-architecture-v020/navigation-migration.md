# M7 导航迁移与市场退出核对

2026-11-16。依据已批准 spec M7、A25–A28、J11 和仓库外 v1.1 §6.1–6.2。盘点为现存 27 项（14 项已接入、13 项规划）；场景组合及 S01–S06 已直接取消，不搬迁或转成任务。此文是工程导航材料，不复制产品基线。

**当前结论：导航退出所需技术路径已核对，过渡市场已移除并完成最新 App 浏览器复核。** Root 的原产品浏览器记录、本轮独立合成资料浏览器补验及原 Host／Pi 联合回归共同覆盖下述五项判据。此结论只说明使用、管理、异常和历史入口可达；专业能力本体质量、正常 PPT 页图渲染、真实模型专业正确、设备采用及业务效果不因此通过。Root 移除 App 的过渡设置项、整目录兜底及只服务市场的内存导航状态；具体能力资料、连接、模型包、13 项规划及原资产历史保留。

## 可核入口

- Task →「报告、方案比较与专业能力」：项目方案与 Skill 改选、局部需求与 RAP、项目报告及 PPT、原精修版本、推演、模型注册表、原任务能力与连接授权。打开入口不发送模型请求、不更改开关。
- Project Map → 项目详情：原任务、项目方案、需求与 RAP 历史、方案比较、PPT 历史。常规“新建任务”直接进入原项目 Plan，以稳定 UUID 增加待确认草稿；不先创建 Task，不经过旧 TaskDialog 二次填表。旧配置仅保留在明确的高级兼容入口。
- 设置 →「Skill 资料与依赖」：官方 SDK 实际资源目录的来源、内容 SHA 与版本；依赖声明和环境检查分开，未实查显示 UNKNOWN；原测评继续绑定原被测版本。
- 设置 →「连接配置」：原数据库共享配置弹窗；商圈原快照状态；天气原无密钥配置边界。项目资料和 Task 原显式启用不搬到全局配置中。
- 设置 →「业务模型包」：原注册表、导入、版本、失读与 UNKNOWN 原流程。与大语言模型供应商“模型设置”分开。
- 设置 →「接入规划」：只保留 13 项未接入说明，不包含已接入能力目录，不安装、不运行、不建任务。
- Studio → 企业基础资产 → 原专业管理：SAP 指标、SAP 方法／IR、企业资料，准确版本及历史沿原组件；未把 Skill、PPT 和运行配置塞入 Studio。

相关源码：[App](../../../src/host/ui/App.tsx)、[项目详情](../../../src/host/ui/ProjectBoard.tsx)、[具体设置与 Task 链接](../../../src/host/ui/CapabilitySettings.tsx)、[历史目录组件（已退出产品渲染）](../../../src/host/ui/CatalogPage.tsx)。

## 原目录逐项迁移矩阵

下表路径已在原产品浏览器或原 Host／Pi 联合回归中核对，具体证据见后文。六个分析 Skill 共用实际目录、项目改选和原 Task 运行接缝；导航验证不重跑每项专业测评。规划行仅核 13 项说明仍保留为未接入，不验其尚未实现的业务能力。

| 原 ID／能力 | 业务点击路径 | 必要管理／原权威 | 缺配置、无权与历史路径 | 实际核对 |
| --- | --- | --- | --- | --- |
| ppt-report／PPT 报告生成 | Task → 报告与 PPT 生成 → 原项目文件 060_reports 的 md「生成 PPTX」 | 原报告／生成回执；设置 Skill 资料 | 原文件失读及生成失败沿原入口；原报告与 PPT 文件不换版 | 导航 PASS N1/N2/N3；页图正常渲染 FAIL 另列 |
| target-forecast／经营目标测算 | Project 方案选实际 Skill → Task 原分析对话 | 设置 Skill 来源、版本与声明依赖 | 资料不足继续向原 Task 补证；Python/openpyxl 未实查为 UNKNOWN | 共用导航 PASS N1/N7；专业未重测 |
| coupon-forecast／优惠券测算 | Project 方案改选 → 原 Task 对话 | 设置 Skill 资料 | 原报告、无券基线和失败保留；环境依赖未冒通过 | 共用导航 PASS N1/N7；专业未重测 |
| roi-forecast／投放 ROI 测算 | Project 方案改选 → 原 Task 对话 | 设置 Skill 资料 | 原模型／资料失败回原 Task；不承诺预测或改善 | 共用导航 PASS N1/N7；专业未重测 |
| deep-research／深度研究 | Project 方案改选 → 原 Task 对话 | 设置 Skill 资料与原测评；模型／网络检索原设置 | 原检索路线可用性单独核；原测评不是新版重测 | 共用导航 PASS N1/N7；检索可用性不预设 |
| data-analysis／运营数据分析 | Project 方案改选 → 原 Task 对话 | 设置 Skill 资料与原测评 | 实际 Skill 版本及旧六段契约不因导航冒成新版；候选采用另记 | 共用导航 PASS N1/N7；Skill 契约与测评另核 |
| A03／假设与策略资产包 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → A03 | 原规划示例、未接入；不转任务 | 规划说明保留 PASS N1；业务未接入 |
| A04／实验与效果评估资产包 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → A04 | 原规划示例、未接入 | 规划说明保留 PASS N1；业务未接入 |
| A05／报告与表达规范资产包 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → A05 | 不因 PPT 已有能力而宣称该包已实现 | 规划说明保留 PASS N1；业务未接入 |
| trade-area-mcp／商圈数据 | Task → 任务能力与显式启用；Project 方案沿已有准确授权 ref | 设置 → 连接配置 → 原本机快照状态 | 缺快照如实显示并到原帮助；不自动导入、扩大范围或清历史 | 导航／任务显式开关 PASS N1/N6；缺快照保留 |
| weather-mcp／历史天气 | Task → 原天气显式启用及出境说明 | 设置 → 连接配置 → 原无密钥说明 | 本页不查询天气，网络 UNKNOWN；原失败／停止由原 Task 管理 | 导航／任务显式开关 PASS N1/N6；网络未测 |
| db-link／数据库与数据仓库 | Task → 项目资料与连接授权 → 原来源 | 设置 → 连接配置 → 管理共享数据库连接 | 原精确连接测试、项目范围／模型出口／预算／任务继承分别核；关闭弹窗回原位置 | 配置／授权／UNKNOWN 路径 PASS N6；活库未测 |
| C02／BI 指标与报表 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → C02 | 原规划，不授予 BI 权限 | 规划说明保留 PASS N1；业务未接入 |
| C03／业务系统 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → C03 | 原规划，不授予 ERP/CRM 读写权限 | 规划说明保留 PASS N1；业务未接入 |
| C04／办公文件与协作 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → C04 | 原规划，不冒充已接协作发送 | 规划说明保留 PASS N1；业务未接入 |
| C05／外部情报与专业数据 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → C05 | 与已接天气／商圈分开，不升级规划状态 | 规划说明保留 PASS N1；业务未接入 |
| C06／业务行动 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → C06 | 原规划，不自动创建工单或通知 | 规划说明保留 PASS N1；业务未接入 |
| requirements-elaboration／需求梳理 | Project 主需求 Plan；Task → 局部需求与 RAP | 原 RequirementPage 实例、草稿、发布及框架版本 | 原失读和旧版本状态保留；返回准确 Task；独立需求历史也从项目详情可达 | 原实例入口与输入保留 PASS N1 |
| P01／数据质量与业务对账 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → P01 | 原规划，不把已有通用工具推定为本插件已接入 | 规划说明保留 PASS N1；业务未接入 |
| P02／非结构化内容分析 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → P02 | 原规划，不声称分类质量通过 | 规划说明保留 PASS N1；业务未接入 |
| P03／分析结果验证器 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → P03 | 原规划，不因已有核查／审查而改写该条状态 | 规划说明保留 PASS N1；业务未接入 |
| P04／地理空间分析 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → P04 | 原规划，不因已有商圈数据而推定地图／空间运算已接 | 规划说明保留 PASS N1；业务未接入 |
| P05／Excel／BI 资产复用 | 实际问题仍可从 Project 提出 | 设置 → 接入规划 → P05 | 原规划，不声称已重算工作簿 | 规划说明保留 PASS N1；业务未接入 |
| decision-platform／决策看板 | 原顶栏决策；Task 结果与审查 → 原看板 | 原建议、选择、授权、实际发生及反馈记录 | 原准确报告／审查身份，FAIL／UNKNOWN 与旧稿保留；自动接续另验 | 原工作区及实际权限／反馈接续 PASS N1/N7 |
| ppt-refiner／PPT 逐页精修 | Task／项目详情 → 原精修历史；文件精修操作沿准确 sourcePptx/reportPath | 原 RefinerPage、deckId、版本、原生会话及 leave guard | 原失败与未知；返回入口时恢复原项目／Task／URL；不重导入候选版 | 准确历史／只读／返回 PASS N3；正常页图渲染 FAIL |
| sim-lab／经营推演 | Task／项目详情 → 方案比较与经营推演 | 原 SimLabPage 草稿、不可变快照；Agent 固化建议沿完整原身份 | 明确传入项目，禁止取较新项目替代；失配建议不替换最新运行；返回原工作 | 原项目／未保存输入／返回 PASS N1 |
| model-pack／模型包 | Task → 预测模型与原注册表；原工具开关仍在 Task | 设置 → 业务模型包 → 原 ModelRegistryPage | 原导入 UNKNOWN、损坏、固定版本与晋级状态保留；不自动重导入或执行 | 原注册表空状态／准确返回 PASS N1及移除后复核 |

原目录类型仍包含的旧管理定位 `metric` 和 `enterprise-materials` 分别回到 Studio 原 SAP 指标和企业资料专业区，不新建权威库。SAP／IR 原专业页从 Studio 管理方法进入，保持 methodId＋version；原资料保持 materialId＋revisionId。它们未被误计成上述目录中的新条目。

## 定位、返回与状态保留

1. 原 `?project=<id>&task=<id>` 精确保留归档或当前对象。不存在的项目／任务显示不可读，不再悄悄回退最新项目或最后一个 Task。URL 保留，权限由原 GET 和准入继续核定。没有指定对象时保留原默认选择行为。
2. 原 `?studio=<systemId>` 只有体系身份，没有发布版参数；**不能声称它是准确发布版本 deep link**。失读、未核企业或当前目录不可见时，保留原 ID、只读重查，禁止自动打开替代体系。用户可明确退回企业列表。
3. Studio 精确发布／资料版本使用原 `StudioSourceRef`、publication preview／result 和原专业页版本入口。合成浏览器已核指标 1.0.0／1.1.0、方法 v1 正式／v2 候选、企业资料两个准确修订及停用后历史原文；未明确企业时隐藏原专业详情，不猜企业归属。普通分析供给权限继续由原来源资格核定，查看旧原文不表示重新启用。
4. RequirementPage、SimLabPage、ModelRegistryPage 和精修原页面首次打开后保留挂载；切到其他工作位置不因卸载清掉未保存输入、原回执和 UNKNOWN。精修原 leave guard 继续有权阻止离开。切换到另一个明确对象仍沿原精确选择规则。
5. 业务页返回快照只保存原 view／projectId／taskId／URL，不保存业务事实，不发模型请求。原对象不再可读时明确提示并回项目列表，不用其他 Task 替代。
6. 具体设置和业务导航均不改造 SDK、Runtime、权限账、Skill 本体或业务 Store；缺配置和未知依赖不自动安装、升级、导入或关联。

## 实际浏览器与原权威证据

- **N1：原工作路径与设置。** `.local/overall-architecture-upgrade/development/root-final-ui/observations.json` 和同目录快照：原 App、Task、Plan、Goal／Case、RAP、推演、业务模型注册表、六项实际 Skill 资料、全局／局部同值、13 项规划、缺商圈快照、390px 布局和未知旧定位。RAP、推演及 Task 未保存输入在原页面返回后保持。
- **N2：PPT 业务入口。** `.local/overall-architecture-upgrade/development/navigation-final/ppt-generate-draft.snapshot.txt`、`ppt-generation-draft.txt`、`authority-audit.json`：从原项目 `060_reports/navigation-report.md` 点击生成，创建独立 PPT Task 并预填准确报告路径；原 Task 草稿不变，两个 Task 均无模型运行。没有把预填草稿当成 PPT 已生成。
- **N3：精修历史与异常。** 同目录 `ppt-history.snapshot.txt`、`ppt-workbench.snapshot.txt`、`ppt-archived-readonly-final.snapshot.txt`、`ppt-archived-version-history.snapshot.txt`、`refiner-return-url.txt`：原 deckId 的 v1／v2 历史可读；合成第二快照为相同字节，差异仍 UNKNOWN。原项目归档后仍可看历史，导出返回 409，重读后导出和回退禁用；返回准确原 Project／Task URL。原候选 PPTX 与随包有效合成夹具 SHA 相同，未覆盖原件。页图正常渲染的真实 FAIL 另见下段，不以异常处理通过掩盖。
- **N4：Studio 准确版本。** 同目录 `studio-metric-v1.snapshot.txt`、`studio-metric-v2.snapshot.txt`、`studio-foundation-old-metric-target.snapshot.txt`、`studio-method-v1.snapshot.txt`、`studio-method-v2.snapshot.txt`、`studio-material-r1.snapshot.txt`、`studio-material-r2.snapshot.txt`：原专业页面精确切版，基础层旧指标行仍打开 1.0.0，没有换成最新；方法 v2 保存未发布与 v1 正式区分。
- **N5：当前供给与历史权限。** 同目录 `studio-foundation-all.snapshot.txt`、`studio-material-disabled-exact-source.snapshot.txt`、`studio-no-enterprise-permission.snapshot.txt` 和 `authority-audit.json`：企业资料停用后基础层显示停用，两个历史修订及准确正文 SHA 保留；未明确企业时不继续显示此前企业的专业详情。它们不证明经营资料已核真，也不授予新任务供给权限。
- **N6：连接配置与任务授权。** 同目录 `task-permissions.snapshot.txt`、`task-authorized.snapshot.txt`、`db-project-authorization-empty.snapshot.txt`、`db-connection-unavailable.snapshot.txt` 和 `authority-audit.json`：原任务空闲时显式启用天气／商圈，另一 Task 未继承这两个开关；出境说明、缺快照、项目范围、固定模型出口及 TLS／预算入口沿原组件。合成 `localhost:1` 数据库连接测试为 UNKNOWN，未保存成已测连接、未授权活库、未读业务数据；该异常可处理不等于活库连通通过。
- **N7：不经市场的实际 Agent 接续。** `.local/overall-architecture-upgrade/development/project-synthesis-await/receipt.json`：一次确认启动原两 Task，综合 Task 实际有界等候并读准确维度成果；`selected-methods/actual-pi-PpYWpE/receipt.json` 及 `verification/corrected-method-new-task.log`：实际 Skill／SAP 精读、已知错误资格拒绝及纠错后新 Task 的准确选版；`automatic-review-handoff/author-receipt.json`：实际审查回原作者、新版 Case／资产交接、普通 followup、停止／失败／无声明边界；`quoted-decisions/receipt.json` 与原 `automatic-business-feedback-v020`、`analysis-delivery-host` 回归保留人的选择、授权、方法候选和原生来源。早期回执内尚待 Root 接线的范围保持原文，以后续实际联合记录核定，不覆盖早期 FAIL／UNKNOWN。

本轮补验使用独立 `navigation-final-1e6e5a5e3ef2` 浏览器会话、UI 4198、临时 Host 56273 和新建合成数据根；未访问 4173、Root 4199、真实 Provider、业务资产或设备。最终清理与文件身份见同目录 `observations.json`、`author-receipt.json`。属于作者／QA 验证，不是非作者独立复核。

**保留的正常页图渲染 FAIL。** 有效 `tests/fixtures/ppt-report/deck-good.pptx` 原字节未变，ZIP 核验无坏条目且含 3 页；`POST /api/ppt-refiner/decks/deck-a44f791f-cfdf-4ccb-bb2b-336faaa4ec1b/render` 实返 **422／`render_failed`**。这是有效文件的正常渲染失败，不是故意损坏文件的负例。原 API 吞掉子进程错误，仅返回通用错误码，不能从 API 声称取得底层 stderr 或已排除权限问题。只读环境核对确认隔离根无 `ppt-venv`，所选 fallback Python 3.14.4 缺 `pypdfium2`／PIL，LibreOffice 存在；随后 Root 用原 `page_images.py`、原有效文件、同 `runtimeEnvironment()` 和同 fallback Python 实际执行，退出 3，stderr 明确 `pypdfium2 not available in this python environment`。证据为 `ppt-render-environment.json`、`market-exit-restore-and-render.json`、`root-render-diagnostic.json` 及 `.log`。因此隔离 Host 缺渲染 Python 依赖有实际诊断；**正常渲染未通过，真实产品转换环境未核**。未安装依赖、改 SDK 或以导航变更重新宣称专业能力通过。

**市场移除后的复核。** Root 固定 App SHA-256 为 `f120f1a46ef9930e02298d6954e94d63e53aa3c4dc38613c74e888c5bf6fc96a` 后，复用同一合成数据根重开 UI 4198／Host 60799，未重新导入资产。`market-exit-settings.snapshot.txt`、`market-exit-skill-settings.snapshot.txt`、`market-exit-connectors.snapshot.txt`、`market-exit-planned.snapshot.txt` 核设置无市场兜底、具体管理与 13 项规划仍在；`market-exit-task-entries.snapshot.txt`、`market-exit-refiner-history.snapshot.txt` 核原 Task 业务入口与准确 v1／v2 历史；`market-exit-return-url.txt`、`market-exit-model-return-settings.snapshot.txt`、`market-exit-settings-return-url.txt` 核精修及模型注册表返回原 Task／设置。第一次补验已在删除前结束，本次是最新 App 的重新打开复核，不宣称观察了之前删除瞬间的 HMR 事件。

## 退出判据核对

| v1.1 §6.2 判据 | 工程证据与当前边界 | 退出结论 |
| --- | --- | --- |
| 已接能力可找到使用、管理、异常入口 | N1–N6：14 项的原业务／具体设置／异常路径；规划仅保留 13 项说明 | 技术 PASS；缺快照、渲染失败、DB UNKNOWN 均原样显示 |
| 不经市场完成需求、分析、成果、决策反馈和方法积累 | N1、N2、N4、N7：原 Plan／Task／Studio／决策及实际原 Host／Pi 接续 | 技术 PASS；专业结论和经营效果另核 |
| 推荐据实际可用能力且可接受、改选、排除 | N1、N6、N7：实际目录改选，准确 Skill／SAP 采用；未发布或已知错误不冒可采用，连接仍须原授权 | 技术 PASS；推荐不授予权限 |
| 原配置、授权、实例、方法、版本、会话和成果可读，旧定位准确且核权限 | N1、N3–N6：原 Task URL、准确旧专业版本、停用历史、归档精修的真实只读及 409；未知 Studio 不替代 | 技术 PASS；原 Studio URL 仍只有 systemId，不宣称固定发布版 deep link；未测活库不冒连通 |
| 推荐、读取、采用、核查、采纳、行动和发布不混淆 | N3–N7：候选／正式、读取／运行、审查／作者交付、人的选择／经营授权及失败停止边界分别保留 | 技术 PASS；没有把入口调整、聊天说明或旧审查当成功／新版采用 |

本轮已同时移除设置过渡按钮和整目录兜底入口，没有把整份 Catalog 换名塞进其他一级页面。保留具体 Skill 资料、共享连接、业务模型包及 13 项未接入规划说明。正常渲染 FAIL、依赖 UNKNOWN、原测评范围和既有专业失败继续分别报告。

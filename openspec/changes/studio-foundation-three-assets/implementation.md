# 三类资产工具与流程：实施记录

2026-11-12 · 已获用户确认，实施 I01–I07；完成后停止

用户已确认本版方案、spec 与 UI Demo，授权按清单完成工具和流程调整。准确批准文件及原指令见 [approval.json](approval.json)，原审核身份和未启动事实保留在 review-manifest／review 中。实施期间本记录与 tasks 同步更新。

## 范围与接缝

- 沿原 Studio 源资产／正文、SAP 原权威、Binding、企业目录、发布预览和普通任务工具完成 FA01–FA16 对应工具增量；保持两层和 Agent 自主原则。
- 已批准测试接缝为 spec 第3、4、7、8节与 I01–I07：原 Store 保存／读取、准确源与项引用、发布资格、普通任务供给、UI 交互以及真实隔离 Host／官方 SDK 接线。沿 TDD 先行为失败再最小实现；不以缺模块／导入失败当产品 RED。
- Interface v3、原 project-tasks owner/profile、Pi1.4.0／Semantica0.7.0 沿用，不改第三方包或运行服务。
- 目标企业资料及 M01–M05 未启动；本轮不执行 I08 Git／CI／合并或双机采用，不运行真实 Provider 业务实验。

## 当前进展

| 项目 | 状态与证据 |
| --- | --- |
| 批准身份 | 21份审核材料逐项核 SHA，并另存本地批准快照；approval.json记录原准确身份 |
| I01–I04 | 本地实现与受影响检查完成；纯内容profile、原SAP精读、类型关联、证据/依赖资格及组合闭包已接入 |
| I05–I06 | 本地完成：四次导航/结构投影、准确原文与专业区复用，普通任务、人工修订和历史/重开已验证 |
| I07 | 本地完整检查与两名全新非作者分范围复核完成；工程交付/CI未运行 |
| I08／M阶段 | 未启动，超出本次停止边界 |

具体 RED／GREEN、受影响检查、原失败和限制随实际执行追加；未有证据前不标完成。

## 首轮 TDD 证据

- 内容约定：原 `StudioStore.saveAsset` 接受重复 itemId，真实前置断言失败（`.local/studio-foundation-implementation/content/red-01.log`）；新增纯TS解析与原Store门禁后首片GREEN，后续内容用例持续扩展。
- 精读接缝：原 `read-source` 忽略 itemId，返回整份profile而使目标项断言失败；原SAP metricName读回全包YAML，同样RED。薄适配接入后原公开Host port首3用例GREEN：精确条目、隐藏跨企业引用拒绝、原SAP指标精读及错名／错版拒绝。
- 新增 `src/host/studio-foundation.ts` 只做结构、准确源／项存在性与原SAP维度／场景存在性检查，不算经营值、不生成业务口径或评分。正文来源补入原dependencies，保存／预览／确认继续使用原source readers，未新增主库或发布中心。
- 原 `studio_assets` 增加可选itemId／metricName及精确续页；sourceRef.locator继续表示原系统／SAP原定位，不替换成item路径。普通工具只读动作及profile权限集合不变。

此处记录中间证据，不代表I07或业务验收完成；完整候选结果随后追加。

## 固定结果与证据

2026-11-12，`codex/SAA_Studio_2`，原HEAD `87eef1db50667e3e69c827f6f897bf7d57ccb03a`，本轮工作树未提交。准确产品/测试文件见 [implementation-manifest.json](implementation-manifest.json)。批准的21文件中仅执行清单随实施更新，其余方案、spec、四模板、Demo未改；原13文件基线bytes/SHA再次逐项一致。

- `npm run check`：退出0；会话边界检查通过，2222项中 **2155 PASS、67 SKIP、0 FAIL**，随后TypeScript/Vite构建通过。原SKIP保留，完整日志 `.local/studio-foundation-implementation/full-check.log`。构建仍有大于500KB的chunk提示，不把既有体积提示写成业务失败，也不借本轮扩展为打包重构。
- 真实隔离Host＋官方Pi1.4.0＋本地合成Provider：沿原项目任务工具保存三类关联、准备发布，原HTTP作决定，另一项目的普通任务无手选Studio上下文从目录发现、精读条目及原SAP；关闭并重开Host后原native消息/lastRun不变。见 `tests/studio-foundation-runtime.test.ts`。这是实际SDK协议接线工程验证，不是真实模型推理或企业业务验收。
- 新增Host公开行为共11项＋runtime1项 **12/12 PASS**，含错名/错版、body隐藏跨企业引用、准确Unicode续页、原正式与新版、撤销来源、遗漏候选、旧文字桥、任务回执与必需依赖双角色、Binding两入口。日志 `host/green-review-fixes.log`，其后已纳入完整check。
- 浏览器使用实际Studio组件、原专业编辑及独立测试Host（62915），只有合成资料。四次导航、分类/不匹配搜索、精确企业/SAP回源、未知profile、GET失败保持UNKNOWN并重读、亮暗、390px、抽屉/专业页/嵌套来源焦点、原修订历史及固定预览摘要已核。实际人工编辑生成r3，四项声明pending、checks空、ready=false，r1正文和SHA保持；预览取消且未新增正式决定。证据 `ui/browser-evidence.json`、`ui/manual-edit-readback.json`；[实施截图](screenshots/implemented-overview.jpg)。首次主题截图缺少harness的`.app` token祖先，仅为测试容器问题；补原祖先后重新核亮暗/窄屏，不计为产品样式FAIL。
- Pi实际解析为官方依赖 `@earendil-works/pi-coding-agent@1.4.0`；package.json与package-lock.json无diff。未修改或升级第三方SDK，未改会话Interface/profile。Semantica及可选图接缝未改，原图成功不作为新内容完整图投影证明。

上述日志路径均相对于 `.local/studio-foundation-implementation/`，截图在output目录。它们是本地工程证据，当前未提交Git或上传CI。

## 非作者复核与原发现

两名新上下文、未参与本候选编写的Agent分别审core（含原source接缝、Agent工具、测试）与UI。源文件、测试和spec只读；临时复现仅在隔离`.local`。原发现不删除，作者修正后独立复验；当前无未关闭P1/P2。

| 原发现 | 处理及回验 |
| --- | --- |
| P2：Markdown内JSON示例误判显式profile | 只识别顶层声明；原Store真实RED/GREEN，旧文字/嵌套/转义示例保留，malformed顶层仍拒绝 |
| P2：发布遗漏候选依赖，含旧文字桥 | 核所选版本的实际sources/dependencies闭包；已有正式或本轮确选的准确组合才通过，旧预览仍按原指纹失效 |
| P2：task使用证据进入必需消费依赖，导致普通读取失败 | 所有正文refs保存/预览/确认仍按原owner校验；evidence-only task回执保留正文/uses原权威，不给普通跨项目报告读权；同一ref兼具必需角色不被过滤，目前不可共享的必需task来源阻断发布 |
| P2：Binding引用可指概念/政策 | 原source读回可信assetKind，核metricLinks的原Binding种类；field映射只接受原Binding或获准data输入，政策/报告留evidenceRefs |
| P2：结构正文与旧列表筛选不一致 | 两者复用相同visibleItems目录，分类和查询一致；原专业SAP列表继续显示 |
| P2：读取失败被显示为真实空态/零资产 | 未取得目录显示未知/读取中与原GET重试；计数/真空态仅在成功取得目录后显示 |

Core独立执行content/host/runtime **21/21**、原权限/撤销/取消/消费/专业发布回归 **30/30**；UI独立纯内存构建/渲染 **12项断言**，并核作者受影响UI **47/47**日志。最后原合同文字同步明确task证据/依赖边界，独立读回一致。作者与非作者成绩分别记录，不把作者测试改名独立测试。非阻断建议：未来可有界回传解析器已有path/code帮助Agent修正；本轮没有增设核验框架。

TDD另有两次测试准备错误保留：新Host反例第一次调用误写测试helper名，随后修为原公开helper，真正Missing expected rejection才记RED；Unicode分页fixture初超20KB、统计分解fixture混入item均被原有效规则拒绝，修正fixture后验证，不伪称产品RED。

## 四原则专项最终检查

- **Host管环境：通过本次范围。** 原owner、企业资格、准确版本/来源、结构/项类型、候选/发布指纹、取消生命周期及持久化；未代算指标、判业务语义或给专业评分。
- **Agent自主：通过本次范围。** 原工具增加可选精读，正文给最少内容合同；来源选择、建模、业务核对、分析/计算工具及内部顺序由Agent决定，无新固定专家链或调用配额。
- **原能力与SDK复用：通过本次范围。** 原Store/body、SAP包/方法、Binding、企业目录、原会话/发布/历史继续为权威；新增纯TS内容解析和薄Host适配只补已验证缺口，没有第二SAP公式库、MDM记录引擎、Runtime或独立图编辑主库。
- **减少人工：通过本次范围。** 正常分析仍由原任务自动获企业目录，按需读取，不需进入Studio或逐资产批准；建设沿自然语言目标、原资料/专业编辑和必要集中发布决定。未增加必做人工作业。

仅核本次新增及受影响接缝，不据此宣称既有SDK治理风险或整个产品全部合规。

## 停止边界与未验证范围

工具与流程的本地实现/验证完成后停止。I08 Git、远端CI、合并main、OpenSpec交付归档、服务切换和MacBook更新均未执行；不能把本地check写成CI或完整工程交付。正式4173服务及MacBook未操作，独立测试Host另行收尾。

M01–M05全部未启动：未读取、猜测或创建目标企业正式资料/主数据/指标体系/本体；等待用户提供获准资料再沿二层流程推进。真实模型业务专业评分、用户产品验收均NOT_RUN。本轮没有为新profile扩展GraphBuilder，准确原body可无图供给；不宣称OWL/SHACL完整建模或图使用验收。历史FAIL/UNKNOWN/报告及原v0.1保留。

最终读回：15份产品/测试候选文件SHA与implementation-manifest一致；批准21文件除执行清单外均未改，13份历史基线一致。最终四份foundation测试在合同文字收尾后再核 **29/29 PASS、0 SKIP、0 FAIL**。独立UI/Host测试监听62915/55547已停止并核无监听；合成资料及失败证据留在隔离根，不清理或混入真实企业数据。当前按本轮范围停止，未新增Git/CI或运行采用动作。

后续授权接续：用户现已明确授权I08 Git／CI／main和双机运行采用，见[交付记录](delivery.md)及[本次授权](delivery-authorization.json)。本文件以上未执行/停止事实是I01–I07收尾时的历史，不回写成当时已交付；M阶段仍不启动。

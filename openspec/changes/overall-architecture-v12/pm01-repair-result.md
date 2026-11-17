# PM-V12-01 修复记录

2026-11-17。依据产品v1.2 §1.1、§2.4—2.5与独立报告§6，修正已明确项目背景内缺少Agent自主发现入口的P2；原80文件候选及证据不改写。**实现、正式UI、联合验证与非作者两轴复核完成，PM-V12-01特定工程差额关闭。** 不把合成接线、Demo批准或工程关闭写成v1.2整体用户产品验收。

## 实际改动与复用

| 目标 | 实际实现 | 原能力/记录权威 |
| --- | --- | --- |
| 空手选不误作禁止或全项目授权 | 新明确Project的讨论捕获background范围；显式selected-only空清单保持关闭；旧缺scope保持原限选，不读时迁移 | 原discussion owner/CAS/请求指纹；用途不授予权限 |
| Agent自主发现和选择 | 原find-sources接原资格过滤目录，排除优先；大目录有界分页，title query仅匹配元信息，不作专业选材 | 原sources facet/Project/data description/企业/Task成果/SAP目录，无新资料库 |
| 准确按需窄读 | 原read-source接本请求实际返回的目录tuple或原手选ref，再核当前目录、resolver、grant、出口、Task、hash和返回范围；不读业务明细/试连库 | 原resolver/窄读与权限口；SDK/Runtime/Host职责不变 |
| 持续排除 | 完整排除ref按原资源locator匹配，包含旧enterprise wrapper和直接企业ref同源跨版 | 只作范围限制，不授予权限、不另立资料身份 |
| 实际读取来源 | 沿官方Pi native的实际find/read工具调用和结果，识别request/session/toolCall/entry/source/hash/range/complete；手选refs和目录只算metadata | 无并行读账；不把整个目录标已读，也不回写为用户手选 |
| 历史和下游再核 | 续聊核历史出站metadata和实际read；明确排除/空限选/更换或清空Project冲突时409、Provider零新增，输入/native保留；准确Goal来源继续按实际接收Project/模型/Task重核 | 原GoalVersion/native来源、Plan、实际Task和原DB Task策略；未静默取latest、删选择或自动重放 |

Scope不删除原会话已读正文，409文案明确“本次未发送给模型”和原输入/选择/历史保留。人工选择但未读的ref不会被当作已读正文阻断独立继续；原选择清空后Goal历史引用仍按原资格核。

## 新隔离证据与关键反例

所有新证据在`.local/v12-pm01-fix/`，原`.local/v12-implementation/`为只读保全对象；新测试每次生成独立根。下列中间RED和fixture/检查失败均保留，不由后来绿色覆盖。

| 要求 | 实际路径与结果 | 证据 |
| --- | --- | --- |
| A | 真Host/官方Pi/合成Provider，sources空、项目背景明确，实际find→read获准020文档；正文/准确hash/range/native可核 | `host/01-discovery-red.log`真实修前空目录RED；后续`12-catalog-pages-green.log`、`15-clear-project-green.log` |
| B | 空限选拒绝猜ID；手选可用，明确排除拒绝，未读ref不冒已读；企业旧包装与直接ref跨版排除一致 | `tests/pm01-discussion-sources.test.ts`、`pm01-strategy-source-scope.test.ts`；`host/07-wrapper-exclusion-red.log`及GREEN08；独立复核另核实际合法wrapper |
| C | 原Project/企业/grant/出口/Task/受管及版本反例保持；有目录不提前读正文/CSV，变化不静默换版 | 原facet/permissions及新facet相称26项PASS；`host/10-original-compatibility.log`；原fixture失败与typecheck-03/04分别保留 |
| D | 片段记录complete=false；真实读后停止不由GET/close/原ID恢复，明确新请求可继续；原UNKNOWN机制不自动重放 | `host/13-stop-after-read.log`；`09-scope-lifecycle-downstream.log`；历史范围收窄RED05/14→GREEN06/15，旧native字节保持 |
| E | 真auto-read→候选→采用→Goal→Plan→实际Task；跨Project准确拒绝。同Project只排除接收Task A，A拒绝且Provider无正文，B读同一准确来源；来源Task策略保持 | `host/03-autoread-downstream-red.log`为本轮中间实现RED，GREEN04及15；`db-recipient/same-project-MSA1IF/`的HTTP/seed/Provider/native/observations；原DbHost合成driver catalog=2、query=0，无活库/明细 |
| 大目录 | 80真实上传背景，原payload超限可检出；沿原offset/limit工具分页，只有最后一项片段实际读取 | `host/11-catalog-pages-red.log`→GREEN12；不把目录分页记为80份正文已读 |

原报告基于静态反例，没有被改写成当时已动态复现。新跨项目中间RED来自本轮部分实现，不冒作原dfeb候选泄露；DB组合的初次字段错误属于fixture失败。四份派生GREEN旧字节不可恢复/归属UNKNOWN、原check-03 GET409、隔离PPT FAIL、MacBook .git mtime FAIL/写入者UNKNOWN及历史SKIP继续有效。

## 固定候选、检查与独立复核

后端审查身份见`.local/v12-pm01-fix/backend-review-source-02.json`，含原v1.2 WIP及本修复，正式UI未改；01与02中间候选分别保留，02只改变Host历史scope比较和永久反例。最终实际交回清单使用同根新的`candidate-source.json`，不覆盖原80文件清单。

最终完整检查采用独立完整源码、独立Git元数据和纠正后既有node_modules的APFS普通目录副本；无安装、升级或SDK包改写。`/Users/Shared/optracall-pm01-final-159r71l5/source`实际`npm run check`退出0：**3000 tests／2889 PASS／111 SKIP／0 FAIL／0 cancelled**，typecheck、Vite构建、stamp通过，原大包警告保留。日志同父目录`full-check.log`，SHA-256 `0769e59e129d395d497c91696838566187adf4332c2e56dc91fbfe8240f2b684`；收据`final-check-result.json`。1771份完整源码、98份被测候选及原476份证据前后零漂移；67运行文件组合`10fa9ae149482d336cf4f17289bcf4cffe83f7eb25c8ae8640e9784f71e9491c`。原四项UI固定输出只在新copy中生成，未回写原固定证据。最终只更新工程结果文档，另列doc-only差异，不冒旧check为当前结果。

非作者各自从产品/工程要求导出预期，只读候选源码，在新隔离根验证。01期间作者修正导致Spec运行精确身份NOT_PROVED保留；Standards清空Project反例经作者真实RED修复。正式UI后另由全新干净上下文Spec复核完整03候选：71项回归＋15项实际组件/callback→client→HTTP→官方Pi/native/真实Task探针通过，另独立回读Root浏览器和完整检查原日志/副本；报告`review/final-spec/20261117-independent-01/review.md`。Standards增量独立UI3项（含实际HTTP已落库但应答丢失/journal不重放）＋后端3项通过；报告`review/standards/ui-increment-03/final-review.md`。两轴0未解决、四原则通过，只签PM01工程范围。各自fixture错误和旧失败不覆盖。

完整检查01在原仓库内嵌套副本运行，2875 PASS/111 SKIP/4 FAIL；D17根嵌套、RE03祖先AGENTS及CNR额外Pi压缩请求已由实际文件/请求定位，并在仓外副本原断言复验。保护工具的复制环境失败又定位到误加的绝对依赖自链接。Spec复核者重复ln命令沿既有目录链接进入原安装，新增node_modules/node_modules；操作及同inode已独立自审确认，不记UNKNOWN。Root保全原link与元信息后，仅移除本轮误加link，20,503常规依赖文件逐份SHA/bytes不变；SDK离线元信息检查通过。所有隔离声明失效、原失败与诊断分列保留，详见新证据根dependency-self-link-incident及review/spec审计。诊断衍生module未作为候选通过证据，不修改SDK/保护规则；下一轮最终完整check使用干净普通目录的独立安装副本。

## 局部UI门与后续状态

原战略讨论资料区表达“自主查找/仅限手选”和明确排除。用户先确认摘要`86de9481f3a349ec19691a4ef5b7ca8eabc3a3b40e78654758dc8f5c76cddbe7`的局部Demo（原话见pm01-ui-approval.md），之后正式实施Panel。无CSS/client或新导航改造，scope沿原CAS/journal保存/重开/UNKNOWN恢复。UI三段真实RED/GREEN及18项安全回归在ui-implementation。

Root从原App/原CSS入口、真实Host/Pi＋本地合成Provider观察：无需打开目录/手选，实际find→read经营计划→保存候选→界面确认采用原Goal；仅1次正文read、4次Provider请求。模式/手选/排除保存重开，显示原准确引用而不冒当前资格；重开/GET/资料管理无额外Provider，原Goal/native字节不变。清空已读来源后，界面提示本次未发送且历史未遗忘；Provider仍4，原输入/编号保留。证据`ui-implementation/browser/actual-app-pwNyj4/final-observation.json`及原native/Provider/Goal、`browser/screenshots/03—07`。首个浏览器fixture误用非法perspective customer的失败根保留，修为profit后全新根通过，不冒作产品RED；原空限选无正文真实回执保留。不以Demo stub或预置业务叙述证明专业正确。

## 原七模块与上下游兼容

| 模块 | 本修复承接与实际验证范围 |
| --- | --- |
| 战略与目标 | 原页准确范围/排除，自主选读后候选/采用仍原Goal/GSA版本与native来源；无新平台或BSC必经 |
| Project需求与任务 | 准确Goal回原Plan；create-only无派发→start复用Task，原单/多Task与明确综合兼容；不提前取业务明细 |
| 分析与综合 | 实际接收Task重核项目/模型/grant/排除，允许/拒绝均有native/Provider证据；原正式分析工具不改 |
| 成果审查与决策反馈 | 原逐稿审查、Case、Board选择/授权/实际/效果权威不改；完整检查和兼容通过，不由Goal采用推经营授权 |
| 方法与业务资产 | 复用原背景/企业/SAP/IR/Task成果resolver及资格、错误版保护，无新库，data-analysis本体/免测不动 |
| 自动模式 | 全局自动设置不改；资料自主查找不等于自动经营执行，公共停止/旧lease/去重/UNKNOWN/不续跑继续通过 |
| 导航与市场 | 仅原Panel资料区，不加一级入口/理论平台，不重建市场退出，原配置/历史保持 |

| 层次 | 当前结论 |
| --- | --- |
| 工程实现/真实组件合成接线 | 本次PM01范围实现/全检/两轴/四原则通过，native/HTTP/持久化及上下游接缝完整，特定工程差额关闭 |
| 正式UI/用户产品验收 | 设计已确认、原App真实入口已核；用户产品验收未发生 |
| 真实Agent自主方法采用/专业/因果正确 | 本次没有新增自由模型实验，保持待验证 |
| 正式运行采用/迁移/回退/设备 | 未执行，不从候选或旧上线记录推定采用 |
| 完整经营反馈/经营效果 | 待真实授权行动与观察窗口，不预设根因或复购改善 |

Git提交/推送/远端CI/合并、正式schema3迁移及兼容回退、双机服务、真实模型/业务资料、SDK升级未新增授权，均未执行。本修复未改data-analysis Skill本体或免测决定；用户已接受的历史TDD NOT_PROVED继续限范围有效。本记录不宣称v1.2整体产品验收通过。

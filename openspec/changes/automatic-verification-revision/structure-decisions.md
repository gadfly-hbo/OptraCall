# 自动核算与主Agent修订：结构决定包

2026-11-01（Asia/Shanghai）。用户已通过[spec/UI](spec.md)并要求先落实原件保护与结构合同，再实施功能。本包仅确认此前spec保留的具体结构/权限接缝，不重新确认已通过的功能。**当前状态：用户已整体确认九项全部采用A，现按本包实施。**

来源：[工程规范](../../../docs/engineering-workflow.md)IN01–IN07、[会话说明](../../../docs/agent-session-integration.md)、[保护可行性及保留失败](protection-feasibility.md)。按`agentharness-structure-grill`在结构实施前完成整体确认；既有A/B/C和项目schema/SQLite不因本包迁移。

当前推荐已通过合同层非作者只读复核。其最小本机证据为受限Python20/20及实际SDK文件工具21/21项有界通过；不是完整codemode/MCP、公共生命周期或真实模型验收。先前共享可写journal候选因可伪造尾部已撤下，旧稿与FAIL证据保留，不进入此包推荐。

## 第1项：保护范围与可执行写权限

**建议A：自动核算和主Agent返修的所有可执行工具采用新建私有工作区＋进程级默认拒绝权限。** 固定源/旧稿不可写，只批准新的计算/临时输出；native、凭据和Host管理材料不属于可读/可写工具资源。读取只授系统运行库、已批准的只读工具/skill资源、阶段获准的数据/报告目录；不使用`allow file-read*`作为产品策略。新目录复制字节，不用硬链接；启动前拒绝可写区预存符号链接、`nlink>1`及不安全祖先/路径。原件/native/凭据FD不传执行器，间接工具及新子进程继承边界；不开放网络、AppleEvents或已有代理进程。初期支持本机已验证的macOS能力，不支持时明确拒绝自动功能。

此边界约束本操作的工具及子进程，不声称隔离同UID的其他未受限进程或用户主动改动；0700目录和启动前扫描不等于敌对同用户并发安全。已知外部改动/链接/身份变化立即暂停并保留UNKNOWN；不同OS身份或VM级敌对隔离不在本次范围。不得把这个限度隐藏为已完成的全机保护。

原因：实际探针发现预存硬链接可绕过简单路径保护；单靠提示词、只包bash、事后SHA或备份不能保全。普通分析全工具、010软约束和原手动核算保持现合同，不借此重做全产品沙箱。

替代B：退回无工具文本修订，不能满足本次原主Agent自主计算；替代C：无保护全工具，不能满足原件保全。两者不作为推荐实现。

## 第2项：可信SDK驱动与受限工具执行分离

**建议A：仍只有原Pi SDK Runtime负责模型、会话与原生历史；Agent可执行代码全部交给受限工具执行进程。** SDK驱动只加载产品可信接入代码，不在驱动内执行Agent的Python/bash/JS，也不加载可任意执行代码的用户扩展或已有/远程MCP。原生read/edit/write/bash、codemode及间接工具的执行均跨同一受限边界；工具名称、参数、原生结果与Agent自主选择保持，不新增分析方法工具或要求调用特定工具。

执行器不是另一个Agent，不创建模型会话/推理循环；IPC只传绑定实际toolCallId的调用、进展和结果，不接受通用Host命令、任意管理RPC、路径授权或会话写入。可信SDK驱动保有原Provider/协议/配置/模型/线路及实际reasoning/thinking/contextWindow/maxTokens/compat；执行器没有模型密钥，也不能读取Host凭据、其他Provider配置或会话历史。模型网络仍在原SDK驱动，不新增Provider relay或替换网络线路。

调用资格由可信驱动预先绑定owner/阶段/toolCallId，执行器返回中的kind/event/session/config/Provider字段只当结果数据，不作为SDK事件或管理指令；不继承canonical、凭据或驱动管理FD。原生文件写/edit与codemode任意代码必须同样委派，不能只包bash留下可信驱动内eval后门。

只读skills可发现；新本地MCP子进程仅在继承边界且实际验收通过时启用，已有/远程MCP及不受控执行扩展不用于自动阶段。不可安全委派的工具/扩展明确不可用，不静默在可信驱动内执行，也不收窄原普通分析策略。

原因：同一可写进程内的工具能篡改SDK执行缓存，不能只靠尾部SHA防伪造。把可信SDK持久化和Agent代码执行分开，可直接复用原生持久化，撤去原候选的Provider中转与Host字节尾提交协议。工具权限是环境边界，不是方法约束。

替代B：工具与SDK共享可写journal，已由合成反例否定；替代C：无执行工具文本出稿，不满足本次自主计算。均不采用。

## 第3项：原会话、SDK唯写与原生回执

**建议A：原native为唯一权威，只有可信SDK持久化代码写入；执行工具既不能写也不能读取它。** 原任务仍用同task.sessionFile、session ID/header/parent和上下文，SDK按原公开会话接入正常追加用户、工具结果和assistant记录，不重序列化旧历史、不fork身份、不构造假的assistant。工具结果只是原生toolResult的数据，不能经IPC升级成user/assistant记录或Host命令。

对外snapshot/sessionFile仍是原canonical，started/accepted/settled沿原接缝验证真实requestId及落盘事实。没有执行native副本或Host原始字节尾提交协议；不把缓存或事件另立为会话真值。执行器尝试写入/读取journal、伪造返回角色或消息ID必须被拒绝；工具结果可包含文字，但不得改变记录角色/归属。冲突、保存失败、部分写或结果不明保留UNKNOWN/现场，不截断回滚或重放。需SDK迁移且会改旧前缀的会话不用于自动阶段，不暗改原件以便兼容；普通旧会话沿原合同。

原因：原生SDK持久化已有权威路径，分离唯写者比另造日志搬运协议更小、更易验收。旧副本联合14项仅证明善意续接，不能证明防伪造，已退出当前推荐。

替代B：另建作者session/fork，偏离原主Agent合同；替代C：Host从工具可写的缓存导入尾部，已否定。均不采用。

## 第4项：公共生命周期与Interface

**建议A：沿原project-tasks owner持有整链公共lease，增加Host受控执行环境切换和子操作资格；声明为Interface v2的兼容增量。** 原任务与核算仍分别为`project-tasks(projectId/taskId)`、`independent-verification(projectId/taskId/verificationId)`。Host静态注册保护能力，只有Host生成的不透明资格能申请受控切换，不接受业务消息中的任意cwd/sessionFile/端口。

公共层在同owner/配置/占用内排空并关闭普通worker及其可核定后代，确认结束后，以同原session受控重开锁定可信loader的SDK驱动并绑定受限执行器；不能把已加载用户扩展/动态代码的旧worker原地标成可信。无法确认旧资源安全收尾时保留UNKNOWN及占用，不启新模式。结束后关闭执行器与本模式资源，恢复普通路径时仍续接原canonical。业务层不得临时改worker再finally恢复，也不得new ProjectAgent、另建busy Map或全局队列。原v1消费者按原子集使用；新增能力必须覆盖消费者回归及静态接入约束，接口类型和版本同源维护。

核算子操作只认可绑定该lease/owner/链/阶段的临时资格，不能普遍绕过busy。停止先撤后续派发，再通过公共入口停实际在途owner/通道/本操作进程组及子树；只操作核定归属的资源，不影响其他任务/服务，无法证实收尾时保留UNKNOWN并阻止后续派发。安全收尾期间原任务仍busy。返修实际requestId走原markRun/settle与native事件投影，不能只改链记录。原普通运行completed与整链busy分开展示。

原因：v1支持多turn，但没有受控执行环境切换或父子资格/停止传播；业务层自己补生命周期会引入重复权威。

替代B：新增独立返修domain/Runtime，容易把另一个会话冒充原主Agent；替代C：释放占用后后台任意插入意见，存在上下文竞态。均不推荐。

## 第5项：设置的粒度、字段与入口

**建议A：独立文件保存每项目/任务的一份设置，缺失即关闭，CAS修订；不改项目schema和SQLite。** 位置为数据根`automatic-verifications/<projectId>/<taskId>/settings.json`。文件及目录由Host核owner/路径，不能由客户端给绝对地址。

| 字段组 | 类型/必填/默认与意义 |
| --- | --- |
| 格式/owner | 格式版本1、真实projectId/taskId，必填；与路径及项目Store一致 |
| 设置版本 | 正整数revision、真实ISO更新时间，必填；保存携带期望revision，冲突不覆盖；无文件等价revision0/关闭 |
| enabled | boolean，默认false；仅授权该任务后续普通分析触发，不自动回放旧报告 |
| question | 启用时必填非空文本，沿现核算问题最大4000 UTF-16；关闭/尚未配置可缺失，不由Host改写专业问题 |
| dataFiles | 1–32个去重项目相对路径，启用时须现存且属于020_clean，沿原选材合法性/大小限制 |
| reportPath/processFiles | 一个060_reports报告路径可尚未存在；0–31个显式作者过程路径，组成作者组不超32；不与源组混用，不自动搜文件 |
| 事前语义选择 | 沿现RAP身份/版本、当前SAP显式选择、Case id/revision/事前确认及用户businessContext合同；可选缺失表示未选择，不表示事实不存在；不新增专业真值库 |
| 核算配置 | 启用时必选原任务配置或明确选定配置的非敏感引用；开始时捕获版本，缺失/失效拒绝派发；不存密钥 |
| maxAuthorTurns | 整数1/2/3，默认2；主Agent接受意见请求次数上限，不是工具/费用/专业评分 |

设置GET/预览只读、保存不调模型；归档只读，关闭不删历史。前端沿原任务面板读写，错误保留输入；不把设置作为普通分析准入条件。

关闭且尚未配置时，选择字段可缺失表示未配置；不能用null冒充已选择，也不因关闭而清空已保存选择。启用必须完成上述技术选择校验，但不要求RAP/SAP/Case齐备。规范化指纹对对象键排序，数组保留实际选择/交付顺序，不把换顺序的材料默认为同一次请求。

原因：任务授权边界明确，CAS防旧页面覆盖；链捕获快照即可保留历史，不必迁移旧表。

替代B：写入原project/task大schema或核算format1，增加迁移与含义耦合；不推荐。

## 第6项：链身份、固定材料与多轮版本

**建议A：每个真实普通请求＋设置版本＋指定报告SHA构成一条独立链，以完整技术触发指纹确定唯一目录。** `chains/<triggerFingerprint>/record.json`位于同设置目录下；fingerprint为规范化身份字段的SHA256，包含owner/请求ID及指纹/设置revision/报告SHA，64hex，不由UI自填。相同完整意图只回读，载荷不同冲突；不另建全局索引或会话ID。创建/更新由既有Host mutate串行，原子写入、技术修订防覆盖。

普通分析请求准入时即捕获enabled、设置revision/完整快照、指定报告的存在性/前SHA，以及真实请求/会话/配置身份。完成后在同lease稳定观察后SHA，只有准入时已授权且文件新增/变化才触发；中途开启不追溯旧请求，中途关闭或设置变化撤销本次后续派发并暂停，不按完成时的新设置换材。外部并发写不冒称本Agent产物，已知冲突暂停。

已启用请求的准入/完成观察保存为本任务`observations/<requestId>.json`技术记录，含上述快照身份、前/后存在性与SHA、实际时间、触发/未触发原因及可选chain引用；无后观察表示尚无证据，不当作未变化。它不是设置版本或运行占用权威，GET不补写或派发；关闭时不为普通分析新增这些记录。链可引用该观察，不另建专业事件库。

| 字段组 | 类型/必填/缺失含义 |
| --- | --- |
| 链身份与来源 | formatVersion1、owner、triggerFingerprint、原requestId/请求指纹、创建/更新时间必填；SHA仅证明文件版本，不证明实际作者 |
| 固定设置/上下文 | 完整设置快照、真实原session身份/基线、原主Agent/核算非敏感配置快照、次数上限必填；不随当前设置重建 |
| 固定材料 | 原相对路径、固定副本相对位置、bytes、SHA、观察时间和语义来源；复制字节不hardlink；固定材料在worker不可写区，保留C实际片段/全文及来源分类 |
| 首次核算引用 | 真实原verificationId及cold/compare请求/结果身份；尚未创建/未交付时可缺失，绝不补造 |
| 报告版本 | 原稿版本1；每份变化新稿按本链递增；相对输出路径、固定副本、bytes/SHA/时间、产生阶段/实际主AgentrequestId和对应复查引用；缺新稿表示未观察到交付，不表示无错误 |
| 状态/阶段/原因 | 仅技术运行状态与原因，见第8项；不含专业通过、错误必须修复或论断清单 |

固定材料与执行目录均隶属本链，Host先建立安全目录/身份才派发；既有原件不移动、不覆盖。新稿在Host核准的新位置另存，Agent生成正文；从执行区导入时严格核真实路径、文件类型、链接、SHA和目标不存在，不导入任意程序或替它算数。旧链/旧稿可回读，下一份报告不得清空前链。

原因：旧VerificationRecord format1只有唯一authorRevision/recheckResult，无法正确表达1–3次返修；另建链支撑多轮但不重建业务IR。

替代B：反复覆盖旧authorRevision/recheckResult，破坏旧含义和归属；不推荐。

## 第7项：步骤与结果权威

**建议A：链内有序技术步骤＋Agent原文结果引用，不抽取专业claim。** 每步在派发前固定稳定stepId/实际requestId、阶段/序号、domain及owner、输入稿SHA和材料身份；分别记录派发意图、实际accepted事实/时间、终态/时间、真实native指针及结果引用。缺accepted表示没有确认，不等于未执行；缺结果不等于空稿正确。

首次独立与对照正文继续由原VerificationRecord权威保存，链只引用；多轮主Agent回复/新稿、知情复查原文另存本链专用结果文件，含SHA/bytes/实际请求，不覆盖旧唯一recheck。events只供观察，不作为第二套运行状态。固定/主动提供/读取线索/Agent声明沿C证据分类；未证据保持UNKNOWN，不推断理解/采纳。

每次对照/复查不论专业意见为何，只要技术有效且上限允许，都原文交回主Agent。主Agent自主决定改/不改/反驳；无新稿、同内容、变化新稿只按文件事实区分，不由Host分析意见文本。主Agent返修输出能力不等同旧fixed-draft；后者及旧记录保持原合同。

原因：技术来源可回读，专业真值仍由Agent与产品外评估承担，避免把工作流改成Host分析裁判。

替代B：Host解析核算意见决定是否修/改什么/合不合格，违反本次边界；不采用。

## 第8项：次数、状态、去重与恢复

**建议A：只按技术事实驱动有界交接，未知停止，恢复只读。** 状态为preparing/running/paused/completed/cancelled/failed/unknown；phase为独立/对照/作者反馈/复查等当前技术环节，reason区分未触发、无新稿、同内容、达到上限、材料/会话/配置变化、用户停止、保存失败或请求结果不明。UI映射中文，无“专业通过”。

闭合逻辑值如下；新增值属于合同变化，不能当任意自由文本驱动分支：

- phase：prepare / cold / compare / author / recheck / ended。
- reason：none / report_missing / report_unchanged / source_changed / semantics_changed / settings_changed / session_changed / configuration_changed / external_change / no_new_report / same_content / limit_reached / user_stopped / runtime_failed / persistence_failed / request_unknown / unsupported_protection。
- preparing仅可转running(cold)、paused、cancelled、failed或unknown；running在合法cold→compare→author→recheck→author顺序交接，或转paused/completed/cancelled/failed/unknown；author无新稿/同内容转completed，recheck达上限转completed。各phase内可有任意自主工具迭代。
- paused、completed、cancelled、failed、unknown均不自动回running；paused表示本链停止派发、等用户核对后另建新链，原链只读。技术UNKNOWN只回读，不自动恢复。completed仅用于无新稿/同内容/达到上限等技术终态，不表示专业正确。
- 终止后phase置ended，最后实际执行阶段保留在有序步骤；没有请求被派发时也不伪造accepted/结果。观察记录的未触发原因沿上述闭合reason，disabled表示无观察/无链而不是专业状态。

主Agent真实accepted一次计一次，不要求改稿；首次两turn和知情复查不计返修。接受未知时保留派发意图及未知次数，不通过退回计数自动重发。每份变化新稿均有对应复查；仍有额度才再交回。达到上限停止，末次意见展示但未派发不称已读。

源/事前语义/模型/会话变化暂停；用户停止/Provider关闭先撤资格后停实际资源，迟到结果不能再派发。每次child requestId派发前已保存，同载荷重复只回读；不承诺跨重启恰好一次。重启把未证实完成的操作标UNKNOWN/中断，GET核现有记录和native回执，不打开模型或回放。不存在的证据保持缺失；不得以当前文件补历史。

原因：防重复付费/副作用、错误上下文及无限返修，同时不给Host专业判分权。

替代B：解析“通过/有错”关键词继续循环或重启自动重试，均不采用。

## 第9项：兼容、实施顺序与验收

**建议A：新目录增量＋旧结构原位保留，先证明保护/传输/会话，再接自动链与UI。** 旧项目/任务/native父链、SQLite、手动核算、fixed-draft、RAP/SAP/企业资料、Case、决策看板和反馈A不迁移、不改历史。旧版本忽略但保留新目录；禁用不删除新记录，回退不覆盖为旧备份。

实施顺序：可信SDK与受限工具分离/原生唯写者 → Interface及消费者 → 设置/链Store/HTTP → 两阶段核算与原主Agent多轮 → 原面板UI → 完整适用check、合成实际SDK/HTTP/保全/取消恢复联合验证 → 非作者独立复核与合成资料真实模型专业验证。只用已授权配置/模型，不换Provider，不以新参考/专用计算工具兜底。具体模型尝试和评分事前冻结；模型费用上限不由返修次数替代。

工程保护、技术完成和全文专业收益分别报告；检出/漏报/误报/核算新增错、作者纠错/误改和新稿复查分别评价，不能用工程绿色抹去旧FAIL/UNKNOWN。未满足保护合同的环境拒绝自动功能，不能退回无保护计算或只读出稿。本次不含Git/CI交付、服务切换或MacBook操作。

原因：先解决事故风险和会话归属，再接产品交互，不把合成探针或UI演示当成真实产品成功。

替代B：先上线自动链再补保护/记录，不满足用户“先落实”要求；不采用。

## 完整性与决定台账

适用类别：持久对象/owner/粒度/身份、字段组/缺失/默认、关系/版本/来源、读写/状态/去重、兼容/回退、联合接口与阶段分类均已覆盖。数据库索引、跨Base本体/实体映射不适用：本变更不新增DB表或专业本体；文件目录是Host支撑结构，Agent正文不是专业IR。物理JSON属性名可按已确认逻辑字段组实现，不能改变其语义、权限或生命周期。

| 序号 | 推荐/理由位置 | 用户决定 | 一致性 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 保护执行与新可写区，见第1项 | A，继续实施 | 一致 | confirmed |
| 2 | 可信SDK驱动与受限工具分离，见第2项 | A，继续实施 | 一致 | confirmed |
| 3 | 原native由SDK唯一写入，见第3项 | A，继续实施 | 一致 | confirmed |
| 4 | 公共Interface v2兼容增量/原owner/停止，见第4项 | A，继续实施 | 一致 | confirmed |
| 5 | 每任务设置及字段组，见第5项 | A，继续实施 | 一致 | confirmed |
| 6 | 指纹链/固定材料/版本，见第6项 | A，继续实施 | 一致 | confirmed |
| 7 | 技术步骤/结果权威，见第7项 | A，继续实施 | 一致 | confirmed |
| 8 | 技术状态/次数/UNKNOWN去重恢复，见第8项 | A，继续实施 | 一致 | confirmed |
| 9 | 增量保留/实施与验收，见第9项 | A，继续实施 | 一致 | confirmed |

整体建议九项均采用A。用户整体确认后，只实施本包范围；重要机制/权限或持久含义需要改变时提供针对性补充，不重新询问未受影响项。

## 整体确认回执

2026-11-01（Asia/Shanghai），用户明确回复：“九项均采用A，继续实施（推荐）”。本回执同时适用于上表1–9项，功能/spec/UI不重复确认。原未确认候选、撤回机制和诊断失败保留在实施前证据目录，不能作为当前获批方案。

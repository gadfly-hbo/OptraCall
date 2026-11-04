# M5 产品实施与证据

2026-11-03–04 · **本地产品开发与工程验证完成；Git／CI、部署及用户产品验收分别未完成。** 最终结论与范围见本页末段，以下过程记录保留当时状态。

用户已整体确认v0.1 spec、UI Demo与D01–D08全部A。7份批准原件和manifest保存在`history/approved-v0.1/`；开工前完整回读上一准备交付manifest，0漂移。当前HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`，分支`codex/fourbase-phase01-design`保留M2／M3／M3.1／M4 WIP。408工程输入及425开工前副本固定于`.local/fourbase-modules/m5/implementation/baseline.json`，不以HEAD替代WIP身份；原专业FAIL、UNKNOWN和M31 NOT_PROVED不改。

## 已批准的公开验收接缝

沿spec末段已确认的四组接缝，不另要求用户重复确认：

1. 真实Case／任务UI与HTTP：零维护、准确取舍／关系／治理、旧版与并发草稿、原意图查询。
2. 原Host→Pi1.4.0→loopback合成Provider→Case事务／native：直接及合法nested、旧ctx／取消晚到、真实作者与Case绑定、无Case／受管／封闭profile。
3. 原CaseStore及真实Host兼容入口：schema1→2、原逻辑行／ID／JSON／marker／FK、迁移失败与提交不明、关闭M5但保留v2新工作。
4. 原Case／RAP／Board／反馈／M3.1／M4受影响消费者。

每片先真实运行目标行为RED，再最小实现／GREEN；import、环境、fixture或定位错误不算业务RED，UI不以SSR代替动态行为。最终适用完整check、实际产品浏览器、全新非作者与四原则专项分别记录，不沿用M31例外。

## 实施分工与最小增量

存储只在原CaseStore扩一张追加修订表及原receipt／event枚举；Host沿原事务／mutate和来源reader；UI沿原CaseBoard／聊天／看板；Agent工具沿M4既有IPC、取消及call-local资格与Pi工具hooks，不建新会话／消息／循环／队列。Host不判断真假、自动推因果、代人选择、自动派发或改实际反馈。

Agent草案必须从当轮实际`task_context_prepare`回执和真实project/task/request/session/toolCall资格取Case，不猜首末Case、不新永久指针。人的Case全局入口仍沿原Case权威，不把作者origin项目推为永久权限owner，也不因无关关联项目归档冻结全Case；明确项目入口仍核该项目只读，行动／反馈关联核真实目标归属，Agent始终核当前项目权限。该范围按原Case与项目分别治理，不扩大业务权限。

## 实施过程与首批证据（当时状态）

隔离合成环境位于`.local/fourbase-modules/m5/implementation/live/fixture/`，UI4198／Host4199；配置仅指向loopback合成Provider，author与review合成Case／项目／任务分别保留。当前只供工程点验，不切换既有服务或读取真实业务库。

UI第一片已在健康原产品上实际进入合成Case，确认“Case决策记录／方案备选与人的选择”缺失后才实现；原始动态RED及截图在`implementation/ui/`与`output/playwright/m5-product/`。SDK第一片用真实Pi打开会话，直接／nested的Case工具均缺失，明确断言RED后才薄接入；日志在`implementation/runtime/01-direct-nested-red.log`。Host首片真实Case fixtures建立正常后新list路由404，日志在`implementation/host/01-list-red.log`。存储与后续切片结果继续按原时序记录，以上不能预判GREEN或整体完成。

本轮未做Git交付写操作／CI、安装／运行采用、操作MacBook、调用真实Provider或使用真实业务资料。存在只读Git身份核对，UI子任务一次只读status分工偏离已留原记录。旧准备PASS只证明当时文档和虚构原型；真实实现、迁移可行性与专业效果分别验证。

## 联合进展与已核技术适配（最终候选冻结前）

Store首轮38项与分页追加后的42项通过，Host当前8项HTTP通过；真实Host→Pi→Provider直接／nested保存已3项通过，原生与业务操作身份一致。SDK资格／取消、无Case、封闭profile及原M4工具组合的30项联合回归通过。真实产品UI的空态、直接续问、准确选择、理由／并发、来源／历史、关联／治理各先留动态RED再最小实现；SSR或fixture问题均不追认为RED。Root另实际通过三段正常UI→原Host→Pi→合成Provider→SQLite/native：新判断、合法nested新方案、人的一次选择、反证后分别追加判断／方案，旧选择仍绑定旧版；独立项目／Case和证据在`live/sdk-ui-*/`，不借UI种子代SDK证据。

首次完整SDK接线曾真实出现Case已保存、工具回执包装错误，原失败及合成根保留，修复后新独立根通过；不能把前次业务提交说成未发生。兼容CLI `--disable-case-decisions`也先真实断言RED（参数已送达但M5能力仍露出）再最小实现／GREEN：关闭工具及新M5写，保v2卡片／回执且继续原Case维护，不恢复旧DB覆盖新工作。首轮fixture漏Case项目链接不计RED。

非作者提前发现合法32引用不能归档，后又发现262143-byte合法请求保存后被自身读口当损坏。两项均有独立原反例及root公开Store前置RED。最小适配不增字段／表／来源库：**模型／业务引用输入仍≤32，人的治理在原refs中允许至多1条Host自产的准确同record前一修订谱系；替换旧自产谱系，不删除Agent业务派生来源，不无限堆叠。** 请求256KiB只约束公开输入；已保存行及多次合法人关联按原有限字段／条数／文字caps验证，不将其误作第二次请求，也不猜额外固定4KiB。准确读取仍分片，工具实际交付保持32,768 UTF-16／256KiB。`capacity/`保留原失败、中间固定envelope不足及最终GREEN；公开>256KiB／33业务refs及伪造作者仍拒绝。

另经Host／Store补查，旧offset游标在目录新增／归档时会跳漏或重复。利用原表追加marker及原choice事件marker锁游标，变化明确409要求重读，不另存目录快照／head或隐读整目录正文。新增永久公开Store反例和修复日志见`store/pagination-*`。以上为实现技术接缝的实际缺口及最小修正，不把设计声明或早期作者PASS替代最终完整固定候选的检查／非作者结论。

## 最终本地工程验收（2026-11-04）

用户批准的D01–D08全部A已实施。最终产品源码清单为`.local/fourbase-modules/m5/implementation/review-product-candidate-final-v2.json`，SHA-256 `7957251bc3da85c4242508546b99b782c7254327197dd51fe6e58bc306b56d12`，固定431工程输入；旧HEAD仅标仓库基点，不能代替现有WIP。之后只更新8份当前事实文档，原文保存在`.local/fourbase-modules/m5/implementation/before-closeout/`，最后交付身份见`.local/fourbase-modules/m5/product-delivery-manifest.json`。

| 验证 | 结果及证据（均在`.local/fourbase-modules/m5/implementation/`） |
| --- | --- |
| 完整检查 | `npm run check`退出0：**1130总／1127 PASS／0 FAIL／3原SKIP**；会话导入边界、类型与构建通过。`full-check-final-v2.log`及`full-check-final-v2-result.json`，431输入前后0漂移，命令开始后无源码变化。旧两轮PASS分别保留，未冒最终身份。 |
| 真实集成／消费者 | Host当前9项公开HTTP、Store及迁移／失败／分页、SDK资格与原M4受影响路径分别有范围证据；原Case／RAP／Board／反馈／M3.1／M4的完整适用测试包含在本轮check。root实际UI→原Host→Pi1.4.0→loopback合成Provider→SQL/native三组正常闭环通过，`live/root-sdk-ui-final.log`及`sdk-ui-1793721853382/`。合成Provider不证明真实模型推理。 |
| 产品UI与流程 | UI作者10片真实动态前置RED→GREEN；root追加第11片，H／S后续稿未说明变更理由时，摘要／准确详情明确显示“作者未说明”。首轮关闭按钮定位失败不计RED，`ui/slice11-unknown-reason-confirmed-RED.*`及`GREEN.*`保存实际反例和修后四处结果。不是每条追加边界断言都追认为TDD。 |
| 完整非作者复核 | [完整报告](../../../.local/fourbase-modules/m5/implementation/independent-review/final-product-review.md)覆盖Standards／Spec、CD01–CD10、实际调用链及12层Agent栈增量，修正后本地工程范围通过。独立7组Host／Pi、3组大记录、有界读取及分页治理；真实UI9组和最后缺省理由6项通过。原探针／定位／fixture失败单列，未算业务RED。 |
| 保全 | `preservation-final/preservation-result.*`、`v2-readback.*`：425开工前副本、20保护输入、8批准输入及431最终源匹配；M4旧411副本／1080证据／5构建备份保全。v1.2、所有批准Demo、原FAIL／UNKNOWN／M31 NOT_PROVED未改。 |

独立发现的引用容量、存量行误套请求上限和四条错误码提示均已修正并复验；末次P3“无变更说明”以两行显示fallback修复，后续稿准确原DTO仍为null，首稿不凭空加变更。原结果不明、首次失败、中间修复和原操作记录全部保留。没有新增业务结构决定、Agent方法限制或用户必填项。

### 四点产品原则专项：本次变更及受影响接缝通过

| 原则 | 实际依据 |
| --- | --- |
| Host管环境 | 原Case事务／receipt／event校验归属、权限、CAS和保存，原source reader按准确引用读；不评分真假、不推因果、不代选或派发行动。 |
| Agent自主执行 | 原普通任务自主零次／多次读写草案，真实direct和合法nested均通过；无Case仍正常分析，不加先读后写、固定步骤或方法配额。 |
| 优先复用Pi／既有能力 | 原project-tasks／Interface v3／Pi1.4.0及M4已有IPC、取消和call-local资格；只增加两个Case业务工具及原SQLite的一张追加表，不造第二会话／消息／记忆正文库或运行循环。 |
| 减少人的操作 | Case沿原任务直接续问，不要求先填表或维护日记；人的准确取舍一击、理由可选，来源／计划／治理按需展开，原行动与反馈只在原处维护。 |

以上结论来自实际代码、原生／业务记录和独立UI点验，不以设计声明或测试全绿单独判定，也不背书未改的全部历史Agent代码。M5未使用流程例外。

### 未验证、兼容及交付边界

- 三项既有条件SKIP保留：本OS不适用的保护拒绝分支及两项real-soffice渲染；现有主JS超过500kB的构建警告保留。
- schema2只在隔离合成库实际迁移；旧schema1二进制不能读v2。本候选`--disable-case-decisions`可关闭M5工具／新写，保留v2记录与原Case维护，不能恢复旧DB覆盖新工作；真实部署首次迁移尚未执行。
- 未送达的人意图只保证同一App内关闭／重开及页面切换保留，不保证硬刷新／崩溃恢复；已提交结果与原operation仍在Host。nested无子正文时保留UNKNOWN，不伪造原生证据。
- 未调用真实Provider、读取真实经营资料或证明专业效果；未做Git交付／CI、安装／运行采用、MacBook同步或用户产品验收。M6–M8未启动。
- 仅根拥有的测试Host／Vite／合成Provider已核PID、argv、cwd后正常停止，`live/test-services-stop.json`回读三端口无监听；合成Case／项目／会话／文件及失败现场全部保留，没有切换既有运行服务。

# db-link：MySQL／PostgreSQL 驱动与接缝选型补充

2026-11-13 · v0.1 · **提交确认的设计补充；暂不开发。**

首批 **MySQL＋PostgreSQL、成熟驱动薄适配** 已由用户确定。本说明提出精确驱动组合及权限、取消、精度和核算合同；这些细节尚待用户确认，不表示已安装、已支持或已完成真实验证。沿用已批准的 [DB01–DB18](spec.md)、[UI](ui-spec.md)和[交互状态](interaction-states.md)，不改批准原件与 Demo，不改变四原则或现行审查默认行为。[版本证据](driver-versions.md)列出官方发布身份、固定源码和未验证范围。

## 1. 本轮交付与决定

| 项目 | 本补充的建议／边界 |
| --- | --- |
| PostgreSQL | 官方 `pg 8.23.1`（纯 JS）＋同仓 `pg-cursor 2.22.1`；不额外引入 pg-native／pg-query-stream |
| MySQL | 官方 `mysql2 3.24.6`；采用公开 callback `execute()`／流与类型接口，不下钻 PromiseConnection 私有对象 |
| 产品接入 | 沿官方 Pi `1.4.0`、Interface v3、原 project/task owner 与公共 operation/lease；数据库资源附着原操作，不另建 Agent Runtime、全局运行队列或运行状态权威 |
| 第一版资源策略 | 一个活动取数操作独占物理连接，串行发命令；操作终结后关闭连接。先不做跨 owner／跨操作复用物理连接，免于引入会话清洗和 prepared cache 一致性问题。逻辑连接配置仍供多个项目复用；Agent 可按预算并行独立操作 |
| 范围 | 库类型不代表任意服务器版本、云兼容库或代理均已支持。源服务器版本、身份认证、路由、原生权限能力按实际接入另验；本轮不要求业务库升级，也不把 MariaDB 自动算作 MySQL |
| 成熟能力缺口 | 同账号跨会话权限、取消目标身份／服务端完成、大结果完整交付均有下述明确准入条件；不能仅凭驱动成熟就宣布 DB05／DB14 已满足 |

版本是截至查阅日 registry 的稳定发布建议，依据还包括 tag／npm `gitHead` 一致性、TLS／游标／类型相关修复及公开接口核查，不以 `latest` 作自动升级策略。三包均 MIT，Node engines 范围包含本仓 Node ≥25；**范围包含不是 Node25、打包或运行兼容通过**。TypeScript 声明包及传递依赖闭包在获授权实施时核对、锁定；当前不改 package／lock／SDK，不用 overrides、源码补丁、私有 fork、模块替换或未文档化内部接口补缺口。[V]

## 2. 配置一次与真实权限域

**逻辑配置复用，实际权限绑定可不同。** 一个命名连接保存地址／库名、TLS、凭据引用和配置修订。项目授权引用它，并绑定真实数据库权限域；任务继承项目资格且可收窄。Host 在发现、结构、试读、查询、固定及再读各入口核验项目、任务、操作、来源修订和模型出口。Agent 只接收不含秘密的引用及合格结构／结果，不提供密码、任意 DSN 参数、控制连接或 PID 来选择取消对象。[DB01–03、06、14–15](spec.md)

| 权限问题 | PostgreSQL 建议 | MySQL 建议 |
| --- | --- | --- |
| 读取资格 | 专用受限 LOGIN，限定 CONNECT、schema USAGE、所需表／视图／列 SELECT；按需限定行的原生 RLS／视图。不得以 owner／superuser／BYPASSRLS 登录来宣称 RLS 有效 | 专用受限账号，限定库／表／列 SELECT；较窄行范围采用受管视图／不同实际绑定，不给该账号同时读取底表的资格 |
| 写与外部副作用 | 不授予写、CREATE、管理／服务端文件能力；核对默认 PUBLIC 与继承角色、函数 EXECUTE、SECURITY DEFINER 等实际可达能力。只读事务是防护之一，不替代原生权限 | 不授予写、DDL、FILE、管理／广泛过程执行能力；关闭 multipleStatements、LOCAL INFILE 与多结果入口。READ ONLY 事务不是文件／函数／管理操作的全面禁令 |
| 跨项目收窄 | 相同有效权限域可共用绑定；较窄项目必须有实际受限登录／视图／RLS 等约束。不能让高权限登录用 SET ROLE 来冒充不可逃逸隔离 | 相同有效权限域可共用绑定；较窄项目改用实际受限绑定／视图，不能共用高权限账号再靠工具隐藏表或拼 WHERE |
| 元数据与同账号会话 | 表数据权限不等于目录名称隐藏；同角色会话的查询文本等可见性另验 | 无 PROCESS 也可见同账号会话；配置共享不自动满足会话／SQL隐私隔离 |
| 取消与管理权限 | 默认不申请 superuser／pg_signal_backend；若使用控制角色，必须约束到合格目标，避免广泛发信号权限 | 默认不申请 CONNECTION_ADMIN；同账号可 KILL 自己的其他会话，控制通道隔离本身不消除此能力 |

表中是最小授权目标，不是已执行的 GRANT 脚本；实际角色继承、默认授权、视图／函数权限、只读事务和元数据可见性必须连同来源版本验证。[P1][P2][P3][M1][M2]

**必须保留的权限缺口：** PostgreSQL 同角色取消／终止函数、MySQL 同账号 KILL 都不能从“业务库只读账号”推断为仅 Host 可用；单语句 prepared execute 也不等于 SQL 只读。Agent 自主 SQL 若能调用这些能力，可能影响同账号其他操作。原生权限／已存在的受信执行限制须证明 DB05 的副作用范围与 DB14 的所属取消，不能靠提示词、SELECT 前缀、表隐藏、先检查后执行或控制连接不暴露来证明。**若实际来源无法满足，不能登记为完整合格的 db-link 能力，须回到方案讨论；本补充不降低原合同，不自行增加 SQL parser、代理服务或修改驱动。**“一账号跨任意项目隔离”与“同账号取消天然安全”均不作承诺。[P3][M2][M3]

TLS 由 Host 形成一份确切有效配置并随连接测试保存：PostgreSQL 防止 connectionString 中 sslmode／sslcert 等覆盖显式 SSL 对象；MySQL2 `3.24.6` 显式 **`rejectUnauthorized:true` 与 `verifyIdentity:true`**，同时要求证书链和预期目标身份实际核验，不能只开前者，也不能从两个true直接推断所有地址路径有效。固定驱动在IP地址下将servername置空；结合Node25.9.0的TLS hostname回退逻辑，IP直连／SSH或自定义转发流需单独核对预期目标名传递，尚无实测结论。一期先以显式DNS主机名、证书CA／SAN匹配且经实际正反例核验的路径作为准入候选；IP／自定义流未验证时不准入，不通过关闭验证、接受任意证书或改驱动绕过。凭据修订或影响连通／权限的配置变化使旧测试失效，在途资源保留捕获的旧身份，撤权立即禁止新派发。[P4][M4][N1][N2]

## 3. Agent 自主取数与公开接口

复用 [Pi 公开工具注册／Host port](../../../src/agent/web-search-tools.ts#L44)的已有结构；少量正交能力提供可用来源、按需结构、参数查询、结果引用。Host 绑定环境与实际访问资格，Agent 决定业务 SQL、字段、时间、关联、分批策略、分析与纠错；数据说明或 Studio 不是必经前置，也不预建业务 SQL 模板库。[DB04–05、18](spec.md)

PostgreSQL 走公开参数查询与官方 cursor，首期不开 pipeline，每 cursor 至多一个未完成 read，避免固定版本尚未解决的排队 read 结算问题；按固定 `2.22.1` 核对 `read(n)` 实际 Promise 返回 rows 数组，不能照抄漂移在线页的 Result 解构。MySQL 走公开 callback `execute()`、返回 Query 的 `.stream()` 与字段事件，避免 Promise 整批结果；参数采用公开 TypedParameter，单语句，拒绝多结果／过程调用资格。两库参数仅绑定数据值，不把表名／SQL片段当数据参数。Host 返回具体技术错误，由 Agent 在授权内改 SQL，不由 Host 改业务条件或补算。[V][P5][M5]

超时、并发、行／字节／单值规模按 Host 的连接资源策略绑定，在调用前明确、回执中记录；Agent 可在既有预算内选择批次和缩小范围，不能自行关闭上限。**这一合同需要可执行约束，不由会话 SET 自证。** PostgreSQL 的 SET／set_config／事务状态变化、MySQL 的 SET／SET_VAR／MAX_EXECUTION_TIME hint 及可调用函数都须作为绕过反例核证；MySQL 正数 MAX_EXECUTION_TIME hint 可覆盖 session max_execution_time。只读账号、单语句、Host先设会话变量均不自动证明预算不可修改。原生权限或既有受信执行限制无法强制必要预算时，该部署不得按DB05准入；不以Host改写业务SQL、自建parser或额外人工作业补成“已解决”。[P6][M9]

游标／流的对象数 highWaterMark 不等于字节上限，单行大 JSON／BLOB 也必须受实际内存与写入预算约束。具体部署预算后续按来源与代表负载确定，不以行 LIMIT 当执行成本证明，不增加用户每次分页或查询确认。Host本地截止与拒绝后续派发仍要落实，但不把本地超时当成服务端成本已停止。

## 4. 查询取消：从请求到远端终结

沿同一个 owner／operation 的公共取消与资源占用。正常完成等待查询与结果写入；用户停止／撤权先拒绝新派发，再请求所属查询取消。建议状态事实为：**运行中 → 已请求取消 → 等待原查询与控制命令各自终结 → 回滚／关闭 → 资源已释放**。结果、SDK等待、控制命令、服务端终结与本地连接关闭分别记录，不用其中一项代替其余项。[DB14](spec.md)

| 场景 | 候选实现路径 | 不得作出的推断 |
| --- | --- | --- |
| PostgreSQL | `statement_timeout` 约束服务端语句；若权限与目标身份合格，可由 Host 独立控制连接调用公开 `pg_cancel_backend`，等待原命令实际完成／取消错误与事务收尾 | `query_timeout` 只是客户端回调／队列处理；cursor.close 不抢占执行中的语句；返回 true 只证明信号已发送 |
| MySQL | 对适用只读 SELECT 使用服务端 MAX_EXECUTION_TIME；合格控制连接发送 `KILL QUERY` 后仍等待原命令与事务收尾 | MAX_EXECUTION_TIME 不涵盖任意语句；固定 mysql2 timeout 的错误回调、stream.destroy 或 connection.destroy 都不是远端已结束证明；KILL 应答也不是原查询终结 |
| 连接与路由 | 原查询持有独占物理连接，控制命令必须抵达同一实际服务器节点；记录来源实例与原会话身份，并在查询／控制命令结束前不复用原资源 | 相同 DSN、代理或负载均衡地址不保证同节点；PID／connection ID 不具有永久唯一性 |
| 断线、竞态、迟到 | 原连接消失或控制结果不明时，停止对旧目标继续派发，保留 UNKNOWN 及原资源的未收尾记录；迟到事实只补原操作，禁止新报告／核算副作用 | backend_start／querytag 等先查后取消有 TOCTOU，不能当原子身份保证；不按缓存 PID／ID 重试，不自动重跑 SQL／模型，不把断开客户端写成远端已终止 |

`pg` 源码中的 Client.cancel 未列在当前公开 Client 合同，依赖内部 activeQuery／密钥／队列，首期不采用；也不自行实现 wire CancelRequest。上述公开 SQL 控制路径仍须证明所属身份、权限与竞态边界；未证明的部署只显示具体不可用／UNKNOWN，不能宣称强取消。正常终结后关闭该操作连接；将来若有实证收益再讨论池复用，另证回滚、会话重置和驱动 prepared cache 一致性。[V][P3][P6][M2][M6]

## 5. 结果与参数精度：保留可复算材料

**权威留存是 Host 确切保存的结果文件字节，不是数据库物理页、原始 wire bytes 或业务正确性保证。** 驱动已解码协议，数据库可能已做舍入／JSONB规范化；实际返回值、源类型和解释条件必须一起保存。[DB06–07、13](spec.md)

| 类别 | PostgreSQL | MySQL2 |
| --- | --- | --- |
| 行与类型 | `rowMode:'array'`，query 级公开 types parser 在 text 模式保留非 NULL 返回文本；记录列顺序、OID／类型及可取得的 typmod／精度／标度 | `rowsAsArray:true`；记录列顺序、类型码、flags／字符集及可得精度。整数、精确数值、日期／JSON显式使用下述公开选项 |
| 整数／金额 | BIGINT、NUMERIC及其数组保留文本；固定 pg-types 的 numeric[] 默认 parseFloatArray，不能依赖默认值 | `supportBigNumbers:true, bigNumberStrings:true, decimalNumbers:false`，BIGINT／DECIMAL保留字符串；不能先经过 JS Number 再转回来 |
| 日期与时间 | DATE／TIMESTAMP保留无时区语义；TIMESTAMPTZ保留返回文本与实际 session TZ，不假称原录入 offset；保留微秒、infinity，interval 不换固定秒 | `dateStrings:true`，保留微秒、TIME负值／超24小时、零／无效日期的实际表示与 session TZ／sql_mode，不默认为 JS Date 或 UTC |
| JSON、数组、未知类型 | JSON／JSONB与嵌套数组保留文本和源类型，避免 JSON.parse 的大整数／小数舍入；未知类型标未知解释 | `jsonStrings:true` 保留 JSON 文本；BIT／二进制需要公开 typeCast 按实际类型取 Buffer／编码。不能对 binary execute 所有字段一律 field.buffer() 或 typeCast:false，以免误读固定宽整数／浮点 |
| 浮点、空值、二进制 | 两库浮点本身近似；单独编码 NaN／Infinity／负零及源类型，不承诺还原未知十进制原数。NULL、空串、空二进制分开，二进制用有标签的 base64／文件引用，保留编码，不做隐式 Unicode 归一化 | 同左 |
| 查询参数 | 参数的精确字符串／字节、NULL、类型与实际发送表示一起记录；拒绝已越过安全整数的 Number、以 JS Date 表示微秒精度、undefined 等含糊输入 | 公开 TypedParameter 的 BIGINT／DECIMAL用字符串；固定编码器的 DATE／DATETIME／TIMESTAMP仍会 new Date(value)，精确时间改用 VARCHAR原文并由 Agent 的 SQL 明确类型解释／转换，保存该解释；不能把 T.TIMESTAMP(string) 宣称无损 |

这些是固定发行源码导出的候选配置，尚无运行证明。Host 做格式、类型与留存，Agent 自主选择合适 SQL／计算工具；Host 不增加金额计算器或业务舍入规则。表达式列拿不到 precision／scale 时写 unknown，不编造；文本数组／未知类型保留不等于所有类型已可自动计算。[V][P5][P7][M5][M7]

**文件格式采用普通 JSON 文件集**：一个 manifest＋按顺序的 rows-NNNN.json，每块以“列描述＋行数组”表达；精确值为字符串／显式类型，NULL独立。重复列名按 ordinal 区分；可另给阅读用 CSV，但 CSV 不作唯一权威输入。沿现有 `.json` 文件能力，不另扩 JSONL／NDJSON 格式；文件集自动纳入审查仍是下节新增接缝。

manifest 最少包含原项目／任务／operation、结果版本、连接配置修订、实际来源实例、SQL与有类型的参数、获取起止、session TZ／encoding／sql_mode、实际事务隔离和可得快照条件、列定义、块顺序／字节数／摘要、已接收／持久化／交付行数、已知服务端行数或 unknown、限制／截断／错误／取消状态。来源对象分列为**实际观察到的对象及元数据证据、Agent声明的依赖、未覆盖／未知对象**；SQL本身留存不等于依赖已被Host验证。表达式、视图、函数、动态读取可能不由返回列元数据完整揭示，不推断为完整取数图，也不为此自建SQL parser。SQL／参数按原项目数据资格保存；凭据不入回执。跨多条 SQL 的结果不自动合成同一快照。[DB06](spec.md)

流写入当前 owner 私有的 pending 文件，查询成功、所有块关闭与摘要完成后原子提交完整 manifest；磁盘满、超限、写入失败或取消只保留标明 partial 的材料，不交为完整输入。取得／存下／提供／读取／采用分别记录，避免“文件有摘要”等于“核算读完”或“全库完整”。历史报告仍固定原版本；数据与过程保存时沿 `020_clean`、报告沿 `060_reports`，不改 `010_draw` 软约束。

## 6. 数据说明、Studio 与核算接缝

结果引用进入原数据说明与 sourceInputVersion，补足库／schema／表／列／查询表达式位置；文件固定后沿已有文件位置。说明保留粒度、单位、时间、歧义与准确语义版本。Agent 可准备 Studio 候选和 Binding；正式发布、项目采用、图刷新、实际使用分别记录，共享定义不共享凭据、活库权限或原项目明细。不建立第二份语义／公式权威。[DB08–10](spec.md)

以下现状已对照当前 HEAD `ef3e7d0` 的实现；**不能把旧独立链、现行 RCR／CNR 和本次数据库独立候选混成同一现有能力。**

| 通道 | 当前真实能力／限制 | db-link 最小增量与边界 |
| --- | --- | --- |
| 默认报告计算复核 RCR | 父请求内一次前台复核，已看到作者稿，属于知情复核；最多24件数据＋1报告，每件50MiB、合计100MiB；初始交付正文／转义元数据共20,000 UTF-16单位 | 普通JSON可作为现有材料，但现行profile不因拿到manifest就能读取所有块。Host固定回执与材料层的readMaterial方法不是核算Agent已获按需reader的证明；不宣称整批已核算，不静默放宽限额或自动重委派修订稿 |
| 结论建议审查 CNR | 用户明确开始、text-only、不重算；最多24件依据、固定总50MiB；报告捕获≤196,608 bytes，完整报告／元数据须容于65,536 UTF-16单位，剩余依据可能截断 | 复用固定结果的合格说明与实际提供材料；保持文本容量与未提供提示，不因DB文件集变成可执行取数／计算会话 |
| 数据库独立核算候选 DB11–12 | 已批准设计中的新增候选，尚无新接线。旧legacy写开关／旧最多32件材料通道不是可恢复的实现基础 | 结果引用自动展开受限文件集、对全集资格和字节固定、受限按块／范围读取是**必需新增接缝**。沿原owner/profile/lease做最小受管能力；不临时启用全部文件工具、MCP、用户扩展，不要求用户逐块选择或导出上传 |

现状定位：[RCR工具合同](../../../src/agent/report-calculation-review.ts#L53)、[RCR材料限额／交付](../../../src/host/report-calculation-materials.ts#L46)、[CNR材料](../../../src/host/conclusion-review-materials.ts#L46)、[CNR文本角色](../../../src/host/verification-sessions.ts#L54)。数量／字节与上下文是不同上限；材料固定成功不代表模型可见全文。若受管读取仍无法在预算内完成，须给出覆盖不足，不能宣称核算成功或要求人长期拆文件补救。

数据库独立候选首次冷读仅获得中性来源身份／覆盖、足够原始的固定材料、问题和事前语义；**作者SQL／脚本／聚合答案／报告在首次依据保存前隔离**。全部材料仍按来源资格固定，但作者方法不混入冷读manifest；揭示后再比较。原Agent自主处理意见、新稿另存，后续明确知情复查。父请求准入择一种计算核验合同，不叠加默认RCR与独立链；CNR继续原独立入口，历史只读。[DB11–13](spec.md)

核取数优先准备足够的原始固定范围，不能把作者聚合表当独立源。PostgreSQL 可另评估原生导出／导入快照，但要求适当隔离、导入时机、导出事务存活及资源预算；不为漫长模型过程无限持有事务。MySQL InnoDB REPEATABLE READ 的同事务一致读取不能当成跨独立会话的通用共享快照token。**一期不承诺跨库同样的活库重查能力**：有条件才开放同版本独立查询，否则准确显示只核固定结果／取数覆盖不足；实时再查是新观察。[P8][M8]

IN01–IN07接入记录：基于工程规范v1.10／Interface v3／官方Pi1.4.0；Host由Codex维护统一适配，连接资源挂真实projectId/taskId/request/operation，独立候选沿获准核算身份附属profile，名称／字段待实施契约确定，不自注册Agent域。普通任务、核算、出稿各自策略不互相继承；当前server的conclusion任务不受旧自动保护，不能当作现成受管DB能力。若公开接口不能表达所需保护，先补最小契约与验收再实施，不在本文虚构新Interface版本或解除出稿保护。[统一接入](../../../docs/agent-session-integration.md)

## 7. 四原则专项自检与后续验收

| 原则 | 实际安排与反例检查 | 本轮结论 |
| --- | --- | --- |
| Host管环境 | 凭据／TLS／原生权限、来源与owner、预算、取消事实、精确文件留存；拒绝UI隐藏代权限、裸ID盲取消、partial当complete、Host改业务SQL／补算 | 设计职责符合；权限／取消实证待做，缺口不得写成PASS |
| Agent自主执行 | 自选源／SQL／批次／计算／解释／修订；不强制说明→Studio→核算顺序，不预定义经营SQL或专业判分；冷读与出稿权限沿原角色 | 设计符合；连接串行仅约束同一物理资源，不限制多操作自主并行 |
| 优先复用官方能力 | 精确官方pg／cursor／mysql2，Pi公开工具和原Interface／文件／说明／Studio／审查；只补权限、来源、受管取消、精度与文件集读取缺口 | 设计符合；不改包、不造协议／SQL引擎／Runtime／全域版本台账，兼容未验证 |
| 减少人类操作 | 初次提供资格与模型出口、项目首次引用后任务继承；普通授权内直接提问，结果／文件集自动固定与衔接，必要业务歧义才问人 | 设计符合；不让人手工KILL、分页搬运、逐次审批、重复填凭据；权限不足不以人工补动作掩盖 |

最少路径仍为“配置并测试一次 → 项目首次授权 → 提业务问题”；同域复用无需重复凭据，不同域绑定只在首次资格配置处理。失败时给出权限／TLS／限额／取消未知等具体技术原因，普通允许能力按原策略继续；不将真实权限扩大或不可替代的业务决定默认代办。本轮无用户流程或UI结构变更，沿用已批准Demo，不重做示意技术标签，不把它当已接通数据库的展示。

后续获授权开发时从以下合同导出真实正反向验收；**下列均未执行，不是本轮检查成绩**：

| 验收组 | 必须建立的证据 |
| --- | --- |
| 精确包与环境 | 官方原包／lock完整性、声明包、Node25、实际服务器／认证／TLS目标名／CA；DNS正确／错误SAN／错误CA，IP／自定义流单验未通过不准入；三方源码无改写；代理节点路由与失败条件 |
| 权限与预算 | 同域复用、跨域拒绝、行／列／元数据／同账号会话、角色重置、函数副作用、KILL／发信号、SET／set_config／事务状态、MAX_EXECUTION_TIME／SET_VAR预算覆盖、模型出口、撤权不续派；不能满足DB05／14的部署不得准入 |
| 取消与生命周期 | 长查询／锁等待／cursor读取、取消成功／竞态成功、原连接消失、控制通道失败／同DSN异节点／ID复用、晚到结果、并发owner不互停；SDK／本地／远端事实分开，UNKNOWN不重放 |
| 精度与完整性 | >2^53、signed／unsigned边界、DECIMAL标度、numeric[]、JSON大数、小数、微秒／时区／零日期／TIME、NULL／空值／重复列／二进制／未知类型；参数编码与结果都检；大单行、流背压、磁盘满、截断及原子固定；来源对象观察／声明／未知不混淆 |
| 现有资产与核算 | 数据说明和Studio准确版本，跨项目不泄露；JSON文件集资格／reader／限额、冷读不见作者法、默认RCR／CNR职责不变、同请求择一、知情复查、旧稿保全；实时再查不得冒充同版本 |

准备任务清单及作者／非作者实际检查记在[result](result.md)，候选身份另见[driver-selection-manifest.json](driver-selection-manifest.json)。本轮通过与否仅针对文档设计及证据一致性，不等于数据库能力、专业质量、工程交付或用户验收。

## 8. 请确认的具体内容

请确认本补充的 **`pg 8.23.1`＋`pg-cursor 2.22.1`／`mysql2 3.24.6`** 版本建议，以及真实权限域、操作独占连接与诚实取消、精确JSON文件集和最小受管核算接缝。首批库类型与薄适配方向已确定，无需重复决定。

其中同账号跨会话能力与取消身份／远端终结仍是必须在后续方案／实证中闭合的准入条件，不以本轮确认当作风险接受。**确认本补充也不自动启动开发、依赖安装、业务库／模型访问、SDK升级、Git／CI或运行采用；继续暂不开发。**

## 官方资料

[V]: driver-versions.md
[P1]: https://www.postgresql.org/docs/current/ddl-priv.html
[P2]: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
[P3]: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL
[P4]: https://node-postgres.com/features/ssl
[P5]: https://node-postgres.com/features/queries
[P6]: https://www.postgresql.org/docs/current/runtime-config-client.html
[P7]: https://node-postgres.com/features/types
[P8]: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION
[M1]: https://dev.mysql.com/doc/refman/8.4/en/create-view.html
[M2]: https://dev.mysql.com/doc/refman/8.4/en/kill.html
[M3]: https://dev.mysql.com/doc/refman/8.4/en/sql-prepared-statements.html
[M4]: https://github.com/sidorares/node-mysql2/blob/v3.24.6/lib/base/connection.js#L404-L453
[M5]: https://github.com/sidorares/node-mysql2/blob/v3.24.6/typings/mysql/lib/protocol/sequences/ExecutableBase.d.ts
[M6]: https://github.com/sidorares/node-mysql2/blob/v3.24.6/lib/commands/query.js
[M7]: https://github.com/sidorares/node-mysql2/blob/v3.24.6/lib/packets/typed_parameter.js
[M8]: https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html
[M9]: https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html#optimizer-hints-execution-time
[N1]: https://github.com/nodejs/node/blob/v25.9.0/lib/internal/tls/wrap.js#L1657-L1665
[N2]: https://github.com/nodejs/node/blob/v25.9.0/lib/net.js#L1416-L1442

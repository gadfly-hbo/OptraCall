# db-link 远端时间预算与所属收尾研究

2026-11-14 · 只读一手资料研究；未安装、启动或测试数据库、代理、模型。本文件独立于本地接收内存隔离研究。

依据：[已批准驱动合同第3–4节](driver-selection.md#3-agent-自主取数与公开接口)、[执行资源决定](execution-resource-decision.md)。用户已选择保留硬准入、先评估成熟资源隔离方案。本研究不改变 `queryQualified=false`，不修改批准的 `pg 8.23.1`／`pg-cursor 2.22.1`／`mysql2 3.24.6`／`node-sql-parser 5.4.0`，不把此前有限原生测试成绩转成新部署的 PASS。

## 1. 结论与完成范围

**本次没有找到足够公开证据，证明在已有普通 MySQL 业务库前加一个现成代理或开启官方8.4参数，即可同时满足：prepare＋execute 总墙钟预算不可由业务 SQL 放宽、取消目标所属安全、断线／迟到后不误停他人、原命令与清理完成可确认。当前 MySQL 继续保留 `db_prepare_total_budget_unenforced`。** 这是否定本次候选的完整证据，不是证明所有商业产品或未来部署都不可能。

PostgreSQL 原生语句／事务超时更接近所需执行边界，可继续作为**部署限定研究候选**；但参数可修改、SQL cursor 与协议 portal 的计时不同、取消身份与完成确认仍须证明。它也不能解决另一项解码前本地内存准入，不能据此放开 PG 查询。

| 阶段任务 | 本轮结果 |
| --- | --- |
| 核对总预算、所属取消、公共 cleanup 硬合同 | 已完成，只读 |
| MySQL8.4官方参数、插件及固定源码 | 已完成文档／源码研究；未实测 |
| ProxySQL、MaxScale覆盖与部署／许可 | 已完成候选排查；未选型、未引入 |
| PostgreSQL extended protocol／cursor／事务比较 | 已完成文档与固定源码交叉核对；未实测 |
| 给出最小验证、淘汰条件、原 owner 接缝 | 已列出，全部待另获授权执行 |

## 2. 先分清四个时间事实

一次 Host 操作至少有连接／认证、会话准备、COM_STMT_PREPARE或Parse／Bind、Execute与取结果、事务／连接收尾。**每命令计时不自动等于操作累计期限**；网络 read/write 超时也不等于数据库执行超时。

应事前固定操作总期限、各阶段适用限制和清理观察期限；剩余时间只可减少。Host 到期拒派后续命令是本地事实。远端到期触发中断、原命令实际报错／完成、事务已回滚、连接已释放是另外的事实。MySQL官方明确 KILL 返回不等待终止确认，清理还需时间；因此普通数据库的协作式中断不能宣传为“截止毫秒一到，远端所有资源必已消失”。[M-KILL]

本地 worker／容器／VM 退出，或驱动连接已 destroy，只能证明对应本地资源事实。没有同一远端操作的终结证据，状态仍为 UNKNOWN，不能释放原 owner 的全部占用或按旧 PID／connection ID 再发取消。[驱动合同](driver-selection.md#4-查询取消从请求到远端终结)

## 3. MySQL 8.4：原生限制覆盖哪里

本次对照官方8.4手册与固定官方源码：已有测试目标 `8.4.0`（`dc86e412f18b36ce271f791026714e8caa0ec919`），并补读 `8.4.9`（`f9c88132a87a7d9e740e50bce2621999695bd3fe`）。8.4.9仅为研究交叉检查，不是升级建议或授权。[M-REL]

现有目标MySQL8.4.0 Community随版许可为GPLv2；下列普通原生参数不要求另引代理，Enterprise Thread Pool则是表中单列的商业组件。源库管理员仍需授权实际账号、参数与监控能力，本研究不操作现有业务库。[M-LICENSE][M-TP]

| 机制 | 实际覆盖／缺口 | 对总预算的判定 |
| --- | --- | --- |
| `max_execution_time`／`MAX_EXECUTION_TIME` | 合格只读 SELECT 的执行；不含任意命令，存储程序中的 SELECT不适用；正数hint可覆盖session默认。[M-VAR][M-HINT] | 不能代替prepare＋execute总期限，也不能仅靠Host先SET证明不可放宽 |
| `lock_wait_timeout` | metadata锁；每次申请分别计时，一条语句多次申请可累计超过该值。[M-VAR] | 可缩短prepare的某次锁等待，非prepare总计时 |
| `innodb_lock_wait_timeout` | InnoDB行锁；不覆盖MySQL表锁或通用metadata／解析过程；默认只回滚当前语句。[M-INNODB] | 不能补prepare或事务总期限 |
| `wait_timeout`／`interactive_timeout` | 等待客户端活动；`net_read_timeout`／`net_write_timeout`分别限制通信读／写阻塞。[M-VAR] | 不应作为运行中prepare／计算的总墙钟约束 |
| Resource Groups | CPU亲和性和线程优先级，平台／配置有约束。[M-RG] | 没有文档化的每操作墙钟终止能力 |
| Enterprise Thread Pool | 商业Enterprise Edition插件，管理并发／调度；`thread_pool_longrun_trx_limit`到期是放宽线程组事务数量上限。[M-TP][M-TP-VAR] | 不是杀死超时事务的总期限，购买Enterprise本身不补该合同 |
| Connection Control插件／账号资源限额 | 前者针对重复失败登录施加延迟；后者限制每小时命令／连接及并发连接。[M-CONN][M-ACCOUNT] | 不是prepare＋execute累计定时器 |

源码把缺口定位得更具体：`COM_STMT_PREPARE`调入 `mysqld_stmt_prepare`；prepare过程中解析并调用 `prepare_query`，该固定文件没有statement timer接线；`SET_VAR`在prepare期间还会更新／恢复变量。SELECT计时器在 `Sql_cmd_dml::execute` 中设置。8.4.0与8.4.9所查路径一致。[M-PARSE-SRC][M-PREP-SRC][M-PREP-NEW][M-SELECT-SRC]

官方另说明prepare期间会持有metadata锁、准备完再释放，不能把prepare当作无远端资源阶段。[M-MDL] 因此 `max_execution_time`＋小 `lock_wait_timeout` 只是不同阶段的限制组合；没有证据把解析、多个锁等待、prepare及execute自动折算到同一个不断减少的截止。把原SQL改写成hint／包装SQL、改官方驱动／服务器源码，都不在本轮选型边界。

## 4. ProxySQL：确实覆盖prepare，但仍未闭合总期限与安全确认

研究固定 **Stable `3.0.12`，2026-11-05，官方commit `e2f317aba4e2ce06acfbab05920dc446a602cb40`**；同commit还发布3.1／4.0不同tier，不能把那些功能自动计入Stable。[X-REL] 固定LICENSE是GPLv3。[X-LICENSE] 它是新增独立代理服务，须选择官方实际发布的平台包，需要可信主机、两侧网络／TLS、配置与运维资格、后端认证和可用的KILL权限；本研究未核定Mac本机部署适配。普通只读账号同账号也可能拥有跨会话KILL能力，原权限合同仍须单独满足。[M-KILL]

有用的真实能力：官方说明全局／query rule timeout由代理计时，超时由另一个线程连接backend发送KILL；超时路径禁止重试。[X-VAR] **并非只管COM_QUERY**：固定源码把 `PROCESSING_STMT_PREPARE`、`PROCESSING_STMT_EXECUTE`与普通query放在同一超时检查分支，在命令开始时调用 `SetQueryTimeout()`。[X-SRC-STATE][X-SRC-ARM]

但以下缺口仍在：

1. `SetQueryTimeout()`先清零，再从当前时间加预算；lazy prepare完成回到execute时把后端状态改为ASYNC_IDLE，于是下一命令重新设期限。**源码证明的是命令级候选限制，不是客户端一次execute所需prepare＋execute共享的累计截止。** 官方prepared architecture也允许execute时在新后端lazy prepare。[X-SRC-TIMER][X-SRC-PREP][X-PS]
2. `mysql-max_transaction_time`是值得区分的候选：若先建立并被代理识别的显式事务，可能在事务范围累计覆盖prepare和execute；固定源码按 `active_transactions`／`transaction_started_at`将session标为killed。它不是无条件存在的单操作总期限，仍要验证首次prepare计入时点、事务状态、路由、清理与业务SQL不可重置边界。[X-VAR][X-TRX-SRC]
3. 超时helper捕获后端thread ID及IP，在分离线程建立控制连接，拼接 `KILL QUERY <id>`执行。所查helper没有提供带会话代际令牌的原子取消；也没有向原Host operation返回可等待的“helper完成且原命令／事务已结束”契约。异步控制连接遇到网络延迟、原连接已消失、节点重启／ID再用时，现有源码／文档不足以证明不会命中后继资源。[X-SRC-KILL][X-SRC-ARGS]
4. 代理连接池和prepared映射可能让前端连接与物理backend不一一对应。只关闭Host到代理的连接，或启用 `mysql-kill_backend_connection_when_disconnect`，不能代替所属终结证据；禁用复用／固定单后端可减少歧义，仍不补ID代际与清理确认。[X-PS][X-VAR]

以上是源码可复核的能力／证据缺口，**不是已复现ProxySQL误杀的断言**。因此暂不建议仅为这两项硬准入引入ProxySQL。若供应商能提供固定版本、受支持的操作总期限和所属完成契约，再做有限合成验证；不得在OptraCall自建代理取消循环来填补公开合同。

## 5. MaxScale：版本和用途不能混用

**现行25.01及以后与旧公开24.08不是同一可审查候选。** 官方宣布25.01起转闭源商业许可；截至本次查阅，官方条款入口指向2026-10-16软件条款（2026-11品牌更新），生产使用涉及适用订阅／订单及组合使用范围，另有trial／Free Tool条款。不能沿用旧2025 PDF或把trial当免费生产部署。[S-CHANGE][S-TERMS] 本研究没有采购、安装或法律适用裁定。

公开源码固定 **24.08.0，`ac6ee6fd6603fcc7e031e4f8b0efc33383e5d04d`**：随版BSL1.1允许生产总计少于3个server instances，Change Date为2027-09-09，之后GPLv2或以上；不是当下任意规模免费开源许可。[S-LICENSE]

在官方通用service／readwritesplit配置及24.08固定源码中，本次查到的是：`wait_timeout`（旧名connection_timeout）处理idle session；`net_write_timeout`处理客户端输出阻塞；`multiplex_timeout`限制等候共享连接；`transaction_replay_timeout`限制重放尝试。这些不能当成原始COM_STMT_PREPARE＋COM_STMT_EXECUTE总期限。[S-CONFIG][S-SESSION-SRC][S-REPLAY]

搜索到的MaxScale `query_timeout`来自ExasolRouter的Exasol ODBC查询配置，不能转用为普通MySQL／PostgreSQL代理合同。[S-EXASOL] 官方也只称其他MySQL协议数据库可能兼容，主要设计／测试目标仍为MariaDB；不能从MariaDB功能推断MySQL8.4支持。[S-FAQ]

**判定：没有足够公开文档／可审查固定源码，支持将现行MaxScale登记为本合同的通用补全方案。** 旧24.08没有本次所需证据；闭源新版本需供应商明确MySQL8.4支持、累计预算、原子所属取消、断线语义和完成回执，才值得重新列候选。这个结论不是断言新版本绝无其他功能。

## 6. PostgreSQL：协议portal与SQL FETCH必须分开

对照官方18文档、已有测试目标18.1固定commit `4b324845ba5d24682b9b3708a769f00d160afbd7`，以及批准pg-cursor2.22.1固定commit `0980cefebe0ae461da8883703be049fe13ca96cf`。

上述PostgreSQL原生能力属于PostgreSQL License发行的服务器能力，不要求商业扩展。实际源库版本、受限登录与服务端参数／监控资格仍由部署核定，不以研究建议要求业务库升级。[P-LICENSE]

| 机制／路径 | 准确边界 |
| --- | --- |
| `statement_timeout` | 从服务端收到命令计时，extended protocol的Parse／Bind／Execute／Describe可启动；完成Execute或Sync结束该轮。simple query多条语句分别限时。[P-TIME] |
| SQL `DECLARE CURSOR`后多次SQL `FETCH` | 各自是命令，不能把每条FETCH都未超时推断成整个取数操作未超总预算；累计边界须另证。[P-FLOW][P-TIME] |
| 本次pg-cursor的named portal | `read(n)`发送同一portal的Execute＋Flush；PortalSuspended只交付该批，并非整个SQL完成；close／错误会Sync。[P-CURSOR] |
| pg-cursor暂停后的计时 | **不能简单写“每read重置statement_timeout”**：18.1在portal真正完成分支关闭timer，在PortalSuspended分支未关闭，`enable_statement_timeout`也不重启已启动timer。因此固定路径的推断是计时可跨多个受限Execute和批间处理延续到完成／Sync。输入读取时query cancel可延迟处理，仍不保证到点同步清空资源。[P-TCOP][P-TCOP-START][P-TCOP-INT] |
| `transaction_timeout` | PG17新增，18可限制显式及单语句隐式事务的session总时长，prepared transaction例外；不能外推到旧版PG。[P-17][P-TIME] |
| `lock_timeout`／idle类timeout | 前者每次锁申请；idle_in_transaction只在事务内等客户端时生效，idle_session只管事务外idle。不能各自代替活动语句或总操作期限。[P-TIME] |

2020年pg-cursor官方issue维护者说明过“cursor暂停时statement_timeout仍走”的现象，可作为反例线索，不能代替本次18.1／2.22.1实测。[P-ISSUE] 使用SQL FETCH、额外Sync、换代理或换版本时，必须重核协议边界，不能套用上述固定源码推断。

**参数不可绕过仍未天然成立。** 固定18.1源码将statement_timeout、transaction_timeout、idle_in_transaction_session_timeout列为PGC_USERSET，set_config又是公开改参数SQL函数；角色默认／连接startup options只能建立初值。实际允许SQL、函数与事务控制的组合须证明无法放宽／跨事务重置必要上限。[P-GUC][P-ADMIN] 这是准入反例要求，不宣称当前技术parser已经被绕过。

取消方面，协议原生CancelRequest有PID＋secret key匹配，优于只携带PID的SQL取消，但它本身也没有直接成功应答，客户端须等待原查询响应。[P-CANCEL] 当前批准驱动合同不采用私有Client.cancel或自行写wire请求，不能把该协议能力写成现成接线。公开 `pg_cancel_backend` true只证明信号已发送；`pg_terminate_backend(pid, positive_timeout)`可以等待进程终止，但仍以PID选目标，并未解决旧PID先查后发的竞态，也不能自动扩大为首期终止会话权限。[P-ADMIN]

## 7. 对已有业务库的部署决定

| 环境 | 本次研究判定 | 还缺什么 |
| --- | --- | --- |
| 普通MySQL8.4直连 | 不足；维持不准入 | 总prepare预算、不可放宽与所属终结 |
| MySQL8.4＋ProxySQL3.0.12 | 有命令级prepare超时、事务累计研究价值；整体不足 | 同一操作累计截止、ID／节点代际安全、控制命令和原命令全部终结的受支持契约 |
| 普通MySQL＋MaxScale | 未找到足够适用证据 | 精确版本／许可／MySQL支持及完整预算／终结合同 |
| PG17+，固定直连／可信部署 | 原生总事务时间能力可复用，条件候选 | 不可放宽、portal准确边界、所属取消／完成实测，及独立本地内存约束 |

若后续另获授权部署**专用分析副本／实例**，管理员控制的进程／VM可拥有整个远端故障域，可能提供不同级别的强制终结；这需要数据复制、快照语义、权限、运维与业务影响新合同。不能让普通共享业务库被整个mysqld／postgres停机来满足一个Host操作的预算，也不能把“本地VM停止”外推成“远端共享库命令停止”。本研究未提出或启动此类部署。

## 8. 最小验证与停止选型条件（均未执行）

先取得一个固定组件版本、部署拓扑、原子所属／终结合同，再只在隔离合成库验证。没有这份合同不先安装代理试运气。统一冻结操作期限、清理观察期限和容差；分别保留接收时点、后端开始、取消发出、控制终结、原命令终结、事务回滚、连接释放及服务端观察证据。

| 最小场景 | 必须证明 | 直接停止该候选的条件 |
| --- | --- | --- |
| MySQL prepare被独占metadata锁阻塞 | 命令确为COM_STMT_PREPARE；MAX_EXECUTION_TIME小值不足时，总期限仍涵盖prepare | 只因单次lock_wait_timeout返回，或prepare超期限而仍允许execute |
| 多对象依次锁等待＋prepare后慢execute | 各阶段未单独超限但合计超预算，仍按同一剩余期限终止 | 每次prepare／execute／锁申请重新获得完整预算 |
| PG Parse／Bind锁等待、portal多批含暂停、SQL FETCH对照 | 实际消息与timer范围一致；暂停期间不发下一read，由服务端观察实际中断／释锁时间；总事务预算覆盖完整操作 | 把PortalSuspended当CommandComplete；仅下一read报错就认定暂停期间已及时清理；每批新期限无限延长 |
| 超时／限制绕过 | MySQL正数hint／SET_VAR，PG set_config／RESET／事务边界／可调用函数均不能放宽强制总预算 | 仅配置初值、只测SHOW值，或允许SQL可改变必要限制 |
| 双owner并行与晚到控制命令 | A停止不影响B；原查询临界完成后控制命令不命中新命令 | 旧ID盲KILL、同DSN异节点、断线后自动重连发取消、重放原SQL |
| 控制连接故障、代理／源重启、原连接丢失／身份更替 | 不知道远端结局时保留UNKNOWN与原占用；已失效目标不再派发控制 | KILL返回／TCP关闭即宣布资源释放，或以超时“推定完成” |
| 正常／取消／回滚收尾 | 原命令和所有控制命令均终结；事务与连接完成清理，文件partial不发布 | 有孤儿helper、事务／锁残留、迟到结果发布、占用提前释放 |

对“ID再用”的测试不能用“短时间没遇见”证明安全；必须结合固定实现的原子身份机制或协议契约。测试可注入控制延迟、连接消失、后端更替来证伪；若组件只有裸ID SQL控制且无适当代际保护，重复成功样例不能补这个结构性证据缺口。

## 9. 复用现有owner／operation公共cleanup

只读核对当前 [SessionLease.onCancel／withSession](../../../src/host/agent-sessions.ts#L335)、[cancelOperation](../../../src/host/agent-sessions.ts#L104)、[finish](../../../src/host/agent-sessions.ts#L278)：取消handler由同一operation等待；finish失败保留cleanupFailed和原slot，不静默再跑。该能力是未来接入点，不等于DB候选已经正确实现所有远端事实。

未来获授权时应将独占业务连接、实际节点／会话身份、固定期限、控制调用和终结promise挂在**原project/task/request/operation的资源句柄**，通过既有lease注册取消。取消handler返回的promise必须覆盖控制调用及原命令／事务的可证明收尾；错误拒绝进入既有失败隔离。公共retryFailed只可重试仍安全、仍有真实所属句柄的清理，不能据此按缓存ID再KILL，更不能重跑SQL／模型。迟到事件仅补原收据，不发布报告或核算成果。若公开生命周期无法表达远端UNKNOWN，先补最小公共契约；不增平行Runtime、全局Map或第二套运行状态权威。

本轮只产出本研究文件。研究结论不是工程交付、组件采用、真实业务可用或产品验收；当前两库查询硬准入仍关闭，已有WIP、原FAIL／UNKNOWN与有限测试成绩分别保留。

## 一手来源

[M-VAR]: https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html
[M-HINT]: https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html#optimizer-hints-execution-time
[M-INNODB]: https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_lock_wait_timeout
[M-MDL]: https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html
[M-KILL]: https://dev.mysql.com/doc/refman/8.4/en/kill.html
[M-RG]: https://dev.mysql.com/doc/refman/8.4/en/resource-groups.html
[M-TP]: https://dev.mysql.com/doc/refman/8.4/en/thread-pool.html
[M-TP-VAR]: https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_thread_pool_longrun_trx_limit
[M-CONN]: https://dev.mysql.com/doc/refman/8.4/en/connection-control-plugin.html
[M-ACCOUNT]: https://dev.mysql.com/doc/refman/8.4/en/user-resources.html
[M-REL]: https://dev.mysql.com/doc/relnotes/mysql/8.4/en/news-8-4-9.html
[M-LICENSE]: https://github.com/mysql/mysql-server/blob/dc86e412f18b36ce271f791026714e8caa0ec919/LICENSE
[M-PARSE-SRC]: https://github.com/mysql/mysql-server/blob/dc86e412f18b36ce271f791026714e8caa0ec919/sql/sql_parse.cc#L2044-L2059
[M-PREP-SRC]: https://github.com/mysql/mysql-server/blob/dc86e412f18b36ce271f791026714e8caa0ec919/sql/sql_prepare.cc#L2331-L2477
[M-PREP-NEW]: https://github.com/mysql/mysql-server/blob/f9c88132a87a7d9e740e50bce2621999695bd3fe/sql/sql_prepare.cc#L2457-L2470
[M-SELECT-SRC]: https://github.com/mysql/mysql-server/blob/f9c88132a87a7d9e740e50bce2621999695bd3fe/sql/sql_select.cc#L675-L697
[X-REL]: https://github.com/sysown/proxysql/releases/tag/v3.0.12
[X-LICENSE]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/LICENSE
[X-VAR]: https://proxysql.com/documentation/global-variables/mysql-variables/
[X-PS]: https://proxysql.com/documentation/mysql-prepared-statements-architecture/
[X-SRC-STATE]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/lib/MySQL_Session.cpp#L7289-L7308
[X-SRC-ARM]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/lib/MySQL_Session.cpp#L7414-L7416
[X-SRC-TIMER]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/lib/MySQL_Session.cpp#L6506-L6534
[X-SRC-PREP]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/lib/MySQL_Session.cpp#L6585-L6596
[X-TRX-SRC]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/lib/MySQL_Thread.cpp#L5041-L5055
[X-SRC-KILL]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/lib/MySQL_Session.cpp#L503-L583
[X-SRC-ARGS]: https://github.com/sysown/proxysql/blob/e2f317aba4e2ce06acfbab05920dc446a602cb40/lib/MySQL_Session.cpp#L2857-L2875
[S-CHANGE]: https://mariadb.com/resources/blog/introducing-mariadb-maxscale-25-01-ga/
[S-TERMS]: https://legal.mariadb.com/agreements/enterprise/MariaDB_Software_License_Terms_2026-10-16_branding-2026-11.pdf
[S-LICENSE]: https://github.com/mariadb-corporation/MaxScale/blob/ac6ee6fd6603fcc7e031e4f8b0efc33383e5d04d/licenses/LICENSE2408.TXT#L4-L16
[S-CONFIG]: https://github.com/mariadb-corporation/MaxScale/blob/ac6ee6fd6603fcc7e031e4f8b0efc33383e5d04d/Documentation/Getting-Started/Configuration-Guide.md#wait_timeout
[S-SESSION-SRC]: https://github.com/mariadb-corporation/MaxScale/blob/ac6ee6fd6603fcc7e031e4f8b0efc33383e5d04d/server/core/session.cc#L1543-L1568
[S-REPLAY]: https://mariadb.com/docs/maxscale/reference/maxscale-routers/maxscale-readwritesplit/readwritesplit-settings#transaction_replay_timeout
[S-EXASOL]: https://github.com/mariadb-corporation/mariadb-docs/blob/main/maxscale/reference/maxscale-routers/maxscale-exasolrouter.md
[S-FAQ]: https://mariadb.com/docs/platform/mariadb-faqs/database-proxies-and-routers/mariadb-maxscale
[P-TIME]: https://www.postgresql.org/docs/18/runtime-config-client.html
[P-LICENSE]: https://www.postgresql.org/about/licence/
[P-FLOW]: https://www.postgresql.org/docs/18/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
[P-CURSOR]: https://github.com/brianc/node-postgres/blob/0980cefebe0ae461da8883703be049fe13ca96cf/packages/pg-cursor/index.js#L87-L211
[P-TCOP]: https://github.com/postgres/postgres/blob/4b324845ba5d24682b9b3708a769f00d160afbd7/src/backend/tcop/postgres.c#L2313-L2340
[P-TCOP-START]: https://github.com/postgres/postgres/blob/4b324845ba5d24682b9b3708a769f00d160afbd7/src/backend/tcop/postgres.c#L2806-L2813
[P-TCOP-INT]: https://github.com/postgres/postgres/blob/4b324845ba5d24682b9b3708a769f00d160afbd7/src/backend/tcop/postgres.c#L3389-L3445
[P-17]: https://www.postgresql.org/docs/release/17.0/
[P-GUC]: https://github.com/postgres/postgres/blob/4b324845ba5d24682b9b3708a769f00d160afbd7/src/backend/utils/misc/guc_tables.c#L2730-L2770
[P-ADMIN]: https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL
[P-CANCEL]: https://www.postgresql.org/docs/18/protocol-flow.html#PROTOCOL-FLOW-CANCELING-REQUESTS
[P-ISSUE]: https://github.com/brianc/node-postgres/issues/2183

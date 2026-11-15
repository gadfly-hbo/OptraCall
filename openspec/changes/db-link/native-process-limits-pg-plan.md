# macOS 原生进程限额：PostgreSQL 合成验证计划

2026-11-14。用户本轮授权原生进程限额隔离的合成验证，并明确使用 PostgreSQL；保持硬准入，不引入容器或代理。本文件为 PG fixture／计时／只读收尾观察的设计核对，**初稿制定时本分工未启动数据库、未运行下列场景**。后续分工明确授权本Agent承担唯一PG-only实例与有限矩阵，实际完成范围、原FAIL和NOT_RUN另见[本轮结果](native-process-limits-pg-results.md)；旧有限测试 PASS 不属于本轮成绩。

## 目标、范围与清单

目标是让主 Agent 在同一临时 PG18.1 实例上，分别核对受限 Node 的官方 SDK／TLS 正常路径、超大单值或本地超限退出、原远端会话与锁的实际变化。OS 限额能否形成可用边界与 PG 远端是否终结分别核定，不改产品 `queryQualified=false`。

| 阶段 | 本分工完成条件 | 状态 |
| --- | --- | --- |
| 规范与现状 | 已读 AGENTS、工程规范四原则／SDK约束／IN01–IN07、产品讨论稿和既有隔离／远端研究 | 已完成 |
| fixture 与版本 | 精确列出现有公开函数、双引擎副作用及可复用私有 PG 路径 | 已完成，只读 |
| 官方边界 | 浏览 PG18 文档、固定18.1源码和固定 pg-cursor2.22.1源码 | 已完成，只读 |
| 监控与最小矩阵 | 原身份、同实例、计时起点、暂停与清理观察可复核 | 已完成，计划 |
| 实际执行 | 初稿为主 Agent 统一启动；后续明确交由本Agent唯一启动PG-only实例，不重叠 | 已完成本轮有限矩阵，见结果；额外计划项仍NOT_RUN |

初稿允许写入仅本文件和外部 `~/.codex/visualizations/2026/11/14/db-link-native-process-limits/pg-plan/` 只读记录；后续分工另明确授权 `.local/db-link/native-process-limits/pg-probes/`、外部同名 `pg-probes/` 与上述结果文件。产品源代码、测试、SDK、依赖、锁文件、既有实验结论均不改；不安装软件、不连接真实业务或 Provider，不启动 MySQL，不切换服务或操作 MacBook。UI 和 Agent 会话接线没有变更，现有 Interface v3／project-task owner／operation/lease 边界保持。实验不构成新的产品查询准入、运行采用或产品验收。

## 1. 当前 fixture 的准确接口

代码发现先查已索引项目 `optracall-db-link-48da`，`*db-link-native*` 无图节点，随后按明确文件路径读取。当前 `scripts/db-link-native-fixtures.mjs` 只有两个导出：

```js
checkNativeFixtures(root = <repo>/.local/db-link/native-fixtures)
// Promise<{ pgBin, mysqlBase, postgres, mysql, packages,
//           postgresSource, mysqlSource }>

startNativeFixtures(options = {})
// 实际读取 options.root、options.openssl；没有 engines/engine/pgOnly 选项。
// Promise<{ configs, sources, directory, receipt, pgAdmin, mysqlAdmin,
//           untrustedCa, restartCertificate, stop }>
```

返回对象内闭包的签名为 `pgAdmin(database = 'oc_native') -> Promise<pg.Client>`、`mysqlAdmin() -> Promise<mysql2 PromiseConnection>`、`restartCertificate(engine, wrong) -> Promise<void>`、`stop() -> Promise<{ stopped, ownedPids, stops }>`。`configs.postgresql` 与 `configs.mysql` 都使用 `oc_reader`、随机合成密码、`localhost`、各自临时端口、`oc_native`、合成 CA 与预算。上述管理闭包和证书生成函数不是可单独导入的导出 API。

**不得为本轮 PG-only 调用 `startNativeFixtures()`。** 它必定生成双引擎目录、调用 PG `initdb`、调用 MySQL `--initialize-insecure`，随后顺序启动两套服务器；传一个未实现的 `engine:'postgresql'` 选项不会改变行为。现有 `tests/db-link-native.test.ts` 在 `OPTRACALL_DB_NATIVE=1` 时也调用这个双引擎入口，本轮不能通过该开关跑成“只验证 PG”。`checkNativeFixtures()` 不启动服务，但会检查两套二进制并执行它们的版本命令，本轮没有必要调用。

主 Agent 可在获准外部实验根单独创建 PG-only 临时 fixture，复用既有模式而不修改该脚本：

| 复用对象 | 已只读核对的值 |
| --- | --- |
| PG bin | `<repo>/.local/db-link/native-fixtures/pgsql-18.1/bin/`，已有 `postgres`、`initdb` |
| 源归档收据 | `<repo>/.local/db-link/native-fixtures/downloads/postgresql-source.json` |
| 官方归档 | `https://ftp.postgresql.org/pub/source/v18.1/postgresql-18.1.tar.bz2` |
| 记录的 SHA256 | `ff86675c336c46e98ac991ebb306d1b67621ece1d06787beaade312c2c915d54`，收据的下载值与官方值相同；不是本分工重编译／重验归档 |
| 已批准、当前实际包 | `pg 8.23.1`、`pg-cursor 2.22.1`；package／lock／安装包版本相符 |
| cursor 固定来源 | 安装包 `gitHead=0980cefebe0ae461da8883703be049fe13ca96cf` |
| OpenSSL | 既有 `/opt/homebrew/opt/openssl@3/bin/openssl`；仅生成本轮临时证书 |

只启动一个本轮 `spawn(<pgBin>/postgres, ['-D', <freshData>], ...)`；绑定 `127.0.0.1`、临时端口与私有 Unix socket 根，新的 data directory、新的 CA 和 SAN `DNS:localhost` 证书。合成管理员仅建库／建表／建受限账号与必要观察权限，随后 worker 与 monitor 使用 `oc_reader`。不发现、不停止、不复用系统／Homebrew或其他实验 PG 服务。主 Agent 保留本次真实 `ChildProcess` 句柄，停止也只用该句柄；PID 仅作证据，不能据旧 PID 搜索或发信号。

## 2. 官方 SDK 与 TLS 路径

最小参考配置使用公开 API，不引用私有 `Client.cancel`、连接 stream 或 cursor 内部字段：

```js
const client = new Client({
  host: 'localhost', port, database: 'oc_native',
  user: 'oc_reader', password,
  ssl: { ca, rejectUnauthorized: true },
  connectionTimeoutMillis: 3000,
  statement_timeout: statementMs,
  options: `-c transaction_timeout=${transactionMs} -c idle_in_transaction_session_timeout=0`,
});
await client.connect();
const cursor = client.query(new Cursor(sql, values, {
  rowMode: 'array', types: { getTypeParser: () => value => value },
}));
const rows = await cursor.read(1); // 固定2.22.1实际返回 rows 数组
```

固定安装包的 `read` Promise 返回数组，不能照在线 API 页的 `const {rows}=...` 示例使用。每 cursor 至多一个未完成 `read`；只传 summary／字节数／错误／身份给父进程，超大结果本体不经 IPC 或 stdout 再复制。官方文档也说明 read 回调交付时字段已加载、解析为 JS 类型，因此“最终只取1行”不证明单个巨大字段的解码前内存上限。[cursor 公开 API](https://node-postgres.com/apis/cursor)、[固定2.22.1实现](https://github.com/brianc/node-postgres/blob/0980cefebe0ae461da8883703be049fe13ca96cf/packages/pg-cursor/index.js)

正常连接坚持 DNS `localhost`、匹配 CA／SAN、`rejectUnauthorized:true`；不混入 connectionString 的 sslmode／sslcert 等，避免覆盖显式 SSL 对象。[pg SSL 文档](https://node-postgres.com/features/ssl)

TLS 反例按实际路径记结果：不信任 CA 必须拒绝；SAN 仅 DNS localhost 的证书在 `host:'127.0.0.1'` 连接时应因缺少 IP SAN 拒绝，这只能证明该 IP 负例。若要 DNS 名错配，须在没有活动操作后顺序更换本轮证书并重启唯一私有实例，或使用已合法解析到 loopback 的不同 DNS。固定 pg8.23.1 对 DNS host 会重写 TLS `servername=host`，仅传 `ssl.servername:'wrong...'` 不能建立该负例。不得关闭验证、改 hosts／驱动或把特殊流路径泛化为生产已支持。

## 3. 原会话与同一实例：精确只读观察

合成 setup 可沿现有 fixture 最小授予：

```sql
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO oc_reader;
```

`pg_control_system().system_identifier` 是 cluster 级标识，重启／复制数据目录可能保留；单独它不能证明当前实例代际。这里同时固定 system identifier、`pg_postmaster_start_time()`、端点与本轮真实 fixture 句柄，再固定 PID＋`backend_start`。[控制数据函数](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-CONTROLDATA-TABLE)

worker 在业务 SQL 前，以其实际 `oc_reader` 连接取得并只传一次原身份，后续不重新选目标：

```sql
SELECT pg_backend_pid() AS pid,
       a.backend_start::text AS backend_start,
       (pg_control_system()).system_identifier::text AS system_identifier,
       pg_postmaster_start_time()::text AS postmaster_start,
       current_database() AS database,
       inet_server_addr()::text AS server_addr,
       inet_server_port() AS server_port,
       session_user, current_user,
       current_setting('server_version_num') AS server_version_num,
       current_setting('statement_timeout') AS statement_timeout,
       current_setting('transaction_timeout') AS transaction_timeout,
       current_setting('idle_in_transaction_session_timeout') AS idle_transaction_timeout
FROM pg_stat_activity AS a
WHERE a.pid = pg_backend_pid();
```

时间戳直接 `::text` 保留微秒和时区，不先经 JS Date；绑定比较时 `$2::timestamptz`。`application_name` 可辅助日志关联，不能用作身份权威。monitor 是**同账号、独立的正常 TLS 连接**，每次 autocommit SELECT，不开长期 BEGIN，不发取消／终止／锁／管理 SQL。同角色有可见详情；不给它 `pg_read_all_stats`／`pg_signal_backend` 等扩大权限。只读账号不等于不能调用所有有副作用函数，尤其同角色取消函数资格仍是原硬准入的独立缺口。[PG 活动视图与可见性](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW)

每次轮询用同一个 SELECT 同时读来源与原 tuple；参数为原 `pid`、原 `backend_start`、固定合成表名如 `synthetic.numbers`：

```sql
SELECT clock_timestamp()::text AS observed_at,
       (pg_control_system()).system_identifier::text AS system_identifier,
       pg_postmaster_start_time()::text AS postmaster_start,
       inet_server_addr()::text AS server_addr,
       inet_server_port() AS server_port,
       current_database() AS database,
       a.pid AS original_pid,
       a.backend_start::text AS original_backend_start,
       a.state, a.xact_start::text, a.query_start::text,
       a.wait_event_type, a.wait_event,
       p.backend_start::text AS current_same_pid_backend_start,
       (SELECT count(*)::int FROM pg_locks AS l
        WHERE l.pid = a.pid) AS original_pid_lock_count,
       (SELECT count(*)::int FROM pg_locks AS l
        WHERE l.pid = a.pid AND l.relation = to_regclass($3)
          AND l.mode = 'AccessShareLock' AND l.granted) AS table_read_lock_count
FROM (VALUES (1)) AS singleton(dummy)
LEFT JOIN pg_stat_activity AS a
  ON a.pid = $1 AND a.backend_start = $2::timestamptz
LEFT JOIN pg_stat_activity AS p ON p.pid = $1;
```

每条记录先比较原来源元组，来源不同的“查不到原 tuple”不可当终结证据。`current_same_pid_backend_start` 只用于标记 PID 被替换，不产生任何管理动作。`pg_locks` 是当次锁观察，跨视图不是原子安全取消证明；本轮根本不发远端取消，不使用先查后 KILL。`pg_stat_activity` 在长事务可能持有旧统计快照，所以 monitor 必须 autocommit；轮询建议100ms一次，有限观察截止如3秒，记录 parent 的 monotonic elapsed，不能只靠墙钟相减。[统计快照说明](https://www.postgresql.org/docs/18/monitoring-stats.html)

| 观察 | 能登记的事实 |
| --- | --- |
| 原 tuple存在、state active／持锁 | 原会话仍存在；本地child退出不改变此事实 |
| 原 tuple存在、state idle、xact_start NULL、原表锁0 | 此刻不在事务／不持该锁；仍不是“会话已释放” |
| 相同来源成功查询，原tuple持续不存在，原pid锁0 | 已观察到原会话消失及该轮锁状态；记录首次／末次与间隔，不声称截止毫秒一到所有资源同步消失 |
| 来源变、权限缺失、字段异常NULL、监控超时／失败 | UNKNOWN；不替换目标、不发KILL、不自动重试原SQL |
| 观察期限到仍存在 | 未收尾／UNKNOWN，保留原证据；不能靠最终关闭整台fixture抹成及时终结 |

## 4. timer 与 portal 暂停的最小场景

PG18 文档将 statement timeout 绑定到语句／extended messages；transaction timeout 终止超时事务的会话，显式与单语句隐式事务都适用；若 transaction timeout 不大于 statement／idle事务timeout，较长限制会被忽略。因此分开单测，避免把错误归因给错误timer。[PG18 timeout 文档](https://www.postgresql.org/docs/18/runtime-config-client.html)

固定18.1 `postgres.c` 的 PortalSuspended 分支不关闭 statement timer；已启动 timer不重启。但读取完整前端消息期间会延迟 QueryCancel，事务timeout用独立FATAL分支。这只是源码推断，暂停后是否保留会话／锁必须实测，不能预写PASS。[18.1固定实现](https://github.com/postgres/postgres/blob/4b324845ba5d24682b9b3708a769f00d160afbd7/src/backend/tcop/postgres.c)

| ID | 设置与最小动作 | 必须取得的证据／可得结论 |
| --- | --- | --- |
| PG-L1 正常受限路径 | 用OS Agent核定的可启动AS额度启动worker，TLS、原身份、公开参数查询或短cursor read | launcher真实设置／child读回、正确有限结果、parent存活、同实例monitor；Node能启动不等于大字段受限已证明 |
| PG-L2 超大单值 | 在本轮合理上限内固定单字段大小，例如分阶1MiB／16MiB，`SELECT repeat('x',$1)`，cursor read(1)；严格受限child执行，不把payload传父进程 | 请求／实际字段字节、child返回或分配失败、进程状态与RSS／AS分别记录；普通字段检查只能解码后拒绝 |
| PG-L3 超限child与远端 | 超过已经核定的本地AS/CPU/FSIZE之一，记录真实退出；父仅用自持ChildProcess句柄回收本地worker | 原来源+tuple预先已交付；monitor连续记录至原会话消失或有限期限，未观察到即UNKNOWN；退出/Socket.close不能代远端终结 |
| PG-T1 活动语句 | 新session，statement_timeout=600ms，transaction_timeout=0，`SELECT pg_sleep(3)` | 客户端57014、原session保留/idle、事务与锁状态分别记录；语句报错不等于session消失 |
| PG-T2 statement-only portal暂停 | 合成表≥128行，statement_timeout=600ms、transaction_timeout=0、idle事务timeout=0；`new Cursor('SELECT n FROM synthetic.numbers ORDER BY n')`后read(1)，随后1800ms不read、不close、不Sync | 初批返回、目标AccessShareLock存在；monitor在约300／900／1800ms记录原tuple/state/ClientRead/锁。即使timer已到但仍持锁，也须原样保留，不能补一次read再声称无需客户端参与就释放 |
| PG-T3 transaction-only portal暂停 | 新session，statement_timeout=0、transaction_timeout=600ms、idle事务timeout=0；同样read(1)后无后续命令 | 客户端FATAL或连接错误单列，monitor同实例原tuple与锁消失才是远端观察；固定18.1预期是事务timeout会终止session，尚待本轮实证 |
| PG-T4 可修改参数反例 | 独立新session，只用公开SDK运行`SELECT set_config('statement_timeout','0',false),set_config('transaction_timeout','0',false)`，随后读current_setting并有限观察 | 合成readonly账号默认可否放宽timer；这是服务器／默认账号事实，不是当前产品SQL过滤器绕过。测试不可用来放开硬准入 |

PG-T2／T3选择普通真实合成表而不只用 `generate_series`，这样能同时观察 relation锁。每例都新建连接，先捕获参数与身份，timer开始前的身份SQL、连接／认证以及先前准备时间不被偷算成业务执行timer已经覆盖。主 Agent另固定Host总操作起点、剩余期限和有限清理观察期限；后者不是数据库保证的清理上限。

如果需要把“Parse／Bind阶段”另行拆开，只能追加**有限合成反例**：fixture管理员先在本轮表持独占锁，公开cursor submit发送Parse／Bind／Describe但不调用read，monitor确认锁等待；随后观察statement timeout。不能仅凭SDK方法返回、query文本或本地计时断言究竟某条wire消息已完成。此项不是本轮最低要求，不扩成MySQL测试或产品实现。

所有测试不自动重跑业务 SQL。允许的“后续动作”只有事前写明的一次正常清理（公开cursor.close／client.end）或父对其真实child句柄的停止；动作发生时点必须分列，不能把清理后的消失归因到timer。最终关闭本轮私有PG仅证明实验资源收尾，不补此前超时后的UNKNOWN。

## 5. 何时仍不能准入

PG原生timer都是 `PGC_USERSET`；角色默认／startup options是初值。`set_config` 是公开SQL函数。只读role、单语句、Host先SET、限制rowCount，都不能单独形成不可放宽的总预算。必须另外证明实际允许SQL／函数／事务控制不会关闭／放宽／跨事务重置必要限制；本轮探针不改parser、不加拦截、不改SDK。[18.1 GUC表](https://github.com/postgres/postgres/blob/4b324845ba5d24682b9b3708a769f00d160afbd7/src/backend/utils/misc/guc_tables.c)、[set_config公开合同](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SET)

即使PG-L1–L3、T1–T4都取得符合预期的有限证据，也只能证明该macOS／Node／额度／驱动／PG版本／本轮来源和合成输入的行为。尚未证明任意业务源、任意负载、同账号权限副作用、全操作墙钟预算、公共owner接线、完整UI、数据库独立核算或产品验收。AS是地址空间限额，不能写成RSS等同额度；CPU限额不是墙钟；FSIZE不是网络／pipe字节上限；OS Agent的结果与PG观察分别报告。

四原则核对：Host只绑定环境、身份、预算与实际资源收尾；Agent仍自主选SQL／参数／批次及分析；复用OS、PG和官方pg／pg-cursor，不改SDK／不造协议或代理；实验完成不增加逐SQL确认／人工分页等日常操作。

## 6. MySQL 的残留缺口（本轮不新增测试）

保留 `db_prepare_total_budget_unenforced`。当前缺的是同一次操作的 COM_STMT_PREPARE＋execute＋取结果累计墙钟边界、不可由允许SQL放宽、同一实际服务器与原会话所属、迟到／断线／ID再用后的安全停止，以及原命令／事务／连接的实际终结确认。

MySQL8.4原生 `max_execution_time` 只覆盖合格只读SELECT执行，正数hint可覆盖session默认；`lock_wait_timeout` 对每个metadata锁申请分别计时，多次可累计超过它。因此二者不能从配置值推断成prepare＋execute总截止。KILL返回不等待实际清理，不能把应答、本地destroy或child退出登记为远端终结。[MySQL变量](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html)、[MySQL KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html)

既有[远端研究](remote-deadline-research.md)的准确结论继续成立：ProxySQL3.0.12有prepare／execute命令级timer，但累计期限、后端会话代际与完成回执未闭合；MaxScale的现行商业版与旧公开版不能混用合同。不是断言所有代理都不可能，只是当前未找到完整可采用证据。本轮不引入代理、不启动MySQL、不采购、不把PG或本地限额结果外推为MySQL通过。


# macOS 原生限额：PostgreSQL 合成实测

2026-11-14，执行时间 UTC `06:49:17.736–06:49:32.222`（上海 `14:49:17–14:49:32`）。这是用户本轮授权的 **PG-only、私有临时数据库、官方SDK参考路径**，不通过产品driver开放查询。产品 `queryQualified=false` 保持；没有MySQL、容器、代理、真实业务、Provider、依赖升级或SDK改写。

## 结论

**本轮没有得到可采用的解码前内存硬边界。** AS512MiB设置被macOS拒绝，launcher在exec前以78退出，未启动Node／连接PG；未增加AS额度或加大负载。普通Node基线可以工作，单8MiB字段仍先完整解码，再被1MiB后验检查拒绝。

本地退出与远端终结确实是两件事：CPU超限SIGXCPU之后，原PG会话还活动约3秒；父对自己持有的child句柄SIGKILL之后，原会话还活动约4秒。均等同源只读监控观察原tuple消失后才记录远端事实，未发远端KILL／PID取消。

PG18.1的portal暂停也有实质差别：statement_timeout=600ms时，read(1)后不再发送消息，约1.89秒时原session仍存在并持有表读锁；transaction_timeout=600ms时，约630ms已观察原session消失、锁为0。这是固定版本与路径的有限实测，不能证明参数不可被业务SQL修改，也不能补成本轮硬准入已通过。

## 固定环境、输入与证据

| 项目 | 实际值 |
| --- | --- |
| 系统 | Darwin25.3.0／arm64 |
| Node | `v25.9.0`，真实文件 `/opt/homebrew/Cellar/node/25.9.0_3/bin/node`；Homebrew发行二进制，未声称nodejs.org预构建包 |
| Node SHA256 | `fba87e4402c55ea4fc7ca9b9838790c32534e3e77c9c7834c37073752d070678` |
| 驱动 | 现有 `pg8.23.1`／`pg-cursor2.22.1`；仅公开Client／Cursor API |
| PG | 复用既有私有源码编译PG18.1，运行时 `server_version_num=180001` |
| PG binary SHA256 | `1e733e9107af5f2b08329a8038ff9764811f9bb14fac637d06356d869f44264f` |
| 唯一本轮服务 | 本轮ChildProcess pid99031；fresh data directory `run-tB8FNg/data`；loopback端口62151 |
| 同源绑定 | system_identifier=`7707915631947928275`，postmaster_start=`2026-11-14 06:49:18.135906+00`，`127.0.0.1/32:62151`／`oc_native` |
| TLS | 新CA／SAN `DNS:localhost`，Client host=`localhost`，`rejectUnauthorized:true` |
| 数据与权限 | 合成 `synthetic.numbers`128行；专用 `oc_reader`；不授写／CREATE／TEMP；默认只读事务；仅补 `pg_control_system()`读取资格 |
| 独立连接 | monitor和owner-B均同role独立TLS连接；monitor autocommit且只执行SELECT；B pid99046 |
| 子进程环境 | runner以`env -i`启动；worker仅PATH／LANG／TZ白名单；合成凭据经真实父持有stdin，未落配置文件／回显；私有data根700、证书私钥600 |
| 子进程预算 | 每worker父deadline9秒；仅真实ChildProcess句柄kill；stdout128KiB上限、stderr64KiB上限；本轮实际stdout最大1414bytes、stderr最大830字符，无watchdog／输出超限 |

执行前已固定runner、worker、launcher、Node、PG、依赖文件的路径／hash和环境；全部写在[`pre-run-provenance.json`](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/pg-probes/pre-run-provenance.json)。私有脚本为[run.mjs](/Users/bendandebaba/.codex/worktrees/48da/OptraCall/.local/db-link/native-process-limits/pg-probes/run.mjs)、[worker.mjs](/Users/bendandebaba/.codex/worktrees/48da/OptraCall/.local/db-link/native-process-limits/pg-probes/worker.mjs)；执行后未修改或重新跑它们。

原始[`results.json`](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/pg-probes/results.json)保留全部事件、stderr、退出、轮询、首末时间和原FAIL，SHA256=`eeb95738290285299d996782c68e2640e55af139e2e43f54cf177a444073dab3`。只从原件推导的[`post-run-audit.json`](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/pg-probes/post-run-audit.json)另存，不回写原结果。PG日志为[`postgres.log`](/Users/bendandebaba/.codex/worktrees/48da/OptraCall/.local/db-link/native-process-limits/pg-probes/run-tB8FNg/postgres.log)。

## 逐项结果

| 用例 | 原始状态 | 实际观察与边界 |
| --- | --- | --- |
| 1 无AS正常基线 | PASS | TLS连接、公开参数查询保留numeric `9007199254740993.123456789012`与bigint `9007199254740993`；cursor按2、1、0行返回数组，关闭后原tuple消失。未设置AS，不能算内存隔离通过 |
| 2 AS512MiB拒exec | PASS（拒派行为） | `setrlimit(RLIMIT_AS)=-1,errno22(EINVAL)`；读回仍无限，match=false；exit78，stdout0、无pre-exec／worker事件。唯一application_name前后连接数均0；没有exec即没有此worker发SQL。AS能力仍失败，不能将拒派PASS写成AS已可用 |
| 3 单8MiB后验拒绝 | PASS（反例事实） | 官方cursor交付1个string，完整解码8,388,608bytes，之后才比较1,048,576bytes并拒绝；不落complete文件、不把payload回父。该点RSS101,466,112bytes／external44,220,579bytes，是一个时点而非峰值／硬上限 |
| 4 statement超时 | PASS | `BEGIN READ ONLY`后`pg_sleep(3)`在约601.54ms收到57014；随后显式ROLLBACK完成、client.end，再由monitor观察原tuple消失。未把超时错误等同session释放 |
| 5 CPU1秒退出 | **FAIL保留** | launcher成功设置／读回CPU软硬限额1秒；monitor先见原SQL active/PgSleep，父再经child.stdin触发burn；约904.34ms后本地SIGXCPU退出，原会话仍active。原FAIL来自探针把预期信号误写为SIGKILL，见下节；没有重跑或覆盖原件 |
| 6 父显式停止 | PASS | monitor先见原SQL active/PgSleep，父只对原ChildProcess句柄发送SIGKILL；约1.06ms本地退出，随后仍观察原PG session active，约4.03秒后首次查不到原tuple |
| 7a statement600ms portal暂停 | OBSERVED | read(1)后无后续read/close/Sync；1886.64ms时原tuple仍active／ClientRead、原表AccessShareLock1个；约1889.92ms才发release清理。提前收尾未成立，不能把清理后消失归因于无人参与的timer收尾 |
| 7b transaction600ms portal暂停 | OBSERVED | read(1)后无后续客户端动作；约600.37ms cursor收到25P04；约630.09ms monitor首次见原tuple消失、锁0。约1879.96ms才发release，此前的消失与显式cleanup区分开 |

没有构造超过8MiB的字段或额外大内存触碰；没有靠扩大AS／业务负载继续试错。FSIZE不是本PG子矩阵的测试项，由OS分工分别报告，不能从此表推定磁盘／网络／管道总量受限。

## 原身份与计时：本地退出之后发生了什么

所有成功monitor记录均核对相同systemid、postmaster_start、端点和database；目标从业务SQL前捕获的PID＋`backend_start`精确匹配。timestamp保持原text微秒，未经JS Date。`application_name`只作辅助，不是取消权威。monitor没有跟随新PID或发任何KILL；计时采用同一个父进程monotonic clock，约100ms采样，以下是观察区间，不是精确服务端终结时刻。

| 用例 | 原远端tuple | 本地exit后末次仍存在 | 本地exit后首次不存在 | B连接 |
| --- | --- | --- | --- | --- |
| CPU退出 | pid99060，start `06:49:19.610553+00` | 2994.30ms，active/PgSleep | 3099.19ms，随后再隔约100ms确认 | 前／退出后／原远端消失后均SELECT1成功、同pid99046 |
| 显式kill | pid99079，start `06:49:23.844697+00` | 3931.73ms，active/PgSleep | 4034.08ms，随后再隔约100ms确认 | 同上 |

这两例的远端原SQL是`SELECT pg_sleep(4)`，statement_timeout7秒、transaction_timeout8秒；因此观察到约4秒查询期间继续活动符合输入条件，不能说本地限额或kill主动把原SQL立刻取消了。观察到远端原session后来消失是真实事实，也不外推为所有查询总能在4秒内清理。

portal的原tuple分别为statement组pid99168／start`06:49:28.079662+00`、transaction组pid99194／start`06:49:30.18966+00`。statement组PG日志到`06:49:29.984`（父release之后）才记录statement timeout ERROR；transaction组在`06:49:30.802`记录transaction timeout FATAL，早于release。原始客户端事件、纯SELECT观察与服务器日志相互印证；未读取或修改driver内部portal状态。

## CPU断言的原始FAIL与解释更正

runner第93行对CPU和显式kill共用了`signal==='SIGKILL'`断言，这是本探针作者的预期错误。真实CPU退出为SIGXCPU，未触发9秒watchdog；launcher的CPU设置／读回、burn开始、原session退出后仍活动、最终消失和B连接证据已在断言前收集。

原`status:FAIL`、错误`expected_local_signal_missing_or_watchdog`和原脚本hash全部保留，不把它重写成PASS，也没有为改断言重新发SQL。更正的是解释：它是过窄探针断言失败，不是PG监控失联或本轮CPU设置失败。CPU信号可捕获性／硬限额适用范围由OS独立探针报告；此例只证明本worker未装处理器时的退出事实，不能推广成不可绕过的墙钟或内存限制。

## 收尾与仍未证明的事项

全部8个worker均已收到真实exit／close，monitor与B连接已正常end；无watchdog、无stdout预算触发、无按缓存PID发信号。唯一私有PG由原句柄SIGINT fast shutdown正常exit0，端口62151已经关闭；PG日志`06:49:32.221`确认database system shut down。各用例远端tuple的消失均在最终PG stop之前观察，不用关闭整台fixture补此前终结。私有脚本、数据目录、日志及失败保留作证据，未删除或覆盖。

本轮没有运行原计划中的TLS不信任CA／错误hostname负例、PG参数set_config绕过反例或Parse阶段独立锁等待；这些在本结果是NOT_RUN，不能借旧成绩当本轮通过。PG的`PGC_USERSET`／set_config可修改性仍按[只读官方研究与计划](native-process-limits-pg-plan.md)保留，需要对实际允许SQL、函数和事务控制另证，不能从本次timer正常触发推断不可绕过。

当前继续不准入：AS不可用；8MiB反例仍证明后验拒绝不能覆盖解码前分配；CPU／FSIZE都不等于内存或总墙钟；本地退出不确认远端终结；statement-only暂停未及时释放。transaction_timeout的有限正面结果不补同账号副作用权限、不可放宽总预算、公共owner接线、完整UI／数据库独立核算或真实业务／产品验收。

MySQL保留原`db_prepare_total_budget_unenforced`，缺prepare＋execute累计期限、不可放宽条件、同实例／会话代际、安全停止与实际终结证据；本轮没有启动MySQL或引入代理，PG结果不外推给它。四原则仍成立：Host只管环境与真实收尾，Agent仍自主选SQL；复用OS／PG／公开SDK，不改三方包、不造通用平台，也不增加用户逐SQL确认或人工分页。

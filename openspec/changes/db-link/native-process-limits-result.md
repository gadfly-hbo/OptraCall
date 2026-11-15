# macOS原生进程限额／PostgreSQL：交确认结果

2026-11-14（Asia/Shanghai）。已按用户要求完成隔离合成验证；后续数据库测试以PostgreSQL为主。**当前原生进程限额方案不足以解除db-link的接收内存硬准入，查询继续拒派。** 本轮没有引入容器/代理，没有修改产品代码、SDK、依赖版本或正式服务。

## 实测结论

| 问题 | 实际证据 | 可采用的结论 |
| --- | --- | --- |
| 能否在解码前建立适用内存限额 | 原生launcher请求AS512MiB/1GiB/4GiB均EINVAL，get仍无限，exec前exit78；PG场景AS512MiB无Node/连接/SQL | 本机这些预算下AS未建立；拒派正确，有限AS内的分配/驱动接收仍NOT_RUN，不是内存保护成功 |
| CPU/文件能否补内存缺口 | 默认CPU1秒触发SIGXCPU；非作者反例忽略信号、实际CPU约1.216秒仍exit0；FSIZE16KiB阻断单文件，但独立反例两个文件合计32KiB仍成功 | CPU信号和单文件限额只解决局部问题；不能当不可绕过CPU强杀、总IO或进程总内存保证 |
| 官方驱动是否会先解码超大值 | PG8MiB单值先完整交付string，再按1MiB后验拒绝；只回传身份/计数，不把payload回灌parent或发布complete | 后验单值/落盘限额不能保护此前分配；本轮未得到可采用的解码前内存硬边界 |
| 本地子进程退出是否就是远端结束 | CPU默认退出、父显式kill后，原PG会话仍active；约3.10/4.03秒后才首次观察原tuple消失；独立B连接持续可用 | 必须分别等待本地exit/close和同实例原session/事务/锁的真实收尾；本地结束不能释放全部远端UNKNOWN占用 |
| PG暂停取数时哪项timer有作用 | PG18.1/cursor2.22.1 read(1)后不再发消息：statement600ms组约1.89秒仍有原会话及表读锁；transaction600ms组约630ms原session消失/锁0 | transaction timeout有局部正面证据；statement timeout不能单凭配置就宣称暂停时已收尾。参数不可放宽、全部协议阶段/产品接线仍未证明 |

AS与RSS/physical footprint分别保留。原生C在exec前已见约415GiB虚拟映射，RSS约1MiB；Node无AS基线RSS约45MiB。不能把虚拟量当物理消耗，也不能把AS失败唯一归因于V8。当前XNU精确源码身份未取得，邻版本实现只作解释线索，实机set/get和退出是本轮结论依据。

本轮环境：macOS26.3.1(a)/Darwin25.3.0 ARM64、16GiB；现有Homebrew Node25.9.0、既有私有PG18.1、官方原包pg8.23.1/pg-cursor2.22.1。不升级Node/PG/Pi/Semantica，不改驱动。Node是实际Homebrew发行路径与hash，未声称nodejs.org官方预构建包完整性。11个既有官方运行包的2824归档成员与安装字节重核一致；Semantica本轮不使用、不改动，未重做其wheel闭包验收。

## 原始失败、未验证与收尾

OS19案收据全部保留。PG八个worker覆盖七类场景，其中portal有两组；原CPU场景因探针误将预期退出信号写成SIGKILL而保留FAIL，实际为SIGXCPU。未改原脚本/JSON或重发SQL换成绩；依据原launcher/worker/monitor/服务器日志分别解释观察事实，不宣称“全部测试全绿”。非作者独立探针的首次SyntaxError没有运行child，setup失败也单列保留。

PG唯一实例只监听127.0.0.1临时端口62151，用新CA/localhost证书及合成只读角色；monitor以autocommit纯SELECT核system_identifier、postmaster_start、endpoint/database及原pid/backend_start。所有远端原tuple的消失在最终fixture停止之前观察，不用整库关闭补此前收尾。全部OS child和8个PG worker已观察退出；PG由原ChildProcess句柄SIGINT正常exit0，端口已关闭，数据/日志原件保留。

有限AS保护下的正常驱动/超限分配、全设备/子孙进程域/睡眠恢复的强制边界、不可修改PG预算、参数绕过与独立Parse锁等待、完整产品owner/cleanup/retryCleanup接线、业务数据/真实模型/用户产品验收均未完成或NOT_RUN。无AS正常路径只是SDK reference，不提升当前产品资格，也没有以普通子进程隔离代替硬内存限制。

## MySQL还缺什么

本轮及后续实验按用户选择使用PostgreSQL，不启动MySQL。MySQL历史结果/实现保留，它仍缺：prepare和execute共享且不可被业务SQL放宽的累计远端期限；同实例/原会话代际下安全所属取消；原命令、事务与控制资源实际终结的证据。CPU/FSIZE/子进程kill都不补这些条件，PG的transaction_timeout结果也不能外推。详见[既有远端研究](remote-deadline-research.md)。

## 四原则与确认边界

| 原则 | 本轮核对 |
| --- | --- |
| Host管环境 | 限额只作用于自有child；设置失败exec前拒派；凭据仅合成stdin、结果通道有界；本地/远端事实分开；无按系统搜索PID盲停 |
| Agent自主执行 | 本轮为能力探针，不把固定技术场景写成产品分析流程；不由Host改业务SQL、补算或自动重放 |
| 优先复用官方能力 | OS公开set/getrlimit、原pg/cursor公开API及现有Node/clang；私有小工具仅作测量，不改三方包、不新增Runtime/通用执行平台 |
| 减少人操作 | 无逐SQL确认/人工分页/手工导出；验证自动完成并保留原失败，必要准入不因减少操作而放宽 |

本次交确认的是“原生限额适用性及PG局部收尾事实”。建议保留当前硬准入；**本机原生AS方案本轮不采用为接收内存边界。** 不自动改选容器/代理或启动新方案，不将本轮结论当完整db-link开发交付。

## 证据

- [验证计划与清单](native-process-limits-validation.md)、[OS作者结果](native-process-limits-os-results.md)、[PG计划](native-process-limits-pg-plan.md)、[PG作者结果](native-process-limits-pg-results.md)。
- [本轮证据根](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/)、[OS索引](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/os-probes/evidence-index.json)、[PG原始结果](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/pg-probes/results.json)、[PG执行后核对](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/pg-probes/post-run-audit.json)。
- [SDK归档成员核对](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/sdk-integrity.json)。原65件部分候选及全部批准输入的保全另见before/after收据；本轮不重跑产品全量检查或将原PASS扩大为新能力。
- 非作者结论以[本轮独立报告](/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/independent/review.md)及其固定候选/证据身份为准；本作者结果不代替独立复核或用户确认。

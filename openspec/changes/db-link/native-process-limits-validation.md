# macOS原生进程限额／PostgreSQL隔离验证

2026-11-14（Asia/Shanghai）。用户授权本轮验证原生进程限额、保持硬准入，不引入容器或代理，并明确后续按PostgreSQL测试；MySQL本轮只保留远端预算缺口说明，不启动MySQL引擎。当前部分候选、WIP、FAIL/UNKNOWN、已批准SDK/驱动与数据不覆盖。后续用户确认之前不将实验接入产品或开放查询。

## 范围与固定依据

复用已存在私有PostgreSQL18.1及官方原包pg8.23.1/pg-cursor2.22.1，沿实际现有Node25.9.0和macOS26.3.1 ARM64。Node实际Homebrew路径/字节单独固定，不称已核验nodejs.org二进制。Interface v3、Pi1.4.0、Semantica、原owner/operation公共生命周期均不改。本轮只做OS/SDK reference可行性实验，不创建新Agent Runtime/资源台账或产品调度，不修改驱动准入。

实验文件仅在`.local/db-link/native-process-limits/`；证据根为`/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/`。`before.json`固定用户指令、HEAD/branch/WIP、既有65件候选摘要及Node身份。仅设置所持有新子进程的限额；不用全局launchctl，不安装服务/组件，不访问业务库/真实Provider或其他设备，不Git交付。

## 目标执行清单

| 阶段 | 必须核实 | 状态 |
| --- | --- | --- |
| N01 保全与计划 | 原65件候选/批准输入、Node/OS/引擎身份、范围和负载边界 | 已核原65件候选无漂移，HEAD/branch与实际Node/OS身份已固定 |
| N02 OS进程边界 | AS/CPU/单文件限额set/get、exec继承、设置失败先拒执行、退出/信号与父进程存活 | 19案已完成：AS512MiB/1GiB/4GiB均EINVAL且preexec拒派；CPU信号可忽略、FSIZE仅单文件，等待最终非作者复核 |
| N03 PostgreSQL正常路径 | 仅本轮私有PG实例、TLS/参数/精度、实际限额下正常驱动接收 | 已完成PG18.1正常reference/AS拒派/8MiB后验拒，正常路径不含可用AS保护 |
| N04 超限与远端收尾 | 有界大字段/Buffer/字符串，子进程超限或被停止；同实例原session终态、锁/事务、无晚到发布与无自动重放 | 已有独立本地/远端观察，CPU原误断言FAIL保留；不宣称产品cleanup已接 |
| N05 边界与四原则 | AS与RSS、CPU/墙钟、单文件/总IO分别核；PG与MySQL预算不混淆；不合格保持拒派 | 已汇总，原生AS方案不能解除内存准入；PG为后续测试主线 |
| N06 非作者复核与交确认 | 固定探针/输入/证据，独立复验关键失败及收尾；不把可行性当产品验收 | 已提交冻结候选；独立结论见外部报告，用户确认待完成 |

## 实验约束与判据

- 串行有界负载；单个OS探针实际触碰内存不超过128MiB，PG合成字段不超过32MiB，暂不做整机OOM/最大吞吐实验。虚拟地址映射与RSS分别记录；限制不生效时不追加放大负载。
- 原生launcher仅在自有exec子进程调用公开setrlimit/getrlimit；限额失败不得继续执行。parent仅用本次ChildProcess句柄停止，逐案有限截止并等待exit/close，不按系统搜索的PID盲杀。
- 仅启动私有PG18.1，loopback临时端口，合成只读角色、新TLS证书；不调用会启动双引擎的既有startNativeFixtures。保留所有启动和退出收据。
- 正常/超限/停止分别记录：限额设置、驱动连接、原查询身份、命令派发、已接收/输出字节、子进程实际退出、远端原session状态、事务/锁及最终fixture停止。子进程退出不等于远端查询结束；只读monitor必须绑定system_identifier和pid/backend_start，不发KILL或重放SQL。
- 若AS无法阻止分配、实际Node无法在适用额度运行，或任一分配路径未证，就保持“不足以解除接收内存硬准入”；CPU/单文件局部通过不得替代总内存/远端墙钟。结果中保留PASS/FAIL/UNKNOWN/NOT_RUN而不修饰为全绿。
- PostgreSQL timer/portal实测只对应本轮精确组合；本轮不改首批既有代码或删除MySQL能力定义。MySQL prepare+execute累计期限及安全所属终结仍须独立证明。

## 四原则预检

Host管理环境、实际身份/权限、限额与资源事实；Agent的SQL/分析方法不被固定流水线替代。复用OS公开接口和原SDK，不改三方包/协议；隔离仅为原operation未来候选资源域，不引入并行Runtime。正常路径仍配置一次后自动治理，无逐查询人工批准/分页；未知收尾不能靠放松门槛或额外人工步骤掩盖。

## 首批OS观察（待独立复核）

RLIMIT_AS的512MiB、1GiB、4GiB请求均返回EINVAL且实际值保持无限；launcher以78退出、没有exec/child stdout。原生C同样失败。它们是本机目标预算下不可用的证据，不是“内存超限已被成功阻止”。Node无AS正常分配只作reference；不通过放大AS或修改Node参数寻找名义成功。CPU1秒触发SIGXCPU，单文件16KiB触发SIGXFSZ/EFBIG，不能代替接收内存/远端墙钟。全部18案已观察退出；详见OS作者结果和原始收据。

## CPU/文件范围反例补充

第19案保留原18案不改：忽略SIGXCPU后由parent于1.5秒墙钟截止杀死并wait；未量此案实际CPU，不据墙钟推算CPU。非作者另有独立有界反例实际累计CPU超过1秒仍自行退出，说明默认SIGXCPU退出不能宣传为不可绕过强杀；单文件限额也不能当目录/总IO预算。最终以固定独立报告和收据核定。

# db-link 资源隔离评估与建议

2026-11-14。用户已选择“保留硬准入，先评估成熟的资源隔离方案”。本轮评估完成，不改变已批合同，不选定或安装新组件，不开放当前数据库查询。完整证据见[本地隔离研究](resource-isolation-research.md)与[远端期限研究](remote-deadline-research.md)。

## 结论

本地接收内存与远端查询总期限是两个资源域。**当前没有一项已评估组件，可以单独补齐两项并直接放开MySQL/PostgreSQL。** 本地内存有成熟机制可验证；普通MySQL业务库的prepare＋execute总期限、所属安全和远端终结确认仍未取得完整证据。保留queryQualified=false，不能靠容器退出、断连接或KILL应答登记完成。

| 评估对象 | 能提供什么 | 当前建议 |
| --- | --- | --- |
| Node Worker／单独子进程 | Worker只限制部分JS引擎资源，明确不覆盖ArrayBuffer；普通spawn本身没有总内存限额 | 不能单独作为内存硬边界；不因进程分离就准入。[Node官方合同](https://nodejs.org/download/release/v25.9.0/docs/api/worker_threads.html#new-workerfilename-options) |
| macOS原生进程限额 | 官方XNU有RLIMIT_AS地址空间限制路径；实际Node可用额度、V8保留地址、目标内核/分配失败行为尚未实证 | 优先做很小的可行性验证，无需新增常驻组件；AS不是RSS，验证失败就停止此路径，不拼自研内存管理器 |
| Apple container | Apple silicon/macOS26+，每容器独立Linux VM，可配置guest内存/CPU | 与已知Mac mini前提匹配，可作为原生限额不适用后的首个比较候选；还须计Host/helper开销、并发总量和结果通道。未核MacBook条件。[官方说明](https://github.com/apple/container)、[资源合同](https://github.com/apple/container/blob/main/docs/resource-usage.md) |
| Docker Engine/cgroup | 明确的工作负载内存限制/OOM和CPU配额；macOS需Linux VM运行环境 | 作为对照/部署备选；Desktop与Colima/Lima是不同部署选择，不同时引入。许可、首次环境配置、guest/Host范围按实际发行核对。[官方限制](https://docs.docker.com/engine/containers/resource_constraints/) |
| MySQL原生参数/ProxySQL/MaxScale | 原生SELECT执行和逐次metadata锁限制；ProxySQL固定源码确有prepare超时，但命令重新计时且取消/确认不足；MaxScale版本/许可和MySQL适用证据不同 | 暂不为本门槛引入代理。未找到可直接满足总期限与所属收尾的完整合同，不是断言所有产品都不可能。[MySQL官方变量](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html)、[详细固定源码分析](remote-deadline-research.md#4-proxysql确实覆盖prepare但仍未闭合总期限与安全确认) |

## 建议的下一步验证范围

先固定一个小范围可行性验证计划，使用本机现有macOS/Node和已批准驱动，只在临时子进程和隔离合成资料中核对原生限额设置成功、正常启动、TLS/驱动分配、超大Buffer/字符串、超限退出及父Host存活；明确AS、驻留内存和实际失败方式。原生能力无法形成适用边界，就结束该候选，再选择一种官方VM/容器发行物及精确版本进行同样证明，不同时安装多套环境。**本轮未执行这些新实验，也未选择/安装容器、代理或镜像。**

MySQL远端问题并行保留为独立关卡。只有拿到可审查的固定部署合同，才验证COM_STMT_PREPARE、多个锁依次等待、execute、控制故障、原会话消失/身份更替及所有收尾；否则继续不可用。PostgreSQL原生timer/portal条件可单独证明，不将其结果外推给MySQL，也不擅自改变首批两库的产品范围。

## 四原则复核

| 原则 | 本方案边界 |
| --- | --- |
| Host管环境 | 预算、凭据、TLS、真实来源/owner、隔离启动、有限结果通道及所属收尾归Host；本地/远端事实分别核定 |
| Agent自主执行 | 继续自主发现授权资料、选SQL/参数/批次、说明口径与结论；超限明确失败/partial，不由Host改SQL、补算或自动重跑 |
| 优先复用官方能力 | 官方驱动/Pi/原owner公共生命周期不变；比较现有OS/官方VM或容器能力，不改SDK、不自建wire协议/通用作业平台 |
| 减少人操作 | 环境/权限首次配置后，Host自动管理所属资源；不增加逐查询确认/人工分页，来源不合格时给具体原因 |

这是评估建议与待验证范围，不是新增实现授权、组件采用或完整工程/产品验收。原WIP、失败、UNKNOWN、有限候选19项与最终拒派11项证据保留。现有接缝修复检查单独记录；新数据库独立核算、完整UI流程和后续运行采用仍未完成。

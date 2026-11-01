# 实施中发现的执行兼容问题与修正

2026-11-01。本页记录已授权实施中的必要兼容修正，不新增业务持久结构、工具、分析步骤或公共 Interface。性能结果另证，旧失败不覆盖。

## 候选 1 的检查失败保留

候选 1 的最终完整检查为 744 项：741 PASS、2 FAIL、1 平台不适用。两项失败都实际收到空 shell 输出，而非预期的短输出／后台 PID。此前另一检查时点的 742 项通过，不能代替这次失败。

已开始的候选 1 留驻在正确性 gate 失败后主动取消，实际纯空闲观察约 375.8 秒，不是完整一小时。首次公共 stop 返回 `protected_cleanup_unknown`；原生记录存在 cancelled／closed、相关执行进程已消失，这些事实与公开停止失败分别保留。随后按精确测试身份通过隔离 Host 关闭收尾，控制器、time wrapper、采样器及产品／后台进程均已退出。

证据位于 `.local/managed-execution-optimization/benchmark/hour-resident-01/hour-resident-newmanaged/`，含首次 stop、实际业务 UNKNOWN、原生关闭字节及最终外部取消回执。候选 1 快照、原计划与所有失败保留；当时 27 次主性能试验尚未运行。后续改用新候选与新冻结计划，不在旧结果上补写成功。

## shell 退出与输出完整是两件事

原受限 BashOperations 在 `child.exit` 立即销毁 stdout/stderr。真实管道调度探针证明，进程已经退出时仍可能有已写入但尚未交给 JavaScript 的字节；单次 nextTick、setImmediate 或仅耗尽 JS buffer 均可能漏末尾。等待管道 EOF 又会等继承该管道的后台作业，不能用于保留跨工具后台的合同。

修正仍走原 SDK 公开 BashOperations，保留 `/bin/bash -c command`、argv、PPID、受限组、timeout／abort 和 SDK 结果／截断格式，不使用 shell wrapper、结束标记或新的计算工具：

1. 在可信 scope TMPDIR 中以 O_EXCL、0600 创建普通输出文件，并在 spawn 前立即 unlink；没有每调用留下的可见输出路径。
2. 将同一公开 FileHandle 复制到子进程 stdout/stderr；只传这些标准描述符，不把 guardian 控制或 native／凭据句柄交给子进程。
3. 以 20ms、最多一个在途分块 pread 观察输出，不创建积累的观察队列。前台退出后停止观察，读完当时核定的文件长度，再关闭父 FD 返回；不等后台 EOF。
4. 已完成调用释放 FD／timer／读对象；仍在后台的子进程可继续持有自己的匿名输出 FD，由原 scope 归属和停止机制管理。其匿名 inode／字节可随实际后台输出增长，不能宣称磁盘用量恒定。

**可观察环境差异：stdout/stderr 从管道变为匿名普通文件。** 程序可通过 fstat、seek/truncate 或缓冲行为观察差异，不能称全部 shell 环境逐项等价。没有新增任意文件权限，也没有把临时输出变成企业资料／经营数据集备份。大规模 stdout 的页缓存／磁盘成本不由进程 footprint 合计完整代表，需与实际数据规模分别说明。

根因诊断、调度 RED、7 项永久回归及实际 Seatbelt 兼容证据见 `.local/managed-execution-optimization/stdout-diagnosis/` 和 `stdout-fix/`。自然短输出的多次诊断未能稳定复现原并发失败，这一限制与确定性的真实管道截断 RED 分开记录。

## 清理完成与关闭回执已交付也是两件事

真实原生 read 的大图片会使 SDK 的正常 snapshot／prompt 回复在 IPC 上积压。停止时旧 private SDK 分支在 `process.send(close ACK)` 后立即 disconnect，实测 direct 与 HTTP 均可能丢失尚在队列里的关闭 ACK，即使 native 已写 closed，Host 仍正确保留 UNKNOWN。

修复仅要求 private SDK 的关闭 ACK 等待 `process.send` 回调确认写出，再断开连接。不修改父进程 exit／fail 处理，不重发工具／模型，不用 JSONL 或 OS 消失代替 ACK。回调失败仍保持未知。大图 direct／HTTP 以及仅测试端阻塞 IPC 消费的对照已验证真实收到 ACK 后再 disconnect／exit；证据见 `.local/managed-execution-optimization/stop-diagnosis/`。

这两处属于工具执行与资源回执的环境职责。Host 没有新增公式、补计算、指定 Agent 方法或按专业意见决定下一步；原件保护、公共 owner/lease、自然等待、显式停止与失败清理重试边界保持。

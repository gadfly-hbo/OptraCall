# 测试记录器与并行内存：补充验证结果

2026-11-01。状态：**LOCAL_COMPLETE_WITH_SCOPE；新 1000 次完整验证通过、并行内存主因已验证，非作者独立复核 RM01–RM05 为 PASS_WITH_SCOPE，无未解决阻断发现**。对应[补充规格 RM01–RM05](recorder-memory-followup-spec.md)。本轮只修复本地测试设施并新增隔离实验，没有修改产品源码、原资料或历史结果，没有 Git/CI 交付或切换运行服务。

## 大白话要点

日志现在边收到边写，不再等结束后把全过程拼成一个超大字符串。新跑的 1000 次既完成了执行，也保存了全过程日志；原来失败的那次继续保留失败状态。

并行内存增加主要来自取舍：为了避免每次读文件都重新初始化，同一任务内保留了一套文件执行进程。它本身约占 117–119 MiB；只有 8 次读取时，省下约 66 MiB 的守护进程不足以抵消它，所以峰值仍上升。任务结束后该进程正常退出。本轮没有通过限制 Agent 工具、并行或计算来降低内存，也没有实施新的产品内存优化。

## 记录器修复及完整 1000 次

新增测试记录器以异步生成器顺序消费真实 HTTP SSE，原始传输块与逐事件 JSONL 分别流式保存，处理背压并在结束前等待完成及 fsync。不保留全过程事件数组；解析、写入、drain 或最终同步失败均阻断整例成功。

| 验收项 | 实际结果 |
| --- | --- |
| 原故障 RED | 精确执行冻结 03 runner 的批量 `map/join` 写入语句，8300 个事件实际复现 `RangeError: Invalid string length`，原 RED 回执保留。 |
| 超限真实 HTTP 回归 | 8300 个事件，JSONL 565,014,064 字节、raw 564,398,913 字节，均超过旧单字符串上限 536,870,888；内容／顺序／hash 一致，writer 最大 68,075 字节，8300 次实际背压。 |
| 错误与边界 | UTF-8 跨字节分片、CRLF、解析失败、残帧、既有文件拒绝、写入错误、最终 fsync 失败、完整帧后主动停止及双文件同步均有回归。 |
| 新正式调用 | 在新合成项目／新任务只运行一次；真实 Host／Pi SDK 完成 1000 个唯一 read 调用；SSE 与 native 逐 ID、工具名、无错误及 marker 全文匹配。 |
| Provider 与压缩 | 1001 次正常请求＋693 次摘要请求＝1694 次 HTTP200；SSE／native 实际压缩各 693 次。沿用原 Provider 协议、1000 负载和 SDK 压缩设置；没有禁用压缩或减少工具。 |
| 完整新日志 | 7090 个事件，JSONL **621,514,615 字节**、raw **620,965,349 字节**；逐帧事件与顺序一致，SHA-256 对应实际落盘，0 残帧；writer 最大 357,554 字节、1958 次背压。 |
| 积累检查点 | 60／300／1000 次之后各 25 个样本，均为同一组 4 个产品 PID/start 身份：Host、SDK、guardian、文件 worker，0 僵尸。不能据此称 heap 恒定或无任何内存泄漏。 |
| 终态及收尾 | task completed；native scope closed 在停止观察之前；Host shutdown code 0；末次 closed 采样为 0；后续精确查询 11 个已知 PID 无进程行。 |

SSE 的完整性范围明确为 **dispatch 前就绪，持续至匹配 request 的唯一 `run.settled completed` 加 post-idle**：2026-11-01T11:34:02.805Z 就绪，11:35:24.264Z 按计划主动停止，11:35:24.279Z 双文件同步完成，之后独立关闭 Host。不声称覆盖 Host 退出后的 SSE。清洁提前 EOF、没有匹配 settled、残帧或写入错误不能只凭 `COMPLETE_SYNCED` 判成功。

主请求本次实际为 76.451 秒，仅描述本次技术运行，不把双份日志采集后的时间代入原主性能对照。[作者完整记录](../../../.local/managed-execution-optimization/benchmark/followup04-author-result.md)、[实际完整回执](../../../.local/managed-execution-optimization/benchmark/followup-results-04/file-staircase-streamed-04/receipt.json)、[新原始输入及结果清单](../../../.local/managed-execution-optimization/benchmark/followup04-raw-fixed-manifest.json)。清单 908 项／2,416,360,875 字节，SHA-256 `8b610e071db894a26b6603cf18350b2e8e8e6bae88a98391d9f9772c0a46f29c`。

## 并行内存增加的原因

原主实验 old/new 托管各 3 例已按同一采样时点的实际 PID/start/role 重新拆分，峰中位仍为 **588.158→652.872 MiB**，原结果不变。全部峰都在最后一个 wait bash 等待后台工作时；常驻文件 worker 与独立 bash 执行器同时存在。新增文件 worker 约 118–119 MiB，guardian 从 10 个降为 3 个、节省约 66 MiB，因此固定结构净增加约 52–53 MiB。其余差额定位到 SDK、Host 和另外的执行器等进程页；没有测量其具体 heap 对象、GC 或分配器原因，不冒称全部余量已精确归因。

新诊断固定 8 例：old/new × 原 8-read／具名 0-read 诊断变体 × 2 次。只在测试负载中去掉 8 次读取以辨别来源，产品能力和 Agent 策略不改；每例均保留相同四路后台计算、每路 38,149,748 次迭代及原等待动作。8 例全部 completed，48 个实际原生工具结果及计算摘要逐项一致。

| 诊断负载 | 第 1 对 old→new 峰 MiB | 第 2 对 old→new 峰 MiB | 观察 |
| --- | ---: | ---: | --- |
| 原 8 次 read | 584.861→647.700（+62.838） | 596.987→651.481（+54.494） | 新增 worker 117.684／117.153 MiB，guardian 节省 66.034／65.940 MiB，是主要贡献。 |
| 0 次 read 诊断变体 | 509.843→505.936（−3.907） | 504.701→507.264（+2.563） | 两候选均无文件 worker，新旧峰差收敛；支持读取路径组合为主要来源。 |

0-read 对照改变的不仅是 worker 本体，也包括 guardian、SDK 消息／进程页和峰出现时刻；不能把全部下降都算作 worker 的精确字节。上述本体贡献采用同一时点 PID 实测。所有例在 post-idle 仅剩 Host，closed 为 0，最终 176 个已知产品／wrapper／sampler PID 无行，不支持“后台多算了工作”或本批 scope 收尾残留的解释，不能扩大为 heap 无泄漏证明。

优先的后续优化方向是评估同权限边界内文件 worker 的启动依赖及常驻对象能否减轻，并同时守住 60-call 的延迟／CPU收益。本轮未实施；不能靠强制少读文件、关闭并行或推断异步尾部已结束后提前杀进程来达标。

测量使用 200ms 采样，每诊断格 n=2；26 个不完整 footprint 样本保留且未补零，报告完整样本中观察到的峰，可能漏短峰。逐进程 footprint 之和不等于整机净增 RAM，原 bash 管道／新匿名普通文件差异也保留。[详细拆账与限制](../../../.local/managed-execution-optimization/benchmark/parallel-memory-diagnosis-04/diagnosis-result.md)、[新诊断清单](../../../.local/managed-execution-optimization/benchmark/parallel-memory-diagnosis-04/raw-manifest.json)：1378 项／19,038,423 字节，SHA-256 `2a83765882f4e9a1df5f9e2e35a92b90a196f3780091570710caf398239fca3e`。

## 保全、检查及独立复核

[本轮 before](../../../.local/managed-execution-optimization/recorder-memory-followup-04/before-preservation.json) 与 [after](../../../.local/managed-execution-optimization/recorder-memory-followup-04/after-preservation.json) 核对：原 12093 条证据、1,298,073,766 字节及 symlink 均零差异；当前 263 项产品输入仍逐字节等于 C2。原 followup03 `FAILED_OR_UNKNOWN`、缺完整 SSE、旧专业错误／漏报和其他取消／UNKNOWN 均原样保留。04 的通过只适用于新的独立运行，不能恢复或改写旧失败。

本轮产品源码、依赖、长期测试和公共接入不变，检查覆盖记录器回归、真实 Host／SDK／原生工具路径、资源归因及文档／保全。原 C2 完整工程检查 752 PASS／1 平台不适用是上一轮证据，本轮没有冒充重新运行全量检查，也不重复一小时观察。

非作者[最终综合复核](../../../.local/managed-execution-optimization/review/recorder-memory-followup04-final.md)已完成，RM01–RM05 **PASS_WITH_SCOPE**，无未解决阻断发现。复核者未编写产品、本轮记录器、负载或归因脚本；独立解析 raw／JSONL／native、逐 PID 复算原 9＋新 8 例，未调用作者 audit 作为独立结论。支持证据为[完整事件独立读回](../../../.local/managed-execution-optimization/review/recorder-memory-followup04-stream-result.json)、[内存独立拆账](../../../.local/managed-execution-optimization/review/recorder-memory-followup04-memory-result.json)和[新旧清单及 C2 源码独立读回](../../../.local/managed-execution-optimization/review/recorder-memory-followup04-final-manifest-readback.json)，全部清单零 bytes／hash／link 差异。正式汇总的数值和范围已由该复核者确认。限定范围是本机合成技术测试、明确的观察窗口与采样边界，不将新通过替代旧失败或专业质量验收。

真实模型调用为 0，所有资料为隔离合成数据；结果仅证明技术记录、资源及对应生命周期事实，不提升专业分析正确性或独立核算检错率结论。Host 仍只管环境、材料、权限和记录；Agent 自主分析，后台并行、原件保护、停止／UNKNOWN及现有项目／会话／文件均保留。未做 Git/CI 交付、安装、运行服务切换或 MacBook 操作。

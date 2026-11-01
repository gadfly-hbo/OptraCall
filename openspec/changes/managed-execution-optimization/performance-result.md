# 托管执行优化：性能复测结果

2026-11-01。状态：**LOCAL_COMPLETE_WITH_LIMITS**。**主 27＋新 off 3 次兼容完成并独立复算；频繁工具段缩短 76.55%，配对 CPU 增量降低 77.12%，达到本次实验门槛；长计算主请求 +0.433%，四路后台 −6.317%，真实完整小时 3600.002311s 也已独立核对。followup03 的 1000 次产品执行完成，但 runner 的整批 SSE 序列化失败、完整 events.jsonl 缺失，原 receipt 保持 FAILED_OR_UNKNOWN，不能宣称全部实验 PASS。** 最终总 manifest／全范围保全及综合独立复核已完成，结论 PASS_WITH_SCOPE；本页不是用户对全部结果的验收确认。

大白话说，反复读文件的重复启动开销和阶段内闲置进程大幅减少；bash 等任意代码工具仍要独立启动。并行负载的内存峰值反而升高，因此不能说所有场景都更省内存。本次没有真实模型调用，也没有验证模型专业判断更准确。

## 身份、工作量和计量口径

| 项 | 实际固定输入／口径 |
| --- | --- |
| 新托管候选 | C2：263 项源码／长期测试；[manifest](../../../.local/managed-execution-optimization/review/implementation-candidate-2.json) SHA-256 `0551057258c5314d9de7f7cb89570672c736cb6d65c434c5fd6900bbe0b5a512` |
| 原候选 5 | [完整 baseline 快照清单](../../../.local/managed-execution-optimization/implementation-before.json)，254 项；原 252 项加运行必需根配置，不从 HEAD 重建 WIP |
| 主设计 | off／原候选 5 托管／新 C2 托管，3 场景×3 条件×3 重复＝27；[主 02 计划](../../../.local/managed-execution-optimization/benchmark/plan-primary-02.json) SHA-256 `cce70a5470b11620d7d64feb6c81e83d6e725641f172d3fb0d3e5b0e0de178b2` |
| 顺序及不挑样本 | [原冻结顺序／公式](../../../.local/managed-execution-optimization/benchmark/order-and-formulas-frozen.json)；独立早审后在主试验 0 次时修正为每个场景各条件轮占位置，见[冻结修订](../../../.local/managed-execution-optimization/benchmark/order-design-review-amendment-frozen.json)。没有按结果改序、丢样或补跑 |
| 长计算 | 固定 286,123,113 次同一哈希迭代；未重新校准工作量 |
| 频繁调用 | 原 48 read＋12 printf bash，另有所有条件相同的 30 秒无新工具窗口；工具段不含共同等待 |
| 并行 | 4 个各 38,149,748 次迭代任务＋主请求 8 read；核对实际工作、摘要与身份，双方等待同一批工作完成 |
| 新 off 兼容 | [新 off 02 计划](../../../.local/managed-execution-optimization/benchmark/plan-new-off-compatibility-02.json)，每场景 1 次、共 3 次；不混入主统计 n=3 |
| 实际环境 | Apple M4／Mac16,10，10 logical CPU、16 GiB；macOS 26.3.1 arm64；Node v25.9.0、Pi SDK 1.4.0、Python 3.14.4，实际 Python `/opt/homebrew/opt/python@3.14/bin/python3.14`。[环境回执](../../../.local/managed-execution-optimization/benchmark/environment-before.json) |
| 输入冻结 | [02 冻结回执](../../../.local/managed-execution-optimization/benchmark/frozen-inputs-receipt-02.json)绑定实际计划、harness、工作量、图像及候选。共享 node_modules 未递归打包，依赖完整逐文件不可变性是证据局限 |
| 请求及工具延迟 | 本地确定性 Provider，真实模型请求 0；实际 Host→Pi SDK→工具。RTT 用 Provider 发出调用至匹配工具回复请求；SSE 到达可能合并，只核工具身份／错误。p50/p95 先按每次求，再取 3 次中位数 |
| CPU | 完整 Host 生命周期的 `/usr/bin/time` user+sys 与已等待后代；实际已退出的 PPID1 fixture master 自身＋已等待 workers 单列加入，避免遗漏或父子重复。libproc 自身 CPU ticks 按实际 Mach 125/3 换算 |
| 资源 | 主采样 200ms，精确 PID/start 归属，排除 time wrapper、采样器和外部小时 scope；RSS／live footprint 用同一时点进程和，MiB＝2^20 bytes。主请求、工具段、Provider 完成至 Host idle 分列，后者含最多 500ms 状态轮询，不是精确关闭微基准 |

## 主对照：全部组的中位数

每组 n=3；所有个体原值见文末及[作者主分析](../../../.local/managed-execution-optimization/benchmark/primary-analysis-02.json)。采样资源峰值不等于连续测得的真实最大值。

| 场景 | 条件 | n | 主请求 s | 工具段 s | 完整 CPU s | RSS 峰 MiB | live footprint 峰 MiB | 总进程峰（含 Z） | guardian 峰 | Z 峰 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 频繁 60 工具 | 关闭托管 off | 3 | 31.23903 | 0.36825 | 2.59000 | 497.73 | 442.60 | 2 | 0 | 0 |
| 频繁 60 工具 | 原候选 5 托管 | 3 | 53.79688 | 22.04766 | 32.13000 | 1566.45 | 999.03 | 122 | 60 | 60 |
| 频繁 60 工具 | 新 C2 托管 | 3 | 36.92229 | 5.17018 | 9.31000 | 758.86 | 611.41 | 8 | 3 | 1 |
| 长计算 | 关闭托管 off | 3 | 59.54885 | 58.95576 | 60.57000 | 377.30 | 297.36 | 3 | 0 | 0 |
| 长计算 | 原候选 5 托管 | 3 | 60.61226 | 58.93969 | 61.17000 | 550.23 | 427.11 | 5 | 1 | 0 |
| 长计算 | 新 C2 托管 | 3 | 60.87485 | 59.37750 | 61.58000 | 556.83 | 433.90 | 5 | 1 | 0 |
| 4 路后台 | 关闭托管 off | 3 | 9.60216 | 8.66246 | 35.75309 | 509.02 | 380.89 | 8 | 0 | 2 |
| 4 路后台 | 原候选 5 托管 | 3 | 11.46624 | 9.79341 | 44.38721 | 831.89 | 588.16 | 28 | 10 | 9 |
| 4 路后台 | 新 C2 托管 | 3 | 10.74193 | 9.41750 | 38.27631 | 874.73 | 652.87 | 14 | 3 | 1 |

完整 CPU 包含启动、工具、观察和关闭；并行还包含核定的 PPID1 后台家族，不能只用 Host 自己的 CPU。off 仍更轻：频繁 off 工具段 0.36825s／完整 CPU 2.59s，新托管为 5.17018s／9.31s；优化没有抹去权限与执行边界成本。

| 已确认实验门槛 | 同批原托管 | 新托管 | 观察判定 |
| --- | ---: | ---: | --- |
| 频繁 60 工具往返段下降 ≥70% | 22.04766s | 5.17018s | **76.54998%**，达到 |
| 频繁配对 off 的 CPU 增量下降 ≥60% | 中位 29.59 CPU-s | 中位 6.77 CPU-s | **77.12065%**，达到；各对原／新为 29.59/6.77、29.19/6.65、29.76/6.77 |
| 长计算主请求不出现 >5% 稳定退化 | 60.61226s | 60.87485s | **+0.43322%**；三对新−原为 +0.31792、+0.60002、−0.73225s |
| 四路后台主请求不出现 >5% 稳定退化 | 11.46624s | 10.74193s | **−6.31691%**；三对新−原为 −0.41547、−0.77138、−0.89809s |
| 无后台序列调用后的闲置资源 | 末次 30s held-idle 采样仍为 122 个（60 guardian、60 Z） | 末次 held-idle 为 4 个：Host、SDK、文件 worker、guardian，0 Z | 不再每个已完成调用留一整套组；返回后的自然退休短尾仍可能被采到 |
| 60／300／1000 阶梯、完整小时 | 另项验证 | 1000 次 native 完成／各档同 4 身份，小时 3600.002311s 完成 | 实际执行与资源窄事实有证据；阶梯 runner 留档 **FAILED**／缺完整 SSE，不能写整例 PASS |

这些是固定本机合成实验观察，不是生产 SLA、置信区间、总体等价证明或 Agent 的次数／时长／并行限制。长计算原配对 CPU 增量中位仅 0.60 CPU-s，未超过 off 中位 60.57 CPU-s 的 2%，降幅为 **N/A**，不制造小分母百分比。并行配对增量为 8.65417→2.52322 CPU-s，观察降幅 70.84390%，属补充量，不替代工作量与真实并行核验。

## 哪些工具变快、哪些成本保留

| 频繁场景每次 p50／p95 再汇总的中位数 | off | 原托管 | 新托管 |
| --- | ---: | ---: | ---: |
| read p50 ms | 5.13 | 364.36 | 5.93 |
| read p95 ms | 7.05 | 375.86 | 9.57 |
| bash p50 ms | 8.06 | 372.54 | 373.03 |
| bash p95 ms | 9.62 | 379.06 | 410.35 |

文件工具复用贡献于实际路径的改善；bash 继续隔离，p50 基本不变，p95 本批还升高。没有消除 bash/codemode/grep/find 的单次启动，也不能把本批差异全部归因于 guardian。

新托管的 BashOperations 同时包含为输出完整性必需的匿名 regular-file stdout/stderr、20ms 观察与最后 fstat/pread；off／原候选 5 仍用原 pipe。程序可观察 fstat、seek/truncate 或缓冲差异，因此这是完整实际产品路径对照，不是纯 guardian 单变量微基准或完整 shell 环境等价证明。未重定向的活后台可能持有匿名 FD／inode／磁盘块；精确 FD 数、字节与磁盘块 **NOT_MEASURED**。unlink／不可见路径／RSS 不能推为零磁盘或零 FD；固定 parallel／hour／多项目／stop 命令均显式重定向到 `parallel.log`。

## 内存与采样的实际限制

频繁场景 live footprint 峰中位 999.03→611.41MiB，但长计算 427.11→433.90MiB、并行 588.16→652.87MiB；并行 RSS 831.89→874.73MiB。不能概括成所有场景省内存。RSS 会重复共享页，live footprint 进程和也不是整机净增 RAM。

30 例共有 6357 个 valid 样本、0 invalid；精确排除 wrapper 后共有 99,914 条产品进程行，排除了 6284 条 wrapper 行。49 个样本的 live footprint 不完整，保留 missing，未补零；报告的是完整样本中观察到的峰值，可能漏掉不完整样本或短命峰。采样器＋ps 占单核 **11.52–21.56%**，虽不计入产品资源，仍会影响调度。Provider／controller 的额外负载未完整计量，不声称安静整机。

没有新增生产诊断 API。完整 heap、buffer/listener/timer 和 tombstone 精确字节 **NOT_MEASURED**；源码释放、永久回归与 OS 采样各自报告，不能从进程少或 RSS 曲线推导所有堆对象常量。

## 原生内容、字节和独立复算

| 层 | 实际结果／证据 |
| --- | --- |
| 主 27＋新 off 3 | 全部 COMPLETED，未排除、重放或补跑。3 个新 off 无 managed execution marker，最终零产品资源，单独作为兼容证据 |
| 工具实际结果 | 独立直接读取实际 native：710 项 tool result（150 bash／560 read）精确 marker／printf／计算／等待 JSON 与实际 master PID 均一致，零差异；30 个实际 workload.py 与冻结 `f7b3d0a4…` 一致、marker 均为预期 29 bytes |
| 生命周期 | 原生 opened/closed 的 scope／execution／session／profile 身份匹配，全部最终 closed 样本产品进程为 0；结果成功与关闭成功分别核对 |
| 数字复算 | 非作者不导入作者 analyzer，按实际 time、Provider 连续请求时钟、native、fixture 与采样重新计算；主标量全部一致，额外 2065 项内容／个体时延／聚合比较零差异。[独立主结果](../../../.local/managed-execution-optimization/review/implementation-performance-primary-results-candidate-2.md)及[独立复算 JSON](../../../.local/managed-execution-optimization/review/implementation-performance-primary-recompute-candidate-2.json) |
| 主 30 例原始包 | [原始 manifest](../../../.local/managed-execution-optimization/benchmark/primary30-fixed-input-manifest-02.json) SHA-256 `162dd8d9ddd6b06084f5588cff4554274422ce950af7791bc0c7ab7351e784c3`，3775 项／212,703,671bytes，独立流式 hash 零差异；独立遍历 30 个已闭根 3230 文件均被列入。[读回报告](../../../.local/managed-execution-optimization/review/implementation-performance-primary30-manifest-candidate-2.md) |

实际时间顺序是先做首次独立数字／内容重算，再生成并核对该 post-run manifest。manifest 原 status `BEFORE_INDEPENDENT_RECOMPUTATION` 不能按字面代表第一次复算的先后；独立读回报告保留原件并纠正解释。它不影响前置候选、负载、顺序及公式冻结，也不能把事后 manifest 冒充运行前冻结。

## 扩展 02、原失败及 followup03

扩展原 02 五例为 3 完成／2 FAILED_OR_UNKNOWN；同 Host 多项目另项完成。两次原失败保留，03 是新命名的 fixture 修正验证。原始状态、产品事实与采集失败分开报告。[非作者扩展／03 复核](../../../.local/managed-execution-optimization/review/implementation-performance-extensions-and-followup03-candidate-2.md)

| 场景／原证据 | 实际结果及独立核对 | 判定边界 |
| --- | --- | --- |
| [small-directory 02](../../../.local/managed-execution-optimization/benchmark/extensions-02/small-directory-newmanaged/receipt.json) | 1 目录／10 文件，60 native read 精确 marker；COMPLETED，工具段 0.71619s，完整 CPU 2.56s | 一次合成目录条件，不外推目录 SLA |
| [large-directory 02](../../../.local/managed-execution-optimization/benchmark/extensions-02/large-directory-newmanaged/receipt.json) | 50 目录×100 文件，60 native read 精确 marker；COMPLETED，工具段 3.20989s，完整 CPU 5.53s | 逐次 plainTree 保留，未用目录安全缓存 |
| [staircase 02](../../../.local/managed-execution-optimization/benchmark/extensions-02/file-staircase-newmanaged/receipt.json) | **FAILED_OR_UNKNOWN**；313／1000 个唯一 tool result，0 工具错误 | SDK 摘要 fixture 协议错误，原失败不覆盖 |
| [large-media 02](../../../.local/managed-execution-optimization/benchmark/extensions-02/large-media-newmanaged/receipt.json) | **FAILED_OR_UNKNOWN**；计划 8MiB 文本／4096² RGB 图各读 5 次，实际 3／10 个唯一 tool result，0 工具错误 | 原完整工作量未完成，不能改写成 PASS |
| [explicit-stop 02](../../../.local/managed-execution-optimization/benchmark/extensions-02/explicit-stop-newmanaged/receipt.json) | HTTP200 stopped:true；17 个 pre-stop 样本见全部 5 fixture 身份活工作；task／native cancelled，scope closed `10:18:59.623Z`，精确后台退出 `10:18:59.639Z`；最后 3 closed 样本 0 | 响应观察 34ms；中断后台缺最终 self/child CPU 回执，不作全工作量 CPU 比较 |
| [multi-project 02](../../../.local/managed-execution-optimization/benchmark/extensions-02/multi-project-newmanaged/receipt.json) | COMPLETED；3 个项目／task／scope 独立，各 62 工具（60 精确 marker＋start/wait）；12 workers 固定迭代和摘要一致，74 样本实际共同运行 14.59823s；主请求 19.35432s，独立 CPU 14.22＋144.662278＝158.882278s；最后 3 closed 样本 0 | 一次固定规模真实重叠，不代表任意并发或生产容量；未重复加入每个 worker CPU |
| media03 | 整例 **COMPLETED**；10 unique 连续 read＝5 精确截断文本＋5 精确 JPEG，4 actual native compactions；11 normal＋4 summary＝15 HTTP 全 200；native completed／closed、Host shutdown 0、最终产品采样 0 | 原源文本 8,388,608bytes、原 PNG 与固定 hash 一致；原 4096 描述及 SDK 返回 2000² JPEG 保留。未关 SDK 压缩／改窗口／减少工作量 |
| staircase03 | 产品 task／native completed，匹配 opened/closed；1000 unique 连续精确 29bytes marker 与 ledger hash；1001 normal＋702 summary＝1703 HTTP 全 200，702 native compaction entries；各档资源见下 | **实验整体仍 FAILED_OR_UNKNOWN**：完整 SSE 未落盘，不能用实际执行完成把采集器失败升为整例 PASS |

[02 失败诊断](../../../.local/managed-execution-optimization/benchmark/extension-compaction-failure-evidence-02.json)保留摘要事件及 native 错误：SDK 为 turn-prefix 压缩发出无 tools 的摘要请求，本地固定 Provider 错回 tool call，随后压缩失败和 boundary 500。SDK 自动重试不等于 Host 新发起业务执行；冻结 02 requests 数组还漏记 boundary 检查前抛错的 HTTP 尝试，不能据它当总请求数。该解释不把原失败变成成功，也不认定产品 file worker/read 故障。

[03 冻结输入](../../../.local/managed-execution-optimization/benchmark/followup03-inputs-frozen.json)独立核对 7 文件零差异；[计划](../../../.local/managed-execution-optimization/benchmark/plan-followup-03.json) SHA-256 `21da4cc343bdbe2d4ce2096b9b55ea6e980e0a63ee053e64b66ba2913ee113b9`绑定同一 C2 与原材料。只修正测试 Provider 摘要文本和只读 native unique-ID ledger；未修改产品／SDK 压缩／窗口／工具／工作量，未重跑 primary02／hour02。03 native 扫描／hash 与 702 次压缩会带来额外真实开销，其时延不代替主 02 RTT。

### 1000 次资源证据与 SSE 留档失败

| read 检查点 | 样本数／身份 | 总进程／guardian／文件 worker／SDK／Z | live footprint 中位 MiB | RSS 中位 MiB |
| --- | --- | --- | ---: | ---: |
| 60 | 25 样本，同一 4 个 PID/start | 4／1／1／1／0（总数 4 已含 Host） | 565.42 | 658.52 |
| 300 | 25 样本，同一 4 个 PID/start | 4／1／1／1／0（总数 4 已含 Host） | 627.02 | 711.78 |
| 1000 | 25 样本，同一 4 个 PID/start | 4／1／1／1／0（总数 4 已含 Host） | 664.15 | 657.61 |

数量未按已完成调用增加；footprint 中位数在上升，不能写恒定堆／内存、无泄漏或精确去重项大小。完整 heap／buffer／listener／timer／tombstone 字节仍 **NOT_MEASURED**。

runner 在末尾执行 `events.map(JSON.stringify).join` 时超出 V8 字符串长度，触发 **RangeError: Invalid string length**；两次批量留档均失败，完整 `events.jsonl` 缺失，`eventPreservationError` 与原 receipt **FAILED_OR_UNKNOWN** 保留。没有用 native／ledger 补造完整 SSE，没有重跑或改旧原件。最后采样仍 1 Host，不能填成 0；Host shutdown code 0、native closed 和稍后 OS 无进程是不同事实。[10:47:06.758499Z 独立精确 OS 查询](../../../.local/managed-execution-optimization/review/implementation-performance-followup03-staircase-final-os-candidate-2.json)对九个原绑定产品／wrapper 身份与 sampler 查询无行，提供实际退出的后续证据。

[作者内容／资源事实 sidecar](../../../.local/managed-execution-optimization/benchmark/followup03-resource-content-and-later-os-audit.json)与[独立原始核对](../../../.local/managed-execution-optimization/review/implementation-performance-followup03-results-candidate-2.json)不更改原 receipt；[03 raw manifest](../../../.local/managed-execution-optimization/benchmark/followup03-raw-fixed-manifest.json) SHA-256 `0112d1ff04cdfac140749a9f27b8b2c7c0285c04f8eff6185d6769c71ea4b2f4`含 1046 项，[独立核对](../../../.local/managed-execution-optimization/review/implementation-performance-followup03-manifest-verification-candidate-2.json)零 size/hash 差异，明确列出缺失 events。字节包核对通过不等于缺失 SSE 已完整保存。后续仅新增无 SDK 的流式 recorder 合成修复回归，不自动启动 04 真实补跑；新证据待最终索引，旧 03 不变。

C1 原完整检查 744＝741 PASS／2 空 stdout FAIL／1 平台不适用、管道截断 RED、ACK 丢失 RED 和 375.80369 秒取消小时均保留，见[实施说明](implementation-notes.md)与[本地实施结果](implementation-result.md)。首个公开 stop HTTP500 UNKNOWN 不能被 native closed／后来 OS 为 0 改成成功。原 18 次／97 项、预跑和旧专业 FAIL／漏报／UNKNOWN 不被性能结果覆盖。

## hour02：真实完整小时与最终退出

[独立最终原始核对](../../../.local/managed-execution-optimization/review/implementation-performance-hour-final-audit-candidate-2.json)确认实际纯 idle **3,600,002.311292ms＝3600.002311s**。初始 5 个后台 PID/start 身份在 `2026-11-01T09:54:03.982Z` 已实际消失，从此起算完整一小时；70 个真实工具内容、4 后台固定工作均匹配，全部 primary27 位于同一 held-idle 窗口内。

| 量 | 实际独立结果 |
| --- | --- |
| 状态及回执 | 原 receipt COMPLETED、task／native completed；scope closed `10:54:04.175Z`，匹配 opened/execution/scope，Host shutdown code 0 |
| 全小时采样 | 3600 held 样本，样本跨度 3599.000078s（不同于 Provider 观察时长）；间隔 0.989919–1.010046s，0 invalid、0 held-footprint missing |
| 活动身份 | 所有 held 样本同 4 PID/start：Host、SDK、guardian、文件 worker；0 workload、0 Z，未出现按已完成调用数量增长的进程 |
| CPU（单核口径） | 产品 2.4980%，其中 guardian 0.0511%；实际 held 自身 CPU 分别 Host 42.91885s、SDK 45.09493s、guardian 1.83910s、file worker 0.05105s |
| 内存观察范围 | RSS 252.42–672.02MiB；live footprint 310.70–575.75MiB，会波动，不是净 RAM／恒定内存／无泄漏证明 |
| 测量器单列 | 1s sampler＋ps 138.49845 CPU-s／3.8279% 单核，不进入产品资源，仍可能扰动调度 |
| 最终退出 | closed 样本产品数 0；`10:55:00.599517Z` 独立 ps 查询全部已知 PID 无行（exit 1），产品／后台／guardian／测量身份已退出 |
| 主窗口交叠 | 主 27 从 `09:54:34.846Z–10:14:02.342Z` 全部包含；同一外部 scope 共同存在，数值负载会变化，不能写成恒定干扰或安静整机 |

早期 1170 样本[交叠快照](../../../.local/managed-execution-optimization/review/implementation-performance-primary-idle-overlap-candidate-2.json)仍保留当时范围，不用后来的完整小时结果改写旧报告的 PENDING 时点。此处完整结论来自最终实际 receipt、native、全部样本、workload 与独立 OS 回读，不是只等墙钟满一小时。

| 最终收尾项 | 实际核对结果 |
| --- | --- |
| 最终全部原始数据 manifest | [最终清单](../../../.local/managed-execution-optimization/benchmark/final-full-evidence-manifest.json) 12,093 项、regular 字节 1,298,073,766，独立逐字节零差异；缺失 03 SSE 明确声明 |
| 全范围精确 OS 全 0＋source／旧证据保全 | [41 根退出核对](../../../.local/managed-execution-optimization/benchmark/final-all-benchmark-process-os-proof.json)与[最终保全](../../../.local/managed-execution-optimization/benchmark/final-source-and-old-evidence-preservation.json)已另独立回读；1,098 已知 PID 当前无行，C2 current／snapshot、baseline／C1／原97均一致 |
| 最终非作者综合结论 | [最终独立报告](../../../.local/managed-execution-optimization/review/implementation-performance-final-candidate-2.md)：主性能／产品资源 **PASS_WITH_SCOPE**，03 整体 runner FAILED 与 SSE 缺失保留 |
| 流式 recorder 合成修复回归 | [独立核对](../../../.local/managed-execution-optimization/review/implementation-performance-stream-recorder-audit-candidate-2.json)：8,300 条、564,324,190 字节，逐行内容／顺序／hash 一致；无 SDK／无真实重跑，未改旧03 |
| 最终表述边界 | 本地工程检查、主性能目标通过；完整小时及 media 成立、1000 次产品执行／资源证据成立，实验记录仍有已保留缺口，不能宣称全部实验 PASS |

## 保全与授权停止线

10:34 UTC 的文档只读回读确认 C2 current263／snapshot263、baseline254、C1snapshot260 和原97逐项 size/hash 无差异，见[读回回执](../../../.local/managed-execution-optimization/delivery-drafts/preservation-readback.json)。该早期回执只证明列项字节，不是用户项目全盘保全或最终关闭证明；最终已另完成候选／固定证据逐字节核对及所有实验身份退出，见上表与末节。

本轮仅本地合成资源实验和已授权工程验证；真实模型调用为 0，Git/CI、合并、安装、切换运行服务、MacBook 和产品验收 **NOT_RUN**。性能不代表专业可靠性，用户原项目／会话／文件、旧 FAIL／取消／UNKNOWN 与既有 WIP 均保留。

## 主 27 例全部个体

下表按实际 receipt 列出，未丢弃失败或异常；所有本批个体均 COMPLETED。每例的原生、time、采样、source before/after、fixture 和摘要入口由[主分析 JSON](../../../.local/managed-execution-optimization/benchmark/primary-analysis-02.json)及主 30 例 manifest 绑定。

| ID | 状态 | 主请求 s | 工具段 s | 完整 CPU s | RSS 峰 MiB | live footprint 峰 MiB | 总进程峰（含 Z） |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| r1-long-off | COMPLETED | 58.02839 | 57.31947 | 58.92000 | 396.80 | 319.21 | 3 |
| r1-long-current5managed | COMPLETED | 60.61226 | 58.67693 | 60.81000 | 550.23 | 427.11 | 5 |
| r1-long-newmanaged | COMPLETED | 60.93018 | 59.37750 | 61.58000 | 549.53 | 426.32 | 5 |
| r1-frequent-current5managed | COMPLETED | 53.92379 | 22.04766 | 32.13000 | 1589.45 | 1018.59 | 122 |
| r1-frequent-newmanaged | COMPLETED | 36.92229 | 5.17018 | 9.31000 | 758.86 | 611.41 | 7 |
| r1-frequent-off | COMPLETED | 31.23903 | 0.37304 | 2.54000 | 505.16 | 450.98 | 2 |
| r1-parallel-newmanaged | COMPLETED | 10.96906 | 9.39053 | 38.27631 | 874.73 | 652.87 | 14 |
| r1-parallel-off | COMPLETED | 9.61993 | 8.66014 | 35.75309 | 527.09 | 401.02 | 8 |
| r1-parallel-current5managed | COMPLETED | 11.38453 | 9.71789 | 44.38721 | 831.06 | 587.49 | 28 |
| r2-frequent-newmanaged | COMPLETED | 36.37703 | 5.13376 | 9.24000 | 752.23 | 616.66 | 8 |
| r2-frequent-off | COMPLETED | 31.28163 | 0.36547 | 2.59000 | 497.73 | 442.60 | 2 |
| r2-frequent-current5managed | COMPLETED | 53.30133 | 21.77780 | 31.78000 | 1566.45 | 977.28 | 122 |
| r2-parallel-off | COMPLETED | 9.60216 | 8.66246 | 35.76707 | 509.02 | 380.89 | 8 |
| r2-parallel-current5managed | COMPLETED | 11.46624 | 9.89296 | 44.42123 | 831.89 | 588.16 | 28 |
| r2-parallel-newmanaged | COMPLETED | 10.69486 | 9.41750 | 38.26345 | 883.64 | 662.84 | 14 |
| r2-long-current5managed | COMPLETED | 60.27482 | 58.93969 | 61.17000 | 544.72 | 421.39 | 5 |
| r2-long-newmanaged | COMPLETED | 60.87485 | 59.13839 | 61.34000 | 563.31 | 441.44 | 5 |
| r2-long-off | COMPLETED | 59.54885 | 58.95576 | 60.57000 | 377.30 | 297.36 | 3 |
| r3-parallel-current5managed | COMPLETED | 11.64001 | 9.79341 | 44.34228 | 844.75 | 602.44 | 28 |
| r3-parallel-newmanaged | COMPLETED | 10.74193 | 9.53898 | 38.85022 | 872.66 | 650.59 | 14 |
| r3-parallel-off | COMPLETED | 9.59932 | 8.69144 | 35.58183 | 506.02 | 377.83 | 8 |
| r3-long-newmanaged | COMPLETED | 60.69684 | 59.60600 | 61.89000 | 556.83 | 433.90 | 5 |
| r3-long-off | COMPLETED | 61.10748 | 60.19316 | 61.85000 | 368.19 | 287.20 | 3 |
| r3-long-current5managed | COMPLETED | 61.42909 | 59.71861 | 61.86000 | 569.05 | 448.59 | 5 |
| r3-frequent-off | COMPLETED | 31.23603 | 0.36825 | 2.61000 | 492.42 | 438.27 | 2 |
| r3-frequent-current5managed | COMPLETED | 53.79688 | 22.18526 | 32.37000 | 1551.16 | 999.03 | 122 |
| r3-frequent-newmanaged | COMPLETED | 37.06067 | 5.26868 | 9.38000 | 767.62 | 589.19 | 8 |


## 最终证据冻结与验收边界

[最终综合非作者复核](../../../.local/managed-execution-optimization/review/implementation-performance-final-candidate-2.md)确认主 27 次、额外新 off 3 次、目录／显式停止／多项目、完整小时和 followup03 的实际记录。主性能及产品资源结论为 **PASS_WITH_SCOPE**，不将阶梯 runner 的留档失败改写为整体 PASS。

[最终证据清单](../../../.local/managed-execution-optimization/benchmark/final-full-evidence-manifest.json) SHA-256 `a1835253481183d82279b5386ce9a9c72443140bc8a5aabbecf18759839ba3f5`：12,093 项（12,090 文件＋3 symlink）、regular 字节 1,298,073,766，独立逐项零差异。03 完整 events 缺失有明确清单，不以重建数据补位。原 97 项证据及 baseline／C1／C2／当前源码保全，所有 41 个实验根的已知产品和测量 PID 最终无行；见[退出证明](../../../.local/managed-execution-optimization/benchmark/final-all-benchmark-process-os-proof.json)、[保全证明](../../../.local/managed-execution-optimization/benchmark/final-source-and-old-evidence-preservation.json)与[最终本地回执](../../../.local/managed-execution-optimization/local-delivery-closeout.json)。

[流式采集器合成修复](../../../.local/managed-execution-optimization/review/implementation-performance-stream-recorder-audit-candidate-2.json)只验证未来留档：8,300 条、564,324,190 字节，逐条背压写入和独立读取相符，writer buffer 最大 67,991 字节；发生在小时观察结束后，未调用 Host／SDK，没有追加真实模型／工作量重跑，也没有恢复原 03 SSE。

本轮没有 Git/CI、合并、安装、服务切换或 MacBook 操作；OptraCall 运行验收的模型传输均为本地确定性 Provider，真实模型请求 0。性能结果不能关闭旧专业分析错误／核算漏报或替代专业可靠性、运行采用及产品验收。


仅验证新流式写入组件，尚未接回真实 SDK 采集并完成接线复验；不能据此宣称真实完整 SSE 留档问题已经通过验证。

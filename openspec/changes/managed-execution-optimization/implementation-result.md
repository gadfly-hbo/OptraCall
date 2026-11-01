# 托管执行优化：本地实施结果

2026-11-01。状态：**LOCAL_COMPLETE_WITH_LIMITS**。**候选 2 本地实现、完整适用工程检查及主性能目标通过，真实完整小时已完成并获独立原始证据核对。followup03 的 1000 次产品执行与资源证据成立，但测量 runner 的整批 SSE 序列化失败，完整 events.jsonl 缺失、原 receipt 保持 FAILED_OR_UNKNOWN，不能宣称全部实验 PASS。** 最终证据清单、全范围退出及源码保全已独立核对，综合结论为 PASS_WITH_SCOPE。用户确认方案／spec 不等于确认全部实施结果。

## 实际改变

同一个受管执行 scope 首次用到 `read/write/edit/ls` 时，准备一套受保护的原生文件工具并复用，避免每次读取重新启动一整套环境。`bash/codemode/grep/find` 继续各自隔离；确认已经自然结束、没有后台工作的组可提前释放。仍在计算的后台工作保留，正常交接自然等待；显式停止／关闭或调用取消时按原权限及对应归属收回，不误停其他 owner。

Host 管资源、权限、材料和真实关闭回执；Agent 继续自主选择工具、方法、并行、后台和分析迭代。没有 Host 补计算、固定分析流程、工具次数／等待时长限制、全局分析队列或新 Runtime。没有 UI、业务持久表或旧资料迁移。公共 Interface 保持 v3，业务 v1/v2 子集及 `optracall.execution` v1 保持兼容。

实施及必要兼容修正见[实施说明](implementation-notes.md)。stdout/stderr 已改为立即 unlink 的匿名普通文件；这一点能被程序观察，且活后台可继续持有 FD、inode 和磁盘块，不能称 shell 环境完全逐项等价、零磁盘成本或所有内存均下降。关闭 ACK 修正只等待真实 IPC 发送回调，再由原父进程核对匹配 ACK 与实际退出；没有用 native `closed` 或 OS 消失补造公开停止成功。

## 固定身份与范围

| 项 | 实际绑定 |
| --- | --- |
| 源码／长期测试候选 | [C2 manifest](../../../.local/managed-execution-optimization/review/implementation-candidate-2.json)，263 项；SHA-256 `0551057258c5314d9de7f7cb89570672c736cb6d65c434c5fd6900bbe0b5a512` |
| 完整候选 | [new-candidate-2](../../../.local/managed-execution-optimization/new-candidate-2/)；相对完整旧候选 18 项增量、无删除；不能只用 HEAD 代表已有 WIP |
| 清单记录的分支／HEAD | `codex/decision-feedback-loop` / `b36a42b43e86a279b1931770022c50b306ceeb36`；这是固定输入身份，不是 Git 交付回执 |
| 原输入保全 | [baseline 254 项](../../../.local/managed-execution-optimization/implementation-before.json)、[C1 260 项](../../../.local/managed-execution-optimization/review/implementation-candidate-1.json)、[原 97 项性能证据](../../../.local/managed-execution-resource-evaluation/final-input-manifest.json)原位保留 |
| 当前授权 | 已确认 [spec MO01–MO12](spec.md)、[D1–D8 全 A](structure-decisions.md)：本机实施、完整适用检查、固定负载性能对照、非作者复核；保留项目／会话／文件 |
| 本页不构成 | Git/CI、合并、安装、运行服务切换、MacBook 操作、专业可靠性或产品验收 |

## 检查与独立复核

| Gate | 证据与结果 | 本结论的边界 |
| --- | --- | --- |
| 本地完整适用检查 | `npm run check`，753 项：752 PASS、0 FAIL、1 平台不适用；AST 会话边界、类型检查及构建通过。[完整日志](../../../.local/managed-execution-optimization/full-check-candidate-2.log) | 本地检查，不是 CI；构建包体警告保留 |
| 非作者 Standards＋Spec／权限／生命周期 | [C2 生命周期复核](../../../.local/managed-execution-optimization/review/implementation-lifecycle-candidate-2.md) **PASS_WITH_SCOPE**，无未解决 blocking finding；独立 9 项真实回归和 8 个精确边界探针通过 | 固定 C2 源码范围；不代替性能、小时或专业验收 |
| 另一非作者源码标准与实验输入核对 | [C2 标准／输入复核](../../../.local/managed-execution-optimization/review/implementation-performance-input-candidate-2.md) **PASS_WITH_SCOPE**；263 项 current／snapshot 字节一致，12 个 AST 探针通过，02 计划／harness 冻结一致 | 不把输入审查当成实际性能成绩 |
| 主性能及兼容结果独立复算 | [主结果复核](../../../.local/managed-execution-optimization/review/implementation-performance-primary-results-candidate-2.md) **PASS_WITH_SCOPE**：27＋3 均完成，710 项原生工具结果精确内容零差异，额外 2065 项比较零差异 | 完整小时已另获独立核对；最终全量 manifest 与综合结论已核对 |
| 主 30 例证据逐字节读回 | [manifest 复核](../../../.local/managed-execution-optimization/review/implementation-performance-primary30-manifest-candidate-2.md)：3775 项、212,703,671 字节，零 missing／size／hash 差异 | 实际先做首次独立复算，再生成并核对 post-run manifest；其原 status 文案的时间先后歧义在复核中纠正，原文件保留 |
| 小时及扩展独立证据复核 | [hour02 最终原始核对](../../../.local/managed-execution-optimization/review/implementation-performance-hour-final-audit-candidate-2.json)无 issues；[02／followup03 扩展复核](../../../.local/managed-execution-optimization/review/implementation-performance-extensions-and-followup03-candidate-2.md)分别核对原失败、完成场景及 1000 次的窄事实 | SSE 缺失与 runner FAILED 不升级为整例 PASS；最终综合 PASS_WITH_SCOPE 报告已完成 |

全部复核者均未编写产品、长期测试或实验 harness。候选变化后须重新固定身份并重验受影响范围；本页不为未来变更沿用旧 PASS。

## MO 验收覆盖

| Spec | 已有实际证据 | 当前状态／限制 |
| --- | --- | --- |
| MO01 准入／owner；MO12 兼容 | 原公共 owner/profile、未开启自动路径、历史来源／重启不升级；v1/v2、Task/Case/RAP/SAP、自动链和普通任务完整回归 | 源码／工程检查通过；hour02 及扩展精确退出已有证据，最终全范围保全已核对 |
| MO02 按需复用；MO04 多路与并行 | 8 路首次 read 合并初始化、实际重新读取、SDK 错误／截断／Unicode／图片、多行分片／乱序／迟到／去重及单次 signal | 工程检查通过；followup03 有 1000 unique 精确 marker 和完整 10 次 media；阶梯 runner 留档 FAIL／缺 SSE 分开保留 |
| MO03 隔离工具路径 | Python/codemode／嵌套工具、跨调用后台及脱组拒绝；主对照四路后台的实际工作量和输出核对 | 主对照及独立多项目核对通过；3×62 工具、12 workers 真实重叠 14.59823s，不能外推任意并发容量 |
| MO05 单取消／scope stop；MO08 drain／closed | FIFO 异步尾部、首次初始化时停止、真实大图 direct／HTTP held stream stop；只有完整 scope 关闭才写原 closed | 工程检查通过；02 stop 公开成功／cancelled／native closed／精确后台退出分列；hour02 实际 3600.002311s 完成且最终已知 OS 身份为 0 |
| MO06 自然收集；MO07 单次退休 | 实际 Seatbelt 无信号回收、后台存在不收、waitpid／reap 后未知、失败 latch／parentloss、公共 `retryFailed` | 工程检查通过；不因 result／一次空采样／超时自动判定已关闭，不自动重放 |
| MO09 权限／材料 | 原件、native、凭据、symlink/hardlink、脱组、控制伪造拒绝；ordinary 原 020/060 能力与 010 软提示保留 | 工程检查通过；逐调用 `plainTree` 未缓存 |
| MO10 对象释放／保留去重 | settled pending／signal／listener 释放，成功自然收集移除组，必要 tombstone／失败记录保留 | 源码与回归通过；60／300／1000 各 25 样本均相同 4 个身份、1 guardian／1 worker／1 SDK／Host、0 Z；完整 heap／buffer／listener／timer／去重精确字节 **NOT_MEASURED**，不能从 RSS 推为常量 |
| MO11 性能 | 主对照及新 off 兼容已完成，两个频繁场景目标达到；长／并行主请求未见 >5% 中位数退化 | [性能结果](performance-result.md)；小时、media 完成，1000 执行／进程数量证据成立；SSE 留档 FAIL 保留，最终综合报告／manifest 已完成，不能写全部实验 PASS |

更细的 V1–V12 对照与永久回归入口见[验收证据索引](validation-evidence.md)。没有用定向检查替代完整适用检查。

## 失败、取消与 UNKNOWN 原样保留

| 原记录 | 分类与处置 | 仍不能声称 |
| --- | --- | --- |
| 原 18 次性能、97 项输入、预跑与旧专业错误／漏报 | 全部原位保留；旧专业结果见[专业验证](../analysis-verification-reliability/professional-evaluation.md)，本轮未重放 | 性能提速不能关闭专业 FAIL 或完整产品验收 |
| C1 最终完整检查 744=741 PASS／2 FAIL／1 平台不适用 | 两次实际空 shell 输出保留。确定性真实管道调度 RED 证实 `child.exit` 过早 destroy 可丢未交付字节，C2 改匿名 FD 并补 7 项永久回归 | 此前另一时点的 742 通过不能覆盖最终失败；自然短输出原并发失败未被稳定复现，不夸大因果范围 |
| C1 小时运行取消 | 纯 idle 375.80369 秒，**CANCELLED_NOT_COMPLETED**；主 27 例当时尚未开始。[最终取消回执](../../../.local/managed-execution-optimization/benchmark/hour-resident-01/hour-resident-newmanaged/external-cancelled-not-completed-final-receipt.json) | 不是一小时通过 |
| C1 首次公开 stop HTTP500 `protected_cleanup_unknown` | 原 busy／UNKNOWN、native cancelled／closed、OS 进程消失和后来精确 Host 公共 shutdown 分开保留；最终 12 个已知身份为 0，Host exit code 独立证据仍 UNKNOWN | 不能因 native closed／最终 OS 为 0 改写公开 stop 成功 |
| 大图 IPC 下的关闭 ACK 丢失 RED | direct／HTTP 及父消费阻塞 400ms 的真实对照保留；C2 仅 await 实际 send callback 后，匹配 ACK 和退出均验证通过。[诊断目录](../../../.local/managed-execution-optimization/stop-diagnosis/) | 关闭资源与交付关闭回执是两件事；缺回执不补成功 |
| 扩展 02 阶梯／media | 原 5 例中 3 完成、2 **FAILED_OR_UNKNOWN**；分别只完成 313／1000、3／10 个 tool result，零工具错误。固定本地 Provider 把 SDK 无工具摘要请求回成 tool call，随后 SDK 自动重试和 boundary 500 失败；[原诊断](../../../.local/managed-execution-optimization/benchmark/extension-compaction-failure-evidence-02.json)保留 | 不能据此写成 1000／media 完整通过，也不能把 fixture 协议失败写成产品 read 工具错误 |

followup03 已在新命名证据根真实执行，仅修正测试 Provider 对 SDK 摘要文本和只读 native unique-ID ledger 的处理；产品字节、SDK 自动压缩、context window、工具和工作量未变，未重跑主 27 或 hour02。media 整例 COMPLETED：10 unique（5 文本／5 JPEG）精确内容／hash、4 native compactions、15 HTTP 全 200、closed 样本 0。阶梯的产品 task／native completed、匹配 closed，1000 unique 精确 marker、1001 normal＋702 summary＝1703 HTTP 全 200、702 native compaction entries；60／300／1000 各 25 样本同 4 PID/start、0 Z。

**阶梯实验整体仍 FAILED_OR_UNKNOWN。** runner 在 `events.map(JSON.stringify).join` 留档时触发 `RangeError: Invalid string length`，完整 SSE `events.jsonl` 未保存，原 `eventPreservationError` 保留，不重建、不补造或重跑。末采样仍 1 Host，不写成 0；Host shutdown 0 和[稍后独立精确 OS 核对](../../../.local/managed-execution-optimization/review/implementation-performance-followup03-staircase-final-os-candidate-2.json)中九个原绑定产品／wrapper 身份加 sampler 全部无行，是不同的证明。无按已完成调用数累积进程的窄事实不等于完整实验 PASS、恒定内存或无泄漏。

[03 raw manifest](../../../.local/managed-execution-optimization/benchmark/followup03-raw-fixed-manifest.json) SHA-256 `0112d1ff04cdfac140749a9f27b8b2c7c0285c04f8eff6185d6769c71ea4b2f4`：1046 项已独立核对零差异，明确列出缺失 events，而非用缺失条目制造完整性通过；见[核对回执](../../../.local/managed-execution-optimization/review/implementation-performance-followup03-manifest-verification-candidate-2.json)。03 ledger 扫描／hash 与 SDK 压缩开销不替代主 02 性能时延。后续采集器仅做无 SDK 的流式留档合成修复回归，不自动发起 04 真实补跑；仅合成的[流式采集器修复核对](../../../.local/managed-execution-optimization/review/implementation-performance-stream-recorder-audit-candidate-2.json)已完成：8,300 条、564,324,190 字节，顺序／内容／hash 一致，逐条背压写入，最大 writer buffer 67,991 字节。该回归在小时结束后进行，不调用 Host／SDK，不恢复或替代原 03 SSE。

## 已完成小时与最终收尾

[hour02 独立原始核对](../../../.local/managed-execution-optimization/review/implementation-performance-hour-final-audit-candidate-2.json)：初始 5 个后台身份退出后，自 `09:54:03.982Z` 真实纯 idle **3600.002311s**；3600 held 样本，同 4 PID/start、0 workload／0 Z／0 invalid／0 footprint missing，间隔 0.989919–1.010046s。70 个真实工具、4 个后台固定工作与全部主 27 窗口覆盖均已核对。任务／native COMPLETED，scope closed 于 `10:54:04.175Z`，closed 样本 0、Host code 0；`10:55:00Z` 独立 ps 查询所有已知身份无行。

产品纯 idle CPU 2.4980% 单核，其中 guardian 0.0511%；RSS 252.42–672.02MiB、live footprint 310.70–575.75MiB 会波动。1s sampler＋ps 自身 138.498 CPU-s／3.8279% 单核另列、不进产品；本结果不证明内存恒定、无泄漏或整机净 RAM。

| 最终收尾项 | 实际结果与证据 |
| --- | --- |
| 全部原始输入／结果 manifest | [最终清单](../../../.local/managed-execution-optimization/benchmark/final-full-evidence-manifest.json) SHA-256 `a1835253481183d82279b5386ce9a9c72443140bc8a5aabbecf18759839ba3f5`：12,093 项（12,090 文件＋3 symlink）、regular 文件 1,298,073,766 字节，独立逐字节零差异；明确保留缺失 03 SSE，未补造 |
| 全范围 OS 关闭及源码／旧证据保全 | [退出核对](../../../.local/managed-execution-optimization/benchmark/final-all-benchmark-process-os-proof.json)涵盖 41 个实验根、1,098 个已知 PID，独立再查询无行、不发信号；[源码／原证据保全](../../../.local/managed-execution-optimization/benchmark/final-source-and-old-evidence-preservation.json)核 baseline254、C1 260、C2 263 快照和原97均无差异，当前263也匹配；[本地交付回执](../../../.local/managed-execution-optimization/local-delivery-closeout.json)另存最终分支／WIP／文档与范围 |
| 综合非作者结论 | [最终独立复核](../../../.local/managed-execution-optimization/review/implementation-performance-final-candidate-2.md)：主性能与产品资源 **PASS_WITH_SCOPE**，无新的产品阻断 finding；03 staircase 整体 runner **FAILED_OR_UNKNOWN**、完整 SSE 缺失继续保留 |
| 流式采集器合成修复回归 | [独立回读](../../../.local/managed-execution-optimization/review/implementation-performance-stream-recorder-audit-candidate-2.json)：8,300 条真实新合成行、564,324,190 字节（超过单字符串上限）逐条顺序／内容／hash 匹配；无 SDK、无真实重跑，不覆盖旧失败 |
| 本地最终结果表述 | 本地工程检查、主性能目标和资源边界已完成本轮验证；1000 执行／进程证据、完整小时和 media 成立。实验留档仍有已声明缺口，不称全部实验 PASS、专业验收或产品验收通过 |

本轮没有暂存／提交／推送、CI、合并、安装或服务切换授权；这些交付项保持 **NOT_RUN**。用户项目、会话和文件保持原位，未以清理、恢复旧副本或重放中断请求制造通过。代码回退仅适用于无活资源的新执行，不热接管旧 scope，不覆盖新增工作。


仅验证新流式写入组件，尚未接回真实 SDK 采集并完成接线复验；不能据此宣称真实完整 SSE 留档问题已经通过验证。

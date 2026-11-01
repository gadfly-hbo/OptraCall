# 托管执行优化：验收证据索引

状态：候选 2 源码、完整工程检查、主性能及完整一小时证据已完成独立核对。总体按 PASS_WITH_SCOPE 记录；03 阶梯产品／资源证据与完整 SSE 留档失败分别保留，不宣称全部实验 PASS。最终结果见[实施结果](implementation-result.md)和[性能结果](performance-result.md)。

## 固定候选及完整检查

候选 2 清单为 `.local/managed-execution-optimization/review/implementation-candidate-2.json`，SHA-256 `0551057258c5314d9de7f7cb89570672c736cb6d65c434c5fd6900bbe0b5a512`，包含 263 项实际源码／永久测试及必要根配置。相对完整旧候选有 18 项增量，无删除。快照 `new-candidate-2/` 与当前文件逐项一致。

完整 `npm run check`：753 项，752 PASS、0 FAIL、1 平台不适用；AST 会话边界、类型检查及构建通过。日志 `.local/managed-execution-optimization/full-check-candidate-2.log`。此前候选 1 的两项失败及留驻取消 UNKNOWN 原位保留，详见[实施说明](implementation-notes.md)。

## MO／V 对照

| Spec／验证 | 已有实际检查 | 尚须分别记录 |
| --- | --- | --- |
| MO01／V1/V12 | 原公共 owner/profile、自动默认关闭、旧来源／重启不升级；实际 Host 自动链及普通任务兼容回归 | 性能各条件开关／版本与实际 source guard |
| MO02／V1/V4 | 8 路首次 read、单 guardian 复用、内容变更后重新读取；真实 SDK read 的错误、截断、Unicode 与图片等价 | 60/300/1000 阶梯及一小时 OS 资源观察 |
| MO03／V2/V5 | bash/codemode/grep/find 原隔离；实际 Python/codemode、嵌套工具、重定向后台、写入后台及脱组拒绝 | 固定 4 路并行计算摘要、交叠与完整退出 |
| MO04／V3/V7 | 多行／分片／乱序消息，单次参数／signal／结果隔离，重复 ID 不执行；SDK 同文件 mutation queue | 原生完整输出核对，不只检查 isError |
| MO05／V4/V8 | FIFO 异步尾部、单次取消不误停其他调用；首次文件调用未完时 stop；真实大图结果／held stream 下 direct 与 HTTP stop ACK | 扩展多项目／停止场景实际资源收尾 |
| MO06／V5/V6 | 实际 Seatbelt guardian 无信号自然回收；后台存在不回收；原命令完成后 guardian 及时消失 | 各正式场景的活组与 Z 采样／结束身份核对 |
| MO07／V9/V10 | 自然／强制 waitpid 异常、reap 后只查询、失败 latch、parentloss 不循环清理；公共 retryFailed 资格透传 | 正式失败若发生，保留其实际状态，不挑样本或重跑 |
| MO08／V4/V9/V12 | 正常 release 不 abort；SDK／图片异步尾部自然退出；scope 全部实际关闭才写 closed；大 IPC 回复须确认 ACK 写出 | 完整小时及每组 Host／guardian／后台／测量器最终退出 |
| MO09／V11 | 原件／native／凭据保护，symlink/hardlink、脱组和伪造控制拒绝；ordinary 的原 020/060 能力及 010 软提示 | 拓展大目录／大文本／图片时的实际权限和数据规模 |
| MO10／V1/V6 | settled 调用清 pending/signal/listener；成功自然收集移除组；保留去重 tombstone／失败对象／Agent 文件 | 阶梯 OS 资源曲线；堆／listener 精确内部计量未增加产品诊断 API，不据 OS 值伪造 |
| MO11／性能 | 三条件同批计划、顺序、工作量、公式和 02 harness 已冻结，性能数值已独立复算 | 全 27 次、额外新 off 兼容及扩展原始数据、独立复算与门槛结论 |
| MO12／V12 | 公共 v3、旧业务 v1/v2、历史版本归属、Task/Case/RAP/SAP及原决策能力在完整回归内；无 UI 改动 | 最终保全回执；不自动 Git/CI、安装或切服务 |

主要永久回归：`managed-execution-optimization.test.ts`、`protected-file-process.test.ts`、`protected-tool-supervisor.test.ts`、`protected-bash-operations.test.ts`、`managed-execution-stop-held.test.ts`、`managed-execution-unknown-host.test.ts`，以及既有 `protected-tools`、`protected-session`、公共 `agent-session-execution` 和实际自动链检查。

FIFO 取消尾部在真实 SDK 文件 worker 子进程层验证，不代表为产品新增 FIFO 准入；实际 Seatbelt 原件权限与 guardian 最终进程退出由对应独立场景验证。

技术故障与普通工具错误分别检查：missing／malformed result 导致技术失败／UNKNOWN，即使模型给出最终文本也不补造成功；正常 ENOENT、权限拒绝或作者自抛同名错误仍交给 Agent 自主处理。Host 不判断计算公式或专业结论。

## 独立复核范围

- `review/implementation-lifecycle-candidate-2.md`：非作者 Standards＋Spec／安全生命周期 PASS_WITH_SCOPE，独立 9 项定向回归与 8 个 SDK 边界探针通过；无未解决 finding。
- `review/implementation-performance-input-candidate-2.md`：另一非作者重新检查候选 2 源码标准、263 项当前／快照与 02 冻结输入，12 个精确边界探针通过；性能结果已另由最终报告独立复算。

以上路径均位于 `.local/managed-execution-optimization/` 下。本轮没有用源码审查或完整工程检查替代性能实测、专业可靠性、CI、运行采用或产品验收。


上述“尚须分别记录”栏按最终实施／性能结果索引闭合：完整小时、1000 unique 的三个资源检查点、media、多项目与停止均已有原生／采样／OS 事实；03 整体 runner 留档 FAIL 和缺 SSE 仍是明确限制。精确堆／listener／timer／FD／磁盘字节不在本轮测量范围，未以推断补值。

# Issue #149 二审终审：运行时子审

固定候选：`495cbfce171cf28f8fcb65c0ad391718c3b5cca0`（实现代码 `54520672b6acd36420123b9e60af6f8fefc0da80`），基线 `699e425cb0900b50385377d638495069fa726761`。只读重读 AGENTS、工程规范官方 Pi 约束与 IN01–IN07、统一接入说明及本单 spec/tasks/implementation；按实际源码与独立运行结果判断，没有直接接受 `verification/second-review.md` 的 PASS。

**结论：此固定候选不可合并。两项剩余实际缺陷已复现，须由 PM 接修后重验。** 源码/测试/共享依赖未修改，自有脚本与所有合成运行数据位于 `.local/pm-second-runtime/`；未调用真实供应商或读取凭据。

## SRR-01 · P1：合法同轮双声明工具竞争 Case 总 revision，第二个请求保存失败

位置：`src/host/strategy-discussion-host.ts:645,658`；相应工具执行 `src/agent/project-session.ts:786–827`；测试 `tests/workspace-daily-pi-loop.test.ts:82–107,121`。

本人独立运行现有永久测试：

`TMPDIR=/workspace/OptraCall-issue149-final/.local/pm-second-runtime/tmp /workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node --test tests/workspace-daily-pi-loop.test.ts`

实际 **exit 1，0 PASS / 1 FAIL**，日志 `pi-loop.log`。失败为 home.pending.length 的 `0 !== 1`，不是 Host 启动/环境失败。

真实调用链：Host → 业务讨论 `goal-draft` owner → 官方 Pi1.4.0 → 本地隔离合成 HTTP Provider，case-directory 正常返回；第二个真实 `{role:'case',caseId,itemId}` owner 同一 assistant 批次发 `case-save-issue-edge` 与 `case-save-decision-request`。本次原 native 的第8行保存两 toolCall，第9行 edge 回执成功，第10行 request toolResult 为 `isError:true`、正文 `case_revision_conflict`，于是首页没有新请求。原 native：

`tmp/optracall-host-test-pfXzqc/host/business-role-discussions/ffa9d3ca-dba6-801e-da22-530795583380/native/2026-11-27T15-26-38-324Z_01a21d9d-9cf2-777a-932d-7398a133ca9c.jsonl`

根因是 Host 在进入同一 mutate 门闩之前读取总 `caseRevision`，并行工具都捕获旧值；第一条写入增 revision，第二条在合法相互独立声明上冲突。`case-declarations` variant 没有 `executionMode:'sequential'`，不能假定官方 Pi 会串行执行这两条。Agent 的最终固定回答仍说“两项已保存”，也说明该合成 Provider 最终文本不能作为保存权威。

建议：对 Host 自行绑定的 Case 总版本，在实际 mutate 占用内核准/取得，保留模型明确的 edge/request 各自版本 CAS；或在说明必要副作用串行依据后，采用官方公开 sequential 能力窄化此工具批次。不能另建队列、改 SDK 或通过拆弱原测试掩盖合法工具组合。重验同轮两声明、与另次 HTTP 写并发、独立声明自身CAS冲突，以及取消后零首次提交。

## SRR-02 · P1：仅修订请求文字会丢失已有承担人与期限

位置：`src/agent/strategy-discussion.ts:272–282`（可选字段）、`src/host/case-issues.ts:443`、`src/host/case-store.ts:840,866–870`。

实际 Service+Store 独立复现脚本：`assignee-probe.mjs`；收据：`receipt.json`。初始请求 v1 有 `assignee={label:'原负责人',source:'原用户明确声明'}`、`dueDate:'2026-12-01'`；仅修改 text 的 v2 省略可选 assignee/dueDate，结果 assignee 两项为 null、dueDate 消失，`reproduced:true`。命令 exit 0（脚本确认复现），没有启动 Host/Pi。

Case 新工具允许这些字段省略，业务服务却强造 null，再由 Store 在普通 save 中覆盖原值。请求正文修订因此顺带擦除未要求改动的责任信息，首页原明确请求失去承担人并转待核。dueDate 同样被省略清空。应保留未提供字段；显式修改/清空使用明确合同。永久回归覆盖只改 text/target、明确改承担人、撤回/替代与原责任来源保留。

## 已独立确认关闭/可达的原问题

- **真实 Case 工具已注入。** `strategy-discussion-host.ts:75,93–96` 为原 Case owner 选择 `case-declarations` 并注入原 strategyDiscussion port；`project-session.ts:792–793` 选择窄工具 schema。真实 Pi 本次 native 的 toolsAdded 与 edge 成功回执证实它实际可调用，已不再是仅普通项目任务可用。
- **Case/事项 owner 由 Host 绑定。** `strategy-discussion-host.ts:636–669` 固定 owner.caseId、请求 owner.itemId；策略目标 Store 校验 caseStoreId/caseId，已有请求修订核对原 issueId。来源 ref 使用实际 session/request/toolCall，native 存在对应 toolCall，未发现本次可证跨 Case 写入缺口；不将未做完整 quote/hash 负例扩大为已复现越权。
- **首审的排队取消首次提交竞态已关闭。** `case-issues.ts:375–383,423–445` 在 mutate 内调用可信 assertWritable，Store 的事务前也复核。本人 `cancel-probe.mjs` 用实际 Service+Store 分别对 edge、request 持有 gate→取消→释放，均为 savedCount 0、operation null；已完成同操作在取消后可回读，保留原已提交事务。收据 `cancel-receipt.json`，exit0。此为业务提交边界测试，不能冒充 Pi 取消/配置变化/迟到完整端到端覆盖。
- **goal-draft 的 Case 目录真实供给成立。** 上述实际 Pi 运行的第一 owner 工具结果含准确本次 caseId 和两个 issueId，原生保存在另一 goal-draft native 第9行，不是 schema/mock 或 HTTP-only。但“目录真实供给”不等于首页建议可采用、来源历史复验已完整；UI 建议带入/准备 owner 持久化问题已与 UI 子审交叉确认，由其报告汇总。

## 规范与证据范围

- 当前实际依赖目录 package.json 为官方 `@earendil-works/pi-coding-agent` 1.4.0；`AGENT_SESSION_INTERFACE_VERSION=3`。累计差异没有修改 package.json、锁文件、公共 agent-sessions 或边界脚本。未发现新增 SDK 构造/会话生命周期台账/第二套模型循环。此次没有将安装目录与 npm 官方归档逐文件比较，不能扩大成整包完整性或运行服务采用证明。
- 新测试确实走真实 Host/SDK/合成 Provider，首审“仅 schema 与HTTP”已改善；但目前本次独立运行实际 FAIL。`verification/second-review.md` 的 FR05/Pi PASS 与当前可复现结果冲突，不能作为最终合并证据。
- 新 `FR05-R3-REPRO` 的标题写两种保存，但测试正文只调用 saveIssueEdge；本人的 request 取消补探针弥补本轮判断，仍建议将该负例纳入永久测试。
- `case-directory` 仍无准确 revision/hash/分页来源回执，原 sourceAccesses 不识别新目录 action；应在后续来源资格覆盖中补读取后变化/续发测试。当前没有可证跨 scope 泄漏，不以 API 缺 scope 参数直接判断越权。
- 本人没有运行完整 check/产品浏览器；完整检查由 Root 组织。二审修复后的实际 head 仍应重新固定、验证上述实际错误和适用回归，保留原 FAIL；工程 CI、用户设备采用与真实模型质量分别判断。

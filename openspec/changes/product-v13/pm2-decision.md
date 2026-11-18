# Decision Task 的原话取舍、授权和行动安排

对应 PM 对 36bd1c9 的第 1 项复核及 C7、C10、C12。Decision Task 从已接收的本次 Case 准备回执和当前 Task 的持久委托取得 Case、事项。实际用户原话、范围和选择仍由 Agent 判断，Host 核原话字节、准确版本、来源资格和当前轮次。使用统一 v1 项目 Task 会话、普通工作区和官方 Pi 的原工具调用。

| 验收项 | 结果与实际收据 |
| --- | --- |
| 事项专属 Plan 正向 | 基线在目标 Task 真正发起两次原话取舍，两次得到 `case_issue_scope_mismatch`。[原失败](../../../.local/product-v13/pm2/decision/positive-red.log) 修复后同请求重试落一条选择，归到会员事项。 |
| 同案两事项 | 原话工具和 Case 表单均拒绝串选方案。原物料行动也不能被会员事项复用或改写授权。用会员事项的当前取舍改写物料原行动时，修复前实际新增过第 2 条授权，保留该回执。[跨事项原失败](../../../.local/product-v13/pm2/decision/cross-board-red.log) |
| A 改判 B | Case 表单和 Task 均实际完成跨方案改判。旧 A 的安排此前错误创建新看板待办。[旧轮误写](../../../.local/product-v13/pm2/decision/stale-red.log) 修复后旧 A 新授权及安排被拒，B 能获得新授权并回到 B 时间线。 |
| 暂缓、不行动 | 两种入口均选择过暂缓或不行动。对应轮次通过 Case 表单、原话授权及安排均不能增加行动。Task 遗漏轮次不能将本事项的安排改记为独立工作。 |
| 原依据及准确回执 | 从另一个已关联 Project 接入 A 的原生 Plan。解除该来源关联后，Task 对同一方案新增取舍、授权、安排都得到 `project_not_linked`。该 Task 仍能按已完成的取舍和安排操作号读回原记录。恢复关联后可再次做新选择。 |
| 撤回及重试 | A 改判 B 后可从 Task 撤回 A 的准确授权。拿 B 的取舍撤回 A 的授权被拒。重复原调用保留同一操作、看板行动和引用。另一 Task 读取前一 Task 的选择操作号被拒。 |
| 兼容 | 原无事项 Case 取舍、独立 Goal/Plan 或无 Case 工作、失去确认后的 UNKNOWN/partial 与原操作重试均通过。旧版本中本 Task 曾签发的无事项授权可按原号撤回，另一 Task 和使用该旧号新增授权均被拒。[历史回归红证](../../../.local/product-v13/pm2/decision/legacy-red.log) |

在隔离 Host 通过公开产品 HTTP 创建 Case、两个事项、三个真实 Plan Task 与两个 Decision Task。三个原生 Plan 回复接回各自事项，两个 Decision Task 共发起 33 个测试请求、收到 38 个原话工具回复。本机合成 provider 只按用例发起调用，断言核原 Case/看板数据、Pi 实收内容和历史。会员 Task `db0111a9-19f3-40c1-9b92-e84910455ffd` 的初次取舍号为 `87d008e1-1343-83a7-8120-bb2d2cec2305`，初次看板安排号为 `2aa96239-1f08-8932-a778-f6c9bcce4791`。[逐次原话与回执](../../../.local/product-v13/pm2/decision/pi-6pm5nU/pi-tool-receipts.json) · [验收用例](../../../tests/pm2-quoted-issue.test.ts)

Host 在原 Task 的模型工具入口绑定事项。Case 表单与原话工具复用当轮可行动检查，取舍仍写既有 Case 事件，行动仍写既有看板。撤回必须引用原授权的同一行动和来源，后续授权、原始用户授权范围、负责人和发生事实各自保有既有历史。原话工具可以读当前轮次、自己原请求的操作号。[Task 绑定](../../../src/host/server.ts) · [Case 检查](../../../src/host/case-issues.ts) · [原话适配](../../../src/host/quoted-decision-adapter.ts) · [看板撤回](../../../extensions/business-plugins/decision-board/storage/store.ts)

涉及项联合回归 39/39，类型检查和统一会话边界检查退出码均为 0。本专项只核合成实例的原话及经营记录，真实商业模型表述质量、经营行动效果和用户产品验收仍待相应验证。兼容回退沿原软件候选、既有 Case/看板存储与操作号，新增字段为可选，不需要迁移或重放用户操作。[回归](../../../.local/product-v13/pm2/decision/closed.log) · [类型](../../../.local/product-v13/pm2/decision/types-closed.log) · [边界](../../../.local/product-v13/pm2/decision/boundary-closed.log)

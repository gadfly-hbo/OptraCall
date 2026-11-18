# Decision 交给 Do 与旧轮次 Teach

批准依据为框架 v0.8 C7/C10/C12、规格 v0.3 与 36bd1c9 的 PM 复核。交接和保存均由人确认。沿用现有项目任务和事项入口、原 Case 取舍、看板行动授权和反馈、Interface v3 的 project-tasks owner 及两上游角色对话。

| 范围 | 核验入口 |
| --- | --- |
| 项目内 Decision 准确成果交给 Do | 项目任务抽屉、创建 POST 和 Pi 首发；分别检查零个、唯一、多个当前行动、已撤或换轮的旧凭据、无事项独立 Do |
| 有新轮 B 后完成旧轮 A 的 Teach | 在 A 行按原观察准备 Teach，按原回复保存 A，核 B 原记录与两上游实收；另核丢回复读回、无观察与已结束 Case |

## 实施与逐条结果

1. **项目内 Decision 交给 Do。** 在项目任务的「交给下一 Task」选准确成果，表单读取同一 Case、同一事项的当前取舍和当前项目原看板授权。只有一项时直接显示行动和范围，多项时由人选具体行动。零项、已撤回或过期的选择显示原因。创建及新的实际发送继续核验来源事项、取舍、项目及有效授权，原创建操作的重复读回先于新写检查。独立 Do 可直接登记线下已发生的事实。Chrome 既验证了两个授权并存时的选择，也在表单打开后撤回授权，随后创建返回 409、保留输入、模型请求增量为 0。获准的第二轮首发实际包含准确 Plan 原回复、取舍理由和所选范围。[项目入口实收及请求编号](../../../.local/product-v13/pm2/rounds/chrome-receipt.log) · [选择多项授权](../../../.local/product-v13/pm2/rounds/choose-authorized-action.png) · [原 Case 入口复验](../../../.local/product-v13/pm2/rounds/case-entry-chrome.log)
2. **旧轮 A 的迟到 Teach。** 时间线每一轮在自己的原观察下提供复盘表单。同轮存在多条观察时，准确 Teach 回复还按其原观察版本筛选；历史回复未固定观察版本时，现有服务仍核对人选的本轮准确反馈。Chrome 先形成 A 的原看板观察，随后选 B，再从 A 发起 Teach、保存回 A，并由 A 分别向目标和战略发起真实 Pi 请求。两个接收请求均含 A 的选择、反馈版本、Teach 消息编号及原文。回读时 B 整轮逐字段相同。同一操作读回原结果，改操作号再次保存被拒。B 缺观察时保存被拒；Case 结束后仍可回看，新增复盘写入被拒。[原轮画面](../../../.local/product-v13/pm2/rounds/original-round-review.png) · [两上游实收与原操作](../../../.local/product-v13/pm2/rounds/chrome-receipt.log)

## 基线、兼容与验收边界

- 从 Git 归档独立取出产品提交 `36bd1c96a42b3d8ff56a4593fead6af7aae3545f`，同一组检查在基线产生 3 个预期失败。无授权的项目交接返回 201；项目弹窗缺少未授权状态，旧轮时间线无法选择自己的 Teach 保存。修复后新增 Chrome 2/2、原 Case Chrome 1/1、受影响 Host/Pi 5/5 通过，TypeScript 检查通过。[固定基线](../../../.local/product-v13/pm2/rounds/red-identity.txt) · [原始失败](../../../.local/product-v13/pm2/rounds/fixed-36bd1c9-red.log) · [受影响回归](../../../.local/product-v13/pm2/rounds/affected-final.log) · [类型检查](../../../.local/product-v13/pm2/rounds/typecheck-final.log)
- 在旧候选的隔离根创建并实际发送过缺授权的 Do，关闭旧 Host，用新候选直接只读回原任务及原答复。对同一历史 Task 新发返回 409，模型请求无增加。继续行动时可从原事项选当前有效授权并手建新的 Do；既有原件、任务标识和原生会话沿原位置读取，本次无数据迁移。[兼容实测](../../../.local/product-v13/pm2/rounds/legacy.log)
- 本地合成 Provider 用于核对实际 Chrome、Host 和官方 Pi 的接收内容。真实业务的执行效果、自由模型判断和用户产品验收待另核。作者验证与固定候选上的整仓检查、非作者复核分别记录。

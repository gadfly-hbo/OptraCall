# Issue #149 最终 head UI 接受复核

- 固定候选：`a571245698d432d39e3fbdbcfee423ebc06fd919`，核对 HEAD 正确、工作树 clean。
- 比较已通过 UI 复核的 `be1fd36ad449d89d2fc21655ccbbb61cf8b6bdbf`，独立读取全部新产品／测试 delta，未改源码、测试、依赖或既有证据。
- **最终结论：UI／相关四原则专项通过，可合并；本次后端生命周期派生没有使原反馈或待处理 UI 语义失配。** 7fe 原 FAIL、be1 修后 PASS 均保留。

## 实际相同的 UI 与证据归属

独立核对两个完整 Git 子树身份：

| 产品 UI 子树 | be1 与最终 head 均为 |
| --- | --- |
| `src/host/ui` | `2edf4a22ca850475160ffd8b605ca2cecb685876` |
| `extensions/business-plugins/decision-board/ui` | `03179c558b74ae0f80d170da6c060f5a871b306b` |

因此 [be1 最终 UI 报告](ui-final-review.md)、[从 be1 新源码隔离构建的 21 步真实 Host／Chromium PASS](afterfix/ui-probe-receipt.json)及原本人真实三创建分支证据，对相同的 UI 源码仍适用。**这些实际浏览器收据仍绑定其原候选；本报告没有宣称对 a571 全量重跑浏览器。** 本次另外独立执行了最终 head 的 UI 状态消费检查，见下文。

## 本次 delta 对原 UI 语义的核对

- 未答 choose 请求在原 Case 已关闭或原方案当前版已归档时派生为 `superseded`，与原选择入口的实际不可写准入一致。精确已经回应的历史先判 `answered`，不会因后来闭案／归档重变成待办；新请求也沿当前版归档准入拒绝。
- 未答 observe 请求使用原项目 active 准入：归档项目派生 `superseded`，项目资格不可读派生 `unverifiable`；首页与 Case 请求读取均注入相同原资格。准确已答观察在这些后续 active 检查前保留原结果，未新建完成权威。
- **Case 关闭或 Board 行动 done 本身不禁止原来仍合法的 Board 观察回应。** 该路径保持原 Board 权威，未把取舍的 Case 关闭规则泛化到观察；项目恢复只恢复真实可操作状态，不回放反馈。
- 原 Home 消费 `open` 为正式待处理，`superseded/unverifiable` 进入已替代／待核分组，保留原请求文本、身份与来源而不写作已完成。原反馈表单保存前重读准确请求，`superseded` 不再获得回应引用；业务准入失败仍保留输入。
- 浏览器原观察测试把“另一条未选请求”从 `open` 改为 `superseded`，对应准确反馈基线已变化；仍明确断言只有选中的请求是 `answered`。Case 会话工具断言从空工具改为唯一 `strategy_goals`，对应已确认 owner 限定声明工具；没有改成接受任意工具。新增 active 项目夹具用于满足原资格，未放宽产品 gate。

## 最终 head 独立状态消费检查

命令：

```sh
/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node .local/pm-final/ui-accepted-projection.mjs
```

exit 0，[收据](ui-accepted-receipt.json)／[日志](ui-accepted-projection.log)为 **6 项 PASS**：实际 UI 子树身份相同；只有合法 open 保留 pending；未答失效请求保留原文／来源进入 unresolved；已答历史不被重新列为 pending/unresolved；资格未知保持待核；原反馈 editor 拒绝 superseded 请求引用。该检查执行真实投影／反馈验证函数，使用有限合成状态输入，不冒充真实 Store／HTTP 或新 head 浏览器运行。后端当前资格派生的真实 Store／原反馈 handler 另由后端独立专项核定。

## 四原则与结论范围

- **Host 管环境：通过。** 新增的是原生命周期准入与状态投影，防止不可回应请求冒充正式待办；不补业务判断或伪造完成。
- **Agent 自主执行：通过。** 无新增分析方法／步骤／确认门槛；合法原反馈仍按原权威可执行。
- **优先复用 Pi／既有权威：通过本 UI 专项。** UI 子树完全相同，原 Case／Board／项目资格、请求引用和公共生命周期继续复用，无新增 UI 会话循环或完成库。
- **减少人的操作：通过。** 已答历史不重新待办，不能回应的请求退出正式 pending；不要求用户再手动标记完成、清理或搬运输入。

完整 `npm run check`、后端／Runtime 独立专项、准确 head CI 与 Git 交付由 PM 分别核对；本报告不替代真实模型质量、设备采用或用户产品体验验收。

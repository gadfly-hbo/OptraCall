# Issue #149 最终产品 UI 增量独立复核

- 固定完整候选：`be1fd36ad449d89d2fc21655ccbbb61cf8b6bdbf`；树 `47d929f94a6d1504c9a044ef7f1d0b5943e3c9a1`。开工及复验后均独立核对 HEAD，工作树 clean。
- 复核者未参与任一候选实现；源码、测试、依赖、规格只读，仅写本目录隔离 bundle、浏览器探针、收据及报告。已按原报告读取工程规范第 2–4 节、冻结 spec/Demo、二审报告；本次完整读取 `7fe8e93..be1fd36` 增量，包括 UI、目录 HTTP/Agent DTO、请求状态和 Host 接线，结合原 `699e425..7fe8e93` 复核。
- 冻结 Demo 再次回读 SHA-256 仍为 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`。
- **最终 UI 结论：通过，可合并。原 FUI-01 已由独立真实产品浏览器反例复验关闭；未发现新的必须修复 UI 缺陷。原 [7fe 报告](ui-review.md)及其真实 FAIL 完整保留，不改写历史。**

## 新候选实际运行身份与结果

本人从新候选源码编译独立实际 React 产品 bundle，没有使用工作树 `dist`。构建元数据及每文件哈希见 [afterfix/ui-dist/optracall-build.json](afterfix/ui-dist/optracall-build.json)，commit 为上述 be1fd36，主 bundle SHA-256 为 `c974b8e5f4c0b37783fa9789f2f9a65d8738827c371faa3ce2a55b563b636de9`。

独立命令：

```sh
/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node .local/pm-final/ui-afterfix-probe.mjs
```

探针使用真实 `createHost`／HTTP 和 `/usr/bin/chromium`，仅隔离合成资料及不可用的合成模型地址；没有真实 Provider 调用。最终 exit 0，[afterfix 收据](afterfix/ui-probe-receipt.json) **21 步 PASS**；[完整日志](afterfix/ui-afterfix-probe.log)。记录的 `/api/business-role` POST 为 **0**。

## 原 FUI-01 关闭证据：范围、来源与原项目能力

完全重建原真实反例：共享项目 P 明确关联 Case A/B，TA 准确绑定 A/a，TB 准确绑定 B/b，TC 没有 Case 绑定。

- A 当前事项只显示 TA；切“全部当前 Case”仍只显示 TA，`foreignTaskShown:false`，不显示 TB 或 TC。不是隐藏／迁移原任务，实际只修 UI 范围投影。
- TA 行显示真实原 Case 名称＋完整 caseId、原事项名称＋完整 issueId，原输入中的 HTML 文本安全展示。
- 点击“打开原项目（全部任务）”，实际原 ProjectBoard 中 TA、TB、TC 三类任务全部可读，两个关联 Case 保留。
- 从原项目回到 A，Case 项目与任务栏目及手选“全部当前 Case”范围均恢复；不默发模型请求。
- 390 宽度实际来源行可读、折行与页内滚动正常，没有页面横溢出；人工检查 [来源行截图](afterfix/ui-shared-source-390.png)。

因此原 DW04/05 失败已经关闭，DW06 原项目全局能力及返回链没有因过滤修复而被删减。静态核对 `caseTasksInScope` 同时覆盖准确 Case／事项过滤，未绑定与别案任务不改写；无本案任务时显示明确空态，原项目按钮不以“范围内有任务”为准入，零任务项目仍有原入口。

## 新目录分页：真实页控件不丢选择

使用真实 API 建立总共 23 个 Case，目标 Case 有 7 件真实事项；每个 Case 使用准确已采纳 G/S，未伪造 Case 数据。

1. Home 查找首批实际显示 20 个 Case，目标 Case 显示前 5 件事项。
2. 明确选中目标原事项，再点该行“读取更多事项”：实际合并至 7 件，无重复／丢失，原选中 issueId 保持。
3. 点“读取更多 Case”：实际合并至 23 个 Case，目标行仍保留全部 7 件事项、准确选择及原轻输入。
4. 从此已分页目录点“带入所选事项”，真实 carry-over API 回读的 targetCaseId/targetIssueId 与原选择一致，新输入完整保留；导航仍保持原 Case 栏目，切当前工作能回读新增片段。

静态检查确认：按 caseId/issueId 合并整行，不用标题或顺序推断；新意图／新目录 generation 使迟到页失效；403 清目录内容与入口，失败不清准备文本；分页控件只读，不生成 Case、目标采用或消息。分页/精确读取仍沿原目录工具，未新增搜索模型循环。没有依赖作者 16 项准备或 22 组 DOM PASS 来替代以上本人实际运行。

## 受影响原链回归与保留边界

21 步中同时重新执行：Home 准备准确目标／策略、名称背景持久，真实创建 Case 与第一事项，完整来源片段；真实非空 composer 追加防重、编辑后 Host 草稿回读；清 sessionStorage 后 reload 恢复实际 composer；XSS 未执行；390 布局、20 次 Tab 焦点；单个原详情 GET 的 503 保留并标旧快照、403 清内容和入口、恢复读取不重发。

原报告已经有本人真实浏览器的三种创建分支（新候选明确采纳创建／准确已采纳 G/S 新建／已有准确 G/S 继续）和输入保全证据。本增量未修改创建保存、采纳与 composer 算法；新增目录页控件及原项目范围均由本次新包重跑。真实 Agent 候选内容质量、Pi 配置／迟到／取消及服务端请求来源权限由 Runtime／后端独立专项分别核定，不冒称为本 UI 探针的运行成果。

本次两个先行自有探针错误分别保存在 `afterfix/harness-retained-column-error.json`（未先切回产品正确保留的栏目）和 `afterfix/harness-await-linked-cases-error.json`（未等待异步关联 Case 行）。修正的是探针等待／定位，未改产品或测试，未把这些当产品 RED。最终收据是上述 21 步 exit 0 的独立运行。

## 四原则专项最终检查

| 原则 | 本次 UI 与受影响接缝结论 |
| --- | --- |
| Host 管环境 | **通过。** 按真实 assignment、owner、版本／回执和原权限结果投影，修复共享项目误归属；来源与输入持久化属于 Host 环境职责，不猜业务归属或效果。 |
| Agent 自主执行 | **通过。** 目录分页仍是 Agent／用户可选的准确只读资料，推荐、方法和工具选择没有转成硬编码业务流程；浏览及分页不自动发消息／采纳／授权。 |
| 优先复用 Pi | **通过本次 UI 专项。** UI 沿原 BusinessRoleConversation／goal-draft／Case owner，目录仍接原工具、消息和公共生命周期；无新增平行会话库／UI 模型循环，依赖及锁文件未变。实际 SDK 生命周期由独立 Runtime 专项另证。 |
| 减少人的操作 | **通过。** 本案任务范围正确且行内可核原归属；原项目全部任务一键可达并可返回原栏目；只有目录超过当前页才按需展开，加载更多不要求重新选择或搬运输入。 |

本报告支持该固定候选的 UI／相关四原则专项可合并结论。完整 `npm run check`、其他独立专项、准确 head CI 及 Git 工程交付仍由 PM 分别核对；本报告不代表真实模型质量、设备采用或用户产品体验验收。

# 作者检查与原失败保留

最终候选 g 的完整检查已退出0：[完整日志](candidate-g-full-check.log)、[状态与命令](candidate-g-check-status.json)。运行所有 `npm run check` 组成项，测试文件并发限定4，无测试过滤；3,686项中3,490通过、0失败、196原条件跳过，类型/正式构建和高危级别审计通过。审计保留官方Pi1.4.0链中的2项既有 moderate，未改依赖。本目录不把相邻版本的结果拼接成一次完整 PASS。

| 证据 | 准确含义 |
| --- | --- |
| `full-check-first.log` | 首次完整运行 3612 项，3414 通过、2 个 Host 启动超时失败、196 原条件跳过。原运行仍为失败。 |
| `full-check-failure-recheck.log` | 原两个失败测试串行复跑 2/2 通过；未改变产品、测试或超时。 |
| `candidate-c-*` | 历史 c 的边界/构建以及169项受影响测试；不代替 g 完整检查。 |
| `navigation-v5.log` / `navigation-v6.log` | v5末尾断言仍期待场景编辑前文字；保留失败。仅改正该测试期望，v6 25/25 通过。 |
| `candidate-e-check-status.json` / `candidate-f-check-status.json` | 运行中发现实际产品焦点问题后取消并保留部分日志；源码变更后的候选另行完整检查，不算完整通过。 |
| `home-requests-e.log` | e 首页选择入口关闭后焦点错误的作者实测。 |
| `home-requests-f.log` | f 每轮重新加载页面的4项通过，覆盖不足以证明连续 SPA 操作。 |
| `home-requests-f-spa-red.log` | 加强 SPA 脚本第一次 observe 被嵌套 summary 的 strict locator 错误阻断，未到焦点断言。不能称作焦点 RED；真实 f BODY 焦点失败见非作者原证据。 |
| `home-requests-g.log` / `home-request-navigation/candidate-g/receipt.json` | 修正直接子 summary 定位后，真实 App/Host 两种请求各三次 SPA 进入/退出共6项通过；observe 包含来源展开/收起、三尺寸切换后关闭的焦点检查，并非逐尺寸各做一次 Esc。无业务写和页面错误。 |
| `focus-return-g-tests.log` / `focus-return-g-typecheck.log` | 40项受影响测试及类型检查通过；不是实际焦点结果的替代品。 |
| `navigation-f.log` / `navigation-final-f-receipt.json` | 25项组件导航/范围/来源/草稿失败恢复检查；有界 HTTP 场景，不作为真实 Host 截图。g仅增加反馈焦点ID透传，此证据按未变源码复用。 |

原失败、取消、跳过和已知限制在各自报告中保留。独立证据见相邻目录，不将作者检查称为非作者复核。

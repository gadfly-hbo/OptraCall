# Issue #149 原请求 UI 修后最终独立接受

- 固定 source 候选：`2eb30a51e31333a4252d4b6564bb0ad3a66326b8`。
- **结论：UI／相关四原则专项通过，可合并。FUI-02／03 已由原真实反例修后独立验证关闭；未发现本次聚焦 delta 的其他必须修复项。** 原 [6bc7 双缺陷 FAIL](ui-response-followup-review.md)、原收据和首用限定 PASS 全部保留。
- 复核者未参与产品实现；产品、测试、作者文件及原固定源只读，只写本人 `.local/pm-final/` 隔离快照、bundle、探针与报告。

## 精确候选与实际进程身份

按 PM 明确允许的固定文件清单模式，实际验证先从 `6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb` 提取 `src/extensions` 源码快照，仅覆盖冻结的 `CaseIssuePanel.tsx`，编译自有实际 React bundle。真实 Host 后端仍运行原 final 工作树的 **6bc7**，未更换为 2eb checkout。

[作者冻结清单](response-overlay/author-manifest.json)产品文件 SHA-256 为 `d331165f038a5ac09042bf1cea0e72395ead14eefd9e2554943629c9591c8799`。运行前后独立快照和作者原文件均保持此值。随后独立核对：

1. `6bc7..2eb` 的生产 `src/extensions` delta **只有同一 CaseIssuePanel**，2eb 的 `git show` 文件 SHA-256 完全相同；后端没有 delta。
2. 2eb 回归文件 SHA-256 为清单指定的 `668ce0ba804ade4a43c20ca4f62e047777f135fa49a1802ec46d8d41ad7a40cb`。
3. 其他两处提交差异仅为测试的 await-rejection 及精确 PID＋start-time＋Z writer 退休判断，未增加生产行为或放宽反馈权限。

故上述真实运行可按**完整生产源码字节等价**绑定 2eb source 候选。详见 [commit-binding.json](response-overlay/commit-binding.json)和 [实际 bundle 元数据](response-overlay/ui-dist/optracall-build.json)。这不是声称 Host 进程曾运行 2eb checkout，也不改写最初 bundle 的“基线＋overlay、构建时未提交”身份。

## 独立实际浏览器结果

命令：

```sh
ACCEPTED_HEAD=6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb /workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node .local/pm-final/ui-historical-request-overlay.mjs
```

最终 exit 0，[真实 Host／HTTP／Chromium 收据](response-overlay/receipt.json) **7 步 PASS**；[日志](response-overlay/browser.log)。原同一合成 fixture 经公开 Store 保存方案 A v1／活动 v2、精确 A 请求及 B 的独立当前版单请求；没有改数据库内部行或伪造保存结果。

- **FUI-02 关闭：** Home 原 A 请求的方案选择精确区分 `recordId@1` 与 `recordId@2`，明确显示原请求历史 v1／当前活动 v2。填写理由后，未勾历史确认时原保存按钮禁用、无写入；明确勾选后，实际原 choice POST 携带 `allowHistorical:true`、v1 strategyRef 和准确 requestId/revision，原 A 请求 answered。
- **FUI-03 关闭：** 从 A 入口侧栏明确切 B，B 当前版单请求恢复准确匹配；无需历史 checkbox，实际原 choice POST 不含 allowHistorical，却带 B 的准确 respondsToRequest，B 请求 answered。没有把 A 焦点或请求引用带到 B。
- **准确版失权负例：** fresh Home 读取已存在的请求 C，对其准确历史 v1 GET 注入403。即使列表仍有活动 v2，UI 不代选 v2、不展示失权 v1、原提交保持禁用；用户填写理由仍未产生新 choice 写入。见 [失权 UI 截图](response-overlay/historical-afterfix-exact-denied.png)。
- 全程 **business-role POST 0**，只有上述两次用户明确 choice POST。首段再次走过“空 Case 总览→Home→人工首建／首事项”，未要求先启用管理设施。

为使断言对应已完成的实际 UI 状态，最终探针等待 A／B 原轮次刷新完成后切换；403 负例在 fresh Home 对已存在 C 请求运行。先行未完成的定位运行分别保存在 `response-overlay/harness-*`，没有删除或当作产品 RED，也未计入最终 PASS。

## 四原则终检与交付边界

| 原则 | 本次源码及实际运行结论 |
| --- | --- |
| Host 管环境 | **通过。** 读取、显示并提交准确版本／请求／事项身份；失权不换 latest；仍由原服务决定资格。 |
| Agent 自主执行 | **通过。** 只修人的原取舍 UI，不增加模型触发、分析步骤或业务判断。 |
| 复用 Pi／原权威 | **通过本 UI 专项。** 使用既有 exact client、原 choice API、allowHistorical 与 respondsToRequest，无新后端规则、会话循环或完成库。 |
| 减少人的操作 | **通过。** 不需改请求、手搬版本或调用 API；只有明确历史版需要原历史确认，B 当前版没有新增确认门槛，切事项不需返回 Home 重找入口。 |

2eb 除这一已测 UI 外的生产字节与已复核 6bc7 相同；此前新首用正常／丢回执恢复、同事项片段／composer、共享项目范围与目录分页等证据保留各自原身份，不冒称新 head 全量重跑。完整 npm check、后端／Runtime 专项、准确 head CI 和 Git 交付由 PM 分别核定；不代表真实模型质量、设备采用或用户产品体验验收。

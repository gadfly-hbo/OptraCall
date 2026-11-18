# 管理工作区与按版本导出

开工核对为开发包清单 56/56 项通过。approval.md 用于确认的 Demo JS 摘要文字缺位，包内 demo/dist/assets/demo.js、包清单、审核前原始 JSON 回执及原 live-ui-demo 文件四者的完整 SHA-256 均为 `9a8520222e9c2775813a84a2d320d0f87c02c3f30c02a30bd0d48c06e48243c2`。原件保持原貌。

| 需求与接缝 | 实施与已获证据 |
| --- | --- |
| 战略讨论 → 保存稿 → GSA | 原生会话条目、会话身份和正文 SHA 经 Host 复核。战略稿与原讨论修订号在同一原子写入中固定，重复稿返回原版，显式交接后记录目标草稿身份与接收范围。`tests/product-v13-version-exports.test.ts` 使用实际 Host、Pi 和本地协议夹具核对同文幂等、旧修订冲突、两版回读与交接状态。 |
| Goal 与准确正文 | 用户在 GSA 原表单独立创建、修订、采用；已交接稿可带准确版本及原生来源建立新候选。导出再次读取原目标、采用状态、当前可读的同版行动和检查安排及依据，导出前后业务数据不变。 |
| 工作台入口 | 战略／目标各四步、独立三组侧栏折叠；Studio 语义和分析各有页签，共用原企业/体系/专业界面与离开保护。设置复用原业务模型注册表与导入动作；领域资产包为空。已在正式 App 及独立 Host 做 Chrome 点验。 |
| 放大对话 | 使用同一 React portal 容器移动原内容，保留请求、输入和对话 DOM；Esc 收起并恢复焦点，显式停止仍走原 owner。战略草稿在浏览器完成展开、收起、发送。 |
| 两种离线 HTML | 隔离浏览器向战略 Agent 发送，保存两版文稿，回到 v1 重新下载。原 Goal HTTP 产生两版隔离素材，浏览器各选准确版本下载；浏览器断网读取，逐项核对所选版和排除另一版正文。 |

原始证据位于工作树 `.local/product-v13/`。导航的首个 RED 为缺少「战略选择」；`navigation-current.log` 为实际导航、设置、资产入口的 GREEN。`exports-red.log` 的两个 API 均返回 404；`exports-green.log` 验证补齐后响应。`gsa-source-red.log`、`gsa-source-green.log` 是战略准确稿进入 Goal 存储的增量。`downloads-run1.log`、`downloads/` 保存离线结果。`ui-regression.log` 保留 31 项界面回归。`check-first.log` 保存开发阶段完整检查的五个初次失败，须与最终固定候选结果分读。

五个专业候选已放入既有 MacBook skill-eval 仓库的 pending/，文件逐个按 SHA-256 回读，见 `skill-eval-pending.json` 及现有 CLI 的 `skill-eval-directory.json`。传送范围仅五个测评候选，不变更产品试用目录或服务。独立测评及用户确认的回执另记。

固定首审代码的独立根再次完成六项导航、两种文稿各两版下载及旧版复读、目标/项目/任务/PPT/Studio 原输入节点与草稿的展开收起，见 `fixed-navigation.log`、`fixed-downloads.log`、`fixed-drawers.log`。战略对话的原草稿在同次下载检查中展开、收起后发送。Case 事项抽屉在 `case/browser-case-drawer.log` 验同一输入、草稿、焦点和零写入。七个入口均指向原会话。战略原生依据移出时，两版战略导出及其下游 GSA 导出均拒绝，原 owner 字节不变；恢复同一依据后原版可读。见 `export-source-loss.log`。Case 对应看板权限解除时的 GSA 导出拒绝及恢复证据见 Case 分项。

另核独立折叠状态：同时切换主导航、项目空间及已归档项目，另外两组的开关状态保持（`nav-three-groups.log`）。在普通 Task 抽屉中点「打开项目文件上传」会收起抽屉并打开原项目文件栏，原 Task 草稿保留（`drawer-file-return.log`）。GSA 表包含 Goal Agent 字段建议所对应的讨论、原生会话、条目与 SHA，见 `goal-export-suggestion-red.log`、`goal-export-suggestion-green.log`。

语义资产、分析资产均从正常侧栏选择同一企业，进入体系工作台后核对了同一体系 ID。语义原文的已保存指标链接准确打开 membership-repurchase@1.0.0，即使库内已有 1.1.0。Chrome 无页面错误，相关 Studio 回归 19/19，分别见 `.local/product-v13/studio-scope/receipt.json` 和 `related-regression.log`。

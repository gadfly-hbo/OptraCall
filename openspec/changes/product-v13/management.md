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

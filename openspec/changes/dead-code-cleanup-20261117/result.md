# 墓碑代码清理记录

记录时点：本地工程候选完整检查及非作者复核通过；Git／CI 和运行采用按下文后续收据分别核定。

本次依据 [spec.md](spec.md)，从最新 main `8597b7f8b9a07f516d8b39508c48047728582548` 重新核对，不直接沿用旧 `9607e53` 的扫描结论。

原始检查、命令日志与后续采用收据保存在 Mac mini 本地 `.local/dead-code-cleanup-20261117/`；公开记录只保留不含凭据和业务内容的工程摘要。

## 重新扫描

当前图谱不能完整覆盖新增代码，候选均另核对实际源码、tracked 引用、动态入口及测试。锁文件安装补齐了上次只读扫描所缺的本地依赖；依赖声明和锁文件不变。增强未使用诊断用于发现候选，不把历史测试中未使用的回调参数当作普通类型检查失败。

## 清理范围

1. 删除无入口的 `CatalogPage.tsx`（76 行）及旧演示状态模型 `chat-state.ts`（91 行）。当前 App、项目／任务、设置及接入规划入口不改；`catalog-data.ts` 和当前消费者原样保留。
2. 删除旧 `MemoryConfiguration`、`ConfigurationError` 及仅供旧类使用的 `PublicConfiguration`。`ConfigurationInput`、`RuntimeConfiguration` 和仍被实际连接探针使用的 `AgentRuntime` 保留。删除已脱离现用 owner 配置解析路径的 `refinerConfiguration`，现用 PPT 配置和兼容处理不改。
3. 删除无生产消费者的四个包装：`readStudioContributions`、`strategy-goals-client.get`、`readProjectDataEvidence`、`model-pack-client.getModel`。保留现用 Studio／目标接口、固定字节读取／文本解码组合、`getModelDetails` 和全部实际服务端路由。
4. 删除六个未使用类型：`QuotedDecisionPort`、`AnalysisDeliverySaveReceipt`、`AutomaticActionSettingsStore`、`AutomaticVerificationStore`、`FeedbackFileInput`、`ProjectPlanStore`；并清理原扫描中的 12 个未使用 import binding，以及删除包装后失去消费者的 `StudioContribution`、`StrategyGoalRecord` 两个 import binding，共 14 个。实际工具、回执、Store 和公开 `AgentSessionPort`／Interface 版本契约保留。
5. 删除旧 Catalog 独占、`task-analysis-options`、`sap-assets-workspace/tabs` 和 `sg-toolbar` 的 80 条 CSS 规则或 selector 片段。共享 catalog tabs/dialog/symbol、详情、Skill 测评、decision 页面、混合 media 内的现用规则全部保留。

上述清理不修改数据格式、依赖声明／锁文件、SDK 接入、分析方法、工具权限或必要的人机操作。现用 UI 源码和共享目录数据的 SHA-256 保持；正常界面没有新入口或布局变化。

## 测试去留与保留事项

共移除 18 个只测试被删旧实现的用例：旧聊天／项目演示 reducer 的 14 个、内存配置的 3 个、旧 PPT 配置 helper 的 1 个。前端 14 个用例含 55 处静态 assert 调用位置；这不是运行展开的断言次数。当前配置持久化／快照／地址和凭据隔离、项目多任务／草稿／停止／失败／真实结果判定、PPT owner／legacy／配置绑定的测试均保留，未把旧演示项目限制或旧事件协议重新带入产品。

`duckdb-ui` 的 BOM／CRLF／emoji 坐标及准确版本 GET 三个原断言迁至现用 bytes＋text 组合；`model-pack-client` 的名称／准确 name/version URL／GET 三个原断言迁至 `getModelDetails`，原断言意图和数量均保留。完整承接映射在本地 `frontend/result.md`、`backend/receipt.md`。

`tests/browser-catalog.js` 包含有价值的设置、个人资料、PPT、布局、草稿和取消永久回归，完整保留。其旧导航入口在清理前已陈旧，本轮未运行或重写该脚本，也不把历史 PASS 当成当前通过；删除无生产导入的旧页面不会新改变它的可达性。此既有测试维护事项不扩为本轮新功能。

主动保留的 PostgreSQL v0.4 历史证明 helper、语义试用／采用夹具、动态连接器和 Skill 入口、旧规格及失败证据不按零生产引用删除。未使用增强检查中原有的测试回调参数等诊断保持独立记录。

## 验证

| 检查 | 实际结果 |
| --- | --- |
| 固定基线受影响 13 文件 | 143 tests／143 pass／0 fail／0 skip；独立基线工作树，避免作者编辑竞态 |
| 后端清理后 16 文件 | 204 tests／204 pass／0 fail／0 skip |
| 前端清理后 4 文件 | 38 tests／38 pass／0 fail／0 skip；常规 typecheck 同时通过 |
| 完整 `npm run check` | 2,913 tests／2,802 pass／0 fail／111 条件 skip；会话接入检查、类型检查及生产构建通过 |
| 依赖审计 | `npm audit --audit-level=high` exit 0；原 2 moderate 保留，不执行可能升级 SDK 的强制修复 |
| 增强未使用诊断 | 产品 `src` 诊断已清零；整体仍因原 19 条测试代码诊断 exit 1，不记为全量通过 |
| 文件与范围 | `git diff --check` 通过；package.json／package-lock.json／SDK 入口字节不变，完整检查期间生产／测试源码无后续修改 |
| 构建对照 | 与同基线在用构建的 JavaScript 字节／SHA-256 完全一致；CSS 从 214,472 降至 207,820 字节，减少 6,652 字节 |

构建保留现有大 chunk 提示，不把构建警告扩为重构任务。完整检查使用隔离合成路径，没有真实模型、业务材料或 MacBook 操作。111 skip 不表述为已执行。

## 独立复核与四原则

全新非作者以完整固定候选、规范／规格、动态及共享边界、删测理由和实际检查证据复核，规范、规格、四原则专项均 PASS，无剩余阻断项；独立定向 115 tests／115 pass／0 fail／0 skip。原始记录保留在本地 `independent/REVIEW.md`。两处记录发现（已完成清理项未勾选、12 项原扫描导入与 14 项总删除的范围说明）均已修正并独立读回。

复核确认全部 30 项源码／测试与冻结清单一致，80 个 CSS 片段及 18 项旧自测去留的依据成立。Host／Agent 职责和统一 SDK 路径不改，无新增流程、运行循环、权限或用户操作。浏览器、真实模型、CI 和运行采用没有被独立静态／定向 PASS 替代。

## Git 与运行采用

工程候选、PR head CI、合并 main push CI、服务安装及实际运行分别核定。交付执行跟进保存在同任务的本地 `delivery-progress.md`／`delivery.json` 与 PR；这些后续结果不由本记录提前宣称成功。

更新采用新建固定 main release、原 launcher 及同一 data/projects/state/semantic 配置。原 release 保留供同数据格式下回退，不用旧备份覆盖新资料。停前／停后／启动后的内容清单、生命周期变化、外部语义资产、Desktop 入口及 HTTP 资产核对另存 `adoption/`。真实模型质量和用户产品验收不在本次工程清理结论之内。

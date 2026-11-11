# 分析框架覆盖复核实施记录

2026-11-11，沿用户已审核的 spec / 流程演示实施，第 1、2 项现有本地候选保持。基线为 `codex/data-analysis-flow` 的第 2 项最终文件清单；开工前 53 份 WIP 字节副本与摘要位于 `.local/report-framework-coverage-review/before/` 和 `before-manifest.json`。批准 spec 与演示不改字节。

## 目标与阶段任务

- [x] 读取规格、演示、工程规范 v1.10、统一会话接入说明，核对分支、占用及既有 WIP。
- [x] 固定本轮实际送入框架 / RAP 的版本、内容范围与可读资格，不补造当前全文。
- [x] 在第 2 项同一次前台委派内补齐覆盖意见和主 Agent 自查契约。
- [x] FCR-A1：遗漏定位、另存补齐、同要求自查、一次委派与历史原稿。
- [x] FCR-A2：待补证、等效方法、保留有依据原稿。
- [x] FCR-A3：无框架、目录 / 部分内容、身份不明、撤权、新版及计算继续；历史预算及不可读近限 P2 已修复并独立关闭。
- [x] FCR-A4：取消 / 迟到结果、实际版本回读、不自动再跑或放行。
- [x] 相关回归、完整检查和固定候选非作者 Standards / Spec 双轴复核。
- [x] 回填总进度，通过第 4 项后推进第 3 项。

## 接入与范围

沿 Interface v3、原 `project-tasks` owner `{projectId, taskId}`、原父请求、官方 Pi 1.4.0 的前台子会话和工具回执。复用已存在的固定材料存储、权限重验、原生历史和公共取消，不新增生命周期台账或自动委派。Host 只交付准确授权材料与回执；子 Agent 判断覆盖，主 Agent 核实处置并用同一要求自查。用户必做新增操作为零，无产品 UI 变更。

源码范围为原计算复核的材料、意见契约及相应检查，必要的框架实际交付只读接线。保留前两项原失败、UNKNOWN 与所有原件；不改变 SDK / 依赖、不使用真实业务资料或真实 Provider、不切换服务或操作 MacBook。工程验证与专业效果 / 用户验收分别记录。

## 验证进度

证据集中在 `.local/report-framework-coverage-review/`。合成 Provider 验证实际 Host / Pi 材料与工具回交，意见语义采用固定场景，不将其当真实模型专业效果。

| 验收 | 当前证据 |
| --- | --- |
| FCR-A1 | `tests/report-framework-coverage-flow.test.ts`：确认框架版本、实际文字摘要一致；遗漏品类可定位，另存修订、同要求自查，初稿和意见仍归原版。`flow-first-green.log` / `host-runtime-regression.log`。 |
| FCR-A2 | 同一实际 Host 流程分别验证待补证、等效交叉表和本轮用户明确范围调整。当前用户原文以独立 `user-request` 材料交付，不从报告倒推人已确认。 |
| FCR-A3 | 实际历史发布 RAP v1 经原生当前分支、真实用户 turn SHA 和正文匹配验证；后发 v2、未送入 RAP 和异分支不补入。材料记录目录 / 片段、无版本、冲突、撤权、截断与历史不可读。`history-proof-final.log`、`materials-unreadable-budget-final.log`、`host-final.log` 及两轴原反例复验。 |
| FCR-A4 | `tests/report-framework-coverage-runtime.test.ts` 实际前台子会话：一次委派、第二次调用拒绝；取消 / 撤权后抑制迟到意见，无替代派发。原生回执与固定原稿可读，未产生覆盖评分或自动放行。`runtime-regression-v2.log`。 |

浏览器既有 5 组回归通过，0 页面错误、0 外网请求，桌面 / 390px 无溢出，原初稿精确回看。证据在 `.local/report-framework-coverage-ui/`，使用既有 UI 构建和当前 Host 源；本项未改产品 UI。

## 原失败与修复

- 真实历史未入包 RED：`historical-product-red.log`；补只读当前原生分支解析及实际交付证明后通过。首次 fixture `requiredData` 悬空引用的失败只属夹具错误，不算产品 RED，原 `historical-red.log` 保留。
- 四种覆盖意见及材料范围、身份缺失的前置 RED / GREEN 沿 `runtime-red.log`、`runtime-green.log`、`materials-red.log`、`materials-green.log` 保存。
- 初轮非作者两轴发现历史条目累积超过 20k 导致计算复核也拒绝（P2），均判 FAIL。独立反例在 `spec-review/metadata-probe.log` 和 `standards-review/probe/result.json`。相同版本与文字仅保留一份实际交付证明，历史按剩余预算提供并记录未知范围。第二轮发现不可读历史的近限缺口，原 FAIL 保留。最终同一产品测试覆盖不可读 0 / 40 项、撤权当前框架、合法当前框架元信息超限；只让可选覆盖降级，基础材料自身超限仍拒绝。短声明在实际固定 `provided.json` 中原字节保存及读回。
- 首轮完整检查共 2,008 项，1,940 通过、1 失败、67 条件跳过；旧自动链 warmup 并发读取原生历史返回 409。相同测试隔离重跑通过（`automatic-race-isolated.log`），原 `full-check.log` 保留，最终完整候选另跑。
- 旧 RCR 合成夹具把本轮 `POST.text` 标为私有历史的断言已修正为 `CURRENT_USER_SCOPE`；保留实际父历史不送入的独立运行时测试。原失败见 `materials-existing-host-regression.log`，受影响 Host / runtime 18 项已通过。

## 最终本地工程验收

FCR-A1 至 FCR-A4 通过。产品与测试候选为 `candidate-lifecycle-final-manifest.json`（59 件，SHA-256 `6848d86c7f51c58f92e8203c3f66c745f61a6609d9ea0d81f8d944068e10ceb2`），所有产品源码保持 `0088113c` 候选字节。后续仅回填本记录与总进度，未改变产品候选。

- 最终完整 `npm run check`：2,012 项，1,945 通过、0 失败、67 条件跳过，导入边界与构建通过；`full-check-lifecycle-final.log`。既有大包体积提醒保留。
- 材料 22/22、实际 Host / runtime / history 19/19；最终浏览器 5 组通过，0 页面错误 / 0 外网请求，桌面与 390px，证据 `.local/report-framework-coverage-ui/final-stable/`。
- Spec：`spec-review/round3-final-review.md`，35 项独立检查及 79 次合法材料准备反例扩展通过；Standards：`standards-review/result-unreadable-final.md`，长历史、近限、撤权、取消和原件保护通过。两轮原 FAIL、范围限定的中间 PASS 保留。
- 最终全检曾出现旧 D16 的完成记录 / 公共资源关闭时序竞态（`full-check-unreadable-final.log`）。只将该测试改为复用原 45 秒只读轮询等待实际空闲，严格空闲及全部原件 / native 断言保留；未改产品生命周期。非作者双轴增量复验通过，见 `spec-review/lifecycle-final-addendum.md`、`standards-review/lifecycle-test-review.md`。
- 四原则及官方组件检查：`responsibility-reuse-audit.json`。无新增用户必做动作、产品 UI、SDK / 依赖或生命周期台账；十份批准 spec / Demo 字节未变（`approved-baselines-check.json`）。

以上是隔离合成的工程结果；真实 Provider 专业表现与用户产品验收未进行，不宣称已验证。仍为本地未提交候选，无 Git / CI 交付或服务 / MacBook 采用。历史与固定材料原位保留；回退使用能兼容新增材料类型的代码，不用旧副本覆盖新记录。按已授权顺序转入第 3 项。

# 需求梳理与分析框架实施记录

目标是沿原需求工作台生成有依据的分析框架，确认确切版本，并通过原入口显式送入该版本。基线为 `d5ded3b2fa1077dbaad9bfbda9684c42ef7ba198`。审核后的规格与 Demo 保持固化索引记录的 SHA-256。

## 执行清单

- [x] 刷新 origin，核对源工作区、分支占用和跟踪关系。从最新 `origin/main` 创建独立 `codex/data-analysis-flow`。同名远端不存在，新分支未配置上游。
- [x] RAF-A1/A2。固定 RAP 输入，沿原权威提供只读证据，Agent 给出价值、可行范围和待补证，覆盖三类价值与可行性组合。
- [x] RAF-A3。通过原生 Pi 和合成供应商验证公开检索请求、来源、不可用、空结果、失败、取消及隔离。
- [x] RAF-A4。通过需求 API、任务消息入口和浏览器验证确认、失效、显式送入及原生回执。
- [x] RAF-A5。复测原生成、一次格式修复、停止、关闭、切换、刷新、RAP 0.2 和普通任务。
- [x] 固定候选，完成全量检查、非作者规范／规格双轴复核和四原则核对。第 1 项通过后开始第 2 项。

## 接入边界

按工程规范 v1.10、Interface v3 及 IN01–IN07。Codex 实施需求插件和 Host 接缝。沿 `requirements-elaboration` 的真实 `instanceId` 和公共生命周期保持同一业务占用。公开检索用同一配置身份和单独的封闭 Pi 资源。原 RAP 0.2 字段和历史发布版保持原合同。新增框架评估及版本身份走需求业务记录。工程证据存于本工作树 `.local/requirements-analysis-framework/`。

## 实施选择与边界

- 需求 UI 通过既有生成入口使用新版合同。旧调用方和旧工作稿、RAP 0.2 字节继续按原入口读取。评估、来源、提案和一次确认保存在需求实例旁，发布仍使用 RAP 0.2。新发布条目关联确切框架版本，原发布记录无需迁移。确认框架允许待补证，显式送入仍检查有效正式需求快照及原四组结构。
- 需求实例拥有一次公共 lease。私有框架子资源沿 Pi 1.4.0 的封闭来源读取方式，跨生成不续接旧源正文，一次格式修正使用同一子会话。只注册现有 `read_semantic_context`。四库及双库的获准资产沿已发布 SAP、企业资料、M2、M4 和 Case 原权威读取。项目资料仅使用本轮明确勾选的固定项，选择项目本身没有读取资格。未授权的关联原件作为未读引用。二进制来源未提取正文时记录覆盖缺口。历史 RAP 假设可作为有版本的待核条件保留，当前工作稿中的假设关联不自动改写。
- 公开检索仅使用用户明确允许公开的主题。Host 固定原配置身份，沿已接通的 MiniMax 或 MiMo 原生接缝以独立、无历史、无普通工具资源执行。Agent 决定是否查网并说明可比性。普通项目的已保存搜索线路和备用规则继续按原入口执行。公开子资源收尾未知时保留原占用，用户显式停止可重试该清理。
- 确切 RAP 或公开回执超出原模型请求容量时，明确标注实际交付片段。源权限撤销或准确内容不再可证时，历史视图保留版本、确认时间、仍获准的来源定位和公开回执，隐藏可能混入撤权内容的生成正文。任务原生历史保留，读回时遮蔽已撤权的框架供给。继续使用含撤权输入的原分支会得到已知拒绝，保留草稿与上一次运行。新任务仍可使用其获准材料。
- Host 只处理来源、权限、身份、格式、保存和资源收尾。价值、可行范围、行业可比性和分析建议由 Agent 作出。正常路径沿生成、确认及原显式送入操作，公开主题和项目材料勾选按需展开。

## 检查证据

本工作树证据根为 `.local/requirements-analysis-framework/`。浏览器证据根为 `.local/requirements-framework-ui/`。

| 条目 | 证据 |
| --- | --- |
| RAF-A1 | `tests/requirement-framework-flow.test.ts` 经实际 Host/Pi 检查固定 RAP、无 RAP、历史假设冲突和大 RAP 片段。 `raf-sources-regression-final.log` 60 项覆盖发布 SAP、企业资料撤权、M2 固定报告、M4 和 Case。 |
| RAF-A2 | 同一 Host/Pi 检查价值高但证据不足、证据足但价值低、部分可回答三种合成输出。合成结果证明提案字段与入口，真实模型专业判断另行验证。 |
| RAF-A3 | `raf-a3-final-focused.log` 6 项及 `raf-a3-public-final.log` 43 项，包含 Provider 请求捕获、无搜索、支持／不支持、空、失败、UNKNOWN、伪造链接与权限拒绝、停止保留旧版。独立故障探针 `standards-stop-retry-final.log` 验证原公开资源关闭失败与显式清理。 |
| RAF-A4 | `tests/requirement-framework-api.test.ts`、`tests/requirement-framework-flow.test.ts`。浏览器 `browser-final-focused-2.log` 核实确切确认／发送／回执、改稿失效及旧 RAP 字节。独立 `standards-stop-after-child.log` 与 `spec-case-3qGKcU/` 核对收尾停止、权限撤销后 Case、任务回执与续发。 |
| RAF-A5 | `requirements-regression-first.log` 首轮需求回归 79 项，浏览器核对运行中刷新、停止和重开。完整检查及非作者复核见下文。 |

RED 证据保留于 `raf-a4-red.log`、`raf-source-runtime-red.log`、`raf-a3-*-red.log` 及浏览器 `red-input.log`、`browser-formal-send.log`。首轮完整检查 1,888 通过、67 条件跳过，D16 自动核算在业务链已完成时观察到任务占用尚未退出，断言失败。该原始失败在 `full-check-first.log`，同项定向重跑在 `d16-focused.log`。

## 独立复核

- 规格轴复验通过。独立探针覆盖资料勾选在途撤销、原 RAP 假设缺少当前 ID、已发布 RAP 的 Case 读取、任务回执和续发拒绝。修正后需求 API 与 Host/Pi 5/5。无法安全逐句归属的混合正文在撤权时隐藏，准确版和可读来源仍显示。
- 工程规范轴复验通过。独立 37 项覆盖需求、Case、Studio 和核算消费者。 `standards-long-rap-final.log`、`standards-final-corrected.log`、`standards-stop-retry-final.log` 记录修复后结果。按 IN06，Interface v3 的共享 turn 支持可选 `verifyBeforeDispatch`。Host 只在同一写入占用内重核实际上下文和来源后派发；无校验的既有调用维持原路径。
- 四原则在实际调用链中核对。Host 持有源准入、快照、占用和回执，Agent 自主决定是否读源、公开检索、分析范围及业务判断。依赖锁与实际解析为原官方 Pi 1.4.0，未改写安装包。用户仍通过原工作台确认和送入。
- 运行候选 39 文件 SHA-256 清单为 `review-final-manifest.json`，摘要 `c74ad10cb8cee7a6eaacc3b2d58ac9e5e3e47cc77366cd69cc97e7b27f56d2dc`。浏览器最终 14 项在 `browser-final-focused-2.log`，外部请求及页面错误均为零。


## 工程验收通过

RAF-A1 至 RAF-A5 均通过适用工程验收。冻结候选执行 `npm run check`，共 1,957 项，1,890 通过、0 失败、67 条件跳过，统一会话边界、类型检查及生产构建通过。完整输出 `full-check-frozen.log`。上一轮大 RAP 合成材料用多字节填充超出了原 HTTP 请求容量，保留 `full-check-final.log` 的 413，改为同字符数量且在 HTTP 容量内的样本后通过。独立 SDK 原包比对见 `pi-sdk-verification/package-bytes.log`。

真实供应商检索、专业判断效果和用户产品验收未运行。工程候选保留在独立本地分支。第 2 项沿固化索引接续。

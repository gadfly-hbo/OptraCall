# Issue #149 最终产品 UI 独立复核

- 复核身份：未参与候选任何实现的独立 UI 复核者；产品源码、测试、依赖、冻结规格只读，仅写 `.local/pm-final/` 自有探针、报告及隔离构建。
- 固定复核候选：`7fe8e936d2463e514f2d8b08deae23f8c0467e24`；完整比较基线 `699e425cb0900b50385377d638495069fa726761`。不把原作者／二审修作者 PASS 当作独立结论。
- 依据：`AGENTS.md`，工程规范 v1.15 第 2／3／4 节及四原则专项；冻结 `spec.md` DW01–18、`demo-guide.md`、`demo.html`、`pm-integration.md` 和 `pm-review/second/ui-review.md`。冻结 HTML SHA-256 独立回读仍为 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`。
- **当前结论：7fe8e93 不可合并。有一项真实产品浏览器已复现的必须修复问题（FUI-01，DW04/05），其余下列重点链路获得实证或限定通过。后修完整候选须增量复核，不能沿用本报告的固定身份。**

## FUI-01 HIGH — “全部当前 Case”把共享项目中别案任务列成本案内容

路径：项目 P 同时明确关联 Case A／B；任务 TA 的 `assignment.issue={caseId:A,issueId:a}`，任务 TB 的 `assignment.issue={caseId:B,issueId:b}`，另有未绑定 Case 的历史独立任务 TC。打开 A/a 的项目与任务页，默认当前事项正确仅列 TA；点击“全部当前 Case”，实际列 TA、TB、TC。TB 行没有 Case B／事项 b 来源提示，并提供“按此 Case 继续”。

预期：`全部当前 Case` 仅扩为 A 的真实事项／本案内容；共享项目身份不把 B 的任务或无 Case 归属任务默认为 A 的内容。其他项目工作仍从原项目入口可达。任务行应回读真实 Case／事项归属，不以筛选制造采用／发送背景资格。

原因：固定 7fe 的 `CaseBoard.tsx` 项目任务映射在 issue 分支按准确 `assignment.issue` 过滤，但 all 分支直接使用 `project.tasks`。冻结 Demo 的 `tasks()` 已先限定当前 Case；规格 DW05 和 §4.6 明确“共享项目不代表全部资料属于所有 Case”。这不是单纯缺浏览器测试。

独立运行命令：

```sh
REUSE_UI_BUNDLE=1 /workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node .local/pm-final/ui-scope-probe.mjs
```

证据：[独立实际浏览器收据](ui-scope/ui-probe-receipt.json)最后两步；[日志](ui-scope-probe.log)；[共享项目范围截图](ui-scope/ui-shared-project-all-scope.png)。收据明确 `foreignTaskShown:true`，结果 `SPEC_FAIL_FOREIGN_CASE_TASK_AS_CURRENT_CASE`。本反例已交 PM 与导航修作者处理，本复核者未修改产品／测试。

## 本轮独立实际产品证据

[独立轻建案探针](ui-probe.mjs)从固定 UI 源码用 esbuild 在本目录生成隔离实际 React 产品包，通过真实 `createHost`／HTTP 与 `/usr/bin/chromium` 运行。确切包的元数据和每文件 SHA-256：[ui-dist/optracall-build.json](ui-dist/optracall-build.json)。命令：

```sh
/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node .local/pm-final/ui-probe.mjs
```

[收据](ui-probe-receipt.json)／[日志](ui-probe.log)为 PASS，包含：

1. Home 输入、改名称／背景、选准确已采纳目标版本与该版策略，经真实草稿 API 回读一致。另 [独立人工与续接探针收据](ui-manual/ui-probe-receipt.json)／[日志](ui-manual-probe.log)为 PASS：Case 总览的新建入口手填实际个人 scope／新 G/S，明确采纳并创建，采纳与创建 operation 及首事项回执各自真实；再用另一准备沿同一准确已采纳 G/S 继续原 Case，明确选原事项，新名称／背景／原输入均进入来源片段。三种创建分支由本人在真实产品 UI 合成数据完整走通。
2. 从同一准备创建 Case，保存独立创建回执并建立真实第一件事项；完整名称、背景和原输入出现在准确事项的来源片段；没有自动创建项目／任务。
3. 唯一真实 composer 预有非空草稿；追加片段保留旧输入，重复追加不重复文本；编辑后的完整文本准确持久于 `issue:<caseId>:<issueId>` 原草稿。
4. 清空 `sessionStorage` 后真实页面 reload，再从 Case 总览进入准确原 Case／事项，实际发送框恢复同一服务端草稿；片段原文及来处仍可回读，没有第二份独立编辑框。
5. 全程捕获的 `/api/business-role` POST 为零，打开、创建、追加、恢复均未默发模型请求；`<img src=x onerror="window.__xss=1">` 作为原文安全展示，未执行。
6. 390 宽度无页面横溢出；实际片段与 composer 可读且可页内滚动；20 次真实 Tab 键焦点留在打开的 dialog。已人工查看 [1440截图](ui-created-1440.png)和 [390 composer截图](ui-composer-390.png)。
7. 在单个原 Case 详情 GET 注入 HTTP 503 后，实际 UI 保留准确内容并标“旧快照”；注入 403 后，G/S、事项内容及旧写入口清除；恢复读取重新显示原记录，全程不重放发送。这是限定该读取边界的产品 UI 证据，不外推所有服务的权限实现。

保全边界：最初探针误用了 drafts 查询路由、一次点击恢复期 disabled 按钮，以及范围探针的旧式无 assignment 任务误带 operationId、eval 转义错误，分别留在 `ui-probe-harness-*`／`ui-scope/harness-*`。这些是自有探针错误，未当产品 RED。另最初读取到工作树旧 `dist`（495cbf dirty）的运行单列 `ui-probe-older-dist-*`，本轮7fe结论只采用重新从固定 UI 源码隔离构建后的收据。

## 原二审缺口逐项回读与交叉检查

- SUI-01：Home 保留准确 requestId/revision；choose 表单按明确请求上下文选择准确方案，多个请求不再 find 第一条；observe 进入原 Board feedback，提交前重读请求、授权与 CAS，并通过原 saveFeedback 保存回应引用。独立读源码并回读 `browser-observation-requests.mjs` 及其真实产品 PASS 收据 `.local/pm-second-observe-ui/browser-Wl2xVo/receipt.json`，后者属于作者证据，未标为本人独立运行。
- SUI-02–04：所有 App／Home／Case 总览创建入口接同一 CasePreparation；独立准备 ID、scope、编辑及 GoalRoleSuggestionRef 持久；真正 Agent 候选带入时重读原来源，沿原 Goal API 保存／采纳，再沿 create orchestrator 三分支创建／继续。明确继续提供准确原事项选择与 carry-over；创建首事项／片段的丢回执先核原 operation。人工来源候选保存／采纳、已有 G/S 新建、已有准确 G/S 续接的三分支已由本人实际浏览器完整走通；Agent 候选来源／编辑和部分成功 UI 的 hook 测试只作确定性接缝证据，未宣称本人已在实际浏览器与合成 Pi 联动验证 Agent 候选质量或部分成功完整恢复。
- SUI-05：Case composer 已由同一 Host issue-draft controller 提供恢复、CAS 保存和片段追加；实际链由上述独立浏览器验证。
- SUI-06–07：CaseView 按 caseId 保留；明确选新事项重设默认，普通 restore 不重置手选；无事项回 all；本轮摘要从准确 timeline 的最后一轮 choice／authorization／feedback／review 投影，并显示来源。G/S 四页签常驻。CaseBoard／ProjectBoard 保持挂载且不可见时关闭其 dialog，保留搜索、归档筛选、栏目、选中项目与任务类型；原全局项目、归档／恢复、零任务、任务／文件／来源入口未被移除。核对了真实 React 浏览器导航脚本与既存收据，但 FUI-01 证明该覆盖没有检查“别案任务必须排除”。
- DW16：详情／事项列表／timeline 撤权都清旧内容；503 标旧快照，迟到读取按 owner 和序列隔离。本轮独立探针实际覆盖详情 403／503，不把该结果外推成整个权限系统的验收。

## 四原则专项结论

- **Host 管环境：本候选不通过。** 新的 owner、版本／CAS、输入保护和保存回执属于正确职责；但 FUI-01 的 UI 范围把共享项目身份误投为本案任务归属，必须修正这一环境／来源投影。
- **Agent 自主执行：限定通过。** 目录是明确的有界真实只读来源，不以关键词代作语义归属；整理由用户主动触发；新增声明／请求工具沿准确 owner 保存，未把图或六类任务变成强制分析流水线。未评价真实模型推荐质量。
- **优先复用 Pi：限定通过。** 比较完整基线差异，依赖／锁文件未变，沿既有 goal-draft／Case BusinessRoleConversation、business-role 域与原公共生命周期；UI 草稿是输入，不是平行对话消息库；未发现新增 UI 模型循环或改官方 Pi 包。官方 SDK 实际运行／取消专项由 Runtime 独立复核另证，本报告不代替它。
- **减少人的操作：暂不完整通过。** 已知 Case 直接继续、三分支同屏、已有 G/S 不再采纳、草稿自动保护的路径合理；FUI-01 使用户需自行辨别别案任务来源，当前仍妨碍该原则，修后需复验。

本报告不替代完整 npm check、最终准确 head CI、真实模型质量、设备更新或用户产品体验验收。后修候选未到达前，7fe 的最终 UI／四原则结论保持上述“不通过”，不因其他链路 PASS 覆盖此缺口。

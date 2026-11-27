# Issue #149 最终独立 Runtime 审查

复核者未参与该候选或 PM 接修实现；仅源代码、测试、规格、依赖只读，自有探针/日志/合成根写在 `.local/pm-final/`。原固定候选 `7fe8e936d2463e514f2d8b08deae23f8c0467e24`，基线 `699e425cb0900b50385377d638495069fa726761`。已读 AGENTS、工程规范四原则/官方 Pi 约束/IN01–07/非作者最终规则、统一接入说明、冻结 spec、implementation、pm-integration 和二审 runtime-review。未启动真实 Provider、读取业务数据或凭据、改依赖/SDK、commit/push。

## 原固定候选结论

**不可直接合并：一个真实 Pi 配置失效迟到写 P1，以及目录有界性和普通项目排队写两个 P2 仍需修复。** Root 已收到全部原始反例，正在接修；下述 FAIL 不因后续修复抹去。最终补充结论须绑定修后完整代码。

### FRR-RT-01 · P1 · 配置已失效，Case Agent 旧响应仍首次提交新关系

`src/host/strategy-discussion-host.ts:643` 的 `assertWritable` 只核实际 SDK current、signal、closing，未核 resource 创建时捕获的 configuration；`src/agent/project-runtime.ts` 的通用 `available` 也不核配置有效性。初始 `verifyBeforeDispatch` 无法覆盖后续迟到工具保存。

独立真实 Host → 官方 Pi1.4.0 → 隔离合成 HTTP Provider：保持 Case owner 的第一个 Provider 响应未发 → `PUT /api/configuration` 同 id 更换 baseUrl/apiKey → 同 owner 的 GET 已 **409 configuration_changed** → 释放旧 Provider 的 `case-save-issue-edge`。实际 Case SQL 新增关系，原 native `toolResult.isError=false`、`claim=case-issue-edge-saved`；旧 Provider 又接到第二请求。不是最终文字自称成功，也不是测试 stub 保存。

- 自有探针：`runtime-late-probe.mjs`；日志 `runtime-late-probe.log`；收据 `runtime-late-receipt.json`。
- 原 native 路径、operationId、准确 endpoint IDs 均在收据内；原成功写入及原配置失效回包同时保留。
- 最小修复应由 Host 在新 Case 声明/目录的真实资格与提交前 guard 中核捕获配置仍有效；保留既有旧版本快照的合法同线路继续策略。不能重建生命周期或改 SDK。

### FRR-RT-02 · P2 · 目录单 Case 事项无界，合法库永久 413 且无续页

`src/host/case-directory.ts:37–56` 只限制 Case 数，每个 Case 的所有事项一次返回。`strategy-discussion-host.ts:630` 超过32768字符整包失败，Agent 无法取到任何准确候选，也无事项续页可缩小。

独立在隔离库创建一个 Case/132 个合法事项（标题均未超过240字），`limit=1` 返回39100字符、`truncated=false`、无事项 continuation。随后真实 goal-draft Pi 调用同一 `case-directory(limit=1)`，原 native **isError:true / strategy_discussion_materials_too_large**。不能只按 Case 行数声称“有界”；需完整身份/标题的明确 Case 和事项分页与 partial/next 字段。

- `runtime-probe.mjs`、`runtime-probe.log`、`runtime-probe-receipt.json`；目录 native 准确路径在收据。

### FRR-RT-03 · P2 · 普通项目新声明工具仍在 mutate 外捕获 Case 总 revision

Case business-role 修复已采用 `currentCaseRevision:true`；但 `src/host/server.ts:846–861` 普通 project 的新 `save_case_issue_edge` / `save_case_decision_request` 仍在 gate 外读取总 revision，并未选择同一 Host 模式。

- 独立实际 Pi 同 assistant 批次直接调用两工具，本次自然调度 **均成功**，原 native 和 SQL 证明真实可达；这是正例，未伪写成 Pi FAIL。
- 独立用实际 Service/Store 持有原 mutate gate，准确模拟两 wrapper 的已捕获 expectedRevision → 释放：edge成功、第二 request **case_revision_conflict**。`runtime-late-receipt.json.gate` 保留。证明合法排队窗口，不能将自然调度的一次成功扩大成无竞态。
- 应对这两 Host 自选总版本复用同一 current 模式；仍保留实体 `expectedEdgeRevision` / `expectedRequestRevision` CAS 与普通 HTTP 显式总版本 CAS，不另建队列。

## 已实核成立的接缝

- 真正 Case owner 是 `{role:'case',caseId,itemId}`，经原 `business-role-discussion` 域、`case-declarations` 工具变体进入同一官方 Pi。创建前辅助用原独立 `{role:'goal-draft',draftId,scope}`，没有伪造 Case 身份或新建 Runtime。
- 读取原 `.local/pm-second-fix/pi-final.log` 对应 `/tmp/optracall-host-test-t01az3/.../native/*.jsonl`：第8–10行 issues/strategies 原身份读取；第12–14行同批 edge/request 各v1；第16–20行 edges/requests/choices/observations；第22–24行根据实际回执各改为v2，均非error。原 owner.json 与 native/current Case/issue 一致。
- Case readDeclarations 返回 caseStoreId/caseId/issueId/caseRevision/section，普通区段有 offset/limit/nextOffset/partial；strategy 复用原 continuation。请求/取舍/观察限定当前 issue，Case issues/edges仅本案；Store 对 edge 两端分别 `getDecisionIssue(before.id, id)`，请求 owner.itemId 强绑定，修订拒绝换 issue，本案外 strategyRef 的 caseStoreId/caseId 均拒绝。
- Case business-role 的总revision在 mutate 内读取；实体CAS仍严格。operation digest 的 current mode 排除Host自选总revision，旧aggregate receipt fallback由原事件的提交前revision复核；未改变 payload 不重写，改变payload仍 conflict。已有回执在cancel后只读返回。
- Service 在 gate 内先 guard，Store 新事务写前及 **COMMIT前**再次 guard；已有 completed receipt 路径不误当首次写。永久 `DW-SECOND-04/05/08` 覆盖取消回滚、并行与CAS、新旧operation回放。本人静态追踪通过；上述配置有效性缺口仍独立成立。
- 普通项目原 `read_case_decisions` / `save_case_decision_draft` 未被替换。本人的真实 native tools 列表同时含旧读写、新两声明、Case来源与关系工具。固定/受管/工作区资格沿原 feature gate；没有将新工具泛化给所有profile。

## 四原则专项实查

1. **Host管环境**：owner、当前事项、来源session/request/toolCall与operationId、CAS、事务及导航持久数据由Host核；无自动生成Case归属/业务关系/用户取舍的关键词规则。原配置guard缺口须先修再通过这一项。
2. **Agent自主执行**：新tool variant是业务能力收窄；Agent自行选读页、工具顺序及修订，没有新增Host模型循环、固定分析步骤、公式、强制工具配额或补算。Pi同批并行工具保留，未以串行限制掩盖总revision错误。
3. **优先复用Pi**：Interface常量仍v3；package/lock实际官方Pi及pi-ai/core均1.4.0，锁文件官方registry/integrity存在；本轮无package/lock/公共agent-sessions/边界脚本差异，无SDK改写或新增资源生命周期Map。复用公开工具注册、SDK工具执行、既有IPC/Call-local资格与公共域。未与npm官方tarball逐文件比对，不能宣称整包完整性或运行服务采用。
4. **减少人的操作**：原owner工具可直接按明确用户声明保存，读取无逐条确认；目标辅助只主动触发，零工具正常，人工准备继续可用。配置失效应由系统拒绝迟到新写，目录分页应由Agent自主续读，不让用户拆资料补技术身份。真实UI操作链由Root另行浏览器复核，本子审不冒称完整UI验收。

## 验证范围

实际执行两份自有脚本使用 Node25.9.0，所有隔离数据在 runtime-tmp 下；无测试源码变更。Root 负责完整 npm run check/边界/构建与后续CI。现有历史二审PASS/FAIL、作者成绩、本人实际反例分别记录。此报告不代表真实模型质量、用户产品验收、运行部署或设备采用。

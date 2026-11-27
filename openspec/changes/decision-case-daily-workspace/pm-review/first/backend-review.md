# Issue #149 后端首审（只读）

候选：`fd0003e6441e75f9e7daae88e09f3a0411227f04`；基线：`699e425cb0900b50385377d638495069fa726761`。

结论：本审查范围不能通过。以下六项均有隔离合成动态反例，应在首次退回时一并修复。读过 AGENTS、工程规范以及本单 spec/tasks/implementation；未修改源码、测试、确认包或原证据，新增探针与数据仅在 `.local/pm-backend-review/`。使用 Node `/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node`。未调用真实 Provider、读取凭据或真实业务根。Root 提供的 node_modules symlink 不属于本子审修改。

## 必须修复

1. **P1 / DW11、DW14、DW16：新增创建入口绕过原目标权威准入。**
   - 位置：`src/host/server.ts:1870–1875`，`src/host/case-creation-orchestrator.ts:115–138`；对照原 `src/host/case-routes.ts:205–217` 的 `assertAdoptedGoalRefs`、`bindingEnterprise/validateGoal` 与企业归属记录。
   - 真实 Host/HTTP：创建合成 candidate G。原 `POST /api/cases` 引用该 G → `409 goal_not_adopted`；新 `POST /api/workspace/create-case` 同 G 加 `alreadyAdopted:true` → `201 created`，G 仍 `candidate`、`adoptedVersion:null`。随机不存在的 goalId/version99 同样 `201`。`alreadyAdopted:false` 配合法 G 和不在该版策略内的虚构 S，也 `201` 并产生采纳回执。
   - 风险：客户端布尔值和字符串变成目标采纳与准确 G/S 的权威；新入口还没有复用原读取/范围资格及 Case 企业归属后续步骤。本探针直接证明前述准入绕过，未单独动态模拟撤权企业。
   - 修复要求：复用原目标校验/采纳/Case 准入与范围合同，服务端重核准确 G/S 的存在、资格、采纳状态及具体 S，不信任 `alreadyAdopted`。
   - 证据：`http-probe.mjs`、`http-results.json` 前五条。

2. **P1 / DW11–14：部分成功回执跨目标串用，实际创建 A 而草稿显示选择 B。**
   - 位置：`src/host/case-creation-orchestrator.ts:60–62,79–85,103–105,115–138`。
   - 真实 Host/HTTP：同 draftId 选 G/S A，标题100字使 Case 确定失败；目标 A 采纳成功，返回 `partial`。用户改选准确 G/S B、换新操作 ID、修正标题再次提交：返回 `201`，`draft.payload.selectedGoal` 是 B，实际 `GET /api/cases/:id` 的 `goalBinding` 却是 A，B 未被采纳。
   - 根因：既有 `adoptionReceipt` 无条件优先于当前明确选项，保存草稿又将 selectedGoal/operationId 改成 B，未校验意图身份。
   - 修复要求：固定恢复意图与回执的目标/版本/策略/操作身份；明确换目标须分离新意图或拒绝不匹配，保留 A 的部分成功及用户 B 输入。
   - 证据：`http-results.json` 最两条；`store-results.json` 也有同类服务层结果。

3. **P1 / DW13–14：任意已完成操作被冒认作创建回放。**
   - 位置：`src/host/case-creation-orchestrator.ts:94–99`。
   - 合成真实 CaseStore + orchestrator：先给无关旧 Case 写一条 `case_note`；将该 note 的 operationId 作为另一准确 G/S 的 createOperationId。结果 `branch:'created'`、`replayedFromOperation:true`，回传无关旧 Case；采纳和创建函数均未调用。
   - 根因：只核 phase/caseId，未核 kind、请求指纹、目标和原草稿意图。即使是原 case_create，变更标题/目标后也会绕开 Store 原本的 operation_conflict。
   - 修复要求：仅核对同一原创建意图的回执，沿原操作指纹判冲突，拒绝无关 kind/目标/输入，不能虚报创建成功。
   - 证据：`probe.mjs`、`store-results.json` 的 `unrelated-completed-operation`。

4. **P1 / DW13：草稿 CAS 不是原子的，并发成功会丢输入。**
   - 位置：`src/host/workspace-draft-store.ts:107–124`；新草稿 PUT 路由未走串行 mutate（`workspace-daily-routes.ts:100–109`）。
   - 合成 Store：`Promise.allSettled([save(kind,id,0,{text:'first'}), save(kind,id,0,{text:'second'})])` 两次均 fulfilled，revision 均1，落盘仅第二份。read/check 与 rename 之间有多个 await，原子替换文件不等于 CAS。
   - 修复要求：同 owner 的 compare+write 串行/互斥且跨 Store 实例策略明确，竞争者返回409并保留输入；追加/放弃也须服从同一保护。现有仅顺序陈旧版本测试未覆盖该竞争。
   - 证据：`probe.mjs`、`store-results.json` 的 `same-revision-concurrent-CAS`。

5. **P1 / DW09、DW13、DW18：首次回应观察改变 schema，重开后整个 Board 不能初始化。**
   - 位置：`extensions/business-plugins/decision-board/storage/store.ts:671` vs `239–247,320–322`。
   - 子审合成真实 Store：写一条带 `respondsToRequest` 的反馈，close，再 init → `unsupported_board_schema`。新增列未进入 schema版本及校验期望，严格 schema inventory 将新列视为不支持。
   - 修复要求：实现可识别、可验证、保全旧值的正式迁移/版本合同，并覆盖保存后关闭重开及原Board消费者。
   - 证据：`request-probe.mjs`、`request-probe-output.jsonl`，末尾 reopen 行。

6. **P1 / DW08–09、DW16：请求和回应没有准确 owner/授权核验，错误身份能消解请求。**
   - 观察位置：`src/host/case-store.ts:829–831,858–863`、Board `store.ts:266–270`、`src/host/case-issues.ts:392–397`、`workspace-daily-routes.ts:47–55`。
   - 子审真实 Store/业务投影：Case 未关联项目，Board 任务无任何真实授权；请求携带随机不存在的 authorizationId 仍保存并进入 pending=1。反馈自报相同随机授权 ID 后变 answered、pending=0。Host 投影使用客户端回填的 authorizationId，没有回核原行动授权、选择链、事项归属及原反馈基线资格。
   - 取舍位置：`case-store.ts:861–862`、`case-decision-types.ts:113–114`。同一 Case/record/revision 但错误 `caseStoreId` 的请求被保存成 open；真实 Store 的选择回应后仍被判 answered。
   - 修复要求：沿原 Case/Board owner核请求创建与回应的完整准确身份、关系和资格；不匹配/不可读不得作为有效回应或正式待办。
   - 证据：`request-probe.mjs` / `request-probe-output.jsonl`、`choice-scope-probe.mjs` / `choice-scope-probe-output.jsonl`。

## 另外已观察到的保护缺口

- `workspace-draft-store.ts:151–168` 不核 fragment 的 targetCaseId/targetIssueId 与 input/既有 draft owner。合成 Store 将 A/A1 片段追加到 B/B1 成功，并写成 B 草稿（`store-results.json` 的 cross-owner-fragment）。应纳入草稿准确归属保护修复。
- `CaseStore.saveDecisionRequest` 允许 source.ref=null，承担人来源任意字符串也进入正式 pending（同 request-probe）。原用户消息、请求人及承担人声明的可回读资格未建立；Agent准确用户引用/取消的运行时接缝由 Root 的 runtime reviewer独立审查，本文不将仅静态推断扩大成真实 Pi 结果。

## 验证边界

本子审为独立负例审计，不是完整 `npm run check`，未重复 Root 正在跑的作者16项目标测试。HTTP探针是真实隔离 Host + 真实目标/Case Store，不运行 Pi/Provider；其余为真实 Store/业务函数 + 合成依赖，不冒称完整 HTTP或Pi调用回环。多前驱/事件保留/原结束Case不自动重开在静态路径存在，但本次不据此宣称 DW03–18 或产品验收 PASS。源码 `git diff --exit-code` 为0，HEAD仍固定候选。

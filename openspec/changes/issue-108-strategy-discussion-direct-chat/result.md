# #108 重排战略共创对话区，让首次使用者直接开聊 · 工程验收与结果记录

- **关联工单**：[Issue #108](https://github.com/gadfly-hbo/OptraCall/issues/108)
- **实际 Agent / 实例**：`Antigravity (83107e1a)`
- **独立任务分支**：`work/antigravity/issue-108-strategy-discussion-direct-chat`
- **基线完整 SHA**：`8f6bec2e977e783d8075c0425db3c9598c790d37`
- **阶段一（设计待审）候选完整 SHA**：`7c281736e07fdace692c3912c1775c0c0ae1e648`（[设计待审回执](https://github.com/gadfly-hbo/OptraCall/issues/108#issuecomment-7060445860)；2026-11-21 用户确认「spec和UI demo通过审核，进入开发」）

---

## 1. 验收逐项核对（SD01–SD05）

| 验收项 | 实施与验证结果 | 状态 |
| --- | --- | --- |
| **SD01 首次开聊** | [`StrategyDiscussionPanel.tsx`](../../../src/host/ui/StrategyDiscussionPanel.tsx) 首屏优先呈现输入框、`＋ 添加资料` 和 `发送讨论`。顶部引导说明改为 `说说你正在考虑的战略问题。可以从比较两个方向开始。`，移除首屏 `本次：未设置，仍可工作`；输入框 placeholder 改为 `下季度该优先拓新客，还是提高复购？`。首屏仅保留唯一默认收起的 `提问示例` 入口，展开后显示 `复盘上期`、`看看行业变化`、`找机会与风险`、`看看竞争压力` 四个业务语言按钮；点击示例追加到草稿并聚焦输入框，发送由用户显式点击 `发送讨论` 触发。 | **PASS** |
| **SD02 继续已有讨论** | 在 `原讨论` 选择器旁放置 `刷新讨论记录` 按钮与说明 `读取当前讨论的消息和状态，并尝试接回实时回复`。点击后调用 `readStrategyDiscussion` 读取同一讨论消息与状态，并递增 `connection` 重建 `watchStrategyDiscussion` 实时流连接。就地提示明确区分三种结果：① 记录读取成功且实时连接恢复（`role="status"`）、② 记录读取成功但实时连接未恢复（`role="alert"`）、③ 记录读取失败（`role="alert"`）。修复了 `apply()` 在活跃运行期间刷新时因服务端 `pendingInput` 尚未清除而误还原已结算请求并覆盖新草稿的边界问题，确保正在回复（`detail.busy === true`）时仍可刷新，且原请求与未发送草稿完整保留、无额外模型请求。已绑定目标（`已绑定目标：目标准确版 vX`）、当前浏览目标（`围绕此目标讨论`）、已绑定地图版本或连线（`围绕地图 vX · 连线 eY`）统一置于输入框上方紧邻可见，`回到当前版本` 原地可用。 | **PASS** |
| **SD03 按需调整** | 输入框下方合并为唯一默认收起的 `讨论设置（选填）`（已设用途时在折叠摘要显示 `· 已设用途：组织` / `部门／业务模块` / `个人`），内部按分区收纳：① `讨论用途（选填）`（说明组织、部门／业务模块、个人和可选背景供后续回复参考，可直接留空）、② `地图输出格式（选填）`（自动／条目表／目标与策略树／平衡计分卡，说明格式是后续发送时的地图整理偏好，完成后到「战略地图」查看）、③ `指定参考方法（选填）`（说明它是分析偏好，默认优先参考战略选择框架）、④ `本次模型` 与 `资料范围`（`StrategyDiscussionBackground`）。仅调整用途／格式／方法时不触发 Agent 或产出。 | **PASS** |
| **SD04 先交设计回执** | 阶段一已在独立分支推送 [spec.md](spec.md) 与离线可点击 Demo [ui-demo/index.html](ui-demo/index.html)（SHA-256：`e1fabcfb50c253bd8bcd225ed7b710db3375ee09eb4b9bd4bb4e8520083a9091`），提交 `7c281736e07fdace692c3912c1775c0c0ae1e648` 经用户审核通过后进入阶段二开发。 | **PASS** |
| **SD05 确认后实施及移交** | 完成确定性 RED→GREEN TDD、构建及隔离 Host + SSE 合成 Provider + 无头 Chromium 浏览器全流程验证。 | **PASS** |

---

## 2. 确定性 TDD 与实跑验证证据

1. **前置 RED 验证**：
   - 在修改 [`StrategyDiscussionPanel.tsx`](../../../src/host/ui/StrategyDiscussionPanel.tsx) 前编写 [`tests/issue-108-strategy-discussion-direct-chat.test.ts`](../../../tests/issue-108-strategy-discussion-direct-chat.test.ts)，实跑 `node --test tests/issue-108-strategy-discussion-direct-chat.test.ts` 精准检出旧首屏文案与多入口平铺失败（日志保存在 `.local/issue-108/red-before.log`）。
2. **GREEN 与定向回归**：
   - 实施 [`StrategyDiscussionPanel.tsx`](../../../src/host/ui/StrategyDiscussionPanel.tsx) 与 [`strategy-goals.css`](../../../src/host/ui/strategy-goals.css) 后，`node --test tests/issue-108-strategy-discussion-direct-chat.test.ts` 2/2 通过（日志保存在 `.local/issue-108/green-after.log`）。
   - 战略讨论与工作台相关回归套件（`node --test tests/issue-108-strategy-discussion-direct-chat.test.ts tests/strategy-*.test.ts tests/v12-*.test.ts tests/pm01-*.test.ts`）**144 项全部通过（144 pass / 0 fail / 0 skip）**（日志保存在 `.local/issue-108/strategy-regression.log`）。
   - `npm run check:agent-sessions`、`npm run typecheck`、`npm run build` 全部通过。
3. **隔离 Host + 合成 Provider + 真实无头 Chromium 端到端验证**：
   - 浏览器回归脚本：[`tests/browser-issue-108-strategy-discussion.mjs`](../../../tests/browser-issue-108-strategy-discussion.mjs)
   - 对正式打包的 `dist` 前端资产启动隔离 Host 与 SSE 合成 Provider，通过 Chromium 逐项验证：
     - 首屏引导说明、输入框 placeholder、`＋ 添加资料`、`发送讨论`、唯一默认收起的 `提问示例`（4 项业务语言按钮点击追加草稿并聚焦，`providerRequests === 0`）；
     - 唯一默认收起的 `讨论设置（选填）`（修改用途更新摘要 `· 已设用途：部门／业务模块`、切换 `地图输出格式（选填）` 为 `平衡计分卡（BSC）`、勾选 `Rumelt 战略内核`，`providerRequests === 0`）；
     - 手动点击 `发送讨论` 触发首轮对话（`providerRequests === 1`）；
     - 已有讨论绑定目标与战略地图连线 `e1`，从「战略地图 → 因果链审查 → 在原讨论审查此线」返回「战略共创」后，输入框上方紧邻显示 `已绑定目标：目标准确版 v1` 与 `围绕地图 v1 · 连线 e1`，点击 `回到当前版本` 正常解除绑定且不触发模型；
     - 输入未发送草稿后分别验证：① 刷新成功（`role="status"`）、② 记录读取成功但实时流 503 断开（`role="alert"` 明确区分记录已更新与实时流未恢复）、③ 记录读取 503 失败（`role="alert"`）、④ 页面重载后恢复历史未发送草稿、⑤ Agent 正在回复（`detail.busy === true`）时点击 `刷新讨论记录` 仍可用且保留回复进行中新输入的未发送草稿、不重复发送模型请求；
     - 深色模式（`data-theme="dark"`）、`390x844` 窄屏（`scrollWidth <= innerWidth` 零横向溢出）及 `放大对话` 抽屉 `Escape` 焦点归还，`pageErrors === 0`（证据保存在 `.local/issue-108/browser-verification.log`）。

---

## 3. Host 与 Agent 职责边界及复用专项最终检查

- **检查范围**：[`src/host/ui/StrategyDiscussionPanel.tsx`](../../../src/host/ui/StrategyDiscussionPanel.tsx)、[`src/host/ui/strategy-goals.css`](../../../src/host/ui/strategy-goals.css)、[`tests/issue-108-strategy-discussion-direct-chat.test.ts`](../../../tests/issue-108-strategy-discussion-direct-chat.test.ts)、[`tests/browser-issue-108-strategy-discussion.mjs`](../../../tests/browser-issue-108-strategy-discussion.mjs)。
- **四点产品原则核对**：
  1. **Host 管环境**：Host 仅管理讨论输入框、草稿存储、记录刷新与实时流重连状态提示，以及用途、地图格式偏好、参考方法偏好、模型与资料范围的保存与交付；不硬编码分析步骤、不在仅调整设置或点击提问示例时触发 Agent。
  2. **Agent 自主执行**：地图输出格式与参考方法均作为用户显式发送时提供给 Agent 的偏好，由 Pi Agent 在授权范围内自主分析并整理战略地图候选。
  3. **优先复用 Pi 已有能力**：完整复用官方 `@earendil-works/pi-coding-agent@1.4.0`（未修改任何官方包或锁文件）及统一会话 Interface v3 的 `strategy-discussion` 通道，`npm run check:agent-sessions` 通过。
  4. **减少人的操作**：首次使用者进入「战略选择 → 战略共创」即可直接输入并发送，零必填前置配置；按需设置统一收起于单一 `讨论设置（选填）`。
- **专项检查结论**：**通过**（限本次变更工程范围）。

---

## 4. 未验证项与兼容回退说明

- **未验证项**：
  - 真实商业大模型在生产环境下的战略分析内容质量与用户最终产品验收（不在本次隔离合成工程授权范围内，记 `NOT_RUN`）。
  - Codex 非作者独立复核、集成最新 `main`、远端 PR / main CI、squash 合并及双机运行服务更新（归属 Codex 接回后按有效授权执行）。
- **兼容与回退方式**：
  - 本变更仅涉及 Host 前端展示层（`StrategyDiscussionPanel.tsx` 与 `strategy-goals.css`），未新增或修改任何持久化数据结构、会话 JSONL 格式或 HTTP API 契约；既有历史讨论、草稿、战略地图版本与目标绑定完全原位兼容。
  - 如需回退，直接还原 `StrategyDiscussionPanel.tsx` 与 `strategy-goals.css` 的本次提交即可，不影响任何已有业务数据。

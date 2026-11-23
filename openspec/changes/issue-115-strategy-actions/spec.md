# Issue #115 战略共创工具可靠性

## 目标与交付

基于 `e2aecfb445094245875b9696a02a273b5e0ddb44`，分别验收：

1. 对齐 MiniMax 工具调用的 wire schema、Provider 分片、Pi 原生调用、Host 分派/回包和下一请求；真实根因缺证时保留 NOT_PROVED。提供通用动作循环止损和恢复说明。
2. 修复共享 Host IPC 错误契约及战略地图校验，使稳定 code、安全 message/details 可供 Agent 纠错，未知异常不再冒充个人资料读取失败；校验失败零地图写入，修正后正常保存。
3. 查明绝对路径文本与上传资料的实际能力边界，提供不扩大权限的用户提示；不把真实模型失败原因预设为 Host 限制。

领取方完成规格、隔离合成实现/测试、适用检查、非作者复核后推送 `work/qoder/issue-115-strategy-actions` 交回 Codex。Codex 负责后续集成、PR/CI、合并与结案。本变更不直接合并 main、不更新设备或服务。

## 运行时与责任记录（IN01–IN07）

- 工程规范：当前基线 `docs/engineering-workflow.md`；Interface **v3**，兼容既有业务子集。
- 真实 owner：`StrategyDiscussion`，以 `o.id` 为 key；profile：`strategy-discussion`，未声明 `executionMode`，沿 unmanaged 固定工作区。
- Host 注册：`src/host/strategy-discussion-host.ts` 的 `strategy-discussion` domain；业务只取得 owner-bound Ref/Port。模型取讨论绑定的 `configurationId/configurationRevision`，历史沿用原 sessionFile/native。
- IN02/IN03：不新增域、ProjectAgent 构造路径、opening/operation/代际 Map 或全局运行队列；取消复用公共 domain、ActiveRun、pending Host 请求撤销和 `session.abort()`。
- IN04：Host 只做技术预算、权限、取消、校验、保存和回执，不替 Agent 选择 action、分页、战略方法或纠错路线。
- IN05：不读取真实原生会话/业务资料，不调用真实 Provider，不改变凭据、模型配置或来源权限；合成资料仅 loopback。
- IN06：本工单直接指定领取方修复战略工具、Host IPC 和相关 UI 接缝；Codex 继续负责集成及长期维护。不新增 SDK 内部接口例外，不改官方 Pi 包。
- IN07：覆盖正常 action、分片、取消、配置/代际变化、迟到结果、保存/恢复、共享消费者和旧 IPC 形状；最终运行完整 `npm run check`。
- 官方 Pi SDK 1.4.0 / transport 8.12.2 保持锁定；不升级、降级、补丁或运行时改写。

## 四原则前置检查

- **Host 管环境：** 重复无进展读取的有限停止属于技术预算/取消；稳定错误、脱敏和来源提示属于环境/权限说明。
- **Agent 自主执行：** 不根据 `query/sourceId/mapDraft` 推断或重写 action，不指定下一步，不替 Agent 补读文件或修图；有效不同结果和正常分页继续。
- **复用 Pi：** 使用现有 custom tool execute、ActiveRun、abort、run diagnostic 和 native 历史，不另建 Agent loop。
- **减少人的操作：** 正常上传/讨论路径不新增确认；失败后只提示可明确切换已配置模型，不自动切换/重发。路径提示复用既有“＋ 添加资料”，不自动上传或扩权。

## 范围

允许修改：

- `src/agent/strategy-discussion.ts`、`project-session.ts`、`project-runtime.ts`、`run-diagnostics.ts` 及必要的本变更窄辅助模块。
- `src/host/strategy-discussion-fault.ts`、`strategy-map-store.ts`、`strategy-discussion-host.ts` 及必要的安全错误详情辅助模块。
- `src/host/ui/StrategyDiscussionPanel.tsx`、`help-content.ts`、`docs/user-manual.md`；仅在评审认为简单文字提示不足时另交 Demo。
- 相关 `tests/**`、本变更 `openspec/changes/issue-115-strategy-actions/**`。

不做：MiniMax 移除或专属适配（除非新证据另获确认）、自动模型降级、通用文件路径读取、来源权限放宽、SDK/依赖变更、真实 Provider/资料/设备操作、其他复合错误码模块的全局截断。

## 执行清单与验收

### A. 分层证据与动作循环

- [x] A1 同 request/toolCallId 对齐 schema、原始分片、Pi、Host、native toolResult 和下一请求；非首项 action 与分片正例通过。
- [x] A2 注入 `read-goals + query/sourceId/mapDraft` 可复现原样分派；真实 MiniMax“联合恒取首项”无原始出参时仍 NOT_PROVED。
- [x] A3 设计经用户确认（#issuecomment-7080447650）：仅读取 action 在同一 request 中连续 6 次得到完全相同结果后，第 7 次 Host 派发前取消；参数不参与指纹，action/结果变化重置。写操作、operation 轮询和 public-search 不纳入。
- [x] A4 取消终态携带 `strategy_action_loop` 专用诊断，手动取消不冒报；第 7 次零 Host 派发，迟到结果安全，历史保留，刷新及下一显式请求可恢复。
- [x] A5 无关参数不能绕过；正常分页、不同结果、不同 action、合法多轮不误断；提示可建议切换模型但不自动切换。

### B. 错误契约与地图保存

- [x] B1 真实 Host/Pi 链路先复现 `save-map` 或 `propose-map-draft` 的 `personal_context_read_failed`，保留 RED；GLM 当次具体命中分支仍待真实证据。
- [x] B2 页码、选页、草稿结构、节点/边及来源位置校验拆为稳定 code 和白名单 details；Host 不再靠 message 正则分类或公开原始原因。
- [x] B3 IPC 兼容旧 `{error:string}`，安全转发 message/details；合法码、Method 例外、取消和权限码保持，未知异常用中性 `host_tool_failed` 及本地证据关联。
- [x] B4 原始异常、堆栈、路径、凭据和未脱敏输入不进入模型/native/SSE/HTTP/公开日志；HTTP 客户端合同保持。
- [x] B5 校验失败地图版本零增加；修正后保存一版并取得 `candidate-not-adopted` 回执。

### C. 路径边界与提示

- [x] C1 证明战略讨论 active tools 只有 `strategy_goals`，路径文本不自动转来源；路径冒充 sourceId 时按既有来源准入拒绝且正文不泄露。
- [x] C2 区分“无通用文件工具”“未选择来源”“路径解析失败”；真实各模型具体选择缺原始出参时不宣称唯一根因。
- [x] C3 设计经用户确认后，以系统提示、composer 非阻断短提示和帮助说明“路径文本不会上传或授权，电脑文件请用＋添加资料”；普通问答、已选附件和合法分页不变。

### D. 工程交付

- [ ] D1 定向 RED/GREEN、受影响回归、完整 check、隔离 Host/Pi/HTTP 和浏览器点验分别记录；未跑项不冒充通过。
- [ ] D2 非作者独立复核及四原则专项最终检查完成，发现已处理并保留证据。
- [ ] D3 固定候选、推送并回读远端 SHA，在 Issue 留实现交付回执后停止写入。

## UI 与设计门禁

阈值、取消诊断呈现和 composer 路径提示先发布到 #115 获确认。当前仅计划复用现有 alert 和简单文字提示，无新布局、按钮或流程，按规范不需可点击 Demo；若评审改为明显交互变化，先补 Demo 再实施产品 UI。错误契约及隔离复现不等待该门禁。

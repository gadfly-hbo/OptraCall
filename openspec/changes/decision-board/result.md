# 决策看板一期 · 结果记录

2026-10-31 · 分支 `qoder/ext-decision-platform` · 规格[spec.md](spec.md)

## 流程补正（2026-10-31，用户指出）

实施前未先输出 UI Demo 与规格供用户确认即开工，违反"先方案确认再实施"的流程要求。已补交 [docs/prototypes/decision-board-ui-demo.html](../../docs/prototypes/decision-board-ui-demo.html)（可点击原型，与已实现交互一致，含过滤/抽取状态/采纳驳回/任务/反馈/人工补充/已驳回开关/归档只读；数据为真实模型试跑合成样例），并在会话内以交互可视化呈现待用户确认。用户确认结论与调整要求另行记录于本节；未确认前不宣称 UI 验收。

## 实现

- `extensions/business-plugins/decision-board/`：`types.ts`（域类型与证据置信映射）、`storage/store.ts`（SQLite `decision-board.sqlite3`，schema v1，参照 case-store 安全打开模式；启动 reconcile running→interrupted）、`extraction/normalize.ts`（抽取 JSON 归一化纯函数，置信度不取模型自评）、`session/workspace.ts`（系统提示/工作区/提示词构造，`defaultTools: []`，报告 UTF-8 严格解码、20,000 字符截断）、`api/routes.ts`（Host 拥有传输）、`ui/DecisionBoardPage.tsx` + `decision-board-client.ts` + `decision-board.css`。
- `src/host/decision-board-sessions.ts`：Interface v1 域 `decision-board-extraction`（owner `{projectId, extractionId}`，触发时当前配置快照，单轮无工具，完成后归一化落库；stop/closeAll/interrupted 收尾）。已加入 [check-agent-session-boundary.mjs](../../../scripts/check-agent-session-boundary.mjs) `domainRegistrars`（与 requirement/verification 同例的 Host 适配器）。
- `src/host/server.ts`：路由挂载（`/api/decision-board*`）、`projectBusy` 纳入抽取运行（归档空闲准入）、`closeAgents` 协调、关闭顺序。
- 前端：App.tsx `decision` 视图渲染扩展页（占位 `DecisionPage.tsx` 已删除）；styles.css 移除占位专属样式；帮助内容、[user-manual.md](../../../docs/user-manual.md)（由 help-content 重新生成）与 README 更新。

## 检查

- `npm run check` 全量通过：agent-session 边界 PASS、505/505 测试、构建成功。开发期间观察到一次未定位的偶发单测失败，其后两轮全量均为绿。
- 新增测试：`decision-board-store.test.ts`（7：登记/观测、单报告单抽取、重抽保留已决与人工、状态机、任务/反馈、重开 reconcile、失败保留）、`decision-board-normalize.test.ts`（6，含逐字引用剥离）、`decision-board-host.test.ts`（2：真实 Host 子进程 + 合成 Provider 的完整闭环与失败路径）。
- 浏览器回归（补交，2026-10-31）：`tests/browser-decision-board.js`（隔离 QA：synthetic Provider 按模型名键控固定抽取回复；覆盖 DB01–DB11 的 UI 路径：聚合/归档只读/导航与过滤零模型调用/抽取计数/置信度与原文引用/采纳驳回理由校验/任务流转/反馈星标/人工补充/已驳回开关/重抽重建/390px 无横向溢出/页面异常与外部请求为 0）。两次全新环境连续 PASS，日志 `.local/decision-board/browser-run-green.log`；为此给看板开关补了 `#dismissed-toggle` 等稳定锚点 id。
- 浏览器点验（隔离 QA：Host 4185 + UI 4183 + 合成 Provider，证据 `.local/decision-board/qa/`）：抽取→证据展开（原文引用）→采纳→添加任务→完成→回录反馈（★评分）→人工补充；驳回理由 <2 字禁用提交、合格理由留痕；报告变化提示与重抽；归档项目重新抽取禁用、人工补充提交禁用、过滤器标注"（已归档）"；"已驳回 N"开关显示只读驳回卡（含理由）；控制台无错误。
- 隔离 QA 进程已停止；`.local/decision-board/qa/` 保留配置、日志与两张截图（board-final.png、board-archived-readonly.png）。

## 未验证 / 边界

- ~~真实模型端到端试跑~~（已于同日完成，见下节）；MacBook 体验未进行。
- 非作者独立复核、Git/CI 交付与合并 main 未进行，按工程规范另行请示。
- 置信度为证据等级固定映射（0.90/0.75/0.55/0.35），不是统计校准；抽取失败不自动重试；报告变更检测用字节数（sha 在抽取时核对）。
- 飞书推送、汇报模式、teach 校准注入不在本期。

## 非作者独立复核与作者处置（2026-10-31）

独立复核见[review/independent-review.md](review/independent-review.md)：**PASS with findings，0 阻断 / 9 建议**；复核者实测 15/15 专项、`npm run check` 506/506、自跑浏览器回归全流程（含 Provider 恰 2 次调用、重抽保留逐项核对）。

作者处置（修复后受影响范围重验：专项 19/19、双浏览器回归全新环境 PASS、`npm run check` 506/506 + 构建成功）：

- **已修复**：①归档/关闭竞态下看板写端点误报 500 → routes 补 `project_busy`/`host_closing`/`file_not_found`/`report_changed_during_extraction` 映射；②非 060_reports 路径先校验再读文件（DB11 口径，不再先读入 010_draw/020 内容）；③抽取记录 sha 改为对实际送模型的字节计算并核对观测长度一致（消除双读竞态）；④能力目录 decision-platform 条目与详情弹窗改"已接入"并条件渲染状态/页脚（`catalog.test.ts` CAT-03、`browser-catalog.js` 相应更新）；⑤弹窗提交失败错误同时显示在模态内（`BoardDialog` 透传 `role=alert`）。
- **记录决策不改码**：④变字节数检测维持现状（已记边界）；⑥存储持续故障时抽取行可能滞留 running 至进程重启（重启 init reconcile 兜底；存储不可用时无更优写入路径）；⑨任务状态 API 允许任意方向流转（UI 限制单向；保留显式纠错能力）；⑧残留 QA 进程已由复核者清理，作者复查无孤儿进程。

## 真实模型端到端试跑（2026-10-31，用户授权预算不设上限）

隔离环境：复制本机 `settings.json`/`auth.json` 至 `.local/decision-board/realtest/data`（隔离 dataRoot/projectsRoot，未触碰真实项目库；密钥未落仓、未外传）。合成数据：确定性生成 1,600 会员 / 2,207 订单（9、10 月各 800 首购，高价值复购下滑、渠道差异内嵌），证据 `dataset/`。

- **分析**：MiMo V2.6 Pro 真实任务约 9 分钟完成，产出 `060_reports/repurchase_report.md`（12.6KB）与可复算脚本；口径核对、分层显著性检验、假设/反证/未知分列、6 条带依据建议；并据实指出唯一显著跌幅在渠道C（-21.1pp, p=0.0049）而非简报暗示的渠道A，属数据驱动的诚实结论。
- **抽取第一轮**（MiniMax M3.1 Flash，~26s，7 条）：证据四级/置信映射全部正确；原文引用 18/20 逐字命中，2 条为近似改写（各少一字，非编造）。
- **守卫补强**：新增 `enforceVerbatimQuotes`（session/workspace.ts 纯函数，Host 完成抽取时对 `reportExcerpt` 逐字校验，不逐字的 quote 剥离、保留事实文本，不伪造引用），配纯函数测试；重启后重抽（6 条，~35s）**15/15 引用全部逐字命中**。该补强源于真实模型试跑发现，属 DB04 的确定性保证。
- **决策闭环**（真实条目经 API + UI 核验）：采纳"专项核查渠道C"→ 添加任务（负责人/截止日）→ 完成 → 回录反馈（★★★★☆）；驳回"指标字典周监控"留理由；重抽按规则仅重建 suggested，已决项保留。UI 截图 `board-real-model.png`，看板状态 `board-after-extract.json` / `board-after-reextract.json`。
- **检查**：补强后 `npm run check` 全量 506/506 通过、构建成功。费用：Host 未内置用量账本，供应商侧结算未采集；按用户授权未设预算上限。
- 模型两次抽取条目数/措辞不同属正常非确定性；单轮成功不构成模型质量结论。隔离 Host/浏览器进程已停止，`.local/decision-board/realtest/` 保留全部证据。

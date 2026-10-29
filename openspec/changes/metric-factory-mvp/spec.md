# metric-factory-mvp

2026-10-29 · 讨论候选：本规格与 [UI 演示](clickable/index.html) 同步提交用户确认；确认后申请实施授权，当前不改产品代码。

已确认决定：形态 C（Agent 会话建模 + 资产页审核发布）；已发布定义存全局文件知识库 `~/.optracall/metric-assets/`，消费通路为系统提示注入索引 + Agent 原生 read/grep 直读；项目级启用记录为独立文件；SAP 首期子集（格式标记 `sap: 0.2`，与 JuanerAI 0.1 不兼容）；Qoder 自包含模块 + Codex 薄挂载；文件格式 YAML 并新增 `yaml` 依赖。

## 范围与责任

第一个真实业务插件：metric-factory 是工厂，SAP 包是分析资产，Agent 是消费者。用户在 Pi 会话起草指标体系（SAP 草稿落 020_clean），在侧栏"指标体系"资产页完成人工审核并发布到全局库，按项目启用精确版本；分析会话的系统提示注入启用索引，Agent 按需直读库文件引用口径并注明指标与版本。

Qoder 交付 `extensions/business-plugins/metric-factory/` 自包含模块（SAP 校验器、canonical 序列化与双指纹、全局库存储、项目启用记录、资产页 React 组件、HTTP handler、合成 fixtures）；Codex 薄挂载（`server.ts` 注册路由、`App.tsx` 导航与页面、`project-session.ts` 调用索引注入函数）。单包单构建，模块不是独立 npm 包；不建插件注册框架。

## 验收标识（全部使用合成数据）

| 标识 | 可观察验收 |
| --- | --- |
| MF-01 | SAP 0.2 校验器：合成样例通过；`origin=llm` 缺 `reviewed_by` 拒绝；指标/场景交叉引用悬空拒绝；same-content 拒绝重发；版本覆盖拒绝；canonical 序列化与双指纹稳定可复算。 |
| MF-02 | 全局库：发布写入 canonical YAML 与 index.json，目录 0700／文件 0600；重启读回一致；损坏报错不清空不覆盖；未发布草稿不入库；020_clean 草稿在发布后原样保留。 |
| MF-03 | 资产页：库列表／搜索／详情（指标、场景、版本历史、各项目启用状态）；"发起建模任务"在项目内建普通任务并预填建模引导草稿；可从 020_clean 导入草稿并展示逐项校验结果；发布须完成人工确认（审核人 + 逐项口径确认），未完成时发布不可用并说明原因。 |
| MF-04 | 项目启用：启用／停用／升级精确版本写 `~/.optracall/projects/<id>/metric-assets.json`，不自动跟随新版本；启用后分析任务的系统提示含启用索引（包、版本、指标名、库文件路径、引用需注明版本），不注入全文本。 |
| MF-05 | 端到端合成闭环：建模任务产草稿 → 人工审核发布 → 项目启用 → 新分析任务实际引用口径并在结论注明指标与版本；发布与启用均为用户显式动作，无自动调模型或自动发布。 |
| MF-06 | 对照观察（记录项，不设硬阈值）：同一合成问题在未启用／已启用资产两种条件下的口径引用与追问差异，形成观察记录供产品判断上下文增益。 |

## 允许修改

`extensions/business-plugins/metric-factory/`（新建全部）；`src/host/server.ts`、`src/host/ui/`（路由与页面挂载）；`src/agent/project-session.ts`（索引注入调用）；`package.json`／lockfile（新增 `yaml`）；`tests/`；`openspec/changes/metric-factory-mvp/`；README 与 docs 适用条目。不改 SDK 版本，不动 `project.json` schema2，不新增项目目录（三目录规则不变），不预装 Pi skill，不新增第二个 Runtime 或插件调度平台。

## 关键边界

Agent 对全局库只读；发布／启用／升级是用户在资产页的显式动作，`origin=llm` 的指标未经 `reviewed_by` 不得入库；建模草稿是普通会话产物，Host 不指定建模步骤；未发布草稿不进入分析索引；本插件不执行指标计算（定义是资料不是执行代码），Agent 自行在 020_clean 数据上计算；公开仓库只含校验器与合成样例，用户真实口径留在本机；提示词索引是软引导，不做读取拦截。

## 适用检查

校验器与全局库按 TDD 先行（纯函数优先）；Host 挂载与索引注入纳入既有 HTTP/UI 测试与浏览器合成 fixture 回归；完整候选走非作者独立复核与 CI（`npm run check` + 依赖审计，覆盖新增 `yaml` 依赖），Git 交付按工程规范第 5 节执行。

## 未决问题

无。UI 细节以 [clickable 演示](clickable/index.html) 确认为准，确认后冻结为本变更验收组成；演示中标注的交互（视图切换、发布门槛）为验收对照，静态演示本身不构成实现证据。

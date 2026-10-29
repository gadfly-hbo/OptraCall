# requirements-elaboration

2026-10-29 · 讨论候选提交（规格 + [UI 演示](clickable/index.html)）。2026-10-30 用户确认方案并授权开发；实施按本规格完成，验收证据与未验证范围见[结果记录](result.md)。

已确认决定：核心 4-Stage 链路先行，材料挂接+ShieldCheck、模板库、CLI、Receipt 对账后置；需求实例为独立实体，文件式存储于 dataRoot；LLM 走独立插件会话（首个调用模型的 Extension 业务插件），会话入口按 A 路线由 Qoder 最小泛化现有链路（`project-runtime.ts`→`project-session.ts`→`server.ts` 会话管理段）、Codex 事后专门复核该接缝；门禁遵循产品原则「不指定分析步骤、不以固定阶段切断分析」，采用软门禁三级模型（结构完整性硬校验仅限发布时／一致性警告不锁死／业务完备性仅提示）；数据边界沿用现状软约束、无 ShieldCheck；送入路径进首期；简化提案卡（预览→采纳/放弃，无逐字段 diff）；三个模型调用点（Stage 01 首轮推断、Stage 02 按需辅助生成假设、Stage 03 框架生成）均走插件会话并要求结构化 JSON 输出。参考仓库 [requirements-elaboration](https://github.com/gadfly-hbo/requirements-elaboration) 仅作概念与字段设计参考，不搬代码、不引入其运行时（vendored pi-agent-runtime／pi-ai 自建客户端形态被工程规范禁止）。

## 范围与责任

第二个业务插件：需求梳理是设计态前置环节。用户以一句话诉求发起需求实例，经四阶段（诉求澄清 → 事实与假设 → 分析与报告框架 → 检查与发布）把模糊业务诉求固化为带指纹的已确认需求快照与分析框架，发布为不可变 RAP 契约包（格式标记 `rap: 0.2`，含 scene 分流 daily/topic/recurring，无 materials 段，与参考仓 0.1 不兼容），再由用户显式送入 Case、项目或任务会话作为分析上下文。分析运行时的 Agent 自主性不变：插件不指定分析步骤，RAP 是资料不是指令。

Qoder 交付 `extensions/business-plugins/requirements-elaboration/` 自包含模块（实例 schema 与原生校验、`~/.optracall/requirement-instances/` 存储、确认快照与指纹、RAP 打包发布、软门禁计算、插件会话调用与结构化输出解析、4-Stage React 组件、HTTP handler、合成 fixtures）；Codex 责任限两处：薄挂载（`server.ts` 注册路由、`App.tsx` 导航与页面）与 D2 接缝复核（会话入口泛化改动）。单包单构建，复用已有 `yaml` 依赖，不建插件注册框架，不新增 zod／tsup／vitest。

## 验收标识（全部使用合成数据）

| 标识 | 可观察验收 |
| --- | --- |
| RE-01 | 实例与契约：实例 YAML CRUD 于 `~/.optracall/requirement-instances/<id>/`（目录 0700／文件 0600，仿 metric-assets 先例）；「确认成正式需求」生成带指纹的不可变快照；RAP 发布写 `requirement-instances/releases/<id>/<version>.rap.yaml` + index.json；schema 校验、指纹稳定可复算、同版本同指纹幂等、同版本异指纹拒绝；重启读回一致，损坏报错不清空不覆盖。 |
| RE-02 | 软门禁：澄清项状态机（answered/assumed/skipped/deferred）与假设状态流转（proposed/confirmed/rejected/deferred）正确收敛；三级检查清单（结构完整性／一致性／业务完备性）计算正确；上游字段变更使既有快照标 stale 并提示再确认，不阻断编辑与 Stage 跳转；发布时仅结构完整性硬校验阻断。 |
| RE-03 | 插件会话：经泛化入口以需求实例为会话归属建会（无项目上下文），凭据走 config-store 快照注入；三个调用点结构化 JSON 输出可解析、格式失败可重试；事件经 SSE 到前端；停止／失败路径可观察；合成 provider 全覆盖。真实模型试跑另行授权并单独报告，不在本验收内冒充。 |
| RE-04 | 4-Stage 工作台：侧栏「需求梳理」入口与实例列表（状态徽标：草稿/已确认/已发布/stale）；四阶段自由跳转与随时编辑；行内澄清操作（回答/按假设推进/跳过/后置）；确认快照动作；软门禁分色可视化（硬/警/提示）且不阻断；简化提案卡预览→采纳/放弃，放弃后工作稿零改动；发布 RAP 及发布物预览。 |
| RE-05 | 送入：从已确认或已发布实例显式「送入」，发送任务时把框架结构化摘要（目标、口径、数据需求、分析路径、报告树、open questions）注入任务上下文（复用 Case 背景注入模式）；用户显式选择关联实例，无自动注入；实例后续变更不回写已发送任务。 |
| RE-06 | 端到端合成闭环：一句话诉求 → 首轮推断 → 澄清收敛 → 确认快照 → 框架生成 → 发布 RAP → 送入新任务并可在任务上下文观察到注入摘要；全链只用合成数据与合成 provider。 |

## 允许修改

`extensions/business-plugins/requirements-elaboration/`（新建全部）；`src/agent/project-runtime.ts`、`src/agent/project-session.ts`、`src/host/server.ts`（仅限会话入口泛化与路由挂载，A 路线，Codex 复核接缝）；`src/host/ui/`（导航与页面挂载）；`tests/`；`openspec/changes/requirements-elaboration/`；README 与 docs 适用条目。不改 SDK 版本与 lockfile 既有依赖，不动 `project.json` schema2、case-store 与三目录规则，不新增项目目录类型，不建第二个 Runtime、插件调度平台或凭据自主发现。

## 关键边界

插件会话不配置数据目录访问工具（需求梳理不做数据分析，不触碰 010/020/060）；Host 不指定梳理步骤，门禁仅建议性，唯一硬校验是发布时 RAP 自身结构有效性；快照与 RAP 落 dataRoot 本地，不入 Git，公开仓库只含校验器与合成样例；无 ShieldCheck，前端提示与现有产品一致（不承诺敏感数据隔离，勿放敏感数据）；确认、发布、送入均为用户显式动作，模型输出一律先进提案卡或草稿态，不直接覆写用户工作稿；参考仓的多模态材料、模板库、CLI、Receipt 对账不在本变更范围。

## 适用检查

RE-01／RE-02 纯函数 TDD 先行（schema 校验、指纹、状态机、检查清单）；RE-03 合成 provider 测试 + 会话生命周期（创建/事件/停止/失败）纳入既有测试布局；RE-04／RE-05 浏览器合成 fixture 回归；D2 接缝改动由 Codex 专门复核并记录；完整候选走非作者独立复核与 CI（`npm run check` + 依赖审计），真实模型试跑另报，Git 交付按工程规范第 5 节执行。

## 未决问题

无。UI 细节以 [clickable 演示](clickable/index.html) 确认为准，确认后冻结为本变更验收组成；演示中标注的交互（Stage 跳转、软门禁状态、提案卡、送入）为验收对照，静态演示本身不构成实现证据。

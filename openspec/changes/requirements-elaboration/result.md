# requirements-elaboration 交付记录

2026-10-30 · Qoder 实施 · 状态：本地完整候选（真实模型试跑通过，独立复核与 CI 见下）

## 决定与范围

用户 2026-10-29 确认规格与 [UI 演示](clickable/index.html)（D1–D8 记录于[规格](spec.md)），2026-10-30 授权开发，并授权「真实模型 + 合成数据复测 → 通过后 git 提交、合并 main」。实施完全在 `openspec/changes/requirements-elaboration/spec.md` 允许修改范围内，未改 SDK 版本与 lockfile 既有依赖、未动 project.json schema2、case-store 与三目录规则。

## 交付内容

- `extensions/business-plugins/requirements-elaboration/`（新建）：`contract/validate.ts`（实例 schema、canonical YAML、快照指纹、RAP 0.2 构建）、`storage/store.ts`（实例 CRUD、不可变快照、release 库 + index.json、fail-closed）、`gates/checks.ts`（三级软门禁）、`session/workspace.ts` + `session/prompts.ts`（插件会话工作区、三个调用点提示词、结构化输出解析与提案归一化）、`api/routes.ts` + `api/context.ts`（HTTP handler、送入摘要组合）、`ui/RequirementPage.tsx`（4-Stage 工作台）
- `src/agent/project-runtime.ts`、`src/agent/project-session.ts`：会话入口泛化（可选 `workspace` 替代项目目录：cwd／系统提示／工具集；缺省行为与既有项目路径逐字节一致）
- `src/host/requirement-sessions.ts`（新建，A 路线接缝，待 Codex 专项复核）、`src/host/server.ts`（会话管理器接线、SSE `/api/requirement-instances/<id>/events`、路由挂载、配置变更/关停联动、messages 路由 requirementContext 注入）
- `src/host/ui/App.tsx`、`src/host/ui/runtime-client.ts`、`src/host/ui/requirement-types.ts`、`src/host/ui/styles.css`：导航「需求梳理」、页面挂载、附带契约横幅与 sendMessage 扩展、样式
- 测试：`tests/requirement-{contract,store,gates,session,runtime,api,context,e2e}.test.ts`、`tests/fixtures/requirement-sample.ts`、浏览器脚本 `tests/browser-requirements.js`
- `AGENTS.md` 当前变更指针更新；规格头部状态更新

## 验收证据（全部合成数据）

| 标识 | 证据 |
| --- | --- |
| RE-01 | `requirement-contract.test.ts`（canonical 往返、未知字段拒绝、双指纹稳定可复算、RAP 派生 open_questions、悬空引用拒绝）×7；`requirement-store.test.ts`（0600/0700、快照不可变+幂等、发布幂等/冲突/same-content、损坏 fail-closed）×7 |
| RE-02 | `requirement-gates.test.ts` ×5（三级清单、仅 hard 阻断、stale 仅警告、must_confirm 仅提示）；契约测试覆盖 stale 派生（上游变更失效、框架编辑不失效） |
| RE-03 | `requirement-session.test.ts` ×6（提示词嵌入、无工具工作区、JSON 解析、提案归一化/丢弃）；`requirement-runtime.test.ts` ×4（真实子进程：工具集为空、软边界系统提示直达 provider、结构化 JSON 端到端、JSONL 落实例目录、停止=cancelled 一次） |
| RE-04 | `requirement-api.test.ts` ×7（路由全语义）；QA UI（4183+合成 provider）浏览器走查：导航/新建/四要素保存/自由跳转/确认快照/三级清单分色/发布阻断与解锁/发布表格/送入对话框→聊天页附带契约横幅（RAP 版本、移除按钮） |
| RE-05 | `requirement-context.test.ts` ×3（发布版与已确认版摘要、未确认/stale/缺失 fail-closed）；`requirement-e2e.test.ts` 断言摘要进入模型请求且未知实例 404 不触达模型 |
| RE-06 | `requirement-e2e.test.ts`：真实 Host 进程全链路（创建→elicit→采纳→确认→framework→发布→送入消息含摘要）；真实模型试跑见下 |

## 检查与试跑

- `npm run check`（`npm run test` 284 项全绿 + `vite build` + stamp）通过，`tsc --noEmit` 0 错误（复核后复跑）。
- 真实模型 + 合成数据试跑（用户授权，2026-10-30，隔离 dataRoot：真实凭据仅复制入临时目录，未写 `~/.optracall`，日志不含密钥；脚本 `.local/real-model-trial.mts`，证据本地保留）：
  - 模型 MiniMax-M3.1-Flash（minimax-cn，用户已选配置）
  - elicit 18s：澄清 ×9／事实 ×5／假设 ×3，丢弃 0；确认快照 sha256:2c7d73c1bfe1…
  - framework 50s：指标 ×8／数据需求 ×8／分析路径 ×4／报告树 ×9／open_questions ×12，丢弃 0；发布 1.0.0（openQuestionCount 15，含派生后置项）
  - 送入分析 83s completed：任务回复 2113 字符，内容引用契约口径/需求
  - 结论 PASS；模型输出质量为观察项，未设阈值

## 浏览器走查中发现并修复的问题

1. Stage 2/3 生成中缺少停止按钮（仅 Stage 1 有）→ 已补齐
2. 送入对话框使用 App 传入的陈旧项目列表（新建任务后不刷新）→ 改为挂载即自取最新列表并在新建后刷新
3. Stage 3 流式区 `<pre>` 嵌套于 `<p>`（无效 HTML，控制台报错）→ 已移出

## 独立复核与 CI

- 独立复核（非作者 Agent，2026-10-30，对固定候选 6108e9f 只读复核）：实际运行 `npm run test`（282 项全绿）与 `npx tsc --noEmit`，抽查快照指纹、发布幂等/冲突、送入注入与允许修改边界。结论 **PASS-with-notes**，发现与处置：
  1. 【中】stale 门禁文案「可带警告发布」与发布实际要求有效快照矛盾 → 已修正文案（发布要求有效快照，属结构完整性「指纹一致」范畴；编辑与跳转不受影响）
  2. 【低】`src/host/requirement-sessions.ts` 不在规格允许修改字面清单 → 规格已追认（A 路线接缝组成）
  3. 【低】测试缺口：模型失败 502、busy 409、requirement SSE 事件 → 已补 `requirement-api.test.ts` 两例与 e2e SSE 断言（总数 282→284）
  4. 【信息】SSE 路由 id 长度正则与 store 微差 → 已对齐 `{0,60}`
- 复核未覆盖范围（复核者如实说明）：browser-requirements.js 未以 Playwright 驱动执行；真实模型试跑未复测（作者记录见上）；RequirementPage.tsx 未全文精读。
- CI：PR 检查（Ubuntu/Node25.9.0 `npm run check` + 依赖审计）通过后合并；实际状态以 PR 与 Git 回读为准。
- A 路线 Codex 对 `requirement-sessions.ts`／`project-runtime`／`project-session` 接缝的专项复核：待执行（不阻塞本次合并，结果另行记录）。

## 边界与未验证项

- 真实业务数据未接触；实例内容全为合成。插件会话 `defaultTools: []`（无数据工具）已在真实子进程测试中验证。
- 提案卡在 UI 中为简化版（采纳/放弃，无逐字段 diff），采纳后进入草稿态仍可编辑——按 D7 确认。
- 浏览器自动化对 `<select>` 的交互受限（工具限制，非产品缺陷），项目/任务选择经 fill 原生路径验证通过。
- `tests/browser-requirements.js` 供既有 QA 流程使用，未在本机以 Playwright 驱动执行（本机无驱动；等价路径已由浏览器走查覆盖）。

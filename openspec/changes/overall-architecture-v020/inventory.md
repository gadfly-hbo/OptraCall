# v0.2.0 现状、复用与模块差额

核对日期：2026-11-15。原始源码盘点固定 `f5592518cbe6d27552501a3ed46a757c363857f0`；收尾新增main提交后，当前工程基线已安全快进至 `3ebaa01d2fd6d81a6605f408f9f414a4b8bd7a19`，分支 `OC｜upgrade-v0.2.0`。第2–4节保留原固定源码定位，第6节记录最新增量与影响，避免把旧行号冒充新代码身份。这是源码及原文档盘点，不是运行采用、专业正确性或最终实现独立复核结论。

代码发现优先使用本工作树新索引 `optracall-upgrade-v020-e741`（13,156 nodes / 39,840 edges，fast，无仓库持久artifact）；按 search_graph / trace_path / get_code_snippet 查实际符号，配置、Skill正文及未被图覆盖的内容作定向补读。索引未覆盖部分脚本和文档，不将图无命中当全仓绝对不存在。

## 1. 七模块概览

| 模块 | 当前可复用 | 尚须完整改造 | 当前完成判定 |
| --- | --- | --- | --- |
| M1 战略与目标 | 企业背景、SAP指标、Case/Project关系、准确选择和看板反馈 | BSC目标及关系、同源企业GSA、部门/个人贡献、Case目标、变更影响与三层反馈 | 新增管理域及接缝，未实施 |
| M2 项目需求与任务 | 需求草稿/确认/未发布框架送入/RAP发布、独立Task、共享资料、准确Case上下文 | 轻量必经项目方案、开放MECE覆盖vs重点、能力选择、一次确认创建/开始、依赖/综合责任、Task归档恢复 | 基础存在，项目承接未完成 |
| M3 执行与综合 | 原Pi执行、Skill/脚本、SAP/语义读、父资源subagent、报告记录 | 项目TOC/TP、已选方法实际采用、正式Skill新契约、跨Task成果协作和准确综合、阶段交付 | 多会话/子Agent不等于跨Task综合 |
| M4 审查及决策反馈 | 绑定报告保存、准确稿审查、意见带回草稿、原Agent修订基础、Case/看板 | 自动接续原作者、跨修订接续的逐稿状态、明确原话代办人的记录、GSA承接、去重及部分成功 | 现有草案工具不能代填人的选择/实际反馈 |
| M5 方法与资产 | SAP提炼method/reuse/none、候选/发布、修订派生、错误提示/停推荐、Studio及记忆治理 | 自动触发、跨原模块真实发现连接、实际引用纠错、纠错后新Task复用验证 | 复用原治理，连接与真实采用未证 |
| M6 自动模式 | 原会话占用/停止/资源收尾、请求回执、旧核算历史及UNKNOWN处理 | 唯一全局五节点、动作开始前读值、跨Task生效、关不强杀/停不续跑、无追溯及节点实接 | 旧任务级开关不能充当新版全局控制 |
| M7 导航与市场 | 原目录及准确能力跳转、业务/配置页面 | 一级入口取消、设置过渡、业务与管理/异常回路迁移、仅取消场景组合、按判据退出 | 一级市场仍存在，迁移未实施 |

## 2. 管理、项目与任务证据

| 现状事实 | 固定源码定位 | 对实施的含义 |
| --- | --- | --- |
| Case没有目标引用 | `src/host/case-types.ts:10` `CaseRecord` | 新主目标/关联目标不能靠现judgement/nextStep冒充；旧Case后补保留真实时间 |
| 未发现现成BSC/GSA域 | 图对src/extensions的BSC/GSA/primaryGoal/goalId/strategicGoal定向查询无命中，结合Case/Task类型核对 | 新增目标域但复用SAP、Case及原选择，不造第二份企业指标/行动事实 |
| Case↔Project及准确上下文已有 | `src/host/case-store.ts:814` 关系操作；`:990` `prepareTaskContext` | 复用真实Project/Case范围及固定版本，扩目标和项目方案引用 |
| Task目前只有单个创建，缺归档/综合字段 | `src/host/project-store.ts:15` `TaskRecord`，`:248` `createTask`；`:235`附近为项目级archive/restore | 项目归档不等于Task归档；新元数据/严格解码/兼容需同片验证 |
| 原分析框架不是项目任务方案 | `extensions/business-plugins/requirements-elaboration/contract/validate.ts:19` `FrameworkDocument` | 原metrics/dataNeeds/analysisPaths/reportFramework等保留；新增覆盖/重点/所选Task/依赖/综合/能力契约 |
| 已支持未发布但确认的frameworkVersion | `src/host/server.ts:697` `prepareRequirement`；`tests/requirement-context.test.ts:34` | 不反向加入“必须先发布RAP”门槛；测试存在，本轮未运行 |
| 仍为逐Task送入再发送 | `extensions/business-plugins/requirements-elaboration/ui/RequirementPage.tsx:537`、`:561`、`:590`；`src/host/ui/App.tsx:388` | 新增项目一次确认创建/启动接续，不能只改按钮文案 |
| 原框架审查允许按需读项目数据 | `extensions/business-plugins/requirements-elaboration/session/prompts.ts:230` `frameworkReviewInstructions` | 新Project准备须收窄为诉求/清单/已有说明/前提；旧Task需求及原用途分开，不预先试算/归因 |
| 原任务创建/发送沿统一会话 | `src/host/server.ts:1146`、`:1154`、`:1414`、`:1428`、`:1453` | 从原createTask/projectSessions接入，不自建SDK调用或运行队列 |

## 3. 分析、成果、反馈和资产证据

| 现状事实 | 固定源码定位 | 对实施的含义 |
| --- | --- | --- |
| 系统提示词为通用分析/证据边界 | `src/agent/project-system-prompt.ts:1` `projectSystemPrompt` | 需交付项目TOC/TP、确认方法和综合责任；提示词存在不能证明实质采用 |
| subagent是父Resource内存子会话 | `src/agent/project-session.ts:466` `runSubagent` | noSkills/noContextFiles的子调用不是项目多Task综合，仍需准确任务成果读取及综合责任 |
| 运营Skill旧契约冲突确在有效本体 | `extensions/analysis-assets/data-analysis/SKILL.md:30`六段，`:52`无责任人不建议，`:72`回答即交付物/文件副本 | 正式修订诊断/计划、完整报告/聊天摘要，保留适用专业检查 |
| 校验脚本也固化行动四要素 | `extensions/analysis-assets/data-analysis/scripts/quality_check.py:144`–168 R2及`:387`–409自测 | 本体、reference、脚本/示例和独立测评需一起核对，不只改Host提示词 |
| 报告有绑定保存及UNKNOWN基础 | `src/host/project-files.ts:14`–38；`src/host/project-store.ts:516` `writeBoundReport` | 复用owner/060、hash/readback及不覆盖，增加真实版本关系和技术去重 |
| 结论审查带回仅写草稿 | `src/host/ui/ConclusionReviewPanel.tsx:304` `carry`；`src/host/server.ts:1247` | 目前提示核对后发送；新版获准自动接回尚须实接原作者和停止/版本规则 |
| Agent Case工具只写草案 | `src/host/case-decision-service.ts:240` `saveForAgent`；`:259` `choose`独立人端 | 新原话代办需证明明确选择/准确版本/来源权限，不能从工具现状推定已有 |
| IR已有真实来源及三种判断 | `src/agent/sap-method-extraction.ts:43`–45；`src/host/sap-method-sessions.ts` `createSapMethodSessions` | 复用source-reader、源Task/截止位置和原候选，不新增IR平台 |
| SAP有内容去重、修订派生、发布及错误治理 | `extensions/business-plugins/metric-factory/methods/store.ts:141`–239 | 先用原机制；新增节点连接与后续任务避错必须单独证明 |

Studio、记忆、Case、SAP各自权威和人的控制沿其原规格及接入说明；本轮不把旧模块工程记录写为本次真实质量已通过。详细受影响工具/权限适配在实施切片固定后再核实际调用链和完整候选。

## 4. 自动模式与导航证据

| 现状事实 | 固定源码定位 | 对实施的含义 |
| --- | --- | --- |
| 旧核算设置按project/task保存 | `src/host/automatic-verification-store.ts:86`、`:134`–146；`src/host/automatic-verification-types.ts:10`–25 | 不是一份全局五节点设置，不直接改名套用 |
| 启动捕获settingsSnapshot，设置变更可停链 | `src/host/automatic-verification-host.ts:147`–156、`:180`–181、`:200`–201、`:123`–146 | 新版需动作开始前读当前值、关闭不强杀；保留旧链语义和历史回执 |
| 当前默认走结论审查，旧核算入口有限保留 | `src/host/analysis-review-transition.ts:8`–27；`src/host/server.ts:1283`、`:1288`、`:1465`–1473 | 不能把legacy自动链当当前日常自动接续已存在 |
| 公共stop和旧链UNKNOWN保留可复用 | `src/host/agent-sessions.ts:480`；`src/host/automatic-verification-host.ts:455`–460 | 复用停止/实际收尾；重启活链未知不自动重放，不等于旧资格恢复 |
| 一级市场仍存在，设置未承接 | `src/host/ui/App.tsx:555`–559、`:575`–578 | 迁移导航与设置入口，保留原历史定位及异常回路 |
| 场景组合及六项展示确在目录 | `src/host/ui/catalog-data.ts:3`、`:35`–38、`:54`–59 | 仅这组直接取消，不把其他能力/规划一并删除 |
| 准确能力跳转可复用，返回仍依赖市场 | `src/host/ui/App.tsx:290`、`:322`–330、`:594` | 使用/管理入口之外还须核返回原工作、缺配置和异常路径 |

## 5. 允许修改路径与约束

本次准备仅新增本变更目录文档及原 `docs/prototypes/overall-architecture-v020-ui-demo.html`；按用户纠正另新增 `docs/prototypes/overall-architecture-v020-v0.2/` 新版，原Demo不覆盖，现有产品保留与增量见ui-baseline。原本地证据在 `.local/overall-architecture-upgrade/preparation/`，UI重做保全与观察在 `.local/overall-architecture-upgrade/ui-revision-v0.2/`；外部产品稿位于spec所列仓库外路径。未修改产品源码、测试、依赖、schema、规则入口或历史变更，原CSS只读复用。

后续受已确认spec/UI及有效授权约束的候选修改区域：

- `src/host/`：管理/项目方案/Task/成果/自动设置的原权威与窄适配、HTTP和统一会话接缝；新增文件限这些已定业务职责。
- `src/agent/`：上下文、原工具/来源及报告/方法采用的接入，不另建推理循环。
- `src/host/ui/` 及原样式：导航、目标、Project、Task、综合成果、审查反馈及设置。
- `extensions/business-plugins/requirements-elaboration/`、`metric-factory/`（SAP原库）、原Studio/决策相关模块：各自原契约与管理权威，避免复制存储。
- `extensions/analysis-assets/data-analysis/`：正式Skill契约相关本体/随包资料/脚本/模板，须先读分析类Skill规范及独立测评接入门槛。
- `tests/`：需求导出的确定性行为、兼容、跨模块及禁止副作用回归；`scripts/`只在既有边界检查确需适配时修改，不扩大白名单求通过。
- 本变更文档、对应用户操作说明及审核过的Demo；公共契约变动先IN06记录。

不改官方SDK、安装目录、其他工作树、真实资料/会话、旧失败证据或产品基线。精确文件清单随实际切片在implementation更新，并用暂存/未暂存/新增清单核验；不是对整个目录任意重写的授权。

## 6. 最新main增量核对：3ebaa01（PR #74）

最终回读发现main在本轮准备期间新增 `fix(memory): preserve candidate composition and source governance`。重新fetch后仅在本任务分支执行 `git merge --ff-only origin/main`，未提交本轮材料、未推送、未更改本机main或其他工作树。六份准备材料完整保留，原候选/复核收据及快照另存；新图索引 `optracall-upgrade-v020-e741-3ebaa01`（13286 nodes/40092 edges）按最新源码增量核对。

新增可复用能力是：候选直接/合法nested保存到原native的custom正文与准确保存确认；人工经验准确读取时附直接候选来源当前治理提醒，保护被排除来源文字，经验自身正文/版本/治理不被来源状态级联改写，保留预算、续页和当时历史边界。读取与人工lookup继续各自合同，不为去重另造统一检索层。

| 最新源码定位 | 已有基础及本轮复用边界 |
| --- | --- |
| `src/agent/project-session.ts:307`–366 `createCandidateTools`；`src/host/agent-candidate-reader.ts:27`–47、`:131`–155 | 直接/合法nested统一新custom正文及准确确认；旧toolResult只读兼容，无确认仍UNKNOWN，候选保存与父任务终态分开 |
| `src/agent/tool-context-adapter.ts:32`–69 | AsyncLocalStorage只传原父调用资格，拒绝旧parent/跨run和异步迟到子写，不重建会话树或运行账 |
| `src/agent/project-session.ts:501` `runSubagent`（由原466行移动） | 父Resource内存子会话合同保持，仍不等于项目多Task综合；第3节原行号保留其f559251身份 |
| `src/host/personal-context-reader.ts:93`–104、`:225`–242；`src/host/personal-source-governance.ts:15`–68 | retained experience准确content/read/prepare附直接来源治理，单账快照、8准确ref/4096 UTF-16；排除不泄漏自由文字，坏账/hash冲突UNKNOWN，正文可读性另核 |
| `src/host/personal-context-history.ts:22`–49；上游memory-retrieval-boundaries记录 | 旧receipt缺附注保持未提供，不用今天治理回填；Agent find与人工lookup各自匹配/分页/正文合同继续保留 |

此增量不新增BSC/GSA、Project一次确认、多Task综合、全局五节点或市场迁移，七模块差额和推进顺序仍成立；M5必须直接复用新候选/治理读口，不重建其机制。候选已可读/来源治理提示存在不等于专业错误已修正、记忆已由人治理或新Task已实际避错。精确源码与非作者增量核对见implementation；上游工程/CI/运行采用沿原PR记录，本轮未重跑或继承其结果为本轮实现通过。

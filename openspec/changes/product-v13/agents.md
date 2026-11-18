# 角色会话与专业 Skill

固定要求见 spec.md 引用的 Agent／Skill 补充。Interface v3、Pi 1.4.0、工程规范 v1.12 IN01–IN07。战略沿已保存 discussion，目标用管理范围及准确目标或独立草稿，Case 用 caseId 与独立事项，项目用 projectId。各角色只消费当前 Host 授权的范围、工具和准确来源。保留原 Pi session、操作回执与中止机制。新角色和原战略的专业判断均由 Agent 完成。

实施清单：

- 冻结五项专业候选及夹具，登记目录与内容身份。需求交可判定委托，计划交可检验的经营行动，决策交可追溯的人选取舍，执行核授权与实际，反馈对照预期、观察及改判。现有运营数据分析、投放/发券/目标测算、PPT 和研究各服务不同交付。候选限用户授权材料，无包依赖或脚本。
- 核四份角色提示词和实际 Pi system prompt，正常入口连接同一 owner 的模型、来源、操作回执和停止。
- 开放业务端只读来源和讨论；取舍、采用、真实行动沿原授权入口。重开、配置变化及撤权前复核准确历史。
- 补实际入口验证与逐条交回，独立测评由用户组织，回执按候选版本登记。Analysis 沿 data-analysis 2.0.0-candidate.1。

## 五项初版候选

目录为本变更下的 `skill-candidates/<名称>/`，每包只有 `SKILL.md`，版本均为 1.0.0-candidate.1，纯 Markdown，无工具或运行依赖。自检夹具在同目录的 `skill-selfcheck.json`，各行顺序是用户任务、合成输入、允许的交付及错误反例；每组依次是两个不同业务分支、缺失或冲突、相邻意图。独立评测方可另备留出题。下表摘要按原候选算法，对相对路径、NUL、文件 SHA-256、LF 串接再取 SHA-256。

| 候选 | 完整目录 SHA-256 |
| --- | --- |
| business-decision | `7ddf4d9a9e5db340937a86d60b741183f14daaf562d50281d8448c55133b6cbf` |
| business-do | `2acef72c72cb93e413c3c98d54e44653008afec7b0b501f75a357dcdbe27d5a2` |
| business-plan | `f9eda2b8b3c1f7b535e20d9533aeeaec9a2408afb99917209e70c660c9b4011d` |
| business-requirement | `5ca1b38fae5785d8261431a9b6afee343cfc2f42d78bfb78bbaef3538d8efd70` |
| business-teach | `961cf3319eb897bdcc471d14a45ca9050e57ea6131be092227f3fbd2a9c01ba7` |

作者按夹具逐条对照正文的承接、分支与交付界限。20 项设计覆盖独立分支和应拒绝的示例，名称、版本、文件身份、夹具结构核对通过。证据 `.local/product-v13/roles/skills-{red,green}.log`。尚无独立模型激活、误触发、业务质量、耗时或收益回执。这五个目录尚未加入生产资产目录。现有 Analysis 沿原包与原免测决定。


20 项作者实际试答与逐项可接受／禁止交付对照见 [自检样例](skill-author-samples.md)。作者样例包含 5 组 × 4 条，人工试答和结构读回均完成。MacBook 独立项目的 pending 已按完整目录哈希逐包核对，回执在 `.local/product-v13/skill-eval-pending.json`。独立测评及采用由用户组织。Skill 的质量、成本、误触发及真实任务收益待该次回执。

## Pi 角色及产品入口点验

四份角色提示词在 `src/host/business-role-types.ts`。战略继续从原 `strategy-discussions` 目录和 profile 打开。其余角色复用 Interface v3、原生配置和生命周期，按业务 owner 独立存放在新 `business-role-discussions` 目录。目标可提交可编辑建议，项目只可查找和读取当前项目获准的准确材料，Case 只接收当前事项与原记录。SDK 源码、包与已存 Pi 原件均沿用原版。

隔离 Chromium 从四个正式产品入口实际发消息。Pi SDK 1.4.0 的原生会话发送给 loopback 合成 Provider。下表为最后一轮在该 Provider 收到的完整 system／developer 消息 SHA-256，角色头均为 v1.3.0。完整消息还含隔离工作区路径，另一次运行可能得到不同摘要。

| 产品入口 | 实际角色 | 本轮实际系统消息 SHA-256 |
| --- | --- | --- |
| 主导航 → 战略选择 | 战略选择 Agent | `d7e8cef7e78a336f623160acbccc1d5955b79e4c05476aca014a1efb5d5355e2` |
| 所选战略 v1 → 目标管理 | 目标管理 Agent | `bfebc7b29fd47f579ffe3b1fe06c8831c71ff7911c4f0335a44edbc4ba280b42` |
| 项目地图 → 零 Task 项目 | Project Agent | `3232372ee5668fa3bca19f16d8f99fc489f4ef531a266fc33654e761f195f553` |
| 决策星图 → Case → 具体事项 | Decision Case Agent | `f00d9f03e749ded91eac299c944141bc7fa4bf2515b084e990c2c1b37b214b6f` |

- 切到目标管理后，实际发送含准确战略选稿和原生回复。Agent 经受限 `propose-goal` 给出完整字段。用户放大对话、带入原编辑表单、改标题并保存，得到候选 v1。正式 Goal 同时留存战略稿和独立的 `roleSuggestion`。编辑后的正文归该次用户操作。
- 项目在零 Task 时发送成功，从合成模型甲切到乙后继续同一会话，再停止正在回复的请求。Case 从具体事项发出一轮，返回所选事项及原 G／S 的回复。浏览器无 page error。原始收据在 `.local/product-v13/roles/browser-receipt.json`，交互日志在 `.local/product-v13/roles/browser-final-expanded.log`。
- `tests/business-role-sessions.test.ts` 的四项产品 HTTP／真实 Pi 检查和原 `tests/strategy-discussion-recovery.test.ts` 的两项恢复检查共 6/6，通过记录在 `.local/product-v13/roles/role-final-qa.log`。覆盖一方项目无权限读取另一方、已读原文件变更阻断下轮、重复请求、关闭与重开、停止、封存 Case 只读、同 Case 不同事项隔离、错误草稿／范围、来源 hash 篡改、明确保存前 Goal 库无新目标、当前准确 Goal 再讨论。
- 全仓 TypeScript 检查通过，日志在 `.local/product-v13/roles/typecheck-final.log`。开发中提前核配置导致旧战略缺少待发原文的回归曾失败，已调整为沿原租约登记输入后才核配置，两项原恢复语义分别通过。初始失败及其日志留于本次根目录 `.local/product-v13/`。
- 模型专业判断与内容质量未作真实供应商评估。独立复核、合并、运行更新及产品验收由总交付分别登记。回退时使用旧产品候选和升级前备份。新增角色目录、Goal 可选字段及原生记录保留，不清理、重写或重放历史。

本轮浏览器回执 SHA-256 为 `882bfbd73841eb58d16d64b8cce403410a542962e777265c68ed07bbfd10e962`，Goal 建议来源原生 entry 为 `1294e937`，其 session 为 `01a1ef61-18cc-7376-b8ad-83f7434f6a27`。

## 原 Case 与 Task 转入目标管理的复核修正

11 月 19 日复核指出原入口只交接标识，目标 Agent 缺少准确业务正文。现从原 Case 回到当时有效的主目标版本，Case 自身的标题、描述、判断与下一步按原事件修订还原。来自项目 Task 时可带任务身份，或在指定助手原回复上选择“带这条原回复核对目标”。若原 Task 已绑定 Case 事项，重新核对真实项目关联、事项和目标。无绑定时按来源项目的企业或个人范围进入独立草稿。用户可在目标管理展开同一份原依据。来源身份进入目标角色的 owner，单独切换来源、目标或草稿后保留原会话。

原生回复使用原项目、Task、session、entry 和文本 SHA-256，沿原 Pi 存储读回。Host 在查看、发送、重开与换模型时检查原 Task、项目、当前材料权限和实际接收模型，通过项目结果共用入口 `assertTaskResultAccess` 核对准确回复的祖先授权。归档或来源完整性失效后停止提供。用户明确带入建议后保存的 `roleSuggestion` 同时固定业务来源身份。

- 独立端口 4377 的 Chrome 从“决策星图 → Case → 带原依据到目标管理”和“项目 → Task → 带这条原回复核对目标”两条正常界面发送。实际 Pi 1.4.0 收到 Case 原描述 `CASE_BUSINESS_BASIS` 及所选 Task 的 `TASK_INSPECT_EXACT`，跨来源未混入先前正文。Case 绑定 Goal v1，Task 原文 entry 为 `2b7f9c70`，内容哈希 `d827981a0ecd30612a91060e546d71688477ecc5613c1e2afc6f34c290ba3525`。两项通过，浏览器无 page error。原始收据 `.local/product-v13/roles/origin-browser-receipt.json`，SHA-256 `38d90a181813ca2c35f6ad97108c91d75b7494709be74ce089a89388ab7ff86c`。
- `tests/goal-origin-role-v13.test.ts` 使用合成 Provider 和真实 Pi 验证原 Case 升到 v2 后按 v1 取当时正文，错误原文 hash 被拒，归档原 Task 后角色读回、再次派发均被拒，Provider 请求数无增。与四角色及原战略恢复回归共 7/7，见 `.local/product-v13/roles/origin-plus-role-final.log`。TypeScript 检查通过，见 `.local/product-v13/roles/origin-tsc-final.log`。

# Decision Case 外发确认包独立复核

2026-11-27 · 复核者 `/root/case_dispatch_independent_review`，未参与候选创作。

结论：**通过，无必须修改项。** 本结论仅判断确认版规格、任务、冻结原型和 Issue 发单文本是否一致、范围清楚并可供实施，不代表正式产品开发、浏览器、Pi 集成、真实模型质量、设备采用或用户产品验收完成。

## 固定对象与只读约束

- 根目录 `/workspace/OptraCall-decision-case-dispatch`；基线 `4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`。
- 初次冻结 manifest 的 9 文件长度与 SHA-256 全部逐字节核对通过；其后作者通知新增两份纯证据并在 result 补引用。新增证据已独立检查，核心 spec/tasks/decisions/guide/demo/runner 未改。
- spec SHA-256 `834399d514fd9093d6dc93e5a897381d7ed83605499a16827e4dbac57468cc9f`。
- tasks SHA-256 `6ed1d3865d7312599b321b95a4dfb08868dbe2f2b2a1dd68ba52b8fa63fc71e7`。
- 冻结 v0.6 Demo SHA-256 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`，208,858 字节。
- 已审实际 `.local/dispatch/issue-template.md` SHA-256 `154a43ec20293a13b91beec617dc9d6e5cd20fcd2f9d49605672f2e661b0a678`；其中 `__CONFIRMED_SHA__` 是提交前已声明占位，发布时必须换为推送并回读的确切提交。
- 源码、规格、测试与固定证据只读；仅在 `.local/dispatch-independent-review/` 写本人脚本、回执和本报告。自带检查也以此目录为 cwd，因此其输出未写作者目录。

## 验收导出与检查范围

在读取冻结新包前已先读 AGENTS、工程规范 §2–4/§6、统一会话接入说明和旧讨论稿，并将关键预期交给 Root。旧稿 Proposed 不当作全部已确认。

逐项核对结论：

1. 当前确认的统一入口、当前事项/轮次、列表/关系图、两辅助页默认与手动范围、首页和创建继续均有对应 DW/T；D04 辅助已按后续确认纳入，D05–08 未确认扩展边界明确。
2. 原 Case/Goal/事项/项目/任务/来源/权限身份保留；共享项目唯一，空 Case 不承接他案资料；浏览范围不改变 Agent 协作身份。旧全局关系、管理和归档入口仍可达。
3. 关系支持多前驱，显式用户声明或采纳为保存来源；不从标题/顺序推断，不限定单父、无环、因果、授权或强制步骤。
4. 首页请求缺口明确为需开发，具真实声明写入口、承担人来源、准确目标/版本/轮次/授权和原回应引用；不会把普通报告、缺反馈、任意保存或不具名 actor 当个人义务或完成依据。
5. 轻输入辅助且 Agent 仅主动调用；手工无模型路径完整。固定样例候选、bundle、模拟人物和 sessionStorage 不作为生产能力。
6. G/S 为原准确 GoalRef 与该版具体策略，不另造策略/目标权威。只读源码核对 goal-draft owner/profile、原可编辑建议、准确来源重核、CaseGoalPicker 人工采纳/丢回执路径及精确 G/S 去重入口，spec 对已有和缺口描述成立。
7. 分别记录采纳/创建回执，UNKNOWN 先核原操作、重复操作与跨 Store 部分成功、放弃不撤销已保存成果、重开持久草稿和非空追加保护均为可执行验收。
8. Pi1.4.0/Interface v3、IN01–07、原 owner/profile 和 Codex Host 接线责任明确；原 runtime/SDK 不改，真实 Host/HTTP/Pi 合成接入与正式产品浏览器均列必交证据，Demo/VM 不替代。
9. #148 的共享文件/接口先协调唯一写入者，实绩算法不顺带修改；阶段任务、完成条件、失败/恢复和工程交回可核对。
10. Issue 模板与 spec/tasks 一致，工程关闭与设备采用分开，发布的是确认包和正式待领工单，未误报产品已实现。
11. 公开材料未发现凭据、真实客户资料或活动网络/外部脚本。新增原标题 XSS FAIL 以 JSON 字符串保留历史失败，标明原候选，未冒充当前失败或浏览器执行证据；新 27 项回执准确标记 VM/DOM 替身边界。

## 独立实跑与结果

- 自带 `verification/check-demo.mjs`：**27/27 PASS**，实际执行冻结 HTML 的完整内联脚本，输出 SHA 与确认版本一致。
- 本人从预期另写 `independent-check.mjs`：**11/11 PASS**。覆盖双页范围重设/跨页保留、关系多前驱/无推边、跨 Case 全局项目唯一、独立/归档筛选、空 Case 来源不继承、零任务项目、项目往返原位置/草稿/范围、普通报告无请求副作用、无活动网络资源和包内 Markdown 引用。
- 回执见同目录 `independent-check-receipt.json` 和 `.local/decision-case-daily-workspace-validation/receipt.json`。
- Git status 独立确认候选只有新增确认包目录，未见 src/extensions/tests/依赖的受跟踪修改。

本轮没有执行正式产品、真实浏览器渲染/键盘、Host/HTTP/Pi 集成或真实模型，不将其记作 PASS。历史 60/60、13/13 等只作为包中明确标记的历史证据，不算本轮独立重跑。

## 发单落地核对

无需要返工的实质条款。Root 在记录本回执/勾选准备清单后刷新最终 manifest，提交推送后替换 Issue SHA 占位并回读公开正文/链接/发布身份即可继续本轮已授权发单；这些是尚待执行的发布元数据动作，不是产品实现通过条件。

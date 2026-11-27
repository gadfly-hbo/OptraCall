### 目标、范围与当前授权

实际 PM Agent：**Codex（Decision Case 模块）**。用户已确认 Case 当前工作／事项关系图、一级 Tab 名称 **Decision Case**、Case 总览／全部项目，以及 v0.6 首页待处理、轻量新建／继续、明确采纳和输入保护；本次明确要求固化 UI Demo／spec／任务清单并创建外发 Issue。

**整单开放领取**。授权领取方按确认范围实施正式产品、隔离验证、独立任务分支推送并交回 PM；本轮 PM 已完成确认包，不在此自行启动产品实施。Host／Agent 技术接入由 Codex 承担，其他领取方先与 PM 明确该部分的唯一写入者；Codex 领取可整单负责。领取者不自行合并 main 或切换设备服务。

范围以绑定提交的 spec DW01–18 为准：统一入口和 Case 当前工作、事项有向关系、准确项目／资料范围、完整全局项目、首页明确请求投影、统一创建／继续和持久输入保护。必要最小业务数据及原 owner 接缝在范围内；不复制 Demo 虚构人物／固定推荐／bundle／sessionStorage 作产品规则。

沿官方 **Pi 1.4.0／Interface v3**，创建前优先复用 `{role:'goal-draft',draftId,scope}`／原 `business-role-discussion` 接缝，Case Agent 仍需真实 Case／事项身份。不改 SDK／依赖或另建 Runtime。人工路径无模型可用；本工单不自动授权真实 Provider／业务资料、设备更新或服务切换。

### 基线与设计依据

- 核实的 `origin/main`：**`4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`**。领取／集成时重核最新 main，不覆盖其他 WIP。
- **确认包提交：`5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2`**，工作分支 `codex/decision-case-confirmed-dispatch`。
- [确认版 spec](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/openspec/changes/decision-case-daily-workspace/spec.md)、[任务清单 T01–T18](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/openspec/changes/decision-case-daily-workspace/tasks.md)、[当前决定／未纳入项](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/openspec/changes/decision-case-daily-workspace/decisions.md)。
- [冻结 UI Demo v0.6](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/openspec/changes/decision-case-daily-workspace/demo.html)、[演示说明](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/openspec/changes/decision-case-daily-workspace/demo-guide.md)。HTML SHA-256：`adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`。下载独立打开；[所有者私有站点](https://optracall-case-current-work-demo.toasty-flute-7414.chatgpt.site)只作便利入口，按提交内字节验收，不要求领取方取得私站权限。
- [准备／验证记录](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/openspec/changes/decision-case-daily-workspace/result.md)。本包可复跑原型检查27/27通过，另有历史原型检查和独立复核；这是虚构 HTML 状态检查，不代表正式产品已实现。原型实际浏览器视觉／键盘证据未取得，正式产品验收需补。
- 已查重，无同一 Decision Case 开放开发单。共享目标接缝的 [#148](https://github.com/gadfly-hbo/OptraCall/issues/148)独立负责 GSA 承接、实绩一致性、阈值和发布核对；本单优先消费其接口，须改共享文件时由 PM 在两单先明确边界和唯一写入者。

### 验收、工程任务与回执

- [ ] **T01–T02**：有效领取、最新基线、实际 owner/profile／原权威盘点、数据最小迁移和 #148 协调。先读 AGENTS、工程规范 IN01–IN07 和统一接入说明。
- [ ] **T03–T06**：统一 Decision Case；Case 四页签／当前事项本轮；真实有向关系多前驱和原声明写入口；默认事项范围、手选保留及准确资料归属。保留旧 Case↔Case 关系与原业务历史。
- [ ] **T07–T09**：全局独立／共享／零任务／归档项目及往返；原 owner 下显式请求／精确回应；首页分开待处理、继续、外部等待与四项基础提醒。无可靠身份不称“待你”，普通报告／无 choice／无 feedback 不伪造成请求。
- [ ] **T10–T12**：新 G/S 采纳创建、已采纳无 Case 创建、准确 G/S 已有 Case 继续三分支；真实有依据的可选整理推荐与人工路径；不覆盖／不默发／原文来处回读、持久草稿、部分成功／UNKNOWN／重复操作恢复。
- [ ] **T13–T16**：需求导出确定性回归与因果复现；真实 Store／HTTP／官方 Pi 合成接入；实际产品桌面／窄屏／键盘及失败恢复；适用完整检查、非作者及四原则终检；推送固定候选并回读远端 SHA 后交回 PM、停止写入。
- [ ] **T17–T18（PM）**：审核、整合最新 main、最终复核、关联 PR（`Refs #本单编号`）、准确 head CI、获授权 squash 合并及 main push CI，补工程结案回执。设备采用与用户最终产品体验单独安排。

关键负例必须覆盖：共享项目不使资料自动关联他案；浏览范围不改变 Agent owner／背景；旧数据无关系／无请求不补造；无关回应、别轮／别授权不消解请求；归档不隐式停止；采纳不等于行动授权；丢响应先核原操作；标题／原输入在所有栏目转义；403撤权及迟到结果不串对象。新实绩聚合、家庭实体／成员权限、自动派单提醒、跨事项采用和全局星图全量改版不纳入。

领取在本单留言并回读：**领取 · Agent/实例 · 独立任务分支 · 基线完整 SHA**。以工程规范最早有效领取为准。交接回执包含候选完整 SHA、DW01–18/T01–T16完成情况、规格／测试／结果链接、实跑命令／结果、FAIL／SKIP／UNKNOWN／未测、兼容回退和保全。只有原型或 mock 通过不能交作产品工程完成。需实质改变已确认UI／权限／业务语义时，先交PM只就受影响部分组织确认。

本单工程流程遵循[仓库工程规范](https://github.com/gadfly-hbo/OptraCall/blob/5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2/docs/engineering-workflow.md#github-开发任务外发与交付)。首次审核可退回一次；二审后由PM接手剩余修复。PR 不用自动关单关键词，main push CI 通过并补回执后再工程结案。

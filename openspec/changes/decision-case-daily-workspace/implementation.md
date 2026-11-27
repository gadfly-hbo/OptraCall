# 实施记录（Issue #149，领取方 Antigravity）

基线：`699e425cb0900b50385377d638495069fa726761`；分支 `work/antigravity/issue-149-decision-case-daily-workspace`。
用户已授权整单负责，含 Host/Agent 接入（IN06）；按“整体完成后一次性推送”执行。

## T02 盘点（已核实调用路径）

| 项 | 现状 | 本单增量 |
| --- | --- | --- |
| 事项身份 | `CaseDecisionIssue{id,caseId,title,createdAt}` 以 Case 事件 `changes.decisionIssue` 保存（`case-store.ts` `createDecisionIssue`），无 SQL 表 | 同样事件式新增 `changes.issueEdge`，无 schema 迁移 |
| 事项关系 | 无；旧 Case↔Case 关系在 `case_relation_revisions`（`supports/follows_up`） | `listIssueEdges/saveIssueEdge`（T05 存储层，已完成并有 `tests/case-issue-edges-store.test.ts`），旧关系不动 |
| 明确请求 | 无通用收件记录；有 `chooseStrategy`、`saveFeedback`、`pendingOperations` | 待做（T08） |
| 目标准备/采纳 | `{role:'goal-draft',draftId,scope}`、`CaseGoalPicker`、`CaseGoalBinding` | 待盘点细化（T10/T11） |
| HTTP | `/api/cases/:id/decisions/issues*`（`case-decision-routes.ts`） | 边与请求路由待加 |
| UI | `App.tsx` 一级 `工作区切换` 现为 分析／决策；`CaseBoard.tsx`、`CaseIssuePanel.tsx`、`WorkspaceHome.tsx` | 待做 |
| #148 | 共享目标 Store／辅助 UI | 本单仅消费现有接口；不改其 GSA、实绩、阈值、发布核对 |

IN01–IN07：Case 事项沿 `{role:'case',caseId,itemId}`，创建前辅助沿 `{role:'goal-draft',draftId,scope}`；不改 SDK/依赖/公共 Runtime，Interface v3 不变。

## 进度

- [x] T01 领取、基线、独立分支
- [x] T02 盘点（本表；后续随实现补充）
- [~] T05 事项边存储层（Store 已完；服务/路由/Agent 声明工具/UI 未做）
- [ ] 其余 T03–T04、T06–T16 未开始

> 当前状态不构成产品交付，DW01–18 均未完成。

import { Type } from 'typebox';
export type StrategyDiscussionAction = 'read-goals' | 'find-sources' | 'read-source' | 'propose-goal' | 'adopt-goal' | 'operation' | 'public-search';
export type StrategyDiscussionToolContext = { requestId:string; sessionId:string; toolCallId:string; signal:AbortSignal; assertCurrent():void; originalUserText:string; userQuoteEligible:boolean; goalBasis?:import('../host/strategy-goals-types.ts').GoalBasis; registerCleanup?:(cleanup:(options:{retryFailed?:boolean})=>Promise<void>)=>void };
export type StrategyDiscussionPort = (action:StrategyDiscussionAction,input:Record<string,unknown>,context:StrategyDiscussionToolContext)=>Promise<{content:{type:'text';text:string}[];details:Record<string,unknown>}>;
export const STRATEGY_DISCUSSION_ACTIONS = ['read-goals','find-sources','read-source','propose-goal','adopt-goal','operation','public-search'] as const;
export const strategyDiscussionTool = {
  name:'strategy_goals',label:'战略讨论与目标准确承接',
  description:'read-goals读取本轮准确目标及原关系/反馈；find-sources查获准背景资料目录，read-source按准确sourceId读取，public-search仅发送公开查询且须已有检索配置。propose-goal把已充分明确的draft保存为原Goal候选，可给goalId及expectedVersion修订原目标；采用前继续保留未知，不编负责人/指标/上级。adopt-goal仅按本轮真实用户明确原话给quote(start/end/text)、准确goalId/version/expectedVersion及goalContentSha256采用；普通讨论和有意思不等于采用。operation给原operationId查回执，未知先读不换编号重做。目标采用不授权经营执行。方法/工具与分析顺序由你决定。',
  parameters:Type.Object({action:Type.Union(STRATEGY_DISCUSSION_ACTIONS.map(x=>Type.Literal(x))),sourceId:Type.Optional(Type.String()),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:8192})),query:Type.Optional(Type.String({maxLength:2000})),goalId:Type.Optional(Type.String()),version:Type.Optional(Type.Integer({minimum:1})),expectedVersion:Type.Optional(Type.Integer({minimum:1})),goalContentSha256:Type.Optional(Type.String()),operationId:Type.Optional(Type.String()),draft:Type.Optional(Type.Record(Type.String(),Type.Unknown())),quote:Type.Optional(Type.Object({start:Type.Integer({minimum:0}),end:Type.Integer({minimum:1}),text:Type.String({minLength:1,maxLength:20000})},{additionalProperties:false}))},{additionalProperties:false}),
};

export const projectDiscussionSourceTool = {
  name: strategyDiscussionTool.name,
  label: '项目准确成果',
  description: 'find-sources 查本项目当前模型获准的文件、资料和原 Task 回复，支持按 query 和 offset 翻页。read-source 用原目录返回的 sourceId 按准确版本读取，必要时续读。目录命中仅说明引用可见。没有读到的正文不能据以综合。',
  parameters: Type.Object({action:Type.Union([Type.Literal('find-sources'),Type.Literal('read-source')]),sourceId:Type.Optional(Type.String()),query:Type.Optional(Type.String({maxLength:2000})),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:8192}))},{additionalProperties:false}),
};

export const editableGoalTool = {
  name: strategyDiscussionTool.name,
  label:'可编辑 GSA 建议',
  description:'propose-goal 仅返回由用户核对的目标建议。使用当前范围；提供 title、outcome、perspective（profit、nonprofit 或 personal）、responsible、baseline {state:known 或 pending,description}、measurement {kind:deliverable,criterion} 或已发布的 SAP metric，以及具体 strategies 数组。可选 resources、necessaryConditions、dueAt。只使用有依据的内容。',
  parameters:Type.Object({action:Type.Literal('propose-goal'),draft:Type.Record(Type.String(),Type.Unknown())},{additionalProperties:false}),
};

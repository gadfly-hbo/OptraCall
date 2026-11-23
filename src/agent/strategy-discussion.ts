import { strategyMapDraftSchema } from './strategy-map-schema.ts';
import { Type } from 'typebox';
export type StrategyDiscussionAction = 'read-goals' | 'find-sources' | 'read-source' | 'read-import-source' | 'propose-map-draft' | 'propose-goal' | 'adopt-goal' | 'operation' | 'public-search' | 'read-map' | 'save-map' | 'initiative-files' | 'initiative-read-file' | 'initiative-read-kickoff' | 'initiative-save-kickoff' | 'initiative-save-candidate' | 'initiative-save-verification';
export type StrategyDiscussionToolContext = { requestId:string; sessionId:string; toolCallId:string; signal:AbortSignal; assertCurrent():void; originalUserText:string; userQuoteEligible:boolean; goalBasis?:import('../host/strategy-goals-types.ts').GoalBasis; importSourceIds?:string[]; selectedImportPages?:Record<string,number[]>; importMode?:'review-draft'; draftGroupId?:string; supersedesDraftEntryId?:string; targetMapRef?:{mapId:string;version:number}; registerCleanup?:(cleanup:(options:{retryFailed?:boolean})=>Promise<void>)=>void };
export type StrategyDiscussionToolContent = {type:'text';text:string} | {type:'image';data:string;mimeType:string};
export type StrategyDiscussionPort = (action:StrategyDiscussionAction,input:Record<string,unknown>,context:StrategyDiscussionToolContext)=>Promise<{content:StrategyDiscussionToolContent[];details:Record<string,unknown>}>;
export const STRATEGY_DISCUSSION_ACTIONS = ['read-goals','find-sources','read-source','read-import-source','propose-map-draft','propose-goal','adopt-goal','operation','public-search','read-map','save-map','initiative-files','initiative-read-file','initiative-read-kickoff','initiative-save-kickoff','initiative-save-candidate','initiative-save-verification'] as const;
const exact = { additionalProperties: false };
const nonblank = (maxLength = 4000) => Type.String({ minLength: 1, maxLength, pattern: '\\S' });
const textList = Type.Array(nonblank(), { maxItems: 100 });
const fixedVersion = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S', description: '引用具体的已发布版本；latest 和 current 不能标识固定版本。' });
const sourceRef = Type.Object({
  authority: Type.Union(['case', 'decision-board', 'project', 'task', 'sap-metric', 'strategy-discussion'].map(x => Type.Literal(x))),
  id: nonblank(300), version: Type.Union([fixedVersion, Type.Integer({ minimum: 1 })]),
  projectId: Type.Optional(nonblank()), taskId: Type.Optional(nonblank()),
  sha256: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })), sessionId: Type.Optional(nonblank(200)),
  entryType: Type.Optional(Type.Union([Type.Literal('message'), Type.Literal('tool-result')])),
}, exact);

// Pi validates the submitted business fields. The Host resolves scope and binds the native source.
const proposalDraft = Type.Object({
  title: nonblank(300), outcome: nonblank(), responsible: nonblank(300),
  perspective: Type.Union([Type.Literal('profit'), Type.Literal('nonprofit'), Type.Literal('personal')]),
  scope: Type.Optional(Type.Object({
    kind: Type.Union([Type.Literal('enterprise'), Type.Literal('department'), Type.Literal('personal')]),
    id: nonblank(300), name: nonblank(300), enterpriseId: Type.Optional(nonblank()),
  }, { ...exact, description: '当 goalScopes.bound 或 defaultScope 已明确时可省略。需要选择时使用 Host 提供的 choices，并按用户声明核对部门职责。' })),
  baseline: Type.Object({ state: Type.Union([Type.Literal('known'), Type.Literal('pending')]), description: nonblank() }, exact),
  measurement: Type.Union([
    Type.Object({ kind: Type.Literal('deliverable'), criterion: nonblank() }, exact),
    Type.Object({
      kind: Type.Literal('quantitative'),
      sapMetric: Type.Object({ authority: Type.Literal('sap-metric'), id: nonblank(300), version: fixedVersion, metricName: nonblank(200) }, exact),
      target: Type.Optional(nonblank()),
    }, exact),
  ]),
  dueAt: Type.Optional(nonblank(100)), bscPerspective: Type.Optional(nonblank(300)),
  strategies: Type.Optional(textList), resources: Type.Optional(textList), necessaryConditions: Type.Optional(textList),
  strategyContext: Type.Optional(Type.Object({
    summary: nonblank(),
    methods: Type.Optional(Type.Array(Type.Object({ id: nonblank(200), name: nonblank(300), source: Type.Optional(sourceRef) }, exact), { maxItems: 30 })),
    sources: Type.Optional(Type.Array(sourceRef, { maxItems: 100 })),
  }, exact)),
}, exact);

export const strategyDiscussionTool = {
  name: 'strategy_goals', label: '战略讨论与目标准确承接',
  description: [
    'read-map 查本讨论地图，按准确 mapId、version 读取，长正文可用 offset/limit 分页。save-map 用于普通战略共创保存完整候选或修订，修订带 mapId 和 expectedVersion，不改动无关节点。新建可省略 mapId；reason 概述本轮变化。citationTokens 只列本轮实际读取且用于此版的附件引用。',
    'read-import-source 严格在本轮授权的 importSourceIds 与 selectedImportPages 范围内按 importSourceId、可选 page（1-based）与可选 imageIndex（多图工作表 1-based）读取多格式战略图原稿；多页省略 page 仅返回允许页目录，请按页读取。纯文本模型或扫描盲区无法识别出节点时，允许 nodes 为空并在 unknowns 说明原因。',
    'propose-map-draft 在导入核对或局部重读轮次返回带精确 sourceLocation、reviewState 与 importSources 的待核草稿，不直接写入地图版本目录，由用户对照原稿确认后一次保存；局部重读时须保留 workingMapDraft 中用户的手工修改。',
    'read-goals 读取本轮目标、关系、反馈及 Host 核对的 goalScopes。find-sources 查获准背景目录，read-source 按 sourceId 读取，public-search 仅发送公开查询且须已有检索配置。',
    'propose-goal 保存完整候选。draft 必填 title（标题）、outcome（预期结果）、perspective（profit/nonprofit/personal）、responsible（负责人）、baseline（状态及说明）、measurement（成果核对标准或已发布 SAP 指标及固定版本）。',
    'goalScopes.bound 或 defaultScope 已明确时可省略 draft.scope；有多种适用范围时按用户明确意图选用，归属仍有歧义时询问。基线待补用 pending，目标依据不足时继续讨论。修订原候选须给 goalId 和 expectedVersion。',
    'adopt-goal 仅按本轮用户明确原话给 quote(start/end/text)、准确 goalId/version/expectedVersion 和 goalContentSha256 采用。目标采用不授权经营执行。operation 给原 operationId 查回执，未知先核对原操作。',
    '战略事项主会话专用：initiative-files 列本事项共用及当前范围资料；initiative-read-file 按 fileId 读取文本资料（offset/limit 续读）；initiative-read-kickoff 读开题报告版本（可给 version）；initiative-save-kickoff 保存开题报告草稿，给 operationId、kickoffFields（horizon/diagnosis/propositions 3–5 项含稳定唯一 id、question、whyItMatters/assumptions/evidenceGaps/followUp）与 kickoffSources（file 来源须给实际读取的 fileId 与 sha256 准确身份，public 来源给依据）。锁定与应用由决策者在界面完成，工具不锁定。',
    '候选会话专用：initiative-save-candidate 保存本候选版本正文，给 operationId、candidateBlocks（稳定唯一 id、label、text 的结构化章节，覆盖定位与增长、目标与里程碑、资源与明确不做、成立条件与假设）及可选 candidateGoals。Host 绑定本版本身份，不接受其他候选或开题引用；锁定由决策者完成。',
    '检验会话专用：initiative-save-verification 提交本道检验结论，给 verdict（pass/fail/insufficient）、evidence（可核对的关键发现与依据）及可选 verificationSources。结论只针对 Host 固定的锁定版指纹；发布由决策者完成。',
  ].join(' '),
  parameters: Type.Object({
    action: Type.Union(STRATEGY_DISCUSSION_ACTIONS.map(x => Type.Literal(x))),
    mapId:Type.Optional(nonblank(100)),mapDraft:Type.Optional(strategyMapDraftSchema),reason:Type.Optional(nonblank(300)),citationTokens:Type.Optional(Type.Array(nonblank(300))),
    importSourceId:Type.Optional(nonblank(120)),page:Type.Optional(Type.Integer({minimum:1,maximum:200})),includeImage:Type.Optional(Type.Boolean()),imageIndex:Type.Optional(Type.Integer({minimum:1,maximum:50})),
    sourceId: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8192 })),
    query: Type.Optional(Type.String({ maxLength: 2000 })), goalId: Type.Optional(Type.String()), version: Type.Optional(Type.Integer({ minimum: 1 })),
    expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })), goalContentSha256: Type.Optional(Type.String()), operationId: Type.Optional(Type.String({ pattern: '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$', description: '原操作的 UUID，查询或重试时沿用。' })),
    draft: Type.Optional(proposalDraft),
    fileId: Type.Optional(nonblank(100)),
    parent: Type.Optional(Type.Integer({ minimum: 1 })),
    kickoffFields: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    kickoffSources: Type.Optional(Type.Array(Type.Object({
      kind: Type.Union([Type.Literal('file'), Type.Literal('public')]),
      ref: nonblank(500), title: Type.Optional(nonblank(300)),
      fileId: Type.Optional(nonblank(100)),
      sha256: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
    }, exact), { maxItems: 100 })),
    candidateBlocks: Type.Optional(Type.Array(Type.Object({
      id: nonblank(40), label: nonblank(200), text: nonblank(20000),
    }, exact), { maxItems: 20 })),
    candidateGoals: Type.Optional(Type.Array(nonblank(500), { maxItems: 10 })),
    verdict: Type.Optional(Type.Union([Type.Literal('pass'), Type.Literal('fail'), Type.Literal('insufficient')])),
    evidence: Type.Optional(nonblank(8000)),
    verificationSources: Type.Optional(Type.Array(Type.Object({
      kind: Type.Union([Type.Literal('file'), Type.Literal('public'), Type.Literal('candidate'), Type.Literal('kickoff')]),
      ref: nonblank(500), fileId: Type.Optional(nonblank(100)), sha256: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
    }, exact), { maxItems: 50 })),
    quote: Type.Optional(Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 1 }), text: Type.String({ minLength: 1, maxLength: 20000 }) }, exact)),
  }, exact),
};

// Only explain known Host codes. Cancellation, permission and storage errors keep their original identity.
const proposalErrorReasons: Readonly<Record<string, string>> = {
  strategy_goal_draft_required: 'draft 必须是包含目标正文的对象；请按工具列出的必填字段提交。',
  invalid_strategy_goal_draft: 'draft 只接收工具定义的候选字段，来源与版本身份由 Host 绑定。',
  strategy_goal_scope_required: 'draft.scope 尚未确定；请按用户明确意图从 read-goals 的 goalScopes.choices 选用，或按实际声明提供部门。归属有歧义时先核对。',
  strategy_goal_scope_mismatch: 'draft.scope 与绑定范围或可用记录不一致。请重新读取 goalScopes，并按准确 kind、id、name 和已知 enterpriseId 提交。',
  strategy_goal_scope_id_unknown: 'draft.scope.id 未在当前可用范围中找到。请从 read-goals 核对准确身份。',
  strategy_goal_scope_name_mismatch: 'draft.scope.name 与 Host 记录的名称不一致。请读取该 id 对应的准确名称。',
  strategy_goal_scope_enterprise_mismatch: 'draft.scope.enterpriseId 与当前范围或已登记的上级企业不符。请核对 Host 给出的企业标识。',
  strategy_goal_scope_unavailable: 'draft.scope 不能通过范围核对。请核对目录中的企业 id 与名称，以及部门所引用的 enterpriseId。',
  strategy_goal_department_unconfirmed: 'draft.scope.id 和 name 应使用用户明确声明的同一部门名称。enterpriseId 只可引用 Host 给出的上级企业，上级未知时省略。',
  strategy_goal_expected_version_required: '修订 goalId 时须同时提供 expectedVersion。请用 read-goals 核对原目标的准确正整数版本。',
  strategy_goal_not_in_discussion: 'goalId 不能作为本讨论的修订目标。请从 read-goals 核对原目标和准确版本。',
  strategy_goal_metric_unavailable: 'draft.measurement.sapMetric 应引用该范围可用的已发布指标，请核对 id、固定 version 和 metricName。',
  invalid_strategy_goal_metric: 'draft.measurement.sapMetric 需要已发布指标的准确 id、固定 version 和 metricName。',
  invalid_strategy_goal_source: 'draft.strategyContext 中的来源需要准确 authority、id、version 及其对应的来源标识。',
  strategy_goal_feedback_source_unavailable: '无法读取候选引用的原资料。请核对议题的原来源，以及 draft.strategyContext.sources 和 methods 中所选来源的权限和准确版本。',
  strategy_goal_feedback_source_changed: '所引资料已发生变化。请重新核对 draft.strategyContext 的准确来源版本，再决定是否修订。',
  strategy_goal_operation_conflict: 'operationId 已用于不同内容。请用 operation 核对原回执；不同操作不得沿用同一编号。',
  invalid_strategy_goal_due_date: 'draft.dueAt 需要可识别的日期，例如 2027-03-31。',
  invalid_strategy_goal_version: 'expectedVersion 需要原候选的正整数版本。请用 read-goals 核对。',
  strategy_goal_conflict: 'expectedVersion 与当前版本不一致。请重读目标再核对修订内容。',
};

export function explainGoalProposalError(error: unknown): unknown {
  if (!(error instanceof Error) || !Object.hasOwn(proposalErrorReasons, error.message)) return error;
  return new Error(error.message + '：' + proposalErrorReasons[error.message]);
}

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

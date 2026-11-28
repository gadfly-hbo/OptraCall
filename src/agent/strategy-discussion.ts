import { strategyMapDraftSchema } from './strategy-map-schema.ts';
import { decompositionDraftFields, reachabilityEstimateSchema } from './goal-decomposition-schema.ts';
import { Type } from 'typebox';
export type StrategyDiscussionAction = 'read-goals' | 'find-sources' | 'read-source' | 'read-import-source' | 'propose-map-draft' | 'propose-goal' | 'adopt-goal' | 'case-directory' | 'case-read-declarations' | 'case-save-issue-edge' | 'case-save-decision-request' | 'operation' | 'public-search' | 'read-map' | 'save-map' | 'initiative-files' | 'initiative-read-file' | 'initiative-read-kickoff' | 'initiative-save-kickoff' | 'initiative-save-candidate' | 'initiative-save-verification' | 'initiative-read-candidate' | 'initiative-propose-revision' | 'initiative-read-skill' | 'goal-read-context' | 'goal-read-skill' | 'goal-run-script' | 'goal-save-estimate' | 'goal-save-decomposition-draft' | 'goal-analyze-progress' | 'goal-assess-actual' | 'goal-propose-plan' | 'goal-propose-review';
export type StrategyDiscussionToolContext = { requestId:string; sessionId:string; toolCallId:string; signal:AbortSignal; assertCurrent():void; originalUserText:string; userQuoteEligible:boolean; goalBasis?:import('../host/strategy-goals-types.ts').GoalBasis; importSourceIds?:string[]; selectedImportPages?:Record<string,number[]>; importMode?:'review-draft'; draftGroupId?:string; supersedesDraftEntryId?:string; targetMapRef?:{mapId:string;version:number}; registerCleanup?:(cleanup:(options:{retryFailed?:boolean})=>Promise<void>)=>void };
export type StrategyDiscussionToolContent = {type:'text';text:string} | {type:'image';data:string;mimeType:string};
export type StrategyDiscussionPort = (action:StrategyDiscussionAction,input:Record<string,unknown>,context:StrategyDiscussionToolContext)=>Promise<{content:StrategyDiscussionToolContent[];details:Record<string,unknown>}>;
export const STRATEGY_DISCUSSION_ACTIONS = ['read-goals','find-sources','read-source','read-import-source','propose-map-draft','propose-goal','adopt-goal','case-directory','case-read-declarations','case-save-issue-edge','case-save-decision-request','operation','public-search','read-map','save-map','initiative-files','initiative-read-file','initiative-read-kickoff','initiative-save-kickoff','initiative-save-candidate','initiative-save-verification','initiative-read-candidate','initiative-propose-revision','initiative-read-skill','goal-read-context','goal-read-skill','goal-run-script','goal-save-estimate','goal-save-decomposition-draft','goal-analyze-progress','goal-assess-actual','goal-propose-plan','goal-propose-review'] as const;
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
    '战略事项主会话专用：initiative-files 列本事项共用及当前范围资料；initiative-read-file 按 fileId 读取文本资料（offset/limit 续读）；initiative-read-kickoff 读开题报告版本（可给 version）；initiative-save-kickoff 保存开题报告草稿，给 operationId、kickoffFields（horizon/diagnosis/propositions 3–5 项含稳定唯一 id、question、whyItMatters/assumptions/evidenceGaps/followUp）与可选 kickoffSources（无来源可省略或传 []；file 来源须给实际读取的 fileId 与 sha256 准确身份，public 来源给依据）。校验失败按安全 details.issues 的 path/reason 修正，失败未写入。锁定与应用由决策者在界面完成，工具不锁定。',
    '候选会话专用：initiative-save-candidate 保存本候选版本正文，仅传 operationId（UUID）、candidateBlocks（1–20 项，含唯一 id ^[A-Za-z0-9_-]{1,40}$、label、text，覆盖定位与增长、目标与里程碑、资源与明确不做、成立条件与假设）及可选 candidateGoals（字符串数组，最多 10 条，勿传对象，勿夹带 candidateId/no/version）；校验失败按安全 details.issues 的 path/reason 修正，失败零写入。initiative-read-candidate 只读核对本候选或直接父版（传父版 candidateId 与 no）准确正文；长正文自动返回章节目录与 pagingRequired，再按 blockId 与 offset/limit（最大 8192）逐块完整分页读取，不截断丢正文。operation 按原 operationId 查自己的保存回执；冲突后先读回，结果未知不要盲目换号，明确新保存意图才用新 operationId。Host 绑定本版本身份，不接受无关候选或开题引用；锁定由决策者完成。',
    '检验会话专用：initiative-save-verification 提交本道检验结论，给 verdict（pass/fail/insufficient）、evidence（可核对的关键发现与依据）及可选 verificationSources。结论只针对 Host 固定的锁定版指纹；发布由决策者完成。',
    '主会话比较与拟改：initiative-read-candidate 按准确 candidateId/no 读取本事项当前范围候选正文与身份；initiative-propose-revision 仅在当前请求明确绑定该 proposalId 且目标块基线未变时可用，按 Host 给定的 proposalId 与固定块提交 newText（仅替换该块，其他内容不动），由决策者核对差异后采纳另存。',
    '主会话技能：initiative-read-skill 按 skill（deep-research 或 grill-me）读取 Host 固定产品资产原文与指纹；可附 path 读取该包内 references/agents 获准资料（默认 SKILL.md，禁止越界）。使用技能前先读取并遵循其方法。仅这两个资产可用。',
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
    candidateId: Type.Optional(nonblank(100)),
    no: Type.Optional(Type.Integer({ minimum: 1 })),
    blockId: Type.Optional(nonblank(40)),
    proposalId: Type.Optional(nonblank(100)),
    newText: Type.Optional(nonblank(20000)),
    skill: Type.Optional(Type.Union([Type.Literal('deep-research'), Type.Literal('grill-me')])),
    path: Type.Optional(nonblank(300)),
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
  strategy_proposal_unavailable: '该拟改提案未绑定到当前获准请求或已非待拟改状态；本次未修改提案。',
  strategy_proposal_baseline_changed: '目标块正文已发生变化，原拟改基线已过期；本次未提交旧补丁，请基于最新正文重新发起限定修改。',
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
  label:'可编辑 GSA 建议与获准 Case 目录',
  description:'propose-goal 仅返回由用户核对的目标建议（须使用当前范围、只用有依据内容）。case-directory 只读查询获准 Case 与事项；用 nextOffset 续查 Case，用 caseId + nextIssueOffset 续查该 Case 事项，引用准确 caseId/issueId 说明理由或无匹配。不创建 Case、不采纳目标。',
  parameters:Type.Object({
    action:Type.Union([Type.Literal('propose-goal'),Type.Literal('case-directory')]),
    draft:Type.Optional(Type.Record(Type.String(),Type.Unknown())),
    query:Type.Optional(Type.String({maxLength:200})),
    limit:Type.Optional(Type.Integer({minimum:1,maximum:30})),
    offset:Type.Optional(Type.Integer({minimum:0})),
    caseId:Type.Optional(Type.String()),
    issueLimit:Type.Optional(Type.Integer({minimum:1,maximum:20})),
    issueOffset:Type.Optional(Type.Integer({minimum:0})),
    includeClosed:Type.Optional(Type.Boolean()),
  },{additionalProperties:false}),
};

const approvedGoalSkillUnion = Type.Union([
  Type.Literal('target-forecast'),
  Type.Literal('roi-forecast'),
  Type.Literal('coupon-forecast'),
  Type.Literal('data-analysis'),
]);

export const goalEstimateTool = {
  name: strategyDiscussionTool.name,
  label: '确认前总目标可达测算与建议',
  description: [
    'goal-read-context 读取当前草稿范围、已保存的确认前测算及可用技能清单。',
    'goal-read-skill 读取 Host 固定的已核定技能（target-forecast / roi-forecast / coupon-forecast / data-analysis）的 SKILL.md 或 references/*。',
    'goal-run-script 以结构化 JSON 输入（scriptInput）运行已核定技能脚本（例如 target-forecast 的 forecast.py run），不接受任意命令或路径；TargetForecast 仅适用于净支付 GMV、月份和情景推演。',
    'goal-save-estimate 保存确认前可达性测算草稿（正式目标、测算值、差额与依据分别保存），不会采用或发布正式目标。',
    'propose-goal 返回由用户核对的可编辑 GSA 目标建议。',
  ].join(' '),
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal('goal-read-context'),
      Type.Literal('goal-read-skill'),
      Type.Literal('goal-run-script'),
      Type.Literal('goal-save-estimate'),
      Type.Literal('propose-goal'),
    ]),
    skill: Type.Optional(approvedGoalSkillUnion),
    path: Type.Optional(nonblank(300)),
    script: Type.Optional(nonblank(100)),
    command: Type.Optional(nonblank(60)),
    scriptInput: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    estimate: Type.Optional(reachabilityEstimateSchema),
    draft: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }, exact),
};

export const goalDecompositionTool = {
  name: strategyDiscussionTool.name,
  label: '目标拆解分析与草稿输出',
  description: [
    'goal-read-context 读取当前已确认总 GSA 计划版、拆解草稿、最新校验问题及已发布版概要。',
    'goal-read-skill 读取 Host 固定的已核定技能（target-forecast / roi-forecast / coupon-forecast / data-analysis）原文与参考资料。',
    'goal-run-script 以结构化 JSON 输入运行已核定技能脚本，获得可复算引擎版本与输入摘要；不可传任意命令或文件路径。',
    'goal-save-decomposition-draft 使用本工具声明的嵌套字段契约；estimate、rows 等放在顶层，不包入 draft。先读取上下文的 saveContract、首次 draftInputTemplate 或已有 draft，沿准确 GSA 身份和 expectedDraftRevision 保存。测算填写实际覆盖的 scope；仅原 goal.measurement.kind=quantitative 时保留其 sapMetric，其他情况省略，不编造 SAP ID。无适用脚本可保留显式算式、假设和限制，不伪造运行回执。本工具仅保存草稿，返回发布校验问题，不发布、不采用、不授权执行。格式错误未保存且未运行发布校验，未点名区块不能称已核。',
    '实绩专属对话按已提交凭证判断覆盖、指标与成熟度，goal-assess-actual 写入该证据的核对结果。comparability 取 comparable、partial-missing、observing 或 incomparable，并用 assessmentNote 说明依据。实绩提供报告原文时按资料提取 observation 的原文逐字引句 quote、实际数值 actualValue、以及对照上下文 expectedBasis 的指标 metric、unit、scope、periodId、覆盖 coverage 和成熟度 maturity；原文使用自然业务表述时，可在 observation.basisMappings（仅 metric/scope）提供逐字 evidenceQuote 与 rationale 完成有证据同义映射或补齐未知项，不可改写人填单位、期间、范围、缺店说明或 partial/open 限制。确需单位换算时须在 observation.unitConversion 提供原值、原单位、换算系数、换算后值与单位及逐字依据；原单位必须来自负责人原填单位，或原文中与原数值相邻的准确单位，不从数字猜单位。只采用可核定的同量纲比例，未知或不同量纲保持待核；严禁保持原数仅换单位标签。此时 observation.actualValue 若提供必须等于 convertedValue，observation.basis.unit 必须等于 convertedUnit。证据不足保持待核。',
    '报表未手填截止时间时，先从原文提取数据截至日期到 observation.cutoffAt，并逐字保留 cutoffQuote。导出、制表、发布日期不能当数据截止时间。日期缺失或冲突时 cutoffState 取 missing/conflict，说明具体待补项，保留凭证待核。',
    'goal-analyze-progress 只读读取指定正式拆解版与阶段检查记录，辅助可比性与偏差说明。',
    'propose-goal 返回由用户核对的 GSA 修订建议。',
  ].join(' '),
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal('goal-read-context'),
      Type.Literal('goal-read-skill'),
      Type.Literal('goal-run-script'),
      Type.Literal('goal-save-decomposition-draft'),
      Type.Literal('goal-analyze-progress'),
      Type.Literal('goal-assess-actual'),
      Type.Literal('propose-goal'),
    ]),
    skill: Type.Optional(approvedGoalSkillUnion),
    path: Type.Optional(nonblank(300)),
    script: Type.Optional(nonblank(100)),
    command: Type.Optional(nonblank(60)),
    scriptInput: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    ...Type.Partial(Type.Object(decompositionDraftFields)).properties,
    publicationVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    comparability: Type.Optional(Type.Union(['comparable','partial-missing','observing','incomparable'].map(value => Type.Literal(value)))),
    assessmentNote: Type.Optional(nonblank(1000)),
    observation: Type.Optional(Type.Object({
      cutoffAt:Type.Optional(nonblank(100)),cutoffQuote:Type.Optional(nonblank(2000)),cutoffState:Type.Optional(Type.Union(['identified','missing','conflict'].map(value=>Type.Literal(value)))),
      quote: nonblank(4000), actualValue: Type.Optional(Type.Number()),
      unitConversion: Type.Optional(Type.Object({
        sourceValue: Type.Number(),
        sourceUnit: nonblank(80),
        convertedValue: Type.Number(),
        convertedUnit: nonblank(80),
        factor: Type.Number({ exclusiveMinimum: 0 }),
        evidenceQuote: nonblank(2000),
        rationale: nonblank(1000),
      }, exact)),
      basis: Type.Optional(Type.Object({
        metric: nonblank(400), unit:nonblank(80), scope:nonblank(400), periodId:nonblank(120),
        coverage:Type.Union(['complete','partial','unknown'].map(value => Type.Literal(value))),
        maturity:Type.Union(['closed','open','unknown'].map(value => Type.Literal(value))),
      }, exact)),
      basisMappings: Type.Optional(Type.Array(Type.Object({
        field: Type.Union(['metric','scope'].map(value => Type.Literal(value))),
        sourceValue: nonblank(400),
        mappedValue: nonblank(400),
        evidenceQuote: nonblank(2000),
        rationale: nonblank(1000),
      }, exact), { maxItems: 8 })),
    }, exact)),
    draft: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }, exact),
};

export const goalPlanTool = {
  name: 'strategy_goals', label: '计划 A 建议',
  description: '按当前准确 G/S 和本行原文提供可编辑计划。推荐补空项，优化保留全部数值、期限、范围、否定及证据限制。观察依据没有可用来源时留空。仅建议，无采用或发布权限。',
  parameters: Type.Object({action:Type.Literal('goal-propose-plan'),summary:Type.String({maxLength:2000}),checkpoint:Type.String({maxLength:300}),observationBasis:Type.String({maxLength:1000}),note:Type.Optional(Type.String({maxLength:1000}))}, exact),
};

export const goalReviewTool = {
  name:'strategy_goals', label:'复盘结论草拟',
  description:'goal-read-context 读取本期正式 GSA、阶段检查、结账凭证及相关 Case，goal-propose-review 返回带原证据与原范围的可编辑结论。sourceRef 只引用提供的证据身份，因果未知或扩范围标待验证。',
  parameters:Type.Object({action:Type.Union([Type.Literal('goal-read-context'),Type.Literal('goal-propose-review')]),conclusions:Type.Optional(Type.Array(Type.Object({sourceRef:nonblank(500),title:nonblank(300),summary:nonblank(2000),originalScope:nonblank(500),applicableScope:nonblank(500),evidenceMature:Type.Boolean(),causalVerified:Type.Boolean(),targetScopeSameAsOriginal:Type.Boolean()},exact),{maxItems:30}))},exact),
};

const caseDeclarationUuid = (description?: string) => Type.String({ pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$', ...(description ? { description } : {}) });
const caseChooseTargetSchema = Type.Object({
  kind: Type.Literal('choose'),
  strategyRef: Type.Object({
    type: Type.Literal('case-decision'),
    caseStoreId: caseDeclarationUuid('来自 case-read-declarations(section="strategies") 的 strategyRef.caseStoreId'),
    caseId: caseDeclarationUuid('来自 strategyRef.caseId'),
    recordId: caseDeclarationUuid('来自 strategyRef.recordId'),
    revision: Type.Integer({ minimum: 1, description: '来自 strategyRef.revision（正整数）' }),
  }, exact),
  expectedPreviousChoiceId: Type.Union([caseDeclarationUuid('当前事项最新 choiceId（来自 section="choices"）；尚无取舍时传 null'), Type.Null()]),
}, { ...exact, description: 'choose 请求目标：strategyRef 必须来自 section="strategies"；expectedPreviousChoiceId 取 section="choices" 末条 choiceId，尚无取舍时传 null。' });
const caseObserveTargetSchema = Type.Object({
  kind: Type.Literal('observe'),
  projectId: caseDeclarationUuid('来自 section="observations" 的 target.projectId'),
  itemId: caseDeclarationUuid('来自 section="observations" 的 target.itemId'),
  taskId: caseDeclarationUuid('来自 section="observations" 的 target.taskId'),
  authorizationId: caseDeclarationUuid('来自 section="observations" 的 target.authorizationId（当前有效 Do 授权）'),
  feedbackBaseRevisionId: Type.Union([caseDeclarationUuid('来自 section="observations" 的 target.feedbackBaseRevisionId；尚无历史反馈时传 null'), Type.Null()]),
}, { ...exact, description: 'observe 请求目标：字段均必须来自 section="observations"；尚无历史反馈时 feedbackBaseRevisionId 传 null。' });

export const caseDeclarationsTool = {
  name: strategyDiscussionTool.name,
  label: 'Case 事项关系与明确请求保存',
  description: [
    'case-read-declarations 按 section 只读本案 issues/edges 和当前事项 requests/strategies/choices/observations，使用返回的准确身份与修订；limit 1–20，offset/nextOffset 或 strategies 的 continuation 分页，不把 partial 当完整结果。',
    '仅在用户明确声明本案两个事项的有向承接关系（case-save-issue-edge）或明确要求由谁对方案作取舍/补录观察（case-save-decision-request）时调用；Case 与当前事项归属由 Host 绑定，不接受模型改写他案。',
    '保存 choose 请求须先读 strategies 与 choices：target.kind="choose"，传准确 strategyRef（type/caseStoreId/caseId/recordId/revision）和 expectedPreviousChoiceId（当前事项最新 choiceId 或尚无取舍时传 null）。',
    '保存 observe 请求须先读 observations：target.kind="observe"，传返回的准确 projectId/itemId/taskId/authorizationId 与 feedbackBaseRevisionId（尚无历史观察时传 null）。',
    '新建请求（requestAction="save" 或省略）时请省略 requestId，expectedRequestRevision 传 0 或省略；修订、withdraw 或 supersede 已有请求时必须传 section="requests" 返回的 requestId 与当前 revision 作为 expectedRequestRevision。修订时省略 assignee 或 dueDate 保留原值，assignee 子字段或 dueDate 传 null 明确清除。',
    '若 strategies 或 observations 返回空列表，说明本事项缺少可用方案或当前取舍尚无有效行动授权：请向用户说明前置条件并保留原输入，不得猜测 ID 或伪造授权。',
  ].join(' '),
  parameters: Type.Object({
    action: Type.Union([Type.Literal('case-read-declarations'), Type.Literal('case-save-issue-edge'), Type.Literal('case-save-decision-request')]),
    section: Type.Optional(Type.Union(['issues','edges','requests','strategies','choices','observations'].map(value => Type.Literal(value)))),
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    continuation: Type.Optional(Type.String()),
    edgeId: Type.Optional(Type.String()),
    fromIssueId: Type.Optional(Type.String()),
    toIssueId: Type.Optional(Type.String()),
    edgeAction: Type.Optional(Type.Union([Type.Literal('save'), Type.Literal('remove')])),
    explanation: Type.Optional(Type.String({ maxLength: 1000 })),
    expectedEdgeRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    sourceKind: Type.Optional(Type.Union([Type.Literal('user-declaration'), Type.Literal('adopted-candidate')])),
    requestId: Type.Optional(caseDeclarationUuid('新建请求时请省略；修订/withdraw/supersede 已有请求时传 section="requests" 返回的 requestId')),
    requestAction: Type.Optional(Type.Union([Type.Literal('save'), Type.Literal('withdraw'), Type.Literal('supersede')])),
    kind: Type.Optional(Type.Union([Type.Literal('choose'), Type.Literal('observe')])),
    text: Type.Optional(Type.String({ maxLength: 4000 })),
    assignee: Type.Optional(Type.Object({
      label: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
      source: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
    }, { additionalProperties: false })),
    dueDate: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    target: Type.Optional(Type.Union([caseChooseTargetSchema, caseObserveTargetSchema])),
    expectedRequestRevision: Type.Optional(Type.Integer({ minimum: 0, description: '新建传 0 或省略；修订/withdraw/supersede 时必须等于 section="requests" 的当前 revision' })),
  }, { additionalProperties: false }),
};

const caseDeclarationErrorReasons: Readonly<Record<string, string>> = {
  invalid_case_decision_request: '请求参数或 target 结构不完整。新建请省略 requestId 并传 kind、text 与匹配的 target（choose 需 strategyRef+expectedPreviousChoiceId；observe 需 projectId/itemId/taskId/authorizationId/feedbackBaseRevisionId）；修订现有请求请传 requestId 与 expectedRequestRevision。',
  invalid_case_decision_id: '某项 UUID 标识缺失或格式无效（如 target 内层 ID、expectedPreviousChoiceId 或 requestId）；请先用 case-read-declarations 核对准确只读记录，缺少前置记录时勿猜测 ID。',
  invalid_case_decision_fields: '包含未允许字段或缺少必填字段，请按工具 schema 核对参数名与嵌套结构。',
  invalid_case_decision_reference: 'target.strategyRef 必须完整提供 type="case-decision"、caseStoreId、caseId、recordId 与正整数 revision。',
  invalid_case_decision_revision: 'revision 字段需为正整数（strategyRef.revision >= 1）；请从 case-read-declarations 读取最新版本号。',
  invalid_revision: 'expectedRequestRevision 需为非负整数：新建传 0（或省略），修订/withdraw/supersede 传原请求的当前 revision。',
  case_decision_request_not_found: '未找到指定 requestId（若为新建请求请勿传 requestId；若为修订请先读 section="requests" 核对原请求）。',
  case_decision_request_conflict: 'expectedRequestRevision 与当前请求版本不一致，或修订时改动了原请求的 kind/issueId；请重新读取 section="requests" 后再试。',
  case_decision_request_closed: '该请求已撤回或已被取代，不可再修订；如需新请求请省略 requestId 重新发起。',
  case_choice_conflict: '当前事项的最新取舍已变化（expectedPreviousChoiceId 或观察授权所属取舍已过期）；请重新读取 choices 与 observations 后确认是否仍需请求。',
  case_feedback_conflict: '该任务已有新的反馈记录，target.feedbackBaseRevisionId 已过期；请重新读取 section="observations" 获取最新 feedbackBaseRevisionId。',
  case_do_authorization_unavailable: '目标行动当前没有适用于本事项最新取舍的有效 Do 授权；请读取 section="observations"，若为空请向用户说明需先授权行动。',
  project_not_linked: 'target.projectId 所属项目尚未关联到当前 Case，或已解除关联；请先核对 section="observations" 中当前有效的已关联项目与授权。',
  task_not_found: 'target.taskId 在目标项目中不存在；请从 section="observations" 读取准确的 taskId 与 authorizationId。',
  case_decision_scope_mismatch: '目标任务或方案不属于当前 Case 与当前事项；请从当前事项的 case-read-declarations 重新核对。',
  case_decision_not_found: '目标方案版本不存在；请先读取 section="strategies"，若为空说明当前事项尚无可选方案。',
  case_decision_archived: '目标方案已归档，不可用于新建请求；请核对可用方案或向用户说明。',
  case_decision_plan_required: '该方案尚未通过 Plan 核对前提，不能创建取舍请求；请向用户说明前置条件。',
  case_decision_issue_not_found: '当前事项已不存在或无权读取，无法保存请求。',
};

export function explainCaseDeclarationError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (/Validation failed|schema/i.test(error.message)) {
    const explained = new Error(`${error.message}\n参数说明：choose 请求需传 target={ kind: "choose", strategyRef: { type: "case-decision", caseStoreId, caseId, recordId, revision }, expectedPreviousChoiceId }；observe 请求需传 target={ kind: "observe", projectId, itemId, taskId, authorizationId, feedbackBaseRevisionId }；新建请省略 requestId，修订请传 requestId 与 expectedRequestRevision。`);
    if ('details' in error) (explained as { details?: unknown }).details = (error as { details?: unknown }).details;
    return explained;
  }
  const codeMatch = /^([a-z][a-z0-9_]+)(?::\s*([\s\S]*))?$/.exec(error.message);
  const code = codeMatch?.[1] ?? error.message;
  if (!Object.hasOwn(caseDeclarationErrorReasons, code)) return error;
  const suffix = codeMatch?.[2] ? `（${codeMatch[2]}）` : '';
  const explained = new Error(`${code}：${caseDeclarationErrorReasons[code]}${suffix}`);
  if ('details' in error) (explained as { details?: unknown }).details = (error as { details?: unknown }).details;
  return explained;
}

import { Type } from 'typebox';

const exact = { additionalProperties: false };
const text = (maxLength: number, description?: string) => Type.String({ minLength: 1, maxLength, pattern: '\\S', ...(description ? { description } : {}) });
const optionalText = (maxLength: number) => Type.Optional(Type.String({ maxLength, pattern: '^$|\\S' }));
const choice = <T extends string>(values: T[]) => Type.Union(values.map(value => Type.Literal(value)));
const nullableNumber = Type.Union([Type.Number(), Type.Null()], { description: '未知填 null，不用 0 代替未知。' });
const sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' });
const uuid = Type.String({ pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' });
const metricKind = choice(['amount', 'ratio', 'milestone']);
const status = choice(['planned', 'undecided', 'observing']);
const scope = Type.Object({ kind: choice(['enterprise', 'department', 'personal']), id: text(300), name: text(300), enterpriseId: Type.Optional(uuid) }, exact);
const sourceRef = Type.Union([text(4000), Type.Object({
  authority: choice(['case', 'decision-board', 'project', 'task', 'sap-metric', 'strategy-discussion']),
  id: text(300), version: Type.Union([text(200), Type.Integer({ minimum: 1 })]),
  projectId: Type.Optional(uuid), taskId: Type.Optional(uuid), sha256: Type.Optional(sha256),
  sessionId: Type.Optional(text(200)), entryType: Type.Optional(choice(['message', 'tool-result'])),
}, exact)]);

/** Persistence contract, not an analysis method. Shared by both goal tools and parser diagnostics. */
export const reachabilityEstimateSchema = Type.Object({
  metricKind, unit: text(60, '与正式目标同单位。比率须明确 % 或小数；增量百分点不能冒充比率总值。'),
  period: text(100), scopeDescription: text(300), scope: Type.Optional(scope),
  sapMetric: Type.Optional(Type.Object({ authority: Type.Optional(Type.Literal('sap-metric')), id: text(300), version: text(200), metricName: Type.Optional(text(200)) }, {
    ...exact, description: '仅当原 goal.measurement.kind=quantitative 时沿用其 SAP 定义；无绑定时省略，不编造身份。',
  })),
  formalTargetValue: Type.Number({ description: '准确 GSA 正式目标值，不以测算或反推值替换。' }),
  estimatedValue: Type.Optional(nullableNumber),
  gapValue: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: '正式值减测算值；负数为预计余量。未知填 null，省略时由同口径两值相减。' })),
  numerator: Type.Optional(Type.Number()), denominator: Type.Optional(Type.Number()), denominatorAssumed: Type.Optional(Type.Boolean()),
  basis: optionalText(4000),
  evidence: Type.Optional(Type.Array(Type.Object({ category: choice(['internal', 'market', 'competitor', 'other']),
    summary: text(2000), basis: optionalText(2000), sourceRef: Type.Optional(sourceRef),
  }, exact), { maxItems: 50 })),
  limitations: Type.Optional(Type.Array(text(1000), { maxItems: 30 })), methodNote: optionalText(2000),
  scriptReceipts: Type.Optional(Type.Array(Type.Object({ skill: text(100), script: text(100), engineVersion: text(100),
    inputDigest: text(128), outputSha256: sha256, executedAt: text(100),
  }, exact), { maxItems: 20, description: '仅记录实际运行回执；未运行脚本则省略。脚本回执不是草稿保存必填项。' })),
}, { ...exact, description: '整体同口径可达测算。明确假设、依据和限制；达标条件反推不等于独立预测，不为过校验抹平差额。' });

const checkpoint = Type.Object({ id: text(120), label: text(300), date: text(40), targetValue: Type.Optional(nullableNumber),
  unit: text(60), status, evidenceSource: optionalText(1000),
}, exact);
export const decompositionRowSchema = Type.Object({
  rowId: text(120, '稳定行 ID；修订沿用，不能重复。'), linkedGoalId: Type.Optional(uuid),
  expectedGoalVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  expectedAdoptedVersion: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  title: text(300), outcome: text(4000), scope, scopeLabel: text(300), responsible: text(300), strategy: text(2000),
  contributionNature: choice(['allocation', 'driver-hypothesis', 'aggregation', 'milestone']),
  commitAsGoal: Type.Optional(Type.Boolean({ description: '负责人正式发布时是否承诺为子目标；保存不会采用。' })),
  metricKind, targetValue: Type.Optional(nullableNumber), unit: text(60),
  ratio: Type.Optional(Type.Object({ numerator: Type.Number(), denominator: Type.Number(),
    denominatorAssumed: Type.Optional(Type.Boolean()), definition: text(1000),
  }, { ...exact, description: '比率行保留同口径分子分母及假设；发布按分母汇总，不能直接相加百分比。' })),
  milestoneCriterion: optionalText(2000), crossCellId: optionalText(200),
  dimensions: Type.Optional(Type.Record(Type.String({ pattern: '^[\\s\\S]*$' }), text(200), { ...exact, propertyNames: text(80) })), basis: optionalText(2000),
  checkpoints: Type.Optional(Type.Array(checkpoint, { maxItems: 60 })), tracked: Type.Optional(Type.Boolean()),
}, exact);
const reserve = Type.Object({ id: Type.Optional(text(120)), amount: Type.Number(), unit: text(60), purpose: optionalText(1000),
  owner: optionalText(300), basis: optionalText(1000),
}, { ...exact, description: '可量化的未分配目标预留；不是人力资源清单。未知用途/负责人可留空保存草稿，发布须补齐。' });
const gapStrategy = Type.Object({ id: Type.Optional(text(120)), name: optionalText(300), strategy: optionalText(2000),
  expectedContribution: Type.Number(), unit: text(60), nonOverlappingScope: optionalText(1000), scopeKey: optionalText(200),
  basis: optionalText(2000), kind: Type.Optional(Type.Literal('expected-increment')),
}, { ...exact, description: '补缺策略的预期增量及互不重叠范围，须与差额同口径；未核贡献不可编数，可先在 notes 写待核策略。' });
const view = Type.Object({ viewId: text(120), viewName: text(200), metricId: text(200), period: text(100), coverageScope: text(200),
  reserveIncluded: Type.Optional(Type.Number()), cells: Type.Array(Type.Object({ crossCellId: text(200), label: text(300),
    value: Type.Number(), unit: text(60), basis: text(2000), sourceRef: optionalText(500),
  }, exact), { maxItems: 200 }),
}, { ...exact, description: '同口径交叉核对视图，重复视角不再次计入目标分配；未量化的归因在 notes 保留。' });
const timePlan = Type.Object({ periodId: text(120), granularity: choice(['month', 'week', 'day']), label: text(200),
  startDate: text(40), endDate: text(40), targetValue: Type.Optional(nullableNumber), unit: text(60), status,
  checkpointId: optionalText(120), constraintNote: optionalText(1000),
}, exact);

export const decompositionDraftFields = {
  gsaPlanId: uuid, gsaPlanVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), gsaPlanSha256: sha256,
  expectedDraftRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), estimate: reachabilityEstimateSchema,
  rows: Type.Array(decompositionRowSchema, { maxItems: 200 }),
  reserves: Type.Optional(Type.Array(reserve, { maxItems: 50 })),
  gapStrategies: Type.Optional(Type.Array(gapStrategy, { maxItems: 50 })),
  views: Type.Optional(Type.Array(view, { maxItems: 20 })),
  timePlan: Type.Optional(Type.Array(timePlan, { maxItems: 400 })), notes: optionalText(4000),
};
// These two fields belong to the existing HTTP/user path, not Agent permission to acknowledge upstream changes.
export const decompositionDraftInputSchema = Type.Object({ ...decompositionDraftFields,
  operationId: Type.Optional(uuid), reviewedPreviousPlanVersion: Type.Optional(Type.Integer({ minimum: 1 })),
}, exact);
export const goalDraftSaveContract = {
  version: 'goal-decomposition-input-v1', action: 'goal-save-decomposition-draft', inputLocation: 'top-level',
  fields: Object.keys(decompositionDraftFields),
  instructions: '字段结构见 strategy_goals.parameters。首次沿 draftInputTemplate 起草；已有稿沿 draft 保留原内容，只复制 fields 列出的业务字段，并使用当前 expectedDraftRevision。不得以空模板覆盖已有稿。GSA 变化仍须负责人核对。',
  validation: '格式失败未保存，也未运行发布校验；没有点名的区块不表示已核。saved=true 只证明草稿落盘；validation 是发布就绪检查，不证明假设或专业结论正确。',
};

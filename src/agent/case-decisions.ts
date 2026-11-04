import { Type } from 'typebox';

export type CaseDecisionToolResult = { content: { type: 'text'; text: string }[]; details: Record<string, unknown> };
/** Authority is supplied by the existing Host run, never by model arguments. */
export type CaseDecisionToolContext = {
  signal: AbortSignal; requestId: string; sessionId: string; toolCallId: string;
  caseOperationId: string; assertCurrent: () => void;
};
export type CaseDecisionPort = (action: 'read' | 'save', input: Record<string, unknown>, context: CaseDecisionToolContext) => Promise<CaseDecisionToolResult>;
export const readCaseDecisionsParameters = Type.Object({
  recordId: Type.Optional(Type.String()), revision: Type.Optional(Type.Integer({ minimum: 1 })),
  includeArchived: Type.Optional(Type.Boolean()), history: Type.Optional(Type.Boolean()),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), continuation: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const saveCaseDecisionParameters = Type.Object({
  recordId: Type.Optional(Type.String()), expectedRevision: Type.Integer({ minimum: 0 }),
  kind: Type.Union([Type.Literal('hypothesis'), Type.Literal('strategy')]),
  payload: Type.Object({
    title: Type.String(), statement: Type.Optional(Type.String()), proposal: Type.Optional(Type.String()),
    scope: Type.Optional(Type.Union([Type.String(), Type.Null()])), mechanism: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    unknowns: Type.Optional(Type.Union([Type.String(), Type.Null()])), whatWouldChangeJudgement: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    assessment: Type.Optional(Type.Union(['unresolved','supported','weakened','refuted'].map(v=>Type.Literal(v)))), assessmentReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    goal: Type.Optional(Type.Union([Type.String(), Type.Null()])), conditions: Type.Optional(Type.Union([Type.String(), Type.Null()])), limitations: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    plan: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  }, { additionalProperties: false }),
  references: Type.Optional(Type.Array(Type.Object({ relation: Type.Union(['supports','opposes','background','limits','derived_from','depends_on','action','feedback'].map(v=>Type.Literal(v))), target: Type.Record(Type.String(), Type.Unknown()), note: Type.Optional(Type.Union([Type.String(), Type.Null()])) }, { additionalProperties: false }), { maxItems: 32 })),
  impactNotes: Type.Optional(Type.Array(Type.Object({ target: Type.Record(Type.String(), Type.Unknown()), explanation: Type.String() }, { additionalProperties: false }))),
  changeReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
}, { additionalProperties: false });

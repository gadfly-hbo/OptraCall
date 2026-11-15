import { Type } from 'typebox';
import type { CaseDecisionToolContext, CaseDecisionToolResult } from './case-decisions.ts';

/** The current target Case and real author are bound by the existing Host run. */
export type CaseRelationsPort = (action: 'read' | 'save', input: Record<string, unknown>, context: CaseDecisionToolContext) => Promise<CaseDecisionToolResult>;

const kind = Type.Union([Type.Literal('follows_up'), Type.Literal('supports')]);
const exact = { additionalProperties: false };
const decisionRef = Type.Object({ type: Type.Literal('case-decision'), caseStoreId: Type.String(), caseId: Type.String(), recordId: Type.String(), revision: Type.Integer({ minimum: 1 }) }, exact);
const excerpt = Type.Optional(Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }) }, exact));
const source = Type.Union([
  Type.Object({ ...decisionRef.properties, excerpt }, exact),
  Type.Object({ type: Type.Literal('case-choice'), caseStoreId: Type.String(), caseId: Type.String(), choiceId: Type.String(), excerpt }, exact),
  Type.Object({ type: Type.Literal('case-artifact'), caseStoreId: Type.String(), caseId: Type.String(), artifactId: Type.String(), observedSha256: Type.Union([Type.String(), Type.Null()]) }, exact),
]);
export const readCaseRelationsParameters = Type.Object({
  relationId: Type.Optional(Type.String()), revision: Type.Optional(Type.Integer({ minimum: 1 })),
  sourceIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 7 })),
  includeUnlinked: Type.Optional(Type.Boolean()), kind: Type.Optional(kind),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })), continuation: Type.Optional(Type.String({ maxLength: 4000 })),
}, { additionalProperties: false });

export const saveCaseRelationParameters = Type.Object({
  relationId: Type.Optional(Type.String()), fromCaseId: Type.Optional(Type.String()), kind: Type.Optional(kind),
  expectedRelationRevision: Type.Integer({ minimum: 0 }),
  action: Type.Optional(Type.Union(['save', 'unlink', 'restore'].map(value => Type.Literal(value)))),
  explanation: Type.Optional(Type.String({ maxLength: 4000 })),
  targetScope: Type.Optional(Type.String({ maxLength: 4000 })),
  targetRef: Type.Optional(Type.Union([decisionRef, Type.Null()])),
  sources: Type.Optional(Type.Array(source, { maxItems: 8 })),
  assertionNature: Type.Optional(Type.Union([Type.Literal('explicit'), Type.Literal('inferred')])),
  changeReason: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
}, { additionalProperties: false });

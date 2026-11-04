import { Type } from 'typebox';
import type { CaseDecisionToolResult } from './case-decisions.ts';

/** Read authority belongs to the actual ordinary task, independent of Case write binding. */
export type CaseSourcesPort = (action: 'find' | 'read', input: Record<string, unknown>, context: {
  signal: AbortSignal; requestId: string; sessionId: string; toolCallId: string; assertCurrent: () => void;
}) => Promise<CaseDecisionToolResult>;
const exact = { additionalProperties: false }, id = Type.String({ minLength: 1, maxLength: 1024 });
const continuation = Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]));
export const readCaseSourcesParameters = Type.Union([
  Type.Object({ action: Type.Literal('find'), query: Type.Optional(Type.String({ maxLength: 200 })), caseId: Type.Optional(id), includeArchived: Type.Optional(Type.Boolean()), pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), continuation }, exact),
  Type.Object({ action: Type.Literal('read'), target: Type.Union([
    Type.Object({ type: Type.Literal('case-decision'), caseStoreId: id, caseId: id, recordId: id, revision: Type.Integer({ minimum: 1 }) }, exact),
    Type.Object({ type: Type.Literal('case-choice'), caseStoreId: id, caseId: id, choiceId: id }, exact),
  ]), part: Type.Optional(Type.Union([Type.Literal('content'), Type.Literal('reference')])), sourceIndex: Type.Optional(Type.Integer({ minimum: 0 })), continuation }, exact),
]);

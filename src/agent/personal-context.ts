import { Type } from 'typebox';
import type { PersonalContextTarget, PersonalContextRange } from '../host/personal-context-types.ts';
import type { LearningSourceRef } from '../host/learning-source-types.ts';

/** Business metadata only; actual visible text is owned by the Pi message. */
export type PersonalContextDeliveryItem = {
  target: PersonalContextTarget; part: 'catalog' | 'content' | 'corrections' | 'source';
  extent: 'metadata' | 'fragment' | 'full'; range: PersonalContextRange | null;
  title: string; scope: string | null; effectiveTime: string | null; caution: string | null;
  governance: { archived: boolean; enterpriseEnabled: boolean | null; sourceProjectArchived: boolean | null; targetRevision: number | null; latestCorrectionOperationId: string | null };
  limitations: string[]; sourceRef?: LearningSourceRef;
};
export type PersonalContextDelivery = {
  schemaVersion: 1; type: 'optracall.personal-context-delivery'; action: 'find' | 'read';
  items: PersonalContextDeliveryItem[]; partial: boolean; continuation: string | null;
  issues: { code: string; target?: PersonalContextTarget; sourceRef?: LearningSourceRef; file?: string }[];
};
export type PersonalContextReceipt = { schemaVersion: 1; items: PersonalContextDeliveryItem[] };
export type PersonalContextToolResult = { content: { type: 'text'; text: string }[]; details: PersonalContextDelivery };
/** Host closes over the real project/task; no model-supplied owner or path is accepted. */
export type PersonalContextPort = (action: 'find' | 'read', input: Record<string, unknown>, context: { signal: AbortSignal }) => Promise<PersonalContextToolResult>;

const exact = { additionalProperties: false };
const identifier = Type.String({ minLength: 1, maxLength: 1024 });
const sha = Type.String({ pattern: '^[a-f0-9]{64}$' });
const range = Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 1 }) }, exact);
const target = Type.Union([
  Type.Object({ type: Type.Literal('retained'), storeId: identifier, materialId: identifier, decisionId: identifier, revisionId: identifier, expectedBodySha256: sha }, exact),
  Type.Object({ type: Type.Literal('agent-candidate'), candidate: Type.Object({ projectId: identifier, taskId: identifier, originSessionId: identifier, entryId: identifier, toolCallId: identifier, expectedDetailsSha256: sha }, exact) }, exact),
]);
const continuation = Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]));
export const findPersonalContextParameters = Type.Object({ query: Type.Optional(Type.String({ maxLength: 200 })), kind: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('knowledge'), Type.Literal('experience')])), includeArchived: Type.Optional(Type.Boolean()), pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), continuation }, exact);
export const readPersonalContextParameters = Type.Object({ target, part: Type.Optional(Type.Union([Type.Literal('content'), Type.Literal('corrections'), Type.Literal('source')])), sourceIndex: Type.Optional(Type.Integer({ minimum: 0 })), range: Type.Optional(range), continuation }, exact);

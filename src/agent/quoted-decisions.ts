import { Type } from 'typebox';

export interface UserQuoteProvenance {
  schemaVersion: 1;
  projectId: string; taskId: string; requestId: string; sessionId: string; toolCallId: string;
  originalUserTextSha256: string;
  quote: { start: number; end: number; text: string };
}
/** Structural decoding only. The Host adapter separately verifies the real user text. */
export function parseUserQuoteProvenance(input: unknown): UserQuoteProvenance {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const fail = (): never => { throw Object.assign(new Error('invalid_user_quote_provenance'), { code: 'invalid_user_quote_provenance' }); };
  if (!object(input) || input.schemaVersion !== 1 || Object.keys(input).some(key => !['schemaVersion', 'projectId', 'taskId', 'requestId', 'sessionId', 'toolCallId', 'originalUserTextSha256', 'quote'].includes(key))) return fail();
  for (const key of ['projectId', 'taskId', 'requestId']) if (typeof input[key] !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input[key] as string)) return fail();
  for (const key of ['sessionId', 'toolCallId']) if (typeof input[key] !== 'string' || !(input[key] as string).trim() || (input[key] as string).length > 200) return fail();
  const quote = input.quote;
  if (typeof input.originalUserTextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.originalUserTextSha256) || !object(quote) || Object.keys(quote).some(key => !['start', 'end', 'text'].includes(key)) ||
      !Number.isSafeInteger(quote.start) || Number(quote.start) < 0 || !Number.isSafeInteger(quote.end) || Number(quote.end) <= Number(quote.start) || typeof quote.text !== 'string' || !quote.text.trim() || quote.text.length > 20000 || Number(quote.end) - Number(quote.start) !== quote.text.length) return fail();
  return { schemaVersion: 1, projectId: input.projectId as string, taskId: input.taskId as string, requestId: input.requestId as string, sessionId: input.sessionId as string, toolCallId: input.toolCallId as string,
    originalUserTextSha256: input.originalUserTextSha256, quote: { start: Number(quote.start), end: Number(quote.end), text: quote.text } };
}

export type QuotedDecisionAction = 'read' | 'choose-strategy' | 'authorize-action' | 'record-feedback';
export type QuotedDecisionToolResult = { content: { type: 'text'; text: string }[]; details: Record<string, unknown> };
export type QuotedDecisionCallContext = { requestId: string; sessionId: string; toolCallId: string; signal: AbortSignal; assertCurrent(): void };
export type QuotedDecisionPort = (action: QuotedDecisionAction, input: Record<string, unknown>, context: QuotedDecisionCallContext) => Promise<QuotedDecisionToolResult>;
const quote = Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 1 }), text: Type.String({ minLength: 1, maxLength: 20000 }) }, { additionalProperties: false });
const strategyRef = Type.Object({ type: Type.Literal('case-decision'), caseStoreId: Type.String(), caseId: Type.String(), recordId: Type.String(), revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
const previous = Type.Union([Type.String(), Type.Null()]);
export const quotedDecisionParameters = Type.Object({
  action: Type.Union(['read', 'choose-strategy', 'authorize-action', 'record-feedback'].map(value => Type.Literal(value))),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })), actionContinuation: Type.Optional(Type.String({ maxLength: 2000 })), decisionContinuation: Type.Optional(Type.String({ maxLength: 2000 })),
  quote: Type.Optional(quote), strategyRef: Type.Optional(strategyRef),
  choice: Type.Optional(Type.Union(['trial', 'gather_evidence', 'defer', 'reject', 'no_action', 'continue', 'adjust', 'stop_considering'].map(value => Type.Literal(value)))),
  reason: Type.Optional(Type.String({ maxLength: 4000 })), expectedPreviousChoiceId: Type.Optional(previous), choiceId: Type.Optional(Type.String()),
  allowHistorical: Type.Optional(Type.Boolean()),
  itemId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()), itemVersion: Type.Optional(Type.String()), taskVersion: Type.Optional(Type.String()),
  decision: Type.Optional(Type.Union([Type.Literal('authorize'), Type.Literal('revoke')])), scope: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })), expectedPreviousAuthorizationId: Type.Optional(previous),
  expectedLatestRevisionId: Type.Optional(previous), adopted: Type.Optional(Type.Boolean()), outcome: Type.Optional(Type.String({ maxLength: 4000 })), metricDelta: Type.Optional(Type.String({ maxLength: 1000 })),
  review: Type.Optional(Type.String({ maxLength: 4000 })), score: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 5 }), Type.Null()])),
  effect: Type.Optional(Type.Union(['unknown', 'positive', 'negative', 'none'].map(value => Type.Literal(value)))),
}, { additionalProperties: false });
export const quotedDecisionTool = {
  feature: 'quoted-decisions', name: 'record_user_decision', label: '按用户原话记录决定', parameters: quotedDecisionParameters,
  description: '在Host已绑定的当前Case内，按本轮真实用户原话代办明确选择或单独行动授权、反馈。read先查准确方案与看板行动、版本和CAS。写入给quote的UTF-16 [start,end)准确子串、strategyRef及相应上次记录ID；不得传originalUserText、身份或虚构原话。结合当前真实上下文自主解释用户指向；含糊时集中向用户澄清，不调用写入，不用clear标志替代解释。选择方案不代表发券、补货、调价或触达授权；authorize-action仅登记明确动作范围或撤回，不创建或执行动作。record-feedback只保留用户报告，不能从采纳/授权推定发生或效果验证。原草案仍用原Case工具。本工具返回原权威回执，UNKNOWN先读原记录，不换ID重放。',
} as const;

import { Type } from 'typebox';

export type MethodIssueCallContext = { signal: AbortSignal; requestId: string; sessionId: string; toolCallId: string; assertCurrent(): void };
export type MethodIssueResult = { content: { type: 'text'; text: string }[]; details: Record<string, unknown> };
export type MethodIssuePort = (input: Record<string, unknown>, context: MethodIssueCallContext) => Promise<MethodIssueResult>;
export const methodIssueParameters = Type.Object({
  methodId: Type.String(), version: Type.Integer({ minimum: 1 }), expectedRevision: Type.Integer({ minimum: 0 }), note: Type.String({ minLength: 1, maxLength: 20000 }),
  sources: Type.Array(Type.Object({ type: Type.Union(['session', 'report', 'memory', 'method'].map(value => Type.Literal(value))), label: Type.String({ maxLength: 500 }),
    ref: Type.String({ minLength: 1, maxLength: 8000 }), version: Type.String({ minLength: 1, maxLength: 500 }), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }),
}, { additionalProperties: false });
export const methodIssueTool = { feature: 'method-issue', action: 'report', name: 'report_method_issue', label: '反馈已发现的方法问题', parameters: methodIssueParameters,
  description: '仅把本Task分析中已经发现的问题反馈到准确已发布SAP方法版本，status固定为suspected。提供methodId/version、原governanceRevision作为expectedRevision、具体问题note和本Task已有的准确来源ref/version/hash。Host验证企业读权、来源与本轮资格；不会为了资产沉淀回看会话提炼方法。无明确问题可零次调用。不能确认错误、提交replacement、创建/修订/发布方法或调用IR来源reader。原请求由Host绑定；失败或UNKNOWN先查原回执，不换ID或重复保存。',
} as const;

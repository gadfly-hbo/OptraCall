import { Type } from 'typebox';
import type { SemanticQueryResult } from '../../extensions/business-plugins/semantic-context/types.ts';

/** Original M2 acknowledgement only; author declaration does not verify adoption. */
export type SemanticSourcesRecorded = {
  schemaVersion: 1; type: 'optracall.analysis-sources-recorded'; claim: 'author-declaration-not-verification';
  projectId: string; citationId: string; operationId: string; indexRevision: number;
  replayed: boolean; publishedOnRetry: boolean; report: { originalPath: string; sha256: string; bytes: number };
};
export type SemanticContextToolResult = { content: { type: 'text'; text: string }[]; details: SemanticQueryResult | SemanticSourcesRecorded };
/** The existing Host run supplies authority; model arguments cannot bind an owner. */
export type SemanticContextPort = (action: 'find' | 'read' | 'trace' | 'record', input: Record<string, unknown>, context: {
  signal: AbortSignal; requestId: string; sessionId: string; toolCallId: string; assertCurrent: () => void;
}) => Promise<SemanticContextToolResult>;

const exact = { additionalProperties: false };
const id = Type.String({ minLength: 1, maxLength: 1024 });
const sha = Type.String({ pattern: '^[a-f0-9]{64}$' });
const nullableSha = Type.Union([sha, Type.Null()]);
const uuid = Type.String({ pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' });
const range = Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 1 }) }, exact);
const candidate = Type.Object({ projectId: id, taskId: id, originSessionId: id, entryId: id, toolCallId: id, expectedDetailsSha256: sha }, exact);
const personal = Type.Union([
  Type.Object({ type: Type.Literal('retained'), storeId: id, materialId: id, decisionId: id, revisionId: id, expectedBodySha256: sha }, exact),
  Type.Object({ type: Type.Literal('agent-candidate'), candidate }, exact),
]);
const target = Type.Union([
  Type.Object({ kind: Type.Literal('sap'), packageId: id, version: id, metricName: Type.Optional(id), publishedHash: Type.Optional(nullableSha) }, exact),
  Type.Object({ kind: Type.Literal('sap-method'), methodId: uuid, version: Type.Integer({ minimum: 1 }), publishedHash: Type.Optional(nullableSha) }, exact),
  Type.Object({ kind: Type.Literal('enterprise'), storeId: id, materialId: id, revisionId: id, location: Type.Optional(range) }, exact),
  Type.Object({ kind: Type.Literal('data-input'), projectId: id, datasetId: id, inputVersionId: id }, exact),
  Type.Object({ kind: Type.Literal('data-description'), projectId: id, datasetId: id, inputVersionId: id, descriptionRevisionId: id }, exact),
  Type.Object({ kind: Type.Literal('data-citation'), projectId: id, citationId: id }, exact),
  Type.Object({ kind: Type.Literal('data-evidence'), projectId: id, citationId: id, attachmentIndex: Type.Union([Type.Integer({ minimum: 0, maximum: 18 }), Type.Null()]) }, exact),
  Type.Object({ kind: Type.Literal('case-decision'), caseStoreId: id, caseId: id, recordId: id, revision: Type.Integer({ minimum: 1 }) }, exact),
  Type.Object({ kind: Type.Literal('case-choice'), caseStoreId: id, caseId: id, choiceId: id }, exact),
  Type.Object({ kind: Type.Literal('source'), source: Type.Record(Type.String(), Type.Unknown(), { description: 'An exact original M4/M6 LearningSourceRef returned by the directory; keep its type, original identity/version/hash fields and optional excerpt. Host validates the original source contract.' }) }, exact),
  Type.Object({ kind: Type.Literal('personal'), target: personal }, exact),
]);
const kinds = ['sap', 'sap-method', 'enterprise', 'data-input', 'data-description', 'data-citation', 'data-evidence', 'case-decision', 'case-choice', 'source', 'personal'];
const pagination = {
  recordedBefore: Type.Optional(Type.String({ description: 'ISO8601 timestamp with timezone, filtering trustworthy recorded time only; unknown time remains explicitly unknown.' })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  continuation: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()])),
};
export const readSemanticContextParameters = Type.Union([
  Type.Object({ action: Type.Literal('find'), query: Type.Optional(Type.String({ maxLength: 200 })), kinds: Type.Optional(Type.Array(Type.Union(kinds.map(kind => Type.Literal(kind))))), ...pagination }, exact),
  Type.Object({ action: Type.Union([Type.Literal('read'), Type.Literal('trace')]), target, ...pagination }, exact),
]);
const file = Type.Object({ path: id, sha256: sha, bytes: Type.Integer({ minimum: 0, maximum: 50 * 1024 * 1024 }) }, exact);
const conceptRef = Type.Object({ storeId: id, materialId: id, revisionId: id, location: Type.Optional(range) }, exact);
const sapRef = Type.Object({ packageId: id, version: id, metricName: id, publishedHash: nullableSha }, exact);
export const recordAnalysisSourcesParameters = Type.Object({
  operationId: uuid, citationId: uuid, baseIndexRevision: Type.Integer({ minimum: 0 }),
  report: file, attachments: Type.Array(file, { maxItems: 19 }),
  selections: Type.Array(Type.Object({ datasetId: id, inputVersionId: id, descriptionRevisionId: Type.Union([id, Type.Null()]) }, exact)),
  conceptRefs: Type.Array(conceptRef), sapRefs: Type.Array(sapRef), declaration: Type.String({ minLength: 1, maxLength: 20_000 }),
  revisionReason: Type.Optional(Type.Union([Type.String({ maxLength: 20_000 }), Type.Null()])),
  nativeEvidence: Type.Optional(Type.Union([Type.Object({ taskId: id, nativeSessionId: id, entryId: id }, exact), Type.Null()])),
}, exact);

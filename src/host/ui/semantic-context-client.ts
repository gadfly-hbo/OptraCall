import type { SemanticQueryInput, SemanticQueryResult, SemanticTarget } from '../../../extensions/business-plugins/semantic-context/types.ts';
import type { SemanticSourcesRecorded } from '../../agent/semantic-context.ts';
export type { SemanticItem, SemanticQueryInput, SemanticQueryResult, SemanticSourceState, SemanticTarget } from '../../../extensions/business-plugins/semantic-context/types.ts';
export type { SemanticSourcesRecorded } from '../../agent/semantic-context.ts';

export type SemanticContextRecord = { result?: SemanticQueryResult; receipt?: SemanticSourcesRecorded; input?: SemanticQueryInput; issue?: string; native?: { sessionId: string; entryId: string; toolCallId?: string; recordedAt?: string } };
export type SemanticContextReader = (projectId: string, taskId: string, input: SemanticQueryInput, signal?: AbortSignal) => Promise<SemanticQueryResult>;

export class SemanticContextRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) { super(message); this.name = 'SemanticContextRequestError'; this.code = code; this.status = status; }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const textList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sourceState = (value: unknown) => typeof value === 'string' && ['available', 'missing', 'hash-conflict', 'forbidden', 'excluded', 'disabled', 'unknown', 'partial'].includes(value);
const strings = (value: Record<string, unknown>, ...keys: string[]) => keys.every(key => typeof value[key] === 'string');
function target(value: unknown): value is SemanticTarget {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'sap': return strings(value, 'packageId', 'version') && (value.metricName === undefined || typeof value.metricName === 'string') && (value.publishedHash === undefined || value.publishedHash === null || typeof value.publishedHash === 'string');
    case 'enterprise': return strings(value, 'storeId', 'materialId', 'revisionId') && (value.location === undefined || object(value.location) && integer(value.location.start) && integer(value.location.end) && value.location.end >= value.location.start);
    case 'data-input': return strings(value, 'projectId', 'datasetId', 'inputVersionId');
    case 'data-description': return strings(value, 'projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId');
    case 'data-citation': return strings(value, 'projectId', 'citationId');
    case 'data-evidence': return strings(value, 'projectId', 'citationId') && (value.attachmentIndex === null || integer(value.attachmentIndex));
    case 'case-decision': return strings(value, 'caseStoreId', 'caseId', 'recordId') && integer(value.revision);
    case 'case-choice': return strings(value, 'caseStoreId', 'caseId', 'choiceId');
    case 'source': return object(value.source) && typeof value.source.type === 'string';
    case 'personal': return object(value.target);
    default: return false;
  }
}
function item(value: unknown): boolean {
  if (!object(value) || !target(value.target) || !sourceState(value.state) || !(value.title === null || typeof value.title === 'string') || !(value.sha256 === null || typeof value.sha256 === 'string') || !(value.body === null || typeof value.body === 'string') || !textList(value.gaps)) return false;
  if (!(value.range === null || object(value.range) && integer(value.range.start) && integer(value.range.end) && integer(value.range.total) && value.range.start <= value.range.end && value.range.end <= value.range.total)) return false;
  if (value.metadataFragment !== undefined && !(object(value.metadataFragment) && typeof value.metadataFragment.text === 'string' && object(value.metadataFragment.range) && integer(value.metadataFragment.range.start) && integer(value.metadataFragment.range.end) && integer(value.metadataFragment.range.total) && value.metadataFragment.range.start <= value.metadataFragment.range.end && value.metadataFragment.range.end <= value.metadataFragment.range.total && value.metadataFragment.text.length === value.metadataFragment.range.end - value.metadataFragment.range.start)) return false;
  if (!(value.recordedAt === null || object(value.recordedAt) && strings(value.recordedAt, 'field', 'value'))) return false;
  if (!Array.isArray(value.businessTime) || !value.businessTime.every(time => object(time) && strings(time, 'text', 'source'))) return false;
  if (!(value.governance === null || object(value.governance)) || !(value.declaration === null || object(value.declaration) && strings(value.declaration, 'actor', 'text') && value.declaration.claim === 'author-declaration')) return false;
  return (value.code === undefined || typeof value.code === 'string') && Array.isArray(value.relations) && value.relations.every(relation => object(relation) && typeof relation.relation === 'string' && (relation.target === null || target(relation.target)) && (relation.note === null || typeof relation.note === 'string') && ['author-declaration', 'explicit-reference'].includes(String(relation.claim)));
}

/** Checks displayable transient fields only; source authority and permission remain with the original Store. */
export function isSemanticQueryResult(value: unknown): value is SemanticQueryResult {
  if (!object(value) || value.schemaVersion !== 1 || value.type !== 'optracall.semantic-context-result' || !['find', 'read', 'trace'].includes(String(value.action)) || !sourceState(value.state)) return false;
  return Array.isArray(value.items) && value.items.every(item) && Array.isArray(value.unknownTime) && value.unknownTime.every(item) && (value.indexRevision === null || integer(value.indexRevision)) && object(value.coverage) && typeof value.coverage.complete === 'boolean' && (value.coverage.continuation === null || typeof value.coverage.continuation === 'string') && textList(value.coverage.gaps);
}

export function isSemanticSourcesRecorded(value: unknown): value is SemanticSourcesRecorded {
  return object(value) && value.schemaVersion === 1 && value.type === 'optracall.analysis-sources-recorded' && value.claim === 'author-declaration-not-verification' && strings(value, 'projectId', 'citationId', 'operationId') && integer(value.indexRevision) && typeof value.replayed === 'boolean' && typeof value.publishedOnRetry === 'boolean' && object(value.report) && strings(value.report, 'originalPath', 'sha256') && /^[a-f0-9]{64}$/i.test(value.report.sha256 as string) && integer(value.report.bytes);
}

export const readSemanticContext: SemanticContextReader = async (projectId, taskId, input, signal) => {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/semantic-context`, { method: 'POST', credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-optracall-client': '1' }, body: JSON.stringify(input), signal });
  let result;
  try { result = await response.json(); }
  catch { throw new SemanticContextRequestError('semantic_context_invalid_response', response.status, '本次来源回包无法核定，原记录保持。'); }
  if (!response.ok) throw new SemanticContextRequestError(typeof result?.code === 'string' ? result.code : typeof result?.error === 'string' ? result.error : 'semantic_context_failed', response.status, typeof result?.message === 'string' ? result.message : '本次来源读取未能核定，原任务仍可继续。');
  if (!isSemanticQueryResult(result)) throw new SemanticContextRequestError('semantic_context_invalid_response', response.status, '本次来源回包无法核定，原记录保持。');
  return result;
};

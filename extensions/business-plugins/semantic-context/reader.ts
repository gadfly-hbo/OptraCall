import type { SemanticItem, SemanticQueryInput, SemanticQueryResult, SemanticTarget } from './types.ts';

export type SemanticPageBinding = { identity: string; version: string };
export class SemanticReadFault extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const kinds = ['sap', 'sap-method', 'enterprise', 'data-input', 'data-description', 'data-citation', 'data-evidence', 'case-decision', 'case-choice', 'source', 'personal'] as const;
export function parseSemanticQueryInput(value: unknown): SemanticQueryInput {
  const fail = (): never => { throw new SemanticReadFault('invalid_semantic_context_request'); };
  if (!object(value) || !['find', 'read', 'trace'].includes(String(value.action))) return fail();
  const allowed = value.action === 'find' ? ['action', 'query', 'kinds', 'recordedBefore', 'pageSize', 'continuation'] : ['action', 'target', 'recordedBefore', 'pageSize', 'continuation'];
  if (Object.keys(value).some(key => !allowed.includes(key))) return fail();
  if (value.query !== undefined && (typeof value.query !== 'string' || value.query.length > 200 || value.query.includes('\0'))) return fail();
  if (value.kinds !== undefined && (!Array.isArray(value.kinds) || value.kinds.length > kinds.length || value.kinds.some(kind => !kinds.includes(kind)))) return fail();
  if (value.pageSize !== undefined && (!Number.isSafeInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 100)) return fail();
  if (value.continuation != null && (typeof value.continuation !== 'string' || value.continuation.length > 4096 || !value.continuation.length)) return fail();
  if (value.recordedBefore !== undefined && !qualifiedRecordedTime(value.recordedBefore)) return fail();
  if (value.action === 'find') return value as SemanticQueryInput;
  if (!object(value.target)) return fail();
  const target = value.target;
  const fields: Record<SemanticTarget['kind'], [string[], string[]]> = {
    sap: [['packageId', 'version'], ['metricName', 'publishedHash']], enterprise: [['storeId', 'materialId', 'revisionId'], ['location']],
    'sap-method': [['methodId', 'version'], ['publishedHash']],
    'data-input': [['projectId', 'datasetId', 'inputVersionId'], []], 'data-description': [['projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId'], []],
    'data-citation': [['projectId', 'citationId'], []], 'data-evidence': [['projectId', 'citationId', 'attachmentIndex'], []],
    'case-decision': [['caseStoreId', 'caseId', 'recordId', 'revision'], []], 'case-choice': [['caseStoreId', 'caseId', 'choiceId'], []],
    source: [['source'], []], personal: [['target'], []],
  };
  if (!kinds.includes(target.kind as SemanticTarget['kind'])) return fail();
  const [required, optional] = fields[target.kind as SemanticTarget['kind']];
  if (required.some(key => target[key] === undefined) || Object.keys(target).some(key => !['kind', ...required, ...optional].includes(key))) return fail();
  for (const [key, item] of Object.entries(target)) {
    if (key === 'kind') continue;
    if (key === 'source' || key === 'target') { if (!object(item)) return fail(); }
    else if (key === 'revision' || key === 'attachmentIndex' || key === 'version' && target.kind === 'sap-method') { if (!(key === 'attachmentIndex' && item === null) && (!Number.isSafeInteger(item) || Number(item) < (key === 'attachmentIndex' ? 0 : 1))) return fail(); }
    else if (key === 'publishedHash') { if (item !== null && (typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item))) return fail(); }
    else if (key === 'location') { if (!object(item) || Object.keys(item).some(key => !['start', 'end'].includes(key)) || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || Number(item.start) < 0 || Number(item.end) <= Number(item.start)) return fail(); }
    else if (typeof item !== 'string' || !item.length || item.length > 1000 || item.includes('\0')) return fail();
  }
  return value as SemanticQueryInput;
}
const boundary = (text: string, position: number) => !(position > 0 && position < text.length && /[\uD800-\uDBFF]/.test(text[position - 1]!) && /[\uDC00-\uDFFF]/.test(text[position]!));
export function qualifiedRecordedTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return false;
  const [, y, month, day, hour, minute, second, , zoneHour, zoneMinute] = m;
  const lastDay = new Date(Date.UTC(Number(y), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= lastDay && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 && (!zoneHour || Number(zoneHour) <= 23 && Number(zoneMinute) < 60) && Number.isFinite(Date.parse(value));
}
type Cursor = SemanticPageBinding & { item: number; body: number; relation: number; metadata: number };
const encode = (cursor: Cursor) => btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function semanticPage(input: SemanticQueryInput, items: SemanticItem[], binding: SemanticPageBinding, indexRevision: number | null): SemanticQueryResult {
  const size = input.pageSize ?? 20;
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new SemanticReadFault('invalid_semantic_context_page_size');
  if (input.recordedBefore !== undefined && !qualifiedRecordedTime(input.recordedBefore)) throw new SemanticReadFault('invalid_semantic_context_recorded_before');
  const before = input.recordedBefore === undefined ? null : Date.parse(input.recordedBefore);
  const rows = items.filter(item => before === null || !item.recordedAt || !qualifiedRecordedTime(item.recordedAt.value) || Date.parse(item.recordedAt.value) <= before);
  let cursor: Cursor = { ...binding, item: 0, body: 0, relation: 0, metadata: 0 };
  if (input.continuation) {
    try {
      if (input.continuation.length > 4096) throw new Error();
      const decoded = JSON.parse(atob(input.continuation.replace(/-/g, '+').replace(/_/g, '/'))) as Cursor;
      if (decoded.identity !== binding.identity || decoded.version !== binding.version || ![decoded.item, decoded.body, decoded.relation, decoded.metadata].every(n => Number.isSafeInteger(n) && n >= 0) || decoded.item >= rows.length) throw new Error();
      cursor = decoded;
    } catch { throw new SemanticReadFault('semantic_context_continuation_stale', 409); }
  }
  const visible: SemanticItem[] = [], unknownTime: SemanticItem[] = [];
  let remaining = 20_000, count = 0;
  while (cursor.item < rows.length && count < size && remaining > 0) {
    const source = rows[cursor.item]!, body = source.body ?? '';
    const originalMetadata = JSON.stringify({ title: source.title, businessTime: source.businessTime, governance: source.governance, declaration: source.declaration, relations: source.relations });
    const metadata = originalMetadata.length > 4000 ? originalMetadata : '';
    if (cursor.body > body.length || !boundary(body, cursor.body) || cursor.relation > source.relations.length || cursor.metadata > metadata.length || !boundary(metadata, cursor.metadata)) throw new SemanticReadFault('semantic_context_continuation_stale', 409);
    const relations = [] as SemanticItem['relations'];
    let relationCharacters = 0;
    for (const original of source.relations.slice(cursor.relation, cursor.relation + Math.max(1, size - count))) {
      let ref = original;
      if (metadata) {
        ref = { relation: original.relation, target: original.target, note: null, claim: original.claim, ...(original.state ? { state: original.state } : {}) };
        if (JSON.stringify(ref).length > 4000) ref = { ...ref, target: null };
      }
      const length = JSON.stringify(ref).length;
      if (relations.length && relationCharacters + length > 4000) break;
      relations.push(ref); relationCharacters += length;
    }
    const small = metadata ? { title: source.title?.slice(0, 512) ?? null, businessTime: [], governance: null, declaration: null } : {};
    const metadataCost = JSON.stringify({ ...small, ...(metadata ? {} : { title: source.title, businessTime: source.businessTime, governance: source.governance, declaration: source.declaration }), relations }).length;
    if (visible.length + unknownTime.length > 0 && metadataCost >= remaining) break;
    let end = Math.min(body.length, cursor.body + Math.max(0, remaining - metadataCost)); if (!boundary(body, end)) end--;
    const fragment = source.body === null ? null : body.slice(cursor.body, end);
    let metadataEnd = Math.min(metadata.length, cursor.metadata + Math.max(0, remaining - metadataCost - (fragment?.length ?? 0))); if (!boundary(metadata, metadataEnd)) metadataEnd--;
    const metadataFragment = metadataEnd > cursor.metadata ? { text: metadata.slice(cursor.metadata, metadataEnd), range: { start: cursor.metadata, end: metadataEnd, total: metadata.length } } : null;
    const nextRelation = cursor.relation + relations.length;
    const partial = end < body.length || nextRelation < source.relations.length || metadataEnd < metadata.length;
    const row = { ...source, ...small, body: fragment, range: source.body === null ? null : { start: cursor.body, end, total: body.length }, relations, ...(metadataFragment ? { metadataFragment } : {}),
      state: partial && source.state === 'available' ? 'partial' as const : source.state, gaps: [...source.gaps, ...(partial ? ['original-content-or-relations-continued'] : []), ...(metadata ? ['oversized-original-metadata-in-exact-json-fragments'] : [])] };
    (before !== null && (!source.recordedAt || !qualifiedRecordedTime(source.recordedAt.value)) ? unknownTime : visible).push(row);
    remaining -= (fragment?.length ?? 0) + metadataCost + (metadataFragment?.text.length ?? 0); count += Math.max(1, relations.length);
    if (partial) { cursor.body = end; cursor.relation = nextRelation; cursor.metadata = metadataEnd; break; }
    cursor.item++; cursor.body = 0; cursor.relation = 0; cursor.metadata = 0;
  }
  const continuation = cursor.item < rows.length ? encode(cursor) : null, page = [...visible, ...unknownTime];
  const state = continuation ? 'partial' : page.every(item => item.state === 'available') ? 'available' : page.every(item => item.state === page[0]?.state) ? page[0]!.state : 'partial';
  return { schemaVersion: 1, type: 'optracall.semantic-context-result', action: input.action, state, items: visible, unknownTime, indexRevision,
    coverage: { complete: continuation === null, continuation, gaps: unknownTime.length ? ['recorded-time-unknown-not-absence'] : [] } };
}

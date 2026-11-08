import type { SapMethodContent, SapMethodSaveInput, SapMethodSource, SapMethodRelation } from './types.ts';

export class SapMethodStoreError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.name = 'SapMethodStoreError'; this.code = code; this.status = status; }
}
export function fail(code: string, status = 400): never { throw new SapMethodStoreError(code, status); }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const shaPattern = /^[a-f0-9]{64}$/;
export const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const id = (value: unknown): string => typeof value === 'string' && uuidPattern.test(value) ? value.toLowerCase() : fail('METHOD_ID_INVALID');
export const positive = (value: unknown): number => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fail('METHOD_VERSION_INVALID');
const text = (value: unknown, limit: number, required = false): string => {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) fail('METHOD_INPUT_INVALID');
  return value;
};
export function saveInput(value: SapMethodSaveInput): SapMethodSaveInput {
  if (!object(value) || !['ir', 'other'].includes(value.origin) || !object(value.content) || !Array.isArray(value.sources)) fail('METHOD_INPUT_INVALID');
  const content: SapMethodContent = {
    conditions: text(value.content.conditions, 20_000), logic: text(value.content.logic, 40_000),
    judgment: text(value.content.judgment, 20_000), limits: text(value.content.limits, 20_000),
  };
  if (!Object.values(content).some(item => item.trim())) fail('METHOD_CONTENT_EMPTY');
  const sources: SapMethodSource[] = value.sources.map(source => {
    if (!object(source) || !['session', 'memory', 'report', 'method', 'manual'].includes(String(source.type))) fail('METHOD_SOURCE_INVALID');
    if (source.sha256 !== null && (typeof source.sha256 !== 'string' || !shaPattern.test(source.sha256))) fail('METHOD_SOURCE_INVALID');
    return { type: source.type, label: text(source.label, 500, true), ref: text(source.ref, 8_000, true), version: source.version === null ? null : text(source.version, 500, true), sha256: source.sha256 };
  });
  if (value.origin === 'ir' && !sources.some(source => source.type === 'session' && source.sha256 !== null)) fail('METHOD_SESSION_SOURCE_REQUIRED');
  let relation: SapMethodRelation | null = null;
  if (value.relation != null) {
    const supplied = value.relation;
    if (!object(supplied) || !['revision', 'derived', 'correction'].includes(supplied.kind) || !object(supplied.target)) fail('METHOD_RELATION_INVALID');
    relation = { kind: supplied.kind, target: { methodId: id(supplied.target.methodId), version: positive(supplied.target.version) }, reason: text(supplied.reason, 20_000, true).trim() };
  }
  return {
    requestId: id(value.requestId), ...(value.methodId === undefined ? {} : { methodId: id(value.methodId) }),
    ...(value.baseVersion === undefined ? {} : { baseVersion: positive(value.baseVersion) }),
    origin: value.origin, title: text(value.title, 300, true).trim(), content, sources, relation,
  };
}

import { parseExactCandidateRef } from './agent-candidate-controls.ts';
import type { PersonalContextFindInput, PersonalContextRange, PersonalContextReadInput, PersonalContextSelection, PersonalContextTarget } from './personal-context-types.ts';

export class PersonalContextError extends Error {
  readonly code: string;
  readonly status: number;
  readonly unavailableTargets?: { index: number; target: PersonalContextTarget; code: string }[];
  constructor(code: string, status = 400, unavailableTargets?: PersonalContextError['unavailableTargets']) { super(code); this.code = code; this.status = status; this.unavailableTargets = unavailableTargets; }
}
const fail = (code: string): never => { throw new PersonalContextError(code); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function fields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_personal_context_input');
}
const id = (value: unknown): string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value) ? value : fail('invalid_personal_context_target');
export function parsePersonalContextTarget(value: unknown): PersonalContextTarget {
  if (!object(value)) return fail('invalid_personal_context_target');
  if (value.type === 'agent-candidate') {
    fields(value, ['type', 'candidate']);
    return { type: 'agent-candidate', candidate: parseExactCandidateRef(value.candidate) };
  }
  fields(value, ['type', 'storeId', 'materialId', 'decisionId', 'revisionId', 'expectedBodySha256']);
  if (value.type !== 'retained' || typeof value.expectedBodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedBodySha256)) return fail('invalid_personal_context_target');
  return { type: 'retained', storeId: id(value.storeId), materialId: id(value.materialId), decisionId: id(value.decisionId), revisionId: id(value.revisionId), expectedBodySha256: value.expectedBodySha256 };
}
export function parsePersonalContextRange(value: unknown): PersonalContextRange {
  fields(value, ['start', 'end']);
  if (!Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) || Number(value.start) < 0 || Number(value.end) <= Number(value.start)) return fail('invalid_personal_context_range');
  return { start: Number(value.start), end: Number(value.end) };
}
const continuation = (value: unknown): string | null => value === undefined || value === null ? null : typeof value === 'string' && value.length > 0 && value.length <= 2000 && /^[A-Za-z0-9_-]+$/.test(value) ? value : fail('invalid_personal_context_continuation');
export function parsePersonalContextFindInput(value: unknown = {}): Required<PersonalContextFindInput> {
  fields(value, ['query', 'kind', 'includeArchived', 'pageSize', 'continuation']);
  const query = value.query ?? '', kind = value.kind ?? 'all', includeArchived = value.includeArchived ?? false, pageSize = value.pageSize ?? 20;
  if (typeof query !== 'string' || query.length > 200 || query.includes('\0') || !['all', 'knowledge', 'experience'].includes(String(kind)) || typeof includeArchived !== 'boolean' || !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 50) return fail('invalid_personal_context_find');
  return { query: query.trim(), kind: kind as Required<PersonalContextFindInput>['kind'], includeArchived, pageSize: Number(pageSize), continuation: continuation(value.continuation) };
}
export function parsePersonalContextReadInput(value: unknown): PersonalContextReadInput & { part: 'content' | 'corrections' | 'source'; continuation: string | null } {
  fields(value, ['target', 'part', 'sourceIndex', 'range', 'continuation']);
  const target = parsePersonalContextTarget(value.target), part = value.part ?? 'content';
  if (!['content', 'corrections', 'source'].includes(String(part)) || part === 'source' && (!Number.isSafeInteger(value.sourceIndex) || Number(value.sourceIndex) < 0) || part !== 'source' && value.sourceIndex !== undefined) return fail('invalid_personal_context_part');
  return { target, part: part as 'content' | 'corrections' | 'source', ...(value.sourceIndex === undefined ? {} : { sourceIndex: Number(value.sourceIndex) }), ...(value.range === undefined ? {} : { range: parsePersonalContextRange(value.range) }), continuation: continuation(value.continuation) };
}
export function parsePersonalContextSelections(value: unknown): PersonalContextSelection[] {
  if (!Array.isArray(value) || value.length > 8) return fail('invalid_personal_context_selections');
  return value.map(selected => { fields(selected, ['target', 'range']); return { target: parsePersonalContextTarget(selected.target), ...(selected.range === undefined ? {} : { range: parsePersonalContextRange(selected.range) }) }; });
}

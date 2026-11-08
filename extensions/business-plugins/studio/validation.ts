import { createHash } from 'node:crypto';
import type { StudioAuthority, StudioCheck, StudioSourceRef, StudioFeedbackOrigin } from './contracts.ts';

export class StudioError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
export function fail(code: string, status = 400): never { throw new StudioError(code, status); }
export function text(value: unknown, limit = 20_000, empty = true): string {
  if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > limit || Buffer.from(value).toString('utf8') !== value || (!empty && !value.trim())) fail('invalid_studio_text');
  return value as string;
}
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function identity(value: unknown): string { const result = text(value, 200, false); if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(result)) fail('invalid_studio_identity'); return result; }
export function uuid(value: unknown): string { const result = text(value, 36, false); if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result)) fail('invalid_studio_id'); return result; }
export function positive(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) fail('invalid_studio_revision'); return value as number; }
export function strings(value: unknown, maximum = 100): string[] { if (!Array.isArray(value) || value.length > maximum) fail('invalid_studio_list'); return (value as unknown[]).map(v => text(v)); }
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return fail('invalid_studio_value');
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const authorities: StudioAuthority[] = ['enterprise', 'rap', 'data', 'sap-metric', 'sap-method', 'studio-source', 'task', 'case'];
export function sourceRef(value: unknown): StudioSourceRef {
  if (!object(value) || !authorities.includes(value.authority as StudioAuthority)) fail('invalid_studio_source');
  const ref = value as Record<string, unknown>;
  if (Object.keys(ref).some(k => !['authority', 'id', 'version', 'title', 'sha256', 'projectId', 'taskId', 'locator'].includes(k))) fail('invalid_studio_source');
  const result: StudioSourceRef = { authority: ref.authority as StudioAuthority, id: text(ref.id, 1000, false), version: text(ref.version, 200, false) };
  if (ref.sha256 !== undefined) { if (typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) fail('invalid_studio_hash'); result.sha256 = ref.sha256 as string; }
  for (const key of ['title', 'projectId', 'taskId', 'locator'] as const) if (ref[key] !== undefined) result[key] = text(ref[key], 2000, false);
  return result;
}
export function sources(value: unknown): StudioSourceRef[] { if (!Array.isArray(value) || value.length > 200) fail('invalid_studio_sources'); return (value as unknown[]).map(sourceRef); }
export function checks(value: unknown): StudioCheck[] {
  if (!Array.isArray(value) || value.length > 100) fail('invalid_studio_checks');
  return (value as unknown[]).map(v => { if (!object(v) || !['pass', 'fail', 'unknown'].includes(v.status as string)) fail('invalid_studio_check'); return { name: text(v.name, 200, false), status: v.status as StudioCheck['status'], detail: text(v.detail) }; });
}

export function feedbackOrigin(value: unknown): StudioFeedbackOrigin {
  if (!object(value) || Object.keys(value).some(key => !['projectId', 'taskId', 'sessionId', 'messageId', 'useId', 'graphSnapshotId'].includes(key))) fail('invalid_studio_feedback_origin');
  const origin: StudioFeedbackOrigin = { projectId: identity(value.projectId), taskId: identity(value.taskId), sessionId: text(value.sessionId, 200, false), messageId: text(value.messageId, 200, false) };
  if (value.useId !== undefined) origin.useId = uuid(value.useId);
  if (value.graphSnapshotId !== undefined) origin.graphSnapshotId = identity(value.graphSnapshotId);
  return origin;
}

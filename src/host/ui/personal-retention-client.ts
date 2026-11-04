import type { EnterpriseMaterial, EnterpriseMaterialFields, EnterpriseSourceFile } from '../enterprise-materials-types.ts';
import type { PersonalContentTarget, PersonalDecision, PersonalItem, PersonalItemRead, PersonalPending, PersonalSourceEvidence, PersonalStateInput, PersonalTermination, PersonalWriteResult, RetainPersonalInput, SavePersonalDraftInput } from '../personal-retention-types.ts';
import type { PersonalLookupInput, PersonalLookupResult } from '../personal-retention-lookup.ts';
import type { LearningSourceRef } from '../learning-source-types.ts';
import type { CandidateRow } from '../agent-candidate-reader.ts';
import * as enterprise from './enterprise-materials-client.ts';

export type PersonalRetentionEntry = { ref: LearningSourceRef; kind?: 'knowledge' | 'experience'; direct?: boolean };
export const personalSourceNames: Record<LearningSourceRef['type'], string> = { enterprise: '资料修订', citation: '固定报告／附件', 'native-reply': '准确原生回复', feedback: '反馈修订', 'agent-candidate': '准确 Agent 候选', 'case-decision': '准确 Case 卡片修订', 'case-choice': '人的准确取舍' };
export const personalSourceStatusLabel = (source: Pick<PersonalSourceEvidence, 'status'>): string => ({ available: '可读取', disabled: '未启用／已停用，旧稿可读', excluded: '已排除 · 不再新供给', 'governance-unknown': '当前治理未核定 · UNKNOWN' })[source.status];
export type PersonalExperiencePrefill = { fields: EnterpriseMaterialFields; metadata: import('../personal-retention-types.ts').PersonalMetadata };
export function candidateExperiencePrefill(row: CandidateRow): PersonalExperiencePrefill {
  if (row.status !== 'available' || !row.ref || !row.details || row.control?.excluded) throw new Error('准确候选当前不可用或已排除；不从旧缓存整理新稿。');
  const content = row.details.content;
  return { fields: { ...enterprise.emptyEnterpriseFields(), title: content.title, body: content.bodyMd, scope: content.scope ?? '', category: '经验', source: '从准确 Agent 候选整理' }, metadata: { kind: 'experience', aliases: [...content.aliases], caution: content.caution, sourceRefs: addPersonalSourceRef(structuredClone(row.details.sourceRefs), { type: 'agent-candidate', candidate: structuredClone(row.ref) }) } };
}
/** JSON object property order is not identity; array order and every JSON value remain significant. */
export function personalJsonIdentity(value: unknown): string {
  const identity = JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, (entry as Record<string, unknown>)[key]])) : entry);
  if (identity === undefined) throw new Error('资料身份必须是可表示的 JSON 内容。');
  return identity;
}
export const personalJsonEqual = (left: unknown, right: unknown): boolean => personalJsonIdentity(left) === personalJsonIdentity(right);
export function addPersonalSourceRef(refs: LearningSourceRef[], ref: LearningSourceRef): LearningSourceRef[] {
  return refs.some(existing => personalJsonEqual(existing, ref)) ? refs : [...refs, ref];
}
export type PersonalOperationRead = { state: 'committed' | 'pending' | 'ended' | 'not-found'; item: PersonalItem | null; decision?: PersonalDecision; pending?: PersonalPending; termination?: PersonalTermination };
export type PersonalItemDetail = Omit<PersonalItemRead, 'item'> & { item: PersonalItem | null; materialState?: { materialId: string; enabled: boolean } | null };
export type PersonalEditorSnapshot = { storeId: string; material: EnterpriseMaterial; draftTarget: Extract<PersonalContentTarget, { type: 'draft' }> };
export class PersonalRetentionRequestError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status: number, message?: string) { super(message ?? (status === 409 ? '条目或准确内容已变化。输入和原操作保留，请核对后再决定。' : '个人资料请求未完成。已保存正文、历史与原操作保持，请核对后再决定。')); this.code = code; this.status = status; }
}
export function personalSourceFailureLabel(error: unknown): string {
  if (!(error instanceof PersonalRetentionRequestError)) return '来源未能核对';
  if (/missing|not_found/.test(error.code)) return '来源缺失';
  if (/changed|corrupt|hash_mismatch/.test(error.code)) return '内容不符／损坏';
  if (/mismatch/.test(error.code)) return '来源身份／归属不符';
  return '来源未能核对';
}
const path = (materialId: string) => `/api/personal-retention/items/${encodeURIComponent(materialId)}`;
export async function request<T>(route: string, method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(route, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  let result: unknown;
  try { result = await response.json(); } catch { throw new PersonalRetentionRequestError('response_unknown', response.status, '响应未能核定，结果为 UNKNOWN。保留原请求，先明确回查；不会自动重放。'); }
  if (!response.ok) { const value = result as { error?: string; code?: string; message?: string }; throw new PersonalRetentionRequestError(value.error ?? value.code ?? 'personal_retention_failed', response.status, typeof value.message === 'string' && value.message.length <= 1000 ? value.message : undefined); }
  return result as T;
}
export const personalRetentionApi = {
  lookup(input: PersonalLookupInput): Promise<PersonalLookupResult> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined) query.set(key, String(value));
    return request(`/api/personal-retention/lookup?${query}`);
  },
  item: (id: string, decisionId?: string) => request<PersonalItemDetail>(`${path(id)}${decisionId ? `?decisionId=${encodeURIComponent(decisionId)}` : ''}`),
  editor: (id: string) => request<PersonalEditorSnapshot>(`${path(id)}/editor`),
  source: (ref: LearningSourceRef) => request<PersonalSourceEvidence>('/api/personal-retention/sources/read', 'POST', { ref }),
  saveDraft: (id: string, input: SavePersonalDraftInput) => request<{ item: PersonalItem }>(`${path(id)}/draft`, 'POST', input),
  retain: (id: string, input: RetainPersonalInput) => request<PersonalWriteResult>(`${path(id)}/retain`, 'POST', input),
  operation: (id: string, operationId: string) => request<PersonalOperationRead>(`${path(id)}/operations/${encodeURIComponent(operationId)}`),
  endPending: (id: string, operationId: string, originalRequest?: RetainPersonalInput) => request<PersonalWriteResult>(`${path(id)}/end-pending`, 'POST', { operationId, ...(originalRequest ? { request: originalRequest } : {}) }),
  archive: (id: string, input: PersonalStateInput) => request<PersonalWriteResult>(`${path(id)}/archive`, 'POST', input),
  restore: (id: string, input: PersonalStateInput) => request<PersonalWriteResult>(`${path(id)}/restore`, 'POST', input),
  readMaterial: enterprise.readEnterpriseMaterial,
  readRevision: enterprise.readEnterpriseRevision,
  createMaterial: (fields: EnterpriseMaterialFields) => enterprise.createEnterpriseMaterial(fields),
  saveMaterial: enterprise.saveEnterpriseDraft,
  downloadFile: enterprise.downloadEnterpriseFile,
};
export type PersonalRetentionApi = typeof personalRetentionApi;
export const personalRetentionError = (error: unknown) => error instanceof Error ? error.message : '个人资料请求未能核定，输入与旧保留版本仍保留。';
export type PersonalMaterialView = Omit<PersonalItemDetail, 'materialState'> & { material: { id: string; enabled: boolean | null }; draft: EnterpriseMaterialFields | null; draftFiles: EnterpriseSourceFile[] };
/** Exact personal reading does not depend on unselected Enterprise bodies. Drafts are a separate, explicit read. */
export async function readPersonalMaterialView(api: Pick<PersonalRetentionApi, 'item' | 'editor'>, materialId: string, decisionId?: string, showDraft = false): Promise<PersonalMaterialView> {
  const read = await api.item(materialId, decisionId);
  const snapshot = showDraft ? await api.editor(materialId) : null;
  return { item: read.item, decision: showDraft ? null : read.decision, content: showDraft ? null : read.content, material: { id: materialId, enabled: snapshot?.material.enabled ?? read.materialState?.enabled ?? null }, draft: snapshot?.material.draft ?? null, draftFiles: snapshot?.material.files ?? [] };
}

type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const journalKey = 'optracall.personal-retention.pending.v1';
/** Records only pending request identities, not a parallel body or decision store. */
export function createPersonalOperationJournal(storage?: JournalStorage) {
  let memory: Record<string, RetainPersonalInput> = {};
  const invalid = (): never => { throw new Error('本页原保留请求记录不可读；请保留现场并回查原条目。'); };
  const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const readAll = (): Record<string, RetainPersonalInput> => {
    if (!storage) return memory;
    const raw = storage.getItem(journalKey);
    if (raw === null) return {};
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return invalid(); }
    if (!isObject(parsed)) return invalid();
    for (const value of Object.values(parsed)) {
      if (!isObject(value) || typeof value.operationId !== 'string' || !value.operationId || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 || !isObject(value.target) || !isObject(value.metadata) || value.personalLabel !== null && typeof value.personalLabel !== 'string') return invalid();
      const target = value.target, metadata = value.metadata;
      if (target.type === 'draft' ? !Number.isSafeInteger(target.expectedMaterialVersion) || typeof target.expectedDraftSha256 !== 'string' : target.type === 'revision' ? typeof target.revisionId !== 'string' || typeof target.expectedBodySha256 !== 'string' : true) return invalid();
      if (!['knowledge', 'experience'].includes(String(metadata.kind)) || !Array.isArray(metadata.aliases) || metadata.aliases.some(alias => typeof alias !== 'string') || metadata.caution !== null && typeof metadata.caution !== 'string' || !Array.isArray(metadata.sourceRefs) || metadata.sourceRefs.some(ref => !isObject(ref) || !['enterprise', 'citation', 'native-reply', 'feedback', 'agent-candidate', 'case-decision', 'case-choice'].includes(String(ref.type)))) return invalid();
    }
    return parsed as Record<string, RetainPersonalInput>;
  };
  const write = (value: Record<string, RetainPersonalInput>) => { if (storage) storage.setItem(journalKey, JSON.stringify(value)); else memory = value; };
  return {
    read(materialId: string): RetainPersonalInput | null { const value = readAll()[materialId]; return value ? structuredClone(value) : null; },
    entries(): [string, RetainPersonalInput][] { return Object.entries(structuredClone(readAll())); },
    remember(materialId: string, input: RetainPersonalInput) {
      const all = readAll(), old = all[materialId];
      if (old && old.operationId !== input.operationId) throw new Error('此条目有待核对的原操作，不能另换操作 ID。');
      if (old && !personalJsonEqual(old, input)) throw new Error('同一操作必须保留原请求，不能更改内容、分类或来源。');
      if (old) return;
      write({ ...all, [materialId]: structuredClone(input) });
    },
    settle(materialId: string, operationId: string) { const all = readAll(); if (all[materialId]?.operationId === operationId) { delete all[materialId]; write(all); } },
  };
}

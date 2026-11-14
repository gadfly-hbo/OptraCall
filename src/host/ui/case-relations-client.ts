import type { CaseRelationRevision as StoredCaseRelationRevision, CaseRelationSource } from '../case-relation-types.ts';
import type { CaseDecisionRef } from '../case-decision-types.ts';
import type { OperationReceipt } from '../case-types.ts';
import { CaseRequestError } from './case-client.ts';

export type CaseRelationRevision = StoredCaseRelationRevision & { restricted?: boolean };
export type { CaseRelationSource };
export type CaseRelationPage = { caseStoreId: string; items: CaseRelationRevision[]; continuation: string | null; hasMore: boolean; writingEnabled: boolean };
export type CaseRelationSourceOption = { ref: CaseRelationSource; title: string; status: 'available' | 'unknown'; kind: 'decision' | 'choice' | 'artifact' };
export type CaseRelationSourcesPage = { items: CaseRelationSourceOption[]; continuation: string | null; hasMore: boolean };
export type CaseRelationSourceView = { ref: CaseRelationSource | CaseDecisionRef; title: string; status: 'available' | 'unknown' | 'changed' | 'restricted'; text: string | null; limitations: string[]; currentRevision?: number };
export type CaseRelationExact = { revision: CaseRelationRevision; current: { revision: number; lifecycle: 'active' | 'unlinked' }; sources: CaseRelationSourceView[]; target: CaseRelationSourceView | null };
export type CaseRelationWrite = {
  operationId: string; caseStoreId: string; fromCaseId: string; kind: CaseRelationRevision['kind']; expectedRelationRevision: number;
  explanation: string; targetScope: string; targetRef?: CaseDecisionRef | null; sources?: CaseRelationSource[];
  assertionNature?: 'explicit' | 'inferred'; changeReason?: string | null; action?: 'save' | 'unlink' | 'restore';
};
const messages: Record<string, string> = {
  case_relation_revision_conflict: '关系已出现新修订。你的草稿仍保留，请先核对最新版本。',
  case_relations_disabled: '当前版本关闭关系写入；已有关系和历史仍可查阅。',
  case_enterprise_conflict: '两个 Case 的已知企业范围不同，未建立跨范围关系。',
  case_relation_restore_required: '这一关系曾被解除，请打开原关系并恢复同一记录。',
  case_relation_response_unknown: '关系保存结果尚未确认；原操作与草稿保留，请先核对原回执。',
  invalid_case_relation: '关系的方向、说明或准确来源未能核对，请检查后再保存。',
};
export class CaseRelationRequestError extends CaseRequestError {
  constructor(code: string, status: number, details?: Record<string, unknown>) { super(code, status, details); if (messages[code]) this.message = messages[code]; }
}
async function request<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/${path}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }); }
  catch { throw new CaseRelationRequestError('case_relation_response_unknown', 0); }
  let value: Record<string, unknown>;
  try { value = await response.json() as Record<string, unknown>; }
  catch { throw new CaseRelationRequestError('case_relation_response_unknown', 0); }
  if (!response.ok) throw new CaseRelationRequestError(typeof value.code === 'string' ? value.code : 'case_relation_failed', response.status, value.details as Record<string, unknown> | undefined);
  return value as T;
}
const casePath = (id: string) => `cases/${encodeURIComponent(id)}/relations`;
export function readCaseRelations(continuation?: string | null) {
  const query = new URLSearchParams({ includeUnlinked: 'true', pageSize: '100' });
  if (continuation) query.set('continuation', continuation);
  return request<CaseRelationPage>(`case-relations?${query}`);
}
export function readCaseRelationSources(caseId: string, continuation?: string | null) {
  const query = new URLSearchParams({ pageSize: '50' }); if (continuation) query.set('continuation', continuation);
  return request<CaseRelationSourcesPage>(`${casePath(caseId)}/sources?${query}`);
}
export function readCaseRelation(toCaseId: string, relationId: string, revision?: number) {
  return request<CaseRelationExact>(`${casePath(toCaseId)}/${encodeURIComponent(relationId)}${revision === undefined ? '' : `?revision=${revision}`}`);
}
export function readCaseRelationHistory(toCaseId: string, relationId: string, continuation?: string | null) {
  const query = new URLSearchParams({ pageSize: '50' }); if (continuation) query.set('continuation', continuation);
  return request<{ items: CaseRelationRevision[]; continuation: string | null; hasMore: boolean }>(`${casePath(toCaseId)}/${encodeURIComponent(relationId)}/history?${query}`);
}
export function saveCaseRelation(toCaseId: string, input: CaseRelationWrite, relationId?: string) {
  return request<{ revision: CaseRelationRevision }>(`${casePath(toCaseId)}${relationId ? `/${encodeURIComponent(relationId)}` : ''}`, 'POST', input);
}
export function readCaseRelationOperation(toCaseId: string, operationId: string) {
  return request<{ operation: OperationReceipt | null }>(`${casePath(toCaseId)}/operations/${encodeURIComponent(operationId)}`);
}

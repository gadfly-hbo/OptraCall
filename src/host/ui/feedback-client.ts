import type { CaseRecord } from '../case-types.ts';
import type { FeedbackCaseSelection, FeedbackHandoff, FeedbackHandoffResult, FeedbackMaterialSnapshot, FeedbackOperation, FeedbackPreview, FeedbackPreviewInput, FeedbackRequirementInput, FeedbackSource } from '../decision-feedback-types.ts';
import { HostRequestError } from './runtime-client.ts';

const messages: Record<string, string> = {
  feedback_source_changed: '来源已变化，请重新预览，当前问题和选材仍保留。',
  feedback_preview_expired: '预览已过期，请重新预览后确认。',
  feedback_operation_conflict: '同一操作的载荷已变化，请先查询原操作。',
  feedback_needs_review: '原操作部分结果待核对，请先查询原操作，不要重复创建。',
  feedback_operation_needs_review: '原操作部分结果待核对，请先查询原操作，不要重复创建。',
  project_archived: '项目已归档，请恢复后继续；当前输入仍保留。',
  case_closed: '所选 Case 已结束，请先在 Case 看板重开，或明确改选无 Case。',
  revision_conflict: 'Case 修订已变化，请重新读取并预览。',
  feedback_material_limit: '正文或材料数量超过传输限制，请明确减少选材或选择片段。',
};
export class FeedbackRequestError extends HostRequestError {
  constructor(code: string, readonly status: number, message: string) { super(message, {}, code); }
}
/** These guards run before an operation is persisted; they can safely return to preview. */
export const feedbackRejectedBeforeWrite = (error: unknown): boolean => error instanceof FeedbackRequestError && [
  'feedback_source_changed', 'feedback_source_preview_required', 'feedback_preview_expired', 'invalid_feedback_handoff', 'invalid_feedback_requirement', 'invalid_feedback_source', 'invalid_feedback_selection', 'invalid_feedback_range', 'feedback_material_limit', 'feedback_context_too_large', 'feedback_text_too_large', 'feedback_source_mismatch', 'feedback_owner_mismatch', 'project_archived', 'project_archiving', 'case_closed', 'revision_conflict', 'project_not_linked',
  'extraction_excerpt_unavailable', 'feedback_file_not_utf8', 'feedback_material_not_found', 'feedback_materials_too_large', 'feedback_revision_not_selected', 'invalid_feedback_case', 'invalid_feedback_file', 'invalid_feedback_material', 'invalid_feedback_nature', 'invalid_feedback_preview', 'invalid_feedback_task_name', 'invalid_feedback_text',
].includes(error.code);
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/decision-feedback/${path}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new FeedbackRequestError(result.code ?? 'feedback_request_failed', response.status, messages[result.code] ?? result.message ?? '反馈交接未完成。请保留输入并核对原操作。');
  return result as T;
}
export const feedbackSource = (boardTaskId: string, revisionId: string | null) => request<{ source: FeedbackSource; caseCandidates: CaseRecord[]; handoffs?: FeedbackHandoff[]; operations?: FeedbackOperation[] }>(`sources/${encodeURIComponent(boardTaskId)}${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`);
export const previewFeedback = (input: FeedbackPreviewInput) => request<{ preview: FeedbackPreview }>('preview', 'POST', input);
export const createFeedbackHandoff = (operationId: string, previewId: string) => request<FeedbackHandoffResult>('handoffs', 'POST', { operationId, previewId });
export const readFeedbackHandoff = (id: string) => request<{ handoff: FeedbackHandoff }>(`handoffs/${encodeURIComponent(id)}`);
export const readFeedbackOperation = (id: string) => request<{ operation: FeedbackOperation | null; observations?: unknown }>(`operations/${encodeURIComponent(id)}`);
export const continueFeedbackOperation = (id: string, requestHash: string) => request<{ operation: FeedbackOperation; handoff?: FeedbackHandoff; instanceId?: string; file?: { path: string; sha256: string; bytes: number } }>(`operations/${encodeURIComponent(id)}/continue`, 'POST', { requestHash });
export const saveFeedbackMaterials = (handoffId: string, operationId: string, selectedMaterialIds: string[], caseSelection: FeedbackCaseSelection | null) => request<{ operation: FeedbackOperation; file?: { path: string; sha256: string; bytes: number } }>(`handoffs/${encodeURIComponent(handoffId)}/files`, 'POST', { operationId, selectedMaterialIds, caseSelection });
export const requirementFromFeedback = (handoffId: string, input: FeedbackRequirementInput) => request<{ operation: FeedbackOperation; instanceId: string }>(`handoffs/${encodeURIComponent(handoffId)}/requirements`, 'POST', input);
export const feedbackRequirementSource = (instanceId: string) => request<{ operationId?: string; handoffId?: string; sourceSelection: unknown; sourceMaterial: FeedbackMaterialSnapshot | null }>(`requirements/${encodeURIComponent(instanceId)}/source`);
export const feedbackCaseJudgement = (handoffId: string, input: { operationId: string; expectedRevision: number; caseId: string; fields: Pick<CaseRecord, 'title' | 'description' | 'judgement' | 'nextStep'> }) => request<{ case: CaseRecord }>(`handoffs/${encodeURIComponent(handoffId)}/case-judgement`, 'POST', input);
export async function feedbackTextSha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function feedbackReportText(projectId: string, path: string): Promise<{ text: string; sha256: string }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(path)}`, { credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'x-optracall-client': '1' } });
  if (!response.ok) throw new HostRequestError('复盘报告暂未读取，请保留选择后重试。');
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
  return { text, sha256 };
}

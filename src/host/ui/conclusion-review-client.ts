import type { ConclusionHandoffCandidate, ConclusionHandoffSelection } from '../conclusion-board-handoff.ts';
import type { ReportConfirmationReceipt } from '../../../extensions/business-plugins/decision-board/types.ts';
import type { ConclusionReviewMetadata, ConclusionReviewRecord as StoredConclusionReviewRecord, ConclusionReviewSelection } from '../conclusion-review-contract.ts';
import type { ConclusionReviewReportCandidate } from '../conclusion-review-materials.ts';
import type { ClientTask } from './project-types.ts';

export type { ConclusionReviewSelection };
export type ConclusionReviewRecord = StoredConclusionReviewRecord & {
  reportChanged?: boolean; reportCurrentStatus?: 'same-path-unchanged' | 'same-path-updated' | 'unavailable';
  canCarry?: boolean; alreadyCarried?: boolean; sourceStatus?: 'unavailable';
};
export type ConclusionCandidates = {
  reports: ConclusionReviewReportCandidate[];
  preselected?: { relativePath: string; sha256: string };
  basisFiles: { relativePath: string; bytes?: number }[];
  limitations?: string[];
};
export type ConclusionPreview = {
  etag: string; selection: ConclusionReviewSelection;
  report: ConclusionReviewMetadata['report']; review: ConclusionReviewMetadata;
};
export type ConclusionTransition = { state: 'legacy' | 'waiting' | 'ready'; reason?: string; legacySettings?: unknown };
export class ConclusionReviewError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
const base = (project: string, task: string) => `/api/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}/conclusion-reviews`;
async function request<T>(project: string, task: string, route: string, method = 'GET', body?: unknown, signal?: AbortSignal, etag?: string): Promise<T> {
  const response = await fetch(base(project, task) + route, {
    method, mode: 'same-origin', credentials: 'omit', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-optracall-client': '1', ...(etag ? { 'if-match': etag } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  if (!response.ok) throw new ConclusionReviewError(value.code ?? 'conclusion_review_failed', response.status, value.message ?? '审查请求未完成，请只读刷新原记录。');
  return value as T;
}
function checked(review: ConclusionReviewRecord, project: string, task: string, id?: string) {
  if (!review || review.mode !== 'conclusion-review' || review.projectId !== project || review.taskId !== task || id && review.verificationId !== id)
    throw new ConclusionReviewError('conclusion_review_owner_mismatch', 409, '审查归属或编号未能核对，原任务与选择保留。');
  return review;
}
export const conclusionCandidates = (project: string, task: string, signal?: AbortSignal) => request<ConclusionCandidates>(project, task, '/candidates', 'GET', undefined, signal);
export const conclusionTransition = (project: string, task: string, signal?: AbortSignal) => request<ConclusionTransition>(project, task, '/transition', 'GET', undefined, signal);
export async function listConclusionReviews(project: string, task: string, signal?: AbortSignal) {
  return (await request<{ reviews: ConclusionReviewRecord[] }>(project, task, '', 'GET', undefined, signal)).reviews.map(review => checked(review, project, task));
}
export async function readConclusionReview(project: string, task: string, id: string, signal?: AbortSignal) {
  return checked((await request<{ review: ConclusionReviewRecord }>(project, task, '/' + encodeURIComponent(id), 'GET', undefined, signal)).review, project, task, id);
}
export async function previewConclusionReview(project: string, task: string, selection: ConclusionReviewSelection, signal?: AbortSignal) {
  return (await request<{ preview: ConclusionPreview }>(project, task, '/preview', 'POST', selection, signal)).preview;
}
export async function startConclusionReview(project: string, task: string, selection: ConclusionReviewSelection, etag: string) {
  const value = await request<{ review: ConclusionReviewRecord; created: boolean }>(project, task, '', 'POST', selection, undefined, etag);
  return checked(value.review, project, task, selection.verificationId);
}
export async function stopConclusionReview(project: string, task: string, id: string) {
  return checked((await request<{ review: ConclusionReviewRecord }>(project, task, '/' + encodeURIComponent(id) + '/stop', 'POST', {})).review, project, task, id);
}
export const readConclusionReport = (project: string, task: string, id: string, signal?: AbortSignal) =>
  request<{ relativePath: string; text: string; sha256: string; bytes: number; rangeUtf16: { start: number; end: number; total: number }; reviewId: string }>(project, task, '/' + encodeURIComponent(id) + '/report', 'GET', undefined, signal);
export const carryConclusionReview = (project: string, task: string, id: string) =>
  request<{ task: ClientTask; appended: boolean; reviewId: string }>(project, task, '/' + encodeURIComponent(id) + '/carry', 'POST', {});


export type BoardHandoffCandidate = ConclusionHandoffCandidate;
export type BoardHandoffInput = ConclusionHandoffSelection;
export type BoardHandoffReceipt = ReportConfirmationReceipt;
export type BoardHandoffOperation = { state: 'committed'; receipt: BoardHandoffReceipt } | { state: 'not-submitted' };
export async function readBoardHandoffCandidate(project: string, task: string, id: string, signal?: AbortSignal) {
  const { candidate } = await request<{ candidate: BoardHandoffCandidate }>(project, task, '/' + encodeURIComponent(id) + '/board-handoff', 'GET', undefined, signal);
  if (candidate.projectId !== project || candidate.taskId !== task || candidate.reviewId !== id)
    throw new ConclusionReviewError('board_handoff_owner_mismatch', 409, '确认候选归属未能核对，请只读刷新原审查。');
  return candidate;
}
function checkedReceipt(receipt: BoardHandoffReceipt, project: string, task: string, review: string, operation: string, expected?: BoardHandoffInput) {
  if (!receipt || receipt.operationId !== operation || receipt.projectId !== project || receipt.taskId !== task || receipt.reviewId !== review)
    throw new Error('确认回执归属未能核对，请查询原提交状态。');
  if (expected && (receipt.reportSha256 !== expected.reportSha256
    || JSON.stringify([...receipt.claimIds].sort()) !== JSON.stringify([...expected.claimIds].sort())
    || JSON.stringify([...receipt.recommendationClaimIds].sort()) !== JSON.stringify([...expected.recommendationIds].sort())))
    throw new Error('确认回执版本或选择未能核对，请查询原提交状态。');
  return receipt;
}
export async function confirmBoardHandoff(project: string, task: string, review: string, input: BoardHandoffInput) {
  const { receipt } = await request<{ receipt: BoardHandoffReceipt }>(project, task, '/' + encodeURIComponent(review) + '/board-handoff', 'POST', input);
  return checkedReceipt(receipt, project, task, review, input.operationId, input);
}
export async function readBoardHandoffOperation(project: string, task: string, review: string, operation: string, expected?: BoardHandoffInput) {
  const value = await request<BoardHandoffOperation>(project, task, '/' + encodeURIComponent(review) + '/board-handoff/' + encodeURIComponent(operation));
  if (value.state === 'committed') checkedReceipt(value.receipt, project, task, review, operation, expected);
  else if (value.state !== 'not-submitted') throw new Error('原确认提交状态仍未知，请继续只读查询。');
  return value;
}

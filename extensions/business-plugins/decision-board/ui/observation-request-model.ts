import type { BoardActionAuthorization, FeedbackRequestResponseRef } from '../types.ts';
import type { CaseDecisionRequestView } from '../../../../src/host/ui/workspace-daily-client.ts';
import type { FeedbackReviewStart } from '../../../../src/host/ui/FeedbackContextPanel.tsx';

export type ObservationRequestContext = NonNullable<FeedbackReviewStart['requestContext']>;
export type ObservationSubject = { projectId: string; itemId: string; taskId: string };
export type ObservationRequestSnapshot = { requests: CaseDecisionRequestView[]; authorization: BoardActionAuthorization | null; latestRevisionId: string | null };
export const observationRequestKey = (request: Pick<ObservationRequestContext, 'requestId' | 'revision'>) => `${request.requestId}:${request.revision}`;
export function observationRequestContext(request: CaseDecisionRequestView): ObservationRequestContext | null {
  return request.kind === 'observe' && request.target.kind === 'observe' ? { caseId: request.caseId, issueId: request.issueId, requestId: request.requestId, revision: request.revision, target: { ...request.target } } : null;
}
function sameContext(a: ObservationRequestContext, b: ObservationRequestContext) {
  return a.caseId === b.caseId && a.issueId === b.issueId && a.requestId === b.requestId && a.revision === b.revision
    && a.target.projectId === b.target.projectId && a.target.itemId === b.target.itemId && a.target.taskId === b.target.taskId
    && a.target.authorizationId === b.target.authorizationId && a.target.feedbackBaseRevisionId === b.target.feedbackBaseRevisionId;
}
/** An exact selected request is a claim to verify, never permission to substitute another revision. */
export function validateObservationRequest(selected: ObservationRequestContext, subject: ObservationSubject, expectedLatestRevisionId: string | null, snapshot: ObservationRequestSnapshot): { ref: FeedbackRequestResponseRef | null; problem: string | null } {
  const reject = (problem: string) => ({ ref: null, problem });
  const current = snapshot.requests.find(request => request.requestId === selected.requestId && request.revision === selected.revision);
  const context = current && observationRequestContext(current);
  if (!context || !sameContext(context, selected)) return reject('原请求或其准确修订已变化／不可读。请核对后明确选择，不会改用其他请求。');
  if (current!.status !== 'open' || current!.lifecycle !== 'open') return reject('原请求当前已回应、撤回、替代或待核，不能作为本次回应。');
  const target = context.target, auth = snapshot.authorization;
  if (target.projectId !== subject.projectId || target.itemId !== subject.itemId || target.taskId !== subject.taskId) return reject('请求的原项目、建议或行动与本表单不一致。');
  if (!auth || auth.decision !== 'authorize' || auth.authorizationId !== target.authorizationId
    || auth.projectId !== subject.projectId || auth.itemId !== subject.itemId || auth.taskId !== subject.taskId
    || 'kind' in auth.source || auth.source.caseId !== selected.caseId || auth.source.strategyRef.caseId !== selected.caseId
    || !auth.source.caseStoreId || auth.source.caseStoreId !== auth.source.strategyRef.caseStoreId
    || (auth.caseConfirmation && auth.caseConfirmation.issueId !== selected.issueId)) return reject('当前实际行动授权与原请求不一致，不能冒用其他轮次或授权回应。');
  if (target.feedbackBaseRevisionId !== expectedLatestRevisionId || snapshot.latestRevisionId !== expectedLatestRevisionId) return reject('原反馈修订基线已变化。本次输入保留；请核对原请求与最新反馈，不会以新基线冒充原回应。');
  return { ref: { requestId: selected.requestId, revision: selected.revision, authorizationId: target.authorizationId }, problem: null };
}
/** Keep all accurate choices; no first-match selection when multiple requests target one action. */
export function availableObservationRequests(subject: ObservationSubject, expectedLatestRevisionId: string | null, snapshot: ObservationRequestSnapshot) {
  return snapshot.requests.filter(request => {
    const selected = observationRequestContext(request);
    return selected !== null && validateObservationRequest(selected, subject, expectedLatestRevisionId, snapshot).ref !== null;
  });
}

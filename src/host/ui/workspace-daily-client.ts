import type { CaseIssueEdge, CaseDecisionRequest, CaseDecisionRequestStatus } from '../case-decision-types.ts';
import type { HomePendingProjection } from '../home-pending.ts';
import type { CaseDirectoryResult } from '../case-directory.ts';
import type { ThreeBranchCreateInput, ThreeBranchCreateResult } from '../case-creation-orchestrator.ts';
import type { CarryOverFragmentPayload, IssueDraftPayload, WorkspaceDraftKind, WorkspaceDraftRecord } from '../workspace-draft-store.ts';
import { CaseRequestError } from './case-client.ts';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'x-optracall-client': '1', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new CaseRequestError(String(body.code ?? body.error ?? 'request_failed'), response.status);
  return body as T;
}

export const readHomePending = () => request<HomePendingProjection>('/api/workspace/home-pending');
export const readCaseDirectory = (query?: string, limit = 20) => {
  const params = new URLSearchParams();
  if (query?.trim()) params.set('query', query.trim());
  params.set('limit', String(limit));
  return request<CaseDirectoryResult>(`/api/workspace/case-directory?${params.toString()}`);
};

export const readIssueEdges = (caseId: string, includeRemoved = false) =>
  request<{ edges: CaseIssueEdge[] }>(`/api/cases/${encodeURIComponent(caseId)}/decisions/issue-edges${includeRemoved ? '?includeRemoved=true' : ''}`);
export const saveIssueEdge = (caseId: string, input: Record<string, unknown>) =>
  request<{ edge: CaseIssueEdge }>(`/api/cases/${encodeURIComponent(caseId)}/decisions/issue-edges`, { method: 'POST', body: JSON.stringify(input) });

export type CaseDecisionRequestView = CaseDecisionRequest & { status: CaseDecisionRequestStatus };
export const readDecisionRequests = (caseId: string) =>
  request<{ requests: CaseDecisionRequestView[] }>(`/api/cases/${encodeURIComponent(caseId)}/decisions/requests`);
export const saveDecisionRequest = (caseId: string, input: Record<string, unknown>) =>
  request<{ request: CaseDecisionRequest }>(`/api/cases/${encodeURIComponent(caseId)}/decisions/requests`, { method: 'POST', body: JSON.stringify(input) });

export const listWorkspaceDrafts = <T = Record<string, unknown>>(kind: WorkspaceDraftKind) =>
  request<{ drafts: WorkspaceDraftRecord<T>[] }>(`/api/workspace/drafts/${encodeURIComponent(kind)}`);
export const readWorkspaceDraft = <T = Record<string, unknown>>(kind: WorkspaceDraftKind, id: string) =>
  request<{ draft: WorkspaceDraftRecord<T> }>(`/api/workspace/drafts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
export const saveWorkspaceDraft = <T extends Record<string, unknown>>(kind: WorkspaceDraftKind, id: string, expectedRevision: number, payload: T) =>
  request<{ draft: WorkspaceDraftRecord<T> }>(`/api/workspace/drafts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ expectedRevision, payload }),
  });
export const discardWorkspaceDraft = (kind: WorkspaceDraftKind, id: string) =>
  request<{ discarded: boolean }>(`/api/workspace/drafts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const appendCarryOverFragment = (input: { fragmentId: string; issueDraftId: string; caseId: string; issueId: string | null; expectedDraftRevision: number }) =>
  request<{ draft: WorkspaceDraftRecord<IssueDraftPayload>; fragment: WorkspaceDraftRecord<CarryOverFragmentPayload>; alreadyAppended: boolean }>('/api/workspace/drafts/append-fragment', {
    method: 'POST', body: JSON.stringify(input),
  });

export const createCaseThreeBranch = (input: ThreeBranchCreateInput) =>
  request<ThreeBranchCreateResult>('/api/workspace/create-case', { method: 'POST', body: JSON.stringify(input) });

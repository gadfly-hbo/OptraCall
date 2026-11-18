import type { CaseDecisionList, CaseDecisionListOptions, CaseDecisionRevision, CaseDecisionTarget, CaseDecisionGovernanceInput, CaseStrategyChoice, CaseStrategyChoiceInput } from '../case-decision-types.ts';
import type { CaseDecisionSourceView, CaseDecisionService } from '../case-decision-service.ts';
import { CaseRequestError } from './case-client.ts';

const messages: Record<string, string> = {
  case_decision_revision_conflict: '这条记录已更新，当前输入保留，请先查看变化。',
  project_result_permission_unavailable: '原 Plan 使用的资料当前无法读取。请核对原权限或改选有独立依据的方案。',
  role_source_model_unavailable: '原 Plan 使用的模型配置当前不可核对。请保留取舍输入并核对来源。',
  case_choice_conflict: '这项策略已有新选择，当前取舍与理由保留，请先核对。',
  case_decision_archived: '这条记录已归档，历史仍可读；只有人明确恢复后才能继续修改。',
  case_decisions_disabled: '当前版本未开放 Case 决策写入，已有记录保留。',
};
export class CaseDecisionRequestError extends CaseRequestError {
  constructor(code: string, status: number, details?: Record<string, unknown>) {
    super(code, status, details);
    if (messages[code]) this.message = messages[code];
  }
}
async function request<T>(route: string, method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/${route}`, {
    method, mode: 'same-origin', credentials: 'omit', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-optracall-client': '1' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const result = await response.json();
  if (!response.ok) throw new CaseDecisionRequestError(result.code ?? 'case_request_failed', response.status, result.details);
  return result as T;
}
const path = (caseId: string) => `cases/${encodeURIComponent(caseId)}/decisions`;
export function readCaseDecisions(caseId: string, options: CaseDecisionListOptions = {}) {
  const query = new URLSearchParams({ includeArchived: String(options.includeArchived ?? true), history: String(options.history ?? false), pageSize: String(options.pageSize ?? 50) });
  if (options.continuation) query.set('continuation', options.continuation);
  return request<CaseDecisionList>(`${path(caseId)}?${query}`);
}
export function saveCaseStrategyChoice(caseId: string, input: Omit<CaseStrategyChoiceInput, 'caseId'>) {
  return request<{ choice: CaseStrategyChoice }>(`${path(caseId)}/${encodeURIComponent(input.strategyRef.recordId)}/choice`, 'POST', input);
}
export type CaseDecisionExact = { revision: CaseDecisionRevision; current: { revision: number; lifecycle: 'active' | 'archived' } };
export function readCaseDecisionRevision(caseId: string, recordId: string, revision: number) {
  return request<CaseDecisionExact>(`${path(caseId)}/${encodeURIComponent(recordId)}/revisions/${revision}`);
}
export function readCaseDecisionSource(caseId: string, target: CaseDecisionTarget, continuation?: string | null) {
  return request<CaseDecisionSourceView>(`${path(caseId)}/source`, 'POST', { target, ...(continuation ? { continuation } : {}) });
}
export type CaseDecisionLinks = Awaited<ReturnType<CaseDecisionService['links']>>;
export function readCaseDecisionLinks(caseId: string) { return request<CaseDecisionLinks>(`${path(caseId)}/links`); }
export type GovernanceRequest = Omit<CaseDecisionGovernanceInput, 'caseId' | 'recordId'>;
export function saveCaseDecisionGovernance(caseId: string, recordId: string, input: GovernanceRequest) {
  return request<{ revision: CaseDecisionRevision }>(`${path(caseId)}/${encodeURIComponent(recordId)}/governance`, 'POST', input);
}

export const caseIssues = (id: string) => request<{ issues: import('../case-decision-types.ts').CaseDecisionIssue[] }>(path(id) + '/issues');
export const createCaseIssue = (id: string, input: { operationId: string; expectedRevision: number; title: string }) =>
  request<{ issue: import('../case-decision-types.ts').CaseDecisionIssue }>(path(id) + '/issues', 'POST', input);
export const caseIssueTimeline = (id: string, issue: string) =>
  request<Awaited<ReturnType<CaseDecisionService['issueTimeline']>>>(path(id) + '/issues/' + issue);
export const caseIssueSources = (id: string, issue: string) =>
  request<Awaited<ReturnType<CaseDecisionService['issueSources']>>>(path(id) + '/issues/' + issue + '/sources');
export const writeCaseIssue = (id: string, issue: string, action: 'plans' | 'review' | 'authorize', input: Record<string, unknown>) =>
  request(path(id) + '/issues/' + issue + '/' + action, 'POST', input);

export const inspectIssueReply = (id: string, issue: string, source: import('../case-decision-types.ts').CaseIssueReply) =>
  request<{title: string; text: string}>(path(id) + '/issues/' + issue + '/reply', 'POST', source);

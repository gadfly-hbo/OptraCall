import type { StrategicFormalGoal } from '../strategy-goal-decomposition-types.ts';
import type { GoalScope } from '../strategy-goals-types.ts';
import type { ProjectEvent, ProjectSnapshot } from '../../agent/project-runtime.ts';
import type { CandidateVersion, KickoffAnchor, KickoffReportVersion, ReplacedStrategyRequest, StrategySessionPendingRequest, StrategySessionRun, VerificationBatch } from '../strategy-initiative-types.ts';
import type { KickoffReportReadback, ScopedKickoffReportsView } from '../strategy-initiative-reports.ts';
export type { CandidateBlock, CandidateVersion, KickoffAnchor, KickoffFields, KickoffProposition, KickoffReportVersion, KickoffSourceRef, VerificationBatch, VerificationGate, VerificationSourceRef } from '../strategy-initiative-types.ts';
export type { KickoffReportReadback } from '../strategy-initiative-reports.ts';
export { initiativeScopeKey } from '../strategy-initiative-types.ts';

/** UI-side mirrors of the Host record shapes; the Host modules themselves stay server-only. */
export interface InitiativeRecord { id: string; title: string; revision: number; scopes: GoalScope[]; createdAt: string; updatedAt: string }
export interface InitiativeFile { fileId: string; operationId: string; name: string; directory: '010_draw' | '020_clean'; scopeKey?: string; size: number; sha256: string; uploadedAt: string }
export interface InitiativeMainSession {
  initiativeId: string; scopeKey: string; scope: GoalScope; configurationId: string; configurationRevision: number; sessionFile?: string;
  revision: number; createOperationId: string; pendingInput?: StrategySessionPendingRequest;
  lastRun?: StrategySessionRun; replacedRequests?: ReplacedStrategyRequest[]; createdAt: string; updatedAt: string;
}
export interface InitiativePublication {
  publicationId: string; initiativeId: string; scopeKey: string; candidateId: string; no: number; contentSha256: string; lockOperationId: string;
  batchId: string; gateRefs: [string, string]; operationId: string; state: 'active' | 'replaced' | 'withdrawn'; template: string; publishedAt: string;
  formalGoals?: StrategicFormalGoal[]; handoffEligible?: boolean;
  replacedAt?: string; replacedBy?: string; withdrawnAt?: string; withdrawOperationId?: string;
  handoffs: { operationId: string; scope: GoalScope; goals: { goalId: string; version: number }[]; at: string }[];
}
export type ReportsView = ScopedKickoffReportsView;
export function isReadableKickoffReport(version: KickoffReportReadback): version is KickoffReportVersion { return !('unavailable' in version); }
export interface InitiativeHistory {
  reports: ReportsView; candidates: CandidateVersion[]; verifications: VerificationBatch[]; publications: InitiativePublication[];
  legacy: { discussions: { id: string; title: string; updatedAt: string; note: string }[] };
}
export interface InitiativeSessionDetail { session: InitiativeMainSession; busy: boolean; live: boolean; reports: ReportsView; files: InitiativeFile[]; snapshot: ProjectSnapshot | null }
export interface CandidateDetail { candidate: CandidateVersion; busy: boolean; files: InitiativeFile[]; snapshot: ProjectSnapshot | null }
export interface InitiativeHandoffReceipt { operationId: string; scope: GoalScope; goals: { goalId: string; version: number }[]; at: string }

export class StrategyInitiativeRequestError extends Error {
  code: string; status: number; uncertain: boolean;
  constructor(code: string, status: number, uncertain = false, message?: string) {
    super(message || (status === 0
      ? (uncertain ? '无法连接到本地 OptraCall 服务，操作结果尚未核实（UNKNOWN），原输入与操作编号保留；请确认服务已启动后再只读核对原结果。' : '无法连接到本地 OptraCall 服务，请确认服务已启动后重试；原输入与记录保留。')
      : status === 404 ? '原记录不存在或尚未创建，请核对当前事项与范围。'
      : code.includes('conflict') || code.includes('changed') ? '所见版本或状态已变化，输入保持；请核对原记录后再操作。'
      : uncertain ? '操作结果尚未核实，原输入与编号保留，请先读取原结果。'
      : '战略事项操作未完成，原输入与记录保留。'));
    this.code = code; this.status = status; this.uncertain = uncertain;
  }
}
async function request<T>(suffix = '', method = 'GET', input?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response, value: Record<string, unknown>;
  try {
    response = await fetch(`/api/strategy/initiatives${suffix}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}), ...(signal ? { signal } : {}) });
    value = await response.json();
  } catch (fault) { if (signal?.aborted) throw fault; throw new StrategyInitiativeRequestError('strategy_initiative_response_unknown', 0, method !== 'GET'); }
  if (!response.ok) throw new StrategyInitiativeRequestError(typeof value.code === 'string' ? value.code : 'strategy_initiative_failed', response.status, method !== 'GET' && response.status >= 500, typeof value.message === 'string' ? value.message : undefined);
  return value as T;
}
const path = (id: string) => `/${encodeURIComponent(id)}`;
const scopeQuery = (scopeKey: string) => `?scopeKey=${encodeURIComponent(scopeKey)}`;
export const errorText = (fault: unknown) => fault instanceof Error ? fault.message : '战略事项操作未完成，原输入与记录保留。';

export const listInitiatives = (signal?: AbortSignal) => request<{ initiatives: InitiativeRecord[] }>('', 'GET', undefined, signal);
export const createInitiative = (input: { operationId: string; title: string; scopes: GoalScope[] }) => request<{ initiative: InitiativeRecord }>('', 'POST', input);
export const updateInitiative = (id: string, input: { expectedRevision: number; title?: string; scopes?: GoalScope[] }) => request<{ initiative: InitiativeRecord }>(path(id), 'PATCH', input);

export const listInitiativeFiles = (id: string, scopeKey: string) => request<{ files: InitiativeFile[] }>(`${path(id)}/files${scopeQuery(scopeKey)}`);
export const uploadInitiativeFile = (id: string, input: { operationId: string; directory: '010_draw' | '020_clean'; name: string; contentBase64: string; scopeKey?: string }) => request<{ file: InitiativeFile }>(`${path(id)}/files`, 'POST', input);
export const readInitiativeFile = (id: string, fileId: string, scopeKey?: string) => request<{ file: InitiativeFile; contentBase64: string }>(`${path(id)}/files/${encodeURIComponent(fileId)}${scopeKey ? `?scopeKey=${encodeURIComponent(scopeKey)}` : ''}`);

export const createInitiativeSession = (id: string, input: { operationId: string; scope: GoalScope; configurationId?: string }) => request<{ session: InitiativeMainSession }>(`${path(id)}/session`, 'POST', input);
export const readInitiativeSession = (id: string, scopeKey: string, signal?: AbortSignal) => request<InitiativeSessionDetail>(`${path(id)}/session${scopeQuery(scopeKey)}`, 'GET', undefined, signal);
export const sendInitiativeMessage = (id: string, scopeKey: string, input: { requestId: string; text: string; expectedRevision: number; replacePendingRequestId?: string }) => request<{ session: InitiativeMainSession; requestId: string; replayed?: boolean; receipt?: ReplacedStrategyRequest }>(`${path(id)}/messages${scopeQuery(scopeKey)}`, 'POST', input);
export const stopInitiativeSession = (id: string, scopeKey: string, expectedRequestId?: string) => request<{ stopped: boolean }>(`${path(id)}/stop${scopeQuery(scopeKey)}`, 'POST', { ...(expectedRequestId ? { expectedRequestId } : {}) });
export const closeInitiativeSession = (id: string, scopeKey: string) => request<{ closed: true }>(`${path(id)}/close${scopeQuery(scopeKey)}`, 'POST', {});
export async function watchInitiativeEvents(id: string, scopeKey: string, onEvent: (event: ProjectEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`/api/strategy/initiatives${path(id)}/events${scopeQuery(scopeKey)}`, { credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' }, signal });
  if (!response.ok || !response.body) throw new StrategyInitiativeRequestError('strategy_initiative_events_unavailable', response.status);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
  try { while (!signal.aborted) { const chunk = await reader.read(); if (chunk.done) break; pending += decoder.decode(chunk.value, { stream: true }); pending = pending.replace(/\r\n/g, '\n'); let boundary: number; while ((boundary = pending.indexOf('\n\n')) >= 0) { const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2); const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (data && !signal.aborted) onEvent(JSON.parse(data)); } } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export const readKickoffReports = (id: string, scopeKey: string) => request<ReportsView>(`${path(id)}/reports${scopeQuery(scopeKey)}`);
export const lockKickoffReport = (id: string, no: number, input: { operationId: string; sha256: string; operator?: string }, scopeKey: string) => request<{ version: KickoffReportVersion }>(`${path(id)}/reports/${no}/lock${scopeQuery(scopeKey)}`, 'POST', input);
export const applyKickoffReport = (id: string, no: number, input: { operationId: string; sha256: string; scope: GoalScope }) => request<{ anchor: KickoffAnchor }>(`${path(id)}/reports/${no}/apply`, 'POST', input);
export interface RevisePatchInput { blockId: string; expectedOldSha256: string; newText: string }
export const reviseKickoffReport = (id: string, no: number, input: { operationId: string; baseSha256: string; request: string; patches: RevisePatchInput[]; proposalId?: string }, scopeKey: string) => request<{ version: KickoffReportVersion }>(`${path(id)}/reports/${no}/revise${scopeQuery(scopeKey)}`, 'POST', input);

export const listCandidates = (id: string, scopeKey?: string) => request<{ candidates: CandidateVersion[] }>(`${path(id)}/candidates${scopeKey !== undefined ? scopeQuery(scopeKey) : ''}`);
export const createCandidate = (id: string, input: { operationId: string; scope: GoalScope; title: string; instruction: string; parent?: { candidateId: string; no: number }; configurationId?: string }) => request<{ candidate: CandidateVersion; requestId?: string; replayed?: boolean }>(`${path(id)}/candidates`, 'POST', input);
const candidatePath = (id: string, cid: string, no: number) => `${path(id)}/candidates/${encodeURIComponent(cid)}/versions/${no}`;
export const readCandidate = (id: string, cid: string, no: number) => request<CandidateDetail>(candidatePath(id, cid, no));
export const sendCandidateMessage = (id: string, cid: string, no: number, input: { requestId: string; text: string; expectedRevision: number; replacePendingRequestId?: string }) => request<{ candidate: CandidateVersion; requestId: string; replayed?: boolean; receipt?: ReplacedStrategyRequest }>(`${candidatePath(id, cid, no)}/messages`, 'POST', input);
export const stopCandidate = (id: string, cid: string, no: number, expectedRequestId?: string) => request<{ stopped: boolean }>(`${candidatePath(id, cid, no)}/stop`, 'POST', { ...(expectedRequestId ? { expectedRequestId } : {}) });
export const closeCandidate = (id: string, cid: string, no: number) => request<{ closed: true }>(`${candidatePath(id, cid, no)}/close`, 'POST', {});
export const lockCandidate = (id: string, cid: string, no: number, input: { operationId: string; sha256: string; operator?: string }) => request<{ candidate: CandidateVersion }>(`${candidatePath(id, cid, no)}/lock`, 'POST', input);
export const reviseCandidate = (id: string, cid: string, no: number, input: { operationId: string; baseSha256: string; request: string; patches: RevisePatchInput[]; proposalId?: string }) => request<{ candidate: CandidateVersion }>(`${candidatePath(id, cid, no)}/revise`, 'POST', input);
export const startVerification = (id: string, cid: string, no: number, input: { operationId: string }) => request<{ batch: VerificationBatch }>(`${candidatePath(id, cid, no)}/verify`, 'POST', input);
export const listVerifications = (id: string, cid: string, no: number) => request<{ batches: VerificationBatch[] }>(`${candidatePath(id, cid, no)}/verifications`);
export const retryVerificationGate = (id: string, cid: string, no: number, turn: 0 | 1, input: { operationId: string }) => request<{ batch: VerificationBatch }>(`${candidatePath(id, cid, no)}/gates/${turn}/retry`, 'POST', input);
export const stopVerification = (id: string, batchId: string) => request<{ stopped: boolean }>(`${path(id)}/verifications/${encodeURIComponent(batchId)}/stop`, 'POST', {});

export const listPublications = (id: string, scopeKey?: string) => request<{ publications: InitiativePublication[] }>(`${path(id)}/publications${scopeKey !== undefined ? scopeQuery(scopeKey) : ''}`);
export const publishInitiative = (id: string, input: { operationId: string; candidateId: string; no: number; sha256: string; batchId: string; template?: string; formalGoals?: StrategicFormalGoal[]; confirmed: true; expectedActive: string | null }) => request<{ publication: InitiativePublication }>(`${path(id)}/publications`, 'POST', input);
export const withdrawPublication = (id: string, publicationId: string, input: { operationId: string }) => request<{ publication: InitiativePublication }>(`${path(id)}/publications/${encodeURIComponent(publicationId)}/withdraw`, 'POST', input);
export const handoffPublication = (id: string, publicationId: string, input: { operationId: string; scope: GoalScope; selected: number[] }) => request<{ handoff: InitiativeHandoffReceipt }>(`${path(id)}/publications/${encodeURIComponent(publicationId)}/handoff`, 'POST', input);

export const readInitiativeHistory = (id: string, scopeKey: string) => request<InitiativeHistory>(`${path(id)}/history${scopeQuery(scopeKey)}`);

/** The Host checks patch old-value hashes over the exact UTF-8 bytes of the original string. */
export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export type { RevisionProposalFeedback } from '../strategy-initiative-types.ts';
export interface RevisionProposalView {
  proposalId: string;
  target: { kind: 'report'; no: number } | { kind: 'candidate'; candidateId: string; no: number };
  blockId: string;
  request: string;
  baselineSha256: string;
  newText?: string;
  status: 'pending' | 'proposed' | 'adopted' | 'ended' | 'failed';
  requestId?: string;
  feedback?: import('../strategy-initiative-types.ts').RevisionProposalFeedback;
  at: string;
  updatedAt: string;
}
export const proposeReportRevision = (id: string, no: number, scopeKey: string, input: { operationId: string; blockId: string; request: string }) => request<{ proposal: RevisionProposalView; requestId: string }>(`${path(id)}/reports/${no}/revise-proposal${scopeQuery(scopeKey)}`, 'POST', input);
export const proposeCandidateRevision = (id: string, cid: string, no: number, input: { operationId: string; blockId: string; request: string }) => request<{ proposal: RevisionProposalView; requestId: string }>(`${candidatePath(id, cid, no)}/revise-proposal`, 'POST', input);
export const readProposal = (id: string, proposalId: string, scopeKey?: string) => {
  const query = new URLSearchParams({proposalId});
  if (scopeKey !== undefined) query.set('scopeKey', scopeKey);
  return request<{ proposal: RevisionProposalView }>(`${path(id)}/proposals?${query}`);
};

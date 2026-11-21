import type { StrategyDiscussion, StrategyDiscussionCreate, StrategyDiscussionDetail, StrategyDiscussionMessage, StrategyDiscussionSource, StrategyDiscussionUpdate, StrategyDiscussionSourceDetail } from '../strategy-discussion-types.ts';
import type { GoalVersion, GoalDiscussionSourceRef } from '../strategy-goals-types.ts';
import type { ProjectEvent } from '../../agent/project-runtime.ts';
export type { StrategyDiscussion, StrategyDiscussionCreate, StrategyDiscussionDetail, StrategyDiscussionMessage, StrategyDiscussionSource, StrategyDiscussionUpdate } from '../strategy-discussion-types.ts';
export class StrategyDiscussionRequestError extends Error {
  code: string; status: number; uncertain: boolean;
  constructor(code: string, status: number, uncertain = false, message?: string) { super(message || (code.includes('conflict') ? '讨论或所见版本已变化，输入保持；请核对原记录。' : uncertain ? '操作结果尚未核实，原输入与编号保留，请先读取原结果。' : '战略讨论暂不可用，请保留当前输入后重新读取。')); this.code = code; this.status = status; this.uncertain = uncertain; }
}
async function request<T>(suffix = '', method = 'GET', input?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response, value: Record<string, unknown>;
  try { response = await fetch(`/api/strategy/discussions${suffix}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}), ...(signal ? { signal } : {}) }); value = await response.json(); }
  catch (fault) { if (signal?.aborted) throw fault; throw new StrategyDiscussionRequestError('strategy_discussion_response_unknown', 0, method !== 'GET'); }
  if (!response.ok) throw new StrategyDiscussionRequestError(typeof value.code === 'string' ? value.code : 'strategy_discussion_failed', response.status, method !== 'GET' && response.status >= 500, typeof value.message === 'string' ? value.message : undefined);
  return value as T;
}
const path = (id: string) => `/${encodeURIComponent(id)}`;
export const listStrategyDiscussions = (signal?: AbortSignal) => request<{ discussions: StrategyDiscussion[] }>('', 'GET', undefined, signal);
function owner(discussion: StrategyDiscussion, id: string, uncertain = false) { if (!discussion || discussion.id !== id) throw new StrategyDiscussionRequestError('strategy_discussion_identity_mismatch', 409, uncertain); }
export async function createStrategyDiscussion(input: StrategyDiscussionCreate) { const result = await request<{ discussion: StrategyDiscussion }>('', 'POST', input); owner(result.discussion, input.operationId, true); return result; }
export async function readStrategyDiscussion(id: string, signal?: AbortSignal) { const result = await request<StrategyDiscussionDetail>(path(id), 'GET', undefined, signal); owner(result.discussion, id); return result; }
export async function reloadDiscussionAfterGoalChange(id: string, onGoalsChanged: () => Promise<void>): Promise<StrategyDiscussionDetail> {
  await onGoalsChanged();
  return readStrategyDiscussion(id);
}
export function canSettleDiscussionMessage(detail: StrategyDiscussionDetail, input: StrategyDiscussionMessage): boolean {
  const receipt = detail.requestReceipt;
  return Boolean(receipt && receipt.requestId === input.requestId && receipt.originalUserText === input.text && typeof receipt.nativeEntryId === 'string' && receipt.nativeEntryId && typeof receipt.sessionId === 'string' && receipt.sessionId);
}
export function canPrepareDiscussionReplacement(detail: StrategyDiscussionDetail | undefined, input: StrategyDiscussionMessage): boolean {
  return Boolean(detail && !detail.busy && detail.discussion.lastRun?.id === input.requestId && ['failed', 'cancelled'].includes(detail.discussion.lastRun.status) && !canSettleDiscussionMessage(detail, input));
}
export async function updateStrategyDiscussion(id: string, input: StrategyDiscussionUpdate) { const result = await request<{ discussion: StrategyDiscussion }>(path(id), 'PATCH', input); owner(result.discussion, id, true); return result; }
export async function sendStrategyDiscussionMessage(id: string, input: StrategyDiscussionMessage) { const result = await request<{ discussion: StrategyDiscussion; requestId: string; replayed?: boolean }>(`${path(id)}/messages`, 'POST', input); owner(result.discussion, id, true); if (result.requestId !== input.requestId) throw new StrategyDiscussionRequestError('strategy_discussion_request_mismatch', 409, true); return result; }
export async function readStrategyDiscussionSource(source: GoalDiscussionSourceRef, offset = 0): Promise<StrategyDiscussionSourceDetail> {
  const query = new URLSearchParams({ sessionId: source.sessionId, entryId: String(source.version), sha256: source.sha256, entryType: source.entryType, offset: String(offset), limit: '8192' });
  const result = await request<StrategyDiscussionSourceDetail>(`${path(source.id)}/source?${query}`);
  if (!result.source || (['authority', 'id', 'version', 'sessionId', 'sha256', 'entryType'] as const).some(key => result.source[key] !== source[key]) || typeof result.body !== 'string' || typeof result.role !== 'string' || result.range?.start !== offset || !Number.isInteger(result.range.end) || result.range.end < offset || result.range.total < result.range.end || typeof result.complete !== 'boolean') throw new StrategyDiscussionRequestError('strategy_discussion_source_mismatch', 409, false, '原生来源身份或正文范围尚不能核对，未替换为其他消息。');
  return result;
}
export const readStrategyDiscussionSources = (id: string, projectId: string) => request<{ sources: StrategyDiscussionSource[] }>(`${path(id)}/sources?projectId=${encodeURIComponent(projectId)}`);
export const stopStrategyDiscussion = (id: string, expectedRequestId?: string) => request<{ stopped: boolean }>(`${path(id)}/stop`, 'POST', { ...(expectedRequestId ? { expectedRequestId } : {}) });
export const closeStrategyDiscussion = (id: string) => request<{ closed: true }>(`${path(id)}/close`, 'POST', {});
export const discussionAdoptionKey = (id:string, ref:Pick<GoalVersion,'goalId'|'version'>) =>
  `optracall.discussion-goal-adoption.v1:${id}:${ref.goalId}:${ref.version}`;
export function hasPendingDiscussionAdoption(id:string, ref:GoalVersion) {
  try { return Boolean(sessionStorage.getItem(discussionAdoptionKey(id,ref))); } catch { return false; }
}
export interface DiscussionAdoptionInput { operationId: string; goalId: string; version: number; expectedVersion: number; expectedAdoptedVersion?: number | null; goalContentSha256: string; decision: string }
export async function adoptDiscussionGoal(id: string, input: DiscussionAdoptionInput) { const result = await request<{ goal: GoalVersion }>(`${path(id)}/adopt`, 'POST', input); if (result.goal?.goalId !== input.goalId || result.goal?.version !== input.version || result.goal?.status !== 'adopted') throw new StrategyDiscussionRequestError('strategy_discussion_goal_mismatch', 409, true); return result; }
export async function watchStrategyDiscussion(id: string, onEvent: (event: ProjectEvent) => void, signal: AbortSignal, endpoint = `/api/strategy/discussions${path(id)}/events`): Promise<void> {
  const response = await fetch(endpoint, { credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' }, signal });
  if (!response.ok || !response.body) throw new StrategyDiscussionRequestError('strategy_discussion_events_unavailable', response.status);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
  try { while (!signal.aborted) { const chunk = await reader.read(); if (chunk.done) break; pending += decoder.decode(chunk.value, { stream: true }); pending = pending.replace(/\r\n/g, '\n'); let boundary: number; while ((boundary = pending.indexOf('\n\n')) >= 0) { const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2); const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (data && !signal.aborted) onEvent(JSON.parse(data)); } } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export type DiscussionPending = { kind: 'create'; input: StrategyDiscussionCreate } | { kind: 'message'; discussionId: string; input: StrategyDiscussionMessage } | { kind: 'update'; discussionId: string; input: StrategyDiscussionUpdate };
const journalKey = 'optracall.strategy-discussions.pending.v1';
export function discussionJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const read = (): DiscussionPending | undefined => { const raw = storage.getItem(journalKey); if (!raw) return; const value = JSON.parse(raw); if (!value?.input || !['create', 'message', 'update'].includes(value.kind) || typeof (value.kind === 'create' ? value.input.operationId : value.kind === 'message' ? value.input.requestId : value.discussionId) !== 'string') throw new Error('原讨论请求暂存不可核对，原记录保留，未创建另一讨论。'); return value; };
  return { read, remember(value: DiscussionPending) { const old = read(); if (old && JSON.stringify(old) !== JSON.stringify(value)) throw new Error('原讨论请求结果待核，输入保持，未覆盖原操作。'); storage.setItem(journalKey, JSON.stringify(value)); }, settle(value: DiscussionPending) { if (JSON.stringify(read()) === JSON.stringify(value)) storage.removeItem(journalKey); } };
}

export const strategyVersionRequest = <T,>(id:string,suffix='',method='GET',input?:unknown) =>
  request<T>(path(id)+'/versions'+suffix,method,input);

export const strategyWorkbenchRequest = <T,>(id:string,suffix:string,method='GET',input?:unknown,signal?:AbortSignal) =>
  request<T>(path(id)+suffix,method,input,signal);

export const saveStrategyMap = (id:string,input:unknown) => request<{version:import('../strategy-map-types.ts').StrategyMapVersion}>(path(id)+'/maps','POST',input);

export const dismissStrategyMapImportDraft = (id:string,entryId:string) =>
  request<{dismissed:true;entryId:string;draftGroupId:string}>(`${path(id)}/map-drafts/${encodeURIComponent(entryId)}/dismiss`,'POST',{});

export const strategyAttachmentRequest=<T,>(id:string,action='',method='GET',input?:unknown)=>request<T>(path(id)+'/attachments'+action,method,input);

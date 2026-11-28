import type { ExternalWork, WorkGrant, PublicationAttempt, ExternalTaskSummary, InternalChoice, ExternalAssetRef } from '../external-work-types.ts';
import type { ExternalStopRequestRecord, ResumePauseRecord } from '../external-work-store.ts';

/** S6a browser client for the owner-bound external dispatch routes (same pattern as service-connections-client). */

export type ExternalDispatchGrantInput = {
  goal: string;
  scope: string;
  forbidden: string;
  allowedExecutors: string[];
  repository: { stableId: string; visibility: 'private' | 'public' };
  assetRefs: ExternalAssetRef[];
  enterprise: string;
  validUntil: string;
  summary: string;
  deliveryCriteria: string;
  targetExecutor?: string;
  inputs?: ExternalAssetRef[];
  autoResumeAllowed?: boolean;
  sourceCaseRef?: { caseId: string; issueId: string };
};
export type ExternalDispatchView = { summary: ExternalTaskSummary; pause: ResumePauseRecord | null };
export type ExternalAuthorizeResult = { grant: WorkGrant; work: ExternalWork };
export type ExternalCancelResult = { work: ExternalWork; stopRequest: ExternalStopRequestRecord };
export type ExternalPublishResult = { attempt: PublicationAttempt; dispatched: boolean };
export type ExternalDispatchSettings = {
  core: {
    github: { status: string; verified: boolean; accountLabel?: string };
    protectedMcp: { available: boolean; reason?: string };
    executorClosedLoop: { verified: boolean; reason?: string };
  };
  optional: { optional: true; defaultState: 'integration_unverified'; connection: string; ready: boolean; verification: { apiOnline: string; connector: string; joint: string }; quota: { limit: number } };
};

const errorMessages: Record<string, string> = {
  external_profile_forbidden: '当前任务或项目不能使用外派；内部工作沿原权限继续。',
  external_enterprise_required: '外派授权需要明确的企业范围；不回退默认。',
  external_grant_invalid: '外派授权输入不完整或有越界字段；请核对外派范围后重试。',
  external_grant_expired: '授权期限必须明确晚于当前时间。',
  external_grant_rate_limited: '已达当前授权策略的频次上限；先核对原工作或明确调整策略。',
  external_policy_exceeds_default: '资源策略不能超过默认上限；需要更高额度时另行确认。',
  external_policy_rate_limited: '当前窗口内外派次数已达上限；请先核对原工作。',
  external_asset_not_qualified: '所选资产不在原 Studio/语义目录当前资格内；请缩小或更换资产范围。',
  external_work_active: '已有进行中的外派工作；请先在原工作内取消或核对，再切换完成方式。',
  external_work_not_found: '外派工作不存在或不属于当前任务。',
  external_publisher_unconfigured: '发布通道尚未装配；本轮未产生任何出站动作。',
  external_publish_binding_missing: '本任务还没有已核验的 GitHub 协作绑定；请先在右栏任务账号连接开启。',
  external_workbuddy_unconfigured: 'WorkBuddy 适配未装配；纯 GitHub 路径不受影响。',
  external_workbuddy_not_ready: 'WorkBuddy 联合验证未通过，保持禁用。',
  external_dispatch_owner_mismatch: '返回的外派台账属于其他任务或项目；已拒绝显示。请刷新核对归属。',
};
export class ExternalDispatchRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(errorMessages[code] ?? (status === 409 ? '外派或任务正在使用中，或状态已变化。请刷新核对原记录。' : status === 403 ? '当前任务或账号未获得所需授权，请核对外派范围与连接。' : status === 404 ? '外派工作或任务不存在，请刷新核对。' : '外派操作未完成，原任务与输入保留，请核对原记录后重试。'));
    this.name = 'ExternalDispatchRequestError';
    this.code = code; this.status = status;
  }
}
export class ExternalDispatchUncertain extends Error {
  constructor() { super('本次外派操作的结果尚未确认。请先刷新台账状态；不会自动重复提交。'); this.name = 'ExternalDispatchUncertain'; }
}
export const externalDispatchErrorText = (error: unknown) => error instanceof ExternalDispatchRequestError || error instanceof ExternalDispatchUncertain ? error.message : '暂时无法读取外派台账，请检查本机服务后重试。';

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
  } catch (error) {
    if (signal?.aborted || method === 'GET') throw error;
    throw new ExternalDispatchUncertain();
  }
  let value: unknown;
  try { value = await response.json(); } catch { if (method !== 'GET' && response.status >= 500) throw new ExternalDispatchUncertain(); throw new ExternalDispatchRequestError('external_dispatch_response_invalid', response.status); }
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : 'external_dispatch_request_failed';
    throw new ExternalDispatchRequestError(code, response.status);
  }
  return value as T;
}

const owner = (path: string) => `${path}/external-dispatch`;

function assertOwner(summary: ExternalTaskSummary, projectId: string, taskId: string): ExternalTaskSummary {
  if (!summary || summary.projectId !== projectId || summary.taskId !== taskId || !Array.isArray(summary.works)) throw new ExternalDispatchRequestError('external_dispatch_owner_mismatch', 409);
  return summary;
}

export async function readTaskExternalDispatch(projectId: string, taskId: string, signal?: AbortSignal): Promise<ExternalDispatchView> {
  const value = await request<{ summary: ExternalTaskSummary; pause: ResumePauseRecord | null }>(owner(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`), 'GET', undefined, signal);
  return { summary: assertOwner(value.summary, projectId, taskId), pause: value.pause ?? null };
}
export async function authorizeExternalWork(projectId: string, taskId: string, grant: ExternalDispatchGrantInput): Promise<ExternalAuthorizeResult> {
  const value = await request<ExternalAuthorizeResult>(`${owner(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)}/authorize`, 'POST', grant);
  if (!value?.grant?.grantId || !value?.work?.workId) throw new ExternalDispatchRequestError('external_dispatch_response_invalid', 409);
  return value;
}
export async function chooseInternalCompletion(projectId: string, taskId: string): Promise<{ choice: InternalChoice }> {
  return request(`${owner(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)}/choose-internal`, 'POST', {});
}
export async function cancelExternalWork(projectId: string, taskId: string, workId: string, reason: string): Promise<ExternalCancelResult> {
  const value = await request<ExternalCancelResult>(`${owner(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)}/works/${encodeURIComponent(workId)}/cancel`, 'POST', { reason });
  if (!value?.work || value.work.workId !== workId || !value?.stopRequest?.stopRequestId) throw new ExternalDispatchRequestError('external_dispatch_owner_mismatch', 409);
  return value;
}
export async function pauseExternalResume(projectId: string, taskId: string, reason: string): Promise<{ pause: ResumePauseRecord }> {
  return request(`${owner(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)}/pause-resume`, 'POST', { reason });
}
export async function resumeExternalResume(projectId: string, taskId: string): Promise<{ pause: null; resumed?: ResumePauseRecord }> {
  return request(`${owner(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)}/resume-resume`, 'POST', {});
}
export async function publishExternalWork(projectId: string, taskId: string, workId: string, input: { revision: number; action: 'issue-create' | 'issue-comment'; body: string }): Promise<ExternalPublishResult> {
  return request(`${owner(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)}/works/${encodeURIComponent(workId)}/publish`, 'POST', input);
}
export async function readExternalDispatchSettings(signal?: AbortSignal): Promise<ExternalDispatchSettings> {
  return request('/api/external-dispatch/settings', 'GET', undefined, signal);
}

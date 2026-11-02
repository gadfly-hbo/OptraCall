import type { DraftRecord, RunRecord, SnapshotRecord, StressRow, SimPerturbation } from '../types.ts';

export type { DraftRecord, RunRecord, SnapshotRecord, StressRow, SimPerturbation };
export type { SimParameters, SimVariant } from '../types.ts';

export class SimLabRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message?: string) {
    super(message ?? `推演请求未完成（${code}），请检查输入或本地服务后重试。`);
  }
}

async function request<T>(route: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/simlab/${route}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const value = result as { code?: string; message?: string };
    throw new SimLabRequestError(value.code ?? 'simlab_request_failed', response.status, value.message);
  }
  return result as T;
}

export const listDrafts = (projectId: string) => request<{ drafts: DraftRecord[] }>(`projects/${projectId}/drafts`);
export const createDraft = (projectId: string, input: { name: string }) => request<{ draft: DraftRecord }>(`projects/${projectId}/drafts`, 'POST', input);
export const getDraft = (projectId: string, draftId: string) => request<{ draft: DraftRecord }>(`projects/${projectId}/drafts/${draftId}`);
export const updateDraft = (projectId: string, draftId: string, input: Record<string, unknown>) => request<{ draft: DraftRecord }>(`projects/${projectId}/drafts/${draftId}`, 'PATCH', input);
export const runDraft = (projectId: string, draftId: string) => request<{ run: RunRecord }>(`projects/${projectId}/drafts/${draftId}/runs`, 'POST', {});
export const listRuns = (projectId: string, draftId: string) => request<{ runs: RunRecord[] }>(`projects/${projectId}/drafts/${draftId}/runs`);
export const stressDraft = (projectId: string, draftId: string, input: { perturbation: SimPerturbation; variantIds?: string[] }) => request<{ rows: StressRow[] }>(`projects/${projectId}/drafts/${draftId}/stress`, 'POST', input);
export const listSnapshots = (projectId: string) => request<{ snapshots: SnapshotRecord[] }>(`projects/${projectId}/snapshots`);
export const freezeSnapshot = (projectId: string, draftId: string, input: { runId: string; variantId: string; expectedRevision: number; name?: string }) => request<{ snapshot: SnapshotRecord }>(`projects/${projectId}/drafts/${draftId}/freeze`, 'POST', input);

import type { UsageContext, UsageContextSettings, UsageContextUpdate, UsageContextOperation } from '../usage-context-types.ts';
export class UsageContextRequestError extends Error {
  code: string; status: number; uncertain: boolean;
  constructor(code: string, status: number, uncertain = false) { super(code.includes('conflict') ? '用途设置已有变化，原选择保留；请重新读取后核对。' : uncertain ? '保存结果尚未核实，原选择与操作编号保留；请先核对原结果。' : '用途设置暂不可读取，请保留选择后重试。'); this.code = code; this.status = status; this.uncertain = uncertain; }
}
async function request<T>(suffix = '', method = 'GET', input?: UsageContextUpdate): Promise<T> {
  let response: Response, value: Record<string, unknown>;
  try {
    response = await fetch(`/api/settings/usage-context${suffix}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input ? { body: JSON.stringify(input) } : {}) });
    value = await response.json();
  } catch { throw new UsageContextRequestError('usage_context_response_unknown', 0, method !== 'GET'); }
  if (!response.ok) throw new UsageContextRequestError(typeof value.code === 'string' ? value.code : 'usage_context_request_failed', response.status, method !== 'GET' && response.status >= 500);
  return value as T;
}
export const readUsageContextSettings = () => request<UsageContextSettings>();
export const saveUsageContextSettings = (input: UsageContextUpdate) => request<{ settings: UsageContextSettings; replayed: boolean; operationRevision: number }>('', 'PUT', input);
export const readUsageContextOperation = (operationId: string) => request<{ operation: UsageContextOperation | null }>(`/operations/${encodeURIComponent(operationId)}`);
export type { UsageContext, UsageContextSettings, UsageContextUpdate } from '../usage-context-types.ts';
const pendingKey = 'optracall.usage-context.pending.v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const sameUsageContext = (first: UsageContext | null, second: UsageContext | null) => first === null || second === null ? first === second : first.kind === second.kind && first.background === second.background;
export function usageContextJournal(storage: Storage) {
  const read = (): UsageContextUpdate | undefined => {
    const raw = storage.getItem(pendingKey); if (!raw) return;
    const value = JSON.parse(raw);
    if (!value || !/^[a-f0-9-]{36}$/.test(value.operationId) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || value.context !== null && (!value.context || !['organization', 'department', 'personal'].includes(value.context.kind) || typeof value.context.background !== 'string' || value.context.background.length > 4000)) throw new Error('原用途设置操作不可核对，已保留；未覆盖输入。');
    return value;
  };
  return { read, remember(input: UsageContextUpdate) { const old = read(); if (old && (old.operationId !== input.operationId || old.expectedRevision !== input.expectedRevision || !sameUsageContext(old.context, input.context))) throw new Error('原用途设置仍待核对，请先处理原操作。'); storage.setItem(pendingKey, JSON.stringify(input)); }, settle(operationId: string) { if (read()?.operationId === operationId) storage.removeItem(pendingKey); } };
}

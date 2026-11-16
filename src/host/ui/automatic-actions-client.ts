import type { AutomaticActionSettings, AutomaticActionSettingsResult, AutomaticActionSettingsUpdate } from '../automatic-action-settings-types.ts';
export class AutomaticActionRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(status === 409 ? '设置已在其他入口更新，请重新读取后核对。' : '设置结果未确认，请先读取原结果，保留本次选择。'); }
}
async function request<T>(input?: AutomaticActionSettingsUpdate, suffix = ''): Promise<T> {
  const response = await fetch('/api/automatic-actions/settings' + suffix, { method: input ? 'POST' : 'GET', credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new AutomaticActionRequestError(value.code || 'automatic_action_settings_unavailable', response.status);
  return value;
}
export const readAutomaticActions = () => request<AutomaticActionSettings>();
export const updateAutomaticActions = (input: AutomaticActionSettingsUpdate) => request<AutomaticActionSettingsResult>(input);

export const readAutomaticActionOperation = (id: string) => request<{ operation: { operationId: string; fingerprint: string; revision: number } | null }>(undefined, '/operations/' + encodeURIComponent(id));

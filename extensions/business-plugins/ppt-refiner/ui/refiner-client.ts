import type { DeckMeta, VersionEntry } from '../types.ts';

const messages: Record<string, string> = {
  invalid_deck_id: 'deck 标识不合法。',
  deck_not_found: '精修 deck 不存在，请刷新列表。',
  page_locked: '该页已锁定，解锁后才能修改。',
  render_failed: '页图渲染失败，请检查 LibreOffice 与 python 环境。',
  render_unavailable: '页图渲染未配置，请联系 Host 接入方配置 skill 脚本目录。',
  version_not_found: '版本不存在，请刷新版本历史。',
  invalid_input: '输入为空或超长。',
  image_not_found: '页图不存在，请先渲染。',
  session_busy: '精修仍在运行，请停止或等待完成后操作。',
  project_archived: '项目已归档，恢复后才能继续精修。',
  deck_project_unavailable: '来源项目暂不能确认，此 deck 保留只读。',
  export_exists: '同名终版或差异清单已存在，请修改文件名后再导出。',
  export_conflict: '导出文件已存在，请更换终版名称；已有文件未覆盖。',
};

export type RefinerSource = { projectId: string; sourcePptx: string; reportPath: string; title: string };
export type DeckSummary = { meta: DeckMeta; projectId?: string; projectName?: string; readOnly?: boolean; reason?: string; imageInputSupported?: boolean };
export type DeckView = DeckSummary & { versions: VersionEntry[]; deckPath: string; busy?: boolean; protectionFailed?: boolean };
export type TurnResult = { reply: string; outcome?: 'completed' | 'cancelled' | 'failed'; snapshot: VersionEntry | null; elapsedMs: number; violations?: { page: number; restored: boolean }[] };

export class RefinerRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly turn?: TurnResult;
  constructor(code: string, status: number, turn?: TurnResult, message?: string) {
    super((message === code || message === code.toUpperCase() ? undefined : message) ?? messages[code] ?? '精修请求未完成，请检查本地服务后重试。');
    this.code = code; this.status = status; this.turn = turn;
  }
}

async function request<T>(route: string, method: 'GET' | 'POST' = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/ppt-refiner${route}`, {
    method, credentials: 'omit', mode: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-optracall-client': '1' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const result = await response.json().catch(error => { if (response.ok) throw error; return {}; });
  if (!response.ok) {
    const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const turn = typeof value.reply === 'string' && ['completed', 'cancelled', 'failed'].includes(String(value.outcome)) ? result as TurnResult : undefined;
    throw new RefinerRequestError(String(value.code ?? 'refiner_request_failed'), response.status, turn, typeof value.message === 'string' ? value.message : undefined);
  }
  return result as T;
}

export const listDecks = () => request<{ decks: DeckSummary[] }>('/decks');
export const createDeck = (input: RefinerSource & { id?: string }) => request<{ meta: DeckMeta; deckPath: string }>('/decks', 'POST', input);
export const readDeck = (deckId: string) => request<DeckView>(`/decks/${encodeURIComponent(deckId)}`);
export const setPageLock = (deckId: string, page: number, locked: boolean) => request<{ meta: DeckMeta }>(`/decks/${encodeURIComponent(deckId)}/locks`, 'POST', { page, locked });
export const revertDeck = (deckId: string, version: number) => request<{ reverted: number; versions: VersionEntry[] }>(`/decks/${encodeURIComponent(deckId)}/revert`, 'POST', { version });
export const exportDeck = (deckId: string, input: { fileName?: string } = {}) => request<{ pptx: string; diff: string; versionCount: number; diffHistoryKnown?: boolean }>(`/decks/${encodeURIComponent(deckId)}/export`, 'POST', input);
export const runTurn = (deckId: string, text: string, requestId: string, page?: number, mode: 'edit' | 'inspect' = 'edit', visual = false) => request<TurnResult>(`/decks/${encodeURIComponent(deckId)}/turns`, 'POST', { text, requestId, ...(page !== undefined ? { page } : {}), ...(mode === 'inspect' ? { mode } : {}), ...(visual ? { visual: true } : {}) });
export const stopSession = (deckId: string) => request<{ stopped: boolean }>(`/decks/${encodeURIComponent(deckId)}/stop`, 'POST', {});
export async function stopPendingTurn(deckId: string, turn: Promise<unknown>): Promise<DeckView | undefined> {
  const resolution: { state: 'pending' | 'known' | 'unknown' } = { state: 'pending' };
  const terminal = turn.then(() => { resolution.state = 'known'; }, error => { resolution.state = error instanceof RefinerRequestError ? 'known' : 'unknown'; });
  const isKnown = () => resolution.state === 'known';
  await Promise.resolve();
  // An HTTP refusal (including session_busy) never grants control over another operation.
  if (isKnown()) return;
  const started = Date.now();
  let stopSent = false;
  while (true) {
    const view = await readDeck(deckId);
    if (!stopSent && isKnown()) return;
    if (typeof view.busy !== 'boolean') throw new RefinerRequestError('session_state_unknown', 503, undefined, '无法核对本轮运行占用，停止尚未确认。');
    if (!view.busy && (stopSent || resolution.state === 'unknown')) return view;
    if (view.busy && !stopSent) { await stopSession(deckId); stopSent = true; }
    if (Date.now() - started >= 15_000) throw new RefinerRequestError('stop_not_confirmed', 503, undefined, '本轮运行占用尚未核对为空闲，停止未确认；请保留页面核对或显式重试停止。');
    const delay = new Promise<void>(resolve => setTimeout(resolve, 50));
    await (resolution.state === 'pending' ? Promise.race([terminal, delay]) : delay);
  }
}
export const renderDeck = (deckId: string) => request<{ files: string[] }>(`/decks/${encodeURIComponent(deckId)}/render`, 'POST', {});
export const readImage = (deckId: string, name: string) => request<{ name: string; dataUrl: string }>(`/decks/${encodeURIComponent(deckId)}/images/${encodeURIComponent(name)}`);

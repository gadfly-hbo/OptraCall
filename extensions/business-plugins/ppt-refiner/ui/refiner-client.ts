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
};

export class RefinerRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(messages[code] ?? '精修请求未完成，请检查本地服务后重试。'); }
}

async function request<T>(route: string, method: 'GET' | 'POST' = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/ppt-refiner${route}`, {
    method, credentials: 'omit', mode: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-optracall-client': '1' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new RefinerRequestError(String((result as { code?: string }).code ?? 'refiner_request_failed'), response.status);
  return result as T;
}

export type DeckView = { meta: DeckMeta; versions: VersionEntry[]; deckPath: string };
export type TurnResult = { reply: string; snapshot: VersionEntry | null; elapsedMs: number };

export const createDeck = (input: { id: string; sourcePptx: string; title: string; reportPath: string }) => request<{ meta: DeckMeta; deckPath: string }>('/decks', 'POST', input);
export const readDeck = (deckId: string) => request<DeckView>(`/decks/${encodeURIComponent(deckId)}`);
export const setPageLock = (deckId: string, page: number, locked: boolean) => request<{ meta: DeckMeta }>(`/decks/${encodeURIComponent(deckId)}/locks`, 'POST', { page, locked });
export const revertDeck = (deckId: string, version: number) => request<{ reverted: number; versions: VersionEntry[] }>(`/decks/${encodeURIComponent(deckId)}/revert`, 'POST', { version });
export const exportDeck = (deckId: string, input: { outDir: string; fileName?: string }) => request<{ pptx: string; diff: string; versionCount: number }>(`/decks/${encodeURIComponent(deckId)}/export`, 'POST', input);
export const runTurn = (deckId: string, text: string, requestId: string, page?: number) => request<TurnResult & { outcome?: string; violations?: { page: number; restored: boolean }[] }>(`/decks/${encodeURIComponent(deckId)}/turns`, 'POST', { text, requestId, ...(page !== undefined ? { page } : {}) });
export const stopSession = (deckId: string) => request<{ stopped: boolean }>(`/decks/${encodeURIComponent(deckId)}/stop`, 'POST', {});
export const renderDeck = (deckId: string) => request<{ files: string[] }>(`/decks/${encodeURIComponent(deckId)}/render`, 'POST', {});
export const readImage = (deckId: string, name: string) => request<{ name: string; dataUrl: string }>(`/decks/${encodeURIComponent(deckId)}/images/${encodeURIComponent(name)}`);

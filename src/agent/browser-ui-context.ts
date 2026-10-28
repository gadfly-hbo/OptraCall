import { randomUUID } from 'node:crypto';
import { Theme, type ExtensionUIContext, type ExtensionUIDialogOptions, type RpcExtensionUIRequest, type RpcExtensionUIResponse } from './sdk.ts';

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type BrowserUIRequest = Without<Extract<RpcExtensionUIRequest, { method: 'select' | 'confirm' | 'input' | 'editor' }>, 'type'>;
export type BrowserUIResponse = { id: string; value?: string | boolean; cancelled?: boolean };
export type BrowserUIEvent = { type: 'ui.request'; request: BrowserUIRequest } | { type: 'ui.dismiss'; id: string } | { type: 'ui.notification'; message: string; level: 'info' | 'warning' | 'error' } | { type: 'ui.status'; key: string; text?: string } | { type: 'ui.editor'; text: string };
type DialogInput = Without<BrowserUIRequest, 'id'>;
type Pending = { request: BrowserUIRequest; finish: (value: string | boolean) => void; reject: (error: Error) => void; cleanup: () => void };

export class BrowserUICancelled extends Error { constructor() { super('Browser extension interaction was cancelled.'); this.name = 'AbortError'; } }

/** Implements Pi's public dialog contract over Host events; terminal components stay unsupported. */
export function createBrowserUIContext(options: { emit: (event: BrowserUIEvent) => void; onCancelled?: () => void; initialEditorText?: string }) {
  const requests = new Map<string, Pending>();
  const ignored = new Set<string>();
  let closed = false, editorText = options.initialEditorText ?? '';
  function cancel(id: string, notify: boolean) {
    const entry = requests.get(id); if (!entry) return false;
    entry.cleanup(); options.emit({ type: 'ui.dismiss', id }); entry.reject(new BrowserUICancelled());
    if (notify) options.onCancelled?.();
    return true;
  }
  function dialog(request: DialogInput, opts?: ExtensionUIDialogOptions): Promise<string | boolean> {
    if (closed) return Promise.reject(new BrowserUICancelled());
    if (opts?.signal?.aborted) { options.onCancelled?.(); return Promise.reject(new BrowserUICancelled()); }
    if (opts?.timeout !== undefined && (!Number.isFinite(opts.timeout) || opts.timeout < 0)) return Promise.reject(new Error('Invalid extension dialog timeout.'));
    const id = randomUUID(), wire = { ...request, id, ...(opts?.timeout ? { timeout: opts.timeout } : {}) } as BrowserUIRequest;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => { cancel(id, true); };
      const cleanup = () => { requests.delete(id); if (timer) clearTimeout(timer); opts?.signal?.removeEventListener('abort', abort); };
      requests.set(id, { request: wire, finish: value => { cleanup(); options.emit({ type: 'ui.dismiss', id }); resolve(value); }, reject, cleanup });
      opts?.signal?.addEventListener('abort', abort, { once: true });
      if (opts?.timeout) timer = setTimeout(abort, opts.timeout);
      options.emit({ type: 'ui.request', request: wire });
    });
  }
  function respond(response: BrowserUIResponse | RpcExtensionUIResponse): boolean {
    const entry = requests.get(response.id); if (!entry) return false;
    if ('cancelled' in response && response.cancelled) return cancel(response.id, true);
    const value = 'confirmed' in response ? response.confirmed : 'value' in response ? response.value : undefined;
    if (entry.request.method === 'confirm') { if (typeof value !== 'boolean') return false; }
    else {
      if (typeof value !== 'string') return false;
      if (entry.request.method === 'select' && !entry.request.options.includes(value)) return false;
    }
    entry.finish(value); return true;
  }
  function unsupported(method: string): never {
    const message = `Pi terminal UI feature ${method} is not supported by the browser/RPC adapter.`;
    options.emit({ type: 'ui.notification', message, level: 'warning' });
    throw new Error(message);
  }
  function ignoreCosmetic(method: string) {
    if (closed || ignored.has(method)) return;
    ignored.add(method);
    options.emit({ type: 'ui.notification', message: `Pi terminal decoration ${method} is ignored in browser/RPC mode.`, level: 'warning' });
  }
  function setEditorText(text: string) { if (closed) return; editorText = text; options.emit({ type: 'ui.editor', text }); }
  // Text-only notifications need no terminal color renderer. Geometry, raw input
  // and actual custom components still require TUI mode.
  const terminalTheme = new Proxy(Theme.prototype, { get: (_target, property) => {
    if (property === 'fg' || property === 'bg') return (_color: unknown, text: string) => text;
    if (['style', 'bold', 'italic', 'underline', 'inverse', 'strikethrough'].includes(String(property))) return (text: string) => text;
    return unsupported('theme styling');
  } });
  const context: ExtensionUIContext = {
    select: async (title, choices, opts) => await dialog({ method: 'select', title, options: [...choices] }, opts) as string,
    confirm: async (title, message, opts) => await dialog({ method: 'confirm', title, message }, opts) as boolean,
    input: async (title, placeholder, opts) => await dialog({ method: 'input', title, placeholder }, opts) as string,
    editor: async (title, prefill) => await dialog({ method: 'editor', title, prefill }) as string,
    notify: (message, level = 'info') => options.emit({ type: 'ui.notification', message, level }),
    setStatus: (key, text) => options.emit({ type: 'ui.status', key, text }),
    setWorkingMessage: text => options.emit({ type: 'ui.status', key: 'pi.working', text }),
    setWorkingVisible: visible => { if (!visible) options.emit({ type: 'ui.status', key: 'pi.working' }); },
    setWorkingIndicator: value => { if (value) ignoreCosmetic('setWorkingIndicator'); },
    setHiddenThinkingLabel: value => { if (value) ignoreCosmetic('setHiddenThinkingLabel'); },
    setWidget(key, content) { if (content === undefined || Array.isArray(content)) options.emit({ type: 'ui.status', key: `pi.widget.${key}`, text: content?.join('\n') }); else ignoreCosmetic('component widgets'); },
    setFooter: factory => { if (factory) ignoreCosmetic('setFooter'); },
    setHeader: factory => { if (factory) ignoreCosmetic('setHeader'); },
    setTitle: title => options.emit({ type: 'ui.status', key: 'pi.title', text: title }),
    custom: async () => unsupported('custom components'),
    onTerminalInput: () => unsupported('terminal input'),
    pasteToEditor: setEditorText,
    setEditorText,
    getEditorText: () => editorText,
    addAutocompleteProvider: () => ignoreCosmetic('autocomplete providers'),
    setEditorComponent: factory => { if (factory) ignoreCosmetic('custom editor components'); },
    getEditorComponent: () => undefined,
    theme: terminalTheme,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Terminal themes are not supported by the browser/RPC adapter.' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => ignoreCosmetic('terminal tool expansion'),
  };
  const dismissPending = () => { for (const id of [...requests.keys()]) cancel(id, false); };
  return { context, respond, pending: (): BrowserUIRequest[] => [...requests.values()].map(entry => structuredClone(entry.request)), updateEditorState: (text: string) => { if (!closed) editorText = text; }, dismissPending, dispose: () => { closed = true; dismissPending(); } };
}

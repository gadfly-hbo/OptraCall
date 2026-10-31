import { Agent, fetch, Headers, Request, Response, FormData, install, setGlobalDispatcher } from 'undici';
import metadata from 'undici/package.json' with { type: 'json' };
import { channel } from 'node:diagnostics_channel';

const causeCodes = new Set(['UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_ABORTED', 'ABORT_ERR']);
function observedCause(error) {
  for (let depth = 0; error && typeof error === 'object' && depth < 4; depth++, error = error.cause) if (causeCodes.has(error.code)) return error.code;
  return 'UNKNOWN';
}
function responseRequestId(headers) {
  if (!Array.isArray(headers)) return undefined;
  for (let index = 0; index + 1 < headers.length; index += 2) {
    const name = String(headers[index]).toLowerCase();
    if (name !== 'x-request-id' && name !== 'request-id') continue;
    const value = String(headers[index + 1]);
    if (/^[a-zA-Z0-9._:-]{1,128}$/.test(value)) return value;
  }
}

export function configureHttpTransport() {
  if (metadata.version !== '8.12.2') throw new Error('Unexpected HTTP transport version.');
  // Bootstrapping does not issue model requests. Each native turn reads the
  // effective idle timeout from the SDK's public SettingsManager below.
  let idleTimeoutMs = 300_000;
  const settings = () => ({ connectTimeoutMs: 10_000, headersTimeoutMs: idleTimeoutMs, bodyIdleTimeoutMs: idleTimeoutMs });
  const dispatcher = new Agent({ connect: { timeout: 10_000 } }).compose(dispatch => (options, handler) => dispatch({ ...options, headersTimeout: idleTimeoutMs, bodyTimeout: idleTimeoutMs }, handler));
  setGlobalDispatcher(dispatcher);
  install();
  if (globalThis.fetch !== fetch || globalThis.Headers !== Headers || globalThis.Request !== Request || globalThis.Response !== Response || globalThis.FormData !== FormData) throw new Error('HTTP transport globals are not isolated.');
  const observers = new Set();
  return {
    version: metadata.version,
    settings,
    setHttpIdleTimeoutMs(value) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_http_idle_timeout');
      idleTimeoutMs = value;
    },
    observe(baseUrl, emit) {
      const base = new URL(baseUrl), prefix = base.pathname.replace(/\/$/, '');
      const pending = new WeakMap();
      let attempt = 0;
      const now = () => new Date().toISOString();
      const publish = (request, extra) => {
        const record = pending.get(request); if (!record) return;
        pending.delete(request);
        // Never copy request URLs/headers/body or raw error messages. The caller
        // additionally masks its known credential before native persistence.
        try { emit({ ...record, ...extra, endedAt: now() }); } catch { /* Optional observation cannot change an SDK request outcome. */ }
      };
      const handlers = {
        'undici:request:create': ({ request }) => {
          try {
            const url = new URL(request.path, String(request.origin));
            if (request.method === 'POST' && url.origin === base.origin && (url.pathname === prefix || url.pathname.startsWith(prefix + '/'))) pending.set(request, { attempt: ++attempt, startedAt: now(), timeouts: settings() });
          } catch { /* Invalid/unrelated requests are not observed. */ }
        },
        'undici:request:headers': ({ request, response }) => {
          const record = pending.get(request); if (!record) return;
          record.headersAt = now();
          if (Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599) record.statusCode = response.statusCode;
          const id = responseRequestId(response.headers); if (id) record.providerRequestId = id;
        },
        'undici:request:bodyChunkReceived': ({ request }) => {
          const record = pending.get(request); if (!record) return;
          record.firstBodyAt ??= now(); record.lastBodyAt = now();
        },
        'undici:request:trailers': ({ request }) => publish(request, { phase: 'completed' }),
        'undici:request:error': ({ request, error }) => publish(request, { phase: 'failed', causeCode: observedCause(error) }),
      };
      for (const [name, handler] of Object.entries(handlers)) channel(name).subscribe(handler);
      const stop = () => { for (const [name, handler] of Object.entries(handlers)) channel(name).unsubscribe(handler); observers.delete(stop); };
      observers.add(stop);
      return stop;
    },
    async close() { for (const stop of [...observers]) stop(); await dispatcher.close(); },
  };
}

/** Unprivileged connector process. Its only network capability is the inherited Host broker fd. */
import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { exactWeatherKeys, readWeatherFrames, WEATHER_MAX_BODY_BYTES, WEATHER_MAX_FRAME_BYTES, WEATHER_MAX_PENDING, WEATHER_PROTOCOL_VERSION } from './weather-transport.ts';
import type { WeatherUpstreamFetch } from './weather-egress.ts';

function abortError(): Error { const error = new Error('weather_request_cancelled'); error.name = 'AbortError'; return error; }
type Pending = { resolve: (value: Awaited<ReturnType<WeatherUpstreamFetch>>) => void; reject: (error: Error) => void; removeAbort: () => void };

export function createWeatherBrokerClient(channel: Duplex, onDisconnect: () => void): { fetch: WeatherUpstreamFetch; close: () => void } {
  let nextId = 0, closed = false;
  const pending = new Map<number, Pending>();
  let stopFrames = () => {};
  const close = () => {
    if (closed) return;
    closed = true; stopFrames(); channel.destroy();
    for (const entry of pending.values()) { entry.removeAbort(); entry.reject(new Error('weather_transport_disconnected')); }
    pending.clear(); onDisconnect();
  };
  const send = (message: Record<string, unknown>) => {
    if (!closed) channel.write(JSON.stringify({ version: WEATHER_PROTOCOL_VERSION, ...message }) + '\n', error => { if (error) close(); });
  };
  stopFrames = readWeatherFrames(channel, WEATHER_MAX_FRAME_BYTES, message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) { close(); return; }
    const frame = message as Record<string, unknown>;
    if (frame.version !== WEATHER_PROTOCOL_VERSION || !Number.isSafeInteger(frame.id) || Number(frame.id) < 1 || Number(frame.id) > nextId) { close(); return; }
    if (frame.type === 'response') {
      if (!exactWeatherKeys(frame, ['version', 'type', 'id', 'status', 'headers', 'body']) || !Number.isInteger(frame.status) || Number(frame.status) < 200 || Number(frame.status) > 599
        || typeof frame.body !== 'string' || Buffer.byteLength(frame.body) > WEATHER_MAX_BODY_BYTES
        || !frame.headers || typeof frame.headers !== 'object' || Array.isArray(frame.headers)
        || Object.entries(frame.headers).some(([key, value]) => key !== 'retry-after' || typeof value !== 'string' || value.length > 256)) { close(); return; }
    } else if (frame.type === 'error') {
      if (!exactWeatherKeys(frame, ['version', 'type', 'id', 'code', 'message']) || !['timeout', 'source_unavailable'].includes(String(frame.code)) || typeof frame.message !== 'string' || frame.message.length > 256) { close(); return; }
    } else { close(); return; }
    const id = Number(frame.id), entry = pending.get(id);
    if (!entry) return; // Cancelled or completed requests never become a second result.
    pending.delete(id); entry.removeAbort();
    if (frame.type === 'error') {
      const error = new Error(String(frame.message)); if (frame.code === 'timeout') error.name = 'AbortError'; entry.reject(error);
    } else {
      const body = frame.body as string;
      entry.resolve({ status: Number(frame.status), headers: frame.headers as Record<string, string>, text: async () => body });
    }
  }, close);
  channel.once('error', close); channel.once('end', close); channel.once('close', close);
  const fetch: WeatherUpstreamFetch = (url, { signal }) => {
    if (closed) return Promise.reject(new Error('weather_transport_disconnected'));
    if (signal.aborted) return Promise.reject(abortError());
    if (pending.size >= WEATHER_MAX_PENDING || nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(new Error('weather_transport_busy'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const entry = pending.get(id); if (!entry) return;
        pending.delete(id); entry.removeAbort(); send({ type: 'cancel', id }); reject(abortError());
      };
      signal.addEventListener('abort', cancel, { once: true });
      pending.set(id, { resolve, reject, removeAbort: () => signal.removeEventListener('abort', cancel) });
      // No await occurs between registration and send; an already-aborted signal never dispatches late.
      if (signal.aborted) { cancel(); return; }
      if (Buffer.byteLength(url) > 60 * 1024) { pending.delete(id); signal.removeEventListener('abort', cancel); reject(new Error('weather_request_invalid')); return; }
      send({ type: 'request', id, url });
    });
  };
  return { fetch, close };
}

export async function runWeatherWorker(cacheRoot: string): Promise<void> {
  if (!process.permission || process.permission.has('net') || process.permission.has('child') || process.permission.has('worker') || process.permission.has('addons') || process.permission.has('wasi')) throw new Error('weather_worker_permission_invalid');
  const channel = new Socket({ fd: 3, readable: true, writable: true });
  let server: { close: () => Promise<void> } | undefined, stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true; client.close();
    void (async () => { try { await server?.close(); } finally { process.stdin.destroy(); process.exit(0); } })();
  };
  const client = createWeatherBrokerClient(channel, stop);
  process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdin.once('end', stop);
  const { createWeatherServer } = await import('../../extensions/connectors/weather-mcp/server.ts');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  if (stopping) return;
  const created = createWeatherServer({ cacheRoot, fetchImpl: client.fetch }); server = created.server;
  await created.server.connect(new StdioServerTransport());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--cache-root'), cacheRoot = index >= 0 ? process.argv[index + 1] : undefined;
  if (!cacheRoot) throw new Error('weather_cache_root_required');
  try { await runWeatherWorker(cacheRoot); }
  catch { process.stderr.write('weather_worker_start_failed\n'); process.exit(1); }
}

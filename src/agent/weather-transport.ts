/** Host-owned stdio relay. Connector code is imported only by the isolated worker. */
import { spawn } from 'node:child_process';
import { chmod, mkdir, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fetchWeatherUpstream, validateWeatherUrl, type WeatherUpstreamFetch } from './weather-egress.ts';

export const WEATHER_PROTOCOL_VERSION = 1;
export const WEATHER_MAX_BODY_BYTES = 1024 * 1024;
export const WEATHER_MAX_FRAME_BYTES = WEATHER_MAX_BODY_BYTES * 6 + 4096;
export const WEATHER_MAX_PENDING = 8;
const MAX_REQUEST_BYTES = 64 * 1024;

export function exactWeatherKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}

/** Length is checked on bytes before parsing, including incomplete frames. */
export function readWeatherFrames(channel: Duplex, limit: number, receive: (value: unknown) => void, fail: () => void): () => void {
  let buffered = Buffer.alloc(0), failed = false;
  const reject = () => { if (!failed) { failed = true; fail(); } };
  const data = (chunk: Buffer) => {
    if (failed) return;
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      const end = buffered.indexOf(10);
      if (end < 0) { if (buffered.length > limit) reject(); return; }
      if (end > limit) { reject(); return; }
      const line = buffered.subarray(0, end); buffered = buffered.subarray(end + 1);
      try { receive(JSON.parse(line.toString('utf8'))); } catch { reject(); return; }
      if (failed) return;
    }
  };
  channel.on('data', data);
  return () => { failed = true; buffered = Buffer.alloc(0); channel.off('data', data); };
}

function aborted(): Error { const error = new Error('weather_request_cancelled'); error.name = 'AbortError'; return error; }
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(aborted()); }
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted()); };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

export async function runWeatherTransport(options: { cacheRoot: string; upstreamFetch?: WeatherUpstreamFetch }): Promise<void> {
  // Test callers may replace only the trusted upstream function, never this OS boundary.
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) throw new Error('weather_egress_protection_unsupported');
  if (!path.isAbsolute(options.cacheRoot)) throw new Error('weather_cache_root_invalid');
  await mkdir(options.cacheRoot, { recursive: true, mode: 0o700 });
  const cacheRoot = await realpath(options.cacheRoot);
  if (!(await stat(cacheRoot)).isDirectory()) throw new Error('weather_cache_root_invalid');
  const codeRoot = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const relative = path.relative(cacheRoot, codeRoot);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('weather_cache_overlaps_code');
  await chmod(cacheRoot, 0o700);
  const node = await realpath(process.execPath);
  const modulesRoot = await realpath(path.join(codeRoot, 'node_modules'));
  const worker = fileURLToPath(new URL('./weather-worker.ts', import.meta.url));
  const profile = ['(version 1)', '(deny default)', '(allow file-read*)', '(allow sysctl-read)',
    '(allow process-exec (literal ' + JSON.stringify(node) + '))',
    '(allow file-write* (subpath ' + JSON.stringify(cacheRoot) + ') (literal "/dev/null"))'].join('\n');
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, node, '--permission',
    '--allow-fs-read=' + codeRoot, '--allow-fs-read=' + modulesRoot, '--allow-fs-read=' + cacheRoot, '--allow-fs-write=' + cacheRoot,
    worker, '--cache-root', cacheRoot], {
    cwd: cacheRoot, detached: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env: { HOME: cacheRoot, TMPDIR: cacheRoot, PATH: path.dirname(node), NODE_DISABLE_COMPILE_CACHE: '1', OPENSSL_CONF: '/dev/null' },
  });
  const channel = child.stdio[3] as Duplex;
  const active = new Map<number, AbortController>();
  let lastId = 0, closing = false, finished = false, failure: Error | undefined;
  let force: ReturnType<typeof setTimeout> | undefined, terminate: ReturnType<typeof setTimeout> | undefined;
  let resolveDone!: () => void;
  const done = new Promise<void>(resolve => { resolveDone = resolve; });
  const finish = () => { if (!finished) { finished = true; resolveDone(); } };
  const close = (error?: Error) => {
    if (closing) return;
    closing = true; failure = error;
    for (const controller of active.values()) controller.abort();
    process.stdin.unpipe(child.stdin!); process.stdin.pause();
    child.stdin?.end(); channel.destroy();
    if (child.exitCode !== null || child.signalCode !== null) { finish(); return; }
    // Stay inside the SDK's process group. It remains the outer shutdown owner.
    terminate = setTimeout(() => { child.kill('SIGTERM'); }, 150);
    force = setTimeout(() => { child.kill('SIGKILL'); }, 350);
  };
  const protocolFailure = () => close(new Error('weather_transport_protocol_invalid'));
  const send = (message: Record<string, unknown>) => {
    if (closing || channel.destroyed) return;
    const line = JSON.stringify({ version: WEATHER_PROTOCOL_VERSION, ...message }) + '\n';
    if (Buffer.byteLength(line) > WEATHER_MAX_FRAME_BYTES || channel.writableLength + Buffer.byteLength(line) > WEATHER_MAX_FRAME_BYTES * 2) { protocolFailure(); return; }
    if (!channel.write(line, error => { if (error && !closing) protocolFailure(); })) {
      channel.pause(); channel.once('drain', () => { if (!closing) channel.resume(); });
    }
  };
  const fetchImpl = options.upstreamFetch ?? fetchWeatherUpstream;
  const execute = async (id: number, input: string, controller: AbortController) => {
    try {
      const url = validateWeatherUrl(input).toString(); // Also applies to trusted synthetic upstream injection.
      const response = await withSignal(fetchImpl(url, { signal: controller.signal }), controller.signal);
      const body = await withSignal(response.text(), controller.signal);
      if (controller.signal.aborted || closing) return;
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599 || Buffer.byteLength(body) > WEATHER_MAX_BODY_BYTES) throw new Error('weather_upstream_invalid');
      const retry = response.headers['retry-after'];
      const headers = typeof retry === 'string' && retry.length <= 256 ? { 'retry-after': retry } : {};
      send({ type: 'response', id, status: response.status, headers, body });
    } catch (error) {
      if (!closing && !controller.signal.aborted) {
        const timeout = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
        send({ type: 'error', id, code: timeout ? 'timeout' : 'source_unavailable', message: timeout ? 'weather_request_timeout' : 'weather_upstream_unavailable' });
      }
    } finally { active.delete(id); }
  };
  const stopFrames = readWeatherFrames(channel, MAX_REQUEST_BYTES, message => {
    if (closing) return;
    if (!message || typeof message !== 'object' || Array.isArray(message)) { protocolFailure(); return; }
    const frame = message as Record<string, unknown>;
    if (frame.version !== WEATHER_PROTOCOL_VERSION || !Number.isSafeInteger(frame.id) || Number(frame.id) < 1) { protocolFailure(); return; }
    const id = Number(frame.id);
    if (frame.type === 'cancel' && exactWeatherKeys(frame, ['version', 'type', 'id'])) { if (id > lastId) protocolFailure(); else active.get(id)?.abort(); return; }
    if (frame.type !== 'request' || !exactWeatherKeys(frame, ['version', 'type', 'id', 'url']) || typeof frame.url !== 'string' || id <= lastId) { protocolFailure(); return; }
    lastId = id; // A monotonic high-water mark rejects replays without an unbounded tombstone set.
    if (active.size >= WEATHER_MAX_PENDING) { send({ type: 'error', id, code: 'source_unavailable', message: 'weather_transport_busy' }); return; }
    const controller = new AbortController(); active.set(id, controller);
    void execute(id, frame.url, controller);
  }, protocolFailure);
  const onInputEnd = () => close();
  const onSignal = () => close();
  const onOutputError = () => close(new Error('weather_transport_disconnected'));
  child.once('error', () => { close(new Error('weather_worker_start_failed')); finish(); });
  child.once('close', () => { if (!closing) close(new Error('weather_worker_disconnected')); finish(); });
  channel.once('error', () => { if (!closing) protocolFailure(); });
  channel.once('end', () => { if (!closing) close(new Error('weather_worker_disconnected')); });
  channel.once('close', () => { if (!closing) close(new Error('weather_worker_disconnected')); });
  child.stdin!.on('error', () => { if (!closing) close(new Error('weather_worker_disconnected')); });
  process.stdin.once('end', onInputEnd); process.stdin.once('error', onOutputError);
  process.stdout.once('error', onOutputError);
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  child.stdout!.pipe(process.stdout, { end: false });
  child.stderr!.pipe(process.stderr, { end: false });
  process.stdin.pipe(child.stdin!);
  try { await done; if (failure) throw failure; }
  finally {
    if (terminate) clearTimeout(terminate); if (force) clearTimeout(force);
    stopFrames(); process.stdin.unpipe(child.stdin!); child.stdout!.unpipe(process.stdout); child.stderr!.unpipe(process.stderr);
    process.stdin.off('end', onInputEnd); process.stdin.off('error', onOutputError); process.stdout.off('error', onOutputError);
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
  }
}

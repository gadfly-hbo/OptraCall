/** Host-only weather egress. Connector code never runs in this process. */
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity, rootCertificates } from 'node:tls';

const HOST = 'archive-api.open-meteo.com';
const PATH = '/v1/archive';
const FIELDS = ['temperature_2m_mean', 'precipitation_sum'];
const KEYS = ['latitude', 'longitude', 'start_date', 'end_date', 'daily', 'timezone'];
const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;

export interface WeatherUpstreamResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
}
export type WeatherUpstreamFetch = (url: string, init: { signal: AbortSignal }) => Promise<WeatherUpstreamResponse>;

const excluded = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) excluded.addSubnet(network, prefix, 'ipv4');

/** Conservative IPv4-only route policy; special-purpose and all IPv6 addresses fail closed. */
export function isPublicIPv4(address: string): boolean {
  return isIP(address) === 4 && !excluded.check(address, 'ipv4');
}

function invalid(): never { throw new Error('weather_egress_denied'); }
function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) invalid();
  return time;
}
function coordinate(value: string, limit: number): number {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) invalid();
  const number = Number(value);
  if (!Number.isFinite(number) || number < -limit || number > limit) invalid();
  return number;
}

/** Validate before DNS and reconstruct the six permitted values; no caller-controlled transport options. */
export function validateWeatherUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 2048) invalid();
  const authority = /^https:\/\/([^/?#]*)/.exec(input)?.[1];
  if (authority !== HOST && authority !== HOST + ':443') invalid();
  let parsed: URL;
  try { parsed = new URL(input); } catch { invalid(); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== HOST || parsed.port || parsed.username || parsed.password ||
      parsed.pathname !== PATH || input.includes('#')) invalid();
  if (parsed.searchParams.size !== KEYS.length || KEYS.some(key => parsed.searchParams.getAll(key).length !== 1)) invalid();
  const get = (key: string) => parsed.searchParams.get(key) ?? invalid();
  const lat = coordinate(get('latitude'), 90), lon = coordinate(get('longitude'), 180);
  const start = get('start_date'), end = get('end_date');
  const span = (dateValue(end) - dateValue(start)) / 86_400_000 + 1;
  if (span < 1 || span > 366 || end >= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) invalid();
  const fields = get('daily').split(',');
  if (!fields.length || fields.length > FIELDS.length || new Set(fields).size !== fields.length || fields.some(field => !FIELDS.includes(field))) invalid();
  if (get('timezone') !== 'Asia/Shanghai') invalid();
  const canonical = new URL('https://' + HOST + PATH);
  for (const [key, value] of [
    ['latitude', String(lat)], ['longitude', String(lon)], ['start_date', start], ['end_date', end],
    ['daily', fields.join(',')], ['timezone', 'Asia/Shanghai'],
  ]) canonical.searchParams.set(key, value);
  return canonical;
}

/** One DNS result and one HTTPS attempt, with fixed CA/SNI/port and no redirects or retries. */
export const fetchWeatherUpstream: WeatherUpstreamFetch = async (input, { signal }) => {
  const url = validateWeatherUrl(input);
  return new Promise((resolve, reject) => {
    let settled = false, outgoing: ClientRequest | undefined, incoming: IncomingMessage | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); outgoing?.destroy(); incoming?.destroy(); reject(error);
    };
    const abort = () => fail(new DOMException('weather request aborted', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => fail(new DOMException('weather upstream timed out', 'TimeoutError')), TIMEOUT_MS);
    void (async () => {
      // getaddrinfo may finish after cancellation; its late result must never create a connection.
      const addresses = await lookup(HOST, { all: true, family: 4, verbatim: true });
      if (settled) return;
      if (!addresses.length || addresses.some(item => item.family !== 4 || !isPublicIPv4(item.address))) invalid();
      const pinned = addresses[0].address;
      outgoing = request({
        protocol: 'https:', hostname: HOST, port: 443, path: url.pathname + url.search,
        method: 'GET', headers: { accept: 'application/json' }, agent: false,
        family: 4,
        lookup: (hostname, options, callback) => {
          if (hostname !== HOST) { callback(new Error('weather_dns_host_mismatch'), '', 4); return; }
          if (options.all) callback(null, [{ address: pinned, family: 4 }]);
          else callback(null, pinned, 4);
        },
        servername: HOST, rejectUnauthorized: true, ca: [...rootCertificates],
        checkServerIdentity: (_hostname, certificate) => checkServerIdentity(HOST, certificate),
      }, response => {
        incoming = response;
        if (settled) { response.destroy(); return; }
        const status = response.statusCode;
        if (!status || status < 100 || status > 599) { fail(new Error('weather_upstream_invalid_status')); return; }
        if (status >= 300 && status < 400) { fail(new Error('weather_upstream_redirect_blocked')); return; }
        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) { fail(new Error('weather_upstream_body_too_large')); return; }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > MAX_BODY_BYTES) { fail(new Error('weather_upstream_body_too_large')); return; }
          chunks.push(chunk);
        });
        response.once('error', fail);
        response.once('aborted', () => fail(new Error('weather_upstream_incomplete')));
        response.once('close', () => { if (!response.complete) fail(new Error('weather_upstream_incomplete')); });
        response.once('end', () => {
          if (settled) return;
          settled = true; cleanup();
          const body = Buffer.concat(chunks).toString('utf8');
          const retryAfter = response.headers['retry-after'];
          resolve({ status, headers: typeof retryAfter === 'string' ? { 'retry-after': retryAfter } : {}, text: async () => body });
        });
      });
      outgoing.once('error', fail);
      if (settled) { outgoing.destroy(); return; }
      outgoing.end();
    })().catch(fail);
  });
};

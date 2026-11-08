/** Open-Meteo Archive API 适配器：出境自限于唯一白名单域，失败分类（限流/超时/上游/网络），
 * 不自动重试（取消/未知副作用语义由调用方与 Host 承担）。 */

import { TIMEZONE, type DailyRecord, type WeatherField, type WeatherRequest } from './types.ts';

export const OPEN_METEO_BASE = 'https://archive-api.open-meteo.com/v1/archive';
export const DEFAULT_TIMEOUT_MS = 10_000;

export type WeatherApiErrorCode = 'invalid_param' | 'source_unavailable';

export class WeatherApiError extends Error {
  readonly code: WeatherApiErrorCode;
  readonly detail?: unknown;
  constructor(code: WeatherApiErrorCode, message: string, detail?: unknown) {
    super(`${code}: ${message}`);
    this.name = 'WeatherApiError';
    this.code = code;
    this.detail = detail;
  }
}

export interface FetchLike {
  (url: string, init: { signal: AbortSignal; redirect?: 'error' }): Promise<{
    status: number;
    headers: Record<string, string> | Pick<Headers, 'get'>;
    text(): Promise<string>;
  }>;
}

export function buildUrl(request: WeatherRequest): string {
  const url = new URL(OPEN_METEO_BASE);
  url.searchParams.set('latitude', String(request.lat));
  url.searchParams.set('longitude', String(request.lon));
  url.searchParams.set('start_date', request.start);
  url.searchParams.set('end_date', request.end);
  url.searchParams.set('daily', request.fields.join(','));
  url.searchParams.set('timezone', TIMEZONE);
  if (!url.toString().startsWith('https://archive-api.open-meteo.com/')) {
    throw new Error('egress self-check failed: URL escaped the whitelisted origin');
  }
  return url.toString();
}

export async function fetchDailyHistory(request: WeatherRequest, options: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ daily: DailyRecord[] }> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), timeoutMs);
  const onCallerAbort = () => controller.abort(new DOMException('cancelled', 'AbortError'));
  options.signal?.addEventListener('abort', onCallerAbort);
  if (options.signal?.aborted) onCallerAbort();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([aborted, (async () => {
      controller.signal.throwIfAborted();
      const response = await fetchImpl(buildUrl(request), { signal: controller.signal, redirect: 'error' });
      const body = await response.text();
      controller.signal.throwIfAborted();
      if (response.status === 429) {
        const headers = response.headers;
        const raw = typeof headers.get === 'function' ? headers.get('retry-after') : (headers as Record<string, string>)['retry-after'] ?? (headers as Record<string, string>)['Retry-After'];
        const retryAfter = raw && /^\d+$/.test(raw) ? Number(raw) : raw && /^[A-Za-z]{3}, /.test(raw) ? Math.max(0, Math.ceil((Date.parse(raw) - Date.now()) / 1000)) : NaN;
        throw new WeatherApiError('source_unavailable', '上游限流，本次未获得数据', {
          reason: /quota|额度/i.test(body) ? 'quota_exhausted' : 'rate_limited',
          retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
          status: response.status,
        });
      }
      if (response.status === 401 || response.status === 403) {
        throw new WeatherApiError('source_unavailable', '上游鉴权失败（本连接器无密钥，不应出现）', { reason: 'auth_invalid', status: response.status });
      }
      if (response.status >= 500) {
        throw new WeatherApiError('source_unavailable', `上游服务错误（HTTP ${response.status}）`, { reason: 'upstream_error', status: response.status });
      }
      if (response.status >= 400) {
        let upstreamReason = '';
        try {
          upstreamReason = (JSON.parse(body) as { reason?: string }).reason ?? '';
        } catch { /* 保留空原因，如实呈现状态码 */ }
        throw new WeatherApiError('invalid_param', `上游拒绝请求${upstreamReason ? `：${upstreamReason}` : `（HTTP ${response.status}）`}`, { status: response.status, upstreamReason });
      }
      if (response.status !== 200) throw new WeatherApiError('source_unavailable', `上游返回意外状态（HTTP ${response.status}），未跟随重定向`, { reason: 'upstream_error', status: response.status });
      return { daily: parseDaily(body, request) };
    })()]);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new WeatherApiError('source_unavailable', `请求超时（>${Math.round(timeoutMs / 1000)}s）或被取消，结果未知，未自动重试`, { reason: options.signal?.aborted ? 'cancelled' : 'timeout' });
    }
    if (error instanceof WeatherApiError) throw error;
    throw new WeatherApiError('source_unavailable', '网络错误，未获得数据，未自动重试', { reason: 'network' });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

function parseDaily(body: string, request: WeatherRequest): DailyRecord[] {
  const malformed = () => new WeatherApiError('source_unavailable', '上游逐日响应结构不完整或含无效值，拒绝补值或猜测解读', { reason: 'malformed_response' });
  let parsed: { daily?: { time?: string[] } & Partial<Record<WeatherField, (number | null)[]>> };
  try { parsed = JSON.parse(body); } catch { throw malformed(); }
  if (!parsed || typeof parsed !== 'object') throw malformed();
  const time = parsed.daily?.time;
  if (!Array.isArray(time) || time.some(date => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date
    || date < request.start || date > request.end)) throw malformed();
  for (const field of request.fields) {
    const column = parsed.daily?.[field];
    if (!Array.isArray(column) || column.length !== time.length || column.some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) throw malformed();
  }
  return time.map((date, index) => {
    const values: DailyRecord['values'] = {};
    for (const field of request.fields) {
      const column = parsed.daily?.[field];
      values[field] = column![index]!;
    }
    return { date, values };
  });
}

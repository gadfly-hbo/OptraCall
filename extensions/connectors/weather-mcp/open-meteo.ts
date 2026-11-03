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
  (url: string, init: { signal: AbortSignal }): Promise<{
    status: number;
    headers: Record<string, string>;
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onCallerAbort);
  try {
    const response = await fetchImpl(buildUrl(request), { signal: controller.signal });
    const body = await response.text();
    if (response.status === 429) {
      const retryAfter = Number(response.headers['retry-after'] ?? response.headers['Retry-After']);
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
    return { daily: parseDaily(body, request.fields) };
  } catch (error) {
    if (error instanceof WeatherApiError) throw error;
    if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
      throw new WeatherApiError('source_unavailable', `请求超时（>${Math.round(timeoutMs / 1000)}s）或被取消，结果未知，未自动重试`, { reason: options.signal?.aborted ? 'cancelled' : 'timeout' });
    }
    throw new WeatherApiError('source_unavailable', '网络错误，未获得数据，未自动重试', { reason: 'network' });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}

function parseDaily(body: string, fields: WeatherField[]): DailyRecord[] {
  const parsed = JSON.parse(body) as { daily?: { time?: string[] } & Partial<Record<WeatherField, (number | null)[]>> };
  const time = parsed.daily?.time;
  if (!Array.isArray(time)) {
    throw new WeatherApiError('source_unavailable', '上游返回缺少 daily.time，拒绝猜测解读');
  }
  return time.map((date, index) => {
    const values: DailyRecord['values'] = {};
    for (const field of fields) {
      const column = parsed.daily?.[field];
      if (Array.isArray(column)) values[field] = column[index] ?? null;
    }
    return { date, values };
  });
}

/** 天气查询服务：参数校验（城市/坐标/日期/字段）→ 缓存命中（新鲜）→ 否则经适配器获取 →
 * 覆盖核对 → 回写缓存。结果携带来源、时区、获取时间与缓存时效；缺失/null 如实呈现。 */

import { WeatherCache } from './cache.ts';
import { checkCoverage } from './coverage.ts';
import { OPEN_METEO_BASE, WeatherApiError, fetchDailyHistory, type FetchLike } from './open-meteo.ts';
import {
  CITY_PRESETS, MAX_SPAN_DAYS, TIMEZONE, ToolError, WEATHER_FIELDS,
  type CoverageReport, type DailyRecord, type WeatherField, type WeatherRequest,
} from './types.ts';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_KEYS = ['city', 'lat', 'lon', 'start', 'end', 'fields'];

export const LICENSE_NOTE = '数据来自 Open-Meteo 历史天气 API（Archive API，非商业用途免费档，条款 https://open-meteo.com/en/terms，数据按CC-BY 4.0署名）；结果为历史观测/再分析值，不是预报。';

export interface HistoryArgs {
  city?: string;
  lat?: number;
  lon?: number;
  start: string;
  end: string;
  fields?: string[];
  [extra: string]: unknown;
}

export interface HistoryResult {
  source: { provider: string; url: string; licenseNote: string };
  timezone: string;
  request: WeatherRequest & { city?: string };
  coverage: CoverageReport;
  daily: DailyRecord[];
  cache: { hit: boolean; fetchedAt: string; ageHours: number };
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function spanDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

export class WeatherService {
  private readonly cache: WeatherCache;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: { cacheRoot: string; ttlHours?: number; timeoutMs?: number; fetchImpl?: FetchLike; now?: () => Date }) {
    this.cache = new WeatherCache(options.cacheRoot, { ttlHours: options.ttlHours, now: options.now });
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  async history(args: HistoryArgs, signal?: AbortSignal): Promise<HistoryResult> {
    const checkCancelled = () => { if (signal?.aborted) throw new ToolError('source_unavailable', '查询已取消，结果未知，未自动重试', { reason: 'cancelled' }); };
    checkCancelled();
    for (const key of Object.keys(args)) {
      if (!ALLOWED_KEYS.includes(key)) {
        throw new ToolError('invalid_param', `未知参数 ${key}；可用参数：${ALLOWED_KEYS.join('/')}`, { key });
      }
    }
    const hasCoords = args.lat !== undefined || args.lon !== undefined;
    if (args.city !== undefined && hasCoords) {
      throw new ToolError('invalid_param', 'city 与 lat/lon 不能同时提供；二选一');
    }
    if (!args.city && !hasCoords) {
      throw new ToolError('invalid_param', `须提供城市名（内置：${Object.keys(CITY_PRESETS).join('/')}）或经纬度 lat+lon`);
    }
    let lat: number, lon: number;
    if (typeof args.city === 'string') {
      const preset = Object.hasOwn(CITY_PRESETS, args.city) ? CITY_PRESETS[args.city] : undefined;
      if (!preset) {
        throw new ToolError('invalid_param', `未内置城市「${args.city}」的坐标；内置城市：${Object.keys(CITY_PRESETS).join('/')}，其余请直接提供 lat/lon`, { city: args.city });
      }
      lat = preset.lat;
      lon = preset.lon;
    } else {
      if (typeof args.lat !== 'number' || typeof args.lon !== 'number' || !Number.isFinite(args.lat) || !Number.isFinite(args.lon)) {
        throw new ToolError('invalid_param', 'lat 与 lon 须同时为有限数值');
      }
      if (args.lat < -90 || args.lat > 90 || args.lon < -180 || args.lon > 180) {
        throw new ToolError('invalid_param', '坐标越界（lat -90..90，lon -180..180）', { lat: args.lat, lon: args.lon });
      }
      lat = args.lat;
      lon = args.lon;
    }
    if (typeof args.start !== 'string' || typeof args.end !== 'string' || !isValidDate(args.start) || !isValidDate(args.end)) {
      throw new ToolError('invalid_param', 'start/end 须为 YYYY-MM-DD 格式日期');
    }
    if (spanDays(args.start, args.end) < 0) {
      throw new ToolError('invalid_param', 'start 不能晚于 end', { start: args.start, end: args.end });
    }
    if (spanDays(args.start, args.end) + 1 > MAX_SPAN_DAYS) {
      throw new ToolError('invalid_param', `日期跨度超过 ${MAX_SPAN_DAYS} 天上限，请分段查询`, { spanDays: spanDays(args.start, args.end) + 1 });
    }
    if (args.end >= new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now())) {
      throw new ToolError('invalid_param', '本工具只查历史：end 须早于今天（最近几天上游尚未归档，覆盖核对会如实报告缺失）', { end: args.end });
    }
    if (args.fields !== undefined && (!Array.isArray(args.fields) || !args.fields.length)) throw new ToolError('invalid_param', 'fields 须包含至少一个支持的天气字段');
    const fields: WeatherField[] = [];
    for (const field of args.fields ?? [...WEATHER_FIELDS]) {
      if (!WEATHER_FIELDS.includes(field as WeatherField)) {
        throw new ToolError('invalid_param', `未知字段 ${String(field)}；可用字段：${WEATHER_FIELDS.join('/')}`, { field });
      }
      if (!fields.includes(field as WeatherField)) fields.push(field as WeatherField);
    }

    const request: WeatherRequest = { lat, lon, start: args.start, end: args.end, fields };
    const cached = this.cache.read(request);
    if (cached?.fresh) {
      return this.toResult(request, args.city, cached.entry.daily, { hit: true, fetchedAt: cached.entry.fetchedAt, ageHours: cached.ageHours });
    }
    let fetched: { daily: DailyRecord[] };
    try {
      fetched = await fetchDailyHistory(request, { fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs, signal });
    } catch (error) {
      if (error instanceof WeatherApiError) {
        throw new ToolError(error.code === 'invalid_param' ? 'invalid_param' : 'source_unavailable', error.message.replace(/^invalid_param: |^source_unavailable: /, ''), error.detail);
      }
      throw error;
    }
    const fetchedAt = this.now().toISOString();
    checkCancelled();
    this.cache.write(request, { daily: fetched.daily, fetchedAt });
    return this.toResult(request, args.city, fetched.daily, { hit: false, fetchedAt, ageHours: 0 });
  }

  private toResult(request: WeatherRequest, city: string | undefined, daily: DailyRecord[], cache: HistoryResult['cache']): HistoryResult {
    return {
      source: { provider: 'Open-Meteo Archive API', url: OPEN_METEO_BASE, licenseNote: LICENSE_NOTE },
      timezone: TIMEZONE,
      request: city === undefined ? request : { ...request, city },
      coverage: checkCoverage(daily, request.start, request.end, request.fields),
      daily,
      cache,
    };
  }
}

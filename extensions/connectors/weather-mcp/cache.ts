/** 查询结果缓存：请求指纹内容寻址，原子写入；过期不冒充新数据（过期即重新获取）。
 * 缓存是性能层不是证据层：损坏条目按未命中处理，不阻塞重新获取。 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { WEATHER_FIELDS, type DailyRecord, type WeatherRequest } from './types.ts';

export const DEFAULT_TTL_HOURS = 72;

export interface CacheEntry {
  request: WeatherRequest;
  daily: DailyRecord[];
  fetchedAt: string;
}

export interface CacheRead {
  entry: CacheEntry;
  fresh: boolean;
  ageHours: number;
}

function canonicalRequest(request: WeatherRequest): string {
  return JSON.stringify({
    lat: request.lat,
    lon: request.lon,
    start: request.start,
    end: request.end,
    fields: [...request.fields].sort(),
  });
}

export class WeatherCache {
  private readonly root: string;
  private readonly ttlHours: number;
  private readonly now: () => Date;

  constructor(root: string, options: { ttlHours?: number; now?: () => Date } = {}) {
    this.root = root;
    this.ttlHours = options.ttlHours ?? DEFAULT_TTL_HOURS;
    this.now = options.now ?? (() => new Date());
  }

  keyOf(request: WeatherRequest): string {
    return createHash('sha256').update(canonicalRequest(request)).digest('hex');
  }

  private fileFor(key: string): string {
    return path.join(this.root, 'entries', `${key}.json`);
  }

  read(request: WeatherRequest): CacheRead | undefined {
    const file = this.fileFor(this.keyOf(request));
    let entry: CacheEntry;
    try {
      entry = JSON.parse(readFileSync(file, 'utf8')) as CacheEntry;
      if (!entry || !entry.request || canonicalRequest(entry.request) !== canonicalRequest(request)
        || typeof entry.fetchedAt !== 'string' || !Number.isFinite(Date.parse(entry.fetchedAt)) || !Array.isArray(entry.daily)
        || entry.daily.some(record => !record || typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)
          || new Date(record.date + 'T00:00:00Z').toISOString().slice(0, 10) !== record.date
          || record.date < request.start || record.date > request.end
          || !record.values || typeof record.values !== 'object' || Array.isArray(record.values)
          || request.fields.some(field => !(field in record.values))
          || Object.entries(record.values).some(([key, value]) => !WEATHER_FIELDS.includes(key as never) || (value !== null && (typeof value !== 'number' || !Number.isFinite(value)))))) return undefined;
    } catch {
      return undefined;
    }
    const ageHours = (this.now().getTime() - Date.parse(entry.fetchedAt)) / 3_600_000;
    const fresh = ageHours >= 0 && ageHours <= this.ttlHours;
    return { entry, fresh, ageHours: Math.max(ageHours, 0) };
  }

  write(request: WeatherRequest, payload: { daily: DailyRecord[]; fetchedAt: string }): CacheEntry {
    const entry: CacheEntry = { request, daily: payload.daily, fetchedAt: payload.fetchedAt };
    const file = this.fileFor(this.keyOf(request));
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(entry), { flag: 'wx', mode: 0o600 });
      renameSync(tmp, file);
    } finally { try { unlinkSync(tmp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    return entry;
  }
}

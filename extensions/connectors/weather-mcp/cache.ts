/** 查询结果缓存：请求指纹内容寻址，原子写入；过期不冒充新数据（过期即重新获取）。
 * 缓存是性能层不是证据层：损坏条目按未命中处理，不阻塞重新获取。 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DailyRecord, WeatherRequest } from './types.ts';

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
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, file);
    return entry;
  }
}

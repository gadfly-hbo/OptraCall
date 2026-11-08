/** 天气连接器共享类型与内置城市坐标。
 * 缺失语义：日期缺失＝覆盖清单列出（不造记录）；字段值 null＝API 明示无值（如实保留，不填零）。 */

export const WEATHER_FIELDS = ['temperature_2m_mean', 'precipitation_sum'] as const;
export type WeatherField = (typeof WEATHER_FIELDS)[number];

export interface WeatherRequest {
  lat: number;
  lon: number;
  start: string;
  end: string;
  fields: WeatherField[];
}

export interface DailyRecord {
  date: string;
  values: Partial<Record<WeatherField, number | null>>;
}

export interface CoverageReport {
  expectedCount: number;
  actualCount: number;
  coverage: 'complete' | 'partial';
  missingDates: string[];
  duplicateDates: string[];
  nullValueDates: Partial<Record<WeatherField, string[]>>;
}

/** v1 内置少量常用城市坐标（公开地理事实）；其余城市用经纬度查询 */
export const CITY_PRESETS: Record<string, { lat: number; lon: number }> = {
  上海: { lat: 31.2304, lon: 121.4737 },
  杭州: { lat: 30.2741, lon: 120.1551 },
  湖州: { lat: 30.8671, lon: 120.1023 },
  南京: { lat: 32.0603, lon: 118.7969 },
  北京: { lat: 39.9042, lon: 116.4074 },
  广州: { lat: 23.1291, lon: 113.2644 },
  深圳: { lat: 22.5431, lon: 114.0579 },
  成都: { lat: 30.5728, lon: 104.0668 },
  武汉: { lat: 30.5928, lon: 114.3055 },
  重庆: { lat: 29.563, lon: 106.5516 },
};

export const TIMEZONE = 'Asia/Shanghai';
export const MAX_SPAN_DAYS = 366;

export type ToolErrorCode = 'invalid_param' | 'source_unavailable';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly detail?: unknown;
  constructor(code: ToolErrorCode, message: string, detail?: unknown) {
    super(`${code}: ${message}`);
    this.name = 'ToolError';
    this.code = code;
    this.detail = detail;
  }
}

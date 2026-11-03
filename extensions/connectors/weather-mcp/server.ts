/** MCP server 本体：单工具 weather_history。顶层 schema 用 looseObject 保留未知键，
 * 由实现精确拒绝（对齐标准 v1 与 trade-area 精确键口径）；错误以 isError+信封返回。
 * readOnlyHint 如实标注且不作权限依据；结果携带来源/时区/获取时间/缓存时效。 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { FetchLike } from './open-meteo.ts';
import { WeatherService } from './service.ts';
import { CITY_PRESETS, MAX_SPAN_DAYS, TIMEZONE, ToolError, WEATHER_FIELDS } from './types.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  readonly: true;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'weather_history',
    description: `查询历史日天气（日均温 temperature_2m_mean °C、日降水 precipitation_sum mm，时区固定 ${TIMEZONE}）。定位二选一：city（内置 ${Object.keys(CITY_PRESETS).join('/')}）或经纬度 lat+lon；start/end 为 YYYY-MM-DD（历史区间，跨度 ≤${MAX_SPAN_DAYS} 天）。结果带来源（Open-Meteo Archive，历史观测/再分析，非预报）、获取时间与缓存时效；期望日期与实际返回逐日核对，缺失日期在 coverage.missingDates 如实列出、不填零，字段 null＝上游明示无值。限流/超时返回结构化错误（不自动重试）。适合为经营/选址分析补充天气变量；如何使用天气数据由你自行判断并说明。`,
    readonly: true,
  },
];

export function createWeatherServer(options: { cacheRoot: string; ttlHours?: number; timeoutMs?: number; fetchImpl?: FetchLike }) {
  const service = new WeatherService({ cacheRoot: options.cacheRoot, ttlHours: options.ttlHours, timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl });
  const server = new McpServer({ name: 'weather-mcp', version: '0.1.0' });
  for (const definition of TOOL_DEFINITIONS) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: z.looseObject({
        city: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        start: z.string(),
        end: z.string(),
        fields: z.array(z.string()).optional(),
      }),
      annotations: { title: definition.name, readOnlyHint: true },
    }, async (args: unknown, extra: { signal?: AbortSignal }) => {
      try {
        const result = await service.history(args as never, extra.signal);
        return { structuredContent: result as unknown as Record<string, unknown>, content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        if (error instanceof ToolError) {
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: error.code, message: error.message, detail: error.detail } }) }] };
        }
        throw error;
      }
    });
  }
  return { server, service };
}

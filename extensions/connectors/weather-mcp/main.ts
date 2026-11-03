/** stdio 入口：Host 经 pi SDK registerMcpServer 以 stdio transport 拉起本进程。
 * 缓存根来自 WEATHER_CACHE_ROOT 环境变量（Host 注入）或 --cache-root 参数；
 * 二者皆缺时明确报错退出。网络访问仅限 Open-Meteo Archive 域（适配器内自限）。 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWeatherServer } from './server.ts';

function resolveCacheRoot(): string {
  const flagIndex = process.argv.indexOf('--cache-root');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  const fromEnv = process.env.WEATHER_CACHE_ROOT;
  if (fromEnv) return fromEnv;
  process.stderr.write(`weather-mcp: 缺少缓存根。用 --cache-root <dir> 或环境变量 WEATHER_CACHE_ROOT 指定。\n`);
  process.exit(2);
}

const { server } = createWeatherServer({ cacheRoot: resolveCacheRoot() });
await server.connect(new StdioServerTransport());

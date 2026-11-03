/** Fixed product entry. No environment option replaces the upstream or worker. */
import { runWeatherTransport } from './weather-transport.ts';
const cacheRoot = process.env.WEATHER_CACHE_ROOT;
if (!cacheRoot) throw new Error('weather_cache_root_required');
try { await runWeatherTransport({ cacheRoot }); }
catch (error) { process.stderr.write((error instanceof Error ? error.message : 'weather_transport_failed') + '\n'); process.exitCode = 1; }

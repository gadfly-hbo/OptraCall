import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OPEN_METEO_BASE, buildUrl, fetchDailyHistory } from '../extensions/connectors/weather-mcp/open-meteo.ts';
import { expectedDates, checkCoverage } from '../extensions/connectors/weather-mcp/coverage.ts';
import { WeatherCache } from '../extensions/connectors/weather-mcp/cache.ts';
import { WeatherService } from '../extensions/connectors/weather-mcp/service.ts';
import { CITY_PRESETS, type WeatherRequest } from '../extensions/connectors/weather-mcp/types.ts';
import { createWeatherServer } from '../extensions/connectors/weather-mcp/server.ts';

const REQ = { lat: 30.8671, lon: 120.1023, start: '2025-10-01', end: '2025-10-03', fields: ['temperature_2m_mean', 'precipitation_sum'] as const };

function response(daily: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return { status, headers, text: async () => JSON.stringify({ daily }) };
}

function apiDaily(dates: string[], temp: (number | null)[], precip: (number | null)[]) {
  return { time: dates, temperature_2m_mean: temp, precipitation_sum: precip };
}

function fetchNever(): never {
  throw new Error('network must not be touched in this test');
}

test('coverage checks expected date keys honestly: complete, missing, duplicate, null values', () => {
  assert.deepEqual(expectedDates('2025-10-01', '2025-10-03'), ['2025-10-01', '2025-10-02', '2025-10-03']);
  const complete = checkCoverage([
    { date: '2025-10-01', values: { temperature_2m_mean: 18.2, precipitation_sum: 0 } },
    { date: '2025-10-02', values: { temperature_2m_mean: 19.1, precipitation_sum: 1.5 } },
    { date: '2025-10-03', values: { temperature_2m_mean: null, precipitation_sum: 0.2 } },
  ], '2025-10-01', '2025-10-03', ['temperature_2m_mean', 'precipitation_sum']);
  assert.equal(complete.coverage, 'complete');
  assert.deepEqual(complete.nullValueDates, { temperature_2m_mean: ['2025-10-03'] });

  const partial = checkCoverage([
    { date: '2025-10-02', values: { temperature_2m_mean: 19.1, precipitation_sum: 1.5 } },
  ], '2025-10-01', '2025-10-03', ['temperature_2m_mean', 'precipitation_sum']);
  assert.equal(partial.coverage, 'partial');
  assert.deepEqual(partial.missingDates, ['2025-10-01', '2025-10-03']);

  const duplicated = checkCoverage([
    { date: '2025-10-01', values: {} },
    { date: '2025-10-01', values: {} },
    { date: '2025-10-02', values: {} },
    { date: '2025-10-03', values: {} },
  ], '2025-10-01', '2025-10-03', []);
  assert.deepEqual(duplicated.duplicateDates, ['2025-10-01']);
  assert.equal(duplicated.coverage, 'partial');
});

test('cache keys are stable per request and distinct across fields; entries carry fetchedAt and expire', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-weather-cache-'));
  const cache = new WeatherCache(root, { ttlHours: 72 });
  const key = cache.keyOf(REQ as never);
  assert.equal(key, cache.keyOf({ ...REQ, fields: ['precipitation_sum', 'temperature_2m_mean'] }));
  assert.notEqual(key, cache.keyOf({ ...REQ, fields: ['temperature_2m_mean'] }));
  assert.equal(await cache.read(REQ as never), undefined);
  await cache.write(REQ as never, { daily: [], fetchedAt: '2020-01-01T00:00:00.000Z' });
  const hit = await cache.read(REQ as never);
  assert.equal(hit!.entry.fetchedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(hit!.fresh, false); // 相对默认时钟早已过期
  assert.ok(existsSync(path.join(root, 'entries', `${key}.json`)));
  const fresh = await new WeatherCache(root, { ttlHours: 72, now: () => new Date('2020-01-01T00:30:00Z') }).read(REQ as never);
  assert.equal(fresh!.fresh, true);
  assert.equal(fresh!.entry.daily.length, 0);
});

test('open-meteo adapter builds whitelisted URLs and parses daily payloads', async () => {
  const url = buildUrl(REQ as never);
  assert.ok(url.startsWith(`${OPEN_METEO_BASE}?`));
  assert.ok(url.includes('archive-api.open-meteo.com'));
  assert.ok(url.includes('timezone=Asia%2FShanghai'));
  const parsed = await fetchDailyHistory(REQ as never, { fetchImpl: async () => response(apiDaily(['2025-10-01'], [17.5], [0])) });
  assert.deepEqual(parsed.daily, [{ date: '2025-10-01', values: { temperature_2m_mean: 17.5, precipitation_sum: 0 } }]);
});

test('adapter classifies upstream failures: 429+Retry-After, 400, 5xx, timeout', async () => {
  const limited = await fetchDailyHistory(REQ as never, { fetchImpl: async () => response({}, 429, { 'retry-after': '37' }) }).catch(error => error);
  assert.equal(limited.code, 'source_unavailable');
  assert.equal(limited.detail.reason, 'rate_limited');
  assert.equal(limited.detail.retryAfterSeconds, 37);

  const bad = await fetchDailyHistory(REQ as never, { fetchImpl: async () => ({ status: 400, headers: {}, text: async () => JSON.stringify({ error: true, reason: 'Start date too early' }) }) }).catch(error => error);
  assert.equal(bad.code, 'invalid_param');
  assert.ok(bad.message.includes('Start date too early'));

  const upstream = await fetchDailyHistory(REQ as never, { fetchImpl: async () => response({}, 503) }).catch(error => error);
  assert.equal(upstream.detail.reason, 'upstream_error');

  const timedOut = await fetchDailyHistory(REQ as never, {
    timeoutMs: 20,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }),
  }).catch(error => error);
  assert.equal(timedOut.code, 'source_unavailable');
  assert.equal(timedOut.detail.reason, 'timeout');
});

function makeService(overrides: Record<string, unknown> = {}) {
  const cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-weather-service-'));
  return { cacheRoot, service: new WeatherService({ cacheRoot, timeoutMs: 1000, ...overrides }) };
}

test('service validates city/coords/date parameters with structured envelopes', async () => {
  const { service } = makeService();
  assert.deepEqual(CITY_PRESETS['湖州'], { lat: 30.8671, lon: 120.1023 });
  await assert.rejects(() => service.history({ city: '不存在市', start: '2025-10-01', end: '2025-10-02' }), /invalid_param/);
  await assert.rejects(() => service.history({ lat: 30.8, start: '2025-10-01', end: '2025-10-02' }), /invalid_param/);
  await assert.rejects(() => service.history({ city: '湖州', lat: 1, lon: 2, start: '2025-10-01', end: '2025-10-02' }), /invalid_param/);
  await assert.rejects(() => service.history({ lat: 999, lon: 120, start: '2025-10-01', end: '2025-10-02' }), /invalid_param/);
  await assert.rejects(() => service.history({ lat: 30.8, lon: 120.1, start: '2025-10-05', end: '2025-10-01' }), /invalid_param/);
  await assert.rejects(() => service.history({ lat: 30.8, lon: 120.1, start: '2030-01-01', end: '2030-01-02' }), /invalid_param/);
  await assert.rejects(() => service.history({ lat: 30.8, lon: 120.1, start: '2023-01-01', end: '2024-06-01' }), /invalid_param/);
  await assert.rejects(() => service.history({ lat: 30.8, lon: 120.1, start: '2025-10-01', end: '2025-10-02', fields: ['wind'] }), /invalid_param/);
});

test('service answers from fresh cache without network, marks cache identity honestly', async () => {
  const { service } = makeService({ fetchImpl: fetchNever });
  const seeded = new WeatherCache(mkdtempSync(path.join(os.tmpdir(), 'optracall-weather-seed-')));
  // 先经 service 落缓存（用合成 fetch），再验证第二次命中缓存不走网络
  const synthetic = makeService({ fetchImpl: async () => response(apiDaily(['2025-10-01', '2025-10-02'], [17.5, 18.1], [0, 2.3])), ttlHours: 72 });
  const first = await synthetic.service.history({ city: '湖州', start: '2025-10-01', end: '2025-10-02' });
  assert.equal(first.cache.hit, false);
  assert.equal(first.coverage.coverage, 'complete');
  assert.equal(first.source.provider, 'Open-Meteo Archive API');
  assert.equal(first.timezone, 'Asia/Shanghai');
  assert.equal(first.request.lat, CITY_PRESETS['湖州'].lat);
  const second = await synthetic.service.history({ city: '湖州', start: '2025-10-01', end: '2025-10-02' });
  assert.equal(second.cache.hit, true);
  assert.equal(second.cache.fetchedAt, first.cache.fetchedAt);
  assert.deepEqual(second.daily, first.daily);
  assert.ok(second.cache.ageHours >= 0);
  void seeded;
});

test('service reports partial coverage and null values without zero-filling', async () => {
  const { service } = makeService({ fetchImpl: async () => response(apiDaily(['2025-10-01', '2025-10-03'], [17.5, null], [0, 0.4])) });
  const result = await service.history({ lat: 30.8, lon: 120.1, start: '2025-10-01', end: '2025-10-03' });
  assert.equal(result.coverage.coverage, 'partial');
  assert.deepEqual(result.coverage.missingDates, ['2025-10-02']);
  assert.deepEqual(result.coverage.nullValueDates, { temperature_2m_mean: ['2025-10-03'] });
  assert.equal(result.daily.find(day => day.date === '2025-10-02'), undefined);
  assert.equal(result.daily.find(day => day.date === '2025-10-03')!.values.temperature_2m_mean, null);
  assert.ok(result.source.licenseNote.length > 0);
});

test('stale cache triggers refetch instead of impersonating fresh data', async () => {
  let calls = 0;
  const cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-weather-stale-'));
  const seeder = new WeatherCache(cacheRoot, { ttlHours: 72 });
  const request: WeatherRequest = { lat: 30.8, lon: 120.1, start: '2025-10-01', end: '2025-10-01', fields: ['temperature_2m_mean', 'precipitation_sum'] };
  await seeder.write(request, { daily: [{ date: '2025-10-01', values: { temperature_2m_mean: 1, precipitation_sum: 1 } }], fetchedAt: new Date('2020-01-01T00:00:00Z').toISOString() });
  const service = new WeatherService({ cacheRoot, timeoutMs: 1000, fetchImpl: async () => { calls++; return response(apiDaily(['2025-10-01'], [22.5], [0])); } });
  const result = await service.history({ lat: 30.8, lon: 120.1, start: '2025-10-01', end: '2025-10-01' });
  assert.equal(calls, 1);
  assert.equal(result.cache.hit, false);
  assert.equal(result.daily[0].values.temperature_2m_mean, 22.5);
});

test('server exposes one read-only tool over MCP with structured results and precise key rejection', async () => {
  const { server } = createWeatherServer({
    cacheRoot: mkdtempSync(path.join(os.tmpdir(), 'optracall-weather-mcp-')),
    timeoutMs: 1000,
    fetchImpl: async () => response(apiDaily(['2025-10-01', '2025-10-02'], [17.5, 18.1], [0, 2.3])),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name), ['weather_history']);
  assert.equal(tools.tools[0]!.annotations?.readOnlyHint, true);
  assert.ok((tools.tools[0]!.description ?? '').includes('Open-Meteo'));

  const call = await client.callTool({ name: 'weather_history', arguments: { city: '湖州', start: '2025-10-01', end: '2025-10-02' } });
  const payload = call.structuredContent as any;
  assert.equal(payload.coverage.coverage, 'complete');
  assert.equal(payload.source.provider, 'Open-Meteo Archive API');

  const bad = await client.callTool({ name: 'weather_history', arguments: { city: '湖州', start: '2025-10-01', end: '2025-10-02', surprise: 1 } });
  assert.equal(bad.isError, true);
  const envelope = JSON.parse((bad.content as any[]).find(part => part.type === 'text').text);
  assert.equal(envelope.error.code, 'invalid_param');

  // 缺必需顶级字段由 SDK schema 校验拒绝（协议级错误，不进入工具回调）——标准 §3 边界
  const missingStart = await client.callTool({ name: 'weather_history', arguments: { city: '湖州', end: '2025-10-02' } });
  assert.equal(missingStart.isError, true);
  assert.ok((missingStart.content as any[]).some(part => part.type === 'text' && /MCP error/.test(part.text)));
  await client.close();
  await server.close();
});

test('stdio server serves pre-warmed cache without network', async () => {
  const cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-weather-stdio-'));
  const cache = new WeatherCache(cacheRoot, { ttlHours: 72, now: () => new Date() });
  const request: WeatherRequest = { lat: CITY_PRESETS['湖州'].lat, lon: CITY_PRESETS['湖州'].lon, start: '2025-10-01', end: '2025-10-01', fields: ['temperature_2m_mean', 'precipitation_sum'] };
  await cache.write(request, { daily: [{ date: '2025-10-01', values: { temperature_2m_mean: 21.3, precipitation_sum: 0 } }], fetchedAt: new Date().toISOString() });
  const child = spawn('node', ['extensions/connectors/weather-mcp/main.ts', '--cache-root', cacheRoot], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buffer = '';
  const pending = new Map<number, (message: any) => void>();
  let nextId = 1;
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) { pending.get(message.id)!(message); pending.delete(message.id); }
    }
  });
  const call = (method: string, params: unknown) => new Promise<any>(resolve => { const id = nextId++; pending.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const result = await call('tools/call', { name: 'weather_history', arguments: { city: '湖州', start: '2025-10-01', end: '2025-10-01' } });
  const payload = JSON.parse(result.result.content[0].text);
  assert.equal(payload.cache.hit, true);
  assert.equal(payload.daily[0].values.temperature_2m_mean, 21.3);
  child.kill();
});

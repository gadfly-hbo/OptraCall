import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, cp, symlink, writeFile, readFile, stat, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { WeatherCache } from '../extensions/connectors/weather-mcp/cache.ts';
import { CITY_PRESETS } from '../extensions/connectors/weather-mcp/types.ts';

async function waitFor(check: () => boolean | Promise<boolean>, reason: string) {
  const deadline = Date.now() + 10_000;
  while (!await check()) { if (Date.now() > deadline) assert.fail(reason); await new Promise(resolve => setTimeout(resolve, 30)); }
}
function weatherChildren(hostPid: number): number[] {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : [];
  });
  const descendants = new Set([hostPid]);
  for (let i = 0; i < rows.length; i++) { const size = descendants.size; for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid); if (size === descendants.size) break; }
  return rows.filter(row => descendants.has(row.pid) && /\/src\/agent\/weather-(mcp-entry|worker)\.ts/.test(row.command)).map(row => row.pid);
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } }

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text()); return response.json();
}
async function settled(host: Awaited<ReturnType<typeof startTestHost>>, route: string, id: string) {
  const deadline = Date.now() + 45_000;
  for (;;) {
    const value = await json(await host.request(route));
    if (value.task.lastRun?.id === id && value.task.lastRun.status !== 'running') { assert.equal(value.task.lastRun.status, 'completed', JSON.stringify(value.task.lastRun)); return value; }
    if (Date.now() > deadline) assert.fail('Synthetic weather task did not settle');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

test('WX01: an actual Host SDK stdio task reads weather from the isolated worker and quotes the source', { skip: process.platform !== 'darwin' }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  const cache = new WeatherCache(path.join(host.dataRoot, 'connectors/weather'));
  cache.write({ ...CITY_PRESETS['湖州'], start: '2025-10-01', end: '2025-10-01', fields: ['temperature_2m_mean', 'precipitation_sum'] }, { fetchedAt: new Date().toISOString(), daily: [{ date: '2025-10-01', values: { temperature_2m_mean: 12.5, precipitation_sum: 0.25 } }] });
  await json(await host.request('/api/configuration', 'PUT', { name: '合成天气配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-weather', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成天气引用' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '天气普通任务', weatherTools: true }), 201);
  const toolName = 'mcp__weather_mcp__weather_history';
  provider.setResponder(context => {
    if (!context.availableTools.includes(toolName)) return { text: '合成探针：缺少天气工具。' };
    if (context.requestNumber === 1) return { calls: [{ name: toolName, arguments: { city: '湖州', start: '2025-10-01', end: '2025-10-01' } }] };
    return { text: '合成引用：Open-Meteo Archive，本地缓存的2025-10-01日均温12.5°C、降水0.25mm，仅为合成数据。' };
  });
  const route = `/api/projects/${project.id}/tasks/${task.id}`, requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '查询并注明天气来源（合成验证）', requestId }), 202);
  const final = await settled(host, route, requestId);
  assert.ok((provider.requests[0].body.tools ?? []).some(tool => tool.function?.name === toolName), 'first actual SDK request must expose the opt-in weather tool');
  assert.equal(provider.requests.length, 2);
  const result = JSON.parse(providerMessageText(provider.requests[1].body.messages!.find(message => message.role === 'tool')!.content));
  assert.equal(result.cache.hit, true); assert.equal(result.source.provider, 'Open-Meteo Archive API');
  assert.equal(result.daily[0].values.temperature_2m_mean, 12.5); assert.equal(result.daily[0].values.precipitation_sum, 0.25);
  assert.equal(result.coverage.coverage, 'complete'); assert.ok(final.snapshot.tools.includes(toolName));
});

test('WX06: Host persists independent weather choice and enforces capability and archive admission', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '合成天气配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9', model: 'synthetic-weather', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成天气任务项目' }), 201);
  const tasks = `/api/projects/${project.id}/tasks`;
  const { task } = await json(await host.request(tasks, 'POST', { name: '天气选择', simulationTools: true, tradeAreaTools: true, weatherTools: true }), 201);
  assert.equal(task.weatherTools, true);
  const route = `${tasks}/${task.id}`;
  const { task: off } = await json(await host.request(route + '/capabilities', 'PUT', { capability: 'weatherTools', enabled: false }));
  assert.equal(off.weatherTools, undefined); assert.equal(off.tradeAreaTools, true); assert.equal(off.simulationTools, true);
  await json(await host.request(tasks, 'POST', { name: '非法开关', weatherTools: 'true' }), 400);
  await json(await host.request(route + '/capabilities', 'PUT', { capability: 'unknownTools', enabled: true }), 400);
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.equal((await json(await host.request(route + '/capabilities', 'PUT', { capability: 'weatherTools', enabled: true }), 409)).code, 'project_archived');
  assert.equal((await json(await host.request(route))).task.weatherTools, undefined);
});


test('WX01/04: actual Host SDK and restricted stdio perform miss, fresh hit and expired refetch using a trusted synthetic upstream', { skip: process.platform !== 'darwin' }, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-weather-sdk-upstream-'));
  const codeRoot = path.join(scratch, 'code'), agentRoot = path.join(codeRoot, 'src/agent'), counter = path.join(scratch, 'upstream-requests.jsonl');
  await mkdir(codeRoot, { recursive: true });
  for (const directory of ['src', 'scripts', 'extensions']) await cp(path.resolve(directory), path.join(codeRoot, directory), { recursive: true });
  await cp(path.resolve('package.json'), path.join(codeRoot, 'package.json'));
  await symlink(await realpath(path.resolve('node_modules')), path.join(codeRoot, 'node_modules'), 'dir');
  // Test-owned trusted Host entry, never a production env or worker bypass. Q still has no network/process privileges.
  await writeFile(path.join(agentRoot, 'weather-mcp-entry.ts'), `import {appendFileSync} from 'node:fs'; import {runWeatherTransport} from './weather-transport.ts'; await runWeatherTransport({cacheRoot:process.env.WEATHER_CACHE_ROOT!,upstreamFetch:async(url,{signal})=>{signal.throwIfAborted();appendFileSync(${JSON.stringify(counter)},JSON.stringify({url})+'\\n');return {status:200,headers:{},text:async()=>JSON.stringify({daily:{time:['2025-10-01'],temperature_2m_mean:[18.5],precipitation_sum:[2.25]}})};}});`);
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000, cwd: codeRoot }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '合成上游', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-weather', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成缓存链路' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '天气查询', weatherTools: true }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  provider.setResponder(context => context.requestNumber % 2 === 1 ? { calls: [{ name: 'mcp__weather_mcp__weather_history', arguments: { city: '湖州', start: '2025-10-01', end: '2025-10-01' } }] } : { text: '合成分析引用 Open-Meteo Archive：18.5°C、2.25mm，数据仅作合成验证。' });
  const payloads: any[] = [];
  for (let turn = 0; turn < 3; turn++) {
    if (turn === 2) {
      const cache = new WeatherCache(path.join(host.dataRoot, 'connectors/weather'));
      const request = { ...CITY_PRESETS['湖州'], start: '2025-10-01', end: '2025-10-01', fields: ['temperature_2m_mean', 'precipitation_sum'] as any };
      const entry = cache.read(request)!.entry;
      cache.write(request, { daily: entry.daily, fetchedAt: '2020-01-01T00:00:00Z' });
    }
    const id = randomUUID(); await json(await host.request(route + '/messages', 'POST', { text: '合成天气查询并引用', requestId: id }), 202); await settled(host, route, id);
    const messages = provider.requests.at(-1)!.body.messages!;
    payloads.push(JSON.parse(providerMessageText(messages.filter(message => message.role === 'tool').at(-1)!.content)));
    assert.equal((await readFile(counter, 'utf8')).trim().split('\n').length, turn === 0 ? 1 : turn === 1 ? 1 : 2);
  }
  assert.deepEqual(payloads.map(value => value.cache.hit), [false, true, false]);
  assert.deepEqual(payloads.map(value => value.coverage.coverage), ['complete', 'complete', 'complete']);
  assert.equal(payloads[1].cache.fetchedAt, payloads[0].cache.fetchedAt);
  assert.equal(payloads[2].daily[0].values.precipitation_sum, 2.25);
  assert.equal(provider.requests.length, 6);
});

test('WX06: default off, collisions, busy rejection, stop reuse and SDK close preserve native history and retire both weather processes', { skip: process.platform !== 'darwin' }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  const marker = path.join(host.scratch, 'untrusted-weather-collision');
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/mcp.json'), JSON.stringify({ mcpServers: {
    weather_mcp: { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'untrusted')`], exposure: 'direct' },
    'unrelated-weather-library': { command: process.execPath, args: [path.resolve('extensions/connectors/weather-mcp/main.ts'), '--cache-root', path.join(host.scratch, 'unused-cache')], exposure: 'direct' },
  } }));
  await json(await host.request('/api/configuration', 'PUT', { name: '合成生命周期', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-weather', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成天气开关' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '默认普通任务' }), 201);
  assert.equal(task.weatherTools, undefined);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  provider.setResponder(() => ({ text: '合成普通回复' }));
  const firstId = randomUUID(); await json(await host.request(route + '/messages', 'POST', { text: '关闭天气的对话', requestId: firstId }), 202);
  const first = await settled(host, route, firstId), nativeFile = first.task.sessionFile, prefix = await readFile(nativeFile);
  const names = (provider.requests[0].body.tools ?? []).map(tool => tool.function?.name);
  assert.ok(!names.includes('mcp__weather_mcp__weather_history'));
  assert.ok(names.includes('mcp__unrelated_weather_library__weather_history'), 'unrelated configured MCP must remain loaded');
  await assert.rejects(stat(marker), { code: 'ENOENT' }); assert.deepEqual(weatherChildren(host.pid), []);
  await json(await host.request(route + '/capabilities', 'PUT', { capability: 'weatherTools', enabled: true }));
  const enabledId = randomUUID(); await json(await host.request(route + '/messages', 'POST', { text: '启用天气后的对话', requestId: enabledId }), 202);
  const enabled = await settled(host, route, enabledId); assert.ok(enabled.snapshot.tools.includes('mcp__weather_mcp__weather_history'));
  assert.equal(enabled.task.sessionFile, nativeFile); assert.ok((await readFile(nativeFile)).subarray(0, prefix.length).equals(prefix));
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  const children = weatherChildren(host.pid); assert.equal(children.length, 2, 'one SDK-owned Host P and restricted worker Q');
  provider.setResponder(() => ({ text: '保持合成在途请求', hold: true }));
  const held = randomUUID(); await json(await host.request(route + '/messages', 'POST', { text: '保持在途', requestId: held }), 202); await provider.waitForRequests(3);
  assert.equal((await json(await host.request(route + '/capabilities', 'PUT', { capability: 'weatherTools', enabled: false }), 409)).code, 'session_busy');
  await json(await host.request(route + '/stop', 'POST', {}));
  await waitFor(async () => (await json(await host.request(route))).task.lastRun.status === 'cancelled', 'stop must settle without replay');
  assert.ok(children.every(alive), 'ordinary stop retains the actual reusable P/Q session');
  await json(await host.request(route + '/capabilities', 'PUT', { capability: 'weatherTools', enabled: false }));
  await waitFor(() => children.every(pid => !alive(pid)), 'common SDK close must retire both P and Q');
  provider.setResponder(() => ({ text: '关闭后的合成回复' }));
  const lastId = randomUUID(); await json(await host.request(route + '/messages', 'POST', { text: '原会话继续', requestId: lastId }), 202); const last = await settled(host, route, lastId);
  assert.equal(last.task.sessionFile, nativeFile); assert.ok((await readFile(nativeFile)).subarray(0, prefix.length).equals(prefix));
  assert.ok(!last.snapshot.tools.includes('mcp__weather_mcp__weather_history')); assert.equal(provider.requests.length, 4);
});

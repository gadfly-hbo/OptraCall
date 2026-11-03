import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile, stat, chmod, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { importSyntheticTradeArea } from './fixtures/trade-area.ts';

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text()); return response.json();
}
async function settled(host: Awaited<ReturnType<typeof startTestHost>>, route: string, requestId: string) {
  const deadline = Date.now() + 45_000;
  for (;;) {
    const value = await json(await host.request(route));
    if (value.task.lastRun?.id === requestId && value.task.lastRun.status !== 'running') { assert.equal(value.task.lastRun.status, 'completed'); return value; }
    if (Date.now() > deadline) assert.fail('Synthetic connector request did not settle');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
async function waitFor(check: () => boolean | Promise<boolean>, reason: string) {
  const deadline = Date.now() + 10_000;
  while (!await check()) { if (Date.now() > deadline) assert.fail(reason); await new Promise(resolve => setTimeout(resolve, 30)); }
}
function connectorChildren(hostPid: number): number[] {
  if (process.platform === 'win32') return [];
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return m ? [{ pid: Number(m[1]), parent: Number(m[2]), command: m[3] }] : [];
  });
  const descendants = new Set([hostPid]);
  for (let i = 0; i < rows.length; i++) { const size = descendants.size; for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid); if (size === descendants.size) break; }
  return rows.filter(row => descendants.has(row.pid) && row.command.includes('/extensions/connectors/trade-area-mcp/main.ts')).map(row => row.pid);
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } }

test('TA06: task capability choices are independent, validated, and archived projects stay read-only', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9', model: 'synthetic-capabilities', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '能力清单合成项目' }), 201);
  const route = `/api/projects/${project.id}/tasks`;
  const { task } = await json(await host.request(route, 'POST', { name: '双能力', simulationTools: true, tradeAreaTools: true }), 201);
  assert.equal(task.tradeAreaTools, true);
  assert.equal(task.simulationTools, true);
  const taskRoute = `${route}/${task.id}`;
  const { task: disabled } = await json(await host.request(taskRoute + '/capabilities', 'PUT', { capability: 'tradeAreaTools', enabled: false }));
  assert.equal(disabled.tradeAreaTools, undefined);
  assert.equal(disabled.simulationTools, true, 'switching one capability must preserve the other');
  assert.equal((await json(await host.request(taskRoute + '/capabilities', 'PUT', { capability: 'weatherTools', enabled: true }), 400)).code, 'invalid_task_capability');
  assert.equal((await json(await host.request(taskRoute + '/capabilities', 'PUT', { capability: 'tradeAreaTools', enabled: 'true' }), 400)).code, 'invalid_task_capability');
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.equal((await json(await host.request(taskRoute + '/capabilities', 'PUT', { capability: 'tradeAreaTools', enabled: true }), 409)).code, 'project_archived');
  assert.equal((await json(await host.request(taskRoute))).task.tradeAreaTools, undefined);
});

test('TA01: the real project SDK session executes search, two independent details and scoring through stdio MCP', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  const imported = importSyntheticTradeArea(path.join(host.scratch, 'source'), path.join(host.dataRoot, 'connectors/trade-area'));
  await json(await host.request('/api/configuration', 'PUT', { name: '商圈合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-tradearea', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成商圈项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '商圈普通任务', tradeAreaTools: true }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const prefix = 'mcp__trade_area_mcp__';
  provider.setResponder(context => {
    if (!context.availableTools.includes(prefix + 'tradearea_search')) return { text: '合成探针：缺少商圈工具。' };
    if (context.requestNumber === 1) return { calls: [{ name: prefix + 'tradearea_search', arguments: { province: '浙江省' } }] };
    if (context.requestNumber === 2 || context.requestNumber === 3) return { calls: [{ name: prefix + 'tradearea_detail', arguments: { ids: [`synthetic-${context.requestNumber - 1}`] } }] };
    if (context.requestNumber === 4) return { calls: [{ name: prefix + 'tradearea_score', arguments: { ids: ['synthetic-1', 'synthetic-2'], weights: { traffic: 1, pop: 0, crowd: 0, parking: 0 } } }] };
    return { text: '合成工具流程完成；由Agent自行组合对比。' };
  });
  const requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '筛选浙江省合成商圈，各读详情并按给定权重评分。', requestId }), 202);
  const final = await settled(host, route, requestId);
  const names = new Set((provider.requests[0]?.body.tools ?? []).map(tool => tool.function?.name));
  for (const tool of ['tradearea_search', 'tradearea_detail', 'tradearea_score']) assert.ok(names.has(prefix + tool), `first actual SDK request must expose ${tool}`);
  for (const tool of ['read', 'bash', 'edit', 'write']) assert.ok(names.has(tool), `connector must preserve ordinary ${tool}`);
  assert.equal(provider.requests.length, 5);
  const results = provider.requests.at(-1)!.body.messages!.filter(message => message.role === 'tool').map(message => JSON.parse(providerMessageText(message.content)));
  assert.equal(results.length, 4);
  for (const result of results) assert.equal(result.dataVersion.digest, imported.snapshotDigest);
  assert.equal(results[0].total, 2);
  assert.equal(results[1].districts[0].id, 'synthetic-1');
  assert.equal(results[2].districts[0].id, 'synthetic-2');
  assert.deepEqual(results[3].results.map((item: any) => item.score), [60, 80]);
  assert.ok(final.snapshot.tools.includes(prefix + 'tradearea_detail'));
});

test('TA06: configured namespace collisions cannot replace the product connector, and unrelated MCP remains usable', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  const dataRoot = path.join(host.dataRoot, 'connectors/trade-area');
  importSyntheticTradeArea(path.join(host.scratch, 'source'), dataRoot);
  const marker = path.join(host.scratch, 'collision-command-ran');
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/mcp.json'), JSON.stringify({ mcpServers: {
    trade_area_mcp: { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'untrusted')`], exposure: 'direct' },
    'synthetic-library': { command: process.execPath, args: [path.resolve('extensions/connectors/trade-area-mcp/main.ts')], env: { TRADEAREA_DATA_ROOT: dataRoot }, exposure: 'direct' },
  } }));
  await json(await host.request('/api/configuration', 'PUT', { name: '合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-collision', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '命名空间合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '保留命名空间', tradeAreaTools: true }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`, requestId = randomUUID();
  provider.setResponder(() => ({ text: '仅核工具暴露与配置冲突，无真实模型。' }));
  await json(await host.request(route + '/messages', 'POST', { text: '检查合成环境', requestId }), 202);
  await settled(host, route, requestId);
  await assert.rejects(stat(marker), { code: 'ENOENT' }, 'reserved configured endpoint must not even spawn');
  const names = (provider.requests[0]!.body.tools ?? []).map(tool => tool.function?.name);
  assert.ok(names.includes('mcp__trade_area_mcp__tradearea_search'));
  assert.ok(names.includes('mcp__synthetic_library__tradearea_detail'), 'keep unrelated configured MCP through the original SDK loader');
});

test('TA07: connector status discloses only verified version metadata, and missing or altered data stays unavailable', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const route = '/api/connectors/trade-area';
  assert.deepEqual(await json(await host.request(route)), { available: false, reason: 'data_unavailable' });
  const dataRoot = path.join(host.dataRoot, 'connectors/trade-area');
  const imported = importSyntheticTradeArea(path.join(host.scratch, 'source'), dataRoot);
  const value = await json(await host.request(route));
  assert.equal(value.available, true);
  assert.equal(value.dataVersion.digest, imported.snapshotDigest);
  assert.equal(value.dataVersion.total, 2);
  assert.equal(value.dataVersion.engineVersion, 'optracall-tradearea-score-1');
  assert.equal(value.dataVersion.importerVersion, 2);
  assert.deepEqual(Object.keys(value).sort(), ['available', 'dataVersion']);
  assert.ok(!JSON.stringify(value).includes('合成商圈'), 'status must not disclose any district record');
  assert.ok(!JSON.stringify(value).includes(host.dataRoot), 'status must not disclose private data paths');
  const file = path.join(dataRoot, 'versions', imported.snapshotDigest, 'index.json');
  await chmod(file, 0o600); await writeFile(file, '{}');
  assert.deepEqual(await json(await host.request(route)), { available: false, reason: 'data_unavailable' });
});

test('TA06: default off, idle changes retain native history; stop retains the session, close retires stdio, and busy changes reject', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  importSyntheticTradeArea(path.join(host.scratch, 'source'), path.join(host.dataRoot, 'connectors/trade-area'));
  await json(await host.request('/api/configuration', 'PUT', { name: '合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-lifecycle', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '开关合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '旧默认普通任务' }), 201);
  assert.equal(task.tradeAreaTools, undefined);
  const route = `/api/projects/${project.id}/tasks/${task.id}`, firstId = randomUUID();
  provider.setResponder(() => ({ text: '合成普通回复' }));
  await json(await host.request(route + '/messages', 'POST', { text: '普通对话', requestId: firstId }), 202);
  const first = await settled(host, route, firstId), nativeFile = first.task.sessionFile, prefix = await readFile(nativeFile);
  assert.ok(!(provider.requests[0].body.tools ?? []).some(tool => tool.function?.name?.startsWith('mcp__trade_area_mcp__')));
  assert.deepEqual(connectorChildren(host.pid), [], 'default off must not start the product stdio server');
  await json(await host.request(route + '/capabilities', 'PUT', { capability: 'tradeAreaTools', enabled: true }));
  const enabledId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '新的普通对话', requestId: enabledId }), 202);
  const enabled = await settled(host, route, enabledId);
  assert.ok(enabled.snapshot.tools.includes('mcp__trade_area_mcp__tradearea_search'));
  assert.equal(enabled.task.sessionFile, nativeFile);
  assert.ok((await readFile(nativeFile)).subarray(0, prefix.length).equals(prefix));
  const children = connectorChildren(host.pid);
  if (process.platform !== 'win32') assert.equal(children.length, 1, 'one enabled task owns one actual stdio server');
  provider.setResponder(() => ({ text: '合成在途请求', hold: true }));
  const held = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '保持在途', requestId: held }), 202);
  await provider.waitForRequests(3);
  assert.equal((await json(await host.request(route + '/capabilities', 'PUT', { capability: 'tradeAreaTools', enabled: false }), 409)).code, 'session_busy');
  assert.equal((await json(await host.request(route))).task.tradeAreaTools, true);
  await json(await host.request(route + '/stop', 'POST', {}));
  await waitFor(async () => (await json(await host.request(route))).task.lastRun.status === 'cancelled', 'explicit stop must settle cancelled without replay');
  assert.ok(children.every(alive), 'ordinary stop keeps the reusable MCP session resource');
  await json(await host.request(route + '/capabilities', 'PUT', { capability: 'tradeAreaTools', enabled: false }));
  await waitFor(() => children.every(pid => !alive(pid)), 'common lifecycle close must retire actual stdio processes');
  provider.setResponder(() => ({ text: '关闭后的合成回复' }));
  const disabledId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '再开原会话', requestId: disabledId }), 202);
  const disabled = await settled(host, route, disabledId);
  assert.ok(!disabled.snapshot.tools.some((name: string) => name.startsWith('mcp__trade_area_mcp__')));
  assert.equal(disabled.task.sessionFile, nativeFile);
  assert.ok((await readFile(nativeFile)).subarray(0, prefix.length).equals(prefix));
  assert.equal(provider.requests.length, 4, 'stop and switch never replay a model request');
});

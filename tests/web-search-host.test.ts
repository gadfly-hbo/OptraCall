import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createHost } from '../src/host/server.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

const settingsRoute = '/api/web-search/settings';
const miniMaxSearch = 'https://api.minimaxi.com/v1/coding_plan/search';
const deepSeekSearch = 'https://api.deepseek.com/v1/tools/search';
const deepSeekFetch = 'https://api.deepseek.com/v1/tools/fetch';
const model = 'synthetic-web-search-analysis';
const miniMaxKey = 'synthetic-web-minimax-credential';
const deepSeekKey = 'synthetic-web-deepseek-credential';
const sourceUrl = 'https://example.com/releases';
const query = 'synthetic release source';

async function startHost(root: string, webSearchFetch: typeof fetch) {
  const host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: 'synthetic-web-search-test',
    dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects'), webSearchFetch });
  await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  async function request(route: string, method = 'GET', body?: unknown, status = 200): Promise<any> {
    const response = await fetch(baseUrl + route, { method, signal: AbortSignal.timeout(5_000),
      headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: baseUrl },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return JSON.parse(text);
  }
  return { request, close: host.close };
}

type Host = Awaited<ReturnType<typeof startHost>>;

async function seedSearchCredentials(host: Host) {
  await host.request('/api/configuration/import', 'POST', { credentials: {
    'minimax-cn': { type: 'api_key', key: miniMaxKey }, deepseek: { type: 'api_key', key: deepSeekKey },
  } });
}

async function createTask(host: Host, baseUrl: string) {
  const { configuration } = await host.request('/api/configuration', 'PUT', { name: 'Synthetic analysis model', provider: 'openai-compatible',
    baseUrl, model, apiKey: 'synthetic-web-analysis-only' });
  const { project } = await host.request('/api/projects', 'POST', { name: 'Synthetic web-search project' }, 201);
  const tasksRoute = `/api/projects/${project.id}/tasks`;
  const { task } = await host.request(tasksRoute, 'POST', { name: 'Synthetic web-search task' }, 201);
  assert.equal(task.configuration.id, configuration.id);
  return { configuration, projectRoute: `/api/projects/${project.id}`, route: `${tasksRoute}/${task.id}` };
}

async function settled(host: Host, route: string, requestId: string) {
  const deadline = Date.now() + 15_000;
  do {
    const state = await host.request(route);
    if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') return state;
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail('The synthetic Host task did not settle.');
}

test('Host/Pi 实际任务按设置派发搜索和网页读取，并在重启后读回原生回执', { timeout: 30_000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-web-search-host-')));
  const provider = await startToolProvider();
  const upstream: { url: string; body: unknown }[] = [];
  const webSearchFetch: typeof fetch = async (target, init) => {
    const url = String(target), body = JSON.parse(String(init?.body));
    upstream.push({ url, body });
    assert.equal(init?.method, 'POST');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    if (url === deepSeekSearch) {
      assert.equal(headers.get('authorization'), `Bearer ${deepSeekKey}`);
      return Response.json({ error: { message: `upstream error ${deepSeekKey}` } }, { status: 429 });
    }
    if (url === miniMaxSearch) {
      assert.equal(headers.get('authorization'), `Bearer ${miniMaxKey}`);
      assert.equal(headers.get('MM-API-Source'), 'Minimax-MCP');
      return Response.json({ base_resp: { status_code: 0 }, organic: [
        { title: 'Synthetic release notes', link: sourceUrl, snippet: 'Synthetic excerpt', date: '2026-11-10' },
      ] });
    }
    assert.equal(url, deepSeekFetch, 'only configured search endpoints may receive a request');
    assert.equal(headers.get('authorization'), `Bearer ${deepSeekKey}`);
    return Response.json({ title: 'Synthetic release notes', content: '# Synthetic release\n\nBody from the fixture.' });
  };
  let host: Host | undefined;
  t.after(async () => { await host?.close(); await provider.close(); await rm(root, { recursive: true, force: true }); });
  host = await startHost(root, webSearchFetch);

  assert.deepEqual(await host.request(settingsRoute), {
    order: ['minimax', 'deepseek'], configured: { minimax: false, deepseek: false },
  });
  await seedSearchCredentials(host);
  const expectedSettings = { order: ['deepseek', 'minimax'], configured: { minimax: true, deepseek: true } };
  assert.deepEqual(await host.request(settingsRoute, 'PUT', { order: expectedSettings.order }), expectedSettings);
  assert.equal((await host.request(settingsRoute, 'PUT', { order: ['minimax', 'minimax'] }, 400)).code, 'invalid_search_order');
  assert.deepEqual(await host.request(settingsRoute), expectedSettings);
  const { configuration, route } = await createTask(host, provider.baseUrl);
  assert.deepEqual(upstream, [], 'settings and model configuration are local operations');
  assert.deepEqual(provider.requests, []);

  const receipts: unknown[] = [];
  provider.setResponder(context => {
    assert.equal(context.request.body.model, model);
    assert.equal(context.request.authorization, 'Bearer synthetic-web-analysis-only');
    assert(context.availableTools.includes('web_search') && context.availableTools.includes('web_fetch'));
    assert.equal(context.availableTools.filter(name => name === 'web_search').length, 1);
    if (context.recentToolResults.length === 0) return { calls: [{ name: 'web_search', arguments: { query } }] };
    const receipt = JSON.parse(providerMessageText(context.recentToolResults.at(-1)?.content));
    receipts.push(receipt);
    if (context.recentToolResults.length === 1) {
      assert.equal(receipt.ok, true);
      assert.equal(receipt.provider, 'minimax');
      assert.equal(receipt.usedFallback, true);
      assert.deepEqual(receipt.attempts.map((attempt: any) => [attempt.provider, attempt.status, attempt.error?.code]), [
        ['deepseek', 'failed', 'rate_limited'], ['minimax', 'success', undefined],
      ]);
      assert.deepEqual(receipt.results, [{ title: 'Synthetic release notes', url: sourceUrl, snippet: 'Synthetic excerpt', date: '2026-11-10' }]);
      return { calls: [{ name: 'web_fetch', arguments: { url: receipt.results[0].url } }] };
    }
    assert.deepEqual(receipt, { ok: true, provider: 'deepseek', url: sourceUrl, title: 'Synthetic release notes', markdown: '# Synthetic release\n\nBody from the fixture.' });
    return { text: 'SYNTHETIC_WEB_TOOL_FLOW_COMPLETE' };
  });

  const requestId = randomUUID();
  await host.request(route + '/messages', 'POST', { text: 'Search the synthetic release, then read the returned source.', requestId }, 202);
  const state = await settled(host, route, requestId);
  assert.deepEqual(provider.errors, []);
  assert.equal(state.task.lastRun?.id, requestId);
  assert.equal(state.task.lastRun.status, 'completed', JSON.stringify(state.task.lastRun));
  assert.equal(state.task.configuration.id, configuration.id);
  assert.match(JSON.stringify(state.snapshot.messages), /SYNTHETIC_WEB_TOOL_FLOW_COMPLETE/);
  assert.equal(receipts.length, 2);
  assert.equal(provider.requests.length, 3, 'same model continues after both tool results');
  assert.deepEqual(upstream, [
    { url: deepSeekSearch, body: { query, count: 10, need_content: false } },
    { url: miniMaxSearch, body: { q: query } },
    { url: deepSeekFetch, body: { url: sourceUrl } },
  ]);

  const nativeFile: string = state.task.sessionFile;
  const native = await readFile(nativeFile, 'utf8');
  assert(!native.includes(miniMaxKey) && !native.includes(deepSeekKey));
  await host.close();
  host = undefined;
  host = await startHost(root, webSearchFetch);
  assert.deepEqual(await host.request(settingsRoute), expectedSettings);
  const restored = await host.request(route);
  assert.equal(restored.task.sessionFile, nativeFile);
  assert.equal(await readFile(nativeFile, 'utf8'), native);
  const restoredTools = restored.snapshot.messages.filter((message: any) => message.role === 'toolResult');
  assert.deepEqual(restoredTools.map((message: any) => [message.toolName, message.details]), [
    ['web_search', receipts[0]], ['web_fetch', receipts[1]],
  ]);
  assert.equal(upstream.length, 3);
  assert.equal(provider.requests.length, 3);
});

test('实际 Host 停止在途 Pi 搜索，中断供应商且不会派发备用或保存迟到回执', { timeout: 30_000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-web-search-stop-')));
  const provider = await startToolProvider();
  let publishSignal!: (signal: AbortSignal) => void;
  let complete!: (response: Response) => void;
  const dispatched = new Promise<AbortSignal>(resolve => { publishSignal = resolve; });
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  const upstream: string[] = [];
  let host: Host | undefined;
  t.after(async () => {
    complete(Response.json({ base_resp: { status_code: 0 }, organic: [] }));
    await host?.close();
    await provider.close();
    await rm(root, { recursive: true, force: true });
  });
  host = await startHost(root, async (target, init) => {
    upstream.push(String(target));
    assert.equal(String(target), miniMaxSearch);
    assert(init?.signal);
    publishSignal(init.signal);
    return pending;
  });
  await seedSearchCredentials(host);
  const { route } = await createTask(host, provider.baseUrl);
  provider.setResponder(context => {
    assert.equal(context.requestNumber, 1, 'the cancelled tool must not resume analysis');
    assert(context.availableTools.includes('web_search'));
    return { calls: [{ name: 'web_search', arguments: { query } }] };
  });
  const requestId = randomUUID();
  await host.request(route + '/messages', 'POST', { text: 'Start the synthetic search for the stop test.', requestId }, 202);
  const upstreamSignal = await dispatched;
  assert.equal(upstreamSignal.aborted, false);
  await host.request(route + '/stop', 'POST', {});
  const stopped = await settled(host, route, requestId);
  assert.equal(stopped.task.lastRun.status, 'cancelled', JSON.stringify(stopped.task.lastRun));
  assert.equal(upstreamSignal.aborted, true);
  const sessionFile: string = stopped.task.sessionFile;
  const saved = await readFile(sessionFile, 'utf8');
  const lateTitle = 'LATE_UPSTREAM_SUCCESS_MUST_NOT_PERSIST';
  complete(Response.json({ base_resp: { status_code: 0 }, organic: [{ title: lateTitle, link: sourceUrl, snippet: 'late' }] }));
  await delay(50);
  const after = await host.request(route);
  assert.equal(after.task.lastRun.status, 'cancelled');
  assert.equal(await readFile(sessionFile, 'utf8'), saved);
  assert(!saved.includes(lateTitle));
  assert(!JSON.stringify(after.snapshot.messages).includes(lateTitle));
  assert.deepEqual(upstream, [miniMaxSearch]);
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.errors, []);
});

test('受管分析和有权限的子 Agent 可用网页搜索，只读角色不能越权', { timeout: 45_000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-web-search-managed-')));
  const provider = await startToolProvider();
  const upstream: string[] = [];
  let host: Host | undefined;
  t.after(async () => { await host?.close(); await provider.close(); await rm(root, { recursive: true, force: true }); });
  const skillRoot = path.join(root, 'host', 'pi', 'skills', 'web'), roleRoot = path.join(skillRoot, 'agents');
  await mkdir(roleRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: web\ndescription: Synthetic web tool role fixture.\n---\nUse the bundled roles.\n');
  await writeFile(path.join(roleRoot, 'searcher.md'), '---\nname: searcher\ndescription: Explicit search permission.\ntools: [read, web_search]\n---\nSearch only for the delegated term.\n');
  await writeFile(path.join(roleRoot, 'reader.md'), '---\nname: reader\ndescription: Local reading only.\ntools: [read]\n---\nRead only when appropriate.\n');
  await writeFile(path.join(roleRoot, 'inherited.md'), '---\nname: inherited\ndescription: Inherit the ordinary tools.\n---\nUse the default permitted tools.\n');
  host = await startHost(root, async (target, init) => {
    assert.equal(String(target), miniMaxSearch);
    const body = JSON.parse(String(init?.body));
    upstream.push(body.q);
    assert.deepEqual(Object.keys(body), ['q']);
    return Response.json({ base_resp: { status_code: 0 }, organic: [
      { title: 'Synthetic managed source', link: sourceUrl, snippet: 'Managed search receipt' },
    ] });
  });
  await seedSearchCredentials(host);
  const { projectRoute, route } = await createTask(host, provider.baseUrl);
  const automatic = route + '/automatic-verification';
  const capability = await host.request(automatic + '/capabilities');
  if (!capability.supported) {
    t.skip(`NOT_RUN: ${capability.reason ?? 'ordinary execution protection unavailable'}`);
    return;
  }
  await host.request(projectRoute + '/files/upload', 'POST', { directory: '020_clean', name: 'data.csv', content: Buffer.from('id,amount\n1,10\n').toString('base64') }, 201);
  const configured = await host.request(automatic + '/settings', 'PUT', { expectedRevision: 0, settings: {
    enabled: true, question: '核对合成报告。', dataFiles: ['020_clean/data.csv'],
    reportPath: '060_reports/initial.md', processFiles: [], maxAuthorTurns: 1,
  } });
  assert.equal(configured.settings.enabled, true);
  const roles = ['searcher', 'reader', 'inherited'];
  const childRequests: string[] = [];
  provider.setResponder(context => {
    assert.equal(context.request.body.model, model);
    const system = context.messages.filter(message => message.role === 'system').map(message => providerMessageText(message.content)).join('\n');
    const role = roles.find(name => system.includes(`You are the isolated role web/${name}.`));
    if (role) {
      childRequests.push(role);
      const tools = context.availableTools.filter(name => name === 'web_search' || name === 'web_fetch');
      assert.deepEqual(tools.sort(), role === 'reader' ? [] : role === 'searcher' ? ['web_search'] : ['web_fetch', 'web_search']);
      const previous = context.recentToolResults.at(-1);
      if (!previous) return { calls: [{ name: 'web_search', arguments: { query: `${query} ${role}` } }] };
      const text = providerMessageText(previous.content);
      if (role === 'reader') assert.match(text, /not found|not available|unknown tool/i);
      else {
        const receipt = JSON.parse(text);
        assert.equal(receipt.ok, true);
        assert.equal(receipt.results[0].url, sourceUrl);
      }
      return { text: `CHILD_${role}_COMPLETE` };
    }
    assert(context.availableTools.includes('web_search') && context.availableTools.includes('web_fetch'));
    assert(context.availableTools.includes('subagent'));
    if (context.recentToolResults.length === 0) return { calls: [{ name: 'web_search', arguments: { query } }] };
    const receipt = JSON.parse(providerMessageText(context.recentToolResults.at(-1)?.content));
    if (context.recentToolResults.length === 1) {
      assert.equal(receipt.ok, true);
      assert.equal(receipt.provider, 'minimax');
      assert.equal(receipt.results[0].url, sourceUrl);
      return { calls: [{ name: 'subagent', arguments: { chain: roles.map(name => ({ agent: `web/${name}`, task: `Inspect the synthetic search scope for ${name}.` })) } }] };
    }
    assert.equal(receipt.mode, 'chain');
    assert.deepEqual(receipt.results.map((result: any) => [result.agent, result.outcome, result.text]),
      roles.map(name => [`web/${name}`, 'completed', `CHILD_${name}_COMPLETE`]));
    return { text: 'SYNTHETIC_MANAGED_WEB_SEARCH_COMPLETE' };
  });

  const requestId = randomUUID();
  await host.request(route + '/messages', 'POST', { text: 'Search only. Do not create or update a report.', requestId }, 202);
  const state = await settled(host, route, requestId);
  assert.deepEqual(provider.errors, []);
  assert.equal(state.task.lastRun.status, 'completed', JSON.stringify(state.task.lastRun));
  assert.match(JSON.stringify(state.snapshot.messages), /SYNTHETIC_MANAGED_WEB_SEARCH_COMPLETE/);
  const native = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert(native.some(entry => entry.customType === 'optracall.execution' && entry.data?.phase === 'closed' && entry.data.profile === 'ordinary'),
    'the original task has an actual managed ordinary-scope close receipt');
  assert.deepEqual((await host.request(automatic + '/chains')).chains, [], 'a web-search-only ordinary turn does not dispatch an automatic verification chain');
  assert.deepEqual(childRequests, roles.flatMap(name => [name, name]));
  assert.deepEqual(upstream, [query, `${query} searcher`, `${query} inherited`], 'only granted tools may dispatch outside the model loop');
  assert.equal(provider.requests.length, 9);
});

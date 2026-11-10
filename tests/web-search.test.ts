import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createWebSearch } from '../src/host/web-search.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';

const miniMaxUrl = 'https://api.minimaxi.com/v1/coding_plan/search';
const deepSeekSearchUrl = 'https://api.deepseek.com/v1/tools/search';
const deepSeekFetchUrl = 'https://api.deepseek.com/v1/tools/fetch';
const miniMax: RuntimeModelConfiguration = {
  id: 'minimax-m31-flash', name: 'MiniMax', provider: 'minimax-cn', api: 'anthropic-messages',
  baseUrl: 'https://api.minimaxi.com/anthropic', model: 'MiniMax-M3.1-Flash', revision: 1, apiKey: 'mini-test-secret',
};
const deepSeek: RuntimeModelConfiguration = {
  id: 'deepseek-flash', name: 'DeepSeek', provider: 'deepseek', api: 'openai-completions',
  baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', revision: 1, apiKey: 'deep-test-secret',
};
const miniMaxHits = {
  base_resp: { status_code: 0, status_msg: 'success' },
  organic: [{ title: 'Example', link: 'https://example.com/', snippet: 'Excerpt', date: '2026-11-10' }],
};
const deepSeekHits = {
  results: [{ title: 'Example', url: 'https://example.com/', snippet: 'Excerpt', summary: 'Long source summary', site_name: 'Example News', date: null }],
};

async function fixture(t: TestContext, request: typeof fetch) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-web-search-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const models = new Map([miniMax, deepSeek].map(model => [model.id, model]));
  const options = { dataRoot, configuration: (id: string) => models.get(id) ?? null, fetch: request };
  return { service: createWebSearch(options), options, models };
}

test('首选 MiniMax 成功时只发送关键词和官方请求头，并保留来源', async t => {
  const calls: string[] = [];
  const { service } = await fixture(t, async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, 'POST');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('authorization'), 'Bearer mini-test-secret');
    assert.equal(headers.get('MM-API-Source'), 'Minimax-MCP');
    assert.deepEqual(JSON.parse(String(init.body)), { q: 'Python 官方文档' });
    return Response.json(miniMaxHits);
  });
  assert.deepEqual(await service.search('Python 官方文档'), {
    ok: true, provider: 'minimax', results: [{ title: 'Example', url: 'https://example.com/', snippet: 'Excerpt', date: '2026-11-10' }],
    attempts: [{ provider: 'minimax', status: 'success' }], usedFallback: false,
  });
  assert.deepEqual(calls, [miniMaxUrl]);
});

test('首选成功但没有结果时保留空结果，备用不派发', async t => {
  const calls: string[] = [];
  const { service } = await fixture(t, async url => {
    calls.push(String(url));
    return Response.json({ ...miniMaxHits, organic: [] });
  });
  const result = await service.search('no hits');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.results, []);
  assert.equal(result.usedFallback, false);
  assert.deepEqual(calls, [miniMaxUrl]);
});

test('首选业务失败只触发一次备用，备用在派发时读取轮换后的密钥', async t => {
  const calls: string[] = [];
  const { service, models } = await fixture(t, async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, 'error');
    if (String(url) === miniMaxUrl) {
      models.set(deepSeek.id, { ...deepSeek, apiKey: 'rotated-test-secret' });
      return Response.json({ base_resp: { status_code: 1004, status_msg: 'mini-test-secret' } });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer rotated-test-secret');
    assert.deepEqual(JSON.parse(String(init?.body)), { query: 'same query', count: 10, need_content: false });
    return Response.json(deepSeekHits);
  });
  const result = await service.search('same query');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.results, [{ title: 'Example', url: 'https://example.com/', snippet: 'Excerpt', summary: 'Long source summary', site: 'Example News' }]);
  assert.deepEqual(result.attempts.map(attempt => [attempt.provider, attempt.status, 'error' in attempt && attempt.error.code]), [
    ['minimax', 'failed', 'auth_invalid'], ['deepseek', 'success', false],
  ]);
  assert(!JSON.stringify(result).includes('test-secret'));
  assert.deepEqual(calls, [miniMaxUrl, deepSeekSearchUrl]);
});

test('首选限流时跳过刚被清除的备用，并保留脱敏分类', async t => {
  const calls: string[] = [];
  const { service, models } = await fixture(t, async url => {
    calls.push(String(url));
    models.delete(deepSeek.id);
    return Response.json({ error: { message: 'mini-test-secret' } }, { status: 429 });
  });
  const result = await service.search('search');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'providers_unavailable');
  assert.deepEqual(result.attempts.map(attempt => [attempt.provider, attempt.status, 'error' in attempt && attempt.error.code]), [
    ['minimax', 'failed', 'rate_limited'], ['deepseek', 'not_configured', 'not_configured'],
  ]);
  assert(!JSON.stringify(result).includes('test-secret'));
  assert.deepEqual(calls, [miniMaxUrl]);
});

test('改序保存后重新创建服务仍生效，改线的同名模型没有搜索权限', async t => {
  const calls: string[] = [];
  const { service, options, models } = await fixture(t, async url => {
    calls.push(String(url));
    return Response.json(deepSeekHits);
  });
  assert.deepEqual(await service.settings(), { order: ['minimax', 'deepseek'], configured: { minimax: true, deepseek: true } });
  await assert.rejects(service.saveOrder(['deepseek', 'deepseek']), { code: 'invalid_search_order' });
  await service.saveOrder(['deepseek', 'minimax']);
  models.set(miniMax.id, { ...miniMax, baseUrl: 'https://example.com/anthropic' });
  const reloaded = createWebSearch(options);
  assert.deepEqual(await reloaded.settings(), { order: ['deepseek', 'minimax'], configured: { minimax: false, deepseek: true } });
  assert.equal((await reloaded.search('search')).ok, true);
  await reloaded.saveOrder(['minimax', 'deepseek']);
  const skipped = await reloaded.search('search');
  assert.equal(skipped.ok, true);
  assert.equal(skipped.attempts[0]?.status, 'not_configured');
  assert.deepEqual(calls, [deepSeekSearchUrl, deepSeekSearchUrl]);
});

test('两条线路分别返回无效响应和超预算响应时保留各自错误', async t => {
  const calls: string[] = [];
  const { service } = await fixture(t, async url => {
    calls.push(String(url));
    return String(url) === miniMaxUrl
      ? Response.json({ base_resp: { status_code: 0 }, organic: [{ link: 'file:///tmp/a' }] })
      : new Response('invalid', { headers: { 'content-length': String(3 * 1024 * 1024) } });
  });
  const result = await service.search('search');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'providers_unavailable');
  assert.deepEqual(result.attempts.map(attempt => 'error' in attempt && attempt.error.code), ['malformed_response', 'response_too_large']);
  assert.deepEqual(calls, [miniMaxUrl, deepSeekSearchUrl]);
});

test('序列化后的来源和正文也遵守工具回执预算', async t => {
  const url = 'https://example.com/page';
  const { service } = await fixture(t, async target => {
    if (target === miniMaxUrl) return Response.json({
      base_resp: { status_code: 0 },
      organic: Array.from({ length: 10 }, () => ({ title: 'Example', link: url + '/' + '界'.repeat(8000), snippet: '文'.repeat(3000) })),
    });
    if (target === deepSeekSearchUrl) return Response.json(deepSeekHits);
    assert.equal(target, deepSeekFetchUrl);
    return Response.json({ title: 'Example', content: '\u0001'.repeat(50_000) });
  });
  const search = await service.search('search');
  assert.equal(search.ok, true);
  if (!search.ok) return;
  assert.equal(search.provider, 'deepseek');
  assert.deepEqual(search.attempts.map(attempt => 'error' in attempt && attempt.error.code), ['response_too_large', false]);
  const page = await service.fetchPage(url);
  assert.equal(page.ok, false);
  if (!page.ok) assert.equal(page.error.code, 'response_too_large');
});

test('取消立即中断等待，迟到成功丢弃，备用不派发', async t => {
  let started!: () => void;
  let complete!: (response: Response) => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const provider = new Promise<Response>(resolve => { complete = resolve; });
  const calls: string[] = [];
  let outboundSignal: AbortSignal | null | undefined;
  const { service } = await fixture(t, async (url, init) => {
    calls.push(String(url));
    outboundSignal = init?.signal;
    started();
    return provider;
  });
  const controller = new AbortController();
  const pending = service.search('search', controller.signal);
  await began;
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'cancelled');
  assert.equal(outboundSignal?.aborted, true);
  complete(Response.json(miniMaxHits));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [miniMaxUrl]);
});

test('取消供应商正文时释放读取流', async t => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  });
  const { service } = await fixture(t, async () => {
    setImmediate(() => controller.abort());
    return new Response(stream);
  });
  const result = await service.search('search', controller.signal);
  assert.equal(!result.ok && result.error.code, 'cancelled');
  assert.equal(cancelled, true);
});

test('首选达到单线路时限后只派发一次备用', async t => {
  const calls: string[] = [];
  let timers = 0;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 12_000);
    const timer = new AbortController();
    if (++timers === 1) setImmediate(() => timer.abort());
    return timer.signal;
  });
  const { service } = await fixture(t, async url => {
    calls.push(String(url));
    if (String(url) === miniMaxUrl) return new Promise<Response>(() => {});
    return Response.json(deepSeekHits);
  });
  const result = await service.search('search');
  assert.equal(result.ok, true);
  assert.equal('error' in result.attempts[0]! && result.attempts[0].error.code, 'timeout');
  assert.deepEqual(calls, [miniMaxUrl, deepSeekSearchUrl]);
});

test('输入错误拒绝网络请求，Fetch 独立使用 DeepSeek 并返回 Markdown', async t => {
  const calls: string[] = [];
  const { service } = await fixture(t, async (url, init) => {
    calls.push(String(url));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer deep-test-secret');
    assert.deepEqual(JSON.parse(String(init?.body)), { url: 'https://example.com/article' });
    return Response.json({ title: 'Example', content: '# Example\n\ndeep-test-secret' });
  });
  const invalid = await service.search('😀'.repeat(129));
  assert.equal(!invalid.ok && invalid.error.code, 'invalid_query');
  for (const url of ['file:///tmp/a', 'http://localhost', 'http://foo.internal', 'http://127.1/', 'http://[::1]/',
    'https://1.1.1.1/', 'https://alice:secret@example.com/', 'https://@example.com/', 'https://example.com\\@public.example.com/']) {
    const rejected = await service.fetchPage(url);
    assert.equal(!rejected.ok && rejected.error.code, 'invalid_url');
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await service.fetchPage('https://example.com/article'), {
    ok: true, provider: 'deepseek', url: 'https://example.com/article', title: 'Example', markdown: '# Example\n\n[redacted]',
  });
  assert.deepEqual(calls, [deepSeekFetchUrl]);
});

test('Fetch 独立区分安全拒绝、网页不可用、鉴权和限流，无备用', async t => {
  const outcomes = [403, 404, 401, 429];
  const { service } = await fixture(t, async url => {
    assert.equal(String(url), deepSeekFetchUrl);
    return Response.json({ error: { message: 'deep-test-secret' } }, { status: outcomes.shift() });
  });
  for (const code of ['safety_rejected', 'page_unavailable', 'auth_invalid', 'rate_limited']) {
    const result = await service.fetchPage('https://example.com/');
    assert.equal(!result.ok && result.error.code, code);
    assert(!JSON.stringify(result).includes('test-secret'));
  }
  assert.deepEqual(outcomes, []);
});

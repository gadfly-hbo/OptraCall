import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebSearchExtension, type WebSearchToolName, type WebSearchToolsPort } from '../src/agent/web-search-tools.ts';

type Registrar = Parameters<ReturnType<typeof createWebSearchExtension>>[0];
type Definition = Pick<Parameters<Registrar['registerTool']>[0], 'name' | 'execute'>;

function registered(port: WebSearchToolsPort, allowed?: readonly WebSearchToolName[]) {
  const tools = new Map<string, Definition>();
  createWebSearchExtension(port, allowed)({ registerTool: tool => tools.set(tool.name, tool) });
  return tools;
}

test('web search and fetch pass exact input, call identity and cancellation to the Host and preserve its receipt', async () => {
  const signal = new AbortController().signal;
  const query = '零售周报';
  const url = 'https://example.com/article';
  const calls: unknown[] = [];
  const search = { ok: true, provider: 'deepseek', results: [], attempts: [{ provider: 'minimax', status: 'failed' }, { provider: 'deepseek', status: 'success' }], usedFallback: true };
  const fetch = { ok: true, provider: 'deepseek', url, title: '示例网页', markdown: '# 示例\n网页正文' };
  const tools = registered({
    search: async (input, seenSignal, id) => { calls.push(['search', input, seenSignal, id]); return search; },
    fetchPage: async (input, seenSignal, id) => { calls.push(['fetch', input, seenSignal, id]); return fetch; },
  });
  assert.deepEqual([...tools.keys()], ['web_search', 'web_fetch']);
  const searchResult = await tools.get('web_search')!.execute('search-id', { query }, signal);
  const fetchResult = await tools.get('web_fetch')!.execute('fetch-id', { url }, signal);
  assert.deepEqual(calls, [['search', query, signal, 'search-id'], ['fetch', url, signal, 'fetch-id']]);
  for (const [result, details] of [[searchResult, search], [fetchResult, fetch]] as const) {
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.details, details);
    assert.equal(result.content.length, 1);
    assert.deepEqual(JSON.parse(result.content[0]!.text), details);
  }
});

test('a narrowed web tool set only registers granted tools and preserves Host failures as Pi tool errors', async () => {
  const failure = { ok: false, error: { code: 'rate_limited', message: '线路限流' }, attempts: [{ provider: 'deepseek', status: 'failed' }] };
  const port: WebSearchToolsPort = {
    search: async () => assert.fail('search is outside this grant'),
    fetchPage: async () => failure,
  };
  assert.equal(registered(port, []).size, 0);
  const tools = registered(port, ['web_fetch']);
  assert.deepEqual([...tools.keys()], ['web_fetch']);
  const result = await tools.get('web_fetch')!.execute('fetch-id', { url: 'https://example.com' });
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, failure);
});

test('invalid tool arguments cannot reach the port and cancelled results do not return as successes', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const tools = registered({
    search: async query => {
      calls.push(query);
      controller.abort();
      return { ok: true, provider: 'minimax', results: [], attempts: [], usedFallback: false };
    },
    fetchPage: async () => assert.fail('an invalid URL cannot reach the port'),
  });
  const search = tools.get('web_search')!;
  const fetch = tools.get('web_fetch')!;
  const invalid = await search.execute('bad-search', { query: '关键词', provider: 'deepseek' });
  assert.equal(invalid.isError, true);
  assert.equal((await fetch.execute('bad-url', { url: 'file:///var/private' })).isError, true);
  assert.deepEqual(calls, []);
  const aborted = AbortSignal.abort();
  await assert.rejects(search.execute('before-abort', { query: '未派发' }, aborted), { name: 'AbortError' });
  await assert.rejects(search.execute('during-abort', { query: '结果迟到' }, controller.signal), { name: 'AbortError' });
  assert.deepEqual(calls, ['结果迟到']);
});

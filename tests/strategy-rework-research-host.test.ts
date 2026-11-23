import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const SOURCE = {title: 'Synthetic industry practice', url: 'https://example.com/industry/practice'};
const SEARCH_BLOCKS = [
  {type: 'text', text: 'SEARCH_STARTED'},
  {type: 'server_tool_use', id: 'native-search-1', name: 'web_search', input: {query: '会员分层触达 行业实践'}},
  {type: 'web_search_tool_result', tool_use_id: 'native-search-1', content: [{type: 'web_search_result', ...SOURCE, encrypted_content: 'synthetic-encrypted-result', page_age: '2026-11-03'}]},
  {type: 'text', text: '合成公开资料摘要：行业分层触达存在机会，需核对门店工时。'},
];
function anthropic(response: any, body: any, blocks: any[]) {
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
  const send = (type: string, value: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify({type, ...value as object})}\n\n`);
  send('message_start', {message: {id: 'synthetic-initiative-search', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: {input_tokens: 12, output_tokens: 0}}});
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      send('content_block_start', {index, content_block: {type: 'text', text: ''}});
      send('content_block_delta', {index, delta: {type: 'text_delta', text: block.text}});
    } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      send('content_block_start', {index, content_block: {...block, input: {}}});
      const json = JSON.stringify(block.input), cut = Math.floor(json.length / 2);
      send('content_block_delta', {index, delta: {type: 'input_json_delta', partial_json: json.slice(0, cut)}});
      send('content_block_delta', {index, delta: {type: 'input_json_delta', partial_json: json.slice(cut)}});
    } else send('content_block_start', {index, content_block: block});
    send('content_block_stop', {index});
  });
  send('message_delta', {delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 20}});
  send('message_stop', {}); response.end();
}
const bodyText = (body: any) => JSON.stringify(body.messages ?? []);

test('真实 Pi（进程内隔离 Host）：事项公开研究经获准原生搜索域实际执行并留来源', {timeout: 120_000}, async t => {
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push(body);
    const text = bodyText(body);
    if (text.includes('公开检索')) return anthropic(response, body, SEARCH_BLOCKS);
    if (text.includes('tool_result')) return anthropic(response, body, [{type: 'text', text: '已核对公开资料，未知随报告保存。'}]);
    return anthropic(response, body, [{type: 'tool_use', id: 'tool-1', name: 'strategy_goals', input: {action: 'public-search', query: '会员分层触达 行业实践'}}]);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as {port: number};
  t.after(() => { server.close(); });
  const {mkdtemp} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const os = await import('node:os');
  const root = await mkdtemp(join(os.tmpdir(), 'optracall-initiative-research-'));
  const {StrategyInitiativeStore} = await import('../src/host/strategy-initiative-store.ts');
  const {StrategyInitiativeReports} = await import('../src/host/strategy-initiative-reports.ts');
  const {StrategyInitiativeFiles} = await import('../src/host/strategy-initiative-files.ts');
  const {createStrategyCandidateHost} = await import('../src/host/strategy-candidate-host.ts');
  const {createStrategyInitiativeHost} = await import('../src/host/strategy-initiative-host.ts');
  const cfg = Object.freeze({id: 'initiative-research-fixture', revision: 1, name: 'Synthetic native search', provider: 'minimax-cn', api: 'anthropic-messages', baseUrl: `http://127.0.0.1:${address.port}`, model: 'MiniMax-M3', apiKey: 'synthetic-native-search-only-key'});
  const configuration = () => cfg;
  const mutate = async (fn: any) => fn();
  const initiatives = new StrategyInitiativeStore(root);
  const reports = new StrategyInitiativeReports(initiatives);
  const files = new StrategyInitiativeFiles(initiatives);
  const candidates = createStrategyCandidateHost({initiatives, reports, files, codeRoot: process.cwd(), configuration, mutate, isClosing: () => false});
  const host = createStrategyInitiativeHost({initiatives, reports, files, candidates: {version: (id, cid, no) => candidates.version(id, cid, no), list: (id, scopeKey) => candidates.list(id, scopeKey), proposal: (id, pid) => candidates.proposal(id, pid), markProposed: (id, pid, newText, requestId) => candidates.markProposed(id, pid, newText, requestId)}, codeRoot: process.cwd(), configuration, mutate, isClosing: () => false});
  t.after(async () => { await host.closeAll(); });
  const initiativeId = randomUUID();
  initiatives.create({operationId: initiativeId, title: '研究事项', scopes: [stores]});
  await host.create(initiativeId, {operationId: randomUUID(), scope: stores});
  await host.send(initiativeId, scopeKey, {requestId: randomUUID(), text: '请检索行业公开资料辅助开题。', expectedRevision: 1});
  let d: any;
  for (let n = 0; n < 500; n++) { d = await host.detail(initiativeId, scopeKey); if (d.session.lastRun?.status && d.session.lastRun.status !== 'accepted') break; await delay(20); }
  assert.equal(d.session.lastRun.status, 'completed');
  const {readdir, readFile} = await import('node:fs/promises');
  const entries = await readdir(join(root, 'strategy-initiatives', initiativeId));
  assert.ok(entries.includes('public-search'), 'search runs in its own isolated native directory');
  const searchDir = join(root, 'strategy-initiatives', initiativeId, 'public-search');
  const natives = await readdir(searchDir, {recursive: true}) as string[];
  const jsonl = natives.find(name => name.endsWith('.jsonl'));
  assert.ok(jsonl, 'search native history is persisted');
  const content = await readFile(join(searchDir, jsonl!), 'utf8');
  assert.match(content, /example\.com\/industry\/practice/, 'actual search source is retained in native history');
  assert.ok(requests.some(body => bodyText(body).includes('公开检索')), 'the isolated search domain received the public topic');
});

test('真实 Host+Pi：无原生搜索能力时公开研究如实返回不可用', {timeout: 120_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '研究合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-research', apiKey: 'synthetic-research'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '研究事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201);
  let searchResult = '';
  provider.setResponder((ctx: any) => {
    if (!ctx.recentToolResults.length) return {calls: [{name: 'strategy_goals', arguments: {action: 'public-search', query: '会员分层触达 行业实践'}}]};
    searchResult = providerMessageText(ctx.recentToolResults.at(-1)?.content);
    return {text: '公开检索当前不可用，沿用已知事实与明确假设开题。'};
  });
  await req(`${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {requestId: randomUUID(), text: '请检索行业公开资料辅助开题。', expectedRevision: 1}, 202);
  let d: any;
  for (let n = 0; n < 500; n++) { d = await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`); if (d.session.lastRun?.status && d.session.lastRun.status !== 'accepted') break; await delay(20); }
  assert.equal(d.session.lastRun.status, 'completed');
  assert.match(searchResult, /unavailable/, 'fact-based unavailable receipt when the configuration has no native search');
  assert.deepEqual(provider.errors, []);
});
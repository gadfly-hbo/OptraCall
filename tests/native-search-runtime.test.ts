import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { nativeSearchMode } from '../src/agent/native-search.ts';

const SOURCE = { title: 'Synthetic official SDK release', url: 'https://example.com/official/sdk-release' };
const SEARCH_BLOCKS = [
  { type: 'text', text: 'SEARCH_STARTED' },
  { type: 'server_tool_use', id: 'native-search-1', name: 'web_search', input: { query: 'synthetic sdk release' } },
  { type: 'web_search_tool_result', tool_use_id: 'native-search-1', content: [{ type: 'web_search_result', ...SOURCE, encrypted_content: 'synthetic-encrypted-result', page_age: '2026-11-03' }] },
];
type RequestRecord = { body: any; closedEarly: boolean; finished: boolean; usedFrozenCredential: boolean };
type Responder = (record: RequestRecord, response: ServerResponse, index: number) => void;
const messagesText = (messages: any[]) => messages.map(message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text ?? '').join('')).join('\n');
const metadata = (messages: any[]) => messages.flatMap(message => message.optracallNativeSearch ? [message.optracallNativeSearch] : []);
const declarations = (body: any) => (body.tools ?? []).map((tool: any) => tool.function?.name ?? tool.name ?? tool.type);
async function until(check: () => boolean, description: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) { assert.ok(Date.now() < deadline, description); await new Promise(resolve => setTimeout(resolve, 5)); }
}
function anthropic(response: ServerResponse, body: any, blocks: any[], stopReason = 'end_turn', hold = false) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  const send = (type: string, value: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value as object })}\n\n`);
  send('message_start', { message: { id: 'synthetic-native-search', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } });
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      send('content_block_start', { index, content_block: { ...block, input: {} } });
      const json = JSON.stringify(block.input), cut = Math.floor(json.length / 2);
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(0, cut) } });
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(cut) } });
    } else send('content_block_start', { index, content_block: block });
    send('content_block_stop', { index });
  });
  if (hold) return;
  send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
  send('message_stop', {}); response.end();
}
function openai(response: ServerResponse, body: any, text: string, options: { annotations?: unknown[]; usage?: unknown; tool?: { name: string; input: unknown } } = {}) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  const send = (delta: unknown, finish: string | null = null, extra: object = {}) => response.write('data: ' + JSON.stringify({ id: 'synthetic-native-search', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra }) + '\n\n');
  send({ role: 'assistant', content: '', ...(options.annotations ? { annotations: options.annotations } : {}) });
  if (options.tool) send({ tool_calls: [{ index: 0, id: 'client-read-1', type: 'function', function: { name: options.tool.name, arguments: JSON.stringify(options.tool.input) } }] });
  if (text) send({ content: text });
  send({}, options.tool ? 'tool_calls' : 'stop', options.usage ? { usage: options.usage } : {});
  response.end('data: [DONE]\n\n');
}
async function fixture(t: TestContext, api: 'anthropic-messages' | 'openai-completions' = 'anthropic-messages', provider = api === 'anthropic-messages' ? 'minimax-cn' : 'xiaomi-token-plan-cn') {
  const evidence = path.resolve('.local/task-agent-capabilities/native-search-runtime');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'fixture-'));
  const projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources');
  for (const directory of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, directory), { recursive: true, mode: 0o700 });
  await mkdir(resourceRoot, { recursive: true, mode: 0o700 });
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false, maxRetries: 0 }, cacheWarming: 'off' }));
  // Real builtin model IDs are necessary to exercise capability selection.
  // Guard the actual worker's dispatcher before SDK import so a regression in
  // builtin/configured baseUrl precedence cannot send even a fake key outside.
  const fixtureCode = path.join(root, 'fixture-code');
  await mkdir(path.join(fixtureCode, 'scripts'), { recursive: true });
  await writeFile(path.join(fixtureCode, 'scripts/project-entry.mjs'), `
    import { configureHttpTransport } from ${JSON.stringify(pathToFileURL(path.resolve('scripts/http-transport.mjs')).href)};
    import { getGlobalDispatcher, setGlobalDispatcher } from ${JSON.stringify(pathToFileURL(path.resolve('node_modules/undici/index.js')).href)};
    process.umask(0o077);
    const transport = configureHttpTransport();
    setGlobalDispatcher(getGlobalDispatcher().compose(dispatch => (options, handler) => {
      const url = new URL(String(options.origin));
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('synthetic_fixture_disallows_non_loopback');
      return dispatch(options, handler);
    }));
    process.prependListener('message', message => {
      if (message.method === 'open') message.input.codeRoot = ${JSON.stringify(process.cwd())};
    });
    try { const { runProjectSession } = await import(${JSON.stringify(pathToFileURL(path.resolve('src/agent/project-session.ts')).href)}); await runProjectSession(transport); }
    catch { await transport.close(); process.exitCode = 1; if (process.connected) process.disconnect(); }
  `);
  const requests: RequestRecord[] = [], events: any[] = [], errors: string[] = [];
  const responses = new Set<ServerResponse>();
  let responder: Responder = (record, response) => api === 'anthropic-messages' ? anthropic(response, record.body, [{ type: 'text', text: 'SYNTHETIC_PLAIN' }]) : openai(response, record.body, 'SYNTHETIC_PLAIN');
  const server = createServer(async (request, response) => {
    responses.add(response); response.on('close', () => responses.delete(response));
    try {
      assert.ok(request.socket.remoteAddress === '127.0.0.1', 'fixture accepts loopback requests only');
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const record: RequestRecord = { body: JSON.parse(Buffer.concat(chunks).toString()), closedEarly: false, finished: false, usedFrozenCredential: request.headers['x-api-key'] === 'synthetic-native-search-only-key' || request.headers.authorization === 'Bearer synthetic-native-search-only-key' };
      requests.push(record);
      response.on('finish', () => { record.finished = true; }); response.on('close', () => { record.closedEarly = !record.finished; });
      responder(record, response, requests.length);
    } catch (error) { errors.push(error instanceof Error ? error.message : 'synthetic fixture error'); if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options: ProjectAgentOptions = { projectId: 'native-search-fixture', projectDirectory, sessionDirectory: path.join(root, 'sessions'), resourceRoot, codeRoot: fixtureCode, managementPorts: [], configuration: { id: 'native-search-fixture', revision: 1, name: 'Synthetic native search', provider, api, baseUrl: `http://127.0.0.1:${address.port}${api === 'anthropic-messages' ? '' : '/v1'}`, model: api === 'anthropic-messages' ? 'MiniMax-M3' : provider === 'deepseek' ? 'deepseek-flash' : 'mimo-v2.6-pro', apiKey: 'synthetic-native-search-only-key' } };
  const agents: ProjectAgent[] = [];
  const create = (overrides: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); agent.subscribe(event => events.push(event)); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); for (const response of responses) response.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await writeFile(path.join(root, 'requests.json'), JSON.stringify(requests, null, 2)); assert.deepEqual(errors, []); });
  return { root, options, requests, events, create, respond: (next: Responder) => { responder = next; } };
}

test('native Anthropic search resumes through the SDK with exact raw assistant blocks and persists them across reopen', { timeout: 40_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  f.respond((record, response, index) => anthropic(response, record.body, index === 1 ? SEARCH_BLOCKS : [{ type: 'text', text: `SYNTHETIC_RELEASE_1.2.3 ${SOURCE.url}` }], index === 1 ? 'pause_turn' : 'end_turn'));
  await agent.open();
  const result = await agent.start('PUBLIC_RELEASE_QUERY', 'native-anthropic-search').completion;
  assert.ok(f.requests.length > 0, 'the frozen Host endpoint overrides the builtin model URL and reaches only the loopback fixture');
  assert.ok(f.requests.every(record => record.usedFrozenCredential && record.body.model === 'MiniMax-M3'), 'the actual SDK requests retain the frozen model and synthetic key');
  assert.equal(result.outcome, 'completed', result.diagnostic?.message);
  assert.equal(f.requests.length, 2, 'the SDK continues the one paused assistant turn exactly once');
  assert.ok(f.requests[0].body.tools.some((tool: any) => tool.type === 'web_search_20250305'), 'configured MiniMax request declares native search');
  const continuation = f.requests[1].body.messages;
  assert.equal(continuation.filter((message: any) => message.role === 'user').length, 1, 'continuation must not create another user message');
  assert.deepEqual(continuation.filter((message: any) => message.role === 'assistant').at(-1)?.content, SEARCH_BLOCKS, 'raw native tool blocks survive request conversion byte-for-value');
  assert.match(result.text, /SYNTHETIC_RELEASE_1\.2\.3/); assert.match(result.text, /https:\/\/example\.com\/official\/sdk-release/);
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  const search = metadata(snapshot.messages).find(value => value.stopReason === 'pause_turn');
  assert.ok(search, 'source metadata reaches the actual UI snapshot');
  assert.equal(search.version, 1); assert.equal(search.api, 'anthropic-messages'); assert.deepEqual(search.content, SEARCH_BLOCKS);
  assert.deepEqual(search.sources, [SOURCE]);
  const native = await readFile(snapshot.sessionFile, 'utf8');
  assert.ok(native.includes('optracallNativeSearch')); assert.ok(native.includes('synthetic-encrypted-result'));
  assert.ok(messagesText(snapshot.messages).includes(SOURCE.url), 'sources remain visible in the normal message projection');
  await agent.close();
  const bytes = await readFile(snapshot.sessionFile), reopened = f.create({ sessionFile: snapshot.sessionFile });
  const restored = await reopened.open();
  assert.equal(f.requests.length, 2, 'reading and reopening search history does not replay searches');
  assert.deepEqual(await readFile(snapshot.sessionFile), bytes, 'opening does not rewrite source evidence');
  assert.deepEqual(metadata(restored.messages), metadata(snapshot.messages));
  await reopened.start('EXPLICIT_NEW_QUESTION', 'native-anthropic-next').completion;
  assert.equal(f.requests.length, 3);
  const resumedHistory = f.requests[2].body.messages;
  assert.equal(resumedHistory.filter((message: any) => message.role === 'user').length, 2);
  assert.ok(resumedHistory.some((message: any) => message.role === 'assistant' && JSON.stringify(message.content) === JSON.stringify(SEARCH_BLOCKS)), 'a later explicit turn still carries the original native result blocks');
});

test('native search admission follows the configured model protocol and keeps DeepSeek on its existing unsupported route', () => {
  for (const [provider, api, models] of [
    ['minimax-cn', 'anthropic-messages', ['MiniMax-M3', 'MiniMax-M3.1-Flash']],
    ['xiaomi-token-plan-cn', 'openai-completions', ['mimo-v2.6-pro', 'mimo-v2.6-flash']],
  ] as const) for (const model of models) assert.ok(nativeSearchMode({ provider, api, model }), `${provider}/${api}/${model} exposes its demonstrated native capability`);
  for (const configuration of [
    { provider: 'deepseek', api: 'openai-completions', model: 'deepseek-flash' },
    { provider: 'minimax-cn', api: 'openai-completions', model: 'MiniMax-M3' },
    { provider: 'xiaomi-token-plan-cn', api: 'anthropic-messages', model: 'mimo-v2.6-pro' },
    { provider: 'synthetic', api: 'openai-completions', model: 'mimo-v2.6-pro' },
    { provider: 'minimax-cn', api: 'anthropic-messages', model: 'unverified-model' },
  ]) assert.ok(!nativeSearchMode(configuration), 'a model name alone cannot grant another protocol or provider search capability');
});

test('MiMo raw citation annotations and search usage survive the SDK, message projection and native persistence', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'openai-completions'), agent = f.create();
  const usage = { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38, web_search_usage: { tool_usage: 1, page_usage: 1 } };
  f.respond((record, response) => openai(response, record.body, 'MIMO_SEARCH_ANSWER', { annotations: [{ type: 'url_citation', ...SOURCE, summary: 'Synthetic source excerpt.', site_name: 'Synthetic official site', publish_time: '2026-11-03T00:00:00Z' }], usage }));
  await agent.open();
  const result = await agent.start('MIMO_PUBLIC_QUERY', 'mimo-native-search').completion;
  assert.equal(result.outcome, 'completed'); assert.equal(f.requests.length, 1, 'one finished native search does not create another model turn');
  assert.ok(f.requests[0].body.tools.some((tool: any) => tool.type === 'web_search'));
  assert.ok(declarations(f.requests[0].body).includes('read'), 'native search does not replace the existing function tools');
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  const search = metadata(snapshot.messages).find(value => value.api === 'openai-completions');
  assert.ok(search, 'raw MiMo sources must not disappear during Pi response parsing');
  assert.equal(search.version, 1); assert.equal(search.originalText, 'MIMO_SEARCH_ANSWER'); assert.deepEqual(search.sources, [SOURCE]);
  assert.deepEqual(search.usage, usage.web_search_usage, 'receipt usage keeps the raw dedicated search counters; token usage remains in the SDK message');
  assert.match(messagesText(snapshot.messages), /Synthetic official SDK release/); assert.match(messagesText(snapshot.messages), /https:\/\/example\.com\/official\/sdk-release/);
  const native = await readFile(snapshot.sessionFile, 'utf8');
  assert.ok(native.includes('optracallNativeSearch'));
  const savedReceipt = native.trim().split('\n').map(line => JSON.parse(line)).map(entry => entry.message?.optracallNativeSearch).find(value => value?.api === 'openai-completions');
  assert.deepEqual(savedReceipt.usage, usage.web_search_usage, 'the actual JSONL keeps the complete dedicated Provider search counters');
  await agent.close();
  const bytes = await readFile(snapshot.sessionFile), restored = await f.create({ sessionFile: snapshot.sessionFile }).open();
  assert.deepEqual(metadata(restored.messages), metadata(snapshot.messages)); assert.equal(f.requests.length, 1);
  assert.deepEqual(await readFile(snapshot.sessionFile), bytes);
});

test('native MiMo search and a real client function tool can both run without dropping declarations or tool results', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'openai-completions'), agent = f.create();
  const sourceFile = path.join(f.options.projectDirectory!, '020_clean', 'source.txt');
  await writeFile(sourceFile, 'ACTUAL_LOCAL_FILE_CONTENT');
  f.respond((record, response, index) => index === 1
    ? openai(response, record.body, '', { tool: { name: 'read', input: { path: sourceFile } } })
    : openai(response, record.body, 'READ_RESULT: ' + messagesText(record.body.messages.filter((message: any) => message.role === 'tool')), { annotations: [{ type: 'url_citation', ...SOURCE }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, web_search_usage: { tool_usage: 1, page_usage: 1 } } }));
  await agent.open(); const result = await agent.start('READ_AND_SEARCH', 'mimo-search-and-function').completion;
  assert.equal(result.outcome, 'completed'); assert.equal(f.requests.length, 2);
  assert.match(result.text, /ACTUAL_LOCAL_FILE_CONTENT/, 'the actual SDK executes the original read tool');
  for (const record of f.requests) {
    assert.ok(declarations(record.body).includes('read'));
    assert.ok(record.body.tools.some((tool: any) => tool.type === 'web_search'));
  }
  assert.ok(f.requests[1].body.messages.some((message: any) => message.role === 'tool' && messagesText([message]).includes('ACTUAL_LOCAL_FILE_CONTENT')));
});

test('cancelled native search closes the actual stream and never dispatches a pause continuation or replays on reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  f.respond((record, response) => anthropic(response, record.body, SEARCH_BLOCKS, 'pause_turn', true));
  await agent.open(); const running = agent.start('CANCEL_NATIVE_SEARCH', 'native-search-cancel');
  await running.accepted;
  await until(() => f.events.some(event => event.type === 'text.delta' && event.text.includes('SEARCH_STARTED')), 'the actual SDK consumes partial native search while its stream remains live');
  await agent.stop();
  assert.equal((await running.completion).outcome, 'cancelled');
  await until(() => f.requests[0]?.closedEarly, 'cancellation closes the Provider response');
  assert.equal(f.requests.length, 1);
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile); await agent.close();
  await f.create({ sessionFile: snapshot.sessionFile }).open();
  assert.equal(f.requests.length, 1, 'opening an interrupted search is read-only');
});

test('a rejected native-search request remains failed without automatic retry, continuation or invented sources', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  f.respond((_record, response) => { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Synthetic request rejected.' } })); });
  await agent.open(); const result = await agent.start('REJECTED_SEARCH', 'native-search-rejected').completion;
  assert.equal(result.outcome, 'failed'); assert.equal(f.requests.length, 1);
  assert.deepEqual(metadata((await agent.snapshot()).messages), []);
});

test('model text containing a link is not fabricated into native search evidence', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  f.respond((record, response) => anthropic(response, record.body, [{ type: 'text', text: `MODEL_TEXT_ONLY ${SOURCE.url}` }]));
  await agent.open(); const result = await agent.start('NO_NATIVE_SEARCH', 'text-is-not-source').completion;
  assert.equal(result.outcome, 'completed'); assert.equal(f.requests.length, 1);
  assert.match(result.text, /MODEL_TEXT_ONLY/); assert.deepEqual(metadata((await agent.snapshot()).messages), []);
});

test('unsafe citation URLs never become displayed structured sources', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'openai-completions'), agent = f.create();
  f.respond((record, response) => openai(response, record.body, 'NO_VALID_SOURCE', { annotations: [
    { type: 'url_citation', title: 'Local file', url: 'file:///private/native.jsonl' },
    { type: 'url_citation', title: 'Executable URL', url: 'javascript:alert(1)' },
    { type: 'url_citation', title: 'Credential URL', url: 'https://user:password@example.com/private' },
  ] }));
  await agent.open(); const result = await agent.start('INVALID_SOURCES', 'invalid-sources').completion;
  assert.equal(result.outcome, 'completed');
  const snapshot = await agent.snapshot();
  assert.deepEqual(metadata(snapshot.messages).flatMap(value => value.sources), []);
  assert.doesNotMatch(messagesText(snapshot.messages), /javascript:|file:\/\/|user:password/);
});

test('native search raw metadata cannot bypass secret masking before native persistence', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  const secretBlocks = structuredClone(SEARCH_BLOCKS);
  const secretResult = secretBlocks[2].content; assert.ok(secretResult);
  secretResult[0].title = 'Synthetic accidental key synthetic-native-search-only-key';
  secretResult[0].encrypted_content = 'synthetic-native-search-only-key';
  f.respond((record, response) => anthropic(response, record.body, secretBlocks));
  await agent.open(); await agent.start('REDACT_NATIVE_METADATA', 'native-search-redaction').completion;
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  assert.ok(metadata(snapshot.messages).length > 0, 'redaction covers actual captured metadata');
  for (const value of [JSON.stringify(f.events), JSON.stringify(snapshot), await readFile(snapshot.sessionFile, 'utf8')]) assert.ok(!value.includes('synthetic-native-search-only-key'), 'raw Provider capture cannot write the configured secret into events or JSONL');
});

test('business workspaces and fixed/protected profiles do not acquire ordinary native search', { timeout: 45_000 }, async t => {
  const f = await fixture(t);
  for (const mode of ['workspace', 'fixed-draft', 'text-only', ...(process.platform === 'darwin' ? ['protected'] : [])]) {
    const cwd = path.join(f.options.projectDirectory!, '020_clean');
    const agent = f.create({ sessionDirectory: path.join(f.root, 'excluded', mode), ...(mode === 'protected'
      ? { protectedExecution: { id: 'native-search-excluded', profile: 'protected', cwd, writableRoot: cwd, readRoots: [] } }
      : { workspace: { cwd, systemPrompt: ['Synthetic excluded resource.'], ...(mode === 'workspace' ? {} : { defaultTools: [], capabilityPolicy: mode as 'fixed-draft' | 'text-only' }) } }) });
    await agent.open(); const result = await agent.start('EXCLUDED_NATIVE_SEARCH', `excluded-${mode}`).completion;
    assert.equal(result.outcome, 'completed');
    assert.ok(!f.requests.at(-1)!.body.tools?.some((tool: any) => tool.type === 'web_search_20250305' || tool.type === 'web_search'), `${mode} cannot gain native search by loading a task factory`);
    await agent.close();
  }
});

test('ordinary managed tasks retain native search without widening tool execution permissions', { skip: process.platform !== 'darwin', timeout: 30_000 }, async t => {
  const f = await fixture(t), cwd = path.join(f.options.projectDirectory!, '020_clean');
  f.respond((record, response) => anthropic(response, record.body, SEARCH_BLOCKS));
  const agent = f.create({ protectedExecution: { id: 'native-search-ordinary', profile: 'ordinary', cwd, writableRoot: cwd, readRoots: [] } });
  const opened = await agent.open(); assert.ok(opened.capabilities.protectedExecution);
  const result = await agent.start('MANAGED_NATIVE_SEARCH', 'managed-native-search').completion;
  assert.equal(result.outcome, 'completed');
  assert.ok(f.requests[0].body.tools.some((tool: any) => tool.type === 'web_search_20250305'));
  assert.ok(metadata((await agent.snapshot()).messages).some(value => value.sources.some((source: any) => source.url === SOURCE.url)));
  await agent.drain();
});

test('DeepSeek existing Chat Completions preserves ordinary tools and does not silently switch or declare unsupported search', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'openai-completions', 'deepseek'), agent = f.create();
  await agent.open(); const result = await agent.start('ORDINARY_DEEPSEEK', 'deepseek-no-native-search').completion;
  assert.equal(result.outcome, 'completed'); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.model, 'deepseek-flash'); assert.ok(declarations(f.requests[0].body).includes('read'));
  assert.ok(!f.requests[0].body.tools.some((tool: any) => tool.type === 'web_search'));
  assert.deepEqual(metadata((await agent.snapshot()).messages), []);
});

test('real delegated SDK sessions inherit native search only when the role tool scope permits it', { timeout: 40_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  const skillRoot = path.join(f.options.resourceRoot, 'skills', 'web'), roleRoot = path.join(skillRoot, 'agents');
  await mkdir(roleRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: web\ndescription: Synthetic native search role fixture.\n---\nUse the bundled roles for this isolated fixture.\n');
  await writeFile(path.join(roleRoot, 'searcher.md'), '---\nname: searcher\ndescription: Synthetic search role with read and native search.\ntools: [read, web_search]\n---\nFIXTURE_NATIVE_SEARCHER\n');
  await writeFile(path.join(roleRoot, 'reader.md'), '---\nname: reader\ndescription: Synthetic local read-only role without native search.\ntools: [read]\n---\nFIXTURE_NATIVE_READER\n');
  let activeRole = 'searcher';
  const role = (body: any) => {
    const system = messagesText([{ content: body.system }]);
    return system.includes('FIXTURE_NATIVE_SEARCHER') ? 'searcher' : system.includes('FIXTURE_NATIVE_READER') ? 'reader' : undefined;
  };
  f.respond((record, response) => {
    const childRole = role(record.body);
    if (childRole === 'searcher') {
      const continued = record.body.messages.some((message: any) => message.role === 'assistant' && Array.isArray(message.content) && message.content.some((block: any) => block.type === 'web_search_tool_result'));
      anthropic(response, record.body, continued ? [{ type: 'text', text: `CHILD_SEARCH_DONE ${SOURCE.url}` }] : SEARCH_BLOCKS, continued ? 'end_turn' : 'pause_turn');
    } else if (childRole === 'reader') anthropic(response, record.body, [{ type: 'text', text: 'CHILD_READ_ONLY_DONE' }]);
    else {
      const latest = record.body.messages.at(-1);
      const hasResult = latest?.role === 'user' && Array.isArray(latest.content) && latest.content.some((block: any) => block.type === 'tool_result');
      anthropic(response, record.body, hasResult ? [{ type: 'text', text: 'PARENT_DELEGATED_DONE ' + JSON.stringify(latest.content) }] : [{ type: 'tool_use', id: `delegate-native-${activeRole}`, name: 'subagent', input: { agent: `web/${activeRole}`, task: 'CHILD_PUBLIC_TASK' } }], hasResult ? 'end_turn' : 'tool_use');
    }
  });
  await agent.open();
  for (const nextRole of ['searcher', 'reader']) {
    activeRole = nextRole;
    const result = await agent.start(`PARENT_PRIVATE_${nextRole}`, `delegated-native-${nextRole}`).completion;
    assert.equal(result.outcome, 'completed');
    assert.match(result.text, nextRole === 'searcher' ? /CHILD_SEARCH_DONE/ : /CHILD_READ_ONLY_DONE/);
    if (nextRole === 'searcher') assert.ok(result.text.includes(SOURCE.url), 'actual child native sources return through the parent tool result');
  }
  const searcher = f.requests.filter(record => role(record.body) === 'searcher'), reader = f.requests.filter(record => role(record.body) === 'reader');
  assert.equal(searcher.length, 2, 'permitted child search uses the same SDK native continuation'); assert.equal(reader.length, 1);
  for (const record of [...searcher, ...reader]) {
    assert.equal(record.body.model, 'MiniMax-M3'); assert.ok(record.usedFrozenCredential);
    assert.equal(record.body.messages.filter((message: any) => message.role === 'user').length, 1);
    assert.doesNotMatch(JSON.stringify(record.body.messages), /PARENT_PRIVATE_/);
    const clientTools = record.body.tools.filter((tool: any) => !['web_search_20250305', 'web_search'].includes(tool.type));
    assert.deepEqual(clientTools.map((tool: any) => tool.name), ['read'], 'role tools remain narrowed while server search is separately declared');
    assert.equal(record.body.tools.some((tool: any) => tool.type === 'web_search_20250305'), role(record.body) === 'searcher', 'a read-only role cannot acquire native search through the shared model factory');
  }
  assert.deepEqual(searcher[1].body.messages.filter((message: any) => message.role === 'assistant').at(-1)?.content, SEARCH_BLOCKS);
});

// Permanent regressions derived from the independent candidate-v1 review.
// Historical failing probes remain separate; these exercise the repaired code.
test('an unclosed native search input cannot be saved as complete evidence or trigger continuation', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  f.respond((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (type: string, value: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    send('message_start', { message: { id: 'incomplete-native-input', type: 'message', role: 'assistant', model: record.body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'PARTIAL_NATIVE_REPLY' } });
    send('content_block_stop', { index: 0 });
    send('content_block_start', { index: 1, content_block: { type: 'server_tool_use', id: 'incomplete-search', name: 'web_search', input: {} } });
    send('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"unfinished' } });
    // Even an apparent terminal message cannot complete this missing block_stop.
    send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    send('message_stop', {}); response.end();
  });
  await agent.open(); const result = await agent.start('PARTIAL_NATIVE_INPUT', 'native-search-unclosed-input').completion;
  assert.equal(result.outcome, 'failed', 'incomplete native parameters cannot be replaced with an empty input and reported completed');
  assert.equal(f.requests.length, 1, 'invalid raw evidence cannot schedule another model request');
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  assert.deepEqual(metadata(snapshot.messages), []);
  assert.ok(!(await readFile(snapshot.sessionFile, 'utf8')).includes('optracallNativeSearch'), 'the actual JSONL contains no falsely completed receipt');
  await agent.close(); await f.create({ sessionFile: snapshot.sessionFile }).open();
  assert.equal(f.requests.length, 1, 'reopening incomplete history does not replay its raw tool request');
});

test('deeply nested valid Provider JSON fails closed without a swallowed stream-hook exception', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'openai-completions'), agent = f.create();
  // Build JSON text directly so test-side JSON.stringify recursion is irrelevant.
  const annotations = '['.repeat(12_000) + JSON.stringify({ type: 'url_citation', ...SOURCE }) + ']'.repeat(12_000);
  assert.doesNotThrow(() => JSON.parse(annotations), 'the fixture is valid JSON, rather than a parser failure');
  f.respond((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"id":"deep-native","object":"chat.completion.chunk","created":1,"model":' + JSON.stringify(record.body.model) + ',"choices":[{"index":0,"delta":{"role":"assistant","content":"DEEP_PROVIDER_REPLY","annotations":' + annotations + '},"finish_reason":null}]}\n\n');
    response.write('data: ' + JSON.stringify({ id: 'deep-native', object: 'chat.completion.chunk', created: 1, model: record.body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
    response.end('data: [DONE]\n\n');
  });
  await agent.open(); const result = await agent.start('DEEP_NATIVE_DATA', 'native-search-deep-json').completion;
  assert.equal(result.outcome, 'failed', 'losing raw source evidence cannot become a completed model result');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(metadata((await agent.snapshot()).messages), []);
  assert.deepEqual(f.events.filter(event => event.type === 'native' && event.event?.type === 'extension_error' && event.event.error?.event === 'provider_stream_event'), [], 'the adapter catches collection failures rather than relying on SDK hook exception swallowing');
  assert.equal(f.events.filter(event => event.type === 'run.settled' && event.requestId === 'native-search-deep-json' && event.outcome === 'completed').length, 0);
});

test('native evidence size admission uses UTF-8 bytes rather than multibyte character count', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  const large = structuredClone(SEARCH_BLOCKS), resultBlock = large[2].content; assert.ok(resultBlock);
  resultBlock[0].encrypted_content = '中'.repeat(3 * 1024 * 1024);
  const raw = JSON.stringify(large);
  assert.ok(raw.length < 8 * 1024 * 1024, 'the regression input fits below 8 MiB when incorrectly counted as characters');
  assert.ok(Buffer.byteLength(raw, 'utf8') > 8 * 1024 * 1024, 'the same evidence actually exceeds the byte limit');
  assert.ok(Buffer.byteLength(raw, 'utf8') < 16 * 1024 * 1024, 'this case reaches receipt admission instead of relying on the higher stream cap');
  f.respond((record, response) => anthropic(response, record.body, large));
  await agent.open(); const result = await agent.start('MULTIBYTE_NATIVE_EVIDENCE', 'native-search-byte-limit').completion;
  assert.equal(result.outcome, 'failed', 'a multibyte receipt larger than 8 MiB cannot be reported completed');
  assert.equal(f.requests.length, 1);
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  assert.deepEqual(metadata(snapshot.messages), []);
  assert.ok(!(await readFile(snapshot.sessionFile, 'utf8')).includes('optracallNativeSearch'), 'oversized raw evidence is not silently persisted');
});

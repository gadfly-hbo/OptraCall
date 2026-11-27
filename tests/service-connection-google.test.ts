import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { McpClient, ModelRuntime, createMcpExtension, DefaultResourceLoader, createAgentSession, SettingsManager, SessionManager } from '../src/agent/sdk.ts';
import { createGoogleMcpTransport, GoogleMcpTransportError, type GoogleElicitationRequest, type GoogleElicitationResponse, type GoogleMcpTransportOptions } from '../src/host/service-connection-google-transport.ts';
import { SERVICE_URLS } from '../src/host/service-connection-types.ts';

type Request = { jsonrpc: '2.0'; id: number; method: string; params: Record<string, any> };
type RecordedRequest = Request & { authorization?: string };
function result(res: ServerResponse, request: Request, value: unknown, sse = false): void {
  const payload = { jsonrpc: '2.0', id: request.id, result: value };
  res.setHeader('content-type', sse ? 'text/event-stream' : 'application/json');
  if (sse) {
    const json = JSON.stringify(payload);
    const split = json.indexOf(',');
    const encoded = Buffer.from(`: keep-alive\r\nevent: message\r\ndata: ${json.slice(0, split + 1)}\r\ndata: ${json.slice(split + 1)}\r\n\r\n`);
    // Byte-level chunks include partial UTF-8 characters and CRLF boundaries.
    for (let offset = 0; offset < encoded.length; offset += 3) res.write(encoded.subarray(offset, offset + 3));
    res.end();
  } else res.end(JSON.stringify(payload));
}
function discovery(res: ServerResponse, request: Request): void { result(res, request, { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'synthetic-gmail', version: '2026' } } }); }
async function localServer(handle: (request: RecordedRequest, res: ServerResponse, raw: IncomingMessage) => void | Promise<void>) {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (req, res) => {
    try {
      const bytes: Buffer[] = []; for await (const chunk of req) bytes.push(Buffer.from(chunk));
      const request = { ...JSON.parse(Buffer.concat(bytes).toString()), authorization: req.headers.authorization } as RecordedRequest;
      requests.push(request);
      assert.equal(req.headers['mcp-protocol-version'], '2026-07-28');
      assert.equal(req.method, 'POST');
      await handle(request, res, req);
    } catch { if (!res.headersSent) res.statusCode = 500; res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const local = `http://127.0.0.1:${address.port}/mcp`;
  return {
    requests,
    fetch: async (input: string | URL, init?: RequestInit) => { assert.equal(String(input), SERVICE_URLS.gmail); assert.equal(init?.redirect, 'error'); return fetch(local, init); },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
async function connected(fetchFn: GoogleMcpTransportOptions['fetch'], options: Omit<GoogleMcpTransportOptions, 'fetch'> = {}) {
  const transport = createGoogleMcpTransport({ fetch: fetchFn, authProvider: { token: async () => 'synthetic-private-token' }, ...options });
  const client = new McpClient({ name: 'synthetic-test', version: '1', requestTimeoutMs: 1000 });
  await client.connect(transport);
  return { transport, client };
}
function form(message: string, field = 'choice') {
  return { method: 'elicitation/create', params: { mode: 'form', message, requestedSchema: { type: 'object', additionalProperties: false, required: [field], properties: { [field]: { type: 'string', title: '请选择', enum: ['ALLOW_ONCE', 'DENY_ONCE'], enumNames: ['允许一次', '拒绝'] } } } } };
}
function pendingForm() {
  let resolve!: (value: GoogleElicitationResponse) => void, shown!: (value: GoogleElicitationRequest) => void;
  const ready = new Promise<GoogleElicitationRequest>(done => { shown = done; });
  const elicit = (request: GoogleElicitationRequest) => { shown(request); return new Promise<GoogleElicitationResponse>(done => { resolve = done; }); };
  return { ready, elicit, reply: (value: GoogleElicitationResponse) => resolve(value) };
}
const allow: GoogleElicitationResponse = { action: 'accept', content: { choice: 'ALLOW_ONCE' } };

test('GG07 native Pi client discovers Google 2026 and reads paginated JSON/SSE tools without an initialize wire call', async t => {
  const server = await localServer((request, res) => {
    if (request.method === 'server/discover') return discovery(res, request);
    assert.equal(request.authorization, 'Bearer synthetic-private-token');
    assert.equal(request.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
    assert.deepEqual(request.params._meta['io.modelcontextprotocol/clientCapabilities'], { elicitation: { form: {} } });
    if (request.method === 'tools/list') return result(res, request, { tools: [{ name: request.params.cursor ? 'get_thread' : 'get_message', description: '读取合成邮件', inputSchema: { type: 'object', properties: {} } }], ...(request.params.cursor ? {} : { nextCursor: 'page-two' }) }, !!request.params.cursor);
    result(res, request, { resultType: 'complete', content: [{ type: 'text', text: '合成邮件，分页完成' }], structuredContent: { id: 'mail-2', cursor: 'safe' } }, true);
  }); t.after(server.close);
  const { client } = await connected(server.fetch); t.after(() => client.close());
  assert.equal(client.serverInfo?.name, 'synthetic-gmail');
  assert.deepEqual((await client.listTools()).map(tool => tool.name), ['get_message', 'get_thread']);
  const reply = await client.callTool('get_message', { id: 'mail-2' });
  assert.equal(reply.content[0]?.type, 'text'); assert.equal((reply.content[0] as { text: string }).text, '合成邮件，分页完成');
  assert.deepEqual(reply.structuredContent, { id: 'mail-2', cursor: 'safe' });
  assert.deepEqual(server.requests.map(request => request.method), ['server/discover', 'tools/list', 'tools/list', 'tools/call']);
});

test('GG08 native call remains pending across multiple provider forms and continues unchanged arguments with exact requestState', async t => {
  let effects = 0;
  const server = await localServer((request, res) => {
    if (request.method === 'server/discover') return discovery(res, request);
    if (!request.params.requestState) return result(res, request, { resultType: 'input_required', requestState: 'opaque-state-do-not-log', inputRequests: { first: form('确认发件人'), second: form('确认收件人') } }, true);
    assert.equal(request.params.requestState, 'opaque-state-do-not-log');
    assert.deepEqual(request.params.inputResponses, { first: allow, second: allow });
    assert.equal(request.params._meta.requestState, undefined); effects++;
    result(res, request, { resultType: 'complete', content: [{ type: 'text', text: 'sent' }] });
  }); t.after(server.close);
  const first = pendingForm(), second = pendingForm(); let forms = 0;
  const { client } = await connected(server.fetch, { elicit: request => (++forms === 1 ? first : second).elicit(request) }); t.after(() => client.close());
  const args = { to: ['recipient@example.test'], body: 'exact original content' };
  let settled = false;
  const call = client.callTool('send_message', args).finally(() => { settled = true; });
  assert.equal((await first.ready).key, 'first'); assert.equal(settled, false); assert.equal(effects, 0);
  first.reply(allow);
  const card = await second.ready; assert.equal(card.key, 'second'); assert.deepEqual(card.arguments, args); assert.equal(settled, false);
  second.reply(allow); await call;
  const calls = server.requests.filter(request => request.method === 'tools/call');
  assert.equal(calls.length, 2); assert.deepEqual(calls[0]?.params.arguments, calls[1]?.params.arguments); assert.equal(effects, 1);
});

test('GG08 provider cancel is returned inside the original call, invalid/edited form content cannot continue it', async t => {
  let effects = 0;
  const server = await localServer((request, res) => {
    if (request.method === 'server/discover') return discovery(res, request);
    if (!request.params.requestState) return result(res, request, { resultType: 'input_required', requestState: 'one-call', inputRequests: { first: form('Confirm immutable send content') } });
    if (request.params.inputResponses.first.action !== 'accept') return result(res, request, { resultType: 'complete', isError: true, content: [{ type: 'text', text: 'User cancelled' }] });
    effects++; result(res, request, { content: [{ type: 'text', text: 'sent' }] });
  }); t.after(server.close);
  const { client } = await connected(server.fetch, { elicit: async () => ({ action: 'cancel' }) }); t.after(() => client.close());
  assert.equal((await client.callTool('send_message', { body: 'fixed' })).isError, true); assert.equal(effects, 0);
  const invalid = await connected(server.fetch, { elicit: async () => ({ action: 'accept', content: { choice: 'ALLOW_ONCE', body: 'edited body' } }) }); t.after(() => invalid.client.close());
  await assert.rejects(invalid.client.callTool('send_message', { body: 'fixed' }), /gmail_form_response_invalid/);
  assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 3); assert.equal(effects, 0);
});

test('GG08 cancellation, native timeout, close and stale binding invalidate late provider decisions', async t => {
  for (const mode of ['abort', 'timeout', 'close', 'stale'] as const) {
    const server = await localServer((request, res) => {
      if (request.method === 'server/discover') return discovery(res, request);
      result(res, request, { resultType: 'input_required', requestState: 'same-call', inputRequests: { first: form('Confirm') } });
    }); t.after(server.close);
    const ui = pendingForm(), cancel = new AbortController(); let current = true;
    const { client } = await connected(server.fetch, { elicit: ui.elicit, isCurrent: () => current }); t.after(() => client.close());
    const call = client.callTool('send_message', { body: 'fixed' }, { signal: cancel.signal, timeoutMs: mode === 'timeout' ? 40 : 1000 });
    const rejected = assert.rejects(call);
    await ui.ready;
    if (mode === 'abort') cancel.abort();
    if (mode === 'close') await client.close();
    if (mode === 'stale') current = false;
    if (mode !== 'timeout') ui.reply(allow);
    await rejected; ui.reply(allow); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 1, `${mode} never dispatches a continuation`);
  }
});

test('GG07 401 performs one native authorization recovery; repeated rejection and 403 never become retry loops', async t => {
  for (const mode of ['refresh', 'repeat', 'scope'] as const) {
    let calls = 0, refreshes = 0, token = 'expired';
    const server = await localServer((request, res) => {
      if (request.method === 'server/discover') return discovery(res, request);
      calls++;
      if (mode === 'scope' || mode === 'repeat' || calls === 1) { res.statusCode = mode === 'scope' ? 403 : 401; res.setHeader('www-authenticate', 'Bearer error="invalid_token"'); res.end('synthetic-private-token secret upstream body'); return; }
      assert.equal(request.authorization, 'Bearer current'); result(res, request, { content: [{ type: 'text', text: 'ok' }] });
    }); t.after(server.close);
    const { client } = await connected(server.fetch, { authProvider: { token: async () => token, onUnauthorized: async context => { refreshes++; assert.equal(context.token, 'expired'); assert.equal(await context.response.text(), ''); token = 'current'; } } }); t.after(() => client.close());
    if (mode === 'refresh') await client.callTool('get_message', {});
    else await assert.rejects(client.callTool('get_message', {}), error => { assert(!String(error).includes('secret')); return true; });
    assert.equal(calls, mode === 'scope' ? 1 : 2); assert.equal(refreshes, mode === 'scope' ? 0 : 1);
  }
});

test('GG09 lost effect response, HTTP failure and malformed responses are not replayed and redact raw errors', async t => {
  for (const mode of ['lost', 'http', 'wrong-id', 'large', 'malformed'] as const) {
    let effects = 0;
    const server = await localServer((request, res) => {
      if (request.method === 'server/discover') return discovery(res, request);
      effects++;
      if (mode === 'lost') { res.destroy(new Error('synthetic-private-token')); return; }
      if (mode === 'http') { res.statusCode = 503; res.end('synthetic-private-token'); return; }
      res.setHeader('content-type', 'application/json');
      if (mode === 'large') { res.end('x'.repeat(4096)); return; }
      if (mode === 'malformed') { res.end('{synthetic-private-token'); return; }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id + 1, result: { content: [] } }));
    }); t.after(server.close);
    const { client } = await connected(server.fetch, { maxResponseBytes: 1024 }); t.after(() => client.close());
    await assert.rejects(client.callTool('send_message', {}), error => { assert(!String(error).includes('synthetic-private-token')); assert(error instanceof GoogleMcpTransportError); assert.equal(error.unknownOutcome, true); return true; });
    assert.equal(effects, 1); assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 1);
  }
});

test('GG08 unsupported provider schemas fail closed with no speculative confirmation or effect', async t => {
  let shown = false;
  const server = await localServer((request, res) => {
    if (request.method === 'server/discover') return discovery(res, request);
    const unsupported = form('unsupported'); unsupported.params.requestedSchema.properties.choice = { type: 'object', properties: { nested: {} } } as never;
    result(res, request, { resultType: 'input_required', requestState: 'state', inputRequests: { first: unsupported } });
  }); t.after(server.close);
  const { client } = await connected(server.fetch, { elicit: async () => { shown = true; return allow; } }); t.after(() => client.close());
  await assert.rejects(client.callTool('send_message', {}), /gmail_form_unsupported/);
  assert.equal(shown, false); assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 1);
});

test('GG07 public Pi createMcpExtension receives the native auth hook and registers Google tools through the adapter', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'optracall-google-transport-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await localServer((request, res) => {
    if (request.method === 'server/discover') return discovery(res, request);
    assert.equal(request.authorization, 'Bearer synthetic-factory-token');
    result(res, request, { tools: [{ name: 'get_message', description: 'synthetic', inputSchema: { type: 'object', properties: {} } }] });
  }); t.after(server.close);
  const runtime = await ModelRuntime.create({ credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {} }, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider('synthetic-gmail', { api: 'openai-completions', baseUrl: 'https://invalid.example', models: [] });
  await runtime.setRuntimeApiKey('synthetic-gmail', 'synthetic-factory-token');
  let factories = 0;
  const extension = createMcpExtension({ loadConfig: () => ({ servers: [{ name: 'gmail-test', scope: 'extension', source: 'synthetic-test', config: { url: SERVICE_URLS.gmail, auth: { provider: 'synthetic-gmail' }, exposure: 'direct' } }], errors: [] }), createTransport: (_entry, _cwd, authProvider) => { factories++; assert(authProvider); return createGoogleMcpTransport({ authProvider, fetch: server.fetch }); }, logPath: join(directory, 'mcp.log') });
  const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true, disabledBuiltinExtensions: ['mcp', 'codemode', 'tool_search'], extensionFactories: [extension] }); await loader.reload();
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, resourceLoader: loader, settingsManager: SettingsManager.inMemory({}), sessionManager: SessionManager.inMemory(directory), modelRuntime: runtime, noTools: 'builtin' }); t.after(() => session.dispose());
  await session.bindExtensions({ mode: 'rpc' });
  const deadline = Date.now() + 2000;
  while (!session.getAllTools().some(tool => tool.name === 'mcp__gmail_test__get_message') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(factories, 1); assert(session.getAllTools().some(tool => tool.name === 'mcp__gmail_test__get_message'));
});

test('GG08 malformed provider form defaults and contradictory bounds are rejected before presenting or continuing', async t => {
  const invalidFields = [
    { type: 'string', default: { unsafe: 'nested object' } },
    { type: 'boolean', default: 'yes' },
    { type: 'integer', minimum: 10, maximum: 1 },
    { type: 'string', minLength: 10, maxLength: 1 },
    { type: 'string', oneOf: [{ const: 'same', title: 'One' }, { const: 'same', title: 'Two' }] },
    { type: 'array', items: { type: 'string', enum: ['one'] }, default: ['forbidden'] },
  ];
  for (const field of invalidFields) {
    let shown = false, effects = 0;
    const server = await localServer((request, res) => {
      if (request.method === 'server/discover') return discovery(res, request);
      if (request.params.requestState) { effects++; return result(res, request, { content: [] }); }
      result(res, request, { resultType: 'input_required', requestState: 'opaque', inputRequests: { first: { method: 'elicitation/create', params: { mode: 'form', message: 'Synthetic unsupported form', requestedSchema: { type: 'object', properties: { choice: field } } } } } });
    }); t.after(server.close);
    const { client } = await connected(server.fetch, { elicit: async () => { shown = true; return { action: 'accept', content: {} }; } }); t.after(() => client.close());
    await assert.rejects(client.callTool('send_message', {}), /gmail_form_unsupported/);
    assert.equal(shown, false); assert.equal(effects, 0);
  }
});

test('GG08 the UI receives a schema copy and cannot widen the accepted provider options or original arguments', async t => {
  const server = await localServer((request, res) => {
    if (request.method === 'server/discover') return discovery(res, request);
    result(res, request, { resultType: 'input_required', requestState: 'opaque', inputRequests: { first: form('Confirm immutable provider choices') } });
  }); t.after(server.close);
  const { client } = await connected(server.fetch, { elicit: async request => {
    (request.requestedSchema.properties as Record<string, any>).choice.enum.push('FORGED');
    request.arguments.body = 'edited';
    return { action: 'accept', content: { choice: 'FORGED' } };
  } }); t.after(() => client.close());
  await assert.rejects(client.callTool('send_message', { body: 'immutable body' }), /gmail_form_response_invalid/);
  assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 1);
  assert.equal(server.requests.at(-1)?.params.arguments.body, 'immutable body');
});

test('GG12 provider forms cannot request credentials through ordinary confirmation UI', async t => {
  for (const field of ['password', 'access_token', 'refreshToken', 'clientSecret', 'authorizationCode', 'auth_code', 'credentials', 'authorization', 'token', 'apiKey']) {
    let shown = false;
    const server = await localServer((request, res) => {
      if (request.method === 'server/discover') return discovery(res, request);
      if (request.params.requestState) return result(res, request, { isError: true, content: [] });
      result(res, request, { resultType: 'input_required', requestState: 'opaque', inputRequests: { first: { method: 'elicitation/create', params: { mode: 'form', message: 'Unsupported credential prompt', requestedSchema: { type: 'object', properties: { [field]: { type: 'string' } } } } } } });
    }); t.after(server.close);
    const { client } = await connected(server.fetch, { elicit: async () => { shown = true; return { action: 'cancel' }; } }); t.after(() => client.close());
    await assert.rejects(client.callTool('send_message', {}), /gmail_form_unsupported/);
    assert.equal(shown, false, field); assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 1);
  }
});

test('GG07 Google native call accepts a one MiB attachment and a bounded four MiB argument object, rejecting larger arguments before dispatch', async t => {
  const server = await localServer((request, res) => {
    if (request.method === 'server/discover') return discovery(res, request);
    assert.equal(request.method, 'tools/call');
    result(res, request, { resultType: 'complete', content: [{ type: 'text', text: 'Synthetic attachment accepted' }] });
  }); t.after(server.close);
  const client = new McpClient({ name: 'bounded-request-test', version: '1', requestTimeoutMs: 10000 });
  await client.connect(createGoogleMcpTransport({ fetch: server.fetch, timeoutMs: 10000 })); t.after(() => client.close());
  const attachment = Buffer.alloc(1024 * 1024, 7).toString('base64');
  const argumentsWithAttachment = { to: 'synthetic@example.invalid', subject: 'Bounded attachment', body: 'Synthetic body', attachments: [{ filename: 'synthetic.bin', mimeType: 'application/octet-stream', data: attachment }] };
  await client.callTool('send_message', argumentsWithAttachment);
  assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 1);
  const nearLimit = { value: 'x'.repeat(4 * 1024 * 1024 - 32) };
  await client.callTool('send_message', nearLimit);
  assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 2);
  await assert.rejects(client.callTool('send_message', { value: 'x'.repeat(4 * 1024 * 1024) }), error => error instanceof GoogleMcpTransportError && error.code === 'gmail_payload_too_large');
  assert.equal(server.requests.filter(request => request.method === 'tools/call').length, 2, 'oversized arguments never reach remote MCP');
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createHost } from '../src/host/server.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const repository = { owner: 'synthetic-team', repo: 'service-fixture' };
const fileArgs = { ...repository, path: 'README.md' };
const commentArgs = { ...repository, issue_number: 145, body: 'Exact synthetic issue comment.' };
const readTool = { name: 'get_file_contents', description: 'Read a synthetic repository file.', inputSchema: { type: 'object', additionalProperties: false, properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' } }, required: ['owner', 'repo', 'path'] } };
const commentTool = { name: 'add_issue_comment', description: 'Add an exact synthetic issue comment.', inputSchema: { type: 'object', additionalProperties: false, properties: { owner: { type: 'string' }, repo: { type: 'string' }, issue_number: { type: 'integer' }, body: { type: 'string' } }, required: ['owner', 'repo', 'issue_number', 'body'] } };
const gmailSendTool = { name: 'send_message', description: 'Send an explicit synthetic mail.', inputSchema: { type: 'object', additionalProperties: false, properties: {
  to: { type: 'array', items: { type: 'string' } }, cc: { type: 'array', items: { type: 'string' } }, bcc: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, body: { type: 'string' }, htmlBody: { type: 'string' }, includeSignature: { type: 'boolean' }, attachments: { type: 'array', items: { type: 'object' } },
}, required: ['to', 'subject', 'body'] } };
type Rpc = { id?: string | number; method?: string; params?: Record<string, any> };
type Wire = { endpoint: string; method: string; rpc: Rpc; authorization?: string };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

async function until<T>(read: () => T | undefined | Promise<T | undefined>, message: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) { const value = await read(); if (value !== undefined) return value; if (Date.now() >= deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 15)); }
}

/** Only the fixed upstream URLs are mapped. All Host, Pi worker and MCP protocol code is real. */
async function fixture(t: TestContext, service: 'github' | 'gmail' = 'github') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-service-host-flow-'));
  const pat = `synthetic-service-private-${randomUUID()}`, originalFetch = globalThis.fetch;
  const provider = await startToolProvider(), logs: string[] = [], apiResponses: unknown[] = [], wire: Wire[] = [], observations: Array<Record<string, any>> = [];
  const state = { effects: 0, loseWrite: false, holdRead: false, closedReads: 0, readStarted: deferred<void>(), gmailArguments: undefined as Record<string, unknown> | undefined };
  const held = new Set<ServerResponse>(), streams: Array<() => Promise<void>> = [];
  let host: ReturnType<typeof createHost> | undefined;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8'), rpc: Rpc = text ? JSON.parse(text) : {}, endpoint = String(request.headers['x-original-url']);
      wire.push({ endpoint, method: request.method!, rpc, authorization: request.headers.authorization });
      assert.equal(request.headers.authorization, `Bearer ${pat}`);
      const json = (value: unknown) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      const result = (value: unknown) => response.writeHead(200, { 'content-type': 'application/json', ...(service === 'github' ? { 'mcp-session-id': 'synthetic-native-session' } : {}) }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: value }));
      if (endpoint === 'https://api.github.com/user') { json({ id: 9001, login: 'synthetic-account' }); return; }
      if (endpoint === `https://api.github.com/repos/${repository.owner}/${repository.repo}`) { json({ full_name: `${repository.owner}/${repository.repo}` }); return; }
      if (endpoint === 'https://openidconnect.googleapis.com/v1/userinfo') { json({ sub: 'synthetic-google-sub', email: 'sender@example.invalid', email_verified: true }); return; }
      if (request.method === 'DELETE') { response.writeHead(204).end(); return; }
      if (rpc.method === 'initialize') { result({ protocolVersion: '2025-11-25', serverInfo: { name: 'synthetic-native-github', version: '1' }, capabilities: { tools: {} } }); return; }
      if (rpc.method === 'server/discover') {
        assert.equal(request.headers['mcp-protocol-version'], '2026-07-28');
        result({ resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'synthetic-official-gmail', version: '2026' } } }); return;
      }
      if (rpc.method?.startsWith('notifications/')) { response.writeHead(202).end(); return; }
      if (rpc.method === 'tools/list') {
        result({ tools: service === 'github' ? [{ ...readTool, inputSchema: { ...readTool.inputSchema, description: `Synthetic upstream secret echo ${pat}` } }, commentTool] : [
          { name: 'get_message', inputSchema: { type: 'object', properties: { messageId: { type: 'string' } } } }, gmailSendTool,
        ] }); return;
      }
      if (rpc.method === 'tools/call') {
        const params = rpc.params!;
        if (params.name === 'get_file_contents') {
          assert.deepEqual(params.arguments, fileArgs);
          if (state.holdRead) { held.add(response); response.on('close', () => { held.delete(response); state.closedReads++; }); state.readStarted.resolve(); return; }
          result({ content: [{ type: 'text', text: `SYNTHETIC_REPOSITORY_TEXT ${pat}` }] }); return;
        }
        if (params.name === 'add_issue_comment') {
          assert.deepEqual(params.arguments, commentArgs); state.effects++;
          if (state.loseWrite) { request.socket.destroy(); return; }
          result({ content: [{ type: 'text', text: `Created one synthetic comment. ${pat}` }], structuredContent: { id: 'comment-145' } }); return;
        }
        if (params.name === 'send_message') {
          if (!params.requestState) {
            state.gmailArguments = structuredClone(params.arguments);
            result({ resultType: 'input_required', requestState: 'synthetic-opaque-original-mail-state', inputRequests: { consent: { method: 'elicitation/create', params: { mode: 'form', message: 'Allow this exact already previewed message once.', requestedSchema: { type: 'object', additionalProperties: false, required: ['decision'], properties: { decision: { type: 'string', enum: ['ALLOW_ONCE', 'DENY_ONCE'] } } } } } } }); return;
          }
          assert.equal(params.requestState, 'synthetic-opaque-original-mail-state'); assert.deepEqual(params.arguments, state.gmailArguments);
          assert.deepEqual(params.inputResponses, { consent: { action: 'accept', content: { decision: 'ALLOW_ONCE' } } });
          state.effects++; result({ resultType: 'complete', content: [{ type: 'text', text: `Accepted one synthetic message. ${pat}` }], structuredContent: { id: 'gmail-message-145' } }); return;
        }
      }
      response.writeHead(400).end('Unexpected synthetic protocol request.');
    } catch (error) { logs.push(String(error)); if (!response.headersSent) response.writeHead(500); response.end('Synthetic protocol assertion failed.'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const upstream = server.address(); assert(upstream && typeof upstream === 'object');
  const mapper = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
    if (['https://api.githubcopilot.com/mcp/', 'https://api.github.com/user', `https://api.github.com/repos/${repository.owner}/${repository.repo}`, 'https://gmailmcp.googleapis.com/mcp/v1', 'https://openidconnect.googleapis.com/v1/userinfo'].includes(url.href)) {
      const headers = new Headers(init?.headers); headers.set('x-original-url', url.href);
      return originalFetch(`http://127.0.0.1:${upstream.port}/upstream`, { ...init, headers });
    }
    throw new Error('Unexpected external request in isolated service integration.');
  });
  const logger = t.mock.method(console, 'error', (...items: unknown[]) => { logs.push(items.map(String).join(' ')); });
  t.after(async () => {
    for (const close of streams) await close();
    for (const response of held) response.destroy();
    try { await host?.close(); } finally {
      await provider.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      mapper.mock.restore(); logger.mock.restore(); await rm(root, { recursive: true, force: true });
    }
  });
  host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: 'synthetic-service-full-flow', dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') });
  await host.ready; await new Promise<void>(resolve => host!.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = async (route: string, method = 'GET', body?: unknown, expected = 200): Promise<any> => {
    const response = await originalFetch(baseUrl + route, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, signal: AbortSignal.timeout(20_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); assert.equal(response.status, expected, `${method} ${route}: ${text}`); const value = JSON.parse(text); apiResponses.push(value); return value;
  };
  await request('/api/configuration', 'PUT', { name: 'Synthetic service analysis model', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-service-full-flow', apiKey: 'synthetic-service-model-only' });
  const saved = await request(`/api/service-connections/${service}`, 'PUT', { expectedRevision: 0, config: service === 'github' ? { scopes: ['read', 'collaborate'], repositories: [`${repository.owner}/${repository.repo}`] } : { scopes: ['read', 'send'], clientId: 'synthetic-desktop-client' }, credentials: { accessToken: pat } });
  const verified = await request(`/api/service-connections/${service}/verify`, 'POST', { expectedRevision: saved.connection.revision });
  const { project } = await request('/api/projects', 'POST', { name: 'Full service protocol project' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Original service task' }, 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  await request(`${route}/service-connections/${service}`, 'PUT', { enabled: true, scopes: service === 'github' ? ['read', 'collaborate'] : ['read', 'send'], expectedConnectionRevision: verified.connection.revision });
  const events = await originalFetch(baseUrl + route + '/events', { headers: { 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' } });
  assert.equal(events.status, 200); assert(events.body); const reader = events.body.getReader(), decoder = new TextDecoder();
  const pump = (async () => {
    let buffer = '';
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const line = block.split('\n').find(item => item.startsWith('data: ')); if (line) observations.push(JSON.parse(line.slice(6))); }
    } } catch (error) { logs.push(String(error)); }
  })();
  streams.push(async () => { await reader.cancel(); await pump; });
  const terminal = (requestId: string) => until(() => observations.find(event => event.type === 'run.settled' && event.requestId === requestId), 'Original Host operation did not settle.');
  const noSecrets = async () => {
    const snapshot = await request(route), native = snapshot.snapshot.sessionFile ? await readFile(snapshot.snapshot.sessionFile, 'utf8') : '';
    for (const [label, value] of Object.entries({ apiResponses, observations, modelRequests: provider.requests.map(item => item.body), toolArguments: wire.filter(item => item.rpc.method === 'tools/call').map(item => item.rpc.params?.arguments), native, logs })) assert.ok(!JSON.stringify(value).includes(pat), `Private service PAT leaked into ${label}`);
    return { snapshot, native };
  };
  return { root, provider, request, state, wire, observations, route, project, task, verified, terminal, noSecrets, logs };
}

test('GG06 actual Host/Pi worker/native MCP completes repository read and one collaboration write with an actor-bound native receipt', { timeout: 90_000 }, async t => {
  const f = await fixture(t), requestId = randomUUID();
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length === 0 ? { calls: [{ name: 'service_github_get_file_contents', arguments: fileArgs }] } : recentToolResults.length === 1 ? { calls: [{ name: 'service_github_add_issue_comment', arguments: commentArgs }] } : { text: 'SYNTHETIC_FULL_SERVICE_FLOW_COMPLETE' });
  await f.request(f.route + '/messages', 'POST', { requestId, text: 'Read the allowed synthetic README and add the exact synthetic issue comment.' }, 202);
  assert.equal((await f.terminal(requestId)).outcome, 'completed');
  assert.equal(f.state.effects, 1); assert.equal(f.wire.filter(item => item.rpc.method === 'tools/call').length, 2);
  const journal = await f.request(f.route + '/service-connections/operations');
  assert.equal(journal.total, 1); const operation = journal.operations[0];
  assert.equal(operation.projectId, f.project.id); assert.equal(operation.taskId, f.task.id); assert.equal(operation.requestId, requestId); assert.ok(operation.toolCallId);
  assert.equal(operation.accountId, '9001'); assert.equal(operation.status, 'succeeded'); assert.equal(operation.resultId, 'comment-145');
  assert.equal(operation.target.owner, repository.owner); assert.equal(operation.target.repo, repository.repo); assert.equal(operation.target.issue_number, 145);
  const { snapshot, native } = await f.noSecrets();
  assert.match(JSON.stringify(snapshot.snapshot.messages), /SYNTHETIC_REPOSITORY_TEXT/); assert.match(native, /SYNTHETIC_FULL_SERVICE_FLOW_COMPLETE/); assert.match(native, /comment-145/);
  assert.equal(f.provider.requests.length, 3); assert.deepEqual(f.provider.errors, []); assert.deepEqual(f.logs, []);
});

test('GG09 actual model retry with a new tool-call ID cannot repeat a lost native MCP write', { timeout: 90_000 }, async t => {
  const f = await fixture(t), requestId = randomUUID(); f.state.loseWrite = true;
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length < 2 ? { calls: [{ name: 'service_github_add_issue_comment', arguments: commentArgs }] } : { text: 'SYNTHETIC_UNKNOWN_PRESERVED_WITHOUT_REPLAY' });
  await f.request(f.route + '/messages', 'POST', { requestId, text: 'Submit the exact synthetic comment once and preserve uncertainty if its reply is lost.' }, 202);
  assert.equal((await f.terminal(requestId)).outcome, 'completed');
  assert.equal(f.state.effects, 1); assert.equal(f.wire.filter(item => item.rpc.method === 'tools/call').length, 1);
  const journal = await f.request(f.route + '/service-connections/operations');
  assert.equal(journal.total, 1); assert.equal(journal.operations[0].status, 'unknown'); assert.equal(journal.operations[0].requestId, requestId);
  const { native } = await f.noSecrets(); assert.match(native, /SYNTHETIC_UNKNOWN_PRESERVED_WITHOUT_REPLAY/); assert.match(native, /unknown/);
  assert.equal(f.provider.requests.length, 3); assert.deepEqual(f.provider.errors, []); assert.deepEqual(f.logs, []);
});

test('GG07/08 actual Host BrowserUI approval continues one unchanged Gmail MRTR call without a second confirmation', { timeout: 90_000 }, async t => {
  const f = await fixture(t, 'gmail'), requestId = randomUUID(), args = { to: ['recipient@example.invalid'], cc: [], bcc: [], subject: 'Exact full-flow subject', body: 'Exact full-flow message body.', includeSignature: false };
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'SYNTHETIC_GMAIL_MRTR_COMPLETE' } : { calls: [{ name: 'service_gmail_send_message', arguments: args }] });
  await f.request(f.route + '/messages', 'POST', { requestId, text: 'Send this exact synthetic message only after the original Host preview is approved.' }, 202);
  const question = await until(() => f.observations.find(event => event.type === 'ui.request' && event.requestId === requestId), 'Original Host mail approval was not shown.');
  assert.equal(question.request.method, 'confirm'); assert.match(question.request.message, /sender@example.invalid/); assert.match(question.request.message, /recipient@example.invalid/); assert.match(question.request.message, /Exact full-flow subject/); assert.match(question.request.message, /Exact full-flow message body/);
  assert.equal(f.state.effects, 0); assert.equal(f.wire.filter(item => item.rpc.method === 'tools/call').length, 0);
  await f.request(f.route + '/ui-response', 'POST', { id: question.request.id, value: true });
  assert.equal((await f.terminal(requestId)).outcome, 'completed'); assert.equal(f.state.effects, 1);
  assert.equal(f.observations.filter(event => event.type === 'ui.request' && event.requestId === requestId).length, 1);
  const calls = f.wire.filter(item => item.rpc.method === 'tools/call'); assert.equal(calls.length, 2); assert.deepEqual(calls[0]!.rpc.params!.arguments, calls[1]!.rpc.params!.arguments);
  assert.deepEqual(calls[1]!.rpc.params!.arguments, { ...args, attachments: [] });
  const journal = await f.request(f.route + '/service-connections/operations'); assert.equal(journal.total, 1); assert.equal(journal.operations[0].status, 'succeeded'); assert.equal(journal.operations[0].resultId, 'gmail-message-145'); assert.equal(journal.operations[0].target.from, 'sender@example.invalid');
  const { native } = await f.noSecrets(); assert.match(native, /SYNTHETIC_GMAIL_MRTR_COMPLETE/); assert.ok(!native.includes('synthetic-opaque-original-mail-state'));
  assert.equal(f.provider.requests.length, 2); assert.deepEqual(f.provider.errors, []); assert.deepEqual(f.logs, []);
});

test('GG11 actual account revocation cancels the original MCP read and prevents late content or a replacement model turn', { timeout: 90_000 }, async t => {
  const f = await fixture(t), requestId = randomUUID(); f.state.holdRead = true;
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'LATE_REVOKED_CONTENT_MUST_NOT_REACH_MODEL' } : { calls: [{ name: 'service_github_get_file_contents', arguments: fileArgs }] });
  await f.request(f.route + '/messages', 'POST', { requestId, text: 'Read the synthetic authorized source; account revocation must stop this exact request.' }, 202);
  await f.state.readStarted.promise;
  const disconnected = await f.request('/api/service-connections/github/disconnect', 'POST', { expectedRevision: f.verified.connection.revision });
  assert.equal(disconnected.connection.status, 'disconnected');
  const settled = await until(async () => { const state = await f.request(f.route); return state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle' ? state : undefined; }, 'Revoked original task did not settle.');
  assert.ok(['cancelled', 'interrupted', 'failed'].includes(settled.task.lastRun.status));
  assert.ok(f.state.closedReads >= 1); assert.equal(f.provider.requests.length, 1); assert.equal(f.state.effects, 0);
  assert.equal(settled.task.serviceConnections.github.accountId, '9001', 'revocation preserves the old explicit binding intent');
  const { native } = await f.noSecrets(); assert.ok(!native.includes('LATE_REVOKED_CONTENT_MUST_NOT_REACH_MODEL'));
  assert.deepEqual(f.provider.errors, []); assert.deepEqual(f.logs, []);
});

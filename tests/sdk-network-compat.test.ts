import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createTcpServer, type Socket } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ProjectAgent, type ProjectAgentOptions, type ProjectEvent } from '../src/agent/project-runtime.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

const KEY = 'synthetic-sdk-network-known-key';
const TOOL = 'mcp__sdk_network__echo';
const evidenceParent = path.resolve(process.env.OPTRACALL_SDK_NETWORK_EVIDENCE ?? '.local/pi-sdk-adaptation-repair/implementation/r3');
async function until(check: () => boolean, description: string, timeoutMs = 8_000) {
  const end = Date.now() + timeoutMs;
  while (!check()) { assert.ok(Date.now() < end, description); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function rootFor(label: string) {
  await mkdir(evidenceParent, { recursive: true });
  return mkdtemp(path.join(evidenceParent, `${label}-`));
}
function finish(response: ServerResponse, text = 'SDK_NETWORK_OK') {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [delta, reason] of [[{ role: 'assistant', content: text }, null], [{}, 'stop']] as const) response.write('data: ' + JSON.stringify({ id: 'sdk-network', object: 'chat.completion.chunk', created: 1, model: 'synthetic-network-model', choices: [{ index: 0, delta, finish_reason: reason }] }) + '\n\n');
  response.end('data: [DONE]\n\n');
}
async function certificates(root: string, validHostname = true) {
  const caKey = path.join(root, 'ca.key'), caPath = path.join(root, 'ca.pem'), key = path.join(root, 'server.key'), csr = path.join(root, 'server.csr'), cert = path.join(root, 'server.pem'), extensions = path.join(root, 'server.ext');
  const openssl = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=SDK synthetic CA', '-keyout', caKey, '-out', caPath, '-addext', 'basicConstraints=critical,CA:TRUE']);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=SDK synthetic loopback', '-keyout', key, '-out', csr]);
  await writeFile(extensions, `subjectAltName=${validHostname ? 'IP:127.0.0.1' : 'DNS:synthetic.invalid'}\nextendedKeyUsage=serverAuth\n`);
  openssl(['x509', '-req', '-in', csr, '-CA', caPath, '-CAkey', caKey, '-set_serial', '1', '-days', '2', '-out', cert, '-extfile', extensions]);
  return { caPath, key: await readFile(key), cert: await readFile(cert) };
}
async function agentFixture(t: TestContext, root: string, baseUrl: string, options: { caPath?: string; mcpUrl?: string; idleMs?: number } = {}) {
  const projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources'), codeRoot = path.join(root, 'fixture-code'), observationPath = path.join(root, 'worker-observation.json');
  for (const directory of [resourceRoot, path.join(codeRoot, 'scripts'), ...['010_draw', '020_clean', '060_reports'].map(name => path.join(projectDirectory, name))]) await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false, maxRetries: 0 }, ...(options.idleMs === undefined ? {} : { httpIdleTimeoutMs: options.idleMs }) }));
  if (options.mcpUrl) await writeFile(path.join(resourceRoot, 'mcp.json'), JSON.stringify({ autoEnableCodemode: false, mcpServers: { 'sdk-network': { type: 'http', url: options.mcpUrl, exposure: 'direct', timeout: 15, headers: { Authorization: `Bearer ${KEY}` } } } }));
  await writeFile(path.join(codeRoot, 'scripts/project-entry.mjs'), `import { runNetworkWorker } from ${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/sdk-network-worker.mjs')).href)};\nawait runNetworkWorker(${JSON.stringify({ codeRoot: process.cwd(), observationPath, caPath: options.caPath })});\n`);
  const agentOptions: ProjectAgentOptions = { projectId: 'sdk-network-synthetic', projectDirectory, resourceRoot, codeRoot, sessionDirectory: path.join(root, 'sessions'), managementPorts: [], configuration: { id: 'sdk-network-synthetic', revision: 1, provider: 'synthetic', api: 'openai-completions', name: 'Synthetic network compatibility', model: 'synthetic-network-model', baseUrl, apiKey: KEY } };
  const agent = new ProjectAgent(agentOptions), events: ProjectEvent[] = [];
  agent.subscribe(event => events.push(event));
  t.after(async () => { await agent.close(); await writeFile(path.join(root, 'events.json'), JSON.stringify(events, null, 2)); });
  return { agent, events, root, observation: async () => JSON.parse(await readFile(observationPath, 'utf8')) };
}
async function nativeEvidence(f: Awaited<ReturnType<typeof agentFixture>>) {
  const snapshot = await f.agent.snapshot(); assert.ok(snapshot.sessionFile);
  const native = await readFile(snapshot.sessionFile, 'utf8');
  for (const value of [JSON.stringify(f.events), JSON.stringify(snapshot), native]) assert.ok(!value.includes(KEY), 'known synthetic credential must be masked in Host events, snapshot and actual native JSONL');
  return { snapshot, native, records: native.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.customType === 'optracall.http') };
}
type McpRequest = { method: string; rpcMethod?: string; rpcId?: string | number; cancelledRequestId?: string | number; session?: string; protocol?: string; accept?: string; authorized: boolean; closedEarly: boolean };
async function mcpFixture(t: TestContext, root: string, json: boolean, tlsOptions?: Awaited<ReturnType<typeof certificates>>) {
  const records: McpRequest[] = [], errors: string[] = [], responses = new Set<ServerResponse>();
  const mcp = new McpServer({ name: 'synthetic-network', version: '1.0.0' });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: json });
  let mode: 'echo' | 'hold' | 'http-error' | 'disconnect' = 'echo', held: (() => void) | undefined, entered = 0, aborted = 0;
  mcp.registerTool('echo', { description: 'Synthetic read-only network echo.', inputSchema: { value: z.string() } }, async ({ value }, extra) => {
    entered++;
    if (mode === 'hold') {
      extra.signal.addEventListener('abort', () => { aborted++; }, { once: true });
      await new Promise<void>(resolve => { held = resolve; });
      return { content: [{ type: 'text' as const, text: 'SDK_NETWORK_LATE_RESULT' }] };
    }
    return { content: [{ type: 'text' as const, text: `SDK_NETWORK_ECHO:${value}` }] };
  });
  await mcp.connect(transport);
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    responses.add(response); response.on('close', () => responses.delete(response));
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1');
      const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
      const body = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : undefined;
      const record: McpRequest = { method: request.method!, rpcMethod: body?.method, rpcId: body?.id, ...(body?.method === 'notifications/cancelled' ? { cancelledRequestId: body.params?.requestId } : {}), session: request.headers['mcp-session-id'] as string | undefined, protocol: request.headers['mcp-protocol-version'] as string | undefined, accept: request.headers.accept, authorized: request.headers.authorization === `Bearer ${KEY}`, closedEarly: false };
      records.push(record);
      response.on('close', () => { record.closedEarly = !response.writableEnded; });
      if (body?.method === 'tools/call' && mode === 'http-error') { response.writeHead(400, { 'content-type': 'text/plain' }); response.end(`synthetic MCP error ${KEY}`); return; }
      if (body?.method === 'tools/call' && mode === 'disconnect') { response.destroy(); return; }
      await transport.handleRequest(request, response, body);
    } catch (error) { errors.push(error instanceof Error ? error.message : 'fixture error'); if (!response.headersSent) response.writeHead(500); response.end(); }
  };
  const server = tlsOptions ? createHttpsServer({ key: tlsOptions.key, cert: tlsOptions.cert }, handler) : createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { held?.(); await mcp.close(); for (const response of responses) response.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await writeFile(path.join(root, 'mcp-requests.json'), JSON.stringify(records, null, 2)); assert.deepEqual(errors, []); });
  return { url: `${tlsOptions ? 'https' : 'http'}://127.0.0.1:${address.port}/mcp`, records, setMode: (next: typeof mode) => { mode = next; }, release: () => { held?.(); }, entered: () => entered, aborted: () => aborted };
}
function useEcho(provider: Awaited<ReturnType<typeof startToolProvider>>) {
  provider.setResponder(context => {
    assert.ok(context.availableTools.includes(TOOL), 'actual SDK declarations include the HTTP MCP tool');
    return context.recentToolResults.length ? { text: 'SDK_NETWORK_DONE ' + providerMessageText(context.recentToolResults.at(-1)?.content) } : { calls: [{ name: TOOL, arguments: { value: 'synthetic-input' } }] };
  });
}

for (const json of [true, false]) test(`R3: actual SDK MCP StreamableHTTP ${json ? 'JSON' : 'SSE'} initializes, calls and closes via the installed dispatcher`, { timeout: 30_000 }, async t => {
  const root = await rootFor(json ? 'mcp-json' : 'mcp-sse'), provider = await startToolProvider(); t.after(() => provider.close());
  const mcp = await mcpFixture(t, root, json); useEcho(provider);
  const f = await agentFixture(t, root, provider.baseUrl, { mcpUrl: mcp.url });
  const opened = await f.agent.open(); assert.equal(opened.sdkVersion, '1.4.0');
  const result = await f.agent.start('Synthetic MCP network call.', `mcp-${json ? 'json' : 'sse'}`).completion;
  assert.equal(result.outcome, 'completed'); assert.match(result.text, /SDK_NETWORK_ECHO:synthetic-input/);
  assert.equal(provider.requests.length, 2); assert.equal(mcp.entered(), 1);
  assert.equal(mcp.records.filter(record => record.rpcMethod === 'initialize').length, 1);
  assert.equal(mcp.records.filter(record => record.rpcMethod === 'tools/call').length, 1);
  const list = mcp.records.find(record => record.rpcMethod === 'tools/list'), call = mcp.records.find(record => record.rpcMethod === 'tools/call');
  assert.ok(list && call && list.session && call.session === list.session && call.protocol);
  assert.match(call.accept!, /application\/json/); assert.match(call.accept!, /text\/event-stream/);
  assert.ok(mcp.records.every(record => record.authorized));
  await nativeEvidence(f); await f.agent.close();
  assert.equal(mcp.records.filter(record => record.method === 'DELETE').length, 1);
  const observed = await f.observation(); assert.equal(observed.version, '8.12.2'); assert.equal(observed.globalsMatch, true); assert.equal(observed.trust, 'bundled');
  const replies = observed.responses.filter((record: any) => record.pathname === '/mcp' && record.method === 'POST' && record.status === 200);
  assert.ok(replies.length >= 3, 'initialize, tools/list and tools/call responses are observed on the actual dispatcher');
  assert.ok(replies.every((record: any) => record.contentType?.split(';')[0] === (json ? 'application/json' : 'text/event-stream')));
  assert.ok(observed.dispatches.some((record: any) => record.pathname === '/mcp' && record.method === 'POST'));
  assert.ok(observed.dispatches.some((record: any) => record.pathname.endsWith('/chat/completions')));
  assert.deepEqual(provider.errors, []);
});

test('R3: MCP HTTP cancellation sends the matching cancellation and a late result cannot enter the next explicit run', { timeout: 30_000 }, async t => {
  const root = await rootFor('mcp-cancel'), provider = await startToolProvider(); t.after(() => provider.close());
  const mcp = await mcpFixture(t, root, false); mcp.setMode('hold'); useEcho(provider);
  const f = await agentFixture(t, root, provider.baseUrl, { mcpUrl: mcp.url }); await f.agent.open();
  const first = f.agent.start('Synthetic MCP cancellation.', 'mcp-cancel-first');
  await until(() => mcp.entered() === 1, 'real MCP call must reach the fixture before cancellation');
  await f.agent.stop(); assert.equal((await first.completion).outcome, 'cancelled');
  await until(() => mcp.records.some(record => record.rpcMethod === 'notifications/cancelled'), 'SDK must send actual MCP cancellation');
  const cancelled = mcp.records.find(record => record.rpcMethod === 'notifications/cancelled'), pendingCall = mcp.records.find(record => record.rpcMethod === 'tools/call');
  assert.ok(pendingCall?.rpcId !== undefined); assert.equal(cancelled?.cancelledRequestId, pendingCall.rpcId); assert.equal(cancelled?.session, pendingCall.session);
  mcp.release(); mcp.setMode('echo');
  const next = await f.agent.start('Explicit new synthetic MCP call.', 'mcp-cancel-next').completion;
  assert.equal(next.outcome, 'completed'); assert.match(next.text, /SDK_NETWORK_ECHO:synthetic-input/); assert.doesNotMatch(next.text, /SDK_NETWORK_LATE_RESULT/);
  assert.equal(mcp.entered(), 2); assert.equal(mcp.records.filter(record => record.rpcMethod === 'tools/call').length, 2);
  const { native } = await nativeEvidence(f); assert.doesNotMatch(native, /SDK_NETWORK_LATE_RESULT/);
  assert.equal(f.events.filter(event => event.type === 'run.settled' && event.requestId === 'mcp-cancel-first').length, 1);
});

for (const mode of ['http-error', 'disconnect'] as const) test(`R3: MCP HTTP ${mode} is returned as a tool error without secret persistence or POST replay`, { timeout: 30_000 }, async t => {
  const root = await rootFor(`mcp-${mode}`), provider = await startToolProvider(); t.after(() => provider.close());
  const mcp = await mcpFixture(t, root, true); mcp.setMode(mode); useEcho(provider);
  const f = await agentFixture(t, root, provider.baseUrl, { mcpUrl: mcp.url }); await f.agent.open();
  const result = await f.agent.start('Synthetic MCP network failure.', `mcp-${mode}`).completion;
  assert.equal(result.outcome, 'completed');
  assert.equal(mcp.records.filter(record => record.rpcMethod === 'tools/call').length, 1, 'failed tools/call POST is not automatically replayed');
  assert.equal(mcp.entered(), 0); assert.equal(provider.requests.length, 2);
  const messages = provider.requests[1].body.messages ?? [], tool = messages.find(message => message.role === 'tool'); assert.ok(tool);
  assert.match(providerMessageText(tool.content), mode === 'http-error' ? /400/ : /fetch failed|socket|connection|closed/i);
  assert.ok(!JSON.stringify(messages).includes(KEY), 'model continuation also receives the redacted known credential');
  await nativeEvidence(f);
});

test('R3: trusted synthetic TLS MCP uses the same real SDK HTTP path with certificate verification enabled', { timeout: 30_000 }, async t => {
  const root = await rootFor('mcp-tls'), cert = await certificates(root), provider = await startToolProvider(); t.after(() => provider.close());
  const mcp = await mcpFixture(t, root, false, cert); useEcho(provider);
  const f = await agentFixture(t, root, provider.baseUrl, { mcpUrl: mcp.url, caPath: cert.caPath }); await f.agent.open();
  const result = await f.agent.start('Synthetic authenticated TLS MCP.', 'mcp-tls').completion;
  assert.equal(result.outcome, 'completed'); assert.match(result.text, /SDK_NETWORK_ECHO/); assert.equal(mcp.entered(), 1);
  const observed = await f.observation(); assert.equal(observed.trust, 'bundled-plus-synthetic-ca-in-this-worker-only');
  assert.ok(observed.dispatches.some((record: any) => record.protocol === 'https:' && record.pathname === '/mcp'));
  await nativeEvidence(f);
});

for (const trust of ['trusted', 'untrusted-ca', 'hostname-mismatch'] as const) test(`R3: actual model HTTPS handshake ${trust}`, { timeout: 30_000 }, async t => {
  const root = await rootFor(`tls-${trust}`), cert = await certificates(root, trust !== 'hostname-mismatch'); let requests = 0;
  const server = createHttpsServer({ key: cert.key, cert: cert.cert }, async (request, response) => { for await (const _chunk of request) { /* Only synthetic request bytes. */ } requests++; finish(response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const f = await agentFixture(t, root, `https://127.0.0.1:${address.port}/v1`, { ...(trust === 'untrusted-ca' ? {} : { caPath: cert.caPath }) }); await f.agent.open();
  const result = await f.agent.start('Synthetic certificate verification.', `tls-${trust}`).completion;
  assert.equal(result.outcome, trust === 'trusted' ? 'completed' : 'failed'); assert.equal(requests, trust === 'trusted' ? 1 : 0);
  const observed = await f.observation(), codes = observed.errors.flatMap((error: any) => [error.code, error.causeCode]);
  if (trust === 'hostname-mismatch') assert.ok(codes.includes('ERR_TLS_CERT_ALTNAME_INVALID'), JSON.stringify(observed.errors));
  if (trust === 'untrusted-ca') assert.ok(codes.some((code: string) => ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)), JSON.stringify(observed.errors));
  if (trust === 'trusted') assert.match(result.text, /SDK_NETWORK_OK/);
  await nativeEvidence(f);
});

test('R3: actual SDK pre-header wait is bounded by its request timer and preserves an unknown transport cause without replay', { timeout: 20_000 }, async t => {
  const root = await rootFor('headers-timeout'); let requests = 0;
  const server = createServer(async request => { for await (const _chunk of request) { /* Read POST but deliberately send no headers. */ } requests++; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const f = await agentFixture(t, root, `http://127.0.0.1:${address.port}/v1`, { idleMs: 200 }); await f.agent.open();
  const result = await f.agent.start('Synthetic no-headers response.', 'headers-timeout').completion;
  assert.equal(result.outcome, 'failed'); assert.equal(requests, 1);
  const { records, native } = await nativeEvidence(f); assert.equal(records.length, 1); assert.equal(records[0].data.causeCode, 'UNKNOWN'); assert.equal(records[0].data.statusCode, undefined); assert.equal(records[0].data.headersAt, undefined);
  assert.match(native, /Request timed out/); assert.equal(result.diagnostic?.code, 'request_failed');
  assert.equal(records[0].data.timeouts.connectTimeoutMs, 10_000); assert.equal(records[0].data.timeouts.headersTimeoutMs, 200);
});

test('R3: the original undici dispatcher independently enforces a real headers timeout without an SDK timer', { timeout: 15_000 }, async t => {
  const root = await rootFor('transport-headers-timeout'); let requests = 0;
  const server = createServer(async request => { for await (const _chunk of request) { /* Consume POST without sending headers. */ } requests++; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const observationPath = path.join(root, 'transport-observation.json'), program = path.join(root, 'headers-probe.mjs');
  await writeFile(program, `import { runHeadersProbe } from ${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/sdk-network-worker.mjs')).href)};\nawait runHeadersProbe(${JSON.stringify({ url: `http://127.0.0.1:${address.port}/probe`, observationPath })});\n`);
  await promisify(execFile)(process.execPath, [program], { cwd: process.cwd(), timeout: 10_000, env: { PATH: process.env.PATH, NODE_OPTIONS: '--use-bundled-ca' } });
  const observed = JSON.parse(await readFile(observationPath, 'utf8'));
  assert.equal(observed.failed, true); assert.equal(observed.version, '8.12.2'); assert.equal(observed.globalsMatch, true); assert.equal(requests, 1);
  assert.equal(observed.records.length, 1); assert.equal(observed.records[0].causeCode, 'UND_ERR_HEADERS_TIMEOUT'); assert.equal(observed.records[0].headersAt, undefined);
  assert.equal(observed.records[0].timeouts.headersTimeoutMs, 200); assert.equal(observed.records[0].timeouts.connectTimeoutMs, 10_000);
});

test('R3: a local TCP accept without TLS completion reaches the original real UND_ERR_CONNECT_TIMEOUT', { timeout: 25_000 }, async t => {
  const root = await rootFor('connect-timeout'), sockets = new Set<Socket>(); let accepts = 0;
  const server = createTcpServer(socket => { accepts++; sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); socket.resume(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const f = await agentFixture(t, root, `https://127.0.0.1:${address.port}/v1`); await f.agent.open(); const started = Date.now();
  const result = await f.agent.start('Synthetic stalled TLS handshake.', 'connect-timeout').completion, elapsedMs = Date.now() - started;
  assert.equal(result.outcome, 'failed'); assert.equal(accepts, 1);
  const { records } = await nativeEvidence(f); assert.equal(records.length, 1); assert.equal(records[0].data.causeCode, 'UND_ERR_CONNECT_TIMEOUT'); assert.equal(records[0].data.headersAt, undefined); assert.equal(records[0].data.timeouts.connectTimeoutMs, 10_000);
  assert.ok(elapsedMs >= 9_000 && elapsedMs < 20_000, `original 10s connect timeout observed at ${elapsedMs}ms`);
  await writeFile(path.join(root, 'connect-timing.json'), JSON.stringify({ elapsedMs, accepts, causeCode: records[0].data.causeCode }, null, 2));
});

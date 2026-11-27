import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { RemoteServiceBackend, catalogServiceTools, enforceGithubRepository, type RemoteServiceContext } from '../src/host/service-connection-mcp.ts';
import { ServiceOAuthManager, createServiceOAuthCredentialStore } from '../src/host/service-connection-oauth.ts';
import type { ServiceConnection, ServiceConnectionCredentials, JsonValue } from '../src/host/service-connection-types.ts';
const schema = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' } }, required: ['owner', 'repo'] };
const secret = 'synthetic-host-only-access';
const credentials: ServiceConnectionCredentials = { accessToken: secret };
const github = (): ServiceConnection => ({ service: 'github', connectionId: 'github-test', revision: 1, status: 'unverified', scopes: ['read', 'collaborate', 'merge'], repositories: ['team/repo'], tools: [], credentialsConfigured: { accessToken: true, refreshToken: false, clientSecret: false, authorizationCode: false }, updatedAt: new Date().toISOString() });
async function setup(t: import('node:test').TestContext) {
  const state = { effects: 0, calls: [] as { url: string; method: string; body: Record<string, unknown>; auth?: string }[], lost: false, changed: false, deleteFailure: false, identityFailure: false, large: false, upstream401: false, challengeTool: false, challengeList: false, echoSchema: false, echoAuth: false, refreshes: 0, feishuMissingTenant: false, feishuPartial: false, feishuDenied: false, descriptionChanged: false, annotationChanged: false, merge: false, currentSha: 'a'.repeat(40), raceMergeHead: false };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString(); let body: Record<string, unknown> = {}; try { body = text ? JSON.parse(text) : {}; } catch { /* OAuth form body is intentionally not JSON. */ }
    const url = String(req.headers['x-original-url']); state.calls.push({ url, method: req.method!, body, auth: req.headers.authorization });
    if (url === 'https://github.com/login/oauth/access_token') { state.refreshes++; res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'new-synthetic-rotated-token', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer' })); return; }
    if ((state.challengeTool && body.method === 'tools/call' || state.challengeList && body.method === 'tools/list') && req.headers.authorization === `Bearer ${secret}`) { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('synthetic rejected'); return; }
    if (state.feishuDenied && url === 'https://mcp.feishu.cn/mcp') { res.writeHead(403).end('admin policy denied synthetic'); return; }
    if (state.upstream401) { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(`private diagnostic ${secret}`); return; }
    const reply = (result: unknown) => res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 'synthetic-session' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    if (req.method === 'DELETE') { res.writeHead(state.deleteFailure ? 503 : 204).end(); return; }
    if (url.endsWith('/authen/v1/user_info')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 0, data: { user_id: 'trusted-feishu-user', name: 'Synthetic user', ...(state.feishuMissingTenant ? {} : { tenant_key: 'trusted-tenant' }) } })); return; }
    if (url.endsWith('/user')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(state.identityFailure ? { id: 1 } : { id: 9001, login: 'trusted-user' })); return; }
    if (url.includes('/pulls/')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ head: { sha: state.currentSha } })); if (state.raceMergeHead) state.currentSha = 'c'.repeat(40); return; }
    if (url.includes('/repos/')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ full_name: 'team/repo' })); return; }
    if (body.method === 'server/discover') { reply({ resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'synthetic-gmail', version: '2026' } } }); return; }
    if (body.method === 'initialize') { reply({ protocolVersion: '2025-11-25', serverInfo: { name: 'synthetic-github', version: '1' }, capabilities: { tools: {} } }); return; }
    if (body.method === 'notifications/initialized' || body.method === 'notifications/cancelled') { res.writeHead(202).end(); return; }
    if (body.method === 'tools/list') {
      if (url === 'https://gmailmcp.googleapis.com/mcp/v1') { reply({ tools: [{ name: 'create_draft', inputSchema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } } } }, { name: 'update_label', inputSchema: { type: 'object', properties: { labelId: { type: 'string' }, name: { type: 'string' } } } }] }); return; }
      if (url === 'https://mcp.feishu.cn/mcp') { reply({ tools: [{ name: 'search-doc', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }, ...(state.feishuPartial ? [] : [{ name: 'send-message', inputSchema: { type: 'object', properties: { receive_id: { type: 'string' }, content: { type: 'string' } } } }]), { name: 'admin_delete_all', inputSchema: schema }] }); return; }
      const cursor = (body.params as { cursor?: string } | undefined)?.cursor;
      reply(cursor ? { tools: [{ name: 'create_pull_request', inputSchema: schema }, ...(state.merge ? [{ name: 'merge_pull_request', inputSchema: { type: 'object', properties: { ...schema.properties, pullNumber: { type: 'integer' }, sha: { type: 'string' }, merge_method: { type: 'string' } }, required: ['owner', 'repo', 'pullNumber'] } }] : []), { name: 'delete_repository', inputSchema: schema }] } : { tools: [{ name: 'get_file_contents', description: state.descriptionChanged ? 'Changed trusted description' : 'Read repository files', annotations: { readOnlyHint: !state.annotationChanged }, inputSchema: { ...(state.changed ? { ...schema, required: ['owner', 'repo', 'path'] } : schema), ...(state.echoSchema ? { description: String(req.headers.authorization) } : {}) } }], nextCursor: 'page2' }); return;
    }
    if (body.method === 'tools/call') {
      const params = body.params as { name: string };
      if (params.name === 'merge_pull_request') { if ((body.params as { arguments: { sha: string } }).arguments.sha !== state.currentSha) { reply({ isError: true, content: [{ type: 'text', text: 'Head changed; merge refused.' }] }); return; } state.effects++; }
      if (params.name === 'create_pull_request') state.effects++;
      if (state.lost) { req.socket.destroy(); return; }
      reply({ content: [{ type: 'text', text: state.large ? 'x'.repeat(30000) : state.echoAuth ? String(req.headers.authorization) : `trusted contents ${secret}` }] }); return;
    }
    res.writeHead(400).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const remoteFetch: typeof fetch = (input, init) => fetch(`http://127.0.0.1:${address.port}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-original-url': String(input) } });
  const backend = new RemoteServiceBackend({ timeoutMs: 2000, maxResponseBytes: 16000, fetch: remoteFetch });
  t.after(() => backend.close('github-test').catch(() => {}));
  return { backend, state, remoteFetch };
}

test('native Pi HTTP discovery/pages, trusted GitHub ID/repository verification and exact tool whitelist are used', async t => {
  const { backend, state } = await setup(t); const connection = github();
  const verified = await backend.verify(connection, credentials);
  assert.equal(verified.accountId, '9001'); assert.equal(verified.accountLabel, 'trusted-user');
  assert.deepEqual(verified.tools.map(tool => tool.name), ['create_pull_request', 'get_file_contents']);
  assert.deepEqual(verified.scopes, ['read', 'collaborate']); assert(state.calls.some(call => call.url === 'https://api.github.com/repos/team/repo'));
  assert(state.calls.some(call => (call.body.params as { cursor?: string })?.cursor === 'page2'));
  Object.assign(connection, verified, { status: 'verified' });
  const result = await backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo', path: 'README.md' } });
  assert(!JSON.stringify(result).includes(secret)); assert.match(JSON.stringify(result), /\[redacted\]/);
  assert(state.calls.every(call => call.auth === `Bearer ${secret}`));
  assert.equal(state.calls.filter(call => call.method === 'DELETE').length, 2);
});

test('outside repositories, tool expansion, scope widening and changed schemas stop before tool effects', async t => {
  const { backend, state } = await setup(t); const connection = github(); Object.assign(connection, await backend.verify(connection, credentials), { status: 'verified' });
  const before = state.calls.length;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'evil', repo: 'repo' } }), error => (error as { code?: string }).code === 'service_repository_outside_scope');
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'delete_repository', arguments: { owner: 'team', repo: 'repo' } }), error => (error as { code?: string }).code === 'service_tool_not_allowed');
  assert.equal(state.calls.length, before);
  state.changed = true;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' } }), error => (error as { code?: string }).code === 'service_tool_schema_changed');
  assert.equal(state.calls.filter(call => call.body.method === 'tools/call').length, 0);
});

test('GitHub query scope cannot be widened by alternate repo, OR, org/user, quote or escaped filter', () => {
  const connection = { repositories: ['team/repo'] };
  enforceGithubRepository(connection, 'search_issues', { query: 'repo:team/repo is:open label:bug' });
  for (const query of ['repo:team/repo OR repo:evil/repo', 'repo:team/repo repo:evil/repo', 'repo:team/repo org:evil', 'repo:team/repo user:evil', '"repo:team/repo"', 'repo:team/repo (repo:evil/repo)', 'repo:team/repo \\repo:evil/repo', '"repo:evil/repo" repo:team/repo']) assert.throws(() => enforceGithubRepository(connection, 'search_issues', { query }), query);
});

test('lost native MCP write result is UNKNOWN and no automatic replay occurs', async t => {
  const { backend, state } = await setup(t); const connection = github(); Object.assign(connection, await backend.verify(connection, credentials), { status: 'verified' }); state.lost = true;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'create_pull_request', arguments: { owner: 'team', repo: 'repo', title: 'Synthetic' } }), error => (error as { unknownOutcome?: boolean }).unknownOutcome === true && !String(error).includes(secret));
  assert.equal(state.effects, 1); assert.equal(state.calls.filter(call => call.body.method === 'tools/call').length, 1);
  await backend.close(connection.connectionId); assert.equal(state.effects, 1);
});

test('native OAuth rejection, identity failure, bounded body, cancelled and stale calls expose only safe failures', async t => {
  const { backend, state } = await setup(t); const connection = github(); Object.assign(connection, await backend.verify(connection, credentials), { status: 'verified' });
  state.upstream401 = true;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' } }), error => (error as { code?: string }).code === 'service_oauth_expired' && !String(error).includes(secret));
  state.upstream401 = false; state.identityFailure = true;
  await assert.rejects(backend.verify(connection, credentials), error => (error as { code?: string }).code === 'service_identity_unavailable');
  state.identityFailure = false; state.large = true;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' } }));
  const before = state.calls.length;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' }, isCurrent: () => false }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' }, signal: controller.signal }));
  assert.equal(state.calls.length, before);
});

test('native failed retirement is preserved and retries only session DELETE after explicit lifecycle close', async t => {
  const { backend, state } = await setup(t); const connection = github(); Object.assign(connection, await backend.verify(connection, credentials), { status: 'verified' }); state.deleteFailure = true;
  let cleanup: Parameters<NonNullable<RemoteServiceContext['registerCleanup']>>[0] | undefined;
  const known = await backend.invoke({ connection, credentials, toolName: 'create_pull_request', arguments: { owner: 'team', repo: 'repo' }, registerCleanup: fn => { cleanup = fn; } });
  assert.match(JSON.stringify(known), /trusted contents/); assert.equal(state.effects, 1, 'known business receipt survives separate failed retirement');
  const before = state.calls.filter(call => call.method === 'DELETE').length; assert(cleanup);
  await assert.rejects(cleanup({})); assert.equal(state.calls.filter(call => call.method === 'DELETE').length, before, 'automatic cleanup observes original failure without second DELETE');
  state.deleteFailure = false; await cleanup({ retryFailed: true });
  assert.equal(state.calls.filter(call => call.method === 'DELETE').length, before + 1);
  assert.equal(state.calls.filter(call => call.body.method === 'tools/call').length, 1);
});

test('official Gmail reply/forward and label tools are intersected with chosen scopes; filters/trash/new tools stay excluded', () => {
  const tools = ['get_message', 'reply', 'forward', 'update_message_labels', 'apply_sensitive_thread_label', 'create_filter', 'trash_message', 'surprise_send'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } }));
  const selected = catalogServiceTools({ service: 'gmail', scopes: ['read', 'send', 'manage'] }, tools);
  assert.deepEqual(selected.map(tool => tool.name), ['forward', 'get_message', 'reply', 'update_message_labels']);
  assert(selected.filter(tool => tool.scope === 'send').every(tool => tool.requiresConfirmation));
  assert.deepEqual(catalogServiceTools({ service: 'gmail', scopes: ['read'] }, tools).map(tool => tool.name), ['get_message']);
});


test('OAuth rotated access and refresh tokens are redacted after a tool-local 401 refresh', async t => {
  const harness = await setup(t), connection = github();
  let saved: ServiceConnectionCredentials = { accessToken: secret, clientSecret: 'synthetic-client-secret', oauthState: JSON.stringify({ type: 'oauth', access: secret, refresh: 'initial-refresh', expires: Date.now() + 3600000 }) };
  const nativeCredentials = createServiceOAuthCredentialStore({ read: async () => saved, write: async (_id, value) => { saved = value; } });
  const oauth = await ServiceOAuthManager.create({ credentials: nativeCredentials, fetch: harness.remoteFetch }); t.after(() => oauth.close());
  const backend = new RemoteServiceBackend({ oauth, fetch: harness.remoteFetch, timeoutMs: 2000 });
  connection.clientId = 'synthetic-registered-client'; Object.assign(connection, await backend.verify(connection, saved), { status: 'verified' });
  harness.state.challengeTool = true; harness.state.echoAuth = true;
  const output = await backend.invoke({ connection, credentials: saved, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' } });
  assert.equal(harness.state.refreshes, 1); assert.equal(JSON.stringify(output).includes('new-synthetic-rotated-token'), false); assert.match(JSON.stringify(output), /redacted/);
});


test('Feishu native user/tenant/app identity and partial admin tool allowance are verified independently', async t => {
  const { backend, state } = await setup(t);
  const connection: ServiceConnection = { ...github(), service: 'feishu', connectionId: 'feishu-native-test', repositories: undefined, scopes: ['read', 'write', 'message'] };
  const native: ServiceConnectionCredentials = { accessToken: secret, oauthState: JSON.stringify({ type: 'oauth', access: secret, refresh: '', expires: Date.now() + 3600000, mcpClientInformation: { client_id: 'trusted-oauth-client', issuer: 'https://accounts.feishu.cn' } }) };
  const verified = await backend.verify(connection, native);
  assert.equal(verified.accountId, 'trusted-feishu-user'); assert.equal(verified.tenantId, 'trusted-tenant'); assert.equal(verified.appId, 'trusted-oauth-client');
  assert.deepEqual(verified.scopes, ['read', 'message']); assert.deepEqual(verified.tools.map(tool => tool.name), ['search-doc', 'send-message']);
  assert.equal(verified.tools.find(tool => tool.name === 'send-message')?.requiresConfirmation, true);
  state.feishuPartial = true;
  assert.deepEqual((await backend.verify(connection, native)).scopes, ['read']);
  state.feishuMissingTenant = true;
  await assert.rejects(backend.verify(connection, native), error => (error as { code?: string }).code === 'service_user_identity_unavailable');
  state.feishuMissingTenant = false;
  await assert.rejects(backend.verify({ ...connection, clientId: 'user-typed-label' }, credentials), error => (error as { code?: string }).code === 'service_app_identity_unavailable');
  state.feishuDenied = true;
  await assert.rejects(backend.verify(connection, native), error => (error as { code?: string }).code === 'service_scope_missing');
});


test('Feishu existing-document edits require a discovered expected-version precondition', () => {
  const inputSchema = { type: 'object', properties: { document_id: { type: 'string' }, content: { type: 'string' } } };
  assert.deepEqual(catalogServiceTools({ service: 'feishu', scopes: ['read', 'write'] }, [{ name: 'update-doc', inputSchema }]), []);
  const supported = { ...inputSchema, properties: { ...inputSchema.properties, expected_version: { type: 'string' } } };
  assert.equal(catalogServiceTools({ service: 'feishu', scopes: ['read', 'write'] }, [{ name: 'update-doc', inputSchema: supported }])[0]?.requiresConfirmation, true);
});


test('remote description and annotation changes revoke the frozen catalog before tool dispatch', async t => {
  const { backend, state } = await setup(t); const connection = github(); Object.assign(connection, await backend.verify(connection, credentials), { status: 'verified' });
  assert.match(connection.tools[0]!.metadataFingerprint!, /^[a-f0-9]{64}$/);
  state.descriptionChanged = true;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' } }), error => (error as { code?: string }).code === 'service_tool_schema_changed');
  state.descriptionChanged = false; state.annotationChanged = true;
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' } }), error => (error as { code?: string }).code === 'service_tool_schema_changed');
  assert.equal(state.calls.filter(call => call.body.method === 'tools/call').length, 0);
});

test('GitHub merge requires exact confirmed SHA and verifies the current trusted PR head before native atomic merge', async t => {
  const { backend, state } = await setup(t); state.merge = true; const connection = github(); Object.assign(connection, await backend.verify(connection, credentials), { status: 'verified' });
  const merge = connection.tools.find(tool => tool.name === 'merge_pull_request')!;
  assert((merge.inputSchema.required as string[]).includes('sha')); assert((merge.inputSchema.required as string[]).includes('merge_method'));
  const original = { owner: 'team', repo: 'repo', pullNumber: 123, sha: 'a'.repeat(40), merge_method: 'squash' };
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'merge_pull_request', arguments: { owner: 'team', repo: 'repo', pullNumber: 123 } }), error => (error as { code?: string }).code === 'service_merge_head_required');
  await assert.rejects(backend.invoke({ connection, credentials, toolName: 'merge_pull_request', arguments: { owner: 'team', repo: 'repo', pullNumber: 123, sha: original.sha } }), error => (error as { code?: string }).code === 'service_merge_method_required');
  let release!: () => void; const confirmation = new Promise<void>(resolve => { release = resolve; });
  const held = (async () => { await confirmation; return backend.invoke({ connection, credentials, toolName: 'merge_pull_request', arguments: original }); })();
  state.currentSha = 'b'.repeat(40); release();
  await assert.rejects(held, error => (error as { code?: string }).code === 'service_merge_head_changed');
  assert.equal(state.calls.filter(call => call.body.method === 'tools/call').length, 0);
  state.currentSha = original.sha;
  await backend.invoke({ connection, credentials, toolName: 'merge_pull_request', arguments: original });
  const dispatched = state.calls.find(call => call.body.method === 'tools/call')!; assert.deepEqual((dispatched.body.params as { arguments: unknown }).arguments, original);
  assert.equal(state.effects, 1); state.raceMergeHead = true;
  const raced = await backend.invoke({ connection, credentials, toolName: 'merge_pull_request', arguments: original }) as { isError?: boolean };
  assert.equal(raced.isError, true); assert.equal(state.effects, 1, 'server SHA precondition rejects a head change after trusted preflight');
  assert.equal(state.calls.filter(call => call.body.method === 'tools/call').length, 2, 'raced merge is not retried');
});

test('Gmail manage scope cannot apply or remove reserved trash/spam labels through ordinary label tools', async () => {
  const tools = catalogServiceTools({ service: 'gmail', scopes: ['read', 'manage'] }, [{ name: 'update_message_labels', inputSchema: { type: 'object', properties: {} } }]);
  const connection: ServiceConnection = { ...github(), service: 'gmail', scopes: ['read', 'manage'], tools };
  const backend = new RemoteServiceBackend({ fetch: async () => { throw new Error('No remote dispatch allowed'); } });
  for (const args of [{ addLabelIds: ['TRASH'] }, { removeLabelIds: ['SPAM'] }, { addLabelIds: ['trash'] }] as Record<string, JsonValue>[]) await assert.rejects(backend.invoke({ connection, credentials, toolName: 'update_message_labels', arguments: args }), error => (error as { code?: string }).code === 'service_scope_missing');
});


test('OAuth refreshed during discovery cannot leak the new token through a frozen schema or metadata', async t => {
  const harness = await setup(t), connection = github(); harness.state.echoSchema = true;
  let saved: ServiceConnectionCredentials = { accessToken: secret, oauthState: JSON.stringify({ type: 'oauth', access: secret, refresh: 'initial-refresh', expires: Date.now() + 3600000 }) };
  const nativeCredentials = createServiceOAuthCredentialStore({ read: async () => saved, write: async (_id, value) => { saved = value; } });
  const oauth = await ServiceOAuthManager.create({ credentials: nativeCredentials, fetch: harness.remoteFetch }); t.after(() => oauth.close());
  const backend = new RemoteServiceBackend({ oauth, fetch: harness.remoteFetch, timeoutMs: 2000 }); connection.clientId = 'synthetic-registered-client';
  Object.assign(connection, await backend.verify(connection, saved), { status: 'verified' });
  assert.equal(JSON.stringify(connection.tools).includes(secret), false);
  harness.state.challengeList = true; harness.state.echoAuth = true;
  const output = await backend.invoke({ connection, credentials: saved, toolName: 'get_file_contents', arguments: { owner: 'team', repo: 'repo' } });
  assert.equal(harness.state.refreshes, 1); assert.equal(JSON.stringify(output).includes('new-synthetic-rotated-token'), false);
  assert.equal(JSON.stringify(connection.tools).includes('new-synthetic-rotated-token'), false);
});


test('Gmail draft subject/body and label display names may contain literal TRASH or SPAM', async t => {
  const { backend, state } = await setup(t);
  const tools = catalogServiceTools({ service: 'gmail', scopes: ['read', 'manage'] }, [
    { name: 'create_draft', inputSchema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } } } },
    { name: 'update_label', inputSchema: { type: 'object', properties: { labelId: { type: 'string' }, name: { type: 'string' } } } },
  ]);
  const connection: ServiceConnection = { ...github(), service: 'gmail', scopes: ['read', 'manage'], tools };
  const original = { subject: 'TRASH', body: 'SPAM' };
  await backend.invoke({ connection, credentials, toolName: 'create_draft', arguments: original });
  await backend.invoke({ connection, credentials, toolName: 'update_label', arguments: { labelId: 'Label_123', name: 'TRASH' } });
  const calls = state.calls.filter(call => call.body.method === 'tools/call'); assert.equal(calls.length, 2);
  assert.deepEqual((calls[0]!.body.params as { arguments: unknown }).arguments, original);
});

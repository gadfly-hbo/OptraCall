import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, symlink, link, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ServiceConnectionStore } from '../src/host/service-connection-store.ts';
import { checkServiceBinding, parseServiceConnectionConfig, parseServiceJson, parseServiceTools, validateTaskServiceBindings } from '../src/host/service-connection-types.ts';
import type { ServiceTool, ServiceConnectionVerification, ServiceOperationInput, TaskServiceBinding } from '../src/host/service-connection-types.ts';

const readTool: ServiceTool = { name: 'read_issue', semanticName: 'issue.read', inputSchema: { type: 'object', properties: { owner: { type: 'string' } } }, scope: 'read', action: 'read', write: false, requiresConfirmation: false };
const writeTool: ServiceTool = { name: 'create_issue', semanticName: 'issue.create', inputSchema: { type: 'object' }, scope: 'collaborate', action: 'collaborate', write: true, requiresConfirmation: true };
const config = { scopes: ['read', 'collaborate'], repositories: ['OpenAI/Synthetic'], credentials: { accessToken: 'synthetic-access-sentinel', refreshToken: 'synthetic-refresh-sentinel', clientSecret: 'synthetic-secret-sentinel', authorizationCode: 'synthetic-code-sentinel', oauthState: '{"type":"oauth","access":"synthetic-native-sentinel"}' } };
const identity: ServiceConnectionVerification = { accountId: 'github-user-1001', accountLabel: 'synthetic-user', scopes: ['read', 'collaborate'], repositories: ['openai/synthetic'], tools: [readTool, writeTool] };
const error = (code: string) => (value: unknown) => { assert.equal((value as { code?: string }).code, code); assert.doesNotMatch(String(value), /synthetic-.*sentinel/); return true; };
async function fixture(t: { after(fn: () => Promise<void>): void }) { const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-service-store-')); t.after(() => rm(root, { recursive: true, force: true })); const store = new ServiceConnectionStore({ dataRoot: root }); await store.init(); return { root, store }; }
async function connected(store: ServiceConnectionStore): Promise<TaskServiceBinding> { await store.saveConfiguration('github', config); await store.verifyConnection('github', identity); return store.createBinding('github'); }
function operation(binding: TaskServiceBinding, operationId = 'operation-one'): ServiceOperationInput { return { operationId, binding, projectId: 'project-one', taskId: 'task-one', requestId: 'request-one', toolCallId: 'tool-call-one', toolName: 'create_issue', target: { repository: 'openai/synthetic' }, arguments: { owner: 'openai', repo: 'synthetic', title: 'Synthetic issue', body: 'Private approved message body' }, requiresConfirmation: true }; }

test('private durable connection credentials never appear in ordinary views; nested snapshots cannot mutate policy', async t => {
  const { store } = await fixture(t); const binding = await connected(store);
  const list = await store.list(), one = await store.get('github');
  const prepared = await store.prepareOperation(operation(binding));
  const views = JSON.stringify([list, one, binding, prepared, await store.getOperation(prepared.operationId), await store.listOperations({ projectId: 'project-one', taskId: 'task-one' })]);
  for (const secret of Object.values(config.credentials)) assert.ok(!views.includes(secret));
  assert.ok(!views.includes('Private approved message body'));
  assert.equal((await store.getOperationReview(prepared.operationId))?.arguments.body, 'Private approved message body');
  list[0].scopes.push('merge'); list[0].tools[0].inputSchema.type = 'array';
  (binding.scopes as string[]).push('merge');
  const secretCopy = await store.getCredentials('github'); secretCopy.accessToken = 'mutated';
  assert.deepEqual((await store.get('github'))?.scopes, ['collaborate', 'read']);
  assert.equal((await store.get('github'))?.tools[0].inputSchema.type, 'object');
  assert.equal((await store.getCredentials('github')).accessToken, config.credentials.accessToken);
  assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  assert.equal((await stat(store.root)).mode & 0o777, 0o700);
});

test('cross-instance configuration CAS has one winner and unrelated service updates survive', async t => {
  const { root, store } = await fixture(t); await connected(store);
  const second = new ServiceConnectionStore({ dataRoot: root }); await second.init();
  const rev = (await store.get('github'))!.revision;
  const results = await Promise.allSettled([
    store.saveConfiguration('github', { ...config, scopes: ['read'] }, rev),
    second.saveConfiguration('github', { ...config, repositories: ['openai/synthetic', 'openai/another'] }, rev),
  ]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected' && (value.reason as { code: string }).code === 'service_connection_conflict').length, 1);
  await Promise.all([
    store.saveConfiguration('gmail', { scopes: ['read'], credentials: { clientSecret: 'gmail-secret' } }),
    second.saveConfiguration('tencent', { scopes: ['read', 'send'], mailboxType: 'qq', email: 'synthetic@qq.com', credentials: { authorizationCode: 'tencent-code' } }),
  ]);
  assert.deepEqual((await second.list()).map(value => value.service), ['github', 'gmail', 'tencent']);
  assert.equal((await store.getCredentials('gmail')).clientSecret, 'gmail-secret');
  assert.equal((await store.getCredentials('tencent')).authorizationCode, 'tencent-code');
});

test('disconnect preserves binding intent; only actually identical policy and stable identity restore it', async t => {
  const { store } = await fixture(t); const binding = await connected(store);
  await store.disconnect('github'); assert.equal((await store.validateBinding(binding)).available, false);
  assert.deepEqual(await store.getCredentials('github'), {});
  await store.saveConfiguration('github', config); await store.verifyConnection('github', { ...identity, accountLabel: 'renamed-display' });
  assert.equal((await store.validateBinding(binding)).available, true);
  await store.verifyConnection('github', { ...identity, accountId: 'different-stable-user', accountLabel: 'synthetic-user' });
  assert.deepEqual(await store.validateBinding(binding), { available: false, reason: 'binding_changed' });
  await store.verifyConnection('github', identity);
  assert.equal((await store.validateBinding(binding)).available, false);
});

test('new scopes, repository expansion and discovered schema changes cannot enlarge an existing task', async t => {
  const { store } = await fixture(t); const binding = await connected(store);
  await store.verifyConnection('github', { ...identity, tools: [readTool, { ...writeTool, inputSchema: { type: 'object', properties: { unexpected: { type: 'string' } } } }] });
  assert.equal((await store.validateBinding(binding)).available, false);
  const selected = await store.createBinding('github', { scopes: ['read'], toolNames: ['read_issue'] });
  assert.deepEqual(selected.scopes, ['read']); assert.deepEqual(selected.tools.map(tool => tool.name), ['read_issue']);
  const current = (await store.get('github'))!;
  assert.equal(checkServiceBinding(current, { ...selected, scopes: ['merge'], tools: [] }).available, false);
  await store.saveConfiguration('github', { ...config, scopes: ['read', 'collaborate', 'merge'], repositories: ['openai/synthetic', 'openai/new'] });
  await store.verifyConnection('github', { ...identity, scopes: ['read', 'collaborate', 'merge'], repositories: ['openai/synthetic', 'openai/new'] });
  assert.equal((await store.validateBinding(selected)).available, false);
  assert.deepEqual(selected.repositories, ['openai/synthetic']);
});

test('Tencent mailbox identity and Feishu tenant/app changes invalidate their own prior bindings', async t => {
  const { store } = await fixture(t); const github = await connected(store);
  await store.saveConfiguration('tencent', { scopes: ['read'], mailboxType: 'qq', email: 'synthetic@qq.com' });
  await store.verifyConnection('tencent', { accountId: 'qq:synthetic@qq.com', accountLabel: 'synthetic@qq.com', mailboxType: 'qq', scopes: ['read'], tools: [] });
  const qq = await store.createBinding('tencent');
  await store.saveConfiguration('tencent', { scopes: ['read'], mailboxType: 'exmail', email: 'synthetic@example.com' });
  await store.verifyConnection('tencent', { accountId: 'exmail:synthetic@example.com', accountLabel: 'synthetic@example.com', mailboxType: 'exmail', scopes: ['read'], tools: [] });
  assert.equal((await store.validateBinding(qq)).available, false);
  await store.saveConfiguration('feishu', { scopes: ['read'] });
  const feishu = { accountId: 'user-one', accountLabel: 'Synthetic user', scopes: ['read'] as ['read'], tools: [], tenantId: 'tenant-one', appId: 'app-one' };
  await store.verifyConnection('feishu', feishu); const binding = await store.createBinding('feishu');
  await store.verifyConnection('feishu', { ...feishu, tenantId: 'tenant-two' });
  assert.equal((await store.validateBinding(binding)).available, false);
  assert.equal((await store.validateBinding(github)).available, true);
});

test('UNKNOWN write retains immutable request/target/content and cannot be replayed after reopen', async t => {
  const { root, store } = await fixture(t); const binding = await connected(store), input = operation(binding);
  const first = await store.prepareOperation(input);
  await assert.rejects(store.transitionOperation(first.operationId, 'submitted'), error('service_operation_transition_forbidden'));
  await store.transitionOperation(first.operationId, 'confirmed', { expectedStatus: 'prepared' });
  await store.transitionOperation(first.operationId, 'submitted', { expectedStatus: 'confirmed' });
  await store.transitionOperation(first.operationId, 'unknown');
  const reopened = new ServiceConnectionStore({ dataRoot: root }); await reopened.init();
  await reopened.updateCredentials('github', { accessToken: 'rotated-synthetic' });
  assert.equal((await reopened.getOperation(first.operationId))?.status, 'unknown');
  assert.equal((await reopened.prepareOperation(input)).status, 'unknown');
  await assert.rejects(reopened.prepareOperation({ ...input, arguments: { ...input.arguments, body: 'changed body' } }), error('service_operation_conflict'));
  for (const status of ['prepared', 'confirmed', 'submitted'] as const) await assert.rejects(reopened.transitionOperation(first.operationId, status), error('service_operation_transition_forbidden'));
  await assert.rejects(reopened.transitionOperation(first.operationId, 'succeeded'), error('service_operation_transition_forbidden'));
  const reconciled = await reopened.transitionOperation(first.operationId, 'succeeded', { reconciled: true, resultId: 'actual-provider-result' });
  assert.equal(reconciled.contentDigest, first.contentDigest); assert.deepEqual(reconciled.target, first.target); assert.equal(reconciled.requestId, input.requestId); assert.equal(reconciled.toolCallId, input.toolCallId);
  await assert.rejects(reopened.listOperations({ projectId: 'project-one', taskId: 'task-one', limit: 101 }), error('invalid_service_pagination'));
  assert.equal((await reopened.listOperations({ projectId: 'another-project', taskId: 'task-one' })).total, 0);
});

test('process interruption after persisted submitted becomes UNKNOWN at next startup', async t => {
  const { root, store } = await fixture(t); const binding = await connected(store); await store.prepareOperation(operation(binding));
  const moduleUrl = new URL('../src/host/service-connection-store.ts', import.meta.url).href;
  const code = `import { ServiceConnectionStore } from ${JSON.stringify(moduleUrl)}; const store = new ServiceConnectionStore({dataRoot: ${JSON.stringify(root)}}); await store.init(); await store.transitionOperation('operation-one','confirmed'); await store.transitionOperation('operation-one','submitted');`;
  await new Promise<void>((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject); child.once('close', exit => exit === 0 ? resolve() : reject(new Error(stderr))); });
  const reopened = new ServiceConnectionStore({ dataRoot: root }); await reopened.init();
  assert.equal((await reopened.getOperation('operation-one'))?.status, 'unknown');
  await assert.rejects(reopened.transitionOperation('operation-one', 'submitted'), error('service_operation_transition_forbidden'));
});

test('corrupt, oversized and untrusted stored settings fail closed without overwriting evidence', async t => {
  const { root, store } = await fixture(t); await connected(store);
  for (const bytes of ['{"schema":', JSON.stringify({ schema: 99 }), ' '.repeat(64 * 1024 * 1024 + 1)]) {
    await writeFile(store.file, bytes); const reopened = new ServiceConnectionStore({ dataRoot: root });
    await assert.rejects(reopened.init(), error('service_store_corrupt')); assert.equal(await readFile(store.file, 'utf8'), bytes);
  }
});

test('symlinks/hardlinks never become credential storage and lock ownership is not stolen', async t => {
  const { root, store } = await fixture(t); await connected(store);
  const snapshot = await readFile(store.file), other = path.join(root, 'other-private.json'); await writeFile(other, snapshot);
  await rm(store.file); await symlink(other, store.file);
  await assert.rejects(new ServiceConnectionStore({ dataRoot: root }).init(), error('service_store_corrupt'));
  assert.deepEqual(await readFile(other), snapshot);
  await rm(store.file); await link(other, store.file);
  await assert.rejects(new ServiceConnectionStore({ dataRoot: root }).init(), error('service_store_corrupt'));
  await rm(store.file); await writeFile(store.file, snapshot);
  const lockTarget = path.join(root, 'lock-target'); await writeFile(lockTarget, 'do not touch'); await symlink(lockTarget, store.lockPath);
  await assert.rejects(store.disconnect('github'), error('unsafe_service_storage'));
  assert.equal(await readFile(lockTarget, 'utf8'), 'do not touch');
});

test('strict config, binding and payload parsing rejects unknown privileges, URLs and embedded secrets', () => {
  for (const invalid of [
    { scopes: ['read'], repositories: ['*/*'] },
    { scopes: ['read', 'send'], repositories: ['openai/synthetic'] },
    { scopes: ['read'], repositories: ['openai/synthetic'], baseUrl: 'https://attacker.invalid' },
    { scopes: ['read'], repositories: ['openai/synthetic'], issuer: 'https://attacker.invalid' },
    { scopes: ['read'], repositories: ['openai/synthetic'], redirectUri: 'https://attacker.invalid/callback' },
  ]) assert.throws(() => parseServiceConnectionConfig('github', invalid));
  assert.throws(() => parseServiceConnectionConfig('tencent', { scopes: ['read'], mailboxType: 'qq', email: 'synthetic@qq.com', smtpHost: 'attacker.invalid' }));
  assert.throws(() => validateTaskServiceBindings({ gmail: { accessToken: 'synthetic' } }));
  for (const key of ['accessToken', 'refresh_token', 'clientSecret', 'authorizationCode', 'password', '__proto__', 'constructor']) assert.throws(() => parseServiceJson(JSON.parse(`{"${key}":"synthetic"}`)));
});

test('global store version rejects stale same-policy credential saves instead of silently overwriting newer grants', async t => {
  const { store } = await fixture(t); await connected(store);
  const oldVersion = await store.version(), oldRevision = (await store.get('github'))!.revision;
  await store.updateCredentials('github', { accessToken: 'newer-token' });
  await assert.rejects(store.saveConfiguration('github', { ...config, credentials: { accessToken: 'stale-token' } }, oldRevision, oldVersion), error('service_connection_conflict'));
  assert.equal((await store.getCredentials('github')).accessToken, 'newer-token');
});

test('native OAuth credential modification is atomic and disconnect wins over an in-flight refresh', async t => {
  const { root, store } = await fixture(t); await connected(store);
  const second = new ServiceConnectionStore({ dataRoot: root }); await second.init();
  const results = await Promise.all([
    store.modifyCredentials('github', async current => ({ credentials: { ...current, oauthState: JSON.stringify({ counter: JSON.parse(current.oauthState!).counter ?? 0, access: 'first-refresh' }) }, result: 'first' })),
    second.modifyCredentials('github', async current => ({ credentials: { ...current, oauthState: JSON.stringify({ counter: (JSON.parse(current.oauthState!).counter ?? 0) + 1, access: 'second-refresh' }) }, result: 'second' })),
  ]);
  assert.deepEqual(results, ['first', 'second']);
  assert.equal(JSON.parse((await store.getCredentials('github')).oauthState!).counter, 1);
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const refresh = store.modifyCredentials('github', async current => { started(); await gate; return { credentials: { ...current, accessToken: 'late-refresh' }, result: true }; });
  await entered; const disconnect = second.disconnect('github'); release(); await refresh; await disconnect;
  assert.deepEqual(await store.getCredentials('github'), {});
  await assert.rejects(store.modifyCredentials('github', async current => ({ credentials: { ...current, accessToken: 'revived' }, result: true })), error('service_connection_unavailable'));
  await assert.rejects(store.updateCredentials('github', { accessToken: 'revived' }), error('service_connection_unavailable'));
  await assert.rejects(store.verifyConnection('github', identity), error('service_connection_unavailable'));
});

test('changing login/application identity discards credentials from the previous account configuration', async t => {
  const { store } = await fixture(t);
  await store.saveConfiguration('tencent', { scopes: ['read'], email: 'first@qq.com', mailboxType: 'qq', credentials: { authorizationCode: 'first-code' } });
  await store.saveConfiguration('tencent', { scopes: ['read'], email: 'second@example.com', mailboxType: 'exmail' });
  assert.deepEqual(await store.getCredentials('tencent'), {});
  await store.saveConfiguration('gmail', { scopes: ['read'], clientId: 'first-client', credentials: { accessToken: 'first-token' } });
  await store.saveConfiguration('gmail', { scopes: ['read'], clientId: 'second-client' });
  assert.deepEqual(await store.getCredentials('gmail'), {});
});

test('attachment-sized approved arguments persist privately within the four MiB request limit', async t => {
  const { root, store } = await fixture(t), binding = await connected(store);
  const payload = 'a'.repeat(3 * 1024 * 1024), prepared = await store.prepareOperation({ ...operation(binding, 'attachment-operation'), arguments: { body: 'approved body', attachments: [{ name: 'synthetic.bin', base64: payload }] } });
  assert.equal(JSON.stringify(await store.getOperation(prepared.operationId)).includes(payload), false);
  const reopened = new ServiceConnectionStore({ dataRoot: root }); await reopened.init();
  assert.equal(((await reopened.getOperationReview(prepared.operationId))!.arguments.attachments as { base64: string }[])[0].base64.length, payload.length);
  await assert.rejects(store.prepareOperation({ ...operation(binding, 'oversized-operation'), arguments: { body: 'a'.repeat(4 * 1024 * 1024) } }), error('service_payload_too_large'));
});

test('saving a PAT replaces prior OAuth mode and Tencent authorization code replaces token remnants', async t => {
  const { store } = await fixture(t);
  const oauthSecrets = { accessToken: 'old-oauth-access', refreshToken: 'old-oauth-refresh', expiresAt: '2027-01-01T00:00:00.000Z', oauthClientId: 'old-native-client', oauthState: '{"type":"oauth","access":"old-oauth-access"}', clientSecret: 'configured-client-secret' };
  const githubConfig = { scopes: ['read'], repositories: ['openai/synthetic'], clientId: 'registered-client' };
  await store.saveConfiguration('github', { ...githubConfig, credentials: oauthSecrets });
  await store.saveConfiguration('github', { ...githubConfig, credentials: { accessToken: 'replacement-PAT' } });
  assert.deepEqual(await store.getCredentials('github'), { accessToken: 'replacement-PAT', clientSecret: 'configured-client-secret' });
  assert.equal((await store.get('github'))?.status, 'unverified');
  const mailConfig = { scopes: ['read'], mailboxType: 'qq', email: 'synthetic@qq.com' };
  await store.saveConfiguration('tencent', { ...mailConfig, credentials: { ...oauthSecrets, authorizationCode: 'old-mail-code' } });
  await store.saveConfiguration('tencent', { ...mailConfig, credentials: { authorizationCode: 'replacement-mail-code' } });
  assert.deepEqual(await store.getCredentials('tencent'), { authorizationCode: 'replacement-mail-code' });
  await store.saveConfiguration('tencent', { ...mailConfig, email: 'other@qq.com' });
  assert.deepEqual(await store.getCredentials('tencent'), {});
});

test('OAuth modification guard rejects a config save that won before the refresh acquired its lock', async t => {
  const { store } = await fixture(t); await connected(store);
  const versionBeforeLookup = await store.version();
  await store.saveConfiguration('github', { ...config, credentials: { accessToken: 'new-PAT' } });
  let invoked = false;
  await assert.rejects(store.modifyCredentials('github', async current => { invoked = true; return { credentials: { ...current, oauthState: '{"type":"oauth","access":"obsolete"}' }, result: true }; }, versionBeforeLookup), error('service_connection_conflict'));
  assert.equal(invoked, false);
  assert.equal((await store.getCredentials('github')).accessToken, 'new-PAT');
  assert.equal((await store.getCredentials('github')).oauthState, undefined);
});

test('late verification status cannot mark a newer same-policy configuration as failed', async t => {
  const { store } = await fixture(t); await connected(store);
  const before = (await store.get('github'))!, beforeVersion = await store.version();
  await store.saveConfiguration('github', { ...config, credentials: { accessToken: 'newer-configuration-PAT' } });
  await assert.rejects(store.setStatus('github', 'error', before.revision, beforeVersion), error('service_connection_conflict'));
  assert.equal((await store.get('github'))?.status, 'unverified');
  assert.equal((await store.getCredentials('github')).accessToken, 'newer-configuration-PAT');
});

test('verified identity, frozen catalog and staged credentials are adopted in exactly one transaction', async t => {
  const { root, store } = await fixture(t); const original = await connected(store);
  const oldView = (await store.get('github'))!, oldSecrets = await store.getCredentials('github'), oldVersion = await store.version();
  const staged = { accessToken: 'staged-new-access', refreshToken: 'staged-new-refresh', oauthState: '{"type":"oauth","access":"staged-new-access"}' };
  await assert.rejects(store.adoptVerification('github', { ...identity, accountId: '' }, staged, oldView.revision, oldVersion), error('invalid_service_configuration'));
  assert.deepEqual(await store.get('github'), oldView); assert.deepEqual(await store.getCredentials('github'), oldSecrets); assert.equal(await store.version(), oldVersion);
  await assert.rejects(store.adoptVerification('github', identity, { accessToken: '' }, oldView.revision, oldVersion), error('invalid_service_configuration'));
  assert.deepEqual(await store.getCredentials('github'), oldSecrets); assert.equal(await store.version(), oldVersion);
  const adopted = await store.adoptVerification('github', identity, staged, oldView.revision, oldVersion);
  assert.equal(adopted.revision, oldView.revision); assert.equal(await store.version(), oldVersion + 1);
  assert.deepEqual(await store.getCredentials('github'), staged); assert.equal((await store.validateBinding(original)).available, true);
  const reopened = new ServiceConnectionStore({ dataRoot: root }); await reopened.init();
  assert.deepEqual(await reopened.getCredentials('github'), staged); assert.equal((await reopened.get('github'))?.accountId, identity.accountId);
  const nextVersion = await store.version();
  const next = await store.adoptVerification('github', { ...identity, accountId: 'newly-verified-account' }, { accessToken: 'newly-verified-PAT' }, adopted.revision, nextVersion);
  assert.equal(next.revision, adopted.revision + 1); assert.equal((await store.validateBinding(original)).available, false);
  assert.deepEqual(await store.getCredentials('github'), { accessToken: 'newly-verified-PAT' });
});

test('verification adoption CAS never attaches an obsolete staged identity or token to a newer config', async t => {
  const { store } = await fixture(t); await connected(store);
  const connection = (await store.get('github'))!, expectedVersion = await store.version();
  await store.saveConfiguration('github', { ...config, credentials: { accessToken: 'newer-PAT' } });
  const currentView = await store.get('github'), currentSecrets = await store.getCredentials('github'), currentVersion = await store.version();
  await assert.rejects(store.adoptVerification('github', { ...identity, accountId: 'obsolete-staged-account' }, { accessToken: 'obsolete-staged-token' }, connection.revision, expectedVersion), error('service_connection_conflict'));
  assert.deepEqual(await store.get('github'), currentView); assert.deepEqual(await store.getCredentials('github'), currentSecrets); assert.equal(await store.version(), currentVersion);
  await store.disconnect('github');
  await assert.rejects(store.adoptVerification('github', identity, { accessToken: 'late-revival' }), error('service_connection_unavailable'));
  assert.deepEqual(await store.getCredentials('github'), {});
});

test('cross-instance competing adoption and configuration updates commit a coherent winner', async t => {
  const { root, store } = await fixture(t); await connected(store);
  const second = new ServiceConnectionStore({ dataRoot: root }); await second.init();
  const current = (await store.get('github'))!, oldSecrets = await store.getCredentials('github'), expectedVersion = await store.version();
  const settled = await Promise.allSettled([
    store.adoptVerification('github', { ...identity, accountId: 'adopted-account' }, { accessToken: 'adopted-token' }, current.revision, expectedVersion),
    second.saveConfiguration('github', { scopes: ['read'], repositories: ['openai/synthetic'] }, current.revision, expectedVersion),
  ]);
  assert.equal(settled.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(value => value.status === 'rejected' && value.reason.code === 'service_connection_conflict').length, 1);
  const final = (await second.get('github'))!, credentials = await second.getCredentials('github');
  if (final.accountId === 'adopted-account') { assert.equal(final.status, 'verified'); assert.deepEqual(credentials, { accessToken: 'adopted-token' }); }
  else { assert.equal(final.accountId, current.accountId); assert.equal(final.status, 'unverified'); assert.deepEqual(credentials, oldSecrets); }
});

test('cancelled adoption waiting for another writer never replaces the previous verified account', async t => {
  const { store } = await fixture(t); await connected(store);
  const before = (await store.get('github'))!, secrets = await store.getCredentials('github'), version = await store.version();
  await writeFile(store.lockPath, 'synthetic competing writer', { flag: 'wx', mode: 0o600 });
  const controller = new AbortController();
  const adoption = store.adoptVerification('github', { ...identity, accountId: 'cancelled-account' }, { accessToken: 'cancelled-token' }, before.revision, version, controller.signal);
  const rejected = assert.rejects(adoption, error('service_authorization_cancelled'));
  controller.abort(); await rm(store.lockPath); await rejected;
  assert.deepEqual(await store.get('github'), before); assert.deepEqual(await store.getCredentials('github'), secrets); assert.equal(await store.version(), version);
});


test('tool metadata fingerprint is validated, retained and frozen into task policy', async t => {
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  const tools = parseServiceTools('github', [{ ...readTool, metadataFingerprint: first }]);
  assert.equal(tools[0].metadataFingerprint, first);
  assert.equal(parseServiceTools('github', [{ ...readTool, metadataFingerprint: first.toUpperCase() }])[0].metadataFingerprint, first);
  assert.equal(parseServiceTools('github', [readTool])[0].metadataFingerprint, undefined);
  for (const fingerprint of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 123, null]) assert.throws(() => parseServiceTools('github', [{ ...readTool, metadataFingerprint: fingerprint }]));
  assert.throws(() => parseServiceTools('github', [{ ...readTool, metadataFingerprint: first, arbitraryMetadata: true }]));
  const { store } = await fixture(t), legacyBinding = await connected(store), before = (await store.get('github'))!;
  await store.verifyConnection('github', { ...identity, tools: [{ ...readTool, metadataFingerprint: first }, writeTool] });
  assert.equal((await store.get('github'))?.revision, before.revision + 1);
  assert.equal((await store.validateBinding(legacyBinding)).available, false);
  const binding = await store.createBinding('github'), revision = binding.revision;
  assert.equal(binding.tools.find(tool => tool.name === readTool.name)?.metadataFingerprint, first);
  await store.verifyConnection('github', { ...identity, tools: [{ ...readTool, metadataFingerprint: first }, writeTool] });
  assert.equal((await store.get('github'))?.revision, revision);
  assert.equal((await store.validateBinding(binding)).available, true);
  await store.verifyConnection('github', { ...identity, tools: [{ ...readTool, metadataFingerprint: second }, writeTool] });
  assert.equal((await store.get('github'))?.revision, revision + 1);
  assert.equal((await store.validateBinding(binding)).available, false);
});

test('model retries with a new tool call ID cannot replay an uncertain write in the original request', async t => {
  const { store } = await fixture(t), binding = await connected(store);
  const original = operation(binding, 'original-uncertain-operation');
  const first = await store.prepareOperation(original);
  await store.transitionOperation(first.operationId, 'confirmed'); await store.transitionOperation(first.operationId, 'submitted');
  const whileSubmitted = await store.prepareOperation({ ...original, operationId: 'new-model-operation-1', toolCallId: 'new-model-call-1' });
  assert.equal(whileSubmitted.operationId, first.operationId); assert.equal(whileSubmitted.toolCallId, original.toolCallId); assert.equal(whileSubmitted.status, 'submitted');
  assert.equal(await store.getOperation('new-model-operation-1'), null);
  await store.transitionOperation(first.operationId, 'unknown');
  const afterUnknown = await store.prepareOperation({ ...original, operationId: 'new-model-operation-2', toolCallId: 'new-model-call-2' });
  assert.equal(afterUnknown.operationId, first.operationId); assert.equal(afterUnknown.toolCallId, original.toolCallId); assert.equal(afterUnknown.status, 'unknown');
  assert.equal(await store.getOperation('new-model-operation-2'), null);
  await assert.rejects(store.transitionOperation(afterUnknown.operationId, 'submitted'), error('service_operation_transition_forbidden'));
  const changedContent = await store.prepareOperation({ ...original, operationId: 'changed-content-operation', toolCallId: 'changed-content-call', arguments: { ...original.arguments, body: 'Explicitly revised content' } });
  assert.equal(changedContent.status, 'prepared'); assert.equal(changedContent.operationId, 'changed-content-operation');
  const newUserRequest = await store.prepareOperation({ ...original, operationId: 'new-user-operation', toolCallId: 'new-user-call', requestId: 'new-explicit-user-request' });
  assert.equal(newUserRequest.status, 'prepared'); assert.equal(newUserRequest.operationId, 'new-user-operation');
  assert.equal((await store.listOperations({ projectId: original.projectId, taskId: original.taskId })).total, 3);
});

test('successful and definitively rejected attempts do not suppress independent subsequent writes', async t => {
  const { store } = await fixture(t), binding = await connected(store), original = operation(binding, 'completed-operation');
  const first = await store.prepareOperation(original); await store.transitionOperation(first.operationId, 'confirmed'); await store.transitionOperation(first.operationId, 'submitted'); await store.transitionOperation(first.operationId, 'succeeded');
  const second = await store.prepareOperation({ ...original, operationId: 'second-operation', toolCallId: 'second-call' });
  assert.equal(second.status, 'prepared'); await store.transitionOperation(second.operationId, 'rejected');
  const third = await store.prepareOperation({ ...original, operationId: 'third-operation', toolCallId: 'third-call' });
  assert.equal(third.status, 'prepared'); assert.equal(third.operationId, 'third-operation');
});

test('target connection CAS survives unrelated settings, operation journal and unchanged native credential reads', async t => {
  const { store } = await fixture(t), binding = await connected(store);
  const snapshot = await store.privateConnectionSnapshot('github'), version = await store.version();
  await store.saveConfiguration('gmail', { scopes: ['read'], credentials: { clientSecret: 'unrelated-gmail-secret' } });
  await store.prepareOperation(operation(binding, 'unrelated-operation-journal'));
  await store.modifyCredentials('github', async current => ({ credentials: current, result: true }));
  const adopted = await store.adoptVerification('github', identity, { accessToken: 'verified-staged-token' }, snapshot.connection.revision, version, undefined, snapshot.fingerprint);
  assert.equal(adopted.status, 'verified'); assert.deepEqual(await store.getCredentials('github'), { accessToken: 'verified-staged-token' });
  assert.equal((await store.get('gmail'))?.credentialsConfigured.clientSecret, true);
});

test('target fingerprint rejects stale adoption, refresh and late status after same-policy PAT replacement', async t => {
  const { store } = await fixture(t); await connected(store);
  const before = await store.privateConnectionSnapshot('github'), oldVersion = await store.version();
  before.credentials.accessToken = 'caller-mutated-copy'; before.connection.scopes.push('merge');
  assert.equal((await store.getCredentials('github')).accessToken, config.credentials.accessToken);
  assert.deepEqual((await store.get('github'))?.scopes, ['collaborate', 'read']);
  await store.saveConfiguration('github', { ...config, credentials: { accessToken: 'new-user-PAT' } });
  const current = await store.privateConnectionSnapshot('github');
  assert.notEqual(current.fingerprint, before.fingerprint); assert.equal(current.connection.revision, before.connection.revision);
  await assert.rejects(store.adoptVerification('github', identity, { accessToken: 'obsolete-adoption' }, before.connection.revision, oldVersion, undefined, before.fingerprint), error('service_connection_conflict'));
  let invoked = false;
  await assert.rejects(store.modifyCredentials('github', async credentials => { invoked = true; return { credentials: { ...credentials, accessToken: 'obsolete-refresh' }, result: true }; }, oldVersion, before.fingerprint), error('service_connection_conflict'));
  assert.equal(invoked, false);
  await assert.rejects(store.setStatus('github', 'expired', before.connection.revision, oldVersion, before.fingerprint), error('service_connection_conflict'));
  assert.deepEqual(await store.privateConnectionSnapshot('github'), current);
});

test('unchanged native reads preserve target fingerprints while real refreshes invalidate competing work', async t => {
  const { store } = await fixture(t); await connected(store);
  const original = await store.privateConnectionSnapshot('github'), version = await store.version();
  await store.saveConfiguration('gmail', { scopes: ['read'] });
  await store.modifyCredentials('github', async credentials => ({ credentials, result: true }), version, original.fingerprint);
  assert.equal((await store.privateConnectionSnapshot('github')).fingerprint, original.fingerprint);
  await store.modifyCredentials('github', async credentials => ({ credentials: { ...credentials, accessToken: 'actually-refreshed' }, result: true }), version, original.fingerprint);
  const refreshed = await store.privateConnectionSnapshot('github'); assert.notEqual(refreshed.fingerprint, original.fingerprint);
  await assert.rejects(store.modifyCredentials('github', async credentials => ({ credentials: { ...credentials, accessToken: 'competing-refresh' }, result: true }), undefined, original.fingerprint), error('service_connection_conflict'));
  await store.saveConfiguration('gmail', { scopes: ['read', 'send'] });
  await store.setStatus('github', 'expired', refreshed.connection.revision, version, refreshed.fingerprint);
  assert.equal((await store.get('github'))?.status, 'expired');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServiceConnection, TaskServiceBinding } from '../src/host/service-connection-types.ts';
import { actOnServiceConnection, cancelServiceAuthorization, listServiceConnections, readServiceConnection, saveServiceConnection, serviceAuthorizationObservation, serviceBindingAvailability, ServiceConnectionRequestError, ServiceConnectionUncertain, setTaskServiceConnection, trustedServiceAuthorizationUrl } from '../src/host/ui/service-connections-client.ts';

const connection: ServiceConnection = {
  service: 'github', connectionId: 'connection-github', revision: 3, status: 'verified', accountId: 'account-a', accountLabel: '@account-a', scopes: ['read', 'collaborate'], repositories: ['team/one', 'team/two'],
  tools: [{ name: 'get_issue', semanticName: 'get_issue', inputSchema: { type: 'object' }, scope: 'read', action: 'read', write: false, requiresConfirmation: false }],
  credentialsConfigured: { accessToken: true, refreshToken: false, clientSecret: false, authorizationCode: false }, updatedAt: '2026-11-27T00:00:00Z', verifiedAt: '2026-11-27T00:00:00Z',
};
const binding: TaskServiceBinding = { service: 'github', connectionId: connection.connectionId, revision: connection.revision, accountId: connection.accountId!, accountLabel: connection.accountLabel!, scopes: ['read'], repositories: ['team/one'], tools: connection.tools };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('GG01 connection observation makes GET requests only and enforces the requested service identity', async t => {
  const calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); calls.push({ url, method: init?.method ?? 'GET' }); return json(url.endsWith('/status') ? { connection } : { connections: [connection] }); });
  assert.equal((await listServiceConnections())[0]?.accountId, 'account-a');
  assert.equal((await readServiceConnection('github')).connection.revision, 3);
  await assert.rejects(readServiceConnection('gmail'), ServiceConnectionRequestError);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.every(call => call.url.startsWith('/api/service-connections')));
});

test('GG02 a saved configuration remains unverified and credentials occur only in the explicit save body', async t => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return json({ connection: { ...connection, revision: 4, status: 'unverified', accountId: undefined, accountLabel: undefined } }); });
  const value = await saveServiceConnection('github', 3, { scopes: ['read'], repositories: ['team/one'] }, { accessToken: 'synthetic-secret-only-in-save' });
  assert.equal(value.connection.status, 'unverified');
  assert.equal(value.connection.accountId, undefined);
  assert.equal(JSON.stringify(value).includes('synthetic-secret-only-in-save'), false);
  assert.deepEqual(calls, [{ url: '/api/service-connections/github', body: { expectedRevision: 3, config: { scopes: ['read'], repositories: ['team/one'] }, credentials: { accessToken: 'synthetic-secret-only-in-save' } } }]);
});

test('GG09 missing mutation response keeps uncertainty without repeating save, connect, verify or disconnect', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => { calls.push(String(input)); throw new TypeError('synthetic lost response'); });
  await assert.rejects(saveServiceConnection('github', 3, { scopes: ['read'], repositories: ['team/one'] }), ServiceConnectionUncertain);
  for (const action of ['connect', 'verify', 'disconnect', 'oauth/start'] as const) await assert.rejects(actOnServiceConnection('github', action, 3), ServiceConnectionUncertain);
  assert.deepEqual(calls, ['/api/service-connections/github', '/api/service-connections/github/connect', '/api/service-connections/github/verify', '/api/service-connections/github/disconnect', '/api/service-connections/github/oauth/start']);
});

test('GG12 provider error text cannot echo a credential in user-visible failure messages', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ code: 'provider_failed', error: 'synthetic-token-sentinel', message: 'synthetic-token-sentinel' }, 403));
  await assert.rejects(actOnServiceConnection('feishu', 'verify', 3), (error: unknown) => error instanceof ServiceConnectionRequestError && !error.message.includes('synthetic-token-sentinel') && /管理员|权限/.test(error.message));
});

test('GG02 OAuth cancellation addresses only its original attempt and does not disconnect the account', async t => {
  const calls: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return json({ connection }); });
  assert.equal((await cancelServiceAuthorization('github', 'attempt-a')).connection.accountId, 'account-a');
  assert.deepEqual(calls, [{ url: '/api/service-connections/github/oauth/cancel', body: { attemptId: 'attempt-a' } }]);
});

test('GG02 a prior verified account cannot prove a pending, failed or missing replacement authorization succeeded', () => {
  const before = structuredClone(connection);
  assert.equal(serviceAuthorizationObservation({ connection, authorization: { attemptId: 'new-attempt', url: 'https://github.com/login/oauth/authorize' } }, 'new-attempt').status, 'pending');
  const failed = serviceAuthorizationObservation({ connection, authorizationResult: { attemptId: 'new-attempt', status: 'failed', code: 'provider_failed' } }, 'new-attempt');
  assert.equal(failed.status, 'failed'); assert.match(failed.message, /本次账号授权失败/);
  assert.equal(serviceAuthorizationObservation({ connection }, 'new-attempt').status, 'unknown');
  assert.deepEqual(connection, before);
});

test('GG02 only the original exact attempt receipt can report success or cancellation', () => {
  const success = serviceAuthorizationObservation({ connection, authorizationResult: { attemptId: 'new-attempt', status: 'succeeded' } }, 'new-attempt');
  assert.equal(success.status, 'succeeded'); assert.match(success.message, /本次账号授权已完成/);
  assert.equal(serviceAuthorizationObservation({ connection, authorizationResult: { attemptId: 'other-attempt', status: 'succeeded' } }, 'new-attempt').status, 'unknown');
  assert.equal(serviceAuthorizationObservation({ connection, authorizationResult: { attemptId: 'other-attempt', status: 'cancelled' } }, 'new-attempt').status, 'unknown');
  assert.equal(serviceAuthorizationObservation({ connection: { ...connection, status: 'expired' }, authorizationResult: { attemptId: 'new-attempt', status: 'succeeded' } }, 'new-attempt').status, 'unknown');
  const cancelled = serviceAuthorizationObservation({ connection, authorizationResult: { attemptId: 'new-attempt', status: 'cancelled' } }, 'new-attempt');
  assert.deepEqual(cancelled, { status: 'cancelled', message: '本次账号授权已取消。原有连接与任务选择保留。' });
});

test('GG02 a different pending attempt is never treated as the original authorization, while stale unrelated receipts are ignored', () => {
  assert.equal(serviceAuthorizationObservation({ connection, authorization: { attemptId: 'replacement-attempt', url: 'https://github.com/login/oauth/authorize' } }, 'original-attempt').status, 'unknown');
  assert.equal(serviceAuthorizationObservation({ connection, authorization: { attemptId: 'original-attempt', url: 'https://github.com/login/oauth/authorize' }, authorizationResult: { attemptId: 'older-attempt', status: 'succeeded' } }, 'original-attempt').status, 'pending');
});

test('GG12 authorization outcomes render fixed messages and reject invalid public receipt shapes', async t => {
  const failed = serviceAuthorizationObservation({ connection, authorizationResult: { attemptId: 'attempt-a', status: 'failed', code: 'synthetic_provider_secret_sentinel' } }, 'attempt-a');
  assert.equal(failed.message.includes('synthetic_provider_secret_sentinel'), false);
  t.mock.method(globalThis, 'fetch', async () => json({ connection, authorizationResult: { attemptId: 'attempt-a', status: 'provider-invented-success' } }));
  await assert.rejects(readServiceConnection('github'), ServiceConnectionRequestError);
});

test('GG12 only exact trusted provider authorization origins can receive browser navigation', () => {
  assert.ok(trustedServiceAuthorizationUrl('github', 'https://github.com/login/oauth/authorize?state=synthetic'));
  assert.ok(trustedServiceAuthorizationUrl('gmail', 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'));
  assert.ok(trustedServiceAuthorizationUrl('feishu', 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'));
  for (const url of ['http://github.com/login/oauth/authorize', 'https://github.com.evil.invalid/login/oauth/authorize', 'https://evil.invalid@github.com/login/oauth/authorize', 'https://github.com:444/login/oauth/authorize', 'https://github.com/login/oauth/authorize#fragment', 'https://github.com/unrelated']) assert.equal(trustedServiceAuthorizationUrl('github', url), undefined);
  assert.equal(trustedServiceAuthorizationUrl('feishu', 'https://accounts.feishu.cn.evil.invalid/authorize'), undefined);
  assert.equal(trustedServiceAuthorizationUrl('tencent', 'https://accounts.google.com/o/oauth2/v2/auth'), undefined);
});

test('GG04 disconnect, account change, tenant change and narrowing preserve the binding while denying availability', () => {
  assert.deepEqual(serviceBindingAvailability(connection, binding), { available: true, label: '本任务已开启' });
  const original = structuredClone(binding);
  for (const changed of [{ ...connection, status: 'disconnected' as const }, { ...connection, status: 'expired' as const }, { ...connection, accountId: 'account-b' }, { ...connection, tenantId: 'tenant-b' }, { ...connection, repositories: ['team/two'] }]) assert.equal(serviceBindingAvailability(changed, binding).available, false);
  assert.deepEqual(binding, original);
});

test('GG03 task narrowing sends exact owner, current revision and chosen subset without borrowing another task', async t => {
  const calls: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return json({ task: { id: 'task-a', serviceConnections: { github: binding } } }); });
  const input = { enabled: true, scopes: ['read'] as const, repositories: ['team/one'], expectedConnectionRevision: 3 };
  const task = await setTaskServiceConnection('project/a', 'task-a', 'github', { ...input, scopes: [...input.scopes] });
  assert.equal(task.serviceConnections?.github?.accountId, 'account-a');
  assert.deepEqual(calls, [{ url: '/api/projects/project%2Fa/tasks/task-a/service-connections/github', body: input }]);
  await assert.rejects(setTaskServiceConnection('project/a', 'task-b', 'github', { enabled: false, expectedConnectionRevision: 3 }), ServiceConnectionRequestError);
});

test('GG04 compare-and-swap conflict cannot silently retry with a later connection revision', async t => {
  const calls: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => { calls.push(JSON.parse(String(init?.body))); return json({ code: 'service_revision_conflict' }, 409); });
  await assert.rejects(setTaskServiceConnection('project-a', 'task-a', 'github', { enabled: true, scopes: ['read'], expectedConnectionRevision: 3 }), (error: unknown) => error instanceof ServiceConnectionRequestError && error.status === 409);
  assert.deepEqual(calls, [{ enabled: true, scopes: ['read'], expectedConnectionRevision: 3 }]);
});

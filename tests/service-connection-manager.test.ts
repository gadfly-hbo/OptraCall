import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ServiceRemoteError } from '../src/host/service-connection-mcp.ts';
import { ServiceConnectionManager } from '../src/host/service-connection-manager.ts';
import type { ServiceConnectionCallContext } from '../src/agent/service-connection-tools.ts';
import { serviceOAuthProviderId, type ServiceOAuthManager, type createServiceOAuthCredentialStore } from '../src/host/service-connection-oauth.ts';
import type { ServiceTool } from '../src/host/service-connection-types.ts';

const schema = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, body: { type: 'string' } }, required: ['owner', 'repo', 'body'], additionalProperties: false };
const write: ServiceTool = { name: 'merge_pull_request', semanticName: 'merge', scope: 'merge', action: 'merge', write: true, requiresConfirmation: true, inputSchema: schema };
const read: ServiceTool = { ...write, name: 'issue_read', scope: 'read', action: 'read', write: false, requiresConfirmation: false };
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t: { after(fn: () => Promise<void>): void }, options: Partial<ConstructorParameters<typeof ServiceConnectionManager>[0]> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-service-manager-'));
  const calls: Array<Record<string, unknown>> = [], retired: string[] = [];
  let reply: (value: Record<string, unknown>) => Promise<unknown> = async () => ({ status: 'ok', id: 'receipt' });
  const backend = {
    verify: async (connection: import('../src/host/service-connection-types.ts').ServiceConnection, _credentials?: unknown, _context?: import('../src/host/service-connection-mcp.ts').RemoteServiceContext) => ({ accountId: '42', accountLabel: 'fixture account', scopes: connection.scopes, tools: [write, read].filter(tool => connection.scopes.includes(tool.scope)), repositories: connection.repositories }),
    invoke: async (input: import('../src/host/service-connection-mcp.ts').RemoteServiceInvoke) => { calls.push(input as unknown as Record<string, unknown>); return reply(input as unknown as Record<string, unknown>); }, close: async (_id?: string) => {},
  };
  const manager = new ServiceConnectionManager({ dataRoot: root, invalidate: async service => { retired.push(service); }, assertOwner: async () => {}, backend, ...options });
  await manager.init();
  t.after(async () => { await manager.close(); await fs.rm(root, { recursive: true, force: true }); });
  const saved = await manager.save('github', { expectedRevision: 0, config: { scopes: ['read', 'merge'], repositories: ['owner/one', 'owner/two'] }, credentials: { accessToken: 'synthetic-secret-123' } });
  const verified = await manager.verify('github', saved.connection.revision);
  const binding = await manager.binding('github', { expectedConnectionRevision: verified.connection.revision, scopes: ['read', 'merge'], repositories: ['owner/one'] });
  const port = manager.port('project', 'task', { github: binding });
  return { manager, binding, port, calls, retired, backend, root, setReply(fn: typeof reply) { reply = fn; } };
}
function context(overrides: Partial<ServiceConnectionCallContext> = {}): ServiceConnectionCallContext {
  return { projectId: 'project', taskId: 'task', requestId: 'request', sessionId: 'session', toolCallId: 'call', signal: new AbortController().signal, assertCurrent() {}, registerCleanup() {}, confirm: async () => true, input: async () => '', select: async (_title, options) => options[0]!, ...overrides };
}
const input = { service: 'github' as const, toolName: write.name, args: { owner: 'owner', repo: 'one', body: 'exact content' } };

test('GG04/05 manager supplies narrowed immutable task grants and no public credentials', async t => {
  const { manager, port, calls, binding } = await fixture(t);
  const snapshot = await manager.snapshot('github'); assert.ok(!JSON.stringify(snapshot).includes('synthetic-secret'));
  await port.call({ ...input, toolName: read.name }, context());
  const connection = calls[0]!.connection as { repositories: string[] };
  assert.deepEqual(connection.repositories, ['owner/one']); assert.deepEqual(binding.repositories, ['owner/one']);
  await assert.rejects(port.call({ ...input, toolName: 'unlisted' }, context()));
  await assert.rejects(port.call({ ...input, args: { ...input.args, accessToken: 'poison' } }, context()));
  await assert.rejects(port.call(input, context({ taskId: 'different' })));
  assert.equal(calls.length, 1);
});
test('GG08 confirmation preview and operation digest hold original exact arguments', async t => {
  const { manager, port, calls } = await fixture(t), decision = deferred<boolean>(), shown = deferred<string>();
  const mutable = structuredClone(input);
  const run = port.call(mutable, context({ confirm: async (_title, message) => { shown.resolve(message); return decision.promise; } }));
  assert.match(await shown.promise, /fixture account/); mutable.args.body = 'edited after preview'; decision.resolve(true);
  const answer = await run;
  assert.equal((calls[0]!.arguments as Record<string, unknown>).body, 'exact content');
  assert.equal((answer.details.operation as { status: string }).status, 'succeeded');
  const list = await manager.store.listOperations({ projectId: 'project', taskId: 'task' });
  assert.ok(!JSON.stringify(list).includes('exact content'));
  assert.equal(list.operations.length, 1);
});
test('GG09 an unknown external write is durable and never replayed for the same original call', async t => {
  const { manager, port, calls, setReply } = await fixture(t);
  setReply(async () => { throw new Error('lost response synthetic-secret-123'); });
  const first = await port.call(input, context()); assert.match(first.content[0]!.text, /unknown/); assert.ok(!JSON.stringify(first).includes('synthetic-secret'));
  const second = await port.call(input, context()); assert.match(second.content[0]!.text, /unknown/); assert.equal(calls.length, 1);
  assert.equal((await manager.store.listOperations({ projectId: 'project', taskId: 'task' })).operations[0]!.status, 'unknown');
});
test('GG08/11 cancel or account disconnect during approval prevents dispatch', async t => {
  for (const mode of ['cancel', 'disconnect'] as const) {
    const { manager, port, calls, binding } = await fixture(t), decision = deferred<boolean>(), shown = deferred<void>(), controller = new AbortController();
    const run = port.call(input, context({ signal: controller.signal, confirm: async () => { shown.resolve(); return decision.promise; } }));
    await shown.promise;
    if (mode === 'cancel') controller.abort(); else await manager.disconnect('github', binding.revision);
    decision.resolve(true); await assert.rejects(run); assert.equal(calls.length, 0);
    if (mode === 'disconnect') assert.equal((await manager.snapshot('github')).connection.status, 'disconnected');
  }
});
test('GG11 late accepted write preserves business receipt without delivering into cancelled context', async t => {
  const { manager, port, calls, setReply } = await fixture(t), dispatch = deferred<void>(), response = deferred<unknown>(), controller = new AbortController();
  setReply(async () => { dispatch.resolve(); return response.promise; });
  const run = port.call(input, context({ signal: controller.signal })); await dispatch.promise;
  controller.abort(); response.resolve({ status: 'accepted' }); await assert.rejects(run); assert.equal(calls.length, 1);
  assert.equal((await manager.store.listOperations({ projectId: 'project', taskId: 'task' })).operations[0]!.status, 'succeeded');
});

test('a fresh call and new binding are blocked while settings verification awaits retirement', async t => {
  const { manager, port, backend, binding, calls } = await fixture(t), closed = deferred<void>(), release = deferred<void>();
  backend.close = async () => { closed.resolve(); await release.promise; };
  const verifying = manager.verify('github', binding.revision); await closed.promise;
  try {
    await assert.rejects(port.call({ ...input, toolName: read.name }, context()));
    await assert.rejects(manager.binding('github', { expectedConnectionRevision: binding.revision }));
    assert.equal(calls.length, 0);
  } finally { release.resolve(); await verifying; }
});

test('the Host port freezes its binding snapshot and cannot be redirected through a retained caller object', async t => {
  const { port, calls, binding } = await fixture(t);
  (binding.repositories as string[])[0] = 'owner/two';
  await port.call({ ...input, toolName: read.name }, context());
  assert.deepEqual((calls[0]!.connection as { repositories: string[] }).repositories, ['owner/one']);
});

test('all service results receive final known-credential scrubbing before model or native projection', async t => {
  const { port, setReply } = await fixture(t);
  setReply(async () => ({ status: 'ok', nested: { echo: 'upstream Bearer synthetic-secret-123' }, content: [{ type: 'text', text: 'synthetic-secret-123' }] }));
  const response = await port.call({ ...input, toolName: read.name }, context());
  assert.ok(!JSON.stringify(response).includes('synthetic-secret-123'));
});

test('known pre-dispatch errors are rejected while ambiguous network loss stays UNKNOWN', async t => {
  const { manager, port, setReply } = await fixture(t);
  setReply(async () => { throw new ServiceRemoteError('service_oauth_expired', false, 401); });
  const response = await port.call(input, context());
  assert.equal((response.details.operation as { status: string }).status, 'rejected');
  assert.equal((await manager.snapshot('github')).connection.status, 'expired');
});

test('verification retains UNKNOWN cleanup even when the backend throws before returning its result', async t => {
  const { manager, backend, binding } = await fixture(t); let attempts = 0;
  backend.verify = async (_connection, _credentials, context) => {
    let retirement: Promise<void> | undefined;
    const cleanup = (options: { retryFailed?: boolean }) => { if (!retirement || options.retryFailed) retirement = Promise.resolve().then(() => { attempts++; if (!options.retryFailed) throw new Error('synthetic cleanup failed'); }); return retirement; };
    context!.registerCleanup!(cleanup); await cleanup({ retryFailed: false }); throw new Error('unreachable');
  };
  await assert.rejects(manager.verify('github', binding.revision));
  assert.equal((await manager.snapshot('github')).connection.status, 'unknown');
  assert.equal(attempts, 1);
  await manager.disconnect('github', binding.revision);
  assert.equal(attempts, 2, 'only the explicit disconnect retries the held resource cleanup');
});

test('UNKNOWN is not repeated when the same model request supplies a new tool call ID', async t => {
  const { manager, port, setReply, calls } = await fixture(t); let confirmations = 0;
  setReply(async () => { throw new Error('ambiguous external loss'); });
  const first = await port.call(input, context({ confirm: async () => { confirmations++; return true; } }));
  const retry = await port.call(input, context({ toolCallId: 'new-model-generated-call', confirm: async () => { confirmations++; return true; } }));
  assert.equal(calls.length, 1); assert.equal(confirmations, 1);
  assert.equal((first.details.operation as { operationId: string }).operationId, (retry.details.operation as { operationId: string }).operationId);
  assert.equal((await manager.store.listOperations({ projectId: 'project', taskId: 'task' })).total, 1);
});

test('an MCP error result after an external effect stays UNKNOWN and suppresses replay', async t => {
  const { port, calls, setReply } = await fixture(t); let effects = 0;
  setReply(async () => { effects++; return { isError: true, content: [{ type: 'text', text: 'Post-commit response formatting failed.' }] }; });
  const first = await port.call(input, context());
  const retry = await port.call(input, context({ toolCallId: 'retry-after-postcommit-error' }));
  assert.equal((first.details.operation as { status: string }).status, 'unknown');
  assert.equal((retry.details.operation as { status: string }).status, 'unknown');
  assert.equal(effects, 1); assert.equal(calls.length, 1);
});

function oauthFixture() {
  let native!: ReturnType<typeof createServiceOAuthCredentialStore>, providerId = '', signal: AbortSignal | undefined;
  const completion = deferred<void>();
  const factory = async (credentials: ReturnType<typeof createServiceOAuthCredentialStore>): Promise<ServiceOAuthManager> => {
    native = credentials;
    return {
      begin: async (connection: Parameters<ServiceOAuthManager['begin']>[0], _secrets: unknown, options?: { signal?: AbortSignal }) => {
        providerId = serviceOAuthProviderId(connection); signal = options?.signal;
        return { attemptId: 'fixture-authorization', authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=synthetic-client', completion: completion.promise };
      },
      cancel: () => { completion.reject(new Error('synthetic authorization cancelled')); return true; },
      close: async () => {}, token: async () => 'unused-synthetic', refresh: async () => {},
    } as unknown as ServiceOAuthManager;
  };
  return {
    factory, finish: () => completion.resolve(),
    async stage(access = 'new-synthetic-account-token') { await native.modify(providerId, async () => ({ type: 'oauth', access, refresh: 'new-synthetic-refresh-token', expires: Date.now() + 3600000 }), { signal }); },
    async delayedStage(wait: Promise<void>) { return native.modify(providerId, async () => { await wait; return { type: 'oauth' as const, access: 'late-cancelled-token', refresh: '', expires: Date.now() + 3600000 }; }, { signal }); },
  };
}
async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) { const value = await read(); if (value !== undefined) return value; if (Date.now() > deadline) throw new Error('Synthetic manager condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('reauthorization stages tokens privately, blocks all new dispatch and cancellation restores the exact old grant', async t => {
  const oauth = oauthFixture(), { manager, port, binding, calls } = await fixture(t, { oauthFactory: oauth.factory });
  const pending = await manager.authorize('github', binding.revision);
  assert.equal(pending.connection.status, 'authorizing'); assert.ok(pending.authorization);
  await oauth.stage();
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'synthetic-secret-123');
  await assert.rejects(port.call({ ...input, toolName: read.name }, context()));
  await assert.rejects(manager.binding('github', { expectedConnectionRevision: binding.revision }));
  assert.equal(calls.length, 0);
  const cancelled = await manager.cancelAuthorization('github', pending.authorization!.attemptId);
  assert.equal(cancelled.connection.status, 'verified'); assert.equal(cancelled.authorization, undefined);
  assert.deepEqual(cancelled.authorizationResult, { attemptId: pending.authorization!.attemptId, status: 'cancelled' });
  assert.equal(cancelled.connection.accountId, binding.accountId); assert.equal(cancelled.connection.revision, binding.revision);
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'synthetic-secret-123');
  assert.equal((await manager.store.validateBinding(binding)).available, true);
  await port.call({ ...input, toolName: read.name }, context({ requestId: 'explicit-after-cancel' }));
  assert.equal(calls.length, 1); assert.equal((calls[0]!.credentials as { accessToken: string }).accessToken, 'synthetic-secret-123');
});

test('fresh OAuth cancellation returns unverified without persisting an authorizing status', async t => {
  const oauth = oauthFixture(), { manager } = await fixture(t, { oauthFactory: oauth.factory });
  const saved = await manager.save('gmail', { expectedRevision: 0, config: { scopes: ['read'], clientId: 'synthetic-desktop' } });
  const pending = await manager.authorize('gmail', saved.connection.revision);
  const cancelled = await manager.cancelAuthorization('gmail', pending.authorization!.attemptId);
  assert.equal(cancelled.connection.status, 'unverified'); assert.equal(cancelled.authorization, undefined);
  assert.equal(cancelled.authorizationResult?.status, 'cancelled');
  assert.deepEqual(await manager.store.getCredentials('gmail'), {});
});

test('the verified new identity and staged tokens become active in one atomic adoption after the real probe', async t => {
  const oauth = oauthFixture(), { manager, backend, binding, port } = await fixture(t, { oauthFactory: oauth.factory }), entered = deferred<void>(), release = deferred<void>();
  backend.verify = async (connection, credentials) => {
    assert.equal((credentials as { accessToken: string }).accessToken, 'new-synthetic-account-token'); entered.resolve(); await release.promise;
    return { accountId: '99', accountLabel: 'new-account', scopes: connection.scopes, tools: [write, read], repositories: connection.repositories };
  };
  await manager.authorize('github', binding.revision); await oauth.stage(); oauth.finish(); await entered.promise;
  assert.equal((await manager.store.get('github'))!.accountId, '42'); assert.equal((await manager.store.getCredentials('github')).accessToken, 'synthetic-secret-123');
  await assert.rejects(port.call({ ...input, toolName: read.name }, context()));
  release.resolve();
  const adopted = await waitFor(async () => { const snapshot = await manager.snapshot('github'); return snapshot.authorization ? undefined : snapshot.connection; });
  assert.equal(adopted.accountId, '99'); assert.ok(adopted.revision > binding.revision);
  assert.equal((await manager.snapshot('github')).authorizationResult?.status, 'succeeded');
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'new-synthetic-account-token');
  assert.equal((await manager.store.validateBinding(binding)).available, false);
});

test('failed reauthorization preserves the old account while exposing a matching explicit failure outcome', async t => {
  const oauth = oauthFixture(), { manager, backend, binding } = await fixture(t, { oauthFactory: oauth.factory });
  backend.verify = async () => { throw new ServiceRemoteError('service_scope_missing', false, 403); };
  const pending = await manager.authorize('github', binding.revision); await oauth.stage(); oauth.finish();
  const failed = await waitFor(async () => { const value = await manager.snapshot('github'); return value.authorization ? undefined : value; });
  assert.equal(failed.connection.status, 'verified'); assert.equal(failed.connection.accountId, binding.accountId);
  assert.deepEqual(failed.authorizationResult, { attemptId: pending.authorization!.attemptId, status: 'failed', code: 'service_scope_missing' });
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'synthetic-secret-123');
  assert.equal((await manager.store.validateBinding(binding)).available, true);
  const changed = await manager.save('github', { expectedRevision: binding.revision, config: { scopes: ['read'], repositories: ['owner/one'] }, credentials: { accessToken: 'different-explicit-pat' } });
  assert.equal(changed.authorizationResult, undefined, 'an old authorization outcome cannot describe a later credential configuration');
});

test('another provider configuration cannot invalidate an unchanged account authorization', async t => {
  const oauth = oauthFixture(), { manager, backend, binding } = await fixture(t, { oauthFactory: oauth.factory });
  backend.verify = async connection => ({ accountId: '99', accountLabel: 'new-account', scopes: connection.scopes, tools: [write, read], repositories: connection.repositories });
  await manager.authorize('github', binding.revision); await oauth.stage();
  await manager.save('gmail', { expectedRevision: 0, config: { scopes: ['read'], clientId: 'independent-desktop' } });
  oauth.finish();
  const value = await waitFor(async () => { const snapshot = await manager.snapshot('github'); return snapshot.authorization ? undefined : snapshot; });
  assert.equal(value.authorizationResult?.status, 'succeeded'); assert.equal(value.connection.accountId, '99');
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'new-synthetic-account-token');
});

test('a same-policy target credential change still rejects a stale authorization adoption', async t => {
  const oauth = oauthFixture(), { manager, binding } = await fixture(t, { oauthFactory: oauth.factory });
  await manager.authorize('github', binding.revision); await oauth.stage();
  await manager.store.updateCredentials('github', { accessToken: 'concurrent-same-policy-pat' }, binding.revision);
  oauth.finish();
  const value = await waitFor(async () => { const snapshot = await manager.snapshot('github'); return snapshot.authorization ? undefined : snapshot; });
  assert.equal(value.authorizationResult?.status, 'failed');
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'concurrent-same-policy-pat');
});

test('a late old-token 401 cannot expire a newly authorized account with the same policy revision', async t => {
  const oauth = oauthFixture(), { manager, binding, port, setReply } = await fixture(t, { oauthFactory: oauth.factory }), entered = deferred<void>(), release = deferred<void>();
  setReply(async () => { entered.resolve(); await release.promise; throw new ServiceRemoteError('service_oauth_expired', false, 401); });
  const old = port.call({ ...input, toolName: read.name }, context()); void old.catch(() => {}); await entered.promise;
  await manager.authorize('github', binding.revision); await oauth.stage(); oauth.finish();
  const fresh = await waitFor(async () => { const snapshot = await manager.snapshot('github'); return snapshot.authorization ? undefined : snapshot; });
  assert.equal(fresh.connection.revision, binding.revision); assert.equal(fresh.authorizationResult?.status, 'succeeded');
  release.resolve(); await assert.rejects(old);
  assert.equal((await manager.snapshot('github')).connection.status, 'verified');
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'new-synthetic-account-token');
});

test('target credential CAS prevents a late 401 from another Host from expiring a changed token', async t => {
  const { manager, port, setReply, binding } = await fixture(t), entered = deferred<void>(), release = deferred<void>();
  setReply(async () => { entered.resolve(); await release.promise; throw new ServiceRemoteError('service_oauth_expired', false, 401); });
  const old = port.call({ ...input, toolName: read.name }, context()); void old.catch(() => {}); await entered.promise;
  await manager.store.updateCredentials('github', { accessToken: 'other-host-new-token' }, binding.revision);
  release.resolve(); await assert.rejects(old);
  assert.equal((await manager.snapshot('github')).connection.status, 'verified');
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'other-host-new-token');
});

test('late OAuth credential completion cannot overwrite a concurrent explicit configuration change', async t => {
  const oauth = oauthFixture(), { manager, binding } = await fixture(t, { oauthFactory: oauth.factory }), release = deferred<void>();
  await manager.authorize('github', binding.revision);
  const late = oauth.delayedStage(release.promise); void late.catch(() => {});
  const saved = await manager.save('github', { expectedRevision: binding.revision, config: { scopes: ['read'], repositories: ['owner/new'] }, credentials: { accessToken: 'explicit-new-pat' } });
  release.resolve(); await assert.rejects(late);
  assert.deepEqual(saved.connection.repositories, ['owner/new']); assert.equal(saved.connection.status, 'unverified');
  assert.equal((await manager.store.getCredentials('github')).accessToken, 'explicit-new-pat');
  assert.equal((await manager.snapshot('github')).authorization, undefined);
});

test('shutdown aborts every settings probe and attempts every cleanup even after one fails', async t => {
  const { manager, backend, binding } = await fixture(t), probes: AbortSignal[] = [], cleanupAttempts: string[] = []; let fail = true;
  backend.verify = async (connection, _credentials, context) => {
    probes.push(context!.signal!); let task: Promise<void> | undefined;
    const cleanup = (options: { retryFailed?: boolean }) => {
      if (!task || options.retryFailed) task = Promise.resolve().then(() => { cleanupAttempts.push(`${connection.service}:${options.retryFailed === true}`); if (connection.service === 'github' && fail || options.retryFailed !== true) throw new Error('synthetic cleanup failure'); });
      return task;
    };
    context!.registerCleanup!(cleanup); await cleanup({ retryFailed: false }); throw new Error('unreachable');
  };
  await assert.rejects(manager.verify('github', binding.revision));
  const gmail = await manager.save('gmail', { expectedRevision: 0, config: { scopes: ['read'], clientId: 'synthetic-desktop' } });
  await assert.rejects(manager.verify('gmail', gmail.connection.revision));
  await assert.rejects(manager.close());
  assert.ok(probes.every(signal => signal.aborted));
  assert.ok(cleanupAttempts.includes('github:true')); assert.ok(cleanupAttempts.includes('gmail:true'));
  fail = false; await manager.close();
});

test('known business success survives failed protocol retirement while its cleanup remains UNKNOWN', async t => {
  const { port, setReply, manager } = await fixture(t); let cleanup: ((options: { retryFailed?: boolean }) => Promise<void>) | undefined;
  setReply(async raw => {
    (raw.registerCleanup as (callback: (options: { retryFailed?: boolean }) => Promise<void>) => void)(async options => { if (!options.retryFailed) throw new Error('lost DELETE reply'); });
    return { isError: false, structuredContent: { sha: '0123456789abcdef0123456789abcdef01234567' }, content: [{ type: 'text', text: 'Known external success receipt.' }] };
  });
  const response = await port.call(input, context({ registerCleanup: callback => { cleanup = callback; } }));
  assert.equal((response.details.operation as { status: string }).status, 'succeeded');
  assert.ok(cleanup); await assert.rejects(cleanup({ retryFailed: false }));
  assert.equal((await manager.store.listOperations({ projectId: 'project', taskId: 'task' })).operations[0]!.resultId, '0123456789abcdef0123456789abcdef01234567');
  await cleanup({ retryFailed: true });
});

test('the final scrub includes both the original token and a token refreshed during the same call', async t => {
  const { manager, port, setReply } = await fixture(t);
  setReply(async () => {
    await manager.store.updateCredentials('github', { accessToken: 'rotated-synthetic-token-456' });
    return { original: 'synthetic-secret-123', refreshed: 'rotated-synthetic-token-456' };
  });
  const response = await port.call({ ...input, toolName: read.name }, context());
  assert.ok(!JSON.stringify(response).includes('synthetic-secret-123'));
  assert.ok(!JSON.stringify(response).includes('rotated-synthetic-token-456'));
});

test('Tencent confirmation and durable receipt identify the exact sender, recipient and subject without exposing its authorization code', async t => {
  const send: ServiceTool = { name: 'tencent_mail_send', semanticName: 'send_message', scope: 'send', action: 'send', write: true, requiresConfirmation: true,
    inputSchema: { type: 'object', properties: { to: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'subject', 'text'], additionalProperties: false } };
  const { manager } = await fixture(t, { mail: {
    verify: async () => ({ status: 'verified', accountId: 'qq-stable-account', accountLabel: 'sender@qq.com', scopes: ['send'], tools: [send] }),
    call: async (_name, _args, _config, secret) => ({ status: 'accepted', reflectedSecret: secret }),
  } });
  const saved = await manager.save('tencent', { expectedRevision: 0, config: { scopes: ['send'], mailboxType: 'qq', email: 'sender@qq.com' }, credentials: { authorizationCode: 'SYNTHETIC-TENCENT-AUTH-CODE' } });
  const verified = await manager.verify('tencent', saved.connection.revision);
  const binding = await manager.binding('tencent', { expectedConnectionRevision: verified.connection.revision });
  let shown = '';
  const response = await manager.port('project', 'task', { tencent: binding }).call({ service: 'tencent', toolName: send.name, args: { to: ['recipient@example.invalid'], subject: 'Exact subject', text: 'Exact content.' } }, context({ confirm: async (_title, message) => { shown = message; return true; } }));
  assert.match(shown, /发件人：sender@qq.com/); assert.match(shown, /recipient@example.invalid/); assert.match(shown, /Exact subject/); assert.match(shown, /Exact content/);
  const target = (response.details.operation as { target: Record<string, unknown> }).target;
  assert.equal(target.from, 'sender@qq.com'); assert.deepEqual(target.to, ['recipient@example.invalid']); assert.equal(target.subjectSha256, createHash('sha256').update('Exact subject').digest('hex'));
  assert.ok(!JSON.stringify(response).includes('SYNTHETIC-TENCENT-AUTH-CODE'));
});

test('Gmail reply freezes its actual inherited subject and explicit recipients before preview and executes the same send_message', async t => {
  const object = { type: 'object', additionalProperties: true, properties: {} };
  const send: ServiceTool = { name: 'send_message', semanticName: 'send_message', scope: 'send', action: 'send', write: true, requiresConfirmation: true, inputSchema: object };
  const reader: ServiceTool = { name: 'get_message', semanticName: 'get_message', scope: 'read', action: 'read', write: false, requiresConfirmation: false, inputSchema: object };
  const reply: ServiceTool = { ...send, name: 'reply', semanticName: 'reply' };
  const { manager, backend } = await fixture(t);
  const saved = await manager.save('gmail', { expectedRevision: 0, config: { scopes: ['read', 'send'], clientId: 'synthetic-desktop' }, credentials: { accessToken: 'gmail-synthetic-token' } });
  backend.verify = async connection => ({ accountId: 'gmail-sub', accountLabel: 'sender@example.invalid', scopes: connection.scopes, tools: [send, reply, reader], repositories: undefined });
  const verified = await manager.verify('gmail', saved.connection.revision), binding = await manager.binding('gmail', { expectedConnectionRevision: verified.connection.revision });
  const dispatched: Array<{ toolName: string; arguments: Record<string, unknown> }> = []; let sourceForms = 0;
  backend.invoke = async call => {
    dispatched.push({ toolName: call.toolName, arguments: call.arguments });
    if (call.toolName === 'get_message') {
      assert.deepEqual(call.arguments, { messageId: 'source-message', messageFormat: 'MINIMAL' });
      assert.ok(call.elicit);
      const answer = await call.elicit({ key: 'source-consent', toolName: 'get_message', arguments: call.arguments, message: 'Synthetic source permission request.', requestedSchema: { type: 'object', properties: { decision: { type: 'string', enum: ['ALLOW_ONCE', 'DENY_ONCE'] } }, required: ['decision'] } }, call.signal!);
      assert.deepEqual(answer, { action: 'accept', content: { decision: 'ALLOW_ONCE' } }); sourceForms++;
      return { structuredContent: { id: 'source-message', subject: 'Original inherited subject', sender: 'original@example.invalid', toRecipients: ['sender@example.invalid'], ccRecipients: [], bccRecipients: [] } };
    }
    return { isError: false, content: [{ type: 'text', text: 'Accepted exact synthetic mail.' }] };
  };
  let shown = '';
  const response = await manager.port('project', 'task', { gmail: binding }).call({ service: 'gmail', toolName: 'reply', args: { messageId: 'source-message', to: ['recipient@example.invalid'], cc: [], bcc: [], body: 'Exact reply body.', replyAll: false, includeSignature: false } }, context({ confirm: async (_title, message) => { shown = message; return true; } }));
  assert.deepEqual(dispatched.map(call => call.toolName), ['get_message', 'send_message']); assert.equal(sourceForms, 1);
  assert.match(shown, /sender@example.invalid/); assert.match(shown, /Re: Original inherited subject/); assert.match(shown, /Exact reply body/);
  assert.equal(dispatched[1]!.arguments.subject, 'Re: Original inherited subject');
  assert.equal(dispatched[1]!.arguments.replyToMessageId, 'source-message');
  assert.deepEqual(dispatched[1]!.arguments.to, ['recipient@example.invalid']); assert.equal(dispatched[1]!.arguments.includeSignature, false);
  const operation = response.details.operation as { toolName: string; target: { from: string; subjectSha256: string; originalToolName: string } };
  assert.equal(operation.toolName, 'send_message'); assert.equal(operation.target.originalToolName, 'reply'); assert.equal(operation.target.subjectSha256, createHash('sha256').update('Re: Original inherited subject').digest('hex')); assert.equal(operation.target.from, 'sender@example.invalid');
});

test('declining or cancelling a Gmail source form cannot prepare, approve or submit its later mail action', async t => {
  for (const cancelled of [false, true]) {
    const object = { type: 'object', additionalProperties: true, properties: {} };
    const send: ServiceTool = { name: 'send_message', semanticName: 'send_message', scope: 'send', action: 'send', write: true, requiresConfirmation: true, inputSchema: object };
    const reader: ServiceTool = { name: 'get_message', semanticName: 'get_message', scope: 'read', action: 'read', write: false, requiresConfirmation: false, inputSchema: object };
    const { manager, backend } = await fixture(t);
    const saved = await manager.save('gmail', { expectedRevision: 0, config: { scopes: ['read', 'send'], clientId: 'synthetic-desktop' }, credentials: { accessToken: 'gmail-synthetic-token' } });
    backend.verify = async connection => ({ accountId: 'gmail-sub', accountLabel: 'sender@example.invalid', scopes: connection.scopes, tools: [send, { ...send, name: 'reply', semanticName: 'reply' }, reader], repositories: undefined });
    const verified = await manager.verify('gmail', saved.connection.revision), binding = await manager.binding('gmail', { expectedConnectionRevision: verified.connection.revision });
    let sends = 0, confirmations = 0; const controller = new AbortController();
    backend.invoke = async call => {
      if (call.toolName !== 'get_message') { sends++; return {}; }
      const response = await call.elicit!({ key: 'source-consent', toolName: 'get_message', arguments: call.arguments, message: 'Source account permission.', requestedSchema: { type: 'object', properties: { decision: { type: 'string', enum: ['ALLOW_ONCE', 'DENY_ONCE'] } }, required: ['decision'] } }, call.signal!);
      assert.deepEqual(response, { action: 'accept', content: { decision: 'DENY_ONCE' } });
      return { isError: true, content: [{ type: 'text', text: 'Source read declined.' }] };
    };
    await assert.rejects(manager.port('project', 'task', { gmail: binding }).call({ service: 'gmail', toolName: 'reply', args: { messageId: 'source-message', to: ['recipient@example.invalid'], cc: [], bcc: [], body: 'Exact body.', replyAll: false } }, context({ signal: controller.signal, select: async (_title, choices) => { if (cancelled) { controller.abort(); controller.signal.throwIfAborted(); } return choices[1]!; }, confirm: async () => { confirmations++; return true; } })));
    assert.equal(sends, 0); assert.equal(confirmations, 0);
    assert.equal((await manager.store.listOperations({ projectId: 'project', taskId: 'task' })).total, 0);
  }
});

test('a valid Gmail source with failed protocol cleanup cannot advance to mail confirmation or sending', async t => {
  const object = { type: 'object', additionalProperties: true, properties: {} };
  const send: ServiceTool = { name: 'send_message', semanticName: 'send_message', scope: 'send', action: 'send', write: true, requiresConfirmation: true, inputSchema: object };
  const reader: ServiceTool = { name: 'get_message', semanticName: 'get_message', scope: 'read', action: 'read', write: false, requiresConfirmation: false, inputSchema: object };
  const { manager, backend } = await fixture(t);
  const saved = await manager.save('gmail', { expectedRevision: 0, config: { scopes: ['read', 'send'], clientId: 'synthetic-desktop' }, credentials: { accessToken: 'gmail-synthetic-token' } });
  backend.verify = async connection => ({ accountId: 'gmail-sub', accountLabel: 'sender@example.invalid', scopes: connection.scopes, tools: [send, { ...send, name: 'reply', semanticName: 'reply' }, reader], repositories: undefined });
  const verified = await manager.verify('gmail', saved.connection.revision), binding = await manager.binding('gmail', { expectedConnectionRevision: verified.connection.revision });
  let sends = 0, confirmations = 0, automaticCloses = 0, explicitCloses = 0, cleanup: ((options: { retryFailed?: boolean }) => Promise<void>) | undefined;
  backend.invoke = async call => {
    if (call.toolName !== 'get_message') { sends++; return {}; }
    call.registerCleanup!(async options => { if (options.retryFailed) { explicitCloses++; return; } automaticCloses++; throw new Error('synthetic source DELETE reply lost'); });
    return { structuredContent: { id: 'source-message', subject: 'Original subject', sender: 'source@example.invalid', toRecipients: [], ccRecipients: [], bccRecipients: [] } };
  };
  await assert.rejects(manager.port('project', 'task', { gmail: binding }).call({ service: 'gmail', toolName: 'reply', args: { messageId: 'source-message', to: ['recipient@example.invalid'], cc: [], bcc: [], body: 'Exact body.', replyAll: false } }, context({ registerCleanup: callback => { cleanup = callback; }, confirm: async () => { confirmations++; return true; } })), /服务连接请求未能完成/);
  assert.equal(sends, 0); assert.equal(confirmations, 0); assert.equal(automaticCloses, 1);
  assert.equal((await manager.store.listOperations({ projectId: 'project', taskId: 'task' })).total, 0);
  assert.ok(cleanup); await assert.rejects(cleanup({ retryFailed: false })); assert.equal(automaticCloses, 1);
  await cleanup({ retryFailed: true }); assert.equal(explicitCloses, 1);
});

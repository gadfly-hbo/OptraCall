import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ServiceRemoteError } from '../src/host/service-connection-mcp.ts';
import { ServiceConnectionManager } from '../src/host/service-connection-manager.ts';
import type { ServiceConnectionCallContext } from '../src/agent/service-connection-tools.ts';
import type { ServiceTool } from '../src/host/service-connection-types.ts';
import type { HostDispatchRequest } from '../src/host/service-connection-manager.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const issueWriteSchema = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, required: ['owner', 'repo', 'title', 'body'], additionalProperties: false };
const commentSchema = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, issueNumber: { type: 'number' }, body: { type: 'string' } }, required: ['owner', 'repo', 'issueNumber', 'body'], additionalProperties: false };
const readSchema = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'], additionalProperties: false };
const issueWrite: ServiceTool = { name: 'issue_write', semanticName: 'issue_write', scope: 'collaborate', action: 'collaborate', write: true, requiresConfirmation: false, inputSchema: issueWriteSchema };
const addIssueComment: ServiceTool = { ...issueWrite, name: 'add_issue_comment', inputSchema: commentSchema };
const issueRead: ServiceTool = { ...issueWrite, name: 'issue_read', scope: 'read', action: 'read', write: false, requiresConfirmation: false, inputSchema: readSchema };

async function fixture(t: { after(fn: () => Promise<void>): void }, options: Partial<ConstructorParameters<typeof ServiceConnectionManager>[0]> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-host-dispatch-'));
  const calls: Array<Record<string, unknown>> = [];
  let reply: (input: Record<string, unknown>) => Promise<unknown> = async () => ({ structuredContent: { number: 101, html_url: 'https://github.com/owner/one/issues/101' }, content: [{ type: 'text', text: 'created issue #101' }] });
  const backend = {
    verify: async (connection: import('../src/host/service-connection-types.ts').ServiceConnection) => ({ accountId: '42', accountLabel: 'fixture-account', scopes: connection.scopes, tools: [issueWrite, addIssueComment, issueRead].filter(tool => connection.scopes.includes(tool.scope)), repositories: connection.repositories }),
    invoke: async (input: import('../src/host/service-connection-mcp.ts').RemoteServiceInvoke) => { calls.push(input as unknown as Record<string, unknown>); return reply(input as unknown as Record<string, unknown>); },
    close: async () => {},
  };
  const manager = new ServiceConnectionManager({ dataRoot: root, invalidate: async () => {}, assertOwner: async () => {}, backend, ...options });
  await manager.init();
  t.after(async () => { await manager.close(); await fs.rm(root, { recursive: true, force: true }); });
  const saved = await manager.save('github', { expectedRevision: 0, config: { scopes: ['read', 'collaborate'], repositories: ['owner/one', 'owner/two'] }, credentials: { accessToken: 'synthetic-secret-123' } });
  const verified = await manager.verify('github', saved.connection.revision);
  const binding = await manager.binding('github', { expectedConnectionRevision: verified.connection.revision, scopes: ['read', 'collaborate'], repositories: ['owner/one'] });
  const port = manager.port('project', 'task', { github: binding });
  return { manager, binding, port, calls, setReply(fn: typeof reply) { reply = fn; } };
}

function hostRequest(overrides: Partial<HostDispatchRequest> = {}): HostDispatchRequest {
  return {
    projectId: 'project-1', taskId: 'task-1', workId: 'work-1', revision: 1,
    action: 'issue-create', repositoryId: 'owner/one',
    title: '外派：合成工作', body: 'exact outbound body', bodyHash: sha256('exact outbound body'),
    hostContext: {},
    ...overrides,
  };
}

function foregroundContext(overrides: Partial<ServiceConnectionCallContext> = {}): ServiceConnectionCallContext {
  return { projectId: 'project', taskId: 'task', requestId: 'request', sessionId: 'session', toolCallId: 'call', signal: new AbortController().signal, assertCurrent() {}, registerCleanup() {}, confirm: async () => true, input: async () => '', select: async (_title, options) => options[0]!, ...overrides };
}

test('host-only dispatch journals a stable work-derived operation without any foreground session identity', async t => {
  const { manager, binding, calls } = await fixture(t);
  const result = await manager.dispatchHostOperation(binding, hostRequest());
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.repositoryId, 'owner/one');
  assert.equal(result.issueNumber, 101);
  assert.ok(result.resultId?.startsWith('https://github.com/'));

  const expectedOperationId = sha256(JSON.stringify(['optracall-host-publish-v1', 'work-1', 1, 'issue-create']));
  assert.equal(result.operationId, expectedOperationId);
  const journal = await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' });
  assert.equal(journal.total, 1);
  const attempt = journal.operations[0]!;
  assert.equal(attempt.operationId, expectedOperationId);
  assert.equal(attempt.status, 'succeeded');
  assert.match(attempt.requestId, /^host:/);
  assert.match(attempt.toolCallId, /^host:/);
  assert.equal(attempt.requestId, `host:work-1:1:issue-create`);
  assert.notEqual(attempt.requestId, 'request');
  assert.notEqual(attempt.toolCallId, 'call');
  assert.deepEqual(calls[0]!.arguments, { owner: 'owner', repo: 'one', title: '外派：合成工作', body: 'exact outbound body' });
  assert.equal(calls[0]!.toolName, 'issue_write');
  assert.deepEqual((calls[0]!.connection as { repositories: string[] }).repositories, ['owner/one']);
});

test('a repeated host dispatch for the same work revision returns the original operation without a second call', async t => {
  const { manager, binding, calls } = await fixture(t);
  const first = await manager.dispatchHostOperation(binding, hostRequest());
  const second = await manager.dispatchHostOperation(binding, hostRequest({ hostContext: { assertCurrent() {} } }));
  assert.equal(second.outcome, 'succeeded');
  assert.equal(second.operationId, first.operationId);
  assert.equal(calls.length, 1);
  assert.equal((await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' })).total, 1);
});

test('host dispatch refuses other services, unsupported actions, outside repositories and forged hashes before journaling', async t => {
  const { manager, binding, calls } = await fixture(t);
  const outside = await manager.dispatchHostOperation(binding, hostRequest({ repositoryId: 'owner/two' }));
  assert.equal(outside.outcome, 'rejected');
  assert.equal(outside.code, 'service_repository_outside_scope');
  const otherService = await manager.dispatchHostOperation({ ...binding, service: 'gmail' } as typeof binding, hostRequest());
  assert.equal(otherService.outcome, 'rejected');
  const trigger = await manager.dispatchHostOperation(binding, hostRequest({ action: 'external-trigger' as 'issue-create' }));
  assert.equal(trigger.outcome, 'rejected');
  const forged = await manager.dispatchHostOperation(binding, hostRequest({ bodyHash: '0'.repeat(64) }));
  assert.equal(forged.outcome, 'rejected');
  const noTitle = await manager.dispatchHostOperation(binding, hostRequest({ title: undefined }));
  assert.equal(noTitle.outcome, 'rejected');
  assert.equal(calls.length, 0);
  assert.equal((await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' })).total, 0);
});

test('a lost response stays UNKNOWN in the service journal and is never blindly re-invoked', async t => {
  const { manager, binding, calls, setReply } = await fixture(t);
  setReply(async () => { throw new Error('lost response synthetic-secret-123'); });
  const first = await manager.dispatchHostOperation(binding, hostRequest());
  assert.equal(first.outcome, 'unknown');
  assert.ok(!JSON.stringify(first).includes('synthetic-secret-123'));
  const second = await manager.dispatchHostOperation(binding, hostRequest());
  assert.equal(second.outcome, 'unknown');
  assert.equal(second.operationId, first.operationId);
  assert.equal(calls.length, 1);
  const journal = await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' });
  assert.equal(journal.operations[0]!.status, 'unknown');
});

test('a known pre-effect rejection after the submit mark settles as rejected and is never re-invoked', async t => {
  const { manager, binding, calls, setReply } = await fixture(t);
  setReply(async () => { throw new ServiceRemoteError('service_repository_outside_scope', false, 403); });
  const refused = await manager.dispatchHostOperation(binding, hostRequest());
  assert.equal(refused.outcome, 'rejected');
  assert.equal(refused.code, 'service_repository_outside_scope');
  assert.equal(calls.length, 1, 'the invoke was attempted and refused before any remote effect');
  const retried = await manager.dispatchHostOperation(binding, hostRequest());
  assert.equal(retried.outcome, 'rejected');
  assert.equal(calls.length, 1);
  const journal = await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' });
  assert.equal(journal.total, 1);
  assert.equal(journal.operations[0]!.status, 'rejected');
});

test('a disconnected or changed account refuses host dispatch', async t => {
  const { manager, binding, calls } = await fixture(t);
  await manager.disconnect('github', binding.revision);
  const refused = await manager.dispatchHostOperation(binding, hostRequest());
  assert.equal(refused.outcome, 'rejected');
  assert.equal(refused.code, 'service_binding_changed');
  assert.equal(calls.length, 0);
  assert.equal((await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' })).total, 0);
});

test('outbound bodies carrying credential material are refused before journaling or dispatch', async t => {
  const { manager, binding, calls } = await fixture(t);
  const leaked = await manager.dispatchHostOperation(binding, hostRequest({
    body: `工单正文夹带 token synthetic-secret-123`,
    bodyHash: sha256('工单正文夹带 token synthetic-secret-123'),
  }));
  assert.equal(leaked.outcome, 'rejected');
  assert.equal(leaked.code, 'service_outbound_secret_rejected');
  assert.equal(calls.length, 0);
  assert.equal((await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' })).total, 0);
});

test('the host context gate fails closed: a stale assertCurrent or aborted signal refuses the dispatch', async t => {
  const { manager, binding, calls } = await fixture(t);
  const stale = await manager.dispatchHostOperation(binding, hostRequest({ hostContext: { assertCurrent() { throw new Error('stale host context'); } } }));
  assert.equal(stale.outcome, 'rejected');
  assert.equal(stale.code, 'service_dispatch_context_invalid');
  const aborted = await manager.dispatchHostOperation(binding, hostRequest({ hostContext: { signal: AbortSignal.abort() } }));
  assert.equal(aborted.outcome, 'rejected');
  assert.equal(aborted.code, 'service_dispatch_context_invalid');
  assert.equal(calls.length, 0);
  assert.equal((await manager.store.listOperations({ projectId: 'project-1', taskId: 'task-1' })).total, 0);
});

test('the host context receives the dispatch cleanup, and concurrent dispatches of one identity invoke exactly once', async t => {
  const { manager, binding, calls } = await fixture(t);
  const registered: Array<(options: { retryFailed?: boolean }) => Promise<void>> = [];
  const registerCleanup = (cleanup: (options: { retryFailed?: boolean }) => Promise<void>) => registered.push(cleanup);
  const first = manager.dispatchHostOperation(binding, hostRequest({ hostContext: { registerCleanup } }));
  const second = manager.dispatchHostOperation(binding, hostRequest({ hostContext: { registerCleanup } }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.operationId, b.operationId);
  assert.equal(calls.length, 1, 'exactly one remote invoke happens for one publication identity');
  const outcomes = [a.outcome, b.outcome].sort().join('+');
  assert.ok(outcomes === 'succeeded+succeeded' || outcomes === 'succeeded+unknown', `a concurrent repeat neither double-invokes nor fails: ${outcomes}`);
  assert.equal(registered.length, 1, 'only the dispatch that actually invokes registers its cleanup');
  assert.equal(typeof registered[0], 'function');
});

test('foreground port behavior is unchanged: reads work and the write operation identity still derives from requestId/toolCallId', async t => {
  const { manager, port } = await fixture(t);
  const read = await port.call({ service: 'github', toolName: 'issue_read', args: { owner: 'owner', repo: 'one' } }, foregroundContext());
  assert.equal(read.details.serviceConnection, true);
  const write = await port.call({ service: 'github', toolName: 'issue_write', args: { owner: 'owner', repo: 'one', title: '前台标题', body: '前台正文' } }, foregroundContext({ confirm: async () => true }));
  const foregroundOperation = write.details.operation as { operationId: string; status: string };
  assert.equal(foregroundOperation.status, 'succeeded');
  assert.equal(foregroundOperation.operationId, sha256(JSON.stringify(['project', 'task', 'request', 'call'])));
  const hostScheme = sha256(JSON.stringify(['optracall-host-publish-v1', 'work-1', 1, 'issue-create']));
  assert.notEqual(foregroundOperation.operationId, hostScheme, 'foreground and host-only operation identities never collide');
});

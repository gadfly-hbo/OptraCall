import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';

async function fixture(t: import('node:test').TestContext) {
  const base = path.resolve('.local/overall-architecture-upgrade/development/method-issue'); await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'synthetic-'));
  const store = createSapMethodStore(root), saved = store.save({ requestId: randomUUID(), origin: 'other', title: '合成窗口方法', content: { conditions: '', logic: '先核窗口', judgment: '', limits: '' }, sources: [] });
  store.publish(saved.method.id, { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 });
  const origin = { actorKind: 'agent' as const, projectId: randomUUID(), taskId: randomUUID(), requestId: randomUUID(), sessionId: 'current-native', toolCallId: 'current-call' };
  const source = { type: 'report' as const, label: '本轮已发现问题', ref: '060_reports/synthetic.md', version: 'fixed-report-version', sha256: 'a'.repeat(64) };
  const input = { methodId: saved.method.id, version: 1, expectedRevision: 0, note: '本轮固定报告显示该方法缺少适用条件。', sources: [source] };
  const context = { ...origin, operationId: randomUUID(), signal: new AbortController().signal, assertCurrent() {} };
  return { root, store, saved, origin, source, input, context };
}

test('M5 original method authority retains optional Agent issue evidence without revising or publishing methods', async t => {
  const f = await fixture(t);
  const issue = f.store.markIssue(f.saved.method.id, { requestId: f.context.operationId, version: 1, expectedRevision: 0, status: 'suspected', note: f.input.note }, { origin: f.origin, sources: [f.source] } as any);
  assert.deepEqual((issue.governance[0] as any).origin, f.origin); assert.deepEqual((issue.governance[0] as any).sources, [f.source]);
  const reopened = createSapMethodStore(f.root).read(f.saved.method.id, 1);
  assert.deepEqual(reopened.governance, issue.governance); assert.equal(reopened.versions.length, 1); assert.equal(reopened.publications.length, 1);
  assert.deepEqual(reopened.versions[0], f.saved.version);
});

test('M5 Agent issue port only records suspected on a published, readable exact method with current Task evidence', async t => {
  const { createMethodIssueAdapter } = await import('../src/host/method-issue-adapter.ts');
  const f = await fixture(t); let sourceChecks = 0, readChecks = 0;
  const port = createMethodIssueAdapter({ methods: f.store, admit: async () => {}, sourceAllowed: async () => { readChecks++; return true; }, qualifySources: async sources => { sourceChecks++; assert.deepEqual(sources, [f.source]); }, mutate: async operation => operation() });
  const first = await port(f.input, f.context), replay = await port(f.input, { ...f.context, toolCallId: 'later-call' });
  assert.equal(first.details.status, 'saved'); assert.equal(first.details.issueStatus, 'suspected'); assert.equal(replay.details.operationId, first.details.operationId);
  const actual = f.store.read(f.saved.method.id); assert.equal(actual.governance.length, 1); assert.equal(actual.governance[0].status, 'suspected'); assert.equal(actual.governance[0].origin!.toolCallId, f.origin.toolCallId);
  assert.equal(actual.versions.length, 1); assert.equal(actual.publications.length, 1); assert.ok(readChecks >= 2); assert.equal(sourceChecks, 2);
  await assert.rejects(port({ ...f.input, status: 'confirmed' }, f.context), /invalid_method_issue/);
  await assert.rejects(port({ ...f.input, replacement: { methodId: randomUUID(), version: 1 } }, f.context), /invalid_method_issue/);
});

test('M5 revoked method read scope after source qualification blocks the authority write', async t => {
  const { createMethodIssueAdapter } = await import('../src/host/method-issue-adapter.ts'); const f = await fixture(t); let checks = 0;
  const port = createMethodIssueAdapter({ methods: f.store, admit: async () => {}, sourceAllowed: async () => ++checks === 1, qualifySources: async () => {}, mutate: async operation => operation() });
  await assert.rejects(port(f.input, f.context), /method_issue_source_forbidden/);
  assert.equal(f.store.read(f.saved.method.id).governance.length, 0);
});

test('M5 lost issue acknowledgment stays UNKNOWN and original operation recovery does not create a duplicate', async t => {
  const { createMethodIssueAdapter } = await import('../src/host/method-issue-adapter.ts'); const f = await fixture(t); let fail = true;
  const original = f.store.markIssue;
  t.mock.method(f.store, 'markIssue', (...args: Parameters<typeof original>) => { const result = original(...args); if (fail) { fail = false; throw new Error('synthetic_ack_lost'); } return result; });
  const port = createMethodIssueAdapter({ methods: f.store, admit: async () => {}, sourceAllowed: async () => true, qualifySources: async () => {}, mutate: async operation => operation() });
  assert.equal((await port(f.input, f.context)).details.status, 'unknown');
  assert.equal((await port(f.input, { ...f.context, toolCallId: 'recovery-call' })).details.status, 'saved');
  assert.equal(f.store.read(f.saved.method.id).governance.length, 1);
});

test('M5 unreadable, unpublished, unqualified source and cancelled issue calls cannot write governance', async t => {
  const { createMethodIssueAdapter } = await import('../src/host/method-issue-adapter.ts');
  const f = await fixture(t), base = { methods: f.store, admit: async () => {}, sourceAllowed: async () => true, qualifySources: async () => {}, mutate: async <T>(operation: () => T | Promise<T>) => operation() };
  const read = f.store.getPublished; let reads = 0;
  const readProbe = t.mock.method(f.store, 'getPublished', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
  await assert.rejects(createMethodIssueAdapter({ ...base, sourceAllowed: async () => false })(f.input, f.context), /method_issue_source_forbidden/);
  assert.equal(reads, 0, 'denied enterprise scope cannot read the method body'); readProbe.mock.restore();
  await assert.rejects(createMethodIssueAdapter({ ...base, qualifySources: async () => { throw new Error('native_source_not_qualified'); } })(f.input, f.context), /native_source_not_qualified/);
  const unpublished = f.store.save({ requestId: randomUUID(), origin: 'other', title: '未发布候选', content: { logic: '未获准参考', conditions: '', judgment: '', limits: '' }, sources: [] });
  await assert.rejects(createMethodIssueAdapter(base)({ ...f.input, methodId: unpublished.method.id }, f.context), /METHOD_NOT_PUBLISHED/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createMethodIssueAdapter(base)(f.input, { ...f.context, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.store.read(f.saved.method.id).governance.length, 0);
});

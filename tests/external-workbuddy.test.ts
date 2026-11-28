import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExternalDispatch } from '../src/host/external-dispatch.ts';
import type { ExternalGrantInput } from '../src/host/external-dispatch.ts';
import { ExternalPublisher } from '../src/host/external-publish.ts';
import { ExternalWorkStore, WORKBUDDY_TRIGGER_QUOTA } from '../src/host/external-work-store.ts';
import { ExternalWorkError, externalAssetRefText } from '../src/host/external-work-types.ts';
import { WorkBuddyAdapter, workBuddyConfigId } from '../src/host/workbuddy-adapter.ts';
import type { WorkBuddyJointTestHarness, WorkBuddyTransport } from '../src/host/workbuddy-adapter.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const T0 = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
let clock = T0;
const now = () => clock;
const CONNECTION = 'wb-conn-1';
const MCP_ENDPOINT = 'https://optracall.example/mcp';

const expectCode = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof ExternalWorkError, `expected ExternalWorkError, got ${String(error)}`);
  assert.equal((error as ExternalWorkError).code, expected);
  return true;
};
const assetRef = (id: string) => ({ authority: 'optracall/studio', id, version: 'published-v1', hash: sha256(`asset:${id}`) });

function grantInput(overrides: Partial<ExternalGrantInput> = {}): ExternalGrantInput {
  return {
    goal: '合成外派目标',
    scope: '仅限合成数据范围',
    forbidden: '禁止读取真实业务数据',
    allowedExecutors: ['principal-a', 'principal-b'],
    repository: { stableId: 'openai/synthetic', visibility: 'private' },
    assetRefs: [assetRef('metric-1')],
    enterprise: '合成企业甲',
    validUntil: iso(clock + 48 * HOUR),
    summary: '合成外派工单标题',
    deliveryCriteria: '合成交付标准',
    targetExecutor: 'principal-a',
    ...overrides,
  };
}

type PostReply = { outcome: 'succeeded' | 'rejected' | 'unknown'; messageId?: string };

/** Synthetic official-API transport: GET localassistant / POST message / GET message?message_id. */
function wbTransport() {
  const statusCalls: Array<{ online?: boolean; outcome: string }> = [];
  const posts: Array<{ content: string; msgType: string }> = [];
  const reads: Array<{ afterMessageId?: string }> = [];
  const messages = new Map<string, string>();
  let order: string[] = [];
  let online: { outcome: 'succeeded' | 'rejected' | 'unknown'; online?: boolean } = { outcome: 'succeeded', online: true };
  let postBehavior: () => PostReply | never = () => ({ outcome: 'succeeded', messageId: `m-${posts.length}` });
  let readBehavior: (() => { outcome: 'succeeded' | 'rejected' | 'unknown'; messages?: Array<{ messageId: string; text: string }> }) | undefined = undefined;
  const defaultRead = () => {
    const cursor = reads[reads.length - 1]?.afterMessageId;
    const start = cursor === undefined ? 0 : order.indexOf(cursor) + 1;
    return { outcome: 'succeeded' as const, messages: order.slice(start).map(id => ({ messageId: id, text: messages.get(id)! })) };
  };
  const transport: WorkBuddyTransport = {
    getLocalAssistant: async () => { statusCalls.push({ ...online }); return online; },
    postMessage: async input => { posts.push({ ...input }); return postBehavior(); },
    getMessages: async input => { reads.push({ afterMessageId: input.afterMessageId }); return (readBehavior ?? defaultRead)(); },
  };
  return {
    transport, posts, reads, statusCalls, messages,
    setOnline(value: typeof online) { online = value; },
    setPostBehavior(fn: typeof postBehavior) { postBehavior = fn; },
    setReadBehavior(fn: typeof readBehavior) { readBehavior = fn; },    addMessage(id: string, text: string) { messages.set(id, text); order.push(id); },
  };
}
type TransportBundle = ReturnType<typeof wbTransport>;

function makeAdapter(store: ExternalWorkStore, bundle: TransportBundle, options: { credentialValues?: () => string[] } = {}) {
  return new WorkBuddyAdapter({ store, transport: bundle.transport, connection: CONNECTION, mcpEndpoint: MCP_ENDPOINT, ...(options.credentialValues ? { credentialValues: options.credentialValues } : {}) });
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  clock = T0;
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-workbuddy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot: root, now });
  await store.init();
  const profiles = () => ({ externalDispatchAllowed: true as const });
  const qualifyAssets = async (_projectId: string, refs: { authority: string; id: string; version: string; hash: string }[]) => new Set(refs.map(externalAssetRefText));
  const dispatch = new ExternalDispatch({ store, profiles, qualifyAssets, now });
  return { root, store, profiles, qualifyAssets, dispatch };
}

/** S2 pure-GitHub anchor: one synthetic succeeded issue-create for the work. */
async function publishWork(store: ExternalWorkStore, work: { workId: string }, revision = 1) {
  const github = { dispatch: async (request: { repositoryId: string }) => ({ outcome: 'succeeded' as const, repositoryId: request.repositoryId, issueNumber: 701 }) };
  const publisher = new ExternalPublisher({ store, transport: github });
  const result = await publisher.publish({ workId: work.workId, revision, action: 'issue-create', body: '合成工单正文' });
  assert.equal(result.attempt.status, 'succeeded');
  return result;
}

async function promoteRevision(store: ExternalWorkStore, workId: string, revision: number) {
  await store.mutate(state => { const work = state.works.find(item => item.workId === workId); if (work) { work.revision = revision; work.updatedAt = iso(clock); } });
}

/** Full-pass synthetic joint-test harness (isolated vendor simulation; no real account/network). */
function jointHarness(overrides: Partial<WorkBuddyJointTestHarness> = {}) {
  return {
    trigger: async () => ({ outcome: 'succeeded' as const, messageId: 'jt-1' }),
    claim: async () => ({ ok: true, claimId: 'claim-jt' }),
    readAsset: async () => ({ ok: true }),
    deliver: async () => ({ ok: true, deliveryId: 'del-jt' }),
    review: async () => ({ ok: true }),
    ...overrides,
  };
}

test('AB03/E05: 适配默认 integration_unverified 禁用；API/在线与 Connector 单项通过不足以启用', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);

  // Default state, even before any explicit configuration record, is unverified and disabled.
  let view = await adapter.settingsView();
  assert.equal(view.optional, true);
  assert.equal(view.defaultState, 'integration_unverified');
  assert.equal(view.ready, false);
  assert.deepEqual(view.verification, { apiOnline: 'unverified', connector: 'unverified', joint: 'unverified' });
  assert.equal(view.quota.limit, WORKBUDDY_TRIGGER_QUOTA);
  assert.equal(view.connection, CONNECTION);

  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  await assert.rejects(adapter.trigger({ workId: work.workId, revision: 1 }), expectCode('external_workbuddy_not_ready'));
  assert.equal(bundle.posts.length, 0);

  const config = await adapter.ensureConfig();
  assert.equal(config.ready, false);
  assert.equal(config.connection, CONNECTION);
  assert.equal(config.configId, workBuddyConfigId(CONNECTION));

  // API/online single fact alone never enables.
  await adapter.recordSingleTest('api-online', 'passed');
  view = await adapter.settingsView();
  assert.equal(view.verification.apiOnline, 'passed');
  assert.equal(view.ready, false);
  await assert.rejects(adapter.trigger({ workId: work.workId, revision: 1 }), expectCode('external_workbuddy_not_ready'));

  // Connector single fact alone never enables.
  await adapter.recordSingleTest('connector', 'passed');
  view = await adapter.settingsView();
  assert.equal(view.verification.connector, 'passed');
  assert.equal(view.ready, false);
  await assert.rejects(adapter.trigger({ workId: work.workId, revision: 1 }), expectCode('external_workbuddy_not_ready'));

  // Both singles together are still insufficient — only the joint closed loop decides.
  assert.equal((await adapter.settingsView()).ready, false);
  await assert.rejects(adapter.trigger({ workId: work.workId, revision: 1 }), expectCode('external_workbuddy_not_ready'));
  assert.equal(bundle.posts.length, 0);
});

test('AB03/E05: 只有联合测试通过（隔离合成闭环）才就绪可选；闭环失败保持禁用', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);

  // A failed joint closed loop (deliver stage does not confirm) stays disabled and records the failure fact.
  const failed = await adapter.runJointTest(jointHarness({ deliver: async () => ({ ok: false }) }));
  assert.equal(failed.passed, false);
  let view = await adapter.settingsView();
  assert.equal(view.verification.joint, 'failed');
  assert.equal(view.ready, false);
  await assert.rejects(adapter.trigger({ workId: work.workId, revision: 1 }), expectCode('external_workbuddy_not_ready'));

  // Full isolated synthetic closed loop (trigger → claim → asset read → deliver → review) enables this specific config.
  const passed = await adapter.runJointTest(jointHarness());
  assert.equal(passed.passed, true);
  assert.deepEqual(Object.keys(passed.stages).sort(), ['claim', 'deliver', 'readAsset', 'review', 'trigger']);
  view = await adapter.settingsView();
  assert.equal(view.verification.joint, 'passed');
  assert.equal(view.ready, true);

  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: 'm-1' }));
  const result = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(result.attempt.status, 'succeeded');
  assert.equal(result.attempt.messageId, 'm-1');
  assert.equal(bundle.posts.length, 1);
});

test('AB15/S5 store: 就绪不变量损坏拒绝；不含新键的旧台账照常解析', async t => {
  const { root, store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();

  // ready=true with an unverified joint test is corrupt — readiness is only derivable from the joint fact.
  const tampered = JSON.parse(await readFile(store.file, 'utf8')) as { workbuddyConfigs: Array<{ ready: boolean }> };
  tampered.workbuddyConfigs[0]!.ready = true;
  await writeFile(store.file, JSON.stringify(tampered));
  await assert.rejects(new ExternalWorkStore({ dataRoot: root, now }).init(), expectCode('external_store_corrupt'));

  // A ledger written before the optional keys existed keeps parsing (schema:1 optional keys).
  const legacy = {
    schema: 1, version: 0,
    grants: [], works: [], claims: [], publications: [], deliveries: [], reviews: [],
    inboxEvents: [], resumeReceipts: [], internalChoices: [], resumePauses: [], stopRequests: [],
  };
  await writeFile(store.file, `${JSON.stringify(legacy)}\n`);
  const reopened = new ExternalWorkStore({ dataRoot: root, now });
  await reopened.init();
  assert.equal(await reopened.version(), 0);
  await dispatch.authorize('project-1', 'task-1', grantInput());
});

test('AB02/S5: 纯 GitHub 授权与内部选择零 WB 调用、零额度占用（即使适配已就绪）', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  // Make the adapter fully ready: a ready adapter still must see zero calls from the pure GitHub path.
  await adapter.runJointTest(jointHarness());
  assert.equal((await adapter.settingsView()).ready, true);

  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  assert.equal(bundle.posts.length, 0);
  assert.equal(bundle.statusCalls.length, 0);
  assert.equal(bundle.reads.length, 0);
  assert.equal((await store.listExecutorAttempts()).length, 0);
  assert.equal(await adapter.quotaUsed(work.grantId), 0);

  // An internal task never applies for external authorization: zero grants, works, attempts, WB calls.
  await dispatch.chooseInternal('project-1', 'task-9');
  assert.equal((await store.listWorks({ projectId: 'project-1', taskId: 'task-9' })).length, 0);
  const wbDispatch = new ExternalDispatch({ store, profiles: () => ({ externalDispatchAllowed: true as const }), qualifyAssets: async (_p, refs) => new Set(refs.map(externalAssetRefText)), now, workbuddy: adapter });
  await assert.rejects(
    wbDispatch.triggerWorkBuddy('project-1', 'task-9', { workId: 'missing-work', revision: 1 }),
    expectCode('external_work_not_found'),
  );
  assert.equal(bundle.posts.length, 0);
  assert.equal((await store.listExecutorAttempts()).length, 0);
});

test('AB02/E05: 3 次触发额度含修订；submitted/UNKNOWN 占额；跨 turn/重启不重置；超限拒绝', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);

  // Revision 1: the receipt is lost → UNKNOWN occupies the grant quota.
  bundle.setPostBehavior(() => { throw new Error('connection lost before receipt'); });
  const unknown = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(unknown.attempt.status, 'unknown');
  assert.equal(bundle.posts.length, 1);

  // UNKNOWN is never blindly retried: the same revision returns the original attempt, no second POST.
  const repeat = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(repeat.attempt.attemptId, unknown.attempt.attemptId);
  assert.equal(repeat.dispatched, false);
  assert.equal(bundle.posts.length, 1);

  // Revisions 2 and 3 succeed — the quota counts UNKNOWN + 2 triggers (含修订, per grant, not per revision).
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: `m-${bundle.posts.length}` }));
  await promoteRevision(store, work.workId, 2);
  assert.equal((await adapter.trigger({ workId: work.workId, revision: 2 })).attempt.status, 'succeeded');
  await promoteRevision(store, work.workId, 3);
  assert.equal((await adapter.trigger({ workId: work.workId, revision: 3 })).attempt.status, 'succeeded');
  assert.equal(await adapter.quotaUsed(work.grantId), 3);

  // A fourth trigger under the same grant is refused; a new turn/restart (fresh adapter instance) does not reset it.
  await promoteRevision(store, work.workId, 4);
  await assert.rejects(adapter.trigger({ workId: work.workId, revision: 4 }), expectCode('external_workbuddy_quota_exhausted'));
  const restarted = makeAdapter(store, wbTransport());
  await assert.rejects(restarted.trigger({ workId: work.workId, revision: 4 }), expectCode('external_workbuddy_quota_exhausted'));
  assert.equal(bundle.posts.length, 3);
});

test('AB02/E05: 明确拒绝（离线助手）不占额度；恢复后同 revision 可再次触发', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);

  // Definitively offline assistant: the API refuses before any message exists → rejected, zero quota.
  bundle.setOnline({ outcome: 'succeeded', online: false });
  const first = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(first.attempt.status, 'rejected');
  assert.equal(first.attempt.reason, 'assistant_offline');
  assert.equal(bundle.posts.length, 0);
  const second = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.notEqual(second.attempt.attemptId, first.attempt.attemptId);
  assert.equal(second.attempt.status, 'rejected');
  assert.equal(await adapter.quotaUsed(work.grantId), 0);

  // When the assistant is back the same revision triggers for real; only the succeeded trigger occupies.
  bundle.setOnline({ outcome: 'succeeded', online: true });
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: 'm-1' }));
  const third = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(third.attempt.status, 'succeeded');
  assert.equal(third.attempt.messageId, 'm-1');
  assert.notEqual(third.attempt.attemptId, first.attempt.attemptId);
  assert.equal(await adapter.quotaUsed(work.grantId), 1);
});

test('AB03/E05: 串行占用——第二项工作保留等待，不二次触发、不占额', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: `m-${bundle.posts.length}` }));

  const { work: workA, grant: grantA } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, workA);
  const triggeredA = await adapter.trigger({ workId: workA.workId, revision: 1 });
  assert.equal(triggeredA.attempt.status, 'succeeded');
  assert.deepEqual(await store.getWorkBuddyActiveExecution(CONNECTION), { workId: workA.workId, reason: 'triggered-awaiting-closure' });

  // A second work on the same connection waits: no second POST, no attempt record, untouched quota.
  const { work: workB, grant: grantB } = await dispatch.authorize('project-1', 'task-2', grantInput());
  await publishWork(store, workB);
  await assert.rejects(adapter.trigger({ workId: workB.workId, revision: 1 }), expectCode('external_workbuddy_serial_occupied'));
  assert.equal(bundle.posts.length, 1);
  assert.equal((await store.listExecutorAttempts()).filter(item => item.workId === workB.workId).length, 0);
  assert.equal(await adapter.quotaUsed(grantB.grantId), 0);
  assert.equal(await adapter.quotaUsed(grantA.grantId), 1);
});

test('AB03/E05: 首项 UNKNOWN 在途不释放串行；交付＋核验＋释放后释放；取消立即释放', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());

  // First work's trigger receipt lost → UNKNOWN in flight keeps the connection occupied.
  bundle.setPostBehavior(() => { throw new Error('lost'); });
  const { work: workA } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, workA);
  const unknownA = await adapter.trigger({ workId: workA.workId, revision: 1 });
  assert.equal(unknownA.attempt.status, 'unknown');
  const { work: workB } = await dispatch.authorize('project-1', 'task-2', grantInput());
  await publishWork(store, workB);
  await assert.rejects(adapter.trigger({ workId: workB.workId, revision: 1 }), expectCode('external_workbuddy_serial_occupied'));

  // Closed loop on A frees the connection — but only after the UNKNOWN is explicitly reconciled
  // (read-only: the exact message with the receipt did exist) and the work runs claim→deliver→review→release.
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: `m-${bundle.posts.length}` }));
  await assert.rejects(adapter.trigger({ workId: workB.workId, revision: 1 }), expectCode('external_workbuddy_serial_occupied'));
  const resolvedA = await store.transitionExecutorAttempt(unknownA.attempt.attemptId, 'succeeded', { reconciled: true, messageId: 'm-recovered' });
  assert.equal(resolvedA.status, 'succeeded');
  const { claim } = await store.recordClaim({ workId: workA.workId, revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });
  const { delivery } = await store.recordDelivery({ workId: workA.workId, revision: 1, claimId: claim.claimId, idempotencyKey: 'deliver-a-1', manifestHash: sha256('manifest-a') });
  await store.recordReview({ workId: workA.workId, deliveryId: delivery.deliveryId, decision: 'accepted', reason: '合成核验接受', deliveryHash: sha256('manifest-a') });
  await store.releaseClaim({ workId: workA.workId, revision: 1, claimId: claim.claimId, epoch: claim.epoch, reason: 'safe-release' });
  assert.equal(await store.getWorkBuddyActiveExecution(CONNECTION), null);

  // With A closed, B may finally execute through the same connection.
  const triggeredB = await adapter.trigger({ workId: workB.workId, revision: 1 });
  assert.equal(triggeredB.attempt.status, 'succeeded');

  // User-side cancellation of the occupying work releases immediately (zero silent re-dispatch involved).
  await store.cancelWork(workB.workId, '用户取消外派');
  assert.equal(await store.getWorkBuddyActiveExecution(CONNECTION), null);
  const { work: workC } = await dispatch.authorize('project-1', 'task-3', grantInput());
  await publishWork(store, workC);
  const triggeredC = await adapter.trigger({ workId: workC.workId, revision: 1 });
  assert.equal(triggeredC.attempt.status, 'succeeded');

  await store.cancelWork(workC.workId, '用户取消外派');
  assert.equal(await store.getWorkBuddyActiveExecution(CONNECTION), null);
  const { work: workD } = await dispatch.authorize('project-1', 'task-4', grantInput());
  await publishWork(store, workD);
  const triggeredD = await adapter.trigger({ workId: workD.workId, revision: 1 });
  assert.equal(triggeredD.attempt.status, 'succeeded');
});

test('S5 store: 触发尝试转移表守卫（prepared/submitted/unknown/message_id/expectedStatus）', async t => {
  const { store, dispatch } = await fixture(t);
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  const reserve = () => store.recordExecutorAttempt({ grantId: work.grantId, grantVersion: work.grantVersion, workId: work.workId, revision: 1, connection: CONNECTION, bodyHash: sha256('message-1') });

  // prepared cannot jump to succeeded; submitted requires the exact prior status.
  const attempt = await reserve();
  assert.equal(attempt.status, 'prepared');
  await assert.rejects(store.transitionExecutorAttempt(attempt.attemptId, 'succeeded'), expectCode('external_workbuddy_transition_forbidden'));
  await assert.rejects(
    store.transitionExecutorAttempt(attempt.attemptId, 'submitted', { expectedStatus: 'unknown' }),
    expectCode('external_workbuddy_conflict'),
  );
  await store.transitionExecutorAttempt(attempt.attemptId, 'submitted', { expectedStatus: 'prepared' });

  // succeeded without a message_id receipt cannot stand; it degrades to UNKNOWN.
  await assert.rejects(
    store.transitionExecutorAttempt(attempt.attemptId, 'succeeded', { expectedStatus: 'submitted' }),
    expectCode('external_workbuddy_result_required'),
  );
  const unknown = await store.transitionExecutorAttempt(attempt.attemptId, 'unknown', { expectedStatus: 'submitted' });
  assert.equal(unknown.status, 'unknown');

  // UNKNOWN resolves only through an explicit read-only reconciliation.
  await assert.rejects(store.transitionExecutorAttempt(attempt.attemptId, 'succeeded'), expectCode('external_workbuddy_transition_forbidden'));
  const settled = await store.transitionExecutorAttempt(attempt.attemptId, 'succeeded', { reconciled: true, messageId: 'm-9' });
  assert.equal(settled.status, 'succeeded');
  assert.equal(settled.messageId, 'm-9');
  await assert.rejects(store.transitionExecutorAttempt(attempt.attemptId, 'rejected'), expectCode('external_workbuddy_transition_forbidden'));
});

test('S5 store: 触发尝试记录完整性损坏拒绝；有效记录照常回读', async t => {
  const { root, store, dispatch } = await fixture(t);
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  const attempt = await store.recordExecutorAttempt({ grantId: work.grantId, grantVersion: work.grantVersion, workId: work.workId, revision: 1, connection: CONNECTION, bodyHash: sha256('message-1') });
  assert.equal(attempt.status, 'prepared');
  assert.equal((await store.listExecutorAttempts()).length, 1);

  const rewrite = (mutate: (state: { executorAttempts: Array<Record<string, unknown>> }) => void) =>
    new Promise<void>((resolve, reject) => {
      readFile(store.file, 'utf8').then(raw => {
        const parsed = JSON.parse(raw) as { executorAttempts: Array<Record<string, unknown>> };
        mutate(parsed);
        writeFile(store.file, JSON.stringify(parsed)).then(resolve, reject);
      }, reject);
    });

  // Dangling work reference.
  await rewrite(state => { state.executorAttempts[0]!.workId = 'missing-work'; });
  await assert.rejects(new ExternalWorkStore({ dataRoot: root, now }).init(), expectCode('external_store_corrupt'));

  // Grant binding must match the work's grant identity.
  await rewrite(state => { state.executorAttempts[0]!.workId = work.workId; state.executorAttempts[0]!.grantVersion = 99; });
  await assert.rejects(new ExternalWorkStore({ dataRoot: root, now }).init(), expectCode('external_store_corrupt'));

  // Two open (non-rejected) attempts on one (work, revision) are corrupt — triggers are single per revision.
  await rewrite(state => { state.executorAttempts[0]!.grantVersion = 1; state.executorAttempts.push({ ...state.executorAttempts[0]!, attemptId: 'dup-1', status: 'prepared' }); });
  await assert.rejects(new ExternalWorkStore({ dataRoot: root, now }).init(), expectCode('external_store_corrupt'));

  // The untampered ledger with the valid attempt keeps loading.
  await rewrite(state => { state.executorAttempts.splice(1, 1); });
  const reopened = new ExternalWorkStore({ dataRoot: root, now });
  await reopened.init();
  assert.deepEqual((await reopened.listExecutorAttempts()).map(item => item.attemptId), [attempt.attemptId]);
});

test('E05: message_id 仅游标/回执——不可准确关联的消息不归属、正文不进台账不进模型', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: 'm-1' }));
  const result = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(result.attempt.messageId, 'm-1');
  // The receipt is a cursor identity only — never a task, session or claim id.
  assert.notEqual(result.attempt.attemptId, result.attempt.messageId);

  // Messages right after the trigger: only the exactly-correlated one is associated.
  bundle.addMessage('m-2', `工作已领取，开始执行 ${'wb-correlation:'}${work.workId}@1`);
  bundle.addMessage('m-3', '用户随便聊了句今天天气不错'); // adjacent in time, no marker → never attributed
  bundle.addMessage('m-4', `进度更新 ${'wb-correlation:'}deadbeef-wrong@1`); // wrong work id → never attributed
  const scan = await adapter.readReplies();
  assert.deepEqual(scan.associated, [{ messageId: 'm-2', workId: work.workId, revision: 1, kind: 'work' }]);
  assert.deepEqual(scan.unassociated, [{ messageId: 'm-3' }, { messageId: 'm-4' }]);
  assert.equal(scan.cursor, 'm-4');
  for (const entry of [...scan.associated, ...scan.unassociated]) assert.equal('text' in entry, false);

  // No unassociated (or any) message text ever enters the durable ledger or any task/model surface.
  const ledgerBytes = await readFile(store.file, 'utf8');
  assert.equal(ledgerBytes.includes('今天天气不错'), false);
  assert.equal(ledgerBytes.includes('deadbeef-wrong'), false);
  assert.equal(ledgerBytes.includes('wb-correlation'), false);

  // A marker referencing a revision with no recorded trigger attempt is not attributed either.
  bundle.addMessage('m-5', `${'wb-correlation:'}${work.workId}@9`);
  const scan2 = await adapter.readReplies();
  assert.deepEqual(scan2.associated, []);
  assert.deepEqual(scan2.unassociated.map(item => item.messageId), ['m-5']);
});

test('E05: claim/delivery 证据仅在准确核对后关联；伪造引用不产生交付或核验', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: 'm-1' }));
  await adapter.trigger({ workId: work.workId, revision: 1 });
  const { claim } = await store.recordClaim({ workId: work.workId, revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });

  // Valid marker + real claim id → claim-evidence; valid marker + fabricated delivery id stays work-level and creates nothing.
  bundle.addMessage('m-2', `已领取 ${'wb-correlation:'}${work.workId}@1 claim:${claim.claimId}`);
  bundle.addMessage('m-3', `已交付 ${'wb-correlation:'}${work.workId}@1 delivery:fabricated-delivery-id`);
  const scan = await adapter.readReplies();
  assert.deepEqual(scan.associated, [
    { messageId: 'm-2', workId: work.workId, revision: 1, kind: 'claim-evidence' },
    { messageId: 'm-3', workId: work.workId, revision: 1, kind: 'work' },
  ]);
  // Messages never substitute work.deliver: the fabricated delivery reference creates no delivery/review records.
  assert.equal((await store.listDeliveries(work.workId)).length, 0);
  assert.equal((await store.listReviews(work.workId)).length, 0);
  const ledgerBytes = await readFile(store.file, 'utf8');
  assert.equal(ledgerBytes.includes('fabricated-delivery-id'), false);
});

test('E05: 读失败游标原地不推进；恢复后同窗口重读', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: 'm-1' }));
  await adapter.trigger({ workId: work.workId, revision: 1 });
  bundle.addMessage('m-2', `${'wb-correlation:'}${work.workId}@1 进展正常`);

  const good = await adapter.readReplies();
  assert.deepEqual(good.associated.map(item => item.messageId), ['m-2']);
  assert.equal(good.cursor, 'm-2');

  // Unknown read: refuse and keep the stored cursor exactly where it was.
  bundle.setReadBehavior(() => ({ outcome: 'unknown' }));
  await assert.rejects(adapter.readReplies(), expectCode('external_workbuddy_read_unknown'));
  const config = await store.getWorkBuddyConfig(workBuddyConfigId(CONNECTION));
  assert.equal(config?.replyCursor, 'm-2');

  // Recovery re-requests the same window; the cursor did not silently advance over unread messages.
  bundle.setReadBehavior(undefined);
  bundle.addMessage('m-3', `${'wb-correlation:'}${work.workId}@1 已交付`);
  const recovered = await adapter.readReplies();
  assert.equal(bundle.reads[bundle.reads.length - 2]?.afterMessageId, 'm-2');
  assert.deepEqual(recovered.associated.map(item => item.messageId), ['m-3']);
  assert.equal(recovered.cursor, 'm-3');
});

test('E05: 离线/失败不静默重派、不自动第二条；纯 GitHub 路径不受影响', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);

  // Offline → rejected; nothing (no timer, no loop, no restart path) silently re-sends the message.
  bundle.setOnline({ outcome: 'succeeded', online: false });
  await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(bundle.posts.length, 0);
  await makeAdapter(store, wbTransport()).readReplies(); // restart + diagnostics reads never re-trigger
  assert.equal(bundle.posts.length, 0);

  // Transport failure → UNKNOWN; a fresh instance still returns the same attempt without a second POST.
  bundle.setOnline({ outcome: 'succeeded', online: true });
  bundle.setPostBehavior(() => { throw new Error('lost'); });
  const unknown = await adapter.trigger({ workId: work.workId, revision: 1 });
  assert.equal(unknown.attempt.status, 'unknown');
  assert.equal(bundle.posts.length, 1);
  const restarted = makeAdapter(store, wbTransport());
  const again = await restarted.trigger({ workId: work.workId, revision: 1 });
  assert.equal(again.attempt.attemptId, unknown.attempt.attemptId);
  assert.equal(again.dispatched, false);
  assert.equal(bundle.posts.length, 1);

  // The pure GitHub closure of the same work is unaffected by the WB failure: publish/append still works.
  const github = { dispatch: async (request: { repositoryId: string }) => ({ outcome: 'succeeded' as const, repositoryId: request.repositoryId, issueNumber: 701 }) };
  const publisher = new ExternalPublisher({ store, transport: github });
  const appended = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-comment', body: '合成补充说明' });
  assert.equal(appended.attempt.status, 'succeeded');
});

test('S5 dispatch: mode 选用门槛——未配置/未就绪/受限 profile/归属各自拒绝，通用路径不变', async t => {
  const { store, profiles, qualifyAssets, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);

  // Without an injected adapter the WB mode is simply unavailable; the GitHub path stays untouched.
  const plainDispatch = new ExternalDispatch({ store, profiles, qualifyAssets, now });
  await assert.rejects(
    plainDispatch.triggerWorkBuddy('project-1', 'task-1', { workId: work.workId, revision: 1 }),
    expectCode('external_workbuddy_unconfigured'),
  );

  // With the adapter but an unverified config (default), the mode gate refuses before any call.
  const dispatchWb = new ExternalDispatch({ store, profiles, qualifyAssets, now, workbuddy: adapter });
  await assert.rejects(
    dispatchWb.triggerWorkBuddy('project-1', 'task-1', { workId: work.workId, revision: 1 }),
    expectCode('external_workbuddy_not_ready'),
  );
  assert.equal(bundle.posts.length, 0);

  // Restricted profile cannot use the mode even with a ready adapter.
  await adapter.runJointTest(jointHarness());
  const lockedDispatch = new ExternalDispatch({
    store, profiles: () => ({ externalDispatchAllowed: false as const, reason: 'protected' }), qualifyAssets, now, workbuddy: adapter,
  });
  await assert.rejects(
    lockedDispatch.triggerWorkBuddy('project-1', 'task-1', { workId: work.workId, revision: 1 }),
    expectCode('external_profile_forbidden'),
  );

  // Works of other owners are not reachable through the mode.
  await assert.rejects(
    dispatchWb.triggerWorkBuddy('project-1', 'task-other', { workId: work.workId, revision: 1 }),
    expectCode('external_work_not_found'),
  );

  // Ready config + allowed profile + own work → the mode triggers through the adapter.
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: 'm-1' }));
  const triggered = await dispatchWb.triggerWorkBuddy('project-1', 'task-1', { workId: work.workId, revision: 1 });
  assert.equal(triggered.attempt.status, 'succeeded');
  assert.equal(bundle.posts.length, 1);
});

test('E05: 触发消息只交付工作指令＋定位信息；令牌材料一律拒绝出站', async t => {
  const { store, dispatch } = await fixture(t);
  const bundle = wbTransport();
  const adapter = makeAdapter(store, bundle);
  await adapter.ensureConfig();
  await adapter.runJointTest(jointHarness());
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await publishWork(store, work);
  bundle.setPostBehavior(() => ({ outcome: 'succeeded', messageId: 'm-1' }));

  const result = await adapter.trigger({ workId: work.workId, revision: 1 });
  const message = bundle.posts[0]!;
  assert.equal(message.msgType, 'text');
  assert.ok(message.content.includes(`wb-correlation:${work.workId}@1`));
  assert.ok(message.content.includes('openai/synthetic#701'));
  assert.ok(message.content.includes(MCP_ENDPOINT));
  assert.ok(message.content.includes('合成外派目标'));
  assert.ok(message.content.includes('合成交付标准'));
  assert.ok(message.content.includes(externalAssetRefText(assetRef('metric-1'))));
  // No credential material of any shape: the adapter holds no tokens and screens the composed message.
  assert.equal(message.content.includes('Bearer '), false);
  assert.equal(message.content.includes('ghp_'), false);
  assert.equal(message.content.includes('AKIA'), false);
  assert.equal(result.attempt.status, 'succeeded');

  // Token-shaped material inside business text is refused before reservation: no attempt, no POST, no quota.
  const { work: workT, grant: grantT } = await dispatch.authorize('project-1', 'task-5', grantInput({ scope: '范围内执行，勿外泄 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678' }));
  await publishWork(store, workT);
  await assert.rejects(adapter.trigger({ workId: workT.workId, revision: 1 }), expectCode('external_workbuddy_secret_rejected'));
  assert.equal(bundle.posts.length, 1);
  assert.equal((await store.listExecutorAttempts()).filter(item => item.workId === workT.workId).length, 0);
  assert.equal(await adapter.quotaUsed(grantT.grantId), 0);

  // Host-known credential values are screened through the injected guard as well.
  const guarded = makeAdapter(store, bundle, { credentialValues: () => ['wb-known-secret-material-0042'] });
  const { work: workG } = await dispatch.authorize('project-1', 'task-6', grantInput({ scope: '范围内执行，凭据 wb-known-secret-material-0042 不得外发' }));
  await publishWork(store, workG);
  await assert.rejects(guarded.trigger({ workId: workG.workId, revision: 1 }), expectCode('external_workbuddy_secret_rejected'));
  assert.equal(bundle.posts.length, 1);
});

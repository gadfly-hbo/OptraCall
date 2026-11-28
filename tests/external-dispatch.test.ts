import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExternalDispatch } from '../src/host/external-dispatch.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { DEFAULT_EXTERNAL_RESOURCE_POLICY, ExternalWorkError, externalAssetRefText } from '../src/host/external-work-types.ts';
import type { ExternalGrantInput, ExternalProfileLookup, ExternalTaskProfile } from '../src/host/external-dispatch.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const T0 = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
let clock = T0;
const now = () => clock;

const expectCode = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof ExternalWorkError, `expected ExternalWorkError, got ${String(error)}`);
  assert.equal((error as ExternalWorkError).code, expected);
  return true;
};
const assetRef = (id: string) => ({ authority: 'optracall/studio', id, version: 'published-v1', hash: sha256(`asset:${id}`) });

async function fixture(t: { after(fn: () => Promise<void>): void }, options: { profile?: ExternalTaskProfile; qualifiedIds?: string[] } = {}) {
  clock = T0;
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-dispatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot: root, now });
  await store.init();
  const profiles: ExternalProfileLookup = options.profile === undefined
    ? () => ({ externalDispatchAllowed: true })
    : () => options.profile!;
  const dispatch = new ExternalDispatch({
    store,
    profiles,
    qualifyAssets: async (_projectId, refs) => new Set(refs.filter(ref => (options.qualifiedIds ?? ['metric-1', 'metric-2']).includes(ref.id)).map(externalAssetRefText)),
    now,
  });
  return { root, store, dispatch };
}

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
    summary: '合成工作摘要',
    deliveryCriteria: '合成交付标准',
    targetExecutor: 'principal-a',
    ...overrides,
  };
}

test('authorize persists the grant snapshot and a revision-1 work without any external record', async t => {
  const { store, dispatch } = await fixture(t);
  const { grant, work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  assert.notEqual(grant.grantId, work.workId);
  assert.equal(grant.grantVersion, 1);
  assert.equal(grant.projectId, 'project-1');
  assert.equal(grant.taskId, 'task-1');
  assert.deepEqual(grant.resourcePolicy, { ...DEFAULT_EXTERNAL_RESOURCE_POLICY });
  assert.equal(grant.repository.stableId, 'openai/synthetic');
  assert.equal(grant.repository.visibility, 'private');
  assert.deepEqual(grant.allowedExecutors, ['principal-a', 'principal-b']);
  assert.equal(grant.enterprise, '合成企业甲');
  assert.equal(grant.validUntil, iso(clock + 48 * HOUR));
  assert.deepEqual(grant.assetRefs, [assetRef('metric-1')]);
  assert.equal(work.revision, 1);
  assert.equal(work.status, 'authorized');
  assert.equal(work.grantId, grant.grantId);
  assert.equal(Object.hasOwn(work, 'issueId'), false);
  // authorization itself is not a publication or trigger: zero outbound records
  assert.deepEqual(await store.listPublications(work.workId), []);
  assert.deepEqual(await store.listClaims(work.workId), []);
  assert.equal((await store.listGrants({ projectId: 'project-1' })).length, 1);

  const summary = await dispatch.summarize('project-1', 'task-1');
  assert.equal(summary.works.length, 1);
  assert.equal(summary.works[0]?.workId, work.workId);
  assert.equal(summary.works[0]?.claim, null);
  assert.equal(summary.internalChoice, null);
  const foreignSummary = await dispatch.summarize('project-1', 'task-other');
  assert.deepEqual(foreignSummary.works, []);
});

test('restricted profiles cannot authorize external work, but the internal path stays open', async t => {
  const { store, dispatch } = await fixture(t, { profile: { externalDispatchAllowed: false, reason: 'protected-profile' } });
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput()), expectCode('external_profile_forbidden'));
  assert.deepEqual(await store.listGrants({ projectId: 'project-1' }), []);
  assert.deepEqual(await store.listWorks({ projectId: 'project-1' }), []);
  // AB01: 内部始终可选，受限 profile 不因外派功能收紧内部路径
  await dispatch.chooseInternal('project-1', 'task-1');
  assert.notEqual(await store.getInternalChoice('project-1', 'task-1'), null);
});

test('asset refs are granted only inside the original qualification intersection', async t => {
  const { store, dispatch } = await fixture(t, { qualifiedIds: ['metric-1'] });
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ assetRefs: [assetRef('metric-1'), assetRef('metric-3')] })), expectCode('external_asset_not_qualified'));
  assert.deepEqual(await store.listGrants({ projectId: 'project-1' }), []);
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ inputs: [assetRef('metric-4')] })), expectCode('external_asset_not_qualified'));
  assert.deepEqual(await store.listWorks({ projectId: 'project-1' }), []);
  const allowed = await dispatch.authorize('project-1', 'task-1', grantInput());
  assert.deepEqual(allowed.grant.assetRefs, [assetRef('metric-1')]);
});

test('missing explicit enterprise never falls back to a legacy default', async t => {
  const { store, dispatch } = await fixture(t);
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ enterprise: '' })), expectCode('external_enterprise_required'));
  const missing = grantInput();
  delete (missing as Partial<ExternalGrantInput>).enterprise;
  await assert.rejects(dispatch.authorize('project-1', 'task-1', missing), expectCode('external_enterprise_required'));
  assert.deepEqual(await store.listGrants({ projectId: 'project-1' }), []);
});

test('resource policy snapshots honor lower approved policies and refuse anything above the default ceiling', async t => {
  const { dispatch } = await fixture(t);
  const lower = await dispatch.authorize('project-1', 'task-1', grantInput({ resourcePolicy: { maxWorks: 1, windowHours: 4 } }));
  assert.deepEqual(lower.grant.resourcePolicy, { maxWorks: 1, windowHours: 4 });
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ resourcePolicy: { maxWorks: 2, windowHours: 24 } })), expectCode('external_policy_exceeds_default'));
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ resourcePolicy: { maxWorks: 1, windowHours: 48 } })), expectCode('external_policy_exceeds_default'));
  const fallback = await dispatch.authorize('project-2', 'task-1', grantInput());
  assert.deepEqual(fallback.grant.resourcePolicy, { ...DEFAULT_EXTERNAL_RESOURCE_POLICY });
});

test('default 1work/24h rate holds until the window passes or the work is cancelled', async t => {
  const { store, dispatch } = await fixture(t);
  const first = await dispatch.authorize('project-1', 'task-1', grantInput());
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ summary: '第二份工作' })), expectCode('external_policy_rate_limited'));
  assert.equal((await store.listWorks({ projectId: 'project-1', taskId: 'task-1' })).length, 1);
  clock += 23 * HOUR;
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput()), expectCode('external_policy_rate_limited'));
  clock += 2 * HOUR;
  const afterWindow = await dispatch.authorize('project-1', 'task-1', grantInput({ summary: '窗口后的新工作' }));
  assert.notEqual(afterWindow.work.workId, first.work.workId);
  // cancel frees the same-day slot: cancel + re-authorize is a legal sequence
  await dispatch.cancelWork(afterWindow.work.workId, 'misdispatch');
  const replacement = await dispatch.authorize('project-1', 'task-1', grantInput({ summary: '取消后重派' }));
  assert.equal(replacement.work.status, 'authorized');
});

test('grant validity must be explicitly confirmed in the future', async t => {
  const { store, dispatch } = await fixture(t);
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ validUntil: iso(clock - HOUR) })), expectCode('external_grant_expired'));
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ validUntil: iso(clock) })), expectCode('external_grant_expired'));
  assert.deepEqual(await store.listGrants({ projectId: 'project-1' }), []);
});

test('chooseInternal records intent with zero external side effects', async t => {
  const { store, dispatch } = await fixture(t);
  await dispatch.chooseInternal('project-1', 'task-1');
  const choice = await store.getInternalChoice('project-1', 'task-1');
  assert.equal(choice?.mode, 'internal');
  assert.deepEqual(await store.listGrants({ projectId: 'project-1' }), []);
  assert.deepEqual(await store.listWorks({ projectId: 'project-1' }), []);
  assert.deepEqual(await store.listPublications('any-work'), []);
  const summary = await dispatch.summarize('project-1', 'task-1');
  assert.equal(summary.internalChoice, choice?.decidedAt);
  assert.deepEqual(summary.works, []);
  clock += HOUR;
  await dispatch.chooseInternal('project-1', 'task-1');
  const choices = await store.listInternalChoices();
  assert.equal(choices.filter(item => item.projectId === 'project-1' && item.taskId === 'task-1').length, 1);
  assert.equal((await store.getInternalChoice('project-1', 'task-1'))?.decidedAt, iso(clock));
});

test('chooseInternal refuses a silent switch-back while external work is active; cancel unblocks', async t => {
  const { dispatch } = await fixture(t);
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  await assert.rejects(dispatch.chooseInternal('project-1', 'task-1'), expectCode('external_work_active'));
  await dispatch.cancelWork(work.workId, 'switch-to-internal');
  await dispatch.chooseInternal('project-1', 'task-1');
  const summary = await dispatch.summarize('project-1', 'task-1');
  assert.notEqual(summary.internalChoice, null);
  assert.equal(summary.works[0]?.status, 'cancelled');
});

test('cancel preserves every fact, revokes the active claim and creates no external record', async t => {
  const { store, dispatch } = await fixture(t);
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  const attempt = await store.recordPublication({ workId: work.workId, revision: 1, action: 'issue-create', bodyHash: sha256('issue-body') });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });
  const claim = await store.recordClaim({ workId: work.workId, revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });
  const publicationIdsBefore = (await store.listPublications(work.workId)).map(publication => publication.operationId);

  await dispatch.cancelWork(work.workId, 'user-cancelled');
  const revoked = await store.getClaim(claim.claim.claimId);
  assert.equal(revoked?.status, 'revoked');
  assert.deepEqual((await store.listPublications(work.workId)).map(publication => publication.operationId), publicationIdsBefore);
  assert.deepEqual(await store.listDeliveries(work.workId), []);

  const summary = await dispatch.summarize('project-1', 'task-1');
  assert.equal(summary.works[0]?.status, 'cancelled');
  assert.equal(summary.works[0]?.claim, null);
  assert.equal(summary.works[0]?.publications.length, 1);
  assert.equal(summary.works[0]?.publications[0]?.issueId, '101');
});

test('authorize input integrity: executors, repository identity, target executor and validation errors', async t => {
  const { store, dispatch } = await fixture(t);
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ allowedExecutors: [] })), expectCode('external_grant_invalid'));
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ targetExecutor: 'principal-z' })), expectCode('external_grant_invalid'));
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ repository: { stableId: '', visibility: 'private' } })), expectCode('external_grant_invalid'));
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ repository: { stableId: 'openai/synthetic', visibility: 'internal' as 'private' } })), expectCode('external_grant_invalid'));
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ goal: '' })), expectCode('external_grant_invalid'));
  await assert.rejects(dispatch.authorize('project-1', 'task-1', grantInput({ validUntil: 'not-a-date' })), expectCode('external_grant_invalid'));
  assert.deepEqual(await store.listGrants({ projectId: 'project-1' }), []);
});

test('summarize exposes separately recorded facts, never a merged success flag', async t => {
  const { store, dispatch } = await fixture(t);
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  const attempt = await store.recordPublication({ workId: work.workId, revision: 1, action: 'issue-create', bodyHash: sha256('issue-body') });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });
  const claim = await store.recordClaim({ workId: work.workId, revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });
  const delivery = await store.recordDelivery({ workId: work.workId, revision: 1, claimId: claim.claim.claimId, idempotencyKey: 'idem-1', manifestHash: sha256('manifest-1') });
  await store.recordReview({ workId: work.workId, deliveryId: delivery.delivery.deliveryId, decision: 'needs-supplement', reason: '缺合成依据', deliveryHash: sha256('manifest-1') });

  const summary = await dispatch.summarize('project-1', 'task-1');
  const entry = summary.works[0];
  assert.equal(entry?.publications.length, 1);
  assert.equal(entry?.publications[0]?.status, 'succeeded');
  assert.equal(entry?.claim?.principal, 'principal-a');
  assert.equal(entry?.deliveryCount, 1);
  assert.equal(entry?.reviewCount, 1);
  assert.equal(entry?.latestReview?.decision, 'needs-supplement');
});

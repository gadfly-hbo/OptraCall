import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { DEFAULT_EXTERNAL_RESOURCE_POLICY, ExternalWorkError, externalAssetRefText } from '../src/host/external-work-types.ts';
import type { ExternalWork, WorkGrant } from '../src/host/external-work-types.ts';

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

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  clock = T0;
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot: root, now });
  await store.init();
  return { root, store };
}

function grantFixture(overrides: Partial<WorkGrant> = {}): WorkGrant {
  return {
    grantId: 'grant-1',
    grantVersion: 1,
    projectId: 'project-1',
    taskId: 'task-1',
    goal: '合成外派目标',
    scope: '仅限合成数据范围',
    forbidden: '禁止读取真实业务数据',
    allowedExecutors: ['principal-a', 'principal-b'],
    repository: { stableId: 'openai/synthetic', visibility: 'private' },
    assetRefs: [assetRef('metric-1')],
    enterprise: '合成企业甲',
    validFrom: iso(clock),
    validUntil: iso(clock + 48 * HOUR),
    resourcePolicy: { ...DEFAULT_EXTERNAL_RESOURCE_POLICY },
    autoResumeAllowed: true,
    createdAt: iso(clock),
    ...overrides,
  };
}

function workFixture(grant: WorkGrant, overrides: Partial<ExternalWork> = {}): ExternalWork {
  return {
    workId: 'work-1',
    projectId: grant.projectId,
    taskId: grant.taskId,
    revision: 1,
    summary: '合成工作摘要',
    deliveryCriteria: '合成交付标准',
    inputs: [assetRef('metric-1')],
    targetExecutor: 'principal-a',
    grantId: grant.grantId,
    grantVersion: grant.grantVersion,
    status: 'authorized',
    createdAt: iso(clock),
    updatedAt: iso(clock),
    ...overrides,
  };
}

/** Persist grant + work and drive one issue-create publication to succeeded. */
async function publishedWork(store: ExternalWorkStore, suffix = '') {
  const grant = grantFixture({ grantId: `grant-1${suffix}` });
  await store.createGrantWithWork(grant, workFixture(grant, { workId: `work-1${suffix}`, grantId: grant.grantId }));
  const attempt = await store.recordPublication({ workId: `work-1${suffix}`, revision: 1, action: 'issue-create', bodyHash: sha256(`issue-body${suffix}`) });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  return store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: `101${suffix}` } });
}

test('ledger stays one private atomic file with no lock or temp residue', async t => {
  const { root, store } = await fixture(t);
  const grant = grantFixture();
  await store.createGrantWithWork(grant, workFixture(grant));
  assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  assert.equal((await stat(store.root)).mode & 0o777, 0o700);
  assert.deepEqual((await readdir(store.root)).sort(), ['ledger.json']);
  assert.equal(root.startsWith(os.tmpdir()), true);
  const work = await store.getWork('work-1');
  assert.equal(work?.grantId, 'grant-1');
  assert.equal(work?.status, 'authorized');
});

test('expectedVersion CAS admits exactly one competing writer', async t => {
  const { root, store } = await fixture(t);
  const second = new ExternalWorkStore({ dataRoot: root, now });
  await second.init();
  const base = await store.version();
  const results = await Promise.allSettled([
    store.mutate(state => { state.internalChoices.push({ projectId: 'p', taskId: 't', mode: 'internal', decidedAt: iso(clock) }); return 'first'; }, base),
    second.mutate(state => { state.internalChoices.push({ projectId: 'p', taskId: 't2', mode: 'internal', decidedAt: iso(clock) }); return 'second'; }, base),
  ]);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(expectCode('external_store_conflict')((rejected[0] as PromiseRejectedResult).reason));
  assert.equal(await store.version(), base + 1);
  const state = await store.mutate(current => current.internalChoices.length, await store.version());
  assert.equal(state, 1);
  // a current expectedVersion succeeds
  const current = await store.version();
  await store.mutate(state => { state.internalChoices.push({ projectId: 'p', taskId: 't3', mode: 'internal', decidedAt: iso(clock) }); }, current);
  assert.equal(await store.version(), current + 1);
});

test('startup keeps own submissions and marks foreign submitted publications unknown without retrying', async t => {
  const { root, store } = await fixture(t);
  const grant = grantFixture();
  await store.createGrantWithWork(grant, workFixture(grant));
  const foreign = await store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-create', bodyHash: sha256('body-1') });
  await store.transitionPublication(foreign.operationId, 'submitted', { expectedStatus: 'prepared' });

  // a different process identity simulates a genuine restart
  const restarted = new ExternalWorkStore({ dataRoot: root, now, instance: 'restarted-process' });
  await restarted.init();
  assert.equal((await restarted.getPublication(foreign.operationId))?.status, 'unknown');

  const own = await restarted.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-comment', bodyHash: sha256('body-2') });
  await restarted.transitionPublication(own.operationId, 'submitted', { expectedStatus: 'prepared' });
  await restarted.init();
  assert.equal((await restarted.getPublication(own.operationId))?.status, 'submitted');
  assert.equal((await restarted.getPublication(foreign.operationId))?.status, 'unknown');

  const third = new ExternalWorkStore({ dataRoot: root, now, instance: 'third-process' });
  await third.init();
  assert.equal((await third.getPublication(own.operationId))?.status, 'unknown');
  // the unknown fact is preserved, never silently retried or deleted
  await third.init();
  assert.equal((await third.getPublication(own.operationId))?.status, 'unknown');
});

test('strict schema parsing rejects corrupt ledgers instead of guessing', async t => {
  const variants: Array<[string, (raw: any) => void | string]> = [
    ['schema bump', raw => { raw.schema = 2; }],
    ['unknown top-level key', raw => { raw.extra = 1; }],
    ['dangling claim reference', raw => { raw.claims[0].workId = 'work-missing'; }],
    ['malformed body hash', raw => { raw.publications[0].bodyHash = 'deadbeef'; }],
    ['duplicate delivery identity', raw => { raw.deliveries.push(structuredClone(raw.deliveries[0])); }],
    ['non-ISO timestamp', raw => { raw.reviews[0].createdAt = 'yesterday'; }],
    ['review hash mismatch', raw => { raw.reviews[0].deliveryHash = sha256('other-content'); }],
    ['invalid internal choice mode', raw => { raw.internalChoices[0].mode = 'external'; }],
    ['broken json', () => 'not-json-at-all'],
  ];
  for (const [name, corrupt] of variants) {
    await t.test(name, async () => {
      const { root, store } = await fixture(t);
      const grant = grantFixture();
      await store.createGrantWithWork(grant, workFixture(grant));
      const attempt = await store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-create', bodyHash: sha256('issue-body') });
      await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
      await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });
      const claim = await store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });
      const delivery = await store.recordDelivery({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, idempotencyKey: 'idem-1', manifestHash: sha256('manifest-1') });
      await store.recordReview({ workId: 'work-1', deliveryId: delivery.delivery.deliveryId, decision: 'accepted', reason: '合成通过', deliveryHash: sha256('manifest-1') });
      await store.recordInboxEvent({ eventKey: 'evt-1', projectId: 'project-1', taskId: 'task-1', workId: 'work-1', deliveryId: delivery.delivery.deliveryId });
      await store.recordResumeReceipt({ requestId: 'resume-1', projectId: 'project-1', taskId: 'task-1', workId: 'work-1', revision: 1, deliveryId: delivery.delivery.deliveryId });
      await store.recordInternalChoice({ projectId: 'project-9', taskId: 'task-9' });

      const raw: any = JSON.parse(await readFile(store.file, 'utf8'));
      const replacement = corrupt(raw);
      await writeFile(store.file, typeof replacement === 'string' ? replacement : JSON.stringify(raw));
      const probed = new ExternalWorkStore({ dataRoot: root, now });
      await assert.rejects(probed.init(), expectCode('external_store_corrupt'));
      // an uninitialized store refuses to serve a ledger it could not parse
      await assert.rejects(probed.version(), expectCode('external_store_not_initialized'));
    });
  }
});

test('a failed mutation leaves the ledger byte-identical with no half records', async t => {
  const { root, store } = await fixture(t);
  const grant = grantFixture();
  await store.createGrantWithWork(grant, workFixture(grant));
  const versionBefore = await store.version();
  const bytesBefore = await readFile(store.file, 'utf8');
  await assert.rejects(
    store.mutate(state => {
      state.works.push(workFixture(grant, { workId: 'work-ghost' }));
      throw new Error('simulated crash');
    }),
    /simulated crash/,
  );
  assert.equal(await store.version(), versionBefore);
  assert.equal(await readFile(store.file, 'utf8'), bytesBefore);
  assert.deepEqual((await readdir(store.root)).sort(), ['ledger.json']);
  assert.equal(await store.getWork('work-ghost'), null);
});

test('one work revision keeps at most one active claim; the winner gets idempotent duplicates', async t => {
  const { root, store } = await fixture(t);
  await publishedWork(store);
  const lease = iso(clock + 15 * 60_000);
  const secondStore = new ExternalWorkStore({ dataRoot: root, now });
  await secondStore.init();
  const race = await Promise.allSettled([
    store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-a', leaseDeadline: lease }),
    secondStore.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-b', leaseDeadline: lease }),
  ]);
  const winners = race.filter(result => result.status === 'fulfilled');
  const losers = race.filter(result => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.ok(expectCode('external_claim_conflict')((losers[0] as PromiseRejectedResult).reason));
  const won = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<ExternalWorkStore['recordClaim']>>>).value;
  assert.equal(won.idempotent, false);
  assert.equal(won.claim.epoch, 1);

  const duplicate = await store.recordClaim({ workId: 'work-1', revision: 1, principal: won.claim.principal, leaseDeadline: lease });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.claim.claimId, won.claim.claimId);

  const loserPrincipal = won.claim.principal === 'principal-a' ? 'principal-b' : 'principal-a';
  await assert.rejects(store.recordClaim({ workId: 'work-1', revision: 1, principal: loserPrincipal, leaseDeadline: lease }), expectCode('external_claim_conflict'));
  const activeClaims = (await store.listClaims('work-1')).filter(claim => claim.status === 'active');
  assert.equal(activeClaims.length, 1);
  assert.equal(activeClaims[0]?.principal, won.claim.principal);
});

test('renew and release verify the exact epoch; released revisions can be claimed again with a new epoch', async t => {
  const { store } = await fixture(t);
  await publishedWork(store);
  const claim = await store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });
  await assert.rejects(
    store.renewClaim({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, epoch: 2, leaseDeadline: iso(clock + 20 * 60_000) }),
    expectCode('external_claim_epoch_conflict'),
  );
  await assert.rejects(
    store.releaseClaim({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, epoch: 2, reason: 'wrong-epoch' }),
    expectCode('external_claim_epoch_conflict'),
  );
  const renewed = await store.renewClaim({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, epoch: 1, leaseDeadline: iso(clock + 20 * 60_000) });
  assert.equal(new Date(renewed.leaseDeadline).getTime(), clock + 20 * 60_000);
  await assert.rejects(
    store.releaseClaim({ workId: 'work-1', revision: 1, claimId: 'claim-ghost', epoch: 1, reason: 'unknown-claim' }),
    expectCode('external_claim_not_found'),
  );
  const released = await store.releaseClaim({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, epoch: 1, reason: 'executor-done' });
  assert.equal(released.status, 'released');

  const second = await store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-b', leaseDeadline: iso(clock + 15 * 60_000) });
  assert.equal(second.claim.epoch, 2);
  assert.equal(second.idempotent, false);
});

test('claim eligibility: unpublished work, unlisted principal and cancelled work are all rejected', async t => {
  const { store } = await fixture(t);
  await publishedWork(store);
  const grant = grantFixture({ grantId: 'grant-2' });
  await store.createGrantWithWork(grant, workFixture(grant, { workId: 'work-2', grantId: grant.grantId }));
  const lease = iso(clock + 15 * 60_000);
  await assert.rejects(store.recordClaim({ workId: 'work-2', revision: 1, principal: 'principal-a', leaseDeadline: lease }), expectCode('external_claim_not_permitted'));
  await assert.rejects(store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-c', leaseDeadline: lease }), expectCode('external_claim_not_permitted'));
  await assert.rejects(store.recordClaim({ workId: 'work-1', revision: 9, principal: 'principal-a', leaseDeadline: lease }), expectCode('external_claim_not_permitted'));
  const cancelled = await store.cancelWork('work-1', 'user-cancelled');
  assert.equal(cancelled.status, 'cancelled');
  await assert.rejects(store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-a', leaseDeadline: lease }), expectCode('external_work_cancelled'));
});

test('lease deadlines are bounded by grant validity and expired claims cannot be released or renewed', async t => {
  const { store } = await fixture(t);
  const grant = grantFixture({ grantId: 'grant-3', validUntil: iso(clock + 10 * 60_000) });
  await store.createGrantWithWork(grant, workFixture(grant, { workId: 'work-3', grantId: grant.grantId }));
  const attempt = await store.recordPublication({ workId: 'work-3', revision: 1, action: 'issue-create', bodyHash: sha256('issue-body-3') });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '103' } });

  await assert.rejects(store.recordClaim({ workId: 'work-3', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock - 1) }), expectCode('external_claim_lease_invalid'));
  const capped = await store.recordClaim({ workId: 'work-3', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 30 * 60_000) });
  assert.equal(capped.claim.leaseDeadline, grant.validUntil);

  clock += 11 * 60_000;
  await assert.rejects(
    store.releaseClaim({ workId: 'work-3', revision: 1, claimId: capped.claim.claimId, epoch: capped.claim.epoch, reason: 'late-release' }),
    expectCode('external_claim_expired'),
  );
  const stored = await store.getClaim(capped.claim.claimId);
  assert.equal(stored?.status, 'expired');
  await assert.rejects(store.recordClaim({ workId: 'work-3', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 5 * 60_000) }), expectCode('external_grant_not_valid'));

  // startup normalization also expires claims whose lease silently lapsed
  const grant4 = grantFixture({ grantId: 'grant-4' });
  await store.createGrantWithWork(grant4, workFixture(grant4, { workId: 'work-4', grantId: grant4.grantId }));
  const attempt4 = await store.recordPublication({ workId: 'work-4', revision: 1, action: 'issue-create', bodyHash: sha256('issue-body-4') });
  await store.transitionPublication(attempt4.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt4.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '104' } });
  const claim4 = await store.recordClaim({ workId: 'work-4', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 60_000) });
  clock += 2 * 60_000;
  const restarted = new ExternalWorkStore({ dataRoot: store.dataRoot, now });
  await restarted.init();
  assert.equal((await restarted.getClaim(claim4.claim.claimId))?.status, 'expired');
});

test('publication identity is unique per work revision and action; transitions follow the guarded table', async t => {
  const { store } = await fixture(t);
  const grant = grantFixture();
  await store.createGrantWithWork(grant, workFixture(grant));
  const first = await store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-create', bodyHash: sha256('body-a') });
  const repeat = await store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-create', bodyHash: sha256('body-a') });
  assert.equal(repeat.operationId, first.operationId);
  await assert.rejects(store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-create', bodyHash: sha256('body-b') }), expectCode('external_publication_conflict'));
  const comment = await store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-comment', bodyHash: sha256('body-c') });
  assert.notEqual(comment.operationId, first.operationId);
  await assert.rejects(store.recordPublication({ workId: 'work-ghost', revision: 1, action: 'issue-create', bodyHash: sha256('body-d') }), expectCode('external_work_not_found'));

  await assert.rejects(store.transitionPublication(first.operationId, 'succeeded', { expectedStatus: 'prepared' }), expectCode('external_publication_transition_forbidden'));
  await store.transitionPublication(first.operationId, 'submitted', { expectedStatus: 'prepared' });
  await assert.rejects(store.transitionPublication(first.operationId, 'prepared', { expectedStatus: 'submitted' }), expectCode('external_publication_transition_forbidden'));
  await store.transitionPublication(first.operationId, 'unknown', { expectedStatus: 'submitted' });
  await assert.rejects(store.transitionPublication(first.operationId, 'succeeded', { expectedStatus: 'unknown' }), expectCode('external_publication_transition_forbidden'));
  const reconciled = await store.transitionPublication(first.operationId, 'succeeded', { expectedStatus: 'unknown', reconciled: true, resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });
  assert.equal(reconciled.status, 'succeeded');
  assert.equal(reconciled.issueId, '101');
  await assert.rejects(store.transitionPublication(first.operationId, 'unknown', { expectedStatus: 'succeeded', reconciled: true }), expectCode('external_publication_transition_forbidden'));

  await store.transitionPublication(comment.operationId, 'rejected', { expectedStatus: 'prepared' });
  await assert.rejects(store.transitionPublication(comment.operationId, 'submitted', { expectedStatus: 'rejected' }), expectCode('external_publication_transition_forbidden'));
});

test('deliveries dedupe by idempotency key, reviews bind the exact delivery hash, and inbox/resume identities are unique', async t => {
  const { store } = await fixture(t);
  await publishedWork(store);
  const claim = await store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });

  await assert.rejects(
    store.recordDelivery({ workId: 'work-1', revision: 1, claimId: 'claim-ghost', idempotencyKey: 'idem-1', manifestHash: sha256('manifest-1') }),
    expectCode('external_delivery_claim_invalid'),
  );
  const delivery = await store.recordDelivery({
    workId: 'work-1', revision: 1, claimId: claim.claim.claimId, idempotencyKey: 'idem-1', manifestHash: sha256('manifest-1'),
    assetsUsed: [assetRef('metric-1')], facts: { done: ['合成事项A'], notDone: [], failed: [], unknown: [] }, late: false,
  });
  assert.equal(delivery.idempotent, false);
  assert.equal(delivery.delivery.preservation, 'pending');
  const repeat = await store.recordDelivery({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, idempotencyKey: 'idem-1', manifestHash: sha256('manifest-1') });
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.delivery.deliveryId, delivery.delivery.deliveryId);
  await assert.rejects(
    store.recordDelivery({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, idempotencyKey: 'idem-1', manifestHash: sha256('manifest-2') }),
    expectCode('external_delivery_conflict'),
  );

  await assert.rejects(
    store.recordReview({ workId: 'work-1', deliveryId: delivery.delivery.deliveryId, decision: 'accepted', reason: '合成通过', deliveryHash: sha256('wrong') }),
    expectCode('external_review_hash_conflict'),
  );
  const review = await store.recordReview({ workId: 'work-1', deliveryId: delivery.delivery.deliveryId, decision: 'accepted', reason: '合成通过', deliveryHash: sha256('manifest-1') });
  assert.equal(review.deliveryHash, sha256('manifest-1'));

  const released = await store.releaseClaim({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, epoch: claim.claim.epoch, reason: 'done' });
  assert.equal(released.status, 'released');
  await assert.rejects(
    store.recordDelivery({ workId: 'work-1', revision: 1, claimId: claim.claim.claimId, idempotencyKey: 'idem-2', manifestHash: sha256('manifest-3') }),
    expectCode('external_delivery_claim_invalid'),
  );

  const event = await store.recordInboxEvent({ eventKey: 'evt-1', projectId: 'project-1', taskId: 'task-1', workId: 'work-1', deliveryId: delivery.delivery.deliveryId });
  assert.equal(event.idempotent, false);
  const eventRepeat = await store.recordInboxEvent({ eventKey: 'evt-1', projectId: 'project-1', taskId: 'task-1' });
  assert.equal(eventRepeat.idempotent, true);
  assert.equal(eventRepeat.event.eventKey, 'evt-1');
  await assert.rejects(store.recordInboxEvent({ eventKey: 'evt-2', projectId: 'project-1', taskId: 'task-1', workId: 'work-ghost' }), expectCode('external_record_invalid'));

  const resume = await store.recordResumeReceipt({ requestId: 'resume-1', projectId: 'project-1', taskId: 'task-1', workId: 'work-1', revision: 1, deliveryId: delivery.delivery.deliveryId });
  assert.equal(resume.idempotent, false);
  const resumeRepeat = await store.recordResumeReceipt({ requestId: 'resume-1', projectId: 'project-1', taskId: 'task-1', workId: 'work-1', revision: 1, deliveryId: delivery.delivery.deliveryId });
  assert.equal(resumeRepeat.idempotent, true);
  await assert.rejects(
    store.recordResumeReceipt({ requestId: 'resume-1', projectId: 'project-1', taskId: 'task-1', workId: 'work-1', revision: 1, deliveryId: 'delivery-ghost' }),
    expectCode('external_resume_conflict'),
  );
});

test('cancel revokes active claims and keeps every recorded fact without creating external records', async t => {
  const { store } = await fixture(t);
  await publishedWork(store);
  const claim = await store.recordClaim({ workId: 'work-1', revision: 1, principal: 'principal-a', leaseDeadline: iso(clock + 15 * 60_000) });
  const publicationsBefore = await store.listPublications('work-1');
  const cancelled = await store.cancelWork('work-1', 'user-cancelled-dispatch');
  assert.equal(cancelled.status, 'cancelled');
  const revoked = await store.getClaim(claim.claim.claimId);
  assert.equal(revoked?.status, 'revoked');
  assert.equal(revoked?.reason, 'user-cancelled-dispatch');
  assert.deepEqual((await store.listPublications('work-1')).map(publication => publication.operationId), publicationsBefore.map(publication => publication.operationId));
  assert.equal((await store.listDeliveries('work-1')).length, 0);
  // idempotent cancel adds nothing
  const again = await store.cancelWork('work-1', 'repeat');
  assert.equal(again.workId, 'work-1');
  assert.equal((await store.listClaims('work-1')).length, 1);
  await assert.rejects(store.cancelWork('work-ghost', 'missing'), expectCode('external_work_not_found'));
});

test('empty ledgers read like legacy tasks and grant validation rejects overreach', async t => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.listWorks({ projectId: 'project-1', taskId: 'task-1' }), []);
  assert.deepEqual(await store.listGrants({ projectId: 'project-1' }), []);
  assert.equal(await store.getInternalChoice('project-1', 'task-1'), null);

  const overlong = grantFixture({ assetRefs: [{ authority: 'optracall/studio', id: 'x'.repeat(301), version: 'v1', hash: sha256('long') }] });
  await assert.rejects(store.createGrantWithWork(overlong, workFixture(overlong)), expectCode('external_grant_invalid'));
  const badGrant = grantFixture({ allowedExecutors: [] });
  await assert.rejects(store.createGrantWithWork(badGrant, workFixture(badGrant)), expectCode('external_grant_invalid'));
  const orphan = workFixture(grantFixture(), { grantId: 'grant-missing' });
  await assert.rejects(store.createGrantWithWork(grantFixture({ grantId: 'grant-5' }), orphan), expectCode('external_work_invalid'));
});

test('asset references and summaries round-trip without losing identity separation', async t => {
  const { store } = await fixture(t);
  const grant = grantFixture({ sourceCaseRef: { caseId: 'case-1', issueId: 'case-issue-7' } });
  await store.createGrantWithWork(grant, workFixture(grant));
  const storedGrant = await store.getGrant('grant-1');
  assert.equal(storedGrant?.sourceCaseRef?.issueId, 'case-issue-7');
  const work = await store.getWork('work-1');
  assert.notEqual(work?.workId, storedGrant?.grantId);
  assert.deepEqual(work?.inputs.map(externalAssetRefText), grant.assetRefs.map(externalAssetRefText));
  assert.equal(Object.hasOwn(work ?? {}, 'issueId'), false);
  await store.recordInternalChoice({ projectId: 'project-1', taskId: 'task-2' });
  const choice = await store.getInternalChoice('project-1', 'task-2');
  assert.equal(choice?.mode, 'internal');
});

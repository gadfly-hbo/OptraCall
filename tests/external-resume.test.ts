import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { ExternalDispatch } from '../src/host/external-dispatch.ts';
import { createExternalResumeCoordinator, resumeRequestId } from '../src/host/external-resume.ts';
import type { ExternalResumeStartMessage } from '../src/host/external-resume.ts';
import type { ExternalWorkStore as Store } from '../src/host/external-work-store.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type RecordedCall = { projectId: string; taskId: string; input: Record<string, unknown>; origin: Record<string, unknown> };
type Seams = {
  busy: boolean;
  available: boolean;
  unavailableReason?: string;
  nativeStatus?: () => Promise<string | undefined>;
  startMessage: ExternalResumeStartMessage;
};

function coordinatorFor(store: Store, now: () => number, seams: Seams) {
  return createExternalResumeCoordinator({
    store,
    startMessage: seams.startMessage,
    busy: async () => seams.busy,
    taskAvailable: async () => seams.available ? { available: true } : { available: false, reason: seams.unavailableReason ?? 'configuration_required' },
    nativeStatus: async (projectId, taskId, requestId) => seams.nativeStatus ? seams.nativeStatus() : undefined,
    now,
    schedule: () => () => {},
  });
}

type Harness = {
  root: string; dataRoot: string; store: Store;
  clock: { now: number };
  calls: RecordedCall[];
  seams: Seams;
  coordinator: ReturnType<typeof coordinatorFor>;
  cleanup: () => Promise<void>;
};

async function harness(): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-resume-'));
  const dataRoot = path.join(root, 'host');
  const clock = { now: 1_700_000_000_000 };
  const store = new ExternalWorkStore({ dataRoot, now: () => clock.now, instance: 'unit-1' });
  await store.init();
  const calls: RecordedCall[] = [];
  const seams: Seams = {
    busy: false,
    available: true,
    startMessage: async (projectId, taskId, input, origin) => { calls.push({ projectId, taskId, input: input as Record<string, unknown>, origin: origin as Record<string, unknown> }); return { requestId: input.requestId, status: 'running' }; },
  };
  return {
    root, dataRoot, store, clock, calls, seams,
    coordinator: coordinatorFor(store, () => clock.now, seams),
    cleanup: async () => { await rm(root, { recursive: true, force: true }); },
  };
}

async function seedWork(store: Store, clock: { now: number }, over: { projectId?: string; taskId?: string; autoResume?: boolean } = {}): Promise<{ grantId: string; workId: string }> {
  const projectId = over.projectId ?? PROJECT, taskId = over.taskId ?? TASK;
  const grantId = randomUUID(), workId = randomUUID();
  const stamp = new Date(clock.now).toISOString();
  await store.createGrantWithWork({
    grantId, grantVersion: 1, projectId, taskId,
    goal: '核对外部交付是否满足原工作', scope: '按原验收条件核验并保存', forbidden: '',
    allowedExecutors: ['executor-a'],
    repository: { stableId: 'owner/repo', visibility: 'private' },
    assetRefs: [], enterprise: 'ent-1',
    validFrom: stamp, validUntil: new Date(clock.now + DAY).toISOString(),
    resourcePolicy: { maxWorks: 1, windowHours: 24 },
    autoResumeAllowed: over.autoResume ?? true, createdAt: stamp,
  }, {
    workId, projectId, taskId, revision: 1,
    summary: '整理季度销售汇总', deliveryCriteria: '覆盖全部四区数据并列出未核事项',
    inputs: [], grantId, grantVersion: 1, status: 'authorized', createdAt: stamp, updatedAt: stamp,
  });
  return { grantId, workId };
}
async function publishSucceeded(store: Store, workId: string, revision = 1) {
  const attempt = await store.recordPublication({ workId, revision, action: 'issue-create', bodyHash: sha('issue-body') });
  await store.transitionPublication(attempt.operationId, 'submitted');
  await store.transitionPublication(attempt.operationId, 'succeeded', { resultRef: { repositoryId: 'owner/repo', issueId: '11' } });
}
async function seedClaim(store: Store, clock: { now: number }, workId: string, revision = 1) {
  return (await store.recordClaim({ workId, revision, principal: 'executor-a', leaseDeadline: new Date(clock.now + HOUR).toISOString() })).claim;
}
async function seedPreservedDelivery(store: Store, clock: { now: number }, owner: { projectId: string; taskId: string }, workId: string, revision = 1) {
  await publishSucceeded(store, workId, revision);
  const claim = await seedClaim(store, clock, workId, revision);
  const { delivery } = await store.recordPreservedDelivery({
    workId, revision, claimId: claim.claimId, epoch: claim.epoch,
    idempotencyKey: `deliver-${randomUUID()}`, manifestHash: sha('report-bytes'),
    preservation: 'preserved',
    storage: [{ logicalPath: 'report.md', relativePath: 'd/x/report.md', sha256: sha('report-bytes'), bytes: 12 }],
    facts: { done: ['整理完成'], notDone: [], failed: [], unknown: [] },
  });
  await store.recordInboxEvent({ eventKey: `evt-${randomUUID()}`, projectId: owner.projectId, taskId: owner.taskId, workId, deliveryId: delivery.deliveryId });
  return delivery;
}

const PROJECT = randomUUID();
const TASK = randomUUID();

test('S4b external resume: busy keeps the delivery pending and dispatches exactly once when idle', async t => {
  const h = await harness(); t.after(h.cleanup);
  const { workId } = await seedWork(h.store, h.clock);
  const delivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, workId);
  h.seams.busy = true;
  const busyOutcome = await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 0, 'a busy original task must not be resumed');
  assert.equal(busyOutcome.dispatched, 0);
  assert.deepEqual(busyOutcome.pending.map(item => item.reason), ['busy']);
  assert.equal((await h.store.listResumeReceipts(PROJECT, TASK)).length, 0, 'no receipt is reserved while busy');
  h.seams.busy = false;
  const idleOutcome = await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(idleOutcome.dispatched, 1);
  assert.equal(h.calls.length, 1);
  const call = h.calls[0]!;
  assert.equal(call.projectId, PROJECT);
  assert.equal(call.taskId, TASK);
  assert.deepEqual(call.origin, { userText: false }, 'resume turns are Host machine turns, never user text');
  const input = call.input as { requestId: string; text: string; externalContext: Record<string, unknown> };
  assert.equal(input.requestId, resumeRequestId(workId, 1, delivery.deliveryId), 'the stable resume requestId is derived from the delivery identity');
  assert.equal((await h.store.listResumeReceipts(PROJECT, TASK))[0]!.status, 'accepted', 'the receipt records native acceptance after dispatch');
});

test('S4b external resume: duplicate events and repeated scans never re-run the model', async t => {
  const h = await harness(); t.after(h.cleanup);
  const { workId } = await seedWork(h.store, h.clock);
  const delivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, workId);
  await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 1);
  await h.store.recordInboxEvent({ eventKey: `evt-${randomUUID()}`, projectId: PROJECT, taskId: TASK, workId, deliveryId: delivery.deliveryId });
  const replay = await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 1, 'the same delivery must not be re-dispatched from a duplicate event');
  assert.equal(replay.dispatched, 0);
  assert.equal(replay.skipped, 2, 'both recorded events for the delivered work revision are skipped once each');
  // A simulated restart (fresh coordinator over the same ledger) also skips.
  const restartedCalls: RecordedCall[] = [];
  const restarted = coordinatorFor(h.store, () => h.clock.now, {
    busy: false, available: true,
    startMessage: async (projectId, taskId, input, origin) => { restartedCalls.push({ projectId, taskId, input: input as Record<string, unknown>, origin: origin as Record<string, unknown> }); return { requestId: input.requestId, status: 'running' }; },
  });
  const afterRestart = await restarted.resumeDue(PROJECT, TASK);
  assert.equal(restartedCalls.length, 0, 'a restart must not re-run an accepted resume');
  assert.equal(afterRestart.dispatched, 0);
  assert.equal(afterRestart.skipped, 2);
  assert.equal(resumeRequestId(workId, 1, delivery.deliveryId), h.calls[0]!.input.requestId, 'the derivation is stable across coordinators');
});

test('S4b external resume: gate conditions keep unqualified deliveries pending without dispatch', async t => {
  const h = await harness(); t.after(h.cleanup);
  const reasons: string[] = [];
  const observe = async () => { const outcome = await h.coordinator.resumeDue(PROJECT, TASK); reasons.push(...outcome.pending.map(item => item.reason)); assert.equal(h.calls.length, 0, `no dispatch while pending (${reasons.at(-1)})`); };

  const cancelledWork = await seedWork(h.store, h.clock);
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, cancelledWork.workId);
  await h.store.cancelWork(cancelledWork.workId, 'user-cancelled');
  await observe();

  // Grant expired after delivery: the delivery was preserved inside the
  // window and the grant has lapsed since.
  const expiredGrant = await seedWork(h.store, h.clock);
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, expiredGrant.workId);
  h.clock.now += 2 * DAY;
  await observe();

  const manualGrant = await seedWork(h.store, h.clock, { autoResume: false });
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, manualGrant.workId);
  await observe();

  // Availability and pause are one-way within this test: both gate checks sit
  // behind the delivery/work checks, so later scenarios keep their own reasons.
  const unavailableWork = await seedWork(h.store, h.clock);
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, unavailableWork.workId);
  h.seams.available = false; h.seams.unavailableReason = 'configuration_required';
  await observe();

  const lateWork = await seedWork(h.store, h.clock);
  await publishSucceeded(h.store, lateWork.workId);
  const claim = await seedClaim(h.store, h.clock, lateWork.workId);
  await h.store.releaseClaim({ workId: lateWork.workId, revision: 1, claimId: claim.claimId, epoch: claim.epoch, reason: 'done' });
  const lateDelivery = await h.store.recordLateDelivery({ workId: lateWork.workId, revision: 1, claimId: claim.claimId, idempotencyKey: `late-${randomUUID()}`, manifestHash: sha('late-bytes') });
  await h.store.recordInboxEvent({ eventKey: `evt-${randomUUID()}`, projectId: PROJECT, taskId: TASK, workId: lateWork.workId, deliveryId: lateDelivery.delivery.deliveryId });
  await observe();

  const linkWork = await seedWork(h.store, h.clock);
  await publishSucceeded(h.store, linkWork.workId);
  const linkClaim = await seedClaim(h.store, h.clock, linkWork.workId);
  const linkDelivery = await h.store.recordPreservedDelivery({
    workId: linkWork.workId, revision: 1, claimId: linkClaim.claimId, epoch: linkClaim.epoch,
    idempotencyKey: `link-${randomUUID()}`, manifestHash: sha('link-bytes'), preservation: 'link-only',
    links: [{ logicalPath: 'report.md', url: 'https://external.example.invalid/report.md' }],
  });
  await h.store.recordInboxEvent({ eventKey: `evt-${randomUUID()}`, projectId: PROJECT, taskId: TASK, workId: linkWork.workId, deliveryId: linkDelivery.delivery.deliveryId });
  await observe();

  const reviewedWork = await seedWork(h.store, h.clock);
  const reviewedDelivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, reviewedWork.workId);
  await h.store.recordReview({ workId: reviewedWork.workId, deliveryId: reviewedDelivery.deliveryId, decision: 'accepted', reason: '满足原验收条件', deliveryHash: sha('report-bytes') });
  await observe();

  const otherTask = randomUUID();
  const foreignWork = await seedWork(h.store, h.clock, { taskId: otherTask });
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: otherTask }, foreignWork.workId);
  await h.store.recordInboxEvent({ eventKey: `evt-${randomUUID()}`, projectId: PROJECT, taskId: TASK, workId: foreignWork.workId, deliveryId: await foreignDeliveryId(h.store, foreignWork.workId) });
  await observe();

  // The persistent per-task pause gates last, ahead of availability and busy.
  const pausedWork = await seedWork(h.store, h.clock);
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, pausedWork.workId);
  await h.coordinator.pauseResume(PROJECT, TASK, 'manual-pause');
  await observe();

  assert.ok(reasons.includes('work_cancelled'));
  assert.ok(reasons.includes('grant_not_valid'));
  assert.ok(reasons.includes('auto_resume_disabled'));
  assert.ok(reasons.includes('paused'));
  assert.ok(reasons.includes('configuration_required'));
  assert.ok(reasons.includes('late'));
  assert.ok(reasons.includes('not_preserved'));
  assert.ok(reasons.includes('already_reviewed'));
  assert.ok(reasons.includes('unrelated'));
});
async function foreignDeliveryId(store: Store, workId: string): Promise<string> {
  const deliveries = await store.listDeliveries(workId);
  return deliveries.at(-1)!.deliveryId;
}

test('S4b external resume: after restart an accepted-unknown receipt is read back before anything re-runs', async t => {
  const h = await harness(); t.after(h.cleanup);
  const { workId } = await seedWork(h.store, h.clock);
  const delivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, workId);
  const requestId = resumeRequestId(workId, 1, delivery.deliveryId);
  await h.store.recordResumeReceipt({ requestId, projectId: PROJECT, taskId: TASK, workId, revision: 1, deliveryId: delivery.deliveryId });

  h.seams.nativeStatus = async () => 'completed';
  const settled = await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 0);
  assert.equal(settled.dispatched, 0);
  assert.equal((await h.store.listResumeReceipts(PROJECT, TASK))[0]!.status, 'settled');

  const second = await seedWork(h.store, h.clock);
  const secondDelivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, second.workId);
  await h.store.recordResumeReceipt({ requestId: resumeRequestId(second.workId, 1, secondDelivery.deliveryId), projectId: PROJECT, taskId: TASK, workId: second.workId, revision: 1, deliveryId: secondDelivery.deliveryId });
  h.seams.nativeStatus = async () => 'running';
  await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.store.listResumeReceipts(PROJECT, TASK)).find(receipt => receipt.requestId === resumeRequestId(second.workId, 1, secondDelivery.deliveryId))!.status, 'accepted');

  const third = await seedWork(h.store, h.clock);
  const thirdDelivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, third.workId);
  await h.store.recordResumeReceipt({ requestId: resumeRequestId(third.workId, 1, thirdDelivery.deliveryId), projectId: PROJECT, taskId: TASK, workId: third.workId, revision: 1, deliveryId: thirdDelivery.deliveryId });
  h.seams.nativeStatus = async () => { throw new Error('session_history_unavailable'); };
  const unknownOutcome = await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(unknownOutcome.pending.map(item => item.reason), ['native_status_unknown']);
  assert.equal((await h.store.listResumeReceipts(PROJECT, TASK)).find(receipt => receipt.requestId === resumeRequestId(third.workId, 1, thirdDelivery.deliveryId))!.status, 'reserved');

  const fourth = await seedWork(h.store, h.clock);
  const fourthDelivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, fourth.workId);
  void fourthDelivery;
  h.seams.nativeStatus = async () => undefined;
  await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 1, 'the scan re-dispatches the first reserved-never-accepted reservation');
  const thirdRequest = resumeRequestId(third.workId, 1, thirdDelivery.deliveryId);
  assert.equal((h.calls[0]!.input as { requestId: string }).requestId, thirdRequest, 'the reserved requestId is re-dispatched verbatim, never swapped for a fresh one');
});

test('S4b external resume: the composed input carries only the saved delivery reference and original work terms', async t => {
  const h = await harness(); t.after(h.cleanup);
  const { grantId, workId } = await seedWork(h.store, h.clock);
  const delivery = await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, workId);
  await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(h.calls.length, 1);
  const input = h.calls[0]!.input as { requestId: string; text: string; externalContext: Record<string, unknown> };
  assert.ok(input.text.length <= 20000, 'the Host-composed turn input respects the message length limit');
  for (const expected of [delivery.deliveryId, workId, 'report.md', sha('report-bytes'), '整理季度销售汇总', '覆盖全部四区数据并列出未核事项', grantId]) {
    assert.ok(input.text.includes(expected), `the composed reference includes ${expected}`);
  }
  assert.ok(input.text.includes('不是用户消息') && input.text.includes('不是系统指令'), 'the composed text is explicitly marked as neither user message nor system instruction');
  assert.deepEqual(input.externalContext, { workId, revision: 1, deliveryId: delivery.deliveryId, deliveryHash: sha('report-bytes'), grantId, grantVersion: 1 });
  assert.equal(input.requestId, resumeRequestId(workId, 1, delivery.deliveryId));
  assert.notEqual(resumeRequestId(workId, 1, randomUUID()), input.requestId);
  assert.match(input.requestId, /^[a-f0-9-]{36}$/, 'the resume requestId is a valid message requestId');
});

test('S4b external resume: pause state, receipt transitions and legacy ledgers stay durable and guarded', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-pause-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const dataRoot = path.join(root, 'host');
  const store = new ExternalWorkStore({ dataRoot, instance: 'pause-1' });
  await store.init();
  const projectId = randomUUID(), taskId = randomUUID();
  const paused = await store.pauseResume({ projectId, taskId, reason: 'task-stop' });
  assert.equal(paused.reason, 'task-stop');
  await store.pauseResume({ projectId, taskId, reason: 'manual' });
  assert.equal((await store.getResumePause(projectId, taskId))!.reason, 'manual', 'pause upserts the single per-task record');
  const reopened = new ExternalWorkStore({ dataRoot, instance: 'pause-2', now: () => clock.now });
  await reopened.init();
  assert.equal((await reopened.getResumePause(projectId, taskId))!.reason, 'manual');
  assert.deepEqual((await reopened.listResumePauses()).map(record => record.taskId), [taskId]);
  const removed = await reopened.resumeResume({ projectId, taskId });
  assert.ok(removed);
  assert.equal(await reopened.getResumePause(projectId, taskId), null);
  assert.equal(await reopened.resumeResume({ projectId, taskId }), null);

  // Receipt transition guards.
  const clock = { now: 1_700_000_000_000 };
  const { workId } = await seedWork(reopened, clock);
  const delivery = await seedPreservedDelivery(reopened, clock, { projectId, taskId }, workId);
  const receiptId = resumeRequestId(workId, 1, delivery.deliveryId);
  await reopened.recordResumeReceipt({ requestId: receiptId, projectId, taskId, workId, revision: 1, deliveryId: delivery.deliveryId });
  await reopened.transitionResumeReceipt(receiptId, 'accepted');
  await reopened.transitionResumeReceipt(receiptId, 'settled');
  await assert.rejects(reopened.transitionResumeReceipt(receiptId, 'accepted'), (error: { code?: string }) => error?.code === 'external_resume_transition_forbidden');
  await assert.rejects(reopened.transitionResumeReceipt(randomUUID(), 'accepted'), (error: { code?: string }) => error?.code === 'external_resume_not_found');

  // Old ledgers without the new optional keys keep parsing (compatibility).
  const legacyRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-legacy-'));
  t.after(async () => { await rm(legacyRoot, { recursive: true, force: true }); });
  const legacyDataRoot = path.join(legacyRoot, 'host');
  const legacyStore = new ExternalWorkStore({ dataRoot: legacyDataRoot, instance: 'legacy-1' });
  await legacyStore.init();
  const ledgerPath = path.join(legacyDataRoot, 'external-work', 'ledger.json');
  const raw = JSON.parse(await readFile(ledgerPath, 'utf8')) as Record<string, unknown>;
  delete raw.resumePauses; delete raw.stopRequests;
  await writeFile(ledgerPath, JSON.stringify(raw) + '\n');
  const legacyReopened = new ExternalWorkStore({ dataRoot: legacyDataRoot, instance: 'legacy-2' });
  await legacyReopened.init();
  await legacyReopened.pauseResume({ projectId, taskId, reason: 'after-upgrade' });
  assert.equal((await legacyReopened.getResumePause(projectId, taskId))!.reason, 'after-upgrade');
});

test('S4b external resume: listResumeTargets and scanAll only touch tasks with recorded events', async t => {
  const h = await harness(); t.after(h.cleanup);
  assert.deepEqual(await h.store.listResumeTargets(), []);
  const { workId } = await seedWork(h.store, h.clock);
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, workId);
  const otherProject = randomUUID(), otherTask = randomUUID();
  const foreignWork = await seedWork(h.store, h.clock, { projectId: otherProject, taskId: otherTask });
  await seedPreservedDelivery(h.store, h.clock, { projectId: otherProject, taskId: otherTask }, foreignWork.workId);
  const targets = await h.store.listResumeTargets();
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map(target => [target.projectId, target.taskId]).sort(), [[PROJECT, TASK], [otherProject, otherTask]].sort());
  await h.coordinator.scanAll();
  assert.equal(h.calls.length, 2, 'scanAll dispatches each recorded target once');
});

test('S4b cancelWork: claims are revoked and the external stop request is recorded honestly', async t => {
  const h = await harness(); t.after(h.cleanup);
  const profiles = { profiles: () => ({ externalDispatchAllowed: true }), qualifyAssets: () => new Set<string>() } as const;
  const dispatch = new ExternalDispatch({ store: h.store, ...profiles });
  const { workId } = await seedWork(h.store, h.clock);
  await publishSucceeded(h.store, workId);
  const claim = await seedClaim(h.store, h.clock, workId);
  const result = await dispatch.cancelWork(workId, 'user-cancelled');
  assert.equal(result.work.status, 'cancelled');
  assert.equal(result.stopRequest.status, 'unsupported', 'without an injected stop seam the request is recorded as unsupported, never as stopped');
  assert.equal((await h.store.listClaims(workId)).find(item => item.claimId === claim.claimId)!.status, 'revoked');

  const confirming = new ExternalDispatch({ store: h.store, ...profiles, requestExternalStop: async () => ({ outcome: 'confirmed' }) });
  const workB = await seedWork(h.store, h.clock);
  await publishSucceeded(h.store, workB.workId);
  const confirmed = await confirming.cancelWork(workB.workId, 'user-cancelled');
  assert.equal(confirmed.stopRequest.status, 'confirmed');

  const uncertain = new ExternalDispatch({ store: h.store, ...profiles, requestExternalStop: async () => ({ outcome: 'unknown' }) });
  const workC = await seedWork(h.store, h.clock);
  await publishSucceeded(h.store, workC.workId);
  const unknownResult = await uncertain.cancelWork(workC.workId, 'user-cancelled');
  assert.equal(unknownResult.stopRequest.status, 'unknown', 'an unconfirmed external stop is pending verification, not reported as stopped');
  const seamCalls: string[] = [];
  const throwing = new ExternalDispatch({
    store: h.store, ...profiles,
    requestExternalStop: async () => { seamCalls.push(workC.workId); throw new Error('transport down'); },
  });
  const retried = await throwing.cancelWork(workC.workId, 'user-cancelled-again');
  assert.equal(retried.stopRequest.status, 'unknown', 'a failing stop request stays pending verification');
  assert.equal((await h.store.listStopRequests(workC.workId)).length, 1);
  const again = await throwing.cancelWork(workC.workId, 'repeat');
  assert.equal(seamCalls.length, 0, 'already-recorded terminal stop requests are not re-sent');
  assert.equal(again.stopRequest.status, 'unknown');
  assert.equal(again.work.status, 'cancelled');
});

test('S4b external resume: a delivery arriving for a cancelled work never revives the authorization', async t => {
  const h = await harness(); t.after(h.cleanup);
  const { workId } = await seedWork(h.store, h.clock);
  await seedPreservedDelivery(h.store, h.clock, { projectId: PROJECT, taskId: TASK }, workId);
  await h.store.cancelWork(workId, 'user-cancelled');
  const outcome = await h.coordinator.resumeDue(PROJECT, TASK);
  assert.equal(outcome.dispatched, 0);
  assert.deepEqual(outcome.pending.map(item => item.reason), ['work_cancelled']);
  assert.equal((await h.store.listResumeReceipts(PROJECT, TASK)).length, 0);
});

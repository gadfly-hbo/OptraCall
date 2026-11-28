import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { resumeRequestId } from '../src/host/external-resume.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const HOUR = 3_600_000;

type Seeded = { grantId: string; workId: string; deliveryId: string; deliveryHash: string };
/** Seed one published→claimed→preserved external delivery plus its inbox event, through the public ledger API. */
async function seedExternalDelivery(dataRoot: string, owner: { projectId: string; taskId: string }): Promise<Seeded> {
  const store = new ExternalWorkStore({ dataRoot });
  await store.init();
  const grantId = randomUUID(), workId = randomUUID();
  const now = Date.now(), stamp = new Date(now).toISOString();
  await store.createGrantWithWork({
    grantId, grantVersion: 1, projectId: owner.projectId, taskId: owner.taskId,
    goal: '核对已保全外部交付', scope: '按原验收条件核验', forbidden: '',
    allowedExecutors: ['executor-a'],
    repository: { stableId: 'owner/repo', visibility: 'private' },
    assetRefs: [], enterprise: 'ent-1',
    validFrom: stamp, validUntil: new Date(now + 24 * HOUR).toISOString(),
    resourcePolicy: { maxWorks: 1, windowHours: 24 }, autoResumeAllowed: true, createdAt: stamp,
  }, {
    workId, projectId: owner.projectId, taskId: owner.taskId, revision: 1,
    summary: '整理季度销售汇总', deliveryCriteria: '覆盖全部四区数据并列出未核事项',
    inputs: [], grantId, grantVersion: 1, status: 'authorized', createdAt: stamp, updatedAt: stamp,
  });
  const attempt = await store.recordPublication({ workId, revision: 1, action: 'issue-create', bodyHash: sha('issue-body') });
  await store.transitionPublication(attempt.operationId, 'submitted');
  await store.transitionPublication(attempt.operationId, 'succeeded', { resultRef: { repositoryId: 'owner/repo', issueId: '11' } });
  const { claim } = await store.recordClaim({ workId, revision: 1, principal: 'executor-a', leaseDeadline: new Date(now + HOUR).toISOString() });
  const deliveryHash = sha('report-bytes');
  const { delivery } = await store.recordPreservedDelivery({
    workId, revision: 1, claimId: claim.claimId, epoch: claim.epoch,
    idempotencyKey: `deliver-${randomUUID()}`, manifestHash: deliveryHash, preservation: 'preserved',
    storage: [{ logicalPath: 'report.md', relativePath: 'd/x/report.md', sha256: sha('report-bytes'), bytes: 12 }],
    facts: { done: ['整理完成'], notDone: [], failed: [], unknown: [] },
  });
  await store.recordInboxEvent({ eventKey: `evt-${randomUUID()}`, projectId: owner.projectId, taskId: owner.taskId, workId, deliveryId: delivery.deliveryId });
  return { grantId, workId, deliveryId: delivery.deliveryId, deliveryHash };
}

type TestHost = Awaited<ReturnType<typeof startTestHost>>;
async function waitForCompletion(host: TestHost, route: string, previousRequestId?: string, timeoutMs = 20_000): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs;
  let state: Record<string, any> = {};
  do {
    const response = await host.request(route);
    assert.equal(response.status, 200, await response.clone().text());
    state = await response.json();
    const run = state.task?.lastRun;
    if (run && run.id !== previousRequestId && run.status !== 'running') break;
    if (run && run.id === previousRequestId && ['completed', 'cancelled', 'failed'].includes(run.status)) break;
    await delay(25);
  } while (Date.now() < deadline);
  return state;
}

function readRunMarkers(entries: Record<string, any>[], requestId: string) {
  const started = entries.find(entry => entry.customType === 'optracall.run' && entry.data?.requestId === requestId && (entry.data.phase === 'started' || entry.data.phase === undefined));
  const settled = entries.find(entry => entry.customType === 'optracall.run' && entry.data?.requestId === requestId && entry.data.phase === 'settled');
  return { started, settled };
}

test('S4b/AB13: a preserved external delivery resumes the same owner task once with the external identity in fingerprint and providedContext', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-resume-host-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  const provider = await startToolProvider();
  t.after(async () => { await provider.close(); });
  const host1 = await startTestHost({ dataRoot, projectsRoot });
  t.after(async () => { await host1.close().catch(() => {}); });
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', body?: unknown, status = 200) => { const response = await host1.request(route, method, body); assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成续接', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-resume', apiKey: 'synthetic-resume-only' });
  const { project } = await request('/api/projects', 'POST', { name: '外派续接宿主夹具' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' }, 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  provider.setResponder(() => ({ text: '已读取交付引用，将按验收条件核验并保留未核事项。' }));

  const seeded = await seedExternalDelivery(dataRoot, { projectId: project.id, taskId: task.id });
  const expectedRequestId = resumeRequestId(seeded.workId, 1, seeded.deliveryId);

  // The first host's startup scan ran before seeding: nothing dispatched yet.
  const beforeRestart = await request(route);
  assert.notEqual(beforeRestart.task.lastRun?.id, expectedRequestId);

  await host1.close();
  const host2 = await startTestHost({ dataRoot, projectsRoot });
  t.after(async () => { await host2.close().catch(() => {}); });

  const state = await waitForCompletion(host2, route);
  assert.equal(state.task.lastRun?.id, expectedRequestId, 'the resume turn uses the stable delivery-derived requestId');
  assert.equal(state.task.lastRun?.status, 'completed', 'the resumed turn completes against the synthetic model');

  const entries = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const { started, settled } = readRunMarkers(entries, expectedRequestId);
  assert.ok(started, 'the resume turn wrote a native started marker');
  assert.ok(typeof started.data.requestFingerprint === 'string' && /^[a-f0-9]{64}$/.test(started.data.requestFingerprint), 'the native marker records the request fingerprint');
  const context = started.data.providedContext ?? {};
  assert.equal(context.userQuoteEligible, false, 'external resume input never gains user-quote eligibility');
  assert.equal(typeof context.originalUserText, 'string');
  assert.ok(context.originalUserText.includes(seeded.deliveryId) && context.originalUserText.includes('不是用户消息'), 'originalUserText is the Host delivery reference, not raw external text');
  assert.deepEqual(context.external, { kind: 'external-delivery', workId: seeded.workId, revision: 1, deliveryId: seeded.deliveryId, deliveryHash: seeded.deliveryHash, grantId: seeded.grantId, grantVersion: 1 });
  assert.ok(settled && settled.data.outcome === 'completed', 'the resumed turn settled completed');

  // The Host never fabricates an Agent review for the delivery.
  const reopenedLedger = new ExternalWorkStore({ dataRoot });
  await reopenedLedger.init();
  const reviews = await reopenedLedger.listReviews(seeded.workId);
  assert.equal(reviews.length, 0, 'no ReviewDecision is auto-recorded; verification belongs to the original Agent');
  const receipts = await reopenedLedger.listResumeReceipts(project.id, task.id);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.requestId, expectedRequestId);
  assert.equal(receipts[0]!.status, 'accepted');

  // Same requestId + same text + same external identity replays deduplicate; dropping the external identity conflicts.
  const replay = await host2.request(`${route}/messages`, 'POST', { requestId: expectedRequestId, text: context.originalUserText, externalContext: { workId: seeded.workId, revision: 1, deliveryId: seeded.deliveryId, deliveryHash: seeded.deliveryHash, grantId: seeded.grantId, grantVersion: 1 } });
  assert.equal(replay.status, 202, await replay.clone().text());
  assert.equal((await replay.json()).deduplicated, true, 'an identical resume replay deduplicates on the recorded fingerprint');
  const conflicting = await host2.request(`${route}/messages`, 'POST', { requestId: expectedRequestId, text: context.originalUserText });
  assert.equal(conflicting.status, 409, await conflicting.clone().text());
  assert.equal((await conflicting.json()).code, 'operation_conflict', 'the same text without the external identity is a different request, never deduplicated');
});

test('S4b/AB14: the public stop route pauses automatic resume persistently while a stale cleanup request never pauses', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-resume-stop-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  const host1 = await startTestHost({ dataRoot, projectsRoot });
  t.after(async () => { await host1.close().catch(() => {}); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200) => { const response = await host1.request(route, method, body); assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成停止夹具', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-stop', apiKey: 'synthetic-stop-only' });
  const { project } = await request('/api/projects', 'POST', { name: '外派停止宿主夹具' }, 201);
  const { task: a } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '任务A' }, 201);
  const { task: b } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '任务B' }, 201);

  const stopA = await request(`/api/projects/${project.id}/tasks/${a.id}/stop`, 'POST', {});
  assert.equal(stopA.stopped, true);
  const stopB = await host1.request(`/api/projects/${project.id}/tasks/${b.id}/stop`, 'POST', { cleanupRequestId: 'stale-recovery-click' });
  assert.equal(stopB.status, 200);
  assert.equal((await stopB.json()).stopped, false, 'a stale cleanup request stops nothing');

  let ledger = new ExternalWorkStore({ dataRoot }); await ledger.init();
  const pausedAfterStop = await ledger.getResumePause(project.id, a.id);
  assert.ok(pausedAfterStop, 'the plain stop records the persistent per-task resume pause');
  assert.equal(pausedAfterStop!.reason, 'task-stop');
  assert.equal(await ledger.getResumePause(project.id, b.id), null, 'the stale cleanup request never touches the pause state');

  // A delivery arriving for the paused task is kept pending across restarts: no dispatch, no receipt.
  await seedExternalDelivery(dataRoot, { projectId: project.id, taskId: a.id });
  await host1.close();
  const host2 = await startTestHost({ dataRoot, projectsRoot });
  t.after(async () => { await host2.close().catch(() => {}); });
  await delay(2_500);
  ledger = new ExternalWorkStore({ dataRoot }); await ledger.init();
  const pauseAfterRestart = await ledger.getResumePause(project.id, a.id);
  assert.ok(pauseAfterRestart, 'the pause survives the restart');
  const receipts = await ledger.listResumeReceipts(project.id, a.id);
  assert.equal(receipts.length, 0, 'a paused task is never auto-resumed');
  const request2 = async (route: string, method = 'GET', body?: unknown, status = 200) => { const response = await host2.request(route, method, body); assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`); return response.json(); };
  const refreshed = await request2(`/api/projects/${project.id}/tasks/${a.id}`);
  assert.equal(refreshed.task.lastRun, undefined, 'no model turn was started for the paused task');
});

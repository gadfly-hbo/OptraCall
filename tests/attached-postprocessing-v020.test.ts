import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createVerificationStore, type CreateVerificationInput } from '../src/host/verification-store.ts';
import { createVerificationSessions } from '../src/host/verification-sessions.ts';
import { createSapMethodFeature } from '../src/host/sap-method-feature.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import type { ProjectRecord, TaskRecord } from '../src/host/project-store.ts';
import { createAgentSessionDomain, type SessionCleanupRequest } from '../src/host/agent-sessions.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

function parentQualification() {
  const context = Object.freeze({ qualification: randomUUID() });
  let current = true;
  const cancellations = new Set<(request: SessionCleanupRequest) => void | Promise<void>>();
  const assertCurrent = async () => { if (!current) throw Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' }); };
  return {
    context, assertCurrent,
    onCancel(handler: (request: SessionCleanupRequest) => void | Promise<void>) {
      if (!current) throw new Error('generation_cancelled');
      cancellations.add(handler); return () => { cancellations.delete(handler); };
    },
    async admit(supplied: unknown) { assert.equal(supplied, context, 'only the injected exact parent context qualifies'); await assertCurrent(); },
    async cancel() { current = false; await Promise.all([...cancellations].map(handler => handler({ retryFailed: false }))); },
    registered: () => cancellations.size,
  };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

async function environment(t: TestContext) {
  const directory = path.resolve('.local/overall-architecture-upgrade/development/attached-postprocessing');
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'synthetic-')), resourceRoot = path.join(root, 'pi');
  await mkdir(resourceRoot); await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider();
  const configuration = { id: 'synthetic-attached', revision: 1, name: 'Synthetic attached', provider: 'synthetic', api: 'openai-completions' as const, baseUrl: provider.baseUrl, model: 'synthetic-attached', apiKey: 'synthetic-attached-key' };
  let queued: Promise<unknown> = Promise.resolve();
  const mutate = <T>(operation: () => T | Promise<T>): Promise<T> => { const next = queued.then(operation); queued = next.catch(() => {}); return next; };
  t.after(() => provider.close());
  t.diagnostic(root);
  return { root, resourceRoot, provider, configuration, mutate };
}

async function reviews(t: TestContext) {
  const env = await environment(t), baseStore = createVerificationStore({ dataRoot: env.root });
  let beforeUpdate = async (_owner: Parameters<typeof baseStore.update>[0], _patch: Parameters<typeof baseStore.update>[1]) => {};
  // Schedule the real store port, not the SDK/domain. The original durable update
  // still performs every read/write and remains the only state authority.
  const store = { ...baseStore, update: async (...args: Parameters<typeof baseStore.update>) => { await beforeUpdate(...args); return baseStore.update(...args); } };
  const projectId = randomUUID(), parent = parentQualification(), inputs = new Map<string, CreateVerificationInput>();
  let originalBusy = true;
  let beforePrepare = async () => {};
  const unavailable = async (): Promise<never> => { throw new Error('legacy path not authorized'); };
  const feature = createVerificationSessions({ store, codeRoot: process.cwd(), resourceRoot: env.resourceRoot, managementPorts: () => [], configuration: () => env.configuration,
    mutate: env.mutate, isClosing: () => false, admit: async () => {}, admitRevision: unavailable, admitRecheck: unavailable, assertInputs: unavailable,
    stopAuthor: unavailable, prepareRevision: unavailable, projectIds: async () => [projectId], prepare: unavailable, revise: unavailable, export: unavailable,
    conclusionReview: {
      admit: async (_owner: unknown, context?: unknown) => { if (context !== undefined) await parent.admit(context); else if (originalBusy) throw Object.assign(new Error('session_busy'), { code: 'session_busy' }); },
      assertAuthorized: async () => {}, prepare: async (_projectId, _taskId, selection) => { await beforePrepare(); return inputs.get(selection.verificationId)!; },
    },
  });
  const make = (taskId: string = randomUUID()) => {
    const reportText = 'Synthetic bounded report.', sha256 = createHash('sha256').update(reportText).digest('hex'), verificationId = randomUUID();
    const report = { relativePath: `060_reports/${verificationId}.md`, sha256, bytes: Buffer.byteLength(reportText) };
    const selection = { verificationId, report: { relativePath: report.relativePath, sha256 } };
    const input: CreateVerificationInput = { projectId, taskId, verificationId, mode: 'conclusion-review', question: 'Review the fixed report', selection,
      configuration: env.configuration, dataFiles: [], authorFiles: [{ relativePath: report.relativePath, bytes: Buffer.from(reportText) }],
      review: { schemaVersion: 1, report, materials: [{ id: 'report', kind: 'report', locator: report.relativePath, sha256, bytes: report.bytes, state: 'provided' }], providedText: JSON.stringify({ report, content: [{ id: 'report', text: reportText }] }) },
    };
    inputs.set(verificationId, input);
    return { input, selection };
  };
  env.provider.setResponder(({ messages }) => {
    const text = providerMessageText([...messages].reverse().find(message => message.role === 'user')?.content);
    const packet = JSON.parse(text);
    return { text: JSON.stringify({ schemaVersion: 1, reportVersion: packet.report.sha256, claims: [], scope: { reviewed: 'Synthetic fixed report', unreviewed: [], limitations: ['No professional validation.'] } }) };
  });
  t.after(() => feature.closeAll());
  return { ...env, feature, store, parent, make, manualIdle: () => { originalBusy = false; }, beforePrepare: (run: () => Promise<void>) => { beforePrepare = run; }, beforeUpdate: (run: typeof beforeUpdate) => { beforeUpdate = run; } };
}

test('M4 attached review waits for saved result; manual busy remains and stopped parent cannot dispatch another review', { timeout: 30_000 }, async t => {
  const f = await reviews(t), item = f.make();
  await assert.rejects(f.feature.startReview(item.input.projectId, item.input.taskId, item.selection), { code: 'session_busy' });
  const result = await f.feature.runReviewForParent(item.input.projectId, item.input.taskId, item.selection, f.parent);
  assert.equal(result.review.state, 'completed');
  assert.equal(result.review.reviewResult!.output.reportVersion, item.selection.report.sha256);
  assert.equal(await f.feature.busy(item.input.projectId, item.input.taskId), false, 'completion includes retirement of the original child domain');
  const replay = await f.feature.runReviewForParent(item.input.projectId, item.input.taskId, item.selection, f.parent);
  assert.equal(replay.created, false); assert.equal(f.provider.requests.length, 1);
  await f.parent.cancel();
  const later = f.make(item.input.taskId);
  await assert.rejects(f.feature.runReviewForParent(later.input.projectId, later.input.taskId, later.selection, f.parent), /generation_cancelled/);
  assert.equal(f.provider.requests.length, 1);
});

test('M4 stopForTask revokes only matching review and leaves the other Task in flight', { timeout: 30_000 }, async t => {
  const f = await reviews(t), a = f.make(), b = f.make(); f.manualIdle();
  f.provider.setResponder(() => ({ text: 'held synthetic review', hold: true }));
  await f.feature.startReview(a.input.projectId, a.input.taskId, a.selection);
  await f.feature.startReview(b.input.projectId, b.input.taskId, b.selection);
  await f.provider.waitForRequests(2);
  await f.feature.stopForTask(a.input.projectId, a.input.taskId);
  assert.equal((await f.store.read(a.input)).state, 'cancelled');
  assert.equal(f.feature.busyForTask(a.input.projectId, a.input.taskId), false);
  assert.equal(f.feature.busyForTask(b.input.projectId, b.input.taskId), true);
  assert.equal((await f.store.read(b.input)).state, 'running');
  await f.feature.stopForTask(b.input.projectId, b.input.taskId);
});

test('M4 parent cancellation during preparation does not create or dispatch a late review', { timeout: 30_000 }, async t => {
  const f = await reviews(t), item = f.make(), entered = deferred(), release = deferred();
  f.beforePrepare(async () => { entered.resolve(); await release.promise; });
  const running = f.feature.runReviewForParent(item.input.projectId, item.input.taskId, item.selection, f.parent);
  const rejected = assert.rejects(running, /generation_cancelled/);
  await entered.promise; await f.parent.cancel(); release.resolve(); await rejected;
  assert.equal(f.provider.requests.length, 0);
  assert.equal((await f.store.listForManagement(item.input.projectId, item.input.taskId)).length, 0);
});

test('M4 parent cancellation drains the attached review while an unrelated Task stays running', { timeout: 30_000 }, async t => {
  const f = await reviews(t), a = f.make(), b = f.make();
  f.provider.setResponder(() => ({ text: 'held synthetic review', hold: true }));
  const attached = f.feature.runReviewForParent(a.input.projectId, a.input.taskId, a.selection, f.parent);
  await f.provider.waitForRequests(1); f.manualIdle();
  await f.feature.startReview(b.input.projectId, b.input.taskId, b.selection); await f.provider.waitForRequests(2);
  await f.parent.cancel();
  assert.equal((await attached).review.state, 'cancelled');
  assert.equal(f.feature.busyForTask(a.input.projectId, a.input.taskId), false);
  assert.equal(f.feature.busyForTask(b.input.projectId, b.input.taskId), true);
  await f.feature.stopForTask(b.input.projectId, b.input.taskId);
});

test('M4 attached receipt waits for its original in-progress cancellation to reach the real store', { timeout: 30_000 }, async t => {
  const f = await reviews(t), item = f.make(), entered = deferred(), release = deferred();
  f.provider.setResponder(() => ({ text: 'held original review', hold: true }));
  let cancellationWriteReleased = false, returnedWhileWritePaused = false;
  const attached = f.feature.runReviewForParent(item.input.projectId, item.input.taskId, item.selection, f.parent).then(result => { returnedWhileWritePaused = !cancellationWriteReleased; return result; });
  await f.provider.waitForRequests(1);
  f.beforeUpdate(async (owner, patch) => { if (owner.verificationId === item.input.verificationId && patch.state === 'cancelled') { entered.resolve(); await release.promise; cancellationWriteReleased = true; } });
  const cancelling = f.parent.cancel();
  await entered.promise;
  let pending: boolean;
  try {
    pending = await Promise.race([attached.then(() => false), new Promise<boolean>(resolve => setTimeout(() => resolve(true), 150))]);
  } finally { release.resolve(); await cancelling; }
  const result = await attached;
  await writeFile(path.join(f.root, 'cancellation-schedule.json'), JSON.stringify({ cancellationCommitPaused: true, attachedStayedPending: pending, returnedWhileWritePaused, returnedState: result.review.state, storedState: (await f.store.read(item.input)).state }, null, 2));
  assert.equal(pending, true, 'returning running while the original cancellation is still committing exposes a stale receipt');
  assert.equal(returnedWhileWritePaused, false); assert.equal(result.review.state, 'cancelled');
  assert.equal((await f.store.read(item.input)).state, 'cancelled'); assert.equal(f.feature.busyForTask(item.input.projectId, item.input.taskId), false);
});

test('M4 public parent explicit close retries only the failed original cancellation while automatic cleanup preserves it', { timeout: 30_000 }, async t => {
  const f = await reviews(t), item = f.make();
  f.provider.setResponder(() => ({ text: 'held original review', hold: true }));
  let cancellationWrites = 0;
  const retryEntered = deferred(), releaseRetry = deferred();
  f.beforeUpdate(async (_owner, patch) => {
    if (patch.state !== 'cancelled') return;
    cancellationWrites++;
    if (cancellationWrites === 1) throw Object.assign(new Error('Synthetic transient cancellation write failure'), { code: 'synthetic_write_failure' });
    if (cancellationWrites === 2) { retryEntered.resolve(); await releaseRetry.promise; }
  });
  const domain = createAgentSessionDomain<string>({ name: 'attached-review-public-parent-test', profile: {
    key: owner => owner, projectId: () => item.input.projectId, configuration: () => f.configuration,
    agentOptions: () => ({ projectId: item.input.projectId, taskId: item.input.taskId, codeRoot: process.cwd(), resourceRoot: f.resourceRoot, sessionDirectory: path.join(f.root, 'unused-parent-native'), managementPorts: [] }),
  }, configurationSnapshot: () => f.configuration, mutate: f.mutate, isClosing: () => false });
  const ref = domain.ref('original-parent');
  const running = domain.withSession(ref, lease => f.feature.runReviewForParent(item.input.projectId, item.input.taskId, item.selection, {
    context: f.parent.context, onCancel: lease.onCancel,
    assertCurrent: async () => { if (!domain.owns(ref, lease.context)) throw Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' }); },
  }));
  const settled = running.then(result => ({ result }), error => ({ error: String(error) }));
  await f.provider.waitForRequests(1);
  await assert.rejects(domain.stop(ref), /session_child_stop_failed/);
  const originalOutcome = await settled;
  assert.ok('error' in originalOutcome); assert.equal(domain.busy(ref), true); assert.equal((await f.store.read(item.input)).state, 'running');
  await assert.rejects(domain.close(ref, { retryFailed: false }), /session_close_failed/);
  assert.equal(cancellationWrites, 1, 'automatic cleanup cannot authorize another failed cleanup attempt');
  const beforeRetry = { busy: domain.busy(ref), cancellationWrites, state: (await f.store.read(item.input)).state };
  let retryError: string | null = null;
  const retry = domain.close(ref, { retryFailed: true });
  const retryReachedStore = await Promise.race([retryEntered.promise.then(() => true), retry.then(() => false, () => false)]);
  let concurrentRetry: Promise<void> | undefined;
  try {
    if (retryReachedStore) {
      concurrentRetry = domain.close(ref, { retryFailed: true });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(cancellationWrites, 2, 'concurrent explicit close shares the in-flight original retry');
      assert.equal(domain.busy(ref), true);
    }
  } finally { releaseRetry.resolve(); }
  try { await Promise.all([retry, concurrentRetry]); } catch (error) { retryError = String(error); }
  const afterRetry = { busy: domain.busy(ref), cancellationWrites, state: (await f.store.read(item.input)).state };
  await writeFile(path.join(f.root, 'explicit-retry-evidence.json'), JSON.stringify({ originalOutcome, beforeRetry, retryReachedStore, concurrentRetryShared: Boolean(concurrentRetry) && Number(cancellationWrites) === 2, retryError, afterRetry, providerRequests: f.provider.requests.length, providerErrors: f.provider.errors }, null, 2));
  assert.equal(retryError, null, 'the trusted public parent retry must retry the failed cleanup rather than its rejected Promise');
  assert.equal(afterRetry.busy, false); assert.equal(afterRetry.state, 'cancelled'); assert.equal(cancellationWrites, 2);
  await domain.close(ref, { retryFailed: true }); assert.equal(cancellationWrites, 2, 'successful cleanup does not repeat');
  assert.equal(f.provider.requests.length, 1, 'cleanup retry never starts another model run'); assert.deepEqual(f.provider.errors, []);
});

async function methods(t: TestContext) {
  const env = await environment(t), projectId = randomUUID(), parent = parentQualification();
  const store = createSapMethodStore(path.join(env.root, 'metric-assets')), tasks = new Map<string, TaskRecord>();
  const project: ProjectRecord = { schemaVersion: 2, id: projectId, name: 'Synthetic', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), configuration: env.configuration, uploads: [], archivedAt: null, tasks: [], rootPath: env.root };
  const make = async () => {
    const id = randomUUID(), directory = path.join(env.root, 'tasks', id), sessionFile = path.join(directory, 'source.jsonl'); await mkdir(directory, { recursive: true });
    await writeFile(sessionFile, [
      { type: 'session', version: 3, id, timestamp: '2026-11-16T10:00:00.000Z', cwd: path.join(env.root, '020_clean') },
      { type: 'message', id: 'source-1', parentId: null, timestamp: '2026-11-16T10:00:01.000Z', message: { role: 'assistant', content: 'Synthetic source with no transferable method.' } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const task: TaskRecord = { id, name: 'Synthetic task', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), draft: '', configuration: env.configuration, sessionStorage: 'task', sessionDirectory: directory, sessionFile,
      lastRun: { id: randomUUID(), status: 'completed', startedAt: '2026-11-16T10:00:00.000Z', settledAt: '2026-11-16T10:00:01.000Z' } };
    tasks.set(id, task); project.tasks.push(task); return task;
  };
  let originalBusy = true;
  const feature = createSapMethodFeature({ dataRoot: env.root, codeRoot: process.cwd(), resourceRoot: env.resourceRoot, store, managementPorts: () => [],
    configurationSnapshot: () => env.configuration, pair: async (p, t) => { assert.equal(p, projectId); return { project, task: tasks.get(t)! }; },
    sourceBusy: () => originalBusy, parentAdmit: async (_p: string, _t: string, context: unknown) => parent.admit(context),
    mutate: env.mutate, isClosing: () => false, personal: async () => { throw new Error('unused'); }, methods: async () => { throw new Error('unused'); },
    readBody: async request => (request as IncomingMessage & { input: Record<string, unknown> }).input,
  } as Parameters<typeof createSapMethodFeature>[0]);
  env.provider.setResponder(() => ({ text: JSON.stringify({ kind: 'none', reason: 'No transferable method in this synthetic source.' }) }));
  const request = (taskId: string, input: Record<string, unknown>) => feature.handle({ method: 'POST', input } as unknown as IncomingMessage, new URL(`http://localhost/api/projects/${projectId}/tasks/${taskId}/sap-method-extractions`));
  t.after(async () => { await feature.closeAll(); await feature.flushReceipts(); });
  return { ...env, feature, parent, store, make, projectId, request, manualIdle: () => { originalBusy = false; } };
}

test('M5 attached IR awaits its original receipt, preserves manual busy and cannot run after parent stop', { timeout: 30_000 }, async t => {
  const f = await methods(t), task = await f.make(), input = { requestId: randomUUID(), incomplete: false };
  const manual = await f.request(task.id, input); assert.equal(manual?.status, 409); assert.equal((manual?.value as any).code, 'METHOD_SOURCE_BUSY');
  const result = await f.feature.runForParent(f.projectId, task.id, input, f.parent);
  assert.equal(result.status, 'empty'); assert.equal(f.feature.busyForTask(f.projectId, task.id), false);
  assert.equal((await f.feature.runForParent(f.projectId, task.id, input, f.parent)).requestId, input.requestId);
  assert.equal(f.provider.requests.length, 1); assert.equal(f.store.list().length, 0);
  await f.parent.cancel();
  await assert.rejects(f.feature.runForParent(f.projectId, task.id, { ...input, requestId: randomUUID() }, f.parent), /generation_cancelled/);
  assert.equal(f.provider.requests.length, 1);
});

test('M5 parent stop cancels attached IR and exact Task stop leaves unrelated IR running', { timeout: 30_000 }, async t => {
  const f = await methods(t), a = await f.make(), b = await f.make();
  f.provider.setResponder(() => ({ text: 'held synthetic IR', hold: true }));
  const attached = f.feature.runForParent(f.projectId, a.id, { requestId: randomUUID(), incomplete: false }, f.parent);
  await f.provider.waitForRequests(1);
  f.manualIdle(); const otherRequest = randomUUID(); assert.equal((await f.request(b.id, { requestId: otherRequest, incomplete: false }))?.status, 202);
  await f.provider.waitForRequests(2);
  await f.parent.cancel(); const result = await attached;
  assert.equal(result.status, 'cancelled'); assert.equal(f.feature.busyForTask(f.projectId, a.id), false);
  assert.equal(f.feature.busyForTask(f.projectId, b.id), true); assert.equal(f.store.list().length, 0);
  await f.feature.stopForTask(f.projectId, b.id);
  assert.equal(f.feature.busyForTask(f.projectId, b.id), false);
});

test('M5 parent qualification cannot bypass an unsettled original run or arrive through HTTP input', { timeout: 30_000 }, async t => {
  const f = await methods(t), task = await f.make(); task.lastRun!.status = 'running';
  const input = { requestId: randomUUID(), incomplete: true };
  await assert.rejects(f.feature.runForParent(f.projectId, task.id, input, f.parent), { code: 'METHOD_SOURCE_INCOMPLETE' });
  const forged = await f.request(task.id, { ...input, parentContext: f.parent.context });
  assert.equal(forged?.status, 400); assert.equal((forged?.value as { code: string }).code, 'METHOD_INPUT_INVALID');
  assert.equal(f.provider.requests.length, 0); assert.equal(f.store.list().length, 0);
});

test('M5 receipt replay cannot acquire cancellation ownership of an already running extraction', { timeout: 30_000 }, async t => {
  const f = await methods(t), task = await f.make(), input = { requestId: randomUUID(), incomplete: false }; f.manualIdle();
  f.provider.setResponder(() => ({ text: 'held original extraction', hold: true }));
  assert.equal((await f.request(task.id, input))?.status, 202); await f.provider.waitForRequests(1);
  const replay = f.feature.runForParent(f.projectId, task.id, input, f.parent);
  while (!f.parent.registered()) await new Promise<void>(resolve => setImmediate(resolve));
  await f.parent.cancel();
  const settledByReplayCancel = await Promise.race([replay.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))]);
  const originalStillBusy = f.feature.busyForTask(f.projectId, task.id);
  await f.feature.stopForTask(f.projectId, task.id); await replay;
  assert.equal(settledByReplayCancel, false, 'receipt readback must leave the original held extraction in flight');
  assert.equal(originalStillBusy, true, 'a readback caller cannot cancel the previously admitted operation');
  assert.equal(f.provider.requests.length, 1);
});

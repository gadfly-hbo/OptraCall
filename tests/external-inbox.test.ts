import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExternalDispatch } from '../src/host/external-dispatch.ts';
import { ExternalInbox, DEFAULT_INBOX_POLL_INTERVAL_MS } from '../src/host/external-inbox.ts';
import type { InboxReadTransport, InboxSubscription, InboxTransportEvent, InboxTransportRequest } from '../src/host/external-inbox.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { ExternalWorkError, externalAssetRefText } from '../src/host/external-work-types.ts';

const T0 = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
let clock = T0;
const now = () => clock;
const REPO = 'openai/synthetic';

const expectCode = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof ExternalWorkError, `expected ExternalWorkError, got ${String(error)}`);
  assert.equal((error as ExternalWorkError).code, expected);
  return true;
};

async function waitFor(read: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (read()) return;
    if (Date.now() > deadline) throw new Error('synthetic inbox condition timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  clock = T0;
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-inbox-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot: root, now });
  await store.init();
  const dispatch = new ExternalDispatch({
    store,
    profiles: () => ({ externalDispatchAllowed: true as const }),
    qualifyAssets: async (_projectId, refs) => new Set(refs.map(externalAssetRefText)),
    now,
  });
  const { work } = await dispatch.authorize('project-1', 'task-1', {
    goal: '合成外派目标',
    scope: '仅限合成数据范围',
    forbidden: '',
    allowedExecutors: ['principal-a'],
    repository: { stableId: REPO, visibility: 'private' },
    assetRefs: [],
    enterprise: '合成企业甲',
    validUntil: iso(clock + 48 * HOUR),
    summary: '合成工作摘要',
    deliveryCriteria: '合成交付标准',
  });

  const requests: InboxTransportRequest[] = [];
  let events: InboxTransportEvent[] = [];
  let nextAfterEventKey: string | undefined = 'cursor-1';
  let retryAfterMs: number | undefined;
  let failure: Error | undefined;
  const transport: InboxReadTransport = {
    read: async request => {
      requests.push(structuredClone(request));
      if (failure) { const error = failure; failure = undefined; throw error; }
      return { events, ...(nextAfterEventKey === undefined ? {} : { nextAfterEventKey }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
    },
  };
  const sub = (overrides: Partial<InboxSubscription> = {}): InboxSubscription =>
    ({ projectId: 'project-1', taskId: 'task-1', workId: work.workId, repositoryId: REPO, issueNumber: 101, ...overrides });
  const makeInbox = (subscriptions: InboxSubscription[], overrides: { pollIntervalMs?: number; schedule?: (delayMs: number, task: () => void) => () => void } = {}) =>
    new ExternalInbox({ store, transport, subscriptions, now, ...overrides });

  return {
    store, work, requests, transport,
    setEvents(list: InboxTransportEvent[]) { events = list; },
    setCursor(value: string | undefined) { nextAfterEventKey = value; },
    setRetryAfter(value: number | undefined) { retryAfterMs = value; },
    setFailure(error: Error | undefined) { failure = error; },
    sub, makeInbox,
  };
}

test('the adapter saves and dedupes real events and advances the cursor only after they are persisted', async t => {
  const { store, requests, setEvents, sub, makeInbox, work } = await fixture(t);
  setEvents([{ eventKey: `${REPO}#101:comment-1` }, { eventKey: `${REPO}#101:comment-2` }]);
  const inbox = makeInbox([sub()]);

  const first = await inbox.pollOnce();
  assert.equal(first.saved, 2);
  assert.equal(first.duplicates, 0);
  assert.equal(requests[0]!.repositoryId, REPO);
  assert.equal(requests[0]!.issueNumber, 101);
  assert.equal(requests[0]!.afterEventKey, undefined);
  const saved = await store.listInboxEvents('project-1', 'task-1');
  assert.deepEqual(saved.map(event => event.eventKey).sort(), [`${REPO}#101:comment-1`, `${REPO}#101:comment-2`].sort());
  assert.equal(saved.every(event => event.workId === work.workId && event.receivedAt === iso(T0)), true);

  // The same real events delivered again are duplicates, not new records.
  const second = await inbox.pollOnce();
  assert.equal(second.saved, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(requests[1]!.afterEventKey, 'cursor-1', 'the cursor advanced after the batch was saved');
  assert.equal((await store.listInboxEvents('project-1', 'task-1')).length, 2);
});

test('a failed save keeps the cursor in place so the same window is re-read instead of skipped', async t => {
  const { store, requests, setEvents, makeInbox } = await fixture(t);
  setEvents([{ eventKey: 'evt-1' }]);
  const inbox = makeInbox([{ projectId: 'project-9', taskId: 'task-9', workId: 'ghost-work', repositoryId: REPO }]);

  await assert.rejects(inbox.pollOnce(), expectCode('external_record_invalid'));
  assert.equal(requests[0]!.afterEventKey, undefined);
  assert.deepEqual(await store.listInboxEvents('project-9', 'task-9'), []);

  // The retry re-reads the same window; nothing was skipped by a phantom cursor.
  await assert.rejects(inbox.pollOnce(), expectCode('external_record_invalid'));
  assert.equal(requests[1]!.afterEventKey, undefined);
  assert.deepEqual(await store.listInboxEvents('project-9', 'task-9'), []);
});

test('stopped sync refuses further polls and never pulls again', async t => {
  const { requests, setEvents, sub, makeInbox } = await fixture(t);
  setEvents([{ eventKey: 'evt-1' }]);
  const inbox = makeInbox([sub()]);
  await inbox.pollOnce();
  const before = requests.length;
  inbox.stop('user-stopped');
  await assert.rejects(inbox.pollOnce(), expectCode('external_inbox_stopped'));
  inbox.stop();
  assert.equal(requests.length, before, 'stop issues no further transport reads');
});

test('revoking a subscription stops pulling it while authorized ones continue', async t => {
  const { requests, setEvents, sub, makeInbox } = await fixture(t);
  setEvents([{ eventKey: 'evt-1' }]);
  const inbox = makeInbox([sub(), sub({ repositoryId: 'other/repo', issueNumber: undefined, workId: undefined })]);
  await inbox.pollOnce();
  assert.deepEqual(requests.map(request => request.repositoryId), [REPO, 'other/repo']);

  const revoked = inbox.revoke({ repositoryId: 'other/repo' });
  assert.equal(revoked, 1);
  await inbox.pollOnce();
  assert.equal(requests.length, 3);
  assert.equal(requests[2]!.repositoryId, REPO);
  assert.ok(requests.slice(2).every(request => request.repositoryId !== 'other/repo'));
  await inbox.pollOnce();
  assert.equal(requests.length, 4);
  assert.ok(requests.slice(2).every(request => request.repositoryId !== 'other/repo'), 'revocation persists across rounds');
});

test('restart resumes authorized exact repository/issue reads; saved events dedupe and no writes are replayed', async t => {
  const { store, requests, setEvents, sub, makeInbox, work } = await fixture(t);
  setEvents([{ eventKey: 'evt-1' }, { eventKey: 'evt-2' }]);
  const subscriptions = [sub()];
  const first = makeInbox(subscriptions);
  await first.pollOnce();
  const claimsBefore = await store.listClaims(work.workId);
  const publicationsBefore = await store.listPublications(work.workId);
  const deliveriesBefore = await store.listDeliveries(work.workId);

  // A restart: a fresh adapter over the same ledger reads the same authorized subscription.
  const restarted = makeInbox(subscriptions);
  const outcome = await restarted.pollOnce();
  assert.equal(outcome.saved, 0);
  assert.equal(outcome.duplicates, 2);
  assert.equal((await store.listInboxEvents('project-1', 'task-1')).length, 2);
  assert.deepEqual(await store.listClaims(work.workId), claimsBefore);
  assert.deepEqual(await store.listPublications(work.workId), publicationsBefore);
  assert.deepEqual(await store.listDeliveries(work.workId), deliveriesBefore);

  // The restarted adapter's cursor resumes from the same anchor.
  await restarted.pollOnce();
  assert.equal(requests[1]!.afterEventKey, undefined, 'a fresh adapter starts before its first saved anchor');
  assert.equal(requests[2]!.afterEventKey, 'cursor-1');
});

test('the loop honors the default 60s interval, provider Retry-After, failure backoff and stop', async t => {
  const { requests, setEvents, setRetryAfter, setFailure, sub, makeInbox } = await fixture(t);
  setEvents([]);
  const scheduled: Array<{ delay: number; task: () => void; cancelled: boolean }> = [];
  const schedule = (delay: number, task: () => void) => {
    const entry = { delay, task, cancelled: false };
    scheduled.push(entry);
    return () => { entry.cancelled = true; };
  };
  const inbox = makeInbox([sub()], { schedule });
  inbox.start();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]!.delay, DEFAULT_INBOX_POLL_INTERVAL_MS);
  assert.equal(scheduled[0]!.delay, 60_000);

  // Success with Retry-After: the next pull waits exactly as the provider asked.
  setRetryAfter(45_000);
  scheduled[0]!.task();
  await waitFor(() => scheduled.length >= 2);
  assert.equal(scheduled[1]!.delay, 45_000);

  // Failure: the next pull backs off before retrying.
  setRetryAfter(undefined);
  setFailure(new Error('synthetic read failure'));
  scheduled[1]!.task();
  await waitFor(() => scheduled.length >= 3);
  assert.equal(scheduled[2]!.delay, 120_000);

  // Recovery resets the backoff to the default interval.
  scheduled[2]!.task();
  await waitFor(() => scheduled.length >= 4);
  assert.equal(scheduled[3]!.delay, 60_000);

  // Stop cancels the pending pull: firing the stale handle does nothing.
  inbox.stop('user-stopped');
  const readsBefore = requests.length, scheduleCount = scheduled.length;
  scheduled[3]!.task();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(requests.length, readsBefore);
  assert.equal(scheduled.length, scheduleCount);
});

test('the adapter reads exactly the authorized subscriptions it was constructed with', async t => {
  const { requests, setEvents, sub, makeInbox } = await fixture(t);
  setEvents([{ eventKey: 'evt-1' }]);
  const inbox = makeInbox([sub({ issueNumber: undefined })]);
  await inbox.pollOnce();
  assert.deepEqual(requests.map(request => [request.repositoryId, request.issueNumber]), [[REPO, undefined]]);
  await inbox.pollOnce();
  assert.equal(requests.length, 2);
});

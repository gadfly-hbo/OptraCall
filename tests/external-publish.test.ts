import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExternalDispatch } from '../src/host/external-dispatch.ts';
import type { ExternalGrantInput } from '../src/host/external-dispatch.ts';
import { ExternalPublisher } from '../src/host/external-publish.ts';
import type { GithubDispatchRequest, GithubDispatchResult, PublicationEvidence } from '../src/host/external-publish.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { ExternalWorkError, externalAssetRefText } from '../src/host/external-work-types.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const T0 = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
let clock = T0;
const now = () => clock;
const BODY = ['## 目标', '合成外派目标'].join('\n');
const REPO = 'openai/synthetic';

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
    repository: { stableId: REPO, visibility: 'private' },
    assetRefs: [assetRef('metric-1')],
    enterprise: '合成企业甲',
    validUntil: iso(clock + 48 * HOUR),
    summary: '合成外派工单标题',
    deliveryCriteria: '合成交付标准',
    targetExecutor: 'principal-a',
    ...overrides,
  };
}

type SyntheticGithub = { issues: Map<number, { title: string; body: string; comments: string[] }>; nextIssue: number };

/** Simulated GitHub state: issue-create opens exactly one issue, issue-comment appends to it. */
function githubTransport(state: SyntheticGithub = { issues: new Map(), nextIssue: 101 }) {
  const calls: GithubDispatchRequest[] = [];
  const transport = {
    dispatch: async (request: GithubDispatchRequest): Promise<GithubDispatchResult> => {
      calls.push(structuredClone(request));
      if (request.action === 'issue-create') {
        const number = state.nextIssue++;
        state.issues.set(number, { title: request.title ?? '', body: request.body, comments: [] });
        return { outcome: 'succeeded', repositoryId: request.repositoryId, issueNumber: number };
      }
      const issue = state.issues.get(request.issueNumber!);
      if (!issue) return { outcome: 'rejected', repositoryId: request.repositoryId };
      issue.comments.push(request.body);
      return { outcome: 'succeeded', repositoryId: request.repositoryId, issueNumber: request.issueNumber };
    },
  };
  return { calls, transport, state };
}

/** Plain recording transport with a configurable reply, for orchestration-level tests. */
function recordingTransport() {
  const calls: GithubDispatchRequest[] = [];
  let reply: (request: GithubDispatchRequest) => Promise<GithubDispatchResult> = async request => ({
    outcome: 'succeeded',
    repositoryId: request.repositoryId,
    issueNumber: request.action === 'issue-create' ? 101 : request.issueNumber,
    serviceRef: 'svc-op-1',
  });
  const transport = { dispatch: async (request: GithubDispatchRequest) => { calls.push(structuredClone(request)); return reply(request); } };
  return { calls, transport, setReply(fn: typeof reply) { reply = fn; } };
}

function recordingProbe() {
  const searches: Array<{ repositoryId: string; bodyHash: string }> = [];
  let evidence: PublicationEvidence[] = [];
  return {
    searches,
    probe: { search: async (request: { repositoryId: string; bodyHash: string }) => { searches.push({ ...request }); return evidence.filter(item => item.bodyHash === request.bodyHash); } },
    setEvidence(list: PublicationEvidence[]) { evidence = list; },
  };
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  clock = T0;
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-external-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot: root, now });
  await store.init();
  const profiles = () => ({ externalDispatchAllowed: true as const });
  const qualifyAssets = async (_projectId: string, refs: { authority: string; id: string; version: string; hash: string }[]) => new Set(refs.map(externalAssetRefText));
  const dispatch = new ExternalDispatch({ store, profiles, qualifyAssets, now });
  const { work } = await dispatch.authorize('project-1', 'task-1', grantInput());
  const makePublisher = (bundle: { transport: ReturnType<typeof recordingTransport>['transport'] }, probe?: ReturnType<typeof recordingProbe>['probe'], hostContext?: () => GithubDispatchRequest['hostContext']) => {
    return new ExternalPublisher({ store, transport: bundle.transport, ...(probe ? { probe } : {}), now, ...(hostContext ? { hostContext } : {}) });
  };
  return { root, store, dispatch, work, makePublisher, recordingTransport, githubTransport, recordingProbe };
}

test('AB04: the same work revision across turns and restarts publishes exactly once and returns the original attempt', async t => {
  const { store, work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport(), probe = recordingProbe();
  const publisher = makePublisher(first, probe.probe);

  const initial = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(initial.dispatched, true);
  assert.equal(initial.attempt.status, 'succeeded');
  assert.equal(initial.attempt.issueId, '101');
  assert.equal(initial.attempt.repositoryId, REPO);
  assert.equal(initial.attempt.bodyHash, sha256(BODY));
  assert.equal(first.calls.length, 1);

  // A new turn in the same process repeats the identical request.
  const repeated = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(repeated.dispatched, false);
  assert.equal(repeated.attempt.operationId, initial.attempt.operationId);
  assert.equal(repeated.attempt.status, 'succeeded');

  // A restart: a fresh publisher over the same ledger must not dispatch again.
  const restarted = recordingTransport();
  const restartedPublisher = makePublisher(restarted, probe.probe);
  const afterRestart = await restartedPublisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(afterRestart.dispatched, false);
  assert.equal(afterRestart.attempt.operationId, initial.attempt.operationId);
  assert.equal(restarted.calls.length, 0, 'no equivalent dispatch is regenerated after restart');
  assert.equal(first.calls.length + restarted.calls.length, 1);
  assert.equal((await store.listPublications(work.workId)).length, 1);
});

test('AB04/AB05: a different body under the same publication identity is a conflict, never a second dispatch', async t => {
  const { work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport();
  const publisher = makePublisher(first, recordingProbe().probe);
  await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  await assert.rejects(
    publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: `${BODY}\n被夹带的第二版正文` }),
    expectCode('external_publication_conflict'),
  );
  assert.equal(first.calls.length, 1);
});

test('AB04: a lost response stays UNKNOWN, is never blindly re-sent, and a unique exact read-only match reconciles it', async t => {
  const { work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport(), probe = recordingProbe();
  first.setReply(async () => { throw new Error('response lost in transit'); });
  const publisher = makePublisher(first, probe.probe);

  const attempt = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(attempt.dispatched, true);
  assert.equal(attempt.attempt.status, 'unknown');
  assert.equal(first.calls.length, 1);

  // A repeat publish keeps the UNKNOWN attempt without another outbound call.
  const repeated = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(repeated.dispatched, false);
  assert.equal(repeated.attempt.status, 'unknown');
  assert.equal(first.calls.length, 1);

  // Evidence from another author is not an accurate match.
  probe.setEvidence([{ repositoryId: REPO, bodyHash: sha256(BODY), author: 'someone-else', issueId: '101' }]);
  const notMine = await publisher.reconcile({ operationId: attempt.attempt.operationId, author: 'fixture-account' });
  assert.equal(notMine.status, 'unknown');
  assert.equal(probe.searches.length, 1);

  // A unique accurate match (exact repository, author and body version) settles it.
  probe.setEvidence([{ repositoryId: REPO, bodyHash: sha256(BODY), author: 'fixture-account', issueId: '101' }]);
  const settled = await publisher.reconcile({ operationId: attempt.attempt.operationId, author: 'fixture-account' });
  assert.equal(settled.status, 'succeeded');
  assert.equal(settled.issueId, '101');
  assert.equal(settled.repositoryId, REPO);
  assert.equal(first.calls.length, 1, 'reconciliation never dispatches or appends');
});

test('AB04: multiple exact matches are a conflict and no match stays UNKNOWN; both keep the durable attempt', async t => {
  const { store, work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport(), probe = recordingProbe();
  first.setReply(async () => { throw new Error('response lost in transit'); });
  const publisher = makePublisher(first, probe.probe);
  const attempt = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });

  probe.setEvidence([]);
  const none = await publisher.reconcile({ operationId: attempt.attempt.operationId, author: 'fixture-account' });
  assert.equal(none.status, 'unknown');

  const exact = { repositoryId: REPO, bodyHash: sha256(BODY), author: 'fixture-account', issueId: '101' };
  probe.setEvidence([exact, { ...exact, issueId: '202' }]);
  await assert.rejects(publisher.reconcile({ operationId: attempt.attempt.operationId, author: 'fixture-account' }), expectCode('external_publication_conflict'));
  const stored = await store.getPublication(attempt.attempt.operationId);
  assert.equal(stored?.status, 'unknown');
  assert.equal(first.calls.length, 1);

  // A unique upstream rejection receipt settles it as rejected without any write.
  probe.setEvidence([{ repositoryId: REPO, bodyHash: sha256(BODY), author: 'fixture-account', rejected: true }]);
  const rejected = await publisher.reconcile({ operationId: attempt.attempt.operationId, author: 'fixture-account' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(first.calls.length, 1);
});

test('AB04: reconciliation never touches terminal or unsubmitted attempts and never writes', async t => {
  const { store, work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport(), probe = recordingProbe();
  const publisher = makePublisher(first, probe.probe);
  const done = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });

  // Terminal attempt: probe is not even queried.
  const reread = await publisher.reconcile({ operationId: done.attempt.operationId, author: 'fixture-account' });
  assert.equal(reread.status, 'succeeded');
  assert.equal(probe.searches.length, 0);

  // A prepared (never submitted) attempt has nothing to reconcile.
  const prepared = await store.recordPublication({ workId: work.workId, revision: 1, action: 'issue-comment', bodyHash: sha256('future-comment') });
  const stillPrepared = await publisher.reconcile({ operationId: prepared.operationId, author: 'fixture-account' });
  assert.equal(stillPrepared.status, 'prepared');
  assert.equal(probe.searches.length, 0);
  assert.equal(first.calls.length, 1);
  assert.equal((await store.listPublications(work.workId)).length, 2);
});

test('spec §5: revision 2 appends a versioned comment to the same issue and preserves the original issue and old comments', async t => {
  const { store, work, makePublisher, githubTransport } = await fixture(t);
  const github = githubTransport();
  const publisher = makePublisher(github);

  const created = await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(created.attempt.status, 'succeeded');
  const issueNumber = Number(created.attempt.issueId);
  const issue = github.state.issues.get(issueNumber)!;
  assert.equal(issue.body, BODY);
  assert.equal(issue.title, '合成外派工单标题');

  // The supplement/re-request revision bump is a later slice's flow; S2 arranges the
  // bumped work through the store's public CAS API to prove the revision-2 publication.
  await store.mutate(state => { const current = state.works.find(item => item.workId === work.workId)!; current.revision = 2; current.updatedAt = iso(clock); });

  const revisedBody = `${BODY}\n\n## 修订 r2\n补充合成验收条件`;
  const revised = await publisher.publish({ workId: work.workId, revision: 2, action: 'issue-comment', body: revisedBody });
  assert.equal(revised.dispatched, true);
  assert.equal(revised.attempt.status, 'succeeded');
  assert.equal(revised.attempt.issueId, String(issueNumber));
  assert.deepEqual(github.state.issues.get(issueNumber)!.body, BODY, 'original issue body is untouched');
  assert.deepEqual(github.state.issues.get(issueNumber)!.title, issue.title);
  assert.deepEqual(github.state.issues.get(issueNumber)!.comments, [revisedBody]);

  // A repeat of the same revision-2 comment does not append twice.
  const repeated = await publisher.publish({ workId: work.workId, revision: 2, action: 'issue-comment', body: revisedBody });
  assert.equal(repeated.dispatched, false);
  assert.equal(github.state.issues.get(issueNumber)!.comments.length, 1);
  assert.equal(github.state.nextIssue, 102, 'exactly one issue exists for the work');
  assert.equal(github.calls.filter(call => call.action === 'issue-create').length, 1);
});

test('spec §5: a comment cannot be published without a succeeded issue anchor, and creation is refused once the issue exists', async t => {
  const { store, work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport();
  const publisher = makePublisher(first, recordingProbe().probe);

  await assert.rejects(
    publisher.publish({ workId: work.workId, revision: 1, action: 'issue-comment', body: ' orphan comment' }),
    expectCode('external_publication_anchor_missing'),
  );
  assert.equal(first.calls.length, 0);
  assert.deepEqual((await store.listPublications(work.workId)).filter(publication => publication.action === 'issue-comment'), []);

  await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  await store.mutate(state => { const current = state.works.find(item => item.workId === work.workId)!; current.revision = 2; current.updatedAt = iso(clock); });
  await assert.rejects(
    publisher.publish({ workId: work.workId, revision: 2, action: 'issue-create', body: `${BODY}\n第二张工单` }),
    expectCode('external_issue_already_created'),
  );
  assert.equal(first.calls.length, 1, 'exactly the one legitimate create was dispatched');

  // Once the anchor exists the comment path becomes publishable.
  const comment = await publisher.publish({ workId: work.workId, revision: 2, action: 'issue-comment', body: 'r2 note' });
  assert.equal(comment.attempt.status, 'succeeded');
  assert.equal(comment.attempt.issueId, '101');
  assert.equal(first.calls.length, 2);
});

test('AB05: the outbound body hash is fixed at reservation time and shipped verbatim to the transport', async t => {
  const { work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport();
  const publisher = makePublisher(first, recordingProbe().probe);
  await publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(first.calls[0]!.body, BODY);
  assert.equal(first.calls[0]!.bodyHash, sha256(BODY));
  assert.equal(first.calls[0]!.repositoryId, REPO);
  assert.equal(first.calls[0]!.workId, work.workId);
  assert.equal(first.calls[0]!.revision, 1);
});

test('AB02: publishing a cancelled work is refused with zero outbound calls', async t => {
  const { dispatch, work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport();
  const publisher = makePublisher(first, recordingProbe().probe);
  await dispatch.cancelWork(work.workId, 'user-cancelled');
  await assert.rejects(publisher.publish({ workId: work.workId, revision: 1, action: 'issue-create', body: BODY }), expectCode('external_work_cancelled'));
  assert.equal(first.calls.length, 0);
});

test('the publish facade stays owner-bound, requires an injected publisher and honors the profile gate', async t => {
  const { store, dispatch, work, makePublisher, recordingTransport, recordingProbe } = await fixture(t);
  const first = recordingTransport();
  const publisher = makePublisher(first, recordingProbe().probe);
  const wired = new ExternalDispatch({ store, profiles: () => ({ externalDispatchAllowed: true }), qualifyAssets: async (_p, refs) => new Set(refs.map(externalAssetRefText)), now, publisher });

  const result = await wired.publish('project-1', 'task-1', { workId: work.workId, revision: 1, action: 'issue-create', body: BODY });
  assert.equal(result.attempt.status, 'succeeded');

  // Another owner cannot address this work through its own task identity.
  await assert.rejects(
    wired.publish('project-1', 'task-other', { workId: work.workId, revision: 1, action: 'issue-create', body: BODY }),
    expectCode('external_work_not_found'),
  );
  // Without an injected publisher the facade cannot publish at all.
  await assert.rejects(
    dispatch.publish('project-1', 'task-1', { workId: work.workId, revision: 1, action: 'issue-create', body: BODY }),
    expectCode('external_publisher_unconfigured'),
  );
  // A revoked profile closes the publish path too.
  const closed = new ExternalDispatch({ store, profiles: () => ({ externalDispatchAllowed: false, reason: 'protected' }), qualifyAssets: async (_p, refs) => new Set(refs.map(externalAssetRefText)), now, publisher });
  await assert.rejects(closed.publish('project-1', 'task-1', { workId: work.workId, revision: 1, action: 'issue-create', body: BODY }), expectCode('external_profile_forbidden'));
  assert.equal(first.calls.length, 1);
});

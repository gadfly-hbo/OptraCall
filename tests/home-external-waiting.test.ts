import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CaseStore } from '../src/host/case-store.ts';
import { createWorkspaceDraftStore } from '../src/host/workspace-draft-store.ts';
import { createWorkspaceDailyRoutes } from '../src/host/workspace-daily-routes.ts';
import type { HomePendingProjection } from '../src/host/home-pending.ts';

async function fixture(t: { after(fn: () => void): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-home-wait-'));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') });
  await cases.initialize(); t.after(() => cases.close());
  const one = cases.createCase({ operationId: randomUUID(), title: '改善会员复购' });
  const two = cases.createCase({ operationId: randomUUID(), title: '共享门店工作' });
  const projectId = randomUUID();
  for (const record of [one, two]) cases.linkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: cases.getCase(record.id).revision, projectId });
  for (const title of ['扩大试点范围', '门店缺货原因', '复购口径校准']) cases.createDecisionIssue({ operationId: randomUUID(), caseId: one.id, expectedRevision: cases.getCase(one.id).revision, title });
  let blocked: string | null = null;
  let blockedProject: string | undefined;
  const routes = (qualify = true) => createWorkspaceDailyRoutes({ cases, drafts: createWorkspaceDraftStore({ root: path.join(root, 'drafts') }),
    ...(qualify ? { assertActiveProject: async (id: string) => { if (blocked && (!blockedProject || blockedProject === id)) throw Object.assign(Error(blocked), { code: blocked, statusCode: blocked === 'forbidden' ? 403 : 409 }); } } : {}),
    adoptGoal: async () => { throw Error('not used'); }, createCase: async () => { throw Error('not used'); },
  });
  const read = async (qualify = true) => (await routes(qualify)({ pathname: '/api/workspace/home-pending', method: 'GET' }))!.body as HomePendingProjection;
  const save = (status: 'awaiting_feedback' | 'in_progress') => cases.saveProjectWork({ operationId: randomUUID(), projectId, expectedRevision: cases.getProjectWork(projectId).revision, workStatus: status, workScope: '门店共用核查', assignee: '门店运营', nextStep: '等待补货单与上架记录', statusReason: '门店尚未回传', originCaseId: one.id });
  return { cases, one, two, projectId, read, save, block: (value: string | null, projectId?: string) => { blocked = value; blockedProject = projectId; } };
}

test('DW08 waiting: shared project saved waiting appears once alongside continuing Case, without guessing the last issue or an action', async t => {
  const f = await fixture(t); const work = f.save('awaiting_feedback');
  const before = f.cases.getEvents('project', f.projectId);
  const result = await f.read();
  assert.equal(result.pending.length, 0, 'project waiting never becomes a personal request');
  assert.equal(result.continueWork.length, 2, 'waiting is not exclusive with Case continuation');
  assert.equal(result.externalWaiting.length, 1, 'shared project is shown once');
  const waiting = result.externalWaiting[0]!;
  assert.deepEqual(waiting.source, { kind: 'project-work', projectId: f.projectId, revision: work.revision });
  assert.deepEqual(waiting.relatedCases?.map(item => item.caseId).sort(), [f.one.id, f.two.id].sort());
  assert.equal(waiting.issueId, null); assert.equal(waiting.issueTitle, null);
  assert.equal(waiting.assignee, '门店运营'); assert.equal(waiting.reason, '等待补货单与上架记录');
  assert.equal(waiting.updatedAt, work.updatedAt);
  assert.equal(result.continueWork.find(item => item.caseId === f.one.id)?.issueId, null, 'issue creation order is not a selected issue');
  assert.equal(result.continueWork.find(item => item.caseId === f.one.id)?.issueCount, 3);
  await f.read(); assert.deepEqual(f.cases.getEvents('project', f.projectId), before, 'GET does not write a completion or other record');
});

test('DW08 waiting: Case observing or a missing feedback alone cannot fabricate a specific external waiting source', async t => {
  const f = await fixture(t);
  f.cases.updateCase({ operationId: randomUUID(), caseId: f.one.id, expectedRevision: f.cases.getCase(f.one.id).revision, status: 'observing' });
  assert.equal((await f.read()).externalWaiting.length, 0, 'a coarse Case status is not an external project/action wait');
  f.save('awaiting_feedback'); assert.equal((await f.read()).externalWaiting.length, 1);
  f.save('in_progress'); assert.equal((await f.read()).externalWaiting.length, 0, 'latest saved work state replaces waiting');
});

test('DW16 waiting: archived, forbidden and unqualified project reads never expose saved waiting; valid records recover without replay', async t => {
  const f = await fixture(t); f.save('awaiting_feedback');
  const events = f.cases.getEvents('project', f.projectId);
  f.block('project_archived'); assert.equal((await f.read()).externalWaiting.length, 0);
  f.block('forbidden'); const forbidden = await f.read(); assert.equal(forbidden.externalWaiting.length, 0); assert.equal(forbidden.externalWaitingLimited, true);
  f.block(null); const noQualifier = await f.read(false); assert.equal(noQualifier.externalWaiting.length, 0); assert.equal(noQualifier.externalWaitingLimited, true);
  assert.equal((await f.read()).externalWaiting.length, 1);
  assert.deepEqual(f.cases.getEvents('project', f.projectId), events);
});

test('DW16 waiting: one unreadable shared project does not erase another readable project or fabricate its issue', async t => {
  const f = await fixture(t); f.save('awaiting_feedback');
  const readableProject = randomUUID();
  f.cases.linkProject({ operationId: randomUUID(), caseId: f.one.id, expectedRevision: f.cases.getCase(f.one.id).revision, projectId: readableProject });
  f.cases.saveProjectWork({ operationId: randomUUID(), projectId: readableProject, expectedRevision: 0, workStatus: 'awaiting_feedback', workScope: '另一项目的明确等待', assignee: '独立承接人', nextStep: '等候指定资料', originCaseId: f.one.id });
  f.block('forbidden', f.projectId);
  const result = await f.read();
  assert.equal(result.externalWaitingLimited, true);
  assert.deepEqual(result.externalWaiting.map(item => item.source?.projectId), [readableProject]);
  assert.deepEqual(result.externalWaiting[0]?.relatedCases, [{ caseId: f.one.id, caseTitle: f.one.title }]);
  assert.equal(result.externalWaiting[0]?.issueId, null);
  assert.equal(result.continueWork.length, 2);
});

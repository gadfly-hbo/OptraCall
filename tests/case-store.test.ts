import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-case-')));
  const store = new CaseStore({ dataRoot: path.join(root, 'private') });
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store, dataRoot: path.join(root, 'private') };
}

test('CASE-STORE-01: ordinary open does not initialize; explicit initialization persists its identity', async t => {
  const { store, dataRoot } = await fixture(t);
  assert.equal((await store.init()).state, 'uninitialized');
  await assert.rejects(fs.stat(path.join(dataRoot, 'decision-cases.sqlite3')), { code: 'ENOENT' });
  const status = await store.initialize();
  assert.equal(status.state, 'ready'); assert.match(status.storeId!, /^[0-9a-f-]{36}$/);
  const marker = JSON.parse(await fs.readFile(path.join(dataRoot, 'decision-cases-store.json'), 'utf8'));
  assert.equal(marker.storeId, status.storeId); assert.equal(marker.state, 'ready');
  assert.equal((await fs.stat(path.join(dataRoot, 'decision-cases.sqlite3'))).mode & 0o777, 0o600);
  store.close(); const reopened = new CaseStore({ dataRoot });
  try { assert.deepEqual(await reopened.init(), status); } finally { reopened.close(); }
});

test('CASE-STORE-02: Case saves are revisioned and idempotent with exactly one event per real change', async t => {
  const { store } = await fixture(t); await store.initialize();
  const operationId = randomUUID(), input = { operationId, title: '  会员复购率下滑5%  ', judgement: '尚不确定原因' };
  const first = store.createCase(input);
  assert.equal(first.title, '会员复购率下滑5%'); assert.equal(first.revision, 1); assert.equal(first.status, 'pending');
  assert.deepEqual(store.createCase(input), first);
  assert.throws(() => store.createCase({ ...input, title: '另一问题' }), /operation_conflict/);
  const edited = store.updateCase({ operationId: randomUUID(), caseId: first.id, expectedRevision: 1, judgement: '存量会员下降' });
  assert.equal(edited.revision, 2);
  assert.throws(() => store.updateCase({ operationId: randomUUID(), caseId: first.id, expectedRevision: 1, title: '不能覆盖' }), /revision_conflict/);
  assert.deepEqual(store.updateCase({ operationId: randomUUID(), caseId: first.id, expectedRevision: 2, judgement: edited.judgement }), edited);
  const noted = store.addCaseNote({ operationId: randomUUID(), caseId: first.id, expectedRevision: 2, note: '主管反馈尚未验证', feedbackSource: '用户转述' });
  const closed = store.closeCase({ operationId: randomUUID(), caseId: first.id, expectedRevision: 3, closeReason: '本阶段已结束，效果未知' });
  assert.equal(closed.status, 'closed'); assert.ok(closed.closedAt); assert.equal(noted.revision, 3);
  assert.throws(() => store.updateCase({ operationId: randomUUID(), caseId: first.id, expectedRevision: 4, title: '禁止编辑' }), /case_closed/);
  const reopened = store.reopenCase({ operationId: randomUUID(), caseId: first.id, expectedRevision: 4, status: 'observing' });
  assert.equal(reopened.closeReason, null); assert.equal(reopened.closedAt, null); assert.equal(reopened.createdAt, first.createdAt);
  const events = store.getEvents('case', first.id);
  assert.deepEqual(events.map(event => event.revision), [1, 2, 3, 4, 5]);
  assert.equal(events[1]!.changes.judgement!.before, '尚不确定原因');
  assert.equal(events[2]!.feedbackSource, '用户转述');
  assert.equal(store.listCases().length, 1);
});

test('CASE-STORE-03: many-to-many links and global work have separate revisions and histories', async t => {
  const { store } = await fixture(t); await store.initialize();
  const a = store.createCase({ operationId: randomUUID(), title: '问题A' }), b = store.createCase({ operationId: randomUUID(), title: '问题B' });
  const projectId = randomUUID(), secondId = randomUUID();
  const linked = store.linkProject({ operationId: randomUUID(), caseId: a.id, projectId, expectedRevision: 1 });
  store.linkProject({ operationId: randomUUID(), caseId: a.id, projectId: secondId, expectedRevision: 2 });
  store.linkProject({ operationId: randomUUID(), caseId: b.id, projectId, expectedRevision: 1 });
  assert.equal(store.listProjectLinks(a.id).length, 2); assert.equal(store.listProjectLinks().length, 3);
  const duplicate = store.linkProject({ operationId: randomUUID(), caseId: a.id, projectId, expectedRevision: 3 });
  assert.equal(duplicate.case.revision, 3); assert.deepEqual(duplicate.link, linked.link);
  assert.equal(store.getProjectWork(projectId).revision, 0); assert.equal(store.getProjectWork(projectId).workStatus, null);
  const empty = { operationId: randomUUID(), projectId, expectedRevision: 0, workStatus: null, workScope: '', nextStep: '', assignee: null };
  assert.equal(store.saveProjectWork(empty).revision, 0);
  let work = store.saveProjectWork({ ...empty, operationId: randomUUID(), workStatus: 'in_progress', workScope: '人群研究', originCaseId: a.id });
  assert.equal(work.revision, 1); const changedAt = work.statusChangedAt;
  work = store.saveProjectWork({ ...empty, operationId: randomUUID(), expectedRevision: 1, workStatus: 'in_progress', workScope: '商品研究', assignee: 'A分析师' });
  assert.equal(work.revision, 2); assert.equal(work.statusChangedAt, changedAt);
  assert.throws(() => store.saveProjectWork({ ...empty, operationId: randomUUID(), expectedRevision: 1 }), /revision_conflict/);
  assert.throws(() => store.saveProjectWork({ ...empty, operationId: randomUUID(), expectedRevision: 2, workStatus: 'cancelled' }), /cancel_reason_required/);
  work = store.saveProjectWork({ ...empty, operationId: randomUUID(), expectedRevision: 2, workStatus: 'cancelled', statusReason: '资源暂不足' });
  assert.equal(work.statusReason, '资源暂不足');
  work = store.saveProjectWork({ ...empty, operationId: randomUUID(), expectedRevision: 3, workStatus: 'cancelled', workScope: '保留原因' });
  assert.equal(work.statusReason, '资源暂不足');
  work = store.saveProjectWork({ ...empty, operationId: randomUUID(), expectedRevision: 4, workStatus: 'completed' });
  assert.equal(work.statusReason, null);
  const before = store.getCase(a.id); assert.equal(before.revision, 3);
  store.closeCase({ operationId: randomUUID(), caseId: a.id, expectedRevision: 3, closeReason: '暂结' });
  assert.throws(() => store.addProjectWorkNote({ operationId: randomUUID(), projectId, expectedRevision: 5, originCaseId: a.id, note: '禁止从关闭Case写' }), /case_closed/);
  store.addProjectWorkNote({ operationId: randomUUID(), projectId, expectedRevision: 5, note: '项目全局说明' });
  assert.equal(store.getEvents('project', projectId).length, 6);
  assert.equal(store.getEvents('case', b.id).length, 2);
});

test('CASE-STORE-04: references retain identity/history; explicit context freezes selected Case and prompt hashes', async t => {
  const { store } = await fixture(t); await store.initialize();
  let record = store.createCase({ operationId: randomUUID(), title: '复购率下降', description: '会员复购率下降5%', judgement: '原因未知', nextStep: '补充证据' });
  const projectId = randomUUID(), taskId = randomUUID();
  record = store.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: record.revision }).case;
  const input = { operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: record.revision, relativePath: '060_reports/分析.md', role: 'report' as const };
  const saved = store.saveArtifact(input); record = saved.case;
  assert.equal(saved.artifact.taskId, null); assert.equal(saved.artifact.observedSha256, null);
  const duplicate = store.saveArtifact({ ...input, operationId: randomUUID(), expectedRevision: record.revision });
  assert.equal(duplicate.artifact.id, saved.artifact.id); assert.equal(duplicate.case.revision, record.revision);
  assert.throws(() => store.saveArtifact({ ...input, operationId: randomUUID(), expectedRevision: record.revision, relativePath: '020_clean/../../outside' }), /invalid_artifact_path/);
  assert.throws(() => store.saveArtifact({ ...input, operationId: randomUUID(), expectedRevision: record.revision, observedSha256: 'a'.repeat(64) }), /invalid_artifact_observation/);
  const selection = { caseId: record.id, caseRevision: record.revision, projectWorkRevision: 0, selectedReferenceIds: [saved.artifact.id] };
  const prepare = { operationId: randomUUID(), projectId, taskId, userPrompt: '继续分析', selection };
  const context = store.prepareTaskContext(prepare);
  assert.ok(context.composedPrompt.includes('继续分析')); assert.ok(context.snapshot.contextText.includes('原因未知'));
  assert.ok(context.snapshot.contextText.includes('060_reports/分析.md')); assert.equal(context.snapshot.userPromptSha256.length, 64);
  const receiptText = JSON.stringify(store.getOperation(prepare.operationId)); assert.ok(!receiptText.includes('继续分析'));
  assert.deepEqual(store.prepareTaskContext(prepare), context);
  assert.throws(() => store.prepareTaskContext({ ...prepare, userPrompt: '改变输入' }), /operation_conflict/);
  record = store.updateCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, judgement: '新判断' });
  assert.deepEqual(store.prepareTaskContext(prepare), context, 'a replay keeps the original snapshot even after Case changes');
  assert.throws(() => store.prepareTaskContext({ ...prepare, operationId: randomUUID() }), /revision_conflict/);
  record = store.unlinkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: record.revision }).case;
  assert.equal(store.getArtifacts(record.id).length, 1);
  assert.throws(() => store.prepareTaskContext({ ...prepare, operationId: randomUUID(), selection: { ...selection, caseRevision: record.revision } }), /project_not_linked/);
  record = store.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: record.revision }).case;
  const unlinked = store.unlinkArtifact({ operationId: randomUUID(), caseId: record.id, artifactId: saved.artifact.id, expectedRevision: record.revision }); record = unlinked.case;
  assert.ok(unlinked.artifact.unlinkedAt); assert.equal(store.getArtifacts(record.id, { includeUnlinked: false }).length, 0);
  assert.throws(() => store.prepareTaskContext({ ...prepare, operationId: randomUUID(), selection: { ...selection, caseRevision: record.revision } }), /invalid_context_reference/);
  const relinked = store.saveArtifact({ ...input, operationId: randomUUID(), expectedRevision: record.revision, observedSha256: 'b'.repeat(64), observedBytes: 42, observedAt: new Date().toISOString() });
  assert.equal(relinked.artifact.id, saved.artifact.id); assert.equal(relinked.artifact.unlinkedAt, null); assert.equal(relinked.artifact.observedBytes, 42);
});

test('CASE-STORE-05: staged project creation reserves identity and preserves partial success across revision conflicts', async t => {
  const { store, dataRoot } = await fixture(t); await store.initialize();
  const record = store.createCase({ operationId: randomUUID(), title: '两项目分析' });
  const input = { operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, projectId: randomUUID(), projectInput: { name: '人群研究', configurationId: 'synthetic' } };
  const reserved = store.reserveProjectCreation(input); assert.equal(reserved.phase, 'prepared');
  assert.deepEqual(store.listPendingProjectOperations(record.id), [reserved]);
  assert.deepEqual(store.reserveProjectCreation(input), reserved);
  assert.throws(() => store.reserveProjectCreation({ ...input, projectId: randomUUID() }), /operation_conflict/);
  store.markProjectCreated(input.operationId); assert.equal(store.getOperation(input.operationId)!.phase, 'project_created');
  const edited = store.updateCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: 1, judgement: '中途编辑' });
  assert.throws(() => store.completeProjectCreation(input.operationId), /revision_conflict/);
  assert.equal(store.getOperation(input.operationId)!.phase, 'project_created'); assert.equal(store.listProjectLinks().length, 0);
  const recoveryId = randomUUID();
  const recovered = store.linkProject({ operationId: recoveryId, caseId: record.id, projectId: input.projectId, expectedRevision: edited.revision, recoveryOf: input.operationId });
  assert.equal(recovered.case.revision, 3);
  const receipt = store.getOperation(input.operationId)!;
  assert.equal(receipt.requestSha256, reserved.requestSha256); assert.equal(receipt.phase, 'completed'); assert.equal(receipt.result!.recoveredByOperationId, recoveryId);
  assert.equal(store.getOperation(recoveryId)!.phase, 'completed');
  assert.deepEqual(store.listPendingProjectOperations(record.id), []);
  store.close(); const reopened = new CaseStore({ dataRoot });
  try {
    assert.equal((await reopened.init()).state, 'ready'); assert.equal(reopened.listProjectLinks().length, 1);
    assert.deepEqual(reopened.completeProjectCreation(input.operationId), receipt.result);
    const next = { ...input, operationId: randomUUID(), projectId: randomUUID(), expectedRevision: 3 };
    reopened.reserveProjectCreation(next); reopened.markProjectNeedsReview(next.operationId, '项目目录只创建了一半，保留现场');
    assert.equal(reopened.getOperation(next.operationId)!.phase, 'needs_review');
    assert.equal(reopened.listPendingProjectOperations(record.id)[0]!.phase, 'needs_review');
    assert.throws(() => reopened.markProjectCreated(next.operationId), /project_creation_needs_review/);
  } finally { reopened.close(); }
});

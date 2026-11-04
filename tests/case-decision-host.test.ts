import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { sampleWithoutSnapshotExport } from './fixtures/requirement-sample.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { CaseStore } from '../src/host/case-store.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M5合成', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1', model: 'synthetic', apiKey: 'synthetic-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M5合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Case继续工作' }), 201);
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: record } = await readJson(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '合成门店缺货', description: '不代表真实经营资料。' }), 201);
  await readJson(await host.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id }));
  return { host, project, task, record, route: `/api/cases/${record.id}/decisions` };
}

async function seedStrategy(t: { after(fn: () => Promise<void>): void }, f: Awaited<ReturnType<typeof fixture>>) {
  // Fixture setup uses the approved public CaseStore interface while no Host owns
  // that temporary root. It is not an HTTP endpoint for impersonating the Agent.
  await f.host.close();
  const store = new CaseStore({ dataRoot: f.host.dataRoot }); await store.init();
  const status = store.getStatus(); assert.equal(status.state, 'ready');
  const revision = store.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: status.storeId!, caseId: f.record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '先核日志', proposal: '先核对执行路径，再判断授权是否足够。' } },
    { actorKind: 'agent', projectId: f.project.id, taskId: f.task.id, requestId: randomUUID(), sessionId: 'synthetic-seed-session', toolCallId: 'synthetic-seed-call' });
  store.close();
  f.host = await startTestHost({ dataRoot: f.host.dataRoot, projectsRoot: f.host.projectsRoot }); t.after(() => f.host.close());
  return revision;
}

test('CD01/09 public Case decision list is empty without generating records, changing Case core or starting a session', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const before = await readJson(await f.host.request(`/api/cases/${f.record.id}`));
  const listing = await readJson(await f.host.request(f.route));
  assert.deepEqual(listing.items, []);
  assert.deepEqual(listing.choices, []);
  assert.equal(listing.decisionUpdatedAt, null);
  assert.equal(listing.continuation, null);
  assert.equal(typeof listing.caseStoreId, 'string');
  const after = await readJson(await f.host.request(`/api/cases/${f.record.id}`));
  assert.deepEqual(after.case, before.case);
  assert.deepEqual(after.events, before.events);
  const current = await readJson(await f.host.request(`/api/projects/${f.project.id}/tasks/${f.task.id}`));
  assert.equal(current.task.sessionFile, undefined);
});

test('CD06 public association choices read original linked actions and exact feedback revisions without changing them', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const { item } = await readJson(await f.host.request('/api/decision-board/items', 'POST', { projectId: f.project.id, title: '核对执行路径', rationale: '合成待核建议' }), 201);
  await readJson(await f.host.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task } = await readJson(await f.host.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '核对补货日志', owner: '合成负责人', dueDate: '2026-12-01', note: '原行动备注' }), 201);
  const { feedback: first } = await readJson(await f.host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '只完成访谈', metricDelta: '', review: '没有同范围指标', score: null, effect: 'unknown' }));
  const { feedback: second } = await readJson(await f.host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', { operationId: randomUUID(), expectedLatestRevisionId: first.revisionId, adopted: true, outcome: '增加日志核对', metricDelta: '', review: '效果仍未知', score: null, effect: 'unknown' }));
  const before = await readJson(await f.host.request('/api/decision-board'));
  const candidates = await readJson(await f.host.request(f.route + '/links'));
  assert.equal(candidates.actions.length, 1);
  assert.deepEqual(candidates.actions[0].target, { type: 'board-task', projectId: f.project.id, itemId: item.id, taskId: task.id });
  assert.equal(candidates.actions[0].owner, '合成负责人');
  assert.equal(candidates.actions[0].note, '原行动备注');
  assert.deepEqual(candidates.actions[0].feedbackRevisions.map((r: any) => r.revisionId), [first.revisionId, second.revisionId]);
  assert.deepEqual(await readJson(await f.host.request('/api/decision-board')), before);
});

test('CD03/06 source reading fixes a feedback revision and does not substitute a newer feedback or infer effectiveness', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const { item } = await readJson(await f.host.request('/api/decision-board/items', 'POST', { projectId: f.project.id, title: '来源建议', rationale: '合成' }), 201);
  await readJson(await f.host.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task } = await readJson(await f.host.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '来源行动' }), 201);
  const command = { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: 'M5_FIXED_FEEDBACK_V1_ONLY', metricDelta: '', review: '无完整指标', score: null, effect: 'unknown' };
  const { feedback: first } = await readJson(await f.host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', command));
  await readJson(await f.host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', { ...command, operationId: randomUUID(), expectedLatestRevisionId: first.revisionId, outcome: 'M5_NEWER_FEEDBACK_NOT_SELECTED' }));
  const target = { type: 'feedback', sourceProjectId: f.project.id, boardTaskId: task.id, feedbackRevisionId: first.revisionId };
  const source = await readJson(await f.host.request(f.route + '/source', 'POST', { target }));
  assert.equal(source.status, 'available');
  assert.deepEqual(source.target, target);
  assert.ok(source.text.includes('M5_FIXED_FEEDBACK_V1_ONLY'));
  assert.ok(!source.text.includes('M5_NEWER_FEEDBACK_NOT_SELECTED'));
  assert.ok(source.limitations.length > 0);
});

test('CD03 long partial feedback sources disclose the exact handoff observation independently of body pages', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const { item } = await readJson(await f.host.request('/api/decision-board/items', 'POST', { projectId: f.project.id, title: '长反馈来源建议', rationale: '合成资料' }), 201);
  await readJson(await f.host.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task } = await readJson(await f.host.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '长反馈来源行动' }), 201);
  const { feedback } = await readJson(await f.host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', {
    operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '"\\\n'.repeat(1300), metricDelta: '"\\\n'.repeat(300), review: '"\\\n'.repeat(1300), score: null, effect: 'unknown',
  }));
  const conditions = { sourceNature: 'synthetic', observationPeriod: '仅合成观察期；' + '甲'.repeat(3800), applicability: '只适用于本合成门店；' + '乙'.repeat(3800), limitations: '未核定效果或因果；' + '丙'.repeat(3800) };
  const { preview } = await readJson(await f.host.request('/api/decision-feedback/preview', 'POST', { boardTaskId: task.id, feedbackRevisionId: feedback.revisionId,
    question: '检查资料披露', taskName: '合成资料披露', ...conditions, materials: [{ id: 'feedback', kind: 'feedback', mode: 'full' }] }));
  const { handoff } = await readJson(await f.host.request('/api/decision-feedback/handoffs', 'POST', { operationId: randomUUID(), previewId: preview.previewId }), 201);
  const target = { type: 'feedback', sourceProjectId: f.project.id, boardTaskId: task.id, feedbackRevisionId: feedback.revisionId, handoffId: handoff.handoffId };
  const first = await readJson(await f.host.request(f.route + '/source', 'POST', { target }));
  assert.equal(first.status, 'available'); assert.equal(first.partial, true);
  assert.ok(!first.text.includes(conditions.limitations), 'the exact limitations fall outside the first body page');
  assert.deepEqual(first.observation, { handoffId: handoff.handoffId, ...conditions }, 'declared source nature and observation scope remain available before complete JSON is read');
  const second = await readJson(await f.host.request(f.route + '/source', 'POST', { target, continuation: first.continuation }));
  assert.deepEqual(second.observation, first.observation);
  assert.equal(first.range.end, second.range.start); assert.equal(second.partial, false);
  const complete = first.text + second.text;
  assert.deepEqual(JSON.parse(complete).feedback, feedback);
  assert.deepEqual(JSON.parse(complete).observation, first.observation);
  assert.equal(first.sha256, createHash('sha256').update(complete).digest('hex'));
  assert.equal(second.sha256, first.sha256);
  const { handoffId: _handoffId, ...feedbackOnly } = target;
  const withoutHandoff = await readJson(await f.host.request(f.route + '/source', 'POST', { target: feedbackOnly }));
  assert.equal(withoutHandoff.observation, undefined);
  assert.ok(withoutHandoff.limitations.some((value: string) => value.includes('未关联handoff')));
  const { feedback: newer } = await readJson(await f.host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', {
    operationId: randomUUID(), expectedLatestRevisionId: feedback.revisionId, adopted: true, outcome: '更新反馈不替代准确原文', effect: 'unknown',
  }));
  const mismatch = await readJson(await f.host.request(f.route + '/source', 'POST', { target: { ...target, feedbackRevisionId: newer.revisionId } }), 409);
  assert.equal(mismatch.code, 'case_decision_feedback_handoff_mismatch');
  const handoffFile = path.join(f.host.dataRoot, 'decision-feedback/handoffs', handoff.handoffId + '.json');
  await fs.rename(handoffFile, path.join(f.host.dataRoot, 'm5-retained-missing-handoff-' + handoff.handoffId + '.json'));
  const missing = await readJson(await f.host.request(f.route + '/source', 'POST', { target }));
  assert.equal(missing.status, 'unknown'); assert.equal(missing.code, 'case_decision_feedback_handoff_missing');
  assert.deepEqual(missing.target, target); assert.equal(missing.text, null); assert.equal(missing.observation, undefined);
  assert.equal(missing.partial, false); assert.equal(missing.continuation, null);
});

test('CD05/07 human HTTP choice binds an exact strategy and replays the same original choice after Case closure', { timeout: 30_000 }, async t => {
  const f = await fixture(t), revision = await seedStrategy(t, f);
  const strategyRef = { type: 'case-decision', caseStoreId: revision.caseStoreId, caseId: revision.caseId, recordId: revision.recordId, revision: revision.revision };
  const command = { operationId: randomUUID(), caseStoreId: revision.caseStoreId, strategyRef, choice: 'gather_evidence', reason: null, expectedPreviousChoiceId: null };
  const { choice } = await readJson(await f.host.request(`${f.route}/${revision.recordId}/choice`, 'POST', command));
  assert.deepEqual(choice.strategyRef, strategyRef);
  assert.equal(choice.actorKind, 'user');
  assert.equal(choice.choice, 'gather_evidence');
  const listing = await readJson(await f.host.request(f.route));
  assert.deepEqual(listing.choices, [choice]);
  await readJson(await f.host.request(`${f.route}/${revision.recordId}/choice`, 'POST', { ...command, operationId: randomUUID() }), 409);
  const current = await readJson(await f.host.request(`/api/cases/${f.record.id}`));
  await readJson(await f.host.request(`/api/cases/${f.record.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: current.case.revision, reason: '合成结束' }));
  assert.deepEqual((await readJson(await f.host.request(`${f.route}/${revision.recordId}/choice`, 'POST', command))).choice, choice);
  await readJson(await f.host.request(`${f.route}/${revision.recordId}/choice`, 'POST', { ...command, operationId: randomUUID(), expectedPreviousChoiceId: choice.choiceId }), 409);
  const operation = await readJson(await f.host.request(`/api/cases/operations/${command.operationId}`));
  assert.equal(operation.operation.phase, 'completed');
  assert.equal(operation.operation.result.choiceId, choice.choiceId);
});

test('CD02/06/09 human association and archive/restore append revisions and preserve the original Board observation on retry', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const { item } = await readJson(await f.host.request('/api/decision-board/items', 'POST', { projectId: f.project.id, title: '治理关联建议', rationale: '合成' }), 201);
  await readJson(await f.host.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task } = await readJson(await f.host.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '原真实行动', owner: '原负责人', note: '原备注' }), 201);
  const revision = await seedStrategy(t, f), route = `${f.route}/${revision.recordId}/governance`;
  const reference = { relation: 'action', target: { type: 'board-task', projectId: f.project.id, itemId: item.id, taskId: task.id }, note: null };
  const command = { operationId: randomUUID(), caseStoreId: revision.caseStoreId, expectedRevision: 1, action: 'add_reference', reference };
  const { revision: linked } = await readJson(await f.host.request(route, 'POST', command));
  assert.equal(linked.revision, 2); assert.equal(linked.origin.actorKind, 'user');
  assert.deepEqual(linked.payload, revision.payload);
  const savedAction = linked.references.find((r: any) => r.relation === 'action');
  assert.deepEqual(savedAction.target.observation, { updatedAt: task.updatedAt, title: task.title, owner: '原负责人', dueDate: null, status: 'todo', note: '原备注' });
  await readJson(await f.host.request(`/api/decision-board/tasks/${task.id}/status`, 'POST', { status: 'doing' }));
  assert.deepEqual((await readJson(await f.host.request(route, 'POST', command))).revision, linked, 'same op reads its original snapshot after the action changed');
  const duplicate = await readJson(await f.host.request(route, 'POST', { ...command, operationId: randomUUID(), expectedRevision: 2 }));
  assert.equal(duplicate.revision.revision, 2, 'the same relationship needs no extra card version');
  const archive = { operationId: randomUUID(), caseStoreId: revision.caseStoreId, expectedRevision: 2, action: 'archive' };
  const { revision: archived } = await readJson(await f.host.request(route, 'POST', archive));
  assert.equal(archived.revision, 3); assert.equal(archived.lifecycle, 'archived');
  assert.deepEqual((await readJson(await f.host.request(f.route))).items, []);
  const old = await readJson(await f.host.request(`${f.route}/${revision.recordId}/revisions/1`));
  assert.deepEqual(old.revision, revision); assert.deepEqual(old.current, { revision: 3, lifecycle: 'archived' });
  const { revision: restored } = await readJson(await f.host.request(route, 'POST', { operationId: randomUUID(), caseStoreId: revision.caseStoreId, expectedRevision: 3, action: 'restore' }));
  assert.equal(restored.revision, 4); assert.equal(restored.lifecycle, 'active');
  assert.deepEqual(restored.payload, revision.payload);
  assert.equal((await readJson(await f.host.request('/api/decision-board'))).items[0].tasks[0].status, 'doing');
  const current = await readJson(await f.host.request(`/api/cases/${f.record.id}`));
  await readJson(await f.host.request(`/api/cases/${f.record.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: current.case.revision, reason: '合成结束' }));
  assert.deepEqual((await readJson(await f.host.request(route, 'POST', archive))).revision, archived);
});

test('CD03 RAP source reads the exact semantic version and reports the identity of delivered projection bytes', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const created = await readJson(await f.host.request('/api/requirement-instances', 'POST', { title: 'M5准确RAP', scene: 'topic' }), 201);
  const sample = sampleWithoutSnapshotExport(), id = created.instance.id;
  const detail = await readJson(await f.host.request(`/api/requirement-instances/${id}`));
  const instance = { ...sample, instance: detail.instance.instance, context: { ...sample.context, goal: 'M5_RAP_1_9_FIXED' } };
  await readJson(await f.host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance }));
  await readJson(await f.host.request(`/api/requirement-instances/${id}/confirm`, 'POST', { confirmedBy: 'synthetic-reviewer' }));
  await readJson(await f.host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.9.0', releasedBy: 'synthetic-reviewer' }), 201);
  const later = await readJson(await f.host.request(`/api/requirement-instances/${id}`));
  later.instance.context.goal = 'M5_RAP_NEWER_DRAFT_NOT_SELECTED';
  await readJson(await f.host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: later.instance }));
  const target = { type: 'rap', instanceId: id, version: '1.9.0' };
  const source = await readJson(await f.host.request(f.route + '/source', 'POST', { target }));
  assert.equal(source.status, 'available');
  assert.ok(source.text.includes('M5_RAP_1_9_FIXED'));
  assert.ok(!source.text.includes('M5_RAP_NEWER_DRAFT_NOT_SELECTED'));
  assert.equal(source.sha256, createHash('sha256').update(source.text).digest('hex'), 'projection bytes and RAP semantic fingerprint have different identities');
});

test('CD03 exact Enterprise and M4 personal ports preserve old prose, page Unicode safely, and show missing originals as UNKNOWN', { timeout: 30_000 }, async t => {
  const f = await fixture(t), body = '甲'.repeat(23999) + '😀' + '乙'.repeat(12000) + 'M5_OLD_SOURCE_END';
  const created = await readJson(await f.host.request('/api/enterprise-materials', 'POST', { title: 'M5准确旧资料', body, scope: '合成资料范围' }), 201);
  const item = `/api/personal-retention/items/${created.material.id}`, editor = await readJson(await f.host.request(item + '/editor'));
  const retained = await readJson(await f.host.request(item + '/retain', 'POST', { operationId: randomUUID(), expectedRevision: 0, target: editor.draftTarget,
    metadata: { kind: 'knowledge', aliases: [], caution: '非事实核定', sourceRefs: [] }, personalLabel: null }), 201);
  const target = { type: 'source', source: { type: 'enterprise', ...retained.decision.contentRef } };
  const first = await readJson(await f.host.request(f.route + '/source', 'POST', { target }));
  assert.equal(first.partial, true); assert.equal(first.range.end, 23999);
  const second = await readJson(await f.host.request(f.route + '/source', 'POST', { target, continuation: first.continuation }));
  assert.equal(first.text + second.text, body);
  assert.equal(second.range.start, first.range.end);
  assert.equal(Buffer.from(first.text).toString('utf8'), first.text);
  const personal = { type: 'personal', target: { type: 'retained', ...retained.decision.contentRef, decisionId: retained.decision.operationId, expectedBodySha256: retained.decision.bodySha256 } };
  const personalFirst = await readJson(await f.host.request(f.route + '/source', 'POST', { target: personal }));
  assert.equal(personalFirst.status, 'available'); assert.equal(personalFirst.partial, true);
  const personalSecond = await readJson(await f.host.request(f.route + '/source', 'POST', { target: personal, continuation: personalFirst.continuation }));
  assert.ok(personalSecond.text.includes('M5_OLD_SOURCE_END'));
  const latest = await readJson(await f.host.request(`/api/enterprise-materials/${created.material.id}`));
  await readJson(await f.host.request(`/api/enterprise-materials/${created.material.id}`, 'PUT', { expectedVersion: latest.material.version, body: 'M5_NEWER_PROSE_MUST_NOT_REPLACE_OLD' }));
  const index = JSON.parse(await fs.readFile(path.join(f.host.dataRoot, 'enterprise-business-materials/index.json'), 'utf8'));
  const saved = index.materials.find((m: any) => m.id === created.material.id).revisions.find((r: any) => r.revisionId === retained.decision.contentRef.revisionId);
  const oldFile = path.join(f.host.dataRoot, 'enterprise-business-materials/bodies', saved.bodyFileId + '.txt');
  await fs.rename(oldFile, oldFile + '.retained-missing-fixture');
  const missing = await readJson(await f.host.request(f.route + '/source', 'POST', { target }));
  assert.equal(missing.status, 'unknown'); assert.equal(missing.text, null); assert.deepEqual(missing.target, target);
  await readJson(await f.host.request(f.route + '/source', 'POST', { target: { ...target, source: { ...target.source, storeId: randomUUID() } } }), 409);
  assert.equal((await readJson(await f.host.request(f.route))).items.length, 0, 'reading source does not manufacture Case records');
});

test('CD06 public governance rejects invented action observations and cross-Case targets, while global Case choice is not owned by an archived source project', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const { item } = await readJson(await f.host.request('/api/decision-board/items', 'POST', { projectId: f.project.id, title: '原建议', rationale: '合成' }), 201);
  await readJson(await f.host.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task } = await readJson(await f.host.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '原行动' }), 201);
  const revision = await seedStrategy(t, f), target = { type: 'board-task', projectId: f.project.id, itemId: item.id, taskId: task.id };
  const govern = { operationId: randomUUID(), caseStoreId: revision.caseStoreId, expectedRevision: 1, action: 'add_reference', reference: { relation: 'action', target: { ...target,
    observation: { updatedAt: new Date().toISOString(), title: '伪造快照', owner: null, dueDate: null, status: 'done', note: '' } }, note: null } };
  await readJson(await f.host.request(`${f.route}/${revision.recordId}/governance`, 'POST', govern), 400);
  const strategyRef = { type: 'case-decision', caseStoreId: revision.caseStoreId, caseId: revision.caseId, recordId: revision.recordId, revision: 1 };
  await readJson(await f.host.request(`${f.route}/${randomUUID()}/choice`, 'POST', { operationId: randomUUID(), caseStoreId: revision.caseStoreId, strategyRef, choice: 'trial', expectedPreviousChoiceId: null }), 409);
  await readJson(await f.host.request(`/api/projects/${f.project.id}/archive`, 'POST', {}));
  await readJson(await f.host.request(`${f.route}/${revision.recordId}/choice`, 'POST', { operationId: randomUUID(), caseStoreId: revision.caseStoreId, strategyRef, choice: 'defer', expectedPreviousChoiceId: null }));
  await readJson(await f.host.request(`${f.route}/${revision.recordId}/governance`, 'POST', { ...govern, operationId: randomUUID(), reference: { relation: 'action', target, note: null } }), 409);
  const current = await readJson(await f.host.request(`${f.route}/${revision.recordId}/revisions/1`));
  assert.equal(current.current.revision, 1, 'rejected writes did not alter the original card');
  assert.equal(current.revision.references.length, 0);
});

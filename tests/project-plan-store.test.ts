import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createProjectPlanStore } from '../src/host/project-plan-store.ts';
import type { ProjectPlanContent, ProjectPlanEffects } from '../src/host/project-plan-types.ts';
import { projectPlanPreparationInputHash } from '../src/host/project-plan-preparation.ts';
async function isolated(run: (dataRoot: string, projectId: string) => Promise<void>) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-project-plan-'));
  try { await run(dataRoot, randomUUID()); } finally { await rm(dataRoot, { recursive: true, force: true }); }
}
const content = (): ProjectPlanContent => ({
  request: '核对会员购买变化和可证实的解释', premises: ['首购历史待补；先核有独立依据的部分'],
  materials: [{ kind: 'project-file', id: '020_clean/member-list.csv', version: 'v1', sha256: 'a'.repeat(64) }],
  coverage: [{ key: 'member', label: '会员窗口与购买行为', disposition: 'focus', reason: '本轮重点', taskKeys: ['member'] }, { key: 'later', label: '长期能力', disposition: 'deferred', reason: '本轮不另建任务', taskKeys: [] }],
  tasks: [{ key: 'member', name: '会员购买变化', selected: true, scope: '核对交易窗口及群体数量', capabilities: [{ kind: 'skill', id: 'data-analysis', version: 'existing-v1' }] }],
  taskMode: 'single', summaryTaskKey: 'member', dependencies: [], caseContext: null,
});
test('an explicit direct goal purpose and exact version persist without inventing a Case or rewriting earlier plan history', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), original = content();
  const first = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: original });
  const plan = content(); plan.goalContext = { goal: { goalId: randomUUID(), version: 2 }, purpose: 'assigned-work' };
  const second = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: first.state.revision, plan });
  assert.deepEqual(second.draft.plan.goalContext, plan.goalContext); assert.equal(second.draft.plan.caseContext, null);
  const read = await createProjectPlanStore({ dataRoot }).read(projectId); assert.deepEqual(read.draft!.plan.goalContext, plan.goalContext);
  assert.deepEqual(read.history, []); assert.deepEqual(first.draft.plan, original);
}));
test('query, asset construction and assigned work retain direct goal scope while a Case investigation cannot be confirmed without its Case', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), goal = { goalId: randomUUID(), version: 1 }, invalid = content();
  invalid.goalContext = { goal, purpose: 'case-investigation' };
  await assert.rejects(store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: invalid }), { code: 'invalid_project_plan_goal_context' });
  assert.equal((await store.read(projectId)).revision, 0);
  let revision = 0;
  for (const purpose of ['query', 'asset-construction', 'assigned-work'] as const) {
    const plan = content(); plan.goalContext = { goal, purpose };
    const saved = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: revision, plan }); revision = saved.state.revision;
    assert.equal(saved.draft.plan.caseContext, null); assert.deepEqual(saved.draft.plan.goalContext, { goal, purpose });
  }
}));
test('an invalid non-string goal purpose is rejected as a malformed plan without invoking supplied coercion or changing storage', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), plan = content();
  Object.assign(plan, { goalContext: { goal: { goalId: randomUUID(), version: 1 }, purpose: { toString: 'not a function' } } });
  await assert.rejects(store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan }), { code: 'invalid_project_plan_goal_context' });
  assert.equal((await store.read(projectId)).revision, 0);
}));
test('prepared drafts persist the original seed hash and editable output in the existing operation receipt without confirming or executing', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), seed = { operationId: randomUUID(), expectedRevision: 0, plan: content() }, plan = content(); plan.premises.push('Agent仅列出待补证条件');
  const input = { ...seed, plan, requestHash: projectPlanPreparationInputHash(seed), mece: { sameLevel: '按问题对象', coverage: '开放补充', boundaries: '保留交叉限制', depth: '轻量前置' }, limitations: ['仍未读取明细'] };
  const result = await store.savePreparedDraft(projectId, input);
  assert.equal(result.draft.version, 1); assert.equal(result.state.confirmed, undefined); assert.deepEqual(result.state.history, []);
  assert.equal(result.state.operations?.[0].kind, 'prepare'); assert.equal(result.state.operations?.[0].requestHash, input.requestHash);
  assert.deepEqual(result.state.preparations?.[0], { operationId: seed.operationId, inputHash: input.requestHash, status: 'completed', draftVersion: 1, mece: input.mece, limitations: input.limitations });
  const reopened = createProjectPlanStore({ dataRoot }), replay = await reopened.savePreparedDraft(projectId, input);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.draft.plan, plan);
  await assert.rejects(reopened.savePreparedDraft(projectId, { ...input, requestHash: 'a'.repeat(64) }), { code: 'project_plan_operation_conflict' });
  assert.equal((await reopened.read(projectId)).draft?.version, 1);
}));

test('a lightweight project draft keeps scope, coverage, abilities and sources across reopen without confirming it', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot });
  assert.deepEqual(await store.read(projectId), { formatVersion: 1, projectId, revision: 0, history: [] });
  const plan = content(), saved = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan });
  assert.equal(saved.replayed, false); assert.equal(saved.draft.version, 1);
  const read = await createProjectPlanStore({ dataRoot }).read(projectId);
  assert.deepEqual(read.draft?.plan, plan); assert.equal(read.confirmed, undefined); assert.deepEqual(read.history, []);
}));


test('confirm-create fixes the accurate plan and creates only participating Tasks without starting execution', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), plan = content(), created: string[] = [], starts: string[] = [];
  const effects: ProjectPlanEffects = { readTask: async (_project, id) => ({ id }), createTask: async input => { created.push(input.taskId); return { taskId: input.taskId }; }, startTask: async input => { starts.push(input.taskId); return { status: 'accepted' }; } };
  const saved = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan });
  const input = { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'create' as const };
  const result = await store.confirm(projectId, input, effects);
  assert.equal(result.replayed, false); assert.equal(created.length, 1); assert.deepEqual(starts, []);
  assert.equal(result.confirmation.tasks[0].createStatus, 'created'); assert.equal(result.confirmation.tasks[0].startStatus, 'not-requested');
  assert.equal(result.confirmation.plan.caseContext, null);
  const later = content(); later.request = '后续未确认草稿';
  await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: result.state.revision, plan: later });
  const current = await createProjectPlanStore({ dataRoot }).read(projectId);
  assert.equal(current.draft?.plan.request, '后续未确认草稿'); assert.equal(current.confirmed?.plan.request, plan.request);
  const replayed = await store.confirm(projectId, input, effects);
  assert.equal(replayed.replayed, true); assert.equal(created.length, 1); assert.deepEqual(starts, []);
}));

test('confirm-start reuses the same confirmed Tasks after create-only and admits each selected and summary Task once', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), plan = content(), summaryId = randomUUID();
  plan.taskMode = 'multi'; plan.tasks.push({ key: 'evidence', name: '商品与外部证据', selected: true, scope: '多类证据核对', capabilities: [] }, { key: 'summary', name: '已有综合Task', selected: false, taskId: summaryId, scope: '核分歧与共同依据', capabilities: [] }); plan.summaryTaskKey = 'summary';
  const created: string[] = [], starts: { taskId: string; requestId: string }[] = [];
  const effects: ProjectPlanEffects = { readTask: async (_project, id) => ({ id }), createTask: async input => { created.push(input.taskId); return { taskId: input.taskId }; }, startTask: async input => { starts.push({ taskId: input.taskId, requestId: input.requestId }); return { status: 'accepted' }; } };
  const draft = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan });
  const createdOnly = await store.confirm(projectId, { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'create' }, effects);
  assert.equal(created.length, 2); assert.equal(starts.length, 0);
  const input = { operationId: randomUUID(), expectedRevision: createdOnly.state.revision, mode: 'start' as const };
  const started = await store.confirm(projectId, input, effects);
  assert.equal(created.length, 2); assert.equal(starts.length, 3); assert.equal(new Set(starts.map(item => item.requestId)).size, 3);
  assert.equal(started.confirmation.id, createdOnly.confirmation.id); assert.equal(started.state.history.length, 1);
  assert.ok(started.confirmation.tasks.every(item => item.startStatus === 'accepted'));
  const repeated = await store.confirm(projectId, input, effects);
  assert.equal(repeated.replayed, true); assert.equal(starts.length, 3);
}));

test('a created Task archived before explicit start cannot be promoted or dispatched', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }); let archived = false, starts = 0;
  const effects: ProjectPlanEffects = { readTask: async (_project, id) => ({ id, ...(archived ? { archivedAt: new Date().toISOString() } : {}) }), createTask: async input => ({ taskId: input.taskId }), startTask: async () => { starts++; return { status: 'accepted' }; } };
  const draft = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: content() });
  const created = await store.confirm(projectId, { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'create' }, effects);
  archived = true;
  await assert.rejects(store.confirm(projectId, { operationId: randomUUID(), expectedRevision: created.state.revision, mode: 'start' }, effects), { code: 'project_plan_task_unavailable' });
  assert.equal(starts, 0); assert.equal((await store.read(projectId)).confirmed?.mode, 'create');
}));

test('uncertain creates are read back without replay, and an explicit later start continues only verified pending work', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }); let creates = 0, starts = 0; const actual = new Map<string, { id: string }>();
  const effects: ProjectPlanEffects = { readTask: async (_project, id) => { const task = actual.get(id); if (!task) throw new Error('not_found'); return task; }, createTask: async input => { creates++; actual.set(input.taskId, { id: input.taskId }); throw new Error('response lost after save'); }, startTask: async () => { starts++; return { status: 'accepted' }; } };
  const draft = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: content() });
  const input = { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'start' as const };
  const uncertain = await store.confirm(projectId, input, effects), receipt = uncertain.confirmation.tasks[0];
  assert.equal(receipt.createStatus, 'unknown'); assert.equal(starts, 0);
  const replayed = await createProjectPlanStore({ dataRoot }).confirm(projectId, input, effects);
  assert.equal(replayed.replayed, true); assert.equal(creates, 1); assert.equal(starts, 0);
  await assert.rejects(store.recordTaskResult(projectId, { confirmationId: uncertain.confirmation.id, taskKey: receipt.taskKey, taskId: randomUUID(), phase: 'create', requestId: receipt.createRequestId, status: 'created' }), { code: 'project_plan_result_conflict' });
  const verified = await store.recordTaskResult(projectId, { confirmationId: uncertain.confirmation.id, taskKey: receipt.taskKey, taskId: receipt.taskId, phase: 'create', requestId: receipt.createRequestId, status: 'created' });
  const continued = await store.confirm(projectId, { operationId: randomUUID(), expectedRevision: verified.revision, mode: 'start' }, effects);
  assert.equal(continued.confirmation.tasks[0].startStatus, 'accepted'); assert.equal(creates, 1); assert.equal(starts, 1);
  assert.ok(continued.confirmation.tasks[0].observations.some(observation => observation.status === 'unknown'));
}));

test('a revised draft keeps already materialized Task identities instead of creating the same planned Task again', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), plan = content(); let creates = 0;
  const effects: ProjectPlanEffects = { readTask: async (_project, id) => ({ id }), createTask: async input => { creates++; return { taskId: input.taskId }; }, startTask: async () => ({ status: 'accepted' }) };
  const first = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan });
  const original = await store.confirm(projectId, { operationId: randomUUID(), expectedRevision: first.state.revision, mode: 'create' }, effects);
  const revised = content(); revised.premises.push('只修订受影响的项目说明');
  const next = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: original.state.revision, plan: revised });
  assert.equal(next.draft.plan.tasks[0].taskId, original.confirmation.tasks[0].taskId);
  await store.confirm(projectId, { operationId: randomUUID(), expectedRevision: next.state.revision, mode: 'create' }, effects);
  assert.equal(creates, 1); assert.equal(original.confirmation.plan.tasks[0].taskId, undefined);
}));


test('known failure and cancellation stay distinct while independent selected Tasks continue', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), plan = content(); plan.taskMode = 'multi';
  plan.tasks.push({ key: 'cancelled', name: '已取消的任务', selected: true, scope: '保留取消', capabilities: [] }, { key: 'independent', name: '独立可推进部分', selected: true, scope: '独立依据', capabilities: [] });
  const starts: string[] = [];
  const effects: ProjectPlanEffects = { readTask: async (_project, id) => ({ id }), createTask: async input => input.task.key === 'member' ? { status: 'failed', code: 'configuration_missing' } : input.task.key === 'cancelled' ? { status: 'cancelled', code: 'operation_cancelled' } : { taskId: input.taskId }, startTask: async input => { starts.push(input.task.key); return { status: 'accepted' }; } };
  const draft = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan });
  const input = { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'start' as const }, result = await store.confirm(projectId, input, effects);
  assert.deepEqual(starts, ['independent']);
  assert.equal(result.confirmation.tasks.find(item => item.taskKey === 'member')?.createStatus, 'failed');
  assert.equal(result.confirmation.tasks.find(item => item.taskKey === 'cancelled')?.createStatus, 'cancelled');
  assert.equal(result.confirmation.tasks.find(item => item.taskKey === 'member')?.startStatus, 'not-requested');
  assert.equal((await store.confirm(projectId, input, effects)).replayed, true); assert.deepEqual(starts, ['independent']);
}));

test('invalid summary responsibility and missing existing Task references do not create or start any Task', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }); let creates = 0, starts = 0;
  const effects: ProjectPlanEffects = { readTask: async () => { throw new Error('task_not_found'); }, createTask: async input => { creates++; return { taskId: input.taskId }; }, startTask: async () => { starts++; return { status: 'accepted' }; } };
  const unselected = content(); unselected.taskMode = 'multi'; unselected.tasks.push({ key: 'unselected', name: '未选且未创建', selected: false, scope: '', capabilities: [] }); unselected.summaryTaskKey = 'unselected';
  await assert.rejects(store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: unselected }), { code: 'invalid_project_plan_summary' });
  const missing = content(); missing.tasks[0].taskId = randomUUID();
  const draft = await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: missing });
  await assert.rejects(store.confirm(projectId, { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'start' }, effects), /task_not_found/);
  assert.equal(creates, 0); assert.equal(starts, 0); assert.equal((await store.read(projectId)).confirmed, undefined);
}));

test('draft CAS and operation receipts prevent stale overwrite or changed-payload reuse', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), plan = content(), input = { operationId: randomUUID(), expectedRevision: 0, plan };
  const saved = await store.saveDraft(projectId, input);
  assert.equal((await store.saveDraft(projectId, input)).replayed, true);
  await assert.rejects(store.saveDraft(projectId, { ...input, plan: { ...plan, request: '同ID换正文' } }), { code: 'project_plan_operation_conflict' });
  await assert.rejects(store.saveDraft(projectId, { ...input, operationId: randomUUID() }), { code: 'project_plan_conflict' });
  assert.equal((await store.read(projectId)).revision, saved.state.revision);
}));

test('a future persisted plan stays explicit and is never overwritten during reads or draft saves', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }); await store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: content() });
  const file = path.join(dataRoot, 'project-plans', projectId + '.json'), future = JSON.parse(await readFile(file, 'utf8')); future.formatVersion = 2; const bytes = JSON.stringify(future);
  await writeFile(file, bytes);
  await assert.rejects(store.read(projectId), { code: 'project_plan_corrupt' });
  await assert.rejects(store.saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: content() }), { code: 'project_plan_corrupt' });
  assert.equal(await readFile(file, 'utf8'), bytes);
}));


test('read-only operation projection identifies original drafts and confirms without exposing or replacing intents', () => isolated(async (dataRoot, projectId) => {
  const store = createProjectPlanStore({ dataRoot }), plan = content(), operationId = randomUUID();
  plan.caseContext = { caseId: randomUUID(), primaryGoal: { goalId: randomUUID(), version: 2 }, caseRevision: 4, projectWorkRevision: 0 };
  const saved = await store.saveDraft(projectId, { operationId, expectedRevision: 0, plan });
  const before = (await store.read(projectId)).revision, read = await store.read(projectId);
  assert.deepEqual(read.operations?.map(({ requestHash, ...operation }) => operation), [{ operationId, kind: 'draft', planVersion: 1 }]);
  assert.match(read.operations![0].requestHash!, /^[a-f0-9]{64}$/);
  assert.equal(read.revision, before); assert.deepEqual(read.draft?.plan.caseContext, plan.caseContext);
  assert.equal((await store.saveDraft(projectId, { operationId, expectedRevision: 0, plan })).replayed, true);
  assert.equal((await store.read(projectId)).revision, saved.state.revision);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
const configuration: ProjectConfiguration = { id: 'synthetic-model', revision: 1, name: 'Synthetic', provider: 'openai-compatible', model: 'synthetic-model', baseUrl: 'http://127.0.0.1:1' };
async function fixture(t: { after: (run: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-task-lifecycle-'));
  const options = { dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') };
  const store = new ProjectStore(options); await store.init();
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await store.create({ name: '本轮任务生命周期', configuration });
  const task = await store.createTask(project.id, { name: '保留原任务' });
  return { root, options, store, project, task };
}

test('archiving one Task preserves its identity, draft and native bytes while other Tasks stay writable', async t => {
  const { store, project, task } = await fixture(t), other = await store.createTask(project.id, { name: '另一任务' });
  await store.saveDraft(project.id, task.id, '保留原稿');
  const native = path.join(task.sessionDirectory, 'synthetic.jsonl'); await fs.writeFile(native, 'retain native bytes\n');
  await store.setSession(project.id, task.id, native);
  const archived = await store.archiveTask(project.id, task.id);
  assert.ok(archived.archivedAt); assert.equal(archived.id, task.id); assert.equal(archived.sessionFile, native);
  assert.equal((await store.archiveTask(project.id, task.id)).archivedAt, archived.archivedAt);
  assert.equal((await store.getTask(project.id, task.id)).draft, '保留原稿');
  assert.equal(await fs.readFile(native, 'utf8'), 'retain native bytes\n');
  await store.saveDraft(project.id, other.id, '正常继续');
  await assert.rejects(store.saveDraft(project.id, task.id, '禁止写入'), /task_archived/);
});

test('Task restore retains the original session and never starts a run', async t => {
  const { store, options, project, task } = await fixture(t);
  const native = path.join(task.sessionDirectory, 'synthetic.jsonl'); await fs.writeFile(native, 'same native\n'); await store.setSession(project.id, task.id, native);
  await store.archiveTask(project.id, task.id); await store.close();
  const reopened = new ProjectStore(options); await reopened.init();
  try {
    assert.ok((await reopened.getTask(project.id, task.id)).archivedAt);
    const restored = await reopened.restoreTask(project.id, task.id);
    assert.equal(restored.archivedAt, null); assert.equal(restored.id, task.id); assert.equal(restored.sessionFile, native); assert.equal(restored.lastRun, undefined);
    assert.equal((await reopened.restoreTask(project.id, task.id)).updatedAt, restored.updatedAt);
    await reopened.saveDraft(project.id, task.id, '明确恢复后继续');
  } finally { await reopened.close(); }
});

test('running and Host-occupied Tasks cannot archive; archived Task and project writes remain closed', async t => {
  const { store, options, project, task } = await fixture(t);
  await store.markRun(project.id, task.id, { id: randomUUID(), status: 'running', startedAt: new Date().toISOString() });
  await assert.rejects(store.archiveTask(project.id, task.id), /task_busy/);
  await store.markRun(project.id, task.id, { id: randomUUID(), status: 'completed', startedAt: new Date().toISOString(), settledAt: new Date().toISOString() });
  await assert.rejects(store.archiveTask(project.id, task.id, { isBusy: () => true }), /task_busy/);
  await store.archiveTask(project.id, task.id);
  const before = await fs.readFile(path.join(options.dataRoot, 'projects', project.id, 'project.json'));
  await assert.rejects(store.setTaskCapability(project.id, task.id, 'modelTools', true), /task_archived/);
  await assert.rejects(store.appendReviewToDraft(project.id, task.id, randomUUID(), '不要写入'), /task_archived/);
  await assert.rejects(store.markRun(project.id, task.id, { id: randomUUID(), status: 'running', startedAt: new Date().toISOString() }), /task_archived/);
  assert.deepEqual(await fs.readFile(path.join(options.dataRoot, 'projects', project.id, 'project.json')), before);
  await store.archive(project.id);
  await assert.rejects(store.restoreTask(project.id, task.id), /project_archived/);
  await assert.rejects(store.archiveTask(project.id, task.id), /project_archived/);
});

test('old Tasks without archive fields are read without metadata rewrites; invalid future archive data stays explicit', async t => {
  const { store, options, project, task } = await fixture(t);
  const file = path.join(options.dataRoot, 'projects', project.id, 'project.json'), bytes = await fs.readFile(file);
  assert.equal('archivedAt' in await store.getTask(project.id, task.id), false);
  assert.deepEqual(await fs.readFile(file), bytes);
  const invalid = JSON.parse(bytes.toString()); invalid.tasks[0].archivedAt = { future: true }; const changed = JSON.stringify(invalid);
  await fs.writeFile(file, changed);
  await assert.rejects(store.getTask(project.id, task.id), /invalid_project_metadata/);
  assert.equal(await fs.readFile(file, 'utf8'), changed);
});

test('a repeated plan creation reuses its Task after later user edits and rejects another origin', async t => {
  const { store, project } = await fixture(t), taskId = randomUUID();
  const input = { taskId, name: '由方案创建', draft: '原方案背景', planOrigin: { confirmationId: randomUUID(), taskKey: 'member-analysis', requestHash: 'a'.repeat(64) } };
  const created = await store.createTaskWithPlan(project.id, input);
  await store.saveDraft(project.id, created.id, '人工后续草稿');
  const replayed = await store.createTaskWithPlan(project.id, input);
  assert.equal(replayed.id, created.id); assert.equal(replayed.draft, '人工后续草稿');
  assert.equal((await store.get(project.id)).tasks.filter(task => task.id === taskId).length, 1);
  await assert.rejects(store.createTaskWithPlan(project.id, { ...input, planOrigin: { ...input.planOrigin, confirmationId: randomUUID() } }), /plan_origin_conflict/);
});

test('an interrupted Task outcome remains unknown and cannot be archived as idle', async t => {
  const { store, project, task } = await fixture(t);
  const outcome = { id: randomUUID(), status: 'interrupted' as const, startedAt: new Date().toISOString(), settledAt: new Date().toISOString() };
  await store.markRun(project.id, task.id, outcome);
  await assert.rejects(store.archiveTask(project.id, task.id), /task_outcome_unknown/);
  assert.equal((await store.getTask(project.id, task.id)).archivedAt, undefined);
  assert.deepEqual((await store.getTask(project.id, task.id)).lastRun, outcome);
});

test('plan-created Tasks inherit only the capability flags explicitly supplied by the Host', async t => {
  const { store, project } = await fixture(t);
  const origin = { confirmationId: randomUUID(), taskKey: 'permission-inheritance', requestHash: 'b'.repeat(64) };
  const created = await store.createTaskWithPlan(project.id, { taskId: randomUUID(), name: '明确能力', planOrigin: origin, weatherTools: true, tradeAreaTools: false, simulationTools: true, modelTools: false });
  assert.equal(created.weatherTools, true); assert.equal(created.simulationTools, true);
  assert.equal(created.tradeAreaTools, undefined); assert.equal(created.modelTools, undefined);
  assert.equal((await store.getTask(project.id, created.id)).weatherTools, true);
});

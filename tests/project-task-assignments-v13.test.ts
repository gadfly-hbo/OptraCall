import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ProjectStore } from '../src/host/project-store.ts';
import { makeTaskAssignment, taskTypes } from '../src/host/task-assignment.ts';

const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic', name: 'Synthetic', baseUrl: 'https://example.invalid' };
test('six manual task types survive reload, same-type tasks keep separate sessions, and absent historical type remains unknown', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-manual-task-'));
  const store = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await store.init();
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const project = await store.create({ name: '合成独立项目', configuration });
  const legacy = await store.createTask(project.id, { name: '历史任务' });
  const types = [...taskTypes, 'analysis'] as const;
  for (const type of types) {
    const task = await store.createTask(project.id, { name: type, assignment: makeTaskAssignment(type, false) });
    assert.equal((await store.getTask(project.id, task.id)).assignment?.type, type);
  }
  const tasks = (await store.get(project.id)).tasks;
  assert.equal(tasks.length, 8);
  assert.equal(new Set(tasks.map(x => x.sessionDirectory)).size, 8);
  assert.equal((await store.getTask(project.id, legacy.id)).assignment, undefined);
  assert.throws(() => makeTaskAssignment('plan', true), /skill_unavailable/);
  assert.equal(makeTaskAssignment('analysis', true).skill?.sha256, '05402899ac630de257799686828ae4b8a5f2ec1056427f711cc79a9eaf6ce0f6');
  const operationId = randomUUID();
  const agreement = await store.confirmAgreement(project.id, { operationId, expectedVersion: 0, text: '按单会员口径核对' });
  assert.equal(agreement.version, 1);
  assert.deepEqual(await store.confirmAgreement(project.id, { operationId, expectedVersion: 0, text: agreement.text }), agreement);
  assert.equal((await store.get(project.id)).tasks.length, 8);
  const create = { operationId: randomUUID(), name: '共用约定', assignment: { ...makeTaskAssignment('analysis', false), agreementVersion: 1 } };
  const participating = await store.createTask(project.id, create);
  await store.confirmAgreement(project.id, { operationId: randomUUID(), expectedVersion: 1, text: '改为家庭粒度' });
  const replayed = await store.createTask(project.id, create);
  assert.equal(replayed.id, participating.id);
  await assert.rejects(store.createTask(project.id, { ...create, name: '不同请求' }), /creation_changed/);
  const saved = await store.get(project.id);
  assert.equal(saved.tasks.find(x => x.id === participating.id)?.assignment?.agreementVersion, 1);
  assert.equal(saved.agreements?.[0]?.text, agreement.text);
  await assert.rejects(store.confirmAgreement(project.id, { operationId: randomUUID(), expectedVersion: 1, text: '冲突' }), /agreement_changed/);
  await assert.rejects(store.createTask(project.id, { name: '过期选择', assignment: { ...makeTaskAssignment('plan', false), agreementVersion: 1 } }), /agreement_changed/);
});

test('an independent project can set optional stage terms and complete a stage without touching its working Tasks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-stage-'));
  const store = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await store.init(); t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const project = await store.create({ name: '阶段项目', configuration });
  const task = await store.createTask(project.id, { name: '既有工作' });
  await store.saveDraft(project.id, task.id, '已有草稿');
  const input = { expectedVersion: 0, operationId: randomUUID(), goal: '解释复购下滑', condition: '明确可检验的原因', done: false };
  const v1 = await store.setStage(project.id, input);
  assert.equal(v1.version, 1);
  assert.equal((await store.setStage(project.id, input)).operationId, v1.operationId);
  await assert.rejects(store.setStage(project.id, { ...input, expectedVersion: 1, operationId: randomUUID(), done: true, goal: '其他目标' }), /stage_changed/);
  const v2 = await store.setStage(project.id, { ...input, expectedVersion: 1, operationId: randomUUID(), done: true });
  assert.equal(v2.done, true);
  assert.equal((await store.get(project.id)).stages?.[0]?.done, false);
  assert.equal((await store.getTask(project.id, task.id)).draft, '已有草稿');
});

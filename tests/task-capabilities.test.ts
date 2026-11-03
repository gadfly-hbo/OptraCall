import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';

test('task capabilities persist independently and schema2 read leaves existing bytes untouched', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-task-capabilities-'));
  const options = { dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') };
  const store = new ProjectStore(options); await store.init(); t.after(() => store.close());
  const project = await store.create({ name: '合成能力项目', configuration: { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic-model', name: '合成模型', baseUrl: 'https://invalid.example' } });
  const ordinary = await store.createTask(project.id, { name: '旧默认任务' });
  const enabled = await store.createTask(project.id, { name: '独立双能力', simulationTools: true, tradeAreaTools: true });
  assert.equal(enabled.tradeAreaTools, true, 'explicit connector choice must survive create/read');
  assert.equal(enabled.simulationTools, true);
  assert.equal(ordinary.tradeAreaTools, undefined);
  const file = path.join(options.dataRoot, 'projects', project.id, 'project.json');
  const before = await readFile(file);
  await store.close();
  const reopened = new ProjectStore(options); await reopened.init(); t.after(() => reopened.close());
  assert.equal((await reopened.getTask(project.id, enabled.id)).tradeAreaTools, true);
  assert.equal((await reopened.getTask(project.id, ordinary.id)).simulationTools, undefined);
  assert.deepEqual(await readFile(file), before, 'reading schema2 must not migrate or rewrite old metadata');
});

test('WX06: weather capability is independent and old schema2 metadata stays untouched', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-weather-capability-'));
  const options = { dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') };
  const store = new ProjectStore(options); await store.init(); t.after(() => store.close());
  const project = await store.create({ name: '合成天气能力项目', configuration: { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic-model', name: '合成模型', baseUrl: 'https://invalid.example' } });
  const legacy = await store.createTask(project.id, { name: '已有无天气任务' });
  const enabled = await store.createTask(project.id, { name: '三能力独立', simulationTools: true, tradeAreaTools: true, weatherTools: true });
  assert.equal(enabled.weatherTools, true);
  await store.setTaskCapability(project.id, enabled.id, 'weatherTools', false);
  const disabled = await store.getTask(project.id, enabled.id);
  assert.equal(disabled.weatherTools, undefined); assert.equal(disabled.tradeAreaTools, true); assert.equal(disabled.simulationTools, true);
  await store.setTaskCapability(project.id, enabled.id, 'weatherTools', true);
  const file = path.join(options.dataRoot, 'projects', project.id, 'project.json'), before = await readFile(file);
  await store.close(); const reopened = new ProjectStore(options); await reopened.init(); t.after(() => reopened.close());
  assert.equal((await reopened.getTask(project.id, enabled.id)).weatherTools, true);
  assert.equal((await reopened.getTask(project.id, legacy.id)).weatherTools, undefined);
  assert.deepEqual(await readFile(file), before);
});

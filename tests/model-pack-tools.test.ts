import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelPackTools } from '../src/agent/model-pack-tools.ts';
import { ModelPackStore } from '../src/host/model-pack-store.ts';

function toolsAt(root: string) {
  return createModelPackTools({ modelsRoot: path.join(root, 'models'), projectRoot: path.join(root, 'project') });
}
async function call(tools: ReturnType<typeof toolsAt>, name: string, parameters: unknown = {}, signal?: AbortSignal) {
  const tool = tools.find(item => item.name === name); assert.ok(tool);
  const value = await tool.execute('synthetic-call', parameters as never, signal, () => {}, {} as never);
  const envelope = JSON.parse(value.content.filter(item => item.type === 'text').map(item => item.text).join(''));
  assert.deepEqual(value.details, envelope);
  return { value, envelope };
}

test('MP05: listing a missing registry is read-only and returns an empty shelf', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-modelpack-list-')));
  const { value, envelope } = await call(toolsAt(root), 'modelpack_list');
  assert.deepEqual(envelope, { status: 'succeeded', data: { models: [] } });
  assert.equal(value.isError, undefined);
  assert.deepEqual(await readdir(root), [], 'listing must not create models, SQLite or any other file');
});

test('MP06: public tool rejects arbitrary model paths, extra execution paths and invalid versions', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-modelpack-arguments-')));
  const tools = toolsAt(root), valid = { name: 'synthetic-forecast', inputPath: '020_clean/input.json', outputPath: '060_reports/output.json' };
  for (const name of ['../../outside/predict.mjs', '/tmp/predict.mjs', 'file:///tmp/predict.mjs', 'x', 'FORECAST']) {
    const { value, envelope } = await call(tools, 'modelpack_predict', { ...valid, name });
    assert.equal(value.isError, true); assert.equal(envelope.code, 'MODEL_NAME_INVALID');
  }
  for (const version of [0, -1, 1.5, '1', null]) {
    const { envelope } = await call(tools, 'modelpack_predict', { ...valid, version });
    assert.equal(envelope.code, 'MODEL_VERSION_INVALID');
  }
  for (const extra of [{ modelPath: '/tmp/predict.mjs' }, { projectRoot: '/tmp' }, { modelsRoot: '/tmp' }]) {
    assert.equal((await call(tools, 'modelpack_predict', { ...valid, ...extra })).envelope.code, 'MODEL_ARGUMENTS_INVALID');
  }
  assert.equal((await call(tools, 'modelpack_list', { modelsRoot: '/tmp' })).envelope.code, 'MODEL_ARGUMENTS_INVALID');
  assert.deepEqual(await readdir(root), []);
});

async function install(root: string, version = 1) {
  const source = path.join(root, `source-${version}`);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ formatVersion: 1, model: { name: 'synthetic-forecast', version, stage: 'Staging' }, goal: 'Synthetic deterministic arithmetic only', data: { fingerprint: { sha256: 'a'.repeat(64), rows: 3, columns: ['x', 'forecast'] } }, metrics: { mae: 0.25 }, training: { splitSeed: 42, task: 'regression', targets: ['forecast'], trainedAt: '2026-11-05T00:00:00.000Z', sessionRef: 'synthetic-session' }, usage: { inputs: ['x'], outputs: ['forecast'], form: 'predict(rows) -> rows' } }));
  await writeFile(path.join(source, 'predict.mjs'), `export function predict(rows) { return rows.map(row => ({...row, forecast: Number(row.x ?? 0) * 2 + ${version}})); }\n`);
  await writeFile(path.join(source, 'README.md'), 'Synthetic fixture only.');
  const store = new ModelPackStore(path.join(root, 'models'));
  try { return await store.importPack(source); } finally { store.close(); }
}

test('MP05/06: real read-only tools preserve shelf, select Production or explicit Staging, and return deterministic provenance', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-modelpack-tools-')));
  for (const dir of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(root, 'project', dir), { recursive: true });
  await install(root, 1); await install(root, 2);
  const management = new ModelPackStore(path.join(root, 'models'));
  management.promote('synthetic-forecast', 1); management.close();
  const tools = toolsAt(root);
  const list = (await call(tools, 'modelpack_list')).envelope;
  assert.equal(list.status, 'succeeded'); assert.equal(list.data.models.length, 2);
  for (const model of list.data.models) {
    assert.equal(model.name, 'synthetic-forecast'); assert.deepEqual(model.metrics, { mae: 0.25 });
    assert.deepEqual(model.usage.inputs, ['x']);
    assert.equal(model.sourcePath, undefined); assert.equal(model.snapshotSha256, undefined);
  }
  await writeFile(path.join(root, 'project/020_clean/input.json'), JSON.stringify([{ x: 10 }, { x: 20 }]));
  const first = (await call(tools, 'modelpack_predict', { name: 'synthetic-forecast', inputPath: '020_clean/input.json', outputPath: '060_reports/output.json' })).envelope;
  assert.equal(first.status, 'succeeded'); assert.equal(first.data.rows, 2);
  assert.equal(first.data.model.version, 1); assert.equal(first.data.model.stage, 'Production');
  assert.equal(first.data.model.sourcePath, undefined);
  assert.deepEqual(first.data.provenance.metrics, { mae: 0.25 });
  assert.equal(first.data.provenance.fingerprint.sha256, 'a'.repeat(64));
  assert.equal(first.data.provenance.name, 'synthetic-forecast');
  assert.equal(first.data.provenance.version, 1); assert.equal(first.data.provenance.stage, 'Production');
  assert.equal(first.data.provenance.trainedAt, '2026-11-05T00:00:00.000Z');
  const firstBytes = await readFile(path.join(root, 'project/060_reports/output.json'), 'utf8');
  await call(tools, 'modelpack_predict', { name: 'synthetic-forecast', inputPath: '020_clean/input.json', outputPath: '060_reports/repeat.json' });
  assert.equal(await readFile(path.join(root, 'project/060_reports/repeat.json'), 'utf8'), firstBytes);
  assert.deepEqual(JSON.parse(firstBytes).map((row: { forecast: number }) => row.forecast), [21, 41]);
  const staging = (await call(tools, 'modelpack_predict', { name: 'synthetic-forecast', version: 2, inputPath: '020_clean/input.json', outputPath: '020_clean/staging.json' })).envelope;
  assert.equal(staging.status, 'succeeded'); assert.equal(staging.data.model.stage, 'Staging'); assert.equal(staging.data.model.version, 2);
  assert.deepEqual((await call(tools, 'modelpack_list')).envelope, list, 'predictions must not mutate registry stage or metadata');
  const next = new ModelPackStore(path.join(root, 'models')); next.promote('synthetic-forecast', 2); next.close();
  const archived = await call(tools, 'modelpack_predict', { name: 'synthetic-forecast', version: 1, inputPath: '020_clean/input.json', outputPath: '060_reports/archived.json' });
  assert.equal(archived.value.isError, true); assert.equal(archived.envelope.status, 'rejected');
  assert.match(archived.envelope.code, /ARCHIVED/);
});

test('MP06: project input/output violations and cancellation return actionable failure envelopes without outputs', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-modelpack-failure-')));
  for (const dir of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(root, 'project', dir), { recursive: true });
  await install(root);
  await writeFile(path.join(root, 'project/020_clean/input.json'), '[{"x":10}]');
  await writeFile(path.join(root, 'project/010_draw/raw.json'), '[{"x":10}]');
  const tools = toolsAt(root);
  const valid = { name: 'synthetic-forecast', version: 1, inputPath: '020_clean/input.json', outputPath: '060_reports/never.json' };
  for (const patch of [{ inputPath: '010_draw/raw.json' }, { inputPath: '../outside.json' }, { outputPath: '../outside.json' }, { outputPath: '010_draw/never.json' }]) {
    const { value, envelope } = await call(tools, 'modelpack_predict', { ...valid, ...patch });
    assert.equal(value.isError, true); assert.equal(envelope.status, 'rejected');
    assert.ok(envelope.code); assert.ok(envelope.detail?.reason);
  }
  const cancelled = await call(tools, 'modelpack_predict', valid, AbortSignal.abort());
  assert.equal(cancelled.value.isError, true); assert.equal(cancelled.envelope.status, 'rejected');
  assert.match(cancelled.envelope.code, /CANCEL|ABORT/);
  assert.deepEqual(await readdir(path.join(root, 'project/060_reports')), []);
});

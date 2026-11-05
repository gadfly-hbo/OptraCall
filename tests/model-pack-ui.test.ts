import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalog } from '../src/host/ui/catalog-data.ts';
import { createTask, setTaskCapability } from '../src/host/ui/runtime-client.ts';
import * as modelClient from '../extensions/business-plugins/model-pack/ui/model-pack-client.ts';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'rolldown/utils';

test('MP08: model packs are a connected business plugin with truthful execution and training boundaries', () => {
  const items = filterCatalog('plugins', '模型包', '全部');
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.id, 'model-pack');
  assert.equal(item.status, '已接入');
  assert.equal(item.entry, 'model-pack');
  const copy = item.description + item.note;
  for (const expected of ['本机', '无网络外发', 'MPS', '模型上下文']) assert.ok(copy.includes(expected), expected);
  assert.equal(filterCatalog('assets', '模型包', '全部').length, 0);
});

test('MP04: task creation transmits modelTools independently and keeps other capability choices', async t => {
  const task = { id: 'model-task', modelTools: true, weatherTools: false };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/projects/project%2Fone/tasks');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { name: '预测分析', configurationId: 'synthetic', modelTools: true, weatherTools: false });
    return new Response(JSON.stringify({ task }));
  });
  assert.deepEqual(await createTask('project/one', '预测分析', 'synthetic', { modelTools: true, weatherTools: false }), task);
});

test('MP04: default task creation leaves model tools off and preserves legacy simulation input', async t => {
  const bodies: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ task: { id: 'ordinary-task' } }));
  });
  await createTask('project', '普通分析');
  await createTask('project', '旧推演入口', undefined, true);
  assert.deepEqual(bodies, [{ name: '普通分析' }, { name: '旧推演入口', simulationTools: true }]);
});

test('MP04: the existing capability endpoint switches only modelTools for the exact task', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/projects/project%2Fone/tasks/task%2Fone/capabilities');
    assert.equal(init?.method, 'PUT');
    assert.deepEqual(JSON.parse(String(init?.body)), { capability: 'modelTools', enabled: false });
    return new Response(JSON.stringify({ task: { id: 'task/one' } }));
  });
  assert.equal((await setTaskCapability('project/one', 'task/one', 'modelTools', false)).id, 'task/one');
});

test('MP03: exact-version detail preserves the complete original manifest, including additional fields', async t => {
  const manifest = { formatVersion: 1, model: { name: 'synthetic-model', version: 2, stage: 'Candidate' }, extra: { retained: ['original'] } };
  const model = { name: 'synthetic-model', version: 2, stage: 'Staging' };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/model-pack/models/synthetic-model/2');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('x-optracall-client'), '1');
    return new Response(JSON.stringify({ model, manifest }));
  });
  assert.equal(typeof modelClient.getModelDetails, 'function', 'registry detail must retrieve the original manifest');
  assert.deepEqual(await modelClient.getModelDetails('synthetic-model', 2), { model, manifest });
});

test('MP03: Host import failure stages identify the corresponding progress step', () => {
  assert.equal(typeof modelClient.modelPackImportFailureStep, 'function');
  const stages = [
    ['structure', 'structure'], ['manifest', 'manifest'],
    ['purity_scan', 'purity'], ['sandbox_smoke', 'smoke'],
    ['integrity', 'install'], ['install', 'install'],
    ['purity', 'purity'], ['smoke', 'smoke'],
  ] as const;
  for (const [stage, expected] of stages) {
    const failure = new modelClient.ModelPackRequestError('SYNTHETIC_IMPORT_REJECTED', 422, '拒绝导入', { stage, reason: '合成失败' });
    assert.equal(modelClient.modelPackImportFailureStep(failure.detail?.stage), expected, stage);
    assert.equal(failure.detail?.stage, stage, 'the original public failure stage remains intact');
  }
});

test('MP03: absent or unrelated failure stages do not invent a passed or failed import step', () => {
  assert.equal(typeof modelClient.modelPackImportFailureStep, 'function');
  for (const stage of [undefined, 'request', 'execution', 'future_stage']) {
    assert.equal(modelClient.modelPackImportFailureStep(stage), undefined, String(stage));
  }
});

test('MP03: an explicit sandbox-unavailable refusal identifies smoke failure while uncertain responses stay unknown', () => {
  const unavailable = new modelClient.ModelPackRequestError('SANDBOX_UNAVAILABLE', 503, '沙箱不可用', { stage: 'sandbox_smoke', reason: '拒绝无沙箱运行' });
  assert.equal(modelClient.isModelPackImportRejection(unavailable), true);
  assert.equal(modelClient.modelPackImportFailureStep(unavailable.detail?.stage), 'smoke');
  assert.equal(modelClient.isModelPackImportRejection(new modelClient.ModelPackRequestError('PURITY_VIOLATION', 422, '纯度拒绝', { stage: 'purity_scan' })), true);
  for (const error of [
    new TypeError('synthetic lost response'),
    new modelClient.ModelPackRequestError('MODEL_REQUEST_FAILED', 500, '结果未确认', { stage: 'request' }),
    new modelClient.ModelPackRequestError('SANDBOX_UNAVAILABLE', 503),
    new modelClient.ModelPackRequestError('MODEL_REQUEST_FAILED', 503, '结果未确认', { stage: 'sandbox_smoke' }),
  ]) assert.equal(modelClient.isModelPackImportRejection(error), false, error.message);
});

test('MP03: rendered import steps convey pass/fail/not-run without relying on color or decorative checkmarks', async () => {
  const hooks = registerHooks({ load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !/\.tsx?$/u.test(url)) return nextLoad(url, context);
    const file = fileURLToPath(url);
    const output = transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } });
    return { format: 'module', source: output.code, shortCircuit: true };
  } });
  let ModelPackImportStep;
  try { ({ ModelPackImportStep } = await import('../extensions/business-plugins/model-pack/ui/ModelRegistryPage.tsx')); }
  finally { hooks.deregister(); }
  for (const [state, text, icon] of [['pass', '通过', '✓'], ['fail', '失败', '×'], ['idle', '未运行', '']] as const) {
    const html = renderToStaticMarkup(createElement(ModelPackImportStep, { step: { key: 'smoke', label: '沙箱冒烟', state, note: '' } }));
    assert.match(html, new RegExp(`<span class="dot" aria-hidden="true">${icon}</span>`), `${state}: status icon must be decorative and truthful`);
    const readable = html.replace(/<span class="dot" aria-hidden="true">.*?<\/span>/u, '').replace(/<[^>]*>/gu, '');
    assert.ok(readable.includes('沙箱冒烟') && readable.includes(text), `${state}: accessible text must identify the step and ${text}`);
    if (state !== 'pass') assert.ok(!html.includes('✓'), `${state}: a failed or unrun step cannot show a checkmark`);
  }
});

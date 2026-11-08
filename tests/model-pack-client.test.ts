import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listModels,
  getModel,
  importPack,
  promoteModel,
  ModelPackRequestError,
} from '../extensions/business-plugins/model-pack/ui/model-pack-client.ts';
import type { ModelRegistryEntry } from '../extensions/business-plugins/model-pack/types.ts';

type Call = { url: string; method: string; body?: string; headers: Record<string, string>; credentials?: string; mode?: string; cache?: string };

const ENTRY: ModelRegistryEntry = {
  schemaVersion: 1, name: 'order-forecast', version: 2, stage: 'Production', task: 'regression',
  goal: '预测订单量', metrics: { mae: 3.04 }, fingerprint: { sha256: 'a'.repeat(64), rows: 1456, columns: ['order_count'] },
  training: { splitSeed: 42, task: 'regression', targets: ['order_count'], trainedAt: '2026-11-01T00:00:00Z', sessionRef: 's_1' },
  usage: { inputs: ['business_date'], outputs: ['order_count'], form: 'predict(rows) -> rows' },
  installedAt: '2026-11-05T10:12:00Z', sourcePath: '/exports/order-forecast/v2', snapshotSha256: 'b'.repeat(64),
};

let calls: Call[] = [];
let respond: (call: Call) => { ok: boolean; status: number; body: unknown };

function stubFetch() {
  calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: init.headers as Record<string, string>,
      credentials: init.credentials, mode: init.mode, cache: init.cache,
      ...(init.body === undefined ? {} : { body: String(init.body) }),
    };
    calls.push(call);
    const result = respond(call);
    return { ok: result.ok, status: result.status, json: async () => result.body };
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test('MP-CLIENT-01: listModels issues a same-origin GET with the client header', async t => {
  const restore = stubFetch();
  t.after(restore);
  respond = () => ({ ok: true, status: 200, body: { models: [ENTRY] } });
  const result = await listModels();
  assert.deepEqual(result.models, [ENTRY]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/model-pack/models');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers['x-optracall-client'], '1');
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].mode, 'same-origin');
  assert.equal(calls[0].cache, 'no-store');
});

test('MP-CLIENT-02: getModel targets a name+version path, never an arbitrary path', async t => {
  const restore = stubFetch();
  t.after(restore);
  respond = () => ({ ok: true, status: 200, body: { model: ENTRY } });
  const result = await getModel('order-forecast', 2);
  assert.equal(result.model.name, 'order-forecast');
  assert.equal(calls[0].url, '/api/model-pack/models/order-forecast/2');
  assert.equal(calls[0].method, 'GET');
});

test('MP-CLIENT-03: importPack POSTs the source path for Host-side validation', async t => {
  const restore = stubFetch();
  t.after(restore);
  respond = () => ({ ok: true, status: 200, body: { model: { ...ENTRY, stage: 'Staging' } } });
  const sourcePath = '/Users/huangbo/Dev/Projects/model-mlflow/workspace/exports/promo-uplift/v1';
  const result = await importPack(sourcePath);
  assert.equal(result.model.stage, 'Staging');
  assert.equal(calls[0].url, '/api/model-pack/imports');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body!), { sourcePath });
});

test('MP-CLIENT-04: promoteModel POSTs to the promote path and returns the archived prior Production', async t => {
  const restore = stubFetch();
  t.after(restore);
  respond = () => ({ ok: true, status: 200, body: { model: { ...ENTRY, stage: 'Production' }, archived: { ...ENTRY, version: 1, stage: 'Archived' } } });
  const result = await promoteModel('order-forecast', 2);
  assert.equal(result.model.stage, 'Production');
  assert.equal(result.archived?.version, 1);
  assert.equal(calls[0].url, '/api/model-pack/models/order-forecast/2/promote');
  assert.equal(calls[0].method, 'POST');
});

test('MP-CLIENT-05: a rejected import surfaces a structured failure (stage/reason/hint), not a raw throw', async t => {
  const restore = stubFetch();
  t.after(restore);
  respond = () => ({
    ok: false, status: 422,
    body: { code: 'PURITY_VIOLATION', message: '纯度重扫不过', detail: { stage: 'purity', reason: "predict.mjs 含禁止调用 require('fs')", hint: '请在 MPS 重新训练导出' } },
  });
  const error = await importPack('/exports/bad/v1').then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ModelPackRequestError);
  assert.equal(error.code, 'PURITY_VIOLATION');
  assert.equal(error.status, 422);
  assert.equal(error.message, '纯度重扫不过');
  assert.equal(error.detail?.stage, 'purity');
  assert.match(error.detail?.reason ?? '', /require\('fs'\)/);
});

test('MP-CLIENT-06: a non-ok response without a code falls back to a default error code', async t => {
  const restore = stubFetch();
  t.after(restore);
  respond = () => ({ ok: false, status: 500, body: {} });
  const error = await listModels().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ModelPackRequestError);
  assert.equal(error.code, 'model_pack_request_failed');
  assert.equal(error.status, 500);
});

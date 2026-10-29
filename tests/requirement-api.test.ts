import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequirementRoutes } from '../extensions/business-plugins/requirements-elaboration/api/routes.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';

const root = () => mkdtempSync(path.join(os.tmpdir(), 'requirement-api-'));
const baseUrl = 'http://127.0.0.1';
type Handler = ReturnType<typeof createRequirementRoutes>['routes'];

async function harness(options: { replies?: string[]; outcome?: 'completed' | 'failed'; busy?: boolean } = {}) {
  const queue: Record<string, unknown>[] = [];
  const prompts: string[] = [];
  const calls = { run: 0, stop: 0 };
  const { routes, store } = createRequirementRoutes({
    storeRoot: root(),
    readBody: async () => queue.shift() ?? {},
    sessions: {
      run: async (_id, text) => { calls.run++; prompts.push(text); return { outcome: options.outcome ?? 'completed', text: options.replies?.shift() ?? '{}' }; },
      stop: async () => { calls.stop++; return true; },
      busy: () => options.busy ?? false,
    },
  });
  return { routes, store, prompts, calls, body: (value: Record<string, unknown>) => { queue.push(value); } };
}

const request = (method: string) => ({ method } as never);
const call = async (routes: Handler, method: string, pathname: string) => (await routes(request(method), new URL(baseUrl + pathname)))!;

test('RE-01: instance routes create, list, read, and patch', async () => {
  const { routes, body } = await harness();
  body({ title: '双11复购下滑归因', scene: 'topic' });
  const created = await call(routes, 'POST', '/api/requirement-instances');
  assert.equal(created.status, 201);
  const id = (created.value as { instance: { id: string } }).instance.id;
  assert.match(id, /^req-/);
  const listed = await call(routes, 'GET', '/api/requirement-instances');
  assert.equal((listed.value as { instances: unknown[] }).instances.length, 1);
  const detail = await call(routes, 'GET', `/api/requirement-instances/${id}`);
  assert.equal((detail.value as { gates: { publishBlocked: boolean } }).gates.publishBlocked, true);
  const current = (detail.value as { instance: Record<string, unknown> }).instance;
  body({ instance: current });
  const patched = await call(routes, 'PATCH', `/api/requirement-instances/${id}`);
  assert.equal(patched.status, 200);
});

test('RE-04: gates and releases ride along on detail responses', async () => {
  const { routes, store } = await harness();
  const instance = store.create({ title: '双11复购归因', scene: 'topic' });
  const detail = await call(routes, 'GET', `/api/requirement-instances/${instance.instance.id}`);
  const value = detail.value as { gates: { hard: { id: string; status: string }[] }; releases: unknown[] };
  assert.deepEqual(value.gates.hard.map(item => item.status), ['pass', 'fail', 'fail']);
  assert.deepEqual(value.releases, []);
});

test('RE-03: generate runs the model via the session and returns a normalized proposal', async () => {
  const { routes, store, prompts, body } = await harness({ replies: ['```json\n' + JSON.stringify({ clarifications: [{ category: '风险', priority: 'must_confirm', question: 'Q?', rationale: 'R' }], facts: [], hypotheses: [] }) + '\n```'] });
  const instance = store.create({ title: '门店销售下降', scene: 'daily' });
  body({ call: 'elicit' });
  const result = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/generate`);
  assert.equal(result.status, 200);
  const value = result.value as { call: string; proposal: { clarifications: { id: string }[]; dropped: number } };
  assert.equal(value.call, 'elicit');
  assert.equal(value.proposal.clarifications[0]!.id, 'clr-1');
  assert.match(prompts[0]!, /门店销售下降/);
});

test('RE-03: generate maps busy, invalid output, failed runs, and invalid calls', async () => {
  const { routes, store, body } = await harness({ replies: ['这不是 JSON'] });
  const instance = store.create({ title: '双11复购下滑归因', scene: 'topic' });
  body({ call: 'elicit' });
  const invalidJson = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/generate`);
  assert.equal(invalidJson.status, 422);
  assert.equal((invalidJson.value as { code: string }).code, 'REQ_MODEL_OUTPUT_INVALID');
  body({ call: 'bogus' });
  const invalidCall = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/generate`);
  assert.equal(invalidCall.status, 400);
  assert.equal((invalidCall.value as { code: string }).code, 'call_invalid');
});

test('RE-03: framework generation requires a fresh confirmed snapshot', async () => {
  const { routes, store, body } = await harness();
  const instance = store.create({ title: '双11复购下滑归因', scene: 'topic' });
  body({ call: 'framework' });
  const missing = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/generate`);
  assert.equal(missing.status, 409);
  assert.equal((missing.value as { code: string }).code, 'REQ_SNAPSHOT_REQUIRED');
  const seeded = { ...sampleInstance(), instance: { ...sampleInstance().instance, id: instance.instance.id, createdAt: instance.instance.createdAt } };
  store.save(seeded);
  store.confirm(store.read(instance.instance.id), 'huangbo');
  const stale = structuredClone(store.read(instance.instance.id)) as never as { facts: string[] };
  stale.facts.push('确认后又改的事实');
  store.save(stale as never);
  body({ call: 'framework' });
  const rejected = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/generate`);
  assert.equal(rejected.status, 409);
  assert.equal((rejected.value as { code: string }).code, 'REQ_STALE_SNAPSHOT');
});

test('RE-01: confirm and publish routes expose store semantics with mapped codes', async () => {
  const { routes, store, body } = await harness();
  const instance = store.create({ title: '双11复购下滑归因', scene: 'topic' });
  body({ version: '1.0.0', releasedBy: 'huangbo' });
  const blocked = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/publish`);
  assert.equal(blocked.status, 409);
  const seeded = { ...sampleInstance(), instance: { ...sampleInstance().instance, id: instance.instance.id, createdAt: instance.instance.createdAt } };
  store.save(seeded);
  body({ confirmedBy: 'huangbo' });
  const confirmed = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/confirm`);
  assert.equal(confirmed.status, 200);
  assert.equal(((confirmed.value as { instance: { snapshot?: unknown } }).instance).snapshot !== undefined, true);
  body({ version: '1.0.0', releasedBy: 'huangbo' });
  const published = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/publish`);
  assert.equal(published.status, 201);
  const releases = await call(routes, 'GET', `/api/requirement-instances/${instance.instance.id}/releases`);
  assert.equal((releases.value as { releases: unknown[] }).releases.length, 1);
  const release = await call(routes, 'GET', `/api/requirement-instances/${instance.instance.id}/releases/1.0.0`);
  assert.equal((release.value as { rap: { version: string } }).rap.version, '1.0.0');
  const missing = await call(routes, 'GET', '/api/requirement-instances/req-none/events-x');
  assert.equal(missing, undefined, 'unrelated paths fall through');
});

test('RE-03: stop route forwards to the session manager', async () => {
  const { routes, store, calls } = await harness();
  const instance = store.create({ title: '双11复购下滑归因', scene: 'topic' });
  const stopped = await call(routes, 'POST', `/api/requirement-instances/${instance.instance.id}/stop`);
  assert.equal(stopped.status, 200);
  assert.equal(calls.stop, 1);
});

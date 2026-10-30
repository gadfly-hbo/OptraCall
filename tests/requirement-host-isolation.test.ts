import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('RR06: archiving an idle project leaves an independent requirement generation running', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic archive isolation', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'requirement-isolation-model', apiKey: 'synthetic-host-isolation-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '可独立归档的合成空闲项目' }), 201);
  const created = await json(await host.request('/api/requirement-instances', 'POST', { title: '不属于上述项目的合成需求', scene: 'topic' }), 201);
  const id = created.instance.id;
  provider.setMode('slow');
  const generation = host.request(`/api/requirement-instances/${id}/generate`, 'POST', { call: 'elicit' });
  let settled = false; void generation.then(() => { settled = true; }, () => { settled = true; });
  await provider.waitForRequests(1);
  const archived = await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.ok(archived.project.archivedAt);
  assert.equal(provider.requests[0]!.closedEarly, false, 'project archive must not abort an independent requirement Provider connection');
  assert.equal(settled, false, 'project archive must not settle the independent requirement request');
  await json(await host.request(`/api/projects/${project.id}/restore`, 'POST', {}));
  await json(await host.request(`/api/requirement-instances/${id}/stop`, 'POST', {}));
  const stopped = await generation;
  assert.equal(stopped.status, 502);
  assert.equal((await stopped.json()).outcome, 'cancelled');
  assert.equal(provider.requests.length, 1, 'archive/restore/stop must not replay generation');
});

test('RR04/RR06: selecting another model leaves an active instance alone and provider clear closes only its owners', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const save = async (model: string) => (await json(await host.request('/api/configuration', 'PUT', { name: model, provider: 'openai-compatible', baseUrl: provider.baseUrl, model, apiKey: 'synthetic-provider-filter-only' }))).configuration;
  const create = async (title: string) => (await json(await host.request('/api/requirement-instances', 'POST', { title, scene: 'topic' }), 201)).instance.id as string;
  const firstConfiguration = await save('active-model-a');
  const firstId = await create('供应商A独立合成需求');
  provider.setMode('slow');
  const first = host.request(`/api/requirement-instances/${firstId}/generate`, 'POST', { call: 'elicit' });
  await provider.waitForRequests(1);
  await save('active-model-b');
  const secondId = await create('供应商B独立合成需求');
  const second = host.request(`/api/requirement-instances/${secondId}/generate`, 'POST', { call: 'elicit' });
  let secondSettled = false; void second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
  await provider.waitForRequests(2);
  assert.deepEqual(provider.requests.map(request => request.body.model), ['active-model-a', 'active-model-b']);
  assert.equal(provider.requests[0]!.closedEarly, false, 'global model selection must not stop an already running instance');
  await json(await host.request(`/api/configuration?provider=${encodeURIComponent(firstConfiguration.provider)}`, 'DELETE'));
  assert.equal((await first).status, 502);
  assert.equal(provider.requests[0]!.closedEarly, true);
  assert.equal(provider.requests[1]!.closedEarly, false, 'clearing one provider must not close another requirement instance');
  assert.equal(secondSettled, false);
  await json(await host.request(`/api/requirement-instances/${secondId}/stop`, 'POST', {}));
  assert.equal((await second).status, 502);
  assert.equal(provider.requests.length, 2);
});

test('RR06: Host shutdown closes a live requirement without replaying its request', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic shutdown', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'shutdown-model', apiKey: 'synthetic-shutdown-only' }));
  const created = await json(await host.request('/api/requirement-instances', 'POST', { title: '关闭Host的合成需求', scene: 'topic' }), 201);
  provider.setMode('slow');
  const pending = host.request(`/api/requirement-instances/${created.instance.id}/generate`, 'POST', { call: 'elicit' }).then(response => response.status, () => 'connection_closed');
  await provider.waitForRequests(1);
  await host.close();
  const outcome = await pending;
  assert.ok(outcome === 'connection_closed' || (typeof outcome === 'number' && outcome >= 400), 'stopping the Host must not report a successful generation');
  assert.equal(provider.requests[0]!.closedEarly, true);
  assert.equal(provider.requests.length, 1);
});

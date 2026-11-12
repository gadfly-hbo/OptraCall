import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

async function read(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('CNR07: default Host retires both old write entries without changing saved settings or dispatching a model', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', { name: '新审查入口', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-transition', apiKey: 'synthetic-transition-key' }));
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '默认新合同' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '旧入口拒绝' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const settings = (await read(await host.request(route + '/automatic-verification/settings'))).settings;
  const rejected = await read(await host.request(route + '/automatic-verification/settings', 'PUT', { expectedRevision: settings.revision, settings: { enabled: false } }), 409);
  assert.equal(rejected.code, 'review_entry_replaced');
  assert.match(rejected.newEntry, /conclusion-reviews/);
  const oldStart = await read(await host.request(route + '/verifications', 'POST', {}), 409);
  assert.equal(oldStart.code, 'review_entry_replaced');
  assert.deepEqual((await read(await host.request(route + '/automatic-verification/settings'))).settings, settings);
  assert.equal(provider.requests.length, 0);
  assert.equal((await read(await host.request(route + '/conclusion-reviews/transition'))).state, 'ready');
});

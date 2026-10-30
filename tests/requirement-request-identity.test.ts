import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { sampleWithoutSnapshotExport } from './fixtures/requirement-sample.ts';

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('RR02/RR07: persisted request identity pins RAP selection across restart and rejects changed or removed selection', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic request identity', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'request-identity-model', apiKey: 'synthetic-request-identity-only' }));
  const created = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成版本选择身份', scene: 'topic' }), 201);
  const id = created.instance.id as string;
  const detail = await json(await host.request(`/api/requirement-instances/${id}`));
  const sample = sampleWithoutSnapshotExport();
  assert.ok(sample.framework);
  const instance = { ...sample, instance: detail.instance.instance, framework: { ...sample.framework, metrics: sample.framework.metrics.map((metric, index) => index === 0 ? { ...metric, definition: 'synthetic definition 1.9.0' } : metric) } };
  await json(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance }));
  await json(await host.request(`/api/requirement-instances/${id}/confirm`, 'POST', { confirmedBy: 'synthetic-reviewer' }));
  await json(await host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.9.0', releasedBy: 'synthetic-reviewer' }), 201);
  const updated = await json(await host.request(`/api/requirement-instances/${id}`));
  updated.instance.framework.metrics[0].definition = 'synthetic definition 1.10.0';
  await json(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: updated.instance }));
  await json(await host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.10.0', releasedBy: 'synthetic-reviewer' }), 201);
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成请求身份项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '版本固定任务' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const original = { text: '只验证请求身份，不执行经营动作。', requestId: randomUUID(), requirementContext: { instanceId: id, version: '1.9.0' } };
  await json(await host.request(`${route}/messages`, 'POST', original), 202);
  await provider.waitForRequests(1);
  let state: any;
  const deadline = Date.now() + 5000;
  do { state = await json(await host.request(route)); if (state.task.lastRun?.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 5)); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun.status, 'completed');
  const native = await readFile(state.task.sessionFile);
  await host.close();
  const reopened = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot }); t.after(() => reopened.close());
  const replay = await json(await reopened.request(`${route}/messages`, 'POST', { ...original, requirementContext: { version: '1.9.0', instanceId: id } }), 202);
  assert.equal(replay.deduplicated, true, 'same semantic selection survives object field reordering and Host restart');
  await json(await reopened.request(`${route}/messages`, 'POST', { ...original, requirementContext: { instanceId: id, version: '1.10.0' } }), 409);
  await json(await reopened.request(`${route}/messages`, 'POST', { text: original.text, requestId: original.requestId }), 409);
  await json(await reopened.request(`${route}/messages`, 'POST', { ...original, text: 'different input' }), 409);
  assert.equal(provider.requests.length, 1, 'conflicts and duplicate acknowledgements must not replay the Provider request');
  assert.deepEqual(await readFile(state.task.sessionFile), native, 'replay checks must not rewrite native history');

  // An ordinary request keeps the legacy marker shape and acknowledgement
  // behavior. Without a recorded requirement identity, replay cannot add one.
  const plain = { text: '普通合成请求保持旧确认行为。', requestId: randomUUID() };
  await json(await reopened.request(`${route}/messages`, 'POST', plain), 202);
  await provider.waitForRequests(2);
  const plainDeadline = Date.now() + 5000;
  do { state = await json(await reopened.request(route)); if (state.task.lastRun?.id === plain.requestId && state.task.lastRun.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 5)); } while (Date.now() < plainDeadline);
  assert.equal(state.task.lastRun.id, plain.requestId);
  assert.equal(state.task.lastRun.status, 'completed');
  const plainNative = await readFile(state.task.sessionFile);
  await reopened.close();
  const restarted = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot }); t.after(() => restarted.close());
  const plainReplay = await json(await restarted.request(`${route}/messages`, 'POST', plain), 202);
  assert.equal(plainReplay.deduplicated, true);
  await json(await restarted.request(`${route}/messages`, 'POST', { ...plain, requirementContext: { instanceId: id, version: '1.9.0' } }), 409);
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(await readFile(state.task.sessionFile), plainNative);
});

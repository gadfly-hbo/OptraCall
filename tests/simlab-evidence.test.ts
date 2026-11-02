import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';

async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }

test('SIM-EVIDENCE-01: authoritative frozen report links into Case and appears on the decision board without a model', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '合成离线', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '快照证据合成' }), 201);
  const base = `/api/simlab/projects/${project.id}`;
  const { draft } = await json(await host.request(base + '/drafts', 'POST', { name: '合成方案' }), 201);
  const { run } = await json(await host.request(`${base}/drafts/${draft.id}/runs`, 'POST', {}), 201);
  const { snapshot } = await json(await host.request(`${base}/drafts/${draft.id}/freeze`, 'POST', { runId: run.id, variantId: 'split', expectedRevision: 1 }), 201);
  const first = await json(await host.request(`${base}/snapshots/${snapshot.id}/export`, 'POST', { text: 'FORGED_CLIENT_METRICS' }), 201);
  const content = await (await host.request(`/api/projects/${project.id}/files/content?path=${encodeURIComponent(first.file.path)}&expectedSha256=${first.file.sha256}`)).text();
  assert.ok(content.includes(snapshot.inputHash)); assert.ok(content.includes(snapshot.engineVersion));
  assert.ok(content.includes(String(snapshot.result.summary.contribution))); assert.ok(content.includes('不是现实预测'));
  assert.ok(!content.includes('FORGED_CLIENT_METRICS'));
  const second = await json(await host.request(`${base}/snapshots/${snapshot.id}/export`, 'POST', {}), 201);
  assert.notEqual(first.file.path, second.file.path, 'export always saves a new file');
  assert.equal(await (await host.request(`/api/projects/${project.id}/files/content?path=${encodeURIComponent(first.file.path)}`)).text(), content);
  await json(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: record } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '备货决策' }), 201);
  const linked = await json(await host.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id }));
  const operation = { operationId: randomUUID(), expectedRevision: linked.case.revision, projectId: project.id, relativePath: first.file.path, expectedSha256: first.file.sha256, role: 'analysis_result', displayName: `经营推演 ${snapshot.id}` };
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts`, 'POST', { ...operation, expectedSha256: '0'.repeat(64) }), 409)).code, 'artifact_version_changed');
  assert.deepEqual((await json(await host.request(`/api/cases/${record.id}`))).artifacts, []);
  await json(await host.request(`/api/cases/${record.id}/artifacts`, 'POST', operation));
  await json(await host.request(`/api/cases/${record.id}/artifacts`, 'POST', operation));
  const detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.artifacts.length, 1); assert.equal(detail.artifacts[0].observedSha256, first.file.sha256);
  assert.equal(detail.artifacts[0].availability, 'available');
  const board = await json(await host.request('/api/decision-board'));
  assert.ok(board.reports.some((report: any) => report.relativePath === first.file.path));
  assert.equal(board.items.length, 0, 'no automatic extraction or inferred business conclusion');
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.equal((await host.request(`${base}/snapshots/${snapshot.id}/export`, 'POST', {})).status, 409);
  assert.equal((await host.request(`${base}/snapshots/${snapshot.id}`)).status, 200);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';

async function json(response: Response, status = 200): Promise<any> { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test('SU02/15: new projects default to a single configured enterprise while historical and ambiguous projects remain explicit', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Enterprise project defaults', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-default', apiKey: 'synthetic-only' }));
  const create = (name: string, enterpriseId?: string) => host.request('/api/projects', 'POST', { name, ...(enterpriseId ? { enterpriseId } : {}) }).then(response => json(response, 201)).then(value => value.project);
  const historical = await create('已有项目');
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: '企业 A' }), 201);
  const defaulted = await create('唯一企业新项目');
  const first = await json(await host.request('/api/studio/enterprises'));
  assert.ok(!first.projectAssignments.some((item: any) => item.projectId === historical.id));
  assert.equal(first.projectAssignments.find((item: any) => item.projectId === defaulted.id)?.enterpriseId, a.id);
  const b = await json(await host.request('/api/studio/enterprises', 'POST', { name: '企业 B' }), 201);
  const ambiguous = await create('多企业待明确项目'), explicit = await create('明确企业项目', b.id);
  const later = await json(await host.request('/api/studio/enterprises'));
  assert.ok(!later.projectAssignments.some((item: any) => item.projectId === ambiguous.id));
  assert.equal(later.projectAssignments.find((item: any) => item.projectId === explicit.id)?.enterpriseId, b.id);
});

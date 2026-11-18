import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
async function fixture(t: import('node:test').TestContext) {
  const provider = await startToolProvider(), host = await startTestHost(); t.after(async () => { await host.close(); await provider.close(); });
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true }); await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', body?: unknown) => { const response = await host.request(route, method, body); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成轻量需求', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-prepare', apiKey: 'synthetic-prepare-only' });
  const { project } = await request('/api/projects', 'POST', { name: '轻量需求前置' });
  const plan = { request: '核对业务变化，先确认范围', premises: ['只有资料清单，明细尚未上传'], materials: [], coverage: [], tasks: [{ key: 'analysis', name: '分析并综合', selected: true, scope: '核对事实与局限', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'analysis', dependencies: [], caseContext: null };
  return { host, provider, project, plan, request, base: `/api/projects/${project.id}/plan` };
}
test('A05/A06: the existing requirement Pi profile prepares an editable project draft with no data tools or Task creation; replay reads its own result', { timeout: 25_000 }, async t => {
  const f = await fixture(t);
  f.provider.setResponder(context => { assert.deepEqual(context.availableTools, []); return { text: '```json\n' + JSON.stringify({ plan: { ...f.plan, coverage: [{ key: 'scope', label: '诉求及事实范围', disposition: 'focus', reason: '本轮仅有基本说明', taskKeys: ['analysis'] }] }, mece: { sameLevel: '同层以事实类别划分', coverage: '资料尚不足，保留待核', boundaries: '未把工作重点等同全部覆盖', depth: '轻量前置，不做归因' }, limitations: ['尚未读取任何业务明细'] }) + '\n```' }; });
  const input = { operationId: randomUUID(), expectedRevision: 0, plan: f.plan };
  const result = await f.request(f.base + '/prepare', 'POST', input);
  assert.equal(result.preparation.status, 'completed'); assert.equal(result.draft.version, 1);
  assert.equal(result.draft.plan.coverage[0].label, '诉求及事实范围');
  assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 0);
  const repeated = await f.request(f.base + '/prepare', 'POST', input);
  assert.equal(repeated.replayed, true); assert.equal(f.provider.requests.length, 1);
  const state = await f.request(f.base); assert.equal(state.preparations[0].operationId, input.operationId); assert.equal(state.preparations[0].draftVersion, 1);
  assert.equal((await f.request('/api/requirement-instances')).instances.length, 0, 'internal preparation does not create a separate user RAP workflow');
  assert.deepEqual(f.provider.errors, []);
});
test('A22: stopping only the exact preparation cancels the original requirement resource and saves no draft or Task', { timeout: 25_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(context => { assert.deepEqual(context.availableTools, []); return { text: '合成处理中', hold: true }; });
  const operationId = randomUUID(), preparing = f.request(f.base + '/prepare', 'POST', { operationId, expectedRevision: 0, plan: f.plan });
  await f.provider.waitForRequests(1);
  const observed = await f.request(f.base); assert.equal(observed.preparations[0].status, 'running');
  const archive = await f.host.request(`/api/projects/${f.project.id}/archive`, 'POST', {}); assert.equal(archive.status, 409, await archive.clone().text());
  const wrong = await f.request(f.base + '/prepare/stop', 'POST', { operationId: randomUUID() }); assert.equal(wrong.stopped, false);
  const stopped = await f.request(f.base + '/prepare/stop', 'POST', { operationId }); assert.equal(stopped.stopped, true);
  const result = await preparing; assert.equal(result.preparation.status, 'cancelled');
  const final = await f.request(f.base); assert.equal(final.draft, undefined); assert.equal(final.preparations[0].status, 'cancelled');
  assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 0);
});

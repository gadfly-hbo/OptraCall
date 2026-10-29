import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';

async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function until(ready: () => boolean, message: string) { const deadline = Date.now() + 20_000; while (!ready()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 20)); } }
const fixture = () => readFileSync(path.resolve(import.meta.dirname, '../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml'), 'utf8');

test('MF-05: synthetic end-to-end loop from draft to a model request that receives the asset index', { timeout: 90_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '指标闭环合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-metric-loop', apiKey: 'synthetic-metric-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '指标闭环项目' }), 201);

  // Drafts reach 020_clean the way agents deliver them: direct file writes, not the
  // user upload route, whose whitelist intentionally stays CSV/JSON/MD/TXT.
  mkdirSync(path.join(project.rootPath, '020_clean'), { recursive: true });
  writeFileSync(path.join(project.rootPath, '020_clean', 'membership-repurchase@1.0.0.draft.yaml'), fixture(), 'utf8');
  const invalid = await json(await host.request('/api/metric-factory/draft/validate', 'POST', { projectId: project.id, path: '020_clean/membership-repurchase@1.0.0.draft.yaml', publishedBy: 'huangbo' }));
  assert.equal(invalid.document.metrics.length, 4, 'Validation must parse the synthetic draft');
  const published = await json(await host.request('/api/metric-factory/publish', 'POST', { projectId: project.id, path: '020_clean/membership-repurchase@1.0.0.draft.yaml', publishedBy: 'huangbo' }), 201);
  assert.equal(published.entry.id, 'membership-repurchase');
  await json(await host.request(`/api/metric-factory/projects/${project.id}/enable`, 'POST', { packageId: 'membership-repurchase', version: '1.0.0' }));
  const enabled = await json(await host.request(`/api/metric-factory/projects/${project.id}`));
  assert.equal(enabled.records[0].entry.metricNames.length, 4);

  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '复购分析任务' }), 201);
  const stream = await sessionEvents(host, project.id, task.id); t.after(() => stream.close());
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '请用已启用口径分析会员复购率。', requestId: randomUUID() }), 202);
  await until(() => stream.events.some((event: any) => event.type === 'run.settled'), 'Synthetic run never settled.');
  await provider.waitForRequests(1);

  const systemPrompt = JSON.stringify(provider.requests[0]!.body.messages?.filter((message: any) => message.role === 'system') ?? []);
  assert.match(systemPrompt, /membership-repurchase@1\.0\.0/);
  assert.match(systemPrompt, /repurchase_rate 会员复购率/);
  assert.match(systemPrompt, new RegExp(path.join(host.dataRoot, 'metric-assets', 'membership-repurchase', '1.0.0.sap.yaml').replace(/\./g, '\\.')));
  assert.match(systemPrompt, /注明.*指标.*版本/);
  assert.doesNotMatch(systemPrompt, /caliber_switches|type_params/, 'The full definition payload must not enter the system prompt');
  const final = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.match(JSON.stringify(final.snapshot.messages), /SDK 合成回复/, 'The task must complete with the synthetic reply');
  const files = await json(await host.request(`/api/projects/${project.id}/files`));
  const clean = JSON.stringify(files).includes('membership-repurchase@1.0.0.draft.yaml');
  assert.ok(clean, 'The draft stays in 020_clean after publishing');
});

test('MF-04: sessions without enablement get no metric index at all', { timeout: 60_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '无资产合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-no-asset', apiKey: 'synthetic-no-asset-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '未启用资产项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '普通任务' }), 201);
  const stream = await sessionEvents(host, project.id, task.id); t.after(() => stream.close());
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '普通问题', requestId: randomUUID() }), 202);
  await until(() => stream.events.some((event: any) => event.type === 'run.settled'), 'Synthetic run never settled.');
  await provider.waitForRequests(1);
  const systemPrompt = JSON.stringify(provider.requests[0]!.body.messages?.filter((message: any) => message.role === 'system') ?? []);
  assert.doesNotMatch(systemPrompt, /指标资产/, 'Unenabled projects must not receive an asset index');
});

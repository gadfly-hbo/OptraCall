import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost, startLegacyTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';

async function read(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('RCR01: ordinary prompt admission records its foreground review contract before any report exists', { timeout: 30_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', {
    name: '计算复核准入', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-review-admission', apiKey: 'synthetic-admission-key',
  }));
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '固定请求合同' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '普通请求' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const events = await sessionEvents(host, project.id, task.id); t.after(() => events.close());
  const requestId = randomUUID();
  await read(await host.request(route + '/messages', 'POST', { text: '先检查本轮需求。', requestId }), 202);
  await events.terminal;
  const { receipts } = await read(await host.request(route + '/context-receipts'));
  const supplied = receipts.find((entry: any) => entry.requestId === requestId).providedContext;
  assert.equal(supplied.reportCalculationReview?.contract, 'foreground-report-calculation-v1');
  assert.equal(provider.requests.length, 1);
});

test('RCR01: an admitted legacy contract never falls through to foreground review', async () => {
  const { reportCalculationContract } = await import('../src/host/report-calculation-admission.ts');
  const admitted = reportCalculationContract({ ordinaryPrompt: true, legacyEnabled: true, legacyAdmitted: true });
  assert.equal(admitted, undefined);
  for (const legacyAdmitted of [false, true]) {
    assert.equal(reportCalculationContract({ ordinaryPrompt: true, legacyEnabled: true, legacyAdmitted }), undefined);
  }
  assert.equal(reportCalculationContract({ ordinaryPrompt: true, legacyEnabled: false, legacyAdmitted: true }), undefined);
  assert.equal(reportCalculationContract({ ordinaryPrompt: false, legacyEnabled: false, legacyAdmitted: false }), undefined);
  assert.deepEqual(reportCalculationContract({ ordinaryPrompt: true, legacyEnabled: false, legacyAdmitted: false }), { contract: 'foreground-report-calculation-v1' });
});

test('RCR01: an actual legacy admission with unchanged report never receives the new review tool or fallback request', { timeout: 45_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startLegacyTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', {
    name: '旧链互斥', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-legacy-admission', apiKey: 'synthetic-legacy-key',
  }));
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '旧请求合同' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '旧链保持不变' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const capabilities = await read(await host.request(route + '/automatic-verification/capabilities'));
  if (!capabilities.supported) { t.skip('The existing managed legacy contract is unavailable on this platform.'); return; }
  await read(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', {
    directory: '020_clean', name: 'input.csv', content: Buffer.from('value\n10\n').toString('base64'),
  }), 201);
  await read(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'existing.md', text: '# 原版\n合计10。' }), 201);
  await read(await host.request(route + '/automatic-verification/settings', 'PUT', { expectedRevision: 0, settings: {
    enabled: true, question: '核对合计', dataFiles: ['020_clean/input.csv'], reportPath: '060_reports/existing.md', processFiles: [], maxAuthorTurns: 1,
  } }));
  const events = await sessionEvents(host, project.id, task.id); t.after(() => events.close());
  const requestId = randomUUID();
  await read(await host.request(route + '/messages', 'POST', { text: '原报告保持不变。', requestId }), 202);
  await events.terminal;
  assert.equal(provider.requests.length, 1);
  const tools = (provider.requests[0].body.tools ?? []) as { function?: { name?: string } }[];
  assert.ok(!tools.some(tool => tool.function?.name === 'review_report_calculations'));
  const { receipts } = await read(await host.request(route + '/context-receipts'));
  assert.equal(receipts.find((entry: any) => entry.requestId === requestId).providedContext.reportCalculationReview, undefined);
});

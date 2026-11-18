import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

async function json(response: Response, status = 200): Promise<any> { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic only', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic-only' }));
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201), b = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'A project', enterpriseId: a.id }), 201);
  const source = await readFile('extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', 'utf8');
  const library = createMetricLibrary(path.join(host.dataRoot, 'metric-assets'));
  return { host, a, b, project, source, library };
}

test('SU02/13: embedded professional publication cannot advance a foreign enterprise package', async t => {
  const f = await fixture(t); f.library.publish(preparePublication(Buffer.from(f.source)), 'Synthetic B seed');
  await json(await f.host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'sap-metric', entityId: 'membership-repurchase', enterpriseId: f.b.id }));
  const changed = f.source.replace('version: 1.0.0', 'version: 1.1.0').replaceAll('复购会员数', 'A错误输入新口径');
  await writeFile(path.join(f.project.rootPath, '020_clean', 'foreign.yaml'), changed);
  const preview = await json(await f.host.request('/api/metric-factory/draft/validate', 'POST', { projectId: f.project.id, path: '020_clean/foreign.yaml' }));
  const rejected = await json(await f.host.request('/api/metric-factory/publish', 'POST', { projectId: f.project.id, path: '020_clean/foreign.yaml', publishedBy: 'Synthetic A reviewer', expectedPackageFingerprint: preview.packageFingerprint }), 409);
  assert.equal(rejected.code, 'enterprise_assignment_conflict');
  assert.deepEqual(f.library.list().map(item => item.version), ['1.0.0']);
  const foundation = await json(await f.host.request(`/api/studio/foundation?enterpriseId=${f.b.id}`));
  assert.deepEqual(foundation.items.filter((item: any) => item.eligible).map((item: any) => item.version), ['1.0.0']);
});

test('SU09: scoped professional publish is bound to the reviewed fingerprint and leaves changed drafts unpublished', async t => {
  const f = await fixture(t), file = path.join(f.project.rootPath, '020_clean', 'review.yaml');
  await writeFile(file, f.source);
  const input = { projectId: f.project.id, path: '020_clean/review.yaml', publishedBy: 'Synthetic A reviewer' };
  const preview = await json(await f.host.request('/api/metric-factory/draft/validate', 'POST', input));
  await writeFile(file, f.source.replace('version: 1.0.0', 'version: 1.1.0').replaceAll('复购会员数', '未审核新口径'));
  assert.equal((await json(await f.host.request('/api/metric-factory/publish', 'POST', { ...input, expectedPackageFingerprint: preview.packageFingerprint }), 409)).code, 'publication_preview_changed');
  assert.equal((await json(await f.host.request('/api/metric-factory/publish', 'POST', input), 409)).code, 'publication_preview_required');
  assert.deepEqual(f.library.list(), []);
  const current = await json(await f.host.request('/api/metric-factory/draft/validate', 'POST', input));
  const published = await json(await f.host.request('/api/metric-factory/publish', 'POST', { ...input, expectedPackageFingerprint: current.packageFingerprint }), 201);
  assert.equal(published.entry.version, '1.1.0');
  assert.ok((await json(await f.host.request('/api/studio/enterprises'))).assetAssignments.some((item: any) => item.authority === 'sap-metric' && item.id === published.entry.id && item.enterpriseId === f.a.id), 'The first scoped publication must bind its original target before another enterprise can advance it.');
});

test('SU09/13: archived source projects cannot publish an already reviewed native draft', async t => {
  const f = await fixture(t); await writeFile(path.join(f.project.rootPath, '020_clean', 'review.yaml'), f.source);
  const input = { projectId: f.project.id, path: '020_clean/review.yaml', publishedBy: 'Synthetic A reviewer' };
  const preview = await json(await f.host.request('/api/metric-factory/draft/validate', 'POST', input));
  await json(await f.host.request(`/api/projects/${f.project.id}/archive`, 'POST', {}));
  assert.equal((await json(await f.host.request('/api/metric-factory/publish', 'POST', { ...input, expectedPackageFingerprint: preview.packageFingerprint }), 409)).code, 'project_archived');
  assert.deepEqual(f.library.list(), []);
});

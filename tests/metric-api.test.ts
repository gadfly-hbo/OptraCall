import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createMetricFactoryRoutes } from '../extensions/business-plugins/metric-factory/api/routes.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';

const fixture = () => readFileSync(path.resolve(import.meta.dirname, '../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml'));
const projectId = '11111111-1111-4111-8111-111111111111';

type Harness = Awaited<ReturnType<typeof setup>>;
async function setup(options: { publishFirst?: boolean } = {}) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'metric-api-'));
  const projectDirectory = path.join(workspace, 'projects', projectId);
  mkdirSync(path.join(projectDirectory, '020_clean'), { recursive: true });
  writeFileSync(path.join(projectDirectory, '020_clean', 'membership-repurchase@1.0.0.draft.yaml'), fixture());
  const libraryRoot = path.join(workspace, 'metric-assets');
  let body: Record<string, unknown> = {};
  const routes = createMetricFactoryRoutes({
    libraryRoot,
    projectDataDirectory: () => path.join(workspace, 'projects', projectId),
    projectExists: id => Promise.resolve(id === projectId),
    readProjectFile: (id, relative) => { assert.equal(id, projectId); return Promise.resolve({ name: path.basename(relative), bytes: readFileSync(path.join(projectDirectory, relative)) }); },
    readBody: () => Promise.resolve(body),
  });
  const call = async (method: string, pathname: string, input: Record<string, unknown> = {}) => {
    body = input;
    return routes({ method, headers: {} } as IncomingMessage, new URL(`http://127.0.0.1:4175${pathname}`));
  };
  if (options.publishFirst) {
    const published = await call('POST', '/api/metric-factory/publish', { projectId, path: '020_clean/membership-repurchase@1.0.0.draft.yaml', publishedBy: 'huangbo' });
    assert.equal(published!.status, 201, JSON.stringify(published));
  }
  return { workspace, libraryRoot, projectDirectory, call };
}

test('MF-03: empty library lists no entries', async () => {
  const { call } = await setup();
  assert.deepEqual((await call('GET', '/api/metric-factory/library'))!.value, { entries: [] });
});

test('MF-03: draft validation returns the document or a precise SapFault', async () => {
  const { projectDirectory, call } = await setup();
  const draft = path.join(projectDirectory, '020_clean', 'membership-repurchase@1.0.0.draft.yaml');
  const valid = await call('POST', '/api/metric-factory/draft/validate', { projectId, path: '020_clean/membership-repurchase@1.0.0.draft.yaml' });
  assert.equal(valid!.status, 200);
  const value = valid!.value as { document: { metrics: unknown[] }; packageFingerprint: string };
  assert.equal(value.document.metrics.length, 4);
  assert.match(value.packageFingerprint, /^sha256:/);
  writeFileSync(draft, readFileSync(draft, 'utf8').replace('      reviewed_by: huangbo\n', ''));
  const invalid = await call('POST', '/api/metric-factory/draft/validate', { projectId, path: '020_clean/membership-repurchase@1.0.0.draft.yaml' });
  assert.equal(invalid!.status, 422);
  assert.equal((invalid!.value as { code: string }).code, 'SAP_UNREVIEWED');
});

test('MF-03: publish stores the package and the same draft again is idempotent', async () => {
  const { libraryRoot, call } = await setup();
  const published = await call('POST', '/api/metric-factory/publish', { projectId, path: '020_clean/membership-repurchase@1.0.0.draft.yaml', publishedBy: 'huangbo' });
  assert.equal(published!.status, 201);
  const entry = (published!.value as { entry: { id: string; version: string } }).entry;
  assert.equal(entry.id, 'membership-repurchase');
  const again = await call('POST', '/api/metric-factory/publish', { projectId, path: '020_clean/membership-repurchase@1.0.0.draft.yaml', publishedBy: 'huangbo' });
  assert.equal(again!.status, 200);
  assert.deepEqual((again!.value as { entry: unknown }).entry, entry);
  assert.equal(createMetricLibrary(libraryRoot).list().length, 1);
});

test('MF-03: drafts outside 020_clean and unknown projects are refused', async () => {
  const { call } = await setup();
  const outside = await call('POST', '/api/metric-factory/publish', { projectId, path: '010_draw/draft.yaml', publishedBy: 'huangbo' });
  assert.equal(outside!.status, 400);
  assert.equal((outside!.value as { code: string }).code, 'invalid_draft_path');
  const missing = await call('POST', '/api/metric-factory/publish', { projectId: '22222222-2222-4222-8222-222222222222', path: '020_clean/draft.yaml', publishedBy: 'huangbo' });
  assert.equal(missing!.status, 404);
  assert.equal((missing!.value as { code: string }).code, 'project_not_found');
  const noReviewer = await call('POST', '/api/metric-factory/publish', { projectId, path: '020_clean/membership-repurchase@1.0.0.draft.yaml', publishedBy: '  ' });
  assert.equal(noReviewer!.status, 400);
  assert.equal((noReviewer!.value as { code: string }).code, 'publisher_invalid');
});

test('MF-03: package detail returns the stored entry with its parsed document', async () => {
  const { call } = await setup({ publishFirst: true });
  const detail = await call('GET', '/api/metric-factory/library/membership-repurchase/1.0.0');
  assert.equal(detail!.status, 200);
  const value = detail!.value as { entry: { version: string }; document: { sap: string; package: { fingerprint: string } } };
  assert.equal(value.entry.version, '1.0.0');
  assert.equal(value.document.sap, '0.2');
  assert.match(value.document.package.fingerprint, /^sha256:/);
  assert.equal((await call('GET', '/api/metric-factory/library/membership-repurchase/9.9.9'))!.status, 404);
});

test('MF-04: enable verifies the library version and pins it for the project', async () => {
  const { call } = await setup({ publishFirst: true });
  const unknownProject = await call('POST', '/api/metric-factory/projects/33333333-3333-4333-8333-333333333333/enable', { packageId: 'membership-repurchase', version: '1.0.0' });
  assert.equal(unknownProject!.status, 404);
  const unpublished = await call('POST', `/api/metric-factory/projects/${projectId}/enable`, { packageId: 'membership-repurchase', version: '1.2.0' });
  assert.equal(unpublished!.status, 404);
  assert.equal((unpublished!.value as { code: string }).code, 'version_not_published');
  const enabled = await call('POST', `/api/metric-factory/projects/${projectId}/enable`, { packageId: 'membership-repurchase', version: '1.0.0' });
  assert.equal(enabled!.status, 200);
  assert.equal((enabled!.value as { record: { version: string } }).record.version, '1.0.0');
  const records = await call('GET', `/api/metric-factory/projects/${projectId}`);
  const value = records!.value as { records: { packageId: string; version: string; entry: { metricNames: string[] } }[] };
  assert.equal(value.records.length, 1);
  assert.deepEqual(value.records[0]!.entry.metricNames, ['repurchase_rate', 'repeat_member_count', 'buyer_member_count', 'repurchase_gap_days']);
  const disabled = await call('POST', `/api/metric-factory/projects/${projectId}/disable`, { packageId: 'membership-repurchase' });
  assert.deepEqual(((disabled!.value as { records: unknown[] }).records), []);
});

test('MF-03: unknown metric-factory routes return undefined so the host answers 404', async () => {
  const { call } = await setup();
  assert.equal(await call('GET', '/api/metric-factory/unknown'), undefined);
  assert.equal(await call('POST', '/api/metric-factory/library'), undefined);
});

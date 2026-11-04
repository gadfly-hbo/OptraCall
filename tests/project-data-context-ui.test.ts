import test from 'node:test';
import assert from 'node:assert/strict';
import { addTaskProjectDataSelection, observationCount, parseObservationImport, projectDataProvisionEntries, prepareProjectDataCopy, previewProjectDataFile, readProjectDataContext, readProjectDataDescription, readProjectDataSourceStatus, projectDataSourceStatusLabel, saveProjectDataDescription, ProjectDataContextRequestError } from '../src/host/ui/project-data-context-client.ts';
import type { SaveDataDescription } from '../src/host/project-data-context-types.ts';
import { observation as validateHostObservation } from '../src/host/project-data-context-validation.ts';

test('MC05 UI: selecting exact data in a task preserves other projects and descriptions', () => {
  const old = { 'project-a/task-a': [{ datasetId: 'd', inputVersionId: 'v1', descriptionRevisionId: 'r1' }] };
  const selection = { datasetId: 'd', inputVersionId: 'v1', descriptionRevisionId: 'r2' };
  const next = addTaskProjectDataSelection(old, 'project-b', 'task-a', selection);
  assert.deepEqual(next['project-a/task-a'], old['project-a/task-a']);
  assert.deepEqual(next['project-b/task-a'], [selection]);
  assert.equal(old['project-b/task-a' as keyof typeof old], undefined);
  assert.deepEqual(addTaskProjectDataSelection(next, 'project-b', 'task-a', selection), next);
  const changed = addTaskProjectDataSelection(next, 'project-b', 'task-a', { ...selection, descriptionRevisionId: 'r3' });
  assert.deepEqual(changed['project-b/task-a'], [selection, { ...selection, descriptionRevisionId: 'r3' }]);
});

test('MC02/MC07 UI client: preview and history use exact project/version routes without running an agent', async () => {
  const calls: { path: string; init?: RequestInit }[] = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), init }); return new Response(JSON.stringify({ index: null, datasets: [], citations: [] }), { status: 200 }); };
  try {
    await readProjectDataContext('project/a');
    await previewProjectDataFile('project/a', '020_clean/synthetic.csv');
    await readProjectDataDescription('project/a', 'dataset/1', 'revision/old');
    await prepareProjectDataCopy('project/a', 'dataset/1', 'input/old');
    assert.deepEqual(calls.map(call => call.path), ['/api/projects/project%2Fa/data-context', '/api/projects/project%2Fa/data-context/preview', '/api/projects/project%2Fa/data-context/datasets/dataset%2F1/descriptions/revision%2Fold', '/api/projects/project%2Fa/data-context/prepare']);
    assert.equal(calls[2]!.init?.method, 'GET');
    assert.deepEqual(JSON.parse(String(calls[3]!.init?.body)), { datasetId: 'dataset/1', inputVersionId: 'input/old' });
    assert.ok(calls.every(call => call.init?.credentials === 'omit' && call.init?.cache === 'no-store'));
  } finally { globalThis.fetch = originalFetch; }
});

test('MC08 UI client: conflict remains a failure and does not retry or use latest', async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: 'input_version_changed', message: '固定内容已变化。' }), { status: 409 }); };
  try { await assert.rejects(() => readProjectDataDescription('project', 'dataset', 'old-revision'), error => error instanceof ProjectDataContextRequestError && error.code === 'input_version_changed' && error.status === 409 && error.message === '固定内容已变化。'); assert.equal(calls, 1); }
  finally { globalThis.fetch = originalFetch; }
});

test('MC03 UI: unknown observation counts remain unknown and zero remains explicit', () => {
  assert.equal(observationCount(''), null);
  assert.equal(observationCount('  '), null);
  assert.equal(observationCount('0'), 0);
  assert.equal(observationCount('42'), 42);
  for (const input of ['-1', '1.5', 'invalid', 'Infinity', '9007199254740992']) assert.throws(() => observationCount(input));
});

test('MC03 UI: invalid observation imports cannot enter render state or invent execution evidence', () => {
  const valid = { author: 'user', format: 'csv', encoding: 'UTF-8', recordRule: 'CSV logical data records, header excluded', coverage: 'partial', scannedRows: 1, totalRows: null, fields: [{ location: { kind: 'csv-column', columnIndex: 0 }, originalName: 'amount', observedType: 'number' }], limitations: 'one row only', generatedAt: null, nativeEvidence: null, artifactEvidence: null };
  assert.deepEqual(parseObservationImport(JSON.stringify(valid)), valid);
  for (const change of [{ fields: [null] }, { fields: [{ location: null, originalName: 'x', observedType: 'number' }] }, { fields: [{ location: { kind: 'csv-column', columnIndex: -1 }, originalName: 'x', observedType: 'number' }] }, { format: 'bogus' }, { author: ['user'] }, { scannedRows: -1 }, { coverage: 'complete', totalRows: 2 }, { nativeEvidence: { taskId: 'not-a-uuid' } }, { artifactEvidence: { path: '../outside', sha256: 'x' } }, { generatedAt: 'not-a-date' }]) { const input = { ...valid, ...change }; assert.throws(() => parseObservationImport(JSON.stringify(input))); assert.throws(() => validateHostObservation(input)); }
  const withEvidence = { ...valid, generatedAt: '2026-11-03T00:00:00.000Z', nativeEvidence: { taskId: '00000000-0000-4000-8000-000000000009', nativeSessionId: 'actual-session', entryId: 'actual-entry' }, artifactEvidence: { path: '020_clean/observation.json', sha256: 'a'.repeat(64) } };
  assert.deepEqual(parseObservationImport(JSON.stringify(withEvidence)), validateHostObservation(withEvidence));
  const json = { ...valid, format: 'json', encoding: null, fields: [{ location: { kind: 'json-pointer', pointer: '/a~1b' }, originalName: 'a/b', observedType: 'number' }] };
  assert.deepEqual(parseObservationImport(JSON.stringify(json)), validateHostObservation(json));
});

test('MC04 UI: current status checks preserve exact refs and distinguish disabled, missing, corrupt and unknown', async () => {
  const originalFetch = globalThis.fetch, concept = { storeId: 'store', materialId: 'material', revisionId: 'old-revision' }, metric = { packageId: 'package', version: '1.0.0', metricName: 'amount', publishedHash: null };
  let body: unknown, path = '';
  globalThis.fetch = async (input, init) => { path = String(input); body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ concepts: [{ ref: concept, status: 'disabled' }], metrics: [{ ref: metric, status: 'corrupt' }] }), { status: 200 }); };
  try { const result = await readProjectDataSourceStatus('project', [concept], [metric]); assert.equal(path, '/api/projects/project/data-context/source-status'); assert.deepEqual(body, { conceptRefs: [concept], sapRefs: [metric] }); assert.deepEqual(result.concepts[0]?.ref, concept); assert.deepEqual(result.metrics[0]?.ref, metric); assert.deepEqual(['available', 'disabled', 'missing', 'corrupt', 'unknown'].map(status => projectDataSourceStatusLabel(status as 'available' | 'disabled' | 'missing' | 'corrupt' | 'unknown')), ['可读取', '已停用', '缺失', '损坏', '未知']); assert.equal(projectDataSourceStatusLabel(undefined), '未知（尚未核对）'); }
  finally { globalThis.fetch = originalFetch; }
});

test('MC03 UI: explicit confirmation with a blank personal label records user, ordinary save stays unconfirmed', async () => {
  const bodies: SaveDataDescription[] = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({}), { status: 201 }); };
  const input: SaveDataDescription = {
    operationId: '00000000-0000-4000-8000-000000000001', descriptionRevisionId: '00000000-0000-4000-8000-000000000001',
    datasetId: '00000000-0000-4000-8000-000000000002', inputVersionId: '00000000-0000-4000-8000-000000000003', baseIndexRevision: 1,
    observation: { author: 'user', format: 'csv', encoding: 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '', generatedAt: null, nativeEvidence: null, artifactEvidence: null },
    statements: [], mappings: [], confirmStatementIds: ['00000000-0000-4000-8000-000000000004'], confirmMappingIds: [], confirmedBy: null,
  };
  try {
    await saveProjectDataDescription('synthetic-project', input);
    await saveProjectDataDescription('synthetic-project', { ...input, confirmedBy: '  ' });
    await saveProjectDataDescription('synthetic-project', { ...input, confirmStatementIds: [] });
    assert.equal(bodies[0]?.confirmedBy, 'user');
    assert.equal(bodies[1]?.confirmedBy, 'user');
    assert.equal(bodies[2]?.confirmedBy, null);
    assert.equal(input.confirmedBy, null);
  } finally { globalThis.fetch = originalFetch; }
});


test('MC08 UI: corrupt native project-data entries stay explicit UNKNOWN without breaking valid entries', () => {
  const projectId = '00000000-0000-4000-8000-000000000001', datasetId = '00000000-0000-4000-8000-000000000002', inputVersionId = '00000000-0000-4000-8000-000000000003';
  const providedAt = '2026-11-03T00:00:00.000Z';
  const valid = { selection: { datasetId, inputVersionId, descriptionRevisionId: null }, version: { projectId, datasetId, inputVersionId, sourcePath: '020_clean/synthetic.csv', sha256: 'a'.repeat(64), bytes: 5, savedAt: providedAt }, description: null, analysisCopy: { path: '020_clean/copy/synthetic.csv', sha256: 'a'.repeat(64), bytes: 5, preparedAt: providedAt }, providedAt };
  const observation = { author: 'user', format: 'csv', encoding: 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '', generatedAt: null, nativeEvidence: null, artifactEvidence: null };
  const description = { projectId, datasetId, inputVersionId, descriptionRevisionId: '00000000-0000-4000-8000-000000000004', observation, statements: [{ statementId: '00000000-0000-4000-8000-000000000005', scope: 'row-meaning', location: null, text: 'synthetic rows', unit: null, provenance: 'user-statement', confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [{ mappingId: '00000000-0000-4000-8000-000000000006', location: { kind: 'csv-column', columnIndex: 0 }, conceptRefs: [{ storeId: 'synthetic-store', materialId: '00000000-0000-4000-8000-000000000007', revisionId: '00000000-0000-4000-8000-000000000008' }], sapRefs: [], dispute: '', provenance: 'user-statement', confirmed: false, confirmedAt: null, confirmedBy: null }] };
  const withDescription = { ...valid, selection: { ...valid.selection, descriptionRevisionId: description.descriptionRevisionId }, description };
  const corrupt = [null, { ...valid, description: {} }, { ...withDescription, description: { ...description, observation: null } }, { ...withDescription, description: { ...description, statements: [null] } }, { ...withDescription, description: { ...description, mappings: [{ mappingId: 'bad', location: null, conceptRefs: null, sapRefs: [] }] } }, { ...valid, version: { ...valid.version, bytes: {} } }, { ...valid, providedAt: {} }];
  const input = [valid, ...corrupt, withDescription], before = JSON.stringify(input);
  const projected = projectDataProvisionEntries(input, projectId);
  assert.equal(projected.length, input.length);
  assert.deepEqual(projected.map(item => item.kind), ['available', ...corrupt.map(() => 'unknown'), 'available']);
  assert.equal(projectDataProvisionEntries({ malformed: true }, projectId)[0]?.kind, 'unknown');
  assert.deepEqual(projectDataProvisionEntries(undefined, projectId), []);
  assert.equal(projectDataProvisionEntries([valid], '00000000-0000-4000-8000-000000000009')[0]?.kind, 'unknown');
  assert.equal(JSON.stringify(input), before);
});

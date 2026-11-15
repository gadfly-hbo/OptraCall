import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbLinkResults, type DbResultAcquisition, type DbResultOwner, type DbResultSource } from '../src/host/db-link-results.ts';
import { createHash } from 'node:crypto';

const owner: DbResultOwner = { projectId: 'project-one', taskId: 'task-one', requestId: 'request-one', operationId: 'operation-one' };
const source: DbResultSource = {
  connectionId: 'connection-one', connectionRevision: 1, engine: 'postgresql', sourceIdentity: 'synthetic-server',
  sql: 'select id, amount from sales.orders', parameters: [], observedObjects: ['sales.orders'], declaredObjects: [], unknownObjects: [],
  startedAt: '2026-11-14T00:00:00Z', session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'read committed' },
};
const columns = [
  { ordinal: 0, name: 'value', databaseType: 'int8', precision: null, scale: null },
  { ordinal: 1, name: 'value', databaseType: 'numeric', precision: 28, scale: 4 },
  { ordinal: 2, name: 'note', databaseType: 'text', precision: null, scale: null },
];
const limits = { maxRows: 100, maxBytes: 100_000, maxCellBytes: 1000, chunkBytes: 1000 };

test('one logical large value is stored and read by bounded segments without inflating business row count', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-segments-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, { ...limits, maxBytes: 1_000_000 });
    // The complete value is bigger than the writer's per-value working buffer.
    // Individual segments deliberately split a four-byte UTF8 character.
    const original = Buffer.from('😀中文'.repeat(700)), key = ['order-1'];
    const valueId = await sink.beginValue({ row: 0, column: 2, totalBytes: original.length, representation: 'utf8', databaseType: 'text', stableKey: key });
    for (let offset = 0; offset < original.length; offset += 997) await sink.appendValueSegment(valueId, offset, original.subarray(offset, offset + 997).toString('base64'));
    const reference = await sink.completeValue(valueId);
    await sink.append([['1', '10.0000', reference]]);
    const receipt = await sink.complete('1'), loaded = await store.read(owner, receipt.id);
    assert.equal(receipt.rows, 1);
    assert.equal(loaded.manifest.persistedRows, 1);
    assert.equal(loaded.manifest.values?.[0]?.sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(loaded.coverage.complete, false, 'a row reference does not supply the whole long value to the model');
    assert.deepEqual(loaded.rows[0]?.[2], reference);
    const page = await store.readValue(owner, receipt.id, valueId, { startByte: 995, maxBytes: 17 });
    assert.equal(page.base64, original.subarray(995, 1012).toString('base64'));
    assert.equal(page.coverage.complete, false);
    assert.equal(page.coverage.providedBytes, 17);
    const material = await store.materialFiles(owner, receipt.id);
    assert.ok(material.files.some(file => file.relativePath.includes('/value-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('segmented provenance retains sparse actual transport parameters without duplicating business parameters into part bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-transport-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, limits);
    const valueId = await sink.beginValue({ row: 0, column: 2, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['one'] });
    const transportParameters = [{ parameter: 2, value: '1' }, { parameter: 3, value: 3 }];
    await sink.appendValueSegment(valueId, 0, Buffer.from('abc').toString('base64'), transportParameters);
    await sink.append([['1', '2.0000', await sink.completeValue(valueId)]]);
    const receipt = await sink.complete('1'), fixed = await store.materialFiles(owner, receipt.id);
    assert.deepEqual(fixed.manifest.values?.[0].parts[0].transportParameters, transportParameters);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('complete database results preserve exact scalar text, duplicate columns and their original owner across reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const options = { dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: (value: DbResultOwner) => { if (value.projectId !== owner.projectId) throw new Error('project_forbidden'); } };
    const store = new DbLinkResults(options);
    const sink = await store.begin(owner, source, columns, limits);
    await sink.append([['9007199254740993', '12345678901234567890.4500', null]]);
    const receipt = await sink.complete('1');
    const loaded = await new DbLinkResults(options).read(owner, receipt.id);
    assert.equal(loaded.manifest.status, 'complete');
    assert.deepEqual(loaded.manifest.columns, columns);
    assert.deepEqual(loaded.rows, [['9007199254740993', '12345678901234567890.4500', null]]);
    assert.equal(loaded.manifest.serverRowCount, '1');
    assert.equal(loaded.manifest.receivedRows, 1);
    assert.equal(Object.hasOwn(loaded.manifest, 'acquisition'), false, 'legacy schema1 results do not invent unknown acquisition counters');
    assert.deepEqual(loaded.manifest.owner, owner);
    assert.deepEqual((await store.list(owner)).map(value => value.id), [receipt.id]);
    await assert.rejects(store.read({ ...owner, projectId: 'other-project' }, receipt.id), /project_forbidden/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('database preview is bounded and reports unread result rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, { ...limits, maxRows: 500, maxBytes: 1_000_000 });
    await sink.append(Array.from({ length: 200 }, (_, index) => [String(index), '0.1000', null]));
    const receipt = await sink.complete('200');
    const preview = await store.read(owner, receipt.id);
    assert.equal(preview.rows.length, 100);
    assert.equal(preview.coverage.complete, false);
    assert.equal(preview.coverage.resultRows, 200);
    assert.equal(preview.coverage.readRows, 100);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('known server row counts cannot promote missing rows into complete review material', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, limits);
    await sink.append([['1', '10.0000', null]]);
    await assert.rejects(sink.complete('2'), /db_result_row_count_mismatch/);
    await assert.rejects(sink.complete('1'), /db_result_incomplete/);
    const receipt = await sink.abort('partial', 'db_result_row_count_mismatch');
    const material = await store.read(owner, receipt.id);
    assert.equal(material.manifest.status, 'partial');
    assert.equal(material.manifest.serverRowCount, '2');
    assert.equal(material.manifest.persistedRows, 1);
    await assert.rejects(store.materialFiles(owner, receipt.id), /db_result_incomplete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('row limit preserves only partial material and refuses promotion to a complete input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, { ...limits, maxRows: 1 });
    await sink.append([['1', '10.0000', null]]);
    await assert.rejects(sink.append([['2', '20.0000', null]]), /db_result_row_limit/);
    await assert.rejects(sink.complete('2'), /db_result_incomplete/);
    const receipt = await sink.abort('partial', 'row_limit');
    const material = await store.read(owner, receipt.id);
    assert.equal(material.manifest.status, 'partial');
    assert.equal(material.manifest.receivedRows, 2);
    assert.equal(material.manifest.persistedRows, 1);
    assert.deepEqual(material.rows, [['1', '10.0000', null]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('changed result bytes cannot be read as the original captured result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, limits);
    await sink.append([['1', '10.0000', null]]);
    const receipt = await sink.complete('1');
    await writeFile(join(projectDir, receipt.relativePath.replace('manifest.json', 'rows-000001.json')), '{}');
    await assert.rejects(store.read(owner, receipt.id), /db_result_changed|db_result_corrupt/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fixing a result bundle verifies every chunk and never admits partial or changed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, { ...limits, chunkBytes: 300 });
    await sink.append([['1', '10.0000', 'first'], ['2', '20.0000', 'second']]);
    const receipt = await sink.complete('2');
    const fixed = await store.materialFiles(owner, receipt.id);
    assert.equal(fixed.files[0].relativePath, receipt.relativePath);
    assert.equal(fixed.files.length, 3);
    assert.deepEqual(fixed.files.map(value => value.role), ['manifest', 'chunk', 'chunk']);
    await writeFile(join(projectDir, receipt.relativePath.replace('manifest.json', 'rows-000002.json')), '{}');
    await assert.rejects(store.materialFiles(owner, receipt.id), /db_result_changed|db_result_corrupt/);
    const partial = await store.begin(owner, source, columns, limits);
    const incomplete = await partial.abort('cancelled', 'user_stop');
    await assert.rejects(store.materialFiles(owner, incomplete.id), /db_result_incomplete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('partial results retain driver-decoded rows separately from sink rows and the bounded preview after reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-receiving-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const options = { dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} }, store = new DbLinkResults(options);
    const sink = await store.begin(owner, source, columns, limits);
    await sink.append(Array.from({ length: 100 }, (_, index) => [String(index), '0.1000', null]));
    const acquisition = { driverReceivedRows: 128, rowAccounting: 'after-driver-decode' as const, transport: { scope: 'physical-connection' as const, receivedBytes: 12000, forwardedBytes: 11000, maxReceiveBytes: 11000, rejected: true } };
    const receipt = await sink.abort('partial', 'driver_batch_row_limit', acquisition);
    const loaded = await new DbLinkResults(options).read(owner, receipt.id, { maxRows: 10 });
    assert.deepEqual(loaded.manifest.acquisition, acquisition);
    assert.equal(loaded.manifest.receivedRows, 100); assert.equal(loaded.manifest.persistedRows, 100);
    assert.equal(loaded.rows.length, 10); assert.equal(loaded.coverage.resultRows, 100); assert.equal(loaded.coverage.readRows, 10); assert.equal(loaded.coverage.complete, false);
    await assert.rejects(store.materialFiles(owner, receipt.id), /db_result_incomplete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid acquisition facts cannot publish complete material or prevent saving the original partial rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-invalid-receiving-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const base = { driverReceivedRows: 1, rowAccounting: 'after-driver-decode' }, transport = { scope: 'physical-connection', receivedBytes: 20, forwardedBytes: 10, maxReceiveBytes: 10, rejected: true };
    for (const acquisition of [
      ...[-1, 0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(driverReceivedRows => ({ ...base, driverReceivedRows })),
      { ...base, rowAccounting: 'before-decode' }, { ...base, extra: true },
      { ...base, transport: { ...transport, forwardedBytes: 21 } },
      { ...base, transport: { ...transport, forwardedBytes: 11 } },
      { ...base, transport: { ...transport, receivedBytes: Infinity } },
      { ...base, transport: { ...transport, scope: 'result-data' } },
    ]) {
      const sink = await store.begin(owner, source, columns, limits); await sink.append([['1', '10.0000', null]]);
      await assert.rejects(sink.complete('1', acquisition as DbResultAcquisition), /db_result_invalid_acquisition/);
      await assert.rejects(sink.complete('1'), /db_result_incomplete/);
      const receipt = await sink.abort('partial', 'invalid_acquisition');
      const saved = await store.read(owner, receipt.id); assert.equal(saved.manifest.status, 'partial'); assert.equal(saved.manifest.persistedRows, 1); assert.deepEqual(saved.rows, [['1', '10.0000', null]]);
      assert.equal(saved.manifest.acquisition, undefined);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('driver rows omitted before sink delivery and rejected transport cannot be promoted by matching sink row counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-incomplete-receiving-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const options = { dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} }, store = new DbLinkResults(options);
    for (const acquisition of [
      { driverReceivedRows: 2, rowAccounting: 'after-driver-decode' as const },
      { driverReceivedRows: 1, rowAccounting: 'after-driver-decode' as const, transport: { scope: 'physical-connection' as const, receivedBytes: 12, forwardedBytes: 10, maxReceiveBytes: 10, rejected: true } },
    ]) {
      const sink = await store.begin(owner, source, columns, limits); await sink.append([['1', '10.0000', null]]);
      await assert.rejects(sink.complete('1', acquisition), /db_result_acquisition_incomplete/);
      await assert.rejects(sink.complete('1'), /db_result_incomplete/);
      const receipt = await sink.abort('partial', 'acquisition_incomplete');
      const loaded = await new DbLinkResults(options).read(owner, receipt.id); assert.equal(loaded.manifest.status, 'partial'); assert.deepEqual(loaded.manifest.acquisition, acquisition); assert.equal(loaded.rows.length, 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('complete acquisition facts roundtrip independently from stored bytes and preserve captured session visibility', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-complete-receiving-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const options = { dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} }, store = new DbLinkResults(options);
    const capturedSource = { ...source, session: { ...source.session, serverVersionNum: '180001', loginRole: 'reader_login', effectiveRole: 'reader_login', visibleScope: 'current-account-visible' as const } };
    for (const acquisition of [
      { driverReceivedRows: 1, rowAccounting: 'after-driver-decode' as const },
      { driverReceivedRows: 1, rowAccounting: 'after-driver-decode' as const, transport: { scope: 'physical-connection' as const, receivedBytes: 10000, forwardedBytes: 10000, maxReceiveBytes: 20000, rejected: false } },
    ]) {
      const expected = structuredClone(acquisition), sink = await store.begin(owner, capturedSource, columns, limits); await sink.append([['9007199254740993', '10.0000', null]]);
      const finishing = sink.complete('1', acquisition); acquisition.driverReceivedRows = 99;
      const receipt = await finishing, loaded = await new DbLinkResults(options).read(owner, receipt.id);
      assert.equal(loaded.manifest.status, 'complete'); assert.deepEqual(loaded.manifest.acquisition, expected); assert.deepEqual(loaded.manifest.source.session, capturedSource.session);
      assert.equal(loaded.manifest.receivedRows, 1); assert.equal(loaded.manifest.persistedRows, 1); assert.equal(loaded.coverage.complete, true);
      assert.equal((await store.materialFiles(owner, receipt.id)).manifest.acquisition?.driverReceivedRows, 1);
    }
    const partial = await store.begin(owner, source, columns, limits); await partial.append([['1', '10.0000', null]]);
    await assert.rejects(partial.abort('partial', 'invalid-facts', { driverReceivedRows: -1, rowAccounting: 'after-driver-decode' }), /db_result_invalid_acquisition/);
    const receipt = await partial.abort('partial', 'facts-unavailable'), preserved = await store.read(owner, receipt.id);
    assert.deepEqual(preserved.rows, [['1', '10.0000', null]]); assert.equal(preserved.manifest.acquisition, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source limitations accept bounded public technical codes and reject raw errors or connection text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-limitations-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    for (const limitations of [['postgres://reader:password@db.example.test/private'], ['raw database error with a secret'], ['db_valid\npassword'], ['db_' + 'x'.repeat(158)], Array.from({ length: 101 }, () => 'db_public_limit')]) await assert.rejects(store.begin(owner, { ...source, limitations }, columns, limits), /db_result_invalid_limitations/);
    const captured = { ...source, limitations: ['db_view_scope_not_independently_verified', 'db_current_role_policy_visible_scope'] }, sink = await store.begin(owner, captured, columns, limits);
    await sink.append([['1', '10.0000', null]]); const receipt = await sink.complete('1'); assert.deepEqual((await store.read(owner, receipt.id)).manifest.source.limitations, captured.limitations);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('incomplete segmented bodies expose only their original manifest in explicit structure-description mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'db-results-structure-partial-'));
  try {
    const projectDir = join(root, 'project'); await mkdir(projectDir);
    const store = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => projectDir, assertAccess: () => {} });
    const sink = await store.begin(owner, source, columns, limits), valueId = await sink.beginValue({ row: 0, column: 2, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['one'] });
    await sink.appendValueSegment(valueId, 0, Buffer.from('a').toString('base64')); const receipt = await sink.abort('failed', 'db_value_incomplete');
    await assert.rejects(store.materialFiles(owner, receipt.id), /db_result_incomplete/);
    const structure = await store.materialFiles(owner, receipt.id, { mode: 'structure-description' });
    assert.equal(structure.manifest.status, 'failed'); assert.equal(structure.manifest.values![0].complete, false); assert.equal(structure.files.length, 1); assert.equal(structure.files[0].role, 'manifest'); assert.equal(structure.files[0].sha256, receipt.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

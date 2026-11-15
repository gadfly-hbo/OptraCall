import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbLinkResults, type DbResultOwner, type DbResultSource } from '../src/host/db-link-results.ts';
import { createHash } from 'node:crypto';

const owner: DbResultOwner = { projectId: 'segment-project', taskId: 'segment-task', requestId: 'segment-request', operationId: 'segment-operation' };
const source: DbResultSource = {
  connectionId: 'segment-connection', connectionRevision: 1, engine: 'postgresql', sourceIdentity: 'synthetic-segment-server',
  sql: 'SELECT note FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: '9007199254740993' }],
  observedObjects: ['sales.orders'], declaredObjects: [], unknownObjects: [], startedAt: '2026-11-14T00:00:00Z',
  session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read', snapshot: 'synthetic-fixed-observation' },
};
const columns = [{ ordinal: 0, name: 'note', databaseType: 'text', precision: null, scale: null }];
const limits = { maxRows: 10, maxBytes: 100_000, maxCellBytes: 16, chunkBytes: 1024 };

async function fixture(t: TestContext, assertAccess: (value: DbResultOwner, mode: 'read' | 'write') => void | Promise<void> = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'db-segment-boundaries-')), project = join(root, 'project');
  await mkdir(project);
  t.after(() => rm(root, { recursive: true, force: true }));
  const results = new DbLinkResults({ dataRoot: join(root, 'host'), projectDirectory: () => project, assertAccess });
  const sink = await results.begin(owner, source, columns, limits);
  return { root, project, results, sink };
}

test('a completely transferred value cannot make complete material without its logical row reference', async t => {
  const { sink } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('abc').toString('base64'));
  await sink.completeValue(valueId);
  await sink.append([['other-value']]);
  await assert.rejects(sink.complete('1'), /db_result_(?:invalid_value_reference|value_unreferenced|value_incomplete)/);
});

test('reading fixed material rejects a value that is complete in the manifest but absent from its logical cell', async t => {
  const { sink, results, root, project } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('abc').toString('base64'));
  const reference = await sink.completeValue(valueId);
  await sink.append([[reference]]);
  const receipt = await sink.complete('1');
  const manifestFile = join(project, receipt.relativePath), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const rowFile = join(project, receipt.relativePath.replace('manifest.json', 'rows-000001.json'));
  // Simulate a re-signed but internally inconsistent fixed asset. Hashes alone
  // cannot prove that a value descriptor actually backs the cited logical cell.
  const rowText = JSON.stringify({ columns, rows: [['other-value']] });
  await writeFile(rowFile, rowText);
  const oldBytes = manifest.chunks[0].bytes;
  manifest.chunks[0].bytes = Buffer.byteLength(rowText);
  manifest.chunks[0].sha256 = createHash('sha256').update(rowText).digest('hex');
  manifest.bytes += manifest.chunks[0].bytes - oldBytes;
  const manifestText = JSON.stringify(manifest);
  await writeFile(manifestFile, manifestText);
  const indexFile = join(root, 'host', 'db-link', 'results.json'), index = JSON.parse(await readFile(indexFile, 'utf8'));
  index.results[0].sha256 = createHash('sha256').update(manifestText).digest('hex');
  index.results[0].bytes = manifest.bytes + Buffer.byteLength(manifestText);
  await writeFile(indexFile, JSON.stringify(index));
  await assert.rejects(results.read(owner, receipt.id), /db_result_(?:corrupt|invalid_value_reference|value_unreferenced|value_incomplete)/);
});

test('reading one value verifies its logical reference even when its row is beyond the ordinary preview', async t => {
  const { sink, results, root, project } = await fixture(t);
  // Fill one small row chunk before the value-bearing second row, so the
  // ordinary one-row preview does not need to load the second chunk.
  await sink.append([['a'.repeat(16)]]);
  const valueId = await sink.beginValue({ row: 1, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-2'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('abc').toString('base64'));
  const reference = await sink.completeValue(valueId);
  await sink.append([[reference]]);
  const receipt = await sink.complete('2');
  const manifestFile = join(project, receipt.relativePath), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  // Make each row its own canonical chunk using the public persisted format.
  const first = JSON.stringify({ columns, rows: [['a'.repeat(16)]] });
  const second = JSON.stringify({ columns, rows: [['other-value']] });
  const rowDirectory = manifestFile.slice(0, -'manifest.json'.length);
  await writeFile(join(rowDirectory, 'rows-000001.json'), first);
  await writeFile(join(rowDirectory, 'rows-000002.json'), second);
  const oldRowBytes = manifest.chunks.reduce((sum: number, chunk: { bytes: number }) => sum + chunk.bytes, 0);
  manifest.chunks = [first, second].map((text, index) => ({ file: `rows-${String(index + 1).padStart(6, '0')}.json`, bytes: Buffer.byteLength(text), rows: 1, sha256: createHash('sha256').update(text).digest('hex') }));
  manifest.bytes += Buffer.byteLength(first) + Buffer.byteLength(second) - oldRowBytes;
  const manifestText = JSON.stringify(manifest);
  await writeFile(manifestFile, manifestText);
  const indexFile = join(root, 'host', 'db-link', 'results.json'), index = JSON.parse(await readFile(indexFile, 'utf8'));
  index.results[0].sha256 = createHash('sha256').update(manifestText).digest('hex');
  index.results[0].bytes = manifest.bytes + Buffer.byteLength(manifestText);
  await writeFile(indexFile, JSON.stringify(index));
  await assert.rejects(results.readValue(owner, receipt.id, valueId, { maxBytes: 2 }), /db_result_(?:corrupt|invalid_value_reference|value_unreferenced|value_incomplete)/);
});

test('a segment beginning after a gap cannot promote partial bytes into a complete value', async t => {
  const { sink, results } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await assert.rejects(sink.appendValueSegment(valueId, 1, Buffer.from('bc').toString('base64')), /db_result_invalid_segment/);
  await assert.rejects(sink.completeValue(valueId), /db_result_not_writable/);
  const receipt = await sink.abort('partial', 'segment-gap');
  const observed = await results.read(owner, receipt.id);
  assert.equal(observed.manifest.status, 'partial');
  assert.equal(observed.manifest.values?.[0]?.receivedBytes, 0);
  assert.equal(observed.manifest.values?.[0]?.complete, false);
  await assert.rejects(results.materialFiles(owner, receipt.id), /db_result_incomplete/);
});

test('a duplicate offset does not overwrite the first segment or become a complete value', async t => {
  const { sink, results } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 4, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('ab').toString('base64'));
  await assert.rejects(sink.appendValueSegment(valueId, 0, Buffer.from('XY').toString('base64')), /db_result_invalid_segment/);
  await assert.rejects(sink.complete('0'), /db_result_incomplete/);
  const receipt = await sink.abort('partial', 'duplicate-offset');
  const observed = await results.read(owner, receipt.id), value = observed.manifest.values?.[0];
  assert.equal(value?.receivedBytes, 2);
  assert.equal(value?.parts.length, 1);
  assert.equal(value?.complete, false);
  await assert.rejects(results.materialFiles(owner, receipt.id), /db_result_incomplete/);
});

test('missing final bytes remain partial and cannot be declared a complete logical value', async t => {
  const { sink, results } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 4, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('abc').toString('base64'));
  await assert.rejects(sink.completeValue(valueId), /db_result_value_incomplete/);
  await assert.rejects(sink.complete('0'), /db_result_value_incomplete/);
  const receipt = await sink.abort('partial', 'missing-final-byte');
  const observed = await results.read(owner, receipt.id);
  assert.equal(observed.manifest.values?.[0]?.receivedBytes, 3);
  assert.equal(observed.manifest.values?.[0]?.totalBytes, 4);
  assert.equal(observed.manifest.values?.[0]?.complete, false);
  assert.equal(observed.coverage.complete, false);
});

test('malformed UTF8 continued across two valid-size segments never becomes complete text', async t => {
  const { sink, results } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 4, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from([0xf0, 0x9f]).toString('base64'));
  await assert.rejects(sink.appendValueSegment(valueId, 2, Buffer.from([0x41, 0x80]).toString('base64')), /db_result_(?:invalid_utf8|segment_write_failed)/);
  await assert.rejects(sink.completeValue(valueId), /db_result_not_writable/);
  const receipt = await sink.abort('partial', 'malformed-utf8');
  const observed = await results.read(owner, receipt.id);
  assert.equal(observed.manifest.values?.[0]?.receivedBytes, 2);
  assert.equal(observed.manifest.values?.[0]?.complete, false);
});

test('an unfinished UTF8 character at the declared final byte is not silently replaced', async t => {
  const { sink, results } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 2, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from([0xf0, 0x9f]).toString('base64'));
  await assert.rejects(sink.completeValue(valueId), /db_result_invalid_utf8/);
  await assert.rejects(sink.complete('0'), /db_result_incomplete/);
  const receipt = await sink.abort('partial', 'unfinished-utf8');
  const observed = await results.read(owner, receipt.id);
  assert.equal(observed.manifest.values?.[0]?.complete, false);
  assert.equal(observed.manifest.values?.[0]?.sha256, null);
});

test('one over-budget segment is rejected before any bytes of it are retained as a value', async t => {
  const { sink, results } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 17, representation: 'binary', databaseType: 'bytea', stableKey: ['order-1'] });
  await assert.rejects(sink.appendValueSegment(valueId, 0, Buffer.alloc(17, 0xff).toString('base64')), /db_result_invalid_segment/);
  await assert.rejects(sink.completeValue(valueId), /db_result_not_writable/);
  const receipt = await sink.abort('partial', 'segment-limit');
  const observed = await results.read(owner, receipt.id);
  assert.equal(observed.manifest.values?.[0]?.receivedBytes, 0);
  assert.deepEqual(observed.manifest.values?.[0]?.parts, []);
});

test('revoked write access between segments retains cancelled partial evidence without admitting a complete result', async t => {
  let revoked = false;
  const { sink, results } = await fixture(t, (_owner, mode) => { if (revoked && mode === 'write') throw new Error('synthetic_write_revoked'); });
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 4, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('ab').toString('base64'));
  revoked = true;
  await assert.rejects(sink.appendValueSegment(valueId, 2, Buffer.from('cd').toString('base64')), /synthetic_write_revoked/);
  await assert.rejects(sink.complete('0'), /synthetic_write_revoked/);
  const receipt = await sink.abort('cancelled', 'source-revoked');
  const observed = await results.read(owner, receipt.id);
  assert.equal(observed.manifest.status, 'cancelled');
  assert.equal(observed.manifest.values?.[0]?.receivedBytes, 2);
  assert.equal(observed.manifest.values?.[0]?.complete, false);
  await assert.rejects(results.materialFiles(owner, receipt.id), /db_result_incomplete/);
});

test('changed value-part bytes cannot be read or frozen as the original fixed material', async t => {
  const { sink, results, project } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('abc').toString('base64'));
  const reference = await sink.completeValue(valueId);
  await sink.append([[reference]]);
  const receipt = await sink.complete('1'), observed = await results.read(owner, receipt.id);
  const part = observed.manifest.values![0]!.parts[0]!;
  await writeFile(join(project, receipt.relativePath.replace('manifest.json', part.file)), JSON.stringify({ offset: 0, base64: Buffer.from('XYZ').toString('base64') }));
  await assert.rejects(results.readValue(owner, receipt.id, valueId, { maxBytes: 2 }), /db_result_changed/);
  await assert.rejects(results.materialFiles(owner, receipt.id), /db_result_changed/);
});

test('a value identifier is bound to its exact result and cannot be read under another project', async t => {
  const { sink, results } = await fixture(t);
  const first = await sink.beginValue({ row: 0, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(first, 0, Buffer.from('abc').toString('base64'));
  await sink.append([[await sink.completeValue(first)]]);
  const firstReceipt = await sink.complete('1');
  const secondSink = await results.begin({ ...owner, operationId: 'another-operation' }, source, columns, limits);
  const second = await secondSink.beginValue({ row: 0, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-2'] });
  await secondSink.appendValueSegment(second, 0, Buffer.from('XYZ').toString('base64'));
  await secondSink.append([[await secondSink.completeValue(second)]]);
  const secondReceipt = await secondSink.complete('1');
  await assert.rejects(results.readValue(owner, secondReceipt.id, first), /db_result_value_not_found/);
  await assert.rejects(results.readValue(owner, firstReceipt.id, second), /db_result_value_not_found/);
  await assert.rejects(results.readValue({ ...owner, projectId: 'another-project' }, firstReceipt.id, first), /db_result_not_found/);
  const allowed = await results.readValue(owner, firstReceipt.id, first);
  assert.equal(allowed.base64, Buffer.from('abc').toString('base64'));
  assert.equal(allowed.coverage.complete, true);
});

test('a full value preview cannot claim complete when the declared aggregate digest disagrees with its bytes', async t => {
  const { sink, results, root, project } = await fixture(t);
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 3, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  await sink.appendValueSegment(valueId, 0, Buffer.from('abc').toString('base64'));
  await sink.append([[await sink.completeValue(valueId)]]);
  const receipt = await sink.complete('1'), manifestFile = join(project, receipt.relativePath);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.values[0].sha256 = '0'.repeat(64);
  const rowFile = join(project, receipt.relativePath.replace('manifest.json', 'rows-000001.json'));
  const row = JSON.parse(await readFile(rowFile, 'utf8'));
  row.rows[0][0].sha256 = manifest.values[0].sha256;
  const rowText = JSON.stringify(row), oldRowBytes = manifest.chunks[0].bytes;
  await writeFile(rowFile, rowText);
  manifest.chunks[0].bytes = Buffer.byteLength(rowText);
  manifest.chunks[0].sha256 = createHash('sha256').update(rowText).digest('hex');
  manifest.bytes += Buffer.byteLength(rowText) - oldRowBytes;
  const manifestText = JSON.stringify(manifest);
  await writeFile(manifestFile, manifestText);
  const indexFile = join(root, 'host', 'db-link', 'results.json'), index = JSON.parse(await readFile(indexFile, 'utf8'));
  index.results[0].sha256 = createHash('sha256').update(manifestText).digest('hex');
  index.results[0].bytes = manifest.bytes + Buffer.byteLength(manifestText);
  await writeFile(indexFile, JSON.stringify(index));
  await assert.rejects(results.readValue(owner, receipt.id, valueId, { maxBytes: 3 }), /db_result_(?:changed|corrupt|value_incomplete)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { salesWorkbook } from './fixtures/duckdb-workbook.ts';
import type { DataContextObservation } from '../src/host/project-data-context-types.ts';

const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://localhost' };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const unobserved = (format: DataContextObservation['format']): DataContextObservation => ({ author: 'agent', format, encoding: format === 'xlsx' ? null : 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '', generatedAt: null, nativeEvidence: null, artifactEvidence: null });
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-duckdb-data-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: 'DuckDB synthetic inputs', configuration });
  const options = { dataRoot: projects.dataRoot, projects }, context = new ProjectDataContextStore(options);
  const freeze = async (name: string, bytes: Buffer, baseIndexRevision = 0, datasetId = randomUUID()) => {
    const file = await projects.upload({ projectId: project.id, name, bytes, directory: '020_clean' }), operationId = randomUUID();
    const input = { operationId, datasetId, inputVersionId: operationId, baseIndexRevision, name, sourcePath: file.path, expectedBytes: bytes.length, expectedSha256: hash(bytes) };
    return { input, saved: await context.freezeInput(project.id, input) };
  };
  return { root, projects, project, options, context, freeze };
}

test('DB03: a selected TSV has a v2 exact version, unchanged source and verified analysis copy across reopen', async t => {
  const f = await fixture(t), source = Buffer.from('channel\tsales\r\nstore\t42\r\n');
  const { input, saved } = await f.freeze('sales.tsv', source);
  assert.equal(saved.record.schemaVersion, 2);
  assert.equal((await f.context.getIndex(f.project.id))?.schemaVersion, 2);
  const copy = await f.context.prepareAnalysisCopy(f.project.id, input.datasetId, input.inputVersionId);
  assert.deepEqual((await f.projects.readFile(f.project.id, copy.path)).bytes, source);
  assert.deepEqual((await f.projects.readFile(f.project.id, input.sourcePath)).bytes, source);
  const reopened = new ProjectDataContextStore(f.options);
  assert.deepEqual((await reopened.readInputEvidence(f.project.id, input.datasetId, input.inputVersionId)).bytes, source);
  assert.equal((await reopened.freezeInput(f.project.id, input)).replayed, true);
  assert.equal((await reopened.getIndex(f.project.id))?.revision, 1);
});

test('DB03: the inclusive 50 MiB input survives fixed evidence and copy; one extra byte never publishes', async t => {
  const f = await fixture(t), source = Buffer.alloc(50 * 1024 * 1024, 0x61);
  const { input, saved } = await f.freeze('boundary.csv', source);
  assert.equal(saved.record.bytes, 52_428_800);
  const reopened = new ProjectDataContextStore(f.options);
  assert.deepEqual((await reopened.readInputEvidence(f.project.id, input.datasetId, input.inputVersionId)).bytes, source);
  const copy = await reopened.prepareAnalysisCopy(f.project.id, input.datasetId, input.inputVersionId);
  assert.equal((await f.projects.observeFile(f.project.id, copy.path)).sha256, hash(source));
  const tooLarge = randomUUID();
  await assert.rejects(reopened.freezeInput(f.project.id, { ...input, operationId: tooLarge, inputVersionId: tooLarge, baseIndexRevision: 1, expectedBytes: 52_428_801 }), /invalid_data_context_input|data_context_file_too_large/);
  assert.equal((await reopened.getIndex(f.project.id))?.revision, 1);
  assert.equal((await f.projects.observeFile(f.project.id, input.sourcePath)).sha256, hash(source));
  await assert.rejects(f.projects.captureFeedbackFile(f.project.id, input.sourcePath), /upload_too_large/);
});

test('DB03: an XLSX is retained as its exact binary workbook, not decoded or replaced by a derived CSV', async t => {
  const f = await fixture(t), source = salesWorkbook;
  const { input, saved } = await f.freeze('销售.xlsx', source);
  assert.equal(saved.record.schemaVersion, 2);
  assert.equal(saved.record.sha256, hash(source));
  assert.ok(saved.record.evidencePath.endsWith('/source.xlsx'));
  const copy = await f.context.prepareAnalysisCopy(f.project.id, input.datasetId, input.inputVersionId);
  assert.ok(copy.path.endsWith('/input.xlsx'));
  assert.deepEqual((await f.projects.readFile(f.project.id, copy.path)).bytes, source);
  await fs.writeFile(path.join(f.project.rootPath, input.sourcePath), Buffer.from('a newer working file'));
  const reopened = new ProjectDataContextStore(f.options);
  assert.deepEqual((await reopened.readInputEvidence(f.project.id, input.datasetId, input.inputVersionId)).bytes, source);
  assert.deepEqual((await f.projects.readFile(f.project.id, input.sourcePath)).bytes, Buffer.from('a newer working file'));
});

test('DB03: a TSV observation uses a tabular column position and remains an unconfirmed declaration', async t => {
  const f = await fixture(t), { input } = await f.freeze('sales.tsv', Buffer.from('sales\n42\n')), operationId = randomUUID();
  const observed: DataContextObservation = { ...unobserved('tsv'), coverage: 'complete', scannedRows: 1, totalRows: 1, recordRule: 'one sale record, excluding the header', fields: [{ location: { kind: 'tsv-column', columnIndex: 0 }, originalName: 'sales', observedType: 'integer' }] };
  const saved = await f.context.saveDescription(f.project.id, { ...input, operationId, descriptionRevisionId: operationId, baseIndexRevision: 1, observation: observed, statements: [], mappings: [] });
  assert.equal(saved.record.schemaVersion, 2);
  assert.deepEqual(saved.record.observation.fields[0]?.location, { kind: 'tsv-column', columnIndex: 0 });
  assert.equal(saved.record.observation.author, 'agent');
  assert.equal(saved.record.statements.length, 0);
});

test('DB03: XLSX positions keep the exact sheet and bounded A1 rectangle; malformed or wrong-format locations fail', async t => {
  const f = await fixture(t), { input } = await f.freeze('销售.xlsx', salesWorkbook), operationId = randomUUID();
  const observed: DataContextObservation = { ...unobserved('xlsx'), coverage: 'complete', scannedRows: 1, totalRows: 1, recordRule: 'one sale record in 销售!A2:B2, header A1:B1', fields: [{ location: { kind: 'xlsx-range', sheetName: '销售', range: 'B1:B2' }, originalName: 'sales', observedType: 'number' }] };
  const request = { ...input, operationId, descriptionRevisionId: operationId, baseIndexRevision: 1, observation: observed, statements: [], mappings: [] };
  const saved = await f.context.saveDescription(f.project.id, request);
  assert.deepEqual(saved.record.observation.fields[0]?.location, { kind: 'xlsx-range', sheetName: '销售', range: 'B1:B2' });
  assert.equal((await f.context.readDescription(f.project.id, input.datasetId, operationId)).observation.encoding, null);
  for (const range of ['XFE1', 'A1048577', 'B2:A1', 'a1', '$A$1', 'A:A', '销售!A1', 'A1,B2']) {
    const next = randomUUID();
    await assert.rejects(f.context.saveDescription(f.project.id, { ...request, operationId: next, descriptionRevisionId: next, baseIndexRevision: 2, observation: { ...observed, fields: [{ ...observed.fields[0]!, location: { kind: 'xlsx-range', sheetName: '销售', range } }] } }), /invalid_data_context_/);
  }
  const next = randomUUID();
  await assert.rejects(f.context.saveDescription(f.project.id, { ...request, operationId: next, descriptionRevisionId: next, baseIndexRevision: 2, observation: { ...observed, fields: [{ ...observed.fields[0]!, location: { kind: 'csv-column', columnIndex: 0 } }] } }), /data_context_field_version_mismatch|invalid_data_context_observation/);
  assert.equal((await f.context.getIndex(f.project.id))?.revision, 2);
});

test('DB03/04: Markdown keeps BOM, CRLF and UTF16 source spans, rejecting out-of-bounds and split surrogate references', async t => {
  const f = await fixture(t), original = '\ufeff# 口径\r\n净额😀 = 销售 - 退货\r\n', source = Buffer.from(original), { input } = await f.freeze('口径.md', source), operationId = randomUUID();
  const start = original.indexOf('净额'), end = original.indexOf('\r\n', start), location = { kind: 'text-range' as const, start, end };
  const request = { ...input, operationId, descriptionRevisionId: operationId, baseIndexRevision: 1, observation: unobserved('markdown'), statements: [{ statementId: randomUUID(), scope: 'source-and-limitations' as const, location, text: 'Agent declares this passage explains net sales', unit: null, provenance: 'agent-inference' as const, confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [] };
  const saved = await f.context.saveDescription(f.project.id, request);
  assert.deepEqual(saved.record.statements[0]?.location, location);
  assert.equal(saved.record.observation.coverage, 'unobserved');
  assert.equal(saved.record.observation.totalRows, null);
  assert.equal(saved.record.statements[0]?.confirmed, false);
  assert.equal(original.slice(start, end), '净额😀 = 销售 - 退货');
  const reopened = new ProjectDataContextStore(f.options);
  assert.deepEqual((await reopened.readInputEvidence(f.project.id, input.datasetId, input.inputVersionId)).bytes, source);
  for (const invalid of [{ start: 0, end: original.length + 1 }, { start: original.indexOf('😀') + 1, end }, { start, end: original.indexOf('😀') + 1 }]) {
    const next = randomUUID();
    await assert.rejects(reopened.saveDescription(f.project.id, { ...request, operationId: next, descriptionRevisionId: next, baseIndexRevision: 2, statements: [{ ...request.statements[0]!, location: { kind: 'text-range', ...invalid } }] }), /invalid_data_context_text_range/);
  }
  assert.equal((await f.context.getIndex(f.project.id))?.revision, 2);
});

test('DB03/04: 100 MiB of exact text report and attachments survives reopen; excess or XLSX output never publishes', async t => {
  const f = await fixture(t), { input } = await f.freeze('销售.xlsx', salesWorkbook);
  const report = Buffer.alloc(50 * 1024 * 1024, 0x20), result = Buffer.alloc(50 * 1024 * 1024, 0x61);
  const reportPath = '060_reports/large-report.md', resultPath = '020_clean/result.tsv';
  await fs.writeFile(path.join(f.project.rootPath, reportPath), report); await fs.writeFile(path.join(f.project.rootPath, resultPath), result);
  const operationId = randomUUID();
  const request = { operationId, citationId: operationId, baseIndexRevision: 1, report: { path: reportPath, sha256: hash(report), bytes: report.length }, attachments: [{ path: resultPath, sha256: hash(result), bytes: result.length }], selections: [{ datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: null }], conceptRefs: [], sapRefs: [], declarer: 'agent' as const, declaration: 'Agent declares these selected synthetic calculation materials; not a correctness claim.' };
  const saved = await f.context.createCitation(f.project.id, request);
  assert.equal(saved.record.schemaVersion, 2); assert.equal(saved.record.sourcesDeclared, true);
  await fs.writeFile(path.join(f.project.rootPath, reportPath), '# Later working draft\n');
  const reopened = new ProjectDataContextStore(f.options);
  assert.deepEqual((await reopened.readCitationEvidence(f.project.id, operationId)).bytes, report);
  assert.deepEqual((await reopened.readCitationEvidence(f.project.id, operationId, 0)).bytes, result);
  assert.equal((await reopened.createCitation(f.project.id, request)).replayed, true);
  const extra = randomUUID();
  await assert.rejects(reopened.createCitation(f.project.id, { ...request, operationId: extra, citationId: extra, baseIndexRevision: 2, attachments: [...request.attachments, { path: '020_clean/extra.txt', bytes: 1, sha256: '0'.repeat(64) }] }), /invalid_data_context_citation/);
  await assert.rejects(reopened.createCitation(f.project.id, { ...request, operationId: extra, citationId: extra, baseIndexRevision: 2, report: { ...request.report, bytes: 52_428_801 } }), /data_context_file_too_large/);
  await assert.rejects(reopened.createCitation(f.project.id, { ...request, operationId: extra, citationId: extra, baseIndexRevision: 2, attachments: [{ path: input.sourcePath, bytes: salesWorkbook.length, sha256: hash(salesWorkbook) }] }), /unsupported_data_context_format/);
  assert.equal((await reopened.getIndex(f.project.id))?.revision, 2);
  assert.deepEqual((await reopened.readInputEvidence(f.project.id, input.datasetId, input.inputVersionId)).bytes, salesWorkbook);
});

test('DB03 compatibility: v1 GET and replay preserve all old bytes; only a new v2 operation upgrades the index', async t => {
  const f = await fixture(t), bytes = Buffer.from('sales\n42\n'), file = await f.projects.upload({ projectId: f.project.id, directory: '020_clean', name: 'legacy.csv', bytes });
  const datasetId = randomUUID(), inputVersionId = randomUUID(), savedAt = '2026-11-01T00:00:00.000Z', evidencePath = `datasets/${datasetId}/versions/${inputVersionId}/source.csv`;
  // Independent golden v1 layout, with the old canonical field order and request fingerprint.
  const normalized = { baseIndexRevision: 0, datasetId, expectedBytes: bytes.length, expectedSha256: hash(bytes), inputVersionId, name: 'legacy', operationId: inputVersionId, sourceNote: null, sourcePath: file.path, uploadId: null };
  const record = { baseIndexRevision: 0, bytes: bytes.length, datasetId, evidencePath, inputVersionId, operationId: inputVersionId, operationKind: 'freeze-input', projectId: f.project.id, requestFingerprint: hash(Buffer.from(JSON.stringify(normalized))), resultRef: { datasetId, inputVersionId, projectId: f.project.id }, savedAt, schemaVersion: 1, sha256: hash(bytes), sourceNote: null, sourcePath: file.path, uploadId: null };
  const recordBytes = Buffer.from(JSON.stringify(record) + '\n'), root = path.join(f.options.dataRoot, 'projects', f.project.id, 'data-context'), recordPath = path.join(root, `datasets/${datasetId}/versions/${inputVersionId}/record.json`);
  const index = { citations: [], datasets: [{ createdAt: savedAt, datasetId, descriptions: [], latestDescriptionByInputVersion: {}, name: 'legacy', sourcePath: file.path, uploadId: null, versions: [{ inputVersionId, recordSha256: hash(recordBytes) }] }], projectId: f.project.id, revision: 1, schemaVersion: 1 };
  const indexBytes = Buffer.from(JSON.stringify(index) + '\n');
  await fs.mkdir(path.dirname(recordPath), { recursive: true }); await fs.writeFile(recordPath, recordBytes); await fs.writeFile(path.join(root, evidencePath), bytes); await fs.writeFile(path.join(root, 'index.json'), indexBytes);
  assert.equal((await f.context.getIndex(f.project.id))?.schemaVersion, 1);
  assert.equal((await f.context.readVersion(f.project.id, datasetId, inputVersionId)).schemaVersion, 1);
  assert.deepEqual((await f.context.readInputEvidence(f.project.id, datasetId, inputVersionId)).bytes, bytes);
  const originalRequest = { ...normalized, operationId: inputVersionId };
  assert.equal((await f.context.freezeInput(f.project.id, originalRequest)).replayed, true);
  assert.deepEqual(await fs.readFile(path.join(root, 'index.json')), indexBytes);
  await f.freeze('new.tsv', Buffer.from('sales\n99\n'), 1);
  const reopened = new ProjectDataContextStore(f.options);
  assert.equal((await reopened.getIndex(f.project.id))?.schemaVersion, 2);
  assert.deepEqual(await fs.readFile(recordPath), recordBytes);
  assert.deepEqual(await fs.readFile(path.join(root, evidencePath)), bytes);
  assert.equal((await reopened.freezeInput(f.project.id, originalRequest)).replayed, true);
  assert.equal((await reopened.getIndex(f.project.id))?.revision, 2);
});

test('DB03 evidence retains the original 19-attachment bound and refuses partial publication of a twentieth', async t => {
  const f = await fixture(t), report = Buffer.from('# Synthetic\n'), reportPath = '060_reports/count.md';
  await fs.writeFile(path.join(f.project.rootPath, reportPath), report);
  const attachments = Array.from({ length: 20 }, (_, i) => ({ path: `020_clean/part-${i}.txt`, bytes: 1, sha256: hash(Buffer.from('x')) }));
  const operationId = randomUUID(), request = { operationId, citationId: operationId, baseIndexRevision: 0, report: { path: reportPath, bytes: report.length, sha256: hash(report) }, attachments, selections: [], conceptRefs: [], sapRefs: [], declarer: 'user' as const, declaration: 'Synthetic selected attachments' };
  await assert.rejects(f.context.createCitation(f.project.id, request), /invalid_data_context_list/);
  assert.equal(await f.context.getIndex(f.project.id), null);
  for (const file of attachments.slice(0, 19)) await fs.writeFile(path.join(f.project.rootPath, file.path), 'x');
  assert.equal((await f.context.createCitation(f.project.id, { ...request, attachments: attachments.slice(0, 19) })).record.attachments.length, 19);
});

test('DB03 rollback: compatible legacy writes keep v2 inputs readable while refusing new extended input writes', async t => {
  const f = await fixture(t), source = Buffer.from('\ufeff# Existing new-format work\r\n'), { input } = await f.freeze('new-format.md', source);
  const legacyOptions = { ...f.options, writeVersion: 1 as const }, compatible = new ProjectDataContextStore(legacyOptions);
  assert.deepEqual((await compatible.readInputEvidence(f.project.id, input.datasetId, input.inputVersionId)).bytes, source);
  const other = randomUUID();
  await assert.rejects(compatible.freezeInput(f.project.id, { ...input, operationId: other, inputVersionId: other, baseIndexRevision: 1 }), /unsupported_data_context_format|data_context_extended_writes_disabled/);
  assert.equal((await compatible.getIndex(f.project.id))?.revision, 1);
  const csv = Buffer.from('sales\n42\n'), file = await f.projects.upload({ projectId: f.project.id, name: 'continued.csv', bytes: csv, directory: '020_clean' }), id = randomUUID();
  const saved = await compatible.freezeInput(f.project.id, { ...input, name: 'Continued legacy work', datasetId: randomUUID(), operationId: id, inputVersionId: id, sourcePath: file.path, expectedSha256: hash(csv), expectedBytes: csv.length, baseIndexRevision: 1 });
  assert.equal(saved.record.schemaVersion, 1);
  assert.equal((await compatible.getIndex(f.project.id))?.schemaVersion, 2);
  assert.deepEqual((await compatible.readInputEvidence(f.project.id, input.datasetId, input.inputVersionId)).bytes, source);
});

test('DB03 Markdown with no table observation cannot publish a fabricated record-count rule', async t => {
  const f = await fixture(t), { input } = await f.freeze('document.md', Buffer.from('# A document, not a table\n')), id = randomUUID();
  const request = { ...input, operationId: id, descriptionRevisionId: id, baseIndexRevision: 1, observation: { ...unobserved('markdown'), recordRule: 'one physical line means one data record' }, statements: [], mappings: [] };
  await assert.rejects(f.context.saveDescription(f.project.id, request), /invalid_data_context_observation/);
  assert.equal((await f.context.getIndex(f.project.id))?.revision, 1, 'invalid metadata must never publish');
  const validId = randomUUID();
  const saved = await f.context.saveDescription(f.project.id, { ...request, operationId: validId, descriptionRevisionId: validId, observation: unobserved('markdown') });
  assert.equal(saved.record.observation.recordRule, null);
  assert.equal((await new ProjectDataContextStore(f.options).readDescription(f.project.id, input.datasetId, validId)).observation.recordRule, null);
});

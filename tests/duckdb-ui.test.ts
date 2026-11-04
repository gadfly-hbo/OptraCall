import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import type { CreateDataCitation, FreezeProjectInput, SaveDataDescription } from '../src/host/project-data-context-types.ts';
import { parseObservationImport, projectDataProvisionEntries, readProjectDataEvidence, readProjectDataEvidenceBytes, readProjectDataWriteStatus, saveProjectDataDescription, ProjectDataContextRequestError, type PendingDataContextWrite } from '../src/host/ui/project-data-context-client.ts';

const observed = {
  author: 'agent', format: 'xlsx', encoding: null,
  recordRule: '销售 明细 A2:D20 中一行是一笔销售，表头不计入记录。',
  coverage: 'partial', scannedRows: 19, totalRows: null,
  fields: [{ location: { kind: 'xlsx-range', sheetName: '销售 明细', range: 'B1' }, originalName: '金额', observedType: 'number' }],
  limitations: '只观察所声明范围；公式缓存新鲜度未知，没有重算原件。',
  generatedAt: null, nativeEvidence: null, artifactEvidence: null,
};

test('DB03 UI observation import preserves an exact XLSX sheet/range and unknown formula evidence', () => {
  assert.deepEqual(parseObservationImport(JSON.stringify(observed)), observed);
  for (const range of ['A0', 'XFE1', 'A1048577', 'B2:A1', 'A:A', 'Sheet!A1', '=A1', '[other.xlsx]A1', 'A1,B2']) {
    assert.throws(() => parseObservationImport(JSON.stringify({ ...observed, fields: [{ ...observed.fields[0], location: { kind: 'xlsx-range', sheetName: '销售 明细', range } }] })));
  }
  assert.equal(observed.fields[0]!.location.sheetName, '销售 明细');
});

test('DB03 UI imports TSV columns and distinguishes a Markdown document from an observed table span', () => {
  const tsv = { ...observed, format: 'tsv', encoding: 'UTF-8', fields: [{ location: { kind: 'tsv-column', columnIndex: 1 }, originalName: '金额', observedType: 'number' }] };
  assert.deepEqual(parseObservationImport(JSON.stringify(tsv)), tsv);
  const document = { ...observed, format: 'markdown', encoding: 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [] };
  assert.deepEqual(parseObservationImport(JSON.stringify(document)), document);
  const table = { ...document, coverage: 'partial', scannedRows: 1, recordRule: 'UTF-16 [9, 35) 中的表格，每行是一条渠道记录；不含表头。', fields: [{ location: { kind: 'text-range', start: 9, end: 15 }, originalName: '渠道', observedType: 'text' }] };
  assert.deepEqual(parseObservationImport(JSON.stringify(table)), table);
  for (const invalid of [
    { ...document, recordRule: '把文档行数当记录数' },
    { ...table, encoding: null },
    { ...tsv, fields: observed.fields },
    { ...table, fields: [{ ...table.fields[0], location: { kind: 'text-range', start: 15, end: 9 } }] },
  ]) assert.throws(() => parseObservationImport(JSON.stringify(invalid)));
});

test('DB04 UI fixed Markdown read preserves BOM, CRLF and emoji UTF-16 coordinates using GET only', async t => {
  const original = '\uFEFF标题\r\n甲😀乙\r\n', calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    return new Response(new TextEncoder().encode(original));
  });
  const actual = await readProjectDataEvidence('project/a', 'dataset/a', 'old/version');
  assert.equal(actual, original);
  assert.equal(actual.slice(6, 8), '😀');
  assert.deepEqual(calls, [{ url: '/api/projects/project%2Fa/data-context/datasets/dataset%2Fa/versions/old%2Fversion/evidence', method: 'GET' }]);
});

test('DB04 UI XLSX bytes use the exact fixed version and reject a changed body without retry', async t => {
  const original = Uint8Array.of(80, 75, 3, 4, 255, 0, 1), expected = { bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') };
  const calls: { url: string; method: string }[] = []; let body = original;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push({ url: String(url), method: init.method ?? 'GET' }); return new Response(body); });
  assert.deepEqual(await readProjectDataEvidenceBytes('p', 'd', 'old', expected), original);
  body = Uint8Array.of(80, 75, 3, 4, 255, 0, 2);
  await assert.rejects(readProjectDataEvidenceBytes('p', 'd', 'old', expected), (error: unknown) => error instanceof ProjectDataContextRequestError && error.code === 'evidence_version_changed');
  assert.deepEqual(calls, [{ url: '/api/projects/p/data-context/datasets/d/versions/old/evidence', method: 'GET' }, { url: '/api/projects/p/data-context/datasets/d/versions/old/evidence', method: 'GET' }]);
});

test('DB05 UI lost description ACK reads the original operation and revision using GET only', async t => {
  const f = await storeAckFixture(t), operation = f.pending.description, record = f.records.description;
  let available = true; const calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    const summary = await f.store.summary(f.project.id);
    if (!available) summary.datasets[0]!.descriptions = [];
    return new Response(JSON.stringify(String(url).endsWith(`/${record.descriptionRevisionId}`) ? { record } : summary));
  });
  const before = structuredClone(operation), result = await readProjectDataWriteStatus(f.project.id, operation);
  assert.equal(result.saved?.kind, 'description'); assert.equal(result.saved?.record.operationId, operation.input.operationId);
  assert.deepEqual(calls, [{ url: `/api/projects/${f.project.id}/data-context`, method: 'GET' }, { url: `/api/projects/${f.project.id}/data-context/datasets/${record.datasetId}/descriptions/${record.descriptionRevisionId}`, method: 'GET' }]);
  available = false; calls.length = 0;
  assert.equal((await readProjectDataWriteStatus(f.project.id, operation)).saved, null);
  assert.deepEqual(calls, [{ url: `/api/projects/${f.project.id}/data-context`, method: 'GET' }]); assert.deepEqual(operation, before);
});

test('DB03 UI native receipts keep format and coordinate mismatches UNKNOWN without replacing old records', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, at = '2026-11-04T00:00:00.000Z';
  const selection = { datasetId: id(2), inputVersionId: id(3), descriptionRevisionId: id(4) };
  const version = { projectId: id(1), datasetId: id(2), inputVersionId: id(3), sourcePath: '020_clean/book.xlsx', sha256: 'a'.repeat(64), bytes: 7, savedAt: at };
  const description = { projectId: id(1), ...selection, observation: observed, statements: [], mappings: [] };
  const receipt = { selection, version, analysisCopy: { path: '020_clean/copy/book.xlsx', sha256: version.sha256, bytes: 7, preparedAt: at }, description, providedAt: at };
  const mismatch = { ...receipt, version: { ...version, sourcePath: '020_clean/another.csv' } };
  const before = JSON.stringify([receipt, mismatch]);
  assert.deepEqual(projectDataProvisionEntries([receipt, mismatch], id(1)).map(value => value.kind), ['available', 'unknown']);
  assert.equal(JSON.stringify([receipt, mismatch]), before);
});

async function storeAckFixture(t: test.TestContext) {
  const folder = path.resolve('.local/fourbase-modules/m7-duckdb/implementation/ui/ack-store-regression'); await fs.mkdir(folder, { recursive: true });
  const root = await fs.mkdtemp(path.join(folder, 'case-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => projects.close());
  const project = await projects.create({ name: 'Synthetic UI ACK fingerprint', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const store = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const bytes = Buffer.from('amount\n42\n'), hash = createHash('sha256').update(bytes).digest('hex');
  const file = await projects.upload({ projectId: project.id, name: 'input.csv', bytes, directory: '020_clean' });
  const inputId = randomUUID(), input: FreezeProjectInput = { operationId: inputId, inputVersionId: inputId, datasetId: randomUUID(), baseIndexRevision: 0, name: '  Exact input  ', sourcePath: file.path, expectedBytes: bytes.length, expectedSha256: hash };
  const inputRecord = (await store.freezeInput(project.id, input)).record;
  const descriptionId = randomUUID(), description: SaveDataDescription = { operationId: descriptionId, descriptionRevisionId: descriptionId, datasetId: input.datasetId, inputVersionId: inputId, baseIndexRevision: 1, observation: { author: 'unknown', format: 'csv', encoding: 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '', generatedAt: null, nativeEvidence: null, artifactEvidence: null }, statements: [{ statementId: randomUUID(), scope: 'row-meaning', location: null, text: 'Original immutable statement', unit: null, provenance: 'user-statement', confirmed: true, confirmedAt: '2026-01-01T00:00:00.000Z', confirmedBy: 'not-authoritative' }], mappings: [] };
  const descriptionRecord = (await store.saveDescription(project.id, description)).record;
  const report = Buffer.from('# Exact report\n'), reportPath = '060_reports/report.md'; await fs.writeFile(path.join(project.rootPath, reportPath), report);
  const citationId = randomUUID(), citation: CreateDataCitation = { operationId: citationId, citationId, baseIndexRevision: 2, report: { path: reportPath, bytes: report.length, sha256: createHash('sha256').update(report).digest('hex') }, attachments: [], selections: [{ datasetId: input.datasetId, inputVersionId: inputId, descriptionRevisionId: descriptionId }], conceptRefs: [], sapRefs: [], declarer: 'user', declaration: 'Original declaration' };
  const citationRecord = (await store.createCitation(project.id, citation)).record;
  const pending = { input: { kind: 'input', input }, description: { kind: 'description', input: description }, citation: { kind: 'citation', input: citation } } satisfies Record<string, PendingDataContextWrite>;
  const records = { input: inputRecord, description: descriptionRecord, citation: citationRecord };
  return { project, store, pending, records };
}

for (const kind of ['input', 'description', 'citation'] as const) {
  test(`DB05 UI ${kind}: exact Store-produced normalized payload is recognized with GET only`, async t => {
    const f = await storeAckFixture(t), calls: string[] = [], record = f.records[kind];
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls.push(init.method ?? 'GET'); return new Response(JSON.stringify(String(_url).endsWith('/data-context') ? await f.store.summary(f.project.id) : { record })); });
    const result = await readProjectDataWriteStatus(f.project.id, f.pending[kind]);
    assert.equal(result.saved?.record.requestFingerprint, record.requestFingerprint);
    assert.ok(calls.length > 0 && calls.every(method => method === 'GET'));
  });
  for (const mismatch of ['fingerprint', 'payload'] as const) test(`DB05 UI ${kind}: ${mismatch} mismatch stays UNKNOWN with the original request intact`, async t => {
    const f = await storeAckFixture(t), original = f.records[kind], altered = structuredClone(original), pending = f.pending[kind], before = structuredClone(pending), calls: string[] = [];
    if (mismatch === 'fingerprint') altered.requestFingerprint = 'f'.repeat(64);
    else if ('sourceNote' in altered) altered.sourceNote = 'DIFFERENT INPUT PAYLOAD';
    else if ('observation' in altered) altered.observation.limitations = 'DIFFERENT DESCRIPTION PAYLOAD';
    else altered.declaration = 'DIFFERENT CITATION PAYLOAD';
    const summary = await f.store.summary(f.project.id);
    if (kind === 'input') summary.datasets[0]!.versions = [altered as typeof f.records.input];
    else if (kind === 'description') summary.datasets[0]!.descriptions = [altered as typeof f.records.description];
    else summary.citations = [altered as typeof f.records.citation];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push(init.method ?? 'GET'); return new Response(JSON.stringify(String(url).endsWith('/data-context') ? summary : { record: altered })); });
    assert.equal((await readProjectDataWriteStatus(f.project.id, pending)).saved, null);
    assert.deepEqual(pending, before);
    assert.ok(calls.length > 0 && calls.every(method => method === 'GET'));
  });
}

// Literal fingerprints were captured from the preserved pre-F2 schema1 normalized
// expressions and canonical implementation; this is an old-byte compatibility seam.
const legacyInput: FreezeProjectInput = {
  "operationId": "00000000-0000-4000-8000-000000000001",
  "inputVersionId": "00000000-0000-4000-8000-000000000001",
  "datasetId": "00000000-0000-4000-8000-000000000002",
  "baseIndexRevision": 0,
  "name": "  固定原文  ",
  "sourcePath": "020_clean/legacy.csv",
  "expectedBytes": 10,
  "expectedSha256": "e46ca7d7d22752359c5276d842675c6497b6d7f35aee22bebf2732c846db7f07",
  "sourceNote": "﻿旧原文😀\r\n"
};
const legacyDescription: SaveDataDescription = {
  "operationId": "00000000-0000-4000-8000-000000000003",
  "descriptionRevisionId": "00000000-0000-4000-8000-000000000003",
  "datasetId": "00000000-0000-4000-8000-000000000002",
  "inputVersionId": "00000000-0000-4000-8000-000000000001",
  "baseIndexRevision": 1,
  "observation": {
    "author": "unknown",
    "format": "csv",
    "encoding": "UTF-8",
    "recordRule": null,
    "coverage": "unobserved",
    "scannedRows": null,
    "totalRows": null,
    "fields": [],
    "limitations": "旧限制😀\r\n",
    "generatedAt": null,
    "nativeEvidence": null,
    "artifactEvidence": null
  },
  "statements": [
    {
      "statementId": "00000000-0000-4000-8000-000000000004",
      "scope": "row-meaning",
      "location": null,
      "text": "旧陈述",
      "unit": null,
      "provenance": "user-statement",
      "confirmed": true,
      "confirmedAt": "2020-01-01T00:00:00Z",
      "confirmedBy": "not-authoritative"
    }
  ],
  "mappings": []
};
const legacyCitation: CreateDataCitation = {
  "operationId": "00000000-0000-4000-8000-000000000005",
  "citationId": "00000000-0000-4000-8000-000000000005",
  "baseIndexRevision": 2,
  "report": {
    "path": "060_reports/legacy.md",
    "bytes": 16,
    "sha256": "c884bf27008e48059b8e3c4cc36e13d3a224d586aeb28a134c7ef1ca7c760a5f"
  },
  "attachments": [
    {
      "path": "020_clean/legacy.sql",
      "bytes": 10,
      "sha256": "e39b29dbd9db5d7861e397796a4941747da6f4126cba177fd5448252ae27257e"
    }
  ],
  "selections": [
    {
      "datasetId": "00000000-0000-4000-8000-000000000002",
      "inputVersionId": "00000000-0000-4000-8000-000000000001",
      "descriptionRevisionId": "00000000-0000-4000-8000-000000000003"
    }
  ],
  "conceptRefs": [],
  "sapRefs": [],
  "declarer": "user",
  "declaration": "旧声明\r\n😀"
};

test('DB03/05 legacy v1 operation fingerprints keep the pre-refactor canonical bytes and remain readable by UI', async t => {
  const folder = path.resolve('.local/fourbase-modules/m7-duckdb/implementation/ui/ack-store-regression'); await fs.mkdir(folder, { recursive: true });
  const root = await fs.mkdtemp(path.join(folder, 'legacy-')), projects = new ProjectStore({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') }); await projects.init(); t.after(async () => projects.close());
  const project = await projects.create({ name: 'Legacy exact fingerprint', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } }), store = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects, writeVersion: 1 });
  await projects.upload({ projectId: project.id, name: 'legacy.csv', directory: '020_clean', bytes: Buffer.from('amount\n42\n') });
  const input = (await store.freezeInput(project.id, legacyInput)).record;
  const description = (await store.saveDescription(project.id, legacyDescription)).record;
  await fs.writeFile(path.join(project.rootPath, '060_reports/legacy.md'), '# legacy report\n'); await fs.writeFile(path.join(project.rootPath, '020_clean/legacy.sql'), 'SELECT ?;\n');
  const citation = (await store.createCitation(project.id, legacyCitation)).record;
  assert.equal(input.requestFingerprint, 'a313054d242889c2f7730afd20d4f1558b1c3a26a64ffd10d7d7c6b97a926c78');
  assert.equal(description.requestFingerprint, 'f5c42ddf2c7664962ef3697ffd8b90f151e96c396bcc7cdd3e77487db56e9e12');
  assert.equal(citation.requestFingerprint, 'c5acaf65b70973049f8be3cb5cd1348b1cb9cc59477d47b60a4c4a496158b66a');
  const records = { input, description, citation }, requests = { input: legacyInput, description: legacyDescription, citation: legacyCitation };
  for (const kind of ['input', 'description', 'citation'] as const) {
    const record = records[kind]; assert.equal(record.schemaVersion, 1);
    const calls: string[] = []; const stub = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push(init.method ?? 'GET'); return new Response(JSON.stringify(String(url).endsWith('/data-context') ? await store.summary(project.id) : { record })); });
    const pending = { kind, input: requests[kind] } as PendingDataContextWrite;
    assert.equal((await readProjectDataWriteStatus(project.id, pending)).saved?.record.requestFingerprint, record.requestFingerprint);
    assert.ok(calls.every(method => method === 'GET')); stub.mock.restore();
  }
});

test('DB05 UI confirmed-description ACK uses the same wire default and Host confirmation normalization', async t => {
  const f = await storeAckFixture(t), id = randomUUID();
  const input: SaveDataDescription = { ...f.pending.description.input, operationId: id, descriptionRevisionId: id, baseIndexRevision: 3, baseDescriptionRevisionId: f.records.description.descriptionRevisionId, statements: f.records.description.statements, confirmStatementIds: [f.records.description.statements[0]!.statementId], confirmedBy: '  ' };
  const before = structuredClone(input), methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    methods.push(init.method ?? 'GET');
    if (init.method === 'POST') return new Response(JSON.stringify(await f.store.saveDescription(f.project.id, JSON.parse(String(init.body)))), { status: 201 });
    return new Response(JSON.stringify(String(url).endsWith('/data-context') ? await f.store.summary(f.project.id) : { record: await f.store.readDescription(f.project.id, input.datasetId, id) }));
  });
  await saveProjectDataDescription(f.project.id, input); methods.length = 0;
  const found = await readProjectDataWriteStatus(f.project.id, { kind: 'description', input });
  assert.equal(found.saved?.kind, 'description');
  if (found.saved?.kind !== 'description') throw new Error('Exact confirmation receipt was not found.');
  assert.equal(found.saved.record.statements[0]?.confirmed, true); assert.equal(found.saved.record.statements[0]?.confirmedBy, 'user');
  assert.deepEqual(methods, ['GET', 'GET']); assert.deepEqual(input, before);
});

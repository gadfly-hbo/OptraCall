import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { salesWorkbook } from './fixtures/duckdb-workbook.ts';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('DB03/04/05 real Host: binary and raw-text fixed inputs, exact locations, lost-ACK readback and historical calculation files survive restart', { timeout: 45_000 }, async t => {
  let host = await startTestHost();
  t.after(async () => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'DuckDB HTTP synthetic only', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1', model: 'synthetic-no-model-call', apiKey: 'synthetic-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'DuckDB exact HTTP evidence' }), 201);
  const base = `/api/projects/${project.id}/data-context`;
  let revision = 0;
  const freeze = async (name: string, bytes: Buffer) => {
    const { file } = await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name, directory: '020_clean', content: bytes.toString('base64') }), 201);
    const id = randomUUID(), input = { operationId: id, inputVersionId: id, datasetId: randomUUID(), baseIndexRevision: revision, name, sourcePath: file.path, expectedSha256: sha(bytes), expectedBytes: bytes.length };
    const saved = await readJson(await host.request(`${base}/inputs`, 'POST', input), 201); revision++;
    assert.equal(saved.record.schemaVersion, 2);
    // A response may have been lost: GET is sufficient to identify the committed original operation.
    const route = `${base}/datasets/${input.datasetId}/versions/${id}`;
    const checked = await readJson(await host.request(route));
    assert.equal(checked.record.operationId, id); assert.equal(checked.record.requestFingerprint, saved.record.requestFingerprint);
    assert.deepEqual(Buffer.from(await (await host.request(`${route}/evidence`)).arrayBuffer()), bytes);
    assert.equal((await readJson(await host.request(base))).index.revision, revision, 'readback never creates a second operation');
    const { copy } = await readJson(await host.request(`${base}/prepare`, 'POST', { datasetId: input.datasetId, inputVersionId: id }));
    assert.equal(copy.sha256, sha(bytes));
    return { input, route };
  };
  const workbook = await freeze('销售.xlsx', salesWorkbook);
  const original = '\ufeff# 原文\r\n净额😀 = 销售 - 退款\r\n', text = Buffer.from(original);
  const markdown = await freeze('口径.md', text);
  const location = { kind: 'text-range', start: original.indexOf('净额'), end: original.indexOf('\r\n', original.indexOf('净额')) };
  const operationId = randomUUID();
  const description = { operationId, descriptionRevisionId: operationId, datasetId: markdown.input.datasetId, inputVersionId: markdown.input.inputVersionId, baseIndexRevision: revision,
    observation: { author: 'user', format: 'markdown', encoding: 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '', generatedAt: null, nativeEvidence: null, artifactEvidence: null },
    statements: [{ statementId: randomUUID(), scope: 'source-and-limitations', location, text: 'This exact passage states a definition; not a table scan.', unit: null, provenance: 'user-statement', confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [] };
  const savedDescription = await readJson(await host.request(`${base}/descriptions`, 'POST', description), 201); revision++;
  assert.deepEqual(savedDescription.record.statements[0].location, location);
  const fabricatedId = randomUUID(), fabricated = await host.request(`${base}/descriptions`, 'POST', { ...description, operationId: fabricatedId, descriptionRevisionId: fabricatedId, baseIndexRevision: revision, observation: { ...description.observation, recordRule: 'one document line is a data record' } });
  assert.equal(fabricated.status, 400); assert.equal((await fabricated.json()).code, 'invalid_data_context_observation');
  const invalidId = randomUUID(), rejected = await host.request(`${base}/descriptions`, 'POST', { ...description, operationId: invalidId, descriptionRevisionId: invalidId, baseIndexRevision: revision, statements: [{ ...description.statements[0], location: { kind: 'text-range', start: 0, end: original.length + 1 } }] });
  assert.equal(rejected.status, 400); assert.equal((await rejected.json()).code, 'invalid_data_context_text_range');
  assert.equal((await readJson(await host.request(base))).index.revision, revision);
  const report = Buffer.from('# Original result\n42\n'), sql = Buffer.from('SELECT ? AS total;\n'), parameters = Buffer.from('{"params":[42],"duckdb":"2.0.0"}\n');
  const reportPath = '060_reports/result.md', sqlPath = '020_clean/query.sql', paramsPath = '020_clean/parameters.json';
  for (const [name, bytes] of [[reportPath, report], [sqlPath, sql], [paramsPath, parameters]] as const) await writeFile(path.join(project.rootPath, name), bytes);
  const citationId = randomUUID(), citation = { operationId: citationId, citationId, baseIndexRevision: revision, report: { path: reportPath, bytes: report.length, sha256: sha(report) }, attachments: [{ path: sqlPath, bytes: sql.length, sha256: sha(sql) }, { path: paramsPath, bytes: parameters.length, sha256: sha(parameters) }], selections: [{ datasetId: workbook.input.datasetId, inputVersionId: workbook.input.inputVersionId, descriptionRevisionId: null }, { datasetId: markdown.input.datasetId, inputVersionId: markdown.input.inputVersionId, descriptionRevisionId: operationId }], conceptRefs: [], sapRefs: [], declarer: 'user', declaration: 'Synthetic saved files test; HTTP fixtures did not execute a query.' };
  await readJson(await host.request(`${base}/citations`, 'POST', citation), 201); revision++;
  await writeFile(path.join(project.rootPath, reportPath), '# New working draft\n');
  await writeFile(path.join(project.rootPath, workbook.input.sourcePath), 'Changed working workbook');
  const roots = { dataRoot: host.dataRoot, projectsRoot: host.projectsRoot };
  await host.close(); host = await startTestHost(roots);
  assert.deepEqual(Buffer.from(await (await host.request(`${workbook.route}/evidence`)).arrayBuffer()), salesWorkbook);
  assert.deepEqual(Buffer.from(await (await host.request(`${markdown.route}/evidence`)).arrayBuffer()), text);
  const loaded = await readJson(await host.request(`${base}/citations/${citationId}`));
  assert.deepEqual(loaded.record.selections, citation.selections);
  for (const [suffix, expected] of [['', report], ['?attachmentIndex=0', sql], ['?attachmentIndex=1', parameters]] as const) assert.deepEqual(Buffer.from(await (await host.request(`${base}/citations/${citationId}/evidence${suffix}`)).arrayBuffer()), expected);
  assert.equal((await readJson(await host.request(base))).index.revision, revision);
  assert.equal((await readJson(await host.request(`${base}/citations`, 'POST', citation))).replayed, true);
  assert.equal((await readJson(await host.request(base))).index.revision, revision);
});

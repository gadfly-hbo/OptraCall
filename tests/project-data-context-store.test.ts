import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import type { FreezeProjectInput, SaveDataDescription, DataContextObservation, DataContextMapping } from '../src/host/project-data-context-types.ts';

const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://localhost' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-data-context-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: 'Synthetic data context', configuration });
  const options = { dataRoot: projects.dataRoot, projects }, context = new ProjectDataContextStore(options);
  const source = Buffer.from('a,b\n1,2\n'), uploaded = await projects.upload({ projectId: project.id, name: 'input.csv', bytes: source, directory: '020_clean' });
  const version = randomUUID();
  const input: FreezeProjectInput = { datasetId: randomUUID(), inputVersionId: version, operationId: version, baseIndexRevision: 0, name: '输入', sourcePath: uploaded.path, expectedSha256: createHash('sha256').update(source).digest('hex'), expectedBytes: source.length };
  return { root, projects, project, options, context, source, input };
}

test('M2-D02: explicit freeze preserves selected bytes and same operation across reopen after working source changes', async t => {
  const { context, projects, project, options, input } = await fixture(t);
  assert.equal(await context.getIndex(project.id), null);
  const saved = await context.freezeInput(project.id, input);
  assert.equal(saved.indexRevision, 1); assert.equal(saved.replayed, false);
  await fs.writeFile(path.join(project.rootPath, input.sourcePath), 'a,b\n9,9\n');
  const reopened = new ProjectDataContextStore(options);
  assert.equal((await reopened.readInputEvidence(project.id, input.datasetId, input.inputVersionId)).bytes.toString(), 'a,b\n1,2\n');
  const replayed = await reopened.freezeInput(project.id, input);
  assert.equal(replayed.replayed, true); assert.equal(replayed.record.savedAt, saved.record.savedAt);
  assert.equal((await context.getIndex(project.id))?.datasets[0]?.versions.length, 1);
  assert.equal((await projects.readFile(project.id, input.sourcePath)).bytes.toString(), 'a,b\n9,9\n');
});

const unobserved: DataContextObservation = { author: 'unknown', format: 'csv', encoding: 'UTF-8', recordRule: 'CSV logical records excluding header; empty records excluded', coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '', generatedAt: null, nativeEvidence: null, artifactEvidence: null };
test('M2-D03: observations and business statements remain separate; confirmation is explicit and never inherited by a new revision', async t => {
  const { context, project, input } = await fixture(t); await context.freezeInput(project.id, input);
  const statementId = randomUUID(), revision = randomUUID();
  const description: SaveDataDescription = { operationId: revision, descriptionRevisionId: revision, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: 1, observation: unobserved, statements: [{ statementId, scope: 'row-meaning', location: null, text: 'Each row is a declared sale', unit: null, provenance: 'agent-inference', confirmed: true, confirmedAt: '2026-01-01T00:00:00.000Z', confirmedBy: 'untrusted' }], mappings: [], confirmStatementIds: [statementId], confirmedBy: '用户' };
  const initial = (await context.saveDescription(project.id, { ...description, confirmStatementIds: [] })).record;
  assert.equal(initial.statements[0]?.confirmed, false);
  const confirmedRevision = randomUUID();
  const first = (await context.saveDescription(project.id, { ...description, operationId: confirmedRevision, descriptionRevisionId: confirmedRevision, baseIndexRevision: 2, baseDescriptionRevisionId: revision })).record;
  assert.equal(first.statements[0]?.confirmed, true); assert.equal(first.statements[0]?.confirmedBy, '用户'); assert.notEqual(first.statements[0]?.confirmedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(first.observation.scannedRows, null); assert.equal(first.observation.totalRows, null);
  const nextId = randomUUID();
  const second = (await context.saveDescription(project.id, { ...description, operationId: nextId, descriptionRevisionId: nextId, baseIndexRevision: 3, baseDescriptionRevisionId: confirmedRevision, statements: first.statements, confirmStatementIds: [] })).record;
  assert.equal(second.statements[0]?.confirmed, false); assert.equal(second.statements[0]?.confirmedAt, null); assert.equal(second.statements[0]?.confirmedBy, null);
  assert.equal((await context.readDescription(project.id, input.datasetId, confirmedRevision)).statements[0]?.confirmed, true);
  const invalidId = randomUUID();
  await assert.rejects(context.saveDescription(project.id, { ...description, operationId: invalidId, descriptionRevisionId: invalidId, baseIndexRevision: 4, confirmStatementIds: [], observation: { ...unobserved, coverage: 'complete', scannedRows: 1, totalRows: null } }), /invalid_data_context_observation/);
  assert.equal((await context.getIndex(project.id))?.revision, 4);
});

test('M2-D02/D05: only an explicit verified analysis copy can be selected; a changed copy is preserved and rejected', async t => {
  const { context, project, input } = await fixture(t); await context.freezeInput(project.id, input);
  const selection = { datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: null };
  await assert.rejects(context.resolveSelection(project.id, selection), /data_context_analysis_copy_not_prepared/);
  const copy = await context.prepareAnalysisCopy(project.id, input.datasetId, input.inputVersionId);
  assert.ok(copy.path.startsWith('020_clean/')); assert.equal((await context.resolveSelection(project.id, selection)).version.sha256, input.expectedSha256);
  await fs.writeFile(path.join(project.rootPath, copy.path), 'user changed this copy');
  await assert.rejects(context.prepareAnalysisCopy(project.id, input.datasetId, input.inputVersionId, true), /data_context_analysis_copy_changed/);
  await assert.rejects(context.resolveSelection(project.id, selection), /data_context_analysis_copy_changed/);
  assert.equal(await fs.readFile(path.join(project.rootPath, copy.path), 'utf8'), 'user changed this copy');
  assert.equal((await context.readInputEvidence(project.id, input.datasetId, input.inputVersionId)).bytes.toString(), 'a,b\n1,2\n');
});

test('M2-D06: citation freezes only the explicitly selected report, code and exact inputs across source edits', async t => {
  const { context, project, input, options } = await fixture(t); await context.freezeInput(project.id, input);
  const reportPath = '060_reports/result.md', codePath = '020_clean/calculate.py';
  const report = Buffer.from('# Selected draft\n'), code = Buffer.from('print(3)\n');
  await fs.writeFile(path.join(project.rootPath, reportPath), report); await fs.writeFile(path.join(project.rootPath, codePath), code);
  const citationId = randomUUID(), request = { operationId: citationId, citationId, baseIndexRevision: 1, report: { path: reportPath, sha256: createHash('sha256').update(report).digest('hex'), bytes: report.length }, attachments: [{ path: codePath, sha256: createHash('sha256').update(code).digest('hex'), bytes: code.length }], selections: [{ datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: null }], conceptRefs: [], sapRefs: [], declarer: 'user' as const, declaration: 'I declare this draft used this input and code.' };
  const saved = await context.createCitation(project.id, request);
  assert.equal(saved.record.sourcesDeclared, true); assert.equal(saved.record.attachments.length, 1); assert.equal(saved.record.nativeEvidence, null);
  await fs.writeFile(path.join(project.rootPath, reportPath), '# New draft'); await fs.writeFile(path.join(project.rootPath, codePath), 'print(99)');
  const reopened = new ProjectDataContextStore(options);
  assert.equal((await reopened.readCitationEvidence(project.id, citationId)).bytes.toString(), '# Selected draft\n');
  assert.equal((await reopened.readCitationEvidence(project.id, citationId, 0)).bytes.toString(), 'print(3)\n');
  assert.equal((await reopened.createCitation(project.id, request)).record.savedAt, saved.record.savedAt);
  const altered = { ...request, declaration: 'different declaration' }; await assert.rejects(reopened.createCitation(project.id, altered), /data_context_operation_conflict/);
});

test('M2-D07: an operation UUID cannot be reused for a different target kind', async t => {
  const { context, project, input } = await fixture(t); await context.freezeInput(project.id, input);
  await assert.rejects(context.saveDescription(project.id, { operationId: input.operationId, descriptionRevisionId: input.operationId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: 1, observation: unobserved, statements: [], mappings: [] }), /data_context_operation_conflict/);
  assert.equal((await context.getIndex(project.id))?.revision, 1);
});

test('M2-D07: evidence without index publication stays UNKNOWN and only the same explicit retry may publish it', async t => {
  const { context, project, input, options } = await fixture(t);
  const rename = fs.rename.bind(fs), interrupted = t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => { if (String(target).endsWith('/data-context/index.json')) throw new Error('synthetic publication interrupted'); return rename(source, target); });
  await assert.rejects(context.freezeInput(project.id, input), /synthetic publication interrupted/); interrupted.mock.restore();
  const reopened = new ProjectDataContextStore(options);
  await assert.rejects(reopened.getIndex(project.id), /data_context_incomplete_unknown/);
  const other = randomUUID();
  await assert.rejects(reopened.freezeInput(project.id, { ...input, operationId: other, inputVersionId: other }), /data_context_incomplete_unknown/);
  const recovered = await reopened.freezeInput(project.id, input);
  assert.equal(recovered.publishedOnRetry, true); assert.equal(recovered.replayed, false); assert.equal(recovered.indexRevision, 1);
  assert.equal((await new ProjectDataContextStore(options).freezeInput(project.id, input)).replayed, true);
});

test('M2-D07: an uncommitted description never becomes success after its base index advances', async t => {
  const { context, project, input, options } = await fixture(t); await context.freezeInput(project.id, input);
  const revision = randomUUID(), description: SaveDataDescription = { operationId: revision, descriptionRevisionId: revision, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: 1, observation: unobserved, statements: [], mappings: [] };
  const rename = fs.rename.bind(fs), interrupted = t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => { if (String(target).endsWith('/data-context/index.json')) throw new Error('synthetic publication interrupted'); return rename(source, target); });
  await assert.rejects(context.saveDescription(project.id, description), /synthetic publication interrupted/); interrupted.mock.restore();
  const nextVersion = randomUUID(); await context.freezeInput(project.id, { ...input, operationId: nextVersion, inputVersionId: nextVersion, baseIndexRevision: 1 });
  const reopened = new ProjectDataContextStore(options); await assert.rejects(reopened.saveDescription(project.id, description), /data_context_revision_conflict/);
  await assert.rejects(reopened.readDescription(project.id, input.datasetId, revision), /data_context_description_not_found/);
  assert.equal((await reopened.getIndex(project.id))?.revision, 2);
});

test('M2-D08: source expectations, links, traversal and archive fail without publishing or changing original files', async t => {
  const { context, project, input, projects, root } = await fixture(t);
  await assert.rejects(context.freezeInput(project.id, { ...input, expectedSha256: '0'.repeat(64) }), /data_context_source_changed/); assert.equal(await context.getIndex(project.id), null);
  await assert.rejects(context.freezeInput(project.id, { ...input, sourcePath: '020_clean/../060_reports/input.csv' }), /invalid_data_context_path/);
  const outside = path.join(root, 'outside.csv'); await fs.writeFile(outside, 'secret');
  await fs.symlink(outside, path.join(project.rootPath, '020_clean', 'linked.csv'));
  await assert.rejects(context.freezeInput(project.id, { ...input, sourcePath: '020_clean/linked.csv' }), /unsafe/);
  await fs.link(outside, path.join(project.rootPath, '020_clean', 'hard.csv'));
  await assert.rejects(context.freezeInput(project.id, { ...input, sourcePath: '020_clean/hard.csv' }), /unsafe/);
  await context.freezeInput(project.id, input); await projects.archive(project.id);
  const next = randomUUID(); await assert.rejects(context.freezeInput(project.id, { ...input, inputVersionId: next, operationId: next, baseIndexRevision: 1 }), /project_archived/);
  await assert.rejects(context.prepareAnalysisCopy(project.id, input.datasetId, input.inputVersionId), /project_archived/);
  assert.equal((await context.readInputEvidence(project.id, input.datasetId, input.inputVersionId)).bytes.toString(), 'a,b\n1,2\n'); assert.equal(await fs.readFile(outside, 'utf8'), 'secret');
});

test('M2-D07: a missing index with later history is incomplete, never a retryable empty project', async t => {
  const { context, project, input, projects } = await fixture(t); await context.freezeInput(project.id, input);
  const next = randomUUID(); await context.freezeInput(project.id, { ...input, operationId: next, inputVersionId: next, baseIndexRevision: 1 });
  await fs.unlink(path.join(projects.dataRoot, 'projects', project.id, 'data-context', 'index.json'));
  await assert.rejects(context.freezeInput(project.id, input), /data_context_incomplete_unknown/);
  await assert.rejects(context.getIndex(project.id), /data_context_incomplete_unknown/);
});

test('M2-D07: an uncommitted target whose request content changed cannot be adopted using its old fingerprint', async t => {
  const { context, project, input, projects } = await fixture(t);
  const rename = fs.rename.bind(fs), interrupted = t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => { if (String(target).endsWith('/data-context/index.json')) throw new Error('synthetic publication interrupted'); return rename(source, target); });
  await assert.rejects(context.freezeInput(project.id, input), /synthetic publication interrupted/); interrupted.mock.restore();
  const recordPath = path.join(projects.dataRoot, 'projects', project.id, 'data-context', 'datasets', input.datasetId, 'versions', input.inputVersionId, 'record.json');
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8')); record.sourceNote = 'externally changed request content'; await fs.writeFile(recordPath, JSON.stringify(record));
  await assert.rejects(context.freezeInput(project.id, input), /data_context_operation_conflict|data_context_uncommitted_conflict_unknown/);
  await assert.rejects(context.getIndex(project.id), /data_context_incomplete_unknown/);
});

test('M2-D07: oversized description metadata is refused before publishing an unreadable revision', async t => {
  const { context, project, input } = await fixture(t); await context.freezeInput(project.id, input);
  const revision = randomUUID(), statements: SaveDataDescription['statements'] = Array.from({ length: 800 }, () => ({ statementId: randomUUID(), scope: 'row-meaning', location: null, text: 'x'.repeat(3000), unit: null, provenance: 'unknown', confirmed: false, confirmedAt: null, confirmedBy: null }));
  await assert.rejects(context.saveDescription(project.id, { operationId: revision, descriptionRevisionId: revision, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: 1, observation: unobserved, statements, mappings: [] }), /data_context_metadata_too_large/);
  assert.equal((await context.getIndex(project.id))?.revision, 1);
  await assert.rejects(context.readDescription(project.id, input.datasetId, revision), /data_context_description_not_found/);
});

test('M2-D04: exact many-to-many concept and SAP references require a validator and stay historical after a source is disabled', async t => {
  const { context, project, input, options } = await fixture(t); await context.freezeInput(project.id, input);
  const conceptRef = { storeId: 'enterprise', materialId: randomUUID(), revisionId: randomUUID(), location: { start: 0, end: 3 } };
  const mappingEntry: DataContextMapping = { mappingId: randomUUID(), location: { kind: 'csv-column', columnIndex: 0 }, conceptRefs: [conceptRef, { ...conceptRef, revisionId: randomUUID() }], sapRefs: [{ packageId: 'synthetic-package', version: '0.2', metricName: 'sales', publishedHash: '1'.repeat(64) }, { packageId: 'synthetic-package', version: '0.2', metricName: 'net-sales', publishedHash: '1'.repeat(64) }], provenance: 'agent-inference', dispute: 'Two declared interpretations remain disputed', confirmed: false, confirmedAt: null, confirmedBy: null };
  const revision = randomUUID(), description: SaveDataDescription = { operationId: revision, descriptionRevisionId: revision, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: 1, observation: { ...unobserved, coverage: 'partial', fields: [{ location: { kind: 'csv-column', columnIndex: 0 }, originalName: '', observedType: 'mixed' }, { location: { kind: 'csv-column', columnIndex: 1 }, originalName: '', observedType: 'unknown' }], limitations: 'Manual field statements only; records unscanned; empty records excluded' }, statements: [], mappings: [mappingEntry, { ...mappingEntry, mappingId: randomUUID(), location: { kind: 'csv-column', columnIndex: 1 }, conceptRefs: [conceptRef] }] };
  await assert.rejects(context.saveDescription(project.id, description), /data_context_reference_validation_unavailable/); assert.equal((await context.getIndex(project.id))?.revision, 1);
  let disabled = false;
  const validated = new ProjectDataContextStore({ ...options, validateReferences: async (_projectId, refs) => { assert.equal(refs.conceptRefs[0]?.revisionId, conceptRef.revisionId); if (disabled) throw new Error('synthetic reference disabled'); } });
  const saved = (await validated.saveDescription(project.id, description)).record; assert.equal(saved.mappings[0]?.conceptRefs.length, 2); assert.equal(saved.mappings[0]?.sapRefs.length, 2); assert.equal(saved.observation.scannedRows, null); assert.equal(saved.observation.fields[1]?.originalName, '');
  disabled = true; assert.equal((await validated.readDescription(project.id, input.datasetId, revision)).mappings[0]?.conceptRefs[0]?.revisionId, conceptRef.revisionId);
  const next = randomUUID(); await assert.rejects(validated.saveDescription(project.id, { ...description, operationId: next, descriptionRevisionId: next, baseIndexRevision: 2, baseDescriptionRevisionId: revision }), /synthetic reference disabled/);
  const wrongVersion = randomUUID(); await validated.freezeInput(project.id, { ...input, operationId: wrongVersion, inputVersionId: wrongVersion, baseIndexRevision: 2 });
  await assert.rejects(validated.resolveSelection(project.id, { datasetId: input.datasetId, inputVersionId: wrongVersion, descriptionRevisionId: revision }), /data_context_description_version_mismatch/);
});

test('M2-D07: concurrent stale edits have one CAS winner and corrupted saved bytes or unknown schema are never reset', async t => {
  const { context, project, input, projects } = await fixture(t); const first = await context.freezeInput(project.id, input);
  const requests = [randomUUID(), randomUUID()].map(version => ({ ...input, operationId: version, inputVersionId: version, baseIndexRevision: 1 }));
  const results = await Promise.allSettled(requests.map(request => context.freezeInput(project.id, request)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.match(String((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /data_context_revision_conflict/);
  assert.equal((await context.getIndex(project.id))?.revision, 2);
  const root = path.join(projects.dataRoot, 'projects', project.id, 'data-context'), evidence = path.join(root, first.record.evidencePath);
  await fs.writeFile(evidence, 'tampered'); await assert.rejects(context.readVersion(project.id, input.datasetId, input.inputVersionId), /data_context_evidence_hash_mismatch/); assert.equal(await fs.readFile(evidence, 'utf8'), 'tampered');
  const indexPath = path.join(root, 'index.json'), index = JSON.parse(await fs.readFile(indexPath, 'utf8')); index.schemaVersion = 999; const corrupted = JSON.stringify(index); await fs.writeFile(indexPath, corrupted);
  await assert.rejects(context.getIndex(project.id), /corrupt_data_context_index/); assert.equal(await fs.readFile(indexPath, 'utf8'), corrupted);
});

test('M2-D08: citation rejects wrong directories, unsupported files, stale expected hashes and excessive evidence without a success pointer', async t => {
  const { context, project, input } = await fixture(t); await context.freezeInput(project.id, input);
  const reportPath = '060_reports/selected.md', bytes = Buffer.from('draft'); await fs.writeFile(path.join(project.rootPath, reportPath), bytes);
  const citationId = randomUUID(), request = { operationId: citationId, citationId, baseIndexRevision: 1, report: { path: reportPath, sha256: '0'.repeat(64), bytes: bytes.length }, attachments: [], selections: [], conceptRefs: [], sapRefs: [], declarer: 'user' as const, declaration: '' };
  await assert.rejects(context.createCitation(project.id, request), /data_context_source_changed/);
  await assert.rejects(context.createCitation(project.id, { ...request, report: { ...request.report, path: '020_clean/selected.md' } }), /invalid_data_context_path/);
  await assert.rejects(context.createCitation(project.id, { ...request, report: { ...request.report, path: '060_reports/selected.pdf' } }), /unsupported_data_context_format/);
  await assert.rejects(context.createCitation(project.id, { ...request, attachments: Array.from({ length: 20 }, (_, i) => ({ path: `020_clean/file-${i}.py`, bytes: 0, sha256: '0'.repeat(64) })) }), /invalid_data_context_list/);
  assert.equal((await context.getIndex(project.id))?.citations.length, 0);
  const saved = await context.createCitation(project.id, { ...request, report: { ...request.report, sha256: createHash('sha256').update(bytes).digest('hex') } }); assert.equal(saved.record.sourcesDeclared, false); assert.deepEqual(saved.record.selections, []);
});

test('M2-D07: reserialized uncommitted records never publish a different record hash than the bytes kept on disk', async t => {
  const { context, project, input, projects } = await fixture(t);
  const rename = fs.rename.bind(fs), interrupted = t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => { if (String(target).endsWith('/data-context/index.json')) throw new Error('synthetic publication interrupted'); return rename(source, target); });
  await assert.rejects(context.freezeInput(project.id, input), /synthetic publication interrupted/); interrupted.mock.restore();
  const recordPath = path.join(projects.dataRoot, 'projects', project.id, 'data-context', 'datasets', input.datasetId, 'versions', input.inputVersionId, 'record.json');
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8')); await fs.writeFile(recordPath, JSON.stringify(record, null, 2));
  // External changes without a committed independent record hash are not trusted retry evidence.
  await assert.rejects(context.freezeInput(project.id, input), /data_context_uncommitted_conflict_unknown/);
  await assert.rejects(context.getIndex(project.id), /data_context_incomplete_unknown/);
});

test('M2-D07: an uncommitted operation UUID remains bound to its original dataset and kind across reopen', async t => {
  const { context, project, input, options } = await fixture(t); await context.freezeInput(project.id, input);
  const orphanId = randomUUID(), orphan = { ...input, operationId: orphanId, inputVersionId: orphanId, name: 'Original interrupted target', baseIndexRevision: 1 };
  const rename = fs.rename.bind(fs), interrupted = t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => { if (String(target).endsWith('/data-context/index.json')) throw new Error('synthetic publication interrupted'); return rename(source, target); });
  await assert.rejects(context.freezeInput(project.id, orphan), /synthetic publication interrupted/); interrupted.mock.restore();
  const reopened = new ProjectDataContextStore(options);
  await assert.rejects(reopened.freezeInput(project.id, { ...orphan, datasetId: randomUUID(), name: 'Changed dataset target' }), /data_context_operation_conflict/);
  await assert.rejects(reopened.saveDescription(project.id, { operationId: orphanId, descriptionRevisionId: orphanId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: 1, observation: unobserved, statements: [], mappings: [] }), /data_context_operation_conflict/);
  assert.equal((await reopened.getIndex(project.id))?.revision, 1); assert.equal((await reopened.getIndex(project.id))?.datasets.length, 1);
  await assert.rejects(reopened.readVersion(project.id, input.datasetId, orphanId), /data_context_version_not_found/);
  const recovered = await reopened.freezeInput(project.id, orphan);
  assert.equal(recovered.publishedOnRetry, true); assert.equal(recovered.record.datasetId, input.datasetId); assert.equal(recovered.indexRevision, 2);
  assert.equal((await reopened.freezeInput(project.id, orphan)).replayed, true);
});

test('M2-D07: uncommitted description and citation UUIDs cannot be reused for input versions', async t => {
  for (const kind of ['description', 'citation'] as const) await t.test(kind, async child => {
    const { context, project, input, options } = await fixture(child); await context.freezeInput(project.id, input);
    const operationId = randomUUID(), revision: SaveDataDescription = { operationId, descriptionRevisionId: operationId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: 1, observation: unobserved, statements: [], mappings: [] };
    const report = Buffer.from('Synthetic draft'), reportPath = '060_reports/selected.md'; await fs.writeFile(path.join(project.rootPath, reportPath), report);
    const citation = { operationId, citationId: operationId, baseIndexRevision: 1, report: { path: reportPath, sha256: createHash('sha256').update(report).digest('hex'), bytes: report.length }, attachments: [], selections: [], conceptRefs: [], sapRefs: [], declarer: 'user' as const, declaration: '' };
    const original = (store: ProjectDataContextStore) => kind === 'description' ? store.saveDescription(project.id, revision) : store.createCitation(project.id, citation);
    const rename = fs.rename.bind(fs), interrupted = child.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => { if (String(target).endsWith('/data-context/index.json')) throw new Error('synthetic publication interrupted'); return rename(source, target); });
    await assert.rejects(original(context), /synthetic publication interrupted/); interrupted.mock.restore();
    const reopened = new ProjectDataContextStore(options);
    await assert.rejects(reopened.freezeInput(project.id, { ...input, operationId, inputVersionId: operationId, baseIndexRevision: 1 }), /data_context_operation_conflict/);
    assert.equal((await reopened.getIndex(project.id))?.revision, 1);
    assert.equal((await original(reopened)).publishedOnRetry, true); assert.equal((await original(reopened)).replayed, true);
  });
});

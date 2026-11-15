import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { DbLinkResults } from '../src/host/db-link-results.ts';
import { createDbLinkDataContext, type DbLinkSaveDescriptionInput, type DbLinkMetadataObservation } from '../src/host/db-link-data-context.ts';
import { projectDataDescriptionRequest } from '../src/host/project-data-context-request.ts';
import { readProjectDataWriteStatus } from '../src/host/ui/project-data-context-client.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-db-description-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://localhost' };
  const project = await projects.create({ name: '合成数据库说明', configuration });
  const task = await projects.createTask(project.id, { name: '合成说明任务' });
  const taskId = task.id, owner = { projectId: project.id, taskId, requestId: randomUUID(), operationId: randomUUID() };
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const results = new DbLinkResults({ dataRoot: projects.dataRoot, projectDirectory: () => project.rootPath, assertAccess: candidate => { assert.equal(candidate.projectId, project.id); } });
  const source = { connectionId: randomUUID(), connectionRevision: 1, engine: 'postgresql' as const, sourceIdentity: 'synthetic-native-server', sql: 'select amount from public.orders', parameters: [], observedObjects: ['public.orders'], declaredObjects: ['public.orders'], unknownObjects: [], startedAt: '2026-11-14T01:00:00.000Z', session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read' } };
  const sink = await results.begin(owner, source, [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: 20, scale: 4 }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); await sink.append([['123.4500']]); const receipt = await sink.complete('1');
  let authorized = true;
  const adapter = createDbLinkDataContext({ projects, data, results, authorize: (_owner, actual) => { assert.deepEqual(actual, { connectionId: source.connectionId, connectionRevision: 1, sourceIdentity: source.sourceIdentity }); if (!authorized) throw new Error('db_source_not_authorized'); } });
  const input: DbLinkSaveDescriptionInput = { resultId: receipt.id, operationId: randomUUID(), description: { statements: [{ statementId: randomUUID(), scope: 'field', location: { kind: 'json-pointer', pointer: '/columns/0', queryExpression: 'amount（Agent 声明；非 Host SQL 血缘证明）' }, text: '返回精确小数；币种与含税口径未知。', unit: null, provenance: 'agent-inference', confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [] } };
  return { projects, project, data, results, owner, source, receipt, adapter, input, revoke: () => { authorized = false; } };
}

test('db-link saves an exact structure description in the original Store and prepares original Studio refs without publishing', async t => {
  const { data, owner, receipt, adapter, input, project } = await fixture(t);
  const saved = await adapter.save(owner, input);
  assert.equal(saved.structureOnly, true); assert.equal(saved.inputVersion.sha256, receipt.sha256);
  assert.equal(saved.inputVersion.sourcePath, receipt.relativePath);
  assert.equal(saved.description.observation.coverage, 'partial'); assert.equal(saved.description.observation.scannedRows, 0);
  assert.match(saved.description.observation.limitations, /结构|数据行/);
  assert.equal(saved.description.statements[0].confirmed, false);
  const observedPosition = saved.description.observation.fields[0].location;
  assert.equal(observedPosition.kind === 'json-pointer' ? observedPosition.database?.sourceSha256 : undefined, receipt.sha256);
  const position = saved.description.statements[0].location;
  assert.equal(position?.kind, 'json-pointer');
  if (position?.kind === 'json-pointer') { assert.equal(position.database?.sourceId, receipt.id); assert.equal(position.database?.connectionRevision, 1); assert.equal(position.database?.object, undefined); assert.match(position.queryExpression!, /Agent/); }
  const sourceNote = JSON.parse(saved.inputVersion.sourceNote!); assert.equal(sourceNote.dataRowsFrozenByDataContext, false); assert.equal(sourceNote.files.length, 2);
  assert.deepEqual((await data.readDescription(project.id, saved.inputVersion.datasetId, saved.description.descriptionRevisionId)).statements, saved.description.statements);
  assert.equal(saved.materials[0].ref.authority, 'data'); assert.equal(saved.materials[0].ref.projectId, project.id);
  assert.match(saved.materials[0].note, /候选|发布/);
  const replay = await adapter.save(owner, input);
  assert.equal(replay.inputVersion.inputVersionId, saved.inputVersion.inputVersionId); assert.equal(replay.description.descriptionRevisionId, saved.description.descriptionRevisionId);
  assert.equal((await data.getIndex(project.id))?.revision, 2);
});

test('fixed incomplete results can supply only description structure with their exact status, counts, actor and source limitations', async t => {
  const f = await fixture(t);
  for (const status of ['partial', 'failed', 'cancelled'] as const) {
    const captured = { ...f.source, limitations: ['db_view_scope_not_independently_verified', 'db_current_role_policy_visible_scope'], session: { ...f.source.session, loginRole: 'tenant_a_reader', effectiveRole: 'tenant_a_reader', visibleScope: 'current-account-visible' as const } };
    const sink = await f.results.begin(f.owner, captured, [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); await sink.append([['1.00']]);
    const receipt = await sink.abort(status, 'db_driver_batch_row_limit', { driverReceivedRows: 100, rowAccounting: 'after-driver-decode' });
    await assert.rejects(f.results.materialFiles(f.owner, receipt.id), /db_result_incomplete/);
    const saved = await f.adapter.save(f.owner, { ...f.input, operationId: randomUUID(), resultId: receipt.id });
    assert.equal(saved.structureOnly, true); assert.equal(saved.inputVersion.sha256, receipt.sha256); assert.equal(saved.description.observation.scannedRows, 0);
    const note = JSON.parse(saved.inputVersion.sourceNote!);
    assert.equal(note.dataRowsFrozenByDataContext, false); assert.equal(note.coverage.status, status); assert.equal(note.coverage.reason, 'db_driver_batch_row_limit');
    assert.equal(note.coverage.driverReceivedRows, 100); assert.equal(note.coverage.receivedRows, 1); assert.equal(note.coverage.persistedRows, 1);
    assert.deepEqual(note.coverage.actor, { loginRole: 'tenant_a_reader', effectiveRole: 'tenant_a_reader', visibleScope: 'current-account-visible' });
    assert.deepEqual(note.coverage.limitations, captured.limitations);
    assert.match(saved.description.observation.limitations, /tenant_a_reader/); assert.match(saved.description.observation.limitations, /db_view_scope_not_independently_verified/);
    assert.equal(saved.materials.every(item => item.ref.authority === 'data' && item.saved && item.readable), true);
    assert.equal((await f.results.read(f.owner, receipt.id)).manifest.status, status);
  }
});

test('a legacy fixed source note without coverage remains immutable while a new or retried description adds the known observation', async t => {
  const f = await fixture(t), original = await f.results.materialFiles(f.owner, f.receipt.id);
  const legacyNote = JSON.stringify({ kind: 'db-link-structure-source', sourceKind: 'query-result', sourceId: f.receipt.id, source: { connectionId: f.source.connectionId, connectionRevision: 1, sourceIdentity: f.source.sourceIdentity }, owner: f.owner, structureOnly: true, dataRowsFrozenByDataContext: false, files: original.files.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 })) });
  const input = (await f.data.freezeInput(f.project.id, { datasetId: f.receipt.id, inputVersionId: f.receipt.id, operationId: f.receipt.id, baseIndexRevision: 0, name: '旧固定来源', sourcePath: f.receipt.relativePath, expectedSha256: f.receipt.sha256, expectedBytes: original.files[0].bytes, sourceNote: legacyNote })).record;
  const saved = await f.adapter.save(f.owner, f.input), replayed = await f.adapter.save(f.owner, f.input);
  assert.equal(saved.inputVersion.sourceNote, legacyNote); assert.equal(replayed.inputVersion.sourceNote, legacyNote);
  assert.equal((await f.data.readVersion(f.project.id, input.datasetId, input.inputVersionId)).sourceNote, legacyNote);
  assert.equal(saved.inputVersion.sha256, f.receipt.sha256); assert.match(saved.description.observation.limitations, /db_source_limitations_unknown|unknown/);
  assert.equal(JSON.parse(saved.inputVersion.sourceNote!).coverage, undefined);
});

test('legacy compatibility does not accept a changed source note or replace a recorded coverage claim', async t => {
  for (const changed of [{ sourceIdentity: 'changed-source' }, { coverage: {} }]) {
    const f = await fixture(t), original = await f.results.materialFiles(f.owner, f.receipt.id);
    const source = { connectionId: f.source.connectionId, connectionRevision: 1, sourceIdentity: f.source.sourceIdentity, ...('sourceIdentity' in changed ? changed : {}) };
    const sourceNote = JSON.stringify({ kind: 'db-link-structure-source', sourceKind: 'query-result', sourceId: f.receipt.id, source, owner: f.owner, structureOnly: true, dataRowsFrozenByDataContext: false, files: original.files.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 })), ...('coverage' in changed ? changed : {}) });
    await f.data.freezeInput(f.project.id, { datasetId: f.receipt.id, inputVersionId: f.receipt.id, operationId: f.receipt.id, baseIndexRevision: 0, name: '旧来源差异', sourcePath: f.receipt.relativePath, expectedSha256: f.receipt.sha256, expectedBytes: original.files[0].bytes, sourceNote });
    await assert.rejects(f.adapter.save(f.owner, f.input), /db_description_source_changed/);
    assert.equal((await f.data.readVersion(f.project.id, f.receipt.id, f.receipt.id)).sourceNote, sourceNote);
    assert.equal((await f.data.getIndex(f.project.id))!.datasets[0].descriptions.length, 0);
  }
});

test('retrying an already saved legacy description preserves its original observation bytes while a new operation can enrich scope', async t => {
  const f = await fixture(t), original = await f.results.materialFiles(f.owner, f.receipt.id);
  const legacyNote = JSON.stringify({ kind: 'db-link-structure-source', sourceKind: 'query-result', sourceId: f.receipt.id, source: { connectionId: f.source.connectionId, connectionRevision: 1, sourceIdentity: f.source.sourceIdentity }, owner: f.owner, structureOnly: true, dataRowsFrozenByDataContext: false, files: original.files.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 })) });
  await f.data.freezeInput(f.project.id, { datasetId: f.receipt.id, inputVersionId: f.receipt.id, operationId: f.receipt.id, baseIndexRevision: 0, name: '已保存的旧来源', sourcePath: f.receipt.relativePath, expectedSha256: f.receipt.sha256, expectedBytes: original.files[0].bytes, sourceNote: legacyNote });
  const observation: import('../src/host/project-data-context-types.ts').DataContextObservation = { author: 'agent', format: 'json', encoding: 'UTF-8', recordRule: 'JSON pointer 指向原结构描述；查询数据行位于原结果文件集，未在此说明中扫描或冻结。', coverage: 'partial', scannedRows: 0, totalRows: null, fields: [{ location: { kind: 'json-pointer', pointer: '/columns/0', database: { sourceKind: 'query-result', sourceId: f.receipt.id, sourcePath: f.receipt.relativePath, sourceSha256: f.receipt.sha256, connectionId: f.source.connectionId, connectionRevision: 1, sourceIdentity: f.source.sourceIdentity } }, originalName: 'amount', observedType: 'numeric' }], limitations: '本输入版本仅固定结构与来源 manifest；不表示数据行已由数据说明 Store 固定或读取，不证明全库结构、业务口径或取数完整。', generatedAt: original.manifest.finishedAt, nativeEvidence: null, artifactEvidence: null };
  const input = { ...f.input, description: { statements: [], mappings: [] } };
  const old = (await f.data.saveDescription(f.project.id, { operationId: input.operationId, datasetId: f.receipt.id, inputVersionId: f.receipt.id, descriptionRevisionId: input.operationId, baseIndexRevision: 1, baseDescriptionRevisionId: null, observation, statements: [], mappings: [] }, { validateDatabaseSource: async () => { assert.equal((await f.results.materialFiles(f.owner, f.receipt.id)).receipt.sha256, f.receipt.sha256); } })).record;
  const originalHash = (await f.data.getIndex(f.project.id))!.datasets[0].descriptions[0].recordSha256;
  const replay = await f.adapter.save(f.owner, input); assert.deepEqual(replay.description, old);
  assert.equal((await f.data.getIndex(f.project.id))!.datasets[0].descriptions[0].recordSha256, originalHash);
  await assert.rejects(f.adapter.save(f.owner, { ...f.input, operationId: input.operationId }), /data_context_operation_conflict/);
  const enriched = await f.adapter.save(f.owner, { ...input, operationId: randomUUID() }); assert.match(enriched.description.observation.limitations, /db_source_limitations_unknown/);
  assert.deepEqual(await f.data.readDescription(f.project.id, f.receipt.id, old.descriptionRevisionId), old);
});

test('db-link refuses revoked, archived, foreign-task, cancelled and late description writes before creating an input version', async t => {
  const f = await fixture(t);
  const otherTask = await f.projects.createTask(f.project.id, { name: '另一任务' });
  await assert.rejects(f.adapter.save({ ...f.owner, taskId: otherTask.id }, f.input), /db_description_foreign_source/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(f.adapter.save(f.owner, f.input, { signal: controller.signal }), /db_description_cancelled/);
  await assert.rejects(f.adapter.save(f.owner, f.input, { assertCurrent: () => { throw new Error('stale-native-operation'); } }), /stale-native-operation/);
  assert.equal(await f.data.getIndex(f.project.id), null);
  f.revoke(); await assert.rejects(f.adapter.save(f.owner, f.input), /db_source_not_authorized/); assert.equal(await f.data.getIndex(f.project.id), null);
  await f.projects.archive(f.project.id); await assert.rejects(f.adapter.save(f.owner, f.input), /db_project_archived/);
});

test('db-link full material reading still refuses partial results and descriptions never repair changed original files', async t => {
  const f = await fixture(t);
  const partial = await f.results.begin(f.owner, f.source, [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); await partial.append([['1.00']]); const partialReceipt = await partial.abort('partial', 'synthetic-limit');
  await assert.rejects(f.results.materialFiles(f.owner, partialReceipt.id), /db_result_incomplete/);
  const bundle = await f.results.materialFiles(f.owner, f.receipt.id), chunk = bundle.files.find(value => value.role === 'chunk')!;
  const file = path.join(f.project.rootPath, chunk.relativePath); await fs.writeFile(file, '{"changed":true}');
  await assert.rejects(f.adapter.save(f.owner, f.input), /db_result_changed/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"changed":true}'); assert.equal(await f.data.getIndex(f.project.id), null);
});

test('db-link rejects client-supplied source identity and user confirmation claims while preserving author uncertainty', async t => {
  const f = await fixture(t), first = f.input.description.statements[0];
  await assert.rejects(f.adapter.save(f.owner, { ...f.input, description: { statements: [{ ...first, location: { kind: 'json-pointer', pointer: '/columns/0', database: { sourceKind: 'query-result', sourceId: f.receipt.id, sourcePath: f.receipt.relativePath, sourceSha256: f.receipt.sha256, connectionId: 'forged', connectionRevision: 99, sourceIdentity: 'forged' } } }], mappings: [] } }), /db_description_untrusted_source/);
  await assert.rejects(f.adapter.save(f.owner, { ...f.input, description: { statements: [{ ...first, provenance: 'user-statement' }], mappings: [] } }), /db_description_untrusted_confirmation/);
  assert.equal(await f.data.getIndex(f.project.id), null);
  const saved = await f.adapter.save(f.owner, { ...f.input, description: { statements: [{ ...first, confirmed: true, confirmedBy: 'untrusted', confirmedAt: new Date().toISOString() }], mappings: [] } });
  assert.equal(saved.description.statements[0].confirmed, false); assert.equal(saved.description.statements[0].confirmedBy, null);
});

test('db-link metadata remains a separate structure observation and preserves ordered composite relationship groups', async t => {
  const f = await fixture(t), observationId = randomUUID();
  const observation: DbLinkMetadataObservation = { schema: 1, kind: 'db-link-metadata-observation', id: observationId, owner: f.owner, source: { connectionId: f.source.connectionId, connectionRevision: 1, sourceIdentity: f.source.sourceIdentity, permissionBinding: 'restricted-role-domain', observedAt: '2026-11-14T01:00:00.000Z' }, coverage: { complete: false, limitations: ['comments unavailable'] }, objects: [{ database: 'synthetic', schema: 'public', name: 'order_lines', kind: 'table', columns: [{ ordinal: 0, name: 'tenant_id', databaseType: 'text', precision: null, scale: null }, { ordinal: 1, name: 'order_id', databaseType: 'bigint', precision: 64, scale: 0 }], constraints: [{ kind: 'foreign-key', columns: ['tenant_id', 'order_id'], target: { database: 'synthetic', schema: 'public', object: 'orders', columns: ['tenant_id', 'id'] }, validation: 'unknown' }] }] };
  const bytes = Buffer.from(JSON.stringify(observation)), uploaded = await f.projects.upload({ projectId: f.project.id, name: 'db-metadata.json', bytes, directory: '020_clean' });
  const metadata = { read: async () => ({ observation, file: { relativePath: uploaded.path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }) };
  const adapter = createDbLinkDataContext({ projects: f.projects, data: f.data, results: f.results, metadata, authorize: () => {} });
  const original = f.input.description.statements[0];
  const saved = await adapter.save(f.owner, { observationRef: observationId, operationId: randomUUID(), description: { statements: [{ ...original, scope: 'source-and-limitations', location: { kind: 'json-pointer', pointer: '/objects/0/constraints/0' }, text: '目录声明组合外键；声明与历史数据是否满足分开，不能漏掉tenant_id。' }], mappings: [] } });
  const position = saved.description.statements[0].location; assert.equal(position?.kind, 'json-pointer');
  if (position?.kind === 'json-pointer') { assert.deepEqual(position.database?.object?.columns, ['tenant_id', 'order_id']); assert.deepEqual(position.database?.relatedObject?.columns, ['tenant_id', 'id']); }
  const frozen = await f.data.readInputEvidence(f.project.id, saved.inputVersion.datasetId, saved.inputVersion.inputVersionId); const body = JSON.parse(frozen.bytes.toString());
  assert.equal(body.kind, 'db-link-metadata-observation'); assert.equal('sql' in body, false);
  assert.match(saved.description.observation.limitations, /comments unavailable/);
  await f.projects.archive(f.project.id); assert.equal((await f.data.readDescription(f.project.id, saved.inputVersion.datasetId, saved.description.descriptionRevisionId)).descriptionRevisionId, saved.description.descriptionRevisionId);
});

test('db-link proof is Host-only and cannot bless mismatched persisted provenance; old plain JSON descriptions still work', async t => {
  const f = await fixture(t), saved = await f.adapter.save(f.owner, f.input), descriptionId = randomUUID();
  const description = { ...saved.description, operationId: descriptionId, descriptionRevisionId: descriptionId, baseIndexRevision: 2, baseDescriptionRevisionId: saved.description.descriptionRevisionId };
  await assert.rejects(f.data.saveDescription(f.project.id, description), /data_context_database_validation_unavailable/);
  const altered = structuredClone(description), position = altered.statements[0].location;
  if (position?.kind === 'json-pointer') position.database!.connectionRevision = 99;
  await assert.rejects(f.data.saveDescription(f.project.id, altered, { validateDatabaseSource: async () => {} }), /data_context_database_source_mismatch/);
  const strip = (value: import('../src/host/project-data-context-types.ts').DataContextFieldLocation) => value.kind === 'json-pointer' ? { kind: 'json-pointer' as const, pointer: value.pointer } : value;
  const legacyId = randomUUID(), legacy = { ...description, operationId: legacyId, descriptionRevisionId: legacyId, observation: { ...description.observation, fields: description.observation.fields.map(field => ({ ...field, location: strip(field.location) })) }, statements: description.statements.map(item => ({ ...item, location: item.location ? strip(item.location) : null })) };
  assert.equal((await f.data.saveDescription(f.project.id, legacy)).record.descriptionRevisionId, legacyId);
});

test('db-link checks revocation again at original Store submission and leaves the prior fixed source intact', async t => {
  const f = await fixture(t), save = f.data.saveDescription.bind(f.data);
  t.mock.method(f.data, 'saveDescription', async (...args: Parameters<typeof save>) => { f.revoke(); return save(...args); });
  await assert.rejects(f.adapter.save(f.owner, f.input), /db_source_not_authorized/);
  const index = await f.data.getIndex(f.project.id); assert.equal(index?.revision, 1); assert.equal(index?.datasets[0].descriptions.length, 0);
  assert.equal((await f.data.readInputEvidence(f.project.id, f.receipt.id, f.receipt.id)).record.sha256, f.receipt.sha256);
});

test('db-link delegates SAP and concept references to the original authority validator without creating a second semantic library', async t => {
  const f = await fixture(t); let checked = 0;
  f.data.options.validateReferences = async (projectId, refs) => { checked++; assert.equal(projectId, f.project.id); assert.equal(refs.sapRefs[0].metricName, 'net_sales'); throw new Error('data_context_sap_unavailable'); };
  await assert.rejects(f.adapter.save(f.owner, { ...f.input, description: { ...f.input.description, mappings: [{ mappingId: randomUUID(), location: { kind: 'json-pointer', pointer: '/columns/0' }, conceptRefs: [], sapRefs: [{ packageId: 'synthetic-package', version: '1', metricName: 'net_sales', publishedHash: null }], provenance: 'agent-inference', dispute: '尚待核对口径', confirmed: false, confirmedAt: null, confirmedBy: null }] } }), /data_context_sap_unavailable/);
  assert.equal(checked, 1); assert.equal((await f.data.getIndex(f.project.id))?.datasets[0].descriptions.length, 0);
});

test('db-link provenance and declared expressions share the original ACK fingerprint while absent optional fields keep the old JSON location shape', async t => {
  const f = await fixture(t), saved = await f.adapter.save(f.owner, f.input), summary = await f.data.summary(f.project.id);
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async (url, init) => { calls.push(init?.method ?? 'GET'); return new Response(JSON.stringify(String(url).includes('/descriptions/') ? { record: saved.description } : summary)); };
  try {
    assert.equal((await readProjectDataWriteStatus(f.project.id, { kind: 'description', input: saved.description })).saved?.kind, 'description');
    const altered = structuredClone(saved.description), position = altered.statements[0].location;
    if (position?.kind === 'json-pointer') position.queryExpression = 'different author expression';
    assert.equal((await readProjectDataWriteStatus(f.project.id, { kind: 'description', input: altered })).saved, null);
    if (position?.kind === 'json-pointer') { position.queryExpression = saved.description.statements[0].location?.kind === 'json-pointer' ? saved.description.statements[0].location.queryExpression : undefined; position.database!.sourceIdentity = 'different-native-source'; }
    assert.equal((await readProjectDataWriteStatus(f.project.id, { kind: 'description', input: altered })).saved, null);
    assert.equal(calls.every(method => method === 'GET'), true);
    const legacy = structuredClone(saved.description);
    legacy.observation.fields = legacy.observation.fields.map(field => ({ ...field, location: { kind: 'json-pointer', pointer: '/columns/0' } }));
    legacy.statements = legacy.statements.map(item => ({ ...item, location: { kind: 'json-pointer', pointer: '/columns/0' } }));
    const projected = projectDataDescriptionRequest(legacy);
    assert.deepEqual(projected.observation.fields[0].location, { kind: 'json-pointer', pointer: '/columns/0' });
    assert.deepEqual(projected.statements[0].location, { kind: 'json-pointer', pointer: '/columns/0' });
  } finally { globalThis.fetch = original; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { createPersonalSourceReader } from '../src/host/personal-retention-sources.ts';
import { createPersonalLookup } from '../src/host/personal-retention-lookup.ts';
import { createProjectDataContextReferences } from '../src/host/project-data-context-references.ts';

const evidenceRoot = path.resolve('.local/fourbase-modules/m3/implementation/sources/test-roots');
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  await fs.mkdir(evidenceRoot, { recursive: true }); const root = await fs.mkdtemp(path.join(evidenceRoot, 'lookup-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  const enterprise = new EnterpriseMaterialsStore(projects.dataRoot), references = createProjectDataContextReferences({ dataRoot: projects.dataRoot, projects, enterpriseMaterials: enterprise }), dataContext = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects, validateReferences: references.validate });
  const board = createDecisionBoardStore({ root: path.join(root, 'board') }); await board.init(); t.after(async () => { board.close(); await projects.close(); });
  const readSource = createPersonalSourceReader({ enterprise, projects, dataContext, board }), personal = new PersonalRetentionStore({ dataRoot: projects.dataRoot, materials: enterprise, readSource });
  const lookup = createPersonalLookup({ personal, enterprise, projects, dataContext, readSource });
  return { root, projects, enterprise, dataContext, personal, lookup };
}

test('PR06/07: personal lookup uses the retained exact content and explicit aliases; body matching is opt-in with literal match positions', async t => {
  const { enterprise, personal, lookup } = await fixture(t);
  const created = await enterprise.create({ title: '首单定义', body: '正文专词：试点边界未知。', scope: '门店甲' });
  const enabled = await enterprise.enable(created.material.id, created.material.version), old = enabled.material.revisions[0];
  const metadata = { kind: 'knowledge' as const, aliases: ['新客', '首次购买'], caution: '仅适用旧试点', sourceRefs: [] };
  await personal.retain(created.material.id, { operationId: randomUUID(), expectedRevision: 0, target: { type: 'revision', revisionId: old.revisionId, expectedBodySha256: old.bodySha256 }, metadata, personalLabel: null });
  await enterprise.update(created.material.id, enabled.material.version, { title: '尚未保留的新标题', body: '今天的新草稿' });
  const found = await lookup({ query: '新客' });
  assert.equal(found.complete, true); assert.equal(found.total, 1); assert.equal(found.items[0].title, '首单定义');
  assert.equal(found.items[0].bodyPreview, '正文专词：试点边界未知。'); assert.equal(found.items[0].personalState, 'retained');
  assert.equal(found.items[0].bodySha256, old.bodySha256);
  assert.equal(found.items[0].decisionId, (await personal.getItem(created.material.id))!.currentDecisionId, 'the displayed exact decision must survive a later retention change');
  assert.deepEqual(found.items[0].matches, [{ field: 'aliases', aliasIndex: 0, start: 0, end: 2 }]);
  assert.equal((await lookup({ query: '正文专词' })).total, 0);
  const byBody = await lookup({ query: '正文专词', includeBody: true });
  assert.deepEqual(byBody.items[0].matches, [{ field: 'body', start: 0, end: 4 }]);
  await assert.rejects(lookup({ query: '甲'.repeat(201) }), /invalid_personal_lookup_query/);
});

test('PR04/06: drafts and archived personal entries require explicit discovery filters and paginate deterministically', async t => {
  const { enterprise, personal, lookup } = await fixture(t);
  const first = await enterprise.create({ title: '未保留经验', body: '合成草稿经验' });
  await personal.saveDraftMeta(first.material.id, { expectedRevision: 0, metadata: { kind: 'experience', aliases: [], caution: null, sourceRefs: [] } });
  const second = await enterprise.create({ title: '归档知识', body: '旧合成知识' }), enabled = await enterprise.enable(second.material.id, second.material.version), revision = enabled.material.revisions[0];
  await personal.retain(second.material.id, { operationId: randomUUID(), expectedRevision: 0, target: { type: 'revision', revisionId: revision.revisionId, expectedBodySha256: revision.bodySha256 }, metadata: { kind: 'knowledge', aliases: [], caution: null, sourceRefs: [] }, personalLabel: null });
  await personal.archive(second.material.id, { operationId: randomUUID(), expectedRevision: 1, personalLabel: null });
  assert.equal((await lookup()).total, 0);
  const drafts = await lookup({ includeDrafts: true }); assert.equal(drafts.total, 1); assert.equal(drafts.items[0].title, '未保留经验'); assert.equal(drafts.items[0].personalState, 'draft');
  const both = await lookup({ includeDrafts: true, includeArchived: true, pageSize: 1, page: 2 });
  assert.equal(both.total, 2); assert.equal(both.items.length, 1); assert.equal(both.items[0].personalState, 'archived');
  assert.equal((await lookup({ includeDrafts: true, category: 'experience' })).total, 1);
  assert.equal((await lookup({ includeDrafts: true, includeArchived: true, pageSize: 1, page: 3 })).items.length, 0);
});

test('PR06: concepts are exact M2 mapping references and data rows are registered fixed versions including archived project ownership', async t => {
  const { projects, enterprise, dataContext, lookup } = await fixture(t);
  const concept = await enterprise.create({ title: '已引用定义', body: '前缀：首单按用户确认定义；适用未知。', scope: '合成范围' }), enabled = await enterprise.enable(concept.material.id, concept.material.version), revisionId = enabled.material.activeRevisionId!;
  await enterprise.create({ title: '不能猜作概念', category: '概念', body: '尚未有实际映射引用' });
  const project = await projects.create({ name: '归档登记项目', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  await fs.writeFile(path.join(project.rootPath, '010_draw', 'unregistered.csv'), 'do-not-discover');
  const bytes = Buffer.from('customer\nA\n'), upload = await projects.upload({ projectId: project.id, name: 'orders.csv', bytes, directory: '020_clean' }), versionId = randomUUID(), datasetId = randomUUID();
  const saved = await dataContext.freezeInput(project.id, { operationId: versionId, datasetId, inputVersionId: versionId, baseIndexRevision: 0, name: '登记订单', sourcePath: upload.path, expectedSha256: createHash('sha256').update(bytes).digest('hex'), expectedBytes: bytes.length });
  const descriptionId = randomUUID(), mappingId = randomUUID();
  await dataContext.saveDescription(project.id, { operationId: descriptionId, descriptionRevisionId: descriptionId, datasetId, inputVersionId: versionId, baseIndexRevision: 1, observation: { author: 'unknown', format: 'csv', encoding: null, recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '', generatedAt: null, nativeEvidence: null, artifactEvidence: null }, statements: [], mappings: [{ mappingId, location: { kind: 'csv-column', columnIndex: 0 }, conceptRefs: [{ storeId: concept.storeId, materialId: concept.material.id, revisionId, location: { start: 3, end: 14 } }], sapRefs: [], provenance: 'user-statement', dispute: '', confirmed: false, confirmedAt: null, confirmedBy: null }] });
  await enterprise.disable(concept.material.id, enabled.material.version); await projects.archive(project.id);
  const concepts = await lookup({ category: 'concept' });
  assert.equal(concepts.complete, true); assert.equal(concepts.total, 1); assert.equal(concepts.items[0].title, '已引用定义'); assert.equal(concepts.items[0].status, 'disabled');
  assert.equal(concepts.items[0].bodyPreview, '首单按用户确认定义；适');
  assert.deepEqual(concepts.items[0].conceptUses, [{ projectId: project.id, datasetId, descriptionRevisionId: descriptionId, mappingId }]);
  const data = await lookup({ category: 'data' }); assert.equal(data.total, 1); assert.equal(data.items[0].title, '登记订单'); assert.equal(data.items[0].project?.archived, true);
  assert.equal(data.items[0].data?.sha256, saved.record.sha256); assert.equal(data.items[0].data?.inputVersionId, versionId); assert.equal(data.items[0].bodyPreview, null);
  assert.equal((await lookup({ query: 'do-not-discover', includeBody: true })).total, 0);
});

test('PR05/07: later corrupt source stays attached to readable personal content and a failed source check never becomes a complete no-match result', async t => {
  const { enterprise, personal, lookup } = await fixture(t);
  const source = await enterprise.create({ title: '原始条款', body: '旧合成来源' }), enabledSource = await enterprise.enable(source.material.id, source.material.version), sourceRevision = enabledSource.material.revisions[0];
  const note = await enterprise.create({ title: '独立个人整理', body: '我的完整合成正文' }), enabledNote = await enterprise.enable(note.material.id, note.material.version), noteRevision = enabledNote.material.revisions[0];
  await personal.retain(note.material.id, { operationId: randomUUID(), expectedRevision: 0, target: { type: 'revision', revisionId: noteRevision.revisionId, expectedBodySha256: noteRevision.bodySha256 }, metadata: { kind: 'knowledge', aliases: [], caution: null, sourceRefs: [{ type: 'enterprise', storeId: source.storeId, materialId: source.material.id, revisionId: sourceRevision.revisionId }] }, personalLabel: null });
  await fs.writeFile(sourceRevision.bodyPath, 'damaged');
  const result = await lookup();
  assert.equal(result.total, 1); assert.equal(result.items[0].bodyPreview, '我的完整合成正文'); assert.equal(result.complete, false);
  assert.equal(result.items[0].sourceRefs.length, 1); assert.equal(result.items[0].sourceIssues[0].code, 'enterprise_source_changed');
  const noMatch = await lookup({ query: '并未命中的关键词' }); assert.equal(noMatch.total, 0); assert.equal(noMatch.complete, false); assert.ok(noMatch.issues.length > 0);
});

test('PR07: unavailable Enterprise metadata leaves successful M2 data results as explicitly partial results', async t => {
  const { projects, enterprise, dataContext, lookup } = await fixture(t);
  await enterprise.create({ title: '合成占位', body: '合成正文' });
  const project = await projects.create({ name: '可读取的数据项目', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const bytes = Buffer.from('x\n1\n'), upload = await projects.upload({ projectId: project.id, name: 'x.csv', bytes, directory: '020_clean' }), inputVersionId = randomUUID();
  await dataContext.freezeInput(project.id, { operationId: inputVersionId, inputVersionId, datasetId: randomUUID(), baseIndexRevision: 0, name: '仍可读登记数据', sourcePath: upload.path, expectedSha256: createHash('sha256').update(bytes).digest('hex'), expectedBytes: bytes.length });
  await fs.writeFile(path.join(enterprise.root, 'index.json'), '{broken');
  const result = await lookup();
  assert.equal(result.total, 1); assert.equal(result.items[0].title, '仍可读登记数据'); assert.equal(result.complete, false); assert.ok(result.issues.length > 0);
  const dataOnly = await lookup({ category: 'data' }); assert.equal(dataOnly.total, 1); assert.equal(dataOnly.complete, true);
});

test('PR05/06: an explicit draft lookup reports unusable draft sources before any new retention can succeed', async t => {
  const { enterprise, personal, lookup } = await fixture(t);
  const note = await enterprise.create({ title: '待修正来源的草稿', body: '合成草稿' });
  await personal.saveDraftMeta(note.material.id, { expectedRevision: 0, metadata: { kind: 'experience', aliases: [], caution: null, sourceRefs: [{ type: 'enterprise', storeId: note.storeId, materialId: randomUUID(), revisionId: randomUUID() }] } });
  const result = await lookup({ includeDrafts: true });
  assert.equal(result.total, 1); assert.equal(result.items[0].bodyPreview, '合成草稿'); assert.equal(result.complete, false); assert.equal(result.items[0].sourceIssues.length, 1);
});

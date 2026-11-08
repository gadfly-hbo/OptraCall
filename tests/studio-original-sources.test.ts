import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { SemanticContextService, type SemanticQueryOptions } from '../src/host/semantic-context-service.ts';
import type { SemanticQueryInput, SemanticItem } from '../extensions/business-plugins/semantic-context/types.ts';
import { semanticPage } from '../extensions/business-plugins/semantic-context/reader.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';
import { createStudioOriginalSources } from '../src/host/studio-original-sources.ts';
import { createStudioSources } from '../src/host/studio-sources.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';

const config: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1' };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = path.resolve('.local/studio-phase1/original-sources'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'fixture-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  const project = await projects.create({ name: 'Synthetic original source', configuration: config }), task = await projects.createTask(project.id, { name: 'Studio task', configuration: config });
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects }), enterprise = new EnterpriseMaterialsStore(projects.dataRoot), cases = new CaseStore({ dataRoot: projects.dataRoot });
  const reads: Array<{ projectId: string; taskId: string; input: SemanticQueryInput; options: SemanticQueryOptions }> = [];
  class ObservedReader extends SemanticContextService {
    async query(projectId: string, taskId: string, input: SemanticQueryInput, options: SemanticQueryOptions = {}) { reads.push({ projectId, taskId, input, options }); return super.query(projectId, taskId, input, options); }
  }
  const reader = new ObservedReader({ projects, data, enterprise, cases });
  t.after(async () => { await cases.close(); await projects.close(); });
  return { root, projects, project, task, data, enterprise, cases, reader, reads, sources: createStudioOriginalSources({ reader }) };
}

test('Studio reads exact M2 input pages through the original agent reader without losing UTF-16 boundaries or frozen bytes', async t => {
  const f = await fixture(t), text = '🙂门店,10\n'.repeat(8000), bytes = Buffer.from(text);
  const uploaded = await f.projects.upload({ projectId: f.project.id, name: 'retail.csv', bytes, directory: '020_clean' }), datasetId = randomUUID(), inputVersionId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Retail', sourcePath: uploaded.path, expectedSha256: sha(bytes), expectedBytes: bytes.length });
  const target = { kind: 'data-input', projectId: f.project.id, datasetId, inputVersionId };
  const ref: StudioSourceRef = { authority: 'data', id: datasetId, version: inputVersionId, projectId: f.project.id, taskId: f.task.id, locator: JSON.stringify(target), sha256: sha(bytes) };
  const result = await f.sources.read(ref, f.project.id);
  assert.equal(result.text, text); assert.equal(result.complete, true); assert.equal(result.ref.sha256, sha(bytes));
  assert.ok(f.reads.length > 1);
  assert.ok(f.reads.every(read => read.projectId === f.project.id && read.taskId === f.task.id && read.input.action === 'read' && read.options.audience === 'agent'));
});

test('Studio retains the M2 description record hash and its unverified binding warning rather than hashing pretty JSON as the record', async t => {
  const f = await fixture(t), bytes = Buffer.from('store,refund\nA,2\n'), upload = await f.projects.upload({ projectId: f.project.id, name: 'refund.csv', bytes, directory: '020_clean' });
  const datasetId = randomUUID(), inputVersionId = randomUUID(), descriptionRevisionId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Refund', sourcePath: upload.path, expectedSha256: sha(bytes), expectedBytes: bytes.length });
  const saved = await f.data.saveDescription(f.project.id, { operationId: descriptionRevisionId, datasetId, inputVersionId, descriptionRevisionId, baseIndexRevision: 1,
    observation: { author: 'unknown', format: 'csv', encoding: 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '粒度、单位和退款跨期尚未核实。', generatedAt: null, nativeEvidence: null, artifactEvidence: null }, statements: [], mappings: [] });
  const index = await f.data.getIndex(f.project.id); assert.ok(index); const originalHash = index.datasets[0]!.descriptions[0]!.recordSha256;
  const ref: StudioSourceRef = { authority: 'data', id: datasetId, version: descriptionRevisionId, projectId: f.project.id, sha256: originalHash,
    locator: JSON.stringify({ kind: 'data-description', projectId: f.project.id, datasetId, inputVersionId, descriptionRevisionId }) };
  const result = await f.sources.read(ref, f.project.id, f.task.id);
  assert.equal(result.text, JSON.stringify(await f.data.readDescription(f.project.id, datasetId, descriptionRevisionId), null, 2));
  assert.deepEqual(JSON.parse(result.text), saved.record);
  assert.equal(result.ref.sha256, originalHash); assert.notEqual(sha(result.text), originalHash);
  assert.ok(result.governance?.gaps.includes('binding-grain-keys-units-timezones-not-automatically-verified'));
});

test('Studio preserves exact old Case decision and human choice identities, current archived governance and complete original metadata fragments', async t => {
  const f = await fixture(t); await f.cases.initialize();
  const core = f.cases.createCase({ operationId: randomUUID(), title: '门店退款 Case' }), caseStoreId = f.cases.getStatus().storeId!;
  f.cases.linkProject({ operationId: randomUUID(), caseId: core.id, projectId: f.project.id, expectedRevision: 1 });
  const origin = { actorKind: 'agent' as const, projectId: f.project.id, taskId: f.task.id, requestId: randomUUID(), sessionId: 'synthetic', toolCallId: 'call' };
  const hypothesis = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: core.id, expectedRevision: 0, kind: 'hypothesis', payload: { title: '合成假设', statement: '退款归属仍需验证。' } }, origin);
  const target = { type: 'case-decision' as const, caseStoreId, caseId: core.id, recordId: hypothesis.recordId, revision: 1 };
  const strategy = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: core.id, expectedRevision: 0, kind: 'strategy', payload: { title: '先核原销售门店', proposal: '调取准确退款归属。' }, references: [
    { relation: 'background', target, note: '🙂历史上下文'.repeat(1500) }, { relation: 'limits', target, note: '🙂尚未实证'.repeat(1500) },
  ] }, origin);
  const choice = f.cases.chooseStrategy({ operationId: randomUUID(), caseStoreId, caseId: core.id, strategyRef: { type: 'case-decision', caseStoreId, caseId: core.id, recordId: strategy.recordId, revision: 1 }, choice: 'gather_evidence', reason: '先验证，不代表已经实施。', expectedPreviousChoiceId: null });
  f.cases.reviseDecisionByUser({ operationId: randomUUID(), caseStoreId, caseId: core.id, recordId: strategy.recordId, expectedRevision: 1, action: 'archive' });
  const body = JSON.stringify(f.cases.getDecision(core.id, strategy.recordId, 1), null, 2);
  const ref: StudioSourceRef = { authority: 'case', id: strategy.recordId, version: '1', sha256: sha(body), locator: JSON.stringify({ kind: 'case-decision', caseStoreId, caseId: core.id, recordId: strategy.recordId, revision: 1 }) };
  const result = await f.sources.read(ref, f.project.id, f.task.id);
  assert.equal(result.text, body); assert.equal(result.complete, true);
  assert.equal(result.governance?.original?.lifecycle, 'archived'); assert.equal(result.governance?.original?.currentRevision, 2);
  assert.ok(f.reads.length > 1);
  const choiceBody = JSON.stringify(f.cases.getStrategyChoice(core.id, choice.choiceId), null, 2);
  const selected = await f.sources.read({ authority: 'case', id: choice.choiceId, version: '1', locator: JSON.stringify({ kind: 'case-choice', caseStoreId, caseId: core.id, choiceId: choice.choiceId }) }, f.project.id, f.task.id);
  assert.equal(selected.text, choiceBody); assert.equal(selected.ref.sha256, sha(choiceBody));
  assert.ok(selected.governance?.gaps.includes('human-choice-does-not-prove-execution-or-effect'));
  const usingProject = await f.projects.create({ name: 'Another authorized Case reader', configuration: config }), usingTask = await f.projects.createTask(usingProject.id, { name: 'Actual caller', configuration: config });
  const shared = await f.sources.read({ ...ref, projectId: f.project.id, taskId: f.task.id }, usingProject.id, usingTask.id);
  assert.equal(shared.text, body, 'global Case identity is read through the actual caller project/task');
  assert.equal(shared.ref.projectId, f.project.id, 'retained source context is not rewritten as source ownership');
  assert.ok(f.reads.slice(-1).every(read => read.projectId === usingProject.id && read.taskId === usingTask.id));
});

test('Studio refuses mismatched locator identities and cross-project M2 refs before invoking the original reader', async () => {
  let calls = 0;
  const sources = createStudioOriginalSources({ reader: { query: async () => { calls++; throw new Error('unexpected_read'); } } as unknown as SemanticContextService });
  const target = { kind: 'data-input', projectId: 'own', datasetId: 'dataset', inputVersionId: 'v1' };
  const ref: StudioSourceRef = { authority: 'data', id: 'dataset', version: 'v1', projectId: 'own', taskId: 'task', locator: JSON.stringify(target) };
  for (const changed of [
    { ...ref, projectId: 'other' }, { ...ref, locator: JSON.stringify({ ...target, projectId: 'other' }) }, { ...ref, id: 'another' }, { ...ref, version: 'v2' }, { ...ref, authority: 'case' as const },
    { ...ref, locator: JSON.stringify({ ...target, path: '/private/not-an-exact-target' }) }, { ...ref, locator: '/private/arbitrary' },
    { authority: 'case' as const, id: 'decision', version: '2', locator: JSON.stringify({ kind: 'case-decision', caseStoreId: 'store', caseId: 'case', recordId: 'decision', revision: 1 }) },
    { authority: 'case' as const, id: 'choice', version: '2', locator: JSON.stringify({ kind: 'case-choice', caseStoreId: 'store', caseId: 'case', choiceId: 'choice' }) },
  ]) await assert.rejects(sources.read(changed, 'own'));
  await assert.rejects(sources.read({ ...ref, taskId: undefined }, 'own'), { code: 'studio_source_task_required' });
  assert.equal(calls, 0);
});

test('Studio refuses an unknown exact input or original hash conflict and never substitutes another saved version', async t => {
  const f = await fixture(t), bytes = Buffer.from('store,10\n'), upload = await f.projects.upload({ projectId: f.project.id, name: 'retail.csv', bytes, directory: '020_clean' });
  const datasetId = randomUUID(), inputVersionId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Retail', sourcePath: upload.path, expectedSha256: sha(bytes), expectedBytes: bytes.length });
  const target = { kind: 'data-input', projectId: f.project.id, datasetId, inputVersionId }, base: StudioSourceRef = { authority: 'data', id: datasetId, version: inputVersionId, projectId: f.project.id, locator: JSON.stringify(target) };
  await assert.rejects(f.sources.read({ ...base, sha256: 'a'.repeat(64) }, f.project.id, f.task.id), { code: 'studio_source_changed' });
  const missing = randomUUID();
  await assert.rejects(f.sources.read({ ...base, version: missing, locator: JSON.stringify({ ...target, inputVersionId: missing }) }, f.project.id, f.task.id), { code: 'studio_source_unavailable' });
  await assert.rejects(f.sources.read(base, f.project.id, randomUUID()), { code: 'task_not_found' });
});

test('Studio explicitly refuses a source above 512KB instead of returning a silently truncated body', async t => {
  const f = await fixture(t), bytes = Buffer.from('a'.repeat(512 * 1024 + 1)), upload = await f.projects.upload({ projectId: f.project.id, name: 'oversize.csv', bytes, directory: '020_clean' });
  const datasetId = randomUUID(), inputVersionId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Oversize', sourcePath: upload.path, expectedSha256: sha(bytes), expectedBytes: bytes.length });
  const ref: StudioSourceRef = { authority: 'data', id: datasetId, version: inputVersionId, projectId: f.project.id, locator: JSON.stringify({ kind: 'data-input', projectId: f.project.id, datasetId, inputVersionId }) };
  await assert.rejects(f.sources.read(ref, f.project.id, f.task.id), { code: 'studio_source_too_large' });
  assert.equal(f.reads.length, 1);
});

test('Studio rejects changing hashes, broken ranges, unavailable states and incomplete transport rather than presenting a complete source', async () => {
  const target = { kind: 'data-description' as const, projectId: 'own', datasetId: 'dataset', inputVersionId: 'input', descriptionRevisionId: 'description' };
  const ref: StudioSourceRef = { authority: 'data', id: 'dataset', version: 'description', projectId: 'own', taskId: 'task', locator: JSON.stringify(target), sha256: 'a'.repeat(64) };
  const item: SemanticItem = { target, title: 'Source', body: '🙂'.repeat(12000), sha256: ref.sha256!, range: null, state: 'available', recordedAt: null, businessTime: [], governance: null, declaration: null, relations: [], gaps: [] };
  for (const defect of ['hash', 'range', 'unknown', 'page-forbidden', 'incomplete'] as const) {
    const sources = createStudioOriginalSources({ reader: { query: async (_project: string, _task: string, input: SemanticQueryInput) => {
      const page = semanticPage(input, [item], { identity: 'same-source', version: 'same-revision' }, 1);
      if (defect === 'hash' && input.continuation) page.items[0]!.sha256 = 'b'.repeat(64);
      if (defect === 'range' && input.continuation) page.items[0]!.range!.start = 0;
      if (defect === 'unknown') page.items[0]!.state = 'unknown';
      if (defect === 'page-forbidden') page.state = 'forbidden';
      if (defect === 'incomplete') page.coverage.continuation = null;
      return page;
    } } as unknown as SemanticContextService });
    await assert.rejects(sources.read(ref, 'own'), { code: defect === 'hash' ? 'studio_source_changed' : defect === 'range' ? 'studio_source_fragment_invalid' : defect === 'unknown' || defect === 'page-forbidden' ? 'studio_source_unavailable' : 'studio_source_incomplete' });
  }
});

test('the actual Studio source bridge qualifies Case and M2 dependencies in their original authorities without granting another project raw M2 bodies', async t => {
  const f = await fixture(t), studio = new StudioStore(f.projects.dataRoot);
  const bytes = Buffer.from('store,PRIVATE_SYNTHETIC_CONSTRUCTION_INPUT\nA,10\n'), upload = await f.projects.upload({ projectId: f.project.id, name: 'construction.csv', bytes, directory: '020_clean' });
  const datasetId = randomUUID(), inputVersionId = randomUUID(), descriptionRevisionId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Construction input', sourcePath: upload.path, expectedSha256: sha(bytes), expectedBytes: bytes.length });
  await f.data.saveDescription(f.project.id, { operationId: descriptionRevisionId, descriptionRevisionId, datasetId, inputVersionId, baseIndexRevision: 1,
    observation: { author: 'unknown', format: 'csv', encoding: 'UTF-8', recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: '粒度和跨期尚未验证。', generatedAt: null, nativeEvidence: null, artifactEvidence: null }, statements: [], mappings: [] });
  const index = await f.data.getIndex(f.project.id); assert.ok(index);
  const inputRef: StudioSourceRef = { authority: 'data', id: datasetId, version: inputVersionId, projectId: f.project.id, sha256: sha(bytes), locator: JSON.stringify({ kind: 'data-input', projectId: f.project.id, datasetId, inputVersionId }) };
  const descriptionRef: StudioSourceRef = { authority: 'data', id: datasetId, version: descriptionRevisionId, projectId: f.project.id, sha256: index.datasets[0]!.descriptions[0]!.recordSha256, locator: JSON.stringify({ kind: 'data-description', projectId: f.project.id, datasetId, inputVersionId, descriptionRevisionId }) };
  await f.cases.initialize(); const core = f.cases.createCase({ operationId: randomUUID(), title: '原Case关联' }), caseStoreId = f.cases.getStatus().storeId!;
  f.cases.linkProject({ operationId: randomUUID(), caseId: core.id, projectId: f.project.id, expectedRevision: 1 });
  const decision = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: core.id, expectedRevision: 0, kind: 'hypothesis', payload: { title: '仍需验证', statement: '这是原Case判断，不证明结论已成立。' } }, { actorKind: 'agent', projectId: f.project.id, taskId: f.task.id, requestId: randomUUID(), sessionId: 'synthetic', toolCallId: 'call' });
  const caseBody = JSON.stringify(f.cases.getDecision(core.id, decision.recordId, 1), null, 2), caseRef: StudioSourceRef = { authority: 'case', id: decision.recordId, version: '1', projectId: f.project.id, taskId: f.task.id, sha256: sha(caseBody), locator: JSON.stringify({ kind: 'case-decision', caseStoreId, caseId: core.id, recordId: decision.recordId, revision: 1 }) };
  const dependencies = { dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterprise, studio };
  await assert.rejects(createStudioSources(dependencies).read(caseRef, f.project.id), { code: 'studio_source_unsupported' });
  const combined = createStudioSources({ ...dependencies, readOriginal: f.sources.read });
  const system = studio.create({ name: '原来源桥接体系', projectId: f.project.id, taskId: f.task.id, topicTitle: '退款归属', goal: '复用原Case和M2准确来源' });
  assert.equal((await combined.read(inputRef, f.project.id, system.id)).text, bytes.toString());
  assert.deepEqual(JSON.parse((await combined.read(descriptionRef, f.project.id, system.id)).text), await f.data.readDescription(f.project.id, datasetId, descriptionRevisionId));
  assert.equal((await combined.read(caseRef, f.project.id, system.id)).text, caseBody);
  const asset = studio.saveAsset(system.id, { kind: 'binding', title: '派生绑定', body: '正式绑定仅保留已声明规则，不包含原输入正文。', scope: '合成范围', sources: [descriptionRef, caseRef], dependencies: [inputRef], readyForPublication: true });
  const assetRef: StudioSourceRef = { authority: 'studio-source', id: asset.id, version: '1', projectId: f.project.id, sha256: asset.revisions[0]!.sha256 };
  await combined.validate(assetRef, f.project.id, system.id, { construction: true });
  const preview = studio.preparePublication(system.id, { assetIds: [asset.id], summary: '复用准确原来源', scope: '合成范围' }); studio.confirmPublication(system.id, preview.id, preview.fingerprint);
  const usingProject = await f.projects.create({ name: '普通分析使用项目', configuration: config }), usingTask = await f.projects.createTask(usingProject.id, { name: '普通分析', configuration: config });
  const formal = await combined.read(assetRef, usingProject.id, system.id, { taskId: usingTask.id });
  assert.equal(formal.text, asset.revisions[0]!.body); assert.equal(formal.text.includes('PRIVATE_SYNTHETIC_CONSTRUCTION_INPUT'), false);
  assert.equal((await combined.read(caseRef, usingProject.id, system.id, { taskId: usingTask.id })).text, caseBody);
  await assert.rejects(combined.read(inputRef, usingProject.id, system.id, { taskId: usingTask.id }), { code: 'studio_source_project_mismatch' });
  await assert.rejects(combined.read(descriptionRef, usingProject.id, system.id, { taskId: usingTask.id }), { code: 'studio_source_project_mismatch' });
  const wrong = studio.saveAsset(system.id, { kind: 'binding', title: '错误原摘要候选', body: '不得发布', scope: '合成范围', sources: [{ ...descriptionRef, sha256: 'b'.repeat(64) }], readyForPublication: true });
  await assert.rejects(combined.validate({ authority: 'studio-source', id: wrong.id, version: '1', projectId: f.project.id }, f.project.id, system.id, { construction: true }), { code: 'studio_source_changed' });
});

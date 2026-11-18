import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { semanticRecordsForAssistant } from '../src/host/ui/semantic-context-history.ts';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { SemanticContextService } from '../src/host/semantic-context-service.ts';
import type { SemanticTarget } from '../extensions/business-plugins/semantic-context/types.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { createStudioSources } from '../src/host/studio-sources.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

const config: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic only', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = path.resolve('.local/studio-phase2-implementation/consumption/fixtures'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'scope-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  const project = await projects.create({ name: 'Enterprise A task', configuration: config }), task = await projects.createTask(project.id, { name: 'Ordinary analysis' });
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const enterprise = new EnterpriseMaterialsStore(projects.dataRoot), cases = new CaseStore({ dataRoot: projects.dataRoot });
  const metricLibrary = createMetricLibrary(path.join(projects.dataRoot, 'metric-assets')), methodLibrary = createSapMethodStore(path.join(projects.dataRoot, 'metric-assets'));
  const raw = await readFile('extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', 'utf8');
  const metrics = ['approved-a', 'other-b'].map(id => metricLibrary.publish(preparePublication(Buffer.from(raw.replaceAll('membership-repurchase', id))), 'Synthetic publisher'));
  const materials: (Awaited<ReturnType<typeof enterprise.enable>> & { id: string })[] = [];
  for (const name of ['A', 'B']) {
    const created = await enterprise.create({ title: `Enterprise ${name} rule`, body: `ONLY_${name}_BODY` });
    const enabled = await enterprise.enable(created.material.id, created.material.version);
    materials.push({ ...enabled, id: created.material.id });
  }
  const methods: Awaited<ReturnType<typeof methodLibrary.save>>[] = [];
  for (const name of ['A', 'B']) {
    const saved = await methodLibrary.save({ requestId: randomUUID(), origin: 'other', title: `Enterprise ${name} method`, sources: [], content: { conditions: 'Synthetic cohort', logic: `ONLY_${name}_METHOD`, judgment: 'Check input', limits: 'Not causation' } });
    await methodLibrary.publish(saved.method.id, { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 }); methods.push(saved);
  }
  const allowed = (_projectId: string, target: SemanticTarget) => target.kind === 'sap' ? target.packageId === metrics[0]!.id : target.kind === 'enterprise' ? target.materialId === materials[0]!.id : target.kind === 'sap-method' ? target.methodId === methods[0]!.method.id : true;
  const options = { projects, data, enterprise, cases, metricLibrary, methodLibrary, sourceAllowed: allowed };
  const service = new SemanticContextService(options);
  t.after(async () => { await projects.close(); });
  return { root, projects, project, task, data, enterprise, cases, metricLibrary, methodLibrary, metrics, materials, methods, options, service };
}

test('SU02/03/16: the ordinary semantic directory and exact reads use the same enterprise source qualification', async t => {
  const f = await fixture(t);
  const found = await f.service.query(f.project.id, f.task.id, { action: 'find', kinds: ['sap', 'sap-method', 'enterprise'] }, { audience: 'agent' });
  assert.ok(found.items.some(item => item.target.kind === 'sap' && item.target.packageId === 'approved-a'));
  assert.ok(found.items.some(item => item.target.kind === 'enterprise' && item.target.materialId === f.materials[0]!.id));
  assert.ok(found.items.some(item => item.target.kind === 'sap-method' && item.target.methodId === f.methods[0]!.method.id));
  assert.doesNotMatch(JSON.stringify(found), /other-b|Enterprise B|ONLY_B/);
  const foreign: SemanticTarget[] = [
    { kind: 'sap', packageId: f.metrics[1]!.id, version: f.metrics[1]!.version },
    { kind: 'sap-method', methodId: f.methods[1]!.method.id, version: 1 },
    { kind: 'enterprise', storeId: f.materials[1]!.storeId, materialId: f.materials[1]!.id, revisionId: f.materials[1]!.material.activeRevisionId! },
  ];
  for (const target of foreign) for (const action of ['read', 'trace'] as const)
    await assert.rejects(() => f.service.query(f.project.id, f.task.id, { action, target }, { audience: 'agent' }), /semantic_context_source_forbidden/);
});

test('SU10/22: stopped enterprise sources do not return a new Agent body and the previously returned exact evidence stays unchanged', async t => {
  const f = await fixture(t), material = f.materials[0]!;
  const target: SemanticTarget = { kind: 'enterprise', storeId: material.storeId, materialId: material.id, revisionId: material.material.activeRevisionId! };
  const original = await f.service.query(f.project.id, f.task.id, { action: 'read', target }, { audience: 'agent' });
  const before = JSON.stringify(original); assert.match(before, /ONLY_A_BODY/);
  await f.enterprise.disable(material.id, material.material.version);
  const next = await f.service.query(f.project.id, f.task.id, { action: 'read', target }, { audience: 'agent' });
  assert.equal(next.items[0]?.state, 'disabled'); assert.equal(next.items[0]?.body, null); assert.equal(next.items[0]?.title, null);
  const catalog = await f.service.query(f.project.id, f.task.id, { action: 'find', kinds: ['enterprise'] }, { audience: 'agent' });
  assert.ok(!catalog.items.some(item => item.target.kind === 'enterprise' && item.target.materialId === material.id));
  assert.equal(JSON.stringify(original), before, 'new current qualification cannot rewrite an old actual tool result');
});

test('SU10/22: confirmed incorrect methods are not current Agent evidence or directory recommendations', async t => {
  const f = await fixture(t), method = f.methods[0]!;
  await f.methodLibrary.markIssue(method.method.id, { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: 'Synthetic known defect' });
  const next = await f.service.query(f.project.id, f.task.id, { action: 'read', target: { kind: 'sap-method', methodId: method.method.id, version: 1 } }, { audience: 'agent' });
  assert.equal(next.items[0]?.state, 'disabled'); assert.equal(next.items[0]?.body, null); assert.equal(next.items[0]?.title, null);
  const catalog = await f.service.query(f.project.id, f.task.id, { action: 'find', kinds: ['sap-method'] }, { audience: 'agent' });
  assert.ok(!catalog.items.some(item => item.target.kind === 'sap-method' && item.target.methodId === method.method.id));
});


test('SU03/16: qualified enterprise metrics are readable without repeated project enablement, while scope and hashes remain authoritative', async t => {
  const f = await fixture(t), published = f.metrics[0]!;
  const enterpriseScope = { enterpriseIdForProject: (projectId: string) => projectId === f.project.id ? 'enterprise-a' : undefined,
    sourceAllowed: (projectId: string, ref: { id: string }) => projectId === f.project.id && ref.id === published.id };
  const sources = createStudioSources({ dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterprise, studio: new StudioStore(f.projects.dataRoot), enterpriseScope });
  const ref = { authority: 'sap-metric' as const, id: published.id, version: published.version, sha256: published.bytesSha256 };
  const read = await sources.read(ref, f.project.id);
  assert.match(read.text, /approved-a/); assert.equal(read.ref.sha256, published.bytesSha256);
  await assert.rejects(() => sources.read({ ...ref, sha256: '0'.repeat(64) }, f.project.id), /studio_source_changed/);
  await assert.rejects(() => sources.read({ ...ref, id: f.metrics[1]!.id, sha256: f.metrics[1]!.bytesSha256 }, f.project.id), /studio_source_scope_forbidden/);
  const unassigned = createStudioSources({ dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterprise, studio: new StudioStore(f.projects.dataRoot), enterpriseScope: { enterpriseIdForProject: () => undefined, sourceAllowed: () => true } });
  await assert.rejects(() => unassigned.read(ref, f.project.id), /studio_source_not_adopted/);
  const deniedUnassigned = createStudioSources({ dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterprise, studio: new StudioStore(f.projects.dataRoot), enterpriseScope: { enterpriseIdForProject: () => undefined, sourceAllowed: () => false } });
  await assert.rejects(() => deniedUnassigned.read(ref, f.project.id), /studio_source_scope_unassigned/);
});

test('SU02/16: construction material discovery does not list another enterprise or unassigned source metadata', async t => {
  const f = await fixture(t);
  const deps = { dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterprise, studio: new StudioStore(f.projects.dataRoot), enterpriseScope: {
    enterpriseIdForProject: () => 'enterprise-a', sourceAllowed: (_projectId: string, ref: { id: string }) => ref.id === f.materials[0]!.id,
  } };
  const sources = createStudioSources(deps), materials = await sources.inventory(f.project.id);
  assert.equal(materials.length, 1); assert.equal(materials[0]?.ref.id, f.materials[0]!.id);
  assert.doesNotMatch(JSON.stringify(materials), /Enterprise B/);
});


test('SU21: native Studio directory, partial source and use declaration remain separate evidence facts', () => {
  const ref = { authority: 'sap-metric', id: 'approved-a', version: '1.2', sha256: 'a'.repeat(64) };
  const calls = [{ action: 'catalog' }, { action: 'read-source', systemId: 'saved-system', payload: { ref } }, { action: 'declare-use', systemId: 'saved-system', payload: {} }];
  const results = [{ systems: [{ id: 'saved-system', name: 'Approved assets' }] }, { ref, text: 'EXACT_PARTIAL_BODY', complete: false, range: { start: 0, end: 18, total: 100 }, continuation: { start: 18 } }, { use: { id: 'use-1', projectId: 'project-a', taskId: 'task-a', sources: [ref], verification: 'not_assessed' }, claim: 'author-declaration-not-professional-verification' }];
  const messages: Record<string, any>[] = [{ role: 'user', content: 'An ordinary question.' },
    { role: 'assistant', content: calls.map((arguments_, index) => ({ type: 'toolCall', id: `call-${index}`, name: 'studio_assets', arguments: arguments_ })) },
    ...results.map((result, index) => ({ role: 'toolResult', toolName: 'studio_assets', toolCallId: `call-${index}`, entryId: `entry-${index}`, details: { type: 'optracall.studio', action: calls[index]!.action, result }, content: [{ type: 'text', text: JSON.stringify(result) }] })),
    { role: 'assistant', content: 'The partial source cannot establish the full rule.' }];
  const before = JSON.stringify(messages), rows: Record<string, any>[] = semanticRecordsForAssistant(messages, 5, 'native-session', { projectId: 'project-a', taskId: 'task-a' });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.studio.stage), ['directory', 'source', 'declaration']);
  assert.equal(rows[1]!.studio.complete, false); assert.equal(rows[1]!.studio.body, 'EXACT_PARTIAL_BODY');
  assert.deepEqual(rows[1]!.studio.ref, ref); assert.equal(rows[2]!.studio.declaration, true);
  assert.equal(rows[2]!.studio.independentVerification, undefined, 'an author declaration must not fabricate independent verification');
  assert.equal(JSON.stringify(messages), before, 'passive evidence projection never alters original native messages');
  const nested = [messages[0]!, { role: 'toolResult', toolName: 'codemode', entryId: 'parent', content: [{ type: 'text', text: JSON.stringify(results[1]) }], nestedCalls: { calls: [{ name: 'studio_assets', status: 'ok', arguments: calls[1] }] } }, messages[5]!];
  const nestedRows: Record<string, any>[] = semanticRecordsForAssistant(nested, 2, 'native-session');
  assert.equal(nestedRows.length, 1); assert.match(nestedRows[0]!.issue, /UNKNOWN/); assert.equal(nestedRows[0]!.studio, undefined);
});

test('SU02 compatibility: an inactive enterprise layer and explicit legacy association preserve original reads without minting default qualification', async t => {
  const f = await fixture(t), material = f.materials[0]!, metric = f.metrics[0]!;
  const base = { dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterprise, studio: new StudioStore(f.projects.dataRoot) };
  const ref = { authority: 'enterprise' as const, id: material.id, version: material.material.activeRevisionId! };
  const inactive = createStudioSources({ ...base, enterpriseScope: { active: () => false, enterpriseIdForProject: () => undefined, sourceAllowed: () => { assert.fail('An inactive enterprise layer must not change legacy source checks.'); } } });
  assert.equal((await inactive.read(ref, f.project.id)).text, 'ONLY_A_BODY');
  const legacy = createStudioSources({ ...base, enterpriseScope: { active: () => true, enterpriseIdForProject: () => undefined, sourceAllowed: () => true } });
  assert.equal((await legacy.read(ref, f.project.id)).text, 'ONLY_A_BODY');
  await assert.rejects(() => legacy.read({ authority: 'sap-metric', id: metric.id, version: metric.version, sha256: metric.bytesSha256 }, f.project.id), /studio_source_not_adopted/);
});


test('SU11: a new maintenance owner reads its registered candidate and original semantic evidence without gaining old raw files', async t => {
  const f = await fixture(t), store = new StudioStore(f.projects.dataRoot);
  const system = store.create({ name: 'Enterprise foundation', projectId: f.project.id, taskId: f.task.id, topicTitle: 'Original rules', goal: 'Maintain accurate sources' });
  const file = await f.projects.upload({ projectId: f.project.id, name: 'original.csv', directory: '020_clean', bytes: Buffer.from('amount\nPRIVATE_ORIGINAL_RAW\n') });
  const dataRef = { authority: 'data' as const, id: createHash('sha256').update(file.path).digest('hex'), version: file.sha256, sha256: file.sha256, projectId: f.project.id, locator: file.path };
  const asset = store.saveAsset(system.id, { kind: 'rule', title: 'Original rule', body: 'ORIGINAL_ACCURATE_RULE', scope: 'Synthetic only', sources: [dataRef], readyForPublication: true });
  const preview = store.preparePublication(system.id, { assetIds: [asset.id], summary: 'Exact rule', scope: 'Synthetic' }); store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const oldAsset = JSON.stringify(store.get(system.id).assets);
  const next = await f.projects.create({ name: 'New authorized maintenance', configuration: config }), nextTask = await f.projects.createTask(next.id, { name: 'Continue same foundation' });
  await f.projects.archive(f.project.id);
  store.resumeMaintenance(system.id, { projectId: next.id, taskId: nextTask.id, expectedRevision: store.get(system.id).revision });
  const raw = await readFile('extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml');
  const candidatePath = '020_clean/candidate.yaml'; await writeFile(path.join(next.rootPath, candidatePath), raw);
  const candidate = preparePublication(raw);
  const candidateRef = { authority: 'sap-metric' as const, id: candidate.document.package.id, version: candidate.document.package.version, sha256: candidate.bytesSha256, projectId: next.id, locator: candidatePath };
  store.addAssetRef(system.id, candidateRef);
  const sources = createStudioSources({ dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterprise, studio: store });
  assert.equal((await sources.read(candidateRef, next.id, system.id, { construction: true, taskId: nextTask.id })).text, candidate.canonicalYaml);
  const original = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0]!.sha256, projectId: f.project.id, locator: system.id };
  const read = await sources.read(original, next.id, system.id, { construction: true, taskId: nextTask.id });
  assert.equal(read.text, 'ORIGINAL_ACCURATE_RULE'); assert.equal(read.ref.projectId, f.project.id);
  await assert.rejects(() => sources.read(dataRef, next.id, system.id, { construction: true, taskId: nextTask.id }), /studio_source_project_mismatch/);
  await assert.rejects(() => sources.read(candidateRef, f.project.id, system.id, { construction: true, taskId: f.task.id }), /studio_source_construction_mismatch/);
  assert.equal(JSON.stringify(store.get(system.id).assets), oldAsset);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { createStudioSources } from '../src/host/studio-sources.ts';

async function portFixture(t: { after(fn: () => Promise<void>): void }) {
  const base = path.resolve('.local/studio-phase2-implementation/host/fixtures'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'port-')), dataRoot = path.join(root, 'data');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
  const project = await projects.create({ name: 'A ordinary', configuration }), task = await projects.createTask(project.id, { name: 'Analysis' });
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot);
  const studio = createStudioFeature({ dataRoot, projects, enterpriseMaterials, readBody: async () => ({}), mutate: async operation => operation(), running: () => false, closing: () => false, readTaskReply: async (_project, _task, selection) => { if (selection.sessionId !== 'native-session' || selection.messageId !== 'native-message') throw new Error('missing_native_reply'); return { text: 'ACTUAL_NATIVE_REPORT' }; } });
  const a = studio.enterpriseScopes.create({ name: 'A' }), b = studio.enterpriseScopes.create({ name: 'B' }); studio.enterpriseScopes.associateProject(project.id, a.id);
  const context = { requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), signal: new AbortController().signal, assertCurrent() {} };
  t.after(async () => { await projects.close(); });
  return { projects, enterpriseMaterials, studio, project, task, configuration, a, b, context };
}

async function json(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

test('SU02: opening enterprise scope is read-only and leaves historical projects unassigned', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const projects = await json(await host.request('/api/projects'));
  assert.deepEqual(await json(await host.request('/api/studio/enterprises')), {
    enterprises: [], projectAssignments: [], caseAssignments: [], assetAssignments: [],
  });
  assert.deepEqual(await json(await host.request('/api/projects')), projects);
});

test('SU02: enterprise creation preserves old unassigned projects and retries the same creation receipt', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Scope test', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-scope', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Historical unassigned project' }), 201);
  const input = { name: '合成服饰企业 A', requestId: randomUUID() };
  const enterprise = await json(await host.request('/api/studio/enterprises', 'POST', input), 201);
  assert.equal(enterprise.name, input.name);
  assert.equal(typeof enterprise.id, 'string');
  const scope = await json(await host.request('/api/studio/enterprises'));
  assert.deepEqual(scope.enterprises, [enterprise]);
  assert.deepEqual(scope.projectAssignments, [], 'Opening or creating an enterprise must not claim historical projects.');
  assert.deepEqual(await json(await host.request('/api/studio/enterprises', 'POST', input), 201), enterprise);
  await json(await host.request('/api/studio/enterprises', 'POST', { ...input, name: 'Different enterprise intent' }), 409);
  assert.equal((await json(await host.request(`/api/projects/${project.id}`))).project.id, project.id);
});

test('SU02/13: only an existing project can be explicitly assigned and enterprise ownership cannot silently move', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Scope assignment', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-scope', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Unassigned project' }), 201);
  const first = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201);
  const second = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  const input = { kind: 'project', entityId: project.id, enterpriseId: first.id, requestId: randomUUID() };
  const binding = await json(await host.request('/api/studio/enterprise-associations', 'POST', input));
  assert.deepEqual(binding, { projectId: project.id, enterpriseId: first.id });
  assert.deepEqual(await json(await host.request('/api/studio/enterprise-associations', 'POST', input)), binding);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { ...input, requestId: randomUUID(), enterpriseId: second.id }), 409);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { ...input, requestId: randomUUID(), entityId: randomUUID() }), 404);
  assert.deepEqual((await json(await host.request('/api/studio/enterprises'))).projectAssignments, [binding]);
});

test('SU01/02/04: native enterprise materials enter only their explicitly assigned foundation and retain original bytes', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const first = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201);
  const second = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  const original = await json(await host.request('/api/enterprise-materials', 'POST', { title: '获准制度原文', body: '合成原文保留，不将归属关联改为新正文。' }), 201);
  const route = `/api/studio/foundation?enterpriseId=${first.id}`;
  const before = await json(await host.request(route));
  assert.ok(before.unassigned.some((item: any) => item.authority === 'enterprise' && item.id === original.material.id));
  assert.ok(!before.items.some((item: any) => item.id === original.material.id));
  const input = { kind: 'asset', authority: 'enterprise', entityId: original.material.id, enterpriseId: first.id, requestId: randomUUID() };
  await json(await host.request('/api/studio/enterprise-associations', 'POST', input));
  const after = await json(await host.request(route));
  assert.ok(after.items.some((item: any) => item.authority === 'enterprise' && item.id === original.material.id));
  assert.ok(!after.unassigned.some((item: any) => item.id === original.material.id));
  const other = await json(await host.request(`/api/studio/foundation?enterpriseId=${second.id}`));
  assert.ok(![...other.items, ...other.unassigned].some((item: any) => item.id === original.material.id));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { ...input, requestId: randomUUID(), enterpriseId: second.id }), 409);
  assert.deepEqual(await json(await host.request(`/api/enterprise-materials/${original.material.id}`)), original);
});

test('SU02/06: a construction task belongs to its enterprise and cannot claim another enterprise project', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Scoped construction', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-scope', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Construction workspace' }), 201);
  const first = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201);
  const second = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  const input = { requestId: randomUUID(), enterpriseId: first.id, projectId: project.id, name: '企业基础建设', goal: '按获准资料建设共享资产', topicTitle: '通用建设' };
  const { system } = await json(await host.request('/api/studio/systems', 'POST', input), 201);
  assert.equal(system.enterpriseId, first.id);
  assert.equal((await json(await host.request('/api/studio/enterprises'))).projectAssignments.find((item: any) => item.projectId === project.id)?.enterpriseId, first.id);
  const before = (await json(await host.request(`/api/projects/${project.id}`))).project.tasks.length;
  await json(await host.request('/api/studio/systems', 'POST', { ...input, requestId: randomUUID(), enterpriseId: second.id }), 409);
  assert.equal((await json(await host.request(`/api/projects/${project.id}`))).project.tasks.length, before, 'A conflicting enterprise must not create another task.');
});

test('SU02/13: Case and SAP associations validate the original object and current version before metadata is saved', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201);
  const b = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  await json(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: record } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '原Case保留' }), 201);
  const assign = (body: object, status = 200) => host.request('/api/studio/enterprise-associations', 'POST', { requestId: randomUUID(), enterpriseId: a.id, ...body }).then(response => json(response, status));
  await assign({ kind: 'case', entityId: record.id, expectedRevision: record.revision + 1 }, 409);
  assert.deepEqual(await assign({ kind: 'case', entityId: record.id, expectedRevision: record.revision }), { caseId: record.id, enterpriseId: a.id });
  await assign({ kind: 'case', entityId: record.id, enterpriseId: b.id }, 409);
  await assign({ kind: 'case', entityId: randomUUID() }, 404);
  const method = await json(await host.request('/api/sap/methods', 'POST', { requestId: randomUUID(), title: '原方法', content: { conditions: '合成', logic: '核对窗口', judgment: '', limits: '' }, sources: [] }), 201);
  await assign({ kind: 'asset', authority: 'sap-method', entityId: method.method.id, expectedRevision: 2 }, 409);
  await assign({ kind: 'asset', authority: 'sap-method', entityId: method.method.id, expectedRevision: 1 });
  await assign({ kind: 'asset', authority: 'sap-method', entityId: method.method.id, enterpriseId: b.id }, 409);
  await assign({ kind: 'asset', authority: 'sap-method', entityId: randomUUID() }, 404);
  await assign({ kind: 'asset', authority: 'sap-metric', entityId: 'invented-package' }, 404);
  assert.deepEqual((await json(await host.request(`/api/cases/${record.id}`))).case, record, 'Metadata association must not revise the original Case.');
  assert.deepEqual((await json(await host.request(`/api/sap/methods/${method.method.id}/versions/1`))).method.versions[0], method.version);
});

test('SU03/16/24: ordinary Studio catalog and exact native reads share enterprise scope without requiring a system', async t => {
  const f = await portFixture(t);
  const created = await f.enterpriseMaterials.create({ title: 'A formal material', body: 'APPROVED_A_BODY' });
  const enabled = await f.enterpriseMaterials.enable(created.material.id, created.material.version);
  f.studio.enterpriseScopes.associateAsset('enterprise', created.material.id, f.a.id);
  const foreign = await f.enterpriseMaterials.create({ title: 'B hidden material', body: 'FOREIGN_B_BODY' });
  await f.enterpriseMaterials.enable(foreign.material.id, foreign.material.version); f.studio.enterpriseScopes.associateAsset('enterprise', foreign.material.id, f.b.id);
  const port = f.studio.port(f.project.id, f.task.id);
  const catalog = (await port('catalog', {}, f.context)).details.result as any;
  const material = catalog.items.find((item: any) => item.id === created.material.id);
  assert.equal(material.ref.version, enabled.material.activeRevisionId); assert.equal(material.eligible, true);
  assert.doesNotMatch(JSON.stringify(catalog), /APPROVED_A_BODY|B hidden|FOREIGN_B_BODY/);
  const read = (await port('read-source', { payload: { ref: material.ref } }, f.context)).details.result as any;
  assert.equal(read.text, 'APPROVED_A_BODY'); assert.equal(read.complete, true);
  await assert.rejects(() => port('read-source', { payload: { ref: { ...material.ref, id: foreign.material.id } } }, f.context), /studio_source_scope_forbidden/);
});

test('SU13/16/24: analysis-only Studio access cannot borrow its construction owner candidate or write capability', async t => {
  const f = await portFixture(t), system = f.studio.store.create({ name: 'A shared system', projectId: f.project.id, taskId: f.task.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'General' });
  const asset = f.studio.store.saveAsset(system.id, { kind: 'rule', title: 'PRIVATE_CANDIDATE', body: 'PRIVATE_CANDIDATE_BODY', scope: 'Synthetic', sources: [], checks: [], readyForPublication: true });
  const current = f.studio.store.get(system.id).assets.find(item => item.id === asset.id)!;
  const ref = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: current.revisions[0]!.sha256, projectId: f.project.id, locator: system.id };
  const full = f.studio.port(f.project.id, f.task.id), readonly = f.studio.port(f.project.id, f.task.id, { analysisOnly: true });
  const construction = (await full('read-source', { systemId: system.id, payload: { ref } }, f.context)).details.result as any;
  assert.equal(construction.text, 'PRIVATE_CANDIDATE_BODY');
  const catalog = await readonly('catalog', {}, f.context); assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_CANDIDATE/);
  await assert.rejects(() => readonly('read-source', { systemId: system.id, payload: { ref } }, f.context), /studio_source_scope_forbidden|studio_asset_not_published/);
  await assert.rejects(() => readonly('save-asset', { systemId: system.id, payload: {} }, f.context), /studio_read_only/);
  await assert.rejects(() => readonly('read-source', { payload: { ref: { authority: 'data', id: '1'.repeat(64), version: '1'.repeat(64), projectId: f.project.id, locator: '020_clean/private.csv' } } }, f.context), /studio_system_required/);
  const context = await f.studio.prepareContext(f.project.id, f.task.id, undefined, { analysisOnly: true }); assert.equal(context, undefined);
});

test('SU06/13: archived construction resumes in one active same-enterprise task without changing its original owner or draft', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Maintenance', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic' }));
  const createProject = async (name: string) => (await json(await host.request('/api/projects', 'POST', { name }), 201)).project;
  const old = await createProject('Original'), target = await createProject('Maintenance');
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201), b = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: a.id, projectId: old.id, name: 'Continue same system', goal: 'Original goal', topicTitle: 'General' }), 201);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: target.id, enterpriseId: a.id }));
  const { task } = await json(await host.request(`/api/projects/${target.id}/tasks`, 'POST', { name: 'Existing WIP' }), 201);
  await json(await host.request(`/api/projects/${target.id}/tasks/${task.id}/draft`, 'PATCH', { text: 'USER_EXISTING_DRAFT' }));
  await json(await host.request(`/api/projects/${old.id}/archive`, 'POST', {}));
  const route = `/api/studio/systems/${system.id}/maintenance`, input = { requestId: randomUUID(), projectId: target.id, taskId: task.id, expectedRevision: system.revision };
  await json(await host.request(route, 'POST', { ...input, requestId: randomUUID(), expectedRevision: 99 }), 409);
  const result = await json(await host.request(route, 'POST', input));
  assert.deepEqual(result.system.maintenanceOwner, { projectId: target.id, taskId: task.id });
  assert.equal(result.system.projectId, old.id); assert.equal(result.system.taskId, system.taskId);
  assert.deepEqual(await json(await host.request(route, 'POST', input)), result);
  const workspace = await json(await host.request(`/api/studio/systems/${system.id}`)); assert.equal(workspace.project.id, target.id); assert.equal(workspace.task.draft, 'USER_EXISTING_DRAFT'); assert.equal(workspace.readOnly, false);
  assert.ok((await json(await host.request(`/api/projects/${old.id}`))).project.archivedAt);
  const foreign = await createProject('Foreign'); await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: foreign.id, enterpriseId: b.id }));
  await json(await host.request(route, 'POST', { requestId: randomUUID(), projectId: foreign.id, expectedRevision: result.system.revision }), 403);
  assert.equal((await json(await host.request(`/api/projects/${foreign.id}`))).project.tasks.length, 0);
});

test('SU07/13: an ordinary task contributes exact report evidence as its own candidate while formal assets remain unchanged', async t => {
  const f = await portFixture(t), owner = await f.projects.create({ name: 'A construction', configuration: f.configuration });
  f.studio.enterpriseScopes.associateProject(owner.id, f.a.id); const ownerTask = await f.projects.createTask(owner.id, { name: 'Construction' });
  const system = f.studio.store.create({ name: 'Foundation', projectId: owner.id, taskId: ownerTask.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'General' });
  const body = 'EXACT_TASK_REPORT', hash = createHash('sha256').update(body).digest('hex'); await writeFile(path.join(f.project.rootPath, '060_reports', 'report.md'), body);
  const report = { authority: 'task', id: f.task.id, taskId: f.task.id, projectId: f.project.id, locator: '060_reports/report.md', version: hash, sha256: hash };
  const candidate = { kind: 'rule', title: 'Task observation', body: 'Review observation period', scope: 'Synthetic enterprise' };
  const port = f.studio.port(f.project.id, f.task.id), payload = { report, scope: 'enterprise', candidate, sourceRefs: [], baseRefs: [], baseSystemRevision: system.revision };
  await assert.rejects(() => port('contribute', { systemId: system.id, payload: { ...payload, report: { ...report, sha256: '0'.repeat(64) } } }, f.context), /studio_source_changed/);
  const result = (await port('contribute', { systemId: system.id, payload: { ...payload, sourceProjectId: owner.id, sourceTaskId: ownerTask.id } }, f.context)).details.result as any;
  assert.equal(result.contribution.sourceProjectId, f.project.id); assert.equal(result.contribution.sourceTaskId, f.task.id);
  assert.deepEqual(result.contribution.revisions[0].report, report); assert.deepEqual(f.studio.store.get(system.id).assets, []); assert.deepEqual(f.studio.store.get(system.id).publications, []);
  const mine = (await port('read', { systemId: system.id, payload: { section: 'contributions' } }, f.context)).details.result as any; assert.equal(mine.items.length, 1);
  const otherTask = await f.projects.createTask(f.project.id, { name: 'Other analysis' }), other = f.studio.port(f.project.id, otherTask.id);
  assert.equal(((await other('read', { systemId: system.id, payload: { section: 'contributions' } }, f.context)).details.result as any).items.length, 0);
  await assert.rejects(() => other('contribute', { systemId: system.id, payload: { ...payload, contributionId: result.contribution.id, expectedRevision: 1 } }, f.context), /studio_contribution_owner_mismatch|studio_contribution_report_mismatch/);
});

test('SU07/08/13: HTTP contribution captures the exact native reply and read source, then links only the approved matching candidate', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close()); const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Native contribution', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-contribution', apiKey: 'synthetic-only' }));
  const createProject = async (name: string) => (await json(await host.request('/api/projects', 'POST', { name }), 201)).project;
  const owner = await createProject('Construction'), analysis = await createProject('Analysis');
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: a.id, projectId: owner.id, name: 'A foundation', goal: 'Synthetic', topicTitle: 'General' }), 201), route = `/api/studio/systems/${system.id}`;
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: analysis.id, enterpriseId: a.id }));
  const original = await json(await host.request('/api/enterprise-materials', 'POST', { title: 'Synthetic source', body: 'ACTUAL_READ_SOURCE' }), 201);
  await json(await host.request(`/api/enterprise-materials/${original.material.id}/enable`, 'POST', { expectedVersion: original.material.version }));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'enterprise', entityId: original.material.id, enterpriseId: a.id }));
  const ref = (await json(await host.request(`/api/studio/foundation?enterpriseId=${a.id}`))).items.find((item: any) => item.id === original.material.id && item.eligible).ref;
  const { task } = await json(await host.request(`/api/projects/${analysis.id}/tasks`, 'POST', { name: 'Original analysis' }), 201), taskRoute = `/api/projects/${analysis.id}/tasks/${task.id}`;
  provider.setResponder(context => !context.recentToolResults.length ? { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref, start: 0, length: 8 } } }] } : { text: 'NATIVE_REPORT_WITH_PARTIAL_SOURCE' });
  await json(await host.request(`${taskRoute}/messages`, 'POST', { requestId: randomUUID(), text: 'Read the approved source and retain this proposal.' }), 202);
  let state: any; const deadline = Date.now() + 20_000;
  do { state = await json(await host.request(taskRoute)); if (state.task.lastRun?.status === 'completed' && state.snapshot.status === 'idle') break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed');
  const message = state.snapshot.messages.findLast((item: any) => item.role === 'assistant' && item.nativeEntryId), native = await readFile(state.task.sessionFile);
  const origin = { projectId: analysis.id, taskId: task.id, sessionId: message.nativeSessionId, messageId: message.nativeEntryId }, candidate = { kind: 'rule', title: 'Observation', body: 'Review the window', scope: 'Synthetic enterprise' };
  const input = { requestId: randomUUID(), origin, scope: 'enterprise', candidate, baseSystemRevision: system.revision };
  const contributed = await json(await host.request(`${route}/contributions`, 'POST', input));
  assert.equal(contributed.contribution.sourceProjectId, analysis.id); assert.equal(contributed.contribution.revisions[0].sourceRefs.length, 1);
  assert.deepEqual(contributed.contribution.revisions[0].sourceRefs[0], ref); assert.match(contributed.contribution.revisions[0].report.locator, /native-reply/);
  assert.deepEqual(await json(await host.request(`${route}/contributions`, 'POST', input)), contributed);
  const saved = await json(await host.request(`${route}/assets`, 'POST', { requestId: randomUUID(), ...candidate, sources: [ref], checks: [] })), asset = saved.system.assets[0];
  await json(await host.request(`${route}/contributions/${contributed.contribution.id}/link`, 'POST', { requestId: randomUUID(), expectedContributionRevision: 2, assetId: asset.id, assetRevision: 1 }), 409);
  const linked = await json(await host.request(`${route}/contributions/${contributed.contribution.id}/link`, 'POST', { requestId: randomUUID(), expectedContributionRevision: 1, assetId: asset.id, assetRevision: 1 }));
  assert.equal(linked.contribution.linked.assetId, asset.id); assert.deepEqual(linked.system.publications, []);
  const own = await json(await host.request(`${route}/contributions?projectId=${analysis.id}&taskId=${task.id}`)); assert.equal(own.items.length, 1);
  assert.deepEqual(await readFile(state.task.sessionFile), native, 'Saving and linking a contribution cannot rewrite original native history.');
  assert.deepEqual(provider.errors, []);
});

test('SU06/13: maintenance validates each new dependency in its retained source project without granting old raw access', async t => {
  const f = await portFixture(t), system = f.studio.store.create({ name: 'Maintained', projectId: f.project.id, taskId: f.task.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'General' });
  const target = await f.projects.create({ name: 'New execution', configuration: f.configuration }); f.studio.enterpriseScopes.associateProject(target.id, f.a.id);
  const targetTask = await f.projects.createTask(target.id, { name: 'Continue' }); f.studio.store.resumeMaintenance(system.id, { projectId: target.id, taskId: targetTask.id, expectedRevision: 1 });
  const locator = '020_clean/new.csv', bytes = 'new-source\n7\n', hash = createHash('sha256').update(bytes).digest('hex'); await writeFile(path.join(target.rootPath, locator), bytes);
  const data = { authority: 'data' as const, id: createHash('sha256').update(locator).digest('hex'), version: hash, sha256: hash, projectId: target.id, locator };
  const port = f.studio.port(target.id, targetTask.id), saved = (await port('save-asset', { systemId: system.id, payload: { kind: 'rule', title: 'Continued', body: 'New reviewed rule', scope: 'Synthetic', sources: [data], checks: [], readyForPublication: true } }, f.context)).details.result as any;
  const asset = f.studio.store.get(system.id).assets[0]!, ref = { authority: 'studio-source', id: asset.id, version: '1', sha256: asset.revisions[0]!.sha256, projectId: f.project.id, locator: system.id };
  assert.ok(saved.ref || saved.asset);
  const read = (await port('read-source', { systemId: system.id, payload: { ref } }, f.context)).details.result as any; assert.equal(read.text, 'New reviewed rule');
  await writeFile(path.join(f.project.rootPath, locator), bytes);
  await assert.rejects(() => port('read-source', { systemId: system.id, payload: { ref: { ...data, projectId: f.project.id } } }, f.context), /studio_source_project_mismatch/);
  await writeFile(path.join(target.rootPath, locator), 'changed\n');
  await assert.rejects(() => port('read-source', { systemId: system.id, payload: { ref } }, f.context), /studio_source_changed/);
});

test('SU02/13: scoped Studio usage and adoption cannot create foreign tasks or enable foreign packages', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Scope guard', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic' }));
  const owner = (await json(await host.request('/api/projects', 'POST', { name: 'A' }), 201)).project, target = (await json(await host.request('/api/projects', 'POST', { name: 'B' }), 201)).project;
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201), b = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: target.id, enterpriseId: b.id }));
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: a.id, projectId: owner.id, name: 'A formal', goal: 'Synthetic', topicTitle: 'General' }), 201);
  const route = `/api/studio/systems/${system.id}`;
  await json(await host.request(`${route}/use`, 'POST', { requestId: randomUUID(), projectId: target.id }), 403);
  await json(await host.request(`${route}/adoptions`, 'POST', { requestId: randomUUID(), projectId: target.id, packageId: 'not-yet-published', version: '1.0.0' }), 403);
  assert.equal((await json(await host.request(`/api/projects/${target.id}`))).project.tasks.length, 0);
});

test('SU16: a catalog continuation is pinned to its observed directory and remains an honest partial page', async t => {
  const f = await portFixture(t);
  for (const title of ['One', 'Two']) { const material = await f.enterpriseMaterials.create({ title, body: `${title}_BODY` }); await f.enterpriseMaterials.enable(material.material.id, material.material.version); f.studio.enterpriseScopes.associateAsset('enterprise', material.material.id, f.a.id); }
  const port = f.studio.port(f.project.id, f.task.id), first = (await port('catalog', { payload: { length: 1 } }, f.context)).details.result as any;
  assert.equal(first.complete, false); assert.equal(first.range.total, 2); assert.equal(first.items.length, 1);
  const second = (await port('catalog', { payload: first.continuation.payload }, f.context)).details.result as any; assert.equal(second.range.start, 1); assert.equal(second.complete, true);
  assert.notEqual(first.items[0].id, second.items[0].id);
  const third = await f.enterpriseMaterials.create({ title: 'Three', body: 'Three_BODY' }); await f.enterpriseMaterials.enable(third.material.id, third.material.version); f.studio.enterpriseScopes.associateAsset('enterprise', third.material.id, f.a.id);
  await assert.rejects(() => port('catalog', { payload: first.continuation.payload }, f.context), /studio_catalog_changed/);
});

test('SU02/13: explicit metadata association cannot reclaim a native source already grounded in another enterprise formal asset', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Historical grounding', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic' }));
  const project = (await json(await host.request('/api/projects', 'POST', { name: 'A construction' }), 201)).project;
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201), b = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'B' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: a.id, projectId: project.id, name: 'Grounded', goal: 'Synthetic', topicTitle: 'General' }), 201);
  const materials = new EnterpriseMaterialsStore(host.dataRoot), created = await materials.create({ title: 'Original grounded material', body: 'ORIGINAL_GROUNDED_BODY' }), enabled = await materials.enable(created.material.id, created.material.version);
  const ref = { authority: 'enterprise' as const, id: created.material.id, version: enabled.material.activeRevisionId!, locator: enabled.storeId };
  const store = new StudioStore(host.dataRoot), asset = store.saveAsset(system.id, { kind: 'rule', title: 'Historical formal', body: 'Source reviewed', scope: 'Synthetic', sources: [ref], checks: [], readyForPublication: true });
  const preview = store.preparePublication(system.id, { assetIds: [asset.id], summary: 'Historical decision', scope: 'Synthetic' }); store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const before = await materials.get(created.material.id);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'enterprise', entityId: created.material.id, enterpriseId: b.id }), 409);
  assert.deepEqual(await materials.get(created.material.id), before);
  assert.equal((await json(await host.request('/api/studio/enterprises'))).assetAssignments.length, 0);
});

test('SU02/13: a construction tool cannot append a new method version to another enterprise original authority', async t => {
  const f = await portFixture(t), system = f.studio.store.create({ name: 'A construction', projectId: f.project.id, taskId: f.task.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'General' });
  const methods = createSapMethodStore(path.join(f.projects.dataRoot, 'metric-assets')), original = methods.save({ requestId: randomUUID(), origin: 'other', title: 'B method', content: { conditions: 'B scope', logic: 'B logic', judgment: '', limits: '' }, sources: [] });
  f.studio.enterpriseScopes.associateAsset('sap-method', original.method.id, f.b.id);
  const port = f.studio.port(f.project.id, f.task.id);
  await assert.rejects(() => port('save-sap-method', { systemId: system.id, payload: { methodId: original.method.id, baseVersion: 1, title: 'Foreign replacement', content: { conditions: 'A scope', logic: 'A logic', judgment: '', limits: '' }, sources: [] } }, f.context), /enterprise_assignment_conflict/);
  assert.equal(methods.read(original.method.id).latestVersion, 1);
  assert.deepEqual(f.studio.store.get(system.id).assetRefs, []);
});

test('SU07/08: linking a contribution rechecks native formal bases and never promotes a task-local or mismatching candidate', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Contribution bases', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic' }));
  const project = (await json(await host.request('/api/projects', 'POST', { name: 'A owner' }), 201)).project, a = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'A' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: a.id, projectId: project.id, name: 'A foundation', goal: 'Synthetic', topicTitle: 'General' }), 201), route = `/api/studio/systems/${system.id}`;
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Ordinary proposal' }), 201), body = 'ACTUAL_REPORT_BYTES', hash = createHash('sha256').update(body).digest('hex'); await writeFile(path.join(project.rootPath, '060_reports', 'report.md'), body);
  const report = { authority: 'task', id: task.id, projectId: project.id, taskId: task.id, locator: '060_reports/report.md', version: hash, sha256: hash }, content = { conditions: 'Synthetic', logic: 'V1', judgment: '', limits: '' };
  const method = await json(await host.request('/api/sap/methods', 'POST', { requestId: randomUUID(), title: 'Base method', content, sources: [] }), 201);
  await json(await host.request(`/api/sap/methods/${method.method.id}/publish`, 'POST', { requestId: randomUUID(), version: 1, expectedSha256: method.version.contentSha256 }));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'sap-method', entityId: method.method.id, enterpriseId: a.id }));
  const base = { authority: 'sap-method', id: method.method.id, version: '1', sha256: method.version.contentSha256 }, candidate = { kind: 'rule', title: 'Proposed rule', body: 'Reviewed statement', scope: 'Synthetic' };
  const proposed = await json(await host.request(`${route}/contributions`, 'POST', { requestId: randomUUID(), report, scope: 'enterprise', candidate, baseRefs: [base] }));
  const saved = await json(await host.request(`${route}/assets`, 'POST', { requestId: randomUUID(), ...candidate, sources: [base], checks: [] })), asset = saved.system.assets[0];
  const next = await json(await host.request(`/api/sap/methods/${method.method.id}/versions`, 'POST', { requestId: randomUUID(), baseVersion: 1, title: 'Base method', content: { ...content, logic: 'V2' }, sources: [] }), 201);
  await json(await host.request(`/api/sap/methods/${method.method.id}/publish`, 'POST', { requestId: randomUUID(), version: 2, expectedSha256: next.version.contentSha256 }));
  const link = (id: string, status = 409) => host.request(`${route}/contributions/${id}/link`, 'POST', { requestId: randomUUID(), expectedContributionRevision: 1, assetId: asset.id, assetRevision: 1 }).then(response => json(response, status));
  const conflict = await link(proposed.contribution.id); assert.equal(conflict.code, 'studio_contribution_base_conflict');
  const local = await json(await host.request(`${route}/contributions`, 'POST', { requestId: randomUUID(), report, scope: 'task', candidate, baseRefs: [] })); assert.equal((await link(local.contribution.id)).code, 'studio_contribution_task_local');
  const mismatch = await json(await host.request(`${route}/contributions`, 'POST', { requestId: randomUUID(), report, scope: 'enterprise', candidate: { ...candidate, body: 'Different statement' }, baseRefs: [] })); assert.equal((await link(mismatch.contribution.id)).code, 'studio_contribution_target_changed');
  assert.deepEqual((await json(await host.request(route))).system.publications, []);
});

test('SU13: a retained candidate reference never overrides the native authority enterprise scope', async t => {
  const f = await portFixture(t), system = f.studio.store.create({ name: 'A legacy candidate', projectId: f.project.id, taskId: f.task.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'General' });
  const methods = createSapMethodStore(path.join(f.projects.dataRoot, 'metric-assets')), original = methods.save({ requestId: randomUUID(), origin: 'other', title: 'B private candidate', content: { conditions: 'B scope', logic: 'FOREIGN_NATIVE_BODY', judgment: '', limits: '' }, sources: [] });
  const ref = { authority: 'sap-method' as const, id: original.method.id, version: '1', sha256: original.version.contentSha256, title: original.version.title, locator: 'candidate' };
  // Historical/imported retained references are not a grant over later
  // explicit native ownership; normal new Host writes reject this state.
  f.studio.store.addAssetRef(system.id, ref); f.studio.enterpriseScopes.associateAsset('sap-method', original.method.id, f.b.id);
  await assert.rejects(() => f.studio.port(f.project.id, f.task.id)('read-source', { systemId: system.id, payload: { ref } }, f.context), /studio_source_scope_forbidden|enterprise_assignment_conflict/);
});

test('SU07/16: a large committed contribution has an exact read continuation even for a construction task with other contributors', async t => {
  const f = await portFixture(t), system = f.studio.store.create({ name: 'A contribution receipt', projectId: f.project.id, taskId: f.task.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'General' }), body = 'ACTUAL_REPORT', hash = createHash('sha256').update(body).digest('hex');
  await writeFile(path.join(f.project.rootPath, '060_reports', 'large-report.md'), body);
  const report = { authority: 'task' as const, id: f.task.id, projectId: f.project.id, taskId: f.task.id, version: hash, sha256: hash, locator: '060_reports/large-report.md' }, other = await f.projects.createTask(f.project.id, { name: 'Earlier contribution' });
  f.studio.store.contribute(system.id, { sourceProjectId: f.project.id, sourceTaskId: other.id, report: { ...report, id: other.id, taskId: other.id }, scope: 'task', sourceRefs: [], candidate: { kind: 'rule', title: 'Other', body: 'Retained', scope: 'Synthetic' } });
  const port = f.studio.port(f.project.id, f.task.id), value = (await port('contribute', { systemId: system.id, payload: { report, scope: 'enterprise', sourceRefs: [], candidate: { kind: 'rule', title: 'Large', body: 'x'.repeat(35_000), scope: 'Synthetic' } } }, f.context)).details.result as any;
  assert.equal(value.transport.complete, false);
  const continuation = value.transport.continuation, recovered = (await port(continuation.action, { systemId: continuation.systemId, payload: continuation.payload }, f.context)).details.result as any;
  assert.equal(recovered.encoding, 'json-text'); assert.equal(recovered.complete, false); assert.match(recovered.text, new RegExp(value.contribution.id));
  assert.equal(f.studio.store.get(system.id).contributions!.length, 2, 'Recovery must not repeat the contribution write.');
});

test('SU02/07: a task project Studio picker lists only its available enterprise systems', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Scoped picker', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic' }));
  const systems = [], projects = [];
  for (const name of ['A', 'B']) {
    const enterprise = await json(await host.request('/api/studio/enterprises', 'POST', { name }), 201), project = (await json(await host.request('/api/projects', 'POST', { name }), 201)).project;
    const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: enterprise.id, projectId: project.id, name: `${name}_PRIVATE_SYSTEM`, goal: 'Synthetic', topicTitle: 'General' }), 201); systems.push(system); projects.push(project);
  }
  const picker = await json(await host.request(`/api/studio/systems?projectId=${projects[0].id}`)); assert.deepEqual(picker.systems.map((item: any) => item.id), [systems[0].id]); assert.doesNotMatch(JSON.stringify(picker), /B_PRIVATE_SYSTEM/);
  await json(await host.request(`/api/studio/systems?projectId=${randomUUID()}`), 404);
  assert.equal((await json(await host.request('/api/studio/systems'))).systems.length, 2, 'The explicit Studio management list retains both enterprise records.');
});

async function crossSystemFixture(t: { after(fn: () => Promise<void>): void }) {
  const f = await portFixture(t), buildA = await f.projects.createTask(f.project.id, { name: 'Receiver construction' }), sourceProject = await f.projects.create({ name: 'Same-enterprise other project', configuration: f.configuration });
  f.studio.enterpriseScopes.associateProject(sourceProject.id, f.a.id); const buildB = await f.projects.createTask(sourceProject.id, { name: 'Source construction' });
  const receiver = f.studio.store.create({ name: 'Receiver', projectId: f.project.id, taskId: buildA.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'Receiving topic' });
  const source = f.studio.store.create({ name: 'Source', projectId: sourceProject.id, taskId: buildB.id, enterpriseId: f.a.id, goal: 'Synthetic', topicTitle: 'Other topic' });
  const material = await f.enterpriseMaterials.create({ title: 'Shared approved source', body: 'AUTHORIZED_BODY' }), enabled = await f.enterpriseMaterials.enable(material.material.id, material.material.version);
  f.studio.enterpriseScopes.associateAsset('enterprise', material.material.id, f.a.id);
  const materialRef = { authority: 'enterprise' as const, id: material.material.id, version: enabled.material.activeRevisionId!, locator: enabled.storeId };
  const rawLocator = '020_clean/source-only.csv', rawBody = 'source-only\n5\n', rawHash = createHash('sha256').update(rawBody).digest('hex'); await writeFile(path.join(sourceProject.rootPath, rawLocator), rawBody);
  const rawRef = { authority: 'data' as const, id: createHash('sha256').update(rawLocator).digest('hex'), version: rawHash, sha256: rawHash, projectId: sourceProject.id, locator: rawLocator };
  const asset = f.studio.store.saveAsset(source.id, { kind: 'rule', title: 'Cross-topic rule', body: 'OTHER_SYSTEM_FORMAL_BODY', scope: 'Synthetic', sources: [materialRef], dependencies: [rawRef], checks: [], readyForPublication: true });
  const preview = f.studio.store.preparePublication(source.id, { assetIds: [asset.id], summary: 'Exact source publication', scope: 'Synthetic' }); f.studio.store.confirmPublication(source.id, preview.id, preview.fingerprint);
  const ref = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0]!.sha256, projectId: sourceProject.id, locator: source.id };
  const body = 'TASK_REPORT', hash = createHash('sha256').update(body).digest('hex'); await writeFile(path.join(f.project.rootPath, '060_reports', 'cross-system.md'), body);
  const report = { authority: 'task' as const, id: f.task.id, taskId: f.task.id, projectId: f.project.id, locator: '060_reports/cross-system.md', version: hash, sha256: hash };
  const candidate = { kind: 'rule' as const, title: 'Receiving candidate', body: 'Grounded in exact other-system rule', scope: 'Synthetic' };
  return { ...f, receiver, source, sourceProject, asset, ref, materialRef, material, report, candidate, buildA, buildB, rawRef, rawBody };
}

test('SU07/13: a contribution keeps an exact same-enterprise source system without borrowing construction access', async t => {
  const f = await crossSystemFixture(t), port = f.studio.port(f.project.id, f.task.id), before = f.studio.store.get(f.source.id);
  assert.equal(((await port('read-source', { systemId: f.source.id, payload: { ref: f.ref } }, f.context)).details.result as any).text, 'OTHER_SYSTEM_FORMAL_BODY');
  const value = (await port('contribute', { systemId: f.receiver.id, payload: { scope: 'enterprise', report: f.report, sourceRefs: [f.ref], baseRefs: [f.ref], candidate: f.candidate } }, f.context)).details.result as any;
  assert.deepEqual(value.contribution.revisions[0].sourceRefs, [f.ref]); assert.deepEqual(value.contribution.revisions[0].baseRefs, [f.ref]);
  assert.deepEqual(f.studio.store.get(f.source.id), before, 'Contribution validation must not mutate the source system.');
  const draft = f.studio.store.saveAsset(f.source.id, { kind: 'rule', title: 'Other unpublished', body: 'OTHER_CANDIDATE_BODY', scope: 'Synthetic', sources: [f.materialRef], checks: [] });
  const draftRef = { ...f.ref, id: draft.id, sha256: draft.revisions[0]!.sha256 }, receiverPort = f.studio.port(f.project.id, f.buildA.id);
  await assert.rejects(() => receiverPort('read-source', { systemId: f.receiver.id, payload: { ref: draftRef } }, f.context), /studio_source_scope_forbidden|studio_asset_not_published/);
  await assert.rejects(() => port('contribute', { systemId: f.receiver.id, payload: { scope: 'enterprise', report: f.report, sourceRefs: [draftRef], candidate: f.candidate } }, f.context), /studio_source_scope_forbidden|studio_asset_not_published/);
  await assert.rejects(() => receiverPort('read-source', { systemId: f.receiver.id, payload: { ref: f.rawRef } }, f.context), /studio_source_project_mismatch/);
  await writeFile(path.join(f.sourceProject.rootPath, f.rawRef.locator), 'changed-source\n');
  await assert.rejects(() => receiverPort('read-source', { systemId: f.receiver.id, payload: { ref: f.ref } }, f.context), /studio_source_changed/);
  await writeFile(path.join(f.sourceProject.rootPath, f.rawRef.locator), f.rawBody);
  await f.enterpriseMaterials.disable(f.material.material.id, (await f.enterpriseMaterials.get(f.material.material.id)).material.version);
  await assert.rejects(() => receiverPort('read-source', { systemId: f.receiver.id, payload: { ref: f.ref } }, f.context), /studio_source_unavailable/);
  await f.enterpriseMaterials.enable(f.material.material.id, (await f.enterpriseMaterials.get(f.material.material.id)).material.version);
  f.studio.store.markAssetIssue(f.source.id, f.asset.id, 'Synthetic confirmed defect');
  await assert.rejects(() => receiverPort('read-source', { systemId: f.receiver.id, payload: { ref: f.ref } }, f.context), /studio_source_restricted/);
  await assert.rejects(() => port('contribute', { systemId: f.receiver.id, payload: { scope: 'enterprise', report: f.report, sourceRefs: [f.ref], candidate: f.candidate } }, f.context), /studio_source_restricted/);
});

test('SU07/08/13: cross-system formal bases link and freeze exact preview provenance, then reject source formal drift', async t => {
  const f = await crossSystemFixture(t), ordinary = f.studio.port(f.project.id, f.task.id), build = f.studio.port(f.project.id, f.buildA.id);
  const contribution = ((await ordinary('contribute', { systemId: f.receiver.id, payload: { scope: 'enterprise', report: f.report, sourceRefs: [f.ref], baseRefs: [f.ref], candidate: f.candidate } }, f.context)).details.result as any).contribution;
  const target = ((await build('save-asset', { systemId: f.receiver.id, payload: { ...f.candidate, sources: [f.ref], checks: [], readyForPublication: true } }, f.context)).details.result as any).asset;
  const sourceBefore = f.studio.store.get(f.source.id);
  const linked = f.studio.store.linkContribution(f.receiver.id, { contributionId: contribution.id, expectedContributionRevision: 1, assetId: target.id, assetRevision: 1 }); assert.equal(linked.linked?.assetId, target.id);
  const preview = ((await build('prepare-publication', { systemId: f.receiver.id, payload: { assetIds: [target.id], summary: 'Exact combined decision', scope: 'Synthetic' } }, f.context)).details.result as any).preview;
  assert.deepEqual(preview.contributions[0].baseRefs, [f.ref]); assert.deepEqual(preview.contributions[0].report, f.report); assert.equal(preview.contributions[0].sourceTaskId, f.task.id);
  assert.deepEqual(f.studio.store.get(f.source.id), sourceBefore, 'Link and preview cannot write the other source system.');
  const frozenPreview = JSON.stringify(preview), revision = f.studio.store.saveAsset(f.source.id, { assetId: f.asset.id, expectedRevision: 1, kind: 'rule', title: 'Cross-topic rule v2', body: 'NEW_SOURCE_FORMAL_BODY', scope: 'Synthetic', sources: [f.materialRef], checks: [], readyForPublication: true });
  const sourcePreview = f.studio.store.preparePublication(f.source.id, { assetIds: [revision.id], summary: 'New actual source version', scope: 'Synthetic' }); f.studio.store.confirmPublication(f.source.id, sourcePreview.id, sourcePreview.fingerprint);
  const afterAdvance = f.studio.store.get(f.source.id);
  assert.throws(() => f.studio.store.linkContribution(f.receiver.id, { contributionId: contribution.id, expectedContributionRevision: 1, assetId: target.id, assetRevision: 1 }), /studio_contribution_base_conflict/);
  assert.throws(() => f.studio.store.confirmPublication(f.receiver.id, preview.id, preview.fingerprint), /studio_contribution_base_conflict/);
  await assert.rejects(() => build('prepare-publication', { systemId: f.receiver.id, payload: { assetIds: [target.id], summary: 'Stale base must not publish', scope: 'Synthetic' } }, f.context), /studio_contribution_base_conflict/);
  assert.equal(JSON.stringify(f.studio.store.get(f.receiver.id).publications.find(item => item.preview.id === preview.id)!.preview), frozenPreview);
  assert.deepEqual(f.studio.store.get(f.source.id), afterAdvance, 'Rejected stale receiver writes cannot touch the source.');
});

test('SU13: an exact cross-system locator needs a real enterprise grant and cannot expand legacy or foreign access', async t => {
  const f = await crossSystemFixture(t);
  const legacy = createStudioSources({ dataRoot: f.projects.dataRoot, projects: f.projects, enterpriseMaterials: f.enterpriseMaterials, studio: f.studio.store, enterpriseScope: { active: () => false, enterpriseIdForProject: () => undefined, sourceAllowed: () => true } });
  await assert.rejects(() => legacy.read(f.ref, f.project.id, f.receiver.id), /studio_source_scope_forbidden|studio_source_scope_unassigned/);
  const foreignProject = await f.projects.create({ name: 'Foreign', configuration: f.configuration }); f.studio.enterpriseScopes.associateProject(foreignProject.id, f.b.id);
  const task = await f.projects.createTask(foreignProject.id, { name: 'Foreign source' }), foreign = f.studio.store.create({ name: 'Foreign source', projectId: foreignProject.id, taskId: task.id, enterpriseId: f.b.id, goal: 'Synthetic', topicTitle: 'Foreign' });
  const material = await f.enterpriseMaterials.create({ title: 'Foreign approved source', body: 'FOREIGN_ONLY' }), enabled = await f.enterpriseMaterials.enable(material.material.id, material.material.version); f.studio.enterpriseScopes.associateAsset('enterprise', material.material.id, f.b.id);
  const asset = f.studio.store.saveAsset(foreign.id, { kind: 'rule', title: 'Foreign formal', body: 'FOREIGN_FORMAL_BODY', scope: 'Foreign', sources: [{ authority: 'enterprise', id: material.material.id, version: enabled.material.activeRevisionId!, locator: enabled.storeId }], readyForPublication: true });
  const preview = f.studio.store.preparePublication(foreign.id, { assetIds: [asset.id], summary: 'Foreign actual decision', scope: 'Foreign' }); f.studio.store.confirmPublication(foreign.id, preview.id, preview.fingerprint);
  const ref = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0]!.sha256, projectId: foreignProject.id, locator: foreign.id }, before = f.studio.store.get(foreign.id);
  await assert.rejects(() => f.studio.port(f.project.id, f.buildA.id)('read-source', { systemId: f.receiver.id, payload: { ref } }, f.context), /studio_source_scope_forbidden/);
  await assert.rejects(() => f.studio.port(f.project.id, f.task.id)('contribute', { systemId: f.receiver.id, payload: { scope: 'enterprise', report: f.report, sourceRefs: [ref], baseRefs: [ref], candidate: f.candidate } }, f.context), /studio_source_scope_forbidden/);
  const proposal = f.studio.store.contribute(f.receiver.id, { sourceProjectId: f.project.id, sourceTaskId: f.task.id, scope: 'enterprise', report: f.report, sourceRefs: [], baseRefs: [ref], candidate: f.candidate }), target = f.studio.store.saveAsset(f.receiver.id, { ...f.candidate, sources: [f.materialRef], checks: [] });
  assert.throws(() => f.studio.store.linkContribution(f.receiver.id, { contributionId: proposal.id, expectedContributionRevision: 1, assetId: target.id, assetRevision: 1 }), /studio_contribution_base_conflict/);
  assert.deepEqual(f.studio.store.get(foreign.id), before);
});

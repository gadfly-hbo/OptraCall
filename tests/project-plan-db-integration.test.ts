import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { DbLinkStore } from '../src/host/db-link-store.ts';
import { createDbLinkHost, dbLinkModelOutlet } from '../src/host/db-link-host.ts';
import { createProjectPlanFeature } from '../src/host/project-plan-host.ts';
import { createProjectPlanStore } from '../src/host/project-plan-store.ts';
import { createProjectPlanPreparationHost, projectPlanPreparationDirectory } from '../src/host/project-plan-preparation-host.ts';
import { createRequirementSessions } from '../src/host/requirement-sessions.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { requirementWorkspace } from '../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import type { DbLinkConnectionInput } from '../src/host/db-link-types.ts';
import type { DbLinkPlanningSource } from '../src/host/db-link-planning.ts';
import type { ProjectPlanCapabilities, ProjectPlanContent, ProjectPlanPreparationResult, ProjectPlanConfirmResult } from '../src/host/project-plan-types.ts';

const connection: DbLinkConnectionInput = { name: 'PG05合成交易与会员库', engine: 'postgresql', host: 'db.private.synthetic.invalid', port: 5432, database: 'PRIVATE_DATABASE_NAME', username: 'PRIVATE_DATABASE_USERNAME', password: 'PRIVATE_DATABASE_PASSWORD', tls: { rejectUnauthorized: true, verifyIdentity: true }, budget: { connectTimeoutMs: 1000, queryTimeoutMs: 5000, lockTimeoutMs: 1000, maxRows: 100, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000, maxConcurrent: 1 } };
const ref = (value: DbLinkPlanningSource) => ({ kind: 'connector' as const, id: value.id, version: value.version, sha256: value.sha256, permissionRef: value.permissionRef });
const catalogFrom = (text: string): ProjectPlanCapabilities => JSON.parse(text.split('\n').find(line => line.startsWith('实际能力及资料目录（元信息）：'))!.slice('实际能力及资料目录（元信息）：'.length));

async function fixture(t: TestContext, setup: { source?: 'both-models' | 'project-model-only' | 'none'; newTask?: boolean; preselected?: 'task' | 'project-material' } = {}) {
  const evidence = path.resolve('.local/overall-architecture-product-gaps/pm05'); await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'integration-')), provider = await startToolProvider(); t.diagnostic(root);
  const dataRoot = path.join(root, 'host'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const models: RuntimeModelConfiguration[] = ['project', 'preparation'].map(id => ({ id, revision: 1, name: `Synthetic ${id}`, provider: 'synthetic', api: 'openai-completions', model: `synthetic-${id}`, apiKey: `synthetic-${id}-PRIVATE_MODEL_SECRET`, baseUrl: provider.baseUrl }));
  const project = await projects.create({ name: '原授权到方案确认', configuration: models[0]! }), task = await projects.createTask(project.id, { name: '原分析任务' });
  const stored = new DbLinkStore({ dataRoot, projectState: id => id === project.id ? { archived: false } : null, taskProject: id => id === task.id ? project.id : null, probe: async () => ({ observation: { reachable: true, sourceIdentity: 'synthetic-native', permissionBinding: 'synthetic-role', queryQualified: true, cancelCapability: 'verified', limitations: ['仅保存配置时观察，尚未读取本轮数据'] }, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true } }) }); await stored.init();
  const tested = await stored.testConnection(connection), saved = await stored.saveConnection(connection, tested.id);
  if (setup.source !== 'none') {
    await stored.grantProject(project.id, { connectionId: saved.id, scope: { objects: ['public.orders', 'public.members'] }, modelExport: { targets: (setup.source === 'project-model-only' ? models.slice(0, 1) : models).map(dbLinkModelOutlet), structure: true, comments: false, queryText: true, results: true } });
    await stored.setTaskPolicy(project.id, task.id, saved.id, { excluded: false, scope: { objects: ['public.orders'] } });
  }
  let driverCalls = 0, started = 0;
  const forbidden = async (): Promise<never> => { driverCalls++; throw new Error('no DB access during preparation or source confirmation'); };
  const dbOptions = { dataRoot, projects, data: new ProjectDataContextStore({ dataRoot, projects }), configurationSnapshot: (id: string, revision?: number) => models.find(model => model.id === id && (revision === undefined || model.revision === revision)), mutate: async <T>(run: () => Promise<T>) => run(), isClosing: () => false, driver: { probe: forbidden, catalog: forbidden, openQuery: forbidden } };
  let db = createDbLinkHost(dbOptions); await db.init();
  const plans = createProjectPlanStore({ dataRoot }), cases = new CaseStore({ dataRoot }); await cases.init();
  const feature = createProjectPlanFeature({ codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), projects, plans, cases, goals: new StrategyGoalsStore(dataRoot), methods: createSapMethodStore(path.join(root, 'sap')), mutate: async run => run(), isClosing: () => false, registerFresh: async () => {}, startMessage: async () => { started++; throw new Error('create-only confirmation cannot start a task'); }, databaseSources: (projectId, read) => db.planningSources(projectId, read) });
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true });
  const sessions = createRequirementSessions({ codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), managementPorts: () => [], sessionDirectory: owner => path.join(projectPlanPreparationDirectory(dataRoot, owner.slice(9)), 'sessions'), workspaceFor: owner => requirementWorkspace(projectPlanPreparationDirectory(dataRoot, owner.slice(9))), configurationSnapshot: (id, revision) => id ? models.find(model => model.id === id && model.revision === revision) : models[1], publish: () => {}, mutate: async run => run(), isClosing: () => false });
  const preparation = createProjectPlanPreparationHost({ dataRoot, projects, plans, sessions, capabilities: feature.capabilities, validate: feature.validate, mutate: async run => run(), isClosing: () => false });
  const plan: ProjectPlanContent = { request: '只核对获准来源清单并形成方案，不提前读取数据库', premises: [], materials: [], coverage: [], tasks: [{ key: 'analysis', name: '分析与综合', ...(setup.newTask ? {} : { taskId: task.id }), selected: true, scope: '确认后沿原授权分析', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'analysis', dependencies: [], caseContext: null };
  if (setup.preselected === 'task') plan.tasks[0]!.capabilities = [ref((await db.planningSources(project.id, { taskId: task.id }))[0]!)];
  if (setup.preselected === 'project-material') plan.materials = [ref((await db.planningSources(project.id))[0]!)];
  let catalog: ProjectPlanCapabilities | undefined, supplied = '';
  const originalSettings = await readFile(stored.settingsPath), sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  t.after(async () => {
    try {
      await sessions.closeAll();
      const currentSettings = await readFile(stored.settingsPath);
      await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ setup, projectId: project.id, originalTaskId: task.id, originalPlan: plan, latestPlanState: await plans.read(project.id), safeCatalog: catalog ?? null, databaseDriverCalls: driverCalls, taskStarts: started, originalSettingsSha256: sha256(originalSettings), finalSettingsSha256: sha256(currentSettings), originalAuthorizationBytesUnchanged: originalSettings.equals(currentSettings), actualPreparationRequests: provider.requests.map(request => ({ model: request.body.model, messages: request.body.messages, tools: request.body.tools, closedEarly: request.closedEarly })), nativeDirectory: path.join(projectPlanPreparationDirectory(dataRoot, project.id), 'sessions'), providerErrors: provider.errors, realDatabase: 'NOT_RUN', realModel: 'NOT_RUN', professionalQuality: 'NOT_RUN' }, null, 2));
    } finally { cases.close(); await projects.close(); await provider.close(); }
  });
  provider.setResponder(context => {
    assert.deepEqual(context.availableTools, []);
    assert.equal(context.request.body.model, models[1]!.model, 'preparation uses current global model, not the project configuration');
    supplied = providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content); catalog = catalogFrom(supplied);
    for (const secret of [connection.host, connection.database, connection.username, connection.password!, ...models.map(model => model.apiKey)]) assert.ok(!supplied.includes(secret), `unrelated configuration must remain Host-only`);
    const chosen = catalog.databaseSources?.find(source => source.taskId === (setup.newTask ? undefined : task.id) && source.enabled);
    return { text: JSON.stringify({ plan: { ...plan, tasks: [{ ...plan.tasks[0]!, capabilities: chosen ? [ref(chosen)] : [] }] }, mece: { sameLevel: '按来源和授权状态核对', coverage: '仅使用所见元信息', boundaries: '保留Task范围及未知', depth: '未读取业务数据' }, limitations: ['只核元信息，不代表数据齐备或质量合格'] }) };
  });
  const prepare = async () => (await preparation.handle(project.id, 'plan/prepare', 'POST', { operationId: randomUUID(), expectedRevision: (await plans.read(project.id)).revision, plan }))!.body as ProjectPlanPreparationResult;
  const confirm = async (prepared: ProjectPlanPreparationResult) => (await feature.handle(project.id, 'plan/confirm', 'POST', { operationId: randomUUID(), expectedRevision: prepared.state.revision, mode: 'create' }))!.body as ProjectPlanConfirmResult;
  return { root, provider, models, projects, project, task, saved, stored, feature, prepare, confirm, db: () => db, catalog: () => catalog!, supplied: () => supplied, driverCalls: () => driverCalls, started: () => started, async changeConfiguration() { const changed = { ...connection, id: saved.id, password: 'PRIVATE_DATABASE_REVISED_PASSWORD' }, tested = await stored.testConnection(changed); await stored.saveConnection(changed, tested.id); db = createDbLinkHost(dbOptions); await db.init(); } };
}

test('PG05 joint: actual Pi recommends the exact effective Task source and create-only confirmation reuses its original grant', { timeout: 25_000 }, async t => {
  const f = await fixture(t), before = await readFile(f.stored.settingsPath, 'utf8'), prepared = await f.prepare();
  assert.equal(prepared.preparation.status, 'completed');
  const chosen = f.catalog().databaseSources!.find(source => source.taskId === f.task.id)!;
  assert.deepEqual(chosen.scope?.objects, ['public.orders']); assert.deepEqual(prepared.draft!.plan.tasks[0]!.capabilities, [ref(chosen)]);
  const confirmed = await f.confirm(prepared);
  assert.deepEqual(confirmed.confirmation.plan.tasks[0]!.capabilities, [ref(chosen)]);
  assert.equal(confirmed.confirmation.tasks[0]!.taskId, f.task.id); assert.equal(confirmed.confirmation.tasks[0]!.startStatus, 'not-requested');
  assert.equal(await readFile(f.stored.settingsPath, 'utf8'), before); assert.equal(f.started(), 0); assert.equal(f.driverCalls(), 0);
});

test('PG05 joint: a newly confirmed Task inherits the existing project source without a second grant', { timeout: 25_000 }, async t => {
  const f = await fixture(t, { newTask: true }), before = await readFile(f.stored.settingsPath, 'utf8'), prepared = await f.prepare(), confirmed = await f.confirm(prepared);
  const taskId = confirmed.confirmation.tasks[0]!.taskId, inherited = (await f.db().planningSources(f.project.id, { taskId }))[0]!;
  assert.deepEqual(confirmed.confirmation.plan.tasks[0]!.capabilities, [ref(inherited)]);
  assert.equal(await readFile(f.stored.settingsPath, 'utf8'), before); assert.equal(f.driverCalls(), 0); assert.equal(f.started(), 0);
});

test('PG05 joint: Task exclusion after preparation refuses the old selected source without restoring its permission', { timeout: 25_000 }, async t => {
  const f = await fixture(t), prepared = await f.prepare();
  assert.equal((await f.db().request('PUT', `/api/projects/${f.project.id}/tasks/${f.task.id}/db-link/sources/${f.saved.id}`, { excluded: true }))!.status, 200);
  await assert.rejects(f.confirm(prepared), { code: 'project_plan_connector_permission_required' });
  assert.equal((await f.db().planningSources(f.project.id, { taskId: f.task.id }))[0]!.state, 'excluded');
  assert.equal(f.started(), 0); assert.equal(f.driverCalls(), 0);
});

test('PG05 joint: a saved connection revision change refuses the confirmed draft old source without silently substituting or regranting', { timeout: 25_000 }, async t => {
  const f = await fixture(t), prepared = await f.prepare(), exact = structuredClone(prepared.draft!.plan.tasks[0]!.capabilities);
  await f.changeConfiguration();
  await assert.rejects(f.confirm(prepared), { code: 'project_plan_connector_permission_required' });
  const source = (await f.db().planningSources(f.project.id, { taskId: f.task.id }))[0]!;
  assert.equal(source.state, 'configuration-changed'); assert.equal(source.version, '1');
  const unchanged = (await f.feature.handle(f.project.id, 'plan', 'GET'))!.body;
  assert.ok('draft' in unchanged && unchanged.draft);
  assert.deepEqual(unchanged.draft!.plan.tasks[0]!.capabilities, exact);
  assert.equal(f.started(), 0); assert.equal(f.driverCalls(), 0);
});

for (const source of ['none', 'project-model-only'] as const) test(`PG05 joint: ${source} gives the actual preparation model no unauthorized database recommendation`, { timeout: 25_000 }, async t => {
  const f = await fixture(t, { source }), prepared = await f.prepare();
  assert.deepEqual(f.catalog().databaseSources, []); assert.deepEqual(prepared.draft!.plan.tasks[0]!.capabilities, []);
  assert.ok(!f.supplied().includes(connection.name)); assert.ok(!f.supplied().includes('public.orders'));
  if (source === 'project-model-only') assert.ok((await f.feature.capabilities(f.project.id)).databaseSources.length > 0, 'local user still sees the project source; it was filtered specifically for the actual preparation model');
  assert.equal(f.driverCalls(), 0); assert.equal(f.started(), 0);
});

test('PG05 outlet guard: an already selected exact Task source remains valid for the captured preparation model and original Task scope', { timeout: 25_000 }, async t => {
  const f = await fixture(t, { preselected: 'task' }), prepared = await f.prepare();
  assert.equal(prepared.preparation.status, 'completed');
  const exact = f.catalog().databaseSources!.find(source => source.taskId === f.task.id)!;
  assert.deepEqual(prepared.draft!.plan.tasks[0]!.capabilities, [ref(exact)]);
  assert.equal(f.provider.requests.length, 1); assert.equal(f.driverCalls(), 0);
});

for (const preselected of ['task', 'project-material'] as const) test(`PG05 outlet guard: the ${preselected} selected for project model A is rejected before preparing with unauthorized model B`, { timeout: 25_000 }, async t => {
  const f = await fixture(t, { source: 'project-model-only', preselected }), before = await readFile(f.stored.settingsPath);
  await assert.rejects(f.prepare(), { code: 'project_plan_source_model_permission_required', status: 403 });
  assert.equal(f.provider.requests.length, 0, 'neither source ref nor metadata may reach the unauthorized preparation model');
  assert.deepEqual(await readFile(f.stored.settingsPath), before, 'the guard never widens or repeats authorization');
  const untouched = (await f.feature.handle(f.project.id, 'plan', 'GET'))!.body;
  assert.ok('revision' in untouched); assert.equal(untouched.revision, 0);
  assert.equal(f.driverCalls(), 0); assert.equal(f.started(), 0);
});

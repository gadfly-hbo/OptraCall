import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { requirementSessionDirectory, requirementWorkspace } from '../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { buildGenerationPrompt, parseModelJson, normalizeElicit } from '../extensions/business-plugins/requirements-elaboration/session/prompts.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';
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
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import type { DbLinkConnectionInput } from '../src/host/db-link-types.ts';
import type { DbLinkPlanningSource } from '../src/host/db-link-planning.ts';
import type { ProjectPlanCapabilities, ProjectPlanContent, ProjectPlanPreparationResult } from '../src/host/project-plan-types.ts';

const elicitJson = '```json\n' + JSON.stringify({
  clarifications: [
    { category: '指标口径', priority: 'must_confirm', question: '复购是否剔除退款单？', rationale: '影响分子' },
    { category: '对象/人群', priority: 'must_confirm', question: '分母只算大促首购会员吗？', rationale: '人群口径' },
  ],
  facts: ['双11复购率环比下滑'],
  hypotheses: [{ statement: '高额满减券吸引羊毛党', evidence: '券核销上升', validationCondition: '券核销用户复购率更低' }],
}) + '\n```';

async function fixture(t: TestContext) {
  const provider = await startSyntheticProvider();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-requirement-session-'));
  const instanceDirectory = path.join(scratch, 'req-test-001');
  await mkdir(instanceDirectory, { recursive: true });
  const agents: ProjectAgent[] = [];
  const create = () => {
    const agent = new ProjectAgent({
      projectId: 'requirement:req-test-001',
      workspace: requirementWorkspace(instanceDirectory),
      sessionDirectory: requirementSessionDirectory(instanceDirectory),
      resourceRoot: path.join(scratch, 'resources'),
      codeRoot: process.cwd(),
      managementPorts: [4173, 4174, 4175],
      configuration: { id: 'synthetic', name: 'Synthetic', revision: 1, provider: 'synthetic', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-only-key' },
    });
    agents.push(agent);
    return agent;
  };
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); await rm(scratch, { recursive: true, force: true }); });
  return { provider, create, instanceDirectory };
}

test('RE-03: a plugin workspace session has no data tools and carries the requirement system prompt', async t => {
  const f = await fixture(t), agent = f.create();
  const snapshot = await agent.open();
  assert.deepEqual(snapshot.tools, [], 'requirement sessions must not carry data or shell tools');
  const run = agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'prompt-check');
  await run.completion;
  const request = JSON.stringify(f.provider.requests.at(-1)!.body.messages);
  assert.match(request, /需求梳理助手/);
  assert.match(request, /没有数据访问工具/);
  assert.doesNotMatch(request, /010_draw/, 'plugin sessions must not inherit project directory conventions');
});

test('RE-03: elicit generation returns parseable structured JSON end to end', async t => {
  const f = await fixture(t), agent = f.create();
  f.provider.setChunks([elicitJson]);
  await agent.open();
  const result = await agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'elicit-run').completion;
  assert.equal(result.outcome, 'completed');
  const proposal = normalizeElicit(parseModelJson(result.text), { ...sampleInstance(), clarifications: [], hypotheses: [] });
  assert.equal(proposal.clarifications.length, 2);
  assert.equal(proposal.hypotheses[0]!.id, 'hyp-1');
  assert.equal(proposal.hypotheses[0]!.status, 'proposed');
});

test('RE-03: the session persists its native JSONL inside the requirement instance directory', async t => {
  const f = await fixture(t), agent = f.create();
  f.provider.setChunks([elicitJson]);
  await agent.open();
  const result = await agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'persist-run').completion;
  assert.equal(result.outcome, 'completed');
  const sessions = await readdir(requirementSessionDirectory(f.instanceDirectory));
  assert.equal(sessions.filter(name => name.endsWith('.jsonl')).length, 1);
});

test('RE-03: stop settles the plugin session as cancelled exactly once', async t => {
  const f = await fixture(t), agent = f.create();
  f.provider.setMode('slow');
  await agent.open();
  const events: any[] = []; agent.subscribe(event => events.push(event));
  const running = agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'cancel-run');
  await f.provider.waitForRequests(1);
  await agent.stop();
  assert.equal((await running.completion).outcome, 'cancelled');
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === 'cancel-run').length, 1);
});

// R-03 uses the already approved Host runtime-construction seam in this file.
// The wrapper owns only its open-return gate. Every SDK action still goes to
// the real ProjectAgent and unchanged official worker through public methods.
const r03Connection: DbLinkConnectionInput = { name: 'R03合成交易库元信息', engine: 'postgresql', host: 'r03.synthetic.invalid', port: 5432, database: 'R03_PRIVATE_DB', username: 'R03_PRIVATE_USER', password: 'R03_PRIVATE_PASSWORD', tls: { rejectUnauthorized: true, verifyIdentity: true }, budget: { connectTimeoutMs: 1000, queryTimeoutMs: 5000, lockTimeoutMs: 1000, maxRows: 100, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000, maxConcurrent: 1 } };
const r03Ref = (source: DbLinkPlanningSource) => ({ kind: 'connector' as const, id: source.id, version: source.version, sha256: source.sha256, permissionRef: source.permissionRef });
const r03Hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function r03Deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

async function r03Fixture(t: TestContext, setup: { preselected?: 'both' | 'unselected-task'; initialModel?: 0 | 1; newSource?: boolean } = {}) {
  const evidence = path.resolve('.local/overall-architecture-product-r-fixes/r03'); await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'dispatch-')), provider = await startToolProvider(); t.diagnostic(root);
  const dataRoot = path.join(root, 'host'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const models: RuntimeModelConfiguration[] = ['a', 'b'].map(id => ({ id: `r03-${id}`, revision: 1, name: `Synthetic R03 ${id}`, provider: 'synthetic', api: 'openai-completions', model: `synthetic-r03-${id}`, apiKey: `synthetic-r03-${id}-SECRET`, baseUrl: provider.baseUrl }));
  let selectedModel = setup.initialModel ?? 1, currentModelReads = 0, mutationTail = Promise.resolve();
  const mutate = <T,>(run: () => T | Promise<T>): Promise<T> => { const pending = mutationTail.then(run); mutationTail = pending.then(() => {}, () => {}); return pending; };
  const project = await projects.create({ name: 'R03派发权限窗口', configuration: models[0]! }), task = await projects.createTask(project.id, { name: '原分析任务' });
  const deferredTask = setup.preselected === 'unselected-task' ? await projects.createTask(project.id, { name: '原暂不执行任务' }) : undefined;
  const other = await projects.create({ name: 'R03无关项目', configuration: models[0]! });
  const stored = new DbLinkStore({ dataRoot, projectState: id => [project.id, other.id].includes(id) ? { archived: false } : null, taskProject: id => [task.id, deferredTask?.id].includes(id) ? project.id : null, probe: async () => ({ observation: { reachable: true, sourceIdentity: 'r03-synthetic-source', permissionBinding: 'r03-synthetic-role', queryQualified: true, cancelCapability: 'verified', limitations: ['仅合成连接配置观察，无数据库连接'] }, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true } }) }); await stored.init();
  const tested = await stored.testConnection(r03Connection), saved = await stored.saveConnection(r03Connection, tested.id);
  const extraConnection = { ...r03Connection, name: 'R03目录生成后新增且未出站的来源', host: 'r03-new.synthetic.invalid' };
  const extraSaved = setup.newSource ? await stored.saveConnection(extraConnection, (await stored.testConnection(extraConnection)).id) : undefined;
  const modelExport = { targets: models.map(dbLinkModelOutlet), structure: true, comments: false, queryText: true, results: true };
  for (const projectId of [project.id, other.id]) await stored.grantProject(projectId, { connectionId: saved.id, scope: { objects: ['public.orders', 'public.members'] }, modelExport });
  await stored.setTaskPolicy(project.id, task.id, saved.id, { excluded: false, scope: { objects: ['public.orders', 'public.members'] } });
  let driverCalls = 0;
  const forbidden = async (): Promise<never> => { driverCalls++; throw new Error('R03 preparation must never call a DB driver'); };
  const db = createDbLinkHost({ dataRoot, projects, data: new ProjectDataContextStore({ dataRoot, projects }), configurationSnapshot: (id, revision) => models.find(model => model.id === id && (revision === undefined || model.revision === revision)), mutate, isClosing: () => false, driver: { probe: forbidden, catalog: forbidden, openQuery: forbidden } }); await db.init();
  const plans = createProjectPlanStore({ dataRoot }), cases = new CaseStore({ dataRoot }); await cases.init();
  const feature = createProjectPlanFeature({ codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), projects, plans, cases, goals: new StrategyGoalsStore(dataRoot), methods: createSapMethodStore(path.join(root, 'sap')), mutate, isClosing: () => false, registerFresh: async () => {}, startMessage: async () => { throw new Error('R03 preparation cannot start a Task'); }, databaseSources: (projectId, read) => db.planningSources(projectId, read) });
  const opened = r03Deferred<import('../src/agent/project-runtime.ts').ProjectSnapshot>(), release = r03Deferred<void>();
  let actualModel: string | undefined, openSnapshot: import('../src/agent/project-runtime.ts').ProjectSnapshot | undefined, firstCatalog: ProjectPlanCapabilities | undefined;
  const projectionReads: { outlet?: string; sources: DbLinkPlanningSource[] }[] = [];
  const sessions = createRequirementSessions({ codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), managementPorts: () => [], sessionDirectory: owner => path.join(projectPlanPreparationDirectory(dataRoot, owner.slice(9)), 'sessions'), workspaceFor: owner => requirementWorkspace(projectPlanPreparationDirectory(dataRoot, owner.slice(9))), configurationSnapshot: (id, revision) => id ? models.find(model => model.id === id && model.revision === revision) : (currentModelReads++, models[selectedModel]), publish: () => {}, mutate, isClosing: () => false,
    createAgent(options) {
      actualModel = options.configuration.model;
      const real = new ProjectAgent(options);
      return {
        get alive() { return real.alive; }, get busy() { return real.busy; }, get pendingUI() { return real.pendingUI; },
        async open() { const snapshot = await real.open(); openSnapshot = snapshot; opened.resolve(snapshot); await release.promise; return snapshot; },
        snapshot: () => real.snapshot(), subscribe: listener => real.subscribe(listener), start: (...args) => real.start(...args), startCommand: (...args) => real.startCommand(...args), stop: (...args) => real.stop(...args), close: (...args) => real.close(...args), respondUI: input => real.respondUI(input), setEditorState: text => real.setEditorState(text), drain: () => real.drain(), recordAutomaticAction: data => real.recordAutomaticAction(data),
      };
    },
  });
  const preparation = createProjectPlanPreparationHost({ dataRoot, projects, plans, sessions, capabilities: async (projectId, read) => { const catalog = await feature.capabilities(projectId, read); firstCatalog ??= structuredClone(catalog); projectionReads.push({ outlet: read?.modelOutlet, sources: structuredClone(catalog.databaseSources) }); return catalog; }, validate: feature.validate, mutate, isClosing: () => false });
  const plan: ProjectPlanContent = { request: '只准备获准来源的元信息，不读取数据库', premises: [], materials: [], coverage: [], tasks: [{ key: 'analysis', taskId: task.id, name: '分析与综合', selected: true, scope: '确认后分析', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'analysis', dependencies: [], caseContext: null };
  if (setup.preselected === 'both') { plan.materials = [r03Ref((await db.planningSources(project.id))[0]!)]; plan.tasks[0]!.capabilities = [r03Ref((await db.planningSources(project.id, { taskId: task.id }))[0]!)]; }
  if (deferredTask) { plan.taskMode = 'multi'; plan.tasks.push({ key: 'deferred', taskId: deferredTask.id, name: '暂不执行但原样保留的任务', selected: false, scope: '仍会送入准备上下文的原选材', capabilities: [r03Ref((await db.planningSources(project.id, { taskId: deferredTask.id }))[0]!)] }); }
  const originalPlan = structuredClone(plan), originalSettings = await readFile(stored.settingsPath);
  let settingsAfterUserChange: Buffer | undefined, observation: unknown, mutation: unknown;
  provider.setResponder(context => { assert.deepEqual(context.availableTools, []); return { text: JSON.stringify({ plan, mece: { sameLevel: '只核合成元信息', coverage: '保留原范围', boundaries: '不进行分析', depth: '无业务明细读取' }, limitations: ['本测试只证明工程权限边界'] }) }; });
  t.after(async () => {
    release.resolve();
    try {
      await sessions.closeAll();
      const finalSettings = await readFile(stored.settingsPath);
      await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ setup, projectId: project.id, taskId: task.id, mutation, observation, originalPlan, finalInputPlan: plan, unchangedInputSelection: JSON.stringify(plan) === JSON.stringify(originalPlan), firstCatalog, projectionReads, actualModel, currentModelReads, openSnapshot, originalSettingsSha256: r03Hash(originalSettings), settingsAfterUserChangeSha256: settingsAfterUserChange && r03Hash(settingsAfterUserChange), finalSettingsSha256: r03Hash(finalSettings), authorizationUnchangedAfterUserChange: (settingsAfterUserChange ?? originalSettings).equals(finalSettings), driverCalls, latestPlanState: await plans.read(project.id), providerRequests: provider.requests.map(request => ({ model: request.body.model, messages: request.body.messages, tools: request.body.tools, closedEarly: request.closedEarly })), providerErrors: provider.errors, realExternalModel: 'NOT_RUN', realDatabase: 'NOT_RUN', professionalQuality: 'NOT_RUN', historicalPmReview: 'Static findings only; the PM did not execute this race.' }, null, 2));
    } finally { cases.close(); await projects.close(); await provider.close(); }
  });
  async function begin() {
    const running = preparation.handle(project.id, 'plan/prepare', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan }).then(value => ({ value }), error => ({ error }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([opened.promise, running.then(result => { observation = 'error' in result ? { code: result.error?.code, message: result.error?.message, stack: result.error?.stack } : { result: result.value }; throw new Error(`R03 fixture failure: preparation settled before actual worker open gate: ${JSON.stringify(observation)}`); }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('R03 fixture failure: actual worker open gate not reached')), 10_000); })]); } finally { clearTimeout(timer); }
    assert.ok(firstCatalog?.databaseSources?.some(source => source.title === r03Connection.name), 'source catalog must already exist before the worker gate');
    assert.deepEqual(openSnapshot!.tools, []); assert.match(openSnapshot!.sdkVersion, /^\d+\.\d+\.\d+/);
    assert.equal(provider.requests.length, 0, 'no first dispatch while open-return gate is held');
    return { running };
  }
  async function change(method: string, route: string, input?: unknown) { const result = await db.request(method, route, input); assert.equal(result?.status, 200, JSON.stringify(result)); mutation = { method, route, input, result }; settingsAfterUserChange = await readFile(stored.settingsPath); return result; }
  async function settle(running: Awaited<ReturnType<typeof begin>>['running']) { release.resolve(); const result = await running; observation = 'error' in result ? { code: result.error?.code, message: result.error?.message } : { result: result.value }; return result; }
  async function assertPreserved() { assert.deepEqual(plan, originalPlan); assert.deepEqual(await readFile(stored.settingsPath), settingsAfterUserChange ?? originalSettings); assert.equal(driverCalls, 0); assert.deepEqual(provider.errors, []); assert.equal((await projects.get(project.id)).tasks.length, deferredTask ? 2 : 1); }
  return { root, db, models, project, task, deferredTask, other, saved, extraSaved, plan, plans, provider, begin, change, settle, assertPreserved, setCurrentModel(index: 0 | 1) { selectedModel = index; }, projectionReads, actualModel: () => actualModel, currentModelReads: () => currentModelReads };
}

test('R-03: an unselected source revoked after catalog capture never reaches the first Provider dispatch', { timeout: 25_000 }, async t => {
  const f = await r03Fixture(t), { running } = await f.begin();
  await f.change('DELETE', `/api/projects/${f.project.id}/db-link/sources/${f.saved.id}`);
  const result = await f.settle(running);
  await f.assertPreserved();
  assert.equal(f.provider.requests.length, 0, 'revoked source metadata must not be dispatched from the stale catalog');
  assert.ok('error' in result); assert.equal(result.error.code, 'project_plan_source_permissions_changed'); assert.equal(result.error.status, 403);
  assert.equal((await f.plans.read(f.project.id)).draft, undefined);
});

for (const preselected of [undefined, 'both'] as const) test(`R-03: removing the captured B outlet during worker open rejects ${preselected ?? 'unselected metadata'} even when the global choice becomes A`, { timeout: 25_000 }, async t => {
  const f = await r03Fixture(t, { preselected }), { running } = await f.begin();
  f.setCurrentModel(0);
  await f.change('POST', `/api/projects/${f.project.id}/db-link/sources`, { connectionId: f.saved.id, scope: { objects: ['public.orders', 'public.members'] }, modelExport: { targets: ['r03-a@1'], structure: true, comments: false, queryText: true, results: true } });
  const result = await f.settle(running);
  await f.assertPreserved();
  assert.equal(f.provider.requests.length, 0, 'both original refs and the captured B catalog remain subject to B outlet permission');
  assert.ok('error' in result); assert.equal(result.error.code, 'project_plan_source_permissions_changed'); assert.equal(result.error.status, 403);
  assert.equal(f.actualModel(), 'synthetic-r03-b'); assert.equal(f.currentModelReads(), 1);
  assert.equal((await f.plans.read(f.project.id)).draft, undefined);
});

for (const change of ['excluded', 'narrowed'] as const) test(`R-03: Task source ${change} after catalog capture blocks stale unselected source metadata`, { timeout: 25_000 }, async t => {
  const f = await r03Fixture(t), { running } = await f.begin();
  await f.change('PUT', `/api/projects/${f.project.id}/tasks/${f.task.id}/db-link/sources/${f.saved.id}`, change === 'excluded' ? { excluded: true } : { excluded: false, scope: { objects: ['public.orders'] } });
  const result = await f.settle(running);
  await f.assertPreserved();
  assert.equal(f.provider.requests.length, 0, 'the sent source catalog must reflect exact current Task policy');
  assert.ok('error' in result); assert.equal(result.error.code, 'project_plan_source_permissions_changed'); assert.equal(result.error.status, 403);
  assert.equal((await f.plans.read(f.project.id)).draft, undefined);
});

test('R-03: an unselected Task original ref is rechecked while remaining in the preparation input', { timeout: 25_000 }, async t => {
  const f = await r03Fixture(t, { preselected: 'unselected-task' }), { running } = await f.begin();
  await f.change('PUT', `/api/projects/${f.project.id}/tasks/${f.deferredTask!.id}/db-link/sources/${f.saved.id}`, { excluded: true });
  const result = await f.settle(running);
  await f.assertPreserved();
  assert.equal(f.provider.requests.length, 0, 'selected:false does not authorize dispatching its original now-disallowed refs');
  assert.ok('error' in result); assert.equal(result.error.code, 'project_plan_source_permissions_changed'); assert.equal(result.error.status, 403);
});

for (const initialModel of [0, 1] as const) test(`R-03: unrelated project authorization changes preserve captured model ${initialModel === 0 ? 'A' : 'B'} dispatch and exact original selections`, { timeout: 25_000 }, async t => {
  const f = await r03Fixture(t, { preselected: 'both', initialModel }), { running } = await f.begin();
  f.setCurrentModel(initialModel === 0 ? 1 : 0);
  await f.change('DELETE', `/api/projects/${f.other.id}/db-link/sources/${f.saved.id}`);
  const result = await f.settle(running);
  await f.assertPreserved();
  assert.ok('value' in result, 'unrelated authority must not cause a global grant-revision false failure');
  const prepared = result.value!.body as ProjectPlanPreparationResult;
  assert.equal(prepared.preparation.status, 'completed'); assert.deepEqual(prepared.draft!.plan.materials, f.plan.materials); assert.deepEqual(prepared.draft!.plan.tasks[0]!.capabilities, f.plan.tasks[0]!.capabilities);
  assert.equal(f.provider.requests.length, 1); assert.equal(f.provider.requests[0]!.body.model, f.models[initialModel]!.model); assert.equal(f.actualModel(), f.models[initialModel]!.model); assert.equal(f.currentModelReads(), 1);
  assert.ok(f.projectionReads.every(read => read.outlet === dbLinkModelOutlet(f.models[initialModel]!)), 'all projection reads use this lease capture, never a later global model');
  const userText = providerMessageText(f.provider.requests[0]!.body.messages!.find(message => message.role === 'user')!.content);
  assert.ok(userText.includes(r03Connection.name));
  for (const secret of [r03Connection.host, r03Connection.database, r03Connection.username, r03Connection.password!, ...f.models.map(model => model.apiKey)]) assert.ok(!userText.includes(secret));
});

test('R-03: a newly granted unsent source in the same project does not invalidate an unchanged captured catalog', { timeout: 25_000 }, async t => {
  const f = await r03Fixture(t, { preselected: 'both', newSource: true }), { running } = await f.begin();
  await f.change('POST', `/api/projects/${f.project.id}/db-link/sources`, { connectionId: f.extraSaved!.id, scope: { objects: ['public.orders'] }, modelExport: { targets: ['r03-a@1', 'r03-b@1'], structure: true, comments: false, queryText: true, results: true } });
  const result = await f.settle(running);
  await f.assertPreserved();
  assert.ok('value' in result, 'a source absent from the outbound prompt cannot invalidate otherwise unchanged source permissions');
  const prepared = result.value!.body as ProjectPlanPreparationResult;
  assert.equal(prepared.preparation.status, 'completed'); assert.deepEqual(prepared.draft!.plan.materials, f.plan.materials); assert.deepEqual(prepared.draft!.plan.tasks[0]!.capabilities, f.plan.tasks[0]!.capabilities);
  assert.equal(f.provider.requests.length, 1);
  const userText = providerMessageText(f.provider.requests[0]!.body.messages!.find(message => message.role === 'user')!.content);
  assert.ok(userText.includes(r03Connection.name)); assert.ok(!userText.includes('R03目录生成后新增且未出站的来源'), 'the Host neither rebuilds the original prompt nor silently adds a source');
});

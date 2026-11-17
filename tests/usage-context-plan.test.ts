import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProjectPlanStore } from '../src/host/project-plan-store.ts';
import { parseProjectPlanPreparationResponse } from '../src/host/project-plan-preparation.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import { createProjectPlanFeature } from '../src/host/project-plan-host.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { createUsageContextStore } from '../src/host/usage-context-store.ts';

const plan = () => ({ request: '安排本轮可核对的工作', premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '核对与综合', selected: true, scope: '按当前背景核对', capabilities: [] }], taskMode: 'single' as const, summaryTaskKey: 'work', dependencies: [], caseContext: null });

test('A02/A15: a current-work usage survives the original Plan save/reopen and the preparation Agent cannot change it', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-usage-plan-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const projectId = randomUUID(), usageContext = { kind: 'personal' as const, background: '事业与家庭的本轮取舍' };
  const selected = { ...plan(), usageContext };
  await createProjectPlanStore({ dataRoot }).saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: selected });
  assert.deepEqual((await createProjectPlanStore({ dataRoot }).read(projectId)).draft?.plan.usageContext, usageContext);
  const input = { projectId, projectName: '本轮工作', plan: selected, capabilities: { skills: [], methods: [], connectors: [], materials: [], caseContexts: [] }, existingTasks: [] };
  const response = { plan: selected, mece: { sameLevel: '同层', coverage: '范围内', boundaries: '明确', depth: '轻量' }, limitations: [] };
  assert.deepEqual(parseProjectPlanPreparationResponse(JSON.stringify(response), input).plan.usageContext, usageContext);
  const changed = structuredClone(response); changed.plan.usageContext = { kind: 'organization' as never, background: '错误采用今日默认' };
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(changed), input), /project_plan_preparation_context/);
  const removed = { ...response, plan: plan() };
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(removed), input), /project_plan_preparation_context/);
});

test('A10/A12: an exact Goal basis is frozen with the original Plan and cannot be removed by preparation', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-goal-basis-plan-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const projectId = randomUUID(), goalBasis = { relations: [{ id: randomUUID(), revision: 2, sha256: 'a'.repeat(64) }], feedback: [] };
  const selected = { ...plan(), goalBasis };
  const saved = await createProjectPlanStore({ dataRoot }).saveDraft(projectId, { operationId: randomUUID(), expectedRevision: 0, plan: selected });
  assert.deepEqual(saved.draft.plan.goalBasis, goalBasis);
  const input = { projectId, projectName: '准确依据', plan: selected, capabilities: { skills: [], methods: [], connectors: [], materials: [], caseContexts: [] }, existingTasks: [] };
  const response = { plan: plan(), mece: { sameLevel: '同层', coverage: '范围内', boundaries: '明确', depth: '轻量' }, limitations: [] };
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(response), input), /project_plan_preparation_context/);
});

test('A01/A02/A15: only new Plans choose explicit work, exact Goal, then default; retries and legacy Plans retain their own background', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-usage-plan-')), dataRoot = path.join(root, 'host');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await rm(root, { recursive: true, force: true }); });
  const goals = new StrategyGoalsStore(dataRoot), cases = new CaseStore({ dataRoot }), plans = createProjectPlanStore({ dataRoot });
  const settings = createUsageContextStore({ dataRoot });
  await settings.update({ operationId: randomUUID(), expectedRevision: 0, context: { kind: 'organization', background: '默认组织背景' } });
  const feature = createProjectPlanFeature({ codeRoot: process.cwd(), resourceRoot: path.join(dataRoot, 'pi'), projects, cases, goals, plans, methods: createSapMethodStore(path.join(dataRoot, 'metric-assets')), mutate: async run => run(), isClosing: () => false, startMessage: async () => { throw new Error('draft must not start Task'); }, registerFresh: async () => {}, defaultUsageContext: async () => (await settings.read()).context });
  const configuration = { id: 'synthetic', name: '合成配置', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1', revision: 1 };
  const create = () => projects.create({ name: '当前工作', configuration });
  const fresh = await create(), input = { operationId: randomUUID(), expectedRevision: 0, plan: plan() };
  const saved = (await feature.handle(fresh.id, 'plan/draft', 'POST', input))!.body as any;
  assert.deepEqual(saved.draft.plan.usageContext, { kind: 'organization', background: '默认组织背景' });
  const target = goals.create({ operationId: randomUUID(), title: '个人的准确目标', outcome: '核清事业安排', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人事业' }, measurement: { kind: 'deliverable', criterion: '可核对的安排' }, baseline: { state: 'pending', description: '待补充' }, responsible: '本人', usageContext: { kind: 'personal', background: '来自目标v1的事业背景' } });
  goals.adopt(target, { operationId: randomUUID(), expectedVersion: 1, decision: '采用此准确目标' });
  const withGoal = await create(), goalPlan = { ...plan(), goalContext: { goal: { goalId: target.goalId, version: 1 }, purpose: 'query' as const } };
  const goalSaved = (await feature.handle(withGoal.id, 'plan/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan: goalPlan }))!.body as any;
  assert.deepEqual(goalSaved.draft.plan.usageContext, { kind: 'personal', background: '来自目标v1的事业背景' });
  const explicit = await create(), explicitUsage = { kind: 'department' as const, background: '本次改为用户明确的部门工作' };
  const explicitSaved = (await feature.handle(explicit.id, 'plan/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan: { ...goalPlan, usageContext: explicitUsage } }))!.body as any;
  assert.deepEqual(explicitSaved.draft.plan.usageContext, explicitUsage);
  await settings.update({ operationId: randomUUID(), expectedRevision: 1, context: { kind: 'personal', background: '后来的家庭默认' } });
  const replayed = (await feature.handle(fresh.id, 'plan/draft', 'POST', input))!.body as any;
  assert.equal(replayed.replayed, true); assert.deepEqual(replayed.draft.plan.usageContext, saved.draft.plan.usageContext);
  const legacy = await create(); await plans.saveDraft(legacy.id, { operationId: randomUUID(), expectedRevision: 0, plan: plan() });
  const old = (await feature.handle(legacy.id, 'plan/draft', 'POST', { operationId: randomUUID(), expectedRevision: 1, plan: plan() }))!.body as any;
  assert.equal(old.draft.plan.usageContext, undefined);
});

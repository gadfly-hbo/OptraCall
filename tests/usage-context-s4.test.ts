import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { parseProjectPlanPreparationResponse } from '../src/host/project-plan-preparation.ts';

test('S4: a saved default draft follows a later exact Case Goal through reopen, confirmation and actual Provider/native', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(); let host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown) => { const response = await host.request(route, method, body); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  await request('/api/settings/usage-context', 'PUT', { operationId: randomUUID(), expectedRevision: 0, context: { kind: 'organization', background: 'S4_AUTOMATIC_ORGANIZATION_DEFAULT' } });
  await request('/api/configuration', 'PUT', { name: 'S4合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-s4-only', apiKey: 'synthetic-s4-only' });
  const { project } = await request('/api/projects', 'POST', { name: '先建项目再选Case' });
  const plan = { request: '保留本轮的准确背景', premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '核对与综合', selected: true, scope: '按当前准确对象工作', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'work', dependencies: [], caseContext: null };
  const base = `/api/projects/${project.id}/plan`;
  const initial = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  assert.equal(initial.draft.plan.usageContext.kind, 'organization');
  const usage = { kind: 'personal', background: 'S4_EXACT_PERSONAL_FAMILY_GOAL' };
  const { goal } = await request('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: '本人的家庭目标', outcome: '核对家庭安排', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人家庭' }, measurement: { kind: 'deliverable', criterion: '可核对的安排' }, baseline: { state: 'pending', description: '待补充' }, responsible: '本人', usageContext: usage });
  await request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), expectedVersion: 1, version: 1, decision: '明确采用家庭目标v1' });
  await request('/api/cases/storage/initialize', 'POST', {});
  const primary = { goalId: goal.goalId, version: 1 };
  const { case: current } = await request('/api/cases', 'POST', { operationId: randomUUID(), title: '家庭安排持续事项', description: '本人明确的持续问题', goalBinding: { primary, related: [] } });
  await request(`/api/cases/${current.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: current.revision, projectId: project.id });
  const context = (await request(base + '/capabilities')).caseContexts.find((item: any) => item.caseId === current.id);
  const selected = { ...initial.draft.plan, goalContext: { goal: primary, purpose: 'case-investigation' }, caseContext: { caseId: current.id, primaryGoal: primary, relatedGoals: [], caseRevision: context.caseRevision, projectWorkRevision: context.projectWorkRevision } };
  await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: initial.state.revision, plan: selected });
  const roots = { dataRoot: host.dataRoot, projectsRoot: host.projectsRoot };
  await host.close(); host = await startTestHost(roots);
  const reopened = await request(base); let outgoing: any;
  provider.setResponder(call => {
    const text = providerMessageText([...call.messages].reverse().find(message => message.role === 'user')?.content);
    outgoing = JSON.parse(text.split('\n').find(line => line.startsWith('{"projectId":'))!);
    return { text: '合成核对仅沿本次准确家庭背景。' };
  });
  const confirmed = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: reopened.revision, mode: 'start' });
  const receipt = confirmed.confirmation.tasks[0]; let state: any; const deadline = Date.now() + 15_000;
  do { state = await request(`/api/projects/${project.id}/tasks/${receipt.taskId}`); if (state.task.lastRun?.status === 'completed' && state.snapshot.status === 'idle') break; await delay(25); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed');
  assert.deepEqual(outgoing.usageContext, usage);
  assert.deepEqual(reopened.draft.plan.usageContext, usage);
  assert.equal(reopened.draft.plan.usageContextOrigin, 'goal');
  const entries = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const started = entries.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started');
  assert.deepEqual(started.data.providedContext.projectPlan.usageContext, usage);
  assert.equal(started.data.providedContext.projectPlan.usageContextOrigin, 'goal');
  assert.deepEqual(started.data.providedContext.projectPlan.goalSourceRefs, [primary]);
  assert.equal(provider.requests.length, 1); assert.deepEqual(provider.errors, []);
});

test('S4: an unconfirmed Goal-derived draft follows a new exact department Goal without changing explicit, legacy or confirmed work', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown) => { const response = await host.request(route, method, body); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: 'S4直接目标', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-s4-direct', apiKey: 'synthetic-s4-direct' });
  await request('/api/settings/usage-context', 'PUT', { operationId: randomUUID(), expectedRevision: 0, context: { kind: 'organization', background: 'S4_DIRECT_DEFAULT' } });
  const goal = async (kind: 'personal' | 'department') => {
    const usageContext = { kind, background: `S4_EXACT_${kind.toUpperCase()}_WORK` };
    const { goal } = await request('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: kind + '准确目标', outcome: '核清工作安排', perspective: 'personal', scope: { kind, id: kind, name: kind + '适用范围' }, measurement: { kind: 'deliverable', criterion: '准确工作依据' }, baseline: { state: 'pending', description: '待补' }, responsible: '用户明确责任人', usageContext });
    await request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), expectedVersion: 1, version: 1, decision: '采用准确第一版' });
    return { ref: { goalId: goal.goalId, version: 1 }, usageContext };
  };
  const personal = await goal('personal'), department = await goal('department');
  const blankPlan = { request: '核对本轮适用对象', premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '核对与综合', selected: true, scope: '使用准确用途', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'work', dependencies: [], caseContext: null };
  const { project } = await request('/api/projects', 'POST', { name: '直接换目标' });
  const base = `/api/projects/${project.id}/plan`;
  const first = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan: { ...blankPlan, goalContext: { goal: personal.ref, purpose: 'query' } } });
  assert.equal(first.draft.plan.usageContextOrigin, 'goal');
  const input = { operationId: randomUUID(), expectedRevision: first.state.revision, plan: { ...first.draft.plan, goalContext: { goal: department.ref, purpose: 'query' } } };
  const changed = await request(base + '/draft', 'POST', input);
  assert.deepEqual(changed.draft.plan.usageContext, department.usageContext);
  assert.equal(changed.draft.plan.usageContextOrigin, 'goal');
  const confirmed = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: changed.state.revision, mode: 'create' });
  await request('/api/settings/usage-context', 'PUT', { operationId: randomUUID(), expectedRevision: 1, context: { kind: 'personal', background: 'S4_LATER_DEFAULT' } });
  const same = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: confirmed.state.revision, plan: { ...confirmed.confirmation.plan, usageContext: { kind: 'organization', background: 'S4_STALE_UI_SUGGESTION' }, usageContextOrigin: 'default' } });
  assert.deepEqual(same.draft.plan.usageContext, department.usageContext);
  assert.deepEqual((await request(base)).history[0].plan, confirmed.confirmation.plan);
  for (const origin of ['explicit', undefined] as const) {
    const { project: fixed } = await request('/api/projects', 'POST', { name: origin || 'legacy' });
    const context = { kind: 'organization', background: `S4_${origin || 'LEGACY'}_KEPT` };
    const saved = await request(`/api/projects/${fixed.id}/plan/draft`, 'POST', { operationId: randomUUID(), expectedRevision: 0, plan: { ...blankPlan, usageContext: context, ...(origin === undefined ? {} : { usageContextOrigin: origin }) } });
    const selected = await request(`/api/projects/${fixed.id}/plan/draft`, 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, plan: { ...saved.draft.plan, goalContext: { goal: department.ref, purpose: 'query' } } });
    assert.deepEqual(selected.draft.plan.usageContext, context); assert.equal(selected.draft.plan.usageContextOrigin, origin);
  }
  let outgoing: any;
  provider.setResponder(call => { const text = providerMessageText([...call.messages].reverse().find(message => message.role === 'user')?.content); outgoing = JSON.parse(text.split('\n').find(line => line.startsWith('{"projectId":'))!); return { text: '按准确部门背景核对。' }; });
  const started = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: same.state.revision, mode: 'start' });
  const task = started.confirmation.tasks[0]; let state: any; const deadline = Date.now() + 15_000;
  do { state = await request(`/api/projects/${project.id}/tasks/${task.taskId}`); if (state.task.lastRun?.status === 'completed' && state.snapshot.status === 'idle') break; await delay(25); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed'); assert.deepEqual(outgoing.usageContext, department.usageContext);
  assert.equal(outgoing.usageContextOrigin, 'goal'); assert.equal(provider.requests.length, 1); assert.deepEqual(provider.errors, []);
});

test('S4: preparation cannot relabel, remove or invent the origin of the work context', () => {
  const plan = { request: '本轮背景', usageContext: { kind: 'department' as const, background: '已明确来源' }, usageContextOrigin: 'goal' as const, premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '核对', selected: true, scope: '', capabilities: [] }], taskMode: 'single' as const, summaryTaskKey: 'work', dependencies: [], caseContext: null };
  const input = { projectId: randomUUID(), projectName: '同一工作', plan, capabilities: { skills: [], methods: [], connectors: [], materials: [], caseContexts: [] }, existingTasks: [] };
  const response = { plan, mece: { sameLevel: '同层', coverage: '范围内', boundaries: '明确', depth: '轻量' }, limitations: [] };
  assert.equal(parseProjectPlanPreparationResponse(JSON.stringify(response), input).plan.usageContextOrigin, 'goal');
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify({ ...response, plan: { ...plan, usageContextOrigin: 'explicit' } }), input), /project_plan_preparation_context/);
  const without = { ...plan }; delete (without as { usageContextOrigin?: string }).usageContextOrigin;
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify({ ...response, plan: without }), input), /project_plan_preparation_context/);
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(response), { ...input, plan: without }), /project_plan_preparation_context/);
});

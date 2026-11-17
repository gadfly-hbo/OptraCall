import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

test('A02/A13: one current-work usage reaches actual Pi preparation, confirmed Task, Provider input and native receipt', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', body?: unknown) => { const result = await host.request(route, method, body); assert.ok(result.ok, await result.clone().text()); return result.json(); };
  await request('/api/configuration', 'PUT', { name: '用途合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-usage-only', apiKey: 'synthetic-usage-only' });
  const { project } = await request('/api/projects', 'POST', { name: '本次家庭工作' });
  const usageContext = { kind: 'personal', background: 'CURRENT_WORK_FAMILY_NOT_GLOBAL_ORGANIZATION' };
  const plan = { request: '只核对本次明确的家庭安排', usageContext, premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '核对与综合', selected: true, scope: '沿用本次家庭背景', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'work', dependencies: [], caseContext: null };
  let preparation = '', execution = '';
  provider.setResponder(context => {
    const text = providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content);
    if (context.availableTools.length === 0) { preparation = text; return { text: JSON.stringify({ plan, mece: { sameLevel: '同层', coverage: '范围内', boundaries: '明确', depth: '轻量' }, limitations: [] }) }; }
    execution = text; return { text: '只按当前家庭背景完成合成核对，不证明专业或经营效果。' };
  });
  const base = `/api/projects/${project.id}/plan`;
  const prepared = await request(base + '/prepare', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const confirmed = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: prepared.state.revision, mode: 'start' });
  const task = confirmed.confirmation.tasks[0];
  let state: any; const deadline = Date.now() + 20_000;
  do { state = await request(`/api/projects/${project.id}/tasks/${task.taskId}`); if (state.task.lastRun?.status === 'completed' && state.snapshot.status === 'idle') break; await delay(25); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed');
  assert.match(preparation, /CURRENT_WORK_FAMILY_NOT_GLOBAL_ORGANIZATION/);
  assert.match(execution, /CURRENT_WORK_FAMILY_NOT_GLOBAL_ORGANIZATION/);
  const entries = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const started = entries.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === task.startRequestId);
  assert.deepEqual(started.data.providedContext.projectPlan.usageContext, usageContext);
  assert.deepEqual(provider.errors, []);
});

test('A01/A10/A12: preparation freezes default and exact Goal evidence; later preferences, relationships and feedback never replace it in Task/native', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', body?: unknown) => { const response = await host.request(route, method, body); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  await request('/api/settings/usage-context', 'PUT', { operationId: randomUUID(), expectedRevision: 0, context: { kind: 'organization', background: 'DEFAULT_ORGANIZATION_NOT_SELECTED_GOAL' } });
  await request('/api/configuration', 'PUT', { name: '准确依据合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-goal-basis-only', apiKey: 'synthetic-goal-basis-only' });
  const { project } = await request('/api/projects', 'POST', { name: '目标依据快照' });
  const draftGoal = (title: string) => ({ operationId: randomUUID(), title, outcome: '保留可核依据', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人职责' }, measurement: { kind: 'deliverable', criterion: '准确引用与局限' }, baseline: { state: 'pending', description: '待补充' }, responsible: '本人', usageContext: { kind: 'personal', background: 'EXACT_GOAL_PERSONAL_CONTEXT' } });
  const { goal } = await request('/api/strategy/goals', 'POST', draftGoal('当前目标'));
  const { goal: upper } = await request('/api/strategy/goals', 'POST', draftGoal('贡献对象'));
  for (const value of [goal, upper]) await request(`/api/strategy/goals/${value.goalId}/adopt`, 'POST', { operationId: randomUUID(), expectedVersion: 1, version: 1, decision: '明确采用准确第一版' });
  const ref = { goalId: goal.goalId, version: 1 }, upperRef = { goalId: upper.goalId, version: 1 };
  const relationInput = { from: ref, to: upperRef, kind: 'contribution', responsibility: '本人', rationale: 'OLD_RELATION_CONTRIBUTION_IS_NOT_CAUSAL_PROOF' };
  const { relation } = await request('/api/strategy/relations', 'POST', { ...relationInput, operationId: randomUUID() });
  const source = (await request('/api/strategy/sources')).sources.find((item: any) => item.ref.authority === 'project' && item.ref.id === project.id).ref;
  await request('/api/strategy/feedback', 'POST', { operationId: randomUUID(), goal: ref, level: 'strategic-assumption', source, note: 'OLD_FEEDBACK_OBSERVATION_WINDOW_UNKNOWN' });
  const plan = { request: '按准确目标与证据准备本轮', premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '核对与综合', selected: true, scope: '只用本次冻结的依据', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'work', dependencies: [], caseContext: null, goalContext: { goal: ref, purpose: 'query' } };
  let preparing = '', execution = '';
  provider.setResponder(context => {
    const text = providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content);
    if (context.availableTools.length === 0) {
      preparing = text;
      const selected = JSON.parse(text.split('\n').find(line => line.startsWith('原轻量工作稿：'))!.slice('原轻量工作稿：'.length));
      return { text: JSON.stringify({ plan: selected, mece: { sameLevel: '同层', coverage: '范围内', boundaries: '明确', depth: '轻量' }, limitations: [] }) };
    }
    execution = text; return { text: '只交付准确依据，不把贡献关系或反馈当因果已证。' };
  });
  const base = `/api/projects/${project.id}/plan`, prepareInput = { operationId: randomUUID(), expectedRevision: 0, plan };
  const prepared = await request(base + '/prepare', 'POST', prepareInput);
  assert.equal(prepared.preparation.status, 'completed');
  assert.deepEqual(prepared.draft.plan.usageContext, { kind: 'personal', background: 'EXACT_GOAL_PERSONAL_CONTEXT' });
  assert.equal(prepared.draft.plan.goalBasis.relations[0].revision, 1); assert.equal(prepared.draft.plan.goalBasis.feedback.length, 1);
  await request('/api/settings/usage-context', 'PUT', { operationId: randomUUID(), expectedRevision: 1, context: { kind: 'department', background: 'LATER_DEFAULT_MUST_NOT_APPEAR' } });
  await request(`/api/strategy/relations/${relation.id}/revisions`, 'POST', { ...relationInput, operationId: randomUUID(), expectedRevision: 1, rationale: 'LATER_RELATION_MUST_NOT_APPEAR' });
  await request('/api/strategy/feedback', 'POST', { operationId: randomUUID(), goal: ref, level: 'strategic-assumption', source, note: 'LATER_FEEDBACK_MUST_NOT_APPEAR' });
  const replay = await request(base + '/prepare', 'POST', prepareInput);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.draft.plan, prepared.draft.plan);
  const confirmed = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: prepared.state.revision, mode: 'start' });
  const receipt = confirmed.confirmation.tasks[0];
  let state: any; const deadline = Date.now() + 15_000;
  do { state = await request(`/api/projects/${project.id}/tasks/${receipt.taskId}`); if (state.task.lastRun?.status === 'completed' && state.snapshot.status === 'idle') break; await delay(25); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed');
  for (const text of [preparing, execution]) { assert.match(text, /EXACT_GOAL_PERSONAL_CONTEXT/); assert.match(text, /OLD_RELATION_CONTRIBUTION_IS_NOT_CAUSAL_PROOF/); assert.match(text, /OLD_FEEDBACK_OBSERVATION_WINDOW_UNKNOWN/); assert.doesNotMatch(text, /LATER_|DEFAULT_ORGANIZATION_NOT_SELECTED_GOAL/); }
  const entries = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const marker = entries.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started');
  assert.deepEqual(marker.data.providedContext.projectPlan.goalBasis, prepared.draft.plan.goalBasis);
  assert.deepEqual(marker.data.providedContext.projectPlan.usageContext, prepared.draft.plan.usageContext);
  const nativeDirectory = path.join(host.dataRoot, 'project-plans', project.id, 'preparation', 'sessions');
  const preparations = await readdir(nativeDirectory);
  const preparationEntries = (await Promise.all(preparations.filter(name => name.endsWith('.jsonl')).map(name => readFile(path.join(nativeDirectory, name), 'utf8')))).flatMap(text => text.trim().split('\n').map(line => JSON.parse(line)));
  const preparedMarker = preparationEntries.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started');
  assert.deepEqual(preparedMarker.data.providedContext.projectPlanPreparation.capturedContext, { usageContext: prepared.draft.plan.usageContext, usageContextOrigin: 'goal', goalBasis: prepared.draft.plan.goalBasis });
  assert.equal(provider.requests.length, 2); assert.deepEqual(provider.errors, []);
});

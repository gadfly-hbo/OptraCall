import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { GoalDraftInput, GoalRef } from '../src/host/strategy-goals-types.ts';
import type { ProjectPlanContent } from '../src/host/project-plan-types.ts';

const draft = (kind: 'primary' | 'related', version: number): GoalDraftInput => ({
  title: `R01_${kind}_目标`, outcome: '沿本事项的准确目标继续核对，不要求重抄', perspective: 'personal',
  scope: { kind: 'personal', id: `R01_${kind}_V${version}_SCOPE`, name: '合成责任范围' }, responsible: '合成负责人',
  measurement: { kind: 'deliverable', criterion: `R01_${kind}_V${version}_RESULT` },
  baseline: { state: 'known', description: `R01_${kind}_V${version}_BASELINE` },
  dueAt: version === 1 ? '2026-12-01' : '2026-12-31', necessaryConditions: [`R01_${kind}_V${version}_CONDITION`],
});
async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/overall-architecture-product-r-fixes/r01');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'host-pi-'));
  const provider = await startToolProvider();
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); await writeFile(path.join(root, 'host-output.json'), JSON.stringify(host.output(), null, 2)); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const response = await host.request(route, method, body);
    assert.equal(response.status, status, await response.clone().text()); return response.json();
  };
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  await request('/api/configuration', 'PUT', { name: 'R01合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-r01', apiKey: 'synthetic-r01-only' });
  const { project } = await request('/api/projects', 'POST', { name: 'R01历史任务续问' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' }, 201);
  await request('/api/cases/storage/initialize', 'POST', {});
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const waitIdle = async (requestId: string) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const response = await host.request(route);
      if (response.ok) { const state: any = await response.json(); if (state.task.lastRun?.id === requestId && state.task.lastRun.status === 'completed' && state.snapshot.status === 'idle') return state; }
      else assert.equal(response.status, 409, await response.text());
      await delay(20);
    }
    assert.fail('the original Task did not reach a completed idle state');
  };
  const send = async (input: Record<string, unknown>) => {
    const requestId = randomUUID(); await request(route + '/messages', 'POST', { requestId, ...input }, 202); return waitIdle(requestId);
  };
  const goal = async (kind: 'primary' | 'related') => {
    const { goal: first } = await request('/api/strategy/goals', 'POST', { ...draft(kind, 1), operationId: randomUUID() }, 201);
    for (const version of [1, 2]) {
      if (version === 2) await request(`/api/strategy/goals/${first.goalId}/revisions`, 'POST', { ...draft(kind, version), operationId: randomUUID(), expectedVersion: 1 }, 201);
      await request(`/api/strategy/goals/${first.goalId}/adopt`, 'POST', { operationId: randomUUID(), version, expectedVersion: version, decision: `明确采纳合成目标第${version}版` });
    }
    return first.goalId as string;
  };
  const createCase = async (primary: GoalRef, related: GoalRef[] = [], linked = true) => {
    let record = (await request('/api/cases', 'POST', { operationId: randomUUID(), title: '本次选定事项', description: '仅依据本事项已确认目标核对', goalBinding: { primary, related } }, 201)).case;
    if (linked) record = (await request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id })).case;
    return { record, selection: { caseId: record.id, caseRevision: record.revision, projectWorkRevision: 0, selectedReferenceIds: [] } };
  };
  t.diagnostic(root);
  return { root, host, provider, request, project, task, route, waitIdle, send, goal, createCase };
}
const lastUserText = (messages: { role: string; content?: unknown }[]) => providerMessageText([...messages].reverse().find(message => message.role === 'user')?.content);

test('R01: an existing Task without any Plan receives exact primary and related Case goal versions without retyping or rewriting history', { timeout: 65_000 }, async t => {
  const f = await fixture(t), primary = await f.goal('primary'), related = await f.goal('related');
  const original = await f.send({ text: '已有有效工作，保留原任务和原会话。' });
  const originalBytes = await readFile(original.task.sessionFile), beforePlan = await f.request(`/api/projects/${f.project.id}/plan`);
  const observations: unknown[] = [];
  for (const version of [1, 2]) {
    const { selection } = await f.createCase({ goalId: primary, version }, [{ goalId: related, version }]);
    const state = await f.send({ text: '请沿当前事项继续核对。', caseContext: selection });
    const text = lastUserText(f.provider.requests.at(-1)!.body.messages!);
    observations.push({ version, selection, text, sessionFile: state.task.sessionFile });
    await writeFile(path.join(f.root, 'observations.json'), JSON.stringify(observations, null, 2));
    for (const kind of ['primary', 'related'] as const) {
      for (const field of ['SCOPE', 'RESULT', 'BASELINE', 'CONDITION']) assert.ok(text.includes(`R01_${kind}_V${version}_${field}`), `the actual Pi request must include the original ${kind} goal V${version} ${field}, not only goalId/version`);
      assert.ok(!text.includes(`R01_${kind}_V${version === 1 ? 2 : 1}_BASELINE`), 'the current user context must not substitute another target version');
    }
    assert.ok(text.includes(draft('primary', version).dueAt!));
    assert.equal(state.task.id, f.task.id); assert.equal(state.project.tasks.length, 1);
    assert.deepEqual((await readFile(original.task.sessionFile)).subarray(0, originalBytes.length), originalBytes);
    assert.deepEqual(await f.request(`/api/projects/${f.project.id}/plan`), beforePlan, 'Case continuation must not create or revise a Plan');
  }
  assert.equal(f.provider.requests.length, 3); assert.deepEqual(f.provider.errors, []);
});

test('R01: explicitly continuing from Case B does not present the Task previous Plan and Case A as its current background', { timeout: 65_000 }, async t => {
  const f = await fixture(t), goalId = await f.goal('primary');
  const a = await f.createCase({ goalId, version: 1 }), b = await f.createCase({ goalId, version: 2 });
  const plan: ProjectPlanContent = { request: 'R01_PLAN_A_ONLY', premises: [], materials: [], coverage: [],
    tasks: [{ key: 'original', taskId: f.task.id, name: f.task.name, selected: true, scope: '仅Case A第一版约定', capabilities: [] }],
    taskMode: 'single', summaryTaskKey: 'original', dependencies: [], caseContext: { caseId: a.record.id, primaryGoal: { goalId, version: 1 }, relatedGoals: [], caseRevision: a.selection.caseRevision, projectWorkRevision: a.selection.projectWorkRevision } };
  const base = `/api/projects/${f.project.id}/plan`;
  const saved = await f.request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const confirmed = await f.request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'start' });
  const receipt = confirmed.confirmation.tasks[0]; assert.equal(receipt.startStatus, 'accepted');
  await f.waitIdle(receipt.startRequestId);
  const original = await f.send({ text: '同一Case A的有效约定继续沿用。', caseContext: a.selection }), bytes = await readFile(original.task.sessionFile);
  assert.match(lastUserText(f.provider.requests.at(-1)!.body.messages!), /R01_PLAN_A_ONLY/, 'an explicit same-Case continuation must preserve its valid confirmed Plan responsibility');
  const beforePlan = await f.request(base);
  const conflictId = randomUUID();
  const conflict = await f.host.request(f.route + '/messages', 'POST', { requestId: conflictId, text: '同次选择的Plan与Case必须一致。', projectPlan: { confirmationId: confirmed.confirmation.id, taskKey: receipt.taskKey }, caseContext: b.selection });
  if (conflict.status === 202) await f.waitIdle(conflictId);
  assert.equal(conflict.status, 409, 'explicit conflicting Plan A and Case B must not become mixed current background');
  assert.equal((await conflict.json() as any).code, 'project_plan_context_changed');
  assert.equal(f.provider.requests.length, 2);
  const continued = await f.send({ text: '本次明确从Case B继续核对。', caseContext: b.selection });
  const text = lastUserText(f.provider.requests.at(-1)!.body.messages!);
  await writeFile(path.join(f.root, 'cross-case-observations.json'), JSON.stringify({ plan, selection: b.selection, text, continued: continued.task.id }, null, 2));
  assert.ok(text.includes('R01_primary_V2_BASELINE'));
  assert.ok(!text.includes('R01_PLAN_A_ONLY'), 'explicit Case B must not automatically inherit old Plan A');
  assert.ok(!text.includes('R01_primary_V1_BASELINE'), 'old Case A goal body must remain historical, not current background');
  assert.equal(continued.task.id, f.task.id); assert.equal(continued.project.tasks.length, 1);
  assert.deepEqual((await readFile(original.task.sessionFile)).subarray(0, bytes.length), bytes);
  assert.deepEqual(await f.request(base), beforePlan);
  assert.equal(f.provider.requests.length, 3); assert.deepEqual(f.provider.errors, []);
});

test('R01: unavailable goal authority and unlinked Case stop a new request without model calls, while an accepted request is only read back', { timeout: 65_000 }, async t => {
  const f = await fixture(t), goalId = await f.goal('primary');
  const linked = await f.createCase({ goalId, version: 1 }), unlinked = await f.createCase({ goalId, version: 2 }, [], false);
  const input = { text: '沿第一版准确目标继续。', caseContext: linked.selection };
  const accepted = await f.send(input), bytes = await readFile(accepted.task.sessionFile);
  const beforePlan = await f.request(`/api/projects/${f.project.id}/plan`), count = f.provider.requests.length;
  let response = await f.host.request(f.route + '/messages', 'POST', { requestId: randomUUID(), text: '未经项目关联的事项不能供给。', caseContext: unlinked.selection });
  assert.equal(response.status, 409); const denied: any = await response.json(); assert.equal(denied.code, 'project_not_linked');
  assert.match(denied.message, /未.*关联|不.*关联/, 'the user must receive the actual Case access failure');
  assert.equal(f.provider.requests.length, count);
  // Isolated synthetic authority loss after a legal binding; preserve the source,
  // and do not edit the original goal versions to manufacture a latest fallback.
  await rename(path.join(f.host.dataRoot, 'strategy-goals'), path.join(f.root, 'unavailable-goal-authority'));
  response = await f.host.request(f.route + '/messages', 'POST', { requestId: randomUUID(), ...input });
  assert.equal(response.status, 404); const unavailable: any = await response.json(); assert.equal(unavailable.code, 'strategy_goal_not_found');
  assert.match(unavailable.message, /目标/); assert.match(unavailable.message, /不可取得|无法读取/); assert.match(unavailable.message, /未.*替换.*最新/);
  assert.equal(f.provider.requests.length, count, 'an unreadable exact original goal is never substituted or guessed');
  const replay = await f.request(f.route + '/messages', 'POST', { requestId: accepted.task.lastRun.id, ...input }, 202);
  assert.equal(replay.deduplicated, true); assert.equal(f.provider.requests.length, count);
  assert.deepEqual(await readFile(accepted.task.sessionFile), bytes, 'failed and replayed requests must not append or rewrite native history');
  assert.deepEqual(await f.request(`/api/projects/${f.project.id}/plan`), beforePlan);
  const current = await f.request(`/api/projects/${f.project.id}`); assert.equal(current.project.tasks.length, 1);
  await writeFile(path.join(f.root, 'failure-and-replay-observations.json'), JSON.stringify({ unavailable: 'strategy_goal_not_found', denied: 'project_not_linked', providerCount: count, replay, nativeBytesPreserved: bytes.length, planRevision: beforePlan.revision }, null, 2));
  assert.deepEqual(f.provider.errors, []);
});

test('R01: an explicit goal-only Plan and Case with different exact goal versions are rejected before Pi dispatch', { timeout: 65_000 }, async t => {
  const f = await fixture(t), goalId = await f.goal('primary');
  const b = await f.createCase({ goalId, version: 2 });
  const plan: ProjectPlanContent = { request: 'R01_GOAL_ONLY_PLAN_V1', goalContext: { goal: { goalId, version: 1 }, purpose: 'query' },
    premises: [], materials: [], coverage: [], tasks: [{ key: 'original', taskId: f.task.id, name: f.task.name, selected: true, scope: '沿已确认准确目标核对', capabilities: [] }],
    taskMode: 'single', summaryTaskKey: 'original', dependencies: [], caseContext: null };
  const base = `/api/projects/${f.project.id}/plan`;
  const saved = await f.request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const confirmed = await f.request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'create' });
  const beforePlan = await f.request(base), receipt = confirmed.confirmation.tasks[0], requestId = randomUUID();
  const beforeTask = (await f.request(f.route)).task;
  assert.equal(f.provider.requests.length, 0);
  const response = await f.host.request(f.route + '/messages', 'POST', { requestId, text: '本次从准确Case B继续。', projectPlan: { confirmationId: confirmed.confirmation.id, taskKey: receipt.taskKey }, caseContext: b.selection });
  const status = response.status, body = await response.json();
  if (status === 202) await f.waitIdle(requestId);
  await writeFile(path.join(f.root, 'goal-only-conflict-observations.json'), JSON.stringify({ status, body, plan, selection: b.selection, providerCount: f.provider.requests.length }, null, 2));
  assert.equal(status, 409, 'a goal-only Plan must not bypass the exact GoalRef consistency of this Case');
  assert.equal((body as any).code, 'project_plan_context_changed');
  assert.equal(f.provider.requests.length, 0);
  assert.deepEqual(await f.request(base), beforePlan);
  assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 1);
  assert.deepEqual((await f.request(f.route)).task, beforeTask, 'a rejected context must preserve the original Task and draft');
  const failure = body as { code: string; accepted?: boolean; message: string };
  assert.match(failure.message, /Case.*项目方案.*目标.*版本.*不一致/, 'Task chat must identify the conflicting business context');
  assert.match(failure.message, /未发送.*模型/);
  assert.match(failure.message, /原输入.*选择.*保留/);
  assert.match(failure.message, /核对.*背景.*准确版本/);
  assert.doesNotMatch(failure.message, /本地服务|后重试/);
  assert.equal(failure.accepted, false, 'the original chat rejection contract must retain its draft without treating the request as UNKNOWN');
});

test('R01: a compatible Plan without Case still supplies every exact goal of the explicitly selected Case', { timeout: 65_000 }, async t => {
  const f = await fixture(t), primaryId = await f.goal('primary'), relatedId = await f.goal('related');
  const primary = { goalId: primaryId, version: 2 }, related = { goalId: relatedId, version: 1 };
  const b = await f.createCase(primary, [related]), base = `/api/projects/${f.project.id}/plan`;
  let native: { file: string; bytes: Buffer } | undefined;
  const observations: unknown[] = [];
  for (const mode of ['none', 'primary', 'related'] as const) {
    const goal = mode === 'primary' ? primary : mode === 'related' ? related : undefined;
    const plan: ProjectPlanContent = { request: `R01_COMPATIBLE_NO_CASE_PLAN_${mode}`, ...(goal ? { goalContext: { goal, purpose: 'query' as const } } : {}),
      premises: [], materials: [], coverage: [], tasks: [{ key: 'original', taskId: f.task.id, name: f.task.name, selected: true, scope: '沿本次合法Case核对', capabilities: [] }],
      taskMode: 'single', summaryTaskKey: 'original', dependencies: [], caseContext: null };
    const state = await f.request(base);
    const saved = await f.request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: state.revision, plan });
    const confirmed = await f.request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'create' });
    const beforePlan = await f.request(base), receipt = confirmed.confirmation.tasks[0];
    assert.equal(f.provider.requests.length, observations.length, 'create-only confirmation never dispatches a model');
    const continued = await f.send({ text: '本次明确使用当前Case完整目标。', projectPlan: { confirmationId: confirmed.confirmation.id, taskKey: receipt.taskKey }, caseContext: b.selection });
    const text = lastUserText(f.provider.requests.at(-1)!.body.messages!);
    observations.push({ mode, text, confirmationId: confirmed.confirmation.id });
    await writeFile(path.join(f.root, 'compatible-no-case-plan-observations.json'), JSON.stringify(observations, null, 2));
    assert.ok(text.includes(plan.request), 'the compatible confirmed Plan responsibility remains available');
    for (const [kind, version] of [['primary', 2], ['related', 1]] as const) {
      for (const field of ['SCOPE', 'RESULT', 'BASELINE', 'CONDITION']) assert.ok(text.includes(`R01_${kind}_V${version}_${field}`), `Plan ${mode} must not omit current Case ${kind} V${version} ${field}`);
      assert.ok(!text.includes(`R01_${kind}_V${version === 1 ? 2 : 1}_BASELINE`), 'no latest or historical version substitution');
    }
    if (native) assert.deepEqual((await readFile(native.file)).subarray(0, native.bytes.length), native.bytes);
    native = { file: continued.task.sessionFile, bytes: await readFile(continued.task.sessionFile) };
    assert.equal(continued.project.tasks.length, 1); assert.equal(continued.task.id, f.task.id);
    assert.deepEqual(await f.request(base), beforePlan);
  }
  assert.equal(f.provider.requests.length, 3); assert.deepEqual(f.provider.errors, []);
});

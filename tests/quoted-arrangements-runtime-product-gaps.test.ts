import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

test('PG03 public Host/Pi: no-Case user work arranges original Board actions, then an exact confirmed Goal links reused/new actions in GSA', { timeout: 45_000 }, async t => {
  const directory = path.resolve('.local/overall-architecture-product-gaps/pm03'); await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'host-pi-'));
  await mkdir(path.join(root, 'host/pi'), { recursive: true }); await writeFile(path.join(root, 'host/pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') }), provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  t.after(() => writeFile(path.join(root, 'observations.json'), JSON.stringify({ providerErrors: provider.errors, requests: provider.requests, host: host.output() }, null, 2)));
  const request = async (route: string, method = 'GET', input?: unknown, status = 200): Promise<any> => { const response = await host.request(route, method, input); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成原话安排', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-arrangements', apiKey: 'synthetic-only' });
  const { project } = await request('/api/projects', 'POST', { name: '原GSA与Board安排' }, 201), { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '无Case明确工作' }, 201);
  const text = '只登记五店窗口与供给核查两项待办，不操作经营系统。';
  const input = { action: 'arrange-actions', quote: { start: 0, end: text.length, text }, title: '五店核查安排', scope: '五店资料核查待办', checks: ['核查资料范围和来源'], actions: [{ kind: 'create', title: '核查会员窗口', owner: '合成核查人' }, { kind: 'create', title: '核查供给事实' }] };
  const replies: any[] = [];
  const managementLock = path.join(root, 'host/strategy-goals/.write.lock'), partials: any[] = []; let arrangeCommand: Record<string, unknown>;
  provider.setResponder(async context => {
    assert.ok(context.availableTools.includes('record_user_decision'));
    if (context.recentToolResults.length) {
      const raw = providerMessageText(context.recentToolResults.at(-1)!.content);
      try { replies.push(JSON.parse(raw)); } catch { replies.push({ toolError: raw }); return { text: '保留原工具失败，本轮不重新建单。' }; }
    }
    return context.recentToolResults.length < 2 ? { calls: [{ name: 'record_user_decision', arguments: input }] } : { text: '已登记原看板待办，未执行经营动作。' };
  });
  const run = async (taskId: string, text: string, projectPlan?: unknown) => {
    const route = `/api/projects/${project.id}/tasks/${taskId}`, requestId = randomUUID();
    await request(route + '/messages', 'POST', { requestId, text, ...(projectPlan ? { projectPlan } : {}) }, 202);
    const deadline = Date.now() + 20_000; let value: any;
    do { value = await request(route); if (value.task.lastRun?.id === requestId && value.task.lastRun.status !== 'running' && value.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(value.task.lastRun?.status, 'completed', JSON.stringify({ lastRun: value.task.lastRun, replies, errors: provider.errors }));
    return { requestId, entries: (await readFile(value.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
  };
  const noGoalRun = await run(task.id, text);
  assert.equal(replies[0]?.status, 'completed', JSON.stringify(replies)); assert.equal(replies.length, 2); assert.equal(replies[0].operationId, replies[1].operationId);
  assert.equal(replies[0].management.status, 'not-applicable');
  let board = await request('/api/decision-board'); assert.equal(board.items.flatMap((item: any) => item.tasks).length, 2);
  assert.equal(noGoalRun.entries.filter(entry => entry.customType === 'optracall.quoted-decision').length, 2);
  const original = await request(`/api/decision-board/arrangements/operations/${replies[0].operationId}`);
  assert.equal(original.operation.quoteProvenance.requestId, noGoalRun.requestId); assert.equal(original.operation.quoteProvenance.quote.text, text);
  const { goal } = await request('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: '五店已明确核查目标', outcome: '核清资料范围', perspective: 'personal', scope: { kind: 'personal', id: 'synthetic', name: '合成职责' }, measurement: { kind: 'deliverable', criterion: '保留原来源' }, baseline: { state: 'pending', description: '待核' }, responsible: '合成用户' }, 201);
  await request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), version: 1, expectedVersion: 1, decision: '采用目标v1' });
  const plan = { request: '按已确认目标登记核查安排', premises: [], materials: [], coverage: [], tasks: [{ key: 'assigned', name: '明确核查安排', selected: true, scope: '登记待办和检查', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'assigned', dependencies: [], caseContext: null, goalContext: { goal: { goalId: goal.goalId, version: 1 }, purpose: 'assigned-work' } };
  const base = `/api/projects/${project.id}/plan`, draft = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const confirmed = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'create' });
  const assigned = confirmed.confirmation.tasks[0], nextText = '按目标v1复用原窗口核查，新增门店回访资料核查，并登记检查安排；不做经营执行。';
  let arranged: any;
  provider.setResponder(async context => {
    if (!context.recentToolResults.length) return { calls: [{ name: 'record_user_decision', arguments: { action: 'read' } }] };
    const response = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
    if (response.type === 'optracall.quoted-decision-read') {
      const row = response.actions.find((row: any) => row.task.title === '核查会员窗口'); assert.ok(row);
      arrangeCommand = { action: 'arrange-actions', quote: { start: 0, end: nextText.length, text: nextText }, title: '五店资料补核', scope: '既有窗口核查与新增回访资料核查', checks: ['回看两项核查依据'], actions: [{ kind: 'reuse', itemId: row.item.id, taskId: row.task.id, itemVersion: row.itemVersion, taskVersion: row.taskVersion, expectedPreviousAuthorizationId: row.authorization }, { kind: 'create', title: '核查回访资料' }] };
      await writeFile(managementLock, 'synthetic-pg03-test-lock', { flag: 'wx' });
      return { calls: [{ name: 'record_user_decision', arguments: arrangeCommand }] };
    }
    if (response.status === 'partial') {
      partials.push(response); assert.equal(response.management.code, 'strategy_goals_locked');
      assert.equal(await readFile(managementLock, 'utf8'), 'synthetic-pg03-test-lock'); await unlink(managementLock);
      return { calls: [{ name: 'record_user_decision', arguments: arrangeCommand }] };
    }
    arranged = response; return { text: '原看板安排已复用并补充，GSA保留准确目标v1与检查引用。' };
  });
  const withGoal = await run(assigned.taskId, nextText, { confirmationId: confirmed.confirmation.id, taskKey: assigned.taskKey });
  assert.equal(arranged.status, 'completed'); assert.equal(arranged.management.status, 'linked');
  assert.equal(partials.length, 1); assert.equal(partials[0].operationId, arranged.operationId); assert.deepEqual(partials[0].authority, arranged.authority);
  const goals = await request('/api/strategy/goals'); assert.equal(goals.arrangements.length, 1); assert.equal(goals.arrangements[0].actions.length, 2); assert.deepEqual(goals.arrangements[0].goal, { goalId: goal.goalId, version: 1 });
  board = await request('/api/decision-board'); const tasks = board.items.flatMap((item: any) => item.tasks); assert.equal(tasks.length, 3); assert.ok(tasks.every((task: any) => task.status === 'todo' && !task.feedback));
  const ref = goals.arrangements[0].actions[0]; await request(`/api/decision-board/tasks/${ref.taskId}/status`, 'POST', { status: 'doing' });
  assert.equal((await request('/api/decision-board')).items.flatMap((item: any) => item.tasks).find((task: any) => task.id === ref.taskId).status, 'doing');
  assert.equal('status' in (await request('/api/strategy/goals')).arrangements[0].actions[0], false);
  assert.ok(withGoal.entries.some(entry => entry.customType === 'optracall.quoted-decision'));
  assert.deepEqual(provider.errors, []);
});

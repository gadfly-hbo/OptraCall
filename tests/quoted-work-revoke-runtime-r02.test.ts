import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

for (const goalBound of [false, true]) test(`R02 public Host/Pi: no-Case ${goalBound ? 'confirmed Goal/Plan' : 'original work'} can revoke its exact Board authorization, replay stays single and facts survive`, { timeout: 45_000 }, async t => {
  const directory = path.resolve('.local/overall-architecture-product-r-fixes/r02'); await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'host-pi-'));
  await mkdir(path.join(root, 'host/pi'), { recursive: true }); await writeFile(path.join(root, 'host/pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') }), provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const replies: any[] = [];
  t.after(() => writeFile(path.join(root, 'observations.json'), JSON.stringify({ replies, errors: provider.errors, requests: provider.requests, host: host.output() }, null, 2)));
  const request = async (route: string, method = 'GET', input?: unknown, status = 200): Promise<any> => { const response = await host.request(route, method, input); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: 'R02合成原话撤回', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-work-revoke', apiKey: 'synthetic-only' });
  const { project } = await request('/api/projects', 'POST', { name: 'R02原工作授权' }, 201);
  let task: any, projectPlan: any;
  if (goalBound) {
    const { goal } = await request('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: 'R02原核查目标', outcome: '核清窗口', perspective: 'personal', scope: { kind: 'personal', id: 'synthetic', name: '合成职责' }, measurement: { kind: 'deliverable', criterion: '保留来源' }, baseline: { state: 'pending', description: '待核' }, responsible: '合成人' }, 201);
    await request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), version: 1, expectedVersion: 1, decision: '采用原目标' });
    const plan = { request: '明确核查安排', premises: [], materials: [], coverage: [], tasks: [{ key: 'check', name: '窗口核查工作', selected: true, scope: '登记并管理核查待办', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'check', dependencies: [], caseContext: null, goalContext: { goal: { goalId: goal.goalId, version: 1 }, purpose: 'assigned-work' } };
    const planBase = `/api/projects/${project.id}/plan`, draft = await request(planBase + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
    const confirmed = await request(planBase + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'create' });
    const receipt = confirmed.confirmation.tasks[0]; task = { id: receipt.taskId }; projectPlan = { confirmationId: confirmed.confirmation.id, taskKey: receipt.taskKey };
  } else ({ task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '无Case工作' }, 201));
  const base = `/api/projects/${project.id}/tasks/${task.id}`;
  const run = async (text: string, selection?: unknown) => {
    const requestId = randomUUID(); await request(base + '/messages', 'POST', { requestId, text, ...(selection ? { projectPlan: selection } : {}) }, 202);
    const deadline = Date.now() + 20_000; let value: any;
    do { value = await request(base); if (value.task.lastRun?.id === requestId && value.task.lastRun.status !== 'running' && value.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(value.task.lastRun?.status, 'completed', JSON.stringify({ lastRun: value.task.lastRun, replies, errors: provider.errors }));
    return { requestId, entries: (await readFile(value.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
  };
  const text = '请登记窗口核查待办，由合成人负责；不要执行经营操作。';
  provider.setResponder(context => context.recentToolResults.length ? { text: '已记录待办。' } : { calls: [{ name: 'record_user_decision', arguments: { action: 'arrange-actions', quote: { start: 0, end: text.length, text }, title: '原核查安排', scope: '登记资料核查', checks: ['核查来源'], actions: [{ kind: 'create', title: '核查窗口', owner: '合成人' }] } }] });
  await run(text, projectPlan);
  const originalBoard = await request('/api/decision-board'), original = originalBoard.items[0].tasks[0];
  assert.equal(original.authorization.decision, 'authorize');
  await request(`/api/decision-board/tasks/${original.id}/status`, 'POST', { status: 'doing' });
  const before = (await request('/api/decision-board')).items[0].tasks[0];
  const revokeText = '撤回刚才窗口核查待办的授权，保留原安排及已发生记录。';
  let command: any;
  provider.setResponder(context => {
    assert.ok(context.availableTools.includes('record_user_decision'));
    if (!context.recentToolResults.length) return { calls: [{ name: 'record_user_decision', arguments: { action: 'read' } }] };
    const raw = providerMessageText(context.recentToolResults.at(-1)!.content); let response: any;
    try { response = JSON.parse(raw); } catch { replies.push({ toolError: raw }); return { text: '保留工具拒绝。' }; }
    if (response.type === 'optracall.quoted-decision-read') {
      const row = response.actions.find((row: any) => row.task.id === original.id); assert.ok(row);
      command = { action: 'authorize-action', decision: 'revoke', quote: { start: 0, end: revokeText.length, text: revokeText }, scope: '撤回原窗口核查授权', itemId: row.item.id, taskId: row.task.id, itemVersion: row.itemVersion, taskVersion: row.taskVersion, expectedPreviousAuthorizationId: row.authorization };
      return { calls: [{ name: 'record_user_decision', arguments: command }] };
    }
    replies.push(response);
    return replies.length === 1 ? { calls: [{ name: 'record_user_decision', arguments: command }] } : { text: '已准确追加撤回，原行动事实保留。' };
  });
  const revoked = await run(revokeText);
  assert.equal(replies[0]?.status, 'completed', JSON.stringify(replies)); assert.equal(replies.length, 2); assert.equal(replies[1].operationId, replies[0].operationId);
  const history = (await request(`/api/decision-board/action-authorizations/history?taskId=${original.id}`)).authorizations;
  assert.deepEqual(history.map((entry: any) => entry.decision), ['authorize', 'revoke']); assert.equal(history[1].previousAuthorizationId, history[0].authorizationId);
  assert.deepEqual(history[1].source, history[0].source); assert.equal(history[1].quoteProvenance.requestId, revoked.requestId); assert.equal(history[1].quoteProvenance.quote.text, revokeText);
  const current = (await request('/api/decision-board')).items[0].tasks[0];
  assert.equal(current.authorization.decision, 'revoke'); assert.equal(current.status, before.status); assert.equal(current.owner, before.owner); assert.equal(current.feedback, before.feedback);
  const arrangements = (await request('/api/strategy/goals')).arrangements ?? []; assert.equal(arrangements.length, goalBound ? 1 : 0);
  if (goalBound) { assert.equal(arrangements[0].actions[0].authorizationId, history[0].authorizationId); assert.equal('authorization' in arrangements[0].actions[0], false); }
  assert.ok(revoked.entries.some(entry => entry.customType === 'optracall.quoted-decision')); assert.deepEqual(provider.errors, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
const draft = (operationId = randomUUID()) => ({ operationId, title: '会员持续购买', strategies: ['按选定依据跟进'], outcome: '核清可比窗口内的变化并形成有依据的判断', perspective: 'profit', scope: { kind: 'personal', id: 'synthetic-owner', name: '合成个人职责' }, measurement: { kind: 'deliverable', criterion: '准确口径、限制与后续验证安排可回读' }, baseline: { state: 'pending', description: '历史窗口待补齐' }, responsible: '会员运营' });

test('A01/A03: a candidate goal requires an explicit adoption before a new Case can reference its exact version', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const initial = await host.request('/api/strategy/goals');
  assert.equal(initial.status, 200, await initial.clone().text());
  assert.deepEqual((await initial.json()).goals, []);
  const input = draft();
  const created = await host.request('/api/strategy/goals', 'POST', input);
  assert.equal(created.status, 201, await created.clone().text());
  const { goal } = await created.json();
  assert.equal(goal.status, 'candidate');
  const ref = { goalId: goal.goalId, version: 1 };
  await host.request('/api/cases/storage/initialize', 'POST', {});
  const unadopted = await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '复购变化', goalBinding: { strategy: '按选定依据跟进', primary: ref, related: [] } });
  assert.equal(unadopted.status, 409, await unadopted.clone().text());
  const adoption = await host.request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), expectedVersion: 1, version: 1, decision: '采用为本期目标；基线待补照实保留' });
  assert.equal(adoption.status, 200, await adoption.clone().text());
  const caseInput = { operationId: randomUUID(), title: '复购变化', goalBinding: { strategy: '按选定依据跟进', primary: ref, related: [] } };
  const caseResponse = await host.request('/api/cases', 'POST', caseInput);
  assert.equal(caseResponse.status, 201, await caseResponse.clone().text());
  const { case: record } = await caseResponse.json();
  const detailResponse = await host.request(`/api/cases/${record.id}`);
  const detail = await detailResponse.json();
  assert.deepEqual(detail.goalBinding.primary, ref);
  const repeated = await host.request('/api/cases', 'POST', caseInput);
  assert.deepEqual((await repeated.json()).case, record);
  assert.equal((await (await host.request('/api/cases')).json()).cases.length, 1);
});

test('A01: a quantitative goal cannot invent a published SAP metric version', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const response = await host.request('/api/strategy/goals', 'POST', { ...draft(), measurement: { kind: 'quantitative', sapMetric: { authority: 'sap-metric', id: 'nonexistent-metric', version: '1.0.0' } } });
  assert.equal(response.status, 409, await response.clone().text());
  assert.deepEqual((await (await host.request('/api/strategy/goals')).json()).goals, []);
});

test('A08: Task archive and restore preserve identity and draft without opening a model session', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const configured = await (await host.request('/api/configuration', 'PUT', { name: '合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: 'synthetic-key' })).json();
  const { project } = await (await host.request('/api/projects', 'POST', { name: '任务生命周期', configurationId: configured.configuration.id })).json();
  const { task } = await (await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' })).json();
  const base = `/api/projects/${project.id}/tasks/${task.id}`;
  await host.request(`${base}/draft`, 'PATCH', { text: '保留的原草稿' });
  const response = await host.request(`${base}/archive`, 'POST', {});
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok((await response.json()).task.archivedAt);
  assert.equal((await host.request(`${base}/open`, 'POST', {})).status, 409);
  assert.equal((await host.request(`${base}/draft`, 'PATCH', { text: '不能覆盖' })).status, 409);
  const restored = await host.request(`${base}/restore`, 'POST', {});
  assert.equal(restored.status, 200, await restored.clone().text());
  const { task: original } = await restored.json();
  assert.equal(original.id, task.id);
  assert.equal(original.draft, '保留的原草稿');
  assert.equal(original.lastRun, undefined);
});

test('A21: all global nodes start off and the same persistent settings survive a Host restart without waking work', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const before = await (await host.request('/api/automatic-actions/settings')).json();
  assert.deepEqual(before.nodes, { save: false, review: false, ir: false, case: false, assets: false });
  const input = { operationId: randomUUID(), expectedRevision: before.revision, nodes: { ...before.nodes, ir: true } };
  const savedResponse = await host.request('/api/automatic-actions/settings', 'POST', input);
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
  const saved = await savedResponse.json();
  await host.close();
  const reopened = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot }); t.after(() => reopened.close());
  assert.deepEqual(await (await reopened.request('/api/automatic-actions/settings')).json(), saved.settings);
  const replay = await (await reopened.request('/api/automatic-actions/settings', 'POST', input)).json();
  assert.equal(replay.replayed, true);
  assert.deepEqual((await (await reopened.request('/api/projects')).json()).projects, []);
});

test('A07/A08: one project confirmation creates selected dimension Tasks and reuses its own summary without executing', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const configured = await (await host.request('/api/configuration', 'PUT', { name: '合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: 'synthetic-key' })).json();
  const { project } = await (await host.request('/api/projects', 'POST', { name: '多维问题', configurationId: configured.configuration.id })).json();
  const base = `/api/projects/${project.id}/plan`;
  const initialResponse = await host.request(base);
  assert.equal(initialResponse.status, 200, await initialResponse.clone().text());
  const initial = await initialResponse.json();
  const plan = { request: '核对变化并比较有证据的解释', premises: ['观察窗口待补'], materials: [], coverage: [{ key: 'population', label: '群体变化', disposition: 'focus', reason: '本轮重点', taskKeys: ['population'] }, { key: 'evidence', label: '其他事实证据', disposition: 'focus', reason: '本轮重点', taskKeys: ['evidence'] }], tasks: [{ key: 'population', name: '群体变化', selected: true, scope: '核对群体及数量', capabilities: [] }, { key: 'evidence', name: '多类证据', selected: true, scope: '核对其他事实', capabilities: [] }, { key: 'summary', name: '项目综合', selected: true, scope: '核对分歧与遗漏', capabilities: [] }], taskMode: 'multi', summaryTaskKey: 'summary', dependencies: [{ from: 'population', to: 'summary', reason: '综合引用准确成果' }, { from: 'evidence', to: 'summary', reason: '综合引用准确成果' }], caseContext: null };
  const savedResponse = await host.request(`${base}/draft`, 'POST', { operationId: randomUUID(), expectedRevision: initial.revision, plan });
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
  const saved = await savedResponse.json();
  const input = { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'create' };
  const resultResponse = await host.request(`${base}/confirm`, 'POST', input);
  assert.equal(resultResponse.status, 200, await resultResponse.clone().text());
  const result = await resultResponse.json();
  assert.equal(result.confirmation.tasks.length, 3);
  assert.ok(result.confirmation.tasks.every((task: any) => task.startStatus === 'not-requested' && task.createStatus === 'created'));
  const read = await (await host.request(`/api/projects/${project.id}`)).json();
  assert.equal(read.project.tasks.length, 3);
  assert.ok(read.project.tasks.every((task: any) => !task.lastRun && !task.sessionFile));
  const repeated = await (await host.request(`${base}/confirm`, 'POST', input)).json();
  assert.equal(repeated.replayed, true);
  assert.equal((await (await host.request(`/api/projects/${project.id}`)).json()).project.tasks.length, 3);
});

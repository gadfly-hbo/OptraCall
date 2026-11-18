import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import './fixtures/register-ui.ts';
import type { ProjectPlanCaseConnection } from '../src/host/ui/project-plan-case-client.ts';
const api = await import('../src/host/ui/project-plan-case-client.ts');

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const host = await startTestHost(); t.after(() => host.close());
  await host.request('/api/cases/storage/initialize', 'POST', {});
  const configured = await (await host.request('/api/configuration', 'PUT', { name: '合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic' })).json();
  const { project } = await (await host.request('/api/projects', 'POST', { name: '原项目', configurationId: configured.configuration.id })).json();
  const { goal } = await (await host.request('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: '持续观察', outcome: '明确可核依据', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '个人职责' }, measurement: { kind: 'deliverable', criterion: '可回查报告' }, baseline: { state: 'pending', description: '待补基线' }, responsible: '合成责任人' })).json();
  await host.request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), expectedVersion: 1, version: 1, decision: '用户明确采用' });
  const goalBinding = { primary: { goalId: goal.goalId, version: 1 }, related: [] };
  const intent: ProjectPlanCaseConnection = { projectId: project.id, goalBinding, create: { operationId: randomUUID(), title: '持续推进的业务事项', description: '用户明确的问题', goalBinding }, linkOperationId: randomUUID() };
  return { host, project, intent };
}

test('the project plan creates a real Case through original HTTP authorities, links this exact Project and adopts its precise goal context without starting Tasks', async t => {
  const { host, project, intent } = await fixture(t), original = globalThis.fetch, calls: { path: string; method: string }[] = [];
  globalThis.fetch = (input, init) => { const path = String(input); calls.push({ path, method: init?.method || 'GET' }); return original(host.baseUrl + path, { ...init, headers: { ...host.headers, ...init?.headers } }); };
  try {
    const context = await api.connectProjectPlanCase(intent);
    assert.ok(context); assert.equal(context.caseId, intent.caseId); assert.equal(context.caseRevision, 2); assert.deepEqual(context.primaryGoal, intent.goalBinding.primary);
    const detail = await (await globalThis.fetch(`/api/cases/${context.caseId}`)).json();
    assert.equal(detail.projectLinks[0].projectId, project.id);
    assert.deepEqual(detail.goalBinding.primary, intent.goalBinding.primary);
    assert.deepEqual(calls.filter(call => call.method !== 'GET').map(call => call.path), ['/api/cases', `/api/cases/${context.caseId}/projects`]);
    assert.equal(calls.some(call => /messages|confirm|session/.test(call.path)), false);
    await api.connectProjectPlanCase(intent);
    assert.equal(calls.filter(call => call.method !== 'GET').length, 2);
  } finally { globalThis.fetch = original; }
});

test('pending Case connection reload keeps its original intent and operation IDs while unknown stored records are not erased', async t => {
  const { intent } = await fixture(t), values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  intent.createAttempted = true;
  api.savePendingProjectCase(storage, intent);
  assert.deepEqual(api.readPendingProjectCase(storage, intent.projectId), intent);
  const key = `optracall.project-plan-case.v1:${intent.projectId}`, unknown = '{"schemaVersion":99,"future":"keep"}'; storage.setItem(key, unknown);
  assert.throws(() => api.readPendingProjectCase(storage, intent.projectId), { code: 'project_plan_case_pending_unavailable' });
  assert.throws(() => api.savePendingProjectCase(storage, intent), { code: 'project_plan_case_pending_unavailable' });
  assert.equal(storage.getItem(key), unknown);
});

test('a pending connection cannot replace its original creation fields while retaining the same operation IDs', async t => {
  const { intent } = await fixture(t), values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  intent.createAttempted = true; api.savePendingProjectCase(storage, intent);
  const before = [...values.entries()], altered = structuredClone(intent); altered.create!.title = '另一经营事项';
  assert.throws(() => api.savePendingProjectCase(storage, altered), { code: 'project_plan_case_pending_unavailable' });
  assert.deepEqual([...values.entries()], before);
});

test('pending Case recovery preserves the user chosen direct goal purpose rather than silently changing it after reopening the page', async t => {
  const { intent } = await fixture(t), values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  intent.goalContext = { goal: intent.goalBinding.primary, purpose: 'query' }; intent.createAttempted = true;
  api.savePendingProjectCase(storage, intent); assert.deepEqual(api.readPendingProjectCase(storage, intent.projectId)?.goalContext, intent.goalContext);
  const altered = structuredClone(intent); altered.goalContext!.purpose = 'assigned-work';
  assert.throws(() => api.savePendingProjectCase(storage, altered), { code: 'project_plan_case_pending_unavailable' });
  assert.equal(api.readPendingProjectCase(storage, intent.projectId)?.goalContext?.purpose, 'query');
});

for (const lostStage of ['create', 'link'] as const) test(`a lost ${lostStage} response is recovered by exact read-only receipts without repeating either POST`, async t => {
  const { host, intent } = await fixture(t), original = globalThis.fetch, writes: string[] = []; let lost = false;
  globalThis.fetch = async (input, init) => {
    const route = String(input), response = await original(host.baseUrl + route, { ...init, headers: { ...host.headers, ...init?.headers } });
    if (init?.method === 'POST') {
      writes.push(route);
      if (!lost && (lostStage === 'create' ? route === '/api/cases' : /\/projects$/.test(route))) { lost = true; await response.text(); throw new Error('synthetic response lost after durable acceptance'); }
    }
    return response;
  };
  try {
    await assert.rejects(api.connectProjectPlanCase(intent), /Case.*尚未核实/);
    const count = writes.length, originalCreateId = intent.create!.operationId, originalLinkId = intent.linkOperationId;
    const inspected = await api.connectProjectPlanCase(intent, { readOnly: true });
    assert.equal(writes.length, count);
    if (lostStage === 'create') assert.equal(inspected, null); else assert.ok(inspected);
    const context = await api.connectProjectPlanCase(intent);
    assert.ok(context); assert.equal(context.caseRevision, 2);
    assert.equal(intent.create!.operationId, originalCreateId); assert.equal(intent.linkOperationId, originalLinkId);
    assert.equal(writes.filter(route => route === '/api/cases').length, 1);
    assert.equal(writes.filter(route => /\/projects$/.test(route)).length, 1);
    assert.equal((await (await globalThis.fetch('/api/cases')).json()).cases.length, 1);
  } finally { globalThis.fetch = original; }
});

test('an explicitly selected existing Case is linked once and a later changed goal or Case revision is not substituted into its saved intent', async t => {
  const { host, intent } = await fixture(t), original = globalThis.fetch;
  const created = await (await host.request('/api/cases', 'POST', intent.create)).json();
  const existing: ProjectPlanCaseConnection = { projectId: intent.projectId, caseId: created.case.id, caseRevision: created.case.revision, goalBinding: intent.goalBinding, linkOperationId: randomUUID() };
  const writes: string[] = [];
  globalThis.fetch = (input, init) => { if (init?.method === 'POST') writes.push(String(input)); return original(host.baseUrl + String(input), { ...init, headers: { ...host.headers, ...init?.headers } }); };
  try {
    const context = await api.connectProjectPlanCase(existing); assert.ok(context);
    await globalThis.fetch(`/api/cases/${existing.caseId}/notes`, { method: 'POST', body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 2, note: '用户后续新判断' }) });
    const count = writes.length;
    await assert.rejects(api.connectProjectPlanCase(existing, { readOnly: true }), /Case 或目标已有变化/);
    assert.equal(writes.length, count); assert.equal(existing.linkedRevision, 2);
    assert.equal(writes.includes('/api/cases'), false);
  } finally { globalThis.fetch = original; }
});

test('original Host persists explicit direct goal purposes without inventing Cases and refuses a Case investigation with no Case', async t => {
  const { host, intent, project } = await fixture(t), goal = intent.goalBinding.primary;
  const base = `/api/projects/${project.id}/plan`, plan = { request: '用户已明确的目标工作', premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '本次明确工作', selected: true, scope: '', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'work', dependencies: [], caseContext: null };
  let revision = 0;
  for (const purpose of ['query', 'asset-construction', 'assigned-work'] as const) {
    const response = await host.request(`${base}/draft`, 'POST', { operationId: randomUUID(), expectedRevision: revision, plan: { ...plan, goalContext: { goal, purpose } } });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json(); revision = saved.state.revision; assert.deepEqual(saved.draft.plan.goalContext, { goal, purpose }); assert.equal(saved.draft.plan.caseContext, null);
  }
  const response = await host.request(`${base}/draft`, 'POST', { operationId: randomUUID(), expectedRevision: revision, plan: { ...plan, goalContext: { goal, purpose: 'case-investigation' } } });
  assert.equal(response.status, 400, await response.clone().text());
  assert.equal((await (await host.request('/api/cases')).json()).cases.length, 0);
  assert.equal((await (await host.request(`/api/projects/${project.id}`)).json()).project.tasks.length, 0);
  assert.equal((await (await host.request(base)).json()).revision, revision);
});

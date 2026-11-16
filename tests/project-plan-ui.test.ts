import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/host/ui/project-plan-client.ts';
import type { ProjectPlanContent } from '../src/host/project-plan-types.ts';
import { projectPlanPreparationInputHash } from '../src/host/project-plan-preparation.ts';
const plan = (): ProjectPlanContent => ({ request: '核对本项目已有说明', premises: [], materials: [], coverage: [], tasks: [{ key: 'original', name: '已有任务', taskId: '00000000-0000-4000-8000-000000000002', selected: true, scope: '已确认范围', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'original', dependencies: [], caseContext: null });

test('project-plan client uses exact project routes and preserves fixed operation IDs without starting during draft save', async () => {
  const original = globalThis.fetch, calls: { path: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), init }); return new Response(JSON.stringify({}), { status: 200 }); };
  const draft = { operationId: '00000000-0000-4000-8000-000000000003', expectedRevision: 4, plan: plan() }, confirmation = { operationId: '00000000-0000-4000-8000-000000000004', expectedRevision: 5, mode: 'create' as const };
  try {
    await api.read('project/a'); await api.capabilities('project/a'); await api.saveDraft('project/a', draft); await api.confirm('project/a', confirmation);
    assert.deepEqual(calls.map(call => call.path), ['/api/projects/project%2Fa/plan', '/api/projects/project%2Fa/plan/capabilities', '/api/projects/project%2Fa/plan/draft', '/api/projects/project%2Fa/plan/confirm']);
    assert.deepEqual(calls.map(call => call.init?.method), ['GET', 'GET', 'POST', 'POST']);
    assert.deepEqual(JSON.parse(String(calls[2].init?.body)), draft); assert.deepEqual(JSON.parse(String(calls[3].init?.body)), confirmation);
    assert.ok(calls.every(call => call.init?.credentials === 'omit' && call.init?.cache === 'no-store'));
  } finally { globalThis.fetch = original; }
});

test('a lost write response remains uncertain and never automatically sends another POST or changes the original intent', async () => {
  const original = globalThis.fetch, calls: string[] = [], input = { operationId: '00000000-0000-4000-8000-000000000005', expectedRevision: 3, mode: 'start' as const };
  globalThis.fetch = async (_url, init) => { calls.push(String(init?.body)); throw new Error('connection lost'); };
  try {
    await assert.rejects(api.confirm('project', input), error => error instanceof api.ProjectPlanRequestError && error.uncertain && error.code === 'project_plan_result_unknown');
    assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(calls[0]), input);
  } finally { globalThis.fetch = original; }
});

test('server conflicts remain explicit failures without substituting latest plan or retrying', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ code: 'project_plan_context_changed' }), { status: 409 }); };
  try { await assert.rejects(api.confirm('project', { operationId: '00000000-0000-4000-8000-000000000006', expectedRevision: 2, mode: 'create' }), error => error instanceof api.ProjectPlanRequestError && !error.uncertain && error.code === 'project_plan_context_changed'); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
test('preparation and stop preserve the exact original intent and read-only recovery requires both original hash and saved draft receipt', async () => {
  const original = globalThis.fetch, calls: { url: string; body: unknown }[] = [], input = { operationId: '00000000-0000-4000-8000-000000000017', expectedRevision: 0, plan: plan() };
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({}), { status: 200 }); };
  try {
    await api.prepare('project', input); await api.stopPreparation('project', input.operationId);
    assert.deepEqual(calls, [{ url: '/api/projects/project/plan/prepare', body: input }, { url: '/api/projects/project/plan/prepare/stop', body: { operationId: input.operationId } }]);
    const inputHash = projectPlanPreparationInputHash(input), base = { formatVersion: 1 as const, projectId: 'project', revision: 1, history: [] };
    const preparation = { operationId: input.operationId, inputHash, status: 'completed' as const, draftVersion: 1 };
    assert.equal((await api.findPreparation({ ...base, preparations: [{ ...preparation, status: 'running' }] }, input)).status, 'running');
    assert.equal((await api.findPreparation({ ...base, preparations: [preparation] }, input)).status, 'unknown');
    assert.equal((await api.findPreparation({ ...base, preparations: [preparation], operations: [{ operationId: input.operationId, kind: 'prepare', planVersion: 1, requestHash: inputHash }] }, input)).status, 'completed');
    assert.equal((await api.findPreparation({ ...base, preparations: [{ ...preparation, status: 'cancelled' }] }, input)).status, 'cancelled');
    assert.equal((await api.findPreparation({ ...base, preparations: [preparation] }, { ...input, expectedRevision: 1 })).status, 'conflict');
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});


test('read-only recovery matches the original operation hash and rejects edited intent without sending a write', async () => {
  const input = { operationId: '00000000-0000-4000-8000-000000000007', expectedRevision: 1, mode: 'create' as const };
  const state = { formatVersion: 1 as const, projectId: 'project', revision: 4, history: [], operations: [{ operationId: input.operationId, kind: 'confirm' as const, planVersion: 1, confirmationId: input.operationId, requestHash: '51d46b1b521bc0bb8e8416ce61566225fc9a8559c85761daaef7d450c6f7685a' }] };
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('recovery inspection must not write'); };
  try {
    assert.equal((await api.findOperation(state, input)).status, 'saved');
    assert.equal((await api.findOperation(state, { ...input, mode: 'start' })).status, 'conflict');
    assert.equal((await api.findOperation({ ...state, operations: [] }, input)).status, 'not-found');
    assert.equal((await api.findOperation({ ...state, operations: state.operations.map(operation => ({ ...operation, requestHash: undefined })) }, input)).status, 'unknown');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

let pageModule: Promise<{ ProjectPlanPage: unknown }> | undefined;
async function renderedPage(props: Record<string, unknown>): Promise<string> {
  const [React, ReactDom] = await Promise.all([import('react'), import('react-dom/server')]);
  pageModule ??= (async () => {
    const [{ mkdir }, path, vite, plugin] = await Promise.all([import('node:fs/promises'), import('node:path'), import('vite'), import('@vitejs/plugin-react')]);
    const evidence = path.resolve('.local/overall-architecture-upgrade/development/project-plan-ui'); await mkdir(evidence, { recursive: true });
    const server = await vite.createServer({ configFile: false, plugins: [plugin.default()], cacheDir: path.join(evidence, 'ssr-cache'), logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
    after(() => server.close());
    const module = await server.ssrLoadModule('/src/host/ui/ProjectPlanPage.tsx');
    return { ProjectPlanPage: module.ProjectPlanPage };
  })();
  const module = await pageModule;
  return ReactDom.renderToStaticMarkup(React.createElement(module.ProjectPlanPage as React.ComponentType<never>, props as never));
}

const project = { schemaVersion: 2, id: '00000000-0000-4000-8000-000000000001', name: '已有项目工作区', rootPath: '/synthetic/project', createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z', archivedAt: null, configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' }, tasks: [{ id: '00000000-0000-4000-8000-000000000002', name: '原Task', draft: '', createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z', sessionStorage: 'task', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } }] };
const noops = { onBack() {}, onConfirmed() {}, onOpenTask() {} };

test('the plan page retains the original project context and exposes both confirmation actions with optional no-Case work', async () => {
  const html = await renderedPage({ project, ...noops, initialCapabilities: { skills: [], methods: [], connectors: [], materials: [], caseContexts: [] }, initialState: { formatVersion: 1, projectId: project.id, revision: 1, draft: { version: 1, createdAt: '2026-11-16T00:00:00.000Z', plan: plan() }, history: [] } });
  assert.match(html, /已有项目工作区/); assert.match(html, /仅确认并创建/); assert.match(html, /确认并开始/);
  assert.match(html, /无 Case/); assert.match(html, /覆盖与本轮重点/); assert.match(html, /综合责任/); assert.match(html, /原Task|已有任务/);
});

test('multi-Task review shows the existing summary owner, exact abilities and per-Task start receipts', async () => {
  const multi = plan(), summaryId = '00000000-0000-4000-8000-000000000008'; multi.taskMode = 'multi';
  multi.tasks[0].capabilities = [{ kind: 'sap-method', id: 'window-method', version: '3' }];
  multi.tasks.push({ key: 'evidence', name: '另一个分析任务', selected: true, scope: '独立证据', capabilities: [] }, { key: 'summary', name: '原项目综合Task', selected: false, taskId: summaryId, scope: '准确综合', capabilities: [] }); multi.summaryTaskKey = 'summary';
  const confirmation = { id: '00000000-0000-4000-8000-000000000009', projectId: project.id, planVersion: 1, mode: 'start', confirmedAt: '2026-11-16T00:00:00.000Z', authorizations: [{ operationId: '00000000-0000-4000-8000-000000000009', mode: 'start', authorizedAt: '2026-11-16T00:00:00.000Z' }], plan: multi, tasks: [{ taskKey: 'original', taskId: project.tasks[0].id, createRequestId: 'create', startRequestId: 'start', createStatus: 'not-required', startStatus: 'accepted', observations: [] }, { taskKey: 'evidence', taskId: 'new-task', createRequestId: 'new-create', startRequestId: 'new-start', createStatus: 'unknown', startStatus: 'pending', createCode: 'create_result_unknown', observations: [] }, { taskKey: 'summary', taskId: summaryId, createRequestId: 'summary-create', startRequestId: 'summary-start', createStatus: 'not-required', startStatus: 'accepted', observations: [] }] };
  const html = await renderedPage({ project, ...noops, initialCapabilities: { skills: [], methods: [{ id: 'window-method', title: '原窗口核对方法', version: '3' }], connectors: [{ id: 'weather', title: '天气连接器', enabled: false, requiresPermission: true }], materials: [], caseContexts: [] }, initialState: { formatVersion: 1, projectId: project.id, revision: 7, draft: { version: 1, createdAt: '2026-11-16T00:00:00.000Z', plan: multi }, confirmed: confirmation, history: [confirmation] } });
  assert.match(html, /原项目综合Task/); assert.match(html, /原窗口核对方法/); assert.match(html, /SAP \/ IR/);
  assert.match(html, /复用已有任务/); assert.match(html, /已接纳启动/); assert.match(html, /UNKNOWN · 待核对/); assert.match(html, /create_result_unknown/);
  assert.match(html, /连接配置未启用/); assert.doesNotMatch(html, /全部任务已完成/);
});

test('a goal source does not invent a Case and archived projects retain read-only navigation', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('SSR must not fetch or start'); };
  try {
    const html = await renderedPage({ project: { ...project, archivedAt: '2026-11-16T00:00:00.000Z' }, ...noops, initialGoal: { goalId: '00000000-0000-4000-8000-000000000010', version: 2 }, initialCapabilities: { skills: [], methods: [], connectors: [], materials: [], caseContexts: [] }, initialState: { formatVersion: 1, projectId: project.id, revision: 0, history: [] } });
    assert.match(html, /当前尚未据此新建或绑定 Case/); assert.match(html, /无 Case · 查询、核对或 Studio 工作/);
    assert.match(html, /fieldset[^>]*disabled/); assert.match(html, /查看原任务：原Task/); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('a goal-backed project offers the original Case creation and existing Case adoption paths while no-Case work remains an explicit option', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('SSR must not mutate'); };
  try {
    const html = await renderedPage({ project, ...noops, initialGoal: { goalId: '00000000-0000-4000-8000-000000000010', version: 2 }, newTaskIntent: '00000000-0000-4000-8000-000000000020', initialCapabilities: { skills: [], methods: [], connectors: [], materials: [], caseContexts: [] }, initialState: { formatVersion: 1, projectId: project.id, revision: 0, history: [] } });
    assert.match(html, /从来源目标建立Case并关联本项目/); assert.match(html, /复用原Case/); assert.match(html, /无 Case · 查询、核对或 Studio 工作/);
    assert.match(html, /值得持续推进的经营问题由Case承接/); assert.match(html, /本次目标用途/); assert.match(html, /GSA已明确安排的工作/); assert.match(html, /请选择实际用途，不依据诉求代猜/); assert.match(html, /原Task/); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('a changed Case directory does not silently replace the draft revision or selected older method', async () => {
  const context = { caseId: '00000000-0000-4000-8000-000000000011', primaryGoal: { goalId: '00000000-0000-4000-8000-000000000012', version: 1 }, caseRevision: 2, projectWorkRevision: 0 };
  const draft = plan(); draft.caseContext = context; draft.tasks[0].capabilities = [{ kind: 'sap-method', id: 'original-method', version: '1' }];
  const html = await renderedPage({ project, ...noops, initialCapabilities: { skills: [], methods: [{ id: 'original-method', title: '当前方法', version: '2' }], connectors: [], materials: [], caseContexts: [{ ...context, title: '原Case', caseRevision: 3 }] }, initialState: { formatVersion: 1, projectId: project.id, revision: 1, draft: { version: 1, createdAt: '2026-11-16T00:00:00.000Z', plan: draft }, history: [] } });
  assert.match(html, /当前目录版本已变化，原草稿未自动替换/); assert.match(html, /原已选引用：original-method/); assert.match(html, /版本待核|\/ 1/);
  assert.equal(draft.caseContext.caseRevision, 2); assert.equal(draft.tasks[0].capabilities[0].version, '1');
});
test('lightweight Agent preparation exposes a separate stop and never presents cancelled or unknown work as a completed draft', async () => {
  const base = { formatVersion: 1, projectId: project.id, revision: 1, draft: { version: 1, createdAt: '2026-11-16T00:00:00.000Z', plan: plan() }, history: [] }, catalog = { skills: [], methods: [], connectors: [], materials: [], caseContexts: [] };
  const ready = await renderedPage({ project, ...noops, initialCapabilities: catalog, initialState: base });
  assert.match(ready, /请 Agent 轻量梳理/); assert.match(ready, /手动补充/);
  for (const status of ['running', 'unknown', 'cancelled', 'completed'] as const) {
    const html = await renderedPage({ project, ...noops, initialCapabilities: catalog, initialState: { ...base, preparations: [{ operationId: '00000000-0000-4000-8000-000000000018', inputHash: 'a'.repeat(64), status }] } });
    if (status !== 'cancelled') { assert.match(html, /停止本次梳理/); assert.match(html, /fieldset[^>]*disabled/); }
    else assert.match(html, /本次梳理已取消/);
    assert.doesNotMatch(html, /Agent 已完成轻量梳理/);
  }
});

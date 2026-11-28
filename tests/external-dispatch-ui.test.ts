import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { startTestHost } from './fixtures/host-process.ts';
import type { ExternalTaskSummary } from '../src/host/external-work-types.ts';

const HOUR = 3_600_000;
const code = (error: unknown): { code?: string; status?: number } => {
  if (error && typeof error === 'object' && 'code' in error) return { code: String((error as { code: unknown }).code), status: (error as { status?: number }).status };
  return {};
};

// ---------------------------------------------------------------------------
// Part A: Host HTTP routes (real test host, additive /api routes from S6a).
// ---------------------------------------------------------------------------

test('S6a routes: task external-dispatch summary is read-only GET with zero records and pause state', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { project, task, taskId } = await makeTask(host, '外派摘要只读');
  const route = `/api/projects/${project.id}/tasks/${taskId}/external-dispatch`;
  const first = await host.request(route, 'GET');
  assert.equal(first.status, 200, await first.clone().text());
  const view = await first.json();
  assert.equal(view.summary.projectId, project.id);
  assert.equal(view.summary.taskId, taskId);
  assert.equal(view.summary.internalChoice, null);
  assert.deepEqual(view.summary.works, []);
  assert.equal(view.pause, null);
  const again = await host.request(route, 'GET');
  assert.deepEqual(await again.json(), view, 'repeated read-only GET returns the same view');
  const wrongMethod = await host.request(route, 'POST', {});
  assert.equal(wrongMethod.status, 404, 'summary route accepts GET only');
});

test('S6a routes: authorize validates grant input, explicit enterprise and original asset qualification', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { route, grant } = await makeTask(host, '外派授权校验');
  const missingEnterprise = await host.request(`${route}/authorize`, 'POST', { ...grant, enterprise: undefined });
  assert.equal(missingEnterprise.status, 400, await missingEnterprise.clone().text());
  assert.equal((await missingEnterprise.json()).code, 'external_enterprise_required');
  const expired = await host.request(`${route}/authorize`, 'POST', { ...grant, validUntil: new Date(Date.now() - HOUR).toISOString() });
  assert.equal(expired.status, 400);
  assert.equal((await expired.json()).code, 'external_grant_expired');
  const noExecutors = await host.request(`${route}/authorize`, 'POST', { ...grant, allowedExecutors: [] });
  assert.equal(noExecutors.status, 400);
  // The qualification seam intersects with the original Studio/semantic current qualification:
  // an unpublished studio-source ref is refused instead of silently granted.
  const unqualified = await host.request(`${route}/authorize`, 'POST', {
    ...grant,
    assetRefs: [{ authority: 'studio-source', id: 'unpublished-asset', version: 'v9', hash: 'a'.repeat(64) }],
  });
  assert.equal(unqualified.status, 403, await unqualified.clone().text());
  assert.equal((await unqualified.json()).code, 'external_asset_not_qualified');
  const summary = await (await host.request(`${route}`, 'GET')).json();
  assert.deepEqual(summary.summary.works, [], 'refused authorizations persist no work');
});

test('S6a routes: authorize persists grant+work, summary reflects it and choose-internal stays blocked until cancel', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { route, grant } = await makeTask(host, '外派授权落账');
  const created = await host.request(`${route}/authorize`, 'POST', grant);
  assert.equal(created.status, 201, await created.clone().text());
  const { grant: savedGrant, work } = await created.json();
  assert.equal(savedGrant.goal, grant.goal);
  assert.equal(savedGrant.resourcePolicy.maxWorks, 1, 'default 1work/24h policy is snapshotted');
  assert.equal(work.revision, 1);
  assert.equal(work.status, 'authorized');
  const view = await (await host.request(route, 'GET')).json();
  assert.equal(view.summary.works.length, 1);
  assert.equal(view.summary.works[0].workId, work.workId);
  assert.deepEqual(view.summary.works[0].publications, [], 'authorization records zero external publications');
  const blocked = await host.request(`${route}/choose-internal`, 'POST', {});
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'external_work_active');
  const cancelled = await host.request(`${route}/works/${work.workId}/cancel`, 'POST', { reason: '改走内部' });
  assert.equal(cancelled.status, 200, await cancelled.clone().text());
  const after = await (await host.request(route, 'GET')).json();
  assert.equal(after.summary.works[0].status, 'cancelled');
  const choice = await host.request(`${route}/choose-internal`, 'POST', {});
  assert.equal(choice.status, 200, await choice.clone().text());
  const choiceView = await (await host.request(route, 'GET')).json();
  assert.ok(choiceView.summary.internalChoice, 'internal choice is recorded after the work is cancelled');
});

test('S6a routes: cancel keeps every ledger fact, records the stop request as unsupported without an external seam and is idempotent', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { route, grant } = await makeTask(host, '外派取消合同');
  const { work } = await (await host.request(`${route}/authorize`, 'POST', grant)).json();
  const cancelled = await (await host.request(`${route}/works/${work.workId}/cancel`, 'POST', { reason: '停止外派' })).json();
  assert.equal(cancelled.work.status, 'cancelled');
  assert.equal(cancelled.stopRequest.status, 'unsupported', 'no external stop seam is wired this slice: honestly unsupported, never reported stopped');
  const repeat = await (await host.request(`${route}/works/${work.workId}/cancel`, 'POST', { reason: '重复取消' })).json();
  assert.equal(repeat.stopRequest.status, 'unsupported');
  const view = await (await host.request(route, 'GET')).json();
  assert.equal(view.summary.works.length, 1, 'cancel never creates a second work');
  assert.deepEqual(view.summary.works[0].publications, [], 'cancel is zero external action');
  assert.deepEqual(view.summary.works[0].claim, null);
  const missing = await host.request(`${route}/works/${'9'.repeat(8)}/cancel`, 'POST', { reason: '不存在' });
  assert.equal(missing.status, 404);
});

test('S6a routes: pause-resume / resume-resume persist the auto-resume pause for this task only', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { route, taskId } = await makeTask(host, '外派暂停续接');
  const paused = await host.request(`${route}/pause-resume`, 'POST', { reason: 'manual' });
  assert.equal(paused.status, 200, await paused.clone().text());
  const pause = (await paused.json()).pause;
  assert.equal(pause.reason, 'manual');
  const view = await (await host.request(route, 'GET')).json();
  assert.equal(view.pause.projectId, view.summary.projectId);
  assert.equal(view.pause.taskId, taskId);
  const resumed = await host.request(`${route}/resume-resume`, 'POST', {});
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).pause, null);
  const after = await (await host.request(route, 'GET')).json();
  assert.equal(after.pause, null);
});

test('S6a routes: publish requires the task GitHub binding and records nothing without it', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { route, grant } = await makeTask(host, '外派发布绑定');
  const { work } = await (await host.request(`${route}/authorize`, 'POST', grant)).json();
  const refused = await host.request(`${route}/works/${work.workId}/publish`, 'POST', { revision: 1, action: 'issue-create', body: '外派工单正文' });
  assert.equal(refused.status, 409, await refused.clone().text());
  assert.equal((await refused.json()).code, 'external_publish_binding_missing');
  const view = await (await host.request(route, 'GET')).json();
  assert.deepEqual(view.summary.works[0].publications, [], 'a publish without a verified task binding never leaves a ledger attempt');
  const archivedRefusal = await archiveTaskAndAssert(host, route, grant);
  assert.equal(archivedRefusal.status, 409);
});

test('S6a routes: external settings view reports real core connection state and the optional workbuddy gate', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const view = await (await host.request('/api/external-dispatch/settings', 'GET')).json();
  assert.equal(view.core.github.status, 'disconnected');
  assert.equal(view.core.github.verified, false);
  assert.equal(view.optional.optional, true);
  assert.equal(view.optional.defaultState, 'integration_unverified');
  assert.equal(view.optional.ready, false);
  assert.equal(view.optional.quota.limit, 3);
});

async function routeHost(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-dispatch-ui-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(async () => { await host.close().catch(() => {}); });
  const configured = await host.request('/api/configuration', 'PUT', { name: '外派UI', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1', model: 'synthetic-dispatch-ui', apiKey: 'synthetic-dispatch-ui-only' });
  assert.equal(configured.status, 200, await configured.clone().text());
  return host;
}

type RouteHost = Awaited<ReturnType<typeof routeHost>>;
async function makeTask(host: RouteHost, name: string) {
  const created = await host.request('/api/projects', 'POST', { name: `外派UI ${name}` });
  assert.equal(created.status, 201, await created.clone().text());
  const { project } = await created.json();
  const taskCreated = await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name });
  assert.equal(taskCreated.status, 201, await taskCreated.clone().text());
  const { task } = await taskCreated.json();
  const route = `/api/projects/${project.id}/tasks/${task.id}/external-dispatch`;
  const grant = {
    goal: `核对${name}的业务口径`,
    scope: `${name}：整理字段映射与重复记录，不改生产、不联系会员`,
    forbidden: '',
    allowedExecutors: ['generic-agent'],
    repository: { stableId: 'example-org/private-work', visibility: 'private' as const },
    assetRefs: [],
    inputs: [],
    enterprise: 'ent-1',
    validUntil: new Date(Date.now() + HOUR).toISOString(),
    summary: `${name}工作片段`,
    deliveryCriteria: '覆盖字段映射并列出未核事项；不代外部宣称完成',
  };
  return { project, task, taskId: task.id, route, grant };
}

async function archiveTaskAndAssert(host: RouteHost, route: string, grant: Record<string, unknown>) {
  const taskRoute = route.replace(/\/external-dispatch$/, '');
  const archived = await host.request(`${taskRoute}/archive`, 'POST', {});
  assert.equal(archived.status, 200, await archived.clone().text());
  return host.request(`${route}/authorize`, 'POST', grant);
}

// ---------------------------------------------------------------------------
// Part B: browser client contract (request shapes, owner checks, error mapping).
// ---------------------------------------------------------------------------

test('S6a client: summary/pause reads are GET, actions keep exact owner paths and bodies', async t => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const summary = { projectId: 'project-a', taskId: 'task-a', internalChoice: null, works: [] };
  const payload = { summary, pause: null };
  t.mock.method(globalThis, 'fetch', async (url: string, init: any) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const target = String(url);
    if (target.endsWith('/authorize')) return Response.json({ grant: { grantId: 'g1' }, work: { workId: 'w1' } });
    if (target.endsWith('/cancel')) return Response.json({ work: { workId: 'work-9' }, stopRequest: { stopRequestId: 'stop-1', workId: 'work-9', status: 'unsupported', createdAt: '2026-11-28T10:00:00.000Z', updatedAt: '2026-11-28T10:00:00.000Z' } });
    if (target.endsWith('/choose-internal')) return Response.json({ choice: { projectId: 'project-a', taskId: 'task-a', mode: 'internal', decidedAt: '2026-11-28T10:00:00.000Z' } });
    if (target.endsWith('/pause-resume')) return Response.json({ pause: { projectId: 'project-a', taskId: 'task-a', reason: 'manual', pausedAt: '2026-11-28T10:00:00.000Z' } });
    if (target.endsWith('/publish')) return Response.json({ attempt: { operationId: 'op-1', workId: 'work-9', revision: 1, action: 'issue-create', bodyHash: 'c'.repeat(64), status: 'prepared', createdAt: '2026-11-28T10:00:00.000Z', updatedAt: '2026-11-28T10:00:00.000Z' }, dispatched: true });
    return Response.json(payload);
  });
  const client = await import('../src/host/ui/external-dispatch-client.ts');
  await client.readTaskExternalDispatch('project-a', 'task-a');
  await client.authorizeExternalWork('project-a', 'task-a', { goal: 'g' } as never);
  await client.chooseInternalCompletion('project-a', 'task-a');
  await client.cancelExternalWork('project-a', 'task-a', 'work-9', '停止外派');
  await client.pauseExternalResume('project-a', 'task-a', 'manual');
  await client.resumeExternalResume('project-a', 'task-a');
  await client.publishExternalWork('project-a', 'task-a', 'work-9', { revision: 1, action: 'issue-create', body: '工单' });
  assert.deepEqual(calls, [
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch', method: 'GET', body: undefined },
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/authorize', method: 'POST', body: { goal: 'g' } },
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/choose-internal', method: 'POST', body: {} },
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/works/work-9/cancel', method: 'POST', body: { reason: '停止外派' } },
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/pause-resume', method: 'POST', body: { reason: 'manual' } },
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/resume-resume', method: 'POST', body: {} },
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/works/work-9/publish', method: 'POST', body: { revision: 1, action: 'issue-create', body: '工单' } },
  ]);
});

test('S6a client: another owner summary is refused and backend codes map to typed errors', async t => {
  const client = await import('../src/host/ui/external-dispatch-client.ts');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ summary: { projectId: 'project-b', taskId: 'task-a', internalChoice: null, works: [] }, pause: null }));
  await assert.rejects(client.readTaskExternalDispatch('project-a', 'task-a'), /归属/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'external_profile_forbidden' }, { status: 403 }));
  await assert.rejects(client.chooseInternalCompletion('project-a', 'task-a'), (error: unknown) => error instanceof client.ExternalDispatchRequestError && error.code === 'external_profile_forbidden' && error.status === 403);
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); if (init.method === 'POST') throw new TypeError('response lost'); return Response.json(payloadOf()); });
  function payloadOf() { return { summary: { projectId: 'project-a', taskId: 'task-a', internalChoice: null, works: [] }, pause: null }; }
  await assert.rejects(client.cancelExternalWork('project-a', 'task-a', 'work-1', '取消'), client.ExternalDispatchUncertain);
  assert.deepEqual(methods, ['POST'], 'a lost action response is uncertain; the client never auto-retries');
});

// ---------------------------------------------------------------------------
// Part C: components (frozen-demo mapping, production tokens, real data props).
// ---------------------------------------------------------------------------

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
const findAll = (tree: Element[], predicate: (node: Element) => boolean): Element[] => {
  const found: Element[] = [];
  const walk = (node: any): void => {
    for (const current of nodes(node)) { if (predicate(current)) found.push(current); walk(current.props?.children); }
  };
  walk(tree);
  return found;
};
const click = (tree: Element[], predicate: (node: Element) => boolean) => {
  const target = findAll(tree, predicate).at(-1);
  assert.ok(target, 'expected a clickable node');
  target.props.onClick?.({ preventScroll: true, currentTarget: {} });
};

let bundle: string | undefined;
async function harness(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  const built = await build({
    stdin: { contents: `export {TaskWorkModeCard} from './src/host/ui/TaskWorkModeCard.tsx';export {ExternalDispatchDrawer} from './src/host/ui/ExternalDispatchDrawer.tsx';export {ExternalWorkPanel, externalWorkStatusView} from './src/host/ui/ExternalWorkPanel.tsx';`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, globalName: 'DispatchUiTest',
    plugins: [{ name: 'dispatch-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'dispatch-hooks' }));
      plugin.onLoad({ filter: /.*/, namespace: 'dispatch-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' : 'export const useState=v=>globalThis.__dispatchHooks.state(v);export const useRef=v=>globalThis.__dispatchHooks.ref(v);export const useEffect=(f,d)=>globalThis.__dispatchHooks.effect(f,d);export const useId=()=>`dispatch-${globalThis.__dispatchHooks.cursor()}`;export const useMemo=(f,d)=>f();export const useCallback=f=>f;export const useViewport=(...a)=>({isNarrow:false,viewportWidth:1440});' }));
    } }],
  });
  bundle ??= built.outputFiles[0].text;
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const documentStub = { addEventListener(kind: string, handler: (event: unknown) => void) { (listeners[kind] ??= []).push(handler); }, removeEventListener(kind: string, handler: (event: unknown) => void) { listeners[kind] = (listeners[kind] ?? []).filter(item => item !== handler); }, activeElement: null, body: {} };
  const sandbox: Record<string, any> = { fetch: fetcher as typeof fetch, document: documentStub, structuredClone, crypto, Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout, AbortController, window: { addEventListener() {}, removeEventListener() {}, location: { href: 'http://127.0.0.1:4183/' } } };
  runInNewContext(bundle, sandbox);
  function mount(Component: (props: any) => Element, props: Record<string, any>) {
    const values: any[] = [], dependencies: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
    let cursor = 0, tree: Element;
    const hooks = {
      cursor: () => cursor,
      state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
      ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
      effect(fn: () => any, deps: any[]) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => v !== dependencies[i][n])) { dependencies[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
    };
    const render = () => { cursor = 0; sandbox.__dispatchHooks = hooks; tree = Component(props); while (effects.length) effects.shift()!(); };
    const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
    render();
    return { render, settle, nodes: () => nodes(tree), tree: () => tree, text: () => text(tree), press: (eventKey: string) => { for (const handler of listeners['keydown'] ?? []) handler({ key: eventKey }); }, close: () => { for (const fn of cleanup) fn?.(); } };
  }
  return { ...sandbox.DispatchUiTest, mount };
}

const emptySummary: ExternalTaskSummary = { projectId: 'project-a', taskId: 'task-a', internalChoice: null, works: [] };
const authorizedEntry: ExternalTaskSummary['works'][number] = {
  workId: 'work-1', revision: 1, status: 'authorized', summary: '核查四店会员字段映射与重复记录', grantId: 'grant-1', grantVersion: 1, createdAt: '2026-11-28T10:00:00.000Z',
  publications: [{ operationId: 'op-1', action: 'issue-create', status: 'succeeded', issueId: '42' }],
  claim: { claimId: 'claim-1', principal: 'executor-a', epoch: 1, leaseDeadline: '2026-11-28T10:15:00.000Z', status: 'active' },
  deliveryCount: 0, reviewCount: 0, latestReview: null,
};

test('S6a card: no external work renders the agent suggestion with internal primary and dispatch secondary and zero external note', async t => {
  const h = await harness(async () => Response.json({ summary: emptySummary, pause: null }));
  const actions = { authorize: 0, internal: 0, open: 0 };
  const ui = h.mount(h.TaskWorkModeCard, {
    projectId: 'project-a', taskId: 'task-a', suggestion: '核查四店会员字段映射与重复记录',
    onAuthorize: () => { actions.authorize += 1; }, onOpenWork: () => { actions.open += 1; },
    onSummary: () => {},
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /Agent 的建议/);
    assert.match(ui.text(), /核查四店会员字段映射与重复记录/);
    assert.match(ui.text(), /未授权不发单、不触发外部执行者、不开放外部资产/);
    click(ui.tree(), node => node.type === 'button' && text(node).includes('在 OptraCall 内完成'));
    click(ui.tree(), node => node.type === 'button' && text(node).includes('通过 GitHub 外派'));
    assert.deepEqual(actions, { authorize: 1, internal: 0, open: 0 });
    const buttons = findAll(ui.tree(), node => node.type === 'button').map(node => text(node));
    assert.ok(buttons.some(label => label.includes('在 OptraCall 内完成')));
    assert.ok(!buttons.some(label => label.includes('查看协作进展')), 'no work yet: no work-page shortcut');
  } finally { ui.close(); }
});

test('S6a card: an authorized external work switches the card to the status snapshot with the work shortcut', async t => {
  const h = await harness(async () => Response.json({ summary: { ...emptySummary, works: [authorizedEntry] }, pause: null }));
  const actions = { authorize: 0, open: 0 };
  const ui = h.mount(h.TaskWorkModeCard, {
    projectId: 'project-a', taskId: 'task-a', suggestion: '核查四店会员字段映射',
    onAuthorize: () => { actions.authorize += 1; }, onOpenWork: () => { actions.open += 1; }, onSummary: () => {},
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /核查四店会员字段映射与重复记录/);
    assert.match(ui.text(), /执行中|待领取/);
    assert.match(ui.text(), /查看协作进展/);
    assert.ok(findAll(ui.tree(), node => node.props['data-tone'] === 'amber' || node.props['data-tone'] === 'green').length >= 1, 'status pill uses the production tone system');
    click(ui.tree(), node => node.type === 'button' && text(node).includes('查看协作进展'));
    assert.equal(actions.open, 1);
    assert.ok(!findAll(ui.tree(), node => node.type === 'button' && text(node).includes('通过 GitHub 外派')).length, 'dispatched work: the card no longer offers a second dispatch');
  } finally { ui.close(); }
});

test('S6a card: backend refusal on choose-internal is shown, never silently retried', async t => {
  const h = await harness(async (url: string, init: any) => String(url).includes('choose-internal') && init.method === 'POST'
    ? Response.json({ code: 'external_work_active' }, { status: 409 })
    : Response.json({ summary: emptySummary, pause: null }));
  const ui = h.mount(h.TaskWorkModeCard, { projectId: 'project-a', taskId: 'task-a', suggestion: '片段', onAuthorize: () => {}, onOpenWork: () => {}, onSummary: () => {} });
  try {
    await ui.settle();
    click(ui.tree(), node => node.type === 'button' && text(node).includes('在 OptraCall 内完成'));
    await ui.settle();
    assert.match(ui.text(), /已有进行中的外派工作|外派/, 'the refusal text mentions the active external work');
  } finally { ui.close(); }
});

test('S6a drawer: frozen fields render with workbuddy disabled and the exact-content snapshot, and confirm posts the grant', async t => {
  const bodies: unknown[] = [];
  const h = await harness(async (url: string, init: any) => {
    if (String(url).endsWith('/authorize') && init.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return Response.json({ grant: { grantId: 'g-1', goal: 'x' }, work: { workId: 'w-9' } }); }
    return Response.json({});
  });
  const events: { closed: number; authorized: string[]; internal: number } = { closed: 0, authorized: [], internal: 0 };
  const ui = h.mount(h.ExternalDispatchDrawer, {
    open: true, projectId: 'project-a', taskId: 'task-a', taskName: '四店会员资料一致性核查', piece: '核查四店会员字段映射与重复记录',
    repositories: ['example-org/private-work'], enterprise: 'ent-1',
    assets: [{ authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: 'b'.repeat(64) }],
    workbuddyReady: false,
    onClose: () => { events.closed += 1; },
    onChooseInternal: () => { events.internal += 1; },
    onAuthorized: (result: { work: { workId: string } }) => { events.authorized.push(result.work.workId); },
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /业务目标/);
    assert.match(ui.text(), /核查四店会员字段映射与重复记录/);
    assert.match(ui.text(), /接单方式/);
    assert.match(ui.text(), /WorkBuddy.*联合验证未通过|联合验证未通过/);
    assert.match(ui.text(), /已批准通用 Agent 集合|通用 Agent/);
    assert.match(ui.text(), /example-org\/private-work/);
    assert.match(ui.text(), /确切内容|授权快照/);
    const workbuddyOption = findAll(ui.tree(), node => node.type === 'option' && text(node).includes('WorkBuddy')).at(-1);
    assert.equal(workbuddyOption?.props.disabled, true, 'unverified workbuddy stays disabled');
    const memberAsset = findAll(ui.tree(), node => node.type === 'input' && node.props.type === 'checkbox').length;
    assert.ok(memberAsset >= 1, 'qualified assets are offered as shrinkable checkboxes');
    const goalBox = findAll(ui.tree(), node => node.type === 'textarea').at(-1)!;
    goalBox.props.onChange?.({ target: { value: '核对四店会员口径' } });
    ui.render();
    click(ui.tree(), node => node.type === 'button' && text(node).includes('确认外派'));
    await ui.settle();
    assert.deepEqual(bodies.length, 1, 'confirm posts the composed grant');
  } finally { ui.close(); }
});

test('S6a drawer: escape closes and focus restore hooks register', async t => {
  const h = await harness(async () => Response.json({}));
  const events = { closed: 0 };
  const ui = h.mount(h.ExternalDispatchDrawer, {
    open: true, projectId: 'project-a', taskId: 'task-a', taskName: '任务', piece: '片段',
    repositories: ['example-org/private-work'], enterprise: 'ent-1', assets: [],
    onClose: () => { events.closed += 1; }, onChooseInternal: () => {}, onAuthorized: () => {},
  });
  try {
    await ui.settle();
    ui.press('Escape');
    assert.equal(events.closed, 1, 'Escape closes the drawer');
    const closed = h.mount(h.ExternalDispatchDrawer, {
      open: false, projectId: 'project-a', taskId: 'task-a', taskName: '任务', piece: '片段',
      repositories: [], enterprise: '', assets: [], onClose: () => {}, onChooseInternal: () => {}, onAuthorized: () => {},
    });
    assert.equal(closed.text(), '', 'closed drawer renders nothing');
  } finally { ui.close(); }
});

test('S6a drawer: confirm composes the real grant input (goal/scope/enterprise/repo/assets/expiry) and reports the result', async t => {
  const bodies: unknown[] = [];
  const h = await harness(async (url: string, init: any) => {
    if (String(url).endsWith('/authorize') && init.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return Response.json({ grant: { grantId: 'g-1' }, work: { workId: 'w-9' } }); }
    return Response.json({});
  });
  const authorized: string[] = [];
  const ui = h.mount(h.ExternalDispatchDrawer, {
    open: true, projectId: 'project-a', taskId: 'task-a', taskName: '四店会员核查', piece: '核查四店会员字段映射与重复记录',
    repositories: ['example-org/private-work'], enterprise: 'ent-1',
    assets: [{ authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: 'b'.repeat(64) }],
    sourceCaseRef: { caseId: 'case-1', issueId: 'issue-3' },
    onClose: () => {}, onChooseInternal: () => {}, onAuthorized: (result: { work: { workId: string } }) => { authorized.push(result.work.workId); },
  });
  try {
    await ui.settle();
    const checkbox = findAll(ui.tree(), node => node.type === 'input' && node.props.type === 'checkbox').at(-1)!;
    checkbox.props.onChange?.({ target: { checked: false } });
    ui.render();
    const goalBox = findAll(ui.tree(), node => node.type === 'textarea').at(-1)!;
    goalBox.props.onChange?.({ target: { value: '核对四店会员口径' } });
    ui.render();
    click(ui.tree(), node => node.type === 'button' && text(node).includes('确认外派'));
    await ui.settle();
    assert.deepEqual(authorized, ['w-9']);
    assert.equal(bodies.length, 1);
    const grant = bodies[0] as Record<string, any>;
    assert.equal(grant.goal, '核对四店会员口径');
    assert.equal(grant.scope, '核查四店会员字段映射与重复记录');
    assert.equal(grant.summary, '核查四店会员字段映射与重复记录');
    assert.equal(grant.enterprise, 'ent-1');
    assert.deepEqual(grant.repository, { stableId: 'example-org/private-work', visibility: 'private' });
    assert.deepEqual(grant.assetRefs, [], 'unchecked asset is not granted');
    assert.deepEqual(grant.allowedExecutors, ['generic-agent']);
    assert.ok(Number.isFinite(Date.parse(grant.validUntil)), 'expiry select becomes an explicit ISO deadline');
    assert.ok(Date.parse(grant.validUntil) > Date.now());
    assert.deepEqual(grant.sourceCaseRef, { caseId: 'case-1', issueId: 'issue-3' });
  } finally { ui.close(); }
});

test('S6a drawer: missing enterprise or repository blocks confirm with visible reasons', async t => {
  const h = await harness(async () => Response.json({}));
  const posted: unknown[] = [];
  const ui = h.mount(h.ExternalDispatchDrawer, {
    open: true, projectId: 'project-a', taskId: 'task-a', taskName: '任务', piece: '片段',
    repositories: [], enterprise: '',
    onClose: () => {}, onChooseInternal: () => {}, onAuthorized: () => { posted.push(1); },
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /企业范围/);
    const goalBox = findAll(ui.tree(), node => node.type === 'textarea').at(-1)!;
    goalBox.props.onChange?.({ target: { value: '目标' } });
    ui.render();
    click(ui.tree(), node => node.type === 'button' && text(node).includes('确认外派'));
    assert.deepEqual(posted, [], 'confirm without repository/enterprise never posts');
    assert.match(ui.text(), /仓库|GitHub/, 'the blocking reason is visible');
  } finally { ui.close(); }
});

test('S6a panel: dispatched work renders the work card, dual status grid, ledger timeline, three boundaries and receipt', async t => {
  const h = await harness(async () => Response.json({ summary: { ...emptySummary, works: [authorizedEntry] }, pause: null }));
  const actions = { drawer: 0, chat: 0, pause: 0, cancel: 0 };
  const ui = h.mount(h.ExternalWorkPanel, {
    projectId: 'project-a', taskId: 'task-a', taskName: '四店会员资料一致性核查', panel: 'external', externalCount: 1,
    onSwitchPanel: (panel: 'chat' | 'report' | 'external') => { if (panel === 'chat') actions.chat += 1; },
    onOpenDrawer: () => { actions.drawer += 1; },
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /一段工作，始终回到原任务/);
    assert.match(ui.text(), /核查四店会员字段映射与重复记录/);
    assert.match(ui.text(), /GitHub 通信 \/ 证据|GitHub.*证据/);
    assert.match(ui.text(), /Host 台账|原任务验收/);
    assert.match(ui.text(), /Host 工作台账|台账/);
    assert.match(ui.text(), /三个边界/);
    assert.match(ui.text(), /工单 \/ GitHub/);
    assert.match(ui.text(), /远端 MCP \/ 两组权限/);
    assert.match(ui.text(), /验收 \/ 原任务 Agent/);
    assert.match(ui.text(), /工作交接与回执/);
    assert.match(ui.text(), /Issue #42/);
    assert.match(ui.text(), /授权已确认|外派授权/, 'the timeline starts from the real authorize fact');
    assert.match(ui.text(), /executor-a/, 'the active claim surfaces its principal');
    click(ui.tree(), node => node.type === 'button' && text(node).includes('查看本次授权'));
    assert.equal(actions.drawer, 1);
    click(ui.tree(), node => node.type === 'button' && text(node).includes('暂停本 Task 续接'));
    assert.ok(actions.pause >= 0);
  } finally { ui.close(); }
});

test('S6a panel: no work yet renders the hand-off CTA into the authorization drawer', async t => {
  const h = await harness(async () => Response.json({ summary: emptySummary, pause: null }));
  const events = { drawer: 0 };
  const ui = h.mount(h.ExternalWorkPanel, {
    projectId: 'project-a', taskId: 'task-a', taskName: '任务', panel: 'external',
    onSwitchPanel: () => {}, onOpenDrawer: () => { events.drawer += 1; },
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /把适合外部能力的片段交出去/);
    click(ui.tree(), node => node.type === 'button' && text(node).includes('查看外派建议与授权'));
    assert.equal(events.drawer, 1);
  } finally { ui.close(); }
});

test('S6a panel: cancel flows through the amber confirmation and shows the honest stop-request state', async t => {
  const cancels: string[] = [];
  let stage: 'work' | 'cancelled' = 'work';
  const h = await harness(async (url: string, init: any) => {
    const urlText = String(url);
    if (urlText.endsWith('/cancel') && init.method === 'POST') {
      cancels.push(urlText);
      stage = 'cancelled';
      return Response.json({ work: { ...authorizedEntry, status: 'cancelled' }, stopRequest: { stopRequestId: 'stop-1', workId: 'work-1', status: 'unsupported', createdAt: '2026-11-28T10:00:00.000Z', updatedAt: '2026-11-28T10:05:00.000Z' } });
    }
    return Response.json({ summary: { ...emptySummary, works: [stage === 'work' ? authorizedEntry : { ...authorizedEntry, status: 'cancelled' as const, claim: null }] }, pause: null });
  });
  const ui = h.mount(h.ExternalWorkPanel, {
    projectId: 'project-a', taskId: 'task-a', taskName: '任务', panel: 'external',
    onSwitchPanel: () => {}, onOpenDrawer: () => {},
  });
  try {
    await ui.settle();
    click(ui.tree(), node => node.type === 'button' && text(node).includes('取消外派'));
    ui.render();
    assert.match(ui.text(), /撤回|取消外派/, 'the amber confirmation explains what cancelling does');
    click(ui.tree(), node => node.type === 'button' && text(node).includes('确认取消外派'));
    await ui.settle();
    assert.equal(cancels.length, 1, 'exactly one cancel request');
    assert.match(ui.text(), /取消待核|已取消/);
  } finally { ui.close(); }
});

test('S6a panel: paused auto-resume offers resume and the pause reason stays visible', async t => {
  const h = await harness(async (url: string, init: any) => {
    if (String(url).endsWith('/resume-resume') && init.method === 'POST') return Response.json({ pause: null });
    return Response.json({ summary: { ...emptySummary, works: [authorizedEntry] }, pause: { projectId: 'project-a', taskId: 'task-a', reason: 'task-stop', pausedAt: '2026-11-28T10:00:00.000Z' } });
  });
  const ui = h.mount(h.ExternalWorkPanel, { projectId: 'project-a', taskId: 'task-a', taskName: '任务', panel: 'external', onSwitchPanel: () => {}, onOpenDrawer: () => {} });
  try {
    await ui.settle();
    assert.match(ui.text(), /自动续接已暂停|已暂停/);
    assert.match(ui.text(), /恢复本 Task 续接/);
  } finally { ui.close(); }
});

test('S6a status view: ledger facts map to the frozen tone system without inventing success', async t => {
  const h = await harness(async () => Response.json({}));
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  const view = (entry: Partial<ExternalTaskSummary['works'][number]>) => plain(h.externalWorkStatusView({ ...authorizedEntry, ...entry } as ExternalTaskSummary['works'][number]));
  assert.deepEqual(view({ publications: [] }), { label: '准备发布', tone: 'gray' });
  assert.deepEqual(view({ publications: [{ operationId: 'o', action: 'issue-create', status: 'unknown' }] }), { label: '发布待核 · UNKNOWN', tone: 'amber' });
  assert.deepEqual(view({ publications: [{ operationId: 'o', action: 'issue-create', status: 'succeeded', issueId: '42' }], claim: null }), { label: '待领取', tone: 'gray' });
  assert.deepEqual(view({}), { label: '执行中', tone: 'green' });
  assert.deepEqual(view({ claim: null, deliveryCount: 2, reviewCount: 0 }), { label: '待验收', tone: 'amber' });
  assert.deepEqual(view({ claim: null, deliveryCount: 1, reviewCount: 1, latestReview: { decision: 'accepted' as const, reason: 'r' } }), { label: '已接受', tone: 'green' });
  assert.deepEqual(view({ claim: null, deliveryCount: 1, reviewCount: 1, latestReview: { decision: 'needs-supplement' as const, reason: 'r' } }), { label: '需补充', tone: 'amber' });
  assert.deepEqual(view({ status: 'cancelled' as const, claim: null }), { label: '取消待核', tone: 'red' });
});

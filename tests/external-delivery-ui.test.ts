import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { startTestHost } from './fixtures/host-process.ts';
import type { ExternalTaskSummary } from '../src/host/external-work-types.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hash = (seed: string) => createHash('sha256').update(seed).digest('hex');
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

// ---------------------------------------------------------------------------
// Part A: Host HTTP routes (real test host, additive read-only routes from S6b).
// ---------------------------------------------------------------------------

test('S6b routes: deliveries view is a read-only GET composed from real ledger facts', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { route, projectId, grant } = await makeTask(host, '交付台账只读');
  const deliveriesRoute = `${route}/deliveries`;
  const before = await host.request(deliveriesRoute, 'GET');
  assert.equal(before.status, 200, await before.clone().text());
  const empty = await before.json();
  assert.deepEqual(empty, { projectId, taskId: empty.taskId, works: [] }, 'an authorized-free task reports zero works');
  const refused = await host.request(deliveriesRoute, 'POST', {});
  assert.equal(refused.status, 404, 'delivery view accepts GET only');
  const { work } = await (await host.request(`${route}/authorize`, 'POST', grant)).json();

  await seedLedger(host, {
    projectId,
    taskId: empty.taskId,
    workId: work.workId,
    grantId: (await (await host.request(`${route}`, 'GET')).json()).summary.works[0].grantId,
    publication: { action: 'issue-create' as const, status: 'succeeded' as const, issueId: '42' },
    claim: { principal: 'executor-a', epoch: 1, active: true },
    deliveries: [
      { deliveryId: 'delivery-old', idempotencyKey: 'idem-old', manifestHash: hash('manifest-old'), preservation: 'failed' as const, preservationReason: 'missing_pieces', facts: { done: [], notDone: ['差异位置未提供'], failed: ['摘要缺失'], unknown: [] }, createdAt: iso(-2 * HOUR) },
      {
        deliveryId: 'delivery-new', idempotencyKey: 'idem-new', manifestHash: hash('manifest-new'), preservation: 'preserved' as const,
        storage: [
          { logicalPath: '差异明细.csv', relativePath: 'd/x/差异明细.csv', sha256: hash('diff-bytes'), bytes: 2048 },
          { logicalPath: '验证说明.md', relativePath: 'd/x/验证说明.md', sha256: hash('notes-bytes'), bytes: 512 },
        ],
        links: [{ logicalPath: '外部清单.pdf', url: 'https://external.example.invalid/list.pdf' }],
        assetsUsed: [{ authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: hash('member') }],
        facts: { done: ['4 店映射差异已列出', '重复记录 26 条已按口径核对'], notDone: ['业务系统写入未执行'], failed: [], unknown: ['1 组身份对应无法确定'] },
        createdAt: iso(-HOUR),
      },
    ],
    reviews: [
      { reviewId: 'review-old', deliveryId: 'delivery-old', decision: 'needs-supplement' as const, reason: '缺少差异行号与映射出处', deliveryHash: hash('manifest-old'), createdAt: iso(-90 * 60_000) },
      { reviewId: 'review-new', deliveryId: 'delivery-new', decision: 'accepted' as const, reason: '差异位置与映射出处已补齐，接受这一片段', deliveryHash: hash('manifest-new'), createdAt: iso(-30 * 60_000) },
    ],
  });
  const seeded = await (await host.request(deliveriesRoute, 'GET')).json();
  assert.deepEqual(seeded.works.map((entry: { workId: string }) => entry.workId), [work.workId], 'exactly the real works of this task');
  const entry = seeded.works[0];
  assert.equal(entry.deliveries.length, 2, 'both deliveries are surfaced with their preservation facts');
  const preserved = entry.deliveries.find((item: { deliveryId: string }) => item.deliveryId === 'delivery-new');
  assert.equal(preserved.preservation, 'preserved');
  assert.equal(preserved.storage.length, 2);
  assert.equal(preserved.storage[0].bytes, 2048);
  assert.equal(preserved.links.length, 1, 'link-only entries stay explicitly registered');
  assert.deepEqual(preserved.assetsUsed, [{ authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: hash('member') }]);
  assert.equal(entry.reviews.map((review: { decision: string }) => review.decision).sort().join(','), 'accepted,needs-supplement');
  assert.equal(entry.claim.principal, 'executor-a', 'the active claim surfaces with its principal');
  assert.equal(entry.publications[0].issueId, '42');
  assert.equal(entry.grant.enterprise, 'ent-1');
  const again = await (await host.request(deliveriesRoute, 'GET')).json();
  assert.deepEqual(again, seeded, 'repeated read-only GET returns the same view');
});

test('S6b routes: assets view returns the exact allowlist and delivery-declared references', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const { route, projectId, grant } = await makeTask(host, '资产依据只读');
  const assetsRoute = `${route}/assets`;
  const empty = await (await host.request(assetsRoute, 'GET')).json();
  assert.deepEqual(empty.works, []);
  const refused = await host.request(assetsRoute, 'POST', {});
  assert.equal(refused.status, 404, 'asset view accepts GET only');
  const { work } = await (await host.request(`${route}/authorize`, 'POST', grant)).json();
  const summary = await (await host.request(route, 'GET')).json();
  await seedLedger(host, {
    projectId, taskId: summary.summary.taskId, workId: work.workId, grantId: summary.summary.works[0].grantId,
    claim: { principal: 'executor-b', epoch: 1, active: true },
    grantAssetRefs: [{ authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: hash('member') }, { authority: 'sap-metric', id: 'repeat-rate', version: 'v3.0', hash: hash('metric') }],
    deliveries: [{ deliveryId: 'delivery-1', idempotencyKey: 'idem-1', manifestHash: hash('manifest-1'), preservation: 'preserved' as const, storage: [{ logicalPath: 'a.md', relativePath: 'd/x/a.md', sha256: hash('a'), bytes: 128 }], assetsUsed: [{ authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: hash('member') }], facts: { done: ['已按 v2.1 口径核对'], notDone: [], failed: [], unknown: [] }, createdAt: iso(-HOUR) }],
  });
  const view = await (await host.request(assetsRoute, 'GET')).json();
  const entry = view.works[0];
  assert.deepEqual(entry.grant.assetRefs, [
    { authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: hash('member') },
    { authority: 'sap-metric', id: 'repeat-rate', version: 'v3.0', hash: hash('metric') },
  ], 'the exact allowlist is echoed, never a latest fallback');
  assert.equal(entry.references.length, 1, 'delivery-declared asset references come from real deliveries');
  assert.equal(entry.references[0].assetsUsed[0].id, 'member-definition');
  assert.equal(entry.references[0].preservation, 'preserved');
});

test('S6b routes: project summaries expose per-task works for Case rows without mutating records', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const created = await host.request('/api/projects', 'POST', { name: '外派UI 行摘要' });
  const { project } = await created.json();
  const first = await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '绑定任务' });
  const second = await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '未绑定任务' });
  const { task: taskA } = await first.json();
  const { task: taskB } = await second.json();
  const summariesRoute = `/api/projects/${project.id}/external-dispatch/summaries`;
  const before = await (await host.request(summariesRoute, 'GET')).json();
  assert.deepEqual(before, { projectId: project.id, tasks: [{ taskId: taskA.id, works: [] }, { taskId: taskB.id, works: [] }] });
  const route = `/api/projects/${project.id}/tasks/${taskA.id}/external-dispatch`;
  const grant = await makeGrantBody();
  await host.request(`${route}/authorize`, 'POST', grant);
  const after = await (await host.request(summariesRoute, 'GET')).json();
  assert.equal(after.tasks.find((entry: { taskId: string }) => entry.taskId === taskA.id).works.length, 1);
  assert.deepEqual(after.tasks.find((entry: { taskId: string }) => entry.taskId === taskB.id).works, [], 'another task in the shared project is never polluted');
  const repeat = await (await host.request(summariesRoute, 'GET')).json();
  assert.deepEqual(repeat, after, 'read-only summaries do not create or change records');
  const missing = await host.request(`/api/projects/99999999-9999-4999-8999-999999999999/external-dispatch/summaries`, 'GET');
  assert.equal(missing.status, 404);
});

test('S6b routes: settings view keeps real core facts and the unverified optional gate', { timeout: 90_000 }, async t => {
  const host = await routeHost(t);
  const view = await (await host.request('/api/external-dispatch/settings', 'GET')).json();
  assert.equal(view.core.github.status, 'disconnected');
  assert.equal(view.core.protectedMcp.available, false);
  assert.equal(view.core.executorClosedLoop.verified, false);
  assert.equal(view.optional.ready, false);
  assert.equal(view.optional.quota.limit, 3);
  assert.deepEqual(view.optional.verification, { apiOnline: 'unverified', connector: 'unverified', joint: 'unverified' });
});

async function routeHost(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-delivery-ui-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(async () => { await host.close().catch(() => {}); });
  const configured = await host.request('/api/configuration', 'PUT', { name: '外派UI', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1', model: 'synthetic-delivery-ui', apiKey: 'synthetic-delivery-ui-only' });
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
  const grant = await makeGrantBody();
  return { project, task, taskId: task.id, projectId: project.id, route, grant };
}

async function makeGrantBody() {
  return {
    goal: '核对四店会员口径',
    scope: '整理字段映射与重复记录，不改生产、不联系会员',
    forbidden: '',
    allowedExecutors: ['generic-agent'],
    repository: { stableId: 'example-org/private-work', visibility: 'private' as const },
    assetRefs: [],
    inputs: [],
    enterprise: 'ent-1',
    validUntil: iso(HOUR),
    summary: '核查四店会员字段映射与重复记录',
    deliveryCriteria: '覆盖字段映射并列出未核事项；不代外部宣称完成',
  };
}

/** Seeds valid ledger records next to the real host (same strict schema the store parses). */
async function seedLedger(host: RouteHost, seed: {
  projectId: string; taskId: string; workId: string; grantId: string;
  grantAssetRefs?: unknown[];
  publication?: { action: 'issue-create' | 'issue-comment'; status: 'prepared' | 'submitted' | 'succeeded' | 'rejected' | 'unknown'; issueId?: string };
  claim?: { principal: string; epoch: number; active: boolean };
  deliveries?: Array<Record<string, unknown>>;
  reviews?: Array<Record<string, unknown>>;
}) {
  const ledgerPath = path.join(host.dataRoot, 'external-work', 'ledger.json');
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const work = ledger.works.find((item: { workId: string }) => item.workId === seed.workId);
  assert.ok(work, 'the seeded work must exist');
  if (seed.grantAssetRefs) {
    const grantRecord = ledger.grants.find((item: { grantId: string }) => item.grantId === seed.grantId);
    assert.ok(grantRecord);
    grantRecord.assetRefs = seed.grantAssetRefs;
  }
  if (seed.publication) {
    ledger.publications.push({
      operationId: `op-${seed.workId.slice(0, 8)}`, workId: seed.workId, revision: 1, action: seed.publication.action,
      bodyHash: hash('outbound-body'), repositoryId: 'example-org/private-work', ...(seed.publication.issueId ? { issueId: seed.publication.issueId } : {}),
      status: seed.publication.status, createdAt: iso(-3 * HOUR), updatedAt: iso(-3 * HOUR),
    });
  }
  let claimId: string | undefined;
  if (seed.claim) {
    claimId = `claim-${seed.workId.slice(0, 8)}`;
    ledger.claims.push({
      claimId, workId: seed.workId, revision: 1, principal: seed.claim.principal, epoch: seed.claim.epoch,
      leaseDeadline: iso(HOUR), status: seed.claim.active ? 'active' : 'released', ...(seed.claim.active ? {} : { reason: 'released' }),
      createdAt: iso(-2 * HOUR), updatedAt: iso(-2 * HOUR),
    });
  }
  for (const delivery of seed.deliveries ?? []) {
    assert.ok(claimId, 'a seeded delivery needs a claim to satisfy ledger referential integrity');
    ledger.deliveries.push({ workId: seed.workId, revision: 1, claimId, late: false, storage: [], links: [], assetsUsed: [], ...delivery });
  }
  for (const review of seed.reviews ?? []) {
    ledger.reviews.push({ workId: seed.workId, ...review });
  }
  await writeFile(ledgerPath, JSON.stringify(ledger));
}

// ---------------------------------------------------------------------------
// Part B: browser client contract (read-only GET shapes, owner checks).
// ---------------------------------------------------------------------------

test('S6b client: delivery/asset/summary reads are GET with exact owner paths and owner checks', async t => {
  const client = await import('../src/host/ui/external-dispatch-client.ts');
  const calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: any) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    const target = String(url);
    if (target.endsWith('/deliveries')) return Response.json({ projectId: 'project-a', taskId: 'task-a', works: [{ workId: 'w1' }] });
    if (target.endsWith('/assets')) return Response.json({ projectId: 'project-a', taskId: 'task-a', works: [] });
    if (target.endsWith('/summaries')) return Response.json({ projectId: 'project-a', tasks: [] });
    return Response.json({});
  });
  const deliveries = await client.readTaskExternalDeliveries('project-a', 'task-a');
  assert.equal(deliveries.works[0].workId, 'w1');
  await client.readTaskExternalAssets('project-a', 'task-a');
  await client.readProjectExternalSummaries('project-a');
  assert.deepEqual(calls, [
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/deliveries', method: 'GET' },
    { url: '/api/projects/project-a/tasks/task-a/external-dispatch/assets', method: 'GET' },
    { url: '/api/projects/project-a/external-dispatch/summaries', method: 'GET' },
  ]);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ projectId: 'project-b', taskId: 'task-a', works: [] }));
  await assert.rejects(client.readTaskExternalDeliveries('project-a', 'task-a'), /归属/);
  await assert.rejects(client.readTaskExternalAssets('project-a', 'task-a'), /归属/);
});

// ---------------------------------------------------------------------------
// Part C: components (frozen-demo mapping, production tokens, real data props).
// ---------------------------------------------------------------------------

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
// Function-typed child components are invoked once (they stay hook-free) so text/queries see their rendered output.
const nodes = (node: any): Element[] => {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node.type === 'function') return nodes(node.type(node.props ?? {}));
  return [node, ...nodes(node.props?.children)];
};
const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : typeof node.type === 'function' ? text(node.type(node.props ?? {})) : text(node.props?.children);
const findAll = (tree: Element[], predicate: (node: Element) => boolean): Element[] => nodes(tree).filter(predicate);
const click = (tree: Element[], predicate: (node: Element) => boolean) => {
  const target = findAll(tree, predicate).at(-1);
  assert.ok(target, 'expected a clickable node');
  target.props.onClick?.({ preventScroll: true, currentTarget: {} });
};

let bundle: string | undefined;
async function harness(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  const built = await build({
    stdin: { contents: `export {TaskWorkModeCard} from './src/host/ui/TaskWorkModeCard.tsx';export {ExternalWorkPanel, externalWorkStatusView} from './src/host/ui/ExternalWorkPanel.tsx';export {ExternalDeliveryPanel} from './src/host/ui/ExternalDeliveryPanel.tsx';export {ExternalAssetAccessPanel} from './src/host/ui/ExternalAssetAccessPanel.tsx';export {ExternalDispatchSettings} from './src/host/ui/ExternalDispatchSettings.tsx';export {DailyCaseProjects} from './src/host/ui/DailyCaseProjects.tsx';`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, globalName: 'DispatchUiTest',
    plugins: [{ name: 'delivery-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'delivery-hooks' }));
      plugin.onLoad({ filter: /.*/, namespace: 'delivery-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' : 'export const useState=v=>globalThis.__deliveryHooks.state(v);export const useRef=v=>globalThis.__deliveryHooks.ref(v);export const useEffect=(f,d)=>globalThis.__deliveryHooks.effect(f,d);export const useId=()=>`delivery-${globalThis.__deliveryHooks.cursor()}`;export const useMemo=(f,d)=>f();export const useCallback=f=>f;export const useViewport=(...a)=>({isNarrow:false,viewportWidth:1440});' }));
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
    const render = () => { cursor = 0; sandbox.__deliveryHooks = hooks; tree = Component(props); while (effects.length) effects.shift()!(); };
    const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
    render();
    return { render, settle, nodes: () => nodes(tree), tree: () => tree, text: () => text(tree), press: (eventKey: string) => { for (const handler of listeners['keydown'] ?? []) handler({ key: eventKey }); }, close: () => { for (const fn of cleanup) fn?.(); } };
  }
  return { ...sandbox.DispatchUiTest, mount };
}

// -- shared component fixtures -------------------------------------------------

const memberRef = { authority: 'studio-source', id: 'member-definition', version: 'v2.1', hash: hash('member') };
const metricRef = { authority: 'sap-metric', id: 'repeat-rate', version: 'v3.0', hash: hash('metric') };
const grantView = {
  grantId: 'grant-1', grantVersion: 1, goal: '核对四店会员口径', scope: '整理字段映射与重复记录，不改生产、不联系会员', enterprise: 'ent-1',
  allowedExecutors: ['generic-agent'], repository: { stableId: 'example-org/private-work', visibility: 'private' as const },
  validFrom: iso(-HOUR), validUntil: iso(HOUR), assetRefs: [memberRef],
};
const deliveryNew = {
  deliveryId: 'delivery-new', workId: 'work-1', revision: 1, claimId: 'claim-1', idempotencyKey: 'idem-new',
  manifestHash: hash('manifest-new'), preservation: 'preserved' as const,
  storage: [
    { logicalPath: '差异明细.csv', relativePath: 'd/x/差异明细.csv', sha256: hash('diff-bytes'), bytes: 2048 },
    { logicalPath: '验证说明.md', relativePath: 'd/x/验证说明.md', sha256: hash('notes-bytes'), bytes: 512 },
  ],
  links: [{ logicalPath: '外部清单.pdf', url: 'https://external.example.invalid/list.pdf' }],
  assetsUsed: [memberRef],
  facts: { done: ['4 店映射差异已列出', '重复记录 26 条已按口径核对'], notDone: ['业务系统写入未执行'], failed: [], unknown: ['1 组身份对应无法确定'] },
  late: false, createdAt: iso(-HOUR),
};
const deliveryOld = {
  deliveryId: 'delivery-old', workId: 'work-1', revision: 1, claimId: 'claim-1', idempotencyKey: 'idem-old',
  manifestHash: hash('manifest-old'), preservation: 'failed' as const, preservationReason: 'missing_pieces',
  storage: [], links: [], assetsUsed: [],
  facts: { done: [], notDone: ['差异位置未提供'], failed: ['摘要缺失'], unknown: [] },
  late: false, createdAt: iso(-2 * HOUR),
};
const seededDeliveryWork = {
  workId: 'work-1', revision: 1, status: 'authorized' as const, summary: '核查四店会员字段映射与重复记录',
  deliveryCriteria: '覆盖字段映射并列出未核事项', createdAt: iso(-3 * HOUR),
  publications: [{ operationId: 'op-1', action: 'issue-create' as const, status: 'succeeded' as const, issueId: '42' }],
  claim: { claimId: 'claim-1', principal: 'executor-a', epoch: 1, leaseDeadline: iso(HOUR), status: 'active' },
  grant: grantView,
  deliveries: [deliveryNew, deliveryOld],
  reviews: [
    { reviewId: 'review-old', workId: 'work-1', deliveryId: 'delivery-old', decision: 'needs-supplement' as const, reason: '缺少差异行号与映射出处', deliveryHash: hash('manifest-old'), createdAt: iso(-90 * 60_000) },
    { reviewId: 'review-new', workId: 'work-1', deliveryId: 'delivery-new', decision: 'accepted' as const, reason: '差异位置与映射出处已补齐，接受这一片段', deliveryHash: hash('manifest-new'), createdAt: iso(-30 * 60_000) },
  ],
};

const unverifiedSettings = {
  core: {
    github: { status: 'disconnected', verified: false },
    protectedMcp: { available: false, reason: 'protected_mcp_endpoint_not_mounted' },
    executorClosedLoop: { verified: false, reason: 'executor_closed_loop_not_exercised' },
  },
  optional: { optional: true as const, defaultState: 'integration_unverified' as const, connection: 'workbuddy-local', ready: false, verification: { apiOnline: 'unverified' as const, connector: 'unverified' as const, joint: 'unverified' as const }, quota: { limit: 3 } },
};

const panelSwitch = (counts: Record<string, number>) => (panel: string) => { counts[panel] = (counts[panel] ?? 0) + 1; };

test('S6b delivery panel: verification table, manifest preservation facts, references and the agent conclusion render from ledger facts', async t => {
  const h = await harness(async (url: string) => String(url).endsWith('/deliveries')
    ? Response.json({ projectId: 'project-a', taskId: 'task-a', works: [seededDeliveryWork] })
    : Response.json({}));
  const counts: Record<string, number> = {};
  const ui = h.mount(h.ExternalDeliveryPanel, { projectId: 'project-a', taskId: 'task-a', taskName: '四店会员资料一致性核查', onSwitchPanel: panelSwitch(counts) });
  try {
    await ui.settle();
    assert.match(ui.text(), /外部交付，核验后接回原任务/);
    assert.match(ui.text(), /检查项/);
    assert.match(ui.text(), /外部交付声明/);
    assert.match(ui.text(), /原任务核验状态/);
    // facts-driven verification rows
    assert.match(ui.text(), /4 店映射差异已列出/);
    assert.match(ui.text(), /已验证/, 'accepted review verifies the done facts');
    assert.match(ui.text(), /业务系统写入未执行/);
    assert.match(ui.text(), /未验证/, 'not-done facts stay unverified');
    assert.match(ui.text(), /1 组身份对应无法确定/);
    assert.match(ui.text(), /UNKNOWN/, 'unknown facts stay unknown, never promoted');
    // manifest: preserved bytes, hash, link-only and failed old delivery
    assert.match(ui.text(), /附件 manifest/);
    assert.match(ui.text(), /差异明细\.csv/);
    assert.match(ui.text(), /2048 B/);
    assert.match(ui.text(), /仅链接 · 未保全/);
    assert.match(ui.text(), /外部清单\.pdf/);
    assert.match(ui.text(), /missing_pieces/, 'the failed old delivery keeps its audit reason');
    assert.match(ui.text(), /字节保全/, 'the overall preservation statement is present');
    // right column actual references
    assert.match(ui.text(), /交付声明的实际引用/);
    assert.match(ui.text(), /member-definition/);
    assert.match(ui.text(), /v2\.1/);
    // agent conclusion card
    assert.match(ui.text(), /Agent 的验收结论/);
    assert.match(ui.text(), /原任务判断/);
    assert.match(ui.text(), /差异位置与映射出处已补齐，接受这一片段/);
    // old delivery retention (dashed box)
    assert.match(ui.text(), /旧交付/);
    assert.match(ui.text(), /缺少差异行号与映射出处/);
    click(ui.tree(), node => node.type === 'button' && text(node).includes('查看资产取用'));
    click(ui.tree(), node => node.type === 'button' && text(node).includes('继续原任务'));
    assert.deepEqual(counts, { assets: 1, chat: 1 });
  } finally { ui.close(); }
});

test('S6b delivery panel: late delivery shows the quarantine callout and no-work task shows the honest empty state', async t => {
  let payload: unknown = { projectId: 'project-a', taskId: 'task-a', works: [{ ...seededDeliveryWork, deliveries: [{ ...deliveryNew, late: true }], reviews: [] }] };
  const h = await harness(async (url: string) => String(url).endsWith('/deliveries') ? Response.json(payload) : Response.json({}));
  const counts: Record<string, number> = {};
  const ui = h.mount(h.ExternalDeliveryPanel, { projectId: 'project-a', taskId: 'task-a', taskName: '任务', onSwitchPanel: panelSwitch(counts) });
  try {
    await ui.settle();
    assert.match(ui.text(), /迟到交付已隔离保存/);
    assert.match(ui.text(), /不接受、不复活原工作/);
  } finally { ui.close(); }
  payload = { projectId: 'project-a', taskId: 'task-a', works: [] };
  const empty = h.mount(h.ExternalDeliveryPanel, { projectId: 'project-a', taskId: 'task-a', taskName: '任务', onSwitchPanel: panelSwitch(counts) });
  try {
    await empty.settle();
    assert.match(empty.text(), /尚未取得可验收的交付|尚未授权外派/);
    click(empty.tree(), node => node.type === 'button' && text(node).includes('返回外部协作'));
    assert.equal(counts.external, 1);
  } finally { empty.close(); }
});

test('S6b assets panel: exact allowlist, version detail with hash, references and entry availability render honestly', async t => {
  const work = {
    workId: 'work-1', revision: 1, status: 'authorized' as const, summary: '核查四店会员字段映射与重复记录',
    grant: { ...grantView, assetRefs: [memberRef, metricRef] },
    references: [{ deliveryId: 'delivery-new', revision: 1, createdAt: iso(-HOUR), preservation: 'preserved', assetsUsed: [memberRef] }],
  };
  const h = await harness(async (url: string) => String(url).endsWith('/assets')
    ? Response.json({ projectId: 'project-a', taskId: 'task-a', works: [work] })
    : String(url).endsWith('/settings') ? Response.json(unverifiedSettings) : Response.json({}));
  const counts: Record<string, number> = {};
  const ui = h.mount(h.ExternalAssetAccessPanel, { projectId: 'project-a', taskId: 'task-a', taskName: '四店会员资料一致性核查', onSwitchPanel: panelSwitch(counts), onOpenSettings: () => { counts.settings = (counts.settings ?? 0) + 1; } });
  try {
    await ui.settle();
    assert.match(ui.text(), /外部读取的是获准依据/);
    assert.match(ui.text(), /获准资产/);
    assert.match(ui.text(), /member-definition/);
    assert.match(ui.text(), /v2\.1/);
    assert.match(ui.text(), /studio-source/, 'the authority source is shown');
    assert.match(ui.text(), /repeat-rate/, 'both allowlisted assets are offered');
    // version detail locked to the exact hash
    assert.match(ui.text(), /v3\.0|repeat-rate/);
    assert.match(ui.text(), new RegExp(memberRef.hash.slice(0, 12)));
    assert.match(ui.text(), /不静默|latest/, 'the no-latest-fallback statement is present');
    // references
    assert.match(ui.text(), /交付声明引用|实际引用/);
    assert.match(ui.text(), /不证专业正确|不证采用|只证交付内容与范围/, 'the receipt scope disclaimer is present');
    // entry availability card with real settings facts
    assert.match(ui.text(), /入口与可用性/);
    assert.match(ui.text(), /protected_mcp_endpoint_not_mounted|未挂载/, 'the unmounted protected entry is honest');
    assert.match(ui.text(), /失败|保留/, 'failure-retention note present');
    click(ui.tree(), node => node.type === 'button' && text(node).includes('查看交付与验收'));
    assert.deepEqual(counts, { delivery: 1 });
  } finally { ui.close(); }
});

test('S6b assets panel: without reads or grants the panel stays honest and never invents usage', async t => {
  const h = await harness(async (url: string) => String(url).endsWith('/assets')
    ? Response.json({ projectId: 'project-a', taskId: 'task-a', works: [] })
    : String(url).endsWith('/settings') ? Response.json(unverifiedSettings) : Response.json({}));
  const ui = h.mount(h.ExternalAssetAccessPanel, { projectId: 'project-a', taskId: 'task-a', taskName: '任务', onSwitchPanel: () => {} });
  try {
    await ui.settle();
    assert.match(ui.text(), /尚无外部读取回执|资产被列出不等于已经读取或采用/, 'the empty receipt note is exact');
    assert.match(ui.text(), /本次未授权外部读取任何资产|尚未授权/, 'no allowlist is invented');
  } finally { ui.close(); }
});

test('S6b settings partition: core four rows, optional three rows unverified-disabled, no simulation buttons', async t => {
  const h = await harness(async (url: string) => String(url).endsWith('/settings') ? Response.json(unverifiedSettings) : Response.json({}));
  const ui = h.mount(h.ExternalDispatchSettings, {});
  try {
    await ui.settle();
    assert.match(ui.text(), /外派与执行方式/);
    assert.match(ui.text(), /基础路径/);
    assert.match(ui.text(), /GitHub/);
    assert.match(ui.text(), /资产与工作 MCP|资产与工作MCP/);
    assert.match(ui.text(), /资源/);
    assert.match(ui.text(), /1 work \/ 24|通用联合测试|联合测试/);
    assert.match(ui.text(), /未配置/);
    assert.match(ui.text(), /不阻断内部任务/, 'the core not configured never blocks internal work');
    assert.match(ui.text(), /可选适配/);
    assert.match(ui.text(), /WorkBuddy/);
    assert.match(ui.text(), /API\/在线/);
    assert.match(ui.text(), /Connector/);
    assert.match(ui.text(), /未验证/);
    assert.match(ui.text(), /禁用/, 'the optional adapter stays disabled while unverified');
    assert.match(ui.text(), /3 次|3次/, 'the trigger quota snapshot is shown');
    assert.ok(!/模拟/.test(ui.text()), 'prototype simulation controls are never ported');
    assert.ok(!/已启用/.test(ui.text()), 'the unverified adapter never claims enabled');
  } finally { ui.close(); }
});

test('S6b settings partition: a verified GitHub core surfaces green while the optional gate stays honest', async t => {
  const verified = {
    core: {
      github: { status: 'verified', verified: true, accountLabel: 'gadfly-hbo' },
      protectedMcp: { available: false, reason: 'protected_mcp_endpoint_not_mounted' },
      executorClosedLoop: { verified: false, reason: 'executor_closed_loop_not_exercised' },
    },
    optional: unverifiedSettings.optional,
  };
  const h = await harness(async (url: string) => String(url).endsWith('/settings') ? Response.json(verified) : Response.json({}));
  const ui = h.mount(h.ExternalDispatchSettings, {});
  try {
    await ui.settle();
    assert.match(ui.text(), /gadfly-hbo/);
    assert.match(ui.text(), /已核验/, 'the verified GitHub row is labeled from the real connection');
    const pills = findAll(ui.tree(), node => node.props?.['data-tone']).map(node => node.props['data-tone']);
    assert.ok(pills.includes('green'), 'a verified row uses the green tone');
    assert.match(ui.text(), /未验证/, 'the remaining core rows stay honest');
  } finally { ui.close(); }
});

// -- Case row summary ----------------------------------------------------------

const caseRecord = { id: 'case-1', title: '会员资料治理', description: '', judgement: '', nextStep: '', status: 'analyzing', closeReason: null, closedAt: null, revision: 1, createdAt: iso(-DAY), updatedAt: iso(-HOUR) };
const configFixture = { id: 'config-1', revision: 1 };
const caseTaskA = { id: 'task-a', name: '四店会员资料一致性核查', draft: '', configuration: configFixture, createdAt: iso(-DAY), updatedAt: iso(-HOUR), sessionStorage: 'task' as const, assignment: { type: 'analysis' as const, skill: null, issue: { caseId: 'case-1', issueId: 'issue-9' } } };
const caseTaskB = { id: 'task-b', name: '其他 Case 的任务', draft: '', configuration: configFixture, createdAt: iso(-DAY), updatedAt: iso(-HOUR), sessionStorage: 'task' as const, assignment: { type: 'plan' as const, skill: null, issue: { caseId: 'case-2', issueId: 'issue-9' } } };
const caseProject = { schemaVersion: 2 as const, id: 'project-a', name: '四店会员资料核查', configuration: configFixture, rootPath: '/tmp/x', createdAt: iso(-DAY), updatedAt: iso(-HOUR), archivedAt: null, tasks: [caseTaskA, caseTaskB] };
const caseIssues = [{ id: 'issue-9', title: '资料一致性核查' }];

test('S6b case rows: the dispatch summary inset appears only on the truly bound task row', async t => {
  const summaries = { projectId: 'project-a', tasks: [
    { taskId: 'task-a', works: [authorizedSummaryWork()] },
    { taskId: 'task-b', works: [authorizedSummaryWork()] },
  ] };
  const h = await harness(async (url: string) => String(url).endsWith('/summaries')
    ? Response.json(summaries)
    : Response.json({}));
  const ui = h.mount(h.DailyCaseProjects, {
    record: caseRecord, issues: caseIssues, scope: { mode: 'all', issueId: '', manual: false }, scopeControl: null,
    linkedProjects: [{ link: { caseId: 'case-1', projectId: 'project-a', linkedAt: iso(-DAY) }, project: caseProject }],
    projectLinks: [{ caseId: 'case-1', projectId: 'project-a', linkedAt: iso(-DAY) }],
    onLinkProject: () => {}, onEditWork: () => {}, onUnlinkProject: () => {}, onOpenTask: () => {}, onContinueTask: () => {}, onCreateTask: () => {},
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /本 Task 外部协作/);
    assert.match(ui.text(), /执行中/, 'the summary label comes from the real ledger status view');
    assert.match(ui.text(), /独立外派工作台账|独立台账/);
    assert.match(ui.text(), /不改变人的待回应|不改轮次|轮次/);
    const insets = findAll(ui.tree(), node => typeof node.props?.className === 'string' && node.props.className.includes('external-summary'));
    assert.equal(insets.length, 1, 'exactly one inset for the bound row');
    assert.ok(!ui.text().includes('其他 Case 的任务'), 'the shared project other-Case task never enters this table');
  } finally { ui.close(); }
});

test('S6b case rows: without external works no inset renders and reads never break the table', async t => {
  const h = await harness(async (url: string) => String(url).endsWith('/summaries')
    ? Response.json({ projectId: 'project-a', tasks: [{ taskId: 'task-a', works: [] }, { taskId: 'task-b', works: [] }] })
    : Response.json({}));
  const ui = h.mount(h.DailyCaseProjects, {
    record: caseRecord, issues: caseIssues, scope: { mode: 'all', issueId: '', manual: false }, scopeControl: null,
    linkedProjects: [{ link: { caseId: 'case-1', projectId: 'project-a', linkedAt: iso(-DAY) }, project: caseProject }],
    projectLinks: [], onLinkProject: () => {}, onEditWork: () => {}, onUnlinkProject: () => {}, onOpenTask: () => {}, onContinueTask: () => {}, onCreateTask: () => {},
  });
  try {
    await ui.settle();
    assert.match(ui.text(), /四店会员资料一致性核查/, 'the task table still renders');
    const insets = findAll(ui.tree(), node => typeof node.props?.className === 'string' && node.props.className.includes('external-summary'));
    assert.equal(insets.length, 0, 'no inset without a real external work');
  } finally { ui.close(); }
});

function authorizedSummaryWork(): ExternalTaskSummary['works'][number] {
  return {
    workId: 'work-1', revision: 1, status: 'authorized', summary: '核查四店会员字段映射与重复记录', grantId: 'grant-1', grantVersion: 1, createdAt: iso(-HOUR),
    publications: [{ operationId: 'op-1', action: 'issue-create', status: 'succeeded', issueId: '42' }],
    claim: { claimId: 'claim-1', principal: 'executor-a', epoch: 1, leaseDeadline: iso(HOUR), status: 'active' },
    deliveryCount: 0, reviewCount: 0, latestReview: null,
  };
}

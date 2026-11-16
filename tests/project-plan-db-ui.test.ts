import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { DbLinkPlanningSource } from '../src/host/db-link-planning.ts';

const taskId = '00000000-0000-4000-8000-000000000002';
const source: DbLinkPlanningSource = { id: 'db-link:00000000-0000-4000-8000-000000000003', title: '已授权交易来源', engine: 'postgresql', version: '1', sha256: 'a'.repeat(64), permissionRef: 'db-grant:original:' + 'b'.repeat(64), state: 'available', enabled: true, scope: { objects: ['public.orders', 'public.members'] }, queryQualified: true, limitations: ['未读取本轮数据'], modelExport: { structure: true, comments: false, queryText: true, results: true } };
const taskSource: DbLinkPlanningSource = { ...source, taskId, scope: { objects: ['public.orders'] }, permissionRef: 'db-grant:original:' + 'c'.repeat(64) };
const reference = (value: DbLinkPlanningSource) => ({ kind: 'connector', id: value.id, version: value.version, sha256: value.sha256, permissionRef: value.permissionRef });
const plan = { request: '核对已授权来源', premises: [], materials: [], coverage: [], tasks: [{ key: 'existing', name: '原分析任务', taskId, selected: true, scope: '', capabilities: [reference(taskSource)] }], taskMode: 'single', summaryTaskKey: 'existing', dependencies: [], caseContext: null };
const project = { schemaVersion: 2, id: '00000000-0000-4000-8000-000000000001', name: '合成来源确认项目', rootPath: '/synthetic/project', archivedAt: null, configuration: { id: 'synthetic', revision: 1 }, tasks: [{ id: taskId, name: '原分析任务', archivedAt: null, configuration: { id: 'synthetic', revision: 1 } }] };
let page: Promise<unknown> | undefined;
async function rendered(sources: DbLinkPlanningSource[], chosenPlan = plan) {
  const [React, ReactDom] = await Promise.all([import('react'), import('react-dom/server')]);
  page ??= (async () => {
    const [vite, plugin] = await Promise.all([import('vite'), import('@vitejs/plugin-react')]);
    const server = await vite.createServer({ configFile: false, plugins: [plugin.default()], cacheDir: path.resolve('.local/overall-architecture-product-gaps/pm05/ui-ssr-cache'), logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
    after(() => server.close());
    return (await server.ssrLoadModule('/src/host/ui/ProjectPlanPage.tsx')).ProjectPlanPage;
  })();
  const catalog = { skills: [], methods: [], connectors: sources.map(value => ({ ...reference(value), title: value.title, enabled: value.enabled, requiresPermission: true, ...(value.taskId ? { taskId: value.taskId } : {}) })), databaseSources: sources, materials: [], caseContexts: [] };
  const props = { project, initialState: { formatVersion: 1, projectId: project.id, revision: 1, draft: { version: 1, createdAt: '2026-11-16T00:00:00.000Z', plan: chosenPlan }, history: [] }, initialCapabilities: catalog, onBack() {}, onConfirmed() {}, onOpenTask() {}, onManageCapabilities() {} };
  return ReactDom.renderToStaticMarkup(React.createElement(await page as React.ComponentType<never>, props as never));
}

test('PG05 UI: the existing Task selects its exact narrowed database reference and shows only its effective scope', async () => {
  const html = await rendered([source, taskSource]);
  assert.match(html, /已授权交易来源/);
  assert.match(html, /范围：public.orders/);
  assert.doesNotMatch(html, /public.members/);
  assert.doesNotMatch(html, /原已选引用：db-link:/, 'the precise Task ref is recognized without substituting the project ref');
  assert.match(html, /仅确认并创建/); assert.match(html, /确认并开始/);
});

test('PG05 UI: Task exclusion and configuration changes stay visible and cannot be selected as available', async () => {
  for (const [state, label] of [['excluded', '本任务已排除此来源'], ['configuration-changed', '配置已变化'], ['revoked', '本项目已撤权']] as const) {
    const unavailable = { ...taskSource, state, enabled: false, scope: undefined };
    const unselected = { ...plan, tasks: [{ ...plan.tasks[0]!, capabilities: [] }] };
    const html = await rendered([source, unavailable], unselected);
    assert.match(html, new RegExp(label));
    assert.match(html, /input[^>]*type="checkbox"[^>]*disabled=""[^>]*\/><span>已授权交易来源/);
    assert.doesNotMatch(html, /public.members/);
  }
});

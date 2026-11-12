import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../', import.meta.url);
async function buildComponent(file: string, exported: string) {
  const directory = new URL('.local/studio-phase2-implementation/ui/ssr/', root).pathname;
  await mkdir(directory, { recursive: true });
  const output = `${directory}${exported}.mjs`;
  await build({ input: new URL(file, root).pathname, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: output }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'css-boundary', resolveId(id) { if (id.endsWith('.css')) return `\0css:${id}.js`; }, load(id) { if (id.startsWith('\0css:')) return ''; } }] });
}
const materials = buildComponent('src/host/ui/EnterpriseMaterialsPage.tsx', 'EnterpriseMaterialsPage').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/EnterpriseMaterialsPage.mjs')).EnterpriseMaterialsPage);
const metrics = buildComponent('extensions/business-plugins/metric-factory/ui/MetricFactoryPage.tsx', 'MetricFactoryPage').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/MetricFactoryPage.mjs')).MetricFactoryPage);
const methods = buildComponent('src/host/ui/SapMethodsPage.tsx', 'SapMethodsPage').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/SapMethodsPage.mjs')).SapMethodsPage);
const studio = buildComponent('src/host/ui/StudioPage.tsx', 'StudioPage').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/StudioPage.mjs')).StudioPage);
const publicationSummary = buildComponent('src/host/ui/StudioPage.tsx', 'StudioPublicationSummary').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/StudioPublicationSummary.mjs')).StudioPublicationSummary);
const projectAssociation = buildComponent('src/host/ui/StudioPage.tsx', 'StudioProjectAssociation').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/StudioProjectAssociation.mjs')).StudioProjectAssociation);
const contextReceipt = buildComponent('src/host/ui/EnterpriseMaterialPicker.tsx', 'EnterpriseContextReceipt').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/EnterpriseContextReceipt.mjs')).EnterpriseContextReceipt);
const foundationLabel = buildComponent('src/host/ui/StudioPage.tsx', 'StudioFoundationStatus').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/StudioFoundationStatus.mjs')).foundationStatus);
const unassignedRow = buildComponent('src/host/ui/StudioPage.tsx', 'StudioUnassignedAssetRow').then(async () => (await import('../.local/studio-phase2-implementation/ui/ssr/StudioUnassignedAssetRow.mjs')).StudioUnassignedAssetRow);

test('unassigned assets offer accurate read-only inspection before a separate enterprise association decision', async () => {
  const Row = await unassignedRow;
  const html = renderToStaticMarkup(createElement(Row, { item: { authority: 'enterprise', id: 'native-one', version: 'original-uuid', title: '旧企业来源', status: 'unassigned' }, onInspect() {}, onAssociate() {} }));
  assert.match(html, /查看准确原文/);
  assert.match(html, /归属待核/);
  assert.match(html, /暂无可核对的关联建议证据/);
  assert.match(html, /original-uuid/);
});

test('professional read-only inspection exposes no creation, review publication or modeling controls', async () => {
  const Materials = await materials, Metrics = await metrics, Methods = await methods;
  const materialHtml = renderToStaticMarkup(createElement(Materials, { embedded: true, readOnly: true, allowedIds: ['native-one'], initialMaterialId: 'native-one', initialRevisionId: 'original-uuid', onBack() {}, onMetrics() {}, onRequirements() {} }));
  const metricHtml = renderToStaticMarkup(createElement(Metrics, { embedded: true, readOnly: true, allowedIds: ['native-two'], projects: [], onBack() {}, onOpenTask() {}, onProjectsChanged() {} }));
  const methodHtml = renderToStaticMarkup(createElement(Methods, { embedded: true, readOnly: true, allowedIds: ['native-three'] }));
  assert.doesNotMatch(materialHtml, /新建资料|保存工作稿|启用此修订|停用资料/);
  assert.doesNotMatch(metricHtml, /审核发布|导入草稿|发起建模任务|项目启用/);
  assert.doesNotMatch(methodHtml, /新建方法|保存并发布|发布此版本|派生新方法/);
});

test('foundation qualification uses business labels and keeps unknown implementation codes out of the table', async () => {
  const label = await foundationLabel;
  assert.equal(label('formal-current'), '正式可用');
  assert.equal(label('unrecognized-future-code'), '资格待核');
});

test('an unassigned writable analysis project can join the explicitly selected enterprise without a construction task', async () => {
  const Association = await projectAssociation;
  const html = renderToStaticMarkup(createElement(Association, { project: { id: 'p1', name: '门店分析', archivedAt: null }, directory: { enterprises: [{ id: 'ea', name: 'A企业', revision: 1, createdAt: '2026-11-12' }, { id: 'eb', name: 'B企业', revision: 1, createdAt: '2026-11-12' }], projectAssignments: [], caseAssignments: [], assetAssignments: [] }, enterpriseId: 'ea', onAssociate() {} }));
  assert.match(html, /门店分析/);
  assert.match(html, /A企业/);
  assert.match(html, /<button[^>]*>关联当前项目到此企业<\/button>/);
  assert.doesNotMatch(html, /创建建设任务|建设目标/);
});

test('project association stays unavailable for assigned, archived, unresolved or missing projects', async () => {
  const Association = await projectAssociation;
  const defaults = { project: { id: 'p1', name: '门店分析', archivedAt: null }, directory: { enterprises: [{ id: 'ea', name: 'A企业', revision: 1, createdAt: '2026-11-12' }], projectAssignments: [], caseAssignments: [], assetAssignments: [] }, enterpriseId: 'ea', onAssociate() {} };
  for (const override of [
    { directory: { ...defaults.directory, projectAssignments: [{ projectId: 'p1', enterpriseId: 'eb' }] } },
    { directory: { ...defaults.directory, projectAssignments: [{ projectId: 'p1', enterpriseId: 'ea' }] } },
    { project: { ...defaults.project, archivedAt: '2026-11-12' } },
    { enterpriseId: '' }, { directory: undefined }, { project: undefined },
  ]) assert.doesNotMatch(renderToStaticMarkup(createElement(Association, { ...defaults, ...override })), /关联当前项目到此企业/);
  assert.match(renderToStaticMarkup(createElement(Association, { ...defaults, disabled: true })), /<button[^>]*disabled=""/);
});

test('scoped current and historical directory receipts describe discovery and keep their summary collapsed', async () => {
  const Receipt = await contextReceipt;
  const value = { directory: { enterpriseId: 'ea', summary: 'A企业已核范围 · 仅含本企业资产', providedAt: '2026-11-12T00:00:00Z', claim: 'discovery_only' }, materials: [] };
  for (const label of ['最近请求', '所选历史请求']) {
    const html = renderToStaticMarkup(createElement(Receipt, { value, recordedRun: true, requestId: 'req1', label }));
    assert.match(html, /本轮企业目录范围已提供（仅可发现，未证明已读）/);
    assert.match(html, /<details><summary>当时提供的企业目录摘要<\/summary><pre>A企业已核范围/);
    assert.doesNotMatch(html, /本轮目录位置已提供|<details[^>]*open/);
  }
});

test('legacy directory locations and genuinely missing historical context retain their original evidence', async () => {
  const Receipt = await contextReceipt;
  const html = renderToStaticMarkup(createElement(Receipt, { value: { directory: { indexPath: '/legacy/index.jsonl', providedAt: '2026-01-01' }, materials: [] }, recordedRun: true }));
  assert.match(html, /本轮目录位置已提供/);
  assert.match(html, /\/legacy\/index.jsonl/);
  assert.doesNotMatch(html, /本轮企业目录范围已提供/);
  const missing = renderToStaticMarkup(createElement(Receipt, { value: undefined, recordedRun: true, requestId: 'old' }));
  assert.match(missing, /企业资料来源未记录／未知/);
  assert.doesNotMatch(missing, /本轮企业目录范围已提供|legacy/);
});

test('publication preserves the contribution snapshot as a preview fact rather than claiming verified resolution', async () => {
  const Summary = await publicationSummary;
  const html = renderToStaticMarkup(createElement(Summary, { publication: { preview: { id: 'preview-one', fingerprint: 'f'.repeat(64), systemRevision: 1, topicId: 'topic-one', items: [], refs: [], summary: '预览', scope: '合成范围', checks: [], limitations: [], excluded: [], targetProjectIds: [], createdAt: '2026-11-12T00:00:00Z', confirmedAt: '2026-11-12T00:00:00Z', contributions: [{ contributionId: 'UC01', revision: 2, sha256: 'a'.repeat(64), sourceProjectId: 'p1', sourceTaskId: 't1', title: '补充退款口径', report: { authority: 'task', id: 'AR01', version: 'saved' }, baseRefs: [] }] }, results: [] }, onOpen() {} }));
  assert.match(html, /预览含任务贡献 1 项/);
  assert.doesNotMatch(html, /已验证解决/);
});

test('Studio presents enterprise foundation, task evolution and publication as one management space', async () => {
  const Page = await studio;
  const html = renderToStaticMarkup(createElement(Page, { projects: [], onOpenTask() {} }));
  assert.match(html, /企业基础资产/);
  assert.match(html, /建设与演进/);
  assert.match(html, /发布与使用/);
  assert.match(html, /当前企业/);
  assert.match(html, /普通分析无需先进入/);
});

test('enterprise materials can be managed inside Studio without another page heading or plugin return route', async () => {
  const Page = await materials;
  const html = renderToStaticMarkup(createElement(Page, { embedded: true, enterpriseId: 'ea', allowedIds: [], onBack() {}, onMetrics() {}, onRequirements() {} }));
  assert.match(html, /<h2[^>]*>企业业务资料<\/h2>/);
  assert.doesNotMatch(html, /<h1|返回分析资产|公共资料集中维护/);
  assert.match(html, /新建资料/);
});

test('SAP indicators remain a professional editor inside Studio without mandatory per-project enablement', async () => {
  const Page = await metrics;
  const html = renderToStaticMarkup(createElement(Page, { embedded: true, enterpriseId: 'ea', allowedIds: [], projects: [], onBack() {}, onOpenTask() {}, onProjectsChanged() {} }));
  assert.match(html, /<h2[^>]*>分析指标<\/h2>/);
  assert.doesNotMatch(html, /<h1|返回分析资产|项目启用|全局库 ·/);
  assert.match(html, /审核发布/);
});

test('SAP methods preserve their save-before-publish behavior under the Studio heading', async () => {
  const Page = await methods;
  const html = renderToStaticMarkup(createElement(Page, { embedded: true, enterpriseId: 'ea', allowedIds: [] }));
  assert.match(html, /<h2[^>]*>分析方法<\/h2>/);
  assert.doesNotMatch(html, /<h1/);
  assert.match(html, /新建方法/);
});

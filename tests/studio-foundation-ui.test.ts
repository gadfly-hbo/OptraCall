import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ui = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  const directory = `${root}.local/studio-foundation-implementation/ui`;
  await mkdir(directory, { recursive: true }); assert.equal(await realpath(directory), directory);
  await build({ input: `${root}src/host/ui/StudioFoundationView.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/foundation-ui.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'foundation-ui-css', resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error The isolated UI artifact is built above, outside product imports.
  return import('../.local/studio-foundation-implementation/ui/foundation-ui.mjs');
})();
const ref = { authority: 'enterprise', id: 'approved-policy', version: 'r1' };
const body = JSON.stringify({ contentProfile: 'studio-foundation/1', scope: 'Approved business unit', items: [{ itemId: 'relationship', kind: 'entity', name: 'Membership relationship', definition: 'Identity is a relationship, not an account.', sourceRef: ref, grain: 'one relationship', scope: 'Approved business unit' }], metricLinks: [{ metricRef: { sourceRef: { authority: 'sap-metric', id: 'metric-package', version: '2.1' }, metricName: 'relationship_count' }, entityItemIds: ['relationship'] }], readiness: { definition: { status: 'pass', detail: 'Author checked the definition.', evidenceRefs: [ref] }, use: { status: 'pass', detail: 'Author states it was used.', evidenceRefs: [ref] } } });

test('FA08/UI: explicit source content exposes item identity, grain, exact SAP metric references and four separate author states', async () => {
  const { StudioFoundationContent } = await ui;
  const html = renderToStaticMarkup(createElement(StudioFoundationContent, { body, complete: true, onReadSource: () => {} }));
  assert.match(html, /<h3[^>]*>条目与身份<\/h3>/);
  for (const text of ['Membership relationship', 'one relationship', 'Approved business unit', 'relationship_count', 'metric-package', '2.1', '定义', '映射', '可计算', '实际使用', '作者记录']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /独立核验通过|已正确应用|<textarea|公式编辑/);
});

test('FA15/UI: a publication projection summarizes exact content and applicability without copying a formula editor', async () => {
  const { StudioFoundationContent } = await ui;
  const html = renderToStaticMarkup(createElement(StudioFoundationContent, { body, section: 'publication', complete: true, onReadSource: () => {} }));
  assert.match(html, /<h3[^>]*>本准确版本的三类结构摘要<\/h3>/);
  assert.match(html, /1 个主数据与语义条目/);
  assert.match(html, /1 个准确指标引用/);
  assert.match(html, /Approved business unit/);
  assert.doesNotMatch(html, /<textarea|<h3[^>]*>条目与身份<\/h3>/);
});

test('FA08/14/UI: old text, unsupported profiles and partial source bodies do not become validated structure', async () => {
  const { StudioFoundationContent } = await ui;
  assert.equal(renderToStaticMarkup(createElement(StudioFoundationContent, { body: 'An original legacy definition.' })), '');
  const unknown = renderToStaticMarkup(createElement(StudioFoundationContent, { body: JSON.stringify({ contentProfile: 'future/9', items: [] }) }));
  assert.match(unknown, /未知内容约定/); assert.doesNotMatch(unknown, /条目与身份|作者记录：通过/);
  const invalid = renderToStaticMarkup(createElement(StudioFoundationContent, { body: '{"contentProfile":"studio-foundation/1",' }));
  assert.match(invalid, /结构存在缺口/); assert.doesNotMatch(invalid, /条目与身份/);
  const partial = renderToStaticMarkup(createElement(StudioFoundationContent, { body, complete: false }));
  assert.match(partial, /部分正文不能形成完整结构核验/); assert.doesNotMatch(partial, /条目与身份|作者记录：通过/);
});

test('FA11/UI: author readiness cannot borrow use evidence from another exact version or content hash', async () => {
  const { StudioFoundationContent } = await ui;
  const sourceRef = { authority: 'studio-source', id: 'model', version: '2', sha256: 'b'.repeat(64), locator: 'system' };
  const old = { id: 'old-use', sources: [{ ...sourceRef, version: '1' }], report: { authority: 'task', id: 'OLD_REPORT', version: '1' }, result: 'Original old-use result', verification: 'pass' };
  const changed = { ...old, id: 'changed', sources: [{ ...sourceRef, sha256: 'a'.repeat(64) }], report: { ...old.report, id: 'WRONG_CONTENT_REPORT' } };
  const absent = renderToStaticMarkup(createElement(StudioFoundationContent, { body, sourceRef, uses: [old, changed], section: 'checks' }));
  assert.match(absent, /尚无绑定本准确版本的实际使用记录/); assert.doesNotMatch(absent, /OLD_REPORT|WRONG_CONTENT_REPORT|独立核验通过/);
  const current = { ...old, id: 'current', sources: [sourceRef], report: { ...old.report, id: 'CURRENT_REPORT' } };
  const present = renderToStaticMarkup(createElement(StudioFoundationContent, { body, sourceRef, uses: [current], section: 'checks' }));
  assert.match(present, /有 1 条绑定本准确版本的实际使用记录/); assert.match(present, /CURRENT_REPORT/); assert.match(present, /独立使用核验待核/);
});

test('FA09/10/UI: relation type, statistical conditions and reference adaptation evidence remain explicit', async () => {
  const { StudioFoundationContent } = await ui;
  const profile = JSON.parse(body);
  profile.relations = [{ relationId: 'decomposition', type: 'statistical-decomposition', from: { kind: 'metric', metricRef: { ...profile.metricLinks[0].metricRef, metricName: 'population_count' } }, to: { kind: 'metric', metricRef: profile.metricLinks[0].metricRef }, detail: 'Only within the declared population.', mutuallyExclusive: false, complete: true, additive: false, scope: 'Declared population', evidenceRefs: [ref] }];
  profile.adaptations = [{ referenceRef: { sourceRef: ref, itemId: 'reference-relationship' }, targetItemId: 'relationship', action: 'modify', reason: 'Approved target identity differs.', evidenceRefs: [ref] }];
  const html = renderToStaticMarkup(createElement(StudioFoundationContent, { body: JSON.stringify(profile), onReadSource: () => {} }));
  for (const text of ['统计分解', '互斥：否', '穷尽：是', '可加：否', 'Declared population', '修改采用', 'reference-relationship', 'Approved target identity differs.', 'approved-policy']) assert.ok(html.includes(text), text);
});

test('FA11/15/UI: candidate and formal source identities stay separate and original source restrictions remain visible', async () => {
  const { StudioFoundationView, StudioFoundationNavigation } = await ui;
  const revision = { revision: 1, title: 'Original foundation', body, scope: 'Approved unit', sha256: 'a'.repeat(64), checks: [], sources: [], dependencies: [], limitations: [], readyForPublication: true, reason: '', createdAt: '2026-11-12T00:00:00Z' };
  const foundation = { enterprise: { id: 'enterprise', name: 'Approved enterprise' }, items: [], unassigned: [], systems: [{ id: 'system', projectId: 'project', uses: [], assets: [{ id: 'model', kind: 'concept', formalRevision: 1, candidateRevision: 2, revisions: [revision, { ...revision, revision: 2, title: 'Revised foundation', sha256: 'b'.repeat(64) }], issue: { affectedRevision: 1, reason: 'Original identity rule has a confirmed limitation.' } }] }] };
  const html = renderToStaticMarkup(createElement(StudioFoundationView, { foundation, section: 'overview', onReadSource: () => {}, onOpenAsset: () => {}, onBuild: () => {} }));
  assert.match(html, /正式 r1/); assert.match(html, /候选 r2/);
  assert.match(html, /Original identity rule has a confirmed limitation\./);
  assert.doesNotMatch(html, /企业建设已完成|正式可用|独立核验通过/);
  const nav = renderToStaticMarkup(createElement(StudioFoundationNavigation, { section: 'reference', onSelect: () => {} }));
  for (const text of ['体系总览', '三类资产', '参考与内化', '关联核验']) assert.ok(nav.includes(text), text);
  assert.match(nav, /aria-pressed="true"[^>]*>参考与内化/);
});

test('FA13/UI: structured assets obey the same filtered catalogue as the professional asset table', async () => {
  const { StudioFoundationView } = await ui;
  const revision = { revision: 1, body, scope: 'Approved unit', sha256: 'a'.repeat(64), checks: [], sources: [], dependencies: [], limitations: [], readyForPublication: false, reason: '', createdAt: '2026-11-12T00:00:00Z' };
  const foundation = { enterprise: { id: 'enterprise', name: 'Approved enterprise' }, items: [], unassigned: [], systems: [{ id: 'system', projectId: 'project', uses: [], assets: [{ id: 'semantic-model', kind: 'concept', formalRevision: null, candidateRevision: 1, revisions: [{ ...revision, title: 'Semantic original source' }] }, { id: 'binding-model', kind: 'binding', formalRevision: null, candidateRevision: 1, revisions: [{ ...revision, title: 'Binding original source' }] }] }] };
  const options = { foundation, section: 'assets', onReadSource: () => {}, onOpenAsset: () => {}, onBuild: () => {} };
  const binding = { authority: 'studio-source', id: 'binding-model', version: '1', systemId: 'system', kind: 'binding', title: 'Binding original source', status: 'candidate' };
  const bindings = renderToStaticMarkup(createElement(StudioFoundationView, { ...options, catalogItems: [binding] }));
  assert.match(bindings, /Binding original source/); assert.doesNotMatch(bindings, /Semantic original source/);
  const metrics = renderToStaticMarkup(createElement(StudioFoundationView, { ...options, catalogItems: [{ authority: 'sap-metric', id: 'metric-package', version: '2.1', title: 'Professional metric package', status: 'published' }] }));
  assert.doesNotMatch(metrics, /Semantic original source|Binding original source/);
  assert.match(metrics, /没有匹配的结构资产/);
  const absent = renderToStaticMarkup(createElement(StudioFoundationView, { ...options, catalogItems: [] }));
  assert.doesNotMatch(absent, /Semantic original source|Binding original source/);
  assert.match(absent, /没有匹配的结构资产/);
});

test('FA14/UI: unavailable or loading foundation data stays unknown instead of becoming zero assets', async () => {
  const { StudioFoundationView } = await ui;
  const options = { section: 'overview', onReadSource: () => {}, onOpenAsset: () => {}, onBuild: () => {}, onRefresh: () => {} };
  const unavailable = renderToStaticMarkup(createElement(StudioFoundationView, { ...options, foundation: undefined, loading: false }));
  assert.match(unavailable, /尚未取得资产范围/); assert.match(unavailable, />重新读取资产<\/button>/);
  assert.doesNotMatch(unavailable, /<strong>0<\/strong>|尚无显式的三类资产结构|表达建设目标/);
  const loading = renderToStaticMarkup(createElement(StudioFoundationView, { ...options, foundation: undefined, loading: true }));
  assert.match(loading, /role="status"/); assert.doesNotMatch(loading, /<strong>0<\/strong>|尚无显式的三类资产结构/);
  const empty = renderToStaticMarkup(createElement(StudioFoundationView, { ...options, foundation: { enterprise: { id: 'enterprise', name: 'Approved enterprise' }, systems: [], items: [], unassigned: [] }, loading: false }));
  assert.match(empty, /尚无显式的三类资产结构/); assert.doesNotMatch(empty, /尚未取得资产范围/);
});

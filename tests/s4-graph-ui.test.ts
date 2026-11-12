import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ui = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  const directory = `${root}.local/fourbase-l2-s4/sc01s-v0.1/run-20261105T095713Z/tmp/graph-ui`;
  await mkdir(directory, { recursive: true }); assert.equal(await realpath(directory), directory);
  await build({ input: new URL('../src/host/ui/SemanticContextPanel.tsx', import.meta.url).pathname,
    external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/semantic-context-ui-ssr.mjs` }, transform: { jsx: 'react-jsx' },
    plugins: [{ name: 's4-graph-ui-css', resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error The approved isolated SSR artifact is generated above.
  return import('../.local/fourbase-l2-s4/sc01s-v0.1/run-20261105T095713Z/tmp/graph-ui/semantic-context-ui-ssr.mjs');
})();
const ref = { kind: 'sap', packageId: 'optracall-sc01s-retail', version: '0.1.0', metricName: 'net_retail_sales', publishedHash: null, sourceHandle: 'saved-run-only-source' };
const metadata = { sourceRefs: [ref], buildSources: [{ inputKey: 'approved-design', locator: '/definition', sha256: 'c'.repeat(64), nature: 'engineering-design' }], claimKind: 'source-projection', conditions: ['以原支付归属'], limitations: ['样本截数不等于退款成熟'], businessTime: [{ text: '退款按原支付归属', source: '原制度第二节' }] };
const graph = { schemaVersion: 1, type: 'optracall.semantic-graph-result', action: 'graph', operation: 'dependencies', state: 'partial',
  snapshot: { id: 'fbaba342-4e0d-41d0-8196-1ee27b34d13c', graphSha256: 'a'.repeat(64), ontologySha256: 'b'.repeat(64), componentVersion: '0.7.0' },
  nodes: [{ id: 'net-v1', type: 'MetricVersion', content: '净零售额 = 终端零售额 − 零售退款额 <原定义>', metadata },
    { id: 'refund-v1', type: 'MetricVersion', content: '退款按原订单支付期间归属', metadata },
    { id: 'maturity-unknown', type: 'Condition', content: '真实退款是否成熟仍未知', metadata: { ...metadata, conditionState: 'unknown' } }],
  edges: [{ id: 'net-refund-source', source: 'net-v1', target: 'refund-v1', type: 'depends_on', metadata: { ...metadata, operandRole: 'subtrahend' } },
    { id: 'net-refund-interpretation', source: 'net-v1', target: 'refund-v1', type: 'depends_on', metadata: { ...metadata, claimKind: 'engineering-interpretation', operandRole: 'subtrahend' } }],
  paths: [{ nodeIds: ['net-v1', 'refund-v1'], steps: [{ edgeId: 'net-refund-source', direction: 'forward' }] },
    { nodeIds: ['net-v1', 'refund-v1'], steps: [{ edgeId: 'net-refund-interpretation', direction: 'forward' }] }], sources: [],
  coverage: { complete: false, continuation: 'saved-run-only-cursor', gaps: ['source-validation-gap'], depthLimit: 2, depthReached: 2, exhausted: false },
};

test('the existing optional drawer displays saved graph definitions, provenance and separate parallel paths without activating queries', async t => {
  const { SemanticContextDetails } = await ui;
  let reads = 0, continuations = 0, fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('No passive queries'); });
  const before = JSON.stringify(graph);
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ graphResult: graph,
    graphInput: { action: 'graph', operation: 'dependencies', nodeId: 'net-v1' } }], view: 'saved', lookup: { state: 'idle' },
    onRead: () => { reads++; }, onContinueRecord: () => { continuations++; } }));
  for (const text of ['净零售额 = 终端零售额 − 零售退款额 &lt;原定义&gt;', '真实退款是否成熟仍未知', 'source-projection', 'engineering-interpretation',
    'subtrahend', '原支付归属', '原制度第二节', '0.1.0', 'net-refund-source', 'net-refund-interpretation', 'source-validation-gap', '2', 'unknown']) assert.ok(html.includes(text), text);
  assert.match(html, /业务含义/);
  assert.match(html, /不代表.*专业正确|专业正确性.*未/);
  assert.match(html, /当时返回/);
  assert.match(html, /原生记录|准确身份|原始元数据/);
  assert.match(html, /后续页.*当时|当时.*后续页/);
  assert.doesNotMatch(html, /继续读取本次查询|<form|<input|<select|<iframe|<script/);
  assert.equal(reads + continuations + fetches, 0);
  assert.equal(JSON.stringify(graph), before);
});

test('unavailable graph states never display cached bodies, source locators or raw payload details', async () => {
  const { SemanticContextDetails } = await ui;
  for (const state of ['forbidden', 'disabled', 'excluded', 'missing', 'hash-conflict', 'unknown']) {
    const denied = { ...graph, state, nodes: [{ ...graph.nodes[0], id: 'WITHHELD_ID', content: 'WITHHELD_BODY' }],
      sources: [{ sourceHandle: 'WITHHELD_HANDLE', body: 'WITHHELD_SOURCE_BODY', range: null, nature: 'original-source', gaps: [] }] };
    const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ graphResult: denied }], view: 'saved', lookup: { state: 'idle' } }));
    assert.doesNotMatch(html, /WITHHELD_|optracall-sc01s-retail|approved-design|fbaba342/);
    assert.match(html, /未知|未返回|不展示|未取得/);
  }
});

test('saved source fragments retain exact UTF16 coordinates and saved continuation remains passive', async () => {
  const { SemanticContextDetails } = await ui;
  const fragment = { ...graph, operation: 'source', nodes: [], edges: [], paths: [], sources: [{ sourceHandle: 'saved-run-source', ref,
    body: '原文😀<片段>', range: { start: 3, end: 11, total: 30 }, nature: 'original-source', gaps: ['source-original-range'] }] };
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ graphResult: fragment }], view: 'saved', lookup: { state: 'idle' } }));
  for (const text of ['原文😀&lt;片段&gt;', '[3, 11)', '30', 'UTF-16', 'source-original-range']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /继续读取本次查询/);
  assert.match(html, /正常追问|原任务.*追问/);
});

test('nested graph metadata remains UNKNOWN in the same panel and the ordinary optional entry stays unchanged', async t => {
  const { SemanticContextDetails, SemanticContextPanel } = await ui;
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('No render request'); });
  const unknown = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ graphInput: { action: 'graph', operation: 'source', sourceHandle: 'saved-run-only-source' }, issue: '子工具正文未记录 · UNKNOWN' }], view: 'saved', lookup: { state: 'idle' } }));
  assert.match(unknown, /UNKNOWN/); assert.doesNotMatch(unknown, /saved-run-only-source|现在按原引用回读|继续读取本次查询/);
  const entry = renderToStaticMarkup(createElement(SemanticContextPanel, { projectId: 'project', taskId: 'task', records: [{ graphResult: graph }] }));
  assert.match(entry, /本次依据/); assert.doesNotMatch(entry, /<dialog|<form|<input|<select/);
  assert.equal(fetches, 0);
});

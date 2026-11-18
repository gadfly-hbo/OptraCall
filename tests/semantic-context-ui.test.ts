import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isSemanticSourcesRecorded, readSemanticContext } from '../src/host/ui/semantic-context-client.ts';
import type { SemanticQueryResult } from '../extensions/business-plugins/semantic-context/types.ts';

const ui = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  const directory = `${root}.local/fourbase-modules/m7-l1-semantic-trace/implementation/ui`;
  await mkdir(directory, { recursive: true });
  assert.equal(await realpath(directory), directory);
  await build({ input: new URL('../src/host/ui/SemanticContextPanel.tsx', import.meta.url).pathname, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/semantic-context-ui-ssr.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{
    name: 'semantic-context-ui-css',
    resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; },
    load(id) { if (id.startsWith('\0empty-css:')) return ''; },
  }] });
  // @ts-expect-error Isolated test artifact is built above; it is not a product import.
  return import('../.local/fourbase-modules/m7-l1-semantic-trace/implementation/ui/semantic-context-ui-ssr.mjs');
})();

test('L109/110 UI ordinary answers expose an optional entry without source setup or network activation', async t => {
  let requests = 0, followups = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No activation from rendering'); });
  const { SemanticContextPanel } = await ui;
  const html = renderToStaticMarkup(createElement(SemanticContextPanel, { projectId: 'project', taskId: 'task', onFollowup: () => { followups++; } }));
  assert.match(html, /<button[^>]*type="button"[^>]*>本次依据<\/button>/);
  assert.doesNotMatch(html, /<form|<input|<select|required|<dialog/);
  assert.equal(requests, 0);
  assert.equal(followups, 0);
});

const exactTarget = { kind: 'sap' as const, packageId: 'threshold', version: '1.2', metricName: 'amount', publishedHash: 'a'.repeat(64) };
const emptyResult: SemanticQueryResult = { schemaVersion: 1, type: 'optracall.semantic-context-result', action: 'read', state: 'available', items: [], unknownTime: [], indexRevision: null, coverage: { complete: true, continuation: null, gaps: [] } };

test('L101/106 UI explicit source read preserves exact tuple and owner and does not initialize a session', async t => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(emptyResult)); });
  const signal = new AbortController().signal, query = { action: 'read' as const, target: exactTarget };
  assert.deepEqual(await readSemanticContext('project/a', 'task/a', query, signal), emptyResult);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, '/api/projects/project%2Fa/tasks/task%2Fa/semantic-context');
  assert.equal(calls[0]!.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), query);
  assert.equal(calls[0]!.init?.signal, signal);
  assert.equal(calls[0]!.init?.credentials, 'omit');
  assert.equal(calls[0]!.init?.cache, 'no-store');
});

test('L106 UI failed exact lookup stays a local typed error without retry or latest fallback', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(JSON.stringify({ error: 'semantic_source_changed', message: '准确来源已变化，原记录保持。' }), { status: 409 }); });
  await assert.rejects(() => readSemanticContext('project', 'task', { action: 'read', target: exactTarget }), (error: unknown) => error instanceof Error && error.message === '准确来源已变化，原记录保持。' && 'code' in error && error.code === 'semantic_source_changed' && 'status' in error && error.status === 409);
  assert.equal(requests, 1);
});

const oldRule = { target: exactTarget, title: '<原规则 1.2>', state: 'available' as const, sha256: 'b'.repeat(64), body: '原始正文\r\n金额 < 500 & 原有例外', range: null, recordedAt: { field: 'publishedAt', value: '2026-10-10T03:00:00+08:00' }, businessTime: [{ text: '10月1日起生效，时区未写明', source: '通知第三段' }], governance: { enabled: false, archived: true }, declaration: { actor: 'agent', text: '本稿明确引用规则1.2；计算正确性未核。', claim: 'author-declaration' as const }, relations: [{ relation: 'opposes', target: { ...exactTarget, version: '1.3' }, note: '新旧前提有分歧', claim: 'author-declaration' as const }], gaps: ['当时是否送达未记录'] };

test('L102/103/104 UI saved evidence preserves original body, reference direction and separate time meanings without promoting adoption', async () => {
  const { SemanticContextEvidence } = await ui;
  const result = { ...emptyResult, action: 'trace', items: [oldRule] };
  const html = renderToStaticMarkup(createElement(SemanticContextEvidence, { result }));
  for (const text of ['&lt;原规则 1.2&gt;', '原始正文\r\n金额 &lt; 500 &amp; 原有例外', '2026-10-10T03:00:00+08:00', 'publishedAt', '10月1日起生效，时区未写明', '通知第三段', '本稿明确引用规则1.2；计算正确性未核。', 'opposes', '1.3', '当时是否送达未记录', 'publishedHash']) assert.ok(html.includes(text), text);
  assert.match(html, /当时返回的治理/);
  assert.match(html, /作者声明/);
  assert.match(html, /专业正确性.*未.*获证/);
  assert.doesNotMatch(html, /已验证采用|完整历史快照|现在已生效|成功保存引用/);
});

test('L106 UI denied sources reveal no cached identity/body and inaccessible states never present a fallback body', async () => {
  const { SemanticContextEvidence } = await ui;
  const denied = { ...oldRule, state: 'forbidden', target: { ...exactTarget, packageId: 'secret-package' }, title: 'secret-title', body: 'secret-body', declaration: { ...oldRule.declaration, text: 'secret-declaration' }, governance: { note: 'secret-governance' } };
  const result = { ...emptyResult, state: 'partial', items: [denied, ...['missing', 'hash-conflict'].map(state => ({ ...oldRule, state, body: `unavailable-body-${state}` })), ...['excluded', 'disabled', 'unknown'].map(state => ({ ...oldRule, state, body: null }))] };
  const html = renderToStaticMarkup(createElement(SemanticContextEvidence, { result }));
  for (const text of ['secret-package', 'secret-title', 'secret-body', 'secret-declaration', 'secret-governance', 'unavailable-body-']) assert.ok(!html.includes(text), text);
  for (const text of ['权限不足', '来源缺失', '哈希冲突', '已排除', '已停用', '未知']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /关闭保护|自动重试|读取最新/);
});

test('L103/106/109 UI missing records, cancellation and query failure preserve unknowns with no lookup or followup activation', async () => {
  const { SemanticContextDetails } = await ui;
  let reads = 0, drafts = 0;
  const props = { records: [{ issue: '旧工具结果无法核定' }], onRead: () => { reads++; }, onFollowup: () => { drafts++; } };
  const saved = renderToStaticMarkup(createElement(SemanticContextDetails, { ...props, view: 'saved', lookup: { state: 'idle' } }));
  assert.match(saved, /旧工具结果无法核定/);
  assert.match(saved, /引用.*未知/);
  assert.doesNotMatch(saved, /已保存引用|记录已保存|来源保存成功/);
  for (const [state, text] of [['cancelled', '已取消'], ['error', '连接中断']] as const) {
    const current = renderToStaticMarkup(createElement(SemanticContextDetails, { ...props, view: 'current', lookup: { state, error: '连接中断' } }));
    assert.ok(current.includes(text), text);
    assert.match(current, /原任务仍可继续/);
    assert.doesNotMatch(current, /<input|<select|required|尚未找到任何资料/);
  }
  assert.equal(reads, 0);
  assert.equal(drafts, 0);
});

test('L106 UI malformed success and non-JSON responses remain local failures rather than renderable empty results', async t => {
  let response = new Response(JSON.stringify({ ...emptyResult, items: null })), requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return response; });
  for (const value of [JSON.stringify({ ...emptyResult, items: null }), JSON.stringify({ ...emptyResult, items: [{ ...oldRule, target: { kind: 'source', source: null } }] }), '<html>unavailable</html>']) {
    response = new Response(value);
    await assert.rejects(() => readSemanticContext('project', 'task', { action: 'read', target: exactTarget }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'semantic_context_invalid_response');
  }
  assert.equal(requests, 3);
});

test('L107 UI shows an author declaration receipt only from the original M2 acknowledgement, separate from reading and correctness', async () => {
  const { SemanticContextDetails } = await ui;
  const receipt = { schemaVersion: 1, type: 'optracall.analysis-sources-recorded', claim: 'author-declaration-not-verification', projectId: 'project', citationId: 'exact-citation', operationId: 'exact-operation', indexRevision: 3, replayed: true, publishedOnRetry: false, report: { originalPath: '060_reports/old-report.md', sha256: 'c'.repeat(64), bytes: 42 } };
  assert.equal(isSemanticSourcesRecorded(receipt), true);
  for (const change of [{ claim: 'verified' }, { citationId: null }, { report: { originalPath: 'newest' } }, { indexRevision: -1 }]) assert.equal(isSemanticSourcesRecorded({ ...receipt, ...change }), false);
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ receipt }], view: 'saved', lookup: { state: 'idle' } }));
  for (const text of ['作者声明引用回执', 'exact-citation', 'exact-operation', '060_reports/old-report.md', '不证明真实计算采用或专业正确性']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /来源无法核定|已验证采用|业务验证通过/);
});

test('L104/106 UI original metadata fragments and unknown-time sources remain explicit and never become inferred dates', async () => {
  const { SemanticContextEvidence } = await ui;
  const metadataFragment = { text: '{"originalRelation":"limits","originalText":"后续页未提供"', range: { start: 0, end: 52, total: 80 } };
  const unknown = { ...oldRule, state: 'partial', recordedAt: null, businessTime: [], declaration: null, metadataFragment };
  const result = { ...emptyResult, state: 'partial', items: [], unknownTime: [unknown], coverage: { complete: false, continuation: 'exact-opaque-continuation', gaps: ['原元数据有后续片段'] } };
  const before = JSON.stringify(result), html = renderToStaticMarkup(createElement(SemanticContextEvidence, { result, perspective: 'current' }));
  for (const text of ['留存时间未知的来源', '未记录 · UNKNOWN', '原始元数据片段', 'originalRelation', 'limits', '[0, 52)', '80', '仍有后续页／片段', '本次核对的治理', '未提供完整作者引用声明']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /2026-10-10|有效时间已确定/);
  assert.equal(JSON.stringify(result), before);
});

test('L103/106 UI oversized metadata does not turn an unreturned declaration, time or governance into an absence claim', async () => {
  const { SemanticContextEvidence } = await ui;
  const item = { ...oldRule, businessTime: [], declaration: null, governance: null, metadataFragment: { text: '{"declaration":', range: { start: 0, end: 15, total: 100 } } };
  const html = renderToStaticMarkup(createElement(SemanticContextEvidence, { result: { ...emptyResult, items: [item] } }));
  assert.match(html, /未提供完整作者引用声明/);
  assert.match(html, /未提供完整业务时间声明/);
  assert.match(html, /未提供治理全文/);
  assert.doesNotMatch(html, /本项没有作者引用声明|不由留存时间推定|治理未记录/);
});

function buttonAction(node: ReactNode, label: string): (() => void) | undefined {
  if (Array.isArray(node)) { for (const child of node) { const action = buttonAction(child, label); if (action) return action; } return; }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === 'button' && node.props.children === label) return node.props.onClick;
  return buttonAction(node.props.children, label);
}

test('L103 UI missing nested child result can only re-read an actual exact pointer by explicit user action', async t => {
  const { SemanticContextDetails } = await ui;
  const reads: unknown[] = []; let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No implicit network'); });
  const tree = SemanticContextDetails({ records: [{ issue: '原生只有嵌套元信息，子正文与保存回执 UNKNOWN。', input: { action: 'read', target: exactTarget } }], view: 'saved', lookup: { state: 'idle' }, onRead: (target: unknown) => reads.push(target) });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /当前回读.*不能补造历史/);
  assert.doesNotMatch(html, /原 M2 已返回.*保存回执/);
  assert.deepEqual(reads, []);
  const read = buttonAction(tree, '现在按原引用回读'); assert.ok(read); read();
  assert.deepEqual(reads, [exactTarget]);
  assert.equal(requests, 0);
});

test('L109 UI optional followup and correction buttons only hand one draft to the current task callback', async t => {
  const { SemanticContextDetails } = await ui;
  const drafts: string[] = []; let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No send or publish'); });
  const props = { records: [], view: 'saved', lookup: { state: 'idle' }, onFollowup: (draft: string) => drafts.push(draft) };
  const tree = SemanticContextDetails(props);
  assert.deepEqual(drafts, []);
  const correct = buttonAction(tree, '补充纠正'); assert.ok(correct); correct();
  assert.deepEqual(drafts, ['补充纠正：请将我接下来提供的说明与原稿声明分开，保留原引用和未知部分。']);
  assert.equal(requests, 0);
  assert.match(renderToStaticMarkup(tree), /只预填当前任务草稿，由你正常发送/);
  assert.doesNotMatch(renderToStaticMarkup(SemanticContextDetails({ ...props, onFollowup: undefined })), /继续追问|补充纠正/);
});


test('L106 human-authorized exact historical bodies retain exclusion warnings while inaccessible states never render body', async () => {
  const { SemanticContextEvidence } = await ui;
  const source = { target: exactTarget, title: 'Historical authorized source', sha256: 'a'.repeat(64), range: null, recordedAt: null, businessTime: [], governance: { excluded: true }, declaration: null, relations: [], gaps: [] };
  for (const state of ['excluded', 'disabled', 'unknown'] as const) {
    const html = renderToStaticMarkup(createElement(SemanticContextEvidence, { result: { ...emptyResult, items: [{ ...source, state, body: 'HUMAN_EXACT_HISTORY_ALLOWED' }] }, perspective: 'current' }));
    assert.match(html, /HUMAN_EXACT_HISTORY_ALLOWED/, state);
    assert.match(html, /准确原文|本次返回的原文/);
  }
  for (const state of ['missing', 'hash-conflict', 'forbidden'] as const) {
    const html = renderToStaticMarkup(createElement(SemanticContextEvidence, { result: { ...emptyResult, items: [{ ...source, state, body: 'INACCESSIBLE_BODY' }] }, perspective: 'current' }));
    assert.doesNotMatch(html, /INACCESSIBLE_BODY/, state);
  }
});

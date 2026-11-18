import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ui = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  const directory = `${root}.local/studio-phase2-implementation/consumption/ui`;
  await mkdir(directory, { recursive: true }); assert.equal(await realpath(directory), directory);
  await build({ input: `${root}src/host/ui/SemanticContextPanel.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/consumption-ui.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'consumption-ui-css', resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error The isolated test artifact is built above, outside product imports.
  return import('../.local/studio-phase2-implementation/consumption/ui/consumption-ui.mjs');
})();

test('SU21/UI32: the basis panel shows exact Studio fragments and declarations without presenting them as independent verification', async t => {
  const { SemanticContextDetails, SemanticContextPanel } = await ui;
  let requests = 0; t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('Passive evidence cannot query current sources.'); });
  const source = { studio: { action: 'read-source', stage: 'source', complete: false, body: 'Original <partial> source & boundary', ref: { authority: 'sap-metric', id: 'approved-rule', version: '1.2' }, range: { start: 0, end: 43, total: 200 }, result: { complete: false } } };
  const declaration = { studio: { action: 'declare-use', stage: 'declaration', declaration: true, result: { claim: 'author-declaration-not-professional-verification', use: { id: 'use-1', sources: [{ authority: 'sap-metric', id: 'approved-rule', version: '1.2' }], verification: 'not_assessed' } } } };
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [source, declaration], view: 'saved', lookup: { state: 'idle' } }));
  for (const text of ['Original &lt;partial&gt; source &amp; boundary', 'approved-rule', '1.2', '部分正文', '作者使用声明', '独立核验']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /已正确应用|独立核验通过|已读全文/);
  const entry = renderToStaticMarkup(createElement(SemanticContextPanel, { projectId: 'project', taskId: 'task', records: [source, declaration] }));
  assert.match(entry, />本次依据<\/button>/); assert.doesNotMatch(entry, /<dialog|<form|<input|required/);
  assert.equal(requests, 0);
});

test('SU02/21: a denied related source is not exposed by the basis panel as a clickable identity or raw relation payload', async () => {
  const { SemanticContextEvidence } = await ui;
  const result = { action: 'trace', state: 'available', items: [{ target: { kind: 'sap', packageId: 'approved-a', version: '1.2' }, title: 'Approved root', state: 'available', sha256: null, body: 'Only approved evidence', range: null, recordedAt: null, businessTime: [], governance: null, declaration: null, gaps: [], relations: [{ relation: 'depends-on', target: { kind: 'sap', packageId: 'FORBIDDEN_FOREIGN_PACKAGE', version: '1.0' }, note: 'FOREIGN_RELATION_DETAIL', state: 'forbidden', claim: 'author-declaration' }] }], unknownTime: [], coverage: { complete: true, continuation: null, gaps: [] } };
  const html = renderToStaticMarkup(createElement(SemanticContextEvidence, { result, onRead: () => {} }));
  assert.match(html, /权限不足|超出.*范围/); assert.doesNotMatch(html, /FORBIDDEN_FOREIGN_PACKAGE|FOREIGN_RELATION_DETAIL/);
});

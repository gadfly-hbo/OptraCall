import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StudioPublication, StudioSourceRef, StudioUseRecord } from '../extensions/business-plugins/studio/contracts.ts';

const ui = (async () => {
  const directory = new URL('../.local/studio-phase1/', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  await build({ input: new URL('../src/host/ui/StudioPage.tsx', import.meta.url).pathname,
    external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/ui-evidence-ssr.mjs` }, transform: { jsx: 'react-jsx' },
    plugins: [{ name: 'studio-ui-evidence-css', resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error A local SSR test artifact is generated above.
  return import('../.local/studio-phase1/ui-evidence-ssr.mjs');
})();

test('latest author use assessment is visible with its precise report while the original unassessed use remains inspectable', async t => {
  const { StudioUseEvidence } = await ui;
  const original: StudioUseRecord = { id: 'use-one', projectId: 'p1', taskId: 'analysis-one', sources: [], report: { authority: 'task', id: 'original-report', version: 'saved-original', title: '合成原使用报告' }, result: '原使用事实保留', verification: 'not_assessed', createdAt: '2026-11-07T00:00:00Z', assessments: [
    { status: 'pass', report: { authority: 'task', id: 'assessment-first', version: 'saved-first' }, sources: [], result: '首次有限作者评估', at: '2026-11-07T01:00:00Z' },
    { status: 'fail', report: { authority: 'task', id: 'assessment-latest', version: 'saved-latest', title: '合成最新复核报告' }, sources: [], result: '退款归属尚未通过 <仅合成检查>', at: '2026-11-07T02:00:00Z' },
  ] };
  const before = JSON.stringify(original); let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No passive model or source calls'); });
  const html = renderToStaticMarkup(createElement(StudioUseEvidence, { record: original, onOpenTask() {}, onReadSource() {} }));
  assert.match(html, /最新作者评估.*相应范围未通过/);
  assert.match(html, /合成最新复核报告/);
  assert.match(html, /退款归属尚未通过 &lt;仅合成检查&gt;/);
  assert.match(html, /不是独立专业评分或整套体系验收/);
  assert.match(html, /原使用初记：专业质量未评定/);
  assert.match(html, /原使用事实保留/);
  assert.match(html, /首次有限作者评估/);
  assert.equal(JSON.stringify(original), before);
  assert.equal(requests, 0);
});

const confirmedAt = '2026-11-07T15:21:24.505Z';
function publication(results: StudioPublication['results']): StudioPublication {
  return {
    preview: { id: 'confirmed-preview', fingerprint: 'a'.repeat(64), systemRevision: 16, topicId: 'retail-topic',
      items: [], refs: [], summary: '限定发布', scope: '合成门店', checks: [], limitations: [], excluded: [],
      targetProjectIds: [], createdAt: '2026-11-07T15:20:00Z', confirmedAt },
    results,
  };
}

test('Studio displays both officially released r2 assets from one successful module result', async () => {
  const { StudioPublicationSummary } = await ui;
  const refs: StudioSourceRef[] = [
    { authority: 'studio-source', id: 'retail-net', version: '2', sha256: 'b'.repeat(64) },
    { authority: 'studio-source', id: 'retail-rules', version: '2', sha256: 'c'.repeat(64) },
  ];
  const value = publication([{ module: 'studio-source', status: 'succeeded', detail: '正式保存', refs, at: confirmedAt }]);
  const html = renderToStaticMarkup(createElement(StudioPublicationSummary, { publication: value, onOpen() {} }));
  assert.match(html, /已正式发布 2 项 · r2/);
  assert.match(html, /<button[^>]*>查看实际结果<\/button>/);
});

test('Studio reports partial success alongside failed and unknown exact publication results', async () => {
  const { StudioPublicationSummary } = await ui;
  const value = publication([
    { module: 'studio-source', status: 'succeeded', detail: '正式保存', refs: [{ authority: 'studio-source', id: 'retail-net', version: '2' }], at: confirmedAt },
    { module: 'sap-method', status: 'failed', detail: '未写入', refs: [{ authority: 'sap-method', id: 'refund-mapping', version: '1' }], at: confirmedAt },
    { module: 'sap-method', status: 'unknown', detail: '回执待核', refs: [{ authority: 'sap-method', id: 'bank', version: '1' }], at: confirmedAt },
  ]);
  const html = renderToStaticMarkup(createElement(StudioPublicationSummary, { publication: value, onOpen() {} }));
  assert.match(html, /已正式发布 1 项 · r2/);
  assert.match(html, /失败 1 项/);
  assert.match(html, /UNKNOWN 1 项/);
});

test('Studio exposes an unknown result without counting an empty success receipt as a published asset', async () => {
  const { StudioPublicationSummary } = await ui;
  const value = publication([
    { module: 'studio-source', status: 'succeeded', detail: '本次无语义源', refs: [], at: confirmedAt },
    { module: 'sap-method', status: 'unknown', detail: '回执待核', refs: [{ authority: 'sap-method', id: 'bank', version: '1' }], at: confirmedAt },
  ]);
  const html = renderToStaticMarkup(createElement(StudioPublicationSummary, { publication: value, onOpen() {} }));
  assert.match(html, /尚无成功发布项/);
  assert.match(html, /UNKNOWN 1 项/);
  assert.doesNotMatch(html, /已正式发布/);
  assert.match(html, /查看实际结果/);
});

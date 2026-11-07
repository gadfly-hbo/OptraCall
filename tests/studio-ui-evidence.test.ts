import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StudioUseRecord } from '../extensions/business-plugins/studio/contracts.ts';

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

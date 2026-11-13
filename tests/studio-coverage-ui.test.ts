import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCoverageReport, studioCoverageEntries } from '../src/host/ui/studio-coverage-view.ts';

const material = { authority: 'enterprise', id: 'policy', version: '1', title: '同名制度', locator: 'A' } as const;
const later = { ...material, version: '2' };
const other = { ...material, locator: 'B' };
const unmarked = { authority: 'enterprise', id: 'interview', version: '1' } as const;
const method = { authority: 'sap-method', id: 'survey', version: '1' } as const;
const master = { authority: 'studio-source', id: 'model', version: '3', locator: 'system' } as const;
const metric = { authority: 'sap-metric', id: 'metrics', version: '1.0.0' } as const;
const ontology = { authority: 'studio-source', id: 'rules', version: '1', locator: 'system' } as const;
const unknown = { authority: 'studio-source', id: 'business', version: '1', locator: 'system' } as const;
const report = {
  reportProfile: 'studio-coverage/1', scope: { enterpriseId: 'e', systemId: 's', topicId: 't', purpose: 'scope', included: [], excluded: [] },
  methodRefs: [method], basisRefs: [material, later, other, unmarked, master, metric, ontology, unknown], focusCells: [{ row: 1, column: 'What' }],
  observations: [
    { id: 'range', description: 'SCOPE-ONLY', subjectLabel: 'range', annotations: [{ cell: { row: 1, column: 'What' }, reason: 'range' }, { cell: { row: 2, column: 'What' }, reason: 'definition' }], evidenceRefs: [material], evidenceStatus: 'located' },
    { id: 'definition', description: 'DEFINITION-ONLY', subjectLabel: 'definition', annotations: [{ cell: { row: 2, column: 'What' }, reason: 'logical relation' }], evidenceRefs: [later, master, metric], evidenceStatus: 'partial', sourceSelection: { sourceRef: master, itemId: 'member' } },
    { id: 'instance', description: 'INSTANCE-ONLY', subjectLabel: 'instance', annotations: [{ cell: { row: 6, column: 'What' }, reason: 'observed row' }], evidenceRefs: [other, ontology], evidenceStatus: 'located' },
    { id: 'unmarked', description: 'UNMARKED', subjectLabel: 'interview', annotations: [], evidenceRefs: [unmarked], evidenceStatus: 'not-reviewed' },
  ], questions: [], limitations: ['not independent verification'],
};
const ready = { systemId: 's', assetId: 'report', revision: 1, ref: { authority: 'studio-source', id: 'report', version: '1', locator: 's' }, status: 'ready', report,
  references: [{ ref: master, assetKind: 'business', foundationKinds: ['master-data'] }, { ref: ontology, assetKind: 'ontology', foundationKinds: ['ontology'] }, { ref: unknown, assetKind: 'business' }] } as any;

test('C03/C04 UI projection joins exact explicit annotations and counts accurate versions once, including unmarked materials', () => {
  const p = projectCoverageReport(ready);
  assert.ok(p, 'a qualified readable report must project its evidence');
  assert.equal(p.materials.length, 4); assert.equal(p.assets.length, 3); assert.equal(p.methods.length, 1); assert.equal(p.unclassified.length, 1);
  assert.deepEqual(p.cells.get('R1:What')!.observations.map(o => o.id), ['range']);
  assert.deepEqual(p.cells.get('R2:What')!.observations.map(o => o.id), ['range', 'definition']);
  assert.deepEqual(p.cells.get('R6:What')!.observations.map(o => o.id), ['instance']);
  assert.equal(p.cells.get('R4:How')!.observations.length, 0);
  assert.equal(p.materials.find(r => r.ref.id === 'interview')!.cells.length, 0);
  assert.equal(p.materials.filter(r => r.ref.id === 'policy').length, 3, 'locator and accurate version remain separate');
  assert.deepEqual(p.assets.find(r => r.ref.id === 'model')!.cells, ['R2:What']);
  assert.deepEqual(p.unclassified.map(r => r.ref.id), ['business'], 'business kind does not invent a master-data classification');
  assert.equal(JSON.stringify(ready.report), JSON.stringify(report));
});

test('BC05/C05 UI projection refuses stale cached report bodies for every nonready current result', () => {
  assert.equal(projectCoverageReport(), undefined);
  for (const status of ['unavailable', 'unsupported', 'invalid']) assert.equal(projectCoverageReport({ ...ready, status }), undefined, status);
  assert.equal(projectCoverageReport({ ...ready, report: undefined }), undefined);
});

test('BC05 UI discovery retains accurate independent report revisions, without accepting cached report evidence', () => {
  const asset = { id: 'report', kind: 'business', formalRevision: 1, candidateRevision: 2, revisions: [
    { revision: 1, title: 'original', body: JSON.stringify(report), sha256: 'a'.repeat(64) },
    { revision: 2, title: 'candidate', body: JSON.stringify(report), sha256: 'b'.repeat(64) },
    { revision: 3, title: 'future', body: '{"reportProfile":"studio-coverage/9"}', sha256: 'c'.repeat(64) },
    { revision: 4, title: 'legacy', body: 'Original business prose.', sha256: 'd'.repeat(64) },
  ] };
  const entries = studioCoverageEntries({ enterprise: { id: 'e' }, systems: [{ id: 's', enterpriseId: 'e', projectId: 'p', assets: [asset] }] } as any);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(e => e.identity), ['formal', 'candidate', 'history']);
  assert.equal(entries[0].ref.version, '1');
  assert.equal('report' in entries[0], false);
});

test('BC05 coverage client requires the requested exact scope and refuses body evidence on unavailable qualification', async t => {
  const { readStudioCoverage, StudioRequestError } = await import('../src/host/ui/studio-api.ts');
  for (const value of [
    { ...ready, systemId: 'foreign' }, { ...ready, revision: 2 }, { ...ready, ref: { ...ready.ref, version: '2' } },
    { ...ready, status: 'unavailable', report }, { ...ready, status: 'unavailable', report: undefined, text: 'FORBIDDEN' },
    { ...ready, report: { ...report, scope: { ...report.scope, systemId: 'foreign' } } },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(value)));
    await assert.rejects(readStudioCoverage('s', 'report', 1), error => error instanceof StudioRequestError && error.code === 'studio_response_mismatch');
  }
});

test('BC05 coverage client uses an abortable exact GET and leaves legal unsupported raw text distinct from ready evidence', async t => {
  const { readStudioCoverage } = await import('../src/host/ui/studio-api.ts');
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(url), '/api/studio/systems/s/coverage?assetId=report&revision=1');
    assert.equal(init?.method, 'GET'); assert.equal(init?.signal, controller.signal);
    return new Response(JSON.stringify({ ...ready, status: 'unsupported', report: undefined, references: undefined, text: '{"reportProfile":"studio-coverage/9"}' }));
  });
  const value = await readStudioCoverage('s', 'report', 1, controller.signal);
  assert.equal(value.status, 'unsupported'); assert.equal(projectCoverageReport(value), undefined);
  assert.match(value.text!, /studio-coverage\/9/);
});

const ui = (async () => {
  const { mkdir } = await import('node:fs/promises'), { build } = await import('rolldown');
  const directory = new URL('../.local/studio-business-coverage-implementation/tdd-ui/', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  await build({ input: new URL('../src/host/ui/StudioCoverageView.tsx', import.meta.url).pathname, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: directory + 'coverage-ui.mjs' }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'coverage-css', resolveId(id) { if (id.endsWith('.css')) return '\0empty-css:' + id + '.js'; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error This isolated SSR artifact is generated above.
  return import('../.local/studio-business-coverage-implementation/tdd-ui/coverage-ui.mjs');
})();

test('C01/C02/C05/C08 product DOM always exposes 36 uniquely named cell buttons, with unknown evidence before a qualified read', async () => {
  const { StudioCoverageContent } = await ui;
  const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(createElement(StudioCoverageContent, { phase: 'loading' }));
  assert.equal((html.match(/data-coverage-cell=/g) || []).length, 36);
  for (const title of ['R1:What 经营对象范围', 'R2:What 业务对象与关系', 'R6:What 实际业务对象记录']) assert.ok(html.includes(title), title);
  assert.match(html, /首批参考范围.*14/); assert.match(html, /报告关注.*未知/);
  assert.match(html, /资料数量.*未知/); assert.doesNotMatch(html, /SCOPE-ONLY|DEFINITION-ONLY|完成率|健康分/);
});

test('BC02/05 product DOM preserves the full framework and original raw-text boundary for unsupported or unavailable reports', async () => {
  const { StudioCoverageContent } = await ui;
  const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  for (const status of ['unsupported', 'invalid', 'unavailable']) {
    const html = renderToStaticMarkup(createElement(StudioCoverageContent, { value: { ...ready, status, text: status === 'unavailable' ? undefined : 'RAW-EXACT', report: undefined, references: undefined }, phase: 'settled' }));
    assert.equal((html.match(/data-coverage-cell=/g) || []).length, 36);
    assert.match(html, /资料数量.*未知/);
    assert.equal(html.includes('RAW-EXACT'), status !== 'unavailable');
    assert.doesNotMatch(html, /SCOPE-ONLY|DEFINITION-ONLY|独立核验通过|作者记录：受限/);
  }
});

test('C03/C04 ready product DOM derives enterprise counts and preserves distinct report focus without synthetic demo quotas', async () => {
  const { StudioCoverageContent } = await ui;
  const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(createElement(StudioCoverageContent, { value: ready, phase: 'settled', identity: 'candidate' }));
  assert.equal((html.match(/data-coverage-cell=/g) || []).length, 36);
  for (const text of ['4 个已分类准确版本', '3 个准确修订', '含主数据条目 1', '含指标关联 1', '含本体定义 1', '1 个来源类别未核', '建设侧候选', '候选可见不代表普通供给']) assert.ok(html.includes(text), text);
  assert.match(html, /报告关注.*1 格/);
  assert.match(html, /当前查看高亮 14 格/);
  assert.doesNotMatch(html, /13个|6项|评审情景|发送演示|模型调用已完成|正式发布完成/);
});

test('BC01/C09 a report build request continues the same enterprise task and never opens a parallel system', async () => {
  const { routeStudioCoverageBuild } = await import('../src/host/ui/studio-coverage-view.ts');
  const system = { id: 'original', enterpriseId: 'e' }, foundation = { enterprise: { id: 'e' }, systems: [system] } as any;
  const calls: unknown[] = [];
  const input = { foundation, systemId: 'original', goal: 'Review this scope', isCurrent: () => true,
    openExisting: async (id: string) => { calls.push(['open', id]); return true; },
    continueExisting: async (value: any, goal?: string) => { calls.push(['continue', value.id, goal]); },
    create: async (goal?: string) => { calls.push(['create', goal]); } };
  await routeStudioCoverageBuild(input);
  assert.deepEqual(calls, [['open', 'original'], ['continue', 'original', 'Review this scope']]);
  calls.length = 0;
  await routeStudioCoverageBuild({ ...input, systemId: undefined });
  assert.deepEqual(calls, [['create', 'Review this scope']]);
  calls.length = 0;
  await routeStudioCoverageBuild({ ...input, openExisting: async () => false });
  assert.deepEqual(calls, [], 'leaving an editor must not bypass its guard or send the goal');
  await assert.rejects(routeStudioCoverageBuild({ ...input, systemId: 'foreign' }), /当前企业/);
  assert.deepEqual(calls, []);
  await routeStudioCoverageBuild({ ...input, isCurrent: () => false });
  assert.deepEqual(calls, [], 'a late enterprise switch must not send an old goal');
});

test('BC08/C07 coverage exposes direct navigation to the original ordinary analysis and use history without starting a task', async () => {
  const { StudioCoverageContent } = await ui;
  const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  let opened = 0;
  for (const value of [undefined, ready, { ...ready, status: 'unavailable', report: undefined, references: undefined }]) {
    const html = renderToStaticMarkup(createElement(StudioCoverageContent, { value, phase: value ? 'settled' : 'idle', onOpenUsage: () => { opened++; } }));
    assert.match(html, /<button[^>]*>普通分析与使用记录<\/button>/);
    assert.doesNotMatch(html, /<form|发送问题|自动采用|自动发布/);
  }
  assert.equal(opened, 0, 'rendering is a read-only navigation affordance, not an automatic action');
});

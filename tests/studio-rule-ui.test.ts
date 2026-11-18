import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StudioRuleReceipt } from '../src/host/studio-rule-reasoning.ts';

const directory = new URL('../.local/studio-rule-reasoning-implementation/ui/', import.meta.url).pathname;
const ui = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  assert.equal(await realpath(directory), directory.replace(/\/$/, ''));
  await build({ input: `${root}src/host/ui/StudioFoundationView.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}foundation-ui.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'rule-ui-css', resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error The isolated UI artifact is built above, outside product imports.
  return import('../.local/studio-rule-reasoning-implementation/ui/foundation-ui.mjs');
})();
const evidenceUi = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  await build({ input: `${root}src/host/ui/SemanticContextPanel.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}evidence-ui.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'rule-evidence-css', resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error The isolated UI artifact is built above, outside product imports.
  return import('../.local/studio-rule-reasoning-implementation/ui/evidence-ui.mjs');
})();
const ruleUi = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  await build({ input: `${root}src/host/ui/StudioRuleExecutionView.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}rule-ui.mjs` }, transform: { jsx: 'react-jsx' } });
  // @ts-expect-error The isolated UI artifact is built above, outside product imports.
  return import('../.local/studio-rule-reasoning-implementation/ui/rule-ui.mjs');
})();
const pageUi = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  await mkdir(`${directory}integration`, { recursive: true });
  await build({ input: `${root}src/host/ui/StudioPage.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}integration/studio-page.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'published-result-css', resolveId(id) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; }, load(id) { if (id.startsWith('\0empty-css:')) return ''; } }] });
  // @ts-expect-error The isolated UI artifact is built above, outside product imports.
  return import('../.local/studio-rule-reasoning-implementation/ui/integration/studio-page.mjs');
})();

const sourceRef = { authority: 'enterprise', id: 'approved-policy', version: 'r1' } as const;
const original = { contentProfile: 'studio-foundation/2', scope: 'Approved unit', items: [{ itemId: 'relationship', kind: 'entity', definition: 'One approved relationship.', sourceRef }] };
const bindingRef = { authority: 'studio-source', id: 'approved-binding', version: '3', locator: 'system', sha256: 'b'.repeat(64) } as const;
const inputRef = { authority: 'data', id: 'approved-observations', version: 'input-v1', projectId: 'project', taskId: 'analysis', sha256: 'c'.repeat(64) } as const;
const receipt: StudioRuleReceipt = {
  component: { name: 'semantica', version: '0.7.0' }, contractVersion: 'studio-rule-execution/1', engineInvoked: true, factVerification: 'agent-projection-not-independent-verification',
  identity: { requestId: 'original-request', operationId: 'original-operation', enterpriseId: 'enterprise', projectId: 'project', taskId: 'analysis', purpose: 'Approved qualification', ruleRef: { authority: 'studio-source', id: 'eligibility-rules', version: '1', sha256: 'a'.repeat(64), locator: 'system' }, ruleItemIds: ['eligibility'], factsRef: inputRef, sourceRefs: [sourceRef, bindingRef], engine: { name: 'semantica', version: '0.7.0' }, contractVersion: 'studio-rule-execution/1', inputFingerprint: 'd'.repeat(64) },
  completion: 'complete', conclusions: [{ statement: 'eligible(relationship-1)', ruleId: 'rule-normal', ruleItemId: 'eligibility', premises: ['normal(relationship-1)'], confidence: 1 }],
  assessments: [{ targetId: 'relationship-1', state: 'derived' }],
  limitations: ['Approved sample only'], provenanceQuality: 'official-rule-and-premises',
};
const executionBody = JSON.stringify({ ...original, items: [...original.items,
  { itemId: 'state', kind: 'attribute', definition: 'Observed state.', sourceRef },
  { itemId: 'eligibility', kind: 'rule', definition: 'An approved normal state explicitly supports eligibility.', sourceRef },
], ruleExecution: {
  contractVersion: 'studio-rule-execution/1', engine: { name: 'semantica', version: '0.7.0' },
  rules: [{ ruleId: 'rule-normal', ruleItemId: 'eligibility', conditions: ['normal(?relationship)'], conclusion: 'eligible(?relationship)' }],
  predicates: [
    { predicate: 'normal', namespace: 'approved-membership', itemId: 'state', arguments: [{ name: 'relationship', itemId: 'relationship', valueType: 'string' }] },
    { predicate: 'eligible', namespace: 'approved-membership', itemId: 'eligibility', arguments: [{ name: 'relationship', itemId: 'relationship', valueType: 'string' }] },
  ],
  factRequirements: [{ requirementId: 'observed-status', predicate: 'normal', sourceRef: inputRef, bindingRef, fields: ['relationship_key', 'status'], grain: 'One approved relationship', unit: 'relationship', timeBasis: 'Observed at 2026-11-13', coverage: 'Approved sample only; missing status remains unknown', kind: 'observed' }],
  constraints: { format: 'shacl-turtle', shapes: '@prefix sh: <http://www.w3.org/ns/shacl#> .', sourceRefs: [sourceRef] },
} });

test('RR01/03/UI: /2 without execution stays readable without acquiring executable-rule status', async () => {
  const { StudioFoundationContent } = await ui;
  const html = renderToStaticMarkup(createElement(StudioFoundationContent, { body: JSON.stringify(original) }));
  assert.match(html, /内容约定 studio-foundation\/2/);
  assert.match(html, /One approved relationship\./);
  assert.match(html, /尚未选择规则执行表示/);
  assert.doesNotMatch(html, /规则执行已通过|执行就绪|<textarea|评审情景/);
  await writeFile(`${directory}source-no-execution.html`, html);
});

test('RR01/UI: /1 retains its original content contract and receives no automatic execution projection', async () => {
  const { StudioFoundationContent } = await ui;
  const html = renderToStaticMarkup(createElement(StudioFoundationContent, { body: JSON.stringify({ ...original, contentProfile: 'studio-foundation/1' }) }));
  assert.match(html, /内容约定 studio-foundation\/1/);
  assert.doesNotMatch(html, /尚未选择规则执行表示|可执行规则与事实条件|规则执行已通过/);
});

test('RR03/UI: unsupported or partial source content never borrows another source execution status', async () => {
  const { StudioFoundationContent } = await ui;
  const invalid = renderToStaticMarkup(createElement(StudioFoundationContent, { body: JSON.stringify({ ...original, contentProfile: 'studio-foundation/9', ruleExecution: { supported: true } }) }));
  assert.match(invalid, /未知内容约定/);
  assert.doesNotMatch(invalid, /可执行规则与事实条件|执行就绪|检查通过/);
  const partial = renderToStaticMarkup(createElement(StudioFoundationContent, { body: JSON.stringify(original), complete: false }));
  assert.match(partial, /部分正文不能形成完整结构核验/);
  assert.doesNotMatch(partial, /可执行规则与事实条件|One approved relationship/);
});

test('RR03/04/UI: the same source revision exposes readable rules, declared atoms, identities and fact conditions without an execution claim', async () => {
  const { StudioFoundationContent } = await ui;
  const html = renderToStaticMarkup(createElement(StudioFoundationContent, { body: executionBody, onReadSource: () => {} }));
  for (const text of ['可执行规则与事实条件', 'An approved normal state explicitly supports eligibility.', 'rule-normal', 'eligibility', 'normal(?relationship)', 'eligible(?relationship)', 'approved-membership', 'relationship_key', 'One approved relationship', 'relationship', 'Observed at 2026-11-13', 'Approved sample only; missing status remains unknown', 'approved-observations', 'input-v1', 'approved-binding', '0.7.0']) assert.ok(html.includes(text), text);
  assert.match(html, /观察事实/);
  assert.match(html, /SHACL/);
  assert.match(html, /尚无本次工具调用回执|不代表已执行/);
  assert.doesNotMatch(html, /执行已通过|业务概率|预置核查|评审情景|<textarea|逐条选择规则/);
  await writeFile(`${directory}source-execution.html`, html);
});

test('RR08/UI: the original publication and checks projections retain the exact rules, facts and separate author readiness', async () => {
  const { StudioFoundationContent } = await ui;
  const publication = renderToStaticMarkup(createElement(StudioFoundationContent, { body: executionBody, section: 'publication', onReadSource: () => {} }));
  for (const text of ['本准确版本的三类结构摘要', 'rule-normal', 'approved-observations', 'input-v1', 'approved-binding', 'Approved sample only; missing status remains unknown']) assert.ok(publication.includes(text), text);
  assert.match(publication, /发布.*不.*执行|不代表已执行/);
  const checks = renderToStaticMarkup(createElement(StudioFoundationContent, { body: executionBody, section: 'checks' }));
  for (const text of ['四项状态与实际依据', '作者记录：待核', '可执行规则与事实条件', 'rule-normal']) assert.ok(checks.includes(text), text);
  assert.doesNotMatch(checks, /独立核验通过|规则执行已通过/);
});

test('RR04/UI: external computation requirements preserve their declared provenance without claiming independent verification', async () => {
  const { StudioFoundationContent } = await ui;
  const profile = JSON.parse(executionBody);
  profile.ruleExecution.factRequirements[0].kind = 'external-computation';
  profile.ruleExecution.factRequirements[0].calculationRefs = [{ authority: 'task', id: 'original-calculation', version: 'artifact-v1', projectId: 'project', taskId: 'analysis' }];
  const html = renderToStaticMarkup(createElement(StudioFoundationContent, { body: JSON.stringify(profile) }));
  assert.match(html, /外部计算事实/);
  assert.match(html, /original-calculation/);
  assert.match(html, /artifact-v1/);
  assert.doesNotMatch(html, /外部计算已独立核验|业务概率|事实已全部核实/);
});

test('RR07/09/10/UI: saved ordinary-tool receipts retain the original versions and actual premises without reading current sources', async t => {
  const { SemanticContextDetails } = await evidenceUi;
  let requests = 0; t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('Saved evidence cannot fetch current sources.'); });
  const before = JSON.stringify(receipt);
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result: receipt } }], view: 'saved', lookup: { state: 'idle' } }));
  for (const text of ['规则工具调用', '完整', 'original-request', 'original-operation', 'Approved qualification', 'eligibility-rules', 'input-v1', 'approved-binding', 'eligible(relationship-1)', 'normal(relationship-1)', 'rule-normal', '已推出', '原执行回执', '0.7.0', 'Approved sample only']) assert.ok(html.includes(text), text);
  assert.match(html, /固定.*历史|当时.*回执/);
  assert.doesNotMatch(html, /独立核验通过|业务概率|置信度.*100%|逐条选择规则|评审情景/);
  assert.equal(requests, 0); assert.equal(JSON.stringify(receipt), before);
  await writeFile(`${directory}saved-execution.html`, html);
});

test('RR03/09/UI: an ordinary accurate-source read exposes rule conditions without becoming a rule execution', async () => {
  const { SemanticContextDetails } = await evidenceUi;
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'read-source', stage: 'source', body: executionBody, complete: true, ref: receipt.identity.ruleRef, result: { complete: true } } }], view: 'saved', lookup: { state: 'idle' } }));
  assert.match(html, /可执行规则与事实条件/);
  assert.match(html, /Approved sample only; missing status remains unknown/);
  assert.doesNotMatch(html, /规则工具调用|实际已调用|规则执行已通过/);
});

test('RR04/07/UI: not-derived, explicit negative, insufficient and conflicting observations stay distinct', async () => {
  const { SemanticContextDetails } = await evidenceUi;
  const value = { ...receipt, assessments: ['not-derived', 'explicit-negative', 'insufficient-facts', 'conflict'].map((state, index) => ({ targetId: `relationship-${index}`, state })) };
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result: value } }], view: 'saved', lookup: { state: 'idle' } }));
  for (const text of ['未推出', '显式不符合', '事实不足', '冲突']) assert.ok(html.includes(text), text);
  assert.match(html, /未推出不等于显式不符合/);
});

test('RR07/UI: incomplete, unsupported, cancelled and failed calls never become a completed empty business result', async () => {
  const { SemanticContextDetails } = await evidenceUi;
  for (const [completion, label] of [['incomplete', '未完成'], ['unsupported', '不支持'], ['cancelled', '已取消'], ['failed', '失败']]) {
    const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result: { ...receipt, completion, conclusions: [], assessments: [] } } }], view: 'saved', lookup: { state: 'idle' } }));
    assert.ok(html.includes(label), label);
    assert.match(html, /未取得完整业务结论|不代表完整零结论/);
    assert.doesNotMatch(html, /执行完整|完整空结果|0条不符合|规则执行已通过/);
    await writeFile(`${directory}execution-${completion}.html`, html);
  }
});

test('RR03/06/07/UI: malformed or future receipts remain unknown and do not expose unvalidated raw source content', async () => {
  const { SemanticContextDetails } = await evidenceUi;
  for (const result of [{ completion: 'complete', identity: { ruleRef: { id: 'UNVALIDATED_SOURCE' } }, conclusions: [{ conclusion: 'UNVALIDATED_CONCLUSION' }] }, { ...receipt, completion: 'future-status', secret: 'UNVALIDATED_SOURCE' }, { ...receipt, conclusions: [{ statement: 'UNVALIDATED_CONCLUSION', premises: 'invalid', ruleId: 'rule-normal' }] }]) {
    const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result } }], view: 'saved', lookup: { state: 'idle' } }));
    assert.match(html, /规则调用回执.*未能核定|规则调用回执.*未知/);
    assert.doesNotMatch(html, /UNVALIDATED_SOURCE|UNVALIDATED_CONCLUSION|已推出/);
  }
});

test('RR07/UI: merged official premises are explained as alternative derivation evidence rather than one required conjunction', async () => {
  const { SemanticContextDetails } = await evidenceUi;
  const value = { ...receipt, provenanceQuality: 'primary-rule-with-merged-premises', conclusions: [{ ...receipt.conclusions[0], provenanceCompleteness: 'primary-rule-with-merged-premises', premisesNature: 'engine-reported-union' }], limitations: ['official-primary-rule-only-premises-may-merge-alternative-derivations'] };
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result: value } }], view: 'saved', lookup: { state: 'idle' } }));
  assert.match(html, /前提可能合并多个推导/);
  assert.match(html, /不代表同一次推导全部必需/);
  assert.doesNotMatch(html, /所有前提均为必要条件|业务概率/);
  await writeFile(`${directory}saved-merged-premises.html`, html);
});

test('RR04/07/UI: actual SHACL conformity stays separate from fact verification and missing SHACL stays unrun', async () => {
  const { SemanticContextDetails } = await evidenceUi;
  for (const conforms of [true, false]) {
    const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result: { ...receipt, constraints: { conforms, violation_count: conforms ? 0 : 1, warning_count: 0, violations: conforms ? [] : [{ focus_node: 'relationship-1', result_path: 'status', message: 'Required status is missing.' }], warnings: [], infos: [] } } } }], view: 'saved', lookup: { state: 'idle' } }));
    assert.match(html, conforms ? /约束通过/ : /约束不通过/);
    assert.match(html, /未因调用而获得独立核验/);
    if (!conforms) assert.match(html, /Required status is missing\./);
    assert.doesNotMatch(html, /规则执行已通过|事实已全部核实/);
  }
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result: { ...receipt, completion: 'unsupported', engineInvoked: false, conclusions: [], assessments: [], identity: { ...receipt.identity, factsRef: undefined } } } }], view: 'saved', lookup: { state: 'idle' } }));
  assert.match(html, /未调用/); assert.match(html, /约束未运行／未提供回执/); assert.doesNotMatch(html, /实际已调用|已推出/);
});

test('RR04/07/UI: coverage cutoff and fact record provenance remain bound to the saved receipt', async t => {
  const { SemanticContextDetails } = await evidenceUi;
  let requests = 0; t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('Coverage is a frozen receipt.'); });
  const value = { ...receipt, completion: 'incomplete', inputCoverage: { complete: false, detail: 'Only approved selected records.', cutoffAt: '2026-11-13T00:00:00Z', businessTime: 'Observation instant 2026-11-12', missingRequirementIds: ['status-history'] }, factEvidence: [{ factId: 'fact-1', statement: 'normal(relationship-1)', requirementId: 'observed-status', sourceRefs: [inputRef], locator: 'row=12; field=status', kind: 'observed', bindingRef }] };
  const html = renderToStaticMarkup(createElement(SemanticContextDetails, { records: [{ studio: { action: 'reason', stage: 'asset', result: value } }], view: 'saved', lookup: { state: 'idle' } }));
  for (const text of ['输入覆盖与截止', '覆盖不完整', 'Only approved selected records.', '2026-11-13T00:00:00Z', 'Observation instant 2026-11-12', 'status-history', 'fact-1', 'row=12; field=status', 'approved-binding']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /完整有效总数|事实已独立核验/);
  assert.equal(requests, 0);
  await writeFile(`${directory}saved-coverage-execution.html`, html);
});

test('RR08/UI: a publication displays only its frozen purpose, rule identities and fact conditions; legacy previews acquire none', async () => {
  const { StudioRulePublicationView } = await ruleUi;
  const profile = JSON.parse(executionBody);
  const preview = { purposes: ['definition-reference', 'rule-execution'], executionSummaries: [{ assetId: 'frozen-rule-source', revision: 1, sha256: 'a'.repeat(64), contractVersion: profile.ruleExecution.contractVersion, engine: profile.ruleExecution.engine, ruleItemIds: ['eligibility'], factRequirements: profile.ruleExecution.factRequirements }] };
  const before = JSON.stringify(preview);
  const html = renderToStaticMarkup(createElement(StudioRulePublicationView, { preview }));
  for (const text of ['本次发布用途', '定义参考', '规则执行', 'frozen-rule-source', 'eligibility', 'approved-observations', 'input-v1', 'approved-binding', 'Approved sample only; missing status remains unknown']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<input|<textarea|已实际运行|独立核验通过|自动采用新版/);
  assert.equal(JSON.stringify(preview), before);
  assert.equal(renderToStaticMarkup(createElement(StudioRulePublicationView, { preview: {} })), '');
  await writeFile(`${directory}publication-execution.html`, html);
});

test('RR08/UI: candidate identity changes invalidate confirmation while the exact preview snapshot remains available', async () => {
  const { studioRulePreviewChanged } = await ruleUi;
  const preview = { items: [{ assetId: 'rule', revision: 1, sha256: 'a'.repeat(64) }] };
  const revision = { revision: 1, sha256: 'a'.repeat(64) };
  const original = [{ id: 'rule', formalRevision: null, candidateRevision: 1, revisions: [revision] }];
  assert.equal(studioRulePreviewChanged(preview, original), false);
  assert.equal(studioRulePreviewChanged(preview, [{ ...original[0], candidateRevision: 2, revisions: [revision, { revision: 2, sha256: 'b'.repeat(64) }] }]), true);
  assert.equal(studioRulePreviewChanged(preview, [{ ...original[0], revisions: [{ ...revision, sha256: 'c'.repeat(64) }] }]), true);
  assert.equal(studioRulePreviewChanged(preview, []), true);
  assert.equal(preview.items[0].sha256, 'a'.repeat(64));
});

test('RR08/UI integration: confirmed result details keep their original frozen purposes and execution scope accessible', async t => {
  const { StudioPublicationResultScope } = await pageUi;
  let requests = 0; t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('Published scope is a saved snapshot.'); });
  const profile = JSON.parse(executionBody);
  const publication = { preview: { id: 'original-published-preview', summary: 'Previously confirmed rule version', confirmedAt: '2026-11-13T00:00:00Z', purposes: ['definition-reference', 'rule-execution'], executionSummaries: [{ assetId: 'frozen-source-r1', revision: 1, sha256: 'a'.repeat(64), contractVersion: profile.ruleExecution.contractVersion, engine: profile.ruleExecution.engine, ruleItemIds: ['eligibility'], factRequirements: profile.ruleExecution.factRequirements }] }, results: [] };
  const before = JSON.stringify(publication);
  const html = renderToStaticMarkup(createElement(StudioPublicationResultScope, { publication }));
  for (const text of ['Previously confirmed rule version', '本次发布用途', '定义参考', '规则执行', 'frozen-source-r1', 'eligibility', 'input-v1', 'approved-binding']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<input|<textarea|确认本轮正式发布|自动采用新版/);
  assert.equal(JSON.stringify(publication), before); assert.equal(requests, 0);
  const legacy = renderToStaticMarkup(createElement(StudioPublicationResultScope, { publication: { preview: { summary: 'Legacy original result' }, results: [] } }));
  assert.match(legacy, /Legacy original result/); assert.doesNotMatch(legacy, /本次发布用途|规则执行/);
  await writeFile(`${directory}integration/published-result-scope.html`, html);
});

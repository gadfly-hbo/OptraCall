import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ssr = (async () => {
  const directory = new URL('../.local/fourbase-modules/m3/implementation/ui/', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  await build({ input: 'personal-ui-test-entry', external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}personal-ui-ssr.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{
    name: 'known-personal-ui-test-entry',
    resolveId(id) { if (id === 'personal-ui-test-entry') return '\0personal-ui-test-entry'; if (id.endsWith('.css')) return `\0empty-css:${id}.js`; },
    load(id) {
      if (id.startsWith('\0empty-css:')) return '';
      if (id === '\0personal-ui-test-entry') return `export { EnterpriseMaterialEditorFields } from ${JSON.stringify(new URL('../src/host/ui/EnterpriseMaterialEditorFields.tsx', import.meta.url).pathname)}; export { PersonalLookupResults, PersonalRetentionConfirmation } from ${JSON.stringify(new URL('../src/host/ui/PersonalMaterialsPage.tsx', import.meta.url).pathname)};`;
    },
  }] });
  // @ts-expect-error This isolated ESM test artifact is generated immediately above, never imported by the product.
  return import('../.local/fourbase-modules/m3/implementation/ui/personal-ui-ssr.mjs');
})();

test('PR02 shared Enterprise editor renders exact selected content read-only and labels validation', async () => {
  const { EnterpriseMaterialEditorFields: Editor } = await ssr;
  const fields = { title: '<旧标题>', category: '', body: '旧版准确正文 & 原文', source: '', owner: '', scope: '旧范围', effectiveTime: '', sourceFileId: null };
  const markup = renderToStaticMarkup(createElement(Editor, { fields, onChange() {}, readOnly: true, idPrefix: 'exact' }));
  assert.match(markup, /&lt;旧标题&gt;/);
  assert.match(markup, /旧版准确正文 &amp; 原文/);
  assert.match(markup, /id="exact-body"[^>]*readOnly=""/);
  assert.match(markup, /for="exact-scope"/);
  assert.doesNotMatch(markup, /aria-invalid="true"/);
  const invalid = renderToStaticMarkup(createElement(Editor, { fields: { ...fields, title: '' }, onChange() {}, tried: true, idPrefix: 'draft' }));
  assert.match(invalid, /aria-invalid="true"/);
  assert.match(invalid, /aria-describedby="draft-title-error"/);
  assert.match(invalid, /id="draft-title-error"/);
});

test('PR07/08 client preserves exact refs and complete failed request, never automatically replays', async () => {
  const { personalRetentionApi, PersonalRetentionRequestError } = await import('../src/host/ui/personal-retention-client.ts');
  const calls: { path: string; init?: RequestInit }[] = [], original = globalThis.fetch;
  const request = { operationId: 'same-operation', expectedRevision: 3, target: { type: 'revision' as const, revisionId: 'old/revision', expectedBodySha256: 'a'.repeat(64) }, metadata: { kind: 'experience' as const, aliases: ['退货'], caution: '样本有限', sourceRefs: [{ type: 'enterprise' as const, storeId: 'store', materialId: 'source-material', revisionId: 'source-old' }] }, personalLabel: null };
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), init }); return new Response(JSON.stringify({ error: 'personal_revision_conflict', message: '条目已变化。' }), { status: 409 }); };
  try {
    await assert.rejects(() => personalRetentionApi.retain('material/id', request), error => error instanceof PersonalRetentionRequestError && error.status === 409 && error.code === 'personal_revision_conflict');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, '/api/personal-retention/items/material%2Fid/retain');
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), request);
    assert.equal(calls[0]?.init?.credentials, 'omit');
    assert.equal(calls[0]?.init?.cache, 'no-store');
  } finally { globalThis.fetch = original; }
});

test('PR08 a locally unknown operation survives reopening with its original payload until explicit settlement', async () => {
  const { createPersonalOperationJournal } = await import('../src/host/ui/personal-retention-client.ts');
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const request = { operationId: 'stable-operation', expectedRevision: 2, target: { type: 'draft' as const, expectedMaterialVersion: 7, expectedDraftSha256: 'b'.repeat(64) }, metadata: { kind: 'knowledge' as const, aliases: ['原别名'], caution: null, sourceRefs: [] }, personalLabel: null };
  createPersonalOperationJournal(storage).remember('material', request);
  request.metadata.aliases[0] = '后来修改';
  const reopened = createPersonalOperationJournal(storage);
  assert.deepEqual(reopened.read('material')?.metadata.aliases, ['原别名']);
  assert.throws(() => reopened.remember('material', request), /原请求/);
  assert.throws(() => reopened.remember('material', { ...request, operationId: 'replacement' }), /待核对/);
  reopened.settle('material', 'different-operation');
  assert.equal(reopened.read('material')?.operationId, 'stable-operation');
  reopened.settle('material', 'stable-operation');
  assert.equal(reopened.read('material'), null);
});

test('PR01 repeated direct source identity ignores object key order while distinct revisions and excerpts stay distinct', async () => {
  const { addPersonalSourceRef, personalJsonEqual } = await import('../src/host/ui/personal-retention-client.ts');
  const source = { type: 'enterprise' as const, storeId: 'store', materialId: 'material', revisionId: 'old', excerpt: { start: 0, end: 5 } };
  const serverSource = JSON.parse('{"excerpt":{"end":5,"start":0},"materialId":"material","revisionId":"old","storeId":"store","type":"enterprise"}');
  const refs = [serverSource];
  assert.equal(addPersonalSourceRef(refs, source).length, 1);
  assert.equal(addPersonalSourceRef(refs, { ...source, revisionId: 'new' }).length, 2);
  assert.equal(addPersonalSourceRef(refs, { ...source, excerpt: { start: 1, end: 5 } }).length, 2);
  assert.equal(personalJsonEqual({ fields: { body: '准确正文', title: '标题' }, metadata: { sourceRefs: [source], kind: 'knowledge' } }, { metadata: { kind: 'knowledge', sourceRefs: [serverSource] }, fields: { title: '标题', body: '准确正文' } }), true);
  assert.equal(personalJsonEqual({ body: '准确正文' }, { body: '后来正文' }), false);
});

test('PR08 canonical server pending key order reopens the same operation without replacing its original payload', async () => {
  const { createPersonalOperationJournal } = await import('../src/host/ui/personal-retention-client.ts');
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const source = { type: 'enterprise' as const, storeId: 'store', materialId: 'source', revisionId: 'old' };
  const request = { operationId: 'same-pending-operation', expectedRevision: 4, target: { type: 'revision' as const, revisionId: 'old', expectedBodySha256: 'a'.repeat(64) }, metadata: { kind: 'knowledge' as const, aliases: ['甲', '乙'], caution: null, sourceRefs: [source] }, personalLabel: null };
  createPersonalOperationJournal(storage).remember('material', request);
  const originalBytes = [...data.values()][0];
  const server = JSON.parse(JSON.stringify({ expectedRevision: 4, metadata: { aliases: ['甲', '乙'], caution: null, kind: 'knowledge', sourceRefs: [{ materialId: 'source', revisionId: 'old', storeId: 'store', type: 'enterprise' }] }, operationId: 'same-pending-operation', personalLabel: null, target: { expectedBodySha256: 'a'.repeat(64), revisionId: 'old', type: 'revision' } }));
  assert.notEqual(JSON.stringify(server), JSON.stringify(request));
  const reopened = createPersonalOperationJournal(storage);
  assert.doesNotThrow(() => reopened.remember('material', server));
  assert.equal([...data.values()][0], originalBytes);
  for (const changed of [
    { ...server, metadata: { ...server.metadata, kind: 'experience' } },
    { ...server, metadata: { ...server.metadata, sourceRefs: [{ ...source, revisionId: 'new' }] } },
    { ...server, metadata: { ...server.metadata, aliases: ['乙', '甲'] } },
    { ...server, target: { ...server.target, expectedBodySha256: 'b'.repeat(64) } },
  ]) assert.throws(() => reopened.remember('material', changed), /原请求/);
  assert.equal(reopened.read('material')?.operationId, request.operationId);
  assert.equal([...data.values()][0], originalBytes);
});

test('PR08 an unreadable browser intent remains an explicit failure and preserves its bytes', async () => {
  const { createPersonalOperationJournal } = await import('../src/host/ui/personal-retention-client.ts');
  const raw = JSON.stringify({ material: { operationId: 'incomplete', metadata: null } });
  let value = raw;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => { value = ''; } };
  assert.throws(() => createPersonalOperationJournal(storage).entries(), /不可读/);
  assert.equal(value, raw);
});

test('PR04 exact personal history does not read an unrelated Enterprise draft or revision', async () => {
  const { personalRetentionApi, readPersonalMaterialView } = await import('../src/host/ui/personal-retention-client.ts');
  const original = globalThis.fetch, calls: string[] = [];
  const content = { title: '健康旧版', body: '旧版准确正文', revisionId: 'healthy-old', sourceFile: null };
  const decision = { operationId: 'old-decision', contentRef: { storeId: 'synthetic-store', materialId: 'material', revisionId: 'healthy-old' } };
  globalThis.fetch = async input => {
    calls.push(String(input));
    if (String(input) === '/api/personal-retention/items/material?decisionId=old-decision') return new Response(JSON.stringify({ item: null, content, decision, materialState: { materialId: 'material', enabled: false } }), { status: 200 });
    throw new Error('unselected newer body is corrupt');
  };
  try {
    const view = await readPersonalMaterialView(personalRetentionApi, 'material', 'old-decision');
    assert.equal(view.content?.body, '旧版准确正文');
    assert.equal(view.material.enabled, false);
    assert.equal(view.draft, null);
    assert.deepEqual(calls, ['/api/personal-retention/items/material?decisionId=old-decision']);
  } finally { globalThis.fetch = original; }
});

test('PR05 source failures and never-enabled material labels keep distinct meanings', async () => {
  const { PersonalRetentionRequestError, personalSourceFailureLabel } = await import('../src/host/ui/personal-retention-client.ts');
  assert.equal(personalSourceFailureLabel(new PersonalRetentionRequestError('personal_source_missing', 404)), '来源缺失');
  assert.equal(personalSourceFailureLabel(new PersonalRetentionRequestError('source_hash_mismatch', 409)), '内容不符／损坏');
  assert.equal(personalSourceFailureLabel(new PersonalRetentionRequestError('personal_source_project_mismatch', 409)), '来源身份／归属不符');
  assert.equal(personalSourceFailureLabel(new Error('offline')), '来源未能核对');
  const { PersonalLookupResults: Results } = await ssr;
  const row = { id: 'disabled', category: 'knowledge', title: '从未启用资料', aliases: [], scope: '', bodyPreview: '合成正文', bodyTruncated: false, personalState: 'retained', status: 'disabled', materialId: 'material', caution: null, sourceRefs: [], sourceIssues: [], sources: [], matches: [] };
  const markup = renderToStaticMarkup(createElement(Results, { result: { items: [row], total: 1, page: 1, pageSize: 20, complete: true, issues: [] }, onOpen() {} }));
  assert.match(markup, /原资料未启用／已停用/);
  assert.doesNotMatch(markup, /原资料已停用/);
});

test('PR06/07 lookup renders actual partial results and exact match locations, unavailable scope never becomes empty library', async () => {
  const { PersonalLookupResults: Results } = await ssr;
  const row = { id: 'one', category: 'knowledge', title: '<合成资料>', aliases: ['退货'], scope: '合成范围', bodyPreview: '正文原文截取', bodyTruncated: true, personalState: 'retained', status: 'available', materialId: 'material', caution: '未经专业核实', sourceRefs: [], sourceIssues: [], sources: [], matches: [{ field: 'aliases', start: 0, end: 2, aliasIndex: 0 }] };
  const markup = renderToStaticMarkup(createElement(Results, { result: { items: [row], total: 1, page: 1, pageSize: 20, complete: false, issues: [{ code: 'project_unavailable', projectId: 'synthetic-project' }] }, onOpen() {}, onOpenProject() {} }));
  assert.match(markup, /&lt;合成资料&gt;/);
  assert.match(markup, /正文原文截取/);
  assert.match(markup, /别名.*0.*2/);
  assert.match(markup, /部分结果/);
  assert.match(markup, /未经专业核实/);
  assert.doesNotMatch(markup, /还没有个人资料/);
  const unavailable = renderToStaticMarkup(createElement(Results, { result: { items: [], total: 0, page: 1, pageSize: 20, complete: false, issues: [{ code: 'records_unreadable' }] }, onOpen() {}, onOpenProject() {} }));
  assert.match(unavailable, /未能核对完整范围/);
  assert.doesNotMatch(unavailable, /还没有个人资料/);
});

test('PR03 confirmation exposes the exact saved content and metadata, direct revision identity and unknowns', async () => {
  const { PersonalRetentionConfirmation: Confirmation } = await ssr;
  const fields = { title: '旧稿标题', category: '', body: '原修订的准确正文', source: '', owner: '', scope: '', effectiveTime: '', sourceFileId: null };
  const request = { operationId: 'operation-fixed', expectedRevision: 4, target: { type: 'revision', revisionId: 'revision-old', expectedBodySha256: 'b'.repeat(64) }, metadata: { kind: 'experience', aliases: ['原别名'], caution: '原提醒', sourceRefs: [] }, personalLabel: null };
  const markup = renderToStaticMarkup(createElement(Confirmation, { fields, request }));
  for (const text of ['旧稿标题', '原修订的准确正文', '原别名', '原提醒', 'revision-old', '未知', '人工记录，外部原文未记录']) assert.ok(markup.includes(text));
  assert.match(markup, /不代表事实已证实/);
  assert.doesNotMatch(markup, /新工作稿|latest/);
});

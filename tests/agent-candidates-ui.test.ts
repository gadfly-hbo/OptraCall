import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ssr = (async () => {
  const directory = new URL('../.local/fourbase-modules/m31/implementation/ui/', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  await build({ input: 'candidate-ui-test-entry', external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}candidate-ui-ssr.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [{
    name: 'candidate-ui-test-entry',
    resolveId(id) { if (id === 'candidate-ui-test-entry') return '\0candidate-ui-test-entry'; if (id.endsWith('.css')) return `\0empty-css:${id}.js`; },
    load(id) {
      if (id.startsWith('\0empty-css:')) return '';
      if (id === '\0candidate-ui-test-entry') return `export { AgentCandidateResults, AgentCandidateContent, candidateActionAvailability } from ${JSON.stringify(new URL('../src/host/ui/AgentCandidatesPanel.tsx', import.meta.url).pathname)}; export { PersonalMaterialsPage } from ${JSON.stringify(new URL('../src/host/ui/PersonalMaterialsPage.tsx', import.meta.url).pathname)};`;
    },
  }] });
  // @ts-expect-error Isolated test artifact is built above; it is not a product import.
  return import('../.local/fourbase-modules/m31/implementation/ui/candidate-ui-ssr.mjs');
})();

test('AC04 public personal page offers saved candidates and human materials by default, without an approval queue', async () => {
  const { PersonalMaterialsPage } = await ssr;
  const markup = renderToStaticMarkup(createElement(PersonalMaterialsPage));
  assert.match(markup, /aria-pressed="true"[^>]*>全部资料<\/button>/);
  for (const label of ['重点收藏', '原有人工资料', '已排除', '异常历史']) assert.ok(markup.includes(label), label);
  assert.match(markup, /不自动送入新任务/);
  assert.doesNotMatch(markup, /待审批|每天填写|每日必填/);
});

const target = { projectId: 'project', taskId: 'task', originSessionId: 'origin', entryId: 'entry', toolCallId: 'tool', expectedDetailsSha256: 'a'.repeat(64) };
const details = { schemaVersion: 1, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: 'project', taskId: 'task', sessionId: 'origin', requestId: 'request', toolCallId: 'tool' }, createdAt: '2026-11-03T03:00:00.000Z', content: { kind: 'experience', title: '<准确候选>', bodyMd: '原生准确正文 & 边界说明', aliases: ['别名'], scope: '业务范围', caution: '样本有限' }, sourceRefs: [] };
const availableRow = { ref: target, details, status: 'available', reason: null, parentState: 'cancelled', locations: [{ sessionId: 'fork', entryId: 'entry', savedPath: 'other' }], control: null };
const note = (revision: number, text: string) => ({ operationId: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`, target, action: 'correct', note: text, targetRevision: revision, createdAt: '2025-10-01T03:01:00.000Z' });

test('AC03/06 saved cancelled/other-path candidates retain original declaration, independent parent label and exact origin', async () => {
  const { AgentCandidateResults: Results, AgentCandidateContent: Content } = await ssr;
  const result = { rows: [availableRow], issues: [], nextCursor: null, partial: false, controlsAvailable: true };
  const list = renderToStaticMarkup(createElement(Results, { result, onOpen() {} }));
  for (const value of ['&lt;准确候选&gt;', '原生准确正文 &amp; 边界说明', '父任务已取消', '其它已保存路径', '未人工确认', '已记录']) assert.ok(list.includes(value), value);
  const content = renderToStaticMarkup(createElement(Content, { row: availableRow }));
  for (const value of ['业务依据尚未补充', 'originSessionId', 'expectedDetailsSha256', '不证明业务真实', '业务范围', '样本有限']) assert.ok(content.includes(value), value);
  assert.doesNotMatch(content, /等待父任务完成|已引用|已学会/);
});

test('AC05 original declaration and newest-first independent human opinions remain distinct', async () => {
  const { AgentCandidateContent: Content } = await ssr;
  const row = { ...availableRow, control: { target, targetRevision: 3, bookmarked: true, excluded: true, notes: [note(3, '新意见独立追加'), note(2, '旧意见仍保留')] } };
  const content = renderToStaticMarkup(createElement(Content, { row }));
  assert.ok(content.indexOf('新意见独立追加') < content.indexOf('旧意见仍保留'));
  for (const value of ['原生准确正文', '已排除此条及其分支副本', '未因收藏、纠正或恢复变成已确认事实']) assert.ok(content.includes(value), value);
});

test('AC07 native unread never leaks cached payload/time/parent/path, while governed exact refs allow limited controls', async () => {
  const { AgentCandidateResults: Results, AgentCandidateContent: Content, candidateActionAvailability: availability } = await ssr;
  const state = { target, targetRevision: 3, bookmarked: true, excluded: false, notes: [note(3, '人的旧意见可读')] };
  const unknown = { ...availableRow, status: 'unknown', reason: 'native_missing', control: state };
  const content = renderToStaticMarkup(createElement(Content, { row: unknown }));
  const list = renderToStaticMarkup(createElement(Results, { result: { rows: [unknown], issues: [], nextCursor: null, partial: false, controlsAvailable: true }, onOpen() {} }));
  for (const markup of [content, list]) for (const secret of ['准确候选', '原生准确正文', '样本有限', '业务范围', '父任务已取消', '其它已保存路径', '2026/11/3']) assert.ok(!markup.includes(secret), secret);
  assert.ok(content.includes('人的旧意见可读'));
  assert.deepEqual(availability(unknown, true), { bookmark: false, correct: false, unbookmark: true, exclude: true, restore: true });
  assert.deepEqual(availability({ ...unknown, control: null }, true), { bookmark: false, correct: false, unbookmark: false, exclude: false, restore: false });
  assert.deepEqual(availability({ ...unknown, status: 'anomaly' }, true), { bookmark: false, correct: false, unbookmark: false, exclude: false, restore: false });
  assert.deepEqual(availability(availableRow, false), { bookmark: false, correct: false, unbookmark: false, exclude: false, restore: false });
});

test('AC07 first unread only reports file-level UNKNOWN without guessing identities or empty-library truth', async () => {
  const { AgentCandidateResults: Results } = await ssr;
  const markup = renderToStaticMarkup(createElement(Results, { result: { rows: [], issues: [{ file: 'native.jsonl', code: 'native_corrupt' }], nextCursor: null, partial: true, controlsAvailable: true }, onOpen() {} }));
  assert.match(markup, /native\.jsonl/);
  assert.match(markup, /未能核对完整范围/);
  assert.doesNotMatch(markup, /originSessionId|expectedDetailsSha256|当前范围没有匹配资料/);
});

test('AC07 human intent survives reopening and exact request errors never trigger a transport retry', async () => {
  const { agentCandidatesApi, createCandidateOperationJournal } = await import('../src/host/ui/agent-candidates-client.ts');
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const request = { operationId: '00000000-0000-4000-8000-000000000004', target, action: 'bookmark' as const, note: null, expectedTargetRevision: 3 };
  const journal = createCandidateOperationJournal(storage); journal.remember(request);
  const reopened = createCandidateOperationJournal(storage);
  assert.deepEqual(reopened.entries(), [request]);
  assert.throws(() => reopened.remember({ ...request, expectedTargetRevision: 4 }), /原请求/);
  const original = globalThis.fetch, calls: { path: string; body: unknown }[] = [];
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), body: init?.body }); throw new Error('ack lost'); };
  try {
    await assert.rejects(() => agentCandidatesApi.control(request), /ack lost/);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(String(calls[0]?.body)), request);
    assert.deepEqual(reopened.entries(), [request]);
  } finally { globalThis.fetch = original; }
  reopened.settle('unrelated'); assert.equal(reopened.entries().length, 1);
  reopened.settle(request.operationId); assert.deepEqual(reopened.entries(), []);
});

test('AC07 unreadable browser original-intent bytes remain preserved and block rather than reset', async () => {
  const { createCandidateOperationJournal } = await import('../src/host/ui/agent-candidates-client.ts');
  let raw = '{broken'; const before = raw;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = ''; } };
  const journal = createCandidateOperationJournal(storage);
  assert.throws(() => journal.entries(), /不可读/); assert.equal(raw, before);
});

test('AC04/07 API preserves explicit filters, exact read identity, correction without CAS, and original operation lookup', async () => {
  const { agentCandidatesApi } = await import('../src/host/ui/agent-candidates-client.ts');
  const original = globalThis.fetch, calls: { path: string; method?: string; input?: unknown }[] = [];
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), method: init?.method, input: init?.body ? JSON.parse(String(init.body)) : undefined }); return new Response('{}', { status: 200 }); };
  try {
    await agentCandidatesApi.lookup({ query: '含 空格', includeBody: true, view: 'excluded', parentState: 'cancelled', savedPath: 'other', cursor: 'next+opaque', pageSize: 50 });
    const params = new URL(calls[0]!.path, 'http://localhost').searchParams;
    for (const [key, value] of Object.entries({ query: '含 空格', includeBody: 'true', view: 'excluded', parentState: 'cancelled', savedPath: 'other', cursor: 'next+opaque', pageSize: '50' })) assert.equal(params.get(key), value);
    await agentCandidatesApi.read(target);
    assert.deepEqual(calls[1]?.input, { ref: target });
    const correction = { operationId: '00000000-0000-4000-8000-000000000009', target, action: 'correct' as const, note: '独立的人类意见' };
    await agentCandidatesApi.control(correction);
    assert.deepEqual(calls[2]?.input, correction);
    assert.ok(!Object.hasOwn(calls[2]!.input as object, 'expectedTargetRevision'));
    await agentCandidatesApi.operation(correction.operationId);
    assert.equal(calls[3]?.method, 'GET');
    assert.ok(calls[3]?.path.endsWith(`/operations/${correction.operationId}`));
  } finally { globalThis.fetch = original; }
});

test('AC07 old receipts refresh current governance first; unread native keeps latest flags/revision and no cached body', async () => {
  const { readCandidateAfterOperation } = await import('../src/host/ui/agent-candidates-client.ts');
  const oldState = { target, targetRevision: 1, bookmarked: true, excluded: true, notes: [] };
  const latest = { target, targetRevision: 4, bookmarked: false, excluded: false, notes: [] };
  const calls: string[] = [];
  const operation = { operationId: '00000000-0000-4000-8000-000000000009', target, action: 'restore' as const, note: null, createdAt: '2026-11-03T03:01:00.000Z', targetRevision: 2 };
  const row = { ...availableRow, status: 'available' as const, details: { ...details, schemaVersion: 1 as const, type: 'optracall.agent-candidate' as const, claim: 'agent-generated-unconfirmed' as const, content: { ...details.content, kind: 'experience' as const } }, parentState: 'cancelled' as const, locations: [{ sessionId: 'fork', entryId: 'entry', savedPath: 'other' as const }], control: oldState };
  const result = await readCandidateAfterOperation({ operation: async () => { calls.push('current governance'); return { storeId: 'store', event: operation, state: latest }; }, read: async () => { calls.push('exact native'); throw new Error('source missing'); } }, row, operation.operationId);
  assert.deepEqual(calls, ['current governance', 'exact native']);
  assert.deepEqual(result.control, latest);
  assert.equal(result.details, null); assert.equal(result.status, 'unknown');
  assert.equal(result.parentState, 'unknown'); assert.deepEqual(result.locations, []);
  await assert.rejects(() => readCandidateAfterOperation({ operation: async () => ({ storeId: 'store', event: null, state: null }), read: async () => row }, row, operation.operationId), /原操作回执尚未核对/);
});

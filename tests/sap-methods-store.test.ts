import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import type { SapMethodSaveInput } from '../extensions/business-plugins/metric-factory/methods/types.ts';

const draft = (overrides: Partial<SapMethodSaveInput> = {}): SapMethodSaveInput => ({
  requestId: randomUUID(), origin: 'other', title: '复购观察窗口检查',
  content: { conditions: '比较新客复购时', logic: '先核对观察窗口是否完整。', judgment: '', limits: '' },
  sources: [], ...overrides,
});
const fixture = (t: test.TestContext) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-sap-methods-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, store: createSapMethodStore(root) };
};

test('saving a method survives reopen as an unpublished exact version and is absent from Agent supply', t => {
  const { root, store } = fixture(t);
  const saved = store.save(draft());
  assert.equal(saved.version.version, 1);
  const reopened = createSapMethodStore(root);
  assert.equal(reopened.read(saved.method.id, 1).versions[0]?.content.logic, '先核对观察窗口是否完整。');
  assert.equal(reopened.read(saved.method.id).publishedVersion, null);
  assert.deepEqual(reopened.listPublished(), []);
});


test('only an explicitly published exact version is supplied and publishing preserves its saved content', t => {
  const { root, store } = fixture(t);
  const saved = store.save(draft());
  assert.throws(() => store.getPublished(saved.method.id, 1), { code: 'METHOD_NOT_PUBLISHED' });
  store.publish(saved.method.id, { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 });
  const reopened = createSapMethodStore(root);
  assert.equal(reopened.listPublished()[0]?.publishedVersion, 1);
  assert.deepEqual(reopened.getPublished(saved.method.id, 1).version, saved.version);
});

test('saving v2 keeps published v1 fixed and stale editors cannot create another version', t => {
  const { store } = fixture(t);
  const first = store.save(draft());
  store.publish(first.method.id, { requestId: randomUUID(), version: 1, expectedSha256: first.version.contentSha256 });
  const second = store.save(draft({ methodId: first.method.id, baseVersion: 1, title: '改进后的窗口检查' }));
  assert.equal(second.method.id, first.method.id);
  assert.equal(second.method.latestVersion, 2);
  assert.equal(second.method.publishedVersion, 1);
  assert.equal(store.listPublished()[0]?.title, first.version.title);
  assert.deepEqual(store.getPublished(first.method.id, 1).version, first.version);
  assert.throws(() => store.getPublished(first.method.id, 2), { code: 'METHOD_NOT_PUBLISHED' });
  assert.throws(() => store.save(draft({ methodId: first.method.id, baseVersion: 1 })), { code: 'METHOD_VERSION_CONFLICT' });
  assert.equal(store.read(first.method.id).versions.length, 2);
});

test('human library search finds saved conditions and method content without searching historical drafts', t => {
  const { store } = fixture(t);
  const first = store.save(draft({ title: 'Stable title', content: { conditions: 'Cohort eligibility', logic: 'Normalize observation window', judgment: 'Defer uncertain comparison', limits: 'Sparse sample' } }));
  for (const query of [' cohort ', 'OBSERVATION', 'uncertain', 'sparse']) assert.equal(store.list({ query })[0]?.id, first.method.id);
  store.save(draft({ methodId: first.method.id, baseVersion: 1, title: 'Latest title', content: { conditions: '', logic: 'Current definition', judgment: '', limits: '' } }));
  assert.equal(store.list({ query: 'observation' }).length, 0);
  assert.equal(store.list({ query: 'current' })[0]?.id, first.method.id);
});

test('editing a historical version records its exact origin while CAS protects the current saved head', t => {
  const { store } = fixture(t);
  const first = store.save(draft());
  store.publish(first.method.id, { requestId: randomUUID(), version: 1, expectedSha256: first.version.contentSha256 });
  store.save(draft({ methodId: first.method.id, baseVersion: 1, title: 'New draft v2' }));
  const input = draft({ methodId: first.method.id, baseVersion: 2, content: { ...first.version.content, limits: 'Edit explicitly based on v1' }, relation: { kind: 'revision', target: { methodId: first.method.id, version: 1 }, reason: 'Revise selected historical content' } });
  const third = store.save(input);
  assert.equal(third.version.version, 3);
  assert.equal(third.version.relation?.target.version, 1);
  assert.deepEqual(store.getPublished(first.method.id, 1).version, first.version);
  assert.throws(() => store.save({ ...input, requestId: randomUUID() }), { code: 'METHOD_VERSION_CONFLICT' });
  assert.throws(() => store.save({ ...input, baseVersion: 3, requestId: randomUUID(), relation: { ...input.relation!, target: { methodId: first.method.id, version: 77 } } }), { code: 'METHOD_VERSION_NOT_FOUND' });
});

test('same save request safely replays after reopen and a different payload cannot reuse its identity', t => {
  const { root, store } = fixture(t);
  const input = draft();
  const first = store.save(input);
  const reopened = createSapMethodStore(root);
  const replay = reopened.save(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.method.id, first.method.id);
  assert.equal(reopened.list().length, 1);
  assert.throws(() => reopened.save({ ...input, title: '同请求的不同内容' }), { code: 'METHOD_REQUEST_CONFLICT' });
  const publishedRequest = { requestId: randomUUID(), version: 1, expectedSha256: first.version.contentSha256 };
  reopened.publish(first.method.id, publishedRequest);
  assert.equal(createSapMethodStore(root).publish(first.method.id, publishedRequest).replayed, true);
  assert.throws(() => reopened.publish(first.method.id, { ...publishedRequest, expectedSha256: '0'.repeat(64) }), { code: 'METHOD_REQUEST_CONFLICT' });
});


test('confirmed errors stop default supply immediately while a correction still needs publication', t => {
  const { store } = fixture(t);
  const first = store.save(draft());
  store.publish(first.method.id, { requestId: randomUUID(), version: 1, expectedSha256: first.version.contentSha256 });
  const correction = store.save(draft({ methodId: first.method.id, baseVersion: 1, content: { ...first.version.content, limits: '须检查完整观察窗口。' }, relation: { kind: 'correction', target: { methodId: first.method.id, version: 1 }, reason: '补上原方法遗漏的可比性条件' } }));
  const request = { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed' as const, note: '旧版遗漏可比性条件', replacement: { methodId: first.method.id, version: 2 } };
  const marked = store.markIssue(first.method.id, request);
  assert.equal(marked.governanceRevision, 1);
  assert.deepEqual(store.listPublished(), []);
  assert.equal(store.getPublished(first.method.id, 1).issue?.status, 'confirmed');
  assert.throws(() => store.getPublished(first.method.id, 2), { code: 'METHOD_NOT_PUBLISHED' });
  assert.equal(store.markIssue(first.method.id, request).governanceRevision, 1);
  store.publish(first.method.id, { requestId: randomUUID(), version: 2, expectedSha256: correction.version.contentSha256 });
  assert.equal(store.listPublished()[0]?.publishedVersion, 2);
  assert.equal(store.getPublished(first.method.id, 1).issue?.note, '旧版遗漏可比性条件');
  assert.deepEqual(store.getPublished(first.method.id, 1).version, first.version);
});

test('IR methods require a fixed Session source and method relations must locate an existing exact version', t => {
  const { store } = fixture(t);
  assert.throws(() => store.save(draft({ origin: 'ir' })), { code: 'METHOD_SESSION_SOURCE_REQUIRED' });
  const fixedSource = { type: 'session' as const, label: '源分析会话', ref: 'project/p1/task/t1/session/s1/cutoff/e8', version: 'e8', sha256: 'a'.repeat(64) };
  const original = store.save(draft({ origin: 'ir', sources: [fixedSource] }));
  assert.equal(original.version.sources[0]?.sha256, 'a'.repeat(64));
  assert.throws(() => store.save(draft({ relation: { kind: 'derived', target: { methodId: randomUUID(), version: 1 }, reason: '从准确来源派生' } })), { code: 'METHOD_NOT_FOUND' });
  const derived = store.save(draft({ relation: { kind: 'derived', target: { methodId: original.method.id, version: 1 }, reason: '用于不同问题，保持并存' } }));
  assert.notEqual(derived.method.id, original.method.id);
  assert.deepEqual(derived.version.relation?.target, { methodId: original.method.id, version: 1 });
  assert.deepEqual(store.read(original.method.id).versions[0]?.sources, [fixedSource]);
});


test('malformed method metadata is preserved and cannot be overwritten by a new save; old SAP files stay untouched', t => {
  const { root, store } = fixture(t);
  const metricIndex = '{"version":1,"entries":[]}\n';
  writeFileSync(path.join(root, 'index.json'), metricIndex);
  mkdirSync(path.join(root, 'old-package'));
  writeFileSync(path.join(root, 'old-package', '1.0.0.sap.yaml'), 'synthetic old SAP bytes\n');
  store.save(draft());
  assert.equal(readFileSync(path.join(root, 'index.json'), 'utf8'), metricIndex);
  assert.equal(readFileSync(path.join(root, 'old-package', '1.0.0.sap.yaml'), 'utf8'), 'synthetic old SAP bytes\n');
  const bad = JSON.stringify({ schemaVersion: 1, methods: [{ id: randomUUID(), origin: 'other', versions: [], publications: [], governance: [] }] });
  writeFileSync(path.join(store.root, 'index.json'), bad);
  assert.throws(() => store.save(draft()), { code: 'METHOD_STORE_CORRUPT' });
  assert.equal(readFileSync(path.join(store.root, 'index.json'), 'utf8'), bad);
});

test('saving unchanged content associates the existing version instead of generating another one', t => {
  const { store } = fixture(t);
  const first = store.save(draft());
  const same = store.save(draft({ methodId: first.method.id, baseVersion: 1 }));
  assert.equal(same.version.version, 1);
  assert.equal(same.method.versions.length, 1);
  assert.equal(same.replayed, true);
  assert.equal(store.operation(same.version.requestId)?.status, 'committed');
});


test('an interrupted first save retains a pending identity and same-request recovery never creates a second method', t => {
  const { root, store } = fixture(t);
  const input = draft();
  const originalRename = fs.renameSync;
  const fault = t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
    if (String(args[1]) === path.join(store.root, 'index.json')) throw Object.assign(new Error('synthetic index I/O failure'), { code: 'EIO' });
    return originalRename(...args);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => store.save(input), { code: 'EIO' }); }
  finally { fault.mock.restore(); syncBuiltinESMExports(); }
  const pending = createSapMethodStore(root).operation(input.requestId);
  assert.equal(pending?.status, 'pending');
  assert.deepEqual(store.list(), []);
  const recovered = createSapMethodStore(root).save(input);
  assert.equal(recovered.method.id, pending?.methodId);
  assert.equal(recovered.version.version, 1);
  assert.equal(store.list().length, 1);
  assert.equal(store.operation(input.requestId)?.status, 'committed');
});

test('a publication whose acknowledgement fails is read back as committed without rewriting the method', t => {
  const { root, store } = fixture(t);
  const saved = store.save(draft());
  const input = { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 };
  const originalRename = fs.renameSync;
  const fault = t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
    originalRename(...args);
    if (String(args[1]) === path.join(store.root, 'index.json')) throw Object.assign(new Error('synthetic post-commit acknowledgement failure'), { code: 'EIO' });
  });
  syncBuiltinESMExports();
  try { assert.throws(() => store.publish(saved.method.id, input), { code: 'EIO' }); }
  finally { fault.mock.restore(); syncBuiltinESMExports(); }
  const reopened = createSapMethodStore(root);
  assert.equal(reopened.operation(input.requestId)?.status, 'committed');
  assert.equal(reopened.publish(saved.method.id, input).replayed, true);
  assert.equal(reopened.read(saved.method.id).publications.length, 1);
  assert.deepEqual(reopened.getPublished(saved.method.id, 1).version, saved.version);
});


test('operation readback rejects a symlinked library root instead of reading outside the supplied root', t => {
  const { root, store } = fixture(t);
  const input = draft();
  store.save(input);
  const alias = path.join(root, 'symlinked-library');
  symlinkSync(root, alias, 'dir');
  const originalOpen = fs.openSync;
  const boundary = t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    if (String(args[0]).startsWith(alias + path.sep)) throw Object.assign(new Error('read outside trusted root'), { code: 'UNAUTHORIZED_READ' });
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => createSapMethodStore(alias).operation(input.requestId), { code: 'METHOD_STORE_UNSAFE' }); }
  finally { boundary.mock.restore(); syncBuiltinESMExports(); }
});

test('damaged operation metadata is reported as corrupt instead of treated as a completed request', t => {
  const { store } = fixture(t);
  const input = draft();
  store.save(input);
  const operationFile = path.join(store.root, 'operations', `${input.requestId}.json`);
  const damaged = JSON.parse(readFileSync(operationFile, 'utf8'));
  delete damaged.recordedAt;
  writeFileSync(operationFile, JSON.stringify(damaged));
  assert.throws(() => store.operation(input.requestId), { code: 'METHOD_STORE_CORRUPT' });
  assert.throws(() => store.save(input), { code: 'METHOD_STORE_CORRUPT' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import type { SemanticContextCallContext } from '../src/agent/semantic-context.ts';
import { studioExtractions, studioExtractionId } from '../src/host/studio-extractions.ts';
import { digest } from '../extensions/business-plugins/studio/validation.ts';
const configuration = { id: 'synthetic-model', revision: 1, name: '合成配置', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
const context = (): SemanticContextCallContext => ({ signal: new AbortController().signal, requestId: randomUUID(), sessionId: 'synthetic-session', toolCallId: randomUUID(), assertCurrent() {} });
async function fixture(t: any, extract: () => Promise<unknown>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-extractions-')), dataRoot = path.join(root, 'private');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot), store = new StudioStore(dataRoot);
  const project = await projects.create({ name: '合成建设', configuration }), task = await projects.createTask(project.id, { name: '建设' });
  const usingProject = await projects.create({ name: '合成使用', configuration }), usingTask = await projects.createTask(usingProject.id, { name: '使用' });
  const material = await enterpriseMaterials.create({ title: '合成退款制度', body: '成功退款归原销售门店' });
  const enabled = await enterpriseMaterials.enable(material.material.id, material.material.version);
  const index = await enterpriseMaterials.referenceIndex({ readOnly: true }), revision = index.materials.find(m => m.materialId === material.material.id)!.revisions[0];
  const ref = { authority: 'enterprise' as const, id: material.material.id, version: revision.revisionId, sha256: revision.bodySha256, locator: index.storeId };
  const system = store.create({ name: '合成体系', projectId: project.id, taskId: task.id, topicTitle: '销售退款', goal: '完整候选传输', materials: [{ ref, saved: true, readable: true, note: '合成材料' }] });
  store.linkUsageProject(system.id, usingProject.id, usingTask.id);
  let mutation = Promise.resolve();
  const mutate = <T>(operation: () => T | Promise<T>): Promise<T> => { const result = mutation.then(operation); mutation = result.then(() => {}, () => {}); return result; };
  const options = { dataRoot, projects, enterpriseMaterials, readBody: async () => ({}), mutate, running: () => false, closing: () => false, readTaskReply: async () => { throw new Error('No model/native session in transport test'); }, extract };
  const feature = createStudioFeature(options);
  return { root, dataRoot, options, projects, project, task, system, ref, material, enabled, enterpriseMaterials, store, feature, construction: feature.port(project.id, task.id), ordinary: feature.port(usingProject.id, usingTask.id) };
}
const result = (body = '合成实体') => ({ component: { name: 'semantica', version: '0.7.0' }, source: { id: 'synthetic-source', revision: '1', sha256: 'b'.repeat(64) }, entities: [{ text: body, label: 'business', confidence: 0.8, actualMethod: 'official-synthetic' }], relations: [], calls: [{ kind: 'entities', format: 'typed', state: 'completed' }], failures: [], limitations: ['合成候选，未做专业验收'], candidateNeedsReview: true });
const parsed = (value: { content: { text: string }[] }) => JSON.parse(value.content[0]!.text);

test('completed large extraction returns a durable candidate reference instead of losing its result to the reply limit', async t => {
  const full = result('合成实体'.repeat(12_000)), f = await fixture(t, async () => full);
  const response = await f.construction('extract', { payload: { ref: f.ref } }, context()), value = parsed(response);
  assert.match(value.extractionId, /^[a-f0-9-]{36}$/); assert.equal(value.transport.complete, false);
  assert.equal(value.counts.entities, 1); assert.equal(value.counts.relations, 0);
  assert.ok(response.content[0]!.text.length < 30_000);
  assert.equal(f.store.get(f.system.id).assets.length, 0); assert.equal(f.store.get(f.system.id).publications.length, 0);
});

async function collect(f: Awaited<ReturnType<typeof fixture>>, extractionId: string, section: string) {
  let start = 0, text = '', pages = 0;
  for (;;) {
    const response = await f.construction('read-extraction', { payload: { extractionId, section, start, length: 20_000 } }, context()), value = parsed(response);
    assert.ok(response.content[0]!.text.length < 30_000); assert.equal(value.range.start, start); assert.equal(value.range.unit, 'unicode-codepoints');
    assert.equal(Array.from(value.text).length, value.range.end - start); assert.equal(value.complete, start === 0 && value.range.end === value.range.total);
    text += value.text; pages++;
    if (!value.continuation) { assert.equal(value.range.end, value.range.total); break; }
    assert.ok(value.range.end > start); start = value.continuation.start;
  }
  return { text, pages };
}
test('exact single-item and metadata JSON survive escaping and codepoint pagination, including original provenance and owner', async t => {
  const full = { ...result('单条"\\\n😺'.repeat(6_000)), failures: ['"\\\n😺'.repeat(9_000)], fallback: { actualMethod: 'typed-failed-then-structured', provenance: '精确保留' }, owner: 'worker-metadata-not-host-owner' };
  const f = await fixture(t, async () => full), value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, context()));
  const all = await collect(f, value.extractionId, 'result'); assert.ok(all.pages > 2); assert.equal(all.text, JSON.stringify(full));
  assert.equal(value.resultSha256, createHash('sha256').update(all.text).digest('hex'));
  const metadata = JSON.parse((await collect(f, value.extractionId, 'metadata')).text);
  assert.deepEqual(metadata.owner, { systemId: f.system.id, projectId: f.project.id, taskId: f.task.id });
  assert.deepEqual(metadata.sourceRef, f.ref); assert.deepEqual(metadata.resultMetadata.failures, full.failures); assert.deepEqual(metadata.resultMetadata.fallback, full.fallback); assert.equal(metadata.resultMetadata.owner, full.owner);
  assert.deepEqual(JSON.parse((await collect(f, value.extractionId, 'entities')).text), full.entities);
  assert.deepEqual(JSON.parse((await collect(f, value.extractionId, 'relations')).text), full.relations);
});

test('small results retain existing fields; exact completed tool-call recovery and reopen never replay the extractor', async t => {
  let calls = 0; const full = result(), f = await fixture(t, async () => { calls++; return full; }), ctx = context();
  const value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, ctx));
  for (const key of ['entities', 'relations', 'component', 'candidateNeedsReview']) assert.deepEqual(value[key], full[key as keyof typeof full]);
  const reopened = createStudioFeature({ ...f.options, extract: undefined }).port(f.project.id, f.task.id);
  assert.equal(parsed(await reopened('extract', { payload: { ref: f.ref } }, ctx)).extractionId, value.extractionId); assert.equal(calls, 1);
  const listing = parsed(await reopened('read-extraction', {}, context())); assert.equal(listing.items.length, 1); assert.equal(listing.items[0].extractionId, value.extractionId);
  assert.deepEqual(JSON.parse(parsed(await reopened('read-extraction', { payload: { extractionId: value.extractionId, section: 'result' } }, context())).text), full);
});

test('receipt reads remain construction-only and source revocation cannot resurrect an old candidate', async t => {
  const f = await fixture(t, async () => result()), value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, context()));
  await assert.rejects(() => f.ordinary('read-extraction', { systemId: f.system.id, payload: { extractionId: value.extractionId } }, context()), /studio_construction_only/);
  const other = f.store.create({ name: '不同体系', projectId: f.project.id, taskId: randomUUID(), topicTitle: '其他', goal: '隔离' });
  // Even a same-project ordinary task cannot claim the construction owner by selecting its system id.
  await assert.rejects(() => f.construction('read-extraction', { systemId: other.id, payload: { extractionId: value.extractionId } }, context()), /studio_construction_only/);
  await f.enterpriseMaterials.disable(f.material.material.id, f.enabled.material.version);
  await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId, section: 'result' } }, context()), /studio_source_unavailable/);
  assert.equal(parsed(await f.construction('read-extraction', {}, context())).items.length, 0);
});

test('revocation after the last asynchronous source check cannot publish a late technical result', async t => {
  const f = await fixture(t, async () => result()), controller = new AbortController(); let current = true, entered!: () => void, release!: () => void, checks = 0;
  const blocked = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; }), original = f.feature.sources.validate.bind(f.feature.sources);
  f.feature.sources.validate = async (...args) => { await original(...args); if (++checks === 2) { entered(); await blocked; } };
  const ctx = { ...context(), signal: controller.signal, assertCurrent() { if (!current) throw new Error('synthetic-owner-revoked'); } };
  const pending = f.construction('extract', { payload: { ref: f.ref } }, ctx).then(() => null, error => error as Error);
  await reached; current = false; controller.abort(new Error('synthetic-cancelled')); release();
  assert.match((await pending)?.message ?? 'unexpected-success', /synthetic-owner-revoked|synthetic-cancelled/);
  assert.equal(parsed(await f.construction('read-extraction', {}, context())).items.length, 0);
  const directory = path.join(f.dataRoot, 'studio-extractions', f.system.id); assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(f.store.get(f.system.id).assets.length, 0);
});

test('startup and empty receipt list are read-only; 8MiB bound does not leave a result or business asset', async t => {
  const f = await fixture(t, async () => result('x'.repeat(8 * 1024 * 1024)));
  await assert.rejects(() => fs.lstat(path.join(f.dataRoot, 'studio-extractions')), { code: 'ENOENT' });
  assert.equal(parsed(await f.construction('read-extraction', {}, context())).items.length, 0);
  await assert.rejects(() => fs.lstat(path.join(f.dataRoot, 'studio-extractions')), { code: 'ENOENT' });
  await assert.rejects(() => f.construction('extract', { payload: { ref: f.ref } }, context()), /studio_extraction_too_large/);
  await assert.rejects(() => fs.lstat(path.join(f.dataRoot, 'studio-extractions')), { code: 'ENOENT' });
  assert.equal(f.store.get(f.system.id).assets.length, 0);
});

test('receipt listing pages preserve exact summary counts and selection without exposing full candidates or paths', async t => {
  const f = await fixture(t, async () => result('private-synthetic-candidate'.repeat(2_000))), ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push(parsed(await f.construction('extract', { payload: { ref: f.ref } }, context())).extractionId);
  const first = await f.construction('read-extraction', { payload: { length: 5 } }, context()), value = parsed(first);
  assert.equal(value.items.length, 5); assert.equal(value.range.total, 6); assert.equal(value.range.unit, 'receipts'); assert.ok(first.content[0]!.text.length < 30_000);
  assert.doesNotMatch(first.content[0]!.text, /private-synthetic-candidate|studio-extractions|private\/|\.json/);
  const second = parsed(await f.construction('read-extraction', { payload: value.continuation }, context()));
  assert.equal(second.items.length, 1); assert.equal(second.range.start, 5); assert.equal(second.continuation, null);
  assert.deepEqual([...value.items, ...second.items].map(item => item.extractionId).sort(), ids.sort());
  await assert.rejects(() => f.construction('read-extraction', { payload: { start: 7 } }, context()), /invalid_studio_extraction_range/);
});

test('long escaped source identities shrink metadata listing pages by final serialized budget', async t => {
  const f = await fixture(t, async () => result());
  // Qualification is deliberately injected here solely to isolate the transport budget at its public port.
  f.feature.sources.validate = async () => {};
  const ref = { ...f.ref, id: '\u0001'.repeat(1_000), version: '\u0002'.repeat(200) };
  for (let i = 0; i < 5; i++) await f.construction('extract', { payload: { ref } }, context());
  let start = 0, found = 0;
  for (;;) {
    const response = await f.construction('read-extraction', { payload: { start, length: 5 } }, context()), value = parsed(response);
    assert.ok(response.content[0]!.text.length < 30_000); assert.ok(value.items.length > 0 && value.items.length < 5); found += value.items.length;
    for (const item of value.items) assert.deepEqual(item.sourceIdentity, { authority: ref.authority, id: ref.id, version: ref.version, sha256: ref.sha256 });
    if (!value.continuation) break; start = value.continuation.start;
  }
  assert.equal(found, 5);
});

test('unsafe receipt symlink, hardlink, tampering, cross-owner and immutable overwrite are rejected', async t => {
  const f = await fixture(t, async () => result()), ctx = context(), value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, ctx));
  const owner = { systemId: f.system.id, projectId: f.project.id, taskId: f.task.id }, receipts = studioExtractions(f.dataRoot);
  const file = path.join(f.dataRoot, 'studio-extractions', f.system.id, `${value.extractionId}.json`), original = await fs.readFile(file);
  const staged = await receipts.stage(owner, f.ref, ctx, result('different-result'));
  try { assert.throws(() => staged.commit(() => {}), /studio_extraction_exists/); } finally { staged.discard(); }
  assert.deepEqual(await fs.readFile(file), original);
  await assert.rejects(() => receipts.read({ ...owner, taskId: randomUUID() }, value.extractionId), /studio_extraction_corrupt/);
  await fs.link(file, file + '.hardlink');
  await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId } }, context()), /studio_extraction_unsafe_or_corrupt/);
  await fs.unlink(file + '.hardlink');
  const moved = file + '.original'; await fs.rename(file, moved); await fs.symlink(moved, file);
  await assert.rejects(() => receipts.read(owner, value.extractionId), /studio_extraction_unsafe_or_corrupt/);
  await fs.unlink(file); await fs.rename(moved, file);
  const changed = JSON.parse(original.toString()); changed.result.entities[0].text = 'tampered'; await fs.writeFile(file, JSON.stringify(changed));
  await assert.rejects(() => receipts.read(owner, value.extractionId), /studio_extraction_corrupt/);
  await fs.writeFile(file, original);
  const parent = path.dirname(file), parentMoved = parent + '-original'; await fs.rename(parent, parentMoved); await fs.symlink(parentMoved, parent);
  await assert.rejects(() => receipts.read(owner, value.extractionId), /studio_extraction_unsafe_or_corrupt/);
  await fs.unlink(parent); await fs.rename(parentMoved, parent);
});

test('cancellation while official callback is returning leaves no receipt; read cancellation returns no body', async t => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, async () => { enter(); await blocked; return result(); }), controller = new AbortController(), ctx = { ...context(), signal: controller.signal };
  const pending = f.construction('extract', { payload: { ref: f.ref } }, ctx).then(() => null, error => error as Error);
  await entered; controller.abort(new Error('synthetic-cancelled-at-callback')); release();
  assert.match((await pending)?.message ?? 'unexpected-success', /synthetic-cancelled-at-callback/);
  assert.equal(await studioExtractions(f.dataRoot).read({ systemId: f.system.id, projectId: f.project.id, taskId: f.task.id }, studioExtractionId({ systemId: f.system.id, projectId: f.project.id, taskId: f.task.id }, ctx)), undefined);
  await assert.rejects(() => fs.lstat(path.join(f.dataRoot, 'studio-extractions')), { code: 'ENOENT' });
  const value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, context()));
  const original = f.feature.sources.validate.bind(f.feature.sources), readController = new AbortController();
  f.feature.sources.validate = async (...args) => { await original(...args); readController.abort(new Error('synthetic-read-cancelled-after-source-check')); };
  await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId, section: 'result' } }, { ...context(), signal: readController.signal }), /synthetic-read-cancelled-after-source-check/);
});

test('withdrawal in the projects.get await after a completed source check blocks new commit, read, same-call recovery and listing', async t => {
  for (const operation of ['commit', 'read', 'same-call', 'list'] as const) await t.test(operation, async t => {
    let calls = 0; const f = await fixture(t, async () => { calls++; return result('A-only candidate'); }), ctx = context();
    const original = operation === 'commit' ? undefined : parsed(await f.construction('extract', { payload: { ref: f.ref } }, ctx));
    const validate = f.feature.sources.validate.bind(f.feature.sources), get = f.projects.get.bind(f.projects), mutate = f.options.mutate; let checks = 0, withdrawn = false, inFinalAdmission = false;
    const targetChecks = operation === 'commit' || operation === 'same-call' ? 2 : 1;
    // A real authority change is injected at the final project await. Before repair it follows
    // the source check; after repair it precedes the last check inside the original Host gate.
    f.options.mutate = async operation => mutate(async () => { inFinalAdmission = true; try { return await operation(); } finally { inFinalAdmission = false; } });
    f.feature.sources.validate = async (...args) => { await validate(...args); checks++; };
    f.projects.get = async (...args) => {
      const project = await get(...args);
      if ((inFinalAdmission || checks >= targetChecks) && !withdrawn) { withdrawn = true; await f.enterpriseMaterials.disable(f.material.material.id, f.enabled.material.version); }
      return project;
    };
    const invoke = () => operation === 'read' ? f.construction('read-extraction', { payload: { extractionId: original.extractionId, section: 'result' } }, context()) : operation === 'list' ? f.construction('read-extraction', {}, context()) : f.construction('extract', { payload: { ref: f.ref } }, ctx);
    if (operation === 'list') assert.equal(parsed(await invoke()).items.length, 0);
    else await assert.rejects(invoke, /studio_source_unavailable/);
    assert.equal(withdrawn, true, 'the synthetic authority must actually withdraw during an await');
    if (operation === 'commit') assert.equal(parsed(await f.construction('read-extraction', {}, context())).items.length, 0);
    else assert.equal(calls, 1, 'completed extraction cannot be replayed to hide a revoked source');
  });
});

test('changing only sourceRef cannot authorize an old A candidate through enabled B', async t => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, async () => ({ ...result('A-only candidate'), source: { id: f.ref.id, revision: f.ref.version, sha256: 'b'.repeat(64), ref: f.ref } }));
  const value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, context()));
  const b = await f.enterpriseMaterials.create({ title: '启用B', body: 'Unrelated B' }); await f.enterpriseMaterials.enable(b.material.id, b.material.version);
  const index = await f.enterpriseMaterials.referenceIndex({ readOnly: true }), revision = index.materials.find(m => m.materialId === b.material.id)!.revisions[0];
  const bRef = { authority: 'enterprise' as const, id: b.material.id, version: revision.revisionId, sha256: revision.bodySha256, locator: index.storeId };
  await f.enterpriseMaterials.disable(f.material.material.id, f.enabled.material.version);
  const file = path.join(f.dataRoot, 'studio-extractions', f.system.id, `${value.extractionId}.json`), record = JSON.parse(await fs.readFile(file, 'utf8'));
  record.sourceRef = bRef; await fs.writeFile(file, JSON.stringify(record));
  for (const section of ['result', 'metadata']) await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId, section } }, context()), /studio_extraction_corrupt/);
  await assert.rejects(() => f.construction('read-extraction', {}, context()), /studio_extraction_corrupt/);
  // A checksum is not authentication. Even if that checksum is updated, unchanged
  // official source provenance must not be relabelled as another authority.
  const { receiptSha256: _old, ...contents } = record; record.receiptSha256 = digest(contents); await fs.writeFile(file, JSON.stringify(record));
  await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId, section: 'result' } }, context()), /studio_extraction_corrupt/);
});

test('receipt binding covers metadata fields and missing legacy digest without rewriting evidence', async t => {
  const f = await fixture(t, async () => result()), ctx = context(), value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, ctx));
  const file = path.join(f.dataRoot, 'studio-extractions', f.system.id, `${value.extractionId}.json`), original = await fs.readFile(file, 'utf8'), base = JSON.parse(original);
  const { receiptSha256, ...contents } = base; assert.equal(receiptSha256, digest(contents));
  for (const change of [
    (record: any) => { record.owner.taskId = randomUUID(); },
    (record: any) => { record.call.sessionId = 'different-session'; },
    (record: any) => { record.createdAt = '2025-01-01T00:00:00.000Z'; },
    (record: any) => { delete record.receiptSha256; },
    (record: any) => { record.schema = 1; },
  ]) {
    const record = JSON.parse(original); change(record); const bytes = JSON.stringify(record); await fs.writeFile(file, bytes);
    await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId } }, context()), /studio_extraction_corrupt/);
    assert.equal(await fs.readFile(file, 'utf8'), bytes, 'no checksum repair or evidence rewrite');
  }
  await fs.writeFile(file, original);
});

test('final qualification and result construction exclude an authority withdrawal queued through the existing Host mutation sequence', async t => {
  const f = await fixture(t, async () => result()), value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, context()));
  const validate = f.feature.sources.validate.bind(f.feature.sources); let queued: Promise<unknown> | undefined, withdrawn = false, admitted = false;
  f.feature.sources.validate = async (...args) => {
    await validate(...args);
    queued = f.options.mutate(async () => { withdrawn = true; return f.enterpriseMaterials.disable(f.material.material.id, f.enabled.material.version); });
    await Promise.resolve(); assert.equal(withdrawn, false, 'the real Host gate must still hold final admission'); admitted = true;
  };
  const response = await f.construction('read-extraction', { payload: { extractionId: value.extractionId, section: 'result' } }, context());
  assert.equal(admitted, true); assert.deepEqual(JSON.parse(parsed(response).text), result()); await queued; assert.equal(withdrawn, true);
  await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId } }, context()), /studio_source_unavailable/);
});

test('extraction range numeric strings follow the existing finite integer source-range rule without broad coercion', async t => {
  const f = await fixture(t, async () => result('合成'.repeat(20_000))), value = parsed(await f.construction('extract', { payload: { ref: f.ref } }, context()));
  const first = parsed(await f.construction('read-extraction', { payload: { extractionId: value.extractionId, section: 'result', start: '0', length: '12000' } }, context()));
  assert.equal(first.range.start, 0); assert.ok(first.range.end > 0);
  const listing = parsed(await f.construction('read-extraction', { payload: { start: '0', length: '1' } }, context())); assert.equal(listing.items[0].extractionId, value.extractionId);
  for (const payload of [{ start: 'NaN' }, { length: 'Infinity' }, { start: '-1' }, { length: '1.2' }, { length: '20001' }]) await assert.rejects(() => f.construction('read-extraction', { payload: { extractionId: value.extractionId, ...payload } }, context()), /invalid_studio_extraction_range/);
});

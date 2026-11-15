import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { DbLinkResults } from '../src/host/db-link-results.ts';
import { createDbLinkReviewBundles, type DbReviewBundleContext } from '../src/host/db-link-review-bundles.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-db-bundle-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://localhost' };
  const project = await projects.create({ name: '合成核算材料', configuration }), task = await projects.createTask(project.id, { name: '合成原任务' });
  const sourceOwner = { projectId: project.id, taskId: task.id, requestId: randomUUID(), operationId: randomUUID() };
  const results = new DbLinkResults({ dataRoot: projects.dataRoot, projectDirectory: () => project.rootPath, assertAccess: candidate => assert.equal(candidate.projectId, project.id) });
  const source = { connectionId: randomUUID(), connectionRevision: 2, engine: 'postgresql' as const, sourceIdentity: 'synthetic-server', sql: 'AUTHOR_SECRET_SQL select amount from orders where tenant = $1', parameters: [{ kind: 'text' as const, value: 'AUTHOR_SECRET_PARAMETER' }], observedObjects: ['public.orders'], declaredObjects: ['AUTHOR_DECLARED_RELATION'], unknownObjects: [], startedAt: new Date().toISOString(), session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read' } };
  const sink = await results.begin(sourceOwner, source, [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: 20, scale: 4 }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 200 }); await sink.append([['123.4500'], ['9007199254740993.0010']]); const receipt = await sink.complete('2');
  let revealed = false;
  const owner = { projectId: project.id, taskId: task.id, requestId: randomUUID(), reviewId: randomUUID() }, privateRoot = path.join(root, 'data', 'fixed-review-materials');
  const bundles = createDbLinkReviewBundles({ privateRoot, projects, results, assertOwner: candidate => { assert.equal(candidate.projectId, owner.projectId); assert.equal(candidate.taskId, owner.taskId); }, assertRevealAllowed: () => { if (!revealed) throw new Error('cold_basis_not_fixed'); } });
  const context: DbReviewBundleContext = { sourceOwner, maxTotalBytes: 100 * 1024 * 1024, assertCurrent: () => {} };
  return { project, projects, sourceOwner, results, receipt, source, owner, bundles, context, privateRoot, reveal: () => { revealed = true; } };
}

async function segmentedResult(f: Awaited<ReturnType<typeof fixture>>) {
  const bytes = Buffer.from('😀中文'.repeat(3));
  const sink = await f.results.begin(f.sourceOwner, f.source, [{ ordinal: 0, name: 'note', databaseType: 'text', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 16, chunkBytes: 10000 });
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: bytes.length, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  for (let offset = 0; offset < bytes.length; offset += 7) await sink.appendValueSegment(valueId, offset, bytes.subarray(offset, offset + 7).toString('base64'));
  await sink.append([[await sink.completeValue(valueId)]]);
  return { bytes, valueId, receipt: await sink.complete('1') };
}

test('db-link freezes one complete logical bundle and reads exact neutral rows without exposing author methods', async t => {
  const f = await fixture(t), input = { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' as const };
  const fixed = await f.bundles.freeze(f.owner, input, f.context);
  assert.equal(fixed.logicalItems, 1); assert.equal(fixed.neutralReceipt.dataNature, 'author-query-result'); assert.equal(fixed.neutralReceipt.extractionCoverage, 'unverified');
  assert.match(fixed.neutralReceipt.limitations.join(''), /派生|聚合/);
  const first = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', maxRows: 1, maxBytes: 2000 }, f.context);
  assert.deepEqual(first.rows, [['123.4500']]); assert.equal(first.coverage.complete, false); assert.equal(first.continuationStartRow, 1);
  assert.equal(JSON.stringify(first).includes('AUTHOR_SECRET'), false); assert.equal(JSON.stringify(first).includes('AUTHOR_DECLARED'), false);
  const second = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', startRow: first.continuationStartRow!, maxRows: 1, maxBytes: 2000 }, f.context);
  assert.deepEqual(second.rows, [['9007199254740993.0010']]); assert.equal(second.continuationStartRow, null);
  await fixed.assertUnchanged();
});

test('cold neutral receipts retain the actual visible account and view or RLS limits without author methods', async t => {
  const f = await fixture(t);
  const source = { ...f.source, limitations: ['db_view_scope_not_independently_verified', 'db_current_role_policy_visible_scope'], session: { ...f.source.session, serverVersionNum: '180001', loginRole: 'tenant_a_reader', effectiveRole: 'tenant_a_reader', visibleScope: 'current-account-visible' as const } };
  const sink = await f.results.begin(f.sourceOwner, source, [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); await sink.append([['1.00']]); const receipt = await sink.complete('1');
  const fixed = await f.bundles.freeze(f.owner, { selector: `db-result:${receipt.id}`, purpose: 'rcr' }, f.context);
  const cold = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', maxBytes: 6000 }, f.context);
  assert.equal(cold.neutralReceipt.consistency.loginRole, 'tenant_a_reader'); assert.equal(cold.neutralReceipt.consistency.effectiveRole, 'tenant_a_reader'); assert.equal(cold.neutralReceipt.consistency.visibleScope, 'current-account-visible');
  assert.equal(cold.neutralReceipt.consistency.serverVersionNum, '180001');
  for (const limitation of source.limitations) assert.equal(cold.neutralReceipt.limitations.includes(limitation), true);
  assert.equal(JSON.stringify(cold).includes('AUTHOR_SECRET'), false); assert.equal(JSON.stringify(cold).includes('AUTHOR_DECLARED'), false);
  const legacy = await f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, f.context);
  assert.equal(legacy.neutralReceipt.consistency.visibleScope, 'unknown'); assert.equal(legacy.neutralReceipt.consistency.loginRole, undefined);
  assert.equal(legacy.neutralReceipt.limitations.includes('db_actor_identity_unknown'), true); assert.equal(legacy.neutralReceipt.limitations.includes('db_source_limitations_unknown'), true);
});

test('db-link fixed bundles survive mutable 020 changes and repeat freeze reads the original ref without overwriting either source', async t => {
  const f = await fixture(t), input = { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' as const };
  const fixed = await f.bundles.freeze(f.owner, input, f.context), originalPrivate = path.join(f.privateRoot, ...[f.owner.projectId, f.owner.taskId, f.owner.requestId, f.owner.reviewId], 'db-result', f.receipt.id, 'author-manifest.json');
  const before = await fs.readFile(originalPrivate);
  await fs.writeFile(path.join(f.project.rootPath, f.receipt.relativePath), 'public manifest replaced');
  const read = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', maxBytes: 4000 }, f.context); assert.deepEqual(read.rows, [['123.4500'], ['9007199254740993.0010']]);
  assert.deepEqual((await f.bundles.freeze(f.owner, input, f.context)).ref, fixed.ref);
  assert.deepEqual(await fs.readFile(originalPrivate), before); assert.equal(await fs.readFile(path.join(f.project.rootPath, f.receipt.relativePath), 'utf8'), 'public manifest replaced');
  assert.equal((await fs.stat(originalPrivate)).mode & 0o777, 0o600); assert.equal((await fs.stat(f.privateRoot)).mode & 0o777, 0o700);
});

test('db-link informed stage and author envelope require the same original record Host proof, not a client stage value', async t => {
  const f = await fixture(t), fixed = await f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, f.context);
  await assert.rejects(f.bundles.read(f.owner, fixed.ref, { stage: 'cold', section: 'author', maxBytes: 4000 }, f.context), /author_not_revealed/);
  await assert.rejects(f.bundles.read(f.owner, fixed.ref, { stage: 'informed', section: 'author', maxBytes: 4000 }, f.context), /cold_basis_not_fixed/);
  const noProof = createDbLinkReviewBundles({ privateRoot: f.privateRoot, projects: f.projects, results: f.results, assertOwner: () => {} });
  await assert.rejects(noProof.read(f.owner, fixed.ref, { stage: 'informed', section: 'author', maxBytes: 4000 }, f.context), /author_not_revealed/);
  f.reveal(); const informed = await f.bundles.read(f.owner, fixed.ref, { stage: 'informed', section: 'author', maxBytes: 4000 }, f.context);
  assert.match(informed.author!.text, /AUTHOR_SECRET_SQL/); assert.match(informed.author!.text, /AUTHOR_SECRET_PARAMETER/); assert.match(informed.author!.text, /AUTHOR_DECLARED_RELATION/);
  assert.ok(Buffer.byteLength(JSON.stringify(informed)) <= 4000); assert.equal(informed.coverage.complete, false);
});

test('db-link bundles enforce exact owner, ref hash, selector paths and immutable member hashes', async t => {
  const f = await fixture(t), fixed = await f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, f.context);
  await assert.rejects(f.bundles.read({ ...f.owner, requestId: randomUUID() }, fixed.ref, { stage: 'cold' }, f.context), /foreign_reference/);
  await assert.rejects(f.bundles.read(f.owner, { ...fixed.ref, sha256: '0'.repeat(64) }, { stage: 'cold' }, f.context), /snapshot_changed/);
  await assert.rejects(f.bundles.freeze(f.owner, { selector: 'db-result:../../outside', purpose: 'rcr' }, f.context), /invalid/);
  const privateChunk = path.join(f.privateRoot, f.owner.projectId, f.owner.taskId, f.owner.requestId, f.owner.reviewId, 'db-result', f.receipt.id, fixed.files.at(-1)!.name);
  await fs.writeFile(privateChunk, '{"changed":true}');
  await assert.rejects(fixed.assertUnchanged(), /snapshot_changed/);
  await assert.rejects(f.bundles.read(f.owner, fixed.ref, { stage: 'cold', maxRows: 10 }, f.context), /snapshot_changed/);
});

test('db-link freezes no complete reference for partial, changed or over-budget result sets', async t => {
  const f = await fixture(t);
  const partial = await f.results.begin(f.sourceOwner, f.source, [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); await partial.append([['1.00']]); const partialReceipt = await partial.abort('partial', 'synthetic limit');
  await assert.rejects(f.bundles.freeze(f.owner, { selector: `db-result:${partialReceipt.id}`, purpose: 'rcr' }, f.context), /db_result_incomplete/);
  await assert.rejects(f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, { ...f.context, maxTotalBytes: 10 }), /bundle_bytes_limit/);
  await assert.rejects(f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'cnr' }, f.context), /bundle_bytes_limit/);
  const current = await f.results.materialFiles(f.sourceOwner, f.receipt.id), chunk = current.files.find(file => file.role === 'chunk')!;
  await fs.writeFile(path.join(f.project.rootPath, chunk.relativePath), 'changed before freeze');
  await assert.rejects(f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, f.context), /db_result_changed/);
});

test('db-link cancellation and late original operation revoke publication after asynchronous source capture', async t => {
  const f = await fixture(t), captured = f.projects.captureFeedbackFile.bind(f.projects);
  let enter!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(f.projects, 'captureFeedbackFile', async (...args: Parameters<typeof captured>) => { const value = await captured(...args); enter(); await held; return value; });
  const controller = new AbortController(), freezing = f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, { ...f.context, signal: controller.signal });
  await entered; controller.abort(); release(); await assert.rejects(freezing, error => error instanceof Error && error.name === 'AbortError');
  const committed = path.join(f.privateRoot, f.owner.projectId, f.owner.taskId, f.owner.requestId, f.owner.reviewId, 'db-result', f.receipt.id, 'bundle.json');
  await assert.rejects(fs.stat(committed), { code: 'ENOENT' });
});

test('db-link chunk range reader preserves exact large value bytes within the whole response budget', async t => {
  const f = await fixture(t), value = '大值😀'.repeat(3000);
  const sink = await f.results.begin(f.sourceOwner, f.source, [{ ordinal: 0, name: 'payload', databaseType: 'json', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 50000, chunkBytes: 90000 }); await sink.append([[value]]); const receipt = await sink.complete('1');
  const fixed = await f.bundles.freeze(f.owner, { selector: `db-result:${receipt.id}`, purpose: 'rcr' }, f.context);
  await assert.rejects(f.bundles.read(f.owner, fixed.ref, { stage: 'cold', maxRows: 1, maxBytes: 2000 }, f.context), /row_too_large_use_chunk_range/);
  const buffers: Buffer[] = []; let startByte = 0;
  for (;;) {
    const part = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', chunkIndex: 0, startByte, maxBytes: 2000 }, f.context);
    assert.ok(Buffer.byteLength(JSON.stringify(part)) <= 2000); assert.ok(part.chunk!.rangeBytes.end > startByte);
    buffers.push(Buffer.from(part.chunk!.base64, 'base64')); if (part.chunk!.continuationStartByte === null) break; startByte = part.chunk!.continuationStartByte;
  }
  const original = await fs.readFile(path.join(f.project.rootPath, path.posix.dirname(receipt.relativePath), 'rows-000001.json'));
  assert.deepEqual(Buffer.concat(buffers), original); assert.equal(JSON.parse(Buffer.concat(buffers).toString()).rows[0][0], value);
});

test('db-link rejects a symlink private snapshot root without writing outside it', async t => {
  const f = await fixture(t), outside = path.join(path.dirname(f.privateRoot), 'outside'); await fs.mkdir(outside); await fs.symlink(outside, f.privateRoot);
  await assert.rejects(f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, f.context), /unsafe_private_root/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('db-link resolves a true source owner lazily only for new snapshots and reads captured export authority without mutable 020', async t => {
  const f = await fixture(t); let resolutions = 0;
  const outlet = { targets: ['review-model'], structure: true, comments: false, queryText: false, results: true };
  const sink = await f.results.begin(f.sourceOwner, { ...f.source, modelExport: outlet }, [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000 }); await sink.append([['4.00']]); const receipt = await sink.complete('1');
  const input = { selector: `db-result:${receipt.id}`, purpose: 'rcr' as const }, context = { ...f.context, sourceOwner: async () => { resolutions++; return f.sourceOwner; } };
  const fixed = await f.bundles.freeze(f.owner, input, context); assert.equal(resolutions, 1);
  await fs.writeFile(path.join(f.project.rootPath, receipt.relativePath), 'mutable source changed');
  assert.deepEqual((await f.bundles.freeze(f.owner, input, { ...context, sourceOwner: async () => { throw new Error('must-not-read-mutable-source'); } })).ref, fixed.ref);
  const authority = await f.bundles.authorizationSource(f.owner, fixed.ref, f.context); assert.deepEqual(authority.modelExport, outlet); assert.equal(JSON.stringify(authority).includes('AUTHOR_SECRET'), false);
  const legacy = await f.bundles.freeze(f.owner, { selector: `db-result:${f.receipt.id}`, purpose: 'rcr' }, f.context); await assert.rejects(f.bundles.authorizationSource(f.owner, legacy.ref, f.context), /model_export_unavailable/);
});

test('db-link freezes all segmented value parts and exposes bounded cold byte ranges without author SQL', async t => {
  const f = await fixture(t), bytes = Buffer.from('😀中文'.repeat(3));
  const sink = await f.results.begin(f.sourceOwner, f.source, [{ ordinal: 0, name: 'note', databaseType: 'text', precision: null, scale: null }], { maxRows: 10, maxBytes: 100000, maxCellBytes: 16, chunkBytes: 10000 });
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: bytes.length, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  for (let offset = 0; offset < bytes.length; offset += 7) await sink.appendValueSegment(valueId, offset, bytes.subarray(offset, offset + 7).toString('base64'));
  const reference = await sink.completeValue(valueId);
  await sink.append([[reference]]);
  const receipt = await sink.complete('1'), original = await f.results.materialFiles(f.sourceOwner, receipt.id);
  const fixed = await f.bundles.freeze(f.owner, { selector: `db-result:${receipt.id}`, purpose: 'rcr' }, f.context);
  assert.equal(fixed.logicalItems, 1);
  assert.equal(fixed.files.length, original.files.length);
  assert.equal(fixed.neutralReceipt.persistedRows, 1);
  assert.equal(fixed.neutralReceipt.values?.[0]?.valueId, valueId);
  assert.equal(fixed.neutralReceipt.values?.[0]?.firstChunkIndex, 1);
  assert.equal(fixed.neutralReceipt.values?.[0]?.partCount, 5);
  assert.equal(fixed.neutralReceipt.values?.[0]?.representation, 'utf8');
  assert.equal(fixed.neutralReceipt.values?.[0]?.databaseType, 'text');
  const cold = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', maxBytes: 6000 }, f.context);
  assert.deepEqual(cold.rows, [[reference]]);
  assert.equal(cold.coverage.complete, false, 'row references do not mean the value body was provided');
  assert.equal(cold.coverage.providedRows, 1);
  assert.equal(JSON.stringify(cold).includes('AUTHOR_SECRET'), false);
  assert.equal(JSON.stringify(cold).includes('AUTHOR_DECLARED'), false);
  const selected = fixed.neutralReceipt.values![0]!;
  const first = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', chunkIndex: selected.firstChunkIndex, startByte: 0, maxBytes: 3000 }, f.context);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 3000);
  assert.ok(first.chunk!.rangeBytes.end > 0);
  assert.equal(first.coverage.providedRows, 0);
  const captured = fixed.files[selected.firstChunkIndex + 1]!;
  const sourcePart = original.files.find(file => path.posix.basename(file.relativePath) === captured.name)!;
  const expected = await fs.readFile(path.join(f.project.rootPath, sourcePart.relativePath));
  assert.deepEqual(Buffer.from(first.chunk!.base64, 'base64'), expected.subarray(0, first.chunk!.rangeBytes.end));
  assert.equal(captured.sha256, sourcePart.sha256, 'file identity is the original exact part, not renamed value content');
  await fixed.assertUnchanged();
});

test('db-link detects a changed private value part in verify and its selected byte reader', async t => {
  const f = await fixture(t), segment = await segmentedResult(f);
  const fixed = await f.bundles.freeze(f.owner, { selector: `db-result:${segment.receipt.id}`, purpose: 'rcr' }, f.context);
  const part = fixed.neutralReceipt.values![0]!, member = fixed.files[part.firstChunkIndex + 1]!;
  const original = path.join(f.privateRoot, f.owner.projectId, f.owner.taskId, f.owner.requestId, f.owner.reviewId, 'db-result', segment.receipt.id, member.name);
  await fs.writeFile(original, 'changed-value-part');
  await assert.rejects(fixed.assertUnchanged(), /db_review_snapshot_changed/);
  await assert.rejects(f.bundles.read(f.owner, fixed.ref, { stage: 'cold', chunkIndex: part.firstChunkIndex, maxBytes: 6000 }, f.context), /db_review_snapshot_changed/);
});

test('db-link cancellation during actual value-part capture never publishes a frozen reference', async t => {
  const f = await fixture(t), segment = await segmentedResult(f), capture = f.projects.captureFeedbackFile.bind(f.projects);
  let entered!: () => void, release!: () => void;
  const capturedPart = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(f.projects, 'captureFeedbackFile', async (...args: Parameters<typeof capture>) => {
    const actual = await capture(...args);
    if (path.posix.basename(args[1]).startsWith('value-')) { entered(); await held; }
    return actual;
  });
  const controller = new AbortController();
  const freezing = f.bundles.freeze(f.owner, { selector: `db-result:${segment.receipt.id}`, purpose: 'rcr' }, { ...f.context, signal: controller.signal });
  await capturedPart; controller.abort(); release();
  await assert.rejects(freezing, error => error instanceof Error && error.name === 'AbortError');
  const published = path.join(f.privateRoot, f.owner.projectId, f.owner.taskId, f.owner.requestId, f.owner.reviewId, 'db-result', segment.receipt.id, 'bundle.json');
  await assert.rejects(fs.stat(published), { code: 'ENOENT' });
});

test('db-link fixed value parts survive mutable source changes and preserve their original byte identity', async t => {
  const f = await fixture(t), segment = await segmentedResult(f);
  const input = { selector: `db-result:${segment.receipt.id}`, purpose: 'rcr' as const }, fixed = await f.bundles.freeze(f.owner, input, f.context);
  const sourceFiles = await f.results.materialFiles(f.sourceOwner, segment.receipt.id), part = fixed.neutralReceipt.values![0]!;
  const member = fixed.files[part.firstChunkIndex + 1]!, sourceFile = sourceFiles.files.find(file => path.posix.basename(file.relativePath) === member.name)!;
  const original = await fs.readFile(path.join(f.project.rootPath, sourceFile.relativePath));
  await fs.writeFile(path.join(f.project.rootPath, sourceFile.relativePath), 'mutable-source-changed');
  const read = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', chunkIndex: part.firstChunkIndex, maxBytes: 6000 }, f.context);
  assert.deepEqual(Buffer.from(read.chunk!.base64, 'base64'), original);
  assert.equal(read.chunk!.sha256, sourceFile.sha256);
  assert.deepEqual((await f.bundles.freeze(f.owner, input, f.context)).ref, fixed.ref);
  await fixed.assertUnchanged();
});

test('db-link keeps one many-part value addressable without repeating all part metadata in a bounded model response', async t => {
  const f = await fixture(t);
  const sink = await f.results.begin(f.sourceOwner, f.source, [{ ordinal: 0, name: 'note', databaseType: 'text', precision: null, scale: null }], { maxRows: 10, maxBytes: 1000000, maxCellBytes: 16, chunkBytes: 10000 });
  const valueId = await sink.beginValue({ row: 0, column: 0, totalBytes: 300, representation: 'utf8', databaseType: 'text', stableKey: ['order-1'] });
  for (let offset = 0; offset < 300; offset++) await sink.appendValueSegment(valueId, offset, 'YQ==');
  await sink.append([[await sink.completeValue(valueId)]]);
  const receipt = await sink.complete('1'), fixed = await f.bundles.freeze(f.owner, { selector: `db-result:${receipt.id}`, purpose: 'rcr' }, f.context);
  const cold = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', maxBytes: 3000 }, f.context);
  assert.equal(cold.coverage.complete, false);
  assert.equal(cold.coverage.providedRows, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(cold)) <= 3000);
  const value = fixed.neutralReceipt.values![0]!;
  assert.equal(value.firstChunkIndex, 1);
  assert.equal(value.partCount, 300);
  const last = await f.bundles.read(f.owner, fixed.ref, { stage: 'cold', chunkIndex: value.firstChunkIndex + value.partCount - 1, maxBytes: 3000 }, f.context);
  assert.deepEqual(JSON.parse(Buffer.from(last.chunk!.base64, 'base64').toString('utf8')), { offset: 299, base64: 'YQ==' });
  assert.equal(fixed.files.length, 302, 'all original physical member identities remain privately frozen');
  await fixed.assertUnchanged();
});

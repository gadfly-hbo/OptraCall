import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createVerificationStore, type CreateVerificationInput } from '../src/host/verification-store.ts';

function input(): CreateVerificationInput {
  return {
    projectId: randomUUID(), taskId: randomUUID(), verificationId: randomUUID(),
    question: '核算本次关键金额与分母', selection: { range: '三月', reports: ['060_reports/report.md'] },
    configuration: { id: 'synthetic-model', revision: 2, provider: 'synthetic', model: 'test' },
    semantics: { text: '金额以分计，退款不计收入；业务解释仍待确认。', sources: [{ kind: 'SAP', id: 'sales', version: '1.0' }] },
    dataFiles: [{ relativePath: '020_clean/data.csv', bytes: Buffer.from('abc'), sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }],
    authorFiles: [{ relativePath: '060_reports/report.md', bytes: Buffer.from('作者结论：金额 100') }],
  };
}

test('fixed author readback never displays changed bytes with the original digest', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-author-read-'));
  try {
    const store = createVerificationStore({ dataRoot }), request = input();
    const { record } = await store.create(request);
    assert.deepEqual(await store.readAuthorFiles(request), []);
    await store.update(request, { state: 'running' });
    await store.saveColdResult(request, { text: '独立值99。' });
    await store.revealAuthor(request);
    assert.equal((await store.readAuthorFiles(request))[0]!.bytes.toString('utf8'), '作者结论：金额 100');
    await writeFile(record.authorFiles[0]!.snapshotPath, '被修改的固定副本');
    await assert.rejects(store.readAuthorFiles(request), { code: 'verification_snapshot_changed' });
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('comparison validates the revealed workspace author bytes rather than only the private snapshot', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-revealed-'));
  try {
    const store = createVerificationStore({ dataRoot }), request = input();
    const { record } = await store.create(request);
    await store.update(request, { state: 'running' }); await store.saveColdResult(request, { text: '独立值99。' }); await store.revealAuthor(request);
    await store.verifyWorkspaceInputs(request);
    await writeFile(path.join(record.workspace, 'author/060_reports/report.md'), '模型实际看到的报告被改写');
    await assert.rejects(store.verifyWorkspaceInputs(request), { code: 'verification_workspace_input_changed' });
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('saved native pointers cannot reopen an author session or a copied foreign header', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-native-scope-'));
  try {
    const store = createVerificationStore({ dataRoot }), request = input();
    const { record } = await store.create(request);
    await mkdir(record.sessionDirectory, { recursive: true });
    const own = path.join(record.sessionDirectory, 'own.jsonl');
    await writeFile(own, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), cwd: record.workspace }) + '\n');
    await store.update(request, { native: { sessionFile: own } });
    assert.equal((await store.read(request)).native!.sessionFile, own);
    const foreign = path.join(dataRoot, 'author-native.jsonl');
    const original = JSON.stringify({ type: 'session', version: 3, id: randomUUID(), cwd: '/synthetic/author/020_clean' }) + '\n';
    await writeFile(foreign, original);
    const target = path.join(store.recordDirectory(request), 'record.json');
    const corrupted = JSON.parse(await readFile(target, 'utf8')); corrupted.native.sessionFile = foreign;
    await writeFile(target, JSON.stringify(corrupted));
    await assert.rejects(store.read(request), { code: 'verification_native_scope_invalid' });
    corrupted.native.sessionFile = own; await writeFile(own, original); await writeFile(target, JSON.stringify(corrupted));
    await assert.rejects(store.read(request), { code: 'verification_native_scope_invalid' });
    assert.equal(await readFile(foreign, 'utf8'), original);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('a UUID already owned by another task cannot inject files into its cold workspace', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-owner-'));
  try {
    const store = createVerificationStore({ dataRoot }), first = input();
    const { record } = await store.create(first);
    const second = input(); second.verificationId = first.verificationId;
    second.dataFiles = [{ relativePath: '020_clean/foreign.csv', bytes: Buffer.from('unselected foreign task data') }];
    await assert.rejects(store.create(second), { code: 'verification_workspace_exists' });
    assert.deepEqual((await readdir(path.join(record.workspace, 'inputs/020_clean'))).sort(), ['data.csv']);
    await store.verifyWorkspaceInputs(first);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('a new verification preserves fixed inputs while keeping author material outside its cold workspace', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot });
    const request = input();
    const created = await store.create(request);
    assert.equal(created.created, true);
    assert.equal(created.record.state, 'ready');
    assert.equal(await readFile(path.join(created.record.workspace, 'inputs', '020_clean/data.csv'), 'utf8'), 'abc');
    assert.equal(await readFile(created.record.authorFiles[0]!.snapshotPath, 'utf8'), '作者结论：金额 100');
    assert.deepEqual((await readdir(created.record.workspace)).sort(), ['inputs']);
    assert.equal((await store.read(request)).dataFiles[0]!.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const repeated = await store.create(request);
    assert.equal(repeated.created, false);
    assert.deepEqual(repeated.record, created.record);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('author material is revealed only after a running cold result and its evidence have been frozen', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    const { record } = await store.create(request);
    await assert.rejects(store.revealAuthor(request), { code: 'verification_cold_result_required' });
    await store.update(request, { state: 'running' });
    await writeFile(path.join(record.workspace, 'calculation.py'), 'print(99)\n');
    const cold = await store.saveColdResult(request, { text: '独立核算金额为99，业务含义仍需确认。', requestId: randomUUID() });
    assert.equal(await readFile(cold.coldResult!.file, 'utf8'), '独立核算金额为99，业务含义仍需确认。');
    assert.equal(cold.coldResult!.files[0]!.relativePath, 'calculation.py');
    await writeFile(path.join(record.workspace, 'calculation.py'), 'print(100)\n');
    const revealed = await store.revealAuthor(request);
    assert.equal(revealed.phase, 'compare');
    assert.equal(await readFile(path.join(record.workspace, 'author', '060_reports/report.md'), 'utf8'), '作者结论：金额 100');
    assert.equal(await readFile(cold.coldResult!.files[0]!.snapshotPath, 'utf8'), 'print(99)\n');
    await assert.rejects(store.saveColdResult(request, { text: '替换独立结果' }), { code: 'verification_result_conflict' });
    await store.saveComparisonResult(request, { text: '差异为1，需检查退款口径。' });
    await store.update(request, { state: 'completed' });
    await assert.rejects(store.revealAuthor(request), { code: 'verification_not_running' });
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('a reused intention conflicts on changed choices and cannot pass author answers as cold data', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    await store.create(request);
    await assert.rejects(store.create({ ...request, question: '另一个问题' }), { code: 'verification_selection_conflict' });
    const samePath = input(); samePath.authorFiles[0]!.relativePath = samePath.dataFiles[0]!.relativePath;
    await assert.rejects(store.create(samePath), { code: 'verification_input_author_overlap' });
    const sameContent = input(); sameContent.authorFiles[0]!.bytes = Buffer.from('abc');
    await assert.rejects(store.create(sameContent), { code: 'verification_input_author_overlap' });
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('restart reconciliation preserves unfinished evidence without resuming, retrying or replacing terminal records', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const running = input(), cancelled = input();
    const { record } = await store.create(running);
    await store.update(running, { state: 'running' });
    await store.saveColdResult(running, { text: '已经独立核算，尚未对照。' });
    await store.create(cancelled); await store.update(cancelled, { state: 'cancelled' });
    const previousCancelled = await store.read(cancelled);
    const restarted = createVerificationStore({ dataRoot });
    const interrupted = await restarted.reconcileInterrupted();
    assert.equal(interrupted.length, 1);
    assert.equal(interrupted[0]!.state, 'interrupted');
    assert.equal(await readFile(interrupted[0]!.coldResult!.file, 'utf8'), '已经独立核算，尚未对照。');
    assert.deepEqual(await restarted.read(cancelled), previousCancelled);
    assert.equal((await restarted.create(running)).created, false);
    assert.equal((await restarted.read(running)).state, 'interrupted');
    await assert.rejects(restarted.revealAuthor(running), { code: 'verification_not_running' });
    assert.equal(await readFile(record.authorFiles[0]!.snapshotPath, 'utf8'), '作者结论：金额 100');
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('a cancelled attempt cannot be resurrected or rewritten as a completed verification', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    await store.create(request); await store.update(request, { state: 'running' });
    await store.saveColdResult(request, { text: '独立结果' }); await store.revealAuthor(request);
    await store.saveComparisonResult(request, { text: '只完成对照，稍后取消。' });
    await store.update(request, { state: 'cancelled' });
    await assert.rejects(store.update(request, { state: 'completed' }), { code: 'verification_terminal' });
    await assert.rejects(store.update(request, { state: 'running' }), { code: 'verification_terminal' });
    await assert.rejects(store.update(request, JSON.parse('{"authorRevealedAt":"forged"}')), { code: 'invalid_verification_update' });
    assert.equal((await store.read(request)).state, 'cancelled');
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('corrupt persisted evidence cannot masquerade as a completed cold result', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    const { record } = await store.create(request);
    const forged = { ...record, state: 'running', coldResult: { text: 'abc', sha256: record.dataFiles[0]!.sha256, file: record.dataFiles[0]!.snapshotPath, files: [], savedAt: new Date().toISOString() } };
    await writeFile(path.join(store.recordDirectory(request), 'record.json'), JSON.stringify(forged));
    await assert.rejects(store.read(request), { code: 'verification_record_corrupt' });
    await assert.rejects(store.revealAuthor(request), { code: 'verification_record_corrupt' });
    assert.equal(await readFile(path.join(record.workspace, 'inputs', '020_clean/data.csv'), 'utf8'), 'abc');
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('project-scoped records include its tasks without leaking records from another project', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const a = input(), b = { ...input(), projectId: a.projectId }, other = input();
    await store.create(a); await store.create(b); await store.create(other);
    assert.deepEqual((await store.list(a.projectId)).map(record => record.verificationId).sort(), [a.verificationId, b.verificationId].sort());
    assert.equal((await store.list(a.projectId, a.taskId)).length, 1);
    assert.deepEqual(await store.list(a.projectId, randomUUID()), []);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('concurrent duplicate submissions grant one creation and keep the persisted original configuration', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    const privateConfiguration = { ...request.configuration, apiKey: 'synthetic-secret-must-not-be-stored' };
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => store.create({ ...request, configuration: privateConfiguration })));
    const errors = attempts.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    assert.deepEqual(errors, []);
    const results = attempts.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    assert.equal(results.filter(result => result.created).length, 1);
    const record = await store.read(request);
    assert.equal(record.state, 'ready');
    assert.equal(JSON.stringify(record).includes('synthetic-secret-must-not-be-stored'), false);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('unsafe filesystem paths and modified frozen author evidence are rejected without replacing originals', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-elsewhere-'));
  try {
    const store = createVerificationStore({ dataRoot }); const unsafe = input();
    unsafe.dataFiles[0]!.relativePath = '../outside.csv';
    await assert.rejects(store.create(unsafe), { code: 'invalid_verification_file' });
    const linked = input();
    await mkdir(path.dirname(store.workspace(linked.verificationId)), { recursive: true });
    await symlink(elsewhere, store.workspace(linked.verificationId));
    await assert.rejects(store.create(linked), { code: 'verification_unsafe_path' });
    assert.deepEqual(await readdir(elsewhere), []);
    const request = input(); const { record } = await store.create(request);
    await store.update(request, { state: 'running' }); await store.saveColdResult(request, { text: '独立依据' });
    await writeFile(record.authorFiles[0]!.snapshotPath, '被外部改变的作者副本');
    await assert.rejects(store.revealAuthor(request), { code: 'verification_snapshot_changed' });
    await assert.rejects(readFile(path.join(record.workspace, 'author', '060_reports/report.md')), { code: 'ENOENT' });
    assert.equal((await store.read(request)).authorRevealedAt, undefined);
  } finally { await rm(dataRoot, { recursive: true, force: true }); await rm(elsewhere, { recursive: true, force: true }); }
});

test('cold evidence lists captured outputs while excluding inputs, temporary files and symlink targets', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    const { record } = await store.create(request); await store.update(request, { state: 'running' });
    await writeFile(path.join(record.workspace, 'answer.json'), '{"amount":99}');
    await writeFile(path.join(record.workspace, 'discard.tmp'), 'transient');
    await symlink(record.authorFiles[0]!.snapshotPath, path.join(record.workspace, 'answer-link.md'));
    const saved = await store.saveColdResult(request, { text: '99' });
    assert.deepEqual(saved.coldResult!.files.map(file => file.relativePath), ['answer.json']);
    assert.equal(saved.coldResult!.captureNotes!.some(note => note.includes('answer-link.md')), true);
    assert.equal(await readFile(path.join(record.workspace, 'discard.tmp'), 'utf8'), 'transient');
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('one explicit author revision and one recheck preserve the original comparison and reject another revision', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    await store.create(request); await store.update(request, { state: 'running' });
    await store.saveColdResult(request, { text: '独立核算99' }); await store.revealAuthor(request);
    await store.saveComparisonResult(request, { text: '原稿100有差异' }); await store.update(request, { state: 'completed' });
    const requestId = randomUUID();
    await store.update(request, { revisionCount: 1, authorRevision: { requestId, status: 'running' } });
    await store.update(request, { authorRevision: { requestId, status: 'completed', reportText: '修订为99并解释差异' } });
    await store.update(request, { state: 'running', phase: 'recheck', recheckCount: 1 });
    await store.saveRecheckResult(request, { text: '数值已一致，业务效果未验证。' });
    await store.update(request, { state: 'completed' });
    const record = await store.read(request);
    assert.equal(record.comparisonResult!.text, '原稿100有差异');
    assert.equal(record.recheckResult!.text, '数值已一致，业务效果未验证。');
    await assert.rejects(store.update(request, { authorRevision: { requestId: randomUUID(), status: 'running' } }), { code: 'verification_followup_limit' });
    await assert.rejects(store.update(request, { revisionCount: 2 }), { code: 'verification_followup_limit' });
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('restart preserves a completed comparison while marking an unfinished author revision unknown', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    await store.create(request); await store.update(request, { state: 'running' });
    await store.saveColdResult(request, { text: '独立99' }); await store.revealAuthor(request);
    await store.saveComparisonResult(request, { text: '原稿100有差异' }); await store.update(request, { state: 'completed' });
    const requestId = randomUUID();
    await store.update(request, { revisionCount: 1, authorRevision: { requestId, status: 'running' } });
    const restarted = createVerificationStore({ dataRoot });
    const changed = await restarted.reconcileInterrupted();
    assert.equal(changed.length, 1);
    const record = await restarted.read(request);
    assert.equal(record.state, 'completed');
    assert.equal(record.comparisonResult!.text, '原稿100有差异');
    assert.equal(record.authorRevision!.requestId, requestId);
    assert.equal(record.authorRevision!.status, 'unknown');
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('workspace input verification is read-only and detects changed data, semantics and private source snapshots', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    const { record } = await store.create(request);
    assert.deepEqual(await store.verifyWorkspaceInputs(request), record);
    await writeFile(path.join(record.workspace, 'inputs', '020_clean/data.csv'), 'changed');
    await assert.rejects(store.verifyWorkspaceInputs(request), { code: 'verification_workspace_input_changed' });
    assert.deepEqual(await store.read(request), record);
    assert.equal(await readFile(record.dataFiles[0]!.snapshotPath, 'utf8'), 'abc');
    const semanticRequest = input(), semantic = (await store.create(semanticRequest)).record;
    await writeFile(path.join(semantic.workspace, 'inputs', 'business-context.md'), '另一份口径');
    await assert.rejects(store.verifyWorkspaceInputs(semanticRequest), { code: 'verification_workspace_input_changed' });
    const snapshotRequest = input(), snapshot = (await store.create(snapshotRequest)).record;
    await writeFile(snapshot.dataFiles[0]!.snapshotPath, 'private snapshot changed');
    await assert.rejects(store.verifyWorkspaceInputs(snapshotRequest), { code: 'verification_snapshot_changed' });
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('the full fixed author revision is staged idempotently for recheck without truncation or replacing prior evidence', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    const { record } = await store.create(request); await store.update(request, { state: 'running' });
    await store.saveColdResult(request, { text: '最初独立99' }); await store.revealAuthor(request);
    await store.saveComparisonResult(request, { text: '初稿100需修正' }); await store.update(request, { state: 'completed' });
    await assert.rejects(store.stageRevision(request, '未完成的修订'), { code: 'verification_revision_required' });
    const requestId = randomUUID(), text = '详细修订依据。'.repeat(3000) + '\n结尾的重要修订：99；仍未验证经营效果。';
    await store.update(request, { revisionCount: 1, authorRevision: { requestId, status: 'running' } });
    await store.update(request, { authorRevision: { requestId, status: 'completed', reportText: text } });
    await assert.rejects(store.stageRevision(request, '与已保存修订不符'), { code: 'verification_revision_mismatch' });
    const before = await store.read(request), staged = await store.stageRevision(request, text);
    assert.equal(staged.relativePath, 'author-revision/revision.md');
    assert.ok(staged.bytes > 14000);
    assert.equal(await readFile(path.join(record.workspace, staged.relativePath), 'utf8'), text);
    assert.deepEqual(await store.stageRevision(request, text), staged);
    assert.deepEqual(await store.read(request), before);
    await writeFile(path.join(record.workspace, staged.relativePath), '外部修改，不能覆盖');
    await assert.rejects(store.stageRevision(request, text), { code: 'verification_snapshot_conflict' });
    assert.equal(await readFile(path.join(record.workspace, staged.relativePath), 'utf8'), '外部修改，不能覆盖');
    assert.equal((await store.read(request)).coldResult!.text, '最初独立99');
    assert.equal((await store.read(request)).comparisonResult!.text, '初稿100需修正');
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('revision staging refuses a symlink target and missing cold inputs without repairing either', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-verification-store-'));
  try {
    const store = createVerificationStore({ dataRoot }); const request = input();
    const { record } = await store.create(request); await store.update(request, { state: 'running' });
    await store.saveColdResult(request, { text: '冷读99' }); await store.revealAuthor(request);
    await store.saveComparisonResult(request, { text: '有差异' }); await store.update(request, { state: 'completed' });
    const requestId = randomUUID(), reportText = '完整修订99';
    await store.update(request, { revisionCount: 1, authorRevision: { requestId, status: 'running' } });
    await store.update(request, { authorRevision: { requestId, status: 'completed', reportText } });
    await mkdir(path.join(record.workspace, 'author-revision'));
    await symlink(record.authorFiles[0]!.snapshotPath, path.join(record.workspace, 'author-revision', 'revision.md'));
    await assert.rejects(store.stageRevision(request, reportText), { code: 'verification_unsafe_file' });
    assert.equal(await readFile(record.authorFiles[0]!.snapshotPath, 'utf8'), '作者结论：金额 100');
    await rm(path.join(record.workspace, 'inputs', '020_clean/data.csv'));
    await assert.rejects(store.verifyWorkspaceInputs(request), { code: 'verification_workspace_input_changed' });
    await assert.rejects(readFile(path.join(record.workspace, 'inputs', '020_clean/data.csv')), { code: 'ENOENT' });
    assert.equal(await readFile(record.dataFiles[0]!.snapshotPath, 'utf8'), 'abc');
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

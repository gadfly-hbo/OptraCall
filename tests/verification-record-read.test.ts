import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createVerificationStore } from '../src/host/verification-store.ts';

test('a record reader keeps a valid opened snapshot across a real atomic public update', async () => {
  const dataRoot = path.resolve('.local/semantic-verification/reliability-closeout', 'record-interleave-' + randomUUID());
  const store = createVerificationStore({ dataRoot });
  const owner = { projectId: randomUUID(), taskId: randomUUID(), verificationId: randomUUID() };
  const { record } = await store.create({ ...owner, question: '合成原子提交快照', selection: {}, configuration: { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic' }, dataFiles: [{ relativePath: '020_clean/data.csv', bytes: Buffer.from('id,value\na,10\n') }], authorFiles: [{ relativePath: '060_reports/author.md', bytes: Buffer.from('SYNTHETIC_ORIGINAL') }] });
  const target = path.join(store.recordDirectory(owner), 'record.json'), originalOpen = fs.open;
  let injected = false, openedNlink: number | undefined;
  // All filesystem operations and the store update are real. Only the ordering
  // between open and its first fstat is controlled; this test file is isolated
  // from the Host/SDK test process by node:test's normal per-file isolation.
  fs.open = async function (...args: Parameters<typeof fs.open>) {
    const handle = await originalOpen(...args);
    if (String(args[0]) === target && !injected) {
      injected = true;
      await store.update(owner, { independence: { status: 'unknown', note: 'NEW_COMMITTED_SNAPSHOT' } });
      openedNlink = (await handle.stat()).nlink;
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    const opened = await store.read(owner);
    assert.equal(openedNlink, 0, 'the original file descriptor must really have been unlinked by atomic replacement');
    assert.deepEqual({ projectId: opened.projectId, taskId: opened.taskId, verificationId: opened.verificationId }, owner);
    assert.equal(opened.independence.note, record.independence.note, 'return the complete old commit, not a mixture');
    assert.equal((await store.read(owner)).independence.note, 'NEW_COMMITTED_SNAPSHOT');
    assert.equal((await fs.lstat(target)).nlink, 1, 'the current path remains an ordinary committed file');
  } finally { fs.open = originalOpen; syncBuiltinESMExports(); }

  // Relaxing an already-open record descriptor must not relax fixed input or
  // author snapshots. Retain all files and the new hardlinks as local evidence.
  await store.update(owner, { state: 'running' }); await store.saveColdResult(owner, { text: 'SYNTHETIC_COLD' }); await store.revealAuthor(owner);
  const workspaceData = path.join(record.workspace, 'inputs/020_clean/data.csv');
  await fs.link(workspaceData, path.join(dataRoot, 'retained-data-hardlink.csv'));
  await assert.rejects(store.verifyWorkspaceInputs(owner), { code: 'verification_workspace_input_changed' });
  await fs.link(record.authorFiles[0]!.snapshotPath, path.join(dataRoot, 'retained-author-hardlink.md'));
  await assert.rejects(store.readAuthorFiles(owner), { code: 'verification_unsafe_file' });
});

test('repeated stale zero-link record path observations defer to a safe actual file descriptor', async t => {
  const dataRoot = path.resolve('.local/semantic-verification/reliability-closeout', 'record-path-interleave-' + randomUUID());
  const store = createVerificationStore({ dataRoot });
  const owner = { projectId: randomUUID(), taskId: randomUUID(), verificationId: randomUUID() };
  await store.create({ ...owner, question: '合成路径lookup交错', selection: {}, configuration: { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic' }, dataFiles: [{ relativePath: '020_clean/data.csv', bytes: Buffer.from('a,10') }], authorFiles: [{ relativePath: '060_reports/author.md', bytes: Buffer.from('original') }] });
  const target = path.join(store.recordDirectory(owner), 'record.json'), originalLstat = fs.lstat;
  let first = true, zero: Awaited<ReturnType<typeof fs.lstat>>, repeatZero = false, namedRechecks = 0;
  const observedLstat = t.mock.method(fs, 'lstat', async function (...args: Parameters<typeof fs.lstat>) {
    if (String(args[0]) === target) {
      if (first) {
        first = false;
        // Resolve an actual old inode, commit a replacement, then stat that
        // inode. This fixes the lookup→stat race observed in the real probe;
        // no synthetic stat values or link counts are invented.
        const old = await fs.open(target, 'r');
        await store.update(owner, { independence: { status: 'unknown', note: 'CURRENT_NAMED_COMMIT' } });
        zero = await old.stat(); await old.close(); assert.equal(zero.nlink, 0);
        return zero;
      }
      if (repeatZero) return zero;
      namedRechecks++;
    }
    return originalLstat(...args);
  });
  syncBuiltinESMExports();
  try {
    const current = await store.read(owner);
    assert.equal(current.independence.note, 'CURRENT_NAMED_COMMIT');
    assert.equal(current.verificationId, owner.verificationId);
    assert.ok(namedRechecks > 0);
    repeatZero = true;
    assert.equal((await store.read(owner)).independence.note, 'CURRENT_NAMED_COMMIT', 'repeated stale path observations do not invalidate the actual safe FD');
    await fs.link(target, path.join(dataRoot, 'retained-record-link-2.json'));
    await fs.link(target, path.join(dataRoot, 'retained-record-link-3.json'));
    assert.equal((await originalLstat(target)).nlink, 3);
    await assert.rejects(store.read(owner), { code: 'verification_unsafe_file' }, 'stale path metadata must not conceal an actual FD with too many hardlinks');
  } finally { observedLstat.mock.restore(); syncBuiltinESMExports(); }
});

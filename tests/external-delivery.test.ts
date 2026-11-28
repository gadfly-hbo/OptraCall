import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { ExternalWorkError } from '../src/host/external-work-types.ts';
import type { ExternalAssetRef, ExternalWork, WorkGrant } from '../src/host/external-work-types.ts';
import {
  EXTERNAL_DELIVERY_LIMITS, ExternalDeliveryPreservation,
} from '../src/host/external-delivery.ts';
import type { GithubBlobReader } from '../src/host/external-delivery.ts';

// S4a 交付字节保全工程隔离测试（Issue #155 spec §8 / AB11/AB15）。
// 合成 dataRoot（mkdtemp）、注入时钟与 GitHub blob 读取接缝；不访问真实网络或凭据。

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const T0 = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const PRINCIPAL_A = 'executor-a-synthetic';
const PRINCIPAL_B = 'executor-b-synthetic';

const assetRef = (id: string): ExternalAssetRef => ({ authority: 'optracall/studio', id, version: 'published-v1', hash: sha256(`asset:${id}`) });

interface Rig {
  root: string;
  clock: { now: number };
  store: ExternalWorkStore;
  preservation: ExternalDeliveryPreservation;
  claim: { claimId: string; epoch: number; principal: string };
  deliveryRoot: string;
}

async function seedWork(store: ExternalWorkStore, clock: { now: number }, suffix = '1'): Promise<void> {
  const grant: WorkGrant = {
    grantId: `grant-${suffix}`, grantVersion: 1, projectId: `project-${suffix}`, taskId: `task-${suffix}`,
    goal: `合成目标 ${suffix}`, scope: '仅限合成范围', forbidden: '',
    allowedExecutors: [PRINCIPAL_A, PRINCIPAL_B],
    repository: { stableId: 'openai/synthetic', visibility: 'private' },
    assetRefs: [assetRef('metric-1')], enterprise: '合成企业甲',
    validFrom: iso(clock.now), validUntil: iso(clock.now + 48 * HOUR),
    resourcePolicy: { maxWorks: 1, windowHours: 24 }, autoResumeAllowed: true, createdAt: iso(clock.now),
  };
  await store.createGrantWithWork(grant, {
    workId: `work-${suffix}`, projectId: grant.projectId, taskId: grant.taskId, revision: 1,
    summary: `合成摘要 ${suffix}`, deliveryCriteria: '合成交付标准', inputs: [assetRef('metric-1')],
    grantId: grant.grantId, grantVersion: grant.grantVersion, status: 'authorized',
    createdAt: iso(clock.now), updatedAt: iso(clock.now),
  } satisfies ExternalWork);
  const attempt = await store.recordPublication({ workId: `work-${suffix}`, revision: 1, action: 'issue-create', bodyHash: sha256(`issue-${suffix}`) });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });
}

async function rig(t: { after(fn: () => Promise<void>): void }, options: { readGithubBlob?: GithubBlobReader; beforeLink?: (info: { logicalPath: string }) => Promise<void> } = {}): Promise<Rig> {
  const clock = { now: T0 };
  const now = () => clock.now;
  const root = await mkdtemp(path.join(tmpdir(), 'optracall-s4a-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot: root, now });
  await store.init();
  await seedWork(store, clock);
  const preservation = new ExternalDeliveryPreservation({ store, dataRoot: root, now, readGithubBlob: options.readGithubBlob, hooks: { beforeLink: options.beforeLink } });
  await preservation.init();
  const claimed = await store.recordClaim({ workId: 'work-1', revision: 1, principal: PRINCIPAL_A, leaseDeadline: iso(clock.now + 15 * 60_000) });
  return { root, clock, store, preservation, claim: { claimId: claimed.claim.claimId, epoch: claimed.claim.epoch, principal: PRINCIPAL_A }, deliveryRoot: path.join(root, 'external-delivery') };
}

const expectDenied = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ExternalWorkError, `expected ExternalWorkError with ${code}, got ${String(error)}`);
    assert.equal((error as ExternalWorkError).code, code);
    return true;
  });
};

async function beginAndUpload(r: Rig, logicalPath: string, content: Buffer, overrides: Record<string, unknown> = {}): Promise<{ uploadId: string; chunkBytes: number; totalChunks: number }> {
  const claimId = (overrides.claimId as string | undefined) ?? r.claim.claimId;
  const epoch = (overrides.epoch as number | undefined) ?? r.claim.epoch;
  const principal = (overrides.principal as string | undefined) ?? PRINCIPAL_A;
  const began = await r.preservation.beginFile({
    workId: 'work-1', claimId, epoch, principal,
    logicalPath, totalBytes: content.length, sha256: sha256(content), ...overrides,
  });
  const chunk = EXTERNAL_DELIVERY_LIMITS.maxChunkBytes;
  for (let offset = 0; offset < content.length; offset += chunk) {
    const slice = content.subarray(offset, Math.min(offset + chunk, content.length));
    await r.preservation.writeChunk({
      uploadId: began.uploadId, workId: 'work-1', claimId, epoch, principal,
      offset, sha256: sha256(slice), bytesBase64: slice.toString('base64'),
    });
  }
  return began;
}

const commitArgs = (r: Rig, overrides: Record<string, unknown> = {}) => ({
  workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
  idempotencyKey: 'delivery-key-1',
  manifest: { files: [] as Array<Record<string, unknown>> },
  facts: { done: ['合成事项A'], notDone: [], failed: [], unknown: [] },
  ...overrides,
});

test('chunked upload happy path preserves bytes atomically as an independent external delivery', async t => {
  const r = await rig(t);
  const content = Buffer.concat([Buffer.from('合成报告正文。'.repeat(200), 'utf8'), Buffer.alloc(EXTERNAL_DELIVERY_LIMITS.maxChunkBytes + 96, 7)]);
  const began = await beginAndUpload(r, 'reports/result.txt', content);
  assert.equal(began.chunkBytes, EXTERNAL_DELIVERY_LIMITS.maxChunkBytes);
  assert.ok(began.totalChunks >= 2);
  const receipt = await r.preservation.commit(commitArgs(r, {
    manifest: { files: [{ path: 'reports/result.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }] },
  }));
  assert.equal(receipt.idempotent, false);
  assert.equal(receipt.delivery.preservation, 'preserved');
  assert.equal(receipt.delivery.late, false);
  // 独立 ExternalDeliveryRef：storage 指向 Host 分配的 external-delivery 路径，非 native 060_reports，无 native binding 字段。
  const stored = await r.store.getDelivery(receipt.delivery.deliveryId);
  assert.equal(stored?.preservation, 'preserved');
  const storage = stored?.storage ?? [];
  assert.equal(storage.length, 1);
  assert.equal(storage[0]!.sha256, sha256(content));
  assert.equal(storage[0]!.bytes, content.length);
  assert.ok(storage[0]!.relativePath.startsWith('d/'), 'storage must live under the Host-assigned external-delivery tree');
  assert.ok(!storage[0]!.relativePath.includes('060_reports'), 'external delivery bytes must never masquerade as a native report');
  for (const key of Object.keys(stored ?? {})) {
    assert.ok(!['requestId', 'sessionId', 'toolCallId', 'bindingId'].includes(key), 'external delivery must not carry native ProjectTaskResultBinding fields');
  }
  const onDisk = await readFile(path.join(r.deliveryRoot, storage[0]!.relativePath));
  assert.equal(sha256(onDisk), sha256(content), 'preserved bytes must re-read to the manifest hash');
});

test('idempotent receipts: same key+content replays, chunk and commit content conflicts are denied', async t => {
  const r = await rig(t);
  const content = Buffer.from('idempotent-body', 'utf8');
  const began = await beginAndUpload(r, 'a/body.txt', content);
  const replay = await r.preservation.writeChunk({
    uploadId: began.uploadId, workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    offset: 0, sha256: sha256(content), bytesBase64: content.toString('base64'),
  });
  assert.equal(replay.idempotent, true, 'same offset + same content returns the original receipt');
  await expectDenied(r.preservation.writeChunk({
    uploadId: began.uploadId, workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    offset: 0, sha256: sha256('different'), bytesBase64: Buffer.from('different').toString('base64'),
  }), 'external_delivery_chunk_conflict');
  const manifest = { files: [{ path: 'a/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }] };
  const first = await r.preservation.commit(commitArgs(r, { manifest }));
  const replayed = await r.preservation.commit(commitArgs(r, { manifest }));
  assert.equal(replayed.delivery.deliveryId, first.delivery.deliveryId);
  assert.equal(replayed.idempotent, true);
  await expectDenied(r.preservation.commit(commitArgs(r, {
    manifest: { files: [{ path: 'a/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }, { path: 'extra.txt', link: 'https://extra.example.invalid/f' }] },
  })), 'external_delivery_conflict');
});

test('limits: chunk, single-file, file-count, cumulative and manifest ceilings are enforced', async t => {
  const r = await rig(t);
  await expectDenied(r.preservation.beginFile({
    workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'big.bin', totalBytes: 51 * 1024 * 1024, sha256: sha256('big'),
  }), 'external_delivery_limit_exceeded');
  const oversizedSession = await r.preservation.beginFile({
    workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'over-chunk.bin', totalBytes: EXTERNAL_DELIVERY_LIMITS.maxChunkBytes + 1, sha256: sha256('over-chunk'),
  });
  const oversized = Buffer.alloc(EXTERNAL_DELIVERY_LIMITS.maxChunkBytes + 1, 7);
  await expectDenied(r.preservation.writeChunk({
    uploadId: oversizedSession.uploadId, workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    offset: 0, sha256: sha256(oversized), bytesBase64: oversized.toString('base64'),
  }), 'external_delivery_limit_exceeded');
  const files21 = Array.from({ length: 21 }, (_, index) => ({ path: `f${index}.txt`, link: `https://links.example.invalid/${index}` }));
  await expectDenied(r.preservation.commit(commitArgs(r, { manifest: { files: files21 } })), 'external_delivery_limit_exceeded');
  await r.preservation.beginFile({
    workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'half.bin', totalBytes: 50 * 1024 * 1024, sha256: sha256('half'),
  });
  await expectDenied(r.preservation.beginFile({
    workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'over.bin', totalBytes: 50 * 1024 * 1024, sha256: sha256('over'),
  }), 'external_delivery_limit_exceeded');
  const content = Buffer.from('ok', 'utf8');
  const began = await beginAndUpload(r, 'ok.txt', content);
  const bigManifest = { files: [{ path: 'ok.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }], notes: 'x'.repeat(270_000) };
  await expectDenied(r.preservation.commit(commitArgs(r, { manifest: bigManifest })), 'external_delivery_manifest_limit');
});

test('path safety: traversal, absolute paths, backslashes and drive letters are rejected', async t => {
  const r = await rig(t);
  for (const bad of ['../evil.txt', '/abs/path.txt', 'a/../b.txt', 'dir\\file.txt', 'C:\\temp\\x.txt', './x.txt']) {
    await expectDenied(r.preservation.beginFile({
      workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
      logicalPath: bad, totalBytes: 3, sha256: sha256('abc'),
    }), 'external_delivery_path_rejected');
  }
  await expectDenied(r.preservation.commit(commitArgs(r, {
    manifest: { files: [{ path: '../evil.txt', link: 'https://links.example.invalid/x' }] },
  })), 'external_delivery_path_rejected');
});

test('arbitrary URLs are never fetched; declared links are recorded link-only', async t => {
  let blobReads = 0;
  const r = await rig(t, { readGithubBlob: () => { blobReads += 1; return Promise.reject(new Error('must not be called for plain links')); } });
  const content = Buffer.from('body', 'utf8');
  const began = await beginAndUpload(r, 'a/body.txt', content);
  await expectDenied(r.preservation.commit(commitArgs(r, {
    manifest: { files: [{ path: 'a/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId, url: 'https://attacker.example.invalid/payload' }] },
  })), 'external_delivery_url_rejected');
  const receipt = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'link-key-1',
    manifest: {
      files: [
        { path: 'a/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId },
        { path: 'refs/external.html', link: 'https://source.example.invalid/page' },
      ],
    },
  }));
  assert.equal(receipt.delivery.preservation, 'link-only', 'a delivery containing an external link must not claim byte-complete preservation');
  assert.equal(blobReads, 0, 'link entries must never trigger a fetch');
  const stored = await r.store.getDelivery(receipt.delivery.deliveryId);
  assert.equal(stored?.links?.[0]?.url, 'https://source.example.invalid/page');
  assert.equal(stored?.storage?.length, 1, 'byte-verified files inside a link-only delivery are still listed in storage');
});

test('missing pieces and byte-hash mismatch are recorded failed, never preserved, zero bytes on disk', async t => {
  const r = await rig(t);
  const content = Buffer.from('partial-body', 'utf8');
  const began = await beginAndUpload(r, 'p/body.txt', content);
  const chunkDir = path.join(r.deliveryRoot, 'staging', began.uploadId, 'chunks');
  const names = (await readdir(chunkDir)).sort();
  assert.ok(names.length >= 1);
  await rm(path.join(chunkDir, names[names.length - 1]!));
  // 缺件：声明字节但分片不完整 → 保全失败（failed），不标 preserved。
  const missing = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'missing-key',
    manifest: { files: [{ path: 'p/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }] },
  }));
  assert.equal(missing.delivery.preservation, 'failed');
  assert.equal(missing.delivery.preservationReason, 'missing_pieces');
  // 字节 hash 不符：分片真实内容 hash ≠ 声明 hash。
  const honest = Buffer.from('honest-bytes', 'utf8');
  const declared = await r.preservation.beginFile({
    workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'p/other.txt', totalBytes: honest.length, sha256: sha256('declared-but-different'),
  });
  await r.preservation.writeChunk({
    uploadId: declared.uploadId, workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    offset: 0, sha256: sha256(honest), bytesBase64: honest.toString('base64'),
  });
  const mismatch = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'mismatch-key',
    manifest: { files: [{ path: 'p/other.txt', sha256: sha256('declared-but-different'), bytes: honest.length, uploadId: declared.uploadId }] },
  }));
  assert.equal(mismatch.delivery.preservation, 'failed');
  assert.equal(mismatch.delivery.preservationReason, 'content_hash_mismatch');
  const commits = await readdir(path.join(r.deliveryRoot, 'd')).catch(() => [] as string[]);
  assert.equal(commits.length, 0, 'failed deliveries must leave zero saved bytes (no half files)');
});

test('released or revoked claims cannot complete: commit becomes isolated late evidence without byte preservation', async t => {
  const r = await rig(t);
  const content = Buffer.from('late-body', 'utf8');
  const began = await beginAndUpload(r, 'l/body.txt', content);
  await r.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'done-before-commit' });
  // 当前新 epoch 的交付先落账，验证迟到证据不覆盖。
  const fresh = await r.store.recordClaim({ workId: 'work-1', revision: 1, principal: PRINCIPAL_B, leaseDeadline: iso(r.clock.now + 15 * 60_000) });
  const freshContent = Buffer.from('current-body', 'utf8');
  const freshUpload = await beginAndUpload(r, 'c/current.txt', freshContent, { claimId: fresh.claim.claimId, epoch: fresh.claim.epoch, principal: PRINCIPAL_B });
  const current = await r.preservation.commit(commitArgs(r, {
    claimId: fresh.claim.claimId, epoch: fresh.claim.epoch, principal: PRINCIPAL_B, idempotencyKey: 'current-key',
    manifest: { files: [{ path: 'c/current.txt', sha256: sha256(freshContent), bytes: freshContent.length, uploadId: freshUpload.uploadId }] },
  }));
  assert.equal(current.delivery.preservation, 'preserved');
  const late = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'late-key',
    manifest: { files: [{ path: 'l/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }] },
  }));
  assert.equal(late.delivery.late, true, 'a non-active claim goes through the isolated late path');
  assert.equal(late.delivery.preservation, 'pending', 'late evidence never claims byte preservation');
  assert.ok(!late.delivery.storage, 'late evidence preserves no bytes');
  assert.notEqual(late.delivery.deliveryId, current.delivery.deliveryId);
  const storedLate = await r.store.getDelivery(late.delivery.deliveryId);
  const storedCurrent = await r.store.getDelivery(current.delivery.deliveryId);
  assert.equal(storedLate?.late, true);
  assert.equal(storedCurrent?.late, false);
  const claimAfter = await r.store.getClaim(r.claim.claimId);
  assert.equal(claimAfter?.status, 'released', 'late evidence must not reactivate the old claim');
});

test('expired lease at commit refuses completion; expired grant blocks chunk writes and commit', async t => {
  const shortRig = await rig(t);
  const content = Buffer.from('lease-body', 'utf8');
  const began = await beginAndUpload(shortRig, 'x/body.txt', content);
  shortRig.clock.now += 16 * 60_000;
  await expectDenied(shortRig.preservation.commit(commitArgs(shortRig, {
    manifest: { files: [{ path: 'x/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }] },
  })), 'external_claim_expired');
  const grantRig = await rig(t);
  const ok = Buffer.from('grant-body', 'utf8');
  const earlySession = await grantRig.preservation.beginFile({
    workId: 'work-1', claimId: grantRig.claim.claimId, epoch: grantRig.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'g/late-chunk.txt', totalBytes: ok.length, sha256: sha256(ok),
  });
  grantRig.clock.now += 49 * HOUR;
  await expectDenied(grantRig.preservation.writeChunk({
    uploadId: earlySession.uploadId, workId: 'work-1', claimId: grantRig.claim.claimId, epoch: grantRig.claim.epoch, principal: PRINCIPAL_A,
    offset: 0, sha256: sha256(ok), bytesBase64: ok.toString('base64'),
  }), 'external_grant_not_valid');
  await expectDenied(grantRig.preservation.beginFile({
    workId: 'work-1', claimId: grantRig.claim.claimId, epoch: grantRig.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'g/next.txt', totalBytes: 3, sha256: sha256('abc'),
  }), 'external_grant_not_valid');
  await expectDenied(grantRig.preservation.commit(commitArgs(grantRig, {
    manifest: { files: [{ path: 'g/body.txt', link: 'https://links.example.invalid/g' }] },
  })), 'external_grant_not_valid');
});

test('atomic save failure rolls back every link of the attempt: zero half files, delivery recorded failed', async t => {
  let calls = 0;
  const r = await rig(t, { beforeLink: async ({ logicalPath }) => { calls += 1; if (logicalPath === 'm/second.txt') throw new Error('simulated publication failure'); } });
  const first = Buffer.from('first-file', 'utf8');
  const second = Buffer.from('second-file', 'utf8');
  const uploadA = await beginAndUpload(r, 'm/first.txt', first);
  const uploadB = await beginAndUpload(r, 'm/second.txt', second);
  const receipt = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'save-fail-key',
    manifest: {
      files: [
        { path: 'm/first.txt', sha256: sha256(first), bytes: first.length, uploadId: uploadA.uploadId },
        { path: 'm/second.txt', sha256: sha256(second), bytes: second.length, uploadId: uploadB.uploadId },
      ],
    },
  }));
  assert.equal(receipt.delivery.preservation, 'failed');
  assert.equal(receipt.delivery.preservationReason, 'save_failed');
  assert.equal(calls, 2, 'the hook ran for both files (failure injected on the second)');
  const commits = await readdir(path.join(r.deliveryRoot, 'd'));
  assert.equal(commits.length, 0, 'a failed save attempt must leave zero published files');
  const stored = await r.store.getDelivery(receipt.delivery.deliveryId);
  assert.equal(stored?.storage, undefined, 'failed deliveries record no storage');
});

test('exact GitHub blob bytes are read via the injected seam and preserved; out-of-scope or non-exact refs are refused', async t => {
  const blobBytes = Buffer.from('blob-bytes-from-authorized-commit', 'utf8');
  const r = await rig(t, { readGithubBlob: async input => {
    assert.equal(input.repo, 'openai/synthetic');
    return { bytes: blobBytes, sha256: sha256(blobBytes) };
  } });
  const good = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'blob-key',
    manifest: { files: [{ path: 'b/evidence.md', sha256: sha256(blobBytes), bytes: blobBytes.length, blob: { repo: 'openai/synthetic', commit: 'a'.repeat(40), blobPath: 'docs/evidence.md' } }] },
  }));
  assert.equal(good.delivery.preservation, 'preserved');
  const stored = await r.store.getDelivery(good.delivery.deliveryId);
  const onDisk = await readFile(path.join(r.deliveryRoot, stored?.storage?.[0]?.relativePath ?? 'missing'));
  assert.equal(sha256(onDisk), sha256(blobBytes));
  await expectDenied(r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'blob-foreign-repo',
    manifest: { files: [{ path: 'b/x.md', sha256: sha256(blobBytes), bytes: blobBytes.length, blob: { repo: 'other/repo', commit: 'a'.repeat(40), blobPath: 'docs/x.md' } }] },
  })), 'external_delivery_blob_out_of_scope');
  await expectDenied(r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'blob-branch-alias',
    manifest: { files: [{ path: 'b/x.md', sha256: sha256(blobBytes), bytes: blobBytes.length, blob: { repo: 'openai/synthetic', commit: 'main', blobPath: 'docs/x.md' } }] },
  })), 'external_delivery_blob_commit_invalid');
  const mismatchRig = await rig(t, { readGithubBlob: async () => ({ bytes: Buffer.from('changed', 'utf8'), sha256: sha256('changed') }) });
  const mismatch = await mismatchRig.preservation.commit(commitArgs(mismatchRig, {
    idempotencyKey: 'blob-hash-mismatch',
    manifest: { files: [{ path: 'b/evidence.md', sha256: sha256(blobBytes), bytes: blobBytes.length, blob: { repo: 'openai/synthetic', commit: 'a'.repeat(40), blobPath: 'docs/evidence.md' } }] },
  }));
  assert.equal(mismatch.delivery.preservation, 'failed');
  assert.equal(mismatch.delivery.preservationReason, 'blob_hash_mismatch');
  const noReader = await rig(t);
  const degraded = await noReader.preservation.commit(commitArgs(noReader, {
    idempotencyKey: 'blob-no-reader',
    manifest: { files: [{ path: 'b/evidence.md', sha256: sha256(blobBytes), bytes: blobBytes.length, blob: { repo: 'openai/synthetic', commit: 'a'.repeat(40), blobPath: 'docs/evidence.md' } }] },
  }));
  assert.equal(degraded.delivery.preservation, 'link-only', 'without a configured reader an exact blob is recorded link-only, never claimed preserved');
});

test('24h cleanup removes expired staging, keeps audit records and confirmed deliveries', async t => {
  const r = await rig(t);
  const content = Buffer.from('cleanup-body', 'utf8');
  const began = await beginAndUpload(r, 'k/body.txt', content);
  const preserved = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'preserved-key',
    manifest: { files: [{ path: 'k/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }] },
  }));
  assert.equal(preserved.delivery.preservation, 'preserved');
  const preservedPath = path.join(r.deliveryRoot, preserved.delivery.storage?.[0]?.relativePath ?? '');
  const abandonedSession = await r.preservation.beginFile({
    workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, principal: PRINCIPAL_A,
    logicalPath: 'k/abandoned.txt', totalBytes: 5, sha256: sha256('abandoned'),
  });
  const failed = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'failed-audit-key',
    manifest: { files: [{ path: 'k/abandoned.txt', sha256: sha256('abandoned'), bytes: 5, uploadId: abandonedSession.uploadId }] },
  }));
  assert.equal(failed.delivery.preservation, 'failed', 'missing chunks record a failed audit entry');
  const early = await r.preservation.cleanupExpiredStaging();
  assert.equal(early.cleanedUploadIds.length, 0, 'nothing is cleaned before the TTL');
  assert.ok(await stat(preservedPath).then(() => true).catch(() => false));
  r.clock.now += 25 * HOUR;
  const cleaned = await r.preservation.cleanupExpiredStaging();
  const staging = await readdir(path.join(r.deliveryRoot, 'staging'));
  assert.equal(staging.length, 0, 'expired staging sessions are removed after 24h');
  assert.ok(cleaned.cleanedUploadIds.length >= 1);
  assert.ok(await stat(preservedPath).then(() => true).catch(() => false), 'confirmed (preserved) deliveries are never deleted by cleanup');
  const storedPreserved = await r.store.getDelivery(preserved.delivery.deliveryId);
  const storedFailed = await r.store.getDelivery(failed.delivery.deliveryId);
  assert.equal(storedPreserved?.preservation, 'preserved', 'ledger audit records survive cleanup');
  assert.equal(storedFailed?.preservation, 'failed', 'failed audit metadata survives cleanup');
  assert.equal(storedFailed?.preservationReason, 'missing_pieces');
});

test('store: preservation state machine, storage fields and atomic claim/epoch/grant recheck', async t => {
  const r = await rig(t);
  const preserved = await r.store.recordPreservedDelivery({
    workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch,
    idempotencyKey: 'store-key-1', manifestHash: sha256('manifest'),
    preservation: 'preserved',
    storage: [{ logicalPath: 'a.txt', relativePath: 'd/commit/a.txt', sha256: sha256('a'), bytes: 1 }],
  });
  assert.equal(preserved.delivery.preservation, 'preserved');
  await expectDenied(r.store.recordPreservedDelivery({
    workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch,
    idempotencyKey: 'store-key-no-storage', manifestHash: sha256('manifest-2'),
    preservation: 'preserved', storage: [],
  }), 'external_delivery_invalid');
  await expectDenied(r.store.recordPreservedDelivery({
    workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: 99,
    idempotencyKey: 'store-key-epoch', manifestHash: sha256('m3'), preservation: 'link-only',
    links: [{ logicalPath: 'l.txt', url: 'https://x.example.invalid/' }],
  }), 'external_delivery_epoch_conflict');
  await r.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'setup' });
  await expectDenied(r.store.recordPreservedDelivery({
    workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch,
    idempotencyKey: 'store-key-released', manifestHash: sha256('m4'), preservation: 'failed', preservationReason: 'x',
  }), 'external_delivery_claim_invalid');
  const claim2 = await r.store.recordClaim({ workId: 'work-1', revision: 1, principal: PRINCIPAL_B, leaseDeadline: iso(r.clock.now + 15 * 60_000) });
  r.clock.now += 49 * HOUR;
  await expectDenied(r.store.recordPreservedDelivery({
    workId: 'work-1', revision: 1, claimId: claim2.claim.claimId, epoch: claim2.claim.epoch,
    idempotencyKey: 'store-key-grant', manifestHash: sha256('m5'), preservation: 'preserved',
    storage: [{ logicalPath: 'a.txt', relativePath: 'd/commit/a.txt', sha256: sha256('a'), bytes: 1 }],
  }), 'external_grant_not_valid');
  // 已保留记录跨重载完整回读（schema 兼容）。
  const reloaded = new ExternalWorkStore({ dataRoot: r.root, now: () => r.clock.now });
  await reloaded.init();
  const roundTrip = await reloaded.getDelivery(preserved.delivery.deliveryId);
  assert.equal(roundTrip?.preservation, 'preserved');
  assert.deepEqual(roundTrip?.storage?.[0]?.relativePath, 'd/commit/a.txt');
  assert.equal(roundTrip?.late, false);
});

test('store: recordLateDelivery keeps ledger invariants; old ledgers without new fields parse unchanged', async t => {
  const r = await rig(t);
  const manifestHash = sha256('late-manifest');
  await r.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'setup' });
  const late = await r.store.recordLateDelivery({
    workId: 'work-1', revision: 1, claimId: r.claim.claimId, idempotencyKey: 'late-store-key', manifestHash,
  });
  assert.equal(late.delivery.late, true);
  assert.equal(late.delivery.preservation, 'pending');
  const replay = await r.store.recordLateDelivery({
    workId: 'work-1', revision: 1, claimId: r.claim.claimId, idempotencyKey: 'late-store-key', manifestHash,
  });
  assert.equal(replay.idempotent, true);
  await expectDenied(r.store.recordLateDelivery({
    workId: 'work-1', revision: 1, claimId: r.claim.claimId, idempotencyKey: 'late-store-key', manifestHash: sha256('other'),
  }), 'external_delivery_conflict');
  await expectDenied(r.store.recordLateDelivery({
    workId: 'work-1', revision: 1, claimId: 'claim-ghost', idempotencyKey: 'late-dangling', manifestHash,
  }), 'external_delivery_claim_invalid');
  const activeClaim = await r.store.recordClaim({ workId: 'work-1', revision: 1, principal: PRINCIPAL_A, leaseDeadline: iso(r.clock.now + 15 * 60_000) });
  await expectDenied(r.store.recordLateDelivery({
    workId: 'work-1', revision: 1, claimId: activeClaim.claim.claimId, idempotencyKey: 'late-active', manifestHash,
  }), 'external_delivery_epoch_conflict');
  // 旧账本（无 storage/links/preservationReason 字段）原样解析。
  const ledger = JSON.parse(await readFile(r.store.file, 'utf8')) as { deliveries: Array<Record<string, unknown>> };
  for (const delivery of ledger.deliveries) {
    delete delivery.storage; delete delivery.links; delete delivery.preservationReason;
    if (delivery.preservation === 'preserved') delivery.preservation = 'pending';
  }
  const oldRoot = await mkdtemp(path.join(tmpdir(), 'optracall-s4a-old-ledger-'));
  t.after(() => rm(oldRoot, { recursive: true, force: true }));
  await mkdir(path.join(oldRoot, 'external-work'), { recursive: true });
  await writeFile(path.join(oldRoot, 'external-work', 'ledger.json'), JSON.stringify(ledger));
  const oldStore = new ExternalWorkStore({ dataRoot: oldRoot, now: () => r.clock.now });
  await oldStore.init();
  const parsed = await oldStore.getDelivery(String(ledger.deliveries[0]!.deliveryId));
  assert.equal(parsed?.preservation, 'pending', 'old records keep parsing with the old semantics');
});

test('external delivery receipts never masquerade as native report receipts', async t => {
  const r = await rig(t);
  const content = Buffer.from('no-native', 'utf8');
  const began = await beginAndUpload(r, 'n/body.txt', content);
  const receipt = await r.preservation.commit(commitArgs(r, {
    idempotencyKey: 'no-native-key',
    manifest: { files: [{ path: 'n/body.txt', sha256: sha256(content), bytes: content.length, uploadId: began.uploadId }] },
  }));
  const text = JSON.stringify(receipt);
  for (const nativeMark of ['optracall.project-report-write', 'ProjectTaskResultBinding', 'writeBoundReport', '060_reports']) {
    assert.ok(!text.includes(nativeMark), `external delivery receipts must not reference native machinery: ${nativeMark}`);
  }
  assert.equal(receipt.delivery.preservation, 'preserved');
});

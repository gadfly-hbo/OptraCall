import { constants } from 'node:fs';
import path from 'node:path';
import { chmod, link, lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { ExternalWorkStore } from './external-work-store.ts';
import { ExternalWorkError } from './external-work-types.ts';
import type {
  ExternalAssetRef, ExternalDeliveryFacts, ExternalDeliveryLinkEntry, ExternalDeliveryRef,
  ExternalDeliveryStorageEntry, ExternalWork, WorkGrant, Claim,
} from './external-work-types.ts';
import { parseExternalAssetRefs } from './external-work-types.ts';
import { canonicalAssetRef, sha256Hex } from './external-mcp/intersection.ts';

/**
 * S4a 交付字节保全（Issue #155 spec §8 / AB11）。
 *
 * Host 职责：为外部执行者的交付提供受控分块传输、完整 manifest 校验与原子宿主保存，
 * 保存到 Host 分配的 external-delivery 路径（dataRoot/external-delivery 之下），绝不写入
 * native 060_reports、绝不伪 native ProjectTaskResultBinding 收据；交付台账是独立的
 * ExternalDeliveryRef（S1 store 扩展，schema 兼容）。
 *
 * 限额（spec §8，与原工具/供应商上限取低）：原始上传片段 ≤512KiB、单请求参数 ≤1MiB、
 * manifest/正文 ≤256KiB、单交付 ≤20 文件/累计 100MiB、单文件 ≤50MiB。
 *
 * 保全语义：开始/分片/提交幂等（同键同内容回原收据，异内容冲突）；写前（每个分片）及
 * 保存后提交前（store 原子变体内）核当前领取/授权（claim active/epoch/grant 窗口）；
 * 部分上传/过期领取不可标完整；preservation 状态机 pending→preserved/failed/link-only；
 * 缺件/字节 hash 不符记 failed（零半份：先全量验证后保存，保存中途失败回滚本次全部链接）；
 * 精确 GitHub blob（原授权仓库+完整 commit sha）经注入接缝读取核 hash，其余外链只标
 * link-only，绝不下载任意 URL；未完成分片 24h 清理，台账与已确认交付永不因清理删除。
 */

export const EXTERNAL_DELIVERY_LIMITS = Object.freeze({
  maxChunkBytes: 512 * 1024,
  maxArgsBytes: 1024 * 1024,
  maxManifestBytes: 256 * 1024,
  maxFiles: 20,
  maxTotalBytes: 100 * 1024 * 1024,
  maxSingleFileBytes: 50 * 1024 * 1024,
  incompleteTtlMs: 24 * 60 * 60 * 1000,
});

/** 精确 GitHub blob 读取接缝（原授权仓库+完整 commit）；真实装配属后续接线切片。 */
export type GithubBlobReader = (input: { repo: string; commit: string; path: string }) => Promise<{ bytes: Buffer; sha256: string }>;

export type NormalizedManifestEntry =
  | { path: string; sha256: string; bytes: number }
  | { path: string; sha256: string; bytes: number; uploadId: string }
  | { path: string; sha256: string; bytes: number; blob: { repo: string; commit: string; blobPath: string } }
  | { path: string; link: string };

const denied = (code: string, status: number, description: string): ExternalWorkError => new ExternalWorkError(code, status);
const SHA256_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_META_BYTES = 64 * 1024;

/** 交付逻辑路径仅接受安全相对名；存储路径由 Host 分配。 */
export function validDeliveryPath(path: string): boolean {
  if (typeof path !== 'string' || !path.length || path.length > 300) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** spec §8：交付必须报告 done/notDone/failed/unknown；缺报即拒。 */
export function validateDeliveryFacts(value: unknown): ExternalDeliveryFacts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw denied('external_delivery_facts_required', 400, 'a delivery must report done/notDone/failed/unknown facts');
  const raw = value as Record<string, unknown>;
  const list = (key: string): string[] => {
    const item = raw[key];
    if (!Array.isArray(item)) throw denied('external_delivery_facts_required', 400, `facts.${key} must be an array`);
    if (item.some(entry => typeof entry !== 'string')) throw denied('external_delivery_facts_invalid', 400, `facts.${key} must contain strings only`);
    return item as string[];
  };
  return { done: list('done'), notDone: list('notDone'), failed: list('failed'), unknown: list('unknown') };
}

export function parseDeliveryAssetsUsed(value: unknown): ExternalAssetRef[] {
  if (value === undefined) return [];
  try { return parseExternalAssetRefs(value); } catch { throw denied('external_delivery_assets_invalid', 400, 'assetsUsed must be exact authority/id/version/hash refs'); }
}

/**
 * manifest 限额与路径校验；manifestHash 为规范化内容承诺（按 path 排序，同集合同序无关）。
 * restricted（work.deliver，S3b 兼容语义）：条目只能声明 path/sha256/bytes，出现
 * url/uploadId/blob/link 一律拒绝。extended（delivery.commit）：每条目必须声明恰好一个
 * 来源 uploadId | blob | link；url 永远拒绝（绝不下载）。
 */
export function validateDeliveryManifest(value: unknown, options: { extended: boolean }): { manifestHash: string; entries: NormalizedManifestEntry[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw denied('external_delivery_manifest_invalid', 400, 'manifest must be an object with a files array');
  const manifest = value as { files?: unknown };
  if (!Array.isArray(manifest.files)) throw denied('external_delivery_manifest_invalid', 400, 'manifest.files must be an array');
  if (manifest.files.length > EXTERNAL_DELIVERY_LIMITS.maxFiles) throw denied('external_delivery_limit_exceeded', 413, 'a delivery carries at most 20 files');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > EXTERNAL_DELIVERY_LIMITS.maxManifestBytes) throw denied('external_delivery_manifest_limit', 413, 'the manifest exceeds the 256KiB ceiling');
  if (options.extended && manifest.files.length < 1) throw denied('external_delivery_manifest_invalid', 400, 'a byte-preservation commit must declare at least one file');
  let total = 0;
  const normalized: NormalizedManifestEntry[] = [];
  const seenPaths = new Set<string>();
  const byteEntry = (file: Record<string, unknown>): { sha256: string; bytes: number } => {
    const hash = file.sha256, bytes = file.bytes;
    if (typeof hash !== 'string' || !SHA256_RE.test(hash)) throw denied('external_delivery_manifest_invalid', 400, 'each file needs an exact sha256');
    if (!Number.isSafeInteger(bytes) || (bytes as number) < 0) throw denied('external_delivery_manifest_invalid', 400, 'file bytes must be a non-negative integer');
    if ((bytes as number) > EXTERNAL_DELIVERY_LIMITS.maxSingleFileBytes) throw denied('external_delivery_limit_exceeded', 413, 'a single file exceeds the 50MiB ceiling');
    total += bytes as number;
    if (total > EXTERNAL_DELIVERY_LIMITS.maxTotalBytes) throw denied('external_delivery_limit_exceeded', 413, 'a delivery totals at most 100MiB');
    return { sha256: hash, bytes: bytes as number };
  };
  for (const entry of manifest.files) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw denied('external_delivery_manifest_invalid', 400, 'each manifest entry must be an object');
    const file = entry as Record<string, unknown>;
    if ('url' in file) throw denied('external_delivery_url_rejected', 400, 'deliveries never fetch material from arbitrary URLs');
    const filePath = file.path;
    if (!validDeliveryPath(filePath as string)) throw denied('external_delivery_path_rejected', 400, 'delivery paths are logical names; Host assigns storage paths and rejects arbitrary local paths');
    const path = filePath as string;
    if (seenPaths.has(path)) throw denied('external_delivery_manifest_invalid', 400, 'each logical path may appear at most once');
    seenPaths.add(path);
    if (options.extended) {
      const sources = (['uploadId', 'blob', 'link'] as const).filter(key => key in file && file[key] !== undefined);
      if (sources.length !== 1) throw denied('external_delivery_manifest_invalid', 400, 'each commit entry declares exactly one of uploadId, blob or link');
      if (sources[0] === 'link') {
        const linkUrl = file.link;
        if (typeof linkUrl !== 'string' || linkUrl.length > 2000 || !/^https?:\/\/\S+$/.test(linkUrl)) throw denied('external_delivery_manifest_invalid', 400, 'link entries must be a single http(s) URL and are never fetched');
        normalized.push({ path, link: linkUrl });
        continue;
      }
      const exact = byteEntry(file);
      if (sources[0] === 'uploadId') {
        if (typeof file.uploadId !== 'string' || !UUID_RE.test(file.uploadId)) throw denied('external_delivery_manifest_invalid', 400, 'uploadId must reference an opened upload session');
        normalized.push({ path, sha256: exact.sha256, bytes: exact.bytes, uploadId: file.uploadId });
      } else {
        const blob = file.blob;
        if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) throw denied('external_delivery_manifest_invalid', 400, 'blob entries need an exact repo/commit/blobPath reference');
        const ref = blob as Record<string, unknown>;
        if (Object.keys(ref).some(key => !['repo', 'commit', 'blobPath'].includes(key))) throw denied('external_delivery_manifest_invalid', 400, 'blob entries need an exact repo/commit/blobPath reference');
        if (typeof ref.repo !== 'string' || !ref.repo || ref.repo.length > 300) throw denied('external_delivery_manifest_invalid', 400, 'blob entries need an exact repository');
        if (typeof ref.commit !== 'string' || !/^[0-9a-f]{40}$/.test(ref.commit)) throw denied('external_delivery_blob_commit_invalid', 400, 'blob refs must cite an exact commit sha; branches are never resolved');
        if (!validDeliveryPath(ref.blobPath as string)) throw denied('external_delivery_manifest_invalid', 400, 'blob paths must be safe repository-relative names');
        normalized.push({ path, sha256: exact.sha256, bytes: exact.bytes, blob: { repo: ref.repo, commit: ref.commit, blobPath: ref.blobPath as string } });
      }
    } else {
      if ('uploadId' in file || 'blob' in file || 'link' in file) throw denied('external_delivery_manifest_invalid', 400, 'manifest-only deliveries declare path/sha256/bytes only');
      const exact = byteEntry(file);
      normalized.push({ path, sha256: exact.sha256, bytes: exact.bytes });
    }
  }
  const canonical = JSON.stringify({ files: [...normalized].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) });
  return { manifestHash: sha256Hex(canonical), entries: normalized };
}

interface UploadSessionMeta {
  uploadId: string;
  workId: string;
  claimId: string;
  principal: string;
  logicalPath: string;
  totalBytes: number;
  sha256: string;
  chunkBytes: number;
  totalChunks: number;
  createdAt: string;
}

export interface ExternalDeliveryPreservationOptions {
  store: ExternalWorkStore;
  dataRoot: string;
  now?: () => number;
  readGithubBlob?: GithubBlobReader;
  /** 测试/监控接缝：每个文件 hardlink 发布前调用；抛错即注入保存失败（回滚本次全部链接）。 */
  hooks?: { beforeLink?: (info: { logicalPath: string }) => Promise<void> | void };
}

interface Authorization {
  work: ExternalWork;
  claim: Claim;
  grant: WorkGrant;
  active: boolean;
}

const chunkName = (index: number): string => String(index).padStart(6, '0');

export class ExternalDeliveryPreservation {
  readonly dataRoot: string;
  readonly root: string;
  readonly #store: ExternalWorkStore;
  readonly #now: () => number;
  readonly #readGithubBlob?: GithubBlobReader;
  readonly #hooks: { beforeLink?: (info: { logicalPath: string }) => Promise<void> | void };
  readonly #staging: string;
  readonly #deliveryTree: string;
  #ensurePromise: Promise<void> | undefined;
  #beginChain: Promise<unknown> = Promise.resolve();
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(options: ExternalDeliveryPreservationOptions) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#readGithubBlob = options.readGithubBlob;
    this.#hooks = options.hooks ?? {};
    this.dataRoot = options.dataRoot;
    this.root = `${options.dataRoot}/external-delivery`;
    this.#staging = `${this.root}/staging`;
    this.#deliveryTree = `${this.root}/d`;
  }

  /** 目录安全性：0700、非符号链接；可显式调用，公开方法亦会惰性确保。 */
  async init(): Promise<void> { await this.#ensure(); }

  async #ensure(): Promise<void> {
    if (!this.#ensurePromise) this.#ensurePromise = this.#createDirectories();
    await this.#ensurePromise;
  }

  async #createDirectories(): Promise<void> {
    for (const directory of [this.root, this.#staging, this.#deliveryTree]) await this.#safeDirectory(directory);
  }

  async #safeDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw denied('external_delivery_unsafe', 503, 'the external-delivery storage tree must be real directories');
    await chmod(directory, 0o700);
  }

  /** 同一会话的分片写串行，begin 走独立链：同键异内容的并发写不可能交错覆盖。 */
  #serialize<T>(key: string | null, operation: () => Promise<T>): Promise<T> {
    if (key === null) {
      const run = this.#beginChain.then(operation, operation);
      this.#beginChain = run.catch(() => {});
      return run;
    }
    const prior = this.#chains.get(key) ?? Promise.resolve();
    const run = prior.then(operation, operation);
    const tail = run.catch(() => {});
    this.#chains.set(key, tail);
    void tail.then(() => { if (this.#chains.get(key) === tail) this.#chains.delete(key); });
    return run;
  }

  #stamp(): string { return new Date(this.#now()).toISOString(); }

  /**
   * 领取/授权核对（spec §8）：服务端核验 principal ∩ 真实 work/claim ∩ grant 可解析；
   * 非 active 领取只用于迟到隔离证据路径；active 领取再依次核 grant 窗口→租约→epoch→
   * 当前 revision→未取消（grant 先于租约：授权失效最优先拒绝）。
   */
  async #authorize(input: { workId: string; revision?: number; claimId: string; epoch: number; principal: string }): Promise<Authorization> {
    const work = await this.#store.getWork(input.workId);
    if (!work) throw denied('external_work_not_found', 404, 'no such work');
    const claim = await this.#store.getClaim(input.claimId);
    const revision = input.revision ?? claim?.revision;
    if (!claim || claim.workId !== work.workId || claim.revision !== revision) throw denied('external_delivery_claim_invalid', 409, 'the delivery must cite a real claim of this work revision');
    if (claim.principal !== input.principal) throw denied('external_work_claim_not_owned', 403, 'only the claimant may deliver or upload; foreign material is never accepted via a borrowed claim id');
    const grant = await this.#store.getGrant(work.grantId);
    if (!grant || grant.grantVersion !== work.grantVersion) throw denied('external_grant_not_valid', 409, 'the referenced authorization is not resolvable');
    if (claim.status !== 'active') return { work, claim, grant, active: false };
    const now = this.#now();
    if (!(Date.parse(grant.validFrom) <= now && now < Date.parse(grant.validUntil))) throw denied('external_grant_not_valid', 409, 'the authorization window is not currently valid');
    if (Date.parse(claim.leaseDeadline) <= now) throw denied('external_claim_expired', 409, 'the claim lease has lapsed; completion is refused');
    if (claim.epoch !== input.epoch) throw denied('external_delivery_epoch_conflict', 409, 'the epoch does not match the current lease');
    if (claim.revision !== work.revision) throw denied('external_work_claim_stale_revision', 409, 'an old-revision claim lost validity; claim the current revision');
    if (work.status === 'cancelled') throw denied('external_work_cancelled', 409, 'the work has been cancelled');
    return { work, claim, grant, active: true };
  }

  async beginFile(input: { workId: string; claimId: string; epoch: number; principal: string; logicalPath: string; totalBytes: number; sha256: string }): Promise<{ uploadId: string; chunkBytes: number; totalChunks: number; idempotent: boolean }> {
    await this.#ensure();
    if (!validDeliveryPath(input.logicalPath)) throw denied('external_delivery_path_rejected', 400, 'delivery paths are logical names; Host assigns storage paths and rejects arbitrary local paths');
    if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes < 1 || input.totalBytes > EXTERNAL_DELIVERY_LIMITS.maxSingleFileBytes) throw denied('external_delivery_limit_exceeded', 413, 'a single uploaded file is at most 50MiB');
    if (typeof input.sha256 !== 'string' || !SHA256_RE.test(input.sha256)) throw denied('external_delivery_manifest_invalid', 400, 'the upload must declare the exact final sha256');
    return this.#serialize(null, async () => {
      const auth = await this.#authorize({ workId: input.workId, claimId: input.claimId, epoch: input.epoch, principal: input.principal });
      if (!auth.active) throw denied('external_delivery_claim_invalid', 409, 'chunked upload requires the current active claim');
      const sessions = await this.#scanSessions();
      const sameFile = sessions.filter(item => item.claimId === input.claimId && item.logicalPath === input.logicalPath);
      const identical = sameFile.find(item => item.totalBytes === input.totalBytes && item.sha256 === input.sha256);
      if (identical) return { uploadId: identical.uploadId, chunkBytes: identical.chunkBytes, totalChunks: identical.totalChunks, idempotent: true };
      if (sameFile.length) throw denied('external_delivery_upload_conflict', 409, 'this file was already opened for upload with different content');
      const staged = sessions.filter(item => item.claimId === input.claimId).reduce((sum, item) => sum + item.totalBytes, 0);
      if (staged + input.totalBytes > EXTERNAL_DELIVERY_LIMITS.maxTotalBytes) throw denied('external_delivery_limit_exceeded', 413, 'staged uploads of one claim total at most 100MiB');
      const uploadId = randomUUID();
      const meta: UploadSessionMeta = {
        uploadId, workId: input.workId, claimId: input.claimId, principal: input.principal,
        logicalPath: input.logicalPath, totalBytes: input.totalBytes, sha256: input.sha256,
        chunkBytes: EXTERNAL_DELIVERY_LIMITS.maxChunkBytes,
        totalChunks: Math.max(1, Math.ceil(input.totalBytes / EXTERNAL_DELIVERY_LIMITS.maxChunkBytes)),
        createdAt: this.#stamp(),
      };
      await this.#safeDirectory(path.join(this.#staging, uploadId, 'chunks'));
      await this.#writeAtomic(path.join(this.#staging, uploadId, 'meta.json'), Buffer.from(JSON.stringify(meta), 'utf8'));
      return { uploadId, chunkBytes: meta.chunkBytes, totalChunks: meta.totalChunks, idempotent: false };
    });
  }

  async writeChunk(input: { uploadId: string; workId: string; claimId: string; epoch: number; principal: string; offset: number; sha256: string; bytesBase64: string }): Promise<{ uploadId: string; offset: number; idempotent: boolean }> {
    await this.#ensure();
    if (typeof input.bytesBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.bytesBase64)) throw denied('external_delivery_chunk_invalid', 400, 'chunk bytes must be standard base64');
    const decoded = Buffer.from(input.bytesBase64, 'base64');
    if (decoded.length > EXTERNAL_DELIVERY_LIMITS.maxChunkBytes) throw denied('external_delivery_limit_exceeded', 413, 'a raw upload chunk is at most 512KiB');
    return this.#serialize(input.uploadId, async () => {
      // 写前核当前领取/授权（spec §8）；他人借 claimId 上传一律按归属拒绝。
      const auth = await this.#authorize({ workId: input.workId, claimId: input.claimId, epoch: input.epoch, principal: input.principal });
      if (!auth.active) throw denied('external_delivery_claim_invalid', 409, 'chunked upload requires the current active claim');
      const meta = await this.#readSession(input.uploadId);
      if (meta.workId !== input.workId || meta.claimId !== input.claimId || meta.principal !== input.principal) throw denied('external_delivery_upload_unknown', 404, 'no such upload session for this claim');
      if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset >= meta.totalBytes) throw denied('external_delivery_offset_invalid', 400, 'the offset is outside the upload plan');
      if (input.offset % meta.chunkBytes !== 0) throw denied('external_delivery_offset_invalid', 400, 'offsets must be chunk-aligned');
      const index = input.offset / meta.chunkBytes;
      // 同键异内容冲突优先于长度计划：同一偏移既已写入即按实际内容裁定。
      if (typeof input.sha256 !== 'string' || !SHA256_RE.test(input.sha256)) throw denied('external_delivery_chunk_invalid', 400, 'each chunk needs an exact sha256');
      const actualSha = createHash('sha256').update(decoded).digest('hex');
      if (input.sha256 !== actualSha) throw denied('external_delivery_chunk_conflict', 409, 'the chunk bytes do not match the declared hash');
      const chunkFile = path.join(this.#staging, meta.uploadId, 'chunks', chunkName(index));
      const existing = await this.#readFileNoFollow(chunkFile).catch(() => null);
      if (existing) {
        if (createHash('sha256').update(existing).digest('hex') === actualSha) return { uploadId: meta.uploadId, offset: input.offset, idempotent: true };
        throw denied('external_delivery_chunk_conflict', 409, 'the same offset was already written with different content');
      }
      const expectedLength = Math.min(meta.chunkBytes, meta.totalBytes - input.offset);
      if (decoded.length !== expectedLength) throw denied('external_delivery_limit_exceeded', 413, 'chunk length must match the upload plan');
      await this.#writeAtomic(chunkFile, decoded);
      return { uploadId: meta.uploadId, offset: input.offset, idempotent: false };
    });
  }

  async commit(input: { workId: string; revision: number; claimId: string; epoch: number; principal: string; idempotencyKey: string; manifest: unknown; facts?: unknown; assetsUsed?: unknown }): Promise<{ delivery: ExternalDeliveryRef; idempotent: boolean; late: boolean }> {
    await this.#ensure();
    const { manifestHash, entries } = validateDeliveryManifest(input.manifest, { extended: true });
    const facts = validateDeliveryFacts(input.facts);
    const assetsUsed = parseDeliveryAssetsUsed(input.assetsUsed);
    const auth = await this.#authorize({ workId: input.workId, revision: input.revision, claimId: input.claimId, epoch: input.epoch, principal: input.principal });
    if (assetsUsed.length) {
      const allow = new Set((auth.grant?.assetRefs ?? []).map(canonicalAssetRef));
      if (assetsUsed.some(item => !allow.has(canonicalAssetRef(item)))) throw denied('external_delivery_asset_out_of_scope', 403, 'declared asset use exceeds the exact authorization allowlist');
    }
    // 迟到隔离路径（与 S3b work.deliver 回并到 store 同一不变式）：非 active 领取只落隔离证据，不保字节。
    // 幂等短路先于 active/迟到分支：已受理的交付重放同键同内容回原收据（含领取已释放后的重试）。
    const existing = await this.#store.findDeliveryByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.manifestHash !== manifestHash) throw denied('external_delivery_conflict', 409, 'the idempotency key was used with different content');
      return { delivery: existing, idempotent: true, late: existing.late };
    }
    if (!auth.active) {
      const late = await this.#store.recordLateDelivery({ workId: auth.work.workId, revision: auth.claim.revision, claimId: auth.claim.claimId, idempotencyKey: input.idempotencyKey, manifestHash, assetsUsed, facts });
      return { delivery: late.delivery, idempotent: late.idempotent, late: true };
    }
    // 全量验证后才落盘（缺件/hash 不符 → 记 failed，零半份）。
    const prepared: Array<{ logicalPath: string; sha256: string; bytes: number; data: Buffer }> = [];
    const links: ExternalDeliveryLinkEntry[] = [];
    let failureReason: string | undefined;
    for (const entry of entries) {
      if ('link' in entry) { links.push({ logicalPath: entry.path, url: entry.link }); continue; }
      if ('uploadId' in entry) {
        const meta = await this.#readSession(entry.uploadId);
        if (meta.claimId !== auth.claim.claimId || meta.workId !== auth.work.workId || meta.principal !== input.principal) { failureReason ??= 'missing_pieces'; break; }
        if (meta.logicalPath !== entry.path || meta.totalBytes !== entry.bytes || meta.sha256 !== entry.sha256) throw denied('external_delivery_manifest_invalid', 400, 'the manifest must match the opened upload session exactly');
        const data = await this.#assemble(meta);
        if (!data) { failureReason ??= 'missing_pieces'; break; }
        if (createHash('sha256').update(data).digest('hex') !== entry.sha256 || data.length !== entry.bytes) { failureReason ??= 'content_hash_mismatch'; break; }
        prepared.push({ logicalPath: entry.path, sha256: entry.sha256, bytes: entry.bytes, data });
        continue;
      }
      if ('blob' in entry) {
        if (entry.blob.repo !== auth.grant.repository.stableId) throw denied('external_delivery_blob_out_of_scope', 403, 'exact GitHub blob reads are limited to the originally authorized repository');
        if (!/^[0-9a-f]{40}$/.test(entry.blob.commit)) throw denied('external_delivery_blob_commit_invalid', 400, 'blob refs must cite an exact commit sha; branches are never resolved');
        let data: Buffer | null = null;
        if (this.#readGithubBlob) {
          try {
            const result = await this.#readGithubBlob({ repo: entry.blob.repo, commit: entry.blob.commit, path: entry.blob.blobPath });
            if (result.sha256 === entry.sha256 && result.bytes.length === entry.bytes && createHash('sha256').update(result.bytes).digest('hex') === entry.sha256) data = Buffer.from(result.bytes);
          } catch { data = null; }
        }
        if (data) { prepared.push({ logicalPath: entry.path, sha256: entry.sha256, bytes: entry.bytes, data }); continue; }
        if (this.#readGithubBlob) { failureReason ??= 'blob_hash_mismatch'; break; }
        // 未配置读取接缝/读取失败：该条目只能标"仅链接/待保全"，绝不冒充字节已验。
        links.push({ logicalPath: entry.path, url: `https://github.com/${entry.blob.repo}/blob/${entry.blob.commit}/${entry.blob.blobPath}` });
        continue;
      }
      failureReason ??= 'missing_pieces';
      break;
    }
    if (failureReason !== undefined) {
      const failed = await this.#store.recordPreservedDelivery({
        workId: auth.work.workId, revision: auth.claim.revision, claimId: auth.claim.claimId, epoch: input.epoch,
        idempotencyKey: input.idempotencyKey, manifestHash, preservation: 'failed', preservationReason: failureReason, assetsUsed, facts,
      });
      return { delivery: failed.delivery, idempotent: failed.idempotent, late: false };
    }
    // 原子宿主保存：镜像 writeBoundReport（staging tmp O_EXCL|O_NOFOLLOW 0600 → write+fsync →
    // 目录身份核 → hardlink publish → re-read hash 核对）；任一文件失败回滚本次全部链接。
    const commitId = randomUUID();
    const saved: Array<ExternalDeliveryStorageEntry & { ino: bigint; dev: bigint }> = [];
    let saveFailed = false;
    try {
      for (const file of prepared) saved.push(await this.#saveFile(commitId, file));
    } catch {
      // 保存失败（含注入的发布前钩子）：回滚本次全部链接，零半份；随后记 failed 供审计。
      saveFailed = true;
      await this.#rollback(commitId, saved);
    }
    if (saveFailed) {
      const failed = await this.#store.recordPreservedDelivery({
        workId: auth.work.workId, revision: auth.claim.revision, claimId: auth.claim.claimId, epoch: input.epoch,
        idempotencyKey: input.idempotencyKey, manifestHash, preservation: 'failed', preservationReason: 'save_failed', assetsUsed, facts,
      });
      return { delivery: failed.delivery, idempotent: failed.idempotent, late: false };
    }
    const storage = saved.length ? saved.map(({ ino: _ino, dev: _dev, ...entry }) => entry) : undefined;
    let recorded: { delivery: ExternalDeliveryRef; idempotent: boolean };
    try {
      // store 原子变体内复核当前领取/授权（异步保存后提交前核，spec §8）。
      recorded = await this.#store.recordPreservedDelivery({
        workId: auth.work.workId, revision: auth.claim.revision, claimId: auth.claim.claimId, epoch: input.epoch,
        idempotencyKey: input.idempotencyKey, manifestHash,
        preservation: links.length ? 'link-only' : 'preserved',
        storage, links: links.length ? links : undefined, assetsUsed, facts,
      });
    } catch (error) {
      // 保存后领取/授权失效：不可标完整——回滚已发布链接，转隔离迟到证据（若领取确已失效）。
      await this.#rollback(commitId, saved);
      if (error instanceof ExternalWorkError && ['external_delivery_claim_invalid', 'external_delivery_epoch_conflict'].includes(error.code)) {
        try {
          const late = await this.#store.recordLateDelivery({ workId: auth.work.workId, revision: auth.claim.revision, claimId: auth.claim.claimId, idempotencyKey: input.idempotencyKey, manifestHash, assetsUsed, facts });
          return { delivery: late.delivery, idempotent: late.idempotent, late: true };
        } catch { /* 领取仍 active（如仅 grant 过期）→ 原错误为准 */ }
      }
      throw error;
    }
    // 已保全交付：引用过的上传会话分片即刻清理；未引用会话留待 TTL 清理。
    for (const entry of entries) {
      if ('uploadId' in entry) await rm(path.join(this.#staging, entry.uploadId), { recursive: true, force: true }).catch(() => {});
    }
    return { delivery: recorded.delivery, idempotent: recorded.idempotent, late: false };
  }

  /** 24h 清理：仅删除过期未完成分片会话与孤儿临时文件；台账与已保全字节永不触碰。 */
  async cleanupExpiredStaging(): Promise<{ cleanedUploadIds: string[]; cleanedTemporaryFiles: number }> {
    await this.#ensure();
    const cleanedUploadIds: string[] = [];
    const entries = await readdir(this.#staging).catch(() => [] as string[]);
    for (const name of entries) {
      if (!UUID_RE.test(name)) continue;
      const directory = path.join(this.#staging, name);
      const entry = await lstat(directory).catch(() => null);
      if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const meta = await this.#readSession(name).catch(() => null);
      const createdAt = meta ? Date.parse(meta.createdAt) : entry.mtimeMs;
      if (Number.isFinite(createdAt) && this.#now() - createdAt > EXTERNAL_DELIVERY_LIMITS.incompleteTtlMs) {
        await rm(directory, { recursive: true, force: true }).catch(() => {});
        cleanedUploadIds.push(name);
      }
    }
    const cleanedTemporaryFiles = await this.#sweepTemporary(this.#deliveryTree, 0);
    return { cleanedUploadIds, cleanedTemporaryFiles };
  }

  async #sweepTemporary(directory: string, depth: number): Promise<number> {
    if (depth > 16) return 0;
    let removed = 0;
    const names = await readdir(directory).catch(() => [] as string[]);
    for (const name of names) {
      const full = path.join(directory, name);
      const entry = await lstat(full).catch(() => null);
      if (!entry) continue;
      if (entry.isDirectory() && !entry.isSymbolicLink()) removed += await this.#sweepTemporary(full, depth + 1);
      else if (entry.isFile() && name.startsWith('.delivery-') && name.endsWith('.tmp') && this.#now() - entry.mtimeMs > EXTERNAL_DELIVERY_LIMITS.incompleteTtlMs) {
        await unlink(full).catch(() => {});
        removed += 1;
      }
    }
    return removed;
  }

  async #scanSessions(): Promise<UploadSessionMeta[]> {
    const names = await readdir(this.#staging).catch(() => [] as string[]);
    const sessions: UploadSessionMeta[] = [];
    for (const name of names) {
      if (!UUID_RE.test(name)) continue;
      const meta = await this.#readSession(name).catch(() => null);
      if (meta) sessions.push(meta);
    }
    return sessions;
  }

  async #readSession(uploadId: string): Promise<UploadSessionMeta> {
    if (typeof uploadId !== 'string' || !UUID_RE.test(uploadId)) throw denied('external_delivery_upload_unknown', 404, 'no such upload session');
    const raw = await this.#readFileNoFollow(path.join(this.#staging, uploadId, 'meta.json')).catch(() => null);
    if (!raw || raw.byteLength > MAX_META_BYTES) throw denied('external_delivery_upload_unknown', 404, 'no such upload session');
    try {
      const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as Record<string, unknown>;
      const keys = ['uploadId', 'workId', 'claimId', 'principal', 'logicalPath', 'totalBytes', 'sha256', 'chunkBytes', 'totalChunks', 'createdAt'];
      if (keys.some(key => typeof meta[key] !== 'string' && typeof meta[key] !== 'number') || meta.uploadId !== uploadId) throw new Error();
      if (!validDeliveryPath(meta.logicalPath as string)) throw new Error();
      if (!SHA256_RE.test(meta.sha256 as string) || !Number.isSafeInteger(meta.totalBytes) || (meta.totalBytes as number) < 1) throw new Error();
      if ((meta.totalBytes as number) > EXTERNAL_DELIVERY_LIMITS.maxSingleFileBytes || (meta.chunkBytes as number) !== EXTERNAL_DELIVERY_LIMITS.maxChunkBytes) throw new Error();
      if (!Number.isSafeInteger(meta.totalChunks) || (meta.totalChunks as number) < 1 || !Number.isFinite(Date.parse(meta.createdAt as string))) throw new Error();
      return meta as unknown as UploadSessionMeta;
    } catch {
      throw denied('external_delivery_upload_unknown', 404, 'the upload session metadata is unreadable and will be cleaned up');
    }
  }

  async #assemble(meta: UploadSessionMeta): Promise<Buffer | null> {
    const parts: Buffer[] = [];
    for (let index = 0; index < meta.totalChunks; index += 1) {
      const chunk = await this.#readFileNoFollow(path.join(this.#staging, meta.uploadId, 'chunks', chunkName(index))).catch(() => null);
      if (!chunk) return null;
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }

  async #readFileNoFollow(file: string): Promise<Buffer> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const entry = await handle.stat();
      if (!entry.isFile() || entry.nlink !== 1) throw denied('external_delivery_unsafe', 503, 'staged files must be regular single-link files');
      return await handle.readFile();
    } finally { await handle.close(); }
  }

  async #writeAtomic(file: string, bytes: Buffer): Promise<void> {
    const temporary = path.join(path.dirname(file), `.stage-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, file);
    } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  }

  /** 镜像 ProjectStore.writeBoundReport：tmp(O_EXCL|O_NOFOLLOW,0600)→write+fsync→目录身份核→hardlink→re-read hash 核对。 */
  async #saveFile(commitId: string, file: { logicalPath: string; sha256: string; bytes: number; data: Buffer }): Promise<ExternalDeliveryStorageEntry & { ino: bigint; dev: bigint }> {
    const target = path.join(this.#deliveryTree, commitId, ...file.logicalPath.split('/'));
    const directory = path.dirname(target);
    await this.#safeDirectory(directory);
    const identity = await lstat(directory, { bigint: true });
    const temporary = path.join(directory, `.delivery-${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let published = false, temporaryRemoved = false, openedIno = 0n, openedDev = 0n;
    const checkDirectory = async (): Promise<void> => {
      const current = await lstat(directory, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw denied('external_delivery_unsafe', 503, 'the delivery directory changed during the save');
    };
    try {
      const opened = await handle.stat({ bigint: true });
      openedIno = opened.ino; openedDev = opened.dev;
      await checkDirectory();
      await handle.writeFile(file.data);
      await handle.sync();
      const staged = await lstat(temporary, { bigint: true });
      if (!staged.isFile() || staged.nlink !== 1n || staged.size !== BigInt(file.data.length) || staged.ino !== openedIno || staged.dev !== openedDev) throw denied('external_delivery_save_failed', 503, 'staging verification failed');
      await checkDirectory();
      await this.#hooks.beforeLink?.({ logicalPath: file.logicalPath });
      try { await link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw denied('external_delivery_save_failed', 409, 'the target name already exists'); throw error; }
      published = true;
      await checkDirectory();
      const published_ = await lstat(target, { bigint: true });
      if (!published_.isFile() || published_.isSymbolicLink() || published_.ino !== openedIno || published_.dev !== openedDev || published_.nlink !== 2n) throw denied('external_delivery_save_failed', 503, 'publication verification failed');
      await unlink(temporary);
      temporaryRemoved = true;
      await this.#syncDirectory(directory);
      await checkDirectory();
      if (!await this.#observe(target, { ino: openedIno, dev: openedDev, sha256: file.sha256, bytes: file.data.length })) {
        throw denied('external_delivery_save_failed', 503, 'the saved bytes failed the re-read hash verification');
      }
      return { logicalPath: file.logicalPath, relativePath: `d/${commitId}/${file.logicalPath}`, sha256: file.sha256, bytes: file.data.length, ino: openedIno, dev: openedDev };    } catch (error) {
      if (published) {
        // 仅回滚仍绑定本次 staging inode 的链接；身份不确定的文件绝不删除。
        try {
          const current = await lstat(target, { bigint: true });
          if (current.isFile() && current.ino === openedIno && current.dev === openedDev && current.nlink === 1n) await unlink(target);
        } catch { /* 保留身份不确定的文件 */ }
        published = false;
      }
      throw error;
    } finally {
      await handle.close();
      if (!temporaryRemoved) await unlink(temporary).catch(() => {});
    }
  }

  async #rollback(commitId: string, saved: Array<ExternalDeliveryStorageEntry & { ino: bigint; dev: bigint }>): Promise<void> {
    let allRemoved = saved.length > 0;
    for (const entry of saved) {
      const target = path.join(this.dataRoot, 'external-delivery', entry.relativePath);
      try {
        const current = await lstat(target, { bigint: true });
        if (current.isFile() && current.ino === entry.ino && current.dev === entry.dev && current.nlink === 1n) await unlink(target);
        else allRemoved = false;
      } catch { allRemoved = false; }
    }
    if (allRemoved) await rm(path.join(this.#deliveryTree, commitId), { recursive: true, force: true }).catch(() => {});
  }

  /** observeFile 镜像：O_NOFOLLOW 重读、inode/大小稳定、流式 sha256 与期望一致。 */
  async #observe(target: string, expects: { ino: bigint; dev: bigint; sha256: string; bytes: number }): Promise<boolean> {
    const before = await lstat(target).catch(() => null);
    if (!before || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.ino !== Number(expects.ino) || before.dev !== Number(expects.dev)) return false;
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const initial = await handle.stat();
      if (!initial.isFile() || initial.nlink !== 1 || initial.ino !== before.ino || initial.dev !== before.dev) return false;
      const digest = createHash('sha256');
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytes = 0;
      for (;;) {
        const chunk = await handle.read(buffer, 0, buffer.length, null);
        if (!chunk.bytesRead) break;
        bytes += chunk.bytesRead;
        digest.update(buffer.subarray(0, chunk.bytesRead));
      }
      const final = await handle.stat();
      const current = await lstat(target);
      if (bytes !== initial.size || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs) return false;
      if (current.ino !== initial.ino || current.dev !== initial.dev || current.nlink !== 1 || current.isSymbolicLink()) return false;
      return bytes === expects.bytes && digest.digest('hex') === expects.sha256;
    } finally { await handle.close(); }
  }

  async #syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
}

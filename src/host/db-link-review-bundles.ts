import type { DbLinkResults, DbResultColumn, DbResultOwner, DbResultCell } from './db-link-results.ts';
import type { ProjectStore } from './project-store.ts';
import type { DbLinkModelExport } from './db-link-types.ts';
import { chmod, lstat, mkdir, open, realpath, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonical, digest, directory, exists, fail, hash, id, object, parse, readBytes, safePath, writeExclusive } from './project-data-context-io.ts';

export type DbReviewBundleOwner = { projectId: string; taskId: string; requestId: string; reviewId: string };
export type DbReviewBundlePurpose = 'rcr' | 'cnr' | 'db-independent';
export type DbReviewBundleRef = { kind: 'db-result-bundle'; selector: string; owner: DbReviewBundleOwner; sha256: string };
export type DbReviewNeutralValue = {
  valueId: string; row: number; column: number; representation: 'utf8' | 'binary'; databaseType: string;
  totalBytes: number; sha256: string;
  /** Consecutive chunk indexes address original encoded part files, each containing its logical byte offset. */
  firstChunkIndex: number; partCount: number;
};
export type DbReviewNeutralReceipt = {
  resultId: string; connectionId: string; connectionRevision: number; sourceIdentity: string;
  columns: DbResultColumn[]; startedAt: string; finishedAt: string; receivedRows: number; persistedRows: number;
  serverRowCount: string | null;
  /** Physical row/value data files, excluding the author envelope; never a business-row count. */
  chunkCount: number; bytes: number;
  consistency: { isolation: string; snapshot: string | null; timezone: string; encoding: string; sqlMode?: string;
    serverVersionNum?: string; loginRole?: string; effectiveRole?: string; visibleScope?: 'current-account-visible' | 'unknown' };
  dataNature: 'author-query-result'; extractionCoverage: 'unverified'; limitations: string[];
  values?: DbReviewNeutralValue[];
};
export type DbReviewBundleContext = { signal?: AbortSignal; assertCurrent(): void; sourceOwner: DbResultOwner | (() => Promise<DbResultOwner>); maxTotalBytes: number; existingBytes?: number };
export type DbReviewBundleReadContext = { signal?: AbortSignal; assertCurrent(): void };
export type DbReviewBundleReadInput = { stage: 'cold' | 'informed'; section?: 'data' | 'author'; startRow?: number; maxRows?: number; maxBytes?: number; startUtf16?: number; chunkIndex?: number; startByte?: number };
export type DbReviewBundleReadResult = {
  neutralReceipt: DbReviewNeutralReceipt; rows: DbResultCell[][];
  coverage: { startRow: number; providedRows: number; resultRows: number; providedBytes: number; complete: boolean; verifiedChunks: number; totalChunks: number };
  continuationStartRow: number | null;
  author?: { text: string; sha256: string; rangeUtf16: { start: number; end: number; total: number }; continuationStartUtf16: number | null };
  chunk?: { index: number; base64: string; sha256: string; rangeBytes: { start: number; end: number; total: number }; continuationStartByte: number | null };
};
export type DbReviewBundlesOptions = {
  privateRoot: string; projects: ProjectStore; results: Pick<DbLinkResults, 'materialFiles'>;
  assertOwner(owner: DbReviewBundleOwner, mode: 'freeze' | 'read'): void | Promise<void>;
  assertRevealAllowed?(owner: DbReviewBundleOwner, ref: DbReviewBundleRef): void | Promise<void>;
};
type BundleFile = { name: string; bytes: number; sha256: string; role: 'author' | 'chunk' | 'value' };
type BundleRecord = { schema: 1; owner: DbReviewBundleOwner; purpose: DbReviewBundlePurpose; selector: string; createdAt: string; neutralReceipt: DbReviewNeutralReceipt; files: BundleFile[] };
const maxBundleBytes = 50 * 1024 * 1024;
const ownerKeys = ['projectId', 'taskId', 'requestId', 'reviewId'] as const;
function validateOwner(owner: DbReviewBundleOwner): void { if (!object(owner) || Object.keys(owner).length !== ownerKeys.length) fail('db_review_invalid_owner'); for (const key of ownerKeys) id(owner[key]); }
function resultId(selector: string): string { if (typeof selector !== 'string' || !selector.startsWith('db-result:')) fail('db_review_invalid_selector'); return id(selector.slice('db-result:'.length)); }
const sameOwner = (left: DbReviewBundleOwner, right: DbReviewBundleOwner) => ownerKeys.every(key => left[key] === right[key]);
const bounded = (value: number, maximum: number) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;

export function createDbLinkReviewBundles(options: DbReviewBundlesOptions) {
  if (!path.isAbsolute(options.privateRoot)) fail('db_review_invalid_private_root');
  let root: Promise<string> | undefined;
  const privateRoot = () => root ??= (async () => {
    await mkdir(options.privateRoot, { recursive: true, mode: 0o700 });
    const stat = await lstat(options.privateRoot); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('db_review_unsafe_private_root'); await chmod(options.privateRoot, 0o700);
    return realpath(options.privateRoot);
  })();
  const relativeRoot = (owner: DbReviewBundleOwner, selector: string) => [...ownerKeys.map(key => owner[key]), 'db-result', resultId(selector)].join('/');
  async function check(owner: DbReviewBundleOwner, mode: 'freeze' | 'read', context: DbReviewBundleReadContext): Promise<void> { context.signal?.throwIfAborted(); context.assertCurrent(); await options.assertOwner(owner, mode); context.signal?.throwIfAborted(); context.assertCurrent(); }
  async function checkedFile(home: string, file: BundleFile): Promise<Buffer> { const bytes = await readBytes(await safePath(home, file.name), maxBundleBytes); if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) fail('db_review_snapshot_changed'); return bytes; }
  async function record(owner: DbReviewBundleOwner, selector: string, expected?: string): Promise<{ value: BundleRecord; sha256: string; home: string }> {
    const home = path.dirname(await safePath(await privateRoot(), relativeRoot(owner, selector) + '/bundle.json'));
    const bytes = await readBytes(await safePath(home, 'bundle.json'), 1024 * 1024), sha256 = digest(bytes); if (expected !== undefined && sha256 !== expected) fail('db_review_snapshot_changed');
    const value = parse(bytes) as BundleRecord;
    if (!object(value) || value.schema !== 1 || !object(value.owner) || !sameOwner(value.owner, owner) || value.selector !== selector || !['rcr', 'cnr', 'db-independent'].includes(value.purpose) || !object(value.neutralReceipt) || value.neutralReceipt.resultId !== resultId(selector) || value.neutralReceipt.dataNature !== 'author-query-result' || value.neutralReceipt.extractionCoverage !== 'unverified' || !Array.isArray(value.files)) fail('db_review_snapshot_corrupt');
    let total = 0, chunks = 0, rowChunks = 0, hasValue = false;
    for (const [index, file] of value.files.entries()) {
      if (!object(file) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > maxBundleBytes || (index === 0 ? file.role !== 'author' || file.name !== 'author-manifest.json' : !['chunk', 'value'].includes(file.role))) fail('db_review_snapshot_corrupt');
      if (file.role === 'chunk') { if (hasValue || file.name !== `rows-${String(++rowChunks).padStart(6, '0')}.json`) fail('db_review_snapshot_corrupt'); }
      if (file.role === 'value') hasValue = true;
      hash(file.sha256); total += file.bytes; if (file.role !== 'author') chunks++;
    }
    if (!value.files.length || total > maxBundleBytes || total !== value.neutralReceipt.bytes || chunks !== value.neutralReceipt.chunkCount || !Array.isArray(value.neutralReceipt.columns) || !Array.isArray(value.neutralReceipt.limitations)) fail('db_review_snapshot_corrupt');
    const values = value.neutralReceipt.values ?? [];
    if (!Array.isArray(values) || values.length > 1000) fail('db_review_snapshot_corrupt');
    let partIndex = rowChunks;
    const valueIds = new Set<string>(), positions = new Set<string>();
    for (const [valueIndex, entry] of values.entries()) {
      const position = `${entry?.row}:${entry?.column}`;
      if (!object(entry) || typeof entry.valueId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(entry.valueId) || valueIds.has(entry.valueId) || positions.has(position) || !Number.isSafeInteger(entry.row) || entry.row < 0 || entry.row >= value.neutralReceipt.persistedRows || !Number.isSafeInteger(entry.column) || entry.column < 0 || entry.column >= value.neutralReceipt.columns.length || !['utf8', 'binary'].includes(entry.representation) || typeof entry.databaseType !== 'string' || !entry.databaseType || entry.databaseType.length > 200 || !Number.isSafeInteger(entry.totalBytes) || entry.totalBytes < 0 || entry.totalBytes > maxBundleBytes || entry.firstChunkIndex !== partIndex || !Number.isSafeInteger(entry.partCount) || entry.partCount < 0 || entry.partCount > chunks - partIndex) fail('db_review_snapshot_corrupt');
      hash(entry.sha256); valueIds.add(entry.valueId); positions.add(position);
      for (let ordinal = 0; ordinal < entry.partCount; ordinal++) {
        const file = value.files[partIndex + 1];
        if (!file || file.role !== 'value' || file.name !== `value-${String(valueIndex + 1).padStart(6, '0')}-part-${String(ordinal + 1).padStart(6, '0')}.json`) fail('db_review_snapshot_corrupt');
        partIndex++;
      }
    }
    if (partIndex !== chunks) fail('db_review_snapshot_corrupt');
    return { value, sha256, home };
  }
  async function verify(owner: DbReviewBundleOwner, ref: DbReviewBundleRef, context: DbReviewBundleReadContext): Promise<void> {
    validateOwner(owner); if (!sameOwner(ref.owner, owner) || ref.kind !== 'db-result-bundle') fail('db_review_foreign_reference');
    await check(owner, 'read', context); const fixed = await record(owner, ref.selector, hash(ref.sha256));
    for (const file of fixed.value.files.filter(file => file.role !== 'value')) { await checkedFile(fixed.home, file); await check(owner, 'read', context); }
    for (const value of fixed.value.neutralReceipt.values ?? []) {
      const aggregate = createHash('sha256'), decoder = value.representation === 'utf8' ? new TextDecoder('utf-8', { fatal: true }) : undefined;
      let offset = 0;
      for (let ordinal = 0; ordinal < value.partCount; ordinal++) {
        const file = fixed.value.files[value.firstChunkIndex + ordinal + 1], body = parse(await checkedFile(fixed.home, file)); await check(owner, 'read', context);
        if (!object(body) || body.offset !== offset || typeof body.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) return fail('db_review_snapshot_corrupt');
        const bytes = Buffer.from(body.base64, 'base64');
        if (!bytes.length || bytes.toString('base64') !== body.base64 || offset + bytes.length > value.totalBytes) fail('db_review_snapshot_corrupt');
        try { decoder?.decode(bytes, { stream: true }); } catch { fail('db_review_snapshot_corrupt'); }
        aggregate.update(bytes); offset += bytes.length;
      }
      try { decoder?.decode(); } catch { fail('db_review_snapshot_corrupt'); }
      if (offset !== value.totalBytes || aggregate.digest('hex') !== value.sha256) fail('db_review_snapshot_corrupt');
    }
  }
  const budget = (bytes: number, purpose: DbReviewBundlePurpose, context: DbReviewBundleContext) => {
    const maximum = purpose === 'rcr' ? 100 * 1024 * 1024 : purpose === 'cnr' ? maxBundleBytes : Number.MAX_SAFE_INTEGER;
    if (!bounded(context.maxTotalBytes, maximum) || !Number.isSafeInteger(context.existingBytes ?? 0) || (context.existingBytes ?? 0) < 0 || bytes > maxBundleBytes || bytes + (context.existingBytes ?? 0) > context.maxTotalBytes) fail('db_review_bundle_bytes_limit');
  };
  return {
    verify,
    /** Host-only model-outlet authorization metadata; never register as an Agent reader action. */
    async authorizationSource(owner: DbReviewBundleOwner, ref: DbReviewBundleRef, context: DbReviewBundleReadContext): Promise<{ connectionId: string; connectionRevision: number; sourceIdentity: string; modelExport: DbLinkModelExport }> {
      await verify(owner, ref, context); const fixed = await record(owner, ref.selector, hash(ref.sha256)), original = parse(await checkedFile(fixed.home, fixed.value.files[0]));
      if (!object(original) || !object(original.source) || !object(original.source.modelExport)) return fail('db_review_model_export_unavailable');
      const outlet = original.source.modelExport;
      if (!Array.isArray(outlet.targets) || outlet.targets.some(value => typeof value !== 'string' || !value || value === '*') || ['structure', 'comments', 'queryText', 'results'].some(key => typeof outlet[key] !== 'boolean')) return fail('db_review_model_export_unavailable');
      await check(owner, 'read', context);
      return { connectionId: fixed.value.neutralReceipt.connectionId, connectionRevision: fixed.value.neutralReceipt.connectionRevision, sourceIdentity: fixed.value.neutralReceipt.sourceIdentity, modelExport: structuredClone(outlet) as DbLinkModelExport };
    },
    async freeze(owner: DbReviewBundleOwner, input: { selector: string; purpose: DbReviewBundlePurpose }, context: DbReviewBundleContext) {
      validateOwner(owner); const selected = resultId(input.selector); if (!['rcr', 'cnr', 'db-independent'].includes(input.purpose)) fail('db_review_invalid_purpose');
      owner = { ...owner }; input = { ...input }; await check(owner, 'freeze', context);
      const root = await privateRoot(), target = relativeRoot(owner, input.selector), parent = path.dirname(target);
      const targetPath = await safePath(root, target, true);
      const finish = async (fixed: Awaited<ReturnType<typeof record>>) => {
        if (fixed.value.purpose !== input.purpose) fail('db_review_operation_conflict'); budget(fixed.value.neutralReceipt.bytes, input.purpose, context);
        const ref: DbReviewBundleRef = { kind: 'db-result-bundle', selector: input.selector, owner: { ...owner }, sha256: fixed.sha256 };
        await verify(owner, ref, context); await check(owner, 'freeze', context);
        return { ref, neutralReceipt: structuredClone(fixed.value.neutralReceipt), files: fixed.value.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), logicalItems: 1 as const, assertUnchanged: () => verify(owner, ref, context) };
      };
      if (await exists(targetPath)) return finish(await record(owner, input.selector));
      const sourceOwner = typeof context.sourceOwner === 'function' ? await context.sourceOwner() : context.sourceOwner; await check(owner, 'freeze', context);
      if (sourceOwner.projectId !== owner.projectId || sourceOwner.taskId !== owner.taskId) fail('db_review_foreign_source');
      const source = await options.results.materialFiles(sourceOwner, selected); await check(owner, 'freeze', context);
      if (source.receipt.id !== selected || source.manifest.id !== selected || source.receipt.owner.projectId !== owner.projectId || source.receipt.owner.taskId !== owner.taskId || source.manifest.owner.projectId !== owner.projectId || source.manifest.owner.taskId !== owner.taskId || source.receipt.status !== 'complete' || source.manifest.status !== 'complete') fail('db_review_incomplete_source');
      const bytes = source.files.reduce((sum, file) => sum + file.bytes, 0); budget(bytes, input.purpose, context);
      const sourceParts = (source.manifest.values ?? []).flatMap(value => value.parts);
      if (bytes !== source.receipt.bytes || source.files.length !== source.manifest.chunks.length + sourceParts.length + 1) fail('db_review_source_changed');
      const pendingRelative = `${parent}/.pending-${randomUUID()}`, pendingPath = await safePath(root, pendingRelative, true); await directory(pendingPath, true);
      const files: BundleFile[] = [];
      for (const [index, file] of source.files.entries()) {
        const part = index > source.manifest.chunks.length ? sourceParts[index - source.manifest.chunks.length - 1] : undefined;
        const originalName = index === 0 ? 'manifest.json' : part?.file ?? `rows-${String(index).padStart(6, '0')}.json`;
        const expected = `020_clean/db-link/${selected}/${originalName}`;
        const expectedMember = part ?? source.manifest.chunks[index - 1];
        if (file.relativePath !== expected || file.role !== (index === 0 ? 'manifest' : 'chunk') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || (index === 0 ? file.sha256 !== source.receipt.sha256 : !expectedMember || file.sha256 !== expectedMember.sha256 || file.bytes !== (part ? part.encodedBytes : expectedMember.bytes))) fail('db_review_source_changed');
        const captured = await options.projects.captureFeedbackFile(owner.projectId, file.relativePath, maxBundleBytes); await check(owner, 'freeze', context);
        if (captured.sha256 !== file.sha256 || captured.bytes.length !== file.bytes) fail('db_review_source_changed');
        const fixed: BundleFile = { name: index === 0 ? 'author-manifest.json' : originalName, bytes: file.bytes, sha256: file.sha256, role: index === 0 ? 'author' : part ? 'value' : 'chunk' };
        await writeExclusive(await safePath(pendingPath, fixed.name), captured.bytes); await check(owner, 'freeze', context); files.push(fixed);
      }
      const current = await options.results.materialFiles(sourceOwner, selected); await check(owner, 'freeze', context);
      if (canonical(current) !== canonical(source)) fail('db_review_source_changed');
      const manifest = source.manifest;
      let chunkIndex = manifest.chunks.length;
      const values: DbReviewNeutralValue[] = (manifest.values ?? []).map(value => {
        const firstChunkIndex = chunkIndex; chunkIndex += value.parts.length;
        return { valueId: value.id, row: value.row, column: value.column, representation: value.representation, databaseType: value.databaseType, totalBytes: value.totalBytes, sha256: value.sha256!, firstChunkIndex, partCount: value.parts.length };
      });
      const session = manifest.source.session;
      const neutralReceipt: DbReviewNeutralReceipt = { resultId: selected, connectionId: manifest.source.connectionId, connectionRevision: manifest.source.connectionRevision, sourceIdentity: manifest.source.sourceIdentity, columns: structuredClone(manifest.columns), startedAt: manifest.source.startedAt, finishedAt: manifest.finishedAt, receivedRows: manifest.receivedRows, persistedRows: manifest.persistedRows, serverRowCount: manifest.serverRowCount, chunkCount: files.length - 1, bytes, consistency: { isolation: session.isolation, snapshot: session.snapshot ?? null, timezone: session.timezone, encoding: session.encoding, ...(session.sqlMode === undefined ? {} : { sqlMode: session.sqlMode }), ...(session.serverVersionNum === undefined ? {} : { serverVersionNum: session.serverVersionNum }), ...(session.loginRole === undefined ? {} : { loginRole: session.loginRole }), ...(session.effectiveRole === undefined ? {} : { effectiveRole: session.effectiveRole }), visibleScope: session.visibleScope ?? 'unknown' }, dataNature: 'author-query-result', extractionCoverage: 'unverified', limitations: ['只支持固定结果范围重算，不证明独立取数或全库完整；可能是作者派生或聚合结果，不能自动当作原始源。', '完整固定、实际提供、读取和计算覆盖分别核定；时间戳不代表数据库快照。', ...(manifest.source.limitations ?? ['db_source_limitations_unknown']), ...(!session.loginRole || !session.effectiveRole ? ['db_actor_identity_unknown'] : []), ...(!session.visibleScope ? ['db_visible_scope_unknown'] : [])], ...(values.length ? { values } : {}) };
      const value: BundleRecord = { schema: 1, owner, purpose: input.purpose, selector: input.selector, createdAt: new Date().toISOString(), neutralReceipt, files };
      await writeExclusive(await safePath(pendingPath, 'bundle.json'), Buffer.from(canonical(value) + '\n')); await check(owner, 'freeze', context);
      try { await rename(pendingPath, targetPath); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(String((error as NodeJS.ErrnoException).code))) throw error; }
      const parentHandle = await open(path.dirname(targetPath), constants.O_RDONLY | constants.O_NOFOLLOW); try { await parentHandle.sync(); } finally { await parentHandle.close(); }
      await check(owner, 'freeze', context); return finish(await record(owner, input.selector));
    },
    async read(owner: DbReviewBundleOwner, ref: DbReviewBundleRef, input: DbReviewBundleReadInput, context: DbReviewBundleReadContext): Promise<DbReviewBundleReadResult> {
      validateOwner(owner); if (!object(ref) || !object(ref.owner) || !sameOwner(ref.owner, owner) || ref.kind !== 'db-result-bundle') fail('db_review_foreign_reference');
      if (!['cold', 'informed'].includes(input.stage) || input.section !== undefined && !['data', 'author'].includes(input.section)) fail('db_review_invalid_range');
      const qualify = async () => { await check(owner, 'read', context); if (input.stage === 'informed') { const reveal = options.assertRevealAllowed; if (!reveal) return fail('db_review_author_not_revealed'); await reveal(owner, ref); await check(owner, 'read', context); } };
      await qualify(); const fixed = await record(owner, ref.selector, hash(ref.sha256));
      const maxBytes = input.maxBytes ?? 20000, maxRows = input.maxRows ?? 100, startRow = input.startRow ?? 0;
      if (!bounded(maxBytes, 100000) || !bounded(maxRows, 1000) || !Number.isSafeInteger(startRow) || startRow < 0 || startRow > fixed.value.neutralReceipt.persistedRows) fail('db_review_invalid_range');
      const result: DbReviewBundleReadResult = { neutralReceipt: structuredClone(fixed.value.neutralReceipt), rows: [], coverage: { startRow, providedRows: 0, resultRows: fixed.value.neutralReceipt.persistedRows, providedBytes: 0, complete: false, verifiedChunks: 0, totalChunks: fixed.value.neutralReceipt.chunkCount }, continuationStartRow: startRow < fixed.value.neutralReceipt.persistedRows ? startRow : null };
      const size = () => Buffer.byteLength(JSON.stringify(result));
      if (size() > maxBytes) fail('db_review_bundle_metadata_limit');
      if (input.section === 'author') {
        if (input.stage !== 'informed') fail('db_review_author_not_revealed');
        const file = fixed.value.files[0], bytes = await checkedFile(fixed.home, file); await qualify();
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), start = input.startUtf16 ?? 0;
        if (!Number.isSafeInteger(start) || start < 0 || start > text.length || start > 0 && /[\uD800-\uDBFF]/.test(text[start - 1]) && /[\uDC00-\uDFFF]/.test(text[start])) fail('db_review_invalid_range');
        result.author = { text: '', sha256: file.sha256, rangeUtf16: { start, end: start, total: text.length }, continuationStartUtf16: start < text.length ? start : null };
        const set = (offset: number) => { const end = offset > start && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]) ? offset - 1 : offset; result.author!.text = text.slice(start, end); result.author!.rangeUtf16.end = end; result.author!.continuationStartUtf16 = end < text.length ? end : null; };
        let low = start, high = text.length; while (low < high) { const middle = Math.ceil((low + high) / 2); set(middle); if (size() <= maxBytes) low = middle; else high = middle - 1; } set(low);
        if (!result.author.text && start < text.length) fail('db_review_bundle_metadata_limit'); await qualify(); return result;
      }
      const chunks = fixed.value.files.filter(file => file.role !== 'author'), rowChunks = chunks.filter(file => file.role === 'chunk');
      if (input.chunkIndex !== undefined) {
        if (!Number.isSafeInteger(input.chunkIndex) || !chunks[input.chunkIndex]) fail('db_review_invalid_range');
        const file = chunks[input.chunkIndex], bytes = await checkedFile(fixed.home, file), start = input.startByte ?? 0;
        if (!Number.isSafeInteger(start) || start < 0 || start > bytes.length) fail('db_review_invalid_range');
        result.chunk = { index: input.chunkIndex, base64: '', sha256: file.sha256, rangeBytes: { start, end: start, total: bytes.length }, continuationStartByte: start < bytes.length ? start : null };
        let end = Math.min(bytes.length, start + Math.max(0, Math.floor((maxBytes - size() - 32) * 3 / 4)));
        result.coverage.verifiedChunks = 1; result.coverage.providedBytes = end - start;
        result.chunk.base64 = bytes.subarray(start, end).toString('base64'); result.chunk.rangeBytes.end = end; result.chunk.continuationStartByte = end < bytes.length ? end : null;
        while (size() > maxBytes && end > start) { end--; result.coverage.providedBytes = end - start; result.chunk.base64 = bytes.subarray(start, end).toString('base64'); result.chunk.rangeBytes.end = end; result.chunk.continuationStartByte = end < bytes.length ? end : null; }
        if (end === start && start < bytes.length) fail('db_review_bundle_metadata_limit'); await qualify(); return result;
      }
      let cursor = 0, stopped = false;
      for (const file of rowChunks) {
        const bytes = await checkedFile(fixed.home, file); await qualify(); const decoded = parse(bytes);
        if (!object(decoded) || !Array.isArray(decoded.rows) || canonical(decoded.columns) !== canonical(fixed.value.neutralReceipt.columns)) fail('db_review_snapshot_corrupt');
        result.coverage.verifiedChunks++;
        for (const row of (decoded as { rows: DbResultCell[][] }).rows) {
          if (cursor++ < startRow) continue;
          if (result.rows.length >= maxRows) { stopped = true; break; }
          result.rows.push(row); result.coverage.providedRows = result.rows.length; result.coverage.providedBytes += Buffer.byteLength(JSON.stringify(row)); result.continuationStartRow = startRow + result.rows.length < result.coverage.resultRows ? startRow + result.rows.length : null;
          if (size() > maxBytes) { result.rows.pop(); result.coverage.providedRows = result.rows.length; result.coverage.providedBytes -= Buffer.byteLength(JSON.stringify(row)); result.continuationStartRow = startRow + result.rows.length; if (!result.rows.length) fail('db_review_bundle_row_too_large_use_chunk_range'); stopped = true; break; }
        }
        if (stopped) break;
      }
      result.coverage.complete = startRow === 0 && result.rows.length === result.coverage.resultRows && result.coverage.verifiedChunks === chunks.length && !fixed.value.neutralReceipt.values?.length;
      if (size() > maxBytes) fail('db_review_bundle_metadata_limit'); await qualify(); return result;
    },
  };
}

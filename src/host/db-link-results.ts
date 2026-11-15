import type { DbLinkEngine, DbLinkModelExport } from './db-link-types.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export type DbResultOwner = { projectId: string; taskId: string; requestId: string; operationId: string };
export type DbResultColumn = {
  ordinal: number; name: string; databaseType: string; typeId?: string | number;
  /** When a transport segment is mapped back to a logical source value. */
  wireTypeId?: number;
  precision: number | null; scale: number | null; nullable?: boolean;
};
export type DbResultValueRef = { type: 'segmented'; valueId: string; bytes: number; representation: 'utf8' | 'binary'; databaseType: string; sha256: string };
export type DbResultCell = string | null | { type: 'binary'; base64: string } | { type: 'float'; value: string } | DbResultValueRef;
export type DbResultValueDefinition = { row: number; column: number; totalBytes: number; representation: 'utf8' | 'binary'; databaseType: string; stableKey: string[] };
export type DbResultTransportParameter = { parameter: number; value: string | number };
export type DbResultValue = DbResultValueDefinition & { id: string; receivedBytes: number; complete: boolean; sha256: string | null; parts: { file: string; offset: number; bytes: number; encodedBytes: number; sha256: string; transportParameters?: DbResultTransportParameter[] }[] };
export type DbResultParameter = { kind: 'text' | 'number' | 'boolean' | 'binary' | 'null'; value: string | number | boolean | null; databaseType?: string };
export type DbResultSource = {
  connectionId: string; connectionRevision: number; engine: DbLinkEngine; sourceIdentity: string;
  sql: string; parameters: DbResultParameter[]; observedObjects: string[]; declaredObjects: string[]; unknownObjects: string[];
  startedAt: string; session: { timezone: string; encoding: string; sqlMode?: string; isolation: string; snapshot?: string; serverVersionNum?: string;
    loginRole?: string; effectiveRole?: string; visibleScope?: 'current-account-visible' };
  /** Host-captured public technical codes; never raw errors, credentials, comments or policy text. */
  limitations?: string[];
  /** Host-captured export of this fixed material; absent legacy records grant no model export. */
  modelExport?: DbLinkModelExport;
  segmentRead?: { valueColumn: number; totalBytesColumn: number; keyColumns: number[] };
};
export type DbResultLimits = { maxRows: number; maxBytes: number; maxCellBytes: number; chunkBytes: number };
export type DbResultAcquisition = {
  /** The driver's decoded-row counter, including a batch refused before sink delivery. */
  driverReceivedRows: number; rowAccounting: 'after-driver-decode';
  /** Physical connection bytes include TLS and catalog traffic; they are not result-file bytes. */
  transport?: { scope: 'physical-connection'; receivedBytes: number; forwardedBytes: number; maxReceiveBytes: number; rejected: boolean };
};
export type DbResultManifest = {
  schema: 1; id: string; owner: DbResultOwner; source: DbResultSource; columns: DbResultColumn[];
  status: 'complete' | 'partial' | 'cancelled' | 'failed'; reason?: string; finishedAt: string;
  receivedRows: number; persistedRows: number; bytes: number; serverRowCount: string | null;
  chunks: { file: string; bytes: number; rows: number; sha256: string }[];
  values?: DbResultValue[];
  acquisition?: DbResultAcquisition;
};
export type DbResultReceipt = { id: string; owner: DbResultOwner; relativePath: string; sha256: string; status: DbResultManifest['status']; bytes: number; rows: number };
export type DbResultReadOptions = { startRow?: number; maxRows?: number; maxBytes?: number };
export type DbResultCoverage = { startRow: number; readRows: number; resultRows: number; providedBytes: number; verifiedChunks: number; totalChunks: number; complete: boolean };
export type DbResultMaterialFile = { relativePath: string; bytes: number; sha256: string; role: 'manifest' | 'chunk' };
export type DbResultSink = {
  readonly id: string;
  beginValue(definition: DbResultValueDefinition): Promise<string>;
  appendValueSegment(valueId: string, offset: number, base64: string, transportParameters?: DbResultTransportParameter[]): Promise<void>;
  completeValue(valueId: string): Promise<DbResultValueRef>;
  append(rows: readonly (readonly DbResultCell[])[]): Promise<void>;
  complete(serverRowCount: string | null, acquisition?: DbResultAcquisition): Promise<DbResultReceipt>;
  abort(status: 'partial' | 'cancelled' | 'failed', reason: string, acquisition?: DbResultAcquisition): Promise<DbResultReceipt>;
};
export type DbLinkResultsOptions = {
  dataRoot: string; projectDirectory(projectId: string): string;
  assertAccess(owner: DbResultOwner, mode: 'read' | 'write'): void | Promise<void>;
};

export class DbLinkResults {
  private readonly options: DbLinkResultsOptions;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(options: DbLinkResultsOptions) { this.options = options; }
  async begin(owner: DbResultOwner, source: DbResultSource, columns: DbResultColumn[], limits: DbResultLimits): Promise<DbResultSink> {
    validateOwner(owner);
    await this.options.assertAccess(owner, 'write');
    validateDefinition(source, columns, limits);
    owner = structuredClone(owner); source = structuredClone(source); columns = structuredClone(columns); limits = { ...limits };
    const id = randomUUID(), projectDirectory = await this.directory(owner.projectId);
    const clean = await childDirectory(projectDirectory, '020_clean');
    const parent = await childDirectory(clean, 'db-link');
    const pending = await childDirectory(parent, `.pending-${id}`);
    const chunks: DbResultManifest['chunks'] = [];
    const values: DbResultValue[] = [], valueStates = new Map<string, { hash: ReturnType<typeof createHash>; decoder?: TextDecoder }>();
    const referencedValues = new Set<string>();
    let rows: DbResultCell[][] = [], receivedRows = 0, persistedRows = 0, bytes = 0;
    let ended = false, failure: string | undefined, observedServerCount: string | null = null;
    let observedAcquisition: DbResultAcquisition | undefined;
    const encode = (values: DbResultCell[][]) => JSON.stringify({ columns, rows: values });
    const manifest = (status: DbResultManifest['status'], reason?: string, serverRowCount: string | null = null): DbResultManifest => ({
      schema: 1, id, owner, source, columns, status, ...(reason ? { reason } : {}), finishedAt: new Date().toISOString(),
      receivedRows, persistedRows, bytes, serverRowCount, chunks: [...chunks], ...(values.length ? { values } : {}), ...(observedAcquisition ? { acquisition: observedAcquisition } : {}),
    });
    const flush = async () => {
      if (!rows.length) return;
      const file = `rows-${String(chunks.length + 1).padStart(6, '0')}.json`, text = encode(rows);
      await writeNew(path.join(pending, file), text);
      const size = Buffer.byteLength(text);
      chunks.push({ file, bytes: size, rows: rows.length, sha256: digest(text) });
      persistedRows += rows.length; bytes += size; rows = [];
    };
    const finish = async (status: DbResultManifest['status'], reason?: string, serverRowCount: string | null = null, acquisition?: DbResultAcquisition) => {
      if (ended) throw new DbLinkResultError('db_result_already_finished');
      if (acquisition !== undefined) {
        try { observedAcquisition = validateAcquisition(acquisition, receivedRows); }
        catch (error) { if (status === 'complete') failure = 'db_result_invalid_acquisition'; throw error; }
      }
      if (status === 'complete') {
        await this.options.assertAccess(owner, 'write');
        if (failure) throw new DbLinkResultError('db_result_incomplete');
        if (observedAcquisition && (observedAcquisition.driverReceivedRows !== receivedRows || observedAcquisition.transport?.rejected)) { failure = 'db_result_acquisition_incomplete'; throw new DbLinkResultError(failure); }
        if (values.some(value => !value.complete)) throw new DbLinkResultError('db_result_value_incomplete');
        if (values.some(value => !referencedValues.has(value.id))) { failure = 'db_result_value_unreferenced'; throw new DbLinkResultError(failure); }
        if (serverRowCount !== null && (typeof serverRowCount !== 'string' || serverRowCount.length > 32 || !/^\d+$/.test(serverRowCount))) throw new DbLinkResultError('db_result_invalid_row_count');
        observedServerCount = serverRowCount;
        if (serverRowCount !== null && BigInt(serverRowCount) !== BigInt(receivedRows)) { failure = 'db_result_row_count_mismatch'; throw new DbLinkResultError(failure); }
      }
      await flush();
      if (status === 'complete' && receivedRows !== persistedRows) { failure = 'db_result_row_count_mismatch'; throw new DbLinkResultError(failure); }
      serverRowCount ??= observedServerCount;
      const value = manifest(status, reason?.slice(0, 120), serverRowCount);
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text) > 262_144) throw new DbLinkResultError('db_result_manifest_too_large');
      if (status === 'complete' && bytes + Buffer.byteLength(text) > limits.maxBytes) { failure = 'db_result_byte_limit'; throw new DbLinkResultError(failure); }
      await writeNew(path.join(pending, 'manifest.json'), text);
      const target = path.join(parent, id);
      await rename(pending, target);
      const receipt: DbResultReceipt = { id, owner, relativePath: `020_clean/db-link/${id}/manifest.json`, sha256: digest(text), status, bytes: bytes + Buffer.byteLength(text), rows: persistedRows };
      await this.mutate(async () => {
        const entries = await this.index();
        if (status === 'complete') await this.options.assertAccess(owner, 'write');
        await this.saveIndex([...entries, receipt]);
      });
      ended = true;
      return structuredClone(receipt);
    };
    return {
      id,
      beginValue: async definition => {
        if (ended || failure) throw new DbLinkResultError('db_result_not_writable');
        await this.options.assertAccess(owner, 'write');
        if (!Number.isSafeInteger(definition.row) || definition.row < 0 || definition.row >= limits.maxRows || !Number.isSafeInteger(definition.column) || definition.column < 0 || definition.column >= columns.length || !Number.isSafeInteger(definition.totalBytes) || definition.totalBytes < 0 || definition.totalBytes > limits.maxBytes || !['utf8', 'binary'].includes(definition.representation) || typeof definition.databaseType !== 'string' || definition.databaseType.length > 200 || !Array.isArray(definition.stableKey) || !definition.stableKey.length || definition.stableKey.length > 16 || definition.stableKey.some(key => typeof key !== 'string' || Buffer.byteLength(key) > limits.maxCellBytes) || values.some(value => value.row === definition.row && value.column === definition.column)) throw new DbLinkResultError('db_result_invalid_value');
        if (values.length >= Math.min(1000, limits.maxRows * columns.length) || Buffer.byteLength(JSON.stringify(definition)) > 16_384) throw new DbLinkResultError('db_result_metadata_limit');
        const value: DbResultValue = { ...structuredClone(definition), id: randomUUID(), receivedBytes: 0, complete: false, sha256: null, parts: [] };
        values.push(value); valueStates.set(value.id, { hash: createHash('sha256'), ...(value.representation === 'utf8' ? { decoder: new TextDecoder('utf-8', { fatal: true }) } : {}) });
        return value.id;
      },
      appendValueSegment: async (valueId, offset, base64, transportParameters) => {
        if (ended || failure) throw new DbLinkResultError('db_result_not_writable');
        await this.options.assertAccess(owner, 'write');
        try {
          const value = values.find(value => value.id === valueId), state = valueStates.get(valueId);
          if (!value || !state || value.complete || !Number.isSafeInteger(offset) || offset !== value.receivedBytes || typeof base64 !== 'string' || base64.length > Math.ceil(limits.maxCellBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new DbLinkResultError('db_result_invalid_segment');
          const data = Buffer.from(base64, 'base64');
          if (!data.length || data.length > limits.maxCellBytes || data.toString('base64') !== base64 || offset + data.length > value.totalBytes) throw new DbLinkResultError('db_result_invalid_segment');
          const file = `value-${String(values.indexOf(value) + 1).padStart(6, '0')}-part-${String(value.parts.length + 1).padStart(6, '0')}.json`, body = JSON.stringify({ offset, base64 }), size = Buffer.byteLength(body);
          if (transportParameters !== undefined && (!Array.isArray(transportParameters) || transportParameters.length > 2 || new Set(transportParameters.map(value => value.parameter)).size !== transportParameters.length || transportParameters.some(value => !Number.isSafeInteger(value.parameter) || value.parameter < 1 || value.parameter > 256 || typeof value.value !== 'number' && typeof value.value !== 'string' || typeof value.value === 'string' && (value.value.length > 32 || !/^[1-9][0-9]*$/.test(value.value)) || !Number.isSafeInteger(Number(value.value)) || Number(value.value) < 1))) throw new DbLinkResultError('db_result_invalid_segment');
          // Sparse actual control bindings stay in the author manifest. Data
          // part bytes remain offset/base64 only for neutral cold reading.
          const part = { file, offset, bytes: data.length, encodedBytes: size, sha256: digest(body), ...(transportParameters ? { transportParameters: structuredClone(transportParameters) } : {}) };
          const projected = { ...manifest('partial'), values: values.map(item => item === value ? { ...value, receivedBytes: offset + data.length, parts: [...value.parts, part] } : item) };
          const metadataBytes = Buffer.byteLength(JSON.stringify(projected));
          if (metadataBytes > 262_144 || bytes + size + metadataBytes + 128 > limits.maxBytes) throw new DbLinkResultError('db_result_byte_limit');
          // Decode only this bounded segment; TextDecoder retains at most the
          // incomplete UTF8 character, never the complete logical value.
          state.decoder?.decode(data, { stream: true });
          await writeNew(path.join(pending, file), body);
          state.hash.update(data); value.parts.push(part); value.receivedBytes += data.length; bytes += size;
        } catch (error) { failure = error instanceof DbLinkResultError ? error.code : 'db_result_segment_write_failed'; throw error instanceof DbLinkResultError ? error : new DbLinkResultError(failure); }
      },
      completeValue: async valueId => {
        if (ended || failure) throw new DbLinkResultError('db_result_not_writable');
        await this.options.assertAccess(owner, 'write');
        const value = values.find(value => value.id === valueId), state = valueStates.get(valueId);
        if (!value || !state || value.complete || value.receivedBytes !== value.totalBytes) throw new DbLinkResultError('db_result_value_incomplete');
        try { state.decoder?.decode(); } catch { failure = 'db_result_invalid_utf8'; throw new DbLinkResultError(failure); }
        value.sha256 = state.hash.digest('hex'); value.complete = true; valueStates.delete(valueId);
        return { type: 'segmented', valueId, bytes: value.totalBytes, representation: value.representation, databaseType: value.databaseType, sha256: value.sha256 };
      },
      append: async values => {
        if (ended || failure) throw new DbLinkResultError('db_result_not_writable');
        await this.options.assertAccess(owner, 'write');
        receivedRows += values.length;
        try {
          for (const value of values) {
            if (persistedRows + rows.length >= limits.maxRows) throw new DbLinkResultError('db_result_row_limit');
            if (value.length !== columns.length) throw new DbLinkResultError('db_result_invalid_row');
            const cells = value.map((cell, column) => {
              if (cell && typeof cell === 'object' && cell.type === 'segmented') {
                const stored = manifest('partial').values?.find(item => item.id === cell.valueId);
                if (!stored?.complete || stored.row !== persistedRows + rows.length || stored.column !== column || stored.sha256 !== cell.sha256 || stored.totalBytes !== cell.bytes || stored.representation !== cell.representation || stored.databaseType !== cell.databaseType) throw new DbLinkResultError('db_result_invalid_value_reference');
                return { type: 'segmented' as const, valueId: stored.id, bytes: stored.totalBytes, representation: stored.representation, databaseType: stored.databaseType, sha256: stored.sha256! };
              }
              return validateCell(cell, limits.maxCellBytes);
            });
            if (rows.length && Buffer.byteLength(encode([...rows, cells])) > limits.chunkBytes) await flush();
            const candidate = [...rows, cells], size = Buffer.byteLength(encode(candidate));
            if (size > 52_428_800) throw new DbLinkResultError('db_result_chunk_limit');
            // Include the pending chunk descriptor and manifest in the byte cap.
            const projected = manifest('complete');
            projected.persistedRows += candidate.length;
            projected.bytes += size;
            projected.chunks.push({ file: `rows-${String(chunks.length + 1).padStart(6, '0')}.json`, bytes: size, rows: candidate.length, sha256: '0'.repeat(64) });
            if (bytes + size + Buffer.byteLength(JSON.stringify(projected)) + 128 > limits.maxBytes) throw new DbLinkResultError('db_result_byte_limit');
            rows = candidate;
            for (const cell of cells) if (cell && typeof cell === 'object' && cell.type === 'segmented') referencedValues.add(cell.valueId);
          }
        } catch (error) {
          failure = error instanceof DbLinkResultError ? error.code : 'db_result_write_failed';
          throw error instanceof DbLinkResultError ? error : new DbLinkResultError(failure);
        }
      },
      complete: (count, acquisition) => finish('complete', undefined, count, acquisition),
      abort: (status, reason, acquisition) => finish(status, reason, null, acquisition),
    };
  }
  async list(owner: DbResultOwner): Promise<DbResultReceipt[]> {
    validateOwner(owner); await this.options.assertAccess(owner, 'read');
    await this.tail;
    return structuredClone((await this.index()).filter(value => value.owner.projectId === owner.projectId));
  }
  private async readManifest(owner: DbResultOwner, id: string): Promise<{ receipt: DbResultReceipt; manifest: DbResultManifest; directory: string; file: string; manifestBytes: number }> {
    validateOwner(owner); await this.options.assertAccess(owner, 'read'); await this.tail;
    if (!uuid(id)) throw new DbLinkResultError('db_result_not_found');
    const receipt = (await this.index()).find(value => value.id === id && value.owner.projectId === owner.projectId);
    if (!receipt) throw new DbLinkResultError('db_result_not_found');
    const directory = await this.directory(owner.projectId), expected = `020_clean/db-link/${id}/manifest.json`;
    if (receipt.relativePath !== expected) throw new DbLinkResultError('db_result_corrupt');
    const file = path.join(directory, expected); await assertContained(directory, file);
    const text = await readRegular(file, 262_144); if (digest(text) !== receipt.sha256) throw new DbLinkResultError('db_result_changed');
    const manifest = JSON.parse(text) as DbResultManifest;
    if (manifest.schema !== 1 || manifest.id !== id || manifest.owner.projectId !== owner.projectId || JSON.stringify(manifest.owner) !== JSON.stringify(receipt.owner) || manifest.status !== receipt.status || !['complete', 'partial', 'cancelled', 'failed'].includes(manifest.status) || !Array.isArray(manifest.chunks)) throw new DbLinkResultError('db_result_corrupt');
    if (manifest.chunks.reduce((sum, chunk) => sum + chunk.rows, 0) !== manifest.persistedRows || receipt.rows !== manifest.persistedRows) throw new DbLinkResultError('db_result_corrupt');
    if (!Number.isSafeInteger(manifest.receivedRows) || manifest.receivedRows < 0 || !Number.isSafeInteger(manifest.persistedRows) || manifest.persistedRows < 0 || manifest.serverRowCount !== null && (typeof manifest.serverRowCount !== 'string' || manifest.serverRowCount.length > 32 || !/^\d+$/.test(manifest.serverRowCount))) throw new DbLinkResultError('db_result_corrupt');
    try { if (manifest.acquisition !== undefined) validateAcquisition(manifest.acquisition, manifest.receivedRows); validateSourceLimitations(manifest.source.limitations); } catch { throw new DbLinkResultError('db_result_corrupt'); }
    if (manifest.status === 'complete' && (manifest.receivedRows !== manifest.persistedRows || manifest.serverRowCount !== null && BigInt(manifest.serverRowCount) !== BigInt(manifest.persistedRows) || manifest.acquisition && (manifest.acquisition.driverReceivedRows !== manifest.receivedRows || manifest.acquisition.transport?.rejected))) throw new DbLinkResultError('db_result_incomplete');
    for (const [index, chunk] of manifest.chunks.entries()) if (chunk.file !== `rows-${String(index + 1).padStart(6, '0')}.json` || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 0 || chunk.bytes > 52_428_800 || !Number.isSafeInteger(chunk.rows) || chunk.rows < 0) throw new DbLinkResultError('db_result_corrupt');
    validateValues(manifest); await this.options.assertAccess(owner, 'read');
    return { receipt: structuredClone(receipt), manifest, directory, file, manifestBytes: Buffer.byteLength(text) };
  }
  async read(owner: DbResultOwner, id: string, options: DbResultReadOptions = {}): Promise<{ receipt: DbResultReceipt; manifest: DbResultManifest; rows: DbResultCell[][]; coverage: DbResultCoverage }> {
    validateOwner(owner); await this.options.assertAccess(owner, 'read');
    await this.tail;
    const startRow = options.startRow ?? 0, maxRows = options.maxRows ?? 100, maxBytes = options.maxBytes ?? 20_000;
    if (!Number.isSafeInteger(startRow) || startRow < 0 || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100_000) throw new DbLinkResultError('db_result_invalid_range');
    const { receipt, manifest, directory, file } = await this.readManifest(owner, id);
    const rows: DbResultCell[][] = [];
    let cursor = 0, providedBytes = 0, verifiedChunks = 0;
    for (const [index, chunk] of manifest.chunks.entries()) {
      if (chunk.file !== `rows-${String(index + 1).padStart(6, '0')}.json` || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 0 || chunk.bytes > 52_428_800 || !Number.isSafeInteger(chunk.rows) || chunk.rows < 0) throw new DbLinkResultError('db_result_corrupt');
      if (cursor + chunk.rows <= startRow) { cursor += chunk.rows; continue; }
      if (rows.length >= maxRows || providedBytes >= maxBytes) break;
      const chunkPath = path.join(path.dirname(file), chunk.file); await assertContained(directory, chunkPath);
      const body = await readRegular(chunkPath, chunk.bytes);
      if (Buffer.byteLength(body) !== chunk.bytes || digest(body) !== chunk.sha256) throw new DbLinkResultError('db_result_changed');
      const decoded = JSON.parse(body) as { columns: DbResultColumn[]; rows: DbResultCell[][] };
      if (JSON.stringify(decoded.columns) !== JSON.stringify(manifest.columns) || !Array.isArray(decoded.rows) || decoded.rows.length !== chunk.rows) throw new DbLinkResultError('db_result_corrupt');
      validateRowValueRefs(manifest, decoded.rows, cursor);
      verifiedChunks++;
      let bounded = false;
      for (const row of decoded.rows) {
        const position = cursor++;
        if (position < startRow) continue;
        const size = Buffer.byteLength(JSON.stringify(row));
        if (rows.length >= maxRows || providedBytes + size > maxBytes) { bounded = true; break; }
        rows.push(row); providedBytes += size;
      }
      if (bounded) break;
    }
    await this.options.assertAccess(owner, 'read');
    validateValues(manifest);
    return { receipt: structuredClone(receipt), manifest, rows, coverage: { startRow, readRows: rows.length, resultRows: manifest.persistedRows, providedBytes, verifiedChunks, totalChunks: manifest.chunks.length, complete: startRow === 0 && rows.length === manifest.persistedRows && verifiedChunks === manifest.chunks.length && !manifest.values?.length } };
  }

  async readValue(owner: DbResultOwner, id: string, valueId: string, options: { startByte?: number; maxBytes?: number } = {}) {
    const startByte = options.startByte ?? 0, maxBytes = options.maxBytes ?? 20_000;
    if (!uuid(valueId) || !Number.isSafeInteger(startByte) || startByte < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100_000) throw new DbLinkResultError('db_result_invalid_range');
    const { receipt, manifest } = await this.read(owner, id, { maxRows: 1, maxBytes: 1 });
    const value = manifest.values?.find(value => value.id === valueId);
    if (!value) throw new DbLinkResultError('db_result_value_not_found');
    const directory = await this.directory(owner.projectId), parent = path.dirname(path.join(directory, receipt.relativePath));
    let rowOffset = 0, referenceVerified = false;
    for (const chunk of manifest.chunks) {
      if (rowOffset + chunk.rows <= value.row) { rowOffset += chunk.rows; continue; }
      const file = path.join(parent, chunk.file); await assertContained(directory, file);
      const body = await readRegular(file, chunk.bytes);
      if (Buffer.byteLength(body) !== chunk.bytes || digest(body) !== chunk.sha256) throw new DbLinkResultError('db_result_changed');
      const decoded = JSON.parse(body) as { columns: DbResultColumn[]; rows: DbResultCell[][] };
      if (!Array.isArray(decoded.rows) || decoded.rows.length !== chunk.rows || JSON.stringify(decoded.columns) !== JSON.stringify(manifest.columns)) throw new DbLinkResultError('db_result_corrupt');
      validateRowValueRefs(manifest, decoded.rows, rowOffset); referenceVerified = true; break;
    }
    if (!referenceVerified) throw new DbLinkResultError('db_result_invalid_value_reference');
    const endByte = Math.min(value.receivedBytes, startByte + maxBytes), output: Buffer[] = [];
    let providedBytes = 0;
    for (const part of value.parts) {
      if (part.offset + part.bytes <= startByte) continue;
      if (part.offset >= endByte) break;
      const file = path.join(parent, part.file); await assertContained(directory, file);
      const data = await readValuePart(file, part);
      const slice = data.subarray(Math.max(0, startByte - part.offset), Math.min(data.length, endByte - part.offset));
      output.push(slice); providedBytes += slice.length;
    }
    await this.options.assertAccess(owner, 'read');
    // Only the explicitly bounded preview is materialized, never the full value.
    const preview = Buffer.concat(output, providedBytes), complete = value.complete && startByte === 0 && providedBytes === value.totalBytes;
    if (complete && createHash('sha256').update(preview).digest('hex') !== value.sha256) throw new DbLinkResultError('db_result_changed');
    return { valueId, representation: value.representation, databaseType: value.databaseType, base64: preview.toString('base64'), coverage: { startByte, providedBytes, receivedBytes: value.receivedBytes, totalBytes: value.totalBytes, complete } };
  }

  async materialFiles(owner: DbResultOwner, id: string, options?: { mode: 'structure-description' }): Promise<{ receipt: DbResultReceipt; manifest: DbResultManifest; files: DbResultMaterialFile[] }> {
    if (options !== undefined) {
      if (!options || options.mode !== 'structure-description' || Object.keys(options).some(key => key !== 'mode')) throw new DbLinkResultError('db_result_invalid_material_mode');
      const loaded = await this.readManifest(owner, id);
      if (loaded.manifest.status !== 'complete') return { receipt: loaded.receipt, manifest: loaded.manifest, files: [{ relativePath: loaded.receipt.relativePath, bytes: loaded.manifestBytes, sha256: loaded.receipt.sha256, role: 'manifest' }] };
    }
    const { receipt, manifest } = await this.read(owner, id, { maxRows: 1, maxBytes: 1 });
    if (manifest.status !== 'complete') throw new DbLinkResultError('db_result_incomplete');
    const directory = await this.directory(owner.projectId), parent = path.posix.dirname(receipt.relativePath);
    const manifestFile = path.join(directory, receipt.relativePath);
    await assertContained(directory, manifestFile);
    const manifestText = await readRegular(manifestFile, 262_144);
    if (digest(manifestText) !== receipt.sha256) throw new DbLinkResultError('db_result_changed');
    const files: DbResultMaterialFile[] = [{ relativePath: receipt.relativePath, bytes: Buffer.byteLength(manifestText), sha256: receipt.sha256, role: 'manifest' }];
    let rowOffset = 0;
    for (const [index, chunk] of manifest.chunks.entries()) {
      if (chunk.file !== `rows-${String(index + 1).padStart(6, '0')}.json` || chunk.bytes < 0 || chunk.bytes > 52_428_800) throw new DbLinkResultError('db_result_corrupt');
      const relativePath = `${parent}/${chunk.file}`, file = path.join(directory, relativePath);
      await assertContained(directory, file);
      const body = await readRegular(file, chunk.bytes);
      if (Buffer.byteLength(body) !== chunk.bytes || digest(body) !== chunk.sha256) throw new DbLinkResultError('db_result_changed');
      const decoded = JSON.parse(body) as { columns: DbResultColumn[]; rows: DbResultCell[][] };
      if (!Array.isArray(decoded.rows) || decoded.rows.length !== chunk.rows || JSON.stringify(decoded.columns) !== JSON.stringify(manifest.columns)) throw new DbLinkResultError('db_result_corrupt');
      validateRowValueRefs(manifest, decoded.rows, rowOffset); rowOffset += chunk.rows;
      files.push({ relativePath, bytes: chunk.bytes, sha256: chunk.sha256, role: 'chunk' });
    }
    for (const value of manifest.values ?? []) {
      const hash = createHash('sha256');
      for (const part of value.parts) {
        const relativePath = `${parent}/${part.file}`, file = path.join(directory, relativePath); await assertContained(directory, file);
        hash.update(await readValuePart(file, part));
        files.push({ relativePath, bytes: part.encodedBytes, sha256: part.sha256, role: 'chunk' });
      }
      if (!value.complete || hash.digest('hex') !== value.sha256) throw new DbLinkResultError('db_result_value_incomplete');
    }
    if (files.reduce((sum, file) => sum + file.bytes, 0) !== receipt.bytes) throw new DbLinkResultError('db_result_corrupt');
    await this.options.assertAccess(owner, 'read');
    return { receipt, manifest, files };
  }

  private async directory(projectId: string): Promise<string> { return await realpath(this.options.projectDirectory(projectId)); }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation); this.tail = next.catch(() => {}); return next;
  }
  private async index(): Promise<DbResultReceipt[]> {
    const root = await privateRoot(this.options.dataRoot);
    try {
      const text = await readRegular(path.join(root, 'results.json'), 16_777_216);
      const value = JSON.parse(text) as { schema: number; results: DbResultReceipt[] };
      if (value.schema !== 1 || !Array.isArray(value.results)) throw new DbLinkResultError('db_result_index_corrupt');
      return value.results;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  private async saveIndex(results: DbResultReceipt[]): Promise<void> {
    const root = await privateRoot(this.options.dataRoot), temporary = path.join(root, `.results-${randomUUID()}.json`);
    await writeNew(temporary, JSON.stringify({ schema: 1, results }));
    await rename(temporary, path.join(root, 'results.json'));
  }
}

export class DbLinkResultError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
function validateAcquisition(value: unknown, receivedRows: number): DbResultAcquisition {
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  if (!object(value) || Object.keys(value).some(key => !['driverReceivedRows', 'rowAccounting', 'transport'].includes(key)) || !nonnegative(value.driverReceivedRows) || value.driverReceivedRows < receivedRows || value.rowAccounting !== 'after-driver-decode') throw new DbLinkResultError('db_result_invalid_acquisition');
  if (value.transport !== undefined) {
    const transport = value.transport;
    if (!object(transport) || Object.keys(transport).some(key => !['scope', 'receivedBytes', 'forwardedBytes', 'maxReceiveBytes', 'rejected'].includes(key)) || transport.scope !== 'physical-connection' || !nonnegative(transport.receivedBytes) || !nonnegative(transport.forwardedBytes) || !nonnegative(transport.maxReceiveBytes) || transport.forwardedBytes > transport.receivedBytes || transport.forwardedBytes > transport.maxReceiveBytes || typeof transport.rejected !== 'boolean') throw new DbLinkResultError('db_result_invalid_acquisition');
  }
  return structuredClone(value) as DbResultAcquisition;
}
function validateValues(manifest: DbResultManifest): void {
  if (manifest.values === undefined) return;
  if (!Array.isArray(manifest.values) || manifest.values.length > 1000) throw new DbLinkResultError('db_result_corrupt');
  const ids = new Set<string>(), positions = new Set<string>();
  for (const [valueIndex, value] of manifest.values.entries()) {
    const position = `${value?.row}:${value?.column}`;
    if (!value || !uuid(value.id) || ids.has(value.id) || positions.has(position) || !Number.isSafeInteger(value.row) || value.row < 0 || !Number.isSafeInteger(value.column) || value.column < 0 || value.column >= manifest.columns.length || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0 || !Number.isSafeInteger(value.receivedBytes) || value.receivedBytes < 0 || value.receivedBytes > value.totalBytes || !['utf8', 'binary'].includes(value.representation) || typeof value.databaseType !== 'string' || !Array.isArray(value.parts) || typeof value.complete !== 'boolean') throw new DbLinkResultError('db_result_corrupt');
    ids.add(value.id); positions.add(position);
    let offset = 0;
    for (const [partIndex, part] of value.parts.entries()) {
      if (part.file !== `value-${String(valueIndex + 1).padStart(6, '0')}-part-${String(partIndex + 1).padStart(6, '0')}.json` || part.offset !== offset || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || !Number.isSafeInteger(part.encodedBytes) || part.encodedBytes < 1 || part.encodedBytes > 52_428_800 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new DbLinkResultError('db_result_corrupt');
      offset += part.bytes;
    }
    if (offset !== value.receivedBytes || value.complete && (offset !== value.totalBytes || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) || manifest.status === 'complete' && (!value.complete || value.row >= manifest.persistedRows)) throw new DbLinkResultError('db_result_value_incomplete');
  }
}
function validateRowValueRefs(manifest: DbResultManifest, rows: DbResultCell[][], startRow: number): void {
  for (const [index, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== manifest.columns.length) throw new DbLinkResultError('db_result_corrupt');
    for (const [column, cell] of row.entries()) {
      const value = manifest.values?.find(value => value.row === startRow + index && value.column === column);
      if (cell && typeof cell === 'object' && cell.type === 'segmented') {
        if (!value?.complete || cell.valueId !== value.id || cell.sha256 !== value.sha256 || cell.bytes !== value.totalBytes || cell.representation !== value.representation || cell.databaseType !== value.databaseType) throw new DbLinkResultError('db_result_invalid_value_reference');
      } else if (value) throw new DbLinkResultError('db_result_invalid_value_reference');
    }
  }
}
async function readValuePart(file: string, part: DbResultValue['parts'][number]): Promise<Buffer> {
  const body = await readRegular(file, part.encodedBytes);
  if (Buffer.byteLength(body) !== part.encodedBytes || digest(body) !== part.sha256) throw new DbLinkResultError('db_result_changed');
  const data = JSON.parse(body) as { offset?: unknown; base64?: unknown };
  if (data.offset !== part.offset || typeof data.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)) throw new DbLinkResultError('db_result_corrupt');
  const bytes = Buffer.from(data.base64, 'base64');
  if (bytes.length !== part.bytes || bytes.toString('base64') !== data.base64) throw new DbLinkResultError('db_result_corrupt');
  return bytes;
}
function validateOwner(owner: DbResultOwner): void {
  const keys = ['projectId', 'taskId', 'requestId', 'operationId'] as const;
  if (Object.keys(owner).length !== keys.length || keys.some(key => typeof owner[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(owner[key]))) throw new DbLinkResultError('db_result_invalid_owner');
}
function validateDefinition(source: DbResultSource, columns: DbResultColumn[], limits: DbResultLimits): void {
  if (!source.sourceIdentity || !source.connectionId || !Number.isSafeInteger(source.connectionRevision) || source.connectionRevision < 1 || !['postgresql', 'mysql'].includes(source.engine) || typeof source.sql !== 'string' || !source.sql || !Array.isArray(source.parameters) || !Array.isArray(columns) || columns.length > 4096) throw new DbLinkResultError('db_result_invalid_definition');
  if (columns.some((column, index) => column.ordinal !== index || typeof column.name !== 'string' || !column.databaseType || column.precision !== null && !Number.isSafeInteger(column.precision) || column.scale !== null && !Number.isSafeInteger(column.scale))) throw new DbLinkResultError('db_result_invalid_columns');
  validateSourceLimitations(source.limitations);
  if (Object.values(limits).length !== 4 || Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1) || limits.maxBytes > 1_073_741_824 || limits.maxCellBytes > limits.maxBytes || limits.chunkBytes > limits.maxBytes) throw new DbLinkResultError('db_result_invalid_limits');
  if (Buffer.byteLength(JSON.stringify({ source, columns })) > 131_072) throw new DbLinkResultError('db_result_metadata_limit');
}
function validateSourceLimitations(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 100 || value.some(code => typeof code !== 'string' || code.length > 160 || !/^db_[a-z0-9_]+$/.test(code)) || value.join('').length > 12000) throw new DbLinkResultError('db_result_invalid_limitations');
}
function validateCell(value: DbResultCell, maxBytes: number): DbResultCell {
  if (value === null) return null;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > maxBytes) throw new DbLinkResultError('db_result_cell_limit');
    return value;
  }
  if (value && typeof value === 'object' && value.type === 'binary' && typeof value.base64 === 'string' && Buffer.from(value.base64, 'base64').toString('base64') === value.base64) {
    if (Buffer.byteLength(value.base64, 'base64') > maxBytes) throw new DbLinkResultError('db_result_cell_limit');
    return { type: 'binary', base64: value.base64 };
  }
  if (value && typeof value === 'object' && value.type === 'float' && ['NaN', 'Infinity', '-Infinity', '-0'].includes(value.value)) return { type: 'float', value: value.value };
  throw new DbLinkResultError('db_result_invalid_cell');
}
async function childDirectory(parent: string, name: string): Promise<string> {
  const target = path.join(parent, name);
  try { await mkdir(target, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DbLinkResultError('db_result_unsafe_path');
  await assertContained(parent, target); return target;
}
async function privateRoot(dataRoot: string): Promise<string> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  return childDirectory(await realpath(dataRoot), 'db-link');
}
async function assertContained(root: string, target: string): Promise<void> {
  const resolved = await realpath(target), relation = path.relative(await realpath(root), resolved);
  if (relation.startsWith(`..${path.sep}`) || relation === '..' || path.isAbsolute(relation)) throw new DbLinkResultError('db_result_unsafe_path');
}
async function writeNew(file: string, value: string): Promise<void> {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}
async function readRegular(file: string, maxBytes: number): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new DbLinkResultError('db_result_corrupt');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, digest, exists, readBytes, safePath, writeExclusive } from './project-data-context-io.ts';
import { StrategyDiscussionFault, discussionId } from './strategy-discussion-store.ts';
import {
  STRATEGY_MAP_IMPORT_MAX_BYTES,
  decodeStrategyMapImportFile,
  detectImportFormat,
  type DecodedStrategyMapImport,
  type StrategyMapImportFormat,
} from './strategy-map-import.ts';

export type MapImportOriginKind = 'upload' | 'discussion-attachment' | 'project-file';

export interface StoredMapImportSource {
  sourceId: string;
  discussionId: string;
  format: StrategyMapImportFormat;
  fileName: string;
  sha256: string;
  bytesLength: number;
  origin: MapImportOriginKind;
  /** Non-sensitive reference identifiers for external attachment or project file reuse */
  attachmentSourceId?: string;
  projectId?: string;
  uploadId?: string;
  projectPath?: string;
  pageCount: number;
  selectedPages?: number[];
  createdAt: string;
  revokedAt?: string;
}

const fault = (code: string, status = 409): never => {
  throw new StrategyDiscussionFault(code, status);
};

export class StrategyMapImportStore {
  readonly dataRoot: string;
  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
  }

  private ownerKey(id: string) {
    return 'discussion-' + discussionId(id);
  }

  private async manifestPath(id: string, create = false) {
    return safePath(this.dataRoot, `strategy-map-imports/${this.ownerKey(id)}/sources.json`, create);
  }

  private async blobPath(id: string, sha256: string, ext: string, create = false) {
    if (!/^[a-f0-9]{64}$/.test(sha256)) fault('strategy_map_import_invalid_hash', 400);
    return safePath(this.dataRoot, `strategy-map-imports/${this.ownerKey(id)}/${sha256}${ext}`, create);
  }

  private async readManifest(id: string): Promise<StoredMapImportSource[]> {
    let file: string;
    try {
      file = await this.manifestPath(id, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (!(await exists(file))) return [];
    const raw = JSON.parse((await readBytes(file, 2 * 1024 * 1024)).toString('utf8'));
    return Array.isArray(raw?.sources) ? (raw.sources as StoredMapImportSource[]) : [];
  }

  private async writeManifest(id: string, sources: StoredMapImportSource[]): Promise<void> {
    const file = await this.manifestPath(id, true);
    await atomicJson(file, { version: 1, sources });
  }

  async list(discussionIdValue: string): Promise<StoredMapImportSource[]> {
    return this.readManifest(discussionIdValue);
  }

  async get(discussionIdValue: string, sourceId: string): Promise<StoredMapImportSource> {
    const found = (await this.readManifest(discussionIdValue)).find(s => s.sourceId === sourceId);
    if (!found) fault('strategy_map_import_not_found', 404);
    return found!;
  }

  async assertActive(discussionIdValue: string, sourceId: string): Promise<StoredMapImportSource> {
    const item = await this.get(discussionIdValue, sourceId);
    if (item.revokedAt) fault('strategy_map_import_revoked', 403);
    return item;
  }

  async saveUpload(
    discussionIdValue: string,
    fileName: string,
    bytes: Buffer,
  ): Promise<{ source: StoredMapImportSource; decoded: DecodedStrategyMapImport }> {
    const format = detectImportFormat(fileName);
    const decoded = await decodeStrategyMapImportFile(fileName, bytes);
    const sha256 = decoded.sha256;
    const ext = path.extname(fileName).toLowerCase();
    const blob = await this.blobPath(discussionIdValue, sha256, ext, true);

    if (await exists(blob)) {
      const existing = await readBytes(blob, STRATEGY_MAP_IMPORT_MAX_BYTES);
      if (digest(existing) !== sha256) fault('strategy_map_import_source_changed', 409);
    } else {
      const temp = `${blob}.${randomUUID()}.pending`;
      try {
        await writeExclusive(temp, bytes);
        await fs.rename(temp, blob);
        const dir = await fs.open(path.dirname(blob), 'r');
        try { await dir.sync(); } finally { await dir.close(); }
      } finally {
        await fs.unlink(temp).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      }
    }

    const sources = await this.readManifest(discussionIdValue);
    const sourceId = `map-src-${createHash('sha256').update(JSON.stringify([discussionIdValue, 'upload', fileName, sha256])).digest('hex').slice(0, 24)}`;
    const existingEntry = sources.find(s => s.sourceId === sourceId);
    if (existingEntry) {
      if (existingEntry.revokedAt) fault('strategy_map_import_revoked', 403);
      return { source: existingEntry, decoded };
    }

    const entry: StoredMapImportSource = {
      sourceId,
      discussionId: discussionIdValue,
      format,
      fileName,
      sha256,
      bytesLength: bytes.byteLength,
      origin: 'upload',
      pageCount: decoded.pages.length,
      createdAt: new Date().toISOString(),
    };
    sources.push(entry);
    await this.writeManifest(discussionIdValue, sources);
    return { source: entry, decoded };
  }

  async registerExternal(
    discussionIdValue: string,
    meta: {
      origin: 'discussion-attachment' | 'project-file';
      fileName: string;
      bytes: Buffer;
      attachmentSourceId?: string;
      projectId?: string;
      uploadId?: string;
      projectPath?: string;
    },
  ): Promise<{ source: StoredMapImportSource; decoded: DecodedStrategyMapImport }> {
    const format = detectImportFormat(meta.fileName);
    const decoded = await decodeStrategyMapImportFile(meta.fileName, meta.bytes);
    const sources = await this.readManifest(discussionIdValue);
    const sourceId = `map-src-${createHash('sha256').update(JSON.stringify([
      discussionIdValue,
      meta.origin,
      meta.attachmentSourceId ?? null,
      meta.projectId ?? null,
      meta.uploadId ?? null,
      meta.fileName,
      decoded.sha256,
    ])).digest('hex').slice(0, 24)}`;

    const existing = sources.find(s => s.sourceId === sourceId);
    if (existing) {
      if (existing.revokedAt) fault('strategy_map_import_revoked', 403);
      return { source: existing, decoded };
    }

    const entry: StoredMapImportSource = {
      sourceId,
      discussionId: discussionIdValue,
      format,
      fileName: meta.fileName,
      sha256: decoded.sha256,
      bytesLength: meta.bytes.byteLength,
      origin: meta.origin,
      ...(meta.attachmentSourceId ? { attachmentSourceId: meta.attachmentSourceId } : {}),
      ...(meta.projectId ? { projectId: meta.projectId } : {}),
      ...(meta.uploadId ? { uploadId: meta.uploadId } : {}),
      ...(meta.projectPath ? { projectPath: meta.projectPath } : {}),
      pageCount: decoded.pages.length,
      createdAt: new Date().toISOString(),
    };
    sources.push(entry);
    await this.writeManifest(discussionIdValue, sources);
    return { source: entry, decoded };
  }

  async revoke(discussionIdValue: string, sourceId: string): Promise<StoredMapImportSource> {
    const sources = await this.readManifest(discussionIdValue);
    const index = sources.findIndex(s => s.sourceId === sourceId);
    if (index < 0) fault('strategy_map_import_not_found', 404);
    const updated: StoredMapImportSource = {
      ...sources[index]!,
      revokedAt: sources[index]!.revokedAt ?? new Date().toISOString(),
    };
    sources[index] = updated;
    await this.writeManifest(discussionIdValue, sources);
    return updated;
  }

  async readBytes(
    discussionIdValue: string,
    sourceId: string,
    resolveExternal?: (source: StoredMapImportSource) => Promise<Buffer>,
  ): Promise<Buffer> {
    const item = await this.assertActive(discussionIdValue, sourceId);
    let bytes: Buffer;
    if (item.origin === 'upload') {
      const ext = path.extname(item.fileName).toLowerCase();
      try {
        bytes = await readBytes(await this.blobPath(discussionIdValue, item.sha256, ext), STRATEGY_MAP_IMPORT_MAX_BYTES);
      } catch {
        return fault('strategy_map_import_source_unavailable', 404);
      }
    } else {
      if (!resolveExternal) return fault('strategy_map_import_source_unavailable', 403);
      bytes = await resolveExternal(item);
    }
    if (digest(bytes) !== item.sha256) fault('strategy_map_import_source_changed', 409);
    return bytes;
  }
}

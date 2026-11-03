import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SnapshotManifest, DataVersion } from './types.ts';

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function snapshotVersion(manifest: SnapshotManifest): DataVersion {
  const { datasetId, digest, generatedAt, total, sourceHead, sourceRepo, engineVersion, importerVersion } = manifest;
  return { datasetId, digest, generatedAt, total, sourceHead, sourceRepo, engineVersion, importerVersion };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function snapshotDigest(manifest: Omit<SnapshotManifest, 'digest' | 'importedAt'>): string {
  const { schemaVersion, datasetId, sourceRepo, sourceHead, engineVersion, generatedAt, total, importerVersion, files } = manifest;
  return sha256(Buffer.from(canonical({ schemaVersion, datasetId, sourceRepo, sourceHead, engineVersion, generatedAt, total, importerVersion, files })));
}
export function readSnapshotManifest(root: string): SnapshotManifest {
  const file = path.join(root, 'snapshot.json');
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('snapshot: unsafe manifest');
  const value = JSON.parse(readFileSync(file, 'utf8')) as SnapshotManifest;
  if (!value || value.schemaVersion !== 1 || value.datasetId !== 'optracall-tradearea-data' || value.sourceRepo !== 'trade-area'
    || ![1, 2].includes(value.importerVersion) || !Number.isSafeInteger(value.total) || value.total < 0
    || typeof value.sourceHead !== 'string' || !value.sourceHead || typeof value.engineVersion !== 'string' || !value.engineVersion
    || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
    || typeof value.importedAt !== 'string' || !Number.isFinite(Date.parse(value.importedAt))
    || typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest) || !Array.isArray(value.files) || !value.files.length) throw new Error('snapshot: invalid manifest');
  const paths = new Set<string>();
  for (const entry of value.files) {
    if (!entry || typeof entry.path !== 'string' || !/^(?:index\.json|details\/s[0-9]+\.json)$/.test(entry.path)
      || paths.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('snapshot: invalid file entry');
    paths.add(entry.path);
  }
  if (!paths.has('index.json') || snapshotDigest(value) !== value.digest) throw new Error('snapshot: identity mismatch');
  return value;
}
export function snapshotDirectory(root: string, manifest: SnapshotManifest): string {
  if (manifest.importerVersion === 1) return root;
  // A complete versions/<digest> directory is independently readable for historical inspection.
  const resolved = path.resolve(root);
  return path.basename(resolved) === manifest.digest && path.basename(path.dirname(resolved)) === 'versions'
    ? resolved : path.join(resolved, 'versions', manifest.digest);
}
export function readSnapshotFile(root: string, manifest: SnapshotManifest, relative: string): Buffer {
  const entry = manifest.files.find(item => item.path === relative);
  if (!entry) throw new Error('snapshot: file not in manifest');
  const file = path.join(snapshotDirectory(root, manifest), relative), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('snapshot: unsafe data file');
  const bytes = readFileSync(file);
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error('snapshot: content mismatch');
  return bytes;
}

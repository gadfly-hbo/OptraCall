import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SapPublication } from '../sap/validate.ts';

export type LibraryEntry = Readonly<{
  id: string; version: string; namespace: string;
  packageFingerprint: string; contentFingerprint: string; bytesSha256: string; bytes: number;
  publishedAt: string; publishedBy: string;
  metricNames: readonly string[]; scenarioIds: readonly string[];
}>;

export class MetricLibraryFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const idPattern = /^[a-z][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const identifierPattern = /^[a-z][a-z0-9_]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const fingerprintPattern = /^sha256:[a-f0-9]{64}$/;
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (code: string): never => { throw new MetricLibraryFault(code); };
const compareVersion = (a: string, b: string): number => { const left = a.split('.').map(Number), right = b.split('.').map(Number); return left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!; };

function decodeEntry(value: unknown): LibraryEntry {
  if (!object(value) || !idPattern.test(String(value.id)) || !semverPattern.test(String(value.version)) || typeof value.namespace !== 'string'
    || !fingerprintPattern.test(String(value.packageFingerprint)) || !fingerprintPattern.test(String(value.contentFingerprint))
    || !sha256Pattern.test(String(value.bytesSha256)) || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0
    || !isoDate(value.publishedAt) || typeof value.publishedBy !== 'string' || !value.publishedBy.trim() || value.publishedBy.length > 200
    || !Array.isArray(value.metricNames) || !value.metricNames.every((name: unknown) => typeof name === 'string' && identifierPattern.test(name))
    || !Array.isArray(value.scenarioIds) || !value.scenarioIds.every((name: unknown) => typeof name === 'string' && identifierPattern.test(name))) return fail('LIBRARY_CORRUPT');
  return {
    id: value.id as string, version: value.version as string, namespace: value.namespace as string,
    packageFingerprint: value.packageFingerprint as string, contentFingerprint: value.contentFingerprint as string,
    bytesSha256: value.bytesSha256 as string, bytes: value.bytes as number,
    publishedAt: value.publishedAt as string, publishedBy: value.publishedBy as string,
    metricNames: value.metricNames as string[], scenarioIds: value.scenarioIds as string[],
  };
}

/** Immutable file library under one root: `<id>/<version>.sap.yaml` plus a strict `index.json`. */
export function createMetricLibrary(directory: string) {
  const root = path.resolve(directory);
  const indexPath = path.join(root, 'index.json');
  const packageDirectory = (id: string) => path.join(root, id);
  const versionFile = (id: string, version: string) => path.join(root, id, `${version}.sap.yaml`);

  const ensureRoot = () => {
    try { mkdirSync(root, { recursive: true, mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const entry = lstatSync(root);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('LIBRARY_UNSAFE_ROOT');
    chmodSync(root, 0o700);
  };

  const loadIndex = (): LibraryEntry[] => {
    if (!existsSync(indexPath)) return [];
    const entry = lstatSync(indexPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail('LIBRARY_CORRUPT');
    let value: unknown;
    try { value = JSON.parse(readFileSync(indexPath, 'utf8')); } catch { return fail('LIBRARY_CORRUPT'); }
    if (!object(value) || value.version !== 1 || !Array.isArray(value.entries)) return fail('LIBRARY_CORRUPT');
    const entries = value.entries.map(decodeEntry);
    const seen = new Set(entries.map(item => `${item.id}@${item.version}`));
    if (seen.size !== entries.length) fail('LIBRARY_CORRUPT');
    return entries;
  };

  const saveIndex = (entries: LibraryEntry[]): void => {
    const temporary = `${indexPath}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      const handle = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(handle, JSON.stringify({ version: 1, entries }, null, 2) + '\n'); fsyncSync(handle); } finally { closeSync(handle); }
      renameSync(temporary, indexPath);
      const directory = openSync(root, 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  };

  const verifiedBytes = (file: string, expected: LibraryEntry): string => {
    const entry = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size !== expected.bytes) fail('LIBRARY_CORRUPT');
    const bytes = readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== expected.bytesSha256) fail('LIBRARY_CORRUPT');
    return bytes.toString('utf8');
  };

  const verifyPackage = (entries: LibraryEntry[], id: string): void => {
    for (const entry of entries.filter(item => item.id === id)) {
      const file = versionFile(entry.id, entry.version);
      if (!existsSync(file)) fail('LIBRARY_CORRUPT');
      verifiedBytes(file, entry);
    }
  };

  return {
    root,
    publish(publication: SapPublication, publishedBy: string): LibraryEntry {
      if (typeof publishedBy !== 'string' || !publishedBy.trim() || publishedBy.length > 200) fail('LIBRARY_PUBLISHER_INVALID');
      const document = publication.document;
      if (!idPattern.test(document.package.id) || !semverPattern.test(document.package.version)) fail('LIBRARY_PUBLICATION_INVALID');
      ensureRoot();
      const entries = loadIndex();
      const existing = entries.find(entry => entry.id === document.package.id && entry.version === document.package.version);
      if (existing) {
        if (existing.bytesSha256 === publication.bytesSha256 && existing.packageFingerprint === publication.packageFingerprint && existing.contentFingerprint === publication.contentFingerprint) return existing;
        return fail('LIBRARY_VERSION_CONFLICT');
      }
      if (entries.some(entry => entry.id === document.package.id && entry.contentFingerprint === publication.contentFingerprint)) fail('LIBRARY_SAME_CONTENT');
      verifyPackage(entries, document.package.id);
      const directory = packageDirectory(document.package.id);
      try { mkdirSync(directory, { recursive: true, mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('LIBRARY_CORRUPT');
      chmodSync(directory, 0o700);
      const file = versionFile(document.package.id, document.package.version);
      const bytes = Buffer.from(publication.canonicalYaml, 'utf8');
      if (existsSync(file)) {
        // An interrupted publish may leave the version file without its index entry.
        const entry = lstatSync(file);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail('LIBRARY_CORRUPT');
        if (!readFileSync(file).equals(bytes)) fail('LIBRARY_VERSION_CONFLICT');
      } else {
        const handle = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
      }
      const entry: LibraryEntry = {
        id: document.package.id, version: document.package.version, namespace: document.package.namespace,
        packageFingerprint: publication.packageFingerprint, contentFingerprint: publication.contentFingerprint,
        bytesSha256: publication.bytesSha256, bytes: publication.bytes,
        publishedAt: new Date().toISOString(), publishedBy: publishedBy.trim(),
        metricNames: document.metrics.map(metric => metric.name), scenarioIds: document.scenarios.map(scenario => scenario.id),
      };
      const next = [...entries, entry].sort((a, b) => a.id.localeCompare(b.id) || compareVersion(a.version, b.version));
      saveIndex(next);
      return entry;
    },
    list(): readonly LibraryEntry[] {
      if (!existsSync(root)) return [];
      return loadIndex();
    },
    read(id: string, version?: string): { entry: LibraryEntry; canonicalYaml: string } {
      if (typeof id !== 'string' || !idPattern.test(id)) fail('LIBRARY_NOT_FOUND');
      const entries = loadIndex().filter(entry => entry.id === id);
      if (!entries.length) fail('LIBRARY_NOT_FOUND');
      const target = version === undefined
        ? entries.reduce((latest, entry) => compareVersion(entry.version, latest.version) > 0 ? entry : latest, entries[0]!)
        : entries.find(entry => entry.version === version) ?? fail('LIBRARY_NOT_FOUND');
      if (typeof version === 'string' && !semverPattern.test(version)) fail('LIBRARY_NOT_FOUND');
      const file = versionFile(id, target.version);
      if (!existsSync(file)) fail('LIBRARY_CORRUPT');
      return { entry: target, canonicalYaml: verifiedBytes(file, target) };
    },
    filePath: (id: string, version: string) => versionFile(id, version),
    removeTemporary: (temporary: string) => { if (existsSync(temporary)) unlinkSync(temporary); },
  };
}

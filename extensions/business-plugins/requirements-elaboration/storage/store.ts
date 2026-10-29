import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument, visit, isAlias, isScalar } from 'yaml';
import {
  buildRapPublication, canonicalYaml, isStale, parseInstance, upstreamDigest, upstreamFingerprint, upstreamOf,
  RequirementFault, type RequirementInstance, type RapDocument, type RapPublication, type Scene,
} from '../contract/validate.ts';

export type RequirementReleaseEntry = Readonly<{
  id: string; version: string; scene: Scene; title: string;
  packageFingerprint: string; contentFingerprint: string;
  releasedAt: string; releasedBy: string;
  openQuestionCount: number; metricCount: number;
}>;
export type InstanceSummary = Readonly<{ id: string; title: string; scene: Scene; createdAt: string; updatedAt: string }>;

export class RequirementStoreFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const instanceIdPattern = /^req-[a-z0-9][a-z0-9-]{0,60}$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const fingerprintPattern = /^sha256:[a-f0-9]{64}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (code: string): never => { throw new RequirementStoreFault(code); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function parseYamlObject(bytes: Uint8Array): Record<string, unknown> {
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('REQ_STORE_CORRUPT'); }
  const document = parseDocument(source, { uniqueKeys: true, version: '1.2', schema: 'core' });
  if (document.errors.length || document.warnings.length) fail('REQ_STORE_CORRUPT');
  visit(document, (_key, node) => { if (isAlias(node) || node && typeof node === 'object' && 'anchor' in node && node.anchor || isScalar(node) && node.tag) fail('REQ_STORE_CORRUPT'); });
  try { const value = document.toJS({ maxAliasCount: 0 }); return object(value) ? value : fail('REQ_STORE_CORRUPT'); } catch { return fail('REQ_STORE_CORRUPT'); }
}

/** Same fingerprint scope as buildRapPublication: release metadata and the fingerprint itself excluded. */
function rapFingerprints(value: Record<string, unknown>): { packageFingerprint: string; contentFingerprint: string } {
  const masked = { ...value, id: '', version: '', releasedAt: '', releasedBy: '', fingerprint: '' };
  return {
    contentFingerprint: 'sha256:' + hash(canonicalYaml(masked)),
    packageFingerprint: 'sha256:' + hash(canonicalYaml({ ...masked, id: String(value.id ?? ''), version: String(value.version ?? '') })),
  };
}

function decodeReleaseEntry(value: unknown): RequirementReleaseEntry {
  if (!object(value) || !instanceIdPattern.test(String(value.id)) || !semverPattern.test(String(value.version))
    || !['daily', 'topic', 'recurring'].includes(String(value.scene)) || typeof value.title !== 'string' || !value.title.trim()
    || !fingerprintPattern.test(String(value.packageFingerprint)) || !fingerprintPattern.test(String(value.contentFingerprint))
    || !isoDate(value.releasedAt) || typeof value.releasedBy !== 'string' || !value.releasedBy.trim() || value.releasedBy.length > 200
    || !Number.isSafeInteger(value.openQuestionCount) || (value.openQuestionCount as number) < 0
    || !Number.isSafeInteger(value.metricCount) || (value.metricCount as number) < 0) fail('REQ_STORE_CORRUPT');
  return value as unknown as RequirementReleaseEntry;
}

const atomicWrite = (target: string, bytes: Buffer, mode: 0o600) => {
  const temporary = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    const handle = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
    renameSync(temporary, target);
    const directory = openSync(path.dirname(target), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
};

const ensureDirectory = (target: string) => {
  try { mkdirSync(target, { recursive: true, mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const entry = lstatSync(target);
  if (!entry.isDirectory() || entry.isSymbolicLink()) fail('REQ_STORE_CORRUPT');
  chmodSync(target, 0o700);
};

/** File-backed store: `<root>/<id>/instance.yaml` + immutable `snapshots/`, and a release library at `<root>/releases/`. */
export function createRequirementStore(directory: string) {
  const root = path.resolve(directory);
  const instanceDirectory = (id: string) => path.join(root, id);
  const instanceFile = (id: string) => path.join(root, id, 'instance.yaml');
  const releasesRoot = path.join(root, 'releases');
  const releaseFile = (id: string, version: string) => path.join(releasesRoot, id, `${version}.rap.yaml`);
  const releasesIndexPath = path.join(releasesRoot, 'index.json');

  const checkedId = (id: string): string => {
    if (typeof id !== 'string' || !instanceIdPattern.test(id)) fail('REQ_STORE_NOT_FOUND');
    return id;
  };
  const readInstance = (id: string): RequirementInstance => {
    checkedId(id);
    const file = instanceFile(id);
    if (!existsSync(file)) fail('REQ_STORE_NOT_FOUND');
    const entry = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail('REQ_STORE_CORRUPT');
    try {
      const instance = parseInstance(new Uint8Array(readFileSync(file)));
      if (instance.instance.id !== id) fail('REQ_STORE_CORRUPT');
      return instance;
    } catch (error) {
      if (error instanceof RequirementFault && error.code !== 'REQ_UNKNOWN_FIELD' && error.code !== 'REQ_FILE_SIZE') fail('REQ_STORE_CORRUPT');
      throw error;
    }
  };
  const persist = (instance: RequirementInstance): RequirementInstance => {
    const stamped: RequirementInstance = { ...instance, instance: { ...instance.instance, updatedAt: new Date().toISOString() } };
    const canonical = canonicalYaml(stamped);
    let roundTrip: RequirementInstance;
    try { roundTrip = parseInstance(new Uint8Array(Buffer.from(canonical, 'utf8'))); }
    catch (error) { if (error instanceof RequirementFault) throw new RequirementStoreFault(error.code); throw error; }
    ensureDirectory(instanceDirectory(stamped.instance.id));
    atomicWrite(instanceFile(stamped.instance.id), Buffer.from(canonical, 'utf8'), 0o600);
    return roundTrip;
  };

  const loadReleaseIndex = (): RequirementReleaseEntry[] => {
    if (!existsSync(releasesIndexPath)) return [];
    const entry = lstatSync(releasesIndexPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail('REQ_STORE_CORRUPT');
    let value: unknown;
    try { value = JSON.parse(readFileSync(releasesIndexPath, 'utf8')); } catch { return fail('REQ_STORE_CORRUPT'); }
    if (!object(value) || value.version !== 1 || !Array.isArray(value.entries)) return fail('REQ_STORE_CORRUPT');
    const raw: unknown[] = value.entries;
    const entries = raw.map(item => decodeReleaseEntry(item));
    const seen = new Set(entries.map(item => `${item.id}@${item.version}`));
    if (seen.size !== entries.length) fail('REQ_STORE_CORRUPT');
    return entries;
  };
  const saveReleaseIndex = (entries: RequirementReleaseEntry[]) => {
    ensureDirectory(releasesRoot);
    atomicWrite(releasesIndexPath, Buffer.from(JSON.stringify({ version: 1, entries }, null, 2) + '\n', 'utf8'), 0o600);
  };

  return {
    root,
    create(input: { title: string; scene: Scene }): RequirementInstance {
      const title = String(input.title ?? '').trim();
      if (!title || title.length > 200) fail('REQ_STRUCTURE');
      const id = `req-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const now = new Date().toISOString();
      return persist({
        instance: { version: '0.1', id, scene: input.scene, title, createdAt: now, updatedAt: now },
        context: { background: '', goal: '', decisionScenario: '' },
        clarifications: [], facts: [], hypotheses: [],
      });
    },
    list(): readonly InstanceSummary[] {
      if (!existsSync(root)) return [];
      const entry = lstatSync(root);
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('REQ_STORE_CORRUPT');
      return readdirSync(root)
        .filter(name => name !== 'releases')
        .map(name => { const instance = readInstance(name); return { id: instance.instance.id, title: instance.instance.title, scene: instance.instance.scene, createdAt: instance.instance.createdAt, updatedAt: instance.instance.updatedAt }; })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    read(id: string): RequirementInstance { return readInstance(id); },
    save(instance: RequirementInstance): RequirementInstance {
      const previous = readInstance(instance.instance.id);
      // Identity and audit fields are store-owned; a save never forges a different instance.
      if (previous.instance.createdAt !== instance.instance.createdAt) fail('REQ_STORE_CORRUPT');
      return persist({ ...instance, instance: { ...instance.instance, id: previous.instance.id, createdAt: previous.instance.createdAt } });
    },
    /** Freezes the current upstream into an immutable snapshot file and points the instance at it. */
    confirm(instance: RequirementInstance, confirmedBy: string): { fingerprint: string; confirmedAt: string; upstreamDigest: string; confirmedBy: string } {
      if (typeof confirmedBy !== 'string' || !confirmedBy.trim() || confirmedBy.length > 200) fail('REQ_STRUCTURE');
      readInstance(instance.instance.id);
      const digest = upstreamDigest(instance);
      if (instance.snapshot && instance.snapshot.upstreamDigest === digest) return instance.snapshot;
      const fingerprint = upstreamFingerprint(instance);
      const confirmedAt = new Date().toISOString();
      const snapshots = path.join(instanceDirectory(instance.instance.id), 'snapshots');
      ensureDirectory(snapshots);
      const name = `${randomUUID().slice(0, 8)}-${digest.slice(0, 8)}.yaml`;
      const frozen = canonicalYaml({ fingerprint, confirmedAt, upstreamDigest: digest, confirmedBy: confirmedBy.trim(), upstream: upstreamOf(instance) });
      atomicWrite(path.join(snapshots, name), Buffer.from(frozen, 'utf8'), 0o600);
      const next: RequirementInstance = { ...instance, snapshot: { fingerprint, confirmedAt, upstreamDigest: digest, confirmedBy: confirmedBy.trim() } };
      persist(next);
      return next.snapshot!;
    },
    /** Publishes the RAP 0.2 contract into the immutable release library. */
    publish(id: string, version: string, releasedBy: string): RequirementReleaseEntry {
      const instance = readInstance(id);
      let publication: RapPublication;
      try { publication = buildRapPublication(instance, version, releasedBy); }
      catch (error) { if (error instanceof RequirementFault) throw new RequirementStoreFault(error.code); throw error; }
      const entries = loadReleaseIndex();
      const existing = entries.find(entry => entry.id === id && entry.version === version);
      if (existing) {
        if (existing.packageFingerprint === publication.packageFingerprint && existing.contentFingerprint === publication.contentFingerprint) return existing;
        fail('REQ_VERSION_CONFLICT');
      }
      if (entries.some(entry => entry.id === id && entry.contentFingerprint === publication.contentFingerprint)) fail('REQ_SAME_CONTENT');
      for (const entry of entries.filter(item => item.id === id)) {
        const file = releaseFile(entry.id, entry.version);
        if (!existsSync(file)) fail('REQ_STORE_CORRUPT');
        verifiedRelease(file, entry);
      }
      ensureDirectory(path.join(releasesRoot, id));
      const file = releaseFile(id, version);
      const bytes = Buffer.from(publication.canonicalYamlText, 'utf8');
      if (existsSync(file)) {
        const entry = lstatSync(file);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail('REQ_STORE_CORRUPT');
        // An interrupted publish may leave the file without its index entry.
        const parsed = parseYamlObject(new Uint8Array(readFileSync(file)));
        if (parsed.fingerprint !== publication.packageFingerprint) fail('REQ_VERSION_CONFLICT');
      } else atomicWrite(file, bytes, 0o600);
      const entry: RequirementReleaseEntry = {
        id, version, scene: instance.instance.scene, title: instance.instance.title,
        packageFingerprint: publication.packageFingerprint, contentFingerprint: publication.contentFingerprint,
        releasedAt: publication.rap.releasedAt, releasedBy: releasedBy.trim(),
        openQuestionCount: publication.rap.openQuestions.length, metricCount: publication.rap.metrics.length,
      };
      saveReleaseIndex([...entries, entry].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version)));
      return entry;
    },
    releases(id: string): readonly RequirementReleaseEntry[] {
      checkedId(id);
      return loadReleaseIndex().filter(entry => entry.id === id);
    },
    readRelease(id: string, version?: string): { entry: RequirementReleaseEntry; rap: RapDocument } {
      checkedId(id);
      if (version !== undefined && !semverPattern.test(version)) fail('REQ_STORE_NOT_FOUND');
      const entries = loadReleaseIndex().filter(entry => entry.id === id);
      if (!entries.length) fail('REQ_STORE_NOT_FOUND');
      const compare = (a: string, b: string) => a.split('.').map(Number).reduce((acc, part, index) => acc || part - Number(b.split('.')[index]), 0);
      const target = version === undefined ? entries.reduce((latest, entry) => compare(entry.version, latest.version) > 0 ? entry : latest, entries[0]!) : entries.find(entry => entry.version === version) ?? fail('REQ_STORE_NOT_FOUND');
      const file = releaseFile(id, target.version);
      if (!existsSync(file)) fail('REQ_STORE_CORRUPT');
      const parsed = verifiedRelease(file, target);
      return { entry: target, rap: parsed as unknown as RapDocument };
    },
    isStale(id: string): boolean { return isStale(readInstance(id)); },
  };

  function verifiedRelease(file: string, expected: RequirementReleaseEntry): Record<string, unknown> {
    const entry = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail('REQ_STORE_CORRUPT');
    const parsed = parseYamlObject(new Uint8Array(readFileSync(file)));
    if (parsed.rap !== '0.2' || parsed.id !== expected.id || parsed.version !== expected.version) fail('REQ_STORE_CORRUPT');
    const fingerprints = rapFingerprints(parsed);
    if (fingerprints.packageFingerprint !== expected.packageFingerprint || fingerprints.contentFingerprint !== expected.contentFingerprint || parsed.fingerprint !== expected.packageFingerprint) fail('REQ_STORE_CORRUPT');
    return parsed;
  }
}

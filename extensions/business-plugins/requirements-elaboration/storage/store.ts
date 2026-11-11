import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument, visit, isAlias, isScalar } from 'yaml';
import {
  buildRapPublication, canonicalYaml, isStale, parseInstance, upstreamDigest, upstreamFingerprint, upstreamOf,
  RequirementFault, type RequirementInstance, type RapDocument, type RapPublication, type Scene,
} from '../contract/validate.ts';
import { frameworkVersionPattern, type FrameworkConfirmation, type FrameworkMaterialTarget, type FrameworkProposalRecord, type FrameworkReviewState } from '../contract/framework-review.ts';

export type RequirementReleaseEntry = Readonly<{
  id: string; version: string; scene: Scene; title: string;
  packageFingerprint: string; contentFingerprint: string;
  releasedAt: string; releasedBy: string;
  openQuestionCount: number; metricCount: number;
  frameworkVersion?: string;
}>;
export type InstanceSummary = Readonly<{ id: string; title: string; scene: Scene; createdAt: string; updatedAt: string }>;
export type RequirementFeedbackOrigin = { operationId: string; handoffId: string; requestHash: string };

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
    || value.frameworkVersion !== undefined && !frameworkVersionPattern.test(String(value.frameworkVersion))
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
  const readFeedbackOrigin = (id: string): RequirementFeedbackOrigin | null => {
    checkedId(id); const target = instanceDirectory(id);
    if (!existsSync(target)) return null;
    const dir = lstatSync(target); if (!dir.isDirectory() || dir.isSymbolicLink()) fail('REQ_STORE_CORRUPT');
    const file = path.join(target, 'feedback-creation-origin.json');
    if (!existsSync(file)) return null;
    const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) fail('REQ_STORE_CORRUPT');
    let value: unknown; try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { return fail('REQ_STORE_CORRUPT'); }
    if (!object(value) || Object.keys(value).sort().join(',') !== 'handoffId,operationId,requestHash' || !/^[a-f0-9-]{36}$/.test(String(value.operationId)) || !/^[a-f0-9-]{36}$/.test(String(value.handoffId)) || !digestPattern.test(String(value.requestHash))) fail('REQ_STORE_CORRUPT');
    return value as RequirementFeedbackOrigin;
  };

  const reviewFile = (id: string) => path.join(instanceDirectory(id), 'framework-review.json');
  const proposalFile = (id: string, version: string) => path.join(instanceDirectory(id), 'framework-proposals', version + '.json');
  const readReviewJson = (file: string): unknown => {
    if (!existsSync(file)) return undefined;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2_000_000) fail('REQ_STORE_CORRUPT');
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fail('REQ_STORE_CORRUPT'); }
  };
  const readFrameworkState = (id: string): FrameworkReviewState | undefined => {
    checkedId(id);
    const raw = readReviewJson(reviewFile(id));
    if (raw === undefined) return undefined;
    if (!object(raw) || !object(raw.input) || !frameworkVersionPattern.test(String(raw.input.revision))
      || raw.input.rapVersion !== undefined && !semverPattern.test(String(raw.input.rapVersion))
      || raw.input.materialTargets !== undefined && !Array.isArray(raw.input.materialTargets)
      || raw.current !== undefined && !frameworkVersionPattern.test(String(raw.current))
      || !Array.isArray(raw.confirmations) || raw.confirmations.some(item => !object(item)
        || !frameworkVersionPattern.test(String(item.version)) || !isoDate(item.confirmedAt) || typeof item.confirmedBy !== 'string')) return fail('REQ_STORE_CORRUPT');
    return raw as unknown as FrameworkReviewState;
  };
  const writeFrameworkState = (id: string, state: FrameworkReviewState) => atomicWrite(reviewFile(id), Buffer.from(JSON.stringify(state)), 0o600);
  const readFrameworkProposal = (id: string, version: string): FrameworkProposalRecord => {
    checkedId(id);
    if (!frameworkVersionPattern.test(version)) return fail('REQ_PROPOSAL_NOT_FOUND');
    const dir = path.dirname(proposalFile(id, version));
    if (!existsSync(dir)) return fail('REQ_PROPOSAL_NOT_FOUND');
    const dirEntry = lstatSync(dir);
    if (!dirEntry.isDirectory() || dirEntry.isSymbolicLink()) return fail('REQ_STORE_CORRUPT');
    const raw = readReviewJson(proposalFile(id, version));
    if (raw === undefined) return fail('REQ_PROPOSAL_NOT_FOUND');
    if (!object(raw) || raw.version !== version || !frameworkVersionPattern.test(String(raw.inputRevision))
      || !fingerprintPattern.test(String(raw.upstreamFingerprint)) || !fingerprintPattern.test(String(raw.draftFingerprint))
      || !object(raw.framework) || !object(raw.assessment) || !Array.isArray(raw.sources)
      || !object(raw.publicSearch) || raw.publicSearch.operationId !== version || !Array.isArray(raw.publicSearch.sources)) return fail('REQ_STORE_CORRUPT');
    return raw as unknown as FrameworkProposalRecord;
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
    readFeedbackOrigin,
    /** Feedback drafts retain the original YAML contract; source authority lives in the handoff. */
    createFromFeedback(input: { instanceId: string; title: string; scene: Scene; background: string; origin: RequirementFeedbackOrigin; resume?: boolean }): RequirementInstance {
      const id = checkedId(input.instanceId), title = String(input.title ?? '').trim(), origin = input.origin;
      if (!title || title.length > 200 || typeof input.background !== 'string' || input.background.length > 100000 || !object(origin) || !/^[a-f0-9-]{36}$/.test(origin.operationId) || !/^[a-f0-9-]{36}$/.test(origin.handoffId) || !digestPattern.test(origin.requestHash)) fail('REQ_STRUCTURE');
      ensureDirectory(root);
      const target = instanceDirectory(id);
      if (existsSync(target)) {
        const previous = readFeedbackOrigin(id);
        if (!previous || previous.operationId !== origin.operationId || previous.handoffId !== origin.handoffId || previous.requestHash !== origin.requestHash) fail('REQ_FEEDBACK_ORIGIN_CONFLICT');
        return readInstance(id);
      }
      const stagingRoot = `${root}.feedback-staging`; ensureDirectory(stagingRoot);
      const lockFile = path.join(stagingRoot, `${id}.publish.lock`);
      let claim: { origin: RequirementFeedbackOrigin; stagingName: string; createdAt: string; pid: number };
      if (existsSync(lockFile)) {
        const stat = lstatSync(lockFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) fail('REQ_STORE_CORRUPT');
        let previous: unknown; try { previous = JSON.parse(readFileSync(lockFile, 'utf8')); } catch { return fail('REQ_STORE_CORRUPT'); }
        if (!object(previous) || !object(previous.origin) || previous.origin.operationId !== origin.operationId || previous.origin.handoffId !== origin.handoffId || previous.origin.requestHash !== origin.requestHash || typeof previous.stagingName !== 'string' || !/^[a-f0-9-]{36}$/.test(previous.stagingName) || !isoDate(previous.createdAt) || !Number.isSafeInteger(previous.pid) || Number(previous.pid) < 1) fail('REQ_FEEDBACK_ORIGIN_CONFLICT');
        if (!input.resume) fail('REQ_FEEDBACK_CREATION_NEEDS_REVIEW');
        claim = previous as unknown as typeof claim;
        if (claim.pid !== process.pid) { try { process.kill(claim.pid, 0); fail('REQ_FEEDBACK_CREATION_NEEDS_REVIEW'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
      } else {
        claim = { origin, stagingName: randomUUID(), createdAt: new Date().toISOString(), pid: process.pid };
        const fd = openSync(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(fd, JSON.stringify(claim)); fsyncSync(fd); } finally { closeSync(fd); }
      }
      const staging = path.join(stagingRoot, claim.stagingName); ensureDirectory(staging);
      const instance: RequirementInstance = { instance: { version: '0.1', id, title, scene: input.scene, createdAt: claim.createdAt, updatedAt: claim.createdAt }, context: { background: input.background, goal: '', decisionScenario: '' }, clarifications: [], facts: [], hypotheses: [] };
      const yaml = Buffer.from(canonicalYaml(instance), 'utf8'); parseInstance(yaml);
      for (const [name, bytes] of [['instance.yaml', yaml], ['feedback-creation-origin.json', Buffer.from(JSON.stringify(origin) + '\n')]] as const) {
        const file = path.join(staging, name);
        if (existsSync(file)) {
          const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !readFileSync(file).equals(bytes)) fail('REQ_FEEDBACK_ORIGIN_CONFLICT');
        } else atomicWrite(file, bytes, 0o600);
      }
      // The feature's single Host writer plus this exclusive planned-ID claim
      // covers publication. Never rename onto an existing target. A failed
      // publish leaves the complete stage outside ordinary instance enumeration.
      if (existsSync(target)) fail('REQ_FEEDBACK_ORIGIN_CONFLICT');
      renameSync(staging, target);
      const parent = openSync(root, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
      unlinkSync(lockFile);
      const stagedParent = openSync(stagingRoot, 'r'); try { fsyncSync(stagedParent); } finally { closeSync(stagedParent); }
      return readInstance(id);
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
    readFrameworkState,
    readFrameworkProposal,
    selectFrameworkInput(id: string, rapVersion?: string, materialTargets?: readonly FrameworkMaterialTarget[]): FrameworkReviewState {
      readInstance(id);
      if (rapVersion !== undefined) this.readRelease(id, rapVersion);
      const previous = readFrameworkState(id);
      const targets = materialTargets ?? previous?.input.materialTargets ?? [];
      if (previous && previous.input.rapVersion === rapVersion && canonicalYaml(previous.input.materialTargets ?? []) === canonicalYaml(targets)) return previous;
      const state: FrameworkReviewState = {
        ...previous,
        input: { revision: randomUUID(), ...(rapVersion ? { rapVersion } : {}), ...(targets.length ? { materialTargets: targets } : {}) },
        confirmations: previous?.confirmations ?? [],
      };
      writeFrameworkState(id, state);
      return state;
    },
    saveFrameworkProposal(id: string, proposal: FrameworkProposalRecord): void {
      const state = readFrameworkState(id);
      if (!state || state.input.revision !== proposal.inputRevision) return fail('REQ_PROPOSAL_SOURCE_CHANGED');
      const file = proposalFile(id, proposal.version);
      ensureDirectory(path.dirname(file));
      if (existsSync(file)) return fail('REQ_STORE_CORRUPT');
      atomicWrite(file, Buffer.from(JSON.stringify(proposal)), 0o600);
      writeFrameworkState(id, { ...state, current: proposal.version });
    },
    confirmFrameworkProposal(id: string, version: string, confirmedBy: string): FrameworkConfirmation {
      const state = readFrameworkState(id);
      if (!state || state.current !== version) return fail('REQ_PROPOSAL_SOURCE_CHANGED');
      const previous = state.confirmations.find(item => item.version === version);
      if (previous) return previous;
      const confirmation = { version, confirmedAt: new Date().toISOString(), confirmedBy };
      writeFrameworkState(id, { ...state, confirmations: [...state.confirmations, confirmation] });
      return confirmation;
    },
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
    publish(id: string, version: string, releasedBy: string, frameworkVersion?: string): RequirementReleaseEntry {
      const instance = readInstance(id);
      let publication: RapPublication;
      try { publication = buildRapPublication(frameworkVersion ? { ...instance, framework: readFrameworkProposal(id, frameworkVersion).framework } : instance, version, releasedBy); }
      catch (error) { if (error instanceof RequirementFault) throw new RequirementStoreFault(error.code); throw error; }
      const entries = loadReleaseIndex();
      const existing = entries.find(entry => entry.id === id && entry.version === version);
      if (existing) {
        if (existing.packageFingerprint === publication.packageFingerprint && existing.contentFingerprint === publication.contentFingerprint && existing.frameworkVersion === frameworkVersion) return existing;
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
        ...(frameworkVersion ? { frameworkVersion } : {}),
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

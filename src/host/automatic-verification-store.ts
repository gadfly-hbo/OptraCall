import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  automaticStates, automaticPhases, automaticReasons,
  type AutomaticOwner, type AutomaticChainOwner, type AutomaticSettingsInput, type AutomaticSettings,
  type AutomaticConfiguration, type AutomaticNativeIdentity, type AutomaticObservedFile,
  type AutomaticObservationInput, type AutomaticObservation, type AutomaticMaterial, type AutomaticResultRef,
  type AutomaticStep, type AutomaticStepFacts, type AutomaticVersion, type AutomaticChain, type CreateAutomaticChainInput, type AutomaticChainUpdate,
} from './automatic-verification-types.ts';

export class AutomaticVerificationStoreError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
// ConfigurationStore accepts named presets as well as custom UUIDs.
const configurationId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const terminal = (v: string) => ['paused', 'completed', 'cancelled', 'failed', 'unknown'].includes(v);
const fail = (code: string, status = 409): never => { throw new AutomaticVerificationStoreError(code, status); };
const safeRelative = (v: unknown): v is string => typeof v === 'string' && Boolean(v) && !v.includes('\\') && !/[\0\r\n]/.test(v) && !path.isAbsolute(v) && v.split('/').every(p => p && p !== '.' && p !== '..');
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const knownKeys = (v: object, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k));
const unsafeOwnership = (entry: { uid: number; mode: number }) => typeof process.getuid === 'function' && entry.uid !== process.getuid() || (entry.mode & 0o022) !== 0;
const settingsKeys = ['enabled', 'question', 'dataFiles', 'reportPath', 'processFiles', 'businessContext', 'requirementContext', 'useCurrentSap', 'caseId', 'caseRevision', 'caseBackgroundIsPrior', 'configurationId', 'maxAuthorTurns'];
function ownerValid(v: AutomaticOwner) { if (!v || !uuid(v.projectId) || !uuid(v.taskId)) fail('invalid_automatic_identity', 400); }
function configurationValid(v: AutomaticConfiguration) {
  if (!v || !knownKeys(v, ['id', 'revision', 'provider', 'model', 'name', 'thinkingLevel']) || !configurationId(v.id) || !Number.isSafeInteger(v.revision) || v.revision < 1 || typeof v.provider !== 'string' || !v.provider || typeof v.model !== 'string' || !v.model || v.name !== undefined && typeof v.name !== 'string' || v.thinkingLevel !== undefined && typeof v.thinkingLevel !== 'string') fail('invalid_automatic_configuration', 400);
}
function nativeValid(v: AutomaticNativeIdentity) {
  if (!v || !knownKeys(v, ['sessionFile', 'sessionId', 'bytes', 'sha256']) || typeof v.sessionFile !== 'string' || !path.isAbsolute(v.sessionFile) || !v.sessionFile.endsWith('.jsonl') || typeof v.sessionId !== 'string' || !v.sessionId || !Number.isSafeInteger(v.bytes) || v.bytes < 0 || !sha(v.sha256)) fail('invalid_automatic_native', 400);
}
function observedValid(v: AutomaticObservedFile) {
  if (!v || typeof v.exists !== 'boolean' || !knownKeys(v, v.exists ? ['exists', 'sha256', 'bytes'] : ['exists']) || v.exists && (!sha(v.sha256) || !Number.isSafeInteger(v.bytes) || v.bytes < 0)) fail('invalid_automatic_observation', 400);
}
function validateSettings(input: AutomaticSettingsInput, previous?: AutomaticSettings): Omit<AutomaticSettings, keyof AutomaticOwner | 'formatVersion' | 'revision' | 'updatedAt'> {
  if (!input || typeof input !== 'object' || !knownKeys(input, settingsKeys) || typeof input.enabled !== 'boolean' || Object.values(input).some(v => v === null)) fail('invalid_automatic_settings', 400);
  const preservingDisabled = input.enabled === false && Object.keys(input).length === 1;
  const picked = previous && preservingDisabled ? Object.fromEntries(Object.entries(previous).filter(([k]) => settingsKeys.includes(k))) : {};
  const v = { ...picked, ...clone(input), dataFiles: input.dataFiles ?? (preservingDisabled ? previous?.dataFiles : undefined) ?? [], processFiles: input.processFiles ?? (preservingDisabled ? previous?.processFiles : undefined) ?? [], maxAuthorTurns: input.maxAuthorTurns ?? previous?.maxAuthorTurns ?? 2 } as AutomaticSettings;
  const list = (value: unknown, limit: number, prefixes: string[]) => Array.isArray(value) && value.length <= limit && new Set(value).size === value.length && value.every(p => safeRelative(p) && prefixes.some(prefix => p.startsWith(prefix)));
  if (!list(v.dataFiles, 32, ['020_clean/']) || !list(v.processFiles, 31, ['020_clean/', '060_reports/']) || ![1, 2, 3].includes(v.maxAuthorTurns)
    || v.question !== undefined && (typeof v.question !== 'string' || !v.question.trim() || v.question.length > 4000)
    || v.reportPath !== undefined && (!safeRelative(v.reportPath) || !v.reportPath.startsWith('060_reports/'))
    || v.businessContext !== undefined && (typeof v.businessContext !== 'string' || v.businessContext.length > 12000)
    || v.configurationId !== undefined && !configurationId(v.configurationId)
    || v.useCurrentSap !== undefined && typeof v.useCurrentSap !== 'boolean'
    || v.caseBackgroundIsPrior !== undefined && typeof v.caseBackgroundIsPrior !== 'boolean'
    || v.requirementContext !== undefined && (!v.requirementContext || !knownKeys(v.requirementContext, ['instanceId', 'version']) || !uuid(v.requirementContext.instanceId) || v.requirementContext.version !== undefined && (typeof v.requirementContext.version !== 'string' || !v.requirementContext.version))
    || v.caseId !== undefined && (!uuid(v.caseId) || !Number.isSafeInteger(v.caseRevision) || v.caseRevision! < 1 || v.caseBackgroundIsPrior !== true)
    || v.caseId === undefined && (v.caseRevision !== undefined || v.caseBackgroundIsPrior !== undefined)
    || v.enabled && (!v.question?.trim() || !v.reportPath || !v.dataFiles.length)
    || v.dataFiles.some(p => p === v.reportPath || v.processFiles.includes(p)) || v.processFiles.includes(v.reportPath!)) fail('invalid_automatic_settings', 400);
  return v;
}
function snapshotValid(v: AutomaticSettings, owner: AutomaticOwner) {
  if (!v || !knownKeys(v, [...settingsKeys, 'formatVersion', 'projectId', 'taskId', 'revision', 'updatedAt']) || v.formatVersion !== 1 || v.projectId !== owner.projectId || v.taskId !== owner.taskId || !Number.isSafeInteger(v.revision) || v.revision < 0 || v.revision > 0 && !iso(v.updatedAt)) fail('automatic_record_corrupt');
  const payload = Object.fromEntries(Object.entries(v).filter(([k]) => settingsKeys.includes(k))) as AutomaticSettingsInput;
  validateSettings(payload);
}
/** Pure policy validation for Host admission before observing selected files. */
export function normalizeAutomaticSettings(input: AutomaticSettingsInput, previous?: AutomaticSettings) {
  return validateSettings(input, previous);
}
export function automaticTriggerFingerprint(input: Pick<CreateAutomaticChainInput, 'projectId' | 'taskId' | 'requestId' | 'requestFingerprint' | 'reportSha256' | 'settingsSnapshot'>): string {
  ownerValid(input);
  if (!uuid(input.requestId) || !sha(input.requestFingerprint) || !sha(input.reportSha256) || !Number.isSafeInteger(input.settingsSnapshot?.revision)) fail('invalid_automatic_trigger', 400);
  return hash(canonical({ projectId: input.projectId, taskId: input.taskId, requestId: input.requestId, requestFingerprint: input.requestFingerprint, settingsRevision: input.settingsSnapshot.revision, reportSha256: input.reportSha256 }));
}

/** Storage reads and commits share one short filesystem gate. It never contains
 * models or Agent lifecycle work; Host still owns runtime admission/cancellation.
 * Public reads are queued, while private reads inside a commit stay direct. */
export function createAutomaticVerificationStore(options: { dataRoot: string }) {
  const dataRoot = path.resolve(options.dataRoot);
  let mutation: Promise<unknown> = Promise.resolve();
  function serial<T>(op: () => Promise<T>): Promise<T> { const next = mutation.then(op, op); mutation = next.catch(() => {}); return next; }
  const taskDirectory = (owner: AutomaticOwner) => { ownerValid(owner); return path.join(dataRoot, 'automatic-verifications', owner.projectId, owner.taskId); };
  const chainDirectory = (owner: AutomaticChainOwner) => { if (!sha(owner.chainId)) fail('invalid_automatic_identity', 400); return path.join(taskDirectory(owner), 'chains', owner.chainId); };
  const inside = (target: string) => { const r = path.relative(dataRoot, target); if (r.startsWith('..') || path.isAbsolute(r)) fail('automatic_unsafe_path'); return r; };
  async function directory(target: string, create = false, missing = false): Promise<boolean> {
    const r = inside(target);
    if (create) await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    for (const p of [dataRoot, ...r.split(path.sep).filter(Boolean).map((_, i, a) => path.join(dataRoot, ...a.slice(0, i + 1)))]) {
      let e;
      try { e = await lstat(p); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) { if (missing) return false; return fail('automatic_not_found', 404); }
        await mkdir(p, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }); e = await lstat(p);
      }
      if (e.isSymbolicLink() || !e.isDirectory() || unsafeOwnership(e)) fail('automatic_unsafe_path');
    }
    return true;
  }
  async function readBytes(target: string, immutable = false): Promise<Buffer> {
    await directory(path.dirname(target));
    const expected = await lstat(target);
    if (expected.isSymbolicLink() || !expected.isFile() || expected.nlink !== 1 || unsafeOwnership(expected)) fail('automatic_unsafe_file');
    const fd = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const a = await fd.stat();
      if (!a.isFile() || a.nlink > 1 || unsafeOwnership(a) || immutable && (a.nlink !== 1 || a.dev !== expected.dev || a.ino !== expected.ino)) fail('automatic_unsafe_file');
      const content = await fd.readFile(), b = await fd.stat(), current = await lstat(target);
      if (a.dev !== b.dev || a.ino !== b.ino || a.size !== b.size || b.size !== content.length || a.mtimeMs !== b.mtimeMs || unsafeOwnership(b) || current.isSymbolicLink() || !current.isFile() || current.nlink !== 1 || unsafeOwnership(current) || immutable && (a.ctimeMs !== b.ctimeMs || current.dev !== b.dev || current.ino !== b.ino)) fail('automatic_file_changed');
      return content;
    } finally { await fd.close(); }
  }
  async function readJson(target: string): Promise<unknown> { try { return JSON.parse((await readBytes(target)).toString('utf8')); } catch (e) { if (e instanceof AutomaticVerificationStoreError || (e as NodeJS.ErrnoException).code === 'ENOENT') throw e; return fail('automatic_record_corrupt'); } }
  async function writeNew(target: string, content: Uint8Array | string) {
    await directory(path.dirname(target), true);
    const fd = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await fd.writeFile(content); await fd.sync(); } finally { await fd.close(); }
  }
  async function atomic(target: string, value: unknown, initial = false): Promise<boolean> {
    await directory(path.dirname(target), true);
    if (!initial) await readBytes(target);
    const temp = path.join(path.dirname(target), `.automatic-${randomUUID()}.tmp`);
    await writeNew(temp, JSON.stringify(value, null, 2) + '\n');
    try {
      if (initial) { try { await link(temp, target); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; } }
      else await rename(temp, target);
      const fd = await open(path.dirname(target), constants.O_RDONLY); try { await fd.sync(); } finally { await fd.close(); }
      return true;
    } finally { await unlink(temp).catch(() => {}); }
  }
  const defaultSettings = (owner: AutomaticOwner): AutomaticSettings => ({ ...owner, formatVersion: 1, revision: 0, enabled: false, dataFiles: [], processFiles: [], maxAuthorTurns: 2 });
  async function readSettings(owner: AutomaticOwner): Promise<AutomaticSettings> {
    const home = taskDirectory(owner);
    if (!await directory(home, false, true)) return defaultSettings(owner);
    try { const v = await readJson(path.join(home, 'settings.json')) as AutomaticSettings; snapshotValid(v, owner); return v; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings(owner); throw e; }
  }
  function saveSettings(owner: AutomaticOwner, input: AutomaticSettingsInput, expectedRevision: number): Promise<AutomaticSettings> {
    return serial(async () => {
      const previous = await readSettings(owner);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== previous.revision) fail('automatic_settings_conflict');
      const value: AutomaticSettings = { ...validateSettings(input, previous), ...owner, formatVersion: 1, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
      if (!await atomic(path.join(taskDirectory(owner), 'settings.json'), value, previous.revision === 0)) fail('automatic_settings_conflict');
      return value;
    });
  }
  const observationPath = (owner: AutomaticOwner, requestId: string) => { if (!uuid(requestId)) fail('invalid_automatic_identity', 400); return path.join(taskDirectory(owner), 'observations', `${requestId}.json`); };
  function observationValid(v: AutomaticObservation, owner: AutomaticOwner, requestId: string) {
    if (!v || !knownKeys(v, ['formatVersion', 'projectId', 'taskId', 'requestId', 'requestFingerprint', 'settingsSnapshot', 'native', 'completedNative', 'configuration', 'verificationConfiguration', 'before', 'after', 'admittedAt', 'updatedAt', 'observedAt', 'reason', 'chainId']) || v.formatVersion !== 1 || v.projectId !== owner.projectId || v.taskId !== owner.taskId || v.requestId !== requestId || !sha(v.requestFingerprint) || !iso(v.admittedAt) || !iso(v.updatedAt) || !automaticReasons.includes(v.reason)) fail('automatic_record_corrupt');
    snapshotValid(v.settingsSnapshot, owner); if (!v.settingsSnapshot.enabled) fail('invalid_automatic_observation', 400);
    if (v.native !== undefined) nativeValid(v.native);
    if (v.completedNative !== undefined) nativeValid(v.completedNative);
    if (v.verificationConfiguration !== undefined) configurationValid(v.verificationConfiguration);
    configurationValid(v.configuration); observedValid(v.before);
    if (v.after !== undefined) { observedValid(v.after); if (!iso(v.observedAt)) fail('invalid_automatic_observation', 400); }
    else if (v.observedAt !== undefined || v.chainId !== undefined || v.completedNative !== undefined) fail('invalid_automatic_observation', 400);
    if (v.chainId !== undefined && !sha(v.chainId)) fail('invalid_automatic_observation', 400);
  }
  async function readObservation(owner: AutomaticOwner, requestId: string): Promise<AutomaticObservation> {
    try { const v = await readJson(observationPath(owner, requestId)) as AutomaticObservation; observationValid(v, owner, requestId); return v; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fail('automatic_observation_not_found', 404); throw e; }
  }
  async function readLatestObservation(owner: AutomaticOwner): Promise<AutomaticObservation | undefined> {
    const home = path.join(taskDirectory(owner), 'observations');
    if (!await directory(home, false, true)) return undefined;
    const ids = (await readdir(home)).filter(name => name.endsWith('.json') && uuid(name.slice(0, -5))).map(name => name.slice(0, -5));
    const records = await Promise.all(ids.map(id => readObservation(owner, id)));
    return records.sort((a, b) => b.admittedAt.localeCompare(a.admittedAt) || b.updatedAt.localeCompare(a.updatedAt) || b.requestId.localeCompare(a.requestId))[0];
  }
  function saveObservation(input: AutomaticObservationInput): Promise<AutomaticObservation> {
    return serial(async () => {
      const target = observationPath(input, input.requestId), now = new Date().toISOString();
      let previous: AutomaticObservation | undefined;
      try { previous = await readObservation(input, input.requestId); } catch (e) { if (!(e instanceof AutomaticVerificationStoreError) || !['automatic_not_found', 'automatic_observation_not_found'].includes(e.code)) throw e; }
      const v: AutomaticObservation = { ...clone(input), formatVersion: 1, admittedAt: previous?.admittedAt ?? input.admittedAt ?? now, updatedAt: now, reason: input.reason ?? 'none' };
      observationValid(v, input, input.requestId);
      if (previous) {
        const admission = (o: AutomaticObservation) => ({ projectId: o.projectId, taskId: o.taskId, requestId: o.requestId, requestFingerprint: o.requestFingerprint, settingsSnapshot: o.settingsSnapshot, native: o.native, configuration: o.configuration, verificationConfiguration: o.verificationConfiguration, before: o.before });
        if (!same(admission(v), admission(previous))) fail('automatic_observation_conflict');
        if (previous.after !== undefined && input.after === undefined) return previous;
        if (previous.after !== undefined && !same({ after: v.after, observedAt: v.observedAt, chainId: v.chainId, reason: v.reason, completedNative: v.completedNative }, { after: previous.after, observedAt: previous.observedAt, chainId: previous.chainId, reason: previous.reason, completedNative: previous.completedNative })) fail('automatic_observation_conflict');
        if (previous.after !== undefined || same({ ...v, updatedAt: '' }, { ...previous, updatedAt: '' })) return previous;
      }
      if (!await atomic(target, v, !previous)) fail('automatic_observation_conflict'); return v;
    });
  }
  function materialValid(m: AutomaticMaterial | AutomaticVersion) {
    if (!m || !knownKeys(m, ['kind', 'relativePath', 'snapshotPath', 'bytes', 'sha256', 'observedAt', 'version', 'requestId', 'recheckRequestId']) || !safeRelative(m.relativePath) || !safeRelative(m.snapshotPath) || !m.snapshotPath.startsWith('fixed/') || !sha(m.sha256) || !Number.isSafeInteger(m.bytes) || m.bytes < 0 || !iso(m.observedAt)) fail('invalid_automatic_material', 400);
  }
  function resultValid(r: AutomaticResultRef) {
    if (!r || !knownKeys(r, ['file', 'sha256', 'bytes', 'requestId', 'savedAt', 'text']) || !uuid(r.requestId) || r.file !== `results/${r.requestId}.md` || !sha(r.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes < 0 || !iso(r.savedAt) || r.text !== undefined && (typeof r.text !== 'string' || hash(r.text) !== r.sha256 || Buffer.byteLength(r.text) !== r.bytes)) fail('invalid_automatic_result', 400);
  }
  function validateSteps(steps: AutomaticStep[], owner: AutomaticOwner, max: number): number {
    if (!Array.isArray(steps)) fail('invalid_automatic_steps', 400);
    const ids = new Set<string>(), requests = new Set<string>(); let last: AutomaticStep['phase'] | undefined, count = 0, authorPlans = 0;
    steps.forEach((s, i) => {
      if (!s || !knownKeys(s, ['stepId', 'requestId', 'phase', 'ordinal', 'domain', 'owner', 'inputSha256', 'status', 'plannedAt', 'acceptedAt', 'settledAt', 'sessionFile', 'result', 'verificationRef']) || !uuid(s.stepId) || !uuid(s.requestId) || ids.has(s.stepId) || requests.has(s.requestId) || s.ordinal !== i + 1 || !['cold', 'compare', 'author', 'recheck'].includes(s.phase) || !['planned', 'accepted', 'completed', 'cancelled', 'failed', 'unknown'].includes(s.status) || !iso(s.plannedAt) || s.acceptedAt !== undefined && !iso(s.acceptedAt) || s.settledAt !== undefined && !iso(s.settledAt) || ['accepted', 'completed'].includes(s.status) && !s.acceptedAt || s.status === 'completed' && !s.settledAt || s.inputSha256 !== undefined && !sha(s.inputSha256)) fail('invalid_automatic_steps', 400);
      if (s.owner?.projectId !== owner.projectId || s.owner?.taskId !== owner.taskId || s.domain !== (s.phase === 'author' ? 'project-tasks' : 'independent-verification') || s.phase !== 'author' && !uuid(s.owner.verificationId) || s.phase === 'author' && s.owner.verificationId !== undefined) fail('invalid_automatic_steps', 400);
      if (!(i === 0 && s.phase === 'cold' || last === 'cold' && s.phase === 'compare' || last === 'compare' && s.phase === 'author' || last === 'author' && s.phase === 'recheck' || last === 'recheck' && s.phase === 'author') || i > 0 && steps[i - 1]!.status !== 'completed') fail('automatic_phase_conflict');
      if (s.phase === 'author' && s.acceptedAt) count++;
      if (s.phase === 'author') authorPlans++;
      if (count > max || authorPlans > max) fail('automatic_followup_limit');
      if (s.result) resultValid(s.result);
      if (s.verificationRef && (!uuid(s.verificationRef.verificationId) || !['cold', 'compare'].includes(s.verificationRef.phase) || s.verificationRef.phase !== s.phase || s.verificationRef.requestId !== s.requestId || s.verificationRef.sha256 !== undefined && !sha(s.verificationRef.sha256))) fail('invalid_automatic_steps', 400);
      ids.add(s.stepId); requests.add(s.requestId); last = s.phase;
    });
    return count;
  }
  function chainValid(v: AutomaticChain, owner: AutomaticChainOwner): AutomaticChain {
    if (!v || !knownKeys(v, ['formatVersion', 'projectId', 'taskId', 'chainId', 'revision', 'triggerFingerprint', 'requestId', 'requestFingerprint', 'reportSha256', 'settingsSnapshot', 'native', 'configuration', 'verificationConfiguration', 'createdAt', 'updatedAt', 'state', 'phase', 'reason', 'authorAccepted', 'materials', 'versions', 'steps', 'semantics', 'firstVerification']) || v.formatVersion !== 1 || v.projectId !== owner.projectId || v.taskId !== owner.taskId || v.chainId !== owner.chainId || v.triggerFingerprint !== owner.chainId || !Number.isSafeInteger(v.revision) || v.revision < 1 || !uuid(v.requestId) || !sha(v.requestFingerprint) || !sha(v.reportSha256) || !iso(v.createdAt) || !iso(v.updatedAt) || !automaticStates.includes(v.state) || !automaticPhases.includes(v.phase) || !automaticReasons.includes(v.reason)) fail('automatic_record_corrupt');
    snapshotValid(v.settingsSnapshot, owner); if (!v.settingsSnapshot.enabled || automaticTriggerFingerprint(v) !== v.chainId) fail('automatic_record_corrupt');
    nativeValid(v.native); configurationValid(v.configuration); configurationValid(v.verificationConfiguration);
    if (terminal(v.state) !== (v.phase === 'ended') || terminal(v.state) && v.reason === 'none' || v.state === 'completed' && !['no_new_report', 'same_content', 'limit_reached'].includes(v.reason) || v.state === 'preparing' && v.phase !== 'prepare' || v.state === 'running' && ['prepare', 'ended'].includes(v.phase) || !Array.isArray(v.materials) || !Array.isArray(v.versions)) fail('automatic_phase_conflict');
    const snapshots = new Set<string>();
    for (const m of v.materials) { materialValid(m); if (!['data', 'author', 'report', 'semantics'].includes(m.kind) || snapshots.has(m.snapshotPath)) fail('invalid_automatic_material', 400); snapshots.add(m.snapshotPath); }
    v.versions.forEach((r, i) => { materialValid(r); if (r.version !== i + 1 || !r.relativePath.startsWith('060_reports/') || i === 0 && r.sha256 !== v.reportSha256 || i > 0 && r.sha256 === v.versions[i - 1]!.sha256 || r.requestId !== undefined && !uuid(r.requestId) || r.recheckRequestId !== undefined && !uuid(r.recheckRequestId)) fail('invalid_automatic_version', 400); });
    const count = validateSteps(v.steps, owner, v.settingsSnapshot.maxAuthorTurns);
    if (!Number.isSafeInteger(v.authorAccepted) || count !== v.authorAccepted) fail('automatic_acceptance_count');
    if (v.firstVerification && (!uuid(v.firstVerification.verificationId) || v.firstVerification.coldRequestId !== undefined && !uuid(v.firstVerification.coldRequestId) || v.firstVerification.compareRequestId !== undefined && !uuid(v.firstVerification.compareRequestId))) fail('invalid_automatic_verification_reference', 400);
    if (v.semantics && (typeof v.semantics.text !== 'string' || hash(v.semantics.text) !== v.semantics.sha256 || !Array.isArray(v.semantics.sources))) fail('invalid_automatic_semantics', 400);
    return v;
  }
  async function readChain(owner: AutomaticChainOwner): Promise<AutomaticChain> {
    try { return chainValid(await readJson(path.join(chainDirectory(owner), 'record.json')) as AutomaticChain, owner); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fail('automatic_chain_not_found', 404); throw e; }
  }
  function createChain(input: CreateAutomaticChainInput): Promise<{ chain: AutomaticChain; created: boolean }> {
    return serial(async () => {
      const chainId = automaticTriggerFingerprint(input), now = new Date().toISOString();
      const v: AutomaticChain = { ...clone(input), chainId, triggerFingerprint: chainId, formatVersion: 1, revision: 1, createdAt: now, updatedAt: now, state: 'preparing', phase: 'prepare', reason: 'none', authorAccepted: 0, materials: input.materials ?? [], versions: input.versions ?? [], steps: [] };
      chainValid(v, v);
      const target = path.join(chainDirectory(v), 'record.json');
      if (!await atomic(target, v, true)) {
        const previous = await readChain(v);
        const immutable = (r: AutomaticChain) => ({ projectId: r.projectId, taskId: r.taskId, requestId: r.requestId, requestFingerprint: r.requestFingerprint, reportSha256: r.reportSha256, settingsSnapshot: r.settingsSnapshot, native: r.native, configuration: r.configuration, verificationConfiguration: r.verificationConfiguration, semantics: r.semantics });
        if (!same(immutable(v), immutable(previous))) fail('automatic_chain_conflict');
        return { chain: previous, created: false };
      }
      return { chain: v, created: true };
    });
  }
  function updateChain(owner: AutomaticChainOwner, patch: AutomaticChainUpdate, expectedRevision?: number): Promise<AutomaticChain> {
    return serial(async () => {
      const old = await readChain(owner);
      if (expectedRevision !== undefined && expectedRevision !== old.revision) fail('automatic_chain_conflict');
      if (!patch || !knownKeys(patch, ['state', 'phase', 'reason', 'authorAccepted', 'materials', 'versions', 'steps', 'firstVerification'])) fail('invalid_automatic_update', 400);
      if (terminal(old.state)) {
        if (!Object.entries(patch).every(([k, value]) => same(old[k as keyof AutomaticChain], value))) fail('automatic_terminal');
        return old;
      }
      const v = { ...old, ...clone(patch), revision: old.revision + 1, updatedAt: new Date().toISOString() };
      if (v.state === 'preparing' && old.state !== 'preparing') fail('automatic_phase_conflict');
      const transitions = { prepare: ['prepare', 'cold', 'ended'], cold: ['cold', 'compare', 'ended'], compare: ['compare', 'author', 'ended'], author: ['author', 'recheck', 'ended'], recheck: ['recheck', 'author', 'ended'], ended: ['ended'] };
      if (!transitions[old.phase].includes(v.phase)) fail('automatic_phase_conflict');
      if (v.steps.length < old.steps.length || v.materials.length < old.materials.length || v.versions.length < old.versions.length) fail('automatic_history_conflict');
      old.steps.forEach((s, i) => {
        const n = v.steps[i]!;
        const stable = (s: AutomaticStep) => ({ stepId: s.stepId, requestId: s.requestId, phase: s.phase, ordinal: s.ordinal, domain: s.domain, owner: s.owner, inputSha256: s.inputSha256, plannedAt: s.plannedAt });
        if (!same(stable(s), stable(n)) || s.acceptedAt !== undefined && s.acceptedAt !== n.acceptedAt || s.result !== undefined && !same(s.result, n.result) || s.verificationRef !== undefined && !same(s.verificationRef, n.verificationRef) || ['completed', 'cancelled', 'failed', 'unknown'].includes(s.status) && !same(s, n) || s.status === 'accepted' && n.status === 'planned') fail('automatic_history_conflict');
      });
      old.materials.forEach((m, i) => { if (!same(m, v.materials[i])) fail('automatic_history_conflict'); });
      old.versions.forEach((r, i) => { const n = v.versions[i]!; if (!same({ ...r, recheckRequestId: undefined }, { ...n, recheckRequestId: undefined }) || r.recheckRequestId !== undefined && n.recheckRequestId !== r.recheckRequestId) fail('automatic_history_conflict'); });
      if (old.firstVerification && (!v.firstVerification || old.firstVerification.verificationId !== v.firstVerification.verificationId || old.firstVerification.coldRequestId !== undefined && old.firstVerification.coldRequestId !== v.firstVerification.coldRequestId || old.firstVerification.compareRequestId !== undefined && old.firstVerification.compareRequestId !== v.firstVerification.compareRequestId)) fail('automatic_history_conflict');
      if (patch.authorAccepted === undefined) v.authorAccepted = v.steps.filter(s => s.phase === 'author' && s.acceptedAt).length;
      chainValid(v, owner);
      await atomic(path.join(chainDirectory(owner), 'record.json'), v); return v;
    });
  }
  /** SDK callbacks may arrive after cancellation. Preserve evidence without
   * admitting another request or changing the terminal business state. */
  function recordStepFacts(owner: AutomaticChainOwner, requestId: string, patch: AutomaticStepFacts): Promise<AutomaticChain> {
    return serial(async () => {
      const old = await readChain(owner), index = old.steps.findIndex(s => s.requestId === requestId);
      if (index < 0 || !patch || !knownKeys(patch, ['status', 'acceptedAt', 'settledAt', 'sessionFile', 'result', 'verificationRef'])) fail('invalid_automatic_step_facts', 400);
      const previous = old.steps[index]!, changed = { ...previous, ...clone(patch) };
      for (const key of ['acceptedAt', 'settledAt', 'sessionFile', 'result', 'verificationRef'] as const) if (previous[key] !== undefined && !same(previous[key], changed[key])) fail('automatic_history_conflict');
      if (['completed', 'cancelled', 'failed'].includes(previous.status) && changed.status !== previous.status || previous.status !== 'planned' && changed.status === 'planned') fail('automatic_history_conflict');
      if (same(previous, changed)) return old;
      const steps = [...old.steps]; steps[index] = changed;
      const value: AutomaticChain = { ...old, steps, authorAccepted: steps.filter(s => s.phase === 'author' && s.acceptedAt).length, revision: old.revision + 1, updatedAt: new Date().toISOString() };
      chainValid(value, owner);
      await atomic(path.join(chainDirectory(owner), 'record.json'), value);
      return value;
    });
  }
  async function listChains(owner: AutomaticOwner): Promise<AutomaticChain[]> {
    const home = path.join(taskDirectory(owner), 'chains'); if (!await directory(home, false, true)) return [];
    const observed = await Promise.all((await readdir(home)).filter(sha).map(async chainId => {
      try { return await readChain({ ...owner, chainId }); }
      catch (error) {
        // Creation prepares the private directory before atomically publishing
        // record.json. An uncommitted directory is not a delivered chain.
        if (error instanceof AutomaticVerificationStoreError && error.code === 'automatic_chain_not_found' && error.status === 404) return undefined;
        throw error;
      }
    }));
    return observed.filter((record): record is AutomaticChain => record !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  function materialPath(owner: AutomaticChainOwner, material: Pick<AutomaticMaterial, 'snapshotPath'>) {
    if (!safeRelative(material.snapshotPath) || !material.snapshotPath.startsWith('fixed/')) fail('invalid_automatic_material', 400);
    return path.join(chainDirectory(owner), material.snapshotPath);
  }
  async function fixMaterial(owner: AutomaticChainOwner, input: { key: string; kind: AutomaticMaterial['kind']; relativePath: string; bytes: Uint8Array; sha256?: string }): Promise<AutomaticMaterial> {
    if (!input || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.key) || !safeRelative(input.relativePath) || !['data', 'author', 'report', 'semantics'].includes(input.kind) || !(input.bytes instanceof Uint8Array)) fail('invalid_automatic_material', 400);
    const bytes = Buffer.from(input.bytes), sha256 = hash(bytes);
    if (input.sha256 !== undefined && input.sha256 !== sha256) fail('automatic_input_hash_mismatch');
    const snapshotPath = `fixed/${input.key}/${input.relativePath}`, target = materialPath(owner, { snapshotPath });
    try { await writeNew(target, bytes); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (!(await readBytes(target, true)).equals(bytes)) fail('automatic_snapshot_conflict'); }
    const entry = await lstat(target), observedAt = new Date(entry.birthtimeMs > 0 ? entry.birthtimeMs : entry.mtimeMs).toISOString();
    return { kind: input.kind, relativePath: input.relativePath, snapshotPath, bytes: bytes.length, sha256, observedAt };
  }
  async function readMaterial(owner: AutomaticChainOwner, m: AutomaticMaterial | AutomaticVersion): Promise<Buffer> {
    materialValid(m); const content = await readBytes(materialPath(owner, m), true);
    if (content.length !== m.bytes || hash(content) !== m.sha256) fail('automatic_snapshot_changed'); return content;
  }
  async function saveResult(owner: AutomaticChainOwner, input: { requestId: string; text: string }): Promise<AutomaticResultRef> {
    await readChain(owner); if (!uuid(input.requestId) || typeof input.text !== 'string') fail('invalid_automatic_result', 400);
    const content = Buffer.from(input.text), file = `results/${input.requestId}.md`, target = path.join(chainDirectory(owner), file);
    try { await writeNew(target, content); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (!(await readBytes(target, true)).equals(content)) fail('automatic_result_conflict'); }
    const entry = await lstat(target), savedAt = new Date(entry.birthtimeMs > 0 ? entry.birthtimeMs : entry.mtimeMs).toISOString();
    return { file, sha256: hash(content), bytes: content.length, requestId: input.requestId, savedAt };
  }
  async function readResult(owner: AutomaticChainOwner, ref: AutomaticResultRef): Promise<string> {
    resultValid(ref); const content = await readBytes(path.join(chainDirectory(owner), ref.file), true);
    if (content.length !== ref.bytes || hash(content) !== ref.sha256) fail('automatic_snapshot_changed');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { return fail('automatic_result_corrupt'); }
  }
  async function prepareWorkDirectory(owner: AutomaticChainOwner, label: string): Promise<string> {
    await readChain(owner); if (!/^[a-zA-Z0-9_-]{1,80}$/.test(label)) fail('invalid_automatic_workspace', 400);
    const parent = path.join(chainDirectory(owner), 'work'); await directory(parent, true);
    const target = path.join(parent, label);
    try { await mkdir(target, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; await directory(target); fail('automatic_workspace_exists'); }
    return target;
  }
  const queued = <Args extends unknown[], Result>(use: (...args: Args) => Promise<Result>) => (...args: Args) => serial(() => use(...args));
  return {
    readSettings: queued(readSettings), saveSettings,
    readObservation: queued(readObservation), readLatestObservation: queued(readLatestObservation), saveObservation,
    createChain, readChain: queued(readChain), listChains: queued(listChains), updateChain, recordStepFacts,
    chainDirectory, taskDirectory, materialPath,
    fixMaterial: queued(fixMaterial), readMaterial: queued(readMaterial),
    saveResult: queued(saveResult), readResult: queued(readResult), prepareWorkDirectory: queued(prepareWorkDirectory),
  };
}
export type AutomaticVerificationStore = ReturnType<typeof createAutomaticVerificationStore>;

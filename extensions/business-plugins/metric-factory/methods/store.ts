import { constants, closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { SapMethodSaveInput, SapMethodWriteResult, SapMethodListOptions, SapMethodSummary, SapMethodDetail, SapMethodVersion, SapMethodPublication, SapMethodGovernance, SapMethodPublishInput, SapMethodPublishedRead, SapMethodOperation, SapMethodOperationState, SapMethodIssueInput } from './types.ts';
import { fail, id, object, positive, saveInput, shaPattern, uuidPattern } from './validate.ts';
export { SapMethodStoreError } from './validate.ts';

type VersionEntry = { version: number; bytesSha256: string; requestId: string; savedAt: string };
type MethodEntry = { id: string; origin: 'ir' | 'other'; versions: VersionEntry[]; publications: SapMethodPublication[]; governance: SapMethodGovernance[] };
type Index = { schemaVersion: 1; methods: MethodEntry[] };
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const contentDigest = (value: SapMethodVersion | SapMethodSaveInput) => digest(JSON.stringify({ origin: value.origin, title: value.title, content: value.content, sources: value.sources, relation: value.relation ?? null }));
const validId = (value: unknown) => typeof value === 'string' && uuidPattern.test(value);
const validSha = (value: unknown) => typeof value === 'string' && shaPattern.test(value);
const validVersion = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const validTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validRef = (value: unknown) => object(value) && validId(value.methodId) && validVersion(value.version);
const validIndex = (value: unknown): value is Index => {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.methods)) return false;
  const seen = new Set<string>();
  return value.methods.every(entry => {
    if (!object(entry) || !validId(entry.id) || seen.has(String(entry.id)) || !['ir', 'other'].includes(String(entry.origin)) || !Array.isArray(entry.versions) || !entry.versions.length || !Array.isArray(entry.publications) || !Array.isArray(entry.governance)) return false;
    seen.add(String(entry.id));
    if (!entry.versions.every((item, index) => object(item) && item.version === index + 1 && validSha(item.bytesSha256) && validId(item.requestId) && validTime(item.savedAt))) return false;
    const total = entry.versions.length, published = new Set<number>();
    if (!entry.publications.every(item => {
      if (!object(item) || !validVersion(item.version) || Number(item.version) > total || published.has(Number(item.version)) || !validSha(item.contentSha256) || !validTime(item.publishedAt) || !validId(item.requestId)) return false;
      published.add(Number(item.version)); return true;
    })) return false;
    return entry.governance.every((item, index) => object(item) && item.revision === index + 1 && validVersion(item.version) && Number(item.version) <= total && ['suspected', 'confirmed'].includes(String(item.status)) && typeof item.note === 'string' && Boolean(item.note.trim()) && (item.replacement === null || validRef(item.replacement)) && validTime(item.recordedAt) && validId(item.requestId));
  });
};


export function createSapMethodStore(libraryRoot: string) {
  const base = path.resolve(libraryRoot);
  const root = path.join(base, 'methods');
  const indexPath = path.join(root, 'index.json');
  const directoryExists = (directory: string): boolean => {
    try { const stat = lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('METHOD_STORE_UNSAFE', 409); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  };
  const ensureDirectory = (directory: string) => {
    if (!directoryExists(directory)) { mkdirSync(directory, { recursive: true, mode: 0o700 }); directoryExists(directory); }
  };
  const ensureRoot = () => { ensureDirectory(base); ensureDirectory(root); };
  const safeRead = (file: string): Buffer => {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16 * 1024 * 1024) fail('METHOD_STORE_CORRUPT', 409);
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1 || opened.size !== before.size) fail('METHOD_STORE_CORRUPT', 409);
      const raw = readFileSync(fd), after = fstatSync(fd), current = lstatSync(file);
      if (raw.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || current.ino !== opened.ino || current.dev !== opened.dev || current.isSymbolicLink()) fail('METHOD_STORE_CORRUPT', 409);
      return raw;
    } finally { closeSync(fd); }
  };
  const loadIndex = (): Index => {
    if (!directoryExists(base) || !directoryExists(root)) return { schemaVersion: 1, methods: [] };
    if (!existsSync(indexPath)) return { schemaVersion: 1, methods: [] };
    let data: unknown;
    try { data = JSON.parse(safeRead(indexPath).toString('utf8')); } catch (error) { if (error instanceof SyntaxError) fail('METHOD_STORE_CORRUPT', 409); throw error; }
    if (!validIndex(data)) fail('METHOD_STORE_CORRUPT', 409);
    return data;
  };
  const syncDirectory = (directory: string) => { const fd = openSync(directory, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } };
  const writeNew = (target: string, value: unknown) => {
    const fd = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, bytes(value)); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(path.dirname(target));
  };
  const saveIndex = (index: Index) => {
    const temporary = path.join(root, `index.${randomUUID()}.tmp`);
    try { writeNew(temporary, index); renameSync(temporary, indexPath); syncDirectory(root); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  };
  const entryFor = (index: Index, methodId: string) => index.methods.find(entry => entry.id === id(methodId)) ?? fail('METHOD_NOT_FOUND', 404);
  const versionPath = (methodId: string, version: number) => path.join(root, id(methodId), 'versions', `${positive(version)}.json`);
  const readVersion = (entry: MethodEntry, version: number): SapMethodVersion => {
    const record = entry.versions.find(item => item.version === positive(version)) ?? fail('METHOD_VERSION_NOT_FOUND', 404);
    if (!directoryExists(path.join(root, entry.id)) || !directoryExists(path.join(root, entry.id, 'versions'))) fail('METHOD_STORE_CORRUPT', 409);
    const raw = safeRead(versionPath(entry.id, version));
    if (digest(raw) !== record.bytesSha256) fail('METHOD_STORE_CORRUPT', 409);
    let value: unknown;
    try { value = JSON.parse(raw.toString('utf8')); } catch { return fail('METHOD_STORE_CORRUPT', 409); }
    if (!object(value) || value.schemaVersion !== 1 || value.methodId !== entry.id || value.version !== version || value.origin !== entry.origin || value.requestId !== record.requestId) fail('METHOD_STORE_CORRUPT', 409);
    const result = value as SapMethodVersion;
    if (result.contentSha256 !== contentDigest(result)) fail('METHOD_STORE_CORRUPT', 409);
    return result;
  };
  const publishedVersion = (entry: MethodEntry): number | null => entry.publications.length ? Math.max(...entry.publications.map(item => item.version)) : null;
  const summary = (entry: MethodEntry): SapMethodSummary => {
    const latest = readVersion(entry, entry.versions.at(-1)!.version), published = publishedVersion(entry);
    return { id: entry.id, title: latest.title, origin: entry.origin, latestVersion: latest.version, publishedVersion: published,
      updatedAt: latest.savedAt, hasUnpublishedChanges: !entry.publications.some(item => item.version === latest.version),
      issue: entry.governance.filter(item => item.version === published).at(-1) ?? null };
  };
  const detail = (entry: MethodEntry, version?: number): SapMethodDetail => ({
    ...summary(entry), selectedVersion: version ?? entry.versions.at(-1)!.version,
    versions: entry.versions.map(item => readVersion(entry, item.version)),
    publications: structuredClone(entry.publications), governance: structuredClone(entry.governance), governanceRevision: entry.governance.length,
  });
  const operationPath = (requestId: string) => path.join(root, 'operations', `${id(requestId)}.json`);
  const readOperation = (requestId: string): SapMethodOperation | null => {
    if (!directoryExists(base) || !directoryExists(root) || !directoryExists(path.join(root, 'operations'))) return null;
    const target = operationPath(requestId);
    if (!existsSync(target)) return null;
    const directory = path.dirname(target);
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) fail('METHOD_STORE_UNSAFE', 409);
    let value: unknown;
    try { value = JSON.parse(safeRead(target).toString('utf8')); } catch (error) { if (error instanceof SyntaxError) fail('METHOD_STORE_CORRUPT', 409); throw error; }
    if (!object(value) || value.schemaVersion !== 1 || value.requestId !== id(requestId) || !['save', 'publish', 'issue'].includes(String(value.kind)) || !shaPattern.test(String(value.fingerprint)) || !shaPattern.test(String(value.contentSha256)) || !validTime(value.recordedAt)) fail('METHOD_STORE_CORRUPT', 409);
    id(value.methodId); positive(value.version);
    return value as SapMethodOperation;
  };
  const matchingOperation = (requestId: string, kind: SapMethodOperation['kind'], fingerprint: string) => {
    const prior = readOperation(requestId);
    if (prior && (prior.kind !== kind || prior.fingerprint !== fingerprint)) fail('METHOD_REQUEST_CONFLICT', 409);
    return prior;
  };
  const reserveOperation = (operation: SapMethodOperation): SapMethodOperation => {
    ensureDirectory(path.join(root, 'operations'));
    const prior = matchingOperation(operation.requestId, operation.kind, operation.fingerprint);
    if (prior) return prior;
    writeNew(operationPath(operation.requestId), operation);
    return operation;
  };
  const committed = (operation: SapMethodOperation, index: Index): boolean => {
    const entry = index.methods.find(item => item.id === operation.methodId);
    if (!entry?.versions.some(item => item.version === operation.version)) return false;
    if (readVersion(entry, operation.version).contentSha256 !== operation.contentSha256) return false;
    if (operation.kind === 'publish') return entry.publications.some(item => item.version === operation.version);
    if (operation.kind === 'issue') return entry.governance.some(item => item.requestId === operation.requestId);
    return true;
  };
  const writeResult = (entry: MethodEntry, version: number, replayed: boolean): SapMethodWriteResult => ({ method: detail(entry, version), version: readVersion(entry, version), replayed });
  return {
    root,
    save(input: SapMethodSaveInput): SapMethodWriteResult {
      const clean = saveInput(input), fingerprint = digest(JSON.stringify({ kind: 'save', input: clean }));
      ensureRoot();
      const index = loadIndex(), prior = matchingOperation(clean.requestId, 'save', fingerprint);
      if (prior && committed(prior, index)) return writeResult(entryFor(index, prior.methodId), prior.version, true);
      const existing = clean.methodId === undefined ? null : entryFor(index, clean.methodId);
      if (existing && (clean.baseVersion !== existing.versions.at(-1)!.version || existing.origin !== clean.origin)) fail('METHOD_VERSION_CONFLICT', 409);
      if (!existing && clean.baseVersion !== undefined) fail('METHOD_VERSION_CONFLICT', 409);
      if (existing && !prior) {
        const latest = readVersion(existing, existing.versions.at(-1)!.version);
        const sameDefinition = JSON.stringify({ origin: clean.origin, title: clean.title, content: clean.content, sources: clean.sources }) === JSON.stringify({ origin: latest.origin, title: latest.title, content: latest.content, sources: latest.sources });
        if ((!clean.relation && sameDefinition) || contentDigest(clean) === latest.contentSha256) {
          reserveOperation({ schemaVersion: 1, requestId: clean.requestId, kind: 'save', fingerprint, contentSha256: latest.contentSha256, methodId: existing.id, version: latest.version, recordedAt: new Date().toISOString() });
          return writeResult(existing, latest.version, true);
        }
      }
      const methodId = prior?.methodId ?? existing?.id ?? randomUUID(), version = prior?.version ?? (existing ? existing.versions.at(-1)!.version + 1 : 1);
      if (existing && !clean.relation) clean.relation = { kind: 'revision', target: { methodId, version: clean.baseVersion! }, reason: '后续修订' };
      if (clean.relation) {
        const relation = clean.relation;
        if (relation.kind === 'derived' ? existing !== null : !existing || relation.target.methodId !== methodId) fail('METHOD_RELATION_INVALID');
        readVersion(entryFor(index, relation.target.methodId), relation.target.version);
      }
      const contentSha256 = contentDigest(clean);
      const operation = reserveOperation({ schemaVersion: 1, requestId: clean.requestId, kind: 'save', fingerprint, contentSha256, methodId, version, recordedAt: new Date().toISOString() });
      if (operation.contentSha256 !== contentSha256 || operation.methodId !== methodId || operation.version !== version) fail('METHOD_REQUEST_CONFLICT', 409);
      ensureDirectory(path.join(root, methodId));
      ensureDirectory(path.join(root, methodId, 'versions'));
      const record: SapMethodVersion = { schemaVersion: 1, methodId, version, origin: clean.origin, title: clean.title, content: clean.content, sources: clean.sources,
        relation: clean.relation ?? null, savedAt: operation.recordedAt, contentSha256, requestId: clean.requestId };
      const target = versionPath(methodId, version);
      if (existsSync(target)) {
        if (!safeRead(target).equals(bytes(record))) fail('METHOD_WRITE_UNKNOWN', 409);
      } else writeNew(target, record);
      const entry: MethodEntry = existing ?? { id: methodId, origin: clean.origin, versions: [], publications: [], governance: [] };
      entry.versions.push({ version, bytesSha256: digest(bytes(record)), requestId: clean.requestId, savedAt: record.savedAt });
      if (!existing) index.methods.push(entry);
      saveIndex(index);
      return writeResult(entry, version, false);
    },
    list(options: SapMethodListOptions = {}): SapMethodSummary[] {
      const query = options.query?.trim().toLowerCase();
      return loadIndex().methods.filter(entry => {
        if (options.origin && entry.origin !== options.origin) return false;
        if (!query) return true;
        const latest = readVersion(entry, entry.versions.at(-1)!.version);
        return [latest.title, ...Object.values(latest.content)].some(text => text.toLowerCase().includes(query));
      }).map(summary).filter(item => !options.status || (options.status === 'draft' ? item.hasUnpublishedChanges : item.publishedVersion !== null));
    },
    publish(methodId: string, input: SapMethodPublishInput): SapMethodWriteResult {
      methodId = id(methodId);
      const requestId = id(input.requestId), version = positive(input.version);
      if (typeof input.expectedSha256 !== 'string' || !shaPattern.test(input.expectedSha256)) fail('METHOD_INPUT_INVALID');
      const fingerprint = digest(JSON.stringify({ kind: 'publish', methodId, requestId, version, expectedSha256: input.expectedSha256 }));
      const prior = matchingOperation(requestId, 'publish', fingerprint), index = loadIndex(), entry = entryFor(index, methodId), record = readVersion(entry, version);
      if (prior && committed(prior, index)) return writeResult(entry, version, true);
      if (record.contentSha256 !== input.expectedSha256) fail('METHOD_VERSION_CONFLICT', 409);
      ensureRoot();
      const operation = reserveOperation({ schemaVersion: 1, requestId, kind: 'publish', fingerprint, contentSha256: record.contentSha256, methodId, version, recordedAt: new Date().toISOString() });
      if (entry.publications.some(item => item.version === version)) return writeResult(entry, version, true);
      entry.publications.push({ version, contentSha256: record.contentSha256, publishedAt: operation.recordedAt, requestId });
      saveIndex(index);
      return writeResult(entry, version, false);
    },
    listPublished(): SapMethodSummary[] {
      return loadIndex().methods.filter(entry => publishedVersion(entry) !== null).map(entry => {
        const version = publishedVersion(entry)!, record = readVersion(entry, version);
        const issue = entry.governance.filter(item => item.version === version).at(-1) ?? null;
        return { id: entry.id, title: record.title, origin: entry.origin, latestVersion: version, publishedVersion: version,
          updatedAt: entry.publications.find(item => item.version === version)!.publishedAt, hasUnpublishedChanges: false, issue };
      }).filter(item => item.issue?.status !== 'confirmed');
    },
    getPublished(methodId: string, version: number): SapMethodPublishedRead {
      const entry = entryFor(loadIndex(), methodId);
      const publication = entry.publications.find(item => item.version === positive(version)) ?? fail('METHOD_NOT_PUBLISHED', 409);
      const record = readVersion(entry, version);
      if (record.contentSha256 !== publication.contentSha256) fail('METHOD_STORE_CORRUPT', 409);
      return { version: record, publication: structuredClone(publication), issue: structuredClone(entry.governance.filter(item => item.version === version).at(-1) ?? null) };
    },
    markIssue(methodId: string, input: SapMethodIssueInput): SapMethodDetail {
      methodId = id(methodId);
      if (!object(input) || !['suspected', 'confirmed'].includes(input.status) || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 20_000 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('METHOD_INPUT_INVALID');
      const requestId = id(input.requestId), version = positive(input.version);
      const replacement = input.replacement == null ? null : { methodId: id(input.replacement.methodId), version: positive(input.replacement.version) };
      const fingerprint = digest(JSON.stringify({ kind: 'issue', methodId, requestId, version, expectedRevision: input.expectedRevision, status: input.status, note: input.note.trim(), replacement }));
      const prior = matchingOperation(requestId, 'issue', fingerprint), index = loadIndex(), entry = entryFor(index, methodId), record = readVersion(entry, version);
      if (prior && committed(prior, index)) return detail(entry, version);
      if (entry.governance.length !== input.expectedRevision) fail('METHOD_GOVERNANCE_CONFLICT', 409);
      if (entry.governance.some(item => item.version === version && item.status === 'confirmed') && input.status === 'suspected') fail('METHOD_GOVERNANCE_CONFLICT', 409);
      if (replacement) {
        if (replacement.methodId === methodId && replacement.version === version) fail('METHOD_RELATION_INVALID');
        readVersion(entryFor(index, replacement.methodId), replacement.version);
      }
      ensureRoot();
      const operation = reserveOperation({ schemaVersion: 1, requestId, kind: 'issue', fingerprint, contentSha256: record.contentSha256, methodId, version, recordedAt: new Date().toISOString() });
      entry.governance.push({ version, revision: entry.governance.length + 1, status: input.status, note: input.note.trim(), replacement, recordedAt: operation.recordedAt, requestId });
      saveIndex(index);
      return detail(entry, version);
    },
    operation(requestId: string): SapMethodOperationState | null {
      const operation = readOperation(requestId);
      return operation ? { ...operation, status: committed(operation, loadIndex()) ? 'committed' : 'pending' } : null;
    },
    read(methodId: string, version?: number): SapMethodDetail {
      const entry = entryFor(loadIndex(), methodId);
      if (version !== undefined) readVersion(entry, version);
      return detail(entry, version);
    },
  };
}
export type SapMethodStore = ReturnType<typeof createSapMethodStore>;

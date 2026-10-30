import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { RunDiagnostic } from '../agent/run-diagnostics.ts';

export type VerificationOwner = { projectId: string; taskId: string; verificationId: string };
export type VerificationState = 'preparing' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
export type VerificationPhase = 'cold' | 'compare' | 'recheck';
export type VerificationSource = { kind: string; id?: string; version?: string; sha256?: string; confirmed?: boolean; note?: string };
export type VerificationFileInput = { relativePath: string; bytes: Uint8Array; sha256?: string; sourcePath?: string };
export type VerificationFile = { relativePath: string; sha256: string; bytes: number; snapshotPath: string; sourcePath?: string; observedAt: string };
export type VerificationConfiguration = { id: string; revision: number; provider: string; model: string; name?: string; thinkingLevel?: string };
export type VerificationResultInput = { text: string; requestId?: string; sessionFile?: string };
export type VerificationResult = VerificationResultInput & { file: string; sha256: string; savedAt: string; files: VerificationFile[]; captureNotes?: string[] };
export type VerificationIndependence = { status: 'observed' | 'informed' | 'unknown'; note?: string };
export type VerificationAuthorRevision = { requestId: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'; reportText?: string; sessionFile?: string; files?: string[] };
export type CreateVerificationInput = VerificationOwner & {
  question: string;
  selection: unknown;
  configuration: VerificationConfiguration;
  semantics?: { text: string; sources?: VerificationSource[] };
  dataFiles: VerificationFileInput[];
  authorFiles: VerificationFileInput[];
  retryOf?: string;
  authorRequestId?: string;
  independence?: VerificationIndependence;
};
export type VerificationRecord = VerificationOwner & {
  formatVersion: 1;
  requestFingerprint: string;
  question: string;
  selection: unknown;
  configuration: VerificationConfiguration;
  state: VerificationState;
  phase: VerificationPhase;
  createdAt: string;
  updatedAt: string;
  preparedAt?: string;
  workspace: string;
  sessionDirectory: string;
  semantics: { text: string; sha256: string; sources: VerificationSource[] };
  dataFiles: VerificationFile[];
  authorFiles: VerificationFile[];
  retryOf?: string;
  authorRequestId?: string;
  coldResult?: VerificationResult;
  comparisonResult?: VerificationResult;
  recheckResult?: VerificationResult;
  authorRevealedAt?: string;
  independence: VerificationIndependence;
  diagnostic?: RunDiagnostic;
  error?: string;
  native?: { requestId?: string; sessionFile?: string };
  authorRevision?: VerificationAuthorRevision;
  revisionCount?: number;
  recheckCount?: number;
  exportedFile?: string;
};
export type VerificationUpdate = Partial<Pick<VerificationRecord, 'state' | 'phase' | 'independence' | 'diagnostic' | 'error' | 'native' | 'authorRevision' | 'revisionCount' | 'recheckCount' | 'exportedFile'>>;

export class VerificationStoreError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}

export function createVerificationStore(options: { dataRoot: string }) {
  const dataRoot = path.resolve(options.dataRoot);
  const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
  const fail = (code: string, status = 409): never => { throw new VerificationStoreError(code, status); };
  const isUUID = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const id = (value: unknown): string => isUUID(value) ? value : fail('invalid_verification_identity', 400);
  const inside = (target: string) => { const relative = path.relative(dataRoot, target); if (relative.startsWith('..') || path.isAbsolute(relative)) fail('verification_path_outside_root', 400); return relative; };
  const workspace = (verificationId: string) => path.join(dataRoot, 'verification-workspaces', id(verificationId));
  const recordDirectory = (owner: VerificationOwner) => path.join(dataRoot, 'analysis-verifications', id(owner.projectId), id(owner.taskId), id(owner.verificationId));
  async function directory(target: string, create = false, allowMissing = false): Promise<boolean> {
    const relative = inside(target);
    if (create) await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    for (const current of [dataRoot, ...relative.split(path.sep).filter(Boolean).map((_, index, parts) => path.join(dataRoot, ...parts.slice(0, index + 1)))]) {
      let entry;
      try { entry = await lstat(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) { if (allowMissing) return false; return fail('verification_not_found', 404); }
        await mkdir(current, { mode: 0o700 }).catch(async error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
        entry = await lstat(current);
      }
      if (entry.isSymbolicLink() || !entry.isDirectory()) fail('verification_unsafe_path');
    }
    return true;
  }
  async function regular(target: string, missing = false, recordRead = false) {
    await directory(path.dirname(target));
    try {
      const entry = await lstat(target);
      // A record lstat can already describe an unlinked old commit. This only
      // admits the next O_NOFOLLOW open: its actual regular FD and stable bytes
      // remain authoritative. Immutable inputs never receive this exception.
      if (!entry.isFile() || entry.isSymbolicLink() || (recordRead ? entry.nlink < 0 || entry.nlink > 2 : entry.nlink !== 1)) fail('verification_unsafe_file');
      return entry;
    }
    catch (error) { if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async function bytes(target: string, recordRead = false) {
    const expected = await regular(target, false, recordRead);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      // The opened regular record may have been replaced after open: its old
      // inode then legitimately has zero names. Both path and FD remain regular
      // and nonsymlink; immutable files and native pointers stay stricter.
      if (!before.isFile() || (recordRead ? before.nlink < 0 || before.nlink > 2 : before.nlink !== 1 || before.dev !== expected!.dev || before.ino !== expected!.ino)) fail('verification_unsafe_file');
      const result = await handle.readFile();
      const after = await handle.stat(), current = await lstat(target);
      // A committed JSON record may be atomically replaced while read, or its
      // initial temporary hard link may be unlinked. The opened inode remains
      // a valid committed snapshot. Immutable input/evidence reads are stricter.
      if (after.size !== result.length || before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || !recordRead && (before.ctimeMs !== after.ctimeMs || current.ino !== after.ino || current.dev !== after.dev || current.isSymbolicLink())) fail('verification_file_changed');
      return result;
    } finally { await handle.close(); }
  }
  async function writeNew(target: string, value: Uint8Array | string) {
    await directory(path.dirname(target), true);
    const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
  }
  async function writeRecord(target: string, value: VerificationRecord, initial = false): Promise<boolean> {
    await directory(path.dirname(target), true);
    if (!initial) await regular(target);
    const temporary = path.join(path.dirname(target), `.record-${randomUUID()}.tmp`);
    await writeNew(temporary, `${JSON.stringify(value, null, 2)}\n`);
    try {
      if (initial) {
        try { await link(temporary, target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      } else await rename(temporary, target);
      const parent = await open(path.dirname(target), constants.O_RDONLY);
      try { await parent.sync(); } finally { await parent.close(); }
      return true;
    } finally { await unlink(temporary).catch(() => {}); }
  }
  function relativeFile(value: string): string {
    if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail('invalid_verification_file', 400);
    return value;
  }
  function json(value: unknown): unknown { try { const encoded = JSON.stringify(value); if (encoded === undefined) fail('invalid_verification_input', 400); return JSON.parse(encoded); } catch { return fail('invalid_verification_input', 400); } }
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function files(input: VerificationFileInput[]) {
    if (!Array.isArray(input)) return fail('invalid_verification_files', 400);
    const seen = new Set<string>();
    return input.map(file => {
      const name = relativeFile(file.relativePath);
      if (seen.has(name) || !(file.bytes instanceof Uint8Array)) fail('invalid_verification_files', 400);
      seen.add(name);
      const content = Buffer.from(file.bytes), sha256 = digest(content);
      if (file.sha256 !== undefined && file.sha256 !== sha256) fail('verification_input_hash_mismatch', 409);
      return { ...file, relativePath: name, bytes: content, sha256 };
    });
  }
  function validateRecord(value: unknown, owner: VerificationOwner): VerificationRecord {
    if (!value || typeof value !== 'object') return fail('verification_record_corrupt');
    const record = value as VerificationRecord;
    const corrupt = (): never => fail('verification_record_corrupt');
    const timestamp = (text: unknown) => typeof text === 'string' && Number.isFinite(Date.parse(text)) && new Date(text).toISOString() === text;
    if (record.formatVersion !== 1 || record.projectId !== owner.projectId || record.taskId !== owner.taskId || record.verificationId !== owner.verificationId || typeof record.requestFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.requestFingerprint) || !['preparing','ready','running','completed','failed','cancelled','interrupted','unknown'].includes(record.state) || !['cold','compare','recheck'].includes(record.phase) || record.workspace !== workspace(owner.verificationId) || record.sessionDirectory !== path.join(recordDirectory(owner), 'native') || !record.configuration || !record.semantics || !Array.isArray(record.dataFiles) || !Array.isArray(record.authorFiles)) corrupt();
    if (typeof record.question !== 'string' || !record.question.trim() || !timestamp(record.createdAt) || !timestamp(record.updatedAt) || typeof record.configuration.id !== 'string' || !Number.isSafeInteger(record.configuration.revision) || typeof record.configuration.provider !== 'string' || typeof record.configuration.model !== 'string' || typeof record.semantics.text !== 'string' || digest(record.semantics.text) !== record.semantics.sha256 || !Array.isArray(record.semantics.sources) || !record.independence || !['observed','informed','unknown'].includes(record.independence.status)) corrupt();
    if (record.preparedAt !== undefined && !timestamp(record.preparedAt) || ['ready','running','completed'].includes(record.state) && !record.preparedAt) corrupt();
    function entryValid(entry: VerificationFile, base: string) {
      if (!entry || typeof entry.relativePath !== 'string') return corrupt();
      let name: string;
      try { name = relativeFile(entry.relativePath); } catch { return corrupt(); }
      if (entry.snapshotPath !== path.join(base, name) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !timestamp(entry.observedAt)) corrupt();
    }
    for (const [group, entries] of [['data', record.dataFiles], ['author', record.authorFiles]] as const) {
      for (const entry of entries) entryValid(entry, path.join(recordDirectory(owner), group));
    }
    for (const [phase, result] of [['cold', record.coldResult], ['compare', record.comparisonResult], ['recheck', record.recheckResult]] as const) if (result !== undefined) {
      if (!result || typeof result.text !== 'string' || !result.text.trim() || digest(result.text) !== result.sha256 || result.file !== path.join(recordDirectory(owner), 'evidence', `${phase}-result.md`) || !timestamp(result.savedAt) || !Array.isArray(result.files) || result.requestId !== undefined && typeof result.requestId !== 'string' || result.sessionFile !== undefined && typeof result.sessionFile !== 'string') corrupt();
      for (const file of result.files) entryValid(file, path.join(recordDirectory(owner), 'evidence', `${phase}-files`));
    }
    if (record.authorRevealedAt !== undefined && (!timestamp(record.authorRevealedAt) || !record.coldResult) || record.phase !== 'cold' && !record.authorRevealedAt || record.comparisonResult && (!record.coldResult || !record.authorRevealedAt) || record.recheckResult && !record.comparisonResult || record.state === 'completed' && !(record.phase === 'recheck' ? record.recheckResult : record.comparisonResult)) corrupt();
    return record;
  }
  async function checkNativeFile(record: VerificationRecord, value: unknown) {
    const inScope = (file: unknown): file is string => typeof file === 'string' && path.isAbsolute(file) && file === path.resolve(file) && file.endsWith('.jsonl') && Boolean(path.relative(record.sessionDirectory, file)) && !path.relative(record.sessionDirectory, file).startsWith('..') && !path.isAbsolute(path.relative(record.sessionDirectory, file));
    if (!inScope(value)) fail('verification_native_scope_invalid');
    try {
      const expected = await regular(value as string), handle = await open(value as string, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const actual = await handle.stat();
        if (!actual.isFile() || actual.nlink !== 1 || expected!.dev !== actual.dev || expected!.ino !== actual.ino) fail('verification_native_scope_invalid');
        const buffer = Buffer.alloc(65_536), read = await handle.read(buffer, 0, buffer.length, 0), boundary = buffer.subarray(0, read.bytesRead).indexOf(10);
        if (boundary < 0) fail('verification_native_scope_invalid');
        const header = JSON.parse(buffer.subarray(0, boundary).toString('utf8'));
        if (header.type !== 'session' || typeof header.id !== 'string' || header.cwd !== record.workspace || header.parentSession != null && !inScope(header.parentSession)) fail('verification_native_scope_invalid');
        const current = await lstat(value as string);
        if (current.isSymbolicLink() || current.nlink !== 1 || current.dev !== actual.dev || current.ino !== actual.ino) fail('verification_native_scope_invalid');
      } finally { await handle.close(); }
    } catch { fail('verification_native_scope_invalid'); }
  }
  async function checkNativeReferences(record: VerificationRecord) {
    const pointers = [record.native?.sessionFile, record.coldResult?.sessionFile, record.comparisonResult?.sessionFile, record.recheckResult?.sessionFile].filter(value => value !== undefined);
    for (const file of new Set(pointers)) await checkNativeFile(record, file);
  }
  async function read(owner: VerificationOwner): Promise<VerificationRecord> {
    const target = path.join(recordDirectory(owner), 'record.json');
    let value;
    try { value = JSON.parse((await bytes(target, true)).toString('utf8')); }
    catch (error) {
      if (error instanceof VerificationStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('verification_not_found', 404);
      return fail('verification_record_corrupt');
    }
    const record = validateRecord(value, owner);
    await checkNativeReferences(record);
    return record;
  }
  async function create(input: CreateVerificationInput): Promise<{ record: VerificationRecord; created: boolean }> {
    const home = recordDirectory(input), cwd = workspace(input.verificationId);
    if (typeof input.question !== 'string' || !input.question.trim() || !input.configuration || typeof input.configuration.id !== 'string' || !Number.isSafeInteger(input.configuration.revision) || typeof input.configuration.provider !== 'string' || typeof input.configuration.model !== 'string') fail('invalid_verification_input', 400);
    if (input.retryOf !== undefined) id(input.retryOf);
    const data = files(input.dataFiles), author = files(input.authorFiles);
    if (!data.length || !author.length) fail('verification_files_required', 400);
    if (data.some(file => author.some(candidate => file.relativePath === candidate.relativePath || file.sha256 === candidate.sha256))) fail('verification_input_author_overlap', 400);
    const { id: configurationId, revision, provider, model, name, thinkingLevel } = input.configuration;
    const configuration: VerificationConfiguration = { id: configurationId, revision, provider, model, ...(name === undefined ? {} : { name }), ...(thinkingLevel === undefined ? {} : { thinkingLevel }) };
    const selection = json(input.selection), semanticText = input.semantics?.text ?? '';
    if (typeof semanticText !== 'string') fail('invalid_verification_semantics', 400);
    const sources = json(input.semantics?.sources ?? []) as VerificationSource[];
    if (!Array.isArray(sources)) fail('invalid_verification_semantics', 400);
    const fingerprint = digest(canonical(json({ question: input.question, selection, configuration, semantics: { text: semanticText, sources }, dataFiles: data.map(file => ({ relativePath: file.relativePath, sha256: file.sha256, sourcePath: file.sourcePath })), authorFiles: author.map(file => ({ relativePath: file.relativePath, sha256: file.sha256, sourcePath: file.sourcePath })), retryOf: input.retryOf, authorRequestId: input.authorRequestId, independence: input.independence })));
    const now = new Date().toISOString();
    const describe = (group: string, entries: ReturnType<typeof files>): VerificationFile[] => entries.map(file => ({ relativePath: file.relativePath, bytes: file.bytes.length, sha256: file.sha256, snapshotPath: path.join(home, group, file.relativePath), ...(file.sourcePath === undefined ? {} : { sourcePath: file.sourcePath }), observedAt: now }));
    const record: VerificationRecord = { formatVersion: 1, projectId: input.projectId, taskId: input.taskId, verificationId: input.verificationId, question: input.question, selection, configuration, requestFingerprint: fingerprint, state: 'preparing', phase: 'cold', createdAt: now, updatedAt: now, workspace: cwd, sessionDirectory: path.join(home, 'native'), semantics: { text: semanticText, sha256: digest(semanticText), sources }, dataFiles: describe('data', data), authorFiles: describe('author', author), independence: input.independence ?? { status: 'unknown' }, ...(input.retryOf === undefined ? {} : { retryOf: input.retryOf }), ...(input.authorRequestId === undefined ? {} : { authorRequestId: input.authorRequestId }) };
    const claimed = await writeRecord(path.join(home, 'record.json'), record, true);
    if (!claimed) {
      const existing = await read(input);
      if (existing.requestFingerprint !== fingerprint) fail('verification_selection_conflict');
      return { record: existing, created: false };
    }
    try {
      await directory(path.dirname(cwd), true);
      try { await mkdir(cwd, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const existing = await lstat(cwd);
          if (existing.isSymbolicLink() || !existing.isDirectory()) fail('verification_unsafe_path');
          fail('verification_workspace_exists');
        }
        throw error;
      }
      await directory(record.sessionDirectory, true);
      for (const [group, entries] of [['data', data], ['author', author]] as const) for (const entry of entries) {
        await writeNew(path.join(home, group, entry.relativePath), entry.bytes);
        if (group === 'data') await writeNew(path.join(cwd, 'inputs', entry.relativePath), entry.bytes);
      }
      await writeNew(path.join(cwd, 'inputs', 'business-context.md'), semanticText);
      record.state = 'ready'; record.preparedAt = record.updatedAt = new Date().toISOString();
      await writeRecord(path.join(home, 'record.json'), record);
      return { record, created: true };
    } catch (error) {
      record.state = 'failed'; record.error = error instanceof VerificationStoreError ? error.code : 'verification_prepare_failed'; record.updatedAt = new Date().toISOString();
      await writeRecord(path.join(home, 'record.json'), record).catch(() => {});
      throw error instanceof VerificationStoreError ? error : new VerificationStoreError('verification_prepare_failed');
    }
  }
  async function list(projectId: string, taskId?: string): Promise<VerificationRecord[]> {
    const project = path.join(dataRoot, 'analysis-verifications', id(projectId));
    if (taskId === undefined) {
      if (!await directory(project, false, true)) return [];
      const tasks = (await readdir(project)).filter(isUUID);
      return (await Promise.all(tasks.map(task => list(projectId, task)))).flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const base = path.join(project, id(taskId));
    if (!await directory(base, false, true)) return [];
    const entries = await readdir(base);
    const records = await Promise.all(entries.filter(isUUID).map(verificationId => read({ projectId, taskId, verificationId })));
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function immutable(target: string, content: Uint8Array | string) {
    const expected = Buffer.from(content);
    try { await writeNew(target, expected); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await bytes(target)).equals(expected)) fail('verification_snapshot_conflict');
    }
  }
  async function checked(entry: Pick<VerificationFile, 'snapshotPath' | 'sha256' | 'bytes'>) {
    const content = await bytes(entry.snapshotPath);
    if (content.length !== entry.bytes || digest(content) !== entry.sha256) fail('verification_snapshot_changed');
    return content;
  }
  async function captureFiles(record: VerificationRecord, phase: VerificationPhase) {
    const captured: VerificationFile[] = [], notes = ['仅保存工作区中可读取的普通产物；inputs、author、隐藏目录、临时文件及超出捕获上限的文件不在本次副本中。'];
    const excluded = new Set(['inputs', 'author', 'node_modules', '__pycache__', 'native']);
    let total = 0;
    async function walk(relative: string, depth: number) {
      const target = path.join(record.workspace, relative);
      await directory(target);
      if (depth > 8) { notes.push(`未捕获过深目录：${relative}`); return; }
      for (const name of (await readdir(target)).sort()) {
        if (name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.pyc') || excluded.has(name)) continue;
        const item = path.join(relative, name), source = path.join(record.workspace, item);
        const entry = await lstat(source);
        if (entry.isSymbolicLink()) { notes.push(`未捕获符号链接：${item}`); continue; }
        if (entry.isDirectory()) { await walk(item, depth + 1); continue; }
        if (!entry.isFile() || entry.nlink !== 1) { notes.push(`未捕获非独立普通文件：${item}`); continue; }
        if (entry.size > 20 * 1024 * 1024 || total + entry.size > 64 * 1024 * 1024 || captured.length >= 512) { notes.push(`超出捕获上限：${item}`); continue; }
        let content: Buffer;
        try { content = await bytes(source); }
        catch { notes.push(`读取期间变化或不可读取：${item}`); continue; }
        const snapshotPath = path.join(recordDirectory(record), 'evidence', `${phase}-files`, item);
        await immutable(snapshotPath, content);
        captured.push({ relativePath: item.split(path.sep).join('/'), snapshotPath, sha256: digest(content), bytes: content.length, observedAt: new Date().toISOString() });
        total += content.length;
      }
    }
    await walk('', 0);
    return { files: captured, captureNotes: notes };
  }
  async function update(owner: VerificationOwner, patch: VerificationUpdate): Promise<VerificationRecord> {
    const record = await read(owner);
    const allowed = new Set(['state', 'phase', 'independence', 'diagnostic', 'error', 'native', 'authorRevision', 'revisionCount', 'recheckCount', 'exportedFile']);
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !allowed.has(key))) fail('invalid_verification_update', 400);
    if (patch.state !== undefined && !['preparing','ready','running','completed','failed','cancelled','interrupted','unknown'].includes(patch.state)) fail('invalid_verification_update', 400);
    if (patch.phase !== undefined && !['cold','compare','recheck'].includes(patch.phase)) fail('invalid_verification_update', 400);
    if (patch.independence !== undefined && !['observed','informed','unknown'].includes(patch.independence.status)) fail('invalid_verification_update', 400);
    if (patch.exportedFile !== undefined && !['compare','recheck'].some(phase => patch.exportedFile === `060_reports/verification-${record.verificationId}-${phase}.md`)) fail('invalid_verification_update', 400);
    if (patch.phase === 'compare' && !record.authorRevealedAt) fail('verification_author_not_revealed');
    if (patch.phase === 'cold' && record.phase !== 'cold') fail('verification_phase_conflict');
    if (patch.phase === 'recheck' && (!record.comparisonResult || (patch.authorRevision ?? record.authorRevision)?.status !== 'completed')) fail('verification_revision_required');
    const phase = patch.phase ?? record.phase;
    const explicitRecheck = record.state === 'completed' && phase === 'recheck' && (patch.authorRevision ?? record.authorRevision)?.status === 'completed' && !record.recheckResult;
    if (patch.state !== undefined && patch.state !== record.state && ['completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(record.state) && !(patch.state === 'running' && explicitRecheck)) fail('verification_terminal');
    if (patch.state === 'running' && !['ready','running'].includes(record.state) && !(record.state === 'completed' && phase === 'recheck' && (patch.authorRevision ?? record.authorRevision)?.status === 'completed' && !record.recheckResult)) fail('verification_terminal');
    if (patch.state === 'ready' && record.state !== 'ready') fail('verification_terminal');
    if (patch.state === 'completed' && !(phase === 'recheck' ? record.recheckResult : record.comparisonResult)) fail('verification_result_required');
    for (const key of ['revisionCount', 'recheckCount'] as const) if (patch[key] !== undefined && (!Number.isInteger(patch[key]) || patch[key]! < (record[key] ?? 0) || patch[key]! > 1 || patch[key]! < 0)) fail('verification_followup_limit');
    if (patch.authorRevision !== undefined) {
      if (!patch.authorRevision || typeof patch.authorRevision.requestId !== 'string' || !patch.authorRevision.requestId || !['running', 'completed', 'failed', 'cancelled', 'unknown'].includes(patch.authorRevision.status)) fail('invalid_verification_update', 400);
      if (!record.comparisonResult || (patch.revisionCount ?? record.revisionCount) !== 1 || record.authorRevision && record.authorRevision.requestId !== patch.authorRevision.requestId) fail('verification_followup_limit');
      if (record.authorRevision && record.authorRevision.status !== 'running' && record.authorRevision.status !== patch.authorRevision.status) fail('verification_followup_limit');
    }
    const changed = { ...record, ...json(patch) as VerificationUpdate, updatedAt: new Date().toISOString() };
    await checkNativeReferences(changed);
    await writeRecord(path.join(recordDirectory(owner), 'record.json'), changed);
    return changed;
  }
  async function saveResult(owner: VerificationOwner, input: VerificationResultInput, phase: VerificationPhase): Promise<VerificationRecord> {
    const record = await read(owner);
    if (typeof input.text !== 'string' || !input.text.trim()) fail('verification_result_required');
    const key = phase === 'cold' ? 'coldResult' : phase === 'compare' ? 'comparisonResult' : 'recheckResult';
    const existing = record[key];
    if (existing) {
      if (existing.text !== input.text || existing.requestId !== input.requestId || existing.sessionFile !== input.sessionFile) fail('verification_result_conflict');
      return record;
    }
    if (record.state !== 'running') fail('verification_not_running');
    if (record.phase !== phase || phase !== 'cold' && !record.authorRevealedAt) fail('verification_phase_conflict');
    if (input.sessionFile !== undefined) await checkNativeFile(record, input.sessionFile);
    const file = path.join(recordDirectory(owner), 'evidence', `${phase}-result.md`);
    await immutable(file, input.text);
    const captured = await captureFiles(record, phase);
    record[key] = { text: input.text, ...(input.requestId === undefined ? {} : { requestId: input.requestId }), ...(input.sessionFile === undefined ? {} : { sessionFile: input.sessionFile }), file, sha256: digest(input.text), savedAt: new Date().toISOString(), ...captured };
    record.updatedAt = new Date().toISOString();
    await writeRecord(path.join(recordDirectory(owner), 'record.json'), record);
    return record;
  }
  async function revealAuthor(owner: VerificationOwner): Promise<VerificationRecord> {
    const record = await read(owner);
    const coldResult = record.coldResult;
    if (!coldResult) return fail('verification_cold_result_required');
    if (record.state !== 'running') fail('verification_not_running');
    const cold = await bytes(coldResult.file);
    if (digest(cold) !== coldResult.sha256) fail('verification_snapshot_changed');
    for (const file of coldResult.files) await checked(file);
    for (const file of record.authorFiles) {
      const content = await checked(file);
      await immutable(path.join(record.workspace, 'author', file.relativePath), content);
    }
    if (!record.authorRevealedAt) {
      record.authorRevealedAt = record.updatedAt = new Date().toISOString(); record.phase = 'compare';
      await writeRecord(path.join(recordDirectory(owner), 'record.json'), record);
    }
    return record;
  }
  async function verifyWorkspaceInputs(owner: VerificationOwner, options: { revision?: boolean } = {}): Promise<VerificationRecord> {
    const record = await read(owner);
    for (const file of record.dataFiles) {
      await checked(file);
      let current: Buffer;
      try { current = await bytes(path.join(record.workspace, 'inputs', file.relativePath)); }
      catch { return fail('verification_workspace_input_changed'); }
      if (current.length !== file.bytes || digest(current) !== file.sha256) fail('verification_workspace_input_changed');
    }
    let semantic: Buffer;
    try { semantic = await bytes(path.join(record.workspace, 'inputs', 'business-context.md')); }
    catch { return fail('verification_workspace_input_changed'); }
    if (digest(semantic) !== record.semantics.sha256) fail('verification_workspace_input_changed');
    if (record.authorRevealedAt) for (const file of record.authorFiles) {
      await checked(file);
      let content: Buffer;
      try { content = await bytes(path.join(record.workspace, 'author', file.relativePath)); }
      catch { return fail('verification_workspace_input_changed'); }
      if (content.length !== file.bytes || digest(content) !== file.sha256) fail('verification_workspace_input_changed');
    }
    if (options.revision) {
      if (!record.authorRevision?.reportText) fail('verification_revision_required');
      let content: Buffer;
      try { content = await bytes(path.join(record.workspace, 'author-revision/revision.md')); }
      catch { return fail('verification_workspace_input_changed'); }
      if (digest(content) !== digest(record.authorRevision!.reportText!)) fail('verification_workspace_input_changed');
    }
    return record;
  }
  async function stageRevision(owner: VerificationOwner, text: string): Promise<{ relativePath: string; sha256: string; bytes: number }> {
    const record = await verifyWorkspaceInputs(owner);
    if (record.authorRevision?.status !== 'completed' || !record.comparisonResult || !(record.state === 'completed' || record.state === 'running' && record.phase === 'recheck')) fail('verification_revision_required');
    if (typeof text !== 'string' || !text.trim() || text !== record.authorRevision?.reportText) fail('verification_revision_mismatch');
    const relativePath = 'author-revision/revision.md', content = Buffer.from(text, 'utf8');
    await immutable(path.join(record.workspace, relativePath), content);
    return { relativePath, sha256: digest(content), bytes: content.length };
  }
  async function readAuthorFiles(owner: VerificationOwner): Promise<{ relativePath: string; sha256: string; bytes: Buffer }[]> {
    const record = await read(owner);
    if (!record.authorRevealedAt) return [];
    return Promise.all(record.authorFiles.map(async file => ({ relativePath: file.relativePath, sha256: file.sha256, bytes: await checked(file) })));
  }
  async function reconcileInterrupted(): Promise<VerificationRecord[]> {
    const base = path.join(dataRoot, 'analysis-verifications');
    if (!await directory(base, false, true)) return [];
    const changed: VerificationRecord[] = [];
    for (const projectId of (await readdir(base)).filter(isUUID)) {
      const project = path.join(base, projectId); await directory(project);
      for (const taskId of (await readdir(project)).filter(isUUID)) for (const record of await list(projectId, taskId)) {
        const patch: VerificationUpdate = {};
        if (['preparing', 'ready', 'running'].includes(record.state)) { patch.state = 'interrupted'; patch.error = 'host_restarted_before_confirmed_completion'; }
        if (record.authorRevision?.status === 'running') { patch.authorRevision = { ...record.authorRevision, status: 'unknown' }; patch.error ??= 'host_restarted_before_confirmed_author_revision'; }
        if (Object.keys(patch).length) changed.push(await update(record, patch));
      }
    }
    return changed;
  }
  return {
    create,
    read,
    list,
    update,
    saveColdResult: (owner: VerificationOwner, input: VerificationResultInput) => saveResult(owner, input, 'cold'),
    saveComparisonResult: (owner: VerificationOwner, input: VerificationResultInput) => saveResult(owner, input, 'compare'),
    saveRecheckResult: (owner: VerificationOwner, input: VerificationResultInput) => saveResult(owner, input, 'recheck'),
    revealAuthor,
    verifyWorkspaceInputs,
    stageRevision,
    readAuthorFiles,
    reconcileInterrupted,
    workspace,
    recordDirectory,
  };
}

export type VerificationStore = ReturnType<typeof createVerificationStore>;

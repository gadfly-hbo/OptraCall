import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { FeedbackDelivery, FeedbackHandoff, FeedbackOperation } from './decision-feedback-types.ts';

export class DecisionFeedbackError extends Error {
  readonly code: string; readonly statusCode: number;
  constructor(code: string, statusCode = 400) { super(code); this.code = code; this.statusCode = statusCode; }
}
export function feedbackFail(code: string, status = 400): never { throw new DecisionFeedbackError(code, status); }
export const feedbackObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const feedbackId = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value) ? value : feedbackFail('invalid_feedback_id');
export function feedbackCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(feedbackCanonical).join(',') + ']';
  if (feedbackObject(value)) return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + feedbackCanonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const feedbackHash = (value: unknown): string => createHash('sha256').update(feedbackCanonical(value)).digest('hex');
export const feedbackTextHash = (value: string): string => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

/** Only this feature's source snapshots and business intents; never session lifecycle state. */
export class DecisionFeedbackStore {
  readonly root: string;
  #token = randomUUID(); #ready = false;
  constructor({ root }: { root: string }) { this.root = path.resolve(root); }
  #directory(directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) feedbackFail('unsafe_feedback_storage', 503);
    fs.chmodSync(directory, 0o700);
  }
  init(): void {
    if (this.#ready) return;
    this.#directory(this.root);
    const lock = path.join(this.root, '.write.lock'), claimFile = path.join(this.root, '.recovery.claim');
    const claimBytes = Buffer.from(JSON.stringify({ pid: process.pid, token: this.#token }));
    let claimFd: number;
    try { claimFd = fs.openSync(claimFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') feedbackFail('feedback_store_locked', 503); throw error; }
    try { fs.writeFileSync(claimFd, claimBytes); fs.fsyncSync(claimFd); } finally { fs.closeSync(claimFd); }
    const claimStat = fs.lstatSync(claimFile);
    const releaseClaim = () => {
      const current = fs.lstatSync(claimFile);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.ino !== claimStat.ino || current.dev !== claimStat.dev || !fs.readFileSync(claimFile).equals(claimBytes)) feedbackFail('feedback_store_locked', 503);
      fs.unlinkSync(claimFile);
    };
    // All lock acquisition and dead-writer recovery holds this fixed exclusive
    // claim until the new live lock is durable. Unknown interrupted claims are
    // left for inspection; they never authorize replaying business operations.
    let fd: number | undefined;
    for (let attempt = 0; attempt < 3 && fd === undefined; attempt++) {
      try { fd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let stat: fs.Stats;
        try { stat = fs.lstatSync(lock); } catch (readError) { if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue; throw readError; }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) feedbackFail('feedback_store_locked', 503);
        const oldFd = fs.openSync(lock, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let bytes: Buffer;
        try { const current = fs.fstatSync(oldFd); if (!current.isFile() || current.ino !== stat.ino || current.dev !== stat.dev || current.nlink !== 1) feedbackFail('feedback_store_locked', 503); bytes = fs.readFileSync(oldFd); }
        finally { fs.closeSync(oldFd); }
        let previous: unknown; try { previous = JSON.parse(bytes.toString('utf8')); } catch { return feedbackFail('feedback_store_locked', 503); }
        if (!feedbackObject(previous) || Object.keys(previous).sort().join(',') !== 'pid,token' || !Number.isSafeInteger(previous.pid) || Number(previous.pid) < 1 || typeof previous.token !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(previous.token)) feedbackFail('feedback_store_locked', 503);
        try { process.kill(Number(previous.pid), 0); releaseClaim(); feedbackFail('feedback_store_locked', 503); }
        catch (probeError) { if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw probeError; }
        const current = fs.lstatSync(lock);
        if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.ino !== stat.ino || current.dev !== stat.dev || !fs.readFileSync(lock).equals(bytes)) feedbackFail('feedback_store_locked', 503);
        fs.unlinkSync(lock);
      }
    }
    if (fd === undefined) feedbackFail('feedback_store_locked', 503);
    try { fs.writeFileSync(fd, JSON.stringify({ token: this.#token, pid: process.pid })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    releaseClaim();
    this.#ready = true;
    try { for (const name of ['handoffs', 'operations', 'deliveries']) this.#directory(path.join(this.root, name)); }
    catch (error) { this.close(); throw error; }
  }
  close(): void {
    if (!this.#ready) return;
    const file = path.join(this.root, '.write.lock'), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.readFileSync(file, 'utf8') !== JSON.stringify({ token: this.#token, pid: process.pid })) feedbackFail('feedback_store_lock_changed', 503);
    fs.unlinkSync(file); this.#ready = false;
  }
  #location(kind: 'handoffs' | 'operations' | 'deliveries', id: string): string {
    if (!this.#ready) feedbackFail('feedback_store_closed', 503);
    for (const directory of [this.root, path.join(this.root, kind)]) { const s = fs.lstatSync(directory); if (!s.isDirectory() || s.isSymbolicLink()) feedbackFail('unsafe_feedback_storage', 503); }
    return path.join(this.root, kind, feedbackId(id) + '.json');
  }
  #read<T>(kind: 'handoffs' | 'operations' | 'deliveries', id: string): T | null {
    const file = this.#location(kind, id);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) feedbackFail('feedback_record_corrupt', 503);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const initial = fs.fstatSync(fd); if (initial.ino !== stat.ino || initial.dev !== stat.dev || initial.nlink !== 1 || !initial.isFile()) feedbackFail('feedback_record_corrupt', 503);
      bytes = fs.readFileSync(fd); const final = fs.fstatSync(fd), current = fs.lstatSync(file);
      if (final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs || current.ino !== initial.ino || current.dev !== initial.dev || current.nlink !== 1) feedbackFail('feedback_record_corrupt', 503);
    } finally { fs.closeSync(fd); }
    let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { return feedbackFail('feedback_record_corrupt', 503); }
    if (!feedbackObject(value) || value.schemaVersion !== 1 || value.kind !== kind || value.id !== id || !feedbackObject(value.record) || value.record.schemaVersion !== 1 || value.recordHash !== feedbackHash(value.record)) feedbackFail('feedback_record_corrupt', 503);
    return structuredClone(value.record) as T;
  }
  #write(kind: 'handoffs' | 'operations' | 'deliveries', id: string, record: object): void {
    const file = this.#location(kind, id), previous = this.#read<Record<string, unknown>>(kind, id);
    if (previous) {
      if (kind === 'deliveries' || kind === 'operations' && previous.phase === 'completed') {
        if (feedbackCanonical(previous) !== feedbackCanonical(record)) feedbackFail('operation_conflict', 409);
        return;
      }
      if (kind === 'handoffs') {
        const next = record as FeedbackHandoff, before = previous as unknown as FeedbackHandoff;
        if (feedbackHash({ ...before, target: { ...before.target, state: 'planned' } }) !== feedbackHash({ ...next, target: { ...next.target, state: 'planned' } }) || before.target.state === 'confirmed' && next.target.state !== 'confirmed') feedbackFail('operation_conflict', 409);
      }
    }
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, kind, id, recordHash: feedbackHash(record), record }, null, 2) + '\n');
    if (bytes.length > 2 * 1024 * 1024) feedbackFail('feedback_record_too_large', 413);
    const temporary = file + '.' + randomUUID() + '.tmp', fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      if (previous) fs.renameSync(temporary, file);
      else { fs.linkSync(temporary, file); fs.unlinkSync(temporary); }
      const directory = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  getOperation(id: string): FeedbackOperation | null { return this.#read('operations', id); }
  #list<T>(kind: 'handoffs' | 'operations'): T[] {
    this.#location(kind, '00000000-0000-0000-0000-000000000000');
    const records: T[] = [];
    for (const name of fs.readdirSync(path.join(this.root, kind))) {
      // Known uncommitted temporary writes are retained for inspection, never
      // promoted into records or replayed during reads.
      if (/^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) feedbackFail('feedback_record_corrupt', 503);
      const record = this.#read<T>(kind, name.slice(0, -5)); if (record) records.push(record);
    }
    return records;
  }
  listForBoardTask(boardTaskId: string): { handoffs: FeedbackHandoff[]; operations: FeedbackOperation[] } {
    feedbackId(boardTaskId);
    const handoffs = this.#list<FeedbackHandoff>('handoffs').filter(handoff => handoff.boardTaskId === boardTaskId);
    const operations = this.#list<FeedbackOperation>('operations').filter(operation => handoffs.some(handoff => handoff.handoffId === operation.handoffId) || operation.kind === 'handoff' && (operation.request.handoff as FeedbackHandoff | undefined)?.boardTaskId === boardTaskId);
    return { handoffs, operations };
  }
  saveOperation(record: FeedbackOperation): void { this.#write('operations', feedbackId(record.operationId), record); }
  getHandoff(id: string): FeedbackHandoff | null { return this.#read('handoffs', id); }
  saveHandoff(record: FeedbackHandoff): void { this.#write('handoffs', feedbackId(record.handoffId), record); }
  getDelivery(id: string): FeedbackDelivery | null { return this.#read('deliveries', id); }
  recordDelivery(record: FeedbackDelivery): void { this.#write('deliveries', feedbackId(record.deliveryId), record); }
}

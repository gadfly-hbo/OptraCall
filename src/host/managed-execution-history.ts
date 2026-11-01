import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { AutomaticObservation, AutomaticOwner } from './automatic-verification-types.ts';

export type ManagedExecutionHistory = { state: 'fresh' | 'closed' | 'open' | 'unknown'; reason?: string; sessionId?: string; firstRequestId?: string; active?: { executionId: string; scopeId: string; profile: 'ordinary' | 'protected' } };
export type ManagedExecutionHistoryInput = AutomaticOwner & { sessionDirectory: string; sessionFile?: string; cwd: string; trustedOwner: boolean; allowFresh: boolean; readObservation(requestId: string): Promise<AutomaticObservation | undefined> };

/** Only durable SDK execution receipts can establish a clean managed history. */
export async function readManagedExecutionHistory(input: ManagedExecutionHistoryInput): Promise<ManagedExecutionHistory> {
  const unknown = (reason = 'managed_history_unproven'): ManagedExecutionHistory => ({ state: 'unknown', reason });
  const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
  const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  try {
    // A receipt's JSON shape is not a trust anchor: old unrestricted tools
    // could write it. The Host must prove this owner was created here and has
    // never constructed an unmanaged resource. Restart alone cannot do that.
    if (!input.trustedOwner || !path.isAbsolute(input.sessionDirectory) || !path.isAbsolute(input.cwd)) return unknown('managed_origin_unproven');
    let directory;
    try { directory = await lstat(input.sessionDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !input.sessionFile && input.allowFresh) return { state: 'fresh' }; throw error; }
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o022) !== 0 || typeof process.getuid === 'function' && directory.uid !== process.getuid()) return unknown();
    // No unaccounted sibling history may hide an older unmanaged worker.
    const entries = await readdir(input.sessionDirectory);
    if (!input.sessionFile) return input.allowFresh && entries.length === 0 ? { state: 'fresh' } : unknown();
    if (path.dirname(input.sessionFile) !== input.sessionDirectory) return unknown();
    if (entries.includes('.protected-tmp')) {
      const temp = await lstat(path.join(input.sessionDirectory, '.protected-tmp'));
      if (!temp.isDirectory() || temp.isSymbolicLink() || (temp.mode & 0o022) !== 0 || typeof process.getuid === 'function' && temp.uid !== process.getuid()) return unknown('managed_unsafe_history');
    }
    const histories = entries.filter(name => name !== '.protected-tmp');
    if (histories.length !== 1 || histories[0] !== path.basename(input.sessionFile) || !input.sessionFile.endsWith('.jsonl')) return unknown();
    // Ancestor authority comes from the validated ProjectStore task owner;
    // platform-owned aliases such as macOS /var are not task history aliases.
    const before = await lstat(input.sessionFile);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o022) !== 0 || typeof process.getuid === 'function' && before.uid !== process.getuid()) return unknown('managed_unsafe_history');
    const fd = await open(input.sessionFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const opened = await fd.stat(); bytes = await fd.readFile(); const after = await fd.stat(), named = await lstat(input.sessionFile);
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || named.ino !== after.ino || named.dev !== after.dev || named.nlink !== 1 || named.isSymbolicLink()) return unknown('managed_history_changing');
    } finally { await fd.close(); }
    if (!bytes.length || bytes.at(-1) !== 10) return unknown();
    const records = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd().split('\n').map(line => JSON.parse(line));
    const header = records.shift();
    if (!header || header.type !== 'session' || header.version !== 3 || !uuid(header.id) || header.cwd !== input.cwd || header.parentSession !== undefined || header.parentSessionId !== undefined) return unknown();
    const seen = new Set<string>(); let active: ManagedExecutionHistory['active'], openedAt: string | undefined, firstOpenedAt: string | undefined, firstRequestId: string | undefined;
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return unknown();
      if (record.type === 'custom' && record.customType === 'optracall.execution') {
        const d = record.data;
        if (!d || d.version !== 1 || !['opened', 'closed'].includes(d.phase) || !uuid(d.executionId) || d.sessionId !== header.id || typeof d.scopeId !== 'string' || !d.scopeId || !['ordinary', 'protected'].includes(d.profile) || !iso(d.at)) return unknown();
        if (d.phase === 'opened') {
          if (active || seen.has(d.executionId) || !firstOpenedAt && d.profile !== 'ordinary') return unknown();
          active = { executionId: d.executionId, scopeId: d.scopeId, profile: d.profile }; openedAt = d.at; firstOpenedAt ??= d.at; seen.add(d.executionId);
        } else {
          if (!active || active.executionId !== d.executionId || active.scopeId !== d.scopeId || active.profile !== d.profile || Date.parse(d.at) < Date.parse(openedAt!)) return unknown();
          active = undefined; openedAt = undefined;
        }
      } else if (record.type === 'message' || record.type === 'custom' && record.customType === 'optracall.run') {
        if (!active) return unknown();
        if (record.type === 'custom') {
          const d = record.data;
          if (!d || d.sessionId !== header.id || !uuid(d.requestId) || !['started', 'settled'].includes(d.phase)) return unknown();
          if (!firstRequestId && d.phase === 'started') firstRequestId = d.requestId;
        }
      }
    }
    if (!firstRequestId || !firstOpenedAt) return unknown();
    const origin = await input.readObservation(firstRequestId);
    if (!origin || origin.projectId !== input.projectId || origin.taskId !== input.taskId || origin.requestId !== firstRequestId || origin.native !== undefined || !iso(origin.admittedAt) || Date.parse(origin.admittedAt) > Date.parse(firstOpenedAt)) return unknown('managed_origin_unproven');
    if (origin.completedNative) {
      const n = origin.completedNative;
      if (n.sessionId !== header.id || n.sessionFile !== input.sessionFile || n.bytes > bytes.length || createHash('sha256').update(bytes.subarray(0, n.bytes)).digest('hex') !== n.sha256) return unknown('managed_origin_unproven');
    }
    return { state: active ? 'open' : 'closed', sessionId: header.id, firstRequestId, ...(active ? { active } : {}) };
  } catch { return unknown('managed_history_unreadable'); }
}

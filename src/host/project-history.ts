import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '../agent/sdk.ts';
import { readNativeSessionSnapshot, type NativeSnapshotReadBudget } from './native-session-snapshot.ts';
import type { ProjectSnapshot } from '../agent/project-runtime.ts';
import { readRunDiagnostic } from '../agent/run-diagnostics.ts';
import type { ProjectRecord, TaskRecord } from './project-store.ts';
import { presentContextMessages } from '../agent/context-presentation.ts';

export class ProjectHistoryError extends Error {
  readonly code: string;
  readonly status = 409;
  constructor(code: string) { super(code); this.code = code; }
}

/** Read Pi's existing ledger without starting a worker or choosing a new run. */
export async function savedTaskHistory(project: ProjectRecord, task: TaskRecord, sdkVersion: string, capabilities: Record<string, unknown> = {}): Promise<ProjectSnapshot> {
  let manager;
  try { manager = task.sessionFile ? (await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'))).manager : SessionManager.inMemory(path.join(project.rootPath, '020_clean')); }
  catch { throw new ProjectHistoryError('session_history_unavailable'); }
  let lastRun: ProjectSnapshot['lastRun'], activeRequestId: string | undefined;
  let providedContext: Record<string, unknown> | undefined;
  for (const entry of manager.getEntries()) {
    if (entry.type !== 'custom' || entry.customType !== 'optracall.run') continue;
    const data = entry.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.requestId !== 'string' || !data.requestId.trim()) continue;
    // Fork exports may contain their parent's markers. Legacy records did not
    // name a session, so retain their read compatibility without rewriting them.
    if (data.sessionId !== undefined && data.sessionId !== manager.getSessionId()) continue;
    if (data.phase === 'started' || data.phase === undefined) {
      const supplied = data.providedContext;
      providedContext = supplied && typeof supplied === 'object' && !Array.isArray(supplied) && (supplied as Record<string, unknown>).version === 1 ? supplied as Record<string, unknown> : undefined;
      activeRequestId = data.requestId; lastRun = { requestId: data.requestId }; continue;
    }
    if (data.phase !== 'settled' || typeof data.outcome !== 'string' || !['completed', 'cancelled', 'failed'].includes(data.outcome) || (activeRequestId !== undefined && activeRequestId !== data.requestId)) continue;
    const outcome = data.outcome as 'completed' | 'cancelled' | 'failed', diagnostic = readRunDiagnostic(data.diagnostic, outcome);
    lastRun = { requestId: data.requestId, outcome, ...(diagnostic ? { diagnostic } : {}) };
  }
  return { sessionId: task.sessionFile ? manager.getSessionId() : task.id, sessionFile: task.sessionFile, messages: presentContextMessages(manager.buildSessionContext().messages, manager.getBranch(), manager.getSessionId()) as Record<string, any>[], tools: [], status: 'idle', sdkVersion, capabilities: { ...capabilities, ...(providedContext ? { semanticContext: providedContext } : {}) }, ...(lastRun ? { lastRun } : {}) };
}

/** Resolve an explicitly selected reply from this task's native ledger, never client text. */
export async function readSavedTaskReply(project: ProjectRecord, task: TaskRecord, selection: { sessionId: string; messageId: string }, options: { signal?: AbortSignal; budget?: NativeSnapshotReadBudget } = {}): Promise<{ text: string; sessionId: string; messageId: string }> {
  options.signal?.throwIfAborted();
  if (typeof selection.sessionId !== 'string' || !selection.sessionId || typeof selection.messageId !== 'string' || !selection.messageId || selection.messageId.length > 200) throw new ProjectHistoryError('reply_not_found');
  let reply: { text: string; sessionId: string; messageId: string } | undefined;
  const files = (await readdir(task.sessionDirectory)).filter(name => name.endsWith('.jsonl'));
  if (files.length > 20) throw new ProjectHistoryError('session_history_budget_exceeded');
  let remainingBytes = 50 * 1024 * 1024;
  for (const name of files) {
    options.signal?.throwIfAborted();
    const file = path.join(task.sessionDirectory, name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new ProjectHistoryError('session_history_unavailable');
    if (stat.size > remainingBytes) throw new ProjectHistoryError('session_history_budget_exceeded');
    const budget = remainingBytes; remainingBytes -= stat.size;
    let snapshot;
    try { snapshot = await readNativeSessionSnapshot(file, task.sessionDirectory, path.join(project.rootPath, '020_clean'), Math.min(budget, stat.size), options); } catch (error) { options.signal?.throwIfAborted(); if (options.budget && error && typeof error === 'object' && 'code' in error && String(error.code).startsWith('native_snapshot_')) throw error; throw new ProjectHistoryError('session_history_unavailable'); }
    options.signal?.throwIfAborted();
    const manager = snapshot.manager;
    if (manager.getSessionId() !== selection.sessionId) continue;
    const entry = manager.getEntries().find(entry => entry.id === selection.messageId);
    if (!entry || entry.type !== 'message' || entry.message.role !== 'assistant') continue;
    const content = entry.message.content;
    const text = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
    if (!text.trim()) throw new ProjectHistoryError('reply_not_found');
    if (reply) throw new ProjectHistoryError('session_history_unavailable');
    reply = {text,sessionId:selection.sessionId,messageId:selection.messageId};
  }
  options.signal?.throwIfAborted();
  if (!reply) throw new ProjectHistoryError('reply_not_found');
  return reply;
}

/** Read an exact existing native entry for provenance, without opening an Agent or replaying it. */
export async function readSavedTaskEntry(project: ProjectRecord, task: TaskRecord, selection: { sessionId: string; entryId: string }): Promise<void> {
  if (typeof selection.sessionId !== 'string' || !selection.sessionId || typeof selection.entryId !== 'string' || !selection.entryId || selection.entryId.length > 200) throw new ProjectHistoryError('reply_not_found');
  let found = false;
  const files = (await readdir(task.sessionDirectory)).filter(name => name.endsWith('.jsonl'));
  if (files.length > 20) throw new ProjectHistoryError('session_history_budget_exceeded');
  let remainingBytes = 50 * 1024 * 1024;
  for (const name of files) {
    const file = path.join(task.sessionDirectory, name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new ProjectHistoryError('session_history_unavailable');
    if (stat.size > remainingBytes) throw new ProjectHistoryError('session_history_budget_exceeded');
    const budget = remainingBytes; remainingBytes -= stat.size;
    let snapshot;
    try { snapshot = await readNativeSessionSnapshot(file, task.sessionDirectory, path.join(project.rootPath, '020_clean'), Math.min(budget, stat.size)); } catch { throw new ProjectHistoryError('session_history_unavailable'); }
    const manager = snapshot.manager;
    if (manager.getSessionId() !== selection.sessionId || !manager.getEntries().some(entry => entry.id === selection.entryId)) continue;
    if (found) throw new ProjectHistoryError('session_history_unavailable');
    found = true;
  }
  if (!found) throw new ProjectHistoryError('reply_not_found');
}

/** Lazy read projection of native records; never opens a worker or backfills a receipt. */
export async function taskContextReceipts(project: ProjectRecord, task: TaskRecord) {
  if (!task.sessionFile) return [];
  let manager;
  try { manager = (await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'))).manager; }
  catch { throw new ProjectHistoryError('session_history_unavailable'); }
  const receipts = new Map<string, { requestId: string; sessionId?: string; providedAt?: string; providedContext?: Record<string, unknown> }>();
  for (const entry of manager.getEntries()) {
    if (entry.type !== 'custom' || entry.customType !== 'optracall.run') continue;
    const data = entry.data as Record<string, unknown> | undefined;
    if (!data || typeof data.requestId !== 'string' || !data.requestId.trim() || (data.phase !== 'started' && data.phase !== undefined) ||
      (data.sessionId !== undefined && data.sessionId !== manager.getSessionId())) continue;
    const raw = data.providedContext;
    const context = raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).version === 1 ? raw as Record<string, unknown> : undefined;
    receipts.set(data.requestId, { requestId: data.requestId, ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
      ...(context ? { providedContext: context, ...(typeof context.providedAt === 'string' ? { providedAt: context.providedAt } : {}) } : {}) });
  }
  return [...receipts.values()];
}

export async function priorTaskRequest(project: ProjectRecord, task: TaskRecord, requestId: string, fingerprint?: string): Promise<string | undefined> {
  // The task-local native started marker owns accepted identity, including forks.
  let previous: string | undefined = task.lastRun?.id === requestId ? task.lastRun.status : undefined;
  let identityMatched = false;
  const files = (await readdir(task.sessionDirectory)).filter(file => file.endsWith('.jsonl'));
  if (files.length > 20) throw new ProjectHistoryError('session_history_budget_exceeded');
  let remainingBytes = 50 * 1024 * 1024;
  for (const file of files) {
    const target = path.join(task.sessionDirectory, file), entry = await lstat(target);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new ProjectHistoryError('session_history_unavailable');
    if (entry.size > remainingBytes) throw new ProjectHistoryError('session_history_budget_exceeded');
    remainingBytes -= entry.size;
    let manager;
    try { manager = (await readNativeSessionSnapshot(target, task.sessionDirectory, path.join(project.rootPath, '020_clean'), entry.size)).manager; }
    catch { throw new ProjectHistoryError('session_history_unavailable'); }
    for (const marker of manager.getEntries()) {
      if (marker.type !== 'custom' || marker.customType !== 'optracall.run') continue;
      const data = marker.data as { requestId?: string; phase?: string; outcome?: string; requestFingerprint?: unknown } | undefined;
      if (data?.requestId !== requestId) continue;
      if (data.phase === 'started') {
        if (data.requestFingerprint !== undefined) {
          if (typeof data.requestFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.requestFingerprint)) throw new ProjectHistoryError('session_history_unavailable');
          if (data.requestFingerprint !== fingerprint) throw new ProjectHistoryError('operation_conflict');
          identityMatched = true;
        } else if (fingerprint !== undefined) throw new ProjectHistoryError('operation_conflict');
      }
      if (data.phase === 'settled' && ['completed', 'cancelled', 'failed'].includes(data.outcome ?? '')) previous = data.outcome;
      else if (!previous && data.phase === 'started') previous = 'interrupted';
    }
  }
  if (previous !== undefined && fingerprint !== undefined && !identityMatched) throw new ProjectHistoryError('operation_conflict');
  return previous;
}

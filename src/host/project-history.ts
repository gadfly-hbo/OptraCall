import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '../agent/sdk.ts';
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
export function savedTaskHistory(project: ProjectRecord, task: TaskRecord, sdkVersion: string, capabilities: Record<string, unknown> = {}): ProjectSnapshot {
  const manager = task.sessionFile ? SessionManager.open(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean')) : SessionManager.inMemory(path.join(project.rootPath, '020_clean'));
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
  return { sessionId: task.sessionFile ? manager.getSessionId() : task.id, sessionFile: task.sessionFile, messages: presentContextMessages(manager.buildSessionContext().messages, manager.getEntries()) as Record<string, any>[], tools: [], status: 'idle', sdkVersion, capabilities: { ...capabilities, ...(providedContext ? { semanticContext: providedContext } : {}) }, ...(lastRun ? { lastRun } : {}) };
}

/** Lazy read projection of native records; never opens a worker or backfills a receipt. */
export function taskContextReceipts(project: ProjectRecord, task: TaskRecord) {
  if (!task.sessionFile) return [];
  const manager = SessionManager.open(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
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
  for (const file of await readdir(task.sessionDirectory)) {
    if (!file.endsWith('.jsonl')) continue;
    const target = path.join(task.sessionDirectory, file), entry = await lstat(target);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new ProjectHistoryError('session_history_unavailable');
    const manager = SessionManager.open(target, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
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

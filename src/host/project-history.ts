import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '../agent/sdk.ts';
import type { ProjectSnapshot } from '../agent/project-runtime.ts';
import type { ProjectRecord, TaskRecord } from './project-store.ts';

export class ProjectHistoryError extends Error {
  readonly code: string;
  readonly status = 409;
  constructor(code: string) { super(code); this.code = code; }
}

/** Read Pi's existing ledger without starting a worker or choosing a new run. */
export function savedTaskHistory(project: ProjectRecord, task: TaskRecord, sdkVersion: string, capabilities: Record<string, unknown> = {}): ProjectSnapshot {
  const manager = task.sessionFile ? SessionManager.open(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean')) : SessionManager.inMemory(path.join(project.rootPath, '020_clean'));
  const last: any = manager.getEntries().filter((entry: any) => entry.type === 'custom' && entry.customType === 'optracall.run').at(-1);
  return { sessionId: task.sessionFile ? manager.getSessionId() : task.id, sessionFile: task.sessionFile, messages: manager.buildSessionContext().messages as Record<string, any>[], tools: [], status: 'idle', sdkVersion, capabilities, ...(last?.data?.requestId ? { lastRun: { requestId: last.data.requestId, ...(last.data.outcome ? { outcome: last.data.outcome } : {}) } } : {}) };
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

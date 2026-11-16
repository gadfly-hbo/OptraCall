import path from 'node:path';
import { lstat, readdir, realpath } from 'node:fs/promises';
import type { ProjectRecord, TaskRecord } from './project-store.ts';
import type { ProjectTaskResultBinding } from './project-task-results-types.ts';
import { createNativeSnapshotReadBudget, nativeSnapshotLimit, readNativeSessionSnapshot, type NativeSnapshotReadBudget } from './native-session-snapshot.ts';
import { PROJECT_UPLOAD_MAX_BYTES } from './project-upload.ts';

export class ProjectTaskResultSourceError extends Error {
  readonly code: string;
  readonly status = 409;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code = 'project_result_native_unavailable'): never { throw new ProjectTaskResultSourceError(code); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value);
const sourceKey = (source: ProjectTaskResultBinding) => JSON.stringify([source.sessionId, source.requestId, source.toolCallId]);
const sourceValue = (source: ProjectTaskResultBinding) => JSON.stringify([source.projectId, source.taskId, source.sessionId, source.requestId, source.toolCallId, source.relativePath, source.sha256, source.bytes]);
export interface TaskBoundReportsOptions { signal?: AbortSignal; budget?: NativeSnapshotReadBudget; assertCurrent?(): void }

/** Read the existing native ledger without opening a worker, replaying a request, or inspecting report bodies. */
export async function listTaskBoundReports(project: ProjectRecord, task: TaskRecord, options: TaskBoundReportsOptions = {}): Promise<ProjectTaskResultBinding[]> {
  const check = () => { options.signal?.throwIfAborted(); options.assertCurrent?.(); };
  check();
  const member = project.tasks.find(x => x.id === task.id);
  if (!member || path.resolve(member.sessionDirectory) !== path.resolve(task.sessionDirectory)) fail('project_result_native_owner_mismatch');
  let current = path.resolve(task.sessionDirectory);
  for (;;) {
    const entry = await lstat(current); check();
    if (entry.isSymbolicLink() && process.platform === 'darwin' && current === '/var' && await realpath(current) === '/private/var') { current = '/'; continue; }
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail();
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const files = (await readdir(task.sessionDirectory)).filter(name => name.endsWith('.jsonl')).sort(); check();
  if (files.length > 20) fail('project_result_native_budget_exceeded');
  if (task.sessionFile && (path.dirname(path.resolve(task.sessionFile)) !== path.resolve(task.sessionDirectory) || !files.includes(path.basename(task.sessionFile)))) fail();
  const budget = options.budget ?? createNativeSnapshotReadBudget(), results = new Map<string, ProjectTaskResultBinding>();
  let remainingBytes = nativeSnapshotLimit;
  for (const name of files) {
    check(); const file = path.join(task.sessionDirectory, name), stat = await lstat(file); check();
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail();
    if (stat.size > remainingBytes) fail('project_result_native_budget_exceeded');
    remainingBytes -= stat.size;
    let snapshot;
    try { snapshot = await readNativeSessionSnapshot(file, task.sessionDirectory, path.join(project.rootPath, '020_clean'), stat.size, { ...options, budget }); }
    catch (error) { check(); if (error instanceof ProjectTaskResultSourceError) throw error; fail(); }
    check();
    const sessionId = snapshot.manager.getSessionId();
    for (const entry of snapshot.manager.getEntries()) {
      if (entry.type !== 'custom' || entry.customType !== 'optracall.project-report-write') continue;
      const data = entry.data;
      // An exported fork can carry its parent's entries. Those remain parent
      // history and never become proof of a write by the new session/Task.
      if (!object(data) || data.sessionId !== sessionId || data.projectId !== project.id || data.taskId !== task.id) continue;
      if (data.schemaVersion !== 1 || data.type !== 'optracall.project-report-write' || !text(data.requestId) || !text(data.toolCallId) || typeof data.relativePath !== 'string' || data.relativePath.length > 1000 || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256) || !Number.isSafeInteger(data.bytes) || Number(data.bytes) < 0 || Number(data.bytes) > PROJECT_UPLOAD_MAX_BYTES) fail('project_result_native_binding_invalid');
      const parts = data.relativePath.split('/');
      if (parts.length < 2 || parts[0] !== '060_reports' || parts.some(part => !part || part.startsWith('.') || /[\\\u0000-\u001f\u007f]/u.test(part)) || data.path !== path.join(project.rootPath, ...parts) || data.filename !== undefined && data.filename !== parts.at(-1)) fail('project_result_native_binding_invalid');
      const value: ProjectTaskResultBinding = { projectId: project.id, taskId: task.id, sessionId, requestId: data.requestId, toolCallId: data.toolCallId, relativePath: data.relativePath, sha256: data.sha256, bytes: Number(data.bytes), nativeEntryId: entry.id };
      const previous = results.get(sourceKey(value));
      if (previous && sourceValue(previous) !== sourceValue(value)) fail('project_result_native_binding_conflict');
      if (!previous) results.set(sourceKey(value), value);
    }
  }
  check(); return [...results.values()];
}

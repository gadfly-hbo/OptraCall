import type { ProjectRecord, TaskRecord } from './project-store.ts';
import path from 'node:path';
import { createNativeSnapshotReadBudget, readNativeSessionSnapshot } from './native-session-snapshot.ts';
import { listTaskResultSources, type ResultSessionSnapshot } from './project-task-result-sources.ts';
import { createHash } from 'node:crypto';

type Node = { id: string; type: string; parentId: string | null; fromId?: string };
const deny = (): never => { throw new Error('project_result_lineage_unavailable'); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function projectResultAncestors<T extends Node>(entries: readonly T[], leaf: string, limit = 32768): T[] {
  const byId = new Map(entries.map(row => [row.id, row]));
  const output: T[] = [], visited = new Set<string>(), active = new Set<string>();
  const stack: { id: string; leave?: boolean }[] = [{ id: leaf }];
  while (stack.length) {
    const { id, leave } = stack.pop()!;
    if (leave) { active.delete(id); continue; }
    if (active.has(id)) deny();
    if (visited.has(id)) continue;
    const entry = byId.get(id);
    if (!entry || visited.size >= limit) return deny();
    visited.add(id); active.add(id); output.push(entry);
    stack.push({ id, leave: true });
    if (entry.parentId) stack.push({ id: entry.parentId });
    if (entry.type === 'branch_summary') {
      if (!entry.fromId) return deny();
      stack.push({ id: entry.fromId });
    }
  }
  return output;
}
export type TaskLineageCheck = {
  current(): void;
  run(project: ProjectRecord, task: TaskRecord, requestId: string, provided: Record<string, unknown>): Promise<void>;
  tool(project: ProjectRecord, task: TaskRecord, name: string, details: unknown, origin?: { requestId: string; sessionId: string; toolCallId: string }): Promise<void>;
  report(project: ProjectRecord, path: string, sha256: string, bytes: number): Promise<void>;
  teachProject(id: string, from: TaskRecord): Promise<ProjectRecord>;
  signal?: AbortSignal;
};

export async function hasReceivedTaskResults(project: ProjectRecord, task: TaskRecord) {
  if (!task.sessionFile) return false;
  const snapshot = await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  const leaf = snapshot.manager.getLeafId();
  return !!leaf && projectResultAncestors(snapshot.entries, leaf).some(entry =>
    entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'read_project_task_results' && !entry.message.isError ||
    entry.type === 'custom' && entry.customType === 'optracall.run' && record(entry.data) && record(entry.data.providedContext) && !!entry.data.providedContext.teachSourceRights);
}

/** A fresh traversal for one receiver/outlet. Nothing is stored with a source or reused as a grant. */
export async function verifyTaskResultLineage(project: ProjectRecord, target: Record<string, unknown>, checks: TaskLineageCheck) {
  const budget = createNativeSnapshotReadBudget(), seen = new Set<string>(), active = new Set<string>();
  const snapshots = new Map<string, { task: TaskRecord; sessions: Map<string, ResultSessionSnapshot>; sources: Awaited<ReturnType<typeof listTaskResultSources>> }>();
  let remaining = 32768, edges = 0;
  const used = new Map<string, { snapshot: ResultSessionSnapshot; directory: string; cwd: string }>();
  const check = () => { checks.signal?.throwIfAborted(); checks.current(); };
  async function visit(ref: Record<string, unknown>, project: ProjectRecord) {
    check();
    if (ref.projectId !== project.id || typeof ref.taskId !== 'string' || project.archivedAt) return deny();
    const task = project.tasks.find(row => row.id === ref.taskId);
    if (!task || task.archivedAt) return deny();
    if (ref.kind === 'task-history' && !task.sessionFile) return;
    const ownerKey = project.id + '/' + task.id;
    let state = snapshots.get(ownerKey);
    if (!state) {
      const sessions = new Map<string, ResultSessionSnapshot>();
      const sources = await listTaskResultSources(project, task, { signal: checks.signal, budget, assertCurrent: check, onSession: snapshot => {
        const id = snapshot.manager.getSessionId(); if (sessions.has(id)) deny(); sessions.set(id, snapshot);
      } });
      state = { task, sessions, sources }; snapshots.set(ownerKey, state); check();
    }
    const snapshot = ref.kind === 'task-history' ? [...state.sessions.values()].find(s => s.file === task.sessionFile) : state.sessions.get(String(ref.sessionId));
    if (!snapshot) return deny();
    used.set(snapshot.file, { snapshot, directory: task.sessionDirectory, cwd: path.join(project.rootPath, '020_clean') });
    let leaf: string | undefined;
    if (ref.kind === 'task-history') leaf = snapshot.manager.getLeafId() ?? undefined;
    else if (ref.kind === 'task-report' || ref.kind === 'report') {
      const row = state.sources.reports.find(r => r.sessionId === ref.sessionId && r.requestId === ref.requestId && r.toolCallId === ref.toolCallId && r.relativePath === ref.relativePath && r.sha256 === ref.sha256 && r.bytes === ref.bytes);
      if (!row?.nativeEntryId || ref.nativeEntryId && row.nativeEntryId !== ref.nativeEntryId) return deny();
      await checks.report(project, row.relativePath, row.sha256, row.bytes); leaf = row.nativeEntryId;
    } else if (ref.kind === 'task-native-reply' || ref.kind === 'native-reply') {
      const entry = snapshot.entries.find(e => e.id === ref.messageId);
      if (!entry || entry.type !== 'message' || entry.message.role !== 'assistant') return deny();
      const content = entry.message.content;
      const body = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
      if (createHash('sha256').update(body).digest('hex') !== ref.sha256 || ref.bytes !== undefined && ref.bytes !== Buffer.byteLength(body)) return deny();
      if (ref.requestId !== undefined) {
        const original = projectResultAncestors(snapshot.entries, entry.id, remaining).find(e => e.type === 'custom' && e.customType === 'optracall.run' && record(e.data) && e.data.phase === 'started');
        if (!original || original.type !== 'custom' || !record(original.data) || original.data.requestId !== ref.requestId || original.data.sessionId !== ref.sessionId) return deny();
      }
      leaf = entry.id;
    } else return deny();
    if (!leaf) return deny();
    const key = JSON.stringify([project.id, task.id, snapshot.manager.getSessionId(), leaf]);
    if (active.has(key) || ++edges > 256) deny();
    if (seen.has(key)) return;
    active.add(key);
    const entries = projectResultAncestors(snapshot.entries, leaf, remaining); remaining -= entries.length;
    for (const entry of entries) {
      check();
      if (entry.type === 'custom' && entry.customType === 'optracall.run' && record(entry.data) && (entry.data.phase === 'started' || entry.data.phase === undefined)) {
        if (typeof entry.data.requestId !== 'string') return deny();
        const provided = record(entry.data.providedContext) ? entry.data.providedContext : {};
        await checks.run(project, task, entry.data.requestId, provided);
        if (provided.teachSourceRights) {
          if (!Array.isArray(provided.teachSources)) return deny();
          for (const ref of provided.teachSources) {
            if (!record(ref) || typeof ref.projectId !== 'string') return deny();
            const source = ref.projectId === project.id ? project : await checks.teachProject(ref.projectId, task);
            await visit(ref, source);
          }
        }
      } else if (entry.type === 'message' && entry.message.role === 'toolResult' && !entry.message.isError) {
        const { toolName, details } = entry.message;
        if (toolName === 'read_project_task_results') {
          if (!record(details) || details.type !== 'optracall.project-task-results' || !record(details.scope) || details.scope.projectId !== project.id || details.scope.taskId !== task.id) return deny();
          const upstream = details.action === 'read' ? [details.result] : details.action === 'find' && Array.isArray(details.results) ? details.results : undefined;
          if (!upstream) return deny();
          for (const source of upstream) {
            if (!record(source) || typeof source.id !== 'string') return deny();
            await visit(source, project);
          }
        } else {
          if (toolName === 'read_semantic_context' && record(details) && Array.isArray(details.items)) for (const item of details.items) {
            const source = item?.target?.source;
            if (source?.type === 'native-reply' && ['available','partial'].includes(item?.state)) await visit({ ...source, kind: 'task-native-reply', sha256: source.expectedTextSha256 }, project);
          }
          let origin;
          if (toolName === 'db_describe') {
            const run = projectResultAncestors(snapshot.entries, entry.id).find(e => e.type === 'custom' && e.customType === 'optracall.run' && record(e.data) && e.data.phase === 'started');
            if (!run || run.type !== 'custom' || !record(run.data) || typeof run.data.requestId !== 'string' || typeof run.data.sessionId !== 'string') return deny();
            origin = { sessionId: run.data.sessionId, requestId: run.data.requestId, toolCallId: entry.message.toolCallId };
          }
          await checks.tool(project, task, toolName, details, origin);
        }
      }
    }
    active.delete(key); seen.add(key); check();
  }
  await visit(target, project);
  const verificationBudget = createNativeSnapshotReadBudget();
  for (const { snapshot, directory, cwd } of used.values()) {
    check();
    const latest = await readNativeSessionSnapshot(snapshot.file, directory, cwd, undefined, { signal: checks.signal, budget: verificationBudget });
    if (latest.sha256 !== snapshot.sha256) return deny();
  }
  check();
}

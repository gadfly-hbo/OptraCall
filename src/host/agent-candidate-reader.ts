import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentCandidateDetailsSha256, canonicalCandidateJson, candidateToolName, parseAgentCandidateDetails, parseAgentCandidateInput, type AgentCandidateDetails } from '../agent/agent-candidate.ts';
import { readNativeSessionSnapshot, nativeSnapshotLimit, type NativeSnapshotReadBudget } from './native-session-snapshot.ts';
import { candidateOccurrenceKey as candidateRefKey, parseExactCandidateRef as validateCandidateRef, candidateControlState, type AgentCandidateControls, type CandidateControlState, type ExactCandidateRef } from './agent-candidate-controls.ts';
import type { ProjectRecord, ProjectStore, TaskRecord } from './project-store.ts';

export type CandidateParentState = 'completed' | 'running' | 'cancelled' | 'failed' | 'unknown';
export type CandidateRow = {
  ref: ExactCandidateRef | null; details: AgentCandidateDetails | null; status: 'available' | 'unknown' | 'anomaly'; reason: string | null;
  parentState: CandidateParentState; locations: { sessionId: string; entryId: string; savedPath: 'current' | 'other' }[]; control: CandidateControlState | null;
};
export type CandidateLookupInput = { query?: string; includeBody?: boolean; category?: 'all' | 'knowledge' | 'experience'; view?: 'all' | 'bookmarked' | 'excluded' | 'anomalies'; parentState?: 'all' | CandidateParentState; savedPath?: 'all' | 'current' | 'other'; cursor?: string; pageSize?: number };
export type CandidateLookupResult = { rows: CandidateRow[]; issues: { file: string; code: string }[]; nextCursor: string | null; partial: boolean; controlsAvailable: boolean; experienceLearningAvailable?: boolean };
export type CandidateReaderOptions = { signal?: AbortSignal; budget?: NativeSnapshotReadBudget };
export class CandidateReadError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const codeOf = (e: unknown) => e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : 'native_history_unknown';
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
type Location = { project: ProjectRecord; task: TaskRecord; file: string };
type Snapshot = Awaited<ReturnType<typeof readNativeSessionSnapshot>> & Location & { primary: boolean };
const sameRef = (a: ExactCandidateRef, b: ExactCandidateRef) => canonicalCandidateJson(a) === canonicalCandidateJson(b);

/** Bounded on-demand read model. It owns neither sessions nor candidate bodies. */
export function createAgentCandidateReader(options: { projects: Pick<ProjectStore, 'list'>; controls: AgentCandidateControls }) {
  async function locations() {
    const result: Location[] = [], issues: CandidateLookupResult['issues'] = [];
    for (const project of await options.projects.list()) for (const task of project.tasks) {
      try {
        const stat = await fs.lstat(task.sessionDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CandidateReadError('native_directory_unavailable');
        const entries = await fs.readdir(task.sessionDirectory, { withFileTypes: true });
        for (const entry of entries) if (entry.name.endsWith('.jsonl')) result.push({ project, task, file: path.join(task.sessionDirectory, entry.name) });
        if (task.sessionFile && !entries.some(entry => path.join(task.sessionDirectory, entry.name) === task.sessionFile && entry.name.endsWith('.jsonl'))) issues.push({ file: `${project.id}/${task.id}/${path.basename(task.sessionFile)}`, code: 'native_session_file_missing' });
      } catch (e) { issues.push({ file: `${project.id}/${task.id}`, code: codeOf(e) }); }
    }
    result.sort((a, b) => a.file.localeCompare(b.file));
    return { result, issues };
  }
  function validateQuery(input: CandidateLookupInput) {
    if (typeof input.query !== 'undefined' && (typeof input.query !== 'string' || input.query.length > 200) || input.includeBody !== undefined && typeof input.includeBody !== 'boolean' || !['all', 'knowledge', 'experience'].includes(input.category ?? 'all') || !['all', 'bookmarked', 'excluded', 'anomalies'].includes(input.view ?? 'all') || !['all', 'completed', 'running', 'cancelled', 'failed', 'unknown'].includes(input.parentState ?? 'all') || !['all', 'current', 'other'].includes(input.savedPath ?? 'all') || !Number.isSafeInteger(input.pageSize ?? 50) || (input.pageSize ?? 50) < 1 || (input.pageSize ?? 50) > 100) throw new CandidateReadError('invalid_candidate_query', 400);
  }
  async function lookup(input: CandidateLookupInput = {}, exactTarget?: ExactCandidateRef, readOptions: CandidateReaderOptions = {}): Promise<CandidateLookupResult> {
    readOptions.signal?.throwIfAborted();
    validateQuery(input);
    const catalog = await locations(), issues = catalog.issues;
    if (exactTarget) {
      catalog.result = catalog.result.filter(l => l.project.id === exactTarget.projectId && l.task.id === exactTarget.taskId);
      catalog.result.sort((a, b) => Number(b.file.includes(exactTarget.originSessionId)) - Number(a.file.includes(exactTarget.originSessionId)) || a.file.localeCompare(b.file));
    }
    let controlsAvailable = true; let records: Awaited<ReturnType<AgentCandidateControls['getRecords']>> = null;
    try { records = await options.controls.getRecords(); } catch (e) { controlsAvailable = false; issues.push({ file: 'personal-agent-controls/records.json', code: codeOf(e) }); }
    const stamps = await Promise.all(catalog.result.map(async l => { try { const s = await fs.lstat(l.file); return [l.file, s.ino, s.size, s.mtimeMs, s.ctimeMs]; } catch { return [l.file, 'unknown']; } }));
    const signature = createHash('sha256').update(canonicalCandidateJson({ files: stamps, controls: records?.events.map(e => e.operationId) ?? (controlsAvailable ? [] : null), query: input.query ?? '', includeBody: input.includeBody ?? false, category: input.category ?? 'all', view: input.view ?? 'all', parentState: input.parentState ?? 'all', savedPath: input.savedPath ?? 'all' })).digest('hex');
    let offset = 0, skip = 0;
    if (input.cursor !== undefined) {
      try {
        if (typeof input.cursor !== 'string' || input.cursor.length > 1000) throw new Error();
        const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
        if (!object(cursor) || Object.keys(cursor).length !== 3 || cursor.signature !== signature || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0 || Number(cursor.offset) > catalog.result.length || !Number.isSafeInteger(cursor.skip) || Number(cursor.skip) < 0) throw new Error();
        offset = Number(cursor.offset); skip = Number(cursor.skip);
      } catch { throw new CandidateReadError('candidate_cursor_changed', 409); }
    }
    const snapshots: Snapshot[] = []; const loaded = new Map<string, Snapshot>();
    let bytes = 0, visited = 0, nextOffset = offset;
    const load = async (location: Location, primary: boolean): Promise<boolean> => {
      readOptions.signal?.throwIfAborted();
      const prior = loaded.get(location.file);
      if (prior) { prior.primary ||= primary; return true; }
      if (visited >= 20 || readOptions.budget && readOptions.budget.files < 1) return false;
      const stat = await fs.lstat(location.file).catch(() => null);
      if (stat && readOptions.budget && stat.size <= nativeSnapshotLimit && stat.size > readOptions.budget.bytes) return false;
      if (stat && stat.size <= nativeSnapshotLimit && bytes + stat.size > nativeSnapshotLimit) return false;
      visited++;
      try {
        const remaining = nativeSnapshotLimit - bytes, budget = Math.min(remaining, stat?.size ?? 0); if (stat && stat.size <= remaining) bytes += stat.size;
        const snapshot = { ...await readNativeSessionSnapshot(location.file, location.task.sessionDirectory, path.join(location.project.rootPath, '020_clean'), budget, readOptions), ...location, primary };
        snapshots.push(snapshot); loaded.set(location.file, snapshot);
      } catch (e) { readOptions.signal?.throwIfAborted(); issues.push({ file: `${location.project.id}/${location.task.id}/${path.basename(location.file)}`, code: codeOf(e) }); }
      return true;
    };
    for (const location of catalog.result.slice(offset)) {
      if (!await load(location, true)) break;
      nextOffset++;
      const snapshot = loaded.get(location.file);
      // Only an original occurrence emits a row. Also inspect the persisted canonical
      // file within the SAME budget so a current fork in a different page is labelled.
      const hasOriginal = snapshot?.entries.some(e => e.type === 'message' && e.message.role === 'toolResult' && e.message.toolName === candidateToolName && object(e.message.details) && object(e.message.details.origin) && e.message.details.origin.sessionId === snapshot.manager.getSessionId());
      const canonical = hasOriginal && location.task.sessionFile && catalog.result.find(l => l.file === location.task.sessionFile && l.project.id === location.project.id && l.task.id === location.task.id);
      if (canonical && canonical.file !== location.file && !await load(canonical, false)) issues.push({ file: `${location.project.id}/${location.task.id}/${path.basename(canonical.file)}`, code: 'candidate_saved_path_outside_budget' });
    }
    const rows: CandidateRow[] = [], byKey = new Map<string, CandidateRow>();

    const knownRefs = new Map<string, ExactCandidateRef>();
    for (const event of records?.events ?? []) knownRefs.set(candidateRefKey(event.target), event.target);
    const controlFor = async (ref: ExactCandidateRef) => controlsAvailable ? candidateControlState(records, ref) : null;
    for (const snapshot of snapshots) for (const entry of snapshot.entries) {
      if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue;
      const message = entry.message;
      if (message.toolName !== candidateToolName || exactTarget && entry.id !== exactTarget.entryId) continue;
      let ref: ExactCandidateRef | null = null, details: AgentCandidateDetails | null = null;
      let reason: string | null = null;
      try {
        if (message.isError) throw new CandidateReadError('candidate_tool_error');
        details = parseAgentCandidateDetails(message.details);
        if (details.origin.projectId !== snapshot.project.id || details.origin.taskId !== snapshot.task.id || details.origin.toolCallId !== message.toolCallId) throw new CandidateReadError('candidate_owner_mismatch');
        ref = { projectId: details.origin.projectId, taskId: details.origin.taskId, originSessionId: details.origin.sessionId, entryId: entry.id, toolCallId: message.toolCallId, expectedDetailsSha256: agentCandidateDetailsSha256(details) };
        const origins = snapshots.filter(s => s.project.id === snapshot.project.id && s.task.id === snapshot.task.id && s.manager.getSessionId() === details!.origin.sessionId);
        if (snapshot.manager.getSessionId() !== details.origin.sessionId) {
          if (origins.length === 0 && (nextOffset < catalog.result.length || offset > 0)) { issues.push({ file: `${snapshot.project.id}/${snapshot.task.id}/${path.basename(snapshot.file)}`, code: 'candidate_original_outside_batch' }); continue; }
          if (origins.length === 1) continue;
        }
        if (!snapshot.primary) continue;
        if (origins.length !== 1) throw new CandidateReadError('candidate_original_unknown');
        const original = origins[0]!, exact = original.manager.getEntry(entry.id);
        if (!exact || exact.type !== 'message' || exact.message.role !== 'toolResult' || exact.message.toolName !== candidateToolName || exact.message.isError || exact.message.toolCallId !== ref.toolCallId || agentCandidateDetailsSha256(parseAgentCandidateDetails(exact.message.details)) !== ref.expectedDetailsSha256) throw new CandidateReadError('candidate_original_changed');
        const branch = original.manager.getBranch(entry.id);
        const ancestors = branch.slice(0, -1);
        const marker = [...ancestors].reverse().find(e => e.type === 'custom' && e.customType === 'optracall.run');
        if (!marker || marker.type !== 'custom' || !object(marker.data) || marker.data.phase !== 'started' || marker.data.kind !== 'prompt' || marker.data.requestId !== details.origin.requestId || marker.data.sessionId !== details.origin.sessionId) throw new CandidateReadError('candidate_run_mismatch');
        const call = ancestors.slice(ancestors.indexOf(marker) + 1).flatMap(e => e.type === 'message' && e.message.role === 'assistant' && Array.isArray(e.message.content) ? e.message.content : []).filter(p => p.type === 'toolCall' && p.id === ref!.toolCallId && p.name === candidateToolName);
        if (call.length !== 1 || call[0]?.type !== 'toolCall' || canonicalCandidateJson(parseAgentCandidateInput(call[0].arguments)) !== canonicalCandidateJson({ content: details.content, sourceRefs: details.sourceRefs })) throw new CandidateReadError('candidate_tool_call_mismatch');
        const known = knownRefs.get(candidateRefKey(ref));
        if (known && !sameRef(known, ref)) throw new CandidateReadError('candidate_hash_inconsistent');
        const key = candidateRefKey(ref), prior = byKey.get(key);
        const location: CandidateRow['locations'][number] = { sessionId: snapshot.manager.getSessionId(), entryId: entry.id, savedPath: snapshot.task.sessionFile === snapshot.file && snapshot.branchIds.has(entry.id) ? 'current' : 'other' };
        if (prior) {
          if (!prior.ref || !sameRef(prior.ref, ref)) { prior.status = 'anomaly'; prior.reason = 'candidate_hash_inconsistent'; prior.details = null; prior.parentState = 'unknown'; prior.locations = []; }
          else if (prior.status === 'available') prior.locations.push(location);
          continue;
        }
        const settled = [...original.entries].reverse().find(e => e.type === 'custom' && e.customType === 'optracall.run' && object(e.data) && e.data.phase === 'settled' && e.data.requestId === details!.origin.requestId && e.data.sessionId === details!.origin.sessionId);
        let parentState: CandidateParentState = 'unknown';
        if (settled?.type === 'custom' && object(settled.data) && ['completed', 'cancelled', 'failed'].includes(String(settled.data.outcome))) parentState = settled.data.outcome as CandidateParentState;
        else if (snapshot.task.lastRun?.id === details.origin.requestId && snapshot.task.lastRun.status === 'running') parentState = 'running';
        const copies: CandidateRow['locations'] = [location]; let copyConflict = false;
        for (const copy of snapshots) {
          if (copy === original || copy.project.id !== original.project.id || copy.task.id !== original.task.id) continue;
          const copied = copy.manager.getEntry(entry.id);
          if (!copied || copied.type !== 'message' || copied.message.role !== 'toolResult' || copied.message.toolName !== candidateToolName) continue;
          try {
            const copiedDetails = parseAgentCandidateDetails(copied.message.details);
            if (copiedDetails.origin.sessionId !== ref.originSessionId || copiedDetails.origin.toolCallId !== ref.toolCallId) continue;
            if (copied.message.isError || copied.message.toolCallId !== ref.toolCallId || agentCandidateDetailsSha256(copiedDetails) !== ref.expectedDetailsSha256) throw new CandidateReadError('candidate_copy_changed');
            copies.push({ sessionId: copy.manager.getSessionId(), entryId: entry.id, savedPath: copy.task.sessionFile === copy.file && copy.branchIds.has(entry.id) ? 'current' : 'other' });
          } catch (e) { copyConflict = true; issues.push({ file: `${copy.project.id}/${copy.task.id}/${path.basename(copy.file)}`, code: codeOf(e) }); }
        }
        const row: CandidateRow = { ref, details: copyConflict ? null : details, status: copyConflict ? 'unknown' : 'available', reason: copyConflict ? 'candidate_copy_changed' : null, parentState: copyConflict ? 'unknown' : parentState, locations: copyConflict ? [] : copies, control: await controlFor(ref) };
        byKey.set(key, row); rows.push(row);
      } catch (e) { reason = codeOf(e); rows.push({ ref, details: null, status: 'anomaly', reason, parentState: 'unknown', locations: [], control: null }); }
    }
    // A known exact governance reference survives source loss; it is not a cached candidate body.
    if (offset === 0) for (const ref of knownRefs.values()) if (!byKey.has(candidateRefKey(ref))) rows.push({ ref, details: null, status: 'unknown', reason: 'candidate_source_unknown', parentState: 'unknown', locations: [], control: await controlFor(ref) });
    const query = (input.query ?? '').trim().toLocaleLowerCase();
    const selected = rows.filter(row => {
      const excluded = row.control?.excluded ?? false;
      if (!controlsAvailable && input.view !== 'anomalies' && !exactTarget) return false;
      if (exactTarget) return row.status !== 'anomaly' && Boolean(row.ref && sameRef(row.ref, exactTarget));
      if (input.view === 'anomalies') { if (row.status !== 'anomaly') return false; }
      else if (row.status === 'anomaly') return false;
      else if (input.view === 'excluded' ? !excluded : excluded) return false;
      if (input.view === 'bookmarked' && !row.control?.bookmarked) return false;
      if (input.category && input.category !== 'all' && row.details?.content.kind !== input.category) return false;
      if (input.parentState && input.parentState !== 'all' && row.parentState !== input.parentState) return false;
      if (input.savedPath && input.savedPath !== 'all' && !row.locations.some(l => l.savedPath === input.savedPath)) return false;
      if (query) { if (!row.details) return false; const c = row.details.content; if (![c.title, ...c.aliases, c.scope ?? '', ...(input.includeBody ? [c.bodyMd] : [])].some(text => text.toLocaleLowerCase().includes(query))) return false; }
      return true;
    }).sort((a, b) => (b.details?.createdAt ?? '').localeCompare(a.details?.createdAt ?? '') || (a.ref ? candidateRefKey(a.ref) : a.reason ?? '').localeCompare(b.ref ? candidateRefKey(b.ref) : b.reason ?? ''));
    const size = input.pageSize ?? 50, page = selected.slice(skip, skip + size);
    const cursor = skip + size < selected.length ? { signature, offset, skip: skip + size } : nextOffset < catalog.result.length ? { signature, offset: nextOffset, skip: 0 } : null;
    readOptions.signal?.throwIfAborted();
    return { rows: page, issues, nextCursor: cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null, partial: issues.length > 0 || Boolean(cursor), controlsAvailable };
  }
  async function read(refValue: ExactCandidateRef, readOptions: CandidateReaderOptions = {}): Promise<CandidateRow> {
    const ref = validateCandidateRef(refValue);
    const result = await lookup({ pageSize: 100 }, ref, readOptions);
    const row = result.rows.find(row => row.ref && sameRef(row.ref, ref) && row.status !== 'anomaly');
    if (row) return row;
    throw new CandidateReadError('candidate_source_unknown');
  }
  return { lookup, read };
}

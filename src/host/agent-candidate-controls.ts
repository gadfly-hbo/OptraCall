export type ExactCandidateRef = {
  projectId: string; taskId: string; originSessionId: string; entryId: string; toolCallId: string; expectedDetailsSha256: string;
};
export type CandidateControlAction = 'bookmark' | 'unbookmark' | 'correct' | 'exclude' | 'restore';
export type CandidateControlInput = { operationId: string; target: ExactCandidateRef } & (
  | { action: 'correct'; note: string; expectedTargetRevision?: never }
  | { action: Exclude<CandidateControlAction, 'correct'>; note: null; expectedTargetRevision: number }
);
export type CandidateControlEvent = { operationId: string; target: ExactCandidateRef; action: CandidateControlAction; note: string | null; createdAt: string; targetRevision: number };
export type CandidateControlRecords = { schemaVersion: 1; storeId: string; events: CandidateControlEvent[] };
export type CandidateControlState = { target: ExactCandidateRef; targetRevision: number; bookmarked: boolean; excluded: boolean; notes: CandidateControlEvent[] };
export type CandidateControlReceipt = { storeId: string; event: CandidateControlEvent; state: CandidateControlState; replayed: boolean };
export class CandidateControlError extends Error {
  readonly code: string; readonly status: number; readonly currentState?: CandidateControlState;
  constructor(code: string, status = 400, currentState?: CandidateControlState) { super(code); this.code = code; this.status = status; this.currentState = currentState; }
}
const limit = 2 * 1024 * 1024;
const fileGates = new Map<string, Promise<void>>();
const fail = (code: string, status = 400): never => { throw new CandidateControlError(code, status); };
const keys = (value: Record<string, unknown>, names: string[]) => {
  if (Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail('invalid_candidate_control_fields');
};
const uuid = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value) ? value : fail('invalid_candidate_control_id');
const identifier = (value: unknown): string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value) ? value : fail('invalid_candidate_control_target');
export function parseExactCandidateRef(value: unknown): ExactCandidateRef {
  if (!object(value)) return fail('invalid_candidate_control_target');
  keys(value, ['projectId', 'taskId', 'originSessionId', 'entryId', 'toolCallId', 'expectedDetailsSha256']);
  if (typeof value.expectedDetailsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedDetailsSha256)) return fail('invalid_candidate_control_hash');
  return { projectId: identifier(value.projectId), taskId: identifier(value.taskId), originSessionId: identifier(value.originSessionId), entryId: identifier(value.entryId), toolCallId: identifier(value.toolCallId), expectedDetailsSha256: value.expectedDetailsSha256 };
}
/** Occurrence identity excludes the content hash, so changed bytes cannot silently rebind a control. */
export const candidateOccurrenceKey = (target: ExactCandidateRef): string => JSON.stringify([target.projectId, target.taskId, target.originSessionId, target.entryId, target.toolCallId]);
export const sameCandidateRef = (left: ExactCandidateRef, right: ExactCandidateRef): boolean => candidateOccurrenceKey(left) === candidateOccurrenceKey(right) && left.expectedDetailsSha256 === right.expectedDetailsSha256;
const revision = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail('invalid_candidate_control_revision');
const noteText = (value: unknown): string => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000 && !value.includes('\0') ? value : fail('invalid_candidate_control_note');
export function parseCandidateControlInput(value: unknown): CandidateControlInput {
  if (!object(value)) return fail('invalid_candidate_control_request');
  const target = parseExactCandidateRef(value.target), operationId = uuid(value.operationId);
  if (value.action === 'correct') {
    keys(value, ['operationId', 'target', 'action', 'note']);
    return { operationId, target, action: 'correct', note: noteText(value.note) };
  }
  keys(value, ['operationId', 'target', 'action', 'note', 'expectedTargetRevision']);
  if (!['bookmark', 'unbookmark', 'exclude', 'restore'].includes(String(value.action)) || value.note !== null) return fail('invalid_candidate_control_request');
  return { operationId, target, action: value.action as Exclude<CandidateControlAction, 'correct'>, note: null, expectedTargetRevision: revision(value.expectedTargetRevision) };
}
function decodeRecords(value: unknown): CandidateControlRecords {
  if (!object(value)) return fail('candidate_controls_corrupt', 503);
  keys(value, ['schemaVersion', 'storeId', 'events']);
  if (value.schemaVersion !== 1 || !Array.isArray(value.events)) return fail('candidate_controls_schema_unsupported', 503);
  const storeId = uuid(value.storeId), operations = new Set<string>(), targets = new Map<string, { target: ExactCandidateRef; revision: number }>();
  const events: CandidateControlEvent[] = value.events.map((raw: unknown) => {
    if (!object(raw)) return fail('candidate_controls_corrupt', 503);
    keys(raw, ['operationId', 'target', 'action', 'note', 'createdAt', 'targetRevision']);
    const operationId = uuid(raw.operationId), target = parseExactCandidateRef(raw.target), targetRevision = revision(raw.targetRevision);
    if (operations.has(operationId)) return fail('candidate_controls_duplicate_operation', 503);
    operations.add(operationId);
    const previous = targets.get(candidateOccurrenceKey(target));
    if (previous && !sameCandidateRef(previous.target, target)) return fail('candidate_controls_target_changed', 503);
    if (targetRevision !== (previous?.revision ?? 0) + 1) return fail('candidate_controls_revision_gap', 503);
    if (typeof raw.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.createdAt) || !Number.isFinite(Date.parse(raw.createdAt)) || new Date(raw.createdAt).toISOString() !== raw.createdAt) return fail('candidate_controls_corrupt', 503);
    const action = raw.action;
    if (!['bookmark', 'unbookmark', 'correct', 'exclude', 'restore'].includes(String(action))) return fail('candidate_controls_corrupt', 503);
    const note = action === 'correct' ? noteText(raw.note) : raw.note === null ? null : fail('candidate_controls_corrupt', 503);
    targets.set(candidateOccurrenceKey(target), { target, revision: targetRevision });
    return { operationId, target, action: action as CandidateControlAction, note, createdAt: raw.createdAt, targetRevision };
  });
  return { schemaVersion: 1, storeId, events };
}
export function candidateControlState(records: CandidateControlRecords | null, target: ExactCandidateRef): CandidateControlState {
  const state: CandidateControlState = { target: structuredClone(target), targetRevision: 0, bookmarked: false, excluded: false, notes: [] };
  for (const event of records?.events ?? []) {
    if (candidateOccurrenceKey(event.target) !== candidateOccurrenceKey(target)) continue;
    if (!sameCandidateRef(event.target, target)) throw new CandidateControlError('candidate_control_target_changed', 409);
    state.targetRevision = event.targetRevision;
    if (event.action === 'bookmark') state.bookmarked = true;
    if (event.action === 'unbookmark') state.bookmarked = false;
    if (event.action === 'exclude') state.excluded = true;
    if (event.action === 'restore') state.excluded = false;
    if (event.action === 'correct') state.notes.unshift(structuredClone(event));
  }
  return state;
}
export class AgentCandidateControls {
  readonly options: { dataRoot: string; readTarget: (target: ExactCandidateRef) => Promise<void> };
  constructor(options: AgentCandidateControls['options']) { this.options = options; }
  async #file<T>(work: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.options.dataRoot), previous = fileGates.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    fileGates.set(key, held);
    await previous;
    try { return await work(); } finally { release(); if (fileGates.get(key) === held) fileGates.delete(key); }
  }
  async getRecords(): Promise<CandidateControlRecords | null> {
    try { return await this.#readRecords(); }
    catch (error) {
      if (error instanceof CandidateControlError) {
        if (error.status < 500) throw new CandidateControlError('candidate_controls_corrupt', 503);
        throw error;
      }
      throw new CandidateControlError('candidate_controls_unavailable', 503);
    }
  }
  async #readRecords(): Promise<CandidateControlRecords | null> {
    if (!await exists(this.options.dataRoot)) return null;
    await directory(this.options.dataRoot);
    const root = path.join(this.options.dataRoot, 'personal-agent-controls');
    if (!await exists(root)) return null;
    await directory(root);
    const file = await safePath(root, 'records.json');
    if (!await exists(file)) return fail('candidate_controls_records_missing', 503);
    return decodeRecords(parse(await readBytes(file, limit)));
  }
  async readState(value: ExactCandidateRef): Promise<CandidateControlState> { return candidateControlState(await this.getRecords(), parseExactCandidateRef(value)); }
  async operation(value: string): Promise<{ storeId: string; event: CandidateControlEvent } | null> {
    const operationId = uuid(value), records = await this.getRecords(), event = records?.events.find(event => event.operationId === operationId);
    return event ? { storeId: records!.storeId, event: structuredClone(event) } : null;
  }
  async apply(value: CandidateControlInput): Promise<CandidateControlReceipt> {
    const input = parseCandidateControlInput(value);
    return this.#file(async () => {
      const previous = await this.getRecords();
      const replay = this.#replay(previous, input);
      if (replay) return replay;
      const state = this.#checkState(previous, input);
      // This is bounded native-file IO, never an Agent run or a model call.
      // Do it before first-root creation so rejected unknown targets leave no empty store.
      if (state.targetRevision === 0 || input.action === 'bookmark' || input.action === 'correct') await this.options.readTarget(input.target);
      const prospective = this.#append(previous, input, state);
      if (jsonBytes(prospective).length > limit) return fail('candidate_controls_capacity_exceeded', 413);
      const root = await safePath(this.options.dataRoot, 'personal-agent-controls', true);
      let created = false;
      try { await fs.mkdir(root, { mode: 0o700 }); created = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await directory(root);
      const lock = path.join(root, '.write-lock');
      try { await fs.mkdir(lock, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('candidate_controls_busy', 409); throw error; }
      try {
        const file = path.join(root, 'records.json');
        const current = created && !await exists(file) ? null : await this.getRecords();
        const concurrentReplay = this.#replay(current, input);
        if (concurrentReplay) return concurrentReplay;
        const latest = this.#checkState(current, input), records = this.#append(current, input, latest);
        if (jsonBytes(records).length > limit) return fail('candidate_controls_capacity_exceeded', 413);
        await atomicJson(file, records);
        const saved = await this.getRecords();
        if (canonical(saved) !== canonical(records)) return fail('candidate_controls_save_unknown', 503);
        const event = records.events.at(-1)!;
        return { storeId: records.storeId, event: structuredClone(event), state: candidateControlState(saved, input.target), replayed: false };
      } finally { await fs.rmdir(lock); }
    });
  }
  #checkState(records: CandidateControlRecords | null, input: CandidateControlInput): CandidateControlState {
    const state = candidateControlState(records, input.target);
    if (input.action !== 'correct' && state.targetRevision !== input.expectedTargetRevision) throw new CandidateControlError('candidate_control_revision_conflict', 409, state);
    return state;
  }
  #append(previous: CandidateControlRecords | null, input: CandidateControlInput, state: CandidateControlState): CandidateControlRecords {
    const records = structuredClone(previous) ?? { schemaVersion: 1 as const, storeId: randomUUID(), events: [] };
    records.events.push({ operationId: input.operationId, target: structuredClone(input.target), action: input.action, note: input.note, createdAt: new Date().toISOString(), targetRevision: state.targetRevision + 1 });
    return records;
  }
  #replay(records: CandidateControlRecords | null, input: CandidateControlInput): CandidateControlReceipt | null {
    const event = records?.events.find(event => event.operationId === input.operationId);
    if (!event) return null;
    if (!sameCandidateRef(event.target, input.target) || event.action !== input.action || event.note !== input.note || input.action !== 'correct' && event.targetRevision - 1 !== input.expectedTargetRevision) return fail('candidate_control_operation_conflict', 409);
    return { storeId: records!.storeId, event: structuredClone(event), state: candidateControlState(records, event.target), replayed: true };
  }
}
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, canonical, directory, exists, jsonBytes, object, parse, readBytes, safePath } from './project-data-context-io.ts';

import type { IssueDraftPayload, WorkspaceDraftRecord } from '../workspace-draft-store.ts';

export type CaseActionDraftKind = 'choice' | 'feedback';
export type CaseActionDraftPayload<T extends Record<string, unknown>> = IssueDraftPayload & {
  actionForm: { kind: CaseActionDraftKind; fields: T };
  recovery?: { originalId: string; sourceRevision: number };
  preservedDrafts?: { id: string; sourceRevision: number }[];
};
export type CaseActionDraftOptions<T extends Record<string, unknown>> = {
  id: string; caseId: string; issueId: string; kind: CaseActionDraftKind; initial: T; empty?: T;
  read(): Promise<WorkspaceDraftRecord<CaseActionDraftPayload<T>> | null>;
  save(revision: number, payload: CaseActionDraftPayload<T>): Promise<WorkspaceDraftRecord<CaseActionDraftPayload<T>>>;
  backup?(id: string, payload: CaseActionDraftPayload<T>): Promise<WorkspaceDraftRecord<CaseActionDraftPayload<T>>>;
  onChange?(): void;
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const restricted = (failure: unknown) => object(failure) && [401, 403].includes(Number(failure.status ?? failure.statusCode));
const blank = (value: unknown): unknown => typeof value === 'string' ? '' : typeof value === 'number' ? 0 : typeof value === 'boolean' ? false : Array.isArray(value) ? [] : object(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, blank(child)])) : null;

/** A separately named input draft, never a choice, observation or conversation record. */
export function createCaseActionDraft<T extends Record<string, unknown>>(options: CaseActionDraftOptions<T>) {
  let value = copy(options.initial), saved = copy(options.initial), revision = 0, ready = false, restored = false;
  const empty = copy(options.empty ?? blank(options.initial) as T);
  let edited = false, earlyConflict = false;
  let discardSerial = 0;
  let isRestricted = false, readError = '', needsExplicitSave = false;
  let retainedInput: T | null = null, recoveryDraftId: string | null = null;
  let preservedDrafts: { id: string; sourceRevision: number }[] = [], savedPreservedDrafts: { id: string; sourceRevision: number }[] = [];
  let conflict: WorkspaceDraftRecord<CaseActionDraftPayload<T>> | null = null;
  const localEdits = new Map<string, { path: string[]; value: unknown }>();
  let loading: Promise<T> | null = null, running: Promise<boolean> | null = null;
  let resolving: Promise<boolean> | null = null;
  let backupIntent: { sourceRevision: number; id: string } | null = null;
  const check = (record: WorkspaceDraftRecord<CaseActionDraftPayload<T>>, id = options.id) => {
    const payload = record.payload;
    if (record.kind !== 'issue-draft' || record.id !== id || !Number.isSafeInteger(record.revision) || record.revision < 1 || payload.caseId !== options.caseId || payload.issueId !== options.issueId
      || payload.text !== '' || !Array.isArray(payload.appendedFragmentIds) || payload.appendedFragmentIds.length
      || payload.actionForm?.kind !== options.kind || !payload.actionForm.fields || typeof payload.actionForm.fields !== 'object' || Array.isArray(payload.actionForm.fields)) {
      throw Error('action_draft_owner_mismatch');
    }
  };
  const savedCopies = (payload: CaseActionDraftPayload<T>) => (payload.preservedDrafts ?? []).filter(ref => typeof ref.id === 'string' && /^action-recovery:[A-Za-z0-9-]+$/.test(ref.id) && Number.isSafeInteger(ref.sourceRevision) && ref.sourceRevision > 0).map(ref => ({ ...ref }));
  const rememberEdits = (previous: unknown, next: unknown, path: string[] = []) => {
    if (same(previous, next)) return;
    if (object(previous) && object(next)) {
      for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) rememberEdits(previous[key], next[key], [...path, key]);
    } else localEdits.set(JSON.stringify(path), { path, value: next === undefined ? undefined : copy(next) });
  };
  const restrict = () => {
    if (isRestricted) return;
    const retained = copy(empty) as Record<string, unknown>;
    for (const edit of localEdits.values()) {
      let target = retained;
      for (const key of edit.path.slice(0, -1)) {
        if (!object(target[key])) target[key] = {};
        target = target[key] as Record<string, unknown>;
      }
      const key = edit.path.at(-1);
      if (key !== undefined) { if (edit.value === undefined) delete target[key]; else target[key] = copy(edit.value); }
    }
    retainedInput = localEdits.size ? retained as T : null;
    isRestricted = true; ready = false; value = copy(empty); saved = copy(empty);
    conflict = null; backupIntent = null; recoveryDraftId = null; preservedDrafts = []; savedPreservedDrafts = []; needsExplicitSave = false; earlyConflict = false;
    readError = '原草稿权限已失效，已清除读取内容；仅保留本轮新输入供复制。'; options.onChange?.();
  };
  const fail = (failure: unknown, fromRead = false): never => {
    if (restricted(failure)) restrict();
    else if (fromRead) { readError = '原草稿暂不可读取。'; options.onChange?.(); }
    throw failure;
  };
  const payloadFor = (fields: T): CaseActionDraftPayload<T> => ({ caseId: options.caseId, issueId: options.issueId, text: '', appendedFragmentIds: [], actionForm: { kind: options.kind, fields: copy(fields) }, ...(preservedDrafts.length ? { preservedDrafts: copy(preservedDrafts) } : {}) });
  function load(): Promise<T> {
    if (isRestricted) return Promise.reject(Error('action_draft_restricted'));
    if (ready) return Promise.resolve(value);
    if (!loading) loading = (async () => {
      const record = await options.read().catch(error => fail(error, true));
      if (record) {
        check(record); revision = record.revision; restored = true;
        preservedDrafts = savedCopies(record.payload); savedPreservedDrafts = copy(preservedDrafts); recoveryDraftId = preservedDrafts.at(-1)?.id ?? null;
        saved = { ...copy(options.initial), ...copy(record.payload.actionForm.fields) };
        if (edited && !same(value, saved)) { earlyConflict = true; conflict = record; }
      }
      if (!edited) value = copy(saved);
      ready = true; readError = ''; options.onChange?.(); return value;
    })().finally(() => { loading = null; });
    return loading;
  }
  function update(next: T | ((previous: T) => T)) {
    if (isRestricted) return;
    const changed = copy(typeof next === 'function' ? next(copy(value)) : next);
    rememberEdits(value, changed); value = changed; edited = true; options.onChange?.();
  }
  async function drain(explicit: boolean) {
    if (isRestricted) throw Error('action_draft_restricted');
    if (!ready) return false;
    if (needsExplicitSave && !explicit) return false;
    if (earlyConflict) throw Error('action_draft_changed_before_load');
    if (conflict) throw Error('draft_revision_conflict');
    const startedBeforeDiscard = discardSerial;
    while (!same(value, saved) || !same(preservedDrafts, savedPreservedDrafts)) {
      const sent = copy(value), payload = payloadFor(sent);
      let receipt: WorkspaceDraftRecord<CaseActionDraftPayload<T>>;
      try { receipt = await options.save(revision, payload); }
      catch (failure) {
        if (restricted(failure)) fail(failure);
        // A lost acknowledgement is recovered only by an exact owner/content readback.
        const original = await options.read().catch(error => { if (restricted(error)) fail(error, true); readError = '原保存结果暂未读回。'; return null; });
        if (!original) throw failure;
        check(original);
        if (!same(original.payload, payload)) { conflict = original; options.onChange?.(); throw failure; }
        receipt = original;
      }
      check(receipt);
      if (!same(receipt.payload, payload) || receipt.revision <= revision) throw Error('action_draft_receipt_mismatch');
      revision = receipt.revision; saved = sent; savedPreservedDrafts = savedCopies(receipt.payload);
      // Discard is local-only. A request already accepted by the Host must never
      // trigger a second write that "restores" older text over that receipt.
      if (startedBeforeDiscard !== discardSerial) {
        if (!edited) value = copy(saved);
        return same(value, saved);
      }
    }
    needsExplicitSave = false;
    return same(value, saved);
  }
  function flush(explicit = true): Promise<boolean> {
    if (!running) running = drain(explicit).finally(() => { running = null; options.onChange?.(); });
    return running;
  }
  function resolveConflict(reviewedRevision: number): Promise<boolean> {
    if (isRestricted || !conflict || conflict.revision !== reviewedRevision || !options.backup) return Promise.resolve(false);
    if (resolving) return resolving;
    const reviewed = conflict;
    backupIntent ??= { sourceRevision: reviewedRevision, id: `action-recovery:${crypto.randomUUID()}` };
    if (backupIntent.sourceRevision !== reviewedRevision) backupIntent = { sourceRevision: reviewedRevision, id: `action-recovery:${crypto.randomUUID()}` };
    const intent = backupIntent;
    const payload = { ...copy(reviewed.payload), recovery: { originalId: options.id, sourceRevision: reviewedRevision } };
    resolving = (async () => {
      let receipt: WorkspaceDraftRecord<CaseActionDraftPayload<T>>;
      try { receipt = await options.backup!(intent.id, payload); } catch (failure) { return fail(failure); }
      if (isRestricted) return false;
      check(receipt, intent.id);
      if (!same(receipt.payload, payload)) throw Error('action_draft_backup_receipt_mismatch');
      recoveryDraftId = receipt.id;
      if (conflict !== reviewed) return false;
      revision = reviewedRevision; saved = { ...copy(options.initial), ...copy(reviewed.payload.actionForm.fields) };
      savedPreservedDrafts = savedCopies(reviewed.payload);
      preservedDrafts = [...savedPreservedDrafts.filter(ref => ref.id !== receipt.id), { id: receipt.id, sourceRevision: reviewedRevision }];
      conflict = null; earlyConflict = false; needsExplicitSave = true; options.onChange?.();
      return true;
    })().finally(() => { resolving = null; options.onChange?.(); });
    return resolving;
  }
  function discardLocal() {
    discardSerial++;
    if (isRestricted) { value = copy(empty); saved = copy(empty); retainedInput = null; }
    else {
      if (conflict) { revision = conflict.revision; saved = { ...copy(options.initial), ...copy(conflict.payload.actionForm.fields) }; savedPreservedDrafts = savedCopies(conflict.payload); }
      value = copy(saved);
      preservedDrafts = copy(savedPreservedDrafts);
    }
    localEdits.clear(); edited = false; earlyConflict = false; conflict = null; needsExplicitSave = false; options.onChange?.();
  }
  return { load, update, flush, resolveConflict, discardLocal, getSnapshot: () => ({ value, ready, restored, revision, dirty: isRestricted ? retainedInput !== null : !same(value, saved) || !same(preservedDrafts, savedPreservedDrafts),
    isRestricted, readError, retainedInput, needsExplicitSave, recoveryDraftId, preservedDrafts: copy(preservedDrafts),
    conflict: conflict ? { revision: conflict.revision, value: copy(conflict.payload.actionForm.fields) } : null,
  }) };
}

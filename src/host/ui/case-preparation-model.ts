import type { ThreeBranchCreateInput } from '../case-creation-orchestrator.ts';
import type { GoalDraftInput, GoalScope, GoalVersion } from '../strategy-goals-types.ts';
import type { PrepareDraftPayload, WorkspaceDraftRecord } from '../workspace-draft-store.ts';

export type PreparationDraftPayload = PrepareDraftPayload & {
  scope?: GoalScope | null;
  goalDraft?: GoalDraftInput | null;
  goalAttempt?: (GoalDraftInput & { operationId: string }) | null;
  candidateGoal?: GoalVersion | null;
  createAttempt?: ThreeBranchCreateInput | null;
};

export function emptyPreparePayload(): PreparationDraftPayload {
  return {
    rawInput: '', title: '', description: '', selectedGoal: null,
    adoptOperationId: crypto.randomUUID(), createOperationId: crypto.randomUUID(),
    adoptionReceipt: null, creationReceipt: null, creationState: 'idle', targetLocation: null,
    scope: null, goalDraft: null, goalAttempt: null, candidateGoal: null, createAttempt: null,
  };
}

type DraftRecord<P extends PreparationDraftPayload> = WorkspaceDraftRecord<P>;
type Options<P extends PreparationDraftPayload> = {
  id: string;
  payload?: P;
  revision?: number;
  save: (id: string, revision: number, payload: P) => Promise<DraftRecord<P>>;
  read?: (id: string) => Promise<DraftRecord<P> | null>;
  onSaved?: (record: DraftRecord<P>) => void;
  onError?: (error: unknown) => void;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const receiptKeys = new Set(['adoptionReceipt', 'creationReceipt', 'creationState', 'targetLocation']);

/** One writer per preparation identity. Acknowledgements advance revision, never replace newer edits. */
export function createPreparationDraftSession<P extends PreparationDraftPayload = PreparationDraftPayload>(options: Options<P>) {
  let payload = structuredClone(options.payload ?? emptyPreparePayload()) as P;
  let baseline = structuredClone(payload);
  let revision = options.revision ?? 0;
  let conflict: DraftRecord<P> | null = null;
  let change = 0;
  const changed = new Map<keyof P, number>();
  let running: Promise<boolean> | null = null;

  function update(patch: Partial<P>) {
    for (const key of Object.keys(patch) as (keyof P)[]) {
      if (same(payload[key], patch[key])) continue;
      payload = { ...payload, [key]: structuredClone(patch[key]) };
      changed.set(key, ++change);
    }
  }

  function assertOwner(record: DraftRecord<P>) {
    if (record.id !== options.id || record.kind !== 'prepare') throw new Error('prepare_draft_owner_mismatch');
  }

  function accept(record: DraftRecord<P>) {
    assertOwner(record);
    if (record.revision < revision) return;
    const next = { ...payload, ...structuredClone(record.payload) };
    for (const key of changed.keys()) {
      if (!receiptKeys.has(String(key))) next[key] = payload[key];
      else changed.delete(key);
    }
    payload = next;
    baseline = structuredClone(record.payload);
    revision = record.revision;
    conflict = null;
    for (const key of changed.keys()) if (same(payload[key], record.payload[key])) changed.delete(key);
  }

  function acknowledge(record: DraftRecord<P>, sentChange: number) {
    assertOwner(record);
    revision = Math.max(revision, record.revision);
    baseline = structuredClone(record.payload);
    conflict = null;
    for (const [key, edited] of changed) if (edited <= sentChange && same(payload[key], record.payload[key])) changed.delete(key);
    options.onSaved?.(record);
  }

  async function drain(): Promise<boolean> {
    while (changed.size) {
      const sent = structuredClone(payload);
      const sentChange = change;
      try {
        acknowledge(await options.save(options.id, revision, sent), sentChange);
      } catch (failure) {
        // A 409 or a dropped reply can mean this exact payload already committed.
        // Readback can advance CAS only when no field was concurrently edited by both writers.
        let recovered = false;
        const status = (failure as { status?: number; statusCode?: number } | null)?.status ?? (failure as { statusCode?: number } | null)?.statusCode;
        if (options.read && (status === undefined || status === 409 || status >= 500)) {
          try {
            const latest = await options.read(options.id);
            if (latest) {
              assertOwner(latest);
              if (same(latest.payload, sent)) {
                acknowledge(latest, sentChange);
                recovered = true;
              } else if (latest.revision > revision) {
                const overlapping = [...changed.keys()].some(key => !receiptKeys.has(String(key)) && !same(latest.payload[key], baseline[key]) && !same(latest.payload[key], payload[key]));
                const receiptChangedGoal = Boolean(latest.payload.adoptionReceipt && changed.has('selectedGoal') && !same(latest.payload.selectedGoal, payload.selectedGoal));
                if (overlapping || receiptChangedGoal) {
                  conflict = latest;
                  options.onError?.(Object.assign(new Error('准备草稿已在另一窗口修改；两份输入均保留，请另存当前准备。'), { code: 'draft_revision_conflict', status: 409 }));
                  return false;
                }
                accept(latest);
                const retryChange = change;
                acknowledge(await options.save(options.id, revision, structuredClone(payload)), retryChange);
                recovered = true;
              }
            }
          } catch { /* Preserve local input and the original failure when readback is unknown. */ }
        }
        if (!recovered) {
          options.onError?.(failure);
          return false;
        }
      }
    }
    return true;
  }

  function flush(): Promise<boolean> {
    if (running) return running;
    running = Promise.resolve().then(drain).finally(() => { running = null; });
    return running;
  }

  return {
    id: options.id,
    getSnapshot: () => ({ payload, revision, dirty: changed.size > 0, saving: running !== null, conflict }),
    update, flush, accept,
  };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GoalRef } from './strategy-goals-types.ts';
import type { CaseCreationSource, CaseGoalIntentRef } from './case-types.ts';

export type WorkspaceDraftKind = 'prepare' | 'carry-over' | 'issue-draft';

export type PrepareDraftPayload = {
  rawInput: string;
  title: string;
  description: string;
  selectedGoal: { goalId: string; version: number; strategy: string } | null;
  adoptOperationId: string;
  createOperationId: string;
  adoptionReceipt: { goalId: string; version: number; strategy: string; operationId: string; adoptedAt: string } | null;
  creationReceipt: { caseId: string; operationId: string; createdAt: string } | null;
  creationState: 'idle' | 'partial_failed' | 'partial_unknown' | 'completed';
  targetLocation: { caseId: string; issueId?: string | null } | null;
  creationSource?: CaseCreationSource;
  goalIntent?: CaseGoalIntentRef;
};

export type CarryOverFragmentPayload = {
  originalText: string;
  origin: { kind: 'home-input' | 'prepare-draft' | 'other-case'; label: string; ref: string | null };
  targetCaseId: string;
  targetIssueId: string | null;
  appendedAt: string | null;
};

export type IssueDraftPayload = {
  caseId: string;
  issueId: string | null;
  text: string;
  appendedFragmentIds: string[];
};

export type WorkspaceDraftRecord<T = Record<string, unknown>> = {
  kind: WorkspaceDraftKind;
  id: string;
  revision: number;
  payload: T;
  createdAt: string;
  updatedAt: string;
};

export class WorkspaceDraftError extends Error {
  statusCode: number;
  code: string;
  constructor(code: string, statusCode = 400) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;
const KINDS = new Set<WorkspaceDraftKind>(['prepare', 'carry-over', 'issue-draft']);

function assertKind(kind: string): WorkspaceDraftKind {
  if (!KINDS.has(kind as WorkspaceDraftKind)) throw new WorkspaceDraftError('invalid_draft_kind', 400);
  return kind as WorkspaceDraftKind;
}
function assertId(id: string): string {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || id.includes('..')) throw new WorkspaceDraftError('invalid_draft_id', 400);
  return id;
}

// Process-wide per-path mutex queue so concurrent calls (even across two store instances on the same root)
// serialize strictly around read -> CAS check -> atomic rename.
const pathLocks = new Map<string, Promise<unknown>>();
async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = pathLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = prev.then(() => current, () => current);
  pathLocks.set(key, tail);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (pathLocks.get(key) === tail) pathLocks.delete(key);
  }
}

/**
 * Persistent Host-owned workspace draft store (not sessionStorage, not a second conversation history).
 * Each draft is stored atomically by (kind, id) with serialized CAS revision checks so concurrent saves
 * never overwrite each other and conflicts (409) never drop user input.
 */
export function createWorkspaceDraftStore(options: { root: string }) {
  const baseDir = path.resolve(options.root, 'workspace-drafts');
  const fileFor = (kind: WorkspaceDraftKind, id: string) => path.join(baseDir, kind, `${encodeURIComponent(assertId(id))}.json`);

  async function readUnlocked<T = Record<string, unknown>>(kind: WorkspaceDraftKind, id: string): Promise<WorkspaceDraftRecord<T> | null> {
    assertKind(kind);
    const file = fileFor(kind, id);
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as WorkspaceDraftRecord<T>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function saveUnlocked<T extends Record<string, unknown>>(kind: WorkspaceDraftKind, id: string, expectedRevision: number, payload: T): Promise<WorkspaceDraftRecord<T>> {
    assertKind(kind);
    assertId(id);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new WorkspaceDraftError('invalid_draft_revision', 400);
    const existing = await readUnlocked<T>(kind, id);
    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== expectedRevision) throw new WorkspaceDraftError('draft_revision_conflict', 409);
    const now = new Date().toISOString();
    const record: WorkspaceDraftRecord<T> = {
      kind, id, revision: currentRevision + 1, payload,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    const file = fileFor(kind, id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    await fs.rename(tmp, file);
    return record;
  }

  async function read<T = Record<string, unknown>>(kind: WorkspaceDraftKind, id: string): Promise<WorkspaceDraftRecord<T> | null> {
    return readUnlocked<T>(kind, id);
  }

  async function list<T = Record<string, unknown>>(kind: WorkspaceDraftKind): Promise<WorkspaceDraftRecord<T>[]> {
    assertKind(kind);
    const dir = path.join(baseDir, kind);
    let entries: string[];
    try { entries = await fs.readdir(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw error;
    }
    const items: WorkspaceDraftRecord<T>[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        items.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as WorkspaceDraftRecord<T>);
      } catch { /* ignore unreadable temp files */ }
    }
    items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return items;
  }

  async function save<T extends Record<string, unknown>>(kind: WorkspaceDraftKind, id: string, expectedRevision: number, payload: T): Promise<WorkspaceDraftRecord<T>> {
    assertKind(kind);
    const lockKey = fileFor(kind, id);
    return withPathLock(lockKey, () => saveUnlocked<T>(kind, id, expectedRevision, payload));
  }

  /** Explicit discard clears ONLY this draft file and never affects any saved Goal or Case. */
  async function discard(kind: WorkspaceDraftKind, id: string): Promise<{ discarded: boolean }> {
    assertKind(kind);
    const file = fileFor(kind, id);
    return withPathLock(file, async () => {
      try {
        await fs.unlink(file);
        return { discarded: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { discarded: false };
        throw error;
      }
    });
  }

  /**
   * Idempotently appends a carry-over fragment to an issue draft without ever overwriting non-empty text.
   * Strictly verifies fragment owner (targetCaseId / targetIssueId) matches target draft owner (FR02).
   */
  async function appendCarryOverFragment(input: {
    fragmentId: string;
    issueDraftId: string;
    caseId: string;
    issueId: string | null;
    expectedDraftRevision: number;
  }): Promise<{ draft: WorkspaceDraftRecord<IssueDraftPayload>; fragment: WorkspaceDraftRecord<CarryOverFragmentPayload>; alreadyAppended: boolean }> {
    const draftLock = fileFor('issue-draft', input.issueDraftId);
    const fragLock = fileFor('carry-over', input.fragmentId);
    const [firstLock, secondLock] = draftLock < fragLock ? [draftLock, fragLock] : [fragLock, draftLock];
    return withPathLock(firstLock, () => withPathLock(secondLock, async () => {
      const fragment = await readUnlocked<CarryOverFragmentPayload>('carry-over', input.fragmentId);
      if (!fragment) throw new WorkspaceDraftError('carry_over_fragment_not_found', 404);
      if (fragment.payload.targetCaseId !== input.caseId) {
        throw new WorkspaceDraftError('carry_over_scope_mismatch', 409);
      }
      if (fragment.payload.targetIssueId !== null && fragment.payload.targetIssueId !== input.issueId) {
        throw new WorkspaceDraftError('carry_over_scope_mismatch', 409);
      }
      const existing = await readUnlocked<IssueDraftPayload>('issue-draft', input.issueDraftId);
      if (existing && (existing.payload.caseId !== input.caseId || existing.payload.issueId !== input.issueId)) {
        throw new WorkspaceDraftError('carry_over_scope_mismatch', 409);
      }
      const currentRevision = existing?.revision ?? 0;
      if (currentRevision !== input.expectedDraftRevision) throw new WorkspaceDraftError('draft_revision_conflict', 409);
      const existingIds = existing?.payload.appendedFragmentIds ?? [];
      if (existingIds.includes(input.fragmentId)) {
        return { draft: existing!, fragment, alreadyAppended: true };
      }
      const baseText = existing?.payload.text ?? '';
      const nextText = baseText.trim().length > 0
        ? `${baseText}\n\n${fragment.payload.originalText}`
        : fragment.payload.originalText;
      const savedDraft = await saveUnlocked<IssueDraftPayload>('issue-draft', input.issueDraftId, currentRevision, {
        caseId: input.caseId,
        issueId: input.issueId,
        text: nextText,
        appendedFragmentIds: [...existingIds, input.fragmentId],
      });
      const savedFragment = fragment.payload.appendedAt
        ? fragment
        : await saveUnlocked<CarryOverFragmentPayload>('carry-over', input.fragmentId, fragment.revision, {
            ...fragment.payload,
            appendedAt: new Date().toISOString(),
          });
      return { draft: savedDraft, fragment: savedFragment, alreadyAppended: false };
    }));
  }

  return { read, list, save, discard, appendCarryOverFragment };
}

export type WorkspaceDraftStore = ReturnType<typeof createWorkspaceDraftStore>;
export type SelectedGoalRef = GoalRef & { strategy: string };

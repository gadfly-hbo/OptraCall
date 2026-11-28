import { ExternalWorkError, externalId, externalRevision, externalText } from './external-work-types.ts';
import type { ExternalWorkStore } from './external-work-store.ts';

/**
 * Host-only read-only inbox adapter (Issue #155 S2/E02).
 *
 * It polls exactly the subscriptions the Host constructed it with (authorized
 * account/repositories/issues), persists every real event into the external
 * ledger with store-level dedupe, and advances its per-subscription cursor
 * only after the whole window was saved. Stop, revocation or account change
 * end the pulls; a restart resumes the same authorized reads and relies on
 * ledger dedupe instead of replaying anything. It never touches a foreground
 * Agent tool context, never replays external writes and never runs a model
 * loop — resumption decisions belong to the Host continuation slice.
 */
export const DEFAULT_INBOX_POLL_INTERVAL_MS = 60_000;
const MAX_BACKOFF_FACTOR = 6;
export type InboxSubscription = { projectId: string; taskId: string; workId?: string; repositoryId: string; issueNumber?: number };
export type InboxTransportRequest = { repositoryId: string; issueNumber?: number; afterEventKey?: string; signal?: AbortSignal };
export type InboxTransportEvent = { eventKey: string; issueNumber?: number };
export type InboxReadTransport = {
  read(request: InboxTransportRequest): Promise<{ events: InboxTransportEvent[]; nextAfterEventKey?: string; retryAfterMs?: number }>;
};
export type InboxPollOutcome = { pulled: number; saved: number; duplicates: number; retryAfterMs?: number };

type ActiveSubscription = {
  projectId: string;
  taskId: string;
  workId?: string;
  repositoryId: string;
  issueNumber?: number;
  revoked: boolean;
  cursor?: string;
};

function subscription(input: InboxSubscription): ActiveSubscription {
  if (typeof input !== 'object' || input === null) throw new ExternalWorkError('external_inbox_invalid', 400);
  const projectId = externalId(input.projectId);
  const taskId = externalId(input.taskId);
  const repositoryId = externalText(input.repositoryId, 300);
  const workId = input.workId === undefined ? undefined : externalId(input.workId);
  let issueNumber: number | undefined;
  if (input.issueNumber !== undefined) {
    issueNumber = externalRevision(input.issueNumber);
  }
  return { projectId, taskId, repositoryId, ...(workId !== undefined ? { workId } : {}), ...(issueNumber !== undefined ? { issueNumber } : {}), revoked: false };
}

export class ExternalInbox {
  readonly #store: ExternalWorkStore;
  readonly #transport: InboxReadTransport;
  readonly #subscriptions: ActiveSubscription[];
  readonly #now: () => number;
  readonly #interval: number;
  readonly #schedule: (delayMs: number, task: () => void) => () => void;
  #stopped = false;
  #stopReason = 'stopped';
  #cancelScheduled?: () => void;
  #failures = 0;

  constructor(options: { store: ExternalWorkStore; transport: InboxReadTransport; subscriptions: readonly InboxSubscription[]; now?: () => number; pollIntervalMs?: number; schedule?: (delayMs: number, task: () => void) => () => void }) {
    this.#store = options.store;
    this.#transport = options.transport;
    if (!Array.isArray(options.subscriptions)) throw new ExternalWorkError('external_inbox_invalid', 400);
    this.#subscriptions = options.subscriptions.map(subscription);
    this.#now = options.now ?? (() => Date.now());
    const interval = options.pollIntervalMs ?? DEFAULT_INBOX_POLL_INTERVAL_MS;
    if (!Number.isSafeInteger(interval) || interval < 1_000) throw new ExternalWorkError('external_inbox_invalid', 400);
    this.#interval = interval;
    this.#schedule = options.schedule ?? ((delayMs, task) => {
      const handle = setTimeout(task, delayMs);
      return () => clearTimeout(handle);
    });
  }

  /** Schedule the bounded polling loop; a stopped adapter never schedules again. */
  start(): void {
    if (this.#stopped) throw new ExternalWorkError('external_inbox_stopped', 409);
    if (this.#cancelScheduled) return;
    this.#scheduleNext(this.#interval);
  }

  stop(reason = 'stopped'): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#stopReason = externalText(reason, 200);
    this.#cancelScheduled?.();
    this.#cancelScheduled = undefined;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  /** Revoke matching subscriptions (lost grant / changed account); revoked ones are never read again. */
  revoke(match: Partial<Pick<InboxSubscription, 'projectId' | 'taskId' | 'workId' | 'repositoryId' | 'issueNumber'>> = {}): number {
    const keys = Object.keys(match);
    if (keys.some(key => !['projectId', 'taskId', 'workId', 'repositoryId', 'issueNumber'].includes(key))) throw new ExternalWorkError('external_inbox_invalid', 400);
    const equals = (value: unknown, expected: unknown) => expected === undefined || value === expected;
    let count = 0;
    for (const active of this.#subscriptions) {
      if (active.revoked) continue;
      const matches = equals(active.projectId, match.projectId) && equals(active.taskId, match.taskId)
        && equals(active.workId, match.workId) && equals(active.repositoryId, match.repositoryId)
        && equals(active.issueNumber, match.issueNumber);
      if (matches && keys.length > 0) { active.revoked = true; count += 1; }
    }
    return count;
  }

  async #read(active: ActiveSubscription): Promise<{ events: InboxTransportEvent[]; nextAfterEventKey?: string; retryAfterMs?: number }> {
    return this.#transport.read({
      repositoryId: active.repositoryId,
      ...(active.issueNumber !== undefined ? { issueNumber: active.issueNumber } : {}),
      ...(active.cursor !== undefined ? { afterEventKey: active.cursor } : {}),
    });
  }

  /** One bounded round over the still-authorized subscriptions. */
  async pollOnce(): Promise<InboxPollOutcome> {
    if (this.#stopped) throw new ExternalWorkError('external_inbox_stopped', 409);
    let pulled = 0, saved = 0, duplicates = 0, roundRetryAfter: number | undefined;
    for (const active of this.#subscriptions) {
      if (active.revoked) continue;
      const batch = await this.#read(active);
      pulled += batch.events.length;
      if (typeof batch.retryAfterMs === 'number' && Number.isFinite(batch.retryAfterMs) && batch.retryAfterMs > 0) {
        roundRetryAfter = Math.max(roundRetryAfter ?? 0, Math.floor(batch.retryAfterMs));
      }
      for (const event of batch.events) {
        // Store-level dedupe by the event key; a failed save throws before the cursor moves.
        const outcome = await this.#store.recordInboxEvent({
          eventKey: event.eventKey,
          projectId: active.projectId,
          taskId: active.taskId,
          ...(active.workId !== undefined ? { workId: active.workId } : {}),
        });
        if (outcome.idempotent) duplicates += 1; else saved += 1;
      }
      // The cursor advances only after every event of this window is persisted.
      active.cursor = batch.nextAfterEventKey ?? (batch.events.length ? batch.events[batch.events.length - 1]!.eventKey : active.cursor);
    }
    return { pulled, saved, duplicates, ...(roundRetryAfter !== undefined ? { retryAfterMs: roundRetryAfter } : {}) };
  }

  #scheduleNext(delayMs: number): void {
    if (this.#stopped) return;
    this.#cancelScheduled?.();
    this.#cancelScheduled = this.#schedule(delayMs, () => { void this.#tick(); });
  }

  async #tick(): Promise<void> {
    if (this.#stopped) return;
    try {
      const outcome = await this.pollOnce();
      this.#failures = 0;
      this.#scheduleNext(outcome.retryAfterMs ?? this.#interval);
    } catch {
      // Conditional backoff keeps a failing provider from being hammered.
      this.#failures += 1;
      this.#scheduleNext(this.#interval * Math.min(this.#failures + 1, MAX_BACKOFF_FACTOR));
    }
  }

  diagnostics(): { stopped: boolean; reason: string; active: number; revoked: number } {
    return {
      stopped: this.#stopped,
      reason: this.#stopReason,
      active: this.#subscriptions.filter(item => !item.revoked).length,
      revoked: this.#subscriptions.filter(item => item.revoked).length,
    };
  }

  /** Injected clock access for callers that need consistent timestamps. */
  now(): number {
    return this.#now();
  }
}

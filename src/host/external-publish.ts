import { createHash } from 'node:crypto';
import { ExternalWorkError, externalText } from './external-work-types.ts';
import type { ExternalPublicationAction, PublicationAttempt } from './external-work-types.ts';
import type { ExternalWorkStore } from './external-work-store.ts';

/**
 * Host-owned publication orchestration for external GitHub work (Issue #155 S2/E02).
 *
 * Every publication reserves one durable `PublicationAttempt` per
 * (workId, revision, action) before any outbound call; the attempt identity
 * survives tool-call numbering, turns and restarts, so a repeated request
 * returns the original attempt instead of regenerating an equivalent dispatch.
 * A lost response stays UNKNOWN and is never blindly re-sent; only an explicit
 * read-only reconciliation with exactly one accurate match can settle it.
 */
export type PublishAction = Extract<ExternalPublicationAction, 'issue-create' | 'issue-comment'>;
export type GithubDispatchRequest = {
  workId: string;
  revision: number;
  action: PublishAction;
  repositoryId: string;
  title?: string;
  issueNumber?: number;
  body: string;
  bodyHash: string;
  hostContext: {
    signal?: AbortSignal;
    assertCurrent?(): void;
    registerCleanup?(cleanup: (options: { retryFailed?: boolean }) => Promise<void>): void;
  };
};
export type GithubDispatchResult = {
  outcome: 'succeeded' | 'rejected' | 'unknown';
  serviceRef?: string;
  repositoryId?: string;
  issueNumber?: number;
};
/** Host-injected transport (wraps the Host-only manager dispatch). Write-shaped by type: reconcile never reaches it. */
export type GithubDispatchTransport = { dispatch(request: GithubDispatchRequest): Promise<GithubDispatchResult> };
export type PublicationEvidence = { repositoryId: string; bodyHash: string; author?: string; issueId?: string; rejected?: boolean };
/** Read-only probe over the authorized repository; reconciliation's only input. */
export type PublicationProbe = { search(request: { repositoryId: string; bodyHash: string }): Promise<PublicationEvidence[]> };
export type PublishResult = { attempt: PublicationAttempt; dispatched: boolean };

const MAX_BODY_CHARS = 200_000;
function outboundBody(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > MAX_BODY_CHARS || value.includes('\u0000')) throw new ExternalWorkError('external_publication_invalid', 400);
  return value;
}
/** Receipt strings enter the durable ledger; only clean bounded text may pass. */
function receiptText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  try { return externalText(value, max); } catch { return undefined; }
}
function revisionNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ExternalWorkError('external_publication_invalid', 400);
  return Number(value);
}

export class ExternalPublisher {
  readonly #store: ExternalWorkStore;
  readonly #transport: GithubDispatchTransport;
  readonly #probe?: PublicationProbe;
  readonly #hostContext?: () => GithubDispatchRequest['hostContext'];
  constructor(options: { store: ExternalWorkStore; transport: GithubDispatchTransport; probe?: PublicationProbe; now?: () => number; hostContext?: () => GithubDispatchRequest['hostContext'] }) {
    this.#store = options.store;
    this.#transport = options.transport;
    this.#probe = options.probe;
    this.#hostContext = options.hostContext;
  }

  /** One issue per work: the succeeded create is the anchor every revision comment appends to. */
  async #anchor(workId: string, action: PublishAction): Promise<{ issueNumber?: number }> {
    const publications = await this.#store.listPublications(workId);
    const created = publications.find(item => item.action === 'issue-create' && item.status === 'succeeded');
    if (action === 'issue-create') {
      if (created) throw new ExternalWorkError('external_issue_already_created', 409);
      return {};
    }
    const issueNumber = created?.issueId === undefined ? Number.NaN : Number(created.issueId);
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new ExternalWorkError('external_publication_anchor_missing', 409);
    return { issueNumber };
  }

  async publish(input: { workId: string; revision: number; action: PublishAction; body: string }): Promise<PublishResult> {
    if (input.action !== 'issue-create' && input.action !== 'issue-comment') throw new ExternalWorkError('external_publication_invalid', 400);
    const workId = externalText(input.workId, 100);
    const revision = revisionNumber(input.revision);
    const body = outboundBody(input.body);
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const work = await this.#store.getWork(workId);
    if (!work) throw new ExternalWorkError('external_work_not_found', 404);
    const grant = await this.#store.getGrant(work.grantId);
    if (!grant || grant.grantVersion !== work.grantVersion) throw new ExternalWorkError('external_work_not_found', 404);
    const repositoryId = grant.repository.stableId;

    // An already-reserved identity returns its original attempt — repeats and
    // restarts never re-run the anchor guards and never re-dispatch.
    const existing = (await this.#store.listPublications(workId)).find(item => item.revision === revision && item.action === input.action);
    if (existing && existing.status !== 'prepared') {
      if (existing.bodyHash !== bodyHash) await this.#store.recordPublication({ workId, revision, action: input.action, bodyHash });
      return { attempt: existing, dispatched: false };
    }

    // Structural refusals happen before the identity is reserved, so the ledger keeps no dead rows.
    const anchor = await this.#anchor(workId, input.action);
    const attempt = existing ?? await this.#store.recordPublication({ workId, revision, action: input.action, bodyHash });
    if (attempt.status !== 'prepared') return { attempt, dispatched: false };

    let submitted: PublicationAttempt;
    try {
      submitted = await this.#store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
    } catch (error) {
      // Another live publisher owns this in-flight identity; report it without re-dispatching.
      if (error instanceof ExternalWorkError && error.code === 'external_publication_conflict') {
        const currentAttempt = await this.#store.getPublication(attempt.operationId);
        if (currentAttempt) return { attempt: currentAttempt, dispatched: false };
      }
      throw error;
    }

    let result: GithubDispatchResult;
    try {
      result = await this.#transport.dispatch({
        workId, revision, action: input.action, repositoryId,
        ...(input.action === 'issue-create' ? { title: work.summary } : { issueNumber: anchor.issueNumber }),
        body, bodyHash,
        hostContext: this.#hostContext?.() ?? {},
      });
    } catch {
      // A thrown transport is indistinguishable from a lost response: keep UNKNOWN, never re-send.
      return { attempt: await this.#store.transitionPublication(attempt.operationId, 'unknown', { expectedStatus: 'submitted' }), dispatched: true };
    }
    return { attempt: await this.#apply(submitted.operationId, result), dispatched: true };
  }

  async #apply(operationId: string, result: GithubDispatchResult): Promise<PublicationAttempt> {
    if (result.outcome === 'succeeded') {
      const repositoryId = receiptText(result.repositoryId, 300);
      // A success without an exact repository identity cannot be recorded; stay uncertain.
      if (!repositoryId) return this.#store.transitionPublication(operationId, 'unknown', { expectedStatus: 'submitted' });
      const issueId = receiptText(result.issueNumber === undefined ? undefined : String(result.issueNumber), 200);
      return this.#store.transitionPublication(operationId, 'succeeded', {
        expectedStatus: 'submitted',
        resultRef: { repositoryId, ...(receiptText(result.serviceRef, 300) !== undefined ? { serviceRef: receiptText(result.serviceRef, 300) } : {}), ...(issueId !== undefined ? { issueId } : {}) },
      });
    }
    if (result.outcome === 'rejected') return this.#store.transitionPublication(operationId, 'rejected', { expectedStatus: 'submitted' });
    return this.#store.transitionPublication(operationId, 'unknown', { expectedStatus: 'submitted' });
  }

  /**
   * Read-only reconciliation of a submitted/UNKNOWN attempt. It queries only
   * the probe, associates only one accurate match (exact repository, author
   * and outbound body version), reports a conflict on several, and leaves the
   * attempt uncertain otherwise — never creating or appending anything.
   */
  async reconcile(input: { operationId: string; author: string }): Promise<PublicationAttempt> {
    const operationId = externalText(input.operationId, 100);
    const author = externalText(input.author, 300);
    const attempt = await this.#store.getPublication(operationId);
    if (!attempt) throw new ExternalWorkError('external_publication_not_found', 404);
    if (attempt.status === 'succeeded' || attempt.status === 'rejected' || attempt.status === 'prepared') return attempt;
    const work = await this.#store.getWork(attempt.workId);
    const grant = work ? await this.#store.getGrant(work.grantId) : undefined;
    if (!work || !grant || grant.grantVersion !== work.grantVersion) throw new ExternalWorkError('external_work_not_found', 404);
    const repositoryId = grant.repository.stableId;
    const candidates = this.#probe ? await this.#probe.search({ repositoryId, bodyHash: attempt.bodyHash }) : [];
    const accurate = candidates.filter(item =>
      typeof item.repositoryId === 'string' && item.repositoryId.toLowerCase() === repositoryId.toLowerCase()
      && typeof item.bodyHash === 'string' && item.bodyHash === attempt.bodyHash
      && typeof item.author === 'string' && item.author === author);
    if (accurate.length > 1) throw new ExternalWorkError('external_publication_conflict', 409);
    if (accurate.length === 0) return attempt;
    const match = accurate[0]!;
    if (match.rejected === true) return this.#store.transitionPublication(operationId, 'rejected', { expectedStatus: attempt.status, reconciled: true });
    const issueId = receiptText(match.issueId, 200);
    return this.#store.transitionPublication(operationId, 'succeeded', {
      expectedStatus: attempt.status,
      reconciled: true,
      resultRef: { repositoryId, ...(issueId !== undefined ? { issueId } : {}) },
    });
  }
}

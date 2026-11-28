import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ExternalWorkError,
  externalDate, externalEpoch, externalHash, externalId, externalKeys, externalRecord,
  externalRevision, externalText, parseExternalAssetRefs,
} from './external-work-types.ts';
import type {
  Claim, ClaimStatus, ExternalDeliveryFacts, ExternalDeliveryRef, ExternalPublicationAction,
  ExternalPublicationStatus, ExternalRepositoryRef, ExternalResourcePolicy, ExternalReviewDecisionKind,
  ExternalWork, ExternalWorkStatus, InboxEvent, InternalChoice, PublicationAttempt,
  ResumeReceipt, ResumeStatus, ReviewDecision, WorkGrant,
} from './external-work-types.ts';

export type StoredExternalState = {
  schema: 1;
  version: number;
  grants: WorkGrant[];
  works: ExternalWork[];
  claims: Claim[];
  publications: PublicationAttempt[];
  deliveries: ExternalDeliveryRef[];
  reviews: ReviewDecision[];
  inboxEvents: InboxEvent[];
  resumeReceipts: ResumeReceipt[];
  internalChoices: InternalChoice[];
};

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS = 10000;
const PROCESS_INSTANCE = `${process.pid}:${randomUUID()}`;
const WORK_STATUSES: readonly ExternalWorkStatus[] = ['authorized', 'cancelled'];
const PUBLICATION_ACTIONS: readonly ExternalPublicationAction[] = ['issue-create', 'issue-comment', 'external-trigger'];
const PUBLICATION_STATUSES: readonly ExternalPublicationStatus[] = ['prepared', 'submitted', 'succeeded', 'rejected', 'unknown'];
const CLAIM_STATUSES: readonly ClaimStatus[] = ['active', 'released', 'revoked', 'expired'];
const PRESERVATIONS: readonly ExternalDeliveryRef['preservation'][] = ['pending', 'preserved', 'failed', 'unknown', 'link-only'];
const PRESERVED_OUTCOMES: readonly ExternalDeliveryRef['preservation'][] = ['preserved', 'failed', 'link-only'];
const REVIEW_DECISIONS: readonly ExternalReviewDecisionKind[] = ['accepted', 'needs-supplement', 'rejected'];
const RESUME_STATUSES: readonly ResumeStatus[] = ['reserved', 'accepted', 'settled', 'unknown'];
const emptyState = (): StoredExternalState => ({ schema: 1, version: 0, grants: [], works: [], claims: [], publications: [], deliveries: [], reviews: [], inboxEvents: [], resumeReceipts: [], internalChoices: [] });

/** Drop explicit `undefined` optional fields so strict key checks stay exact. */
function clean(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = item;
  return result;
}
function strings(value: unknown, max: number, count: number, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > count) throw new ExternalWorkError('external_record_invalid', 503);
  return value.map(item => allowEmpty && item === '' ? '' : externalText(item, max));
}
function policyValue(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new ExternalWorkError('external_record_invalid', 503);
  return Number(value);
}
function parsePolicy(value: unknown): ExternalResourcePolicy {
  if (!externalRecord(value)) throw new ExternalWorkError('external_record_invalid', 503);
  externalKeys(value, ['maxWorks', 'windowHours']);
  return { maxWorks: policyValue(value.maxWorks, 1000), windowHours: policyValue(value.windowHours, 24 * 366) };
}
function parseRepository(value: unknown): ExternalRepositoryRef {
  if (!externalRecord(value)) throw new ExternalWorkError('external_record_invalid', 503);
  externalKeys(value, ['stableId', 'visibility']);
  if (value.visibility !== 'private' && value.visibility !== 'public') throw new ExternalWorkError('external_record_invalid', 503);
  return { stableId: externalText(value.stableId, 300), visibility: value.visibility };
}
function parseSourceCaseRef(value: unknown): { caseId: string; issueId: string } {
  if (!externalRecord(value)) throw new ExternalWorkError('external_record_invalid', 503);
  externalKeys(value, ['caseId', 'issueId']);
  return { caseId: externalText(value.caseId, 200), issueId: externalText(value.issueId, 200) };
}

function parseGrant(input: unknown, corrupt = 'external_record_invalid'): WorkGrant {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['grantId', 'grantVersion', 'projectId', 'taskId', 'goal', 'scope', 'forbidden', 'allowedExecutors', 'repository', 'assetRefs', 'enterprise', 'validFrom', 'validUntil', 'resourcePolicy', 'autoResumeAllowed', 'createdAt', 'sourceCaseRef', 'sourceConvention']);
    const allowedExecutors = strings(input.allowedExecutors, 200, 50);
    if (!allowedExecutors.length || new Set(allowedExecutors).size !== allowedExecutors.length) throw new Error();
    const grant: WorkGrant = {
      grantId: externalId(input.grantId), grantVersion: externalRevision(input.grantVersion),
      projectId: externalId(input.projectId), taskId: externalId(input.taskId),
      goal: externalText(input.goal, 4000), scope: externalText(input.scope, 4000),
      forbidden: input.forbidden === '' ? '' : externalText(input.forbidden, 4000),
      allowedExecutors,
      repository: parseRepository(input.repository),
      assetRefs: parseExternalAssetRefs(input.assetRefs),
      enterprise: externalText(input.enterprise, 200),
      validFrom: externalDate(input.validFrom), validUntil: externalDate(input.validUntil),
      resourcePolicy: parsePolicy(input.resourcePolicy),
      autoResumeAllowed: input.autoResumeAllowed === true,
      createdAt: externalDate(input.createdAt),
    };
    if (!Number.isFinite(Date.parse(grant.validFrom)) || Date.parse(grant.validFrom) > Date.parse(grant.validUntil)) throw new Error();
    if (grant.assetRefs.length > 50) throw new Error();
    if (input.sourceCaseRef !== undefined) grant.sourceCaseRef = parseSourceCaseRef(input.sourceCaseRef);
    if (input.sourceConvention !== undefined) grant.sourceConvention = externalText(input.sourceConvention, 2000);
    return grant;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parseWork(input: unknown, corrupt = 'external_record_invalid'): ExternalWork {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['workId', 'projectId', 'taskId', 'revision', 'summary', 'deliveryCriteria', 'inputs', 'targetExecutor', 'grantId', 'grantVersion', 'status', 'createdAt', 'updatedAt']);
    const inputs = parseExternalAssetRefs(input.inputs);
    if (inputs.length > 50) throw new Error();
    const work: ExternalWork = {
      workId: externalId(input.workId), projectId: externalId(input.projectId), taskId: externalId(input.taskId),
      revision: externalRevision(input.revision),
      summary: externalText(input.summary, 4000), deliveryCriteria: externalText(input.deliveryCriteria, 4000),
      inputs,
      grantId: externalId(input.grantId), grantVersion: externalRevision(input.grantVersion),
      status: input.status as ExternalWorkStatus,
      createdAt: externalDate(input.createdAt), updatedAt: externalDate(input.updatedAt),
    };
    if (!WORK_STATUSES.includes(work.status)) throw new Error();
    if (input.targetExecutor !== undefined) work.targetExecutor = externalText(input.targetExecutor, 200);
    return work;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parsePublication(input: unknown, corrupt = 'external_record_invalid'): PublicationAttempt {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['operationId', 'workId', 'revision', 'action', 'bodyHash', 'serviceRef', 'repositoryId', 'issueId', 'submissionProcess', 'status', 'createdAt', 'updatedAt']);
    const attempt: PublicationAttempt = {
      operationId: externalId(input.operationId), workId: externalId(input.workId), revision: externalRevision(input.revision),
      action: input.action as ExternalPublicationAction, bodyHash: externalHash(input.bodyHash),
      status: input.status as ExternalPublicationStatus,
      createdAt: externalDate(input.createdAt), updatedAt: externalDate(input.updatedAt),
    };
    if (!PUBLICATION_ACTIONS.includes(attempt.action) || !PUBLICATION_STATUSES.includes(attempt.status)) throw new Error();
    if (input.serviceRef !== undefined) attempt.serviceRef = externalText(input.serviceRef, 300);
    if (input.repositoryId !== undefined) attempt.repositoryId = externalText(input.repositoryId, 300);
    if (input.issueId !== undefined) attempt.issueId = externalText(input.issueId, 200);
    if (attempt.status === 'succeeded' && !attempt.repositoryId) throw new Error();
    // Diagnostic only: which process performed the submission. Kept after later transitions.
    if (input.submissionProcess !== undefined) attempt.submissionProcess = externalText(input.submissionProcess, 100);
    return attempt;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parseClaim(input: unknown, corrupt = 'external_record_invalid'): Claim {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['claimId', 'workId', 'revision', 'principal', 'epoch', 'leaseDeadline', 'reason', 'status', 'createdAt', 'updatedAt']);
    const claim: Claim = {
      claimId: externalId(input.claimId), workId: externalId(input.workId), revision: externalRevision(input.revision),
      principal: externalText(input.principal, 300), epoch: externalEpoch(input.epoch),
      leaseDeadline: externalDate(input.leaseDeadline),
      status: input.status as ClaimStatus,
      createdAt: externalDate(input.createdAt), updatedAt: externalDate(input.updatedAt),
    };
    if (!CLAIM_STATUSES.includes(claim.status)) throw new Error();
    if (claim.status === 'active') { if (input.reason !== undefined) throw new Error(); }
    else claim.reason = externalText(input.reason, 500);
    return claim;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parseFacts(value: unknown): ExternalDeliveryFacts {
  if (!externalRecord(value)) throw new ExternalWorkError('external_record_invalid', 503);
  externalKeys(value, ['done', 'notDone', 'failed', 'unknown']);
  return { done: strings(value.done, 1000, 50), notDone: strings(value.notDone, 1000, 50), failed: strings(value.failed, 1000, 50), unknown: strings(value.unknown, 1000, 50) };
}
function parseStorageEntries(value: unknown): ExternalDeliveryRef['storage'] {
  if (!Array.isArray(value) || value.length > 20) throw new Error();
  return value.map(item => {
    if (!externalRecord(item)) throw new Error();
    externalKeys(item, ['logicalPath', 'relativePath', 'sha256', 'bytes']);
    if (!Number.isSafeInteger(item.bytes) || Number(item.bytes) < 0) throw new Error();
    return { logicalPath: externalText(item.logicalPath, 300), relativePath: externalText(item.relativePath, 400), sha256: externalHash(item.sha256), bytes: Number(item.bytes) };
  });
}
function parseLinkEntries(value: unknown): ExternalDeliveryRef['links'] {
  if (!Array.isArray(value) || value.length > 20) throw new Error();
  return value.map(item => {
    if (!externalRecord(item)) throw new Error();
    externalKeys(item, ['logicalPath', 'url']);
    return { logicalPath: externalText(item.logicalPath, 300), url: externalText(item.url, 2000) };
  });
}
function parseDelivery(input: unknown, corrupt = 'external_record_invalid'): ExternalDeliveryRef {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['deliveryId', 'workId', 'revision', 'claimId', 'idempotencyKey', 'manifestHash', 'preservation', 'storage', 'links', 'preservationReason', 'assetsUsed', 'facts', 'late', 'createdAt']);
    const delivery: ExternalDeliveryRef = {
      deliveryId: externalId(input.deliveryId), workId: externalId(input.workId), revision: externalRevision(input.revision),
      claimId: externalId(input.claimId), idempotencyKey: externalText(input.idempotencyKey, 200),
      manifestHash: externalHash(input.manifestHash),
      preservation: input.preservation as ExternalDeliveryRef['preservation'],
      assetsUsed: parseExternalAssetRefs(input.assetsUsed),
      facts: parseFacts(input.facts),
      late: input.late === true,
      createdAt: externalDate(input.createdAt),
    };
    if (!PRESERVATIONS.includes(delivery.preservation) || delivery.assetsUsed.length > 50) throw new Error();
    if (input.storage !== undefined) delivery.storage = parseStorageEntries(input.storage);
    if (input.links !== undefined) delivery.links = parseLinkEntries(input.links);
    if (input.preservationReason !== undefined) delivery.preservationReason = externalText(input.preservationReason, 500);
    // preserved 意味着本机已验字节；没有 storage 条目的 preserved 记录视为损坏。
    if (delivery.preservation === 'preserved' && !(delivery.storage?.length)) throw new Error();
    return delivery;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parseReview(input: unknown, corrupt = 'external_record_invalid'): ReviewDecision {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['reviewId', 'workId', 'deliveryId', 'decision', 'reason', 'deliveryHash', 'createdAt']);
    const review: ReviewDecision = {
      reviewId: externalId(input.reviewId), workId: externalId(input.workId), deliveryId: externalId(input.deliveryId),
      decision: input.decision as ExternalReviewDecisionKind,
      reason: externalText(input.reason, 2000), deliveryHash: externalHash(input.deliveryHash),
      createdAt: externalDate(input.createdAt),
    };
    if (!REVIEW_DECISIONS.includes(review.decision)) throw new Error();
    return review;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parseInboxEvent(input: unknown, corrupt = 'external_record_invalid'): InboxEvent {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['eventKey', 'projectId', 'taskId', 'workId', 'deliveryId', 'receivedAt']);
    const event: InboxEvent = {
      eventKey: externalText(input.eventKey, 300), projectId: externalId(input.projectId), taskId: externalId(input.taskId),
      receivedAt: externalDate(input.receivedAt),
    };
    if (input.workId !== undefined) event.workId = externalId(input.workId);
    if (input.deliveryId !== undefined) event.deliveryId = externalId(input.deliveryId);
    return event;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parseResumeReceipt(input: unknown, corrupt = 'external_record_invalid'): ResumeReceipt {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['requestId', 'projectId', 'taskId', 'workId', 'revision', 'deliveryId', 'status', 'createdAt', 'updatedAt']);
    const receipt: ResumeReceipt = {
      requestId: externalId(input.requestId), projectId: externalId(input.projectId), taskId: externalId(input.taskId),
      workId: externalId(input.workId), revision: externalRevision(input.revision), deliveryId: externalId(input.deliveryId),
      status: input.status as ResumeStatus,
      createdAt: externalDate(input.createdAt), updatedAt: externalDate(input.updatedAt),
    };
    if (!RESUME_STATUSES.includes(receipt.status)) throw new Error();
    return receipt;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}
function parseInternalChoice(input: unknown, corrupt = 'external_record_invalid'): InternalChoice {
  try {
    if (!externalRecord(input)) throw new Error();
    externalKeys(clean(input), ['projectId', 'taskId', 'mode', 'decidedAt']);
    if (input.mode !== 'internal') throw new Error();
    return { projectId: externalId(input.projectId), taskId: externalId(input.taskId), mode: 'internal', decidedAt: externalDate(input.decidedAt) };
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError(corrupt, corrupt === 'external_store_corrupt' ? 503 : 400); }
}

function parseState(input: unknown): StoredExternalState {
  const corrupt = (message = 'external_store_corrupt'): ExternalWorkError => new ExternalWorkError(message, 503);
  try {
    if (!externalRecord(input) || input.schema !== 1 || !Number.isSafeInteger(input.version) || Number(input.version) < 0) throw corrupt();
    externalKeys(input, ['schema', 'version', 'grants', 'works', 'claims', 'publications', 'deliveries', 'reviews', 'inboxEvents', 'resumeReceipts', 'internalChoices']);
    const lists = ['grants', 'works', 'claims', 'publications', 'deliveries', 'reviews', 'inboxEvents', 'resumeReceipts', 'internalChoices'] as const;
    for (const key of lists) { if (!Array.isArray(input[key]) || (input[key] as unknown[]).length > MAX_RECORDS) throw corrupt(); }
    const total = lists.reduce((sum, key) => sum + (input[key] as unknown[]).length, 0);
    if (total > MAX_RECORDS) throw corrupt('external_store_full');
    const state: StoredExternalState = { schema: 1, version: Number(input.version), grants: [], works: [], claims: [], publications: [], deliveries: [], reviews: [], inboxEvents: [], resumeReceipts: [], internalChoices: [] };
    state.grants = (input.grants as unknown[]).map(item => parseGrant(item, 'external_store_corrupt'));
    state.works = (input.works as unknown[]).map(item => parseWork(item, 'external_store_corrupt'));
    state.claims = (input.claims as unknown[]).map(item => parseClaim(item, 'external_store_corrupt'));
    state.publications = (input.publications as unknown[]).map(item => parsePublication(item, 'external_store_corrupt'));
    state.deliveries = (input.deliveries as unknown[]).map(item => parseDelivery(item, 'external_store_corrupt'));
    state.reviews = (input.reviews as unknown[]).map(item => parseReview(item, 'external_store_corrupt'));
    state.inboxEvents = (input.inboxEvents as unknown[]).map(item => parseInboxEvent(item, 'external_store_corrupt'));
    state.resumeReceipts = (input.resumeReceipts as unknown[]).map(item => parseResumeReceipt(item, 'external_store_corrupt'));
    state.internalChoices = (input.internalChoices as unknown[]).map(item => parseInternalChoice(item, 'external_store_corrupt'));
    const unique = <T, K>(items: T[], key: (item: T) => K, message = 'external_store_corrupt') => {
      const seen = new Set<K>();
      for (const item of items) { const identity = key(item); if (seen.has(identity)) throw corrupt(message); seen.add(identity); }
    };
    unique(state.grants, item => item.grantId);
    unique(state.works, item => item.workId);
    unique(state.claims, item => item.claimId);
    unique(state.publications, item => item.operationId);
    unique(state.deliveries, item => item.deliveryId);
    unique(state.deliveries, item => item.idempotencyKey);
    unique(state.reviews, item => item.reviewId);
    unique(state.inboxEvents, item => item.eventKey);
    unique(state.resumeReceipts, item => item.requestId);
    unique(state.internalChoices, item => `${item.projectId}\u0000${item.taskId}`);
    const grants = new Map(state.grants.map(item => [item.grantId, item]));
    const works = new Map(state.works.map(item => [item.workId, item]));
    const claims = new Map(state.claims.map(item => [item.claimId, item]));
    const deliveries = new Map(state.deliveries.map(item => [item.deliveryId, item]));
    const grantOf = (work: ExternalWork) => {
      const grant = grants.get(work.grantId);
      if (!grant || grant.grantVersion !== work.grantVersion || grant.projectId !== work.projectId || grant.taskId !== work.taskId) throw corrupt();
      return grant;
    };
    for (const work of state.works) grantOf(work);
    for (const claim of state.claims) {
      const work = works.get(claim.workId);
      if (!work || claim.revision > work.revision) throw corrupt();
    }
    for (const publication of state.publications) {
      const work = works.get(publication.workId);
      if (!work || publication.revision > work.revision) throw corrupt();
    }
    for (const delivery of state.deliveries) {
      const work = works.get(delivery.workId), claim = claims.get(delivery.claimId);
      if (!work || !claim || claim.workId !== delivery.workId || claim.revision !== delivery.revision) throw corrupt();
    }
    for (const review of state.reviews) {
      const delivery = deliveries.get(review.deliveryId);
      if (!delivery || delivery.workId !== review.workId || delivery.manifestHash !== review.deliveryHash) throw corrupt();
    }
    for (const event of state.inboxEvents) {
      if (event.workId !== undefined && !works.has(event.workId)) throw corrupt();
      if (event.deliveryId !== undefined && !deliveries.has(event.deliveryId)) throw corrupt();
    }
    for (const receipt of state.resumeReceipts) {
      const work = works.get(receipt.workId), delivery = deliveries.get(receipt.deliveryId);
      if (!work || !delivery || delivery.workId !== receipt.workId) throw corrupt();
    }
    return state;
  } catch (error) { if (error instanceof ExternalWorkError && error.code !== 'external_record_invalid') throw error; throw new ExternalWorkError('external_store_corrupt', 503); }
}

/**
 * One private atomic ledger keeps external-work business records apart from
 * native task results. Every mutation goes through a file lock plus an
 * expected-version CAS, so concurrent writers and restarts cannot produce
 * half records or silently revive uncertain external actions.
 */
export class ExternalWorkStore {
  readonly dataRoot: string;
  readonly root: string;
  readonly file: string;
  readonly lockPath: string;
  #ready = false;
  readonly #now: () => number;
  readonly #instance: string;
  constructor(options: { dataRoot: string; now?: () => number; instance?: string }) {
    this.#now = options.now ?? (() => Date.now());
    // Process identity for startup normalization; injectable so tests can
    // simulate a genuine restart without spawning a second process.
    this.#instance = options.instance ?? PROCESS_INSTANCE;
    this.dataRoot = path.resolve(options.dataRoot); this.root = path.join(this.dataRoot, 'external-work'); this.file = path.join(this.root, 'ledger.json'); this.lockPath = path.join(this.root, '.store.lock');
  }
  #stamp(): string { return new Date(this.#now()).toISOString(); }
  async #directory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ExternalWorkError('external_store_unsafe', 503);
    await chmod(directory, 0o700);
  }
  async init(): Promise<void> {
    await this.#directory(this.dataRoot); await this.#directory(this.root);
    await this.#locked(async () => {
      const existed = await this.#exists();
      const state = await this.#load(true);
      let changed = !existed;
      for (const publication of state.publications) {
        // An interrupted submission can have taken effect; startup never retries it.
        if (publication.status === 'submitted' && publication.submissionProcess !== this.#instance) { publication.status = 'unknown'; publication.updatedAt = this.#stamp(); changed = true; }
      }
      for (const claim of state.claims) {
        if (claim.status === 'active' && Date.parse(claim.leaseDeadline) <= this.#now()) { claim.status = 'expired'; claim.reason = 'lease_expired'; claim.updatedAt = this.#stamp(); changed = true; }
      }
      if (changed) await this.#save(state);
      else await chmod(this.file, 0o600);
    });
    this.#ready = true;
  }
  async #exists(): Promise<boolean> { try { await lstat(this.file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw new ExternalWorkError('external_store_unsafe', 503); } }
  #assertReady(): void { if (!this.#ready) throw new ExternalWorkError('external_store_not_initialized', 503); }
  async #regular(file: string, allowMissing = false): Promise<void> {
    try { const entry = await lstat(file); if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new ExternalWorkError('external_store_unsafe', 503); }
    catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return; if (error instanceof ExternalWorkError) throw error; throw new ExternalWorkError('external_store_unsafe', 503); }
  }
  async #load(allowMissing = false): Promise<StoredExternalState> {
    for (const directory of [this.dataRoot, this.root]) { const entry = await lstat(directory); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ExternalWorkError('external_store_unsafe', 503); }
    let handle;
    try {
      handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const entry = await handle.stat();
      if (!entry.isFile() || entry.nlink !== 1 || entry.size > MAX_FILE_BYTES) throw new Error();
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error();
      return parseState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw error instanceof ExternalWorkError ? error : new ExternalWorkError('external_store_corrupt', 503);
    } finally { await handle?.close(); }
  }
  async #save(state: StoredExternalState): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(state) + '\n');
    if (bytes.length > MAX_FILE_BYTES) throw new ExternalWorkError('external_store_full', 413);
    const temporary = path.join(this.root, `.ledger-${randomUUID()}.tmp`);
    let handle;
    try {
      await this.#regular(this.file, true);
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.chmod(0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, this.file);
      const directory = await open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) { if (error instanceof ExternalWorkError) throw error; throw new ExternalWorkError('external_store_write_failed', 503); }
    finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  }
  async #locked<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 5000;
    let handle;
    while (!handle) {
      try { handle = await open(this.lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ExternalWorkError('external_store_unsafe', 503);
        // A holder that releases between our EEXIST and this check is not an
        // integrity problem; the next O_EXCL attempt re-creates the lock.
        await this.#regular(this.lockPath, true);
        if (Date.now() >= deadline) throw new ExternalWorkError('external_store_busy', 409);
        await new Promise(resolve => setTimeout(resolve, 10 + Math.floor(Math.random() * 15)));
      }
    }
    const own = await handle.stat();
    try { await handle.writeFile(JSON.stringify({ process: PROCESS_INSTANCE, createdAt: new Date().toISOString() })); return await operation(); }
    finally {
      await handle.close();
      try { const current = await lstat(this.lockPath); if (current.ino === own.ino && current.dev === own.dev && current.isFile() && current.nlink === 1) await unlink(this.lockPath); }
      catch { /* A changed lock is never removed on another writer's behalf. */ }
    }
  }
  /** Exclusive read-modify-write with an expected-version guard; callers mutate the loaded state in place. */
  async mutate<T>(operation: (state: StoredExternalState) => T | Promise<T>, expectedVersion?: number): Promise<T> {
    this.#assertReady();
    return this.#locked(async () => {
      const state = await this.#load();
      if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion !== state.version)) throw new ExternalWorkError('external_store_conflict', 409);
      const value = await operation(state);
      state.version++; await this.#save(state);
      return structuredClone(value);
    });
  }
  async #change<T>(operation: (state: StoredExternalState) => T | Promise<T>): Promise<T> {
    // Internal mutations always apply to the newest committed state; the
    // expectedVersion CAS remains available to callers that need it.
    return this.mutate(operation);
  }
  #capacity(state: StoredExternalState, add = 1): void {
    const total = state.grants.length + state.works.length + state.claims.length + state.publications.length + state.deliveries.length + state.reviews.length + state.inboxEvents.length + state.resumeReceipts.length + state.internalChoices.length;
    if (total + add > MAX_RECORDS) throw new ExternalWorkError('external_store_full', 413);
  }
  async version(): Promise<number> { this.#assertReady(); return (await this.#load()).version; }

  async getGrant(grantId: string): Promise<WorkGrant | null> { this.#assertReady(); const grant = (await this.#load()).grants.find(item => item.grantId === externalId(grantId)); return grant ? structuredClone(grant) : null; }
  async listGrants(options: { projectId?: string; taskId?: string } = {}): Promise<WorkGrant[]> {
    this.#assertReady();
    const projectId = options.projectId === undefined ? undefined : externalId(options.projectId);
    const taskId = options.taskId === undefined ? undefined : externalId(options.taskId);
    return structuredClone((await this.#load()).grants.filter(grant => (projectId === undefined || grant.projectId === projectId) && (taskId === undefined || grant.taskId === taskId)));
  }
  async getWork(workId: string): Promise<ExternalWork | null> { this.#assertReady(); const work = (await this.#load()).works.find(item => item.workId === externalId(workId)); return work ? structuredClone(work) : null; }
  async listWorks(options: { projectId?: string; taskId?: string } = {}): Promise<ExternalWork[]> {
    this.#assertReady();
    const projectId = options.projectId === undefined ? undefined : externalId(options.projectId);
    const taskId = options.taskId === undefined ? undefined : externalId(options.taskId);
    return structuredClone((await this.#load()).works.filter(work => (projectId === undefined || work.projectId === projectId) && (taskId === undefined || work.taskId === taskId)));
  }
  async getClaim(claimId: string): Promise<Claim | null> { this.#assertReady(); const claim = (await this.#load()).claims.find(item => item.claimId === externalId(claimId)); return claim ? structuredClone(claim) : null; }
  async listClaims(workId: string): Promise<Claim[]> { this.#assertReady(); return structuredClone((await this.#load()).claims.filter(claim => claim.workId === externalId(workId))); }
  async getPublication(operationId: string): Promise<PublicationAttempt | null> { this.#assertReady(); const publication = (await this.#load()).publications.find(item => item.operationId === externalId(operationId)); return publication ? structuredClone(publication) : null; }
  async listPublications(workId: string, revision?: number): Promise<PublicationAttempt[]> {
    this.#assertReady();
    const target = externalId(workId);
    return structuredClone((await this.#load()).publications.filter(publication => publication.workId === target && (revision === undefined || publication.revision === externalRevision(revision))));
  }
  async getDelivery(deliveryId: string): Promise<ExternalDeliveryRef | null> { this.#assertReady(); const delivery = (await this.#load()).deliveries.find(item => item.deliveryId === externalId(deliveryId)); return delivery ? structuredClone(delivery) : null; }
  async listDeliveries(workId: string): Promise<ExternalDeliveryRef[]> { this.#assertReady(); return structuredClone((await this.#load()).deliveries.filter(delivery => delivery.workId === externalId(workId))); }
  async listReviews(workId: string): Promise<ReviewDecision[]> { this.#assertReady(); return structuredClone((await this.#load()).reviews.filter(review => review.workId === externalId(workId))); }
  async listInboxEvents(projectId: string, taskId: string): Promise<InboxEvent[]> { this.#assertReady(); const owner = { projectId: externalId(projectId), taskId: externalId(taskId) }; return structuredClone((await this.#load()).inboxEvents.filter(event => event.projectId === owner.projectId && event.taskId === owner.taskId)); }
  async listResumeReceipts(projectId: string, taskId: string): Promise<ResumeReceipt[]> { this.#assertReady(); const owner = { projectId: externalId(projectId), taskId: externalId(taskId) }; return structuredClone((await this.#load()).resumeReceipts.filter(receipt => receipt.projectId === owner.projectId && receipt.taskId === owner.taskId)); }
  async getInternalChoice(projectId: string, taskId: string): Promise<InternalChoice | null> {
    this.#assertReady();
    const owner = { projectId: externalId(projectId), taskId: externalId(taskId) };
    return structuredClone((await this.#load()).internalChoices.find(item => item.projectId === owner.projectId && item.taskId === owner.taskId) ?? null);
  }
  async listInternalChoices(): Promise<InternalChoice[]> { this.#assertReady(); return structuredClone((await this.#load()).internalChoices); }

  /** Persist the initial grant together with its revision-1 work atomically. */
  async createGrantWithWork(grantInput: WorkGrant, workInput: ExternalWork, expectedVersion?: number): Promise<{ grant: WorkGrant; work: ExternalWork }> {
    const grant = parseGrant(grantInput, 'external_grant_invalid');
    const work = parseWork(workInput, 'external_work_invalid');
    grant.createdAt = this.#stamp();
    work.createdAt = this.#stamp(); work.updatedAt = this.#stamp();
    if (work.revision !== 1) throw new ExternalWorkError('external_work_invalid', 400);
    if (work.grantId !== grant.grantId || work.grantVersion !== grant.grantVersion || work.projectId !== grant.projectId || work.taskId !== grant.taskId) throw new ExternalWorkError('external_work_invalid', 400);
    return this.mutate(state => {
      if (state.grants.some(item => item.grantId === grant.grantId) || state.works.some(item => item.workId === work.workId)) throw new ExternalWorkError('external_record_conflict', 409);
      this.#capacity(state, 2);
      state.grants.push(grant); state.works.push(work);
      return { grant: structuredClone(grant), work: structuredClone(work) };
    }, expectedVersion);
  }
  /** Durable "this task proceeds internally" intent; one record per task, zero external records. */
  async recordInternalChoice(input: { projectId: string; taskId: string }): Promise<InternalChoice> {
    const choice: InternalChoice = { projectId: externalId(input.projectId), taskId: externalId(input.taskId), mode: 'internal', decidedAt: this.#stamp() };
    return this.#change(state => {
      const existing = state.internalChoices.find(item => item.projectId === choice.projectId && item.taskId === choice.taskId);
      if (existing) { existing.decidedAt = choice.decidedAt; return structuredClone(existing); }
      this.#capacity(state);
      state.internalChoices.push(choice);
      return structuredClone(choice);
    });
  }
  /** Host-side work cancellation: zero external action, active claims lose validity, facts stay. */
  async cancelWork(workId: string, reason: string): Promise<ExternalWork> {
    const target = externalId(workId), why = externalText(reason, 500);
    return this.#change(state => {
      const work = state.works.find(item => item.workId === target);
      if (!work) throw new ExternalWorkError('external_work_not_found', 404);
      if (work.status === 'cancelled') return structuredClone(work);
      work.status = 'cancelled'; work.updatedAt = this.#stamp();
      for (const claim of state.claims) {
        if (claim.workId === target && claim.status === 'active') { claim.status = 'revoked'; claim.reason = why; claim.updatedAt = this.#stamp(); }
      }
      return structuredClone(work);
    });
  }
  /** Reserve the unique per-(work, revision, action) publication identity. Same body returns the original attempt. */
  async recordPublication(input: { workId: string; revision: number; action: ExternalPublicationAction; bodyHash: string }): Promise<PublicationAttempt> {
    const request = { workId: externalId(input.workId), revision: externalRevision(input.revision), action: input.action as ExternalPublicationAction, bodyHash: externalHash(input.bodyHash) };
    if (!PUBLICATION_ACTIONS.includes(request.action)) throw new ExternalWorkError('external_publication_invalid', 400);
    return this.#change(state => {
      const work = state.works.find(item => item.workId === request.workId);
      if (!work) throw new ExternalWorkError('external_work_not_found', 404);
      if (work.status === 'cancelled') throw new ExternalWorkError('external_work_cancelled', 409);
      if (request.revision > work.revision) throw new ExternalWorkError('external_publication_invalid', 400);
      const existing = state.publications.find(item => item.workId === request.workId && item.revision === request.revision && item.action === request.action);
      if (existing) {
        if (existing.bodyHash !== request.bodyHash) throw new ExternalWorkError('external_publication_conflict', 409);
        return structuredClone(existing);
      }
      this.#capacity(state);
      const attempt: PublicationAttempt = { operationId: randomUUID(), ...request, status: 'prepared', createdAt: this.#stamp(), updatedAt: this.#stamp() };
      state.publications.push(attempt);
      return structuredClone(attempt);
    });
  }
  async transitionPublication(operationId: string, status: ExternalPublicationStatus, options: { expectedStatus?: ExternalPublicationStatus; reconciled?: boolean; resultRef?: { serviceRef?: string; repositoryId?: string; issueId?: string } } = {}): Promise<PublicationAttempt> {
    const target = externalId(operationId);
    if (!PUBLICATION_STATUSES.includes(status)) throw new ExternalWorkError('external_publication_invalid', 400);
    return this.#change(state => {
      const attempt = state.publications.find(item => item.operationId === target);
      if (!attempt) throw new ExternalWorkError('external_publication_not_found', 404);
      if (options.expectedStatus !== undefined && attempt.status !== options.expectedStatus) throw new ExternalWorkError('external_publication_conflict', 409);
      const allowed: Record<ExternalPublicationStatus, ExternalPublicationStatus[]> = { prepared: ['submitted', 'rejected'], submitted: ['succeeded', 'rejected', 'unknown'], unknown: options.reconciled === true ? ['succeeded', 'rejected'] : [], succeeded: [], rejected: [] };
      if (!allowed[attempt.status].includes(status)) throw new ExternalWorkError('external_publication_transition_forbidden', 409);
      if (status === 'submitted') attempt.submissionProcess = this.#instance;
      if (status === 'succeeded') {
        if (!options.resultRef?.repositoryId) throw new ExternalWorkError('external_publication_result_required', 400);
        if (options.resultRef.serviceRef !== undefined) attempt.serviceRef = externalText(options.resultRef.serviceRef, 300);
        attempt.repositoryId = externalText(options.resultRef.repositoryId, 300);
        if (options.resultRef.issueId !== undefined) attempt.issueId = externalText(options.resultRef.issueId, 200);
      }
      attempt.status = status; attempt.updatedAt = this.#stamp();
      return structuredClone(attempt);
    });
  }
  /**
   * Atomic single-claim ledger: one active claim per (work, revision). The
   * same principal repeating its request receives the original receipt;
   * competitors receive a conflict. Leases are capped by grant validity.
   */
  async recordClaim(input: { workId: string; revision: number; principal: string; leaseDeadline: string }): Promise<{ claim: Claim; idempotent: boolean }> {
    const request = { workId: externalId(input.workId), revision: externalRevision(input.revision), principal: externalText(input.principal, 300) };
    const requestedDeadline = externalDate(input.leaseDeadline);
    return this.#change(state => {
      const work = state.works.find(item => item.workId === request.workId);
      if (!work) throw new ExternalWorkError('external_work_not_found', 404);
      if (work.status === 'cancelled') throw new ExternalWorkError('external_work_cancelled', 409);
      if (request.revision > work.revision) throw new ExternalWorkError('external_claim_not_permitted', 403);
      const published = state.publications.some(item => item.workId === request.workId && item.revision === request.revision && item.status === 'succeeded');
      if (!published) throw new ExternalWorkError('external_claim_not_permitted', 403);
      const grant = state.grants.find(item => item.grantId === work.grantId && item.grantVersion === work.grantVersion);
      if (!grant || Date.parse(grant.validUntil) <= this.#now()) throw new ExternalWorkError('external_grant_not_valid', 409);
      if (!grant.allowedExecutors.includes(request.principal)) throw new ExternalWorkError('external_claim_not_permitted', 403);
      if (Date.parse(requestedDeadline) <= this.#now()) throw new ExternalWorkError('external_claim_lease_invalid', 400);
      const active = state.claims.find(item => item.workId === request.workId && item.revision === request.revision && item.status === 'active');
      if (active) {
        if (active.principal !== request.principal) throw new ExternalWorkError('external_claim_conflict', 409);
        return { claim: structuredClone(active), idempotent: true };
      }
      this.#capacity(state);
      const epoch = state.claims.filter(item => item.workId === request.workId && item.revision === request.revision).reduce((max, item) => Math.max(max, item.epoch), 0) + 1;
      const claim: Claim = { claimId: randomUUID(), workId: request.workId, revision: request.revision, principal: request.principal, epoch, leaseDeadline: Date.parse(grant.validUntil) < Date.parse(requestedDeadline) ? grant.validUntil : requestedDeadline, status: 'active', createdAt: this.#stamp(), updatedAt: this.#stamp() };
      state.claims.push(claim);
      return { claim: structuredClone(claim), idempotent: false };
    });
  }
  #claimForMutation(state: StoredExternalState, input: { workId: string; revision: number; claimId: string; epoch: number }): Claim {
    const claim = state.claims.find(item => item.claimId === externalId(input.claimId));
    if (!claim || claim.workId !== externalId(input.workId) || claim.revision !== externalRevision(input.revision)) throw new ExternalWorkError('external_claim_not_found', 404);
    if (claim.epoch !== externalEpoch(input.epoch)) throw new ExternalWorkError('external_claim_epoch_conflict', 409);
    if (claim.status !== 'active') throw new ExternalWorkError('external_claim_conflict', 409);
    return claim;
  }
  /**
   * Persist the expiry fact before reporting it, so a late release/renewal
   * leaves a durable expired record instead of discarding the fact with the
   * failed mutation. Only the matching epoch can trigger this normalization.
   */
  async #expireIfLapsed(input: { workId: string; revision: number; claimId: string; epoch: number }): Promise<boolean> {
    return this.#change(state => {
      const claim = state.claims.find(item => item.claimId === externalId(input.claimId) && item.workId === externalId(input.workId) && item.revision === externalRevision(input.revision));
      if (!claim || claim.epoch !== externalEpoch(input.epoch)) return false;
      if (claim.status === 'active' && Date.parse(claim.leaseDeadline) <= this.#now()) {
        claim.status = 'expired'; claim.reason = 'lease_expired'; claim.updatedAt = this.#stamp();
        return true;
      }
      return false;
    });
  }
  async renewClaim(input: { workId: string; revision: number; claimId: string; epoch: number; leaseDeadline: string }): Promise<Claim> {
    const requestedDeadline = externalDate(input.leaseDeadline);
    if (await this.#expireIfLapsed(input)) throw new ExternalWorkError('external_claim_expired', 409);
    return this.#change(state => {
      const claim = this.#claimForMutation(state, input);
      const work = state.works.find(item => item.workId === claim.workId)!;
      const grant = state.grants.find(item => item.grantId === work.grantId && item.grantVersion === work.grantVersion);
      if (!grant || Date.parse(grant.validUntil) <= this.#now()) throw new ExternalWorkError('external_grant_not_valid', 409);
      if (Date.parse(requestedDeadline) <= this.#now()) throw new ExternalWorkError('external_claim_lease_invalid', 400);
      claim.leaseDeadline = Date.parse(grant.validUntil) < Date.parse(requestedDeadline) ? grant.validUntil : requestedDeadline;
      claim.updatedAt = this.#stamp();
      return structuredClone(claim);
    });
  }
  async releaseClaim(input: { workId: string; revision: number; claimId: string; epoch: number; reason: string }): Promise<Claim> {
    const reason = externalText(input.reason, 500);
    if (await this.#expireIfLapsed(input)) throw new ExternalWorkError('external_claim_expired', 409);
    return this.#change(state => {
      const claim = this.#claimForMutation(state, input);
      claim.status = 'released'; claim.reason = reason; claim.updatedAt = this.#stamp();
      return structuredClone(claim);
    });
  }
  /** Deliveries bind to the current active claim; the idempotency key admits exactly one content. */
  async recordDelivery(input: { workId: string; revision: number; claimId: string; idempotencyKey: string; manifestHash: string; assetsUsed?: ExternalDeliveryRef['assetsUsed']; facts?: ExternalDeliveryFacts; late?: boolean }): Promise<{ delivery: ExternalDeliveryRef; idempotent: boolean }> {    const request = { workId: externalId(input.workId), revision: externalRevision(input.revision), claimId: externalId(input.claimId), idempotencyKey: externalText(input.idempotencyKey, 200), manifestHash: externalHash(input.manifestHash) };
    const assetsUsed = input.assetsUsed === undefined ? [] : parseExternalAssetRefs(input.assetsUsed);
    const facts: ExternalDeliveryFacts = input.facts === undefined ? { done: [], notDone: [], failed: [], unknown: [] } : parseFacts(input.facts);
    const late = input.late === true;
    return this.#change(state => {
      const work = state.works.find(item => item.workId === request.workId);
      if (!work || request.revision > work.revision) throw new ExternalWorkError('external_delivery_invalid', 400);
      const claim = state.claims.find(item => item.claimId === request.claimId);
      if (!claim || claim.workId !== request.workId || claim.revision !== request.revision || claim.status !== 'active') throw new ExternalWorkError('external_delivery_claim_invalid', 409);
      const existing = state.deliveries.find(item => item.idempotencyKey === request.idempotencyKey);
      if (existing) {
        if (existing.manifestHash !== request.manifestHash) throw new ExternalWorkError('external_delivery_conflict', 409);
        return { delivery: structuredClone(existing), idempotent: true };
      }
      this.#capacity(state);
      const delivery: ExternalDeliveryRef = { deliveryId: randomUUID(), ...request, preservation: 'pending', assetsUsed, facts, late, createdAt: this.#stamp() };
      state.deliveries.push(delivery);
      return { delivery: structuredClone(delivery), idempotent: false };
    });
  }
  /** Review decisions bind the exact delivered hash; they never rewrite the delivery. */
  async recordReview(input: { workId: string; deliveryId: string; decision: ExternalReviewDecisionKind; reason: string; deliveryHash: string }): Promise<ReviewDecision> {
    const request = { workId: externalId(input.workId), deliveryId: externalId(input.deliveryId), decision: input.decision as ExternalReviewDecisionKind, reason: externalText(input.reason, 2000), deliveryHash: externalHash(input.deliveryHash) };
    if (!REVIEW_DECISIONS.includes(request.decision)) throw new ExternalWorkError('external_review_invalid', 400);
    return this.#change(state => {
      const delivery = state.deliveries.find(item => item.deliveryId === request.deliveryId);
      if (!delivery || delivery.workId !== request.workId) throw new ExternalWorkError('external_delivery_not_found', 404);
      if (delivery.manifestHash !== request.deliveryHash) throw new ExternalWorkError('external_review_hash_conflict', 409);
      this.#capacity(state);
      const review: ReviewDecision = { reviewId: randomUUID(), ...request, createdAt: this.#stamp() };
      state.reviews.push(review);
      return structuredClone(review);
    });
  }
  async recordInboxEvent(input: { eventKey: string; projectId: string; taskId: string; workId?: string; deliveryId?: string }): Promise<{ event: InboxEvent; idempotent: boolean }> {
    const event = parseInboxEvent({ ...input, receivedAt: this.#stamp() }, 'external_record_invalid');
    return this.#change(state => {
      const existing = state.inboxEvents.find(item => item.eventKey === event.eventKey);
      if (existing) return { event: structuredClone(existing), idempotent: true };
      if (event.workId !== undefined && !state.works.some(item => item.workId === event.workId)) throw new ExternalWorkError('external_record_invalid', 400);
      if (event.deliveryId !== undefined && !state.deliveries.some(item => item.deliveryId === event.deliveryId)) throw new ExternalWorkError('external_record_invalid', 400);
      this.#capacity(state);
      state.inboxEvents.push(event);
      return { event: structuredClone(event), idempotent: false };
    });
  }
  /** Stable resume requestId reserved before dispatch; identical repeats return the original receipt. */
  async recordResumeReceipt(input: { requestId: string; projectId: string; taskId: string; workId: string; revision: number; deliveryId: string; status?: ResumeStatus }): Promise<{ receipt: ResumeReceipt; idempotent: boolean }> {
    const receipt = parseResumeReceipt({ ...input, status: input.status ?? 'reserved', createdAt: this.#stamp(), updatedAt: this.#stamp() }, 'external_record_invalid');
    return this.#change(state => {
      const existing = state.resumeReceipts.find(item => item.requestId === receipt.requestId);
      if (existing) {
        if (existing.projectId !== receipt.projectId || existing.taskId !== receipt.taskId || existing.workId !== receipt.workId || existing.revision !== receipt.revision || existing.deliveryId !== receipt.deliveryId) throw new ExternalWorkError('external_resume_conflict', 409);
        return { receipt: structuredClone(existing), idempotent: true };
      }
      const work = state.works.find(item => item.workId === receipt.workId);
      const delivery = state.deliveries.find(item => item.deliveryId === receipt.deliveryId);
      if (!work || !delivery || delivery.workId !== receipt.workId) throw new ExternalWorkError('external_record_invalid', 400);
      this.#capacity(state);
      state.resumeReceipts.push(receipt);
      return { receipt: structuredClone(receipt), idempotent: false };
    });
  }

  // —— S4a 交付保全扩展（schema 兼容；S1 recordDelivery 语义保持不动） ——

  async findDeliveryByIdempotencyKey(key: string): Promise<ExternalDeliveryRef | null> {
    this.#assertReady();
    const idempotencyKey = externalText(key, 200);
    const found = (await this.#load()).deliveries.find(item => item.idempotencyKey === idempotencyKey);
    return found ? structuredClone(found) : null;
  }

  /**
   * 字节保全交付落账（delivery.commit 当前领取路径）。幂等键先回原收据/异文冲突；新记录
   * 在同一原子变体内复核当前领取/授权（claim active、epoch、grant 窗口）——即"异步保存后
   * 提交前核当前领取/授权"，过期/撤销不可在此刻标完整。preservation 仅允许
   * preserved（须带非空 storage）/failed/link-only；late 恒为 false（迟到证据走
   * recordLateDelivery，绝不保字节）。
   */
  async recordPreservedDelivery(input: {
    workId: string; revision: number; claimId: string; epoch: number; idempotencyKey: string; manifestHash: string;
    preservation: 'preserved' | 'failed' | 'link-only'; storage?: ExternalDeliveryRef['storage'];
    links?: ExternalDeliveryRef['links']; preservationReason?: string;
    assetsUsed?: ExternalDeliveryRef['assetsUsed']; facts?: ExternalDeliveryFacts;
  }): Promise<{ delivery: ExternalDeliveryRef; idempotent: boolean }> {
    const request = { workId: externalId(input.workId), revision: externalRevision(input.revision), claimId: externalId(input.claimId), epoch: externalEpoch(input.epoch), idempotencyKey: externalText(input.idempotencyKey, 200), manifestHash: externalHash(input.manifestHash) };
    if (!PRESERVED_OUTCOMES.includes(input.preservation)) throw new ExternalWorkError('external_delivery_invalid', 400);
    const storage = input.storage === undefined ? undefined : parseStorageEntries(input.storage);
    const links = input.links === undefined ? undefined : parseLinkEntries(input.links);
    const reason = input.preservationReason === undefined ? undefined : externalText(input.preservationReason, 500);
    const assetsUsed = input.assetsUsed === undefined ? [] : parseExternalAssetRefs(input.assetsUsed);
    const facts: ExternalDeliveryFacts = input.facts === undefined ? { done: [], notDone: [], failed: [], unknown: [] } : parseFacts(input.facts);
    if (input.preservation === 'preserved' && !(storage?.length)) throw new ExternalWorkError('external_delivery_invalid', 400);
    return this.#change(state => {
      const work = state.works.find(item => item.workId === request.workId);
      if (!work || request.revision > work.revision) throw new ExternalWorkError('external_delivery_invalid', 400);
      const existing = state.deliveries.find(item => item.idempotencyKey === request.idempotencyKey);
      if (existing) {
        if (existing.manifestHash !== request.manifestHash) throw new ExternalWorkError('external_delivery_conflict', 409);
        return { delivery: structuredClone(existing), idempotent: true };
      }
      const claim = state.claims.find(item => item.claimId === request.claimId);
      if (!claim || claim.workId !== request.workId || claim.revision !== request.revision || claim.status !== 'active') throw new ExternalWorkError('external_delivery_claim_invalid', 409);
      if (claim.epoch !== request.epoch) throw new ExternalWorkError('external_delivery_epoch_conflict', 409);
      const grant = state.grants.find(item => item.grantId === work.grantId && item.grantVersion === work.grantVersion);
      const now = this.#now();
      if (!grant || !(Date.parse(grant.validFrom) <= now && now < Date.parse(grant.validUntil))) throw new ExternalWorkError('external_grant_not_valid', 409);
      this.#capacity(state);
      const delivery: ExternalDeliveryRef = {
        deliveryId: randomUUID(), workId: request.workId, revision: request.revision, claimId: request.claimId,
        idempotencyKey: request.idempotencyKey, manifestHash: request.manifestHash,
        preservation: input.preservation, assetsUsed, facts, late: false, createdAt: this.#stamp(),
      };
      if (storage !== undefined) delivery.storage = storage;
      if (links !== undefined) delivery.links = links;
      if (reason !== undefined) delivery.preservationReason = reason;
      state.deliveries.push(delivery);
      return { delivery: structuredClone(delivery), idempotent: false };
    });
  }

  /**
   * 迟到隔离证据（S3b work-tools 的迟到不变式回并至台账单一来源）：历史已授权身份（非
   * active 领取）可提交隔离迟到证据——引用完整、幂等键唯一、容量上限，late=true 且
   * preservation 恒为 pending，不覆盖当前交付、不恢复资产资格；active 领取必须走当前路径。
   */
  async recordLateDelivery(input: { workId: string; revision: number; claimId: string; idempotencyKey: string; manifestHash: string; assetsUsed?: ExternalDeliveryRef['assetsUsed']; facts?: ExternalDeliveryFacts }): Promise<{ delivery: ExternalDeliveryRef; idempotent: boolean }> {
    const request = { workId: externalId(input.workId), revision: externalRevision(input.revision), claimId: externalId(input.claimId), idempotencyKey: externalText(input.idempotencyKey, 200), manifestHash: externalHash(input.manifestHash) };
    const assetsUsed = input.assetsUsed === undefined ? [] : parseExternalAssetRefs(input.assetsUsed);
    const facts: ExternalDeliveryFacts = input.facts === undefined ? { done: [], notDone: [], failed: [], unknown: [] } : parseFacts(input.facts);
    return this.#change(state => {
      const work = state.works.find(item => item.workId === request.workId);
      if (!work || request.revision > work.revision) throw new ExternalWorkError('external_delivery_invalid', 400);
      const claim = state.claims.find(item => item.claimId === request.claimId);
      if (!claim || claim.workId !== request.workId || claim.revision !== request.revision) throw new ExternalWorkError('external_delivery_claim_invalid', 409);
      if (claim.status === 'active') throw new ExternalWorkError('external_delivery_epoch_conflict', 409);
      const existing = state.deliveries.find(item => item.idempotencyKey === request.idempotencyKey);
      if (existing) {
        if (existing.manifestHash !== request.manifestHash) throw new ExternalWorkError('external_delivery_conflict', 409);
        return { delivery: structuredClone(existing), idempotent: true };
      }
      this.#capacity(state);
      const delivery: ExternalDeliveryRef = {
        deliveryId: randomUUID(), workId: request.workId, revision: request.revision, claimId: request.claimId,
        idempotencyKey: request.idempotencyKey, manifestHash: request.manifestHash,
        preservation: 'pending', assetsUsed, facts, late: true, createdAt: this.#stamp(),
      };
      state.deliveries.push(delivery);
      return { delivery: structuredClone(delivery), idempotent: false };
    });
  }
}

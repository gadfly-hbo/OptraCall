import { randomUUID, createHash } from 'node:crypto';
import {
  DEFAULT_EXTERNAL_RESOURCE_POLICY, ExternalWorkError,
  externalAssetRefText, externalDate, externalText, parseExternalAssetRef,
} from './external-work-types.ts';
import type {
  ExternalAssetRef, ExternalRepositoryRef, ExternalResourcePolicy, ExternalTaskSummary,
  ExternalWork, ExternalWorkSummaryEntry, InternalChoice, WorkGrant,
} from './external-work-types.ts';
import type { ExternalStopRequestRecord, ExternalStopRequestStatus, ExecutorAttempt, ExternalWorkStore } from './external-work-store.ts';
import type { ExternalPublisher, PublishAction, PublishResult } from './external-publish.ts';

/** Optional WorkBuddy trigger port (S5); the Host injects the ready adapter, dispatch adds the mode gate. */
export type WorkBuddyTriggerPort = { trigger(input: { workId: string; revision: number }): Promise<{ attempt: ExecutorAttempt; dispatched: boolean }> };

/** Stable per-work external-stop request identity (uuid-shaped, never a claim or delivery id). */
export const externalStopRequestId = (workId: string): string => {
  const hash = createHash('sha256').update(JSON.stringify(['optracall-external-stop-v1', externalText(workId, 100)])).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-${((parseInt(hash[16]!,16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
};

/** Host-supplied profile view; the derived server.ts admission rules stay the single source. */
export type ExternalTaskProfile = { externalDispatchAllowed: boolean; reason?: string };
export type ExternalProfileLookup = (projectId: string, taskId: string) => ExternalTaskProfile | undefined;
/** Injected original-qualification seam: returns the qualified exact asset ref keys for this project. */
export type ExternalAssetQualification = (projectId: string, refs: ExternalAssetRef[]) => Promise<Set<string>> | Set<string>;

export type ExternalGrantInput = {
  goal: string;
  scope: string;
  forbidden: string;
  allowedExecutors: string[];
  repository: ExternalRepositoryRef;
  assetRefs: ExternalAssetRef[];
  enterprise: string;
  validUntil: string;
  summary: string;
  deliveryCriteria: string;
  targetExecutor?: string;
  inputs?: ExternalAssetRef[];
  resourcePolicy?: { maxWorks?: number; windowHours?: number };
  autoResumeAllowed?: boolean;
  sourceCaseRef?: { caseId: string; issueId: string };
  sourceConvention?: string;
};

type NormalizedGrant = {
  goal: string; scope: string; forbidden: string;
  allowedExecutors: string[];
  repository: ExternalRepositoryRef;
  assetRefs: ExternalAssetRef[]; inputs: ExternalAssetRef[];
  enterprise: string;
  validUntil: string;
  summary: string; deliveryCriteria: string;
  targetExecutor?: string;
  resourcePolicy: ExternalResourcePolicy;
  autoResumeAllowed: boolean;
  sourceCaseRef?: { caseId: string; issueId: string };
  sourceConvention?: string;
};

const HOUR_MS = 3_600_000;

/**
 * Owner-bound dispatch facade. The Host constructs it with a narrow store and
 * injected qualification/profile seams; it never exposes the session domain,
 * credentials, arbitrary sessionFiles or workspaces. Authorization records
 * intent and facts only. GitHub publication is reachable only through an
 * injected Host-built ExternalPublisher; triggering and asset access belong
 * to later slices and stay unreachable from here.
 */
export class ExternalDispatch {
  readonly #store: ExternalWorkStore;
  readonly #profiles: ExternalProfileLookup;
  readonly #qualifyAssets: ExternalAssetQualification;
  readonly #publisher?: ExternalPublisher;
  readonly #requestExternalStop?: (input: { workId: string; reason: string }) => Promise<{ outcome: 'confirmed' | 'unknown' | 'failed' | 'unsupported'; detail?: string }>;
  readonly #workbuddy?: WorkBuddyTriggerPort;
  readonly #now: () => number;
  constructor(options: { store: ExternalWorkStore; profiles: ExternalProfileLookup; qualifyAssets: ExternalAssetQualification; now?: () => number; publisher?: ExternalPublisher; requestExternalStop?: (input: { workId: string; reason: string }) => Promise<{ outcome: 'confirmed' | 'unknown' | 'failed' | 'unsupported'; detail?: string }>; workbuddy?: WorkBuddyTriggerPort }) {
    this.#store = options.store;
    this.#profiles = options.profiles;
    this.#qualifyAssets = options.qualifyAssets;
    this.#publisher = options.publisher;
    this.#requestExternalStop = options.requestExternalStop;
    this.#workbuddy = options.workbuddy;
    this.#now = options.now ?? (() => Date.now());
  }

  #owner(projectId: string, taskId: string): { projectId: string; taskId: string } {
    return { projectId: externalText(projectId, 100), taskId: externalText(taskId, 100) };
  }

  #normalizeGrantInput(input: ExternalGrantInput): NormalizedGrant {
    const fail = (code: string, status = 400): never => { throw new ExternalWorkError(code, status); };
    if (typeof input !== 'object' || input === null) fail('external_grant_invalid');
    const text = (value: unknown, max: number, code = 'external_grant_invalid'): string => { try { return externalText(value, max); } catch { return fail(code); } };
    const allowedExecutors = Array.isArray(input.allowedExecutors) ? input.allowedExecutors.map(item => text(item, 200)) : fail('external_grant_invalid');
    if (!allowedExecutors.length || allowedExecutors.length > 50 || new Set(allowedExecutors).size !== allowedExecutors.length) fail('external_grant_invalid');
    const repository = typeof input.repository === 'object' && input.repository !== null
      && (input.repository.visibility === 'private' || input.repository.visibility === 'public')
      ? { stableId: text(input.repository.stableId, 300), visibility: input.repository.visibility }
      : fail('external_grant_invalid');
    const assetRef = (value: unknown): ExternalAssetRef => { try { return parseExternalAssetRef(value); } catch { return fail('external_grant_invalid'); } };
    const assetRefs = Array.isArray(input.assetRefs) ? input.assetRefs.map(assetRef) : fail('external_grant_invalid');
    if (assetRefs.length > 50) fail('external_grant_invalid');
    const inputs = input.inputs === undefined ? [] : Array.isArray(input.inputs) ? input.inputs.map(assetRef) : fail('external_grant_invalid');
    if (inputs.length > 50) fail('external_grant_invalid');
    const enterprise = text(input.enterprise, 200, 'external_enterprise_required');
    let validUntil = '';
    try { validUntil = externalDate(input.validUntil); } catch { fail('external_grant_invalid'); }
    if (Date.parse(validUntil) <= this.#now()) fail('external_grant_expired');
    const targetExecutor = input.targetExecutor === undefined ? undefined : text(input.targetExecutor, 200);
    if (targetExecutor !== undefined && !allowedExecutors.includes(targetExecutor)) fail('external_grant_invalid');
    const resourcePolicy: ExternalResourcePolicy = { ...DEFAULT_EXTERNAL_RESOURCE_POLICY };
    if (input.resourcePolicy !== undefined) {
      const provided = input.resourcePolicy;
      if (typeof provided !== 'object' || provided === null) fail('external_grant_invalid');
      if (provided.maxWorks !== undefined) {
        if (!Number.isSafeInteger(provided.maxWorks) || provided.maxWorks < 1) fail('external_grant_invalid');
        if (provided.maxWorks > DEFAULT_EXTERNAL_RESOURCE_POLICY.maxWorks) fail('external_policy_exceeds_default');
        resourcePolicy.maxWorks = provided.maxWorks;
      }
      if (provided.windowHours !== undefined) {
        if (!Number.isSafeInteger(provided.windowHours) || provided.windowHours < 1) fail('external_grant_invalid');
        if (provided.windowHours > DEFAULT_EXTERNAL_RESOURCE_POLICY.windowHours) fail('external_policy_exceeds_default');
        resourcePolicy.windowHours = provided.windowHours;
      }
    }
    const autoResumeAllowed = input.autoResumeAllowed === undefined ? true : input.autoResumeAllowed === true;
    const normalized: NormalizedGrant = {
      goal: text(input.goal, 4000), scope: text(input.scope, 4000),
      forbidden: input.forbidden === '' ? '' : text(input.forbidden, 4000),
      allowedExecutors, repository, assetRefs, inputs,
      enterprise, validUntil,
      summary: text(input.summary, 4000), deliveryCriteria: text(input.deliveryCriteria, 4000),
      targetExecutor, resourcePolicy, autoResumeAllowed,
    };
    if (input.sourceCaseRef !== undefined) {
      const source = input.sourceCaseRef;
      if (typeof source !== 'object' || source === null) fail('external_grant_invalid');
      normalized.sourceCaseRef = { caseId: text(source.caseId, 200), issueId: text(source.issueId, 200) };
    }
    if (input.sourceConvention !== undefined) normalized.sourceConvention = text(input.sourceConvention, 2000);
    return normalized;
  }

  /** Read-only per-task summary for Task cards / project rows / Case rows. */
  async summarize(projectId: string, taskId: string): Promise<ExternalTaskSummary> {
    const owner = this.#owner(projectId, taskId);
    const [works, choice] = await Promise.all([
      this.#store.listWorks({ projectId: owner.projectId, taskId: owner.taskId }),
      this.#store.getInternalChoice(owner.projectId, owner.taskId),
    ]);
    const entries: ExternalWorkSummaryEntry[] = [];
    for (const work of works) {
      const [publications, claims, deliveries, reviews] = await Promise.all([
        this.#store.listPublications(work.workId),
        this.#store.listClaims(work.workId),
        this.#store.listDeliveries(work.workId),
        this.#store.listReviews(work.workId),
      ]);
      const activeClaim = claims.find(claim => claim.status === 'active' && claim.revision === work.revision);
      entries.push({
        workId: work.workId,
        revision: work.revision,
        status: work.status,
        summary: work.summary,
        grantId: work.grantId,
        grantVersion: work.grantVersion,
        createdAt: work.createdAt,
        publications: publications.map(publication => ({ operationId: publication.operationId, action: publication.action, status: publication.status, ...(publication.issueId === undefined ? {} : { issueId: publication.issueId }) })),
        claim: activeClaim ? { claimId: activeClaim.claimId, principal: activeClaim.principal, epoch: activeClaim.epoch, leaseDeadline: activeClaim.leaseDeadline, status: activeClaim.status } : null,
        deliveryCount: deliveries.length,
        reviewCount: reviews.length,
        latestReview: reviews.length ? { decision: reviews[reviews.length - 1]!.decision, reason: reviews[reviews.length - 1]!.reason } : null,
      });
    }
    return { projectId: owner.projectId, taskId: owner.taskId, internalChoice: choice?.decidedAt ?? null, works: entries };
  }

  /** Record the internal path choice. Zero Issue, zero trigger, zero asset change. */
  async chooseInternal(projectId: string, taskId: string): Promise<InternalChoice> {
    const owner = this.#owner(projectId, taskId);
    const works = await this.#store.listWorks({ projectId: owner.projectId, taskId: owner.taskId });
    if (works.some(work => work.status === 'authorized')) throw new ExternalWorkError('external_work_active', 409);
    return this.#store.recordInternalChoice(owner);
  }

  /** Confirm one dispatch: validate, intersect with original asset qualification, persist grant + revision-1 work. */
  async authorize(projectId: string, taskId: string, grantInput: ExternalGrantInput): Promise<{ grant: WorkGrant; work: ExternalWork }> {
    const owner = this.#owner(projectId, taskId);
    const profile = this.#profiles(owner.projectId, owner.taskId);
    if (!profile || profile.externalDispatchAllowed !== true) throw new ExternalWorkError('external_profile_forbidden', 403);
    const normalized = this.#normalizeGrantInput(grantInput);
    const combined = [...normalized.assetRefs, ...normalized.inputs];
    if (combined.length) {
      const qualified = await this.#qualifyAssets(owner.projectId, combined);
      for (const ref of combined) {
        if (!qualified.has(externalAssetRefText(ref))) throw new ExternalWorkError('external_asset_not_qualified', 403);
      }
    }
    const activeWorks = (await this.#store.listWorks({ projectId: owner.projectId, taskId: owner.taskId })).filter(work => work.status !== 'cancelled');
    const windowMs = normalized.resourcePolicy.windowHours * HOUR_MS;
    const withinWindow = activeWorks.filter(work => this.#now() - Date.parse(work.createdAt) < windowMs).length;
    if (withinWindow >= normalized.resourcePolicy.maxWorks) throw new ExternalWorkError('external_policy_rate_limited', 429);
    const now = this.#now();
    const stamp = new Date(now).toISOString();
    const grant: WorkGrant = {
      grantId: randomUUID(),
      grantVersion: 1,
      projectId: owner.projectId,
      taskId: owner.taskId,
      goal: normalized.goal,
      scope: normalized.scope,
      forbidden: normalized.forbidden,
      allowedExecutors: normalized.allowedExecutors,
      repository: normalized.repository,
      assetRefs: normalized.assetRefs,
      enterprise: normalized.enterprise,
      validFrom: stamp,
      validUntil: normalized.validUntil,
      resourcePolicy: normalized.resourcePolicy,
      autoResumeAllowed: normalized.autoResumeAllowed,
      createdAt: stamp,
    };
    if (normalized.sourceCaseRef !== undefined) grant.sourceCaseRef = normalized.sourceCaseRef;
    if (normalized.sourceConvention !== undefined) grant.sourceConvention = normalized.sourceConvention;
    const work: ExternalWork = {
      workId: randomUUID(),
      projectId: owner.projectId,
      taskId: owner.taskId,
      revision: 1,
      summary: normalized.summary,
      deliveryCriteria: normalized.deliveryCriteria,
      inputs: normalized.inputs,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      status: 'authorized',
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (normalized.targetExecutor !== undefined) work.targetExecutor = normalized.targetExecutor;
    return this.#store.createGrantWithWork(grant, work);
  }

  /**
   * Host-side cancellation. Zero external action; facts and UNKNOWN stay recorded.
   * The claims lose validity first; then the external stop request is recorded
   * durably before the injected seam runs. An unconfirmed or failing request is
   * kept pending verification ('unknown') — never reported as stopped. Terminal
   * records are never re-sent for the same work.
   */
  async cancelWork(workId: string, reason: string): Promise<{ work: ExternalWork; stopRequest: ExternalStopRequestRecord }> {
    const why = externalText(reason, 500);
    const work = await this.#store.cancelWork(externalText(workId, 100), why);
    const stopRequestId = externalStopRequestId(work.workId);
    const existing = await this.#store.getStopRequest(stopRequestId);
    if (existing && existing.status !== 'requested') return { work, stopRequest: existing };
    if (!this.#requestExternalStop) {
      return { work, stopRequest: existing ?? await this.#store.recordStopRequest({ stopRequestId, workId: work.workId, status: 'unsupported' }) };
    }
    await (existing ?? await this.#store.recordStopRequest({ stopRequestId, workId: work.workId, status: 'requested' }));
    let outcome: ExternalStopRequestStatus;
    try {
      const result = await this.#requestExternalStop({ workId: work.workId, reason: why });
      outcome = result && ['confirmed', 'unknown', 'failed', 'unsupported'].includes(result.outcome) ? result.outcome : 'unknown';
    } catch {
      // The outbound effect is uncertain; the request stays pending verification.
      outcome = 'unknown';
    }
    return { work, stopRequest: await this.#store.transitionStopRequest(stopRequestId, outcome) };
  }

  /**
   * Owner-bound publish entry: the work must belong to the given owner and the
   * profile must still allow external dispatch, then orchestration delegates
   * to the injected Host-built publisher. Without one, zero outbound action
   * is reachable from here.
   */
  async publish(projectId: string, taskId: string, input: { workId: string; revision: number; action: PublishAction; body: string }): Promise<PublishResult> {
    if (!this.#publisher) throw new ExternalWorkError('external_publisher_unconfigured', 503);
    const owner = this.#owner(projectId, taskId);
    const profile = this.#profiles(owner.projectId, owner.taskId);
    if (!profile || profile.externalDispatchAllowed !== true) throw new ExternalWorkError('external_profile_forbidden', 403);
    const workId = externalText(input.workId, 100);
    const work = await this.#store.getWork(workId);
    if (!work || work.projectId !== owner.projectId || work.taskId !== owner.taskId) throw new ExternalWorkError('external_work_not_found', 404);
    return this.#publisher.publish({ workId: work.workId, revision: input.revision, action: input.action, body: input.body });
  }

  /**
   * Optional WorkBuddy mode (S5). The adapter is Host-injected; without one the mode is
   * simply unavailable and the pure GitHub path is untouched. The mode gate checks the
   * restricted profile and exact work ownership before delegating to the adapter, which
   * enforces the integration_unverified readiness, quota and serial-occupancy contract.
   */
  async triggerWorkBuddy(projectId: string, taskId: string, input: { workId: string; revision: number }): Promise<{ attempt: ExecutorAttempt; dispatched: boolean }> {
    if (!this.#workbuddy) throw new ExternalWorkError('external_workbuddy_unconfigured', 503);
    const owner = this.#owner(projectId, taskId);
    const profile = this.#profiles(owner.projectId, owner.taskId);
    if (!profile || profile.externalDispatchAllowed !== true) throw new ExternalWorkError('external_profile_forbidden', 403);
    const workId = externalText(input.workId, 100);
    const work = await this.#store.getWork(workId);
    if (!work || work.projectId !== owner.projectId || work.taskId !== owner.taskId) throw new ExternalWorkError('external_work_not_found', 404);
    return this.#workbuddy.trigger({ workId: work.workId, revision: input.revision });
  }
}

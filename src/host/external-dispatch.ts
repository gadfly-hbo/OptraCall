import { randomUUID } from 'node:crypto';
import {
  DEFAULT_EXTERNAL_RESOURCE_POLICY, ExternalWorkError,
  externalAssetRefText, externalDate, externalText, parseExternalAssetRef,
} from './external-work-types.ts';
import type {
  ExternalAssetRef, ExternalRepositoryRef, ExternalResourcePolicy, ExternalTaskSummary,
  ExternalWork, ExternalWorkSummaryEntry, InternalChoice, WorkGrant,
} from './external-work-types.ts';
import type { ExternalWorkStore } from './external-work-store.ts';

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
 * intent and facts only — publishing, triggering and asset access belong to
 * later slices and are not reachable from here.
 */
export class ExternalDispatch {
  readonly #store: ExternalWorkStore;
  readonly #profiles: ExternalProfileLookup;
  readonly #qualifyAssets: ExternalAssetQualification;
  readonly #now: () => number;
  constructor(options: { store: ExternalWorkStore; profiles: ExternalProfileLookup; qualifyAssets: ExternalAssetQualification; now?: () => number }) {
    this.#store = options.store;
    this.#profiles = options.profiles;
    this.#qualifyAssets = options.qualifyAssets;
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

  /** Host-side cancellation. Zero external action; facts and UNKNOWN stay recorded. */
  async cancelWork(workId: string, reason: string): Promise<ExternalWork> {
    return this.#store.cancelWork(externalText(workId, 100), externalText(reason, 500));
  }
}

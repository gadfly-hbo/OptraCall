/**
 * External work business records (Issue #155 S1/E01).
 *
 * These are Host-owned business records, always bound to a real
 * `projectId/taskId`. They are deliberately separate from Case
 * `assignment.issue` identities, GitHub issue numbers and native
 * task results; no id in this file may be reused as another kind of
 * identity. Facts are recorded separately (publication / trigger /
 * claim / access / delivery / review); no single "success" field.
 */
export type ExternalAssetRef = { authority: string; id: string; version: string; hash: string };
export type ExternalRepositoryRef = { stableId: string; visibility: 'private' | 'public' };
export type ExternalResourcePolicy = { maxWorks: number; windowHours: number };

/** Per-dispatch default ceiling (1 work / 24h). An explicitly approved lower policy wins; anything above needs separate confirmation. */
export const DEFAULT_EXTERNAL_RESOURCE_POLICY: ExternalResourcePolicy = Object.freeze({ maxWorks: 1, windowHours: 24 });

export type WorkGrant = {
  grantId: string;
  grantVersion: number;
  projectId: string;
  taskId: string;
  goal: string;
  scope: string;
  forbidden: string;
  allowedExecutors: string[];
  repository: ExternalRepositoryRef;
  assetRefs: ExternalAssetRef[];
  enterprise: string;
  validFrom: string;
  validUntil: string;
  resourcePolicy: ExternalResourcePolicy;
  autoResumeAllowed: boolean;
  sourceCaseRef?: { caseId: string; issueId: string };
  sourceConvention?: string;
  createdAt: string;
};

export type ExternalWorkStatus = 'authorized' | 'cancelled';
export type ExternalWork = {
  workId: string;
  projectId: string;
  taskId: string;
  revision: number;
  summary: string;
  deliveryCriteria: string;
  inputs: ExternalAssetRef[];
  targetExecutor?: string;
  grantId: string;
  grantVersion: number;
  status: ExternalWorkStatus;
  createdAt: string;
  updatedAt: string;
};

export type ExternalPublicationAction = 'issue-create' | 'issue-comment' | 'external-trigger';
export type ExternalPublicationStatus = 'prepared' | 'submitted' | 'succeeded' | 'rejected' | 'unknown';
export type PublicationAttempt = {
  operationId: string;
  workId: string;
  revision: number;
  action: ExternalPublicationAction;
  /** SHA-256 of the exact outbound body; a different body under the same operation identity is a conflict. */
  bodyHash: string;
  serviceRef?: string;
  repositoryId?: string;
  issueId?: string;
  status: ExternalPublicationStatus;
  /** Diagnostic identity of the process that performed the submission; kept after later transitions. */
  submissionProcess?: string;
  createdAt: string;
  updatedAt: string;
};

export type ClaimStatus = 'active' | 'released' | 'revoked' | 'expired';
export type Claim = {
  claimId: string;
  workId: string;
  revision: number;
  principal: string;
  epoch: number;
  leaseDeadline: string;
  status: ClaimStatus;
  reason?: string;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryPreservation = 'pending' | 'preserved' | 'failed' | 'unknown' | 'link-only';
export type ExternalDeliveryFacts = { done: string[]; notDone: string[]; failed: string[]; unknown: string[] };
/** Host 分配的 external-delivery 存储条目；relativePath 在 dataRoot/external-delivery 之下，绝不指向 native 060_reports。 */
export type ExternalDeliveryStorageEntry = { logicalPath: string; relativePath: string; sha256: string; bytes: number };
/** 仅登记的外部链接：字节未在本机保全，绝不冒充"字节已验"。 */
export type ExternalDeliveryLinkEntry = { logicalPath: string; url: string };
export type ExternalDeliveryRef = {
  deliveryId: string;
  workId: string;
  revision: number;
  claimId: string;
  idempotencyKey: string;
  manifestHash: string;
  preservation: DeliveryPreservation;
  /** preservation=preserved 时必须非空；link-only 交付可同时携带已验字节的 storage 条目。 */
  storage?: ExternalDeliveryStorageEntry[];
  links?: ExternalDeliveryLinkEntry[];
  /** failed/unknown 的审计原因（missing_pieces/content_hash_mismatch/blob_hash_mismatch/save_failed 等）。 */
  preservationReason?: string;
  assetsUsed: ExternalAssetRef[];
  facts: ExternalDeliveryFacts;
  late: boolean;
  createdAt: string;
};

export type ExternalReviewDecisionKind = 'accepted' | 'needs-supplement' | 'rejected';
export type ReviewDecision = {
  reviewId: string;
  workId: string;
  deliveryId: string;
  decision: ExternalReviewDecisionKind;
  reason: string;
  /** Exact hash of the delivery this decision talks about. */
  deliveryHash: string;
  createdAt: string;
};

export type InboxEvent = {
  eventKey: string;
  projectId: string;
  taskId: string;
  workId?: string;
  deliveryId?: string;
  receivedAt: string;
};

export type ResumeStatus = 'reserved' | 'accepted' | 'settled' | 'unknown';
export type ResumeReceipt = {
  requestId: string;
  projectId: string;
  taskId: string;
  workId: string;
  revision: number;
  deliveryId: string;
  status: ResumeStatus;
  createdAt: string;
  updatedAt: string;
};

/** Durable "this task proceeds internally" intent. Recorded with zero external side effects. */
export type InternalChoice = { projectId: string; taskId: string; mode: 'internal'; decidedAt: string };

/** Read-only per-task summary derived from the separate fact records; never a merged "success" flag. */
export type ExternalWorkSummaryEntry = {
  workId: string;
  revision: number;
  status: ExternalWorkStatus;
  summary: string;
  grantId: string;
  grantVersion: number;
  createdAt: string;
  publications: Array<{ operationId: string; action: ExternalPublicationAction; status: ExternalPublicationStatus; issueId?: string }>;
  claim: { claimId: string; principal: string; epoch: number; leaseDeadline: string; status: ClaimStatus } | null;
  deliveryCount: number;
  reviewCount: number;
  latestReview: { decision: ExternalReviewDecisionKind; reason: string } | null;
};
export type ExternalTaskSummary = {
  projectId: string;
  taskId: string;
  internalChoice: string | null;
  works: ExternalWorkSummaryEntry[];
};

export class ExternalWorkError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super('外派业务记录操作未能完成。'); this.name = 'ExternalWorkError'; this.code = code; this.status = status; }
}

export function externalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function externalKeys(value: object, allowed: readonly string[]): void {
  // Unknown keys are corrupt; required fields are enforced by their own validators.
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ExternalWorkError('external_record_invalid', 503);
}
export function externalText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ExternalWorkError('external_record_invalid', 503);
  return value;
}
export function externalOptionalText(value: unknown, max: number): string | undefined {
  return value === undefined ? undefined : externalText(value, max);
}
export function externalHash(value: unknown): string {
  const text = externalText(value, 64);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new ExternalWorkError('external_record_invalid', 503);
  return text;
}
export function externalDate(value: unknown): string {
  const text = externalText(value, 40);
  if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) throw new ExternalWorkError('external_record_invalid', 503);
  return text;
}
export function externalRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ExternalWorkError('external_record_invalid', 503);
  return Number(value);
}
export function externalEpoch(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ExternalWorkError('external_record_invalid', 503);
  return Number(value);
}
export function externalId(value: unknown, max = 100): string {
  return externalText(value, max);
}
export function parseExternalAssetRef(value: unknown): ExternalAssetRef {
  if (!externalRecord(value)) throw new ExternalWorkError('external_record_invalid', 503);
  externalKeys(value, ['authority', 'id', 'version', 'hash']);
  return { authority: externalText(value.authority, 200), id: externalText(value.id, 300), version: externalText(value.version, 200), hash: externalHash(value.hash) };
}
export function parseExternalAssetRefs(value: unknown): ExternalAssetRef[] {
  if (!Array.isArray(value)) throw new ExternalWorkError('external_record_invalid', 503);
  return value.map(parseExternalAssetRef);
}
export function externalAssetRefText(ref: ExternalAssetRef): string {
  return `${ref.authority}/${ref.id}@${ref.version}#${ref.hash}`;
}

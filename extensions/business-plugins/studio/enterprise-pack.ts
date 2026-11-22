import type { StudioAuthority, StudioSourceRef } from './contracts.ts';
import { digest } from './validation.ts';

/**
 * Pure domain contracts and deterministic governance evaluators for
 * Enterprise Member Operations Asset Packs (Issue #111).
 *
 * Host enforces identity, exact versions, permissions, dependencies, and
 * append-only provenance; Pi Agent autonomously discovers, reads, computes,
 * and explains business findings.
 */

export type DomainReferenceDomain = 'member' | 'product' | 'store' | 'supply' | 'marketing' | 'enterprise' | 'benchmark' | 'other';
export type DomainReferenceRoute = 'enterprise' | 'domain';
export type DomainReferenceEvidenceNature = 'generic-draft' | 'public-benchmark' | 'third-party-research' | 'enterprise-official' | 'synthetic-fixture';
export type DomainReferenceVisibility = 'public' | 'shared' | 'enterprise';
export type DomainReferenceContentStatus = 'available' | 'pending_source';

export interface DomainReferenceSection {
  id: string;
  title: string;
  locator: string;
  excerpt?: string;
}

export interface DomainReferenceConflict {
  id: string;
  incomingSha256: string;
  incomingLocator?: string;
  incomingBody?: string;
  submittedBy?: string;
  note: string;
  detectedAt: string;
  status: 'pending' | 'resolved';
}

export interface DomainReferenceRecord {
  id: string;
  sourceId: string;
  version: string;
  title: string;
  domain: DomainReferenceDomain;
  routes: DomainReferenceRoute[];
  maintainer: string;
  scope: string;
  evidenceNature: DomainReferenceEvidenceNature;
  evidenceRestrictions: string[];
  locator: string;
  visibility: DomainReferenceVisibility;
  enterpriseId?: string;
  contentStatus: DomainReferenceContentStatus;
  contentSha256?: string;
  contentBody?: string;
  missingFields?: string[];
  sections?: DomainReferenceSection[];
  conflicts: DomainReferenceConflict[];
  createdAt: string;
  updatedAt: string;
}

export interface DomainReferenceRegisterInput {
  sourceId: string;
  version: string;
  title: string;
  domain: DomainReferenceDomain;
  routes: DomainReferenceRoute[];
  maintainer: string;
  scope: string;
  evidenceNature: DomainReferenceEvidenceNature;
  evidenceRestrictions?: string[];
  locator: string;
  visibility: DomainReferenceVisibility;
  enterpriseId?: string;
  contentBody?: string;
  contentSha256?: string;
  missingFields?: string[];
  sections?: DomainReferenceSection[];
  submittedBy?: string;
  conflictNote?: string;
}

export type ResourceGrantOperation = 'read-definition' | 'cite-summary' | 'read-detail-recalculate';
export type ResourceGrantKind = 'definition' | 'summary' | 'detail' | 'pack-purpose';

export interface ResourceGrantScope {
  brand?: string;
  channel?: string;
  stores?: string[];
  periodFrom?: string;
  periodTo?: string;
  grain?: string;
  summaryAssetId?: string;
  summaryVersion?: string;
  summaryAuthority?: string;
  summarySha256?: string;
  verifiedScopeSummary?: string;
  metricRef?: StudioSourceRef;
  allowedDataPaths?: string[];
}

export interface ResourceAuthorizationGrant {
  id: string;
  enterpriseId: string;
  grantor: string;
  grantorVerifiedBy?: 'host';
  grantorProjectId?: string;
  grantorSystemId?: string;
  grantorAuthorityType?: 'studio-system-owner' | 'enterprise-authority-asset' | 'resource-owner-project';
  grantBasis: string;
  subjectType: 'project' | 'principal';
  subjectId: string;
  resourceKind: ResourceGrantKind;
  resourceRef?: StudioSourceRef;
  purposeKeys?: string[];
  operations: ResourceGrantOperation[];
  scope: ResourceGrantScope;
  validFrom?: string;
  validTo?: string;
  revokedAt?: string;
  revokedReason?: string;
  revokedBy?: string;
  revokedByProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceGrantInput {
  enterpriseId: string;
  grantor: string;
  grantorProjectId?: string;
  grantorSystemId?: string;
  grantorAuthorityType?: 'studio-system-owner' | 'enterprise-authority-asset' | 'resource-owner-project';
  grantBasis: string;
  subjectType: 'project' | 'principal';
  subjectId: string;
  resourceKind: ResourceGrantKind;
  resourceRef?: StudioSourceRef;
  purposeKeys?: string[];
  operations: ResourceGrantOperation[];
  scope?: ResourceGrantScope;
  validFrom?: string;
  validTo?: string;
}

export interface ResourceAccessQuery {
  operation: ResourceGrantOperation;
  purposeKey?: string;
  brand?: string;
  channel?: string;
  stores?: string[];
  period?: string;
  grain?: string;
  summaryVersion?: string;
  metricRef?: StudioSourceRef;
  dataPath?: string;
  at?: string;
}

export interface ResourceAccessEvaluation {
  allowed: boolean;
  operation: ResourceGrantOperation;
  grantedStores: string[];
  deniedStores: string[];
  matchedGrantIds: string[];
  restrictionReason?: string;
  neverTreatAsZero?: boolean;
  summaryRef?: StudioSourceRef;
}

export type PackBusinessStatus = 'active' | 'not_launched' | 'unknown';
export type PackAssetSupportStatus = 'ready' | 'definition_only' | 'limited_calc' | 'gap_material' | 'gap_decision' | 'not_needed';
export type PackPurposeTier = 'definition-reference' | 'limited-calculation' | 'formal-calculation';
export type PackSubjectUnit = 'brand_account' | 'group_person' | 'store' | 'other';
export type PackFeedbackCategory = 'task_miscalculation' | 'shared_refund_mapping' | 'sap_formula' | 'member_policy' | 'case_decision' | 'ad_hoc_assumption';
export type PackFeedbackAuthority = 'task' | 'shared-asset' | 'sap-metric' | 'member-rule' | 'case';
export type PackUseVerdict = 'pass' | 'partial' | 'pending' | 'fail';

export interface EnterprisePanoramaRecommendation {
  purposeKey: string;
  title: string;
  priorityReason: string;
  deliverableNow: string;
  minimumEvidence: string;
  ownerRole: string;
  completionCriteria: string;
  selected?: boolean;
}

export interface EnterprisePanoramaIssue {
  id: string;
  problemName: string;
  businessStatus: PackBusinessStatus;
  assetSupportStatus: PackAssetSupportStatus;
  summary: string;
  factOrInference: 'fact' | 'inference';
  decisionImpact: string;
  nextStep: string;
  evidence: { sourceRef: StudioSourceRef; locator: string; scope: string; note?: string }[];
  candidatePurposeKey?: string;
}

export interface EnterprisePanoramaSnapshot {
  id: string;
  version: number;
  goal: string;
  brand: string;
  channel: string;
  period: string;
  dataCutoffAt: string;
  decisionPurpose: string;
  sourceRefs: StudioSourceRef[];
  recommendations: EnterprisePanoramaRecommendation[];
  issues: EnterprisePanoramaIssue[];
  pendingQuestions: { id: string; question: string; impact: string; workItemId?: string }[];
  createdAt: string;
  createdByTask?: { projectId: string; taskId: string };
}

export interface EnterprisePackException {
  id: string;
  replacesRuleKey: string;
  eventType: string;
  scope: string;
  storeIds?: string[];
  effectiveFrom: string;
  effectiveTo?: string;
  reviewAt?: string;
  approvalBasis: string;
  approvedBy: string;
  priorityOver?: string[];
  status: 'approved' | 'pending_overlap' | 'expired';
}

export interface EnterprisePackEntry {
  id: string;
  entryKey: string;
  title: string;
  action: 'adopt' | 'modify' | 'exclude' | 'add' | 'pending';
  routes: DomainReferenceRoute[];
  referenceLinks: {
    refId: string;
    sourceId: string;
    version: string;
    sectionLocator: string;
    excerpt?: string;
    evidenceNature: string;
    restrictions?: string[];
  }[];
  enterpriseBasis: string;
  decisionOwner?: string;
  enterpriseSourceRefs: StudioSourceRef[];
  authorityRef?: StudioSourceRef;
  scope: string;
  grain?: string;
  validFrom?: string;
  validTo?: string;
  impactedPurposeIds: string[];
  exceptions: EnterprisePackException[];
  updatedAt: string;
}

export interface EnterprisePackDependency {
  id: string;
  role: 'shared-asset' | 'member-rule' | 'sap-metric' | 'sap-method' | 'studio-source' | 'summary-result';
  authority: StudioAuthority;
  ref: StudioSourceRef;
  requiredFor: PackPurposeTier[];
  title?: string;
}

export interface EnterprisePackDecisionChoice {
  id: string;
  question: string;
  options: { key: string; label: string; impact: string }[];
  selectedKey?: string;
  decidedBy?: string;
  decidedAt?: string;
  inheritedFromVersion?: string;
}

export interface EnterprisePackPurposeScope {
  brand?: string;
  channel?: string;
  stores?: string[];
  period?: string;
  scopeKey: string;
}

export interface EnterprisePackPurpose {
  id: string;
  dedupKey: string;
  purposeKey: string;
  title: string;
  businessQuestion: string;
  subjectUnit: PackSubjectUnit;
  windowDays?: number;
  scope: EnterprisePackPurposeScope;
  tier: PackPurposeTier;
  limitedCalculationName?: string;
  businessStatus: PackBusinessStatus;
  evidenceReadiness: {
    definition: 'pass' | 'pending' | 'fail';
    mapping: 'pass' | 'pending' | 'fail';
    sampleCalculation: 'pass' | 'pending' | 'fail';
    independentUse: 'pass' | 'partial' | 'pending' | 'fail';
  };
  originalGoal: string;
  deliveredSubset?: string;
  remainingGaps: string[];
  exclusions: string[];
  completionCriteria: string;
  dependencies: EnterprisePackDependency[];
  policyEffectiveFrom?: string;
  policyEffectiveTo?: string;
  dataCutoffAt?: string;
  observationWindowDays?: number;
  availableHistoryDays?: number;
  decisionChoices: EnterprisePackDecisionChoice[];
  workItemStatus: 'draft' | 'ready_for_preview' | 'published' | 'partially_suspended' | 'restricted';
  ownerRole?: string;
  maintenanceTasks: { projectId: string; taskId: string; addedAt: string }[];
  evidenceNotes: { id: string; projectId: string; taskId?: string; note: string; sourceRefs: StudioSourceRef[]; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface PackModulePublicationReceipt {
  receiptId: string;
  requestId: string;
  authority: 'shared-asset' | 'member-rule' | 'sap-metric' | 'sap-method' | 'studio-source';
  targetRef: StudioSourceRef;
  targetFingerprint: string;
  status: 'succeeded' | 'failed' | 'unknown';
  detail: string;
  purposeIds: string[];
  authorityOperationId?: string;
  authorityPublishedBy?: string;
  supersedesReceiptId?: string;
  at: string;
}

export interface EnterprisePurposePublicationState {
  purposeId: string;
  purposeKey: string;
  title: string;
  tier: PackPurposeTier;
  limitedCalculationName?: string;
  subjectUnit: PackSubjectUnit;
  windowDays?: number;
  scope: EnterprisePackPurposeScope;
  policyEffectiveFrom?: string;
  dataCutoffAt?: string;
  observationWindowDays?: number;
  availableHistoryDays?: number;
  evidenceReadiness?: {
    definition: 'pass' | 'pending' | 'fail';
    mapping: 'pass' | 'pending' | 'fail';
    sampleCalculation: 'pass' | 'pending' | 'fail';
  };
  carriedOverFromVersion?: string;
  exclusions: string[];
  gaps: string[];
  dependencies: EnterprisePackDependency[];
  exceptions: EnterprisePackException[];
  status: 'eligible' | 'suspended' | 'restricted' | 'conflict_blocked';
  suspensionReason?: string;
  summaryAccess?: {
    summaryRef: StudioSourceRef;
    grain: string;
    period: string;
    metricRef: StudioSourceRef;
    grantIds: string[];
  };
}

export interface EnterprisePackPreview {
  id: string;
  version: string;
  previousVersion?: string;
  fingerprint: string;
  draftFingerprint?: string;
  packRevision: number;
  summary: string;
  policyEffectiveFrom?: string;
  dataCutoffAt?: string;
  purposeIds: string[];
  decisions: { purposeId: string; choiceId: string; selectedKey: string; label: string; decidedBy?: string }[];
  purposeSnapshots: EnterprisePurposePublicationState[];
  createdAt: string;
  confirmedAt?: string;
}

export interface EnterprisePackRevision {
  version: string;
  previousVersion?: string;
  previewId: string;
  previewFingerprint: string;
  manifestSha256: string;
  confirmedAt: string;
  confirmedBy?: string;
  policyEffectiveFrom?: string;
  dataCutoffAt?: string;
  decisionsSnapshot: { purposeId: string; choiceId: string; selectedKey: string; label: string; decidedBy?: string }[];
  purposeManifests: EnterprisePurposePublicationState[];
  moduleReceipts: PackModulePublicationReceipt[];
  status: 'active' | 'superseded' | 'restricted';
  restrictionNote?: string;
}

export interface EnterprisePackTaskPin {
  projectId: string;
  taskId: string;
  enterpriseId: string;
  packId: string;
  packVersion: string;
  manifestSha256: string;
  purposeIds: string[];
  pinnedAuthorityRefs: StudioSourceRef[];
  authorizedScope: string;
  dataCutoffAt?: string;
  pinnedAt: string;
}

export type FeedbackAdoptionBasis = 'verified_actual_read' | 'directory_only_unverified' | 'clue_only_no_pack_read';

export interface EnterprisePackFeedbackReport {
  projectId: string;
  taskId: string;
  sessionId: string;
  messageId: string;
  reportRef: StudioSourceRef;
  adoptionBasis?: FeedbackAdoptionBasis;
  observedDirectoryVersion?: string;
  usedPackVersion?: string;
  usedAssetRefs: StudioSourceRef[];
  taskCutoffAt?: string;
  packDataCutoffAt?: string;
  dataCutoffAt?: string;
  roleOrAccessLevel?: string;
  evidenceNote: string;
  submittedAt: string;
}

export interface EnterprisePackFeedback {
  id: string;
  feedbackCode: string;
  problemKey: string;
  packVersion: string;
  purposeIds: string[];
  title: string;
  category: PackFeedbackCategory;
  targetAuthority: PackFeedbackAuthority;
  targetAssetRef?: StudioSourceRef;
  status: 'recorded' | 'investigating' | 'revision_prepared' | 'published_pending_use' | 'verified' | 'retained_in_task' | 'not_confirmed';
  reports: EnterprisePackFeedbackReport[];
  investigation?: {
    materialVisibleAtCutoff: boolean;
    cutoffAt?: string;
    rootCause: string;
    impactedPurposeIds: string[];
    impactedReportRefs: StudioSourceRef[];
    unaffectedNote: string;
    checkedAt: string;
  };
  revisionLink?: {
    fromPackVersion: string;
    toPackVersion: string;
    authorityUpdates: { authority: string; fromRef: StudioSourceRef; toRef: StudioSourceRef; detail: string }[];
    verifiedByUseIds?: string[];
  };
  authorityHandling?: {
    authority: PackFeedbackAuthority;
    targetRef?: StudioSourceRef;
    revisedRef?: StudioSourceRef;
    revisedPackVersion?: string;
    studioWorkItemId?: string;
    studioFeedbackId?: string;
    note: string;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EnterprisePackReadEvidence {
  ref: StudioSourceRef;
  sha256?: string;
  complete: boolean;
  range?: { start: number; end: number; total: number };
  readAt: string;
  turnIndex?: number;
  toolCallId?: string;
}

export interface EnterprisePackUseRecord {
  id: string;
  projectId: string;
  taskId: string;
  sessionId?: string;
  turnIndex?: number;
  messageId?: string;
  reportRef: StudioSourceRef;
  packId: string;
  packVersion: string;
  purposeId: string;
  purposeKey: string;
  tier: PackPurposeTier;
  accessLevel: 'definition' | 'summary' | 'recalculate';
  policyEffectiveFrom?: string;
  dataCutoffAt?: string;
  catalogSupplied: {
    packVersion: string;
    purposeIds: string[];
    assetRefs: StudioSourceRef[];
    suppliedAt: string;
  };
  actualReads: EnterprisePackReadEvidence[];
  authorDeclaration?: {
    declaredPurposeId: string;
    declaredRefs: StudioSourceRef[];
    summaryRef?: StudioSourceRef;
    summaryText: string;
    declaredAt: string;
  };
  independentVerification: {
    status: PackUseVerdict;
    verdictDetail: string;
    verifierRole?: string;
    checkedRefs?: StudioSourceRef[];
    wrongVersionDetected?: boolean;
    expectedVersion?: string;
    actualVersion?: string;
    deliveredSubset?: string;
    remainingGaps?: string[];
    verifiedAt?: string;
  };
  impactNotes?: {
    fromFeedbackId: string;
    newPackVersion: string;
    note: string;
    affected: boolean;
    addedAt: string;
  }[];
  createdAt: string;
}

export interface EnterprisePackUpgradeImpact {
  id: string;
  fromPackVersion: string;
  toPackVersion: string;
  changedAuthorityRef: StudioSourceRef;
  replacementRef: StudioSourceRef;
  impactedEntryIds: string[];
  impactedPurposeIds: string[];
  verifiedImpactedUseIds: string[];
  pendingImpactedUseIds: string[];
  unaffectedUseIds: string[];
  createdAt: string;
}

export interface EnterpriseDomainPack {
  id: string;
  packCode: string;
  enterpriseId: string;
  systemId: string;
  activeOwnerProjectId?: string;
  continuationHistory?: { projectId: string; taskId?: string; reason?: string; continuedAt: string }[];
  domain: string;
  name: string;
  revision: number;
  panorama?: EnterprisePanoramaSnapshot;
  panoramaHistory: EnterprisePanoramaSnapshot[];
  entries: EnterprisePackEntry[];
  purposes: EnterprisePackPurpose[];
  previews: EnterprisePackPreview[];
  packRevisions: EnterprisePackRevision[];
  taskPins: EnterprisePackTaskPin[];
  feedbackItems: EnterprisePackFeedback[];
  useRecords: EnterprisePackUseRecord[];
  upgradeImpacts: EnterprisePackUpgradeImpact[];
  createdAt: string;
  updatedAt: string;
}

export function normalizePurposeDedupKey(input: {
  enterpriseId: string;
  packId: string;
  purposeKey: string;
  subjectUnit: PackSubjectUnit;
  scopeKey: string;
  windowDays?: number;
}): string {
  return digest([
    input.enterpriseId,
    input.packId,
    input.purposeKey.trim().toLowerCase(),
    input.subjectUnit,
    input.scopeKey.trim().toLowerCase(),
    input.windowDays ?? null,
  ]);
}

export function feedbackTargetAuthority(category: PackFeedbackCategory): PackFeedbackAuthority {
  switch (category) {
    case 'shared_refund_mapping': return 'shared-asset';
    case 'sap_formula': return 'sap-metric';
    case 'member_policy': return 'member-rule';
    case 'case_decision': return 'case';
    case 'task_miscalculation':
    case 'ad_hoc_assumption':
      return 'task';
  }
}

export function sameExactSourceRef(a: StudioSourceRef, b: StudioSourceRef): boolean {
  return a.authority === b.authority
    && a.id === b.id
    && a.version === b.version
    && (a.sha256 === undefined || b.sha256 === undefined || a.sha256 === b.sha256);
}

function sameSourceId(a: StudioSourceRef, b: StudioSourceRef): boolean {
  return a.authority === b.authority && a.id === b.id;
}

function isGrantActive(grant: ResourceAuthorizationGrant, atMs: number): boolean {
  if (grant.revokedAt) return false;
  if (grant.validFrom && Number.isFinite(Date.parse(grant.validFrom)) && atMs < Date.parse(grant.validFrom)) return false;
  if (grant.validTo && Number.isFinite(Date.parse(grant.validTo)) && atMs > Date.parse(grant.validTo)) return false;
  return true;
}

export function evaluateResourceAccess(
  grants: readonly ResourceAuthorizationGrant[],
  query: ResourceAccessQuery,
): ResourceAccessEvaluation {
  const atMs = query.at && Number.isFinite(Date.parse(query.at)) ? Date.parse(query.at) : Date.now();
  const active = grants.filter(g => isGrantActive(g, atMs) && g.operations.includes(query.operation));
  const purposeMatched = active.filter(g => {
    if (!query.purposeKey || !g.purposeKeys?.length) return true;
    return g.purposeKeys.includes('*') || g.purposeKeys.includes(query.purposeKey);
  });
  const scopeMatched = purposeMatched.filter(g => {
    if (query.brand && g.scope.brand && g.scope.brand !== query.brand) return false;
    if (query.channel && g.scope.channel && g.scope.channel !== query.channel) return false;
    if (query.period) {
      const pMs = Date.parse(query.period);
      if (Number.isFinite(pMs)) {
        if (g.scope.periodFrom && pMs < Date.parse(g.scope.periodFrom)) return false;
        if (g.scope.periodTo && pMs > Date.parse(g.scope.periodTo)) return false;
      }
    }
    return true;
  });

  if (!scopeMatched.length) {
    return {
      allowed: false,
      operation: query.operation,
      grantedStores: [],
      deniedStores: query.stores ? [...query.stores] : [],
      matchedGrantIds: [],
      restrictionReason: `no_active_grant_for_${query.operation}`,
      ...(query.stores?.length ? { neverTreatAsZero: true } : {}),
    };
  }

  if (query.operation === 'read-definition') {
    return {
      allowed: true,
      operation: query.operation,
      grantedStores: [],
      deniedStores: [],
      matchedGrantIds: scopeMatched.map(g => g.id),
    };
  }

  if (query.operation === 'cite-summary') {
    const summaryMatches = scopeMatched.filter(g => {
      if (query.grain && g.scope.grain !== query.grain) return false;
      if (query.summaryVersion && g.scope.summaryVersion !== query.summaryVersion) return false;
      if (query.metricRef && g.scope.metricRef && !sameExactSourceRef(g.scope.metricRef, query.metricRef)) return false;
      return Boolean(g.scope.summaryAssetId && g.scope.summaryVersion && g.scope.summaryAuthority);
    });
    if (!summaryMatches.length) {
      return {
        allowed: false,
        operation: query.operation,
        grantedStores: [],
        deniedStores: query.stores ? [...query.stores] : [],
        matchedGrantIds: [],
        restrictionReason: 'summary_grant_grain_version_or_authority_mismatch',
      };
    }
    return {
      allowed: true,
      operation: query.operation,
      grantedStores: [...new Set(summaryMatches.flatMap(g => g.scope.stores ?? []))],
      deniedStores: [],
      matchedGrantIds: summaryMatches.map(g => g.id),
      summaryRef: summaryMatches[0]!.resourceRef,
    };
  }

  // read-detail-recalculate
  const grantedStoresSet = new Set<string>();
  const matchedGrantIds: string[] = [];
  for (const grant of scopeMatched) {
    if (query.dataPath) {
      const allowedPaths = grant.scope.allowedDataPaths;
      if (allowedPaths && !allowedPaths.includes(query.dataPath)) continue;
    }
    matchedGrantIds.push(grant.id);
    for (const storeName of grant.scope.stores ?? []) grantedStoresSet.add(storeName);
  }

  if (query.dataPath && !matchedGrantIds.length) {
    return {
      allowed: false,
      operation: query.operation,
      grantedStores: [...grantedStoresSet],
      deniedStores: query.stores ? [...query.stores] : [],
      matchedGrantIds: [],
      restrictionReason: 'detail_data_path_not_authorized',
      neverTreatAsZero: true,
    };
  }

  if (query.stores?.length) {
    const grantedStores = query.stores.filter(s => grantedStoresSet.has(s));
    const deniedStores = query.stores.filter(s => !grantedStoresSet.has(s));
    if (deniedStores.length > 0) {
      return {
        allowed: false,
        operation: query.operation,
        grantedStores,
        deniedStores,
        matchedGrantIds,
        restrictionReason: 'store_detail_not_authorized',
        neverTreatAsZero: true,
      };
    }
    return {
      allowed: true,
      operation: query.operation,
      grantedStores,
      deniedStores: [],
      matchedGrantIds,
    };
  }

  return {
    allowed: matchedGrantIds.length > 0,
    operation: query.operation,
    grantedStores: [...grantedStoresSet],
    deniedStores: [],
    matchedGrantIds,
    ...(matchedGrantIds.length ? {} : { restrictionReason: 'detail_recalculate_not_authorized', neverTreatAsZero: true }),
  };
}

export interface ExceptionWindowEvaluation {
  status: 'eligible' | 'conflict_blocked' | 'pending_history' | 'sms_excluded';
  appliedExceptionIds: string[];
  overlapConflict: boolean;
  conflictingExceptionIds: string[];
  windowSufficient: boolean;
  smsEligible: boolean;
  reasons: string[];
}

export interface ExceptionOverlapConflict {
  exceptionIds: [string, string];
  eventType: string;
  stores: string[];
  reason: string;
}

function datesOverlap(a: EnterprisePackException, b: EnterprisePackException): boolean {
  const aStart = Date.parse(a.effectiveFrom);
  const bStart = Date.parse(b.effectiveFrom);
  const aEnd = a.effectiveTo ? Date.parse(a.effectiveTo) : Number.POSITIVE_INFINITY;
  const bEnd = b.effectiveTo ? Date.parse(b.effectiveTo) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(aStart) || !Number.isFinite(bStart)) return true;
  return aStart <= bEnd && bStart <= aEnd;
}

function eventTypesOverlap(a: EnterprisePackException, b: EnterprisePackException): boolean {
  const ea = a.eventType.trim().toLowerCase();
  const eb = b.eventType.trim().toLowerCase();
  if (!ea || ea === '*' || !eb || eb === '*') return true;
  return ea === eb;
}

function storesOverlap(a: EnterprisePackException, b: EnterprisePackException, purposeStores?: readonly string[]): { overlaps: boolean; sharedStores: string[] } {
  const sa = (a.storeIds ?? []).map(s => s.trim()).filter(Boolean);
  const sb = (b.storeIds ?? []).map(s => s.trim()).filter(Boolean);
  if (sa.length && sb.length) {
    const shared = sa.filter(s => sb.includes(s));
    if (!shared.length) return { overlaps: false, sharedStores: [] };
    if (purposeStores?.length) {
      const relevant = shared.filter(s => purposeStores.includes(s));
      return { overlaps: relevant.length > 0, sharedStores: relevant };
    }
    return { overlaps: true, sharedStores: shared };
  }
  const narrow = sa.length ? sa : sb;
  if (narrow.length && purposeStores?.length) {
    const relevant = narrow.filter(s => purposeStores.includes(s));
    return { overlaps: relevant.length > 0, sharedStores: relevant };
  }
  return { overlaps: true, sharedStores: narrow.length ? narrow : [...(purposeStores ?? [])] };
}

/**
 * Checks pairwise overlaps across approved exceptions ONLY when they intersect
 * in effective time, eventType, AND store/scope, without an explicit approved priorityOver.
 * Two exceptions active in overlapping dates for different stores or different event types
 * do NOT conflict.
 */
export function detectExceptionOverlaps(
  exceptions: readonly EnterprisePackException[],
  purposeStores?: readonly string[],
): ExceptionOverlapConflict[] {
  const approved = exceptions.filter(ex => ex.status === 'approved');
  const conflicts: ExceptionOverlapConflict[] = [];
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      const a = approved[i]!;
      const b = approved[j]!;
      if (!datesOverlap(a, b)) continue;
      if (!eventTypesOverlap(a, b)) continue;
      const storeCheck = storesOverlap(a, b, purposeStores);
      if (!storeCheck.overlaps) continue;
      const hasPriority = Boolean(a.priorityOver?.includes(b.id) || b.priorityOver?.includes(a.id));
      if (hasPriority) continue;
      conflicts.push({
        exceptionIds: [a.id, b.id],
        eventType: a.eventType === '*' ? b.eventType : a.eventType,
        stores: storeCheck.sharedStores,
        reason: 'overlapping_exceptions_without_approved_priority',
      });
    }
  }
  return conflicts;
}

export function evaluateExceptionsAndWindow(input: {
  eventDate?: string;
  storeId?: string;
  eventType?: string;
  purposeStores?: readonly string[];
  exceptions?: readonly EnterprisePackException[];
  observationWindowDays?: number;
  availableHistoryDays?: number;
  requireHistoryDays?: boolean;
  optedOut?: boolean;
}): ExceptionWindowEvaluation {
  const reasons: string[] = [];
  let overlapConflict = false;
  let conflictingExceptionIds: string[] = [];
  let appliedExceptionIds: string[] = [];

  if (input.eventDate) {
    const eventMs = Date.parse(input.eventDate);
    const matching = (input.exceptions ?? []).filter(ex => {
      if (ex.status !== 'approved') return false;
      if (input.eventType && ex.eventType && ex.eventType !== '*' && ex.eventType !== input.eventType) return false;
      if (input.storeId && ex.storeIds?.length && !ex.storeIds.includes(input.storeId)) return false;
      if (Number.isFinite(eventMs)) {
        if (eventMs < Date.parse(ex.effectiveFrom)) return false;
        if (ex.effectiveTo && eventMs > Date.parse(ex.effectiveTo)) return false;
      }
      return true;
    });

    // Among date-matched exceptions, check pairwise conflicts by store & eventType
    const pairwise = detectExceptionOverlaps(matching, input.storeId ? [input.storeId] : input.purposeStores);
    if (pairwise.length > 0) {
      overlapConflict = true;
      conflictingExceptionIds = [...new Set(pairwise.flatMap(c => c.exceptionIds))];
      appliedExceptionIds = [];
      reasons.push('overlapping_exceptions_without_approved_priority');
    } else if (matching.length > 1) {
      // Pick non-dominated winners when priorityOver resolves same-scope overlaps, or keep non-conflicting distinct-scope exceptions
      appliedExceptionIds = matching
        .filter(candidate => !matching.some(other => other.id !== candidate.id && other.priorityOver?.includes(candidate.id)))
        .map(e => e.id);
    } else {
      appliedExceptionIds = matching.map(e => e.id);
    }
  } else {
    // Preview / structural check without a specific transaction eventDate:
    // check pairwise overlaps by store/scope + eventType + effective date intervals (never treating dataCutoffAt as eventDate)
    const pairwise = detectExceptionOverlaps(input.exceptions ?? [], input.purposeStores);
    if (pairwise.length > 0) {
      overlapConflict = true;
      conflictingExceptionIds = [...new Set(pairwise.flatMap(c => c.exceptionIds))];
      reasons.push('overlapping_exceptions_without_approved_priority');
    }
  }

  const missingRequiredHistory = Boolean(
    input.requireHistoryDays
    && input.observationWindowDays !== undefined
    && input.availableHistoryDays === undefined,
  );
  const windowSufficient = input.observationWindowDays === undefined
    ? true
    : input.availableHistoryDays === undefined
      ? !missingRequiredHistory
      : input.availableHistoryDays >= input.observationWindowDays;
  if (!windowSufficient) {
    reasons.push(
      input.availableHistoryDays === undefined
        ? `missing_history_for_${input.observationWindowDays}d_window`
        : `insufficient_history_${input.availableHistoryDays}d_of_${input.observationWindowDays}d`,
    );
  }

  const smsEligible = input.optedOut !== true;
  if (!smsEligible) {
    reasons.push('member_opted_out_of_sms');
  }

  const status: ExceptionWindowEvaluation['status'] = overlapConflict
    ? 'conflict_blocked'
    : !windowSufficient
      ? 'pending_history'
      : !smsEligible
        ? 'sms_excluded'
        : 'eligible';

  return {
    status,
    appliedExceptionIds,
    overlapConflict,
    conflictingExceptionIds,
    windowSufficient,
    smsEligible,
    reasons,
  };
}

export function evaluateUseVerdict(input: {
  expectedRef?: StudioSourceRef;
  requiredRefs?: readonly StudioSourceRef[];
  actualReads: readonly EnterprisePackReadEvidence[];
  hasAuthorDeclaration: boolean;
  independentConfirmed: boolean;
  partialSubsetOnly?: boolean;
  treatedUnreadableStoreAsZero?: boolean;
  includedOptedOutInSms?: boolean;
}): { verdict: PackUseVerdict; wrongVersionDetected: boolean; reason: string } {
  if (input.treatedUnreadableStoreAsZero) {
    return { verdict: 'fail', wrongVersionDetected: false, reason: '把不可读门店再购当作零，该用途未通过' };
  }
  if (input.includedOptedOutInSms) {
    return { verdict: 'fail', wrongVersionDetected: false, reason: '把已退订会员列入短信候选，该用途未通过' };
  }
  const refsToCheck: StudioSourceRef[] = [
    ...(input.expectedRef ? [input.expectedRef] : []),
    ...(input.requiredRefs ?? []),
  ];
  // 1. Check wrong version FIRST across expectedRef and all requiredRefs (even if summary number coincides!)
  for (const target of refsToCheck) {
    const sameAssetReads = input.actualReads.filter(r => sameSourceId(r.ref, target));
    const wrongRead = sameAssetReads.find(r => !sameExactSourceRef(r.ref, target));
    const completeRightRead = sameAssetReads.find(r => r.complete && sameExactSourceRef(r.ref, target));
    if (wrongRead && !completeRightRead) {
      return {
        verdict: 'fail',
        wrongVersionDetected: true,
        reason: `查实实际读用旧版/错版 ${wrongRead.ref.version}（期望 ${target.version}），即使汇总数字巧合相同，该用途仍判未通过`,
      };
    }
  }
  // 2. Require at least one complete read overall
  const completeReads = input.actualReads.filter(r => r.complete);
  if (!completeReads.length) {
    return { verdict: 'pending', wrongVersionDetected: false, reason: '缺少完整实际工具读取版本的依据（仅目录、无读取或仅部分片段），保持待验证' };
  }
  // 3. Require complete exact read of expectedRef and EVERY required dependency of this purpose
  for (const target of refsToCheck) {
    const hasCompleteExact = completeReads.some(r => sameExactSourceRef(r.ref, target));
    if (!hasCompleteExact) {
      return {
        verdict: 'pending',
        wrongVersionDetected: false,
        reason: `缺少适用准确依赖 ${target.authority}:${target.id}@${target.version} 的完整实际读取记录（无关或部分读取不可通过），保持待验证`,
      };
    }
  }
  // 4. Require explicit author adoption declaration bound to this specific report/use!
  if (!input.hasAuthorDeclaration) {
    return { verdict: 'pending', wrongVersionDetected: false, reason: '缺少与本稿绑定的作者采用声明（仅读取原件不代表本稿实际采用），保持待验证' };
  }
  if (!input.independentConfirmed) {
    return { verdict: 'pending', wrongVersionDetected: false, reason: '尚无与权限和用途相称的独立核对结论，保持待验证' };
  }
  if (input.partialSubsetOnly) {
    return { verdict: 'partial', wrongVersionDetected: false, reason: '子用途已证实成立，同时保留原目标与剩余缺口' };
  }
  return { verdict: 'pass', wrongVersionDetected: false, reason: '已核对实际完整读取准确版本、本稿采用声明与独立验证结论，本用途成立' };
}

export function computeUpgradeImpact(
  pack: EnterpriseDomainPack,
  change: {
    changedAuthorityRef: StudioSourceRef;
    replacementRef: StudioSourceRef;
    fromPackVersion: string;
    toPackVersion: string;
  },
): Omit<EnterprisePackUpgradeImpact, 'id' | 'createdAt'> {
  const impactedEntryIds = pack.entries
    .filter(entry =>
      (entry.authorityRef && sameExactSourceRef(entry.authorityRef, change.changedAuthorityRef))
      || entry.enterpriseSourceRefs.some(ref => sameExactSourceRef(ref, change.changedAuthorityRef)),
    )
    .map(entry => entry.id);

  const fromRev = pack.packRevisions.find(r => r.version === change.fromPackVersion);
  const impactedPurposeIds = (fromRev?.purposeManifests ?? []).filter(pm =>
    pm.dependencies.some(dep => sameExactSourceRef(dep.ref, change.changedAuthorityRef)),
  ).map(pm => pm.purposeId);

  const verifiedImpactedUseIds: string[] = [];
  const pendingImpactedUseIds: string[] = [];
  const unaffectedUseIds: string[] = [];

  for (const use of pack.useRecords) {
    if (use.packVersion !== change.fromPackVersion) continue;
    const purposeImpacted = impactedPurposeIds.includes(use.purposeId);
    const readOldDirectly = use.actualReads.some(read => sameExactSourceRef(read.ref, change.changedAuthorityRef));
    const citedSummaryOnImpactedPurpose = use.accessLevel === 'summary' && purposeImpacted;

    if (!purposeImpacted && !readOldDirectly) {
      unaffectedUseIds.push(use.id);
    } else if (readOldDirectly || citedSummaryOnImpactedPurpose) {
      verifiedImpactedUseIds.push(use.id);
    } else {
      pendingImpactedUseIds.push(use.id);
    }
  }

  return {
    fromPackVersion: change.fromPackVersion,
    toPackVersion: change.toPackVersion,
    changedAuthorityRef: change.changedAuthorityRef,
    replacementRef: change.replacementRef,
    impactedEntryIds,
    impactedPurposeIds,
    verifiedImpactedUseIds,
    pendingImpactedUseIds,
    unaffectedUseIds,
  };
}

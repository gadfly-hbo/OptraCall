import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, fail, identity, object, sourceRef, sources, StudioError, text, uuid } from '../../extensions/business-plugins/studio/validation.ts';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import {
  computeUpgradeImpact,
  evaluateExceptionsAndWindow,
  evaluateUseVerdict,
  feedbackTargetAuthority,
  normalizePurposeDedupKey,
  sameExactSourceRef,
  type DomainReferenceRoute,
  type EnterpriseDomainPack,
  type EnterprisePackDecisionChoice,
  type EnterprisePackDependency,
  type EnterprisePackEntry,
  type EnterprisePackException,
  type EnterprisePackFeedback,
  type EnterprisePackFeedbackItemVerification,
  type EnterprisePackFeedbackReport,
  type EnterprisePackFeedbackRowCustody,
  type EnterprisePackFeedbackSourceRead,
  type EnterprisePackPreview,
  type EnterprisePackPurpose,
  type EnterprisePackPurposeScope,
  type EnterprisePackReadEvidence,
  type EnterprisePackRevision,
  type EnterprisePackTaskPin,
  type EnterprisePackUpgradeImpact,
  type EnterprisePackUseRecord,
  type EnterprisePanoramaIssue,
  type EnterprisePanoramaRecommendation,
  type EnterprisePanoramaSnapshot,
  type EnterprisePurposePublicationState,
  type PackBusinessStatus,
  type PackFeedbackCategory,
  type PackModulePublicationReceipt,
  type PackPurposeTier,
  type PackSubjectUnit,
} from '../../extensions/business-plugins/studio/enterprise-pack.ts';

type StoredPackIndex = { schemaVersion: 1; packs: EnterpriseDomainPack[] };
const MAX_BYTES = 32 * 1024 * 1024;
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

function feedbackSourceRead(read: EnterprisePackFeedbackSourceRead): EnterprisePackFeedbackSourceRead {
  const ref = sourceRef(read.ref);
  if (ref.authority !== 'data' || !ref.projectId || !ref.taskId || !ref.locator?.startsWith('020_clean/')
    || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? '')) fail('feedback_verification_source_transaction_mismatch', 409);
  return {
    ref, sessionId: text(read.sessionId, 200, false),
    entryId: text(read.entryId, 200, false), toolCallId: text(read.toolCallId, 200, false),
  };
}

function feedbackRowCustody(item: EnterprisePackFeedbackRowCustody): EnterprisePackFeedbackRowCustody {
  const { originalSourceRead, originalSourceRowNumber, originalSourceVisibleOn,
    revisedSourceRead, revisedSourceRowNumber, revisedSourceVisibleOn } = item;
  return {
    ...(originalSourceRead ? { originalSourceRead: feedbackSourceRead(originalSourceRead) } : {}),
    ...(revisedSourceRead ? { revisedSourceRead: feedbackSourceRead(revisedSourceRead) } : {}),
    ...(typeof originalSourceRowNumber === 'number' ? { originalSourceRowNumber } : {}),
    ...(typeof revisedSourceRowNumber === 'number' ? { revisedSourceRowNumber } : {}),
    ...(originalSourceVisibleOn ? { originalSourceVisibleOn: text(originalSourceVisibleOn, 100, false) } : {}),
    ...(revisedSourceVisibleOn ? { revisedSourceVisibleOn: text(revisedSourceVisibleOn, 100, false) } : {}),
  };
}

export interface UpsertPurposeInput {
  targetPurposeId?: string;
  purposeKey: string;
  title: string;
  businessQuestion: string;
  subjectUnit: PackSubjectUnit;
  windowDays?: number;
  scope: EnterprisePackPurposeScope;
  tier: PackPurposeTier;
  limitedCalculationName?: string;
  businessStatus: PackBusinessStatus;
  evidenceReadiness?: {
    definition?: 'pass' | 'pending' | 'fail';
    mapping?: 'pass' | 'pending' | 'fail';
    sampleCalculation?: 'pass' | 'pending' | 'fail';
  };
  originalGoal: string;
  deliveredSubset?: string;
  remainingGaps?: string[];
  exclusions?: string[];
  completionCriteria: string;
  dependencies?: EnterprisePackDependency[];
  policyEffectiveFrom?: string;
  policyEffectiveTo?: string;
  dataCutoffAt?: string;
  observationWindowDays?: number;
  availableHistoryDays?: number;
  decisionChoices?: EnterprisePackDecisionChoice[];
  ownerRole?: string;
  taskOwner?: { projectId: string; taskId: string };
  evidenceNote?: { projectId: string; taskId?: string; note: string; sourceRefs: StudioSourceRef[] };
}

export class EnterprisePackStore {
  readonly dataRoot: string;
  readonly root: string;
  readonly file: string;
  readonly readOnlyMode: boolean;

  constructor(dataRoot: string, options: { readOnlyMode?: boolean } = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.root = path.join(this.dataRoot, 'member-packs');
    this.file = path.join(this.root, 'enterprise-packs.json');
    this.readOnlyMode = options.readOnlyMode === true;
  }

  private assertWritable(): void {
    if (this.readOnlyMode) fail('member_pack_disabled_readonly', 503);
  }

  private directory(dir: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('unsafe_enterprise_pack_storage', 503);
      if (!create) return false;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      stat = fs.lstatSync(dir);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_enterprise_pack_storage', 503);
    return true;
  }

  private load(): StoredPackIndex {
    if (!this.directory(this.dataRoot, false) || !this.directory(this.root, false)) return { schemaVersion: 1, packs: [] };
    if (!fs.existsSync(this.file)) return { schemaVersion: 1, packs: [] };
    const stat = fs.lstatSync(this.file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(MAX_BYTES)) fail('unsafe_enterprise_pack_storage', 503);
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const bytes = fs.readFileSync(fd);
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.packs)) fail('invalid_enterprise_pack_storage', 503);
      return parsed as unknown as StoredPackIndex;
    } catch (error) {
      if (error instanceof StudioError) throw error;
      return fail('invalid_enterprise_pack_storage', 503);
    } finally {
      fs.closeSync(fd);
    }
  }

  private save(index: StoredPackIndex): void {
    this.directory(this.dataRoot, true);
    this.directory(this.root, true);
    const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
    if (bytes.length > MAX_BYTES) fail('enterprise_pack_storage_too_large', 413);
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      fs.renameSync(tmp, this.file);
      const dirFd = fs.openSync(this.root, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch {}
      throw error;
    }
  }

  private mutate<T>(packId: string, fn: (pack: EnterpriseDomainPack) => T): T {
    this.assertWritable();
    const index = this.load();
    const pack = index.packs.find(p => p.id === uuid(packId));
    if (!pack) fail('enterprise_pack_not_found', 404);
    const result = fn(pack);
    pack.revision += 1;
    pack.updatedAt = now();
    this.save(index);
    return clone(result);
  }

  list(enterpriseId?: string): EnterpriseDomainPack[] {
    const all = this.load().packs;
    return clone(enterpriseId ? all.filter(p => p.enterpriseId === uuid(enterpriseId)) : all);
  }

  get(packId: string): EnterpriseDomainPack {
    const found = this.load().packs.find(p => p.id === uuid(packId));
    if (!found) fail('enterprise_pack_not_found', 404);
    return clone(found);
  }

  ensurePack(input: { enterpriseId: string; systemId: string; domain?: string; name: string; packCode?: string }): EnterpriseDomainPack {
    this.assertWritable();
    const enterpriseId = uuid(input.enterpriseId);
    const systemId = uuid(input.systemId);
    const domain = text(input.domain ?? 'member-operations', 100, false).trim().toLowerCase();
    const name = text(input.name, 200, false).trim();
    const index = this.load();
    const existing = index.packs.find(p => p.enterpriseId === enterpriseId && p.domain === domain);
    if (existing) return clone(existing);
    const stamp = now();
    const seq = index.packs.filter(p => p.enterpriseId === enterpriseId).length + 1;
    const pack: EnterpriseDomainPack = {
      id: randomUUID(),
      packCode: input.packCode ? text(input.packCode, 64, false) : `PACK-MEM-${String(seq).padStart(3, '0')}`,
      enterpriseId,
      systemId,
      domain,
      name,
      revision: 1,
      panoramaHistory: [],
      entries: [],
      purposes: [],
      previews: [],
      packRevisions: [],
      taskPins: [],
      feedbackItems: [],
      useRecords: [],
      upgradeImpacts: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    index.packs.push(pack);
    this.save(index);
    return clone(pack);
  }

  savePanorama(packId: string, input: {
    goal: string;
    brand: string;
    channel: string;
    period: string;
    dataCutoffAt: string;
    decisionPurpose: string;
    sourceRefs: StudioSourceRef[];
    recommendations: EnterprisePanoramaRecommendation[];
    issues: EnterprisePanoramaIssue[];
    pendingQuestions?: { id: string; question: string; impact: string; workItemId?: string }[];
    createdByTask?: { projectId: string; taskId: string };
  }): EnterpriseDomainPack {
    return this.mutate(packId, pack => {
      const version = pack.panoramaHistory.length + 1;
      const snapshot: EnterprisePanoramaSnapshot = {
        id: randomUUID(),
        version,
        goal: text(input.goal, 20_000, false),
        brand: text(input.brand, 200, false),
        channel: text(input.channel, 200, false),
        period: text(input.period, 200, false),
        dataCutoffAt: text(input.dataCutoffAt, 100, false),
        decisionPurpose: text(input.decisionPurpose, 2000, false),
        sourceRefs: sources(input.sourceRefs),
        recommendations: input.recommendations.map(rec => ({
          purposeKey: text(rec.purposeKey, 200, false),
          title: text(rec.title, 300, false),
          priorityReason: text(rec.priorityReason, 5000, false),
          deliverableNow: text(rec.deliverableNow, 5000, false),
          minimumEvidence: text(rec.minimumEvidence, 5000, false),
          ownerRole: text(rec.ownerRole, 200, false),
          completionCriteria: text(rec.completionCriteria, 5000, false),
          ...(rec.targetPurposeId ? { targetPurposeId: text(rec.targetPurposeId, 100, false) } : {}),
          ...(rec.scopeKey ? { scopeKey: text(rec.scopeKey, 500, false) } : {}),
          ...(typeof rec.windowDays === 'number' && Number.isFinite(rec.windowDays) ? { windowDays: rec.windowDays } : {}),
          ...(Array.isArray(rec.stores) && rec.stores.length ? { stores: [...new Set(rec.stores.map(s => text(s, 200, false)))] } : {}),
          ...(rec.selected !== undefined ? { selected: Boolean(rec.selected) } : {}),
        })),
        issues: input.issues.map(iss => ({
          id: text(iss.id, 100, false),
          problemName: text(iss.problemName, 300, false),
          businessStatus: iss.businessStatus,
          assetSupportStatus: iss.assetSupportStatus,
          summary: text(iss.summary, 5000, false),
          factOrInference: iss.factOrInference,
          decisionImpact: text(iss.decisionImpact, 5000, false),
          nextStep: text(iss.nextStep, 5000),
          evidence: iss.evidence.map(ev => ({
            sourceRef: sourceRef(ev.sourceRef),
            locator: text(ev.locator, 500, false),
            scope: text(ev.scope, 500, false),
            ...(ev.note ? { note: text(ev.note, 2000) } : {}),
          })),
          ...(iss.candidatePurposeKey ? { candidatePurposeKey: text(iss.candidatePurposeKey, 200, false) } : {}),
        })),
        pendingQuestions: (input.pendingQuestions ?? []).map(q => ({
          id: text(q.id, 100, false),
          question: text(q.question, 5000, false),
          impact: text(q.impact, 5000, false),
          ...(q.workItemId ? { workItemId: text(q.workItemId, 200, false) } : {}),
        })),
        createdAt: now(),
        ...(input.createdByTask ? { createdByTask: { projectId: identity(input.createdByTask.projectId), taskId: identity(input.createdByTask.taskId) } } : {}),
      };
      pack.panorama = snapshot;
      pack.panoramaHistory.push(snapshot);
      return pack;
    });
  }

  selectPanoramaRecommendation(
    packId: string,
    purposeKey: string,
    selected: boolean,
    selector?: { targetPurposeId?: string; scopeKey?: string; title?: string },
  ): EnterpriseDomainPack {
    return this.mutate(packId, pack => {
      if (!pack.panorama) fail('enterprise_pack_panorama_not_found', 404);
      const key = text(purposeKey, 200, false).trim();
      const matches = (r: EnterprisePanoramaRecommendation) =>
        r.purposeKey === key
        && (!selector?.targetPurposeId || r.targetPurposeId === selector.targetPurposeId)
        && (!selector?.scopeKey || r.scopeKey === selector.scopeKey)
        && (!selector?.title || r.title === selector.title);
      const rec = pack.panorama.recommendations.find(matches);
      if (!rec) fail('enterprise_pack_recommendation_not_found', 404);
      rec.selected = Boolean(selected);
      const latestHist = pack.panoramaHistory.at(-1);
      if (latestHist && latestHist.id === pack.panorama.id) {
        const histRec = latestHist.recommendations.find(matches);
        if (histRec) histRec.selected = Boolean(selected);
      }
      return pack;
    });
  }

  bindContinuationOwner(packId: string, projectId: string, taskId?: string, reason?: string): EnterpriseDomainPack {
    return this.mutate(packId, pack => {
      const pid = identity(projectId);
      const tid = taskId ? identity(taskId) : undefined;
      if (pack.activeOwnerProjectId !== pid) {
        pack.activeOwnerProjectId = pid;
        pack.continuationHistory = pack.continuationHistory ?? [];
        pack.continuationHistory.push({
          projectId: pid,
          ...(tid ? { taskId: tid } : {}),
          ...(reason ? { reason: text(reason, 1000, false) } : {}),
          continuedAt: now(),
        });
      }
      return pack;
    });
  }

  upsertEntry(packId: string, input: Omit<EnterprisePackEntry, 'id' | 'updatedAt'> & { id?: string }): EnterpriseDomainPack {
    return this.mutate(packId, pack => {
      const entryKey = text(input.entryKey, 200, false).trim();
      const routes: DomainReferenceRoute[] = [...new Set(input.routes)];
      if (!routes.length) fail('invalid_pack_entry_routes');
      const existing = pack.entries.find(e => e.entryKey === entryKey || (input.id && e.id === input.id));
      const stamp = now();
      if (existing) {
        existing.title = text(input.title, 300, false);
        existing.action = input.action;
        existing.routes = [...new Set([...existing.routes, ...routes])];
        const mergedLinks = [...existing.referenceLinks];
        for (const link of input.referenceLinks) {
          const sig = digest([link.refId, link.sourceId, link.version, link.sectionLocator, link.excerpt ?? '']);
          if (!mergedLinks.some(item => digest([item.refId, item.sourceId, item.version, item.sectionLocator, item.excerpt ?? '']) === sig)) {
            mergedLinks.push(link);
          }
        }
        existing.referenceLinks = mergedLinks;
        const incomingBasis = text(input.enterpriseBasis, 20_000, false).trim();
        if (incomingBasis && !existing.enterpriseBasis.includes(incomingBasis)) {
          existing.enterpriseBasis = existing.enterpriseBasis.trim()
            ? `${existing.enterpriseBasis.trim()}\n${incomingBasis}`
            : incomingBasis;
        }
        existing.decisionOwner = input.decisionOwner ? text(input.decisionOwner, 200, false) : existing.decisionOwner;
        const mergedSources = new Map<string, StudioSourceRef>();
        for (const ref of [...existing.enterpriseSourceRefs, ...sources(input.enterpriseSourceRefs)]) {
          mergedSources.set(digest(ref), ref);
        }
        existing.enterpriseSourceRefs = [...mergedSources.values()];
        existing.authorityRef = input.authorityRef ? sourceRef(input.authorityRef) : existing.authorityRef;
        existing.scope = text(input.scope, 5000, false);
        existing.grain = input.grain ? text(input.grain, 200, false) : existing.grain;
        existing.validFrom = input.validFrom ?? existing.validFrom;
        existing.validTo = input.validTo ?? existing.validTo;
        existing.impactedPurposeIds = [...new Set([...existing.impactedPurposeIds, ...input.impactedPurposeIds])];
        const mergedExceptions = new Map<string, EnterprisePackException>();
        for (const ex of [...existing.exceptions, ...input.exceptions]) {
          mergedExceptions.set(ex.id, ex);
        }
        existing.exceptions = [...mergedExceptions.values()];
        existing.updatedAt = stamp;
      } else {
        pack.entries.push({
          id: input.id ? text(input.id, 200, false) : randomUUID(),
          entryKey,
          title: text(input.title, 300, false),
          action: input.action,
          routes,
          referenceLinks: input.referenceLinks,
          enterpriseBasis: text(input.enterpriseBasis, 20_000, false),
          ...(input.decisionOwner ? { decisionOwner: text(input.decisionOwner, 200, false) } : {}),
          enterpriseSourceRefs: sources(input.enterpriseSourceRefs),
          ...(input.authorityRef ? { authorityRef: sourceRef(input.authorityRef) } : {}),
          scope: text(input.scope, 5000, false),
          ...(input.grain ? { grain: text(input.grain, 200, false) } : {}),
          ...(input.validFrom ? { validFrom: input.validFrom } : {}),
          ...(input.validTo ? { validTo: input.validTo } : {}),
          impactedPurposeIds: [...new Set(input.impactedPurposeIds)],
          exceptions: input.exceptions,
          updatedAt: stamp,
        });
      }
      return pack;
    });
  }

  upsertPurpose(packId: string, input: UpsertPurposeInput): { pack: EnterpriseDomainPack; purpose: EnterprisePackPurpose; created: boolean } {
    return this.mutate(packId, pack => {
      const purposeKey = text(input.purposeKey, 200, false).trim();
      if (!input.scope || typeof input.scope !== 'object') fail('invalid_purpose_scope');
      const scopeKey = text(input.scope.scopeKey, 500, false).trim();
      if (input.tier === 'limited-calculation' && !input.limitedCalculationName?.trim()) {
        fail('limited_calculation_requires_distinct_name');
      }
      const dedupKey = normalizePurposeDedupKey({
        enterpriseId: pack.enterpriseId,
        packId: pack.id,
        purposeKey,
        subjectUnit: input.subjectUnit,
        scopeKey,
        windowDays: input.windowDays,
      });
      let existing: EnterprisePackPurpose | undefined;
      if (input.targetPurposeId?.trim()) {
        existing = pack.purposes.find(p => p.id === input.targetPurposeId!.trim());
        if (!existing) fail('enterprise_pack_purpose_not_found', 404);
      } else {
        existing = pack.purposes.find(p => p.dedupKey === dedupKey);
        if (!existing && input.windowDays === undefined && !input.scope?.stores?.length) {
          const sameKeyPurposes = pack.purposes.filter(p => p.purposeKey === purposeKey && p.subjectUnit === input.subjectUnit);
          if (sameKeyPurposes.length === 1) {
            existing = sameKeyPurposes[0];
          } else if (sameKeyPurposes.length > 1) {
            fail('enterprise_pack_purpose_ambiguous', 409);
          }
        }
      }
      const stamp = now();
      if (existing) {
        existing.title = text(input.title, 300, false);
        existing.businessQuestion = text(input.businessQuestion, 5000, false);
        const preserveCalcTier = input.tier === 'definition-reference' && existing.tier !== 'definition-reference' && !input.dependencies?.length;
        if (!preserveCalcTier) existing.tier = input.tier;
        if (input.limitedCalculationName) existing.limitedCalculationName = text(input.limitedCalculationName, 300, false);
        existing.businessStatus = input.businessStatus;
        if (input.windowDays !== undefined) existing.windowDays = input.windowDays;
        if (input.scope) {
          const keepExistingStores = !input.scope.stores?.length && Boolean(existing.scope.stores?.length);
          existing.scope = {
            ...existing.scope,
            ...input.scope,
            ...(keepExistingStores ? { stores: existing.scope.stores, scopeKey: existing.scope.scopeKey } : { scopeKey }),
          };
        }
        if (input.evidenceReadiness) {
          if (input.evidenceReadiness.definition) existing.evidenceReadiness.definition = input.evidenceReadiness.definition;
          if (input.evidenceReadiness.mapping) existing.evidenceReadiness.mapping = input.evidenceReadiness.mapping;
          if (input.evidenceReadiness.sampleCalculation) existing.evidenceReadiness.sampleCalculation = input.evidenceReadiness.sampleCalculation;
        }
        if (input.deliveredSubset !== undefined) existing.deliveredSubset = text(input.deliveredSubset, 5000);
        if (input.remainingGaps) existing.remainingGaps = input.remainingGaps.map(g => text(g, 2000, false));
        if (input.exclusions?.length) existing.exclusions = [...new Set([...existing.exclusions, ...input.exclusions.map(e => text(e, 2000, false))])];
        if (input.dependencies?.length) {
          existing.dependencies = input.dependencies.map(d => ({ ...d, ref: sourceRef(d.ref) }));
        }
        if (input.policyEffectiveFrom) existing.policyEffectiveFrom = input.policyEffectiveFrom;
        if (input.policyEffectiveTo) existing.policyEffectiveTo = input.policyEffectiveTo;
        if (input.dataCutoffAt) existing.dataCutoffAt = input.dataCutoffAt;
        if (input.observationWindowDays !== undefined) existing.observationWindowDays = input.observationWindowDays;
        if (input.availableHistoryDays !== undefined) existing.availableHistoryDays = input.availableHistoryDays;
        if (input.decisionChoices?.length) existing.decisionChoices = input.decisionChoices;
        if (input.ownerRole) existing.ownerRole = text(input.ownerRole, 200, false);
        if (input.taskOwner) {
          const ownerKey = `${input.taskOwner.projectId}:${input.taskOwner.taskId}`;
          if (!existing.maintenanceTasks.some(t => `${t.projectId}:${t.taskId}` === ownerKey)) {
            existing.maintenanceTasks.push({ projectId: identity(input.taskOwner.projectId), taskId: identity(input.taskOwner.taskId), addedAt: stamp });
          }
        }
        if (input.evidenceNote) {
          const noteText = text(input.evidenceNote.note, 5000, false).trim();
          const noteRefs = sources(input.evidenceNote.sourceRefs);
          const noteSig = digest([noteText, noteRefs]);
          if (!existing.evidenceNotes.some(n => digest([n.note, n.sourceRefs]) === noteSig)) {
            existing.evidenceNotes.push({
              id: randomUUID(),
              projectId: identity(input.evidenceNote.projectId),
              ...(input.evidenceNote.taskId ? { taskId: identity(input.evidenceNote.taskId) } : {}),
              note: noteText,
              sourceRefs: noteRefs,
              at: stamp,
            });
          }
        }
        existing.updatedAt = stamp;
        return { pack, purpose: existing, created: false };
      }

      const nextIndex = pack.purposes.length + 1;
      const purpose: EnterprisePackPurpose = {
        id: `U-${String(nextIndex).padStart(2, '0')}`,
        dedupKey,
        purposeKey,
        title: text(input.title, 300, false),
        businessQuestion: text(input.businessQuestion, 5000, false),
        subjectUnit: input.subjectUnit,
        ...(input.windowDays !== undefined ? { windowDays: input.windowDays } : {}),
        scope: { ...input.scope, scopeKey },
        tier: input.tier,
        ...(input.limitedCalculationName ? { limitedCalculationName: text(input.limitedCalculationName, 300, false) } : {}),
        businessStatus: input.businessStatus,
        evidenceReadiness: {
          definition: input.evidenceReadiness?.definition ?? 'pending',
          mapping: input.evidenceReadiness?.mapping ?? 'pending',
          sampleCalculation: input.evidenceReadiness?.sampleCalculation ?? 'pending',
          independentUse: 'pending',
        },
        originalGoal: text(input.originalGoal, 5000, false),
        ...(input.deliveredSubset ? { deliveredSubset: text(input.deliveredSubset, 5000) } : {}),
        remainingGaps: (input.remainingGaps ?? []).map(g => text(g, 2000, false)),
        exclusions: (input.exclusions ?? []).map(e => text(e, 2000, false)),
        completionCriteria: text(input.completionCriteria, 5000, false),
        dependencies: (input.dependencies ?? []).map(d => ({ ...d, ref: sourceRef(d.ref) })),
        ...(input.policyEffectiveFrom ? { policyEffectiveFrom: input.policyEffectiveFrom } : {}),
        ...(input.policyEffectiveTo ? { policyEffectiveTo: input.policyEffectiveTo } : {}),
        ...(input.dataCutoffAt ? { dataCutoffAt: input.dataCutoffAt } : {}),
        ...(input.observationWindowDays !== undefined ? { observationWindowDays: input.observationWindowDays } : {}),
        ...(input.availableHistoryDays !== undefined ? { availableHistoryDays: input.availableHistoryDays } : {}),
        decisionChoices: input.decisionChoices ?? [],
        workItemStatus: 'draft',
        ...(input.ownerRole ? { ownerRole: text(input.ownerRole, 200, false) } : {}),
        maintenanceTasks: input.taskOwner ? [{ projectId: identity(input.taskOwner.projectId), taskId: identity(input.taskOwner.taskId), addedAt: stamp }] : [],
        evidenceNotes: input.evidenceNote ? [{
          id: randomUUID(),
          projectId: identity(input.evidenceNote.projectId),
          ...(input.evidenceNote.taskId ? { taskId: identity(input.evidenceNote.taskId) } : {}),
          note: text(input.evidenceNote.note, 5000, false).trim(),
          sourceRefs: sources(input.evidenceNote.sourceRefs),
          at: stamp,
        }] : [],
        createdAt: stamp,
        updatedAt: stamp,
      };
      pack.purposes.push(purpose);
      return { pack, purpose, created: true };
    });
  }

  private computeDraftFingerprint(pack: EnterpriseDomainPack, purposeIds: readonly string[]): string {
    const selectedPurposes = purposeIds
      .map(pid => pack.purposes.find(p => p.id === pid))
      .filter((p): p is EnterprisePackPurpose => Boolean(p))
      .map(p => ({
        id: p.id,
        purposeKey: p.purposeKey,
        title: p.title,
        tier: p.tier,
        limitedCalculationName: p.limitedCalculationName ?? null,
        subjectUnit: p.subjectUnit,
        windowDays: p.windowDays ?? null,
        scope: p.scope,
        businessStatus: p.businessStatus,
        evidenceReadiness: {
          definition: p.evidenceReadiness.definition,
          mapping: p.evidenceReadiness.mapping,
          sampleCalculation: p.evidenceReadiness.sampleCalculation,
        },
        exclusions: p.exclusions,
        remainingGaps: p.remainingGaps,
        dependencies: p.dependencies,
        policyEffectiveFrom: p.policyEffectiveFrom ?? null,
        policyEffectiveTo: p.policyEffectiveTo ?? null,
        dataCutoffAt: p.dataCutoffAt ?? null,
        observationWindowDays: p.observationWindowDays ?? null,
        availableHistoryDays: p.availableHistoryDays ?? null,
        decisionChoices: p.decisionChoices.map(c => ({ id: c.id, selectedKey: c.selectedKey ?? null, decidedBy: c.decidedBy ?? null })),
      }));
    const relevantEntries = pack.entries
      .filter(e => !e.impactedPurposeIds.length || e.impactedPurposeIds.some(pid => purposeIds.includes(pid)))
      .map(e => ({
        id: e.id,
        entryKey: e.entryKey,
        action: e.action,
        authorityRef: e.authorityRef ?? null,
        scope: e.scope,
        validFrom: e.validFrom ?? null,
        validTo: e.validTo ?? null,
        exceptions: e.exceptions,
      }));
    return digest({ selectedPurposes, relevantEntries });
  }

  preparePreview(packId: string, input: {
    version: string;
    previousVersion?: string;
    purposeIds: string[];
    decisions?: { purposeId: string; choiceId: string; selectedKey: string; decidedBy?: string }[];
    policyEffectiveFrom?: string;
    dataCutoffAt?: string;
    summary: string;
  }): EnterprisePackPreview {
    return this.mutate(packId, pack => {
      const version = text(input.version, 50, false).trim();
      if (pack.packRevisions.some(r => r.version === version)) fail('enterprise_pack_version_exists', 409);
      const currentActive = pack.packRevisions.find(r => r.status === 'active');
      const resolvedPrevVersion = input.previousVersion !== undefined && input.previousVersion !== null && String(input.previousVersion).trim() !== ''
        ? text(input.previousVersion, 50, false).trim()
        : currentActive?.version;
      if ((currentActive?.version ?? undefined) !== (resolvedPrevVersion ?? undefined)) {
        fail('enterprise_pack_previous_version_mismatch', 409);
      }
      if (!Array.isArray(input.purposeIds) || !input.purposeIds.length) fail('empty_pack_preview');

      const decisionsSnapshot: EnterprisePackPreview['decisions'] = [];
      const purposeSnapshots: EnterprisePurposePublicationState[] = [];

      for (const pid of [...new Set(input.purposeIds)]) {
        const purpose = pack.purposes.find(p => p.id === pid);
        if (!purpose) fail('enterprise_pack_purpose_not_found', 404);

        // Apply any submitted decision choices and validate required choices & explicit decider
        for (const choice of purpose.decisionChoices) {
          const submitted = input.decisions?.find(d => d.purposeId === pid && d.choiceId === choice.id);
          const chosenKey = (submitted?.selectedKey ?? choice.selectedKey ?? '').trim();
          if (!chosenKey) fail('enterprise_pack_decision_required', 409);
          const option = choice.options.find(o => o.key === chosenKey);
          if (!option) fail('invalid_enterprise_pack_decision', 400);
          const decider = (submitted?.decidedBy ?? choice.decidedBy ?? '').trim();
          if (!decider) fail('enterprise_pack_decision_owner_required', 409);
          choice.selectedKey = chosenKey;
          choice.decidedBy = text(decider, 200, false);
          choice.decidedAt = choice.decidedAt ?? now();
          decisionsSnapshot.push({
            purposeId: pid,
            choiceId: choice.id,
            selectedKey: chosenKey,
            label: option.label,
            decidedBy: choice.decidedBy,
          });
        }

        // Collect related exceptions from pack entries
        const exceptions = pack.entries
          .filter(e => !e.impactedPurposeIds.length || e.impactedPurposeIds.includes(pid))
          .flatMap(e => e.exceptions);

        // Evaluate history window & overlapping exceptions WITHOUT conflating dataCutoffAt with eventDate
        const isCalc = purpose.tier === 'formal-calculation' || purpose.tier === 'limited-calculation';
        const evalResult = evaluateExceptionsAndWindow({
          purposeStores: purpose.scope.stores,
          exceptions,
          observationWindowDays: purpose.observationWindowDays,
          availableHistoryDays: purpose.availableHistoryDays,
          requireHistoryDays: isCalc,
        });

        const requiredDeps = purpose.dependencies.filter(d => d.requiredFor.includes(purpose.tier));
        let status: EnterprisePurposePublicationState['status'] = 'eligible';
        let suspensionReason: string | undefined;
        if (evalResult.overlapConflict) {
          status = 'conflict_blocked';
          suspensionReason = '存在未批准优先关系的同范围重叠例外，受影响范围保持候选限制';
        } else if (isCalc && !evalResult.windowSufficient) {
          status = 'restricted';
          suspensionReason = purpose.availableHistoryDays === undefined
            ? `缺少首购/历史周期长度证据，无法满足所需观察窗（${purpose.observationWindowDays}天），保留限制`
            : `已知历史长度（${purpose.availableHistoryDays}天）不足所需观察窗（${purpose.observationWindowDays}天），保留限制`;
        } else if (isCalc && requiredDeps.length === 0) {
          status = 'suspended';
          suspensionReason = '计算类用途缺少原权威必要依赖，不能进入合格目录';
        } else if (isCalc && (
          purpose.evidenceReadiness.definition !== 'pass'
          || purpose.evidenceReadiness.mapping !== 'pass'
          || purpose.evidenceReadiness.sampleCalculation !== 'pass'
        )) {
          const missing: string[] = [];
          if (purpose.evidenceReadiness.definition !== 'pass') missing.push('定义核验');
          if (purpose.evidenceReadiness.mapping !== 'pass') missing.push('字段映射核验');
          if (purpose.evidenceReadiness.sampleCalculation !== 'pass') missing.push('样本试算核验');
          status = 'suspended';
          suspensionReason = `计算类用途尚未完成前置核验（缺少：${missing.join('、')}），暂不可进入合格目录`;
        }

        purposeSnapshots.push({
          purposeId: purpose.id,
          purposeKey: purpose.purposeKey,
          title: purpose.title,
          tier: purpose.tier,
          ...(purpose.limitedCalculationName ? { limitedCalculationName: purpose.limitedCalculationName } : {}),
          subjectUnit: purpose.subjectUnit,
          ...(purpose.windowDays !== undefined ? { windowDays: purpose.windowDays } : {}),
          scope: clone(purpose.scope),
          ...(input.policyEffectiveFrom ?? purpose.policyEffectiveFrom ? { policyEffectiveFrom: input.policyEffectiveFrom ?? purpose.policyEffectiveFrom } : {}),
          ...(input.dataCutoffAt ?? purpose.dataCutoffAt ? { dataCutoffAt: input.dataCutoffAt ?? purpose.dataCutoffAt } : {}),
          ...(purpose.observationWindowDays !== undefined ? { observationWindowDays: purpose.observationWindowDays } : {}),
          ...(purpose.availableHistoryDays !== undefined ? { availableHistoryDays: purpose.availableHistoryDays } : {}),
          evidenceReadiness: {
            definition: purpose.evidenceReadiness.definition,
            mapping: purpose.evidenceReadiness.mapping,
            sampleCalculation: purpose.evidenceReadiness.sampleCalculation,
          },
          exclusions: [...purpose.exclusions],
          gaps: [...purpose.remainingGaps],
          dependencies: clone(purpose.dependencies),
          exceptions: clone(exceptions),
          status,
          ...(suspensionReason ? { suspensionReason } : {}),
        });
      }

      const uniquePurposeIds = [...new Set(input.purposeIds)];
      const draftFingerprint = this.computeDraftFingerprint(pack, uniquePurposeIds);
      const createdAt = now();
      const bodyForFingerprint = {
        version,
        previousVersion: resolvedPrevVersion ?? null,
        packRevision: pack.revision,
        draftFingerprint,
        summary: text(input.summary, 5000, false),
        policyEffectiveFrom: input.policyEffectiveFrom ?? null,
        dataCutoffAt: input.dataCutoffAt ?? null,
        purposeIds: uniquePurposeIds,
        decisions: decisionsSnapshot,
        purposeSnapshots,
      };
      const preview: EnterprisePackPreview = {
        id: randomUUID(),
        version,
        ...(resolvedPrevVersion ? { previousVersion: resolvedPrevVersion } : {}),
        fingerprint: digest(bodyForFingerprint),
        draftFingerprint,
        packRevision: pack.revision,
        summary: text(input.summary, 5000, false),
        ...(input.policyEffectiveFrom ? { policyEffectiveFrom: input.policyEffectiveFrom } : {}),
        ...(input.dataCutoffAt ? { dataCutoffAt: input.dataCutoffAt } : {}),
        purposeIds: uniquePurposeIds,
        decisions: decisionsSnapshot,
        purposeSnapshots,
        createdAt,
      };
      pack.previews.push(preview);
      return preview;
    });
  }

  /**
   * Validates preview existence, fingerprint, version uniqueness, predecessor match, and draft stability
   * BEFORE any original authority publication write is attempted (zero side effects on 404/409).
   */
  validateConfirmPreconditions(packId: string, previewId: string, fingerprint: string): {
    pack: EnterpriseDomainPack;
    preview: EnterprisePackPreview;
    existingRevision?: EnterprisePackRevision;
  } {
    const pack = this.get(packId);
    const preview = pack.previews.find(p => p.id === uuid(previewId));
    if (!preview) fail('enterprise_pack_preview_not_found', 404);
    if (preview.fingerprint !== fingerprint) fail('enterprise_pack_preview_changed', 409);
    if (preview.confirmedAt) {
      const existingRevision = pack.packRevisions.find(r => r.previewId === preview.id);
      if (existingRevision) return { pack, preview, existingRevision };
    }
    // Reject if ANOTHER preview has already published this version number!
    if (pack.packRevisions.some(r => r.version === preview.version)) {
      fail('enterprise_pack_version_exists', 409);
    }
    // Reject if the current active revision no longer matches this preview's predecessor!
    const currentActive = pack.packRevisions.find(r => r.status === 'active');
    if ((currentActive?.version ?? undefined) !== (preview.previousVersion ?? undefined)) {
      fail('enterprise_pack_previous_version_mismatch', 409);
    }
    if (preview.draftFingerprint) {
      const currentDraftFingerprint = this.computeDraftFingerprint(pack, preview.purposeIds);
      if (currentDraftFingerprint !== preview.draftFingerprint) {
        fail('enterprise_pack_draft_changed', 409);
      }
    }
    return { pack, preview };
  }

  private recomputePurposeEligibility(
    pack: EnterpriseDomainPack,
    purposeManifests: EnterprisePurposePublicationState[],
    receipts: PackModulePublicationReceipt[],
  ): void {
    for (const pm of purposeManifests) {
      // Unchanged purposes carried over from a prior active revision preserve their original frozen state!
      if (pm.carriedOverFromVersion) continue;
      if (pm.status === 'conflict_blocked' || pm.status === 'restricted') continue;
      const isCalc = pm.tier === 'formal-calculation' || pm.tier === 'limited-calculation';
      // Always read frozen snapshot fields captured at preview time (fallback to draft ONLY for legacy pre-Round-3 records)
      const legacyDraft = pm.evidenceReadiness === undefined ? pack.purposes.find(p => p.id === pm.purposeId) : undefined;
      const obsWindow = pm.observationWindowDays !== undefined ? pm.observationWindowDays : legacyDraft?.observationWindowDays;
      const availDays = pm.availableHistoryDays !== undefined ? pm.availableHistoryDays : legacyDraft?.availableHistoryDays;
      const readiness = pm.evidenceReadiness ?? legacyDraft?.evidenceReadiness;

      if (isCalc) {
        if (obsWindow !== undefined && (availDays === undefined || availDays < obsWindow)) {
          pm.status = 'restricted';
          pm.suspensionReason = availDays === undefined
            ? `缺少首购/历史周期长度证据，无法满足所需观察窗（${obsWindow}天），保留限制`
            : `已知历史长度（${availDays}天）不足所需观察窗（${obsWindow}天），保留限制`;
          continue;
        }
        if (
          !readiness
          || readiness.definition !== 'pass'
          || readiness.mapping !== 'pass'
          || readiness.sampleCalculation !== 'pass'
        ) {
          pm.status = 'suspended';
          pm.suspensionReason = '计算类用途尚未完成定义/映射/样本试算前置核验，暂不可进入合格目录';
          continue;
        }
      }
      const requiredDeps = pm.dependencies.filter(d => d.requiredFor.includes(pm.tier));
      if (isCalc && requiredDeps.length === 0) {
        pm.status = 'suspended';
        pm.suspensionReason = '计算类用途缺少原权威必要依赖，不能进入合格目录';
        continue;
      }
      const unsatisfied: string[] = [];
      for (const dep of requiredDeps) {
        const matchingReceipts = receipts.filter(r => sameExactSourceRef(r.targetRef, dep.ref));
        const latest = matchingReceipts.at(-1);
        if (!latest || latest.status !== 'succeeded') {
          unsatisfied.push(`${dep.role}:${dep.ref.id}@${dep.ref.version}(${latest?.status ?? 'missing'})`);
        }
      }
      if (unsatisfied.length > 0) {
        pm.status = 'suspended';
        pm.suspensionReason = `必要依赖尚未成功：${unsatisfied.join('、')}`;
      } else {
        pm.status = 'eligible';
        pm.suspensionReason = undefined;
      }
    }
  }

  confirmPreview(packId: string, input: {
    previewId: string;
    fingerprint: string;
    confirmedBy?: string;
    moduleReceipts: {
      requestId: string;
      authority: PackModulePublicationReceipt['authority'];
      targetRef: StudioSourceRef;
      status: 'succeeded' | 'failed' | 'unknown';
      detail: string;
      purposeIds: string[];
      authorityOperationId?: string;
      authorityPublishedBy?: string;
    }[];
  }): EnterprisePackRevision {
    const precheck = this.validateConfirmPreconditions(packId, input.previewId, input.fingerprint);
    if (precheck.existingRevision) return precheck.existingRevision;

    return this.mutate(packId, pack => {
      const preview = pack.previews.find(p => p.id === uuid(input.previewId));
      if (!preview) fail('enterprise_pack_preview_not_found', 404);
      if (preview.fingerprint !== input.fingerprint) fail('enterprise_pack_preview_changed', 409);
      if (preview.confirmedAt) {
        return pack.packRevisions.find(r => r.previewId === preview.id)!;
      }
      if (pack.packRevisions.some(r => r.version === preview.version)) {
        fail('enterprise_pack_version_exists', 409);
      }
      const currentActive = pack.packRevisions.find(r => r.status === 'active');
      if ((currentActive?.version ?? undefined) !== (preview.previousVersion ?? undefined)) {
        fail('enterprise_pack_previous_version_mismatch', 409);
      }
      // Reject stale preview if draft purposes/entries/exceptions drifted after preparePreview!
      if (preview.draftFingerprint) {
        const currentDraftFingerprint = this.computeDraftFingerprint(pack, preview.purposeIds);
        if (currentDraftFingerprint !== preview.draftFingerprint) {
          fail('enterprise_pack_draft_changed', 409);
        }
      }

      const stamp = now();
      const receipts: PackModulePublicationReceipt[] = input.moduleReceipts.map(r => {
        const ref = sourceRef(r.targetRef);
        return {
          receiptId: randomUUID(),
          requestId: text(r.requestId, 200, false),
          authority: r.authority,
          targetRef: ref,
          targetFingerprint: digest(ref),
          status: r.status,
          detail: text(r.detail, 5000, false),
          purposeIds: [...new Set(r.purposeIds)],
          ...(r.authorityOperationId ? { authorityOperationId: text(r.authorityOperationId, 200, false) } : {}),
          ...(r.authorityPublishedBy ? { authorityPublishedBy: text(r.authorityPublishedBy, 200, false) } : {}),
          at: stamp,
        };
      });

      const purposeManifests = clone(preview.purposeSnapshots);
      this.recomputePurposeEligibility(pack, purposeManifests, receipts);

      // Carry over unchanged purposes from the previous active revision when only impacted purposes are republished!
      const previousActive = pack.packRevisions.find(r => r.status === 'active');
      if (previousActive) {
        const republishedIds = new Set(purposeManifests.map(pm => pm.purposeId));
        for (const priorPm of previousActive.purposeManifests) {
          if (republishedIds.has(priorPm.purposeId)) continue;
          const draftStillPresent = pack.purposes.find(p => p.id === priorPm.purposeId);
          if (!draftStillPresent || draftStillPresent.businessStatus === 'not_launched') continue;
          purposeManifests.push({
            ...clone(priorPm),
            carriedOverFromVersion: priorPm.carriedOverFromVersion ?? previousActive.version,
          });
        }
      }

      // Mark previous active revision as superseded (retaining it immutably for historical lookups!)
      for (const oldRev of pack.packRevisions) {
        if (oldRev.status === 'active') oldRev.status = 'superseded';
      }

      const manifestCore = {
        version: preview.version,
        previousVersion: preview.previousVersion ?? null,
        previewId: preview.id,
        previewFingerprint: preview.fingerprint,
        decisionsSnapshot: preview.decisions,
        purposeManifests: purposeManifests.map(pm => ({
          purposeId: pm.purposeId,
          purposeKey: pm.purposeKey,
          tier: pm.tier,
          dependencies: pm.dependencies,
          scope: pm.scope,
          exclusions: pm.exclusions,
          ...(pm.carriedOverFromVersion ? { carriedOverFromVersion: pm.carriedOverFromVersion } : {}),
        })),
      };

      const revision: EnterprisePackRevision = {
        version: preview.version,
        ...(preview.previousVersion ? { previousVersion: preview.previousVersion } : {}),
        previewId: preview.id,
        previewFingerprint: preview.fingerprint,
        manifestSha256: digest(manifestCore),
        confirmedAt: stamp,
        ...(input.confirmedBy ? { confirmedBy: text(input.confirmedBy, 200, false) } : {}),
        ...(preview.policyEffectiveFrom ? { policyEffectiveFrom: preview.policyEffectiveFrom } : {}),
        ...(preview.dataCutoffAt ? { dataCutoffAt: preview.dataCutoffAt } : {}),
        decisionsSnapshot: clone(preview.decisions),
        purposeManifests,
        moduleReceipts: receipts,
        status: 'active',
      };

      preview.confirmedAt = stamp;
      pack.packRevisions.push(revision);

      // Update ONLY newly-republished purpose draft statuses without disturbing unchanged carried-over purposes
      for (const pm of purposeManifests) {
        if (pm.carriedOverFromVersion) continue;
        const purpose = pack.purposes.find(p => p.id === pm.purposeId);
        if (!purpose) continue;
        purpose.workItemStatus = pm.status === 'eligible' ? 'published' : pm.status === 'suspended' ? 'partially_suspended' : 'restricted';
        purpose.updatedAt = stamp;
      }

      return revision;
    });
  }

  /**
   * Append-only reconciliation of a previously unknown (or failed read-only recheck) module receipt.
   * Original failed/unknown receipts are ALWAYS preserved in chronological order.
   * A definite original 'failed' receipt can NEVER be silently promoted to 'succeeded' via reconcile.
   */
  reconcileModuleReceipt(packId: string, version: string, input: {
    requestId: string;
    authority: PackModulePublicationReceipt['authority'];
    targetRef: StudioSourceRef;
    status: 'succeeded' | 'failed' | 'unknown';
    detail: string;
    purposeIds: string[];
    authorityOperationId?: string;
    authorityPublishedBy?: string;
    supersedesReceiptId?: string;
  }): EnterprisePackRevision {
    return this.mutate(packId, pack => {
      const revision = pack.packRevisions.find(r => r.version === version);
      if (!revision) fail('enterprise_pack_revision_not_found', 404);
      const ref = sourceRef(input.targetRef);
      const priorForReq = revision.moduleReceipts.filter(r => r.requestId === input.requestId);
      const firstReceipt = priorForReq[0];
      // Definite original failure cannot be retroactively rewritten as succeeded by reconcile!
      if (firstReceipt && firstReceipt.status === 'failed' && input.status === 'succeeded') {
        fail('enterprise_pack_failed_receipt_not_reconcilable', 409);
      }
      const hasOperationEvidence = Boolean(
        input.authorityOperationId
        || input.authorityPublishedBy
        || firstReceipt?.authorityOperationId
        || firstReceipt?.authorityPublishedBy,
      );
      const effectiveStatus = (firstReceipt?.status === 'unknown' && input.status === 'succeeded' && !hasOperationEvidence)
        ? 'unknown'
        : input.status;
      const effectiveDetail = (effectiveStatus === 'unknown' && input.status === 'succeeded')
        ? `${text(input.detail, 4800, false)}（缺少原权威操作凭据，保持 UNKNOWN）`
        : text(input.detail, 5000, false);
      const receipt: PackModulePublicationReceipt = {
        receiptId: randomUUID(),
        requestId: text(input.requestId, 200, false),
        authority: input.authority,
        targetRef: ref,
        targetFingerprint: digest(ref),
        status: effectiveStatus,
        detail: effectiveDetail,
        purposeIds: [...new Set(input.purposeIds)],
        ...(input.authorityOperationId ? { authorityOperationId: text(input.authorityOperationId, 200, false) } : firstReceipt?.authorityOperationId ? { authorityOperationId: firstReceipt.authorityOperationId } : {}),
        ...(input.authorityPublishedBy ? { authorityPublishedBy: text(input.authorityPublishedBy, 200, false) } : firstReceipt?.authorityPublishedBy ? { authorityPublishedBy: firstReceipt.authorityPublishedBy } : {}),
        ...(input.supersedesReceiptId ? { supersedesReceiptId: input.supersedesReceiptId } : {}),
        at: now(),
      };
      revision.moduleReceipts.push(receipt);
      this.recomputePurposeEligibility(pack, revision.purposeManifests, revision.moduleReceipts);

      if (revision.status === 'active') {
        for (const pm of revision.purposeManifests) {
          if (pm.carriedOverFromVersion) continue;
          const purpose = pack.purposes.find(p => p.id === pm.purposeId);
          if (purpose) {
            purpose.workItemStatus = pm.status === 'eligible' ? 'published' : pm.status === 'suspended' ? 'partially_suspended' : 'restricted';
          }
        }
      }
      return revision;
    });
  }

  pinTaskVersion(packId: string, input: { projectId: string; taskId: string; authorizedScope: string; version?: string; qualifiedPurposes?: Pick<EnterprisePurposePublicationState, 'purposeId' | 'dependencies'>[] }): EnterprisePackTaskPin {
    const existing = this.getTaskPin(packId, input.projectId, input.taskId);
    if (existing) return existing;

    return this.mutate(packId, pack => {
      const pid = identity(input.projectId), tid = identity(input.taskId);
      const already = pack.taskPins.find(p => p.projectId === pid && p.taskId === tid);
      if (already) return already;

      const rev = input.version
        ? pack.packRevisions.find(r => r.version === input.version)
        : pack.packRevisions.find(r => r.status === 'active') ?? pack.packRevisions.at(-1);
      if (!rev) fail('enterprise_pack_no_published_revision', 409);

      const eligiblePurposes = input.qualifiedPurposes ?? rev.purposeManifests.filter(pm => pm.status === 'eligible');
      const pinnedAuthorityRefs = [...new Map(
        eligiblePurposes.flatMap(pm => pm.dependencies.map(d => [digest(d.ref), d.ref] as const)),
      ).values()];

      const pin: EnterprisePackTaskPin = {
        projectId: pid,
        taskId: tid,
        enterpriseId: pack.enterpriseId,
        packId: pack.id,
        packVersion: rev.version,
        manifestSha256: rev.manifestSha256,
        purposeIds: eligiblePurposes.map(pm => pm.purposeId),
        pinnedAuthorityRefs,
        authorizedScope: text(input.authorizedScope, 2000, false),
        ...(rev.dataCutoffAt ? { dataCutoffAt: rev.dataCutoffAt } : {}),
        pinnedAt: now(),
      };
      pack.taskPins.push(pin);
      return pin;
    });
  }

  getTaskPin(packId: string, projectId: string, taskId: string): EnterprisePackTaskPin | undefined {
    const pack = this.get(packId);
    return pack.taskPins.find(p => p.projectId === projectId && p.taskId === taskId);
  }

  recordUse(packId: string, input: {
    projectId: string;
    taskId: string;
    sessionId?: string;
    turnIndex?: number;
    messageId?: string;
    reportRef: StudioSourceRef;
    packVersion: string;
    purposeId: string;
    purposeKey: string;
    tier: PackPurposeTier;
    accessLevel: 'definition' | 'summary' | 'recalculate';
    policyEffectiveFrom?: string;
    dataCutoffAt?: string;
    catalogSupplied: EnterprisePackUseRecord['catalogSupplied'];
    actualReads: EnterprisePackReadEvidence[];
    authorDeclaration?: EnterprisePackUseRecord['authorDeclaration'];
  }): EnterprisePackUseRecord {
    return this.mutate(packId, pack => {
      const record: EnterprisePackUseRecord = {
        id: randomUUID(),
        projectId: identity(input.projectId),
        taskId: identity(input.taskId),
        ...(input.sessionId ? { sessionId: text(input.sessionId, 200, false) } : {}),
        ...(input.turnIndex !== undefined ? { turnIndex: input.turnIndex } : {}),
        ...(input.messageId ? { messageId: text(input.messageId, 200, false) } : {}),
        reportRef: sourceRef(input.reportRef),
        packId: pack.id,
        packVersion: text(input.packVersion, 50, false),
        purposeId: text(input.purposeId, 100, false),
        purposeKey: text(input.purposeKey, 200, false),
        tier: input.tier,
        accessLevel: input.accessLevel,
        ...(input.policyEffectiveFrom ? { policyEffectiveFrom: input.policyEffectiveFrom } : {}),
        ...(input.dataCutoffAt ? { dataCutoffAt: input.dataCutoffAt } : {}),
        catalogSupplied: {
          packVersion: text(input.catalogSupplied.packVersion, 50, false),
          purposeIds: [...new Set(input.catalogSupplied.purposeIds)],
          assetRefs: sources(input.catalogSupplied.assetRefs),
          suppliedAt: input.catalogSupplied.suppliedAt,
        },
        actualReads: input.actualReads.map(r => ({ ...r, ref: sourceRef(r.ref) })),
        ...(input.authorDeclaration ? { authorDeclaration: { ...input.authorDeclaration, declaredRefs: sources(input.authorDeclaration.declaredRefs) } } : {}),
        independentVerification: {
          status: 'pending',
          verdictDetail: input.actualReads.length
            ? '已留存原生读取轨迹与报告摘要，尚无独立核验结论；目录供给、读取回执与作者声明均不替代独立核验'
            : '仅见目录供给或缺少实际原文读取证据，保留待验证',
        },
        createdAt: now(),
      };
      pack.useRecords.push(record);
      return record;
    });
  }

  verifyUse(packId: string, useId: string, input: {
    verifierRole: string;
    verifierProjectId?: string;
    verifierTaskId?: string;
    assessmentReportRef?: StudioSourceRef;
    selfAssessmentOnly?: boolean;
    verifierActualReads?: EnterprisePackUseRecord['independentVerification']['verifierActualReads'];
    verifierEvidenceSummary?: EnterprisePackUseRecord['independentVerification']['verifierEvidenceSummary'];
    expectedRef?: StudioSourceRef;
    independentConfirmed: boolean;
    wrongVersionConfirmedByVerifier?: boolean;
    independentFailed?: boolean;
    partialSubsetOnly?: boolean;
    treatedUnreadableStoreAsZero?: boolean;
    includedOptedOutInSms?: boolean;
    deliveredSubset?: string;
    remainingGaps?: string[];
    verdictDetail?: string;
    checkedRefs?: StudioSourceRef[];
  }): EnterprisePackUseRecord {
    return this.mutate(packId, pack => {
      const record = pack.useRecords.find(u => u.id === uuid(useId));
      if (!record) fail('enterprise_pack_use_not_found', 404);
      const rev = pack.packRevisions.find(r => r.version === record.packVersion);
      const pm = rev?.purposeManifests.find(p => p.purposeId === record.purposeId);
      const requiredRefs = pm
        ? pm.dependencies.filter(d => d.requiredFor.includes(pm.tier)).map(d => d.ref)
        : [];
      const evaluated = evaluateUseVerdict({
        expectedRef: input.expectedRef,
        requiredRefs,
        actualReads: record.actualReads,
        declaredRefs: record.authorDeclaration?.declaredRefs,
        hasAuthorDeclaration: Boolean(record.authorDeclaration),
        independentConfirmed: input.independentConfirmed,
        wrongVersionConfirmedByVerifier: input.wrongVersionConfirmedByVerifier,
        independentFailed: input.independentFailed,
        partialSubsetOnly: input.partialSubsetOnly,
        treatedUnreadableStoreAsZero: input.treatedUnreadableStoreAsZero,
        includedOptedOutInSms: input.includedOptedOutInSms,
      });
      record.independentVerification = {
        status: evaluated.verdict,
        verdictDetail: input.verdictDetail ? text(input.verdictDetail, 5000, false) : evaluated.reason,
        verifierRole: text(input.verifierRole, 200, false),
        ...(input.verifierProjectId ? { verifierProjectId: identity(input.verifierProjectId) } : {}),
        ...(input.verifierTaskId ? { verifierTaskId: identity(input.verifierTaskId) } : {}),
        ...(input.assessmentReportRef ? { assessmentReportRef: sourceRef(input.assessmentReportRef) } : {}),
        ...(input.selfAssessmentOnly !== undefined ? { selfAssessmentOnly: Boolean(input.selfAssessmentOnly) } : {}),
        ...(input.verifierActualReads ? {
          verifierActualReads: input.verifierActualReads.map(r => ({
            ref: sourceRef(r.ref),
            complete: Boolean(r.complete),
            readAt: text(r.readAt, 100, false),
            ...(typeof r.turnIndex === 'number' ? { turnIndex: r.turnIndex } : {}),
            ...(r.entryId ? { entryId: text(r.entryId, 200, false) } : {}),
            ...(r.sessionId ? { sessionId: text(r.sessionId, 200, false) } : {}),
            ...(r.toolCallId ? { toolCallId: text(r.toolCallId, 200, false) } : {}),
            ...(r.authorizedInput ? { authorizedInput: true } : {}),
            ...(r.fromAssessmentTurn !== undefined ? { fromAssessmentTurn: Boolean(r.fromAssessmentTurn) } : {}),
          })),
        } : {}),
        ...(input.verifierEvidenceSummary ? {
          verifierEvidenceSummary: {
            ...(input.verifierEvidenceSummary.requiredAssetsCount !== undefined ? { requiredAssetsCount: Number(input.verifierEvidenceSummary.requiredAssetsCount) || 0 } : {}),
            readRequiredAssetsCount: Number(input.verifierEvidenceSummary.readRequiredAssetsCount) || 0,
            ...(input.verifierEvidenceSummary.allRequiredReadByVerifier !== undefined ? { allRequiredReadByVerifier: Boolean(input.verifierEvidenceSummary.allRequiredReadByVerifier) } : {}),
            hadDataOrCalcEvidence: Boolean(input.verifierEvidenceSummary.hadDataOrCalcEvidence),
            ...(typeof input.verifierEvidenceSummary.assessmentTurnIndex === 'number' ? { assessmentTurnIndex: input.verifierEvidenceSummary.assessmentTurnIndex } : {}),
            ...(input.verifierEvidenceSummary.assessmentMessageId ? { assessmentMessageId: text(input.verifierEvidenceSummary.assessmentMessageId, 200, false) } : {}),
            ...(input.verifierEvidenceSummary.assessmentSessionId ? { assessmentSessionId: text(input.verifierEvidenceSummary.assessmentSessionId, 200, false) } : {}),
            ...(input.verifierEvidenceSummary.assessmentToolCallId ? { assessmentToolCallId: text(input.verifierEvidenceSummary.assessmentToolCallId, 200, false) } : {}),
            ...(Array.isArray(input.verifierEvidenceSummary.carriedFromTurnIndices)
              ? { carriedFromTurnIndices: input.verifierEvidenceSummary.carriedFromTurnIndices.filter(n => typeof n === 'number' && Number.isFinite(n)) }
              : {}),
            ...(input.verifierEvidenceSummary.targetReportChecked !== undefined ? { targetReportChecked: Boolean(input.verifierEvidenceSummary.targetReportChecked) } : {}),
            ...(typeof input.verifierEvidenceSummary.targetReportReadTurnIndex === 'number' ? { targetReportReadTurnIndex: input.verifierEvidenceSummary.targetReportReadTurnIndex } : {}),
            ...(input.verifierEvidenceSummary.authorizedInputChecked !== undefined ? { authorizedInputChecked: Boolean(input.verifierEvidenceSummary.authorizedInputChecked) } : {}),
            ...(Array.isArray(input.verifierEvidenceSummary.authorizedInputReadTurnIndices)
              ? { authorizedInputReadTurnIndices: input.verifierEvidenceSummary.authorizedInputReadTurnIndices.filter(n => typeof n === 'number' && Number.isFinite(n)) }
              : {}),
            ...(input.verifierEvidenceSummary.assessmentReportBoundToTarget !== undefined ? { assessmentReportBoundToTarget: Boolean(input.verifierEvidenceSummary.assessmentReportBoundToTarget) } : {}),
            ...(input.verifierEvidenceSummary.assessmentDisclaimerRejected !== undefined ? { assessmentDisclaimerRejected: Boolean(input.verifierEvidenceSummary.assessmentDisclaimerRejected) } : {}),
            ...(input.verifierEvidenceSummary.missingReason ? { missingReason: text(input.verifierEvidenceSummary.missingReason, 1000, false) } : {}),
          },
        } : {}),
        ...(input.checkedRefs ? { checkedRefs: sources(input.checkedRefs) } : {}),
        wrongVersionDetected: evaluated.wrongVersionDetected,
        ...(input.expectedRef ? { expectedVersion: input.expectedRef.version } : {}),
        ...(input.deliveredSubset ? { deliveredSubset: text(input.deliveredSubset, 2000, false) } : {}),
        ...(input.remainingGaps ? { remainingGaps: input.remainingGaps.map(g => text(g, 2000, false)) } : {}),
        verifiedAt: now(),
      };
      const purpose = pack.purposes.find(p => p.id === record.purposeId);
      if (purpose) {
        purpose.evidenceReadiness.independentUse = evaluated.verdict;
      }
      return record;
    });
  }

  submitFeedback(packId: string, input: {
    problemKey: string;
    packVersion: string;
    purposeIds: string[];
    title: string;
    category: PackFeedbackCategory;
    targetAssetRef?: StudioSourceRef;
    report: Omit<EnterprisePackFeedbackReport, 'submittedAt'>;
  }): { pack: EnterpriseDomainPack; feedback: EnterprisePackFeedback; created: boolean } {
    return this.mutate(packId, pack => {
      const problemKey = text(input.problemKey, 200, false).trim().toLowerCase();
      const packVersion = text(input.packVersion, 50, false).trim();
      const adoptionBasis = input.report.adoptionBasis ?? (input.report.usedAssetRefs.length > 0 && input.report.usedPackVersion ? 'verified_actual_read' : 'clue_only_no_pack_read');
      const reportEntry: EnterprisePackFeedbackReport = {
        projectId: identity(input.report.projectId),
        taskId: identity(input.report.taskId),
        sessionId: text(input.report.sessionId, 200, false),
        messageId: text(input.report.messageId, 200, false),
        reportRef: sourceRef(input.report.reportRef),
        ...(input.report.replyRef ? { replyRef: sourceRef(input.report.replyRef) } : {}),
        ...(input.report.linkedUseRecordId ? { linkedUseRecordId: identity(input.report.linkedUseRecordId) } : {}),
        ...(input.report.independentVerificationStatus ? { independentVerificationStatus: input.report.independentVerificationStatus } : {}),
        ...(input.report.assessmentReportRef ? { assessmentReportRef: sourceRef(input.report.assessmentReportRef) } : {}),
        ...(input.report.originalCaseRef ? {
          originalCaseRef: {
            caseId: uuid(input.report.originalCaseRef.caseId),
            ...(input.report.originalCaseRef.caseTitle ? { caseTitle: text(input.report.originalCaseRef.caseTitle, 300, false) } : {}),
            ...(input.report.originalCaseRef.summary ? { summary: text(input.report.originalCaseRef.summary, 300, false) } : {}),
            ...(typeof input.report.originalCaseRef.caseRevision === 'number' ? { caseRevision: input.report.originalCaseRef.caseRevision } : {}),
            ...(input.report.originalCaseRef.decisionId ? { decisionId: text(input.report.originalCaseRef.decisionId, 200, false) } : {}),
            ...(typeof input.report.originalCaseRef.decisionRevision === 'number' ? { decisionRevision: input.report.originalCaseRef.decisionRevision } : {}),
            ...(input.report.originalCaseRef.decisionKind ? { decisionKind: text(input.report.originalCaseRef.decisionKind, 100, false) } : {}),
            ...(input.report.originalCaseRef.decisionTitle ? { decisionTitle: text(input.report.originalCaseRef.decisionTitle, 300, false) } : {}),
            ...(input.report.originalCaseRef.choiceId ? { choiceId: text(input.report.originalCaseRef.choiceId, 200, false) } : {}),
            ...(input.report.originalCaseRef.decisionResolutionStatus ? { decisionResolutionStatus: input.report.originalCaseRef.decisionResolutionStatus } : {}),
            ...(input.report.originalCaseRef.resolutionNote ? { resolutionNote: text(input.report.originalCaseRef.resolutionNote, 1000, false) } : {}),
            ...(input.report.originalCaseRef.originTimestamp ? { originTimestamp: text(input.report.originalCaseRef.originTimestamp, 100, false) } : {}),
            ...(input.report.originalCaseRef.originReplySha256 ? { originReplySha256: text(input.report.originalCaseRef.originReplySha256, 64, false) } : {}),
            preservedAt: text(input.report.originalCaseRef.preservedAt ?? now(), 100, false),
          },
        } : {}),
        adoptionBasis,
        ...(input.report.observedDirectoryVersion ? { observedDirectoryVersion: text(input.report.observedDirectoryVersion, 50, false) } : {}),
        ...(adoptionBasis === 'verified_actual_read' && input.report.usedPackVersion ? { usedPackVersion: text(input.report.usedPackVersion, 50, false) } : {}),
        usedAssetRefs: sources(input.report.usedAssetRefs),
        ...(input.report.sourceReads ? { sourceReads: input.report.sourceReads.map(feedbackSourceRead) } : {}),
        ...(input.report.taskCutoffAt ? { taskCutoffAt: text(input.report.taskCutoffAt, 100, false) } : {}),
        ...(input.report.packDataCutoffAt ? { packDataCutoffAt: text(input.report.packDataCutoffAt, 100, false) } : {}),
        ...(input.report.taskCutoffAt ? { dataCutoffAt: text(input.report.taskCutoffAt, 100, false) } : input.report.dataCutoffAt ? { dataCutoffAt: text(input.report.dataCutoffAt, 100, false) } : {}),
        ...(input.report.roleOrAccessLevel ? { roleOrAccessLevel: text(input.report.roleOrAccessLevel, 200, false) } : {}),
        evidenceNote: text(input.report.evidenceNote, 5000, false),
        submittedAt: now(),
      };

      // Deduplicate by (packVersion, problemKey): append new evidence without creating duplicate feedback!
      const existing = pack.feedbackItems.find(f => f.packVersion === packVersion && f.problemKey === problemKey);
      if (existing) {
        const sig = digest([reportEntry.reportRef, reportEntry.evidenceNote]);
        if (!existing.reports.some(r => digest([r.reportRef, r.evidenceNote]) === sig)) {
          existing.reports.push(reportEntry);
        }
        existing.purposeIds = [...new Set([...existing.purposeIds, ...input.purposeIds])];
        if (!existing.targetAssetRef && input.targetAssetRef) existing.targetAssetRef = sourceRef(input.targetAssetRef);
        existing.updatedAt = now();
        return { pack, feedback: existing, created: false };
      }

      const seq = pack.feedbackItems.length + 1;
      const targetAuthority = feedbackTargetAuthority(input.category);
      const stamp = now();
      const feedback: EnterprisePackFeedback = {
        id: randomUUID(),
        feedbackCode: `F-${String(seq).padStart(2, '0')}`,
        problemKey,
        packVersion,
        purposeIds: [...new Set(input.purposeIds)],
        title: text(input.title, 300, false),
        category: input.category,
        targetAuthority,
        ...(input.targetAssetRef ? { targetAssetRef: sourceRef(input.targetAssetRef) } : {}),
        status: targetAuthority === 'task' ? 'retained_in_task' : 'recorded',
        reports: [reportEntry],
        createdAt: stamp,
        updatedAt: stamp,
      };
      pack.feedbackItems.push(feedback);
      return { pack, feedback, created: true };
    });
  }

  handleFeedback(packId: string, feedbackId: string, input: {
    status: EnterprisePackFeedback['status'];
    note: string;
    targetRef?: StudioSourceRef;
    revisedRef?: StudioSourceRef;
    revisedPackVersion?: string;
    studioWorkItemId?: string;
    studioFeedbackId?: string;
    impactedPurposeIds?: string[];
    verifiedByUseId?: string;
    itemVerification?: EnterprisePackFeedbackItemVerification;
  }): { pack: EnterpriseDomainPack; feedback: EnterprisePackFeedback } {
    return this.mutate(packId, pack => {
      const feedback = pack.feedbackItems.find(f => f.id === uuid(feedbackId));
      if (!feedback) fail('enterprise_pack_feedback_not_found', 404);
      const stamp = now();
      const resolvedTargetRef = input.targetRef
        ? sourceRef(input.targetRef)
        : feedback.authorityHandling?.targetRef ?? feedback.targetAssetRef;
      const resolvedRevisedRef = input.revisedRef
        ? sourceRef(input.revisedRef)
        : feedback.authorityHandling?.revisedRef;
      const resolvedRevisedPackVersion = input.revisedPackVersion
        ? text(input.revisedPackVersion, 50, false)
        : feedback.authorityHandling?.revisedPackVersion;

      if (input.status === 'verified') {
        if (!input.verifiedByUseId) fail('feedback_verification_use_required', 409);
        const use = pack.useRecords.find(u => u.id === uuid(input.verifiedByUseId));
        if (!use || use.independentVerification.status !== 'pass') {
          fail('feedback_verification_use_not_passed', 409);
        }
        // Must verify one of the feedback's impacted purposes (NEVER an unrelated purpose!)
        if (feedback.purposeIds.length > 0 && !feedback.purposeIds.includes(use.purposeId)) {
          fail('feedback_verification_purpose_mismatch', 409);
        }
        // Must be verified by a DIFFERENT independent new task (NEVER the original faulty task itself!)
        if (feedback.reports.some(r => r.taskId === use.taskId)) {
          fail('feedback_verification_must_be_independent_task', 409);
        }
        // Must verify against a NEW pack version (NEVER 1.0 -> 1.0!)
        if (use.packVersion === feedback.packVersion) {
          fail('feedback_verification_requires_new_pack_version', 409);
        }
        if (resolvedRevisedPackVersion && use.packVersion !== resolvedRevisedPackVersion) {
          fail('feedback_verification_version_mismatch', 409);
        }
        const targetRev = pack.packRevisions.find(r => r.version === use.packVersion);
        if (!targetRev) fail('feedback_verification_revision_not_found', 409);
        const targetPm = targetRev.purposeManifests.find(p => p.purposeId === use.purposeId);
        if (!targetPm || targetPm.status !== 'eligible') {
          fail('feedback_verification_purpose_not_eligible', 409);
        }
        // Must have a REAL revised authority asset ref that evolved the SAME original asset ID in the impacted purpose!
        if (!resolvedRevisedRef) {
          fail('feedback_verification_requires_authority_revision', 409);
        }
        const fromRev = pack.packRevisions.find(r => r.version === feedback.packVersion);
        const fromPm = fromRev?.purposeManifests.find(p => p.purposeId === use.purposeId);
        const inferredFromRef = fromPm?.dependencies.find(d => d.ref.authority === resolvedRevisedRef.authority && d.ref.id === resolvedRevisedRef.id)?.ref;
        const fromRef = resolvedTargetRef ?? inferredFromRef;
        if (!fromRef) {
          fail('feedback_verification_requires_authority_revision', 409);
        }
        if (resolvedRevisedRef.authority !== fromRef.authority || resolvedRevisedRef.id !== fromRef.id) {
          fail('feedback_verification_asset_identity_mismatch', 409);
        }
        if (
          sameExactSourceRef(fromRef, resolvedRevisedRef)
          || (resolvedRevisedRef.version === fromRef.version && (!fromRef.sha256 || !resolvedRevisedRef.sha256 || fromRef.sha256 === resolvedRevisedRef.sha256))
        ) {
          fail('feedback_verification_requires_authority_revision', 409);
        }
        if (
          !targetPm.dependencies.some(d => sameExactSourceRef(d.ref, resolvedRevisedRef))
          || targetPm.dependencies.some(d => sameExactSourceRef(d.ref, fromRef))
        ) {
          fail('feedback_verification_dependency_not_in_purpose', 409);
        }
        const requiredDeps = targetPm.dependencies.filter(d => d.requiredFor.includes(targetPm.tier));
        const readRevised = use.actualReads.some(r => r.complete && sameExactSourceRef(r.ref, resolvedRevisedRef));
        const readAllRequired = requiredDeps.every(dep => use.actualReads.some(r => r.complete && sameExactSourceRef(r.ref, dep.ref)));
        if (!readRevised || !readAllRequired) {
          fail('feedback_verification_missing_revised_read', 409);
        }

        // R5: Calculation-purpose verification closure MUST include structured item-level evidence
        //     covering shouldChange (pre-cutoff mapping corrections) AND/OR postCutoffNewEvents (legitimate
        //     post-cutoff refunds under a newCutoffChecked) alongside shouldRetain!
        let normalizedItemVerification: EnterprisePackFeedbackItemVerification | undefined;
        const isCalcPurpose = targetPm.tier === 'formal-calculation' || targetPm.tier === 'limited-calculation';
        if (input.itemVerification) {
          const iv = input.itemVerification;
          const originalCutoffChecked = text(iv.originalCutoffChecked, 200, false).trim();
          const newCutoffChecked = iv.newCutoffChecked ? text(iv.newCutoffChecked, 200, false).trim() : undefined;
          const transactionAssociationNote = text(iv.transactionAssociationNote, 5000, false).trim();
          const rawShouldChange = Array.isArray(iv.shouldChange) ? iv.shouldChange : [];
          const rawPostCutoff = Array.isArray(iv.postCutoffNewEvents) ? iv.postCutoffNewEvents : [];
          const rawShouldRetain = Array.isArray(iv.shouldRetain) ? iv.shouldRetain : [];
          if (rawShouldRetain.length === 0 || (rawShouldChange.length === 0 && rawPostCutoff.length === 0)) {
            fail('feedback_verification_missing_item_evidence', 409);
          }
          if (rawPostCutoff.length > 0 && !newCutoffChecked) {
            fail('feedback_verification_missing_new_cutoff', 409);
          }
          const cutoffMs = Date.parse(originalCutoffChecked);
          const newCutoffMs = newCutoffChecked ? Date.parse(newCutoffChecked) : Number.NaN;
          if (newCutoffChecked && Number.isFinite(cutoffMs) && Number.isFinite(newCutoffMs) && newCutoffMs <= cutoffMs) {
            fail('feedback_verification_invalid_new_cutoff', 409);
          }
          const shouldChange = rawShouldChange.map(item => {
            const itemId = text(item.itemId, 200, false).trim();
            const beforeValue = text(item.beforeValue, 1000, false).trim();
            const afterValue = text(item.afterValue, 1000, false).trim();
            if (beforeValue === afterValue) fail('feedback_verification_missing_item_evidence', 409);
            const refundDate = item.refundDate ? text(item.refundDate, 100, false).trim() : undefined;
            if (refundDate && Number.isFinite(cutoffMs) && Number.isFinite(Date.parse(refundDate)) && Date.parse(refundDate) > cutoffMs) {
              // Post-cutoff refunds MUST NOT be placed in shouldChange as original mapping corrections!
              if (!item.classification || item.classification === 'mapping_correction') {
                fail('feedback_verification_post_cutoff_misclassified', 409);
              }
            }
            return {
              itemId,
              beforeValue,
              afterValue,
              ...(item.originalOrderId ? { originalOrderId: text(item.originalOrderId, 200, false).trim() } : {}),
              ...(refundDate ? { refundDate } : {}),
              ...(item.reason ? { reason: text(item.reason, 2000, false).trim() } : {}),
              ...(item.classification ? { classification: item.classification } : {}),
              ...(item.evidenceLocator ? { evidenceLocator: text(item.evidenceLocator, 500, false) } : {}),
              ...(item.basisSourceRef ? { basisSourceRef: sourceRef(item.basisSourceRef) } : {}),
              ...(item.sourceFileLocator ? { sourceFileLocator: text(item.sourceFileLocator, 500, false) } : {}),
              ...(item.sourceFileSha256 ? { sourceFileSha256: text(item.sourceFileSha256, 128, false) } : {}),
              ...(typeof item.sourceRowNumber === 'number' ? { sourceRowNumber: item.sourceRowNumber } : {}),
              ...(item.sourceOrderDate ? { sourceOrderDate: text(item.sourceOrderDate, 100, false) } : {}),
              ...(item.sourceFullRefund !== undefined ? { sourceFullRefund: Boolean(item.sourceFullRefund) } : {}),
              ...feedbackRowCustody(item),
            };
          });
          const postCutoffNewEvents = rawPostCutoff.map(item => {
            const itemId = text(item.itemId, 200, false).trim();
            const originalOrderId = text(item.originalOrderId, 200, false).trim();
            const refundDate = text(item.refundDate, 100, false).trim();
            const beforeValue = text(item.beforeValue, 1000, false).trim();
            const afterValue = text(item.afterValue, 1000, false).trim();
            if (beforeValue === afterValue) fail('feedback_verification_missing_item_evidence', 409);
            if (item.classification !== 'post_cutoff_new_event' && item.classification !== 'post_cutoff_update') {
              fail('feedback_verification_invalid_post_cutoff_classification', 409);
            }
            const refundMs = Date.parse(refundDate);
            if (!Number.isFinite(refundMs)) fail('feedback_verification_invalid_refund_date', 409);
            if (item.classification === 'post_cutoff_new_event' && Number.isFinite(cutoffMs) && refundMs <= cutoffMs) {
              // Pre-cutoff refund MUST NOT be hidden as a post-cutoff new event!
              fail('feedback_verification_pre_cutoff_misclassified', 409);
            }
            if (Number.isFinite(newCutoffMs) && refundMs > newCutoffMs) {
              fail('feedback_verification_post_cutoff_out_of_range', 409);
            }
            return {
              itemId,
              originalOrderId,
              refundDate,
              beforeValue,
              afterValue,
              classification: item.classification,
              ...(item.reason ? { reason: text(item.reason, 2000, false).trim() } : {}),
              ...(item.evidenceLocator ? { evidenceLocator: text(item.evidenceLocator, 500, false) } : {}),
              ...(item.basisSourceRef ? { basisSourceRef: sourceRef(item.basisSourceRef) } : {}),
              ...(item.sourceFileLocator ? { sourceFileLocator: text(item.sourceFileLocator, 500, false) } : {}),
              ...(item.sourceFileSha256 ? { sourceFileSha256: text(item.sourceFileSha256, 128, false) } : {}),
              ...(typeof item.sourceRowNumber === 'number' ? { sourceRowNumber: item.sourceRowNumber } : {}),
              ...(item.sourceOrderDate ? { sourceOrderDate: text(item.sourceOrderDate, 100, false) } : {}),
              ...(item.sourceFullRefund !== undefined ? { sourceFullRefund: Boolean(item.sourceFullRefund) } : {}),
              ...feedbackRowCustody(item),
            };
          });
          const shouldRetain = rawShouldRetain.map(item => ({
            itemId: text(item.itemId, 200, false).trim(),
            unchangedValue: text(item.unchangedValue, 1000, false).trim(),
            ...(item.originalOrderId ? { originalOrderId: text(item.originalOrderId, 200, false).trim() } : {}),
            ...(item.refundDate ? { refundDate: text(item.refundDate, 100, false).trim() } : {}),
            ...(item.reason ? { reason: text(item.reason, 2000, false).trim() } : {}),
            ...(item.classification ? { classification: item.classification } : {}),
            ...(item.evidenceLocator ? { evidenceLocator: text(item.evidenceLocator, 500, false) } : {}),
            ...(item.basisSourceRef ? { basisSourceRef: sourceRef(item.basisSourceRef) } : {}),
            ...(item.sourceFileLocator ? { sourceFileLocator: text(item.sourceFileLocator, 500, false) } : {}),
            ...(item.sourceFileSha256 ? { sourceFileSha256: text(item.sourceFileSha256, 128, false) } : {}),
            ...(typeof item.sourceRowNumber === 'number' ? { sourceRowNumber: item.sourceRowNumber } : {}),
            ...(item.sourceOrderDate ? { sourceOrderDate: text(item.sourceOrderDate, 100, false) } : {}),
            ...(item.sourceFullRefund !== undefined ? { sourceFullRefund: Boolean(item.sourceFullRefund) } : {}),
            ...feedbackRowCustody(item),
          }));
          if (isCalcPurpose && [...shouldChange, ...postCutoffNewEvents, ...shouldRetain].some(item =>
            !item.sourceFileLocator || !/^[a-f0-9]{64}$/.test(item.sourceFileSha256 ?? '')
            || !Number.isSafeInteger(item.sourceRowNumber) || item.sourceRowNumber! < 1
            || !item.originalSourceRead || !item.revisedSourceRead
            || !Number.isSafeInteger(item.originalSourceRowNumber) || item.originalSourceRowNumber! < 1
            || !Number.isSafeInteger(item.revisedSourceRowNumber) || item.revisedSourceRowNumber! < 1
            || !item.originalSourceVisibleOn || !item.revisedSourceVisibleOn,
          )) fail('feedback_verification_source_transaction_mismatch', 409);
          normalizedItemVerification = {
            originalCutoffChecked,
            ...(newCutoffChecked ? { newCutoffChecked } : {}),
            transactionAssociationNote,
            shouldChange,
            ...(postCutoffNewEvents.length ? { postCutoffNewEvents } : {}),
            shouldRetain,
            ...(iv.caseDecisionsPreserved !== undefined ? { caseDecisionsPreserved: Boolean(iv.caseDecisionsPreserved) } : {}),
            ...(iv.originalCaseRef ? {
              originalCaseRef: {
                caseId: uuid(iv.originalCaseRef.caseId),
                ...(iv.originalCaseRef.caseTitle ? { caseTitle: text(iv.originalCaseRef.caseTitle, 300, false) } : {}),
                ...(iv.originalCaseRef.summary ? { summary: text(iv.originalCaseRef.summary, 300, false) } : {}),
                ...(typeof iv.originalCaseRef.caseRevision === 'number' ? { caseRevision: iv.originalCaseRef.caseRevision } : {}),
                ...(iv.originalCaseRef.decisionId ? { decisionId: text(iv.originalCaseRef.decisionId, 200, false) } : {}),
                ...(typeof iv.originalCaseRef.decisionRevision === 'number' ? { decisionRevision: iv.originalCaseRef.decisionRevision } : {}),
                ...(iv.originalCaseRef.decisionKind ? { decisionKind: text(iv.originalCaseRef.decisionKind, 100, false) } : {}),
                ...(iv.originalCaseRef.decisionTitle ? { decisionTitle: text(iv.originalCaseRef.decisionTitle, 300, false) } : {}),
                ...(iv.originalCaseRef.choiceId ? { choiceId: text(iv.originalCaseRef.choiceId, 200, false) } : {}),
                ...(iv.originalCaseRef.decisionResolutionStatus ? { decisionResolutionStatus: iv.originalCaseRef.decisionResolutionStatus } : {}),
                ...(iv.originalCaseRef.resolutionNote ? { resolutionNote: text(iv.originalCaseRef.resolutionNote, 1000, false) } : {}),
                ...(iv.originalCaseRef.originTimestamp ? { originTimestamp: text(iv.originalCaseRef.originTimestamp, 100, false) } : {}),
                ...(iv.originalCaseRef.originReplySha256 ? { originReplySha256: text(iv.originalCaseRef.originReplySha256, 64, false) } : {}),
                preservedAt: text(iv.originalCaseRef.preservedAt ?? stamp, 100, false),
              },
            } : {}),
            ...(iv.assessmentReportRef ? { assessmentReportRef: sourceRef(iv.assessmentReportRef) } : {}),
          };
        } else if (isCalcPurpose) {
          fail('feedback_verification_missing_item_evidence', 409);
        }

        const existingUpdates = feedback.revisionLink?.authorityUpdates ?? [];
        const hasSameUpdate = existingUpdates.some(u => sameExactSourceRef(u.toRef, resolvedRevisedRef));
        feedback.revisionLink = {
          fromPackVersion: feedback.packVersion,
          toPackVersion: use.packVersion,
          authorityUpdates: hasSameUpdate
            ? existingUpdates
            : [...existingUpdates, { authority: feedback.targetAuthority, fromRef, toRef: resolvedRevisedRef, detail: text(input.note, 2000, false) }],
          verifiedByUseIds: [...new Set([...(feedback.revisionLink?.verifiedByUseIds ?? []), use.id])],
          ...(normalizedItemVerification ? { itemVerification: normalizedItemVerification } : {}),
        };
      }
      if (input.impactedPurposeIds?.length) {
        feedback.purposeIds = [...new Set([...feedback.purposeIds, ...input.impactedPurposeIds])];
        // Mark ONLY impacted purposes as needing draft re-check without touching unaffected purposes
        if (input.status === 'revision_prepared' || input.status === 'investigating') {
          for (const pid of input.impactedPurposeIds) {
            const p = pack.purposes.find(item => item.id === pid);
            if (p && p.workItemStatus === 'published') p.workItemStatus = 'ready_for_preview';
          }
        }
      }
      feedback.status = input.status;
      feedback.authorityHandling = {
        authority: feedback.targetAuthority,
        ...(resolvedTargetRef ? { targetRef: resolvedTargetRef } : {}),
        ...(resolvedRevisedRef ? { revisedRef: resolvedRevisedRef } : {}),
        ...(resolvedRevisedPackVersion ? { revisedPackVersion: resolvedRevisedPackVersion } : {}),
        ...(input.studioWorkItemId ? { studioWorkItemId: text(input.studioWorkItemId, 200, false) } : feedback.authorityHandling?.studioWorkItemId ? { studioWorkItemId: feedback.authorityHandling.studioWorkItemId } : {}),
        ...(input.studioFeedbackId ? { studioFeedbackId: text(input.studioFeedbackId, 200, false) } : feedback.authorityHandling?.studioFeedbackId ? { studioFeedbackId: feedback.authorityHandling.studioFeedbackId } : {}),
        note: text(input.note, 5000, false),
        updatedAt: stamp,
      };
      feedback.updatedAt = stamp;
      return { pack, feedback };
    });
  }

  recordUpgradeImpact(packId: string, input: {
    changedAuthorityRef: StudioSourceRef;
    replacementRef: StudioSourceRef;
    fromPackVersion: string;
    toPackVersion: string;
    fromFeedbackId?: string;
    note?: string;
  }): EnterprisePackUpgradeImpact {
    return this.mutate(packId, pack => {
      const computed = computeUpgradeImpact(pack, {
        changedAuthorityRef: sourceRef(input.changedAuthorityRef),
        replacementRef: sourceRef(input.replacementRef),
        fromPackVersion: text(input.fromPackVersion, 50, false),
        toPackVersion: text(input.toPackVersion, 50, false),
      });
      const stamp = now();
      const record: EnterprisePackUpgradeImpact = {
        id: randomUUID(),
        ...computed,
        createdAt: stamp,
      };
      pack.upgradeImpacts.push(record);

      // Annotate historical use records without mutating original report content!
      for (const use of pack.useRecords) {
        if (use.packVersion !== input.fromPackVersion) continue;
        const affected = computed.verifiedImpactedUseIds.includes(use.id) || computed.pendingImpactedUseIds.includes(use.id);
        use.impactNotes ??= [];
        use.impactNotes.push({
          fromFeedbackId: input.fromFeedbackId ?? record.id,
          newPackVersion: input.toPackVersion,
          note: input.note ?? (affected ? `该报告受 ${input.fromPackVersion} → ${input.toPackVersion} 上游修订影响，原报告与原依据保留只读` : `上游修订未改变本报告所用口径/定义，原结论继续成立`),
          affected,
          addedAt: stamp,
        });
      }
      return record;
    });
  }

  restrictRevision(packId: string, version: string, reason: string): EnterprisePackRevision {
    return this.mutate(packId, pack => {
      const rev = pack.packRevisions.find(r => r.version === version);
      if (!rev) fail('enterprise_pack_revision_not_found', 404);
      rev.status = 'restricted';
      rev.restrictionNote = text(reason, 2000, false);
      for (const pm of rev.purposeManifests) {
        pm.status = 'restricted';
        pm.suspensionReason = rev.restrictionNote;
      }
      return rev;
    });
  }
}

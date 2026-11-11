import { createHash } from 'node:crypto';
import { canonicalYaml, upstreamFingerprint, type RequirementInstance } from '../contract/validate.ts';
import type { FrameworkMaterialTarget, FrameworkProposalRecord, FrameworkProposalView, FrameworkSourceReference } from '../contract/framework-review.ts';
import { RequirementStoreFault, type createRequirementStore } from '../storage/store.ts';

type Store = ReturnType<typeof createRequirementStore>;
type SourceChanges = readonly { id: string; status: 'changed' | 'unavailable' }[];
export type RevalidateFrameworkSources = (references: readonly FrameworkSourceReference[], approvedTargets: readonly FrameworkMaterialTarget[]) => Promise<SourceChanges>;

export const frameworkDraftFingerprint = (instance: RequirementInstance) =>
  'sha256:' + createHash('sha256').update(canonicalYaml([upstreamFingerprint(instance), instance.framework ?? null])).digest('hex');

export function createFrameworkReview(store: Store, revalidate?: RevalidateFrameworkSources) {
  const sourceChanges = (record: FrameworkProposalRecord, approvedTargets: readonly FrameworkMaterialTarget[]) => record.sources.length
    ? revalidate?.(record.sources, approvedTargets) ?? Promise.resolve(record.sources.map(source => ({ id: source.id, status: 'unavailable' as const })))
    : Promise.resolve([]);
  const hasOutsideProject = (record: FrameworkProposalRecord, projectId?: string) => Boolean(projectId && record.sources.some(({ target }) => 'projectId' in target && target.projectId !== projectId));

  async function inspect(instance: RequirementInstance, record: FrameworkProposalRecord) {
    const id = instance.instance.id, state = store.readFrameworkState(id);
    const changed = await sourceChanges(record, state?.input.materialTargets ?? []);
    const changedIds = new Set(changed.map(source => source.id));
    const changes: string[] = [];
    if (frameworkDraftFingerprint(instance) !== record.draftFingerprint) changes.push('需求工作稿已修改');
    if (state?.input.revision !== record.inputRevision) changes.push('已选 RAP 来源已变更');
    let rapAvailable = true;
    if (record.selectedRap) {
      try { rapAvailable = (await assertReleaseReadable(id, record.selectedRap.version)).entry.packageFingerprint === record.selectedRap.fingerprint; }
      catch (error) { if (!(error instanceof RequirementStoreFault)) throw error; rapAvailable = false; }
      if (!rapAvailable) changes.push('原 RAP 版本不可读取');
    }
    if (changed.length) changes.push('引用来源已变更或不再可用');
    const confirmation = state?.confirmations.find(item => item.version === record.version);
    const restricted = !rapAvailable || changed.length > 0;
    const view: FrameworkProposalView = {
      version: record.version,
      status: changes.length ? 'stale' : confirmation ? 'confirmed' : 'pending',
      ...(changes.length ? { changes } : {}),
      ...(!restricted ? { framework: record.framework, assessment: record.assessment } : {}),
      ...(record.selectedRap ? { selectedRap: { title: record.selectedRap.title, version: record.selectedRap.version, extent: record.selectedRap.extent, ...(!rapAvailable ? { readable: false as const } : {}) } } : {}),
      sources: record.sources.filter(source => !changedIds.has(source.id)).map(source => ({
        id: source.id, kind: source.kind, title: source.title, version: source.version, locator: source.target, extent: source.extent,
      })),
      publicSearch: record.publicSearch,
      repairAttempts: record.repairAttempts,
      ...(confirmation ? { confirmedAt: confirmation.confirmedAt, confirmedBy: confirmation.confirmedBy } : {}),
    };
    return view;
  }

  async function confirmed(instance: RequirementInstance, version?: string, projectId?: string): Promise<FrameworkProposalRecord | undefined> {
    const id = instance.instance.id;
    const confirmation = store.readFrameworkState(id)?.confirmations.at(-1);
    if (!confirmation && !version) return undefined;
    if (!confirmation || (version && confirmation.version !== version)) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
    const record = store.readFrameworkProposal(id, confirmation.version);
    if (hasOutsideProject(record, projectId) || (await inspect(instance, record)).status !== 'confirmed') throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
    if (record.selectedRap && projectId) await assertReleaseReadable(id, record.selectedRap.version, projectId);
    return record;
  }

  async function assertReleaseReadable(id: string, version: string, projectId?: string) {
    const { entry, rap } = store.readRelease(id, version);
    if (!entry.frameworkVersion) return { entry, rap };
    const checked = new Set<string>();
    const approvedTargets = store.readFrameworkState(id)?.input.materialTargets ?? [];
    let source = entry;
    while (source.frameworkVersion) {
      if (checked.has(source.version)) throw new RequirementStoreFault('REQ_STORE_CORRUPT');
      checked.add(source.version);
      const record = store.readFrameworkProposal(id, source.frameworkVersion);
      if (hasOutsideProject(record, projectId) || (await sourceChanges(record, approvedTargets)).length) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
      if (!record.selectedRap) break;
      source = store.readRelease(id, record.selectedRap.version).entry;
      if (source.packageFingerprint !== record.selectedRap.fingerprint) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
    }
    return { entry, rap };
  }

  async function assertFrameworkHistoryReadable(id: string, version: string, projectId: string) {
    const state = store.readFrameworkState(id);
    if (!state?.confirmations.some(item => item.version === version)) throw new RequirementStoreFault('REQ_PROPOSAL_NOT_FOUND');
    const record = store.readFrameworkProposal(id, version);
    if (hasOutsideProject(record, projectId) || (await sourceChanges(record, state.input.materialTargets ?? [])).length) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
    if (record.selectedRap) {
      const { entry } = await assertReleaseReadable(id, record.selectedRap.version, projectId);
      if (entry.packageFingerprint !== record.selectedRap.fingerprint) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
    }
  }
  return { inspect, confirmed, assertReleaseReadable, assertFrameworkHistoryReadable };
}

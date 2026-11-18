import type { EnterpriseScopeStore, EnterpriseRecord } from './enterprise-scope-store.ts';
import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { StudioStore } from '../../extensions/business-plugins/studio/store.ts';
import type { StudioAuthority, StudioSourceRef, StudioSystem } from '../../extensions/business-plugins/studio/contracts.ts';
import path from 'node:path';
import { createProjectEnablement } from '../../extensions/business-plugins/metric-factory/project/enablement.ts';
import { createMetricLibrary } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import { createSapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import { parseCoverageContent } from '../../extensions/business-plugins/studio/coverage.ts';

const sharedAuthorities = new Set<StudioAuthority>(['enterprise', 'sap-metric', 'sap-method', 'studio-source']);
const sameRef = (left: StudioSourceRef, right: StudioSourceRef) => left.authority === right.authority && left.id === right.id && left.version === right.version
  && (left.sha256 === undefined || right.sha256 === undefined || left.sha256 === right.sha256)
  && (left.projectId === undefined || right.projectId === undefined || left.projectId === right.projectId)
  && (left.locator === undefined || right.locator === undefined || left.locator === right.locator);
const legacyAvailableFor = (system: StudioSystem, projectId: string) => !system.enterpriseId && (system.projectId === projectId || system.maintenanceOwner?.projectId === projectId || system.usageProjectIds.includes(projectId)
  || system.adoptions.some(item => item.projectId === projectId && item.status === 'succeeded') || system.uses.some(item => item.projectId === projectId));

export interface StudioEnterpriseCatalogItem {
  id: string; authority: StudioAuthority | 'studio-system'; version: string; title: string;
  status: 'formal-current' | 'formal-history' | 'candidate' | 'disabled' | 'restricted' | 'suspected' | 'unassigned' | 'conflict' | 'unknown';
  eligible: boolean; ref?: StudioSourceRef; enterpriseId?: string;
}
export interface StudioEnterpriseCatalog {
  enterprise: EnterpriseRecord; systems: StudioSystem[]; items: StudioEnterpriseCatalogItem[]; unassigned: StudioEnterpriseCatalogItem[];
}
export function createStudioEnterpriseCatalog(options: { dataRoot: string; scopes: EnterpriseScopeStore; studio: StudioStore; enterpriseMaterials: EnterpriseMaterialsStore; qualifySource?: (ref: StudioSourceRef, projectId: string) => Promise<void> }) {
  const metrics = createMetricLibrary(path.join(options.dataRoot, 'metric-assets')), methods = createSapMethodStore(path.join(options.dataRoot, 'metric-assets'));
  const sourceSystems = (ref: StudioSourceRef, systems: StudioSystem[]) => systems.filter(system => (ref.locator === undefined || ref.locator === system.id)
    && (ref.projectId === undefined || ref.projectId === system.projectId || ref.projectId === system.maintenanceOwner?.projectId || system.maintenanceHistory?.some(owner => owner.projectId === ref.projectId))
    && system.assets.some(asset => asset.id === ref.id));
  const published = (system: StudioSystem, ref: StudioSourceRef) => {
    const asset = system.assets.find(asset => asset.id === ref.id), revision = asset?.revisions.find(revision => String(revision.revision) === ref.version);
    return !!revision && (ref.sha256 === undefined || ref.sha256 === revision.sha256) && system.publications.some(publication => publication.preview.confirmedAt
      && publication.preview.items.some(item => item.assetId === ref.id && item.revision === revision.revision && item.sha256 === revision.sha256));
  };
  const ownership = (ref: StudioSourceRef, systems = options.studio.list()): { enterpriseId?: string; conflict: boolean } => {
    const native = options.scopes.assetEnterpriseId(ref.authority, ref.id);
    if (native) return { enterpriseId: native, conflict: false };
    if (ref.authority === 'studio-source') {
      const matches = sourceSystems(ref, systems);
      return { ...(matches.length === 1 && matches[0]!.enterpriseId ? { enterpriseId: matches[0]!.enterpriseId } : {}), conflict: matches.length > 1 };
    }
    const owners = new Set<string>();
    for (const system of systems.filter(system => system.enterpriseId)) {
      const fromSource = system.assets.some(asset => {
        const revision = asset.revisions.find(revision => revision.revision === asset.formalRevision);
        if (!revision || asset.issue?.affectedRevision === revision.revision || !published(system, { authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256 })) return false;
        return [...revision.sources, ...revision.dependencies].some(saved => sameRef(saved, ref));
      });
      const fromPublication = ['sap-metric', 'sap-method'].includes(ref.authority) && system.publications.some(publication => publication.preview.confirmedAt
        && publication.preview.refs.some(saved => sameRef(saved, ref)) && publication.results.some(result => result.module === ref.authority && result.status === 'succeeded' && result.refs.some(saved => sameRef(saved, ref))));
      if (fromSource || fromPublication) owners.add(system.enterpriseId!);
    }
    return { ...(owners.size === 1 ? { enterpriseId: [...owners][0]! } : {}), conflict: owners.size > 1 };
  };
  const sourceEnterpriseId = (ref: StudioSourceRef): string | undefined => ownership(ref).enterpriseId;
  async function metadataCatalog(enterpriseId: string): Promise<StudioEnterpriseCatalog> {
      const enterprise = options.scopes.get(enterpriseId), allSystems = options.studio.list(), systems = allSystems.filter(system => system.enterpriseId === enterpriseId);
      const items: StudioEnterpriseCatalogItem[] = [], unassigned: StudioEnterpriseCatalogItem[] = [];
      const add = (item: StudioEnterpriseCatalogItem) => { if (item.enterpriseId === enterpriseId) items.push(item); else if (!item.enterpriseId) unassigned.push({ ...item, eligible: false }); };
      const displayOwnership = (ref: StudioSourceRef) => {
        const qualified = ownership(ref, allSystems);
        if (qualified.enterpriseId || qualified.conflict) return qualified;
        // A construction association locates candidates for management. It does
        // not give ordinary analysis a formal source entitlement.
        const owners = new Set(allSystems.filter(system => system.enterpriseId && system.assetRefs.some(saved => sameRef(saved, ref))).map(system => system.enterpriseId!));
        return { ...(owners.size === 1 ? { enterpriseId: [...owners][0]! } : {}), conflict: owners.size > 1 };
      };
      for (const system of allSystems) {
        if (!system.enterpriseId) { add({ id: system.id, authority: 'studio-system', version: String(system.revision), title: system.name, status: 'unassigned', eligible: false }); continue; }
        if (system.enterpriseId !== enterpriseId) continue;
        for (const asset of system.assets) for (const revision of asset.revisions) {
          const ref: StudioSourceRef = { authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256, projectId: system.projectId, locator: system.id };
          const isPublished = published(system, ref), issue = (asset.issueHistory ?? []).some(issue => issue.affectedRevision === revision.revision) || asset.issue?.affectedRevision === revision.revision;
          const status = issue ? 'restricted' : isPublished ? asset.formalRevision === revision.revision ? 'formal-current' : 'formal-history' : 'candidate';
          add({ id: asset.id, authority: 'studio-source', version: ref.version, title: revision.title, status, eligible: status === 'formal-current', enterpriseId, ref });
        }
      }
      try {
        const metadata = await options.enterpriseMaterials.referenceIndex({ readOnly: true });
        for (const material of metadata.materials) {
          const owner = options.scopes.assetEnterpriseId('enterprise', material.materialId), assignedFields = owner ? { enterpriseId: owner } : {};
          add({ id: material.materialId, authority: 'enterprise', version: 'draft', title: material.title, status: 'candidate', eligible: false, ...assignedFields });
          for (const revision of material.revisions) {
            const ref: StudioSourceRef = { authority: 'enterprise', id: material.materialId, version: revision.revisionId, sha256: revision.bodySha256, locator: metadata.storeId };
            const qualified = ownership(ref, allSystems);
            const status = qualified.conflict ? 'conflict' : material.activeRevisionId === undefined ? 'unknown' : !material.enabled ? 'disabled' : revision.revisionId === material.activeRevisionId ? 'formal-current' : 'formal-history';
            add({ id: material.materialId, authority: 'enterprise', version: revision.revisionId, title: revision.title, status, eligible: status === 'formal-current', ...(qualified.enterpriseId ? { enterpriseId: qualified.enterpriseId } : {}),
              ...(status === 'unknown' ? {} : { ref }) });
          }
        }
      } catch (error) { if ((error as { code?: string }).code !== 'enterprise_source_missing') throw error; }
      const entries = metrics.list(), latest = new Map<string, string>();
      const versionOrder = (left: string, right: string) => { const a = left.split('.').map(Number), b = right.split('.').map(Number); return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!; };
      for (const entry of entries) if (!latest.has(entry.id) || versionOrder(entry.version, latest.get(entry.id)!) > 0) latest.set(entry.id, entry.version);
      for (const entry of entries) {
        const ref: StudioSourceRef = { authority: 'sap-metric', id: entry.id, version: entry.version, sha256: entry.bytesSha256 }, owner = displayOwnership(ref), qualified = ownership(ref, allSystems);
        const status = owner.conflict ? 'conflict' : latest.get(entry.id) === entry.version ? 'formal-current' : 'formal-history';
        add({ id: entry.id, authority: ref.authority, version: entry.version, title: entry.id, status, eligible: status === 'formal-current' && qualified.enterpriseId === enterpriseId && !qualified.conflict, ref, ...(owner.enterpriseId ? { enterpriseId: owner.enterpriseId } : {}) });
      }
      const methodEntries = methods.list(), publishedMethods = methods.listPublished();
      for (const entry of methodEntries) {
        if (entry.publishedVersion !== null) {
          const ref: StudioSourceRef = { authority: 'sap-method', id: entry.id, version: String(entry.publishedVersion) }, owner = displayOwnership(ref), qualified = ownership(ref, allSystems);
          const status = owner.conflict ? 'conflict' : entry.issue?.status === 'confirmed' ? 'restricted' : entry.issue?.status === 'suspected' ? 'suspected' : 'formal-current';
          // list() names the newest work draft. Only the published projection
          // can supply the published title without borrowing that draft body.
          const title = publishedMethods.find(item => item.id === entry.id && item.publishedVersion === entry.publishedVersion)?.title ?? entry.id;
          add({ id: entry.id, authority: ref.authority, version: ref.version, title, status, eligible: (status === 'formal-current' || status === 'suspected') && qualified.enterpriseId === enterpriseId && !qualified.conflict, ref, ...(owner.enterpriseId ? { enterpriseId: owner.enterpriseId } : {}) });
        }
        if (entry.hasUnpublishedChanges) {
          const ref: StudioSourceRef = { authority: 'sap-method', id: entry.id, version: String(entry.latestVersion) }, owner = displayOwnership(ref);
          add({ id: entry.id, authority: ref.authority, version: ref.version, title: entry.title, status: owner.conflict ? 'conflict' : 'candidate', eligible: false, ref, ...(owner.enterpriseId ? { enterpriseId: owner.enterpriseId } : {}) });
        }
      }
      // Pending registered metric files have no native publication entry yet.
      // They remain management candidates, never eligible ordinary-task supply.
      for (const system of allSystems) for (const ref of system.assetRefs.filter(ref => ref.authority === 'sap-metric')) {
        if (entries.some(entry => entry.id === ref.id && entry.version === ref.version)) continue;
        if ([...items, ...unassigned].some(item => item.authority === ref.authority && item.id === ref.id && item.version === ref.version)) continue;
        const owner = displayOwnership(ref);
        add({ id: ref.id, authority: ref.authority, version: ref.version, title: ref.title ?? ref.id, status: owner.conflict ? 'conflict' : 'candidate', eligible: false, ref, ...(owner.enterpriseId ? { enterpriseId: owner.enterpriseId } : {}) });
      }
      return { enterprise, systems, items, unassigned };
  }
  return {
    async catalog(enterpriseId: string, consumingProjectId?: string): Promise<StudioEnterpriseCatalog> {
      const result = await metadataCatalog(enterpriseId);
      for (const item of result.items) if (item.eligible && item.authority === 'studio-source' && item.ref) {
        const system = result.systems.find(system => system.id === item.ref!.locator), asset = system?.assets.find(asset => asset.id === item.id), revision = asset?.revisions.find(revision => String(revision.revision) === item.version);
        if (revision && parseCoverageContent(revision.body).kind !== 'legacy') {
          try {
            if (!options.qualifySource || !system) throw new Error('Coverage source qualification is unavailable');
            await options.qualifySource(item.ref, consumingProjectId ?? system.projectId);
          } catch { item.eligible = false; item.status = 'restricted'; }
        }
      }
      return result;
    },
    /** Restricts coverage applicability only; it never grants a source read. */
    async coverageSourceCurrent(projectId: string, ref: StudioSourceRef, context: { construction?: boolean; systemId?: string } = {}): Promise<boolean> {
      if (!sharedAuthorities.has(ref.authority)) return true;
      const enterpriseId = options.scopes.enterpriseIdForProject(projectId);
      if (!enterpriseId) return false;
      const metadata = await metadataCatalog(enterpriseId);
      if (metadata.items.some(item => item.eligible && item.ref && sameRef(item.ref, ref))) return true;
      if (context.construction && context.systemId) {
        const system = metadata.systems.find(system => system.id === context.systemId);
        const owner = system?.maintenanceOwner ?? system;
        if (system && owner?.projectId === projectId) {
          if (ref.authority === 'studio-source') return (ref.locator === undefined || ref.locator === system.id) && system.assets.some(asset => asset.id === ref.id && String(asset.candidateRevision) === ref.version && asset.revisions.some(revision => String(revision.revision) === ref.version && (ref.sha256 === undefined || ref.sha256 === revision.sha256)));
          if (['sap-metric', 'sap-method'].includes(ref.authority)) return metadata.items.some(item => item.status === 'candidate' && item.ref && sameRef(item.ref, ref)) && system.assetRefs.some(saved => sameRef(saved, ref));
        }
      }
      return false;
    },
    async sourceAllowed(projectId: string, ref: StudioSourceRef): Promise<boolean> {
      if (!options.scopes.list().enterprises.length) return true;
      const enterpriseId = options.scopes.enterpriseIdForProject(projectId);
      if (!sharedAuthorities.has(ref.authority)) {
        // This is only the shared-enterprise scope gate. Original owner, retained
        // evidence, Case binding and RAP release readers still enforce their contracts.
        const caseOwner = ref.authority === 'case' ? options.scopes.enterpriseIdForCase(ref.id) : undefined;
        return !caseOwner || caseOwner === enterpriseId;
      }
      const systems = options.studio.list(), owner = ownership(ref, systems);
      if (owner.conflict) return false;
      if (ref.authority === 'studio-source' && !sourceSystems(ref, systems).some(system => published(system, ref))) return false;
      if (owner.enterpriseId) return owner.enterpriseId === enterpriseId;
      if (enterpriseId) return false;
      if (systems.some(system => {
        if (!legacyAvailableFor(system, projectId)) return false;
        if (ref.authority === 'studio-source') return sourceSystems(ref, [system]).length === 1 && published(system, ref);
        const formalDependencies = system.assets.flatMap(asset => {
          const revision = asset.revisions.find(revision => revision.revision === asset.formalRevision);
          return revision && asset.issue?.affectedRevision !== revision.revision && published(system, { authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256 }) ? [...revision.sources, ...revision.dependencies] : [];
        });
        const confirmedRefs = system.publications.flatMap(publication => publication.preview.confirmedAt ? publication.preview.refs.filter(saved => publication.results.some(result => result.status === 'succeeded' && result.module === saved.authority && result.refs.some(actual => sameRef(actual, saved)))) : []);
        return [...system.materials.map(item => item.ref), ...system.assetRefs, ...formalDependencies, ...confirmedRefs].some(saved => sameRef(saved, ref));
      })) return true;
      return ref.authority === 'sap-metric' && createProjectEnablement(path.join(options.dataRoot, 'projects', projectId)).enabled(ref.id)?.version === ref.version;
    },
    sourceEnterpriseId,
  };
}

import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProjectStore, FileNode } from './project-store.ts';
import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { StudioStore } from '../../extensions/business-plugins/studio/store.ts';
import { studioExecutionOwner } from '../../extensions/business-plugins/studio/contracts.ts';
import type { StudioMaterial, StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import { createMetricLibrary } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import { createSapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import { preparePublication as prepareSapPublication } from '../../extensions/business-plugins/metric-factory/sap/validate.ts';
import { createProjectEnablement } from '../../extensions/business-plugins/metric-factory/project/enablement.ts';
import { createRequirementStore, RequirementStoreFault } from '../../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import { fail, sourceRef, digest } from '../../extensions/business-plugins/studio/validation.ts';
import { parseCoverageContent } from '../../extensions/business-plugins/studio/coverage.ts';
import { qualifyCoverageBody } from './studio-coverage.ts';
export interface StudioSourceRead { assetKind?: import('../../extensions/business-plugins/studio/contracts.ts').StudioAssetKind; text: string; complete: boolean; governance?: unknown; ref: StudioSourceRef }
export interface StudioSourceDependencies {
  dataRoot: string; projects: ProjectStore; enterpriseMaterials: EnterpriseMaterialsStore; studio: StudioStore;
  enterpriseScope?: {
    active?(): boolean;
    enterpriseIdForProject(projectId: string): string | undefined;
    sourceAllowed(projectId: string, ref: StudioSourceRef): boolean | Promise<boolean>;
    constructionSourceAllowed?(projectId: string, ref: StudioSourceRef): boolean | Promise<boolean>;
    coverageSourceCurrent?(projectId: string, ref: StudioSourceRef, context: { construction?: boolean; systemId?: string }): boolean | Promise<boolean>;
  };
  readTaskReply?: (projectId: string, taskId: string, selection: { sessionId: string; messageId: string }) => Promise<{ text: string }>;
  readOriginal?: (ref: StudioSourceRef, projectId: string, taskId?: string) => Promise<StudioSourceRead>;
  readRequirementRelease?: (id: string, version: string, projectId: string) => Promise<ReturnType<ReturnType<typeof createRequirementStore>['readRelease']>>;
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const flatFiles = (nodes: FileNode[]): FileNode[] => nodes.flatMap(node => node.kind === 'file' ? [node] : flatFiles(node.children ?? []));
const exactHash = (ref: StudioSourceRef, actual: string) => { if (ref.sha256 !== undefined && ref.sha256 !== actual) fail('studio_source_changed', 409); };
const utf8 = (bytes: Buffer) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('studio_source_requires_native_tool', 415); } };

/** Exact reads delegate to existing source authorities and never open or migrate a Pi session. */
export function createStudioSources(deps: StudioSourceDependencies) {
  const metricLibrary = createMetricLibrary(path.join(deps.dataRoot, 'metric-assets'));
  const methodLibrary = createSapMethodStore(path.join(deps.dataRoot, 'metric-assets'));
  const requirements = createRequirementStore(path.join(deps.dataRoot, 'requirement-instances'));
  async function coverageCurrent(ref: StudioSourceRef, projectId: string, systemId?: string, construction = false) {
    if (deps.enterpriseScope?.coverageSourceCurrent && !await deps.enterpriseScope.coverageSourceCurrent(projectId, ref, { construction, systemId })) fail('studio_coverage_basis_changed', 409);
  }
  async function enterpriseQualified(ref: StudioSourceRef, projectId: string, construction = false, systemId?: string): Promise<boolean> {
    if (!deps.enterpriseScope || deps.enterpriseScope.active?.() === false || !['enterprise', 'sap-metric', 'sap-method', 'studio-source'].includes(ref.authority)) return false;
    const enterpriseId = deps.enterpriseScope.enterpriseIdForProject(projectId);
    if (construction && systemId) {
      const system = deps.studio.get(systemId), owner = studioExecutionOwner(system);
      const ownCandidate = ref.authority === 'studio-source' ? ref.locator === systemId && system.assets.some(asset => asset.id === ref.id && asset.revisions.some(revision => String(revision.revision) === ref.version && revision.sha256 === ref.sha256))
        : ['sap-metric','sap-method'].includes(ref.authority) && system.assetRefs.some(saved => digest(sourceRef(saved)) === digest(ref));
      // Explicit construction references grant candidate inspection only within
      // that current execution scope; ordinary formal qualification is unchanged.
      if (owner.projectId === projectId && system.enterpriseId === enterpriseId && ownCandidate) {
        if (deps.enterpriseScope.constructionSourceAllowed && !await deps.enterpriseScope.constructionSourceAllowed(projectId, ref)) fail('studio_source_scope_forbidden', 403);
        return false;
      }
    }
    if (!await deps.enterpriseScope.sourceAllowed(projectId, ref)) fail(enterpriseId ? 'studio_source_scope_forbidden' : 'studio_source_scope_unassigned', 403);
    // An explicitly retained legacy association keeps its original project
    // enablement/owner checks. Only a real enterprise grant replaces enablement.
    return Boolean(enterpriseId);
  }
  async function readRap(ref: StudioSourceRef, projectId: string) {
    try {
      if (deps.readRequirementRelease) return await deps.readRequirementRelease(ref.id, ref.version, projectId);
      const released = requirements.readRelease(ref.id, ref.version);
      if (released.entry.frameworkVersion) fail('studio_source_unavailable', 409);
      return released;
    } catch (error) {
      if (error instanceof RequirementStoreFault && error.code === 'REQ_PROPOSAL_SOURCE_CHANGED') fail('studio_source_unavailable', 409);
      throw error;
    }
  }
  function readMethod(ref: StudioSourceRef, construction: boolean, systemId?: string, historical = false) {
    if (!/^[1-9]\d*$/.test(ref.version)) fail('studio_source_version_invalid');
    try {
      const published = methodLibrary.getPublished(ref.id, Number(ref.version));
      if (published.issue?.status === 'confirmed' && !construction && !historical) fail('studio_source_restricted', 409);
      exactHash(ref, published.version.contentSha256); return { version: published.version, issue: published.issue };
    } catch (error) {
      if (!construction || (error as { code?: string }).code !== 'METHOD_NOT_PUBLISHED') throw error;
      if (!systemId || !deps.studio.get(systemId).assetRefs.some(r => r.authority === 'sap-method' && r.id === ref.id && r.version === ref.version)) fail('studio_source_not_associated', 403);
      const detail = methodLibrary.read(ref.id, Number(ref.version)); const version = detail.versions.find(v => v.version === Number(ref.version));
      if (!version) fail('studio_source_unavailable', 404); exactHash(ref, version.contentSha256); return { version, issue: detail.governance.filter(g => g.version === version.version).at(-1) ?? null };
    }
  }
  async function readEnterprise(ref: StudioSourceRef): Promise<StudioSourceRead> {
      const index = await deps.enterpriseMaterials.referenceIndex({ readOnly: true });
      if (ref.locator !== undefined && ref.locator !== index.storeId) fail('studio_source_changed', 409);
      const material = index.materials.find(m => m.materialId === ref.id && m.enabled);
      const revision = material?.revisions.find(r => r.revisionId === ref.version);
      if (!revision) fail('studio_source_unavailable', 409);
      exactHash(ref, revision.bodySha256);
      const actual = await deps.enterpriseMaterials.readRevision(ref.id, ref.version, { readOnly: true });
      if (actual.bodySha256 !== revision.bodySha256 || sha(actual.body) !== revision.bodySha256) fail('studio_source_changed', 409);
      const current = (await deps.enterpriseMaterials.referenceIndex({ readOnly: true })).materials.find(m => m.materialId === ref.id);
      if (!current?.enabled || !current.revisions.some(r => r.revisionId === ref.version && r.bodySha256 === actual.bodySha256)) fail('studio_source_unavailable', 409);
      return { text: actual.body, complete: true, ref: { ...ref, sha256: actual.bodySha256 } };
  }
  async function readMetric(ref: StudioSourceRef, projectId: string, systemId: string | undefined, construction: boolean): Promise<StudioSourceRead> {
    if (construction && ref.locator?.startsWith('020_clean/')) {
      if (!systemId || ref.projectId !== projectId || !/^020_clean\/.+\.ya?ml$/.test(ref.locator) || !deps.studio.get(systemId).assetRefs.some(saved => digest(sourceRef(saved)) === digest(ref))) fail('studio_source_not_associated', 403);
      const observed = await deps.projects.observeFile(projectId, ref.locator), file = await deps.projects.readFile(projectId, ref.locator), after = await deps.projects.observeFile(projectId, ref.locator);
      if (sha(file.bytes) !== observed.sha256 || after.sha256 !== observed.sha256) fail('studio_source_changed', 409);
      const candidate = prepareSapPublication(file.bytes);
      if (candidate.document.package.id !== ref.id || candidate.document.package.version !== ref.version) fail('studio_source_changed', 409);
      exactHash(ref, candidate.bytesSha256); return { text: candidate.canonicalYaml, complete: true, ref: { ...ref, sha256: candidate.bytesSha256 } };
    }
    const enterpriseEligible = await enterpriseQualified(ref, projectId);
    if (!construction && !enterpriseEligible && createProjectEnablement(path.join(deps.dataRoot, 'projects', projectId)).enabled(ref.id)?.version !== ref.version) fail('studio_source_not_adopted', 409);
    const metric = metricLibrary.read(ref.id, ref.version); exactHash(ref, metric.entry.bytesSha256); return { text: metric.canonicalYaml, complete: true, ref: { ...ref, sha256: metric.entry.bytesSha256 } };
  }
  async function inventory(projectId: string): Promise<StudioMaterial[]> {
    await deps.projects.get(projectId);
    const materials: StudioMaterial[] = [];
    try {
      const index = await deps.enterpriseMaterials.referenceIndex({ readOnly: true });
      for (const material of index.materials.filter(m => m.enabled)) for (const revision of material.revisions) {
        const ref: StudioSourceRef = { authority: 'enterprise', id: material.materialId, version: revision.revisionId, sha256: revision.bodySha256, locator: index.storeId, title: `${revision.title} · 修订 ${revision.number}` };
        if (deps.enterpriseScope && deps.enterpriseScope.active?.() !== false && !await deps.enterpriseScope.sourceAllowed(projectId, ref)) continue;
        materials.push({ ref, saved: true, readable: true, note: '当前启用来源的准确修订；目录可见不证明Agent实际读过' });
      }
    } catch (error) { if ((error as { code?: string }).code !== 'enterprise_source_missing') throw error; }
    for (const file of flatFiles(await deps.projects.tree(projectId, ['020_clean']))) {
      const observed = await deps.projects.observeFile(projectId, file.path);
      materials.push({ ref: { authority: 'data', id: sha(file.path), version: observed.sha256, sha256: observed.sha256, projectId, locator: file.path, title: file.name }, saved: true, readable: true, note: '当前项目020资料；准确文件身份已观察，未交付正文或证明Agent已读' });
    }
    return materials;
  }
  async function checkDependency(ref: StudioSourceRef, projectId: string, systemId: string, seen: Set<string>, construction = false): Promise<void> {
    await enterpriseQualified(ref, projectId, construction, systemId);
    if (ref.authority === 'case' || ref.authority === 'data' && ref.locator?.startsWith('{')) {
      if (!deps.readOriginal) fail('studio_source_unsupported');
      const system = deps.studio.get(systemId);
      const owners = [{ projectId: system.projectId, taskId: system.taskId }, studioExecutionOwner(system), ...(system.maintenanceHistory ?? []).flatMap(owner => [owner, owner.previousOwner])];
      const sourceOwner = owners.find(owner => owner.projectId === (ref.projectId ?? system.projectId) && (ref.taskId === undefined || owner.taskId === ref.taskId));
      if (!sourceOwner) fail('studio_source_project_mismatch', 403);
      const result = await deps.readOriginal(ref, sourceOwner.projectId, sourceOwner.taskId); if (!result.ref.sha256) fail('studio_source_changed', 409); exactHash(ref, result.ref.sha256); return;
    }
    if (ref.authority === 'enterprise') { await readEnterprise(ref); return; }
    if (ref.authority === 'data') {
      // Check source qualification without exposing the construction project's raw bytes to a using Agent.
      const system = deps.studio.get(systemId);
      const sourceProjects = new Set([system.projectId, studioExecutionOwner(system).projectId, ...(system.maintenanceHistory ?? []).flatMap(owner => [owner.projectId, owner.previousOwner.projectId])]);
      if (!ref.projectId || !sourceProjects.has(ref.projectId) || !ref.locator?.startsWith('020_clean/') || ref.id !== sha(ref.locator)) fail('studio_source_project_mismatch', 403);
      const observation = await deps.projects.observeFile(ref.projectId, ref.locator);
      if (ref.version !== observation.sha256) fail('studio_source_changed', 409); exactHash(ref, observation.sha256); return;
    }
    if (ref.authority === 'sap-metric') { await readMetric(ref, projectId, systemId, construction); return; }
    if (ref.authority === 'sap-method') { readMethod(ref, construction, systemId); return; }
    if (ref.authority === 'rap') { const release = await readRap(ref, projectId); exactHash(ref, release.entry.packageFingerprint.slice(7)); return; }
    if (ref.authority === 'studio-source') { await readStudio(ref, projectId, systemId, construction, seen); return; }
    return fail('studio_source_unsupported', 400);
  }
  async function readStudio(ref: StudioSourceRef, projectId: string, systemId: string | undefined, construction: boolean, seen = new Set<string>(), historical = false): Promise<StudioSourceRead> {
    const sourceSystemId = ref.locator ?? systemId;
    if (!sourceSystemId) fail('studio_source_system_required', 400);
    if (sourceSystemId !== systemId && !await enterpriseQualified(ref, projectId)) fail('studio_source_scope_forbidden', 403);
    // A receiving workspace is not the authority of another system's source.
    // Crossing to its exact locator carries formal qualification only, never
    // the receiver's candidate or historical-inspection grant.
    construction = construction && sourceSystemId === systemId;
    historical = historical && sourceSystemId === systemId;
    const system = deps.studio.get(sourceSystemId);
    if (ref.projectId !== undefined && ref.projectId !== system.projectId) fail('studio_source_project_mismatch', 403);
    if (!/^[1-9]\d*$/.test(ref.version)) fail('studio_source_version_invalid');
    const key = `${sourceSystemId}/${ref.id}/${ref.version}`; if (seen.has(key) || seen.size > 100) fail('studio_source_dependency_cycle', 409); seen.add(key);
    const asset = system.assets.find(a => a.id === ref.id); if (!asset) fail('studio_source_unavailable', 404);
    const revision = construction ? asset.revisions.find(r => r.revision === Number(ref.version)) : deps.studio.getPublishedAsset(sourceSystemId, ref.id, Number(ref.version));
    if (!revision) fail('studio_source_unavailable', 404);
    const issue = asset.issueHistory?.find(i => i.affectedRevision === revision.revision) ?? (asset.issue?.affectedRevision === revision.revision ? asset.issue : undefined);
    if (issue && !construction && !historical) fail('studio_source_restricted', 409);
    exactHash(ref, revision.sha256);
    for (const dependency of [...revision.sources, ...revision.dependencies]) await checkDependency(dependency, projectId, sourceSystemId, new Set(seen), construction);
    const coverage = parseCoverageContent(revision.body);
    if ((coverage.kind === 'invalid' || coverage.kind === 'unsupported') && !construction) fail('studio_coverage_unavailable', 409);
    if (coverage.kind === 'supported') {
      if (asset.kind !== 'business' || coverage.report?.scope.topicId !== asset.topicId) fail('studio_coverage_scope_mismatch', 409);
      await qualifyCoverageBody(revision.body, async ref => {
        await coverageCurrent(ref, projectId, sourceSystemId, construction);
        return ref.authority === 'studio-source' ? readStudio(ref, projectId, sourceSystemId, construction, new Set(seen)) : read(ref, projectId, sourceSystemId, { construction });
      }, system);
    }
    return { text: revision.body, complete: true, assetKind: asset.kind, ...(issue ? { governance: issue } : {}), ref: { ...ref, sha256: revision.sha256 } };
  }
  async function read(raw: StudioSourceRef, projectId: string, systemId?: string, options: { construction?: boolean; historical?: boolean; taskId?: string } = {}): Promise<StudioSourceRead> {
    const ref = sourceRef(raw); await deps.projects.get(projectId);
    await enterpriseQualified(ref, projectId, options.construction === true, systemId);
    let taskProjectId = projectId;
    if (options.construction) {
      if (!systemId) fail('studio_source_construction_mismatch', 403);
      const system = deps.studio.get(systemId), owner = studioExecutionOwner(system);
      if (owner.projectId !== projectId || options.taskId !== undefined && options.taskId !== owner.taskId) fail('studio_source_construction_mismatch', 403);
      await deps.projects.getTask(owner.projectId, owner.taskId);
      // Retained feedback/use evidence grants only exact task reply/report inspection to the qualified current construction owner; no general old-project raw access.
      if (ref.authority === 'task' && ref.projectId && ref.projectId !== projectId) {
        const retained = [...system.feedback.flatMap(feedback => feedback.sources), ...system.uses.flatMap(use => [use.report, ...(use.assessments ?? []).map(assessment => assessment.report)]), ...(system.contributions ?? []).flatMap(item => item.revisions.flatMap(revision => [revision.report, ...revision.sourceRefs]))];
        if (retained.some(saved => digest(sourceRef(saved)) === digest(ref))) taskProjectId = ref.projectId;
      }
    }
    if (ref.authority === 'case' || ref.authority === 'data' && ref.locator?.startsWith('{')) {
      if (!deps.readOriginal) fail('studio_source_unsupported');
      const system = systemId ? deps.studio.get(systemId) : undefined;
      const taskId = options.taskId ?? (system?.projectId === projectId ? system.taskId : ref.taskId);
      const result = await deps.readOriginal(ref, projectId, taskId); if (!result.ref.sha256) fail('studio_source_changed', 409); exactHash(ref, result.ref.sha256); return result;
    }
    if (ref.authority === 'enterprise') return readEnterprise(ref);
    if (ref.authority === 'sap-metric') return readMetric(ref, projectId, systemId, options.construction === true);
    if (ref.authority === 'sap-method') {
      const method = readMethod(ref, options.construction === true, systemId, options.historical === true); return { text: JSON.stringify(method.version, null, 2), complete: true, governance: method.issue, ref: { ...ref, sha256: method.version.contentSha256 } };
    }
    if (ref.authority === 'rap') {
      const release = await readRap(ref, projectId); const digest = release.entry.packageFingerprint.slice(7); exactHash(ref, digest); return { text: JSON.stringify(release.rap, null, 2), complete: true, ref: { ...ref, sha256: digest } };
    }
    if (ref.authority === 'studio-source') return readStudio(ref, projectId, systemId, options.construction === true, new Set(), options.historical === true);
    if (ref.authority === 'task' && !ref.locator?.startsWith('060_reports/')) {
      if (ref.projectId !== taskProjectId) fail('studio_source_project_mismatch', 403);
      if (!ref.taskId || ref.id !== ref.taskId) fail('studio_source_owner_mismatch', 403);
      await deps.projects.getTask(taskProjectId, ref.taskId);
      let selection: unknown; try { selection = JSON.parse(ref.locator ?? ''); } catch { fail('studio_source_native_selection_invalid'); }
      const parsed = selection as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'kind,messageId,sessionId' || parsed.kind !== 'native-reply' || typeof parsed.sessionId !== 'string' || !parsed.sessionId || parsed.sessionId.length > 200 || typeof parsed.messageId !== 'string' || !parsed.messageId || parsed.messageId.length > 200) fail('studio_source_native_selection_invalid');
      if (!deps.readTaskReply) fail('studio_source_native_reader_unavailable', 503);
      const reply = await deps.readTaskReply(taskProjectId, ref.taskId, { sessionId: parsed.sessionId, messageId: parsed.messageId });
      const observed = sha(reply.text); if (ref.version !== observed) fail('studio_source_changed', 409); exactHash(ref, observed);
      return { text: reply.text, complete: true, ref: { ...ref, sha256: observed } };
    }
    if (ref.authority === 'data' || ref.authority === 'task' && ref.locator?.startsWith('060_reports/')) {
      const sourceProjectId = ref.authority === 'task' ? taskProjectId : projectId;
      if (ref.projectId !== sourceProjectId) fail('studio_source_project_mismatch', 403);
      const locator = ref.locator;
      if (!locator || !(ref.authority === 'data' ? /^020_clean\// : /^060_reports\//).test(locator) || locator.split('/').some(p => !p || p === '.' || p === '..' || p.includes('\\'))) fail('studio_source_path_invalid');
      if (ref.authority === 'data' && ref.id !== sha(locator)) fail('studio_source_changed', 409);
      if (ref.authority === 'task') { if (!ref.taskId || ref.id !== ref.taskId) fail('studio_source_owner_mismatch', 403); await deps.projects.getTask(sourceProjectId, ref.taskId); }
      const observed = await deps.projects.observeFile(sourceProjectId, locator);
      if (ref.version !== observed.sha256 || observed.bytes > 50 * 1024 * 1024) fail('studio_source_changed', 409); exactHash(ref, observed.sha256);
      const actual = await deps.projects.readFile(sourceProjectId, locator); const after = await deps.projects.observeFile(sourceProjectId, locator);
      if (sha(actual.bytes) !== observed.sha256 || after.sha256 !== observed.sha256 || actual.bytes.length !== observed.bytes) fail('studio_source_changed', 409);
      return { text: utf8(actual.bytes), complete: true, ref: { ...ref, sha256: observed.sha256 } };
    }
    return fail('studio_source_unsupported', 400);
  }
  return { inventory, read,
    async readCoverage(ref: StudioSourceRef, projectId: string, systemId?: string, options: { construction?: boolean; taskId?: string } = {}) {
      const result = await read(ref, projectId, systemId, options);
      await coverageCurrent(ref, projectId, systemId, options.construction === true); return result;
    },
    async validate(ref: StudioSourceRef, projectId: string, systemId?: string, options: { construction?: boolean; historical?: boolean; taskId?: string } = {}): Promise<void> { await read(ref, projectId, systemId, options); } };
}

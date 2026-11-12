import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { StudioStore, StudioError } from '../../extensions/business-plugins/studio/store.ts';
import type { StudioMaterial, StudioSourceRef, StudioSaveAssetInput, StudioPublicationInput, StudioFeedbackInput, StudioSystem, StudioWorkItemInput, StudioUpdateInput, StudioFeedbackUpdate, StudioContributeInput } from '../../extensions/business-plugins/studio/contracts.ts';
import type { ProjectStore, ProjectRecord, TaskRecord } from './project-store.ts';
import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { ProjectSnapshot } from '../agent/project-runtime.ts';
import type { StudioPort, StudioAction, StudioToolResult } from '../agent/studio.ts';
import { STUDIO_READ_ACTIONS } from '../agent/studio.ts';
import { studioExecutionOwner } from '../../extensions/business-plugins/studio/contracts.ts';
import type { SemanticContextCallContext } from '../agent/semantic-context.ts';
import { studioOperations } from './studio-operations.ts';
import { studioExtractions, studioExtractionId, extractionSummary, extractionResponse, extractionPage, studioTextPage, studioJsonPage } from './studio-extractions.ts';
import { uuid, text, object, sourceRef, sources as parseSources, digest } from '../../extensions/business-plugins/studio/validation.ts';
import { createStudioSources, type StudioSourceDependencies } from './studio-sources.ts';
import { createMetricLibrary, MetricLibraryFault } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import { createProjectEnablement } from '../../extensions/business-plugins/metric-factory/project/enablement.ts';
import { createSapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import { preparePublication as prepareSapPublication, SapFault } from '../../extensions/business-plugins/metric-factory/sap/validate.ts';
import { SapMethodStoreError } from '../../extensions/business-plugins/metric-factory/methods/validate.ts';
import { EnterpriseScopeStore } from './enterprise-scope-store.ts';
import { createStudioEnterpriseCatalog } from './studio-enterprise-catalog.ts';
import { CaseStoreError, type CaseStore } from './case-store.ts';

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value));
}
export type StudioHostOptions = {
  dataRoot: string; projects: ProjectStore; enterpriseMaterials: EnterpriseMaterialsStore;
  cases?: CaseStore;
  readBody(request: IncomingMessage, limit?: number): Promise<Record<string, unknown>>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  running(project: ProjectRecord, task: TaskRecord): boolean;
  closing(): boolean;
  taskSnapshot?(projectId: string, taskId: string): Promise<ProjectSnapshot>;
  readTaskReply(projectId: string, taskId: string, selection: { sessionId: string; messageId: string }): Promise<{ text: string }>;
  readOriginal?: (ref: StudioSourceRef, projectId: string, taskId?: string) => Promise<import('./studio-sources.ts').StudioSourceRead>;
  readRequirementRelease?: StudioSourceDependencies['readRequirementRelease'];
  extract?(system: StudioSystem, ref: StudioSourceRef, context: SemanticContextCallContext): Promise<unknown>;
  refreshGraph?(system: StudioSystem, snapshotId: string, task: TaskRecord): Promise<{ snapshotId: string; sourceRefs: StudioSourceRef[]; detail: string }>;
  inspectGraph?(systemId: string, snapshotId: string): Promise<{ snapshotId: string; sourceRefs: StudioSourceRef[]; detail: string }>;
};
export function createStudioFeature(options: StudioHostOptions) {
  const store = new StudioStore(options.dataRoot), operations = studioOperations(options.dataRoot);
  const enterpriseScopes = new EnterpriseScopeStore(options.dataRoot);
  const enterpriseCatalog = createStudioEnterpriseCatalog({ ...options, scopes: enterpriseScopes, studio: store });
  const enterpriseScope = { active: () => enterpriseScopes.list().enterprises.length > 0, enterpriseIdForProject: (projectId: string) => enterpriseScopes.enterpriseIdForProject(projectId), sourceAllowed: enterpriseCatalog.sourceAllowed,
    constructionSourceAllowed: async (projectId: string, ref: StudioSourceRef) => { await assertNativeEnterprise(ref.authority, ref.id, enterpriseScopes.enterpriseIdForProject(projectId)); return true; } };
  const extractions = studioExtractions(options.dataRoot);
  const sources = createStudioSources({ ...options, studio: store, enterpriseScope });
  const library = createMetricLibrary(path.join(options.dataRoot, 'metric-assets')), methods = createSapMethodStore(path.join(options.dataRoot, 'metric-assets'));
  const workspace = async (id: string) => {
    const system = store.get(id), owner = studioExecutionOwner(system), project = await options.projects.get(owner.projectId), task = await options.projects.getTask(owner.projectId, owner.taskId);
    if (options.taskSnapshot) {
      const snapshot = await options.taskSnapshot(project.id, task.id);
      const readMessages = snapshot.messages.filter(message => message.role === 'toolResult' && message.toolName === 'studio_assets' && message.details?.type === 'optracall.studio' && message.details?.action === 'read-source');
      for (const material of system.materials) {
        const message = [...readMessages].reverse().find(message => message.details?.result?.ref && digest(message.details.result.ref) === digest(material.ref));
        if (message && typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) { material.readAt = new Date(message.timestamp).toISOString(); material.note = message.details.result.complete ? '原Pi native保留实际读取正文回执；不等于业务内容可信' : '原Pi native保留实际读取片段；不冒充完整正文'; }
      }
    }
    return { system, project, task, readOnly: project.archivedAt !== null, running: options.running(project, task) };
  };
  async function active(id: string) { const state = await workspace(id); if (state.readOnly) throw new StudioError('studio_project_read_only', 409); if (options.closing()) throw new StudioError('host_closing', 503); return state; }
  const constructionFor = (projectId: string, taskId: string) => store.list().find(system => { const owner = studioExecutionOwner(system); return owner.projectId === projectId && owner.taskId === taskId; });
  const availableFor = (system: StudioSystem, projectId: string) => system.enterpriseId
    ? system.enterpriseId === enterpriseScopes.enterpriseIdForProject(projectId)
    : system.projectId === projectId || studioExecutionOwner(system).projectId === projectId || system.usageProjectIds.includes(projectId) || system.adoptions.some(item => item.projectId === projectId && item.status === 'succeeded') || system.uses.some(item => item.projectId === projectId);
  function assertProjectEnterprise(projectId: string, enterpriseId: string) {
    const previous = enterpriseScopes.enterpriseIdForProject(projectId);
    if (previous && previous !== enterpriseId) throw new StudioError('enterprise_assignment_conflict', 409);
    if (options.cases?.getStatus().state === 'ready' && options.cases.listProjectLinks().some(link => link.projectId === projectId && enterpriseScopes.enterpriseIdForCase(link.caseId) && enterpriseScopes.enterpriseIdForCase(link.caseId) !== enterpriseId)) throw new StudioError('enterprise_assignment_conflict', 409);
  }
  async function assertNativeEnterprise(authority: string, id: string, enterpriseId?: string) {
    for (const enterprise of enterpriseScopes.list().enterprises) {
      const catalog = await enterpriseCatalog.catalog(enterprise.id);
      if ([...catalog.items, ...catalog.unassigned].some(item => item.authority === authority && item.id === id && (item.status === 'conflict' || item.enterpriseId && item.enterpriseId !== enterpriseId))) throw new StudioError('enterprise_assignment_conflict', 409);
    }
  }
  async function selectedMaterials(value: unknown, projectId: string): Promise<StudioMaterial[]> {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100) throw new StudioError('invalid_studio_materials');
    const inventory = await sources.inventory(projectId);
    return value.map((raw: unknown) => {
      if (!object(raw)) throw new StudioError('invalid_studio_materials'); const ref = sourceRef(raw.ref);
      const exact = inventory.find(item => digest(item.ref) === digest(ref)); if (!exact) throw new StudioError('studio_material_unavailable', 409);
      return exact;
    });
  }
  async function validateSources(refs: StudioSourceRef[], system: StudioSystem, projectId = studioExecutionOwner(system).projectId, construction = true) {
    for (const ref of refs) await sources.validate(ref, projectId, system.id, { construction });
  }
  async function saveAsset(id: string, raw: Record<string, unknown>, agent: boolean, assertCurrent: () => void = () => {}) {
    const { system } = await active(id), input = { ...raw, readyForPublication: agent && raw.readyForPublication === true } as unknown as StudioSaveAssetInput;
    await validateSources(parseSources(input.sources), system);
    await validateSources(parseSources(input.dependencies ?? []), system);
    assertCurrent();
    return store.saveAsset(id, input);
  }
  const operationId = (parts: unknown[]) => { const hash = digest(parts); return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-${(8 + (parseInt(hash[16]!, 16) & 3)).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`; };
  async function metricDraft(system: StudioSystem, ref: StudioSourceRef) {
    const owner = studioExecutionOwner(system);
    if (!ref.locator || !/^020_clean\/.+\.ya?ml$/.test(ref.locator) || ref.projectId !== owner.projectId) throw new StudioError('studio_metric_candidate_unavailable', 409);
    const file = await options.projects.readFile(owner.projectId, ref.locator), publication = prepareSapPublication(new Uint8Array(file.bytes));
    if (publication.document.package.id !== ref.id || publication.document.package.version !== ref.version || publication.bytesSha256 !== ref.sha256) throw new StudioError('studio_publication_changed', 409);
    return publication;
  }
  async function validatePublicationRefs(system: StudioSystem, refs: StudioSourceRef[]) {
    for (const ref of refs) {
      if (enterpriseScope.active() && ['sap-metric','sap-method'].includes(ref.authority)) await assertNativeEnterprise(ref.authority, ref.id, system.enterpriseId ?? enterpriseScopes.enterpriseIdForProject(studioExecutionOwner(system).projectId));
      if (ref.authority === 'sap-metric' && ref.locator?.startsWith('020_clean/')) await metricDraft(system, ref);
      else await sources.validate(ref, studioExecutionOwner(system).projectId, system.id, { construction: true });
    }
  }
  async function publish(system: StudioSystem, previewId: string, fingerprint: string) {
    const preview = system.publications.find(value => value.preview.id === previewId)?.preview;
    if (!preview) throw new StudioError('studio_publication_not_found', 404);
    await validatePublicationRefs(system, preview.refs);
    for (const contribution of preview.contributions ?? []) await qualifyContributionEvidence(system, contribution.sourceProjectId, contribution.sourceTaskId, contribution);
    const publication = store.confirmPublication(system.id, previewId, fingerprint);
    for (const ref of preview.refs.filter(item => ['sap-metric','sap-method'].includes(item.authority))) {
      const module = ref.authority as 'sap-metric' | 'sap-method';
      if (publication.results.some(result => result.module === module && result.refs.some(item => digest(item) === digest(ref)))) continue;
      try {
        if (module === 'sap-metric') {
          if (ref.locator?.startsWith('020_clean/')) library.publish(await metricDraft(system, ref), 'Studio主题正式发布');
          else { const known = library.read(ref.id, ref.version); if (known.entry.bytesSha256 !== ref.sha256) throw new StudioError('studio_publication_changed', 409); }
        } else methods.publish(ref.id, { requestId: operationId(['studio-method-publish', system.id, previewId, ref]), version: Number(ref.version), expectedSha256: ref.sha256! });
        store.recordPublicationResult(system.id, previewId, { module, status: 'succeeded', refs: [ref], detail: '原专业主库已核定准确发布版；不代表项目采用、图刷新或实际使用' });
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'studio_publication_unknown';
        store.recordPublicationResult(system.id, previewId, { module, status: 'unknown', refs: [ref], detail: `${code}；保留原请求与源版，先查原主库，不自动重放` });
      }
    }
    return store.get(system.id).publications.find(value => value.preview.id === previewId)!;
  }
  function reconcilePublication(id: string, previewId: string) {
    const system = store.get(id), publication = system.publications.find(value => value.preview.id === previewId);
    if (!publication) throw new StudioError('studio_publication_not_found', 404);
    if (!publication.preview.confirmedAt) return publication;
    for (const ref of publication.preview.refs.filter(ref => ['sap-metric', 'sap-method'].includes(ref.authority))) {
      const module = ref.authority as 'sap-metric' | 'sap-method';
      if (publication.results.some(result => result.module === module && result.status === 'succeeded' && result.refs.some(value => digest(value) === digest(ref)))) continue;
      try {
        const actual = module === 'sap-metric' ? library.read(ref.id, ref.version).entry.bytesSha256 : methods.getPublished(ref.id, Number(ref.version)).version.contentSha256;
        if (actual === ref.sha256) store.recordPublicationResult(id, previewId, { module, status: 'succeeded', refs: [ref], detail: '只读原专业主库核到准确已发布结果；保留原UNKNOWN，不再次发布' });
      } catch { /* Missing or conflicting original results remain unknown. */ }
    }
    return store.get(id).publications.find(value => value.preview.id === previewId)!;
  }
  function nativeSourceRef(target: unknown, observedHash?: unknown, owner?: { projectId: string; taskId: string }): StudioSourceRef | undefined {
    if (!object(target)) return;
    const hash = typeof observedHash === 'string' ? observedHash : target.publishedHash;
    const hasHash = typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
    if (['studio-source', 'sap', 'sap-method'].includes(String(target.kind)) && !hasHash) return;
    const hashPart = hasHash ? { sha256: hash as string } : {};
    const { sourceHandle: _handle, ...identity } = target;
    if (target.kind === 'studio-source') return sourceRef({ authority: 'studio-source', id: target.assetId, version: target.version, sha256: hash, projectId: target.projectId, locator: target.systemId });
    if (target.kind === 'sap') return sourceRef({ authority: 'sap-metric', id: target.packageId, version: target.version, sha256: hash, ...(typeof target.metricName === 'string' ? { locator: JSON.stringify({ metricName: target.metricName }) } : {}) });
    if (target.kind === 'sap-method') return sourceRef({ authority: 'sap-method', id: target.methodId, version: String(target.version), sha256: hash });
    if (target.kind === 'enterprise') return sourceRef({ authority: 'enterprise', id: target.materialId, version: target.revisionId, ...hashPart, locator: target.storeId });
    if (owner && ['data-input', 'data-description'].includes(String(target.kind))) return sourceRef({ authority: 'data', id: target.datasetId, version: target.kind === 'data-input' ? target.inputVersionId : target.descriptionRevisionId, ...hashPart, projectId: target.projectId, taskId: owner.taskId, locator: JSON.stringify(identity) });
    if (owner && ['case-decision', 'case-choice'].includes(String(target.kind))) return sourceRef({ authority: 'case', id: target.kind === 'case-decision' ? target.recordId : target.choiceId, version: target.kind === 'case-decision' ? String(target.revision) : '1', ...hashPart, projectId: owner.projectId, taskId: owner.taskId, locator: JSON.stringify(identity) });
  }
  async function qualifyContributionEvidence(system: StudioSystem, projectId: string, taskId: string, evidence: { report: StudioSourceRef; sourceRefs?: StudioSourceRef[]; baseRefs: StudioSourceRef[] }) {
    for (const ref of [evidence.report, ...(evidence.sourceRefs ?? []), ...evidence.baseRefs]) await sources.validate(ref, projectId, system.id, { taskId });
    const enterpriseId = enterpriseScopes.enterpriseIdForProject(projectId);
    if (enterpriseId) {
      const current = (await enterpriseCatalog.catalog(enterpriseId)).items.filter(item => item.eligible && item.ref);
      for (const ref of evidence.baseRefs.filter(ref => ['enterprise','sap-metric','sap-method','studio-source'].includes(ref.authority))) if (!current.some(item => item.ref!.authority === ref.authority && item.ref!.id === ref.id && item.ref!.version === ref.version && (!item.ref!.sha256 || !ref.sha256 || item.ref!.sha256 === ref.sha256))) throw new StudioError('studio_contribution_base_conflict', 409);
    }
  }
  async function qualifySelectedContributions(system: StudioSystem, input: Record<string, unknown>) {
    const ids = Array.isArray(input.assetIds) ? input.assetIds : [], refs = parseSources(input.refs ?? []);
    for (const contribution of system.contributions ?? []) {
      const linked = contribution.linked;
      if (linked && (linked.assetId ? ids.includes(linked.assetId) : linked.ref && refs.some(ref => digest(ref) === digest(linked.ref)))) await qualifyContributionEvidence(system, contribution.sourceProjectId, contribution.sourceTaskId, contribution.revisions.at(-1)!);
    }
  }
  async function contributionInput(system: StudioSystem, payload: Record<string, unknown>, projectId: string, taskId: string): Promise<StudioContributeInput> {
    const project = await options.projects.get(projectId); await options.projects.getTask(projectId, taskId);
    if (project.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
    if (!availableFor(system, projectId)) throw new StudioError('studio_owner_mismatch', 403);
    let report: StudioSourceRef, refs = parseSources(payload.sourceRefs ?? []);
    if (payload.origin !== undefined) {
      if (payload.report !== undefined || !object(payload.origin)) throw new StudioError('invalid_studio_contribution_report');
      const origin = payload.origin;
      if (uuid(origin.projectId) !== projectId || uuid(origin.taskId) !== taskId) throw new StudioError('studio_contribution_owner_mismatch', 403);
      const selection = { sessionId: text(origin.sessionId, 200, false), messageId: text(origin.messageId, 200, false) }, original = await options.readTaskReply(projectId, taskId, selection), sha256 = createHash('sha256').update(original.text).digest('hex');
      report = sourceRef({ authority: 'task', id: taskId, projectId, taskId, version: sha256, sha256, locator: JSON.stringify({ kind: 'native-reply', ...selection }) });
      if (options.taskSnapshot) {
        const snapshot = await options.taskSnapshot(projectId, taskId), index = snapshot.messages.findIndex(message => message.role === 'assistant' && message.nativeSessionId === selection.sessionId && message.nativeEntryId === selection.messageId);
        if (index < 0) throw new StudioError('studio_contribution_origin_unavailable', 409);
        const turn: Record<string, any>[] = [];
        for (let at = index - 1; at >= 0 && snapshot.messages[at]?.role !== 'user'; at--) turn.unshift(snapshot.messages[at]!);
        for (const message of turn) {
          if (message.role !== 'toolResult' || message.isError) continue;
          if (message.toolName === 'studio_assets' && message.details?.type === 'optracall.studio' && ['read-source','read'].includes(message.details.action) && message.details.result?.ref) refs.push(sourceRef(message.details.result.ref));
          if (message.details?.type === 'optracall.semantic-context-result' && ['read','trace'].includes(message.details.action)) for (const item of [...(message.details.items ?? []), ...(message.details.unknownTime ?? [])]) if (typeof item.body === 'string') { const ref = nativeSourceRef(item.target, item.sha256, { projectId, taskId }); if (ref) refs.push(ref); }
          if (message.details?.type === 'optracall.semantic-graph-result') for (const target of [...[...(message.details.nodes ?? []), ...(message.details.edges ?? [])].flatMap(item => item.metadata?.sourceRefs ?? []), ...(message.details.sources ?? []).flatMap((source: Record<string, any>) => source.ref ? [source.ref] : [])]) { const ref = nativeSourceRef(target, undefined, { projectId, taskId }); if (ref) refs.push(ref); }
        }
      }
    } else report = sourceRef(payload.report);
    if (report.authority !== 'task' || report.id !== taskId || report.projectId !== projectId || report.taskId !== taskId || !report.sha256) throw new StudioError('studio_contribution_report_mismatch', 403);
    refs = [...new Map(refs.map(ref => [digest(ref), ref])).values()]; const baseRefs = parseSources(payload.baseRefs ?? []);
    await qualifyContributionEvidence(system, projectId, taskId, { report, sourceRefs: refs, baseRefs });
    return { ...payload, sourceProjectId: projectId, sourceTaskId: taskId, report, sourceRefs: refs, baseRefs } as unknown as StudioContributeInput;
  }
  const reply = (action: string, value: unknown): StudioToolResult => {
    const text = JSON.stringify(value); if (text.length > 30_000) throw new StudioError('studio_result_too_large', 413);
    return { content: [{ type: 'text', text }], details: { type: 'optracall.studio', action, result: value } };
  };
  const jsonRead = (value: unknown, selection: Record<string, unknown>) => ({ ...selection, format: 'json-text', expectedJsonSha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'), start: 0, length: 12_000 });
  const boundedReply = (action: string, full: unknown, summary: Record<string, unknown>, systemId: string, continuation: { action: string; payload: Record<string, unknown> }, note = 'Committed result acknowledged; omitted content remains in its original authority. Read needed parts without repeating the write.') => JSON.stringify(full).length < 28_000 ? reply(action, full) : reply(action, { ...summary, transport: { complete: false, note, continuation: { ...continuation, systemId } } });
  const sameSource = (left: StudioSourceRef, right: StudioSourceRef) => left.authority === right.authority && left.id === right.id && left.version === right.version && left.sha256 === right.sha256;
  const analysisTopics = (system: StudioSystem) => system.topics.map(({ id, title, goal, scope }) => ({ id, title, goal, scope }));
  // These are persisted human decisions and original module receipts, not author progress or business scores.
  function publicationFacts(system: StudioSystem, projectId: string, qualified: StudioSourceRef[]) {
    return system.publications.filter(publication => publication.preview.confirmedAt && publication.results.some(result => result.status === 'succeeded' && result.refs.some(ref => qualified.some(current => sameSource(ref, current))))).map(publication => {
      const { id, fingerprint, confirmedAt, topicId, systemRevision, scope, limitations, excluded, items, refs } = publication.preview;
      return { claim: 'confirmed-decision-and-original-module-receipts-not-business-validation-or-use', preview: { id, fingerprint, confirmedAt, topicId, systemRevision, scope, limitations, excluded, items, refs }, results: publication.results,
        currentlyEligibleRefs: qualified.filter(ref => publication.results.some(result => result.status === 'succeeded' && result.refs.some(recorded => sameSource(recorded, ref)))),
        adoptions: system.adoptions.filter(adoption => adoption.projectId === projectId && adoption.refs.some(ref => publication.results.some(result => result.refs.some(recorded => sameSource(recorded, ref))))).map(adoption => ({ ...adoption, claim: 'recorded-studio-action-receipt-not-current-project-adoption-authority', currentlyEligibleRefs: adoption.refs.filter(ref => qualified.some(current => sameSource(ref, current))) })) };
    });
  }
  type PublicationFacts = ReturnType<typeof publicationFacts>[number];
  function publicationIndex(systemId: string, publication: PublicationFacts, force = false) {
    if (!force && JSON.stringify(publication).length < 8_000) return publication;
    return { preview: { id: publication.preview.id, fingerprint: publication.preview.fingerprint, confirmedAt: publication.preview.confirmedAt, topicId: publication.preview.topicId },
      results: publication.results.map(({ module, status, at }) => ({ module, status, at })),
      transport: { complete: false, note: 'Confirmed publication qualifications are not fully included. Read the exact decision for relevant scope, limitations, exclusions and component outcomes; omitted restrictions are not absent restrictions.',
        continuation: { action: 'read', systemId, payload: jsonRead(publication, { section: 'publications', publicationId: publication.preview.id }) } } };
  }
  async function analysisSupply(system: StudioSystem, projectId: string, taskId: string) {
    const refs: StudioSourceRef[] = [], assets = [];
    for (const asset of system.assets) {
      const version = asset.formalRevision; if (!version || asset.issue?.affectedRevision === version) continue;
      const revision = asset.revisions.find(item => item.revision === version)!;
      const ref: StudioSourceRef = { authority: 'studio-source', id: asset.id, version: String(version), sha256: revision.sha256, projectId: system.projectId, locator: system.id, title: revision.title };
      try { await sources.validate(ref, projectId, system.id, { taskId }); } catch { continue; }
      refs.push(ref); assets.push({ kind: asset.kind, title: revision.title, ref, status: 'formal', limitations: revision.limitations });
    }
    for (const publication of system.publications.filter(publication => publication.preview.confirmedAt)) for (const result of publication.results.filter(result => result.status === 'succeeded')) for (const ref of result.refs) {
      if (!['sap-metric', 'sap-method'].includes(ref.authority) || refs.some(current => sameSource(ref, current))) continue;
      try { await sources.validate(ref, projectId, system.id, { taskId }); } catch { continue; }
      refs.push(ref);
    }
    const publications = publicationFacts(system, projectId, refs);
    const adoptions = system.adoptions.filter(adoption => adoption.projectId === projectId).map(adoption => ({ ...adoption, claim: 'recorded-studio-action-receipt-not-current-project-adoption-authority',
      currentlyEligibleRefs: adoption.refs.filter(ref => refs.some(current => sameSource(ref, current))) }));
    return { refs, assets, publications, adoptions };
  }
  const assetIdentity = (system: StudioSystem, asset: StudioSystem['assets'][number], revision = asset.candidateRevision ?? asset.formalRevision) => {
    const exact = asset.revisions.find(value => value.revision === revision); if (!exact) throw new StudioError('studio_asset_not_found', 404);
    const ref: StudioSourceRef = { authority: 'studio-source', id: asset.id, version: String(exact.revision), sha256: exact.sha256, projectId: system.projectId, locator: system.id };
    return { asset: { id: asset.id, kind: asset.kind, topicId: asset.topicId, candidateRevision: asset.candidateRevision, formalRevision: asset.formalRevision, revision: { revision: exact.revision, sha256: exact.sha256 } }, ref, exact };
  };
  const sourceContract = { sourceRef: '{authority,id,version,sha256?,projectId?,taskId?,locator?}', originalRefs: 'Case/M2 use authority case/data, id=recordId|choiceId|datasetId, version=revision|choice1|descriptionRevisionId|inputVersionId, locator=JSON exact original semantic target without sourceHandle; M2 retains ownproject; read-semantic-context finds original identity, no duplicate source Store', saveAsset: '{assetId?,expectedRevision?,kind:business|concept|rule|ontology|binding|hypothesis|strategy,title,body,scope,sources:SourceRef[],dependencies?:SourceRef[],checks:[{name,status:pass|fail|unknown,detail}],limitations?:string[],readyForPublication?:boolean,reason?,extraction?:{method,sourceRefs:SourceRef[],failures:string[],fallbacks:string[],reviewed:boolean}}; save extraction fields only from actual extraction/review evidence: exact source refs, actual methods/failures/fallbacks, and reviewed=true only after Agent verifies the candidate against its sources. This is author evidence, not a Host business score.', workItem: '{id?,kind:task|question|gap|review,title,detail,impact,nextStep,sources:SourceRef[],status:open|waiting|in_progress|resolved}', publication: '{topicId?,assetIds:string[],refs?:SourceRef[],summary,scope,checks?,limitations?,excluded?,targetProjectIds?}; assetIds select Studio source assets; refs select professional outputs for their original publication authorities, such as registered sap-metric or saved sap-method refs. Input materials belong in asset sources/dependencies, not publication.refs; enterprise/data/RAP/Case material refs do not become new published professional outputs by appearing here.', sap0_2: {
    source: 'Technical shape from the unchanged metric-factory/sap/validate.ts SapDocument/SapMetric/SapScenario contract; no business sample. Write project-local SAP0.2 YAML using authorized business materials; historical business files are not needed to learn this format.',
    SapDocument: { sap: 'literal string "0.2"', package: 'SapPackage', dimensions: 'unique non-empty identifier string[]', metrics: 'non-empty SapMetric[]', scenarios: 'SapScenario[] (may be empty)' },
    SapPackage: { id: 'string matching ^[a-z][a-z0-9-]*$', version: 'string matching ^\\d+\\.\\d+\\.\\d+$', namespace: 'literal mf.<package.id>', fingerprint: 'empty string or sha256:<64 lowercase hex>' },
    SapMetric: { name: 'unique identifier string', display_name: 'non-empty string', type: 'metric_type enum', definition: 'non-empty string', dimensions: 'unique identifiers from document.dimensions (may be empty)', time_grains: 'non-empty unique time_grain enum[]', owner_role: 'non-empty string', caliber_switches: 'Record<string,boolean> (may be empty)', 'type_params?': 'SapTypeParams', provenance: 'SapProvenance' },
    SapTypeParams: { 'measure?': 'same-package metric.name', 'numerator?': 'same-package metric.name', 'denominator?': 'same-package metric.name', 'expr?': 'non-empty expression string', 'window?': 'non-empty string', 'grain_to_date?': 'same-package metric.name' },
    SapProvenance: { origin: 'origin enum', 'model?': 'non-empty string', 'prompt_version?': 'non-empty string', 'reviewed_by?': 'non-empty actual review attribution', 'note?': 'string', 'template_ref?': 'non-empty string' },
    SapScenario: { id: 'identifier string, unique together with version', version: 'semver string', title: 'non-empty string', decision_purpose: 'non-empty string', metric_usages: '{metric:same-package metric.name,role:usage_role enum,note?:non-empty string}[]', method_refs: 'non-empty-string[] (array may be empty)', evidence_requirements: 'non-empty string' },
    enums: { metric_type: ['simple','ratio','derived','cumulative'], usage_role: ['outcome','driver','guardrail'], origin: ['template','llm','manual'], time_grain: ['day','week','month','quarter','year'] },
    constraints: 'Identifier is ^[a-z][a-z0-9_]*$. Unknown fields are rejected. Optional type_params, when present for ratio, requires numerator and denominator; measure/numerator/denominator/grain_to_date resolve in the whole package, including forward refs. origin=template requires template_ref; origin=llm requires model and reviewed_by. Retain actual provenance rather than inventing review attribution.',
    registration: 'package.fingerprint may be empty in a draft. The original preparePublication validates, fills it and canonicalizes YAML. register-sap-metric returns the exact canonical candidate ref; reuse that returned ref for publication and source reads, not the raw file SHA. Registration saves/attaches an unpublished candidate and does not itself formally publish or adopt it.',
    semanticReview: 'Agent checks that type_params references/expressions and definition express the same business meaning using authorized materials. The Host structural validator does not score semantics, supply business formulas or impose a fixed specialist workflow.',
  }, graphProjection: {
    body: 'Optional existing structured projection: save-asset body is a JSON string of {entities:[{key,text,label}],relationships:[{source,target,predicate,weak?:boolean}]}. entities is non-empty, with unique local keys and non-empty string key/text/label; relationships may be omitted or empty. source and target are local entity keys and predicate is a non-empty string.',
    meaning: 'A reviewed declared relation is directed source -> target with its exact predicate. Mark weak clues with weak:true; related_to/co_occurs/cooccurs remain weak clues even without that flag. Plain text is a legal statement source with no inferred asserted relation. The existing GraphBuilder projects declared relations and does not guess business direction or semantics. Choose structure only when supported by the actual sources; no all-page or structured-body requirement.',
  }, actions: {
    'catalog': '{payload?:{start?,length?,expectedCatalogSha256?}}; bounded enterprise directory of system summaries and currently eligible native/source exact references. Follow the returned continuation; a changed catalog rejects the old continuation rather than silently mixing pages. Directory visibility is not actual source reading or use.',
    'contribute': '{systemId,payload:{contributionId?,expectedRevision?,scope:enterprise|task,report:exact own task report SourceRef,sourceRefs:SourceRef[],baseRefs?:SourceRef[],baseSystemRevision?,candidate:{kind,title,body,scope,reason?}}}; source project/task are Host-bound. Saves only this task proposal, never a formal asset or publication. Enterprise integration separately validates the current construction owner, exact candidate and current bases. task scope stays task-local. read section:contributions lists only own proposals for ordinary tasks, or the construction workspace list; contributionId selects an exact proposal for bounded JSON-text recovery.',
    'read': '{systemId,payload?:{assetId?,revision?,section?:assets|materials|workItems|feedback|uses|publications|topics|assetRefs|contributions,contributionId?,start?,length?}}; small replies keep original shape. If transport.complete=false follow its continuation. Construction format:json-text reads exact original JSON, optional assetId+revision or section+publicationId/topicId; no section selects whole own system. JSON-text ranges are unicode-codepoints, expectedJsonSha256 pins the value and continuation; no full-read gate. Ordinary analysis keeps formal-source qualification; read section:publications returns only currently relevant confirmed decisions and actual module receipts/project adoption, optional publicationId and format:json-text with pinned continuation. These are publication facts, not professional scores. read-source reads exact source body with explicit ranges',
    'add-topic': '{title,goal,scope}; creates a topic in this system without renaming or copying prior assets; update-topic currentTopicId then continues the same construction task',
    'update-topic': '{expectedRevision?,name?,currentTopicId?,topic?:{title?,goal?,scope?,progress?,status?,coverage?:string[],gaps?:string[]}}; topic fields must be nested in topic; bounded write receipt retains saved system revision and exact topic read continuation',
    'read-source': '{ref,start?:codepoint-offset,length?:1..20000}; complete=false requires continuation; reading is not business adoption',
    'save-sap-method': '{title,content:{conditions,logic,judgment,limits},sources:SourceRef[],methodId?,baseVersion?,relation?}; original SAP method library, unpublished; reply ref has authority:sap-method,id,version,sha256,locator:candidate. read-source {ref,start,length} recovers exact original candidate version, not a published method; Studio read section:assetRefs discovers attached refs',
    'register-sap-metric': '{path:020_clean/*.yaml}; Agent first writes original SAP0.2 YAML in its project; namespace=mf.<package.id>; original structural validator applies; Binding remains data mapping authority',
    'prepare-publication': '{topicId?,assetIds:string[],refs?:SourceRef[],summary:string,scope:string,checks?:[{name,status:pass|fail|unknown,detail}],limitations?:string[],excluded?:string[],targetProjectIds?:string[]}; assetIds select reviewed Studio source versions; refs select the exact professional outputs to publish in their original SAP authorities, using register-sap-metric/save-sap-method returned refs. Input source materials stay in each asset sources/dependencies and are not publication outputs. Empty assetIds is supported when refs selects outputs; at least one selected item/ref is required. Returns the real preview id/fingerprint or its exact read continuation, prepared-not-approved; user confirmation, actual module result, project adoption, graph refresh and use remain separate.',
    'extract': '{ref}; official Semantica candidate, never an asset/publication. Small results retain original fields. Large results return extractionId and transport.complete=false; full exact JSON, actual methods/failures/provenance remain in Host technical receipt. Use read-extraction for needed sections and verify source before saving; do not repeat an already completed extraction merely to recover its output',
    'read-extraction': '{extractionId?,section?:metadata|entities|relations|result,start?:codepoint-offset,length?:1..20000}; construction owner only; current source eligibility rechecked. Exact JSON-text fragments with explicit ranges/continuation, metadata includes original sourceRef/owner and method/failure/fallback/provenance. Without extractionId lists up to 5 own-system receipt summaries (start/length items); read selected original result before considering another extraction. Partial pages are not complete. Choose relevant parts autonomously; no full-read gate',
    'mark-issue': '{assetId,revision,sources,reason}; construction Agent explicit, evidenced confirmed error governance; feedback alone never makes this decision',
    'work-item': '{id?,topicId?,kind:task|question|gap|review,title,detail,impact,nextStep,sources,status}; answer is human-only via the original answer entry. An answered question retains its original topic/meaning/evidence/answer and resolved fact; update nextStep to execute the decision. A new decision needs a new question id',
    'declare-use': '{report:exact task060 SourceRef,sources:exact used SourceRef[],result}; example report:{authority:task,id:<actual current taskId>,projectId:<actual current projectId>,taskId:<same current taskId>,locator:060_reports/<actual filename>,version:<complete file bytes SHA256>,sha256:<same SHA256>}. id is taskId, version is byte hash, never filename/latest/semantic version. Agent obtains actual file path/hash with existing tools. Records author use declaration, NOT assessed',
    'assess-use': '{useId,status:pass|fail|unknown,report:separate exact060 assessment SourceRef,sources:exact use.sources,result}; explicitly assess problem and preserved correct findings, with evidence/limits; no Host score or mandatory specialist workflow',
    'update-feedback': '{feedbackId,status,response,sources?,verification?:{sources,result}}; verified requires matching revised formal source versions, exact new use report+assessment report+used sources; accepted is not repair',
  }, note: 'Checks are author evidence, not Host business truth. Formal publication, adoption, graph refresh and use verification remain separate.' };
  const api = {
    store, sources, workspace, constructionFor, availableFor, enterpriseScopes, enterpriseCatalog, enterpriseScope,
    availableForTask: (projectId: string, taskId: string) => Boolean(enterpriseScopes.enterpriseIdForProject(projectId)) || Boolean(constructionFor(projectId, taskId)) || store.list().some(system => system.usageTasks?.some(task => task.projectId === projectId && task.taskId === taskId)),
    async prepareContext(projectId: string, taskId: string, selection?: unknown, mode: { analysisOnly?: boolean } = {}) {
      const construction = mode.analysisOnly ? undefined : constructionFor(projectId, taskId);
      let system = construction, purpose: 'construction' | 'analysis' = construction ? 'construction' : 'analysis';
      if (selection !== undefined) {
        if (!object(selection) || !['construction','analysis'].includes(String(selection.purpose))) throw new StudioError('invalid_studio_context');
        system = store.get(uuid(selection.systemId)); purpose = selection.purpose as typeof purpose;
        if (purpose === 'construction' && (!construction || construction.id !== system.id) || purpose === 'analysis' && !availableFor(system, projectId)) throw new StudioError('studio_owner_mismatch', 403);
      }
      if (!system) return;
      const supply = purpose === 'analysis' ? await analysisSupply(system, projectId, taskId) : undefined;
      const refs: StudioSourceRef[] = supply?.refs ?? [], assets = supply?.assets ?? [];
      if (purpose === 'construction') for (const asset of system.assets) {
        const version = asset.candidateRevision ?? asset.formalRevision; if (!version) continue;
        const revision = asset.revisions.find(item => item.revision === version)!;
        const ref: StudioSourceRef = { authority: 'studio-source', id: asset.id, version: String(version), sha256: revision.sha256, projectId: system.projectId, locator: system.id, title: revision.title };
        refs.push(ref); assets.push({ kind: asset.kind, title: revision.title, ref, status: asset.formalRevision === version ? 'formal' : 'candidate', limitations: revision.limitations });
      }
      const context = { systemId: system.id, name: system.name, purpose, topics: purpose === 'construction' ? system.topics : analysisTopics(system), assets,
        ...(purpose === 'construction' ? { materials: system.materials, workItems: system.workItems, feedback: system.feedback.filter(item => !['verified','not_confirmed'].includes(item.status)), contract: sourceContract } : { publications: supply!.publications.map(publication => publicationIndex(system.id, publication)), adoptions: supply!.adoptions }) };
      let body = JSON.stringify(context);
      if (purpose === 'analysis' && 'publications' in context && body.length > 24_000) { context.publications = supply!.publications.map(publication => publicationIndex(system.id, publication, true)); body = JSON.stringify(context); }
      if (body.length > 48_000) throw new StudioError('studio_context_too_large', 413);
      return { systemId: system.id, purpose, refs, text: `Studio来源与建设上下文（真实保存记录；不是新的企业事实或专业通过）：\n${body}\n你自主选择取材、工具、协作、核查及修订。沿studio_assets按需读准确来源和正文。候选仅供建设，不能作为普通分析正式规则；反馈记录不等于确错或已后台修复。普通分析不以体系建齐为前提。` };
    },
    port(projectId: string, taskId: string, mode: { analysisOnly?: boolean } = {}): StudioPort {
      return async (action: StudioAction, input, context) => {
        context.assertCurrent(); context.signal.throwIfAborted();
        const project = await options.projects.get(projectId); await options.projects.getTask(projectId, taskId);
        if (project.archivedAt !== null || options.closing()) throw new StudioError('studio_run_unavailable', 409);
        if (mode.analysisOnly && !(STUDIO_READ_ACTIONS as readonly string[]).includes(action)) throw new StudioError('studio_read_only', 403);
        const construction = mode.analysisOnly ? undefined : constructionFor(projectId, taskId), payload = object(input.payload) ? input.payload : {};
        const assertCurrent = async () => { context.assertCurrent(); context.signal.throwIfAborted(); const latest = await options.projects.get(projectId); context.assertCurrent(); context.signal.throwIfAborted(); if (latest.archivedAt !== null || options.closing()) throw new StudioError('studio_run_unavailable', 409); };
        if (action === 'catalog') {
          const enterpriseId = enterpriseScopes.enterpriseIdForProject(projectId);
          const systems = store.list().filter(system => availableFor(system, projectId)).map(system => ({ id: system.id, name: system.name, projectId: system.projectId, taskId: system.taskId, executionOwner: studioExecutionOwner(system), topics: system.topics.map(({ id, title }) => ({ id, title })), construction: construction?.id === system.id }));
          const items = enterpriseId ? (await enterpriseCatalog.catalog(enterpriseId)).items.filter(item => item.eligible && item.ref) : [];
          const directory = [...systems.map(system => ({ kind: 'system' as const, system })), ...items.map(item => ({ kind: 'source' as const, item }))];
          const catalogSha256 = digest(directory);
          if (payload.expectedCatalogSha256 !== undefined && payload.expectedCatalogSha256 !== catalogSha256) throw new StudioError('studio_catalog_changed', 409);
          const start = payload.start === undefined ? 0 : Number(payload.start), length = payload.length === undefined ? 20 : Number(payload.length);
          if (!Number.isSafeInteger(start) || start < 0 || start > directory.length || !Number.isSafeInteger(length) || length < 1 || length > 100) throw new StudioError('invalid_studio_source_range');
          let end = Math.min(directory.length, start + length);
          const page = () => { const selected = directory.slice(start, end); return { ...(enterpriseId ? { enterpriseId } : {}), systems: selected.flatMap(entry => entry.kind === 'system' ? [entry.system] : []), items: selected.flatMap(entry => entry.kind === 'source' ? [entry.item] : []), catalogSha256, range: { start, end, total: directory.length, unit: 'entries' }, complete: end === directory.length, continuation: end < directory.length ? { action: 'catalog', payload: { start: end, length, expectedCatalogSha256: catalogSha256 } } : null, contract: sourceContract }; };
          while (end > start && JSON.stringify(page()).length > 28_000) end--;
          if (end === start && start < directory.length) throw new StudioError('studio_result_too_large', 413);
          await assertCurrent(); return reply(action, page());
        }
        const id = input.systemId === undefined ? construction?.id : uuid(input.systemId);
        if (!id && action === 'read-source') {
          const ref = sourceRef(payload.ref);
          if (!['enterprise','sap-metric','sap-method'].includes(ref.authority) || ref.locator?.startsWith('020_clean/')) throw new StudioError('studio_system_required');
          return options.mutate(async () => { await assertCurrent(); const read = await sources.read(ref, projectId, undefined, { taskId }); context.assertCurrent(); context.signal.throwIfAborted(); if (options.closing()) throw new StudioError('host_closing', 503); const { text: body, ...metadata } = read, page = studioTextPage(body, { ...payload, length: payload.length === undefined ? 16_000 : payload.length }, metadata, {}); return reply(action, { ...page, complete: read.complete && page.complete }); });
        }
        if (!id) throw new StudioError('studio_system_required');
        const system = store.get(id), isConstruction = construction?.id === id;
        if (!availableFor(system, projectId)) throw new StudioError('studio_owner_mismatch', 403);
        if (action === 'read') {
          if (payload.section === 'contributions') {
            const list = (system.contributions ?? []).filter(item => isConstruction || item.sourceProjectId === projectId && item.sourceTaskId === taskId);
            if (payload.contributionId !== undefined) {
              const contributionId = uuid(payload.contributionId), contribution = list.find(item => item.id === contributionId); if (!contribution) throw new StudioError('studio_contribution_not_found', 404);
              const selection = { section: 'contributions', contributionId };
              if (payload.format === 'json-text') return reply(action, studioJsonPage(contribution, payload, { systemId: id, ...selection }, selection));
              return boundedReply(action, contribution, { contribution: { id: contribution.id, revision: contribution.revision } }, id, { action: 'read', payload: jsonRead(contribution, selection) });
            }
            if (payload.format === 'json-text') return reply(action, studioJsonPage(list, payload, { systemId: id, section: 'contributions' }, { section: 'contributions' }));
            const start = payload.start === undefined ? 0 : Number(payload.start), length = payload.length === undefined ? 10 : Number(payload.length);
            if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > 20) throw new StudioError('invalid_studio_source_range');
            return boundedReply(action, { systemId: id, items: list.slice(start, start + length), range: { start, end: Math.min(list.length, start + length), total: list.length } }, { systemId: id, section: 'contributions', count: list.length }, id, { action: 'read', payload: jsonRead(list, { section: 'contributions' }) });
          }
          if (!isConstruction && payload.section === 'publications') return options.mutate(async () => {
            await assertCurrent();
            const current = await analysisSupply(store.get(id), projectId, taskId);
            const selection: Record<string, unknown> = { section: 'publications' };
            let value: PublicationFacts | PublicationFacts[] = current.publications;
            if (payload.publicationId !== undefined) {
              const publicationId = uuid(payload.publicationId), publication = current.publications.find(item => item.preview.id === publicationId);
              if (!publication) throw new StudioError('studio_publication_not_available', 404);
              selection.publicationId = publicationId; value = publication;
            }
            context.assertCurrent(); context.signal.throwIfAborted(); if (options.closing()) throw new StudioError('host_closing', 503);
            if (payload.format === 'json-text') return reply(action, studioJsonPage(value, payload, { systemId: id, ...selection }, selection));
            return boundedReply(action, value, { systemId: id, publicationId: selection.publicationId, claim: 'confirmed-decisions-and-module-receipts-not-business-validation' }, id,
              { action: 'read', payload: jsonRead(value, selection) }, 'Publication qualifications are partial; recover the exact original confirmed decision without repeating any write.');
          });
          if (isConstruction && payload.format === 'json-text') {
            const selection: Record<string, unknown> = {}; let value: unknown = system;
            if (payload.assetId !== undefined) {
              const assetId = uuid(payload.assetId), asset = system.assets.find(item => item.id === assetId); if (!asset) throw new StudioError('studio_asset_not_found', 404); selection.assetId = assetId; value = asset;
              if (payload.revision !== undefined) { const revision = Number(payload.revision); if (!Number.isSafeInteger(revision) || revision < 1) throw new StudioError('invalid_studio_revision'); value = asset.revisions.find(item => item.revision === revision); if (!value) throw new StudioError('studio_asset_not_found', 404); selection.revision = revision; }
            } else if (payload.section !== undefined) {
              const section = String(payload.section); if (!['assets','materials','workItems','feedback','uses','publications','topics','assetRefs'].includes(section)) throw new StudioError('invalid_studio_section');
              selection.section = section; value = system[section as 'assets'];
              if (payload.publicationId !== undefined) { if (section !== 'publications') throw new StudioError('invalid_studio_section'); selection.publicationId = uuid(payload.publicationId); value = system.publications.find(item => item.preview.id === selection.publicationId); if (!value) throw new StudioError('studio_publication_not_found', 404); }
              if (payload.topicId !== undefined) { if (section !== 'topics') throw new StudioError('invalid_studio_section'); selection.topicId = uuid(payload.topicId); value = system.topics.find(item => item.id === selection.topicId); if (!value) throw new StudioError('studio_topic_not_found', 404); }
            }
            return reply(action, studioJsonPage(value, payload, { systemId: id, ...selection }, selection));
          }
          if (payload.assetId) { const asset = system.assets.find(value => value.id === payload.assetId); if (!asset) throw new StudioError('studio_asset_not_found', 404); if (isConstruction) { const identity = assetIdentity(system, asset, payload.revision === undefined ? undefined : Number(payload.revision)); return boundedReply(action, asset, { systemId: id, asset: identity.asset, ref: identity.ref }, id, { action: 'read', payload: jsonRead(identity.exact, { assetId: asset.id, revision: identity.exact.revision }) }); } const revision = store.getPublishedAsset(id, asset.id, payload.revision === undefined ? undefined : Number(payload.revision)); const historical = payload.revision !== undefined; const qualified = await sources.read({ authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256, projectId: system.projectId, locator: id }, projectId, id, { historical }); await assertCurrent(); const value = { ...revision, ref: qualified.ref, publications: publicationFacts(store.get(id), projectId, qualified.governance ? [] : [qualified.ref]).map(publication => publicationIndex(id, publication)), ...(qualified.governance ? { governance: qualified.governance, historical, defaultRecommendation: false } : {}) }; const selection = { assetId: asset.id, revision: revision.revision }; if (payload.format === 'json-text') return reply(action, studioJsonPage(value, payload, { systemId: id, ...selection }, selection)); return boundedReply(action, value, { systemId: id, ref: qualified.ref, publications: value.publications }, id, { action: 'read', payload: jsonRead(value, selection) }, 'Formal source response is partial; recover the exact source and its publication qualifications without repeating any write.'); }
          if (isConstruction) {
            const sections = ['assets','materials','workItems','feedback','uses','publications','topics','assetRefs'] as const;
            if (payload.section !== undefined) {
              if (!sections.includes(payload.section as typeof sections[number])) throw new StudioError('invalid_studio_section');
              const section = payload.section as typeof sections[number], list = system[section], start = payload.start === undefined ? 0 : Number(payload.start), length = payload.length === undefined ? 10 : Number(payload.length);
              if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > 20) throw new StudioError('invalid_studio_source_range');
              return boundedReply(action, { systemId:id, section, items:list.slice(start,start+length), range:{start,end:Math.min(list.length,start+length),total:list.length}, ...(start+length<list.length?{continuation:{start:start+length}}:{}) }, { systemId: id, section, range: { start, end: Math.min(list.length, start + length), total: list.length, unit: 'items' }, omitted: 'items; JSON continuation reads this exact full section' }, id, { action: 'read', payload: jsonRead(list, { section }) });
            }
            return boundedReply(action, { system: { id,projectId:system.projectId,taskId:system.taskId,revision:system.revision,name:system.name,currentTopicId:system.currentTopicId,topics:system.topics,assetRefs:system.assetRefs,assets:system.assets.map(asset=>({id:asset.id,kind:asset.kind,candidateRevision:asset.candidateRevision,formalRevision:asset.formalRevision,issue:asset.issue,revisions:asset.revisions.map(r=>({revision:r.revision,title:r.title,sha256:r.sha256}))})),counts:Object.fromEntries(sections.map(section=>[section,system[section].length])) }, contract:sourceContract }, { system: { id, projectId, taskId, revision: system.revision, currentTopicId: system.currentTopicId, counts: Object.fromEntries(sections.map(section => [section, system[section].length])) } }, id, { action: 'read', payload: jsonRead(system, {}) });
          }
          return reply(action, await api.prepareContext(projectId, taskId, { systemId: id, purpose: 'analysis' }));
        }
        if (action === 'read-source') { const ref = sourceRef(payload.ref); return options.mutate(async () => { await assertCurrent(); const read = await sources.read(ref, projectId, id, { construction: isConstruction, taskId }); context.assertCurrent(); context.signal.throwIfAborted(); if (options.closing()) throw new StudioError('host_closing', 503); const { text: body, ...metadata } = read, qualifications = !isConstruction ? { publications: publicationFacts(store.get(id), projectId, [read.ref]).map(publication => publicationIndex(id, publication)) } : {}, page = studioTextPage(body, { ...payload, length: payload.length === undefined ? 16_000 : payload.length }, { ...metadata, ...qualifications }, {}); return reply(action, { ...page, complete: read.complete && page.complete }); }); }
        if (action === 'contribute') return options.mutate(async () => { await assertCurrent(); const prepared = await contributionInput(store.get(id), payload, projectId, taskId); context.assertCurrent(); context.signal.throwIfAborted(); if (options.closing()) throw new StudioError('host_closing', 503); const contribution = store.contribute(id, prepared); return boundedReply(action, { contribution, claim: 'task-owned-candidate-not-formal-publication-or-use' }, { contribution: { id: contribution.id, revision: contribution.revision, sourceProjectId: projectId, sourceTaskId: taskId } }, id, { action: 'read', payload: jsonRead(contribution, { section: 'contributions', contributionId: contribution.id }) }); });
        if (action === 'feedback') { const refs = parseSources(payload.sources ?? []); await validateSources(refs, system, projectId, isConstruction); return options.mutate(async () => { await assertCurrent(); const feedback = store.addFeedback(id, { ...payload, sources: refs, origin: undefined } as unknown as StudioFeedbackInput); return reply(action, { feedback, claim: 'recorded-not-repaired' }); }); }
        if (action === 'declare-use') {
          const report = sourceRef(payload.report), refs = parseSources(payload.sources ?? []);
          if (report.projectId !== projectId || report.taskId && report.taskId !== taskId || !['data','task'].includes(report.authority)) throw new StudioError('studio_use_report_mismatch', 403);
          await sources.validate(report, projectId, id); await validateSources(refs, system, projectId, false);
          let graphSnapshotId: string | undefined;
          if (options.taskSnapshot) {
            const snapshot = await options.taskSnapshot(projectId, taskId);
            let start = snapshot.messages.length - 1; while (start >= 0 && snapshot.messages[start]?.role !== 'user') start--;
            const actual = [...snapshot.messages.slice(start + 1)].reverse().find(message => message.role === 'toolResult' && !message.isError && message.details?.type === 'optracall.semantic-graph-result' && typeof message.details.snapshot?.id === 'string');
            graphSnapshotId = actual?.details.snapshot.id;
          }
          return options.mutate(async () => { await assertCurrent(); return reply(action, { use: store.recordUse(id, { projectId, taskId, report, sources: refs, result: text(payload.result ?? '', 20_000), verification: 'not_assessed', ...(graphSnapshotId ? { graphSnapshotId } : {}) }), claim: 'author-declaration-not-professional-verification' }); });
        }
        if (action === 'assess-use') {
          const use = system.uses.find(use => use.id === payload.useId && use.projectId === projectId && use.taskId === taskId);
          if (!use) throw new StudioError('studio_use_owner_mismatch', 403);
          const report = sourceRef(payload.report), refs = parseSources(payload.sources);
          if (report.authority !== 'task' || report.projectId !== projectId || report.taskId !== taskId || !report.locator?.startsWith('060_reports/')) throw new StudioError('studio_use_report_mismatch', 403);
          await sources.validate(report, projectId, id); await validateSources(refs, system, projectId, false);
          return options.mutate(async () => { await assertCurrent(); return reply(action, { use: store.recordUseAssessment(id, use.id, { status: payload.status as 'pass' | 'fail' | 'unknown', report, sources: refs, result: text(payload.result, 20_000, false) }), claim: 'agent-explicit-assessment-with-exact-evidence-not-host-or-independent-professional-score' }); });
        }
        if (!isConstruction) throw new StudioError('studio_construction_only', 403);
        const extractionOwner = { systemId: id, projectId, taskId };
        const extractionCurrent = () => { context.assertCurrent(); context.signal.throwIfAborted(); if (options.closing()) throw new StudioError('host_closing', 503); };
        // Final source qualification and synchronous return/commit share the existing Host mutation
        // sequence. Project admission happens first; do not await projects.get after the source check.
        const qualifyExtraction = async (ref: StudioSourceRef) => { await assertCurrent(); await sources.validate(ref, projectId, id, { construction: true, taskId }); extractionCurrent(); };
        if (action === 'read-extraction') {
          if (payload.extractionId !== undefined) {
            const receipt = await extractions.read(extractionOwner, uuid(payload.extractionId));
            if (!receipt) throw new StudioError('studio_extraction_not_found', 404);
            return options.mutate(async () => { await qualifyExtraction(receipt.sourceRef); extractionCurrent(); return reply(action, extractionPage(receipt, payload)); });
          }
          const start = payload.start === undefined ? 0 : Number(payload.start), length = payload.length === undefined ? 5 : Number(payload.length);
          if (!Number.isSafeInteger(start) || Number(start) < 0 || !Number.isSafeInteger(length) || Number(length) < 1 || Number(length) > 5) throw new StudioError('invalid_studio_extraction_range');
          const receipts = await extractions.list(extractionOwner);
          return options.mutate(async () => {
            await assertCurrent(); const qualified: typeof receipts = [];
            for (const receipt of receipts) { try { await sources.validate(receipt.sourceRef, projectId, id, { construction: true, taskId }); qualified.push(receipt); } catch (error) { extractionCurrent(); if (!(error instanceof StudioError) || error.code !== 'studio_source_unavailable') throw error; } }
            extractionCurrent();
            if (Number(start) > qualified.length) throw new StudioError('invalid_studio_extraction_range');
            let end = Math.min(qualified.length, Number(start) + Number(length));
            const page = () => ({ items: qualified.slice(Number(start), end).map(extractionSummary), range: { start, end, total: qualified.length, unit: 'receipts' }, continuation: end < qualified.length ? { start: end, length } : null, claim: 'technical-candidate-receipts-not-business-assets' });
            while (end > Number(start) && JSON.stringify(page()).length >= 28_000) end--;
            return reply(action, page());
          });
        }
        if (action === 'extract') {
          const ref = sourceRef(payload.ref), extractionId = studioExtractionId(extractionOwner, context);
          await qualifyExtraction(ref);
          const previous = await extractions.read(extractionOwner, extractionId);
          if (previous) { if (digest(previous.sourceRef) !== digest(ref)) throw new StudioError('studio_extraction_call_conflict', 409); return options.mutate(async () => { await qualifyExtraction(previous.sourceRef); extractionCurrent(); return reply(action, extractionResponse(previous)); }); }
          if (!options.extract) throw new StudioError('studio_semantica_unavailable', 409);
          context.assertCurrent(); context.signal.throwIfAborted();
          const result = await options.extract(system, ref, context); context.assertCurrent(); context.signal.throwIfAborted();
          const staged = await extractions.stage(extractionOwner, ref, context, result);
          try {
            return await options.mutate(async () => { await qualifyExtraction(ref); const receipt = staged.commit(extractionCurrent); return reply(action, extractionResponse(receipt)); });
          } finally { staged.discard(); }
        }
        return options.mutate(async () => {
          await assertCurrent(); await active(id); context.assertCurrent(); context.signal.throwIfAborted();
          if (action === 'save-sap-method') {
            const refs = parseSources(payload.sources ?? []); await validateSources(refs, system); context.assertCurrent(); context.signal.throwIfAborted();
            if (typeof payload.methodId === 'string' && enterpriseScope.active()) await assertNativeEnterprise('sap-method', payload.methodId, system.enterpriseId ?? enterpriseScopes.enterpriseIdForProject(projectId));
            context.assertCurrent(); context.signal.throwIfAborted();
            const saved = methods.save({ requestId: operationId(['studio-method-save', projectId, taskId, context.requestId, context.sessionId, context.toolCallId]), origin: 'other', title: String(payload.title ?? ''), content: payload.content as { conditions: string; logic: string; judgment: string; limits: string }, sources: refs.map(ref => ({ type: 'manual', label: ref.title || ref.id, ref: JSON.stringify(ref), version: ref.version, sha256: ref.sha256 || null })), ...(typeof payload.methodId === 'string' ? { methodId: payload.methodId, baseVersion: Number(payload.baseVersion) } : {}), ...(payload.relation ? { relation: payload.relation as Parameters<typeof methods.save>[0]['relation'] } : {}) });
            const ref: StudioSourceRef = { authority: 'sap-method', id: saved.method.id, version: String(saved.version.version), sha256: saved.version.contentSha256, title: saved.version.title, locator: 'candidate' };
            store.addAssetRef(id, ref); return boundedReply(action, { ref, version: saved.version, status: 'saved-unpublished' }, { ref, version: { version: saved.version.version, contentSha256: saved.version.contentSha256 }, status: 'saved-unpublished' }, id, { action: 'read-source', payload: { ref, start: 0, length: 12_000 } });
          }
          if (action === 'register-sap-metric') {
            const locator = text(payload.path, 1024, false);
            if (!/^020_clean\/.+\.ya?ml$/.test(locator)) throw new StudioError('studio_metric_candidate_unavailable');
            const file = await options.projects.readFile(projectId, locator), publication = prepareSapPublication(new Uint8Array(file.bytes)); context.assertCurrent(); context.signal.throwIfAborted();
            if (enterpriseScope.active()) await assertNativeEnterprise('sap-metric', publication.document.package.id, system.enterpriseId ?? enterpriseScopes.enterpriseIdForProject(projectId));
            context.assertCurrent(); context.signal.throwIfAborted();
            const ref: StudioSourceRef = { authority: 'sap-metric', id: publication.document.package.id, version: publication.document.package.version, sha256: publication.bytesSha256, projectId, locator, title: publication.document.package.id };
            store.addAssetRef(id, ref); return reply(action, { ref, status: 'project-candidate-not-published', checks: 'original SAP structural validation only; business review remains Agent responsibility' });
          }
          if (action === 'save-asset') { const asset = await saveAsset(id, payload, true, () => { context.assertCurrent(); context.signal.throwIfAborted(); }), identity = assetIdentity(system, asset); return boundedReply(action, { asset, systemId: id }, { asset: identity.asset, ref: identity.ref, systemId: id }, id, { action: 'read', payload: jsonRead(identity.exact, { assetId: asset.id, revision: identity.exact.revision }) }); }
          if (action === 'material-status') { const ref = sourceRef(payload.ref), material = (await workspace(id)).system.materials.find(item => digest(item.ref) === digest(ref)); if (!material) throw new StudioError('studio_material_unavailable', 409); await sources.validate(ref, projectId, id, { construction: true }); context.assertCurrent(); context.signal.throwIfAborted(); return reply(action, { material: store.updateMaterial(id, { ...material, ...(payload.processed === true ? { processedAt: new Date().toISOString() } : {}), note: text(payload.note ?? material.note, 20_000) }), claim: 'agent-processing-declaration; actual reading derives from native tool receipt' }); }
          if (action === 'work-item') { await validateSources(parseSources(payload.sources ?? []), system); context.assertCurrent(); context.signal.throwIfAborted(); return reply(action, { item: store.setWorkItem(id, { ...payload, topicId: payload.topicId ?? system.currentTopicId } as unknown as StudioWorkItemInput) }); }
          if (action === 'add-topic') return reply(action, { topic: store.addTopic(id, { title: text(payload.title, 200, false), goal: text(payload.goal, 20_000, false), scope: text(payload.scope, 20_000) }) });
          if (action === 'update-topic') { const saved = store.update(id, payload as unknown as StudioUpdateInput), topic = saved.topics.find(value => value.id === saved.currentTopicId)!; return boundedReply(action, { system: saved }, { system: { id: saved.id, revision: saved.revision, currentTopicId: saved.currentTopicId }, topic: { id: topic.id } }, id, { action: 'read', payload: jsonRead(topic, { section: 'topics', topicId: topic.id }) }); }
          if (action === 'attach-ref') { const ref = sourceRef(payload.ref); await sources.validate(ref, projectId, id, { construction: true }); context.assertCurrent(); context.signal.throwIfAborted(); return reply(action, { ref: store.addAssetRef(id, ref) }); }
          if (action === 'prepare-publication') { await validatePublicationRefs(system, parseSources(payload.refs ?? [])); await qualifySelectedContributions(system, payload); context.assertCurrent(); context.signal.throwIfAborted(); const preview = store.preparePublication(id, payload as unknown as StudioPublicationInput), publication = store.get(id).publications.find(value => value.preview.id === preview.id)!; return boundedReply(action, { preview, claim: 'prepared-not-approved' }, { preview: { id: preview.id, fingerprint: preview.fingerprint, systemRevision: preview.systemRevision, topicId: preview.topicId, itemCount: preview.items.length, refCount: preview.refs.length }, claim: 'prepared-not-approved' }, id, { action: 'read', payload: jsonRead(publication, { section: 'publications', publicationId: preview.id }) }); }
          if (action === 'mark-issue') { const refs = parseSources(payload.sources); if (!refs.length) throw new StudioError('studio_issue_evidence_required'); await validateSources(refs, system); context.assertCurrent(); context.signal.throwIfAborted(); const asset = system.assets.find(asset => asset.id === payload.assetId); if (!asset || asset.formalRevision !== payload.revision) throw new StudioError('studio_asset_conflict', 409); return reply(action, { asset: store.markAssetIssue(id, asset.id, text(payload.reason, 20_000, false)), evidence: refs, claim: 'construction-agent-explicit-governance-decision-not-automatic-feedback' }); }
          if (action === 'update-feedback') { if (payload.sources !== undefined) { await validateSources(parseSources(payload.sources), system); context.assertCurrent(); context.signal.throwIfAborted(); } if (payload.status === 'verified') { if (!object(payload.verification)) throw new StudioError('studio_use_verification_required', 409); const refs = parseSources(payload.verification.sources); for (const ref of refs) { if (ref.authority === 'task') { const owner = system.uses.find(use => digest(use.report) === digest(ref) || use.assessments?.some(assessment => digest(assessment.report) === digest(ref))); if (!owner) throw new StudioError('studio_use_verification_required', 409); await sources.validate(ref, owner.projectId, id); } else { const use = system.uses.find(use => use.sources.some(source => digest(source) === digest(ref))); await sources.validate(ref, use?.projectId ?? projectId, id, { construction: !use }); } } context.assertCurrent(); context.signal.throwIfAborted(); } return reply(action, { feedback: store.updateFeedback(id, uuid(payload.feedbackId), payload as unknown as StudioFeedbackUpdate) }); }
          throw new StudioError('studio_action_not_available', 409);
        }).catch(error => {
          if (error instanceof SapFault || error instanceof MetricLibraryFault || error instanceof SapMethodStoreError) throw new StudioError(error.code.toLowerCase(), 'status' in error && typeof error.status === 'number' ? error.status : 409);
          throw error;
        });
      };
    },
    async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
      if (!url.pathname.startsWith('/api/studio/')) return false;
      try {
        if (url.pathname === '/api/studio/enterprises' && request.method === 'GET') { json(response, 200, enterpriseScopes.list()); return true; }
        if (url.pathname === '/api/studio/foundation' && request.method === 'GET') { json(response, 200, await enterpriseCatalog.catalog(uuid(url.searchParams.get('enterpriseId')))); return true; }
        if (url.pathname === '/api/studio/enterprises' && request.method === 'POST') {
          const input = await options.readBody(request), requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
          const receipt = await options.mutate(() => operations.run(requestId, { path: url.pathname, input }, async () => {
            if (options.closing()) throw new StudioError('host_closing', 503);
            return { statusCode: 201, result: enterpriseScopes.create({ name: text(input.name, 200, false) }) as unknown as Record<string, unknown> };
          }));
          json(response, receipt.statusCode || 201, receipt.result); return true;
        }
        if (url.pathname === '/api/studio/enterprise-associations' && request.method === 'POST') {
          const input = await options.readBody(request), requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
          const receipt = await options.mutate(() => operations.run(requestId, { path: url.pathname, input }, async () => {
            if (options.closing()) throw new StudioError('host_closing', 503);
            if (input.kind === 'case') {
              if (!options.cases) throw new StudioError('studio_case_unavailable', 503);
              const record = options.cases.getCase(uuid(input.entityId));
              if (input.expectedRevision !== undefined && input.expectedRevision !== record.revision) throw new StudioError('enterprise_source_conflict', 409);
              const enterpriseId = uuid(input.enterpriseId); enterpriseScopes.get(enterpriseId);
              if (options.cases.listProjectLinks(record.id).some(link => { const owner = enterpriseScopes.enterpriseIdForProject(link.projectId); return owner && owner !== enterpriseId; })) throw new StudioError('enterprise_assignment_conflict', 409);
              return { result: enterpriseScopes.associateCase(record.id, enterpriseId) as unknown as Record<string, unknown> };
            }
            if (input.kind === 'asset') {
              const authority = String(input.authority), id = text(input.entityId, 1000, false);
              let current: string | number;
              if (authority === 'enterprise') current = (await options.enterpriseMaterials.get(uuid(id))).material.version;
              else if (authority === 'sap-method') {
                const method = methods.list().find(item => item.id === id); if (!method) throw new StudioError('enterprise_source_not_found', 404); current = method.latestVersion;
              } else if (authority === 'sap-metric') {
                const entries = library.list().filter(item => item.id === id); if (!entries.length) throw new StudioError('enterprise_source_not_found', 404); current = entries.at(-1)!.version;
              } else throw new StudioError('invalid_enterprise_asset_authority');
              if (input.expectedRevision !== undefined && input.expectedRevision !== current) throw new StudioError('enterprise_source_conflict', 409);
              await assertNativeEnterprise(authority, id, uuid(input.enterpriseId));
              if (options.closing()) throw new StudioError('host_closing', 503);
              return { result: enterpriseScopes.associateAsset(authority, id, uuid(input.enterpriseId)) as unknown as Record<string, unknown> };
            }
            if (input.kind !== 'project') throw new StudioError('invalid_enterprise_assignment');
            const projectId = uuid(input.entityId), project = (await options.projects.list()).find(item => item.id === projectId);
            if (!project) throw new StudioError('studio_project_not_found', 404);
            if (project.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
            assertProjectEnterprise(projectId, uuid(input.enterpriseId));
            return { result: enterpriseScopes.associateProject(project.id, uuid(input.enterpriseId)) as unknown as Record<string, unknown> };
          }));
          json(response, receipt.statusCode || 200, receipt.result); return true;
        }
        if (url.pathname === '/api/studio/systems' && request.method === 'GET') {
          const query = url.searchParams.get('projectId'); let systems = store.list();
          if (query !== null) { const projectId = uuid(query); if (!(await options.projects.list()).some(project => project.id === projectId)) throw new StudioError('studio_project_not_found', 404); systems = systems.filter(system => availableFor(system, projectId)); }
          json(response, 200, { systems }); return true;
        }
        if (url.pathname === '/api/studio/materials' && request.method === 'GET') { json(response, 200, { materials: await sources.inventory(uuid(url.searchParams.get('projectId'))) }); return true; }
        const op = /^\/api\/studio\/operations\/([a-f0-9-]+)$/.exec(url.pathname);
        if (op && request.method === 'GET') { let receipt = operations.read(op[1]); if (!receipt) throw new StudioError('studio_operation_not_found', 404); if (receipt.status === 'unknown' && receipt.effect?.kind === 'graph' && options.inspectGraph) { try { const effect = receipt.effect, graph = await options.inspectGraph(effect.systemId, effect.snapshotId); receipt = await options.mutate(async () => { const latest = operations.read(op[1]); if (latest?.status !== 'unknown') return latest!; await active(effect.systemId); if (!store.get(effect.systemId).graphs.some(g => g.snapshotId === graph.snapshotId && g.status === 'succeeded')) store.recordGraph(effect.systemId, { ...graph, status: 'succeeded' }); return { ...latest, result: { system: store.get(effect.systemId), output: { status: 'succeeded', snapshotId: graph.snapshotId }, lifecycle: { status: 'unknown', detail: '只证明派生输出存在，公共资源收尾仍未知；不自动重放或绕过清理' } } }; }); } catch { /* Missing, partial or ineligible output remains UNKNOWN. */ } } json(response, 200, receipt); return true; }
        const route = /^\/api\/studio\/systems(?:\/([a-f0-9-]+)(?:\/(.*))?)?$/.exec(url.pathname);
        if (!route) throw new StudioError('studio_not_found', 404);
        const id = route[1], action = route[2];
        if (id && !action && request.method === 'GET') { json(response, 200, await workspace(id)); return true; }
        if (id && action === 'contributions' && request.method === 'GET') {
          const system = store.get(id), projectQuery = url.searchParams.get('projectId'), taskQuery = url.searchParams.get('taskId');
          let items = system.contributions ?? [];
          if (projectQuery !== null || taskQuery !== null) {
            const projectId = uuid(projectQuery), taskId = uuid(taskQuery); await options.projects.getTask(projectId, taskId);
            if (!availableFor(system, projectId)) throw new StudioError('studio_owner_mismatch', 403);
            if (constructionFor(projectId, taskId)?.id !== id) items = items.filter(item => item.sourceProjectId === projectId && item.sourceTaskId === taskId);
          }
          json(response, 200, { items }); return true;
        }
        const publicationRead = /^publications\/([a-f0-9-]+)\/result$/.exec(action || '');
        if (id && publicationRead && request.method === 'GET') { const publication = await options.mutate(() => reconcilePublication(id, publicationRead[1]!)); json(response, 200, { system: store.get(id), publication }); return true; }
        if (request.method !== 'POST') throw new StudioError('studio_not_found', 404);
        const input = await options.readBody(request, 512 * 1024);
        if (id && action === 'sources/read') { const state = await workspace(id); json(response, 200, await sources.read(sourceRef(input.ref), state.project.id, id, { construction: true, taskId: state.task.id })); return true; }
        const requestId = uuid(input.requestId);
        if (id && action === 'graph-refresh') {
          // Reserve this exact request before work. The common resource domain
          // owns the worker; no Host-wide mutation lock spans its lifetime.
          const snapshotId = randomUUID();
          const result = await operations.run(requestId, { path: url.pathname, input }, async () => {
            if (!options.refreshGraph) throw new StudioError('studio_semantica_unavailable', 409);
            const state = await options.mutate(async () => { const state = await active(id); store.recordGraph(id, { snapshotId, sourceRefs: [], status: 'unknown', detail: '已记录本次快照意图；等待实际构图结果，不自动重放' }); return state; });
            try {
              const graph = await options.refreshGraph(state.system, snapshotId, state.task);
              return await options.mutate(async () => { await active(id); store.recordGraph(id, { ...graph, status: 'succeeded' }); store.selectGraphSnapshot(id, graph.snapshotId); return { result: { system: store.get(id) }, systemId: id }; });
            } catch (error) {
              const beforeDispatch = error && typeof error === 'object' && 'studioWorkerDispatched' in error && error.studioWorkerDispatched === false && !('studioCleanupPending' in error && error.studioCleanupPending);
              if (beforeDispatch) {
                const code = error instanceof StudioError ? error.code : 'studio_graph_preparation_failed';
                await options.mutate(() => store.recordGraph(id, { snapshotId, sourceRefs: [], status: 'failed', detail: `${code}；已确认未派发构图，不记为未知成功` }));
                throw new StudioError(code, 409);
              }
              // Dispatched or unclean work remains UNKNOWN. Output inspection
              // never certifies common resource cleanup or replays the build.
              throw error instanceof StudioError ? new StudioError(error.code, 503) : error;
            }
          }, { systemId: id, effect: { kind: 'graph', systemId: id, snapshotId } });
          json(response, result.statusCode || 200, result.result); return true;
        }
        const result = await options.mutate(() => operations.run(requestId, { path: url.pathname, input }, async () => {
          if (!id) {
            if (options.closing()) throw new StudioError('host_closing', 503);
            const projectId = uuid(input.projectId), project = await options.projects.get(projectId);
            if (project.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
            const name = text(input.name, 200, false), goal = text(input.goal, 20000, false), topicTitle = text(input.topicTitle, 200, false);
            const enterpriseId = input.enterpriseId === undefined ? enterpriseScopes.enterpriseIdForProject(projectId) : uuid(input.enterpriseId);
            if (enterpriseId) { enterpriseScopes.get(enterpriseId); assertProjectEnterprise(projectId, enterpriseId); enterpriseScopes.associateProject(projectId, enterpriseId); }
            const materials = await selectedMaterials(input.materials, projectId);
            const task = await options.projects.createTask(projectId, { name: `Studio · ${name}` }); await options.projects.saveDraft(projectId, task.id, goal);
            const system = store.create({ name, projectId, taskId: task.id, goal, topicTitle, materials, ...(enterpriseId ? { enterpriseId } : {}) }); return { statusCode: 201, result: { system }, systemId: system.id };
          }
          const state = await workspace(id), system = state.system;
          if (action === 'contributions') {
            const identity = object(input.origin) ? input.origin : object(input.report) ? input.report : {};
            const projectId = uuid(identity.projectId), taskId = uuid(identity.taskId);
            const prepared = await contributionInput(system, input, projectId, taskId);
            if (options.closing()) throw new StudioError('host_closing', 503);
            const contribution = store.contribute(id, prepared);
            return { result: { system: store.get(id), contribution }, systemId: id };
          }
          const contributionLink = /^contributions\/([a-f0-9-]+)\/link$/.exec(action || '');
          if (contributionLink) {
            await active(id);
            if (state.running) throw new StudioError('studio_task_busy', 409);
            if (input.expectedRevision !== undefined && input.expectedRevision !== system.revision) throw new StudioError('studio_conflict', 409);
            const contribution = system.contributions?.find(item => item.id === contributionLink[1]);
            if (!contribution) throw new StudioError('studio_contribution_not_found', 404);
            if (input.expectedContributionRevision !== contribution.revision) throw new StudioError('studio_contribution_conflict', 409);
            if (contribution.scope !== 'enterprise') throw new StudioError('studio_contribution_task_local', 409);
            if (!availableFor(system, contribution.sourceProjectId)) throw new StudioError('studio_owner_mismatch', 403);
            const revision = contribution.revisions.at(-1)!;
            await qualifyContributionEvidence(system, contribution.sourceProjectId, contribution.sourceTaskId, revision);
            let ref: StudioSourceRef | undefined;
            if (input.ref !== undefined) {
              ref = sourceRef(input.ref);
              const actual = await sources.read(ref, state.project.id, id, { construction: true, taskId: state.task.id });
              let candidateBody = revision.candidate.body;
              if (revision.candidate.kind === 'sap-method') { try { candidateBody = JSON.stringify(JSON.parse(candidateBody)); } catch { throw new StudioError('studio_contribution_target_changed', 409); } }
              const actualBody = ref.authority === 'sap-method' ? JSON.stringify(JSON.parse(actual.text).content) : actual.text;
              if (candidateBody !== actualBody) throw new StudioError('studio_contribution_target_changed', 409);
            } else {
              const asset = system.assets.find(item => item.id === input.assetId), candidate = asset?.revisions.find(item => item.revision === input.assetRevision);
              if (!asset || !candidate || candidate.title !== revision.candidate.title || candidate.body !== revision.candidate.body || candidate.scope !== revision.candidate.scope) throw new StudioError('studio_contribution_target_changed', 409);
            }
            if (options.closing()) throw new StudioError('host_closing', 503);
            const linked = store.linkContribution(id, { contributionId: contribution.id, expectedContributionRevision: contribution.revision, ...(ref ? { ref } : { assetId: uuid(input.assetId), assetRevision: Number(input.assetRevision) }) });
            return { result: { system: store.get(id), contribution: linked }, systemId: id };
          }
          if (action === 'maintenance') {
            if (options.closing()) throw new StudioError('host_closing', 503);
            if (input.expectedRevision !== system.revision) throw new StudioError('studio_conflict', 409);
            if (!system.enterpriseId) throw new StudioError('studio_enterprise_required', 409);
            const projectId = uuid(input.projectId), target = await options.projects.get(projectId);
            if (target.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
            if (enterpriseScopes.enterpriseIdForProject(projectId) !== system.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
            if (state.running) throw new StudioError('studio_task_busy', 409);
            let task = input.taskId === undefined ? undefined : await options.projects.getTask(projectId, uuid(input.taskId));
            if (task && (options.running(target, task) || constructionFor(projectId, task.id) && constructionFor(projectId, task.id)!.id !== id)) throw new StudioError('studio_task_busy', 409);
            if (!task) { task = await options.projects.createTask(projectId, { name: `Studio · ${system.name}` }); await options.projects.saveDraft(projectId, task.id, system.topics.find(topic => topic.id === system.currentTopicId)!.goal); }
            if (options.closing()) throw new StudioError('host_closing', 503);
            return { result: { system: store.resumeMaintenance(id, { projectId, taskId: task.id, expectedRevision: system.revision }), project: await options.projects.get(projectId), task: await options.projects.getTask(projectId, task.id) }, systemId: id };
          }
          if (action === 'enterprise') {
            if (input.expectedRevision !== system.revision) throw new StudioError('studio_conflict', 409);
            if (state.running || options.closing()) throw new StudioError('studio_task_busy', 409);
            const enterpriseId = uuid(input.enterpriseId); enterpriseScopes.get(enterpriseId);
            if (system.enterpriseId && system.enterpriseId !== enterpriseId || enterpriseScopes.enterpriseIdForProject(state.project.id) && enterpriseScopes.enterpriseIdForProject(state.project.id) !== enterpriseId) throw new StudioError('enterprise_assignment_conflict', 409);
            assertProjectEnterprise(state.project.id, enterpriseId);
            for (const ref of [...system.materials.map(item => item.ref), ...system.assetRefs, ...system.assets.flatMap(asset => asset.revisions.flatMap(revision => [...revision.sources, ...revision.dependencies]))]) if (['enterprise','sap-metric','sap-method','studio-source'].includes(ref.authority)) await assertNativeEnterprise(ref.authority, ref.id, enterpriseId);
            if (options.closing()) throw new StudioError('host_closing', 503);
            enterpriseScopes.associateProject(state.project.id, enterpriseId);
            return { result: { system: store.associateEnterprise(id, { enterpriseId, expectedRevision: system.revision }) }, systemId: id };
          }
          if (action === 'feedback') {
            let refs = parseSources(input.sources ?? []);
            let capturedOrigin: import('../../extensions/business-plugins/studio/contracts.ts').StudioFeedbackOrigin | undefined;
            if (object(input.origin)) {
              const origin = input.origin, projectId = uuid(origin.projectId), taskId = uuid(origin.taskId), selection = { sessionId: text(origin.sessionId, 200, false), messageId: text(origin.messageId, 200, false) };
              if (!availableFor(system, projectId)) throw new StudioError('studio_owner_mismatch', 403);
              const read = await options.readTaskReply(projectId, taskId, selection), sha256 = createHash('sha256').update(read.text).digest('hex');
              await validateSources(refs, system, projectId, false);
              capturedOrigin = { projectId, taskId, ...selection };
              if (options.taskSnapshot) {
                const snapshot = await options.taskSnapshot(projectId, taskId);
                const index = snapshot.messages.findIndex(message => message.role === 'assistant' && message.nativeSessionId === selection.sessionId && message.nativeEntryId === selection.messageId);
                if (index < 0) throw new StudioError('studio_feedback_origin_unavailable', 409);
                const turn: Record<string, any>[] = [];
                for (let at = index - 1; at >= 0 && snapshot.messages[at]?.role !== 'user'; at--) turn.unshift(snapshot.messages[at]!);
                for (const message of turn) {
                  if (message.role !== 'toolResult' || message.isError) continue;
                  if (message.details?.type === 'optracall.studio') {
                    if (['read-source', 'read'].includes(message.details.action) && message.details.result?.ref) refs.push(sourceRef(message.details.result.ref));
                    if (message.details.action === 'declare-use') {
                      const use = system.uses.find(use => use.id === message.details.result?.use?.id && use.projectId === projectId && use.taskId === taskId);
                      if (use) { refs.push(use.report, ...use.sources); capturedOrigin.useId = use.id; if (use.graphSnapshotId) capturedOrigin.graphSnapshotId = use.graphSnapshotId; }
                    }
                  }
                  if (message.details?.type === 'optracall.semantic-graph-result') {
                    const result = message.details;
                    if (typeof result.snapshot?.id === 'string') capturedOrigin.graphSnapshotId = result.snapshot.id;
                    const actualRefs = [...(result.nodes ?? []), ...(result.edges ?? [])].flatMap(item => item.metadata?.sourceRefs ?? []);
                    for (const target of [...actualRefs, ...(result.sources ?? []).flatMap((source: Record<string, any>) => source.ref ? [source.ref] : [])]) { const ref = nativeSourceRef(target, undefined, { projectId, taskId }); if (ref) refs.push(ref); }
                  }
                  if (message.details?.type === 'optracall.semantic-context-result' && ['read', 'trace'].includes(message.details.action)) {
                    for (const item of [...(message.details.items ?? []), ...(message.details.unknownTime ?? [])]) if (typeof item.body === 'string') { const ref = nativeSourceRef(item.target, item.sha256, { projectId, taskId }); if (ref) refs.push(ref); }
                  }
                }
              }
              refs = [...refs, { authority: 'task', id: taskId, taskId, projectId, version: sha256, sha256, locator: JSON.stringify({ kind: 'native-reply', ...selection }) }];
            } else await validateSources(refs, system);
            refs = [...new Map(refs.map(ref => [digest(ref), ref])).values()];
            store.addFeedback(id, { ...input, title: input.title ?? input.summary, sources: refs, origin: capturedOrigin, currentHandling: input.currentHandling || (capturedOrigin?.useId ? '已关联当时准确使用记录及原生读取出处，尚未核实源资产缺陷' : '仅关联实际可核原回复与读取回执；缺少实际使用/快照证据的部分仍未知') } as unknown as StudioFeedbackInput);
            return { result: { system: store.get(id) }, systemId: id };
          }
          await active(id);
          if (action === 'materials') { for (const material of await selectedMaterials(input.materials, state.project.id)) store.updateMaterial(id, material); }
          else if (action === 'assets') await saveAsset(id, input, false);
          else if (action === 'answers') store.answerWorkItem(id, uuid(input.workItemId), text(input.answer, 20_000, false), input.expectedQuestionContextSha256);
          else if (action === 'preview') {
            await validatePublicationRefs(system, parseSources(input.refs ?? []));
            await qualifySelectedContributions(system, input);
            const preview = store.preparePublication(id, input as unknown as StudioPublicationInput); return { result: { system: store.get(id), preview }, systemId: id };
          }
          else if (action === 'publications') {
            const publication = await publish(system, uuid(input.previewId), text(input.fingerprint, 64, false)); return { result: { system: store.get(id), publication }, systemId: id };
          }
          else if (action === 'adoptions') {
            const projectId = uuid(input.projectId), target = await options.projects.get(projectId); if (target.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
            if (system.enterpriseId && enterpriseScopes.enterpriseIdForProject(projectId) !== system.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
            const packageId = text(input.packageId, 200, false), version = text(input.version, 50, false), read = library.read(packageId, version);
            createProjectEnablement(path.join(options.dataRoot, 'projects', projectId)).enable(packageId, version);
            store.recordAdoption(id, { projectId, refs: [{ authority: 'sap-metric', id: packageId, version, sha256: read.entry.bytesSha256 }], status: 'succeeded', detail: '原指标包准确项目采用已保存；其他项目不升级，SAP方法无逐项目启用' });
          }
          else if (action === 'graph-selection') {
            if (!options.inspectGraph) throw new StudioError('studio_semantica_unavailable', 409);
            const snapshotId = uuid(input.snapshotId);
            try { await options.inspectGraph(id, snapshotId); }
            catch { throw new StudioError('studio_graph_selection_unavailable', 409); }
            store.selectGraphSnapshot(id, snapshotId);
          }
          else if (action === 'use') {
            const projectId = uuid(input.projectId), target = await options.projects.get(projectId); if (target.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
            if (system.enterpriseId && enterpriseScopes.enterpriseIdForProject(projectId) !== system.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
            const task = await options.projects.createTask(projectId, { name: `${system.name} · 分析` }); await options.projects.saveDraft(projectId, task.id, '请结合本项目获准资料与适用正式资产，分析当前业务问题。');
            store.linkUsageProject(id, projectId, task.id);
            return { result: { system: store.get(id), project: await options.projects.get(projectId), task }, systemId: id };
          }
          else throw new StudioError('studio_not_found', 404);
          return { result: { system: store.get(id) }, systemId: id };
        }));
        json(response, result.statusCode || 200, result.result); return true;
      } catch (error) { if (error instanceof StudioError || error instanceof SapMethodStoreError || error instanceof MetricLibraryFault || error instanceof CaseStoreError) { const value = error as { status?: number; statusCode?: number; code: string }; json(response, value.status ?? value.statusCode ?? 409, { code: value.code, message: value.code }); return true; } throw error; }
    },
  };
  return api;
}

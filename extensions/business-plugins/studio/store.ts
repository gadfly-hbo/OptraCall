import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { StudioCreateInput, StudioStoreOptions, StudioSystem, StudioSaveAssetInput, StudioAsset, StudioAssetKind, StudioAssetRevision, StudioPublicationInput, StudioPublicationPreview, StudioPublication, StudioPublicationResult, StudioUpdateInput, StudioMaterial, StudioSourceRef, StudioWorkItemInput, StudioWorkItem, StudioFeedbackInput, StudioFeedback, StudioFeedbackUpdate, StudioUseRecord, StudioAdoption, StudioGraphState, StudioTopic, StudioPublishedAsset, StudioUseAssessmentInput, StudioContribution, StudioContributeInput, StudioContributionContent, StudioContributionRevision, StudioLinkContributionInput, StudioContributionLink, StudioContributionSnapshot, StudioPublicationItem } from './contracts.ts';
import { fail, StudioError, text, identity, uuid, object, sources, checks, strings, positive, digest, sourceRef, feedbackOrigin } from './validation.ts';
import { studioQuestionContext, studioExecutionOwner } from './contracts.ts';
export { StudioError } from './validation.ts';

type Index = { schemaVersion: 1; systems: StudioSystem[] };
const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const MAX_BYTES = 32 * 1024 * 1024;

/** Host-owned metadata and semantic source authority. SAP bodies remain in their original stores. */
export class StudioStore {
  readonly dataRoot: string;
  readonly root: string;
  private readonly file: string;
  private readonly options: StudioStoreOptions;
  constructor(dataRoot: string, options: StudioStoreOptions = {}) {
    this.dataRoot = path.resolve(dataRoot); this.root = path.join(this.dataRoot, 'studio');
    this.file = path.join(this.root, 'index.json'); this.options = options;
  }
  private directory(directory: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('unsafe_studio_storage', 503); if (!create) return false; fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(directory); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_studio_storage', 503); return true;
  }
  private readBytes(): Buffer {
    try {
      const before = fs.lstatSync(this.file, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) fail('unsafe_studio_storage', 503);
      const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const initial = fs.fstatSync(fd, { bigint: true });
        if (initial.ino !== before.ino || initial.dev !== before.dev || initial.nlink !== 1n || initial.size !== before.size) fail('studio_storage_changed', 503);
        const bytes = fs.readFileSync(fd); const final = fs.fstatSync(fd, { bigint: true }); const current = fs.lstatSync(this.file, { bigint: true });
        if (BigInt(bytes.length) !== initial.size || final.size !== initial.size || final.ctimeNs !== initial.ctimeNs || final.mtimeNs !== initial.mtimeNs || current.ino !== initial.ino || current.dev !== initial.dev || current.nlink !== 1n || current.isSymbolicLink()) fail('studio_storage_changed', 503);
        return bytes;
      } finally { fs.closeSync(fd); }
    } catch (error) { if (error instanceof StudioError) throw error; return fail('unsafe_studio_storage', 503); }
  }
  private load(): Index {
    if (!this.directory(this.dataRoot, false) || !this.directory(this.root, false)) return { schemaVersion: 1, systems: [] };
    if (!fs.existsSync(this.file)) { if (fs.readdirSync(this.root).length) fail('studio_index_missing', 503); return { schemaVersion: 1, systems: [] }; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.readBytes())); } catch (error) { if (error instanceof StudioError) throw error; return fail('invalid_studio_storage', 503); }
    if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.systems)) fail('unsupported_studio_storage', 503);
    try { for (const system of (value.systems as Record<string, unknown>[])) if (object(system) && system.usageProjectIds === undefined) system.usageProjectIds = []; this.validateStored(value as unknown as Index); } catch { fail('invalid_studio_storage', 503); }
    return value as unknown as Index;
  }
  private validateStored(index: Index): void {
    const systemIds = new Set<string>();
    for (const system of index.systems) {
      uuid(system.id); if (systemIds.has(system.id)) fail('invalid_studio_storage'); systemIds.add(system.id);
      positive(system.revision); text(system.name, 200, false); identity(system.projectId); identity(system.taskId);
      if (system.enterpriseId !== undefined) identity(system.enterpriseId);
      if (system.maintenanceOwner !== undefined) {
        identity(system.maintenanceOwner.projectId); identity(system.maintenanceOwner.taskId);
        if (!Array.isArray(system.maintenanceHistory) || !system.maintenanceHistory.length) fail('invalid_studio_storage');
      }
      if (system.maintenanceHistory !== undefined) {
        if (!Array.isArray(system.maintenanceHistory)) fail('invalid_studio_storage');
        let previous = { projectId: system.projectId, taskId: system.taskId };
        for (const entry of system.maintenanceHistory) {
          identity(entry.projectId); identity(entry.taskId); identity(entry.previousOwner.projectId); identity(entry.previousOwner.taskId);
          if (digest(entry.previousOwner) !== digest(previous) || !Number.isFinite(Date.parse(entry.at))) fail('invalid_studio_storage');
          previous = { projectId: entry.projectId, taskId: entry.taskId };
        }
        if (system.maintenanceHistory.length && digest(previous) !== digest(system.maintenanceOwner)) fail('invalid_studio_storage');
      }
      if (system.contributions !== undefined) {
        if (!Array.isArray(system.contributions)) fail('invalid_studio_storage');
        const ids = new Set<string>();
        for (const contribution of system.contributions) {
          uuid(contribution.id); if (ids.has(contribution.id)) fail('invalid_studio_storage'); ids.add(contribution.id);
          identity(contribution.sourceProjectId); identity(contribution.sourceTaskId);
          if (!Array.isArray(contribution.revisions) || !contribution.revisions.length || contribution.revision !== contribution.revisions.length || contribution.scope !== contribution.revisions.at(-1)!.scope) fail('invalid_studio_storage');
          for (const [offset, revision] of contribution.revisions.entries()) {
            const { revision: number, sha256, createdAt, ...content } = revision;
            if (number !== offset + 1 || digest(content) !== sha256 || !Number.isFinite(Date.parse(createdAt))) fail('invalid_studio_storage');
            this.contributionContent(content, contribution.sourceProjectId, contribution.sourceTaskId);
          }
          for (const link of [...(contribution.linkHistory ?? []), ...(contribution.linked ? [contribution.linked] : [])]) {
            this.contributionLink(link);
            if (!contribution.revisions.some(revision => revision.revision === link.contributionRevision)) fail('invalid_studio_storage');
            if (link.ref ? !system.assetRefs.some(ref => digest(ref) === digest(link.ref)) : !system.assets.some(asset => asset.id === link.assetId && asset.revisions.some(revision => revision.revision === link.assetRevision))) fail('invalid_studio_storage');
          }
          if (contribution.linkHistory !== undefined && !Array.isArray(contribution.linkHistory)) fail('invalid_studio_storage');
          if (!Number.isFinite(Date.parse(contribution.createdAt)) || !Number.isFinite(Date.parse(contribution.updatedAt))) fail('invalid_studio_storage');
        }
      }
      if (!Array.isArray(system.usageProjectIds)) fail('invalid_studio_storage'); system.usageProjectIds.forEach(identity);
      if (system.usageTasks !== undefined) { if (!Array.isArray(system.usageTasks)) fail('invalid_studio_storage'); for (const owner of system.usageTasks) { identity(owner.projectId); identity(owner.taskId); if (!system.usageProjectIds.includes(owner.projectId)) fail('invalid_studio_storage'); } }
      if (!Array.isArray(system.topics) || !system.topics.length || !['materials', 'assets', 'assetRefs', 'workItems', 'feedback', 'publications', 'adoptions', 'graphs', 'uses'].every(k => Array.isArray((system as unknown as Record<string, unknown>)[k]))) fail('invalid_studio_storage');
      if (system.selectedGraphSnapshotId !== undefined && (!uuid(system.selectedGraphSnapshotId) || !system.graphs.some(graph => graph.snapshotId === system.selectedGraphSnapshotId && graph.status === 'succeeded'))) fail('invalid_studio_storage');
      const topicIds = new Set<string>();
      for (const topic of system.topics) { uuid(topic.id); if (topicIds.has(topic.id)) fail('invalid_studio_storage'); topicIds.add(topic.id); text(topic.title, 200, false); text(topic.goal, 20_000, false); text(topic.scope); text(topic.progress); strings(topic.coverage); strings(topic.gaps); if (!['planned', 'building', 'ready', 'published', 'verifying', 'maintaining'].includes(topic.status)) fail('invalid_studio_storage'); }
      if (!topicIds.has(system.currentTopicId)) fail('invalid_studio_storage');
      for (const material of system.materials) this.material(material);
      sources(system.assetRefs);
      const assetIds = new Set<string>();
      for (const asset of system.assets) {
        uuid(asset.id); if (assetIds.has(asset.id) || !topicIds.has(asset.topicId)) fail('invalid_studio_storage'); assetIds.add(asset.id);
        if (!['business', 'concept', 'rule', 'ontology', 'binding', 'hypothesis', 'strategy'].includes(asset.kind) || !Array.isArray(asset.revisions) || !asset.revisions.length) fail('invalid_studio_storage');
        for (const [offset, revision] of asset.revisions.entries()) {
          const { revision: number, createdAt, sha256, ...content } = revision;
          if (number !== offset + 1 || !Number.isFinite(Date.parse(createdAt)) || digest(content) !== sha256) fail('invalid_studio_storage');
          text(revision.title, 500, false); text(revision.body, 524_288, false); text(revision.scope, 20_000, false); sources(revision.sources); sources(revision.dependencies); checks(revision.checks); strings(revision.limitations); text(revision.reason);
          if (typeof revision.readyForPublication !== 'boolean') fail('invalid_studio_storage');
          if (revision.extraction) { text(revision.extraction.method, 200, false); sources(revision.extraction.sourceRefs); strings(revision.extraction.failures); strings(revision.extraction.fallbacks); if (typeof revision.extraction.reviewed !== 'boolean') fail('invalid_studio_storage'); }
        }
        if (asset.candidateRevision !== null && asset.candidateRevision !== asset.revisions.at(-1)!.revision) fail('invalid_studio_storage');
        if (asset.formalRevision !== null && (!asset.revisions.some(r => r.revision === asset.formalRevision) || !system.publications.some(p => p.preview.confirmedAt && p.preview.items.some(i => i.assetId === asset.id && i.revision === asset.formalRevision && i.sha256 === asset.revisions[asset.formalRevision! - 1].sha256)))) fail('invalid_studio_storage');
        if (asset.issueHistory !== undefined && !Array.isArray(asset.issueHistory)) fail('invalid_studio_storage');
        for (const issue of [...(asset.issueHistory ?? []), ...(asset.issue ? [asset.issue] : [])]) { positive(issue.affectedRevision); text(issue.reason, 20_000, false); if (!Number.isFinite(Date.parse(issue.confirmedAt))) fail('invalid_studio_storage'); }
      }
      for (const publication of system.publications) {
        const { fingerprint, confirmedAt, ...prepared } = publication.preview;
        uuid(prepared.id); if (digest(prepared) !== fingerprint || !topicIds.has(prepared.topicId) || !Array.isArray(prepared.items) || !Array.isArray(publication.results)) fail('invalid_studio_storage');
        for (const item of prepared.items) { const asset = system.assets.find(a => a.id === item.assetId); if (!asset || asset.revisions.find(r => r.revision === item.revision)?.sha256 !== item.sha256) fail('invalid_studio_storage'); }
        if (prepared.contributions !== undefined) {
          if (!Array.isArray(prepared.contributions)) fail('invalid_studio_storage');
          for (const snapshot of prepared.contributions) {
            const contribution = system.contributions?.find(item => item.id === snapshot.contributionId), revision = contribution?.revisions.find(item => item.revision === snapshot.revision);
            if (!contribution || !revision || snapshot.sha256 !== revision.sha256 || snapshot.sourceProjectId !== contribution.sourceProjectId || snapshot.sourceTaskId !== contribution.sourceTaskId || snapshot.title !== revision.candidate.title || digest(snapshot.report) !== digest(revision.report) || digest(snapshot.baseRefs) !== digest(revision.baseRefs)) fail('invalid_studio_storage');
            if (snapshot.assetId ? !prepared.items.some(item => item.assetId === snapshot.assetId && item.revision === snapshot.assetRevision) : !snapshot.ref || !prepared.refs.some(ref => digest(ref) === digest(snapshot.ref))) fail('invalid_studio_storage');
          }
        }
        sources(prepared.refs); checks(prepared.checks); strings(prepared.limitations); strings(prepared.excluded); prepared.targetProjectIds.forEach(identity); text(prepared.summary, 20_000, false); text(prepared.scope, 20_000, false);
        if (confirmedAt !== undefined && !Number.isFinite(Date.parse(confirmedAt))) fail('invalid_studio_storage');
        for (const result of publication.results) { if (!['studio-source', 'sap-metric', 'sap-method'].includes(result.module) || !['succeeded', 'failed', 'unknown'].includes(result.status)) fail('invalid_studio_storage'); text(result.detail); sources(result.refs); }
      }
      for (const item of system.workItems) { uuid(item.id); if (!topicIds.has(item.topicId) || !['task', 'question', 'gap', 'review'].includes(item.kind) || !['open', 'waiting', 'in_progress', 'resolved'].includes(item.status)) fail('invalid_studio_storage'); text(item.title, 500, false); text(item.detail); text(item.impact); text(item.nextStep); sources(item.sources); if (item.answer !== undefined) text(item.answer); }
      for (const feedback of system.feedback) { uuid(feedback.id); if (!topicIds.has(feedback.topicId) || !['recorded', 'accepted', 'needs_material', 'revision_prepared', 'published_pending_use', 'verified', 'not_confirmed'].includes(feedback.status)) fail('invalid_studio_storage'); text(feedback.title, 500, false); text(feedback.problem, 20_000, false); text(feedback.currentHandling); text(feedback.impact); text(feedback.response); sources(feedback.sources); if (feedback.origin !== undefined) feedbackOrigin(feedback.origin); if (feedback.verification) { sources(feedback.verification.sources); text(feedback.verification.result, 20_000, false); } }
      for (const adoption of system.adoptions) { identity(adoption.projectId); sources(adoption.refs); text(adoption.detail); if (!['succeeded', 'failed', 'unknown'].includes(adoption.status)) fail('invalid_studio_storage'); }
      for (const graph of system.graphs) { identity(graph.snapshotId); sources(graph.sourceRefs); text(graph.detail); if (!['succeeded', 'failed', 'unknown'].includes(graph.status)) fail('invalid_studio_storage'); }
      for (const use of system.uses) { uuid(use.id); identity(use.projectId); identity(use.taskId); sources(use.sources); sourceRef(use.report); text(use.result); if (!['not_assessed', 'pass', 'fail', 'unknown'].includes(use.verification)) fail('invalid_studio_storage'); if (use.assessments !== undefined) { if (!Array.isArray(use.assessments)) fail('invalid_studio_storage'); for (const assessment of use.assessments) { if (!['pass', 'fail', 'unknown'].includes(assessment.status) || !Number.isFinite(Date.parse(assessment.at))) fail('invalid_studio_storage'); sourceRef(assessment.report); sources(assessment.sources); text(assessment.result, 20_000, false); } } }
    }
  }
  private save(index: Index): void {
    this.directory(this.dataRoot, true); this.directory(this.root, true);
    if (fs.existsSync(this.file)) this.readBytes();
    const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n'); if (bytes.length > MAX_BYTES) fail('studio_storage_too_large', 413);
    const temporary = path.join(this.root, `${randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temporary, this.file); const dir = fs.openSync(this.root, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
  }
  private requireSystem(index: Index, id: string): StudioSystem { const found = index.systems.find(s => s.id === uuid(id)); return found || fail('studio_not_found', 404); }
  private writable(system: StudioSystem) { if (this.options.isReadOnly?.(studioExecutionOwner(system).projectId)) fail('studio_project_read_only', 409); }
  private mutate<T>(id: string, change: (system: StudioSystem) => T, feedbackOnly = false): T {
    const index = this.load(); const system = this.requireSystem(index, id); if (!feedbackOnly) this.writable(system);
    const result = change(system); system.revision++; system.updatedAt = now(); this.save(index); return clone(result);
  }
  create(input: StudioCreateInput): StudioSystem {
    const index = this.load(); const createdAt = now(); const topicId = randomUUID();
    const system: StudioSystem = { id: randomUUID(), revision: 1, name: text(input.name, 200, false), projectId: identity(input.projectId), taskId: identity(input.taskId), currentTopicId: topicId, usageProjectIds: [], usageTasks: [],
      ...(input.enterpriseId === undefined ? {} : { enterpriseId: identity(input.enterpriseId) }),
      topics: [{ id: topicId, title: text(input.topicTitle, 200, false), goal: text(input.goal, 20_000, false), scope: text(input.scope ?? ''), status: 'building', progress: '', coverage: [], gaps: [] }],
      materials: (input.materials ?? []).map(m => this.material(m)), assets: [], assetRefs: [], workItems: [], feedback: [], publications: [], adoptions: [], graphs: [], uses: [], createdAt, updatedAt: createdAt };
    this.writable(system); index.systems.push(system); this.save(index); return clone(system);
  }
  associateEnterprise(id: string, input: { enterpriseId: string; expectedRevision: number }): StudioSystem {
    return this.mutate(id, system => {
      if (positive(input.expectedRevision) !== system.revision) fail('studio_conflict', 409);
      const enterpriseId = identity(input.enterpriseId);
      if (system.enterpriseId !== undefined && system.enterpriseId !== enterpriseId) fail('studio_enterprise_conflict', 409);
      system.enterpriseId = enterpriseId; return system;
    });
  }
  /** Host verifies the new owner and enterprise before saving this business association. */
  resumeMaintenance(id: string, input: { projectId: string; taskId: string; expectedRevision: number }): StudioSystem {
    return this.mutate(id, system => {
      if (positive(input.expectedRevision) !== system.revision) fail('studio_conflict', 409);
      const owner = { projectId: identity(input.projectId), taskId: identity(input.taskId) };
      if (this.options.isReadOnly?.(owner.projectId)) fail('studio_project_read_only', 409);
      const previousOwner = studioExecutionOwner(system);
      system.maintenanceHistory ??= [];
      system.maintenanceHistory.push({ ...owner, previousOwner, at: now() });
      system.maintenanceOwner = owner; return system;
    }, true);
  }
  private contributionContent(input: StudioContributionContent, projectId: string, taskId: string): StudioContributionContent {
    if (!['enterprise', 'task'].includes(input.scope)) fail('invalid_studio_contribution_scope');
    const report = sourceRef(input.report);
    if (!['task', 'data'].includes(report.authority) || report.projectId !== projectId || report.taskId !== taskId) fail('studio_contribution_report_mismatch', 403);
    const candidate = input.candidate;
    if (!object(candidate) || !['business', 'concept', 'rule', 'ontology', 'binding', 'hypothesis', 'strategy', 'sap-metric', 'sap-method'].includes(candidate.kind)) fail('invalid_studio_contribution_candidate');
    return { scope: input.scope, report, sourceRefs: sources(input.sourceRefs), baseRefs: sources(input.baseRefs), baseSystemRevision: positive(input.baseSystemRevision),
      candidate: { kind: candidate.kind, title: text(candidate.title, 500, false), body: text(candidate.body, 524_288, false), scope: text(candidate.scope, 20_000, false), ...(candidate.reason === undefined ? {} : { reason: text(candidate.reason) }) } };
  }
  /** A task-owned proposal can be retained while construction is archived; it never writes a formal asset. */
  contribute(id: string, input: StudioContributeInput): StudioContribution {
    return this.mutate(id, system => {
      const projectId = identity(input.sourceProjectId), taskId = identity(input.sourceTaskId);
      if (this.options.isReadOnly?.(projectId)) fail('studio_project_read_only', 409);
      system.contributions ??= [];
      let contribution = input.contributionId ? system.contributions.find(item => item.id === uuid(input.contributionId)) : undefined;
      if (input.contributionId && !contribution) fail('studio_contribution_not_found', 404);
      if (contribution) {
        if (contribution.sourceProjectId !== projectId || contribution.sourceTaskId !== taskId) fail('studio_contribution_owner_mismatch', 403);
        if (input.expectedRevision !== contribution.revision) fail('studio_contribution_conflict', 409);
      } else if (input.expectedRevision !== undefined && input.expectedRevision !== 0) fail('studio_contribution_conflict', 409);
      const baseSystemRevision = input.baseSystemRevision === undefined ? system.revision : positive(input.baseSystemRevision);
      if (baseSystemRevision !== system.revision) fail('studio_contribution_base_conflict', 409);
      const content = this.contributionContent({ ...input, baseRefs: input.baseRefs ?? [], baseSystemRevision }, projectId, taskId), createdAt = now();
      const revision: StudioContributionRevision = { ...content, revision: (contribution?.revision ?? 0) + 1, sha256: digest(content), createdAt };
      if (!contribution) { contribution = { id: randomUUID(), revision: 0, sourceProjectId: projectId, sourceTaskId: taskId, scope: input.scope, revisions: [], createdAt, updatedAt: createdAt }; system.contributions.push(contribution); }
      contribution.revision = revision.revision; contribution.scope = revision.scope; contribution.revisions.push(revision); contribution.updatedAt = createdAt; return contribution;
    }, true);
  }
  private contributionLink(input: StudioContributionLink): StudioContributionLink {
    if (!Number.isFinite(Date.parse(input.at))) fail('invalid_studio_contribution_link');
    if (input.ref !== undefined) {
      if (input.assetId !== undefined || input.assetRevision !== undefined) fail('invalid_studio_contribution_target');
      const ref = sourceRef(input.ref);
      if (!['sap-metric', 'sap-method'].includes(ref.authority) || ref.sha256 === undefined) fail('invalid_studio_contribution_target');
      return { contributionRevision: positive(input.contributionRevision), ref, at: input.at };
    }
    if (input.assetId === undefined || input.assetRevision === undefined) fail('invalid_studio_contribution_target');
    return { contributionRevision: positive(input.contributionRevision), assetId: uuid(input.assetId), assetRevision: positive(input.assetRevision), at: input.at };
  }
  private contributionBase(system: StudioSystem, revision: StudioContributionRevision): void {
    for (const ref of revision.baseRefs.filter(ref => ref.authority === 'studio-source')) {
      let authority = system;
      if (ref.locator !== undefined && ref.locator !== system.id) {
        try { authority = this.get(ref.locator); } catch { fail('studio_contribution_base_conflict', 409); }
        if (!system.enterpriseId || authority.enterpriseId !== system.enterpriseId) fail('studio_contribution_base_conflict', 409);
      }
      const asset = authority.assets.find(asset => asset.id === ref.id), formal = asset?.revisions.find(item => item.revision === asset.formalRevision);
      if (!formal || ref.projectId !== undefined && ref.projectId !== authority.projectId || ref.version !== String(formal.revision) || ref.sha256 !== formal.sha256
        || asset?.issue?.affectedRevision === formal.revision || asset?.issueHistory?.some(issue => issue.affectedRevision === formal.revision)
        || !authority.publications.some(publication => publication.preview.confirmedAt && publication.preview.items.some(item => item.assetId === ref.id && item.revision === formal.revision && item.sha256 === formal.sha256))) fail('studio_contribution_base_conflict', 409);
    }
  }
  linkContribution(id: string, input: StudioLinkContributionInput): StudioContribution {
    return this.mutate(id, system => {
      const contribution = system.contributions?.find(item => item.id === uuid(input.contributionId));
      if (!contribution) fail('studio_contribution_not_found', 404);
      if (contribution.revision !== positive(input.expectedContributionRevision)) fail('studio_contribution_conflict', 409);
      if (contribution.scope !== 'enterprise') fail('studio_contribution_task_local', 409);
      if (!system.enterpriseId) fail('studio_enterprise_required', 409);
      const revision = contribution.revisions.at(-1)!, link = this.contributionLink({ contributionRevision: contribution.revision, assetId: input.assetId, assetRevision: input.assetRevision, ...(input.ref ? { ref: input.ref } : {}), at: now() });
      if (link.ref) {
        if (revision.candidate.kind !== link.ref.authority || !system.assetRefs.some(ref => digest(ref) === digest(link.ref))) fail('studio_contribution_target_changed', 409);
      } else {
        const asset = system.assets.find(asset => asset.id === link.assetId);
        if (!asset || asset.candidateRevision !== link.assetRevision || asset.kind !== revision.candidate.kind) fail('studio_contribution_target_changed', 409);
        if (asset.formalRevision !== null && !revision.baseRefs.some(ref => ref.authority === 'studio-source' && (ref.locator === undefined || ref.locator === system.id) && ref.id === asset.id && ref.version === String(asset.formalRevision))) fail('studio_contribution_base_conflict', 409);
      }
      this.contributionBase(system, revision);
      if (contribution.linked) { contribution.linkHistory ??= []; contribution.linkHistory.push(contribution.linked); }
      contribution.linked = link; contribution.updatedAt = now(); return contribution;
    });
  }
  private publicationContributions(system: StudioSystem, items: StudioPublicationItem[], refs: StudioSourceRef[]): StudioContributionSnapshot[] {
    const snapshots: StudioContributionSnapshot[] = [];
    for (const contribution of system.contributions ?? []) {
      const link = contribution.linked;
      if (!link || !(link.assetId ? items.some(item => item.assetId === link.assetId && item.revision === link.assetRevision) : link.ref && refs.some(ref => digest(ref) === digest(link.ref)))) continue;
      const revision = contribution.revisions.at(-1)!;
      if (contribution.scope !== 'enterprise' || link.contributionRevision !== contribution.revision) fail('studio_contribution_changed', 409);
      this.contributionBase(system, revision);
      snapshots.push({ contributionId: contribution.id, revision: revision.revision, sha256: revision.sha256, sourceProjectId: contribution.sourceProjectId, sourceTaskId: contribution.sourceTaskId, title: revision.candidate.title, report: revision.report, baseRefs: revision.baseRefs,
        ...(link.assetId ? { assetId: link.assetId, assetRevision: link.assetRevision } : { ref: link.ref }) });
    }
    return snapshots;
  }
  saveAsset(id: string, input: StudioSaveAssetInput): StudioAsset {
    const kinds: StudioAssetKind[] = ['business', 'concept', 'rule', 'ontology', 'binding', 'hypothesis', 'strategy'];
    if (!kinds.includes(input.kind)) fail('invalid_studio_asset_kind');
    return this.mutate(id, system => {
      const topicId = input.topicId ?? system.currentTopicId; if (!system.topics.some(t => t.id === topicId)) fail('studio_topic_not_found', 404);
      let asset: StudioAsset | undefined = input.assetId ? system.assets.find(a => a.id === uuid(input.assetId)) : undefined;
      if (input.assetId && !asset) fail('studio_asset_not_found', 404);
      if (asset) { if (asset.kind !== input.kind || input.expectedRevision !== asset.revisions.at(-1)?.revision) fail('studio_asset_conflict', 409); }
      else { if (input.expectedRevision !== undefined && input.expectedRevision !== 0) fail('studio_asset_conflict', 409); asset = { id: randomUUID(), kind: input.kind, topicId, revisions: [], candidateRevision: null, formalRevision: null }; system.assets.push(asset); }
      if (input.readyForPublication !== undefined && typeof input.readyForPublication !== 'boolean') fail('invalid_studio_publication_readiness');
      const content = { title: text(input.title, 500, false), body: text(input.body, 524_288, false), scope: text(input.scope, 20_000, false), sources: sources(input.sources), dependencies: sources(input.dependencies ?? []), checks: checks(input.checks ?? []), limitations: strings(input.limitations ?? []), readyForPublication: input.readyForPublication ?? false, reason: text(input.reason ?? '') };
      const extraction = input.extraction ? { method: text(input.extraction.method, 200, false), sourceRefs: sources(input.extraction.sourceRefs), failures: strings(input.extraction.failures), fallbacks: strings(input.extraction.fallbacks), reviewed: input.extraction.reviewed === true } : undefined;
      const revision: StudioAssetRevision = { ...content, ...(extraction ? { extraction } : {}), revision: (asset.revisions.at(-1)?.revision ?? 0) + 1, sha256: digest({ ...content, ...(extraction ? { extraction } : {}) }), createdAt: now() };
      asset.revisions.push(revision); asset.candidateRevision = revision.revision; return asset;
    });
  }
  preparePublication(id: string, input: StudioPublicationInput): StudioPublicationPreview {
    if (!Array.isArray(input.assetIds) || input.assetIds.length > 200 || new Set(input.assetIds).size !== input.assetIds.length) fail('invalid_studio_publication_items');
    return this.mutate(id, system => {
      const topicId = input.topicId ?? system.currentTopicId; if (!system.topics.some(t => t.id === topicId)) fail('studio_topic_not_found', 404);
      const items = input.assetIds.map(assetId => {
        const asset = system.assets.find(a => a.id === uuid(assetId)); if (!asset) fail('studio_asset_not_found', 404);
        const revision = asset.revisions.find(r => r.revision === (asset.candidateRevision ?? asset.formalRevision));
        if (!revision || !revision.readyForPublication || !revision.sources.length || revision.checks.some(c => c.status === 'fail' || c.status === 'unknown') || (revision.extraction && !revision.extraction.reviewed)) fail('studio_source_not_ready', 409);
        return { assetId: asset.id, revision: revision.revision, sha256: revision.sha256, title: revision.title, kind: asset.kind };
      });
      const refs = sources(input.refs ?? []); if (!items.length && !refs.length) fail('empty_studio_publication');
      const contributions = this.publicationContributions(system, items, refs);
      const content = { id: randomUUID(), systemRevision: system.revision, topicId, items, refs, ...(contributions.length ? { contributions } : {}), summary: text(input.summary, 20_000, false), scope: text(input.scope, 20_000, false), checks: checks(input.checks ?? []), limitations: strings(input.limitations ?? []), excluded: strings(input.excluded ?? []), targetProjectIds: (input.targetProjectIds ?? []).map(identity), createdAt: now() };
      if (content.checks.some(c => c.status !== 'pass')) fail('studio_publication_not_ready', 409);
      const preview = { ...content, fingerprint: digest(content) };
      system.publications.push({ preview, results: [] }); return preview;
    });
  }
  confirmPublication(id: string, previewId: string, fingerprint: string): StudioPublication {
    const existing = this.get(id).publications.find(p => p.preview.id === uuid(previewId));
    if (!existing) fail('studio_publication_not_found', 404);
    if (existing.preview.fingerprint !== fingerprint) fail('studio_publication_changed', 409);
    // An explicit repeat reads the original result, including UNKNOWN; it never replays a module.
    if (existing.preview.confirmedAt) return existing;
    return this.mutate(id, system => {
      const publication = system.publications.find(p => p.preview.id === previewId)!;
      const { fingerprint: savedFingerprint, confirmedAt: _confirmedAt, ...prepared } = publication.preview;
      if (savedFingerprint !== fingerprint || digest(prepared) !== fingerprint) fail('studio_publication_changed', 409);
      if (digest(this.publicationContributions(system, prepared.items, prepared.refs)) !== digest(prepared.contributions ?? [])) fail('studio_contribution_changed', 409);
      for (const item of publication.preview.items) {
        const asset = system.assets.find(a => a.id === item.assetId);
        const revision = asset?.revisions.find(r => r.revision === item.revision);
        if (!asset || !revision || revision.sha256 !== item.sha256 || (asset.candidateRevision ?? asset.formalRevision) !== item.revision || asset.issue?.affectedRevision === item.revision) fail('studio_publication_changed', 409);
      }
      for (const item of publication.preview.items) { const asset = system.assets.find(a => a.id === item.assetId)!; asset.formalRevision = item.revision; if (asset.candidateRevision === item.revision) asset.candidateRevision = null; }
      publication.preview.confirmedAt = now();
      publication.results.push({ module: 'studio-source', status: 'succeeded', detail: '确定源版本已正式保存；其他模块结果、项目采用和图刷新分别核对', refs: publication.preview.items.map(item => ({ authority: 'studio-source', id: item.assetId, version: String(item.revision), sha256: item.sha256 })), at: now() });
      return publication;
    });
  }
  recordPublicationResult(id: string, previewId: string, result: Omit<StudioPublicationResult, 'at'>): StudioPublication {
    if (!['sap-metric', 'sap-method'].includes(result.module) || !['succeeded', 'failed', 'unknown'].includes(result.status)) fail('invalid_studio_publication_result');
    return this.mutate(id, system => {
      const publication = system.publications.find(p => p.preview.id === uuid(previewId)); if (!publication?.preview.confirmedAt) fail('studio_publication_not_confirmed', 409);
      const saved = { module: result.module, status: result.status, detail: text(result.detail, 20_000, false), refs: sources(result.refs) };
      const last = publication.results.filter(r => r.module === result.module).at(-1);
      if (!last || digest({ module: last.module, status: last.status, detail: last.detail, refs: last.refs }) !== digest(saved)) publication.results.push({ ...saved, at: now() });
      return publication;
    });
  }
  getPublishedAsset(id: string, assetId: string, revision?: number): StudioPublishedAsset {
    const system = this.get(id); const asset = system.assets.find(a => a.id === uuid(assetId)); if (!asset) fail('studio_asset_not_found', 404);
    const requested = revision === undefined ? asset.formalRevision : positive(revision);
    const exact = asset.revisions.find(r => r.revision === requested);
    const publication = system.publications.some(p => p.preview.confirmedAt && p.preview.items.some(i => i.assetId === assetId && i.revision === requested && i.sha256 === exact?.sha256));
    if (!exact || !publication) fail('studio_asset_not_published', 404);
    if (revision === undefined && asset.issue?.affectedRevision === exact.revision) fail('studio_asset_restricted', 409);
    const issue = asset.issueHistory?.find(i => i.affectedRevision === exact.revision) ?? (asset.issue?.affectedRevision === exact.revision ? asset.issue : undefined);
    return { ...exact, ...(issue ? { issue } : {}) };
  }
  update(id: string, input: StudioUpdateInput): StudioSystem {
    return this.mutate(id, system => {
      if (input.expectedRevision !== undefined && input.expectedRevision !== system.revision) fail('studio_conflict', 409);
      if (input.name !== undefined) system.name = text(input.name, 200, false);
      if (input.currentTopicId !== undefined) { if (!system.topics.some(t => t.id === input.currentTopicId)) fail('studio_topic_not_found', 404); system.currentTopicId = input.currentTopicId; }
      if (input.topic) {
        const topic = system.topics.find(t => t.id === system.currentTopicId)!;
        for (const field of ['title', 'goal', 'scope', 'progress'] as const) if (input.topic[field] !== undefined) topic[field] = text(input.topic[field], field === 'title' ? 200 : 20_000, field === 'scope' || field === 'progress');
        if (input.topic.status !== undefined) { if (!['planned', 'building', 'ready', 'published', 'verifying', 'maintaining'].includes(input.topic.status)) fail('invalid_studio_topic_status'); topic.status = input.topic.status; }
        if (input.topic.coverage !== undefined) topic.coverage = strings(input.topic.coverage);
        if (input.topic.gaps !== undefined) topic.gaps = strings(input.topic.gaps);
      }
      return system;
    });
  }
  private material(input: StudioMaterial): StudioMaterial {
    if (typeof input.saved !== 'boolean' || typeof input.readable !== 'boolean') fail('invalid_studio_material');
    const result: StudioMaterial = { ref: sourceRef(input.ref), saved: input.saved, readable: input.readable, note: text(input.note) };
    for (const key of ['readAt', 'processedAt', 'confirmedAt'] as const) if (input[key] !== undefined) { if (!Number.isFinite(Date.parse(input[key]!))) fail('invalid_studio_material_date'); result[key] = input[key]; }
    if (result.processedAt && !result.readAt) fail('studio_material_not_read');
    return result;
  }
  updateMaterial(id: string, input: StudioMaterial): StudioMaterial {
    const material = this.material(input);
    return this.mutate(id, system => { const existing = system.materials.findIndex(m => this.refIdentity(m.ref) === this.refIdentity(material.ref)); if (existing < 0) system.materials.push(material); else system.materials[existing] = material; return material; });
  }
  private refIdentity(ref: StudioSourceRef): string { return digest({ authority: ref.authority, id: ref.id, version: ref.version, sha256: ref.sha256, projectId: ref.projectId, taskId: ref.taskId, locator: ref.locator }); }
  addAssetRef(id: string, input: StudioSourceRef): StudioSourceRef {
    const ref = sourceRef(input);
    return this.mutate(id, system => { if (!system.assetRefs.some(r => this.refIdentity(r) === this.refIdentity(ref))) system.assetRefs.push(ref); return ref; });
  }
  setWorkItem(id: string, input: StudioWorkItemInput): StudioWorkItem {
    if (Object.hasOwn(input, 'answer')) fail('studio_work_item_answer_requires_user', 403);
    return this.mutate(id, system => {
      if (!system.topics.some(t => t.id === input.topicId)) fail('studio_topic_not_found', 404);
      if (!['task', 'question', 'gap', 'review'].includes(input.kind) || !['open', 'waiting', 'in_progress', 'resolved'].includes(input.status)) fail('invalid_studio_work_item');
      const item: StudioWorkItem = { id: input.id ? uuid(input.id) : randomUUID(), topicId: input.topicId, kind: input.kind, title: text(input.title, 500, false), detail: text(input.detail), impact: text(input.impact), nextStep: text(input.nextStep), sources: sources(input.sources), status: input.status, updatedAt: now() };
      const existing = system.workItems.findIndex(w => w.id === item.id); if (input.id && existing < 0) fail('studio_work_item_not_found', 404);
      const answered = system.workItems[existing];
      if (answered?.answer !== undefined) {
        for (const key of ['topicId', 'kind', 'title', 'detail', 'impact', 'sources'] as const) if (digest(item[key]) !== digest(answered[key])) fail('studio_answered_question_immutable', 409);
        item.answer = answered.answer; item.status = 'resolved';
      }
      if (existing < 0) system.workItems.push(item); else system.workItems[existing] = item; return item;
    });
  }
  answerWorkItem(id: string, itemId: string, answer: string, expectedQuestionContextSha256: unknown): StudioWorkItem {
    if (typeof expectedQuestionContextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedQuestionContextSha256)) fail('studio_question_context_required');
    return this.mutate(id, system => {
      const item = system.workItems.find(w => w.id === uuid(itemId)); if (!item || item.kind !== 'question') fail('studio_question_not_found', 404);
      if (createHash('sha256').update(studioQuestionContext(item)).digest('hex') !== expectedQuestionContextSha256) fail('studio_question_changed', 409);
      item.answer = text(answer, 20_000, false); item.status = 'resolved'; item.updatedAt = now(); return item;
    });
  }
  addFeedback(id: string, input: StudioFeedbackInput): StudioFeedback {
    return this.mutate(id, system => {
      const topicId = input.topicId ?? system.currentTopicId; if (!system.topics.some(t => t.id === topicId)) fail('studio_topic_not_found', 404);
      const facts = { topicId, title: text(input.title, 500, false), problem: text(input.problem, 20_000, false), sources: sources(input.sources), currentHandling: text(input.currentHandling ?? ''), impact: text(input.impact ?? ''), ...(input.origin === undefined ? {} : { origin: feedbackOrigin(input.origin) }) };
      const existing = system.feedback.find(f => f.topicId === topicId && f.problem === facts.problem && digest(f.sources) === digest(facts.sources) && digest(f.origin ?? null) === digest(facts.origin ?? null)); if (existing) return existing;
      const createdAt = now(); const feedback: StudioFeedback = { ...facts, id: randomUUID(), status: 'recorded', response: '', createdAt, updatedAt: createdAt }; system.feedback.push(feedback); return feedback;
    }, true);
  }
  updateFeedback(id: string, feedbackId: string, input: StudioFeedbackUpdate): StudioFeedback {
    return this.mutate(id, system => {
      const feedback = system.feedback.find(f => f.id === uuid(feedbackId)); if (!feedback) fail('studio_feedback_not_found', 404);
      if (!['recorded', 'accepted', 'needs_material', 'revision_prepared', 'published_pending_use', 'verified', 'not_confirmed'].includes(input.status)) fail('invalid_studio_feedback_status');
      if (input.status === 'verified') {
        const evidence = input.verification;
        if (!evidence || !sources(evidence.sources).length || !text(evidence.result, 20_000, false) || !system.uses.some(use => {
          const assessment = use.assessments?.at(-1); if (!assessment || assessment.status !== 'pass') return false;
          const has = (refs: StudioSourceRef[], ref: StudioSourceRef) => refs.some(value => this.refIdentity(value) === this.refIdentity(ref));
          if (!has(evidence.sources, use.report) || !has(evidence.sources, assessment.report) || !use.sources.length) return false;
          if (use.sources.some(ref => !has(assessment.sources, ref) || !has(evidence.sources, ref)) || assessment.sources.some(ref => !has(use.sources, ref))) return false;
          const affected = feedback.sources.filter(ref => ref.authority === 'studio-source');
          if (!affected.length && !feedback.sources.some(ref => has(use.sources, ref))) return false;
          return affected.every(ref => { const asset = system.assets.find(value => value.id === ref.id), current = asset?.revisions.find(value => value.revision === asset.formalRevision); return current && !(asset?.issueHistory ?? []).some(issue => issue.affectedRevision === current.revision) && use.sources.some(value => value.authority === 'studio-source' && value.id === ref.id && value.version === String(current.revision) && value.sha256 === current.sha256); });
        })) fail('studio_feedback_use_evidence_required', 409);
        feedback.verification = { sources: sources(evidence.sources), result: text(evidence.result, 20_000, false) };
      }
      if (input.sources) { const extra = sources(input.sources); for (const ref of extra) if (!feedback.sources.some(r => this.refIdentity(r) === this.refIdentity(ref))) feedback.sources.push(ref); }
      feedback.status = input.status; feedback.response = text(input.response, 20_000, false); feedback.updatedAt = now(); return feedback;
    });
  }
  recordUse(id: string, input: Omit<StudioUseRecord, 'id' | 'createdAt' | 'assessments'>): StudioUseRecord {
    if (!['not_assessed', 'pass', 'fail', 'unknown'].includes(input.verification)) fail('invalid_studio_use_verification');
    return this.mutate(id, system => {
      const report = sourceRef(input.report); const projectId = identity(input.projectId), taskId = identity(input.taskId);
      if ((report.projectId && report.projectId !== projectId) || (report.taskId && report.taskId !== taskId)) fail('studio_use_owner_mismatch');
      const use: StudioUseRecord = { id: randomUUID(), projectId, taskId, sources: sources(input.sources), report, result: text(input.result), verification: input.verification, ...(input.graphSnapshotId ? { graphSnapshotId: identity(input.graphSnapshotId) } : {}), createdAt: now() };
      system.uses.push(use); return use;
    });
  }
  recordUseAssessment(id: string, useId: string, input: StudioUseAssessmentInput): StudioUseRecord {
    return this.mutate(id, system => {
      const use = system.uses.find(value => value.id === uuid(useId)); if (!use) fail('studio_use_not_found', 404);
      if (!['pass', 'fail', 'unknown'].includes(input.status)) fail('invalid_studio_use_assessment');
      const report = sourceRef(input.report); if ((report.projectId && report.projectId !== use.projectId) || (report.taskId && report.taskId !== use.taskId)) fail('studio_use_owner_mismatch');
      use.assessments ??= []; use.assessments.push({ status: input.status, report, sources: sources(input.sources), result: text(input.result, 20_000, false), at: now() }); return use;
    });
  }
  addTopic(id: string, input: Pick<StudioTopic, 'title' | 'goal' | 'scope'>): StudioTopic {
    return this.mutate(id, system => { const topic: StudioTopic = { id: randomUUID(), title: text(input.title, 200, false), goal: text(input.goal, 20_000, false), scope: text(input.scope), status: 'planned', progress: '', coverage: [], gaps: [] }; system.topics.push(topic); return topic; });
  }
  markAssetIssue(id: string, assetId: string, reason: string): StudioAsset {
    return this.mutate(id, system => { const asset = system.assets.find(a => a.id === uuid(assetId)); if (!asset || asset.formalRevision === null) fail('studio_asset_not_published', 404); asset.issue = { reason: text(reason, 20_000, false), confirmedAt: now(), affectedRevision: asset.formalRevision }; asset.issueHistory ??= []; asset.issueHistory.push(clone(asset.issue)); return asset; });
  }
  recordAdoption(id: string, input: Omit<StudioAdoption, 'at'>): StudioAdoption {
    if (!['succeeded', 'failed', 'unknown'].includes(input.status)) fail('invalid_studio_adoption');
    return this.mutate(id, system => { const record: StudioAdoption = { projectId: identity(input.projectId), refs: sources(input.refs), status: input.status, detail: text(input.detail), at: now() }; system.adoptions.push(record); return record; });
  }
  recordGraph(id: string, input: Omit<StudioGraphState, 'at'>): StudioGraphState {
    if (!['succeeded', 'failed', 'unknown'].includes(input.status)) fail('invalid_studio_graph');
    return this.mutate(id, system => {
      const record: StudioGraphState = { snapshotId: identity(input.snapshotId), sourceRefs: sources(input.sourceRefs), status: input.status, detail: text(input.detail), at: now() };
      if (system.graphs.some(g => g.snapshotId === record.snapshotId && (g.sourceRefs.length > 0 || g.status !== 'unknown') && digest(g.sourceRefs) !== digest(record.sourceRefs))) fail('studio_graph_identity_conflict', 409);
      system.graphs.push(record); return record;
    });
  }
  linkUsageProject(id: string, projectId: string, taskId?: string): StudioSystem {
    projectId = identity(projectId); if (taskId !== undefined) taskId = identity(taskId);
    return this.mutate(id, system => {
      if (!system.usageProjectIds.includes(projectId)) system.usageProjectIds.push(projectId);
      if (taskId !== undefined) { system.usageTasks ??= []; if (!system.usageTasks.some(owner => owner.projectId === projectId && owner.taskId === taskId)) system.usageTasks.push({ projectId, taskId }); }
      return system;
    });
  }
  selectGraphSnapshot(id: string, snapshotId: string): StudioSystem {
    snapshotId = uuid(snapshotId);
    return this.mutate(id, system => { if (!system.graphs.some(graph => graph.snapshotId === snapshotId && graph.status === 'succeeded')) fail('studio_graph_not_found', 404); system.selectedGraphSnapshotId = snapshotId; return system; });
  }
  list(): StudioSystem[] { return clone(this.load().systems); }
  get(id: string): StudioSystem { return clone(this.requireSystem(this.load(), id)); }
}

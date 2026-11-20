import { attachmentPage } from './strategy-attachment-document.ts';
import type { StrategyAttachments } from './strategy-attachments.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { SapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import type { ReadPersonalSource } from './personal-retention-types.ts';
import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import { learningSourceRef } from './learning-source-validation.ts';
import type { StrategyDiscussion, StrategyDiscussionSource } from './strategy-discussion-types.ts';
import { createHash } from 'node:crypto';
import { PROJECT_UPLOAD_MAX_BYTES } from './project-upload.ts';
import type { ProjectTaskResultSources } from './project-task-results-types.ts';
import { discussionSourceMode, isDiscussionSourceExcluded, isDiscussionSourceSelected } from './strategy-discussion-source-scope.ts';

export interface StrategyDiscussionSourceContext {
  signal?: AbortSignal;
  assertCurrent(): void;
  /** Host-only catalog phase; never accepted from tool/HTTP input. */
  metadataOnly?: boolean;
  /** Actual downstream owner, supplied by Host rather than a source locator. */
  receivingTask?: { projectId: string; taskId: string };
  receivingProjectId?: string;
  receivingGoal?: import('./strategy-goals-types.ts').GoalRef;
}
export interface StrategyDiscussionSourceRead { source: StrategyDiscussionSource; text: string; range: { start: number; end: number; total: number }; complete: boolean }
export class StrategyDiscussionSourceFault extends Error {
  code: string; status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
export interface StrategyDiscussionSourcesOptions<Configuration> {
  projects: Pick<ProjectStore, 'get' | 'tree' | 'captureFeedbackFile'>;
  data: Pick<ProjectDataContextStore, 'getIndex' | 'readDescription' | 'readCitationManifest' | 'readCitationEvidenceFile'>;
  attachments?: StrategyAttachments;
  teach?:ReturnType<typeof import('./strategy-teach-sources.ts').strategyTeachSources<Configuration>>;
  methods?: Pick<SapMethodStore, 'listPublished' | 'getPublished'>;
  enterprise?: Pick<EnterpriseMaterialsStore, 'referenceIndex' | 'readRevision'>;
  readSource?: ReadPersonalSource;
  listTaskSources?(projectId: string, context: StrategyDiscussionSourceContext, taskId?: string): Promise<ProjectTaskResultSources>;
  assertReadable(discussion: StrategyDiscussion, configuration: Configuration, target: Record<string, unknown>, context: StrategyDiscussionSourceContext): void | Promise<void>;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const canonicalSource = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonicalSource).join(',')}]` : record(value) ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalSource(value[key])}`).join(',')}}` : JSON.stringify(value);
/** A locator/hash tuple, not a permission or evidence-read receipt. */
export function createStrategyDiscussionSource(title: string, target: Record<string, unknown>, sha256: string, version: string | number): StrategyDiscussionSource {
  return { id: `strategy-source-${createHash('sha256').update(canonicalSource({ target, sha256, version })).digest('hex')}`, title, target, sha256, version };
}
/** Closed discussion facet over original Stores/readers, not an independent content or permission authority. */
export function createStrategyDiscussionSources<Configuration>(options: StrategyDiscussionSourcesOptions<Configuration>) {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const canonical = canonicalSource;
  const check = (context: StrategyDiscussionSourceContext) => { context.signal?.throwIfAborted(); context.assertCurrent(); };
  const fault = (code: string, status = 409): never => { throw new StrategyDiscussionSourceFault(code, status); };
  const qualify = async (discussion: StrategyDiscussion, configuration: Configuration, target: Record<string, unknown>, context: StrategyDiscussionSourceContext) => {
    check(context);
    try { await options.assertReadable(discussion, configuration, target, context); }
    catch { check(context); return fault('strategy_source_not_authorized', 403); }
    check(context);
  };
  const source = createStrategyDiscussionSource;
  const taskSources = (owner: Awaited<ReturnType<ProjectStore['get']>>, rows: ProjectTaskResultSources): StrategyDiscussionSource[] => [
    ...rows.reports.filter(value => value.projectId === owner.id && owner.tasks.some(task => task.id === value.taskId)).map(value => source(`${owner.tasks.find(task => task.id === value.taskId)!.name} · ${value.relativePath}`, { kind: 'task-report', ...value }, value.sha256, value.requestId)),
    ...rows.replies.filter(value => value.projectId === owner.id && owner.tasks.some(task => task.id === value.taskId)).map(value => source(`${owner.tasks.find(task => task.id === value.taskId)!.name} · 聊天成果`, { kind: 'task-native-reply', ...value }, value.sha256, value.requestId)),
  ];
  const valid = (value: StrategyDiscussionSource) => {
    if (!object(value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 500 || !object(value.target) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || (typeof value.version !== 'string' || !value.version || ['latest', 'current'].includes(value.version.toLowerCase())) && (!Number.isSafeInteger(value.version) || Number(value.version) < 1) || value.id !== source(value.title, value.target, value.sha256, value.version).id) return fault('strategy_source_reference_invalid', 400);
  };
  async function project(projectId: string, discussion: StrategyDiscussion, configuration: Configuration, context: StrategyDiscussionSourceContext) {
    await qualify(discussion, configuration, { kind: 'project-catalog', projectId }, context);
    const record = await options.projects.get(projectId); check(context);
    if (record.archivedAt !== null) return fault('strategy_source_not_authorized', 403);
    return record;
  }
  const documentTarget = (target: Record<string, unknown>) => {
    if (target.kind !== 'project-document' || typeof target.projectId !== 'string' || typeof target.uploadId !== 'string' || typeof target.path !== 'string' || !/^(020_clean|060_reports)\//.test(target.path) || target.path.split('/').some(part => !part || part === '.' || part === '..') || !/\.(md|txt|html?)$/i.test(target.path) || Object.keys(target).some(key => !['kind', 'projectId', 'uploadId', 'path'].includes(key))) return fault('strategy_source_not_authorized', 403);
    return { projectId: target.projectId, path: target.path, uploadId: target.uploadId };
  };
  const keys = (target: Record<string, unknown>, expected: string[]) => { if (Object.keys(target).some(key => !expected.includes(key))) return fault('strategy_source_not_authorized', 403); };
  const same = (actual: StrategyDiscussionSource, selected: StrategyDiscussionSource) => { if (canonical(actual) !== canonical(selected)) return fault('strategy_source_changed'); };
  async function resolve(value: StrategyDiscussionSource, discussion: StrategyDiscussion, configuration: Configuration, context: StrategyDiscussionSourceContext, verifying = false): Promise<{ source: StrategyDiscussionSource; text: string; fragment?: boolean }> {
    valid(value); await qualify(discussion, configuration, value.target, context);
    if(value.target.kind==='case-teach-review'&&options.teach){
      const found=await options.teach.read(discussion,configuration,context,value.target);check(context);same(found.source,value);
      return found;
    }
    if(value.target.kind==='strategy-attachment'&&options.attachments){
      await options.attachments.bytes(discussion,value);check(context);
      return {source:value,text:''};
    }
    if (value.target.kind === 'task-report' || value.target.kind === 'task-native-reply') {
      const target = value.target, report = target.kind === 'task-report';
      keys(target, report ? ['kind', 'projectId', 'taskId', 'requestId', 'sessionId', 'toolCallId', 'relativePath', 'sha256', 'bytes', 'nativeEntryId'] : ['kind', 'projectId', 'taskId', 'requestId', 'sessionId', 'messageId', 'sha256', 'bytes']);
      if (['projectId', 'taskId', 'requestId', 'sessionId'].some(key => typeof target[key] !== 'string') || !options.listTaskSources) return fault('strategy_source_reference_invalid', 400);
      const owner = await project(target.projectId as string, discussion, configuration, context), rows = await options.listTaskSources(target.projectId as string, context, target.taskId as string); check(context);
      const exact = taskSources(owner, rows).find(source => source.id === value.id);
      if (!exact) return fault('strategy_source_unavailable');
      same(exact, value);
      let text: string;
      if (report) {
        if (typeof target.relativePath !== 'string' || !/^(020_clean|060_reports)\//.test(target.relativePath) || target.relativePath.split('/').some(part => !part || part === '.' || part === '..')) return fault('strategy_source_not_authorized', 403);
        const captured = await options.projects.captureFeedbackFile(target.projectId as string, target.relativePath, PROJECT_UPLOAD_MAX_BYTES); check(context);
        if (captured.sha256 !== value.sha256 || captured.bytes.length !== target.bytes) return fault('strategy_source_changed');
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(captured.bytes); } catch { return fault('strategy_source_text_unavailable'); }
      } else {
        if (typeof target.messageId !== 'string' || !options.readSource) return fault('strategy_source_unavailable');
        const evidence = await options.readSource({ type: 'native-reply', projectId: target.projectId as string, taskId: target.taskId as string, sessionId: target.sessionId as string, messageId: target.messageId, expectedTextSha256: value.sha256 }, { signal: context.signal, audience: 'agent' }); check(context);
        if (evidence.status !== 'available' || evidence.text === null) return fault('strategy_source_unavailable');
        if (evidence.sha256 !== value.sha256 || Buffer.byteLength(evidence.text) !== target.bytes) return fault('strategy_source_changed');
        text = evidence.text;
      }
      await qualify(discussion, configuration, target, context);
      const after = await options.listTaskSources(target.projectId as string, context, target.taskId as string); check(context);
      if (!taskSources(owner, after).some(source => canonical(source) === canonical(value))) return fault('strategy_source_changed');
      return { source: exact, text };
    }
    if (value.target.kind === 'enterprise') {
      const target = value.target;
      keys(target, ['kind', 'storeId', 'materialId', 'revisionId']);
      if (['storeId', 'materialId', 'revisionId'].some(key => typeof target[key] !== 'string') || !options.enterprise) return fault('strategy_source_reference_invalid', 400);
      const index = await options.enterprise.referenceIndex({ readOnly: true }); check(context);
      const material = index.materials.find(material => material.materialId === target.materialId), revision = material?.revisions.find(revision => revision.revisionId === target.revisionId);
      if (index.storeId !== target.storeId || !material?.enabled || !revision) return fault('strategy_source_unavailable');
      const exact = source(revision.title, target, revision.bodySha256, revision.revisionId); same(exact, value);
      const content = await options.enterprise.readRevision(target.materialId as string, target.revisionId as string, { readOnly: true }); check(context);
      if (content.bodySha256 !== value.sha256) return fault('strategy_source_changed');
      const latest = await options.enterprise.referenceIndex({ readOnly: true }); check(context);
      if (latest.storeId !== target.storeId || !latest.materials.some(material => material.materialId === target.materialId && material.enabled)) return fault('strategy_source_unavailable');
      await qualify(discussion, configuration, target, context);
      return { source: exact, text: content.body };
    }
    if (value.target.kind === 'source') {
      keys(value.target, ['kind', 'source']);
      const original = learningSourceRef(value.target.source);
      if (!['native-reply', 'enterprise', 'citation'].includes(original.type) || original.type === 'citation' && original.target.type !== 'report' || !options.readSource) return fault('strategy_source_not_authorized', 403);
      const evidence = await options.readSource(original, { signal: context.signal, audience: 'agent' }); check(context);
      if (evidence.status !== 'available' || evidence.text === null || evidence.sha256 === null) return fault('strategy_source_unavailable');
      const version = original.type === 'native-reply' ? original.messageId : original.type === 'enterprise' ? original.revisionId : original.type === 'citation' ? original.citationId : '';
      const exact = source(evidence.title, value.target, evidence.sha256, version); same(exact, value);
      await qualify(discussion, configuration, value.target, context);
      return { source: exact, text: evidence.text, fragment: original.excerpt !== undefined };
    }
    if (value.target.kind === 'data-description') {
      const target = value.target;
      keys(target, ['kind', 'projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId']);
      if (['projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId'].some(key => typeof target[key] !== 'string')) return fault('strategy_source_reference_invalid', 400);
      await project(target.projectId as string, discussion, configuration, context);
      const index = await options.data.getIndex(target.projectId as string); check(context);
      const dataset = index?.datasets.find(dataset => dataset.datasetId === target.datasetId), ref = dataset?.descriptions.find(ref => ref.descriptionRevisionId === target.descriptionRevisionId && ref.inputVersionId === target.inputVersionId);
      if (!ref || !dataset) return fault('strategy_source_unavailable');
      const exact = source(`资料说明 · ${dataset.name} · ${ref.descriptionRevisionId}`, target, ref.recordSha256, ref.descriptionRevisionId); same(exact, value);
      const record = await options.data.readDescription(target.projectId as string, target.datasetId as string, target.descriptionRevisionId as string); check(context);
      if (record.inputVersionId !== target.inputVersionId) return fault('strategy_source_changed');
      await qualify(discussion, configuration, target, context);
      return { source: exact, text: JSON.stringify(record, null, 2) };
    }
    if (value.target.kind === 'citation-report') {
      const target = value.target;
      keys(target, ['kind', 'projectId', 'citationId', 'taskId']);
      if (typeof target.projectId !== 'string' || typeof target.citationId !== 'string' || target.taskId !== undefined && typeof target.taskId !== 'string') return fault('strategy_source_reference_invalid', 400);
      await project(target.projectId, discussion, configuration, context);
      const record = await options.data.readCitationManifest(target.projectId, target.citationId); check(context);
      if (record.nativeEvidence?.taskId !== target.taskId) return fault('strategy_source_changed');
      const exact = source(record.report.originalPath, target, record.report.sha256, record.citationId); same(exact, value);
      const captured = await options.data.readCitationEvidenceFile(target.projectId, target.citationId, null); check(context);
      if (captured.file.sha256 !== value.sha256) return fault('strategy_source_changed');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(captured.bytes); } catch { return fault('strategy_source_text_unavailable'); }
      await qualify(discussion, configuration, target, context);
      return { source: exact, text };
    }
    if (value.target.kind === 'sap-method') {
      const target = value.target;
      keys(target, ['kind', 'methodId', 'version', 'publishedHash']);
      if (typeof target.methodId !== 'string' || !Number.isSafeInteger(target.version) || Number(target.version) < 1 || target.publishedHash !== value.sha256 || !options.methods) return fault('strategy_source_reference_invalid', 400);
      const record = options.methods.getPublished(target.methodId, target.version as number); check(context);
      const exact = source(record.version.title, target, record.version.contentSha256, record.version.version); same(exact, value);
      if (record.issue?.status === 'confirmed' && !verifying) return fault('strategy_source_disabled');
      await qualify(discussion, configuration, target, context);
      return { source: exact, text: verifying ? '' : JSON.stringify(record.version, null, 2) };
    }
    const target = documentTarget(value.target), owner = await project(target.projectId, discussion, configuration, context);
    const upload = owner.uploads.find(upload => upload.id === target.uploadId && upload.path === target.path);
    if (!upload) return fault('strategy_source_unavailable');
    const exact = source(upload.originalName, value.target, upload.sha256, upload.uploadedAt);
    same(exact, value);
    const captured = await options.projects.captureFeedbackFile(target.projectId, target.path, PROJECT_UPLOAD_MAX_BYTES); check(context);
    if (captured.sha256 !== value.sha256) return fault('strategy_source_changed');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(captured.bytes); } catch { return fault('strategy_source_text_unavailable'); }
    await qualify(discussion, configuration, value.target, context);
    return { source: exact, text };
  }
  const facet = {
    async list(discussion: StrategyDiscussion, configuration: Configuration, context: StrategyDiscussionSourceContext, projectId = discussion.projectId): Promise<StrategyDiscussionSource[]> {
      context = { ...context, metadataOnly: true };
      check(context); if (!projectId) return [];
      const owner = await project(projectId, discussion, configuration, context), tree = await options.projects.tree(projectId, ['020_clean', '060_reports']); check(context);
      const files = new Set<string>();
      const visit = (nodes: Awaited<ReturnType<ProjectStore['tree']>>) => { for (const node of nodes) { if (node.kind === 'file') files.add(node.path); else visit(node.children ?? []); } };
      visit(tree);
      const result: StrategyDiscussionSource[] = [];
      for (const upload of owner.uploads) {
        if (!files.has(upload.path) || !/^(020_clean|060_reports)\/.+\.(md|txt|html?)$/i.test(upload.path)) continue;
        const target = { kind: 'project-document', projectId, path: upload.path, uploadId: upload.id };
        try { await qualify(discussion, configuration, target, context); } catch (error) { if (error instanceof StrategyDiscussionSourceFault && error.status === 403) continue; throw error; }
        result.push(source(upload.originalName, target, upload.sha256, upload.uploadedAt));
      }
      const index = await options.data.getIndex(projectId); check(context);
      for (const dataset of index?.datasets ?? []) for (const ref of dataset.descriptions) {
        const target = { kind: 'data-description', projectId, datasetId: dataset.datasetId, inputVersionId: ref.inputVersionId, descriptionRevisionId: ref.descriptionRevisionId };
        try { await qualify(discussion, configuration, target, context); } catch (error) { if (error instanceof StrategyDiscussionSourceFault && error.status === 403) continue; throw error; }
        result.push(source(`资料说明 · ${dataset.name} · ${ref.descriptionRevisionId}`, target, ref.recordSha256, ref.descriptionRevisionId));
      }
      for (const ref of index?.citations ?? []) {
        const preliminary = { kind: 'citation-report', projectId, citationId: ref.citationId };
        try {
          await qualify(discussion, configuration, preliminary, context);
          const record = await options.data.readCitationManifest(projectId, ref.citationId); check(context);
          const target = { ...preliminary, ...(record.nativeEvidence?.taskId ? { taskId: record.nativeEvidence.taskId } : {}) };
          await qualify(discussion, configuration, target, context);
          result.push(source(record.report.originalPath, target, record.report.sha256, record.citationId));
        } catch (error) { if (error instanceof StrategyDiscussionSourceFault && error.status === 403) continue; throw error; }
      }
      for (const method of options.methods?.listPublished() ?? []) {
        if (method.issue?.status === 'confirmed' || method.publishedVersion === null) continue;
        const preliminary = { kind: 'sap-method', methodId: method.id, version: method.publishedVersion };
        try { await qualify(discussion, configuration, preliminary, context); } catch (error) { if (error instanceof StrategyDiscussionSourceFault && error.status === 403) continue; throw error; }
        const record = options.methods!.getPublished(method.id, method.publishedVersion), target = { ...preliminary, publishedHash: record.version.contentSha256 };
        try { await qualify(discussion, configuration, target, context); } catch (error) { if (error instanceof StrategyDiscussionSourceFault && error.status === 403) continue; throw error; }
        result.push(source(record.version.title, target, record.version.contentSha256, method.publishedVersion));
      }
      if (options.enterprise) {
        // A normal project need not have an enterprise directory. Absence of
        // this optional authority is distinct from denial/corruption, and must
        // not block independent uploads or Task results. Exact reads below
        // still use the original authority and retain its missing/error state.
        const index = await options.enterprise.referenceIndex({ readOnly: true }).catch(error => {
          check(context);
          if ((error as { code?: unknown })?.code === 'enterprise_source_missing') return null;
          throw error;
        }); check(context);
        for (const material of index?.materials ?? []) {
          if (!material.enabled) continue;
          const revision = material.revisions.find(revision => revision.revisionId === material.activeRevisionId); if (!revision) continue;
          const target = { kind: 'enterprise', storeId: index!.storeId, materialId: material.materialId, revisionId: revision.revisionId };
          try { await qualify(discussion, configuration, target, context); } catch (error) { if (error instanceof StrategyDiscussionSourceFault && error.status === 403) continue; throw error; }
          result.push(source(revision.title, target, revision.bodySha256, revision.revisionId));
        }
      }
      if (options.listTaskSources) {
        const rows = await options.listTaskSources(projectId, context); check(context);
        for (const value of taskSources(owner, rows)) {
          try { await qualify(discussion, configuration, value.target, context); } catch (error) { if (error instanceof StrategyDiscussionSourceFault && error.status === 403) continue; throw error; }
          result.push(value);
        }
      }
      if(options.teach)result.push(...await options.teach.list(discussion,configuration,context));
      const authorized: StrategyDiscussionSource[] = [];
      for (const value of result) {
        try { await qualify(discussion, configuration, value.target, context); authorized.push(value); }
        catch (error) { if (!(error instanceof StrategyDiscussionSourceFault && error.status === 403)) throw error; }
      }
      await qualify(discussion, configuration, { kind: 'project-catalog', projectId }, context);
      return authorized;
    },
    async read(value: StrategyDiscussionSource, discussion: StrategyDiscussion, configuration: Configuration, context: StrategyDiscussionSourceContext, page: { offset?: number; limit?: number; locator?: string } = {}): Promise<StrategyDiscussionSourceRead> {
      check(context);
      if (isDiscussionSourceExcluded(discussion, value)) return fault('strategy_source_excluded', 403);
      if (!(value.target.kind==='strategy-attachment' ? isDiscussionSourceSelected(discussion,value) : discussion.sources.some(selected => canonical(selected) === canonical(value)))) {
        if (discussionSourceMode(discussion) !== 'project-background' || !discussion.projectId) return fault('strategy_source_not_selected', 403);
        valid(value);
        await qualify(discussion, configuration, value.target, context);
        const catalog = await facet.list(discussion, configuration, context); check(context);
        const current = catalog.find(source => source.id === value.id);
        if (!current) return fault('strategy_source_unavailable');
        same(current, value);
      }
      const offset = page.offset ?? 0, limit = page.limit ?? 8192;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32768) return fault('strategy_source_page_invalid', 400);
      if(value.target.kind==='strategy-attachment'&&options.attachments){
        valid(value);await qualify(discussion,configuration,value.target,context);
        const notes=await options.attachments.notes(discussion,value);
        await qualify(discussion,configuration,value.target,context);
        return attachmentPage(value,notes,page);
      }
      const resolved = await resolve(value, discussion, configuration, context), end = Math.min(offset + limit, resolved.text.length);
      if (offset > resolved.text.length) return fault('strategy_source_page_invalid', 400);
      return { source: resolved.source, text: resolved.text.slice(offset, end), range: { start: offset, end, total: resolved.text.length }, complete: !resolved.fragment && offset === 0 && end === resolved.text.length };
    },
    async verify(discussion: StrategyDiscussion, configuration: Configuration, context: StrategyDiscussionSourceContext, projection: readonly StrategyDiscussionSource[] = discussion.sources): Promise<void> {
      check(context);
      for (const value of projection) {
        if (context.metadataOnly) {
          valid(value);
          await qualify(discussion, configuration, value.target, context);
          if(value.target.kind==='case-teach-review')await resolve(value,discussion,configuration,context,true);
        } else await resolve(value, discussion, configuration, context, true);
      }
      check(context);
    },
  };
  return facet;
}

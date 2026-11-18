import type { RuntimeModelConfiguration } from './config-store.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { createDbLinkHost } from './db-link-host.ts';
import type { SemanticTarget } from '../../extensions/business-plugins/semantic-context/types.ts';
import type { StrategyDiscussion } from './strategy-discussion-types.ts';
import { StrategyDiscussionSourceFault, type StrategyDiscussionSourceContext } from './strategy-discussion-sources.ts';
import { dbLinkModelOutlet } from './db-link-planning.ts';
import type { ProjectDataContextSelection } from './project-data-context-types.ts';

export interface StrategyDiscussionSourcePermissionOptions {
  projects: Pick<ProjectStore, 'get' | 'getTask'>;
  data: Pick<ProjectDataContextStore, 'readVersion' | 'readDescription' | 'readCitationManifest'>;
  dbLinks?: Pick<ReturnType<typeof createDbLinkHost>, 'planningSources' | 'resultManifestSource' | 'metadataReader'>;
  enterpriseSourceAllowed(projectId: string, target: SemanticTarget): boolean | Promise<boolean>;
  isClosing(): boolean;
}
/** Reuses original owner, enterprise and DB grant/outlet readers; has no grants or persistence of its own. */
export function createStrategyDiscussionSourcePermissions(options: StrategyDiscussionSourcePermissionOptions) {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const deny = (): never => { throw new StrategyDiscussionSourceFault('strategy_source_not_authorized', 403); };
  return async <D extends Pick<StrategyDiscussion, 'projectId' | 'configurationId' | 'configurationRevision'>>(discussion: D, configuration: RuntimeModelConfiguration, target: Record<string, unknown>, context: StrategyDiscussionSourceContext): Promise<void> => {
    const check = () => { context.signal?.throwIfAborted(); context.assertCurrent(); if (options.isClosing()) deny(); };
    check();
    if (configuration.id !== discussion.configurationId || configuration.revision !== discussion.configurationRevision) deny();
    const projectId = discussion.projectId;
    const owner = async (id: string, taskId?: string) => {
      if (!projectId || id !== projectId) deny();
      const project = await options.projects.get(id); check(); if (project.archivedAt !== null) deny();
      if (taskId !== undefined) { await options.projects.getTask(id, taskId); check(); }
      return project;
    };
    const shared = async (ref: SemanticTarget, scopeProject = projectId) => { if (!scopeProject || !await options.enterpriseSourceAllowed(scopeProject, ref)) deny(); check(); };
    const knownDatabase = async (value: unknown, id: string) => {
      if (!object(value) || value.kind !== 'db-link-structure-source') return;
      if (!options.dbLinks || !object(value.owner) || !object(value.source) || value.owner.projectId !== id || typeof value.owner.taskId !== 'string' || typeof value.owner.requestId !== 'string' || typeof value.owner.operationId !== 'string' || typeof value.sourceId !== 'string' || typeof value.source.connectionId !== 'string' || !Number.isSafeInteger(value.source.connectionRevision) || typeof value.source.sourceIdentity !== 'string' || !['query-result', 'metadata-observation'].includes(value.sourceKind as string)) deny();
      const originalOwner = value.owner as Record<string, unknown>, originalSource = value.source as Record<string, unknown>;
      await owner(id, originalOwner.taskId as string);
      if (context.receivingTask) {
        if (context.receivingTask.projectId !== id) deny();
        await owner(id, context.receivingTask.taskId);
      }
      const current = async () => {
        const taskIds = [...new Set([originalOwner.taskId as string, ...(context.receivingTask ? [context.receivingTask.taskId] : [])])];
        let permitted: Awaited<ReturnType<NonNullable<typeof options.dbLinks>['planningSources']>>[number] | undefined;
        for (const taskId of taskIds) {
          const rows = await options.dbLinks!.planningSources(id, { taskId, modelOutlet: dbLinkModelOutlet(configuration) }); check();
          const source = rows.find(source => source.id === `db-link:${originalSource.connectionId}`);
          if (!source?.enabled || source.state !== 'available' || source.version !== String(originalSource.connectionRevision) || !source.scope || !source.modelExport.structure) return deny();
          if (!permitted) { permitted = source; continue; }
          const originalObjects = permitted.scope!.objects, receivingObjects = source.scope.objects;
          const objects = originalObjects.includes('*') ? receivingObjects : receivingObjects.includes('*') ? originalObjects : originalObjects.filter(name => receivingObjects.includes(name));
          permitted = { ...permitted, scope: { ...permitted.scope!, objects }, modelExport: { ...permitted.modelExport,
            structure: permitted.modelExport.structure && source.modelExport.structure,
            comments: permitted.modelExport.comments && source.modelExport.comments,
            queryText: permitted.modelExport.queryText && source.modelExport.queryText,
            results: permitted.modelExport.results && source.modelExport.results,
          } };
        }
        return permitted!;
      };
      let allowed = await current();
      if (value.sourceKind === 'query-result') {
        if (!allowed.modelExport.results || !allowed.modelExport.queryText) deny();
        const metadata = await options.dbLinks!.resultManifestSource(id, originalOwner.taskId as string, value.sourceId as string, configuration, context); check();
        const source = metadata.manifest.source, outlet = source.modelExport;
        if (metadata.manifest.owner.projectId !== id || metadata.manifest.owner.taskId !== originalOwner.taskId || metadata.manifest.owner.requestId !== originalOwner.requestId || metadata.manifest.owner.operationId !== originalOwner.operationId || source.connectionId !== originalSource.connectionId || source.connectionRevision !== originalSource.connectionRevision || source.sourceIdentity !== originalSource.sourceIdentity || !outlet?.structure || !outlet.queryText || !outlet.results || !outlet.targets.includes(dbLinkModelOutlet(configuration))) deny();
        allowed = await current();
        if (!allowed.modelExport.results || !allowed.modelExport.queryText) deny();
        if (!allowed.scope!.objects.includes('*') && [...source.observedObjects, ...source.declaredObjects, ...source.unknownObjects].some(name => !allowed.scope!.objects.includes(name))) deny();
      } else {
        if (typeof originalOwner.requestId !== 'string' || typeof originalOwner.operationId !== 'string') deny();
        const metadata = await options.dbLinks!.metadataReader.read({ projectId: id, taskId: originalOwner.taskId as string, requestId: originalOwner.requestId as string, operationId: originalOwner.operationId as string }, value.sourceId as string); check();
        if (metadata.observation.id !== value.sourceId || metadata.observation.owner.requestId !== originalOwner.requestId || metadata.observation.owner.operationId !== originalOwner.operationId || metadata.observation.source.connectionId !== originalSource.connectionId || metadata.observation.source.connectionRevision !== originalSource.connectionRevision || metadata.observation.source.sourceIdentity !== originalSource.sourceIdentity) deny();
        allowed = await current();
        // This is the original driver's canonical object key (schema.name),
        // not a new inference about report or business lineage.
        if (!allowed.scope!.objects.includes('*') && metadata.observation.objects.some(item => !allowed.scope!.objects.includes(`${item.schema}.${item.name}`))) deny();
        if (!allowed.modelExport.comments && metadata.observation.objects.some(item => item.comment !== undefined || item.columns.some(column => column.comment !== undefined))) deny();
      }
      await current();
    };
    const input = async (id: string, selection: ProjectDataContextSelection) => {
      const version = await options.data.readVersion(id, selection.datasetId, selection.inputVersionId); check();
      let note: unknown;
      if (version.sourceNote) { try { note = JSON.parse(version.sourceNote); } catch { /* ordinary user notes are not DB source declarations */ } }
      await knownDatabase(note, id);
      if (selection.descriptionRevisionId && !context.metadataOnly) {
        const description = await options.data.readDescription(id, selection.datasetId, selection.descriptionRevisionId); check();
        if (description.inputVersionId !== selection.inputVersionId) deny();
        if (description.observation.nativeEvidence?.taskId) await owner(id, description.observation.nativeEvidence.taskId);
        for (const mapping of description.mappings) {
          for (const ref of mapping.conceptRefs) await shared({ kind: 'enterprise', ...ref }, id);
          for (const ref of mapping.sapRefs) await shared({ kind: 'sap', ...ref }, id);
        }
        const declaredDatabase = [...description.observation.fields.map(field => field.location), ...description.mappings.map(mapping => mapping.location), ...description.statements.flatMap(statement => statement.location ? [statement.location] : [])].some(location => location.kind === 'json-pointer' && location.database !== undefined);
        if (declaredDatabase && (!object(note) || note.kind !== 'db-link-structure-source')) deny();
      }
    };
    const citation = async (id: string, citationId: string, claimedTask?: string) => {
      const record = await options.data.readCitationManifest(id, citationId); check();
      if (claimedTask !== undefined && record.nativeEvidence?.taskId !== claimedTask) deny();
      if (record.nativeEvidence?.taskId) await owner(id, record.nativeEvidence.taskId);
      for (const selection of record.selections) await input(id, selection);
      for (const ref of record.conceptRefs) await shared({ kind: 'enterprise', ...ref }, id);
      for (const ref of record.sapRefs) await shared({ kind: 'sap', ...ref }, id);
    };
    if (target.kind === 'source') {
      if (!object(target.source)) deny();
      const source = target.source as Record<string, unknown>;
      if (source.type === 'enterprise') await shared({ kind: 'enterprise', storeId: source.storeId as string, materialId: source.materialId as string, revisionId: source.revisionId as string });
      else if (source.type === 'native-reply') {
        if (typeof source.projectId !== 'string' || typeof source.taskId !== 'string') deny();
        await owner(source.projectId as string, source.taskId as string);
      } else if (source.type === 'citation') {
        if (typeof source.projectId !== 'string' || typeof source.citationId !== 'string' || !object(source.target) || source.target.type !== 'report') deny();
        await owner(source.projectId as string); await citation(source.projectId as string, source.citationId as string);
      } else deny();
    } else if (target.kind === 'enterprise' || target.kind === 'sap-method' || target.kind === 'sap') await shared(target as SemanticTarget);
    else {
      if (typeof target.projectId !== 'string') deny();
      const project = await owner(target.projectId as string, typeof target.taskId === 'string' ? target.taskId : undefined);
      if (target.kind === 'task-report' || target.kind === 'task-native-reply') {
        if (typeof target.taskId !== 'string' || typeof target.requestId !== 'string' || typeof target.sessionId !== 'string') deny();
        // Exact completed-run/report identity and original source governance
        // are checked by listTaskResultSources/readPersonalSource in the facet.
      } else if (target.kind === 'project-document') {
        if (!project.uploads.some(upload => upload.id === target.uploadId && upload.path === target.path)) deny();
      } else if (target.kind === 'data-input') {
        if (typeof target.datasetId !== 'string' || typeof target.inputVersionId !== 'string') deny();
        await input(target.projectId as string, { datasetId: target.datasetId as string, inputVersionId: target.inputVersionId as string, descriptionRevisionId: null });
      } else if (target.kind === 'data-description') {
        if (typeof target.datasetId !== 'string' || typeof target.inputVersionId !== 'string' || typeof target.descriptionRevisionId !== 'string') deny();
        await input(target.projectId as string, { datasetId: target.datasetId as string, inputVersionId: target.inputVersionId as string, descriptionRevisionId: target.descriptionRevisionId as string });
      } else if (target.kind === 'citation-report') {
        if (typeof target.citationId !== 'string') deny();
        await citation(target.projectId as string, target.citationId as string, target.taskId as string | undefined);
      } else if (target.kind !== 'project-catalog') deny();
    }
    check();
  };
}

import type { SemanticContextPort, SemanticContextReadPort } from '../agent/semantic-context.ts';
import type { createSemanticGraphService } from './semantic-graph-service.ts';
import type { SemanticQueryInput } from '../../extensions/business-plugins/semantic-context/types.ts';
import { SemanticContextFault, type SemanticContextService } from './semantic-context-service.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { CreateDataCitation } from './project-data-context-types.ts';

/** A Host-bound read facet. Managed ordinary receives graph only, never M2 writes. */
export function createSemanticContextReadPort(options: {
  projectId: string; taskId: string; projects: ProjectStore; legacy: SemanticContextPort;
  graph: ReturnType<typeof createSemanticGraphService>; graphOnly: boolean; isClosing: () => boolean;
}): SemanticContextReadPort {
  return async (action, input, context) => {
    const assertCurrent = () => {
      context.signal.throwIfAborted(); context.assertCurrent();
      if (options.isClosing()) throw new SemanticContextFault('semantic_context_run_unavailable', 409);
    };
    assertCurrent(); await options.projects.getTask(options.projectId, options.taskId); assertCurrent();
    if (action !== 'graph') {
      if (options.graphOnly || !['find', 'read', 'trace'].includes(action)) throw new SemanticContextFault('semantic_context_read_not_authorized', 403);
      return options.legacy(action, input, { ...context, assertCurrent });
    }
    const result = await options.graph.query(options.projectId, options.taskId, { ...input, action: 'graph' }, { ...context, assertCurrent });
    assertCurrent();
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
  };
}

/** Owner-qualified access to existing business records, never an analysis step. */
export function createSemanticContextPort(options: {
  projectId: string; taskId: string; projects: ProjectStore; data: ProjectDataContextStore;
  reader: SemanticContextService; mutate: <T>(operation: () => Promise<T>) => Promise<T>; isClosing: () => boolean;
}): SemanticContextPort {
  return async (action, input, context) => {
    const assertCurrent = () => {
      context.signal.throwIfAborted(); context.assertCurrent();
      if (options.isClosing()) throw new SemanticContextFault('semantic_context_run_unavailable', 409);
    };
    assertCurrent(); await options.projects.getTask(options.projectId, options.taskId); assertCurrent();
    if (action !== 'record') {
      const result = await options.reader.query(options.projectId, options.taskId, { ...input, action } as SemanticQueryInput,
        { signal: context.signal, audience: 'agent', assertCurrent });
      assertCurrent();
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    }
    if (Object.keys(input).some(key => !['operationId', 'citationId', 'baseIndexRevision', 'report', 'attachments', 'selections', 'conceptRefs', 'sapRefs', 'declaration', 'revisionReason', 'nativeEvidence'].includes(key))) throw new SemanticContextFault('semantic_context_invalid_source_declaration');
    const evidence = input.nativeEvidence as CreateDataCitation['nativeEvidence'];
    if (evidence && (evidence.taskId !== options.taskId || evidence.nativeSessionId !== context.sessionId)) throw new SemanticContextFault('semantic_context_native_owner_mismatch', 403);
    return options.mutate(async () => {
      assertCurrent();
      const project = await options.projects.get(options.projectId); assertCurrent();
      if (project.archivedAt !== null) throw new SemanticContextFault('semantic_context_project_archived', 409);
      // Exactly the original M2 store and byte/CAS/operation contract. An
      // in-flight interrupted write may remain UNKNOWN; it is never replayed.
      const saved = await options.data.createCitation(options.projectId, { ...input, declarer: 'agent' } as unknown as CreateDataCitation, { assertWritable: assertCurrent });
      assertCurrent();
      const details = { schemaVersion: 1 as const, type: 'optracall.analysis-sources-recorded' as const, claim: 'author-declaration-not-verification' as const,
        projectId: options.projectId, citationId: saved.record.citationId, operationId: saved.record.operationId, indexRevision: saved.indexRevision,
        replayed: saved.replayed, publishedOnRetry: saved.publishedOnRetry,
        report: { originalPath: saved.record.report.originalPath, sha256: saved.record.report.sha256, bytes: saved.record.report.bytes } };
      return { content: [{ type: 'text', text: `来源记录已保存；仅为Agent作者明确声明，不证明实际计算采用或专业正确。${JSON.stringify(details)}` }], details };
    });
  };
}

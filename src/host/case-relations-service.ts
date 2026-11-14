import { CaseStoreError, type CaseStore } from './case-store.ts';
import type { ProjectStore, ProjectRecord } from './project-store.ts';
import type { CaseDecisionAgentContext } from './case-decision-service.ts';
import type { CaseArtifactRecord } from './case-types.ts';
import type { CaseRelationListOptions, CaseRelationRevision, CaseRelationSource, CaseRelationSourceView, CaseRelationWriteInput, CaseRelationSourceCandidate } from './case-relation-types.ts';
import { parseCaseRelationWrite, relationFields, relationWriteFields } from './case-relation-validation.ts';
import { caseDecisionId, caseDecisionRevision, parseCaseDecisionRef } from './case-decision-validation.ts';
import { canonical } from './project-data-context-io.ts';
import { createCaseSourcesService } from './case-sources-service.ts';
import { createHash } from 'node:crypto';

export type CaseRelationsServiceDependencies = {
  cases: CaseStore; projects: Pick<ProjectStore, 'get' | 'getTask'>;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>; assertActive: (project: ProjectRecord) => void;
  enterpriseScope?: { caseEnterpriseId: (caseId: string) => string | undefined; projectEnterpriseId: (projectId: string) => string | undefined };
  readArtifact?: (artifact: CaseArtifactRecord, signal?: AbortSignal) => Promise<{ text: string | null; sha256: string | null; status?: 'available' | 'unknown' | 'changed'; limitations?: string[] }>;
};
export type CaseRelationAgentContext = CaseDecisionAgentContext;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const human = { actorKind: 'user' as const, projectId: null, taskId: null, requestId: null, sessionId: null, toolCallId: null };
const limitations = ['关系为原作者声明，不证明因果、已执行或业务效果。'];
const current = (context: CaseRelationAgentContext) => { context.signal.throwIfAborted(); context.assertCurrent(); };
function relationPage(options: CaseRelationListOptions) {
  if (options.continuation !== undefined && options.continuation !== null && (typeof options.continuation !== 'string' || options.continuation.length > 4000)) throw new CaseStoreError('invalid_case_relation_page');
  return options;
}

/** The graph is a projection of the existing Case authority, not a second store. */
export function createCaseRelationsService(deps: CaseRelationsServiceDependencies) {
  const caseSources = createCaseSourcesService(deps);
  function scope(caseId: string, referencedProjectIds: string[] = []) {
    if (!deps.enterpriseScope) return undefined;
    const ids = [deps.enterpriseScope.caseEnterpriseId(caseId), ...[...deps.cases.listProjectLinks(caseId).map(link => link.projectId), ...referencedProjectIds].map(id => deps.enterpriseScope!.projectEnterpriseId(id))].filter((id): id is string => id !== undefined);
    if (new Set(ids).size > 1) throw new CaseStoreError('case_enterprise_conflict', 409);
    return ids[0];
  }
  function referencedProjects(refs: CaseRelationSource[]): string[] {
    return refs.flatMap(ref => deps.cases.getRelationSourceProjectIds(ref));
  }
  function compatible(from: string, to: string, sources: CaseRelationSource[] = [], targetRef: CaseRelationRevision['targetRef'] = null) {
    const a = scope(from, referencedProjects(sources)), b = scope(to, targetRef ? referencedProjects([targetRef]) : []);
    if (a !== undefined && b !== undefined && a !== b) throw new CaseStoreError('case_enterprise_conflict', 409);
  }
  function readable(relation: CaseRelationRevision) {
    try { deps.cases.getCase(relation.fromCaseId); deps.cases.getCase(relation.toCaseId); compatible(relation.fromCaseId, relation.toCaseId, relation.sources, relation.targetRef); return true; }
    catch { return false; }
  }
  function visible(relation: CaseRelationRevision) {
    if (readable(relation)) return { ...relation, restricted: false };
    return { ...relation, explanation: '关系来源范围已变化，内容暂不可用。', targetScope: '受限', changeReason: null, targetRef: null, sources: [], origin: { ...human, actorKind: relation.origin.actorKind }, restricted: true };
  }
  function list(options: CaseRelationListOptions = {}) {
    const value = deps.cases.listRelations(relationPage(options));
    return { ...value, items: value.items.map(visible), writingEnabled: deps.cases.isRelationWritingEnabled() && deps.cases.getStatus().state === 'ready' };
  }
  function owned(toCaseId: string, relationId: string, revision?: number) {
    deps.cases.getCase(toCaseId);
    const value = deps.cases.getRelation(caseDecisionId(relationId), revision);
    if (value.toCaseId !== toCaseId) throw new CaseStoreError('case_relation_owner_mismatch', 409);
    return value;
  }
  function operation(toCaseId: string, operationId: string) {
    deps.cases.getCase(toCaseId);
    const value = deps.cases.getOperation(operationId);
    if (value && (value.caseId !== toCaseId || value.kind !== 'case_relation_save')) throw new CaseStoreError('case_relation_operation_not_found', 404);
    return { operation: value && value.result ? { ...value, result: visible(value.result as CaseRelationRevision) } : value };
  }
  function artifact(ref: Extract<CaseRelationSource, { type: 'case-artifact' }>) {
    const value = deps.cases.getArtifacts(ref.caseId, { includeUnlinked: true }).find(item => item.id === ref.artifactId);
    if (!value) throw new CaseStoreError('case_relation_source_missing', 404);
    return value;
  }
  async function source(ref: CaseRelationSource, signal?: AbortSignal): Promise<CaseRelationSourceView> {
    signal?.throwIfAborted();
    if (ref.caseStoreId !== deps.cases.getStatus().storeId) throw new CaseStoreError('case_relation_source_mismatch', 409);
    if (ref.type === 'case-artifact') {
      const value = artifact(ref), title = value.displayName || value.relativePath;
      try {
        await deps.projects.get(value.projectId); signal?.throwIfAborted();
        if (!deps.readArtifact) return { ref, title, status: 'unknown', text: null, limitations: [...limitations, '当前只有原文件引用与观察信息；未读取正文。'] };
        const actual = await deps.readArtifact(value, signal); signal?.throwIfAborted();
        const changed = ref.observedSha256 !== null && actual.sha256 !== null && actual.sha256 !== ref.observedSha256;
        return { ref, title, status: changed ? 'changed' : actual.status ?? (actual.text === null ? 'unknown' : 'available'), text: changed ? null : actual.text,
          limitations: [...limitations, ...(actual.limitations ?? []), ...(changed ? ['当前文件已变化，原观察哈希保留；当前字节不是当时观察版。'] : ref.observedSha256 === null ? ['未保存可靠观察哈希，引用当前文件，内容可能变化。'] : []), '引用及观察不代表已保存旧文件字节。'] };
      } catch (error) { signal?.throwIfAborted(); return { ref, title, status: 'unknown', text: null, limitations: [...limitations, '准确文件暂不可读，保留原引用，不替换文件或版本。'] }; }
    }
    const evidence = await caseSources.readPersonalSource(ref, { signal });
    const currentRevision = evidence.caseGovernance?.currentRevision;
    return { ref, title: evidence.title, status: 'available', text: evidence.text,
      ...(currentRevision == null ? {} : { currentRevision }), limitations: [...limitations, ...(ref.type === 'case-decision' && currentRevision != null && currentRevision !== ref.revision ? ['已有新修订；本关系仍引用原准确版，未判断新修订是否影响关系。'] : [])] };
  }

  async function read(toCaseId: string, relationId: string, revision?: number) {
    const value = owned(toCaseId, relationId, revision), head = owned(toCaseId, relationId);
    const history = deps.cases.listRelationRevisions(relationId);
    if (!readable(value)) return { revision: visible(value), current: { revision: head.revision, lifecycle: head.lifecycle }, sources: [], target: null, history: history.items.map(visible), historyContinuation: history.continuation };
    const sources: CaseRelationSourceView[] = [];
    for (const ref of value.sources) {
      try { sources.push(await source(ref)); }
      catch { sources.push({ ref, title: '准确来源暂不可读', status: 'unknown', text: null, limitations: [...limitations, '准确身份保留，未换为latest。'] }); }
    }
    let target: CaseRelationSourceView | null = null;
    if (value.targetRef) {
      try { target = await source(value.targetRef); }
      catch { target = { ref: value.targetRef, title: '准确目标暂不可读', status: 'unknown', text: null, limitations }; }
    }
    if (!readable(value)) return { revision: visible(value), current: { revision: head.revision, lifecycle: head.lifecycle }, sources: [], target: null, history: history.items.map(visible), historyContinuation: history.continuation };
    return { revision: visible(value), current: { revision: head.revision, lifecycle: head.lifecycle }, sources, target, history: history.items.map(visible), historyContinuation: history.continuation };
  }
  function history(toCaseId: string, relationId: string, options: { pageSize?: number; continuation?: string | null }) {
    owned(toCaseId, relationId);
    const result = deps.cases.listRelationRevisions(relationId, options);
    return { ...result, items: result.items.map(visible) };
  }
  function sources(caseId: string, options: { pageSize?: number; continuation?: string | null } = {}) {
    deps.cases.getCase(caseId); scope(caseId);
    const caseStoreId = deps.cases.getStatus().storeId!, pageSize = options.pageSize ?? 50;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || options.continuation && options.continuation.length > 4000) throw new CaseStoreError('invalid_case_relation_page');
    const artifacts: CaseRelationSourceCandidate[] = deps.cases.getArtifacts(caseId, { includeUnlinked: true }).map(value => ({
      ref: { type: 'case-artifact', caseStoreId, caseId, artifactId: value.id, observedSha256: value.observedSha256 },
      title: value.displayName || value.relativePath, status: 'unknown', kind: 'artifact',
    }));
    const marker = sha(canonical([deps.cases.getDecisionSourceDirectoryMarker(caseId), artifacts])), scopeKey = caseId + ':' + caseStoreId;
    let offset = 0, phase: 'decisions' | 'artifacts' = 'decisions';
    if (options.continuation) {
      try {
        const cursor = JSON.parse(Buffer.from(options.continuation, 'base64url').toString('utf8'));
        if (cursor.scope !== scopeKey || cursor.marker !== marker || !['decisions', 'artifacts'].includes(cursor.phase) || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error();
        offset = cursor.offset; phase = cursor.phase;
      } catch { throw new CaseStoreError('case_relation_continuation_changed', 409); }
    }
    const items: CaseRelationSourceCandidate[] = [];
    // The original directory is bounded to 51 entries per SQL read. Keep its offset
    // in the cursor rather than cutting the directory down to its first batch.
    while (phase === 'decisions' && items.length < pageSize) {
      const take = Math.min(50, pageSize - items.length);
      const entries = deps.cases.listDecisionSourceEntries({ caseId, query: '', includeArchived: true, offset, pageSize: take + 1 });
      items.push(...entries.slice(0, take).map(item => ({ ref: item.target, title: item.title, status: 'available' as const, kind: item.target.type === 'case-choice' ? 'choice' as const : 'decision' as const })));
      offset += Math.min(entries.length, take);
      if (entries.length <= take) { phase = 'artifacts'; offset = 0; }
    }
    if (phase === 'artifacts') {
      const page = artifacts.slice(offset, offset + pageSize - items.length);
      items.push(...page); offset += page.length;
    }
    for (const item of items) {
      try { scope(caseId, referencedProjects([item.ref])); }
      catch { item.title = '来源范围已变化，当前不可用'; item.status = 'unknown'; }
    }
    const hasMore = phase === 'decisions' || offset < artifacts.length;
    return { items, hasMore, continuation: hasMore ? Buffer.from(JSON.stringify({ scope: scopeKey, marker, phase, offset })).toString('base64url') : null };
  }

  function validateSourceProjects(command: CaseRelationWriteInput) {
    const previous = command.relationId ? deps.cases.getRelation(command.relationId) : undefined;
    compatible(command.fromCaseId ?? previous?.fromCaseId ?? '', command.toCaseId,
      command.sources ?? previous?.sources ?? [], command.targetRef === undefined ? previous?.targetRef ?? null : command.targetRef);
  }
  async function saveUser(toCaseId: string, input: unknown, relationId?: string) {
    relationFields(input, relationWriteFields.filter(key => !['toCaseId', 'relationId'].includes(key)), ['operationId', 'caseStoreId', 'expectedRelationRevision']);
    const command = parseCaseRelationWrite({ ...input, toCaseId, ...(relationId ? { relationId } : {}) });
    return deps.mutate(() => {
      if (!deps.cases.getOperation(command.operationId)) validateSourceProjects(command);
      return visible(deps.cases.saveRelation(command, human, { assertWritable: () => validateSourceProjects(command) }));
    });
  }
  async function agentOwner(context: CaseRelationAgentContext) {
    current(context);
    if (deps.cases.getStatus().storeId !== context.caseStoreId) throw new CaseStoreError('case_relation_store_mismatch', 409);
    deps.cases.getCase(context.caseId);
    if (!deps.cases.listProjectLinks(context.caseId).some(link => link.projectId === context.projectId)) throw new CaseStoreError('project_not_linked', 409);
    const project = await deps.projects.get(context.projectId); current(context); deps.assertActive(project);
    await deps.projects.getTask(context.projectId, context.taskId); current(context);
  }
  async function readForAgent(input: unknown, context: CaseRelationAgentContext) {
    relationFields(input, ['relationId', 'revision', 'includeUnlinked', 'kind', 'pageSize', 'continuation', 'sourceIndex']);
    relationPage({ continuation: input.continuation as string | null | undefined });
    await agentOwner(context);
    let body: unknown;
    if (input.relationId === undefined) {
      if (input.revision !== undefined || input.sourceIndex !== undefined) throw new CaseStoreError('case_relation_id_required');
      const pageSize = input.pageSize === undefined ? 5 : Number(input.pageSize);
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10) throw new CaseStoreError('invalid_case_relation_page');
      let count = pageSize;
      do {
        const listing = list({ caseId: context.caseId, pageSize: count, kind: input.kind as CaseRelationListOptions['kind'], includeUnlinked: input.includeUnlinked as boolean | undefined, continuation: input.continuation as string | null | undefined });
        body = { ...listing, items: listing.items.map(({ origin, ...record }) => ({ ...record, origin: { actorKind: origin.actorKind } })) };
        if (JSON.stringify(body).length <= 30000) break;
        count--;
      } while (count > 0);
    } else {
      const relationId = caseDecisionId(input.relationId), exact = deps.cases.getRelation(relationId, input.revision === undefined ? undefined : caseDecisionRevision(input.revision));
      if (exact.toCaseId !== context.caseId && exact.fromCaseId !== context.caseId) throw new CaseStoreError('case_relation_owner_mismatch', 409);
      compatible(exact.fromCaseId, exact.toCaseId, exact.sources, exact.targetRef);
      if (input.sourceIndex === undefined) {
        if (input.continuation !== undefined && input.continuation !== null) throw new CaseStoreError('invalid_case_relation_page');
        const { origin, ...record } = exact; body = { revision: { ...record, origin: { actorKind: origin.actorKind } } };
      } else {
        if (!Number.isSafeInteger(input.sourceIndex) || Number(input.sourceIndex) < 0) throw new CaseStoreError('invalid_case_relation_source_index');
        const ref = exact.sources[Number(input.sourceIndex)]; if (!ref) throw new CaseStoreError('invalid_case_relation_source_index');
        const value = await source(ref, context.signal);
        compatible(exact.fromCaseId, exact.toCaseId, exact.sources, exact.targetRef);
        const text = value.text, identity = sha(canonical({ relationId, revision: exact.revision, ref }));
        let start = 0;
        if (input.continuation) {
          try { const cursor = JSON.parse(Buffer.from(String(input.continuation), 'base64url').toString('utf8')); if (cursor.identity !== identity || cursor.sha !== sha(text ?? '') || !Number.isSafeInteger(cursor.next) || cursor.next < 0 || cursor.next >= (text?.length ?? 0) || text && /[\uDC00-\uDFFF]/.test(text[cursor.next] ?? '')) throw new Error(); start = cursor.next; }
          catch { throw new CaseStoreError('case_relation_continuation_changed', 409); }
        }
        const total = text?.length ?? 0, digest = sha(text ?? '');
        const boundary = (end: number) => text && end > start && end < total && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[end] ?? '') ? end - 1 : end;
        const page = (end: number) => ({ ...value, text: text === null ? null : text.slice(start, end), range: { start, end, total }, partial: end < total,
          continuation: end < total ? Buffer.from(JSON.stringify({ identity, sha: digest, next: end })).toString('base64url') : null });
        const fits = (candidate: ReturnType<typeof page>) => { const encoded = JSON.stringify(candidate); return encoded.length <= 30000 && Buffer.byteLength(encoded) <= 240000; };
        let end = boundary(Math.min(total, start + 20000));
        if (!fits(page(end))) {
          // Escaping quotes, backslashes and controls can multiply the JSON size.
          // Measure the complete envelope, including its precise continuation.
          let low = start, high = end - 1;
          while (low < high) {
            const middle = Math.floor((low + high + 1) / 2);
            if (fits(page(boundary(middle)))) low = middle; else high = middle - 1;
          }
          end = boundary(low);
          if (end === start && total > start) throw new CaseStoreError('case_relation_output_too_large', 413);
        }
        body = page(end);
      }
    }
    current(context);
    const text = JSON.stringify(body);
    if (text.length > 30000 || Buffer.byteLength(text) > 240000) throw new CaseStoreError('case_relation_output_too_large', 413);
    return { text, details: { type: 'optracall.case-relation-read' as const, caseId: context.caseId } };
  }
  async function saveForAgent(input: unknown, context: CaseRelationAgentContext) {
    relationFields(input, relationWriteFields.filter(key => !['operationId', 'caseStoreId', 'toCaseId'].includes(key)), ['expectedRelationRevision']);
    const command = parseCaseRelationWrite({ ...input, operationId: context.operationId, caseStoreId: context.caseStoreId, toCaseId: context.caseId });
    const origin = { actorKind: 'agent' as const, projectId: context.projectId, taskId: context.taskId, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId };
    return deps.mutate(async () => {
      if (!deps.cases.getOperation(command.operationId)) { await agentOwner(context); validateSourceProjects(command); current(context); }
      const revision = deps.cases.saveRelation(command, origin, { assertWritable: () => { current(context); validateSourceProjects(command); } });
      // Commit results stay small and stable even when the saved record has large prose.
      return { text: JSON.stringify({ relationId: revision.relationId, revision: revision.revision, fromCaseId: revision.fromCaseId, toCaseId: revision.toCaseId, lifecycle: revision.lifecycle }),
        details: { type: 'optracall.case-relation-save' as const, relationId: revision.relationId, revision: revision.revision, operationId: revision.operationId } };
    });
  }
  return { list, read, history, sources, operation, saveUser, readForAgent, saveForAgent };
}
export type CaseRelationsService = ReturnType<typeof createCaseRelationsService>;

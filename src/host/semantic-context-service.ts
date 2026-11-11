import type { SemanticItem, SemanticQueryInput, SemanticQueryResult, SemanticRelation, SemanticTarget } from '../../extensions/business-plugins/semantic-context/types.ts';
import { parseSemanticQueryInput, semanticPage } from '../../extensions/business-plugins/semantic-context/reader.ts';
import { createHash } from 'node:crypto';
import { canonical } from './project-data-context-io.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { CaseStore } from './case-store.ts';
import type { createMetricLibrary } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import type { SapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import type { ReadPersonalSource } from './personal-retention-types.ts';
import type { PersonalContextFindInput, PersonalContextReadInput, PersonalContextReadOptions, PersonalContextResult } from './personal-context-types.ts';
import { learningSourceRef } from './learning-source-validation.ts';
import type { LearningSourceRef } from './learning-source-types.ts';
import type { CaseDecisionTarget } from './case-decision-types.ts';
import { parsePersonalContextReadInput } from './personal-context-validation.ts';

export type SemanticQueryOptions = { signal?: AbortSignal; audience?: 'human' | 'agent'; assertCurrent?: () => void };
export type RequirementSourceScope = { caseHistory: boolean; approvedTargets: readonly SemanticTarget[] };
export type SemanticContextServiceOptions = {
  projects: ProjectStore; data: ProjectDataContextStore; enterprise: EnterpriseMaterialsStore; cases: CaseStore;
  metricLibrary?: Pick<ReturnType<typeof createMetricLibrary>, 'list' | 'read'> | (() => Pick<ReturnType<typeof createMetricLibrary>, 'list' | 'read'>);
  methodLibrary?: Pick<SapMethodStore, 'listPublished' | 'getPublished'>;
  readSource?: ReadPersonalSource;
  personal?: { find(input: PersonalContextFindInput, options?: PersonalContextReadOptions): Promise<PersonalContextResult>; read(input: PersonalContextReadInput, options?: PersonalContextReadOptions): Promise<PersonalContextResult> };
};
export class SemanticContextFault extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const blank = (target: SemanticTarget): SemanticItem => ({ target, title: null, state: 'available', sha256: null, body: null, range: null, recordedAt: null, businessTime: [], governance: null, declaration: null, relations: [], gaps: [] });
const relation = (name: string, target: SemanticTarget): SemanticRelation => ({ relation: name, target, note: null, claim: 'author-declaration' });
const utf8 = (bytes: Uint8Array): string | null => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; } };
const errorCode = (error: unknown) => typeof (error as { code?: unknown })?.code === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,120}$/.test((error as { code: string }).code) ? (error as { code: string }).code : 'semantic_context_source_unknown';
const sourceFailure = (target: SemanticTarget, error: unknown): SemanticItem => {
  const code = errorCode(error), state = /EACCES|EPERM|forbidden|permission|unsafe/.test(code) ? 'forbidden' : /hash_mismatch|hash_conflict|text_changed|bytes_changed/.test(code) ? 'hash-conflict' : /ENOENT|not_found|NOT_FOUND|missing/.test(code) ? 'missing' : /excluded/.test(code) ? 'excluded' : /disabled/.test(code) ? 'disabled' : 'unknown';
  return { ...blank(target), state, code, gaps: [code] };
};
function assertSourceOwner(source: ReturnType<typeof learningSourceRef>, projectId: string): void {
  const sourceProjectId = source.type === 'agent-candidate' ? source.candidate.projectId : 'projectId' in source ? source.projectId : 'sourceProjectId' in source ? source.sourceProjectId : null;
  if (sourceProjectId !== null && sourceProjectId !== projectId) throw new SemanticContextFault('semantic_context_owner_mismatch', 403);
}
function sourceTarget(source: LearningSourceRef): SemanticTarget {
  if (source.type === 'enterprise') return { kind: 'enterprise', storeId: source.storeId, materialId: source.materialId, revisionId: source.revisionId, ...(source.excerpt ? { location: source.excerpt } : {}) };
  if (source.type === 'citation') return { kind: 'data-citation', projectId: source.projectId, citationId: source.citationId };
  if (source.type === 'case-decision') return { kind: 'case-decision', caseStoreId: source.caseStoreId, caseId: source.caseId, recordId: source.recordId, revision: source.revision };
  if (source.type === 'case-choice') return { kind: 'case-choice', caseStoreId: source.caseStoreId, caseId: source.caseId, choiceId: source.choiceId };
  return { kind: 'source', source };
}
function caseTarget(target: CaseDecisionTarget): SemanticTarget | null {
  if (target.type === 'case-decision') return sourceTarget(target);
  if (target.type === 'source') return sourceTarget(target.source);
  if (target.type === 'personal') return { kind: 'personal', target: target.target };
  if (target.type === 'feedback') return { kind: 'source', source: { type: 'feedback', sourceProjectId: target.sourceProjectId, boardTaskId: target.boardTaskId, feedbackRevisionId: target.feedbackRevisionId } };
  return null;
}
function inRequirementScope(target: SemanticTarget, scope: RequirementSourceScope): boolean {
  if (target.kind === 'sap' || target.kind === 'sap-method' || target.kind === 'enterprise') return true;
  if (target.kind === 'case-decision' || target.kind === 'case-choice') return scope.caseHistory;
  if (target.kind === 'personal') return target.target.type === 'retained';
  return 'projectId' in target && scope.approvedTargets.some(approved => canonical(approved) === canonical(target));
}

export class SemanticContextService {
  readonly options: SemanticContextServiceOptions;
  constructor(options: SemanticContextServiceOptions) { this.options = options; }
  async query(projectId: string, taskId: string, input: SemanticQueryInput, options: SemanticQueryOptions = {}): Promise<SemanticQueryResult> {
    return this.#query(projectId, taskId, input, options);
  }

  /** Requirement instances have no project/task read authority by default. */
  async queryRequirement(input: SemanticQueryInput, scope: RequirementSourceScope, options: SemanticQueryOptions = {}): Promise<SemanticQueryResult> {
    input = parseSemanticQueryInput(input);
    if (input.target && !inRequirementScope(input.target, scope)) throw new SemanticContextFault('semantic_context_read_not_authorized', 403);
    const projectId = input.target && 'projectId' in input.target ? input.target.projectId : null;
    async function qualifyProject(projects: ProjectStore) {
      options.signal?.throwIfAborted(); options.assertCurrent?.();
      if (projectId && (await projects.get(projectId)).archivedAt !== null) throw new SemanticContextFault('semantic_context_read_not_authorized', 403);
    }
    await qualifyProject(this.options.projects);
    const result = await this.#query(projectId, scope, input, { ...options, audience: 'agent' }, scope);
    await qualifyProject(this.options.projects);
    options.signal?.throwIfAborted(); options.assertCurrent?.();
    return result;
  }

  async #query(projectId: string | null, binding: string | RequirementSourceScope, input: SemanticQueryInput, options: SemanticQueryOptions, requirement?: RequirementSourceScope): Promise<SemanticQueryResult> {
    input = parseSemanticQueryInput(input);
    if (input.target?.kind === 'source') input = { ...input, target: { kind: 'source', source: learningSourceRef(input.target.source) } };
    if (input.target?.kind === 'personal') input = { ...input, target: { kind: 'personal', target: parsePersonalContextReadInput({ target: input.target.target }).target } };
    const current = () => { options.signal?.throwIfAborted(); options.assertCurrent?.(); };
    current();
    if (projectId !== null && typeof binding === 'string') { await this.options.projects.getTask(projectId, binding); current(); }
    const directoryGaps: string[] = [];
    const sourceContinuations: NonNullable<SemanticQueryResult['coverage']['sourceContinuations']> = [];
    const index = projectId === null ? null : await this.options.data.getIndex(projectId).catch(error => { directoryGaps.push(errorCode(error)); return null; }); current();
    const items: SemanticItem[] = [];
    const resolve = async (target: SemanticTarget): Promise<SemanticItem> => {
      if ('projectId' in target && target.projectId !== projectId) throw new SemanticContextFault('semantic_context_owner_mismatch', 403);
      const item = blank(target);
      try {
      if (target.kind === 'sap') {
        if (!target.version) throw new SemanticContextFault('semantic_context_exact_version_required');
        const library = typeof this.options.metricLibrary === 'function' ? this.options.metricLibrary() : this.options.metricLibrary;
        if (!library) { item.state = 'unknown'; item.gaps.push('sap-library-unavailable'); return item; }
        const value = library.read(target.packageId, target.version);
        if (target.metricName && !value.entry.metricNames.includes(target.metricName)) { item.state = 'missing'; item.code = 'semantic_context_metric_missing'; return item; }
        if (target.publishedHash != null && target.publishedHash !== value.entry.bytesSha256) { item.state = 'hash-conflict'; item.code = 'semantic_context_sap_hash_conflict'; return item; }
        item.title = `${value.entry.id}@${value.entry.version}${target.metricName ? ' / ' + target.metricName : ''}`;
        item.body = value.canonicalYaml; item.sha256 = value.entry.bytesSha256; item.recordedAt = { field: 'publishedAt', value: value.entry.publishedAt };
        item.governance = { authority: 'published-SAP', publishedBy: value.entry.publishedBy };
        if (target.publishedHash == null) item.gaps.push('reference-did-not-record-published-hash');
      } else if (target.kind === 'sap-method') {
        if (!this.options.methodLibrary) { item.state = 'unknown'; item.gaps.push('sap-method-library-unavailable'); return item; }
        const value = this.options.methodLibrary.getPublished(target.methodId, target.version);
        if (target.publishedHash != null && target.publishedHash !== value.version.contentSha256) { item.state = 'hash-conflict'; item.code = 'semantic_context_sap_method_hash_conflict'; return item; }
        item.title = value.version.title; item.body = JSON.stringify(value.version, null, 2); item.sha256 = value.version.contentSha256;
        item.recordedAt = { field: 'publishedAt', value: value.publication.publishedAt };
        item.governance = { authority: 'published-SAP-method', issue: value.issue };
        if (value.issue?.status === 'confirmed') item.gaps.push('known-error-not-default-recommended');
        if (target.publishedHash == null) item.gaps.push('reference-did-not-record-published-hash');
        if (value.version.relation) item.relations.push(relation(value.version.relation.kind, { kind: 'sap-method', ...value.version.relation.target }));
      } else if (target.kind === 'enterprise') {
        const metadata = await this.options.enterprise.referenceIndex({ readOnly: true }); current();
        if (metadata.storeId !== target.storeId) throw new SemanticContextFault('semantic_context_store_mismatch', 403);
        const material = metadata.materials.find(item => item.materialId === target.materialId);
        if (requirement && !material?.enabled) return { ...item, state: 'disabled', gaps: ['enterprise-material-unavailable'] };
        const revision = await this.options.enterprise.readRevision(target.materialId, target.revisionId, { readOnly: true }); current();
        if (requirement) {
          const latest = await this.options.enterprise.referenceIndex({ readOnly: true }); current();
          if (latest.storeId !== target.storeId || !latest.materials.some(current => current.materialId === target.materialId && current.enabled))
            return { ...item, state: 'disabled', gaps: ['enterprise-material-unavailable'] };
        }
        item.title = revision.title; item.sha256 = revision.bodySha256; item.body = revision.body;
        if (target.location) {
          const { start, end } = target.location;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > revision.body.length) throw new SemanticContextFault('invalid_semantic_context_location');
          item.body = revision.body.slice(start, end); item.gaps.push(`original-location:${start}:${end}`);
        }
        item.recordedAt = { field: 'createdAt', value: revision.createdAt };
        item.businessTime = revision.effectiveTime ? [{ text: revision.effectiveTime, source: 'effectiveTime' }] : [];
        item.governance = { enabled: material?.enabled ?? null }; item.state = material?.enabled ? 'available' : 'disabled';
        if (revision.sourceFile) item.gaps.push('source-attachment-not-extracted');
      } else if (target.kind === 'data-input') {
        const { record, bytes } = await this.options.data.readInputEvidence(target.projectId, target.datasetId, target.inputVersionId); current();
        item.title = record.sourcePath; item.sha256 = record.sha256; item.body = /\.xlsx$/i.test(record.sourcePath) ? null : utf8(bytes);
        item.recordedAt = { field: 'savedAt', value: record.savedAt };
        if (item.body === null) item.gaps.push('binary-or-non-utf8-original-not-extracted');
      } else if (target.kind === 'data-description') {
        const record = await this.options.data.readDescription(target.projectId, target.datasetId, target.descriptionRevisionId); current();
        if (record.inputVersionId !== target.inputVersionId) throw new SemanticContextFault('semantic_context_input_version_mismatch', 409);
        item.title = `Data description ${record.descriptionRevisionId}`; item.body = JSON.stringify(record, null, 2);
        item.sha256 = index?.datasets.find(dataset => dataset.datasetId === target.datasetId)?.descriptions.find(ref => ref.descriptionRevisionId === target.descriptionRevisionId)?.recordSha256 ?? null;
        item.recordedAt = { field: 'createdAt', value: record.createdAt };
        item.businessTime = record.statements.filter(statement => statement.scope === 'business-time').map(statement => ({ text: statement.text, source: 'statements.business-time' }));
        item.gaps.push('binding-grain-keys-units-timezones-not-automatically-verified');
        item.relations = [relation('input', { kind: 'data-input', projectId: target.projectId, datasetId: target.datasetId, inputVersionId: target.inputVersionId }),
          ...record.mappings.flatMap(mapping => [...mapping.conceptRefs.map(ref => relation('concept', { kind: 'enterprise', ...ref })), ...mapping.sapRefs.map(ref => relation('sap', { kind: 'sap', ...ref }))])];
      } else if (target.kind === 'data-citation') {
        const { projectId } = target;
        const record = await this.options.data.readCitationManifest(projectId, target.citationId); current();
        item.title = record.report.originalPath; item.body = JSON.stringify(record, null, 2); item.sha256 = index?.citations.find(ref => ref.citationId === target.citationId)?.recordSha256 ?? null;
        item.recordedAt = { field: 'savedAt', value: record.savedAt }; item.declaration = { actor: record.declarer, text: record.declaration, claim: 'author-declaration' };
        item.gaps.push('author-declaration-does-not-prove-execution');
        item.relations = [relation('report', { kind: 'data-evidence', projectId, citationId: record.citationId, attachmentIndex: null }),
          ...record.attachments.map((_, attachmentIndex) => relation('attachment', { kind: 'data-evidence', projectId, citationId: record.citationId, attachmentIndex })),
          ...record.selections.flatMap(ref => [relation('input', { kind: 'data-input', projectId, datasetId: ref.datasetId, inputVersionId: ref.inputVersionId }),
            ...(ref.descriptionRevisionId === null ? [] : [relation('description', { kind: 'data-description', projectId, datasetId: ref.datasetId, inputVersionId: ref.inputVersionId, descriptionRevisionId: ref.descriptionRevisionId })])]),
          ...record.conceptRefs.map(ref => relation('concept', { kind: 'enterprise', ...ref })), ...record.sapRefs.map(ref => relation('sap', { kind: 'sap', ...ref }))];
      } else if (target.kind === 'data-evidence') {
        const { projectId } = target;
        const { file, bytes } = await this.options.data.readCitationEvidenceFile(projectId, target.citationId, target.attachmentIndex); current();
        item.title = file.originalPath; item.sha256 = file.sha256; item.body = utf8(bytes);
        const record = await this.options.data.readCitationManifest(projectId, target.citationId); current(); item.recordedAt = { field: 'savedAt', value: record.savedAt };
        if (item.body === null) item.gaps.push('binary-or-non-utf8-original-not-extracted');
      } else if (target.kind === 'source') {
        if (projectId === null) throw new SemanticContextFault('semantic_context_read_not_authorized', 403);
        const source = learningSourceRef(target.source); assertSourceOwner(source, projectId);
        if (source.type === 'enterprise' || source.type === 'citation' || source.type === 'case-decision' || source.type === 'case-choice') {
          const exact = source.type === 'citation' ? { kind: 'data-evidence' as const, projectId: source.projectId, citationId: source.citationId, attachmentIndex: source.target.type === 'report' ? null : source.target.attachmentIndex } : sourceTarget(source);
          const original = await resolve(exact); current();
          if (source.excerpt && original.body !== null && source.type !== 'enterprise') {
            const { start, end } = source.excerpt;
            if (end > original.body.length) throw new SemanticContextFault('invalid_semantic_context_location');
            original.body = original.body.slice(start, end); original.gaps.push(`original-location:${start}:${end}`);
          }
          return { ...original, target };
        }
        if (!this.options.readSource) { item.state = 'unknown'; item.gaps.push('source-adapter-unavailable'); return item; }
        const evidence = await this.options.readSource(source, { signal: options.signal, audience: options.audience ?? 'agent' }); current();
        item.state = evidence.status === 'governance-unknown' ? 'unknown' : evidence.status;
        const refused = options.audience !== 'human' && (evidence.status === 'excluded' || evidence.status === 'governance-unknown');
        item.title = refused ? null : evidence.title; item.body = refused ? null : evidence.text; item.sha256 = evidence.sha256;
        item.governance = { candidate: evidence.candidateGovernance ?? null, case: evidence.caseGovernance ?? null, projectArchived: evidence.project?.archived ?? null };
        item.gaps.push('source-recorded-time-not-provided', ...(refused ? ['source-governance-refused-body'] : []));
      } else if (target.kind === 'case-decision' || target.kind === 'case-choice') {
        if (this.options.cases.getStatus().state !== 'ready') {
          item.state = 'unknown'; item.code = 'semantic_context_case_authority_unavailable'; item.gaps.push(item.code); return item;
        }
        if (this.options.cases.getStatus().storeId !== target.caseStoreId) throw new SemanticContextFault('semantic_context_case_store_mismatch', 403);
        const record = target.kind === 'case-decision' ? this.options.cases.getDecision(target.caseId, target.recordId, target.revision) : this.options.cases.getStrategyChoice(target.caseId, target.choiceId);
        item.body = JSON.stringify(record, null, 2); item.sha256 = sha(item.body);
        const core = this.options.cases.getCase(target.caseId);
        if ('payload' in record) {
          const head = this.options.cases.getDecision(target.caseId, record.recordId);
          item.title = record.payload.title; item.recordedAt = { field: 'createdAt', value: record.createdAt };
          item.governance = { caseStatus: core.status, currentRevision: head.revision, lifecycle: head.lifecycle };
          item.declaration = { actor: record.origin.actorKind, text: 'Case references are author-declared relationships.', claim: 'author-declaration' };
          item.relations = record.references.map(ref => ({ relation: ref.relation, target: caseTarget(ref.target), originalTarget: ref.target, note: ref.note, claim: 'author-declaration' }));
          item.relations.push(...record.impactNotes.map(impact => ({ relation: 'impact-note', target: sourceTarget(impact.target), note: impact.explanation, claim: 'author-declaration' as const })));
          if (item.relations.some(ref => ref.target === null)) item.gaps.push('original-reference-has-no-semantic-reader-use-original-entry');
        } else {
          item.title = `Human choice: ${record.choice}`; item.recordedAt = { field: 'occurredAt', value: record.occurredAt };
          item.governance = { caseStatus: core.status }; item.relations = [relation('choice-for-exact-strategy', sourceTarget(record.strategyRef))];
          item.declaration = { actor: 'user', text: record.reason ?? '', claim: 'author-declaration' };
          item.gaps.push('human-choice-does-not-prove-execution-or-effect');
        }
      } else if (target.kind === 'personal') {
        if (!this.options.personal) { item.state = 'unknown'; item.gaps.push('personal-reader-unavailable-use-original-personal-tools'); return item; }
        // The original M4 reader uses Enterprise load internally. Only call it
        // after all original directories/index already exist and validate.
        await this.options.enterprise.referenceIndex({ readOnly: true }); current();
        const original = await this.options.personal.read({ target: target.target }, { signal: options.signal, ...(requirement ? { retainedOnly: true } : {}) }); current();
        const metadata = original.details.items[0];
        if (requirement && (!metadata || metadata.governance.archived || target.target.type !== 'retained'))
          return { ...item, state: 'disabled', gaps: ['personal-source-unavailable'] };
        item.title = metadata?.title ?? null; item.body = original.text;
        if (requirement && target.target.type === 'retained') item.sha256 = target.target.expectedBodySha256;
        item.governance = metadata?.governance ?? null;
        item.businessTime = metadata?.effectiveTime ? [{ text: metadata.effectiveTime, source: 'original-M4-effectiveTime' }] : [];
        item.gaps.push('original-m4-tool-payload-not-raw-source-body', ...original.details.issues.map(issue => issue.code));
        if (original.details.partial) item.state = 'partial';
        if (original.details.continuation) {
          if (requirement) item.gaps.push('personal-original-content-continues-beyond-provided-fragment');
          else sourceContinuations.push({ tool: 'read_personal_context', input: { target: target.target, continuation: original.details.continuation } });
        }
      } else { item.state = 'unknown'; item.gaps.push('source-adapter-unavailable'); }
      return item;
      } catch (error) { current(); if (error instanceof SemanticContextFault) throw error; return sourceFailure(target, error); }
    };
    if (input.target) {
      const root = await resolve(input.target); items.push(root);
      for (const ref of root.relations) {
        ref.state = 'unread';
        if (ref.target) {
          try {
            if ('projectId' in ref.target && ref.target.projectId !== projectId) throw new SemanticContextFault('semantic_context_owner_mismatch', 403);
            if (requirement && !inRequirementScope(ref.target, requirement)) throw new SemanticContextFault('semantic_context_read_not_authorized', 403);
            if (ref.target.kind === 'source' && projectId !== null) assertSourceOwner(ref.target.source, projectId);
          } catch { ref.state = 'forbidden'; }
        }
      }
      if (root.relations.length) root.gaps.push('related-targets-not-read-use-exact-read');
    } else if (input.action === 'find') {
      directoryGaps.push('current-directories-not-complete-historical-snapshot');
      const wants = (kind: SemanticTarget['kind']) => !input.kinds || input.kinds.includes(kind);
      const matches = (...values: string[]) => values.some(value => value.toLocaleLowerCase().includes((input.query ?? '').toLocaleLowerCase()));
      if (wants('sap')) {
        try {
          const library = typeof this.options.metricLibrary === 'function' ? this.options.metricLibrary() : this.options.metricLibrary;
          if (library) for (const entry of library.list()) for (const metricName of entry.metricNames) if (matches(entry.id, entry.namespace, metricName)) {
            items.push({ ...blank({ kind: 'sap', packageId: entry.id, version: entry.version, metricName, publishedHash: entry.bytesSha256 }), title: `${metricName} / ${entry.id}@${entry.version}`, sha256: entry.bytesSha256, recordedAt: { field: 'publishedAt', value: entry.publishedAt }, governance: { authority: 'published-SAP' } });
          }
        } catch (error) { current(); directoryGaps.push(errorCode(error)); }
      }
      if (wants('sap-method') && this.options.methodLibrary) {
        try {
          for (const entry of this.options.methodLibrary.listPublished()) {
            const value = this.options.methodLibrary.getPublished(entry.id, entry.publishedVersion!);
            if (matches(entry.title, value.version.content.conditions, value.version.content.logic)) {
              items.push({ ...blank({ kind: 'sap-method', methodId: entry.id, version: value.version.version, publishedHash: value.version.contentSha256 }),
                title: value.version.title, sha256: value.version.contentSha256, recordedAt: { field: 'publishedAt', value: value.publication.publishedAt },
                governance: { authority: 'published-SAP-method', issue: value.issue } });
            }
          }
        } catch (error) { current(); directoryGaps.push(errorCode(error)); }
      }
      if (wants('enterprise')) {
        let metadata: Awaited<ReturnType<EnterpriseMaterialsStore['referenceIndex']>> | null = null;
        try { metadata = await this.options.enterprise.referenceIndex({ readOnly: true }); current(); }
        catch (error) { current(); directoryGaps.push(errorCode(error)); }
        if (metadata) for (const material of metadata.materials) for (const revision of material.revisions) if ((!requirement || material.enabled) && matches(revision.title, revision.scope)) {
          items.push({ ...blank({ kind: 'enterprise', storeId: metadata.storeId, materialId: material.materialId, revisionId: revision.revisionId }), title: revision.title, sha256: revision.bodySha256,
            recordedAt: revision.createdAt ? { field: 'createdAt', value: revision.createdAt } : null,
            businessTime: revision.effectiveTime ? [{ text: revision.effectiveTime, source: 'effectiveTime' }] : [], governance: { enabled: material.enabled }, state: material.enabled ? 'available' : 'disabled' });
        }
      }
      if (index && projectId !== null) {
        for (const dataset of index.datasets) if (matches(dataset.name, dataset.sourcePath, dataset.datasetId)) {
          if (wants('data-input')) for (const version of dataset.versions) items.push({ ...blank({ kind: 'data-input', projectId, datasetId: dataset.datasetId, inputVersionId: version.inputVersionId }), title: dataset.name, sha256: version.recordSha256, gaps: ['directory-has-no-version-saved-time-read-exact-target'] });
          if (wants('data-description')) for (const description of dataset.descriptions) items.push({ ...blank({ kind: 'data-description', projectId, datasetId: dataset.datasetId, inputVersionId: description.inputVersionId, descriptionRevisionId: description.descriptionRevisionId }), title: `${dataset.name} / ${description.descriptionRevisionId}`, sha256: description.recordSha256, gaps: ['directory-has-no-description-saved-time-read-exact-target'] });
        }
        if (wants('data-citation')) for (const ref of index.citations) {
          const row = await resolve({ kind: 'data-citation', projectId, citationId: ref.citationId }); current();
          if (row.state !== 'available' || matches(row.title ?? '', ref.citationId)) items.push({ ...row, body: null, declaration: null, relations: [] });
        }
      }
      if (requirement) {
        for (const target of requirement.approvedTargets) {
          if (!('projectId' in target) || !wants(target.kind)) continue;
          try {
            const project = await this.options.projects.get(target.projectId); current();
            if (project.archivedAt === null) items.push({ ...blank(target), state: 'unknown', gaps: ['approved-locator-only-read-to-verify-content'] });
          } catch (error) { current(); directoryGaps.push(errorCode(error)); }
        }
        if (['data-input', 'data-description', 'data-citation', 'data-evidence'].some(kind => wants(kind as SemanticTarget['kind'])) && !requirement.approvedTargets.length)
          directoryGaps.push('no-project-materials-authorized-for-this-requirement');
      }
      if ((wants('case-decision') || wants('case-choice')) && (!requirement || requirement.caseHistory) && this.options.cases.getStatus().state === 'ready') {
        const caseIds = requirement ? [undefined] : [...new Set(this.options.cases.listProjectLinks().filter(link => link.projectId === projectId).map(link => link.caseId))];
        for (const caseId of caseIds) {
          let offset = 0;
          for (;;) {
            const rows = this.options.cases.listDecisionSourceEntries({ caseId, query: input.query ?? '', includeArchived: true, offset, pageSize: 51 });
            for (const row of rows) if (wants(row.target.type)) items.push({ ...blank(sourceTarget(row.target)), title: row.title, governance: { caseStatus: row.case.status, lifecycle: row.lifecycle }, gaps: ['directory-has-no-decision-saved-time-read-exact-target'] });
            current();
            if (rows.length < 51) break; offset += rows.length;
          }
        }
      } else if (wants('case-decision') || wants('case-choice')) {
        directoryGaps.push(requirement && !requirement.caseHistory ? 'case-history-not-authorized' : `case-directory-${this.options.cases.getStatus().state}`);
      }
      if (wants('personal') && this.options.personal) {
        const originalInput: PersonalContextFindInput = { query: input.query ?? '', kind: 'all', includeArchived: !requirement, pageSize: 50 };
        try {
          await this.options.enterprise.referenceIndex({ readOnly: true }); current();
          const original = await this.options.personal.find(originalInput, { signal: options.signal, ...(requirement ? { retainedOnly: true } : {}) }); current();
          for (const row of original.details.items) if (!requirement || row.target.type === 'retained') items.push({ ...blank({ kind: 'personal', target: row.target }), title: row.title, governance: row.governance,
            businessTime: row.effectiveTime ? [{ text: row.effectiveTime, source: 'original-M4-effectiveTime' }] : [], gaps: [...row.limitations, 'personal-directory-has-no-qualified-system-time'] });
          directoryGaps.push(...original.details.issues.map(issue => issue.code));
          if (original.details.partial) directoryGaps.push('original-personal-directory-partial');
          if (!requirement && original.details.continuation) sourceContinuations.push({ tool: 'find_personal_context', input: { ...originalInput, continuation: original.details.continuation } });
        } catch (error) { current(); directoryGaps.push(errorCode(error), 'personal-original-reader-not-initialized-by-semantic-query'); }
      }
    }
    current();
    const identity = typeof binding === 'string' ? { projectId, taskId: binding } : { projectId, requirement: binding };
    const result = semanticPage(input, items, { identity: sha(canonical({ ...identity, input: { ...input, continuation: null } })), version: sha(canonical({ items, indexRevision: index?.revision ?? null })) }, index?.revision ?? null);
    result.coverage.gaps.push(...new Set([...items.flatMap(item => item.gaps), ...directoryGaps]));
    if (sourceContinuations.length) {
      result.coverage.sourceContinuations = sourceContinuations.slice(0, 20); result.coverage.complete = false; result.state = 'partial';
      if (sourceContinuations.length > 20) result.coverage.gaps.push('additional-source-continuations-use-exact-related-target');
    }
    if (directoryGaps.some(gap => gap !== 'current-directories-not-complete-historical-snapshot')) { result.coverage.complete = false; result.state = items.length ? 'partial' : 'unknown'; }
    return result;
  }
}

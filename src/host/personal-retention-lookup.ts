import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { EnterpriseMaterialRef } from './enterprise-materials-types.ts';
import type { PersonalRetentionStore } from './personal-retention-store.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { ReadPersonalSource, PersonalSourceEvidence } from './personal-retention-types.ts';
import type { LearningSourceRef } from './learning-source-types.ts';
import { PersonalRetentionFault } from './personal-retention-validation.ts';

export type PersonalLookupInput = {
  query?: string; category?: 'all' | 'concept' | 'knowledge' | 'experience' | 'data';
  includeBody?: boolean; includeDrafts?: boolean; includeArchived?: boolean; page?: number; pageSize?: number;
};
export type PersonalLookupMatch = { field: 'title' | 'aliases' | 'scope' | 'body'; start: number; end: number; aliasIndex?: number };
export type PersonalLookupIssue = { code: string; itemId?: string; projectId?: string; ref?: LearningSourceRef };
export type PersonalLookupItem = {
  id: string; category: 'concept' | 'knowledge' | 'experience' | 'data'; title: string; aliases: string[]; scope: string;
  bodyPreview: string | null; bodyTruncated: boolean; personalState?: 'retained' | 'draft' | 'archived'; status: 'available' | 'disabled' | 'unavailable';
  contentRef?: EnterpriseMaterialRef; materialId?: string; decisionId?: string; bodySha256?: string; caution: string | null;
  sourceRefs: LearningSourceRef[]; sourceIssues: { ref: LearningSourceRef; code: string }[];
  sources: { ref: LearningSourceRef; status: PersonalSourceEvidence['status'] | 'unavailable'; project?: { id: string; name: string; archived: boolean }; code?: string }[];
  project?: { id: string; name: string; archived: boolean };
  data?: { datasetId: string; inputVersionId: string; sha256: string; bytes: number; sourcePath: string; savedAt: string };
  conceptUses?: { projectId: string; datasetId: string; descriptionRevisionId: string; mappingId: string }[];
  matches: PersonalLookupMatch[];
};
export type PersonalLookupResult = { items: PersonalLookupItem[]; total: number; page: number; pageSize: number; issues: PersonalLookupIssue[]; complete: boolean };
export type PersonalLookupDependencies = {
  personal: Pick<PersonalRetentionStore, 'getRecords' | 'readItem'>;
  enterprise: Pick<EnterpriseMaterialsStore, 'referenceIndex' | 'readRevision' | 'get'>;
  projects: Pick<ProjectStore, 'list'>;
  dataContext: Pick<ProjectDataContextStore, 'getIndex' | 'readVersion' | 'readDescription'>;
  readSource: ReadPersonalSource;
};

function input(value: PersonalLookupInput): Required<PersonalLookupInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['query', 'category', 'includeBody', 'includeDrafts', 'includeArchived', 'page', 'pageSize'].includes(key))) throw new PersonalRetentionFault('invalid_personal_lookup');
  const query = value.query ?? '', category = value.category ?? 'all', page = value.page ?? 1, pageSize = value.pageSize ?? 20;
  if (typeof query !== 'string' || query.length > 200 || query.includes('\0')) throw new PersonalRetentionFault('invalid_personal_lookup_query');
  if (!['all', 'concept', 'knowledge', 'experience', 'data'].includes(category)) throw new PersonalRetentionFault('invalid_personal_lookup_category');
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new PersonalRetentionFault('invalid_personal_lookup_page');
  for (const key of ['includeBody', 'includeDrafts', 'includeArchived'] as const) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new PersonalRetentionFault('invalid_personal_lookup');
  return { query: query.trim(), category, page, pageSize, includeBody: value.includeBody ?? false, includeDrafts: value.includeDrafts ?? false, includeArchived: value.includeArchived ?? false };
}
function code(error: unknown): string {
  const value = (error as { code?: unknown })?.code;
  return value === 'ENOENT' ? 'personal_source_missing' : typeof value === 'string' && /^[a-z][a-z0-9_]{0,120}$/.test(value) ? value : 'personal_lookup_unavailable';
}
function preview(body: string | null): Pick<PersonalLookupItem, 'bodyPreview' | 'bodyTruncated'> {
  let bodyPreview = body === null ? null : body.slice(0, 240);
  if (bodyPreview && /[\uD800-\uDBFF]$/.test(bodyPreview)) bodyPreview = bodyPreview.slice(0, -1);
  return { bodyPreview, bodyTruncated: body !== null && bodyPreview!.length < body.length };
}
function matches(row: PersonalLookupItem, body: string | null, request: Required<PersonalLookupInput>): PersonalLookupMatch[] {
  if (!request.query) return [];
  const pattern = new RegExp(request.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'), result: PersonalLookupMatch[] = [];
  const add = (field: PersonalLookupMatch['field'], text: string, aliasIndex?: number) => { const match = pattern.exec(text); if (match) result.push({ field, ...(aliasIndex === undefined ? {} : { aliasIndex }), start: match.index, end: match.index + match[0].length }); };
  add('title', row.title); row.aliases.forEach((alias, index) => add('aliases', alias, index)); add('scope', row.scope);
  if (request.includeBody && body !== null) add('body', body);
  return result;
}

export function createPersonalLookup(deps: PersonalLookupDependencies) {
  return async (value: PersonalLookupInput = {}): Promise<PersonalLookupResult> => {
    const request = input(value), rows: PersonalLookupItem[] = [], issues: PersonalLookupIssue[] = [];
    const readSources = async (row: PersonalLookupItem) => {
      for (const ref of row.sourceRefs) {
        try { const evidence = await deps.readSource(ref); row.sources.push({ ref, status: evidence.status, ...(evidence.project ? { project: evidence.project } : {}) }); }
        catch (error) { const failure = { ref, code: code(error) }; row.sourceIssues.push(failure); row.sources.push({ ...failure, status: 'unavailable' }); issues.push({ ...failure, itemId: row.id }); }
      }
    };
    let referenceIndex: Awaited<ReturnType<PersonalLookupDependencies['enterprise']['referenceIndex']>> | null = null;
    if (request.category !== 'data') {
      try { referenceIndex = await deps.enterprise.referenceIndex(); }
      catch (error) { issues.push({ code: code(error) }); }
    }
    if (request.category === 'all' || request.category === 'knowledge' || request.category === 'experience') {
      try {
        const records = await deps.personal.getRecords();
        for (const item of records.items) {
          if (item.archived && !request.includeArchived) continue;
          const decision = item.decisions.find(decision => decision.operationId === item.currentDecisionId);
          if (request.includeDrafts && (request.category === 'all' || request.category === item.draftMeta.kind)) {
            try {
              const material = (await deps.enterprise.get(item.materialId)).material, current = decision?.contentRef ? await deps.enterprise.readRevision(item.materialId, decision.contentRef.revisionId) : null;
              const changed = !current || (['title', 'category', 'body', 'source', 'owner', 'scope', 'effectiveTime', 'sourceFileId'] as const).some(key => current[key] !== material.draft[key]) || JSON.stringify(item.draftMeta) !== JSON.stringify(decision!.metadata);
              if (changed) {
                const row: PersonalLookupItem = { id: `draft:${item.materialId}`, materialId: item.materialId, category: item.draftMeta.kind, title: material.draft.title, aliases: [...item.draftMeta.aliases], scope: material.draft.scope, ...preview(material.draft.body || null), personalState: item.archived ? 'archived' : 'draft', status: material.enabled ? 'available' : 'disabled', caution: item.draftMeta.caution, sourceRefs: item.draftMeta.sourceRefs, sourceIssues: [], sources: [], matches: [] };
                await readSources(row);
                row.matches = matches(row, material.draft.body || null, request); if (!request.query || row.matches.length) rows.push(row);
              }
            } catch (error) { issues.push({ code: code(error), itemId: `draft:${item.materialId}` }); }
          }
          if (!item.currentDecisionId) continue;
          if (!decision?.contentRef) { issues.push({ code: 'personal_decision_unavailable', itemId: item.materialId }); continue; }
          if (request.category !== 'all' && decision.metadata.kind !== request.category) continue;
          const material = referenceIndex?.materials.find(material => material.materialId === item.materialId);
          let content = null;
          try { content = (await deps.personal.readItem(item.materialId, decision.operationId)).content; }
          catch (error) { issues.push({ code: code(error), itemId: item.materialId }); }
          const row: PersonalLookupItem = { id: `personal:${item.materialId}`, materialId: item.materialId, decisionId: decision.operationId, ...(decision.bodySha256 ? { bodySha256: decision.bodySha256 } : {}), category: decision.metadata.kind, title: content?.title ?? material?.revisions.find(revision => revision.revisionId === decision.contentRef!.revisionId)?.title ?? '标题不可读取', aliases: [...decision.metadata.aliases], scope: content?.scope ?? '', ...preview(content?.body ?? null), personalState: item.archived ? 'archived' : 'retained', status: !content ? 'unavailable' : material?.enabled ? 'available' : 'disabled', contentRef: decision.contentRef, caution: decision.metadata.caution, sourceRefs: decision.metadata.sourceRefs, sourceIssues: [], sources: [], matches: [] };
          await readSources(row);
          row.matches = matches(row, content?.body ?? null, request);
          if (!request.query || row.matches.length) rows.push(row);
        }
      } catch (error) { issues.push({ code: code(error) }); }
    }
    if (request.category === 'all' || request.category === 'concept' || request.category === 'data') {
      const concepts = new Map<string, PersonalLookupItem>();
      try {
        for (const project of await deps.projects.list()) {
          let index;
          try { index = await deps.dataContext.getIndex(project.id); }
          catch (error) { issues.push({ code: code(error), projectId: project.id }); continue; }
          if (!index) continue;
          for (const dataset of index.datasets) {
            if (request.category === 'all' || request.category === 'data') for (const versionRef of dataset.versions) {
              const itemId = `data:${project.id}:${dataset.datasetId}:${versionRef.inputVersionId}`;
              let version = null;
              try { version = await deps.dataContext.readVersion(project.id, dataset.datasetId, versionRef.inputVersionId); }
              catch (error) { issues.push({ code: code(error), projectId: project.id, itemId }); }
              const row: PersonalLookupItem = { id: itemId, category: 'data', title: dataset.name, aliases: [], scope: '', bodyPreview: null, bodyTruncated: false, status: version ? 'available' : 'unavailable', caution: null, sourceRefs: [], sourceIssues: [], sources: [], project: { id: project.id, name: project.name, archived: project.archivedAt !== null }, ...(version ? { data: { datasetId: dataset.datasetId, inputVersionId: version.inputVersionId, sha256: version.sha256, bytes: version.bytes, sourcePath: version.sourcePath, savedAt: version.savedAt } } : {}), matches: [] };
              row.matches = matches(row, null, request); if (!request.query || row.matches.length) rows.push(row);
            }
            if (request.category === 'all' || request.category === 'concept') for (const descriptionRef of dataset.descriptions) {
              let description;
              try { description = await deps.dataContext.readDescription(project.id, dataset.datasetId, descriptionRef.descriptionRevisionId); }
              catch (error) { issues.push({ code: code(error), projectId: project.id, itemId: `description:${descriptionRef.descriptionRevisionId}` }); continue; }
              for (const mapping of description.mappings) for (const selected of mapping.conceptRefs) {
                const ref: LearningSourceRef = { type: 'enterprise', storeId: selected.storeId, materialId: selected.materialId, revisionId: selected.revisionId, ...(selected.location ? { excerpt: selected.location } : {}) }, key = JSON.stringify(ref);
                let row = concepts.get(key);
                if (!row) {
                  const material = referenceIndex?.materials.find(material => material.materialId === selected.materialId);
                  row = { id: `concept:${selected.storeId}:${selected.materialId}:${selected.revisionId}:${selected.location ? `${selected.location.start}-${selected.location.end}` : 'full'}`, category: 'concept', title: material?.revisions.find(revision => revision.revisionId === selected.revisionId)?.title ?? '标题不可读取', aliases: [], scope: '', bodyPreview: null, bodyTruncated: false, status: 'unavailable', contentRef: { storeId: selected.storeId, materialId: selected.materialId, revisionId: selected.revisionId }, materialId: selected.materialId, caution: null, sourceRefs: [ref], sourceIssues: [], sources: [], conceptUses: [], matches: [] };
                  try {
                    const source = await deps.readSource(ref), revision = await deps.enterprise.readRevision(selected.materialId, selected.revisionId);
                    row.title = source.title; row.scope = revision.scope; Object.assign(row, preview(source.text)); row.status = source.status === 'available' || source.status === 'disabled' ? source.status : 'unavailable'; row.sources.push({ ref, status: source.status }); row.matches = matches(row, source.text, request);
                  } catch (error) { const failure = { ref, code: code(error) }; row.sourceIssues.push(failure); row.sources.push({ ...failure, status: 'unavailable' }); issues.push({ ...failure, itemId: row.id, projectId: project.id }); row.matches = matches(row, null, request); }
                  concepts.set(key, row);
                }
                const use = { projectId: project.id, datasetId: dataset.datasetId, descriptionRevisionId: description.descriptionRevisionId, mappingId: mapping.mappingId };
                if (!row.conceptUses!.some(value => JSON.stringify(value) === JSON.stringify(use))) row.conceptUses!.push(use);
              }
            }
          }
        }
      } catch (error) { issues.push({ code: code(error) }); }
      for (const row of concepts.values()) if (!request.query || row.matches.length) rows.push(row);
    }
    const total = rows.length;
    return { items: rows.slice((request.page - 1) * request.pageSize, request.page * request.pageSize), total, page: request.page, pageSize: request.pageSize, issues, complete: issues.length === 0 };
  };
}

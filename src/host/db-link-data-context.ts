import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { DataContextStatement, DataContextMapping, DataDescriptionRevision, InputVersionRecord } from './project-data-context-types.ts';
import type { DbLinkResults, DbResultOwner } from './db-link-results.ts';
import type { StudioMaterial } from '../../extensions/business-plugins/studio/contracts.ts';
import type { DataContextFieldLocation, DataContextObservation } from './project-data-context-types.ts';
import { fail, object, id, hash, integer, text, relative, canonical, parse } from './project-data-context-io.ts';
import { databaseLocationFromSource, list, statement, mapping } from './project-data-context-validation.ts';

export type DbLinkMetadataObservation = {
  schema: 1; kind: 'db-link-metadata-observation'; id: string; owner: DbResultOwner;
  source: { connectionId: string; connectionRevision: number; sourceIdentity: string; permissionBinding: string; observedAt: string;
    actor?: { loginRole: string; effectiveRole: string; visibleScope: 'current-account-visible' } };
  coverage: { complete: boolean; limitations: string[] };
  objects: { database: string; schema: string; name: string; kind: string; comment?: string; commentBytes?: number | null; commentTruncated?: boolean; columns: { ordinal: number; name: string; databaseType: string; precision: number | null; scale: number | null; nullable?: boolean; comment?: string; commentBytes?: number | null; commentTruncated?: boolean }[]; constraints?: { kind: 'primary-key' | 'unique' | 'foreign-key'; columns: string[]; target?: { database: string; schema: string; object: string; columns: string[] }; validation: 'verified' | 'unverified' | 'unknown' }[] }[];
};
export type DbLinkMetadataReader = { read(owner: DbResultOwner, observationRef: string): Promise<{ observation: DbLinkMetadataObservation; file: { relativePath: string; bytes: number; sha256: string } }> };
export type DbLinkSaveDescriptionInput = {
  resultId?: string; observationRef?: string; operationId: string; name?: string;
  description: { statements: DataContextStatement[]; mappings: DataContextMapping[] };
};
export type DbLinkDataContextOptions = {
  projects: ProjectStore; data: ProjectDataContextStore; results: Pick<DbLinkResults, 'materialFiles'>; metadata?: DbLinkMetadataReader;
  authorize(owner: DbResultOwner, source: { connectionId: string; connectionRevision: number; sourceIdentity: string }): void;
};
export type DbLinkDataContextSaveResult = { inputVersion: InputVersionRecord; description: DataDescriptionRevision; materials: StudioMaterial[]; structureOnly: true };
type StructureSource = {
  sourceId: string; sourceKind: 'query-result' | 'metadata-observation'; record: unknown;
  source: { connectionId: string; connectionRevision: number; sourceIdentity: string }; owner: DbResultOwner;
  file: { relativePath: string; bytes: number; sha256: string }; files: { relativePath: string; bytes: number; sha256: string }[];
  fields: { pointer: string; originalName: string; observedType: string }[]; observedAt: string; limitations: string[];
  coverage: Record<string, unknown>;
};
function exactKeys(value: Record<string, unknown>, keys: string[]): void { if (Object.keys(value).some(key => !keys.includes(key))) fail('invalid_db_description'); }
function sameOwner(actual: DbResultOwner, owner: DbResultOwner): void { if (actual.projectId !== owner.projectId || actual.taskId !== owner.taskId) fail('db_description_foreign_source'); }
function sameSourceNote(previous: string | null | undefined, current: string): boolean {
  if (previous === current) return true;
  if (typeof previous !== 'string') return false;
  try {
    const legacy: unknown = JSON.parse(previous), next: unknown = JSON.parse(current);
    if (!object(legacy) || !object(next) || Object.hasOwn(legacy, 'coverage')) return false;
    const { coverage: _coverage, ...original } = next;
    // New observations may carry richer scope; the original fixed input note stays byte-identical.
    return canonical(legacy) === canonical(original);
  } catch { return false; }
}

export function createDbLinkDataContext(options: DbLinkDataContextOptions) {
  async function source(owner: DbResultOwner, input: DbLinkSaveDescriptionInput): Promise<StructureSource> {
    if (input.resultId) {
      const { receipt, manifest, files } = await options.results.materialFiles(owner, id(input.resultId), { mode: 'structure-description' });
      sameOwner(receipt.owner, owner); sameOwner(manifest.owner, owner);
      const file = files.find(item => item.role === 'manifest');
      if (!file || files.filter(item => item.role === 'manifest').length !== 1 || file.sha256 !== receipt.sha256 || manifest.id !== receipt.id || manifest.status !== receipt.status || !['complete', 'partial', 'failed', 'cancelled'].includes(manifest.status)) return fail('db_description_incomplete_source');
      const actor = { loginRole: manifest.source.session.loginRole ?? null, effectiveRole: manifest.source.session.effectiveRole ?? null, visibleScope: manifest.source.session.visibleScope ?? 'unknown' };
      const coverage = { status: manifest.status, reason: manifest.reason ?? null, driverReceivedRows: manifest.acquisition?.driverReceivedRows ?? null, receivedRows: manifest.receivedRows, persistedRows: manifest.persistedRows, serverRowCount: manifest.serverRowCount, actor, limitations: manifest.source.limitations ?? ['db_source_limitations_unknown'], unknownObjects: manifest.source.unknownObjects };
      return { sourceId: manifest.id, sourceKind: 'query-result', record: manifest, source: { connectionId: manifest.source.connectionId, connectionRevision: manifest.source.connectionRevision, sourceIdentity: manifest.source.sourceIdentity }, owner: manifest.owner, file, files, fields: manifest.columns.map((column, index) => ({ pointer: `/columns/${index}`, originalName: column.name, observedType: column.databaseType })), observedAt: manifest.finishedAt, coverage, limitations: [`固定结果的已知范围（未由说明扫描数据行）：${canonical(coverage)}`, ...manifest.source.unknownObjects.map(value => `未覆盖对象：${value}`)] };
    }
    if (!options.metadata) return fail('db_metadata_source_unavailable');
    const { observation, file } = await options.metadata.read(owner, id(input.observationRef));
    sameOwner(observation.owner, owner);
    if (observation.schema !== 1 || observation.kind !== 'db-link-metadata-observation' || observation.id !== input.observationRef) return fail('db_description_source_changed');
    const coverage = { status: 'metadata-observation', complete: observation.coverage.complete, actor: observation.source.actor ?? { loginRole: null, effectiveRole: null, visibleScope: 'unknown' }, limitations: observation.coverage.limitations };
    return { sourceId: observation.id, sourceKind: 'metadata-observation', record: observation, source: { connectionId: observation.source.connectionId, connectionRevision: observation.source.connectionRevision, sourceIdentity: observation.source.sourceIdentity }, owner: observation.owner, file, files: [file], fields: observation.objects.flatMap((item, objectIndex) => item.columns.map((column, index) => ({ pointer: `/objects/${objectIndex}/columns/${index}`, originalName: column.name, observedType: column.databaseType }))), observedAt: observation.source.observedAt, coverage, limitations: [`目录的已知范围：${canonical(coverage)}`, ...observation.coverage.limitations, ...(!observation.coverage.complete ? ['目录观察范围不完整；未看见不代表对象不存在。'] : [])] };
  }
  async function capture(owner: DbResultOwner, captured: StructureSource): Promise<void> {
    relative(captured.file.relativePath, ['020_clean'], ['.json']); hash(captured.file.sha256); integer(captured.file.bytes);
    for (const file of captured.files) { relative(file.relativePath, ['020_clean'], ['.json']); hash(file.sha256); integer(file.bytes); }
    if (new Set(captured.files.map(file => file.relativePath)).size !== captured.files.length) return fail('db_description_source_changed');
    const actual = await options.projects.captureFeedbackFile(owner.projectId, captured.file.relativePath, 50 * 1024 * 1024);
    if (actual.sha256 !== captured.file.sha256 || actual.bytes.length !== captured.file.bytes || canonical(parse(actual.bytes)) !== canonical(captured.record)) return fail('db_description_source_changed');
  }
  return { async save(owner: DbResultOwner, input: DbLinkSaveDescriptionInput, context: { signal?: AbortSignal; assertCurrent?: () => void } = {}): Promise<DbLinkDataContextSaveResult> {
    if (!object(input) || !object(input.description) || Boolean(input.resultId) === Boolean(input.observationRef)) return fail('invalid_db_description');
    exactKeys(input, ['resultId', 'observationRef', 'operationId', 'name', 'description']); exactKeys(input.description, ['statements', 'mappings']);
    id(input.operationId); if (options.data.writeVersion !== 2) return fail('db_description_version_unavailable');
    const assertCurrent = () => { if (context.signal?.aborted) fail('db_description_cancelled'); context.assertCurrent?.(); };
    assertCurrent(); const project = await options.projects.get(owner.projectId); assertCurrent();
    if (project.archivedAt) return fail('db_project_archived'); if (!project.tasks.some(task => task.id === owner.taskId)) return fail('db_task_not_found');
    const captured = await source(owner, input); assertCurrent(); options.authorize(owner, captured.source);
    await capture(owner, captured); assertCurrent();
    if (captured.fields.length > 1000) return fail('db_description_structure_too_large');
    const assertWritable = () => { assertCurrent(); options.authorize(owner, captured.source); };
    const sourceNote = canonical({ kind: 'db-link-structure-source', sourceKind: captured.sourceKind, sourceId: captured.sourceId, source: captured.source, owner: captured.owner, structureOnly: true, dataRowsFrozenByDataContext: false, coverage: captured.coverage, files: captured.files.map(file => ({ relativePath: file.relativePath, bytes: file.bytes, sha256: file.sha256 })) });
    if (sourceNote.length > 20000) return fail('db_description_source_manifest_too_large');
    const position = (value: DataContextFieldLocation): DataContextFieldLocation => {
      if (value.kind !== 'json-pointer') return fail('data_context_field_version_mismatch');
      if (value.database !== undefined) return fail('db_description_untrusted_source');
      return { ...value, database: databaseLocationFromSource(captured.record, { projectId: owner.projectId, sourcePath: captured.file.relativePath, sha256: captured.file.sha256 }, value.pointer) };
    };
    const statements = list(input.description.statements, value => statement(value)).map(value => {
      if (value.provenance === 'user-statement') return fail('db_description_untrusted_confirmation');
      return { ...value, location: value.location ? position(value.location) : null };
    });
    const mappings = list(input.description.mappings, value => mapping(value)).map(value => {
      if (value.provenance === 'user-statement') return fail('db_description_untrusted_confirmation');
      return { ...value, location: position(value.location) };
    });
    const observed: DataContextObservation = { author: 'agent', format: 'json', encoding: 'UTF-8', recordRule: 'JSON pointer 指向原结构描述；查询数据行位于原结果文件集，未在此说明中扫描或冻结。', coverage: 'partial', scannedRows: 0, totalRows: null, fields: captured.fields.map(field => ({ location: position({ kind: 'json-pointer', pointer: field.pointer }), originalName: field.originalName, observedType: field.observedType })), limitations: ['本输入版本仅固定结构与来源 manifest；不表示数据行已由数据说明 Store 固定或读取，不证明全库结构、业务口径或取数完整。', ...captured.limitations].join('\n'), generatedAt: captured.observedAt, nativeEvidence: null, artifactEvidence: null };
    let index = await options.data.getIndex(owner.projectId); assertWritable();
    let inputVersion: InputVersionRecord;
    if (index?.datasets.find(dataset => dataset.datasetId === captured.sourceId)?.versions.some(version => version.inputVersionId === captured.sourceId)) {
      inputVersion = await options.data.readVersion(owner.projectId, captured.sourceId, captured.sourceId);
      if (inputVersion.sha256 !== captured.file.sha256 || inputVersion.sourcePath !== captured.file.relativePath || !sameSourceNote(inputVersion.sourceNote, sourceNote)) return fail('db_description_source_changed');
    } else {
      const name = text(input.name ?? `数据库结构 ${captured.sourceId}`, 80).trim(); if (!name) return fail('invalid_db_description');
      inputVersion = (await options.data.freezeInput(owner.projectId, { datasetId: captured.sourceId, inputVersionId: captured.sourceId, operationId: captured.sourceId, baseIndexRevision: index?.revision ?? 0, name, sourcePath: captured.file.relativePath, expectedSha256: captured.file.sha256, expectedBytes: captured.file.bytes, sourceNote }, { assertWritable })).record;
    }
    index = await options.data.getIndex(owner.projectId); assertWritable();
    const dataset = index?.datasets.find(dataset => dataset.datasetId === captured.sourceId); if (!dataset) return fail('db_description_source_changed');
    const replayed = dataset.descriptions.some(value => value.descriptionRevisionId === input.operationId) ? await options.data.readDescription(owner.projectId, captured.sourceId, input.operationId) : undefined;
    // A retry retains that operation's observation; richer scope belongs to a new description revision.
    const description = (await options.data.saveDescription(owner.projectId, { operationId: input.operationId, datasetId: captured.sourceId, inputVersionId: captured.sourceId, descriptionRevisionId: input.operationId, baseIndexRevision: replayed?.baseIndexRevision ?? index!.revision, baseDescriptionRevisionId: replayed ? replayed.baseDescriptionRevisionId : dataset.latestDescriptionByInputVersion[captured.sourceId] ?? null, observation: replayed?.observation ?? observed, statements, mappings }, { assertWritable, validateDatabaseSource: async () => {
      const current = await source(owner, input); await capture(owner, current); assertWritable();
      if (canonical(current.record) !== canonical(captured.record) || canonical(current.files) !== canonical(captured.files)) fail('db_description_source_changed');
    } })).record;
    const after = await options.data.getIndex(owner.projectId); assertWritable();
    const exact = after?.datasets.find(value => value.datasetId === captured.sourceId), inputRef = exact?.versions.find(value => value.inputVersionId === inputVersion.inputVersionId), descriptionRef = exact?.descriptions.find(value => value.descriptionRevisionId === description.descriptionRevisionId);
    if (!inputRef || !descriptionRef) return fail('db_description_source_changed');
    const material = (kind: 'data-input' | 'data-description', version: string, sha256: string): StudioMaterial => ({ ref: { authority: 'data', id: captured.sourceId, version, sha256, projectId: owner.projectId, taskId: owner.taskId, locator: JSON.stringify({ kind, projectId: owner.projectId, datasetId: captured.sourceId, inputVersionId: inputVersion.inputVersionId, ...(kind === 'data-description' ? { descriptionRevisionId: description.descriptionRevisionId } : {}) }) }, saved: true, readable: true, note: '准确结构来源／作者说明可作为 Studio 候选材料；未发布、未采用，不授予活库或其他项目结果资格。' });
    return { inputVersion, description, materials: [material('data-input', inputVersion.inputVersionId, inputRef.recordSha256), material('data-description', description.descriptionRevisionId, descriptionRef.recordSha256)], structureOnly: true };
  } };
}

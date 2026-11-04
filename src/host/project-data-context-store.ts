import { projectDataInputRequest, projectDataDescriptionRequest, projectDataCitationRequest } from './project-data-context-request.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectStore } from './project-store.ts';
import type { DataContextSummary, ProjectDataContextIndex, FreezeProjectInput, InputVersionRecord, DataContextWriteResult, SaveDataDescription, DataDescriptionRevision, DataContextAnalysisCopy, ProjectDataContextSelection, ResolvedProjectDataContext, CreateDataCitation, DataCitationRecord, ValidateDataContextReferences, DataContextOperation, DataContextDataset } from './project-data-context-types.ts';
import { ProjectDataContextFault, fail, object, id, hash, integer, text, date, digest, canonical, jsonBytes, exists, relative, directory, safePath, readBytes, parse, writeExclusive, atomicJson } from './project-data-context-io.ts';
import { list, distinct, observation, statement, mapping, concept, sap, native } from './project-data-context-validation.ts';
import { INPUT_MAX_BYTES, INPUT_EXTENSIONS, EVIDENCE_FILE_MAX_BYTES, EVIDENCE_TOTAL_MAX_BYTES, EVIDENCE_EXTENSIONS, dataContextInputFormat } from './project-data-context-contract.ts';
export { ProjectDataContextFault } from './project-data-context-io.ts';

const maxFileBytes = 10 * 1024 * 1024;
const legacyInputExtensions = ['.csv', '.json'];
const inputExtensions = INPUT_EXTENSIONS;
const evidenceExtensions = ['.csv', '.json', '.md', '.txt', '.py', '.sql'];
const empty = (projectId: string): ProjectDataContextIndex => ({ schemaVersion: 1, projectId, revision: 0, datasets: [], citations: [] });
const now = () => new Date().toISOString();
function unique(values: string[]): void { if (new Set(values).size !== values.length) fail('duplicate_data_context_identity'); }
function decodeIndex(value: unknown, projectId: string): ProjectDataContextIndex {
  if (!object(value) || ![1, 2].includes(value.schemaVersion as number) || value.projectId !== projectId || !Array.isArray(value.datasets) || !Array.isArray(value.citations)) return fail('corrupt_data_context_index');
  integer(value.revision);
  for (const item of value.datasets) {
    if (!object(item) || !Array.isArray(item.versions) || !item.versions.length || !Array.isArray(item.descriptions) || !object(item.latestDescriptionByInputVersion)) return fail('corrupt_data_context_index');
    id(item.datasetId); text(item.name, 80); date(item.createdAt); relative(item.sourcePath, ['020_clean'], value.schemaVersion === 1 ? legacyInputExtensions : inputExtensions); if (item.uploadId !== null) id(item.uploadId);
    for (const ref of item.versions) { if (!object(ref)) return fail('corrupt_data_context_index'); id(ref.inputVersionId); hash(ref.recordSha256); }
    unique(item.versions.map(ref => ref.inputVersionId));
    for (const ref of item.descriptions) { if (!object(ref)) return fail('corrupt_data_context_index'); id(ref.descriptionRevisionId); id(ref.inputVersionId); hash(ref.recordSha256); if (!item.versions.some(version => version.inputVersionId === ref.inputVersionId)) return fail('corrupt_data_context_index'); }
    unique(item.descriptions.map(ref => ref.descriptionRevisionId));
    for (const [version, description] of Object.entries(item.latestDescriptionByInputVersion)) { id(version); id(description); if (!item.descriptions.some(ref => ref.inputVersionId === version && ref.descriptionRevisionId === description)) return fail('corrupt_data_context_index'); }
  }
  unique(value.datasets.map(item => item.datasetId));
  for (const ref of value.citations) { if (!object(ref)) return fail('corrupt_data_context_index'); id(ref.citationId); hash(ref.recordSha256); }
  unique(value.citations.map(item => item.citationId));
  return value as unknown as ProjectDataContextIndex;
}
function operation(record: unknown, projectId: string, operationId: string, kind: DataContextOperation['operationKind']): asserts record is DataContextOperation & Record<string, unknown> {
  if (!object(record) || ![1, 2].includes(record.schemaVersion as number) || record.projectId !== projectId || record.operationId !== operationId || record.operationKind !== kind || !object(record.resultRef) || record.resultRef.projectId !== projectId) return fail('corrupt_data_context_record');
  id(record.operationId); hash(record.requestFingerprint); integer(record.baseIndexRevision);
}

export class ProjectDataContextStore {
  readonly writeVersion: 1 | 2;
  readonly options: { dataRoot: string; projects: ProjectStore; validateReferences?: ValidateDataContextReferences; writeVersion?: 1 | 2 };
  constructor(options: { dataRoot: string; projects: ProjectStore; validateReferences?: ValidateDataContextReferences; writeVersion?: 1 | 2 }) {
    if (path.resolve(options.dataRoot) !== options.projects.dataRoot) fail('data_context_root_mismatch');
    this.options = options; this.writeVersion = options.writeVersion ?? 2;
    if (![1, 2].includes(this.writeVersion)) fail('invalid_data_context_write_version');
  }
  #root(projectId: string): string { return path.join(this.options.dataRoot, 'projects', id(projectId), 'data-context'); }
  async #loadIndex(projectId: string, permitIncomplete = false): Promise<ProjectDataContextIndex | null> {
    await this.options.projects.get(projectId); const root = this.#root(projectId);
    if (!await exists(root)) return null;
    await directory(root); const file = await safePath(root, 'index.json');
    if (!await exists(file)) { if (permitIncomplete) return null; return fail('data_context_incomplete_unknown'); }
    return decodeIndex(parse(await readBytes(file, 2 * 1024 * 1024)), projectId);
  }
  async getIndex(projectId: string): Promise<ProjectDataContextIndex | null> { return this.#loadIndex(projectId); }
  #versionPath(datasetId: string, inputVersionId: string): string { return `datasets/${id(datasetId)}/versions/${id(inputVersionId)}/record.json`; }
  #descriptionPath(datasetId: string, descriptionRevisionId: string): string { return `datasets/${id(datasetId)}/descriptions/${id(descriptionRevisionId)}.json`; }
  #citationPath(citationId: string): string { return `citations/${id(citationId)}/record.json`; }
  #dataset(index: ProjectDataContextIndex, datasetId: string): DataContextDataset { return index.datasets.find(dataset => dataset.datasetId === id(datasetId)) ?? fail('data_context_dataset_not_found'); }
  async #record(projectId: string, relativePath: string, expectedHash: string): Promise<unknown> {
    const file = await safePath(this.#root(projectId), relativePath), bytes = await readBytes(file, 2 * 1024 * 1024);
    if (digest(bytes) !== expectedHash) return fail('data_context_record_hash_mismatch');
    return parse(bytes);
  }
  async #inputBytes(projectId: string, record: InputVersionRecord): Promise<Buffer> {
    const expected = `datasets/${record.datasetId}/versions/${record.inputVersionId}/source${path.extname(record.sourcePath).toLowerCase()}`;
    if (record.evidencePath !== expected) return fail('corrupt_data_context_record');
    const bytes = await readBytes(await safePath(this.#root(projectId), expected), record.schemaVersion === 1 ? maxFileBytes : INPUT_MAX_BYTES);
    if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) return fail('data_context_evidence_hash_mismatch');
    return bytes;
  }
  #decodeVersion(value: unknown, projectId: string, datasetId: string, inputVersionId: string): InputVersionRecord {
    operation(value, projectId, inputVersionId, 'freeze-input');
    if (value.datasetId !== datasetId || value.inputVersionId !== inputVersionId || value.resultRef.datasetId !== datasetId || value.resultRef.inputVersionId !== inputVersionId) return fail('corrupt_data_context_record');
    relative(value.sourcePath, ['020_clean'], value.schemaVersion === 1 ? legacyInputExtensions : inputExtensions); hash(value.sha256); integer(value.bytes); if ((value.bytes as number) > (value.schemaVersion === 1 ? maxFileBytes : INPUT_MAX_BYTES)) fail('corrupt_data_context_record'); date(value.savedAt); text(value.evidencePath, 1000);
    if (value.uploadId !== null) id(value.uploadId); if (value.sourceNote !== null) text(value.sourceNote);
    return value as unknown as InputVersionRecord;
  }
  async readVersion(projectId: string, datasetId: string, inputVersionId: string): Promise<InputVersionRecord> {
    const index = await this.#loadIndex(projectId); if (!index) return fail('data_context_version_not_found');
    const ref = this.#dataset(index, datasetId).versions.find(version => version.inputVersionId === id(inputVersionId)); if (!ref) return fail('data_context_version_not_found');
    const record = this.#decodeVersion(await this.#record(projectId, this.#versionPath(datasetId, inputVersionId), ref.recordSha256), projectId, datasetId, inputVersionId);
    await this.#inputBytes(projectId, record); return record;
  }
  async readInputEvidence(projectId: string, datasetId: string, inputVersionId: string): Promise<{ record: InputVersionRecord; bytes: Buffer }> { const record = await this.readVersion(projectId, datasetId, inputVersionId); return { record, bytes: await this.#inputBytes(projectId, record) }; }
  async #publish<T extends DataContextOperation & { schemaVersion: 1 | 2 }>(projectId: string, input: { operationId: string; baseIndexRevision: number }, kind: T['operationKind'], recordPath: string, normalized: unknown, committed: (index: ProjectDataContextIndex) => string | null, decode: (value: unknown) => T, verify: (record: T) => Promise<void>, create: (index: ProjectDataContextIndex) => Promise<T>, append: (index: ProjectDataContextIndex, record: T, recordHash: string) => void, assertWritable?: () => void): Promise<DataContextWriteResult<T>> {
    assertWritable?.();
    id(input.operationId); integer(input.baseIndexRevision); const fingerprint = digest(canonical(normalized)), root = this.#root(projectId), rootExisted = await exists(root), existingIndex = await this.#loadIndex(projectId, true), index = existingIndex ?? empty(projectId);
    if (rootExisted) await this.#assertOperationTarget(root, input.operationId, recordPath);
    const target = await exists(root) ? await this.#possibleTarget(root, recordPath) : null;
    const committedHash = committed(index);
    if (committedHash) {
      const record = decode(await this.#record(projectId, recordPath, committedHash));
      if (record.requestFingerprint !== fingerprint) return fail('data_context_operation_conflict');
      await verify(record); return { record, indexRevision: index.revision, replayed: true, publishedOnRetry: false };
    }
    if (index.citations.some(ref => ref.citationId === input.operationId) || index.datasets.some(dataset => dataset.versions.some(ref => ref.inputVersionId === input.operationId) || dataset.descriptions.some(ref => ref.descriptionRevisionId === input.operationId))) return fail('data_context_operation_conflict');
    if (index.revision !== input.baseIndexRevision) return fail('data_context_revision_conflict');
    let record: T, publishedOnRetry = false;
    if (target) {
      const bytes = await readBytes(target, 2 * 1024 * 1024); record = decode(parse(bytes));
      if (!bytes.equals(jsonBytes(record)) || record.operationKind !== kind || record.requestFingerprint !== fingerprint || record.baseIndexRevision !== index.revision) return fail('data_context_uncommitted_conflict_unknown');
      await verify(record); publishedOnRetry = true;
    } else {
      if (!existingIndex && rootExisted) return fail('data_context_incomplete_unknown');
      assertWritable?.();
      record = await create(index);
      const recordBytes = jsonBytes(record); if (recordBytes.length > 2 * 1024 * 1024) return fail('data_context_metadata_too_large');
      assertWritable?.();
      const file = await safePath(root, recordPath, true); await writeExclusive(file, recordBytes);
      await verify(record);
    }
    const next = structuredClone(index); append(next, record, digest(jsonBytes(record))); if (record.schemaVersion === 2) next.schemaVersion = 2; next.revision++;
    if (!existingIndex && publishedOnRetry) await this.#assertFirstOperationLayout(projectId, recordPath, record);
    decodeIndex(next, projectId); const indexPath = await safePath(root, 'index.json'); assertWritable?.(); await atomicJson(indexPath, next);
    return { record, indexRevision: next.revision, replayed: false, publishedOnRetry };
  }
  async #assertOperationTarget(root: string, operationId: string, expectedRecordPath: string): Promise<void> {
    // Target names reserve the operation UUID even before the index publishes it.
    // Read the existing target slots directly; there is no parallel operation ledger.
    const check = async (targetPath: string, recordPath: string) => {
      if (!await this.#possibleTarget(root, targetPath)) return;
      if (recordPath !== expectedRecordPath) return fail('data_context_operation_conflict');
      if (!await this.#possibleTarget(root, recordPath)) return fail('data_context_uncommitted_conflict_unknown');
    };
    await check(`citations/${operationId}`, this.#citationPath(operationId));
    const datasets = await this.#possibleTarget(root, 'datasets'); if (!datasets) return;
    await directory(datasets);
    for (const entry of await fs.readdir(datasets, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return fail('unsafe_data_context_path');
      const datasetId = id(entry.name), versionPath = this.#versionPath(datasetId, operationId), descriptionPath = this.#descriptionPath(datasetId, operationId);
      await check(`datasets/${datasetId}/versions/${operationId}`, versionPath);
      await check(descriptionPath, descriptionPath);
    }
  }
  async #assertFirstOperationLayout(projectId: string, recordPath: string, record: DataContextOperation & { schemaVersion: 1 | 2 }): Promise<void> {
    // A lost index beside later history must never be reconstructed as a new empty store.
    const evidence: string[] = record.operationKind === 'freeze-input' ? [(record as InputVersionRecord).evidencePath] : record.operationKind === 'record-citation' ? [(record as DataCitationRecord).report, ...(record as DataCitationRecord).attachments].map(file => file.evidencePath) : [];
    const allowedFiles = new Set([recordPath, ...evidence]), allowedDirectories = new Set<string>();
    for (const file of allowedFiles) { const parts = file.split('/'); for (let length = 1; length < parts.length; length++) allowedDirectories.add(parts.slice(0, length).join('/')); }
    const root = this.#root(projectId); let entries = 0;
    const visit = async (prefix: string) => {
      const current = prefix ? path.dirname(await safePath(root, prefix + '/unused')) : root;
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        if (++entries > 1000) return fail('data_context_incomplete_unknown'); const name = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory() && !entry.isSymbolicLink()) { if (!allowedDirectories.has(name)) return fail('data_context_incomplete_unknown'); await visit(name); }
        else if (allowedFiles.has(name)) await readBytes(await safePath(root, name), name === recordPath ? 2 * 1024 * 1024 : record.schemaVersion === 1 ? maxFileBytes : INPUT_MAX_BYTES);
        else if (!prefix && /^index\.json\.[a-f0-9-]{36}\.tmp$/.test(entry.name)) await readBytes(await safePath(root, name), 2 * 1024 * 1024);
        else return fail('data_context_incomplete_unknown');
      }
    };
    await visit('');
  }
  async #possibleTarget(root: string, recordPath: string): Promise<string | null> {
    // Missing parents are normal before the first explicit operation. Existing parents must be safe.
    let current = root; await directory(current); const parts = recordPath.split('/');
    for (const part of parts.slice(0, -1)) { current = path.join(current, part); if (!await exists(current)) return null; await directory(current); }
    const file = path.join(current, parts.at(-1)!); return await exists(file) ? file : null;
  }
  async freezeInput(projectId: string, input: FreezeProjectInput): Promise<DataContextWriteResult<InputVersionRecord>> {
    id(input.datasetId); id(input.inputVersionId); if (input.operationId !== input.inputVersionId) return fail('data_context_operation_target_mismatch');
    const normalized = projectDataInputRequest({ operationId: id(input.operationId), datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: integer(input.baseIndexRevision), name: text(input.name, 80).trim(), sourcePath: relative(input.sourcePath, ['020_clean'], this.writeVersion === 1 ? legacyInputExtensions : inputExtensions), expectedSha256: hash(input.expectedSha256), expectedBytes: integer(input.expectedBytes), uploadId: input.uploadId == null ? null : id(input.uploadId), sourceNote: input.sourceNote == null ? null : text(input.sourceNote) });
    if (!normalized.name || normalized.expectedBytes > (this.writeVersion === 1 ? maxFileBytes : INPUT_MAX_BYTES)) return fail('invalid_data_context_input');
    return this.options.projects.withDataContextMutation(projectId, () => this.#publish(projectId, input, 'freeze-input', this.#versionPath(input.datasetId, input.inputVersionId), normalized,
      index => index.datasets.find(dataset => dataset.datasetId === input.datasetId)?.versions.find(ref => ref.inputVersionId === input.inputVersionId)?.recordSha256 ?? null,
      value => this.#decodeVersion(value, projectId, input.datasetId, input.inputVersionId),
      async record => { if (record.sourcePath !== normalized.sourcePath || record.sha256 !== normalized.expectedSha256 || record.bytes !== normalized.expectedBytes || record.uploadId !== normalized.uploadId || record.sourceNote !== normalized.sourceNote) fail('data_context_operation_conflict'); await this.#inputBytes(projectId, record); },
      async index => {
        // A target UUID may never be reused in another registration or operation kind.
        if (index.datasets.some(dataset => dataset.versions.some(version => version.inputVersionId === input.inputVersionId))) return fail('data_context_operation_conflict');
        const captured = await this.options.projects.captureFeedbackFile(projectId, normalized.sourcePath, this.writeVersion === 1 ? maxFileBytes : INPUT_MAX_BYTES);
        if (captured.sha256 !== normalized.expectedSha256 || captured.bytes.length !== normalized.expectedBytes) return fail('data_context_source_changed');
        if (!normalized.sourcePath.toLowerCase().endsWith('.xlsx')) {
          try { new TextDecoder('utf-8', { fatal: true }).decode(captured.bytes); } catch { return fail('data_context_requires_utf8'); }
        }
        const evidencePath = `datasets/${input.datasetId}/versions/${input.inputVersionId}/source${path.extname(normalized.sourcePath).toLowerCase()}`;
        if (!await exists(this.#root(projectId))) await directory(this.#root(projectId), true);
        await writeExclusive(await safePath(this.#root(projectId), evidencePath, true), captured.bytes);
        return { schemaVersion: this.writeVersion, projectId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, sourcePath: normalized.sourcePath, uploadId: normalized.uploadId, sourceNote: normalized.sourceNote, sha256: captured.sha256, bytes: captured.bytes.length, savedAt: now(), evidencePath, operationId: input.operationId, operationKind: 'freeze-input', requestFingerprint: digest(canonical(normalized)), baseIndexRevision: index.revision, resultRef: { projectId, datasetId: input.datasetId, inputVersionId: input.inputVersionId } };
      },
      (index, record, recordHash) => {
        let dataset = index.datasets.find(item => item.datasetId === input.datasetId);
        if (!dataset) { dataset = { datasetId: input.datasetId, name: normalized.name, createdAt: record.savedAt, sourcePath: normalized.sourcePath, uploadId: normalized.uploadId, versions: [], descriptions: [], latestDescriptionByInputVersion: {} }; index.datasets.push(dataset); }
        dataset.name = normalized.name; dataset.sourcePath = normalized.sourcePath; dataset.uploadId = normalized.uploadId; dataset.versions.push({ inputVersionId: record.inputVersionId, recordSha256: recordHash });
      }));
  }
  async summary(projectId: string): Promise<DataContextSummary> {
    const index = await this.#loadIndex(projectId); if (!index) return { index: null, datasets: [], citations: [] };
    const datasets: DataContextSummary['datasets'] = [];
    for (const dataset of index.datasets) { const versions: InputVersionRecord[] = [], descriptions: DataDescriptionRevision[] = []; for (const ref of dataset.versions) versions.push(await this.readVersion(projectId, dataset.datasetId, ref.inputVersionId)); for (const ref of dataset.descriptions) descriptions.push(await this.readDescription(projectId, dataset.datasetId, ref.descriptionRevisionId)); datasets.push({ dataset, versions, descriptions }); }
    const citations: DataCitationRecord[] = []; for (const ref of index.citations) citations.push(await this.readCitation(projectId, ref.citationId));
    return { index, datasets, citations };
  }
  #decodeDescription(value: unknown, projectId: string, datasetId: string, descriptionRevisionId: string): DataDescriptionRevision {
    operation(value, projectId, descriptionRevisionId, 'save-description');
    if (value.datasetId !== datasetId || value.descriptionRevisionId !== descriptionRevisionId || value.resultRef.datasetId !== datasetId || value.resultRef.descriptionRevisionId !== descriptionRevisionId || value.resultRef.inputVersionId !== value.inputVersionId) return fail('corrupt_data_context_record');
    id(value.inputVersionId); date(value.createdAt); if (value.baseDescriptionRevisionId !== null) id(value.baseDescriptionRevisionId);
    const version = value.schemaVersion === 1 ? 1 : 2;
    const observed = observation(value.observation, version), statements = list(value.statements, item => statement(item, true, version)), mappings = list(value.mappings, item => mapping(item, true, version));
    distinct(statements.map(item => item.statementId)); distinct(mappings.map(item => item.mappingId));
    return { ...value, observation: observed, statements, mappings } as unknown as DataDescriptionRevision;
  }
  async #validateReferences(projectId: string, description: Pick<DataDescriptionRevision, 'observation' | 'mappings'>): Promise<void> {
    const references = { conceptRefs: description.mappings.flatMap(item => item.conceptRefs), sapRefs: description.mappings.flatMap(item => item.sapRefs), nativeEvidence: description.observation.nativeEvidence ? [description.observation.nativeEvidence] : [], artifactEvidence: description.observation.artifactEvidence ? [description.observation.artifactEvidence] : [] };
    if (!Object.values(references).some(items => items.length)) return;
    if (!this.options.validateReferences) return fail('data_context_reference_validation_unavailable');
    await this.options.validateReferences(projectId, references);
  }
  async #validateDescriptionVersion(projectId: string, version: InputVersionRecord, description: Pick<DataDescriptionRevision, 'observation' | 'statements' | 'mappings'>): Promise<void> {
    const format = dataContextInputFormat(version.sourcePath), kinds: Record<string, string> = { csv: 'csv-column', tsv: 'tsv-column', json: 'json-pointer', xlsx: 'xlsx-range', markdown: 'text-range' };
    const locations = [...description.observation.fields.map(field => field.location), ...description.statements.flatMap(item => item.location ? [item.location] : []), ...description.mappings.map(item => item.location)];
    if (!['unknown', 'unsupported'].includes(description.observation.format) && description.observation.format !== format || locations.some(item => item.kind !== kinds[format])) return fail('data_context_field_version_mismatch');
    if (format !== 'markdown' || !locations.length) return;
    // ignoreBOM=true means preserve the BOM character in this decoder. Do not normalise CRLF or Unicode.
    let original: string; try { original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await this.#inputBytes(projectId, version)); } catch (error) { if (error instanceof ProjectDataContextFault) throw error; return fail('data_context_requires_utf8'); }
    const splitsPair = (offset: number) => offset > 0 && offset < original.length && original.charCodeAt(offset - 1) >= 0xd800 && original.charCodeAt(offset - 1) <= 0xdbff && original.charCodeAt(offset) >= 0xdc00 && original.charCodeAt(offset) <= 0xdfff;
    for (const item of locations) if (item.kind === 'text-range' && (item.end > original.length || splitsPair(item.start) || splitsPair(item.end))) return fail('invalid_data_context_text_range');
  }
  async saveDescription(projectId: string, input: SaveDataDescription): Promise<DataContextWriteResult<DataDescriptionRevision>> {
    id(input.datasetId); id(input.inputVersionId); id(input.descriptionRevisionId); if (input.operationId !== input.descriptionRevisionId) return fail('data_context_operation_target_mismatch');
    const statements = list(input.statements, item => statement(item, false, this.writeVersion)), mappings = list(input.mappings, item => mapping(item, false, this.writeVersion));
    distinct(statements.map(item => item.statementId)); distinct(mappings.map(item => item.mappingId));
    const confirmStatementIds = list(input.confirmStatementIds ?? [], item => id(item)).sort(), confirmMappingIds = list(input.confirmMappingIds ?? [], item => id(item)).sort(); distinct(confirmStatementIds); distinct(confirmMappingIds);
    const baseDescriptionRevisionId = input.baseDescriptionRevisionId == null ? null : id(input.baseDescriptionRevisionId), confirmedBy = input.confirmedBy == null ? null : text(input.confirmedBy, 200);
    if (confirmStatementIds.some(selected => !statements.some(item => item.statementId === selected)) || confirmMappingIds.some(selected => !mappings.some(item => item.mappingId === selected)) || (confirmStatementIds.length + confirmMappingIds.length > 0 && (!baseDescriptionRevisionId || !confirmedBy?.trim()))) return fail('invalid_data_context_confirmation');
    const normalized = projectDataDescriptionRequest({ operationId: id(input.operationId), datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: input.descriptionRevisionId, baseIndexRevision: integer(input.baseIndexRevision), baseDescriptionRevisionId, observation: observation(input.observation, this.writeVersion), statements, mappings, confirmStatementIds, confirmMappingIds, confirmedBy });
    return this.options.projects.withDataContextMutation(projectId, () => this.#publish(projectId, input, 'save-description', this.#descriptionPath(input.datasetId, input.descriptionRevisionId), normalized,
      index => index.datasets.find(dataset => dataset.datasetId === input.datasetId)?.descriptions.find(ref => ref.descriptionRevisionId === input.descriptionRevisionId)?.recordSha256 ?? null,
      value => this.#decodeDescription(value, projectId, input.datasetId, input.descriptionRevisionId),
      async record => {
        if (record.inputVersionId !== input.inputVersionId || record.baseDescriptionRevisionId !== baseDescriptionRevisionId || canonical(record.observation) !== canonical(normalized.observation) || canonical(record.statements.map(item => statement(item))) !== canonical(statements) || canonical(record.mappings.map(item => mapping(item))) !== canonical(mappings) || canonical(record.statements.filter(item => item.confirmed).map(item => item.statementId).sort()) !== canonical(confirmStatementIds) || canonical(record.mappings.filter(item => item.confirmed).map(item => item.mappingId).sort()) !== canonical(confirmMappingIds) || [...record.statements, ...record.mappings].some(item => item.confirmed && (item.confirmedAt !== record.createdAt || item.confirmedBy !== confirmedBy))) return fail('data_context_operation_conflict');
        await this.#validateDescriptionVersion(projectId, await this.readVersion(projectId, input.datasetId, record.inputVersionId), record);
      },
      async index => {
        const version = await this.readVersion(projectId, input.datasetId, input.inputVersionId);
        await this.#validateDescriptionVersion(projectId, version, normalized);
        if (baseDescriptionRevisionId) {
          const base = await this.readDescription(projectId, input.datasetId, baseDescriptionRevisionId); if (base.inputVersionId !== input.inputVersionId) return fail('data_context_description_version_mismatch');
          // A confirmation refers to an unchanged statement/mapping of its exact base revision.
          for (const selected of confirmStatementIds) { const current = statements.find(item => item.statementId === selected)!, prior = base.statements.find(item => item.statementId === selected); if (!prior || canonical(statement(prior)) !== canonical(current)) return fail('data_context_confirmation_content_changed'); }
          for (const selected of confirmMappingIds) { const current = mappings.find(item => item.mappingId === selected)!, prior = base.mappings.find(item => item.mappingId === selected); if (!prior || canonical(mapping(prior)) !== canonical(current)) return fail('data_context_confirmation_content_changed'); }
        }
        await this.#validateReferences(projectId, normalized);
        const createdAt = now(), confirm = (selected: boolean) => ({ confirmed: selected, confirmedAt: selected ? createdAt : null, confirmedBy: selected ? confirmedBy : null });
        return { schemaVersion: this.writeVersion, projectId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: input.descriptionRevisionId, createdAt, baseDescriptionRevisionId, observation: normalized.observation, statements: statements.map(item => ({ ...item, ...confirm(confirmStatementIds.includes(item.statementId)) })), mappings: mappings.map(item => ({ ...item, ...confirm(confirmMappingIds.includes(item.mappingId)) })), operationId: input.operationId, operationKind: 'save-description', requestFingerprint: digest(canonical(normalized)), baseIndexRevision: index.revision, resultRef: { projectId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: input.descriptionRevisionId } };
      },
      (index, record, recordHash) => { const dataset = this.#dataset(index, input.datasetId); dataset.descriptions.push({ descriptionRevisionId: record.descriptionRevisionId, inputVersionId: record.inputVersionId, recordSha256: recordHash }); dataset.latestDescriptionByInputVersion[record.inputVersionId] = record.descriptionRevisionId; }));
  }
  async readDescription(projectId: string, datasetId: string, descriptionRevisionId: string): Promise<DataDescriptionRevision> {
    const index = await this.#loadIndex(projectId); if (!index) return fail('data_context_description_not_found'); const dataset = this.#dataset(index, datasetId), ref = dataset.descriptions.find(item => item.descriptionRevisionId === id(descriptionRevisionId)); if (!ref) return fail('data_context_description_not_found');
    const record = this.#decodeDescription(await this.#record(projectId, this.#descriptionPath(datasetId, descriptionRevisionId), ref.recordSha256), projectId, datasetId, descriptionRevisionId); if (record.inputVersionId !== ref.inputVersionId) return fail('data_context_description_version_mismatch'); await this.#validateDescriptionVersion(projectId, await this.readVersion(projectId, datasetId, record.inputVersionId), record); return record;
  }
  #analysisPath(version: InputVersionRecord): string { return `020_clean/optracall-data-context/${version.datasetId}/${version.inputVersionId}/input${path.extname(version.sourcePath).toLowerCase()}`; }
  async #analysisCopy(projectId: string, version: InputVersionRecord): Promise<DataContextAnalysisCopy> {
    const copyPath = this.#analysisPath(version), project = await this.options.projects.get(projectId);
    if (!await this.#possibleTarget(project.rootPath, copyPath)) return fail('data_context_analysis_copy_not_prepared');
    const captured = await this.options.projects.captureFeedbackFile(projectId, copyPath, version.schemaVersion === 1 ? maxFileBytes : INPUT_MAX_BYTES);
    if (captured.sha256 !== version.sha256 || captured.bytes.length !== version.bytes) return fail('data_context_analysis_copy_changed');
    const stat = await fs.lstat(await safePath(project.rootPath, copyPath));
    return { projectId, datasetId: version.datasetId, inputVersionId: version.inputVersionId, path: copyPath, sha256: version.sha256, bytes: version.bytes, preparedAt: stat.birthtime.toISOString() };
  }
  async prepareAnalysisCopy(projectId: string, datasetId: string, inputVersionId: string, _replaceChanged = false): Promise<DataContextAnalysisCopy> {
    return this.options.projects.withDataContextMutation(projectId, async project => {
      const { record, bytes } = await this.readInputEvidence(projectId, datasetId, inputVersionId), copyPath = this.#analysisPath(record), existing = await this.#possibleTarget(project.rootPath, copyPath);
      // A user-modified copy remains theirs. Even explicit re-prepare never overwrites it.
      if (existing) return this.#analysisCopy(projectId, record);
      await writeExclusive(await safePath(project.rootPath, copyPath, true), bytes); return this.#analysisCopy(projectId, record);
    });
  }
  #selection(input: ProjectDataContextSelection): ProjectDataContextSelection {
    if (!object(input) || input.descriptionRevisionId === undefined) return fail('data_context_exact_selection_required');
    return { datasetId: id(input.datasetId), inputVersionId: id(input.inputVersionId), descriptionRevisionId: input.descriptionRevisionId === null ? null : id(input.descriptionRevisionId) };
  }
  async #selectedRecords(projectId: string, input: ProjectDataContextSelection): Promise<{ selection: ProjectDataContextSelection; version: InputVersionRecord; description: DataDescriptionRevision | null }> {
    const selection = this.#selection(input), version = await this.readVersion(projectId, selection.datasetId, selection.inputVersionId), description = selection.descriptionRevisionId === null ? null : await this.readDescription(projectId, selection.datasetId, selection.descriptionRevisionId);
    if (description && description.inputVersionId !== selection.inputVersionId) return fail('data_context_description_version_mismatch');
    return { selection, version, description };
  }
  async resolveSelection(projectId: string, input: ProjectDataContextSelection): Promise<ResolvedProjectDataContext> {
    const selected = await this.#selectedRecords(projectId, input); return { ...selected, analysisCopy: await this.#analysisCopy(projectId, selected.version), providedAt: now() };
  }
  #expectFile(value: unknown, report = false, schemaVersion: 1 | 2 = this.writeVersion): CreateDataCitation['report'] {
    if (!object(value)) return fail('invalid_data_context_evidence'); const bytes = integer(value.bytes); if (bytes > (schemaVersion === 1 ? maxFileBytes : EVIDENCE_FILE_MAX_BYTES)) return fail('data_context_file_too_large');
    return { path: relative(value.path, report ? ['060_reports'] : ['020_clean', '060_reports'], schemaVersion === 1 ? evidenceExtensions : EVIDENCE_EXTENSIONS), sha256: hash(value.sha256), bytes };
  }
  #decodeCitation(value: unknown, projectId: string, citationId: string): DataCitationRecord {
    operation(value, projectId, citationId, 'record-citation');
    if (value.citationId !== citationId || value.resultRef.citationId !== citationId || !['user', 'agent'].includes(value.declarer as string) || typeof value.sourcesDeclared !== 'boolean') return fail('corrupt_data_context_record');
    date(value.savedAt); text(value.declaration); if (value.revisionReason !== null) text(value.revisionReason);
    const decodeFile = (input: unknown, report = false) => { if (!object(input)) return fail('corrupt_data_context_record'); const expected = this.#expectFile({ path: input.originalPath, bytes: input.bytes, sha256: input.sha256 }, report, value.schemaVersion === 1 ? 1 : 2); return { originalPath: expected.path, bytes: expected.bytes, sha256: expected.sha256, evidencePath: text(input.evidencePath, 1000) }; };
    const report = decodeFile(value.report, true), attachments = list(value.attachments, input => decodeFile(input), 19), selections = list(value.selections, item => this.#selection(item as ProjectDataContextSelection)), conceptRefs = list(value.conceptRefs, concept), sapRefs = list(value.sapRefs, sap), nativeEvidence = native(value.nativeEvidence);
    if (value.sourcesDeclared !== (selections.length + conceptRefs.length + sapRefs.length > 0) || report.bytes + attachments.reduce((total, file) => total + file.bytes, 0) > (value.schemaVersion === 1 ? 50 * 1024 * 1024 : EVIDENCE_TOTAL_MAX_BYTES)) return fail('corrupt_data_context_record');
    return { ...value, report, attachments, selections, conceptRefs, sapRefs, nativeEvidence } as unknown as DataCitationRecord;
  }
  async #citationFile(projectId: string, record: DataCitationRecord, attachmentIndex: number | null): Promise<{ file: DataCitationRecord['report']; bytes: Buffer }> {
    const file = attachmentIndex === null ? record.report : record.attachments[integer(attachmentIndex)]; if (!file) return fail('data_context_evidence_not_found');
    const expected = `citations/${record.citationId}/${attachmentIndex === null ? 'report' : 'attachment-' + String(attachmentIndex).padStart(4, '0')}${path.extname(file.originalPath).toLowerCase()}`;
    if (file.evidencePath !== expected) return fail('corrupt_data_context_record'); const bytes = await readBytes(await safePath(this.#root(projectId), expected), record.schemaVersion === 1 ? maxFileBytes : EVIDENCE_FILE_MAX_BYTES);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) return fail('data_context_evidence_hash_mismatch');
    return { file, bytes };
  }
  async #verifyCitation(projectId: string, record: DataCitationRecord): Promise<void> {
    await this.#citationFile(projectId, record, null); for (let index = 0; index < record.attachments.length; index++) await this.#citationFile(projectId, record, index);
    for (const selection of record.selections) await this.#selectedRecords(projectId, selection);
  }
  async createCitation(projectId: string, input: CreateDataCitation, options: { assertWritable?: () => void } = {}): Promise<DataContextWriteResult<DataCitationRecord>> {
    options.assertWritable?.();
    id(input.citationId); if (input.operationId !== input.citationId) return fail('data_context_operation_target_mismatch');
    const report = this.#expectFile(input.report, true), attachments = list(input.attachments, item => this.#expectFile(item), 19), selections = list(input.selections, item => this.#selection(item as ProjectDataContextSelection)), conceptRefs = list(input.conceptRefs, concept), sapRefs = list(input.sapRefs, sap), nativeEvidence = native(input.nativeEvidence);
    distinct([report.path, ...attachments.map(file => file.path)]);
    if (!['user', 'agent'].includes(input.declarer) || report.bytes + attachments.reduce((total, file) => total + file.bytes, 0) > (this.writeVersion === 1 ? 50 * 1024 * 1024 : EVIDENCE_TOTAL_MAX_BYTES)) return fail('invalid_data_context_citation');
    const normalized = projectDataCitationRequest({ operationId: id(input.operationId), citationId: input.citationId, baseIndexRevision: integer(input.baseIndexRevision), report, attachments, selections, conceptRefs, sapRefs, declarer: input.declarer, declaration: text(input.declaration), revisionReason: input.revisionReason == null ? null : text(input.revisionReason), nativeEvidence });
    return this.options.projects.withDataContextMutation(projectId, () => this.#publish(projectId, input, 'record-citation', this.#citationPath(input.citationId), normalized,
      index => index.citations.find(item => item.citationId === input.citationId)?.recordSha256 ?? null,
      value => this.#decodeCitation(value, projectId, input.citationId),
      async record => {
        const fileExpectation = (file: DataCitationRecord['report']) => ({ path: file.originalPath, sha256: file.sha256, bytes: file.bytes });
        const actual = { operationId: record.operationId, citationId: record.citationId, baseIndexRevision: record.baseIndexRevision, report: fileExpectation(record.report), attachments: record.attachments.map(fileExpectation), selections: record.selections, conceptRefs: record.conceptRefs, sapRefs: record.sapRefs, declarer: record.declarer, declaration: record.declaration, revisionReason: record.revisionReason, nativeEvidence: record.nativeEvidence };
        if (canonical(actual) !== canonical(normalized)) return fail('data_context_operation_conflict');
        await this.#verifyCitation(projectId, record);
      },
      async index => {
        for (const selection of selections) await this.#selectedRecords(projectId, selection);
        const refs = { conceptRefs, sapRefs, nativeEvidence: nativeEvidence ? [nativeEvidence] : [], artifactEvidence: [] };
        if (conceptRefs.length + sapRefs.length + refs.nativeEvidence.length) { if (!this.options.validateReferences) return fail('data_context_reference_validation_unavailable'); await this.options.validateReferences(projectId, refs); }
        const captured: { expected: CreateDataCitation['report']; bytes: Buffer }[] = [];
        for (const expected of [report, ...attachments]) {
          const file = await this.options.projects.captureFeedbackFile(projectId, expected.path, this.writeVersion === 1 ? maxFileBytes : EVIDENCE_FILE_MAX_BYTES); if (file.sha256 !== expected.sha256 || file.bytes.length !== expected.bytes) return fail('data_context_source_changed');
          try { new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); } catch { return fail('data_context_requires_utf8'); }
          captured.push({ expected, bytes: file.bytes });
        }
        options.assertWritable?.();
        if (!await exists(this.#root(projectId))) await directory(this.#root(projectId), true);
        const files: DataCitationRecord['report'][] = [];
        for (let position = 0; position < captured.length; position++) { options.assertWritable?.(); const { expected, bytes } = captured[position], evidencePath = `citations/${input.citationId}/${position === 0 ? 'report' : 'attachment-' + String(position - 1).padStart(4, '0')}${path.extname(expected.path).toLowerCase()}`; await writeExclusive(await safePath(this.#root(projectId), evidencePath, true), bytes); files.push({ originalPath: expected.path, sha256: expected.sha256, bytes: expected.bytes, evidencePath }); }
        return { schemaVersion: this.writeVersion, projectId, citationId: input.citationId, savedAt: now(), report: files[0], attachments: files.slice(1), selections, conceptRefs, sapRefs, declarer: input.declarer, declaration: normalized.declaration, revisionReason: normalized.revisionReason, nativeEvidence, sourcesDeclared: selections.length + conceptRefs.length + sapRefs.length > 0, operationId: input.operationId, operationKind: 'record-citation', requestFingerprint: digest(canonical(normalized)), baseIndexRevision: index.revision, resultRef: { projectId, citationId: input.citationId } };
      },
      (index, record, recordHash) => { index.citations.push({ citationId: record.citationId, recordSha256: recordHash }); }, options.assertWritable));
  }
  /** Exact declaration metadata survives loss of an independently referenced
   * source. This verifies the original index/record identity, not source bytes. */
  async readCitationManifest(projectId: string, citationId: string): Promise<DataCitationRecord> {
    id(citationId); const index = await this.#loadIndex(projectId), ref = index?.citations.find(item => item.citationId === citationId); if (!ref) return fail('data_context_citation_not_found');
    return this.#decodeCitation(await this.#record(projectId, this.#citationPath(citationId), ref.recordSha256), projectId, citationId);
  }
  async readCitation(projectId: string, citationId: string): Promise<DataCitationRecord> {
    const record = await this.readCitationManifest(projectId, citationId); await this.#verifyCitation(projectId, record); return record;
  }
  /** Read one requested original file; other missing sources stay separate gaps. */
  async readCitationEvidenceFile(projectId: string, citationId: string, attachmentIndex: number | null = null): Promise<{ file: DataCitationRecord['report']; bytes: Buffer }> { return this.#citationFile(projectId, await this.readCitationManifest(projectId, citationId), attachmentIndex); }
  async readCitationEvidence(projectId: string, citationId: string, attachmentIndex: number | null = null): Promise<{ file: DataCitationRecord['report']; bytes: Buffer }> { return this.#citationFile(projectId, await this.readCitation(projectId, citationId), attachmentIndex); }
}

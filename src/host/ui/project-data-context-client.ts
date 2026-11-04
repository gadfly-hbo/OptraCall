import { canonicalDataContextValue, projectDataInputRequest, projectDataDescriptionRequest, projectDataDescriptionWireInput, projectDataCitationRequest } from '../project-data-context-request.ts';
import { dataContextInputFormat, normalizeXlsxRange, EVIDENCE_FILE_MAX_BYTES } from '../project-data-context-contract.ts';
import type { CreateDataCitation, DataCitationRecord, DataContextAnalysisCopy, DataContextConceptRef, DataContextSapRef, DataContextObservation, DataContextFieldLocation, DataContextStatement, DataContextMapping, DataContextSummary, DataContextWriteResult, DataDescriptionRevision, FreezeProjectInput, InputVersionRecord, ProjectDataContextSelection, SaveDataDescription } from '../project-data-context-types.ts';
import type { ProjectDataContextProvision } from '../project-data-context-context.ts';
export type { ProjectDataContextSelection } from '../project-data-context-types.ts';

export type TaskProjectDataSelections = Record<string, ProjectDataContextSelection[]>;
export const projectDataSelectionKey = (value: ProjectDataContextSelection) => `${value.datasetId}/${value.inputVersionId}/${value.descriptionRevisionId ?? ''}`;
export function addTaskProjectDataSelection(state: TaskProjectDataSelections, projectId: string, taskId: string, selection: ProjectDataContextSelection): TaskProjectDataSelections {
  const key = `${projectId}/${taskId}`, current = state[key] ?? [];
  return current.some(value => projectDataSelectionKey(value) === projectDataSelectionKey(selection)) ? state : { ...state, [key]: [...current, selection] };
}

export function observationCount(value: string): number | null {
  if (!value.trim()) return null;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('记录数须为非负整数，未知请留空。');
  return count;
}
/** Validate declared coordinates only; the Host checks them against exact fixed bytes. */
export function parseDataFieldLocation(input: unknown): DataContextFieldLocation {
  const invalid = (): never => { throw new Error('字段位置格式无效；保留原草稿，请核对当前格式的位置。'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const field = input as Record<string, unknown>;
  const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
  if (field.kind === 'csv-column' || field.kind === 'tsv-column') return { kind: field.kind, columnIndex: integer(field.columnIndex) };
  if (field.kind === 'text-range') { const start = integer(field.start), end = integer(field.end); if (end <= start) return invalid(); return { kind: 'text-range', start, end }; }
  if (field.kind === 'json-pointer' && typeof field.pointer === 'string' && field.pointer.length <= 1000 && field.pointer.startsWith('/') && !/~(?![01])/.test(field.pointer)) return { kind: 'json-pointer', pointer: field.pointer };
  if (field.kind === 'xlsx-range' && typeof field.sheetName === 'string' && field.sheetName.length > 0 && field.sheetName.length <= 1000 && !field.sheetName.includes('\0') && typeof field.range === 'string') { try { return { kind: 'xlsx-range', sheetName: field.sheetName, range: normalizeXlsxRange(field.range) }; } catch { throw new Error('请填写有界的大写 A1 单元格或矩形范围，不含工作表前缀、$、公式或外链；列限 A–XFD，行限 1–1,048,576。'); } }
  return invalid();
}
export function projectDataFieldLocationLabel(value: DataContextFieldLocation | null): string {
  if (!value) return '整份数据';
  switch (value.kind) {
    case 'csv-column': case 'tsv-column': return `第 ${value.columnIndex + 1} 列（位置 ${value.columnIndex}）`;
    case 'xlsx-range': return `工作表「${value.sheetName}」 · ${value.range}`;
    case 'json-pointer': return value.pointer || '记录对象';
    case 'text-range': return `原文 UTF-16 [${value.start}, ${value.end})`;
  }
}
export function parseObservationImport(source: string): DataContextObservation {
  const invalid = (): never => { throw new Error('观察文件格式或来源证据不完整，请核对记录范围和字段位置；原草稿保留。'); };
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const text = (value: unknown, max = 20000): string => typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : invalid();
  const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
  const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : invalid();
  const date = (value: unknown): string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? value : invalid();
  let value: unknown; try { value = JSON.parse(source); } catch { throw new Error('观察文件不是有效 JSON；原草稿保留。'); }
  if (!object(value) || typeof value.author !== 'string' || !['user', 'agent', 'unknown'].includes(value.author) || typeof value.format !== 'string' || !['csv', 'tsv', 'json', 'xlsx', 'markdown', 'unsupported', 'unknown'].includes(value.format) || typeof value.coverage !== 'string' || !['complete', 'partial', 'unobserved'].includes(value.coverage) || !Array.isArray(value.fields) || value.fields.length > 1000) return invalid();
  const scannedRows = value.scannedRows === null ? null : integer(value.scannedRows), totalRows = value.totalRows === null ? null : integer(value.totalRows);
  const fields: DataContextObservation['fields'] = value.fields.map(field => {
    if (!object(field) || !object(field.location)) return invalid();
    const location = parseDataFieldLocation(field.location);
    return { location, originalName: text(field.originalName, 1000), observedType: text(field.observedType, 1000) };
  });
  const limitations = text(value.limitations), encoding = value.encoding === null ? null : text(value.encoding, 1000), recordRule = value.recordRule === null ? null : text(value.recordRule, 2000);
  if (value.coverage === 'complete' && (scannedRows === null || totalRows === null || scannedRows !== totalRows) || value.coverage === 'unobserved' && (scannedRows !== null || totalRows !== null || fields.length) || value.coverage === 'partial' && !limitations.trim() || scannedRows !== null && totalRows !== null && scannedRows > totalRows) return invalid();
  if (['unknown', 'unsupported'].includes(String(value.format)) && value.coverage !== 'unobserved' || fields.some(field => field.location.kind !== ({ csv: 'csv-column', tsv: 'tsv-column', json: 'json-pointer', xlsx: 'xlsx-range', markdown: 'text-range' } as Record<string, string>)[String(value.format)]) || new Set(fields.map(field => JSON.stringify(field.location))).size !== fields.length) return invalid();
  if (value.coverage !== 'unobserved' && (!recordRule?.trim() || ['csv', 'tsv', 'markdown'].includes(String(value.format)) && !encoding?.trim())) return invalid();
  if (value.format === 'markdown' && value.coverage === 'unobserved' && recordRule !== null) return invalid();
  let nativeEvidence: DataContextObservation['nativeEvidence'] = null, artifactEvidence: DataContextObservation['artifactEvidence'] = null;
  if (value.nativeEvidence != null) {
    if (!object(value.nativeEvidence)) return invalid();
    const taskId = text(value.nativeEvidence.taskId, 1000), nativeSessionId = text(value.nativeEvidence.nativeSessionId, 1000), entryId = text(value.nativeEvidence.entryId, 1000);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(taskId) || !nativeSessionId || !entryId) return invalid();
    nativeEvidence = { taskId, nativeSessionId, entryId };
  }
  if (value.artifactEvidence != null) {
    if (!object(value.artifactEvidence)) return invalid();
    const path = text(value.artifactEvidence.path, 1000), parts = path.split('/');
    if (parts.length < 2 || !['020_clean', '060_reports'].includes(parts[0]!) || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\') || /[\u0000-\u001f\u007f]/.test(part))) return invalid();
    artifactEvidence = { path, sha256: hash(value.artifactEvidence.sha256) };
  }
  return { author: value.author as DataContextObservation['author'], format: value.format as DataContextObservation['format'], coverage: value.coverage as DataContextObservation['coverage'], encoding, recordRule, scannedRows, totalRows, fields, limitations, generatedAt: value.generatedAt === null ? null : date(value.generatedAt), nativeEvidence, artifactEvidence };
}
export type ProjectDataProvisionView = Pick<ProjectDataContextProvision, 'selection' | 'version' | 'analysisCopy' | 'providedAt'> & { description: Pick<DataDescriptionRevision, 'projectId' | 'datasetId' | 'inputVersionId' | 'descriptionRevisionId' | 'observation' | 'statements' | 'mappings'> | null };
export type ProjectDataProvisionEntry = { kind: 'available'; index: number; value: ProjectDataProvisionView } | { kind: 'unknown'; index: number };
/** A read-only projection of native JSON; invalid entries stay visible and never acquire current-source defaults. */
export function projectDataProvisionEntries(value: unknown, expectedProjectId?: string): ProjectDataProvisionEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) return [{ kind: 'unknown', index: 0 }];
  const invalid = (): never => { throw new Error('unreadable_project_data_receipt'); };
  const object = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : invalid();
  const text = (input: unknown, max = 20000): string => typeof input === 'string' && input.length <= max && !input.includes('\0') ? input : invalid();
  const nonempty = (input: unknown, max = 1000) => { const result = text(input, max); return result ? result : invalid(); };
  const uuid = (input: unknown) => typeof input === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input) ? input : invalid();
  const hash = (input: unknown) => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input) ? input : invalid();
  const integer = (input: unknown): number => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : invalid();
  const date = (input: unknown) => typeof input === 'string' && /^\d{4}-\d\d-\d\dT/.test(input) && Number.isFinite(Date.parse(input)) ? input : invalid();
  const list = <T,>(input: unknown, normalize: (item: unknown) => T): T[] => Array.isArray(input) && input.length <= 1000 ? input.map(normalize) : invalid();
  const cleanPath = (input: unknown) => { const result = text(input, 1000), parts = result.split('/'); return parts.length >= 2 && parts[0] === '020_clean' && parts.every(part => part && part !== '.' && part !== '..' && !part.includes('\\') && !/[\u0000-\u001f\u007f]/.test(part)) ? result : invalid(); };
  const location = parseDataFieldLocation;
  const provenance = (input: unknown): DataContextStatement['provenance'] => input === 'user-statement' || input === 'agent-inference' || input === 'unknown' ? input : invalid();
  const confirmation = (item: Record<string, unknown>) => { if (typeof item.confirmed !== 'boolean') return invalid(); if (!item.confirmed) return item.confirmedAt === null && item.confirmedBy === null ? { confirmed: false, confirmedAt: null, confirmedBy: null } : invalid(); const confirmedBy = nonempty(item.confirmedBy, 200); if (!confirmedBy.trim()) return invalid(); return { confirmed: true, confirmedAt: date(item.confirmedAt), confirmedBy }; };
  const concept = (input: unknown): DataContextConceptRef => { const item = object(input), ref: DataContextConceptRef = { storeId: nonempty(item.storeId, 200), materialId: uuid(item.materialId), revisionId: uuid(item.revisionId) }; if (item.location !== undefined) { const range = object(item.location), start = integer(range.start), end = integer(range.end); if (end <= start) return invalid(); ref.location = { start, end }; } return ref; };
  const sap = (input: unknown): DataContextSapRef => { const item = object(input); return { packageId: nonempty(item.packageId, 200), version: nonempty(item.version, 200), metricName: nonempty(item.metricName, 1000), publishedHash: item.publishedHash === null ? null : hash(item.publishedHash) }; };
  const statement = (input: unknown): DataContextStatement => { const item = object(input); if (typeof item.scope !== 'string' || !['row-meaning', 'business-time', 'field', 'source-and-limitations'].includes(item.scope)) return invalid(); const field = item.location === null ? null : location(item.location); if (item.scope === 'field' && !field) return invalid(); return { statementId: uuid(item.statementId), scope: item.scope as DataContextStatement['scope'], location: field, text: text(item.text), unit: item.unit === null ? null : text(item.unit, 1000), provenance: provenance(item.provenance), ...confirmation(item) }; };
  const mapping = (input: unknown): DataContextMapping => { const item = object(input), conceptRefs = list(item.conceptRefs, concept), sapRefs = list(item.sapRefs, sap); if (!conceptRefs.length && !sapRefs.length) return invalid(); return { mappingId: uuid(item.mappingId), location: location(item.location), conceptRefs, sapRefs, dispute: text(item.dispute), provenance: provenance(item.provenance), ...confirmation(item) }; };
  return value.map((raw, index): ProjectDataProvisionEntry => {
    try {
      const item = object(raw), chosen = object(item.selection), input = object(item.version), copy = object(item.analysisCopy);
      const selection = { datasetId: uuid(chosen.datasetId), inputVersionId: uuid(chosen.inputVersionId), descriptionRevisionId: chosen.descriptionRevisionId === null ? null : uuid(chosen.descriptionRevisionId) };
      const version = { projectId: uuid(input.projectId), datasetId: uuid(input.datasetId), inputVersionId: uuid(input.inputVersionId), sourcePath: cleanPath(input.sourcePath), sha256: hash(input.sha256), bytes: integer(input.bytes), savedAt: date(input.savedAt) };
      if (version.datasetId !== selection.datasetId || version.inputVersionId !== selection.inputVersionId || expectedProjectId !== undefined && version.projectId !== expectedProjectId) return { kind: 'unknown', index };
      const analysisCopy = { path: cleanPath(copy.path), sha256: hash(copy.sha256), bytes: integer(copy.bytes), preparedAt: date(copy.preparedAt) };
      if (analysisCopy.sha256 !== version.sha256 || analysisCopy.bytes !== version.bytes) return { kind: 'unknown', index };
      let description: ProjectDataProvisionView['description'] = null;
      if (selection.descriptionRevisionId !== null) {
        const data = object(item.description);
        description = { projectId: uuid(data.projectId), datasetId: uuid(data.datasetId), inputVersionId: uuid(data.inputVersionId), descriptionRevisionId: uuid(data.descriptionRevisionId), observation: parseObservationImport(JSON.stringify(data.observation)), statements: list(data.statements, statement), mappings: list(data.mappings, mapping) };
        if (description.projectId !== version.projectId || description.datasetId !== selection.datasetId || description.inputVersionId !== selection.inputVersionId || description.descriptionRevisionId !== selection.descriptionRevisionId) return { kind: 'unknown', index };
        const format = dataContextInputFormat(version.sourcePath), locationKind = ({ csv: 'csv-column', tsv: 'tsv-column', json: 'json-pointer', xlsx: 'xlsx-range', markdown: 'text-range' } as Record<string, string>)[format];
        if (!['unknown', 'unsupported'].includes(description.observation.format) && description.observation.format !== format || [...description.statements.flatMap(value => value.location ? [value.location] : []), ...description.mappings.map(value => value.location)].some(value => value.kind !== locationKind)) return { kind: 'unknown', index };
      } else if (item.description !== null) return { kind: 'unknown', index };
      return { kind: 'available', index, value: { selection, version, analysisCopy, description, providedAt: date(item.providedAt) } };
    } catch { return { kind: 'unknown', index }; }
  });
}

export class ProjectDataContextRequestError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status: number, message?: string) { super(message ?? (status === 409 ? '资料或版本已经变化，请刷新核对；当前草稿保留。' : '数据说明操作未完成，请核对来源与本机存储。')); this.code = code; this.status = status; }
}
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/data-context`;
async function request<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const result = await response.json();
  if (!response.ok) throw new ProjectDataContextRequestError(result.error ?? result.code ?? 'data_context_failed', response.status, typeof result.message === 'string' ? result.message : undefined);
  return result as T;
}
export type ProjectDataContextReferences = { concepts: (DataContextConceptRef & { title: string })[]; metrics: DataContextSapRef[] };
export type ProjectDataSourceState = 'available' | 'disabled' | 'missing' | 'corrupt' | 'unknown';
export type ProjectDataSourceStatus = { concepts: { ref: DataContextConceptRef; status: ProjectDataSourceState }[]; metrics: { ref: DataContextSapRef; status: ProjectDataSourceState }[] };
export const projectDataSourceStatusLabel = (status: ProjectDataSourceState | undefined) => status === undefined ? '未知（尚未核对）' : ({ available: '可读取', disabled: '已停用', missing: '缺失', corrupt: '损坏', unknown: '未知' })[status];
export type DataContextPreview = { path: string; sha256: string; bytes: number; observedAt: string };
export const readProjectDataContext = (id: string) => request<DataContextSummary>(base(id));
export const previewProjectDataFile = (id: string, path: string) => request<DataContextPreview>(`${base(id)}/preview`, 'POST', { path });
export const readProjectDataReferences = (id: string) => request<ProjectDataContextReferences>(`${base(id)}/references`);
export const readProjectDataConceptSource = (id: string, ref: DataContextConceptRef) => request<{ storeId: string; revision: { revisionId: string; body: string } }>(`${base(id)}/concept-source`, 'POST', { ref });
export const readProjectDataSourceStatus = (id: string, conceptRefs: DataContextConceptRef[], sapRefs: DataContextSapRef[]) => request<ProjectDataSourceStatus>(`${base(id)}/source-status`, 'POST', { conceptRefs, sapRefs });
export const freezeProjectDataInput = (id: string, input: FreezeProjectInput) => request<DataContextWriteResult<InputVersionRecord>>(`${base(id)}/inputs`, 'POST', input);
export const saveProjectDataDescription = (id: string, input: SaveDataDescription) => {
  const body = projectDataDescriptionWireInput(input);
  return request<DataContextWriteResult<DataDescriptionRevision>>(`${base(id)}/descriptions`, 'POST', body);
};
export const prepareProjectDataCopy = (id: string, datasetId: string, inputVersionId: string, replaceChanged = false) => request<{ copy: DataContextAnalysisCopy }>(`${base(id)}/prepare`, 'POST', { datasetId, inputVersionId, ...(replaceChanged ? { replaceChanged } : {}) });
export const recordProjectDataCitation = (id: string, input: CreateDataCitation) => request<DataContextWriteResult<DataCitationRecord>>(`${base(id)}/citations`, 'POST', input);
export const readProjectDataDescription = (id: string, datasetId: string, revisionId: string) => request<{ record: DataDescriptionRevision }>(`${base(id)}/datasets/${encodeURIComponent(datasetId)}/descriptions/${encodeURIComponent(revisionId)}`);
export const readProjectDataCitation = (id: string, citationId: string) => request<{ record: DataCitationRecord }>(`${base(id)}/citations/${encodeURIComponent(citationId)}`);
export type PendingDataContextWrite = { kind: 'input'; input: FreezeProjectInput } | { kind: 'description'; input: SaveDataDescription } | { kind: 'citation'; input: CreateDataCitation };
export type SavedDataContextWrite = { kind: 'input'; record: InputVersionRecord } | { kind: 'description'; record: DataDescriptionRevision } | { kind: 'citation'; record: DataCitationRecord };
/** Query the original identity only. Absence or an incompatible record never dispatches a write. */
export async function readProjectDataWriteStatus(id: string, pending: PendingDataContextWrite): Promise<{ summary: DataContextSummary; saved: SavedDataContextWrite | null }> {
  const summary = await readProjectDataContext(id), input = pending.input;
  let expected: string, expectedFingerprint: string;
  const descriptionWire = pending.kind === 'description' ? projectDataDescriptionWireInput(pending.input) : undefined;
  try {
    const normalized = pending.kind === 'input' ? projectDataInputRequest(pending.input) : pending.kind === 'description' ? projectDataDescriptionRequest(descriptionWire!) : projectDataCitationRequest(pending.input);
    expected = canonicalDataContextValue(normalized);
    expectedFingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)))].map(value => value.toString(16).padStart(2, '0')).join('');
  } catch { return { summary, saved: null }; }
  const matchesRequest = (record: InputVersionRecord | DataDescriptionRevision | DataCitationRecord): boolean => {
    if (record.requestFingerprint !== expectedFingerprint || ![1, 2].includes(record.schemaVersion)) return false;
    try {
      if (pending.kind === 'input' && 'inputVersionId' in record && 'sourcePath' in record) {
        // The original name is represented by the request fingerprint, never by
        // today's mutable dataset label. Other saved input fields are compared.
        return canonicalDataContextValue(projectDataInputRequest({ ...pending.input, operationId: record.operationId, datasetId: record.datasetId, inputVersionId: record.inputVersionId, baseIndexRevision: record.baseIndexRevision, sourcePath: record.sourcePath, expectedBytes: record.bytes, expectedSha256: record.sha256, uploadId: record.uploadId, sourceNote: record.sourceNote })) === expected;
      }
      if (pending.kind === 'description' && 'observation' in record) {
        const rows = [...record.statements, ...record.mappings];
        if (rows.some(value => typeof value.confirmed !== 'boolean' || (value.confirmed ? value.confirmedAt !== record.createdAt || value.confirmedBy !== descriptionWire!.confirmedBy : value.confirmedAt !== null || value.confirmedBy !== null))) return false;
        return canonicalDataContextValue(projectDataDescriptionRequest({ ...descriptionWire!, operationId: record.operationId, datasetId: record.datasetId, inputVersionId: record.inputVersionId, descriptionRevisionId: record.descriptionRevisionId, baseIndexRevision: record.baseIndexRevision, baseDescriptionRevisionId: record.baseDescriptionRevisionId, observation: record.observation, statements: record.statements, mappings: record.mappings, confirmStatementIds: record.statements.filter(value => value.confirmed).map(value => value.statementId), confirmMappingIds: record.mappings.filter(value => value.confirmed).map(value => value.mappingId) })) === expected;
      }
      if (pending.kind === 'citation' && 'report' in record) {
        const file = (value: DataCitationRecord['report']) => ({ path: value.originalPath, bytes: value.bytes, sha256: value.sha256 });
        return canonicalDataContextValue(projectDataCitationRequest({ operationId: record.operationId, citationId: record.citationId, baseIndexRevision: record.baseIndexRevision, report: file(record.report), attachments: record.attachments.map(file), selections: record.selections, conceptRefs: record.conceptRefs, sapRefs: record.sapRefs, declarer: record.declarer, declaration: record.declaration, revisionReason: record.revisionReason, nativeEvidence: record.nativeEvidence })) === expected;
      }
    } catch { return false; }
    return false;
  };
  const owns = (record: InputVersionRecord | DataDescriptionRevision | DataCitationRecord, kind: string) => record.projectId === id && record.operationId === input.operationId && record.operationKind === kind && record.baseIndexRevision === input.baseIndexRevision && record.resultRef?.projectId === id;
  if (pending.kind === 'input') {
    const expected = pending.input, entry = summary.datasets.find(value => value.dataset.datasetId === expected.datasetId);
    const record = entry?.versions.find(value => value.inputVersionId === expected.inputVersionId);
    if (record && matchesRequest(record) && owns(record, 'freeze-input') && record.datasetId === expected.datasetId && record.resultRef.datasetId === expected.datasetId && record.resultRef.inputVersionId === expected.inputVersionId && record.sourcePath === expected.sourcePath && record.sha256 === expected.expectedSha256 && record.bytes === expected.expectedBytes) return { summary, saved: { kind: 'input', record } };
  } else if (pending.kind === 'description') {
    const expected = pending.input, entry = summary.datasets.find(value => value.dataset.datasetId === expected.datasetId);
    const listed = entry?.descriptions.find(value => value.descriptionRevisionId === expected.descriptionRevisionId);
    if (listed && matchesRequest(listed) && owns(listed, 'save-description')) {
      const { record } = await readProjectDataDescription(id, expected.datasetId, expected.descriptionRevisionId);
      if (matchesRequest(record) && owns(record, 'save-description') && record.datasetId === expected.datasetId && record.inputVersionId === expected.inputVersionId && record.descriptionRevisionId === expected.descriptionRevisionId && record.resultRef.datasetId === expected.datasetId && record.resultRef.inputVersionId === expected.inputVersionId && record.resultRef.descriptionRevisionId === expected.descriptionRevisionId) return { summary, saved: { kind: 'description', record } };
    }
  } else {
    const expected = pending.input, listed = summary.citations.find(value => value.citationId === expected.citationId);
    if (listed && matchesRequest(listed) && owns(listed, 'record-citation')) {
      const { record } = await readProjectDataCitation(id, expected.citationId);
      const sameFile = (actual: { originalPath: string; sha256: string; bytes: number }, wanted: { path: string; sha256: string; bytes: number }) => actual.originalPath === wanted.path && actual.sha256 === wanted.sha256 && actual.bytes === wanted.bytes;
      if (matchesRequest(record) && owns(record, 'record-citation') && record.citationId === expected.citationId && record.resultRef.citationId === expected.citationId && sameFile(record.report, expected.report) && record.attachments.length === expected.attachments.length && record.attachments.every((value, index) => sameFile(value, expected.attachments[index]!))) return { summary, saved: { kind: 'citation', record } };
    }
  }
  return { summary, saved: null };
}
export const readProjectDataSapSource = (ref: DataContextSapRef) => request<{ entry: { bytesSha256: string }; document: { metrics: { name: string; definition: string; display_name: string }[] } }>(`/api/metric-factory/library/${encodeURIComponent(ref.packageId)}/${encodeURIComponent(ref.version)}`);
export async function readProjectDataEvidence(id: string, datasetId: string, versionId: string): Promise<string> { return readEvidence(`${base(id)}/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/evidence`); }
export async function readProjectDataEvidenceBytes(id: string, datasetId: string, versionId: string, expected: { bytes: number; sha256: string }): Promise<Uint8Array<ArrayBuffer>> { return readEvidenceBytes(`${base(id)}/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/evidence`, expected); }
export async function readCitationEvidence(id: string, citationId: string, attachmentIndex?: number): Promise<string> { return readEvidence(`${base(id)}/citations/${encodeURIComponent(citationId)}/evidence${attachmentIndex === undefined ? '' : `?attachmentIndex=${attachmentIndex}`}`); }
export async function readCitationEvidenceBytes(id: string, citationId: string, expected: { bytes: number; sha256: string }, attachmentIndex?: number): Promise<Uint8Array<ArrayBuffer>> { return readEvidenceBytes(`${base(id)}/citations/${encodeURIComponent(citationId)}/evidence${attachmentIndex === undefined ? '' : `?attachmentIndex=${attachmentIndex}`}`, expected); }
async function readEvidenceBytes(path: string, expected?: { bytes: number; sha256: string }): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(path, { credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'x-optracall-client': '1' } });
  if (!response.ok) { const result = await response.json(); throw new ProjectDataContextRequestError(result.error ?? result.code ?? 'evidence_unavailable', response.status, result.message); }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > EVIDENCE_FILE_MAX_BYTES) throw new ProjectDataContextRequestError('evidence_too_large', 413, '固定文件超过此入口范围；原引用保留。');
  if (expected) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== expected.bytes || hash !== expected.sha256) throw new ProjectDataContextRequestError('evidence_version_changed', 409, '固定字节与原版本身份不符；保留原引用，不改用当前文件。');
  }
  return bytes;
}
export function projectDataEvidenceText(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new ProjectDataContextRequestError('evidence_not_text', 422, '这份原件不是 UTF-8 文本；可按原字节下载，不作文本或公式解析。'); }
}
export function downloadProjectDataBytes(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const url = URL.createObjectURL(new Blob([bytes]));
  try { const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); }
  finally { URL.revokeObjectURL(url); }
}
export async function readCurrentProjectDataText(id: string, path: string): Promise<DataContextPreview & { text: string }> {
  const observed = await previewProjectDataFile(id, path);
  if (observed.path !== path) throw new ProjectDataContextRequestError('file_owner_changed', 409, '文件路径与原选择不符；保留选择，不改用其他文件。');
  const bytes = await readEvidenceBytes(`/api/projects/${encodeURIComponent(id)}/files/content?path=${encodeURIComponent(path)}&expectedSha256=${encodeURIComponent(observed.sha256)}`, observed);
  return { ...observed, text: projectDataEvidenceText(bytes) };
}
async function readEvidence(path: string): Promise<string> { return projectDataEvidenceText(await readEvidenceBytes(path)); }
export const projectDataError = (error: unknown) => error instanceof Error ? error.message : '数据说明请求未完成，已保存历史仍保留。';

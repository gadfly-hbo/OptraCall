import type { CreateDataCitation, DataContextConceptRef, DataContextFieldLocation, DataContextMapping, DataContextNativeEvidence, DataContextObservation, DataContextSapRef, DataContextStatement, FreezeProjectInput, SaveDataDescription } from './project-data-context-types.ts';

/** The existing canonical byte order, shared by persistence and read-only ACK checks. */
export function canonicalDataContextValue(value: unknown, invalid: () => never = () => { throw new Error('invalid_data_context_value'); }): string {
  if (Array.isArray(value)) return '[' + value.map(item => canonicalDataContextValue(item, invalid)).join(',') + ']';
  if (typeof value === 'object' && value !== null) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalDataContextValue((value as Record<string, unknown>)[key], invalid)).join(',') + '}';
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) return invalid();
  return JSON.stringify(value);
}

// These are structural projections of already-validated values, not a second
// validator or permission boundary. Store validators remain authoritative.
function location(value: DataContextFieldLocation): DataContextFieldLocation {
  switch (value.kind) {
    case 'csv-column': case 'tsv-column': return { kind: value.kind, columnIndex: value.columnIndex };
    case 'json-pointer': return { kind: value.kind, pointer: value.pointer };
    case 'xlsx-range': return { kind: value.kind, sheetName: value.sheetName, range: value.range };
    case 'text-range': return { kind: value.kind, start: value.start, end: value.end };
  }
}
function native(value: DataContextNativeEvidence | null | undefined): DataContextNativeEvidence | null {
  return value == null ? null : { taskId: value.taskId, nativeSessionId: value.nativeSessionId, entryId: value.entryId };
}
function concept(value: DataContextConceptRef): DataContextConceptRef {
  return { storeId: value.storeId, materialId: value.materialId, revisionId: value.revisionId, ...(value.location === undefined ? {} : { location: { start: value.location.start, end: value.location.end } }) };
}
function sap(value: DataContextSapRef): DataContextSapRef {
  return { packageId: value.packageId, version: value.version, metricName: value.metricName, publishedHash: value.publishedHash ?? null };
}
function observation(value: DataContextObservation): DataContextObservation {
  return { author: value.author, format: value.format, encoding: value.encoding, recordRule: value.recordRule, coverage: value.coverage, scannedRows: value.scannedRows, totalRows: value.totalRows,
    fields: value.fields.map(field => ({ location: location(field.location), originalName: field.originalName, observedType: field.observedType })), limitations: value.limitations, generatedAt: value.generatedAt, nativeEvidence: native(value.nativeEvidence), artifactEvidence: value.artifactEvidence == null ? null : { path: value.artifactEvidence.path, sha256: value.artifactEvidence.sha256 } };
}
const unconfirmed = { confirmed: false, confirmedAt: null, confirmedBy: null };
function statement(value: DataContextStatement): DataContextStatement {
  return { statementId: value.statementId, scope: value.scope, location: value.location === null ? null : location(value.location), text: value.text, unit: value.unit, provenance: value.provenance, ...unconfirmed };
}
function mapping(value: DataContextMapping): DataContextMapping {
  return { mappingId: value.mappingId, location: location(value.location), conceptRefs: value.conceptRefs.map(concept), sapRefs: value.sapRefs.map(sap), provenance: value.provenance, dispute: value.dispute, ...unconfirmed };
}

export function projectDataInputRequest(input: FreezeProjectInput) {
  return { operationId: input.operationId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, baseIndexRevision: input.baseIndexRevision, name: input.name.trim(), sourcePath: input.sourcePath, expectedSha256: input.expectedSha256, expectedBytes: input.expectedBytes, uploadId: input.uploadId ?? null, sourceNote: input.sourceNote ?? null };
}
/** Preserve the UI's pre-existing confirmation-label default on the wire. */
export function projectDataDescriptionWireInput(input: SaveDataDescription): SaveDataDescription {
  return input.confirmStatementIds?.length || input.confirmMappingIds?.length ? { ...input, confirmedBy: input.confirmedBy?.trim() || 'user' } : input;
}
export function projectDataDescriptionRequest(input: SaveDataDescription) {
  return { operationId: input.operationId, datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: input.descriptionRevisionId, baseIndexRevision: input.baseIndexRevision, baseDescriptionRevisionId: input.baseDescriptionRevisionId ?? null, observation: observation(input.observation), statements: input.statements.map(statement), mappings: input.mappings.map(mapping), confirmStatementIds: [...(input.confirmStatementIds ?? [])].sort(), confirmMappingIds: [...(input.confirmMappingIds ?? [])].sort(), confirmedBy: input.confirmedBy ?? null };
}
export function projectDataCitationRequest(input: CreateDataCitation) {
  const file = (value: CreateDataCitation['report']) => ({ path: value.path, sha256: value.sha256, bytes: value.bytes });
  return { operationId: input.operationId, citationId: input.citationId, baseIndexRevision: input.baseIndexRevision, report: file(input.report), attachments: input.attachments.map(file), selections: input.selections.map(value => ({ datasetId: value.datasetId, inputVersionId: value.inputVersionId, descriptionRevisionId: value.descriptionRevisionId ?? null })), conceptRefs: input.conceptRefs.map(concept), sapRefs: input.sapRefs.map(sap), declarer: input.declarer, declaration: input.declaration, revisionReason: input.revisionReason ?? null, nativeEvidence: native(input.nativeEvidence) };
}

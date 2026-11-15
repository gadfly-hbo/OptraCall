import type { DataContextFieldLocation, DataContextDatabaseLocation, DataContextObservation, DataContextStatement, DataContextMapping, DataContextConceptRef, DataContextSapRef, DataContextNativeEvidence, DataContextArtifactEvidence, DataContextConfirmation } from './project-data-context-types.ts';
import { fail, object, id, hash, integer, text, date, canonical, relative } from './project-data-context-io.ts';
import { normalizeXlsxRange } from './project-data-context-contract.ts';
export function list<T>(value: unknown, normalize: (item: unknown) => T, maximum = 1000): T[] { if (!Array.isArray(value) || value.length > maximum) return fail('invalid_data_context_list'); return value.map(normalize); }
export function distinct(values: string[]): void { if (new Set(values).size !== values.length) fail('duplicate_data_context_identity'); }
export function location(value: unknown, schemaVersion: 1 | 2 = 2): DataContextFieldLocation {
  if (!object(value)) return fail('invalid_data_context_field_location');
  if (value.kind === 'csv-column') return { kind: 'csv-column', columnIndex: integer(value.columnIndex) };
  if (value.kind === 'json-pointer') { const pointer = text(value.pointer, 1000); if (!pointer.startsWith('/') || /~(?![01])/.test(pointer) || schemaVersion === 1 && (value.database !== undefined || value.queryExpression !== undefined)) return fail('invalid_data_context_field_location'); return { kind: 'json-pointer', pointer, ...(value.database === undefined ? {} : { database: databaseLocation(value.database) }), ...(value.queryExpression === undefined ? {} : { queryExpression: text(value.queryExpression, 2000) }) }; }
  if (schemaVersion === 2 && value.kind === 'tsv-column') return { kind: 'tsv-column', columnIndex: integer(value.columnIndex) };
  if (schemaVersion === 2 && value.kind === 'xlsx-range') {
    const sheetName = text(value.sheetName, 1000); if (!sheetName.length) return fail('invalid_data_context_field_location');
    let range: string; try { range = normalizeXlsxRange(text(value.range, 40)); } catch { return fail('invalid_data_context_xlsx_range'); }
    return { kind: 'xlsx-range', sheetName, range };
  }
  if (schemaVersion === 2 && value.kind === 'text-range') {
    const start = integer(value.start), end = integer(value.end); if (start >= end) return fail('invalid_data_context_text_range');
    return { kind: 'text-range', start, end };
  }
  return fail('invalid_data_context_field_location');
}
function databaseObject(value: unknown): NonNullable<DataContextDatabaseLocation['object']> {
  if (!object(value)) return fail('invalid_data_context_database_location');
  return { database: text(value.database, 1000), schema: text(value.schema, 1000), name: text(value.name, 1000), columns: list(value.columns, item => text(item, 1000)) };
}
export function databaseLocation(value: unknown): DataContextDatabaseLocation {
  if (!object(value) || !['query-result', 'metadata-observation'].includes(String(value.sourceKind)) || integer(value.connectionRevision) < 1) return fail('invalid_data_context_database_location');
  return { sourceKind: value.sourceKind as DataContextDatabaseLocation['sourceKind'], sourceId: id(value.sourceId), sourcePath: relative(value.sourcePath, ['020_clean'], ['.json']), sourceSha256: hash(value.sourceSha256), connectionId: text(value.connectionId, 100), connectionRevision: integer(value.connectionRevision), sourceIdentity: text(value.sourceIdentity, 1000), ...(value.object === undefined ? {} : { object: databaseObject(value.object) }), ...(value.relatedObject === undefined ? {} : { relatedObject: databaseObject(value.relatedObject) }) };
}
/** Derive technical positions only from the exact frozen Host source; never infer business joins. */
export function databaseLocationFromSource(source: unknown, version: { projectId: string; sourcePath: string; sha256: string }, pointer: string): DataContextDatabaseLocation {
  if (!object(source) || source.schema !== 1 || !object(source.owner) || source.owner.projectId !== version.projectId || !object(source.source)) return fail('data_context_database_source_mismatch');
  const metadata = source.kind === 'db-link-metadata-observation';
  const base = { sourceKind: metadata ? 'metadata-observation' as const : 'query-result' as const, sourceId: id(source.id), sourcePath: version.sourcePath, sourceSha256: version.sha256, connectionId: source.source.connectionId, connectionRevision: source.source.connectionRevision, sourceIdentity: source.source.sourceIdentity };
  if (!metadata) {
    const position = /^\/columns\/(0|[1-9]\d*)$/.exec(pointer);
    if (!['complete', 'partial', 'failed', 'cancelled'].includes(String(source.status)) || !Array.isArray(source.columns) || !position || !object(source.columns[Number(position[1])])) return fail('data_context_database_field_mismatch');
    return databaseLocation(base);
  }
  const position = /^\/objects\/(0|[1-9]\d*)(?:\/(columns|constraints)\/(0|[1-9]\d*))?$/.exec(pointer);
  if (!position || !Array.isArray(source.objects)) return fail('data_context_database_field_mismatch');
  const original = source.objects[Number(position[1])];
  if (!object(original) || !Array.isArray(original.columns)) return fail('data_context_database_field_mismatch');
  let columns = original.columns.map(value => object(value) ? text(value.name, 1000) : fail('data_context_database_field_mismatch')), relatedObject: DataContextDatabaseLocation['relatedObject'];
  if (position[2] === 'columns') { const column = original.columns[Number(position[3])]; if (!object(column)) return fail('data_context_database_field_mismatch'); columns = [text(column.name, 1000)]; }
  if (position[2] === 'constraints') {
    const constraint = Array.isArray(original.constraints) ? original.constraints[Number(position[3])] : undefined;
    if (!object(constraint)) return fail('data_context_database_field_mismatch'); columns = list(constraint.columns, value => text(value, 1000));
    if (constraint.target !== undefined) { if (!object(constraint.target)) return fail('data_context_database_field_mismatch'); relatedObject = databaseObject({ ...constraint.target, name: constraint.target.object }); }
  }
  return databaseLocation({ ...base, object: { database: original.database, schema: original.schema, name: original.name, columns }, ...(relatedObject ? { relatedObject } : {}) });
}
export function validateDatabaseLocationSource(value: Extract<DataContextFieldLocation, { kind: 'json-pointer' }>, source: unknown, version: { projectId: string; sourcePath: string; sha256: string }): void {
  if (value.database && canonical(value.database) !== canonical(databaseLocationFromSource(source, version, value.pointer))) fail('data_context_database_source_mismatch');
}
export function native(value: unknown): DataContextNativeEvidence | null {
  if (value == null) return null;
  if (!object(value)) return fail('invalid_data_context_native_reference');
  const taskId = id(value.taskId), nativeSessionId = text(value.nativeSessionId, 1000), entryId = text(value.entryId, 1000);
  if (!nativeSessionId || !entryId) return fail('invalid_data_context_native_reference');
  return { taskId, nativeSessionId, entryId };
}
export function artifact(value: unknown): DataContextArtifactEvidence | null {
  if (value == null) return null; if (!object(value)) return fail('invalid_data_context_artifact_reference');
  return { path: relative(value.path, ['020_clean', '060_reports']), sha256: hash(value.sha256) };
}
export function concept(value: unknown): DataContextConceptRef {
  if (!object(value)) return fail('invalid_data_context_concept_reference');
  const result: DataContextConceptRef = { storeId: text(value.storeId, 200), materialId: id(value.materialId), revisionId: id(value.revisionId) };
  if (!result.storeId) return fail('invalid_data_context_concept_reference');
  if (value.location !== undefined) { if (!object(value.location)) return fail('invalid_data_context_concept_reference'); const start = integer(value.location.start), end = integer(value.location.end); if (end <= start) return fail('invalid_data_context_concept_reference'); result.location = { start, end }; }
  return result;
}
export function sap(value: unknown): DataContextSapRef {
  if (!object(value)) return fail('invalid_data_context_sap_reference');
  const packageId = text(value.packageId, 200), version = text(value.version, 200), metricName = text(value.metricName, 1000), publishedHash = value.publishedHash == null ? null : hash(value.publishedHash);
  if (!packageId || !version || !metricName) return fail('invalid_data_context_sap_reference');
  return { packageId, version, metricName, publishedHash };
}
export function observation(value: unknown, schemaVersion: 1 | 2 = 2): DataContextObservation {
  const formats = schemaVersion === 1 ? ['csv', 'json', 'unsupported', 'unknown'] : ['csv', 'tsv', 'json', 'xlsx', 'markdown', 'unsupported', 'unknown'];
  if (!object(value) || !['user', 'agent', 'unknown'].includes(value.author as string) || !formats.includes(value.format as string) || !['complete', 'partial', 'unobserved'].includes(value.coverage as string)) return fail('invalid_data_context_observation');
  const scannedRows = value.scannedRows === null ? null : integer(value.scannedRows), totalRows = value.totalRows === null ? null : integer(value.totalRows);
  const fields = list(value.fields, field => { if (!object(field)) return fail('invalid_data_context_observation'); return { location: location(field.location, schemaVersion), originalName: text(field.originalName, 1000), observedType: text(field.observedType, 1000) }; });
  const limitations = text(value.limitations);
  if (value.coverage === 'complete' && (scannedRows === null || totalRows === null || scannedRows !== totalRows)) return fail('invalid_data_context_observation');
  if (value.coverage === 'unobserved' && (scannedRows !== null || totalRows !== null || fields.length)) return fail('invalid_data_context_observation');
  if (value.coverage === 'partial' && !limitations.trim() || scannedRows !== null && totalRows !== null && scannedRows > totalRows) return fail('invalid_data_context_observation');
  if (['unknown', 'unsupported'].includes(value.format as string) && value.coverage !== 'unobserved') return fail('invalid_data_context_observation');
  const kinds: Record<string, DataContextFieldLocation['kind']> = { csv: 'csv-column', tsv: 'tsv-column', json: 'json-pointer', xlsx: 'xlsx-range', markdown: 'text-range' };
  if (fields.some(field => field.location.kind !== kinds[value.format as string])) return fail('invalid_data_context_observation');
  distinct(fields.map(field => canonical(field.location)));
  const encoding = value.encoding === null ? null : text(value.encoding, 1000), recordRule = value.recordRule === null ? null : text(value.recordRule, 2000);
  if (value.format === 'markdown' && value.coverage === 'unobserved' && recordRule !== null) return fail('invalid_data_context_observation');
  if (value.coverage !== 'unobserved' && (!recordRule?.trim() || ['csv', 'tsv', 'markdown'].includes(value.format as string) && !encoding?.trim())) return fail('invalid_data_context_observation');
  return { author: value.author as DataContextObservation['author'], format: value.format as DataContextObservation['format'], encoding, recordRule, coverage: value.coverage as DataContextObservation['coverage'], scannedRows, totalRows, fields, limitations, generatedAt: value.generatedAt === null ? null : date(value.generatedAt), nativeEvidence: native(value.nativeEvidence), artifactEvidence: artifact(value.artifactEvidence) };
}
function provenance(value: unknown): DataContextStatement['provenance'] { if (!['user-statement', 'agent-inference', 'unknown'].includes(value as string)) return fail('invalid_data_context_provenance'); return value as DataContextStatement['provenance']; }
function confirmation(value: Record<string, unknown>, preserve: boolean): DataContextConfirmation {
  if (!preserve) return { confirmed: false, confirmedAt: null, confirmedBy: null };
  if (typeof value.confirmed !== 'boolean' || (value.confirmed ? typeof value.confirmedBy !== 'string' || !value.confirmedBy.trim() || value.confirmedAt === null : value.confirmedAt !== null || value.confirmedBy !== null)) return fail('corrupt_data_context_confirmation');
  return { confirmed: value.confirmed, confirmedAt: value.confirmed ? date(value.confirmedAt) : null, confirmedBy: value.confirmed ? text(value.confirmedBy, 200) : null };
}
export function statement(value: unknown, preserve = false, schemaVersion: 1 | 2 = 2): DataContextStatement {
  if (!object(value) || !['row-meaning', 'business-time', 'field', 'source-and-limitations'].includes(value.scope as string)) return fail('invalid_data_context_statement');
  const field = value.location === null ? null : location(value.location, schemaVersion);
  if (value.scope === 'field' && field === null) return fail('invalid_data_context_statement');
  return { statementId: id(value.statementId), scope: value.scope as DataContextStatement['scope'], location: field, text: text(value.text), unit: value.unit === null ? null : text(value.unit, 1000), provenance: provenance(value.provenance), ...confirmation(value, preserve) };
}
export function mapping(value: unknown, preserve = false, schemaVersion: 1 | 2 = 2): DataContextMapping {
  if (!object(value)) return fail('invalid_data_context_mapping');
  const conceptRefs = list(value.conceptRefs, concept), sapRefs = list(value.sapRefs, sap);
  if (!conceptRefs.length && !sapRefs.length) return fail('invalid_data_context_mapping');
  return { mappingId: id(value.mappingId), location: location(value.location, schemaVersion), conceptRefs, sapRefs, provenance: provenance(value.provenance), dispute: text(value.dispute), ...confirmation(value, preserve) };
}

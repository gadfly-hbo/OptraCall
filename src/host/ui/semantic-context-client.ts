import type { SemanticQueryInput, SemanticQueryResult, SemanticTarget } from '../../../extensions/business-plugins/semantic-context/types.ts';
import type { SemanticSourcesRecorded } from '../../agent/semantic-context.ts';
import type { SemanticGraphQuery, SemanticGraphResult, SemanticGraphSourceRef } from '../../../extensions/business-plugins/semantic-context/graph.ts';
export type { SemanticItem, SemanticQueryInput, SemanticQueryResult, SemanticSourceState, SemanticTarget } from '../../../extensions/business-plugins/semantic-context/types.ts';
export type { SemanticSourcesRecorded } from '../../agent/semantic-context.ts';
export type { SemanticGraphQuery, SemanticGraphResult, SemanticGraphNode, SemanticGraphEdge, SemanticGraphPath, SemanticGraphMetadata } from '../../../extensions/business-plugins/semantic-context/graph.ts';

export type SemanticContextRecord = { result?: SemanticQueryResult; graphResult?: SemanticGraphResult; receipt?: SemanticSourcesRecorded; input?: SemanticQueryInput; graphInput?: SemanticGraphQuery; issue?: string; native?: { sessionId: string; entryId: string; toolCallId?: string; recordedAt?: string } };
export type SemanticContextReader = (projectId: string, taskId: string, input: SemanticQueryInput, signal?: AbortSignal) => Promise<SemanticQueryResult>;

export class SemanticContextRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) { super(message); this.name = 'SemanticContextRequestError'; this.code = code; this.status = status; }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const textList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sourceState = (value: unknown) => typeof value === 'string' && ['available', 'missing', 'hash-conflict', 'forbidden', 'excluded', 'disabled', 'unknown', 'partial'].includes(value);
const strings = (value: Record<string, unknown>, ...keys: string[]) => keys.every(key => typeof value[key] === 'string');
function target(value: unknown): value is SemanticTarget {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'sap': return strings(value, 'packageId', 'version') && (value.metricName === undefined || typeof value.metricName === 'string') && (value.publishedHash === undefined || value.publishedHash === null || typeof value.publishedHash === 'string');
    case 'enterprise': return strings(value, 'storeId', 'materialId', 'revisionId') && (value.location === undefined || object(value.location) && integer(value.location.start) && integer(value.location.end) && value.location.end >= value.location.start);
    case 'data-input': return strings(value, 'projectId', 'datasetId', 'inputVersionId');
    case 'data-description': return strings(value, 'projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId');
    case 'data-citation': return strings(value, 'projectId', 'citationId');
    case 'data-evidence': return strings(value, 'projectId', 'citationId') && (value.attachmentIndex === null || integer(value.attachmentIndex));
    case 'case-decision': return strings(value, 'caseStoreId', 'caseId', 'recordId') && integer(value.revision);
    case 'case-choice': return strings(value, 'caseStoreId', 'caseId', 'choiceId');
    case 'source': return object(value.source) && typeof value.source.type === 'string';
    case 'personal': return object(value.target);
    default: return false;
  }
}
function item(value: unknown): boolean {
  if (!object(value) || !target(value.target) || !sourceState(value.state) || !(value.title === null || typeof value.title === 'string') || !(value.sha256 === null || typeof value.sha256 === 'string') || !(value.body === null || typeof value.body === 'string') || !textList(value.gaps)) return false;
  if (!(value.range === null || object(value.range) && integer(value.range.start) && integer(value.range.end) && integer(value.range.total) && value.range.start <= value.range.end && value.range.end <= value.range.total)) return false;
  if (value.metadataFragment !== undefined && !(object(value.metadataFragment) && typeof value.metadataFragment.text === 'string' && object(value.metadataFragment.range) && integer(value.metadataFragment.range.start) && integer(value.metadataFragment.range.end) && integer(value.metadataFragment.range.total) && value.metadataFragment.range.start <= value.metadataFragment.range.end && value.metadataFragment.range.end <= value.metadataFragment.range.total && value.metadataFragment.text.length === value.metadataFragment.range.end - value.metadataFragment.range.start)) return false;
  if (!(value.recordedAt === null || object(value.recordedAt) && strings(value.recordedAt, 'field', 'value'))) return false;
  if (!Array.isArray(value.businessTime) || !value.businessTime.every(time => object(time) && strings(time, 'text', 'source'))) return false;
  if (!(value.governance === null || object(value.governance)) || !(value.declaration === null || object(value.declaration) && strings(value.declaration, 'actor', 'text') && value.declaration.claim === 'author-declaration')) return false;
  return (value.code === undefined || typeof value.code === 'string') && Array.isArray(value.relations) && value.relations.every(relation => object(relation) && typeof relation.relation === 'string' && (relation.target === null || target(relation.target)) && (relation.note === null || typeof relation.note === 'string') && ['author-declaration', 'explicit-reference'].includes(String(relation.claim)));
}

/** Checks displayable transient fields only; source authority and permission remain with the original Store. */
export function isSemanticQueryResult(value: unknown): value is SemanticQueryResult {
  if (!object(value) || value.schemaVersion !== 1 || value.type !== 'optracall.semantic-context-result' || !['find', 'read', 'trace'].includes(String(value.action)) || !sourceState(value.state)) return false;
  return Array.isArray(value.items) && value.items.every(item) && Array.isArray(value.unknownTime) && value.unknownTime.every(item) && (value.indexRevision === null || integer(value.indexRevision)) && object(value.coverage) && typeof value.coverage.complete === 'boolean' && (value.coverage.continuation === null || typeof value.coverage.continuation === 'string') && textList(value.coverage.gaps);
}

const graphNodes = ['MetricConcept', 'MetricVersion', 'MethodVersion', 'SourceRevision', 'Statement', 'Condition', 'InputVersion', 'FieldRole'];
const graphEdges = ['version_of', 'depends_on', 'has_source', 'requires', 'maps_to', 'describes_input', 'distinct_from', 'potential_conflict'];
const graphOperations = ['find', 'definition', 'neighbors', 'dependencies', 'impact', 'source'];
const keysOnly = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const graphRange = (value: unknown): value is { start: number; end: number; total: number } => object(value) && keysOnly(value, ['start', 'end', 'total']) && integer(value.start) && integer(value.end) && integer(value.total) && value.start <= value.end && value.end <= value.total;
function graphRef(value: unknown): value is SemanticGraphSourceRef {
  if (!object(value) || value.sourceHandle !== undefined && !nonempty(value.sourceHandle)) return false;
  const fields: Record<string, string[]> = {
    sap: ['packageId', 'version', 'metricName', 'publishedHash'], 'sap-method': ['methodId', 'version', 'publishedHash'],
    enterprise: ['storeId', 'materialId', 'revisionId', 'location'], 'data-input': ['projectId', 'datasetId', 'inputVersionId'],
    'data-description': ['projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId'],
  };
  if (typeof value.kind !== 'string' || !Object.hasOwn(fields, value.kind) || !keysOnly(value, ['kind', 'sourceHandle', ...fields[value.kind]!])) return false;
  if (value.kind === 'sap' && (!nonempty(value.packageId) || !nonempty(value.version) || value.metricName !== undefined && !nonempty(value.metricName))) return false;
  if (value.kind === 'sap-method' && (!nonempty(value.methodId) || !integer(value.version) || value.version < 1)) return false;
  if (value.kind === 'enterprise' && (!['storeId', 'materialId', 'revisionId'].every(key => nonempty(value[key])) || value.location !== undefined && !(object(value.location) && keysOnly(value.location, ['start', 'end']) && integer(value.location.start) && integer(value.location.end) && value.location.end > value.location.start))) return false;
  if (value.kind === 'data-input' && !['projectId', 'datasetId', 'inputVersionId'].every(key => nonempty(value[key]))) return false;
  if (value.kind === 'data-description' && !['projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId'].every(key => nonempty(value[key]))) return false;
  return value.publishedHash === undefined || value.publishedHash === null || hash(value.publishedHash);
}
function graphBuildSource(value: unknown): boolean {
  return object(value) && keysOnly(value, ['inputKey', 'locator', 'sha256', 'nature', 'sourceHandle']) && nonempty(value.inputKey) && nonempty(value.locator)
    && (value.sha256 === undefined || hash(value.sha256)) && (value.sourceHandle === undefined || nonempty(value.sourceHandle))
    && (value.nature === undefined || typeof value.nature === 'string' && ['deidentified-source', 'synthetic-data', 'asset-publication', 'engineering-design'].includes(value.nature));
}
function graphMetadata(value: unknown): boolean {
  return object(value) && keysOnly(value, ['sourceRefs', 'buildSources', 'claimKind', 'conditions', 'limitations', 'businessTime', 'candidateLocator', 'conditionState', 'operandRole', 'roleText'])
    && Array.isArray(value.sourceRefs) && value.sourceRefs.every(graphRef) && Array.isArray(value.buildSources) && value.buildSources.every(graphBuildSource)
    && value.sourceRefs.length + value.buildSources.length > 0
    && typeof value.claimKind === 'string' && ['source-projection', 'engineering-interpretation', 'synthetic-assumption'].includes(value.claimKind)
    && textList(value.conditions) && textList(value.limitations) && Array.isArray(value.businessTime) && value.businessTime.every(time => object(time) && keysOnly(time, ['text', 'source']) && strings(time, 'text', 'source'))
    && (value.candidateLocator === undefined || nonempty(value.candidateLocator))
    && (value.conditionState === undefined || typeof value.conditionState === 'string' && ['stated', 'required-not-established', 'unknown', 'disputed'].includes(value.conditionState))
    && (value.operandRole === undefined || value.operandRole === 'minuend' || value.operandRole === 'subtrahend') && (value.roleText === undefined || nonempty(value.roleText));
}

/** Passive validation of a recorded tool payload; it grants no current read authority. */
export function isSemanticGraphResult(value: unknown): value is SemanticGraphResult {
  if (!object(value) || !keysOnly(value, ['schemaVersion', 'type', 'action', 'operation', 'state', 'snapshot', 'nodes', 'edges', 'paths', 'sources', 'coverage', 'code'])
    || value.schemaVersion !== 1 || value.type !== 'optracall.semantic-graph-result' || value.action !== 'graph' || typeof value.operation !== 'string' || !graphOperations.includes(value.operation) || !sourceState(value.state)) return false;
  if (!(value.snapshot === null || object(value.snapshot) && keysOnly(value.snapshot, ['id', 'graphSha256', 'ontologySha256', 'componentVersion']) && nonempty(value.snapshot.id) && hash(value.snapshot.graphSha256) && hash(value.snapshot.ontologySha256) && nonempty(value.snapshot.componentVersion))) return false;
  if (!Array.isArray(value.nodes) || !value.nodes.every(node => object(node) && keysOnly(node, ['id', 'type', 'content', 'metadata', 'contentRange']) && nonempty(node.id) && typeof node.type === 'string' && graphNodes.includes(node.type) && typeof node.content === 'string' && graphMetadata(node.metadata)
    && (node.type === 'Condition' ? object(node.metadata) && node.metadata.conditionState !== undefined : object(node.metadata) && node.metadata.conditionState === undefined)
    && (node.contentRange === undefined || graphRange(node.contentRange) && node.content.length === node.contentRange.end - node.contentRange.start))) return false;
  const nodes = new Map(value.nodes.map(node => [node.id, node]));
  if (nodes.size !== value.nodes.length || !Array.isArray(value.edges) || !value.edges.every(edge => object(edge) && keysOnly(edge, ['id', 'source', 'target', 'type', 'metadata']) && nonempty(edge.id) && nonempty(edge.source) && nonempty(edge.target) && nodes.has(edge.source) && nodes.has(edge.target) && typeof edge.type === 'string' && graphEdges.includes(edge.type) && graphMetadata(edge.metadata) && object(edge.metadata) && edge.metadata.conditionState === undefined)) return false;
  const edges = new Map(value.edges.map(edge => [edge.id, edge]));
  if (edges.size !== value.edges.length || !Array.isArray(value.paths) || !value.paths.every(path => {
    if (!object(path) || !keysOnly(path, ['nodeIds', 'steps']) || !Array.isArray(path.nodeIds) || path.nodeIds.length < 2 || !path.nodeIds.every(id => typeof id === 'string' && nodes.has(id)) || !Array.isArray(path.steps) || path.steps.length + 1 !== path.nodeIds.length) return false;
    const nodeIds = path.nodeIds;
    return path.steps.every((step, index) => {
      if (!object(step) || !keysOnly(step, ['edgeId', 'direction']) || !nonempty(step.edgeId) || typeof step.direction !== 'string' || !['forward', 'reverse'].includes(step.direction)) return false;
      const edge = edges.get(step.edgeId); if (!edge) return false;
      if (value.operation === 'dependencies' && (edge.type !== 'depends_on' || step.direction !== 'forward')) return false;
      if (value.operation === 'impact' && !((edge.type === 'maps_to' && step.direction === 'forward') || (edge.type === 'depends_on' && step.direction === 'reverse'))) return false;
      return (step.direction === 'forward' ? edge.source === nodeIds[index] && edge.target === nodeIds[index + 1] : edge.target === nodeIds[index] && edge.source === nodeIds[index + 1]);
    });
  }) || value.paths.length > 0 && !['dependencies', 'impact'].includes(value.operation)) return false;
  if (!Array.isArray(value.sources) || !value.sources.every(source => object(source) && keysOnly(source, ['sourceHandle', 'ref', 'buildSource', 'body', 'range', 'nature', 'gaps']) && nonempty(source.sourceHandle)
    && (source.ref !== undefined ? graphRef(source.ref) && source.buildSource === undefined : graphBuildSource(source.buildSource))
    && (source.body === null ? source.range === null : typeof source.body === 'string' && graphRange(source.range) && source.body.length === source.range.end - source.range.start)
    && typeof source.nature === 'string' && textList(source.gaps))) return false;
  if (!object(value.coverage) || !keysOnly(value.coverage, ['complete', 'continuation', 'gaps', 'depthLimit', 'depthReached', 'exhausted']) || typeof value.coverage.complete !== 'boolean'
    || !(value.coverage.continuation === null || nonempty(value.coverage.continuation)) || !textList(value.coverage.gaps)
    || value.coverage.depthLimit !== undefined && (!integer(value.coverage.depthLimit) || value.coverage.depthLimit < 1 || value.coverage.depthLimit > 4)
    || value.coverage.depthReached !== undefined && (!integer(value.coverage.depthReached) || !integer(value.coverage.depthLimit) || value.coverage.depthReached > value.coverage.depthLimit)
    || value.coverage.complete && value.coverage.continuation !== null
    || value.coverage.exhausted !== undefined && typeof value.coverage.exhausted !== 'boolean') return false;
  return value.code === undefined || typeof value.code === 'string';
}

export function isSemanticSourcesRecorded(value: unknown): value is SemanticSourcesRecorded {
  return object(value) && value.schemaVersion === 1 && value.type === 'optracall.analysis-sources-recorded' && value.claim === 'author-declaration-not-verification' && strings(value, 'projectId', 'citationId', 'operationId') && integer(value.indexRevision) && typeof value.replayed === 'boolean' && typeof value.publishedOnRetry === 'boolean' && object(value.report) && strings(value.report, 'originalPath', 'sha256') && /^[a-f0-9]{64}$/i.test(value.report.sha256 as string) && integer(value.report.bytes);
}

export const readSemanticContext: SemanticContextReader = async (projectId, taskId, input, signal) => {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/semantic-context`, { method: 'POST', credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-optracall-client': '1' }, body: JSON.stringify(input), signal });
  let result;
  try { result = await response.json(); }
  catch { throw new SemanticContextRequestError('semantic_context_invalid_response', response.status, '本次来源回包无法核定，原记录保持。'); }
  if (!response.ok) throw new SemanticContextRequestError(typeof result?.code === 'string' ? result.code : typeof result?.error === 'string' ? result.error : 'semantic_context_failed', response.status, typeof result?.message === 'string' ? result.message : '本次来源读取未能核定，原任务仍可继续。');
  if (!isSemanticQueryResult(result)) throw new SemanticContextRequestError('semantic_context_invalid_response', response.status, '本次来源回包无法核定，原记录保持。');
  return result;
};

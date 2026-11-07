import { Type } from 'typebox';
import { SemanticReadFault } from './reader.ts';
import type { SemanticSourceState, SemanticTarget } from './types.ts';

/** Transient D13 transport only. Original Stores retain business authority. */
export const semanticGraphNodeTypes = ['MetricConcept', 'MetricVersion', 'MethodVersion', 'SourceRevision', 'Statement', 'Condition', 'InputVersion', 'FieldRole'] as const;
export const semanticGraphRelationTypes = ['version_of', 'depends_on', 'has_source', 'requires', 'maps_to', 'describes_input', 'distinct_from', 'potential_conflict', 'asserted_relation'] as const;
export type SemanticGraphNodeType = typeof semanticGraphNodeTypes[number];
export type SemanticGraphRelationType = typeof semanticGraphRelationTypes[number];
export type SemanticGraphOperation = 'find' | 'definition' | 'neighbors' | 'dependencies' | 'impact' | 'source';
type Page = { pageSize?: number; continuation?: string | null };
export type SemanticGraphQuery = Page & { action: 'graph' } & (
  | { operation: 'find'; query: string; nodeTypes?: SemanticGraphNodeType[] }
  | { operation: 'definition'; nodeId: string }
  | { operation: 'neighbors'; nodeId: string; relationTypes?: SemanticGraphRelationType[]; direction?: 'out' | 'in' | 'both' }
  | { operation: 'dependencies' | 'impact'; nodeId: string; depth?: number }
  | { operation: 'source'; sourceHandle: string }
);
export type StudioSemanticGraphSourceRef = { kind: 'studio-source'; systemId: string; assetId: string; version: string; publishedHash: string; projectId: string };
export type SemanticGraphSourceRef = (Extract<SemanticTarget, { kind: 'sap' | 'sap-method' | 'enterprise' | 'data-input' | 'data-description' }> | StudioSemanticGraphSourceRef) & { sourceHandle?: string };
export type SemanticGraphBuildSource = {
  inputKey: string; locator: string; sha256?: string;
  nature?: 'deidentified-source' | 'synthetic-data' | 'asset-publication' | 'engineering-design'; sourceHandle?: string;
};
export type SemanticGraphMetadata = {
  sourceRefs: SemanticGraphSourceRef[]; buildSources: SemanticGraphBuildSource[];
  claimKind: 'source-projection' | 'engineering-interpretation' | 'synthetic-assumption';
  conditions: string[]; limitations: string[]; businessTime: { text: string; source: string }[];
  candidateLocator?: string; conditionState?: 'stated' | 'required-not-established' | 'unknown' | 'disputed';
  operandRole?: 'minuend' | 'subtrahend'; roleText?: string;
  predicate?: string; weak?: boolean; actualMethod?: string; assetKind?: string;
};
export type SemanticGraphRange = { start: number; end: number; total: number };
export type SemanticGraphNode = { id: string; type: SemanticGraphNodeType; content: string; metadata: SemanticGraphMetadata; contentRange?: SemanticGraphRange };
export type SemanticGraphEdge = { id: string; source: string; target: string; type: SemanticGraphRelationType; metadata: SemanticGraphMetadata };
export type SemanticGraphPath = { nodeIds: string[]; steps: { edgeId: string; direction: 'forward' | 'reverse' }[] };
export type SemanticGraphSnapshot = { id: string; graphSha256: string; ontologySha256: string; componentVersion: string };
export type SemanticGraphSource = {
  sourceHandle: string; ref?: SemanticGraphSourceRef; buildSource?: SemanticGraphBuildSource;
  body: string | null; range: SemanticGraphRange | null; nature: string; gaps: string[];
};
export type SemanticGraphResult = {
  schemaVersion: 1; type: 'optracall.semantic-graph-result'; action: 'graph'; operation: SemanticGraphOperation;
  state: SemanticSourceState; snapshot: SemanticGraphSnapshot | null;
  nodes: SemanticGraphNode[]; edges: SemanticGraphEdge[]; paths: SemanticGraphPath[]; sources: SemanticGraphSource[];
  coverage: { complete: boolean; continuation: string | null; gaps: string[]; depthLimit?: number; depthReached?: number; exhausted?: boolean };
  code?: string;
};

const exact = { additionalProperties: false };
const string = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: '^[^\\u0000]+$' });
const page = { action: Type.Literal('graph'), pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), continuation: Type.Optional(Type.Union([string(4096), Type.Null()])) };
const nodeId = string(256);
const depth = Type.Optional(Type.Integer({ minimum: 1, maximum: 4 }));
export const semanticGraphParameters = Type.Union([
  Type.Object({ ...page, operation: Type.Literal('find'), query: string(200), nodeTypes: Type.Optional(Type.Array(Type.Union(semanticGraphNodeTypes.map(t => Type.Literal(t))), { uniqueItems: true, maxItems: semanticGraphNodeTypes.length })) }, exact),
  Type.Object({ ...page, operation: Type.Literal('definition'), nodeId }, exact),
  Type.Object({ ...page, operation: Type.Literal('neighbors'), nodeId, relationTypes: Type.Optional(Type.Array(Type.Union(semanticGraphRelationTypes.map(t => Type.Literal(t))), { uniqueItems: true, maxItems: semanticGraphRelationTypes.length })), direction: Type.Optional(Type.Union([Type.Literal('out'), Type.Literal('in'), Type.Literal('both')])) }, exact),
  Type.Object({ ...page, operation: Type.Literal('dependencies'), nodeId, depth }, exact),
  Type.Object({ ...page, operation: Type.Literal('impact'), nodeId, depth }, exact),
  Type.Object({ ...page, operation: Type.Literal('source'), sourceHandle: string(4096) }, exact),
]);

export function parseSemanticGraphQuery(value: unknown): SemanticGraphQuery {
  const fail = (): never => { throw new SemanticReadFault('invalid_semantic_graph_request'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const input = value as Record<string, unknown>;
  const operation = input.operation;
  if (input.action !== 'graph' || typeof operation !== 'string' || !['find', 'definition', 'neighbors', 'dependencies', 'impact', 'source'].includes(operation)) return fail();
  const fields = ['action', 'operation', 'pageSize', 'continuation'];
  if (operation === 'find') fields.push('query', 'nodeTypes');
  else if (operation === 'source') fields.push('sourceHandle');
  else {
    fields.push('nodeId');
    if (operation === 'neighbors') fields.push('relationTypes', 'direction');
    if (operation === 'dependencies' || operation === 'impact') fields.push('depth');
  }
  if (Object.keys(input).some(k => !fields.includes(k))) return fail();
  const validString = (v: unknown, limit: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= limit && !v.includes('\0');
  if (operation === 'find') { if (!validString(input.query, 200) || !input.query.trim()) return fail(); }
  else if (operation === 'source') { if (!validString(input.sourceHandle, 4096)) return fail(); }
  else if (!validString(input.nodeId, 256)) return fail();
  for (const [field, choices] of [['nodeTypes', semanticGraphNodeTypes], ['relationTypes', semanticGraphRelationTypes]] as const) {
    const values = input[field];
    if (values !== undefined && (!Array.isArray(values) || values.length > choices.length || values.some(v => typeof v !== 'string' || !(choices as readonly string[]).includes(v)) || new Set(values).size !== values.length)) return fail();
  }
  if (input.direction !== undefined && (typeof input.direction !== 'string' || !['out', 'in', 'both'].includes(input.direction))) return fail();
  for (const [field, maximum] of [['depth', 4], ['pageSize', 100]] as const) {
    if (input[field] !== undefined && (!Number.isSafeInteger(input[field]) || Number(input[field]) < 1 || Number(input[field]) > maximum)) return fail();
  }
  if (input.continuation != null && !validString(input.continuation, 4096)) return fail();
  const result = { ...input, pageSize: input.pageSize ?? 20, continuation: input.continuation ?? null };
  if (operation === 'find') Object.assign(result, { query: String(input.query).trim().toLowerCase(), ...(input.nodeTypes ? { nodeTypes: [...input.nodeTypes as SemanticGraphNodeType[]] } : {}) });
  if (operation === 'neighbors') Object.assign(result, { direction: input.direction ?? 'both', ...(input.relationTypes ? { relationTypes: [...input.relationTypes as SemanticGraphRelationType[]] } : {}) });
  if (operation === 'dependencies' || operation === 'impact') Object.assign(result, { depth: input.depth ?? 2 });
  return result as SemanticGraphQuery;
}
